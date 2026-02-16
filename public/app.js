// State
let sessions = [];
let currentSession = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSessions();
  
  const promptInput = document.getElementById('promptInput');

  // Keyboard shortcuts
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  // Auto-grow composer (better mobile typing UX)
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
  });
  
  // Poll for updates every 10 seconds
  setInterval(loadSessions, 10000);
  
  // Close sidebar when selecting session on mobile
  document.getElementById('sessionList').addEventListener('click', (e) => {
    if (e.target.closest('.session-item') && window.innerWidth <= 768) {
      closeSidebar();
    }
  });
});

// Toggle sidebar for mobile
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const willOpen = !sidebar.classList.contains('open');

  sidebar.classList.toggle('open', willOpen);
  overlay.classList.toggle('active', willOpen);
  document.body.classList.toggle('sidebar-open', willOpen);
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.remove('open');
  overlay.classList.remove('active');
  document.body.classList.remove('sidebar-open');
}

// Load sessions
async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    sessions = await res.json();
    renderSessions();
  } catch (e) {
    console.error('Failed to load sessions:', e);
  }
}

// Refresh sessions
function refreshSessions() {
  loadSessions();
}

// Render session list
function renderSessions() {
  const list = document.getElementById('sessionList');
  
  if (sessions.length === 0) {
    list.innerHTML = `
      <div class="empty-session">
        <p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">
          No active sessions<br>
          <span style="font-size: 11px;">Start pi with --session-control</span>
        </p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = sessions.map(session => {
    const contextClass = session.contextPercent > 80 ? 'critical' : session.contextPercent > 50 ? 'high' : '';
    const statusClass = session.isStreaming ? 'working' : 'idle';
    const activeClass = currentSession?.id === session.id ? 'active' : '';
    const shortId = session.id.slice(0, 8);
    
    // Show session name prominently (if different from short ID), with ID as secondary
    const displayName = session.name !== shortId ? session.name : 'Unnamed';
    
    return `
      <div class="session-item ${activeClass}" onclick="selectSession('${session.id}')">
        <div class="session-item-header">
          <span class="session-item-name" title="${session.id}">${escapeHtml(displayName)}</span>
          <span class="session-item-status ${statusClass}"></span>
        </div>
        <div class="session-item-id">${shortId}</div>
        <div class="session-item-meta">
          <span class="session-item-model">${escapeHtml(session.model)}</span>
          <span class="session-item-context ${contextClass}">${session.contextPercent}%</span>
          <span>${session.messageCount} msgs</span>
        </div>
      </div>
    `;
  }).join('');
}

// Select a session
async function selectSession(id) {
  currentSession = sessions.find(s => s.id === id);
  if (!currentSession) return;
  
  // Update UI
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('sessionView').style.display = 'flex';
  
  renderSessions(); // Update active state
  updateSessionHeader();
  
  // Load messages
  await loadMessages(id);
  
  // Start streaming for this session
  startMessageStream(id);
}

// Update session header
function updateSessionHeader() {
  if (!currentSession) return;
  
  document.getElementById('sessionName').textContent = currentSession.name;
  document.getElementById('sessionModel').textContent = currentSession.model;
  document.getElementById('sessionMsgCount').textContent = `${currentSession.messageCount} msgs`;
  
  const contextEl = document.getElementById('sessionContext');
  contextEl.textContent = `${currentSession.contextPercent}%`;
  contextEl.className = 'badge badge-context';
  if (currentSession.contextPercent > 80) {
    contextEl.classList.add('critical');
  } else if (currentSession.contextPercent > 50) {
    contextEl.classList.add('high');
  }
}

// Load messages for a session
async function loadMessages(id) {
  const container = document.getElementById('messages');
  container.innerHTML = '<div class="loading">Loading...</div>';
  
  try {
    const res = await fetch(`/api/sessions/${id}/messages`);
    const { messages, session } = await res.json();
    
    currentSession = { ...currentSession, ...session };
    updateSessionHeader();
    
    renderMessages(messages);
  } catch (e) {
    container.innerHTML = `<div class="error">Failed to load messages: ${e.message}</div>`;
  }
}

// Render messages with proper formatting
function renderMessages(messages) {
  const container = document.getElementById('messages');
  
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 48px;">
        <p style="color: var(--text-muted);">No messages yet</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = messages.map(msg => {
    const time = msg.timestamp ? formatTime(msg.timestamp) : '';
    
    if (msg.role === 'user') {
      return renderUserMessage(msg, time);
    }
    
    if (msg.role === 'assistant') {
      return renderAssistantMessage(msg, time);
    }
    
    if (msg.role === 'toolResult') {
      return renderToolResult(msg, time);
    }
    
    return '';
  }).join('');
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// Render user message
function renderUserMessage(msg, time) {
  const content = extractTextContent(msg.content);
  
  return `
    <div class="message user">
      <div class="message-header">
        <span class="message-role user">You</span>
        ${time ? `<span class="message-time">${time}</span>` : ''}
      </div>
      <div class="message-content user-content">
        ${formatMarkdown(content)}
      </div>
    </div>
  `;
}

// Render assistant message with thinking blocks
function renderAssistantMessage(msg, time, opts = {}) {
  let thinkingHtml = '';
  let textHtml = '';
  let toolCallsHtml = '';
  const timestamp = msg.timestamp || Date.now();
  const streamingClass = opts.streaming ? ' streaming' : '';
  const streamingAttr = opts.streaming ? ' data-streaming="true"' : '';
  
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'thinking' && block.thinking) {
        thinkingHtml += renderThinkingBlock(block.thinking);
      } else if (block.type === 'text' && block.text) {
        textHtml += formatMarkdown(block.text);
      } else if (block.type === 'toolCall') {
        toolCallsHtml += renderToolCall(block);
      }
    }
  } else if (typeof msg.content === 'string') {
    textHtml = formatMarkdown(msg.content);
  }
  
  return `
    <div class="message assistant${streamingClass}" data-timestamp="${timestamp}"${streamingAttr}>
      <div class="message-header">
        <span class="message-role assistant">Assistant</span>
        ${msg.model ? `<span class="badge">${escapeHtml(msg.model)}</span>` : ''}
        ${opts.streaming ? '<span class="badge streaming">Streaming</span>' : ''}
        ${time ? `<span class="message-time">${time}</span>` : ''}
      </div>
      <div class="message-content">
        ${thinkingHtml}
        ${toolCallsHtml}
        ${textHtml ? `<div class="assistant-text">${textHtml}</div>` : ''}
      </div>
    </div>
  `;
}

// Render thinking block (collapsible)
function renderThinkingBlock(thinking) {
  const id = 'think-' + Math.random().toString(36).substr(2, 9);
  return `
    <div class="thinking-block">
      <div class="thinking-header" onclick="toggleThinking('${id}')">
        <span class="thinking-toggle">▼</span>
        <span class="thinking-label">Thinking</span>
      </div>
      <div class="thinking-text" id="${id}">${escapeHtml(thinking)}</div>
    </div>
  `;
}

// Toggle thinking visibility
function toggleThinking(id) {
  const el = document.getElementById(id);
  const header = el.previousElementSibling;
  const toggle = header.querySelector('.thinking-toggle');
  
  if (el.style.display === 'none') {
    el.style.display = 'block';
    toggle.textContent = '▼';
  } else {
    el.style.display = 'none';
    toggle.textContent = '▶';
  }
}

// Render tool call
function renderToolCall(block) {
  const args = JSON.stringify(block.arguments, null, 2);
  return `
    <div class="tool-call">
      <div class="tool-call-header">
        <span class="tool-call-name">${escapeHtml(block.name)}</span>
      </div>
      <div class="tool-call-content">
        <pre><code>${escapeHtml(args)}</code></pre>
      </div>
    </div>
  `;
}

// Render tool result
function renderToolResult(msg, time) {
  const content = extractTextContent(msg.content);
  const isError = msg.isError;
  const timestamp = msg.timestamp || Date.now();
  
  return `
    <div class="message tool-result ${isError ? 'error' : ''}" data-timestamp="${timestamp}">
      <div class="message-header">
        <span class="message-role toolResult">Tool: ${escapeHtml(msg.toolName || 'unknown')}</span>
        ${time ? `<span class="message-time">${time}</span>` : ''}
        ${isError ? '<span class="badge" style="background: rgba(248,81,73,0.2); color: var(--error);">Error</span>' : ''}
      </div>
      <div class="message-content tool-content">
        <pre>${escapeHtml(truncate(content, 2000))}</pre>
      </div>
    </div>
  `;
}

// Extract text from content array or string
function extractTextContent(content) {
  if (!content) return '';
  
  if (typeof content === 'string') return content;
  
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return c;
      if (c.type === 'text') return c.text;
      return '';
    }).join('\n');
  }
  
  return '';
}

// Active stream connection
let messageStream = null;
let streamReconnectTimeout = null;

// Start streaming messages for a session
function startMessageStream(sessionId) {
  // Clear any pending reconnect
  if (streamReconnectTimeout) {
    clearTimeout(streamReconnectTimeout);
    streamReconnectTimeout = null;
  }

  // Close existing stream
  if (messageStream) {
    messageStream.close();
    messageStream = null;
  }

  if (!sessionId) return;

  try {
    const evtSource = new EventSource(`/api/sessions/${sessionId}/stream`);
    messageStream = evtSource;

    evtSource.onopen = () => {
      setStatus('');
    };

    evtSource.addEventListener('turn_end', (e) => {
      try {
        const event = JSON.parse(e.data);
        const data = event.data || event;
        if (!data.message) return;

        const container = document.getElementById('messages');
        if (!container) return;

        // Remove in-progress streaming assistant message before final message
        container.querySelectorAll('.message.assistant[data-streaming="true"]').forEach((el) => el.remove());

        const ts = data.message.timestamp || Date.now();
        const msgHtml = renderAssistantMessage(data.message, formatTime(ts));
        const existing = container.querySelector(`.message.assistant:not([data-streaming="true"])[data-timestamp="${ts}"]`);

        if (existing) {
          existing.outerHTML = msgHtml;
        } else {
          container.insertAdjacentHTML('beforeend', msgHtml);
        }

        container.scrollTop = container.scrollHeight;
        setStatus('');
      } catch (err) {
        console.error('Error handling turn_end:', err);
      }
    });

    // Real-time events for thinking/tool calls (via polling)
    evtSource.addEventListener('thinking', (e) => {
      try {
        const { message } = JSON.parse(e.data);
        updateOrAppendMessage(message);
      } catch (err) {
        console.error('Error handling thinking:', err);
      }
    });

    evtSource.addEventListener('tool_call', (e) => {
      try {
        const { message } = JSON.parse(e.data);
        updateOrAppendMessage(message);
      } catch (err) {
        console.error('Error handling tool_call:', err);
      }
    });

    evtSource.addEventListener('tool_result', (e) => {
      try {
        const { result } = JSON.parse(e.data);
        appendToolResult(result);
      } catch (err) {
        console.error('Error handling tool_result:', err);
      }
    });

    evtSource.onerror = () => {
      if (evtSource.readyState === EventSource.CLOSED) {
        setStatus('Stream disconnected', 'error');
        // Auto-reconnect after 3 seconds
        streamReconnectTimeout = setTimeout(() => {
          if (currentSession && currentSession.id === sessionId) {
            startMessageStream(sessionId);
          }
        }, 3000);
      }
    };
  } catch (err) {
    console.error('Failed to create stream:', err);
    setStatus('Stream failed', 'error');
  }
}

// Send prompt
async function sendPrompt() {
  const input = document.getElementById('promptInput');
  const message = input.value.trim();
  
  if (!message || !currentSession) return;
  
  input.value = '';
  input.style.height = '';
  setStatus('Sending...', 'working');
  
  // Optimistically add user message to UI
  const container = document.getElementById('messages');
  const userMsgHtml = renderUserMessage({
    role: 'user',
    content: [{ type: 'text', text: message }],
    timestamp: Date.now()
  }, formatTime(Date.now()));
  
  // Remove empty state if present
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  
  container.insertAdjacentHTML('beforeend', userMsgHtml);
  container.scrollTop = container.scrollHeight;
  
  try {
    const res = await fetch(`/api/sessions/${currentSession.id}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, mode: 'steer' })
    });
    
    if (!res.ok) {
      throw new Error(await res.text());
    }
    
    setStatus('Waiting for response...', 'working');
    
    // Stream will update when turn ends
    
  } catch (e) {
    setStatus(`Error: ${e.message}`, 'error');
  }
}

// Create new session
async function createSession() {
  try {
    const res = await fetch('/api/sessions/new', { method: 'POST' });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      setStatus('Session created', 'working');
      setTimeout(loadSessions, 2000);
      return;
    }

    setStatus(data.error || 'Session creation is not available in pi-dish yet', 'error');
  } catch (e) {
    setStatus(`Error: ${e.message}`, 'error');
  }
}

// Send prompt with a specific message (for buttons)
async function sendPromptWith(message) {
  const input = document.getElementById('promptInput');
  input.value = message;
  await sendPrompt();
}

// Set status message
function setStatus(message, type = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
}

// Utility functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n... (truncated)';
}

function formatMarkdown(text) {
  if (!text) return '';
  
  let html = escapeHtml(text);
  
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
  });
  
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

// Update or append an in-progress assistant message (thinking/tool calls)
function updateOrAppendMessage(message) {
  const container = document.getElementById('messages');
  if (!container) return;

  const timestamp = message.timestamp || Date.now();
  const msgWithTimestamp = { ...message, timestamp };
  const msgHtml = renderAssistantMessage(msgWithTimestamp, formatTime(timestamp), { streaming: true });

  // Prefer replacing existing streaming message; fallback to same timestamp entry
  const streamingEl = container.querySelector('.message.assistant[data-streaming="true"]');
  const sameTimestampEl = container.querySelector(`.message.assistant[data-timestamp="${timestamp}"]`);
  const target = streamingEl || sameTimestampEl;

  if (target) {
    target.outerHTML = msgHtml;
  } else {
    container.insertAdjacentHTML('beforeend', msgHtml);
  }

  container.scrollTop = container.scrollHeight;
}

// Append tool result
function appendToolResult(result) {
  const container = document.getElementById('messages');
  if (!container) return;
  
  const html = renderToolResult({
    role: 'toolResult',
    toolName: result.toolName || 'tool',
    content: result.result || result,
    isError: result.isError || false,
    timestamp: result.timestamp || Date.now()
  }, formatTime(result.timestamp || Date.now()));
  
  container.insertAdjacentHTML('beforeend', html);
  container.scrollTop = container.scrollHeight;
}

// Render tool calls from content array
function renderToolCalls(content) {
  if (!Array.isArray(content)) return '';
  
  return content
    .filter(c => c.type === 'toolCall')
    .map(c => `
      <div class="tool-call">
        <div class="tool-call-header">
          <span class="tool-call-name">${escapeHtml(c.name)}</span>
        </div>
        <pre class="tool-call-args">${escapeHtml(JSON.stringify(c.arguments, null, 2))}</pre>
      </div>
    `).join('');
}
