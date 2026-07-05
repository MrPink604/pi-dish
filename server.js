const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const piSDK = require('./lib/pi-sdk');
const { createRPCSession, resumeRPCSession, getRPCSession, getAllRPCSessions } = require('./lib/rpc-session');
const {
  listRegisteredSessions,
  getRegisteredSession,
  getBridgeSession,
} = require('./lib/bridge-session');
const { searchFiles, searchHomeDirs } = require('./lib/file-search');
const {
  getSessionInfo,
  readSessionMessages,
  getSessionSearchText,
  decodeDirToCwd,
} = require('./lib/session-files');
const { isModelEnabled, extractTextContent, THINKING_LEVEL_NAMES } = require('./public/helpers');

const app = express();
const PORT = process.env.PORT || 3333;

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

function formatModelRef(model) {
  if (!model) return null;
  if (typeof model === 'string') return model;
  const provider = model.provider;
  const id = model.id || model.modelId;
  return provider && id ? `${provider}/${id}` : null;
}

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

async function getSessionModels(sessionId) {
  if (!sessionId) return null;
  try {
    if (getRegisteredSession(sessionId)) {
      const sess = await getBridgeSession(sessionId);
      const data = await sess.send('get_available_models');
      return normalizeModels(data?.models || data);
    }
    const rpc = getRPCSession(sessionId);
    if (rpc?.alive) {
      const data = await rpc.getAvailableModels();
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

function getContextWindow(modelId) {
  if (!modelId) return MODEL_CONTEXT_WINDOWS['default'];
  // Prefer live model registry data (populated from pi --list-models)
  if (modelsCache) {
    const m = modelsCache.find(m => m.id === modelId)
      || modelsCache.find(m => modelId.includes(m.id))
      || modelsCache.find(m => m.id.includes(modelId));
    if (m?.contextWindow) return m.contextWindow;
  }
  for (const [prefix, size] of CONTEXT_WINDOW_FALLBACKS) {
    if (modelId.includes(prefix)) return size;
  }
  return MODEL_CONTEXT_WINDOWS['default'];
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
 * Active sessions = sessions registered by the pi-dish-bridge extension.
 * We enrich the registry entry with metadata from the on-disk JSONL.
 */
function getActiveSessions() {
  const active = [];
  const seen = new Set();
  for (const reg of listRegisteredSessions()) {
    let info = {};
    if (reg.sessionFile && fs.existsSync(reg.sessionFile)) {
      try { info = parseSessionFile(reg.sessionFile); } catch {}
    }
    // The bridge reports the session's actual context usage (tokens, window,
    // percent) straight from pi — always prefer it over JSONL guesswork.
    const usage = reg.contextUsage || null;
    active.push({
      id: reg.sessionId,
      name: reg.name || info.name || 'New Session',
      model: reg.model || info.model || 'unknown',
      contextPercent: roundPercent(usage?.percent ?? info.contextPercent) ?? 0,
      contextTokens: usage?.tokens ?? info.contextTokens ?? 0,
      contextWindow: usage?.contextWindow || getContextWindow(reg.model || info.model),
      thinkingLevel: reg.thinkingLevel || null,
      messageCount: info.messageCount || 0,
      lastActivity: info.lastActivity || new Date(),
      isActive: true,
      turnInProgress: !!reg.turnInProgress,
      cwd: reg.cwd || info.cwd || null,
      sessionFile: reg.sessionFile || null,
      pid: reg.pid || null,
    });
    seen.add(reg.sessionId);
  }

  // Sessions spawned by pi-dish via RPC may not be visible through the bridge
  // extension in all pi versions/modes. Include them directly so a freshly
  // created UI session still shows its resolved default model and remains
  // model-switchable.
  for (const rpc of getAllRPCSessions()) {
    if (!rpc.alive || seen.has(rpc.id)) continue;
    const state = rpc.state || {};
    const model = formatModelRef(state.model) || formatModelRef(rpc.model) || 'unknown';
    const usage = rpc.lastStats?.contextUsage || null;
    active.push({
      id: rpc.id,
      name: state.sessionName || state.name || 'New Session',
      model,
      contextPercent: roundPercent(usage?.percent) ?? 0,
      contextTokens: usage?.tokens ?? 0,
      contextWindow: usage?.contextWindow || state.model?.contextWindow || 0,
      thinkingLevel: state.thinkingLevel || null,
      messageCount: state.messageCount || 0,
      lastActivity: new Date(),
      isActive: true,
      turnInProgress: !!rpc.turnInProgress,
      cwd: rpc.cwd || null,
      sessionFile: rpc.sessionFile || state.sessionFile || null,
      pid: rpc.proc?.pid || null,
    });
    seen.add(rpc.id);
  }

  active.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  return active;
}

function getPreviousSessions() {
  const activeIds = new Set([
    ...listRegisteredSessions().map(r => r.sessionId),
    ...getAllRPCSessions().filter(s => s.alive).map(s => s.id),
  ]);
  const previous = [];

  try {
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = path.join(SESSIONS_DIR, dir.name);
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        // Session ids are the file basename (newer pi prefixes a timestamp,
        // older files are a bare UUID) — matching the bridge registry ids.
        const id = file.slice(0, -'.jsonl'.length);
        if (activeIds.has(id)) continue;

        // One unreadable file must not take down the whole listing.
        let info;
        try { info = parseSessionFile(path.join(dirPath, file)); } catch { continue; }
        previous.push({
          id,
          name: info.name || id.slice(0, 8),
          model: info.model || 'unknown',
          contextPercent: info.contextPercent || 0,
          contextTokens: info.contextTokens || 0,
          messageCount: info.messageCount || 0,
          lastActivity: info.lastActivity,
          isActive: false,
          cwd: info.cwd || decodeDirToCwd(dir.name),
          sessionFile: path.join(dirPath, file),
        });
      }
    }
  } catch (e) {
    console.error('Error scanning sessions:', e);
  }

  previous.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  return previous;
}

// =========================================================================
// Search
// =========================================================================

function sessionMatchesQuery(session, query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const meta = [
    session.name || '',
    session.cwd || '',
    session.model || '',
    session.id || '',
  ].join(' ').toLowerCase();
  if (tokens.every(t => meta.includes(t))) return true;
  if (session.sessionFile) {
    const historyText = getSessionSearchText(session.sessionFile);
    const fullText = meta + ' ' + historyText;
    return tokens.every(t => fullText.includes(t));
  }
  return false;
}

// =========================================================================
// API Routes
// =========================================================================

app.get('/api/sessions', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  let active = getActiveSessions();
  let previous = getPreviousSessions();

  if (query) {
    const match = (s) => sessionMatchesQuery(s, query);
    active = active.filter(match);
    previous = previous.filter(match);
  }
  res.json({ active, previous });
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
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 50));
  const before = req.query.before != null ? parseInt(req.query.before, 10) : null;
  const after = req.query.after != null ? parseInt(req.query.after, 10) : null;

  const info = parseSessionFile(sessionFile);
  // Overlay live context usage when the session can report it.
  const reg = getRegisteredSession(sessionId);
  const rpcSess = getRPCSession(sessionId);
  const liveUsage = reg?.contextUsage || rpcSess?.lastStats?.contextUsage || null;
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
function sanitizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((i) => i && typeof i.data === 'string' && i.data && typeof i.mimeType === 'string' && i.mimeType.startsWith('image/'))
    .map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType }));
}

app.post('/api/sessions/:id/prompt', async (req, res) => {
  const { message, deliverAs } = req.body;
  const images = sanitizeImages(req.body.images);
  if (!message && !images.length) return res.status(400).json({ error: 'Message required' });
  try {
    const registered = getRegisteredSession(req.params.id);
    const rpc = getRPCSession(req.params.id);
    const sess = registered ? await getBridgeSession(req.params.id) : rpc;
    if (!sess?.alive) return res.status(404).json({ error: 'Session not active' });
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
    const rpc = getRPCSession(req.params.id);
    const sess = getRegisteredSession(req.params.id) ? await getBridgeSession(req.params.id) : rpc;
    if (!sess?.alive) return res.status(404).json({ error: 'Session not active' });
    await sess.steer(message || '', images.length ? { images } : {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
      rpc.state = { ...(rpc.state || {}), sessionName: args, name: args };
      return { info: 'Session renamed' };
    case 'thinking':
      if (!args) throw new Error('usage: /thinking <off|minimal|low|medium|high|xhigh>');
      await rpc.setThinkingLevel(args);
      return { info: `Thinking level: ${args}` };
    case 'model': {
      if (!args) throw new Error('usage: /model <provider/model-id>');
      let { provider, id } = piSDK.parseModelId(args);
      if (!provider) {
        const data = await rpc.getAvailableModels();
        const models = data?.models || [];
        const m = models.find(x => x.id === args) || models.find(x => x.id.includes(args));
        if (!m) throw new Error(`model not found: ${args}`);
        provider = m.provider; id = m.id;
      }
      const model = await rpc.setModel(provider, id);
      rpc.state = { ...(rpc.state || {}), model };
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
    if (getRegisteredSession(req.params.id)) {
      const sess = await getBridgeSession(req.params.id);
      const data = await sess.setThinkingLevel(level);
      return res.json({ success: true, level: data?.level ?? level });
    }
    const rpc = getRPCSession(req.params.id);
    if (rpc?.alive) {
      await rpc.setThinkingLevel(level);
      return res.json({ success: true, level });
    }
    res.status(404).json({ error: 'Session not active' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Aggregate token/cost stats. RPC sessions answer authoritatively via
// get_session_stats; for everything else we sum assistant usage from the
// JSONL and overlay live context usage when the bridge reports it.
app.get('/api/sessions/:id/stats', async (req, res) => {
  const sessionId = req.params.id;
  try {
    const rpc = getRPCSession(sessionId);
    if (!getRegisteredSession(sessionId) && rpc?.alive) {
      try {
        const stats = await rpc.getSessionStats();
        if (stats) return res.json(stats);
      } catch {}
    }

    const sessionFile = findSessionFile(sessionId);
    if (!sessionFile) return res.status(404).json({ error: 'Session not found' });

    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let cost = 0, userMessages = 0, assistantMessages = 0, toolCalls = 0, toolResults = 0;
    for (const line of fs.readFileSync(sessionFile, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type !== 'message' || !entry.message) continue;
      const m = entry.message;
      if (m.role === 'user') userMessages++;
      else if (m.role === 'toolResult') toolResults++;
      else if (m.role === 'assistant') {
        assistantMessages++;
        if (Array.isArray(m.content)) toolCalls += m.content.filter(c => c.type === 'toolCall').length;
        const u = m.usage;
        if (u) {
          tokens.input += u.input || 0;
          tokens.output += u.output || 0;
          tokens.cacheRead += u.cacheRead || 0;
          tokens.cacheWrite += u.cacheWrite || 0;
          cost += u.cost?.total || 0;
        }
      }
    }

    const reg = getRegisteredSession(sessionId);
    const contextUsage = reg?.contextUsage || null;
    const info = parseSessionFile(sessionFile);
    res.json({
      sessionFile,
      sessionId,
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

// Execute a slash command against an active session.
app.post('/api/sessions/:id/command', async (req, res) => {
  const { message, deliverAs } = req.body;
  if (!message || !message.startsWith('/')) {
    return res.status(400).json({ error: 'message must start with /' });
  }
  try {
    if (getRegisteredSession(req.params.id)) {
      const sess = await getBridgeSession(req.params.id);
      const data = await sess.runCommand(message, deliverAs);
      return res.json({ success: true, info: data?.info });
    }
    const rpc = getRPCSession(req.params.id);
    if (rpc?.alive) {
      const result = await runRpcSlashCommand(rpc, message);
      return res.json({ success: true, info: result.info });
    }
    res.status(404).json({ error: 'Session not active' });
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
    if (getRegisteredSession(req.params.id)) {
      const sess = await getBridgeSession(req.params.id);
      await sess.respondExtensionUI(requestId, response);
      return res.json({ success: true });
    }
    const rpc = getRPCSession(req.params.id);
    if (rpc?.alive) {
      rpc.respondExtensionUI(requestId, response);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Session not active' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/:id/rename', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  if (getRegisteredSession(req.params.id)) {
    try {
      const sess = await getBridgeSession(req.params.id);
      await sess.setName(name);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const rpc = getRPCSession(req.params.id);
  if (rpc?.alive) {
    try {
      await rpc.setName(name);
      rpc.state = { ...(rpc.state || {}), sessionName: name, name };
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
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
  const { provider, id } = piSDK.parseModelId(modelId);
  if (!provider || !id) return res.status(400).json({ error: `Invalid model ID: ${modelId}` });

  if (getRegisteredSession(req.params.id)) {
    try {
      const sess = await getBridgeSession(req.params.id);
      await sess.setModel(`${provider}/${id}`);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const rpc = getRPCSession(req.params.id);
  if (rpc?.alive) {
    try {
      const model = await rpc.setModel(provider, id);
      rpc.state = { ...(rpc.state || {}), model };
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
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

app.post('/api/sessions/:id/branch', async (req, res) => {
  const { entryId } = req.body;
  if (!entryId) return res.status(400).json({ error: 'entryId required' });
  try {
    const sessionPath = findSessionFile(req.params.id);
    if (!sessionPath) return res.status(404).json({ error: 'Session not found' });
    await piSDK.branchSession(sessionPath, entryId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let modelsCache = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 60000;

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

    const now = Date.now();
    if (!modelsCache || now - modelsCacheTime > MODELS_CACHE_TTL) {
      modelsCache = await piSDK.getAvailableModels();
      modelsCacheTime = now;
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
        if (getRegisteredSession(sessionId)) {
          const sess = await getBridgeSession(sessionId);
          const data = await sess.getCommands();
          if (data?.commands) return res.json(data.commands);
        } else {
          const rpc = getRPCSession(sessionId);
          if (rpc?.alive) {
            const data = await rpc.getCommands();
            const commands = [
              ...RPC_BUILTIN_COMMANDS.map(c => ({ ...c, source: 'builtin', supported: true })),
              ...(data?.commands || []).map(c => ({ ...c, supported: true })),
            ];
            return res.json(commands);
          }
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
  const rpc = getRPCSession(req.params.id);
  if (!getRegisteredSession(req.params.id) && !rpc?.alive) {
    return res.status(404).json({ error: 'Session not active' });
  }
  try {
    const sess = getRegisteredSession(req.params.id) ? await getBridgeSession(req.params.id) : rpc;
    await sess.abort();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cwds', async (req, res) => {
  try {
    const sessionsDir = path.join(os.homedir(), '.pi', 'agent', 'sessions');
    const dirs = await fs.promises.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
    const cwdSet = new Set();
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = path.join(sessionsDir, dir.name);
      const files = await fs.promises.readdir(dirPath).catch(() => []);
      const jsonlFile = files.find(f => f.endsWith('.jsonl'));
      if (!jsonlFile) continue;
      try {
        const fd = await fs.promises.open(path.join(dirPath, jsonlFile), 'r');
        const buf = Buffer.alloc(2048);
        await fd.read(buf, 0, 2048, 0);
        await fd.close();
        const firstLine = buf.toString('utf8').split('\n')[0];
        const entry = JSON.parse(firstLine);
        if (entry.cwd) cwdSet.add(entry.cwd);
      } catch {}
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

// Fuzzy directory search under $HOME for the new-session cwd picker.
app.get('/api/dirs', (req, res) => {
  try {
    res.json(searchHomeDirs(String(req.query.q || ''), 15));
  } catch (e) {
    res.status(500).json([]);
  }
});

// Fuzzy file search under a session's cwd — powers @-mentions in the prompt.
app.get('/api/sessions/:id/files', async (req, res) => {
  try {
    const reg = getRegisteredSession(req.params.id);
    let cwd = reg?.cwd;
    if (!cwd) {
      const sessionFile = findSessionFile(req.params.id);
      if (sessionFile) {
        try { cwd = parseSessionFile(sessionFile).cwd; } catch {}
      }
    }
    if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
    const files = await searchFiles(cwd, String(req.query.q || ''), 20);
    res.json({ cwd, files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Spawn a fresh headless session via `pi --mode rpc`. The bridge extension
// (loaded inside the spawned process) registers it shortly after startup.
app.post('/api/sessions/new', async (req, res) => {
  try {
    let { model, cwd } = req.body || {};
    if (cwd && cwd.startsWith('~')) {
      cwd = path.join(process.env.HOME, cwd.slice(1).replace(/^\//, ''));
    }
    const rpc = await createRPCSession({ model, cwd });
    res.json({ success: true, id: rpc.id });
  } catch (e) {
    console.error('Failed to create session:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Resume an inactive session via `pi --mode rpc --session <path>`.
app.post('/api/sessions/:id/resume', async (req, res) => {
  const sessionId = req.params.id;

  if (getRegisteredSession(sessionId)) {
    return res.json({ success: true, id: sessionId, alreadyActive: true });
  }

  const sessionFile = findSessionFile(sessionId);
  if (!sessionFile) return res.status(404).json({ error: 'Session file not found' });

  let cwd = null;
  try {
    const firstLine = fs.readFileSync(sessionFile, 'utf-8').split('\n')[0];
    const entry = JSON.parse(firstLine);
    cwd = entry.cwd || null;
  } catch (e) {}

  if (cwd && !fs.existsSync(cwd)) {
    console.warn(`Session cwd ${cwd} doesn't exist, using HOME`);
    cwd = process.env.HOME;
  }

  try {
    const rpc = await resumeRPCSession(sessionFile, cwd || process.env.HOME);
    res.json({ success: true, id: rpc.id });
  } catch (e) {
    console.error('Failed to resume session:', e);
    res.status(500).json({ error: e.message });
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

  const rpc = getRPCSession(sessionId);
  if (!getRegisteredSession(sessionId) && !rpc?.alive) {
    res.write(`event: stream_error\ndata: ${JSON.stringify({ error: 'Session not active' })}\n\n`);
    return res.end();
  }

  let sess;
  try {
    sess = getRegisteredSession(sessionId) ? await getBridgeSession(sessionId) : rpc;
  } catch (e) {
    res.write(`event: stream_error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    return res.end();
  }

  res.write(`event: init\ndata: ${JSON.stringify({ turnInProgress: !!sess.turnInProgress })}\n\n`);

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const offs = [];
  const sub = (event, fn) => {
    const unsub = sess.on(event, fn);
    offs.push(typeof unsub === 'function' ? unsub : () => sess.off(event, fn));
  };

  sub('turn_start', () => send('turn_start', {}));
  sub('turn_end', () => send('turn_end', {}));

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
  sub('message_update', (data) => {
    const m = data?.message;
    if (!m) return;
    pendingUpdate = m;
    if (!updateTimer) flushUpdate();
  });

  sub('message_end', (data) => {
    if (data?.message?.role !== 'assistant') return;
    // Don't let a stale coalesced update land after the final message.
    pendingUpdate = null;
    if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
    send('message_end', { message: data.message });
  });

  sub('tool_execution_start', (data) => send('tool_execution_start', data));
  sub('tool_execution_update', (data) => send('tool_execution_update', data));
  sub('tool_execution_end', (data) => send('tool_execution_end', data));
  sub('extension_ui_request', (data) => send('extension_ui_request', data));
  sub('extension_ui_resolved', (data) => send('extension_ui_resolved', data));
  sub('queue_update', (data) => send('queue_update', data));
  sub('compaction_start', (data) => send('compaction_start', data));
  sub('compaction_end', (data) => send('compaction_end', data));
  sub('auto_retry_start', (data) => send('auto_retry_start', data));
  sub('auto_retry_end', (data) => send('auto_retry_end', data));

  const onClose = () => send('session_ended', {});
  if (typeof sess.once === 'function') {
    sess.once('close', onClose);
    offs.push(() => sess.off('close', onClose));
  } else {
    sub('exit', onClose);
  }

  req.on('close', () => {
    if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
    pendingUpdate = null;
    for (const off of offs) { try { off(); } catch {} }
  });
});

// =========================================================================
// Helpers
// =========================================================================

function findSessionFile(sessionId) {
  const reg = getRegisteredSession(sessionId);
  if (reg && reg.sessionFile && fs.existsSync(reg.sessionFile)) return reg.sessionFile;
  const rpc = getRPCSession(sessionId);
  const rpcFile = rpc?.sessionFile || rpc?.state?.sessionFile;
  if (rpcFile && fs.existsSync(rpcFile)) return rpcFile;

  try {
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const files = fs.readdirSync(path.join(SESSIONS_DIR, dir.name))
        .filter(f => f.includes(sessionId) && f.endsWith('.jsonl'));
      if (files.length) return path.join(SESSIONS_DIR, dir.name, files[0]);
    }
  } catch (e) {}
  return null;
}

// =========================================================================
// Start server
// =========================================================================

// Warm the models cache at startup so context window sizes are accurate immediately
piSDK.getAvailableModels().then(models => {
  modelsCache = models;
  modelsCacheTime = Date.now();
}).catch(() => {});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`pi-dish running at http://0.0.0.0:${PORT}`);
});

module.exports = server;
