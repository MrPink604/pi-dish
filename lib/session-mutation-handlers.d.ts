// Generated from src/core/session-mutation-handlers.ts; edit that source and run npm run build:core.
import { type RouteHandler } from './http-boundary';
import { BridgeSession } from './bridge-session';
import type { SessionOwnership } from './session-ownership';
import type { SessionSource } from './session-source';
export interface SessionMutationPorts {
    ownership: SessionOwnership;
    findSessionSource(id: string, options?: {
        exact?: boolean;
    }): SessionSource | null;
}
export declare function sideChatSupported(sess: InstanceType<typeof BridgeSession>, res: Parameters<RouteHandler>[1]): boolean;
export declare function createSessionMutationHandlers({ ownership, findSessionSource }: SessionMutationPorts): {
    thinking: RouteHandler;
    fast: RouteHandler;
    abort: RouteHandler;
    sideChat: RouteHandler;
    sideChatAsk: RouteHandler;
    sideChatCancel: RouteHandler;
    sideChatClose: RouteHandler;
    uiResponse: RouteHandler;
    rename: RouteHandler;
    model: RouteHandler;
    cancelQueued: RouteHandler;
};
