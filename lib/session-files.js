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
const { extractTextContent, truncate, splitSessionRefContext } = require('../public/helpers.js');
const { estimateUsageCost, pricingRevision } = require('./harness-pricing.js');

// OMP persists these bookkeeping/state entries in the same JSONL as the
// conversation. They deliberately contribute neither transcript rows nor
// counters. `custom_message` is handled separately below because visible
// async/interruption notices use that schema too.
const TOLERATED_NON_MESSAGE_ENTRY_TYPES = new Set([
  'custom', 'session_init', 'reset_boundary', 'mode_change', 'ttsr_injection',
  'credential_pin', 'label', 'service_tier_change',
]);

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

function statCached(cache, input, max, parse, extraKey = '') {
  const candidate = source(input);
  const filePath = candidate.file;
  const cacheKey = `${filePath}\0${candidate.profileId || 'pi-v3'}\0${candidate.profileVersion ?? 1}\0${pricingRevision(candidate.harnessId)}${extraKey ? '\0' + extraKey : ''}`;
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
  return sessionInfoFromEntries(parseEntries(content), mtime, candidate);
}

function sessionInfoFromEntries(entries, mtime, candidate = {}) {
  const info = {
    model: 'unknown', name: null, messageCount: 0, contextTokens: 0,
    lastActivity: mtime || new Date(0), cwd: null, sessionId: null, parentSession: null,
  };
  return accumulateSessionInfo(info, entries, candidate, true);
}

/**
 * Extend an info object with entries appended after the range it was built
 * from — the O(delta) path lib/session-index.js uses for a streaming active
 * session, so a sidebar poll never re-parses a whole multi-MB JSONL because
 * one turn was appended. Mutates and returns `info`; `mtime` is the file's
 * new mtime (a full parse floors lastActivity at the mtime, so the extension
 * must too).
 */
function extendSessionInfoFromEntries(info, entries, mtime, candidate = {}) {
  if (mtime && mtime.getTime() > new Date(info.lastActivity).getTime()) info.lastActivity = mtime;
  return accumulateSessionInfo(info, entries, candidate, false);
}

function accumulateSessionInfo(info, entries, candidate, fromStart) {
  const profileId = candidate.profileId || 'pi-v3';
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Only an entry parsed from physical line zero can be Pi's SessionHeader
    // / OMP's title line (parseEntries marks that on the array). A blank or
    // torn first line means the file has no readable header, and a later
    // session-shaped entry must not be promoted to one.
    const isFirst = fromStart && i === 0 && entries.firstEntryOnFirstLine === true;
    if (profileId === 'omp-v1' && isFirst && entry.type === 'title' && entry.title) info.name = entry.title;
    if (entry.type === 'session') {
      if (entry.cwd) info.cwd = entry.cwd;
      // Native identity and lineage belong to Pi's first-line SessionHeader.
      // Later session-shaped custom entries must not rewrite provenance.
      if (isFirst || (profileId === 'omp-v1' && info.sessionId === null)) {
        if (typeof entry.id === 'string' && entry.id) info.sessionId = entry.id;
        if (typeof entry.parentSession === 'string' && entry.parentSession) info.parentSession = entry.parentSession;
      }
    }
    if (entry.type === 'model_change') info.model = (profileId === 'omp-v1' ? entry.model : entry.modelId) || info.model;
    // Explicit names assign unconditionally (later wins); the first user
    // message is only a fallback for a still-unnamed session. Same resolution
    // the whole-file parse performed at return time.
    if (entry.type === 'session_info' && entry.name) info.name = entry.name;
    if (entry.sessionName) info.name = entry.sessionName;
    if (entry.type === 'message' && entry.message?.role === 'user') {
      info.messageCount++;
      if (info.name === null) {
        // The <session-refs> block is appended context, not something the
        // user wrote — a session named after its first prompt must not be
        // named after the block that followed it.
        const text = splitSessionRefContext(extractTextContent(entry.message.content)).text;
        if (text) info.name = truncate(text, 40, '...');
      }
    }
    if (info.name === null && entry.type === 'custom_message' &&
        entry.customType === 'session-message' && entry.content) {
      info.name = truncate(entry.content, 40, '...');
    }
    if (entry.timestamp) {
      const ts = new Date(entry.timestamp).getTime();
      if (Number.isFinite(ts) && ts > new Date(info.lastActivity).getTime()) info.lastActivity = new Date(ts);
    }
    if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.message?.usage) {
      info.contextTokens = entry.message.usage.totalTokens || 0;
    }
    if (entry.type === 'compaction') info.contextTokens = 0;
  }
  return info;
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
function activeTree(entries, leafOverride = undefined) {
  const byId = new Map();
  let leafId = null;
  for (const e of entries) {
    if (e.type === 'session' || !e.id) continue;
    if (e.parentId === undefined) return null; // pre-tree format — linear file
    byId.set(e.id, e);
    leafId = e.id;
  }
  if (leafOverride !== undefined) {
    if (leafOverride !== null && !byId.has(leafOverride)) {
      throw new Error(`Session tree leaf not found: ${leafOverride}`);
    }
    leafId = leafOverride;
  }
  if (leafId === null && leafOverride === null) return { ids: new Set(), leafId: null };
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

// Snapcompact archives can make one compaction record tens of megabytes: its
// preserveData contains base64 PNG frames. None of pi-dish's transcript,
// metadata, search, usage, or skill projections consumes that payload. The
// OMP writer serializes preserveData last, after every semantic compaction
// field, so parse that prefix and omit only the archive. Differently ordered
// records do not end with the preserveData object + root object's two closing
// braces and fall back to a full parse.
const LARGE_COMPACTION_RECORD = 64 * 1024;
function parseEntry(line) {
  if (line.length >= LARGE_COMPACTION_RECORD && line.startsWith('{"type":"compaction",')) {
    const preserveAt = line.indexOf(',"preserveData":');
    if (preserveAt > 0 && line.endsWith('}}')) {
      try {
        const entry = JSON.parse(line.slice(0, preserveAt) + '}');
        if (entry.type === 'compaction' && typeof entry.id === 'string' &&
            (entry.parentId === null || typeof entry.parentId === 'string')) return entry;
      } catch {}
    }
  }
  return JSON.parse(line);
}

function parseEntries(content) {
  const entries = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push(parseEntry(lines[i]));
      // Only the physical first line can be Pi's SessionHeader / OMP's title
      // line. A blank or torn first line means the file has no header, even
      // when a session-shaped entry follows — record where entry 0 came from
      // so sessionInfoFromEntries can honor that.
      if (i === 0) entries.firstEntryOnFirstLine = true;
    } catch (e) {}
  }
  return entries;
}

function messageFromEntry(entry, candidate, fallbackModel = {}) {
  if (entry.type === 'message' && entry.message) {
    // Hidden custom messages are model continuity/state, not transcript UI.
    // interrupted-thinking is special-cased in the custom_message form below
    // so the interruption is visible without exposing its hidden reasoning.
    if (entry.message.role === 'custom' && entry.message.display === false) return null;
    const usage = sanitizeUsage(entry.message.usage);
    const estimated = usageCost(candidate, entry.message.provider || fallbackModel.provider,
      entry.message.responseModel || entry.message.model || fallbackModel.model, entry.message.usage);
    if (usage) {
      if (estimated) usage.cost = estimated;
      else delete usage.cost;
    }
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
      usage,
      errorMessage: entry.message.errorMessage || undefined,
      stopReason: entry.message.stopReason || undefined,
      // toolResult entries carry these at the message level; the client
      // renders the tool name and error state from them, so a display
      // stream that dropped them showed every result as a plain "result".
      toolName: entry.message.toolName || undefined,
      toolCallId: entry.message.toolCallId || undefined,
      isError: entry.message.isError || undefined,
      customType: entry.message.customType || undefined,
      details: entry.message.details || undefined,
      display: typeof entry.message.display === 'boolean' ? entry.message.display : undefined,
      ...assistantGenStats(entry),
    };
  }
  if (entry.type === 'custom_message') {
    if (entry.customType === 'session-message') {
      return {
        id: entry.id || undefined,
        role: 'user',
        content: [{ type: 'text', text: entry.content }],
        timestamp: entry.timestamp,
      };
    }
    // OMP marks interrupted-thinking display:false because its content holds
    // private reasoning continuity. Project only the type/details: the client
    // renders a divider and never receives that hidden content. Other hidden
    // custom messages remain an explicit skip; visible unknown types get a
    // generic row so a future OMP addition cannot disappear silently.
    if (entry.customType === 'interrupted-thinking') {
      return {
        id: entry.id || undefined,
        role: 'custom',
        customType: entry.customType,
        content: [],
        details: entry.details || undefined,
        display: false,
        timestamp: entry.timestamp,
      };
    }
    if (entry.display === false) return null;
    return {
      id: entry.id || undefined,
      role: 'custom',
      customType: entry.customType || 'custom-message',
      content: entry.content || [],
      details: entry.details || undefined,
      display: entry.display,
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
  if (TOLERATED_NON_MESSAGE_ENTRY_TYPES.has(entry.type)) return null;
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
function parseMessageData(content, candidate, leafOverride = undefined) {
  const entries = parseEntries(content);
  const active = leafOverride === undefined
    ? activeEntryIds(entries)
    : activeTree(entries, leafOverride)?.ids || null;
  const messages = [];
  const byId = new Map();
  let provider = null, model = null;
  for (const entry of entries) {
    try {
      if (entry.type === 'model_change') {
        if (candidate?.profileId === 'omp-v1' && typeof entry.model === 'string') {
          const slash = entry.model.indexOf('/');
          if (slash > 0) { provider = entry.model.slice(0, slash); model = entry.model.slice(slash + 1); }
          else { provider = entry.provider || provider; model = entry.model; }
        } else { provider = entry.provider || provider; model = entry.modelId || model; }
      }
      const message = messageFromEntry(entry, candidate, { provider, model });
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
    (fp, _stats, candidate) => parseMessageData(fs.readFileSync(fp, 'utf-8'), candidate)).messages;
}

// OMP can move its in-memory leaf without appending a JSONL anchor. For a
// live OMP session the bridge's ReadonlySessionManager is authoritative, so
// render that exact branch instead of deriving the leaf from the last line.
// Cached like readSessionMessages (leaf in the key): opening a long session
// fires a tail page plus scroll-up pages plus catch-ups, and re-parsing tens
// of MB per request made large live OMP sessions painfully slow to open.
function readSessionMessagesAtLeaf(filePath, leafId) {
  return statCached(messagesCache, filePath, 8,
    (fp, _stats, candidate) => parseMessageData(fs.readFileSync(fp, 'utf-8'), candidate, leafId),
    `leaf:${leafId ?? ''}`).messages;
}

function readSessionMessageById(filePath, entryId) {
  return statCached(messagesCache, filePath, 8,
    (fp, _stats, candidate) => parseMessageData(fs.readFileSync(fp, 'utf-8'), candidate)).byId.get(entryId) || null;
}

/**
 * Search-text extraction bounds. Prose (user/assistant text, visible custom
 * messages, branch summaries) is what people remember and try to find again,
 * so its cap is effectively no-limit: measured on a 1,364-session / 1GB
 * corpus, messages past 100K don't occur (observed max 76K) and even a 10K
 * cap only trimmed 0.07% of messages — but those were pasted logs/docs,
 * exactly the recall targets. The prose cap's only job now is keeping one
 * giant paste from eating a large share of the session budget. Tool results
 * are bulky low-recall dumps (file reads, build output): they stay tight —
 * raising them to 2K doubled the index for little value. The session cap
 * bounds one transcript's total text — the whole corpus's text lives in
 * memory (session-index), sized for thousands of sessions. On overflow the
 * *oldest* text is dropped: recent turns (conclusions, fixes) are the recall
 * targets, and the opening prompt usually survives as the session name. The
 * same corpus measured 9/1,364 sessions over the old 1M cap.
 */
const SEARCH_TEXT_PROSE_CAP = 100_000;
const SEARCH_TEXT_TOOL_RESULT_CAP = 500;
const SEARCH_TEXT_TOOL_CALL_CAP = 300;
const SEARCH_TEXT_SESSION_CAP = 4_000_000;

// Args whose values are the recall keys people actually search for (file
// paths, bash command lines, URLs); they go ahead of other string args so a
// bulky arg (an edit's oldText) can't crowd them out of the per-call cap.
const TOOL_ARG_PRIORITY = new Set([
  'path', 'file_path', 'filename', 'file', 'cwd', 'command', 'cmd',
  'url', 'pattern', 'query',
]);

function toolCallSearchText(block) {
  const first = [block.name || ''];
  const rest = [];
  if (block.arguments && typeof block.arguments === 'object') {
    for (const [key, value] of Object.entries(block.arguments)) {
      if (typeof value !== 'string' || !value) continue;
      (TOOL_ARG_PRIORITY.has(key) ? first : rest).push(value);
    }
  }
  return first.concat(rest).join(' ').substring(0, SEARCH_TEXT_TOOL_CALL_CAP);
}

/**
 * Lowercased message text of a whole session, for server-side list search.
 * Persisted (not cached) by lib/session-index.js — the search corpus is far
 * bigger than the LRU caches here should hold.
 */
function searchTextFromEntries(entries, active) {
  const parts = [];
  let total = 0;
  let head = 0; // parts before head have been evicted by the session cap
  const push = (part) => {
    if (!part) return;
    parts.push(part);
    total += part.length + 1;
    while (total > SEARCH_TEXT_SESSION_CAP && head < parts.length - 1) {
      total -= parts[head].length + 1;
      head++;
    }
  };
  for (const entry of entries) {
    try {
      if (active && entry.id && !active.has(entry.id)) continue;
      if (entry.type === 'message' && entry.message &&
          !(entry.message.role === 'custom' && entry.message.display === false)) {
        const m = entry.message;
        const cap = m.role === 'toolResult' ? SEARCH_TEXT_TOOL_RESULT_CAP : SEARCH_TEXT_PROSE_CAP;
        const text = extractTextContent(m.content);
        if (text) push(text.substring(0, cap));
        // Tool calls carry the highest-signal recall keys a coding session
        // has (file paths, bash command lines) and none of it reaches a text
        // block, so extractTextContent alone made those sessions unfindable.
        if (Array.isArray(m.content)) {
          for (const block of m.content) {
            if (block && block.type === 'toolCall') push(toolCallSearchText(block));
          }
        }
      }
      if (entry.type === 'custom_message' && entry.content &&
          (entry.customType === 'session-message' ||
           (entry.customType !== 'interrupted-thinking' && entry.display !== false))) {
        push(extractTextContent(entry.content).substring(0, SEARCH_TEXT_PROSE_CAP));
      }
      if (entry.type === 'branch_summary' && entry.summary) {
        push(entry.summary.substring(0, SEARCH_TEXT_PROSE_CAP));
      }
    } catch (e) {}
  }
  return (head ? parts.slice(head) : parts).join(' ').toLowerCase();
}

/** Search text plus enough tree state to validate a future append cheaply. */
function buildSearchIndexFromContent(content) {
  return buildSearchIndexFromEntries(parseEntries(content));
}

function buildSearchIndexFromEntries(entries) {
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
  return extendSearchIndexFromEntries(parseEntries(content), tree, leafId);
}

function extendSearchIndexFromEntries(entries, tree, leafId) {
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
  if (!cost || typeof cost !== 'object') return undefined;
  const sanitized = {};
  for (const key of COST_KEYS) if (Number.isFinite(cost[key])) sanitized[key] = cost[key];
  return Object.keys(sanitized).length ? sanitized : undefined;
}

function usageCost(candidate, provider, model, usage) {
  const estimated = estimateUsageCost(candidate?.harnessId, provider, model, usage);
  return estimated || reportedCost(provider, usage);
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
 * Preserve the known subtotal for every component. Missing pricing increments
 * a parallel call count instead of destroying the subtotal; callers render
 * that count as an explicit partial-estimate marker. Explicit zero remains
 * authoritative reported data.
 */
function addReportedCosts(bucket, cost) {
  bucket.costs ||= emptyCosts();
  bucket.costUnavailable ||= emptyCostUnavailable();
  for (const key of COST_KEYS) {
    const value = cost?.[key];
    if (Number.isFinite(value)) {
      bucket.costs[key] = (Number.isFinite(bucket.costs[key]) ? bucket.costs[key] : 0) + value;
    } else {
      bucket.costUnavailable[key]++;
    }
  }
}

function computeSessionStats(filePath, _stats, candidate = {}) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const costBucket = { costs: emptyCosts(), costUnavailable: emptyCostUnavailable() };
  let reasoningTokens = 0;
  let userMessages = 0, assistantMessages = 0, toolCalls = 0, toolResults = 0;
  // Session-wide effective speed: output tokens over response seconds,
  // summed only across messages whose timing is measurable (genOutput can be
  // less than tokens.output) so the average isn't diluted by unmeasured ones.
  let genMs = 0, genOutput = 0;
  const responseDurations = [];
  let provider = null, model = null;
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = parseEntry(line); } catch { continue; }
    if (entry.type === 'model_change') {
      if (candidate.profileId === 'omp-v1' && typeof entry.model === 'string') {
        const slash = entry.model.indexOf('/');
        if (slash > 0) { provider = entry.model.slice(0, slash); model = entry.model.slice(slash + 1); }
        else { provider = entry.provider || provider; model = entry.model; }
      } else { provider = entry.provider || provider; model = entry.modelId || model; }
    }
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
      addReportedCosts(costBucket, usageCost(candidate,
        m.provider || provider, m.responseModel || m.model || model, u));
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
  return buildIndexedUsageFromEntries(parseEntries(content), candidate);
}

function buildIndexedUsageFromEntries(entries, candidate = {}) {
  const usage = {
    total: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, costs: emptyCosts(), costUnavailable: emptyCostUnavailable(), calls: 0, measured: 0, durationMs: 0, slowestMs: 0 },
    days: {}, models: {}, cwd: null,
    // Running provider/model continuity, persisted with the usage so an
    // appended byte range can be accumulated without re-reading the entries
    // before it (extendIndexedUsageFromEntries).
    state: { provider: null, model: 'unknown' },
  };
  return accumulateIndexedUsage(usage, entries, candidate);
}

/**
 * O(delta) usage extension for an append-only session file. Only valid for
 * usage objects that carry `state` (built by this schema); mutates and
 * returns `usage`.
 */
function extendIndexedUsageFromEntries(usage, entries, candidate = {}) {
  return accumulateIndexedUsage(usage, entries, candidate);
}

function accumulateIndexedUsage(usage, entries, candidate) {
  const profileId = candidate.profileId || 'pi-v3';
  const { total, days, models } = usage;
  let provider = usage.state?.provider ?? null, model = usage.state?.model ?? 'unknown', cwd = usage.cwd ?? null;
  const add = (bucket, u, duration) => {
    bucket.calls = (bucket.calls || 0) + 1;
    bucket.tokens ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
    for (const k of Object.keys(bucket.tokens)) bucket.tokens[k] += u?.[k] || 0;
    addReportedCosts(bucket, u?.cost);
    if (duration) { bucket.measured = (bucket.measured || 0) + 1; bucket.durationMs = (bucket.durationMs || 0) + duration; bucket.slowestMs = Math.max(bucket.slowestMs || 0, duration); }
  };
  for (const e of entries) {
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
    const u = { ...m.usage, cost: usageCost(candidate, p, mid, m.usage) };
    add(total, u, duration); add(days[day] ||= {}, u, duration);
    const modelBucket = models[ref] ||= { provider: p, model: mid, days: {} };
    add(modelBucket, u, duration); add(modelBucket.days[day] ||= {}, u, duration);
  }
  usage.cwd = cwd;
  usage.state = { provider, model };
  return usage;
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

const tailCache = new Map(); // (mtimeMs, size) -> last complete JSONL entry
const TAIL_BYTES = 64 * 1024;

/**
 * The session JSONL's last complete entry via a bounded tail read — the
 * caller only needs the terminal bookkeeping entry (harnesses stamp one when
 * they dispose a session), and these files run to tens of MB.
 *
 * Returns null when the tail holds no parseable whole line: a final entry
 * larger than the window (a huge tool result) is exactly the shape of a
 * session still being written, and callers treat "unknown" as "not
 * finished" rather than re-reading the file. Never grep the whole file for a
 * marker instead — a transcript that merely discusses one contains the
 * string, and a revived session appends past its own exit entry.
 */
function readSessionTailEntry(input) {
  return statCached(tailCache, input, 500, (filePath, stats) => {
    if (!stats.size) return null;
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
      const length = Math.min(TAIL_BYTES, stats.size);
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, stats.size - length);
      const lines = buf.toString('utf8', 0, n).split('\n');
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      const last = lines[lines.length - 1];
      return last && last.startsWith('{') ? JSON.parse(last) : null;
    } catch {
      return null;
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    }
  });
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
  tailCache.clear();
}

module.exports = {
  getSessionInfo,
  readSessionMessages,
  readSessionMessagesAtLeaf,
  readSessionMessageById,
  getSessionStats,
  readSessionCwd,
  readSessionTailEntry,
  decodeDirToCwd,
  resetCaches,
  parseSessionContent,
  parseSessionEntries: parseEntries,
  sessionInfoFromEntries,
  extendSessionInfoFromEntries,
  buildSearchTextFromContent,
  buildSearchIndexFromContent,
  buildSearchIndexFromEntries,
  extendSearchIndexFromContent,
  extendSearchIndexFromEntries,
  buildIndexedUsageFromContent,
  buildIndexedUsageFromEntries,
  extendIndexedUsageFromEntries,
  sanitizeUsage,
  SEARCH_TEXT_SESSION_CAP,
};
