// Generated from src/core/transport-session.ts; edit that source and run npm run build:core.
import type { ExtensionUIState, PromptOptions, RunningToolCall } from './contracts';
import { type ProtocolRecord } from './wire-protocol';
export type SessionListener = (data: unknown) => void;
/**
 * Live-session surface shared by the stdio (RPC) and Prime daemon transports:
 * replay state, listener bookkeeping, and the prompt vocabulary both wire
 * protocols use. The bridge transport keeps Node's EventEmitter instead.
 */
export declare abstract class TransportSession {
    readonly runningToolCalls: Map<string, RunningToolCall>;
    readonly extUIState: ExtensionUIState;
    turnInProgress: boolean;
    /** Harness-reported; the /compact emulation also holds it to gate double-compaction. */
    compacting: boolean;
    /** Bumped on turn/message boundaries only: a per-poll timestamp made sessions look unread. */
    lastActivityAt: Date;
    lastStats?: unknown;
    streamingAssistantMessage: ProtocolRecord | null;
    private listeners;
    on(event: string, listener: SessionListener): () => void;
    off(event: string, listener: SessionListener): void;
    once(event: string, listener: SessionListener): () => void;
    protected emitEvent(event: string, data: unknown): void;
    /**
     * Rebuild the assistant snapshot when the harness sends delta-only
     * `message_update` frames, so every consumer keeps seeing a whole message.
     */
    protected assistantFrame(msg: ProtocolRecord): ProtocolRecord;
    /** The snapshot ends with the assistant message that carried it. */
    protected endAssistantMessage(msg: ProtocolRecord): void;
    abstract getSessionStats(): Promise<unknown>;
    _refreshStats(): void;
}
/** A busy agent receives an undecorated prompt as steering; both protocols call that field streamingBehavior. */
export declare function promptParams(message: string, opts: PromptOptions, busy: boolean): ProtocolRecord;
