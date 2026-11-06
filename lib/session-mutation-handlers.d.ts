// Generated from src/core/session-mutation-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import { BridgeSession } from './bridge-session';
import type { LiveSession } from './session-ownership';
import type { BridgeRegistryEntry } from './contracts';
import type { SessionSource } from './session-source-contracts';
export interface SessionMutationPorts {
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    findSessionSource(id: string, options?: {
        exact?: boolean;
    }): SessionSource | null;
    getRegisteredSession(id: string): BridgeRegistryEntry | null;
}
type MutationHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export declare function sideChatSupported(sess: InstanceType<typeof BridgeSession>, res: Parameters<MutationHandler>[1]): boolean;
export declare function createSessionMutationHandlers(ports: SessionMutationPorts): {
    thinking: MutationHandler;
    fast: MutationHandler;
    abort: MutationHandler;
    sideChat: MutationHandler;
    sideChatAsk: MutationHandler;
    sideChatCancel: MutationHandler;
    sideChatClose: MutationHandler;
    uiResponse: MutationHandler;
    rename: MutationHandler;
    model: MutationHandler;
    cancelQueued: MutationHandler;
};
export {};
