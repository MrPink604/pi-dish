type RequestId = string | number;
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * Id-correlated pending-request tracking shared by both session backends
 * (bridge Unix socket and RPC stdio). Owns the resolve/reject bookkeeping
 * and the per-request timeout so protocol guards can't drift between the
 * two transports — the bridge shipping without a timeout while RPC had one
 * was exactly that drift.
 */
class PendingRequests {
  declare private _map: Map<RequestId, PendingRequest>;
  constructor() {
    this._map = new Map(); // id -> { resolve, reject }
  }

  /** Register a request under `id`; returns the promise its response settles. */
  track(id: RequestId, { timeout = 0, label = 'request' } = {}): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = timeout > 0 ? setTimeout(() => {
        if (this._map.delete(id)) reject(new Error(`${label} timed out after ${timeout}ms`));
      }, timeout) : null;
      this._map.set(id, {
        resolve: (v) => { if (timer) clearTimeout(timer); resolve(v); },
        reject: (e) => { if (timer) clearTimeout(timer); reject(e); },
      });
    });
  }

  /** Settle from a {type:'response'} wire message; false when the id is unknown. */
  settle(id: RequestId | null | undefined, success: boolean, data?: unknown, error?: string, fallbackError = 'command failed'): boolean {
    const pending = id != null ? this._map.get(id) : null;
    if (!pending) return false;
    this._map.delete(id!);
    if (success) pending.resolve(data);
    else pending.reject(new Error(error || fallbackError));
    return true;
  }

  /** Reject one tracked request (e.g. the transport write threw). */
  fail(id: RequestId, err: unknown): void {
    const pending = this._map.get(id);
    if (!pending) return;
    this._map.delete(id);
    pending.reject(err);
  }

  /** Reject everything (socket closed / process exited). */
  failAll(err: unknown): void {
    for (const pending of this._map.values()) pending.reject(err);
    this._map.clear();
  }
}

export = { PendingRequests };
