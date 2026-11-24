// Generated from src/core/session-stream-handler.ts; edit that source and run npm run build:core.
import type { RouteHandler } from './http-boundary';
import type { LiveSession } from './session-ownership';
export interface SessionStreamPorts {
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    /** Open browser event streams per canonical session; hibernation reads it. */
    viewers: Map<string, number>;
    /** Interval for SSE keepalive comments; keeps proxies (e.g. Cloudflare 100s read timeout) from dropping idle streams. */
    heartbeatMs?: number;
    /** A session's review deck changes (`review_updated`); returns the unsubscribe. */
    reviewUpdates?(sessionId: string, listener: (data: unknown) => void): () => void;
}
export declare function createSessionStreamHandler(ports: SessionStreamPorts): RouteHandler;
