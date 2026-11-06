// Generated from src/core/session-tree-handlers.ts; edit that source and run npm run build:core.
import type { RouteHandler } from './http-boundary';
import tmux = require('./tmux');
import type { BridgeRegistryEntry } from './contracts';
import type { RPCSession } from './rpc-session';
import type { LiveSession } from './session-ownership';
import type { SessionSource } from './session-source';
export interface SessionTreePorts {
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    findSessionSource(id: string): SessionSource | null;
    getRegisteredSession(id: string): BridgeRegistryEntry | null;
    getRPCSession(id: string): InstanceType<typeof RPCSession> | null | undefined;
    locatePiPane(sessionId: string): Promise<tmux.PaneTarget | null>;
}
export declare function createSessionTreeHandler(ports: SessionTreePorts): {
    branch: RouteHandler;
};
