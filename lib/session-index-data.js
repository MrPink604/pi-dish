// Generated from src/core/session-index-data.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSearchLeaf = checkSearchLeaf;
exports.finite = finite;
exports.decodeUsage = decodeUsage;
exports.decodeSkillState = decodeSkillState;
exports.decodeSkillRecords = decodeSkillRecords;
/** Persisted index projections and their consumed disk-ingress validation. */
const session_metadata_1 = require("./session-metadata");
/** Only tree identity remains untrusted after the typed parser's search projection. */
function checkSearchLeaf(value) {
    if (value.leafId !== null && typeof value.leafId !== 'string')
        throw new TypeError('Invalid search projection');
}
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function nullableString(value) { return value === null || typeof value === 'string'; }
function usageState(value) {
    return (0, session_metadata_1.isRecord)(value) && nullableString(value.provider) && typeof value.model === 'string';
}
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
const COUNTER_KEYS = ['calls', 'measured', 'durationMs', 'slowestMs'];
function numericFields(value, keys, required) {
    return (0, session_metadata_1.isRecord)(value) && keys.every(key => (!required && value[key] === undefined) || finite(value[key]));
}
function usageBucket(value) {
    return (0, session_metadata_1.isRecord)(value) &&
        COUNTER_KEYS.every(key => value[key] === undefined || finite(value[key])) &&
        (value.tokens === undefined || numericFields(value.tokens, TOKEN_KEYS, false)) &&
        (value.costs === undefined || numericFields(value.costs, COST_KEYS, false)) &&
        (value.costUnavailable === undefined || numericFields(value.costUnavailable, COST_KEYS, false));
}
function usageTotal(value) {
    return (0, session_metadata_1.isRecord)(value) && numericFields(value, COUNTER_KEYS, true) &&
        numericFields(value.tokens, TOKEN_KEYS, true) &&
        numericFields(value.costs, COST_KEYS, true) &&
        numericFields(value.costUnavailable, COST_KEYS, true);
}
function usageDays(value) {
    return (0, session_metadata_1.isRecord)(value) && Object.values(value).every(usageBucket);
}
function usageModel(value) {
    return (0, session_metadata_1.isRecord)(value) && usageBucket(value) &&
        typeof value.provider === 'string' && typeof value.model === 'string' && usageDays(value.days);
}
function indexedUsage(value) {
    return (0, session_metadata_1.isRecord)(value) && usageTotal(value.total) && usageDays(value.days) && (0, session_metadata_1.isRecord)(value.models) &&
        Object.values(value.models).every(usageModel) && nullableString(value.cwd) &&
        (value.state === undefined || usageState(value.state));
}
function decodeUsage(value) {
    // Retain absent legacy continuity and sparse day/model counters without
    // filling zeroes or copying the persisted buckets. Only state permits delta reads.
    return indexedUsage(value) ? value : null;
}
function decodeSkillState(value) {
    if (!(0, session_metadata_1.isRecord)(value) || !nullableString(value.cwd) || !usageState(value))
        return null;
    return { cwd: value.cwd, provider: value.provider, model: value.model };
}
function skillActivation(value) {
    if (!(0, session_metadata_1.isRecord)(value) || typeof value.skill !== 'string' || typeof value.file !== 'string' ||
        !(value.kind === 'read' || value.kind === 'targeted' || value.kind === 'explicit') ||
        !nullableString(value.sessionId) || !nullableString(value.entryId) || !nullableString(value.cwd) ||
        typeof value.model !== 'string' || !(value.ts === null || finite(value.ts)) ||
        !(value.truncatedTo === undefined || finite(value.truncatedTo)))
        return false;
    return value.ranges === null || value.ranges === 'all' ||
        (Array.isArray(value.ranges) && value.ranges.every(range => Array.isArray(range) && range.length === 2 && finite(range[0]) && finite(range[1])));
}
function decodeSkillRecords(value) {
    return Array.isArray(value) && value.every(skillActivation) ? value : null;
}
