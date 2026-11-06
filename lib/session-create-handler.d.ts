// Generated from src/core/session-create-handler.ts; edit that source and run npm run build:core.
import type { RouteHandler } from './http-boundary';
import type { BridgeRegistryEntry } from './contracts';
import type { SessionLaunch } from './session-launch';
import type { SessionOperations } from './session-operations';
import type { RPCSession } from './rpc-session';
export interface SessionCreatePorts {
    sessionOperations: SessionOperations;
    sessionLaunch: SessionLaunch;
    findSessionFile(id: string, options?: {
        exact?: boolean;
    }): string | null;
    getRegisteredSession(id: string): BridgeRegistryEntry | null;
    getRPCSession(id: string): InstanceType<typeof RPCSession> | null | undefined;
}
export declare function createSessionCreateHandlers(ports: SessionCreatePorts): {
    create: RouteHandler;
    spawnStatus: RouteHandler;
};
