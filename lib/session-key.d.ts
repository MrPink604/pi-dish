// Generated from src/core/session-key.ts; edit that source and run npm run build:core.
import type { NativeSessionId, SessionId, SessionIdentity } from './contracts';
declare function validId(id: unknown): id is NativeSessionId;
declare function encodeSessionKey(harnessId: string, nativeSessionId: NativeSessionId): SessionId;
declare function decodeSessionKey(key: unknown): SessionIdentity;
declare function resolveSessionRoute(value: unknown): SessionIdentity;
declare function canonicalSessionId(value: unknown): SessionId;
declare const _default: {
    encodeSessionKey: typeof encodeSessionKey;
    decodeSessionKey: typeof decodeSessionKey;
    resolveSessionRoute: typeof resolveSessionRoute;
    canonicalSessionId: typeof canonicalSessionId;
    validSessionId: typeof validId;
    VERSION: string;
    MAX_ID_LENGTH: number;
};
export = _default;
