// Generated from src/core/live-session-lifecycle.ts; edit that source and run npm run build:core.
import type { LiveSession } from './session-ownership';
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
