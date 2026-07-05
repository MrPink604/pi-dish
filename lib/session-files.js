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
const { extractTextContent } = require('../public/helpers.js');

function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
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
    name: name || (firstUserMsg ? truncate(firstUserMsg, 40) : null),
    messageCount: count,
    contextTokens,
    lastActivity,
    cwd,
  };
}

const infoCache = new Map(); // filePath -> { mtimeMs, size, info }
const INFO_CACHE_MAX = 1000;

function getSessionInfo(filePath) {
  const stats = fs.statSync(filePath);
  const cached = infoCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return { ...cached.info };
  }
  const info = parseSessionFile(filePath, stats.mtime);
  if (infoCache.size >= INFO_CACHE_MAX) infoCache.clear();
  infoCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, info });
  return { ...info };
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

const messagesCache = new Map(); // filePath -> { mtimeMs, size, messages }
const MESSAGES_CACHE_MAX = 4;

function readSessionMessages(filePath) {
  const stats = fs.statSync(filePath);
  const cached = messagesCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    messagesCache.delete(filePath); // refresh LRU position
    messagesCache.set(filePath, cached);
    return cached.messages;
  }
  const messages = parseMessages(fs.readFileSync(filePath, 'utf-8'));
  messagesCache.delete(filePath);
  if (messagesCache.size >= MESSAGES_CACHE_MAX) {
    messagesCache.delete(messagesCache.keys().next().value); // evict oldest
  }
  messagesCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, messages });
  return messages;
}

/** Lowercased message text of a whole session, for server-side list search. */
const searchTextCache = new Map(); // filePath -> { mtimeMs, size, text }
const SEARCH_CACHE_MAX = 200;

function getSessionSearchText(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const cached = searchTextCache.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.text;

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
    const text = parts.join(' ').toLowerCase();
    if (searchTextCache.size >= SEARCH_CACHE_MAX) searchTextCache.clear();
    searchTextCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, text });
    return text;
  } catch (e) {
    return '';
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
}

module.exports = {
  getSessionInfo,
  readSessionMessages,
  getSessionSearchText,
  decodeDirToCwd,
  resetCaches,
};
