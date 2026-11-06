// Generated from src/core/session-metadata.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheIdentity = cacheIdentity;
exports.cacheTokens = cacheTokens;
exports.hasCacheActivity = hasCacheActivity;
exports.isHardCacheMiss = isHardCacheMiss;
exports.resolveCacheTarget = resolveCacheTarget;
exports.cacheTier1h = cacheTier1h;
exports.builtinCacheRetention = builtinCacheRetention;
exports.cacheExpiryForMessage = cacheExpiryForMessage;
exports.entryModel = entryModel;
exports.decodeSessionInfo = decodeSessionInfo;
exports.sessionInfoFromEntries = sessionInfoFromEntries;
exports.extendSessionInfoFromEntries = extendSessionInfoFromEntries;
const cache_retention_1 = require("./cache-retention");
const helper_content_1 = require("./helper-content");
const helper_format_1 = require("./helper-format");
const helper_refs_1 = require("./helper-refs");
const helper_values_1 = require("./helper-values");
function nonempty(value) { return typeof value === 'string' && value.length > 0; }
function shortName(text) {
    return (0, helper_format_1.truncate)(text, 40, '...');
}
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function decodeCacheExpiry(value) {
    if (!(0, helper_values_1.record)(value))
        return null;
    const refreshedAt = finiteNumber(value.refreshedAt);
    const expiresAt = finiteNumber(value.expiresAt);
    const retentionMs = finiteNumber(value.retentionMs);
    const basis = value.basis;
    if (refreshedAt === null || expiresAt === null || retentionMs === null ||
        typeof value.retention !== 'string' || typeof value.identity !== 'string' ||
        !['fixed', 'minimum', 'estimate', 'learned', 'unknown'].includes(String(basis)))
        return null;
    return { refreshedAt, expiresAt, retentionMs, retention: value.retention,
        basis: basis, identity: value.identity,
        ...(value.tier === '1h' ? { tier: '1h' } : {}) };
}
function cacheIdentity(message) {
    return [message.api, message.provider, message.model].map(value => typeof value === 'string' ? value : '').join('\u0000');
}
function cacheTokens(usage, key) {
    const value = finiteNumber(usage[key]);
    return value !== null && value > 0 ? value : 0;
}
function hasCacheActivity(message) {
    if (!(0, helper_values_1.record)(message.usage))
        return false;
    return cacheTokens(message.usage, 'cacheRead') > 0 || cacheTokens(message.usage, 'cacheWrite') > 0;
}
function isHardCacheMiss(usage) {
    return (0, helper_values_1.record)(usage) && cacheTokens(usage, 'cacheRead') === 0 && cacheTokens(usage, 'cacheWrite') > 0;
}
/** Normalize a message's cache ownership: explicit fields, model slug, then API. */
function resolveCacheTarget(message) {
    const api = typeof message.api === 'string' ? message.api : '';
    let provider = typeof message.provider === 'string' ? message.provider.toLowerCase() : '';
    let model = typeof message.model === 'string' ? message.model : '';
    if (!provider) {
        const slash = model.indexOf('/');
        if (slash > 0) {
            provider = model.slice(0, slash).toLowerCase();
            model = model.slice(slash + 1);
        }
    }
    if (!provider) {
        if (api === 'anthropic-messages')
            provider = 'anthropic';
        else if (api === 'bedrock-converse-stream')
            provider = 'amazon-bedrock';
        else if (api.startsWith('openai-'))
            provider = 'openai';
    }
    return { api, provider, model };
}
/**
 * Anthropic's extended retention tier. Pi reports it as cacheWrite1h
 * dominating cacheWrite. OMP omits that split but still prices the write, and
 * Anthropic bills 1h-tier writes at 2× base input against 1.25× for the 5m
 * tier, so for Anthropic targets the priced write/input rate ratio decides
 * when the split is absent. Other providers' write premiums mean nothing here.
 */
function cacheTier1h(usage, anthropic = false) {
    const write = cacheTokens(usage, 'cacheWrite');
    if (write <= 0)
        return false;
    if (usage.cacheWrite1h !== undefined || !anthropic)
        return cacheTokens(usage, 'cacheWrite1h') >= write;
    const cost = (0, helper_values_1.record)(usage.cost) ? usage.cost : null;
    const input = finiteNumber(usage.input), writeCost = finiteNumber(cost?.cacheWrite), inputCost = finiteNumber(cost?.input);
    if (!input || input <= 0 || !writeCost || !inputCost || inputCost <= 0)
        return false;
    return (writeCost / write) / (inputCost / input) >= 1.6;
}
/**
 * Documented fixed/minimum windows and conservative provider estimates. This
 * ladder is the learner's Bayesian prior and the fallback when no learned
 * model has activated.
 */
function builtinCacheRetention(target, long1h) {
    const { api, provider, model } = target;
    if (provider === 'opencode-go' && /^deepseek-/i.test(model)) {
        return { retentionMs: 24 * 60 * 60_000, retention: '24h', basis: 'minimum' };
    }
    // Anthropic's published windows belong to Anthropic itself. Third parties
    // speaking its wire format (Kimi, GLM, …) run their own caches and were
    // observed warm after hours; the learner, not this ladder, answers for them.
    if (provider === 'anthropic') {
        return long1h
            ? { retentionMs: 60 * 60_000, retention: '1h', basis: 'fixed' }
            : { retentionMs: 5 * 60_000, retention: '5m', basis: 'fixed' };
    }
    if (api === 'bedrock-converse-stream' || provider === 'amazon-bedrock') {
        return { retentionMs: 5 * 60_000, retention: '5m', basis: 'estimate' };
    }
    if (api.startsWith('openai-') || provider === 'openai' || provider === 'openai-codex') {
        const version = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
        const explicit = !!version && (Number(version[1]) > 5 || (Number(version[1]) === 5 && Number(version[2] || 0) >= 6));
        return explicit
            ? { retentionMs: 30 * 60_000, retention: '30m', basis: 'minimum' }
            : { retentionMs: 10 * 60_000, retention: '~10m', basis: 'estimate' };
    }
    return null;
}
/**
 * Providers report cache token activity, not expiry timestamps. Derive only
 * documented fixed/minimum windows and conservative provider estimates.
 */
function cacheExpiryForMessage(message, previous = null, fallbackTimestamp, config = (0, cache_retention_1.loadCacheRetentionConfig)()) {
    if (!(0, helper_values_1.record)(message.usage) || !hasCacheActivity(message))
        return null;
    const usage = message.usage;
    const identity = cacheIdentity(message);
    const target = resolveCacheTarget(message);
    const read = cacheTokens(usage, 'cacheRead');
    const long = cacheTier1h(usage, target.provider === 'anthropic');
    const startedAt = new Date((message.timestamp ?? fallbackTimestamp)).getTime();
    if (!Number.isFinite(startedAt))
        return null;
    let retentionMs = null;
    let retention = '';
    let basis = 'estimate';
    if (read > 0 && previous?.identity === identity) {
        ({ retentionMs, retention, basis } = previous);
    }
    else {
        const configured = (0, cache_retention_1.configuredCacheRetention)(config, target.provider, target.model);
        const derived = configured ?? builtinCacheRetention(target, long);
        // No known window: keep an 'unknown' anchor (refresh time + identity) so
        // a learned TTL can still project an expiry at serve time.
        ({ retentionMs, retention, basis } = derived ?? { retentionMs: 0, retention: '', basis: 'unknown' });
    }
    if (retentionMs === null)
        return null;
    return { refreshedAt: startedAt, expiresAt: startedAt + retentionMs, retentionMs, retention, basis, identity,
        ...(long ? { tier: '1h' } : {}) };
}
/** The model id a model_change entry records, in the profile's field. */
function entryModel(entry, profileId) {
    const model = profileId === 'omp-v1' ? entry.model : entry.modelId;
    return typeof model === 'string' && model ? model : null;
}
/** Validate persisted accumulator output, reviving its serialized activity Date. */
function decodeSessionInfo(value) {
    if (!(0, helper_values_1.record)(value) || typeof value.model !== 'string' ||
        !['name', 'cwd', 'sessionId', 'parentSession'].every(key => value[key] === null || typeof value[key] === 'string') ||
        typeof value.messageCount !== 'number' || !Number.isFinite(value.messageCount) ||
        typeof value.contextTokens !== 'number' || !Number.isFinite(value.contextTokens))
        return null;
    const raw = value.lastActivity;
    if (!(raw instanceof Date) && typeof raw !== 'string' && typeof raw !== 'number')
        return null;
    const lastActivity = new Date(raw);
    if (!Number.isFinite(lastActivity.getTime()))
        return null;
    return { model: value.model, name: value.name,
        cwd: value.cwd, sessionId: value.sessionId,
        parentSession: value.parentSession,
        messageCount: value.messageCount, contextTokens: value.contextTokens, lastActivity,
        cacheExpiry: decodeCacheExpiry(value.cacheExpiry) };
}
function sessionInfoFromEntries(entries, mtime, candidate = {}, config = (0, cache_retention_1.loadCacheRetentionConfig)()) {
    const info = {
        model: 'unknown', name: null, messageCount: 0, contextTokens: 0,
        lastActivity: mtime || new Date(0), cwd: null, sessionId: null, parentSession: null,
        cacheExpiry: null,
    };
    return accumulateSessionInfo(info, entries, candidate, true, config);
}
/**
 * Extend an info object with entries appended after the range it was built
 * from (session-index's O(delta) path). Mutates and returns `info`; `mtime` is
 * the file's new mtime, which a full parse floors lastActivity at.
 */
function extendSessionInfoFromEntries(info, entries, mtime, candidate = {}, config = (0, cache_retention_1.loadCacheRetentionConfig)()) {
    if (mtime && mtime.getTime() > new Date(info.lastActivity).getTime())
        info.lastActivity = mtime;
    return accumulateSessionInfo(info, entries, candidate, false, config);
}
function accumulateSessionInfo(info, entries, candidate, fromStart, config) {
    const profileId = candidate.profileId || 'pi-v3';
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!(0, helper_values_1.record)(entry))
            continue;
        const message = (0, helper_values_1.record)(entry.message) ? entry.message : null;
        // Only an entry parsed from physical line zero can be the header; a later
        // session-shaped entry must not be promoted to one.
        const isFirst = fromStart && i === 0 && entries.firstEntryOnFirstLine === true;
        if (profileId === 'omp-v1' && isFirst && entry.type === 'title' && nonempty(entry.title))
            info.name = entry.title;
        if (entry.type === 'session') {
            if (nonempty(entry.cwd))
                info.cwd = entry.cwd;
            // Native identity and lineage belong to Pi's first-line SessionHeader.
            // Later session-shaped custom entries must not rewrite provenance.
            if (isFirst || (profileId === 'omp-v1' && info.sessionId === null)) {
                if (typeof entry.id === 'string' && entry.id)
                    info.sessionId = entry.id;
                if (typeof entry.parentSession === 'string' && entry.parentSession)
                    info.parentSession = entry.parentSession;
            }
        }
        if (entry.type === 'model_change') {
            const model = entryModel(entry, profileId);
            if (model)
                info.model = model;
            info.cacheExpiry = null;
        }
        // Explicit names win; the first user message is only a fallback.
        if (entry.type === 'session_info' && nonempty(entry.name))
            info.name = entry.name;
        if (nonempty(entry.sessionName))
            info.name = entry.sessionName;
        if (entry.type === 'message' && message?.role === 'user') {
            info.messageCount++;
            if (info.name === null) {
                // The <session-refs> block is appended context, not user text, so it
                // must never become the session name.
                const { text } = (0, helper_refs_1.splitSessionRefContext)((0, helper_content_1.extractTextContent)(message.content));
                if (text)
                    info.name = shortName(text);
            }
        }
        if (info.name === null && entry.type === 'custom_message' &&
            entry.customType === 'session-message' && nonempty(entry.content)) {
            info.name = shortName(entry.content);
        }
        if (typeof entry.timestamp === 'string' || typeof entry.timestamp === 'number') {
            const ts = new Date(entry.timestamp).getTime();
            if (Number.isFinite(ts) && ts > new Date(info.lastActivity).getTime())
                info.lastActivity = new Date(ts);
        }
        if (entry.type === 'message' && message?.role === 'assistant' && (0, helper_values_1.record)(message.usage)) {
            const tokens = message.usage.totalTokens;
            info.contextTokens = typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : 0;
            if (hasCacheActivity(message)) {
                info.cacheExpiry = cacheExpiryForMessage(message.model === undefined ? { ...message, model: info.model } : message, info.cacheExpiry, entry.timestamp, config);
            }
        }
        if (entry.type === 'compaction') {
            info.contextTokens = 0;
            info.cacheExpiry = null;
        }
    }
    return info;
}
