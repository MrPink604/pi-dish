const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ControlClient, CONTROL_DIR } = require('./lib/control-client');
const { SessionPoller } = require('./lib/session-poller');

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

let sessionsCache = [];

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

// Get active sessions
function getActiveSessions() {
  try {
    if (!fs.existsSync(CONTROL_DIR)) return [];

    const sockets = fs.readdirSync(CONTROL_DIR).filter(f => f.endsWith('.sock'));
    return sockets.map(f => {
      const id = f.replace('.sock', '');
      const info = getSessionInfo(id);
      return {
        id,
        name: info.name || id.slice(0, 8),
        model: info.model || 'unknown',
        contextPercent: info.contextPercent || 0,
        messageCount: info.messageCount || 0,
        lastActivity: info.lastActivity || fs.statSync(path.join(CONTROL_DIR, f)).mtime
      };
    }).sort((a, b) => b.lastActivity - a.lastActivity);
  } catch (e) {
    console.error('Error getting sessions:', e);
    return [];
  }
}

// Get session info from file
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

function parseSessionFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  let model = 'unknown', name = null, firstUserMsg = null, count = 0;
  let lastActivity = fs.statSync(filePath).mtime;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'model_change') model = entry.modelId || model;
      if (entry.sessionName) name = entry.sessionName;
      if (!firstUserMsg && entry.type === 'message' && entry.message?.role === 'user') {
        firstUserMsg = extractTextFromContent(entry.message.content);
      }
      if (!firstUserMsg && entry.type === 'custom_message') {
        firstUserMsg = entry.content;
      }
      if (entry.type === 'message' && entry.message?.role === 'user') count++;
      if (entry.timestamp) lastActivity = new Date(Math.max(lastActivity, new Date(entry.timestamp)));
    } catch (e) {}
  }

  const tokens = Math.floor(content.length / 4);
  return {
    model,
    name: name || (firstUserMsg ? truncate(firstUserMsg, 40) : null),
    messageCount: count,
    contextPercent: Math.min(100, Math.floor(tokens / 200000 * 100)),
    lastActivity
  };
}

// API Routes
app.get('/api/sessions', (req, res) => {
  sessionsCache = getActiveSessions();
  res.json(sessionsCache);
});

app.get('/api/sessions/:id/messages', (req, res) => {
  const client = new ControlClient(req.params.id);
  if (!client.isActive()) return res.status(404).json({ error: 'Session not active' });

  const info = getSessionInfo(req.params.id);
  const messages = [];

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

  res.json({ messages, session: { id: req.params.id, ...info } });
});

app.post('/api/sessions/:id/prompt', async (req, res) => {
  const { message, mode = 'steer' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const client = new ControlClient(req.params.id);
  if (!client.isActive()) return res.status(404).json({ error: 'Session not active' });

  try {
    const result = await client.send('send', { message, mode });
    res.json({ success: result.success, error: result.error });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions/new', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Session creation is not implemented in pi-dish yet. Start a new pi session with --session-control in a terminal, then refresh.'
  });
});

// SSE streaming - combines turn_end events with polling for real-time updates
app.get('/api/sessions/:id/stream', async (req, res) => {
  const sessionId = req.params.id;
  const client = new ControlClient(sessionId);
  if (!client.isActive()) return res.status(404).json({ error: 'Session not active' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(': connected\n\n');

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

  sessionsCache = getActiveSessions();
  res.write(`data: ${JSON.stringify({ type: 'sessions', sessions: sessionsCache })}\n\n`);

  const interval = setInterval(() => {
    const newSessions = getActiveSessions();
    const newIds = newSessions.map(s => s.id).sort().join(',');
    const oldIds = sessionsCache.map(s => s.id).sort().join(',');
    if (newIds !== oldIds) {
      sessionsCache = newSessions;
      res.write(`data: ${JSON.stringify({ type: 'sessions', sessions: sessionsCache })}\n\n`);
    }
  }, 3000);

  req.on('close', () => clearInterval(interval));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`pi-dish running at http://0.0.0.0:${PORT}`);
});

module.exports = server;
