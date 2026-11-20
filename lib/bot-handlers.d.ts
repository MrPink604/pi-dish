// Generated from src/core/bot-handlers.ts; edit that source and run npm run build:core.
/**
 * `/api/bots`: the registry as the user sees it. Every edit made here writes a
 * revision with the user as its author; restoring an old revision writes a new
 * one. A host whose Node lacks `node:sqlite` answers 501.
 */
import type { RouteHandler } from './http-boundary';
import type { BotRegistry } from './bot-registry';
export interface BotHandlers {
    list: RouteHandler;
    update: RouteHandler;
    revisions: RouteHandler;
    restore: RouteHandler;
}
export declare function createBotHandlers(registry: () => BotRegistry | null): BotHandlers;
