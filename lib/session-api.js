// Generated from src/core/session-api.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeSessionRow = decodeSessionRow;
exports.decodeSessionMutationPatch = decodeSessionMutationPatch;
exports.decodeSessionActivityPatch = decodeSessionActivityPatch;
exports.decodeSessionTranscriptPatch = decodeSessionTranscriptPatch;
exports.decodeSessionMetadata = decodeSessionMetadata;
exports.decodeSessionList = decodeSessionList;
exports.sessionForClient = sessionForClient;
exports.normalizeModels = normalizeModels;
exports.decodeModelCatalog = decodeModelCatalog;
exports.decodeMutationResult = decodeMutationResult;
exports.decodeThinkingResult = decodeThinkingResult;
exports.decodeEnabledModelsResult = decodeEnabledModelsResult;
exports.thinkingResult = thinkingResult;
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value) { return typeof value === 'string' && value.length > 0; }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function invalid(kind) { throw new Error(`Invalid ${kind} response`); }
const optionalString = (value) => typeof value === 'string' ? value : undefined;
const nullableString = (value) => value === null ? null : optionalString(value);
const optionalNumber = (value) => finite(value) ? value : undefined;
const optionalBoolean = (value) => typeof value === 'boolean' ? value : undefined;
const fieldDecoders = {
    name: nullableString, model: nullableString, thinkingLevel: nullableString,
    harnessId: optionalString, harnessLabel: optionalString, capabilities: decodeCapabilities,
    isActive: optionalBoolean, closeMode: optionalString, conflicted: optionalBoolean,
    liveInstanceCount: optionalNumber, contextPercent: optionalNumber, contextTokens: optionalNumber,
    contextWindow: optionalNumber, messageCount: optionalNumber,
    lastActivity: value => value === null || typeof value === 'string' || finite(value) ? value : undefined,
    turnInProgress: optionalBoolean, compacting: optionalBoolean, cwd: nullableString,
    subagentLive: optionalBoolean, parentId: nullableString, parentSource: nullableString,
    familyParentId: nullableString, routine: optionalString, routineId: optionalString,
    routineInvocationId: optionalString, searchSnippet: optionalString, searchScore: optionalNumber,
};
function decodeCapabilities(value) {
    if (value === undefined)
        return undefined;
    if (!record(value))
        return invalid('session capabilities');
    const capabilities = {};
    for (const [key, enabled] of Object.entries(value)) {
        if (typeof enabled !== 'boolean')
            return invalid('session capabilities');
        Object.defineProperty(capabilities, key, { value: enabled, enumerable: true, configurable: true, writable: true });
    }
    return capabilities;
}
function decodeFields(value) {
    const fields = {};
    for (const key of Object.keys(fieldDecoders)) {
        if (!Object.hasOwn(value, key))
            continue;
        const decoded = fieldDecoders[key](value[key]);
        if (decoded !== undefined)
            Object.defineProperty(fields, key, { value: decoded, enumerable: true, configurable: true, writable: true });
    }
    return fields;
}
/**
 * Browser ingress. Keep the established fatal control checks; malformed
 * newly named presentation fields are omitted, never smuggled into extras.
 * This accepts serialized wire timestamps. Server Date projection stays separate.
 */
function decodeSessionRow(value) {
    if (!record(value) || !Object.hasOwn(value, 'id'))
        return invalid('session');
    validateSessionControls(value);
    const wire = value;
    const extras = {};
    for (const [key, extra] of Object.entries(wire)) {
        if (key === 'id' || key === 'host' || key === 'hostLabel' || Object.hasOwn(fieldDecoders, key))
            continue;
        Object.defineProperty(extras, key, { value: extra, enumerable: true, configurable: true, writable: true });
    }
    return { id: wire.id, fields: decodeFields(wire), extras };
}
function decodePatch(value, keys) {
    if (!record(value))
        return invalid('session patch');
    // Every selected property is optional; values enter only through its decoder.
    const patch = {};
    for (const key of keys) {
        if (!Object.hasOwn(value, key) || value[key] === undefined)
            continue;
        const decoded = fieldDecoders[key](value[key]);
        if (decoded === undefined)
            return invalid('session patch');
        Object.defineProperty(patch, key, { value: decoded, enumerable: true, configurable: true, writable: true });
    }
    return patch;
}
function decodeSessionMutationPatch(value) {
    return decodePatch(value, ['name', 'model', 'thinkingLevel']);
}
function decodeSessionActivityPatch(value) {
    return decodePatch(value, ['turnInProgress', 'compacting']);
}
function decodeSessionTranscriptPatch(value) {
    return decodePatch(value, ['name', 'model', 'cwd', 'messageCount', 'contextTokens', 'contextWindow', 'contextPercent', 'lastActivity', 'isActive']);
}
function validateSessionControls(value) {
    if (!record(value) || !text(value.id))
        return invalid('session');
    for (const key of ['name', 'model', 'thinkingLevel']) {
        if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string')
            return invalid('session');
    }
    if (value.harnessId !== undefined && !text(value.harnessId))
        return invalid('session');
    if (value.isActive !== undefined && typeof value.isActive !== 'boolean')
        return invalid('session');
}
function decodeSessionMetadata(value) {
    validateSessionControls(value);
    const capabilities = decodeCapabilities(value.capabilities);
    // The checks establish every named property; extras are deliberately unknown.
    return { ...value, ...(capabilities ? { capabilities } : {}) };
}
function decodeSessionList(value) {
    if (!record(value) || !Array.isArray(value.active) || !Array.isArray(value.previous)
        || (value.children !== undefined && !Array.isArray(value.children)))
        return invalid('session list');
    return { active: value.active.map(decodeSessionRow), previous: value.previous.map(decodeSessionRow),
        ...(Array.isArray(value.children) ? { children: value.children.map(decodeSessionRow) } : {}),
        ...(typeof value.indexing === 'boolean' ? { indexing: value.indexing } : {}),
        ...(typeof value.discoveryTruncated === 'boolean' ? { discoveryTruncated: value.discoveryTruncated } : {}),
        ...(finite(value.discoverySkipped) ? { discoverySkipped: value.discoverySkipped } : {}) };
}
function sessionForClient(session) {
    // Catalog rows have already established named metadata. This is only a wire
    // projection: preserve Date values until JSON serialization and opaque extras.
    const { sessionKey, nativeSessionId, profileId, profileVersion, sessionFile, parentSession, parentSessionSource, pid, ...client } = session;
    return client;
}
function pricing(value) {
    if (!record(value) || !finite(value.input) || !finite(value.output))
        return null;
    return { input: value.input, output: value.output,
        ...(finite(value.cacheRead) ? { cacheRead: value.cacheRead } : {}),
        ...(finite(value.cacheWrite) ? { cacheWrite: value.cacheWrite } : {}) };
}
const THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
/** Harness model discovery accepts native refs/records, then projects API rows. */
function normalizeModels(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((item) => {
        if (typeof item === 'string') {
            const slash = item.indexOf('/');
            if (slash <= 0 || slash === item.length - 1)
                return [];
            const provider = item.slice(0, slash), id = item.slice(slash + 1);
            return [{ id, provider, name: id, selector: item, contextWindow: 0,
                    reasoning: false, thinking: null, pricing: null, free: false }];
        }
        if (!record(item))
            return [];
        const id = item.id || item.modelId;
        if (!text(id) || !text(item.provider))
            return [];
        const cost = pricing(item.pricing || item.cost);
        return [{ id, provider: item.provider, name: text(item.name) ? item.name : id,
                selector: text(item.selector) ? item.selector : `${item.provider}/${id}`,
                contextWindow: finite(item.contextWindow) ? item.contextWindow : 0,
                reasoning: !!item.reasoning,
                thinking: Array.isArray(item.thinking) ? item.thinking.filter((level) => typeof level === 'string' && THINKING_LEVELS.has(level)) : null,
                pricing: cost, free: !!cost && cost.input === 0 && cost.output === 0 }];
    });
}
/** Decode API/catalog-cache rows, preserving extra metadata and optional legacy fields. */
function decodeModelCatalog(value) {
    if (!Array.isArray(value))
        return invalid('model catalog');
    return value.map((item) => {
        if (!record(item) || !text(item.id) || !text(item.provider))
            return invalid('model catalog');
        if (item.enabled !== undefined && typeof item.enabled !== 'boolean')
            return invalid('model catalog');
        if (item.selector !== undefined && item.selector !== null && typeof item.selector !== 'string')
            return invalid('model catalog');
        const model = normalizeModels([item])[0];
        return { ...item, ...model, ...(item.enabled === undefined ? {} : { enabled: item.enabled }) };
    });
}
function decodeMutationResult(value) {
    if (!record(value) || value.success !== true)
        return invalid('mutation');
    return { ...value, success: true };
}
function decodeThinkingResult(value) {
    const result = decodeMutationResult(value);
    if (!text(result.level))
        return invalid('thinking');
    return { ...result, level: result.level };
}
function decodeEnabledModelsResult(value) {
    const result = decodeMutationResult(value);
    if (result.enabledModels !== null && (!Array.isArray(result.enabledModels) || !result.enabledModels.every(text)))
        return invalid('enabled models');
    return { ...result, enabledModels: result.enabledModels === null ? null : [...result.enabledModels] };
}
/** A harness can acknowledge the mutation without reporting a usable level. */
function thinkingResult(value, requested) {
    return { success: true, level: record(value) && text(value.level) ? value.level : requested };
}
