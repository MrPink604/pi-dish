// Generated from src/core/helper-refs.ts; edit that source and run npm run build:core.
import type { HelperSession, HelperHost, RefContextEntry } from './helper-types';
/**
 * The shortest id prefix of at least `minLen` characters that no peer id
 * shares, falling back to the whole id. A blind 8-character slice is fine
 * for a uuid and useless for a timestamp corpus, where three sessions
 * started the same day all begin `2026-08-`; the owning server rejects an
 * ambiguous prefix, so a ref built without looking at the corpus can simply
 * fail to resolve. Every caller that *has* the corpus should widen with it.
 */
export declare function uniqueSessionPrefix(id: unknown, peerIds?: readonly unknown[] | null, minLen?: number): string;
export declare const SESSION_ROUTE_KEY_PREFIX = "~sk1_";
export declare const SESSION_UUID_TAIL_RE: RegExp;
/** base64url → text in both runtimes. Session ids are ASCII, so the
 *  browser's byte-oriented atob needs no UTF-8 repair. */
export declare function decodeBase64Url(value: unknown): string;
/** The `[harnessId, nativeSessionId]` tuple inside an encoded route id, or
 *  null for a bare (legacy Pi) id and for anything malformed. */
export declare function decodeRouteSessionId(id: unknown): {
    harnessId: string;
    nativeSessionId: string;
} | null;
/** Every identifier a ref may name for one session, most specific first:
 *  route id, harness-native id, uuid tail. Derived from the id string alone,
 *  so the browser (whose list rows carry no `nativeSessionId`) and the
 *  server compute the same set. */
export declare function sessionRefAliases(id: unknown): string[];
/**
 * The one ref-resolution rule — the server's `/api/sessions/resolve` and
 * `#ref` expansion, the skill CLIs' client-side fallback, and the browser's
 * picker all go through it, so a ref cannot mean two things depending on
 * which door it came through. Stages, in order:
 *
 *   1. exact route id      2. exact alias
 *   3. route-id prefix     4. alias prefix
 *
 * The first stage with exactly one match wins, so every ref that resolved
 * before aliases existed still resolves to the same session; otherwise the
 * first stage that matched anything supplies the ambiguity candidates.
 * `exactOnly` serves the machine-produced `<hostId>:<fullId>` form, whose
 * id is whole — expanding a prefix there could retarget a recorded ref.
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
 * The shortest ref that still resolves to this session among `peerIds`:
 * normally the uuid tail's first 8 characters, widened as far as the corpus
 * demands, falling back to the route-id prefix. Peers are alias-expanded
 * because that is what the resolver matches against — which is also why the
 * result can never be captured by an earlier resolution stage on some other
 * session (no peer route id or native id starts with it either).
 */
export declare function shortSessionRef(id: unknown, peerIds?: readonly unknown[] | null, minLen?: number): string;
/**
 * The handle to *hand back* in an API answer or a printed row, as opposed to
 * one a click copies: `shortSessionRef`, unless the only thing it shortened
 * was the route id itself. Truncating a route id swaps a stable identifier
 * for a prefix that is unique against the corpus snapshot it was computed
 * from — acceptable behind a copy button, wrong to print as *the* handle for
 * a session an agent may come back to. Naming a different identifier (the
 * native id, its uuid tail) is not a truncation, so those still shorten.
 */
export declare function stableSessionRef(id: unknown, peerIds?: readonly unknown[] | null, minLen?: number): string;
/**
 * The pasteable handle for a session — what the sidebar's "Copy session ref"
 * and the stats modal put on the clipboard, and what an agent CLI takes back.
 * Three forms, ordered by what the reader on the other end can resolve:
 *
 *   `019f9834`            a session on this host (a ref the server resolves)
 *   `tycho/019f9834`      a session on a host the fleet map names
 *   `<hostId>:<full id>`  a host known only by identity (added by URL, unnamed)
 *
 * The bare prefix stays the single-host form, so a fleet-less pi-dish never
 * shows fleet syntax at all. An unnamed host can't be addressed by name, so
 * it falls back to its uuid — paired with the *full* id, because a prefix is
 * only safe where something can expand it, and nothing here can speak for a
 * corpus this client merely proxies to.
 *
 * `prefix` overrides the default 8-character slice; pass one from
 * `shortSessionRef` wherever the same-host sessions are known — a blind
 * slice of an encoded route id is `~sk1_WyJ`, which names every OMP session
 * on the host.
 */
export declare function sessionRef(session: string | {
    id?: string;
} | null | undefined, host?: HelperHost | null, prefix?: string): string;
/** A `#ref` in prompt text. The ref charset is the docs/agent/refs.md
 *  grammar (`8f3ab2c1`, `tycho/8f3ab2c1`, `<hostId>:<fullId>`); the 4-char
 *  minimum is the server's shortest resolvable prefix, which also keeps
 *  `#1`-style tokens out. A markdown heading can't match (a space is not in
 *  the charset, and `##` fails the leading alphanumeric), and neither can a
 *  `#` glued to a word — the leading boundary is required. Backticks are
 *  deliberately not boundaries, so a ref quoted as code stays inert. */
export declare const SESSION_REF_TOKEN_RE: RegExp;
/** Distinct `#ref` tokens, in order of first appearance. */
export declare function parseSessionRefTokens(text: unknown): {
    token: string;
    ref: string;
}[];
export declare const SESSION_REF_UUID_RE: RegExp;
/**
 * Split a ref into host part and session part — the pure half of the CLI's
 * parser (skills/lib/pi-dish-client.js `parseRef`), same three forms and the
 * same return shape. `hostIdForm` marks the machine-produced
 * `<hostId>:<fullId>`, whose id is whole and must never prefix-match: a
 * partial expansion could retarget a recorded ref at a different session.
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
/** One `key=value | ...` field. The separators and the angle brackets that
 *  delimit the block are the only characters a value may not carry. */
export declare function sessionRefField(value: unknown): string;
/** The `<session-refs>` block for resolved entries, '' when none resolved. */
export declare function formatSessionRefContext(entries?: readonly RefContextEntry[] | null): string;
/** Prompt text plus its ref block. Unresolvable tokens contribute nothing —
 *  a `#ref` that names no session is left as the prose it probably was. */
export declare function appendSessionRefContext(text: unknown, entries?: readonly RefContextEntry[] | null): string;
/** Inverse of appendSessionRefContext: the text as typed plus the parsed
 *  entries, for rendering chips and for comparing a prompt to its echo. */
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
 * Rank sessions for the composer's `#` picker: a fuzzy subsequence match on
 * the name (what a human remembers), falling back to cwd and then to an id
 * prefix so a pasted ref finds its own session. Live sessions outrank
 * historical ones at equal score — a ref is usually aimed at something
 * running — and recency breaks the rest. An empty query is "most recent".
 */
export declare function searchSessionsForRef<T extends HelperSession>(list: readonly T[] | null | undefined, query: unknown, limit?: number): {
    session: T;
    score: number;
    indices: number[] | null;
}[];
