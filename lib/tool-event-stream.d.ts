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
export interface ToolEventProjectionOptions {
    /** Resolves an OMP task subagent id (`<parent>/<id>.jsonl`) to its canonical route id (`~sk1_...`). */
    readonly resolveTaskSubagent?: (agentId: string) => string | null;
}
/**
 * Project OMP `task` subagent identities from either raw OMP details (`progress`/`results`)
 * or already-projected `details.subagents` (idempotent across bridge -> server hops).
 * Never walks traces, outputs, or arbitrary keys on `details`.
 */
export declare function extractTaskSubagents(details: unknown, resolveTaskSubagent?: (agentId: string) => string | null, content?: unknown): TaskSubagentProjection[];
/** Tool panels consume content plus projected details, not harness-native traces in result.details. */
export declare function projectToolEvent(event: string, value: unknown, options?: ToolEventProjectionOptions): unknown;
export interface ToolEventStream {
    push(event: string, data: unknown): void;
    clear(): void;
}
/** Cumulative updates replace pending snapshots; lifecycle frames never wait. */
export declare function createToolEventStream(send: (event: string, data: unknown) => void, windowMs?: number, options?: ToolEventProjectionOptions): ToolEventStream;
