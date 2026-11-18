// Generated from src/core/live-sessions.ts; edit that source and run npm run build:core.
import { PrimeDaemonSession } from './prime-daemon';
import type { LiveSession } from './session-ownership';
/** The cached daemon root for a Prime route, without touching other harnesses. */
export declare function primeLiveSession(sessionId: string): PrimeDaemonSession | null;
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
