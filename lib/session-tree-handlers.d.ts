// Generated from src/core/session-tree-handlers.ts; edit that source and run npm run build:core.
import { type RouteHandler } from './http-boundary';
import type { SessionOwnership } from './session-ownership';
import type { SessionSource } from './session-source';
export interface SessionTreePorts {
    ownership: SessionOwnership;
    findSessionSource(id: string): SessionSource | null;
}
export declare function createSessionTreeHandler({ ownership, findSessionSource }: SessionTreePorts): {
    branch: RouteHandler;
};
