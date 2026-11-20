// Generated from src/core/agy-session-handlers.ts; edit that source and run npm run build:core.
/**
 * Session-scoped Antigravity (`agy`) HTTP read handlers for background tasks,
 * task logs, plan checklists, subagent status, and live swarm boards.
 */
import type { RouteHandler } from './http-boundary';
import type { SessionOwnership } from './session-ownership';
import type { SessionSource } from './session-source';
export interface AgySessionHandlerPorts {
    ownership: SessionOwnership;
    findSessionSource(id: string, options?: {
        exact?: boolean;
    }): SessionSource | null;
}
export declare function createAgySessionHandlers({ ownership, findSessionSource }: AgySessionHandlerPorts): {
    tasks: RouteHandler;
    taskLog: RouteHandler;
    swarm: RouteHandler;
    artifacts: RouteHandler;
};
