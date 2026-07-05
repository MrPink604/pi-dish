/**
 * Session JSONL readers for server.js.
 *
 * Everything here is keyed off the on-disk session files under
 * ~/.pi/agent/sessions. The sidebar polls /api/sessions every 10s and a
 * session file can be tens of MB, so each reader caches its result keyed by
 * (mtimeMs, size) and only re-parses files that actually changed.
 *
 * getSessionInfo returns a fresh shallow copy per call (callers overlay live
 * usage onto it); readSessionMessages returns the cached array itself —
 * treat it as immutable.
 */
const fs = require('fs');
const { extractTextContent, truncate } = require('../public/helpers.js');

/**
 * The one implementation of the (mtimeMs, size) revalidating cache all
 * readers share. `lru: true` refreshes the entry's position on hit and
 * evicts the oldest entry when full; otherwise a full cache is cleared
 * wholesale (fine for cheap-to-rebuild entries).
 */
function statCached(cache, filePath, { max, lru = false }, parse) {
  const stats = fs.statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    if (lru) { cache.delete(filePath); cache.set(filePath, cached); }
    return cached.value;
  }
  const value = parse(filePath, stats);
  cache.delete(filePath);
  if (cache.size >= max) {
    if (lru) cache.delete(cache.keys().next().value); // evict oldest
    else cache.clear();
  }
  cache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, value });
  return value;
}

/**
 * One pass over a session JSONL: model, display name, user-message count,
 * current context tokens (compactions reset), last activity, cwd. Context
 * window/percent are derived by the caller — they depend on the live models
 * cache, which may warm up after this parse got cached.
 */
function parseSessionFile(filePath, mtime) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let model = 'unknown', name = null, firstUserMsg = null, count = 0;
  let lastActivity = mtime || fs.statSync(filePath).mtime;
  let contextTokens = 0;
  let cwd = null;

  for (const line of content.trim().split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'session' && entry.cwd) cwd = entry.cwd;
      if (entry.type === 'model_change') model = entry.modelId || model;
      if (entry.type === 'session_info' && entry.name) name = entry.name;
      if (entry.sessionName) name = entry.sessionName;
      if (entry.type === 'message' && entry.message?.role === 'user') {
        count++;
        if (!firstUserMsg) firstUserMsg = extractTextContent(entry.message.content);
      }
      if (!firstUserMsg && entry.type === 'custom_message') firstUserMsg = entry.content;
      if (entry.timestamp) {
        const ts = new Date(entry.timestamp).getTime();
        if (Number.isFinite(ts)) lastActivity = new Date(Math.max(lastActivity.getTime(), ts));
      }
      if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.message?.usage) {
        contextTokens = entry.message.usage.totalTokens || 0;
      }
      if (entry.type === 'compaction') contextTokens = 0;
    } catch (e) {}
  }

  return {
    model,
    name: name || (firstUserMsg ? truncate(firstUserMsg, 40, '...') : null),
    messageCount: count,
    contextTokens,
    lastActivity,
    cwd,
  };
}

const infoCache = new Map(); // filePath -> { mtimeMs, size, value }

function getSessionInfo(filePath) {
  return { ...statCached(infoCache, filePath, { max: 1000 }, (fp, stats) => parseSessionFile(fp, stats.mtime)) };
}

/**
 * The displayable message stream (what /messages paginates over). Index in
 * the returned array == the message's stream index. Cached for the few most
 * recently viewed sessions — do not mutate the result.
 */
function parseMessages(content) {
  const all = [];
  for (const line of content.trim().split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'message' && entry.message) {
        all.push({
          role: entry.message.role,
          content: entry.message.content || [],
          timestamp: entry.message.timestamp || entry.timestamp,
          model: entry.message.model,
          errorMessage: entry.message.errorMessage || undefined,
          stopReason: entry.message.stopReason || undefined,
        });
      } else if (entry.type === 'custom_message' && entry.customType === 'session-message') {
        all.push({
          role: 'user',
          content: [{ type: 'text', text: entry.content }],
          timestamp: entry.timestamp,
        });
      }
    } catch (e) {}
  }
  return all;
}

const messagesCache = new Map(); // filePath -> { mtimeMs, size, value }

function readSessionMessages(filePath) {
  return statCached(messagesCache, filePath, { max: 4, lru: true },
    (fp) => parseMessages(fs.readFileSync(fp, 'utf-8')));
}

/** Lowercased message text of a whole session, for server-side list search. */
const searchTextCache = new Map(); // filePath -> { mtimeMs, size, value }

function buildSearchText(filePath) {
  const parts = [];
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'message' && entry.message) {
        const text = extractTextContent(entry.message.content);
        if (text) parts.push(text.substring(0, 500));
      }
      if (entry.type === 'custom_message' && entry.content) {
        parts.push(entry.content.substring(0, 200));
      }
    } catch (e) {}
  }
  return parts.join(' ').toLowerCase();
}

function getSessionSearchText(filePath) {
  try {
    return statCached(searchTextCache, filePath, { max: 200 }, buildSearchText);
  } catch (e) {
    return '';
  }
}

/**
 * Aggregate token/cost/message stats over a whole session (the /stats
 * endpoint). Cached like the other readers — do not mutate the result.
 */
const statsCache = new Map(); // filePath -> { mtimeMs, size, value }

function computeSessionStats(filePath) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0, userMessages = 0, assistantMessages = 0, toolCalls = 0, toolResults = 0;
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'message' || !entry.message) continue;
    const m = entry.message;
    if (m.role === 'user') userMessages++;
    else if (m.role === 'toolResult') toolResults++;
    else if (m.role === 'assistant') {
      assistantMessages++;
      if (Array.isArray(m.content)) toolCalls += m.content.filter(c => c.type === 'toolCall').length;
      const u = m.usage;
      if (u) {
        tokens.input += u.input || 0;
        tokens.output += u.output || 0;
        tokens.cacheRead += u.cacheRead || 0;
        tokens.cacheWrite += u.cacheWrite || 0;
        cost += u.cost?.total || 0;
      }
    }
  }
  return { tokens, cost, userMessages, assistantMessages, toolCalls, toolResults };
}

function getSessionStats(filePath) {
  return statCached(statsCache, filePath, { max: 200 }, computeSessionStats);
}

/**
 * cwd from a session file's first line (the session header entry) via a
 * bounded read — session files run to tens of MB and this is hit for every
 * directory by /api/cwds. Returns null when unreadable/absent.
 */
function readSessionCwd(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const firstLine = buf.toString('utf8', 0, n).split('\n')[0];
    return JSON.parse(firstLine).cwd || null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

/** Fallback cwd from pi's session dir naming (--home-user-proj-- → /home/user/proj). */
function decodeDirToCwd(dirName) {
  const decoded = dirName.replace(/^--/, '').replace(/--$/, '');
  return '/' + decoded.replace(/-/g, '/');
}

/** Test hook: drop caches so fixtures rewritten in place are re-read. */
function resetCaches() {
  infoCache.clear();
  messagesCache.clear();
  searchTextCache.clear();
  statsCache.clear();
}

module.exports = {
  getSessionInfo,
  readSessionMessages,
  getSessionSearchText,
  getSessionStats,
  readSessionCwd,
  decodeDirToCwd,
  resetCaches,
};
