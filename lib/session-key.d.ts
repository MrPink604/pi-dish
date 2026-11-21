// Generated from src/core/session-key.ts; edit that source and run npm run build:core.
import type { HarnessId, NativeSessionId, SessionId, SessionIdentity } from './contracts';
declare function validId(id: unknown): id is NativeSessionId;
declare function encodeSessionKey(harnessId: HarnessId, nativeSessionId: NativeSessionId): SessionId;
declare function decodeSessionKey(key: unknown): SessionIdentity;
declare function resolveSessionRoute(value: unknown): SessionIdentity;
declare function canonicalSessionId(value: unknown): SessionId;
declare function tryCanonicalSessionId(value: unknown): unknown;
/** Parse `<hostUuid>:<sessionRoute>` when the route part is a valid session route. */
declare function parseHostQualifiedCaller(value: unknown): {
    hostId: string;
    sessionId: SessionId;
} | null;
/** Canonical form of a local or fleet-qualified caller id (`<hostUuid>:<route>`). */
declare function canonicalCallerId(value: unknown): SessionId;
declare const _default: {
    encodeSessionKey: typeof encodeSessionKey;
    decodeSessionKey: typeof decodeSessionKey;
    resolveSessionRoute: typeof resolveSessionRoute;
    canonicalSessionId: typeof canonicalSessionId;
    tryCanonicalSessionId: typeof tryCanonicalSessionId;
    parseHostQualifiedCaller: typeof parseHostQualifiedCaller;
    canonicalCallerId: typeof canonicalCallerId;
    validSessionId: typeof validId;
    VERSION: string;
};
export = _default;
