#!/usr/bin/env node
/**
 * Bot relay: one per bot, launched by pi-dish into a tmux pane it owns. It runs
 * the bot's durable conversation (bot-runtime), keeps its Pi-format mirror,
 * publishes the bridge registry claim and serves pi-dish's bridge socket
 * protocol, so a bot lists, streams, takes prompts and is searched like any
 * session. Its state lives in `~/.pi/dish/bots/<id>/durable.sqlite`, apart
 * from this process: a killed relay resumes there, and unfinished work with it.
 *
 * Usage: bot-relay resume <mirror.jsonl>
 *
 * The mirror's header names the bot; the relay reads the bot's row from the
 * registry. pi-dish creates the mirror before the first launch.
 */
import fs = require('fs');
import net = require('net');
import path = require('path');
import crypto = require('crypto');
import { execFile } from 'child_process';
import { once } from 'events';
import { openBotRegistry, type BotRow } from './bot-registry';
import { BotMirror, readBotMirrorHeader } from './bot-mirror';
import { openBotModels, openBotRuntime, type BotRuntime, type HubApi, type SessionsPort } from './bot-runtime';
import { claimBotRelayWhenFree } from './bot-supervisor';
import { codeBuild } from './code-build';
import { BOT_CAPABILITIES } from './session-capabilities';
import { dishDir } from './dish-store';
import { processIdentity } from './process-identity';
import { relaySocketPath, relayWrapperVersion } from './relay-socket';
import { runtimeResourcePath } from './runtime-resources';
import { encodeSessionKey, validSessionId } from './session-key';
import type { ProtocolRecord } from './wire-protocol';
import { record as isRecord } from './helper-values';
import { errorMessage } from './http-boundary';

const REGISTRY_DIR = path.join(dishDir(), 'sessions');
const SESSIONS_CLI = runtimeResourcePath(path.resolve(__dirname, '..'), 'skills/pi-dish-sessions/scripts/pi-dish-sessions.js');
/** Boundaries after which the registry claim is refreshed. */
const CLAIM_BOUNDARIES: Readonly<Record<string, true>> = {
  agent_start: true, turn_start: true, message_end: true, turn_end: true, agent_end: true,
};

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

function log(line: string): void {
  try { process.stdout.write(`[bot-relay ${new Date().toISOString()}] ${line}\n`); } catch {}
}

/** The pi-dish-sessions CLI, run as the bot: its spawns are attributed to it. */
function sessionsPort(routeId: string): SessionsPort {
  return (args, signal) => new Promise((resolve, reject) => {
    execFile(process.execPath, [SESSIONS_CLI, ...args], {
      // `wait` has its own --timeout.
      env: { ...process.env, PI_DISH_SESSION_ID: routeId }, maxBuffer: 8 << 20, timeout: args[0] === 'wait' ? 0 : 120_000, signal,
    }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const detail = String(stderr).trim().replace(/^pi-dish-sessions: /, '');
      reject(new Error(`pi-dish-sessions ${args[0]} failed: ${detail || error.message}`));
    });
  });
}

/** pi-dish's own HTTP API, for routes the sessions CLI does not cover: GET, or POST with a body. */
const hubApi: HubApi = async (pathname, body) => {
  const base = process.env.PI_DISH_URL || 'http://127.0.0.1:3333';
  const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {};
  if (process.env.PI_DISH_TOKEN) headers.Authorization = `Bearer ${process.env.PI_DISH_TOKEN}`;
  const response = await fetch(new URL(pathname, base), {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status} from ${pathname}`);
  return data;
};

async function main(): Promise<void> {
  // The code this process loaded, read before a deploy can change it further.
  const build = codeBuild();
  const [mode, mirrorFile] = process.argv.slice(2);
  if (mode !== 'resume' || !mirrorFile) throw new Error('usage: bot-relay resume <mirror.jsonl> (pi-dish starts bots itself)');
  const header = readBotMirrorHeader(mirrorFile);
  const registry = openBotRegistry(undefined, { readOnly: true });
  const loadBot = (): BotRow => {
    const row = registry.get(header.id);
    if (!row) throw new Error(`bot ${header.id} is not in the registry`);
    return row;
  };
  const bot = loadBot();
  const relayInstanceId = crypto.randomUUID();
  const botDir = path.join(dishDir(), 'bots', bot.id);
  // One relay per bot: a second would run the same durable work twice. A restart starts this relay while the one
  // it replaces is still stopping.
  const lock = await claimBotRelayWhenFree(botDir, build);
  if (!lock.claimed) throw new Error(`bot ${bot.name} already has a relay (pid ${lock.holder})`);
  process.on('exit', () => lock.release());
  const relayProcess = processIdentity(process.pid);
  if (!relayProcess) throw new Error('Cannot read this process birth identity; refusing to publish a stale claim');
  if (!validSessionId(bot.id)) throw new Error(`invalid bot id ${bot.id}`);
  const routeId = encodeSessionKey('bot', bot.id);
  const mirror = new BotMirror(mirrorFile, { id: bot.id, cwd: header.cwd, name: bot.name });
  if (mirror.name !== bot.name) mirror.appendName(mirror.lastEntryId, bot.name);
  // A bot back on other code than its last relay ran says so in its chat; the mirror is not the model's context.
  const buildFile = path.join(botDir, 'relay-build');
  let previousBuild: string | null = null;
  try { previousBuild = fs.readFileSync(buildFile, 'utf8').trim() || null; } catch {}
  if (previousBuild !== build && (previousBuild !== null || mirror.lastEntryId > 0)) {
    mirror.appendCustom(mirror.lastEntryId, 'bot-restart',
      `Restarted onto new pi-dish code (build ${previousBuild ? `${previousBuild} → ` : ''}${build}).`,
      { from: previousBuild, to: build }, `restart-${Date.now().toString(36)}`);
  }
  fs.writeFileSync(buildFile, `${build}\n`);

  const clients = new Set<net.Socket>();
  let server: net.Server | null = null;
  let socketPath = '';
  let socketIno: number | null = null;
  let socketReady = false;
  let shuttingDown = false;
  let runtime: BotRuntime | null = null;
  /** Prompts and deliveries received and not yet stored: a restart now would lose them. */
  let taking = 0;

  const wrapper = Object.freeze({
    harnessId: 'bot', name: 'pi-dish-bot-relay', wrapperVersion: relayWrapperVersion(), eventProfile: 'bot-v1',
  });

  function claim(): ProtocolRecord {
    return {
      protocolVersion: 2,
      wrapper,
      harnessId: 'bot',
      bridgeInstanceId: relayInstanceId,
      instanceId: relayInstanceId,
      nativeSessionId: bot.id,
      sessionId: bot.id,
      capabilities: BOT_CAPABILITIES,
      sessionFile: mirror.file,
      cwd: header.cwd,
      pid: process.pid,
      startTime: relayProcess!.startTime,
      socketPath,
      name: mirror.name,
      model: bot.model,
      thinkingLevel: bot.thinking,
      contextUsage: runtime?.contextUsage() ?? null,
      turnInProgress: runtime?.busy === true,
      askPending: false,
      compacting: false,
      spawnToken: process.env.PI_DISH_SPAWN_TOKEN || null,
    };
  }

  /** Snapshot for the hello frame; `get_state` reads the durable store. */
  function lifecycleSnapshot(): ProtocolRecord {
    return { idle: runtime?.busy !== true, pendingMessages: taking > 0, pendingDialogs: 0, backgroundWork: false };
  }

  /**
   * What a restart waits for: a run in progress, input queued for the next run, or input this relay is still
   * taking. A worker watch is not background work here: it resumes after a restart.
   */
  async function lifecycle(): Promise<ProtocolRecord> {
    const activity = await runtime!.activity();
    return { idle: !activity.running, pendingMessages: activity.queued || taking > 0, pendingDialogs: 0, backgroundWork: false };
  }

  function writeClaim(): void {
    if (!socketReady) return;
    try {
      fs.mkdirSync(REGISTRY_DIR, { recursive: true });
      fs.writeFileSync(path.join(REGISTRY_DIR, `bot-${bot.id}.json`),
        JSON.stringify({ ...claim(), updatedAt: new Date().toISOString() }, null, 2));
    } catch (error) {
      log(`claim write failed: ${errorMessage(error)}`);
    }
  }

  function send(sock: net.Socket, frame: unknown): void {
    try { sock.write(JSON.stringify(frame) + '\n'); } catch {}
  }

  function broadcast(event: string, data: ProtocolRecord): void {
    const line = JSON.stringify({ type: 'event', event, data: { type: event, ...data } }) + '\n';
    for (const client of clients) {
      try { client.write(line); } catch {}
    }
    if (Object.hasOwn(CLAIM_BOUNDARIES, event)) writeClaim();
  }

  function respond(sock: net.Socket, cmd: ProtocolRecord, success: boolean, data?: unknown, error?: string): void {
    send(sock, {
      type: 'response', id: cmd.id ?? null, command: cmd.command, success,
      ...(data === undefined ? {} : { data }),
      ...(error ? { error } : {}),
    });
  }

  async function handleCommand(cmd: ProtocolRecord, sock: net.Socket): Promise<void> {
    try {
      const bot = runtime;
      if (!bot) return respond(sock, cmd, false, undefined, 'the bot is still starting');
      switch (cmd.command) {
        case 'ping':
          return respond(sock, cmd, true, { pong: true });
        case 'get_state':
          return respond(sock, cmd, true, { ...claim(), lifecycle: await lifecycle() });
        case 'get_commands':
          return respond(sock, cmd, true, { commands: [] });
        case 'prompt':
        case 'steer': {
          const message = typeof cmd.message === 'string' ? cmd.message : '';
          if (!message) return respond(sock, cmd, false, undefined, 'message required');
          const queued = bot.busy;
          taking++;
          try { await bot.prompt(message, cmd.command === 'steer' || cmd.deliverAs === 'steer' ? 'steer' : 'followUp'); } finally { taking--; }
          writeClaim();
          return respond(sock, cmd, true, { queued });
        }
        case 'deliver': {
          // From pi-dish: a room post, a question from another family, an answer to this bot's question, or a routine's run.
          const { kind, requestId, text, data } = cmd;
          if ((kind !== 'room' && kind !== 'ask' && kind !== 'answer' && kind !== 'routine') || typeof requestId !== 'string' || typeof text !== 'string' || !isRecord(data)) {
            return respond(sock, cmd, false, undefined, 'deliver needs kind, requestId, text and data');
          }
          const queued = bot.busy;
          taking++;
          try { await bot.deliver({ kind, requestId, text, data: data as Record<string, string | number> }); } finally { taking--; }
          writeClaim();
          return respond(sock, cmd, true, { queued });
        }
        case 'abort':
          await bot.abort();
          writeClaim();
          return respond(sock, cmd, true);
        default:
          return respond(sock, cmd, false, undefined, `unsupported command ${String(cmd.command)}`);
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
  }

  function unlinkOwnedClaim(): void {
    const file = path.join(REGISTRY_DIR, `bot-${bot.id}.json`);
    try {
      const current: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isRecord(current) && current.instanceId === relayInstanceId) fs.unlinkSync(file);
    } catch {}
  }

  function unlinkOwnedSocket(): void {
    if (!socketPath) return;
    try {
      if (socketIno !== null && fs.statSync(socketPath).ino !== socketIno) return;
      fs.unlinkSync(socketPath);
    } catch {}
  }

  const models = await openBotModels(bot.model);

  async function shutdown(reason: string, code: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    // A model request that will not stop must not keep a dead pane's relay alive.
    setTimeout(() => { process.exit(code); }, 10_000).unref();
    log(`stopping: ${reason}`);
    for (const client of clients) {
      try { client.destroy(); } catch {}
    }
    clients.clear();
    if (server) { try { server.close(); } catch {} }
    socketReady = false;
    unlinkOwnedClaim();
    unlinkOwnedSocket();
    // Unfinished work stays in durable storage; the next relay resumes it.
    try { await runtime?.close(); } catch (error) { log(`close failed: ${errorMessage(error)}`); }
    // pi-claude-code's warm Claude Code process keeps Node alive until closed.
    try { await models.close(); } catch {}
    registry.close();
    process.exit(code);
  }

  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) {
    process.on(signal, () => { void shutdown(signal, 0); });
  }
  for (const failure of ['uncaughtException', 'unhandledRejection'] as const) {
    process.on(failure, (error: unknown) => {
      log(`${failure}: ${errorMessage(error)}`);
      void shutdown(failure, 1);
    });
  }

  runtime = await openBotRuntime({
    bot,
    storageFile: path.join(dishDir(), 'bots', bot.id, 'durable.sqlite'),
    botsDir: path.join(dishDir(), 'bots'),
    mirror,
    models: models.models,
    sessions: sessionsPort(routeId),
    api: hubApi,
    loadBot,
    emit: broadcast,
    changed: writeClaim,
    log,
  });

  socketPath = relaySocketPath(bot.id);
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  try { fs.unlinkSync(socketPath); } catch {}
  server = net.createServer(handleClient);
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
  log(`bot ${bot.name} (${bot.id}) on ${bot.model}, build ${build}, relay listening on ${socketPath}`);
  // A rename by the user, by a bot or by an undo shows in the session list and the transcript.
  setInterval(() => {
    let name: string;
    try { name = loadBot().name; } catch { return; }
    if (name === mirror.name) return;
    mirror.appendName(mirror.lastEntryId, name);
    writeClaim();
  }, 3_000).unref();
}

void main().catch((error: unknown) => {
  log(`failed to start: ${errorMessage(error)}`);
  process.exit(1);
});
