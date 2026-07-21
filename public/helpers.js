/**
 * Pure helpers shared by the frontend (loaded as globals before app.js) and
 * the node test suite (require('../public/helpers.js')). No DOM, no state —
 * keep it that way so everything here stays unit-testable.
 */

function escapeHtml(text) {
  if (text == null || text === '') return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Remove ANSI escape sequences (CSI colors, OSC titles, stray escapes).
 * Extension UI strings arrive styled for the terminal via pi's theme.fg();
 * a browser renders those codes as literal "[38;2;…m" garbage.
 */
function stripAnsi(text) {
  if (text == null || text === '') return '';
  return String(text)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '') // OSC … BEL/ST
    .replace(/\x1b\[[0-9;:?]*[ -\/]*[@-~]/g, '')        // CSI (colors, cursor)
    .replace(/\x1b[ -\/]*./g, '');                      // leftover ESC + intermediates + final
}

function formatTokens(tokens) {
  if (!tokens || tokens === 0) return '0';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

// Stats-modal "Cache" cell. OpenAI-style completions APIs report cache reads
// but have no write metric, so pi logs cacheWrite:0 even when writes clearly
// happened (a later nonzero cacheRead proves it). Writes therefore only show
// when actually reported; the hit rate — reads over all prompt tokens — is
// computable from logged data on every provider and is the number that says
// whether caching is working.
function formatCacheStat(cacheRead, cacheWrite, input) {
  const read = cacheRead || 0;
  const write = cacheWrite || 0;
  const prompt = read + write + (input || 0);
  if (prompt === 0) return '—';
  let s = `${formatTokens(read)} read (${Math.round((read / prompt) * 100)}% hit)`;
  if (write > 0) s += ` · ${formatTokens(write)} written`;
  else if (read > 0) s += ' · writes not reported';
  return s;
}

// One line for the stats modal's "Running in" row, from the server's runtime
// object (GET /stats): rpc = headless child of the pi-dish server, tmux = a
// TUI pane (session/window fields are null when the live pane query failed —
// the server name alone still locates it), terminal = a TUI outside tmux.
function formatRuntime(r) {
  if (!r || !r.kind) return '—';
  const pid = r.pid ? ` · pid ${r.pid}` : '';
  if (r.kind === 'rpc') return `pi-dish server (headless)${pid}`;
  if (r.kind === 'tmux') {
    // The hidden headless placement (dedicated pi-dish socket) reads as
    // "headless" to the user — the tmux part is plumbing worth a hint only.
    if (r.server === 'pi-dish' && r.tmuxSession === 'headless') {
      return `headless (hidden tmux — survives restarts)${pid}`;
    }
    let where = `tmux ${r.server || '?'}`;
    if (r.tmuxSession) {
      where += ` · ${r.tmuxSession}`;
      if (r.windowIndex != null) where += `:${r.windowIndex}`;
      if (r.windowName) where += ` ${r.windowName}`;
    }
    return where + pid;
  }
  return `terminal${pid}`;
}

// Generation speed for one assistant message or a whole session. Null when
// the sample can't mean anything: no tokens, or under a second of generation
// (sub-second bursts read as absurd rates).
function formatTokSpeed(outputTokens, durationMs) {
  if (!outputTokens || !durationMs || durationMs < 1000) return null;
  const rate = outputTokens / (durationMs / 1000);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return (rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10) + ' tok/s';
}

/** Pi catalog estimate; deliberately never presented as a provider bill. */
function formatEstimatedCost(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '~$0';
  const precision = value < 0.0001 ? Math.max(digits, 6) : value < 0.01 ? Math.max(digits, 4) : 2;
  return `~$${value.toFixed(precision)}`;
}

/** Compact metadata label for an authoritative, indexed assistant response. */
function formatResponseMetadata(msg, mode = 'compact') {
  if (!msg || mode === 'hidden') return null;
  const usage = msg.usage || {};
  const speed = formatTokSpeed(msg.outputTokens || usage.output, msg.durationMs);
  const tokens = usage.output ? `${formatTokens(usage.output)} out` : null;
  const elapsed = Number.isFinite(msg.durationMs) && msg.durationMs > 0
    ? `${msg.durationMs < 10000 ? (msg.durationMs / 1000).toFixed(1) : Math.round(msg.durationMs / 1000)}s`
    : null;
  if (mode === 'compact') return speed || tokens;
  const performance = [elapsed, speed].filter(Boolean).join(' · ');
  if (mode === 'performance-cost') {
    const cost = msg.pricingKnown !== false && Number.isFinite(usage.cost?.total) ? formatEstimatedCost(usage.cost.total) : null;
    return [performance, cost].filter(Boolean).join(' · ') || tokens;
  }
  return performance || tokens;
}

function formatModelPricing(model) {
  if (!model) return 'pricing unavailable';
  if (model.free) return 'free';
  if (!model.pricing) return 'pricing unavailable';
  return `$${model.pricing.input}/$${model.pricing.output} per 1M in/out`;
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const s = Math.floor(diff / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (s < 60) return 'just now';
  if (m < 60) return m + 'm ago';
  if (h < 24) return h + 'h ago';
  if (d === 1) return 'yesterday';
  if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Compact elapsed time for the working indicator: 0:05, 4:32, 1:04:09. */
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:${mm}` : mm) + ':' + String(s).padStart(2, '0');
}

/** Shorten cwd for display */
function shortCwd(cwd) {
  if (!cwd) return '';
  return cwd.replace(/^\/home\/[^/]+\//, '~/').replace(/^\/home\/[^/]+$/, '~');
}

// No newline — truncated text also lands in one-line summary spans.
function truncate(text, maxLen, suffix = ' … (truncated)') {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + suffix;
}

function extractTextContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => typeof c === 'string' ? c : c.type === 'text' ? c.text : '').join('\n');
  return '';
}

function getToolSummary(toolName, args) {
  if (!args) return '';
  if (toolName === 'Bash' || toolName === 'bash') return args.command ? truncate(args.command.split('\n')[0], 60) : '';
  if (['Read', 'read', 'Edit', 'edit', 'Write', 'write'].includes(toolName)) return args.path || '';
  const keys = Object.keys(args);
  if (keys.length) return truncate(String(args[keys[0]]), 40);
  return '';
}

/**
 * Whether a message renders any prose (a non-empty text block or an error).
 * Drives the `.message.no-text` class that focus mode and tool-activity
 * grouping key on. One definition for the static and streaming renderers —
 * they used to derive it independently and disagreed about errorMessage.
 */
function messageHasVisibleText(msg) {
  if (!msg) return false;
  if (msg.errorMessage) return true;
  if (typeof msg.content === 'string') return !!msg.content;
  return Array.isArray(msg.content) && msg.content.some(b => b && b.type === 'text' && !!b.text);
}

function getToolOutputText(partialResult) {
  if (!partialResult || !partialResult.content) return '';
  return partialResult.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');
}

/**
 * Image content blocks from a message or tool-result content array. Live
 * events carry `{ data, mimeType }`; historical pages project those bytes to
 * `{ url, mimeType }` so the browser can cache/lazy-load them. Non-array
 * content and blocks without either source yield nothing; mimeType defaults
 * to image/png. Rendering stays with the DOM-owning caller.
 */
function extractImageBlocks(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    if (!block || block.type !== 'image') continue;
    if (block.url) out.push({ url: block.url, mimeType: block.mimeType || 'image/png' });
    else if (block.data) out.push({ data: block.data, mimeType: block.mimeType || 'image/png' });
  }
  return out;
}

/** Severity class for a context-usage percentage (session list + header badges). */
function contextClass(percent) {
  return percent > 80 ? 'critical' : percent > 50 ? 'high' : '';
}

/** The searchable metadata text of a session — one definition for local
 * filtering and the server-side session search. */
function sessionMetaText(session) {
  return [session.name, session.cwd, session.model, session.id].join(' ').toLowerCase();
}

/** "provider/id" → { provider, id } (provider '' when the ref is bare). */
function parseModelId(fullModelId) {
  const slashIdx = fullModelId.indexOf('/');
  if (slashIdx > 0) {
    return { provider: fullModelId.slice(0, slashIdx), id: fullModelId.slice(slashIdx + 1) };
  }
  return { provider: '', id: fullModelId };
}

/** Model object (or string ref) → "provider/id" string, null when unknown. */
function formatModelRef(model) {
  if (!model) return null;
  if (typeof model === 'string') return model;
  const provider = model.provider;
  const id = model.id || model.modelId;
  return provider && id ? `${provider}/${id}` : null;
}

/**
 * Group sessions by workspace (cwd); groups and members sorted by last
 * activity. Groups whose cwd is in `collapsedSet` sort after all expanded
 * groups (still by recency among themselves).
 */
function groupByWorkspace(list, collapsedSet) {
  const groups = new Map(); // cwd -> [sessions]
  for (const s of list) {
    const key = s.cwd || '~';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  for (const [, sessions] of groups) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  const collapsed = (cwd) => (collapsedSet?.has(cwd) ? 1 : 0);
  return [...groups.entries()].sort((a, b) =>
    collapsed(a[0]) - collapsed(b[0])
    || new Date(b[1][0].lastActivity) - new Date(a[1][0].lastActivity));
}

/**
 * Fold groupByWorkspace's flat [cwd, sessions] pairs into a tree of path
 * nodes with single-child chains flattened (a node exists only where paths
 * diverge or sessions live). Flat labels in a narrow sidebar all show the
 * same prefix and ellipsize away the part that differs — the tree shows
 * the shared prefix once and each workspace by its distinguishing tail.
 * Returns root nodes { label, path, sessions, children, count }: `path` is
 * the full prefix (collapse-state key — equals the cwd for leaf nodes),
 * `sessions` the sessions living exactly at `path` (null if none), `count`
 * the subtree total. Sibling order follows the input's (recency), with
 * collapsed nodes sunk below expanded siblings at every level.
 */
function buildWorkspaceTree(groups, collapsedSet) {
  const root = { label: '', path: '', sessions: null, children: new Map(), order: 0 };
  groups.forEach(([cwd, sessions], order) => {
    let segs = cwd.split('/').filter(Boolean);
    if (segs.length === 0) segs = [cwd]; // degenerate cwd ('/') — don't drop it
    let node = root;
    for (const seg of segs) {
      const path = node === root
        ? (cwd[0] === '/' && seg !== cwd ? '/' + seg : seg)
        : node.path + '/' + seg;
      if (!node.children.has(seg)) {
        node.children.set(seg, { label: seg, path, sessions: null, children: new Map(), order });
      }
      node = node.children.get(seg);
      node.order = Math.min(node.order, order);
    }
    node.sessions = sessions;
  });

  // Flatten chains: a prefix-only node with a single child merges into it.
  const flatten = (node) => {
    while (node.children.size === 1 && !node.sessions) {
      const child = node.children.values().next().value;
      node.label = node.label ? node.label + '/' + child.label : child.label;
      node.path = child.path;
      node.sessions = child.sessions;
      node.children = child.children;
    }
    for (const child of node.children.values()) flatten(child);
  };
  for (const top of root.children.values()) flatten(top);

  // The home dir is the shared root of practically everything — a bare "~"
  // top node is pure noise (and an indent level phones can't spare). Hoist
  // its children to top level; shortCwd gives them their ~/ labels below.
  const tops = [...root.children.values()];
  const homeIdx = tops.findIndex(t => shortCwd(t.path) === '~' && !t.sessions && t.children.size);
  if (homeIdx !== -1) tops.splice(homeIdx, 1, ...tops[homeIdx].children.values());

  const collapsed = (path) => (collapsedSet?.has(path) ? 1 : 0);
  const finalize = (node, topLevel) => {
    const kids = [...node.children.values()];
    for (const k of kids) finalize(k, false);
    kids.sort((a, b) => collapsed(a.path) - collapsed(b.path) || a.order - b.order);
    node.children = kids;
    node.count = (node.sessions ? node.sessions.length : 0)
      + kids.reduce((n, k) => n + k.count, 0);
    if (topLevel) node.label = shortCwd(node.path);
  };
  for (const top of tops) finalize(top, true);
  return tops.sort((a, b) => collapsed(a.path) - collapsed(b.path) || a.order - b.order);
}

/**
 * Group sessions into date buckets for the sidebar's Recent view: Today,
 * Yesterday, This week / Last week (Monday-start), then one bucket per
 * month, newest first; sessions sort by recency inside each. Returns
 * [{ key, label, sessions }] — `key` is the stable collapse-state handle
 * ('today', 'week', 'm:2026-06', …), `label` the header text. Sessions with
 * no usable timestamp (epoch-0 fallbacks) land in a trailing 'undated'
 * bucket instead of a comical "January 1970" month.
 */
function groupSessionsByDate(list, now = Date.now()) {
  const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = day(now);
  const yesterday = today - 86400e3;
  const weekStart = today - (((new Date(today).getDay() + 6) % 7) * 86400e3);
  const lastWeekStart = weekStart - 7 * 86400e3;
  const bucketOf = (t) => {
    if (!Number.isFinite(t) || t <= 0) return { key: 'undated', label: 'Undated' };
    if (t >= today) return { key: 'today', label: 'Today' };
    if (t >= yesterday) return { key: 'yesterday', label: 'Yesterday' };
    if (t >= weekStart) return { key: 'week', label: 'This week' };
    if (t >= lastWeekStart) return { key: 'lastweek', label: 'Last week' };
    const d = new Date(t);
    return {
      key: `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  };
  const sorted = [...list].sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  const buckets = new Map();
  for (const s of sorted) {
    const b = bucketOf(new Date(s.lastActivity || 0).getTime());
    if (!buckets.has(b.key)) buckets.set(b.key, { ...b, sessions: [] });
    buckets.get(b.key).sessions.push(s);
  }
  // Input order is recency-desc, so buckets appear newest-first already —
  // except 'undated', which must sink below everything dated.
  const out = [...buckets.values()];
  const u = out.findIndex(b => b.key === 'undated');
  if (u !== -1) out.push(out.splice(u, 1)[0]);
  return out;
}

/** All sessions in a workspace-tree subtree (collapsed headers aggregate status). */
function collectTreeSessions(node, out = []) {
  if (node.sessions) out.push(...node.sessions);
  for (const child of node.children) collectTreeSessions(child, out);
  return out;
}

/**
 * Split sessions into [pinned, rest]. Pinned sessions come back in
 * `pinnedIds` order (the user's manual arrangement); ids with no matching
 * session are skipped.
 */
function partitionPinned(list, pinnedIds) {
  if (!pinnedIds || pinnedIds.length === 0) return [[], list];
  const byId = new Map(list.map(s => [s.id, s]));
  const pinned = pinnedIds.map(id => byId.get(id)).filter(Boolean);
  const pinnedSet = new Set(pinned.map(s => s.id));
  return [pinned, list.filter(s => !pinnedSet.has(s.id))];
}

// =========================================================================
// Session filter query grammar — one dialect for the sidebar's local filter,
// the server-side list search, and saved scopes, so a query means the same
// thing everywhere it can be typed.
//
//   foo "two words"        plain terms (AND) — metadata, plus message content
//                          where the caller supplies it (server search)
//   -foo -name:subagent    negation — always metadata-only, so a session
//                          whose *content* merely mentions the word survives
//   name:x cwd:x model:x id:x   field-scoped terms
//   since:7d since:2026-07-01 before:...   lastActivity bounds (h/d/w or ISO)
//
// Unknown prefixes stay literal text ("subagent: fix" searches for the colon
// form), so the grammar never eats a query that wasn't meant for it.
// =========================================================================

const QUERY_FIELDS = new Set(['name', 'cwd', 'model', 'id']);

/** "7d"/"12h"/"2w" → ms span; ISO "YYYY-MM-DD" → ms epoch (local midnight); null otherwise. */
function parseQueryDate(value, now) {
  const rel = /^(\d+)([hdw])$/.exec(value);
  if (rel) {
    const ms = Number(rel[1]) * { h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[rel[2]];
    return now - ms;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const t = new Date(value + 'T00:00:00').getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Parse a filter query → { terms: [{ neg, field, value }], since, before }.
 * `since`/`before` are ms epochs (null when absent); multiple occurrences
 * AND (max since, min before). Values are lowercased. `now` is injectable
 * for tests. A malformed since:/before: value falls back to a literal term.
 */
function parseSessionQuery(query, now = Date.now()) {
  const parsed = { terms: [], since: null, before: null };
  if (!query) return parsed;
  // Tokens are non-space runs, but a double-quoted span (optionally after a
  // -/field: prefix) keeps its spaces: -name:"two words", "two words".
  const tokenRe = /(-?)([a-zA-Z]+:)?("([^"]*)"|\S+)/g;
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
function positiveQueryTokens(parsed) {
  return parsed.terms.filter(t => !t.neg && !t.field).map(t => t.value);
}

/**
 * Evaluate a parsed query against a session. `contentText` (lowercased
 * message text) widens *positive plain* terms only: negations stay
 * metadata-only by design — excluding a session because its transcript
 * mentions a word would make `-subagent` hide half the corpus.
 */
function evaluateSessionQuery(parsed, session, contentText) {
  if (parsed.since !== null || parsed.before !== null) {
    const t = new Date(session.lastActivity || 0).getTime();
    if (parsed.since !== null && !(t >= parsed.since)) return false;
    if (parsed.before !== null && !(t < parsed.before)) return false;
  }
  const meta = sessionMetaText(session);
  for (const term of parsed.terms) {
    const hay = term.field ? String(session[term.field] || '').toLowerCase() : meta;
    let hit = hay.includes(term.value);
    if (!hit && !term.neg && !term.field && contentText) hit = contentText.includes(term.value);
    if (hit === term.neg) return false;
  }
  return true;
}

/** Filter sessions locally (metadata + dates only — no content on this path). */
function applyLocalFilter(list, query) {
  if (!query) return list;
  const parsed = parseSessionQuery(query);
  return list.filter(s => evaluateSessionQuery(parsed, s));
}

/** Simple fuzzy match: all chars of query appear in order in str; returns match indices or null */
function fuzzyMatch(query, str) {
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
function fuzzyScore(indices, str) {
  if (!indices) return -Infinity;
  let score = 0;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i - 1] + 1) score += 10; // consecutive bonus
  }
  score -= indices[0]; // earlier match = better
  score -= str.length * 0.1; // shorter = better
  return score;
}

function highlightFuzzy(str, indices) {
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
 * Unread = a live, idle session whose last activity is newer than when the
 * user last had it on screen. The session being viewed right now (visibly)
 * is never unread; a working session shows the working indicator instead.
 */
function isUnreadSession(session, seenMap, currentId, viewingVisible) {
  if (!session.isActive || session.turnInProgress) return false;
  if (session.id === currentId && viewingVisible) return false;
  const seen = seenMap[session.id];
  return !seen || new Date(session.lastActivity) > new Date(seen);
}

/**
 * pi "scoped models": settings.enabledModels holds patterns picking which
 * models are enabled for cycling (the TUI's /scoped-models selector persists
 * exact "provider/id" strings; hand-edited settings may use minimatch-style
 * globs and an optional ":level" thinking suffix). Mirror pi's
 * resolveModelScope matching: try the full "provider/id", then the bare id.
 */
const THINKING_LEVEL_NAMES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function stripThinkingSuffix(pattern) {
  const idx = pattern.lastIndexOf(':');
  if (idx === -1) return pattern;
  const suffix = pattern.slice(idx + 1).toLowerCase();
  return THINKING_LEVEL_NAMES.includes(suffix) ? pattern.slice(0, idx) : pattern;
}

// Glob → RegExp: * and ? don't cross "/" (minimatch semantics), [...] passes through.
// Returns null for a malformed glob (e.g. an unbalanced '[') rather than
// throwing — a hand-edited settings pattern must not take down /api/models.
function globToRegExp(glob) {
  const source = glob.replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  try {
    return new RegExp('^' + source + '$', 'i');
  } catch {
    return null;
  }
}

function modelMatchesPattern(pattern, model) {
  pattern = stripThinkingSuffix(String(pattern || ''));
  if (!pattern || !model || !model.id) return false;
  const fullId = (model.provider ? model.provider + '/' : '') + model.id;
  if (/[*?[]/.test(pattern)) {
    const re = globToRegExp(pattern);
    return !!re && (re.test(fullId) || re.test(model.id));
  }
  const p = pattern.toLowerCase();
  const id = model.id.toLowerCase();
  // Exact match, or the pattern is an alias for dated versions (claude-sonnet-4-5 → -20250929).
  return p === fullId.toLowerCase() || p === id || id.startsWith(p + '-');
}

/** No/empty patterns = no filter, everything enabled (pi's semantics). */
function isModelEnabled(patterns, model) {
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  return patterns.some(p => modelMatchesPattern(p, model));
}

/** Either half may be missing ({mood,label}-shaped tools send only one). */
function normalizeMood(description, face) {
  description = String(description || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  face = String(face || '').trim().replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ');
  if (!description && !face) return null;
  return { description, face };
}

/**
 * Append a sent prompt to a history list: trims, skips empties, dedupes an
 * immediate repeat, and caps the list (oldest dropped). Returns a new array.
 */
function pushPromptHistory(list, message, cap) {
  const out = Array.isArray(list) ? list.slice() : [];
  const msg = String(message || '').trim();
  if (!msg) return out;
  if (out[out.length - 1] === msg) return out;
  out.push(msg);
  const max = cap > 0 ? cap : 50;
  return out.length > max ? out.slice(out.length - max) : out;
}

/**
 * Neutralize URL schemes that execute script when a markdown link/image is
 * rendered into the DOM (the parsed markdown is written to innerHTML). Browsers
 * ignore whitespace and control characters spliced into a scheme, so strip
 * those before testing. Returns '#' for a blocked URL, otherwise the trimmed
 * original. Safe schemes (http/https/mailto), relative paths, and anchors pass.
 */
function sanitizeMarkdownUrl(url) {
  const raw = String(url == null ? '' : url).trim();
  const scheme = raw.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (/^(javascript|vbscript|data):/.test(scheme)) return '#';
  return raw;
}

/**
 * Whether a chat-mentioned token plausibly names a file the viewer could
 * open: one path-safe token (optionally ~/, ./, ../ or / rooted, optional
 * trailing :line[:col]) that carries a '/' or a letter-led extension. The
 * extension rule keeps versions ("1.2.3") and prose out while accepting
 * "findings.md"; false positives are cheap (the server 404s), false
 * negatives are a dead filename the user can't tap.
 */
var FILE_MENTION_RE = /^(?:~\/|\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?$/;
var FILE_EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

function looksLikeFilePath(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s || s.length > 260) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false; // URLs
  if (!FILE_MENTION_RE.test(s)) return false;
  const stripped = s.replace(/:\d+(?::\d+)?$/, '');
  return stripped.includes('/') || FILE_EXT_RE.test(stripped);
}

/**
 * Path-looking tokens in plain prose (inline code is handled separately and
 * more permissively). Stricter than looksLikeFilePath: a bare word only
 * counts with a rooted prefix or a real extension — "and/or" and
 * "input/output" must not linkify — and domain-ish extensions are dropped
 * ("example.com" is prose, not a file). Returns [{ start, end, token }].
 */
var PATH_TOKEN_RE = /(?:~\/|\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?/g;
var BARE_EXT_STOPLIST = new Set(['com', 'org', 'net', 'io', 'ai', 'dev', 'co', 'app']);

function findPathTokens(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN_RE.exec(s))) {
    // '.' is a path char, so a sentence period rides along — trim it.
    const token = m[0].replace(/[.,;:!?]+$/, '');
    if (!token) continue;
    const prev = s[m.index - 1];
    if (prev && /[\w.@:/+-]/.test(prev)) continue; // mid-URL / mid-word
    if (!looksLikeFilePath(token)) continue;
    const stripped = token.replace(/:\d+(?::\d+)?$/, '');
    const rooted = /^(?:~\/|\.{1,2}\/|\/)/.test(stripped);
    const ext = (stripped.match(FILE_EXT_RE) || [''])[0].slice(1);
    if (!rooted && !ext) continue;
    if (!rooted && !stripped.includes('/') && BARE_EXT_STOPLIST.has(ext.toLowerCase())) continue;
    out.push({ start: m.index, end: m.index + token.length, token });
  }
  return out;
}

/**
 * A short plain-text excerpt of `text` around the first occurrence of any of
 * `tokens` (both already lowercased — this runs against the search corpus),
 * for showing *why* a content search matched. Trims to word boundaries and
 * marks elided ends with an ellipsis. '' when no token occurs.
 */
function buildSnippet(text, tokens, radius = 60) {
  let at = -1, tokenLen = 0;
  for (const t of tokens) {
    const i = text.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) { at = i; tokenLen = t.length; }
  }
  if (at === -1) return '';
  let start = Math.max(0, at - radius);
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
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

/**
 * Escape `text` for HTML with every (case-insensitive) occurrence of the
 * given tokens wrapped in <mark>. Overlapping token ranges are merged so the
 * output never nests marks.
 */
function highlightTokens(text, tokens) {
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

/**
 * Render a unified diff's hunks as HTML lines for the diff modal. File-level
 * header lines (diff --git, index, ---/+++, mode/rename noise) are dropped —
 * the modal's file row already shows path and status; only content from the
 * first @@ onward renders. Returns '' for empty/missing patches.
 */
function renderDiffHtml(patch) {
  if (!patch) return '';
  const out = [];
  let inHunk = false;
  let oldLine = null, newLine = null;
  const lines = String(patch).split('\n');
  // A patch's terminating newline is a separator, not an additional blank
  // source line. Real blank context lines still carry the unified-diff ' '.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? Number(match[1]) : null;
      newLine = match ? Number(match[2]) : null;
      out.push(`<div class="diff-line diff-hunk" data-diff-line="1">${escapeHtml(line)}</div>`);
      continue;
    }
    if (!inHunk) continue;
    // Git's marker describes the preceding line; it is not itself a source
    // line and must not advance or expose old/new line coordinates.
    if (line[0] === '\\') {
      out.push(`<div class="diff-line diff-note">${escapeHtml(line)}</div>`);
      continue;
    }
    const cls = line[0] === '+' ? ' diff-add' : line[0] === '-' ? ' diff-del' : '';
    const oldAt = line[0] === '+' ? null : oldLine;
    const newAt = line[0] === '-' ? null : newLine;
    const attrs = ` data-diff-line="1" data-old-line="${oldAt ?? ''}" data-new-line="${newAt ?? ''}"`;
    out.push(`<div class="diff-line${cls}"${attrs}>${escapeHtml(line) || ' '}</div>`);
    if (line[0] !== '+' && oldLine != null) oldLine++;
    if (line[0] !== '-' && newLine != null) newLine++;
  }
  return out.join('');
}

/** CSS-safe class suffix for a git status letter (M/A/D/R/C/U/?/T). */
function diffStatusClass(letter) {
  switch (letter) {
    case 'A': case '?': return 'add';
    case 'D': return 'del';
    case 'R': case 'C': return 'ren';
    case 'U': return 'conflict';
    default: return 'mod';
  }
}

// --- Usage view (chart math and labels) ---

/**
 * Readable model name from a model id (provider stripped): drops
 * bedrock-style vendor prefixes ("us.anthropic."), trailing wire-format
 * versions ("-v1:0"), and trailing release-date stamps ("-20250929",
 * "-2024-11-20", "@20250219"). Display form only — keep the full ref in a
 * title attribute so nothing is hidden.
 */
function shortModelName(model) {
  if (!model) return 'unknown';
  let name = String(model);
  const slash = name.lastIndexOf('/');
  if (slash >= 0) name = name.slice(slash + 1);
  name = name.replace(/^(?:[a-z]{2,3}\.)?(?:anthropic|amazon|meta|mistral|cohere|ai21|google|deepseek|qwen)\./, '');
  name = name.replace(/-v\d+:\d+$/, ''); // bedrock wire format only — "-v4" is a real model name
  name = name.replace(/[-@](?:20\d{6}|20\d{2}-\d{2}-\d{2})$/, '');
  return name || String(model);
}

/**
 * Clean axis ticks for a positive maximum: ~`target` steps on a
 * 1/2/2.5/5×10^k grid, ascending from 0; `top` is the last tick (≥ max).
 */
function niceTicks(max, target = 4) {
  if (!Number.isFinite(max) || max <= 0) return { step: 1, top: 1, ticks: [0, 1] };
  const rawStep = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let step = 10 * mag;
  for (const m of [1, 2, 2.5, 5]) { if (rawStep <= m * mag) { step = m * mag; break; } }
  const ticks = [];
  const top = Math.ceil(max / step - 1e-9) * step;
  for (let i = 0; i * step <= top + step / 2; i++) ticks.push(Math.round(i * step * 1e9) / 1e9);
  return { step, top: ticks[ticks.length - 1], ticks };
}

const USAGE_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const USAGE_WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-07-12" → "Jul 12" ('short') or "Sat, Jul 12, 2026" ('long'). Locale-free. */
function formatUsageDay(day, style = 'short') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return String(day || '');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const label = `${USAGE_MONTH_NAMES[mo - 1] || m[2]} ${d}`;
  if (style !== 'long') return label;
  return `${USAGE_WEEKDAY_NAMES[new Date(y, mo - 1, d, 12).getDay()]}, ${label}, ${y}`;
}

/**
 * Fold a long daily usage series into week buckets (chart bars and their
 * 2px gaps stop reading past ~90 marks). Chunks of 7 anchored at the END so
 * the newest bucket always ends today; the oldest may be partial. Model rows
 * merge by ref. Entries keep the daily shape plus `days` (bucket span);
 * `day` is the bucket's first day.
 */
function aggregateUsageWeekly(daily) {
  const out = [];
  const tokenKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
  const costKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
  for (let end = daily.length; end > 0; end -= 7) {
    const chunk = daily.slice(Math.max(0, end - 7), end);
    const models = new Map();
    const agg = {
      day: chunk[0].day, days: chunk.length, calls: 0,
      tokens: Object.fromEntries(tokenKeys.map(k => [k, 0])),
      costs: Object.fromEntries(costKeys.map(k => [k, 0])),
      models: [],
    };
    for (const d of chunk) {
      agg.calls += d.calls || 0;
      for (const k of tokenKeys) agg.tokens[k] += d.tokens?.[k] || 0;
      for (const k of costKeys) agg.costs[k] += d.costs?.[k] || 0;
      for (const dm of d.models || []) {
        const t = models.get(dm.ref) || { ref: dm.ref, provider: dm.provider, model: dm.model, calls: 0, cost: 0, tokens: Object.fromEntries(tokenKeys.map(k => [k, 0])) };
        t.calls += dm.calls || 0;
        t.cost += dm.cost || 0;
        for (const k of tokenKeys) t.tokens[k] += dm.tokens?.[k] || 0;
        models.set(dm.ref, t);
      }
    }
    agg.models = [...models.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls);
    out.unshift(agg);
  }
  return out;
}

/**
 * tmux prefix key notation ("C-b", "C-a", "M-x", "C-Space") → the raw byte
 * sequence a terminal sends for it. Null when unmappable — the on-screen
 * prefix button hides rather than sending the wrong bytes.
 */
function tmuxPrefixSeq(prefix) {
  if (typeof prefix !== 'string') return null;
  if (/^C-Space$/i.test(prefix)) return '\x00';
  let m = /^C-([a-zA-Z@[\\\]^_?])$/.exec(prefix);
  if (m) {
    if (m[1] === '?') return '\x7f';
    const code = m[1].toUpperCase().charCodeAt(0);
    return String.fromCharCode(code & 31);
  }
  m = /^M-(.)$/.exec(prefix);
  if (m) return '\x1b' + m[1];
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml, stripAnsi, formatTokens, formatCacheStat, formatRuntime, formatRelativeTime, formatTime, formatDuration, formatTokSpeed,
    formatEstimatedCost, formatResponseMetadata, formatModelPricing,
    shortCwd, truncate, extractTextContent, getToolSummary, getToolOutputText, extractImageBlocks, messageHasVisibleText,
    contextClass, sessionMetaText, parseModelId, formatModelRef,
    groupByWorkspace, buildWorkspaceTree, collectTreeSessions, groupSessionsByDate,
    partitionPinned, applyLocalFilter, fuzzyMatch, fuzzyScore,
    parseSessionQuery, evaluateSessionQuery, positiveQueryTokens,
    highlightFuzzy, normalizeMood, isUnreadSession, THINKING_LEVEL_NAMES,
    modelMatchesPattern, isModelEnabled, pushPromptHistory, sanitizeMarkdownUrl,
    buildSnippet, highlightTokens, looksLikeFilePath, findPathTokens,
    renderDiffHtml, diffStatusClass,
    shortModelName, niceTicks, formatUsageDay, aggregateUsageWeekly,
    tmuxPrefixSeq,
  };
}
