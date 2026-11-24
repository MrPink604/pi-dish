import fs = require('fs');
import path = require('path');
import { listRegisteredSessions } from './bridge-session';
import { getAllRPCSessions } from './rpc-session';
import { getHarness, listHarnesses } from './harnesses';
import { PRIME_DAEMON_CAPABILITIES, sessionCapabilities } from './session-capabilities';
import { getPrimeDaemon, type PrimeDaemon, type PrimeDaemonSession } from './prime-daemon';
import tmux = require('./tmux');
import sessionIndex = require('./session-index');
import { sourceForIdentity } from './session-source';
import { discoverHarnessSessions } from './session-discovery';
import {
  buildSnippet, evaluateSessionQuery, parseSessionQuery, positiveQueryTokens, scoreSessionMatch,
} from './helper-query.js';
import { resolveSessionRefAmong } from './helper-refs.js';
import { normalizeModels } from './session-api';
import {
  composeSessionCatalog, decodeLaunchParents, decodeLaunchSourceBases, decodeRoutineAnnotations,
  primeSessionObservation, registeredSessionObservation, rpcSessionObservation, withSessionContext,
} from './session-catalog';
import sessionProvenance = require('./session-provenance');
import routinesStore = require('./routines');
import {
  liveSessionSupports, primeLaunchAuthorityForRoute, registryIdentity, routeSessionId,
  spawnAllowsManagedClose, spawnAllowsRestart,
} from './session-ownership';
import { record as isRecord } from './helper-values';
import { parseHostQualifiedCaller } from './session-key';
import { AGY_BRAIN_PROFILE_ID } from './agy-brain';
import type { SessionOwnership } from './session-ownership';
import type { AdvertisedCapabilities, BridgeRegistryEntry, HarnessId, NativeSessionId } from './contracts';
import type { SessionInfo } from './session-metadata';
import type { DiscoveryCandidate, SessionSource } from './session-source';
import type { CatalogAdvice, CatalogHistoryObservation, CatalogLiveObservation, CatalogSession, SessionCatalog, SessionCatalogOptions } from './session-catalog';
import type { SessionQuery } from './helper-types';
import type { AvailableModel } from './pi-sdk';
import type { CatalogModel } from './session-api';
import type { ServedCacheExpiry } from './cache-lifetime';

const MODEL_CONTEXT_WINDOWS = {
  // Claude 1M-context models (must come before the 200k family prefixes)
  'claude-opus-4-6': 1000000, 'claude-opus-4-7': 1000000, 'claude-sonnet-4-6': 1000000,
  'claude-opus-4': 200000, 'claude-sonnet-4': 200000, 'claude-haiku-4': 200000,
  'claude-3.5': 200000, 'claude-3': 200000,
  'gpt-4o': 128000, 'gpt-4-turbo': 128000, 'gpt-4': 8192,
  'o1': 200000, 'o3': 200000,
  'gemini-2': 1000000, 'gemini-1.5': 1000000,
  // Antigravity's Gemini ids (agy reports usage_update size 1048576 for each).
  'gemini-4': 1048576, 'gemini-3': 1048576, 'gemini-pro-orchestrator': 1048576,
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
const BRIDGE_ATTEMPT_CAP = 32;
const BRIDGE_INDEX_TTL_MS = 60_000;
const BRIDGE_MISS_MAX = 512;

export interface CatalogRuntimePorts {
  ownership: SessionOwnership;
  /** Roster-discovered Prime roots attach their lifecycle listeners here. */
  onPrimeSession?(session: PrimeDaemonSession): void;
}

export type SessionFileInfo = SessionInfo & {
  contextWindow: number;
  contextPercent: number;
  cacheExpiry: ServedCacheExpiry | null;
};

export interface CatalogRuntime {
  readonly options: SessionCatalogOptions;
  /** Private rows stay hidden unless `includePrivate` (a PIN-unlocked request). */
  buildSessionCatalog(options?: { activeOnly?: boolean; includePrivate?: boolean }): SessionCatalog;
  getActiveSessions(registered?: readonly BridgeRegistryEntry[]): readonly CatalogSession[];
  enumerateSessionCandidates(excludeIds?: ReadonlySet<string>): DiscoveryCandidate[];
  filterSessionsByQuery(list: readonly CatalogSession[], query: string): readonly CatalogSession[];
  resolveRefInCatalog(catalog: SessionCatalog, ref: unknown, exactOnly?: boolean): { session: CatalogSession | null; matches: CatalogSession[] };
  parseSessionFile(source: SessionSource): SessionFileInfo;
  getSessionModels(sessionId: string): Promise<CatalogModel[] | null>;
  refreshPrimeRoster(): Promise<void>;
  getContextWindow(modelId: string | null | undefined): number;
  getModelsCache(): { models: AvailableModel[] | null; time: number };
  /** Also invalidates the context-window memo. */
  setModelsCache(models: AvailableModel[]): void;
}

export function canonicalSessionPath(file: string | null): string | null {
  if (!file) return null;
  try { return fs.realpathSync(file); } catch { return path.resolve(file); }
}

export function historicalAdvice(source: SessionSource, liveChild = false): CatalogAdvice {
  const noResume = liveChild || source.profileId === AGY_BRAIN_PROFILE_ID;
  return {
    capabilities: {
      ...sessionCapabilities(source.harnessId, {}, { active: false }),
      ...(noResume ? { resume: false } : {}),
    },
    closeMode: getHarness(source.harnessId)!.closeMode,
    conflicted: false, liveInstanceCount: 0,
  };
}

export function createCatalogRuntime(ports: CatalogRuntimePorts): CatalogRuntime {
  const { ownership } = ports;
  const { getRPCSession, getLiveSession, liveSubsessionCandidates, sessionSources } = ownership;
  let modelsCache: AvailableModel[] | null = null;
  let modelsCacheTime = 0;
  const contextWindowMemo = new Map<string, number>();
  let bridgeIndex: { builtAt: number; byId: Map<string, DiscoveryCandidate> } | null = null;
  let lastBridgeScanAt = 0;
  const bridgeMisses = new Map<string, number>();

  function getContextWindow(modelId: string | null | undefined): number {
    if (!modelId) return DEFAULT_CONTEXT_WINDOW;
    const memoized = contextWindowMemo.get(modelId);
    if (memoized != null) return memoized;

    let window: number | undefined;
    if (modelsCache) {
      const longest = (models: AvailableModel[]) => models.reduce<AvailableModel | undefined>(
        (best, model) => (!best || model.id.length > best.id.length ? model : best), undefined);
      const match = modelsCache.find(model => model.id === modelId)
        || longest(modelsCache.filter(model => modelId.includes(model.id)))
        || longest(modelsCache.filter(model => model.id.startsWith(modelId + '-')));
      if (match?.contextWindow) window = match.contextWindow;
    }
    if (!window) {
      for (const [prefix, size] of CONTEXT_WINDOW_FALLBACKS) {
        if (modelId.includes(prefix)) { window = size; break; }
      }
    }
    window = window || DEFAULT_CONTEXT_WINDOW;
    contextWindowMemo.set(modelId, window);
    return window;
  }

  function setModelsCache(models: AvailableModel[]): void {
    modelsCache = models;
    modelsCacheTime = Date.now();
    contextWindowMemo.clear();
  }

  function getModelsCache() {
    return { models: modelsCache, time: modelsCacheTime };
  }

  let primeRosterReadAt = 0;
  let primeRosterSocket: string | null = null;

  function primeRosterIsStale(daemon: PrimeDaemon): boolean {
    return daemon.socketPath !== primeRosterSocket || Date.now() - primeRosterReadAt > PRIME_ROSTER_STALE_MS;
  }

  function loadPrimeRoster(): PrimeDaemonSession[] {
    const daemon = getPrimeDaemon();
    if (primeRosterIsStale(daemon)) {
      primeRosterReadAt = Date.now();
      primeRosterSocket = daemon.socketPath;
      daemon.refresh().catch(() => {});
    }
    return daemon.list();
  }

  async function refreshPrimeRoster(): Promise<void> {
    const daemon = getPrimeDaemon();
    if (!primeRosterIsStale(daemon)) return;
    primeRosterReadAt = Date.now();
    primeRosterSocket = daemon.socketPath;
    try { await daemon.refresh(); } catch {}
  }

  function observedSource(harnessId: HarnessId, nativeSessionId: NativeSessionId, file: unknown): {
    source: SessionSource | null; info: SessionInfo | null;
  } {
    if (typeof file !== 'string' || !fs.existsSync(file)) return { source: null, info: null };
    const source = sourceForIdentity(harnessId, nativeSessionId, file);
    try { return { source, info: sessionIndex.getSessionInfo(source) }; } catch { return { source, info: null }; }
  }

  function collectActiveObservations(registered: readonly BridgeRegistryEntry[] = listRegisteredSessions()): CatalogLiveObservation[] {
    const active: CatalogLiveObservation[] = [];
    const seen = new Set<string>();
    const groups = new Map<string, BridgeRegistryEntry[]>();
    for (const reg of registered) {
      const identity = registryIdentity(reg);
      if (!identity || !getHarness(identity.harnessId)) continue;
      const routeId = routeSessionId(identity.harnessId, identity.nativeSessionId);
      const group = groups.get(routeId) || [];
      group.push(reg);
      groups.set(routeId, group);
    }
    for (const [routeId, instances] of groups) {
      const conflicted = instances.length !== 1;
      const reg = instances.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
      const identity = registryIdentity(reg)!;
      const ownedSpawn = tmux.getSpawn(routeId);
      const closeMode = getHarness(identity.harnessId)!.closeMode;
      const restartAllowed = spawnAllowsRestart(ownedSpawn, reg, closeMode);
      const { source, info } = observedSource(identity.harnessId, identity.nativeSessionId, reg.sessionFile);
      active.push(registeredSessionObservation(reg, {
        ...identity, source, info,
        advice: {
          capabilities: sessionCapabilities(identity.harnessId, isRecord(reg.capabilities) ? reg.capabilities as AdvertisedCapabilities : {}, {
            active: true, conflicted,
            closeAllowed: spawnAllowsManagedClose(ownedSpawn, reg, closeMode),
            restartAllowed: !!getRPCSession(routeId)?.alive || restartAllowed,
          }),
          closeMode, conflicted, liveInstanceCount: instances.length,
        },
      }));
      seen.add(routeId);
    }

    for (const rpc of getAllRPCSessions()) {
      if (!rpc.alive || seen.has(rpc.id)) continue;
      const { source, info } = observedSource('pi', rpc.id, rpc.sessionFile || rpc.state?.sessionFile);
      active.push(rpcSessionObservation(rpc, {
        nativeSessionId: rpc.id, source, info,
        advice: {
          capabilities: sessionCapabilities('pi', {}, { active: true, restartAllowed: true }),
          closeMode: getHarness('pi')!.closeMode, conflicted: false, liveInstanceCount: 1,
        },
      }));
      seen.add(rpc.id);
    }

    // Prime roots exist only in the daemon roster, so their lifecycle
    // listeners are attached here.
    for (const prime of loadPrimeRoster()) {
      const routeId = routeSessionId('prime', prime.nativeSessionId);
      if (seen.has(routeId)) continue;
      ports.onPrimeSession?.(prime);
      const { source, info } = observedSource('prime', prime.nativeSessionId, prime.sessionFile);
      const authority = primeLaunchAuthorityForRoute(routeId);
      active.push(primeSessionObservation(prime, {
        nativeSessionId: prime.nativeSessionId, source, info,
        advice: {
          capabilities: sessionCapabilities('prime', PRIME_DAEMON_CAPABILITIES, {
            active: true, conflicted: false,
            closeAllowed: authority.closeAllowed, restartAllowed: authority.restartAllowed,
          }),
          closeMode: getHarness('prime')!.closeMode, conflicted: false, liveInstanceCount: 1,
        },
      }));
      seen.add(routeId);
    }

    return active;
  }

  const options: SessionCatalogOptions = {
    harnesses: new Map(listHarnesses().map(descriptor => [descriptor.id, descriptor])),
    contextWindowForModel: getContextWindow,
    canonicalPath: canonicalSessionPath,
    directoryExists: directory => fs.existsSync(directory),
  };

  // Active-only composition: no historical corpus or live-child traversal.
  function getActiveSessions(registered: readonly BridgeRegistryEntry[] = listRegisteredSessions()): readonly CatalogSession[] {
    return composeSessionCatalog({
      active: collectActiveObservations(registered), history: [],
      launchParents: new Map(), routines: new Map(), activeOnly: true,
      indexing: false, discoveryTruncated: false, discoverySkipped: 0,
    }, options).active;
  }

  function enumerateSessionCandidates(excludeIds: ReadonlySet<string> = new Set()): DiscoveryCandidate[] {
    return discoverHarnessSessions().candidates.filter(candidate =>
      !excludeIds.has(routeSessionId(candidate.harnessId, candidate.nativeSessionId)));
  }

  function matchSessionQuery(session: CatalogSession, parsed: SessionQuery): { snippet?: string; text?: string } | null {
    if (evaluateSessionQuery(parsed, session)) return {};
    const contentTokens = positiveQueryTokens(parsed);
    if (contentTokens.length && session.sessionFile) {
      const historyText = sessionIndex.getSearchText(sourceForIdentity(
        session.harnessId, session.nativeSessionId, session.sessionFile));
      if (evaluateSessionQuery(parsed, session, historyText)) {
        return { snippet: buildSnippet(historyText, contentTokens), text: historyText };
      }
    }
    return null;
  }

  // Relevance order, recency only breaking ties; queries without a positive
  // plain term keep the incoming order.
  function filterSessionsByQuery(list: readonly CatalogSession[], query: string): readonly CatalogSession[] {
    const parsed = parseSessionQuery(query);
    if (!parsed.terms.length && parsed.since === null && parsed.before === null) return list;
    const rank = positiveQueryTokens(parsed).length > 0;
    const out: CatalogSession[] = [];
    for (const session of list) {
      const match = matchSessionQuery(session, parsed);
      if (!match) continue;
      if (!rank) { out.push(session); continue; }
      const text = match.text ?? (session.sessionFile ? sessionIndex.getSearchText(sourceForIdentity(
        session.harnessId, session.nativeSessionId, session.sessionFile)) : null);
      const entry: CatalogSession & { searchScore: number } = { ...session, searchScore: scoreSessionMatch(parsed, session, text) };
      if (match.snippet) entry.searchSnippet = match.snippet;
      out.push(entry);
    }
    if (rank) {
      out.sort((a, b) => b.searchScore! - a.searchScore!
        || new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime());
    }
    return out;
  }

  function resolveRefInCatalog(catalog: SessionCatalog, ref: unknown, exactOnly = false) {
    return resolveSessionRefAmong(catalog.list, ref, { exactOnly });
  }

  function buildSessionCatalog({ activeOnly = false, includePrivate = false }: { activeOnly?: boolean; includePrivate?: boolean } = {}): SessionCatalog {
    const registered = listRegisteredSessions();
    const active = collectActiveObservations(registered);
    const liveChildren = liveSubsessionCandidates(active.map(observation => ({
      id: observation.id, harnessId: observation.harnessId, sessionFile: observation.claimedFile,
    })));
    const launches = sessionProvenance.readLaunches();
    const launchParents = decodeLaunchParents(launches);
    const launchSourceBases = decodeLaunchSourceBases(launches);
    const history: CatalogHistoryObservation[] = [];
    let indexing = false, discoveryTruncated = false, discoverySkipped = 0;
    if (activeOnly) {
      const visibleIds = new Set<string>([
        ...active.map(observation => observation.id),
        ...liveChildren.map(source => source.routeId),
      ]);
      for (const source of liveChildren) {
        if (history.length >= SUBSESSION_ROW_CAP) break;
        try {
          history.push({ source, info: sessionIndex.getSessionInfo(source), liveChild: true, advice: historicalAdvice(source, true) });
        } catch {}
      }
      // Include closed intermediate parents between two live sessions (or below a
      // cross-host ancestor) from one shared history index, capping attempts (misses included).
      const bridgeIds: string[] = [];
      const bridgeIdSet = new Set<string>();
      for (const id of visibleIds) {
        if (bridgeIds.length >= BRIDGE_ATTEMPT_CAP) break;
        const chain: string[] = [];
        const visited = new Set<string>([id]);
        let cursor = launchParents.get(id as never) || null;
        while (cursor && chain.length < 16 && !visited.has(cursor)) {
          visited.add(cursor);
          if (visibleIds.has(cursor) || parseHostQualifiedCaller(cursor)) {
            for (const step of chain) {
              if (bridgeIds.length >= BRIDGE_ATTEMPT_CAP) break;
              if (!bridgeIdSet.has(step)) { bridgeIdSet.add(step); bridgeIds.push(step); }
            }
            break;
          }
          chain.push(cursor);
          cursor = launchParents.get(cursor) || null;
        }
      }
      if (bridgeIds.length) {
        const now = Date.now();
        const isFreshMiss = (id: string) => {
          const missedAt = bridgeMisses.get(id);
          return missedAt !== undefined && now - missedAt < BRIDGE_INDEX_TTL_MS;
        };
        const hasUnseen = bridgeIds.some(id => !bridgeIndex?.byId.has(id) && !isFreshMiss(id));
        let scannedBridgeIndex = false;
        if ((!bridgeIndex || hasUnseen) && (lastBridgeScanAt === 0 || now - lastBridgeScanAt >= BRIDGE_INDEX_TTL_MS)) {
          try {
            const discovery = discoverHarnessSessions();
            sessionSources.refresh(discovery);
            bridgeIndex = { builtAt: now, byId: new Map(discovery.candidates.map(candidate => [candidate.routeId, candidate])) };
            bridgeMisses.clear();
            scannedBridgeIndex = true;
          } catch {}
          lastBridgeScanAt = now;
        }
        const recordMiss = (id: string) => {
          if (bridgeMisses.size >= BRIDGE_MISS_MAX) bridgeMisses.clear();
          bridgeMisses.set(id, now);
        };
        for (const bridgeId of bridgeIds) {
          if (isFreshMiss(bridgeId)) continue;
          const candidate = bridgeIndex?.byId.get(bridgeId);
          if (!candidate) {
            // Only record a miss when we actually ran a discovery scan for this index;
            // otherwise a bridge created during the TTL cooldown would be suppressed for another full TTL.
            if (scannedBridgeIndex) recordMiss(bridgeId);
            continue;
          }
          try {
            history.push({ source: candidate, info: sessionIndex.getSessionInfo(candidate), liveChild: false, bridge: true, advice: historicalAdvice(candidate, false) });
          } catch {
            bridgeIndex?.byId.delete(bridgeId);
            recordMiss(bridgeId);
          }
        }
      }
    } else {
      try {
        const discovery = discoverHarnessSessions();
        sessionSources.refresh(discovery);
        const now = Date.now();
        bridgeIndex = { builtAt: now, byId: new Map(discovery.candidates.map(candidate => [candidate.routeId, candidate])) };
        lastBridgeScanAt = now;
        bridgeMisses.clear();
        discoveryTruncated = discovery.truncated;
        discoverySkipped = discovery.skipped;
        const activeIds = new Set(active.map(observation => observation.id));
        const candidates = discovery.candidates.filter(source => !activeIds.has(source.routeId));
        const liveIds = new Set(liveChildren.map(source => source.routeId));
        const scan = sessionIndex.scanSessions(candidates);
        indexing = scan.indexing;
        for (const source of candidates) {
          const info = scan.infos.get(source.file);
          if (!info) continue;
          history.push({ source, info, liveChild: liveIds.has(source.routeId), advice: historicalAdvice(source, liveIds.has(source.routeId)) });
        }
      } catch (error) { console.error('Error scanning sessions:', error); }
    }
    return composeSessionCatalog({
      active, history, activeOnly, indexing, discoveryTruncated, discoverySkipped, hidePrivate: !includePrivate,
      launchParents,
      launchSourceBases,
      routines: decodeRoutineAnnotations(routinesStore.invocationsBySessionId()),
    }, options);
  }

  function parseSessionFile(source: SessionSource) {
    return withSessionContext(sessionIndex.getSessionInfo(source), getContextWindow);
  }

  async function getSessionModels(sessionId: string) {
    if (!sessionId) return null;
    try {
      const sess = await getLiveSession(sessionId);
      if (sess && liveSessionSupports(sess, 'models')) {
        const data = await sess.getAvailableModels();
        return normalizeModels((isRecord(data) && data.models) || data);
      }
    } catch (e) {
      console.warn(`Failed to get session models for ${sessionId}:`, e instanceof Error ? e.message : e);
    }
    return null;
  }

  return {
    options,
    buildSessionCatalog,
    getActiveSessions,
    enumerateSessionCandidates,
    filterSessionsByQuery,
    resolveRefInCatalog,
    parseSessionFile,
    getSessionModels,
    refreshPrimeRoster,
    getContextWindow,
    getModelsCache,
    setModelsCache,
  };
}
