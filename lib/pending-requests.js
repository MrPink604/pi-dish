// Generated from src/core/pending-requests.ts; edit that source and run npm run build:core.
"use strict";
/**
 * Id-correlated pending-request bookkeeping shared by all transports (bridge
 * socket, RPC stdio, Prime daemon), so their timeouts and settle rules cannot
 * drift apart.
 */
class PendingRequests {
    map = new Map();
    /** Register a request under `id`; returns the promise its response settles. */
    track(id, { timeout = 0, label = 'request' } = {}) {
        return new Promise((resolve, reject) => {
            const timer = timeout > 0 ? setTimeout(() => {
                if (this.map.delete(id))
                    reject(new Error(`${label} timed out after ${timeout}ms`));
            }, timeout) : undefined;
            this.map.set(id, {
                resolve: (value) => { clearTimeout(timer); resolve(value); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
        });
    }
    /** Settle from a {type:'response'} wire message; false when the id is unknown. */
    settle(id, success, data, error, fallbackError = 'command failed') {
        if (id == null)
            return false;
        const pending = this.map.get(id);
        if (!pending)
            return false;
        this.map.delete(id);
        if (success)
            pending.resolve(data);
        else
            pending.reject(new Error(error || fallbackError));
        return true;
    }
    /** Reject one tracked request (e.g. the transport write threw). */
    fail(id, error) {
        const pending = this.map.get(id);
        if (!pending)
            return;
        this.map.delete(id);
        pending.reject(error);
    }
    /** Reject everything (socket closed / process exited). */
    failAll(error) {
        for (const pending of this.map.values())
            pending.reject(error);
        this.map.clear();
    }
}
module.exports = { PendingRequests };
