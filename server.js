const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ControlClient, CONTROL_DIR } = require('./lib/control-client');
const { SessionPoller } = require('./lib/session-poller');
const piSDK = require('./lib/pi-sdk');
const { createRPCSession, getRPCSession, getAllRPCSessions } = require('./lib/rpc-session');

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

let sessionsCache = { active: [], previous: [] };

// Helper: Extract text from content
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

// Get the set of active session IDs (control sockets + RPC sessions)
function getActiveSessionIds() {
  const ids = new Set();
  try {
    if (fs.existsSync(CONTROL_DIR)) {
      for (const f of fs.readdirSync(CONTROL_DIR)) {
        if (f.endsWith('.sock')) ids.add(f.replace('.sock', ''));
      }
    }
  } catch (e) {}
  // Also include RPC-managed sessions
  for (const rpc of getAllRPCSessions()) {
    if (rpc.alive) ids.add(rpc.id);
  }
  return ids;
}

// Get all sessions, split into active and previous
function getAllSessions() {
  const activeIds = getActiveSessionIds();
  const active = [];
  const previous = [];

  // Scan all session files
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = path.join(SESSIONS_DIR, dir.name);
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        // Extract session ID from filename: timestamp_uuid.jsonl
        const match = file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
        if (!match) continue;
        const id = match[1];
        const info = parseSessionFile(path.join(dirPath, file));
        const session = {
          id,
          name: info.name || id.slice(0, 8),
          model: info.model || 'unknown',
          contextPercent: info.contextPercent || 0,
          contextTokens: info.contextTokens || 0,
          messageCount: info.messageCount || 0,
          lastActivity: info.lastActivity,
          isActive: activeIds.has(id),
          cwd: dir.name,
        };

        if (activeIds.has(id)) {
          active.push(session);
        } else {
          previous.push(session);
        }
      }
    }
  } catch (e) {
    console.error('Error scanning sessions:', e);
  }

  // Include RPC-managed sessions that might not have JSONL files yet
  const listedIds = new Set([...active, ...previous].map(s => s.id));
  for (const rpc of getAllRPCSessions()) {
    if (rpc.alive && !listedIds.has(rpc.id)) {
      const modelName = rpc.state?.model?.id || rpc.state?.model?.name || 'unknown';
      active.push({
        id: rpc.id,
        name: 'New Session',
        model: modelName,
        contextPercent: 0,
        contextTokens: 0,
        messageCount: 0,
        lastActivity: new Date(),
        isActive: true,
        cwd: 'rpc',
      });
    }
  }

  // Sort both lists by last activity, newest first
  active.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  previous.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

  return { active, previous };
}

// Get session info from file by ID
function getSessionInfo(sessionId) {
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const files = fs.readdirSync(path.join(SESSIONS_DIR, dir.name))
        .filter(f => f.includes(sessionId) && f.endsWith('.jsonl'));
      if (files.length) {
        return parseSessionFile(path.join(SESSIONS_DIR, dir.name, files[0]));
      }
    }
  } catch (e) {}
  return {};
}

// Context window sizes for known model families
const MODEL_CONTEXT_WINDOWS = {
  'claude-opus-4': 200000,
  'claude-sonnet-4': 200000,
  'claude-haiku-4': 200000,
  'claude-3.5': 200000,
  'claude-3': 200000,
  'gpt-4o': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'o1': 200000,
  'o3': 200000,
  'gemini-2': 1048576,
  'gemini-1.5': 1048576,
  'default': 200000,
};

function getContextWindow(modelId) {
  if (!modelId) return MODEL_CONTEXT_WINDOWS['default'];
  for (const [prefix, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (prefix !== 'default' && modelId.startsWith(prefix)) return window;
  }
  return MODEL_CONTEXT_WINDOWS['default'];
}

function parseSessionFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  let model = 'unknown', name = null, firstUserMsg = null, count = 0;
  let lastActivity = fs.statSync(filePath).mtime;

  // Token tracking: reset after compaction events
  let lastUsageTotalTokens = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
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

      // Track token usage from assistant messages (most accurate source)
      if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.message?.usage) {
        lastUsageTotalTokens = entry.message.usage.totalTokens || 0;
      }

      // On compaction, reset token count — the compaction summary replaces old context
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
    lastActivity
  };
}

// API Routes
app.get('/api/sessions', (req, res) => {
  sessionsCache = getAllSessions();
  res.json(sessionsCache);
});

app.get('/api/sessions/:id/messages', (req, res) => {
  const info = getSessionInfo(req.params.id);
  const messages = [];
  const activeIds = getActiveSessionIds();
  const isActive = activeIds.has(req.params.id);

  // Read from session file
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const files = fs.readdirSync(path.join(SESSIONS_DIR, dir.name))
        .filter(f => f.includes(req.params.id) && f.endsWith('.jsonl'));
      if (!files.length) continue;

      const content = fs.readFileSync(path.join(SESSIONS_DIR, dir.name, files[0]), 'utf-8');
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
      break;
    }
  } catch (e) {}

  res.json({ messages, session: { id: req.params.id, isActive, ...info } });
});

app.post('/api/sessions/:id/prompt', async (req, res) => {
  const { message, mode = 'steer' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  // Try RPC session first (pi-dish managed)
  const rpc = getRPCSession(req.params.id);
  if (rpc && rpc.alive) {
    try {
      // For RPC sessions, always use prompt() to trigger the full agent loop
      // steer() in RPC mode only queues the message without triggering a turn
      const result = await rpc.prompt(message);
      return res.json({ success: true, result });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fall back to control socket (externally managed)
  const client = new ControlClient(req.params.id);
  if (!client.isActive()) return res.status(404).json({ error: 'Session not active' });

  try {
    const result = await client.send('send', { message, mode });
    res.json({ success: result.success, error: result.error });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rename session via SDK (writes session_info entry to JSONL)
app.post('/api/sessions/:id/rename', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    const sessionPath = await piSDK.findSessionPath(req.params.id);
    if (!sessionPath) return res.status(404).json({ error: 'Session not found' });

    await piSDK.renameSession(sessionPath, name);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Switch model via SDK (writes model_change entry) or RPC (set_model command)
app.post('/api/sessions/:id/model', async (req, res) => {
  const { modelId } = req.body;
  if (!modelId) return res.status(400).json({ error: 'modelId required' });

  const { provider, id } = piSDK.parseModelId(modelId);
  if (!provider || !id) {
    return res.status(400).json({ error: `Invalid model ID: ${modelId}` });
  }

  // Try RPC session first
  const rpc = getRPCSession(req.params.id);
  if (rpc && rpc.alive) {
    try {
      await rpc.setModel(provider, id);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // For control-socket sessions, write model_change directly to JSONL
  try {
    const sessionPath = await piSDK.findSessionPath(req.params.id);
    if (!sessionPath) return res.status(404).json({ error: 'Session not found' });

    await piSDK.switchModel(sessionPath, provider, id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get available models from SDK (all providers with API keys)
let modelsCache = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 60000; // 1 minute

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

// Get slash commands for autocomplete
app.get('/api/commands', async (req, res) => {
  try {
    const commands = await piSDK.getCommands();
    res.json(commands);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a new pi session via RPC mode
app.post('/api/sessions/new', async (req, res) => {
  try {
    const { model, cwd } = req.body || {};
    const { session, ready } = createRPCSession({ model, cwd });
    const rpc = await ready;
    res.json({ success: true, id: rpc.id });
  } catch (e) {
    console.error('Failed to create session:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// SSE streaming - combines turn_end events with polling for real-time updates
app.get('/api/sessions/:id/stream', async (req, res) => {
  const sessionId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(': connected\n\n');

  const cleanups = [];

  // Check if this is an RPC-managed session
  const rpc = getRPCSession(sessionId);
  if (rpc && rpc.alive) {
    // Forward RPC streaming events to SSE
    const unsubs = [];

    // User message echoed back
    unsubs.push(rpc.on('message_start', (msg) => {
      if (msg.message?.role === 'user') {
        res.write(`event: user_message\ndata: ${JSON.stringify({ message: msg.message })}\n\n`);
      }
    }));

    // Streaming assistant message updates (thinking, text deltas, tool calls)
    unsubs.push(rpc.on('message_update', (msg) => {
      if (msg.message) {
        const m = msg.message;
        const hasThinking = Array.isArray(m.content) && m.content.some(c => c.type === 'thinking');
        const hasToolCalls = Array.isArray(m.content) && m.content.some(c => c.type === 'toolCall');

        if (hasThinking) {
          res.write(`event: thinking\ndata: ${JSON.stringify({ message: m })}\n\n`);
        } else if (hasToolCalls) {
          res.write(`event: tool_call\ndata: ${JSON.stringify({ message: m })}\n\n`);
        }
      }
    }));

    // Turn end — final assistant message
    unsubs.push(rpc.on('turn_end', (msg) => {
      if (msg.message) {
        res.write(`event: turn_end\ndata: ${JSON.stringify({ message: msg.message })}\n\n`);
      }
    }));

    unsubs.push(rpc.on('exit', () => {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Session ended' })}\n\n`);
    }));

    cleanups.push(() => unsubs.forEach(u => u()));
    req.on('close', () => cleanups.forEach(fn => fn()));
    return;
  }

  // For control-socket sessions
  const client = new ControlClient(sessionId);
  if (!client.isActive()) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Session not active' })}\n\n`);
    return;
  }

  // Track if turn has ended to stop emitting poller events
  let turnEnded = false;

  // Subscribe to turn_end for final message
  const sub = client.subscribe('turn_end',
    (data) => {
      turnEnded = true; // Mark turn as ended
      if (data?.message) {
        const payload = JSON.stringify({ message: data.message });
        res.write(`event: turn_end\ndata: ${payload}\n\n`);
      }
    },
    (err) => {
      console.error(`SSE subscription error (${sessionId}):`, err.message);
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  );

  // Start polling for real-time updates (thinking, tool calls, partial content)
  const poller = new SessionPoller(sessionId, (entry) => {
    // Detect the start of a new turn and re-enable streaming updates
    const isUserMessage =
      (entry.type === 'message' && entry.message?.role === 'user') ||
      (entry.type === 'custom_message' && entry.customType === 'session-message');

    if (isUserMessage) {
      turnEnded = false;
      return;
    }

    // Skip assistant/tool poller events after turn_end until next user message
    if (turnEnded) {
      return;
    }

    // Emit different events based on entry type
    if (entry.type === 'message' && entry.message) {
      const msg = entry.message;

      // Check for thinking blocks
      const hasThinking = Array.isArray(msg.content) && msg.content.some(c => c.type === 'thinking');
      const hasToolCalls = Array.isArray(msg.content) && msg.content.some(c => c.type === 'toolCall');

      if (hasThinking) {
        res.write(`event: thinking\ndata: ${JSON.stringify({ message: msg })}\n\n`);
      } else if (hasToolCalls) {
        res.write(`event: tool_call\ndata: ${JSON.stringify({ message: msg })}\n\n`);
      }
      // Note: We still wait for turn_end for the final text content
    } else if (entry.type === 'tool_result') {
      res.write(`event: tool_result\ndata: ${JSON.stringify({ result: entry })}\n\n`);
    }
  });

  poller.start();

  req.on('close', () => {
    if (sub) sub.unsubscribe();
    poller.stop();
  });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(': connected\n\n');

  sessionsCache = getAllSessions();
  res.write(`data: ${JSON.stringify({ type: 'sessions', ...sessionsCache })}\n\n`);

  const interval = setInterval(() => {
    const newSessions = getAllSessions();
    const newActiveIds = newSessions.active.map(s => s.id).sort().join(',');
    const oldActiveIds = sessionsCache.active.map(s => s.id).sort().join(',');
    if (newActiveIds !== oldActiveIds) {
      sessionsCache = newSessions;
      res.write(`data: ${JSON.stringify({ type: 'sessions', ...sessionsCache })}\n\n`);
    }
  }, 3000);

  req.on('close', () => clearInterval(interval));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`pi-dish running at http://0.0.0.0:${PORT}`);
});

module.exports = server;
