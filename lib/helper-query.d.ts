// Generated from src/core/helper-query.ts; edit that source and run npm run build:core.
import type { HelperSession, SessionQuery } from './helper-types';
export declare const QUERY_FIELDS: Set<string>;
/** "7d"/"12h"/"2w" → `now` minus that span; "YYYY-MM-DD" → local midnight; null otherwise (ms epochs). */
export declare function parseQueryDate(value: string, now: number): number | null;
export declare function queryTokenRe(): RegExp;
/**
 * Drops client-only terms (`host:`) before a query reaches a server, which would
 * match them against nothing and filter everything out.
 */
export declare function stripQueryField(query?: string | null, field?: string | null): string;
/**
 * Repeated since/before AND together (max since, min before). A malformed
 * since:/before: value falls back to a literal term.
 */
export declare function parseSessionQuery(query?: string | null, now?: number): SessionQuery;
/** Field terms and negations never touch content. */
export declare function positiveQueryTokens(parsed: SessionQuery): string[];
/** Provenance is presentation-only: answers listing questions, never control ones. */
export declare function isAutomationSession(session?: HelperSession | null): boolean;
/** Positive-only by design: this is the escape hatch for the UI default that hides
 * inactive routine runs; `-routine:x` and plain terms only narrow. */
export declare function queryAsksForAutomation(parsed?: SessionQuery | null): boolean;
/**
 * `contentText` widens positive plain terms only: content-based negation would
 * make `-subagent` hide half the corpus.
 */
export declare function evaluateSessionQuery(parsed: SessionQuery, session: HelperSession, contentText?: string): boolean;
/** indexOf walk, not a regex: tokens are arbitrary user text. */
export declare function countOccurrences(text: string | null | undefined, token: string): number;
/**
 * Shared ranking (sidebar, `/api/sessions?q=`, `/api/search`): coverage beats
 * repetition — each positive plain token scores independently and the content
 * contribution is logarithmic and capped. Field/date terms are filters only, so
 * such queries score 0 and the caller's recency tiebreak stands.
 */
export declare function scoreSessionMatch(parsed: SessionQuery, session: HelperSession, contentText?: string | null): number;
/** Metadata + dates only (no content on this path). */
export declare function applyLocalFilter<T extends HelperSession>(list: readonly T[], query?: string | null): readonly T[];
/** The client-side half of a query whose other terms a server already applied. */
export declare function applyHostTerms<T extends HelperSession>(list: readonly T[], query?: string | null): readonly T[];
/** Returns match indices or null. */
export declare function fuzzyMatch(query: string, str: string): number[] | null;
/** Prefers consecutive chars, earlier matches, shorter strings. */
export declare function fuzzyScore(indices: readonly number[] | null, str: string): number;
export declare function highlightFuzzy(str: string, indices: readonly number[] | null): string;
/** `text` and `tokens` are already lowercased (search corpus). '' when no token occurs. */
export declare function buildSnippet(text: string, tokens: readonly string[], radius?: number): string;
/**
 * `count` keeps counting past the last window ("12 matches" with 4 snippets).
 */
export declare function buildSnippets(text: string, tokens: readonly string[], { radius, max }?: {
    max?: number | undefined;
    radius?: number | undefined;
}): {
    snippets: string[];
    count: number;
};
/** Overlapping ranges are merged so marks never nest. */
export declare function highlightTokens(text: unknown, tokens: readonly string[]): string;
