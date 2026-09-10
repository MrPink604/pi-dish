/**
 * Manages pi sessions spawned via `pi --mode rpc`.
 * All session interaction goes through RPC — no control sockets or file polling.
 *
 * Pi's RPC protocol uses {"type":"command", ...} on stdin/stdout.
 * Responses: {"type":"response", "id":..., "command":"...", "success":true, "data":{...}}
 * Events: turn_start, message_start, message_update, message_end, turn_end, etc.
 *
 * Framing note: pi's docs require splitting on LF only — Node's readline also
 * splits on U+2028/U+2029 which are valid inside JSON strings, so we do our
 * own buffering.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs = require('fs');
import os = require('os');
import path = require('path');
import crypto = require('crypto');
import { createLineSplitter } from './line-splitter';
import { PendingRequests } from './pending-requests';
import { decodeRPCFrame, isRecord, type ProtocolRecord } from './wire-protocol';
import { trackRunningToolCalls } from './running-tool-calls';
// Explicit ports into the remaining JavaScript modules; their implementations
// retain their existing tests and are not claimed to be type checked here.
const { safeHeaderSessionId }: { safeHeaderSessionId(value: unknown): string | null } = require('./session-discovery');
import { processIdentity, processIdentityAlive } from './process-identity';
const { createSessionObserver }: { createSessionObserver(options: {
  waitsForSettled: boolean; canWrite: () => boolean; snapshot: () => ProtocolRecord | null;
}): RecoveryObserver } = require('./session-recovery');
import type { LaunchOptions, NativeSessionId, RunningToolCall } from './contracts';
import { validSessionId } from './session-key';

interface RecoveryObserver {
  initialize(): void; event(type: string, data?: unknown): void; dispose(): void;
}
interface RPCLaunchOptions extends LaunchOptions { cwd?: string; }
interface PromptOptions { deliverAs?: 'steer' | 'followUp'; images?: unknown[]; }
type Listener = (data: unknown) => void;

class RPCIdentityError extends TypeError {}
function validatedNativeId(value: unknown): NativeSessionId {
  if (!validSessionId(value)) throw new RPCIdentityError('Invalid RPC session identity');
  return value;
}

function asRecord(value: unknown): ProtocolRecord { return isRecord(value) ? value : {}; }
function errorCode(error: unknown): unknown { return isRecord(error) ? error.code : undefined; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

class RPCSession {
  declare id: NativeSessionId;
  declare proc: ChildProcessWithoutNullStreams;
  declare alive: boolean;
  declare pending: InstanceType<typeof PendingRequests>;
  declare nextRequestId: number;
  declare listeners: Map<string, Listener[]>;
  declare state: ProtocolRecord | null;
  declare sessionFile: string | null;
  declare cwd: string | null;
  declare turnInProgress: boolean;
  declare compacting: boolean;
  declare stderrTail: string[];
  declare lastActivityAt: Date;
  declare streamingAssistantMessage: ProtocolRecord | null;
  declare runningToolCalls: Map<string, RunningToolCall>;
  declare recoveryBridgeOwned: boolean;
  declare recoveryInstanceId: string;
  declare recoveryStartTime: string | null;
  declare recoveryObserver: RecoveryObserver;
  declare bounceExecuting?: boolean;
  declare lastStats?: unknown;

  constructor(id: NativeSessionId, proc: ChildProcessWithoutNullStreams) {
    this.id = id;
    this.proc = proc;
    this.alive = true;
    this.pending = new PendingRequests();
    this.nextRequestId = 1;
    this.listeners = new Map(); // event -> [callback]
    this.state = null;
    this.sessionFile = null;
    this.cwd = null;
    this.turnInProgress = false;
    // Mirrors pi's compaction_start/compaction_end events (RPC mode forwards
    // every AgentSession event, auto-compaction included); the /compact
    // emulation also holds it for the in-flight request. Gates double-compact
    // and feeds the SSE init frame + session list.
    this.compacting = false;
    this.stderrTail = []; // last few stderr lines for error reporting
    // Stable activity timestamp for the session list — bumped on turn/message
    // boundaries, never minted per poll (that made sessions look forever-unread).
    this.lastActivityAt = new Date();
    // Pi >= 0.84 sends delta-only message_update events over JSON/RPC. Keep
    // the current assistant snapshot so pi-dish's existing SSE contract can
    // continue forwarding a complete message on every update.
    this.streamingAssistantMessage = null;
    this.runningToolCalls = new Map();
    this.recoveryBridgeOwned = false;
    this.recoveryInstanceId = crypto.randomUUID();
    this.recoveryStartTime = processIdentity(proc.pid)?.startTime ?? null;
    this.recoveryObserver = createSessionObserver({
      waitsForSettled: true,
      canWrite: () => this._canObserveRecovery(),
      snapshot: () => {
        const model = asRecord(this.state?.model);
        return this.sessionFile && this.cwd ? {
          harnessId: 'pi', nativeSessionId: this.id, sessionFile: this.sessionFile, cwd: this.cwd,
          name: this.state?.sessionName ?? this.state?.name ?? null,
          model: typeof model.provider === 'string' && model.provider && typeof model.id === 'string' && model.id
            ? `${model.provider}/${model.id}` : null,
          thinkingLevel: this.state?.thinkingLevel ?? null,
          pid: this.proc.pid, startTime: this.recoveryStartTime, instanceId: this.recoveryInstanceId,
        } : null;
      },
    });

    // pi can die (crash/OOM) before the 'exit' event flips this.alive, so a
    // stdin.write() can hit a broken pipe and emit an async 'error'. Without
    // a listener that throws and crashes the server; swallow it — the 'exit'
    // handler below rejects any pending requests with the real cause.
    proc.stdin.on('error', () => {});
    proc.stdout.on('error', () => {});
    proc.stderr.on('error', () => {});

    // Strict JSONL framing (LF only)
    proc.stdout.on('data', createLineSplitter((line) => {
      try {
        this._handleMessage(JSON.parse(line));
      } catch (e) {
        // Ignore non-JSON output
      }
    }));

    proc.on('exit', (code) => {
      this.recoveryObserver.event('shutdown');
      this.recoveryObserver.dispose();
      this.alive = false;
      const err = new Error(`pi exited with code ${code}${this.stderrTail.length ? ': ' + this.stderrTail.join(' | ') : ''}`);
      this.pending.failAll(err);
      this._emit('exit', { code });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (!text) return;
      for (const line of text.split('\n')) {
        this.stderrTail.push(line);
        if (this.stderrTail.length > 5) this.stderrTail.shift();
      }
      console.error(`[rpc:${String(this.id).slice(0, 8)}] ${text}`);
    });
  }

  _canObserveRecovery() {
    if (this.recoveryBridgeOwned || !this.sessionFile) return false;
    const dir = path.join(os.homedir(), '.pi', 'dish', 'sessions');
    let entries;
    try { entries = fs.readdirSync(dir); } catch (error) {
      if (errorCode(error) === 'ENOENT') return true;
      throw error; // unreadable ownership evidence is not permission to write
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      let claim: unknown;
      try { claim = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
      // Preserve the legacy fail-closed outcome for a null ownership record.
      if (claim === null) throw new TypeError('Invalid bridge recovery claim');
      if (isRecord(claim) && claim.recoveryObservation === true && claim.harnessId === 'pi'
        && claim.sessionFile === this.sessionFile && processIdentityAlive({
          // Preserve the core proof's existing numeric/string coercion of registry input.
          pid: Number(claim.pid), startTime: String(claim.startTime),
        })) {
        // Sticky for this process: bridge cleanup removes its registry before
        // child exit, which must not silently transfer ownership back to RPC.
        this.recoveryBridgeOwned = true;
        return false;
      }
    }
    return true;
  }

  _handleMessage(input: unknown) {
    const frame = decodeRPCFrame(input);
    if (!frame) return;
    // Response to a command — correlate by id.
    if (frame.kind === 'response') {
      const msg = frame.response;
      this.pending.settle(msg.id, msg.success, msg.data, msg.error ?? undefined, 'Command failed');
      return;
    }
    let msg = frame.data;

    if (msg.type === 'message_start' && isRecord(msg.message) && msg.message.role === 'assistant') {
      this.streamingAssistantMessage = structuredClone(msg.message);
    } else if (msg.type === 'message_update' && !msg.message && msg.assistantMessageEvent) {
      const event = asRecord(msg.assistantMessageEvent);
      if (event.type === 'done') this.streamingAssistantMessage = isRecord(event.message) ? structuredClone(event.message) : null;
      else if (event.type === 'error') this.streamingAssistantMessage = isRecord(event.error) ? structuredClone(event.error) : null;
      else if (this.streamingAssistantMessage) {
        const content: unknown[] = Array.isArray(this.streamingAssistantMessage.content)
          ? this.streamingAssistantMessage.content : (this.streamingAssistantMessage.content = []);
        const index = event.contentIndex;
        if (typeof index === 'number' && Number.isInteger(index) && index >= 0) {
          if (event.type === 'text_start') content[index] = { type: 'text', text: '' };
          else if (event.type === 'text_delta' && typeof event.delta === 'string') {
            const block = asRecord(content[index]);
            if (block.type !== 'text' || typeof block.text !== 'string') content[index] = { type: 'text', text: event.delta };
            else block.text += event.delta;
          } else if (event.type === 'text_end' && typeof event.content === 'string') content[index] = { type: 'text', text: event.content };
          else if (event.type === 'thinking_start') content[index] = { type: 'thinking', thinking: '' };
          else if (event.type === 'thinking_delta' && typeof event.delta === 'string') {
            const block = asRecord(content[index]);
            if (block.type !== 'thinking' || typeof block.thinking !== 'string') content[index] = { type: 'thinking', thinking: event.delta };
            else block.thinking += event.delta;
          } else if (event.type === 'thinking_end' && typeof event.content === 'string') content[index] = { type: 'thinking', thinking: event.content };
          else if (event.type === 'toolcall_end' && isRecord(event.toolCall)) content[index] = structuredClone(event.toolCall);
        }
      }
      if (this.streamingAssistantMessage) {
        msg = { ...msg, message: structuredClone(this.streamingAssistantMessage) };
      }
    }

    trackRunningToolCalls(this.runningToolCalls, frame.event, {
      toolCallId: typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined,
      toolName: typeof msg.toolName === 'string' ? msg.toolName : undefined,
      startedAt: typeof msg.startedAt === 'number' || typeof msg.startedAt === 'string' ? msg.startedAt : undefined,
      args: msg.args, partialResult: msg.partialResult,
    });
    this.recoveryObserver.event(frame.event, msg);

    // Track turn state
    if (msg.type === 'turn_start') {
      this.turnInProgress = true;
      this.lastActivityAt = new Date();
    } else if (msg.type === 'turn_end' || msg.type === 'agent_end') {
      this.turnInProgress = false;
      this.lastActivityAt = new Date();
      this._refreshStats();
    } else if (msg.type === 'message_end') {
      this.lastActivityAt = new Date();
    } else if (msg.type === 'compaction_start') {
      this.compacting = true;
    } else if (msg.type === 'compaction_end') {
      this.compacting = false;
    }

    // Stream all agent events
    this._emit(frame.event, msg);
    if (msg.type === 'message_end' && isRecord(msg.message) && msg.message.role === 'assistant') {
      this.streamingAssistantMessage = null;
    }
  }

  _emit(event: string, data: unknown) {
    // Iterate a copy: a listener that unsubscribes itself from inside its own
    // callback (routine observers finishing on turn_end, an SSE client
    // disconnecting) splices the live array, and the loop would then skip the
    // listener that shifted into its place. EventEmitter copies for the same
    // reason, so BridgeSession never had this hazard.
    for (const cb of [...(this.listeners.get(event) || [])]) cb(data);
  }

  on(event: string, cb: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
    return () => {
      const arr = this.listeners.get(event)!;
      const idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  off(event: string, cb: Listener) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(cb);
    if (idx >= 0) arr.splice(idx, 1);
  }

  send(command: string, params: ProtocolRecord = {}, { timeout = 30000 } = {}) {
    if (this.bounceExecuting && !command.startsWith('get_')) {
      return Promise.reject(new Error('A safe bulk operation is executing; wait for its result.'));
    }
    if (!this.alive) return Promise.reject(new Error('Session process not running'));
    const id = `req-${this.nextRequestId++}`;
    const promise = this.pending.track(id, { timeout, label: `RPC ${command}` });
    this.proc.stdin.write(JSON.stringify({ id, type: command, ...params }) + '\n');
    return promise;
  }

  /** Fire-and-forget write (extension_ui_response has no response). */
  write(obj: ProtocolRecord) {
    if (!this.alive) throw new Error('Session process not running');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  async prompt(message: string, opts: PromptOptions = {}) {
    const params: ProtocolRecord = { message };
    // Queue instead of erroring when the agent is mid-turn.
    if (opts.deliverAs) params.streamingBehavior = opts.deliverAs;
    else if (this.turnInProgress) params.streamingBehavior = 'steer';
    if (opts.images?.length) params.images = opts.images;
    // Prompts can legitimately take a moment to be accepted (extension
    // commands execute inline) but should not hang forever.
    return this.send('prompt', params, { timeout: 120000 });
  }
  async steer(message: string, opts: PromptOptions = {}) {
    const params: ProtocolRecord = { message };
    if (opts.images?.length) params.images = opts.images;
    return this.send('steer', params);
  }
  // setModel/setName keep this.state in sync themselves — getActiveSessions
  // reads state.model/state.sessionName, and every caller used to have to
  // remember the patch.
  async setModel(provider: string, modelId: string) {
    const model = await this.send('set_model', { provider, modelId });
    if (model) this.state = { ...(this.state || {}), model };
    this.recoveryObserver.event('metadata');
    return model;
  }
  async setName(name: string) {
    const result = await this.send('set_session_name', { name });
    this.state = { ...(this.state || {}), sessionName: name, name };
    this.recoveryObserver.event('metadata');
    return result;
  }
  async getAvailableModels() { return this.send('get_available_models'); }
  async getSessionStats() { return this.send('get_session_stats'); }
  async getCommands() { return this.send('get_commands'); }
  async compact(customInstructions?: string) {
    return this.send('compact', customInstructions ? { customInstructions } : {}, { timeout: 300000 });
  }
  async abort() { return this.send('abort'); }
  async setThinkingLevel(level: string) {
    const result = await this.send('set_thinking_level', { level });
    this.state = { ...(this.state || {}), thinkingLevel: level };
    this.recoveryObserver.event('metadata');
    return result;
  }
  async newSession() { return this.send('new_session'); }
  async exportHtml(outputPath?: string) { return this.send('export_html', outputPath ? { outputPath } : {}); }

  _refreshStats() {
    this.getSessionStats()
      .then(stats => { this.lastStats = stats; })
      .catch(() => {});
  }

  respondExtensionUI(requestId: string, response: ProtocolRecord) {
    this.write({ type: 'extension_ui_response', id: requestId, ...response });
  }

  kill() {
    if (this.alive) {
      this.proc.kill('SIGTERM');
    }
  }
}

// Active RPC sessions managed by pi-dish
const rpcSessions = new Map<NativeSessionId, RPCSession>(); // sessionId -> RPCSession

/**
 * Initialize an RPC session from a spawned process.
 * Polls get_state until pi responds (instead of a blind fixed sleep).
 * @returns {Promise<RPCSession>}
 */
async function _initRPCSession(proc: ChildProcessWithoutNullStreams, opts: RPCLaunchOptions = {}) {
  const tempId = validatedNativeId(`rpc-${Date.now()}`);
  const session = new RPCSession(tempId, proc);
  session.cwd = opts.cwd || null;

  const spawnError = new Promise<never>((_, reject) => {
    proc.on('error', reject); // e.g. ENOENT: pi not on PATH
  });
  // The 'error' listener stays attached for the process's lifetime (removing
  // it would turn a late 'error' event into an uncaught exception), so this
  // promise can reject long after the startup race stopped listening — give
  // it a permanent handler or that late rejection kills the whole server
  // under Node's default unhandled-rejection policy.
  spawnError.catch(() => {});

  const deadline = Date.now() + 20000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (!session.alive) {
      throw new Error(`pi exited during startup${session.stderrTail.length ? ': ' + session.stderrTail.join(' | ') : ''}`);
    }
    try {
      const state: unknown = await Promise.race([
        session.send('get_state', {}, { timeout: 2500 }),
        spawnError,
      ]);
      if (!isRecord(state)) throw new TypeError('Invalid RPC get_state response');
      if (state.sessionFile != null && typeof state.sessionFile !== 'string') {
        throw new TypeError('Invalid RPC session file');
      }
      const sessionFile = state.sessionFile || null;
      // Use the session file basename as the id — same convention as the
      // bridge registry, so a spawned pi that also loads the bridge extension
      // doesn't show up twice under two different ids. Generic session.jsonl
      // files are the exception: their stable identity is the validated Pi
      // header id, matching bridge and historical discovery behavior.
      const basenameId = sessionFile ? path.basename(sessionFile, '.jsonl') : null;
      const headerId = safeHeaderSessionId(state?.sessionId);
      const realId = validatedNativeId(basenameId === 'session' && headerId
        ? headerId : (basenameId || headerId || tempId));
      session.id = realId;
      session.state = state;
      session.sessionFile = sessionFile || null;
      session.compacting = !!state?.isCompacting;
      session.recoveryObserver.initialize();
      rpcSessions.set(realId, session);
      // Only clear the map if it still points at *this* session — otherwise a
      // stale duplicate's exit would evict a newer live session under the same
      // id (they share the session-file basename).
      session.on('exit', () => { if (rpcSessions.get(realId) === session) rpcSessions.delete(realId); });
      session._refreshStats();
      return session;
    } catch (e) {
      lastError = e;
      // Retrying a permanent route-id failure cannot make this child usable.
      // Leave through the common kill path below, never leak a failed startup.
      if (e instanceof RPCIdentityError) break;
      if (errorCode(e) === 'ENOENT') throw new Error(`failed to spawn pi: ${errorMessage(e)}`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  session.kill();
  throw new Error(`pi RPC session did not become ready: ${lastError ? errorMessage(lastError) : 'timeout'}`);
}

/**
 * Spawn a new pi session in RPC mode.
 * @param {object} opts - { cwd, model, thinking }
 * @returns {Promise<RPCSession>}
 */
function shellQuote(s: string) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function splitShellWords(input: unknown) {
  const words = [];
  let cur = '';
  let quote = null;
  let escape = false;
  for (const ch of String(input)) {
    if (escape) { cur += ch; escape = false; continue; }
    if (ch === '\\' && quote !== "'") { escape = true; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (cur) { words.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words;
}

function parseLaunchSpec(spec: string) {
  const env: Record<string, string> = {};
  let words = splitShellWords(spec);
  if (words[0] === 'env') words = words.slice(1);
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const [key, ...rest] = words.shift()!.split('=');
    env[key] = rest.join('=');
  }
  return { env, argv: words };
}

function getPiAliasSpec() {
  const files = [path.join(os.homedir(), '.zshrc'), path.join(os.homedir(), '.bashrc')];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const match = text.match(/^\s*alias\s+pi=(['"])([\s\S]*?)\1\s*$/m)
      || text.match(/^\s*alias\s+pi=([^\n#]+)\s*$/m);
    if (match) return (match[2] || match[1] || '').trim();
  }
  return null;
}

// A bare `pi` must mean the HOST installation. Under `npm start`/`npm test`,
// npm prepends every ancestor node_modules/.bin to PATH — and pi-dish depends
// on the pi package, so its own shim (the vendored, usually older copy) would
// silently shadow the real one: sessions and --list-models ran pi 0.80.3
// while the host had 0.80.6 (new models missing, bridge testing the wrong
// version). Resolve against PATH minus node_modules dirs.
function resolveHostPi() {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir || dir.split(path.sep).includes('node_modules')) continue;
    const candidate = path.join(dir, 'pi');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return 'pi';
}

function getPiLaunchSpec() {
  let spec;
  if (process.env.PI_DISH_PI_COMMAND) {
    // Explicit config wins. Example:
    //   PI_DISH_PI_COMMAND="my-pi-wrapper --profile work"
    spec = parseLaunchSpec(process.env.PI_DISH_PI_COMMAND);
  } else {
    // Otherwise mirror simple aliases without sourcing interactive rc files:
    //   alias pi='AWS_PROFILE=work AWS_REGION=us-east-1 pi'
    //   alias pi='my-pi-wrapper --profile work'
    const alias = getPiAliasSpec();
    spec = alias ? parseLaunchSpec(alias) : { env: {}, argv: ['pi'] };
  }
  if (spec.argv[0] === 'pi') spec.argv[0] = resolveHostPi();
  return spec;
}

function spawnPi(args: string[], cwd: string | undefined) {
  const spec = getPiLaunchSpec();
  const env = { ...process.env, ...spec.env };
  const argv = spec.argv.length ? spec.argv : ['pi'];
  const shell = env.PI_DISH_PI_SHELL || env.SHELL;
  const shellName = shell ? path.basename(shell) : '';

  // Escape hatch for complex aliases/functions. Off by default because
  // interactive shell startup files often assume a TTY.
  if (env.PI_DISH_USE_PI_ALIAS === '1' && shell && ['zsh', 'bash'].includes(shellName)) {
    // Leave the command word unquoted so the interactive shell expands the
    // `pi` alias — quoting it (`'pi'`) suppresses alias expansion, defeating
    // the whole point of this escape hatch. Args are still quoted.
    const command = ['pi', ...args.map(shellQuote)].join(' ');
    return spawn(shell, ['-ic', command], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
  }

  return spawn(argv[0], [...argv.slice(1), ...args], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
}

async function createRPCSession(opts: RPCLaunchOptions = {}) {
  const args = ['--mode', 'rpc'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.thinking) args.push('--thinking', opts.thinking);

  const cwd = opts.cwd || process.env.HOME;
  const proc = spawnPi(args, cwd);

  return _initRPCSession(proc, { cwd });
}

/**
 * Resume an existing session by spawning pi --mode rpc --session <path>.
 * @param {string} sessionPath - Full path to the .jsonl session file
 * @param {string} cwd - Working directory to use
 * @returns {Promise<RPCSession>}
 */
// Dedupe concurrent resumes of the same session file. Resuming takes up to
// 20s (get_state polling) and the rpcSessions map isn't populated until it
// finishes, so without this two rapid resume requests each spawn their own pi
// against the same JSONL.
const resumingByPath = new Map<string, Promise<RPCSession>>(); // sessionPath -> Promise<RPCSession>

async function resumeRPCSession(sessionPath: string, cwd?: string) {
  const inFlight = resumingByPath.get(sessionPath);
  if (inFlight) return inFlight;

  const procCwd = cwd || process.env.HOME;
  const promise = _initRPCSession(spawnPi(['--mode', 'rpc', '--session', sessionPath], procCwd), { cwd: procCwd });
  resumingByPath.set(sessionPath, promise);
  try {
    return await promise;
  } finally {
    resumingByPath.delete(sessionPath);
  }
}

function getRPCSession(id: NativeSessionId) {
  return rpcSessions.get(id);
}

function getAllRPCSessions() {
  return [...rpcSessions.values()];
}

export = {
  RPCSession,
  createRPCSession,
  resumeRPCSession,
  getRPCSession,
  getAllRPCSessions,
  getPiLaunchSpec,
  rpcSessions,
};
