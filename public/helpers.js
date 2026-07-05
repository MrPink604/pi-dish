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
function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + ' … (truncated)';
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

function getToolOutputText(partialResult) {
  if (!partialResult || !partialResult.content) return '';
  return partialResult.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');
}

/** Group sessions by workspace (cwd); groups and members sorted by last activity */
function groupByWorkspace(list) {
  const groups = new Map(); // cwd -> [sessions]
  for (const s of list) {
    const key = s.cwd || '~';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  for (const [, sessions] of groups) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  return [...groups.entries()].sort((a, b) =>
    new Date(b[1][0].lastActivity) - new Date(a[1][0].lastActivity));
}

/** Filter sessions locally: every whitespace-separated token must match name/cwd/model/id */
function applyLocalFilter(list, query) {
  if (!query) return list;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(s => {
    const text = [s.name, s.cwd, s.model, s.id].join(' ').toLowerCase();
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
function globToRegExp(glob) {
  const source = glob.replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp('^' + source + '$', 'i');
}

function modelMatchesPattern(pattern, model) {
  pattern = stripThinkingSuffix(String(pattern || ''));
  if (!pattern || !model || !model.id) return false;
  const fullId = (model.provider ? model.provider + '/' : '') + model.id;
  if (/[*?[]/.test(pattern)) {
    const re = globToRegExp(pattern);
    return re.test(fullId) || re.test(model.id);
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

function normalizeMood(description, face) {
  description = String(description || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  face = String(face || '').trim().replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ');
  if (!description || !face) return null;
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml, formatTokens, formatCacheStat, formatRelativeTime, formatTime, formatDuration,
    shortCwd, truncate, extractTextContent, getToolSummary, getToolOutputText,
    groupByWorkspace, applyLocalFilter, fuzzyMatch, fuzzyScore,
    highlightFuzzy, normalizeMood, isUnreadSession, THINKING_LEVEL_NAMES,
    modelMatchesPattern, isModelEnabled, pushPromptHistory,
  };
}
