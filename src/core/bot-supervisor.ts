/**
 * Starts every active bot when pi-dish starts: a bot's relay is resumed from
 * its mirror, and pi-dish writes the mirror's header first for a bot that has
 * never run. A bot already running is left alone (the resume reports it live).
 */
import crypto = require('crypto');
import fs = require('fs');
import { setTimeout as delay } from 'node:timers/promises';
import net = require('net');
import os = require('os');
import path = require('path');
import { StringDecoder } from 'string_decoder';
import { BotMirror } from './bot-mirror';
import type { BotRegistry, BotRow } from './bot-registry';
import { getHarness } from './harnesses';
import { encodeSessionKey, validSessionId } from './session-key';
import { errorMessage } from './http-boundary';
import { processIdentity, processIdentityAlive } from './process-identity';
import { dishDir } from './dish-store';
import { relaySocketPath } from './relay-socket';
import { record as isRecord } from './helper-values';

/**
 * Hands one `deliver` command to a bot's relay over its bridge socket. Resolves once the relay has taken it, saying
 * whether it queued behind a run, and null when no relay listens or it refuses; the delivery carries a request id,
 * so sending it again is harmless.
 */
export function deliverToBot(botId: string, delivery: Record<string, unknown>, timeoutMs = 15_000): Promise<{ queued: boolean } | null> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let settled = false;
    const sock = net.connect(relaySocketPath(botId));
    const done = (taken: { queued: boolean } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(taken);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    sock.on('error', () => done(null));
    sock.on('close', () => done(null));
    sock.on('connect', () => sock.write(JSON.stringify({ ...delivery, id, command: 'deliver' }) + '\n'));
    sock.on('data', (chunk) => {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let frame: unknown;
        try { frame = JSON.parse(line); } catch { continue; }
        if (!isRecord(frame) || frame.type !== 'response' || frame.id !== id) continue;
        done(frame.success === true ? { queued: isRecord(frame.data) && frame.data.queued === true } : null);
      }
    });
  });
}

/**
 * Delivers to a bot that may not be running, such as a routine's run just after the hub came back or a message that
 * arrives while its relay restarts: when no relay takes it, the bot is started and the delivery tried again until a
 * relay takes it or `waitMs` passes. A start that fails (refused while a restart is under way) is tried again.
 */
export async function deliverStartingBot(
  botId: string, delivery: Record<string, unknown>, start: () => Promise<boolean | void>,
  { waitMs = 60_000, everyMs = 1000, deliver = deliverToBot, isActive }: {
    waitMs?: number; everyMs?: number; deliver?: typeof deliverToBot; isActive?: () => boolean;
  } = {},
): Promise<{ queued: boolean }> {
  const deadline = Date.now() + waitMs;
  let started = false;
  let failure = '';
  for (;;) {
    if (isActive && !isActive()) throw new Error('the bot is no longer active');
    const taken = await deliver(botId, delivery);
    if (taken) return taken;
    if (!started) {
      if (isActive && !isActive()) throw new Error('the bot is no longer active');
      try {
        const launched = await start();
        if (launched !== false) started = true;
      } catch (error) { failure = errorMessage(error); }
    }
    if (Date.now() >= deadline) {
      throw new Error(`the bot's relay did not take the message within ${Math.round(waitMs / 1000)}s${failure && !started ? ` (start: ${failure})` : ''}`);
    }
    await delay(everyMs);
  }
}

/** The live relay holding a bot's lock: its pid and the build of pi-dish it started from, null if it recorded none. */
export interface BotRelayHolder {
  pid: number;
  build: string | null;
}

/** A claim of a bot's relay lock: held, with `release`, or refused while the live relay `holder` keeps it. */
export type BotRelayLock = { claimed: false; holder: number } | { claimed: true; release(): void };

/**
 * Makes this process the bot's only relay: two relays on one durable store
 * would both run its work. The lock file names the holder's pid, start time
 * and build; a holder that is gone (killed, crashed, or a reused pid) is
 * replaced. Returns false while another live relay holds it; `release` removes
 * only our own lock.
 */
export function claimBotRelay(botDir: string, build: string): BotRelayLock {
  const file = path.join(botDir, 'relay.lock');
  const self = processIdentity(process.pid);
  if (!self) throw new Error('Cannot read this process birth identity');
  fs.mkdirSync(botDir, { recursive: true, mode: 0o700 });
  const release = () => {
    try {
      const held = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: unknown; startTime?: unknown };
      if (Number(held.pid) === self.pid && String(held.startTime) === String(self.startTime)) fs.unlinkSync(file);
    } catch {}
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: self.pid, startTime: self.startTime, build }), { flag: 'wx', mode: 0o600 });
      return { claimed: true, release };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const holder = liveBotRelay(botDir);
    if (holder !== null) return { claimed: false, holder: holder.pid };
    // A stale lock: take it over once; a racing relay that wins the retry keeps it.
    try { fs.unlinkSync(file); } catch {}
  }
  return { claimed: false, holder: 0 };
}

/**
 * `claimBotRelay`, waiting up to `waitMs` for a holder to go: a restart starts the new relay in the pane while the
 * old one is still stopping, which takes at most ten seconds.
 */
export async function claimBotRelayWhenFree(botDir: string, build: string, { waitMs = 15_000, everyMs = 100 } = {}): Promise<BotRelayLock> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const lock = claimBotRelay(botDir, build);
    if (lock.claimed || Date.now() >= deadline) return lock;
    await delay(everyMs);
  }
}

export interface BotStartPorts {
  registry: BotRegistry;
  /** Resumes a session route; pi-dish's own resume operation. */
  resume(routeId: string): Promise<unknown>;
  log(line: string): void;
  /** Where mirrors live; the bot harness root by default. */
  sessionsDir?: string;
  /** Where each bot's durable store and relay lock live; `~/.pi/dish/bots` by default. */
  botsDir?: string;
  /** The build pi-dish runs; a running relay of another build is handed to `restartStale`. */
  build?: string;
  restartStale?(bot: BotRow, holder: BotRelayHolder): void;
  /** Return a reason string to defer starting an offline bot (e.g. persisted tmux-loss backoff); healthy relays are untouched. */
  shouldSkipStart?(bot: BotRow): string | null;
  /** Called after an active bot is observed live or started cleanly. */
  onRunning?(bot: BotRow): void;
}

/** The live relay holding a bot's lock, or null. */
export function liveBotRelay(botDir: string): BotRelayHolder | null {
  try {
    const holder = JSON.parse(fs.readFileSync(path.join(botDir, 'relay.lock'), 'utf8')) as { pid?: number; startTime?: string; build?: unknown };
    if (!processIdentityAlive({ pid: Number(holder.pid), startTime: String(holder.startTime) })) return null;
    return { pid: Number(holder.pid), build: typeof holder.build === 'string' && holder.build ? holder.build : null };
  } catch { return null; }
}

/**
 * Resolves once each active bot's start has been tried; a failure is logged,
 * never thrown. A bot whose relay is still running (a pi-dish restart leaves
 * its pane alone) is not started again; one that runs another build, or
 * recorded none, goes to `restartStale`.
 */
export async function startBots(ports: BotStartPorts): Promise<void> {
  const botsDir = ports.botsDir ?? path.join(dishDir(), 'bots');
  for (const bot of ports.registry.list()) {
    if (bot.status !== 'active') continue;
    try {
      const holder = liveBotRelay(path.join(botsDir, bot.id));
      if (holder) {
        ports.onRunning?.(bot);
        if (ports.build && ports.restartStale && holder.build !== ports.build) {
          ports.restartStale(bot, holder);
          continue;
        }
        await startBot(bot, ports);
        continue;
      }
      const skipReason = ports.shouldSkipStart?.(bot);
      if (skipReason) {
        ports.log(`bot ${bot.name}: startup skipped (${skipReason})`);
        continue;
      }
      await startBot(bot, ports);
      ports.onRunning?.(bot);
    } catch (error) {
      ports.log(`bot ${bot.name} did not start: ${errorMessage(error)}`);
    }
  }
}

/** The session route of a bot, as pi-dish's session operations take it. */
export function botRoute(id: string): string {
  if (!validSessionId(id)) throw new Error(`invalid bot id ${id}`);
  return encodeSessionKey('bot', id);
}

/**
 * Starts one bot: writes its mirror's header when it has never run, then
 * resumes its route. Returns `true` when it launched a relay, or `false` when
 * a live relay already holds the lock (left alone).
 */
export async function startBot(bot: BotRow, {
  resume, log, sessionsDir = getHarness('bot')!.rootPath(), botsDir = path.join(dishDir(), 'bots'),
}: Omit<BotStartPorts, 'registry'>): Promise<boolean> {
  const route = botRoute(bot.id);
  const running = liveBotRelay(path.join(botsDir, bot.id));
  if (running !== null) { log(`bot ${bot.name}: relay ${running.pid} is already running`); return false; }
  new BotMirror(path.join(sessionsDir, `${bot.id}.jsonl`), { id: bot.id, cwd: os.homedir(), name: bot.name });
  await resume(route);
  return true;
}
