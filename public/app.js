// State
let sessions = { active: [], previous: [] };
let currentSession = null;

// Slash commands cache
let slashCommands = [];
let autocompleteVisible = false;
let autocompleteIndex = 0;

// Load slash commands
async function loadCommands() {
  try {
    const res = await fetch('/api/commands');
    slashCommands = await res.json();
  } catch (e) {
    console.error('Failed to load commands:', e);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSessions();
  loadModels();
  loadCommands();
  
  const promptInput = document.getElementById('promptInput');

  // Keyboard shortcuts
  promptInput.addEventListener('keydown', (e) => {
    if (autocompleteVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveAutocomplete(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveAutocomplete(-1);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        var items = document.querySelectorAll('.autocomplete-item');
        if (items.length > 0 && autocompleteIndex >= 0) {
          e.preventDefault();
          acceptAutocomplete(items[autocompleteIndex]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideAutocomplete();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  // Auto-grow composer + autocomplete
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
    handleAutocomplete(promptInput.value);
  });
  
  // Poll for updates every 10 seconds
  setInterval(loadSessions, 10000);
  
  // Close sidebar when selecting session on mobile
  document.getElementById('sessionList').addEventListener('click', (e) => {
    if (e.target.closest('.session-item') && window.innerWidth <= 768) {
      closeSidebar();
    }
  });

  // Hide autocomplete on blur (with delay for click)
  promptInput.addEventListener('blur', () => {
    setTimeout(hideAutocomplete, 200);
  });
});

// --- Slash command autocomplete ---
function handleAutocomplete(text) {
  // Only trigger on / at start of input
  if (!text.startsWith('/')) {
    hideAutocomplete();
    return;
  }

  // Extract the command part (first word after /)
  var spaceIdx = text.indexOf(' ');
  var query = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);

  // If there's a space, user is typing args — only show if exact match for context
  if (spaceIdx > 0) {
    hideAutocomplete();
    return;
  }

  // Filter matching commands
  var matches = slashCommands.filter(function(cmd) {
    return cmd.name.toLowerCase().startsWith(query.toLowerCase());
  });

  if (matches.length === 0 || (matches.length === 1 && matches[0].name === query)) {
    hideAutocomplete();
    return;
  }

  showAutocomplete(matches);
}

function showAutocomplete(matches) {
  var container = document.getElementById('autocomplete');
  if (!container) {
    container = document.createElement('div');
    container.id = 'autocomplete';
    container.className = 'autocomplete-dropdown';
    document.querySelector('.input-area').appendChild(container);
  }

  autocompleteIndex = 0;
  autocompleteVisible = true;

  container.innerHTML = matches.map(function(cmd, i) {
    var sourceIcon = '';
    if (cmd.source === 'builtin') sourceIcon = '⚙️';
    else if (cmd.source === 'extension') sourceIcon = '🧩';
    else if (cmd.source === 'skill') sourceIcon = '📚';
    else if (cmd.source === 'prompt') sourceIcon = '📝';

    var activeClass = i === 0 ? ' active' : '';
    var argsHint = cmd.args ? ' <span class="autocomplete-args">' + escapeHtml(cmd.args) + '</span>' : '';

    return '<div class="autocomplete-item' + activeClass + '" data-name="' + escapeHtml(cmd.name) + '" onclick="acceptAutocompleteByName(\'' + escapeHtml(cmd.name) + '\')">'
      + '<span class="autocomplete-icon">' + sourceIcon + '</span>'
      + '<span class="autocomplete-name">/' + escapeHtml(cmd.name) + argsHint + '</span>'
      + '<span class="autocomplete-desc">' + escapeHtml(cmd.description) + '</span>'
      + '</div>';
  }).join('');

  container.style.display = 'block';
}

function hideAutocomplete() {
  autocompleteVisible = false;
  var container = document.getElementById('autocomplete');
  if (container) container.style.display = 'none';
}

function moveAutocomplete(delta) {
  var items = document.querySelectorAll('.autocomplete-item');
  if (items.length === 0) return;

  items[autocompleteIndex].classList.remove('active');
  autocompleteIndex = (autocompleteIndex + delta + items.length) % items.length;
  items[autocompleteIndex].classList.add('active');

  // Scroll into view
  items[autocompleteIndex].scrollIntoView({ block: 'nearest' });
}

function acceptAutocomplete(el) {
  var name = el.getAttribute('data-name');
  acceptAutocompleteByName(name);
}

function acceptAutocompleteByName(name) {
  var input = document.getElementById('promptInput');
  input.value = '/' + name + ' ';
  input.focus();
  hideAutocomplete();

  // Trigger input event for auto-resize
  input.dispatchEvent(new Event('input'));
}

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

// Format token count for display
function formatTokens(tokens) {
  if (!tokens || tokens === 0) return '0';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

// Group sessions by time period
function groupByTimePeriod(sessionList) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOf2DaysAgo = new Date(startOfToday); startOf2DaysAgo.setDate(startOf2DaysAgo.getDate() - 2);
  const startOf3DaysAgo = new Date(startOfToday); startOf3DaysAgo.setDate(startOf3DaysAgo.getDate() - 3);
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7);
  const startOfMonth = new Date(startOfToday); startOfMonth.setDate(startOfMonth.getDate() - 30);

  const groups = [
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: '2 Days Ago', sessions: [] },
    { label: '3 Days Ago', sessions: [] },
    { label: 'Last 7 Days', sessions: [] },
    { label: 'Last 30 Days', sessions: [] },
    { label: 'Older', sessions: [] },
  ];

  for (const s of sessionList) {
    const d = new Date(s.lastActivity);
    if (d >= startOfToday) groups[0].sessions.push(s);
    else if (d >= startOfYesterday) groups[1].sessions.push(s);
    else if (d >= startOf2DaysAgo) groups[2].sessions.push(s);
    else if (d >= startOf3DaysAgo) groups[3].sessions.push(s);
    else if (d >= startOfWeek) groups[4].sessions.push(s);
    else if (d >= startOfMonth) groups[5].sessions.push(s);
    else groups[6].sessions.push(s);
  }

  return groups.filter(g => g.sessions.length > 0);
}

// Format relative time (e.g. "2m ago", "3h ago", "Yesterday")
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  var now = Date.now();
  var d = new Date(timestamp);
  var diff = now - d.getTime();
  if (diff < 0) diff = 0;

  var seconds = Math.floor(diff / 1000);
  var minutes = Math.floor(seconds / 60);
  var hours = Math.floor(minutes / 60);
  var days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return minutes + 'm ago';
  if (hours < 24) return hours + 'h ago';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + 'd ago';
  // Show date for older
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Render a single session item
function renderSessionItem(session) {
  const contextClass = session.contextPercent > 80 ? 'critical' : session.contextPercent > 50 ? 'high' : '';
  const statusClass = session.isActive ? 'idle' : 'closed';
  const activeClass = currentSession?.id === session.id ? 'active' : '';
  const shortId = session.id.slice(0, 8);
  const displayName = session.name !== shortId ? session.name : 'Unnamed';
  const tokenDisplay = session.contextTokens ? `${formatTokens(session.contextTokens)} tok` : '';
  const timeAgo = formatRelativeTime(session.lastActivity);

  return `
    <div class="session-item ${activeClass}" onclick="selectSession('${session.id}')">
      <div class="session-item-header">
        <span class="session-item-name" title="${session.id}">${escapeHtml(displayName)}</span>
        <span class="session-item-time">${timeAgo}</span>
        <span class="session-item-status ${statusClass}"></span>
      </div>
      <div class="session-item-meta">
        <span class="session-item-model">${escapeHtml(session.model)}</span>
        <span class="session-item-context ${contextClass}">${session.contextPercent}%</span>
        ${tokenDisplay ? `<span class="session-item-tokens">${tokenDisplay}</span>` : ''}
        <span>${session.messageCount} msgs</span>
      </div>
    </div>
  `;
}

// Render session list with active/previous segments
function renderSessions() {
  const list = document.getElementById('sessionList');
  const { active, previous } = sessions;

  if (active.length === 0 && previous.length === 0) {
    list.innerHTML = `
      <div class="empty-session">
        <p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">
          No sessions found<br>
          <span style="font-size: 11px;">Start pi with --session-control</span>
        </p>
      </div>
    `;
    return;
  }

  let html = '';

  // Active sessions segment
  if (active.length > 0) {
    html += `<div class="session-segment">
      <div class="session-segment-header">
        <span class="session-segment-label">Active</span>
        <span class="session-segment-count">${active.length}</span>
      </div>
      ${active.map(renderSessionItem).join('')}
    </div>`;
  }

  // Previous sessions grouped by time period
  if (previous.length > 0) {
    const groups = groupByTimePeriod(previous);
    for (const group of groups) {
      html += `<div class="session-segment">
        <div class="session-segment-header">
          <span class="session-segment-label">${group.label}</span>
          <span class="session-segment-count">${group.sessions.length}</span>
        </div>
        ${group.sessions.map(renderSessionItem).join('')}
      </div>`;
    }
  }

  list.innerHTML = html;
}

// Find session by ID across both active and previous lists
function findSession(id) {
  return sessions.active.find(s => s.id === id)
    || sessions.previous.find(s => s.id === id);
}

// Select a session
async function selectSession(id) {
  currentSession = findSession(id);
  if (!currentSession) return;
  
  // Update UI
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('sessionView').style.display = 'flex';
  
  // Show/hide input area and actions based on active state
  const inputArea = document.querySelector('.input-area');
  const sessionActions = document.querySelector('.session-actions');
  if (inputArea) inputArea.style.display = currentSession.isActive ? '' : 'none';
  if (sessionActions) sessionActions.style.display = currentSession.isActive ? '' : 'none';
  
  renderSessions(); // Update active state
  updateSessionHeader();
  
  // Load messages
  await loadMessages(id);
  
  // Only stream for active sessions
  if (currentSession.isActive) {
    startMessageStream(id);
  } else {
    // Close any existing stream
    if (messageStream) {
      messageStream.close();
      messageStream = null;
    }
  }
}

// Known models cache
let knownModels = [];

// Load known models from server
async function loadModels() {
  try {
    const res = await fetch('/api/models');
    knownModels = await res.json();
  } catch (e) {
    console.error('Failed to load models:', e);
  }
}

// Filter models for dropdown (search/filter support)
function filterModels(query) {
  if (!query) return knownModels;
  const q = query.toLowerCase();
  return knownModels.filter(function(m) {
    return m.id.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q) ||
      (m.name && m.name.toLowerCase().includes(q));
  });
}

// Update session header
function updateSessionHeader() {
  if (!currentSession) return;
  
  document.getElementById('sessionName').textContent = currentSession.name;
  document.getElementById('sessionModel').textContent = currentSession.model + ' ▾';
  document.getElementById('sessionMsgCount').textContent = `${currentSession.messageCount} msgs`;
  
  // Only allow rename/model switch on active sessions
  const nameEl = document.getElementById('sessionName');
  nameEl.classList.toggle('editable-name', !!currentSession.isActive);
  nameEl.title = currentSession.isActive ? 'Click to rename' : '';
  nameEl.onclick = currentSession.isActive ? startRename : null;

  const modelBtn = document.getElementById('sessionModel');
  if (currentSession.isActive) {
    modelBtn.textContent = currentSession.model + ' ▾';
    modelBtn.onclick = toggleModelDropdown;
    modelBtn.style.cursor = 'pointer';
  } else {
    modelBtn.textContent = currentSession.model;
    modelBtn.onclick = null;
    modelBtn.style.cursor = 'default';
  }

  const contextEl = document.getElementById('sessionContext');
  const tokenStr = currentSession.contextTokens ? ` (${formatTokens(currentSession.contextTokens)} tok)` : '';
  contextEl.textContent = `${currentSession.contextPercent}%${tokenStr}`;
  contextEl.className = 'badge badge-context';
  if (currentSession.contextPercent > 80) {
    contextEl.classList.add('critical');
  } else if (currentSession.contextPercent > 50) {
    contextEl.classList.add('high');
  }
}

// --- Inline rename ---
function startRename() {
  if (!currentSession || !currentSession.isActive) return;
  const nameEl = document.getElementById('sessionName');
  const inputEl = document.getElementById('sessionNameInput');
  nameEl.style.display = 'none';
  inputEl.style.display = '';
  inputEl.value = currentSession.name;
  inputEl.focus();
  inputEl.select();
}

function handleRenameKey(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitRename();
  } else if (e.key === 'Escape') {
    cancelRename();
  }
}

async function commitRename() {
  const inputEl = document.getElementById('sessionNameInput');
  const nameEl = document.getElementById('sessionName');
  const newName = inputEl.value.trim();

  inputEl.style.display = 'none';
  nameEl.style.display = '';

  if (!newName || newName === currentSession.name || !currentSession.isActive) return;

  try {
    const res = await fetch('/api/sessions/' + currentSession.id + '/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) {
      currentSession.name = newName;
      nameEl.textContent = newName;
      renderSessions();
    } else {
      setStatus('Rename failed', 'error');
    }
  } catch (e) {
    setStatus('Rename failed: ' + e.message, 'error');
  }
}

function cancelRename() {
  const inputEl = document.getElementById('sessionNameInput');
  const nameEl = document.getElementById('sessionName');
  inputEl.style.display = 'none';
  nameEl.style.display = '';
}

// --- Model dropdown ---
let modelDropdownOpen = false;

function toggleModelDropdown() {
  if (!currentSession || !currentSession.isActive) return;
  modelDropdownOpen = !modelDropdownOpen;
  const dropdown = document.getElementById('modelDropdown');

  if (!modelDropdownOpen) {
    dropdown.style.display = 'none';
    return;
  }

  renderModelDropdown('');
  dropdown.style.display = 'flex';

  // Focus the search input
  var searchInput = dropdown.querySelector('.model-search');
  if (searchInput) searchInput.focus();

  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', closeModelDropdownOnOutsideClick, { once: true });
  }, 0);
}

function renderModelDropdown(query) {
  var dropdown = document.getElementById('modelDropdown');
  var filtered = filterModels(query);
  var currentModel = currentSession ? currentSession.model : '';

  // Ensure the search input exists (create once, don't replace)
  var searchInput = dropdown.querySelector('.model-search');
  if (!searchInput) {
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'model-search';
    searchInput.placeholder = 'Search models...';
    searchInput.addEventListener('input', function() { renderModelDropdown(this.value); });
    searchInput.addEventListener('keydown', handleModelSearchKey);
    dropdown.appendChild(searchInput);
  }
  if (searchInput.value !== query) searchInput.value = query;

  // Get or create the results container
  var results = dropdown.querySelector('.model-results');
  if (!results) {
    results = document.createElement('div');
    results.className = 'model-results';
    dropdown.appendChild(results);
  }

  // Group by provider
  var groups = {};
  filtered.forEach(function(m) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider].push(m);
  });

  var html = '';
  var providers = Object.keys(groups).sort();
  providers.forEach(function(provider) {
    html += '<div class="model-group-header">' + escapeHtml(provider) + '</div>';
    groups[provider].forEach(function(m) {
      var fullId = m.provider + '/' + m.id;
      var activeClass = (m.id === currentModel || fullId === currentModel || m.id.startsWith(currentModel) || currentModel.endsWith(m.id)) ? 'active' : '';
      var badges = '';
      if (m.free) badges += '<span class="model-badge free">free</span>';
      if (m.reasoning) badges += '<span class="model-badge reasoning">🧠</span>';
      html += '<div class="model-option ' + activeClass + '" onclick="selectModel(\'' + escapeHtml(fullId) + '\')" title="' + escapeHtml(fullId) + '"><span class="model-option-name">' + escapeHtml(m.id) + '</span>' + badges + '</div>';
    });
  });

  if (filtered.length === 0) {
    html += '<div class="model-option" style="color:var(--text-muted);cursor:default">No models found</div>';
  }

  results.innerHTML = html;
}

function handleModelSearchKey(e) {
  if (e.key === 'Escape') {
    closeModelDropdown();
  }
}

function closeModelDropdownOnOutsideClick(e) {
  const selector = document.getElementById('modelSelector');
  if (!selector.contains(e.target)) {
    closeModelDropdown();
  } else {
    // Re-attach if click was inside
    setTimeout(function() {
      document.addEventListener('click', closeModelDropdownOnOutsideClick, { once: true });
    }, 0);
  }
}

function closeModelDropdown() {
  modelDropdownOpen = false;
  document.getElementById('modelDropdown').style.display = 'none';
}

async function selectModel(fullModelId) {
  closeModelDropdown();
  // Extract just the model ID (strip provider prefix for comparison and display)
  var slashIdx = fullModelId.indexOf('/');
  var modelId = slashIdx > 0 ? fullModelId.slice(slashIdx + 1) : fullModelId;
  if (!currentSession || modelId === currentSession.model) return;

  setStatus('Switching model...', 'working');
  try {
    const res = await fetch('/api/sessions/' + currentSession.id + '/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: fullModelId }),
    });
    if (res.ok) {
      currentSession.model = modelId;
      updateSessionHeader();
      renderSessions();
      setStatus('Model switched to ' + modelId);
    } else {
      const data = await res.json().catch(() => ({}));
      setStatus('Model switch failed: ' + (data.error || 'unknown error'), 'error');
    }
  } catch (e) {
    setStatus('Model switch failed: ' + e.message, 'error');
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

// Render user message — clean, minimal like TUI
function renderUserMessage(msg, time) {
  const content = extractTextContent(msg.content);
  
  return `
    <div class="message user">
      <div class="message-header">
        <span class="message-role user">❯</span>
        ${time ? `<span class="message-time">${time}</span>` : ''}
      </div>
      <div class="message-content user-content">
        <div class="markdown-body">${formatMarkdown(content)}</div>
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
  
  // Only show model badge if it differs from session model or is first message
  const showModel = msg.model && (!currentSession || msg.model !== currentSession.model);
  
  return `
    <div class="message assistant${streamingClass}" data-timestamp="${timestamp}"${streamingAttr}>
      <div class="message-header">
        <span class="message-role assistant">◆</span>
        ${showModel ? `<span class="badge">${escapeHtml(msg.model)}</span>` : ''}
        ${opts.streaming ? '<span class="badge streaming">●</span>' : ''}
        ${time ? `<span class="message-time">${time}</span>` : ''}
      </div>
      ${thinkingHtml}
      ${toolCallsHtml}
      ${textHtml ? `<div class="message-content"><div class="markdown-body">${textHtml}</div></div>` : ''}
    </div>
  `;
}

// Render thinking block — collapsed by default like TUI
function renderThinkingBlock(thinking) {
  const id = 'think-' + Math.random().toString(36).substr(2, 9);
  const preview = thinking.substring(0, 80).replace(/\n/g, ' ');
  return `
    <details class="thinking-block">
      <summary class="thinking-header">
        <span class="thinking-label">Thinking</span>
        <span class="thinking-preview">${escapeHtml(preview)}…</span>
      </summary>
      <div class="thinking-text" id="${id}">${escapeHtml(thinking)}</div>
    </details>
  `;
}

// Render tool call — collapsible, shows tool name + summary
function renderToolCall(block) {
  const args = block.arguments || {};
  // Build a one-line summary based on tool type
  let summary = '';
  if (block.name === 'Bash' || block.name === 'bash') {
    summary = args.command ? truncate(args.command.split('\n')[0], 80) : '';
  } else if (block.name === 'Read' || block.name === 'read') {
    summary = args.path || '';
  } else if (block.name === 'Edit' || block.name === 'edit') {
    summary = args.path || '';
  } else if (block.name === 'Write' || block.name === 'write') {
    summary = args.path || '';
  } else {
    const keys = Object.keys(args);
    if (keys.length > 0) summary = truncate(String(args[keys[0]]), 60);
  }
  
  const argsJson = JSON.stringify(args, null, 2);
  return `
    <details class="tool-call">
      <summary class="tool-call-header">
        <span class="tool-call-icon">⚡</span>
        <span class="tool-call-name">${escapeHtml(block.name)}</span>
        ${summary ? `<span class="tool-call-summary">${escapeHtml(summary)}</span>` : ''}
      </summary>
      <div class="tool-call-content">
        <pre><code>${escapeHtml(argsJson)}</code></pre>
      </div>
    </details>
  `;
}

// Render tool result — collapsible, compact
function renderToolResult(msg, time) {
  const content = extractTextContent(msg.content);
  const isError = msg.isError;
  const timestamp = msg.timestamp || Date.now();
  const lines = content.split('\n');
  const lineCount = lines.length;
  const preview = truncate(lines[0], 80);
  
  return `
    <div class="message tool-result ${isError ? 'error' : ''}" data-timestamp="${timestamp}">
      <details class="tool-result-details" ${lineCount <= 5 ? 'open' : ''}>
        <summary class="tool-result-header">
          <span class="tool-result-icon">${isError ? '✗' : '✓'}</span>
          <span class="tool-result-name">${escapeHtml(msg.toolName || 'result')}</span>
          ${lineCount > 5 ? `<span class="tool-result-meta">${lineCount} lines</span>` : ''}
          ${isError ? '<span class="tool-result-meta error-badge">error</span>' : ''}
          ${lineCount > 5 ? `<span class="tool-result-preview">${escapeHtml(preview)}</span>` : ''}
        </summary>
        <div class="tool-result-content">
          <pre>${escapeHtml(truncate(content, 2000))}</pre>
        </div>
      </details>
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
  
  // Intercept /tree command — open modal instead of sending
  if (message === '/tree') {
    input.value = '';
    openTreeModal();
    return;
  }
  
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
    setStatus('Creating session...', 'working');
    const res = await fetch('/api/sessions/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success && data.id) {
      setStatus('Session created', 'working');
      // Wait a moment for the session file to be written, then reload and select
      setTimeout(async () => {
        await loadSessions();
        selectSession(data.id);
      }, 2000);
      return;
    }

    setStatus(data.error || 'Failed to create session', 'error');
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

// Configure marked for proper markdown rendering
(function() {
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      highlight: function(code, lang) {
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          try { return hljs.highlight(code, { language: lang }).value; } catch(e) {}
        }
        if (typeof hljs !== 'undefined') {
          try { return hljs.highlightAuto(code).value; } catch(e) {}
        }
        return code;
      },
      breaks: true,
      gfm: true,
    });
  }
})();

function formatMarkdown(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined') {
    try { return marked.parse(text); } catch(e) {}
  }
  // Fallback
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) =>
    `<pre><code class="language-${lang}">${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
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

// =========================================================================
// Tree Modal
// =========================================================================
var treeData = null; // cached tree data
var treeToolCallMap = new Map(); // toolCallId -> { name, args }

async function openTreeModal() {
  if (!currentSession) return;
  setStatus('Loading tree...', 'working');
  try {
    const res = await fetch('/api/sessions/' + currentSession.id + '/tree');
    if (!res.ok) throw new Error(await res.text());
    treeData = await res.json();
    
    // Build tool call map from assistant messages
    treeToolCallMap.clear();
    for (var node of treeData.nodes) {
      if (node.role === 'assistant' && node.toolCalls) {
        for (var tc of node.toolCalls) {
          treeToolCallMap.set(tc.id, { name: tc.name, args: tc.args });
        }
      }
    }
    
    document.getElementById('treeSearch').value = '';
    document.getElementById('treeFilter').value = 'default';
    filterTree('');
    document.getElementById('treeModal').style.display = 'flex';
    document.getElementById('treeSearch').focus();
    setStatus('');
  } catch (e) {
    setStatus('Failed to load tree: ' + e.message, 'error');
  }
}

function closeTreeModal() {
  document.getElementById('treeModal').style.display = 'none';
  treeData = null;
}

// Keyboard handler for tree modal
document.addEventListener('keydown', function(e) {
  var modal = document.getElementById('treeModal');
  if (modal.style.display === 'none') return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeTreeModal();
  }
});

function filterTree(query) {
  if (!treeData) return;
  var filterMode = document.getElementById('treeFilter').value;
  var searchTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  
  var filtered = treeData.nodes.filter(function(node) {
    // Filter mode
    if (filterMode === 'user-only' && !(node.type === 'message' && node.role === 'user')) return false;
    if (filterMode === 'no-tools' && node.type === 'message' && node.role === 'toolResult') return false;
    if (filterMode === 'default') {
      // Hide settings entries
      if (node.type === 'model_change' || node.type === 'thinking_level_change' || 
          node.type === 'label' || node.type === 'custom') return false;
      // Hide assistant messages with only tool calls (no text)
      if (node.type === 'message' && node.role === 'assistant' && !node.text && !node.isLeaf) return false;
    }
    
    // Search filter
    if (searchTokens.length > 0) {
      var searchText = getNodeSearchText(node).toLowerCase();
      return searchTokens.every(function(t) { return searchText.includes(t); });
    }
    return true;
  });
  
  renderTree(filtered);
}

function getNodeSearchText(node) {
  var parts = [node.text || ''];
  if (node.role) parts.push(node.role);
  if (node.label) parts.push(node.label);
  if (node.toolName) parts.push(node.toolName);
  if (node.modelId) parts.push(node.modelId);
  if (node.summary) parts.push(node.summary);
  return parts.join(' ');
}

function renderTree(nodes) {
  var body = document.getElementById('treeBody');
  if (!treeData) return;
  
  var activeSet = new Set(treeData.activePathIds);
  
  // Build parent→children map for connector rendering
  var childrenOf = {};
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var pid = n.parentId || '__root__';
    if (!childrenOf[pid]) childrenOf[pid] = [];
    childrenOf[pid].push(n);
  }
  
  var html = '';
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var isActive = activeSet.has(node.id);
    var isLeaf = node.isLeaf;
    
    // Build tree prefix based on depth
    var indent = '';
    for (var d = 0; d < node.depth; d++) {
      indent += '  ';
    }
    
    // Connector — only show at branch points (depth > 0)
    var siblings = childrenOf[node.parentId || '__root__'] || [];
    var sibIdx = siblings.indexOf(node);
    var isLast = sibIdx === siblings.length - 1;
    var connector = '';
    if (node.depth > 0 && siblings.length > 1) {
      connector = isLast ? '└ ' : '├ ';
    }
    
    var marker = isActive ? '•' : ' ';
    var markerClass = isActive ? 'active-marker' : 'inactive-marker';
    
    var classes = 'tree-node';
    if (isActive) classes += ' active';
    if (isLeaf) classes += ' is-leaf';
    
    var display = renderTreeNodeContent(node);
    var branchBadge = node.childCount > 1 ? '<span class="tree-branch-badge">' + node.childCount + '</span>' : '';
    
    html += '<div class="' + classes + '" data-id="' + node.id + '" onclick="selectTreeNode(\'' + node.id + '\')">';
    html += '<span class="tree-prefix">' + indent + connector + '</span>';
    html += '<span class="tree-marker ' + markerClass + '">' + marker + ' </span>';
    html += display;
    html += branchBadge;
    html += '</div>';
  }
  
  body.innerHTML = html;
  document.getElementById('treeStatus').textContent = nodes.length + ' entries';
  
  // Scroll to leaf/active node
  var leafNode = body.querySelector('.is-leaf');
  if (leafNode) {
    leafNode.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}

function renderTreeNodeContent(node) {
  if (node.type === 'message') {
    if (node.role === 'user') {
      return '<span class="tree-role user">user:</span>' +
        (node.label ? '<span class="tree-label">[' + escapeHtml(node.label) + ']</span>' : '') +
        '<span class="tree-text">' + escapeHtml(node.text || '(empty)') + '</span>';
    }
    if (node.role === 'assistant') {
      var text = node.text || '';
      if (!text && node.stopReason === 'aborted') text = '(aborted)';
      if (!text && node.errorMessage) return '<span class="tree-role assistant">assistant:</span><span class="tree-text error-text">' + escapeHtml(node.errorMessage.substring(0, 80)) + '</span>';
      if (!text) text = '(tool use)';
      return '<span class="tree-role assistant">assistant:</span>' +
        (node.label ? '<span class="tree-label">[' + escapeHtml(node.label) + ']</span>' : '') +
        '<span class="tree-text">' + escapeHtml(text) + '</span>';
    }
    if (node.role === 'toolResult') {
      var tc = node.toolCallId ? treeToolCallMap.get(node.toolCallId) : null;
      var display = tc ? '[' + tc.name + ': ' + tc.args + ']' : '[' + (node.toolName || 'tool') + ']';
      return '<span class="tree-role tool">' + escapeHtml(display) + '</span>' +
        (node.isError ? '<span class="tree-text error-text"> error</span>' : '');
    }
    return '<span class="tree-text muted">[' + (node.role || 'message') + ']</span>';
  }
  if (node.type === 'compaction') {
    var tokens = Math.round((node.tokensBefore || 0) / 1000);
    return '<span class="tree-role system">[compaction: ' + tokens + 'k tokens]</span>';
  }
  if (node.type === 'model_change') {
    return '<span class="tree-text muted">[model: ' + escapeHtml(node.modelId || '') + ']</span>';
  }
  if (node.type === 'branch_summary') {
    return '<span class="tree-role system">[branch summary]</span> <span class="tree-text muted">' + escapeHtml(node.summary || '') + '</span>';
  }
  if (node.type === 'session_info') {
    return '<span class="tree-text muted">[session info]</span>';
  }
  return '<span class="tree-text muted">[' + escapeHtml(node.type) + ']</span>';
}

async function selectTreeNode(entryId) {
  if (!currentSession || !treeData) return;
  
  // Don't branch if clicking the current leaf
  if (entryId === treeData.leafId) {
    closeTreeModal();
    return;
  }
  
  var confirmed = confirm('Branch from this point? The session will continue from here.');
  if (!confirmed) return;
  
  setStatus('Branching...', 'working');
  try {
    var res = await fetch('/api/sessions/' + currentSession.id + '/branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: entryId })
    });
    if (!res.ok) throw new Error((await res.json().catch(function(){return{};})).error || 'Failed');
    
    closeTreeModal();
    setStatus('Branched successfully — reload to see updated messages');
    // Reload session messages
    selectSession(currentSession.id);
  } catch (e) {
    setStatus('Branch failed: ' + e.message, 'error');
  }
}
