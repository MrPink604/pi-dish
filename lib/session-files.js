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
function source(candidate) {
  if (typeof candidate === 'string') return { file: candidate, profileId: 'pi-v3', profileVersion: 1, harnessId: 'pi' };
  if (!candidate || typeof candidate.file !== 'string') throw new TypeError('Expected session file or candidate');
  return candidate;
}

function statCached(cache, input, max, parse) {
  const candidate = source(input);
  const filePath = candidate.file;
  const cacheKey = `${filePath}\0${candidate.profileId || 'pi-v3'}\0${candidate.profileVersion ?? 1}`;
  const stats = fs.statSync(filePath);
  const cached = cache.get(cacheKey);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    cache.delete(cacheKey); cache.set(cacheKey, cached); // refresh recency
    return cached.value;
  }
  const value = parse(filePath, stats, candidate);
  cache.delete(cacheKey);
  if (cache.size >= max) cache.delete(cache.keys().next().value); // evict oldest
  cache.set(cacheKey, { mtimeMs: stats.mtimeMs, size: stats.size, value });
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
function parseSessionFile(filePath, mtime, candidate) {
  return parseSessionContent(fs.readFileSync(filePath, 'utf-8'),
    mtime || fs.statSync(filePath).mtime, candidate);
}

function parseSessionContent(content, mtime, candidate = {}) {
  const profileId = candidate.profileId || 'pi-v3';
  let model = 'unknown', name = null, firstUserMsg = null, count = 0;
  let lastActivity = mtime || new Date(0);
  let contextTokens = 0;
  let cwd = null, sessionId = null, parentSession = null;

  // Preserve physical line zero: only the actual first line can be Pi's
  // SessionHeader. Trimming first would promote a later session-shaped entry.
  const lines = content.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    try {
      const entry = JSON.parse(lines[lineIndex]);
      if (profileId === 'omp-v1' && lineIndex === 0 && entry.type === 'title' && entry.title) name = entry.title;
      if (entry.type === 'session') {
        if (entry.cwd) cwd = entry.cwd;
        // Native identity and lineage belong to Pi's first-line SessionHeader.
        // Later session-shaped custom entries must not rewrite provenance.
        if (lineIndex === 0 || (profileId === 'omp-v1' && sessionId === null)) {
          if (typeof entry.id === 'string' && entry.id) sessionId = entry.id;
          if (typeof entry.parentSession === 'string' && entry.parentSession) parentSession = entry.parentSession;
        }
      }
      if (entry.type === 'model_change') model = (profileId === 'omp-v1' ? entry.model : entry.modelId) || model;
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
    sessionId,
    parentSession,
  };
}

const infoCache = new Map(); // filePath -> { mtimeMs, size, value }

function getSessionInfo(filePath) {
  return { ...statCached(infoCache, filePath, 1000, (fp, stats, candidate) => parseSessionFile(fp, stats.mtime, candidate)) };
}

/**
 * The session JSONL is an append-only tree: entries carry id/parentId and
 * the current history is the parent chain from the leaf back to the root,
 * with the leaf derived from the *last* entry (pi's SessionManager does the
 * same on reopen). Entries off that chain are abandoned branches from /tree
 * navigation and must not render in the transcript. Returns the set of
 * active entry ids, or null when the file predates the tree format (no
 * parentId fields) — callers then treat every entry as active.
 */
function activeTree(entries) {
  const byId = new Map();
  let leafId = null;
  for (const e of entries) {
    if (e.type === 'session' || !e.id) continue;
    if (e.parentId === undefined) return null; // pre-tree format — linear file
    byId.set(e.id, e);
    leafId = e.id;
  }
  if (!leafId) return null;
  const active = new Set();
  let cur = leafId;
  while (cur != null && !active.has(cur)) {
    active.add(cur);
    cur = byId.get(cur)?.parentId; // missing parent (torn line) ends the walk
  }
  return { ids: active, leafId };
}

function activeEntryIds(entries) {
  return activeTree(entries)?.ids || null;
}

function parseEntries(content) {
  const entries = [];
  for (const line of content.trim().split('\n')) {
    try { entries.push(JSON.parse(line)); } catch (e) {}
  }
  return entries;
}

function messageFromEntry(entry) {
  if (entry.type === 'message' && entry.message) {
    return {
      // The JSONL entry id — pi's HTML export anchors messages by it
      // (?targetId=<id> deep links), so the client's per-message share
      // button needs it on every displayable message.
      id: entry.id || undefined,
      role: entry.message.role,
      content: entry.message.content || [],
      timestamp: entry.message.timestamp || entry.timestamp,
      model: entry.message.model,
      provider: entry.message.provider || undefined,
      responseModel: entry.message.responseModel || undefined,
      usage: sanitizeUsage(entry.message.usage),
      errorMessage: entry.message.errorMessage || undefined,
      stopReason: entry.message.stopReason || undefined,
      // toolResult entries carry these at the message level; the client
      // renders the tool name and error state from them, so a display
      // stream that dropped them showed every result as a plain "result".
      toolName: entry.message.toolName || undefined,
      toolCallId: entry.message.toolCallId || undefined,
      isError: entry.message.isError || undefined,
      ...assistantGenStats(entry),
    };
  }
  if (entry.type === 'custom_message' && entry.customType === 'session-message') {
    return {
      id: entry.id || undefined,
      role: 'user',
      content: [{ type: 'text', text: entry.content }],
      timestamp: entry.timestamp,
    };
  }
  if (entry.type === 'branch_summary') {
    // Tree navigation's record of an abandoned branch — pi injects it as
    // context, so the transcript should show it where it was created.
    return {
      id: entry.id || undefined,
      role: 'branchSummary',
      content: [{ type: 'text', text: entry.summary || '' }],
      timestamp: entry.timestamp,
    };
  }
  return null;
}

/**
 * The displayable message stream (what /messages paginates over). Index in
 * the returned array == the message's stream index. Cached for the few most
 * recently viewed sessions — do not mutate the result.
 *
 * Only entries on the active tree path are included — after a /tree branch
 * the abandoned messages stay in the file but are no longer the session's
 * history (the tree modal is where they remain reachable).
 */
function parseMessageData(content) {
  const entries = parseEntries(content);
  const active = activeEntryIds(entries);
  const messages = [];
  const byId = new Map();
  for (const entry of entries) {
    try {
      const message = messageFromEntry(entry);
      if (!message) continue;
      // Resource lookup is by stable JSONL id across the whole tree. Keep
      // abandoned entries addressable so an already-rendered lazy image URL
      // cannot change meaning after /tree navigation.
      if (entry.id) byId.set(entry.id, message);
      if (active && entry.id && !active.has(entry.id)) continue;
      messages.push(message);
    } catch (e) {}
  }
  return { messages, byId };
}

// Usage is an API boundary: copy only Pi's documented counters and estimated
// cost components, never provider-specific payload fields.
function sanitizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const out = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens']) {
    if (Number.isFinite(usage[key])) out[key] = usage[key];
  }
  if (usage.cost && typeof usage.cost === 'object') {
    const cost = {};
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) {
      if (Number.isFinite(usage.cost[key])) cost[key] = usage.cost[key];
    }
    if (Object.keys(cost).length) out.cost = cost;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Effective response timing for an assistant message entry. message.timestamp (ms
 * epoch) is stamped when the API call starts and the entry's own timestamp
 * when the finished message is appended — the delta is the response time,
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
  // Sized above the client's 5-session transcript retention: its lazy image
  // loads and warm-restore catch-ups tour that many sessions through this
  // cache, and a smaller LRU turns each off-screen image fetch into a full
  // JSONL re-parse.
  return statCached(messagesCache, filePath, 8,
    (fp) => parseMessageData(fs.readFileSync(fp, 'utf-8'))).messages;
}

function readSessionMessageById(filePath, entryId) {
  return statCached(messagesCache, filePath, 8,
    (fp) => parseMessageData(fs.readFileSync(fp, 'utf-8'))).byId.get(entryId) || null;
}

/**
 * Lowercased message text of a whole session, for server-side list search.
 * Persisted (not cached) by lib/session-index.js — the search corpus is far
 * bigger than the LRU caches here should hold.
 */
function searchTextFromEntries(entries, active) {
  const parts = [];
  for (const entry of entries) {
    try {
      if (active && entry.id && !active.has(entry.id)) continue;
      if (entry.type === 'message' && entry.message) {
        const text = extractTextContent(entry.message.content);
        if (text) parts.push(text.substring(0, 500));
      }
      if (entry.type === 'custom_message' && entry.customType === 'session-message' && entry.content) {
        parts.push(entry.content.substring(0, 200));
      }
      if (entry.type === 'branch_summary' && entry.summary) {
        parts.push(entry.summary.substring(0, 500));
      }
    } catch (e) {}
  }
  return parts.join(' ').toLowerCase();
}

/** Search text plus enough tree state to validate a future append cheaply. */
function buildSearchIndexFromContent(content) {
  const entries = parseEntries(content);
  const tree = activeTree(entries);
  return {
    text: searchTextFromEntries(entries, tree?.ids || null),
    tree: !!tree,
    leafId: tree?.leafId || null,
  };
}

/**
 * Extend a search index from an appended byte range. A normal live turn is a
 * chain starting at the prior leaf and remains byte-range-only. A /tree jump
 * starts at an older parent; return null so the caller rebuilds the active
 * branch once and discards abandoned text.
 */
function extendSearchIndexFromContent(content, tree, leafId) {
  const entries = parseEntries(content);
  let nextLeafId = leafId;
  if (tree) {
    for (const entry of entries) {
      if (entry.type === 'session' || !entry.id) continue;
      if (entry.parentId === undefined || entry.parentId !== nextLeafId) return null;
      nextLeafId = entry.id;
    }
  } else if (entries.some(entry => entry.type !== 'session' && entry.id && entry.parentId !== undefined)) {
    // A legacy linear index has no prior tree identity to anchor against.
    // Rebuild once when the file transitions into the tree format.
    return null;
  }
  return { text: searchTextFromEntries(entries, null), tree, leafId: nextLeafId };
}

function buildSearchTextFromContent(content) {
  return buildSearchIndexFromContent(content).text;
}

/**
 * Aggregate token/cost/message stats over a whole session (the /stats
 * endpoint). Cached like the other readers — do not mutate the result.
 */
const statsCache = new Map(); // filePath -> { mtimeMs, size, value }

const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
const emptyCosts = () => Object.fromEntries(COST_KEYS.map(key => [key, 0]));
const emptyCostUnavailable = () => Object.fromEntries(COST_KEYS.map(key => [key, 0]));

// ZAI Coding Plan is subscription access: Pi's catalog deliberately carries
// zero rates because there is no per-request price to calculate. Those zeros
// are not evidence that the usage was free, so keep spend unavailable while
// preserving explicit-zero costs from providers that actually report them.
function reportedCost(provider, usage) {
  const cost = usage?.cost;
  if ((provider === 'zai' || provider === 'zai-coding-cn') &&
      cost && COST_KEYS.every(key => cost[key] === 0)) return undefined;
  return cost;
}

function isEmptyFailedUsage(message) {
  if (message?.stopReason !== 'error') return false;
  const usage = message.usage;
  return !usage || (
    !['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens'].some(key => usage[key] > 0) &&
    (!usage.cost || COST_KEYS.every(key => !usage.cost[key]))
  );
}

/**
 * A cost component is authoritative only when every contributing assistant
 * call reported it. Explicit zero is reported data; an omitted/non-finite
 * value makes that component null for the whole bucket. The unavailable-call
 * counts survive nested aggregation without retaining message content.
 */
function addReportedCosts(bucket, cost) {
  bucket.costs ||= emptyCosts();
  bucket.costUnavailable ||= emptyCostUnavailable();
  for (const key of COST_KEYS) {
    const value = cost?.[key];
    if (Number.isFinite(value)) {
      if (bucket.costs[key] !== null) bucket.costs[key] += value;
    } else {
      bucket.costUnavailable[key]++;
      bucket.costs[key] = null;
    }
  }
}

function computeSessionStats(filePath) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const costBucket = { costs: emptyCosts(), costUnavailable: emptyCostUnavailable() };
  let reasoningTokens = 0;
  let userMessages = 0, assistantMessages = 0, toolCalls = 0, toolResults = 0;
  // Session-wide effective speed: output tokens over response seconds,
  // summed only across messages whose timing is measurable (genOutput can be
  // less than tokens.output) so the average isn't diluted by unmeasured ones.
  let genMs = 0, genOutput = 0;
  const responseDurations = [];
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
        reasoningTokens += u.reasoning || 0;
      }
      addReportedCosts(costBucket, reportedCost(m.provider, u));
      const gen = assistantGenStats(entry);
      if (gen.durationMs && gen.outputTokens) {
        genMs += gen.durationMs;
        genOutput += gen.outputTokens;
      }
      if (gen.durationMs) responseDurations.push(gen.durationMs);
    }
  }
  responseDurations.sort((a, b) => a - b);
  const middle = Math.floor(responseDurations.length / 2);
  const responseTiming = {
    measured: responseDurations.length,
    medianMs: responseDurations.length ? (responseDurations.length % 2 ? responseDurations[middle] : (responseDurations[middle - 1] + responseDurations[middle]) / 2) : null,
    slowestMs: responseDurations.length ? responseDurations[responseDurations.length - 1] : null,
  };
  const { costs, costUnavailable } = costBucket;
  return { tokens, reasoningTokens, cost: costs.total, costs, costUnavailable, responseTiming, userMessages, assistantMessages, toolCalls, toolResults, genMs, genOutput };
}

/** Compact corpus-index usage, derived during the same read as metadata/text. */
function buildIndexedUsageFromContent(content, candidate = {}) {
  const profileId = candidate.profileId || 'pi-v3';
  const total = { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, costs: emptyCosts(), costUnavailable: emptyCostUnavailable(), calls: 0, measured: 0, durationMs: 0, slowestMs: 0 };
  const days = {}, models = {};
  let provider = null, model = 'unknown', cwd = null;
  const add = (bucket, u, duration) => {
    bucket.calls = (bucket.calls || 0) + 1;
    bucket.tokens ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
    for (const k of Object.keys(bucket.tokens)) bucket.tokens[k] += u?.[k] || 0;
    addReportedCosts(bucket, u?.cost);
    if (duration) { bucket.measured = (bucket.measured || 0) + 1; bucket.durationMs = (bucket.durationMs || 0) + duration; bucket.slowestMs = Math.max(bucket.slowestMs || 0, duration); }
  };
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'session' && e.cwd) cwd = e.cwd;
    if (e.type === 'model_change') {
      if (profileId === 'omp-v1') {
        const ref = typeof e.model === 'string' ? e.model : '';
        const slash = ref.indexOf('/');
        if (slash > 0) {
          provider = ref.slice(0, slash);
          model = ref.slice(slash + 1) || model;
        } else if (ref) {
          provider = e.provider || provider;
          model = ref;
        }
      } else {
        provider = e.provider || provider;
        model = e.modelId || model;
      }
    }
    const m = e.type === 'message' && e.message?.role === 'assistant' ? e.message : null;
    if (!m) continue;
    // Providers may emit one assistant error per retry. A rejected attempt
    // with no tokens and no cost is not usage and must not become a chart call.
    if (isEmptyFailedUsage(m)) continue;
    const p = m.provider || provider || 'unknown';
    // Routed models (for example OpenRouter `auto`) bill under the concrete
    // response model, not the selected alias recorded in message.model.
    const mid = m.responseModel || m.model || model || 'unknown';
    const ref = `${p}/${mid}`;
    const ts = new Date(e.timestamp || m.timestamp);
    const day = Number.isFinite(ts.getTime()) ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}` : 'unknown';
    const duration = assistantGenStats(e).durationMs || 0;
    const usage = { ...m.usage, cost: reportedCost(p, m.usage) };
    add(total, usage, duration); add(days[day] ||= {}, usage, duration);
    const modelBucket = models[ref] ||= { provider: p, model: mid, days: {} };
    add(modelBucket, usage, duration); add(modelBucket.days[day] ||= {}, usage, duration);
  }
  return { total, days, models, cwd };
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
  const candidate = source(filePath);
  filePath = candidate.file;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const lines = buf.toString('utf8', 0, n).split('\n');
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'session') return entry.cwd || null;
      if (candidate.profileId !== 'omp-v1') break;
    }
    return null;
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
  readSessionMessageById,
  getSessionStats,
  readSessionCwd,
  decodeDirToCwd,
  resetCaches,
  parseSessionContent,
  buildSearchTextFromContent,
  buildSearchIndexFromContent,
  extendSearchIndexFromContent,
  buildIndexedUsageFromContent,
  sanitizeUsage,
};
