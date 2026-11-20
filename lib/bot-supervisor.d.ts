// Generated from src/core/bot-supervisor.ts; edit that source and run npm run build:core.
import type { BotRegistry, BotRow } from './bot-registry';
/**
 * Hands one `deliver` command to a bot's relay over its bridge socket. Resolves once the relay has taken it, saying
 * whether it queued behind a run, and null when no relay listens or it refuses; the delivery carries a request id,
 * so sending it again is harmless.
 */
export declare function deliverToBot(botId: string, delivery: Record<string, unknown>, timeoutMs?: number): Promise<{
    queued: boolean;
} | null>;
/**
 * Delivers to a bot that may not be running, such as a routine's run just after the hub came back: when no relay
 * takes it, the bot is started and the delivery tried again until a relay takes it or `waitMs` passes.
 */
export declare function deliverStartingBot(botId: string, delivery: Record<string, unknown>, start: () => Promise<void>, { waitMs, everyMs, deliver }?: {
    waitMs?: number;
    everyMs?: number;
    deliver?: typeof deliverToBot;
}): Promise<{
    queued: boolean;
}>;
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
export declare function startBots(ports: BotStartPorts): Promise<void>;
/** The session route of a bot, as pi-dish's session operations take it. */
export declare function botRoute(id: string): string;
/**
 * Starts one bot: writes its mirror's header when it has never run, then
 * resumes its route. A bot whose relay is running already is left alone.
 */
export declare function startBot(bot: BotRow, { resume, log, sessionsDir, botsDir, }: Omit<BotStartPorts, 'registry'>): Promise<void>;
