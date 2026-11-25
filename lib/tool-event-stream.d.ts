// Generated from src/core/tool-event-stream.ts; edit that source and run npm run build:core.
export interface TaskSubagentProjection {
    readonly id: string;
    readonly index?: number;
    readonly agent?: string;
    readonly status?: string;
    readonly exitCode?: number;
    readonly durationMs?: number;
    readonly sessionId?: string;
}
export interface ExtractTaskSubagentsOptions {
    /** Allow bridge-projected `details.subagents` (live SSE wire); persisted JSONL reads only raw OMP `progress`/`results`. */
    readonly allowProjectedSubagents?: boolean;
}
/**
 * Strip untrusted task-subagent / route fields from a raw `toolCall` block.
 * Shared by `/messages` and live SSE `message_update`/`message_end` so raw
 * harness payloads can never inject clickable routes.
 */
export declare function stripUntrustedTaskCallBlock(block: Record<string, unknown>): Record<string, unknown> | null;
/** Strip untrusted task-call route fields from an assistant message's content blocks without mutating it. */
export declare function sanitizeAssistantTaskBlocks(message: Record<string, unknown>): Record<string, unknown>;
export interface ToolEventProjectionOptions {
    /** Resolves an OMP task subagent id (`<parent>/<id>.jsonl`) to its verified canonical route id (`~sk1_...`). */
    readonly resolveTaskSubagent?: (agentId: string) => string | null;
    /** Creates one frame-scoped resolver per emitted snapshot (called only after coalescing). */
    readonly resolveTaskSubagentsFrame?: () => (agentId: string) => string | null;
}
/**
 * Project OMP `task` subagent identities from structured OMP details (`progress`/`results`)
 * or bridge-projected `details.subagents` (when `allowProjectedSubagents` is enabled).
 * Untrusted incoming `sessionId` / route fields are ALWAYS stripped; routes are attached
 * strictly from `resolveTaskSubagent` after applying the 64-entry cap, with misses memoized
 * within the frame. Never walks traces, outputs, text content, or arbitrary keys on `details`.
 */
export declare function extractTaskSubagents(details: unknown, resolveTaskSubagent?: (agentId: string) => string | null, options?: ExtractTaskSubagentsOptions): TaskSubagentProjection[];
/** Tool panels consume content plus projected details, not harness-native traces in result.details. */
export declare function projectToolEvent(event: string, value: unknown, options?: ToolEventProjectionOptions): unknown;
export interface ToolEventStream {
    push(event: string, data: unknown): void;
    clear(): void;
}
/** Cumulative updates replace pending snapshots; lifecycle frames never wait. */
export declare function createToolEventStream(send: (event: string, data: unknown) => void, windowMs?: number, options?: ToolEventProjectionOptions): ToolEventStream;
