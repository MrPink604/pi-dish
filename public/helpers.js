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
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
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

function normalizeMood(description, face) {
  description = String(description || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  face = String(face || '').trim().replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ');
  if (!description || !face) return null;
  return { description, face };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml, formatTokens, formatRelativeTime, formatTime, shortCwd,
    truncate, extractTextContent, getToolSummary, getToolOutputText,
    groupByWorkspace, applyLocalFilter, fuzzyMatch, fuzzyScore,
    highlightFuzzy, normalizeMood, isUnreadSession,
  };
}
