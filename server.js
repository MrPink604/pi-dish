const express = require('express');
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
const { aggregateDiffs } = require('./lib/git-diff');
const terminal = require('./lib/terminal');
const tmux = require('./lib/tmux');
const shares = require('./lib/shares');
const pages = require('./lib/pages');
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
  sessionMetaText, parseModelId, formatModelRef, buildSnippet,
} = require('./public/helpers');

const app = express();
const PORT = process.env.PORT || 3333;
// Localhost-only by default; opt in to LAN/VPN exposure explicitly, e.g.
// HOST=0.0.0.0 (all interfaces) or HOST=<tailscale ip>. There is no auth —
// anything that can reach the port can drive agents with shell access.
const HOST = process.env.HOST || '127.0.0.1';

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
  return {
    id: model.id || model.modelId,
    name: model.name || model.id || model.modelId,
    provider: model.provider,
    contextWindow: model.contextWindow || 0,
    reasoning: !!model.reasoning,
    free: !!(model.free || (model.cost && model.cost.input === 0 && model.cost.output === 0)),
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
 *   else from our spawn placement; session/window resolved live (null fields
 *   when the pane query fails — the socket name alone still locates it)
 * - terminal: bridge-registered but not in tmux (a plain terminal somewhere)
 * RPC is checked first on purpose: RPC children also load the bridge and
 * inherit this server's own $TMUX, which would misreport them as tmux TUIs.
 */
async function describeRuntime(sessionId) {
  const rpc = getRPCSession(sessionId);
  if (rpc?.alive) return { kind: 'rpc', pid: rpc.proc?.pid ?? null };
  const reg = getRegisteredSession(sessionId);
  if (!reg) return null;
  const spawn = tmux.getSpawn(sessionId);
  const socket = reg.tmux?.socket || spawn?.socket || null;
  if (socket) {
    const paneId = (reg.tmux?.socket ? reg.tmux.pane : spawn?.paneId) || null;
    const loc = paneId ? await tmux.paneLocation(socket, paneId) : null;
    return {
      kind: 'tmux',
      pid: reg.pid ?? null,
      server: path.basename(socket),
      tmuxSession: loc?.tmuxSession ?? null,
      windowIndex: loc?.windowIndex ?? null,
      windowName: loc?.windowName ?? null,
    };
  }
  return { kind: 'terminal', pid: reg.pid ?? null };
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
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = path.join(SESSIONS_DIR, dir.name);
      for (const file of fs.readdirSync(dirPath)) {
        if (!file.endsWith('.jsonl')) continue;
        // Session ids are the file basename (newer pi prefixes a timestamp,
        // older files are a bare UUID) — matching the bridge registry ids.
        const id = file.slice(0, -'.jsonl'.length);
        if (activeIds.has(id)) continue;
        candidates.push({ file: path.join(dirPath, file), id, dirName: dir.name });
      }
    }

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

// =========================================================================
// Search
// =========================================================================

// null when the session doesn't match; { snippet } when it does. `snippet`
// is set only for matches the metadata alone doesn't explain — the client
// shows it under the row so a content match doesn't look arbitrary.
function matchSessionQuery(session, query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  if (!tokens.length) return {};
  const meta = sessionMetaText(session);
  if (tokens.every(t => meta.includes(t))) return {};
  if (session.sessionFile) {
    const historyText = sessionIndex.getSearchText(session.sessionFile);
    const fullText = meta + ' ' + historyText;
    if (tokens.every(t => fullText.includes(t))) {
      return { snippet: buildSnippet(historyText, tokens) };
    }
  }
  return null;
}

function filterSessionsByQuery(list, query) {
  const out = [];
  for (const session of list) {
    const m = matchSessionQuery(session, query);
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

  const slice = all.slice(startIdx, endIdx + 1).map((m, i) => ({ ...m, index: startIdx + i }));
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

    const { tokens, cost, userMessages, assistantMessages, toolCalls, toolResults } =
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
  const token = pages.createPage({ root, title: title || null, sessionId: sessionId || null });
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
function servePage(req, res) {
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
    return res.sendFile(entry.root, (err) => { if (err) notFound(); });
  }
  if (!rest) return res.redirect(302, `/page/${req.params.token}/`);
  const rel = rest === '/' ? 'index.html' : rest.replace(/^\//, '');
  res.sendFile(rel, { root: entry.root }, (err) => { if (err) notFound(); });
}

app.get('/page/:token', servePage);
app.get('/page/:token/*', (req, res) => {
  // Normalize express 4's wildcard into the shape servePage expects: the
  // rest including its leading slash ('/' for the bare trailing-slash URL).
  req.params[0] = '/' + (req.params[0] || '');
  servePage(req, res);
});

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
          return res.status(409).json({ error: "pi's extension API only hands out session control inside command handlers — run /dish-push once in this session's TUI, then retry. (Web-spawned sessions are primed automatically.)" });
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

// Read a file mentioned in the chat (clickable filenames in the transcript).
// "findings.md" written deep in the tree resolves through the session's own
// tool calls; reads are gated to the cwd subtree + tool-touched paths. See
// lib/file-mention.js.
app.get('/api/sessions/:id/file', async (req, res) => {
  try {
    const mention = String(req.query.path || '');
    if (!mention || mention.length > 1024) return res.status(400).json({ error: 'path required' });
    const cwd = resolveSessionCwd(req.params.id);
    const sessionFile = findSessionFile(req.params.id);
    if (!cwd && !sessionFile) return res.status(404).json({ error: 'Unknown session' });
    let messages = [];
    if (sessionFile) { try { messages = readSessionMessages(sessionFile); } catch {} }
    const resolved = await resolveFileMention(mention, { cwd, messages });
    if (!resolved) {
      return res.status(404).json({ error: `Couldn't find "${mention}" among this session's files` });
    }
    const file = readFileForViewer(resolved.absPath);
    if (file.error) return res.status(file.status || 415).json({ error: file.error, path: resolved.absPath });
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

// Aggregate uncommitted git diffs for every repo under the session cwd (the
// user's workspaces are polyrepos — several checkouts side by side under one
// agent cwd). The cwd comes from the session, never the request, so there's
// no path input to gate. See lib/git-diff.js.
app.get('/api/sessions/:id/diff', async (req, res) => {
  try {
    const cwd = resolveSessionCwd(req.params.id);
    if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
    res.json(await aggregateDiffs(cwd));
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
  shareApp.get('/page/:token', servePage);
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
    const match = TERMINAL_PATH_RE.exec((req.url || '').split('?')[0]);
    if (!match) return socket.destroy();
    const sessionId = decodeURIComponent(match[1]);
    // Only spawn shells for sessions pi-dish actually knows about.
    const known = getRegisteredSession(sessionId) || getRPCSession(sessionId) || findSessionFile(sessionId);
    if (!known) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      try {
        terminal.attachClient(sessionId, resolveSessionCwd(sessionId), ws);
      } catch (e) {
        try { ws.send(JSON.stringify({ type: 'error', error: e.message })); } catch {}
        ws.close(1011, 'terminal failed');
      }
    });
  });

  server.on('close', () => terminal.killAllTerminals());
}

module.exports = server;
