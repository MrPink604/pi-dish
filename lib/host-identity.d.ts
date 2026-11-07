// Generated from src/core/host-identity.ts; edit that source and run npm run build:core.
/**
 * Stable per-host uuid in ~/.pi/dish/host-id. Clients pin a session to it and
 * fail a (re)connect that lands elsewhere. HOME is resolved per call (tests).
 */
import type { HostId } from './contracts';
declare function getHostId(): HostId;
declare function getHostLabel(settings?: unknown): string;
declare const _default: {
    getHostId: typeof getHostId;
    getHostLabel: typeof getHostLabel;
};
export = _default;
