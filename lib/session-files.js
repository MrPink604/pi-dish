// Generated from src/core/session-files.ts; edit that source and run npm run build:core.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCH_TEXT_SESSION_CAP = void 0;
exports.readSessionFileEntries = readSessionFileEntries;
exports.getSessionInfo = getSessionInfo;
exports.parseSessionEntries = parseSessionEntries;
exports.sanitizeUsage = sanitizeUsage;
exports.readSessionMessages = readSessionMessages;
exports.readSessionMessagesAtLeaf = readSessionMessagesAtLeaf;
exports.readSessionMessageById = readSessionMessageById;
exports.readSessionSearchText = readSessionSearchText;
exports.buildSearchTextFromContent = buildSearchTextFromContent;
exports.buildSearchIndexFromEntries = buildSearchIndexFromEntries;
exports.extendSearchIndexFromEntries = extendSearchIndexFromEntries;
exports.buildIndexedUsageFromContent = buildIndexedUsageFromContent;
exports.buildIndexedUsageFromEntries = buildIndexedUsageFromEntries;
exports.extendIndexedUsageFromEntries = extendIndexedUsageFromEntries;
exports.getSessionStats = getSessionStats;
exports.readSessionCwd = readSessionCwd;
exports.readSessionTailEntry = readSessionTailEntry;
exports.resetCaches = resetCaches;
/**
 * Session JSONL readers. Session files run to tens of MB, so each reader
 * caches its projection keyed by (mtimeMs, size, ctimeMs, device, inode) and
 * re-parses only changed files. `getSessionInfo` returns a fresh shallow copy
 * per call (callers overlay live usage); the other readers return cached
 * arrays — treat them as immutable.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const cache_retention_js_1 = require("./cache-retention.js");
const session_metadata_js_1 = require("./session-metadata.js");
const helper_values_js_1 = require("./helper-values.js");
const cache_lifetime_js_1 = require("./cache-lifetime.js");
const session_index_data_js_1 = require("./session-index-data.js");
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
// OMP bookkeeping entries that contribute neither transcript rows nor counters.
// `custom_message` is handled separately because visible notices use it too.
const TOLERATED_NON_MESSAGE_ENTRY_TYPES = new Set([
    'custom', 'session_init', 'reset_boundary', 'mode_change', 'ttsr_injection',
    'credential_pin', 'label', 'service_tier_change',
]);
function source(candidate) {
    return typeof candidate === 'string' ? { file: candidate, profileId: 'pi-v3', profileVersion: 1, harnessId: 'pi' } : candidate;
}
function sameFile(left, right) {
    return left.mtimeMs === right.mtimeMs && left.size === right.size &&
        left.ctimeMs === right.ctimeMs && left.dev === right.dev && left.ino === right.ino;
}
// One opportunistic raw parse, shared by metadata/messages/stats/the corpus
// index. Weak ownership avoids retaining a second large transcript solely for
// a possible next reader. GC may discard it at any time between operations;
// that changes work, never freshness. Profiles/pricing apply after this cache.
let parsedFile;
function readSessionFileEntries(file, stats = node_fs_1.default.statSync(file)) {
    if (parsedFile?.file === file && sameFile(parsedFile.stats, stats)) {
        const entries = parsedFile.entries.deref();
        if (entries)
            return { entries, endsNl: parsedFile.endsNl };
    }
    const content = node_fs_1.default.readFileSync(file, 'utf-8');
    const entries = parseSessionEntries(content);
    const endsNl = content.endsWith('\n');
    parsedFile = { file, stats, entries: new WeakRef(entries), endsNl };
    return { entries, endsNl };
}
/** The file-stamp revalidating LRU every reader shares; a hit refreshes recency and the oldest entry is evicted when full. */
function statCached(cache, input, max, parse, extraKey = '') {
    const candidate = source(input);
    const filePath = candidate.file;
    const cacheKey = `${filePath}\0${candidate.profileId || 'pi-v3'}\0${candidate.profileVersion ?? 1}\0${(0, harness_pricing_js_1.pricingRevision)(candidate.harnessId)}${extraKey ? '\0' + extraKey : ''}`;
    const stats = node_fs_1.default.statSync(filePath);
    const cached = cache.get(cacheKey);
    if (cached && sameFile(cached.stats, stats)) {
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
    cache.set(cacheKey, { stats, value });
    return value;
}
const infoCache = new Map();
function getSessionInfo(filePath) {
    return { ...statCached(infoCache, filePath, 1000, (fp, stats, candidate) => (0, session_metadata_js_1.sessionInfoFromEntries)(readSessionFileEntries(fp, stats).entries, stats.mtime, candidate), `cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`) };
}
/**
 * The active branch: the parent chain from the leaf (the *last* entry, as
 * pi's SessionManager does on reopen) back to the root. Off-chain entries are
 * abandoned /tree branches and must not render. Null for pre-tree files (no
 * parentId), where every entry is active.
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
// A snapcompact compaction record can reach tens of MB of base64 PNG
// preserveData, which no projection consumes. The OMP writer serializes it
// last, so parse the prefix before it; any other ordering falls back to a
// full parse.
const LARGE_COMPACTION_RECORD = 64 * 1024;
function parseEntry(line) {
    if (line.length >= LARGE_COMPACTION_RECORD && line.startsWith('{"type":"compaction",')) {
        const preserveAt = line.indexOf(',"preserveData":');
        if (preserveAt > 0 && line.endsWith('}}')) {
            try {
                const entry = JSON.parse(line.slice(0, preserveAt) + '}');
                if ((0, helper_values_js_1.record)(entry) && entry.type === 'compaction' && typeof entry.id === 'string' &&
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
            // Only physical line zero can be Pi's SessionHeader / OMP's title line;
            // sessionInfoFromEntries must not promote a later entry to one.
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
/**
 * OMP's service_tier_change entries track the per-family tier map /fast
 * writes (null clears it). Billing-provider families mirror OMP's own
 * Sv() resolution for the providers pi-dish prices; unknown providers have
 * no known tier accounting and keep the flat estimate.
 */
function advanceServiceTierChange(entry, tiers) {
    if (entry.type !== 'service_tier_change')
        return;
    const raw = entry.serviceTier;
    if (!raw || typeof raw !== 'object') {
        tiers.value = null;
        return;
    }
    const next = {};
    for (const family of ['openai', 'anthropic', 'google']) {
        const tier = raw[family];
        if (typeof tier === 'string' && tier)
            next[family] = tier;
    }
    tiers.value = Object.keys(next).length ? next : null;
}
/** Whether a message's provider bills under an engaged fast tier (priority/ultrafast). */
function providerUnderFastTier(provider, tiers) {
    if (!tiers)
        return false;
    if (provider === 'openai' || provider === 'openai-codex') {
        return tiers.openai === 'priority' || tiers.openai === 'ultrafast';
    }
    if (provider === 'anthropic')
        return tiers.anthropic === 'priority';
    if (provider === 'google' || provider === 'google-vertex')
        return tiers.google === 'priority';
    return false;
}
function messageFromEntry(entry, candidate, estimateCost, fallbackModel = {}, cacheExpiry, tiers = null) {
    if (entry.type === 'message' && entry.message) {
        const message = fields(entry.message);
        // Hidden custom messages are model continuity/state, not transcript UI;
        // interrupted-thinking is projected below without its hidden reasoning.
        if (message.role === 'custom' && message.display === false)
            return null;
        const usage = sanitizeUsage(message.usage);
        if (usage) {
            const estimated = messageUsageCost(candidate, message, fallbackModel, estimateCost, tiers);
            if (estimated)
                usage.cost = estimated;
            else
                delete usage.cost;
        }
        return {
            // The JSONL entry id anchors pi's HTML export deep links (?targetId=<id>).
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
            // toolResult entries carry these at the message level; the client renders
            // the tool name and error state from them.
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
        // OMP marks interrupted-thinking display:false because its content is
        // private reasoning, so only type/details reach the client.
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
        // Tree navigation injects this as context, so show it in the transcript.
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
 * The displayable message stream /messages paginates over; array index is the
 * stream index. Only the active tree path is included. Cached for the few most
 * recently viewed sessions — do not mutate the result.
 */
function parseMessageData(entries, candidate, leafOverride) {
    const cacheConfig = (0, cache_retention_js_1.loadCacheRetentionConfig)();
    const estimateCost = (0, harness_pricing_js_1.createUsageCostEstimator)(candidate?.harnessId);
    const active = activeTree(entries, leafOverride)?.ids || null;
    const messages = [];
    const byId = new Map();
    const model = { provider: null, model: null };
    let cacheExpiry = null;
    const tiers = { value: null };
    for (const raw of entries) {
        try {
            const entry = fields(raw);
            if (entry.type === 'model_change') {
                advanceModelChange(entry, model, candidate?.profileId, 'display');
                cacheExpiry = null;
            }
            advanceServiceTierChange(entry, tiers);
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
            const message = messageFromEntry(entry, candidate, estimateCost, model, (0, cache_lifetime_js_1.applyLearnedCacheExpiry)(responseCacheExpiry, cacheConfig), tiers.value);
            if (!message)
                continue;
            // Keep abandoned entries addressable by id so an already-rendered lazy
            // image URL cannot change meaning after /tree navigation.
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
        for (const key of session_index_data_js_1.COST_KEYS) {
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
 * Response time from two timestamps: message.timestamp is stamped when the
 * API call starts, the entry's timestamp when it is appended. Empty for
 * non-assistant entries or when either timestamp is missing/inverted.
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
    // Sized above the client's 5-session retention: lazy image loads and
    // warm-restore catch-ups tour that many sessions through this cache.
    return statCached(messagesCache, filePath, 8, (fp, stats, candidate) => parseMessageData(readSessionFileEntries(fp, stats).entries, candidate), `cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`).messages;
}
// A live OMP session can move its in-memory leaf without a JSONL anchor, so
// the bridge's ReadonlySessionManager decides the branch. Cached with the leaf
// in the key: opening a long session fires several page requests.
function readSessionMessagesAtLeaf(filePath, leafId) {
    return statCached(messagesCache, filePath, 8, (fp, stats, candidate) => parseMessageData(readSessionFileEntries(fp, stats).entries, candidate, leafId), `leaf:${leafId ?? ''}\0cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`).messages;
}
function readSessionMessageById(filePath, entryId) {
    return statCached(messagesCache, filePath, 8, (fp, stats, candidate) => parseMessageData(readSessionFileEntries(fp, stats).entries, candidate), `cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`).byId.get(entryId) || null;
}
/**
 * Lowercased per-message text, index-aligned with readSessionMessages ('' for
 * a message with no text). Memoized on the shared message cache entry so a
 * repeated search over an unchanged file is a plain string scan, and both are
 * returned from one revalidation.
 */
function readSessionSearchText(filePath) {
    const data = statCached(messagesCache, filePath, 8, (fp, stats, candidate) => parseMessageData(readSessionFileEntries(fp, stats).entries, candidate), `cache:${(0, cache_retention_js_1.cacheRetentionRevision)()}`);
    if (!data.searchText) {
        data.searchText = data.messages.map(message => (0, helper_content_js_1.extractTextContent)(message.content).toLowerCase());
    }
    return { messages: data.messages, texts: data.searchText };
}
/**
 * Search-text bounds. Prose is the recall target, so its cap only stops one
 * giant paste from eating the session budget. Tool results are bulky
 * low-recall dumps and stay tight. The session cap bounds one transcript's
 * total text and overflow drops the *oldest* text, keeping recent turns.
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
/** Lowercased whole-session message text for server-side list search; the index persists it. */
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
function buildSearchTextFromContent(content) {
    return buildSearchIndexFromEntries(parseSessionEntries(content)).text;
}
function buildSearchIndexFromEntries(entries) {
    const tree = activeTree(entries);
    return {
        text: searchTextFromEntries(entries, tree?.ids || null),
        tree: !!tree,
        leafId: tree?.leafId || null,
    };
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
/**
 * Aggregate token/cost/message stats over a whole session (the /stats
 * endpoint). Cached like the other readers — do not mutate the result.
 */
const statsCache = new Map(); // filePath -> { mtimeMs, size, value }
const emptyCosts = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
// Subscription-plan providers report zero costs because there is no
// per-request price; those zeros mean unpriced, not free. Explicit zeros from
// providers that do report costs stay authoritative.
function reportedCost(harnessId, provider, usage) {
    const cost = fields(usage ?? EMPTY_FIELDS).cost;
    const rawCost = cost ? fields(cost) : null;
    if ((0, harness_pricing_js_1.isPlanProvider)(harnessId, provider) &&
        rawCost && session_index_data_js_1.COST_KEYS.every(key => rawCost[key] === 0))
        return undefined;
    if (!cost || typeof cost !== 'object')
        return undefined;
    const sanitized = {};
    for (const key of session_index_data_js_1.COST_KEYS) {
        const value = rawCost?.[key];
        if (typeof value === 'number' && Number.isFinite(value))
            sanitized[key] = value;
    }
    return Object.keys(sanitized).length ? sanitized : undefined;
}
function usageCost(candidate, provider, model, usage, estimateCost, preferReported = false) {
    const estimated = estimateCost(provider, model, usage);
    // Under an engaged fast tier OMP scales its own persisted usage cost by the
    // model's service-tier multiplier (account-specific, never in `models --json`),
    // so the reported cost outranks the flat catalog estimate for those turns.
    if (preferReported)
        return reportedCost(candidate?.harnessId, provider, usage) ?? estimated;
    return estimated || reportedCost(candidate?.harnessId, provider, usage);
}
/** Display/stats price the raw selected/response identity without rewriting it. */
function messageUsageCost(candidate, message, fallback, estimateCost, tiers = null) {
    const provider = message.provider || fallback.provider;
    return usageCost(candidate, provider, message.responseModel || message.model || fallback.model, message.usage, estimateCost, providerUnderFastTier(provider, tiers));
}
function isEmptyFailedUsage(message) {
    if (message?.stopReason !== 'error')
        return false;
    const usage = message.usage;
    const raw = usage ? fields(usage) : null;
    const cost = raw?.cost ? fields(raw.cost) : null;
    return !raw || (!['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens'].some(key => Number(raw[key]) > 0) &&
        (!cost || session_index_data_js_1.COST_KEYS.every(key => !cost[key])));
}
/**
 * Keep every known subtotal; a missing price increments a parallel call count
 * (rendered as a partial-estimate marker) instead of destroying the subtotal.
 * Explicit zero stays authoritative.
 */
function addReportedCosts(bucket, cost) {
    bucket.costs ||= emptyCosts();
    bucket.costUnavailable ||= emptyCosts();
    for (const key of session_index_data_js_1.COST_KEYS) {
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
function computeSessionStats(filePath, stats, candidate = {}) {
    const estimateCost = (0, harness_pricing_js_1.createUsageCostEstimator)(candidate.harnessId);
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const costBucket = { costs: emptyCosts(), costUnavailable: emptyCosts() };
    let reasoningTokens = 0, hardCacheMisses = 0;
    let userMessages = 0, assistantMessages = 0, toolCalls = 0, toolResults = 0, compactions = 0;
    // Effective speed sums only measurable messages so it is not diluted.
    let genMs = 0, genOutput = 0;
    const responseDurations = [];
    const model = { provider: null, model: null };
    const tiers = { value: null };
    for (const raw of readSessionFileEntries(filePath, stats).entries) {
        const entry = fields(raw);
        if (entry.type === 'model_change')
            advanceModelChange(entry, model, candidate.profileId, 'display');
        advanceServiceTierChange(entry, tiers);
        // Both Pi and OMP record one `compaction` entry per compaction.
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
            addReportedCosts(costBucket, messageUsageCost(candidate, m, model, estimateCost, tiers.value));
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
function buildIndexedUsageFromEntries(entries, candidate = {}, estimateCost = (0, harness_pricing_js_1.createUsageCostEstimator)(candidate.harnessId)) {
    const usage = {
        total: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, costs: emptyCosts(), costUnavailable: emptyCosts(), calls: 0, measured: 0, durationMs: 0, slowestMs: 0 },
        days: {}, models: {}, cwd: null,
        // Running provider/model continuity, persisted so an appended byte range
        // can be accumulated without re-reading earlier entries.
        state: { provider: null, model: 'unknown' },
    };
    return accumulateIndexedUsage(usage, entries, candidate, estimateCost);
}
/**
 * O(delta) usage extension for an append-only session file. Only valid for
 * usage objects that carry `state` (built by this schema); mutates and
 * returns `usage`.
 */
function extendIndexedUsageFromEntries(usage, entries, candidate = {}, estimateCost = (0, harness_pricing_js_1.createUsageCostEstimator)(candidate.harnessId)) {
    return accumulateIndexedUsage(usage, entries, candidate, estimateCost);
}
function accumulateIndexedUsage(usage, entries, candidate, estimateCost) {
    const profileId = candidate.profileId || 'pi-v3';
    const { total, days, models } = usage;
    const model = { provider: usage.state?.provider ?? null, model: usage.state?.model ?? 'unknown' };
    const tiers = { value: usage.state?.serviceTier ?? null };
    let cwd = usage.cwd ?? null;
    const add = (bucket, u, duration) => {
        bucket.calls = (bucket.calls || 0) + 1;
        bucket.tokens ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
        for (const k of session_index_data_js_1.TOKEN_KEYS) {
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
        advanceServiceTierChange(e, tiers);
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
        const u = { ...fields(m.usage ?? EMPTY_FIELDS), cost: usageCost(candidate, p, mid, m.usage, estimateCost, providerUnderFastTier(p, tiers.value)) };
        add(total, u, duration);
        add(days[day] ||= {}, u, duration);
        const modelBucket = models[ref] ||= { provider: p, model: mid, days: {} };
        add(modelBucket, u, duration);
        add(modelBucket.days[day] ||= {}, u, duration);
    }
    usage.cwd = cwd;
    usage.state = { provider: model.provider, model: model.model, ...(tiers.value ? { serviceTier: tiers.value } : {}) };
    return usage;
}
function getSessionStats(filePath) {
    return statCached(statsCache, filePath, 200, computeSessionStats);
}
/** cwd from the session header line via a bounded read; null when unreadable/absent. */
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
 * The session JSONL's last complete entry via a bounded tail read: harnesses
 * stamp a terminal bookkeeping entry when they dispose a session.
 *
 * Null when the tail holds no complete line; callers treat "unknown" as "not
 * finished". Never grep the whole file for a marker: a transcript that merely
 * discusses one contains the string, and a revived session appends past its
 * own exit entry.
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
/** Test hook: drop caches so fixtures rewritten in place are re-read. */
function resetCaches() {
    infoCache.clear();
    messagesCache.clear();
    statsCache.clear();
    tailCache.clear();
    parsedFile = undefined;
}
