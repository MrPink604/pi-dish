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

  promptInput.addEventListener('keydown', (e) => {
    if (autocompleteVisible) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveAutocomplete(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveAutocomplete(-1); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        var items = document.querySelectorAll('.autocomplete-item');
        if (items.length > 0 && autocompleteIndex >= 0) {
          e.preventDefault();
          acceptAutocomplete(items[autocompleteIndex]);
          return;
        }
      }
      if (e.key === 'Escape') { e.preventDefault(); hideAutocomplete(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
    if (e.key === 'Escape' && !autocompleteVisible && turnInProgress) { e.preventDefault(); abortTurn(); }
  });

  // Global Ctrl+C to abort
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'c' && turnInProgress) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { e.preventDefault(); abortTurn(); }
    }
  });

  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
    handleAutocomplete(promptInput.value);
  });
  
  setInterval(loadSessions, 10000);
  
  document.getElementById('sessionList').addEventListener('click', (e) => {
    if (e.target.closest('.session-item') && window.innerWidth <= 768) closeSidebar();
  });

  promptInput.addEventListener('blur', () => { setTimeout(hideAutocomplete, 200); });
});

// =========================================================================
// Autocomplete
// =========================================================================

function handleAutocomplete(text) {
  if (!text.startsWith('/')) { hideAutocomplete(); return; }
  var spaceIdx = text.indexOf(' ');
  var query = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
  if (spaceIdx > 0) { hideAutocomplete(); return; }
  var matches = slashCommands.filter(cmd => cmd.name.toLowerCase().startsWith(query.toLowerCase()));
  if (matches.length === 0 || (matches.length === 1 && matches[0].name === query)) { hideAutocomplete(); return; }
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
  container.innerHTML = matches.map((cmd, i) => {
    var icon = cmd.source === 'builtin' ? '⚙️' : cmd.source === 'extension' ? '🧩' : cmd.source === 'skill' ? '📚' : '📝';
    var active = i === 0 ? ' active' : '';
    var args = cmd.args ? ' <span class="autocomplete-args">' + escapeHtml(cmd.args) + '</span>' : '';
    return '<div class="autocomplete-item' + active + '" data-name="' + escapeHtml(cmd.name) + '" onclick="acceptAutocompleteByName(\'' + escapeHtml(cmd.name) + '\')">'
      + '<span class="autocomplete-icon">' + icon + '</span>'
      + '<span class="autocomplete-name">/' + escapeHtml(cmd.name) + args + '</span>'
      + '<span class="autocomplete-desc">' + escapeHtml(cmd.description) + '</span></div>';
  }).join('');
  container.style.display = 'block';
}

function hideAutocomplete() {
  autocompleteVisible = false;
  var c = document.getElementById('autocomplete');
  if (c) c.style.display = 'none';
}

function moveAutocomplete(delta) {
  var items = document.querySelectorAll('.autocomplete-item');
  if (!items.length) return;
  items[autocompleteIndex].classList.remove('active');
  autocompleteIndex = (autocompleteIndex + delta + items.length) % items.length;
  items[autocompleteIndex].classList.add('active');
  items[autocompleteIndex].scrollIntoView({ block: 'nearest' });
}

function acceptAutocomplete(el) { acceptAutocompleteByName(el.getAttribute('data-name')); }

function acceptAutocompleteByName(name) {
  var input = document.getElementById('promptInput');
  input.value = '/' + name + ' ';
  input.focus();
  hideAutocomplete();
  input.dispatchEvent(new Event('input'));
}

// =========================================================================
// Sidebar
// =========================================================================

let sidebarTab = 'active'; // 'active' or 'browse'
let filterQuery = '';
let filterDebounceTimer = null;

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const willOpen = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', willOpen);
  overlay.classList.toggle('active', willOpen);
  document.body.classList.toggle('sidebar-open', willOpen);
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
  document.body.classList.remove('sidebar-open');
}

function switchTab(tab) {
  sidebarTab = tab;
  document.getElementById('tabActive').classList.toggle('active', tab === 'active');
  document.getElementById('tabBrowse').classList.toggle('active', tab === 'browse');
  document.getElementById('filterInput').placeholder = tab === 'active' ? 'Filter active sessions...' : 'Search all sessions...';
  renderSessions();
}

function onFilterInput() {
  clearTimeout(filterDebounceTimer);
  const q = document.getElementById('filterInput').value.trim();
  // Local filter is instant; server search is debounced
  filterQuery = q;
  if (sidebarTab === 'browse' && q.length > 0) {
    filterDebounceTimer = setTimeout(() => loadSessions(q), 300);
  } else {
    renderSessions();
  }
}

async function loadSessions(query) {
  try {
    const url = query ? `/api/sessions?q=${encodeURIComponent(query)}` : '/api/sessions';
    const res = await fetch(url);
    sessions = await res.json();
    renderSessions();
  } catch (e) {
    console.error('Failed to load sessions:', e);
  }
}

function refreshSessions() { loadSessions(); }

function formatTokens(tokens) {
  if (!tokens || tokens === 0) return '0';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  var diff = Math.max(0, Date.now() - new Date(ts).getTime());
  var s = Math.floor(diff / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (s < 60) return 'just now';
  if (m < 60) return m + 'm ago';
  if (h < 24) return h + 'h ago';
  if (d === 1) return 'yesterday';
  if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Shorten cwd for display */
function shortCwd(cwd) {
  if (!cwd) return '';
  return cwd.replace(/^\/home\/[^/]+\//, '~/').replace(/^\/home\/[^/]+$/, '~');
}

/** Group sessions by workspace (cwd), sorted by last activity within each group */
function groupByWorkspace(list) {
  const groups = new Map(); // cwd -> [sessions]
  for (const s of list) {
    const key = s.cwd || '~';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  // Sort sessions within each group by last activity
  for (const [, sessions] of groups) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  // Sort groups by most recent session in each
  const sorted = [...groups.entries()].sort((a, b) => {
    const aTime = new Date(a[1][0].lastActivity).getTime();
    const bTime = new Date(b[1][0].lastActivity).getTime();
    return bTime - aTime;
  });

  return sorted; // [[cwd, sessions], ...]
}

/** Apply local filter to session list (matches name, cwd, model) */
function applyLocalFilter(list) {
  if (!filterQuery) return list;
  const tokens = filterQuery.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(s => {
    const text = [s.name, s.cwd, s.model, s.id].join(' ').toLowerCase();
    return tokens.every(t => text.includes(t));
  });
}

function renderSessionItem(session) {
  const ctxClass = session.contextPercent > 80 ? 'critical' : session.contextPercent > 50 ? 'high' : '';
  const activeClass = currentSession?.id === session.id ? 'active' : '';
  const displayName = session.name || 'Unnamed';
  const tokenDisplay = session.contextTokens ? `${formatTokens(session.contextTokens)} tok` : '';
  const timeAgo = formatRelativeTime(session.lastActivity);

  return `
    <div class="session-item ${activeClass}" onclick="selectSession('${session.id}')">
      <div class="session-item-header">
        <span class="session-item-name" title="${escapeHtml(session.id)}">${escapeHtml(displayName)}</span>
        <span class="session-item-time">${timeAgo}</span>
      </div>
      <div class="session-item-meta">
        <span class="session-item-model">${escapeHtml(session.model)}</span>
        <span class="session-item-context ${ctxClass}">${session.contextPercent}%</span>
        ${tokenDisplay ? `<span class="session-item-tokens">${tokenDisplay}</span>` : ''}
        <span>${session.messageCount} msgs</span>
      </div>
    </div>
  `;
}

function renderSessions() {
  const list = document.getElementById('sessionList');
  const { active, previous } = sessions;
  const showing = sidebarTab === 'active' ? active : previous;

  // For active tab, apply local filter; for browse, server already filtered if query
  const filtered = sidebarTab === 'active' ? applyLocalFilter(showing) : (filterQuery ? showing : applyLocalFilter(showing));

  if (filtered.length === 0) {
    const msg = sidebarTab === 'active'
      ? (active.length === 0 ? 'No active sessions<br><span style="font-size:11px">Click "+ New Session" or resume one from Browse</span>' : 'No matches')
      : (previous.length === 0 ? 'No previous sessions found' : 'No matches');
    list.innerHTML = `<div class="empty-session"><p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">${msg}</p></div>`;
    return;
  }

  // Group by workspace
  const groups = groupByWorkspace(filtered);
  let html = '';

  for (const [cwd, groupSessions] of groups) {
    const label = shortCwd(cwd);
    html += `<div class="session-segment">
      <div class="workspace-group-header">
        <span class="workspace-group-label" title="${escapeHtml(cwd)}">${escapeHtml(label)}</span>
        <span class="workspace-group-count">${groupSessions.length}</span>
      </div>
      ${groupSessions.map(renderSessionItem).join('')}
    </div>`;
  }

  list.innerHTML = html;
}

function findSession(id) {
  return sessions.active.find(s => s.id === id) || sessions.previous.find(s => s.id === id);
}

// =========================================================================
// Session Selection
// =========================================================================

async function selectSession(id) {
  currentSession = findSession(id);
  if (!currentSession) return;
  
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('sessionView').style.display = 'flex';
  
  // Show/hide input area vs resume bar based on active state
  const inputArea = document.querySelector('.input-area');
  const resumeBar = document.getElementById('resumeBar');
  const sessionActions = document.querySelector('.session-actions');
  
  const inputMeta = document.getElementById('inputMeta');
  
  if (currentSession.isActive) {
    if (inputArea) inputArea.style.display = '';
    if (resumeBar) resumeBar.style.display = 'none';
  } else {
    if (inputArea) inputArea.style.display = 'none';
    if (resumeBar) {
      resumeBar.style.display = '';
      const cwdSpan = resumeBar.querySelector('.resume-cwd');
      if (cwdSpan) cwdSpan.textContent = currentSession.cwd || '~';
    }
  }
  if (sessionActions) sessionActions.style.display = currentSession.isActive ? '' : 'none';
  
  renderSessions();
  updateSessionHeader();
  await loadMessages(id);
  
  if (currentSession.isActive) {
    startMessageStream(id);
  } else {
    if (messageStream) { messageStream.close(); messageStream = null; }
  }
}

// Resume a previous session
async function resumeSession() {
  if (!currentSession) return;
  setStatus('Resuming session...', 'working');
  
  try {
    const res = await fetch(`/api/sessions/${currentSession.id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    
    if (res.ok && data.success) {
      setStatus('Session resumed');
      // Reload sessions and re-select (it's now active)
      await loadSessions();
      selectSession(data.id);
    } else {
      setStatus('Resume failed: ' + (data.error || 'unknown'), 'error');
    }
  } catch (e) {
    setStatus('Resume failed: ' + e.message, 'error');
  }
}

// =========================================================================
// Models
// =========================================================================

let knownModels = [];

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    knownModels = await res.json();
  } catch (e) { console.error('Failed to load models:', e); }
}

function filterModels(query) {
  if (!query) return knownModels;
  const q = query.toLowerCase();
  return knownModels.filter(m =>
    m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q))
  );
}

// =========================================================================
// Session Header
// =========================================================================

function updateSessionHeader() {
  if (!currentSession) return;
  
  document.getElementById('sessionName').textContent = currentSession.name || 'Unnamed';
  document.getElementById('sessionModel').textContent = currentSession.model + ' ▾';
  document.getElementById('sessionMsgCount').textContent = `${currentSession.messageCount} msgs`;
  
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

  const tokenStr = currentSession.contextTokens ? ` (${formatTokens(currentSession.contextTokens)} tok)` : '';
  const ctxText = `${currentSession.contextPercent}%${tokenStr}`;
  const ctxClass = currentSession.contextPercent > 80 ? 'critical' : currentSession.contextPercent > 50 ? 'high' : '';
  
  // Desktop meta
  const contextEl = document.getElementById('sessionContext');
  contextEl.textContent = ctxText;
  contextEl.className = 'badge badge-context' + (ctxClass ? ' ' + ctxClass : '');

  // Mobile meta (inline in actions row)
  const mobileModel = document.getElementById('sessionModelMobile');
  const mobileCtx = document.getElementById('sessionContextMobile');
  if (mobileModel) {
    if (currentSession.isActive) {
      mobileModel.textContent = currentSession.model + ' ▾';
      mobileModel.onclick = toggleModelDropdown;
      mobileModel.style.cursor = 'pointer';
    } else {
      mobileModel.textContent = currentSession.model;
      mobileModel.onclick = null;
      mobileModel.style.cursor = 'default';
    }
  }
  if (mobileCtx) {
    mobileCtx.textContent = ctxText;
    mobileCtx.className = 'badge badge-context' + (ctxClass ? ' ' + ctxClass : '');
  }
}

// --- Inline rename ---
function startRename() {
  if (!currentSession || !currentSession.isActive) return;
  const nameEl = document.getElementById('sessionName');
  const inputEl = document.getElementById('sessionNameInput');
  nameEl.style.display = 'none';
  inputEl.style.display = '';
  inputEl.value = currentSession.name || '';
  inputEl.focus();
  inputEl.select();
}

function handleRenameKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
  else if (e.key === 'Escape') cancelRename();
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) { currentSession.name = newName; nameEl.textContent = newName; renderSessions(); }
    else setStatus('Rename failed', 'error');
  } catch (e) { setStatus('Rename failed: ' + e.message, 'error'); }
}

function cancelRename() {
  document.getElementById('sessionNameInput').style.display = 'none';
  document.getElementById('sessionName').style.display = '';
}

// --- Model dropdown ---
let modelDropdownOpen = false;

function toggleModelDropdown() {
  if (!currentSession || !currentSession.isActive) return;
  modelDropdownOpen = !modelDropdownOpen;
  const dropdown = document.getElementById('modelDropdown');
  if (!modelDropdownOpen) { dropdown.style.display = 'none'; return; }
  renderModelDropdown('');
  dropdown.style.display = 'flex';
  var searchInput = dropdown.querySelector('.model-search');
  if (searchInput) searchInput.focus();
  setTimeout(() => document.addEventListener('click', closeModelDropdownOnOutsideClick, { once: true }), 0);
}

// Close model dropdown — check both desktop and mobile selectors


function renderModelDropdown(query) {
  var dropdown = document.getElementById('modelDropdown');
  var filtered = filterModels(query);
  var searchInput = dropdown.querySelector('.model-search');
  if (!searchInput) {
    searchInput = document.createElement('input');
    searchInput.type = 'text'; searchInput.className = 'model-search'; searchInput.placeholder = 'Search models...';
    searchInput.addEventListener('input', function() { renderModelDropdown(this.value); });
    searchInput.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModelDropdown(); });
    dropdown.appendChild(searchInput);
  }
  if (searchInput.value !== query) searchInput.value = query;
  var results = dropdown.querySelector('.model-results');
  if (!results) { results = document.createElement('div'); results.className = 'model-results'; dropdown.appendChild(results); }
  var groups = {};
  filtered.forEach(m => { if (!groups[m.provider]) groups[m.provider] = []; groups[m.provider].push(m); });
  var html = '';
  Object.keys(groups).sort().forEach(provider => {
    html += '<div class="model-group-header">' + escapeHtml(provider) + '</div>';
    groups[provider].forEach(m => {
      var fullId = m.provider + '/' + m.id;
      var activeClass = (m.id === currentSession?.model || fullId === currentSession?.model) ? 'active' : '';
      var badges = '';
      if (m.free) badges += '<span class="model-badge free">free</span>';
      if (m.reasoning) badges += '<span class="model-badge reasoning">🧠</span>';
      html += '<div class="model-option ' + activeClass + '" onclick="selectModel(\'' + escapeHtml(fullId) + '\')" title="' + escapeHtml(fullId) + '"><span class="model-option-name">' + escapeHtml(m.id) + '</span>' + badges + '</div>';
    });
  });
  if (!filtered.length) html += '<div class="model-option" style="color:var(--text-muted);cursor:default">No models found</div>';
  results.innerHTML = html;
}

function closeModelDropdownOnOutsideClick(e) {
  var inside = document.getElementById('modelSelector').contains(e.target) ||
    document.getElementById('modelSelectorMobile')?.contains(e.target) ||
    document.getElementById('modelDropdown').contains(e.target);
  if (!inside) closeModelDropdown();
  else setTimeout(() => document.addEventListener('click', closeModelDropdownOnOutsideClick, { once: true }), 0);
}

function closeModelDropdown() {
  modelDropdownOpen = false;
  document.getElementById('modelDropdown').style.display = 'none';
}

async function selectModel(fullModelId) {
  closeModelDropdown();
  var modelId = fullModelId.includes('/') ? fullModelId.split('/').slice(1).join('/') : fullModelId;
  if (!currentSession || modelId === currentSession.model) return;
  setStatus('Switching model...', 'working');
  try {
    const res = await fetch('/api/sessions/' + currentSession.id + '/model', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: fullModelId }),
    });
    if (res.ok) {
      currentSession.model = modelId;
      updateSessionHeader(); renderSessions();
      setStatus('Model switched to ' + modelId);
    } else {
      const data = await res.json().catch(() => ({}));
      setStatus('Model switch failed: ' + (data.error || 'unknown'), 'error');
    }
  } catch (e) { setStatus('Model switch failed: ' + e.message, 'error'); }
}

// =========================================================================
// Messages
// =========================================================================

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

function renderMessages(messages) {
  const container = document.getElementById('messages');
  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 48px;"><p style="color: var(--text-muted);">No messages yet</p></div>';
    return;
  }
  container.innerHTML = messages.map(msg => {
    const time = msg.timestamp ? formatTime(msg.timestamp) : '';
    if (msg.role === 'user') return renderUserMessage(msg, time);
    if (msg.role === 'assistant') return renderAssistantMessage(msg, time);
    if (msg.role === 'toolResult') return renderToolResult(msg, time);
    return '';
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function renderUserMessage(msg, time) {
  const content = extractTextContent(msg.content);
  return `<div class="message user">
    <div class="message-header"><span class="message-role user">❯</span>${time ? `<span class="message-time">${time}</span>` : ''}</div>
    <div class="message-content user-content"><div class="markdown-body">${formatMarkdown(content)}</div></div>
  </div>`;
}

function renderAssistantMessage(msg, time, opts = {}) {
  let thinkingHtml = '', textHtml = '', toolCallsHtml = '';
  const timestamp = msg.timestamp || Date.now();
  const streamingClass = opts.streaming ? ' streaming' : '';
  const streamingAttr = opts.streaming ? ' data-streaming="true"' : '';
  
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'thinking' && block.thinking) thinkingHtml += renderThinkingBlock(block.thinking);
      else if (block.type === 'text' && block.text) textHtml += formatMarkdown(block.text);
      else if (block.type === 'toolCall') toolCallsHtml += renderToolCall(block);
    }
  } else if (typeof msg.content === 'string') {
    textHtml = formatMarkdown(msg.content);
  }
  
  const showModel = msg.model && (!currentSession || msg.model !== currentSession.model);
  
  return `<div class="message assistant${streamingClass}" data-timestamp="${timestamp}"${streamingAttr}>
    <div class="message-header">
      <span class="message-role assistant">◆</span>
      ${showModel ? `<span class="badge">${escapeHtml(msg.model)}</span>` : ''}
      ${opts.streaming ? '<span class="badge streaming">●</span>' : ''}
      ${time ? `<span class="message-time">${time}</span>` : ''}
    </div>
    ${thinkingHtml}${toolCallsHtml}
    ${textHtml ? `<div class="message-content"><div class="markdown-body">${textHtml}</div></div>` : ''}
  </div>`;
}

function renderThinkingBlock(thinking) {
  const preview = thinking.substring(0, 80).replace(/\n/g, ' ');
  return `<details class="thinking-block">
    <summary class="thinking-header"><span class="thinking-label">Thinking</span><span class="thinking-preview">${escapeHtml(preview)}…</span></summary>
    <div class="thinking-text">${escapeHtml(thinking)}</div>
  </details>`;
}

function renderToolCall(block) {
  const args = block.arguments || {};
  let summary = '';
  if (block.name === 'Bash' || block.name === 'bash') summary = args.command ? truncate(args.command.split('\n')[0], 80) : '';
  else if (['Read','read','Edit','edit','Write','write'].includes(block.name)) summary = args.path || '';
  else { const keys = Object.keys(args); if (keys.length) summary = truncate(String(args[keys[0]]), 60); }
  
  return `<details class="tool-call">
    <summary class="tool-call-header">
      <span class="tool-call-icon">⚡</span><span class="tool-call-name">${escapeHtml(block.name)}</span>
      ${summary ? `<span class="tool-call-summary">${escapeHtml(summary)}</span>` : ''}
    </summary>
    <div class="tool-call-content"><pre><code>${escapeHtml(JSON.stringify(args, null, 2))}</code></pre></div>
  </details>`;
}

function renderToolResult(msg, time) {
  const content = extractTextContent(msg.content);
  const isError = msg.isError;
  const timestamp = msg.timestamp || Date.now();
  const lines = content.split('\n');
  const lineCount = lines.length;
  const preview = truncate(lines[0], 80);
  
  return `<div class="message tool-result ${isError ? 'error' : ''}" data-timestamp="${timestamp}">
    <details class="tool-result-details" ${lineCount <= 5 ? 'open' : ''}>
      <summary class="tool-result-header">
        <span class="tool-result-icon">${isError ? '✗' : '✓'}</span>
        <span class="tool-result-name">${escapeHtml(msg.toolName || 'result')}</span>
        ${lineCount > 5 ? `<span class="tool-result-meta">${lineCount} lines</span>` : ''}
        ${isError ? '<span class="tool-result-meta error-badge">error</span>' : ''}
        ${lineCount > 5 ? `<span class="tool-result-preview">${escapeHtml(preview)}</span>` : ''}
      </summary>
      <div class="tool-result-content"><pre>${escapeHtml(truncate(content, 2000))}</pre></div>
    </details>
  </div>`;
}

function extractTextContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => typeof c === 'string' ? c : c.type === 'text' ? c.text : '').join('\n');
  return '';
}

// =========================================================================
// SSE Streaming (RPC events only)
// =========================================================================

let messageStream = null;
let streamReconnectTimeout = null;

function startMessageStream(sessionId) {
  if (streamReconnectTimeout) { clearTimeout(streamReconnectTimeout); streamReconnectTimeout = null; }
  if (messageStream) { messageStream.close(); messageStream = null; }
  if (!sessionId) return;

  try {
    const evtSource = new EventSource(`/api/sessions/${sessionId}/stream`);
    messageStream = evtSource;

    evtSource.onopen = () => setStatus('');

    evtSource.addEventListener('turn_start', () => setTurnInProgress(true));

    evtSource.addEventListener('turn_end', (e) => {
      setTurnInProgress(false);
      try {
        const event = JSON.parse(e.data);
        const data = event.data || event;
        if (!data.message) return;
        const container = document.getElementById('messages');
        if (!container) return;
        container.querySelectorAll('.message.assistant[data-streaming="true"]').forEach(el => el.remove());
        const ts = data.message.timestamp || Date.now();
        const msgHtml = renderAssistantMessage(data.message, formatTime(ts));
        container.insertAdjacentHTML('beforeend', msgHtml);
        container.scrollTop = container.scrollHeight;
        // Refresh session info
        loadSessions();
        setStatus('');
      } catch (err) { console.error('turn_end error:', err); }
    });

    evtSource.addEventListener('thinking', (e) => {
      if (!turnInProgress) setTurnInProgress(true);
      try { updateOrAppendMessage(JSON.parse(e.data).message); } catch (err) {}
    });

    evtSource.addEventListener('tool_call', (e) => {
      if (!turnInProgress) setTurnInProgress(true);
      try { updateOrAppendMessage(JSON.parse(e.data).message); } catch (err) {}
    });

    evtSource.addEventListener('tool_result', (e) => {
      try {
        const { message } = JSON.parse(e.data);
        if (message) updateOrAppendMessage(message);
      } catch (err) {}
    });

    evtSource.addEventListener('message_end', (e) => {
      try {
        const { message } = JSON.parse(e.data);
        if (message) {
          const container = document.getElementById('messages');
          if (!container) return;
          container.querySelectorAll('.message.assistant[data-streaming="true"]').forEach(el => el.remove());
          const ts = message.timestamp || Date.now();
          container.insertAdjacentHTML('beforeend', renderAssistantMessage(message, formatTime(ts)));
          container.scrollTop = container.scrollHeight;
        }
      } catch (err) {}
    });

    evtSource.addEventListener('session_ended', () => {
      setTurnInProgress(false);
      setStatus('Session ended');
      loadSessions();
    });

    evtSource.onerror = () => {
      if (evtSource.readyState === EventSource.CLOSED) {
        setStatus('Stream disconnected', 'error');
        streamReconnectTimeout = setTimeout(() => {
          if (currentSession && currentSession.id === sessionId) startMessageStream(sessionId);
        }, 3000);
      }
    };
  } catch (err) {
    console.error('Stream failed:', err);
    setStatus('Stream failed', 'error');
  }
}

// =========================================================================
// Prompt / Turn / Abort
// =========================================================================

async function sendPrompt() {
  const input = document.getElementById('promptInput');
  const message = input.value.trim();
  if (!message || !currentSession) return;
  
  if (message === '/tree') { input.value = ''; openTreeModal(); return; }
  
  input.value = '';
  input.style.height = '';
  setStatus('Sending...', 'working');
  
  const container = document.getElementById('messages');
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  container.insertAdjacentHTML('beforeend', renderUserMessage({
    role: 'user', content: [{ type: 'text', text: message }], timestamp: Date.now()
  }, formatTime(Date.now())));
  container.scrollTop = container.scrollHeight;
  
  setTurnInProgress(true);
  
  try {
    const res = await fetch(`/api/sessions/${currentSession.id}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (!res.ok) throw new Error(await res.text());
    setStatus('Waiting for response...', 'working');
  } catch (e) {
    setStatus(`Error: ${e.message}`, 'error');
    setTurnInProgress(false);
  }
}

var turnInProgress = false;

function setTurnInProgress(active) {
  turnInProgress = active;
  var btnStop = document.getElementById('btnStop');
  var btnSend = document.getElementById('btnSend');
  if (btnStop) btnStop.style.display = active ? '' : 'none';
  if (btnSend) btnSend.style.display = active ? 'none' : '';
  if (!active) setStatus('');
}

async function abortTurn() {
  if (!currentSession || !turnInProgress) return;
  setStatus('Stopping...', 'working');
  try {
    var res = await fetch('/api/sessions/' + currentSession.id + '/abort', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) { setStatus('Stopped'); setTurnInProgress(false); }
    else { var d = await res.json().catch(() => ({})); setStatus('Stop failed: ' + (d.error || 'unknown'), 'error'); }
  } catch (e) { setStatus('Stop failed: ' + e.message, 'error'); }
}

// New session
async function createSession() {
  try {
    setStatus('Creating session...', 'working');
    const cwdInput = document.getElementById('newSessionCwd');
    const cwd = cwdInput ? cwdInput.value.trim() : '';
    // Persist last-used cwd
    if (cwd) localStorage.setItem('pi-dish-cwd', cwd);
    const res = await fetch('/api/sessions/new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: cwd || undefined })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && data.id) {
      setStatus('Session created');
      switchTab('active');
      setTimeout(async () => { await loadSessions(); selectSession(data.id); }, 2000);
      return;
    }
    setStatus(data.error || 'Failed to create session', 'error');
  } catch (e) { setStatus(`Error: ${e.message}`, 'error'); }
}

// Restore last-used cwd on load
(function() {
  const saved = localStorage.getItem('pi-dish-cwd');
  if (saved) {
    const cwdInput = document.getElementById('newSessionCwd');
    if (cwdInput) cwdInput.value = saved;
  }
})();

// =========================================================================
// Utilities
// =========================================================================

function updateOrAppendMessage(message) {
  const container = document.getElementById('messages');
  if (!container) return;
  const timestamp = message.timestamp || Date.now();
  const msgHtml = renderAssistantMessage({ ...message, timestamp }, formatTime(timestamp), { streaming: true });
  const streamingEl = container.querySelector('.message.assistant[data-streaming="true"]');
  if (streamingEl) streamingEl.outerHTML = msgHtml;
  else container.insertAdjacentHTML('beforeend', msgHtml);
  container.scrollTop = container.scrollHeight;
}

function setStatus(message, type = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n... (truncated)';
}

// Markdown config
(function() {
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      highlight: function(code, lang) {
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          try { return hljs.highlight(code, { language: lang }).value; } catch(e) {}
        }
        if (typeof hljs !== 'undefined') { try { return hljs.highlightAuto(code).value; } catch(e) {} }
        return code;
      },
      breaks: true, gfm: true,
    });
  }
})();

function formatMarkdown(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined') { try { return marked.parse(text); } catch(e) {} }
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => `<pre><code class="language-${lang}">${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// =========================================================================
// Tree Modal
// =========================================================================
var treeData = null;
var treeToolCallMap = new Map();

async function openTreeModal() {
  if (!currentSession) return;
  setStatus('Loading tree...', 'working');
  try {
    const res = await fetch('/api/sessions/' + currentSession.id + '/tree');
    if (!res.ok) throw new Error(await res.text());
    treeData = await res.json();
    treeToolCallMap.clear();
    for (var node of treeData.nodes) {
      if (node.role === 'assistant' && node.toolCalls) {
        for (var tc of node.toolCalls) treeToolCallMap.set(tc.id, { name: tc.name, args: tc.args });
      }
    }
    document.getElementById('treeSearch').value = '';
    document.getElementById('treeFilter').value = 'default';
    filterTree('');
    document.getElementById('treeModal').style.display = 'flex';
    document.getElementById('treeSearch').focus();
    setStatus('');
  } catch (e) { setStatus('Failed to load tree: ' + e.message, 'error'); }
}

function closeTreeModal() {
  document.getElementById('treeModal').style.display = 'none';
  treeData = null;
}

document.addEventListener('keydown', function(e) {
  if (document.getElementById('treeModal').style.display !== 'none' && e.key === 'Escape') {
    e.preventDefault(); closeTreeModal();
  }
});

function filterTree(query) {
  if (!treeData) return;
  var filterMode = document.getElementById('treeFilter').value;
  var tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  
  var filtered = treeData.nodes.filter(function(node) {
    if (filterMode === 'user-only' && !(node.type === 'message' && node.role === 'user')) return false;
    if (filterMode === 'no-tools' && node.type === 'message' && node.role === 'toolResult') return false;
    if (filterMode === 'default') {
      if (['model_change','thinking_level_change','label','custom'].includes(node.type)) return false;
      if (node.type === 'message' && node.role === 'assistant' && !node.text && !node.isLeaf) return false;
    }
    if (tokens.length > 0) {
      var text = getNodeSearchText(node).toLowerCase();
      return tokens.every(t => text.includes(t));
    }
    return true;
  });
  renderTree(filtered);
}

function getNodeSearchText(node) {
  return [node.text, node.role, node.label, node.toolName, node.modelId, node.summary].filter(Boolean).join(' ');
}

function renderTree(nodes) {
  var body = document.getElementById('treeBody');
  if (!treeData) return;
  var activeSet = new Set(treeData.activePathIds);
  var childrenOf = {};
  for (var n of nodes) {
    var pid = n.parentId || '__root__';
    if (!childrenOf[pid]) childrenOf[pid] = [];
    childrenOf[pid].push(n);
  }
  
  var html = '';
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var isActive = activeSet.has(node.id);
    var indent = '  '.repeat(node.depth);
    var siblings = childrenOf[node.parentId || '__root__'] || [];
    var isLast = siblings.indexOf(node) === siblings.length - 1;
    var connector = (node.depth > 0 && siblings.length > 1) ? (isLast ? '└ ' : '├ ') : '';
    var marker = isActive ? '•' : ' ';
    var classes = 'tree-node' + (isActive ? ' active' : '') + (node.isLeaf ? ' is-leaf' : '');
    var badge = node.childCount > 1 ? '<span class="tree-branch-badge">' + node.childCount + '</span>' : '';
    
    html += '<div class="' + classes + '" data-id="' + node.id + '" onclick="selectTreeNode(\'' + node.id + '\')">';
    html += '<span class="tree-prefix">' + indent + connector + '</span>';
    html += '<span class="tree-marker ' + (isActive ? 'active-marker' : 'inactive-marker') + '">' + marker + ' </span>';
    html += renderTreeNodeContent(node) + badge + '</div>';
  }
  
  body.innerHTML = html;
  document.getElementById('treeStatus').textContent = nodes.length + ' entries';
  var leaf = body.querySelector('.is-leaf');
  if (leaf) leaf.scrollIntoView({ block: 'center', behavior: 'instant' });
}

function renderTreeNodeContent(node) {
  if (node.type === 'message') {
    if (node.role === 'user') return '<span class="tree-role user">user:</span><span class="tree-text">' + escapeHtml(node.text || '(empty)') + '</span>';
    if (node.role === 'assistant') {
      var text = node.text || '';
      if (!text && node.stopReason === 'aborted') text = '(aborted)';
      if (!text && node.errorMessage) return '<span class="tree-role assistant">assistant:</span><span class="tree-text error-text">' + escapeHtml(node.errorMessage.substring(0, 80)) + '</span>';
      if (!text) text = '(tool use)';
      return '<span class="tree-role assistant">assistant:</span><span class="tree-text">' + escapeHtml(text) + '</span>';
    }
    if (node.role === 'toolResult') {
      var tc = node.toolCallId ? treeToolCallMap.get(node.toolCallId) : null;
      var disp = tc ? '[' + tc.name + ': ' + tc.args + ']' : '[' + (node.toolName || 'tool') + ']';
      return '<span class="tree-role tool">' + escapeHtml(disp) + '</span>' + (node.isError ? '<span class="tree-text error-text"> error</span>' : '');
    }
    return '<span class="tree-text muted">[' + (node.role || 'message') + ']</span>';
  }
  if (node.type === 'compaction') return '<span class="tree-role system">[compaction: ' + Math.round((node.tokensBefore || 0) / 1000) + 'k tokens]</span>';
  if (node.type === 'model_change') return '<span class="tree-text muted">[model: ' + escapeHtml(node.modelId || '') + ']</span>';
  if (node.type === 'branch_summary') return '<span class="tree-role system">[branch summary]</span> <span class="tree-text muted">' + escapeHtml(node.summary || '') + '</span>';
  if (node.type === 'session_info') return '<span class="tree-text muted">[session info]</span>';
  return '<span class="tree-text muted">[' + escapeHtml(node.type) + ']</span>';
}

var pendingBranchId = null;

function selectTreeNode(entryId) {
  if (!currentSession || !treeData) return;
  if (entryId === treeData.leafId) { closeTreeModal(); return; }
  document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
  var el = document.querySelector('.tree-node[data-id="' + entryId + '"]');
  if (el) el.classList.add('selected');
  pendingBranchId = entryId;
  document.getElementById('treeStatus').innerHTML =
    '<button class="btn-sm btn-branch" onclick="confirmBranch()">Branch from here</button>' +
    '<button class="btn-sm" onclick="cancelBranch()" style="margin-left:8px">Cancel</button>';
}

function cancelBranch() {
  pendingBranchId = null;
  document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
  document.getElementById('treeStatus').textContent = document.querySelectorAll('.tree-node').length + ' entries';
}

async function confirmBranch() {
  if (!currentSession || !pendingBranchId) return;
  var entryId = pendingBranchId;
  pendingBranchId = null;
  setStatus('Branching...', 'working');
  try {
    var res = await fetch('/api/sessions/' + currentSession.id + '/branch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
    closeTreeModal();
    setStatus('Branched — reloading');
    selectSession(currentSession.id);
  } catch (e) { setStatus('Branch failed: ' + e.message, 'error'); }
}
