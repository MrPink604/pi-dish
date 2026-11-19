#!/usr/bin/env node
/**
 * Antigravity bridge relay: one per `agy` session, launched by pi-dish into the
 * session's tmux pane. It owns the `agy acp` stdio child (through AcpSession),
 * keeps the Pi-format mirror and the raw sidecar, publishes the bridge registry
 * claim, and serves pi-dish's bridge socket protocol. Because the pane — not a
 * server child — owns the ACP state, a pi-dish restart reconnects to a turn
 * that is still running instead of losing it.
 *
 * Usage:
 *   agy-relay new --cwd <dir> [--model <id>] [--thinking <level>]
 *   agy-relay resume <mirror.jsonl> [--model <id>] [--thinking <level>]
 *
 * `PI_DISH_AGY_COMMAND` still names the agy binary (a shell-style command line);
 * `PI_DISH_SPAWN_TOKEN` correlates this claim with the launch that started it.
 * Nothing here reads agy tokens or injects prompt text.
 */
import fs = require('fs');
import net = require('net');
import path = require('path');
import crypto = require('crypto');
import { once } from 'events';
import { setTimeout as delay } from 'timers/promises';
import { createAcpSession, resumeAcpSession, type AcpSession } from './acp-session';
import { AGY_PROVIDER } from './acp-transcript';
import { hasActiveAgyBrainWork } from './agy-brain';
import { AGY_ACP_CAPABILITIES } from './session-capabilities';
import { dishDir } from './dish-store';
import { parseLaunchWords } from './harnesses';
import { processIdentity } from './process-identity';
import { removeExtensionUIDialog } from './extension-ui-state';
import { asRecord, type ProtocolRecord } from './wire-protocol';
import { record as isRecord } from './helper-values';
import { createSessionObserver } from './session-recovery';
import type { RecoverySnapshot } from './session-recovery';
import { errorMessage } from './http-boundary';

const REGISTRY_DIR = path.join(dishDir(), 'sessions');
const MAX_SOCKET_PATH_BYTES = 103;
/** AcpSession events fanned out to every connected pi-dish socket. */
const BRIDGE_EVENTS = [
  'agent_start', 'turn_start', 'message_start', 'message_update', 'message_end',
  'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
  'turn_end', 'agent_end', 'extension_ui_request',
] as const;
/** Boundaries after which the registry claim is refreshed. */
const CLAIM_BOUNDARIES: Readonly<Record<string, true>> = {
  agent_start: true, turn_start: true, message_end: true, turn_end: true, agent_end: true,
  extension_ui_request: true,
};

interface RelayOptions {
  mode: 'new' | 'resume';
  cwd?: string;
  file?: string;
  model?: string;
  thinking?: string;
}

// A closed pane (close, hibernation, user kill) breaks the pty; logging must
// never turn that into an uncaught stream error that keeps the relay alive.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

function log(line: string): void {
  try { process.stdout.write(`[agy-relay] ${line}\n`); } catch {}
}

function optionValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseRelayArgs(argv: readonly string[]): RelayOptions {
  const [mode, ...rest] = argv;
  let options: RelayOptions;
  if (mode === 'new') options = { mode };
  else if (mode === 'resume') {
    if (!rest[0] || rest[0].startsWith('--')) throw new Error('resume requires a mirror path');
    options = { mode, file: rest[0] };
    rest.shift();
  } else {
    throw new Error('usage: agy-relay new --cwd <dir> | agy-relay resume <mirror.jsonl>');
  }
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    const equals = flag.indexOf('=');
    const name = equals > 0 ? flag.slice(0, equals) : flag;
    const inline = equals > 0 ? flag.slice(equals + 1) : null;
    const read = () => inline ?? optionValue(rest, ++index, name);
    if (name === '--cwd') options.cwd = read();
    else if (name === '--model') options.model = read();
    else if (name === '--thinking') options.thinking = read();
    else throw new Error(`unknown relay argument: ${flag}`);
  }
  if (options.mode === 'new' && !options.cwd) options.cwd = process.cwd();
  return options;
}

function socketPathFor(sessionId: string): string {
  const dir = process.env.PI_DISH_SOCKET_DIR || path.join(dishDir(), 'sockets');
  const file = path.join(dir, `${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}.sock`);
  const bytes = Buffer.byteLength(file);
  if (bytes > MAX_SOCKET_PATH_BYTES) {
    throw new Error(`Unix socket path is ${bytes} bytes (maximum ${MAX_SOCKET_PATH_BYTES}): ${file}`);
  }
  return file;
}

function wrapperVersion(): string {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const version = isRecord(raw) ? raw.version : undefined;
    return typeof version === 'string' && version ? version : '0';
  } catch { return '0'; }
}

/** `PI_DISH_AGY_COMMAND` is a command line; AcpSession appends the ACP argv. */
function agyChildLaunch(): { command: string; args: string[]; env: Record<string, string> } {
  const parsed = parseLaunchWords(process.env.PI_DISH_AGY_COMMAND || 'agy');
  const words = parsed.words.length ? parsed.words : ['agy'];
  return { command: words[0], args: words.slice(1), env: parsed.env };
}

async function main(): Promise<void> {
  const options = parseRelayArgs(process.argv.slice(2));
  const child = agyChildLaunch();
  const relayInstanceId = crypto.randomUUID();
  const relayProcess = processIdentity(process.pid);
  if (!relayProcess) throw new Error('Cannot read this process birth identity; refusing to publish a stale claim');

  let session: AcpSession;
  if (options.mode === 'new') {
    session = await createAcpSession({
      cwd: options.cwd || process.cwd(),
      model: options.model ?? null,
      thinking: options.thinking ?? null,
      ...child,
    });
  } else {
    session = await resumeAcpSession(options.file!, {
      model: options.model ?? null,
      thinking: options.thinking ?? null,
      ...child,
    });
  }

  const clients = new Set<net.Socket>();
  let server: net.Server | null = null;
  let socketPath = '';
  let socketIno: number | null = null;
  let socketReady = false;
  let shuttingDown = false;
  const wrapper = Object.freeze({
    harnessId: 'agy', name: 'pi-dish-agy-relay', wrapperVersion: wrapperVersion(),
    eventProfile: 'agy-v1',
  });

  function contextUsageSnapshot(): ProtocolRecord | null {
    const usage = asRecord(asRecord(session.lastStats).contextUsage);
    const tokens = typeof usage.tokens === 'number' && Number.isFinite(usage.tokens) ? usage.tokens : null;
    const contextWindow = typeof usage.contextWindow === 'number' && Number.isFinite(usage.contextWindow) ? usage.contextWindow : null;
    const percent = typeof usage.percent === 'number' && Number.isFinite(usage.percent) ? usage.percent : null;
    if (tokens === null && contextWindow === null) return null;
    return { tokens, contextWindow, percent };
  }

  function modelSnapshot(): string | null {
    const model = asRecord(session.state.model);
    const id = typeof model.id === 'string' && model.id ? model.id : null;
    const provider = typeof model.provider === 'string' && model.provider ? model.provider : AGY_PROVIDER;
    return id ? `${provider}/${id}` : null;
  }

  /** Set by the last assistant `message_end`; the observer's agent_end needs it. */
  let lastAssistantMessage: ProtocolRecord | null = null;

  function recoverySnapshot(): RecoverySnapshot | null {
    if (!session.sessionFile || !session.cwd) return null;
    const state = asRecord(session.state);
    return {
      harnessId: 'agy', nativeSessionId: session.id, sessionFile: session.sessionFile, cwd: session.cwd,
      name: typeof state.name === 'string' && state.name ? state.name : null,
      model: modelSnapshot(),
      thinkingLevel: typeof state.thinkingLevel === 'string' && state.thinkingLevel ? state.thinkingLevel : null,
      pid: process.pid, startTime: relayProcess!.startTime, instanceId: relayInstanceId,
    };
  }

  // The relay owns the agy process, so it publishes the same lifecycle
  // observations the Pi/OMP bridge extensions write inside their hosts.
  const recovery = createSessionObserver({ snapshot: recoverySnapshot });
  recovery.initialize();

  /** Registry/hello claim: identity fields are immutable for this relay. */
  function claim(): ProtocolRecord {
    const state = asRecord(session.state);
    const name = typeof state.name === 'string' && state.name ? state.name : null;
    const thinkingLevel = typeof state.thinkingLevel === 'string' && state.thinkingLevel ? state.thinkingLevel : null;
    return {
      protocolVersion: 2,
      wrapper,
      harnessId: 'agy',
      bridgeInstanceId: relayInstanceId,
      instanceId: relayInstanceId,
      nativeSessionId: session.id,
      sessionId: session.id,
      capabilities: AGY_ACP_CAPABILITIES,
      sessionFile: session.sessionFile,
      cwd: session.cwd,
      pid: process.pid,
      startTime: relayProcess!.startTime,
      socketPath,
      name,
      model: modelSnapshot(),
      thinkingLevel,
      contextUsage: contextUsageSnapshot(),
      turnInProgress: session.turnInProgress === true,
      askPending: session.extUIState.dialogs.size > 0,
      compacting: false,
      spawnToken: process.env.PI_DISH_SPAWN_TOKEN || null,
    };
  }

  function lifecycleSnapshot(): ProtocolRecord {
    const pendingDialogs = session.extUIState.dialogs.size;
    const backgroundWork = session.hasActiveToolWork || hasActiveAgyBrainWork(session.id);
    return {
      idle: !session.turnInProgress && pendingDialogs === 0 && !backgroundWork,
      pendingMessages: false,
      pendingDialogs,
      backgroundWork,
    };
  }

  function runningToolsSnapshot(): ProtocolRecord[] {
    const out: ProtocolRecord[] = [];
    for (const [toolCallId, call] of session.runningToolCalls) {
      out.push({ toolCallId, toolName: call.toolName, args: call.args, startedAt: call.startedAt });
    }
    return out;
  }

  function writeClaim(): void {
    if (!socketReady) return;
    try {
      fs.mkdirSync(REGISTRY_DIR, { recursive: true });
      fs.writeFileSync(path.join(REGISTRY_DIR, `${session.id}.json`),
        JSON.stringify({ ...claim(), updatedAt: new Date().toISOString() }, null, 2));
      // The claim mirrors the lifecycle fields; name/model/thinking changes are
      // metadata and are recorded with the same observation.
      recovery.event('metadata');
    } catch (error) {
      log(`claim write failed: ${errorMessage(error)}`);
    }
  }

  function send(sock: net.Socket, frame: unknown): void {
    try { sock.write(JSON.stringify(frame) + '\n'); } catch {}
  }

  function broadcast(frame: unknown): void {
    const line = JSON.stringify(frame) + '\n';
    for (const client of clients) {
      try { client.write(line); } catch {}
    }
  }

  function replayExtensionUI(sock: net.Socket): void {
    const ui = session.extUIState;
    for (const request of [...ui.widgets.values(), ...ui.statuses.values(), ...ui.dialogs.values()]) {
      send(sock, { type: 'event', event: 'extension_ui_request', data: request });
    }
  }

  function replayRunningTools(sock: net.Socket): void {
    for (const [toolCallId, call] of session.runningToolCalls) {
      const common = { toolCallId, toolName: call.toolName, args: call.args, startedAt: call.startedAt };
      send(sock, { type: 'event', event: 'tool_execution_start', data: common });
      if (call.lastPartialResult != null) {
        send(sock, { type: 'event', event: 'tool_execution_update', data: { ...common, partialResult: call.lastPartialResult } });
      }
    }
  }

  function respond(sock: net.Socket, cmd: ProtocolRecord, success: boolean, data?: unknown, error?: string): void {
    send(sock, {
      type: 'response', id: cmd.id ?? null, command: cmd.command, success,
      ...(data === undefined ? {} : { data }),
      ...(error ? { error } : {}),
    });
  }

  function splitCommand(message: string): { name: string; args: string } {
    const space = message.indexOf(' ');
    return {
      name: (space === -1 ? message.slice(1) : message.slice(1, space)).trim(),
      args: space === -1 ? '' : message.slice(space + 1).trim(),
    };
  }

  /** `/model`, `/thinking` and `/abort` are ACP requests; agy's own commands are prompt text. */
  async function runCommand(message: string): Promise<unknown> {
    const { name, args } = splitCommand(message);
    if (name === 'abort') {
      await session.abort();
      return { info: 'Aborted' };
    }
    if (name === 'tasks') return { info: 'Open the Tasks view in pi-dish to inspect background tasks and plans.' };
    if (name === 'agents') return { info: 'Open the Subagents view in pi-dish to inspect subagents.' };
    if (name === 'swarm' && /^board(?:\s|$)/i.test(args)) {
      return { info: 'Open the Swarm view in pi-dish to watch the live board.' };
    }
    if (name === 'thinking') {
      if (!args) throw new Error('usage: /thinking <level>');
      await session.setThinkingLevel(args);
      return { info: `Thinking level: ${args}` };
    }
    if (name === 'model') {
      if (!args) throw new Error('usage: /model <provider/model-id>');
      const slash = args.indexOf('/');
      await session.setModel(slash > 0 ? args.slice(0, slash) : AGY_PROVIDER,
        slash > 0 ? args.slice(slash + 1) : args);
      return { info: `Model set to ${args}` };
    }
    const listed = asRecord(await session.getCommands());
    const known = Array.isArray(listed.commands)
      ? listed.commands.flatMap(row => isRecord(row) && typeof row.name === 'string' ? [row.name] : [])
      : [];
    if (!known.includes(name)) throw new Error(`unknown or unsupported command: /${name}`);
    await session.prompt(message);
    return {};
  }

  async function handleCommand(cmd: ProtocolRecord, sock: net.Socket): Promise<void> {
    try {
      switch (cmd.command) {
        case 'ping':
          respond(sock, cmd, true, { pong: true });
          return;
        case 'get_state':
          respond(sock, cmd, true, {
            ...claim(),
            lifecycle: lifecycleSnapshot(),
            plan: session.getPlan(),
            runningTools: runningToolsSnapshot(),
          });
          return;
        case 'prompt':
        case 'steer': {
          const message = typeof cmd.message === 'string' ? cmd.message : '';
          if (!message) return respond(sock, cmd, false, undefined, 'message required');
          const images = Array.isArray(cmd.images) ? cmd.images : undefined;
          const opts = images ? { images } : {};
          await (cmd.command === 'steer' ? session.steer(message, opts) : session.prompt(message, opts));
          writeClaim();
          respond(sock, cmd, true, { queued: false });
          return;
        }
        case 'abort':
          await session.abort();
          writeClaim();
          respond(sock, cmd, true);
          return;
        case 'set_model': {
          const requested = typeof cmd.model === 'string' && cmd.model ? cmd.model
            : typeof cmd.provider === 'string' && typeof cmd.modelId === 'string' ? `${cmd.provider}/${cmd.modelId}` : '';
          if (!requested) return respond(sock, cmd, false, undefined, 'model required');
          const slash = requested.indexOf('/');
          await session.setModel(slash > 0 ? requested.slice(0, slash) : AGY_PROVIDER,
            slash > 0 ? requested.slice(slash + 1) : requested);
          writeClaim();
          respond(sock, cmd, true, { model: modelSnapshot() });
          return;
        }
        case 'set_thinking_level':
          if (typeof cmd.level !== 'string' || !cmd.level) {
            return respond(sock, cmd, false, undefined, 'level required');
          }
          await session.setThinkingLevel(cmd.level);
          writeClaim();
          respond(sock, cmd, true, { level: cmd.level });
          return;
        case 'get_available_models':
          respond(sock, cmd, true, await session.getAvailableModels());
          return;
        case 'get_commands': {
          const base = asRecord(await session.getCommands());
          const rows = Array.isArray(base.commands) ? [...base.commands] : [];
          const names = new Set(rows.flatMap(row => isRecord(row) && typeof row.name === 'string' ? [row.name] : []));
          const extras = [
            { name: 'swarm board', description: 'Open the live Swarm board and worker roster in pi-dish.' },
            { name: 'tasks', description: 'Open background tasks, live logs, subagents, and plan progress in pi-dish.' },
            { name: 'agents', description: 'Open the Subagents family view in pi-dish.' },
          ];
          for (const extra of extras) {
            if (!names.has(extra.name)) rows.push(extra);
          }
          respond(sock, cmd, true, { commands: rows });
          return;
        }
        case 'run_command': {
          if (typeof cmd.message !== 'string' || !cmd.message.startsWith('/')) {
            return respond(sock, cmd, false, undefined, 'message must start with /');
          }
          const result = asRecord(await runCommand(cmd.message));
          writeClaim();
          respond(sock, cmd, true, Object.keys(result).length ? result : undefined);
          return;
        }
        case 'extension_ui_response': {
          const requestId = String(cmd.requestId ?? '');
          if (!requestId || !session.extUIState.dialogs.has(requestId)) {
            return respond(sock, cmd, false, undefined, `no pending dialog with id ${requestId}`);
          }
          await session.respondExtensionUI(requestId, cmd);
          removeExtensionUIDialog(session.extUIState, requestId);
          broadcast({ type: 'event', event: 'extension_ui_resolved', data: { id: requestId, source: 'pi-dish' } });
          writeClaim();
          respond(sock, cmd, true);
          return;
        }
        default:
          respond(sock, cmd, false, undefined, `unsupported command ${String(cmd.command)}`);
      }
    } catch (error) {
      respond(sock, cmd, false, undefined, errorMessage(error));
    }
  }

  function handleClient(sock: net.Socket): void {
    clients.add(sock);
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => {});
    let buffer = '';
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;
        let cmd: unknown;
        try { cmd = JSON.parse(line); } catch { respond(sock, {}, false, undefined, 'invalid JSON frame'); continue; }
        if (!isRecord(cmd)) { respond(sock, {}, false, undefined, 'invalid command frame'); continue; }
        void handleCommand(cmd, sock);
      }
    });
    send(sock, { type: 'hello', ...claim(), lifecycle: lifecycleSnapshot() });
    replayExtensionUI(sock);
    replayRunningTools(sock);
  }

  function unlinkOwnedClaim(): void {
    const file = path.join(REGISTRY_DIR, `${session.id}.json`);
    try {
      const current: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isRecord(current) && current.instanceId === relayInstanceId) fs.unlinkSync(file);
    } catch {}
  }

  /** Never unlink a socket a replacement relay already bound at the same path. */
  function unlinkOwnedSocket(): void {
    if (!socketPath) return;
    try {
      if (socketIno !== null && fs.statSync(socketPath).ino !== socketIno) return;
      fs.unlinkSync(socketPath);
    } catch {}
  }

  async function shutdown(reason: string, code: number, agentExited = false): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    // A stuck ACP close must not keep a dead pane's relay alive forever.
    setTimeout(() => { process.exit(code); }, 5000).unref();
    log(`stopping: ${reason}`);
    for (const client of clients) {
      try { client.destroy(); } catch {}
    }
    clients.clear();
    if (server) { try { server.close(); } catch {} }
    socketReady = false;
    // Retire the claim and socket before the possibly slow ACP close, so a
    // restart's replacement relay cannot inherit either path.
    unlinkOwnedClaim();
    unlinkOwnedSocket();
    const wasAlive = session.alive;
    // `close()` makes agy exit, and its exit handler appends the open assistant
    // segment to the mirror: partial text survives a stop or a relay fault.
    try { await session.close(); } catch {}
    if (agentExited) {
      // Re-checkpoint the transcript the agent left behind; the interrupted
      // turn keeps its identity, so recovery may continue from that state.
      recovery.event('metadata');
      await delay(0);
    } else if (wasAlive) {
      // A signal stopped the whole session, not the agent alone: review it.
      recovery.event('shutdown');
    }
    recovery.dispose();
    process.exit(code);
  }

  for (const event of BRIDGE_EVENTS) {
    session.on(event, (data) => {
      broadcast({ type: 'event', event, data });
      if (event === 'message_end') {
        const message = asRecord(data).message;
        if (isRecord(message) && message.role === 'assistant') lastAssistantMessage = message;
        recovery.event('message_end', data);
      } else if (event === 'agent_end') {
        // Pi/OMP hosts hand agent_end the finished messages; agy has no such
        // payload, but the last assistant message carries its stop reason.
        recovery.event('agent_end', { messages: lastAssistantMessage ? [lastAssistantMessage] : [] });
        lastAssistantMessage = null;
      } else {
        recovery.event(event, data);
      }
      if (Object.hasOwn(CLAIM_BOUNDARIES, event)) writeClaim();
    });
  }
  session.on('exit', (data) => {
    void shutdown(`agy exited with code ${String(asRecord(data).code)}`, 1, true);
  });
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) {
    process.on(signal, () => { void shutdown(signal, 0); });
  }
  // A relay fault must still flush the open segment and retire its claim.
  for (const failure of ['uncaughtException', 'unhandledRejection'] as const) {
    process.on(failure, (error: unknown) => {
      log(`${failure}: ${errorMessage(error)}`);
      void shutdown(failure, 1);
    });
  }

  socketPath = socketPathFor(session.id);
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  try { fs.unlinkSync(socketPath); } catch {}
  server = net.createServer(handleClient);
  // `events.once` also rejects when the listener emits 'error' before binding.
  const listening = once(server, 'listening');
  server.listen(socketPath);
  try {
    await listening;
  } catch (error) {
    throw new Error(`Cannot bind bridge socket ${socketPath}: ${errorMessage(error)}`);
  }
  fs.chmodSync(socketPath, 0o600);
  socketIno = fs.statSync(socketPath).ino;
  socketReady = true;
  writeClaim();
  log(`Antigravity session ${session.id} relay listening on ${socketPath}`);
}

void main().catch((error: unknown) => {
  log(`failed to start: ${errorMessage(error)}`);
  process.exit(1);
});
