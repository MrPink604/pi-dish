// Generated from src/core/bot-supervisor.ts; edit that source and run npm run build:core.
import type { BotRegistry } from './bot-registry';
export interface BotStartPorts {
    registry: BotRegistry;
    /** Resumes a session route; pi-dish's own resume operation. */
    resume(routeId: string): Promise<unknown>;
    log(line: string): void;
    /** Where mirrors live; the bot harness root by default. */
    sessionsDir?: string;
}
/** Resolves once each active bot's start has been tried; a failure is logged, never thrown. */
export declare function startBots({ registry, resume, log, sessionsDir }: BotStartPorts): Promise<void>;
