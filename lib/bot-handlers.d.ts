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
    /** Whether the bot's relay runs, and when the bot last answered (ISO), from its transcript. */
    state(bot: BotRow): {
        running: boolean;
        lastTurnAt: string | null;
    };
}
/** A bot as the `bots` tool lists it: the registry row without its identity, how it stands to the caller, and whether it runs. */
export interface RosterBot extends Omit<BotRow, 'identity' | 'createdAt' | 'updatedAt'> {
    parentName: string | null;
    relation: 'self' | 'ancestor' | 'descendant';
    running: boolean;
    lastTurnAt: string | null;
}
export interface BotHandlers {
    list: RouteHandler;
    create: RouteHandler;
    update: RouteHandler;
    edit: RouteHandler;
    retire: RouteHandler;
    revisions: RouteHandler;
    restore: RouteHandler;
    roster: RouteHandler;
    rosterShow: RouteHandler;
    roomPost: RouteHandler;
    roomRead: RouteHandler;
    ask: RouteHandler;
    answer: RouteHandler;
}
/** A chain of room posts, questions and answers stops here: the post that would be one more is refused. */
export declare const ROOM_HOP_CAP = 4;
/**
 * One line per changed field, as a bot's change is shown in its chat and in a revision: a parent by name, an
 * identity by its length, anything else as JSON.
 */
export declare function changeLines(fields: readonly string[], before: BotRow | null, after: BotRow, nameOf: (id: string) => string): string[];
export declare function createBotHandlers(registry: () => BotRegistry | null, control: BotControl): BotHandlers;
