// Generated from src/core/helper-refs.ts; edit that source and run npm run build:core.
import type { HelperSession, HelperHost, RefContextEntry } from './helper-types';
/**
 * Shortest id prefix of `minLen`+ characters no peer shares. Blind slicing
 * collides on timestamp corpora, and the server rejects ambiguous prefixes.
 */
export declare function uniqueSessionPrefix(id: unknown, peerIds?: readonly unknown[] | null, minLen?: number): string;
export declare const SESSION_ROUTE_KEY_PREFIX = "~sk1_";
export declare const SESSION_UUID_TAIL_RE: RegExp;
/** Session ids are ASCII, so the browser's byte-oriented atob needs no UTF-8 repair. */
export declare function decodeBase64Url(value: unknown): string;
/** null for a bare Pi id and for anything malformed. */
export declare function decodeRouteSessionId(id: unknown): {
    harnessId: string;
    nativeSessionId: string;
} | null;
/** Route id, native id, uuid tail — derived from the id string alone so the
 *  browser (rows carry no `nativeSessionId`) and server compute the same set. */
export declare function sessionRefAliases(id: unknown): string[];
/**
 * The single ref-resolution rule shared by server, CLIs and browser picker, so a
 * ref can't mean two things. Stages: exact route id, exact alias, route-id prefix,
 * alias prefix; the first stage with exactly one match wins, else the first stage
 * with any match supplies the ambiguity candidates. `exactOnly` serves
 * `<hostId>:<fullId>`, where expanding a prefix could retarget a recorded ref.
 */
export declare function resolveSessionRefAmong<T extends {
    id: string;
}>(sessions: readonly T[] | null | undefined, ref: unknown, options?: {
    exactOnly?: boolean;
}): {
    session: T;
    matches: T[];
} | {
    session: null;
    matches: T[];
};
/**
 * Shortest ref that still resolves uniquely among `peerIds`. Peers are
 * alias-expanded because that's what the resolver matches against.
 */
export declare function shortSessionRef(id: unknown, peerIds?: readonly unknown[] | null, minLen?: number): string;
/**
 * The handle to print/return (vs. copy): truncating the route id itself yields
 * a snapshot-unique prefix, wrong as a durable handle, so only shortenings to a
 * different identifier (native id, uuid tail) are kept.
 */
export declare function stableSessionRef(id: unknown, peerIds?: readonly unknown[] | null, minLen?: number): string;
/**
 * Pasteable handle: `019f9834` (this host), `tycho/019f9834` (named fleet host),
 * `<hostId>:<full id>` (unnamed host — full id because nothing here can expand a
 * prefix against a proxied corpus). Pass `prefix` from `shortSessionRef` when
 * peers are known: a blind slice of an encoded id (`~sk1_WyJ`) names every OMP session.
 */
export declare function sessionRef(session: string | {
    id?: string;
} | null | undefined, host?: HelperHost | null, prefix?: string): string;
/** Charset per docs/agent/refs.md; the 4-char minimum is the server's shortest
 *  resolvable prefix and keeps `#1` out. A leading boundary is required, which
 *  excludes headings and `word#x`; backticks are deliberately not boundaries so
 *  code-quoted refs stay inert. */
export declare const SESSION_REF_TOKEN_RE: RegExp;
/** Distinct `#ref` tokens, in order of first appearance. */
export declare function parseSessionRefTokens(text: unknown): {
    token: string;
    ref: string;
}[];
export declare const SESSION_REF_UUID_RE: RegExp;
/**
 * Mirrors skills/lib/pi-dish-client.js `parseRef`. `hostIdForm` marks
 * `<hostId>:<fullId>`, whose id must never prefix-match.
 */
export declare function parseSessionRefParts(raw: unknown): {
    hostPart: string;
    hostIdForm: boolean;
    id: string;
} | {
    hostPart: null;
    hostIdForm: boolean;
    id: string;
} | null;
export declare const SESSION_REF_BLOCK_RE: RegExp;
export declare const SESSION_REF_PREAMBLE: string;
/** Strips the block's separators and delimiters from a value. */
export declare function sessionRefField(value: unknown): string;
/** '' when none resolved. */
export declare function formatSessionRefContext(entries?: readonly RefContextEntry[] | null): string;
/** Unresolvable tokens contribute nothing. */
export declare function appendSessionRefContext(text: unknown, entries?: readonly RefContextEntry[] | null): string;
/** Inverse of appendSessionRefContext. */
export declare function splitSessionRefContext(text: unknown): {
    text: string;
    refs: {
        ref: string;
        name: string;
        host: string;
        cwd: string;
        isActive: boolean;
    }[];
};
/**
 * Fuzzy name match, then cwd, then id/alias prefix. Live sessions outrank
 * historical at equal score; recency breaks the rest.
 */
export declare function searchSessionsForRef<T extends HelperSession>(list: readonly T[] | null | undefined, query: unknown, limit?: number): {
    session: T;
    score: number;
    indices: number[] | null;
}[];
