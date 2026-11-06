// Generated from src/core/live-sessions.ts; edit that source and run npm run build:core.
import { BridgeSession } from './bridge-session';
import { PrimeDaemonSession } from './prime-daemon';
import type { LiveSession, SessionOwnership } from './session-ownership';
export declare function createLiveSessionInfo(ownership: SessionOwnership): {
    primeLiveSession: (sessionId: string) => PrimeDaemonSession | null;
    isLive: (sessionId: string) => boolean;
    getLiveContextUsage: (sessionId: string) => unknown;
    liveTreeLeafId: (session: InstanceType<typeof BridgeSession>) => Promise<unknown>;
};
export interface LiveSessionLifecyclePorts {
    wakeSession(routeId: string): void;
    adoptSessionSwitch(session: LiveSession, data: unknown): void;
}
/**
 * Route id for a live transport: bridge and Prime rows carry a harness.
 * Application policy stays separate from transport-owned replay reduction,
 * and switch adoption rekeys the application only after the transport has
 * cleared its old replay state.
 */
export declare function createSessionLifecycleObserver(ports: LiveSessionLifecyclePorts): (session: LiveSession) => void;
