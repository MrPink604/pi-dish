const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const piSDK = require('./lib/pi-sdk');
const { createRPCSession, resumeRPCSession, getRPCSession, getAllRPCSessions } = require('./lib/rpc-session');

const app = express();
const PORT = process.env.PORT || 3333;

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const SESSIONS_DIR = path.join(os.homedir(), '.pi', 'agent', 'sessions');

// =========================================================================
// Helpers
// =========================================================================

function extractTextFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(c => c.type === 'text' ? c.text : '').join(' ');
  }
  return '';
}

function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

// Context window sizes for known model families
const MODEL_CONTEXT_WINDOWS = {
  'claude-opus-4': 200000, 'claude-sonnet-4': 200000, 'claude-haiku-4': 200000,
  'claude-3.5': 200000, 'claude-3': 200000,
  'gpt-4o': 128000, 'gpt-4-turbo': 128000, 'gpt-4': 8192,
  'o1': 200000, 'o3': 200000,
  'gemini-2': 1048576, 'gemini-1.5': 1048576,
  'default': 200000,
};

function getContextWindow(modelId) {
  if (!modelId) return MODEL_CONTEXT_WINDOWS['default'];
  for (const [prefix, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (prefix !== 'default' && modelId.startsWith(prefix)) return window;
  }
  return MODEL_CONTEXT_WINDOWS['default'];
}

/**
 * Decode a session directory name back to the original cwd.
 * Encoding: --<cwd with leading / stripped and all /\: replaced with ->--
 * This is ambiguous for paths with hyphens, so we also check the session file's cwd field.
 */
function decodeDirToCwd(dirName) {
  // Strip leading -- and trailing --
  let decoded = dirName.replace(/^--/, '').replace(/--$/, '');
  // Replace - with / (best effort — ambiguous for real hyphens in paths)
  decoded = '/' + decoded.replace(/-/g, '/');
  return decoded;
}

/**
 * Parse a session JSONL file and extract metadata.
 */
function parseSessionFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  let model = 'unknown', name = null, firstUserMsg = null, count = 0;
  let lastActivity = fs.statSync(filePath).mtime;
  let lastUsageTotalTokens = 0;
  let cwd = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // First entry is always type: "session" with cwd
      if (entry.type === 'session' && entry.cwd) cwd = entry.cwd;

      if (entry.type === 'model_change') model = entry.modelId || model;
      if (entry.type === 'session_info' && entry.name) name = entry.name;
      if (entry.sessionName) name = entry.sessionName;
      if (!firstUserMsg && entry.type === 'message' && entry.message?.role === 'user') {
        firstUserMsg = extractTextFromContent(entry.message.content);
      }
      if (!firstUserMsg && entry.type === 'custom_message') {
        firstUserMsg = entry.content;
      }
      if (entry.type === 'message' && entry.message?.role === 'user') count++;
      if (entry.timestamp) lastActivity = new Date(Math.max(lastActivity, new Date(entry.timestamp)));

      if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.message?.usage) {
        lastUsageTotalTokens = entry.message.usage.totalTokens || 0;
      }
      if (entry.type === 'compaction') {
        lastUsageTotalTokens = 0;
      }
    } catch (e) {}
  }

  const contextWindow = getContextWindow(model);
  const contextPercent = lastUsageTotalTokens > 0
    ? Math.min(100, Math.floor(lastUsageTotalTokens / contextWindow * 100))
    : 0;

  return {
    model,
    name: name || (firstUserMsg ? truncate(firstUserMsg, 40) : null),
    messageCount: count,
    contextTokens: lastUsageTotalTokens,
    contextPercent,
    lastActivity,
    cwd,
  };
}

// =========================================================================
// Session listing
// =========================================================================

/**
 * Get active sessions (RPC-managed by pi-dish).
 * Reads current state from the RPC process + session file metadata.
 */
function getActiveSessions() {
  const active = [];
  for (const rpc of getAllRPCSessions()) {
    if (!rpc.alive) continue;

    // Get info from session file if available
    let info = {};
    if (rpc.sessionFile && fs.existsSync(rpc.sessionFile)) {
      info = parseSessionFile(rpc.sessionFile);
    }

    // Overlay RPC state (more current than file)
    const state = rpc.state || {};
    const modelId = state.model?.id || info.model || 'unknown';

    active.push({
      id: rpc.id,
      name: info.name || 'New Session',
      model: modelId,
      contextPercent: info.contextPercent || 0,
      contextTokens: info.contextTokens || 0,
      messageCount: state.messageCount || info.messageCount || 0,
      lastActivity: info.lastActivity || new Date(),
      isActive: true,
      cwd: rpc.cwd || info.cwd || null,
      sessionFile: rpc.sessionFile || null,
    });
  }

  active.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  return active;
}

/**
 * Get all previous (inactive) sessions from disk.
 * Excludes sessions that are currently active via RPC.
 */
function getPreviousSessions() {
  const activeIds = new Set(getAllRPCSessions().filter(r => r.alive).map(r => r.id));
  const previous = [];

  try {
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = path.join(SESSIONS_DIR, dir.name);
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        const match = file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
        if (!match) continue;
        const id = match[1];
        if (activeIds.has(id)) continue;

        const info = parseSessionFile(path.join(dirPath, file));
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

// Cache for session search text (avoids re-parsing JSONL on every search)
const searchTextCache = new Map(); // sessionFile -> { mtime, text }

/**
 * Get searchable text for a session file (cached).
 * Includes all user messages, assistant text, tool commands, file paths.
 */
function getSessionSearchText(sessionFile) {
  try {
    const stats = fs.statSync(sessionFile);
    const cached = searchTextCache.get(sessionFile);
    if (cached && cached.mtime >= stats.mtimeMs) return cached.text;

    const content = fs.readFileSync(sessionFile, 'utf-8');
    const parts = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'message' && entry.message) {
          const text = extractTextFromContent(entry.message.content);
          if (text) parts.push(text.substring(0, 500));
        }
        if (entry.type === 'custom_message' && entry.content) {
          parts.push(entry.content.substring(0, 200));
        }
      } catch (e) {}
    }
    const text = parts.join(' ').toLowerCase();
    searchTextCache.set(sessionFile, { mtime: stats.mtimeMs, text });
    return text;
  } catch (e) {
    return '';
  }
}

/**
 * Check if a session matches a search query.
 * Matches against: name, cwd/path, model, and session message history.
 */
function sessionMatchesQuery(session, query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  // Build fast-check string from metadata
  const meta = [
    session.name || '',
    session.cwd || '',
    session.model || '',
    session.id || '',
  ].join(' ').toLowerCase();

  // Check if all tokens match metadata first (fast path)
  if (tokens.every(t => meta.includes(t))) return true;

  // Expensive path: search session message content
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

// List sessions — active (RPC) + previous (disk), with optional search
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

// Get messages for a session
app.get('/api/sessions/:id/messages', (req, res) => {
  const sessionId = req.params.id;
  const messages = [];

  // For RPC sessions, refresh state first
  const rpc = getRPCSession(sessionId);
  const isActive = rpc && rpc.alive;

  // Read messages from JSONL file
  const sessionFile = findSessionFile(sessionId);
  if (sessionFile) {
    const info = parseSessionFile(sessionFile);
    const content = fs.readFileSync(sessionFile, 'utf-8');
    for (const line of content.trim().split('\n')) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'message' && entry.message) {
          messages.push({
            role: entry.message.role,
            content: entry.message.content || [],
            timestamp: entry.message.timestamp || entry.timestamp,
            model: entry.message.model
          });
        } else if (entry.type === 'custom_message' && entry.customType === 'session-message') {
          messages.push({
            role: 'user',
            content: [{ type: 'text', text: entry.content }],
            timestamp: entry.timestamp
          });
        }
      } catch (e) {}
    }

    res.json({ messages, session: { id: sessionId, isActive, ...info } });
  } else {
    res.json({ messages: [], session: { id: sessionId, isActive } });
  }
});

// Send prompt — RPC only
app.post('/api/sessions/:id/prompt', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const rpc = getRPCSession(req.params.id);
  if (!rpc || !rpc.alive) {
    return res.status(404).json({ error: 'Session not active. Resume it first.' });
  }

  try {
    const result = await rpc.prompt(message);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rename session — via RPC if active, else SDK
app.post('/api/sessions/:id/rename', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const rpc = getRPCSession(req.params.id);
  if (rpc && rpc.alive) {
    try {
      await rpc.setName(name);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback to SDK for inactive sessions
  try {
    const sessionPath = findSessionFile(req.params.id);
    if (!sessionPath) return res.status(404).json({ error: 'Session not found' });
    await piSDK.renameSession(sessionPath, name);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Switch model — RPC if active, else SDK
app.post('/api/sessions/:id/model', async (req, res) => {
  const { modelId } = req.body;
  if (!modelId) return res.status(400).json({ error: 'modelId required' });

  const { provider, id } = piSDK.parseModelId(modelId);
  if (!provider || !id) {
    return res.status(400).json({ error: `Invalid model ID: ${modelId}` });
  }

  const rpc = getRPCSession(req.params.id);
  if (rpc && rpc.alive) {
    try {
      await rpc.setModel(provider, id);
      // Refresh state after model change
      try { rpc.state = await rpc.getState(); } catch(e) {}
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback to SDK for inactive sessions
  try {
    const sessionPath = findSessionFile(req.params.id);
    if (!sessionPath) return res.status(404).json({ error: 'Session not found' });
    await piSDK.switchModel(sessionPath, provider, id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get session tree
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

// Branch session
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

// Get available models
let modelsCache = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 60000;

app.get('/api/models', async (req, res) => {
  try {
    const now = Date.now();
    if (!modelsCache || now - modelsCacheTime > MODELS_CACHE_TTL) {
      modelsCache = await piSDK.getAvailableModels();
      modelsCacheTime = now;
    }
    res.json(modelsCache);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get slash commands
app.get('/api/commands', async (req, res) => {
  try {
    const commands = await piSDK.getCommands();
    res.json(commands);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Abort/interrupt — RPC only
app.post('/api/sessions/:id/abort', async (req, res) => {
  const rpc = getRPCSession(req.params.id);
  if (!rpc || !rpc.alive) {
    return res.status(404).json({ error: 'Session not active' });
  }
  try {
    await rpc.abort();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a new session
app.post('/api/sessions/new', async (req, res) => {
  try {
    let { model, cwd } = req.body || {};
    // Expand ~ to home directory
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

// Resume a previous session — spawns pi --mode rpc --session <path>
app.post('/api/sessions/:id/resume', async (req, res) => {
  const sessionId = req.params.id;

  // Already active?
  const existing = getRPCSession(sessionId);
  if (existing && existing.alive) {
    return res.json({ success: true, id: sessionId, alreadyActive: true });
  }

  // Find session file
  const sessionFile = findSessionFile(sessionId);
  if (!sessionFile) {
    return res.status(404).json({ error: 'Session file not found' });
  }

  // Extract cwd from session file
  let cwd = null;
  try {
    const firstLine = fs.readFileSync(sessionFile, 'utf-8').split('\n')[0];
    const entry = JSON.parse(firstLine);
    cwd = entry.cwd || null;
  } catch (e) {}

  // Verify cwd exists, fallback to HOME
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

// SSE streaming — RPC events only
app.get('/api/sessions/:id/stream', async (req, res) => {
  const sessionId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(': connected\n\n');

  const rpc = getRPCSession(sessionId);
  if (!rpc || !rpc.alive) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Session not active' })}\n\n`);
    return;
  }

  const unsubs = [];

  unsubs.push(rpc.on('turn_start', () => {
    res.write(`event: turn_start\ndata: {}\n\n`);
  }));

  unsubs.push(rpc.on('message_start', (msg) => {
    if (msg.message?.role === 'user') {
      res.write(`event: user_message\ndata: ${JSON.stringify({ message: msg.message })}\n\n`);
    }
  }));

  unsubs.push(rpc.on('message_update', (msg) => {
    if (msg.message) {
      const m = msg.message;
      const hasThinking = Array.isArray(m.content) && m.content.some(c => c.type === 'thinking');
      const hasToolCalls = Array.isArray(m.content) && m.content.some(c => c.type === 'toolCall');
      const hasToolResults = Array.isArray(m.content) && m.content.some(c => c.type === 'toolResult');

      if (hasThinking) {
        res.write(`event: thinking\ndata: ${JSON.stringify({ message: m })}\n\n`);
      }
      if (hasToolCalls) {
        res.write(`event: tool_call\ndata: ${JSON.stringify({ message: m })}\n\n`);
      }
      if (hasToolResults) {
        res.write(`event: tool_result\ndata: ${JSON.stringify({ message: m })}\n\n`);
      }
    }
  }));

  unsubs.push(rpc.on('message_end', (msg) => {
    if (msg.message) {
      res.write(`event: message_end\ndata: ${JSON.stringify({ message: msg.message })}\n\n`);
    }
  }));

  unsubs.push(rpc.on('turn_end', (msg) => {
    if (msg.message) {
      res.write(`event: turn_end\ndata: ${JSON.stringify({ message: msg.message })}\n\n`);
    }
  }));

  unsubs.push(rpc.on('exit', () => {
    res.write(`event: session_ended\ndata: {}\n\n`);
  }));

  req.on('close', () => unsubs.forEach(u => u()));
});

// =========================================================================
// Helpers
// =========================================================================

/**
 * Find the .jsonl file for a session ID, checking RPC sessions first, then disk.
 */
function findSessionFile(sessionId) {
  // Check RPC sessions first (they know their file path)
  const rpc = getRPCSession(sessionId);
  if (rpc && rpc.sessionFile && fs.existsSync(rpc.sessionFile)) {
    return rpc.sessionFile;
  }

  // Search on disk
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const files = fs.readdirSync(path.join(SESSIONS_DIR, dir.name))
        .filter(f => f.includes(sessionId) && f.endsWith('.jsonl'));
      if (files.length) {
        return path.join(SESSIONS_DIR, dir.name, files[0]);
      }
    }
  } catch (e) {}
  return null;
}

// =========================================================================
// Start server
// =========================================================================

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`pi-dish running at http://0.0.0.0:${PORT}`);
});

module.exports = server;
