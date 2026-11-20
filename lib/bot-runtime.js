// Generated from src/core/bot-runtime.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORK_SEED = exports.FORCED_RATIO = exports.REMINDER_RATIO = exports.WINDOW_TOKEN_CAP = exports.NOTEBOOK_MAX_BYTES = void 0;
exports.messageText = messageText;
exports.settledWorker = settledWorker;
exports.newContextRefusal = newContextRefusal;
exports.composeInstructions = composeInstructions;
exports.composeHandoff = composeHandoff;
exports.composePurpose = composePurpose;
exports.openBotModels = openBotModels;
exports.openBotRuntime = openBotRuntime;
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
const crypto = require("crypto");
const fs = require("fs");
const nodeModule = require("module");
const path = require("path");
const url = require("url");
const esbuild = require("esbuild");
const helper_values_1 = require("./helper-values");
const helper_refs_1 = require("./helper-refs");
/** The notebook's cap, in UTF-8 bytes. */
exports.NOTEBOOK_MAX_BYTES = 16 * 1024;
/** A window is sized to this many tokens even on a model with a larger context. */
exports.WINDOW_TOKEN_CAP = 200_000;
/** From this share of the window on, each request carries a reminder to roll over. */
exports.REMINDER_RATIO = 0.75;
/** At this share the relay rolls the window over itself once the run ends. */
exports.FORCED_RATIO = 0.9;
const MEMORY_TOOLS = { context_notes: true, new_context: true, history: true };
const TAIL_MESSAGES = 8;
const TAIL_MESSAGE_CHARS = 2000;
const REPORT_CHARS = 8000;
const WATCH_FIRST_POLL_MS = 5_000;
const WATCH_MAX_POLL_MS = 60_000;
/** A worker still running after this long is reported as such and no longer watched. */
const WATCH_GIVE_UP_MS = 24 * 60 * 60_000;
/** Text blocks of a Pi message, joined; tool calls and thinking are left out. */
function messageText(message) {
    if (!(0, helper_values_1.record)(message))
        return '';
    if (typeof message.content === 'string')
        return message.content;
    if (!Array.isArray(message.content))
        return '';
    return message.content
        .flatMap((part) => (0, helper_values_1.record)(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])
        .join('\n');
}
/**
 * The settle rule `pi-dish-sessions wait` uses: a worker has settled when it is
 * not working or compacting, its transcript holds more than `since` messages,
 * and its newest message is not the user's (a prompt not picked up yet). A
 * pending question counts as settled. `session` is the resolve row; `window` is
 * `/messages?limit=1`. Null means keep waiting.
 */
function settledWorker(session, window, since) {
    const row = (0, helper_values_1.record)(session) ? session : {};
    const page = (0, helper_values_1.record)(window) ? window : {};
    const totalMessages = Number(page.totalMessages) || 0;
    const messages = Array.isArray(page.messages) ? page.messages : [];
    const last = messages.at(-1);
    const busy = row.turnInProgress === true || row.compacting === true;
    if (!busy && totalMessages > since) {
        if (row.askPending === true)
            return { state: 'waiting', totalMessages, text: messageText(last) };
        if ((0, helper_values_1.record)(last) && last.role !== 'user')
            return { state: 'finished', totalMessages, text: messageText(last) };
    }
    if (row.isActive !== true)
        return { state: 'inactive', totalMessages, text: messageText(last) };
    return null;
}
/**
 * Version 1 workers kept the long ref and a `reportedAt`: their watch ended at
 * the one report, though the session may still be open.
 */
function migrateWorkers(value) {
    const workers = {};
    for (const [dispatchId, raw] of Object.entries((0, helper_values_1.record)(value) ? value : {})) {
        const old = raw;
        const prefix = old.host ? `${old.host}/` : '';
        const sessionId = prefix && old.ref.startsWith(prefix) ? old.ref.slice(prefix.length) : old.ref;
        workers[dispatchId] = {
            name: old.name, ref: `${prefix}${(0, helper_refs_1.stableSessionRef)(sessionId)}`, sessionId, harness: old.harness, host: old.host,
            startedAt: old.startedAt, reports: old.reportedAt ? 1 : 0, ...(old.reportedAt ? { watchEndedAt: old.reportedAt } : {}),
        };
    }
    return workers;
}
/** Why `new_context` is refused, or null when it may run. */
function newContextRefusal(memory, workSinceRollover) {
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
function composeInstructions(identity, notebook, places = []) {
    return [
        '<identity>', identity.trim(), '</identity>',
        ...(places.length ? ['', '<places>', ...places.map(place => `- ${place.label}: ${place.host ? `${place.host}:` : ''}${place.cwd}`), '</places>'] : []),
        '',
        '<notebook>', notebook.trim() || '(empty: nothing written down yet)', '</notebook>',
    ].join('\n');
}
/**
 * The first message of a new window: what the bot needs that its notebook does not hold. The latest request is
 * shown with what became of it: a rollover the bot made while handling it is done, and must not be read as a request
 * to roll over again.
 */
function composeHandoff({ windowNumber, closed, tail, request, workers, forced }) {
    const lines = [`[Context window ${windowNumber}. Your identity and notebook are in your instructions; earlier windows are readable with the history tool.]`];
    if (closed.length) {
        lines.push('', 'Earlier windows:');
        closed.forEach((window, index) => lines.push(`${index + 1}. ${window.line}${window.forced ? ' (closed at the context limit)' : ''}`));
    }
    if (tail.length) {
        lines.push('', 'The end of the last window:');
        for (const message of tail)
            lines.push(`${message.role}: ${message.text}`);
    }
    lines.push('', `Latest request: ${request ?? '(none)'}`);
    if (request !== null) {
        lines.push(forced
            ? 'It was answered in the last window, which was then closed at the context limit.'
            : 'You opened this window with new_context while handling it, and that call is done: this is the new window. Do not call new_context again for it; carry on with whatever else it asks, or tell the user the new window is open.');
    }
    lines.push('', workers.length ? 'Workers you started that are still open (each new answer arrives as a report):' : 'No workers are open.');
    for (const worker of workers)
        lines.push(`- ${worker.name}: ${worker.ref} (${worker.harness}${worker.host ? ` on ${worker.host}` : ''}, started ${worker.startedAt}${worker.watchEndedAt ? ', no longer watched' : ''})`);
    return lines.join('\n');
}
/** A sub-bot's start, written by its parent into the sub-bot's directory and read once by its first relay. */
exports.FORK_SEED = 'fork.json';
/** A sub-bot's first message: its purpose, and that the conversation above it is its parent's. */
function composePurpose(parent, child, purpose) {
    return [
        `[pi-dish: you are "${child}", a new bot that ${parent} created just now as its sub-bot. Everything above is ${parent}'s conversation up to that moment. Its requests, its workers and its tool calls are ${parent}'s, not yours: do not continue or repeat any of them. You have no workers; reports from ${parent}'s workers go to ${parent} only.`,
        `You keep ${parent}'s identity until your first new context window, which brings your own identity and an empty notebook of your own. Open it soon: until you do, every request carries ${parent}'s whole conversation. Within your first few turns, write what you need to keep into your notebook with context_notes and call new_context.]`,
        '',
        `Your purpose, from ${parent}:`,
        purpose.trim(),
    ].join('\n');
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
    '',
    'Bots: bot_update changes your own entry or a sub-bot\'s (name, identity, places, thinking); the user sees each change',
    'and can undo it, and only the user changes your own model. bot_create makes a sub-bot for a narrower area. Your',
    'family (your parent, your sub-bots and theirs) shares a room: room_post wakes only the bots you name, room_read shows',
    'the recent messages. ask_bot puts one question to a bot in another family; its answer arrives once as a message. A',
    'chain of bot messages is capped at a few hops, so post only what needs an answer and never just to acknowledge.',
].join('\n');
let claudeCode = null;
/**
 * pi-claude-code ships TypeScript source with `.ts` specifiers and a parameter
 * property, which Node's type stripping refuses inside node_modules. A load
 * hook transpiles exactly that package's sources; everything they import, pi-ai
 * included, loads natively and is shared with pi-durable.
 */
function loadClaudeCode() {
    claudeCode ??= (async () => {
        const root = path.dirname(require.resolve('@earendil-works/pi-claude-code/package.json'));
        const sources = url.pathToFileURL(path.join(root, 'src') + path.sep).href;
        nodeModule.registerHooks({
            load(specifier, context, nextLoad) {
                if (!specifier.startsWith(sources) || !specifier.endsWith('.ts'))
                    return nextLoad(specifier, context);
                const file = url.fileURLToPath(specifier);
                const { code } = esbuild.transformSync(fs.readFileSync(file, 'utf8'), {
                    loader: 'ts', format: 'esm', target: 'node22', sourcefile: file,
                });
                return { format: 'module', source: code, shortCircuit: true };
            },
        });
        // The package has no type declarations a CommonJS program can resolve.
        const provider = await import(`${sources}provider.ts`);
        const cli = await import(`${sources}claude-cli.ts`);
        return { createClaudeCodeProvider: provider.createClaudeCodeProvider, closeClaudeProcesses: cli.closeClaudeProcesses };
    })();
    return claudeCode;
}
/**
 * `claude-code/<id>` runs on the Claude subscription through the Claude Code
 * CLI; anything else goes through Pi's model runtime and its credentials.
 */
async function openBotModels(selector) {
    const provider = selector.slice(0, selector.indexOf('/'));
    if (provider === 'claude-code') {
        const pcc = await loadClaudeCode();
        const { createModels } = await import('@earendil-works/pi-ai/models');
        const models = createModels();
        models.setProvider(pcc.createClaudeCodeProvider());
        return { models, close: () => pcc.closeClaudeProcesses() };
    }
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
    return { models: await ModelRuntime.create(), close: async () => { } };
}
function liveOf(view) {
    const live = view.docs['pi.live'];
    return (0, helper_values_1.record)(live) ? live : {};
}
function usageTokens(message) {
    if (!(0, helper_values_1.record)(message) || !(0, helper_values_1.record)(message.usage))
        return 0;
    const usage = message.usage;
    return ['input', 'output', 'cacheRead', 'cacheWrite']
        .reduce((sum, key) => sum + (typeof usage[key] === 'number' ? usage[key] : 0), 0);
}
/** The entry's message; string content becomes a text block, as Pi transcripts hold it. */
function entryMessage(entry) {
    const message = entry.model?.[0];
    if (!(0, helper_values_1.record)(message))
        return null;
    return typeof message.content === 'string' ? { ...message, content: [{ type: 'text', text: message.content }] } : message;
}
async function openBotRuntime(options) {
    // ES modules needing node:sqlite: imported when a bot opens, never when this CommonJS module loads.
    const durable = await import('@earendil-works/pi-durable');
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    const schema = await import('@earendil-works/pi-schema');
    const { obj, opt, str, num, oneOf, arr } = schema;
    const { bot, mirror, sessions, api: hub, emit, log } = options;
    const ctx = BACKGROUND_CONTEXT;
    const pollMs = options.pollMs ?? { first: WATCH_FIRST_POLL_MS, max: WATCH_MAX_POLL_MS };
    const slash = bot.model.indexOf('/');
    const modelRef = { provider: bot.model.slice(0, slash), modelId: bot.model.slice(slash + 1) };
    const modelInfo = options.models.getModel(modelRef.provider, modelRef.modelId);
    const windowLimit = Math.min(modelInfo?.contextWindow || exports.WINDOW_TOKEN_CAP, exports.WINDOW_TOKEN_CAP);
    const MemoryDoc = durable.defineDoc({
        kind: 'bot.memory',
        version: 2,
        scope: 'conversation',
        history: 'latest',
        fork: 'current',
        initial: () => ({ notebook: '', notebookSavedIn: -1, windows: [], workers: {} }),
        migrate: (value) => ({ ...value, workers: migrateWorkers(value.workers) }),
        checkpointWhen: () => true,
    });
    const ReportEntry = 'bot.report';
    /** Entries that start a run: what a change made in the run is attributed to. */
    const INPUT_KINDS = {
        'pi.user': true, [ReportEntry]: true, 'bot.room': true, 'bot.ask': true, 'bot.answer': true, 'bot.purpose': true,
    };
    /** Inputs from other bots: a turn they wake continues their chain one hop on. */
    const CHAINED_KINDS = { 'bot.room': true, 'bot.ask': true, 'bot.answer': true };
    /** Entries the transcript shows as notices rather than as the user's words. */
    const CUSTOM_TYPES = {
        [ReportEntry]: 'bot-worker-report', 'pi.reset': 'bot-context-window', 'bot.room': 'bot-room', 'bot.ask': 'bot-question',
        'bot.answer': 'bot-answer', 'bot.purpose': 'bot-purpose',
    };
    const roleOf = (kind) => kind === 'pi.assistant' ? 'assistant' : kind === 'pi.user' ? 'user' : kind === 'pi.reset' ? 'handoff' : kind.replace(/^bot\./, '');
    /** Questions from other families this bot has answered, so each answer goes back once. */
    const AsksDoc = durable.defineDoc({
        kind: 'bot.asks', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
        initial: () => ({ answered: {} }), checkpointWhen: () => true,
    });
    let root = null;
    const conversation = () => {
        if (!root)
            throw new Error('the bot conversation is not open yet');
        return root;
    };
    /** Entries from the newest reset (exclusive) to the end, newest first, up to `limit`. */
    async function currentWindow(limit) {
        const found = [];
        let cursor;
        do {
            const page = await conversation().entries({ order: 'descending' }, 200, cursor, ctx);
            for (const entry of page.items) {
                if (entry.kind === 'pi.reset')
                    return found;
                found.push(entry);
                if (found.length >= limit)
                    return found;
            }
            cursor = page.next;
        } while (cursor);
        return found;
    }
    /** Every entry, oldest first, split into windows at each reset. */
    async function allWindows() {
        const windows = [[]];
        let cursor;
        do {
            const page = await conversation().entries({ order: 'ascending' }, 500, cursor, ctx);
            for (const entry of page.items) {
                if (entry.kind === 'pi.reset')
                    windows.push([]);
                windows.at(-1).push(entry);
            }
            cursor = page.next;
        } while (cursor);
        return windows;
    }
    function isWork(entry) {
        if (Object.hasOwn(INPUT_KINDS, entry.kind))
            return true;
        const message = entryMessage(entry);
        return entry.kind === 'pi.tool-result' && !!message && !Object.hasOwn(MEMORY_TOOLS, String(message.toolName));
    }
    /** Closes the current window and fixes the next one's instructions; returns its handoff. */
    async function rollover(tx, conversationId, line, forced, window) {
        const memory = await tx.doc(MemoryDoc, conversationId);
        memory.windows.push({ line: line.trim().slice(0, 300) || '(no summary)', closedAt: new Date().toISOString(), forced });
        const current = options.loadBot();
        await durable.configure(tx, conversationId, {
            instructions: composeInstructions(current.identity, memory.notebook, current.places),
            thinkingLevel: current.thinking ? current.thinking : null,
        });
        const tail = window
            .filter(entry => Object.hasOwn(INPUT_KINDS, entry.kind) || entry.kind === 'pi.assistant')
            .map(entry => ({ role: roleOf(entry.kind), text: messageText(entryMessage(entry)).trim() }))
            .filter(message => message.text)
            .slice(0, TAIL_MESSAGES)
            .reverse()
            .map(message => ({ ...message, text: message.text.length > TAIL_MESSAGE_CHARS ? `${message.text.slice(0, TAIL_MESSAGE_CHARS)}…` : message.text }));
        const request = window.find(entry => Object.hasOwn(INPUT_KINDS, entry.kind));
        return composeHandoff({
            windowNumber: memory.windows.length + 1,
            closed: memory.windows,
            tail,
            request: request ? messageText(entryMessage(request)) : null,
            workers: Object.values(memory.workers).filter(worker => !worker.closedAt),
            forced,
        });
    }
    const WorkerWatch = durable.defineTask({
        name: 'bot.worker-watch',
        version: 2,
        initial: (input) => ({ phase: 'poll', delayMs: pollMs.first, since: input.since, reports: 0 }),
        // Version 1 ended the watch at its one report, posted as `worker-report:<dispatch>`.
        migrate: (rawInput, rawCheckpoint) => {
            const input = rawInput;
            const old = rawCheckpoint;
            const checkpoint = old.phase === 'report'
                ? { phase: 'report', report: String(old.report), state: String(old.state), requestId: `worker-report:${input.dispatchId}`,
                    since: input.since, reports: 1, final: true, stopped: old.state === 'inactive' }
                : { phase: 'poll', delayMs: old.delayMs ?? pollMs.first, since: input.since, reports: 0 };
            return { input, checkpoint };
        },
        phases: {
            poll: async (task, runtime, taskContext) => {
                const { dispatchId, ref, name, startedAt } = task.input;
                const { delayMs, since, reports } = task.state.checkpoint;
                let settled = null;
                let active = null;
                try {
                    const resolved = JSON.parse(await sessions(['resolve', ref, '--json', '--fields', 'all']));
                    const window = JSON.parse(await sessions(['show', ref, '--limit', '1', '--json']));
                    const row = (0, helper_values_1.record)(resolved) ? resolved.session : null;
                    settled = settledWorker(row, window, since);
                    active = (0, helper_values_1.record)(row) && row.isActive === true;
                }
                catch (error) {
                    // The hub may be restarting; a failed poll is retried, never reported.
                    log(`watch ${name} (${ref}): ${error instanceof Error ? error.message : String(error)}`);
                }
                const expired = runtime.now() - startedAt > WATCH_GIVE_UP_MS;
                if (!settled && !expired) {
                    const next = { phase: 'poll', delayMs: Math.min(Math.round(delayMs * 1.5), pollMs.max), since, reports };
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
                if (stopped)
                    parts.push('The session is closed; it is no longer watched.');
                else if (expired)
                    parts.push('It has been watched for 24 hours and is no longer watched.');
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
                const { report, state, requestId, since, reports, final, stopped } = task.state.checkpoint;
                const handle = (await runtime.conversation(runtime.conversationId, taskContext));
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
                        if (stopped)
                            worker.closedAt ??= now;
                        if (final)
                            worker.watchEndedAt = now;
                    }
                    if (final)
                        return { status: 'terminal', outcome: { status: 'completed', result: null } };
                    // Back to watching: a later turn that adds messages is the next report.
                    return { status: 'sleeping', until: runtime.now() + pollMs.first, checkpoint: { phase: 'poll', delayMs: pollMs.first, since, reports } };
                }, taskContext);
            },
        },
        abort: (_task, runtime, taskContext) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), taskContext),
    });
    const text = (value) => ({ output: [{ type: 'text', text: value }] });
    const refusal = (value) => ({ ...text(value), isError: true });
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
            let spawned = await api.memo('spawned', callContext);
            if (!spawned) {
                if (await api.memo('attempted', callContext)) {
                    return refusal(`The launch of "${args.name}" (dispatch ${dispatchId.slice(0, 8)}) was cut off and its outcome is unknown, so it was not started again. Look for a session named "${args.name} · ${dispatchId.slice(0, 8)}" with the sessions tool before starting another.`);
                }
                await api.memo('attempted', true, callContext);
                const argv = ['spawn', '--json', '--name', `${args.name} · ${dispatchId.slice(0, 8)}`, '--harness', args.harness || 'pi',
                    '--cwd', args.cwd || '~', '--prompt', args.brief];
                if (args.host)
                    argv.push('--host', args.host);
                if (args.model)
                    argv.push('--model', args.model);
                if (args.thinking)
                    argv.push('--thinking-level', args.thinking);
                const result = JSON.parse(await sessions(argv));
                if (!(0, helper_values_1.record)(result) || typeof result.sessionId !== 'string')
                    throw new Error('spawn returned no session id');
                spawned = await api.memo('spawned', {
                    sessionId: result.sessionId, harness: String(result.harness ?? args.harness ?? 'pi'),
                }, callContext);
            }
            const { sessionId, harness } = spawned;
            // The short ref `list` shows: what the bot repeats to the user and watches by.
            const ref = `${args.host ? `${args.host}/` : ''}${(0, helper_refs_1.stableSessionRef)(sessionId)}`;
            await api.commit(async (tx) => {
                const memory = await tx.doc(MemoryDoc, api.conversationId);
                if (memory.workers[dispatchId])
                    return;
                memory.workers[dispatchId] = {
                    name: args.name, ref, sessionId, harness, host: args.host ?? null, startedAt: new Date().toISOString(), reports: 0,
                };
                // A fresh spawn's transcript is empty, so any answer is its own.
                await tx.createTask(WorkerWatch, { dispatchId, ref, name: args.name, since: 0, startedAt: api.now() }, { ownership: { kind: 'conversation' }, background: true });
            }, callContext);
            return text(`Started worker "${args.name}" (${harness}${args.host ? ` on ${args.host}` : ''}). Ref: ${ref}. Each answer it gives arrives as a "[worker report]" message.`);
        },
    });
    /** Closes a session this bot started; any other ref is refused. */
    async function closeWorker(wanted, api, callContext) {
        const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
        const workers = Object.entries(memory?.workers ?? {});
        const found = workers.find(([, worker]) => wanted === worker.ref || wanted === worker.sessionId
            || (worker.host !== null && wanted === `${worker.host}/${worker.sessionId}`));
        if (!found) {
            const open = workers.filter(([, worker]) => !worker.closedAt).map(([, worker]) => worker.ref);
            return refusal(`Refused: ${wanted} is not a worker you started, and you can close only your own workers. Open workers: ${open.join(', ') || 'none'}.`);
        }
        const [dispatchId, worker] = found;
        const mark = (closing) => api.commit(async (tx) => {
            const draft = (await tx.doc(MemoryDoc, api.conversationId)).workers[dispatchId];
            if (closing)
                draft.closing = true;
            else
                delete draft.closing;
        }, callContext);
        // Marked first, so its watch, seeing the session stop, ends without reporting the close back.
        await mark(true);
        try {
            await sessions(['close', worker.ref]);
        }
        catch (error) {
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
            action: oneOf(['list', 'read', 'search', 'send', 'close', 'hosts', 'load']),
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
            const need = (value, field) => {
                if (!value)
                    throw new Error(`${args.action} needs ${field}`);
                return value;
            };
            if (args.action === 'close')
                return closeWorker(need(args.ref, 'ref'), api, callContext);
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
        description: `Read or replace your notebook (at most ${exports.NOTEBOOK_MAX_BYTES} bytes). It is the memory that carries over to a new context window. "write" replaces the whole notebook.`,
        parameters: obj({ action: oneOf(['read', 'write']), text: opt(str()) }),
        replay: 'safe',
        execute: async (args, api, callContext) => {
            if (args.action === 'read') {
                const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
                return text(memory?.notebook || '(the notebook is empty)');
            }
            const notebook = args.text ?? '';
            const bytes = Buffer.byteLength(notebook, 'utf8');
            if (bytes > exports.NOTEBOOK_MAX_BYTES)
                return refusal(`Not saved: ${bytes} bytes is over the ${exports.NOTEBOOK_MAX_BYTES}-byte cap. Shorten it and write it again.`);
            await api.commit(async (tx) => {
                const memory = await tx.doc(MemoryDoc, api.conversationId);
                memory.notebook = notebook;
                memory.notebookSavedIn = memory.windows.length;
            }, callContext);
            return text(`Saved (${bytes} of ${exports.NOTEBOOK_MAX_BYTES} bytes). Your instructions show it from the next window on.`);
        },
    });
    const newContext = durable.defineTool({
        name: 'new_context',
        description: 'Close this context window and continue in a fresh one that holds your identity, your saved notebook, the end of this conversation, the latest request and your running workers. Nothing else carries over; earlier windows stay readable with history.',
        parameters: obj({ summary: str({ description: 'One line saying what this window covered' }) }),
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const window = await currentWindow(Number.MAX_SAFE_INTEGER);
            const outcome = await api.commit(async (tx) => {
                const memory = await tx.doc(MemoryDoc, api.conversationId);
                const refused = newContextRefusal(memory, window.some(isWork));
                if (refused)
                    return { refused };
                return { handoff: await rollover(tx, api.conversationId, args.summary, false, window) };
            }, callContext);
            if ('refused' in outcome)
                return refusal(outcome.refused);
            return { ...text('A new context window starts with the next request.'), control: { handoff: outcome.handoff } };
        },
    });
    const history = durable.defineTool({
        name: 'history',
        description: 'Your earlier context windows: "windows" lists them, "read" shows one (numbered from 1; the current one is the last), "search" finds text in all of them.',
        parameters: obj({
            action: oneOf(['windows', 'read', 'search']),
            window: opt(num()),
            query: opt(str()),
            offset: opt(num({ description: 'For read: messages to skip' })),
        }),
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const windows = await allWindows();
            const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
            const lines = (entries) => entries.flatMap(entry => {
                const message = entryMessage(entry);
                const body = messageText(message).trim();
                if (!body || entry.kind === 'pi.system')
                    return [];
                const role = entry.kind.startsWith('bot.') || entry.kind === 'pi.reset' ? roleOf(entry.kind) : String(message?.role ?? entry.kind);
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
                if (!entries)
                    return refusal(`There is no window ${number}; there are ${windows.length}.`);
                const all = lines(entries);
                const offset = Math.max(0, Math.floor(args.offset ?? 0));
                const page = all.slice(offset, offset + 40);
                const more = offset + page.length < all.length ? `\n[${all.length - offset - page.length} more; read again with offset ${offset + page.length}]` : '';
                return text(`Window ${number}, messages ${offset + 1}–${offset + page.length} of ${all.length}:\n\n${page.join('\n\n')}${more}`);
            }
            const query = (args.query ?? '').trim().toLowerCase();
            if (!query)
                return refusal('search needs a query');
            const hits = [];
            windows.forEach((entries, index) => {
                for (const line of lines(entries)) {
                    const at = line.toLowerCase().indexOf(query);
                    if (at < 0 || hits.length >= 20)
                        continue;
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
            const found = await hub(`/api/knowledge/search?q=${encodeURIComponent(args.query)}`);
            if (!found.results.length)
                return text(`Nothing in the knowledge base matches "${args.query}".`);
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
            const page = await hub(`/api/knowledge/page${args.page ? `?page=${encodeURIComponent(args.page)}` : ''}`);
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
            mode: opt(oneOf(['append', 'replace'])),
            title: opt(str({ description: 'Title of a new page; omitted: the page name' })),
        }),
        // A rerun could add the entry twice.
        replay: 'unsafe',
        execute: async (args) => {
            const written = await hub('/api/knowledge/pages', {
                page: args.page, mode: args.mode ?? 'append', text: args.text, author: options.loadBot().name,
                ...(args.source ? { source: args.source } : {}), ...(args.title ? { title: args.title } : {}),
            });
            const pushed = written.pushed ? '' : ` It is not on the remote yet (${written.pushError ?? 'push failed'}); the next write pushes it.`;
            return text(`${written.commit ? 'Saved' : 'Unchanged'}: ${written.path}${written.created ? ' (a new page, added to the index)' : ''}.${pushed}`);
        },
    });
    /** The input that started the current run: the newest input entry. */
    async function currentInput() {
        let cursor;
        do {
            const page = await conversation().entries({ order: 'descending' }, 200, cursor, ctx);
            const input = page.items.find(entry => Object.hasOwn(INPUT_KINDS, entry.kind));
            if (input)
                return input;
            cursor = page.next;
        } while (cursor);
        return null;
    }
    /**
     * The current turn as `<bot>/<entry>`, and the chain a post or question made in it belongs to: a turn another
     * bot's message woke continues that chain one hop on; any other turn starts a chain of its own at hop 1.
     */
    async function currentChain() {
        const input = await currentInput();
        const turn = `${bot.id}/${input?.id ?? 0}`;
        const data = input && Object.hasOwn(CHAINED_KINDS, input.kind) && (0, helper_values_1.record)(input.data) ? input.data : null;
        if (data && typeof data.chain === 'string' && typeof data.hop === 'number')
            return { turn, chain: data.chain, hop: data.hop + 1 };
        return { turn, chain: turn, hop: 1 };
    }
    /** A bot by name or id, from the registry; retired bots are not found. */
    async function findBot(wanted) {
        const { bots } = await hub('/api/bots');
        const name = wanted.trim().toLowerCase();
        return bots.find(row => row.status !== 'retired' && (row.id === wanted || row.name.toLowerCase() === name)) ?? null;
    }
    /**
     * The current window as a sub-bot starts from it: from its handoff up to the newest model response, which holds
     * the call creating the sub-bot and any call beside it. What is copied is exactly what this bot's last request
     * sent, so the sub-bot's first request repeats it and reads it from the prompt cache, and it holds no unfinished
     * tool call to continue.
     */
    async function forkEntries() {
        const newestFirst = [];
        let cursor;
        let reset = false;
        do {
            const page = await conversation().entries({ order: 'descending' }, 200, cursor, ctx);
            for (const entry of page.items) {
                newestFirst.push(entry);
                if (entry.kind === 'pi.reset') {
                    reset = true;
                    break;
                }
            }
            cursor = page.next;
        } while (cursor && !reset);
        const cut = newestFirst.findIndex(entry => entry.kind === 'pi.assistant');
        return newestFirst.slice(cut + 1).reverse().map(entry => ({
            kind: entry.kind,
            ...(entry.model ? { model: [...entry.model] } : {}),
            ...(entry.data !== undefined ? { data: entry.data } : {}),
            ...(entry.head === entry.id ? { head: 'self' } : {}),
        }));
    }
    const placesParameter = opt(arr(obj({
        host: opt(str({ description: 'Fleet host; omitted: this host' })), cwd: str(), label: str({ description: 'What the bot calls the place' }),
    }), { description: 'Where the bot works; replaces the whole list' }));
    const botCreate = durable.defineTool({
        name: 'bot_create',
        description: 'Create a sub-bot under you: a long-lived bot that is the standing contact for a narrower area. It starts from this conversation as it stood before this call, so it knows what you know, and its purpose arrives as its first message. It keeps your identity until its first new context window, where it takes the identity you give here and a notebook of its own. It runs on your model. Bots nest at most three levels deep.',
        parameters: obj({
            name: str({ description: 'Its name' }),
            purpose: str({ description: 'What it is for and what to do first; its first message' }),
            identity: str({ description: 'Its standing identity from its first new window on: who it is, what it is the contact for, how it works' }),
            places: placesParameter,
        }),
        // A rerun finds its own child id: the registry creates a bot once per id.
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const childId = await api.memo('child', crypto.randomUUID(), callContext);
            const self = options.loadBot();
            const childDir = path.join(options.botsDir, childId);
            if (!await api.memo('seeded', callContext)) {
                const agent = await api.agent(callContext);
                const seed = {
                    parentId: bot.id, parentName: self.name, instructions: agent.instructions ?? '', thinkingLevel: agent.thinkingLevel,
                    purpose: composePurpose(self.name, args.name, args.purpose), entries: await forkEntries(),
                };
                fs.mkdirSync(childDir, { recursive: true, mode: 0o700 });
                const file = path.join(childDir, exports.FORK_SEED);
                fs.writeFileSync(`${file}.tmp`, JSON.stringify(seed), { mode: 0o600 });
                fs.renameSync(`${file}.tmp`, file);
                await api.memo('seeded', true, callContext);
            }
            let created;
            try {
                created = await hub('/api/bots', {
                    id: childId, parentId: bot.id, name: args.name, identity: args.identity, model: self.model,
                    ...(self.thinking ? { thinking: self.thinking } : {}), places: args.places ?? [], by: bot.id, turn: (await currentChain()).turn,
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                // A refusal leaves no bot behind; a bot that was created but did not start keeps its start for a retry.
                if (!message.startsWith('Created '))
                    fs.rmSync(childDir, { recursive: true, force: true });
                return refusal(message);
            }
            return text(`Created sub-bot "${created.bot.name}". It starts from this conversation and is reading its purpose now; it reports to the user in its own chat. Reach it with room_post.`);
        },
    });
    const roomPost = durable.defineTool({
        name: 'room_post',
        description: 'Post a message to your family\'s room: your parent, your sub-bots and theirs. Only the bots you name are woken; it arrives in their conversation. A chain of replies is capped, so post only what needs their attention, and do not reply just to acknowledge.',
        parameters: obj({
            to: arr(str(), { description: 'Names of the bots the message is for' }),
            message: str(),
        }),
        // A rerun would post twice.
        replay: 'unsafe',
        execute: async (args) => {
            const { chain, hop } = await currentChain();
            let posted;
            try {
                posted = await hub(`/api/bots/${bot.id}/room`, { to: args.to, text: args.message, chain, hop });
            }
            catch (error) {
                return refusal(error instanceof Error ? error.message : String(error));
            }
            const parts = [`Posted room message ${posted.message.id}${posted.delivered.length ? ` to ${posted.delivered.join(', ')}` : ''}.`];
            if (posted.notRunning.length)
                parts.push(`Not running, so not woken: ${posted.notRunning.join(', ')}; they can read it in the room later.`);
            return text(parts.join(' '));
        },
    });
    const roomRead = durable.defineTool({
        name: 'room_read',
        description: 'Read the newest messages in your family\'s room, including those not addressed to you.',
        parameters: obj({ limit: opt(num({ description: 'How many; default 20' })) }),
        replay: 'safe',
        execute: async (args) => {
            const limit = Math.max(1, Math.floor(args.limit ?? 20));
            const { messages } = await hub(`/api/bots/${bot.id}/room?limit=${limit}`);
            if (!messages.length)
                return text('The room is empty.');
            return text(messages.map(message => `#${message.id} ${message.createdAt} ${message.fromName} → ${message.toNames.join(', ')} (hop ${message.hop}): ${message.text}`).join('\n'));
        },
    });
    const askBot = durable.defineTool({
        name: 'ask_bot',
        description: 'Put one question to a bot in another family, such as asking Fleet about a host. Returns at once; its answer arrives once, as a message starting "[answer from". Do not poll for it.',
        parameters: obj({ bot: str({ description: 'Name of the bot to ask' }), question: str({ description: 'The whole question; it knows nothing of this conversation' }) }),
        // A rerun finds its own question id, and the bot asked takes each question once.
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const askId = await api.memo('ask', crypto.randomUUID(), callContext);
            const target = await findBot(args.bot);
            if (!target)
                return refusal(`There is no bot named "${args.bot}".`);
            const { chain, hop } = await currentChain();
            try {
                await hub(`/api/bots/${target.id}/ask`, { by: bot.id, question: args.question, askId, chain, hop });
            }
            catch (error) {
                return refusal(error instanceof Error ? error.message : String(error));
            }
            return text(`Asked ${target.name}. Its answer arrives once, as a message starting "[answer from ${target.name}]".`);
        },
    });
    /**
     * Sends back the answer to each question from another family whose run has ended; each goes once. `through` is the
     * newest entry of a view in which the bot was idle: every question up to it has had its run, and one that arrived
     * later waits for the end of its own. The answer is the last model text of that run, before the next input; it is
     * one more hop of the question's chain and is never refused, since the question was taken.
     */
    async function answerAsks(through) {
        const recent = (await conversation().entries({ order: 'descending', maxEntryId: through }, 200, undefined, ctx)).items;
        const asks = recent.filter(entry => entry.kind === 'bot.ask');
        if (!asks.length)
            return;
        const answered = (await harness.snapshot(AsksDoc, conversation().id, ctx))?.answered ?? {};
        for (const ask of asks) {
            const data = (0, helper_values_1.record)(ask.data) ? ask.data : {};
            const askId = typeof data.askId === 'string' ? data.askId : '';
            if (!askId || answered[askId])
                continue;
            const next = recent.filter(entry => entry.id > ask.id && Object.hasOwn(INPUT_KINDS, entry.kind)).at(-1)?.id ?? Infinity;
            const reply = recent.find(entry => entry.id > ask.id && entry.id < next && entry.kind === 'pi.assistant' && messageText(entryMessage(entry)).trim());
            await hub(`/api/bots/${encodeURIComponent(String(data.from))}/answer`, {
                by: bot.id, askId, text: reply ? messageText(entryMessage(reply)).trim() : '(it ended its turn without a reply)',
                question: String(data.question ?? ''), chain: String(data.chain), hop: Number(data.hop) + 1,
            });
            await conversation().commit(async (tx) => {
                (await tx.doc(AsksDoc, conversation().id)).answered[askId] = new Date().toISOString();
            }, ctx);
        }
    }
    const botUpdate = durable.defineTool({
        name: 'bot_update',
        description: 'Change your own entry or a descendant bot\'s: its name, identity, places or thinking level, or a descendant\'s model. You cannot change your own model; only the user can. Every change is recorded, shown to the user with an undo, and a changed identity, places or thinking level takes effect at that bot\'s next context window.',
        parameters: obj({
            bot: opt(str({ description: 'Name or id of a descendant bot; omitted: yourself' })),
            name: opt(str()),
            identity: opt(str({ description: 'The whole new identity; it replaces the old one' })),
            places: opt(arr(obj({
                host: opt(str({ description: 'Fleet host; omitted: this host' })), cwd: str(), label: str({ description: 'What you call the place' }),
            }), { description: 'Where the bot works; replaces the whole list' })),
            thinking: opt(str({ description: 'Thinking level: off, minimal, low, medium, high or xhigh' })),
            model: opt(str({ description: 'provider/model-id; only for a descendant' })),
        }),
        // A rerun would write a second revision.
        replay: 'unsafe',
        execute: async (args) => {
            let target = bot.id;
            if (args.bot) {
                const { bots } = await hub('/api/bots');
                const wanted = args.bot.trim().toLowerCase();
                const found = bots.find(row => row.status !== 'retired' && (row.id === args.bot || row.name.toLowerCase() === wanted));
                if (!found)
                    return refusal(`There is no bot named "${args.bot}".`);
                target = found.id;
            }
            const changes = {};
            for (const field of ['name', 'identity', 'places', 'thinking', 'model'])
                if (args[field] !== undefined)
                    changes[field] = args[field];
            if (!Object.keys(changes).length)
                return refusal('Name at least one field to change.');
            if (target === bot.id && changes.model !== undefined) {
                return refusal('Refused: you cannot change your own model. Tell the user: only they can change it, on your entry in pi-dish.');
            }
            let change;
            try {
                change = await hub(`/api/bots/${encodeURIComponent(target)}/edit`, { by: bot.id, turn: (await currentChain()).turn, changes });
            }
            catch (error) {
                return refusal(error instanceof Error ? error.message : String(error));
            }
            const own = target === bot.id;
            const who = own ? 'your' : `${change.before.name}'s`;
            if (!change.fields.length)
                return text(`Nothing changed: ${who} entry already says that.`);
            const lines = change.fields.map(field => {
                const show = (row) => field === 'identity' ? `${row.identity.length} characters` : JSON.stringify(row[field]);
                return `${field}: ${show(change.before)} → ${show(change.bot)}`;
            });
            const later = change.fields.filter(field => field === 'identity' || field === 'places' || field === 'thinking');
            const notes = [
                later.length ? `The new ${later.join(', ')} take${later.length === 1 ? 's' : ''} effect at ${own ? 'your' : 'its'} next context window, not in this one.` : '',
                change.fields.includes('model') ? `${change.bot.name} restarts on the new model.` : '',
                'The user sees the change and can undo it.',
            ].filter(Boolean);
            return {
                ...text(`Changed ${who} entry (revision ${change.revision}):\n${lines.join('\n')}\n${notes.join(' ')}`),
                details: { botChange: { botId: change.bot.id, botName: change.bot.name, revision: change.revision, fields: change.fields, lines } },
            };
        },
    });
    const reminder = durable.hook(durable.GenerationTask, {
        beforeRequest: (request) => {
            const last = [...request.messages].reverse().find(message => message.role === 'assistant');
            const used = usageTokens(last);
            if (used < exports.REMINDER_RATIO * windowLimit)
                return undefined;
            const percent = Math.round(used / windowLimit * 100);
            // For this request only: the stored transcript, and the cached prefix, are unchanged.
            const note = {
                role: 'user',
                content: `[pi-dish: this context window is ${percent}% full. Save your notebook with context_notes and call new_context at the next natural break; at ${Math.round(exports.FORCED_RATIO * 100)}% the window is closed for you.]`,
                timestamp: Date.now(),
            };
            return { messages: [...request.messages, note] };
        },
    });
    const BotExtension = durable.defineExtension({
        name: 'bot',
        sections: [durable.section('bot-rules', () => PREAMBLE, { tag: false })],
        tools: [spawnWorker, sessionsTool, contextNotes, newContext, history, kbSearch, kbRead, kbWrite, botUpdate, botCreate, roomPost, roomRead, askBot],
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
    // A sub-bot's first start: its parent wrote where it starts from into its directory.
    const seedFile = path.join(path.dirname(options.storageFile), exports.FORK_SEED);
    const seed = fs.existsSync(seedFile) ? JSON.parse(fs.readFileSync(seedFile, 'utf8')) : null;
    root = await harness.root(ctx, {
        // A sub-bot keeps its parent's instructions and thinking level until its first rollover, so its first request
        // repeats the parent's last one.
        agent: seed
            ? { model: modelRef, thinkingLevel: seed.thinkingLevel, instructions: seed.instructions }
            : {
                model: modelRef,
                ...(bot.thinking ? { thinkingLevel: bot.thinking } : {}),
                instructions: composeInstructions(bot.identity, '', bot.places),
            },
    });
    if (seed) {
        const started = (await root.entries({ order: 'ascending' }, 1, undefined, ctx)).items.length > 0;
        if (!started) {
            await root.commit(async (tx) => {
                for (const entry of seed.entries)
                    await tx.appendEntry(root.id, entry);
                // Questions the parent took are the parent's to answer.
                const asks = await tx.doc(AsksDoc, root.id);
                for (const entry of seed.entries) {
                    const askId = entry.kind === 'bot.ask' && (0, helper_values_1.record)(entry.data) ? entry.data.askId : undefined;
                    if (typeof askId === 'string')
                        asks.answered[askId] = `by ${seed.parentName}`;
                }
            }, ctx);
        }
        // The parent's conversation is not this bot's to show: the transcript starts at a marker after it.
        const copied = (await root.entries({ order: 'ascending' }, seed.entries.length, undefined, ctx)).items.at(-1);
        if (copied && copied.id > mirror.lastEntryId) {
            mirror.appendCustom(copied.id, 'bot-forked', `Started from ${seed.parentName}'s conversation; its purpose follows.`, { parentId: seed.parentId, parentName: seed.parentName });
        }
    }
    // The model is the user's choice in the registry; the instructions stay those of the open window.
    const agent = await root.agent(ctx);
    if (agent.model?.provider !== modelRef.provider || agent.model?.modelId !== modelRef.modelId) {
        await root.configure({ model: modelRef }, ctx);
    }
    harness.resume();
    if (seed) {
        // The request id makes the purpose arrive once, also when a crash comes before the start file is gone.
        await root.submit({
            type: 'input', content: seed.purpose, whenBusy: 'followUp', requestId: 'bot-purpose',
            entry: { kind: 'bot.purpose', data: { from: seed.parentId, fromName: seed.parentName } },
        }, ctx);
        fs.rmSync(seedFile, { force: true });
    }
    // Event mapping --------------------------------------------------------------
    let busy = false;
    let processed = mirror.lastEntryId;
    let streaming = false;
    let lastUsage = 0;
    let lastModel = '';
    let lastFailure = -1;
    const calls = new Map();
    const running = new Map();
    function startTool(callId, name) {
        let slot = running.get(callId);
        if (!slot) {
            slot = { output: '', startedAt: Date.now() };
            running.set(callId, slot);
            emit('tool_execution_start', { toolCallId: callId, toolName: name, args: calls.get(callId)?.args ?? {}, startedAt: slot.startedAt });
        }
        return slot;
    }
    function show(entry) {
        processed = Math.max(processed, entry.id);
        const message = entryMessage(entry);
        if (!message)
            return;
        if (entry.kind === 'pi.user') {
            mirror.appendMessage(entry.id, message);
            emit('message_start', { message });
            emit('message_end', { message });
        }
        else if (Object.hasOwn(CUSTOM_TYPES, entry.kind)) {
            const customType = CUSTOM_TYPES[entry.kind];
            const details = (0, helper_values_1.record)(entry.data) ? entry.data : undefined;
            mirror.appendCustom(entry.id, customType, messageText(message), details);
            emit('message_end', { message: { role: 'custom', customType, content: [{ type: 'text', text: messageText(message) }], display: true, timestamp: Date.now() } });
        }
        else if (entry.kind === 'pi.assistant') {
            const selector = `${String(message.provider ?? '')}/${String(message.model ?? '')}`;
            if (message.provider && message.model && selector !== lastModel) {
                lastModel = selector;
                mirror.appendModelChange(entry.id, String(message.provider), String(message.model));
            }
            if (Array.isArray(message.content)) {
                for (const part of message.content) {
                    if ((0, helper_values_1.record)(part) && part.type === 'toolCall' && typeof part.id === 'string')
                        calls.set(part.id, { name: String(part.name), args: part.arguments });
                }
            }
            lastUsage = usageTokens(message) || lastUsage;
            mirror.appendMessage(entry.id, message);
            if (!streaming)
                emit('message_start', { message });
            streaming = false;
            emit('message_end', { message });
        }
        else if (entry.kind === 'pi.tool-result') {
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
            // A change to a bot's entry is shown as itself, with what the user needs to undo it.
            const change = (0, helper_values_1.record)(message.details) && (0, helper_values_1.record)(message.details.botChange) ? message.details.botChange : null;
            if (name === 'bot_update' && change) {
                const summary = `${String(change.botName)}: ${Array.isArray(change.lines) ? change.lines.join('; ') : ''}`;
                mirror.appendCustom(entry.id, 'bot-change', summary, change, 'change');
                emit('message_end', { message: { role: 'custom', customType: 'bot-change', content: [{ type: 'text', text: summary }], details: change, display: true, timestamp: Date.now() } });
            }
        }
    }
    function showLive(live) {
        const partial = live.generation?.message;
        if (partial && Array.isArray(partial.content) && partial.content.length) {
            if (!streaming)
                emit('message_start', { message: partial });
            streaming = true;
            emit('message_update', { message: partial });
        }
        for (const slot of live.tools ?? []) {
            if (slot.status === 'pending')
                continue;
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
    async function catchUp(through) {
        let cursor;
        do {
            const page = await conversation().entries({ minEntryId: (processed + 1), maxEntryId: through, order: 'ascending' }, 200, cursor, ctx);
            for (const entry of page.items)
                if (entry.id > processed)
                    show(entry);
            cursor = page.next;
        } while (cursor);
    }
    async function forceRolloverIfFull() {
        if (lastUsage < exports.FORCED_RATIO * windowLimit)
            return;
        const window = await currentWindow(Number.MAX_SAFE_INTEGER);
        const handoff = await conversation().commit(tx => rollover(tx, conversation().id, 'Closed at the context limit.', true, window), ctx);
        await conversation().reset(handoff, ctx);
        lastUsage = 0;
        log('rolled the context window over at the limit');
    }
    async function onView(view) {
        const live = liveOf(view);
        const busyNow = live.run !== undefined;
        if (busyNow && !busy) {
            busy = true;
            emit('agent_start', {});
            emit('turn_start', {});
        }
        if (view.before !== undefined && view.before > processed)
            await catchUp(view.before);
        for (const entry of view.entries)
            if (entry.id > processed)
                show(entry);
        if (busyNow)
            showLive(live);
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
            const through = processed;
            try {
                await forceRolloverIfFull();
            }
            catch (error) {
                log(`forced rollover failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            try {
                await answerAsks(through);
            }
            catch (error) {
                log(`answer to another bot failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        options.changed();
    }
    const watch = await root.watch(ctx, { from: (processed + 1), min: 50, max: 1000 });
    watch.start(async (call) => {
        if (call.kind !== 'value')
            return;
        try {
            await onView(call.value);
        }
        catch (error) {
            log(`view mapping failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    return {
        get busy() { return busy; },
        get model() { return bot.model; },
        contextUsage() {
            if (!lastUsage)
                return null;
            return { tokens: lastUsage, contextWindow: windowLimit, percent: Math.round(lastUsage / windowLimit * 1000) / 10 };
        },
        async prompt(message, mode) {
            if (!busy)
                await forceRolloverIfFull();
            await conversation().submit({ type: 'input', content: message, whenBusy: mode }, ctx);
        },
        async deliver(input) {
            await conversation().submit({
                type: 'input', content: input.text, whenBusy: 'followUp', requestId: input.requestId,
                entry: { kind: `bot.${input.kind}`, data: input.data },
            }, ctx);
        },
        abort: () => conversation().abort(ctx),
        async close() {
            await watch.stop();
            await harness.close(ctx);
        },
    };
}
