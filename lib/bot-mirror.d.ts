// Generated from src/core/bot-mirror.ts; edit that source and run npm run build:core.
import type { ProtocolRecord } from './wire-protocol';
export interface BotMirrorHeader {
    /** The bot's id, which is also its native session id. */
    id: string;
    cwd: string;
    name: string;
}
/** The bot id a mirror belongs to; throws when the file is not a bot mirror. */
export declare function readBotMirrorHeader(file: string): BotMirrorHeader;
export declare class BotMirror {
    readonly file: string;
    private parentId;
    /** Newest durable entry the mirror shows; 0 for none. */
    lastEntryId: number;
    constructor(file: string, header: BotMirrorHeader);
    private append;
    private advance;
    /** A user, assistant or tool-result message, exactly as the model saw it. */
    appendMessage(entryId: number, message: ProtocolRecord): void;
    /**
     * A message the model sees as user input but the transcript shows as itself:
     * a worker's report, or the start of a new context window.
     */
    appendCustom(entryId: number, customType: string, text: string, details?: ProtocolRecord): void;
    /** A run that ended without an answer, shown as a failed assistant turn. */
    appendRunFailure(entryId: number, taskId: number, errorMessage: string, model: {
        provider: string;
        id: string;
    }): void;
    appendModelChange(entryId: number, provider: string, modelId: string): void;
    appendName(entryId: number, name: string): void;
}
