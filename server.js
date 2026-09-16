const { normalizeModels, sessionForClient, thinkingResult } = require('./lib/session-api');
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const piSDK = require('./lib/pi-sdk');
const { createSessionReadHandlers } = require('./lib/session-read-handlers');
const { execFile } = require('child_process');
const { getAllRPCSessions } = require('./lib/rpc-session');
const {
  listRegisteredSessions,
  invalidateRegistryCache,
  BridgeSession,
} = require('./lib/bridge-session');
const { searchFiles, searchHomeDirs, getDirChildren, completePath, isPathCompletionToken } = require('./lib/file-search');
const { resolveFileMention, readFileForViewer } = require('./lib/file-mention');
const { renderFilePage } = require('./lib/file-page');
const { aggregateDiffs, getFilePatch, getDiffVersion } = require('./lib/git-diff');
const terminal = require('./lib/terminal');
const tmux = require('./lib/tmux');
const hostIdentity = require('./lib/host-identity');
const remoteHosts = require('./lib/remote-hosts');
const fleetArtifacts = require('./lib/fleet-artifacts');
const { createAccessHandlers } = require('./lib/access-handlers');
const { createRelayHandlers } = require('./lib/relay-handlers');
const { createTerminalHandlers } = require('./lib/terminal-handlers');
const shares = require('./lib/shares');
const pages = require('./lib/pages');
const comments = require('./lib/comments');
const stt = require('./lib/stt');
const {
  readSessionMessages,
  readSessionCwd,
  readSessionTailEntry,
} = require('./lib/session-files');
const { discoverHarnessSessions } = require('./lib/session-discovery');
const sessionIndex = require('./lib/session-index');
const { getSessionInfo } = sessionIndex;
const { sourceForIdentity } = require('./lib/session-source');
const { composeSessionCatalog, registeredSessionObservation, rpcSessionObservation,
  decodeLaunchParents, decodeRoutineAnnotations, withSessionContext, subsessionLabel,
  buildSourceSession } = require('./lib/session-catalog');
const { canonicalSessionId } = require('./lib/session-key');
const { getHarness, listHarnesses } = require('./lib/harnesses');
const { sessionCapabilities } = require('./lib/session-capabilities');
const { refreshHarnessPricing } = require('./lib/harness-pricing');
const { listTaskAgents } = require('./lib/harness-agents');
const {
  createSessionOwnership, routeIdentity, routeSessionId, registryIdentity,
  sessionSwitchRouteData, liveSessionSupports,
  spawnAllowsManagedClose, spawnAllowsRestart,
} = require('./lib/session-ownership');
const { createSessionLaunch, harnessLaunchSpec } = require('./lib/session-launch');
const { createSessionOperations } = require('./lib/session-operations');
const sessionProvenance = require('./lib/session-provenance');
const routinesStore = require('./lib/routines');
const { createRoutineRunner } = require('./lib/routine-runner');
const { createRoutineHandlers, composeRoutinePrompt } = require('./lib/routine-handlers');
const recoveryStore = require('./lib/session-recovery');
const { createRecoveryRuntime, recoveryMode } = require('./lib/recovery-runner');
const { createSessionBounceRuntime } = require('./lib/session-bounces');
const skillsLib = require('./lib/skills');
const {
  isModelEnabled, ALL_THINKING_LEVEL_NAMES, thinkingLevelNamesFor, parseModelId,
} = require('./lib/helper-models.js');
const { extractTextContent } = require('./lib/helper-content.js');
const { sessionMetaText } = require('./lib/helper-identity.js');
const {
  buildSnippet, buildSnippets,
  parseSessionQuery, evaluateSessionQuery, positiveQueryTokens, scoreSessionMatch,
  isAutomationSession, queryAsksForAutomation,
} = require('./lib/helper-query.js');
const { resolveSessionRefAmong, stableSessionRef } = require('./lib/helper-refs.js');
const { expandSessionRefs } = require('./lib/session-refs');

const app = express();
const PORT = Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : 3333;
// Localhost-only by default; opt in to LAN/VPN exposure explicitly, e.g.
// HOST=0.0.0.0 (all interfaces) or HOST=<tailscale ip>. Auth is opt-in (see
// the host identity / auth section below) — without a token, anything that
// can reach the port can drive agents with shell access.
const HOST = process.env.HOST || '127.0.0.1';

const accessHandlers = createAccessHandlers({
  version: require('./package.json').version,
  readDishSettings,
  sttAvailable: () => !!stt.resolveSttConfig(readDishSettings()),
  usageLimitsAvailable: () => listHarnesses().some(d => d.argv?.usage && harnessCommandAvailable(d)),
});
app.use(accessHandlers.compression);
app.use(accessHandlers.jsonBody);
app.use(accessHandlers.cors);

app.use(express.static(path.join(__dirname, 'public')));

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
// Set by a hub fronting this host's page from a listener that has no /api to
// answer the overlay.
const PAGE_COMMENTS_HEADER = 'x-pi-dish-page-comments';

/** Absolute public URL for a hub-served path, or null (client builds it). */
function publicUrlFor(publicPath) {
  const base = process.env.PI_DISH_SHARE_BASE_URL;
  return base ? base.replace(/\/+$/, '') + publicPath : null;
}

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
  onLive: session => { trackExtUIState(session); },
  onRetired: route => { diffSnapshots.delete(route); },
  readSessionTailEntry,
});
const {
  sessionSources, getRegisteredSession, getRPCSession,
  resolveSessionCandidate, liveSessionHistoryPending,
  getLiveSession, adoptBridgeSessionSwitch, describeRuntime, locatePiPane,
  liveSubsessionCandidates, liveSourceObservations,
} = ownership;
const sessionLaunch = createSessionLaunch({ runHarnessModelCommand });
const sessionOperations = createSessionOperations({
  ownership,
  launch: sessionLaunch,
  getActiveSessions,
  readSessionCwd,
  recordLaunchProvenance: (id, sourceId, operationId) => sessionProvenance.recordLaunch(id, sourceId, operationId),
});
function apiIdForCandidate(candidate) {
  return candidate.routeId;
}

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


app.use('/api/sessions/:id', (req, res, next) => {
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
async function liveTreeLeafId(sess) {
  if (!sess.treeLeafUnsupported) {
    try {
      return (await sess.readTreeLeaf())?.leafId ?? null;
    } catch (e) {
      if (!/unknown command/i.test(String(e?.message || e))) throw e;
      sess.treeLeafUnsupported = true;
    }
  }
  return (await sess.readTree())?.leafId ?? null;
}

// Extension UI is per-session state, but SSE connections come and go with
// every session switch in the client. Remember each live session's current
// widgets, statuses, and unresolved dialogs here so the stream route can
// replay them to a client that just (re)connected — the bridge only replays
// its state when *our* socket connects, which happens once per session.
// Attached once per session object; the state dies with the connection,
// matching the bridge-side replay on reconnect.
const EXT_UI_DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor', 'ask']);

function trackExtUIState(sess) {
  if (!sess) return sess;
  const state = sess.extUIState || { widgets: new Map(), statuses: new Map(), dialogs: new Map() };
  sess.extUIState = state;
  const dismissAskDialogs = (source) => {
    for (const [id, data] of state.dialogs) {
      if (data?.method !== 'ask') continue;
      state.dialogs.delete(id);
      sess.emit('extension_ui_resolved', { id, source });
      if (typeof sess.respondExtensionUI === 'function') {
        Promise.resolve(sess.respondExtensionUI(id, { cancelled: true })).catch(() => {});
      }
    }
  };
  // A native ask tool can only wait during an active turn. A replayed ask on
  // an idle OMP session is orphaned state from a failed/reloaded UI wrapper.
  if (!sess.turnInProgress) dismissAskDialogs('idle');
  if (sess.extUIStateTracked) return sess;
  sess.extUIStateTracked = true;
  sess.on('session_switch', (data) => {
    state.widgets.clear();
    state.statuses.clear();
    state.dialogs.clear();
    adoptBridgeSessionSwitch(sess, data);
  });
  sess.on('extension_ui_request', (data) => {
    if (!data || !data.method) return;
    if (data.method === 'setWidget') {
      const key = data.widgetKey || 'default';
      if (Array.isArray(data.widgetLines) && data.widgetLines.length) state.widgets.set(key, data);
      else state.widgets.delete(key);
    } else if (data.method === 'setStatus') {
      const key = data.statusKey || 'default';
      if (data.statusText) state.statuses.set(key, data);
      else state.statuses.delete(key);
    } else if (EXT_UI_DIALOG_METHODS.has(data.method) && data.id) {
      state.dialogs.set(data.id, data);
    }
  });
  sess.on('extension_ui_resolved', (data) => {
    if (data?.id) state.dialogs.delete(data.id);
  });
  sess.on('turn_end', () => dismissAskDialogs('turn-end'));
  sess.on('agent_end', () => dismissAskDialogs('agent-end'));
  return sess;
}


/** Live context usage, whichever backend reports it (registry beats RPC stats). */
function getLiveContextUsage(sessionId) {
  const reg = getRegisteredSession(sessionId);
  if (reg?.contextUsage) return reg.contextUsage;
  return getRPCSession(sessionId)?.lastStats?.contextUsage || null;
}

async function getSessionModels(sessionId) {
  if (!sessionId) return null;
  try {
    const sess = await getLiveSession(sessionId);
    if (sess && liveSessionSupports(sess, 'models')) {
      const data = await sess.getAvailableModels();
      return normalizeModels(data?.models || data);
    }
  } catch (e) {
    console.warn(`Failed to get session models for ${sessionId}:`, e.message);
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
const contextWindowMemo = new Map();

function getContextWindow(modelId) {
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
    const longest = (ms) => ms.reduce((a, b) => (b.id.length > a.id.length ? b : a), ms[0]);
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
function withContext(info) {
  return withSessionContext(info, getContextWindow);
}

function parseSessionFile(source) {
  return withContext(getSessionInfo(source));
}

// =========================================================================
// Session listing
// =========================================================================

/**
 * Active sessions = sessions registered by the pi-dish-bridge extension.
 * We enrich the registry entry with metadata from the on-disk JSONL.
 */
function collectActiveObservations(registered = listRegisteredSessions()) {
  const active = [];
  const seen = new Set();
  const groups = new Map();
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
    const identity = registryIdentity(reg);
    const ownedSpawn = tmux.getSpawn(routeId);
    const closeMode = getHarness(identity.harnessId).closeMode;
    const restartAllowed = spawnAllowsRestart(ownedSpawn, reg, closeMode);
    let info = null;
    let source = null;
    if (reg.sessionFile && fs.existsSync(reg.sessionFile)) {
      try {
        source = sourceForIdentity(identity.harnessId, identity.nativeSessionId, reg.sessionFile);
        info = getSessionInfo(source);
      } catch {}
    }
    active.push(registeredSessionObservation(reg, {
      ...identity, source, info,
      advice: {
        capabilities: sessionCapabilities(identity.harnessId, reg.capabilities || {}, {
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
    let info = null;
    let source = null;
    const rpcFile = rpc.sessionFile || rpc.state?.sessionFile;
    if (rpcFile && fs.existsSync(rpcFile)) {
      try {
        source = sourceForIdentity('pi', rpc.id, rpcFile);
        info = getSessionInfo(source);
      } catch {}
    }
    active.push(rpcSessionObservation(rpc, {
      nativeSessionId: rpc.id, source, info,
      advice: {
        capabilities: sessionCapabilities('pi', {}, { active: true, restartAllowed: true }),
        closeMode: getHarness('pi').closeMode, conflicted: false, liveInstanceCount: 1,
      },
    }));
    seen.add(rpc.id);
  }

  return active;
}

const catalogOptions = {
  harnesses: new Map(listHarnesses().map(descriptor => [descriptor.id, descriptor])),
  contextWindowForModel: getContextWindow,
  canonicalPath: canonicalSessionPath,
  directoryExists: directory => fs.existsSync(directory),
};

function historicalAdvice(source, liveChild = false) {
  return {
    capabilities: {
      ...sessionCapabilities(source.harnessId, {}, { active: false }),
      ...(liveChild ? { resume: false } : {}),
    },
    closeMode: getHarness(source.harnessId).closeMode,
    conflicted: false, liveInstanceCount: 0,
  };
}

// Lifecycle and routine callers need only current observations: no historical
// corpus or live-child traversal follows from this active projection.
function getActiveSessions(registered = listRegisteredSessions()) {
  return composeSessionCatalog({
    active: collectActiveObservations(registered), history: [],
    launchParents: new Map(), routines: new Map(), activeOnly: true,
    indexing: false, discoveryTruncated: false, discoverySkipped: 0,
  }, catalogOptions).active;
}


// Bound first-poll full reads of previously unseen live child histories.
const SUBSESSION_ROW_CAP = 64;

function enumerateSessionCandidates(excludeIds = new Set()) {
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
function matchSessionQuery(session, parsed) {
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
function filterSessionsByQuery(list, query) {
  const parsed = parseSessionQuery(query);
  if (!parsed.terms.length && parsed.since === null && parsed.before === null) return list;
  const rank = positiveQueryTokens(parsed).length > 0;
  const out = [];
  for (const session of list) {
    const m = matchSessionQuery(session, parsed);
    if (!m) continue;
    if (!rank) { out.push(session); continue; }
    const text = m.text ?? (session.sessionFile ? sessionIndex.getSearchText(sourceForIdentity(
      session.harnessId, session.nativeSessionId, session.sessionFile)) : null);
    const entry = { ...session, searchScore: scoreSessionMatch(parsed, session, text) };
    if (m.snippet) entry.searchSnippet = m.snippet;
    out.push(entry);
  }
  if (rank) {
    out.sort((a, b) => b.searchScore - a.searchScore
      || new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
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
function clientSessionRows(rows) {
  return rows.map(session => sessionForClient(session));
}

app.get('/api/sessions', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  let { active, previous, children, indexing, discoveryTruncated, discoverySkipped } =
    buildSessionCatalog({ activeOnly: req.query.active === '1' });

  if (query) {
    active = filterSessionsByQuery(active, query);
    previous = filterSessionsByQuery(previous, query);
    children = filterSessionsByQuery(children, query);
  }
  if (req.query.view === 'client') {
    active = clientSessionRows(active);
    previous = clientSessionRows(previous);
    children = clientSessionRows(children);
  }
  res.json({ active, previous, children, indexing, discoveryTruncated, discoverySkipped });
});

// Refs resolve through the shared rule in lib/helper-refs.js (route id and
// alias, exact then prefix — see the comment there), so GET
// /api/sessions/resolve, the `#ref` prompt expansion, the skill CLIs' local
// fallback and the browser's picker cannot disagree about what a ref means.
// An active entry wins a collision with a historical one of the same id.
// `exactOnly` serves the machine-produced `<hostId>:<fullId>` form, whose id
// is whole — expanding a prefix there could retarget a recorded ref.
function resolveRefInCatalog(catalog, ref, exactOnly = false) {
  return resolveSessionRefAmong(catalog.list, ref, { exactOnly });
}

// Session refs: resolve a short id prefix to one full list entry. Registered
// ahead of every /api/sessions/:id route so the literal path can never be
// captured as an id. The candidate set is exactly what GET /api/sessions
// serves (buildSessionCatalog = active + historical, each already carrying
// its withContext treatment); an active entry wins a collision with a
// historical one of the same id.
app.get('/api/sessions/resolve', (req, res) => {
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

function canonicalSessionPath(file) {
  if (!file) return null;
  try { return fs.realpathSync(file); } catch { return path.resolve(file); }
}

function relationSessionSummary(session) {
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

function buildSessionCatalog({ activeOnly = false } = {}) {
  const registered = listRegisteredSessions();
  const active = collectActiveObservations(registered);
  const liveChildren = liveSubsessionCandidates(active.map(observation => ({
    id: observation.id, harnessId: observation.harnessId, sessionFile: observation.claimedFile,
  })));
  const history = [];
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
app.get('/api/sessions/:id/related', (req, res) => {
  try {
    const base = buildSessionCatalog();
    const catalog = { ...base, list: [...base.list], byId: new Map(base.byId), byPath: new Map(base.byPath) };
    let current = catalog.byId.get(req.params.id);
    if (!current) {
      const candidate = resolveSessionCandidate(req.params.id);
      if (!candidate) return res.status(404).json({ error: 'Session not found' });
      current = buildSourceSession(candidate, getSessionInfo(candidate), historicalAdvice(candidate), catalogOptions);
      catalog.byId.set(current.id, current);
      catalog.byPath.set(canonicalSessionPath(candidate.file), current);
      catalog.list.push(current);
    }

    const relations = [];
    const seen = new Set();
    const add = (kind, source, target) => {
      if (!target || target.id === current.id) return;
      const key = `${kind}:${source}:${target.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      relations.push({ kind, source, session: relationSessionSummary(target) });
    };
    const resolveParent = (session) => {
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
    const status = /Invalid session ID|Unknown harness/.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

// Recursive family view behind the subagents viewer: the whole native/launch
// family around a session rather than /related's direct neighbors. Same
// advisory sources and the same non-authority — edges label provenance
// (subagent header/layout vs pi-dish launch), never control rights.
const LINEAGE_NODE_CAP_DEFAULT = 500;
const LINEAGE_DEPTH_CAP = 24;
app.get('/api/sessions/:id/lineage', (req, res) => {
  try {
    const nodeCap = (() => {
      const parsed = Number.parseInt(process.env.PI_DISH_LINEAGE_NODE_CAP || '', 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : LINEAGE_NODE_CAP_DEFAULT;
    })();
    const catalog = buildSessionCatalog();
    let current = catalog.byId.get(req.params.id);
    if (!current) {
      const candidate = resolveSessionCandidate(req.params.id);
      if (!candidate) return res.status(404).json({ error: 'Session not found' });
      current = buildSourceSession(candidate, getSessionInfo(candidate), historicalAdvice(candidate), catalogOptions);
      // Mirror composeSessionCatalog's parent resolution for a row the scan
      // has not folded in yet (indexing race): native header first, launch
      // provenance second.
      let nativeParent = null;
      if (current.parentSession && current.sessionFile) {
        const parentFile = path.isAbsolute(current.parentSession) ? current.parentSession
          : path.resolve(path.dirname(current.sessionFile), current.parentSession);
        nativeParent = catalog.byPath.get(canonicalSessionPath(parentFile))?.id || null;
      }
      const launch = sessionProvenance.getLaunch(current.id);
      current.parentId = nativeParent
        || (launch && catalog.byId.has(launch.sourceSessionId) ? launch.sourceSessionId : null);
      current.parentSource = nativeParent ? current.parentSessionSource || 'pi-session-header'
        : current.parentId ? 'pi-dish-launch' : null;
      catalog.list.push(current);
      catalog.byId.set(current.id, current);
    }

    const childrenOf = new Map(); // parentId -> CatalogSession[]
    for (const session of catalog.list) {
      if (!session.parentId || session.parentId === session.id) continue;
      const siblings = childrenOf.get(session.parentId);
      if (siblings) siblings.push(session); else childrenOf.set(session.parentId, [session]);
    }
    const activityMs = (session) => {
      const value = new Date(session.lastActivity || 0).getTime();
      return Number.isFinite(value) ? value : 0;
    };

    // The top ancestor owns the root slot. Cycle-guarded: hand-edited headers
    // can point two files at each other.
    let root = current;
    const ancestors = new Set([current.id]);
    while (root.parentId) {
      const parent = catalog.byId.get(root.parentId);
      if (!parent || ancestors.has(parent.id)) break;
      ancestors.add(parent.id);
      root = parent;
    }

    const placed = new Set();
    let members = 0, truncated = false;
    const buildNode = (session, edge, depth) => {
      if (placed.has(session.id)) return null;
      if (depth > LINEAGE_DEPTH_CAP || members >= nodeCap) { truncated = true; return null; }
      placed.add(session.id);
      members += 1;
      const children = [];
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
    const status = /Invalid session ID|Unknown harness/.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
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
app.get('/api/search', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
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
  const results = [];
  let hiddenByScopes = 0;
  let hiddenByAutomation = 0;
  for (const session of [...active, ...previous]) {
    if (hideAutomation && !session.isActive && isAutomationSession(session)) {
      hiddenByAutomation++;
      continue;
    }
    let text = null;
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
    let snippets = [], matchCount = 0;
    if (contentTokens.length && session.sessionFile) {
      text ??= sessionIndex.getSearchText(sourceForIdentity(
        session.harnessId, session.nativeSessionId, session.sessionFile));
      ({ snippets, count: matchCount } = buildSnippets(text, contentTokens));
    }
    results.push({ ...session, snippets, matchCount, searchScore: scoreSessionMatch(parsed, session, text) });
  }
  results.sort((a, b) => b.searchScore - a.searchScore
    || new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  res.json({
    results: results.slice(0, SEARCH_RESULT_CAP),
    total: results.length,
    hiddenByScopes,
    hiddenByAutomation,
    indexing,
    discoveryTruncated,
    discoverySkipped,
  });
});

const USAGE_COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
const emptyUsage = () => ({
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  costs: Object.fromEntries(USAGE_COST_KEYS.map(key => [key, 0])),
  costUnavailable: Object.fromEntries(USAGE_COST_KEYS.map(key => [key, 0])),
  calls: 0, measured: 0, durationMs: 0, slowestMs: 0,
});
function addUsage(to, from) {
  if (!from) return to;
  for (const k of Object.keys(to.tokens)) to.tokens[k] += from.tokens?.[k] || 0;
  for (const k of USAGE_COST_KEYS) {
    to.costUnavailable[k] += from.costUnavailable?.[k] || 0;
    const value = from.costs?.[k];
    if (Number.isFinite(value)) {
      to.costs[k] = (Number.isFinite(to.costs[k]) ? to.costs[k] : 0) + value;
    }
  }
  for (const k of ['calls', 'measured', 'durationMs']) to[k] += from[k] || 0;
  to.slowestMs = Math.max(to.slowestMs, from.slowestMs || 0);
  return to;
}
function localDay(offset = 0) {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function readDishSettings() {
  try { const v = JSON.parse(fs.readFileSync(DISH_SETTINGS_FILE, 'utf8')); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

app.get('/api/usage-summary', async (req, res) => {
  const range = String(req.query.days || '30');
  if (!['1', '7', '30', 'all'].includes(range)) return res.status(400).json({ error: 'days must be 1, 7, 30, or all' });
  const sort = String(req.query.sort || 'cost');
  if (!['cost', 'tokens'].includes(sort)) return res.status(400).json({ error: 'sort must be cost or tokens' });
  // Multi-select model filter. It has to be applied here, not client-side:
  // the workspace/session groups are truncated to the top 20 below, and only
  // the per-session usage.models day buckets can rebuild their totals for a
  // subset of models. groups.models stays unfiltered — it is the facet list
  // the client toggles from. Headline KPIs stay global (fixed windows).
  const modelsRaw = req.query.models == null ? '' : String(req.query.models);
  if (modelsRaw.length > 4000) return res.status(400).json({ error: 'models filter too long' });
  const modelRefs = modelsRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (modelRefs.length > 100) return res.status(400).json({ error: 'models filter lists too many models' });
  const modelFilter = modelRefs.length ? new Set(modelRefs) : null;
  await Promise.all(['pi', 'omp'].map(harnessId => refreshHarnessPricing(harnessId)));
  const discovery = discoverHarnessSessions();
  const candidates = discovery.candidates;
  const scan = sessionIndex.scanSessions(candidates);
  const cutoff = range === 'all' ? null : localDay(Number(range) - 1);
  const totals = emptyUsage(), byModel = new Map(), byWorkspace = new Map(), bySession = new Map();
  const dailyMap = new Map(), dailyModels = new Map();
  const headlineUsage = Object.fromEntries(['today', 'days7', 'days30', 'all', 'month'].map(key => [key, emptyUsage()]));
  const now = new Date(), monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
  for (const c of candidates) {
    const info = scan.infos.get(c.file), usage = info?.usage;
    if (!usage) continue;
    const selected = emptyUsage();
    for (const [day, bucket] of Object.entries(usage.days || {})) {
      const dated = day !== 'unknown';
      addUsage(headlineUsage.all, bucket);
      if (dated && day === localDay()) addUsage(headlineUsage.today, bucket);
      if (dated && day >= localDay(6)) addUsage(headlineUsage.days7, bucket);
      if (dated && day >= localDay(29)) addUsage(headlineUsage.days30, bucket);
      if (dated) addUsage(dailyMap.get(day) || (dailyMap.set(day, emptyUsage()), dailyMap.get(day)), bucket);
      if (dated && day.startsWith(monthPrefix)) addUsage(headlineUsage.month, bucket);
      // Under a model filter the session's selected usage is rebuilt from its
      // per-model buckets below; the day buckets can't be split by model.
      if (!modelFilter && (!cutoff || (dated && day >= cutoff))) addUsage(selected, bucket);
    }
    for (const [ref, bucket] of Object.entries(usage.models || {})) {
      const modelSelected = emptyUsage();
      if (bucket.days) for (const [day, part] of Object.entries(bucket.days)) {
        if (day !== 'unknown') {
          const dayModels = dailyModels.get(day) || (dailyModels.set(day, new Map()), dailyModels.get(day));
          addUsage(dayModels.get(ref) || (dayModels.set(ref, { provider: bucket.provider, model: bucket.model, ...emptyUsage() }), dayModels.get(ref)), part);
        }
        if (!cutoff || (day !== 'unknown' && day >= cutoff)) addUsage(modelSelected, part);
      }
      else if (!cutoff) addUsage(modelSelected, bucket); // schema-2 transitional safety
      if (modelSelected.calls) {
        addUsage(byModel.get(ref) || (byModel.set(ref, { ...emptyUsage(), provider: bucket.provider, model: bucket.model }), byModel.get(ref)), modelSelected);
        if (!modelFilter || modelFilter.has(ref)) {
          if (modelFilter) addUsage(selected, modelSelected);
        }
      }
    }
    addUsage(totals, selected);
    if (selected.calls) {
      addUsage(byWorkspace.get(info.cwd || usage.cwd || '(unknown)') || (byWorkspace.set(info.cwd || usage.cwd || '(unknown)', emptyUsage()), byWorkspace.get(info.cwd || usage.cwd || '(unknown)')), selected);
      const routeId = apiIdForCandidate(c);
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
    if (!modelFilter || modelFilter.has(ref)) unpricedModelCalls += b.unpricedCalls;
  }
  for (const bucket of [...byWorkspace.values(), ...bySession.values()]) {
    bucket.priced = !bucket.costUnavailable.total;
    bucket.unpricedCalls = bucket.costUnavailable.total;
  }
  totals.unpricedCalls = unpricedModelCalls;
  // Rank by the same token total the client displays (reasoning stays out of
  // the sum there too), so the sorted order matches the numbers on screen.
  const displayedTokens = t => (t?.input || 0) + (t?.output || 0) + (t?.cacheRead || 0) + (t?.cacheWrite || 0);
  const compare = (a, b) => {
    if (sort === 'tokens') return displayedTokens(b.tokens) - displayedTokens(a.tokens) || b.calls - a.calls;
    const aKnown = Number.isFinite(a.costs?.total), bKnown = Number.isFinite(b.costs?.total);
    if (aKnown !== bKnown) return Number(bKnown) - Number(aKnown);
    return (bKnown ? b.costs.total - a.costs.total : 0) || b.calls - a.calls;
  };
  const top = map => [...map.entries()].map(([key, value]) => ({ key, ...value })).sort(compare).slice(0, 20);
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
        if ((!earliest || day < earliest) && [...models.keys()].some(ref => modelFilter.has(ref))) earliest = day;
      }
    } else for (const day of dailyMap.keys()) if (!earliest || day < earliest) earliest = day;
    if (earliest) {
      const [y, m, d] = earliest.split('-').map(Number);
      const start = new Date(y, m - 1, d, 12), today = new Date(); today.setHours(12, 0, 0, 0);
      spanDays = Math.min(DAILY_SPAN_CAP, Math.max(1, Math.round((today - start) / 86400000) + 1));
    }
  }
  const daily = Array.from({ length: spanDays }, (_, i) => {
    const day = localDay(spanDays - 1 - i);
    const dayEntries = [...(dailyModels.get(day)?.entries() || [])]
      .filter(([ref]) => !modelFilter || modelFilter.has(ref));
    const models = dayEntries
      .map(([ref, b]) => ({ ref, provider: b.provider, model: b.model, calls: b.calls, cost: b.costs.total, costUnavailable: b.costUnavailable, tokens: b.tokens }))
      .sort((a, b) => Number.isFinite(b.cost) - Number.isFinite(a.cost) || (Number.isFinite(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls);
    if (!modelFilter) return { day, ...(dailyMap.get(day) || emptyUsage()), models };
    const dayTotal = emptyUsage();
    for (const [, b] of dayEntries) addUsage(dayTotal, b);
    return { day, ...dayTotal, models };
  });
  const headlineCosts = Object.fromEntries(Object.entries(headlineUsage).map(([key, bucket]) => [key, bucket.costs.total]));
  // Per-component twins of the headline scalars, so the client can pivot
  // every KPI into read/cached-read/output/cache-write buckets without
  // another request.
  const headlineCostsByBucket = Object.fromEntries(Object.entries(headlineUsage).map(([key, bucket]) => [key, bucket.costs]));
  const headlineCostUnavailable = Object.fromEntries(Object.entries(headlineUsage).map(([key, bucket]) => [key, bucket.costUnavailable.total]));
  res.json({ range, sort, models: modelFilter ? [...modelFilter] : null, totals, groups: { models: top(byModel), workspaces: top(byWorkspace), sessions: [...bySession.values()].sort(compare).slice(0, 20) }, headlineCosts, headlineCostsByBucket, headlineCostUnavailable, daily, unpricedModelCalls, indexing: scan.indexing, discoveryTruncated: discovery.truncated, discoverySkipped: discovery.skipped, monthlyBudgetUsd: readDishSettings().monthlyBudgetUsd ?? null });
});

// Subscription/quota windows (5h/7d utilization, reset times) per provider
// account, reported by the harness's own CLI — OMP's `usage` reads its auth
// store and queries the providers directly, so no running session is needed
// and pi-dish never reimplements provider quota APIs. Harnesses without a
// `usage` argv (Pi, Prime) simply contribute nothing; a harness whose command
// fails degrades to an `error` entry rather than failing the route.
function normalizeUsageLimit(limit) {
  if (!limit || typeof limit !== 'object') return null;
  const usedFraction = Number(limit.amount?.usedFraction);
  if (typeof limit.label !== 'string' || !Number.isFinite(usedFraction)) return null;
  const resetsAt = Number(limit.window?.resetsAt);
  return {
    id: typeof limit.id === 'string' ? limit.id : null,
    label: limit.label.slice(0, 120),
    windowLabel: typeof limit.window?.label === 'string' ? limit.window.label.slice(0, 60) : null,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    usedFraction,
    unit: typeof limit.amount?.unit === 'string' ? limit.amount.unit.slice(0, 30) : null,
    status: typeof limit.status === 'string' ? limit.status.slice(0, 30) : null,
  };
}

app.get('/api/usage-limits', async (_req, res) => {
  const harnesses = listHarnesses().filter(d => d.argv?.usage && harnessCommandAvailable(d));
  const results = await Promise.all(harnesses.map(async d => {
    try {
      const parsed = await runHarnessJsonCommand(d, d.argv.usage);
      // Whitelist fields: even --redact output carries partial account ids,
      // and the raw reports may hold emails — none of it belongs on the wire.
      const reports = (Array.isArray(parsed.reports) ? parsed.reports : []).map(report => ({
        provider: String(report?.provider || 'unknown').slice(0, 60),
        fetchedAt: Number.isFinite(Number(report?.fetchedAt)) ? Number(report.fetchedAt) : null,
        planType: typeof report?.metadata?.planType === 'string' ? report.metadata.planType.slice(0, 40) : null,
        limits: (Array.isArray(report?.limits) ? report.limits : []).map(normalizeUsageLimit).filter(Boolean),
      })).filter(report => report.limits.length);
      return { harness: d.id, label: d.label, reports };
    } catch (e) {
      return { harness: d.id, label: d.label, error: e.message };
    }
  }));
  res.json({ generatedAt: Date.now(), harnesses: results });
});

// =========================================================================
// Skills view (main-pane takeover) — inventory from pi's loader + activation
// rollups mined into the session index. Observational only: every token
// number is a chars/4 estimate, every usage number is inferred from tool
// calls. See TASKS/skills-view-phase1.md.
// =========================================================================

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

// Distinct project cwds pi-dish knows about — the scope over which skills are
// discovered (global user skills plus every project root).
function knownWorkspaceCwds() {
  const cwds = new Set();
  try {
    for (const session of buildSessionCatalog().list) if (session.cwd) cwds.add(session.cwd);
  } catch {}
  return [...cwds];
}

// Which refinement methodology the ✎ button drafts. Env wins over the dish
// setting; a value with a path separator is a markdown file to read, a bare
// token is a pi skill name; unset is the vended default skill.
function resolveRefineConfig(inventory) {
  const envVal = process.env.PI_DISH_REFINE;
  const settingVal = readDishSettings().refine;
  const raw = (envVal != null && envVal !== '') ? envVal
    : (typeof settingVal === 'string' ? settingVal : '');
  const names = new Set((inventory?.skills || []).map(s => s.name));
  if (raw) {
    if (raw.includes('/') || raw.includes(path.sep)) {
      const abs = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw);
      return { mode: 'path', mdPath: abs };
    }
    return { mode: 'skill', skillName: raw, discovered: names.has(raw) };
  }
  return {
    mode: 'default',
    skillName: 'pi-dish-skill-refine',
    discovered: names.has('pi-dish-skill-refine'),
    mdPath: path.join(__dirname, 'skills', 'pi-dish-skill-refine', 'SKILL.md'),
  };
}

// Weekly activation buckets, most-recent-last, `weeks` long. Zero weeks stay
// as zeros (rendered as --chart-other stubs by the client — never omitted).
function weeklyBuckets(records, weeks, now = Date.now()) {
  const out = new Array(weeks).fill(0);
  for (const r of records) {
    if (!Number.isFinite(r.ts)) continue;
    const age = Math.floor((now - r.ts) / WEEK_MS);
    if (age < 0 || age >= weeks) continue;
    out[weeks - 1 - age]++;
  }
  return out;
}

function usageRollup(records, now = Date.now()) {
  const cutoff30 = now - 30 * DAY_MS;
  let count30 = 0, lastUsedTs = null;
  const kindSplit = { read: 0, targeted: 0, explicit: 0 };
  const sessions = new Set(), cwds = new Map();
  let latest = null;
  for (const r of records) {
    kindSplit[r.kind] = (kindSplit[r.kind] || 0) + 1;
    if (Number.isFinite(r.ts)) {
      if (r.ts >= cutoff30) count30++;
      if (lastUsedTs == null || r.ts > lastUsedTs) lastUsedTs = r.ts;
      if (!latest || r.ts > latest.ts) latest = r;
    }
    if (r.sessionId) sessions.add(r.sessionId);
    if (r.cwd) cwds.set(r.cwd, (cwds.get(r.cwd) || 0) + 1);
  }
  const topCwd = [...cwds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    count30d: count30,
    lastUsedTs,
    kindSplit,
    sessionCount: sessions.size,
    cwdCount: cwds.size,
    topCwd,
    total: records.length,
    latest: latest ? { sessionId: latest.sessionId, entryId: latest.entryId, ts: latest.ts, model: latest.model, cwd: latest.cwd } : null,
  };
}

// Split SKILL.md into markdown sections by heading. Returns 1-indexed line
// ranges. The preamble before the first heading is its own "(intro)" section.
function splitSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let cur = { heading: '(intro)', level: 0, startLine: 1, lines: [] };
  lines.forEach((line, i) => {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (cur.lines.length) { cur.endLine = cur.startLine + cur.lines.length - 1; sections.push(cur); }
      cur = { heading: line.trim(), level: m[1].length, startLine: i + 1, lines: [line] };
    } else {
      cur.lines.push(line);
    }
  });
  if (cur.lines.length) { cur.endLine = cur.startLine + cur.lines.length - 1; sections.push(cur); }
  // Drop a leading empty intro (a file starting with a heading).
  return sections.filter(s => !(s.heading === '(intro)' && s.lines.join('').trim() === ''));
}

// Line set covered by one ranged/full read record, clamped to lineCount.
function coveredLines(rec, lineCount) {
  const set = new Set();
  const add = (s, e) => { for (let i = Math.max(1, s); i <= Math.min(lineCount, e); i++) set.add(i); };
  if (rec.kind === 'explicit') { add(1, lineCount); return set; }
  if (rec.ranges === 'all') { add(1, Number.isFinite(rec.truncatedTo) ? rec.truncatedTo : lineCount); return set; }
  if (Array.isArray(rec.ranges)) {
    for (const [s, e] of rec.ranges) add(s, e === -1 ? lineCount : e);
  }
  return set;
}

app.get('/api/skills', async (req, res) => {
  try {
    const cwds = knownWorkspaceCwds();
    const inventory = await skillsLib.getSkillsInventory({ cwds });
    sessionIndex.setSkillRoots(inventory.skills.map(s => s.filePath));
    const candidates = enumerateSessionCandidates();
    const scan = sessionIndex.scanSessions(candidates);
    const now = Date.now();
    const skills = inventory.skills.map(s => {
      const records = sessionIndex.getSkillActivations({ skill: s.filePath });
      const roll = usageRollup(records, now);
      return { ...s, usage: { ...roll, weeks12: weeklyBuckets(records, 12, now) } };
    });
    const quietCutoff = now - 60 * DAY_MS;
    const summary = {
      discovered: inventory.discovered,
      advertised: inventory.advertised,
      catalogTokensEst: inventory.catalogTokensEst,
      preambleTokensEst: inventory.preambleTokensEst,
      activations30d: skills.reduce((a, s) => a + s.usage.count30d, 0),
      quiet60d: skills.filter(s => s.usage.lastUsedTs == null || s.usage.lastUsedTs < quietCutoff).length,
      diagnostics: inventory.diagnostics.length,
    };
    res.json({
      scope: inventory.scope,
      summary,
      skills,
      diagnostics: inventory.diagnostics,
      refine: resolveRefineConfig(inventory),
      indexing: scan.indexing,
      precision: 'estimate',
    });
  } catch (e) {
    console.error('GET /api/skills failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// The primitive: raw activation records as an NDJSON stream. No pagination —
// a pipe for user scripts. Filters: skill, since (ms epoch or 7d/12h/2w),
// cwd, kind.
app.get('/api/skills/activations', (req, res) => {
  // Ensure the corpus is indexed (mines skills as a side effect).
  sessionIndex.scanSessions(enumerateSessionCandidates());
  const filter = {};
  if (req.query.skill) filter.skill = String(req.query.skill);
  if (req.query.cwd) filter.cwd = String(req.query.cwd);
  if (req.query.kind) filter.kind = String(req.query.kind);
  const since = req.query.since != null ? String(req.query.since) : '';
  if (since) {
    const rel = since.match(/^(\d+)(h|d|w)$/);
    if (rel) {
      const n = Number(rel[1]);
      const mult = rel[2] === 'h' ? 3600000 : rel[2] === 'd' ? DAY_MS : WEEK_MS;
      filter.sinceMs = Date.now() - n * mult;
    } else {
      const t = /^\d+$/.test(since) ? Number(since) : Date.parse(since);
      if (Number.isFinite(t)) filter.sinceMs = t;
    }
  }
  const records = sessionIndex.getSkillActivations(filter)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  res.type('application/x-ndjson');
  res.send(records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
});

// Current-version coverage rollup for one skill: sections of SKILL.md with a
// read fraction over the ranged reads since the file's mtime, plus targeted
// touch counts and a headline unread-tokens estimate.
app.get('/api/skills/coverage', (req, res) => {
  const skill = String(req.query.skill || '');
  if (!skill || path.basename(skill) !== 'SKILL.md') {
    return res.status(400).json({ error: 'skill must be an absolute SKILL.md path' });
  }
  let content, stat;
  try { stat = fs.statSync(skill); content = fs.readFileSync(skill, 'utf-8'); }
  catch { return res.status(404).json({ error: 'skill file not found' }); }

  sessionIndex.scanSessions(enumerateSessionCandidates());
  const now = Date.now();
  const all = sessionIndex.getSkillActivations({ skill });
  const lines = content.split('\n');
  const lineCount = lines.length;
  const contentHash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 12);

  // Mapped = ranged/full reads (kind read|explicit) since the last edit.
  const mapped = all.filter(r => (r.kind === 'read' || r.kind === 'explicit') &&
    Number.isFinite(r.ts) && r.ts >= stat.mtimeMs);
  const excludedBeforeMtime = all.filter(r => (r.kind === 'read' || r.kind === 'explicit') &&
    (!Number.isFinite(r.ts) || r.ts < stat.mtimeMs)).length;
  const targetedTouches = all.filter(r => r.kind === 'targeted').length;

  // Per-line read count across the mapped reads.
  const lineHits = new Array(lineCount + 1).fill(0);
  let anyPartial = false;
  for (const r of mapped) {
    const set = coveredLines(r, lineCount);
    if (set.size < lineCount) anyPartial = true;
    for (const ln of set) lineHits[ln]++;
  }
  const numMapped = mapped.length;

  const sections = splitSections(content).map(sec => {
    let readsTouching = 0;
    for (const r of mapped) {
      const set = coveredLines(r, lineCount);
      let hit = false;
      for (let ln = sec.startLine; ln <= sec.endLine; ln++) if (set.has(ln)) { hit = true; break; }
      if (hit) readsTouching++;
    }
    const lineHeat = [];
    for (let ln = sec.startLine; ln <= sec.endLine; ln++) {
      lineHeat.push({ text: lines[ln - 1], hits: lineHits[ln] });
    }
    return {
      heading: sec.heading, level: sec.level,
      startLine: sec.startLine, endLine: sec.endLine,
      lineCount: sec.endLine - sec.startLine + 1,
      reads: readsTouching,
      fraction: numMapped ? readsTouching / numMapped : 0,
      neverRead: numMapped > 0 && readsTouching === 0,
      lines: lineHeat,
    };
  });

  // Unread token estimate: lines no mapped read ever touched.
  let unreadChars = 0;
  for (let ln = 1; ln <= lineCount; ln++) if (!lineHits[ln]) unreadChars += lines[ln - 1].length + 1;
  const unreadTokensEst = Math.ceil(unreadChars / 4);

  // A short skill that every mapped read loaded in full → render prose, not a map.
  const flatFullRead = numMapped > 0 && !anyPartial;

  const roll = usageRollup(all, now);
  // Resolve latest activation's session name for the deep-link label.
  let latest = roll.latest;
  if (latest && latest.sessionId) {
    try {
      const source = findSessionSource(latest.sessionId);
      if (source) latest = { ...latest, name: getSessionInfo(source).name || null };
    } catch {}
  }

  res.json({
    skill,
    mtimeMs: stat.mtimeMs,
    contentHash,
    lineCount,
    numMapped,
    mappedReads: numMapped,
    targetedTouches,
    excludedBeforeMtime,
    unreadTokensEst,
    flatFullRead,
    sections,
    weeks26: weeklyBuckets(all, 26, now),
    kindSplit: roll.kindSplit,
    sessionCount: roll.sessionCount,
    cwdCount: roll.cwdCount,
    topCwd: roll.topCwd,
    latest,
    precision: 'estimate',
  });
});

// Saved sidebar filters ("scopes") are server-global like the budget: the
// user defines "no subagents" once, every device gets the chip. Which chips
// are *active* stays device-local (localStorage) — a phone and a desktop can
// scope differently.
function sanitizeSavedFilters(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const out = [];
  const seen = new Set();
  for (const f of value) {
    const name = typeof f?.name === 'string' ? f.name.trim() : '';
    const query = typeof f?.query === 'string' ? f.query.trim() : '';
    if (!name || !query || name.length > 60 || query.length > 500 || seen.has(name)) return null;
    seen.add(name);
    out.push({ name, query });
  }
  return out;
}

// An allowlist, not a redaction: credential-bearing blocks (`remotes`, the
// `stt` endpoint + key, `allowedOrigins`) are deliberately file-level config
// and never travel to a client, in either direction — PUT below writes only
// allowlisted keys, so an `stt` key in a request body is ignored.
function settingsForClient(settings = readDishSettings()) {
  return {
    monthlyBudgetUsd: settings.monthlyBudgetUsd ?? null,
    savedFilters: sanitizeSavedFilters(settings.savedFilters) || [],
    recoveryMode: recoveryMode(settings.recoveryMode),
  };
}

app.get('/api/settings', (_req, res) => res.json(settingsForClient()));
// Partial update: only the keys present in the body change, so the budget
// form and the saved-filters UI can't clobber each other's setting.
app.put('/api/settings', (req, res) => {
  const body = req.body || {};
  const settings = readDishSettings();
  if ('monthlyBudgetUsd' in body) {
    const value = body.monthlyBudgetUsd;
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 1_000_000)) return res.status(400).json({ error: 'monthlyBudgetUsd must be null or a positive number at most 1000000' });
    if (value === null) delete settings.monthlyBudgetUsd; else settings.monthlyBudgetUsd = value;
  }
  if ('savedFilters' in body) {
    const filters = sanitizeSavedFilters(body.savedFilters);
    if (!filters) return res.status(400).json({ error: 'savedFilters must be up to 50 { name, query } entries with unique non-empty names (≤60 chars) and queries (≤500 chars)' });
    if (filters.length === 0) delete settings.savedFilters; else settings.savedFilters = filters;
  }
  if ('recoveryMode' in body) {
    if (!['off', 'restore', 'continue'].includes(body.recoveryMode)) {
      return res.status(400).json({ error: 'recoveryMode must be off, restore, or continue' });
    }
    settings.recoveryMode = body.recoveryMode;
  }
  try {
    fs.mkdirSync(path.dirname(DISH_SETTINGS_FILE), { recursive: true });
    const tmp = `${DISH_SETTINGS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n'); fs.renameSync(tmp, DISH_SETTINGS_FILE);
    res.json(settingsForClient(settings));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const sessionReadHandlers = createSessionReadHandlers({
  findSessionSource, liveSessionHistoryPending, getRegisteredSession, getRPCSession,
  getLiveSession, liveTreeLeafId, getLiveContextUsage, getContextWindow, describeRuntime,
});
const { exportSessionHtml, getOmpShareSnapshot } = sessionReadHandlers;

app.get('/api/sessions/:id/messages/:messageId/images/:blockIndex', sessionReadHandlers.image);

app.get('/api/sessions/:id/messages', sessionReadHandlers.messages);

app.get('/api/sessions/:id/search', sessionReadHandlers.search);

// Normalize client-sent attachments to pi's ImageContent shape, dropping
// anything malformed rather than failing the whole prompt.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function sanitizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((i) => i && typeof i.data === 'string' && BASE64_RE.test(i.data) && typeof i.mimeType === 'string' && i.mimeType.startsWith('image/'))
    .map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType }));
}

// The dependency bundle for lib/session-refs.js. Cheap to build — the catalog
// is only read once a prompt actually carries a `#ref` — so the routes can
// hand one over unconditionally.
function sessionRefDeps() {
  let catalog = null;
  return {
    selfHostId: hostIdentity.getHostId(),
    resolveLocal: (id, exactOnly) => {
      if (!catalog) catalog = buildSessionCatalog();
      return resolveRefInCatalog(catalog, id, exactOnly).session;
    },
    fleetNames: () => remoteHosts.listRemotes().map((remote) => remote.name),
  };
}

app.post('/api/sessions/:id/prompt', async (req, res) => {
  const { message, deliverAs } = req.body;
  const images = sanitizeImages(req.body.images);
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
    const opts = deliverAs ? { deliverAs } : {};
    if (images.length) opts.images = images;
    const result = await sess.prompt(expandSessionRefs(message, req.body.refs, sessionRefDeps()), opts);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/:id/steer', async (req, res) => {
  const { message } = req.body;
  const images = sanitizeImages(req.body.images);
  if (!message && !images.length) return res.status(400).json({ error: 'Message required' });
  try {
    const sess = await getLiveSession(req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session not active' });
    if (!liveSessionSupports(sess, 'steer')) return res.status(409).json({ error: 'This session does not support steering.' });
    const result = await sess.steer(
      expandSessionRefs(message, req.body.refs, sessionRefDeps()),
      images.length ? { images } : {});
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Explicit semantic follow-up endpoint for agents and other non-browser
// clients. The existing prompt route remains backward compatible.
app.post('/api/sessions/:id/follow-up', async (req, res) => {
  const { message } = req.body;
  const images = sanitizeImages(req.body.images);
  if (!message && !images.length) return res.status(400).json({ error: 'Message required' });
  try {
    const sess = await getLiveSession(req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session not active' });
    if (!liveSessionSupports(sess, 'followUp')) return res.status(409).json({ error: 'This session does not support follow-ups.' });
    const opts = { deliverAs: 'followUp' };
    if (images.length) opts.images = images;
    const result = await sess.prompt(expandSessionRefs(message, req.body.refs, sessionRefDeps()), opts);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove a not-yet-delivered queued steer/follow-up so its text can go back to
// the composer. Bridge-only (pi's queue arrays live inside the process); RPC
// sessions have no remote queue-editing path.
app.post('/api/sessions/:id/queue/cancel', async (req, res) => {
  const { kind, index, text } = req.body || {};
  const validationError = (kind !== 'steering' && kind !== 'followUp')
    || typeof text !== 'string' || !text
    ? 'kind (steering|followUp) and non-empty text required'
    : !Number.isInteger(index) || index < 0
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
    const result = await sess.cancelQueued(kind, index, text);
    res.json({ success: true, result });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

// Built-in commands pi-dish can execute on RPC-managed sessions by mapping
// them to RPC protocol commands.
const RPC_BUILTIN_COMMANDS = [
  { name: 'compact', description: 'Manually compact the session context', args: '[instructions]' },
  { name: 'model', description: 'Switch model (usage: /model provider/model-id)', args: '<model>' },
  { name: 'name', description: 'Set session display name', args: '<name>' },
  { name: 'thinking', description: 'Set thinking level', args: '<off|minimal|low|medium|high|xhigh>' },
  { name: 'abort', description: 'Abort the current agent operation' },
  { name: 'new', description: 'Start a new session' },
  { name: 'export', description: 'Export session to HTML', args: '[path]' },
  { name: 'reload', description: 'Reload extensions, skills, and prompt templates' },
];

async function runRpcSlashCommand(rpc, message) {
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
        const saved = result ? ` (${result.tokensBefore} → ~${result.estimatedTokensAfter} tokens)` : '';
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
      let { provider, id } = parseModelId(args);
      if (!provider) {
        const data = await rpc.getAvailableModels();
        const models = data?.models || [];
        const m = models.find(x => x.id === args) || models.find(x => x.id.includes(args));
        if (!m) throw new Error(`model not found: ${args}`);
        provider = m.provider; id = m.id;
      }
      await rpc.setModel(provider, id);
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
      return { info: `Exported to ${data?.path || 'HTML'}` };
    }
    default: {
      // Extension commands, skills, and prompt templates are handled natively
      // by RPC prompt. Verify the command exists first so typos (or TUI-only
      // built-ins) don't get sent to the model as literal text.
      const data = await rpc.getCommands().catch(() => null);
      const known = new Set((data?.commands || []).map(c => c.name));
      if (!known.has(name)) throw new Error(`unknown or unsupported command: /${name}`);
      await rpc.prompt(message);
      return {};
    }
  }
}

app.post('/api/sessions/:id/thinking', async (req, res) => {
  const { level } = req.body || {};
  // Cheap gate against the union of every harness's vocabulary; once the
  // session's harness is known the per-harness check below decides.
  if (!ALL_THINKING_LEVEL_NAMES.includes(level)) {
    return res.status(400).json({ error: `level must be one of: ${ALL_THINKING_LEVEL_NAMES.join(', ')}` });
  }
  try {
    const sess = await getLiveSession(req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session not active' });
    if (!liveSessionSupports(sess, 'setThinking')) {
      return res.status(409).json({ error: 'This session does not support changing thinking level.' });
    }
    const levels = thinkingLevelNamesFor(sess.harnessId || 'pi');
    if (!levels.includes(level)) {
      return res.status(400).json({ error: `level must be one of: ${levels.join(', ')}` });
    }
    const data = await sess.setThinkingLevel(level);
    res.json(thinkingResult(data, level));
  } catch (e) {
    res.status(500).json({ error: e.message });
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

// { path, url } for a token. url is set only when PI_DISH_SHARE_BASE_URL is,
// so operators behind a proxy can hand out an absolute link.
function sharePayload(token) {
  const sharePath = `/share/${token}`;
  return { token, path: sharePath, url: publicUrlFor(sharePath) };
}

// Per-token export cache keyed on the JSONL's (mtimeMs, size) and live export
// snapshot, so repeated hits on an unchanged session don't re-run the exporter.
const shareExportCache = new Map();

async function serveSharedSession(req, res) {
  const share = shares.getShare(req.params.token);
  // A token this host doesn't own may still belong to a peer it fronts.
  if (!share) return relayHandlers.publicArtifacts.serve(req, res, 'share');
  if (share.kind === 'html') {
    const htmlPath = shares.getShareHtmlPath(req.params.token);
    if (!htmlPath) return res.status(404).type('text/plain').send('Not found');
    res.type('html');
    return res.sendFile(htmlPath);
  }
  const session = findSessionSource(share.sessionId);
  if (!session || (session.harnessId !== 'pi' && session.harnessId !== 'omp')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  const sessionFile = session.file;
  try {
    const st = fs.statSync(sessionFile);
    const shareSnapshot = await getOmpShareSnapshot(session);
    const snapshotKey = shareSnapshot ? JSON.stringify(shareSnapshot) : null;
    const cached = shareExportCache.get(req.params.token);
    let htmlPath;
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size
      && cached.snapshotKey === snapshotKey && fs.existsSync(cached.htmlPath)) {
      htmlPath = cached.htmlPath;
    } else {
      // Token is base64url (A-Za-z0-9_-), so it's already a safe basename.
      const outPath = path.join(os.tmpdir(), `pi-dish-share-${req.params.token}.html`);
      htmlPath = await exportSessionHtml(session, outPath, { shareSnapshot, snapshotResolved: true });
      shareExportCache.set(req.params.token, { mtimeMs: st.mtimeMs, size: st.size, snapshotKey, htmlPath });
    }
    res.type('html');
    res.sendFile(htmlPath);
  } catch (e) {
    res.status(500).type('text/plain').send('Export failed');
  }
}

function validOmpShareHtml(html) {
  if (typeof html !== 'string' || !html.includes('<html')) return false;
  const match = html.match(/<script\b(?=[^>]*\bid=["']session-data["'])[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return false;
  try {
    const data = JSON.parse(Buffer.from(match[1].trim(), 'base64').toString('utf8'));
    return !!data?.header && Array.isArray(data.entries);
  } catch {
    return false;
  }
}

// OMP's supported custom-share hook gives us the complete native HTML that
// /share generated from the live session. Preserve that exact snapshot rather
// than trying to reconstruct OMP-only metadata from historical JSONL.
app.post('/api/shares/import', express.text({ type: 'text/html', limit: '20mb' }), (req, res) => {
  if (!validOmpShareHtml(req.body)) {
    return res.status(400).json({ error: 'Expected a standalone OMP HTML export' });
  }
  try {
    const token = shares.createHtmlShare(req.body);
    return res.json(sharePayload(token));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/:id/share', (req, res) => {
  const session = findSessionSource(req.params.id);
  if (!session) {
    if (liveSessionHistoryPending(req.params.id)) {
      return res.status(409).json({ error: 'Session has no persisted history yet' });
    }
    return res.status(404).json({ error: 'Session not found' });
  }
  if (session.harnessId !== 'pi' && session.harnessId !== 'omp') {
    return res.status(409).json({ error: 'Public HTML sharing is only supported for Pi and OMP sessions.' });
  }
  const token = shares.createShare(req.params.id);
  res.json(sharePayload(token));
});

app.delete('/api/sessions/:id/share', (req, res) => {
  const existing = shares.getShareForSession(req.params.id);
  const revoked = shares.revokeShare(req.params.id);
  if (existing) shareExportCache.delete(existing.token);
  // The token is reported so a hub fronting this session can drop its fleet
  // mapping immediately instead of waiting to serve a 404.
  res.json({ revoked, token: existing?.token || null });
});

app.get('/api/sessions/:id/share', (req, res) => {
  const existing = shares.getShareForSession(req.params.id);
  if (!existing) return res.status(404).json({ error: 'No share' });
  res.json(sharePayload(existing.token));
});

// Public route — always available on the main app (the share listener is opt-in).
app.get('/share/:token', serveSharedSession);

// =========================================================================
// Anchored comments (lib/comments.js)
// =========================================================================
//
// The browser creates comments from a selected file/prose range or diff
// lines. When the user later asks the agent to read comments, the
// pi-dish-comments skill lists the open index, fetches whichever related ids
// it needs, and acknowledges completed items. Creating a comment never
// prompts, steers, or starts an agent turn.

function shortString(value, max) {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function inferSessionForPath(absPath) {
  // Nested session cwds are normal here (a checkout under a workspace root
  // that another session sits in), so the most specific containing cwd wins.
  // Only a genuine tie — two sessions at the same depth, e.g. the same cwd —
  // is ambiguous enough to give up on.
  const candidates = listRegisteredSessions()
    .filter((entry) => {
      if (!entry.cwd) return false;
      const cwd = path.resolve(entry.cwd);
      return absPath === cwd || absPath.startsWith(cwd + path.sep);
    })
    .sort((a, b) => path.resolve(b.cwd).length - path.resolve(a.cwd).length);
  if (!candidates.length) return null;
  if (candidates[1] && path.resolve(candidates[1].cwd).length === path.resolve(candidates[0].cwd).length) return null;
  const identity = registryIdentity(candidates[0]);
  return identity ? routeSessionId(identity.harnessId, identity.nativeSessionId) : null;
}

function canonicalKnownSessionId(value) {
  const identity = routeIdentity(value);
  if (!identity) return null;
  const registered = listRegisteredSessions().some((entry) => {
    const candidate = registryIdentity(entry);
    return candidate?.harnessId === identity.harnessId
      && candidate.nativeSessionId === identity.nativeSessionId;
  });
  const rpc = identity.harnessId === 'pi' && getRPCSession(value)?.id === identity.nativeSessionId;
  const active = registered || rpc;
  const historical = !active && enumerateSessionCandidates().some((candidate) =>
    candidate.harnessId === identity.harnessId
      && candidate.nativeSessionId === identity.nativeSessionId);
  return active || historical
    ? routeSessionId(identity.harnessId, identity.nativeSessionId)
    : null;
}

function cleanAnchor(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'lines' ? 'lines' : raw.type === 'text' ? 'text' : null;
  if (!type) return null;
  const anchor = { type };
  for (const key of ['quote', 'prefix', 'suffix']) {
    const value = shortString(raw[key], key === 'quote' ? 12000 : 500);
    if (value != null) anchor[key] = value;
  }
  for (const key of ['startLine', 'endLine', 'oldStart', 'oldEnd', 'newStart', 'newEnd']) {
    if (Number.isInteger(raw[key]) && raw[key] >= 0) anchor[key] = raw[key];
  }
  return (anchor.quote || type === 'lines') ? anchor : null;
}

function cleanCommentTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const anchor = cleanAnchor(raw.anchor);
  if (!anchor) return null;
  if (raw.kind === 'file') {
    const filePath = shortString(raw.path, 4096);
    if (!filePath || !path.isAbsolute(filePath)) return null;
    return {
      kind: 'file', path: path.resolve(filePath),
      relPath: shortString(raw.relPath, 4096), anchor,
    };
  }
  if (raw.kind === 'diff') {
    const repo = shortString(raw.repo, 4096);
    const filePath = shortString(raw.path, 4096);
    if (!repo || !filePath) return null;
    return {
      kind: 'diff', repo, path: filePath,
      oldPath: shortString(raw.oldPath, 4096), anchor,
    };
  }
  if (raw.kind === 'page') {
    const pageToken = shortString(raw.pageToken, 256);
    const page = pageToken && pages.getPage(pageToken);
    if (!page || page.renderer === 'file') return null;
    return {
      kind: 'page', pageToken, root: page.root,
      title: page.title || null, anchor,
    };
  }
  return null;
}

app.use('/api/comments', relayHandlers.comments);

app.post('/api/comments', (req, res) => {
  const rawBody = req.body?.body;
  const body = typeof rawBody === 'string' ? shortString(rawBody.trim(), 10000) : null;
  const target = cleanCommentTarget(req.body?.target);
  if (!body) return res.status(400).json({ error: 'comment body required (max 10000 characters)' });
  if (!target) return res.status(400).json({ error: 'valid anchored target required' });

  let sessionId = shortString(req.body?.sessionId, 512);
  if (target.kind === 'page') {
    const page = pages.getPage(target.pageToken);
    sessionId = page?.sessionId || sessionId || inferSessionForPath(page.root);
  }
  sessionId = sessionId && canonicalKnownSessionId(sessionId);
  if (!sessionId) {
    return res.status(404).json({ error: 'target session not found' });
  }
  res.status(201).json(comments.createComment({ sessionId, body, target }));
});

function commentIndexEntry(comment) {
  const target = comment.target || {};
  const anchor = target.anchor || {};
  const indexedAnchor = { type: anchor.type };
  for (const key of ['startLine', 'endLine', 'oldStart', 'oldEnd', 'newStart', 'newEnd']) {
    if (Number.isInteger(anchor[key])) indexedAnchor[key] = anchor[key];
  }
  if (anchor.quote) indexedAnchor.quotePreview = anchor.quote.slice(0, 240);
  const indexedTarget = { kind: target.kind, anchor: indexedAnchor };
  for (const key of ['path', 'relPath', 'repo', 'oldPath', 'root', 'title', 'pageToken']) {
    if (target[key] != null) indexedTarget[key] = target[key];
  }
  return {
    id: comment.id,
    // The page overlay reads the index with only a page token in hand and
    // needs the session to fetch/edit/delete; /api is main-app only (the
    // public share listener never mounts it), which is the trust boundary.
    sessionId: comment.sessionId,
    createdAt: comment.createdAt,
    bodyPreview: comment.body.slice(0, 240),
    target: indexedTarget,
  };
}

// Lightweight, unpaginated inventory. It gives the agent enough location
// and intent to infer useful groups without loading every full anchor/body.
// Reading this index changes no comment state.
app.get('/api/comments/index', (req, res) => {
  const sessionId = shortString(req.query.sessionId, 512);
  // A published page knows its own token but not the session behind it, so
  // the overlay scopes the index that way instead.
  const pageToken = shortString(req.query.pageToken, 256);
  if (!sessionId && !pageToken) {
    return res.status(400).json({ error: 'sessionId or pageToken required' });
  }
  const open = comments.listComments({ sessionId, pageToken, state: 'open' });
  res.json({ comments: open.map(commentIndexEntry), total: open.length });
});

app.get('/api/comments/count', (req, res) => {
  const sessionId = shortString(req.query.sessionId, 512);
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  res.json({ total: comments.listComments({ sessionId, state: 'open' }).length });
});

// Fetch an agent-selected group from the inventory. This is a state-free
// read; acknowledgment remains a separate, explicit close operation.
app.post('/api/comments/get', (req, res) => {
  const sessionId = shortString(req.body?.sessionId, 512);
  const rawIds = req.body?.ids;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  if (!Array.isArray(rawIds) || !rawIds.length || rawIds.length > 200
      || rawIds.some((id) => typeof id !== 'string' || !id || id.length > 256)) {
    return res.status(400).json({ error: 'ids must contain 1-200 comment ids' });
  }
  const ids = [...new Set(rawIds)];
  const openById = new Map(comments.listComments({ sessionId, state: 'open' })
    .map((comment) => [comment.id, comment]));
  const selected = ids.map((id) => openById.get(id)).filter(Boolean);
  const missing = ids.filter((id) => !openById.has(id));
  res.json({ comments: selected, missing, total: selected.length, hasMore: false });
});

// Editing/deleting is the user's own correction path from the views the
// comment was written in. Acknowledged comments are the agent's record and
// stay immutable — a late edit would silently change what was acted on.
function resolveOpenComment(req, res) {
  const existing = comments.getComment(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'comment not found' });
    return null;
  }
  let requestedSessionId = null;
  try { requestedSessionId = canonicalSessionId(req.body?.sessionId); } catch {}
  if (!requestedSessionId || requestedSessionId !== existing.sessionId) {
    res.status(403).json({ error: 'comment belongs to a different session' });
    return null;
  }
  if (existing.acknowledgedAt) {
    res.status(409).json({ error: 'comment already acknowledged' });
    return null;
  }
  return existing;
}

app.patch('/api/comments/:id', (req, res) => {
  if (!resolveOpenComment(req, res)) return;
  const rawBody = req.body?.body;
  const body = typeof rawBody === 'string' ? shortString(rawBody.trim(), 10000) : null;
  if (!body) return res.status(400).json({ error: 'comment body required (max 10000 characters)' });
  const comment = comments.updateComment(req.params.id, body);
  if (!comment) return res.status(409).json({ error: 'comment already acknowledged' });
  res.json(comment);
});

app.delete('/api/comments/:id', (req, res) => {
  if (!resolveOpenComment(req, res)) return;
  if (!comments.deleteComment(req.params.id)) {
    return res.status(409).json({ error: 'comment already acknowledged' });
  }
  res.json({ ok: true });
});

app.post('/api/comments/:id/ack', (req, res) => {
  const existing = comments.getComment(req.params.id);
  if (!existing) return res.status(404).json({ error: 'comment not found' });
  let requestedSessionId = null;
  try { requestedSessionId = canonicalSessionId(req.body?.sessionId); } catch {}
  if (!requestedSessionId || requestedSessionId !== existing.sessionId) {
    return res.status(403).json({ error: 'comment belongs to a different session' });
  }
  const comment = comments.acknowledgeComment(req.params.id);
  res.json(comment);
});

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

function pagePayload(token, entry) {
  const pagePath = `/page/${token}`;
  const base = process.env.PI_DISH_SHARE_BASE_URL;
  return {
    token,
    path: pagePath,
    url: base ? base.replace(/\/+$/, '') + pagePath : null,
    root: entry.root,
    title: entry.title || null,
    sessionId: entry.sessionId || null,
    renderer: entry.renderer || null,
    createdAt: entry.createdAt,
  };
}

// Deliberately no path gate on registration: sharing governance rests with
// the main app, which is assumed reachable only by trusted people (same
// trust model as the rest of the API — anything on this port can already
// drive agents with shell access, so a "no paths outside the workspace"
// rule would only be theater: an agent can copy any file into its cwd).
// The public share listener never registers, only serves known tokens.
app.post('/api/pages', (req, res) => {
  const { path: rawPath, title, sessionId, renderer } = req.body || {};
  const hasSessionId = Object.prototype.hasOwnProperty.call(req.body || {}, 'sessionId');
  if (typeof rawPath !== 'string' || !rawPath) {
    return res.status(400).json({ error: 'path required' });
  }
  if (renderer != null && renderer !== 'file') {
    return res.status(400).json({ error: 'renderer must be "file" when provided' });
  }
  if (!path.isAbsolute(rawPath)) {
    return res.status(400).json({ error: 'path must be absolute' });
  }
  const root = path.resolve(rawPath);
  let stat;
  try { stat = fs.statSync(root); } catch {
    return res.status(404).json({ error: `No such file: ${root}` });
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    return res.status(400).json({ error: 'path must be a file or directory' });
  }
  if (renderer === 'file' && !stat.isFile()) {
    return res.status(400).json({ error: 'the file renderer requires a file' });
  }
  if (stat.isDirectory() && !fs.existsSync(path.join(root, 'index.html'))) {
    return res.status(400).json({ error: 'directory pages need an index.html' });
  }
  let associatedSessionId;
  if (hasSessionId) {
    associatedSessionId = shortString(sessionId, 512);
    if (!associatedSessionId) {
      return res.status(400).json({ error: 'sessionId must be a non-empty string (max 512 characters)' });
    }
    associatedSessionId = canonicalKnownSessionId(associatedSessionId);
    if (!associatedSessionId) {
      return res.status(404).json({ error: 'sessionId does not identify a known active or historical session' });
    }
  } else {
    associatedSessionId = inferSessionForPath(root);
  }
  const token = pages.createPage({
    root,
    title: title || null,
    sessionId: associatedSessionId || null,
    renderer: renderer || null,
  });
  res.json(pagePayload(token, pages.getPage(token)));
});

app.get('/api/pages', (req, res) => {
  let list = pages.listPages();
  let filterSessionId = null;
  try { filterSessionId = req.query.sessionId && canonicalSessionId(req.query.sessionId); } catch {}
  if (req.query.sessionId) list = list.filter((p) => p.sessionId === filterSessionId);
  res.json(list.map(({ token, ...entry }) => ({
    ...pagePayload(token, entry),
    missing: !fs.existsSync(entry.root),
  })));
});

app.delete('/api/pages/:token', (req, res) => {
  res.json({ revoked: pages.revokePage(req.params.token) });
});

// The public serving routes. File roots serve the file itself; directory
// roots serve index.html at /page/:token/ (the bare token URL redirects so
// the document's relative asset URLs resolve under the token) and contained
// assets at /page/:token/<rel>. res.sendFile rejects `..` traversal and
// absolute rests via its root option — every failure is a bare 404.
function sendPageFile(file, req, res, annotate) {
  if (!annotate || path.extname(file).toLowerCase() !== '.html') {
    return res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(404).type('text/plain').send('Not found');
    });
  }
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) return res.status(404).type('text/plain').send('Not found');
    const tag = `<script src="/artifact-comments.js" data-page-token="${req.params.token}"></script>`;
    const at = html.toLowerCase().lastIndexOf('</body>');
    const annotated = at >= 0 ? html.slice(0, at) + tag + html.slice(at) : html + tag;
    res.type('html').send(annotated);
  });
}

function sendRenderedFilePage(entry, req, res, notFound) {
  let file;
  try { file = readFileForViewer(entry.root, { imageData: false }); } catch { return notFound(); }
  if (file.error) {
    return res.status(file.status || 415).type('text/plain').send('File cannot be previewed');
  }
  if (req.query.content != null) {
    if (!file.image) return notFound();
    const safeMime = file.image.mimeType !== 'image/svg+xml'
      ? file.image.mimeType : 'text/plain; charset=utf-8';
    res.setHeader('Cache-Control', 'public, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.type(safeMime).sendFile(entry.root, (err) => { if (err) notFound(); });
  }
  res.setHeader('Cache-Control', 'public, no-cache');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self' http: https:; base-uri 'none'; form-action 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type('html').send(renderFilePage({
    token: req.params.token,
    root: entry.root,
    title: entry.title,
    file,
  }));
}

function servePage(req, res, annotate = false) {
  const entry = pages.getPage(req.params.token);
  // A token this host doesn't own may still belong to a peer it fronts; the
  // peer answers the redirect and injects its own comment overlay — except
  // on the public listener, which asks the peer to leave it out (below).
  if (!entry) return relayHandlers.publicArtifacts.serve(req, res, 'page', { annotate });
  if (req.headers[PAGE_COMMENTS_HEADER] === 'off') annotate = false;
  const notFound = () => { if (!res.headersSent) res.status(404).type('text/plain').send('Not found'); };
  let stat;
  try { stat = fs.statSync(entry.root); } catch { return notFound(); }
  // Non-strict routing sends /page/:token/ to the bare route too — read the
  // trailing slash off the real path or the redirect below would loop.
  const rest = req.params[0] || (req.path.endsWith('/') ? '/' : '');

  if (stat.isFile()) {
    if (rest) return notFound(); // a file page has no sub-paths
    if (entry.renderer === 'file') return sendRenderedFilePage(entry, req, res, notFound);
    return sendPageFile(entry.root, req, res, annotate);
  }
  if (!rest) return res.redirect(302, `/page/${req.params.token}/`);
  const rel = rest === '/' ? 'index.html' : rest.replace(/^\//, '');
  if (rel === 'index.html' && annotate) {
    return sendPageFile(path.join(entry.root, rel), req, res, true);
  }
  res.sendFile(rel, { root: entry.root }, (err) => { if (err) notFound(); });
}

app.get('/page/:token', (req, res) => servePage(req, res, true));
app.get('/page/:token/*', (req, res) => {
  // Normalize express 4's wildcard into the shape servePage expects: the
  // rest including its leading slash ('/' for the bare trailing-slash URL).
  req.params[0] = '/' + (req.params[0] || '');
  servePage(req, res, true);
});

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
async function reloadBridgeSession(sess, sessionId) {
  let bridgeError = null;
  if (liveSessionSupports(sess, 'reload')) {
    try {
      const data = await sess.runCommand('/reload');
      return { info: data?.info || 'Reloading extensions…' };
    } catch (e) {
      if (/socket closed/i.test(e?.message || '')) return { info: 'Reloading extensions…' };
      bridgeError = e;
    }
  }
  bridgeError ||= new Error('This session does not support remote extension reload.');
  if (sess.harnessId !== 'pi' && sess.harnessId !== 'omp') {
    bridgeError.statusCode = 409;
    throw bridgeError;
  }
  const pane = await locatePiPane(sessionId);
  if (!pane) {
    bridgeError.statusCode = 409;
    if (sess.harnessId === 'omp') {
      bridgeError.message = 'Oh My Pi extension reload requires a reachable tmux pane.';
    }
    throw bridgeError;
  }
  const paneCommand = sess.harnessId === 'omp' ? '/dish-reload' : '/reload';
  await tmux.sendKeys(pane.socket, pane.paneId, paneCommand);
  return { info: 'Sent /reload to the session’s tmux pane' };
}

function parseHostBuiltin(descriptor, message) {
  if (!descriptor?.hostBuiltins?.length) return null;
  const trimmed = message.trim();
  const separator = trimmed.search(/\s/);
  const name = trimmed.slice(1, separator === -1 ? undefined : separator);
  const command = descriptor.hostBuiltins.find(candidate => candidate.name === name);
  if (!command) return null;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    const error = new Error(`Invalid arguments for /${name}.`);
    error.statusCode = 400;
    throw error;
  }
  const args = separator === -1 ? '' : trimmed.slice(separator).trim();
  if (!args && command.requireArgs) {
    const error = new Error(`/${name} requires arguments${command.args ? `; expected ${command.args}` : ''}.`);
    error.statusCode = 400;
    throw error;
  }
  // Blocked sub-forms are checked before free args are accepted: they are the
  // spellings that open a TUI overlay, which a remote pilot cannot answer. A
  // bare string blocks the sub-command and everything under it; `exact` blocks
  // only the argument-less form, whose arg'd spelling completes in place.
  const blockedEntry = command.blockedArgs?.find((entry) => {
    const value = typeof entry === 'string' ? entry : entry.arg;
    return args === value || (!entry.exact && args.startsWith(`${value} `));
  });
  if (blockedEntry) {
    const blocked = typeof blockedEntry === 'string' ? blockedEntry : blockedEntry.arg;
    const error = new Error(`/${name} ${blocked} is only available in the ${descriptor.label} terminal UI.`);
    error.statusCode = 400;
    throw error;
  }
  if (args && !command.freeArgs && !command.allowedArgs?.includes(args)) {
    const allowed = command.allowedArgs?.join(' or ');
    const error = new Error(`Invalid arguments for /${name}${allowed ? `; expected ${allowed}` : ''}.`);
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
async function hostBuiltinPane(sessionId, descriptor) {
  if (!descriptor?.hostBuiltins?.length) return null;
  return locatePiPane(sessionId);
}

async function runHostBuiltin(sessionId, descriptor, parsed) {
  const pane = await hostBuiltinPane(sessionId, descriptor);
  if (!pane) {
    const error = new Error(`Host command /${parsed.command.name} requires a reachable ${descriptor.label} tmux pane.`);
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
app.post('/api/sessions/:id/command', async (req, res) => {
  const { message, deliverAs } = req.body;
  if (!message || !message.startsWith('/')) {
    return res.status(400).json({ error: 'message must start with /' });
  }
  try {
    const sess = await getLiveSession(req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session not active' });
    if (sess instanceof BridgeSession) {
      const descriptor = getHarness(sess.harnessId);
      const hostBuiltin = parseHostBuiltin(descriptor, message);
      if (hostBuiltin) {
        const result = await runHostBuiltin(req.params.id, descriptor, hostBuiltin);
        return res.json({ success: true, info: result.info });
      }
      const compactMatch = message.match(/^\/compact(?:\s+(.*))?\s*$/);
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
          return res.json({ success: true, info: data?.info });
        } catch (error) {
          sess.compacting = false;
          throw error;
        }
      }
      // /btw awaits the ephemeral side turn inside the bridge call (unlike
      // /compact's fire-and-forget), so it rides run_command with a
      // prompt-scale timeout and returns the answer for the client to panel.
      const btwMatch = message.match(/^\/btw(?:\s+([\s\S]*))?\s*$/);
      if (btwMatch) {
        if (!liveSessionSupports(sess, 'btw')) {
          return res.status(409).json({ error: 'This session does not support /btw.' });
        }
        if (!btwMatch[1]?.trim()) {
          return res.status(400).json({ error: 'usage: /btw <question>' });
        }
        const data = await sess.runCommand(message, undefined, { timeout: 180000 });
        return res.json({ success: true, info: data?.info, answer: data?.answer });
      }
      if (!liveSessionSupports(sess, 'commands')) {
        return res.status(409).json({ error: 'This session does not support remote commands.' });
      }
      if (message.trim() === '/reload') {
        const result = await reloadBridgeSession(sess, req.params.id);
        return res.json({ success: true, info: result.info });
      }
      const data = await sess.runCommand(message, deliverAs);
      return res.json({ success: true, info: data?.info });
    }
    const result = await runRpcSlashCommand(sess, message);
    res.json({ success: true, info: result.info });
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message });
  }
});

// Answer an extension UI dialog (select/confirm/input/editor).
app.post('/api/sessions/:id/ui-response', async (req, res) => {
  const { requestId, value, confirmed, cancelled } = req.body || {};
  if (!requestId) return res.status(400).json({ error: 'requestId required' });
  const response = {};
  if (value !== undefined) response.value = value;
  if (confirmed !== undefined) response.confirmed = confirmed;
  if (cancelled !== undefined) response.cancelled = cancelled;
  try {
    const sess = await getLiveSession(req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session not active' });
    if (!liveSessionSupports(sess, 'extensionUI')) {
      return res.status(409).json({ error: 'This session does not support remote extension UI.' });
    }
    await sess.respondExtensionUI(requestId, response);
    // RPC sessions never emit extension_ui_resolved (the bridge does), so
    // drop the answered dialog from the replay state here.
    sess.extUIState?.dialogs.delete(requestId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/:id/rename', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const sess = await getLiveSession(req.params.id);
    if (sess) {
      if (!liveSessionSupports(sess, 'rename')) {
        return res.status(409).json({ error: 'This session does not support renaming.' });
      }
      await sess.setName(name);
      const reg = getRegisteredSession(req.params.id);
      const spawn = tmux.getSpawn(req.params.id);
      const socket = reg?.tmux?.socket || spawn?.socket;
      const pane = reg?.tmux?.pane || spawn?.paneId;
      if (socket && pane) {
        await tmux.renameWindow(socket, pane, name).catch(() => {});
      }
      return res.json({ success: true });
    }
    const session = findSessionSource(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.harnessId !== 'pi') {
      return res.status(409).json({ error: 'Renaming an inactive session is only supported for Pi.' });
    }
    await piSDK.renameSession(session.file, name);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/:id/model', async (req, res) => {
  const modelId = req.body?.modelId || req.body?.model;
  if (!modelId) return res.status(400).json({ error: 'modelId or model required' });
  const { provider, id } = parseModelId(modelId);
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
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sessions/:id/tree', sessionReadHandlers.tree);

// Bridge navigate_tree needs a stashed pi command context (the only
// extension-API surface carrying ctx.navigateTree). RPC-backed sessions can
// acquire one remotely: an RPC prompt of "/dish-prime" goes through pi's
// command executor, which hands the bridge a command context to stash — so
// on "no command context", prime and retry once. TUI-only sessions have no
// remote path; the route surfaces the /dish-push hint instead.
async function navigateLiveTree(sessionId, sess, entryId, opts) {
  try {
    return await sess.navigateTree(entryId, opts);
  } catch (e) {
    if (!/no command context/i.test(e.message || '')) throw e;
    // RPC-backed sessions prime remotely via pi's command executor.
    const rpc = getRPCSession(sessionId);
    if (rpc?.alive) {
      await rpc.prompt('/dish-prime');
      return sess.navigateTree(entryId, opts);
    }
    // tmux-spawned TUI sessions have a pane we can type into: send /dish-prime
    // through send-keys, give the command a moment to run, and retry once.
    const spawn = tmux.getSpawn(sessionId);
    if (spawn && await tmux.paneExists(spawn.socket, spawn.paneId)) {
      await tmux.sendKeys(spawn.socket, spawn.paneId, '/dish-prime');
      await new Promise((r) => setTimeout(r, 1500));
      return sess.navigateTree(entryId, opts);
    }
    throw e;
  }
}

// The tmux key chord a bridge advertises for its tree service, translated to
// a tmux send-keys key name. Only F-keys are accepted: they are inert in a
// TUI and, unlike a name tmux fails to resolve, can never be delivered as
// literal text into the session's composer.
const TMUX_CHORD_MODIFIERS = { ctrl: 'C-', alt: 'M-', shift: 'S-' };
function tmuxKeyForChord(chord) {
  if (typeof chord !== 'string' || !chord) return null;
  const parts = chord.toLowerCase().split('+');
  const base = parts.pop();
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
async function navigateLiveOmpTree(sessionId, sess, entryId, opts) {
  const pane = await locatePiPane(sessionId);
  if (!pane) {
    const error = new Error('Oh My Pi tree navigation requires a reachable tmux pane to acquire its command context.');
    error.statusCode = 409;
    throw error;
  }
  const chordKey = tmuxKeyForChord(getRegisteredSession(sessionId)?.treeServiceShortcut);
  const operation = sess.treeNavigate(entryId, opts);
  // Either promise may reject while the other is being awaited below; both
  // are settled here so a losing rejection is never unhandled.
  operation.catch(() => {});
  const handoff = new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      sess.off('tree_operation_queued', onQueued);
    };
    const onQueued = (data) => {
      if (data?.requestId !== operation.requestId) return;
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
  )).catch((cause) => {
    const error = new Error(`Oh My Pi tree navigation could not acquire its command context: ${cause.message}`);
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
app.post('/api/sessions/:id/branch', async (req, res) => {
  const { entryId, summarize, customInstructions } = req.body;
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
        return res.json({ success: true, editorText: data?.editorText });
      } catch (e) {
        if (/unknown command/i.test(e.message || '')) {
          return res.status(409).json({ error: 'The pi session is running an older pi-dish-bridge — run /reload in it (or restart it) to enable tree navigation.' });
        }
        if (/no command context/i.test(e.message || '')) {
          // The bridge self-primes through its captured AgentSession, so this
          // is now the rare case where no capture exists (no prompt or
          // subscribe since the bridge loaded) and no prime path reached it.
          return res.status(409).json({ error: "pi hands out session control only inside command handlers and this session couldn't be primed remotely — send any prompt to it (or run /dish-push once in its TUI), then retry." });
        }
        // Refusals about live session state are the caller's to act on
        // (wait for the turn, or abort it) — not server faults.
        if (/turn is in progress|compaction is in progress|entry not found/i.test(e.message || '')) {
          return res.status(409).json({ error: e.message });
        }
        if (identity.harnessId === 'omp' && /timed out/i.test(e.message || '')) {
          return res.status(504).json({ error: e.message });
        }
        if (identity.harnessId === 'omp' && /cancelled|unavailable|command context/i.test(e.message || '')) {
          return res.status(409).json({ error: e.message });
        }
        throw e;
      }
    }
    if (!source) return res.status(404).json({ error: 'Session not found' });
    if (identity.harnessId === 'omp') {
      return res.status(409).json({ error: 'Navigating the tree of an inactive Oh My Pi session is not supported.' });
    }
    const result = await piSDK.branchSession(source.file, entryId, opts);
    res.json({ success: true, editorText: result.editorText });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let modelsCache = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 60000;
const harnessModelsCache = new Map(); // resolved harness+cwd -> { models?, time?, inFlight? }
const HARNESS_JSON_EXIT_GRACE_MS = 250;

function setModelsCache(models) {
  modelsCache = models;
  modelsCacheTime = Date.now();
  contextWindowMemo.clear(); // windows may differ under the fresh registry
}

// pi's scoped models (/scoped-models in the TUI) persist as enabledModels
// patterns in ~/.pi/agent/settings.json. Read fresh per request — the TUI
// may rewrite the file at any time.
function readPiSettings() {
  try { return JSON.parse(fs.readFileSync(PI_SETTINGS_FILE, 'utf-8')); } catch { return {}; }
}

function getEnabledModelPatterns() {
  const patterns = readPiSettings().enabledModels;
  return Array.isArray(patterns) && patterns.length ? patterns : null;
}

// Annotate at response time (not in the cache) so a settings change made by
// the TUI or by PUT /api/models/enabled shows up on the next fetch.
function annotateEnabled(models) {
  const patterns = getEnabledModelPatterns();
  return models.map(m => ({ ...m, enabled: isModelEnabled(patterns, m) }));
}


function harnessCommandAvailable(descriptor) {
  const spec = harnessLaunchSpec(descriptor);
  const command = spec.argv[0];
  if (!command) return false;
  const environment = { ...process.env, ...spec.env };
  const executable = (file) => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } };
  if (command.includes(path.sep)) return executable(path.resolve(command));
  return String(environment.PATH || '').split(path.delimiter)
    .some(dir => dir && executable(path.join(dir, command)));
}

function resolveHarnessCwd(value) {
  const home = process.env.HOME || os.homedir();
  if (typeof value !== 'string' || !value.trim()) return process.cwd();
  const trimmed = value.trim();
  const expanded = trimmed === '~' ? home
    : trimmed.startsWith('~/') ? path.join(home, trimmed.slice(2)) : trimmed;
  return path.resolve(expanded);
}

function runHarnessJsonCommand(descriptor, commandArgs, { cwd, acceptCompleteJson = false } = {}) {
  const spec = harnessLaunchSpec(descriptor);
  const args = [...spec.argv.slice(1), ...commandArgs];
  return new Promise((resolve, reject) => {
    let settled = false;
    let completeJsonTimer = null;
    let streamedStdout = '';
    let child;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(completeJsonTimer);
      callback(value);
    };
    const acceptStreamedJson = () => {
      if (!acceptCompleteJson || completeJsonTimer || !/[\r\n]\s*$/.test(streamedStdout)) return;
      let parsed;
      try { parsed = JSON.parse(streamedStdout.trim()); } catch { return; }
      // OMP has already emitted the complete machine-readable response at
      // this point. Give normal shutdown a short grace period, then stop a
      // CLI whose extensions left the event loop alive instead of making the
      // web pilot wait for the full process timeout.
      completeJsonTimer = setTimeout(() => {
        settle(resolve, parsed);
        child.kill();
      }, HARNESS_JSON_EXIT_GRACE_MS);
    };
    child = execFile(spec.argv[0], args, {
      env: { ...process.env, ...spec.env },
      cwd: resolveHarnessCwd(cwd),
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (settled) return;
      if (error) return settle(reject, new Error((stderr || error.message).trim()));
      try {
        settle(resolve, JSON.parse(stdout.trim() || '{}'));
      } catch (parseError) {
        settle(reject, new Error(`Could not parse ${descriptor.label} command output: ${parseError.message}`));
      }
    });
    if (acceptCompleteJson) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (streamedStdout.length <= 10 * 1024 * 1024) streamedStdout += chunk;
        acceptStreamedJson();
      });
    }
  });
}

async function runHarnessModelCommand(descriptor, { cwd } = {}) {
  const cacheKey = `${descriptor.id}\0${resolveHarnessCwd(cwd)}`;
  const cached = harnessModelsCache.get(cacheKey);
  if (cached && Object.hasOwn(cached, 'models')
      && Date.now() - cached.time < MODELS_CACHE_TTL) return cached.models;
  if (cached?.inFlight) return cached.inFlight;

  const entry = cached || {};
  entry.inFlight = runHarnessJsonCommand(
    descriptor, descriptor.argv.models, { cwd, acceptCompleteJson: true },
  ).then(parsed => {
    entry.models = normalizeModels(parsed.models || parsed);
    entry.time = Date.now();
    return entry.models;
  }).finally(() => { delete entry.inFlight; });
  harnessModelsCache.set(cacheKey, entry);
  return entry.inFlight;
}


const MODEL_ROLE_KEY = /^[a-zA-Z][\w.-]{0,63}$/;
const MODEL_ROLE_VALUE_MAX = 200;
const AGENT_NAME_KEY = /^[A-Za-z0-9][\w.-]{0,63}$/;

function sanitizeModelRoles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, model]) => typeof model === 'string' && model.trim()));
}

// `config get <key>` returns the merged project-over-global view for the cwd,
// while `config set <key>` rewrites the whole value in the *global* config —
// so a read(merged) → edit → set() round trip would silently copy a project's
// `.omp/config.yml` overrides into the global config. An empty temp dir has no
// project config to overlay, so reading there yields global alone.
async function readGlobalConfigValues(descriptor, keys) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-global-'));
  try {
    const values = await Promise.all(keys.map(key => runHarnessJsonCommand(
      descriptor, descriptor.argv.configGet(key), { cwd: dir })));
    return values.map(result => result?.value);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function readGlobalModelRoles(descriptor) {
  const [value] = await readGlobalConfigValues(descriptor, [descriptor.pilotConfig.modelRoles]);
  return sanitizeModelRoles(value);
}

async function readHarnessPilotConfig(descriptor, cwd) {
  const keys = descriptor.pilotConfig;
  if (!keys || typeof descriptor.argv.configGet !== 'function') return null;
  const [rolesResult, thinkingResult, globalModelRoles] = await Promise.all([
    runHarnessJsonCommand(descriptor, descriptor.argv.configGet(keys.modelRoles), { cwd }),
    runHarnessJsonCommand(descriptor, descriptor.argv.configGet(keys.defaultThinkingLevel), { cwd }),
    readGlobalModelRoles(descriptor),
  ]);
  const modelRoles = sanitizeModelRoles(rolesResult?.value);
  const defaultModel = typeof modelRoles.default === 'string' ? modelRoles.default : null;
  const defaultThinkingLevel = typeof thinkingResult?.value === 'string'
    ? thinkingResult.value : null;
  return { defaultModel, defaultThinkingLevel, modelRoles, globalModelRoles };
}

// --- Task-agent settings (OMP's /agents hub: one array + three records) ---

const AGENT_SETTING_KEYS = ['disabledAgents', 'agentModelOverrides', 'agentPrewalk', 'agentAdvisor'];

function agentSettingsSupported(descriptor) {
  const keys = descriptor.pilotConfig;
  return !!(keys && descriptor.taskAgents && AGENT_SETTING_KEYS.every(key => keys[key]));
}

function sanitizeNameList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(name => typeof name === 'string' && AGENT_NAME_KEY.test(name)))];
}

// OMP stores these per-agent toggles as `record`s and stringifies booleans it
// has normalized once ("on"/"off"), so a read sees either form; both collapse
// to a boolean for the wire, and writes go back out as booleans (which the
// harness accepts and normalizes itself).
function sanitizeFlagRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const flags = {};
  for (const [name, flag] of Object.entries(value)) {
    if (!AGENT_NAME_KEY.test(name)) continue;
    if (typeof flag === 'boolean') flags[name] = flag;
    else if (flag === 'on' || flag === 'true') flags[name] = true;
    else if (flag === 'off' || flag === 'false') flags[name] = false;
  }
  return flags;
}

function shapeAgentSettings([disabled, modelOverrides, prewalk, advisor]) {
  return {
    disabled: sanitizeNameList(disabled),
    modelOverrides: sanitizeModelRoles(modelOverrides),
    prewalk: sanitizeFlagRecord(prewalk),
    advisor: sanitizeFlagRecord(advisor),
  };
}

function agentSettingKeyList(descriptor) {
  return AGENT_SETTING_KEYS.map(key => descriptor.pilotConfig[key]);
}

// Effective (project-over-global, for `cwd`) and global-only settings, the
// same split the model-role editor uses: rows edit global, and a differing
// effective value is a project override the harness wins with in that cwd.
async function readAgentSettings(descriptor, cwd) {
  const keys = agentSettingKeyList(descriptor);
  const [effective, global] = await Promise.all([
    Promise.all(keys.map(key => runHarnessJsonCommand(
      descriptor, descriptor.argv.configGet(key), { cwd }).then(result => result?.value))),
    readGlobalConfigValues(descriptor, keys),
  ]);
  return { settings: shapeAgentSettings(effective), globalSettings: shapeAgentSettings(global) };
}

// Every config write here is a read-modify-write of one whole value, so two
// concurrent PUTs would drop one another's patch. One chain per harness.
const harnessConfigWrites = new Map();
function queueHarnessConfigWrite(harnessId, task) {
  // The stored link is always failure-swallowed, so one failed write can't
  // reject every queued one behind it.
  const chained = (harnessConfigWrites.get(harnessId) || Promise.resolve()).then(() => task());
  harnessConfigWrites.set(harnessId, chained.catch(() => {}));
  return chained;
}

app.get('/api/harnesses', (_req, res) => {
  res.json({
    harnesses: listHarnesses().map(descriptor => ({
      id: descriptor.id,
      label: descriptor.label,
      available: harnessCommandAvailable(descriptor),
      rpcFallback: descriptor.rpcFallback,
      closeMode: descriptor.closeMode,
      // Does this harness have a settings view at all: pilot defaults plus
      // model roles, and (OMP only so far) the task-agent hub.
      pilotConfig: !!descriptor.pilotConfig,
      taskAgents: agentSettingsSupported(descriptor),
    })),
  });
});


app.get('/api/harnesses/:id/config', async (req, res) => {
  const descriptor = getHarness(req.params.id);
  if (!descriptor) return res.status(404).json({ error: 'Unknown harness' });
  if (!descriptor.pilotConfig) {
    return res.status(501).json({ error: `Pilot config is not supported for ${descriptor.label}.` });
  }
  if (req.query.cwd !== undefined && typeof req.query.cwd !== 'string') {
    return res.status(400).json({ error: 'cwd must be a string' });
  }
  try {
    res.json(await readHarnessPilotConfig(descriptor, req.query.cwd));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Patch role → model assignments in the harness's *global* config. Values are
// stored verbatim: the harness resolves model refs itself, and a rewrite here
// would only invent a second dialect.
app.put('/api/harnesses/:id/model-roles', async (req, res) => {
  const descriptor = getHarness(req.params.id);
  if (!descriptor) return res.status(404).json({ error: 'Unknown harness' });
  if (!descriptor.pilotConfig || typeof descriptor.argv.configSet !== 'function') {
    return res.status(501).json({ error: `Model roles are not editable for ${descriptor.label}.` });
  }
  const { roles, cwd } = req.body || {};
  if (cwd !== undefined && typeof cwd !== 'string') {
    return res.status(400).json({ error: 'cwd must be a string' });
  }
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
    return res.status(400).json({ error: 'roles must be an object mapping role names to model refs' });
  }
  const patch = Object.entries(roles);
  if (!patch.length) return res.status(400).json({ error: 'roles must name at least one role' });
  for (const [role, model] of patch) {
    if (!MODEL_ROLE_KEY.test(role)) {
      return res.status(400).json({ error: `Invalid role name: ${role}` });
    }
    if (model === null) continue;
    if (typeof model !== 'string' || !model.trim() || model.length > MODEL_ROLE_VALUE_MAX) {
      return res.status(400).json({ error: `Invalid model for role ${role}: expected null or a non-empty model ref of at most ${MODEL_ROLE_VALUE_MAX} characters` });
    }
  }
  try {
    res.json(await queueHarnessConfigWrite(descriptor.id, async () => {
      const record = await readGlobalModelRoles(descriptor);
      for (const [role, model] of patch) {
        if (model === null) delete record[role]; else record[role] = model;
      }
      await runHarnessJsonCommand(descriptor,
        descriptor.argv.configSet(descriptor.pilotConfig.modelRoles, JSON.stringify(record)));
      const [globalModelRoles, effective] = await Promise.all([
        readGlobalModelRoles(descriptor),
        runHarnessJsonCommand(descriptor, descriptor.argv.configGet(descriptor.pilotConfig.modelRoles), { cwd }),
      ]);
      return { globalModelRoles, modelRoles: sanitizeModelRoles(effective?.value) };
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Task-agent inventory (bundled + user + project definitions) with the
// per-agent settings the harness's own agents hub edits.
app.get('/api/harnesses/:id/agents', async (req, res) => {
  const descriptor = getHarness(req.params.id);
  if (!descriptor) return res.status(404).json({ error: 'Unknown harness' });
  if (!agentSettingsSupported(descriptor)) {
    return res.status(501).json({ error: `Task agents are not configurable for ${descriptor.label}.` });
  }
  const cwd = req.query.cwd;
  if (cwd !== undefined && typeof cwd !== 'string') {
    return res.status(400).json({ error: 'cwd must be a string' });
  }
  try {
    const [agents, settings] = await Promise.all([
      listTaskAgents(descriptor, runHarnessJsonCommand, { cwd }),
      readAgentSettings(descriptor, cwd),
    ]);
    res.json({ agents, ...settings, cwd: cwd || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Patch per-agent settings in the harness's *global* config. Each field is
// tri-state: `disabled` toggles array membership, and `model`/`prewalk`/
// `advisor` take a value or null to drop the override and inherit again.
app.put('/api/harnesses/:id/agents', async (req, res) => {
  const descriptor = getHarness(req.params.id);
  if (!descriptor) return res.status(404).json({ error: 'Unknown harness' });
  if (!agentSettingsSupported(descriptor) || typeof descriptor.argv.configSet !== 'function') {
    return res.status(501).json({ error: `Task agents are not configurable for ${descriptor.label}.` });
  }
  const { agents, cwd } = req.body || {};
  if (cwd !== undefined && typeof cwd !== 'string') {
    return res.status(400).json({ error: 'cwd must be a string' });
  }
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
    return res.status(400).json({ error: 'agents must be an object mapping agent names to settings' });
  }
  const patch = Object.entries(agents);
  if (!patch.length) return res.status(400).json({ error: 'agents must name at least one agent' });
  for (const [name, settings] of patch) {
    if (!AGENT_NAME_KEY.test(name)) return res.status(400).json({ error: `Invalid agent name: ${name}` });
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: `Invalid settings for agent ${name}` });
    }
    for (const field of ['disabled', 'prewalk', 'advisor']) {
      const value = settings[field];
      if (value !== undefined && value !== null && typeof value !== 'boolean') {
        return res.status(400).json({ error: `Invalid ${field} for agent ${name}: expected a boolean or null` });
      }
    }
    const model = settings.model;
    if (model !== undefined && model !== null
        && (typeof model !== 'string' || !model.trim() || model.length > MODEL_ROLE_VALUE_MAX)) {
      return res.status(400).json({ error: `Invalid model for agent ${name}: expected null or a non-empty model ref of at most ${MODEL_ROLE_VALUE_MAX} characters` });
    }
  }
  try {
    res.json(await queueHarnessConfigWrite(descriptor.id, async () => {
      const keys = agentSettingKeyList(descriptor);
      const record = shapeAgentSettings(await readGlobalConfigValues(descriptor, keys));
      const disabled = new Set(record.disabled);
      const dirty = new Set();
      const setOverride = (bucket, key, name, value) => {
        if (value === undefined) return;
        if (value === null) {
          if (!Object.hasOwn(bucket, name)) return;
          delete bucket[name];
        } else {
          if (bucket[name] === value) return;
          bucket[name] = value;
        }
        dirty.add(key);
      };
      for (const [name, settings] of patch) {
        if (settings.disabled !== undefined && settings.disabled !== null
            && settings.disabled !== disabled.has(name)) {
          if (settings.disabled) disabled.add(name); else disabled.delete(name);
          dirty.add(descriptor.pilotConfig.disabledAgents);
        }
        setOverride(record.modelOverrides, descriptor.pilotConfig.agentModelOverrides, name, settings.model);
        setOverride(record.prewalk, descriptor.pilotConfig.agentPrewalk, name, settings.prewalk);
        setOverride(record.advisor, descriptor.pilotConfig.agentAdvisor, name, settings.advisor);
      }
      const values = {
        [descriptor.pilotConfig.disabledAgents]: [...disabled],
        [descriptor.pilotConfig.agentModelOverrides]: record.modelOverrides,
        [descriptor.pilotConfig.agentPrewalk]: record.prewalk,
        [descriptor.pilotConfig.agentAdvisor]: record.advisor,
      };
      // Only the records a patch actually moved are rewritten: every `config
      // set` is a whole-value write, so touching an untouched key would
      // materialize a global copy of whatever the read returned.
      for (const key of keys) {
        if (dirty.has(key)) {
          await runHarnessJsonCommand(descriptor, descriptor.argv.configSet(key, JSON.stringify(values[key])));
        }
      }
      return readAgentSettings(descriptor, cwd);
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A live OMP session's model registry doesn't carry the per-model thinking
// level list that `omp models --json` has — merge it in from the (cached)
// catalog by selector, so the thinking dropdown can offer only what the
// session's model supports.
async function withCatalogThinkingLevels(models, descriptor) {
  if (descriptor?.modelCatalog !== 'command') return models;
  if (!models.some(m => m && !Array.isArray(m.thinking))) return models;
  try {
    const catalog = await runHarnessModelCommand(descriptor, {});
    const levelsBySelector = new Map(
      catalog.filter(m => m && Array.isArray(m.thinking)).map(m => [m.selector, m.thinking]));
    return models.map(m => {
      if (!m || Array.isArray(m.thinking)) return m;
      const thinking = levelsBySelector.get(m.selector)
        ?? levelsBySelector.get(`${m.provider}/${m.id}`);
      return thinking ? { ...m, thinking } : m;
    });
  } catch {
    return models;
  }
}

app.get('/api/models', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (sessionId) {
      const identity = routeIdentity(sessionId);
      if (!identity) return res.status(400).json({ error: 'Invalid session ID' });
      const sessionModels = await getSessionModels(sessionId);
      if (sessionModels) {
        if (identity.harnessId === 'pi') return res.json(annotateEnabled(sessionModels));
        return res.json(await withCatalogThinkingLevels(sessionModels, getHarness(identity.harnessId)));
      }
      if (identity.harnessId !== 'pi') {
        return res.status(409).json({ error: `Model discovery is unavailable for this ${getHarness(identity.harnessId).label} session.` });
      }
    }

    const harnessId = req.query.harness || 'pi';
    const descriptor = getHarness(harnessId);
    if (!descriptor) return res.status(400).json({ error: `Unknown harness: ${harnessId}` });
    if (descriptor.modelCatalog === 'command') {
      if (!harnessCommandAvailable(descriptor)) return res.status(503).json({ error: `${descriptor.label} is not installed.` });
      if (req.query.cwd !== undefined && typeof req.query.cwd !== 'string') {
        return res.status(400).json({ error: 'cwd must be a string' });
      }
      return res.json(await runHarnessModelCommand(descriptor, { cwd: req.query.cwd }));
    }
    if (descriptor.modelCatalog !== 'pi-sdk') {
      return res.status(501).json({ error: `New-session model discovery is not supported for ${descriptor.label}.` });
    }

    if (!modelsCache || Date.now() - modelsCacheTime > MODELS_CACHE_TTL) {
      setModelsCache(await piSDK.getAvailableModels());
    }
    res.json(annotateEnabled(modelsCache));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Persist the scoped-models set the same way pi's /scoped-models selector
// does: explicit "provider/id" strings in settings.enabledModels, absent when
// everything is enabled. Use pi's SettingsManager rather than rewriting its
// file ourselves: it locks, re-reads, and merges only the modified field, so
// concurrent settings writes from a running pi keep their unrelated fields.
app.put('/api/models/enabled', async (req, res) => {
  const { enabledIds } = req.body || {};
  const clearing = enabledIds == null;
  if (!clearing && (!Array.isArray(enabledIds) ||
      !enabledIds.every(id => typeof id === 'string' && id.trim()))) {
    return res.status(400).json({ error: 'enabledIds must be null or an array of model ids' });
  }
  const normalizedIds = clearing ? undefined : enabledIds.map(id => id.trim());
  if (normalizedIds && new Set(normalizedIds).size !== normalizedIds.length) {
    return res.status(400).json({ error: 'enabledIds must not contain duplicate model ids' });
  }
  try {
    const sdk = await piSDK.getSDK();
    const settingsManager = sdk.SettingsManager.create(
      process.cwd(), path.dirname(PI_SETTINGS_FILE), { projectTrusted: false },
    );
    const patterns = normalizedIds?.length ? normalizedIds : undefined;
    settingsManager.setEnabledModels(patterns);
    await settingsManager.flush();
    const errors = settingsManager.drainErrors();
    if (errors.length) throw errors[0].error;
    res.json({ success: true, enabledModels: patterns || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const BRIDGE_COMMAND_CAPABILITIES = {
  compact: 'compact',
  tree: 'treeNavigation',
  model: 'setModel',
  name: 'rename',
  thinking: 'setThinking',
  abort: 'abort',
  reload: 'reload',
  btw: 'btw',
};

function filterBridgeCommands(sess, commands) {
  // Pi keeps its established full TUI list. Alternative harnesses fail
  // closed: retain skills/templates and bridge commands explicitly marked as
  // executable, plus built-ins pi-dish maps to an advertised bridge operation.
  // Export/share stay out because their web-native controls preserve download
  // and share-token semantics that a slash-command mapping would change.
  if (sess.harnessId === 'pi') return commands;
  return commands.filter((command) => command.supported === true
    || (BRIDGE_COMMAND_CAPABILITIES[command.name]
      && liveSessionSupports(sess, BRIDGE_COMMAND_CAPABILITIES[command.name])));
}

async function appendHostBuiltins(sessionId, sess, commands) {
  const descriptor = getHarness(sess.harnessId);
  const available = [];
  // One pane lookup covers both surfaces: the descriptor's curated host
  // builtins and OMP's /reload. OMP's bridge reload capability stays false
  // because its public API cannot invoke command handlers remotely — a
  // reachable pane is the actual capability. The command route maps /reload
  // to the bridge's /dish-reload command in that exact TUI, where OMP
  // supplies a legal command context for ctx.reload.
  const wantsPane = descriptor?.hostBuiltins?.length || sess.harnessId === 'omp';
  const pane = wantsPane ? await locatePiPane(sessionId) : null;
  if (pane && descriptor?.hostBuiltins?.length) {
    // allowedArgs/blockedArgs/freeArgs/requireArgs are server-side validation
    // rules; clients only need the name, description and arg hint.
    available.push(...descriptor.hostBuiltins.map(
      ({ allowedArgs, blockedArgs, freeArgs, requireArgs, ...command }) => ({
        ...command, source: 'host', supported: true,
      })));
  }
  if (sess.harnessId === 'omp' && pane) {
    available.push({
      name: 'reload',
      description: 'Reload the current Oh My Pi session/runtime state',
      source: 'host',
      supported: true,
    });
  }
  if (!available.length) return commands;
  const hostNames = new Set(available.map(command => command.name));
  return [
    ...commands.filter(command => !hostNames.has(command.name)),
    ...available,
  ];
}

app.get('/api/commands', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (sessionId) {
      // Ask the live session — it knows exactly which commands exist there.
      try {
        const sess = await getLiveSession(sessionId);
        if (sess instanceof BridgeSession) {
          if (!liveSessionSupports(sess, 'commands')) {
            return res.status(409).json({ error: 'This session does not support command discovery.' });
          }
          const data = await sess.getCommands();
          if (data?.commands) {
            const commands = filterBridgeCommands(sess, data.commands);
            return res.json(await appendHostBuiltins(sessionId, sess, commands));
          }
        } else if (sess) {
          const data = await sess.getCommands();
          const commands = [
            ...RPC_BUILTIN_COMMANDS.map(c => ({ ...c, source: 'builtin', supported: true })),
            ...(data?.commands || []).map(c => ({ ...c, supported: true })),
          ];
          return res.json(commands);
        }
      } catch (e) {
        console.warn(`Live command list failed for ${sessionId}:`, e.message);
      }
      const identity = routeIdentity(sessionId);
      if (!identity) return res.status(400).json({ error: 'Invalid session ID' });
      if (identity.harnessId !== 'pi') {
        return res.status(409).json({ error: `Command discovery is unavailable for this ${getHarness(identity.harnessId).label} session.` });
      }
    }
    const commands = await piSDK.getCommands();
    res.json(commands);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/:id/abort', async (req, res) => {
  try {
    const sess = await getLiveSession(req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session not active' });
    if (!liveSessionSupports(sess, 'abort')) return res.status(409).json({ error: 'This session does not support abort.' });
    await sess.abort();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/:id/close', async (req, res) => {
  const { status, body } = await sessionOperations.closeSessionById(req.params.id);
  res.status(status).json(body);
});

app.get('/api/cwds', (req, res) => {
  try {
    const cwdSet = new Set(knownWorkspaceCwds());
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
app.get('/api/config', (req, res) => {
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

app.post('/api/stt', parseAudioBody, async (req, res) => {
  const config = stt.resolveSttConfig(readDishSettings());
  if (!config) return res.status(503).json({ error: 'Speech-to-text is not configured on this host' });
  // Type before body: the raw parser above only claims audio/* and
  // video/webm, so anything else never becomes a Buffer at all and would
  // otherwise be reported as a missing body rather than a wrong format.
  const contentType = req.headers['content-type'] || '';
  if (!stt.sttFilename(contentType)) {
    return res.status(415).json({ error: `unsupported audio type ${stt.baseMimeType(contentType) || 'unknown'}` });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'audio body required' });
  try {
    const { text } = await stt.transcribe(config, { bytes: req.body, contentType });
    res.json({ text });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// =========================================================================
// Agent docs: GET /api/agent-docs, GET /api/agent-docs/:topic
// =========================================================================
//
// The server ships the agent-facing documentation for the API this build
// actually serves, so an agent in a mixed-version fleet reads the *running*
// host's docs instead of whatever a vended skill file was pinned to. Sourced
// from the app's own tree, never HOME.

const AGENT_DOCS_DIR = path.join(__dirname, 'docs', 'agent');
// This shape gate is also the path-traversal gate: nothing that fails it is
// ever joined into a filesystem path.
const AGENT_DOC_TOPIC_RE = /^[a-z0-9-]{1,64}$/;
const AGENT_DOC_DESCRIPTION_MAX = 160;

function agentDocSummary(markdown) {
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

app.get('/api/agent-docs', (req, res) => {
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

app.get('/api/agent-docs/:topic', (req, res) => {
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
app.get('/api/themes', (req, res) => {
  const themes = [{ id: 'solarized', builtin: true }, { id: 'graphite', builtin: true }];
  try {
    const dir = path.join(os.homedir(), '.pi', 'dish', 'themes');
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        const tokens = {};
        for (const [k, v] of Object.entries(raw)) {
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
app.get('/api/tmux/targets', async (req, res) => {
  if (!tmux.isTmuxAvailable()) return res.json({ available: false, servers: [] });
  try {
    const servers = await tmux.listServers();
    // Opportunistically drop spawn placements whose pane and session are both
    // gone, so tmux-spawns.json doesn't grow without bound.
    try {
      const registered = new Set(listRegisteredSessions().map((entry) => {
        const identity = registryIdentity(entry);
        return identity ? routeSessionId(identity.harnessId, identity.nativeSessionId) : null;
      }).filter(Boolean));
      await tmux.pruneSpawns(registered);
    } catch {}
    res.json({ available: true, servers });
  } catch {
    res.json({ available: true, servers: [] });
  }
});

// Fuzzy directory search under $HOME for the new-session cwd picker.
app.get('/api/dirs', (req, res) => {
  try {
    res.json(searchHomeDirs(String(req.query.q || ''), 15));
  } catch (e) {
    res.status(500).json([]);
  }
});

// Immediate subdirectories of a path, for the new-session cwd tree. Absolute
// (or ~-prefixed) path required → 400; an unreadable dir degrades to 200 with
// an `error` field and empty `dirs` so the tree never blanks.
app.get('/api/dirs/children', (req, res) => {
  try {
    res.json(getDirChildren(String(req.query.path || '')));
  } catch (e) {
    if (e.badRequest) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// Best-known working directory for a session: live registry first, then the
// JSONL header. Null when neither knows (terminal + file search fall back).
function resolveSessionCwd(sessionId) {
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
app.get('/api/sessions/:id/files', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const cwd = resolveSessionCwd(req.params.id);
    if (isPathCompletionToken(q)) {
      return res.json({ cwd, files: completePath(q, { cwd, limit: 20 }) });
    }
    if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
    const files = await searchFiles(cwd, q, 20);
    res.json({ cwd, files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function resolveViewerMention(sessionId, mention) {
  const cwd = resolveSessionCwd(sessionId);
  const session = findSessionSource(sessionId);
  if (!cwd && !session) return { error: 'Unknown session', status: 404 };
  let messages = [];
  if (session) { try { messages = readSessionMessages(session); } catch {} }
  const resolved = await resolveFileMention(mention, { cwd, messages });
  if (!resolved) return { error: `Couldn't find "${mention}" among this session's files`, status: 404 };
  return { cwd, resolved };
}

// Raw files use a normal resource response instead of JSON. The same
// session-aware resolver gates both previews and bytes, so this does not
// create a path traversal shortcut around the file viewer's reach rules.
// Text is deliberately served as text/plain: a viewed HTML/SVG file must not
// become executable same-origin content merely because the user opens Raw.
app.get('/api/sessions/:id/file/content', async (req, res) => {
  try {
    const mention = String(req.query.path || '');
    if (!mention || mention.length > 1024) return res.status(400).json({ error: 'path required' });
    const found = await resolveViewerMention(req.params.id, mention);
    if (found.error) return res.status(found.status).json({ error: found.error });
    const file = readFileForViewer(found.resolved.absPath, { imageData: false });
    if (file.error) return res.status(file.status || 415).json({ error: file.error, path: found.resolved.absPath });
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const safeImageMime = file.image && file.image.mimeType !== 'image/svg+xml'
      ? file.image.mimeType : 'text/plain; charset=utf-8';
    res.type(safeImageMime).sendFile(found.resolved.absPath);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Read a file mentioned in the chat (clickable filenames in the transcript).
// "findings.md" written deep in the tree resolves through the session's own
// tool calls; reads are gated to the cwd subtree + tool-touched paths. See
// lib/file-mention.js.
app.get('/api/sessions/:id/file', async (req, res) => {
  try {
    const mention = String(req.query.path || '');
    if (!mention || mention.length > 1024) return res.status(400).json({ error: 'path required' });
    const found = await resolveViewerMention(req.params.id, mention);
    if (found.error) return res.status(found.status).json({ error: found.error });
    const { cwd, resolved } = found;
    const file = readFileForViewer(resolved.absPath, { imageData: false });
    if (file.error) return res.status(file.status || 415).json({ error: file.error, path: resolved.absPath });
    if (file.image) {
      file.image.url = `/api/sessions/${encodeURIComponent(req.params.id)}/file/content?path=${encodeURIComponent(mention)}&v=${file.mtime}-${file.size}`;
    }
    res.json({
      path: resolved.absPath,
      relPath: cwd && resolved.absPath.startsWith(cwd + '/') ? resolved.absPath.slice(cwd.length + 1) : null,
      line: resolved.line ?? null,
      ...file,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const DIFF_INLINE_FILE_LIMIT = 6;
const DIFF_SNAPSHOT_TTL_MS = 60 * 1000;
const diffSnapshots = new Map(); // sessionId -> { id, cwd, at, version, data }

function rememberDiffSnapshot(sessionId, cwd, data) {
  const { version, ...clientData } = data;
  const snapshot = {
    id: crypto.randomBytes(12).toString('hex'),
    cwd,
    at: Date.now(),
    version,
    data: clientData,
  };
  diffSnapshots.delete(sessionId);
  diffSnapshots.set(sessionId, snapshot);
  while (diffSnapshots.size > 4) diffSnapshots.delete(diffSnapshots.keys().next().value);
  return snapshot;
}

function staleDiffResponse(res) {
  return res.status(409).json({
    stale: true,
    error: 'The working tree changed since this diff was loaded; refresh the diff pane.',
  });
}

// A large pane receives metadata first. Patch lookup selects from the exact
// aggregate snapshot used for that response (rather than accepting an
// arbitrary path). The working-tree version is checked around patch creation;
// drift returns an explicit stale response instead of mixing snapshots.
app.get('/api/sessions/:id/diff/patch', async (req, res) => {
  try {
    const repoPath = String(req.query.repo || '');
    const filePath = String(req.query.path || '');
    const snapshotId = String(req.query.snapshot || '');
    if (!repoPath || !filePath || !/^[a-f0-9]{24}$/.test(snapshotId) ||
        repoPath.length > 2048 || filePath.length > 4096) {
      return res.status(400).json({ error: 'repo, path, and snapshot required' });
    }
    const cwd = resolveSessionCwd(req.params.id);
    if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
    const snapshot = diffSnapshots.get(req.params.id);
    if (!snapshot || snapshot.id !== snapshotId || snapshot.cwd !== cwd ||
        Date.now() - snapshot.at > DIFF_SNAPSHOT_TTL_MS) return staleDiffResponse(res);
    const repo = snapshot.data.repos.find(item => item.path === repoPath);
    const file = repo?.files.find(item => item.path === filePath);
    if (!repo || !file) return res.status(404).json({ error: 'Patch not found' });
    if (await getDiffVersion(cwd) !== snapshot.version) return staleDiffResponse(res);
    const patch = file.patch ? file : await getFilePatch(path.resolve(cwd, repo.path), file);
    if (await getDiffVersion(cwd) !== snapshot.version) return staleDiffResponse(res);
    if (!patch?.patch) return res.status(404).json({ error: 'Patch not found' });
    // Sliding TTL and LRU recency without replacing the snapshot identity.
    snapshot.at = Date.now();
    diffSnapshots.delete(req.params.id);
    diffSnapshots.set(req.params.id, snapshot);
    res.json({ patch: patch.patch, truncated: !!patch.truncated, binary: !!patch.binary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Aggregate uncommitted git diffs for every repo under the session cwd (the
// user's workspaces are polyrepos — several checkouts side by side under one
// agent cwd). The cwd comes from the session, never the request, so there's
// no path input to gate. See lib/git-diff.js.
app.get('/api/sessions/:id/diff', async (req, res) => {
  try {
    const cwd = resolveSessionCwd(req.params.id);
    if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
    const data = await aggregateDiffs(cwd, { inlineLimit: DIFF_INLINE_FILE_LIMIT });
    const snapshot = rememberDiffSnapshot(req.params.id, cwd, data);
    res.json({ ...snapshot.data, snapshotId: snapshot.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.post('/api/sessions/new', async (req, res) => {
  const { harness = 'pi', model, thinking, cwd, target } = req.body || {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : req.body?.name;
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
  if (thinking !== undefined && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(thinking)) {
    return res.status(400).json({ error: 'Invalid reasoning level' });
  }
  // requestedBySessionId is the public provenance field; retain the earlier
  // sourceSessionId spelling as a compatibility alias. The header lets the
  // bundled CLI identify itself without making the claim authoritative.
  const sourceSessionId = req.get('X-Pi-Dish-Session-Id')
    || req.body?.requestedBySessionId || req.body?.sourceSessionId || null;
  // A host-qualified caller (`<hostId>:<sessionId>`, TASKS/multi-host.md
  // block 6) names a session on another fleet host, which this host cannot
  // verify — provenance is advisory and grants nothing, so a well-formed
  // qualified id is recorded as-is while bare local ids stay validated.
  const hostQualifiedSource = sourceSessionId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:./i.test(sourceSessionId);
  if (sourceSessionId && !hostQualifiedSource
      && !getRegisteredSession(sourceSessionId) && !getRPCSession(sourceSessionId)?.alive
      && !findSessionFile(sourceSessionId, { exact: true })) {
    return res.status(400).json({ error: 'requestedBySessionId must identify an existing session' });
  }
  try {
    await sessionLaunch.validateHarnessPilotSelection(descriptor, { model, thinking, cwd });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
  if (req.body?.async === true) {
    const spawnId = sessionOperations.startSessionSpawn({ harness, name, model, thinking, cwd, target, sourceSessionId });
    return res.status(202).json({ success: true, pending: true, spawnId });
  }
  try {
    const id = await sessionOperations.createSession({ harness, name, model, thinking, cwd, target });
    const operationId = sourceSessionId ? sessionOperations.recordSessionLaunch(id, sourceSessionId) : null;
    res.json({ success: true, id, ...(operationId ? { operationId } : {}) });
  } catch (e) {
    console.error('Failed to create session:', e);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

app.get('/api/session-spawns/:id', (req, res) => {
  const operation = sessionOperations.getSessionSpawn(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Session spawn not found' });
  res.status(operation.status === 'starting' ? 202 : 200).json(operation);
});


app.post('/api/sessions/:id/resume', async (req, res) => {
  try { res.json(await sessionOperations.resumeSessionById(req.params.id, { model: req.body?.model, target: req.body?.target })); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});


const recoveryRunner = createRecoveryRuntime({
  operations: sessionOperations,
  ownership,
  getMode: () => readDishSettings().recoveryMode,
});

app.get('/api/recovery', (_req, res) => {
  try { res.json(recoveryRunner.report()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});
app.put('/api/sessions/:id/recovery', (req, res) => {
  if (typeof req.body?.excluded !== 'boolean') return res.status(400).json({ error: 'excluded must be a boolean' });
  const identity = routeIdentity(req.params.id);
  if (!identity || !getHarness(identity.harnessId)) return res.status(400).json({ error: 'Invalid session ID' });
  if (!recoveryStore.readRecord(identity.harnessId, identity.nativeSessionId)
      && !getRegisteredSession(req.params.id) && !getRPCSession(req.params.id)?.alive
      && !findSessionSource(req.params.id, { exact: true })) return res.status(404).json({ error: 'Session not found' });
  try {
    const control = recoveryStore.patchControl(identity.harnessId, identity.nativeSessionId, { excluded: req.body.excluded });
    res.json({ excluded: control.excluded });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post('/api/recovery/retry', async (req, res) => {
  if (typeof req.body?.id !== 'string') return res.status(400).json({ error: 'id is required' });
  try { res.json(await recoveryRunner.retry(req.body.id)); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});


app.post('/api/sessions/:id/restart', async (req, res) => {
  const result = await sessionOperations.restartSessionById(req.params.id);
  res.status(result.status).json(result.body);
});


const sessionBounces = createSessionBounceRuntime({
  operations: sessionOperations,
  ownership,
  catalog: () => { invalidateRegistryCache(); return getActiveSessions(); },
});

app.get('/api/session-bounces/preview', async (req, res) => {
  if (!['reload', 'restart'].includes(req.query.mode)) return res.status(400).json({ error: 'mode must be reload or restart' });
  try { res.json({ targets: await sessionBounces.preview(req.query.mode) }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/session-bounces', (req, res) => {
  try { res.status(202).json({ operation: sessionBounces.enqueue(req.body?.mode, req.body?.sessionIds) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

app.get('/api/session-bounces', async (_req, res) => {
  try { res.json({ operations: await sessionBounces.list() }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/session-bounces/:id', (req, res) => {
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

app.get('/api/sessions/:id/stream', async (req, res) => {
  const sessionId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(': connected\n\n');
  res.flush?.();

  let sess;
  try {
    sess = await getLiveSession(sessionId);
  } catch (e) {
    res.write(`event: stream_error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    return res.end();
  }
  if (!sess) {
    res.write(`event: stream_error\ndata: ${JSON.stringify({ error: 'Session not active' })}\n\n`);
    return res.end();
  }

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Even though compression explicitly excludes event streams above, flush
    // every frame so a reconnecting phone can render replay/live state without
    // waiting for another event to make the chunk observable.
    res.flush?.();
  };
  const messageForStream = (message) => {
    if (message?.role !== 'custom') return message;
    // interrupted-thinking content is hidden model reasoning. The client only
    // needs its marker; visible custom messages (including async-result) pass
    // through, while other hidden host state follows the documented skip.
    if (message.customType === 'interrupted-thinking') return { ...message, content: [] };
    return message.display === false ? null : message;
  };

  send('init', { turnInProgress: !!sess.turnInProgress, compacting: !!sess.compacting });

  const offs = [];
  const sub = (event, fn) => {
    const unsub = sess.on(event, fn);
    offs.push(typeof unsub === 'function' ? unsub : () => sess.off(event, fn));
  };

  sub('turn_start', () => send('turn_start', {}));

  // Coalesced message_update forwarding — each event carries the *full*
  // message so far, so dropping intermediates loses nothing.
  let pendingUpdate = null;
  let updateTimer = null;
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
    const m = messageForStream(data?.message);
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
    const message = messageForStream(data?.message);
    const role = message?.role;
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
  const lastExtUI = new Map(); // method:key -> content signature
  const extUISig = (data) => JSON.stringify([data.widgetLines, data.widgetPlacement, data.statusText]);
  sub('extension_ui_request', (data) => {
    // data.forced marks a deliberate re-broadcast (/dish-push) — let the
    // repeat through, or a force push of unchanged content is a no-op.
    if (data && !data.forced && (data.method === 'setWidget' || data.method === 'setStatus')) {
      const k = `${data.method}:${data.widgetKey || data.statusKey || 'default'}`;
      const sig = extUISig(data);
      if (lastExtUI.get(k) === sig) return;
      lastExtUI.set(k, sig);
    }
    send('extension_ui_request', data);
  });
  sub('extension_ui_resolved', (data) => send('extension_ui_resolved', data));

  // Replay the session's remembered extension UI (see trackExtUIState) so a
  // client that just connected — typically one that switched sessions — shows
  // this session's widgets/statuses/pending dialogs instead of waiting for
  // the next live emission. Seeding the dedupe signatures keeps the bridge's
  // unchanged re-emissions from double-rendering right after the replay.
  const replayDialogs = sess.extUIState && sess.turnInProgress ? [...sess.extUIState.dialogs.values()] : [];
  if (sess.extUIState) {
    const { widgets, statuses } = sess.extUIState;
    for (const data of [...widgets.values(), ...statuses.values(), ...replayDialogs]) {
      if (data.method === 'setWidget' || data.method === 'setStatus') {
        lastExtUI.set(`${data.method}:${data.widgetKey || data.statusKey || 'default'}`, extUISig(data));
      }
      send('extension_ui_request', data);
    }
  }
  // Authoritative pending-dialog list, sent after the replay burst so the
  // client can prune dialogs it stashed for this session that were answered
  // (or dismissed as stale) while it was viewing another session.
  send('extension_ui_state', { dialogs: replayDialogs.map(data => data.id).filter(Boolean) });
  // Replay the last-known queue so a client that just (re)connected — e.g. one
  // that switched sessions — shows pending steers/follow-ups without waiting
  // for the next queue_update. RPCSessions have no queueState (fine).
  if (sess.queueState) send('queue_update', sess.queueState);
  sub('queue_update', (data) => send('queue_update', data));
  sub('compaction_start', (data) => send('compaction_start', data));
  sub('compaction_end', (data) => send('compaction_end', data));
  sub('auto_retry_start', (data) => send('auto_retry_start', data));
  sub('auto_retry_end', (data) => send('auto_retry_end', data));

  const onClose = () => { clearPendingUpdate(); send('session_ended', {}); };
  if (typeof sess.once === 'function') {
    sess.once('close', onClose);
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

function findSessionSource(sessionId, { exact = false } = {}) {
  return sessionSources.resolve({ route: sessionId, exact, live: liveSourceObservations(sessionId) });
}

function findSessionFile(sessionId, options) {
  return findSessionSource(sessionId, options)?.file || null;
}

// =========================================================================
// Start server
// =========================================================================

// Warm the models cache at startup so context window sizes are accurate immediately
piSDK.getAvailableModels().then(setModelsCache).catch(() => {});

// Every listener pi-dish owns: the loopback alias below plus each main
// (fleet-facing) listener candidate. Close hooks and WebSocket upgrades
// must reach all of them.
const ownedServers = [];
const serverCloseHooks = [];

function ownServer(l) {
  ownedServers.push(l);
  for (const hook of serverCloseHooks) l.on('close', hook);
  wireUpgrades(l);
  return l;
}

function onServerClose(hook) {
  serverCloseHooks.push(hook);
  for (const l of ownedServers) l.on('close', hook);
}

const LOOPBACK = '127.0.0.1';
const hostIsLoopback = HOST === LOOPBACK || HOST === 'localhost';
const hostIsWildcard = HOST === '0.0.0.0' || HOST === '::';

// With HOST=<specific address> (typically the tailscale IP) nothing listens
// on loopback, yet host-local callers need it: the update timer's health
// probe and spawned session CLIs (PI_DISH_URL below) must keep working
// while the tailnet is wedged, so a dead relay reads as "unreachable from
// the fleet", never as "pi-dish down" — the update timer restarts, pauses
// updates, and spawns a diagnosis session on the latter. Bound first, and
// kept up even when HOST itself cannot bind.
let aliasServer = null;
const explicitAgentUrl = !!process.env.PI_DISH_URL;
function ensureLoopbackAlias(port) {
  if (hostIsLoopback || hostIsWildcard || aliasServer) return;
  aliasServer = ownServer(app.listen(port, LOOPBACK, () => {
    updateAgentUrl(server);
    console.log(`pi-dish loopback alias at http://${LOOPBACK}:${aliasServer.address().port}`);
  }));
  aliasServer.on('error', (err) => {
    console.error(`pi-dish: loopback alias not listening: ${err.message}`);
    aliasServer = null;
    updateAgentUrl(server);
  });
}

// Bound before the main listener (and before it starts retrying) with a
// concrete port, so both listeners answer the one URL we advertise.
// PORT=0 defers to startMainListener below: only the main listener can
// mint the ephemeral port the alias must share.
if (PORT > 0) ensureLoopbackAlias(PORT);

let recoveryStopped = false;
let server = null; // fleet-facing listener; set by startMainListener

function updateAgentUrl(main) {
  // Base URL for agents running on this machine (skill CLIs and the
  // pi-dish-pages hook fetch it). Children spawned by pi-dish inherit
  // process.env (RPC) or get it via tmux -e; respect an operator-provided
  // value. Prefer loopback whenever we serve it — it stays reachable no
  // matter the tailnet state; otherwise advertise the address we bound.
  if (!explicitAgentUrl && main?.listening) {
    const bound = main.address();
    const wildcard = !bound.address || bound.address === '0.0.0.0' || bound.address === '::';
    // Creating the alias object does not mean its asynchronous bind succeeded.
    // Until it listens, the primary is the address an agent can actually reach.
    const reachable = wildcard || aliasServer?.listening ? LOOPBACK : bound.address;
    const authority = reachable.includes(':') ? `[${reachable}]` : reachable;
    process.env.PI_DISH_URL = `http://${authority}:${bound.port}`;
  }
}

function onMainListening(main) {
  updateAgentUrl(main);
  console.log(`pi-dish running at http://${HOST}:${PORT}`);
  if (HOST === '127.0.0.1') {
    console.log('Bound to localhost only. To reach it from other devices, set HOST (e.g. HOST=0.0.0.0 or your Tailscale IP) or front it with a reverse proxy.');
  }
  // Prime the skill-mining context before the first big index build so bundled
  // (references/*) reads attribute to their skill from the cold pass. Failure
  // is harmless — SKILL.md reads and explicit /skill: blocks are detected
  // without roots, and the inventory re-primes on the first /api/skills hit.
  skillsLib.getSkillFilePaths({ cwds: knownWorkspaceCwds() })
    .then(paths => sessionIndex.setSkillRoots(paths))
    .catch(() => {});
  sessionBounces.start();
  // Recovery runs on every configured server startup, with no browser or boot
  // service dependency. Reconcile routine-owned invocations only afterwards:
  // a restored idle session is interrupted work, not a completed oneShot.
  recoveryRunner.start()
    .then(() => routineRunner.recoverAfterRestart())
    .then(() => { if (!recoveryStopped) routineRunner.start(); })
    .catch((e) => console.error(`Session restart recovery failed: ${e.message}`));
}

function startMainListener(retrySeconds = 15) {
  const main = ownServer(app.listen(PORT, HOST, () => {
    if (PORT === 0) ensureLoopbackAlias(main.address().port);
    onMainListening(main);
  }));
  main.on('error', (err) => {
    if (err.code === 'EADDRNOTAVAIL') {
      // HOST's interface is gone (tailscaled down or still starting). Keep
      // serving loopback and retry: crashing here would only buy a
      // supervisor restart loop that ends the moment the address returns.
      console.error(`pi-dish: ${HOST} is not assigned yet; retrying in ${retrySeconds}s`);
      setTimeout(() => startMainListener(retrySeconds), retrySeconds * 1000);
      return;
    }
    console.error(`pi-dish: cannot listen on ${HOST}:${PORT}: ${err.message}`);
    process.exit(1);
  });
  server = main;
}

startMainListener();
onServerClose(() => {
  recoveryStopped = true;
  recoveryRunner.stop();
  routineRunner.stop();
});

// Optional dedicated share listener: a second minimal app that serves only
// public content routes and the two static stylesheets used by standalone
// file pages. Everything else 404s, so exposing this listener does not open
// the main app or API. All public routes remain on the main app too.
if (process.env.PI_DISH_SHARE_PORT) {
  const shareApp = express();
  shareApp.get('/share/:token', serveSharedSession);
  // Do not pass Express's `next` callback as servePage's annotate argument.
  // The dedicated public listener always serves the original HTML unchanged.
  shareApp.get('/page/:token', (req, res) => servePage(req, res));
  shareApp.get('/page/:token/*', (req, res) => {
    req.params[0] = '/' + (req.params[0] || '');
    servePage(req, res);
  });
  shareApp.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'style.css')));
  shareApp.get('/vendor/hljs-theme.min.css', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'vendor', 'hljs-theme.min.css')));
  shareApp.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  const shareHost = process.env.PI_DISH_SHARE_HOST || HOST;
  const shareServer = shareApp.listen(process.env.PI_DISH_SHARE_PORT, shareHost, () => {
    console.log(`pi-dish share listener at http://${shareHost}:${shareServer.address().port}`);
  });
  onServerClose(() => { try { shareServer.close(); } catch {} });
}

// ssh forwards are children of this process; nothing outlives the server.
// The signal handlers exist because that is how a server actually stops
// (`node --watch` restarts, Ctrl-C): without them every restart would strand
// another `ssh -N` holding a connection to a work host. They reproduce the
// default exit codes so nothing else observes a change.
onServerClose(() => remoteHosts.shutdown());
onServerClose(() => sessionBounces.stop());
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => { remoteHosts.shutdown(); process.exit(code); });
}

// WebSocket upgrades bypass Express, and two features want them: the local
// terminal and the /hosts/<name> terminal proxy. Every 'upgrade' listener
// sees every socket, so one dispatcher hands each socket to the first
// handler that claims it and destroys whatever nothing claims (which is the
// behavior a server with no handler at all has). Attached to every owned
// listener — the loopback alias included — by ownServer above.
const upgradeHandlers = [];
function wireUpgrades(l) {
  l.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url || '', 'http://localhost'); } catch { return socket.destroy(); }
    for (const handle of upgradeHandlers) if (handle(req, socket, head, url)) return;
    socket.destroy();
  });
}

// Proxied terminals work even when this host's own terminal feature is off:
// the PTY lives on the peer.
upgradeHandlers.push(relayHandlers.upgrade);

// WebSocket endpoint for the in-browser terminal (see lib/terminal.js).
// Registered only when the feature flag is on — with it off, upgrade
// requests fall through the dispatcher to the default socket destroy,
// indistinguishable from a server without the feature.
if (terminal.isTerminalEnabled()) {
  const terminalHandlers = createTerminalHandlers({
    upgradeAuthorized: accessHandlers.upgradeAuthorized,
    getRegisteredSession,
    getRPCSession,
    findSessionFile,
    resolveSessionCwd,
    locatePiPane,
  });
  upgradeHandlers.push(terminalHandlers.upgrade);
  onServerClose(terminalHandlers.shutdown);
}

module.exports = server;
