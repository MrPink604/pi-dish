// Generated from src/core/harness-pricing.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATALOG_MAX_AGE_MS = void 0;
exports.refreshHarnessPricing = refreshHarnessPricing;
exports.pricingRevision = pricingRevision;
exports.createUsageCostEstimator = createUsageCostEstimator;
exports.estimateUsageCost = estimateUsageCost;
exports.isPlanProvider = isPlanProvider;
exports.resetForTests = resetForTests;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const dish_store_1 = require("./dish-store");
const harnesses_1 = require("./harnesses");
const harness_feature_commands_1 = require("./harness-feature-commands");
const YAML = __importStar(require("yaml"));
const pi_sdk_1 = require("./pi-sdk");
const helper_values_1 = require("./helper-values");
// A snapshot older than six hours is refreshed on the next pricing-backed
// request, but stays the last-known source if the refresh fails.
exports.CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FAILED_REFRESH_RETRY_MS = 5 * 60 * 1000;
const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const PRICED_HARNESSES = { pi: true, omp: true, agy: true };
// Subscription providers whose catalogs carry zero rates because there is no
// per-request price: a zero rate there is unpriced, not free (unlike genuinely
// free tiers, which keep their authoritative $0).
const ZAI_PLAN_PROVIDERS = { zai: true, 'zai-coding-cn': true };
const PLAN_PROVIDERS = {
    pi: ZAI_PLAN_PROVIDERS,
    omp: { ...ZAI_PLAN_PROVIDERS, 'kimi-code': true, 'google-antigravity': true, 'openai-codex': true },
    // An Antigravity subscription bills nothing per request: known models use the
    // API-equivalent rate card below, while unknown zero-rated rows remain unpriced.
    agy: { 'google-antigravity': true },
};
// API-equivalent list prices (USD per million tokens) for Antigravity models.
// `agy models` publishes no dollar rates because Antigravity is a subscription;
// these match public Google Gemini (and account) API rate cards so usage
// dashboards and session stats reflect API-equivalent value. Optional user
// overrides in `~/.pi/dish/pricing/agy.json` win over this built-in card.
const AGY_API_RATE_CARD = [
    // Gemini 4 family
    { provider: 'google-antigravity', id: 'gemini-4-neon', cost: { input: 3, output: 15, cacheRead: 0.15, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-4-carbon', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-4-argon', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-4-hydrogen', cost: { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0 } },
    // Gemini Pro Orchestrator variants
    { provider: 'google-antigravity', id: 'gemini-pro-orchestrator-neon', cost: { input: 3, output: 15, cacheRead: 0.15, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-pro-orchestrator', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-pro-orchestrator-argon', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } },
    // Gemini 3.x family
    { provider: 'google-antigravity', id: 'gemini-3.8-flash', cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3.7-flash', cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3.7-flash-tiered', cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3.6-flash', cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3.5-flash', cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3.5-flash-lite', cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3.1-pro-preview', cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3.1-flash-lite', cost: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3.1-flash-lite-preview', cost: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3.1-flash-image', cost: { input: 0.5, output: 60, cacheRead: 0.05, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3-flash', cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-3-flash-preview', cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 } },
    // Gemini 2.5 family
    { provider: 'google-antigravity', id: 'gemini-2.5-pro', cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-2.5-flash', cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 } },
    { provider: 'google-antigravity', id: 'gemini-2.5-flash-lite', cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 } },
    // Non-Gemini account models listed by `agy models`
    { provider: 'google-antigravity', id: 'claude-opus-5-5', cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
    { provider: 'google-antigravity', id: 'claude-sonnet-5-5', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } },
    { provider: 'google-antigravity', id: 'gpt-oss-120b', cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 } },
];
const AGY_API_RATE_CARD_LIST = [...AGY_API_RATE_CARD];
const AGY_API_RATE_CARD_REVISION = crypto.createHash('sha256').update(JSON.stringify(AGY_API_RATE_CARD_LIST)).digest('hex').slice(0, 16);
// Antigravity brain transcripts append `-<level>` to the base model id
// (e.g. `gemini-4-neon-xhigh`, `gemini-3.8-flash-low`).
const AGY_LEVEL_SUFFIX_RE = /-(?:minimal|low|medium|high|xhigh|max)$/;
const states = new Map();
// OMP's models.yml modelOverrides are the user's rate card. OMP drops
// override-only ids from its catalog, so pi-dish reads the file directly:
// user entries win and revive missing ids. Revalidated by full file stats.
const MODEL_OVERRIDES_FILE = { omp: path.join('.omp', 'agent', 'models.yml') };
const overridesCache = new Map();
// Catalog/override arrays are replaced, not mutated, on refresh. Index each
// snapshot once; repeated models in a catalog retain Array.find's first win.
const rateIndexes = new WeakMap();
function indexRates(models) {
    if (!models?.length)
        return undefined;
    let index = rateIndexes.get(models);
    if (!index) {
        const rates = new Map();
        for (const model of models) {
            const selector = `${model.provider}/${model.id}`;
            if (!rates.has(selector))
                rates.set(selector, model.cost);
        }
        index = rates;
        rateIndexes.set(models, index);
    }
    return index;
}
function loadModelOverrides(harnessId) {
    const rel = MODEL_OVERRIDES_FILE[harnessId];
    if (!rel)
        return [];
    const file = path.join(os.homedir(), rel);
    let stats;
    try {
        stats = fs.statSync(file);
    }
    catch {
        return [];
    }
    const cached = overridesCache.get(file);
    if (cached && cached.stats.mtimeMs === stats.mtimeMs && cached.stats.size === stats.size &&
        cached.stats.ctimeMs === stats.ctimeMs && cached.stats.dev === stats.dev && cached.stats.ino === stats.ino)
        return cached.entries;
    let entries = [];
    try {
        const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
        const providers = (0, helper_values_1.record)(doc) ? doc.providers : undefined;
        for (const [provider, section] of Object.entries((0, helper_values_1.record)(providers) || Array.isArray(providers) ? providers : {})) {
            const overrides = (0, helper_values_1.record)(section) ? section.modelOverrides : undefined;
            for (const [id, override] of Object.entries((0, helper_values_1.record)(overrides) || Array.isArray(overrides) ? overrides : {})) {
                const source = (0, helper_values_1.record)(override) ? override.cost : undefined;
                if (!(0, helper_values_1.record)(source) || !(0, helper_values_1.finite)(source.input) || !(0, helper_values_1.finite)(source.output))
                    continue;
                const cost = {};
                for (const key of COST_KEYS)
                    if ((0, helper_values_1.finite)(source[key]))
                        cost[key] = source[key];
                entries.push({ provider, id, cost });
            }
        }
    }
    catch {
        entries = [];
    } // a broken config must not break pricing
    overridesCache.set(file, { stats, entries });
    return entries;
}
function catalogFile(harnessId) {
    return path.join((0, dish_store_1.dishDir)(), 'pricing', `${harnessId}.json`);
}
function normalizeCatalog(raw) {
    const rows = Array.isArray(raw) ? raw : (0, helper_values_1.record)(raw) ? raw.models : undefined;
    if (!Array.isArray(rows))
        return null;
    const models = [];
    for (const model of rows) {
        if (!(0, helper_values_1.record)(model))
            continue;
        const provider = model.provider;
        const id = model.id || model.modelId;
        const source = model.cost || model.pricing;
        if (!provider || !id || !(0, helper_values_1.record)(source) || !(0, helper_values_1.finite)(source.input) || !(0, helper_values_1.finite)(source.output))
            continue;
        const cost = {};
        for (const key of COST_KEYS)
            if ((0, helper_values_1.finite)(source[key]))
                cost[key] = source[key];
        models.push({ provider, id, cost });
    }
    return models.length ? models : null;
}
function revisionFor(models) {
    return crypto.createHash('sha256').update(JSON.stringify(models)).digest('hex').slice(0, 16);
}
function loadState(harnessId) {
    const file = catalogFile(harnessId);
    const cached = states.get(file);
    if (cached)
        return cached;
    let snapshot = null;
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if ((0, helper_values_1.record)(raw)) {
            const models = normalizeCatalog(raw.models);
            if (models)
                snapshot = { updatedAt: Number(raw.updatedAt) || 0, models, revision: revisionFor(models) };
        }
    }
    catch { }
    const state = { snapshot, inFlight: null, lastAttemptAt: 0 };
    states.set(file, state);
    return state;
}
function persist(harnessId, snapshot) {
    (0, dish_store_1.replaceFile)(catalogFile(harnessId), JSON.stringify({ updatedAt: snapshot.updatedAt, models: snapshot.models }, null, 2) + '\n', 0o600);
}
async function runCatalogCommand(harnessId, force) {
    const descriptor = (0, harnesses_1.getHarness)(harnessId);
    if (!descriptor?.argv?.models?.length)
        throw new Error(`Harness ${harnessId} has no model catalog command`);
    const models = normalizeCatalog(await (0, harness_feature_commands_1.runHarnessModelCatalog)(descriptor, { force }));
    if (!models)
        throw new Error(`${descriptor.label} model catalog contained no priced models`);
    return models;
}
function loadCatalogModels(harnessId, force) {
    if (harnessId === 'pi') {
        return (0, pi_sdk_1.getPricingModels)().then((raw) => {
            const models = normalizeCatalog(raw);
            if (!models)
                throw new Error('Pi model registry contained no priced models');
            return models;
        });
    }
    return runCatalogCommand(harnessId, force);
}
function loadAgyOverrides() {
    const file = catalogFile('agy');
    let stats;
    try {
        stats = fs.statSync(file);
    }
    catch {
        return [];
    }
    const cached = overridesCache.get(file);
    if (cached && cached.stats.mtimeMs === stats.mtimeMs && cached.stats.size === stats.size &&
        cached.stats.ctimeMs === stats.ctimeMs && cached.stats.dev === stats.dev && cached.stats.ino === stats.ino)
        return cached.entries;
    let entries = [];
    try {
        entries = normalizeCatalog(JSON.parse(fs.readFileSync(file, 'utf8'))) || [];
    }
    catch {
        entries = [];
    } // a broken override file falls back to the built-in rate card
    overridesCache.set(file, { stats, entries });
    return entries;
}
async function refreshHarnessPricing(harnessId = 'omp', { force = false, now = Date.now() } = {}) {
    if (!Object.hasOwn(PRICED_HARNESSES, harnessId))
        return null;
    if (harnessId === 'agy') {
        const overrides = loadAgyOverrides();
        const models = overrides.length ? [...overrides, ...AGY_API_RATE_CARD_LIST] : AGY_API_RATE_CARD_LIST;
        return { updatedAt: now, models, revision: pricingRevision('agy') };
    }
    const state = loadState(harnessId);
    if (!force && state.snapshot && now - state.snapshot.updatedAt < exports.CATALOG_MAX_AGE_MS)
        return state.snapshot;
    if (!force && now - state.lastAttemptAt < FAILED_REFRESH_RETRY_MS)
        return state.snapshot;
    if (!state.inFlight) {
        state.lastAttemptAt = now;
        state.inFlight = loadCatalogModels(harnessId, force).then(models => {
            const snapshot = { updatedAt: now, models, revision: revisionFor(models) };
            persist(harnessId, snapshot);
            state.snapshot = snapshot;
            return snapshot;
        }).catch(() => state.snapshot).finally(() => { state.inFlight = null; });
    }
    return state.inFlight;
}
function pricingRevision(harnessId) {
    if (typeof harnessId !== 'string' || !Object.hasOwn(PRICED_HARNESSES, harnessId))
        return 'native';
    if (harnessId === 'agy') {
        const overrides = loadAgyOverrides();
        return overrides.length ? `${AGY_API_RATE_CARD_REVISION}+${revisionFor(overrides)}` : AGY_API_RATE_CARD_REVISION;
    }
    const base = loadState(harnessId).snapshot?.revision || 'missing';
    // Override edits must re-price the index through the normal revision
    // mismatch, even while the harness snapshot itself is unchanged.
    const overrides = loadModelOverrides(harnessId);
    return overrides.length ? `${base}+${revisionFor(overrides)}` : base;
}
/**
 * Capture rates once for a synchronous parse/scan. Never retain the estimator
 * across operations: each new operation must revalidate models.yml and use
 * the latest catalog snapshot. Message loops then do no filesystem work.
 */
function createUsageCostEstimator(harnessId) {
    if (typeof harnessId !== 'string' || !Object.hasOwn(PRICED_HARNESSES, harnessId))
        return () => undefined;
    if (harnessId === 'agy') {
        const overrides = indexRates(loadAgyOverrides());
        const catalog = indexRates(AGY_API_RATE_CARD_LIST);
        return (provider, model, usage) => {
            const selector = typeof model === 'string' && model.includes('/') ? model : `${provider}/${model}`;
            const baseSelector = AGY_LEVEL_SUFFIX_RE.test(selector) ? selector.replace(AGY_LEVEL_SUFFIX_RE, '') : null;
            const rates = overrides?.get(selector) || catalog?.get(selector)
                || (baseSelector ? (overrides?.get(baseSelector) || catalog?.get(baseSelector)) : undefined);
            return rates ? costAtRates(harnessId, provider, model, usage, rates) : undefined;
        };
    }
    const overrides = indexRates(loadModelOverrides(harnessId));
    const catalog = indexRates(loadState(harnessId).snapshot?.models);
    return (provider, model, usage) => {
        const selector = typeof model === 'string' && model.includes('/') ? model : `${provider}/${model}`;
        const rates = overrides?.get(selector) || catalog?.get(selector);
        return rates ? costAtRates(harnessId, provider, model, usage, rates) : undefined;
    };
}
function estimateUsageCost(harnessId, provider, model, usage) {
    return createUsageCostEstimator(harnessId)(provider, model, usage);
}
function costAtRates(harnessId, provider, model, usage, rates) {
    // Plan-provider entries deliberately use zero rates for subscription
    // access. They are not evidence that a request was free.
    const rateProvider = typeof model === 'string' && model.includes('/') ? model.split('/', 1)[0] : provider;
    if (isPlanProvider(harnessId, rateProvider) &&
        COST_KEYS.every(key => rates[key] === 0))
        return undefined;
    const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    for (const key of COST_KEYS) {
        const value = (0, helper_values_1.record)(usage) ? usage[key] : undefined;
        const tokens = (0, helper_values_1.finite)(value) ? value : 0;
        const rate = rates[key];
        if (!(0, helper_values_1.finite)(rate)) {
            if (tokens)
                return undefined;
            cost[key] = 0;
        }
        else
            cost[key] = tokens * rate / 1_000_000;
    }
    cost.total = COST_KEYS.reduce((sum, key) => sum + cost[key], 0);
    return cost;
}
function isPlanProvider(harnessId, provider) {
    // Unknown callers get Pi semantics; OMP also zero-rates Kimi, Antigravity and Codex.
    const providers = (harnessId != null && Object.hasOwn(PLAN_PROVIDERS, harnessId) && PLAN_PROVIDERS[harnessId]) || ZAI_PLAN_PROVIDERS;
    return typeof provider === 'string' && Object.hasOwn(providers, provider);
}
function resetForTests() { states.clear(); overridesCache.clear(); }
