#!/usr/bin/env node
// Generated edge from skills/pi-dish-vault/scripts/pi-dish-vault.ts; edit that source and run npm run build:edges.
export declare const ENVELOPE_PREFIX = "pidish-vault:v1:";
export declare const FIELDS: readonly ['username', 'password', 'totp', 'uri', 'notes'];
interface RunArgs {
    item: string;
    env: string[];
    fields: string[];
    reason: string | null;
    timeout: number;
    session?: string;
    command: string[];
}
/** `run` arguments; everything after `--` is the command. */
export declare function parseRunArgs(argv: readonly string[]): RunArgs;
export interface SessionClaim {
    ref: string;
    name: string | null;
    host: string | null;
}
export declare function encodeEnvelope(body: {
    item: string;
    fields: readonly string[];
    reason: string | null;
    session: SessionClaim | null;
    timeoutSec: number;
}): string;
/** aac v0.11.0 pairs non-interactively only alongside a request; the listener answers this probe itself. */
export declare const PAIR_PROBE = "pidish-vault:pair";
export {};
