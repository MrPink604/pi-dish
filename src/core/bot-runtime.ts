/**
 * A bot's runtime: one pi-durable conversation in `durable.sqlite`, its tools,
 * and the mapping from its commits to pi-dish's bridge events and mirror.
 *
 * Every pi-durable call lives in this module: the package is pinned at 1.5.2
 * and its API changes between releases. pi-durable, pi-ai and pi-claude-code
 * are ES modules that need `node:sqlite`; they are imported when a runtime
 * opens, never when this module loads, so the server can import the pure
 * helpers on a host that cannot run a bot.
 *
 * pi-durable 1.5.2 has no Pi-style event stream. A watch of the conversation
 * yields each committed view: new transcript entries become `message_*` and
 * `tool_execution_end` events, the live document (`pi.live`) gives the run, the
 * streamed partial answer and the running tools.
 */
import crypto = require('crypto');
import fs = require('fs');
import nodeModule = require('module');
import path = require('path');
import url = require('url');
import esbuild = require('esbuild');
import type * as Durable from '@earendil-works/pi-durable' with { 'resolution-mode': 'import' };
import type { Context } from '@earendil-works/chord/context' with { 'resolution-mode': 'import' };
import type { Message, Models, Provider, AssistantMessage } from '@earendil-works/pi-ai' with { 'resolution-mode': 'import' };
import type { BotRow } from './bot-registry';
import type { BotMirror } from './bot-mirror';
import { record as isRecord } from './helper-values';
import type { KnowledgeSearch, KnowledgeWriteResult } from './knowledge';
import { stableSessionRef } from './helper-refs';
import type { ProtocolRecord } from './wire-protocol';

/** The notebook's cap, in UTF-8 bytes. */
export const NOTEBOOK_MAX_BYTES = 16 * 1024;
/** A window is sized to this many tokens even on a model with a larger context. */
export const WINDOW_TOKEN_CAP = 200_000;
/** From this share of the window on, each request carries a reminder to roll over. */
export const REMINDER_RATIO = 0.75;
/** At this share the relay rolls the window over itself once the run ends. */
export const FORCED_RATIO = 0.9;
const MEMORY_TOOLS: Readonly<Record<string, true>> = { context_notes: true, new_context: true, history: true };
const TAIL_MESSAGES = 8;
const TAIL_MESSAGE_CHARS = 2000;
const REPORT_CHARS = 8000;
const WATCH_FIRST_POLL_MS = 5_000;
const WATCH_MAX_POLL_MS = 60_000;
/** A worker still running after this long is reported as such and no longer watched. */
const WATCH_GIVE_UP_MS = 24 * 60 * 60_000;

/** Runs the pi-dish-sessions CLI as the bot; resolves with its stdout. */
export type SessionsPort = (args: string[]) => Promise<string>;

/** pi-dish's HTTP API on the hub: GET `path`, or POST it `body`; resolves with the JSON answer. */
export type HubApi = (path: string, body?: ProtocolRecord) => Promise<unknown>;

export type BridgeEmit = (event: string, data: ProtocolRecord) => void;

// ---------------------------------------------------------------------------
// Pure rules, shared with tests.

export interface SettledWorker {
  state: 'finished' | 'waiting' | 'inactive';
  totalMessages: number;
  text: string;
}

/** Text blocks of a Pi message, joined; tool calls and thinking are left out. */
export function messageText(message: unknown): string {
  if (!isRecord(message)) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .flatMap((part: unknown) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])
    .join('\n');
}

/**
 * The settle rule `pi-dish-sessions wait` uses: a worker has settled when it is
 * not working or compacting, its transcript holds more than `since` messages,
 * and its newest message is not the user's (a prompt not picked up yet). A
 * pending question counts as settled. `session` is the resolve row; `window` is
 * `/messages?limit=1`. Null means keep waiting.
 */
export function settledWorker(session: unknown, window: unknown, since: number): SettledWorker | null {
  const row = isRecord(session) ? session : {};
  const page = isRecord(window) ? window : {};
  const totalMessages = Number(page.totalMessages) || 0;
  const messages = Array.isArray(page.messages) ? page.messages : [];
  const last: unknown = messages.at(-1);
  const busy = row.turnInProgress === true || row.compacting === true;
  if (!busy && totalMessages > since) {
    if (row.askPending === true) return { state: 'waiting', totalMessages, text: messageText(last) };
    if (isRecord(last) && last.role !== 'user') return { state: 'finished', totalMessages, text: messageText(last) };
  }
  if (row.isActive !== true) return { state: 'inactive', totalMessages, text: messageText(last) };
  return null;
}

export interface WorkerRecord {
  name: string;
  /** The short ref `list` shows, host-qualified for a remote worker. */
  ref: string;
  /** The full session id the routes speak. */
  sessionId: string;
  harness: string;
  host: string | null;
  startedAt: string;
  /** Reports delivered so far; the watch posts one per settle with new messages. */
  reports: number;
  /** Set by the bot's own close: once the session stops, the watch ends without a report. */
  closing?: true;
  /** When the session was seen to stop or was closed. */
  closedAt?: string;
  /** When the watch ended: the session stopped, or 24 hours passed. */
  watchEndedAt?: string;
}

/**
 * Version 1 workers kept the long ref and a `reportedAt`: their watch ended at
 * the one report, though the session may still be open.
 */
function migrateWorkers(value: unknown): Record<string, WorkerRecord> {
  const workers: Record<string, WorkerRecord> = {};
  for (const [dispatchId, raw] of Object.entries(isRecord(value) ? value : {})) {
    const old = raw as { name: string; ref: string; harness: string; host: string | null; startedAt: string; reportedAt?: string };
    const prefix = old.host ? `${old.host}/` : '';
    const sessionId = prefix && old.ref.startsWith(prefix) ? old.ref.slice(prefix.length) : old.ref;
    workers[dispatchId] = {
      name: old.name, ref: `${prefix}${stableSessionRef(sessionId)}`, sessionId, harness: old.harness, host: old.host,
      startedAt: old.startedAt, reports: old.reportedAt ? 1 : 0, ...(old.reportedAt ? { watchEndedAt: old.reportedAt } : {}),
    };
  }
  return workers;
}

export interface ClosedWindow {
  line: string;
  closedAt: string;
  forced: boolean;
}

export interface BotMemory {
  notebook: string;
  /** How many windows were closed when the notebook was last saved; -1 for never. */
  notebookSavedIn: number;
  windows: ClosedWindow[];
  workers: Record<string, WorkerRecord>;
}

/** Why `new_context` is refused, or null when it may run. */
export function newContextRefusal(memory: BotMemory, workSinceRollover: boolean): string | null {
  if (!memory.notebook.trim()) {
    return 'Refused: your notebook is empty. Write what you need to keep with context_notes first; the new window starts from the notebook, not from this conversation.';
  }
  if (!workSinceRollover) {
    return 'Refused: nothing has happened since the last new window, so this is already the new window: a rollover you were asked for is done. Carry on with the work, or tell the user the new window is open; roll over again once this window has filled.';
  }
  if (memory.notebookSavedIn !== memory.windows.length) {
    return 'Refused: you have not saved your notebook in this window. Save it with context_notes (write the whole notebook, even if little changed), then call new_context again.';
  }
  return null;
}

/** The instructions of a window: fixed when it opens, never rewritten inside it. */
export function composeInstructions(identity: string, notebook: string): string {
  return [
    '<identity>', identity.trim(), '</identity>',
    '',
    '<notebook>', notebook.trim() || '(empty: nothing written down yet)', '</notebook>',
  ].join('\n');
}

export interface HandoffInput {
  windowNumber: number;
  closed: readonly ClosedWindow[];
  tail: readonly { role: string; text: string }[];
  request: string | null;
  workers: readonly WorkerRecord[];
  /** True when the window was closed at the context limit after a run; false when the bot's own new_context closed it. */
  forced: boolean;
}

/**
 * The first message of a new window: what the bot needs that its notebook does not hold. The latest request is
 * shown with what became of it: a rollover the bot made while handling it is done, and must not be read as a request
 * to roll over again.
 */
export function composeHandoff({ windowNumber, closed, tail, request, workers, forced }: HandoffInput): string {
  const lines = [`[Context window ${windowNumber}. Your identity and notebook are in your instructions; earlier windows are readable with the history tool.]`];
  if (closed.length) {
    lines.push('', 'Earlier windows:');
    closed.forEach((window, index) => lines.push(`${index + 1}. ${window.line}${window.forced ? ' (closed at the context limit)' : ''}`));
  }
  if (tail.length) {
    lines.push('', 'The end of the last window:');
    for (const message of tail) lines.push(`${message.role}: ${message.text}`);
  }
  lines.push('', `Latest request: ${request ?? '(none)'}`);
  if (request !== null) {
    lines.push(forced
      ? 'It was answered in the last window, which was then closed at the context limit.'
      : 'You opened this window with new_context while handling it, and that call is done: this is the new window. Do not call new_context again for it; carry on with whatever else it asks, or tell the user the new window is open.');
  }
  lines.push('', workers.length ? 'Workers you started that are still open (each new answer arrives as a report):' : 'No workers are open.');
  for (const worker of workers) lines.push(`- ${worker.name}: ${worker.ref} (${worker.harness}${worker.host ? ` on ${worker.host}` : ''}, started ${worker.startedAt}${worker.watchEndedAt ? ', no longer watched' : ''})`);
  return lines.join('\n');
}

const PREAMBLE = [
  'You are a pi-dish bot: a long-lived agent that is the standing contact for one area of work. You talk with the',
  'user, start pi-dish sessions (workers) to do the work, and keep what you learn. You have no shell and do not edit',
  'files; anything that needs doing on a machine goes to a worker.',
  '',
  'Workers: spawn_worker starts a session with a complete brief and returns its ref at once. Each time the worker',
  'ends a turn with something new, that answer is delivered to you once, as a message starting "[worker report]";',
  'do not poll for it. A worker may end a turn while background work runs and report again when it finishes. It is',
  'watched until it is closed or 24 hours pass, and the last report says so. Tell the user the ref when you start one',
  'and the outcome when it reports. Once you have what you need from a worker, close it with the sessions tool',
  '(action close); you can close only workers you started. A spawn whose outcome is unknown is never retried for you:',
  'look for the session with the sessions tool before starting another. The sessions tool lists, reads, searches,',
  'messages and closes sessions and reports the fleet\'s hosts and their load.',
  '',
  'Knowledge: the knowledge base holds topic pages every bot and session shares. Before sending a worker to find',
  'something out, look there (kb_search, kb_read). Write down durable facts you learn with kb_write, each with its',
  'source: what a host runs, where things live, how something is done. Code and task status do not belong there.',
  '',
  'Memory: your notebook (context_notes, at most 16 KiB) is the only thing that carries over to a new context window,',
  'with the end of the conversation and your running workers. Write what you need to carry on there, not chat. When',
  'the window is filling up, or a topic is done, save the notebook and call new_context with a one-line summary of',
  'the window. history reads and searches your earlier windows. Your instructions are fixed for a window; notebook',
  'edits show in them from the next window on.',
].join('\n');

// ---------------------------------------------------------------------------
// Models.

interface ClaudeCode {
  createClaudeCodeProvider(): Provider;
  closeClaudeProcesses(): Promise<void>;
}

let claudeCode: Promise<ClaudeCode> | null = null;

/**
 * pi-claude-code ships TypeScript source with `.ts` specifiers and a parameter
 * property, which Node's type stripping refuses inside node_modules. A load
 * hook transpiles exactly that package's sources; everything they import, pi-ai
 * included, loads natively and is shared with pi-durable.
 */
function loadClaudeCode(): Promise<ClaudeCode> {
  claudeCode ??= (async () => {
    const root = path.dirname(require.resolve('@earendil-works/pi-claude-code/package.json'));
    const sources = url.pathToFileURL(path.join(root, 'src') + path.sep).href;
    nodeModule.registerHooks({
      load(specifier, context, nextLoad) {
        if (!specifier.startsWith(sources) || !specifier.endsWith('.ts')) return nextLoad(specifier, context);
        const file = url.fileURLToPath(specifier);
        const { code } = esbuild.transformSync(fs.readFileSync(file, 'utf8'), {
          loader: 'ts', format: 'esm', target: 'node22', sourcefile: file,
        });
        return { format: 'module', source: code, shortCircuit: true };
      },
    });
    // The package has no type declarations a CommonJS program can resolve.
    const provider = await import(`${sources}provider.ts`) as Pick<ClaudeCode, 'createClaudeCodeProvider'>;
    const cli = await import(`${sources}claude-cli.ts`) as Pick<ClaudeCode, 'closeClaudeProcesses'>;
    return { createClaudeCodeProvider: provider.createClaudeCodeProvider, closeClaudeProcesses: cli.closeClaudeProcesses };
  })();
  return claudeCode;
}

export interface BotModels {
  models: Models;
  close(): Promise<void>;
}

/**
 * `claude-code/<id>` runs on the Claude subscription through the Claude Code
 * CLI; anything else goes through Pi's model runtime and its credentials.
 */
export async function openBotModels(selector: string): Promise<BotModels> {
  const provider = selector.slice(0, selector.indexOf('/'));
  if (provider === 'claude-code') {
    const pcc = await loadClaudeCode();
    const { createModels } = await import('@earendil-works/pi-ai/models');
    const models = createModels();
    models.setProvider(pcc.createClaudeCodeProvider());
    return { models, close: () => pcc.closeClaudeProcesses() };
  }
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  return { models: await ModelRuntime.create(), close: async () => {} };
}

// ---------------------------------------------------------------------------
// The runtime.

export interface BotRuntimeOptions {
  bot: BotRow;
  /** `durable.sqlite`; `:memory:` keeps nothing. */
  storageFile: string;
  mirror: BotMirror;
  models: Models;
  sessions: SessionsPort;
  /** The knowledge routes are reached through this. */
  api: HubApi;
  /** The bot's current registry row, read when a window opens. */
  loadBot(): BotRow;
  emit: BridgeEmit;
  /** Called after each change of what the bridge claim reports. */
  changed(): void;
  log(line: string): void;
  /** Initial and longest delay between polls of a worker. */
  pollMs?: { first: number; max: number };
}

export interface BotRuntime {
  readonly busy: boolean;
  readonly model: string;
  contextUsage(): { tokens: number; contextWindow: number; percent: number } | null;
  /** `followUp` queues behind a busy run; `steer` joins it. */
  prompt(message: string, mode: 'followUp' | 'steer'): Promise<void>;
  abort(): Promise<void>;
  close(): Promise<void>;
}

type LiveSlot = { callId: string; name: string; status: string; output?: string };
type LiveView = {
  run?: object;
  generation?: { message?: ProtocolRecord };
  tools?: LiveSlot[];
  runFailure?: { taskId: number; reason: string; detail?: string };
};

function liveOf(view: Durable.ConversationView): LiveView {
  const live: unknown = view.docs['pi.live'];
  return isRecord(live) ? live as LiveView : {};
}

function usageTokens(message: unknown): number {
  if (!isRecord(message) || !isRecord(message.usage)) return 0;
  const usage = message.usage;
  return ['input', 'output', 'cacheRead', 'cacheWrite']
    .reduce((sum, key) => sum + (typeof usage[key] === 'number' ? usage[key] : 0), 0);
}

/** The entry's message; string content becomes a text block, as Pi transcripts hold it. */
function entryMessage(entry: Durable.EntryRecord): ProtocolRecord | null {
  const message: unknown = entry.model?.[0];
  if (!isRecord(message)) return null;
  return typeof message.content === 'string' ? { ...message, content: [{ type: 'text', text: message.content }] } : message;
}

export async function openBotRuntime(options: BotRuntimeOptions): Promise<BotRuntime> {
  // ES modules needing node:sqlite: imported when a bot opens, never when this CommonJS module loads.
  const durable = await import('@earendil-works/pi-durable');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
  const schema = await import('@earendil-works/pi-schema');
  const { obj, opt, str, num, oneOf } = schema;
  const { bot, mirror, sessions, api: hub, emit, log } = options;
  const ctx: Context = BACKGROUND_CONTEXT;
  const pollMs = options.pollMs ?? { first: WATCH_FIRST_POLL_MS, max: WATCH_MAX_POLL_MS };
  const slash = bot.model.indexOf('/');
  const modelRef = { provider: bot.model.slice(0, slash), modelId: bot.model.slice(slash + 1) };
  const modelInfo = options.models.getModel(modelRef.provider, modelRef.modelId);
  const windowLimit = Math.min(modelInfo?.contextWindow || WINDOW_TOKEN_CAP, WINDOW_TOKEN_CAP);

  const MemoryDoc = durable.defineDoc<BotMemory & Durable.JsonObject>({
    kind: 'bot.memory',
    version: 2,
    scope: 'conversation',
    history: 'latest',
    fork: 'current',
    initial: () => ({ notebook: '', notebookSavedIn: -1, windows: [], workers: {} }),
    migrate: (value) => ({ ...value, workers: migrateWorkers(value.workers) }) as BotMemory & Durable.JsonObject,
    checkpointWhen: () => true,
  });
  const ReportEntry = 'bot.report';
  let root: Durable.Conversation | null = null;
  const conversation = (): Durable.Conversation => {
    if (!root) throw new Error('the bot conversation is not open yet');
    return root;
  };

  /** Entries from the newest reset (exclusive) to the end, newest first, up to `limit`. */
  async function currentWindow(limit: number): Promise<Durable.EntryRecord[]> {
    const found: Durable.EntryRecord[] = [];
    let cursor: Durable.Cursor | undefined;
    do {
      const page = await conversation().entries({ order: 'descending' }, 200, cursor, ctx);
      for (const entry of page.items) {
        if (entry.kind === 'pi.reset') return found;
        found.push(entry);
        if (found.length >= limit) return found;
      }
      cursor = page.next;
    } while (cursor);
    return found;
  }

  /** Every entry, oldest first, split into windows at each reset. */
  async function allWindows(): Promise<Durable.EntryRecord[][]> {
    const windows: Durable.EntryRecord[][] = [[]];
    let cursor: Durable.Cursor | undefined;
    do {
      const page = await conversation().entries({ order: 'ascending' }, 500, cursor, ctx);
      for (const entry of page.items) {
        if (entry.kind === 'pi.reset') windows.push([]);
        windows.at(-1)!.push(entry);
      }
      cursor = page.next;
    } while (cursor);
    return windows;
  }

  function isWork(entry: Durable.EntryRecord): boolean {
    if (entry.kind === 'pi.user' || entry.kind === ReportEntry) return true;
    const message = entryMessage(entry);
    return entry.kind === 'pi.tool-result' && !!message && !Object.hasOwn(MEMORY_TOOLS, String(message.toolName));
  }

  /** Closes the current window and fixes the next one's instructions; returns its handoff. */
  async function rollover(tx: Durable.Tx, conversationId: Durable.ConversationId, line: string, forced: boolean,
    window: readonly Durable.EntryRecord[]): Promise<string> {
    const memory = await tx.doc(MemoryDoc, conversationId);
    memory.windows.push({ line: line.trim().slice(0, 300) || '(no summary)', closedAt: new Date().toISOString(), forced });
    const current = options.loadBot();
    await durable.configure(tx, conversationId, { instructions: composeInstructions(current.identity, memory.notebook) });
    const tail = window
      .filter(entry => entry.kind === 'pi.user' || entry.kind === ReportEntry || entry.kind === 'pi.assistant')
      .map(entry => ({ role: entry.kind === 'pi.assistant' ? 'assistant' : entry.kind === ReportEntry ? 'report' : 'user', text: messageText(entryMessage(entry)).trim() }))
      .filter(message => message.text)
      .slice(0, TAIL_MESSAGES)
      .reverse()
      .map(message => ({ ...message, text: message.text.length > TAIL_MESSAGE_CHARS ? `${message.text.slice(0, TAIL_MESSAGE_CHARS)}…` : message.text }));
    const request = window.find(entry => entry.kind === 'pi.user' || entry.kind === ReportEntry);
    return composeHandoff({
      windowNumber: memory.windows.length + 1,
      closed: memory.windows,
      tail,
      request: request ? messageText(entryMessage(request)) : null,
      workers: Object.values(memory.workers).filter(worker => !worker.closedAt),
      forced,
    });
  }

  // Workers -----------------------------------------------------------------

  type WatchInput = { dispatchId: string; ref: string; name: string; since: number; startedAt: number };
  /** `since`: the transcript length the last report saw; `reports`: how many were delivered. */
  type PollState = { phase: 'poll'; delayMs: number; since: number; reports: number };
  type ReportState = {
    phase: 'report'; report: string; state: string; requestId: string; since: number; reports: number;
    /** The last report: the session stopped, or 24 hours passed. */
    final: boolean;
    stopped: boolean;
  };
  type WatchState = PollState | ReportState;
  const WorkerWatch = durable.defineTask<WatchInput, WatchState, null>({
    name: 'bot.worker-watch',
    version: 2,
    initial: (input) => ({ phase: 'poll', delayMs: pollMs.first, since: input.since, reports: 0 }),
    // Version 1 ended the watch at its one report, posted as `worker-report:<dispatch>`.
    migrate: (rawInput, rawCheckpoint) => {
      const input = rawInput as WatchInput;
      const old = rawCheckpoint as { phase: string; delayMs?: number; report?: string; state?: string };
      const checkpoint: WatchState = old.phase === 'report'
        ? { phase: 'report', report: String(old.report), state: String(old.state), requestId: `worker-report:${input.dispatchId}`,
            since: input.since, reports: 1, final: true, stopped: old.state === 'inactive' }
        : { phase: 'poll', delayMs: old.delayMs ?? pollMs.first, since: input.since, reports: 0 };
      return { input, checkpoint };
    },
    phases: {
      poll: async (task, runtime, taskContext) => {
        const { dispatchId, ref, name, startedAt } = task.input;
        const { delayMs, since, reports } = task.state.checkpoint as PollState;
        let settled: SettledWorker | null = null;
        let active: boolean | null = null;
        try {
          const resolved: unknown = JSON.parse(await sessions(['resolve', ref, '--json', '--fields', 'all']));
          const window: unknown = JSON.parse(await sessions(['show', ref, '--limit', '1', '--json']));
          const row = isRecord(resolved) ? resolved.session : null;
          settled = settledWorker(row, window, since);
          active = isRecord(row) && row.isActive === true;
        } catch (error) {
          // The hub may be restarting; a failed poll is retried, never reported.
          log(`watch ${name} (${ref}): ${error instanceof Error ? error.message : String(error)}`);
        }
        const expired = runtime.now() - startedAt > WATCH_GIVE_UP_MS;
        if (!settled && !expired) {
          const next = { phase: 'poll', delayMs: Math.min(Math.round(delayMs * 1.5), pollMs.max), since, reports } as const;
          return runtime.sleepUntil(runtime.now() + delayMs, next, taskContext);
        }
        const stopped = active === false;
        const number = reports + 1;
        const answered = settled && settled.state !== 'inactive' ? settled : null;
        const heading = answered?.state === 'waiting' ? 'is waiting for an answer'
          : answered ? (number === 1 ? 'finished' : 'finished another turn')
            : stopped ? (number === 1 ? 'stopped without a final answer' : 'has stopped')
              : 'is still working after 24 hours';
        const parts = [`[worker report] "${name}" (${ref}) ${heading}.`];
        if (answered) {
          parts.push(answered.text.length > REPORT_CHARS
            ? `${answered.text.slice(0, REPORT_CHARS)}\n[cut at ${REPORT_CHARS} characters; read the rest with sessions read ${ref}]`
            : answered.text || '(no text)');
        }
        if (stopped) parts.push('The session is closed; it is no longer watched.');
        else if (expired) parts.push('It has been watched for 24 hours and is no longer watched.');
        await runtime.commit(async (tx) => {
          const worker = (await tx.doc(MemoryDoc, runtime.conversationId)).workers[dispatchId];
          // The bot closed this worker itself, so it already has what it needs.
          if (stopped && worker?.closing) {
            const now = new Date().toISOString();
            worker.closedAt ??= now;
            worker.watchEndedAt = now;
            return { status: 'terminal', outcome: { status: 'completed', result: null } };
          }
          return {
            status: 'running',
            checkpoint: {
              phase: 'report', report: parts.join('\n\n'), state: settled?.state ?? 'working',
              requestId: `worker-report:${dispatchId}:${number}`, since: settled?.totalMessages ?? since, reports: number,
              final: stopped || expired, stopped,
            },
          };
        }, taskContext);
      },
      report: async (task, runtime, taskContext) => {
        const { dispatchId, ref, name } = task.input;
        const { report, state, requestId, since, reports, final, stopped } = task.state.checkpoint as ReportState;
        const handle = (await runtime.conversation(runtime.conversationId, taskContext))!;
        // The request id makes each report post once, also when a crash reruns the phase.
        await handle.submit({
          type: 'input', content: report, whenBusy: 'followUp', requestId,
          entry: { kind: ReportEntry, data: { dispatchId, ref, name, state, report: reports } },
        }, taskContext);
        await runtime.commit(async (tx) => {
          const worker = (await tx.doc(MemoryDoc, runtime.conversationId)).workers[dispatchId];
          const now = new Date().toISOString();
          if (worker) {
            worker.reports = reports;
            if (stopped) worker.closedAt ??= now;
            if (final) worker.watchEndedAt = now;
          }
          if (final) return { status: 'terminal', outcome: { status: 'completed', result: null } };
          // Back to watching: a later turn that adds messages is the next report.
          return { status: 'sleeping', until: runtime.now() + pollMs.first, checkpoint: { phase: 'poll', delayMs: pollMs.first, since, reports } };
        }, taskContext);
      },
    },
    abort: (_task, runtime, taskContext) =>
      runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), taskContext),
  });

  const text = (value: string) => ({ output: [{ type: 'text' as const, text: value }] });
  const refusal = (value: string) => ({ ...text(value), isError: true });

  const spawnWorker = durable.defineTool({
    name: 'spawn_worker',
    description: 'Start a pi-dish session that carries out one task on its own. Returns its ref at once; each answer it gives arrives later as a "[worker report]" message. Give it a complete brief: it knows nothing of this conversation.',
    parameters: obj({
      name: str({ description: 'Short name for the worker session' }),
      brief: str({ description: 'The complete task: goal, context, constraints, and what to report back' }),
      host: opt(str({ description: 'Fleet host to run on; omitted: this host' })),
      cwd: opt(str({ description: 'Working directory; omitted: the home directory' })),
      harness: opt(str({ description: 'pi (default), omp or agy' })),
      model: opt(str({ description: 'provider/model-id; omitted: the harness default' })),
      thinking: opt(str({ description: 'Thinking level for the worker' })),
    }),
    // A rerun finds its own dispatch id and never launches twice (below).
    replay: 'safe',
    execute: async (args, api, callContext) => {
      const dispatchId = await api.memo('dispatch', crypto.randomUUID(), callContext);
      type Spawned = { sessionId: string; harness: string };
      let spawned = await api.memo<Spawned>('spawned', callContext);
      if (!spawned) {
        if (await api.memo<boolean>('attempted', callContext)) {
          return refusal(`The launch of "${args.name}" (dispatch ${dispatchId.slice(0, 8)}) was cut off and its outcome is unknown, so it was not started again. Look for a session named "${args.name} · ${dispatchId.slice(0, 8)}" with the sessions tool before starting another.`);
        }
        await api.memo('attempted', true, callContext);
        const argv = ['spawn', '--json', '--name', `${args.name} · ${dispatchId.slice(0, 8)}`, '--harness', args.harness || 'pi',
          '--cwd', args.cwd || '~', '--prompt', args.brief];
        if (args.host) argv.push('--host', args.host);
        if (args.model) argv.push('--model', args.model);
        if (args.thinking) argv.push('--thinking-level', args.thinking);
        const result: unknown = JSON.parse(await sessions(argv));
        if (!isRecord(result) || typeof result.sessionId !== 'string') throw new Error('spawn returned no session id');
        spawned = await api.memo<Spawned>('spawned', {
          sessionId: result.sessionId, harness: String(result.harness ?? args.harness ?? 'pi'),
        }, callContext);
      }
      const { sessionId, harness } = spawned;
      // The short ref `list` shows: what the bot repeats to the user and watches by.
      const ref = `${args.host ? `${args.host}/` : ''}${stableSessionRef(sessionId)}`;
      await api.commit(async (tx) => {
        const memory = await tx.doc(MemoryDoc, api.conversationId);
        if (memory.workers[dispatchId]) return;
        memory.workers[dispatchId] = {
          name: args.name, ref, sessionId, harness, host: args.host ?? null, startedAt: new Date().toISOString(), reports: 0,
        };
        // A fresh spawn's transcript is empty, so any answer is its own.
        await tx.createTask(WorkerWatch, { dispatchId, ref, name: args.name, since: 0, startedAt: api.now() },
          { ownership: { kind: 'conversation' }, background: true });
      }, callContext);
      return text(`Started worker "${args.name}" (${harness}${args.host ? ` on ${args.host}` : ''}). Ref: ${ref}. Each answer it gives arrives as a "[worker report]" message.`);
    },
  });

  /** Closes a session this bot started; any other ref is refused. */
  async function closeWorker(wanted: string, api: Durable.ToolExecutionApi, callContext: Context): Promise<Durable.ToolExecutionResult> {
    const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
    const workers = Object.entries(memory?.workers ?? {});
    const found = workers.find(([, worker]) => wanted === worker.ref || wanted === worker.sessionId
      || (worker.host !== null && wanted === `${worker.host}/${worker.sessionId}`));
    if (!found) {
      const open = workers.filter(([, worker]) => !worker.closedAt).map(([, worker]) => worker.ref);
      return refusal(`Refused: ${wanted} is not a worker you started, and you can close only your own workers. Open workers: ${open.join(', ') || 'none'}.`);
    }
    const [dispatchId, worker] = found;
    const mark = (closing: boolean) => api.commit(async (tx) => {
      const draft = (await tx.doc(MemoryDoc, api.conversationId)).workers[dispatchId];
      if (closing) draft.closing = true;
      else delete draft.closing;
    }, callContext);
    // Marked first, so its watch, seeing the session stop, ends without reporting the close back.
    await mark(true);
    try {
      await sessions(['close', worker.ref]);
    } catch (error) {
      await mark(false);
      throw error;
    }
    await api.commit(async (tx) => {
      const draft = (await tx.doc(MemoryDoc, api.conversationId)).workers[dispatchId];
      draft.closedAt ??= new Date().toISOString();
    }, callContext);
    return text(`Closed worker "${worker.name}" (${worker.ref}).`);
  }

  const sessionsTool = durable.defineTool({
    name: 'sessions',
    description: 'pi-dish sessions and hosts: list live sessions, read a transcript, search every transcript, send a message to a session, close a worker you started, list the fleet\'s hosts, or show how busy each host is.',
    parameters: obj({
      action: oneOf(['list', 'read', 'search', 'send', 'close', 'hosts', 'load'] as const),
      ref: opt(str({ description: 'Session ref, for read, send and close' })),
      query: opt(str({ description: 'Search terms, for search' })),
      message: opt(str({ description: 'Text to send, for send' })),
      host: opt(str({ description: 'Limit list or search to one host' })),
      limit: opt(num({ description: 'Rows or messages to show' })),
    }),
    replay: 'unsafe',
    execute: async (args, api, callContext) => {
      const host = args.host ? ['--host', args.host] : [];
      const limit = args.limit ? ['--limit', String(Math.max(1, Math.floor(args.limit)))] : [];
      const need = (value: string | undefined, field: string): string => {
        if (!value) throw new Error(`${args.action} needs ${field}`);
        return value;
      };
      if (args.action === 'close') return closeWorker(need(args.ref, 'ref'), api, callContext);
      const argv = args.action === 'list' ? ['list', '--active', ...host, ...limit]
        : args.action === 'read' ? ['read', need(args.ref, 'ref'), ...limit]
          : args.action === 'search' ? ['search', need(args.query, 'query'), ...(args.host ? host : ['--all-hosts']), ...limit]
            : args.action === 'send' ? ['send', need(args.ref, 'ref'), need(args.message, 'message')]
              : [args.action];
      return text((await sessions(argv)).trim() || '(no output)');
    },
  });

  const contextNotes = durable.defineTool({
    name: 'context_notes',
    description: `Read or replace your notebook (at most ${NOTEBOOK_MAX_BYTES} bytes). It is the memory that carries over to a new context window. "write" replaces the whole notebook.`,
    parameters: obj({ action: oneOf(['read', 'write'] as const), text: opt(str()) }),
    replay: 'safe',
    execute: async (args, api, callContext) => {
      if (args.action === 'read') {
        const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
        return text(memory?.notebook || '(the notebook is empty)');
      }
      const notebook = args.text ?? '';
      const bytes = Buffer.byteLength(notebook, 'utf8');
      if (bytes > NOTEBOOK_MAX_BYTES) return refusal(`Not saved: ${bytes} bytes is over the ${NOTEBOOK_MAX_BYTES}-byte cap. Shorten it and write it again.`);
      await api.commit(async (tx) => {
        const memory = await tx.doc(MemoryDoc, api.conversationId);
        memory.notebook = notebook;
        memory.notebookSavedIn = memory.windows.length;
      }, callContext);
      return text(`Saved (${bytes} of ${NOTEBOOK_MAX_BYTES} bytes). Your instructions show it from the next window on.`);
    },
  });

  const newContext = durable.defineTool({
    name: 'new_context',
    description: 'Close this context window and continue in a fresh one that holds your identity, your saved notebook, the end of this conversation, the latest request and your running workers. Nothing else carries over; earlier windows stay readable with history.',
    parameters: obj({ summary: str({ description: 'One line saying what this window covered' }) }),
    replay: 'safe',
    execute: async (args, api, callContext) => {
      const window = await currentWindow(Number.MAX_SAFE_INTEGER);
      const outcome: { refused: string } | { handoff: string } = await api.commit(async (tx) => {
        const memory = await tx.doc(MemoryDoc, api.conversationId);
        const refused = newContextRefusal(memory, window.some(isWork));
        if (refused) return { refused };
        return { handoff: await rollover(tx, api.conversationId, args.summary, false, window) };
      }, callContext);
      if ('refused' in outcome) return refusal(outcome.refused);
      return { ...text('A new context window starts with the next request.'), control: { handoff: outcome.handoff } };
    },
  });

  const history = durable.defineTool({
    name: 'history',
    description: 'Your earlier context windows: "windows" lists them, "read" shows one (numbered from 1; the current one is the last), "search" finds text in all of them.',
    parameters: obj({
      action: oneOf(['windows', 'read', 'search'] as const),
      window: opt(num()),
      query: opt(str()),
      offset: opt(num({ description: 'For read: messages to skip' })),
    }),
    replay: 'safe',
    execute: async (args, api, callContext) => {
      const windows = await allWindows();
      const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
      const lines = (entries: readonly Durable.EntryRecord[]) => entries.flatMap(entry => {
        const message = entryMessage(entry);
        const body = messageText(message).trim();
        if (!body || entry.kind === 'pi.system') return [];
        const role = entry.kind === ReportEntry ? 'report' : entry.kind === 'pi.reset' ? 'handoff' : String(message?.role ?? entry.kind);
        return [`[${role}] ${body}`];
      });
      if (args.action === 'windows') {
        return text(windows.map((entries, index) => {
          const closed = memory?.windows[index];
          return `${index + 1}. ${closed ? closed.line : '(current window)'} — ${lines(entries).length} messages`;
        }).join('\n'));
      }
      if (args.action === 'read') {
        const number = Math.floor(args.window ?? windows.length);
        const entries = windows[number - 1];
        if (!entries) return refusal(`There is no window ${number}; there are ${windows.length}.`);
        const all = lines(entries);
        const offset = Math.max(0, Math.floor(args.offset ?? 0));
        const page = all.slice(offset, offset + 40);
        const more = offset + page.length < all.length ? `\n[${all.length - offset - page.length} more; read again with offset ${offset + page.length}]` : '';
        return text(`Window ${number}, messages ${offset + 1}–${offset + page.length} of ${all.length}:\n\n${page.join('\n\n')}${more}`);
      }
      const query = (args.query ?? '').trim().toLowerCase();
      if (!query) return refusal('search needs a query');
      const hits: string[] = [];
      windows.forEach((entries, index) => {
        for (const line of lines(entries)) {
          const at = line.toLowerCase().indexOf(query);
          if (at < 0 || hits.length >= 20) continue;
          hits.push(`window ${index + 1}: …${line.slice(Math.max(0, at - 120), at + query.length + 200).replace(/\s+/g, ' ')}…`);
        }
      });
      return text(hits.length ? hits.join('\n') : `No match for "${args.query}".`);
    },
  });

  const kbSearch = durable.defineTool({
    name: 'kb_search',
    description: 'Search the shared knowledge base: pages holding every term (case-insensitive), with their matching lines.',
    parameters: obj({ query: str({ description: 'Search terms' }) }),
    replay: 'safe',
    execute: async (args) => {
      const found = await hub(`/api/knowledge/search?q=${encodeURIComponent(args.query)}`) as KnowledgeSearch;
      if (!found.results.length) return text(`Nothing in the knowledge base matches "${args.query}".`);
      const pages = found.results.map(hit => [hit.path, ...hit.lines.map(line => `  ${line.line}: ${line.text}`)].join('\n'));
      const more = found.total > found.results.length ? `\n\n[${found.total - found.results.length} more pages match; add a term to narrow it]` : '';
      return text(`${pages.join('\n\n')}${more}`);
    },
  });

  const kbRead = durable.defineTool({
    name: 'kb_read',
    description: 'Read a knowledge base page, or the index (one line per page) when no page is named.',
    parameters: obj({ page: opt(str({ description: 'Page name, such as "beelink" or "topics/beelink.md"; omitted: the index' })) }),
    replay: 'safe',
    execute: async (args) => {
      const page = await hub(`/api/knowledge/page${args.page ? `?page=${encodeURIComponent(args.page)}` : ''}`) as { path: string; text: string };
      return text(`${page.path}:\n\n${page.text}`);
    },
  });

  const kbWrite = durable.defineTool({
    name: 'kb_write',
    description: 'Write to the shared knowledge base. "append" (the default) adds one entry, a short paragraph or bullet, to a page and creates the page when it is new; the date and your name are added for you. "replace" rewrites a whole page, for tidying it: keep each entry\'s source and date.',
    parameters: obj({
      page: str({ description: 'Page name: lowercase words joined by hyphens, one page per topic, such as "beelink" or "backups"' }),
      text: str({ description: 'The entry, or the whole page for replace' }),
      source: opt(str({ description: 'Where the fact comes from: a command and host, a file, a URL, a worker\'s report. Required for append' })),
      mode: opt(oneOf(['append', 'replace'] as const)),
      title: opt(str({ description: 'Title of a new page; omitted: the page name' })),
    }),
    // A rerun could add the entry twice.
    replay: 'unsafe',
    execute: async (args) => {
      const written = await hub('/api/knowledge/pages', {
        page: args.page, mode: args.mode ?? 'append', text: args.text, author: options.loadBot().name,
        ...(args.source ? { source: args.source } : {}), ...(args.title ? { title: args.title } : {}),
      }) as KnowledgeWriteResult;
      const pushed = written.pushed ? '' : ` It is not on the remote yet (${written.pushError ?? 'push failed'}); the next write pushes it.`;
      return text(`${written.commit ? 'Saved' : 'Unchanged'}: ${written.path}${written.created ? ' (a new page, added to the index)' : ''}.${pushed}`);
    },
  });

  const reminder = durable.hook(durable.GenerationTask, {
    beforeRequest: (request) => {
      const last = [...request.messages].reverse().find(message => message.role === 'assistant');
      const used = usageTokens(last);
      if (used < REMINDER_RATIO * windowLimit) return undefined;
      const percent = Math.round(used / windowLimit * 100);
      // For this request only: the stored transcript, and the cached prefix, are unchanged.
      const note: Message = {
        role: 'user',
        content: `[pi-dish: this context window is ${percent}% full. Save your notebook with context_notes and call new_context at the next natural break; at ${Math.round(FORCED_RATIO * 100)}% the window is closed for you.]`,
        timestamp: Date.now(),
      };
      return { messages: [...request.messages, note] };
    },
  });

  const BotExtension = durable.defineExtension({
    name: 'bot',
    sections: [durable.section('bot-rules', () => PREAMBLE, { tag: false })],
    tools: [spawnWorker, sessionsTool, contextNotes, newContext, history, kbSearch, kbRead, kbWrite],
    tasks: [WorkerWatch],
    hooks: [reminder],
  });
  const registry = durable.createRegistry();
  registry.install(BotExtension);

  fs.mkdirSync(path.dirname(options.storageFile), { recursive: true });
  const harness = await durable.Harness.open(await openNodeSqliteStorage(options.storageFile), {
    models: options.models,
    registry,
    // Nothing is summarised: a bot rolls its window over instead.
    settings: { compaction: { enabled: false } },
    onReport: (report) => log(`durable ${report.kind}: ${report.error instanceof Error ? report.error.message : String(report.error)}`),
  }, ctx);
  root = await harness.root(ctx, {
    agent: {
      model: modelRef,
      ...(bot.thinking ? { thinkingLevel: bot.thinking as Durable.AgentChange['thinkingLevel'] } : {}),
      instructions: composeInstructions(bot.identity, ''),
    },
  });
  // The model is the user's choice in the registry; the instructions stay those of the open window.
  const agent = await root.agent(ctx);
  if (agent.model?.provider !== modelRef.provider || agent.model?.modelId !== modelRef.modelId) {
    await root.configure({ model: modelRef }, ctx);
  }
  harness.resume();

  // Event mapping --------------------------------------------------------------

  let busy = false;
  let processed = mirror.lastEntryId;
  let streaming = false;
  let lastUsage = 0;
  let lastModel = '';
  let lastFailure = -1;
  const calls = new Map<string, { name: string; args: unknown }>();
  const running = new Map<string, { output: string; startedAt: number }>();

  function startTool(callId: string, name: string): { output: string; startedAt: number } {
    let slot = running.get(callId);
    if (!slot) {
      slot = { output: '', startedAt: Date.now() };
      running.set(callId, slot);
      emit('tool_execution_start', { toolCallId: callId, toolName: name, args: calls.get(callId)?.args ?? {}, startedAt: slot.startedAt });
    }
    return slot;
  }

  function show(entry: Durable.EntryRecord): void {
    processed = Math.max(processed, entry.id);
    const message = entryMessage(entry);
    if (!message) return;
    if (entry.kind === 'pi.user') {
      mirror.appendMessage(entry.id, message);
      emit('message_start', { message });
      emit('message_end', { message });
    } else if (entry.kind === ReportEntry || entry.kind === 'pi.reset') {
      const customType = entry.kind === ReportEntry ? 'bot-worker-report' : 'bot-context-window';
      const details = isRecord(entry.data) ? entry.data : undefined;
      mirror.appendCustom(entry.id, customType, messageText(message), details);
      emit('message_end', { message: { role: 'custom', customType, content: [{ type: 'text', text: messageText(message) }], display: true, timestamp: Date.now() } });
    } else if (entry.kind === 'pi.assistant') {
      const selector = `${String(message.provider ?? '')}/${String(message.model ?? '')}`;
      if (message.provider && message.model && selector !== lastModel) {
        lastModel = selector;
        mirror.appendModelChange(entry.id, String(message.provider), String(message.model));
      }
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (isRecord(part) && part.type === 'toolCall' && typeof part.id === 'string') calls.set(part.id, { name: String(part.name), args: part.arguments });
        }
      }
      lastUsage = usageTokens(message) || lastUsage;
      mirror.appendMessage(entry.id, message);
      if (!streaming) emit('message_start', { message });
      streaming = false;
      emit('message_end', { message });
    } else if (entry.kind === 'pi.tool-result') {
      const callId = String(message.toolCallId);
      const name = String(message.toolName);
      mirror.appendMessage(entry.id, message);
      const slot = startTool(callId, name);
      running.delete(callId);
      emit('tool_execution_end', {
        toolCallId: callId, toolName: name, args: calls.get(callId)?.args ?? {}, startedAt: slot.startedAt,
        isError: message.isError === true, result: { content: message.content },
      });
      calls.delete(callId);
    }
  }

  function showLive(live: LiveView): void {
    const partial = live.generation?.message;
    if (partial && Array.isArray(partial.content) && partial.content.length) {
      if (!streaming) emit('message_start', { message: partial });
      streaming = true;
      emit('message_update', { message: partial });
    }
    for (const slot of live.tools ?? []) {
      if (slot.status === 'pending') continue;
      const tracked = startTool(slot.callId, slot.name);
      if (slot.output && slot.output !== tracked.output) {
        tracked.output = slot.output;
        emit('tool_execution_update', {
          toolCallId: slot.callId, toolName: slot.name, args: calls.get(slot.callId)?.args ?? {}, startedAt: tracked.startedAt,
          partialResult: { content: [{ type: 'text', text: slot.output }] },
        });
      }
    }
  }

  async function catchUp(through: number): Promise<void> {
    let cursor: Durable.Cursor | undefined;
    do {
      const page = await conversation().entries({ minEntryId: (processed + 1) as Durable.EntryId, maxEntryId: through as Durable.EntryId, order: 'ascending' }, 200, cursor, ctx);
      for (const entry of page.items) if (entry.id > processed) show(entry);
      cursor = page.next;
    } while (cursor);
  }

  async function forceRolloverIfFull(): Promise<void> {
    if (lastUsage < FORCED_RATIO * windowLimit) return;
    const window = await currentWindow(Number.MAX_SAFE_INTEGER);
    const handoff = await conversation().commit(tx => rollover(tx, conversation().id, 'Closed at the context limit.', true, window), ctx);
    await conversation().reset(handoff, ctx);
    lastUsage = 0;
    log('rolled the context window over at the limit');
  }

  async function onView(view: Durable.ConversationView): Promise<void> {
    const live = liveOf(view);
    const busyNow = live.run !== undefined;
    if (busyNow && !busy) {
      busy = true;
      emit('agent_start', {});
      emit('turn_start', {});
    }
    if (view.before !== undefined && view.before > processed) await catchUp(view.before);
    for (const entry of view.entries) if (entry.id > processed) show(entry);
    if (busyNow) showLive(live);
    else if (busy) {
      busy = false;
      streaming = false;
      running.clear();
      const failure = live.runFailure;
      if (failure && failure.taskId !== lastFailure) {
        lastFailure = failure.taskId;
        const errorMessage = `${failure.reason}${failure.detail ? `: ${failure.detail}` : ''}`;
        mirror.appendRunFailure(processed, failure.taskId, errorMessage, { provider: modelRef.provider, id: modelRef.modelId });
        emit('message_end', { message: { role: 'assistant', content: [], stopReason: 'error', errorMessage, provider: modelRef.provider, model: modelRef.modelId, timestamp: Date.now() } });
      }
      emit('turn_end', {});
      emit('agent_end', {});
      try { await forceRolloverIfFull(); } catch (error) { log(`forced rollover failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    options.changed();
  }

  const watch = await root.watch(ctx, { from: (processed + 1) as Durable.EntryId, min: 50, max: 1000 });
  watch.start(async (call) => {
    if (call.kind !== 'value') return;
    try { await onView(call.value); } catch (error) {
      log(`view mapping failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return {
    get busy() { return busy; },
    get model() { return bot.model; },
    contextUsage() {
      if (!lastUsage) return null;
      return { tokens: lastUsage, contextWindow: windowLimit, percent: Math.round(lastUsage / windowLimit * 1000) / 10 };
    },
    async prompt(message, mode) {
      if (!busy) await forceRolloverIfFull();
      await conversation().submit({ type: 'input', content: message, whenBusy: mode }, ctx);
    },
    abort: () => conversation().abort(ctx),
    async close() {
      await watch.stop();
      await harness.close(ctx);
    },
  };
}

export type { AssistantMessage };
