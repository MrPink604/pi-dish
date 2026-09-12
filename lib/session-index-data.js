// Generated from src/core/session-index-data.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finite = finite;
exports.decodeUsage = decodeUsage;
exports.decodeSkillState = decodeSkillState;
exports.decodeSkillRecords = decodeSkillRecords;
exports.checkedSkills = checkedSkills;
exports.checkedSearch = checkedSearch;
exports.checkedEntries = checkedEntries;
exports.checkedUsage = checkedUsage;
const session_metadata_1 = require("./session-metadata");
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function nullableString(value) { return value === null || typeof value === 'string'; }
function usageState(value) {
    return (0, session_metadata_1.isRecord)(value) && nullableString(value.provider) && typeof value.model === 'string';
}
function decodeUsage(value) {
    if (!(0, session_metadata_1.isRecord)(value) || !(0, session_metadata_1.isRecord)(value.total) || !(0, session_metadata_1.isRecord)(value.days) || !(0, session_metadata_1.isRecord)(value.models) ||
        !nullableString(value.cwd) || (value.state !== undefined && !usageState(value.state)))
        return null;
    // Keep bucket values and cost availability exactly as the JS projection wrote
    // them. Missing continuity is a valid old snapshot, but cannot be extended.
    return value;
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
function checkedSkills(value) {
    if (!(0, session_metadata_1.isRecord)(value))
        throw new TypeError('Invalid skill projection');
    const records = decodeSkillRecords(value.records);
    const state = decodeSkillState(value.state);
    if (!records || !state)
        throw new TypeError('Invalid skill projection');
    return { records, state };
}
function checkedSearch(value) {
    if (!(0, session_metadata_1.isRecord)(value) || typeof value.text !== 'string' || typeof value.tree !== 'boolean' ||
        !nullableString(value.leafId))
        throw new TypeError('Invalid search projection');
    return { text: value.text, tree: value.tree, leafId: value.leafId };
}
function checkedEntries(value) {
    if (!Array.isArray(value))
        throw new TypeError('Invalid parsed entries');
    const framing = Reflect.get(value, 'firstEntryOnFirstLine');
    if (framing !== undefined && typeof framing !== 'boolean')
        throw new TypeError('Invalid parsed framing');
    // Preserve the parser's array and physical-first-line marker without copying
    // entries or asserting a universal harness-event schema.
    return value;
}
function checkedUsage(value) {
    const result = decodeUsage(value);
    if (!result)
        throw new TypeError('Invalid usage projection');
    return result;
}
