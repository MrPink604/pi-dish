import type { HelperSession, HelperHost, RefContextEntry } from './shared-helper-types';
import { fuzzyMatch, fuzzyScore } from './helper-query';
declare const Buffer: { from(value: string, encoding: 'base64'): { toString(encoding: 'utf8'): string } } | undefined;

/**
 * The shortest id prefix of at least `minLen` characters that no peer id
 * shares, falling back to the whole id. A blind 8-character slice is fine
 * for a uuid and useless for a timestamp corpus, where three sessions
 * started the same day all begin `2026-08-`; the owning server rejects an
 * ambiguous prefix, so a ref built without looking at the corpus can simply
 * fail to resolve. Every caller that *has* the corpus should widen with it.
 */
export function uniqueSessionPrefix(id: unknown, peerIds?: readonly unknown[] | null, minLen = 8) {
  const self = String(id == null ? '' : id);
  if (!self) return '';
  const peers = (peerIds || []).filter((peer) => peer && peer !== self);
  for (let len = Math.min(minLen, self.length); len < self.length; len++) {
    const candidate = self.slice(0, len);
    if (!peers.some((peer) => String(peer).startsWith(candidate))) return candidate;
  }
  return self;
}

// =========================================================================
// Route ids, ref aliases, and the one resolution rule
//
// A Pi session's route id is its native id. Every other harness's is
// `~sk1_` + base64url(JSON `[harnessId, nativeSessionId]`) — a ~100-char
// blob whose first ~30 characters are identical for every session of that
// harness on the host. That makes the "unique prefix" half of the ref
// grammar useless there: the shortest prefix that resolves is nearly the
// whole id, so an agent ends up retyping the blob — and a base64 typo
// still decodes to a well-formed id, so the server can only answer "not
// found" (observed: a dropped `-05T` inside the payload, twice in one
// turn, diagnosed as a broken control channel).
//
// So a ref may name any identifier the session actually has: its route id,
// the harness-native id encoded inside it, and that id's trailing uuid —
// the one short, high-entropy handle every harness's ids carry. Pi gains
// the same short form (`019f9834`), which is the shape the docs always
// advertised and no Pi id could ever satisfy.
// =========================================================================
export const SESSION_ROUTE_KEY_PREFIX = '~sk1_';


export const SESSION_UUID_TAIL_RE = /(?:^|[_-])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** base64url → text in both runtimes. Session ids are ASCII, so the
 *  browser's byte-oriented atob needs no UTF-8 repair. */
export function decodeBase64Url(value: unknown) {
  const normalized = String(value == null ? '' : value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (typeof Buffer !== 'undefined') return Buffer.from(padded, 'base64').toString('utf8');
  if (typeof atob !== 'function') return '';
  return atob(padded);
}

/** The `[harnessId, nativeSessionId]` tuple inside an encoded route id, or
 *  null for a bare (legacy Pi) id and for anything malformed. */
export function decodeRouteSessionId(id: unknown) {
  const raw = String(id == null ? '' : id);
  if (!raw.startsWith(SESSION_ROUTE_KEY_PREFIX)) return null;
  try {
    const tuple: unknown = JSON.parse(decodeBase64Url(raw.slice(SESSION_ROUTE_KEY_PREFIX.length)));
    if (!Array.isArray(tuple)) return null;
    if (typeof tuple[0] !== 'string' || !tuple[0]) return null;
    if (typeof tuple[1] !== 'string' || !tuple[1]) return null;
    return { harnessId: tuple[0], nativeSessionId: tuple[1] };
  } catch { return null; }
}

/** Every identifier a ref may name for one session, most specific first:
 *  route id, harness-native id, uuid tail. Derived from the id string alone,
 *  so the browser (whose list rows carry no `nativeSessionId`) and the
 *  server compute the same set. */
export function sessionRefAliases(id: unknown) {
  const routeId = String(id == null ? '' : id);
  if (!routeId) return [];
  const aliases = [routeId];
  const decoded = decodeRouteSessionId(routeId);
  const native = decoded ? decoded.nativeSessionId : routeId;
  if (native !== routeId) aliases.push(native);
  const uuid = SESSION_UUID_TAIL_RE.exec(native);
  if (uuid) aliases.push(uuid[1]);
  return aliases;
}

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
export function resolveSessionRefAmong<T extends { id: string }>(sessions: readonly T[] | null | undefined, ref: unknown, options?: { exactOnly?: boolean }) {
  const needle = String(ref == null ? '' : ref);
  if (!needle) return { session: null, matches: [] };
  const byId = new Map<string, T>();
  for (const session of sessions || []) {
    if (session && session.id && !byId.has(session.id)) byId.set(session.id, session); // active first
  }
  const entries = [...byId.values()].map((session) => ({ session, aliases: sessionRefAliases(session.id) }));
  const stages: ((entry: { session: T; aliases: string[] }) => boolean)[] = [
    (entry) => entry.session.id === needle,
    (entry) => entry.aliases.includes(needle),
    (entry) => entry.session.id.startsWith(needle),
    (entry) => entry.aliases.some((alias) => alias.startsWith(needle)),
  ];
  const depth = options && options.exactOnly ? 2 : stages.length;
  let candidates: T[] = [];
  for (let stage = 0; stage < depth; stage++) {
    const matches = entries.filter(stages[stage]).map((entry) => entry.session);
    if (matches.length === 1) return { session: matches[0], matches };
    if (matches.length && !candidates.length) candidates = matches;
  }
  return { session: null, matches: candidates };
}

/**
 * The shortest ref that still resolves to this session among `peerIds`:
 * normally the uuid tail's first 8 characters, widened as far as the corpus
 * demands, falling back to the route-id prefix. Peers are alias-expanded
 * because that is what the resolver matches against — which is also why the
 * result can never be captured by an earlier resolution stage on some other
 * session (no peer route id or native id starts with it either).
 */
export function shortSessionRef(id: unknown, peerIds?: readonly unknown[] | null, minLen = 8) {
  const self = String(id == null ? '' : id);
  if (!self) return '';
  const peers = [];
  for (const peer of peerIds || []) {
    const other = String(peer == null ? '' : peer);
    if (!other || other === self) continue;
    peers.push(...sessionRefAliases(other));
  }
  // Most specific alias first, so an equally short candidate resolves the tie
  // toward the uuid tail: a `2026-07-` timestamp prefix is only unique against
  // the snapshot it was computed from, while 8 hex characters of a uuidv7 are
  // unique against sessions that don't exist yet.
  let best = self;
  for (const alias of sessionRefAliases(self).slice().reverse()) {
    const candidate = uniqueSessionPrefix(alias, peers, minLen);
    if (candidate && candidate.length < best.length) best = candidate;
  }
  return best;
}

/**
 * The handle to *hand back* in an API answer or a printed row, as opposed to
 * one a click copies: `shortSessionRef`, unless the only thing it shortened
 * was the route id itself. Truncating a route id swaps a stable identifier
 * for a prefix that is unique against the corpus snapshot it was computed
 * from — acceptable behind a copy button, wrong to print as *the* handle for
 * a session an agent may come back to. Naming a different identifier (the
 * native id, its uuid tail) is not a truncation, so those still shorten.
 */
export function stableSessionRef(id: unknown, peerIds?: readonly unknown[] | null, minLen = 8) {
  const self = String(id == null ? '' : id);
  if (!self) return '';
  const ref = shortSessionRef(self, peerIds, minLen);
  if (ref === self) return self;
  return sessionRefAliases(self).slice(1).some((alias) => alias.startsWith(ref)) ? ref : self;
}

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
export function sessionRef(session: string | { id?: string } | null | undefined, host?: HelperHost | null, prefix?: string) {
  const id = typeof session === 'string' ? session : (session && session.id) || '';
  if (typeof id !== 'string' || !id) return '';
  const short = typeof prefix === 'string' && prefix ? prefix : id.slice(0, 8);
  if (!host || typeof host !== 'object') return short;
  if (host.self === true || host.base === '') return short;
  if (host.name) return `${host.name}/${short}`;
  if (host.hostId) return `${host.hostId}:${id}`;
  return short;
}

// =========================================================================
// `#ref` session mentions
//
// A ref is only a string, and a model reading "8f3ab2c1" in a prompt has no
// reason to believe it addresses anything. Two halves fix that: the
// composer's `#` picker inserts exactly the ref `sessionRef` produces, and
// the send routes append one `<session-refs>` block naming what each token
// points at and which verbs act on it. The block is what makes the handle
// legible — the skill catalog in the system prompt describes the CLI but
// never says "this token in front of you is a live session".
//
// The block is *appended*, never substituted: the user's own text keeps the
// short `#ref` they typed, and the UI hides the block behind chips
// (splitSessionRefContext). Everything that compares a sent prompt against
// its echo has to strip it first — see consumePendingSelfEcho in app.js.
// =========================================================================
/** A `#ref` in prompt text. The ref charset is the docs/agent/refs.md
 *  grammar (`8f3ab2c1`, `tycho/8f3ab2c1`, `<hostId>:<fullId>`); the 4-char
 *  minimum is the server's shortest resolvable prefix, which also keeps
 *  `#1`-style tokens out. A markdown heading can't match (a space is not in
 *  the charset, and `##` fails the leading alphanumeric), and neither can a
 *  `#` glued to a word — the leading boundary is required. Backticks are
 *  deliberately not boundaries, so a ref quoted as code stays inert. */
export const SESSION_REF_TOKEN_RE = /(?:^|[\s(\[{<"'])#([A-Za-z0-9][A-Za-z0-9._:/-]{3,})/g;

/** Distinct `#ref` tokens, in order of first appearance. */
export function parseSessionRefTokens(text: unknown) {
  const out: { token: string; ref: string }[] = [];
  if (!text) return out;
  const seen = new Set();
  SESSION_REF_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = SESSION_REF_TOKEN_RE.exec(String(text))) !== null) {
    // Only '.' and ':' can end a ref by accident — a full stop after the
    // token, or a stray separator. '-' and '_' are never punctuation here:
    // an 8-char prefix of a timestamp id really is "2026-08-", and trimming
    // it would silently rewrite the ref the picker wrote.
    const ref = match[1].replace(/[.:/]+$/, '');
    if (ref.length < 4 || seen.has(ref)) continue;
    seen.add(ref);
    out.push({ token: '#' + ref, ref });
  }
  return out;
}


export const SESSION_REF_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Split a ref into host part and session part — the pure half of the CLI's
 * parser (skills/lib/pi-dish-client.js `parseRef`), same three forms and the
 * same return shape. `hostIdForm` marks the machine-produced
 * `<hostId>:<fullId>`, whose id is whole and must never prefix-match: a
 * partial expansion could retarget a recorded ref at a different session.
 */
export function parseSessionRefParts(raw: unknown) {
  const ref = String(raw == null ? '' : raw).trim();
  if (!ref) return null;
  const slash = ref.indexOf('/');
  if (slash !== -1) {
    const hostPart = ref.slice(0, slash);
    const id = ref.slice(slash + 1);
    return hostPart && id ? { hostPart, hostIdForm: false, id } : null;
  }
  const colon = ref.indexOf(':');
  if (colon > 0) {
    const head = ref.slice(0, colon);
    const rest = ref.slice(colon + 1);
    if (SESSION_REF_UUID_RE.test(head) && rest) return { hostPart: head, hostIdForm: true, id: rest };
  }
  return { hostPart: null, hostIdForm: false, id: ref };
}


export const SESSION_REF_BLOCK_RE = /\n*<session-refs>\n([\s\S]*?)\n<\/session-refs>[ \t]*$/;

// Names the thing and the verbs. Deliberately not the skill body: repeating
// ~1.5KB of SKILL.md on every prompt buys nothing the catalog entry and these
// four lines don't already give, and it would repeat per message.
export const SESSION_REF_PREAMBLE = [
  'The message above references other pi-dish sessions by `#ref`. Each is a real',
  'peer session, not a label: use the pi-dish-sessions skill CLI to read its',
  'transcript (`read <ref>`) or to message it (`send` / `steer` / `follow-up`',
  '<ref>). Never guess what a referenced session holds — read it.',
].join('\n');

/** One `key=value | ...` field. The separators and the angle brackets that
 *  delimit the block are the only characters a value may not carry. */
export function sessionRefField(value: unknown) {
  return String(value == null ? '' : value).replace(/[\r\n|<>]+/g, ' ').trim().slice(0, 200);
}

/** The `<session-refs>` block for resolved entries, '' when none resolved. */
export function formatSessionRefContext(entries?: readonly RefContextEntry[] | null) {
  const rows = [];
  for (const entry of entries || []) {
    const ref = sessionRefField(entry && entry.ref);
    if (!ref) continue;
    const fields = [`ref=${ref}`];
    const name = sessionRefField(entry.name);
    if (name) fields.push(`name=${name}`);
    const host = sessionRefField(entry.host);
    if (host) fields.push(`host=${host}`);
    if (entry.isActive != null) fields.push(`active=${entry.isActive ? 'yes' : 'no'}`);
    const cwd = sessionRefField(entry.cwd);
    if (cwd) fields.push(`cwd=${cwd}`);
    rows.push('- ' + fields.join(' | '));
  }
  if (!rows.length) return '';
  return `<session-refs>\n${SESSION_REF_PREAMBLE}\n${rows.join('\n')}\n</session-refs>`;
}

/** Prompt text plus its ref block. Unresolvable tokens contribute nothing —
 *  a `#ref` that names no session is left as the prose it probably was. */
export function appendSessionRefContext(text: unknown, entries?: readonly RefContextEntry[] | null) {
  const body = String(text == null ? '' : text);
  const block = formatSessionRefContext(entries);
  if (!block) return body;
  return body ? `${body}\n\n${block}` : block;
}

/** Inverse of appendSessionRefContext: the text as typed plus the parsed
 *  entries, for rendering chips and for comparing a prompt to its echo. */
export function splitSessionRefContext(text: unknown) {
  const body = String(text == null ? '' : text);
  const match = body.match(SESSION_REF_BLOCK_RE);
  if (!match) return { text: body, refs: [] };
  const refs = [];
  for (const line of match[1].split('\n')) {
    if (!line.startsWith('- ref=')) continue;
    const entry: Record<string, string> = Object.create(null);
    for (const field of line.slice(2).split(' | ')) {
      const eq = field.indexOf('=');
      if (eq > 0) entry[field.slice(0, eq)] = field.slice(eq + 1);
    }
    if (!entry.ref) continue;
    refs.push({
      ref: entry.ref,
      name: entry.name || '',
      host: entry.host || '',
      cwd: entry.cwd || '',
      isActive: entry.active === 'yes',
    });
  }
  return { text: body.slice(0, match.index).replace(/\s+$/, ''), refs };
}

/**
 * Rank sessions for the composer's `#` picker: a fuzzy subsequence match on
 * the name (what a human remembers), falling back to cwd and then to an id
 * prefix so a pasted ref finds its own session. Live sessions outrank
 * historical ones at equal score — a ref is usually aimed at something
 * running — and recency breaks the rest. An empty query is "most recent".
 */
export function searchSessionsForRef<T extends HelperSession>(list: readonly T[] | null | undefined, query: unknown, limit = 8) {
  const q = String(query == null ? '' : query).trim();
  const lower = q.toLowerCase();
  const rows = [];
  for (const session of list || []) {
    if (!session || !session.id) continue;
    let score = 0;
    let indices = null;
    if (q) {
      const name = session.name || '';
      indices = fuzzyMatch(q, name);
      if (indices) {
        score = 1000 + fuzzyScore(indices, name);
      } else {
        const cwd = session.cwd || '';
        const cwdIndices = fuzzyMatch(q, cwd);
        if (cwdIndices) score = 500 + fuzzyScore(cwdIndices, cwd);
        // Any identifier a ref may name, so typing a uuid tail finds the
        // session an encoded route id would hide.
        else if (sessionRefAliases(session.id).some((alias) => alias.toLowerCase().startsWith(lower))) score = 250;
        else continue;
      }
    }
    rows.push({ session, score, indices });
  }
  rows.sort((a, b) => b.score - a.score
    || (b.session.isActive ? 1 : 0) - (a.session.isActive ? 1 : 0)
    || new Date(b.session.lastActivity || 0).getTime() - new Date(a.session.lastActivity || 0).getTime());
  return rows.slice(0, Math.max(0, limit));
}
