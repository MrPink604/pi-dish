import type { HelperSession, SessionQuery } from './shared-helper-types';
import { finite } from './helper-values';
import { sessionMetaText } from './helper-identity';
import { escapeHtml } from './helper-format';

// `host` is the one client-evaluated field: hosts are a client concept (the
// client is the aggregator), so a server's own sessions carry neither
// hostLabel nor host. Clients strip host terms with stripQueryField() before
// querying any server and re-apply them locally.
// `routine` uses the same named-field substring matching: a session stamped
// with routine provenance answers `routine:nightly` and `-routine:nightly`
// everywhere the grammar is spoken. Deliberately absent from sessionMetaText —
// a plain term must not match a routine name.
export const QUERY_FIELDS = new Set(['name', 'cwd', 'model', 'id', 'is', 'host', 'routine']);

/** "7d"/"12h"/"2w" → ms span; ISO "YYYY-MM-DD" → ms epoch (local midnight); null otherwise. */
export function parseQueryDate(value: string, now: number) {
  const rel = /^(\d+)([hdw])$/.exec(value);
  if (rel) {
    const ms = Number(rel[1]) * (rel[2] === 'h' ? 3600e3 : rel[2] === 'd' ? 86400e3 : 7 * 86400e3);
    return now - ms;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const year = Number(iso[1]), month = Number(iso[2]), day = Number(iso[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const maxDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (!maxDay || day < 1 || day > maxDay) return null;
    const t = new Date(value + 'T00:00:00').getTime();
    return finite(t) ? t : null;
  }
  return null;
}

// Tokens are non-space runs, but a double-quoted span (optionally after a
// -/field: prefix) keeps its spaces: -name:"two words", "two words". One
// builder, so the parser and stripQueryField can never tokenize differently.
export function queryTokenRe() { return /(-?)([a-zA-Z]+:)?("([^"]*)"|\S+)/g; }

/**
 * The query minus every `field:`/`-field:` token (quoted values included),
 * whitespace normalized. Used to drop client-only terms — `host:` — from a
 * query before it reaches a server, which would match them against nothing
 * and so filter everything out.
 */
export function stripQueryField(query?: string | null, field?: string | null) {
  if (!query) return '';
  const want = String(field || '').toLowerCase();
  const tokenRe = queryTokenRe();
  const kept = [];
  let m;
  while ((m = tokenRe.exec(query)) !== null) {
    const prefix = m[2] ? m[2].slice(0, -1).toLowerCase() : null;
    if (prefix !== want) kept.push(m[0]);
  }
  return kept.join(' ');
}

/**
 * Parse a filter query → { terms: [{ neg, field, value }], since, before }.
 * `since`/`before` are ms epochs (null when absent); multiple occurrences
 * AND (max since, min before). Values are lowercased. `now` is injectable
 * for tests. A malformed since:/before: value falls back to a literal term.
 */
export function parseSessionQuery(query?: string | null, now = Date.now()) {
  const parsed: SessionQuery = { terms: [], since: null, before: null };
  if (!query) return parsed;
  const tokenRe = queryTokenRe();
  let m;
  while ((m = tokenRe.exec(query)) !== null) {
    const neg = m[1] === '-';
    const rawPrefix = m[2] ? m[2].slice(0, -1).toLowerCase() : null;
    const value = (m[4] !== undefined ? m[4] : m[3]).toLowerCase();
    if (!neg && (rawPrefix === 'since' || rawPrefix === 'before')) {
      const t = parseQueryDate(value, now);
      if (t !== null) {
        if (rawPrefix === 'since') parsed.since = Math.max(parsed.since ?? -Infinity, t);
        else parsed.before = Math.min(parsed.before ?? Infinity, t);
        continue;
      }
    }
    if (rawPrefix && QUERY_FIELDS.has(rawPrefix)) {
      if (value) parsed.terms.push({ neg, field: rawPrefix, value });
      continue;
    }
    // Unknown prefix (or date that didn't parse): the whole token is text.
    const literal = ((rawPrefix ? rawPrefix + ':' : '') + value);
    if (literal) parsed.terms.push({ neg, field: null, value: literal });
  }
  return parsed;
}

/** The positive plain-text terms of a parsed query — what content search and
 * snippet highlighting act on (field terms and negations never touch content). */
export function positiveQueryTokens(parsed: SessionQuery) {
  return parsed.terms.filter(t => !t.neg && !t.field).map(t => t.value);
}

/** A session launched by a routine invocation — "automation". The stamp is
 * *presentation-only* provenance (annotateSessionRoutines in server.js), so
 * this answers listing questions ("is this a cron run?") and never control
 * ones. */
export function isAutomationSession(session?: HelperSession | null) {
  return !!(session && (session.routine || session.routineId));
}

/** Does a parsed query *affirmatively* ask for automation sessions — a
 * positive `is:automation` test or a positive `routine:` term? Negations and
 * plain terms never ask: `-routine:x` only narrows within whatever the caller
 * is already showing. This is the escape hatch for the UI default that hides
 * inactive routine runs (every cron tick is a session; unmanaged they bury
 * the human list), so it must stay a positive-only signal. */
export function queryAsksForAutomation(parsed?: SessionQuery | null) {
  return (parsed?.terms || []).some(term =>
    !term.neg && (term.field === 'routine' || (term.field === 'is' && term.value === 'automation')));
}

/**
 * Evaluate a parsed query against a session. `contentText` (lowercased
 * message text) widens *positive plain* terms only: negations stay
 * metadata-only by design — excluding a session because its transcript
 * mentions a word would make `-subagent` hide half the corpus.
 */
export function evaluateSessionQuery(parsed: SessionQuery, session: HelperSession, contentText?: string) {
  if (parsed.since !== null || parsed.before !== null) {
    const t = new Date(session.lastActivity || 0).getTime();
    if (parsed.since !== null && !(t >= parsed.since)) return false;
    if (parsed.before !== null && !(t < parsed.before)) return false;
  }
  const meta = sessionMetaText(session);
  for (const term of parsed.terms) {
    let hit;
    if (term.field === 'host') {
      // Client-only: the host's display label, falling back to its id. A
      // server's sessions carry neither, so a positive host: term matches
      // nothing there — which is exactly why clients strip these first.
      hit = (session.hostLabel || session.host || '').toLowerCase().includes(term.value);
    } else if (term.field === 'is') {
      // Not a substring field: is:active tests liveness, is:automation
      // routine provenance (anything else simply never matches, so a typo
      // can't silently mean "everything").
      hit = (term.value === 'active' && !!session.isActive)
        || (term.value === 'automation' && isAutomationSession(session));
    } else {
      const field = term.field;
      const hay = field === null ? meta
        : field === 'name' || field === 'cwd' || field === 'model' || field === 'id' || field === 'routine'
          ? (session[field] || '').toLowerCase() : '';
      hit = hay.includes(term.value);
      if (!hit && !term.neg && !term.field && contentText) hit = contentText.includes(term.value);
    }
    if (hit === term.neg) return false;
  }
  return true;
}

/** Non-overlapping occurrences of `token` in `text` (both lowercased). An
 * indexOf walk, not a regex: tokens are arbitrary user text. */
export function countOccurrences(text: string | undefined, token: string) {
  if (!text || !token) return 0;
  let n = 0, i = text.indexOf(token);
  while (i !== -1) { n++; i = text.indexOf(token, i + token.length); }
  return n;
}

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
export function scoreSessionMatch(parsed: SessionQuery, session: HelperSession, contentText?: string) {
  const tokens = positiveQueryTokens(parsed);
  if (!tokens.length) return 0;
  const name = (session.name || '').toLowerCase();
  const other = [session.cwd, session.model, session.id].join(' ').toLowerCase();
  let total = 0;
  for (const token of tokens) {
    if (name.includes(token)) total += 100;
    if (other.includes(token)) total += 30;
    const n = countOccurrences(contentText, token);
    if (n > 0) total += 20 + Math.min(30, Math.round(8 * Math.log2(n)));
  }
  return Math.round(total);
}

/** Filter sessions locally (metadata + dates only — no content on this path),
 * relevance-ordered when the query has content-bearing tokens. */
export function applyLocalFilter<T extends HelperSession>(list: readonly T[], query?: string | null) {
  if (!query) return list;
  const parsed = parseSessionQuery(query);
  const out = list.filter(s => evaluateSessionQuery(parsed, s));
  if (!positiveQueryTokens(parsed).length) return out;
  return out
    .map((s): [T, number] => [s, scoreSessionMatch(parsed, s)])
    .sort((a, b) => b[1] - a[1] || new Date(b[0].lastActivity || 0).getTime() - new Date(a[0].lastActivity || 0).getTime())
    .map(([s]) => s);
}

/**
 * Narrow a list by a query's `host:` terms alone — the client-side half of a
 * query whose every other term a server already applied (host terms never
 * reach one). Returns the list untouched when the query names no host.
 */
export function applyHostTerms<T extends HelperSession>(list: readonly T[], query?: string | null) {
  if (!query) return list;
  const terms = parseSessionQuery(query).terms.filter(t => t.field === 'host');
  if (!terms.length) return list;
  const parsed = { terms, since: null, before: null };
  return list.filter(s => evaluateSessionQuery(parsed, s));
}

/** Simple fuzzy match: all chars of query appear in order in str; returns match indices or null */
export function fuzzyMatch(query: string, str: string) {
  query = query.toLowerCase();
  str = str.toLowerCase();
  let qi = 0;
  const indices = [];
  for (let si = 0; si < str.length && qi < query.length; si++) {
    if (str[si] === query[qi]) { indices.push(si); qi++; }
  }
  return qi === query.length ? indices : null;
}

/** Score fuzzy match — prefer consecutive chars, earlier matches, shorter strings */
export function fuzzyScore(indices: readonly number[] | null, str: string) {
  if (!indices) return -Infinity;
  let score = 0;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i - 1] + 1) score += 10; // consecutive bonus
  }
  score -= indices[0]; // earlier match = better
  score -= str.length * 0.1; // shorter = better
  return score;
}


export function highlightFuzzy(str: string, indices: readonly number[] | null) {
  if (!indices || !indices.length) return escapeHtml(str);
  let result = '';
  let last = 0;
  for (const idx of indices) {
    result += escapeHtml(str.slice(last, idx));
    result += `<span class="cwd-match">${escapeHtml(str[idx])}</span>`;
    last = idx + 1;
  }
  result += escapeHtml(str.slice(last));
  return result;
}

/**
 * A short plain-text excerpt of `text` around the first occurrence of any of
 * `tokens` (both already lowercased — this runs against the search corpus),
 * for showing *why* a content search matched. Trims to word boundaries and
 * marks elided ends with an ellipsis. '' when no token occurs.
 */
export function buildSnippet(text: string, tokens: readonly string[], radius = 60) {
  return buildSnippets(text, tokens, { radius, max: 1 }).snippets[0] || '';
}

/**
 * Multi-window variant for the advanced-search view: up to `max` excerpts,
 * each around the next token occurrence past the previous window, plus the
 * total occurrence count of all tokens (which keeps counting past the last
 * window — "12 matches" with 4 snippets is meaningful).
 */
export function buildSnippets(text: string, tokens: readonly string[], { radius = 60, max = 4 } = {}) {
  const valid = tokens.filter(Boolean);
  if (!valid.length) return { snippets: [], count: 0 };
  let count = 0;
  for (const t of valid) {
    let i = text.indexOf(t);
    while (i !== -1) { count++; i = text.indexOf(t, i + t.length); }
  }
  const snippets = [];
  let from = 0;
  while (snippets.length < max) {
    let at = -1, tokenLen = 0;
    for (const t of valid) {
      const i = text.indexOf(t, from);
      if (i !== -1 && (at === -1 || i < at)) { at = i; tokenLen = t.length; }
    }
    if (at === -1) break;
    // Never reach back into the previous window: repeated text between
    // adjacent excerpts reads like a rendering bug.
    let start = Math.max(snippets.length ? from : 0, at - radius);
    let end = Math.min(text.length, at + tokenLen + radius);
    // Don't cut words: pull the window edges in to the whitespace inside it.
    if (start > 0) {
      const ws = text.indexOf(' ', start);
      if (ws !== -1 && ws < at) start = ws + 1;
    }
    if (end < text.length) {
      const ws = text.lastIndexOf(' ', end);
      if (ws >= at + tokenLen) end = ws;
    }
    snippets.push((start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : ''));
    from = end + 1;
  }
  return { snippets, count };
}

/**
 * Escape `text` for HTML with every (case-insensitive) occurrence of the
 * given tokens wrapped in <mark>. Overlapping token ranges are merged so the
 * output never nests marks.
 */
export function highlightTokens(text: unknown, tokens: readonly string[]) {
  const str = String(text);
  const lower = str.toLowerCase();
  const ranges = [];
  for (const t of tokens) {
    if (!t) continue;
    const needle = String(t).toLowerCase();
    for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + 1)) {
      ranges.push([i, i + needle.length]);
    }
  }
  if (!ranges.length) return escapeHtml(str);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (const [s, e] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let out = '', pos = 0;
  for (const [s, e] of merged) {
    out += escapeHtml(str.slice(pos, s)) + '<mark>' + escapeHtml(str.slice(s, e)) + '</mark>';
    pos = e;
  }
  return out + escapeHtml(str.slice(pos));
}
