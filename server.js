const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const piSDK = require('./lib/pi-sdk');
const { execFile } = require('child_process');
const { createRPCSession, resumeRPCSession, getRPCSession: getRawRPCSession, getAllRPCSessions, getPiLaunchSpec } = require('./lib/rpc-session');
const {
  listRegisteredSessions,
  invalidateRegistryCache,
  getRegisteredSessionByNativeId,
  validRegistryClaimShape,
  sameRegistryClaim,
  pruneRegisteredSession,
  pruneUnreachableRegisteredSession,
  getBridgeSession: getBridgeSessionForClaim,
  BridgeSession,
  REGISTRY_DIR,
  processIdentity,
  processIdentityAlive,
} = require('./lib/bridge-session');
const { searchFiles, searchHomeDirs, getDirChildren, completePath, isPathCompletionToken } = require('./lib/file-search');
const { resolveFileMention, readFileForViewer } = require('./lib/file-mention');
const { aggregateDiffs, getFilePatch, getDiffVersion } = require('./lib/git-diff');
const terminal = require('./lib/terminal');
const tmux = require('./lib/tmux');
const shares = require('./lib/shares');
const pages = require('./lib/pages');
const comments = require('./lib/comments');
const {
  getSessionInfo: getSessionInfoRaw,
  readSessionMessages: readSessionMessagesRaw,
  readSessionMessageById: readSessionMessageByIdRaw,
  getSessionStats: getSessionStatsRaw,
  readSessionCwd: readSessionCwdRaw,
  decodeDirToCwd,
} = require('./lib/session-files');
const sessionIndex = require('./lib/session-index');
const { discoverSessionCandidates, discoverHarnessSessions, findSessionCandidate } = require('./lib/session-discovery');
const { encodeSessionKey, resolveSessionRoute, canonicalSessionId, VERSION: SESSION_KEY_VERSION } = require('./lib/session-key');
const { getHarness, listHarnesses, resolveLaunchSpec } = require('./lib/harnesses');
const { refreshHarnessPricing } = require('./lib/harness-pricing');
const { inspectProcessAncestry } = require('./lib/process-identity');
const sessionProvenance = require('./lib/session-provenance');
const skillsLib = require('./lib/skills');
const {
  isModelEnabled, extractTextContent, THINKING_LEVEL_NAMES,
  sessionMetaText, parseModelId, formatModelRef, buildSnippet, buildSnippets,
  parseSessionQuery, evaluateSessionQuery, positiveQueryTokens, scoreSessionMatch,
} = require('./public/helpers');

const app = express();
const PORT = process.env.PORT || 3333;
// Localhost-only by default; opt in to LAN/VPN exposure explicitly, e.g.
// HOST=0.0.0.0 (all interfaces) or HOST=<tailscale ip>. There is no auth —
// anything that can reach the port can drive agents with shell access.
const HOST = process.env.HOST || '127.0.0.1';

// Compress static text and JSON responses over LAN links. Event streams are
// deliberately excluded: compression buffers partial output unless every
// event is explicitly flushed, which would add latency to chat streaming.
app.use(compression({
  threshold: 1024,
  filter(req, res) {
    if (req.path.endsWith('/stream')) return false;
    const type = String(res.getHeader('Content-Type') || '');
    if (type.startsWith('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));

// Image attachments arrive as base64 in the prompt body — allow well past
// the default 100kb (a few downscaled phone photos).
app.use(express.json({ limit: '30mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const SESSIONS_DIR = path.join(os.homedir(), '.pi', 'agent', 'sessions');
const PI_SETTINGS_FILE = path.join(os.homedir(), '.pi', 'agent', 'settings.json');
const DISH_SETTINGS_FILE = path.join(os.homedir(), '.pi', 'dish', 'settings.json');

// =========================================================================
// Harness-aware identity boundary
// =========================================================================

function routeIdentity(value) {
  try {
    return {
      ...resolveSessionRoute(value),
      encoded: typeof value === 'string' && value.startsWith(SESSION_KEY_VERSION),
    };
  } catch {
    return null;
  }
}

function routeSessionId(harnessId, nativeSessionId) {
  // Preserve every existing Pi URL/browser key. Alternative corpora use the
  // canonical encoded tuple, so a native-id collision cannot change a Pi URL.
  return harnessId === 'pi' ? nativeSessionId : encodeSessionKey(harnessId, nativeSessionId);
}

function registryIdentity(entry) {
  const harnessId = entry?.wrapper?.harnessId || entry?.harnessId || 'pi';
  const nativeSessionId = entry?.nativeSessionId || entry?.sessionId;
  return harnessId && nativeSessionId ? { harnessId, nativeSessionId } : null;
}

function getRegisteredSession(sessionId) {
  const identity = routeIdentity(sessionId);
  if (!identity) return null;
  return getRegisteredSessionByNativeId(identity.harnessId, identity.nativeSessionId);
}

function refreshRegisteredSession(sessionId) {
  invalidateRegistryCache();
  return getRegisteredSession(sessionId);
}

function getRPCSession(sessionId) {
  const identity = routeIdentity(sessionId);
  return identity?.harnessId === 'pi' ? getRawRPCSession(identity.nativeSessionId) : null;
}

async function getBridgeSession(sessionId) {
  const entry = getRegisteredSession(sessionId);
  if (!entry) throw new Error(`session ${sessionId} not registered or has conflicting bridge instances`);
  return getBridgeSessionForClaim(entry);
}

const sourceByFile = new Map();
function rememberSessionSource(candidate) {
  if (candidate?.file) sourceByFile.set(candidate.file, candidate);
  return candidate;
}
function sourceForIdentity(harnessId, nativeSessionId, file) {
  const descriptor = getHarness(harnessId);
  return rememberSessionSource({
    file,
    id: nativeSessionId,
    nativeSessionId,
    sessionKey: encodeSessionKey(harnessId, nativeSessionId),
    harnessId,
    profileId: descriptor?.profileId || 'pi-v3',
    profileVersion: descriptor?.profileVersion || 1,
  });
}
function sourceForRead(input) {
  if (typeof input !== 'string') return rememberSessionSource(input);
  return sourceByFile.get(input) || input;
}
function apiIdForCandidate(candidate) {
  return routeSessionId(candidate.harnessId || 'pi', candidate.nativeSessionId || candidate.id);
}
function resolveSessionCandidate(sessionId, { discover = true } = {}) {
  const identity = routeIdentity(sessionId);
  if (!identity) return null;
  const descriptor = getHarness(identity.harnessId);
  if (!descriptor) return null;
  const registered = getRegisteredSession(sessionId);
  if (registered?.sessionFile && fs.existsSync(registered.sessionFile)) {
    return sourceForIdentity(identity.harnessId, identity.nativeSessionId, registered.sessionFile);
  }
  if (identity.harnessId === 'pi') {
    const rpc = getRPCSession(sessionId);
    const file = rpc?.sessionFile || rpc?.state?.sessionFile;
    if (file && fs.existsSync(file)) return sourceForIdentity('pi', identity.nativeSessionId, file);
  }
  if (!discover) return null;
  const { candidate } = findSessionCandidate(descriptor.rootPath(), identity.nativeSessionId, {
    descriptor,
    allowPartial: false,
  });
  return candidate ? rememberSessionSource(candidate) : null;
}
function liveSessionHistoryPending(sessionId) {
  const registered = getRegisteredSession(sessionId);
  if (registered) return !registered.sessionFile || !fs.existsSync(registered.sessionFile);
  const rpc = getRPCSession(sessionId);
  const file = rpc?.sessionFile || rpc?.state?.sessionFile;
  return !!rpc?.alive && (!file || !fs.existsSync(file));
}
function getSessionInfo(input) { return getSessionInfoRaw(sourceForRead(input)); }
function readSessionMessages(input) { return readSessionMessagesRaw(sourceForRead(input)); }
function readSessionMessageById(input, id) { return readSessionMessageByIdRaw(sourceForRead(input), id); }
function getSessionStats(input) { return getSessionStatsRaw(sourceForRead(input)); }
function readSessionCwd(input) { return readSessionCwdRaw(sourceForRead(input)); }

function sessionIdentityFields(harnessId, nativeSessionId) {
  const descriptor = getHarness(harnessId);
  return {
    id: routeSessionId(harnessId, nativeSessionId),
    sessionKey: encodeSessionKey(harnessId, nativeSessionId),
    harnessId,
    harnessLabel: descriptor?.label || harnessId,
    nativeSessionId,
  };
}

function sessionCapabilities(harnessId, bridgeCapabilities = {}, { active = false, conflicted = false, closeAllowed = false } = {}) {
  if (conflicted) return Object.fromEntries([
    'prompt', 'steer', 'followUp', 'abort', 'compact', 'models', 'setModel', 'setThinking',
    'rename', 'commands', 'queueCancel', 'tree', 'export', 'close', 'resume',
  ].map(key => [key, false]));
  const pi = harnessId === 'pi';
  const closeMode = getHarness(harnessId)?.closeMode || 'unsupported';
  const advertised = (name) => active && (pi ? bridgeCapabilities[name] !== false : bridgeCapabilities[name] === true);
  return {
    prompt: advertised('prompt'),
    steer: advertised('steer'),
    followUp: advertised('followUp'),
    abort: advertised('abort'),
    compact: advertised('compact'),
    models: active ? advertised('models') : pi,
    setModel: active ? advertised('setModel') : pi,
    setThinking: advertised('setThinking'),
    rename: active ? advertised('rename') : pi,
    commands: active ? advertised('commands') : pi,
    queueCancel: advertised('queueCancel'),
    tree: pi && (active ? advertised('treeNavigation') : true),
    export: pi || harnessId === 'omp',
    // Client-only harnesses may only detach the exact tmux pane pi-dish
    // recorded when it launched that client.
    close: active && (closeMode === 'logical' || (closeMode === 'client-only' && closeAllowed)),
    resume: !active,
  };
}

function spawnMatchesRegistryClaim(spawn, registryEntry) {
  return !!spawn?.spawnToken
    && !!spawn?.paneProcess?.pid
    && !!spawn?.paneProcess?.startTime
    && spawn.spawnToken === registryEntry?.spawnToken;
}

function sameProcessIdentity(left, right) {
  return !!left && !!right
    && Number(left.pid) === Number(right.pid)
    && String(left.startTime) === String(right.startTime);
}

async function proveBridgeRegistryClaim(entry) {
  const probe = new BridgeSession(entry);
  try {
    await probe.connect();
    await probe.waitForHello({ timeout: 2000 });
  } finally {
    probe.close();
  }
}

function spawnAllowsClientDetach(spawn, registryEntry) {
  if (!spawnMatchesRegistryClaim(spawn, registryEntry)) return false;
  const workerIdentity = { pid: registryEntry.pid, startTime: registryEntry.startTime };
  const ancestry = inspectProcessAncestry(workerIdentity);
  return ancestry.complete
    && sameProcessIdentity(ancestry.processes[0], workerIdentity)
    && !ancestry.processes.some(process => sameProcessIdentity(process, spawn.paneProcess));
}

// =========================================================================
// Helpers
// =========================================================================

// Pi reports percent as a float (e.g. 0.3121); show one decimal max.
function roundPercent(p) {
  if (p == null) return p;
  return Math.round(p * 10) / 10;
}

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

const MODEL_THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function normalizeModel(model) {
  if (!model) return null;
  if (typeof model === 'string') {
    const { provider, id } = parseModelId(model);
    return provider && id ? {
      id, name: id, provider, selector: `${provider}/${id}`, contextWindow: 0,
      reasoning: false, thinking: null, pricing: null, free: false,
    } : null;
  }
  const sourcePricing = model.pricing || model.cost;
  const pricing = sourcePricing && Number.isFinite(sourcePricing.input) && Number.isFinite(sourcePricing.output)
    ? Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].filter(k => Number.isFinite(sourcePricing[k])).map(k => [k, sourcePricing[k]]))
    : null;
  const id = model.id || model.modelId;
  const provider = model.provider;
  const thinking = Array.isArray(model.thinking)
    ? model.thinking.filter(level => MODEL_THINKING_LEVELS.has(level))
    : null;
  return {
    id,
    name: model.name || id,
    provider,
    selector: model.selector || (provider && id ? `${provider}/${id}` : null),
    contextWindow: model.contextWindow || 0,
    reasoning: !!model.reasoning,
    thinking,
    pricing,
    free: !!pricing && pricing.input === 0 && pricing.output === 0,
  };
}

function normalizeModels(models) {
  return (Array.isArray(models) ? models : [])
    .map(normalizeModel)
    .filter(m => m && m.id && m.provider);
}

/**
 * The one place bridge-vs-RPC resolution lives. Returns the live session
 * (a connected BridgeSession when the bridge registry knows the id, else an
 * alive RPCSession) or null when neither backend has it. Both classes share
 * prompt/steer/abort/setName/setThinkingLevel/getCommands/getAvailableModels/
 * respondExtensionUI; routes that need a backend-specific call branch on
 * `instanceof BridgeSession`. If connecting a registered bridge fails, only
 * an already-owned live RPCSession may be used as a fallback; transport
 * resolution never launches another pi process. Definitively dead socket
 * claims are pruned without touching a replacement bridge's registry file.
 */
async function getLiveSession(sessionId) {
  const registered = getRegisteredSession(sessionId);
  if (registered) {
    let bridgeError;
    try {
      // Bind this attempt to the claim we selected. A reload can replace the
      // registry entry between lookup and connect; resolving by route again
      // here could connect a different claim and then prune the wrong one if
      // that connection fails.
      return trackExtUIState(await getBridgeSessionForClaim(registered));
    } catch (error) {
      bridgeError = error;
      pruneUnreachableRegisteredSession(registered, error);

      // Extension reloads retire one instance-specific socket and publish a
      // replacement for the same logical session. The 500ms registry memo can
      // briefly hand us the retired claim even after the replacement exists,
      // so refresh once and retry only when the exact claim changed.
      const replacement = refreshRegisteredSession(sessionId);
      if (replacement && !sameRegistryClaim(replacement, registered)) {
        try {
          return trackExtUIState(await getBridgeSessionForClaim(replacement));
        } catch (replacementError) {
          bridgeError = replacementError;
          pruneUnreachableRegisteredSession(replacement, replacementError);
        }
      }

      const rpc = getRPCSession(sessionId);
      if (rpc?.alive) return trackExtUIState(rpc);
      throw bridgeError;
    }
  }
  const rpc = getRPCSession(sessionId);
  return rpc?.alive ? trackExtUIState(rpc) : null;
}

// Legacy Pi bridges and RPC sessions retain their established defaults.
// Protocol-v2 alternative wrappers are capability-deny-by-default: a future
// wrapper only gains an operation by advertising it explicitly.
function liveSessionSupports(sess, capability) {
  if (!(sess instanceof BridgeSession)) return true;
  return sess.harnessId === 'pi'
    ? sess.capabilities?.[capability] !== false
    : sess.capabilities?.[capability] === true;
}

// Extension UI is per-session state, but SSE connections come and go with
// every session switch in the client. Remember each live session's current
// widgets, statuses, and unresolved dialogs here so the stream route can
// replay them to a client that just (re)connected — the bridge only replays
// its state when *our* socket connects, which happens once per session.
// Attached once per session object; the state dies with the connection,
// matching the bridge-side replay on reconnect.
const EXT_UI_DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

function trackExtUIState(sess) {
  if (!sess || sess.extUIState) return sess;
  const state = { widgets: new Map(), statuses: new Map(), dialogs: new Map() };
  sess.extUIState = state;
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
  return sess;
}

/**
 * Where a live session's pi process runs, for the stats modal's "Running in"
 * row. Null for inactive sessions. Kinds:
 * - rpc: a headless child of this server (dies with it)
 * - tmux: a pi TUI in a tmux pane — socket from the bridge's own $TMUX stamp,
 *   else from our spawn placement, else found by walking the pid's ancestry
 *   across every server's panes (registry entries from older bridges carry
 *   no stamp); session/window resolved live (null fields when every lookup
 *   fails — the socket name alone still locates it)
 * - terminal: bridge-registered and genuinely outside tmux
 * RPC is checked first on purpose: RPC children also load the bridge and
 * inherit this server's own $TMUX, which would misreport them as tmux TUIs.
 *
 * The tmux/terminal resolution is cached per (sessionId, pid): every lookup
 * spawns tmux subprocesses (the pid-ancestry scan hits every server socket,
 * and a stale one costs its full 2s timeout), while a pi process never
 * changes panes. Keying on the pid recomputes after a close+resume; the TTL
 * only bounds how late a window/session *rename* shows up. A dead session
 * bypasses the cache entirely (reg gone → null before the lookup).
 */
const runtimeCache = new Map(); // sessionId -> { pid, at, value }
const RUNTIME_CACHE_TTL_MS = 60_000;

async function describeRuntime(sessionId) {
  const rpc = getRPCSession(sessionId);
  if (rpc?.alive) return { kind: 'rpc', pid: rpc.proc?.pid ?? null };
  const reg = getRegisteredSession(sessionId);
  if (!reg) return null;
  const cached = runtimeCache.get(sessionId);
  if (cached && cached.pid === (reg.pid ?? null) && Date.now() - cached.at < RUNTIME_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = await resolveRuntime(sessionId, reg);
  if (runtimeCache.size >= 200) runtimeCache.clear(); // live sessions number in the dozens
  runtimeCache.set(sessionId, { pid: reg.pid ?? null, at: Date.now(), value });
  return value;
}

async function resolveRuntime(sessionId, reg) {
  const spawn = tmux.getSpawn(sessionId);
  const socket = reg.tmux?.socket || spawn?.socket || null;
  if (socket) {
    const paneId = (reg.tmux?.socket ? reg.tmux.pane : spawn?.paneId) || null;
    let loc = paneId ? await tmux.paneLocation(socket, paneId) : null;
    let server = path.basename(socket);
    if (!loc) {
      // Stamp went stale (pane died/moved, unreachable socket) — locate the
      // process itself before settling for the bare server name.
      const pane = await tmux.findPaneByPid(reg.pid);
      if (pane) { loc = pane; server = path.basename(pane.socket); }
    }
    return {
      kind: 'tmux',
      pid: reg.pid ?? null,
      server,
      tmuxSession: loc?.tmuxSession ?? null,
      windowIndex: loc?.windowIndex ?? null,
      windowName: loc?.windowName ?? null,
    };
  }
  // No tmux stamp at all (registered by an older bridge, or $TMUX was unset
  // when pi started under a wrapper) — the process may still live in a tmux
  // pane; find it by pid ancestry before reporting a plain terminal.
  const pane = await tmux.findPaneByPid(reg.pid);
  if (pane) {
    return {
      kind: 'tmux',
      pid: reg.pid ?? null,
      server: path.basename(pane.socket),
      tmuxSession: pane.tmuxSession,
      windowIndex: pane.windowIndex,
      windowName: pane.windowName,
    };
  }
  return { kind: 'terminal', pid: reg.pid ?? null };
}

/**
 * The exact tmux pane a live session's pi runs in — for typing into the TUI
 * (the send-keys fallbacks). Same resolution order as resolveRuntime (bridge
 * $TMUX stamp → our spawn placement → pid-ancestry scan), but stamped
 * placements are verified against the server first so a stale stamp can't
 * swallow keystrokes. Null when the session isn't in tmux or can't be found.
 */
async function locatePiPane(sessionId) {
  const reg = getRegisteredSession(sessionId);
  if (!reg) return null;
  const candidates = [];
  if (reg.tmux?.socket && reg.tmux.pane) candidates.push({ socket: reg.tmux.socket, paneId: reg.tmux.pane });
  const spawn = tmux.getSpawn(sessionId);
  if (spawn?.socket && spawn.paneId) candidates.push({ socket: spawn.socket, paneId: spawn.paneId });
  for (const c of candidates) {
    if (await tmux.paneExists(c.socket, c.paneId)) return c;
  }
  return tmux.findPaneByPid(reg.pid);
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
  const contextWindow = getContextWindow(info.model);
  const contextPercent = info.contextTokens > 0
    ? Math.min(100, Math.floor(info.contextTokens / contextWindow * 100))
    : 0;
  return { ...info, contextWindow, contextPercent };
}

function parseSessionFile(filePath) {
  return withContext(getSessionInfo(filePath));
}

// =========================================================================
// Session listing
// =========================================================================

/**
 * The one session-summary shape both backends produce — a field added here
 * lands for bridge and RPC sessions alike (the two used to be separate
 * object literals that could silently drift apart).
 */
function activeSessionEntry(v) {
  return {
    id: v.id,
    sessionKey: v.sessionKey,
    harnessId: v.harnessId || 'pi',
    harnessLabel: v.harnessLabel || 'Pi',
    nativeSessionId: v.nativeSessionId || v.id,
    capabilities: v.capabilities || sessionCapabilities('pi', {}, { active: true }),
    closeMode: v.closeMode || 'logical',
    conflicted: !!v.conflicted,
    liveInstanceCount: v.liveInstanceCount || 1,
    name: v.name || 'New Session',
    model: v.model || 'unknown',
    contextPercent: roundPercent(v.percent) ?? 0,
    contextTokens: v.tokens ?? 0,
    contextWindow: v.contextWindow || 0,
    thinkingLevel: v.thinkingLevel || null,
    messageCount: v.messageCount || 0,
    lastActivity: v.lastActivity,
    isActive: true,
    turnInProgress: !!v.turnInProgress,
    compacting: !!v.compacting,
    cwd: v.cwd || null,
    sessionFile: v.sessionFile || null,
    parentSession: v.parentSession || null,
    pid: v.pid || null,
  };
}

/**
 * Active sessions = sessions registered by the pi-dish-bridge extension.
 * We enrich the registry entry with metadata from the on-disk JSONL.
 */
function getActiveSessions(registered = listRegisteredSessions()) {
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
    const identityFields = sessionIdentityFields(identity.harnessId, identity.nativeSessionId);
    const ownedSpawn = tmux.getSpawn(routeId);
    let info = {};
    if (reg.sessionFile && fs.existsSync(reg.sessionFile)) {
      try {
        const source = sourceForIdentity(identity.harnessId, identity.nativeSessionId, reg.sessionFile);
        info = parseSessionFile(source);
      } catch {}
    }
    // The bridge reports the session's actual context usage (tokens, window,
    // percent) straight from pi — always prefer it over JSONL guesswork.
    const usage = reg.contextUsage || null;
    active.push(activeSessionEntry({
      ...identityFields,
      capabilities: sessionCapabilities(identity.harnessId, reg.capabilities || {}, {
        active: true,
        conflicted,
        closeAllowed: spawnAllowsClientDetach(ownedSpawn, reg),
      }),
      closeMode: getHarness(identity.harnessId).closeMode,
      conflicted,
      liveInstanceCount: instances.length,
      name: reg.name || info.name,
      model: reg.model || info.model,
      percent: usage?.percent ?? info.contextPercent,
      tokens: usage?.tokens ?? info.contextTokens,
      contextWindow: usage?.contextWindow || getContextWindow(reg.model || info.model),
      thinkingLevel: reg.thinkingLevel,
      messageCount: info.messageCount,
      // Stable fallbacks only — a fresh `new Date()` per poll would make
      // isUnreadSession() flag the session unread forever and churn the sort.
      lastActivity: info.lastActivity || reg.updatedAt || new Date(0),
      turnInProgress: reg.turnInProgress,
      compacting: reg.compacting,
      cwd: reg.cwd || info.cwd,
      sessionFile: reg.sessionFile,
      parentSession: info.parentSession,
      pid: reg.pid,
    }));
    seen.add(routeId);
  }

  // Sessions spawned by pi-dish via RPC may not be visible through the bridge
  // extension in all pi versions/modes. Include them directly so a freshly
  // created UI session still shows its resolved default model and remains
  // model-switchable.
  for (const rpc of getAllRPCSessions()) {
    if (!rpc.alive || seen.has(rpc.id)) continue;
    const state = rpc.state || {};
    const usage = rpc.lastStats?.contextUsage || null;
    let info = {};
    const rpcFile = rpc.sessionFile || state.sessionFile;
    if (rpcFile && fs.existsSync(rpcFile)) {
      try { info = parseSessionFile(rpcFile); } catch {}
    }
    active.push(activeSessionEntry({
      ...sessionIdentityFields('pi', rpc.id),
      capabilities: sessionCapabilities('pi', {}, { active: true }),
      name: state.sessionName || state.name,
      model: formatModelRef(state.model) || formatModelRef(rpc.model),
      percent: usage?.percent,
      tokens: usage?.tokens,
      contextWindow: usage?.contextWindow || state.model?.contextWindow,
      thinkingLevel: state.thinkingLevel,
      messageCount: state.messageCount,
      lastActivity: rpc.lastActivityAt,
      turnInProgress: rpc.turnInProgress,
      compacting: rpc.compacting,
      cwd: rpc.cwd,
      sessionFile: rpcFile,
      parentSession: info.parentSession,
      pid: rpc.proc?.pid,
    }));
    seen.add(rpc.id);
  }

  active.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  return active;
}

// Returns { previous, indexing } — with `indexing` true the session index is
// still backfilling (first boot over a large corpus) and `previous` holds
// only the sessions indexed so far; callers surface the flag so the client
// can re-poll instead of mistaking the partial list for the whole one.
function getPreviousSessions(registered = listRegisteredSessions()) {
  const activeIds = new Set([
    ...registered.map((r) => {
      const identity = registryIdentity(r);
      return identity ? routeSessionId(identity.harnessId, identity.nativeSessionId) : null;
    }).filter(Boolean),
    ...getAllRPCSessions().filter(s => s.alive).map(s => s.id),
  ]);
  const candidates = []; // { file, id, dirName }
  const previous = [];
  let indexing = false;
  let discoveryTruncated = false;
  let discoverySkipped = 0;

  try {
    const discovery = discoverHarnessSessions();
    candidates.push(...discovery.candidates.filter(candidate =>
      !activeIds.has(routeSessionId(candidate.harnessId, candidate.nativeSessionId))));
    refreshSessionFileCache(discovery.candidates);
    discoveryTruncated = discovery.truncated;
    discoverySkipped = discovery.skipped;

    const scan = sessionIndex.scanSessions(candidates);
    indexing = scan.indexing;
    for (const candidate of candidates) {
      const { file, id, dirName, harnessId, nativeSessionId } = candidate;
      rememberSessionSource(candidate);
      const raw = scan.infos.get(file);
      if (!raw) continue; // unreadable, or still queued for background indexing
      const info = withContext(raw);
      // The dir-name decode is lossy (every '-' becomes '/'), so a
      // hyphenated project dir decodes to a bogus path — only trust it
      // when the decoded directory actually exists.
      let cwd = info.cwd;
      if (!cwd && harnessId === 'pi' && getHarness(harnessId)?.layout === 'nested') {
        const decoded = decodeDirToCwd(dirName);
        cwd = fs.existsSync(decoded) ? decoded : null;
      }
      previous.push({
        ...sessionIdentityFields(harnessId, nativeSessionId),
        capabilities: sessionCapabilities(harnessId, {}, { active: false }),
        closeMode: getHarness(harnessId).closeMode,
        profileId: candidate.profileId,
        profileVersion: candidate.profileVersion,
        name: info.name || id.slice(0, 8),
        model: info.model || 'unknown',
        contextPercent: info.contextPercent || 0,
        contextTokens: info.contextTokens || 0,
        messageCount: info.messageCount || 0,
        lastActivity: info.lastActivity,
        isActive: false,
        cwd,
        sessionFile: file,
        parentSession: info.parentSession || null,
      });
    }
  } catch (e) {
    console.error('Error scanning sessions:', e);
  }

  previous.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  return { previous, indexing, discoveryTruncated, discoverySkipped };
}

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
// speak the shared grammar (parseSessionQuery in helpers.js): negations and
// field terms are metadata-only, so only positive plain terms can justify
// the content read.
function matchSessionQuery(session, parsed) {
  if (evaluateSessionQuery(parsed, session)) return {};
  const contentTokens = positiveQueryTokens(parsed);
  if (contentTokens.length && session.sessionFile) {
    const historyText = sessionIndex.getSearchText(sourceForIdentity(
      session.harnessId || 'pi', session.nativeSessionId || session.id, session.sessionFile));
    if (evaluateSessionQuery(parsed, session, historyText)) {
      return { snippet: buildSnippet(historyText, contentTokens), text: historyText };
    }
  }
  return null;
}

// Results are relevance-ordered (scoreSessionMatch in helpers.js), recency
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
      session.harnessId || 'pi', session.nativeSessionId || session.id, session.sessionFile)) : null);
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
// the result.
// Relationship hints on list rows are presentation-only. They let the client
// arrange same-workspace families without fetching /related for every row;
// they never grant control authority. Native Pi lineage wins when both exist.
function annotateSessionParents(list) {
  const launches = sessionProvenance.readLaunches();
  const byCanonicalPath = new Map();
  const byId = new Map(list.map(session => [session.id, session]));
  for (const session of list) {
    const canonical = canonicalSessionPath(session.sessionFile);
    if (canonical) byCanonicalPath.set(canonical, session);
  }
  for (const session of list) {
    let nativeParent = null;
    if (session.parentSession && session.sessionFile) {
      const parentFile = path.isAbsolute(session.parentSession)
        ? session.parentSession : path.resolve(path.dirname(session.sessionFile), session.parentSession);
      // A basename alone is not lineage: stale paths must not attach a child
      // to an unrelated current session that happens to reuse the same id.
      nativeParent = byCanonicalPath.get(canonicalSessionPath(parentFile))?.id || null;
    }
    const launchParent = launches[session.id]?.sourceSessionId || null;
    const parentId = nativeParent || launchParent;
    session.parentId = parentId && parentId !== session.id ? parentId : null;
    session.parentSource = nativeParent
      ? 'pi-session-header' : launchParent ? 'pi-dish-launch' : null;
    const parent = byId.get(session.parentId);
    session.familyParentId = parent && (parent.cwd || '~') === (session.cwd || '~')
      ? parent.id : null;
  }
}

app.get('/api/sessions', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  const registered = listRegisteredSessions();
  let active = getActiveSessions(registered);
  let previous = [], indexing = false, discoveryTruncated = false, discoverySkipped = 0;
  if (req.query.active !== '1') {
    ({ previous, indexing, discoveryTruncated, discoverySkipped } = getPreviousSessions(registered));
  }
  annotateSessionParents([...active, ...previous]);

  if (query) {
    active = filterSessionsByQuery(active, query);
    previous = filterSessionsByQuery(previous, query);
  }
  res.json({ active, previous, indexing, discoveryTruncated, discoverySkipped });
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
    lastActivity: session.lastActivity,
  };
}

function buildSessionCatalog() {
  const registered = listRegisteredSessions();
  const active = getActiveSessions(registered);
  const historical = getPreviousSessions(registered);
  const list = [...active, ...historical.previous];
  const byId = new Map(list.map(session => [session.id, session]));
  const byPath = new Map();
  for (const session of list) {
    const canonical = canonicalSessionPath(session.sessionFile);
    if (canonical) byPath.set(canonical, session);
  }
  return {
    list, byId, byPath,
    indexing: historical.indexing,
    discoveryTruncated: historical.discoveryTruncated,
    discoverySkipped: historical.discoverySkipped,
  };
}

// Advisory relationships only: Pi's native parentSession header and
// pi-dish-side launch provenance. Neither implies ownership or control rights.
app.get('/api/sessions/:id/related', (req, res) => {
  try {
    const catalog = buildSessionCatalog();
    let current = catalog.byId.get(req.params.id);
    if (!current) {
      const candidate = resolveSessionCandidate(req.params.id);
      if (!candidate) return res.status(404).json({ error: 'Session not found' });
      const info = parseSessionFile(candidate);
      current = {
        id: apiIdForCandidate(candidate),
        sessionKey: candidate.sessionKey,
        harnessId: candidate.harnessId,
        nativeSessionId: candidate.nativeSessionId,
        name: info.name || candidate.nativeSessionId.slice(0, 8),
        cwd: info.cwd,
        model: info.model,
        lastActivity: info.lastActivity,
        isActive: false,
        sessionFile: candidate.file,
        parentSession: info.parentSession,
      };
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

    add('parent', 'pi-session-header', resolveParent(current));
    for (const candidate of catalog.list) {
      if (resolveParent(candidate)?.id === current.id) add('child', 'pi-session-header', candidate);
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
  const registered = listRegisteredSessions();
  const active = getActiveSessions(registered);
  const { previous, indexing, discoveryTruncated, discoverySkipped } = getPreviousSessions(registered);
  const parsed = parseSessionQuery(query);
  const scopeParsed = parseSessionQuery(scopeQuery);
  const hasScope = scopeParsed.terms.length || scopeParsed.since !== null || scopeParsed.before !== null;
  const contentTokens = positiveQueryTokens(parsed);
  const results = [];
  let hiddenByScopes = 0;
  for (const session of [...active, ...previous]) {
    let text = null;
    if (!evaluateSessionQuery(parsed, session)) {
      if (!contentTokens.length || !session.sessionFile) continue;
      text = sessionIndex.getSearchText(sourceForIdentity(
        session.harnessId || 'pi', session.nativeSessionId || session.id, session.sessionFile));
      if (!evaluateSessionQuery(parsed, session, text)) continue;
    }
    if (hasScope && !evaluateSessionQuery(scopeParsed, session)) {
      hiddenByScopes++;
      continue;
    }
    let snippets = [], matchCount = 0;
    if (contentTokens.length && session.sessionFile) {
      text ??= sessionIndex.getSearchText(sourceForIdentity(
        session.harnessId || 'pi', session.nativeSessionId || session.id, session.sessionFile));
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
    const unavailable = from.costUnavailable?.[k] || 0;
    to.costUnavailable[k] += unavailable;
    const value = from.costs?.[k];
    if (unavailable || !Number.isFinite(value)) to.costs[k] = null;
    else if (to.costs[k] !== null) to.costs[k] += value;
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
  await refreshHarnessPricing('omp');
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
    b.priced = Number.isFinite(b.costs.total);
    b.unpricedCalls = b.costUnavailable.total;
    // The bottom-of-view notice reflects the filtered totals; the facet list
    // keeps every model's own unavailable annotation.
    if (!modelFilter || modelFilter.has(ref)) unpricedModelCalls += b.unpricedCalls;
  }
  for (const bucket of [...byWorkspace.values(), ...bySession.values()]) {
    bucket.priced = Number.isFinite(bucket.costs.total);
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
  const headlineCostUnavailable = Object.fromEntries(Object.entries(headlineUsage).map(([key, bucket]) => [key, bucket.costUnavailable.total]));
  res.json({ range, sort, models: modelFilter ? [...modelFilter] : null, totals, groups: { models: top(byModel), workspaces: top(byWorkspace), sessions: [...bySession.values()].sort(compare).slice(0, 20) }, headlineCosts, headlineCostUnavailable, daily, unpricedModelCalls, indexing: scan.indexing, discoveryTruncated: discovery.truncated, discoverySkipped: discovery.skipped, monthlyBudgetUsd: readDishSettings().monthlyBudgetUsd ?? null });
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
    const { previous } = getPreviousSessions();
    for (const s of previous) if (s.cwd) cwds.add(s.cwd);
    for (const s of getActiveSessions()) if (s.cwd) cwds.add(s.cwd);
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
      const file = findSessionFile(latest.sessionId);
      if (file) latest = { ...latest, name: getSessionInfo(file).name || null };
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

function settingsForClient(settings = readDishSettings()) {
  return {
    monthlyBudgetUsd: settings.monthlyBudgetUsd ?? null,
    savedFilters: sanitizeSavedFilters(settings.savedFilters) || [],
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
  try {
    fs.mkdirSync(path.dirname(DISH_SETTINGS_FILE), { recursive: true });
    const tmp = `${DISH_SETTINGS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n'); fs.renameSync(tmp, DISH_SETTINGS_FILE);
    res.json(settingsForClient(settings));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Historical image blocks can be megabytes. Keep those bytes out of the
// paginated JSON so the browser can decode/cache them as resources and defer
// off-screen images with loading=lazy. Streaming events still carry inline
// data; only authoritative JSONL-backed responses are projected this way.
const VALID_ENTRY_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;

function messageForClient(sessionId, message, index) {
  if (!Array.isArray(message.content)) return { ...message, index };
  let changed = false;
  // Current Pi JSONL entries have collision-checked IDs. Keep the positional
  // fallback for legacy pre-tree sessions, whose append-only stream cannot be
  // reshuffled by branch navigation.
  const resourceId = typeof message.id === 'string' && VALID_ENTRY_ID_RE.test(message.id)
    ? message.id : String(index);
  const content = message.content.map((block, blockIndex) => {
    if (!block || block.type !== 'image' || typeof block.data !== 'string' || !block.data) return block;
    changed = true;
    const { data, ...metadata } = block;
    return {
      ...metadata,
      mimeType: block.mimeType || 'image/png',
      url: `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(resourceId)}/images/${blockIndex}`,
    };
  });
  return { ...message, ...(changed ? { content } : {}), index };
}

app.get('/api/sessions/:id/messages/:messageId/images/:blockIndex', (req, res) => {
  const messageId = req.params.messageId;
  const blockIndex = Number(req.params.blockIndex);
  if (!VALID_ENTRY_ID_RE.test(messageId) || !Number.isInteger(blockIndex) || blockIndex < 0) {
    return res.status(400).json({ error: 'valid message id and image index required' });
  }
  const session = findSessionSource(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  let message = readSessionMessageById(session, messageId);
  // Nearly-free compatibility for URLs emitted for legacy id-less sessions.
  if (!message && /^\d+$/.test(messageId)) {
    const legacyIndex = Number(messageId);
    if (Number.isSafeInteger(legacyIndex)) message = readSessionMessages(session)[legacyIndex];
  }
  const block = message?.content?.[blockIndex];
  if (!block || block.type !== 'image' || typeof block.data !== 'string' || !block.data) {
    return res.status(404).json({ error: 'Image not found' });
  }
  const mimeType = /^image\/[A-Za-z0-9.+-]+$/.test(block.mimeType || '') ? block.mimeType : 'image/png';
  res.setHeader('Cache-Control', 'private, no-cache');
  res.type(mimeType).send(Buffer.from(block.data, 'base64'));
});

app.get('/api/sessions/:id/messages', async (req, res) => {
  const sessionId = req.params.id;
  const isActive = !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId);

  const sessionSource = findSessionSource(sessionId);
  if (!sessionSource) {
    return res.json({
      messages: [], session: { id: sessionId, isActive },
      totalMessages: 0, firstIndex: null, lastIndex: null, hasMore: false,
    });
  }
  if (sessionSource.harnessId === 'omp') await refreshHarnessPricing('omp');

  // Pagination: messages are indexed by their position in the displayable
  // message stream (0-based). `limit` defaults to 50. With no cursor we
  // return the tail. `before=<idx>` returns messages with index < idx.
  // `after=<idx>` returns messages with index > idx (no limit; for
  // incremental catch-up after a turn ends).
  // Coerce non-numeric cursors to null so they fall through to the tail
  // branch. A NaN cursor otherwise slips past the startIdx>endIdx guard
  // (NaN comparisons are false) and slice(NaN,…) returns the whole session.
  const cursor = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 50));
  const before = req.query.before != null ? cursor(req.query.before) : null;
  const after = req.query.after != null ? cursor(req.query.after) : null;

  const routeId = apiIdForCandidate(sessionSource);
  const identity = sessionIdentityFields(sessionSource.harnessId, sessionSource.nativeSessionId);
  const info = parseSessionFile(sessionSource);
  // Overlay live context usage when the session can report it.
  const liveUsage = getLiveContextUsage(sessionId);
  if (liveUsage) {
    if (liveUsage.tokens != null) info.contextTokens = liveUsage.tokens;
    if (liveUsage.percent != null) info.contextPercent = roundPercent(liveUsage.percent);
    if (liveUsage.contextWindow) info.contextWindow = liveUsage.contextWindow;
  }
  const all = readSessionMessages(sessionSource);
  const totalMessages = all.length;
  let startIdx, endIdx; // inclusive
  if (after != null) {
    startIdx = after + 1;
    endIdx = totalMessages - 1;
  } else if (before != null) {
    endIdx = before - 1;
    startIdx = Math.max(0, endIdx - limit + 1);
  } else {
    endIdx = totalMessages - 1;
    startIdx = Math.max(0, endIdx - limit + 1);
  }
  if (startIdx > endIdx || totalMessages === 0) {
    return res.json({
      messages: [],
      session: { ...identity, isActive, ...info },
      totalMessages,
      firstIndex: null,
      lastIndex: null,
      hasMore: startIdx > 0 && totalMessages > 0,
    });
  }

  const slice = all.slice(startIdx, endIdx + 1)
    .map((m, i) => messageForClient(routeId, m, startIdx + i));
  res.json({
    messages: slice,
    session: { ...identity, isActive, ...info },
    totalMessages,
    firstIndex: startIdx,
    lastIndex: endIdx,
    hasMore: startIdx > 0,
  });
});

// In-session text search: by default, returns the stream indexes of messages
// whose text content matches all whitespace-separated tokens (case-insensitive).
// `mode=any` is the explicit advanced-search click-through contract: the
// advanced result already proved session-wide AND, and this mode returns each
// relevant message when those terms are distributed through the transcript.
app.get('/api/sessions/:id/search', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  if (!query) return res.json({ matches: [], totalMessages: 0 });
  const mode = String(req.query.mode || 'message');
  if (mode !== 'message' && mode !== 'any') {
    return res.status(400).json({ error: 'mode must be message or any' });
  }
  const session = findSessionSource(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const tokens = query.split(/\s+/).filter(Boolean);
  const all = readSessionMessages(session);
  const matches = [];
  for (let i = 0; i < all.length; i++) {
    const text = extractTextContent(all[i].content).toLowerCase();
    const matched = mode === 'any'
      ? tokens.some(t => text.includes(t))
      : tokens.every(t => text.includes(t));
    if (text && matched) matches.push({ index: i, role: all[i].role });
  }
  res.json({ matches, totalMessages: all.length });
});

// Normalize client-sent attachments to pi's ImageContent shape, dropping
// anything malformed rather than failing the whole prompt.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function sanitizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((i) => i && typeof i.data === 'string' && BASE64_RE.test(i.data) && typeof i.mimeType === 'string' && i.mimeType.startsWith('image/'))
    .map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType }));
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
    const result = await sess.prompt(message || '', opts);
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
    const result = await sess.steer(message || '', images.length ? { images } : {});
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
    const result = await sess.prompt(message || '', opts);
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
  if (!THINKING_LEVEL_NAMES.includes(level)) {
    return res.status(400).json({ error: `level must be one of: ${THINKING_LEVEL_NAMES.join(', ')}` });
  }
  try {
    const sess = await getLiveSession(req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session not active' });
    if (!liveSessionSupports(sess, 'setThinking')) {
      return res.status(409).json({ error: 'This session does not support changing thinking level.' });
    }
    const data = await sess.setThinkingLevel(level);
    res.json({ success: true, level: data?.level ?? level });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Aggregate token/cost stats: sum assistant usage from the JSONL and overlay
// live context usage when a backend reports it. One path for every backend —
// an earlier RPC short-circuit returned pi's raw get_session_stats shape,
// which the stats modal doesn't read (it expects the fields built below), and
// it re-rolled the bridge-vs-RPC dispatch that belongs in getLiveSession.
app.get('/api/sessions/:id/stats', async (req, res) => {
  const sessionId = req.params.id;
  try {
    const session = findSessionSource(sessionId);
    if (!session) {
      if (liveSessionHistoryPending(sessionId)) {
        return res.status(409).json({ error: 'Session has no persisted history yet' });
      }
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.harnessId === 'omp') await refreshHarnessPricing('omp');

    const { tokens, reasoningTokens, cost, costs, costUnavailable, responseTiming, userMessages, assistantMessages, toolCalls, toolResults, genMs, genOutput } =
      getSessionStats(session);

    const reg = getRegisteredSession(sessionId);
    const contextUsage = getLiveContextUsage(sessionId);
    const info = parseSessionFile(session);
    res.json({
      sessionFile: session.file,
      sessionId: apiIdForCandidate(session),
      ...sessionIdentityFields(session.harnessId, session.nativeSessionId),
      runtime: await describeRuntime(sessionId),
      cwd: reg?.cwd || info.cwd || null,
      model: reg?.model || info.model || null,
      thinkingLevel: reg?.thinkingLevel || null,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: userMessages + assistantMessages + toolResults,
      tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite },
      cost,
      costs,
      costUnavailable,
      reasoningTokens,
      responseTiming,
      genMs,
      genOutput,
      contextUsage: contextUsage || {
        tokens: info.contextTokens || null,
        contextWindow: info.contextWindow,
        percent: info.contextPercent ?? null,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export any session (active or not) to a standalone HTML file.
app.get('/api/sessions/:id/export', async (req, res) => {
  try {
    const session = findSessionSource(req.params.id);
    if (!session) {
      if (liveSessionHistoryPending(req.params.id)) {
        return res.status(409).json({ error: 'Session has no persisted history yet' });
      }
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.harnessId !== 'pi' && session.harnessId !== 'omp') {
      return res.status(409).json({ error: 'HTML export is only supported for Pi and OMP sessions.' });
    }
    const sessionFile = session.file;
    const outPath = path.join(os.tmpdir(), `pi-dish-export-${req.params.id.slice(-12)}.html`);
    const htmlPath = await piSDK.exportSessionHtml(sessionFile, outPath, session.profileId);
    res.download(htmlPath, path.basename(sessionFile, '.jsonl') + '.html');
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =========================================================================
// Public read-only share links
// =========================================================================
//
// A share is a random token mapping to a sessionId (lib/shares.js). The
// management API below is authed (main app only); the public GET /share/:token
// renders the standalone HTML export inline and is mounted on both the main app
// and the optional share listener (see startup). The route reveals nothing
// about unknown/missing sessions — every miss is a bare 404.

// { path, url } for a token. url is set only when PI_DISH_SHARE_BASE_URL is,
// so operators behind a proxy can hand out an absolute link.
function sharePayload(token) {
  const sharePath = `/share/${token}`;
  const base = process.env.PI_DISH_SHARE_BASE_URL;
  const url = base ? base.replace(/\/+$/, '') + sharePath : null;
  return { token, path: sharePath, url };
}

// Per-token export cache keyed on the JSONL's (mtimeMs, size), so repeated
// hits on an unchanged session don't re-run the exporter.
const shareExportCache = new Map();

async function serveSharedSession(req, res) {
  const share = shares.getShare(req.params.token);
  if (!share) return res.status(404).type('text/plain').send('Not found');
  const session = findSessionSource(share.sessionId);
  if (!session || (session.harnessId !== 'pi' && session.harnessId !== 'omp')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  const sessionFile = session.file;
  try {
    const st = fs.statSync(sessionFile);
    const cached = shareExportCache.get(req.params.token);
    let htmlPath;
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size && fs.existsSync(cached.htmlPath)) {
      htmlPath = cached.htmlPath;
    } else {
      // Token is base64url (A-Za-z0-9_-), so it's already a safe basename.
      const outPath = path.join(os.tmpdir(), `pi-dish-share-${req.params.token}.html`);
      htmlPath = await piSDK.exportSessionHtml(sessionFile, outPath, session.profileId);
      shareExportCache.set(req.params.token, { mtimeMs: st.mtimeMs, size: st.size, htmlPath });
    }
    res.type('html');
    res.sendFile(htmlPath);
  } catch (e) {
    res.status(500).type('text/plain').send('Export failed');
  }
}

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
  res.json({ revoked });
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
    if (!page) return null;
    return {
      kind: 'page', pageToken, root: page.root,
      title: page.title || null, anchor,
    };
  }
  return null;
}

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
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const open = comments.listComments({ sessionId, state: 'open' });
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
  const { path: rawPath, title, sessionId } = req.body || {};
  const hasSessionId = Object.prototype.hasOwnProperty.call(req.body || {}, 'sessionId');
  if (typeof rawPath !== 'string' || !rawPath) {
    return res.status(400).json({ error: 'path required' });
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
  const token = pages.createPage({ root, title: title || null, sessionId: associatedSessionId || null });
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

function servePage(req, res, annotate = false) {
  const entry = pages.getPage(req.params.token);
  if (!entry) return res.status(404).type('text/plain').send('Not found');
  const notFound = () => { if (!res.headersSent) res.status(404).type('text/plain').send('Not found'); };
  let stat;
  try { stat = fs.statSync(entry.root); } catch { return notFound(); }
  // Non-strict routing sends /page/:token/ to the bare route too — read the
  // trailing slash off the real path or the redirect below would loop.
  const rest = req.params[0] || (req.path.endsWith('/') ? '/' : '');

  if (stat.isFile()) {
    if (rest) return notFound(); // a file page has no sub-paths
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

// /reload against a bridge session, with two Pi-only escape hatches:
// - Bridges that fire the reload in the same tick as their run_command
//   response lose the response frame to their own socket teardown — a
//   "socket closed" rejection on /reload specifically is the signature of a
//   reload that *started*, not a failure. Report success; the bridge
//   re-registers itself after re-evaluating.
// - Bridges that can't run it at all (no emulated reload / no captured
//   AgentSession — exactly the state a running TUI is in when its loaded
//   bridge predates the current one) fall back to typing /reload into the
//   Pi session's own tmux pane, when one can be located. That's also the only
//   path that can upgrade an out-of-date Pi bridge from the UI. Alternate
//   wrappers fail closed: their public API profile is the lifecycle authority.
async function reloadBridgeSession(sess, sessionId) {
  try {
    const data = await sess.runCommand('/reload');
    return { info: data?.info || 'Reloading extensions…' };
  } catch (e) {
    if (/socket closed/i.test(e?.message || '')) return { info: 'Reloading extensions…' };
    if (sess.harnessId !== 'pi') {
      e.statusCode = 409;
      throw e;
    }
    const pane = await locatePiPane(sessionId);
    if (!pane) throw e;
    await tmux.sendKeys(pane.socket, pane.paneId, '/reload');
    return { info: 'Sent /reload to the session’s tmux pane' };
  }
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
      if (!liveSessionSupports(sess, 'commands')) {
        return res.status(409).json({ error: 'This session does not support remote commands.' });
      }
      if (message.trim() === '/reload') {
        if (!liveSessionSupports(sess, 'reload')) {
          return res.status(409).json({ error: 'This session does not support remote extension reload.' });
        }
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
      return res.json({ success: true });
    }
    // Inactive session: append a session_info entry to the JSONL directly.
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

app.get('/api/sessions/:id/tree', async (req, res) => {
  try {
    const session = findSessionSource(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.harnessId !== 'pi') {
      return res.status(409).json({ error: 'Session tree navigation is only supported for Pi.' });
    }
    const tree = await piSDK.getSessionTree(session.file);
    res.json(tree);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
    if (identity.harnessId !== 'pi') {
      return res.status(409).json({ error: 'Session tree navigation is only supported for Pi.' });
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
        const data = await navigateLiveTree(req.params.id, sess, entryId, opts);
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
        throw e;
      }
    }
    if (!source) return res.status(404).json({ error: 'Session not found' });
    const result = await piSDK.branchSession(source.file, entryId, opts);
    res.json({ success: true, editorText: result.editorText });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let modelsCache = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 60000;

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

function harnessLaunchSpec(descriptor) {
  return descriptor.id === 'pi' ? getPiLaunchSpec() : resolveLaunchSpec(descriptor);
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

function runHarnessJsonCommand(descriptor, commandArgs, { cwd } = {}) {
  const spec = harnessLaunchSpec(descriptor);
  const args = [...spec.argv.slice(1), ...commandArgs];
  return new Promise((resolve, reject) => {
    execFile(spec.argv[0], args, {
      env: { ...process.env, ...spec.env },
      cwd: resolveHarnessCwd(cwd),
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim()));
      try {
        resolve(JSON.parse(stdout.trim() || '{}'));
      } catch (parseError) {
        reject(new Error(`Could not parse ${descriptor.label} command output: ${parseError.message}`));
      }
    });
  });
}

async function runHarnessModelCommand(descriptor, { cwd } = {}) {
  const parsed = await runHarnessJsonCommand(descriptor, descriptor.argv.models, { cwd });
  return normalizeModels(parsed.models || parsed);
}

// OMP loads dotenv files in this order after process.env: <cwd>/.env,
// ~/.omp/agent/.env, ~/.omp/.env, ~/.env. We need only presence, so parse
// names directly and discard each line's value without ever putting it in an
// API object or log message.
function dotenvPresentKeys(file) {
  const keys = new Set();
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return keys; }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let raw = match[2].trim();
    if (!raw) continue;
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    } else {
      raw = raw.replace(/\s+#.*$/, '').trim();
    }
    if (raw) keys.add(match[1]);
  }
  return keys;
}

function providerCredentialKeys(descriptor, provider) {
  if (Object.hasOwn(descriptor.providerCredentials || {}, provider)) {
    return descriptor.providerCredentials[provider];
  }
  const conventional = String(provider || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return conventional ? [`${conventional}_API_KEY`] : [];
}

function providerReadiness(descriptor, providers, cwd) {
  const home = process.env.HOME || os.homedir();
  const files = [
    path.join(resolveHarnessCwd(cwd), '.env'),
    path.join(home, '.omp', 'agent', '.env'),
    path.join(home, '.omp', '.env'),
    path.join(home, '.env'),
  ];
  const fileKeys = new Set();
  for (const file of files) {
    for (const key of dotenvPresentKeys(file)) fileKeys.add(key);
  }
  return Object.fromEntries([...new Set(providers)].map(provider => {
    const keys = providerCredentialKeys(descriptor, provider);
    // An explicitly empty key list denotes a keyless local provider. null
    // means the provider has no environment-based readiness signal.
    const present = Array.isArray(keys) && (keys.length === 0 || keys.some(key => !!process.env[key] || fileKeys.has(key)));
    return [provider, present];
  }));
}

function annotateProviderReadiness(descriptor, models, cwd) {
  if (!descriptor.providerCredentials) return models;
  const readiness = providerReadiness(descriptor, models.map(model => model.provider), cwd);
  return models.map(model => ({ ...model, providerReady: readiness[model.provider] === true }));
}

async function readHarnessPilotConfig(descriptor, cwd) {
  const keys = descriptor.pilotConfig;
  if (!keys || typeof descriptor.argv.configGet !== 'function') return null;
  const [rolesResult, thinkingResult] = await Promise.all([
    runHarnessJsonCommand(descriptor, descriptor.argv.configGet(keys.modelRoles), { cwd }),
    runHarnessJsonCommand(descriptor, descriptor.argv.configGet(keys.defaultThinkingLevel), { cwd }),
  ]);
  const defaultModel = typeof rolesResult?.value?.default === 'string'
    ? rolesResult.value.default : null;
  const defaultThinkingLevel = typeof thinkingResult?.value === 'string'
    ? thinkingResult.value : null;
  return { defaultModel, defaultThinkingLevel };
}

app.get('/api/harnesses', (_req, res) => {
  res.json({
    harnesses: listHarnesses().map(descriptor => ({
      id: descriptor.id,
      label: descriptor.label,
      available: harnessCommandAvailable(descriptor),
      rpcFallback: descriptor.rpcFallback,
      closeMode: descriptor.closeMode,
    })),
  });
});

app.get('/api/harnesses/:id/readiness', async (req, res) => {
  const descriptor = getHarness(req.params.id);
  if (!descriptor) return res.status(404).json({ error: 'Unknown harness' });
  if (!descriptor.providerCredentials || descriptor.modelCatalog !== 'command') {
    return res.status(501).json({ error: `Provider readiness is not supported for ${descriptor.label}.` });
  }
  if (req.query.cwd !== undefined && typeof req.query.cwd !== 'string') {
    return res.status(400).json({ error: 'cwd must be a string' });
  }
  try {
    const models = await runHarnessModelCommand(descriptor, { cwd: req.query.cwd });
    res.json({ providers: providerReadiness(descriptor, models.map(model => model.provider), req.query.cwd) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

app.get('/api/models', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (sessionId) {
      const identity = routeIdentity(sessionId);
      if (!identity) return res.status(400).json({ error: 'Invalid session ID' });
      const sessionModels = await getSessionModels(sessionId);
      if (sessionModels) {
        return res.json(identity.harnessId === 'pi' ? annotateEnabled(sessionModels) : sessionModels);
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
      const models = await runHarnessModelCommand(descriptor, { cwd: req.query.cwd });
      return res.json(annotateProviderReadiness(descriptor, models, req.query.cwd));
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
  model: 'setModel',
  name: 'rename',
  thinking: 'setThinking',
  abort: 'abort',
  reload: 'reload',
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
          if (data?.commands) return res.json(filterBridgeCommands(sess, data.commands));
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

// Close a live session: shut its pi process down (the JSONL stays resumable).
// RPC children get RPCSession.kill(); anything bridge-registered — including
// tmux TUIs pi-dish didn't spawn — gets SIGTERM to the registry pid. Both pi
// modes treat SIGTERM as a graceful shutdown that runs extension cleanup, so
// the bridge unlinks its own registry entry/socket and, in tmux, only pi dies
// (the surrounding shell/window survives). Respond only once the process has
// actually exited, so the next sessions poll can't show it as still live; no
// SIGKILL escalation — a hung pi is for the user to inspect, not to lose.
app.post('/api/sessions/:id/close', async (req, res) => {
  const sessionId = req.params.id;
  const route = routeIdentity(sessionId);
  if (!route) return res.status(400).json({ error: 'Invalid session ID' });
  const descriptor = getHarness(route.harnessId);
  if (!descriptor || descriptor.closeMode === 'unsupported') {
    return res.status(409).json({ error: `Closing ${descriptor?.label || route.harnessId} sessions is not supported; close the owning tmux client directly.` });
  }
  if (descriptor.closeMode === 'client-only') {
    // Some harnesses move the bridge into a resident worker. Their registry
    // PID is not necessarily the client we launched and must never be
    // signaled. The persisted pane is the only lifecycle authority pi-dish
    // owns.
    const routeId = routeSessionId(route.harnessId, route.nativeSessionId);
    const reg = getRegisteredSession(routeId);
    if (!reg) return res.status(409).json({ error: `${descriptor.label} has no single unambiguous live bridge instance to detach.` });
    const spawn = tmux.getSpawn(routeId);
    if (!spawn?.socket || !spawn?.paneId) {
      return res.status(409).json({ error: `This ${descriptor.label} client was not launched by pi-dish, so no owned tmux pane can be detached.` });
    }
    if (!spawnMatchesRegistryClaim(spawn, reg)) {
      tmux.removeSpawn(routeId, spawn);
      return res.status(409).json({ error: `The recorded ${descriptor.label} client no longer matches this live agent, so pi-dish will not detach it.` });
    }
    const currentPaneProcess = await tmux.paneProcessIdentity(spawn.socket, spawn.paneId);
    if (!sameProcessIdentity(currentPaneProcess, spawn.paneProcess)) {
      tmux.removeSpawn(routeId, spawn);
      return res.status(409).json({ error: `The recorded ${descriptor.label} client pane has exited or been replaced. The logical agent may still be running.` });
    }
    const workerIdentity = { pid: reg.pid, startTime: reg.startTime };
    const workerAncestry = inspectProcessAncestry(workerIdentity);
    if (!workerAncestry.complete
        || !sameProcessIdentity(workerAncestry.processes[0], workerIdentity)
        || !processIdentityAlive(currentPaneProcess)
        || !processIdentityAlive(workerIdentity)) {
      return res.status(409).json({ error: `Could not prove that the live ${descriptor.label} worker is independent of the owned client pane, so pi-dish will not detach it.` });
    }
    if (workerAncestry.processes.some(process => sameProcessIdentity(process, currentPaneProcess))) {
      return res.status(409).json({ error: `The live ${descriptor.label} worker is still in the owned client pane’s process tree, so detaching it could stop the logical agent.` });
    }
    // Destructive authority is claim-specific. Re-read and socket-prove the
    // exact worker immediately before kill-pane, then repeat every process
    // check so a replacement worker/client cannot race the earlier snapshot.
    invalidateRegistryCache();
    const freshReg = getRegisteredSession(routeId);
    if (!freshReg || !sameRegistryClaim(freshReg, reg)) {
      return res.status(409).json({ error: `The live ${descriptor.label} bridge changed while detach was being authorized, so pi-dish will not kill the pane.` });
    }
    try {
      await proveBridgeRegistryClaim(freshReg);
    } catch (error) {
      return res.status(409).json({ error: `The live ${descriptor.label} bridge could not re-prove its identity before detach: ${error.message}` });
    }
    const finalPaneProcess = await tmux.paneProcessIdentity(spawn.socket, spawn.paneId);
    const finalWorkerIdentity = { pid: freshReg.pid, startTime: freshReg.startTime };
    const finalWorkerAncestry = inspectProcessAncestry(finalWorkerIdentity);
    if (!sameProcessIdentity(finalPaneProcess, spawn.paneProcess)
        || !processIdentityAlive(finalPaneProcess)
        || !processIdentityAlive(finalWorkerIdentity)
        || !finalWorkerAncestry.complete
        || !sameProcessIdentity(finalWorkerAncestry.processes[0], finalWorkerIdentity)
        || finalWorkerAncestry.processes.some(process => sameProcessIdentity(process, finalPaneProcess))) {
      return res.status(409).json({ error: `The ${descriptor.label} client/worker ownership proof changed before detach, so pi-dish will not kill the pane.` });
    }
    invalidateRegistryCache();
    const killAuthorizedReg = getRegisteredSession(routeId);
    if (!killAuthorizedReg || !sameRegistryClaim(killAuthorizedReg, freshReg)) {
      return res.status(409).json({ error: `The live ${descriptor.label} bridge changed immediately before detach, so pi-dish will not kill the pane.` });
    }
    try {
      await tmux.killPane(spawn.socket, spawn.paneId);
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && await tmux.paneExists(spawn.socket, spawn.paneId)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (await tmux.paneExists(spawn.socket, spawn.paneId)) {
        return res.status(500).json({ error: `The owned ${descriptor.label} client pane did not exit; the logical agent was not signaled.` });
      }
      tmux.removeSpawn(routeId, spawn);
      invalidateRegistryCache();
      const survivingReg = getRegisteredSession(routeId);
      let logicalSessionActive = !!survivingReg
        && sameRegistryClaim(survivingReg, freshReg)
        && processIdentityAlive(finalWorkerIdentity);
      if (logicalSessionActive) {
        try {
          await proveBridgeRegistryClaim(survivingReg);
        } catch {
          logicalSessionActive = false;
        }
      }
      return res.json({ success: true, detached: true, logicalSessionActive });
    } catch (e) {
      return res.status(500).json({ error: `Failed to detach the owned ${descriptor.label} client pane: ${e.message}` });
    }
  }
  const rpc = getRPCSession(sessionId);
  let reg = getRegisteredSession(sessionId);
  let exited;
  if (rpc?.alive) {
    rpc.kill();
    // Our own child: kill(pid, 0) still succeeds while it's a zombie, so wait
    // on the 'exit'-driven flag instead of the pid.
    exited = () => !rpc.alive;
  } else if (reg?.pid) {
    const hasBirthMarker = Object.prototype.hasOwnProperty.call(reg, 'startTime');
    let identity;
    let legacyBridge = null;

    if (!hasBirthMarker) {
      // Legacy registry PIDs remain visible for compatibility, but kill(pid,
      // 0) cannot prove that a reused PID is still the registered pi. Require
      // the old bridge itself to identify this session and PID over its live
      // socket, then capture the process's exact birth identity locally.
      try {
        legacyBridge = await getBridgeSession(sessionId);
        const hello = await legacyBridge.waitForHello({ timeout: 2000 });
        if (legacyBridge.socketPath !== reg.socketPath
            || hello?.sessionId !== sessionId
            || Number(hello?.pid) !== Number(reg.pid)) {
          // The disagreement proves this pooled connection is stale, not that
          // the on-disk claim is stale. Preserve the current claim and force a
          // future attempt to reconnect to its listener.
          legacyBridge.close();
          invalidateRegistryCache();
          return res.status(409).json({
            error: 'Refusing to close this legacy bridge entry because its live handshake did not prove the registered session and PID. Refresh or reload the bridge, then retry.',
          });
        }
        identity = processIdentity(reg.pid);
      } catch (e) {
        pruneUnreachableRegisteredSession(reg, e);
        return res.status(409).json({
          error: `Refusing to signal legacy registry pid ${reg.pid} without a successful bridge identity handshake: ${e.message}. Reload or upgrade that pi bridge, then retry.`,
        });
      }
      if (!identity) {
        pruneRegisteredSession(reg);
        return res.status(409).json({
          error: `Refusing to signal legacy registry pid ${reg.pid} because its exact process identity could not be verified. Reload or upgrade that pi bridge, then retry.`,
        });
      }
    }

    // Bypass the registry memo and re-read the claim immediately before the
    // destructive operation. A replacement bridge for the same session must
    // not inherit an earlier request's authorization to signal its PID.
    const fresh = refreshRegisteredSession(sessionId);
    if (!fresh || !sameRegistryClaim(reg, fresh)) {
      return res.status(409).json({
        error: 'The bridge registry identity changed while closing; no process was signaled. Refresh the session and retry.',
      });
    }
    reg = fresh;
    if (hasBirthMarker) {
      identity = { pid: Number(reg.pid), startTime: String(reg.startTime) };
    } else if (!legacyBridge?.alive) {
      return res.status(409).json({
        error: 'The legacy bridge disconnected before its process could be signaled; no process was signaled. Reload or upgrade the bridge, then retry.',
      });
    }

    // Final birth-marker check is intentionally adjacent to SIGTERM. If the
    // registered process exited and its PID was reused, the new process has a
    // different starttime and is never signaled.
    if (!processIdentityAlive(identity)) {
      pruneRegisteredSession(reg);
      return res.status(409).json({
        error: `The registered pi identity for pid ${reg.pid} is stale; no process was signaled. The stale registry claim was discarded.`,
      });
    }
    try {
      process.kill(reg.pid, 'SIGTERM');
    } catch (e) {
      if (e.code !== 'ESRCH') {
        return res.status(500).json({ error: `Failed to signal pi (pid ${reg.pid}): ${e.message}` });
      }
    }
    exited = () => !processIdentityAlive(identity);
  } else {
    return res.status(404).json({ error: 'Session not active' });
  }

  const timeoutMs = Number(process.env.PI_DISH_CLOSE_TIMEOUT_MS) || 10000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited()) {
      // The client re-fetches the session list on this response — don't let
      // the registry memo serve the dead session as live for another 500ms.
      if (reg) pruneRegisteredSession(reg);
      else invalidateRegistryCache();
      return res.json({ success: true });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  res.status(500).json({ error: `pi did not exit within ${Math.round(timeoutMs / 1000)}s — it may be stuck; check the process directly` });
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
  res.json({ terminal: terminal.isTerminalEnabled(), tmux: tmux.isTmuxAvailable() });
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

// tmux spawning: instead of a `pi --mode rpc` child (which dies with this
// server), open a real pi TUI as a tmux window. The pi-dish-bridge extension
// inside it registers the session and stamps our correlation token onto the
// registry entry; we poll for that entry, then persist the placement and prime
// the command context so remote tree navigation works. See lib/tmux.js.

// Poll the bridge registry directly (not through the memoized listing) for the
// entry carrying our spawn token.
function findSessionBySpawnToken(token, harnessId) {
  let files;
  try { files = fs.readdirSync(REGISTRY_DIR); } catch { return null; }
  const matches = [];
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, name), 'utf8'));
      const identity = registryIdentity(entry);
      if (entry?.spawnToken !== token || !identity || identity.harnessId !== harnessId) continue;
      if (!validRegistryClaimShape(entry)) continue;
      matches.push(entry);
    } catch {}
  }
  return matches.length === 1 ? matches[0] : (matches.length > 1 ? { conflict: true, matches } : null);
}

const MAX_BRIDGE_SOCKET_PATH_BYTES = 103;
const BRIDGE_SOCKET_BASENAME = `${'0'.repeat(24)}.sock`;

function bridgeSocketConfigError(message) {
  const err = new Error(`Invalid pi-dish bridge socket configuration: ${message}`);
  err.status = 500;
  // A configuration error cannot be repaired by silently changing the
  // transport to RPC; the user explicitly requested no automatic fallback.
  err.preventHeadlessFallback = true;
  return err;
}

function validateBridgeSocketConfig(env) {
  const override = env.PI_DISH_SOCKET_DIR || null;
  if (override && !path.isAbsolute(override)) {
    throw bridgeSocketConfigError('PI_DISH_SOCKET_DIR must be an absolute path');
  }
  const socketDir = override
    ? path.resolve(override)
    : path.join(env.HOME || os.homedir(), '.pi', 'dish', 'sockets');
  const socketPath = path.join(socketDir, BRIDGE_SOCKET_BASENAME);
  const bytes = Buffer.byteLength(socketPath);
  if (bytes > MAX_BRIDGE_SOCKET_PATH_BYTES) {
    const action = override
      ? 'Set PI_DISH_SOCKET_DIR to a shorter absolute directory.'
      : 'Set PI_DISH_SOCKET_DIR to a short absolute directory.';
    throw bridgeSocketConfigError(`Unix socket path is ${bytes} bytes (maximum ${MAX_BRIDGE_SOCKET_PATH_BYTES}): ${socketPath}. ${action}`);
  }

  if (fs.existsSync(socketDir)) {
    let stat;
    try { stat = fs.statSync(socketDir); } catch (e) {
      throw bridgeSocketConfigError(`cannot inspect ${socketDir}: ${e.message}`);
    }
    if (!stat.isDirectory()) {
      throw bridgeSocketConfigError(`${override ? 'PI_DISH_SOCKET_DIR' : 'default socket path'} is not a directory: ${socketDir}`);
    }
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      throw bridgeSocketConfigError(`${socketDir} is owned by uid ${stat.uid}, expected uid ${process.getuid()}`);
    }
    const mode = stat.mode & 0o777;
    if (mode !== 0o700) {
      if (override) {
        throw bridgeSocketConfigError(`${socketDir} has mode ${mode.toString(8).padStart(4, '0')}, expected 0700. Choose or create a private PI_DISH_SOCKET_DIR; pi-dish will not change an existing override directory's permissions.`);
      }
      if (typeof process.getuid !== 'function') {
        throw bridgeSocketConfigError(`cannot verify ownership before repairing the default socket directory ${socketDir} from mode ${mode.toString(8).padStart(4, '0')} to 0700`);
      }
      try {
        fs.chmodSync(socketDir, 0o700);
      } catch (e) {
        throw bridgeSocketConfigError(`cannot repair the owned default socket directory ${socketDir} to mode 0700: ${e.message}`);
      }
    }
  }
}

function materializeLaunchWrapper(descriptor, token) {
  if (descriptor.spawnTokenMode !== 'wrapper') return null;
  if (!descriptor.wrapperEntrypoint) {
    throw bridgeSocketConfigError(`${descriptor.label} uses wrapper token injection without a wrapper entrypoint`);
  }
  const dir = path.join(os.homedir(), '.pi', 'dish', 'launch-wrappers');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw bridgeSocketConfigError(`launch wrapper directory is not owned by this user: ${dir}`);
  }
  if ((stat.mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
  const wrapperPath = path.join(dir, `${descriptor.id}-${token}.ts`);
  // Prime persists this module path for resident-worker reload/recovery, so
  // successful launch wrappers intentionally outlive the tmux client.
  const source = [
    '// Generated by pi-dish; retained for resident harness reload/recovery.',
    `import { createHarnessBridge } from ${JSON.stringify(descriptor.wrapperEntrypoint)};`,
    `export default createHarnessBridge(${JSON.stringify(token)});`,
    '',
  ].join('\n');
  fs.writeFileSync(wrapperPath, source, { mode: 0o600, flag: 'wx' });
  return wrapperPath;
}

function injectLaunchWrapper(descriptor, args, wrapperPath) {
  if (!wrapperPath) return args;
  const index = args.indexOf(descriptor.wrapperEntrypoint);
  if (index < 0) {
    throw bridgeSocketConfigError(`${descriptor.label} launch args do not contain its wrapper entrypoint`);
  }
  const injected = [...args];
  injected[index] = wrapperPath;
  return injected;
}

// Build the tmux child argv+env from the same launch spec RPC uses (so a
// PI_DISH_PI_COMMAND wrapper or a simple `pi` alias's env carries over), open
// the window, and wait up to 30s for the session to register. The window is
// left open on timeout for the user to inspect. `args` are pi's CLI args
// (a TUI launch — never --mode rpc). Returns the registered session id.
async function spawnHarnessInTmux({ descriptor, target, args, cwd, hidden }) {
  if (!tmux.isTmuxAvailable()) {
    const err = new Error('tmux is not available on this host'); err.status = 400; throw err;
  }
  const socket = target.socket;
  if (!tmux.isSocketAllowed(socket)) {
    const err = new Error('Invalid tmux socket'); err.status = 400; throw err;
  }
  if (!target.tmuxSession && !target.newTmuxSession) {
    const err = new Error('target needs tmuxSession or newTmuxSession'); err.status = 400; throw err;
  }

  const spec = harnessLaunchSpec(descriptor);
  const env = { ...spec.env };
  // Pin the HOME used by bridge default-path validation into tmux. Otherwise
  // a long-running tmux server can contribute a stale HOME and make the child
  // bind/register in a tree different from the one this server scans.
  if (!Object.hasOwn(env, 'HOME')) env.HOME = process.env.HOME || os.homedir();
  // tmux windows don't inherit this process's env — pass the server URL
  // through so the pi-dish-pages skill works in tmux-spawned sessions too.
  if (process.env.PI_DISH_URL) env.PI_DISH_URL = process.env.PI_DISH_URL;
  // Pin the bridge socket setting even when it is unset: an older tmux server
  // may retain a stale override in its global environment. An explicit value
  // in PI_DISH_PI_COMMAND still wins, matching RPC launch-spec precedence.
  if (!Object.hasOwn(env, 'PI_DISH_SOCKET_DIR')) {
    env.PI_DISH_SOCKET_DIR = process.env.PI_DISH_SOCKET_DIR || '';
  }
  validateBridgeSocketConfig(env);

  const token = crypto.randomBytes(16).toString('hex');
  env.PI_DISH_SPAWN_TOKEN = token;
  const wrapperPath = materializeLaunchWrapper(descriptor, token);
  const command = [...spec.argv, ...injectLaunchWrapper(descriptor, args, wrapperPath)];

  let paneId;
  try {
    ({ paneId } = await tmux.spawnInTmux({
      socket,
      tmuxSession: target.tmuxSession,
      newTmuxSessionName: target.newTmuxSession,
      cwd: cwd || env.HOME,
      command,
      env,
    }));
  } catch (e) {
    const err = new Error(`Failed to open tmux window: ${e.message}`); err.status = 500; throw err;
  }

  const timeoutMs = Number(process.env.PI_DISH_SPAWN_TIMEOUT_MS) || 30000;
  const timeoutLabel = timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`;
  const deadline = Date.now() + timeoutMs;
  let registrationError = null;
  const acceptRegistration = async (entry) => {
    let accepted = entry;
    if (descriptor.id !== 'pi') {
      invalidateRegistryCache();
      const identity = registryIdentity(entry);
      const current = getRegisteredSessionByNativeId(identity.harnessId, identity.nativeSessionId);
      if (!current || !sameRegistryClaim(current, entry)) {
        throw new Error(`${descriptor.label} registry claim changed before socket identity could be proved`);
      }
      await proveBridgeRegistryClaim(current);
      accepted = current;
    }
    const identity = registryIdentity(accepted);
    const routeId = routeSessionId(identity.harnessId, identity.nativeSessionId);
    const paneProcess = await tmux.paneProcessIdentity(socket, paneId);
    tmux.recordSpawn(routeId, {
      socket,
      paneId,
      spawnToken: token,
      bridgeInstanceId: accepted.bridgeInstanceId || accepted.instanceId || null,
      paneProcess,
      wrapperPath,
    });
    invalidateRegistryCache();
    // Prime the command context so POST /branch can navigate the tree
    // remotely (TUI sessions otherwise 409 — see the branch route).
    if (descriptor.id === 'pi') tmux.sendKeys(socket, paneId, '/dish-prime').catch(() => {});
    return routeId;
  };
  while (Date.now() < deadline) {
    const entry = findSessionBySpawnToken(token, descriptor.id);
    if (entry?.conflict) {
      registrationError = new Error(`${descriptor.label} produced multiple bridge registrations for one launch token; refusing to select one.`);
      registrationError.status = 409;
      registrationError.preventHeadlessFallback = true;
      break;
    }
    if (entry) {
      try {
        return await acceptRegistration(entry);
      } catch (error) {
        registrationError = new Error(`${descriptor.label} bridge identity proof failed: ${error.message}`);
        registrationError.status = 500;
        registrationError.preventHeadlessFallback = true;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, Math.min(300, Math.max(1, deadline - Date.now()))));
  }
  // Registration may have landed during the final sleep, exactly at the
  // deadline. Check once more before declaring a timeout and killing a hidden
  // pane that is already ready.
  const deadlineEntry = registrationError ? null : findSessionBySpawnToken(token, descriptor.id);
  if (deadlineEntry?.conflict) {
    registrationError = new Error(`${descriptor.label} produced multiple bridge registrations for one launch token; refusing to select one.`);
    registrationError.status = 409;
    registrationError.preventHeadlessFallback = true;
  }
  if (!registrationError && deadlineEntry) {
    try {
      return await acceptRegistration(deadlineEntry);
    } catch (error) {
      registrationError = new Error(`${descriptor.label} bridge identity proof failed: ${error.message}`);
      registrationError.status = 500;
      registrationError.preventHeadlessFallback = true;
    }
  }

  // A user-targeted window stays open for inspection; a hidden headless
  // window is invisible. It must be fully gone before the caller may start an
  // RPC fallback, or both processes can write the same session JSONL.
  const shouldCleanup = hidden || !descriptor.rpcFallback || !!registrationError;
  if (shouldCleanup) {
    const cleanupTimeoutMs = Math.min(5000, Math.max(1000, timeoutMs));
    try {
      await tmux.killPaneAndWait(socket, paneId, { timeout: cleanupTimeoutMs });
    } catch (cleanupError) {
      const cleanupMessage = registrationError
        ? `${registrationError.message}, and tmux cleanup failed: ${cleanupError.message}`
        : descriptor.rpcFallback
          ? `${descriptor.label} did not register within ${timeoutLabel}, and hidden tmux cleanup failed; refusing to start an RPC fallback that could write the same session file: ${cleanupError.message}`
          : `${descriptor.label} did not register within ${timeoutLabel}, and tmux cleanup failed: ${cleanupError.message}`;
      const err = new Error(cleanupMessage);
      err.status = 500;
      err.preventHeadlessFallback = true;
      err.cleanupFailed = {
        socket,
        paneId,
        knownProcesses: cleanupError.remainingProcesses || [],
        timeout: cleanupTimeoutMs,
      };
      throw err;
    }
  }
  if (registrationError) throw registrationError;
  const cleaned = shouldCleanup;
  const wrapperHint = descriptor.wrapperEntrypoint
    ? `Ensure ${descriptor.label} can load ${descriptor.wrapperEntrypoint}.`
    : 'Ensure the pi-dish-bridge extension is installed in Pi’s global extensions.';
  const err = new Error(`${descriptor.label} did not register within ${timeoutLabel} — ${cleaned ? 'the tmux window was closed' : 'the tmux window was left open for inspection'}. ${wrapperHint}`);
  err.status = 500;
  if (!cleaned) {
    const state = await tmux.paneProcessState(socket, paneId);
    if (state.paneExists || state.knownProcesses.length) {
      err.resumeUncertain = { socket, paneId, knownProcesses: state.knownProcesses };
    }
  }
  if (!descriptor.rpcFallback) err.preventHeadlessFallback = true;
  throw err;
}

// --- Durable headless sessions -----------------------------------------------
// A target-less spawn/resume prefers a hidden, detached tmux session over an
// RPC child: RPC children die with this server (pi --mode rpc shuts down on
// stdin EOF), so a dev-mode restart or crash kills them. A pi TUI in tmux
// survives independently and the bridge registry re-connects it. The hidden
// placement lives on a dedicated socket (`pi-dish` under the tmux tmpdir) in
// one session named `headless`, so it never touches the user's own tmux
// servers; it still shows up in /api/tmux/targets and is attachable
// (`tmux -L pi-dish attach`) when a pi needs inspecting.
// PI_DISH_HEADLESS=rpc forces the old RPC children; =tmux forces the tmux
// path; unset auto-detects: tmux present AND the bridge extension installed
// at its documented path (a bridge-less pi can never register, and eating the
// 30s registration timeout on every spawn would be brutal). One failed
// registration flips the path off until the server restarts.
const HEADLESS_TMUX_SERVER = 'pi-dish';
const HEADLESS_TMUX_SESSION = 'headless';
let headlessTmuxBroken = false;

function headlessTmuxEnabled(descriptor = getHarness('pi')) {
  const mode = process.env.PI_DISH_HEADLESS || '';
  if (mode === 'rpc' && descriptor.rpcFallback) return false;
  if (!tmux.isTmuxAvailable()) return false;
  // Alternate harnesses always load their wrapper explicitly, so tmux
  // availability is the only prerequisite and RPC is never an option.
  if (!descriptor.rpcFallback) return true;
  if (mode === 'tmux') return true;
  if (headlessTmuxBroken) return false;
  const home = process.env.HOME || os.homedir();
  return fs.existsSync(path.join(home, '.pi', 'agent', 'extensions', 'pi-dish-bridge'));
}

// Serialized: two concurrent spawns must not both decide the hidden session
// doesn't exist yet and race their `new-session` calls.
let headlessSpawnChain = Promise.resolve();
function spawnHarnessHeadlessTmux(opts) {
  const run = headlessSpawnChain.then(() => _spawnHarnessHeadlessTmux(opts));
  headlessSpawnChain = run.then(() => {}, () => {});
  return run;
}

async function _spawnHarnessHeadlessTmux({ descriptor, args, cwd }) {
  // tmux won't create its tmpdir for -S sockets (only for -L); 0700 matches
  // what tmux itself would create.
  fs.mkdirSync(tmux.tmuxTmpdir(), { recursive: true, mode: 0o700 });
  const socket = path.join(tmux.tmuxTmpdir(), HEADLESS_TMUX_SERVER);
  const target = (await tmux.hasSession(socket, HEADLESS_TMUX_SESSION))
    ? { socket, tmuxSession: HEADLESS_TMUX_SESSION }
    : { socket, newTmuxSession: HEADLESS_TMUX_SESSION };
  return spawnHarnessInTmux({ descriptor, target, args, cwd, hidden: true });
}

// Spawn a fresh session. Default ("headless"): a hidden tmux window when the
// headless-tmux path is available (survives server restarts), else a
// `pi --mode rpc` child (dies with this server). An explicit `target:
// { type: 'tmux', socket, tmuxSession }` or `{ ..., newTmuxSession }` opens a
// pi TUI in one of the user's own tmux sessions instead.
async function validateHarnessPilotSelection(descriptor, { model, thinking, cwd }) {
  if (descriptor.id !== 'omp' || (!model && !thinking)) return;
  if (thinking && !model) {
    const err = new Error('Choose an Oh My Pi model before overriding its thinking level.');
    err.status = 400;
    throw err;
  }
  const models = await runHarnessModelCommand(descriptor, { cwd });
  const selected = models.find(entry => entry.selector === model || `${entry.provider}/${entry.id}` === model);
  if (!selected) {
    const err = new Error(`Model ${model} is not available from Oh My Pi in this working directory.`);
    err.status = 400;
    throw err;
  }
  if (thinking && !selected.thinking?.includes(thinking)) {
    const valid = selected.thinking?.length ? selected.thinking.join(', ') : 'none';
    const err = new Error(`Thinking level ${thinking} is not valid for ${model}; valid levels: ${valid}.`);
    err.status = 400;
    throw err;
  }
}

async function createSession({ harness = 'pi', name, model, thinking, cwd, target }) {
  const descriptor = getHarness(harness);
  if (!descriptor) {
    const err = new Error(`Unknown harness: ${harness}`); err.status = 400; throw err;
  }
  if (cwd && cwd.startsWith('~')) {
    cwd = path.join(process.env.HOME, cwd.slice(1).replace(/^\//, ''));
  }
  const args = descriptor.argv.new({ model, thinking });
  let id;
  if (target && target.type === 'tmux') {
    id = await spawnHarnessInTmux({ descriptor, target, args, cwd });
  } else if (headlessTmuxEnabled(descriptor)) {
    try {
      id = await spawnHarnessHeadlessTmux({ descriptor, args, cwd });
    } catch (e) {
      if (!descriptor.rpcFallback || e.preventHeadlessFallback) throw e;
      headlessTmuxBroken = true;
      console.error('Headless tmux spawn failed — falling back to an RPC child:', e.message);
    }
  }
  if (!id && !descriptor.rpcFallback) {
    const err = new Error(`${descriptor.label} requires tmux and does not support RPC fallback.`);
    err.status = 400;
    throw err;
  }
  if (!id) {
    const rpc = await createRPCSession({ model, thinking, cwd });
    id = rpc.id;
  }
  if (name) {
    const sess = await getLiveSession(id);
    if (!sess || !liveSessionSupports(sess, 'rename')) {
      const err = new Error(`${descriptor.label} does not support naming new sessions.`);
      err.status = 409;
      throw err;
    }
    await sess.setName(name);
  }
  return id;
}

// The browser can decouple its provisional "Starting…" row from the actual
// Pi startup. Keep the operation state process-local: the durable artifact is
// still the tmux process + bridge registry, so a server restart cannot kill a
// successfully launched session. Existing API callers remain blocking unless
// they explicitly pass async:true.
const sessionSpawnOperations = new Map(); // spawn id -> { status, sessionId?, error? }
const SESSION_SPAWN_RESULT_TTL_MS = 5 * 60 * 1000;

function startSessionSpawn(options) {
  const spawnId = crypto.randomUUID();
  const operation = { status: 'starting', createdAt: Date.now() };
  sessionSpawnOperations.set(spawnId, operation);

  Promise.resolve()
    .then(() => createSession(options))
    .then((sessionId) => {
      operation.status = 'ready';
      operation.sessionId = sessionId;
      if (options.sourceSessionId) {
        try { sessionProvenance.recordLaunch(sessionId, options.sourceSessionId, spawnId); }
        catch (e) { console.warn(`Failed to record session launch provenance: ${e.message}`); }
      }
    })
    .catch((e) => {
      console.error('Failed to create session:', e);
      operation.status = 'error';
      operation.error = e.message;
    })
    .finally(() => {
      const timer = setTimeout(() => {
        if (sessionSpawnOperations.get(spawnId) === operation) sessionSpawnOperations.delete(spawnId);
      }, SESSION_SPAWN_RESULT_TTL_MS);
      timer.unref?.();
    });

  return spawnId;
}

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
  if (sourceSessionId && !getRegisteredSession(sourceSessionId) && !getRPCSession(sourceSessionId)?.alive
      && !findSessionFile(sourceSessionId, { exact: true })) {
    return res.status(400).json({ error: 'requestedBySessionId must identify an existing session' });
  }
  try {
    await validateHarnessPilotSelection(descriptor, { model, thinking, cwd });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
  if (req.body?.async === true) {
    const spawnId = startSessionSpawn({ harness, name, model, thinking, cwd, target, sourceSessionId });
    return res.status(202).json({ success: true, pending: true, spawnId });
  }
  try {
    const id = await createSession({ harness, name, model, thinking, cwd, target });
    let operationId = null;
    if (sourceSessionId) {
      const candidateOperationId = crypto.randomUUID();
      try {
        sessionProvenance.recordLaunch(id, sourceSessionId, candidateOperationId);
        operationId = candidateOperationId;
      } catch (e) { console.warn(`Failed to record session launch provenance: ${e.message}`); }
    }
    res.json({ success: true, id, ...(operationId ? { operationId } : {}) });
  } catch (e) {
    console.error('Failed to create session:', e);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

app.get('/api/session-spawns/:id', (req, res) => {
  const operation = sessionSpawnOperations.get(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Session spawn not found' });
  res.status(operation.status === 'starting' ? 202 : 200).json(operation);
});

// Resume is single-flight at the HTTP dispatch boundary, not in one backend:
// explicit tmux, hidden tmux, and RPC requests for the same canonical JSONL
// all share the first launch. This map is intentionally process-local — it
// closes overlapping requests to this server, while bridge/RPC liveness is
// still the durable source of truth before and after each flight.
const resumeFlights = new Map(); // real session file -> Promise<{ id }>
// A failed hidden-pane cleanup may leave the old JSONL writer alive after its
// request/flight ends. Preserve that placement by canonical file so a retry
// must finish the cleanup before it can launch any backend.
const failedResumeCleanups = new Map(); // real session file -> { socket, paneId, knownProcesses, timeout }
// Explicit tmux timeouts deliberately leave their panes open for inspection.
// Remember the pane and exact process identities so a later resume cannot
// start another writer for the same canonical JSONL while it is uncertain.
const uncertainExplicitResumes = new Map(); // real session file -> { socket, paneId, knownProcesses }

function sessionIsActive(sessionId) {
  return !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId)?.alive;
}

function clearResumeQuarantines(sessionFile) {
  failedResumeCleanups.delete(sessionFile);
  uncertainExplicitResumes.delete(sessionFile);
}

function activeSessionClearsQuarantine(sessionId) {
  const registered = getRegisteredSession(sessionId);
  const rpc = getRPCSession(sessionId);
  if (!registered && !rpc?.alive) return false;
  const activeFile = registered?.sessionFile || rpc?.sessionFile || rpc?.state?.sessionFile;
  if (activeFile) {
    try { clearResumeQuarantines(fs.realpathSync(activeFile)); } catch {}
  }
  return true;
}

async function launchResumedSession({ descriptor, sessionFile, cwd, target, model }) {
  const args = descriptor.argv.resume({ file: sessionFile, model });
  if (target && target.type === 'tmux') {
    try {
      const id = await spawnHarnessInTmux({ descriptor, target, args, cwd });
      return { id };
    } catch (e) {
      if (e.resumeUncertain) uncertainExplicitResumes.set(sessionFile, e.resumeUncertain);
      throw e;
    }
  }
  if (headlessTmuxEnabled(descriptor)) {
    try {
      const id = await spawnHarnessHeadlessTmux({ descriptor, args, cwd });
      return { id };
    } catch (e) {
      if (!descriptor.rpcFallback || e.preventHeadlessFallback) {
        if (e.cleanupFailed) failedResumeCleanups.set(sessionFile, e.cleanupFailed);
        throw e;
      }
      headlessTmuxBroken = true;
      console.error('Headless tmux resume failed — falling back to an RPC child:', e.message);
    }
  }
  if (!descriptor.rpcFallback) {
    const err = new Error(`${descriptor.label} requires tmux and does not support RPC fallback.`);
    err.status = 400;
    throw err;
  }
  const rpc = await resumeRPCSession(sessionFile, cwd || process.env.HOME);
  return { id: rpc.id };
}

// Resume an inactive session. Default: the same headless dispatch as /new
// (hidden tmux when available, else an RPC `pi --mode rpc --session <path>`
// child); with a tmux `target`, `pi --session <path>` in that window instead.
app.post('/api/sessions/:id/resume', async (req, res) => {
  const requestedId = req.params.id;
  const model = req.body?.model;
  if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
    return res.status(400).json({ error: 'Model must be a non-empty string' });
  }

  if (activeSessionClearsQuarantine(requestedId)) {
    return res.json({ success: true, id: requestedId, alreadyActive: true });
  }

  const sessionSource = findSessionSource(requestedId);
  if (!sessionSource) return res.status(404).json({ error: 'Session file not found' });
  const descriptor = getHarness(sessionSource.harnessId);
  if (model && descriptor.id !== 'omp') {
    return res.status(400).json({ error: 'Resume model overrides are currently supported only for Oh My Pi sessions.' });
  }
  let sessionFile;
  try {
    sessionFile = fs.realpathSync(sessionSource.file);
  } catch {
    return res.status(404).json({ error: 'Session file not found' });
  }
  const sessionId = routeSessionId(sessionSource.harnessId, sessionSource.nativeSessionId);

  // The route id may be a partial historical match; liveness belongs to the
  // canonical JSONL basename, so check it again before creating a flight.
  invalidateRegistryCache();
  if (activeSessionClearsQuarantine(sessionId)) {
    return res.json({ success: true, id: sessionId, alreadyActive: true });
  }

  const uncertainExplicit = uncertainExplicitResumes.get(sessionFile);
  if (uncertainExplicit) {
    const state = await tmux.paneProcessState(
      uncertainExplicit.socket,
      uncertainExplicit.paneId,
      { knownProcesses: uncertainExplicit.knownProcesses },
    );
    if (!state.paneExists && !state.knownProcesses.length) {
      if (uncertainExplicitResumes.get(sessionFile) === uncertainExplicit) {
        uncertainExplicitResumes.delete(sessionFile);
      }
    } else {
      uncertainExplicitResumes.set(sessionFile, {
        ...uncertainExplicit,
        knownProcesses: state.knownProcesses,
      });
      // Registration can race the inspection above. Refresh once more before
      // refusing a retry whose original pane has just become the active writer.
      invalidateRegistryCache();
      if (activeSessionClearsQuarantine(sessionId)) {
        return res.json({ success: true, id: sessionId, alreadyActive: true });
      }
      return res.status(409).json({
        error: `A previous explicit tmux resume timed out and its pane/process is still present (${uncertainExplicit.paneId}); refusing to launch another process against this session file. Inspect or close that tmux pane before retrying.`,
      });
    }
  }

  const failedCleanup = failedResumeCleanups.get(sessionFile);
  if (failedCleanup) {
    try {
      await tmux.killPaneAndWait(failedCleanup.socket, failedCleanup.paneId, {
        knownProcesses: failedCleanup.knownProcesses,
        timeout: failedCleanup.timeout,
      });
      if (failedResumeCleanups.get(sessionFile) === failedCleanup) failedResumeCleanups.delete(sessionFile);
      invalidateRegistryCache();
    } catch (cleanupError) {
      if (Array.isArray(cleanupError.remainingProcesses)) {
        failedResumeCleanups.set(sessionFile, {
          ...failedCleanup,
          knownProcesses: cleanupError.remainingProcesses,
        });
      }
      return res.status(500).json({
        error: `Previous hidden tmux cleanup is still incomplete; refusing to resume another process against this session file: ${cleanupError.message}`,
      });
    }
  }

  const existingFlight = resumeFlights.get(sessionFile);
  if (existingFlight) {
    try {
      const result = await existingFlight;
      // A launch promise settling is not itself proof that the process stayed
      // alive. Refresh bridge state after waiting before reporting the shared
      // first caller's target as active.
      invalidateRegistryCache();
      if (!sessionIsActive(result.id)) {
        const err = new Error('The concurrent resume completed, but the session is no longer active');
        err.status = 500;
        throw err;
      }
      return res.json({ success: true, id: result.id, alreadyActive: true, sharedResume: true });
    } catch (e) {
      console.error('Concurrent session resume failed:', e);
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  let cwd = readSessionCwd({ ...sessionSource, file: sessionFile });
  if (cwd && !fs.existsSync(cwd)) {
    console.warn(`Session cwd ${cwd} doesn't exist, using HOME`);
    cwd = process.env.HOME;
  }

  try {
    await validateHarnessPilotSelection(descriptor, { model, cwd });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }

  const flight = launchResumedSession({ descriptor, sessionFile, cwd, target: req.body?.target, model });
  resumeFlights.set(sessionFile, flight);
  try {
    const result = await flight;
    res.json({ success: true, id: result.id });
  } catch (e) {
    console.error('Failed to resume session:', e);
    res.status(e.status || 500).json({ error: e.message });
  } finally {
    if (resumeFlights.get(sessionFile) === flight) resumeFlights.delete(sessionFile);
  }
});

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

  res.write(`event: init\ndata: ${JSON.stringify({ turnInProgress: !!sess.turnInProgress, compacting: !!sess.compacting })}\n\n`);

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

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
    const m = data?.message;
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
    const role = data?.message?.role;
    if (role === 'assistant') {
      clearPendingUpdate();
      send('message_end', { message: data.message });
    } else if (role === 'user') {
      // A steer/follow-up pi just delivered mid-turn — forward it so the client
      // can show it now instead of waiting for the turn_end JSONL catch-up.
      // Don't touch the coalescer: a user message doesn't invalidate a pending
      // assistant delta.
      send('message_end', { message: data.message });
    }
  });

  // Tree navigation changed the session's authoritative history — the client
  // must re-render the transcript from the JSONL (the bridge anchors the new
  // leaf on disk before broadcasting this).
  sub('session_tree', (data) => send('session_tree', data || {}));

  sub('tool_execution_start', (data) => send('tool_execution_start', data));
  sub('tool_execution_update', (data) => send('tool_execution_update', data));
  sub('tool_execution_end', (data) => send('tool_execution_end', data));
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
  if (sess.extUIState) {
    const { widgets, statuses, dialogs } = sess.extUIState;
    for (const data of [...widgets.values(), ...statuses.values(), ...dialogs.values()]) {
      if (data.method === 'setWidget' || data.method === 'setStatus') {
        lastExtUI.set(`${data.method}:${data.widgetKey || data.statusKey || 'default'}`, extUISig(data));
      }
      send('extension_ui_request', data);
    }
  }
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

// id → confirmed path. The full tree walk otherwise re-runs for every
// pagination/search request against a historical session; the mapping is
// stable, so a hit only needs an existsSync revalidation. Misses are never
// cached (the file may appear later).
const sessionFileCache = new Map();

// A full historical discovery is authoritative for route identity too. Refresh
// both full-id lookup modes together so a newly preferred/removed duplicate
// cannot leave the list pointing at one file while routes use an older cache.
function refreshSessionFileCache(candidates) {
  sessionFileCache.clear();
  for (const candidate of candidates || []) {
    const routeId = apiIdForCandidate(candidate);
    sessionFileCache.set(`exact:${routeId}`, candidate);
    sessionFileCache.set(`partial:${routeId}`, candidate);
  }
}

function findSessionSource(sessionId, { exact = false } = {}) {
  const active = resolveSessionCandidate(sessionId, { discover: false });
  if (active?.file && fs.existsSync(active.file)) return active;

  const cacheKey = `${exact ? 'exact' : 'partial'}:${sessionId}`;
  const cached = sessionFileCache.get(cacheKey);
  if (cached?.file && fs.existsSync(cached.file)) {
    if (path.basename(cached.file) !== 'session.jsonl') return cached;
    // Generic identities can become ambiguous when an external launcher
    // creates/copies another tree between sidebar scans. Revalidate them on
    // route access so cached paths never bypass the no-ambiguous-routing rule.
    const descriptor = getHarness(cached.harnessId);
    const current = findSessionCandidate(descriptor.rootPath(), cached.nativeSessionId, {
      descriptor,
      allowPartial: false,
    }).candidate;
    if (!current) { sessionFileCache.delete(cacheKey); return null; }
    sessionFileCache.set(cacheKey, current);
    return current;
  }

  const identity = routeIdentity(sessionId);
  if (!identity) return null;
  const descriptor = getHarness(identity.harnessId);
  if (!descriptor) return null;
  // Encoded identities are canonical and must always route exactly. Preserve
  // Pi's legacy substring lookup only for old raw route IDs.
  const { candidate } = findSessionCandidate(descriptor.rootPath(), identity.nativeSessionId, {
    descriptor,
    allowPartial: !identity.encoded && !exact,
  });
  if (!candidate) return null;
  if (sessionFileCache.size >= 500) sessionFileCache.clear();
  sessionFileCache.set(cacheKey, candidate);
  return candidate;
}

function findSessionFile(sessionId, options) {
  return findSessionSource(sessionId, options)?.file || null;
}

// =========================================================================
// Start server
// =========================================================================

// Warm the models cache at startup so context window sizes are accurate immediately
piSDK.getAvailableModels().then(setModelsCache).catch(() => {});

const server = app.listen(PORT, HOST, () => {
  // Loopback URL for agents running on this machine (the pi-dish-pages
  // skill curls it). Children spawned by pi-dish inherit process.env (RPC)
  // or get it via tmux -e; respect an operator-provided value.
  if (!process.env.PI_DISH_URL) {
    process.env.PI_DISH_URL = `http://127.0.0.1:${server.address().port}`;
  }
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
});

// Optional dedicated share listener: a second minimal app that serves ONLY
// the public content routes — GET /share/:token and GET /page/:token[/*]
// (everything else 404s) — so operators can expose public session traces and
// published pages on their own port/host without opening the rest of the
// API. Both stay available on the main app regardless.
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
  shareApp.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  const shareHost = process.env.PI_DISH_SHARE_HOST || HOST;
  const shareServer = shareApp.listen(process.env.PI_DISH_SHARE_PORT, shareHost, () => {
    console.log(`pi-dish share listener at http://${shareHost}:${shareServer.address().port}`);
  });
  server.on('close', () => { try { shareServer.close(); } catch {} });
}

// WebSocket endpoint for the in-browser terminal (see lib/terminal.js).
// Registered only when the feature flag is on — with it off, upgrade
// requests get the default socket destroy, indistinguishable from a server
// without the feature.
if (terminal.isTerminalEnabled()) {
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true });
  const TERMINAL_PATH_RE = /^\/api\/sessions\/([^/]+)\/terminal$/;

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', 'http://localhost');
    const match = TERMINAL_PATH_RE.exec(url.pathname);
    if (!match) return socket.destroy();
    const sessionId = decodeURIComponent(match[1]);
    // Only spawn shells for sessions pi-dish actually knows about.
    const known = getRegisteredSession(sessionId) || getRPCSession(sessionId) || findSessionFile(sessionId);
    if (!known) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      return socket.destroy();
    }
    (async () => {
      // mode=tmux: instead of a shell at the cwd, attach a grouped tmux
      // client viewing the pane the session's pi runs in (works for hidden
      // headless spawns too — it's the only way to *see* those TUIs). The
      // PTY is keyed separately so the plain shell and the pane view
      // coexist. $TMUX is stripped or a server running inside tmux couldn't
      // nest the attach.
      let key = sessionId;
      let opts;
      if (url.searchParams.get('mode') === 'tmux') {
        const pane = await locatePiPane(sessionId);
        const command = pane && await tmux.attachPaneArgv(pane.socket, pane.paneId);
        if (!command) {
          return wss.handleUpgrade(req, socket, head, (ws) => {
            try { ws.send(JSON.stringify({ type: 'error', error: 'No tmux pane found for this session' })); } catch {}
            ws.close(1011, 'no tmux pane');
          });
        }
        key = `${sessionId}:tmux`;
        opts = {
          command,
          env: { TMUX: undefined, TMUX_PANE: undefined },
          meta: { tmuxPrefix: await tmux.getPrefixKey(pane.socket) },
        };
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        try {
          terminal.attachClient(key, resolveSessionCwd(sessionId), ws, opts);
        } catch (e) {
          try { ws.send(JSON.stringify({ type: 'error', error: e.message })); } catch {}
          ws.close(1011, 'terminal failed');
        }
      });
    })().catch(() => socket.destroy());
  });

  server.on('close', () => terminal.killAllTerminals());
}

module.exports = server;
