// Generated from src/core/session-catalog.ts; edit that source and run npm run build:core.
"use strict";
const path = require("path");
const cache_lifetime_1 = require("./cache-lifetime");
const cache_retention_1 = require("./cache-retention");
const extension_ui_state_1 = require("./extension-ui-state");
const session_key_1 = require("./session-key");
const private_sessions_1 = require("./private-sessions");
const helper_values_1 = require("./helper-values");
const wire_protocol_1 = require("./wire-protocol");
const session_api_1 = require("./session-api");
const string = (value) => typeof value === 'string' ? value : null;
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const timestamp = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    || (value instanceof Date && Number.isFinite(value.getTime())) ? value : undefined;
function modelRef(value) {
    if (typeof value === 'string')
        return value || null;
    const model = (0, wire_protocol_1.asRecord)(value);
    const provider = string(model.provider);
    const id = string(model.id) || string(model.modelId);
    return provider && id ? `${provider}/${id}` : null;
}
function observation(kind, harnessId, claimedFile, fields, pid, context) {
    const key = (0, session_key_1.encodeSessionKey)(harnessId, context.nativeSessionId);
    const id = (0, session_key_1.canonicalSessionId)(key);
    const source = context.source;
    if (source && (source.harnessId !== harnessId || source.nativeSessionId !== context.nativeSessionId
        || source.sessionKey !== key || source.routeId !== id || source.file !== claimedFile)) {
        throw new TypeError('Live session source does not match its captured identity and file claim');
    }
    return { kind, harnessId, nativeSessionId: context.nativeSessionId, claimedFile, source, id,
        fields, pid, info: context.info, advice: context.advice };
}
/** Validate only the registry fields consumed by the catalog. Group selection,
 * conflicts and lifecycle advice remain with the registry/policy adapter. */
function registeredSessionObservation(value, context) {
    if (!(0, helper_values_1.record)(value))
        throw new TypeError('Invalid registered session observation');
    const usage = (0, wire_protocol_1.asRecord)(value.contextUsage);
    return observation('registered', context.harnessId, string(value.sessionFile), {
        name: string(value.name), model: string(value.model), thinkingLevel: string(value.thinkingLevel),
        fastMode: (0, session_api_1.decodeFastModeState)(value.fastMode) ?? null,
        contextTokens: number(usage.tokens), contextPercent: number(usage.percent),
        contextWindow: number(usage.contextWindow), lastActivity: timestamp(value.updatedAt),
        turnInProgress: value.turnInProgress === true, askPending: value.askPending === true, compacting: value.compacting === true,
        cwd: string(value.cwd),
    }, number(value.pid) ?? null, context);
}
/** RPC state and model objects enter as unknown, not as a handwritten signature
 * asserting that another module already validated their presentation fields. */
function rpcSessionObservation(value, context) {
    if (!(0, helper_values_1.record)(value))
        throw new TypeError('Invalid RPC session observation');
    const state = (0, wire_protocol_1.asRecord)(value.state);
    const usage = (0, wire_protocol_1.asRecord)((0, wire_protocol_1.asRecord)(value.lastStats).contextUsage);
    return observation('rpc', 'pi', string(value.sessionFile) || string(state.sessionFile), {
        name: string(state.sessionName) || string(state.name),
        model: modelRef(state.model) || modelRef(value.model), thinkingLevel: string(state.thinkingLevel),
        contextTokens: number(usage.tokens), contextPercent: number(usage.percent),
        contextWindow: number(usage.contextWindow) || number((0, wire_protocol_1.asRecord)(state.model).contextWindow),
        messageCount: number(state.messageCount), lastActivity: timestamp(value.lastActivityAt),
        turnInProgress: value.turnInProgress === true, askPending: (0, extension_ui_state_1.hasPendingAskDialog)(value.extUIState), compacting: value.compacting === true,
        cwd: string(value.cwd),
    }, number((0, wire_protocol_1.asRecord)(value.proc).pid) ?? null, context);
}
/** A live Prime daemon root: the roster supplies identity, model, activity and
 * busy state, while the transcript (when it exists) supplies history counters.
 * Only root agents reach here; RLM children stay silent helper semantics. */
function primeSessionObservation(value, context) {
    if (!(0, helper_values_1.record)(value))
        throw new TypeError('Invalid Prime daemon session observation');
    const state = (0, wire_protocol_1.asRecord)(value.state);
    const usage = (0, wire_protocol_1.asRecord)((0, wire_protocol_1.asRecord)(value.lastStats).contextUsage);
    return observation('prime', 'prime', string(value.sessionFile), {
        name: string(state.sessionName) || string(state.name),
        model: modelRef(state.model), thinkingLevel: string(state.thinkingLevel),
        contextTokens: number(usage.tokens), contextPercent: number(usage.percent), contextWindow: number(usage.contextWindow),
        lastActivity: timestamp(value.lastActivityAt),
        turnInProgress: value.turnInProgress === true, askPending: false, compacting: value.compacting === true,
        cwd: string(value.cwd),
    }, number((0, wire_protocol_1.asRecord)(value.summary).workerPid) ?? null, context);
}
/** Validate advisory store snapshots without migrating or granting authority to
 * those stores. Invalid records are ignored individually. */
function decodeLaunchParents(value) {
    const parents = new Map();
    if (!(0, helper_values_1.record)(value))
        return parents;
    for (const [child, raw] of Object.entries(value)) {
        if (!(0, helper_values_1.record)(raw))
            continue;
        try {
            parents.set((0, session_key_1.canonicalSessionId)(child), (0, session_key_1.canonicalSessionId)(raw.sourceSessionId));
        }
        catch { /* Invalid hint. */ }
    }
    return parents;
}
function decodeRoutineAnnotations(value) {
    const routines = new Map();
    if (!(value instanceof Map))
        return routines;
    for (const [sessionId, raw] of value) {
        if (!(0, helper_values_1.record)(raw) || typeof raw.routineName !== 'string'
            || typeof raw.routineId !== 'string' || typeof raw.id !== 'string')
            continue;
        try {
            routines.set((0, session_key_1.canonicalSessionId)(sessionId), {
                routine: raw.routineName, routineId: raw.routineId, routineInvocationId: raw.id,
            });
        }
        catch { /* Invalid hint. */ }
    }
    return routines;
}
/**
 * Context derivation stays read-time: model catalogs warm after indexing, and
 * a stored 'unknown' cache-expiry anchor must never reach a client.
 */
function withSessionContext(info, contextWindowForModel, cacheRetention) {
    const contextWindow = contextWindowForModel(info.model);
    const contextPercent = info.contextTokens > 0 ? Math.min(100, Math.floor(info.contextTokens / contextWindow * 100)) : 0;
    return { ...info, contextWindow, contextPercent, cacheExpiry: (0, cache_lifetime_1.applyLearnedCacheExpiry)(info.cacheExpiry, cacheRetention) };
}
function subsessionLabel(source) {
    if (!source?.parentSession)
        return null;
    const handle = path.basename(source.file, '.jsonl');
    return handle === 'session' ? null : handle;
}
function identityFields(harnessId, nativeSessionId, options) {
    const harness = options.harnesses.get(harnessId);
    if (!harness)
        throw new TypeError('Unknown catalog harness');
    const sessionKey = (0, session_key_1.encodeSessionKey)(harnessId, nativeSessionId);
    return { id: (0, session_key_1.canonicalSessionId)(sessionKey), sessionKey, harnessId, nativeSessionId, harnessLabel: harness.label };
}
function buildActiveSession(live, options) {
    const fields = live.fields;
    // Roster rows (bridge registry, Prime daemon) carry current name/model/busy
    // state; RPC children report their own state object instead.
    const registered = live.kind === 'registered' || live.kind === 'prime';
    const info = live.info ? withSessionContext(live.info, options.contextWindowForModel, options.cacheRetention) : null;
    const model = registered ? fields.model || info?.model : fields.model;
    const percent = registered ? fields.contextPercent ?? info?.contextPercent : fields.contextPercent;
    const parentSession = live.info?.parentSession || (registered ? live.source?.parentSession : null) || null;
    const harness = options.harnesses.get(live.harnessId);
    return {
        ...identityFields(live.harnessId, live.nativeSessionId, options),
        capabilities: { ...live.advice.capabilities }, closeMode: live.advice.closeMode,
        conflicted: live.advice.conflicted, liveInstanceCount: live.advice.liveInstanceCount || 1,
        name: (registered ? fields.name || info?.name : fields.name) || 'New Session',
        model: model || 'unknown', contextPercent: percent == null ? 0 : Math.round(percent * 10) / 10,
        contextTokens: (registered ? fields.contextTokens ?? info?.contextTokens : fields.contextTokens) ?? 0,
        contextWindow: (registered ? fields.contextWindow || options.contextWindowForModel(model) : fields.contextWindow) || 0,
        cacheExpiry: info?.cacheExpiry ?? null,
        thinkingLevel: fields.thinkingLevel || null,
        fastMode: registered ? fields.fastMode ?? null : null,
        messageCount: (registered ? info?.messageCount : fields.messageCount) || 0,
        lastActivity: registered ? info?.lastActivity || fields.lastActivity || new Date(0) : fields.lastActivity,
        isActive: true, turnInProgress: fields.turnInProgress === true, askPending: fields.askPending === true, compacting: fields.compacting === true,
        cwd: (registered ? fields.cwd || info?.cwd : fields.cwd) || null,
        sessionFile: live.claimedFile || null,
        parentSession,
        parentSessionSource: registered && !live.info?.parentSession && live.source?.parentSession ? 'omp-subsession-layout' : null,
        pid: live.pid || null,
        ...((0, private_sessions_1.isPrivateSessionFile)(harness, live.claimedFile || live.source?.file) ? { private: true } : {}),
    };
}
/** Fallback cwd from pi's session dir naming (--home-user-proj-- → /home/user/proj). */
function decodeDirToCwd(dirName) {
    const decoded = dirName.replace(/^--/, '').replace(/--$/, '');
    return '/' + decoded.replace(/-/g, '/');
}
function projectHistory(source, raw, advice, options, liveChild, dirName) {
    const info = withSessionContext(raw, options.contextWindowForModel, options.cacheRetention);
    let cwd = info.cwd;
    if (!cwd && dirName !== undefined && source.harnessId === 'pi' && options.harnesses.get('pi')?.layout === 'nested') {
        const decoded = decodeDirToCwd(dirName);
        cwd = options.directoryExists(decoded) ? decoded : null;
    }
    return {
        ...identityFields(source.harnessId, source.nativeSessionId, options),
        capabilities: { ...advice.capabilities, ...(liveChild ? { resume: false } : {}) }, closeMode: advice.closeMode,
        profileId: source.profileId, profileVersion: source.profileVersion,
        name: subsessionLabel(source) || info.name || source.nativeSessionId.slice(0, 8),
        model: info.model || 'unknown', contextPercent: info.contextPercent || 0, contextTokens: info.contextTokens || 0,
        cacheExpiry: info.cacheExpiry, messageCount: info.messageCount || 0, lastActivity: info.lastActivity, isActive: false,
        ...(liveChild ? { subagentLive: true } : {}),
        cwd, sessionFile: source.file, parentSession: info.parentSession || source.parentSession || null,
        parentSessionSource: !info.parentSession && source.parentSession ? 'omp-subsession-layout' : null,
        ...((0, private_sessions_1.isPrivateSessionFile)(options.harnesses.get(source.harnessId), source.file) ? { private: true } : {}),
    };
}
function buildSourceSession(source, info, advice, options) {
    return projectHistory(source, info, advice, options, false);
}
function buildHistoricalSession(history, options, projection = {}) {
    return projectHistory(history.source, history.info, history.advice, options, history.liveChild, projection.cwdFallback === false ? undefined : history.source.dirName);
}
function activityTime(session) {
    const value = session.lastActivity;
    return value instanceof Date ? value.getTime() : value === undefined ? NaN : new Date(value ?? 0).getTime();
}
function composeSessionCatalog(input, options) {
    options = { ...options, cacheRetention: options.cacheRetention ?? (0, cache_retention_1.loadCacheRetentionConfig)() };
    const active = [], previous = [], children = [];
    const seen = new Set();
    // A registered row owns the logical session even when the RPC snapshot was
    // collected first. Conflicted rows remain visible; advice already disables control.
    for (const kind of ['registered', 'prime', 'rpc']) {
        for (const live of input.active) {
            if (live.kind !== kind || seen.has(live.id))
                continue;
            const row = buildActiveSession(live, options);
            seen.add(row.id);
            active.push(row);
        }
    }
    for (const history of input.history) {
        if (seen.has(history.source.routeId) || (input.activeOnly && !history.liveChild))
            continue;
        const row = buildHistoricalSession(history, options, { cwdFallback: !input.activeOnly });
        seen.add(row.id);
        (input.activeOnly ? children : previous).push(row);
    }
    active.sort((a, b) => activityTime(b) - activityTime(a));
    previous.sort((a, b) => activityTime(b) - activityTime(a));
    const list = [...active, ...previous, ...children];
    const byId = new Map(list.map(session => [session.id, session]));
    const byPath = new Map();
    for (const session of list) {
        const canonical = options.canonicalPath(session.sessionFile);
        if (canonical)
            byPath.set(canonical, session);
    }
    for (const session of list) {
        let nativeParent = null;
        if (session.parentSession && session.sessionFile) {
            const parentFile = path.isAbsolute(session.parentSession) ? session.parentSession
                : path.resolve(path.dirname(session.sessionFile), session.parentSession);
            const canonical = options.canonicalPath(parentFile);
            nativeParent = canonical ? byPath.get(canonical)?.id || null : null;
        }
        const launchParent = input.launchParents.get(session.id) || null;
        const parentId = nativeParent || launchParent;
        session.parentId = parentId && parentId !== session.id ? parentId : null;
        session.parentSource = nativeParent ? session.parentSessionSource || 'pi-session-header'
            : launchParent ? 'pi-dish-launch' : null;
        const parent = parentId && parentId !== session.id ? byId.get(parentId) : undefined;
        session.familyParentId = parent && (parent.cwd || '~') === (session.cwd || '~') ? parent.id : null;
        const routine = input.routines.get(session.id);
        if (routine) {
            session.routine = routine.routine;
            session.routineId = routine.routineId;
            session.routineInvocationId = routine.routineInvocationId;
        }
    }
    return { list, active, previous, children, byId, byPath,
        indexing: input.indexing, discoveryTruncated: input.discoveryTruncated, discoverySkipped: input.discoverySkipped };
}
module.exports = {
    registeredSessionObservation, rpcSessionObservation, primeSessionObservation, decodeLaunchParents, decodeRoutineAnnotations,
    withSessionContext, subsessionLabel, buildActiveSession, buildSourceSession, buildHistoricalSession, composeSessionCatalog,
    decodeDirToCwd,
};
