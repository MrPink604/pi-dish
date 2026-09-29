// Generated from src/core/helper-usage-math.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USAGE_TOKEN_KEYS = exports.USAGE_COST_KEYS = void 0;
exports.addKnownUsageCost = addKnownUsageCost;
exports.addUsageTokens = addUsageTokens;
exports.addUsageCosts = addUsageCosts;
exports.addUsageUnavailable = addUsageUnavailable;
exports.addUsageCount = addUsageCount;
exports.addUsage = addUsage;
exports.usageDisplayTokens = usageDisplayTokens;
exports.compareUsageBuckets = compareUsageBuckets;
exports.compareUsageModels = compareUsageModels;
const helper_values_1 = require("./helper-values");
exports.USAGE_COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
exports.USAGE_TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
/** Unknown amounts leave the known subtotal (including an absent subtotal) alone. */
function addKnownUsageCost(to, from) {
    return (0, helper_values_1.finite)(from) ? ((0, helper_values_1.finite)(to) ? to : 0) + from : to;
}
function addUsageTokens(to, from) {
    for (const key of exports.USAGE_TOKEN_KEYS)
        to[key] += from?.[key] || 0;
}
function addUsageCosts(to, from) {
    for (const key of exports.USAGE_COST_KEYS)
        to[key] = addKnownUsageCost(to[key], from?.[key]);
}
function addUsageUnavailable(to, from) {
    for (const key of exports.USAGE_COST_KEYS)
        to[key] += from?.[key] || 0;
}
/** Sparse model/headline counts start from zero rather than requiring a full record. */
function addUsageCount(to, from) {
    return (to || 0) + (from || 0);
}
/** Full response buckets only; weekly/model projections use the smaller primitives. */
function addUsage(to, from) {
    if (!from)
        return to;
    addUsageTokens(to.tokens, from.tokens);
    addUsageCosts(to.costs, from.costs);
    addUsageUnavailable(to.costUnavailable, from.costUnavailable);
    to.calls += from.calls || 0;
    to.measured += from.measured || 0;
    to.durationMs += from.durationMs || 0;
    to.slowestMs = Math.max(to.slowestMs, from.slowestMs || 0);
    return to;
}
/** Displayed totals deliberately exclude reasoning tokens. */
function usageDisplayTokens(tokens) {
    return (tokens?.input || 0) + (tokens?.output || 0) + (tokens?.cacheRead || 0) + (tokens?.cacheWrite || 0);
}
function compareKnownCosts(a, b) {
    const aKnown = (0, helper_values_1.finite)(a), bKnown = (0, helper_values_1.finite)(b);
    if (aKnown !== bKnown)
        return Number(bKnown) - Number(aKnown);
    return aKnown && bKnown ? b - a : 0;
}
function compareUsageBuckets(a, b, sort) {
    return (sort === 'tokens'
        ? usageDisplayTokens(b.tokens) - usageDisplayTokens(a.tokens)
        : compareKnownCosts(a.costs?.total, b.costs?.total)) || b.calls - a.calls;
}
function compareUsageModels(a, b) {
    return compareKnownCosts(a.cost, b.cost) || b.calls - a.calls;
}
