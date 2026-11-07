// Generated from src/core/helper-refs.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_REF_PREAMBLE = exports.SESSION_REF_BLOCK_RE = exports.SESSION_REF_UUID_RE = exports.SESSION_REF_TOKEN_RE = exports.SESSION_UUID_TAIL_RE = exports.SESSION_ROUTE_KEY_PREFIX = void 0;
exports.uniqueSessionPrefix = uniqueSessionPrefix;
exports.decodeBase64Url = decodeBase64Url;
exports.decodeRouteSessionId = decodeRouteSessionId;
exports.sessionRefAliases = sessionRefAliases;
exports.resolveSessionRefAmong = resolveSessionRefAmong;
exports.shortSessionRef = shortSessionRef;
exports.stableSessionRef = stableSessionRef;
exports.sessionRef = sessionRef;
exports.parseSessionRefTokens = parseSessionRefTokens;
exports.parseSessionRefParts = parseSessionRefParts;
exports.sessionRefField = sessionRefField;
exports.formatSessionRefContext = formatSessionRefContext;
exports.appendSessionRefContext = appendSessionRefContext;
exports.splitSessionRefContext = splitSessionRefContext;
exports.searchSessionsForRef = searchSessionsForRef;
const helper_query_1 = require("./helper-query");
/**
 * Shortest id prefix of `minLen`+ characters no peer shares. Blind slicing
 * collides on timestamp corpora, and the server rejects ambiguous prefixes.
 */
function uniqueSessionPrefix(id, peerIds, minLen = 8) {
    const self = String(id == null ? '' : id);
    if (!self)
        return '';
    const peers = (peerIds || []).filter((peer) => peer && peer !== self);
    for (let len = Math.min(minLen, self.length); len < self.length; len++) {
        const candidate = self.slice(0, len);
        if (!peers.some((peer) => String(peer).startsWith(candidate)))
            return candidate;
    }
    return self;
}
// Non-Pi harnesses encode `[harnessId, nativeSessionId]` as `~sk1_<base64>`, whose
// prefix is shared per harness, so refs must also match the native id and uuid tail.
exports.SESSION_ROUTE_KEY_PREFIX = '~sk1_';
exports.SESSION_UUID_TAIL_RE = /(?:^|[_-])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** Session ids are ASCII, so the browser's byte-oriented atob needs no UTF-8 repair. */
function decodeBase64Url(value) {
    const normalized = String(value == null ? '' : value).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    if (typeof Buffer !== 'undefined')
        return Buffer.from(padded, 'base64').toString('utf8');
    if (typeof atob !== 'function')
        return '';
    return atob(padded);
}
/** null for a bare Pi id and for anything malformed. */
function decodeRouteSessionId(id) {
    const raw = String(id == null ? '' : id);
    if (!raw.startsWith(exports.SESSION_ROUTE_KEY_PREFIX))
        return null;
    try {
        const tuple = JSON.parse(decodeBase64Url(raw.slice(exports.SESSION_ROUTE_KEY_PREFIX.length)));
        if (!Array.isArray(tuple))
            return null;
        if (typeof tuple[0] !== 'string' || !tuple[0])
            return null;
        if (typeof tuple[1] !== 'string' || !tuple[1])
            return null;
        return { harnessId: tuple[0], nativeSessionId: tuple[1] };
    }
    catch {
        return null;
    }
}
/** Route id, native id, uuid tail — derived from the id string alone so the
 *  browser (rows carry no `nativeSessionId`) and server compute the same set. */
function sessionRefAliases(id) {
    const routeId = String(id == null ? '' : id);
    if (!routeId)
        return [];
    const aliases = [routeId];
    const decoded = decodeRouteSessionId(routeId);
    const native = decoded ? decoded.nativeSessionId : routeId;
    if (native !== routeId)
        aliases.push(native);
    const uuid = exports.SESSION_UUID_TAIL_RE.exec(native);
    if (uuid)
        aliases.push(uuid[1]);
    return aliases;
}
/**
 * The single ref-resolution rule shared by server, CLIs and browser picker, so a
 * ref can't mean two things. Stages: exact route id, exact alias, route-id prefix,
 * alias prefix; the first stage with exactly one match wins, else the first stage
 * with any match supplies the ambiguity candidates. `exactOnly` serves
 * `<hostId>:<fullId>`, where expanding a prefix could retarget a recorded ref.
 */
function resolveSessionRefAmong(sessions, ref, options) {
    const needle = String(ref == null ? '' : ref);
    if (!needle)
        return { session: null, matches: [] };
    const byId = new Map();
    for (const session of sessions || []) {
        if (session && session.id && !byId.has(session.id))
            byId.set(session.id, session); // active first
    }
    const entries = [...byId.values()].map((session) => ({ session, aliases: sessionRefAliases(session.id) }));
    const stages = [
        (entry) => entry.session.id === needle,
        (entry) => entry.aliases.includes(needle),
        (entry) => entry.session.id.startsWith(needle),
        (entry) => entry.aliases.some((alias) => alias.startsWith(needle)),
    ];
    const depth = options && options.exactOnly ? 2 : stages.length;
    let candidates = [];
    for (let stage = 0; stage < depth; stage++) {
        const matches = entries.filter(stages[stage]).map((entry) => entry.session);
        if (matches.length === 1)
            return { session: matches[0], matches };
        if (matches.length && !candidates.length)
            candidates = matches;
    }
    return { session: null, matches: candidates };
}
/**
 * Shortest ref that still resolves uniquely among `peerIds`. Peers are
 * alias-expanded because that's what the resolver matches against.
 */
function shortSessionRef(id, peerIds, minLen = 8) {
    const self = String(id == null ? '' : id);
    if (!self)
        return '';
    const peers = [];
    for (const peer of peerIds || []) {
        const other = String(peer == null ? '' : peer);
        if (!other || other === self)
            continue;
        peers.push(...sessionRefAliases(other));
    }
    // Most specific alias first so ties favour the uuid tail: a timestamp prefix is
    // only unique against this snapshot, 8 hex chars of a uuidv7 stay unique.
    let best = self;
    for (const alias of sessionRefAliases(self).slice().reverse()) {
        // A peer sharing or extending this alias shadows every prefix (and
        // uniqueSessionPrefix ignores equal inputs, so it could return a shared id).
        if (peers.some((peer) => peer.startsWith(alias)))
            continue;
        const candidate = uniqueSessionPrefix(alias, peers, minLen);
        if (candidate && candidate.length < best.length)
            best = candidate;
    }
    return best;
}
/**
 * The handle to print/return (vs. copy): truncating the route id itself yields
 * a snapshot-unique prefix, wrong as a durable handle, so only shortenings to a
 * different identifier (native id, uuid tail) are kept.
 */
function stableSessionRef(id, peerIds, minLen = 8) {
    const self = String(id == null ? '' : id);
    if (!self)
        return '';
    const ref = shortSessionRef(self, peerIds, minLen);
    if (ref === self)
        return self;
    return sessionRefAliases(self).slice(1).some((alias) => alias.startsWith(ref)) ? ref : self;
}
/**
 * Pasteable handle: `019f9834` (this host), `tycho/019f9834` (named fleet host),
 * `<hostId>:<full id>` (unnamed host — full id because nothing here can expand a
 * prefix against a proxied corpus). Pass `prefix` from `shortSessionRef` when
 * peers are known: a blind slice of an encoded id (`~sk1_WyJ`) names every OMP session.
 */
function sessionRef(session, host, prefix) {
    const id = typeof session === 'string' ? session : (session && session.id) || '';
    if (typeof id !== 'string' || !id)
        return '';
    const short = typeof prefix === 'string' && prefix ? prefix : id.slice(0, 8);
    if (!host || typeof host !== 'object')
        return short;
    if (host.self === true || host.base === '')
        return short;
    if (host.name)
        return `${host.name}/${short}`;
    if (host.hostId)
        return `${host.hostId}:${id}`;
    return short;
}
// Send routes append (never substitute) a `<session-refs>` block; the UI hides it
// behind chips and prompt/echo comparisons must strip it first.
/** Charset per docs/agent/refs.md; the 4-char minimum is the server's shortest
 *  resolvable prefix and keeps `#1` out. A leading boundary is required, which
 *  excludes headings and `word#x`; backticks are deliberately not boundaries so
 *  code-quoted refs stay inert. */
exports.SESSION_REF_TOKEN_RE = /(?:^|[\s(\[{<"'])#([A-Za-z0-9][A-Za-z0-9._:/-]{3,})/g;
/** Distinct `#ref` tokens, in order of first appearance. */
function parseSessionRefTokens(text) {
    const out = [];
    if (!text)
        return out;
    const seen = new Set();
    exports.SESSION_REF_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = exports.SESSION_REF_TOKEN_RE.exec(String(text))) !== null) {
        // Trim only '.', ':' and '/': '-' is real content ("2026-08-" is a valid prefix).
        const ref = match[1].replace(/[.:/]+$/, '');
        if (ref.length < 4 || seen.has(ref))
            continue;
        seen.add(ref);
        out.push({ token: '#' + ref, ref });
    }
    return out;
}
exports.SESSION_REF_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Mirrors skills/lib/pi-dish-client.js `parseRef`. `hostIdForm` marks
 * `<hostId>:<fullId>`, whose id must never prefix-match.
 */
function parseSessionRefParts(raw) {
    const ref = String(raw == null ? '' : raw).trim();
    if (!ref)
        return null;
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
        if (exports.SESSION_REF_UUID_RE.test(head) && rest)
            return { hostPart: head, hostIdForm: true, id: rest };
    }
    return { hostPart: null, hostIdForm: false, id: ref };
}
exports.SESSION_REF_BLOCK_RE = /\n*<session-refs>\n([\s\S]*?)\n<\/session-refs>[ \t]*$/;
// Deliberately not the skill body: ~1.5KB of SKILL.md per prompt buys nothing.
exports.SESSION_REF_PREAMBLE = [
    'The message above references other pi-dish sessions by `#ref`. Each is a real',
    'peer session, not a label: use the pi-dish-sessions skill CLI to read its',
    'transcript (`read <ref>`) or to message it (`send` / `steer` / `follow-up`',
    '<ref>). Never guess what a referenced session holds — read it.',
].join('\n');
/** Strips the block's separators and delimiters from a value. */
function sessionRefField(value) {
    return String(value == null ? '' : value).replace(/[\r\n|<>]+/g, ' ').trim().slice(0, 200);
}
/** '' when none resolved. */
function formatSessionRefContext(entries) {
    const rows = [];
    for (const entry of entries || []) {
        const ref = sessionRefField(entry && entry.ref);
        if (!ref)
            continue;
        const fields = [`ref=${ref}`];
        const name = sessionRefField(entry.name);
        if (name)
            fields.push(`name=${name}`);
        const host = sessionRefField(entry.host);
        if (host)
            fields.push(`host=${host}`);
        if (entry.isActive != null)
            fields.push(`active=${entry.isActive ? 'yes' : 'no'}`);
        const cwd = sessionRefField(entry.cwd);
        if (cwd)
            fields.push(`cwd=${cwd}`);
        rows.push('- ' + fields.join(' | '));
    }
    if (!rows.length)
        return '';
    return `<session-refs>\n${exports.SESSION_REF_PREAMBLE}\n${rows.join('\n')}\n</session-refs>`;
}
/** Unresolvable tokens contribute nothing. */
function appendSessionRefContext(text, entries) {
    const body = String(text == null ? '' : text);
    const block = formatSessionRefContext(entries);
    if (!block)
        return body;
    return body ? `${body}\n\n${block}` : block;
}
/** Inverse of appendSessionRefContext. */
function splitSessionRefContext(text) {
    const body = String(text == null ? '' : text);
    const match = body.match(exports.SESSION_REF_BLOCK_RE);
    if (!match)
        return { text: body, refs: [] };
    const refs = [];
    for (const line of match[1].split('\n')) {
        if (!line.startsWith('- ref='))
            continue;
        const entry = Object.create(null);
        for (const field of line.slice(2).split(' | ')) {
            const eq = field.indexOf('=');
            if (eq > 0)
                entry[field.slice(0, eq)] = field.slice(eq + 1);
        }
        if (!entry.ref)
            continue;
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
 * Fuzzy name match, then cwd, then id/alias prefix. Live sessions outrank
 * historical at equal score; recency breaks the rest.
 */
function searchSessionsForRef(list, query, limit = 8) {
    const q = String(query == null ? '' : query).trim();
    const lower = q.toLowerCase();
    const rows = [];
    for (const session of list || []) {
        if (!session || !session.id)
            continue;
        let score = 0;
        let indices = null;
        if (q) {
            const name = session.name || '';
            indices = (0, helper_query_1.fuzzyMatch)(q, name);
            if (indices) {
                score = 1000 + (0, helper_query_1.fuzzyScore)(indices, name);
            }
            else {
                const cwd = session.cwd || '';
                const cwdIndices = (0, helper_query_1.fuzzyMatch)(q, cwd);
                if (cwdIndices)
                    score = 500 + (0, helper_query_1.fuzzyScore)(cwdIndices, cwd);
                // Aliases too, so a uuid tail finds a session hidden behind an encoded id.
                else if (sessionRefAliases(session.id).some((alias) => alias.toLowerCase().startsWith(lower)))
                    score = 250;
                else
                    continue;
            }
        }
        rows.push({ session, score, indices });
    }
    rows.sort((a, b) => b.score - a.score
        || (b.session.isActive ? 1 : 0) - (a.session.isActive ? 1 : 0)
        || new Date(b.session.lastActivity || 0).getTime() - new Date(a.session.lastActivity || 0).getTime());
    return rows.slice(0, Math.max(0, limit));
}
