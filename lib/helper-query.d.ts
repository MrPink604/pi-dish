// Generated from src/core/helper-query.ts; edit that source and run npm run build:core.
import type { HelperSession, SessionQuery } from './helper-types';
export declare const QUERY_FIELDS: Set<string>;
/** "7d"/"12h"/"2w" → ms span; ISO "YYYY-MM-DD" → ms epoch (local midnight); null otherwise. */
export declare function parseQueryDate(value: string, now: number): number | null;
export declare function queryTokenRe(): RegExp;
/**
 * The query minus every `field:`/`-field:` token (quoted values included),
 * whitespace normalized. Used to drop client-only terms — `host:` — from a
 * query before it reaches a server, which would match them against nothing
 * and so filter everything out.
 */
export declare function stripQueryField(query?: string | null, field?: string | null): string;
/**
 * Parse a filter query → { terms: [{ neg, field, value }], since, before }.
 * `since`/`before` are ms epochs (null when absent); multiple occurrences
 * AND (max since, min before). Values are lowercased. `now` is injectable
 * for tests. A malformed since:/before: value falls back to a literal term.
 */
export declare function parseSessionQuery(query?: string | null, now?: number): SessionQuery;
/** The positive plain-text terms of a parsed query — what content search and
 * snippet highlighting act on (field terms and negations never touch content). */
export declare function positiveQueryTokens(parsed: SessionQuery): string[];
/** A session launched by a routine invocation — "automation". The stamp is
 * *presentation-only* provenance (annotateSessionRoutines in server.js), so
 * this answers listing questions ("is this a cron run?") and never control
 * ones. */
export declare function isAutomationSession(session?: HelperSession | null): boolean;
/** Does a parsed query *affirmatively* ask for automation sessions — a
 * positive `is:automation` test or a positive `routine:` term? Negations and
 * plain terms never ask: `-routine:x` only narrows within whatever the caller
 * is already showing. This is the escape hatch for the UI default that hides
 * inactive routine runs (every cron tick is a session; unmanaged they bury
 * the human list), so it must stay a positive-only signal. */
export declare function queryAsksForAutomation(parsed?: SessionQuery | null): boolean;
/**
 * Evaluate a parsed query against a session. `contentText` (lowercased
 * message text) widens *positive plain* terms only: negations stay
 * metadata-only by design — excluding a session because its transcript
 * mentions a word would make `-subagent` hide half the corpus.
 */
export declare function evaluateSessionQuery(parsed: SessionQuery, session: HelperSession, contentText?: string): boolean;
/** Non-overlapping occurrences of `token` in `text` (both lowercased). An
 * indexOf walk, not a regex: tokens are arbitrary user text. */
export declare function countOccurrences(text: string | null | undefined, token: string): number;
/**
 * Relevance score for a session against a parsed query — the shared ranking
 * used by the sidebar filter, `/api/sessions?q=` and `/api/search`.
 *
 * The philosophy is *coverage beats repetition*: every positive plain token
 * contributes independently, so a session hitting two distinct keywords
 * outranks one that says a single keyword fifty times. Metadata carries the
 * most signal (a name hit is what you meant; cwd/model/id is nearly as
 * deliberate), and the content contribution grows logarithmically from a
 * single hit and caps out — a transcript can't shout its way to the top.
 *
 * Only positive plain terms score: field terms, negations and since/before
 * are filters, so a purely field/date query scores 0 everywhere and the
 * caller's recency tiebreak stands. `contentText` is the (already lowercased)
 * indexed search text, optional.
 */
export declare function scoreSessionMatch(parsed: SessionQuery, session: HelperSession, contentText?: string | null): number;
/** Filter sessions locally (metadata + dates only — no content on this path),
 * relevance-ordered when the query has content-bearing tokens. */
export declare function applyLocalFilter<T extends HelperSession>(list: readonly T[], query?: string | null): readonly T[];
/**
 * Narrow a list by a query's `host:` terms alone — the client-side half of a
 * query whose every other term a server already applied (host terms never
 * reach one). Returns the list untouched when the query names no host.
 */
export declare function applyHostTerms<T extends HelperSession>(list: readonly T[], query?: string | null): readonly T[];
/** Simple fuzzy match: all chars of query appear in order in str; returns match indices or null */
export declare function fuzzyMatch(query: string, str: string): number[] | null;
/** Score fuzzy match — prefer consecutive chars, earlier matches, shorter strings */
export declare function fuzzyScore(indices: readonly number[] | null, str: string): number;
export declare function highlightFuzzy(str: string, indices: readonly number[] | null): string;
/**
 * A short plain-text excerpt of `text` around the first occurrence of any of
 * `tokens` (both already lowercased — this runs against the search corpus),
 * for showing *why* a content search matched. Trims to word boundaries and
 * marks elided ends with an ellipsis. '' when no token occurs.
 */
export declare function buildSnippet(text: string, tokens: readonly string[], radius?: number): string;
/**
 * Multi-window variant for the advanced-search view: up to `max` excerpts,
 * each around the next token occurrence past the previous window, plus the
 * total occurrence count of all tokens (which keeps counting past the last
 * window — "12 matches" with 4 snippets is meaningful).
 */
export declare function buildSnippets(text: string, tokens: readonly string[], { radius, max }?: {
    max?: number | undefined;
    radius?: number | undefined;
}): {
    snippets: string[];
    count: number;
};
/**
 * Escape `text` for HTML with every (case-insensitive) occurrence of the
 * given tokens wrapped in <mark>. Overlapping token ranges are merged so the
 * output never nests marks.
 */
export declare function highlightTokens(text: unknown, tokens: readonly string[]): string;
