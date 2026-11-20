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
export interface BotRegistry {
    readonly file: string;
    list(): BotRow[];
    get(id: string): BotRow | null;
    /** Creates Fleet unless a bot of that name exists; returns it either way. */
    seedFleet(): BotRow;
    update(id: string, patch: BotPatch, source: ChangeSource): BotRow;
    revisions(id: string): BotRevision[];
    /** Puts an old revision's row back as a new revision. */
    restore(id: string, revision: number, source: ChangeSource): BotRow;
    close(): void;
}
export declare const DEFAULT_BOT_MODEL = "claude-code/claude-opus-5-5";
export declare const FLEET_IDENTITY: string;
/** True where this Node build can open the registry. */
export declare function botRegistryAvailable(): boolean;
/** Validates an edit; unknown fields are refused so a typo never passes silently. */
export declare function validateBotPatch(input: unknown): BotPatch;
/** Opens (and creates) the registry. `readOnly` opens never create or write. */
export declare function openBotRegistry(file?: string, { readOnly }?: {
    readOnly?: boolean | undefined;
}): BotRegistry;
