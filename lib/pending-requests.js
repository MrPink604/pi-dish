/**
 * Id-correlated pending-request tracking shared by both session backends
 * (bridge Unix socket and RPC stdio). Owns the resolve/reject bookkeeping
 * and the per-request timeout so protocol guards can't drift between the
 * two transports — the bridge shipping without a timeout while RPC had one
 * was exactly that drift.
 */
class PendingRequests {
  constructor() {
    this._map = new Map(); // id -> { resolve, reject }
  }

  /** Register a request under `id`; returns the promise its response settles. */
  track(id, { timeout = 0, label = 'request' } = {}) {
    return new Promise((resolve, reject) => {
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
  settle(id, success, data, error, fallbackError = 'command failed') {
    const pending = id != null ? this._map.get(id) : null;
    if (!pending) return false;
    this._map.delete(id);
    if (success) pending.resolve(data);
    else pending.reject(new Error(error || fallbackError));
    return true;
  }

  /** Reject one tracked request (e.g. the transport write threw). */
  fail(id, err) {
    const pending = this._map.get(id);
    if (!pending) return;
    this._map.delete(id);
    pending.reject(err);
  }

  /** Reject everything (socket closed / process exited). */
  failAll(err) {
    for (const pending of this._map.values()) pending.reject(err);
    this._map.clear();
  }
}

module.exports = { PendingRequests };
