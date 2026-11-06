/**
 * Manages pi sessions spawned via `pi --mode rpc`: {"type": command, ...} in,
 * {"type":"response"|event, ...} out. Framing is LF-only, never readline's.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { once } from 'events';
import { fileURLToPath } from 'url';
import fs = require('fs');
import os = require('os');
import path = require('path');
import crypto = require('crypto');
import { createJsonLineSplitter } from './line-splitter';
import { PendingRequests } from './pending-requests';
import { asRecord, decodeRPCFrame, isRecord, type ProtocolRecord } from './wire-protocol';
import { errorMessage } from './http-boundary';
import { trackRunningToolCalls } from './running-tool-calls';
import { reduceExtensionUIState } from './extension-ui-state';
import { safeHeaderSessionId } from './session-discovery';
import { processIdentity, processIdentityAlive } from './process-identity';
import { createSessionObserver, type RecoveryObserver } from './session-recovery';
import { promptParams, TransportSession } from './transport-session';
import type { LaunchOptions, NativeSessionId, PromptOptions } from './contracts';
import { validSessionId } from './session-key';
import { getPiLaunchSpec } from './harness-launch-spec';

interface RPCLaunchOptions extends LaunchOptions { cwd?: unknown; }

class RPCIdentityError extends TypeError {}
function validatedNativeId(value: unknown): NativeSessionId {
  if (!validSessionId(value)) throw new RPCIdentityError('Invalid RPC session identity');
  return value;
}

function errorCode(error: unknown): unknown { return isRecord(error) ? error.code : undefined; }
class RPCSession extends TransportSession {
  declare id: NativeSessionId;
  declare proc: ChildProcessWithoutNullStreams;
  declare alive: boolean;
  declare pending: InstanceType<typeof PendingRequests>;
  declare nextRequestId: number;
  declare state: ProtocolRecord | null;
  declare sessionFile: string | null;
  declare cwd: string | null;
  declare stderrTail: string[];
  declare recoveryBridgeOwned: boolean;
  declare recoveryInstanceId: string;
  declare recoveryStartTime: string | null;
  declare recoveryObserver: RecoveryObserver;
  declare bounceExecuting?: boolean;
  declare bounceActivityRevision?: number;

  constructor(id: NativeSessionId, proc: ChildProcessWithoutNullStreams) {
    super();
    this.id = id;
    this.proc = proc;
    this.alive = true;
    this.pending = new PendingRequests();
    this.nextRequestId = 1;
    this.state = null;
    this.sessionFile = null;
    this.cwd = null;
    this.stderrTail = []; // last few stderr lines for error reporting
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

    proc.stdout.on('data', createJsonLineSplitter((message) => { this._handleMessage(message); }));

    proc.on('exit', (code) => {
      this.recoveryObserver.event('shutdown');
      this.recoveryObserver.dispose();
      this.alive = false;
      const err = new Error(`pi exited with code ${code}${this.stderrTail.length ? ': ' + this.stderrTail.join(' | ') : ''}`);
      this.pending.failAll(err);
      this.emitEvent('exit', { code });
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
      // A null ownership record stays fail-closed.
      if (claim === null) throw new TypeError('Invalid bridge recovery claim');
      if (isRecord(claim) && claim.recoveryObservation === true && claim.harnessId === 'pi'
        && claim.sessionFile === this.sessionFile && processIdentityAlive({
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
    const msg = this.assistantFrame(frame.data);

    trackRunningToolCalls(this.runningToolCalls, frame.event, msg);
    this.recoveryObserver.event(frame.event, msg);

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

    reduceExtensionUIState(this.extUIState, frame.event, msg);
    this.emitEvent(frame.event, msg);
    this.endAssistantMessage(msg);
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
    return this.send('prompt', promptParams(message, opts, this.turnInProgress), { timeout: 120000 });
  }
  async steer(message: string, opts: PromptOptions = {}) {
    const params: ProtocolRecord = { message };
    if (opts.images?.length) params.images = opts.images;
    return this.send('steer', params);
  }
  // The session list reads state.model/state.sessionName, so the setters patch
  // it alongside the harness.
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

  respondExtensionUI(requestId: string, response: ProtocolRecord) {
    this.write({ type: 'extension_ui_response', id: requestId, ...response });
  }

  kill() {
    if (this.alive) {
      this.proc.kill('SIGTERM');
    }
  }
}

const rpcSessions = new Map<NativeSessionId, RPCSession>();

/** Poll get_state until pi answers rather than sleeping for a fixed guess. */
async function _initRPCSession(proc: ChildProcessWithoutNullStreams, opts: { cwd?: string | null } = {}) {
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

function shellQuote(s: unknown) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function spawnPi(args: unknown[], cwd: unknown) {
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
    // Native spawn owns cwd validation; no first-party coercion before it.
    return spawn(shell, ['-ic', command], { cwd: cwd as string | undefined, stdio: ['pipe', 'pipe', 'pipe'], env });
  }

  // Native spawn retains legacy argument coercion/rejection; this does not validate saved selections.
  return spawn(argv[0], [...argv.slice(1), ...args] as string[], {
    cwd: cwd as string | undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
}

async function createRPCSession(opts: RPCLaunchOptions = {}) {
  const args: unknown[] = ['--mode', 'rpc'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.thinking) args.push('--thinking', opts.thinking);
  if (opts.sessionDir) args.push('--session-dir', opts.sessionDir);

  const cwd = opts.cwd || process.env.HOME;
  const proc = spawnPi(args, cwd);

  if (typeof cwd === 'string' || cwd === undefined) return _initRPCSession(proc, { cwd });
  // A failed native spawn has no pid. Retain the initializer's existing native
  // error path before attempting any metadata conversion.
  if (proc.pid === undefined) return _initRPCSession(proc);
  let metadataCwd: string;
  try {
    // File URL metadata is a path, not a URL string. Native-accepted byte cwd
    // does not have matching decoding in async spawn; never guess its metadata.
    if (!(cwd instanceof URL)) throw new TypeError('Cannot faithfully represent native RPC cwd metadata');
    metadataCwd = fileURLToPath(cwd);
  } catch (error) {
    // No RPCSession owns this successfully spawned child yet. Await its actual
    // close, and let any native error take precedence over the metadata failure.
    const closed = once(proc, 'close');
    proc.kill('SIGKILL');
    await closed;
    throw error;
  }
  return _initRPCSession(proc, { cwd: metadataCwd });
}

// Resuming takes up to 20s and the registry is only populated at the end, so
// two rapid resumes would otherwise spawn two pis against one JSONL.
const resumingByPath = new Map<string, Promise<RPCSession>>();

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
  rpcSessions,
};
