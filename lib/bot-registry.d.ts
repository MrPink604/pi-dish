// Generated from src/core/bot-registry.ts; edit that source and run npm run build:core.
export type BotStatus = 'active' | 'paused' | 'retired';
/** Where a bot does its work; the label is what the bot calls it. */
export interface BotPlace {
    host: string | null;
    cwd: string;
    label: string;
}
export interface BotRow {
    id: string;
    parentId: string | null;
    name: string;
    status: BotStatus;
    /** `provider/model-id`, resolved through Pi's model layer. */
    model: string;
    thinking: string | null;
    identity: string;
    places: BotPlace[];
    revision: number;
    createdAt: string;
    updatedAt: string;
}
/** The fields an edit may change; identity fields and bookkeeping are fixed. */
export type BotPatch = Partial<Pick<BotRow, 'name' | 'status' | 'model' | 'thinking' | 'identity' | 'places' | 'parentId'>>;
export interface BotRevision {
    botId: string;
    revision: number;
    /** `user`, or the id of the bot that made the change. */
    actor: string;
    /** The turn a bot made the change in; null for the user. */
    turn: string | null;
    fields: string[];
    before: BotRow | null;
    after: BotRow;
    createdAt: string;
}
export interface ChangeSource {
    actor: string;
    turn?: string | null;
}
/** What a new bot is made from; the model defaults to Opus, the id to a fresh one. */
export interface NewBot {
    /** Given by a caller that may retry, so a retry finds the bot it made. */
    id?: string;
    parentId?: string | null;
    name: string;
    identity: string;
    model?: string;
    thinking?: string | null;
    places?: BotPlace[];
}
/** A top-level bot is at depth 1; a bot below this depth is refused. */
export declare const MAX_BOT_DEPTH = 4;
/** A post to a family's room: who sent it, the bots it wakes, and the chain of replies it belongs to. */
export interface RoomMessage {
    id: number;
    /** The family's top-level bot. */
    family: string;
    from: string;
    to: string[];
    text: string;
    /** The turn that started the chain, `<bot>/<entry>`. */
    chain: string;
    /** 1 for a post from a turn nothing in the room woke; one more for each reply after it. */
    hop: number;
    createdAt: string;
}
export interface BotRegistry {
    readonly file: string;
    list(): BotRow[];
    get(id: string): BotRow | null;
    /** Creates Fleet unless a bot of that name exists; returns it either way. */
    seedFleet(): BotRow;
    /** Creates an active bot with its first revision; an id that exists returns that bot unchanged. */
    create(input: NewBot, source: ChangeSource): BotRow;
    update(id: string, patch: BotPatch, source: ChangeSource): BotRow;
    /**
     * `update`, with the sub-bots a change of status moved: retiring a bot moves its children up to its parent, and
     * bringing it back moves back each one whose last change was that move. A new parent must be active, must not
     * be the bot or one of its descendants, and must leave the bot's subtree within `MAX_BOT_DEPTH`.
     */
    change(id: string, patch: BotPatch, source: ChangeSource): {
        bot: BotRow;
        moved: BotRow[];
    };
    /** Archives a bot and moves its children up to its parent, each move a revision of the child. */
    retire(id: string, source: ChangeSource): {
        bot: BotRow;
        moved: BotRow[];
    };
    /** The ids from a bot up to its top-level ancestor, the bot first; its length is the bot's depth. */
    lineage(id: string): string[];
    /** Every bot that is not retired in the family of the top-level bot `family`. */
    family(family: string): BotRow[];
    post(message: Omit<RoomMessage, 'id' | 'createdAt'>): RoomMessage;
    /**
     * A family's newest room messages, oldest first: those posted in the family, and in every family that has since
     * moved into it, so a family's history follows it when its top bot moves under another, and back when it moves out.
     */
    room(family: string, limit: number): RoomMessage[];
    revisions(id: string): BotRevision[];
    /** Puts an old revision's row back as a new revision: every editable field, or only `fields`. */
    restore(id: string, revision: number, source: ChangeSource, fields?: readonly string[]): BotRow;
    close(): void;
}
export declare const DEFAULT_BOT_MODEL = "claude-code/claude-opus-5-5";
export declare const FLEET_IDENTITY: string;
/** The key in `~/.pi/dish/settings.json` that turns bots on for this host; they are off without it. */
export declare const BOTS_SETTING = "bots";
/** True where this Node build can open the registry. */
export declare function botRegistryAvailable(): boolean;
/** Validates an edit; unknown fields are refused so a typo never passes silently. */
export declare function validateBotPatch(input: unknown): BotPatch;
/** Opens (and creates) the registry. `readOnly` opens never create or write. */
export declare function openBotRegistry(file?: string, { readOnly }?: {
    readOnly?: boolean | undefined;
}): BotRegistry;
