/**
 * Starts every active bot when pi-dish starts: a bot's relay is resumed from
 * its mirror, and pi-dish writes the mirror's header first for a bot that has
 * never run. A bot already running is left alone (the resume reports it live).
 */
import os = require('os');
import path = require('path');
import { BotMirror } from './bot-mirror';
import type { BotRegistry } from './bot-registry';
import { getHarness } from './harnesses';
import { encodeSessionKey, validSessionId } from './session-key';
import { errorMessage } from './http-boundary';

export interface BotStartPorts {
  registry: BotRegistry;
  /** Resumes a session route; pi-dish's own resume operation. */
  resume(routeId: string): Promise<unknown>;
  log(line: string): void;
  /** Where mirrors live; the bot harness root by default. */
  sessionsDir?: string;
}

/** Resolves once each active bot's start has been tried; a failure is logged, never thrown. */
export async function startBots({ registry, resume, log, sessionsDir = getHarness('bot')!.rootPath() }: BotStartPorts): Promise<void> {
  for (const bot of registry.list()) {
    if (bot.status !== 'active') continue;
    if (!validSessionId(bot.id)) { log(`bot ${bot.name}: invalid id ${bot.id}`); continue; }
    try {
      new BotMirror(path.join(sessionsDir, `${bot.id}.jsonl`), { id: bot.id, cwd: os.homedir(), name: bot.name });
      await resume(encodeSessionKey('bot', bot.id));
    } catch (error) {
      log(`bot ${bot.name} did not start: ${errorMessage(error)}`);
    }
  }
}
