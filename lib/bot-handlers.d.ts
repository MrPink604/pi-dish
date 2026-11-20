// Generated from src/core/bot-handlers.ts; edit that source and run npm run build:core.
/**
 * `/api/bots`: the registry as the user and the bots see it. Every change made
 * here writes a revision naming who made it: the user, or the bot and the turn
 * it made the change in. Restoring an old revision writes a new one. A host
 * whose Node lacks `node:sqlite` answers 501.
 */
import type { RouteHandler } from './http-boundary';
import { type BotRegistry, type BotRow } from './bot-registry';
/** A message handed to a running bot: a room post, a question from another family, or the answer to one. */
export interface BotDelivery {
    kind: 'room' | 'ask' | 'answer';
    /** Delivers it once, however often it is sent. */
    requestId: string;
    /** What the bot reads. */
    text: string;
    /** The chain and hop the bot's own posts in the turn it wakes continue from. */
    data: {
        chain: string;
        hop: number;
        from: string;
        fromName: string;
    } & Record<string, string | number>;
}
/** Starting, stopping and reaching a bot's relay; start and stop are no-ops where bots are switched off. */
export interface BotControl {
    start(bot: BotRow): Promise<void>;
    stop(bot: BotRow): Promise<void>;
    /** The bot's session route, which the session list and the browser name it by. */
    route(id: string): string;
    /** Hands a message to the bot's relay; false when it is not running. */
    deliver(bot: BotRow, delivery: BotDelivery): Promise<boolean>;
}
export interface BotHandlers {
    list: RouteHandler;
    create: RouteHandler;
    update: RouteHandler;
    edit: RouteHandler;
    retire: RouteHandler;
    revisions: RouteHandler;
    restore: RouteHandler;
    roomPost: RouteHandler;
    roomRead: RouteHandler;
    ask: RouteHandler;
    answer: RouteHandler;
}
/** A chain of room posts, questions and answers stops here: the post that would be one more is refused. */
export declare const ROOM_HOP_CAP = 4;
export declare function createBotHandlers(registry: () => BotRegistry | null, control: BotControl): BotHandlers;
