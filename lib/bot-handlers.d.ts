// Generated from src/core/bot-handlers.ts; edit that source and run npm run build:core.
/**
 * `/api/bots`: the registry as the user and the bots see it. Every change made
 * here writes a revision naming who made it: the user, or the bot and the turn
 * it made the change in. Restoring an old revision writes a new one. A host
 * whose Node lacks `node:sqlite` answers 501.
 */
import type { RouteHandler } from './http-boundary';
import { type BotRegistry, type BotRow } from './bot-registry';
/** Starting and stopping a bot's relay; both are no-ops where bots are switched off. */
export interface BotControl {
    start(bot: BotRow): Promise<void>;
    stop(bot: BotRow): Promise<void>;
}
export interface BotHandlers {
    list: RouteHandler;
    create: RouteHandler;
    update: RouteHandler;
    edit: RouteHandler;
    retire: RouteHandler;
    revisions: RouteHandler;
    restore: RouteHandler;
}
export declare function createBotHandlers(registry: () => BotRegistry | null, control: BotControl): BotHandlers;
