// Generated from src/core/session-catalog-runtime.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCatalogRuntime = createCatalogRuntime;
const fs = require("fs");
const path = require("path");
const bridge_session_1 = require("./bridge-session");
const rpc_session_1 = require("./rpc-session");
const harnesses_1 = require("./harnesses");
const session_capabilities_1 = require("./session-capabilities");
const prime_daemon_1 = require("./prime-daemon");
const tmux = require("./tmux");
const sessionIndex = require("./session-index");
const session_source_1 = require("./session-source");
const session_discovery_1 = require("./session-discovery");
const helper_query_js_1 = require("./helper-query.js");
const helper_refs_js_1 = require("./helper-refs.js");
const session_api_1 = require("./session-api");
const session_catalog_1 = require("./session-catalog");
const sessionProvenance = require("./session-provenance");
const routinesStore = require("./routines");
const session_ownership_1 = require("./session-ownership");
const wire_protocol_1 = require("./wire-protocol");
const MODEL_CONTEXT_WINDOWS = {
    // Claude 1M-context models (must come before the 200k family prefixes)
    'claude-opus-4-6': 1000000, 'claude-opus-4-7': 1000000, 'claude-sonnet-4-6': 1000000,
    'claude-opus-4': 200000, 'claude-sonnet-4': 200000, 'claude-haiku-4': 200000,
    'claude-3.5': 200000, 'claude-3': 200000,
    'gpt-4o': 128000, 'gpt-4-turbo': 128000, 'gpt-4': 8192,
    'o1': 200000, 'o3': 200000,
    'gemini-2': 1000000, 'gemini-1.5': 1000000,
    'default': 200000,
};
const DEFAULT_CONTEXT_WINDOW = MODEL_CONTEXT_WINDOWS.default;
// Longest prefix first so specific entries (claude-opus-4-7) beat generic ones
// (claude-opus-4). includes() matches Bedrock cross-region ids.
const CONTEXT_WINDOW_FALLBACKS = Object.entries(MODEL_CONTEXT_WINDOWS)
    .filter(([prefix]) => prefix !== 'default')
    .sort((a, b) => b[0].length - a[0].length);
const PRIME_ROSTER_STALE_MS = 1500;
const SUBSESSION_ROW_CAP = 64;
let modelsCache = null;
let modelsCacheTime = 0;
const contextWindowMemo = new Map();
function createCatalogRuntime(ports) {
    const { ownership, getLiveSession } = ports;
    const { getRPCSession, liveSubsessionCandidates, sessionSources } = ownership;
    let primeRosterReadAt = 0;
    let primeRosterSocket = null;
    function primeRosterIsStale(daemon) {
        return daemon.socketPath !== primeRosterSocket || Date.now() - primeRosterReadAt > PRIME_ROSTER_STALE_MS;
    }
    function loadPrimeRoster() {
        const daemon = (0, prime_daemon_1.getPrimeDaemon)();
        if (primeRosterIsStale(daemon)) {
            primeRosterReadAt = Date.now();
            primeRosterSocket = daemon.socketPath;
            daemon.refresh().catch(() => { });
        }
        return daemon.list();
    }
    async function refreshPrimeRoster() {
        const daemon = (0, prime_daemon_1.getPrimeDaemon)();
        if (!primeRosterIsStale(daemon))
            return;
        primeRosterReadAt = Date.now();
        primeRosterSocket = daemon.socketPath;
        try {
            await daemon.refresh();
        }
        catch { }
    }
    function observedSource(harnessId, nativeSessionId, file) {
        if (typeof file !== 'string' || !fs.existsSync(file))
            return { source: null, info: null };
        const source = (0, session_source_1.sourceForIdentity)(harnessId, nativeSessionId, file);
        try {
            return { source, info: sessionIndex.getSessionInfo(source) };
        }
        catch {
            return { source, info: null };
        }
    }
    function collectActiveObservations(registered = (0, bridge_session_1.listRegisteredSessions)()) {
        const active = [];
        const seen = new Set();
        const groups = new Map();
        for (const reg of registered) {
            const identity = (0, session_ownership_1.registryIdentity)(reg);
            if (!identity || !(0, harnesses_1.getHarness)(identity.harnessId))
                continue;
            const routeId = (0, session_ownership_1.routeSessionId)(identity.harnessId, identity.nativeSessionId);
            const group = groups.get(routeId) || [];
            group.push(reg);
            groups.set(routeId, group);
        }
        for (const [routeId, instances] of groups) {
            const conflicted = instances.length !== 1;
            const reg = instances.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
            const identity = (0, session_ownership_1.registryIdentity)(reg);
            const ownedSpawn = tmux.getSpawn(routeId);
            const closeMode = (0, harnesses_1.getHarness)(identity.harnessId).closeMode;
            const restartAllowed = (0, session_ownership_1.spawnAllowsRestart)(ownedSpawn, reg, closeMode);
            const { source, info } = observedSource(identity.harnessId, identity.nativeSessionId, reg.sessionFile);
            active.push((0, session_catalog_1.registeredSessionObservation)(reg, {
                ...identity, source, info,
                advice: {
                    capabilities: (0, session_capabilities_1.sessionCapabilities)(identity.harnessId, (0, wire_protocol_1.isRecord)(reg.capabilities) ? reg.capabilities : {}, {
                        active: true, conflicted,
                        closeAllowed: (0, session_ownership_1.spawnAllowsManagedClose)(ownedSpawn, reg, closeMode),
                        restartAllowed: !!getRPCSession(routeId)?.alive || restartAllowed,
                    }),
                    closeMode, conflicted, liveInstanceCount: instances.length,
                },
            }));
            seen.add(routeId);
        }
        for (const rpc of (0, rpc_session_1.getAllRPCSessions)()) {
            if (!rpc.alive || seen.has(rpc.id))
                continue;
            const { source, info } = observedSource('pi', rpc.id, rpc.sessionFile || rpc.state?.sessionFile);
            active.push((0, session_catalog_1.rpcSessionObservation)(rpc, {
                nativeSessionId: rpc.id, source, info,
                advice: {
                    capabilities: (0, session_capabilities_1.sessionCapabilities)('pi', {}, { active: true, restartAllowed: true }),
                    closeMode: (0, harnesses_1.getHarness)('pi').closeMode, conflicted: false, liveInstanceCount: 1,
                },
            }));
            seen.add(rpc.id);
        }
        // Prime 0.10+ roots exist only in the resident daemon roster, so this
        // projection is also where their lifecycle listeners get attached.
        for (const prime of loadPrimeRoster()) {
            const routeId = (0, session_ownership_1.routeSessionId)('prime', prime.nativeSessionId);
            if (seen.has(routeId))
                continue;
            ports.onPrimeSession?.(prime);
            const { source, info } = observedSource('prime', prime.nativeSessionId, prime.sessionFile);
            const authority = (0, session_ownership_1.primeLaunchAuthorityForRoute)(routeId);
            active.push((0, session_catalog_1.primeSessionObservation)(prime, {
                nativeSessionId: prime.nativeSessionId, source, info,
                advice: {
                    capabilities: (0, session_capabilities_1.sessionCapabilities)('prime', session_capabilities_1.PRIME_DAEMON_CAPABILITIES, {
                        active: true, conflicted: false,
                        closeAllowed: authority.closeAllowed, restartAllowed: authority.restartAllowed,
                    }),
                    closeMode: (0, harnesses_1.getHarness)('prime').closeMode, conflicted: false, liveInstanceCount: 1,
                },
            }));
            seen.add(routeId);
        }
        return active;
    }
    function canonicalSessionPath(file) {
        if (!file)
            return null;
        try {
            return fs.realpathSync(file);
        }
        catch {
            return path.resolve(file);
        }
    }
    const options = {
        harnesses: new Map((0, harnesses_1.listHarnesses)().map(descriptor => [descriptor.id, descriptor])),
        contextWindowForModel: getContextWindow,
        canonicalPath: canonicalSessionPath,
        directoryExists: directory => fs.existsSync(directory),
    };
    function historicalAdvice(source, liveChild = false) {
        return {
            capabilities: {
                ...(0, session_capabilities_1.sessionCapabilities)(source.harnessId, {}, { active: false }),
                ...(liveChild ? { resume: false } : {}),
            },
            closeMode: (0, harnesses_1.getHarness)(source.harnessId).closeMode,
            conflicted: false, liveInstanceCount: 0,
        };
    }
    // Active-only composition: no historical corpus or live-child traversal.
    function getActiveSessions(registered = (0, bridge_session_1.listRegisteredSessions)()) {
        return (0, session_catalog_1.composeSessionCatalog)({
            active: collectActiveObservations(registered), history: [],
            launchParents: new Map(), routines: new Map(), activeOnly: true,
            indexing: false, discoveryTruncated: false, discoverySkipped: 0,
        }, options).active;
    }
    function enumerateSessionCandidates(excludeIds = new Set()) {
        return (0, session_discovery_1.discoverHarnessSessions)().candidates.filter(candidate => !excludeIds.has((0, session_ownership_1.routeSessionId)(candidate.harnessId, candidate.nativeSessionId)));
    }
    function matchSessionQuery(session, parsed) {
        if ((0, helper_query_js_1.evaluateSessionQuery)(parsed, session))
            return {};
        const contentTokens = (0, helper_query_js_1.positiveQueryTokens)(parsed);
        if (contentTokens.length && session.sessionFile) {
            const historyText = sessionIndex.getSearchText((0, session_source_1.sourceForIdentity)(session.harnessId, session.nativeSessionId, session.sessionFile));
            if ((0, helper_query_js_1.evaluateSessionQuery)(parsed, session, historyText)) {
                return { snippet: (0, helper_query_js_1.buildSnippet)(historyText, contentTokens), text: historyText };
            }
        }
        return null;
    }
    // Relevance order, recency only breaking ties; queries without a positive
    // plain term keep the incoming order.
    function filterSessionsByQuery(list, query) {
        const parsed = (0, helper_query_js_1.parseSessionQuery)(query);
        if (!parsed.terms.length && parsed.since === null && parsed.before === null)
            return list;
        const rank = (0, helper_query_js_1.positiveQueryTokens)(parsed).length > 0;
        const out = [];
        for (const session of list) {
            const match = matchSessionQuery(session, parsed);
            if (!match)
                continue;
            if (!rank) {
                out.push(session);
                continue;
            }
            const text = match.text ?? (session.sessionFile ? sessionIndex.getSearchText((0, session_source_1.sourceForIdentity)(session.harnessId, session.nativeSessionId, session.sessionFile)) : null);
            const entry = { ...session, searchScore: (0, helper_query_js_1.scoreSessionMatch)(parsed, session, text) };
            if (match.snippet)
                entry.searchSnippet = match.snippet;
            out.push(entry);
        }
        if (rank) {
            out.sort((a, b) => b.searchScore - a.searchScore
                || new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime());
        }
        return out;
    }
    function resolveRefInCatalog(catalog, ref, exactOnly = false) {
        return (0, helper_refs_js_1.resolveSessionRefAmong)(catalog.list, ref, { exactOnly });
    }
    function buildSessionCatalog({ activeOnly = false } = {}) {
        const registered = (0, bridge_session_1.listRegisteredSessions)();
        const active = collectActiveObservations(registered);
        const liveChildren = liveSubsessionCandidates(active.map(observation => ({
            id: observation.id, harnessId: observation.harnessId, sessionFile: observation.claimedFile,
        })));
        const history = [];
        let indexing = false, discoveryTruncated = false, discoverySkipped = 0;
        if (activeOnly) {
            for (const source of liveChildren) {
                if (history.length >= SUBSESSION_ROW_CAP)
                    break;
                try {
                    history.push({ source, info: sessionIndex.getSessionInfo(source), liveChild: true, advice: historicalAdvice(source, true) });
                }
                catch { }
            }
        }
        else {
            try {
                const discovery = (0, session_discovery_1.discoverHarnessSessions)();
                sessionSources.refresh(discovery);
                discoveryTruncated = discovery.truncated;
                discoverySkipped = discovery.skipped;
                const activeIds = new Set(active.map(observation => observation.id));
                const candidates = discovery.candidates.filter(source => !activeIds.has(source.routeId));
                const liveIds = new Set(liveChildren.map(source => source.routeId));
                const scan = sessionIndex.scanSessions(candidates);
                indexing = scan.indexing;
                for (const source of candidates) {
                    const info = scan.infos.get(source.file);
                    if (!info)
                        continue;
                    history.push({ source, info, liveChild: liveIds.has(source.routeId), advice: historicalAdvice(source, liveIds.has(source.routeId)) });
                }
            }
            catch (error) {
                console.error('Error scanning sessions:', error);
            }
        }
        return (0, session_catalog_1.composeSessionCatalog)({
            active, history, activeOnly, indexing, discoveryTruncated, discoverySkipped,
            launchParents: (0, session_catalog_1.decodeLaunchParents)(sessionProvenance.readLaunches()),
            routines: (0, session_catalog_1.decodeRoutineAnnotations)(routinesStore.invocationsBySessionId()),
        }, options);
    }
    function parseSessionFile(source) {
        return (0, session_catalog_1.withSessionContext)(sessionIndex.getSessionInfo(source), getContextWindow);
    }
    async function getSessionModels(sessionId) {
        if (!sessionId)
            return null;
        try {
            const sess = await getLiveSession(sessionId);
            if (sess && (0, session_ownership_1.liveSessionSupports)(sess, 'models')) {
                const data = await sess.getAvailableModels();
                return (0, session_api_1.normalizeModels)(((0, wire_protocol_1.isRecord)(data) && data.models) || data);
            }
        }
        catch (e) {
            console.warn(`Failed to get session models for ${sessionId}:`, e instanceof Error ? e.message : e);
        }
        return null;
    }
    function getContextWindow(modelId) {
        if (!modelId)
            return DEFAULT_CONTEXT_WINDOW;
        const memoized = contextWindowMemo.get(modelId);
        if (memoized != null)
            return memoized;
        let window;
        if (modelsCache) {
            const longest = (models) => models.reduce((best, model) => (!best || model.id.length > best.id.length ? model : best), undefined);
            const match = modelsCache.find(model => model.id === modelId)
                || longest(modelsCache.filter(model => modelId.includes(model.id)))
                || longest(modelsCache.filter(model => model.id.startsWith(modelId + '-')));
            if (match?.contextWindow)
                window = match.contextWindow;
        }
        if (!window) {
            for (const [prefix, size] of CONTEXT_WINDOW_FALLBACKS) {
                if (modelId.includes(prefix)) {
                    window = size;
                    break;
                }
            }
        }
        window = window || DEFAULT_CONTEXT_WINDOW;
        contextWindowMemo.set(modelId, window);
        return window;
    }
    function setModelsCache(models) {
        modelsCache = models;
        modelsCacheTime = Date.now();
        contextWindowMemo.clear();
    }
    function getModelsCache() {
        return { models: modelsCache, time: modelsCacheTime };
    }
    return {
        options,
        buildSessionCatalog,
        getActiveSessions,
        enumerateSessionCandidates,
        filterSessionsByQuery,
        resolveRefInCatalog,
        historicalAdvice,
        canonicalSessionPath,
        parseSessionFile,
        getSessionModels,
        getContextWindow,
        refreshPrimeRoster,
        setModelsCache,
        getModelsCache,
    };
}
