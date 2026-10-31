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
/**
 * aac injects only its five built-in slots. With custom fields the listener
 * returns them (and notes, if asked) as one JSON bundle in `notes`; aac puts
 * that in BUNDLE_ENV for this script's `__inject` step, which sets the
 * requested variables and runs the command. Only names cross argv.
 */
export declare function aacInvocation(args: Pick<RunArgs, 'env' | 'command'>, self: string): {
    env: string[];
    command: string[];
};
/** The listener answers `CHECK_PREFIX` + the request payload itself, without approval: `{"ok":true}` or `{"error":"<why>"}`. */
export declare const CHECK_PREFIX = "pidish-vault:check:";
/** aac v0.11.0 pairs non-interactively only alongside a request; the listener answers this probe itself. */
export declare const PAIR_PROBE = "pidish-vault:pair";
/** The listener answers this probe itself with item metadata as JSON in `notes`. */
export declare const SEARCH_PREFIX = "pidish-vault:search:";
interface SearchEntry {
    id: string;
    name: string;
    kind: string;
    uris: string[];
    fields: string[];
}
/** The listing carried in an `aac --output json connect` reply. */
export declare function decodeSearchReply(stdout: string): {
    results: SearchEntry[];
    truncated: boolean;
};
/** The listener answers this probe itself: `bw sync`, then an empty credential. */
export declare const SYNC_PROBE = "pidish-vault:sync";
export {};
