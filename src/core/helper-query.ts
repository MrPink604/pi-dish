import type { HelperSession, SessionQuery } from './helper-types';
import { finite } from './helper-values';
import { sessionMetaText } from './helper-identity';
import { escapeHtml } from './helper-format';

// `host` is client-evaluated (servers' sessions carry no host): clients strip it
// with stripQueryField() before querying a server and re-apply it locally.
// `routine` is deliberately absent from sessionMetaText so plain terms don't match it.
export const QUERY_FIELDS = new Set(['name', 'cwd', 'model', 'id', 'is', 'host', 'routine']);

/** "7d"/"12h"/"2w" → `now` minus that span; "YYYY-MM-DD" → local midnight; null otherwise (ms epochs). */
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

// A double-quoted span (optionally after -/field:) keeps its spaces. Shared so the
// parser and stripQueryField can never tokenize differently.
export function queryTokenRe() { return /(-?)([a-zA-Z]+:)?("([^"]*)"|\S+)/g; }

/**
 * Drops client-only terms (`host:`) before a query reaches a server, which would
 * match them against nothing and filter everything out.
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
 * Repeated since/before AND together (max since, min before). A malformed
 * since:/before: value falls back to a literal term.
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

/** Field terms and negations never touch content. */
export function positiveQueryTokens(parsed: SessionQuery) {
  return parsed.terms.filter(t => !t.neg && !t.field).map(t => t.value);
}

/** Provenance is presentation-only: answers listing questions, never control ones. */
export function isAutomationSession(session?: HelperSession | null) {
  return !!(session && (session.routine || session.routineId));
}

/** Positive-only by design: this is the escape hatch for the UI default that hides
 * inactive routine runs; `-routine:x` and plain terms only narrow. */
export function queryAsksForAutomation(parsed?: SessionQuery | null) {
  return (parsed?.terms || []).some(term =>
    !term.neg && (term.field === 'routine' || (term.field === 'is' && term.value === 'automation')));
}

/**
 * `contentText` widens positive plain terms only: content-based negation would
 * make `-subagent` hide half the corpus.
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
      // Servers' sessions carry neither field — why clients strip host: first.
      hit = (session.hostLabel || session.host || '').toLowerCase().includes(term.value);
    } else if (term.field === 'is') {
      // Unknown is: values never match, so a typo can't mean "everything".
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

/** indexOf walk, not a regex: tokens are arbitrary user text. */
export function countOccurrences(text: string | null | undefined, token: string) {
  if (!text || !token) return 0;
  let n = 0, i = text.indexOf(token);
  while (i !== -1) { n++; i = text.indexOf(token, i + token.length); }
  return n;
}

/**
 * Shared ranking (sidebar, `/api/sessions?q=`, `/api/search`): coverage beats
 * repetition — each positive plain token scores independently and the content
 * contribution is logarithmic and capped. Field/date terms are filters only, so
 * such queries score 0 and the caller's recency tiebreak stands.
 */
export function scoreSessionMatch(parsed: SessionQuery, session: HelperSession, contentText?: string | null) {
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

/** Metadata + dates only (no content on this path). */
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

/** The client-side half of a query whose other terms a server already applied. */
export function applyHostTerms<T extends HelperSession>(list: readonly T[], query?: string | null) {
  if (!query) return list;
  const terms = parseSessionQuery(query).terms.filter(t => t.field === 'host');
  if (!terms.length) return list;
  const parsed = { terms, since: null, before: null };
  return list.filter(s => evaluateSessionQuery(parsed, s));
}

/** Returns match indices or null. */
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

/** Prefers consecutive chars, earlier matches, shorter strings. */
export function fuzzyScore(indices: readonly number[] | null, str: string) {
  if (!indices) return -Infinity;
  let score = 0;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i - 1] + 1) score += 10;
  }
  score -= indices[0];
  score -= str.length * 0.1;
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

/** `text` and `tokens` are already lowercased (search corpus). '' when no token occurs. */
export function buildSnippet(text: string, tokens: readonly string[], radius = 60) {
  return buildSnippets(text, tokens, { radius, max: 1 }).snippets[0] || '';
}

/**
 * `count` keeps counting past the last window ("12 matches" with 4 snippets).
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
    // Never reach back into the previous window: repeated text reads like a bug.
    let start = Math.max(snippets.length ? from : 0, at - radius);
    let end = Math.min(text.length, at + tokenLen + radius);
    // Don't cut words.
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

/** Overlapping ranges are merged so marks never nest. */
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
