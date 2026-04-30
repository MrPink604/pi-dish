// State
let sessions = { active: [], previous: [] };
let currentSession = null;

// Live tool panel tracking: toolCallId -> { el, startTime }
let liveToolPanels = new Map();

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
document.addEventListener('DOMContentLoaded', async () => {
  await loadSessions();
  loadModels();
  loadCommands();
  
  // Restore previously selected session
  const savedSessionId = localStorage.getItem('pi-dish-session');
  if (savedSessionId) {
    const found = findSession(savedSessionId);
    if (found) selectSession(savedSessionId);
  }
  
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
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.ctrlKey) { e.preventDefault(); sendSteer(); }
      else { e.preventDefault(); sendPrompt(); }
    }
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
  if (sidebarTab === 'browse') {
    if (q.length > 0) {
      filterDebounceTimer = setTimeout(() => loadSessions(q), 300);
    } else {
      // Query cleared: reload the full browse list from server
      loadSessions();
    }
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
  localStorage.setItem('pi-dish-session', id);
  
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
    const data = await res.json();
    knownModels = Array.isArray(data) ? data : [];
  } catch (e) { console.error('Failed to load models:', e); knownModels = []; }
}

function filterModels(query) {
  if (!Array.isArray(knownModels)) return [];
  if (!query) return knownModels;
  const q = query.toLowerCase();
  return knownModels.filter(m =>
    m && typeof m.id === 'string' && m.id.toLowerCase().includes(q) ||
    m && typeof m.provider === 'string' && m.provider.toLowerCase().includes(q) ||
    m && m.name && typeof m.name === 'string' && m.name.toLowerCase().includes(q)
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
  if (window.innerWidth > 768) {
    const btn = document.getElementById('sessionModel');
    const rect = btn.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.bottom = '';
    dropdown.style.right = '';
  } else {
    dropdown.style.top = '';
    dropdown.style.left = '';
    dropdown.style.bottom = '';
    dropdown.style.right = '';
  }
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
  var isSame = (modelId === currentSession?.model || fullModelId === currentSession?.model);
  if (!currentSession || isSame) return;
  setStatus('Switching model...', 'working');
  try {
    const res = await fetch('/api/sessions/' + currentSession.id + '/model', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: fullModelId }),
    });
    if (res.ok) {
      currentSession.model = fullModelId;
      updateSessionHeader(); renderSessions();
      setStatus('Model switched to ' + fullModelId);
    } else {
      const data = await res.json().catch(() => ({}));
      setStatus('Model switch failed: ' + (data.error || 'unknown'), 'error');
    }
  } catch (e) { setStatus('Model switch failed: ' + e.message, 'error'); }
}

// =========================================================================
// Messages
// =========================================================================

const MESSAGE_PAGE_SIZE = 50;

// Pagination cursors for the currently loaded session.
let oldestLoadedIndex = null;
let lastLoadedIndex = null;
let hasMoreOlder = false;
let totalMessages = 0;
let loadingOlder = false;

function renderMessageHtml(msg) {
  const time = msg.timestamp ? formatTime(msg.timestamp) : '';
  const idxAttr = (msg.index != null) ? ` data-msg-index="${msg.index}"` : '';
  let inner;
  if (msg.role === 'user') inner = renderUserMessage(msg, time);
  else if (msg.role === 'assistant') inner = renderAssistantMessage(msg, time);
  else if (msg.role === 'toolResult') inner = renderToolResult(msg, time);
  else return '';
  // Tag the outermost element with the message index for dedup/incremental updates.
  if (idxAttr && inner.startsWith('<div ')) inner = inner.replace('<div ', `<div${idxAttr} `);
  return inner;
}

async function loadMessages(id) {
  const container = document.getElementById('messages');
  container.innerHTML = '<div class="loading">Loading...</div>';
  oldestLoadedIndex = null;
  lastLoadedIndex = null;
  hasMoreOlder = false;
  totalMessages = 0;
  try {
    const res = await fetch(`/api/sessions/${id}/messages?limit=${MESSAGE_PAGE_SIZE}`);
    const data = await res.json();
    const { messages, session, firstIndex, lastIndex, hasMore, totalMessages: total } = data;
    currentSession = { ...currentSession, ...session };
    updateSessionHeader();
    oldestLoadedIndex = firstIndex;
    lastLoadedIndex = lastIndex;
    hasMoreOlder = !!hasMore;
    totalMessages = total || 0;
    renderMessages(messages);
  } catch (e) {
    container.innerHTML = `<div class="error">Failed to load messages: ${e.message}</div>`;
  }
}

function renderLoadOlderBar() {
  if (!hasMoreOlder) return '';
  const remaining = oldestLoadedIndex != null ? oldestLoadedIndex : 0;
  return `<div class="load-older-bar" id="loadOlderBar">
    <button class="load-older-btn" onclick="loadOlderMessages()">Load older messages (${remaining} earlier)</button>
  </div>`;
}

function renderMessages(messages) {
  const container = document.getElementById('messages');
  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 48px;"><p style="color: var(--text-muted);">No messages yet</p></div>';
    return;
  }
  container.innerHTML = renderLoadOlderBar() + messages.map(renderMessageHtml).join('');
  // After rendering from JSONL, remove tool calls/results that already have live panels
  // (dedup — live panels are already showing this content)
  removeDuplicatedLiveContent(container);
  container.scrollTop = container.scrollHeight;
}

async function loadOlderMessages() {
  if (loadingOlder || !hasMoreOlder || !currentSession || oldestLoadedIndex == null) return;
  loadingOlder = true;
  const container = document.getElementById('messages');
  const bar = document.getElementById('loadOlderBar');
  if (bar) bar.querySelector('.load-older-btn').textContent = 'Loading...';

  // Anchor scroll to the first existing message so the viewport doesn't jump
  // when we prepend older content.
  const anchor = container.querySelector('[data-msg-index]');
  const anchorOffset = anchor ? anchor.getBoundingClientRect().top : 0;

  try {
    const res = await fetch(`/api/sessions/${currentSession.id}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${oldestLoadedIndex}`);
    const data = await res.json();
    const { messages, firstIndex, hasMore } = data;
    if (messages && messages.length) {
      const html = messages.map(renderMessageHtml).join('');
      // Replace the existing bar (if any) with the new bar + prepended messages.
      const existingBar = container.querySelector('#loadOlderBar');
      if (existingBar) existingBar.remove();
      oldestLoadedIndex = firstIndex != null ? firstIndex : oldestLoadedIndex;
      hasMoreOlder = !!hasMore;
      container.insertAdjacentHTML('afterbegin', renderLoadOlderBar() + html);

      // Restore scroll so the anchor stays in the same viewport position.
      if (anchor) {
        const newOffset = anchor.getBoundingClientRect().top;
        container.scrollTop += (newOffset - anchorOffset);
      }
    } else {
      hasMoreOlder = false;
      const existingBar = container.querySelector('#loadOlderBar');
      if (existingBar) existingBar.remove();
    }
  } catch (e) {
    if (bar) bar.querySelector('.load-older-btn').textContent = `Failed: ${e.message} — retry`;
  } finally {
    loadingOlder = false;
  }
}

async function fetchNewMessagesSince(sessionId) {
  // Incremental catch-up after turn_end / init. Avoids the full reload that
  // stalls long sessions.
  if (lastLoadedIndex == null) {
    // No baseline yet — fall back to a full tail load.
    return loadMessages(sessionId);
  }
  try {
    const res = await fetch(`/api/sessions/${sessionId}/messages?after=${lastLoadedIndex}`);
    const data = await res.json();
    const { messages, lastIndex, totalMessages: total, session } = data;
    if (session) {
      currentSession = { ...currentSession, ...session };
      updateSessionHeader();
    }
    if (typeof total === 'number') totalMessages = total;
    if (!messages || messages.length === 0) return;

    const container = document.getElementById('messages');
    if (!container) return;

    // Skip indices we already rendered (defensive — server uses strict >).
    const existing = new Set();
    container.querySelectorAll('[data-msg-index]').forEach(el => existing.add(parseInt(el.dataset.msgIndex, 10)));
    const fresh = messages.filter(m => !existing.has(m.index));
    if (fresh.length === 0) {
      if (lastIndex != null) lastLoadedIndex = lastIndex;
      return;
    }

    // Now that we have authoritative JSONL versions, strip optimistic
    // (non-indexed) message DOM. Streaming placeholders + the optimistic
    // user echo get replaced by their indexed counterparts.
    container.querySelectorAll('.message:not([data-msg-index])').forEach(el => el.remove());

    container.insertAdjacentHTML('beforeend', fresh.map(renderMessageHtml).join(''));
    if (lastIndex != null) lastLoadedIndex = lastIndex;
    removeDuplicatedLiveContent(container);
    container.scrollTop = container.scrollHeight;
  } catch (e) {
    console.error('fetchNewMessagesSince failed:', e);
  }
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
  
  // Show error messages from the API (e.g. 402, rate limits, etc.)
  let errorHtml = '';
  if (msg.errorMessage) {
    errorHtml = `<div class="message-content message-error"><div class="markdown-body"><strong>Error:</strong> ${escapeHtml(msg.errorMessage)}</div></div>`;
  }
  
  const showModel = msg.model && (!currentSession || msg.model !== currentSession.model);
  
  return `<div class="message assistant${streamingClass}${msg.errorMessage ? ' error' : ''}" data-timestamp="${timestamp}"${streamingAttr}>
    <div class="message-header">
      <span class="message-role assistant">◆</span>
      ${showModel ? `<span class="badge">${escapeHtml(msg.model)}</span>` : ''}
      ${opts.streaming ? '<span class="badge streaming">●</span>' : ''}
      ${time ? `<span class="message-time">${time}</span>` : ''}
    </div>
    ${thinkingHtml}${toolCallsHtml}
    ${textHtml ? `<div class="message-content"><div class="markdown-body">${textHtml}</div></div>` : ''}
    ${errorHtml}
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
// Live Tool Panels (streaming tool execution)
// =========================================================================

function getToolSummary(toolName, args) {
  if (!args) return '';
  if (toolName === 'Bash' || toolName === 'bash') return args.command ? truncate(args.command.split('\n')[0], 60) : '';
  if (['Read','read','Edit','edit','Write','write'].includes(toolName)) return args.path || '';
  const keys = Object.keys(args);
  if (keys.length) return truncate(String(args[keys[0]]), 40);
  return '';
}

function getToolOutputText(partialResult) {
  if (!partialResult || !partialResult.content) return '';
  return partialResult.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');
}

function buildLiveToolPanel(toolCallId, toolName, args, output, isError, isComplete, durationMs) {
  const stateClass = isComplete ? (isError ? 'error' : 'complete') : 'running';
  const summary = getToolSummary(toolName, args);
  const openAttr = isComplete && output ? ' open' : (output ? ' open' : '');
  
  let statusHtml = '';
  if (isComplete) {
    if (isError) {
      statusHtml = '<span class="live-tool-status error-label">✗ error</span>';
    } else {
      const dur = durationMs != null ? (durationMs / 1000).toFixed(1) + 's' : '';
      statusHtml = '<span class="live-tool-status success-label">✓</span>' +
        (dur ? '<span class="live-tool-status duration">' + dur + '</span>' : '');
    }
  } else {
    statusHtml = '<span class="live-tool-status running-label">running</span>';
  }

  const cursorHtml = isComplete ? '' : '<span class="live-tool-cursor"></span>';
  const outputHtml = output
    ? '<div class="live-tool-output">' + escapeHtml(truncate(output, 8000)) + cursorHtml + '</div>'
    : (!isComplete ? '<div class="live-tool-output"><span class="live-tool-cursor"></span></div>' : '');

  return '<details class="live-tool-panel ' + stateClass + '" data-tool-call-id="' + escapeHtml(toolCallId) + '"' + openAttr + '>' +
    '<summary class="live-tool-header">' +
      '<span class="live-tool-icon">⚡</span>' +
      '<span class="live-tool-name">' + escapeHtml(toolName) + '</span>' +
      (summary ? '<span class="live-tool-summary">' + escapeHtml(summary) + '</span>' : '') +
      statusHtml +
      '<span class="live-tool-status-dot"></span>' +
    '</summary>' +
    outputHtml +
  '</details>';
}

function appendLiveToolPanel(data) {
  const { toolCallId, toolName, args } = data;
  if (liveToolPanels.has(toolCallId)) return; // already rendered

  const container = document.getElementById('messages');
  if (!container) return;

  const html = buildLiveToolPanel(toolCallId, toolName, args, '', false, false);
  container.insertAdjacentHTML('beforeend', html);

  const el = container.querySelector('[data-tool-call-id="' + toolCallId + '"]');
  liveToolPanels.set(toolCallId, { el, startTime: Date.now() });
  container.scrollTop = container.scrollHeight;
}

function updateLiveToolPanel(data) {
  const { toolCallId, partialResult } = data;
  const entry = liveToolPanels.get(toolCallId);
  if (!entry || !entry.el) return;

  const output = getToolOutputText(partialResult);
  if (!output) return;

  let outputEl = entry.el.querySelector('.live-tool-output');
  if (!outputEl) {
    // Create output area if it doesn't exist
    const cursorHtml = '<span class="live-tool-cursor"></span>';
    outputEl = document.createElement('div');
    outputEl.className = 'live-tool-output';
    outputEl.innerHTML = escapeHtml(truncate(output, 8000)) + cursorHtml;
    entry.el.appendChild(outputEl);
    // Open the details so output is visible
    entry.el.setAttribute('open', '');
  } else {
    const cursorEl = outputEl.querySelector('.live-tool-cursor');
    outputEl.innerHTML = escapeHtml(truncate(output, 8000));
    // Re-add cursor
    if (cursorEl) outputEl.appendChild(cursorEl);
    else outputEl.insertAdjacentHTML('beforeend', '<span class="live-tool-cursor"></span>');
  }

  // Auto-scroll output area
  outputEl.scrollTop = outputEl.scrollHeight;
  // Also scroll messages container
  const container = document.getElementById('messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function finalizeLiveToolPanel(data) {
  const { toolCallId, toolName, args, result, isError } = data;
  const entry = liveToolPanels.get(toolCallId);
  if (!entry || !entry.el) return;

  const output = getToolOutputText(result);
  const durationMs = entry.startTime ? (Date.now() - entry.startTime) : null;

  // Rebuild the panel in its final state
  const newHtml = buildLiveToolPanel(toolCallId, toolName || 'tool', args, output, isError, true, durationMs);
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newEl = tmp.firstElementChild;

  entry.el.replaceWith(newEl);
  entry.el = newEl;

  // Keep in map for dedup — will be cleaned up on turn_end
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

    // Server sends current state on connect so we can catch up
    evtSource.addEventListener('init', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.turnInProgress) {
          setTurnInProgress(true);
          setStatus('Waiting for response...', 'working');
        } else {
          // Turn not in progress — incremental catch-up for any messages
          // written since our initial load (avoids full reload stall).
          setTurnInProgress(false);
          setStatus('');
          fetchNewMessagesSince(sessionId);
        }
      } catch {}
    });

    evtSource.addEventListener('stream_error', (e) => {
      try {
        const data = JSON.parse(e.data || '{}');
        setStatus(data.error || 'Stream error', 'error');
      } catch {
        setStatus('Stream error', 'error');
      }
      evtSource.close();
    });

    evtSource.addEventListener('turn_start', () => setTurnInProgress(true));

    evtSource.addEventListener('turn_end', () => {
      setTurnInProgress(false);
      // Clean up any orphaned running panels (defensive)
      for (const [id, entry] of liveToolPanels) {
        if (entry.el && entry.el.classList.contains('running')) {
          entry.el.classList.remove('running');
          entry.el.classList.add('complete');
          const dot = entry.el.querySelector('.live-tool-status-dot');
          if (dot) dot.style.display = 'none';
          const cursor = entry.el.querySelector('.live-tool-cursor');
          if (cursor) cursor.remove();
        }
      }
      // Incrementally pull only new messages from JSONL — full reload
      // stalls long sessions.
      fetchNewMessagesSince(sessionId);
      loadSessions();
      setStatus('');
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

    // Generic message_update streams text, thinking, and tool calls live.
    evtSource.addEventListener('message_update', (e) => {
      if (!turnInProgress) setTurnInProgress(true);
      try { updateOrAppendMessage(JSON.parse(e.data).message); } catch (err) {}
    });

    evtSource.addEventListener('message_end', (e) => {
      try {
        const { message } = JSON.parse(e.data);
        if (message) {
          const container = document.getElementById('messages');
          if (!container) return;
          container.querySelectorAll('.message.assistant[data-streaming="true"]').forEach(el => el.remove());
          // Avoid inserting a duplicate if turn_end already fetched the authoritative JSONL version.
          const assistantMsgs = container.querySelectorAll('.message.assistant');
          const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
          if (lastAssistant && lastAssistant.dataset.msgIndex != null) return;
          const ts = message.timestamp || Date.now();
          container.insertAdjacentHTML('beforeend', renderAssistantMessage(message, formatTime(ts)));
          container.scrollTop = container.scrollHeight;
        }
      } catch (err) {}
    });

    evtSource.addEventListener('tool_execution_start', (e) => {
      try {
        const data = JSON.parse(e.data);
        appendLiveToolPanel(data);
      } catch (err) { console.error('tool_execution_start error:', err); }
    });

    evtSource.addEventListener('tool_execution_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        updateLiveToolPanel(data);
      } catch (err) { console.error('tool_execution_update error:', err); }
    });

    evtSource.addEventListener('tool_execution_end', (e) => {
      try {
        const data = JSON.parse(e.data);
        finalizeLiveToolPanel(data);
      } catch (err) { console.error('tool_execution_end error:', err); }
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
  var btnSteer = document.getElementById('btnSteer');
  var btnSend = document.getElementById('btnSend');
  if (btnStop) btnStop.style.display = active ? '' : 'none';
  if (btnSteer) btnSteer.style.display = active ? '' : 'none';
  if (btnSend) btnSend.style.display = active ? 'none' : '';
  if (!active) setStatus('');
}

async function sendSteer() {
  const input = document.getElementById('promptInput');
  const message = input.value.trim();
  if (!message || !currentSession || !currentSession.isActive) return;

  input.value = '';
  input.style.height = '';
  setStatus('Steering...', 'working');

  try {
    const res = await fetch(`/api/sessions/${currentSession.id}/steer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (!res.ok) throw new Error(await res.text());
    setStatus('Steered');
  } catch (e) {
    setStatus(`Steer failed: ${e.message}`, 'error');
  }
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

// =========================================================================
// CWD autocomplete
// =========================================================================
let knownCwds = []; // [{path, short}]
let cwdDropdownIdx = -1;

async function loadKnownCwds() {
  try {
    const res = await fetch('/api/cwds');
    if (res.ok) knownCwds = await res.json();
  } catch {}
}

/** Simple fuzzy match: all chars of query appear in order in str */
function fuzzyMatch(query, str) {
  query = query.toLowerCase();
  str = str.toLowerCase();
  let qi = 0;
  const indices = [];
  for (let si = 0; si < str.length && qi < query.length; si++) {
    if (str[si] === query[qi]) { indices.push(si); qi++; }
  }
  return qi === query.length ? indices : null;
}

/** Score fuzzy match — prefer consecutive chars, earlier matches, shorter strings */
function fuzzyScore(indices, str) {
  if (!indices) return -Infinity;
  let score = 0;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i - 1] + 1) score += 10; // consecutive bonus
  }
  score -= indices[0]; // earlier match = better
  score -= str.length * 0.1; // shorter = better
  return score;
}

function highlightFuzzy(str, indices) {
  if (!indices || !indices.length) return escapeHtml(str);
  let result = '';
  let last = 0;
  for (const idx of indices) {
    result += escapeHtml(str.slice(last, idx));
    result += `<span class="cwd-match">${escapeHtml(str[idx])}</span>`;
    last = idx + 1;
  }
  result += escapeHtml(str.slice(last));
  return result;
}

function showCwdDropdown(query) {
  const dropdown = document.getElementById('cwdDropdown');
  if (!dropdown) return;

  if (!query && knownCwds.length === 0) { dropdown.style.display = 'none'; return; }

  let results;
  if (!query) {
    // Show all, most recent paths could be prioritized but for now just show all
    results = knownCwds.map(c => ({ ...c, indices: [], score: 0 }));
  } else {
    results = knownCwds.map(c => {
      const indices = fuzzyMatch(query, c.short) || fuzzyMatch(query, c.path);
      const matchStr = fuzzyMatch(query, c.short) ? c.short : c.path;
      return { ...c, indices, matchStr, score: fuzzyScore(indices, matchStr) };
    }).filter(c => c.indices).sort((a, b) => b.score - a.score);
  }

  if (results.length === 0) { dropdown.style.display = 'none'; return; }

  cwdDropdownIdx = -1;
  dropdown.innerHTML = results.map((c, i) => {
    const display = c.indices && c.indices.length
      ? highlightFuzzy(c.matchStr || c.short, c.indices)
      : escapeHtml(c.short);
    return `<div class="cwd-option" data-idx="${i}" data-path="${escapeHtml(c.short)}">${display}</div>`;
  }).join('');
  dropdown.style.display = 'block';

  // Click handler
  dropdown.querySelectorAll('.cwd-option').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const input = document.getElementById('newSessionCwd');
      input.value = el.dataset.path;
      localStorage.setItem('pi-dish-cwd', el.dataset.path);
      dropdown.style.display = 'none';
    });
  });
}

function hideCwdDropdown() {
  const dropdown = document.getElementById('cwdDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

// Wire up the cwd input
(function() {
  const saved = localStorage.getItem('pi-dish-cwd');
  const cwdInput = document.getElementById('newSessionCwd');
  if (!cwdInput) return;
  if (saved) cwdInput.value = saved;

  loadKnownCwds();

  cwdInput.addEventListener('focus', () => showCwdDropdown(cwdInput.value));
  cwdInput.addEventListener('input', () => showCwdDropdown(cwdInput.value));
  cwdInput.addEventListener('blur', () => setTimeout(hideCwdDropdown, 150));

  cwdInput.addEventListener('keydown', (e) => {
    const dropdown = document.getElementById('cwdDropdown');
    if (!dropdown || dropdown.style.display === 'none') {
      if (e.key === 'Enter') { e.preventDefault(); createSession(); }
      return;
    }
    const options = dropdown.querySelectorAll('.cwd-option');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cwdDropdownIdx = Math.min(cwdDropdownIdx + 1, options.length - 1);
      options.forEach((o, i) => o.classList.toggle('active', i === cwdDropdownIdx));
      if (options[cwdDropdownIdx]) options[cwdDropdownIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cwdDropdownIdx = Math.max(cwdDropdownIdx - 1, 0);
      options.forEach((o, i) => o.classList.toggle('active', i === cwdDropdownIdx));
      if (options[cwdDropdownIdx]) options[cwdDropdownIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cwdDropdownIdx >= 0 && options[cwdDropdownIdx]) {
        cwdInput.value = options[cwdDropdownIdx].dataset.path;
        localStorage.setItem('pi-dish-cwd', cwdInput.value);
        hideCwdDropdown();
      } else {
        hideCwdDropdown();
        createSession();
      }
    } else if (e.key === 'Escape') {
      hideCwdDropdown();
    }
  });
})();

// =========================================================================
// Utilities
// =========================================================================

/**
 * After JSONL-based render, remove tool call/result details that are already
 * covered by live tool panels (identified by data-tool-call-id).
 */
function removeDuplicatedLiveContent(container) {
  if (liveToolPanels.size === 0) return;
  for (const [toolCallId, entry] of liveToolPanels) {
    if (!entry.el || !container.contains(entry.el)) {
      // Live panel is no longer in the container (full re-render happened)
      liveToolPanels.delete(toolCallId);
      continue;
    }
    // Look for corresponding .tool-call or .tool-result in the JSONL-rendered output
    // We don't have a direct link, so we check by matching tool name + args in the existing rendering
  }
  // If we have any live panels still in the DOM, we keep them.
  // Clear the map after turn_end + reload completes — the JSONL render is now authoritative.
  // But live panels are already rendered correctly, so we just clear tracking.
  liveToolPanels.clear();
}

function updateOrAppendMessage(message) {
  const container = document.getElementById('messages');
  if (!container) return;
  const timestamp = message.timestamp || Date.now();
  const msgHtml = renderAssistantMessage({ ...message, timestamp }, formatTime(timestamp), { streaming: true });
  const streamingEl = container.querySelector('.message.assistant[data-streaming="true"]');
  if (streamingEl) {
    // Preserve open state of <details> elements so thinking blocks / tool calls
    // don't collapse on every streaming delta.
    const openKeys = new Set();
    streamingEl.querySelectorAll('details').forEach(el => {
      if (el.hasAttribute('open')) {
        const cls = el.className;
        const siblings = Array.from(streamingEl.querySelectorAll('details.' + cls.replace(/ /g, '.')));
        const idx = siblings.indexOf(el);
        openKeys.add(`${cls}:${idx}`);
      }
    });
    streamingEl.outerHTML = msgHtml;
    const newEl = container.querySelector('.message.assistant[data-streaming="true"]');
    if (newEl) {
      newEl.querySelectorAll('details').forEach(el => {
        const cls = el.className;
        const siblings = Array.from(newEl.querySelectorAll('details.' + cls.replace(/ /g, '.')));
        const idx = siblings.indexOf(el);
        if (openKeys.has(`${cls}:${idx}`)) el.setAttribute('open', '');
      });
    }
  } else {
    container.insertAdjacentHTML('beforeend', msgHtml);
  }
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
