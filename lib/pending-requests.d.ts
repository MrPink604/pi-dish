// Generated from src/core/pending-requests.ts; edit that source and run npm run build:core.
type RequestId = string | number;
/**
 * Id-correlated pending-request bookkeeping shared by all transports (bridge
 * socket, RPC stdio, Prime daemon), so their timeouts and settle rules cannot
 * drift apart.
 */
declare class PendingRequests {
    private readonly map;
    /** Register a request under `id`; returns the promise its response settles. */
    track(id: RequestId, { timeout, label }?: {
        label?: string | undefined;
        timeout?: number | undefined;
    }): Promise<unknown>;
    /** Settle from a {type:'response'} wire message; false when the id is unknown. */
    settle(id: RequestId | null | undefined, success: boolean, data?: unknown, error?: string, fallbackError?: string): boolean;
    /** Reject one tracked request (e.g. the transport write threw). */
    fail(id: RequestId, error: unknown): void;
    /** Reject everything (socket closed / process exited). */
    failAll(error: unknown): void;
}
declare const _default: {
    PendingRequests: typeof PendingRequests;
};
export = _default;
