// Generated from src/core/session-create-handler.ts; edit that source and run npm run build:core.
import { type RouteHandler } from './http-boundary';
import type { SessionLaunch } from './session-launch';
import type { SessionOperations } from './session-operations';
export interface SessionCreatePorts {
    sessionOperations: SessionOperations;
    sessionLaunch: SessionLaunch;
    /** Registered, running over RPC, or persisted on this host. */
    sessionKnown(id: string): boolean;
    /** Non-secret computer-use seat disposition for a newly spawned session. */
    cuSeatState?(id: string): 'waiting_for_desktop' | null;
}
export declare function createSessionCreateHandlers(ports: SessionCreatePorts): {
    create: RouteHandler;
    spawnStatus: RouteHandler;
};
