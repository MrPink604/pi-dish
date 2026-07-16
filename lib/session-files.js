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
 * readers share. A hit refreshes the entry's recency; when the cache is full
 * the least-recently-used entry is evicted. (Clearing the whole cache instead
 * defeats the point once distinct files exceed `max`: every request past the
 * threshold re-parses nearly everything.)
 */
function statCached(cache, filePath, max, parse) {
  const stats = fs.statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    cache.delete(filePath); cache.set(filePath, cached); // refresh recency
    return cached.value;
  }
  const value = parse(filePath, stats);
  cache.delete(filePath);
  if (cache.size >= max) cache.delete(cache.keys().next().value); // evict oldest
  cache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, value });
  return value;
}

/**
 * One pass over a session JSONL: model, display name, user-message count,
 * current context tokens (compactions reset), last activity, cwd. Context
 * window/percent are derived by the caller — they depend on the live models
 * cache, which may warm up after this parse got cached.
 *
 * The content-based core is exported so lib/session-index.js can derive
 * info and search text from a single read of the file.
 */
function parseSessionFile(filePath, mtime) {
  return parseSessionContent(fs.readFileSync(filePath, 'utf-8'),
    mtime || fs.statSync(filePath).mtime);
}

function parseSessionContent(content, mtime) {
  let model = 'unknown', name = null, firstUserMsg = null, count = 0;
  let lastActivity = mtime || new Date(0);
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
  return { ...statCached(infoCache, filePath, 1000, (fp, stats) => parseSessionFile(fp, stats.mtime)) };
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
          // The JSONL entry id — pi's HTML export anchors messages by it
          // (?targetId=<id> deep links), so the client's per-message share
          // button needs it on every displayable message.
          id: entry.id || undefined,
          role: entry.message.role,
          content: entry.message.content || [],
          timestamp: entry.message.timestamp || entry.timestamp,
          model: entry.message.model,
          errorMessage: entry.message.errorMessage || undefined,
          stopReason: entry.message.stopReason || undefined,
          // toolResult entries carry these at the message level; the client
          // renders the tool name and error state from them, so a display
          // stream that dropped them showed every result as a plain "result".
          toolName: entry.message.toolName || undefined,
          toolCallId: entry.message.toolCallId || undefined,
          isError: entry.message.isError || undefined,
          ...assistantGenStats(entry),
        });
      } else if (entry.type === 'custom_message' && entry.customType === 'session-message') {
        all.push({
          id: entry.id || undefined,
          role: 'user',
          content: [{ type: 'text', text: entry.content }],
          timestamp: entry.timestamp,
        });
      } else if (entry.type === 'branch_summary') {
        // Tree navigation's record of an abandoned branch — pi injects it as
        // context, so the transcript should show it where it was created.
        all.push({
          id: entry.id || undefined,
          role: 'branchSummary',
          content: [{ type: 'text', text: entry.summary || '' }],
          timestamp: entry.timestamp,
        });
      }
    } catch (e) {}
  }
  return all;
}

/**
 * Generation timing for an assistant message entry. message.timestamp (ms
 * epoch) is stamped when the API call starts and the entry's own timestamp
 * when the finished message is appended — the delta is the generation time,
 * verified against real sessions (each start lands within ~10ms of the
 * previous entry's append). Empty for non-assistant entries or when either
 * timestamp is missing/inverted.
 */
function assistantGenStats(entry) {
  const m = entry.message;
  if (m.role !== 'assistant') return {};
  const start = m.timestamp;
  const end = entry.timestamp ? new Date(entry.timestamp).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return {};
  return { durationMs: end - start, outputTokens: m.usage?.output || 0 };
}

const messagesCache = new Map(); // filePath -> { mtimeMs, size, value }

function readSessionMessages(filePath) {
  return statCached(messagesCache, filePath, 4,
    (fp) => parseMessages(fs.readFileSync(fp, 'utf-8')));
}

/**
 * Lowercased message text of a whole session, for server-side list search.
 * Persisted (not cached) by lib/session-index.js — the search corpus is far
 * bigger than the LRU caches here should hold.
 */
function buildSearchTextFromContent(content) {
  const parts = [];
  for (const line of content.split('\n')) {
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

/**
 * Aggregate token/cost/message stats over a whole session (the /stats
 * endpoint). Cached like the other readers — do not mutate the result.
 */
const statsCache = new Map(); // filePath -> { mtimeMs, size, value }

function computeSessionStats(filePath) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0, userMessages = 0, assistantMessages = 0, toolCalls = 0, toolResults = 0;
  // Session-wide generation speed: output tokens over generation seconds,
  // summed only across messages whose timing is measurable (genOutput can be
  // less than tokens.output) so the average isn't diluted by unmeasured ones.
  let genMs = 0, genOutput = 0;
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
      const gen = assistantGenStats(entry);
      if (gen.durationMs && gen.outputTokens) {
        genMs += gen.durationMs;
        genOutput += gen.outputTokens;
      }
    }
  }
  return { tokens, cost, userMessages, assistantMessages, toolCalls, toolResults, genMs, genOutput };
}

function getSessionStats(filePath) {
  return statCached(statsCache, filePath, 200, computeSessionStats);
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
  statsCache.clear();
}

module.exports = {
  getSessionInfo,
  readSessionMessages,
  getSessionStats,
  readSessionCwd,
  decodeDirToCwd,
  resetCaches,
  parseSessionContent,
  buildSearchTextFromContent,
};
