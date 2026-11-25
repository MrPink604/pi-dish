// Generated from src/core/session-stream-handler.ts; edit that source and run npm run build:core.
import type { RouteHandler } from './http-boundary';
import type { LiveSession } from './session-ownership';
import type { LiveSourceObservation, SessionSource } from './session-source';
export interface SessionStreamPorts {
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    /** Optional fallback for resolving the session's persisted file when not directly on the live transport. */
    findSessionSource?(sessionId: string): SessionSource | null;
    /** Live source observations so a colliding live claim blocks stale nested subagent routes. */
    liveSourceObservations?(sessionId: unknown): readonly LiveSourceObservation[];
    /** Open browser event streams per canonical session; hibernation reads it. */
    viewers: Map<string, number>;
    /** Interval for observable SSE heartbeats, also below reverse-proxy idle timeouts. */
    heartbeatMs?: number;
    /** A session's review deck changes (`review_updated`); returns the unsubscribe. */
    reviewUpdates?(sessionId: string, listener: (data: unknown) => void): () => void;
    /** True while a session is restarting transparently (e.g. stale bot relay) and SSE should reconnect instead of ending. */
    isRestarting?(sessionId: string): boolean;
    /** Wait for an in-flight transparent restart to finish before resolving the live session. */
    waitForRestart?(sessionId: string): Promise<void>;
}
export declare function createSessionStreamHandler(ports: SessionStreamPorts): RouteHandler;
