// Generated from src/core/bot-supervisor.ts; edit that source and run npm run build:core.
import type { BotRegistry } from './bot-registry';
/**
 * Makes this process the bot's only relay: two relays on one durable store
 * would both run its work. The lock file names the holder's pid and start time;
 * a holder that is gone (killed, crashed, or a reused pid) is replaced. Returns
 * false while another live relay holds it; `release` removes only our own lock.
 */
export declare function claimBotRelay(botDir: string): {
    claimed: false;
    holder: number;
} | {
    claimed: true;
    release(): void;
};
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
export declare function liveBotRelay(botDir: string): number | null;
/**
 * Resolves once each active bot's start has been tried; a failure is logged,
 * never thrown. A bot whose relay is still running (a pi-dish restart leaves
 * its pane alone) is not started again.
 */
export declare function startBots({ registry, resume, log, sessionsDir, botsDir, }: BotStartPorts): Promise<void>;
