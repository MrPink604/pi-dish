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
 * Delivers to a bot that may not be running, such as a routine's run just after the hub came back or a message that
 * arrives while its relay restarts: when no relay takes it, the bot is started and the delivery tried again until a
 * relay takes it or `waitMs` passes. A start that fails (refused while a restart is under way) is tried again.
 */
export declare function deliverStartingBot(botId: string, delivery: Record<string, unknown>, start: () => Promise<boolean | void>, { waitMs, everyMs, deliver }?: {
    waitMs?: number;
    everyMs?: number;
    deliver?: typeof deliverToBot;
}): Promise<{
    queued: boolean;
}>;
/** The live relay holding a bot's lock: its pid and the build of pi-dish it started from, null if it recorded none. */
export interface BotRelayHolder {
    pid: number;
    build: string | null;
}
/** A claim of a bot's relay lock: held, with `release`, or refused while the live relay `holder` keeps it. */
export type BotRelayLock = {
    claimed: false;
    holder: number;
} | {
    claimed: true;
    release(): void;
};
/**
 * Makes this process the bot's only relay: two relays on one durable store
 * would both run its work. The lock file names the holder's pid, start time
 * and build; a holder that is gone (killed, crashed, or a reused pid) is
 * replaced. Returns false while another live relay holds it; `release` removes
 * only our own lock.
 */
export declare function claimBotRelay(botDir: string, build: string): BotRelayLock;
/**
 * `claimBotRelay`, waiting up to `waitMs` for a holder to go: a restart starts the new relay in the pane while the
 * old one is still stopping, which takes at most ten seconds.
 */
export declare function claimBotRelayWhenFree(botDir: string, build: string, { waitMs, everyMs }?: {
    everyMs?: number | undefined;
    waitMs?: number | undefined;
}): Promise<BotRelayLock>;
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
}
/** The live relay holding a bot's lock, or null. */
export declare function liveBotRelay(botDir: string): BotRelayHolder | null;
/**
 * Resolves once each active bot's start has been tried; a failure is logged,
 * never thrown. A bot whose relay is still running (a pi-dish restart leaves
 * its pane alone) is not started again; one that runs another build, or
 * recorded none, goes to `restartStale`.
 */
export declare function startBots(ports: BotStartPorts): Promise<void>;
/** The session route of a bot, as pi-dish's session operations take it. */
export declare function botRoute(id: string): string;
/**
 * Starts one bot: writes its mirror's header when it has never run, then
 * resumes its route. Returns `true` when it launched a relay, or `false` when
 * a live relay already holds the lock (left alone).
 */
export declare function startBot(bot: BotRow, { resume, log, sessionsDir, botsDir, }: Omit<BotStartPorts, 'registry'>): Promise<boolean>;
