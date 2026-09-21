// Generated from src/core/cache-retention.ts; edit that source and run npm run build:core.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCacheRetentionConfig = loadCacheRetentionConfig;
exports.cacheRetentionRevision = cacheRetentionRevision;
exports.configuredCacheRetention = configuredCacheRetention;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const helper_models_1 = require("./helper-models");
const CONFIG_REVISION = 1;
const MAX_RULES = 100;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 365 * 24 * 60 * 60_000;
const cache = new Map();
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value : null;
}
function formatDuration(ms) {
    if (ms % (24 * 60 * 60_000) === 0)
        return `${ms / (24 * 60 * 60_000)}d`;
    if (ms % (60 * 60_000) === 0)
        return `${ms / (60 * 60_000)}h`;
    return `${ms / 60_000}m`;
}
function parseDuration(value) {
    if (typeof value !== 'string')
        return null;
    const match = /^([1-9]\d*)\s*([mhd])$/i.exec(value.trim());
    if (!match)
        return null;
    const amount = Number(match[1]);
    const unitMs = match[2].toLowerCase() === 'm' ? 60_000
        : match[2].toLowerCase() === 'h' ? 60 * 60_000
            : 24 * 60 * 60_000;
    const retentionMs = amount * unitMs;
    if (!Number.isSafeInteger(retentionMs) || retentionMs < MIN_TTL_MS || retentionMs > MAX_TTL_MS)
        return null;
    return { retentionMs, retention: formatDuration(retentionMs) };
}
function parseRules(value) {
    if (!Array.isArray(value))
        return [];
    const rules = [];
    for (const raw of value.slice(0, MAX_RULES)) {
        const item = record(raw);
        const ttl = parseDuration(item?.ttl);
        const provider = typeof item?.provider === 'string' ? item.provider.trim().toLowerCase() : '';
        const model = typeof item?.model === 'string' ? item.model.trim() : '';
        const basis = item?.basis === undefined ? 'fixed' : item.basis;
        if (!ttl || (!provider && !model) || provider.length > 100 || model.length > 200 ||
            (basis !== 'fixed' && basis !== 'minimum' && basis !== 'estimate'))
            continue;
        rules.push({ ...ttl, provider, model, basis });
    }
    return rules;
}
function readSettings(file) {
    try {
        return JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
/**
 * Read the private host-level cache policy. The settings file is revalidated
 * by (mtime,size), matching the other hand-edited pi-dish configuration.
 */
function loadCacheRetentionConfig() {
    const file = node_path_1.default.join(node_os_1.default.homedir(), '.pi', 'dish', 'settings.json');
    let stamp = 'missing';
    try {
        const stats = node_fs_1.default.statSync(file);
        stamp = `${stats.mtimeMs}:${stats.size}`;
    }
    catch { }
    const existing = cache.get(file);
    if (existing?.stamp === stamp)
        return existing.config;
    const settings = record(readSettings(file));
    const rules = parseRules(settings?.cacheTtlOverrides);
    const digest = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 16);
    const config = { revision: `v${CONFIG_REVISION}:${digest}`, rules };
    cache.set(file, { stamp, config });
    return config;
}
function cacheRetentionRevision() {
    return loadCacheRetentionConfig().revision;
}
/** First matching user rule wins; a rule may constrain provider, model, or both. */
function configuredCacheRetention(config, provider, model) {
    const normalizedProvider = provider.toLowerCase();
    for (const rule of config.rules) {
        if (rule.provider && rule.provider !== normalizedProvider)
            continue;
        if (rule.model && !(0, helper_models_1.modelMatchesPattern)(rule.model, { provider: normalizedProvider, id: model }))
            continue;
        return { retentionMs: rule.retentionMs, retention: rule.retention, basis: rule.basis };
    }
    return null;
}
