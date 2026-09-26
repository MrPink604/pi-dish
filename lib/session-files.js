// Generated from src/core/session-files.ts; edit that source and run npm run build:core.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCH_TEXT_SESSION_CAP = void 0;
exports.parseSessionContent = parseSessionContent;
exports.getSessionInfo = getSessionInfo;
exports.parseSessionEntries = parseSessionEntries;
exports.sanitizeUsage = sanitizeUsage;
exports.readSessionMessages = readSessionMessages;
exports.readSessionMessagesAtLeaf = readSessionMessagesAtLeaf;
exports.readSessionMessageById = readSessionMessageById;
exports.readSessionSearchText = readSessionSearchText;
exports.buildSearchIndexFromContent = buildSearchIndexFromContent;
exports.buildSearchIndexFromEntries = buildSearchIndexFromEntries;
exports.extendSearchIndexFromContent = extendSearchIndexFromContent;
exports.extendSearchIndexFromEntries = extendSearchIndexFromEntries;
exports.buildSearchTextFromContent = buildSearchTextFromContent;
exports.buildIndexedUsageFromContent = buildIndexedUsageFromContent;
exports.buildIndexedUsageFromEntries = buildIndexedUsageFromEntries;
exports.extendIndexedUsageFromEntries = extendIndexedUsageFromEntries;
exports.getSessionStats = getSessionStats;
exports.readSessionCwd = readSessionCwd;
exports.readSessionTailEntry = readSessionTailEntry;
exports.decodeDirToCwd = decodeDirToCwd;
exports.resetCaches = resetCaches;
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
const node_fs_1 = __importDefault(require("node:fs"));
const cache_retention_js_1 = require("./cache-retention.js");
const session_metadata_js_1 = require("./session-metadata.js");
const cache_lifetime_js_1 = require("./cache-lifetime.js");
const helper_content_js_1 = require("./helper-content.js");
const harness_pricing_js_1 = require("./harness-pricing.js");
const EMPTY_FIELDS = Object.freeze({});
/** Match JS property access on JSON values, including null throwing and boxing. */
function fields(value) {
    if (value === null || value === undefined)
        throw new TypeError('Cannot read properties of null or undefined');
    return (typeof value === 'object' ? value : Object(value));
}
/** Date accepts coercible JSON values at runtime, beyond its TS overloads. */
function entryDate(value) {
    if (typeof value === 'string' || typeof value === 'number')
        return new Date(value);
    return Reflect.construct(Date, [value]);
}
// Finite operands do not promise finite sums: preserve JS overflow, without
// saturation. Persisted nonfinite projections are rejected by the index decoder.
/** Malformed raw token operands contribute no amount, without rewriting usage. */
function tokenAmount(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
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
    if (typeof candidate === 'string')
        return { file: candidate, profileId: 'pi-v3', profileVersion: 1, harnessId: 'pi' };
    if (!candidate || typeof candidate.file !== 'string')
        throw new TypeError('Expected session file or candidate');
    return candidate;
}
function statCached(cache, input, max, parse, extraKey = '') {
    const candidate = source(input);
    const filePath = candidate.file;
    const cacheKey = `${filePath}\0${candidate.profileId || 'pi-v3'}\0${candidate.profileVersion ?? 1}\0${(0, harness_pricing_js_1.pricingRevision)(candidate.harnessId)}${extraKey ? '\0' + extraKey : ''}`;
    const stats = node_fs_1.default.statSync(filePath);
    const cached = cache.get(cacheKey);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        cache.delete(cacheKey);
        cache.set(cacheKey, cached); // refresh recency
        return cached.value;
    }
    const value = parse(filePath, stats, candidate);
    cache.delete(cacheKey);
    if (cache.size >= max) {
        const oldest = cache.keys().next();
        if (!oldest.done)
            cache.delete(oldest.value); // evict oldest
    }
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
    return parseSessionContent(node_fs_1.default.readFileSync(filePath, 'utf-8'), mtime || node_fs_1.default.statSync(filePath).mtime, candidate);
}
function parseSessionContent(content, mtime, candidate = {}) {
    return (0, session_metadata_js_1.sessionInfoFromEntries)(parseSessionEntries(content), mtime, candidate);
}
const infoCache = new Map(); // filePath -> { mtimeMs, size, value }
function getSessionInfo(filePath) {
    return { ...statCached(infoCache, filePath, 1000, (fp, stats, candidate) => parseSessionFile(fp, stats.mtime, candidate), `cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`) };
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
function activeTree(entries, leafOverride) {
    const byId = new Map();
    let leafId = null;
    for (const raw of entries) {
        const e = fields(raw);
        if (e.type === 'session' || !e.id)
            continue;
        if (e.parentId === undefined)
            return null; // pre-tree format — linear file
        byId.set(e.id, e);
        leafId = e.id;
    }
    if (leafOverride !== undefined) {
        if (leafOverride !== null && !byId.has(leafOverride)) {
            throw new Error(`Session tree leaf not found: ${leafOverride}`);
        }
        leafId = leafOverride;
    }
    if (leafId === null && leafOverride === null)
        return { ids: new Set(), leafId: null };
    if (!leafId)
        return null;
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
                if ((0, session_metadata_js_1.isRecord)(entry) && entry.type === 'compaction' && typeof entry.id === 'string' &&
                    (entry.parentId === null || typeof entry.parentId === 'string'))
                    return entry;
            }
            catch { }
        }
    }
    return JSON.parse(line);
}
function parseSessionEntries(content) {
    const entries = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        try {
            entries.push(parseEntry(lines[i]));
            // Only the physical first line can be Pi's SessionHeader / OMP's title
            // line. A blank or torn first line means the file has no header, even
            // when a session-shaped entry follows — record where entry 0 came from
            // so sessionInfoFromEntries can honor that.
            if (i === 0)
                entries.firstEntryOnFirstLine = true;
        }
        catch (e) { }
    }
    return entries;
}
/**
 * Chronological model changes only; assistant identity and retry/aggregation
 * remain with each consumer. Reuse one state per pass, not a fact per entry.
 */
function advanceModelChange(entry, state, profileId, policy) {
    if (policy === 'display') {
        if (profileId === 'omp-v1' && typeof entry.model === 'string') {
            const slash = entry.model.indexOf('/');
            if (slash > 0) {
                state.provider = entry.model.slice(0, slash);
                state.model = entry.model.slice(slash + 1);
            }
            else {
                state.provider = entry.provider || state.provider;
                state.model = entry.model;
            }
        }
        else {
            state.provider = entry.provider || state.provider;
            state.model = entry.modelId || state.model;
        }
        return;
    }
    // Persisted billing continuity admits strings only. In particular, OMP's
    // empty suffix retains the previous model, unlike display pricing fallback.
    if (profileId === 'omp-v1') {
        const ref = typeof entry.model === 'string' ? entry.model : '';
        const slash = ref.indexOf('/');
        if (slash > 0) {
            state.provider = ref.slice(0, slash);
            state.model = ref.slice(slash + 1) || state.model;
        }
        else if (ref) {
            if (typeof entry.provider === 'string' && entry.provider)
                state.provider = entry.provider;
            state.model = ref;
        }
    }
    else {
        if (typeof entry.provider === 'string' && entry.provider)
            state.provider = entry.provider;
        if (typeof entry.modelId === 'string' && entry.modelId)
            state.model = entry.modelId;
    }
}
function messageFromEntry(entry, candidate, fallbackModel = {}, cacheExpiry) {
    if (entry.type === 'message' && entry.message) {
        const message = fields(entry.message);
        // Hidden custom messages are model continuity/state, not transcript UI.
        // interrupted-thinking is special-cased in the custom_message form below
        // so the interruption is visible without exposing its hidden reasoning.
        if (message.role === 'custom' && message.display === false)
            return null;
        const usage = sanitizeUsage(message.usage);
        const estimated = messageUsageCost(candidate, message, fallbackModel);
        if (usage) {
            if (estimated)
                usage.cost = estimated;
            else
                delete usage.cost;
        }
        return {
            // The JSONL entry id — pi's HTML export anchors messages by it
            // (?targetId=<id> deep links), so the client's per-message share
            // button needs it on every displayable message.
            id: entry.id || undefined,
            role: message.role,
            content: message.content || [],
            timestamp: message.timestamp || entry.timestamp,
            model: message.model,
            provider: message.provider || undefined,
            responseModel: message.responseModel || undefined,
            ...(cacheExpiry ? { cacheExpiry } : {}),
            usage,
            errorMessage: message.errorMessage || undefined,
            stopReason: message.stopReason || undefined,
            // toolResult entries carry these at the message level; the client
            // renders the tool name and error state from them, so a display
            // stream that dropped them showed every result as a plain "result".
            toolName: message.toolName || undefined,
            toolCallId: message.toolCallId || undefined,
            isError: message.isError || undefined,
            customType: message.customType || undefined,
            details: message.details || undefined,
            display: typeof message.display === 'boolean' ? message.display : undefined,
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
        if (entry.display === false)
            return null;
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
    if (typeof entry.type === 'string' && TOLERATED_NON_MESSAGE_ENTRY_TYPES.has(entry.type))
        return null;
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
function parseMessageData(content, candidate, leafOverride) {
    const cacheConfig = (0, cache_retention_js_1.loadCacheRetentionConfig)();
    const entries = parseSessionEntries(content);
    const active = leafOverride === undefined
        ? activeEntryIds(entries)
        : activeTree(entries, leafOverride)?.ids || null;
    const messages = [];
    const byId = new Map();
    const model = { provider: null, model: null };
    let cacheExpiry = null;
    for (const raw of entries) {
        try {
            const entry = fields(raw);
            if (entry.type === 'model_change') {
                advanceModelChange(entry, model, candidate?.profileId, 'display');
                cacheExpiry = null;
            }
            if (entry.type === 'compaction')
                cacheExpiry = null;
            let responseCacheExpiry = null;
            const rawMessage = entry.type === 'message' && entry.message ? fields(entry.message) : null;
            if (rawMessage?.role === 'assistant' && (0, session_metadata_js_1.hasCacheActivity)(rawMessage)) {
                const cacheMessage = {
                    ...rawMessage,
                    provider: rawMessage.provider ?? model.provider,
                    model: rawMessage.model ?? model.model,
                };
                responseCacheExpiry = (0, session_metadata_js_1.cacheExpiryForMessage)(cacheMessage, cacheExpiry, entry.timestamp, cacheConfig);
                cacheExpiry = responseCacheExpiry;
            }
            const message = messageFromEntry(entry, candidate, model, (0, cache_lifetime_js_1.applyLearnedCacheExpiry)(responseCacheExpiry, cacheConfig));
            if (!message)
                continue;
            // Resource lookup is by stable JSONL id across the whole tree. Keep
            // abandoned entries addressable so an already-rendered lazy image URL
            // cannot change meaning after /tree navigation.
            if (entry.id)
                byId.set(entry.id, message);
            if (active && entry.id && !active.has(entry.id))
                continue;
            messages.push(message);
        }
        catch (e) { }
    }
    return { messages, byId };
}
// Usage is an API boundary: copy only Pi's documented counters and estimated
// cost components, never provider-specific payload fields.
function sanitizeUsage(usage) {
    if (!usage || typeof usage !== 'object')
        return undefined;
    const raw = fields(usage);
    const out = {};
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'reasoning', 'totalTokens']) {
        const value = raw[key];
        if (typeof value === 'number' && Number.isFinite(value))
            out[key] = value;
    }
    if (raw.cost && typeof raw.cost === 'object') {
        const rawCost = fields(raw.cost);
        const cost = {};
        for (const key of COST_KEYS) {
            const value = rawCost[key];
            if (typeof value === 'number' && Number.isFinite(value))
                cost[key] = value;
        }
        if (Object.keys(cost).length)
            out.cost = cost;
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
    const m = fields(entry.message);
    if (m.role !== 'assistant')
        return {};
    const start = m.timestamp;
    const end = entry.timestamp ? entryDate(entry.timestamp).getTime() : NaN;
    if (typeof start !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        return {};
    return { durationMs: end - start, outputTokens: fields(m.usage ?? EMPTY_FIELDS).output || 0 };
}
const messagesCache = new Map(); // filePath -> { mtimeMs, size, value }
function readSessionMessages(filePath) {
    // Sized above the client's 5-session transcript retention: its lazy image
    // loads and warm-restore catch-ups tour that many sessions through this
    // cache, and a smaller LRU turns each off-screen image fetch into a full
    // JSONL re-parse.
    return statCached(messagesCache, filePath, 8, (fp, _stats, candidate) => parseMessageData(node_fs_1.default.readFileSync(fp, 'utf-8'), candidate), `cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`).messages;
}
// OMP can move its in-memory leaf without appending a JSONL anchor. For a
// live OMP session the bridge's ReadonlySessionManager is authoritative, so
// render that exact branch instead of deriving the leaf from the last line.
// Cached like readSessionMessages (leaf in the key): opening a long session
// fires a tail page plus scroll-up pages plus catch-ups, and re-parsing tens
// of MB per request made large live OMP sessions painfully slow to open.
function readSessionMessagesAtLeaf(filePath, leafId) {
    return statCached(messagesCache, filePath, 8, (fp, _stats, candidate) => parseMessageData(node_fs_1.default.readFileSync(fp, 'utf-8'), candidate, leafId), `leaf:${leafId ?? ''}\0cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`).messages;
}
function readSessionMessageById(filePath, entryId) {
    return statCached(messagesCache, filePath, 8, (fp, _stats, candidate) => parseMessageData(node_fs_1.default.readFileSync(fp, 'utf-8'), candidate), `cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`).byId.get(entryId) || null;
}
/**
 * Lowercased per-message text for whole-transcript search, index-aligned with
 * readSessionMessages' array ('' for a message with no text). Extracting and
 * lowercasing every message is O(transcript text) — ~7M chars on a large
 * session — and the in-session search handler used to pay it on every
 * request. The result is memoized on the shared message cache entry, so a
 * repeated search over an unchanged file is a plain string scan; a changed
 * file re-parses (and the memo is rebuilt with its messages, staying aligned).
 * Return both from one revalidation: the harness can append or branch between
 * separate synchronous filesystem calls in this process.
 */
function readSessionSearchText(filePath) {
    const data = statCached(messagesCache, filePath, 8, (fp, _stats, candidate) => parseMessageData(node_fs_1.default.readFileSync(fp, 'utf-8'), candidate), `cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`);
    if (!data.searchText) {
        data.searchText = data.messages.map(message => (0, helper_content_js_1.extractTextContent)(message.content).toLowerCase());
    }
    return { messages: data.messages, texts: data.searchText };
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
exports.SEARCH_TEXT_SESSION_CAP = 4_000_000;
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
            if (typeof value !== 'string' || !value)
                continue;
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
        if (!part)
            return;
        parts.push(part);
        total += part.length + 1;
        while (total > exports.SEARCH_TEXT_SESSION_CAP && head < parts.length - 1) {
            total -= parts[head].length + 1;
            head++;
        }
    };
    for (const raw of entries) {
        try {
            const entry = fields(raw);
            if (active && entry.id && !active.has(entry.id))
                continue;
            const message = entry.message ? fields(entry.message) : null;
            if (entry.type === 'message' && message &&
                !(message.role === 'custom' && message.display === false)) {
                const m = message;
                const cap = m.role === 'toolResult' ? SEARCH_TEXT_TOOL_RESULT_CAP : SEARCH_TEXT_PROSE_CAP;
                const text = (0, helper_content_js_1.extractTextContent)(m.content);
                if (text)
                    push(text.substring(0, cap));
                // Tool calls carry the highest-signal recall keys a coding session
                // has (file paths, bash command lines) and none of it reaches a text
                // block, so extractTextContent alone made those sessions unfindable.
                if (Array.isArray(m.content)) {
                    for (const rawBlock of m.content) {
                        const block = rawBlock ? fields(rawBlock) : null;
                        if (block && block.type === 'toolCall')
                            push(toolCallSearchText(block));
                    }
                }
            }
            if (entry.type === 'custom_message' && entry.content &&
                (entry.customType === 'session-message' ||
                    (entry.customType !== 'interrupted-thinking' && entry.display !== false))) {
                push((0, helper_content_js_1.extractTextContent)(entry.content).substring(0, SEARCH_TEXT_PROSE_CAP));
            }
            if (entry.type === 'branch_summary' && typeof entry.summary === 'string' && entry.summary) {
                push(entry.summary.substring(0, SEARCH_TEXT_PROSE_CAP));
            }
        }
        catch (e) { }
    }
    return (head ? parts.slice(head) : parts).join(' ').toLowerCase();
}
/** Search text plus enough tree state to validate a future append cheaply. */
function buildSearchIndexFromContent(content) {
    return buildSearchIndexFromEntries(parseSessionEntries(content));
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
    return extendSearchIndexFromEntries(parseSessionEntries(content), tree, leafId);
}
function extendSearchIndexFromEntries(entries, tree, leafId) {
    let nextLeafId = leafId;
    if (tree) {
        for (const raw of entries) {
            const entry = fields(raw);
            if (entry.type === 'session' || !entry.id)
                continue;
            if (entry.parentId === undefined || entry.parentId !== nextLeafId)
                return null;
            nextLeafId = entry.id;
        }
    }
    else if (entries.some(raw => {
        const entry = fields(raw);
        return entry.type !== 'session' && entry.id && entry.parentId !== undefined;
    })) {
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
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
const emptyCosts = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const emptyCostUnavailable = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
// Subscription-plan providers (ZAI Coding Plan, Kimi for Coding, Antigravity,
// ChatGPT-backed openai-codex) deliberately report zero costs because there is
// no per-request price to calculate. Those zeros are not evidence that the
// usage was free, so keep spend unavailable while preserving explicit-zero
// costs from providers that actually report them.
function reportedCost(harnessId, provider, usage) {
    const cost = fields(usage ?? EMPTY_FIELDS).cost;
    const rawCost = cost ? fields(cost) : null;
    if ((0, harness_pricing_js_1.isPlanProvider)(harnessId, provider) &&
        rawCost && COST_KEYS.every(key => rawCost[key] === 0))
        return undefined;
    if (!cost || typeof cost !== 'object')
        return undefined;
    const sanitized = {};
    for (const key of COST_KEYS) {
        const value = rawCost?.[key];
        if (typeof value === 'number' && Number.isFinite(value))
            sanitized[key] = value;
    }
    return Object.keys(sanitized).length ? sanitized : undefined;
}
function usageCost(candidate, provider, model, usage) {
    const estimated = (0, harness_pricing_js_1.estimateUsageCost)(candidate?.harnessId, provider, model, usage);
    return estimated || reportedCost(candidate?.harnessId, provider, usage);
}
/** Display/stats price the raw selected/response identity without rewriting it. */
function messageUsageCost(candidate, message, fallback) {
    return usageCost(candidate, message.provider || fallback.provider, message.responseModel || message.model || fallback.model, message.usage);
}
function isEmptyFailedUsage(message) {
    if (message?.stopReason !== 'error')
        return false;
    const usage = message.usage;
    const raw = usage ? fields(usage) : null;
    const cost = raw?.cost ? fields(raw.cost) : null;
    return !raw || (!['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens'].some(key => Number(raw[key]) > 0) &&
        (!cost || COST_KEYS.every(key => !cost[key])));
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
        if (typeof value === 'number' && Number.isFinite(value)) {
            const previous = bucket.costs[key];
            bucket.costs[key] = (typeof previous === 'number' && Number.isFinite(previous) ? previous : 0) + value;
        }
        else {
            bucket.costUnavailable[key] = Number(bucket.costUnavailable[key]) + 1;
        }
    }
}
function computeSessionStats(filePath, _stats, candidate = {}) {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const costBucket = { costs: emptyCosts(), costUnavailable: emptyCostUnavailable() };
    let reasoningTokens = 0, hardCacheMisses = 0;
    let userMessages = 0, assistantMessages = 0, toolCalls = 0, toolResults = 0, compactions = 0;
    // Session-wide effective speed: output tokens over response seconds,
    // summed only across messages whose timing is measurable (genOutput can be
    // less than tokens.output) so the average isn't diluted by unmeasured ones.
    let genMs = 0, genOutput = 0;
    const responseDurations = [];
    const model = { provider: null, model: null };
    for (const line of node_fs_1.default.readFileSync(filePath, 'utf-8').split('\n')) {
        if (!line.trim())
            continue;
        let parsed;
        try {
            parsed = parseEntry(line);
        }
        catch {
            continue;
        }
        const entry = fields(parsed);
        if (entry.type === 'model_change')
            advanceModelChange(entry, model, candidate.profileId, 'display');
        // Both Pi and OMP (snapcompact included) record a `compaction` entry per
        // compaction; abandoned-branch entries are counted here like every other
        // counter in this pass.
        if (entry.type === 'compaction') {
            compactions++;
            continue;
        }
        if (entry.type !== 'message' || !entry.message)
            continue;
        const m = fields(entry.message);
        if (m.role === 'user')
            userMessages++;
        else if (m.role === 'toolResult')
            toolResults++;
        else if (m.role === 'assistant') {
            assistantMessages++;
            if (Array.isArray(m.content))
                toolCalls += m.content.filter(c => fields(c).type === 'toolCall').length;
            const u = m.usage ? fields(m.usage) : null;
            if (u) {
                tokens.input += tokenAmount(u.input);
                tokens.output += tokenAmount(u.output);
                tokens.cacheRead += tokenAmount(u.cacheRead);
                tokens.cacheWrite += tokenAmount(u.cacheWrite);
                reasoningTokens += tokenAmount(u.reasoning);
                if ((0, session_metadata_js_1.isHardCacheMiss)(u))
                    hardCacheMisses++;
            }
            addReportedCosts(costBucket, messageUsageCost(candidate, m, model));
            const gen = assistantGenStats(entry);
            if (gen.durationMs && gen.outputTokens) {
                genMs += gen.durationMs;
                genOutput += tokenAmount(gen.outputTokens);
            }
            if (gen.durationMs)
                responseDurations.push(gen.durationMs);
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
    return { tokens, reasoningTokens, hardCacheMisses, cost: costs.total, costs, costUnavailable, responseTiming, userMessages, assistantMessages, toolCalls, toolResults, compactions, genMs, genOutput };
}
/** Compact corpus-index usage, derived during the same read as metadata/text. */
function buildIndexedUsageFromContent(content, candidate = {}) {
    return buildIndexedUsageFromEntries(parseSessionEntries(content), candidate);
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
    const model = { provider: usage.state?.provider ?? null, model: usage.state?.model ?? 'unknown' };
    let cwd = usage.cwd ?? null;
    const add = (bucket, u, duration) => {
        bucket.calls = (bucket.calls || 0) + 1;
        bucket.tokens ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
        for (const k of TOKEN_KEYS) {
            if (Object.hasOwn(bucket.tokens, k))
                bucket.tokens[k] = Number(bucket.tokens[k]) + tokenAmount(u[k]);
        }
        addReportedCosts(bucket, u?.cost);
        if (duration) {
            bucket.measured = (bucket.measured || 0) + 1;
            bucket.durationMs = (bucket.durationMs || 0) + duration;
            bucket.slowestMs = Math.max(bucket.slowestMs || 0, duration);
        }
    };
    for (const raw of entries) {
        const e = fields(raw);
        if (e.type === 'session' && typeof e.cwd === 'string' && e.cwd)
            cwd = e.cwd;
        if (e.type === 'model_change')
            advanceModelChange(e, model, profileId, 'usage');
        const message = e.type === 'message' && fields(e.message ?? EMPTY_FIELDS);
        const m = message && message.role === 'assistant' ? message : null;
        if (!m)
            continue;
        // Providers may emit one assistant error per retry. A rejected attempt
        // with no tokens and no cost is not usage and must not become a chart call.
        if (isEmptyFailedUsage(m))
            continue;
        const p = (typeof m.provider === 'string' && m.provider) || model.provider || 'unknown';
        // Routed models (for example OpenRouter `auto`) bill under the concrete
        // response model, not the selected alias recorded in message.model.
        const mid = (typeof m.responseModel === 'string' && m.responseModel)
            || (typeof m.model === 'string' && m.model) || model.model || 'unknown';
        const ref = `${p}/${mid}`;
        const ts = entryDate(e.timestamp || m.timestamp);
        const day = Number.isFinite(ts.getTime()) ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}` : 'unknown';
        const duration = assistantGenStats(e).durationMs || 0;
        const u = { ...fields(m.usage ?? EMPTY_FIELDS), cost: usageCost(candidate, p, mid, m.usage) };
        add(total, u, duration);
        add(days[day] ||= {}, u, duration);
        const modelBucket = models[ref] ||= { provider: p, model: mid, days: {} };
        add(modelBucket, u, duration);
        add(modelBucket.days[day] ||= {}, u, duration);
    }
    usage.cwd = cwd;
    usage.state = model;
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
        fd = node_fs_1.default.openSync(filePath, 'r');
        const buf = Buffer.alloc(8192);
        const n = node_fs_1.default.readSync(fd, buf, 0, buf.length, 0);
        const lines = buf.toString('utf8', 0, n).split('\n');
        for (const line of lines) {
            const entry = fields(JSON.parse(line));
            if (entry.type === 'session')
                return entry.cwd || null;
            if (candidate.profileId !== 'omp-v1')
                break;
        }
        return null;
    }
    catch {
        return null;
    }
    finally {
        if (fd !== undefined) {
            try {
                node_fs_1.default.closeSync(fd);
            }
            catch { }
        }
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
        if (!stats.size)
            return null;
        let fd;
        try {
            fd = node_fs_1.default.openSync(filePath, 'r');
            const length = Math.min(TAIL_BYTES, stats.size);
            const buf = Buffer.alloc(length);
            const n = node_fs_1.default.readSync(fd, buf, 0, length, stats.size - length);
            const lines = buf.toString('utf8', 0, n).split('\n');
            while (lines.length && !lines[lines.length - 1].trim())
                lines.pop();
            const last = lines[lines.length - 1];
            return last && last.startsWith('{') ? JSON.parse(last) : null;
        }
        catch {
            return null;
        }
        finally {
            if (fd !== undefined) {
                try {
                    node_fs_1.default.closeSync(fd);
                }
                catch { }
            }
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
