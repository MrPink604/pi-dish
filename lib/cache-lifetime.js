// Generated from src/core/cache-lifetime.ts; edit that source and run npm run build:core.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushCacheLifetime = flushCacheLifetime;
exports.observeCacheLifetimeFromEntries = observeCacheLifetimeFromEntries;
exports.extendCacheLifetimeFromEntries = extendCacheLifetimeFromEntries;
exports.forgetCacheLifetimeFile = forgetCacheLifetimeFile;
exports.applyLearnedCacheExpiry = applyLearnedCacheExpiry;
exports.cacheLifetimeSnapshot = cacheLifetimeSnapshot;
exports.resetCacheLifetimeForTests = resetCacheLifetimeForTests;
/**
 * Learned provider cache lifetimes. Providers report cache *token activity*,
 * never expiry timestamps, so the built-in retention ladder in
 * session-metadata.js is a pile of documented defaults and guesses. This
 * module measures the real thing: every assistant message with cache
 * activity is a Bernoulli probe of "did the provider cache survive the idle
 * gap since the previous cache-active message in this session?" — a hit
 * (cacheRead > 0) lower-bounds the lifetime, a hard miss upper-bounds it.
 * Both sides are one-sided censored samples of the cache lifetime, so per
 * (api, provider, model, tier) we fit a 2-parameter logistic warmth curve
 * P(hit | gap) on log-gap: the p=0.5 crossing is the learned TTL and the
 * slope is the provider's cache *reliability* (a deterministic server-side
 * TTL produces a cliff; best-effort eviction produces a shallow slope).
 *
 * Fitting is a batch weighted ridge logistic regression (Newton) over a
 * bounded sliding window — 200 observations or 45 days per identity, with a
 * 14-day exponential half-life so provider behavior drift washes out — with
 * an L2 prior anchored on the built-in ladder. A learned policy activates
 * only with enough decayed support, both outcomes observed, and the crossing
 * bracketed by real hits and misses; until then (and for documented 'fixed'
 * retentions, and whenever a user cacheTtlOverrides rule matches) the
 * built-in projection stands.
 *
 * Ingestion rides the session indexer: full parses call
 * observeCacheLifetimeFromEntries, O(delta) extensions call
 * extendCacheLifetimeFromEntries. Observations dedup by (file, timestamp) so
 * a restart's full re-parse after unpersisted in-memory extensions is
 * idempotent. State persists to ~/.pi/dish/cache-lifetime.json (tmp+rename),
 * resolved per call like the other host stores so tests' temp HOMEs work.
 */
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const cache_retention_1 = require("./cache-retention");
const session_metadata_1 = require("./session-metadata");
const STORE_VERSION = 1;
const WINDOW_MAX_OBS = 200;
const WINDOW_MAX_AGE_MS = 45 * 24 * 60 * 60_000;
const HALF_LIFE_MS = 14 * 24 * 60 * 60_000;
const RIDGE = 3;
const PRIOR_SLOPE = -6;
const FALLBACK_PRIOR_TTL_MS = 10 * 60_000;
const MIN_EFFECTIVE_OBS = 20;
const MIN_EFFECTIVE_OUTCOMES = 3;
const MIN_SLOPE = 0.5;
// The crossing must be covered by real data on both sides, loosely: a clean
// deterministic cliff is separable (max hit gap < min miss gap), so exact
// bracketing would never activate. A factor two still rejects crossings
// extrapolated past anything the user's usage pattern ever probed.
const BRACKET_TOLERANCE = 2;
const BRIER_ALPHA = 0.15;
const REFIT_MS = 60_000;
const MAX_CHAINS = 5000;
const TIER_1H_SUFFIX = '\u00001h';
const stores = new Map();
/** Per-file last cache-active anchor: identity -> { ts, tier1h } of the entry being probed. */
const chains = new Map();
function storeFile() {
    return node_path_1.default.join(node_os_1.default.homedir(), '.pi', 'dish', 'cache-lifetime.json');
}
function decodeObservations(value) {
    if (!Array.isArray(value))
        return [];
    const obs = [];
    for (const raw of value) {
        if (!Array.isArray(raw))
            continue;
        const [t, gap, hit, fh] = raw;
        if (typeof t !== 'number' || !Number.isFinite(t) || typeof gap !== 'number' ||
            !Number.isFinite(gap) || gap <= 0 || (hit !== 0 && hit !== 1) ||
            typeof fh !== 'string' || fh.length > 16)
            continue;
        obs.push({ t, gap, hit: hit === 1, fh });
    }
    return obs.slice(-WINDOW_MAX_OBS);
}
function decodeStore(value) {
    const identities = new Map();
    const rawIdentities = (0, session_metadata_1.isRecord)(value) && (0, session_metadata_1.isRecord)(value.identities) ? value.identities : null;
    if (!rawIdentities)
        return identities;
    const now = Date.now();
    for (const [key, raw] of Object.entries(rawIdentities)) {
        if (key.length > 500 || !(0, session_metadata_1.isRecord)(raw))
            continue;
        const obs = decodeObservations(raw.obs).filter(o => now - o.t <= WINDOW_MAX_AGE_MS);
        if (!obs.length)
            continue;
        identities.set(key, {
            obs, keys: new Set(obs.map(o => `${o.fh}:${o.t}`)),
            brier: typeof raw.brier === 'number' && Number.isFinite(raw.brier) ? raw.brier : NaN,
            brierN: typeof raw.brierN === 'number' && Number.isFinite(raw.brierN) ? raw.brierN : 0,
            fit: null, fitDirty: true, fitAt: 0,
        });
    }
    return identities;
}
function getStore() {
    const file = storeFile();
    let stamp = 'missing';
    try {
        const stats = node_fs_1.default.statSync(file);
        stamp = `${stats.mtimeMs}:${stats.size}`;
    }
    catch { }
    const existing = stores.get(file);
    if (existing && existing.stamp === stamp)
        return existing;
    let parsed = null;
    try {
        parsed = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
    }
    catch { }
    const store = { stamp, identities: decodeStore(parsed), dirty: false };
    stores.set(file, store);
    return store;
}
/** Persist observations when the indexer dirtied them; tmp+rename, last writer wins. */
function flushCacheLifetime() {
    const file = storeFile();
    const store = stores.get(file);
    if (!store?.dirty)
        return;
    const identities = {};
    for (const [key, state] of store.identities) {
        if (!state.obs.length)
            continue;
        identities[key] = {
            obs: state.obs.map(o => [o.t, o.gap, o.hit ? 1 : 0, o.fh]),
            ...(Number.isFinite(state.brier) ? { brier: state.brier, brierN: state.brierN } : {}),
        };
    }
    try {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        node_fs_1.default.writeFileSync(tmp, JSON.stringify({ version: STORE_VERSION, identities }) + '\n');
        node_fs_1.default.renameSync(tmp, file);
        const stats = node_fs_1.default.statSync(file);
        store.stamp = `${stats.mtimeMs}:${stats.size}`;
        store.dirty = false;
    }
    catch { }
}
/**
 * Weighted ridge logistic fit of P(hit | gap) = σ(α + β·ln gap). Newton
 * iterations on the 2-parameter model; the L2 prior pulls toward a steep
 * cliff at the built-in ladder's TTL so sparse data shrinks to the status
 * quo instead of extrapolating.
 */
function fitObservations(obs, now, priorTtlMs) {
    if (obs.length < 4)
        return null;
    const points = [];
    for (const o of obs) {
        const w = 2 ** (-(now - o.t) / HALF_LIFE_MS);
        if (w > 1e-6)
            points.push({ x: Math.log(o.gap), y: o.hit ? 1 : 0, w });
    }
    if (points.length < 4)
        return null;
    const alpha0 = -PRIOR_SLOPE * Math.log(priorTtlMs);
    let alpha = alpha0, beta = PRIOR_SLOPE;
    for (let iter = 0; iter < 40; iter++) {
        let g0 = RIDGE * (alpha - alpha0), g1 = RIDGE * (beta - PRIOR_SLOPE);
        let h00 = RIDGE, h01 = 0, h11 = RIDGE;
        for (const p of points) {
            const pr = 1 / (1 + Math.exp(-(alpha + beta * p.x)));
            const r = p.w * (pr - p.y);
            const q = p.w * pr * (1 - pr);
            g0 += r;
            g1 += r * p.x;
            h00 += q;
            h01 += q * p.x;
            h11 += q * p.x * p.x;
        }
        const det = h00 * h11 - h01 * h01;
        if (!(Math.abs(det) > 1e-12))
            break;
        const d0 = (h11 * g0 - h01 * g1) / det;
        const d1 = (h00 * g1 - h01 * g0) / det;
        alpha -= d0;
        beta -= d1;
        if (Math.abs(d0) + Math.abs(d1) < 1e-9)
            break;
    }
    if (!Number.isFinite(alpha) || !Number.isFinite(beta) || beta >= -1e-6)
        return null;
    const ttlMs = Math.exp(-alpha / beta);
    let effN = 0, effHits = 0, warmHits = 0, warmTotal = 0;
    let minMissGap = Infinity, maxHitGap = 0;
    for (const p of points) {
        const gap = Math.exp(p.x);
        effN += p.w;
        if (p.y === 1) {
            effHits += p.w;
            if (gap > maxHitGap)
                maxHitGap = gap;
        }
        else if (gap < minMissGap)
            minMissGap = gap;
        if (gap <= ttlMs) {
            warmTotal += p.w;
            warmHits += p.w * p.y;
        }
    }
    return { alpha, beta, ttlMs, effN, effHits, effMisses: effN - effHits,
        warmHits, warmTotal, minMissGap, maxHitGap };
}
function fitActive(fit) {
    return fit.effN >= MIN_EFFECTIVE_OBS && fit.effHits >= MIN_EFFECTIVE_OUTCOMES &&
        fit.effMisses >= MIN_EFFECTIVE_OUTCOMES && fit.beta <= -MIN_SLOPE &&
        fit.ttlMs >= cache_retention_1.MIN_TTL_MS && fit.ttlMs <= cache_retention_1.MAX_TTL_MS &&
        fit.minMissGap <= fit.ttlMs * BRACKET_TOLERANCE && fit.maxHitGap * BRACKET_TOLERANCE >= fit.ttlMs;
}
function fitStats(fit, brier) {
    return {
        observations: Math.round(fit.effN * 100) / 100,
        warmHitRate: fit.warmTotal >= MIN_EFFECTIVE_OUTCOMES ? fit.warmHits / fit.warmTotal : null,
        brier,
        slope: Math.round(fit.beta * 1000) / 1000,
    };
}
function tierOf(key) {
    return key.endsWith(TIER_1H_SUFFIX) ? '1h' : null;
}
function identityOf(key) {
    return tierOf(key) ? key.slice(0, -TIER_1H_SUFFIX.length) : key;
}
function priorTtlFor(key) {
    const [api = '', provider = '', model = ''] = identityOf(key).split('\u0000');
    return (0, session_metadata_1.builtinCacheRetention)((0, session_metadata_1.resolveCacheTarget)({ api, provider, model }), tierOf(key) === '1h')?.retentionMs ??
        FALLBACK_PRIOR_TTL_MS;
}
function ensureFit(key, state, now) {
    if (state.fitDirty || now - state.fitAt > REFIT_MS) {
        state.fit = fitObservations(state.obs, now, priorTtlFor(key));
        state.fitDirty = false;
        state.fitAt = now;
    }
    return state.fit;
}
function recordObservation(key, obs, now) {
    const store = getStore();
    let state = store.identities.get(key);
    if (!state) {
        state = { obs: [], keys: new Set(), brier: NaN, brierN: 0, fit: null, fitDirty: true, fitAt: 0 };
        store.identities.set(key, state);
    }
    const dedupKey = `${obs.fh}:${obs.t}`;
    if (state.keys.has(dedupKey))
        return;
    // Calibration of the active policy *before* ingesting this probe.
    const fit = ensureFit(key, state, now);
    if (fit && fitActive(fit)) {
        const p = 1 / (1 + Math.exp(-(fit.alpha + fit.beta * Math.log(obs.gap))));
        const err = (p - (obs.hit ? 1 : 0)) ** 2;
        state.brier = Number.isFinite(state.brier) ? state.brier + BRIER_ALPHA * (err - state.brier) : err;
        state.brierN++;
    }
    state.obs.push(obs);
    state.keys.add(dedupKey);
    const cutoff = now - WINDOW_MAX_AGE_MS;
    while (state.obs.length > WINDOW_MAX_OBS || (state.obs.length && state.obs[0].t < cutoff)) {
        const dropped = state.obs.shift();
        state.keys.delete(`${dropped.fh}:${dropped.t}`);
    }
    state.fitDirty = true;
    store.dirty = true;
}
function extractObservations(entries, file, chain, profileId) {
    const fh = (0, node_crypto_1.createHash)('sha256').update(file).digest('hex').slice(0, 8);
    let currentModel = null;
    for (const raw of entries) {
        if (!(0, session_metadata_1.isRecord)(raw))
            continue;
        if (raw.type === 'compaction') {
            chain.clear();
            continue;
        }
        if (raw.type === 'model_change') {
            const model = profileId === 'omp-v1' ? raw.model : raw.modelId;
            if (typeof model === 'string' && model)
                currentModel = model;
            continue;
        }
        if (raw.type !== 'message')
            continue;
        const message = (0, session_metadata_1.isRecord)(raw.message) ? raw.message : null;
        if (message?.role !== 'assistant' || !(0, session_metadata_1.hasCacheActivity)(message))
            continue;
        const ts = new Date((message.timestamp ?? raw.timestamp)).getTime();
        if (!Number.isFinite(ts))
            continue;
        // Mirror accumulateSessionInfo: a message without a model inherits the
        // session's current one so both produce the same cache identity.
        const attributed = message.model === undefined && currentModel !== null
            ? { ...message, model: currentModel } : message;
        const target = (0, session_metadata_1.resolveCacheTarget)(attributed);
        if (!target.provider && !target.model)
            continue;
        const identity = (0, session_metadata_1.cacheIdentity)(attributed);
        const usage = message.usage;
        const anchor = chain.get(identity);
        if (anchor && ts > anchor.ts) {
            recordObservation(anchor.tier1h ? `${identity}${TIER_1H_SUFFIX}` : identity, { t: ts, gap: ts - anchor.ts, hit: (0, session_metadata_1.cacheTokens)(usage, 'cacheRead') > 0, fh }, Date.now());
        }
        // A write sets the probed entry's tier; a pure read leaves it unchanged.
        const wrote = (0, session_metadata_1.cacheTokens)(usage, 'cacheWrite') > 0;
        chain.set(identity, { ts, tier1h: wrote ? (0, session_metadata_1.cacheTier1h)(usage) : (anchor?.tier1h ?? false) });
    }
}
function trackChain(file) {
    const chain = new Map();
    chains.set(file, chain);
    if (chains.size > MAX_CHAINS)
        chains.delete(chains.keys().next().value);
    return chain;
}
/** Full parse: re-anchors the file's chains; per-(file,t) dedup keeps re-parses idempotent. */
function observeCacheLifetimeFromEntries(entries, file, profileId = 'pi-v3') {
    try {
        extractObservations(entries, file, trackChain(file), profileId);
    }
    catch { }
}
/** O(delta) extension: continues the file's chains from the indexed prefix. */
function extendCacheLifetimeFromEntries(entries, file, profileId = 'pi-v3') {
    try {
        extractObservations(entries, file, chains.get(file) ?? trackChain(file), profileId);
    }
    catch { }
}
function forgetCacheLifetimeFile(file) {
    chains.delete(file);
}
function learnedPolicyFor(identity, tier) {
    const key = tier === '1h' ? `${identity}${TIER_1H_SUFFIX}` : identity;
    const state = getStore().identities.get(key);
    if (!state)
        return null;
    const fit = ensureFit(key, state, Date.now());
    if (!fit || !fitActive(fit))
        return null;
    return {
        retentionMs: fit.ttlMs,
        retention: formatLearnedRetention(fit.ttlMs),
        basis: 'learned',
        stats: fitStats(fit, state.brier),
    };
}
function formatLearnedRetention(ms) {
    const minutes = ms / 60_000;
    if (minutes < 90)
        return `~${Math.max(1, Math.round(minutes))}m`;
    const hours = ms / (60 * 60_000);
    if (hours < 48)
        return `~${Math.round(hours * 10) / 10}h`;
    return `~${Math.round(hours / 2.4) / 10}d`;
}
/**
 * Serve-time overlay: substitute an active learned TTL for built-in
 * 'estimate'/'minimum' projections. Documented 'fixed' retentions and user
 * cacheTtlOverrides rules always win; the learner only replaces guesses.
 */
function applyLearnedCacheExpiry(expiry, config = (0, cache_retention_1.loadCacheRetentionConfig)()) {
    if (!expiry || expiry.basis === 'fixed')
        return expiry;
    const [api = '', provider = '', model = ''] = expiry.identity.split('\u0000');
    const target = (0, session_metadata_1.resolveCacheTarget)({ api, provider, model });
    if ((0, cache_retention_1.configuredCacheRetention)(config, target.provider, target.model))
        return expiry;
    const learned = learnedPolicyFor(expiry.identity, expiry.tier);
    if (!learned)
        return expiry;
    return { ...expiry, retentionMs: learned.retentionMs, retention: learned.retention,
        expiresAt: expiry.refreshedAt + learned.retentionMs, basis: 'learned' };
}
/** Per-identity fitted state for diagnostics and the provider-stats surface. */
function cacheLifetimeSnapshot() {
    const store = getStore();
    const now = Date.now();
    const out = [];
    for (const [key, state] of store.identities) {
        if (!state.obs.length)
            continue;
        const fit = ensureFit(key, state, now);
        const active = !!fit && fitActive(fit);
        out.push({
            key, identity: identityOf(key), tier: tierOf(key),
            active, ttlMs: fit ? Math.round(fit.ttlMs) : null,
            retention: fit && active ? formatLearnedRetention(fit.ttlMs) : null,
            stats: fit ? fitStats(fit, state.brier) : null,
            rawObservations: state.obs.length,
        });
    }
    return out;
}
function resetCacheLifetimeForTests() {
    stores.clear();
    chains.clear();
}
