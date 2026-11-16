// Generated from src/core/private-access.ts; edit that source and run npm run build:core.
import type { IncomingMessage } from 'http';
export declare const PRIVATE_UNLOCK_HEADER = "x-pi-dish-private-unlock";
/** EventSource and WebSocket cannot set headers; they carry the token in the query. */
export declare const PRIVATE_UNLOCK_QUERY = "privateUnlock";
export interface PrivateAccess {
    pinConfigured(): boolean;
    /** Requires the current PIN once one exists; revokes every unlock token. */
    setPin(pin: unknown, currentPin: unknown): void;
    /** Mints an unlock token; throws 401 on a wrong PIN, 429 while locked out. */
    unlock(pin: unknown): string;
    lock(token: string | null): void;
    unlocked(req: IncomingMessage): boolean;
}
export declare function requestUnlockToken(req: IncomingMessage): string | null;
export declare function createPrivateAccess(now?: () => number): PrivateAccess;
