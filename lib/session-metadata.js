// Generated from src/core/session-metadata.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRecord = isRecord;
exports.cacheIdentity = cacheIdentity;
exports.cacheTokens = cacheTokens;
exports.hasCacheActivity = hasCacheActivity;
exports.isHardCacheMiss = isHardCacheMiss;
exports.resolveCacheTarget = resolveCacheTarget;
exports.cacheTier1h = cacheTier1h;
exports.builtinCacheRetention = builtinCacheRetention;
exports.cacheExpiryForMessage = cacheExpiryForMessage;
exports.decodeSessionInfo = decodeSessionInfo;
exports.sessionInfoFromEntries = sessionInfoFromEntries;
exports.extendSessionInfoFromEntries = extendSessionInfoFromEntries;
const cache_retention_1 = require("./cache-retention");
const helper_content_1 = require("./helper-content");
const helper_format_1 = require("./helper-format");
const helper_refs_1 = require("./helper-refs");
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value) { return typeof value === 'string' && value.length > 0; }
function shortName(text) {
    return (0, helper_format_1.truncate)(text, 40, '...');
}
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function decodeCacheExpiry(value) {
    if (!isRecord(value))
        return null;
    const refreshedAt = finiteNumber(value.refreshedAt);
    const expiresAt = finiteNumber(value.expiresAt);
    const retentionMs = finiteNumber(value.retentionMs);
    const basis = value.basis;
    if (refreshedAt === null || expiresAt === null || retentionMs === null ||
        typeof value.retention !== 'string' || typeof value.identity !== 'string' ||
        !['fixed', 'minimum', 'estimate', 'learned'].includes(String(basis)))
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
    if (!isRecord(message.usage))
        return false;
    return cacheTokens(message.usage, 'cacheRead') > 0 || cacheTokens(message.usage, 'cacheWrite') > 0;
}
function isHardCacheMiss(usage) {
    return isRecord(usage) && cacheTokens(usage, 'cacheRead') === 0 && cacheTokens(usage, 'cacheWrite') > 0;
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
/** Anthropic's extended retention tier, reported as cacheWrite1h dominating cacheWrite. */
function cacheTier1h(usage) {
    const write = cacheTokens(usage, 'cacheWrite');
    return write > 0 && cacheTokens(usage, 'cacheWrite1h') >= write;
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
    if (api === 'anthropic-messages' || provider === 'anthropic') {
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
    if (!isRecord(message.usage) || !hasCacheActivity(message))
        return null;
    const usage = message.usage;
    const identity = cacheIdentity(message);
    const read = cacheTokens(usage, 'cacheRead');
    const long = cacheTier1h(usage);
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
        const target = resolveCacheTarget(message);
        const configured = (0, cache_retention_1.configuredCacheRetention)(config, target.provider, target.model);
        const derived = configured ?? builtinCacheRetention(target, long);
        if (derived)
            ({ retentionMs, retention, basis } = derived);
    }
    if (retentionMs === null)
        return null;
    return { refreshedAt: startedAt, expiresAt: startedAt + retentionMs, retentionMs, retention, basis, identity,
        ...(long ? { tier: '1h' } : {}) };
}
/** Validate persisted accumulator output, reviving its serialized activity Date. */
function decodeSessionInfo(value) {
    if (!isRecord(value) || typeof value.model !== 'string' ||
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
 * from — the O(delta) path lib/session-index.js uses for a streaming active
 * session, so a sidebar poll never re-parses a whole multi-MB JSONL because
 * one turn was appended. Mutates and returns `info`; `mtime` is the file's
 * new mtime (a full parse floors lastActivity at the mtime, so the extension
 * must too).
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
        if (!isRecord(entry))
            continue;
        const message = isRecord(entry.message) ? entry.message : null;
        // Only an entry parsed from physical line zero can be Pi's SessionHeader
        // / OMP's title line (parseEntries marks that on the array). A blank or
        // torn first line means the file has no readable header, and a later
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
            const model = profileId === 'omp-v1' ? entry.model : entry.modelId;
            if (nonempty(model))
                info.model = model;
            info.cacheExpiry = null;
        }
        // Explicit names assign unconditionally (later wins); the first user
        // message is only a fallback for a still-unnamed session. Same resolution
        // the whole-file parse performed at return time.
        if (entry.type === 'session_info' && nonempty(entry.name))
            info.name = entry.name;
        if (nonempty(entry.sessionName))
            info.name = entry.sessionName;
        if (entry.type === 'message' && message?.role === 'user') {
            info.messageCount++;
            if (info.name === null) {
                // The <session-refs> block is appended context, not something the
                // user wrote — a session named after its first prompt must not be
                // named after the block that followed it.
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
        if (entry.type === 'message' && message?.role === 'assistant' && isRecord(message.usage)) {
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
