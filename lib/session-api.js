// Generated from src/core/session-api.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
function decodeSessionMetadata(value) {
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
    let capabilities;
    if (value.capabilities !== undefined) {
        if (!record(value.capabilities))
            return invalid('session capabilities');
        capabilities = {};
        for (const [key, enabled] of Object.entries(value.capabilities)) {
            if (typeof enabled !== 'boolean')
                return invalid('session capabilities');
            Object.defineProperty(capabilities, key, { value: enabled, enumerable: true, configurable: true, writable: true });
        }
    }
    // The checks establish every named property; extras are deliberately unknown.
    return { ...value, ...(capabilities ? { capabilities } : {}) };
}
function decodeSessionList(value) {
    if (!record(value) || !Array.isArray(value.active) || !Array.isArray(value.previous)
        || (value.children !== undefined && !Array.isArray(value.children)))
        return invalid('session list');
    return { ...value, active: value.active.map(decodeSessionMetadata), previous: value.previous.map(decodeSessionMetadata),
        ...(Array.isArray(value.children) ? { children: value.children.map(decodeSessionMetadata) } : {}) };
}
/** Preserve the existing client projection; full API rows retain provenance. */
function sessionForClient(session) {
    const { sessionKey, nativeSessionId, profileId, profileVersion, sessionFile, parentSession, parentSessionSource, pid, ...client } = session;
    return decodeSessionMetadata(client);
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
