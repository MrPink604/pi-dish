import { normalizeModels, sessionForClient, thinkingResult } from './session-api';
import express = require('express');
import fs = require('fs');
import path = require('path');
import os = require('os');
import crypto = require('crypto');
import { createServer } from 'node:http';
import { errorMonitor, type EventEmitter } from 'node:events';
import piSDK = require('./pi-sdk');
import { createSessionReadHandlers } from './session-read-handlers';
import { getAllRPCSessions } from './rpc-session';
import {
  listRegisteredSessions,
  invalidateRegistryCache,
  BridgeSession,
} from './bridge-session';
import { createFileHandlers } from './file-handlers';
import terminal = require('./terminal');
import tmux = require('./tmux');
import hostIdentity = require('./host-identity');
import remoteHosts = require('./remote-hosts');
import fleetArtifacts = require('./fleet-artifacts');
import { createAccessHandlers } from './access-handlers';
import { createRelayHandlers } from './relay-handlers';
import { createTerminalHandlers } from './terminal-handlers';
import { createPublicationHandlers } from './publication-handlers';
import pages = require('./pages');
import stt = require('./stt');
import { createHostHealth } from './host-health';
import {
  readSessionMessages,
  readSessionCwd,
  readSessionTailEntry,
} from './session-files';
import { discoverHarnessSessions } from './session-discovery';
import sessionIndex = require('./session-index');
const { getSessionInfo } = sessionIndex;
import { sourceForIdentity } from './session-source';
import { composeSessionCatalog, registeredSessionObservation, rpcSessionObservation,
  decodeLaunchParents, decodeRoutineAnnotations, withSessionContext, subsessionLabel,
  buildSourceSession } from './session-catalog';
import { getHarness, listHarnesses } from './harnesses';
import { sessionCapabilities } from './session-capabilities';
import { refreshHarnessPricing } from './harness-pricing';
import { createFeatureHandlers } from './feature-handlers';
import {
  harnessCommandAvailable, runHarnessModelCommand,
} from './harness-feature-commands';
import {
  createSessionOwnership, routeIdentity, routeSessionId, registryIdentity,
  sessionSwitchRouteData, liveSessionSupports,
  spawnAllowsManagedClose, spawnAllowsRestart,
} from './session-ownership';
import { createSessionLaunch } from './session-launch';
import { createSessionOperations } from './session-operations';
import sessionProvenance = require('./session-provenance');
import routinesStore = require('./routines');
import { createRoutineRunner } from './routine-runner';
import { createRoutineHandlers, composeRoutinePrompt } from './routine-handlers';
import recoveryStore = require('./session-recovery');
import { createRecoveryRuntime } from './recovery-runner';
import { createSessionBounceRuntime } from './session-bounces';
import type { SessionBounceMode } from './session-bounces';
import skillsLib = require('./skills');
import { knownWorkspaceCwds } from './skill-feature-handlers';
import {
  ALL_THINKING_LEVEL_NAMES, thinkingLevelNamesFor, parseModelId,
} from './helper-models.js';
import { extractTextContent } from './helper-content.js';
import { sessionMetaText } from './helper-identity.js';
import {
  buildSnippet, buildSnippets,
  parseSessionQuery, evaluateSessionQuery, positiveQueryTokens, scoreSessionMatch,
  isAutomationSession, queryAsksForAutomation,
} from './helper-query.js';
import { resolveSessionRefAmong, stableSessionRef } from './helper-refs.js';
import { expandSessionRefs } from './session-refs';

import type { Request, Response, NextFunction } from 'express';
import type { ParsedQs } from 'qs';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { HarnessLaunchTarget } from './session-launch';
import type { AvailableModel } from './pi-sdk';
import type { SessionRefDependencies } from './session-refs';

import type { AdvertisedCapabilities, BridgeRegistryEntry, SessionId } from './contracts';
import type { SessionInfo } from './session-metadata-contracts';
import type { DiscoveryCandidate, SessionSource } from './session-source-contracts';
import type { CatalogAdvice, CatalogHistoryObservation, CatalogLiveObservation, CatalogSession, SessionCatalog, SessionCatalogOptions } from './session-catalog-contracts';
import type { SessionQuery } from './helper-types';
import type { SessionFields } from './session-api';
import type { LiveSession } from './session-ownership';
import type { RPCSession } from './rpc-session';
import type { HarnessDescriptor, HostBuiltin } from './contracts';
import type { BranchSessionOptions } from './pi-sdk';
import type { ProtocolRecord } from './wire-protocol';
import { removeExtensionUIDialog } from './extension-ui-state';

interface CatalogListResponse extends Pick<SessionCatalog, 'indexing' | 'discoveryTruncated' | 'discoverySkipped'> {
  active: readonly (SessionFields<Date | string | number> & { id: string })[];
  previous: readonly (SessionFields<Date | string | number> & { id: string })[];
  children: readonly (SessionFields<Date | string | number> & { id: string })[];
}

interface CatalogRelationSummary extends Pick<CatalogSession, 'id' | 'sessionKey' | 'name' | 'lastActivity'> {
  harnessId: CatalogSession['harnessId'];
  nativeSessionId: CatalogSession['nativeSessionId'] | CatalogSession['id'];
  cwd: string | null;
  model: string;
  isActive: boolean;
  subagentLive: boolean;
  turnInProgress: boolean;
  capabilities: NonNullable<CatalogSession['capabilities']> | null;
}

interface CatalogRelation {
  kind: 'parent' | 'child' | 'startedFrom' | 'startedHere';
  source: string;
  session: CatalogRelationSummary;
}

interface CatalogLineageEdge {
  kind: 'startedHere' | 'child';
  source: string;
}

interface CatalogLineageNode {
  session: CatalogRelationSummary;
  edge: CatalogLineageEdge | null;
  children: CatalogLineageNode[];
}

interface ParsedHostBuiltin {
  command: HostBuiltin;
  text: string;
  hasArgs: boolean;
}

type ApplicationRequest = Request<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
type ApplicationResponse = Response<unknown, Record<string, unknown>>;

/** Preserve native property reads, including primitive boxing and null failures. */
function property(value: unknown, key: string): unknown {
  return (value as { [key: string]: unknown })[key];
}

/** Optional access short-circuits only nullish values, not other raw payloads. */
function optionalProperty(value: unknown, key: string): unknown {
  return value == null ? undefined : property(value, key);
}

export interface ServerStartupObserver {
  /** The first bound full-app listener, not the advertised agent or share URL. */
  ready(url: string): void;
  /** Errors observed after subscription, before the native host failure policy. */
  failed(error: Error): void;
}

interface ServerStartupState {
  readyUrl: string | null;
  observers: ServerStartupObserver[];
}

// Key the lifecycle by its exported initial native server, not by whichever
// retry candidate happens to own the successful bind.
const serverStartups = new WeakMap<Server, ServerStartupState>();

export function observeServerStartup(initialServer: Server, observer: ServerStartupObserver): void {
  const startup = serverStartups.get(initialServer);
  if (!startup) throw new Error('Server does not belong to a pi-dish startup');
  startup.observers.push(observer);
  if (startup.readyUrl !== null) observer.ready(startup.readyUrl);
}

export function startServer(rootDirectory: string): Server {
  const app = express();
  const PORT = Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : 3333;
  // Localhost-only by default; opt in to LAN/VPN exposure explicitly, e.g.
  // HOST=0.0.0.0 (all interfaces) or HOST=<tailscale ip>. Auth is opt-in (see
  // the host identity / auth section below) — without a token, anything that
  // can reach the port can drive agents with shell access.
  const HOST = process.env.HOST || '127.0.0.1';

  const packageVersion: string = require(path.join(rootDirectory, 'package.json')).version;

  const accessHandlers = createAccessHandlers({
    version: packageVersion,
    readDishSettings,
    sttAvailable: () => !!stt.resolveSttConfig(readDishSettings()),
    usageLimitsAvailable: () => listHarnesses().some(d => d.argv?.usage && harnessCommandAvailable(d)),
  });
  app.use(accessHandlers.compression);
  app.use(accessHandlers.jsonBody);
  app.use(accessHandlers.cors);

  app.use(express.static(path.join(rootDirectory, 'public')));

  app.use('/api', accessHandlers.apiGate);
  app.get('/api/host', accessHandlers.host);
  app.post('/api/auth/ticket', accessHandlers.ticket);

  const relayHandlers = createRelayHandlers({
    fleetArtifacts,
    localPageExists: token => !!pages.getPage(token),
    publicBaseUrl: () => process.env.PI_DISH_SHARE_BASE_URL,
    hostDescriptor: accessHandlers.hostDescriptor,
    upgradeAuthorized: accessHandlers.upgradeAuthorized,
  });
  app.use('/hosts', accessHandlers.hostsGate);
  app.use('/hosts/:name/api', relayHandlers.rawApi);

  app.post('/api/fleet-artifacts', relayHandlers.registerArtifact);
  app.get('/api/fleet-artifacts', relayHandlers.listArtifacts);
  app.delete('/api/fleet-artifacts/:token', relayHandlers.removeArtifact);
  app.get('/api/hosts', relayHandlers.hosts);

  const SESSIONS_DIR = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  const PI_SETTINGS_FILE = path.join(os.homedir(), '.pi', 'agent', 'settings.json');
  const DISH_SETTINGS_FILE = path.join(os.homedir(), '.pi', 'dish', 'settings.json');

  // =========================================================================
  // Harness-aware identity boundary
  // =========================================================================

  const ownership = createSessionOwnership({
    onLive: observeSessionLifecycle,
    onRetired: route => { fileHandlers.retireSession(route); },
    readSessionTailEntry,
  });
  const {
    sessionSources, getRegisteredSession, getRPCSession,
    resolveSessionCandidate, liveSessionHistoryPending,
    getLiveSession, adoptBridgeSessionSwitch, describeRuntime, locatePiPane,
    liveSubsessionCandidates, liveSourceObservations,
  } = ownership;
  const fileHandlers = createFileHandlers({ resolveSessionCwd, findSessionSource });
  const sessionReadHandlers = createSessionReadHandlers({
    findSessionSource, liveSessionHistoryPending, getRegisteredSession, getRPCSession,
    getLiveSession, liveTreeLeafId, getLiveContextUsage, getContextWindow, describeRuntime,
  });
  const publicationHandlers = createPublicationHandlers({
    findSessionSource, liveSessionHistoryPending, listRegisteredSessions,
    enumerateSessionCandidates, getRPCSession,
    exportSessionHtml: sessionReadHandlers.exportSessionHtml,
    getOmpShareSnapshot: sessionReadHandlers.getOmpShareSnapshot,
    relay: relayHandlers.publicArtifacts,
    publicBaseUrl: () => process.env.PI_DISH_SHARE_BASE_URL,
    resourceRoot: rootDirectory,
  });
  const sessionLaunch = createSessionLaunch({ runHarnessModelCommand });
  const sessionOperations = createSessionOperations({
    ownership,
    launch: sessionLaunch,
    getActiveSessions,
    readSessionCwd,
    recordLaunchProvenance: (id, sourceId, operationId) => sessionProvenance.recordLaunch(id, sourceId, operationId),
  });
  const featureHandlers = createFeatureHandlers({
    readDishSettings, writeDishSettings, buildSessionCatalog,
    enumerateSessionCandidates, findSessionSource, getSessionModels,
    getLiveSession, locatePiPane,
    getModelsCache: () => ({ models: modelsCache, time: modelsCacheTime }),
    setModelsCache,
    applicationRoot: rootDirectory,
    piSettingsFile: PI_SETTINGS_FILE,
  });

  // =========================================================================
  // Helpers
  // =========================================================================


  const MODEL_CONTEXT_WINDOWS = {
    // Claude 1M-context models (must come before the 200k family prefixes)
    'claude-opus-4-6': 1000000, 'claude-opus-4-7': 1000000, 'claude-sonnet-4-6': 1000000,
    // Claude 200k family
    'claude-opus-4': 200000, 'claude-sonnet-4': 200000, 'claude-haiku-4': 200000,
    'claude-3.5': 200000, 'claude-3': 200000,
    'gpt-4o': 128000, 'gpt-4-turbo': 128000, 'gpt-4': 8192,
    'o1': 200000, 'o3': 200000,
    'gemini-2': 1000000, 'gemini-1.5': 1000000,
    'default': 200000,
  };


  app.use('/api/sessions/:id', (req: ApplicationRequest, res: ApplicationResponse, next: NextFunction) => {
    const refusal = sessionOperations.admitHttpAction(req.params.id, req.method);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    next();
  });

  /**
   * The live session's current tree leaf id (null for an empty tree). Prefers
   * the leaf-only tree_leaf RPC — tree_read serializes the whole session tree,
   * which cost O(session bytes) on every transcript page/catch-up request for
   * long live OMP sessions. Bridge extensions loaded before tree_leaf existed
   * answer "unknown command"; remember that per connection (a reconnect may be
   * a newer extension) and fall back to the full tree read.
   */
  async function liveTreeLeafId(sess: InstanceType<typeof BridgeSession>): Promise<unknown> {
    if (!sess.treeLeafUnsupported) {
      try {
        const result = await sess.readTreeLeaf();
        return (result == null ? undefined : property(result, 'leafId')) ?? null;
      } catch (e) {
        if (!/unknown command/i.test(String((e == null ? undefined : property(e, 'message')) || e))) throw e;
        sess.treeLeafUnsupported = true;
      }
    }
    const result = await sess.readTree();
    return (result == null ? undefined : property(result, 'leafId')) ?? null;
  }

  // Application policy stays separate from transport-owned replay reduction.
  // Native asks cannot wait outside an active turn; switch adoption rekeys the
  // application only after the transport has cleared its old replay state.
  const observedSessions = new WeakSet<LiveSession>();

  function observeSessionLifecycle(sess: LiveSession): void {
    const dismissAskDialogs = (source: string) => {
      for (const [id, data] of sess.extUIState.dialogs) {
        if ((data == null ? undefined : property(data, 'method')) !== 'ask') continue;
        removeExtensionUIDialog(sess.extUIState, id);
        // Keep the existing native ask dispatch; only bridge asks use this path.
        const emitter = sess as { emit(event: string, data: unknown): unknown };
        emitter.emit('extension_ui_resolved', { id, source });
        if (typeof sess.respondExtensionUI === 'function') {
          Promise.resolve(sess.respondExtensionUI(id as string, { cancelled: true })).catch(() => {});
        }
      }
    };
    // A replayed ask on an idle OMP session is orphaned state from a
    // failed/reloaded UI wrapper. Recheck even when observers already exist.
    if (!sess.turnInProgress) dismissAskDialogs('idle');
    if (observedSessions.has(sess)) return;
    observedSessions.add(sess);
    sess.on('session_switch', data => adoptBridgeSessionSwitch(sess, data));
    sess.on('turn_end', () => dismissAskDialogs('turn-end'));
    sess.on('agent_end', () => dismissAskDialogs('agent-end'));
  }


  /** Live context usage, whichever backend reports it (registry beats RPC stats). */
  function getLiveContextUsage(sessionId: string): unknown {
    const reg = getRegisteredSession(sessionId);
    if (reg?.contextUsage) return reg.contextUsage;
    const stats = getRPCSession(sessionId)?.lastStats;
    return (stats == null ? undefined : property(stats, 'contextUsage')) || null;
  }

  async function getSessionModels(sessionId: string) {
    if (!sessionId) return null;
    try {
      const sess = await getLiveSession(sessionId);
      if (sess && liveSessionSupports(sess, 'models')) {
        const data = await sess.getAvailableModels();
        return normalizeModels((data == null ? undefined : property(data, 'models')) || data);
      }
    } catch (e) {
      console.warn(`Failed to get session models for ${sessionId}:`, property(e, 'message'));
    }
    return null;
  }

  // Static fallback, longest prefix first so specific entries (claude-opus-4-7)
  // beat generic ones (claude-opus-4). includes() so Bedrock cross-region IDs
  // like "us.anthropic.claude-opus-4-7" match too.
  const CONTEXT_WINDOW_FALLBACKS = Object.entries(MODEL_CONTEXT_WINDOWS)
    .filter(([p]) => p !== 'default')
    .sort((a, b) => b[0].length - a[0].length);

  // Memoized per modelId — the session-list poll calls this for every session
  // and the registry scans are linear. Cleared whenever modelsCache refreshes.
  const contextWindowMemo = new Map<string, number>();

  function getContextWindow(modelId: string | null | undefined): number {
    if (!modelId) return MODEL_CONTEXT_WINDOWS['default'];
    const memoized = contextWindowMemo.get(modelId);
    if (memoized != null) return memoized;

    let window;
    // Prefer live model registry data (populated from pi --list-models).
    // Exact id first; then the longest registry id embedded in modelId
    // (Bedrock-style "us.anthropic.claude-x" ids — longest wins so a generic
    // family entry can't shadow a specific one); then treat modelId as an
    // alias for dated versions ("claude-x" → "claude-x-20250929"), same
    // boundary rule as isModelEnabled — a bare substring match here resolved
    // e.g. "gpt-4" to "gpt-4o" and reported the wrong window.
    if (modelsCache) {
      const longest = (ms: AvailableModel[]) => ms.reduce((a, b) => (b.id.length > a.id.length ? b : a), ms[0]);
      const m = modelsCache.find(m => m.id === modelId)
        || longest(modelsCache.filter(m => modelId.includes(m.id)))
        || longest(modelsCache.filter(m => m.id.startsWith(modelId + '-')));
      if (m?.contextWindow) window = m.contextWindow;
    }
    if (!window) {
      for (const [prefix, size] of CONTEXT_WINDOW_FALLBACKS) {
        if (modelId.includes(prefix)) { window = size; break; }
      }
    }
    window = window || MODEL_CONTEXT_WINDOWS['default'];
    contextWindowMemo.set(modelId, window);
    return window;
  }

  // Derive window/percent at read time rather than inside the session-info
  // cache — the models cache warms up asynchronously and would otherwise be
  // baked stale into cached entries.
  function withContext<T extends Readonly<SessionInfo>>(info: T) {
    return withSessionContext(info, getContextWindow);
  }

  function parseSessionFile(source: SessionSource) {
    return withContext(getSessionInfo(source));
  }

  // =========================================================================
  // Session listing
  // =========================================================================

  /**
   * Active sessions = sessions registered by the pi-dish-bridge extension.
   * We enrich the registry entry with metadata from the on-disk JSONL.
   */
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
      // Multiple simultaneous v2 bridge instances for one logical history are
      // visible but not controllable until exact launch evidence selects one.
      const conflicted = instances.length !== 1;
      const reg = instances.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
      const identity = registryIdentity(reg)!;
      const ownedSpawn = tmux.getSpawn(routeId);
      const closeMode = getHarness(identity.harnessId)!.closeMode;
      const restartAllowed = spawnAllowsRestart(ownedSpawn, reg, closeMode);
      let info: SessionInfo | null = null;
      let source: SessionSource | null = null;
      if (reg.sessionFile && fs.existsSync(reg.sessionFile as fs.PathLike)) {
        try {
          source = sourceForIdentity(identity.harnessId, identity.nativeSessionId, reg.sessionFile as string);
          info = getSessionInfo(source);
        } catch {}
      }
      active.push(registeredSessionObservation(reg, {
        ...identity, source, info,
        advice: {
          capabilities: sessionCapabilities(identity.harnessId, (reg.capabilities || {}) as AdvertisedCapabilities, {
            active: true, conflicted,
            closeAllowed: spawnAllowsManagedClose(ownedSpawn, reg, closeMode),
            restartAllowed: !!getRPCSession(routeId)?.alive || restartAllowed,
          }),
          closeMode, conflicted, liveInstanceCount: instances.length,
        },
      }));
      seen.add(routeId);
    }

    // Sessions spawned by pi-dish via RPC may not be visible through the bridge
    // extension in all pi versions/modes. Include them directly so a freshly
    // created UI session still shows its resolved default model and remains
    // model-switchable.
    for (const rpc of getAllRPCSessions()) {
      if (!rpc.alive || seen.has(rpc.id)) continue;
      let info: SessionInfo | null = null;
      let source: SessionSource | null = null;
      const rpcFile = rpc.sessionFile || rpc.state?.sessionFile;
      if (rpcFile && fs.existsSync(rpcFile as fs.PathLike)) {
        try {
          source = sourceForIdentity('pi', rpc.id, rpcFile as string);
          info = getSessionInfo(source);
        } catch {}
      }
      active.push(rpcSessionObservation(rpc, {
        nativeSessionId: rpc.id, source, info,
        advice: {
          capabilities: sessionCapabilities('pi', {}, { active: true, restartAllowed: true }),
          closeMode: getHarness('pi')!.closeMode, conflicted: false, liveInstanceCount: 1,
        },
      }));
      seen.add(rpc.id);
    }

    return active;
  }

  const catalogOptions: SessionCatalogOptions = {
    harnesses: new Map(listHarnesses().map(descriptor => [descriptor.id, descriptor])),
    contextWindowForModel: getContextWindow,
    canonicalPath: canonicalSessionPath,
    directoryExists: directory => fs.existsSync(directory),
  };

  function historicalAdvice(source: SessionSource, liveChild = false): CatalogAdvice {
    return {
      capabilities: {
        ...sessionCapabilities(source.harnessId, {}, { active: false }),
        ...(liveChild ? { resume: false } : {}),
      },
      closeMode: getHarness(source.harnessId)!.closeMode,
      conflicted: false, liveInstanceCount: 0,
    };
  }

  // Lifecycle and routine callers need only current observations: no historical
  // corpus or live-child traversal follows from this active projection.
  function getActiveSessions(registered: readonly BridgeRegistryEntry[] = listRegisteredSessions()): readonly CatalogSession[] {
    return composeSessionCatalog({
      active: collectActiveObservations(registered), history: [],
      launchParents: new Map(), routines: new Map(), activeOnly: true,
      indexing: false, discoveryTruncated: false, discoverySkipped: 0,
    }, catalogOptions).active;
  }


  // Bound first-poll full reads of previously unseen live child histories.
  const SUBSESSION_ROW_CAP = 64;

  function enumerateSessionCandidates(excludeIds: ReadonlySet<string> = new Set()): DiscoveryCandidate[] {
    return discoverHarnessSessions().candidates.filter(candidate =>
      !excludeIds.has(routeSessionId(candidate.harnessId, candidate.nativeSessionId)));
  }

  // =========================================================================
  // Search
  // =========================================================================

  // null when the session doesn't match; { snippet } when it does. `snippet`
  // is set only for matches the metadata alone doesn't explain — the client
  // shows it under the row so a content match doesn't look arbitrary. Queries
  // speak the shared grammar (parseSessionQuery in helper-query.js): negations and
  // field terms are metadata-only, so only positive plain terms can justify
  // the content read.
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

  // Results are relevance-ordered (scoreSessionMatch in helper-query.js), recency
  // only breaking ties: a recency-sorted list buries the session you meant
  // under every transcript that happens to mention one of the words. Ranking
  // needs occurrence counts for *every* match, including the ones metadata
  // already explained, so the content read widens past matchSessionQuery's.
  // Queries with no positive plain term can't score (field/date terms are
  // filters) — those keep the incoming order untouched.
  function filterSessionsByQuery(list: readonly CatalogSession[], query: string): readonly CatalogSession[] {
    const parsed = parseSessionQuery(query);
    if (!parsed.terms.length && parsed.since === null && parsed.before === null) return list;
    const rank = positiveQueryTokens(parsed).length > 0;
    const out: CatalogSession[] = [];
    for (const session of list) {
      const m = matchSessionQuery(session, parsed);
      if (!m) continue;
      if (!rank) { out.push(session); continue; }
      const text = m.text ?? (session.sessionFile ? sessionIndex.getSearchText(sourceForIdentity(
        session.harnessId, session.nativeSessionId, session.sessionFile)) : null);
      const entry: CatalogSession & { searchScore: number } = { ...session, searchScore: scoreSessionMatch(parsed, session, text) };
      if (m.snippet) entry.searchSnippet = m.snippet;
      out.push(entry);
    }
    if (rank) {
      out.sort((a, b) => b.searchScore! - a.searchScore!
        || new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime());
    }
    return out;
  }

  // =========================================================================
  // API Routes
  // =========================================================================

  // `active=1` skips the historical-tree scan entirely — the sidebar's Active
  // tab polls every 10s and would otherwise stat every JSONL just to discard
  // the result. It still answers with `children`: the subagent sessions running
  // inside those live sessions, which no registry can report (see
  // liveSubsessionCandidates). On a full list they are already in `previous`,
  // so they are stamped there instead of sent twice.
  // The browser list uses public presentation/control fields only. Keep the
  // default response unchanged for API/CLI consumers that inspect provenance or
  // file-system metadata; `view=client` avoids transferring and retaining it on
  // every sidebar poll.
  function clientSessionRows(rows: readonly CatalogSession[]) {
    return rows.map(session => sessionForClient(session));
  }

  app.get('/api/sessions', (req: ApplicationRequest, res: ApplicationResponse) => {
    const query = ((req.query.q || '') as string).trim().toLowerCase();
    let { active, previous, children, indexing, discoveryTruncated, discoverySkipped } =
      buildSessionCatalog({ activeOnly: req.query.active === '1' });

    if (query) {
      active = filterSessionsByQuery(active, query);
      previous = filterSessionsByQuery(previous, query);
      children = filterSessionsByQuery(children, query);
    }
    const response: CatalogListResponse = { active, previous, children, indexing, discoveryTruncated, discoverySkipped };
    if (req.query.view === 'client') {
      response.active = clientSessionRows(active);
      response.previous = clientSessionRows(previous);
      response.children = clientSessionRows(children);
    }
    res.json(response);
  });

  // Coarse capacity for the fleet view and for agents choosing a host: one
  // shared on-demand snapshot plus this host's live-session counts, from the
  // same active-only composition the sidebar's Active poll uses. No history is
  // kept; a viewer that wants a trend polls while it is open.
  const hostHealth = createHostHealth();
  app.get('/api/host/health', async (_req: ApplicationRequest, res: ApplicationResponse) => {
    try {
      const health = await hostHealth.read();
      const { active, children } = buildSessionCatalog({ activeOnly: true });
      const byHarness: Record<string, number> = {};
      for (const session of active) byHarness[session.harnessId] = (byHarness[session.harnessId] || 0) + 1;
      res.json({
        ...health,
        sessions: {
          live: active.length,
          working: active.filter(session => session.turnInProgress).length,
          waiting: active.filter(session => session.askPending).length,
          subagents: children.length,
          byHarness,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Refs resolve through the shared rule in lib/helper-refs.js (route id and
  // alias, exact then prefix — see the comment there), so GET
  // /api/sessions/resolve, the `#ref` prompt expansion, the skill CLIs' local
  // fallback and the browser's picker cannot disagree about what a ref means.
  // An active entry wins a collision with a historical one of the same id.
  // `exactOnly` serves the machine-produced `<hostId>:<fullId>` form, whose id
  // is whole — expanding a prefix there could retarget a recorded ref.
  function resolveRefInCatalog(catalog: SessionCatalog, ref: unknown, exactOnly = false) {
    return resolveSessionRefAmong(catalog.list, ref, { exactOnly });
  }

  // Session refs: resolve a short id prefix to one full list entry. Registered
  // ahead of every /api/sessions/:id route so the literal path can never be
  // captured as an id. The candidate set is exactly what GET /api/sessions
  // serves (buildSessionCatalog = active + historical, each already carrying
  // its withContext treatment); an active entry wins a collision with a
  // historical one of the same id.
  app.get('/api/sessions/resolve', (req: ApplicationRequest, res: ApplicationResponse) => {
    const ref = String(req.query.id ?? '').trim();
    if (!ref) return res.status(400).json({ error: 'id is required' });
    if (ref.length < 4) return res.status(400).json({ error: 'id prefix must be at least 4 characters' });

    const catalog = buildSessionCatalog();
    const { session, matches } = resolveRefInCatalog(catalog, ref);
    // `ref` is the handle a caller should keep and paste instead of a
    // 100-character encoded route id — shortened only where a *different*
    // identifier can name the session, never by truncating the route id.
    if (session) return res.json({ session, ref: stableSessionRef(session.id, catalog.list.map((entry) => entry.id)) });
    if (matches.length > 1) {
      return res.status(409).json({
        error: 'ambiguous session id prefix',
        matches: matches.slice(0, 10).map((match) => ({
          id: match.id,
          name: match.name,
          cwd: match.cwd || null,
          lastActivity: match.lastActivity,
          isActive: !!match.isActive,
        })),
      });
    }
    res.status(404).json({ error: 'Session not found' });
  });

  function canonicalSessionPath(file: string | null): string | null {
    if (!file) return null;
    try { return fs.realpathSync(file); } catch { return path.resolve(file); }
  }

  function relationSessionSummary(session: CatalogSession): CatalogRelationSummary {
    return {
      id: session.id,
      sessionKey: session.sessionKey,
      harnessId: session.harnessId || 'pi',
      nativeSessionId: session.nativeSessionId || session.id,
      name: session.name,
      cwd: session.cwd || null,
      model: session.model || 'unknown',
      isActive: !!session.isActive,
      subagentLive: !!session.subagentLive,
      // Busy state + capability advice let a viewer signal a relative without
      // becoming it (steer vs prompt vs disabled), under the same advisory
      // non-authority as the rest of the summary.
      turnInProgress: !!session.turnInProgress,
      capabilities: session.capabilities || null,
      lastActivity: session.lastActivity,
    };
  }

  function buildSessionCatalog({ activeOnly = false }: { activeOnly?: boolean } = {}): SessionCatalog {
    const registered = listRegisteredSessions();
    const active = collectActiveObservations(registered);
    const liveChildren = liveSubsessionCandidates(active.map(observation => ({
      id: observation.id, harnessId: observation.harnessId, sessionFile: observation.claimedFile,
    })));
    const history: CatalogHistoryObservation[] = [];
    let indexing = false, discoveryTruncated = false, discoverySkipped = 0;
    if (activeOnly) {
      for (const source of liveChildren) {
        if (history.length >= SUBSESSION_ROW_CAP) break;
        try {
          history.push({ source, info: getSessionInfo(source), liveChild: true, advice: historicalAdvice(source, true) });
        } catch {}
      }
    } else {
      try {
        const discovery = discoverHarnessSessions();
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
          if (!info) continue;
          const liveChild = liveIds.has(source.routeId);
          history.push({ source, info, liveChild, advice: historicalAdvice(source, liveChild) });
        }
      } catch (error) { console.error('Error scanning sessions:', error); }
    }
    return composeSessionCatalog({
      active, history, activeOnly, indexing, discoveryTruncated, discoverySkipped,
      launchParents: decodeLaunchParents(sessionProvenance.readLaunches()),
      routines: decodeRoutineAnnotations(routinesStore.invocationsBySessionId()),
    }, catalogOptions);
  }

  // Advisory relationships only: native parentSession headers, OMP's nested
  // subsession layout, and pi-dish-side launch provenance. None implies
  // ownership or control rights.
  app.get('/api/sessions/:id/related', (req: ApplicationRequest, res: ApplicationResponse) => {
    try {
      const base = buildSessionCatalog();
      const catalog = { ...base, list: [...base.list], byId: new Map<string, CatalogSession>(base.byId), byPath: new Map<string | null, CatalogSession>(base.byPath) };
      let current = catalog.byId.get(req.params.id);
      if (!current) {
        const candidate = resolveSessionCandidate(req.params.id);
        if (!candidate) return res.status(404).json({ error: 'Session not found' });
        current = buildSourceSession(candidate, getSessionInfo(candidate), historicalAdvice(candidate), catalogOptions);
        catalog.byId.set(current.id, current);
        catalog.byPath.set(canonicalSessionPath(candidate.file), current);
        catalog.list.push(current);
      }

      const relatedCurrent = current;
      const relations: CatalogRelation[] = [];
      const seen = new Set<string>();
      const add = (kind: CatalogRelation['kind'], source: string, target: CatalogSession | null | undefined) => {
        if (!target || target.id === relatedCurrent.id) return;
        const key = `${kind}:${source}:${target.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        relations.push({ kind, source, session: relationSessionSummary(target) });
      };
      const resolveParent = (session: CatalogSession | null | undefined) => {
        if (!session?.parentSession || !session.sessionFile) return null;
        const parentPath = path.isAbsolute(session.parentSession)
          ? session.parentSession : path.resolve(path.dirname(session.sessionFile), session.parentSession);
        return catalog.byPath.get(canonicalSessionPath(parentPath)) || null;
      };

      add('parent', current.parentSessionSource || 'pi-session-header', resolveParent(current));
      for (const candidate of catalog.list) {
        if (resolveParent(candidate)?.id === current.id) {
          add('child', candidate.parentSessionSource || 'pi-session-header', candidate);
        }
      }

      const launch = sessionProvenance.getLaunch(current.id);
      if (launch) add('startedFrom', 'pi-dish-launch', catalog.byId.get(launch.sourceSessionId));
      for (const child of sessionProvenance.getLaunchesFrom(current.id)) {
        add('startedHere', 'pi-dish-launch', catalog.byId.get(child.sessionId));
      }

      res.json({
        session: relationSessionSummary(current),
        relations,
        indexing: catalog.indexing,
        discoveryTruncated: catalog.discoveryTruncated,
        discoverySkipped: catalog.discoverySkipped,
      });
    } catch (e) {
      const status = /Invalid session ID|Unknown harness/.test(property(e, 'message') as string) ? 400 : 500;
      res.status(status).json({ error: property(e, 'message') });
    }
  });

  // Recursive family view behind the subagents viewer: the whole native/launch
  // family around a session rather than /related's direct neighbors. Same
  // advisory sources and the same non-authority — edges label provenance
  // (subagent header/layout vs pi-dish launch), never control rights.
  const LINEAGE_NODE_CAP_DEFAULT = 500;
  const LINEAGE_DEPTH_CAP = 24;
  app.get('/api/sessions/:id/lineage', (req: ApplicationRequest, res: ApplicationResponse) => {
    try {
      const nodeCap = (() => {
        const parsed = Number.parseInt(process.env.PI_DISH_LINEAGE_NODE_CAP || '', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : LINEAGE_NODE_CAP_DEFAULT;
      })();
      const catalog = buildSessionCatalog();
      let list = catalog.list;
      let byId: ReadonlyMap<string, CatalogSession> = catalog.byId;
      const byPath: ReadonlyMap<string | null, CatalogSession> = catalog.byPath;
      let current = byId.get(req.params.id);
      if (!current) {
        const candidate = resolveSessionCandidate(req.params.id);
        if (!candidate) return res.status(404).json({ error: 'Session not found' });
        current = buildSourceSession(candidate, getSessionInfo(candidate), historicalAdvice(candidate), catalogOptions);
        // Mirror composeSessionCatalog's parent resolution for a row the scan
        // has not folded in yet (indexing race): native header first, launch
        // provenance second.
        let nativeParent: SessionId | null = null;
        if (current.parentSession && current.sessionFile) {
          const parentFile = path.isAbsolute(current.parentSession) ? current.parentSession
            : path.resolve(path.dirname(current.sessionFile), current.parentSession);
          nativeParent = byPath.get(canonicalSessionPath(parentFile))?.id || null;
        }
        const launch = sessionProvenance.getLaunch(current.id);
        current.parentId = nativeParent
          || (launch && byId.has(launch.sourceSessionId) ? launch.sourceSessionId : null);
        current.parentSource = nativeParent ? current.parentSessionSource || 'pi-session-header'
          : current.parentId ? 'pi-dish-launch' : null;
        list = [...list, current];
        const extendedById = new Map(byId);
        extendedById.set(current.id, current);
        byId = extendedById;
      }

      const childrenOf = new Map<string, CatalogSession[]>(); // parentId -> CatalogSession[]
      for (const session of list) {
        if (!session.parentId || session.parentId === session.id) continue;
        const siblings = childrenOf.get(session.parentId);
        if (siblings) siblings.push(session); else childrenOf.set(session.parentId, [session]);
      }
      const activityMs = (session: CatalogSession) => {
        const value = new Date(session.lastActivity || 0).getTime();
        return Number.isFinite(value) ? value : 0;
      };

      // The top ancestor owns the root slot. Cycle-guarded: hand-edited headers
      // can point two files at each other.
      let root: CatalogSession = current;
      const ancestors = new Set<string>([current.id]);
      while (root.parentId) {
        const parent = byId.get(root.parentId);
        if (!parent || ancestors.has(parent.id)) break;
        ancestors.add(parent.id);
        root = parent;
      }

      const placed = new Set<SessionId>();
      let members = 0, truncated = false;
      const buildNode = (session: CatalogSession, edge: CatalogLineageEdge | null, depth: number): CatalogLineageNode | null => {
        if (placed.has(session.id)) return null;
        if (depth > LINEAGE_DEPTH_CAP || members >= nodeCap) { truncated = true; return null; }
        placed.add(session.id);
        members += 1;
        const children: CatalogLineageNode[] = [];
        for (const child of (childrenOf.get(session.id) || []).sort((a, b) => activityMs(b) - activityMs(a))) {
          const node = buildNode(child, {
            kind: child.parentSource === 'pi-dish-launch' ? 'startedHere' : 'child',
            source: child.parentSource || 'pi-session-header',
          }, depth + 1);
          if (node) children.push(node);
        }
        return { session: relationSessionSummary(session), edge, children };
      };
      const tree = buildNode(root, null, 0);

      res.json({
        session: relationSessionSummary(current),
        tree,
        members,
        truncated,
        indexing: catalog.indexing,
        discoveryTruncated: catalog.discoveryTruncated,
        discoverySkipped: catalog.discoverySkipped,
      });
    } catch (e) {
      const status = /Invalid session ID|Unknown harness/.test(property(e, 'message') as string) ? 400 : 500;
      res.status(status).json({ error: property(e, 'message') });
    }
  });

  // Advanced search (the main-pane takeover): one flat result list over every
  // session, same grammar as the sidebar, but with *multiple* snippets and an
  // occurrence count per content match — the sidebar's single snippet is a
  // row decoration; this is the primary content. Metadata-matched sessions
  // still get snippets when the positive tokens also occur in their content
  // (a name hit with 12 transcript mentions should show them). Relevance order
  // (scoreSessionMatch, recency as tiebreak — a query with no positive plain
  // term scores 0 everywhere and stays purely recency-ordered), capped;
  // `total` tells the client when the cap truncated. Saved scopes are
  // a separate, metadata/date-only query because their active set is local to
  // each device; apply it here before sorting and truncation.
  const SEARCH_RESULT_CAP = 100;
  app.get('/api/search', (req: ApplicationRequest, res: ApplicationResponse) => {
    const query = ((req.query.q || '') as string).trim().toLowerCase();
    const scopeQuery = String(req.query.scope || '').trim().toLowerCase();
    const { active, previous, indexing, discoveryTruncated, discoverySkipped } = buildSessionCatalog();
    const parsed = parseSessionQuery(query);
    const scopeParsed = parseSessionQuery(scopeQuery);
    const hasScope = scopeParsed.terms.length || scopeParsed.since !== null || scopeParsed.before !== null;
    // Routine runs are cron noise in a human's results (every invocation is a
    // session), so the browser asks for inactive ones to be dropped unless the
    // query — or an active scope, which arrives as its own parsed query —
    // affirmatively asks for them (`is:automation`, `routine:name`). A param,
    // not a default flip: API/CLI consumers keep the inclusive corpus, the
    // same contract `view=client` keeps for /api/sessions. Applied before
    // scoring and the result cap so the cap is never spent on rows the client
    // would drop.
    const hideAutomation = req.query.hideAutomation === '1'
      && !queryAsksForAutomation(parsed) && !(hasScope && queryAsksForAutomation(scopeParsed));
    const contentTokens = positiveQueryTokens(parsed);
    // Ranked rows carry the text they were scored against, so snippets and the
    // occurrence count are built only for the rows the cap keeps. A query
    // matching hundreds of sessions used to build up to four snippets for
    // every one of them and then discard all but the top 100; scoring and the
    // sort are untouched, so the response is identical.
    const ranked: Array<{ session: CatalogSession; text: string | null; searchScore: number }> = [];
    let hiddenByScopes = 0;
    let hiddenByAutomation = 0;
    for (const session of [...active, ...previous]) {
      if (hideAutomation && !session.isActive && isAutomationSession(session)) {
        hiddenByAutomation++;
        continue;
      }
      let text: string | null = null;
      if (!evaluateSessionQuery(parsed, session)) {
        if (!contentTokens.length || !session.sessionFile) continue;
        text = sessionIndex.getSearchText(sourceForIdentity(
          session.harnessId, session.nativeSessionId, session.sessionFile));
        if (!evaluateSessionQuery(parsed, session, text)) continue;
      }
      if (hasScope && !evaluateSessionQuery(scopeParsed, session)) {
        hiddenByScopes++;
        continue;
      }
      if (contentTokens.length && session.sessionFile) {
        text ??= sessionIndex.getSearchText(sourceForIdentity(
          session.harnessId, session.nativeSessionId, session.sessionFile));
      }
      ranked.push({ session, text, searchScore: scoreSessionMatch(parsed, session, text) });
    }
    ranked.sort((a, b) => b.searchScore - a.searchScore
      || new Date(b.session.lastActivity || 0).getTime() - new Date(a.session.lastActivity || 0).getTime());
    const results = ranked.slice(0, SEARCH_RESULT_CAP).map(({ session, text, searchScore }) => {
      let snippets: string[] = [], matchCount = 0;
      if (text) ({ snippets, count: matchCount } = buildSnippets(text, contentTokens));
      return { ...session, snippets, matchCount, searchScore };
    });
    res.json({
      results,
      total: ranked.length,
      hiddenByScopes,
      hiddenByAutomation,
      indexing,
      discoveryTruncated,
      discoverySkipped,
    });
  });

  function readDishSettings(): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(DISH_SETTINGS_FILE, 'utf8'));
      return value && typeof value === 'object' ? value as Record<string, unknown> : {};
    } catch { return {}; }
  }
  function writeDishSettings(settings: Record<string, unknown>) {
    fs.mkdirSync(path.dirname(DISH_SETTINGS_FILE), { recursive: true });
    const tmp = `${DISH_SETTINGS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n'); fs.renameSync(tmp, DISH_SETTINGS_FILE);
  }

  app.get('/api/usage-summary', featureHandlers.usageSummary);

  app.get('/api/usage-limits', featureHandlers.usageLimits);
  app.get('/api/cache-lifetimes', featureHandlers.cacheLifetimes);

  // =========================================================================
  // Skills view (main-pane takeover) — inventory from pi's loader + activation
  // rollups mined into the session index. Observational only: every token
  // number is a chars/4 estimate, every usage number is inferred from tool
  // calls. See TASKS/skills-view-phase1.md.
  // =========================================================================

  app.get('/api/skills', featureHandlers.skills);
  app.get('/api/skills/activations', featureHandlers.skillActivations);
  app.get('/api/skills/coverage', featureHandlers.skillCoverage);

  app.get('/api/settings', featureHandlers.settings);
  // Partial update: only the keys present in the body change, so the budget
  // form and the saved-filters UI can't clobber each other's setting.
  app.put('/api/settings', featureHandlers.updateSettings);


  app.get('/api/sessions/:id/messages/:messageId/images/:blockIndex', sessionReadHandlers.image);

  app.get('/api/sessions/:id/messages', sessionReadHandlers.messages);

  app.get('/api/sessions/:id/search', sessionReadHandlers.search);

  // Normalize client-sent attachments to pi's ImageContent shape, dropping
  // anything malformed rather than failing the whole prompt.
  const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
  function sanitizeImages(images: unknown) {
    if (!Array.isArray(images)) return [];
    return images
      .filter((i: unknown) => i && typeof property(i, 'data') === 'string' && BASE64_RE.test(property(i, 'data') as string) && typeof property(i, 'mimeType') === 'string' && (property(i, 'mimeType') as string).startsWith('image/'))
      .map((i: unknown) => ({ type: 'image', data: property(i, 'data'), mimeType: property(i, 'mimeType') }));
  }

  // The dependency bundle for lib/session-refs.js. Cheap to build — the catalog
  // is only read once a prompt actually carries a `#ref` — so the routes can
  // hand one over unconditionally.
  function sessionRefDeps(): SessionRefDependencies {
    let catalog: SessionCatalog | null = null;
    return {
      selfHostId: hostIdentity.getHostId(),
      resolveLocal: (id, exactOnly) => {
        if (!catalog) catalog = buildSessionCatalog();
        return resolveRefInCatalog(catalog, id, exactOnly).session;
      },
      fleetNames: () => remoteHosts.listRemotes().map((remote) => remote.name),
    };
  }

  app.post('/api/sessions/:id/prompt', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const message = property(req.body, 'message');
    const deliverAs = property(req.body, 'deliverAs');
    const images = sanitizeImages(property(req.body, 'images'));
    if (!message && !images.length) return res.status(400).json({ error: 'Message required' });
    if (deliverAs != null && deliverAs !== 'steer' && deliverAs !== 'followUp') {
      return res.status(400).json({ error: 'deliverAs must be steer or followUp' });
    }
    try {
      const sess = await getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      const capability = deliverAs === 'steer' ? 'steer' : deliverAs === 'followUp' ? 'followUp' : 'prompt';
      if (!liveSessionSupports(sess, capability)) {
        return res.status(409).json({ error: `This session does not support ${capability}.` });
      }
      const opts: NonNullable<Parameters<LiveSession['prompt']>[1]> = deliverAs ? { deliverAs } : {};
      if (images.length) opts.images = images;
      const result = await sess.prompt(expandSessionRefs(message, property(req.body, 'refs'), sessionRefDeps()), opts);
      res.json({ success: true, result });
    } catch (e) {
      res.status(500).json({ error: property(e, 'message') });
    }
  });

  app.post('/api/sessions/:id/steer', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const message = property(req.body, 'message');
    const images = sanitizeImages(property(req.body, 'images'));
    if (!message && !images.length) return res.status(400).json({ error: 'Message required' });
    try {
      const sess = await getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (!liveSessionSupports(sess, 'steer')) return res.status(409).json({ error: 'This session does not support steering.' });
      const result = await sess.steer(
        expandSessionRefs(message, property(req.body, 'refs'), sessionRefDeps()),
        images.length ? { images } : {});
      res.json({ success: true, result });
    } catch (e) {
      res.status(500).json({ error: property(e, 'message') });
    }
  });

  // Explicit semantic follow-up endpoint for agents and other non-browser
  // clients. The existing prompt route remains backward compatible.
  app.post('/api/sessions/:id/follow-up', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const message = property(req.body, 'message');
    const images = sanitizeImages(property(req.body, 'images'));
    if (!message && !images.length) return res.status(400).json({ error: 'Message required' });
    try {
      const sess = await getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (!liveSessionSupports(sess, 'followUp')) return res.status(409).json({ error: 'This session does not support follow-ups.' });
      const opts: NonNullable<Parameters<LiveSession['prompt']>[1]> = { deliverAs: 'followUp' };
      if (images.length) opts.images = images;
      const result = await sess.prompt(expandSessionRefs(message, property(req.body, 'refs'), sessionRefDeps()), opts);
      res.json({ success: true, result });
    } catch (e) {
      res.status(500).json({ error: property(e, 'message') });
    }
  });

  // Remove a not-yet-delivered queued steer/follow-up so its text can go back to
  // the composer. Bridge-only (pi's queue arrays live inside the process); RPC
  // sessions have no remote queue-editing path.
  app.post('/api/sessions/:id/queue/cancel', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const body = req.body || {};
    const kind = property(body, 'kind');
    const index = property(body, 'index');
    const text = property(body, 'text');
    const validationError = (kind !== 'steering' && kind !== 'followUp')
      || typeof text !== 'string' || !text
      ? 'kind (steering|followUp) and non-empty text required'
      : !Number.isInteger(index) || (index as number) < 0
        ? 'index must be a non-negative integer'
        : null;
    try {
      const sess = await getLiveSession(req.params.id);
      if (!sess) {
        if (validationError) return res.status(400).json({ error: validationError });
        return res.status(404).json({ error: 'Session not active' });
      }
      if (!(sess instanceof BridgeSession)) {
        return res.status(501).json({ error: 'queue editing requires the pi-dish-bridge extension' });
      }
      if (!liveSessionSupports(sess, 'queueCancel')) {
        return res.status(409).json({ error: 'This session does not support queue cancellation.' });
      }
      if (validationError) return res.status(400).json({ error: validationError });
      const result = await sess.cancelQueued(kind as 'steering' | 'followUp', index as number, text as string);
      res.json({ success: true, result });
    } catch (e) {
      res.status(409).json({ error: property(e, 'message') });
    }
  });


  async function runRpcSlashCommand(rpc: InstanceType<typeof RPCSession>, message: string): Promise<{ info?: unknown }> {
    const spaceIdx = message.indexOf(' ');
    const name = (spaceIdx === -1 ? message.slice(1) : message.slice(1, spaceIdx)).trim();
    const args = spaceIdx === -1 ? '' : message.slice(spaceIdx + 1).trim();

    switch (name) {
      case 'compact': {
        // pi's compact() aborts the agent and rewrites its message list — a
        // second compact issued while one runs (auto-compaction included)
        // races that rewrite. The flag tracks pi's own compaction events plus
        // the in-flight request below.
        if (rpc.compacting) throw new Error('Compaction already in progress — wait for it to finish.');
        rpc.compacting = true;
        try {
          const result = await rpc.compact(args || undefined);
          rpc._refreshStats();
          const saved = result ? ` (${property(result, 'tokensBefore')} → ~${property(result, 'estimatedTokensAfter')} tokens)` : '';
          return { info: `Compacted${saved}` };
        } finally {
          rpc.compacting = false;
        }
      }
      case 'abort':
        await rpc.abort();
        return { info: 'Aborted' };
      case 'name':
        if (!args) throw new Error('usage: /name <name>');
        await rpc.setName(args);
        return { info: 'Session renamed' };
      case 'thinking':
        if (!args) throw new Error('usage: /thinking <off|minimal|low|medium|high|xhigh>');
        await rpc.setThinkingLevel(args);
        return { info: `Thinking level: ${args}` };
      case 'model': {
        if (!args) throw new Error('usage: /model <provider/model-id>');
        let provider: unknown;
        let id: unknown;
        ({ provider, id } = parseModelId(args));
        if (!provider) {
          const data = await rpc.getAvailableModels();
          const models = optionalProperty(data, 'models') || [];
          const m = (models as { find(predicate: (entry: unknown) => unknown): unknown })
            .find(x => property(x, 'id') === args)
            || (models as { find(predicate: (entry: unknown) => unknown): unknown })
              .find(x => ((x as { [key: string]: unknown }).id as string).includes(args));
          if (!m) throw new Error(`model not found: ${args}`);
          provider = property(m, 'provider'); id = property(m, 'id');
        }
        await rpc.setModel(provider as string, id as string);
        return { info: `Model set to ${provider}/${id}` };
      }
      case 'new':
        await rpc.newSession();
        return { info: 'New session started' };
      case 'reload':
        // RPC `prompt` executes extension commands with a full command context
        // (the only remote path to ctx.reload()); the bridge extension registers
        // /dish-reload for exactly this.
        await rpc.prompt('/dish-reload');
        return { info: 'Reloading extensions...' };
      case 'export': {
        const data = await rpc.exportHtml(args || undefined);
        return { info: `Exported to ${optionalProperty(data, 'path') || 'HTML'}` };
      }
      default: {
        // Extension commands, skills, and prompt templates are handled natively
        // by RPC prompt. Verify the command exists first so typos (or TUI-only
        // built-ins) don't get sent to the model as literal text.
        const data = await rpc.getCommands().catch(() => null);
        const known = new Set<unknown>(
          (((data as { [key: string]: unknown })?.commands || []) as { map(callback: (entry: unknown) => unknown): unknown })
            .map(c => property(c, 'name')) as Iterable<unknown>,
        );
        if (!known.has(name)) throw new Error(`unknown or unsupported command: /${name}`);
        await rpc.prompt(message);
        return {};
      }
    }
  }

  app.post('/api/sessions/:id/thinking', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const body = req.body || {};
    const level = property(body, 'level');
    // Cheap gate against the union of every harness's vocabulary; once the
    // session's harness is known the per-harness check below decides.
    if (!ALL_THINKING_LEVEL_NAMES.includes(level as string)) {
      return res.status(400).json({ error: `level must be one of: ${ALL_THINKING_LEVEL_NAMES.join(', ')}` });
    }
    try {
      const sess = await getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (!liveSessionSupports(sess, 'setThinking')) {
        return res.status(409).json({ error: 'This session does not support changing thinking level.' });
      }
      const levels = thinkingLevelNamesFor((property(sess, 'harnessId') || 'pi') as string);
      if (!levels.includes(level as string)) {
        return res.status(400).json({ error: `level must be one of: ${levels.join(', ')}` });
      }
      const data = await sess.setThinkingLevel(level as string);
      res.json(thinkingResult(data, level as string));
    } catch (e) {
      res.status(500).json({ error: property(e, 'message') });
    }
  });

  app.get('/api/sessions/:id/stats', sessionReadHandlers.stats);


  // Export any session (active or not) to a standalone HTML file.
  app.get('/api/sessions/:id/export', sessionReadHandlers.export);

  // =========================================================================
  // Public read-only share links
  // =========================================================================
  //
  // A share is a random token referencing either a sessionId or an immutable
  // native HTML snapshot (lib/shares.js). The management API lives on the main
  // app only; public GET /share/:token is mounted on both the main app and the
  // optional share listener (see startup). The route reveals nothing about
  // unknown/missing shares — every miss is a bare 404.


  // OMP's supported custom-share hook gives us the complete native HTML that
  // /share generated from the live session. Preserve that exact snapshot rather
  // than trying to reconstruct OMP-only metadata from historical JSONL.
  app.post('/api/shares/import', express.text({ type: 'text/html', limit: '20mb' }), publicationHandlers.importShare);

  app.post('/api/sessions/:id/share', publicationHandlers.createShare);

  app.delete('/api/sessions/:id/share', publicationHandlers.revokeShare);

  app.get('/api/sessions/:id/share', publicationHandlers.getShare);

  // Public route — always available on the main app (the share listener is opt-in).
  app.get('/share/:token', publicationHandlers.serveSharedSession);

  // =========================================================================
  // Anchored comments (lib/comments.js)
  // =========================================================================
  //
  // The browser creates comments from a selected file/prose range or diff
  // lines. When the user later asks the agent to read comments, the
  // pi-dish-comments skill lists the open index, fetches whichever related ids
  // it needs, and acknowledges completed items. Creating a comment never
  // prompts, steers, or starts an agent turn.

  app.use('/api/comments', relayHandlers.comments);

  app.post('/api/comments', publicationHandlers.createComment);

  // Lightweight, unpaginated inventory. It gives the agent enough location
  // and intent to infer useful groups without loading every full anchor/body.
  // Reading this index changes no comment state.
  app.get('/api/comments/index', publicationHandlers.commentIndex);

  app.get('/api/comments/count', publicationHandlers.commentCount);

  // Fetch an agent-selected group from the inventory. This is a state-free
  // read; acknowledgment remains a separate, explicit close operation.
  app.post('/api/comments/get', publicationHandlers.getComments);

  // Editing/deleting is the user's own correction path from the views the
  // comment was written in. Acknowledged comments are the agent's record and
  // stay immutable — a late edit would silently change what was acted on.
  app.patch('/api/comments/:id', publicationHandlers.updateComment);

  app.delete('/api/comments/:id', publicationHandlers.deleteComment);

  app.post('/api/comments/:id/ack', publicationHandlers.acknowledgeComment);

  // =========================================================================
  // Published pages (lib/pages.js)
  // =========================================================================
  //
  // Agents write an HTML artifact (plan explainer, report) to disk, then point
  // the server at it: POST /api/pages { path } from the agent's shell
  // (`curl localhost:3333/api/pages …`) or the file viewer's publish button.
  // The public GET /page/:token serves the content *live from disk* (an edited
  // plan shows fresh on refresh) and is mounted on both the main app and the
  // optional share listener, like /share. Unknown tokens are bare 404s.

  // Deliberately no path gate on registration: sharing governance rests with
  // the main app, which is assumed reachable only by trusted people (same
  // trust model as the rest of the API — anything on this port can already
  // drive agents with shell access, so a "no paths outside the workspace"
  // rule would only be theater: an agent can copy any file into its cwd).
  // The public share listener never registers, only serves known tokens.
  app.post('/api/pages', publicationHandlers.createPage);

  app.get('/api/pages', publicationHandlers.listPages);

  app.delete('/api/pages/:token', publicationHandlers.revokePage);

  // The public serving routes. File roots serve the file itself; directory
  // roots serve index.html at /page/:token/ (the bare token URL redirects so
  // the document's relative asset URLs resolve under the token) and contained
  // assets at /page/:token/<rel>. res.sendFile rejects `..` traversal and
  // absolute rests via its root option — every failure is a bare 404.
  app.get('/page/:token', publicationHandlers.page);
  app.get('/page/:token/*', publicationHandlers.pageAsset);

  // /reload against a bridge session, with two escape hatches:
  // - Bridges that fire the reload in the same tick as their run_command
  //   response lose the response frame to their own socket teardown — a
  //   "socket closed" rejection on /reload specifically is the signature of a
  //   reload that *started*, not a failure. Report success; the bridge
  //   re-registers itself after re-evaluating.
  // - Bridges that can't run it at all (no emulated reload / no captured
  //   AgentSession — exactly the state a running TUI is in when its loaded
  //   bridge predates the current one) fall back to typing /reload into the
  //   session's own tmux pane, when one can be located. Pi needs this to upgrade
  //   out-of-date bridges; OMP needs it because its public sendUserMessage API
  //   bypasses command dispatch; the pane executes the bridge's /dish-reload so
  //   OMP supplies the command context required by ctx.reload(). Other alternate
  //   wrappers still fail closed: their public API profile remains the lifecycle
  //   authority.
  async function reloadBridgeSession(sess: InstanceType<typeof BridgeSession>, sessionId: string) {
    let bridgeError: unknown = null;
    if (liveSessionSupports(sess, 'reload')) {
      try {
        const data = await sess.runCommand('/reload');
        return { info: optionalProperty(data, 'info') || 'Reloading extensions…' };
      } catch (e) {
        if (/socket closed/i.test((optionalProperty(e, 'message') || '') as string)) return { info: 'Reloading extensions…' };
        bridgeError = e;
      }
    }
    bridgeError ||= new Error('This session does not support remote extension reload.');
    if (sess.harnessId !== 'pi' && sess.harnessId !== 'omp') {
      Reflect.set(Object(bridgeError), 'statusCode', 409, bridgeError);
      throw bridgeError;
    }
    const pane = await locatePiPane(sessionId);
    if (!pane) {
      Reflect.set(Object(bridgeError), 'statusCode', 409, bridgeError);
      if (sess.harnessId === 'omp') {
        Reflect.set(Object(bridgeError), 'message', 'Oh My Pi extension reload requires a reachable tmux pane.', bridgeError);
      }
      throw bridgeError;
    }
    const paneCommand = sess.harnessId === 'omp' ? '/dish-reload' : '/reload';
    await tmux.sendKeys(pane.socket, pane.paneId, paneCommand);
    return { info: 'Sent /reload to the session’s tmux pane' };
  }

  function parseHostBuiltin(descriptor: HarnessDescriptor | null, message: string): ParsedHostBuiltin | null {
    if (!descriptor?.hostBuiltins?.length) return null;
    const trimmed = message.trim();
    const separator = trimmed.search(/\s/);
    const name = trimmed.slice(1, separator === -1 ? undefined : separator);
    const command = descriptor.hostBuiltins.find(candidate => candidate.name === name);
    if (!command) return null;
    if (/[\x00-\x1f\x7f]/.test(trimmed)) {
      const error: Error & { statusCode?: number } = new Error(`Invalid arguments for /${name}.`);
      error.statusCode = 400;
      throw error;
    }
    const args = separator === -1 ? '' : trimmed.slice(separator).trim();
    if (!args && command.requireArgs) {
      const error: Error & { statusCode?: number } = new Error(`/${name} requires arguments${command.args ? `; expected ${command.args}` : ''}.`);
      error.statusCode = 400;
      throw error;
    }
    // Blocked sub-forms are checked before free args are accepted: they are the
    // spellings that open a TUI overlay, which a remote pilot cannot answer. A
    // bare string blocks the sub-command and everything under it; `exact` blocks
    // only the argument-less form, whose arg'd spelling completes in place.
    const blockedEntry = command.blockedArgs?.find((entry) => {
      const value = typeof entry === 'string' ? entry : entry.arg;
      return args === value || (!property(entry, 'exact') && args.startsWith(`${value} `));
    });
    if (blockedEntry) {
      const blocked = typeof blockedEntry === 'string' ? blockedEntry : blockedEntry.arg;
      const error: Error & { statusCode?: number } = new Error(`/${name} ${blocked} is only available in the ${descriptor.label} terminal UI.`);
      error.statusCode = 400;
      throw error;
    }
    if (args && !command.freeArgs && !command.allowedArgs?.includes(args)) {
      const allowed = command.allowedArgs?.join(' or ');
      const error: Error & { statusCode?: number } = new Error(`Invalid arguments for /${name}${allowed ? `; expected ${allowed}` : ''}.`);
      error.statusCode = 400;
      throw error;
    }
    return { command, text: `/${name}${args ? ` ${args}` : ''}`, hasArgs: !!args };
  }

  // Host builtins execute by typing into the session's TUI pane. Like the
  // /reload fallback, the capability is a *reachable* pane (bridge tmux stamp,
  // recorded spawn placement, or pid walk — locatePiPane), not only a
  // pi-dish-owned one: sessions the user launched in their own tmux get the
  // same curated commands. The shared trade-off: send-keys appends to any
  // draft sitting in the TUI composer.
  async function hostBuiltinPane(sessionId: string, descriptor: HarnessDescriptor | null) {
    if (!descriptor?.hostBuiltins?.length) return null;
    return locatePiPane(sessionId);
  }

  async function runHostBuiltin(sessionId: string, descriptor: HarnessDescriptor, parsed: ParsedHostBuiltin) {
    const pane = await hostBuiltinPane(sessionId, descriptor);
    if (!pane) {
      const error: Error & { statusCode?: number } = new Error(`Host command /${parsed.command.name} requires a reachable ${descriptor.label} tmux pane.`);
      error.statusCode = 409;
      throw error;
    }
    await tmux.sendKeys(pane.socket, pane.paneId, parsed.text);
    if (parsed.hasArgs) {
      // OMP's subcommand autocomplete consumes the first Enter after an exact
      // argument such as "images". A second Enter submits the accepted command.
      await new Promise(resolve => setTimeout(resolve, 50));
      await tmux.sendKeys(pane.socket, pane.paneId, '');
    }
    return { info: `Sent ${parsed.text} to the session’s tmux pane` };
  }

  // Execute a slash command against an active session.
  app.post('/api/sessions/:id/command', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const message = property(req.body, 'message');
    const deliverAs = property(req.body, 'deliverAs');
    if (!message || !(message as string).startsWith('/')) {
      return res.status(400).json({ error: 'message must start with /' });
    }
    try {
      const sess = await getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (sess instanceof BridgeSession) {
        const descriptor = getHarness(sess.harnessId);
        const hostBuiltin = parseHostBuiltin(descriptor, message as string);
        if (hostBuiltin) {
          const result = await runHostBuiltin(req.params.id, descriptor!, hostBuiltin);
          return res.json({ success: true, info: result.info });
        }
        const compactMatch = (message as string).match(/^\/compact(?:\s+(.*))?\s*$/);
        if (compactMatch) {
          if (!liveSessionSupports(sess, 'compact')) {
            return res.status(409).json({ error: 'This session does not support compaction.' });
          }
          if (sess.compacting) throw new Error('Compaction already in progress — wait for it to finish.');
          // Raise the server-side guard before the bridge event arrives so two
          // concurrent HTTP requests cannot both pass it. compaction_end owns
          // the normal reset; a rejected socket operation never started.
          sess.compacting = true;
          try {
            const data = await sess.compact(compactMatch[1]?.trim() || undefined);
            return res.json({ success: true, info: optionalProperty(data, 'info') });
          } catch (error) {
            sess.compacting = false;
            throw error;
          }
        }
        // /btw awaits the ephemeral side turn inside the bridge call (unlike
        // /compact's fire-and-forget), so it rides run_command with a
        // prompt-scale timeout and returns the answer for the client to panel.
        const btwMatch = (message as string).match(/^\/btw(?:\s+([\s\S]*))?\s*$/);
        if (btwMatch) {
          if (!liveSessionSupports(sess, 'btw')) {
            return res.status(409).json({ error: 'This session does not support /btw.' });
          }
          if (!btwMatch[1]?.trim()) {
            return res.status(400).json({ error: 'usage: /btw <question>' });
          }
          const data = await sess.runCommand(message as string, undefined, { timeout: 180000 });
          return res.json({ success: true, info: optionalProperty(data, 'info'), answer: optionalProperty(data, 'answer') });
        }
        if (!liveSessionSupports(sess, 'commands')) {
          return res.status(409).json({ error: 'This session does not support remote commands.' });
        }
        if ((message as string).trim() === '/reload') {
          const result = await reloadBridgeSession(sess, req.params.id);
          return res.json({ success: true, info: result.info });
        }
        const data = await sess.runCommand(message as string, deliverAs as 'steer' | 'followUp' | undefined);
        return res.json({ success: true, info: optionalProperty(data, 'info') });
      }
      const result = await runRpcSlashCommand(sess, message as string);
      res.json({ success: true, info: result.info });
    } catch (e) {
      res.status((property(e, 'statusCode') || 400) as number).json({ error: property(e, 'message') });
    }
  });

  // Answer an extension UI dialog (select/confirm/input/editor).
  app.post('/api/sessions/:id/ui-response', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const body = req.body || {};
    const requestId = property(body, 'requestId');
    const value = property(body, 'value');
    const confirmed = property(body, 'confirmed');
    const cancelled = property(body, 'cancelled');
    if (!requestId) return res.status(400).json({ error: 'requestId required' });
    const response: ProtocolRecord = {};
    if (value !== undefined) response.value = value;
    if (confirmed !== undefined) response.confirmed = confirmed;
    if (cancelled !== undefined) response.cancelled = cancelled;
    try {
      const sess = await getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (!liveSessionSupports(sess, 'extensionUI')) {
        return res.status(409).json({ error: 'This session does not support remote extension UI.' });
      }
      await sess.respondExtensionUI(requestId as string, response);
      // RPC has no resolved event; acknowledge against the captured session.
      removeExtensionUIDialog(sess.extUIState, requestId);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: property(e, 'message') });
    }
  });

  app.post('/api/sessions/:id/rename', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const name = property(req.body, 'name');
    if (!name) return res.status(400).json({ error: 'Name required' });
    try {
      const sess = await getLiveSession(req.params.id);
      if (sess) {
        if (!liveSessionSupports(sess, 'rename')) {
          return res.status(409).json({ error: 'This session does not support renaming.' });
        }
        await sess.setName(name as string);
        const reg = getRegisteredSession(req.params.id);
        const spawn = tmux.getSpawn(req.params.id);
        const socket = optionalProperty(reg?.tmux, 'socket') || spawn?.socket;
        const pane = optionalProperty(reg?.tmux, 'pane') || spawn?.paneId;
        if (socket && pane) {
          await tmux.renameWindow(socket as string, pane as string, name).catch(() => {});
        }
        return res.json({ success: true });
      }
      const session = findSessionSource(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.harnessId !== 'pi') {
        return res.status(409).json({ error: 'Renaming an inactive session is only supported for Pi.' });
      }
      await piSDK.renameSession(session.file, name as string);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: property(e, 'message') });
    }
  });

  app.post('/api/sessions/:id/model', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const modelId = optionalProperty(req.body, 'modelId') || optionalProperty(req.body, 'model');
    if (!modelId) return res.status(400).json({ error: 'modelId or model required' });
    const { provider, id } = parseModelId(modelId as string);
    if (!provider || !id) return res.status(400).json({ error: `Invalid model ID: ${modelId}` });
    try {
      const sess = await getLiveSession(req.params.id);
      if (sess) {
        if (!liveSessionSupports(sess, 'setModel')) {
          return res.status(409).json({ error: 'This session does not support changing models.' });
        }
        // The two backends take different setModel shapes (bridge: one ref
        // string, RPC: provider + id on the wire).
        if (sess instanceof BridgeSession) await sess.setModel(`${provider}/${id}`);
        else await sess.setModel(provider, id);
        return res.json({ success: true });
      }
      // Inactive session: append a model_change entry to the JSONL directly.
      const session = findSessionSource(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.harnessId !== 'pi') {
        return res.status(409).json({ error: 'Changing the model of an inactive session is only supported for Pi.' });
      }
      await piSDK.switchModel(session.file, provider, id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: property(e, 'message') });
    }
  });

  app.get('/api/sessions/:id/tree', sessionReadHandlers.tree);

  // Bridge navigate_tree needs a stashed pi command context (the only
  // extension-API surface carrying ctx.navigateTree). RPC-backed sessions can
  // acquire one remotely: an RPC prompt of "/dish-prime" goes through pi's
  // command executor, which hands the bridge a command context to stash — so
  // on "no command context", prime and retry once. TUI-only sessions have no
  // remote path; the route surfaces the /dish-push hint instead.
  async function navigateLiveTree(sessionId: string, sess: InstanceType<typeof BridgeSession>, entryId: unknown, opts: BranchSessionOptions) {
    try {
      return await sess.navigateTree(entryId as string, opts);
    } catch (e) {
      if (!/no command context/i.test((property(e, 'message') || '') as string)) throw e;
      // RPC-backed sessions prime remotely via pi's command executor.
      const rpc = getRPCSession(sessionId);
      if (rpc?.alive) {
        await rpc.prompt('/dish-prime');
        return sess.navigateTree(entryId as string, opts);
      }
      // tmux-spawned TUI sessions have a pane we can type into: send /dish-prime
      // through send-keys, give the command a moment to run, and retry once.
      const spawn = tmux.getSpawn(sessionId);
      if (spawn && await tmux.paneExists(spawn.socket, spawn.paneId)) {
        await tmux.sendKeys(spawn.socket, spawn.paneId, '/dish-prime');
        await new Promise((r) => setTimeout(r, 1500));
        return sess.navigateTree(entryId as string, opts);
      }
      throw e;
    }
  }

  // The tmux key chord a bridge advertises for its tree service, translated to
  // a tmux send-keys key name. Only F-keys are accepted: they are inert in a
  // TUI and, unlike a name tmux fails to resolve, can never be delivered as
  // literal text into the session's composer.
  const TMUX_CHORD_MODIFIERS: Record<string, string> = { ctrl: 'C-', alt: 'M-', shift: 'S-' };
  function tmuxKeyForChord(chord: unknown) {
    if (typeof chord !== 'string' || !chord) return null;
    const parts = chord.toLowerCase().split('+');
    const base = parts.pop()!;
    if (!/^f([1-9]|1[0-2])$/.test(base)) return null;
    if (parts.some((part) => !TMUX_CHORD_MODIFIERS[part])) return null;
    const prefix = Object.keys(TMUX_CHORD_MODIFIERS)
      .filter((modifier) => parts.includes(modifier))
      .map((modifier) => TMUX_CHORD_MODIFIERS[modifier])
      .join('');
    return `${prefix}${base.toUpperCase()}`;
  }

  // OMP intentionally exposes branch/navigation only on command contexts, and
  // its public ExtensionAPI.sendUserMessage() bypasses extension-command
  // dispatch. Queue the bridge request first, then trigger the bridge's
  // internal tree service in the exact live TUI pane so OMP creates a legal
  // command context to drain it. The trigger is the bridge's registered
  // shortcut, not its command name: send-keys of "/dish-tree-service"
  // concatenates with whatever the user left in the TUI composer, and OMP then
  // sends that line to the model instead of running the command. Only a bridge
  // too old to advertise a chord still gets the typed command. Sessions outside
  // a locatable tmux pane retain live tree reads but fail navigation precisely
  // instead of falling back to the Pi SDK.
  async function navigateLiveOmpTree(sessionId: string, sess: InstanceType<typeof BridgeSession>, entryId: unknown, opts: BranchSessionOptions) {
    const pane = await locatePiPane(sessionId);
    if (!pane) {
      const error: Error & { statusCode?: number } = new Error('Oh My Pi tree navigation requires a reachable tmux pane to acquire its command context.');
      error.statusCode = 409;
      throw error;
    }
    const chordKey = tmuxKeyForChord(getRegisteredSession(sessionId)?.treeServiceShortcut);
    const operation = sess.treeNavigate(entryId as string, opts);
    // Either promise may reject while the other is being awaited below; both
    // are settled here so a losing rejection is never unhandled.
    operation.catch(() => {});
    const handoff = new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        sess.off('tree_operation_queued', onQueued);
      };
      const onQueued = (data: unknown) => {
        if (optionalProperty(data, 'requestId') !== operation.requestId) return;
        cleanup();
        resolve();
      };
      sess.on('tree_operation_queued', onQueued);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('bridge did not acknowledge the queued tree operation'));
      }, 2000);
    }).then(() => (chordKey
      ? tmux.sendKey(pane.socket, pane.paneId, chordKey)
      : tmux.sendKeys(pane.socket, pane.paneId, '/dish-tree-service')
    )).catch((cause: unknown) => {
      const error: Error & { statusCode?: number } = new Error(`Oh My Pi tree navigation could not acquire its command context: ${property(cause, 'message')}`);
      error.statusCode = 409;
      throw error;
    });
    handoff.catch(() => {});
    // A bridge that refuses outright (turn in progress, unknown entry) never
    // acknowledges a queued operation. Race the two so its precise error wins
    // instead of being masked by the acknowledgement timeout.
    await Promise.race([operation, handoff]);
    return operation;
  }

  // Move the session leaf (pi's /tree), optionally summarizing the abandoned
  // branch. Live sessions must navigate inside the pi process — an external
  // SessionManager write would diverge from the agent's in-memory state — so
  // this goes through the bridge; only inactive sessions take the SDK path.
  app.post('/api/sessions/:id/branch', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const entryId = property(req.body, 'entryId');
    const summarize = property(req.body, 'summarize');
    const customInstructions = property(req.body, 'customInstructions');
    if (!entryId) return res.status(400).json({ error: 'entryId required' });
    const opts = {
      summarize: !!summarize,
      customInstructions: typeof customInstructions === 'string' && customInstructions.trim()
        ? customInstructions.trim() : undefined,
    };
    try {
      const identity = routeIdentity(req.params.id);
      if (!identity) return res.status(400).json({ error: 'Invalid session ID' });
      if (identity.harnessId !== 'pi' && identity.harnessId !== 'omp') {
        return res.status(409).json({ error: 'Session tree navigation is not supported for this harness.' });
      }
      const source = findSessionSource(req.params.id);
      const sess = await getLiveSession(req.params.id);
      if (sess) {
        if (!liveSessionSupports(sess, 'treeNavigation')) {
          return res.status(409).json({ error: 'This session does not support tree navigation.' });
        }
        if (!(sess instanceof BridgeSession)) {
          return res.status(409).json({ error: 'This live session has no bridge connection — install the pi-dish-bridge extension to navigate its tree.' });
        }
        try {
          const data = identity.harnessId === 'omp'
            ? await navigateLiveOmpTree(req.params.id, sess, entryId, opts)
            : await navigateLiveTree(req.params.id, sess, entryId, opts);
          return res.json({ success: true, editorText: optionalProperty(data, 'editorText') });
        } catch (e) {
          if (/unknown command/i.test((property(e, 'message') || '') as string)) {
            return res.status(409).json({ error: 'The pi session is running an older pi-dish-bridge — run /reload in it (or restart it) to enable tree navigation.' });
          }
          if (/no command context/i.test((property(e, 'message') || '') as string)) {
            // The bridge self-primes through its captured AgentSession, so this
            // is now the rare case where no capture exists (no prompt or
            // subscribe since the bridge loaded) and no prime path reached it.
            return res.status(409).json({ error: "pi hands out session control only inside command handlers and this session couldn't be primed remotely — send any prompt to it (or run /dish-push once in its TUI), then retry." });
          }
          // Refusals about live session state are the caller's to act on
          // (wait for the turn, or abort it) — not server faults.
          if (/turn is in progress|compaction is in progress|entry not found/i.test((property(e, 'message') || '') as string)) {
            return res.status(409).json({ error: property(e, 'message') });
          }
          if (identity.harnessId === 'omp' && /timed out/i.test((property(e, 'message') || '') as string)) {
            return res.status(504).json({ error: property(e, 'message') });
          }
          if (identity.harnessId === 'omp' && /cancelled|unavailable|command context/i.test((property(e, 'message') || '') as string)) {
            return res.status(409).json({ error: property(e, 'message') });
          }
          throw e;
        }
      }
      if (!source) return res.status(404).json({ error: 'Session not found' });
      if (identity.harnessId === 'omp') {
        return res.status(409).json({ error: 'Navigating the tree of an inactive Oh My Pi session is not supported.' });
      }
      const result = await piSDK.branchSession(source.file, entryId as string, opts);
      res.json({ success: true, editorText: result.editorText });
    } catch (e) {
      res.status(500).json({ error: property(e, 'message') });
    }
  });

  let modelsCache: AvailableModel[] | null = null;
  let modelsCacheTime = 0;

  function setModelsCache(models: AvailableModel[]) {
    modelsCache = models;
    modelsCacheTime = Date.now();
    contextWindowMemo.clear(); // windows may differ under the fresh registry
  }




  app.get('/api/harnesses', featureHandlers.harnesses);


  app.get('/api/harnesses/:id/config', featureHandlers.harnessConfig);

  // Patch role → model assignments in the harness's *global* config. Values are
  // stored verbatim: the harness resolves model refs itself, and a rewrite here
  // would only invent a second dialect.
  app.put('/api/harnesses/:id/model-roles', featureHandlers.updateModelRoles);

  // Task-agent inventory (bundled + user + project definitions) with the
  // per-agent settings the harness's own agents hub edits.
  app.get('/api/harnesses/:id/agents', featureHandlers.harnessAgents);

  // Patch per-agent settings in the harness's *global* config. Each field is
  // tri-state: `disabled` toggles array membership, and `model`/`prewalk`/
  // `advisor` take a value or null to drop the override and inherit again.
  app.put('/api/harnesses/:id/agents', featureHandlers.updateHarnessAgents);


  app.get('/api/models', featureHandlers.models);

  // Persist the scoped-models set the same way pi's /scoped-models selector
  // does: explicit "provider/id" strings in settings.enabledModels, absent when
  // everything is enabled. Use pi's SettingsManager rather than rewriting its
  // file ourselves: it locks, re-reads, and merges only the modified field, so
  // concurrent settings writes from a running pi keep their unrelated fields.
  app.put('/api/models/enabled', featureHandlers.updateEnabledModels);


  app.get('/api/commands', featureHandlers.commands);

  app.post('/api/sessions/:id/abort', async (req: ApplicationRequest, res: ApplicationResponse) => {
    try {
      const sess = await getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (!liveSessionSupports(sess, 'abort')) return res.status(409).json({ error: 'This session does not support abort.' });
      await sess.abort();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: property(e, 'message') });
    }
  });

  app.post('/api/sessions/:id/close', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const { status, body } = await sessionOperations.closeSessionById(req.params.id);
    res.status(status).json(body);
  });

  app.get('/api/cwds', (req: ApplicationRequest, res: ApplicationResponse) => {
    try {
      const cwdSet = new Set(knownWorkspaceCwds(buildSessionCatalog));
      const home = os.homedir();
      const cwds = [...cwdSet].sort().map(c => ({
        path: c,
        short: c.startsWith(home) ? '~' + c.slice(home.length) : c,
      }));
      res.json(cwds);
    } catch (e) {
      res.status(500).json([]);
    }
  });

  // Feature flags the client needs before rendering chrome. `terminal` is
  // opt-in (PI_DISH_TERMINAL=1) and additionally requires node-pty to have
  // loaded — a missing native binary must hide the button, not break the UI.
  app.get('/api/config', (req: ApplicationRequest, res: ApplicationResponse) => {
    res.json({
      terminal: terminal.isTerminalEnabled(),
      tmux: tmux.isTmuxAvailable(),
      // A boolean only: the endpoint URL and its key are server-side config and
      // never travel to a client (see settingsForClient).
      stt: !!stt.resolveSttConfig(readDishSettings()),
      // The self-host fallback for hostSupportsCapability: this build resolves
      // refs by native id/uuid tail, so the client may print short refs for it.
      refAliases: true,
    });
  });

  // =========================================================================
  // Speech to text: POST /api/stt (lib/stt.js)
  // =========================================================================
  //
  // The browser records audio and posts the raw bytes here; the server holds
  // the endpoint and its key and relays a multipart transcription request. It
  // is a proxy rather than a direct browser→endpoint call for four reasons: the
  // key stays off phones, no upstream needs a CORS policy for the LAN origin, a
  // self-hosted whisper box that only listens on the host's loopback is still
  // reachable, and the configuration is per-host like every other fleet
  // setting. Sitting under /api, it inherits the bearer gate; the
  // /hosts/:name/api/stt proxy relays the bytes untouched.
  const parseAudioBody = express.raw({ type: ['audio/*', 'video/webm'], limit: '25mb' });

  app.post('/api/stt', parseAudioBody, featureHandlers.transcribe);

  // =========================================================================
  // Agent docs: GET /api/agent-docs, GET /api/agent-docs/:topic
  // =========================================================================
  //
  // The server ships the agent-facing documentation for the API this build
  // actually serves, so an agent in a mixed-version fleet reads the *running*
  // host's docs instead of whatever a vended skill file was pinned to. Sourced
  // from the app's own tree, never HOME.

  const AGENT_DOCS_DIR = path.join(rootDirectory, 'docs', 'agent');
  // This shape gate is also the path-traversal gate: nothing that fails it is
  // ever joined into a filesystem path.
  const AGENT_DOC_TOPIC_RE = /^[a-z0-9-]{1,64}$/;
  const AGENT_DOC_DESCRIPTION_MAX = 160;

  function agentDocSummary(markdown: string) {
    const lines = markdown.split('\n');
    let title = '';
    let i = 0;
    for (; i < lines.length; i++) {
      const heading = /^#\s+(.*\S)\s*$/.exec(lines[i]);
      if (heading) { title = heading[1]; i++; break; }
    }
    let description = '';
    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;
      description = line;
      break;
    }
    if (description.length > AGENT_DOC_DESCRIPTION_MAX) {
      description = description.slice(0, AGENT_DOC_DESCRIPTION_MAX - 1).trimEnd() + '\u2026';
    }
    return { title, description };
  }

  app.get('/api/agent-docs', (req: ApplicationRequest, res: ApplicationResponse) => {
    let files;
    try {
      files = fs.readdirSync(AGENT_DOCS_DIR).filter((f) => f.endsWith('.md')).sort();
    } catch {
      return res.json({ topics: [] }); // no docs shipped is not an error
    }
    const topics = [];
    for (const file of files) {
      const name = file.slice(0, -'.md'.length);
      if (!AGENT_DOC_TOPIC_RE.test(name)) continue;
      try {
        topics.push({ name, ...agentDocSummary(fs.readFileSync(path.join(AGENT_DOCS_DIR, file), 'utf-8')) });
      } catch {}
    }
    res.json({ topics });
  });

  app.get('/api/agent-docs/:topic', (req: ApplicationRequest, res: ApplicationResponse) => {
    const topic = req.params.topic;
    if (!AGENT_DOC_TOPIC_RE.test(topic)) return res.status(404).json({ error: 'Unknown docs topic' });
    let markdown;
    try {
      markdown = fs.readFileSync(path.join(AGENT_DOCS_DIR, `${topic}.md`), 'utf-8');
    } catch {
      return res.status(404).json({ error: 'Unknown docs topic' });
    }
    res.type('text/markdown; charset=utf-8').send(markdown);
  });

  // Themes: the two built-ins (defined in style.css) plus any user-supplied
  // token files under ~/.pi/dish/themes/*.json — a flat { "--token": "value" }
  // map applied over the default palette (every color in the stylesheet flows
  // from the :root tokens, so overriding them is a complete theme). Keys are
  // gated to custom-property names and values to plain CSS color-ish strings;
  // unreadable or malformed files are skipped, never an error — a broken theme
  // file must not take down the picker. Re-read per call (shares.js rules) so
  // edits show on refresh.
  app.get('/api/themes', (req: ApplicationRequest, res: ApplicationResponse) => {
    const themes: { id: string; builtin?: boolean; tokens?: Record<string, string> }[] = [
      { id: 'solarized', builtin: true }, { id: 'graphite', builtin: true },
    ];
    try {
      const dir = path.join(os.homedir(), '.pi', 'dish', 'themes');
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
        try {
          const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
          const tokens: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw as object)) {
            if (/^--[a-z][a-z0-9-]*$/.test(k) && typeof v === 'string' && /^[#a-zA-Z0-9(),.%\s-]+$/.test(v)) tokens[k] = v;
          }
          const id = f.replace(/\.json$/, '');
          if (Object.keys(tokens).length && !themes.some((t) => t.id === id)) themes.push({ id, tokens });
        } catch {}
      }
    } catch {}
    res.json({ themes });
  });

  // tmux spawn targets: the running tmux servers and their sessions. 200 with
  // available:false when tmux is missing (the client hides the control).
  app.get('/api/tmux/targets', async (req: ApplicationRequest, res: ApplicationResponse) => {
    if (!tmux.isTmuxAvailable()) return res.json({ available: false, servers: [] });
    try {
      const servers = await tmux.listServers();
      // Opportunistically drop spawn placements whose pane and session are both
      // gone, so tmux-spawns.json doesn't grow without bound.
      try {
        const registered = new Set(listRegisteredSessions().map((entry) => {
          const identity = registryIdentity(entry);
          return identity ? routeSessionId(identity.harnessId, identity.nativeSessionId) : null;
        }).filter((id): id is string => id !== null));
        await tmux.pruneSpawns(registered);
      } catch {}
      res.json({ available: true, servers });
    } catch {
      res.json({ available: true, servers: [] });
    }
  });

  // Fuzzy directory search under $HOME for the new-session cwd picker.
  app.get('/api/dirs', fileHandlers.searchDirectories);

  // Immediate subdirectories of a path, for the new-session cwd tree. Absolute
  // (or ~-prefixed) path required → 400; an unreadable dir degrades to 200 with
  // an `error` field and empty `dirs` so the tree never blanks.
  app.get('/api/dirs/children', fileHandlers.directoryChildren);

  // Best-known working directory for a session: live registry first, then the
  // JSONL header. Null when neither knows (terminal + file search fall back).
  function resolveSessionCwd(sessionId: string): unknown {
    const reg = getRegisteredSession(sessionId);
    if (reg?.cwd) return reg.cwd;
    const session = findSessionSource(sessionId);
    if (session) {
      try { return parseSessionFile(session).cwd || null; } catch {}
    }
    return null;
  }

  // File search for @-mentions in the prompt. Plain tokens fuzzy-search the
  // session cwd (fff); tokens that name a location (/abs, ~/x, ../x) get
  // shell-style completion instead, so mentions can reach anywhere on disk.
  app.get('/api/sessions/:id/files', fileHandlers.searchSessionFiles);

  // Raw files use a normal resource response instead of JSON. The same
  // session-aware resolver gates both previews and bytes, so this does not
  // create a path traversal shortcut around the file viewer's reach rules.
  // Text is deliberately served as text/plain: a viewed HTML/SVG file must not
  // become executable same-origin content merely because the user opens Raw.
  app.get('/api/sessions/:id/file/content', fileHandlers.fileContent);

  // Read a file mentioned in the chat (clickable filenames in the transcript).
  // "findings.md" written deep in the tree resolves through the session's own
  // tool calls; reads are gated to the cwd subtree + tool-touched paths. See
  // lib/file-mention.js.
  app.get('/api/sessions/:id/file', fileHandlers.filePreview);

  // A large pane receives metadata first. Patch lookup selects from the exact
  // aggregate snapshot used for that response (rather than accepting an
  // arbitrary path). The working-tree version is checked around patch creation;
  // drift returns an explicit stale response instead of mixing snapshots.
  app.get('/api/sessions/:id/diff/patch', fileHandlers.diffPatch);

  // Aggregate uncommitted git diffs for every repo under the session cwd (the
  // user's workspaces are polyrepos — several checkouts side by side under one
  // agent cwd). The cwd comes from the session, never the request, so there's
  // no path input to gate. See lib/git-diff.js.
  app.get('/api/sessions/:id/diff', fileHandlers.diffSummary);


  app.post('/api/sessions/new', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const body = req.body || {};
    const rawHarness = property(body, 'harness');
    const harness = rawHarness === undefined ? 'pi' : rawHarness;
    const model = property(body, 'model'), thinking = property(body, 'thinking');
    const cwd = property(body, 'cwd'), target = property(body, 'target');
    const name = typeof optionalProperty(req.body, 'name') === 'string'
      ? (property(req.body, 'name') as string).trim() : optionalProperty(req.body, 'name');
    const descriptor = getHarness(harness);
    if (!descriptor) return res.status(400).json({ error: `Unknown harness: ${harness}` });
    if (name !== undefined && (typeof name !== 'string' || !name)) {
      return res.status(400).json({ error: 'Name must be a non-empty string' });
    }
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
      return res.status(400).json({ error: 'Model must be a non-empty string' });
    }
    if (cwd !== undefined && typeof cwd !== 'string') {
      return res.status(400).json({ error: 'cwd must be a string' });
    }
    if (thinking !== undefined && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(thinking as string)) {
      return res.status(400).json({ error: 'Invalid reasoning level' });
    }
    // requestedBySessionId is the public provenance field; retain the earlier
    // sourceSessionId spelling as a compatibility alias. The header lets the
    // bundled CLI identify itself without making the claim authoritative.
    const sourceSessionId = req.get('X-Pi-Dish-Session-Id')
      || optionalProperty(req.body, 'requestedBySessionId') || optionalProperty(req.body, 'sourceSessionId') || null;
    // A host-qualified caller (`<hostId>:<sessionId>`, TASKS/multi-host.md
    // block 6) names a session on another fleet host, which this host cannot
    // verify — provenance is advisory and grants nothing, so a well-formed
    // qualified id is recorded as-is while bare local ids stay validated.
    const hostQualifiedSource = sourceSessionId
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:./i.test(sourceSessionId as string);
    if (sourceSessionId && !hostQualifiedSource
        && !getRegisteredSession(sourceSessionId) && !getRPCSession(sourceSessionId)?.alive
        && !findSessionFile(sourceSessionId, { exact: true })) {
      return res.status(400).json({ error: 'requestedBySessionId must identify an existing session' });
    }
    if (optionalProperty(req.body, 'async') === true) {
      const spawnId = sessionOperations.startSessionSpawn({
        harness, name, model, thinking, cwd,
        target: target as HarnessLaunchTarget | null | undefined,
        sourceSessionId: sourceSessionId as string | null,
      });
      return res.status(202).json({ success: true, pending: true, spawnId });
    }
    try {
      await sessionLaunch.validateHarnessPilotSelection(descriptor, { model, thinking, cwd });
    } catch (e) {
      return res.status((property(e, 'status') || 500) as number).json({ error: property(e, 'message') });
    }
    try {
      const id = await sessionOperations.createSession({
        harness, name, model, thinking, cwd, target: target as HarnessLaunchTarget | null | undefined,
      });
      const operationId = sourceSessionId ? sessionOperations.recordSessionLaunch(id, sourceSessionId as string) : null;
      res.json({ success: true, id, ...(operationId ? { operationId } : {}) });
    } catch (e) {
      console.error('Failed to create session:', e);
      res.status((property(e, 'status') || 500) as number).json({ success: false, error: property(e, 'message') });
    }
  });

  app.get('/api/session-spawns/:id', (req: ApplicationRequest, res: ApplicationResponse) => {
    const operation = sessionOperations.getSessionSpawn(req.params.id);
    if (!operation) return res.status(404).json({ error: 'Session spawn not found' });
    res.status(operation.status === 'starting' ? 202 : 200).json(operation);
  });


  app.post('/api/sessions/:id/resume', async (req: ApplicationRequest, res: ApplicationResponse) => {
    try {
      res.json(await sessionOperations.resumeSessionById(req.params.id, {
        model: optionalProperty(req.body, 'model'),
        target: optionalProperty(req.body, 'target') as HarnessLaunchTarget | null | undefined,
      }));
    } catch (error) { res.status((property(error, 'status') || 500) as number).json({ error: property(error, 'message') }); }
  });


  const recoveryRunner = createRecoveryRuntime({
    operations: sessionOperations,
    ownership,
    getMode: () => readDishSettings().recoveryMode,
  });

  app.get('/api/recovery', (_req: ApplicationRequest, res: ApplicationResponse) => {
    try { res.json(recoveryRunner.report()); }
    catch (error) { res.status(500).json({ error: property(error, 'message') }); }
  });
  app.put('/api/sessions/:id/recovery', (req: ApplicationRequest, res: ApplicationResponse) => {
    if (typeof optionalProperty(req.body, 'excluded') !== 'boolean') return res.status(400).json({ error: 'excluded must be a boolean' });
    const identity = routeIdentity(req.params.id);
    if (!identity || !getHarness(identity.harnessId)) return res.status(400).json({ error: 'Invalid session ID' });
    if (!recoveryStore.readRecord(identity.harnessId, identity.nativeSessionId)
        && !getRegisteredSession(req.params.id) && !getRPCSession(req.params.id)?.alive
        && !findSessionSource(req.params.id, { exact: true })) return res.status(404).json({ error: 'Session not found' });
    try {
      const control = recoveryStore.patchControl(identity.harnessId, identity.nativeSessionId, { excluded: property(req.body, 'excluded') as boolean });
      res.json({ excluded: control.excluded });
    } catch (error) { res.status(500).json({ error: property(error, 'message') }); }
  });
  app.post('/api/recovery/retry', async (req: ApplicationRequest, res: ApplicationResponse) => {
    if (typeof optionalProperty(req.body, 'id') !== 'string') return res.status(400).json({ error: 'id is required' });
    try { res.json(await recoveryRunner.retry(property(req.body, 'id') as string)); }
    catch (error) { res.status((property(error, 'status') || 500) as number).json({ error: property(error, 'message') }); }
  });


  app.post('/api/sessions/:id/restart', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const result = await sessionOperations.restartSessionById(req.params.id);
    res.status(result.status).json(result.body);
  });


  const sessionBounces = createSessionBounceRuntime({
    operations: sessionOperations,
    ownership,
    catalog: () => { invalidateRegistryCache(); return getActiveSessions(); },
  });

  app.get('/api/session-bounces/preview', async (req: ApplicationRequest, res: ApplicationResponse) => {
    if (!['reload', 'restart'].includes(req.query.mode as string)) return res.status(400).json({ error: 'mode must be reload or restart' });
    try { res.json({ targets: await sessionBounces.preview(req.query.mode as SessionBounceMode) }); }
    catch (error) { res.status(500).json({ error: property(error, 'message') }); }
  });

  app.post('/api/session-bounces', (req: ApplicationRequest, res: ApplicationResponse) => {
    try { res.status(202).json({ operation: sessionBounces.enqueue(optionalProperty(req.body, 'mode'), optionalProperty(req.body, 'sessionIds')) }); }
    catch (error) { res.status((property(error, 'status') || 500) as number).json({ error: property(error, 'message') }); }
  });

  app.get('/api/session-bounces', async (_req: ApplicationRequest, res: ApplicationResponse) => {
    try { res.json({ operations: await sessionBounces.list() }); }
    catch (error) { res.status(500).json({ error: property(error, 'message') }); }
  });

  app.delete('/api/session-bounces/:id', (req: ApplicationRequest, res: ApplicationResponse) => {
    const operation = sessionBounces.cancel(req.params.id);
    if (!operation) return res.status(404).json({ error: 'Unknown bulk operation' });
    res.json({ operation });
  });

  // =========================================================================
  // Routines: /api/routines, /api/routine-invocations
  // =========================================================================
  //
  // A routine is a session *template* and an invocation is a session: each run
  // stamps its session with routine provenance, so transcript, cost, duration
  // and outcome all come from the existing session index and views rather than
  // a second history system. Everything destructive or spawn-shaped is reached
  // through the same helpers the session routes use — nothing here knows what a
  // harness is beyond its descriptor and the live session's capabilities.



  const routineRunner = createRoutineRunner({
    store: routinesStore,
    createSession: sessionOperations.createSession,
    resumeSession: sessionOperations.resumeSessionById,
    getLiveSession,
    closeSession: sessionOperations.closeSessionById,
    composePrompt: (routine, invocation) => composeRoutinePrompt(routine, invocation, sessionRefDeps()),
    isTurnInProgress: (sess) => !!sess?.turnInProgress,
    supports: liveSessionSupports,
    recoveryOutcome: sessionId => recoveryRunner.outcome(sessionId),
  });

  const routineHandlers = createRoutineHandlers({
    runner: routineRunner,
    validateHarnessPilotSelection: sessionLaunch.validateHarnessPilotSelection,
  });

  app.get('/api/routines', routineHandlers.list);
  app.post('/api/routines', routineHandlers.create);
  app.get('/api/routines/:id', routineHandlers.get);
  app.put('/api/routines/:id', routineHandlers.update);
  app.delete('/api/routines/:id', routineHandlers.remove);
  app.post('/api/routines/:id/invoke', routineHandlers.invoke);
  app.get('/api/routines/:id/invocations', routineHandlers.listInvocations);
  app.get('/api/routine-invocations/:id', routineHandlers.getInvocation);


  // SSE — proxy events from the bridge socket. `message_update` fires for every
  // streaming delta with the full message payload; forwarding each one floods
  // slow (phone) connections, so we coalesce per connection: forward immediately
  // when idle, otherwise remember the latest and flush it after the window.
  const MESSAGE_UPDATE_COALESCE_MS = 50;

  app.get('/api/sessions/:id/stream', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const sessionId = req.params.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(': connected\n\n');
    res.flush?.();

    let sess: LiveSession | null;
    try {
      sess = await getLiveSession(sessionId);
    } catch (e) {
      res.write(`event: stream_error\ndata: ${JSON.stringify({ error: property(e, 'message') })}\n\n`);
      return res.end();
    }
    if (!sess) {
      res.write(`event: stream_error\ndata: ${JSON.stringify({ error: 'Session not active' })}\n\n`);
      return res.end();
    }

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // Even though compression explicitly excludes event streams above, flush
      // every frame so a reconnecting phone can render replay/live state without
      // waiting for another event to make the chunk observable.
      res.flush?.();
    };
    const messageForStream = (message: unknown): unknown => {
      if (message == null || property(message, 'role') !== 'custom') return message;
      // interrupted-thinking content is hidden model reasoning. The client only
      // needs its marker; visible custom messages (including async-result) pass
      // through, while other hidden host state follows the documented skip.
      if (property(message, 'customType') === 'interrupted-thinking') return { ...message, content: [] };
      return property(message, 'display') === false ? null : message;
    };

    send('init', { turnInProgress: !!sess.turnInProgress, compacting: !!sess.compacting });

    const offs: Array<() => unknown> = [];
    const sub = (event: string, fn: (data: unknown) => void) => {
      const unsub = sess instanceof BridgeSession ? sess.on(event, fn) : sess.on(event, fn);
      offs.push(typeof unsub === 'function' ? unsub : () => {
        if (sess instanceof BridgeSession) sess.off(event, fn);
        else sess.off(event, fn);
      });
    };

    sub('turn_start', () => send('turn_start', {}));

    // Coalesced message_update forwarding — each event carries the *full*
    // message so far, so dropping intermediates loses nothing.
    let pendingUpdate: unknown = null;
    let updateTimer: NodeJS.Timeout | null = null;
    const flushUpdate = () => {
      updateTimer = null;
      if (!pendingUpdate) return;
      send('message_update', { message: pendingUpdate });
      pendingUpdate = null;
      updateTimer = setTimeout(flushUpdate, MESSAGE_UPDATE_COALESCE_MS);
    };
    // Drop any coalesced update still pending. Must run at every turn/session
    // boundary — a delta that flushes *after* turn_end/session_ended re-arms the
    // client's working indicator and leaves a ghost streaming bubble. The JSONL
    // catch-up that follows turn_end renders the authoritative final message.
    const clearPendingUpdate = () => {
      pendingUpdate = null;
      if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
    };
    sub('message_update', (data) => {
      const m = messageForStream(data == null ? undefined : property(data, 'message'));
      if (!m) return;
      pendingUpdate = m;
      if (!updateTimer) flushUpdate();
    });

    sub('turn_end', () => { clearPendingUpdate(); send('turn_end', {}); });
    // Both session backends treat agent_end as turn-terminating (an aborted or
    // errored turn can end without a paired turn_end) — forward it, or the
    // client's working indicator ticks forever and the JSONL catch-up never runs.
    sub('agent_end', () => { clearPendingUpdate(); send('agent_end', {}); });

    sub('message_end', (data) => {
      const message = messageForStream(data == null ? undefined : property(data, 'message'));
      const role = message == null ? undefined : property(message, 'role');
      if (role === 'assistant') {
        clearPendingUpdate();
        send('message_end', { message });
      } else if (role === 'user' || role === 'custom') {
        // A steer/follow-up pi just delivered mid-turn — forward it so the client
        // can show it now instead of waiting for the turn_end JSONL catch-up.
        // OMP also delivers completed background jobs as role:custom messages,
        // including after the turn that launched them has already ended.
        // Don't touch the coalescer: a user message doesn't invalidate a pending
        // assistant delta.
        send('message_end', { message });
      }
    });

    // Tree navigation changed the session's authoritative history — the client
    // must re-render the transcript from the JSONL (the bridge anchors the new
    // leaf on disk before broadcasting this).
    sub('session_tree', (data) => send('session_tree', data || {}));
    // Keep clients attached to the old route long enough to learn which route
    // now owns the same pane. The central listener above has already re-keyed
    // owned-pane state by the time this SSE listener runs.
    sub('session_switch', (data) => {
      const routed = sessionSwitchRouteData(sess, data);
      if (routed && routed.sessionId !== routed.previousSessionId) send('session_switch', routed);
    });

    sub('tool_execution_start', (data) => send('tool_execution_start', data));
    sub('tool_execution_update', (data) => send('tool_execution_update', data));
    sub('tool_execution_end', (data) => send('tool_execution_end', data));
    // Subscribe before taking the snapshot: a call that ends during replay is
    // still forwarded, while one that started just before subscription is found
    // in the session-owned map. Repeated starts are harmless client-side because
    // live panels dedupe by toolCallId.
    for (const [toolCallId, call] of sess.runningToolCalls || []) {
      const common = {
        toolCallId,
        toolName: call.toolName,
        args: call.args,
        startedAt: call.startedAt,
      };
      send('tool_execution_start', common);
      if (call.lastPartialResult != null) {
        send('tool_execution_update', { ...common, partialResult: call.lastPartialResult });
      }
    }
    // setWidget/setStatus re-fire with unchanged content on every extension
    // tick (pi-processes: once per process output line) — skip exact repeats
    // per connection. Content-keyed: the request id changes on every emission.
    // Ownership note: the bridge extension already dedups live re-emissions at
    // the source; this per-connection layer exists to absorb the bridge's
    // full-state replay when the server reconnects its socket (and any bridge
    // versions without source dedup). Keep both signatures content-equivalent.
    const lastExtUI = new Map<string, string | undefined>(); // method:key -> content signature
    const extUISig = (data: unknown) => JSON.stringify([property(data, 'widgetLines'), property(data, 'widgetPlacement'), property(data, 'statusText')]);
    sub('extension_ui_request', (data) => {
      // data.forced marks a deliberate re-broadcast (/dish-push) — let the
      // repeat through, or a force push of unchanged content is a no-op.
      if (data && !property(data, 'forced') && (property(data, 'method') === 'setWidget' || property(data, 'method') === 'setStatus')) {
        const k = `${property(data, 'method')}:${property(data, 'widgetKey') || property(data, 'statusKey') || 'default'}`;
        const sig = extUISig(data);
        if (lastExtUI.get(k) === sig) return;
        lastExtUI.set(k, sig);
      }
      send('extension_ui_request', data);
    });
    sub('extension_ui_resolved', (data) => send('extension_ui_resolved', data));

    // Replay the transport-owned extension UI so a
    // client that just connected — typically one that switched sessions — shows
    // this session's widgets/statuses/pending dialogs instead of waiting for
    // the next live emission. Seeding the dedupe signatures keeps the bridge's
    // unchanged re-emissions from double-rendering right after the replay.
    const replayDialogs = sess.extUIState && sess.turnInProgress ? [...sess.extUIState.dialogs.values()] : [];
    if (sess.extUIState) {
      const { widgets, statuses } = sess.extUIState;
      for (const data of [...widgets.values(), ...statuses.values(), ...replayDialogs]) {
        if (property(data, 'method') === 'setWidget' || property(data, 'method') === 'setStatus') {
          lastExtUI.set(`${property(data, 'method')}:${property(data, 'widgetKey') || property(data, 'statusKey') || 'default'}`, extUISig(data));
        }
        send('extension_ui_request', data);
      }
    }
    // Authoritative pending-dialog list, sent after the replay burst so the
    // client can prune dialogs it stashed for this session that were answered
    // (or dismissed as stale) while it was viewing another session.
    send('extension_ui_state', { dialogs: replayDialogs.map(data => property(data, 'id')).filter(Boolean) });
    // Replay the last-known queue so a client that just (re)connected — e.g. one
    // that switched sessions — shows pending steers/follow-ups without waiting
    // for the next queue_update. RPCSessions have no queueState (fine).
    if (optionalProperty(sess, 'queueState')) send('queue_update', optionalProperty(sess, 'queueState'));
    sub('queue_update', (data) => send('queue_update', data));
    sub('compaction_start', (data) => send('compaction_start', data));
    sub('compaction_end', (data) => send('compaction_end', data));
    sub('auto_retry_start', (data) => send('auto_retry_start', data));
    sub('auto_retry_end', (data) => send('auto_retry_end', data));

    const onClose = () => { clearPendingUpdate(); send('session_ended', {}); };
    if (typeof optionalProperty(sess, 'once') === 'function') {
      (sess as { once(event: string, listener: (data: unknown) => void): unknown }).once('close', onClose);
      offs.push(() => sess.off('close', onClose));
    } else {
      sub('exit', onClose);
    }

    req.on('close', () => {
      clearPendingUpdate();
      for (const off of offs) { try { off(); } catch {} }
    });
  });

  // =========================================================================
  // Helpers
  // =========================================================================

  function findSessionSource(sessionId: unknown, { exact = false } = {}): SessionSource | null {
    return sessionSources.resolve({ route: sessionId, exact, live: liveSourceObservations(sessionId) });
  }

  function findSessionFile(sessionId: unknown, options?: { exact?: boolean }): string | null {
    return findSessionSource(sessionId, options)?.file || null;
  }

  // =========================================================================
  // Construct resources and listener handlers before binding any socket
  // =========================================================================

  const terminalHandlers = terminal.isTerminalEnabled() ? createTerminalHandlers({
    upgradeAuthorized: accessHandlers.upgradeAuthorized,
    getRegisteredSession,
    getRPCSession,
    findSessionFile,
    resolveSessionCwd,
    locatePiPane,
  }) : null;
  const relayUpgrade = relayHandlers.upgrade;
  const terminalUpgrade = terminalHandlers?.upgrade;

  // The restricted listener is not a full-app listener: no API or WS dispatch,
  // and never a source of Electron readiness.
  let shareServer: Server | null = null;
  if (process.env.PI_DISH_SHARE_PORT) {
    const shareApp = express();
    shareApp.get('/share/:token', publicationHandlers.serveSharedSession);
    shareApp.get('/page/:token', publicationHandlers.publicPage);
    shareApp.get('/page/:token/*', publicationHandlers.publicPageAsset);
    shareApp.get('/style.css', publicationHandlers.fileStyles);
    shareApp.get('/vendor/hljs-theme.min.css', publicationHandlers.highlightStyles);
    shareApp.use((req: ApplicationRequest, res: ApplicationResponse) => res.status(404).type('text/plain').send('Not found'));
    shareServer = createServer(shareApp);
    // Observe without consuming the error: native Node/Electron ownership stays.
    const shareEvents: EventEmitter = shareServer;
    shareEvents.on(errorMonitor, reportFailure);
  }

  let recoveryStopped = false;
  function closeResources() {
    recoveryStopped = true;
    recoveryRunner.stop();
    routineRunner.stop();
    if (shareServer) { try { shareServer.close(); } catch {} }
    remoteHosts.shutdown();
    sessionBounces.stop();
  }

  // Fleet relay takes precedence even when this host's terminal is disabled.
  // Keep ordinary unbound handler calls and destroy every unclaimed socket.
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    let url;
    try { url = new URL(req.url || '', 'http://localhost'); } catch { return socket.destroy(); }
    if (relayUpgrade(req, socket, head, url) || terminalUpgrade?.(req, socket, head, url)) return;
    socket.destroy();
  }

  function createOwnedServer(): Server {
    const listener = createServer(app);
    listener.on('close', closeResources);
    // Keep the terminal shutdown callback's native EventEmitter receiver.
    if (terminalHandlers) listener.on('close', terminalHandlers.shutdown);
    listener.on('upgrade', upgrade);
    return listener;
  }

  const startup: ServerStartupState = { readyUrl: null, observers: [] };
  const initialServer = createOwnedServer();
  serverStartups.set(initialServer, startup);

  function reportReady(listener: Server) {
    if (startup.readyUrl !== null) return;
    const bound = listener.address() as AddressInfo;
    const address = bound.address === '0.0.0.0' ? '127.0.0.1' : bound.address === '::' ? '::1' : bound.address;
    const authority = address.includes(':') ? `[${address}]` : address;
    const url = startup.readyUrl = `http://${authority}:${bound.port}`;
    // An observer added during delivery gets the retained result on registration.
    const count = startup.observers.length;
    for (let i = 0; i < count; i++) startup.observers[i].ready(url);
  }

  function reportFailure(error: Error) {
    // A share error can leave Electron alive; it must not suppress a later bind.
    const count = startup.observers.length;
    for (let i = 0; i < count; i++) startup.observers[i].failed(error);
  }

  const LOOPBACK = '127.0.0.1';
  const hostIsLoopback = HOST === LOOPBACK || HOST === 'localhost';
  const hostIsWildcard = HOST === '0.0.0.0' || HOST === '::';
  let aliasServer: Server | null = null;
  let server: Server | null = null;
  const explicitAgentUrl = !!process.env.PI_DISH_URL;

  function ensureLoopbackAlias(port: number) {
    if (hostIsLoopback || hostIsWildcard || aliasServer) return;
    const alias = aliasServer = createOwnedServer();
    alias.once('listening', () => {
      updateAgentUrl(server);
      console.log(`pi-dish loopback alias at http://${LOOPBACK}:${(alias.address() as AddressInfo).port}`);
      reportReady(alias);
    });
    alias.on('error', (err) => {
      console.error(`pi-dish: loopback alias not listening: ${err.message}`);
      aliasServer = null;
      updateAgentUrl(server);
    });
    alias.listen(port, LOOPBACK);
  }

  function updateAgentUrl(main: Server | null) {
    // Agent advertisement is separate from local readiness. Preserve explicit
    // operator URLs and prefer the alias only after its actual bind succeeds.
    if (!explicitAgentUrl && main?.listening) {
      const bound = main.address() as AddressInfo;
      const wildcard = !bound.address || bound.address === '0.0.0.0' || bound.address === '::';
      const reachable = wildcard || aliasServer?.listening ? LOOPBACK : bound.address;
      const authority = reachable.includes(':') ? `[${reachable}]` : reachable;
      process.env.PI_DISH_URL = `http://${authority}:${bound.port}`;
    }
  }

  function onMainListening(main: Server) {
    updateAgentUrl(main);
    console.log(`pi-dish running at http://${HOST}:${PORT}`);
    if (HOST === '127.0.0.1') {
      console.log('Bound to localhost only. To reach it from other devices, set HOST (e.g. HOST=0.0.0.0 or your Tailscale IP) or front it with a reverse proxy.');
    }
    // Skill roots precede the first big index build; failure remains harmless.
    skillsLib.getSkillFilePaths({ cwds: knownWorkspaceCwds(buildSessionCatalog) })
      .then(paths => sessionIndex.setSkillRoots(paths))
      .catch(() => {});
    sessionBounces.start();
    // A restored idle session is interrupted work, not a completed oneShot.
    recoveryRunner.start()
      .then(() => routineRunner.recoverAfterRestart())
      .then(() => { if (!recoveryStopped) routineRunner.start(); })
      .catch((e) => console.error(`Session restart recovery failed: ${e.message}`));
    reportReady(main);
  }

  function startMainListener(main: Server, retrySeconds = 15): void {
    main.once('listening', () => {
      if (PORT === 0) ensureLoopbackAlias((main.address() as AddressInfo).port);
      onMainListening(main);
    });
    main.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRNOTAVAIL') {
        // Keep loopback alive while the configured interface is unavailable.
        console.error(`pi-dish: ${HOST} is not assigned yet; retrying in ${retrySeconds}s`);
        setTimeout(() => startMainListener(createOwnedServer(), retrySeconds), retrySeconds * 1000);
        return;
      }
      console.error(`pi-dish: cannot listen on ${HOST}:${PORT}: ${err.message}`);
      try { reportFailure(err); } finally { process.exit(1); }
    });
    server = main;
    main.listen(PORT, HOST);
  }

  // Warm the models cache without delaying listener readiness.
  piSDK.getAvailableModels().then(setModelsCache).catch(() => {});
  // Concrete ports bind loopback first, independently of main-listener retries.
  // PORT=0 must wait for the main listener to mint their shared ephemeral port.
  if (PORT > 0) ensureLoopbackAlias(PORT);
  startMainListener(initialServer);
  if (shareServer) {
    const share = shareServer;
    const shareHost = process.env.PI_DISH_SHARE_HOST || HOST;
    share.listen(process.env.PI_DISH_SHARE_PORT as unknown as number, shareHost, () => {
      console.log(`pi-dish share listener at http://${shareHost}:${(share.address() as AddressInfo).port}`);
    });
  }

  // Signals retain the existing forward-cleanup and process-exit policy; they
  // do not redefine native Server.close(), sibling listeners or retry timers.
  const exitSignals: [NodeJS.Signals, number][] = [['SIGINT', 130], ['SIGTERM', 143]];
  for (const [signal, code] of exitSignals) {
    process.once(signal, () => { remoteHosts.shutdown(); process.exit(code); });
  }

  return initialServer;
}
