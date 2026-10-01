// Generated from src/core/tool-event-stream.ts; edit that source and run npm run build:core.
/** Tool panels consume content, not harness-native task traces in result.details. */
export declare function projectToolEvent(event: string, value: unknown): unknown;
export interface ToolEventStream {
    push(event: string, data: unknown): void;
    clear(): void;
}
/** Cumulative updates replace pending snapshots; lifecycle frames never wait. */
export declare function createToolEventStream(send: (event: string, data: unknown) => void, windowMs?: number): ToolEventStream;
