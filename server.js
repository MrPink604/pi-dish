const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const piSDK = require('./lib/pi-sdk');
const { createRPCSession, resumeRPCSession, getRPCSession, getAllRPCSessions, getPiLaunchSpec } = require('./lib/rpc-session');
const {
  listRegisteredSessions,
  invalidateRegistryCache,
  getRegisteredSession,
  getBridgeSession,
  BridgeSession,
  REGISTRY_DIR,
  pidAlive,
} = require('./lib/bridge-session');
const { searchFiles, searchHomeDirs, completePath, isPathCompletionToken } = require('./lib/file-search');
const { resolveFileMention, readFileForViewer } = require('./lib/file-mention');
const { aggregateDiffs, getFilePatch } = require('./lib/git-diff');
const terminal = require('./lib/terminal');
const tmux = require('./lib/tmux');
const shares = require('./lib/shares');
const pages = require('./lib/pages');
const comments = require('./lib/comments');
const {
  getSessionInfo,
  readSessionMessages,
  getSessionStats,
  readSessionCwd,
  decodeDirToCwd,
} = require('./lib/session-files');
const sessionIndex = require('./lib/session-index');
const {
  isModelEnabled, extractTextContent, THINKING_LEVEL_NAMES,
  sessionMetaText, parseModelId, formatModelRef, buildSnippet, buildSnippets,
  parseSessionQuery, evaluateSessionQuery, positiveQueryTokens,
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

function normalizeModel(model) {
  if (!model) return null;
  const sourcePricing = model.pricing || model.cost;
  const pricing = sourcePricing && Number.isFinite(sourcePricing.input) && Number.isFinite(sourcePricing.output)
    ? Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].filter(k => Number.isFinite(sourcePricing[k])).map(k => [k, sourcePricing[k]]))
    : null;
  return {
    id: model.id || model.modelId,
    name: model.name || model.id || model.modelId,
    provider: model.provider,
    contextWindow: model.contextWindow || 0,
    reasoning: !!model.reasoning,
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
 * `instanceof BridgeSession`. A failed bridge connect throws (callers' catch
 * blocks turn that into a 500, same as before).
 */
async function getLiveSession(sessionId) {
  if (getRegisteredSession(sessionId)) return trackExtUIState(await getBridgeSession(sessionId));
  const rpc = getRPCSession(sessionId);
  return rpc?.alive ? trackExtUIState(rpc) : null;
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
    if (sess) {
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
    cwd: v.cwd || null,
    sessionFile: v.sessionFile || null,
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
  for (const reg of registered) {
    let info = {};
    if (reg.sessionFile && fs.existsSync(reg.sessionFile)) {
      try { info = parseSessionFile(reg.sessionFile); } catch {}
    }
    // The bridge reports the session's actual context usage (tokens, window,
    // percent) straight from pi — always prefer it over JSONL guesswork.
    const usage = reg.contextUsage || null;
    active.push(activeSessionEntry({
      id: reg.sessionId,
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
      cwd: reg.cwd || info.cwd,
      sessionFile: reg.sessionFile,
      pid: reg.pid,
    }));
    seen.add(reg.sessionId);
  }

  // Sessions spawned by pi-dish via RPC may not be visible through the bridge
  // extension in all pi versions/modes. Include them directly so a freshly
  // created UI session still shows its resolved default model and remains
  // model-switchable.
  for (const rpc of getAllRPCSessions()) {
    if (!rpc.alive || seen.has(rpc.id)) continue;
    const state = rpc.state || {};
    const usage = rpc.lastStats?.contextUsage || null;
    active.push(activeSessionEntry({
      id: rpc.id,
      name: state.sessionName || state.name,
      model: formatModelRef(state.model) || formatModelRef(rpc.model),
      percent: usage?.percent,
      tokens: usage?.tokens,
      contextWindow: usage?.contextWindow || state.model?.contextWindow,
      thinkingLevel: state.thinkingLevel,
      messageCount: state.messageCount,
      lastActivity: rpc.lastActivityAt,
      turnInProgress: rpc.turnInProgress,
      cwd: rpc.cwd,
      sessionFile: rpc.sessionFile || state.sessionFile,
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
    ...registered.map(r => r.sessionId),
    ...getAllRPCSessions().filter(s => s.alive).map(s => s.id),
  ]);
  const candidates = []; // { file, id, dirName }
  const previous = [];
  let indexing = false;

  try {
    candidates.push(...enumerateSessionCandidates(activeIds));

    const scan = sessionIndex.scanSessions(candidates.map(c => c.file));
    indexing = scan.indexing;
    for (const { file, id, dirName } of candidates) {
      const raw = scan.infos.get(file);
      if (!raw) continue; // unreadable, or still queued for background indexing
      const info = withContext(raw);
      // The dir-name decode is lossy (every '-' becomes '/'), so a
      // hyphenated project dir decodes to a bogus path — only trust it
      // when the decoded directory actually exists.
      let cwd = info.cwd;
      if (!cwd) {
        const decoded = decodeDirToCwd(dirName);
        cwd = fs.existsSync(decoded) ? decoded : null;
      }
      previous.push({
        id,
        name: info.name || id.slice(0, 8),
        model: info.model || 'unknown',
        contextPercent: info.contextPercent || 0,
        contextTokens: info.contextTokens || 0,
        messageCount: info.messageCount || 0,
        lastActivity: info.lastActivity,
        isActive: false,
        cwd,
        sessionFile: file,
      });
    }
  } catch (e) {
    console.error('Error scanning sessions:', e);
  }

  previous.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  return { previous, indexing };
}

function enumerateSessionCandidates(excludeIds = new Set()) {
  const out = [];
  let dirs = []; try { dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }); } catch { return out; }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(SESSIONS_DIR, dir.name);
    let files = []; try { files = fs.readdirSync(dirPath); } catch { continue; }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -6);
      if (!excludeIds.has(id)) out.push({ file: path.join(dirPath, name), id, dirName: dir.name });
    }
  }
  return out;
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
    const historyText = sessionIndex.getSearchText(session.sessionFile);
    if (evaluateSessionQuery(parsed, session, historyText)) {
      return { snippet: buildSnippet(historyText, contentTokens) };
    }
  }
  return null;
}

function filterSessionsByQuery(list, query) {
  const parsed = parseSessionQuery(query);
  if (!parsed.terms.length && parsed.since === null && parsed.before === null) return list;
  const out = [];
  for (const session of list) {
    const m = matchSessionQuery(session, parsed);
    if (!m) continue;
    out.push(m.snippet ? { ...session, searchSnippet: m.snippet } : session);
  }
  return out;
}

// =========================================================================
// API Routes
// =========================================================================

// `active=1` skips the historical-tree scan entirely — the sidebar's Active
// tab polls every 10s and would otherwise stat every JSONL just to discard
// the result.
app.get('/api/sessions', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  const registered = listRegisteredSessions();
  let active = getActiveSessions(registered);
  let previous = [], indexing = false;
  if (req.query.active !== '1') {
    ({ previous, indexing } = getPreviousSessions(registered));
  }

  if (query) {
    active = filterSessionsByQuery(active, query);
    previous = filterSessionsByQuery(previous, query);
  }
  res.json({ active, previous, indexing });
});

// Advanced search (the main-pane takeover): one flat result list over every
// session, same grammar as the sidebar, but with *multiple* snippets and an
// occurrence count per content match — the sidebar's single snippet is a
// row decoration; this is the primary content. Metadata-matched sessions
// still get snippets when the positive tokens also occur in their content
// (a name hit with 12 transcript mentions should show them). Recency order,
// capped; `total` tells the client when the cap truncated.
const SEARCH_RESULT_CAP = 100;
app.get('/api/search', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  const registered = listRegisteredSessions();
  const active = getActiveSessions(registered);
  const { previous, indexing } = getPreviousSessions(registered);
  const parsed = parseSessionQuery(query);
  const contentTokens = positiveQueryTokens(parsed);
  const results = [];
  for (const session of [...active, ...previous]) {
    let snippets = [], matchCount = 0;
    if (evaluateSessionQuery(parsed, session)) {
      if (contentTokens.length && session.sessionFile) {
        ({ snippets, count: matchCount } =
          buildSnippets(sessionIndex.getSearchText(session.sessionFile), contentTokens));
      }
    } else {
      if (!contentTokens.length || !session.sessionFile) continue;
      const text = sessionIndex.getSearchText(session.sessionFile);
      if (!evaluateSessionQuery(parsed, session, text)) continue;
      ({ snippets, count: matchCount } = buildSnippets(text, contentTokens));
    }
    results.push({ ...session, snippets, matchCount });
  }
  results.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  res.json({ results: results.slice(0, SEARCH_RESULT_CAP), total: results.length, indexing });
});

const emptyUsage = () => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, calls: 0, measured: 0, durationMs: 0, slowestMs: 0 });
function addUsage(to, from) {
  if (!from) return to;
  for (const k of Object.keys(to.tokens)) to.tokens[k] += from.tokens?.[k] || 0;
  for (const k of Object.keys(to.costs)) to.costs[k] += from.costs?.[k] || 0;
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

app.get('/api/usage-summary', (req, res) => {
  const range = String(req.query.days || '30');
  if (!['1', '7', '30', 'all'].includes(range)) return res.status(400).json({ error: 'days must be 1, 7, 30, or all' });
  const sort = String(req.query.sort || 'cost');
  if (!['cost', 'tokens'].includes(sort)) return res.status(400).json({ error: 'sort must be cost or tokens' });
  const candidates = enumerateSessionCandidates();
  const scan = sessionIndex.scanSessions(candidates.map(c => c.file));
  const cutoff = range === 'all' ? null : localDay(Number(range) - 1);
  const totals = emptyUsage(), byModel = new Map(), byWorkspace = new Map(), bySession = new Map();
  const modelOwners = [];
  const dailyMap = new Map(), dailyModels = new Map(), headline = { today: 0, days7: 0, days30: 0, all: 0, month: 0 };
  const now = new Date(), monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
  for (const c of candidates) {
    const info = scan.infos.get(c.file), usage = info?.usage;
    if (!usage) continue;
    const selected = emptyUsage();
    for (const [day, bucket] of Object.entries(usage.days || {})) {
      const cost = bucket.costs?.total || 0;
      const dated = day !== 'unknown';
      headline.all += cost;
      if (dated && day === localDay()) headline.today += cost;
      if (dated && day >= localDay(6)) headline.days7 += cost;
      if (dated && day >= localDay(29)) headline.days30 += cost;
      if (dated) addUsage(dailyMap.get(day) || (dailyMap.set(day, emptyUsage()), dailyMap.get(day)), bucket);
      if (dated && day.startsWith(monthPrefix)) headline.month += cost;
      if (!cutoff || (dated && day >= cutoff)) addUsage(selected, bucket);
    }
    addUsage(totals, selected);
    if (selected.calls) {
      addUsage(byWorkspace.get(info.cwd || usage.cwd || '(unknown)') || (byWorkspace.set(info.cwd || usage.cwd || '(unknown)', emptyUsage()), byWorkspace.get(info.cwd || usage.cwd || '(unknown)')), selected);
      bySession.set(c.id, { id: c.id, name: info.name || c.id, workspace: info.cwd || usage.cwd || null, ...selected });
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
        modelOwners.push({ ref, sessionId: c.id, workspace: info.cwd || usage.cwd || '(unknown)', calls: modelSelected.calls });
      }
    }
  }
  // Do not make history wait on a host `pi --list-models` subprocess. Startup
  // warms this cache (and /api/models refreshes it); persisted nonzero costs
  // still identify priced calls while a catalog is unavailable.
  const pricedRefs = new Set((modelsCache || []).filter(m => m.pricing).map(m => `${m.provider}/${m.id}`));
  const freeRefs = new Set((modelsCache || []).filter(m => m.free).map(m => `${m.provider}/${m.id}`));
  let unpricedModelCalls = 0;
  for (const [ref, b] of byModel) {
    b.priced = b.costs.total !== 0 || pricedRefs.has(ref) || freeRefs.has(ref);
    if (!b.priced) {
      b.unpricedCalls = b.calls;
      unpricedModelCalls += b.calls;
    }
  }
  for (const owner of modelOwners) {
    if (byModel.get(owner.ref)?.priced !== false) continue;
    const session = bySession.get(owner.sessionId);
    const workspace = byWorkspace.get(owner.workspace);
    if (session) session.unpricedCalls = (session.unpricedCalls || 0) + owner.calls;
    if (workspace) workspace.unpricedCalls = (workspace.unpricedCalls || 0) + owner.calls;
  }
  totals.unpricedCalls = unpricedModelCalls;
  // Rank by the same token total the client displays (reasoning stays out of
  // the sum there too), so the sorted order matches the numbers on screen.
  const displayedTokens = t => (t?.input || 0) + (t?.output || 0) + (t?.cacheRead || 0) + (t?.cacheWrite || 0);
  const rank = b => sort === 'tokens' ? displayedTokens(b.tokens) : b.costs.total;
  const top = map => [...map.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => rank(b) - rank(a) || b.calls - a.calls).slice(0, 20);
  // The daily series spans the requested range (for 'all', from the earliest
  // dated usage, capped at a year) so the chart always reflects the selected
  // window. Each day carries a per-model breakdown so the client can stack the
  // chart by model and open day details without another request.
  const DAILY_SPAN_CAP = 365;
  let spanDays = range === 'all' ? 1 : Number(range);
  if (range === 'all') {
    let earliest = null;
    for (const day of dailyMap.keys()) if (!earliest || day < earliest) earliest = day;
    if (earliest) {
      const [y, m, d] = earliest.split('-').map(Number);
      const start = new Date(y, m - 1, d, 12), today = new Date(); today.setHours(12, 0, 0, 0);
      spanDays = Math.min(DAILY_SPAN_CAP, Math.max(1, Math.round((today - start) / 86400000) + 1));
    }
  }
  const daily = Array.from({ length: spanDays }, (_, i) => {
    const day = localDay(spanDays - 1 - i);
    const models = [...(dailyModels.get(day)?.entries() || [])]
      .map(([ref, b]) => ({ ref, provider: b.provider, model: b.model, calls: b.calls, cost: b.costs.total, tokens: b.tokens }))
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
    return { day, ...(dailyMap.get(day) || emptyUsage()), models };
  });
  res.json({ range, sort, totals, groups: { models: top(byModel), workspaces: top(byWorkspace), sessions: [...bySession.values()].sort((a, b) => rank(b) - rank(a) || b.calls - a.calls).slice(0, 20) }, headlineCosts: headline, daily, unpricedModelCalls, indexing: scan.indexing, monthlyBudgetUsd: readDishSettings().monthlyBudgetUsd ?? null });
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
function messageForClient(sessionId, message, index) {
  if (!Array.isArray(message.content)) return { ...message, index };
  let changed = false;
  const content = message.content.map((block, blockIndex) => {
    if (!block || block.type !== 'image' || typeof block.data !== 'string' || !block.data) return block;
    changed = true;
    const { data, ...metadata } = block;
    return {
      ...metadata,
      mimeType: block.mimeType || 'image/png',
      url: `/api/sessions/${encodeURIComponent(sessionId)}/messages/${index}/images/${blockIndex}`,
    };
  });
  return { ...message, ...(changed ? { content } : {}), index };
}

app.get('/api/sessions/:id/messages/:messageIndex/images/:blockIndex', (req, res) => {
  const messageIndex = Number(req.params.messageIndex);
  const blockIndex = Number(req.params.blockIndex);
  if (!Number.isInteger(messageIndex) || messageIndex < 0 ||
      !Number.isInteger(blockIndex) || blockIndex < 0) {
    return res.status(400).json({ error: 'valid message and image indexes required' });
  }
  const sessionFile = findSessionFile(req.params.id);
  if (!sessionFile) return res.status(404).json({ error: 'Session not found' });
  const block = readSessionMessages(sessionFile)[messageIndex]?.content?.[blockIndex];
  if (!block || block.type !== 'image' || typeof block.data !== 'string' || !block.data) {
    return res.status(404).json({ error: 'Image not found' });
  }
  const mimeType = /^image\/[A-Za-z0-9.+-]+$/.test(block.mimeType || '') ? block.mimeType : 'image/png';
  res.setHeader('Cache-Control', 'private, no-cache');
  res.type(mimeType).send(Buffer.from(block.data, 'base64'));
});

app.get('/api/sessions/:id/messages', (req, res) => {
  const sessionId = req.params.id;
  const isActive = !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId);

  const sessionFile = findSessionFile(sessionId);
  if (!sessionFile) {
    return res.json({
      messages: [], session: { id: sessionId, isActive },
      totalMessages: 0, firstIndex: null, lastIndex: null, hasMore: false,
    });
  }

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

  const info = parseSessionFile(sessionFile);
  // Overlay live context usage when the session can report it.
  const liveUsage = getLiveContextUsage(sessionId);
  if (liveUsage) {
    if (liveUsage.tokens != null) info.contextTokens = liveUsage.tokens;
    if (liveUsage.percent != null) info.contextPercent = roundPercent(liveUsage.percent);
    if (liveUsage.contextWindow) info.contextWindow = liveUsage.contextWindow;
  }
  const all = readSessionMessages(sessionFile);
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
      session: { id: sessionId, isActive, ...info },
      totalMessages,
      firstIndex: null,
      lastIndex: null,
      hasMore: startIdx > 0 && totalMessages > 0,
    });
  }

  const slice = all.slice(startIdx, endIdx + 1)
    .map((m, i) => messageForClient(sessionId, m, startIdx + i));
  res.json({
    messages: slice,
    session: { id: sessionId, isActive, ...info },
    totalMessages,
    firstIndex: startIdx,
    lastIndex: endIdx,
    hasMore: startIdx > 0,
  });
});

// In-session text search: returns the stream indexes of messages whose text
// content matches all whitespace-separated tokens (case-insensitive). The
// frontend uses this to jump backwards/forwards through matches.
app.get('/api/sessions/:id/search', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  if (!query) return res.json({ matches: [], totalMessages: 0 });
  const sessionFile = findSessionFile(req.params.id);
  if (!sessionFile) return res.status(404).json({ error: 'Session not found' });

  const tokens = query.split(/\s+/).filter(Boolean);
  const all = readSessionMessages(sessionFile);
  const matches = [];
  for (let i = 0; i < all.length; i++) {
    const text = extractTextContent(all[i].content).toLowerCase();
    if (text && tokens.every(t => text.includes(t))) matches.push({ index: i, role: all[i].role });
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
  try {
    const sess = await getLiveSession(req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session not active' });
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
    const result = await sess.steer(message || '', images.length ? { images } : {});
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
  if ((kind !== 'steering' && kind !== 'followUp') || typeof text !== 'string' || !text) {
    return res.status(400).json({ error: 'kind (steering|followUp) and non-empty text required' });
  }
  if (index !== undefined && !Number.isInteger(index)) {
    return res.status(400).json({ error: 'index must be an integer' });
  }
  try {
    const sess = await getLiveSession(req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session not active' });
    if (!(sess instanceof BridgeSession)) {
      return res.status(501).json({ error: 'queue editing requires the pi-dish-bridge extension' });
    }
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
      const result = await rpc.compact(args || undefined);
      rpc._refreshStats();
      const saved = result ? ` (${result.tokensBefore} → ~${result.estimatedTokensAfter} tokens)` : '';
      return { info: `Compacted${saved}` };
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
    const sessionFile = findSessionFile(sessionId);
    if (!sessionFile) return res.status(404).json({ error: 'Session not found' });

    const { tokens, reasoningTokens, cost, costs, responseTiming, userMessages, assistantMessages, toolCalls, toolResults, genMs, genOutput } =
      getSessionStats(sessionFile);

    const reg = getRegisteredSession(sessionId);
    const contextUsage = getLiveContextUsage(sessionId);
    const info = parseSessionFile(sessionFile);
    res.json({
      sessionFile,
      sessionId,
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
    const sessionFile = findSessionFile(req.params.id);
    if (!sessionFile) return res.status(404).json({ error: 'Session not found' });
    const outPath = path.join(os.tmpdir(), `pi-dish-export-${req.params.id.slice(-12)}.html`);
    const htmlPath = await piSDK.exportSessionHtml(sessionFile, outPath);
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
  const sessionFile = findSessionFile(share.sessionId);
  if (!sessionFile) return res.status(404).type('text/plain').send('Not found');
  try {
    const st = fs.statSync(sessionFile);
    const cached = shareExportCache.get(req.params.token);
    let htmlPath;
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size && fs.existsSync(cached.htmlPath)) {
      htmlPath = cached.htmlPath;
    } else {
      // Token is base64url (A-Za-z0-9_-), so it's already a safe basename.
      const outPath = path.join(os.tmpdir(), `pi-dish-share-${req.params.token}.html`);
      htmlPath = await piSDK.exportSessionHtml(sessionFile, outPath);
      shareExportCache.set(req.params.token, { mtimeMs: st.mtimeMs, size: st.size, htmlPath });
    }
    res.type('html');
    res.sendFile(htmlPath);
  } catch (e) {
    res.status(500).type('text/plain').send('Export failed');
  }
}

app.post('/api/sessions/:id/share', (req, res) => {
  if (!findSessionFile(req.params.id)) return res.status(404).json({ error: 'Session not found' });
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
  return candidates[0].sessionId;
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
  if (!sessionId || (!findSessionFile(sessionId) && !getRegisteredSession(sessionId))) {
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
  if (!req.body?.sessionId || req.body.sessionId !== existing.sessionId) {
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
  const associatedSessionId = sessionId || inferSessionForPath(root);
  const token = pages.createPage({ root, title: title || null, sessionId: associatedSessionId || null });
  res.json(pagePayload(token, pages.getPage(token)));
});

app.get('/api/pages', (req, res) => {
  let list = pages.listPages();
  if (req.query.sessionId) list = list.filter((p) => p.sessionId === req.query.sessionId);
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

// /reload against a bridge session, with two escape hatches:
// - Bridges that fire the reload in the same tick as their run_command
//   response lose the response frame to their own socket teardown — a
//   "socket closed" rejection on /reload specifically is the signature of a
//   reload that *started*, not a failure. Report success; the bridge
//   re-registers itself after re-evaluating.
// - Bridges that can't run it at all (no emulated reload / no captured
//   AgentSession — exactly the state a running TUI is in when its loaded
//   bridge predates the current one) fall back to typing /reload into the
//   session's own tmux pane, when one can be located. That's also the only
//   path that can upgrade an out-of-date bridge from the UI.
async function reloadBridgeSession(sess, sessionId) {
  try {
    const data = await sess.runCommand('/reload');
    return { info: data?.info || 'Reloading extensions…' };
  } catch (e) {
    if (/socket closed/i.test(e?.message || '')) return { info: 'Reloading extensions…' };
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
    res.status(400).json({ error: e.message });
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
      await sess.setName(name);
      return res.json({ success: true });
    }
    // Inactive session: append a session_info entry to the JSONL directly.
    const sessionPath = findSessionFile(req.params.id);
    if (!sessionPath) return res.status(404).json({ error: 'Session not found' });
    await piSDK.renameSession(sessionPath, name);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/:id/model', async (req, res) => {
  const { modelId } = req.body;
  if (!modelId) return res.status(400).json({ error: 'modelId required' });
  const { provider, id } = parseModelId(modelId);
  if (!provider || !id) return res.status(400).json({ error: `Invalid model ID: ${modelId}` });
  try {
    const sess = await getLiveSession(req.params.id);
    if (sess) {
      // The two backends take different setModel shapes (bridge: one ref
      // string, RPC: provider + id on the wire).
      if (sess instanceof BridgeSession) await sess.setModel(`${provider}/${id}`);
      else await sess.setModel(provider, id);
      return res.json({ success: true });
    }
    // Inactive session: append a model_change entry to the JSONL directly.
    const sessionPath = findSessionFile(req.params.id);
    if (!sessionPath) return res.status(404).json({ error: 'Session not found' });
    await piSDK.switchModel(sessionPath, provider, id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sessions/:id/tree', async (req, res) => {
  try {
    const sessionPath = findSessionFile(req.params.id);
    if (!sessionPath) return res.status(404).json({ error: 'Session not found' });
    const tree = await piSDK.getSessionTree(sessionPath);
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
    const sess = await getLiveSession(req.params.id);
    if (sess) {
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
    const sessionPath = findSessionFile(req.params.id);
    if (!sessionPath) return res.status(404).json({ error: 'Session not found' });
    const result = await piSDK.branchSession(sessionPath, entryId, opts);
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

app.get('/api/models', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (sessionId) {
      const sessionModels = await getSessionModels(sessionId);
      if (sessionModels) return res.json(annotateEnabled(sessionModels));
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
// everything is enabled. pi only rewrites settings fields it modified itself
// (merge-on-save under a file lock), so this survives a running TUI unless
// that session also edits enabledModels; running sessions pick the new scope
// up on their next launch.
app.put('/api/models/enabled', (req, res) => {
  const { enabledIds } = req.body || {};
  const clearing = enabledIds == null;
  if (!clearing && (!Array.isArray(enabledIds) ||
      !enabledIds.every(id => typeof id === 'string' && id.trim()))) {
    return res.status(400).json({ error: 'enabledIds must be null or an array of model ids' });
  }
  try {
    const settings = readPiSettings();
    if (clearing || enabledIds.length === 0) delete settings.enabledModels;
    else settings.enabledModels = enabledIds;
    fs.mkdirSync(path.dirname(PI_SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(PI_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    res.json({ success: true, enabledModels: settings.enabledModels || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/commands', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (sessionId) {
      // Ask the live session — it knows exactly which commands exist there.
      try {
        const sess = await getLiveSession(sessionId);
        if (sess instanceof BridgeSession) {
          const data = await sess.getCommands();
          if (data?.commands) return res.json(data.commands);
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
  const rpc = getRPCSession(sessionId);
  const reg = getRegisteredSession(sessionId);
  let exited;
  if (rpc?.alive) {
    rpc.kill();
    // Our own child: kill(pid, 0) still succeeds while it's a zombie, so wait
    // on the 'exit'-driven flag instead of the pid.
    exited = () => !rpc.alive;
  } else if (reg?.pid) {
    try {
      process.kill(reg.pid, 'SIGTERM');
    } catch (e) {
      if (e.code !== 'ESRCH') {
        return res.status(500).json({ error: `Failed to signal pi (pid ${reg.pid}): ${e.message}` });
      }
    }
    exited = () => !pidAlive(reg.pid);
  } else {
    return res.status(404).json({ error: 'Session not active' });
  }

  const timeoutMs = Number(process.env.PI_DISH_CLOSE_TIMEOUT_MS) || 10000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited()) {
      // The client re-fetches the session list on this response — don't let
      // the registry memo serve the dead session as live for another 500ms.
      invalidateRegistryCache();
      return res.json({ success: true });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  res.status(500).json({ error: `pi did not exit within ${Math.round(timeoutMs / 1000)}s — it may be stuck; check the process directly` });
});

app.get('/api/cwds', (req, res) => {
  try {
    const cwdSet = new Set();
    let dirs = [];
    try { dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }); } catch {}
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = path.join(SESSIONS_DIR, dir.name);
      let files = [];
      try { files = fs.readdirSync(dirPath); } catch {}
      const jsonlFile = files.find(f => f.endsWith('.jsonl'));
      if (!jsonlFile) continue;
      const cwd = readSessionCwd(path.join(dirPath, jsonlFile));
      if (cwd) cwdSet.add(cwd);
    }
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
      const registered = new Set(listRegisteredSessions().map((r) => r.sessionId));
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

// Best-known working directory for a session: live registry first, then the
// JSONL header. Null when neither knows (terminal + file search fall back).
function resolveSessionCwd(sessionId) {
  const reg = getRegisteredSession(sessionId);
  if (reg?.cwd) return reg.cwd;
  const sessionFile = findSessionFile(sessionId);
  if (sessionFile) {
    try { return parseSessionFile(sessionFile).cwd || null; } catch {}
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
  const sessionFile = findSessionFile(sessionId);
  if (!cwd && !sessionFile) return { error: 'Unknown session', status: 404 };
  let messages = [];
  if (sessionFile) { try { messages = readSessionMessages(sessionFile); } catch {} }
  const resolved = await resolveFileMention(mention, { cwd, messages });
  if (!resolved) return { error: `Couldn't find "${mention}" among this session's files`, status: 404 };
  return { cwd, resolved };
}

// Image previews use a normal resource response instead of base64 JSON. The
// same session-aware resolver gates both metadata and bytes, so this does not
// create a path traversal shortcut around the file viewer's reach rules.
app.get('/api/sessions/:id/file/content', async (req, res) => {
  try {
    const mention = String(req.query.path || '');
    if (!mention || mention.length > 1024) return res.status(400).json({ error: 'path required' });
    const found = await resolveViewerMention(req.params.id, mention);
    if (found.error) return res.status(found.status).json({ error: found.error });
    const file = readFileForViewer(found.resolved.absPath, { imageData: 'buffer' });
    if (file.error) return res.status(file.status || 415).json({ error: file.error, path: found.resolved.absPath });
    if (!file.image?.buffer) return res.status(415).json({ error: 'File is not an image' });
    res.setHeader('Cache-Control', 'private, no-cache');
    res.type(file.image.mimeType).send(file.image.buffer);
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
const diffSnapshots = new Map(); // sessionId -> { cwd, at, data }

function rememberDiffSnapshot(sessionId, cwd, data) {
  diffSnapshots.delete(sessionId);
  diffSnapshots.set(sessionId, { cwd, at: Date.now(), data });
  while (diffSnapshots.size > 4) diffSnapshots.delete(diffSnapshots.keys().next().value);
}

// A large pane receives metadata first. Patch lookup selects from the exact
// aggregate snapshot used for that response (rather than accepting a path to
// pass to git), preserving both security and within-pane consistency.
app.get('/api/sessions/:id/diff/patch', async (req, res) => {
  try {
    const repoPath = String(req.query.repo || '');
    const filePath = String(req.query.path || '');
    if (!repoPath || !filePath || repoPath.length > 2048 || filePath.length > 4096) {
      return res.status(400).json({ error: 'repo and path required' });
    }
    const cwd = resolveSessionCwd(req.params.id);
    if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
    let snapshot = diffSnapshots.get(req.params.id);
    if (!snapshot || snapshot.cwd !== cwd || Date.now() - snapshot.at > DIFF_SNAPSHOT_TTL_MS) {
      const data = await aggregateDiffs(cwd, { inlineLimit: DIFF_INLINE_FILE_LIMIT });
      rememberDiffSnapshot(req.params.id, cwd, data);
      snapshot = diffSnapshots.get(req.params.id);
    } else {
      // Browsing a large diff means patch fetches spread over minutes: touch
      // the snapshot on every hit (re-stamps `at` and its eviction order), or
      // the TTL/insertion-order eviction silently swaps in a rebuild of a
      // changed tree that no longer matches the summary the pane is showing.
      rememberDiffSnapshot(req.params.id, cwd, snapshot.data);
    }
    const repo = snapshot.data.repos.find(item => item.path === repoPath);
    const file = repo?.files.find(item => item.path === filePath);
    if (!repo || !file) return res.status(404).json({ error: 'Patch not found' });
    const patch = file.patch ? file : await getFilePatch(path.resolve(cwd, repo.path), file);
    if (!patch?.patch) return res.status(404).json({ error: 'Patch not found' });
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
    rememberDiffSnapshot(req.params.id, cwd, data);
    res.json(data);
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
function findSessionBySpawnToken(token) {
  let files;
  try { files = fs.readdirSync(REGISTRY_DIR); } catch { return null; }
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, name), 'utf8'));
      if (entry && entry.spawnToken === token && entry.sessionId) return entry;
    } catch {}
  }
  return null;
}

// Build the tmux child argv+env from the same launch spec RPC uses (so a
// PI_DISH_PI_COMMAND wrapper or a simple `pi` alias's env carries over), open
// the window, and wait up to 30s for the session to register. The window is
// left open on timeout for the user to inspect. `args` are pi's CLI args
// (a TUI launch — never --mode rpc). Returns the registered session id.
async function spawnPiInTmux({ target, args, cwd, hidden }) {
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

  const spec = getPiLaunchSpec();
  const token = crypto.randomBytes(16).toString('hex');
  const env = { ...spec.env, PI_DISH_SPAWN_TOKEN: token };
  // tmux windows don't inherit this process's env — pass the server URL
  // through so the pi-dish-pages skill works in tmux-spawned sessions too.
  if (process.env.PI_DISH_URL) env.PI_DISH_URL = process.env.PI_DISH_URL;
  const command = [...spec.argv, ...args];

  let paneId;
  try {
    ({ paneId } = await tmux.spawnInTmux({
      socket,
      tmuxSession: target.tmuxSession,
      newTmuxSessionName: target.newTmuxSession,
      cwd: cwd || process.env.HOME,
      command,
      env,
    }));
  } catch (e) {
    const err = new Error(`Failed to open tmux window: ${e.message}`); err.status = 500; throw err;
  }

  const timeoutMs = Number(process.env.PI_DISH_SPAWN_TIMEOUT_MS) || 30000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = findSessionBySpawnToken(token);
    if (entry) {
      tmux.recordSpawn(entry.sessionId, { socket, paneId });
      // Prime the command context so POST /branch can navigate the tree
      // remotely (TUI sessions otherwise 409 — see the branch route).
      tmux.sendKeys(socket, paneId, '/dish-prime').catch(() => {});
      return entry.sessionId;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  // A user-targeted window stays open for inspection; a hidden headless
  // window is invisible — leaving it would just leak a pi nobody can see.
  if (hidden) tmux.killPane(socket, paneId).catch(() => {});
  const err = new Error(`pi did not register within ${Math.round(timeoutMs / 1000)}s — ${hidden ? 'the hidden headless window was closed' : 'the tmux window was left open for inspection'}. Ensure the pi-dish-bridge extension is installed in pi's global extensions.`);
  err.status = 500;
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

function headlessTmuxEnabled() {
  const mode = process.env.PI_DISH_HEADLESS || '';
  if (mode === 'rpc') return false;
  if (!tmux.isTmuxAvailable()) return false;
  if (mode === 'tmux') return true;
  if (headlessTmuxBroken) return false;
  const home = process.env.HOME || os.homedir();
  return fs.existsSync(path.join(home, '.pi', 'agent', 'extensions', 'pi-dish-bridge'));
}

// Serialized: two concurrent spawns must not both decide the hidden session
// doesn't exist yet and race their `new-session` calls.
let headlessSpawnChain = Promise.resolve();
function spawnPiHeadlessTmux(opts) {
  const run = headlessSpawnChain.then(() => _spawnPiHeadlessTmux(opts));
  headlessSpawnChain = run.then(() => {}, () => {});
  return run;
}

async function _spawnPiHeadlessTmux({ args, cwd }) {
  // tmux won't create its tmpdir for -S sockets (only for -L); 0700 matches
  // what tmux itself would create.
  fs.mkdirSync(tmux.tmuxTmpdir(), { recursive: true, mode: 0o700 });
  const socket = path.join(tmux.tmuxTmpdir(), HEADLESS_TMUX_SERVER);
  const target = (await tmux.hasSession(socket, HEADLESS_TMUX_SESSION))
    ? { socket, tmuxSession: HEADLESS_TMUX_SESSION }
    : { socket, newTmuxSession: HEADLESS_TMUX_SESSION };
  return spawnPiInTmux({ target, args, cwd, hidden: true });
}

// Spawn a fresh session. Default ("headless"): a hidden tmux window when the
// headless-tmux path is available (survives server restarts), else a
// `pi --mode rpc` child (dies with this server). An explicit `target:
// { type: 'tmux', socket, tmuxSession }` or `{ ..., newTmuxSession }` opens a
// pi TUI in one of the user's own tmux sessions instead.
app.post('/api/sessions/new', async (req, res) => {
  try {
    let { model, cwd, target } = req.body || {};
    if (cwd && cwd.startsWith('~')) {
      cwd = path.join(process.env.HOME, cwd.slice(1).replace(/^\//, ''));
    }
    const args = model ? ['--model', model] : [];
    if (target && target.type === 'tmux') {
      const id = await spawnPiInTmux({ target, args, cwd });
      return res.json({ success: true, id });
    }
    if (headlessTmuxEnabled()) {
      try {
        const id = await spawnPiHeadlessTmux({ args, cwd });
        return res.json({ success: true, id });
      } catch (e) {
        headlessTmuxBroken = true;
        console.error('Headless tmux spawn failed — falling back to an RPC child:', e.message);
      }
    }
    const rpc = await createRPCSession({ model, cwd });
    res.json({ success: true, id: rpc.id });
  } catch (e) {
    console.error('Failed to create session:', e);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// Resume an inactive session. Default: the same headless dispatch as /new
// (hidden tmux when available, else an RPC `pi --mode rpc --session <path>`
// child); with a tmux `target`, `pi --session <path>` in that window instead.
app.post('/api/sessions/:id/resume', async (req, res) => {
  const sessionId = req.params.id;

  if (getRegisteredSession(sessionId) || getRPCSession(sessionId)?.alive) {
    return res.json({ success: true, id: sessionId, alreadyActive: true });
  }

  const sessionFile = findSessionFile(sessionId);
  if (!sessionFile) return res.status(404).json({ error: 'Session file not found' });

  let cwd = readSessionCwd(sessionFile);

  if (cwd && !fs.existsSync(cwd)) {
    console.warn(`Session cwd ${cwd} doesn't exist, using HOME`);
    cwd = process.env.HOME;
  }

  const target = req.body?.target;
  try {
    if (target && target.type === 'tmux') {
      const id = await spawnPiInTmux({ target, args: ['--session', sessionFile], cwd });
      return res.json({ success: true, id });
    }
    if (headlessTmuxEnabled()) {
      try {
        const id = await spawnPiHeadlessTmux({ args: ['--session', sessionFile], cwd });
        return res.json({ success: true, id });
      } catch (e) {
        headlessTmuxBroken = true;
        console.error('Headless tmux resume failed — falling back to an RPC child:', e.message);
      }
    }
    const rpc = await resumeRPCSession(sessionFile, cwd || process.env.HOME);
    res.json({ success: true, id: rpc.id });
  } catch (e) {
    console.error('Failed to resume session:', e);
    res.status(e.status || 500).json({ error: e.message });
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

function findSessionFile(sessionId) {
  const reg = getRegisteredSession(sessionId);
  if (reg && reg.sessionFile && fs.existsSync(reg.sessionFile)) return reg.sessionFile;
  const rpc = getRPCSession(sessionId);
  const rpcFile = rpc?.sessionFile || rpc?.state?.sessionFile;
  if (rpcFile && fs.existsSync(rpcFile)) return rpcFile;

  const cached = sessionFileCache.get(sessionId);
  if (cached && fs.existsSync(cached)) return cached;

  try {
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const files = fs.readdirSync(path.join(SESSIONS_DIR, dir.name))
        .filter(f => f.includes(sessionId) && f.endsWith('.jsonl'));
      if (files.length) {
        const found = path.join(SESSIONS_DIR, dir.name, files[0]);
        if (sessionFileCache.size >= 500) sessionFileCache.clear();
        sessionFileCache.set(sessionId, found);
        return found;
      }
    }
  } catch (e) {}
  return null;
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
