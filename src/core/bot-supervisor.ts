/**
 * Starts every active bot when pi-dish starts: a bot's relay is resumed from
 * its mirror, and pi-dish writes the mirror's header first for a bot that has
 * never run. A bot already running is left alone (the resume reports it live).
 */
import fs = require('fs');
import os = require('os');
import path = require('path');
import { BotMirror } from './bot-mirror';
import type { BotRegistry, BotRow } from './bot-registry';
import { getHarness } from './harnesses';
import { encodeSessionKey, validSessionId } from './session-key';
import { errorMessage } from './http-boundary';
import { processIdentity, processIdentityAlive } from './process-identity';
import { dishDir } from './dish-store';

/**
 * Makes this process the bot's only relay: two relays on one durable store
 * would both run its work. The lock file names the holder's pid and start time;
 * a holder that is gone (killed, crashed, or a reused pid) is replaced. Returns
 * false while another live relay holds it; `release` removes only our own lock.
 */
export function claimBotRelay(botDir: string): { claimed: false; holder: number } | { claimed: true; release(): void } {
  const file = path.join(botDir, 'relay.lock');
  const self = processIdentity(process.pid);
  if (!self) throw new Error('Cannot read this process birth identity');
  const mine = JSON.stringify({ pid: self.pid, startTime: self.startTime });
  fs.mkdirSync(botDir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx', mode: 0o600 });
      return { claimed: true, release: () => { try { if (fs.readFileSync(file, 'utf8') === mine) fs.unlinkSync(file); } catch {} } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const holder = liveBotRelay(botDir);
    if (holder !== null) return { claimed: false, holder };
    // A stale lock: take it over once; a racing relay that wins the retry keeps it.
    try { fs.unlinkSync(file); } catch {}
  }
  return { claimed: false, holder: 0 };
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
}

/** The pid of the live relay holding a bot's lock, or null. */
export function liveBotRelay(botDir: string): number | null {
  try {
    const holder = JSON.parse(fs.readFileSync(path.join(botDir, 'relay.lock'), 'utf8')) as { pid?: number; startTime?: string };
    return processIdentityAlive({ pid: Number(holder.pid), startTime: String(holder.startTime) }) ? Number(holder.pid) : null;
  } catch { return null; }
}

/**
 * Resolves once each active bot's start has been tried; a failure is logged,
 * never thrown. A bot whose relay is still running (a pi-dish restart leaves
 * its pane alone) is not started again.
 */
export async function startBots(ports: BotStartPorts): Promise<void> {
  for (const bot of ports.registry.list()) {
    if (bot.status !== 'active') continue;
    try {
      await startBot(bot, ports);
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
 * resumes its route. A bot whose relay is running already is left alone.
 */
export async function startBot(bot: BotRow, {
  resume, log, sessionsDir = getHarness('bot')!.rootPath(), botsDir = path.join(dishDir(), 'bots'),
}: Omit<BotStartPorts, 'registry'>): Promise<void> {
  const route = botRoute(bot.id);
  const running = liveBotRelay(path.join(botsDir, bot.id));
  if (running !== null) { log(`bot ${bot.name}: relay ${running} is already running`); return; }
  new BotMirror(path.join(sessionsDir, `${bot.id}.jsonl`), { id: bot.id, cwd: os.homedir(), name: bot.name });
  await resume(route);
}
