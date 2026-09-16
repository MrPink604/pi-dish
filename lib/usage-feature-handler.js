// Generated from src/core/usage-feature-handler.ts; edit that source and run npm run build:core.
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
exports.createUsageSummaryHandler = createUsageSummaryHandler;
const session_discovery_1 = require("./session-discovery");
const harness_pricing_1 = require("./harness-pricing");
const sessionIndex = __importStar(require("./session-index"));
const USAGE_COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
const emptyUsage = () => ({
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    costUnavailable: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    calls: 0, measured: 0, durationMs: 0, slowestMs: 0,
});
function addUsage(to, from) {
    if (!from)
        return to;
    for (const k of Object.keys(to.tokens))
        to.tokens[k] += from.tokens?.[k] || 0;
    for (const k of USAGE_COST_KEYS) {
        to.costUnavailable[k] += from.costUnavailable?.[k] || 0;
        const value = from.costs?.[k];
        if (typeof value === 'number' && Number.isFinite(value)) {
            to.costs[k] = (Number.isFinite(to.costs[k]) ? to.costs[k] : 0) + value;
        }
    }
    for (const k of ['calls', 'measured', 'durationMs'])
        to[k] += from[k] || 0;
    to.slowestMs = Math.max(to.slowestMs, from.slowestMs || 0);
    return to;
}
function localDay(offset = 0) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function createUsageSummaryHandler(ports) {
    return async (req, res) => {
        const range = String(req.query.days || '30');
        if (!['1', '7', '30', 'all'].includes(range))
            return res.status(400).json({ error: 'days must be 1, 7, 30, or all' });
        const sort = String(req.query.sort || 'cost');
        if (!['cost', 'tokens'].includes(sort))
            return res.status(400).json({ error: 'sort must be cost or tokens' });
        // Multi-select model filter. It has to be applied here, not client-side:
        // the workspace/session groups are truncated to the top 20 below, and only
        // the per-session usage.models day buckets can rebuild their totals for a
        // subset of models. groups.models stays unfiltered — it is the facet list
        // the client toggles from. Headline KPIs stay global (fixed windows).
        const modelsRaw = req.query.models == null ? '' : String(req.query.models);
        if (modelsRaw.length > 4000)
            return res.status(400).json({ error: 'models filter too long' });
        const modelRefs = modelsRaw.split(',').map(s => s.trim()).filter(Boolean);
        if (modelRefs.length > 100)
            return res.status(400).json({ error: 'models filter lists too many models' });
        const modelFilter = modelRefs.length ? new Set(modelRefs) : null;
        await Promise.all(['pi', 'omp'].map(harnessId => (0, harness_pricing_1.refreshHarnessPricing)(harnessId)));
        const discovery = (0, session_discovery_1.discoverHarnessSessions)();
        const candidates = discovery.candidates;
        const scan = sessionIndex.scanSessions(candidates);
        const cutoff = range === 'all' ? null : localDay(Number(range) - 1);
        const totals = emptyUsage(), byModel = new Map(), byWorkspace = new Map(), bySession = new Map();
        const dailyMap = new Map(), dailyModels = new Map();
        const headlineUsage = { today: emptyUsage(), days7: emptyUsage(), days30: emptyUsage(), all: emptyUsage(), month: emptyUsage() };
        const now = new Date(), monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
        for (const c of candidates) {
            const info = scan.infos.get(c.file);
            if (!info?.usage)
                continue;
            const usage = info.usage;
            const selected = emptyUsage();
            for (const [day, bucket] of Object.entries(usage.days || {})) {
                const dated = day !== 'unknown';
                addUsage(headlineUsage.all, bucket);
                if (dated && day === localDay())
                    addUsage(headlineUsage.today, bucket);
                if (dated && day >= localDay(6))
                    addUsage(headlineUsage.days7, bucket);
                if (dated && day >= localDay(29))
                    addUsage(headlineUsage.days30, bucket);
                if (dated)
                    addUsage(dailyMap.get(day) || (dailyMap.set(day, emptyUsage()), dailyMap.get(day)), bucket);
                if (dated && day.startsWith(monthPrefix))
                    addUsage(headlineUsage.month, bucket);
                // Under a model filter the session's selected usage is rebuilt from its
                // per-model buckets below; the day buckets can't be split by model.
                if (!modelFilter && (!cutoff || (dated && day >= cutoff)))
                    addUsage(selected, bucket);
            }
            for (const [ref, bucket] of Object.entries(usage.models || {})) {
                const modelSelected = emptyUsage();
                if (bucket.days)
                    for (const [day, part] of Object.entries(bucket.days)) {
                        if (day !== 'unknown') {
                            const dayModels = dailyModels.get(day) || (dailyModels.set(day, new Map()), dailyModels.get(day));
                            addUsage(dayModels.get(ref) || (dayModels.set(ref, { provider: bucket.provider, model: bucket.model, ...emptyUsage() }), dayModels.get(ref)), part);
                        }
                        if (!cutoff || (day !== 'unknown' && day >= cutoff))
                            addUsage(modelSelected, part);
                    }
                else if (!cutoff)
                    addUsage(modelSelected, bucket); // schema-2 transitional safety
                if (modelSelected.calls) {
                    addUsage(byModel.get(ref) || (byModel.set(ref, { ...emptyUsage(), provider: bucket.provider, model: bucket.model }), byModel.get(ref)), modelSelected);
                    if (!modelFilter || modelFilter.has(ref)) {
                        if (modelFilter)
                            addUsage(selected, modelSelected);
                    }
                }
            }
            addUsage(totals, selected);
            if (selected.calls) {
                addUsage(byWorkspace.get(info.cwd || usage.cwd || '(unknown)') || (byWorkspace.set(info.cwd || usage.cwd || '(unknown)', emptyUsage()), byWorkspace.get(info.cwd || usage.cwd || '(unknown)')), selected);
                const routeId = c.routeId;
                bySession.set(routeId, {
                    id: routeId,
                    sessionKey: c.sessionKey,
                    harnessId: c.harnessId,
                    nativeSessionId: c.nativeSessionId,
                    name: info.name || c.nativeSessionId,
                    workspace: info.cwd || usage.cwd || null,
                    ...selected,
                });
            }
        }
        let unpricedModelCalls = 0;
        for (const [ref, b] of byModel) {
            b.priced = !b.costUnavailable.total;
            b.unpricedCalls = b.costUnavailable.total;
            // The bottom-of-view notice reflects the filtered totals; the facet list
            // keeps every model's own unavailable annotation.
            if (!modelFilter || modelFilter.has(ref))
                unpricedModelCalls += b.unpricedCalls;
        }
        for (const bucket of [...byWorkspace.values(), ...bySession.values()]) {
            bucket.priced = !bucket.costUnavailable.total;
            bucket.unpricedCalls = bucket.costUnavailable.total;
        }
        totals.unpricedCalls = unpricedModelCalls;
        // Rank by the same token total the client displays (reasoning stays out of
        // the sum there too), so the sorted order matches the numbers on screen.
        const displayedTokens = (t) => (t?.input || 0) + (t?.output || 0) + (t?.cacheRead || 0) + (t?.cacheWrite || 0);
        const compare = (a, b) => {
            if (sort === 'tokens')
                return displayedTokens(b.tokens) - displayedTokens(a.tokens) || b.calls - a.calls;
            const aKnown = Number.isFinite(a.costs?.total), bKnown = Number.isFinite(b.costs?.total);
            if (aKnown !== bKnown)
                return Number(bKnown) - Number(aKnown);
            return (bKnown ? b.costs.total - a.costs.total : 0) || b.calls - a.calls;
        };
        const top = (map) => [...map.entries()].map(([key, value]) => ({ key, ...value })).sort(compare).slice(0, 20);
        // The daily series spans the requested range (for 'all', from the earliest
        // dated usage, capped at a year) so the chart always reflects the selected
        // window. Each day carries a per-model breakdown so the client can stack the
        // chart by model and open day details without another request.
        const DAILY_SPAN_CAP = 365;
        let spanDays = range === 'all' ? 1 : Number(range);
        if (range === 'all') {
            let earliest = null;
            if (modelFilter) {
                for (const [day, models] of dailyModels) {
                    if ((!earliest || day < earliest) && [...models.keys()].some(ref => modelFilter.has(ref)))
                        earliest = day;
                }
            }
            else
                for (const day of dailyMap.keys())
                    if (!earliest || day < earliest)
                        earliest = day;
            if (earliest) {
                const [y, m, d] = earliest.split('-').map(Number);
                const start = new Date(y, m - 1, d, 12), today = new Date();
                today.setHours(12, 0, 0, 0);
                spanDays = Math.min(DAILY_SPAN_CAP, Math.max(1, Math.round((today.getTime() - start.getTime()) / 86400000) + 1));
            }
        }
        const daily = Array.from({ length: spanDays }, (_, i) => {
            const day = localDay(spanDays - 1 - i);
            const dayEntries = [...(dailyModels.get(day)?.entries() || [])]
                .filter(([ref]) => !modelFilter || modelFilter.has(ref));
            const models = dayEntries
                .map(([ref, b]) => ({ ref, provider: b.provider, model: b.model, calls: b.calls, cost: b.costs.total, costUnavailable: b.costUnavailable, tokens: b.tokens }))
                .sort((a, b) => Number(Number.isFinite(b.cost)) - Number(Number.isFinite(a.cost)) || (Number.isFinite(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls);
            if (!modelFilter)
                return { day, ...(dailyMap.get(day) || emptyUsage()), models };
            const dayTotal = emptyUsage();
            for (const [, b] of dayEntries)
                addUsage(dayTotal, b);
            return { day, ...dayTotal, models };
        });
        const headlineCosts = Object.fromEntries(Object.entries(headlineUsage).map(([key, bucket]) => [key, bucket.costs.total]));
        // Per-component twins of the headline scalars, so the client can pivot
        // every KPI into read/cached-read/output/cache-write buckets without
        // another request.
        const headlineCostsByBucket = Object.fromEntries(Object.entries(headlineUsage).map(([key, bucket]) => [key, bucket.costs]));
        const headlineCostUnavailable = Object.fromEntries(Object.entries(headlineUsage).map(([key, bucket]) => [key, bucket.costUnavailable.total]));
        res.json({ range, sort, models: modelFilter ? [...modelFilter] : null, totals, groups: { models: top(byModel), workspaces: top(byWorkspace), sessions: [...bySession.values()].sort(compare).slice(0, 20) }, headlineCosts, headlineCostsByBucket, headlineCostUnavailable, daily, unpricedModelCalls, indexing: scan.indexing, discoveryTruncated: discovery.truncated, discoverySkipped: discovery.skipped, monthlyBudgetUsd: ports.readDishSettings().monthlyBudgetUsd ?? null });
    };
}
