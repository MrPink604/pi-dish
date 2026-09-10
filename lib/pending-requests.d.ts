// Generated from src/core/pending-requests.ts; edit that source and run npm run build:core.
type RequestId = string | number;
/**
 * Id-correlated pending-request tracking shared by both session backends
 * (bridge Unix socket and RPC stdio). Owns the resolve/reject bookkeeping
 * and the per-request timeout so protocol guards can't drift between the
 * two transports — the bridge shipping without a timeout while RPC had one
 * was exactly that drift.
 */
declare class PendingRequests {
    private _map;
    constructor();
    /** Register a request under `id`; returns the promise its response settles. */
    track(id: RequestId, { timeout, label }?: {
        label?: string | undefined;
        timeout?: number | undefined;
    }): Promise<unknown>;
    /** Settle from a {type:'response'} wire message; false when the id is unknown. */
    settle(id: RequestId | null | undefined, success: boolean, data?: unknown, error?: string, fallbackError?: string): boolean;
    /** Reject one tracked request (e.g. the transport write threw). */
    fail(id: RequestId, err: unknown): void;
    /** Reject everything (socket closed / process exited). */
    failAll(err: unknown): void;
}
declare const _default: {
    PendingRequests: typeof PendingRequests;
};
export = _default;
