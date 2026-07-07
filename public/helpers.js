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

/** Filter sessions locally: every whitespace-separated token must match name/cwd/model/id */
function applyLocalFilter(list, query) {
  if (!query) return list;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(s => {
    const text = sessionMetaText(s);
    return tokens.every(t => text.includes(t));
  });
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml, stripAnsi, formatTokens, formatCacheStat, formatRelativeTime, formatTime, formatDuration,
    shortCwd, truncate, extractTextContent, getToolSummary, getToolOutputText, messageHasVisibleText,
    contextClass, sessionMetaText, parseModelId, formatModelRef,
    groupByWorkspace, buildWorkspaceTree, collectTreeSessions,
    partitionPinned, applyLocalFilter, fuzzyMatch, fuzzyScore,
    highlightFuzzy, normalizeMood, isUnreadSession, THINKING_LEVEL_NAMES,
    modelMatchesPattern, isModelEnabled, pushPromptHistory, sanitizeMarkdownUrl,
  };
}
