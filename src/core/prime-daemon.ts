/**
 * Prime Agent transport: pi-dish is a daemon client like `prime-agent attach`.
 * Protocol `prime-agent.daemon` v7, LF-delimited JSON over a Unix socket.
 * Supervisor commands: list, attach, detach, kill; session commands carry an
 * `activeSessionId` and use Pi-RPC names.
 */
import fs = require('fs');
import net = require('net');
import os = require('os');
import path = require('path');
import crypto = require('crypto');
import { setTimeout as delay } from 'timers/promises';
import type { NativeSessionId, PromptOptions } from './contracts';
import { createJsonLineSplitter } from './line-splitter';
import { PendingRequests } from './pending-requests';
import { asRecord, type ProtocolRecord } from './wire-protocol';
import { record as isRecord } from './helper-values';
import { errorMessage } from './http-boundary';
import { trackRunningToolCalls } from './running-tool-calls';
import { validSessionId } from './session-key';
import { getHarness, resolveLaunchSpec } from './harnesses';
import { promptParams, TransportSession } from './transport-session';

export const PRIME_DAEMON_PROTOCOL = Object.freeze({ name: 'prime-agent.daemon', version: 7 });

interface TreeOptions { summarize?: boolean; customInstructions?: string; label?: string; }
export interface PrimeQueueState { steering: string[]; followUp: string[]; }

function text(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
/**
 * Resolved like Prime itself: `--daemon-socket` in PI_DISH_PRIME_COMMAND, then
 * PRIME_AGENT_DAEMON_SOCKET (command, then server env), then the launcher's
 * per-user default. Managed launches pass it explicitly.
 */
export function primeDaemonSocket(env: NodeJS.ProcessEnv = process.env): string {
  const descriptor = getHarness('prime');
  const spec = descriptor ? resolveLaunchSpec(descriptor, env) : { env: {}, argv: [] as string[] };
  const flag = spec.argv.indexOf('--daemon-socket');
  const explicit = flag >= 0 ? spec.argv[flag + 1] : spec.argv.find(word => word.startsWith('--daemon-socket='))?.slice('--daemon-socket='.length);
  const configured = explicit || (spec.env as Record<string, string | undefined>).PRIME_AGENT_DAEMON_SOCKET || env.PRIME_AGENT_DAEMON_SOCKET;
  if (configured) return path.resolve(configured);
  const uid = typeof process.getuid === 'function' ? process.getuid() : os.userInfo().uid;
  return path.join(env.TMPDIR || '/tmp', `prime-agent-rust-${uid}`, 'daemon.sock');
}

export interface PrimeAgentSummary {
  activeSessionId: string;
  nativeSessionId: NativeSessionId;
  sessionFile: string;
  cwd: string | null;
  lifecycle: string | null;
  isStreaming: boolean;
  isCompacting: boolean;
  workerPid: number | null;
  workerInstanceId: string | null;
  attachedClients: number;
  sessionName: string | null;
  thinkingLevel: string | null;
  model: { provider: string; id: string } | null;
  queue: PrimeQueueState;
  lastActivityAt: string | null;
  created: string | null;
}

function queueFrom(actions: unknown): PrimeQueueState {
  const value = asRecord(actions);
  return { steering: strings(value.steering), followUp: strings(value.followUps ?? value.followUp) };
}

/** Root agents only: RLM children are discovered from their artifacts. */
export function primeRootSummary(row: unknown): PrimeAgentSummary | null {
  if (!isRecord(row)) return null;
  const activeSessionId = text(row.activeSessionId);
  const nativeSessionId = row.sessionId;
  const sessionFile = text(row.sessionFile);
  if (!activeSessionId || !validSessionId(nativeSessionId) || !sessionFile || !path.isAbsolute(sessionFile)) return null;
  if (row.runtimeKind === 'subagent' || row.parentActiveSessionId || row.parentSessionId || Number(row.rlmDepth) > 0) return null;
  const model = asRecord(row.model);
  return {
    activeSessionId, nativeSessionId, sessionFile,
    cwd: text(row.cwd),
    lifecycle: text(row.lifecycle),
    isStreaming: row.isStreaming === true,
    isCompacting: row.isCompacting === true,
    workerPid: typeof row.workerPid === 'number' ? row.workerPid : null,
    workerInstanceId: text(row.workerInstanceId),
    attachedClients: typeof row.attachedClients === 'number' ? row.attachedClients : 0,
    sessionName: text(row.sessionName) ?? text(row.name),
    thinkingLevel: text(row.thinkingLevel),
    model: text(model.provider) && text(model.id) ? { provider: model.provider as string, id: model.id as string } : null,
    queue: queueFrom(row.sessionActions),
    lastActivityAt: text(row.lastActivityAt),
    created: text(row.created),
  };
}

export class PrimeDaemonConnection {
  declare readonly socketPath: string;
  declare readonly clientId: string;
  declare hello: ProtocolRecord | null;
  declare alive: boolean;
  declare private sock: net.Socket | null;
  declare private pending: InstanceType<typeof PendingRequests>;
  declare private eventHandlers: Map<string, (event: ProtocolRecord) => void>;
  declare private closeHandlers: Set<(error: Error) => void>;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.clientId = `pi-dish:${crypto.randomUUID()}`;
    this.hello = null;
    this.alive = false;
    this.sock = null;
    this.pending = new PendingRequests();
    this.eventHandlers = new Map();
    this.closeHandlers = new Set();
  }

  connect({ timeout = 5000 } = {}): Promise<ProtocolRecord> {
    const hello = this.pending.track('__hello', { timeout, label: 'Prime daemon hello' });
    const sock = net.createConnection(this.socketPath);
    this.sock = sock;
    sock.on('error', error => this._closed(error));
    sock.on('close', () => this._closed(new Error('Prime daemon connection closed')));
    sock.on('data', createJsonLineSplitter(message => {
      if (message.type === 'daemon_hello') {
        const protocol = asRecord(message.protocol);
        if (protocol.name !== PRIME_DAEMON_PROTOCOL.name || protocol.version !== PRIME_DAEMON_PROTOCOL.version) {
          this.pending.settle('__hello', false, undefined,
            `Unsupported Prime daemon protocol ${String(protocol.name)} v${String(protocol.version)}; pi-dish speaks ${PRIME_DAEMON_PROTOCOL.name} v${PRIME_DAEMON_PROTOCOL.version}`);
          this.close();
          return;
        }
        this.hello = message;
        this.alive = true;
        this.pending.settle('__hello', true, message);
      } else if (message.type === 'response' && (typeof message.id === 'string' || typeof message.id === 'number')) {
        this.pending.settle(message.id, message.success === true, message.data,
          message.error ? String(message.error) : undefined, `Prime ${String(message.command || 'command')} failed`);
      } else if (message.type === 'session_event' && typeof message.activeSessionId === 'string' && isRecord(message.event)) {
        this.eventHandlers.get(message.activeSessionId)?.(message.event);
      }
    }));
    return hello as Promise<ProtocolRecord>;
  }

  request(command: ProtocolRecord & { type: string }, { timeout = 30000 } = {}): Promise<unknown> {
    if (!this.alive || !this.sock) return Promise.reject(new Error('Prime daemon is not connected'));
    const id = crypto.randomUUID();
    const result = this.pending.track(id, { timeout, label: `Prime ${command.type}` });
    try {
      this.sock.write(JSON.stringify({ type: 'command', id, protocol: PRIME_DAEMON_PROTOCOL, clientId: this.clientId, command: { ...command, id } }) + '\n');
    } catch (error) { this.pending.fail(id, error); }
    return result;
  }

  onEvents(activeSessionId: string, handler: (event: ProtocolRecord) => void): void { this.eventHandlers.set(activeSessionId, handler); }
  offEvents(activeSessionId: string): void { this.eventHandlers.delete(activeSessionId); }
  onClose(handler: (error: Error) => void): void { this.closeHandlers.add(handler); }

  private _closed(error: Error): void {
    if (!this.sock) return;
    this.sock = null;
    this.alive = false;
    this.pending.failAll(error);
    for (const handler of this.closeHandlers) handler(error);
  }

  close(): void {
    const sock = this.sock;
    if (!sock) return;
    this._closed(new Error('Prime daemon connection closed'));
    try { sock.destroy(); } catch {}
  }
}

export class PrimeDaemonSession extends TransportSession {
  declare readonly harnessId: 'prime';
  declare readonly activeSessionId: string;
  declare readonly daemonSocket: string;
  declare id: NativeSessionId;
  declare nativeSessionId: NativeSessionId;
  declare sessionFile: string;
  declare cwd: string | null;
  declare alive: boolean;
  declare summary: PrimeAgentSummary;
  declare queueState: PrimeQueueState;
  declare state: ProtocolRecord;
  declare attached: boolean;
  declare bounceExecuting?: boolean;
  declare bounceActivityRevision?: number;
  declare private daemon: PrimeDaemon;

  constructor(daemon: PrimeDaemon, summary: PrimeAgentSummary) {
    super();
    this.harnessId = 'prime';
    this.daemon = daemon;
    this.daemonSocket = daemon.socketPath;
    this.activeSessionId = summary.activeSessionId;
    this.alive = true;
    this.attached = false;
    this.turnInProgress = summary.isStreaming;
    this.compacting = summary.isCompacting;
    this.queueState = summary.queue;
    this.lastActivityAt = summary.lastActivityAt ? new Date(summary.lastActivityAt) : new Date();
    this.state = {};
    this.applySummary(summary);
  }

  /** Roster rows are authoritative for identity and the fields Prime emits no event for. */
  applySummary(summary: PrimeAgentSummary): void {
    const previousSessionId = this.summary?.nativeSessionId ?? null;
    const switched = previousSessionId !== null && previousSessionId !== summary.nativeSessionId;
    this.summary = summary;
    this.id = summary.nativeSessionId;
    this.nativeSessionId = summary.nativeSessionId;
    this.sessionFile = summary.sessionFile;
    this.cwd = summary.cwd;
    this.state = {
      ...this.state,
      sessionFile: summary.sessionFile,
      sessionName: summary.sessionName,
      name: summary.sessionName,
      thinkingLevel: summary.thinkingLevel,
      ...(summary.model ? { model: summary.model } : {}),
    };
    if (!this.attached) {
      this.turnInProgress = summary.isStreaming;
      this.compacting = summary.isCompacting;
      this.queueState = summary.queue;
    }
    // Listeners re-key the spawn record and retire the old route using the previous id.
    if (switched) this.emitEvent('session_switch', { sessionId: summary.nativeSessionId, previousSessionId });
  }

  _event(event: ProtocolRecord): void {
    const type = typeof event.type === 'string' ? event.type : null;
    if (!type) return;
    const msg = this.assistantFrame(event);
    trackRunningToolCalls(this.runningToolCalls, type, msg);
    if (type === 'agent_start' || type === 'turn_start') {
      this.turnInProgress = true;
      this.lastActivityAt = new Date();
    } else if (type === 'turn_end' || type === 'agent_end') {
      // Prime reports the end of a turn before the agent stops streaming.
      if (type === 'agent_end') {
        this.turnInProgress = false;
        this._refreshStats();
      }
      this.lastActivityAt = new Date();
    } else if (type === 'message_end') {
      this.lastActivityAt = new Date();
    } else if (type === 'compaction_start' || type === 'auto_compaction_start') {
      this.compacting = true;
    } else if (type === 'compaction_end' || type === 'auto_compaction_end') {
      this.compacting = false;
    } else if (type === 'session_action_update') {
      this.queueState = queueFrom(msg.actions);
      this.emitEvent('queue_update', this.queueState);
      return;
    } else if (type === 'session_info_changed') {
      if (typeof msg.name === 'string') this.state = { ...this.state, sessionName: msg.name, name: msg.name };
    }
    this.emitEvent(type, msg);
    this.endAssistantMessage(msg);
  }

  _retire(): void {
    if (!this.alive) return;
    this.alive = false;
    this.attached = false;
    this.turnInProgress = false;
    this.emitEvent('exit', { code: null });
    this.emitEvent('close', {});
  }

  send(command: string, params: ProtocolRecord = {}, { timeout = 30000 } = {}): Promise<unknown> {
    if (!this.alive) return Promise.reject(new Error('Prime agent is no longer running'));
    return this.daemon.request({ ...params, type: command, activeSessionId: this.activeSessionId }, { timeout });
  }

  async prompt(message: string, opts: PromptOptions = {}): Promise<unknown> {
    try {
      return await this.send('prompt', promptParams(message, opts, this.turnInProgress), { timeout: 120000 });
    } catch (error) {
      // An abort with queued messages restores them and pauses delivery until
      // the queue is edited (as in Prime's TUI); a plain prompt is refused.
      if (!/queued session input is suspended/i.test(errorMessage(error))) throw error;
      throw new Error('Prime paused its queued messages after the abort. Cancel one from the queue to resume delivery, then send again.', { cause: error });
    }
  }

  steer(message: string, opts: PromptOptions = {}): Promise<unknown> {
    return this.send('steer', { message, ...(opts.images?.length ? { images: opts.images } : {}) });
  }

  abort(): Promise<unknown> { return this.send('abort'); }

  compact(customInstructions?: string): Promise<unknown> {
    return this.send('compact', customInstructions ? { customInstructions } : {}, { timeout: 300000 });
  }

  async setModel(provider: string, modelId: string): Promise<unknown> {
    const model = await this.send('set_model', { provider, modelId });
    if (isRecord(model)) this.state = { ...this.state, model };
    return model;
  }

  async setName(name: string): Promise<unknown> {
    const result = await this.send('set_session_name', { name });
    this.state = { ...this.state, sessionName: name, name };
    return result;
  }

  async setThinkingLevel(level: string): Promise<unknown> {
    const result = await this.send('set_thinking_level', { level });
    this.state = { ...this.state, thinkingLevel: level };
    return result;
  }

  getState(): Promise<unknown> { return this.send('get_state'); }
  getCommands(): Promise<unknown> { return this.send('get_commands'); }
  getAvailableModels(): Promise<unknown> { return this.send('get_available_models'); }
  getSessionStats(): Promise<unknown> { return this.send('get_session_stats'); }
  getQueue(): Promise<unknown> { return this.send('get_queue'); }
  exportHtml(outputPath?: string): Promise<unknown> { return this.send('export_html', outputPath ? { outputPath } : {}, { timeout: 60000 }); }
  readTree(): Promise<unknown> { return this.send('get_session_tree', {}, { timeout: 10000 }); }

  navigateTree(targetId: string, opts: TreeOptions = {}): Promise<unknown> {
    const params: ProtocolRecord = { targetId };
    if (opts.summarize) params.summarize = true;
    if (opts.customInstructions) params.customInstructions = opts.customInstructions;
    if (opts.label) params.label = opts.label;
    return this.send('navigate_tree', params, { timeout: 180000 });
  }

  /** Prime refuses the mutation unless `text` still names that queued entry. */
  async cancelQueued(kind: 'steering' | 'followUp', index: number, text: string): Promise<unknown> {
    const result = await this.send('mutate_queued_message', { lane: kind, index, expectedText: text, mutation: { type: 'delete' } });
    if (!isRecord(result) || result.status !== 'applied') {
      throw new Error('That queued message was already delivered or changed; refresh the queue and try again.');
    }
    return result;
  }

  respondExtensionUI(): Promise<unknown> {
    return Promise.reject(new Error('Prime Agent has no extension UI'));
  }
}

export interface PrimeStopObservation { activeSessionId: string; workerInstanceId: string | null; sessionFile: string; }

/** Roster cache and connection for one daemon socket; unreachable means no live Prime agents. */
export class PrimeDaemon {
  declare readonly socketPath: string;
  declare private connection: PrimeDaemonConnection | null;
  declare private connecting: Promise<PrimeDaemonConnection> | null;
  declare private sessions: Map<string, PrimeDaemonSession>;
  declare private refreshing: Promise<PrimeDaemonSession[]> | null;
  declare private timer: NodeJS.Timeout | null;
  declare lastError: string | null;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.connection = null;
    this.connecting = null;
    this.sessions = new Map();
    this.refreshing = null;
    this.timer = null;
    this.lastError = null;
  }

  private async connected(): Promise<PrimeDaemonConnection> {
    if (this.connection?.alive) return this.connection;
    if (this.connecting) return this.connecting;
    const connection = new PrimeDaemonConnection(this.socketPath);
    this.connecting = connection.connect().then(() => {
      connection.onClose(() => {
        if (this.connection !== connection) return;
        this.connection = null;
        for (const session of this.sessions.values()) session.attached = false;
      });
      this.connection = connection;
      return connection;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  request(command: ProtocolRecord & { type: string }, options: { timeout?: number } = {}): Promise<unknown> {
    return this.connected().then(connection => connection.request(command, options));
  }

  list(): PrimeDaemonSession[] { return [...this.sessions.values()].filter(session => session.alive); }

  byNativeId(nativeSessionId: unknown): PrimeDaemonSession | null {
    for (const session of this.sessions.values()) if (session.alive && session.nativeSessionId === nativeSessionId) return session;
    return null;
  }

  byActiveSessionId(activeSessionId: unknown): PrimeDaemonSession | null {
    const session = typeof activeSessionId === 'string' ? this.sessions.get(activeSessionId) : null;
    return session?.alive ? session : null;
  }

  refresh(): Promise<PrimeDaemonSession[]> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this._refresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async _refresh(): Promise<PrimeDaemonSession[]> {
    if (!fs.existsSync(this.socketPath)) {
      this.connection?.close();
      this.retireAll();
      this.lastError = null;
      return [];
    }
    let rows: unknown[];
    let connection: PrimeDaemonConnection;
    try {
      connection = await this.connected();
      const roster = asRecord(await connection.request({ type: 'list' }, { timeout: 5000 }));
      rows = Array.isArray(roster.sessions) ? roster.sessions : [];
      this.lastError = null;
    } catch (error) {
      this.lastError = errorMessage(error);
      this.retireAll();
      return [];
    }
    const seen = new Set<string>();
    for (const row of rows) {
      const summary = primeRootSummary(row);
      if (!summary) continue;
      seen.add(summary.activeSessionId);
      let session = this.sessions.get(summary.activeSessionId);
      if (session && !session.alive) { this.sessions.delete(summary.activeSessionId); session = undefined; }
      if (session) session.applySummary(summary);
      else {
        session = new PrimeDaemonSession(this, summary);
        this.sessions.set(summary.activeSessionId, session);
      }
      if (!session.attached) await this.attach(connection, session);
    }
    for (const [id, session] of this.sessions) {
      if (seen.has(id)) continue;
      this.sessions.delete(id);
      connection.offEvents(id);
      session._retire();
    }
    return this.list();
  }

  private async attach(connection: PrimeDaemonConnection, session: PrimeDaemonSession): Promise<void> {
    connection.onEvents(session.activeSessionId, event => session._event(event));
    try {
      const attached = asRecord(await connection.request({ type: 'attach', activeSessionId: session.activeSessionId }, { timeout: 10000 }));
      const snapshot = asRecord(attached.snapshot);
      const state = asRecord(snapshot.state);
      session.attached = true;
      session.turnInProgress = state.isStreaming === true || session.summary.isStreaming;
      session.compacting = state.isCompacting === true || session.summary.isCompacting;
      if (isRecord(state.sessionActions)) session.queueState = queueFrom(state.sessionActions);
    } catch {
      // A worker that is still starting refuses attach; the next refresh retries.
      connection.offEvents(session.activeSessionId);
    }
  }

  private retireAll(): void {
    for (const session of this.sessions.values()) session._retire();
    this.sessions.clear();
  }

  async waitFor(predicate: (summary: PrimeAgentSummary) => boolean, { timeout = 30000, interval = 250 } = {}): Promise<PrimeDaemonSession[]> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const matches = (await this.refresh()).filter(session => predicate(session.summary));
      if (matches.length || Date.now() >= deadline) return matches;
      await delay(Math.min(interval, Math.max(1, deadline - Date.now())));
    }
  }

  /** Re-reads the roster first: agent, worker and transcript must still match. No retry; a lost reply is indeterminate. */
  async stop(expected: PrimeStopObservation, beforeStop: () => void | Promise<void>, { timeout = 10000 } = {}): Promise<void> {
    let stopRequested = false;
    try {
      const roster = asRecord(await this.request({ type: 'list' }, { timeout }));
      const rows = Array.isArray(roster.sessions) ? roster.sessions : [];
      const matches = rows.filter(row => isRecord(row) && row.activeSessionId === expected.activeSessionId);
      const current = matches.length === 1 ? primeRootSummary(matches[0]) : null;
      if (!current || current.workerInstanceId !== expected.workerInstanceId || current.sessionFile !== expected.sessionFile) {
        throw new Error('Prime daemon roster does not match the owned root agent');
      }
      await beforeStop();
      stopRequested = true;
      await this.request({ type: 'kill', activeSessionId: expected.activeSessionId }, { timeout });
      const deadline = Date.now() + timeout;
      for (;;) {
        const live = (await this.refresh()).some(session => session.activeSessionId === expected.activeSessionId);
        if (!live) return;
        if (Date.now() >= deadline) throw new Error('Prime agent did not leave the daemon roster after stop');
        await delay(100);
      }
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { stopRequested });
    }
  }

  start(intervalMs = 1500): void {
    if (this.timer) return;
    this.refresh().catch(() => {});
    this.timer = setInterval(() => { this.refresh().catch(() => {}); }, intervalMs);
    this.timer.unref();
  }

  shutdown(): void {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    this.connection?.close();
    this.connection = null;
    this.retireAll();
  }
}

let current: PrimeDaemon | null = null;

/** The daemon for the configured Prime launch; replaced when the socket changes. */
export function getPrimeDaemon(env: NodeJS.ProcessEnv = process.env): PrimeDaemon {
  const socketPath = primeDaemonSocket(env);
  if (current?.socketPath !== socketPath) {
    current?.shutdown();
    current = new PrimeDaemon(socketPath);
  }
  return current;
}

export function resetPrimeDaemon(): void {
  current?.shutdown();
  current = null;
}
