// Session state — `sessions` (the sidebar lists) and `currentSession` (a
// detached copy of the selected entry) are only ever written by the state
// functions in the "Session state writes" section: setSessionLists /
// setCurrentSession / patchSession / mergeCurrentSession. Each one rebuilds
// the derived state and re-renders the views that show it, so a mutation
// can't leave the sidebar and header disagreeing (the old "rename needs F5"
// bug class). Read these freely; never assign to them anywhere else.
let sessions = { active: [], previous: [] };
let currentSession = null;
const RESPONSE_MODE_KEY = 'pi-dish-response-metadata';
const SESSION_SPEND_KEY = 'pi-dish-show-session-spend';
const RESPONSE_MODES = new Set(['hidden', 'compact', 'performance', 'performance-cost']);
let responseMetadataMode = RESPONSE_MODES.has(localStorage.getItem(RESPONSE_MODE_KEY)) ? localStorage.getItem(RESPONSE_MODE_KEY) : 'compact';
let showSessionSpend = localStorage.getItem(SESSION_SPEND_KEY) === '1';
let responseDetailSeq = 0;
const responseDetails = new Map();
let usageRange = '30', usageTimer = null, usageData = null, usageChart = null, usageSelectedDay = null;
let usageSort = localStorage.getItem('pi-dish-usage-sort') === 'tokens' ? 'tokens' : 'cost';
let usageModelFilter = new Set(); // multi-select model refs; empty = all models
let settingsRenderSeq = 0, usageFetchSeq = 0, spendFetchSeq = 0;

// Live tool panel tracking: toolCallId -> { el, startTime }
let liveToolPanels = new Map();

// Slash commands cache
let slashCommands = [];
let autocompleteVisible = false;
let autocompleteIndex = 0;

// =========================================================================
// Scroll pinning — only follow streaming output while the user is at the
// bottom. Scrolling up "unpins"; new content then accumulates below without
// yanking the viewport, and a jump-to-bottom button appears.
// =========================================================================

// Set when the user sends a prompt (or hits jump-to-bottom): follow the
// stream unconditionally, even if a mobile keyboard resize left the viewport
// short of the 80px pin threshold. Cleared by any deliberate scroll gesture.
let followStream = false;

/** Grow the prompt textarea with its content, capped at 160px. */
function autosizePromptInput(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function isPinnedToBottom(el) {
  if (followStream) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
  updateJumpButton(el);
}

function updateJumpButton(messagesEl) {
  let btn = document.getElementById('jumpToBottom');
  const pinned = isPinnedToBottom(messagesEl);
  if (pinned) { if (btn) btn.style.display = 'none'; return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'jumpToBottom';
    btn.className = 'jump-to-bottom';
    btn.textContent = '↓';
    btn.title = 'Jump to latest';
    btn.addEventListener('click', () => {
      followStream = true;
      scrollToBottom(document.getElementById('messages'));
    });
    const view = document.getElementById('sessionView') || document.body;
    view.appendChild(btn);
  }
  btn.style.display = '';
}

// Load slash commands — when a session is given, the server asks the live
// session so the list matches exactly what that session supports. The seq
// guard drops out-of-order responses: switching sessions quickly must not
// let the previous session's slower reply clobber the new session's list.
let commandsSeq = 0;
async function loadCommands(sessionId) {
  const seq = ++commandsSeq;
  try {
    const qs = sessionId ? ('?sessionId=' + encodeURIComponent(sessionId)) : '';
    const res = await fetch('/api/commands' + qs);
    const data = await res.json();
    if (seq !== commandsSeq) return; // superseded by a newer session's fetch
    if (Array.isArray(data)) slashCommands = data;
  } catch (e) {
    console.error('Failed to load commands:', e);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  loadConfig(); // feature flags (terminal) — fire-and-forget
  loadThemes(); // theme picker options + refresh custom-theme tokens
  loadSpawnTargets(); // populate the "Run in" tmux selector (hidden if no tmux)
  updateViewToggle();
  renderScopeChips(); // cached definitions paint immediately…
  loadSavedFilters(); // …then the server copy replaces them
  initTerminalKeybar();
  initTerminalResize();
  initCommentSelections();
  // Full fetch: restoring the saved session may need the historical list.
  await loadSessions(undefined, { withPrevious: true });
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
    // History recall: ArrowUp with the caret at the very start (or empty box)
    // steps back through sent prompts; ArrowDown at the end steps forward and
    // finally restores whatever was being typed.
    if (!autocompleteVisible && e.key === 'ArrowUp' &&
        promptInput.selectionStart === 0 && promptInput.selectionEnd === 0) {
      if (navigateHistory(-1, promptInput)) { e.preventDefault(); return; }
    }
    if (!autocompleteVisible && e.key === 'ArrowDown' && historyIndex !== -1 &&
        promptInput.selectionStart === promptInput.value.length) {
      if (navigateHistory(1, promptInput)) { e.preventDefault(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.ctrlKey) { e.preventDefault(); sendSteer(); }
      else { e.preventDefault(); sendPrompt(); }
    }
    if (e.key === 'Escape' && !autocompleteVisible && turnInProgress) { e.preventDefault(); abortTurn(); }
  });

  // Global Ctrl+C to abort
  document.addEventListener('keydown', function(e) {
    // Keys typed into the terminal belong to the shell (Ctrl+C = SIGINT,
    // Ctrl+F = forward), not to the app-level shortcuts.
    if (e.target.closest && e.target.closest('.terminal-panel')) return;
    if (e.ctrlKey && e.key === 'c' && turnInProgress) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { e.preventDefault(); abortTurn(); }
    }
    // Ctrl+F opens in-session search when a session is showing
    if (e.ctrlKey && e.key === 'f' && currentSession) {
      e.preventDefault();
      openSearch();
    }
  });

  promptInput.addEventListener('input', () => {
    autosizePromptInput(promptInput);
    handleAutocomplete(promptInput.value);
    historyIndex = -1; // typing exits history browsing
    saveDraftSoon();
  });

  // Pasted screenshots become attachments instead of getting dropped.
  promptInput.addEventListener('paste', (e) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.type && it.type.startsWith('image/'))
      .map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    addImageFiles(files);
  });

  document.getElementById('imageFileInput').addEventListener('change', (e) => {
    addImageFiles(e.target.files);
    e.target.value = ''; // allow re-picking the same file
  });

  // Tap any transcript image to view it full-size.
  document.addEventListener('click', (e) => {
    const img = e.target.closest('img.msg-image');
    if (img) openImageLightbox(img.src);
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.message-metadata-btn');
    if (btn) openResponseDetails(btn.dataset.detailId);
  });

  // Tap a linkified file mention to open it in the viewer. preventDefault
  // keeps a link inside a <summary> (tool-call headers) from toggling the
  // enclosing <details>.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.file-link');
    if (!link || !currentSession) return;
    e.preventDefault();
    openFileViewer(link.textContent.trim());
  });

  // Per-message share link (the hover 🔗 in turn headers).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.msg-link-btn');
    if (btn) copyMessageShareLink(btn);
  });
  
  // Periodic refresh must preserve an in-flight server search, or the list
  // resets to unfiltered mid-search.
  setInterval(refreshSessions, 10000);

  // Session items render without inline handlers; one delegated listener
  // selects and (on mobile) closes the drawer.
  document.getElementById('sessionList').addEventListener('click', (e) => {
    const pinBtn = e.target.closest('.session-pin-btn');
    if (pinBtn) { toggleSessionPinned(pinBtn.closest('.session-item').dataset.id); return; }
    // A finished drag still emits a click on the handle — never treat it as a select.
    if (e.target.closest('.session-drag-handle')) return;
    // The header's + spawns a session at the node's path — not a collapse toggle.
    const newBtn = e.target.closest('.workspace-new-btn');
    if (newBtn) { createSession(newBtn.dataset.path); return; }
    const header = e.target.closest('.workspace-group-header');
    if (header) { if (header.dataset.cwd) toggleGroupCollapsed(header.dataset.cwd); return; }
    const item = e.target.closest('.session-item');
    if (!item) return;
    selectSession(item.dataset.id);
    if (window.innerWidth <= 768) closeSidebar();
  });

  initPinnedDrag();

  document.getElementById('scopeChips').addEventListener('click', (e) => {
    if (e.target.closest('.scope-add')) { saveCurrentFilterAsScope(); return; }
    if (e.target.closest('.search-open-chip')) { openSearchView(filterQuery); return; }
    const chip = e.target.closest('.scope-chip');
    if (chip) toggleScope(chip.dataset.name);
  });

  const searchViewInput = document.getElementById('searchViewInput');
  searchViewInput.addEventListener('input', () => onSearchViewInput());
  searchViewInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearchViewInput({ immediate: true }); });
  document.getElementById('searchViewBody').addEventListener('click', (e) => {
    const card = e.target.closest('.search-result');
    if (card) openSearchResult(card.dataset.id);
  });

  promptInput.addEventListener('blur', () => { setTimeout(hideAutocomplete, 200); });

  const messagesEl = document.getElementById('messages');
  if (messagesEl) {
    messagesEl.addEventListener('scroll', () => {
      updateJumpButton(messagesEl);
      maybeLoadOlderMessages(messagesEl);
    }, { passive: true });
    // Any deliberate gesture in the feed cancels forced follow. Harmless when
    // already at the bottom — normal proximity pinning takes over seamlessly.
    const cancelFollow = () => { followStream = false; };
    messagesEl.addEventListener('wheel', (e) => {
      cancelFollow();
      if (e.deltaY < 0) maybeLoadOlderMessages(messagesEl);
    }, { passive: true });
    messagesEl.addEventListener('touchmove', () => {
      cancelFollow();
      maybeLoadOlderMessages(messagesEl);
    }, { passive: true });
    messagesEl.addEventListener('mousedown', cancelFollow, { passive: true });
    // Copy a fenced code block's text (delegated — messages re-render often).
    messagesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.code-copy-btn');
      if (!btn) return;
      const code = btn.parentElement.querySelector('pre code');
      copyTextToClipboard(code ? code.textContent : '').then(
        () => { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '⧉'; }, 1200); },
        () => setStatus('Copy failed (clipboard blocked)', 'error'),
      );
    });
  }

  // Restore focus mode (hide tool calls/results) preference
  setFocusMode(localStorage.getItem('pi-dish-focus') === '1');

  // Coming back to the tab: refresh the list so unread dots resolve against
  // what's now actually on screen.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshSessions();
  });
});

// =========================================================================
// Autocomplete — slash commands at the start of the input, @file mentions
// anywhere (fuzzy file search under the session cwd via fff; @/abs, @~/ and
// @../ tokens get shell-style path completion anywhere on the filesystem).
// =========================================================================

function handleAutocomplete(text) {
  // @token ending at the caret → file mention
  const input = document.getElementById('promptInput');
  const caret = input.selectionStart ?? text.length;
  const at = text.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
  if (at && currentSession) { queueFileAutocomplete(at[1]); return; }

  if (!text.startsWith('/')) { hideAutocomplete(); return; }
  var spaceIdx = text.indexOf(' ');
  var query = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
  if (spaceIdx > 0) { hideAutocomplete(); return; }
  var matches = slashCommands.filter(cmd => cmd.name.toLowerCase().startsWith(query.toLowerCase()));
  if (matches.length === 0 || (matches.length === 1 && matches[0].name === query)) { hideAutocomplete(); return; }
  showAutocomplete(matches);
}

// --- @file mentions ---
const fileAcFetcher = debouncedFetcher(120,
  async (token) => {
    const res = await fetch(`/api/sessions/${currentSession.id}/files?q=${encodeURIComponent(token)}`);
    const data = await res.json();
    return res.ok ? data.files : null;
  },
  (files) => { files?.length ? showFileAutocomplete(files) : hideAutocomplete(); });

function queueFileAutocomplete(token) { fileAcFetcher.fire(token); }

const GIT_STATUS_LABEL = { modified: '± modified', untracked: '+ new', staged: '● staged' };

function showFileAutocomplete(files) {
  showAutocompleteList(files.map((f, i) =>
    `<div class="autocomplete-item${i === 0 ? ' active' : ''}" data-file="${escapeHtml(f.path)}"${f.isDir ? ' data-dir="1"' : ''}>
      <span class="autocomplete-icon">${f.isDir ? '📁' : '📄'}</span>
      <span class="autocomplete-name">${escapeHtml(f.path)}${f.isDir ? '/' : ''}</span>
      <span class="autocomplete-desc">${GIT_STATUS_LABEL[f.gitStatus] || ''}</span>
    </div>`).join(''));
}

// Replace the @token at the caret with the chosen path. Files close the
// mention with a trailing space; directories append a '/' and re-fire the
// input event so the completion drills one level deeper.
function acceptFileMention(relPath, isDir) {
  const input = document.getElementById('promptInput');
  const caret = input.selectionStart ?? input.value.length;
  const m = input.value.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
  hideAutocomplete();
  if (!m) return;
  const start = caret - m[1].length - 1; // include the '@'
  const insert = relPath + (isDir ? '/' : ' ');
  input.value = input.value.slice(0, start) + '@' + insert + input.value.slice(caret);
  const pos = start + 1 + insert.length;
  input.focus();
  input.setSelectionRange(pos, pos);
  if (isDir) input.dispatchEvent(new Event('input'));
}

function ensureAutocompleteContainer() {
  var container = document.getElementById('autocomplete');
  if (!container) {
    container = document.createElement('div');
    container.id = 'autocomplete';
    container.className = 'autocomplete-dropdown';
    document.querySelector('.input-area').appendChild(container);
  }
  return container;
}

function showAutocomplete(matches) {
  showAutocompleteList(matches.map((cmd, i) => {
    var icon = cmd.source === 'builtin' ? '⚙️' : cmd.source === 'extension' ? '🧩' : cmd.source === 'skill' ? '📚' : '📝';
    var active = i === 0 ? ' active' : '';
    var args = cmd.args ? ' <span class="autocomplete-args">' + escapeHtml(cmd.args) + '</span>' : '';
    return '<div class="autocomplete-item' + active + '" data-name="' + escapeHtml(cmd.name) + '">'
      + '<span class="autocomplete-icon">' + icon + '</span>'
      + '<span class="autocomplete-name">/' + escapeHtml(cmd.name) + args + '</span>'
      + '<span class="autocomplete-desc">' + escapeHtml(cmd.description) + '</span></div>';
  }).join(''));
}

// Shared tail of both composer autocompletes (slash commands, @files): fill
// the container, bind clicks through the one accept path, show it.
function showAutocompleteList(html) {
  const container = ensureAutocompleteContainer();
  autocompleteIndex = 0;
  autocompleteVisible = true;
  container.innerHTML = html;
  container.querySelectorAll('.autocomplete-item').forEach(el => {
    el.onclick = () => acceptAutocomplete(el);
  });
  container.style.display = 'block';
}

function hideAutocomplete() {
  autocompleteVisible = false;
  fileAcFetcher.cancel(); // invalidate any in-flight file search
  var c = document.getElementById('autocomplete');
  if (c) c.style.display = 'none';
}

function moveAutocomplete(delta) {
  var items = document.querySelectorAll('.autocomplete-item');
  autocompleteIndex = moveActiveItem(items, autocompleteIndex, delta, { wrap: true });
}

function acceptAutocomplete(el) {
  const file = el.getAttribute('data-file');
  if (file != null) acceptFileMention(file, el.hasAttribute('data-dir'));
  else acceptAutocompleteByName(el.getAttribute('data-name'));
}

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

let sidebarTab = 'active'; // 'active' (only live sessions, default) or 'all' (live + historical)
let filterQuery = '';
let filterDebounceTimer = null;

// --- sidebar view: group by workspace (tree) or by date (Recent) ---
let sidebarView = localStorage.getItem('pi-dish-sidebar-view') === 'recent' ? 'recent' : 'workspace';

function toggleSidebarView() {
  sidebarView = sidebarView === 'recent' ? 'workspace' : 'recent';
  localStorage.setItem('pi-dish-sidebar-view', sidebarView);
  updateViewToggle();
  renderSessions();
}

function updateViewToggle() {
  const btn = document.getElementById('viewToggle');
  if (!btn) return;
  // The icon shows the *current* grouping; the title says what a click does.
  btn.innerHTML = sidebarView === 'recent'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
  btn.title = sidebarView === 'recent' ? 'Grouped by date — switch to workspaces' : 'Grouped by workspace — switch to recent';
}

// --- saved filters ("scopes"): server-global definitions, device-local
// active set. An active scope stays applied — AND-combined with whatever is
// typed — until its chip is toggled off, so "no subagents" is set once, not
// retyped. Definitions are cached locally only so chips paint before the
// settings fetch lands; the server copy wins on every load.
let savedFilters = readJSONPref('pi-dish-saved-filters-cache', []);
let activeScopes = new Set(readJSONPref('pi-dish-active-scopes', []));

async function loadSavedFilters() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    savedFilters = Array.isArray(data.savedFilters) ? data.savedFilters : [];
    localStorage.setItem('pi-dish-saved-filters-cache', JSON.stringify(savedFilters));
    renderScopeChips();
    renderSessions();
  } catch (e) { console.error('Failed to load saved filters:', e); }
}

async function persistSavedFilters(next) {
  const res = await fetch('/api/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ savedFilters: next }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'save failed');
  savedFilters = data.savedFilters;
  localStorage.setItem('pi-dish-saved-filters-cache', JSON.stringify(savedFilters));
  renderScopeChips();
  renderSessions();
}

/** The combined query of every active scope ('' when none apply). */
function scopeQuery() {
  return savedFilters.filter(f => activeScopes.has(f.name)).map(f => f.query).join(' ');
}

function toggleScope(name) {
  if (activeScopes.has(name)) activeScopes.delete(name);
  else activeScopes.add(name);
  localStorage.setItem('pi-dish-active-scopes', JSON.stringify([...activeScopes]));
  renderScopeChips();
  renderSessions();
}

async function saveCurrentFilterAsScope() {
  const query = filterQuery.trim();
  if (!query) return;
  const name = window.prompt('Name this filter:', '');
  if (!name || !name.trim()) return;
  const trimmed = name.trim().slice(0, 60);
  const next = savedFilters.filter(f => f.name !== trimmed).concat([{ name: trimmed, query }]);
  try {
    // The new scope starts active and replaces the typed query — it now
    // carries the filter, so leaving the text too would double-apply it.
    activeScopes.add(trimmed);
    localStorage.setItem('pi-dish-active-scopes', JSON.stringify([...activeScopes]));
    document.getElementById('filterInput').value = '';
    filterQuery = '';
    await persistSavedFilters(next);
    if (sidebarTab === 'all') loadSessions();
  } catch (e) { alert('Could not save filter: ' + e.message); }
}

function renderScopeChips() {
  const el = document.getElementById('scopeChips');
  if (!el) return;
  const chips = savedFilters.map(f => `
    <button class="scope-chip${activeScopes.has(f.name) ? ' active' : ''}"
      data-name="${escapeHtml(f.name)}" title="${escapeHtml(f.query)}">${escapeHtml(f.name)}</button>`);
  if (filterQuery.trim()) {
    chips.push('<button class="scope-chip scope-add" title="Save the current query as a reusable filter">+ save filter</button>');
    chips.push('<button class="scope-chip search-open-chip" title="Open this query in the full search view">⤢ full search</button>');
  }
  el.innerHTML = chips.join('');
  el.style.display = chips.length ? '' : 'none';
}

// --- seen tracking: which sessions have new activity since last viewed ---
let seenActivity = {};
seenActivity = readJSONPref('pi-dish-seen', {});

function markSessionSeen(id, lastActivity) {
  if (!id || !lastActivity) return;
  seenActivity[id] = lastActivity;
  localStorage.setItem('pi-dish-seen', JSON.stringify(seenActivity));
}

function isUnread(session) {
  return isUnreadSession(session, seenActivity, currentSession?.id, !document.hidden);
}

// Unread count in the tab title — the "agent came back" signal when the
// tab is in the background.
function updateUnreadTitle() {
  const unread = sessions.active.filter(isUnread).length;
  document.title = unread ? `(${unread}) pi-dish` : 'pi-dish';
}

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
  document.getElementById('tabAll').classList.toggle('active', tab === 'all');
  document.getElementById('filterInput').placeholder = tab === 'active' ? 'Filter active sessions...' : 'Search all sessions...';
  renderSessions();
  // Re-run any pending query under the new tab's semantics: server-side in
  // All, full list otherwise (a server search may have narrowed `sessions`).
  loadSessions(tab === 'all' && filterQuery ? filterQuery : undefined);
}

function onFilterInput() {
  clearTimeout(filterDebounceTimer);
  const q = document.getElementById('filterInput').value.trim();
  // Local filter is instant; server search is debounced
  filterQuery = q;
  renderScopeChips(); // the "+ save filter" chip tracks whether a query is typed
  if (sidebarTab === 'all') {
    if (q.length > 0) {
      // Busy from the first keystroke — the debounce window is part of the
      // latency the user sees, and a search box that shows nothing for
      // 300ms+ reads as "not filtering".
      setSearchBusy(true);
      filterDebounceTimer = setTimeout(() => loadSessions(q), 300);
    } else {
      // Query cleared: reload the full browse list from server
      loadSessions();
    }
  } else {
    renderSessions();
  }
}

function setSearchBusy(busy) {
  document.querySelector('.sidebar-filter')?.classList.toggle('searching', busy);
}

// On the Active tab the historical list is invisible, so polls request
// active sessions only (?active=1 — the server then skips its full
// session-tree scan) and keep the previously fetched `previous` list.
// `withPrevious: true` forces a full fetch regardless of tab (initial load,
// which may need to restore a historical session).
let loadSessionsSeq = 0; // drops out-of-order responses (cf. modelsSeq)
let sessionIndexing = false; // server is still backfilling its session index
let indexingRefreshTimer = null;

async function loadSessions(query, { withPrevious = sidebarTab === 'all' } = {}) {
  const seq = ++loadSessionsSeq;
  try {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (!withPrevious) params.set('active', '1');
    const qs = params.toString();
    const res = await fetch('/api/sessions' + (qs ? '?' + qs : ''));
    const data = await res.json();
    // A slower earlier request must not clobber a newer one's results (a
    // cold search can land after the warm search that superseded it).
    if (seq !== loadSessionsSeq) return;
    if (withPrevious) {
      sessionIndexing = !!data.indexing;
      // While the index backfills the list is partial — re-poll quickly
      // until it settles instead of leaving the user a sparse list for the
      // next 10s poll to fix.
      if (sessionIndexing && !indexingRefreshTimer) {
        indexingRefreshTimer = setTimeout(() => {
          indexingRefreshTimer = null;
          refreshSessions();
        }, 1000);
      }
    }
    const next = {
      active: data.active || [],
      previous: withPrevious ? (data.previous || []) : sessions.previous,
    };
    // Viewing a session (with the tab visible) counts as having seen its
    // latest activity — bookkeep against the fresh data *before*
    // setSessionLists renders the unread dots. Prune stale ids too, but
    // only from an unfiltered load: a search result is not the full list.
    if (currentSession && !document.hidden) {
      const fresh = next.active.find(s => s.id === currentSession.id)
        || next.previous.find(s => s.id === currentSession.id);
      if (fresh) markSessionSeen(fresh.id, fresh.lastActivity);
    }
    if (!query) {
      for (const id of Object.keys(seenActivity)) {
        if (!next.active.some(s => s.id === id)) delete seenActivity[id];
      }
    }
    setSessionLists(next);
  } catch (e) {
    console.error('Failed to load sessions:', e);
  } finally {
    if (seq === loadSessionsSeq) setSearchBusy(false);
  }
}

// Refresh the list, preserving an in-flight server-side search (All tab) so
// a background poll — or the sidebar refresh button — doesn't reset it.
function refreshSessions() { return loadSessions(sidebarTab === 'all' && filterQuery ? filterQuery : undefined); }

function renderSessionItem(session, opts = {}) {
  const ctxClass = contextClass(session.contextPercent);
  const activeClass = currentSession?.id === session.id ? 'active' : '';
  const inactiveClass = session.isActive ? '' : 'inactive';
  // One dot, best signal wins: working (pulsing) > unread (accent) > live-in-All.
  // Compacting shares the working dot (it's the same "busy" pulse) but names
  // the state, since sends are held while it runs.
  let liveDot = '';
  if (session.compacting) liveDot = '<span class="session-item-status working" title="Compacting context"></span>';
  else if (session.turnInProgress) liveDot = '<span class="session-item-status working" title="Agent working"></span>';
  else if (isUnread(session)) liveDot = '<span class="session-item-status unread" title="New activity since you last looked"></span>';
  else if (sidebarTab === 'all' && session.isActive) liveDot = '<span class="live-dot" title="Active session"></span>';
  const displayName = session.name || 'Unnamed';
  const tokenDisplay = session.contextTokens ? `${formatTokens(session.contextTokens)} tok` : '';
  const timeAgo = formatRelativeTime(session.lastActivity);
  const isPinned = pinnedSessions.includes(session.id);
  const pinBtn = `<button class="session-pin-btn${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Unpin' : 'Pin to top'}">📌</button>`;
  // Rows in the pinned section get a drag handle (reorder); pinned and
  // Recent-view rows get a cwd hint — they've left their workspace group,
  // so the group label isn't there.
  const dragHandle = opts.pinnedRow ? '<span class="session-drag-handle" title="Drag to reorder">⠿</span>' : '';
  const cwdHint = (opts.pinnedRow || opts.showCwd) ? `<span class="session-item-cwd">${escapeHtml(shortCwd(session.cwd || '~'))}</span>` : '';
  // Server search attaches a snippet when a session matched on message
  // content the row's metadata doesn't show — render it so the match
  // doesn't look arbitrary. Only positive plain terms can cause a content
  // match, so only they get marked.
  const snippetLine = session.searchSnippet
    ? `<div class="session-item-snippet">${highlightTokens(session.searchSnippet,
        positiveQueryTokens(parseSessionQuery(filterQuery)))}</div>`
    : '';

  return `
    <div class="session-item ${activeClass} ${inactiveClass}" data-id="${escapeHtml(session.id)}">
      <div class="session-item-header">
        ${dragHandle}${liveDot}<span class="session-item-name" title="${escapeHtml(session.id)}">${escapeHtml(displayName)}</span>
        <span class="session-item-time">${timeAgo}</span>
        ${pinBtn}
      </div>
      <div class="session-item-meta">
        ${cwdHint}
        <span class="session-item-model">${escapeHtml(session.model)}</span>
        <span class="session-item-context ${ctxClass}">${session.contextPercent}%</span>
        ${tokenDisplay ? `<span class="session-item-tokens">${tokenDisplay}</span>` : ''}
        <span>${session.messageCount} msgs</span>
      </div>
      ${snippetLine}
    </div>
  `;
}

// Collapsed workspace groups (by cwd) — collapsed groups hide their sessions
// and sink to the bottom of the list. Persisted across reloads.
const collapsedGroups = new Set(readJSONPref('pi-dish-collapsed-groups', []));

function toggleGroupCollapsed(cwd) {
  if (collapsedGroups.has(cwd)) collapsedGroups.delete(cwd);
  else collapsedGroups.add(cwd);
  localStorage.setItem('pi-dish-collapsed-groups', JSON.stringify([...collapsedGroups]));
  renderSessions();
}

// Pinned sessions live in a section at the top of the sidebar; the array
// order is the display order (drag handles rearrange it). Persisted.
let pinnedSessions = readJSONPref('pi-dish-pinned-sessions', []);
// Set while a pinned row is being dragged — renderSessions must not rebuild
// the list out from under the drag (the 10s poll would otherwise do so).
let pinnedDragActive = false;

function savePinnedSessions() {
  localStorage.setItem('pi-dish-pinned-sessions', JSON.stringify(pinnedSessions));
}

function toggleSessionPinned(id) {
  const idx = pinnedSessions.indexOf(id);
  if (idx >= 0) pinnedSessions.splice(idx, 1);
  else pinnedSessions.push(id);
  savePinnedSessions();
  renderSessions();
}

/**
 * Drag-to-reorder for the pinned section. Pointer events (not HTML5 DnD) so
 * it works on touch too; the handle has touch-action:none, so grabbing it
 * doesn't fight the list's scroll. The dragged row is moved live in the DOM;
 * the drop reads the resulting order back into pinnedSessions.
 */
function initPinnedDrag() {
  document.getElementById('sessionList').addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.session-drag-handle');
    if (!handle) return;
    const item = handle.closest('.session-item');
    const segment = item.parentElement;
    e.preventDefault();
    pinnedDragActive = true;
    item.classList.add('dragging');

    // Listeners go on document, not the handle: reordering detaches and
    // reinserts the row, which silently releases pointer capture on it.
    const onMove = (ev) => {
      const siblings = [...segment.querySelectorAll('.session-item:not(.dragging)')];
      const next = siblings.find(sib => {
        const r = sib.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (next) segment.insertBefore(item, next);
      else segment.appendChild(item);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      item.classList.remove('dragging');
      pinnedDragActive = false;
      pinnedSessions = [...segment.querySelectorAll('.session-item')].map(el => el.dataset.id);
      savePinnedSessions();
      renderSessions();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}

let lastSessionListHtml = '';

function renderSessions() {
  if (pinnedDragActive) return; // don't rebuild mid-drag; the drop re-renders
  const list = document.getElementById('sessionList');
  const { active, previous } = sessions;
  const showing = sidebarTab === 'active' ? active : [...active, ...previous];

  const countEl = document.getElementById('countActive');
  if (countEl) countEl.textContent = active.length || '';

  // In All mode with a query, the server already filtered (including message
  // content) — don't re-filter locally.
  const queried = (sidebarTab === 'all' && filterQuery) ? showing : applyLocalFilter(showing, filterQuery);
  // Active scopes apply client-side on top of whatever the query kept —
  // metadata/date-only by design, so they behave identically on both tabs.
  const sq = scopeQuery();
  const scopeParsed = sq ? parseSessionQuery(sq) : null;
  const filtered = scopeParsed ? queried.filter(s => evaluateSessionQuery(scopeParsed, s)) : queried;
  const scopesHidden = queried.length - filtered.length;

  let html = '';
  // First boot over a big corpus: the server is still indexing and the list
  // below is partial — say so (loadSessions re-polls until it settles).
  if (sidebarTab === 'all' && sessionIndexing) {
    html += '<div class="indexing-note">Indexing sessions…</div>';
  }
  if (filtered.length === 0) {
    const msg = sidebarTab === 'active'
      ? (active.length === 0 ? 'No active sessions<br><span style="font-size:11px">Click "+ New Session" or resume one from All</span>' : 'No matches')
      : (showing.length === 0 ? 'No sessions found' : 'No matches');
    html += `<div class="empty-session"><p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">${msg}</p></div>`;
  } else {
    const [pinned, rest] = partitionPinned(filtered, pinnedSessions);
    if (pinned.length > 0) {
      html += `<div class="session-segment pinned-segment">
        <div class="workspace-group-header pinned-header">
          <span class="workspace-group-label">📌 Pinned</span>
          <span class="workspace-group-count">${pinned.length}</span>
        </div>
        ${pinned.map(s => renderSessionItem(s, { pinnedRow: true })).join('')}
      </div>`;
    }
    if (sidebarView === 'recent') {
      html += groupSessionsByDate(rest).map(renderDateBucket).join('');
    } else {
      const tree = buildWorkspaceTree(groupByWorkspace(rest, collapsedGroups), collapsedGroups);
      html += tree.map(renderWorkspaceNode).join('');
    }
  }
  // Sessions a forgotten chip silently removed must stay discoverable — the
  // note is the audit trail for "why isn't my session in the list?".
  if (scopesHidden > 0) {
    html += `<div class="scope-hidden-note">${scopesHidden} hidden by scopes</div>`;
  }

  // The 10s poll usually changes nothing — skip the DOM churn (and touch/hover
  // state loss) when the rendered HTML would be identical.
  if (html !== lastSessionListHtml) {
    list.innerHTML = html;
    lastSessionListHtml = html;
  }
  updateUnreadTitle();
}

/**
 * One workspace-tree node → a .session-segment: header (collapse toggle via
 * data-cwd, the node's path prefix), child nodes nested in an indented
 * .workspace-children, then this node's own sessions — folders before loose
 * sessions, file-manager style. Collapsing a node hides its whole subtree,
 * so the header must not hide activity: surface the best signal
 * (working > unread) from all descendant sessions as a header dot.
 */
function renderWorkspaceNode(node) {
  const isCollapsed = collapsedGroups.has(node.path);
  let headerDot = '';
  if (isCollapsed) {
    const all = collectTreeSessions(node);
    if (all.some(s => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
    else if (all.some(isUnread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
  }
  let body = '';
  if (!isCollapsed) {
    if (node.children.length) {
      body = `<div class="workspace-children">${node.children.map(renderWorkspaceNode).join('')}</div>`;
    }
    body += (node.sessions || []).map(s => renderSessionItem(s)).join('');
  }
  return `<div class="session-segment${isCollapsed ? ' collapsed' : ''}">
    <div class="workspace-group-header" data-cwd="${escapeHtml(node.path)}">
      <span class="workspace-group-chevron">${isCollapsed ? '▸' : '▾'}</span>
      <span class="workspace-group-label" title="${escapeHtml(node.path)}">${escapeHtml(node.label)}</span>
      ${headerDot}<span class="workspace-group-count">${node.count}</span>
      <button class="workspace-new-btn" data-path="${escapeHtml(node.path)}" title="New session in ${escapeHtml(node.path)}">+</button>
    </div>
    ${body}
  </div>`;
}

/**
 * One Recent-view date bucket → a .session-segment sharing the workspace
 * header chrome (same collapse delegation via data-cwd, keyed 'date:<key>' so
 * the two views' collapse states can't collide). Unlike workspace groups,
 * collapsed buckets stay in chronological place — sinking "Today" below
 * "May" would break the timeline. Rows carry the cwd hint: the workspace
 * label isn't above them in this view.
 */
function renderDateBucket(bucket) {
  const key = 'date:' + bucket.key;
  const isCollapsed = collapsedGroups.has(key);
  let headerDot = '';
  if (isCollapsed) {
    if (bucket.sessions.some(s => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
    else if (bucket.sessions.some(isUnread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
  }
  const body = isCollapsed ? '' : bucket.sessions.map(s => renderSessionItem(s, { showCwd: true })).join('');
  return `<div class="session-segment${isCollapsed ? ' collapsed' : ''}">
    <div class="workspace-group-header" data-cwd="${escapeHtml(key)}">
      <span class="workspace-group-chevron">${isCollapsed ? '▸' : '▾'}</span>
      <span class="workspace-group-label">${escapeHtml(bucket.label)}</span>
      ${headerDot}<span class="workspace-group-count">${bucket.sessions.length}</span>
    </div>
    ${body}
  </div>`;
}

function findSession(id) {
  return sessions.active.find(s => s.id === id) || sessions.previous.find(s => s.id === id);
}

// =========================================================================
// Session state writes — the ONLY functions that assign to `sessions` or
// `currentSession` (see the declaration comment at the top of the file).
// Every write re-renders the affected views itself, so callers can't forget.
// =========================================================================

/**
 * Replace the sidebar lists (poll / search result / explicit refresh) and
 * fold the fresh entry into `currentSession` so the header stays honest too
 * — polling used to update only the sidebar, leaving the header stale.
 */
function setSessionLists(next) {
  sessions = next;
  if (currentSession) {
    const fresh = findSession(currentSession.id);
    if (fresh) currentSession = { ...currentSession, ...fresh };
  }
  renderSessions();
  updateSessionHeader();
}

/**
 * Point `currentSession` at a list entry — always a detached copy, so later
 * list replacements can't mutate it behind the views' back. Returns it
 * (null when the id isn't in either list). Rendering is the caller's job:
 * selectSession re-renders everything it touches anyway.
 */
function setCurrentSession(id) {
  const entry = findSession(id);
  currentSession = entry ? { ...entry } : null;
  return currentSession;
}

/**
 * Patch a session everywhere it lives: both lists and (when selected) the
 * detached `currentSession` copy, then re-render sidebar + header. This is
 * the write path for local mutations — rename, model switch, thinking level.
 */
function patchSession(id, patch) {
  for (const list of [sessions.active, sessions.previous]) {
    const s = list.find(s => s.id === id);
    if (s) Object.assign(s, patch);
  }
  if (currentSession?.id === id) Object.assign(currentSession, patch);
  renderSessions();
  if (currentSession?.id === id) updateSessionHeader();
}

/**
 * Merge fresher metadata for the *current* session only (the `session`
 * payload riding on /messages responses) and re-render the header.
 * Deliberately does not touch the list entries: their name/model come from
 * the registry-aware poll, which can be more current than JSONL-derived
 * fields — the sidebar keeps its own source of truth.
 */
function mergeCurrentSession(id, fields) {
  if (!fields || currentSession?.id !== id) return;
  Object.assign(currentSession, fields);
  updateSessionHeader();
}

// =========================================================================
// Session Selection
// =========================================================================

async function selectSession(id, { forceTranscriptReload = false } = {}) {
  // Validate the target before tearing anything down: a stale id (a resume
  // racing a filtered refresh, a pruned session) must leave the current view
  // intact instead of stashing the transcript and then bailing on a blank pane.
  if (!findSession(id)) return;
  // Search marks are transient UI, but the pages search loaded are not. Clear
  // the marks before moving the current transcript into its short-lived DOM
  // cache so revisiting restores clean, already-finalized message nodes.
  cancelStreamingRender();
  closeSearch();
  // The diff and file views show the previous session's workspace — close them
  // before stashing: their takeover CSS display:nones #messages, whose
  // scrollTop reads 0 while hidden and would be cached as the reader's spot.
  closeDiffView();
  closeFileView();
  closeUsageView(); // picking a session while the usage takeover is up means "show me that session"
  closeSearchView();
  stashCurrentTranscript();
  if (forceTranscriptReload) transcriptCache.delete(id);
  if (!setCurrentSession(id)) return;
  // Tear down the previous session's stream up front, before the awaits below.
  // Left open, its in-flight turn_end/message_update events fire against the
  // session we're switching to (loadMessages has already reset the cursors).
  if (streamReconnectTimeout) { clearTimeout(streamReconnectTimeout); streamReconnectTimeout = null; }
  if (messageStream) { messageStream.close(); messageStream = null; }
  followStream = false; // forced follow doesn't carry across sessions
  // The terminal panel is per-session (its PTY keeps running server-side;
  // reopening reattaches with scrollback).
  closeTerminal();
  // Extension widgets/statuses/dialogs are per-session; the new session's
  // remembered set is replayed by the server when its stream connects.
  clearExtensionUI();
  localStorage.setItem('pi-dish-session', id);
  markSessionSeen(id, currentSession.lastActivity);
  
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('sessionView').style.display = 'flex';
  
  // Show/hide input area vs resume bar based on active state
  const inputArea = document.querySelector('.input-area');
  const resumeBar = document.getElementById('resumeBar');
  const sessionActions = document.querySelector('.session-actions');
  
  closeControlPanel();

  if (currentSession.isActive) {
    if (inputArea) inputArea.style.display = '';
    if (resumeBar) resumeBar.style.display = 'none';
    restorePromptState();
  } else {
    if (inputArea) inputArea.style.display = 'none';
    if (resumeBar) {
      resumeBar.style.display = '';
      const cwdSpan = resumeBar.querySelector('.resume-cwd');
      if (cwdSpan) cwdSpan.textContent = currentSession.cwd || '~';
    }
  }
  if (sessionActions) sessionActions.style.display = currentSession.isActive ? '' : 'none';

  // Working state and queue strip are per-session — seed from the list data
  // instead of leaking the previous session's state until the init event.
  renderQueueStatus(null);
  pendingSelfEcho = null;
  setCompacting(currentSession.isActive && !!currentSession.compacting);
  setTurnInProgress(currentSession.isActive && !!currentSession.turnInProgress);

  // Artifacts are per-session; clear the previous session's badge before the
  // fetch lands so a stale count never shows against the new session.
  sessionArtifacts = { pages: [], share: null };
  updateArtifactsBadge();
  refreshArtifacts(id);
  refreshSessionSpend();

  renderSessions();
  updateSessionHeader();
  if (currentSession.isActive) {
    // Fire-and-forget: nothing below needs the results, and both can ask the
    // live session over its socket — don't stall the transcript on them.
    loadModels(id);
    loadCommands(id); // refresh autocomplete with this session's commands
  }
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
  const target = savedResumeTarget();
  setStatus(target ? 'Resuming in tmux…' : 'Resuming session...', 'working');

  try {
    const data = await apiSend(`/api/sessions/${currentSession.id}/resume`, target ? { target } : undefined);
    setStatus('Session resumed');
    // Reload sessions and re-select (it's now active); refreshSessions
    // keeps an in-flight All-tab search intact.
    await refreshSessions();
    selectSession(data.id);
  } catch (e) {
    setStatus('Resume failed: ' + e.message, 'error');
  }
}

// =========================================================================
// Models
// =========================================================================

let knownModels = [];
let modelsSeq = 0; // drops out-of-order responses on fast session switches

async function loadModels(sessionId) {
  const seq = ++modelsSeq;
  try {
    const qs = sessionId ? ('?sessionId=' + encodeURIComponent(sessionId)) : '';
    const res = await fetch('/api/models' + qs);
    const data = await res.json();
    if (seq !== modelsSeq) return; // superseded by a newer session's fetch
    knownModels = Array.isArray(data) ? data : [];
    refreshResponsePricingState();
  } catch (e) {
    console.error('Failed to load models:', e);
    if (seq === modelsSeq) knownModels = [];
  }
}

function filterModels(query) {
  if (!Array.isArray(knownModels)) return [];
  if (!query) return knownModels;
  const q = query.toLowerCase();
  return knownModels.filter(m => m &&
    [m.id, m.provider, m.name].some(f => typeof f === 'string' && f.toLowerCase().includes(q)));
}

// =========================================================================
// Session Header
// =========================================================================

function updateSessionHeader() {
  if (!currentSession) return;

  document.getElementById('sessionName').textContent = currentSession.name || 'Unnamed';
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
  const ctxClass = contextClass(currentSession.contextPercent);

  // Desktop header badge shows percent + tokens; the mobile one (bottom-left
  // of the input row) only has room for the percent.
  const contextEl = document.getElementById('sessionContext');
  contextEl.textContent = `${currentSession.contextPercent}%${tokenStr}`;
  contextEl.className = 'badge badge-context' + (ctxClass ? ' ' + ctxClass : '');
  const barCtx = document.getElementById('sessionContextBar');
  if (barCtx) {
    barCtx.textContent = `${currentSession.contextPercent}%`;
    barCtx.className = 'badge badge-context' + (ctxClass ? ' ' + ctxClass : '');
  }

  updateThinkingBadges();
  updateTerminalButtons();
}

// --- Thinking level selector (levels come from helpers.THINKING_LEVEL_NAMES) ---
let thinkingDropdownOpen = false;

function updateThinkingBadges() {
  const level = currentSession?.thinkingLevel;
  const show = !!(currentSession && currentSession.isActive);
  const label = '🧠 ' + (level || '?') + ' ▾';
  const desktop = document.getElementById('sessionThinking');
  if (desktop) {
    desktop.style.display = show ? '' : 'none';
    desktop.textContent = label;
  }
  const mobileRow = document.getElementById('cpThinkingRow');
  if (mobileRow) mobileRow.style.display = show ? '' : 'none';
  const mobileVal = document.getElementById('sessionThinkingMobile');
  if (mobileVal) mobileVal.textContent = (level || '?') + ' ▾';
}

function toggleThinkingDropdown(event) {
  if (!currentSession || !currentSession.isActive) return;
  const dropdown = document.getElementById('thinkingDropdown');
  thinkingDropdownOpen = !thinkingDropdownOpen;
  if (!thinkingDropdownOpen) { dropdown.style.display = 'none'; return; }

  dropdown.innerHTML = THINKING_LEVEL_NAMES.map(l =>
    `<div class="thinking-option${l === currentSession.thinkingLevel ? ' active' : ''}" onclick="selectThinkingLevel('${l}')">${l}</div>`
  ).join('');

  // On mobile the trigger sits above the keyboard/composer — open upward.
  anchorDropdown(dropdown, event.currentTarget.getBoundingClientRect(), { above: window.innerWidth <= 768 });
  dropdown.style.display = 'block';
  armOutsideClickClose(['thinkingDropdown'], closeThinkingDropdown, () => thinkingDropdownOpen);
}

function closeThinkingDropdown() {
  thinkingDropdownOpen = false;
  document.getElementById('thinkingDropdown').style.display = 'none';
}

async function selectThinkingLevel(level) {
  closeThinkingDropdown();
  if (!currentSession) return;
  try {
    const data = await apiSend(`/api/sessions/${currentSession.id}/thinking`, { level });
    // Pi clamps to what the model supports; trust the reported level.
    patchSession(currentSession.id, { thinkingLevel: data.level || level });
    setStatus('Thinking level: ' + currentSession.thinkingLevel);
  } catch (e) {
    setStatus('Thinking level failed: ' + e.message, 'error');
  }
}

// --- Focus mode: hide tool calls/results so only user/assistant text shows ---
let focusMode = false;

function setFocusMode(on) {
  focusMode = !!on;
  localStorage.setItem('pi-dish-focus', focusMode ? '1' : '0');
  const messages = document.getElementById('messages');
  if (messages) messages.classList.toggle('focus-mode', focusMode);
  for (const id of ['btnFocus', 'btnFocusMobile']) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', focusMode);
  }
  const state = document.getElementById('focusModeState');
  if (state) state.textContent = focusMode ? 'on' : 'off';
}

// --- In-session text search ---
// Server-side match list (whole session, not just loaded pages); the client
// pages older messages in as needed and jumps between matches. Enter walks
// backwards (most recent first), Shift+Enter forwards.
const search = { query: '', matches: [], pos: -1, navigating: false };

function toggleSearchBar() {
  const bar = document.getElementById('searchBar');
  if (!bar) return;
  if (bar.style.display === 'none') openSearch(); else closeSearch();
}

function openSearch() {
  if (!currentSession) return;
  const bar = document.getElementById('searchBar');
  bar.style.display = '';
  const input = document.getElementById('searchInput');
  input.focus();
  input.select();
}

function closeSearch() {
  const bar = document.getElementById('searchBar');
  if (!bar || bar.style.display === 'none') return;
  bar.style.display = 'none';
  search.query = '';
  search.matches = [];
  search.pos = -1;
  clearSearchMarks();
  updateSearchCount();
}

function clearSearchMarks() {
  document.querySelectorAll('.message.search-current').forEach(el => el.classList.remove('search-current'));
  document.querySelectorAll('mark.search-mark').forEach(mark => {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent));
    parent.normalize();
  });
}

function updateSearchCount(msg) {
  const el = document.getElementById('searchCount');
  if (!el) return;
  if (msg != null) { el.textContent = msg; return; }
  el.textContent = search.matches.length
    ? `${search.pos + 1}/${search.matches.length}`
    : (search.query ? 'no matches' : '');
}

async function runSessionSearch(query) {
  if (!currentSession) return;
  updateSearchCount('searching…');
  try {
    const res = await fetch(`/api/sessions/${currentSession.id}/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    search.query = query;
    search.matches = visibleSearchMatchesOf(data.matches || []);
    search.pos = search.matches.length - 1; // start from the latest match
    if (search.matches.length) await jumpToSearchResult();
    updateSearchCount();
  } catch (e) {
    updateSearchCount('search failed');
    console.error('Session search failed:', e);
  }
}

// In focus mode tool results are hidden — skip matches we couldn't show.
function visibleSearchMatchesOf(matches) {
  return focusMode ? matches.filter(m => m.role !== 'toolResult') : matches;
}

function searchPrev() { moveSearch(-1); }
function searchNext() { moveSearch(1); }

async function moveSearch(delta) {
  // While a jump is paging older messages in, advancing pos would move the
  // counter without moving the highlight (the in-flight jump already captured
  // its match) — swallow the keypress until navigation settles.
  if (!search.matches.length || search.navigating) return;
  search.pos = (search.pos + delta + search.matches.length) % search.matches.length;
  updateSearchCount();
  await jumpToSearchResult();
}

async function jumpToSearchResult() {
  if (search.navigating) return;
  const match = search.matches[search.pos];
  if (!match || !currentSession) return;
  search.navigating = true;
  try {
    const container = document.getElementById('messages');
    // Page older messages in until the match is loaded.
    let guard = 0;
    while (oldestLoadedIndex != null && match.index < oldestLoadedIndex && hasMoreOlder && guard++ < 200) {
      await loadOlderMessages();
    }
    const el = container.querySelector(`[data-msg-index="${match.index}"]`);
    if (!el) { updateSearchCount('not loaded'); return; }
    // A match folded into a collapsed tool-group is invisible — open it first.
    const group = el.closest('details.tool-group');
    if (group) group.open = true;
    clearSearchMarks();
    el.classList.add('search-current');
    markSearchTokens(el, search.query.split(/\s+/).filter(Boolean));
    followStream = false; // navigating to a match must not get yanked back down
    el.scrollIntoView({ block: 'center' });
    updateJumpButton(container);
    updateSearchCount();
  } finally {
    search.navigating = false;
  }
}

// Wrap occurrences of each token in <mark> within el's text nodes.
function markSearchTokens(el, tokens) {
  if (!tokens.length) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentElement.closest('mark, script, style')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    const text = node.textContent;
    const lower = text.toLowerCase();
    const ranges = [];
    for (const token of tokens) {
      let from = 0, at;
      while ((at = lower.indexOf(token, from)) !== -1) {
        ranges.push([at, at + token.length]);
        from = at + token.length;
      }
    }
    if (!ranges.length) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start < cursor) continue; // overlapping token match
      frag.appendChild(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement('mark');
      mark.className = 'search-mark';
      mark.textContent = text.slice(start, end);
      frag.appendChild(mark);
      cursor = end;
    }
    frag.appendChild(document.createTextNode(text.slice(cursor)));
    node.replaceWith(frag);
  }
}

function handleSearchKey(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!q) return;
    if (q !== search.query) runSessionSearch(q);
    else if (e.shiftKey) searchNext();
    else searchPrev();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
}

// --- Mobile control panel (model/thinking/context/focus/tree/export) ---
let controlPanelOpen = false;

function toggleControlPanel() {
  controlPanelOpen ? closeControlPanel() : openControlPanel();
}

function openControlPanel() {
  controlPanelOpen = true;
  document.getElementById('controlPanel').classList.add('open');
  document.getElementById('btnPanel')?.classList.add('active');
  // Dropdowns opened from the panel float above it — clicks there keep it open.
  armOutsideClickClose(['controlPanel', 'btnPanel', 'modelDropdown', 'thinkingDropdown'],
    closeControlPanel, () => controlPanelOpen);
}

function closeControlPanel() {
  controlPanelOpen = false;
  document.getElementById('controlPanel')?.classList.remove('open');
  document.getElementById('btnPanel')?.classList.remove('active');
}

function toggleFocusMode() {
  setFocusMode(!focusMode);
  // Keep the reading position sane when large blocks appear/disappear.
  const container = document.getElementById('messages');
  if (container && isPinnedToBottom(container)) scrollToBottom(container);
}

// --- Global preferences (modal — the usage overview lives in its own
// main-pane takeover view now, opened from the sidebar header) ---
function openSettingsModal() {
  document.getElementById('settingsModal').style.display = 'flex';
  renderPreferences();
}

function closeSettingsModal() {
  document.getElementById('settingsModal').style.display = 'none';
}

async function renderPreferences() {
  const renderSeq = ++settingsRenderSeq;
  const body = document.getElementById('settingsBody');
  body.innerHTML = `<div class="preference-row"><label for="responseMetadataMode"><strong>Response metadata</strong><small>Stored on this device. “Effective speed” includes time to first token and JSONL append.</small></label>
    <select id="responseMetadataMode"><option value="hidden">Hidden</option><option value="compact">Compact</option><option value="performance">Performance</option><option value="performance-cost">Performance + estimated cost</option></select></div>
    <label class="preference-row toggle-row"><span><strong>Show estimated session spend in desktop header</strong><small>Stored on this device; off by default.</small></span><input id="showSessionSpend" type="checkbox"></label>
    <div class="preference-row"><label for="monthlyBudget"><strong>Monthly budget warning (USD)</strong><small>Server-global: applies to every device. Estimates use Pi catalog pricing; blank clears.</small></label><div class="budget-save"><input id="monthlyBudget" type="number" min="0.01" step="0.01" placeholder="No warning"><button class="btn-small" id="saveBudget">Save</button></div><small id="budgetStatus"></small></div>
    <div class="preference-row"><label><strong>Saved sidebar filters</strong><small>Server-global. Chips under the sidebar filter toggle these per device; type a query there and hit “+ save filter” to add one.</small></label><div id="savedFiltersList" class="saved-filters-list"></div></div>`;
  const mode = body.querySelector('#responseMetadataMode'); mode.value = responseMetadataMode;
  mode.addEventListener('change', () => {
    responseMetadataMode = RESPONSE_MODES.has(mode.value) ? mode.value : 'compact';
    localStorage.setItem(RESPONSE_MODE_KEY, responseMetadataMode); updateRenderedResponseMetadata();
  });
  const spend = body.querySelector('#showSessionSpend'); spend.checked = showSessionSpend;
  spend.addEventListener('change', () => { showSessionSpend = spend.checked; localStorage.setItem(SESSION_SPEND_KEY, showSessionSpend ? '1' : '0'); refreshSessionSpend(); });
  const renderSavedFiltersList = () => {
    const listEl = body.querySelector('#savedFiltersList');
    if (!listEl) return;
    listEl.innerHTML = savedFilters.length
      ? savedFilters.map(f => `<div class="saved-filter-row"><span class="saved-filter-name">${escapeHtml(f.name)}</span><code class="saved-filter-query">${escapeHtml(f.query)}</code><button class="btn-icon saved-filter-del" data-name="${escapeHtml(f.name)}" title="Delete filter">✕</button></div>`).join('')
      : '<small class="saved-filters-empty">No saved filters yet.</small>';
    for (const btn of listEl.querySelectorAll('.saved-filter-del')) {
      btn.addEventListener('click', async () => {
        try {
          await persistSavedFilters(savedFilters.filter(f => f.name !== btn.dataset.name));
          renderSavedFiltersList();
        } catch (e) { alert('Could not delete filter: ' + e.message); }
      });
    }
  };
  renderSavedFiltersList();
  try {
    const r = await fetch('/api/settings'), s = await r.json();
    if (renderSeq !== settingsRenderSeq ) return;
    body.querySelector('#monthlyBudget').value = s.monthlyBudgetUsd ?? '';
    if (Array.isArray(s.savedFilters)) {
      savedFilters = s.savedFilters;
      renderSavedFiltersList();
    }
  } catch {
    if (renderSeq !== settingsRenderSeq ) return;
    body.querySelector('#budgetStatus').textContent = 'Could not load server setting.';
  }
  if (renderSeq !== settingsRenderSeq ) return;
  body.querySelector('#saveBudget').addEventListener('click', async () => {
    const input = body.querySelector('#monthlyBudget'), status = body.querySelector('#budgetStatus');
    const value = input.value.trim() === '' ? null : Number(input.value);
    try { const r = await fetch('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ monthlyBudgetUsd:value }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); status.textContent = 'Saved for all devices.'; }
    catch (e) { status.textContent = 'Save failed: ' + e.message; }
  });
}

// --- Advanced search (main-pane takeover) ---
// Full-width search over every session: the sidebar grammar verbatim (one
// dialect — never fork it), multiple highlighted snippets per session with
// an occurrence count, facet controls that are pure UI over the grammar
// (they rewrite the query text, which stays the single source of truth),
// and click-through that opens the session and hands the positive tokens to
// the in-session search so the reader lands on the match. `<main>`-level
// like the usage view because search isn't session-scoped; active scopes
// keep applying here (client-side, with the same hidden-count audit note).
let searchViewSeq = 0;
let searchViewQuery = '';
let searchViewTimer = null;
let searchViewRepollTimer = null;

function isSearchViewOpen() {
  return document.querySelector('.main').classList.contains('search-open');
}

function openSearchView(initialQuery) {
  closeSidebar();
  closeUsageView(); // takeovers are mutually exclusive
  if (typeof initialQuery === 'string') searchViewQuery = initialQuery;
  const input = document.getElementById('searchViewInput');
  input.value = searchViewQuery;
  document.querySelector('.main').classList.add('search-open');
  input.focus();
  input.select();
  runSearchView();
}

function closeSearchView() {
  document.querySelector('.main').classList.remove('search-open');
  clearTimeout(searchViewTimer);
  clearTimeout(searchViewRepollTimer);
}

function onSearchViewInput({ immediate = false } = {}) {
  searchViewQuery = document.getElementById('searchViewInput').value;
  clearTimeout(searchViewTimer);
  if (immediate) runSearchView();
  else searchViewTimer = setTimeout(runSearchView, 300);
}

async function runSearchView() {
  const seq = ++searchViewSeq;
  const body = document.getElementById('searchViewBody');
  if (body.childElementCount) body.classList.add('usage-refreshing');
  else body.innerHTML = '<div class="usage-state">Searching…</div>';
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(searchViewQuery.trim()));
    if (!r.ok) throw new Error(await r.json().then(d => d.error, () => null) || `HTTP ${r.status}`);
    const d = await r.json();
    if (seq !== searchViewSeq || !isSearchViewOpen()) return;
    renderSearchView(d);
    if (d.indexing) searchViewRepollTimer = setTimeout(() => { if (isSearchViewOpen()) runSearchView(); }, 1000);
  } catch (e) {
    if (seq !== searchViewSeq || !isSearchViewOpen()) return;
    body.classList.remove('usage-refreshing');
    body.innerHTML = `<div class="usage-state">Search failed: ${escapeHtml(e.message)}</div>`;
  }
}

// Facet plumbing: replace any `prefix:` term in the query text with the
// picked value (or drop it). Rewriting the visible query — instead of
// keeping hidden facet state — means what you see is exactly what runs,
// and a facet choice can be hand-edited afterwards.
function setSearchToken(prefix, value) {
  const input = document.getElementById('searchViewInput');
  let q = input.value
    .replace(new RegExp(`(^|\\s)-?${prefix}:("[^"]*"|\\S+)`, 'gi'), ' ')
    .replace(/\s{2,}/g, ' ').trim();
  if (value) q = (q ? q + ' ' : '') + prefix + ':' + (/\s/.test(value) ? `"${value}"` : value);
  input.value = q;
  onSearchViewInput({ immediate: true });
}

const SEARCH_DATE_PRESETS = [['', 'Any time'], ['1d', '24h'], ['7d', '7 days'], ['30d', '30 days']];

function searchFacetState() {
  const parsed = parseSessionQuery(searchViewQuery);
  const val = (f) => parsed.terms.find(t => t.field === f && !t.neg)?.value || '';
  return {
    cwd: val('cwd'),
    model: val('model'),
    activeOnly: parsed.terms.some(t => t.field === 'is' && !t.neg && t.value === 'active'),
    since: (searchViewQuery.match(/(?:^|\s)since:(\S+)/i) || [])[1] || '',
  };
}

// Facet options come from the sidebar's session lists (the full corpus the
// client already knows), not from the current results — otherwise picking a
// workspace would immediately empty every other option.
function searchFacetOptions() {
  const all = [...sessions.active, ...sessions.previous];
  const cwds = new Map(), models = new Set();
  for (const s of all) {
    if (s.cwd) cwds.set(s.cwd, shortCwd(s.cwd));
    if (s.model && s.model !== 'unknown') models.add(s.model);
  }
  return {
    cwds: [...cwds.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    models: [...models].sort(),
  };
}

function renderSearchFacetsHtml() {
  const st = searchFacetState();
  const opts = searchFacetOptions();
  const presets = SEARCH_DATE_PRESETS.map(([v, l]) =>
    `<button class="usage-range-btn${st.since === v ? ' active' : ''}" data-since="${v}">${l}</button>`).join('');
  const cwdOptions = ['<option value="">All workspaces</option>',
    ...opts.cwds.map(([cwd, label]) =>
      `<option value="${escapeHtml(cwd)}"${cwd.toLowerCase() === st.cwd ? ' selected' : ''}>${escapeHtml(label)}</option>`)].join('');
  const modelOptions = ['<option value="">All models</option>',
    ...opts.models.map(m =>
      `<option value="${escapeHtml(m)}"${m.toLowerCase() === st.model ? ' selected' : ''}>${escapeHtml(m)}</option>`)].join('');
  return `<div class="search-facets">
    <div class="usage-ranges">${presets}</div>
    <select class="search-facet-select" id="searchFacetCwd">${cwdOptions}</select>
    <select class="search-facet-select" id="searchFacetModel">${modelOptions}</select>
    <button class="scope-chip${st.activeOnly ? ' active' : ''}" id="searchFacetActive" title="is:active">Active only</button>
  </div>`;
}

function renderSearchView(d) {
  const body = document.getElementById('searchViewBody');
  body.classList.remove('usage-refreshing');
  const tokens = positiveQueryTokens(parseSessionQuery(searchViewQuery));
  const sq = scopeQuery();
  const scopeParsed = sq ? parseSessionQuery(sq) : null;
  const shown = scopeParsed ? d.results.filter(s => evaluateSessionQuery(scopeParsed, s)) : d.results;
  const scopesHidden = d.results.length - shown.length;

  const cards = shown.map(s => {
    let dot = '';
    if (s.turnInProgress || s.compacting) dot = '<span class="session-item-status working"></span>';
    else if (s.isActive) dot = '<span class="live-dot"></span>';
    const count = s.matchCount
      ? `<span class="search-result-count">${s.matchCount} ${s.matchCount === 1 ? 'match' : 'matches'}</span>` : '';
    const snippets = (s.snippets || []).map(sn =>
      `<div class="search-result-snippet">${highlightTokens(sn, tokens)}</div>`).join('');
    return `<div class="search-result" data-id="${escapeHtml(s.id)}">
      <div class="search-result-header">
        ${dot}<span class="search-result-name">${highlightTokens(s.name || 'Unnamed', tokens)}</span>
        ${count}<span class="search-result-time">${formatRelativeTime(s.lastActivity)}</span>
      </div>
      <div class="search-result-meta">${escapeHtml(shortCwd(s.cwd || '~'))} · ${escapeHtml(s.model)}</div>
      ${snippets}
    </div>`;
  }).join('');

  body.innerHTML = `
    ${renderSearchFacetsHtml()}
    ${d.indexing ? '<div class="usage-notice">History is indexing; results will refresh…</div>' : ''}
    <div class="search-count-line">${shown.length === 1 ? '1 session' : `${shown.length} sessions`}${d.total > d.results.length ? ` — showing the ${d.results.length} most recent, narrow the query for the rest` : ''}</div>
    ${cards || '<div class="usage-state">No matching sessions.</div>'}
    ${scopesHidden > 0 ? `<div class="scope-hidden-note">${scopesHidden} hidden by scopes</div>` : ''}
  `;
  body.querySelectorAll('[data-since]').forEach(b =>
    b.addEventListener('click', () => setSearchToken('since', b.dataset.since || null)));
  body.querySelector('#searchFacetCwd').addEventListener('change', (e) =>
    setSearchToken('cwd', e.target.value || null));
  body.querySelector('#searchFacetModel').addEventListener('change', (e) =>
    setSearchToken('model', e.target.value || null));
  body.querySelector('#searchFacetActive').addEventListener('click', () =>
    setSearchToken('is', searchFacetState().activeOnly ? null : 'active'));
}

/**
 * Click-through: close the takeover, show the session, and — when the query
 * had text terms — hand them to the in-session search so the reader lands on
 * the actual match instead of at the transcript's tail.
 */
async function openSearchResult(id) {
  const tokens = positiveQueryTokens(parseSessionQuery(searchViewQuery));
  closeSearchView();
  // Search results span the whole corpus; the sidebar lists may be narrowed
  // (or Active-tab-only) right now, and selectSession validates against them.
  if (!findSession(id)) await loadSessions(undefined, { withPrevious: true });
  await selectSession(id);
  if (tokens.length && currentSession?.id === id) {
    openSearch();
    const input = document.getElementById('searchInput');
    input.value = tokens.join(' ');
    runSessionSearch(input.value.trim().toLowerCase());
  }
}

// --- Usage view (main-pane takeover) ---
// Global usage/spend overview: KPI headlines, a stacked-by-model daily chart,
// model share, and workspace/session breakdowns. Opened from the sidebar
// header; `.main.usage-open` hides the empty state and session view (the
// diff/file-view takeover pattern, one level up because usage isn't
// session-scoped). Data is /api/usage-summary — the range presets scope
// everything below them; the KPI row above is fixed headline windows.
// Chart series colors are the validated --chart-N theme tokens; the top five
// models in the range take slots 1–5 and the rest fold into "other".
const USAGE_RANGES = [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All time']];
const USAGE_RANGE_LABELS = { 1: 'today', 7: 'the last 7 days', 30: 'the last 30 days', all: 'all time' };

function isUsageViewOpen() {
  return document.querySelector('.main').classList.contains('usage-open');
}

function openUsageView() {
  closeSidebar();
  closeSearchView(); // takeovers are mutually exclusive
  if (isUsageViewOpen()) return;
  document.querySelector('.main').classList.add('usage-open');
  loadUsageView();
}

function closeUsageView() {
  document.querySelector('.main').classList.remove('usage-open');
  clearTimeout(usageTimer); usageTimer = null;
  hideUsageTooltip();
}

function setUsageRange(range) {
  usageRange = range;
  usageSelectedDay = null;
  loadUsageView();
}

// The cost/tokens toggle is the view's metric: it re-ranks the breakdowns
// server-side (the groups are truncated to the top 20 there, so the client
// re-sorting its slice would show the wrong twenty) *and* switches what the
// chart, tooltip, and day detail plot. Device-local preference, like the
// response-metadata density.
function setUsageSort(sort) {
  if (usageSort === sort) return;
  usageSort = sort;
  localStorage.setItem('pi-dish-usage-sort', sort);
  loadUsageView();
}

// Model filter (multi-select): clicking rows in the Models section toggles
// refs in/out. Applied server-side — the workspace/session groups only exist
// pre-truncated, so a filtered view needs a refetch, not a client re-slice.
function usageModelsKey() { return [...usageModelFilter].join(','); }
function toggleUsageModelFilter(ref) {
  if (usageModelFilter.has(ref)) usageModelFilter.delete(ref);
  else usageModelFilter.add(ref);
  loadUsageView();
}
function clearUsageModelFilter() {
  if (!usageModelFilter.size) return;
  usageModelFilter.clear();
  loadUsageView();
}

async function loadUsageView() {
  const fetchSeq = ++usageFetchSeq;
  const requestedRange = usageRange, requestedSort = usageSort, requestedModels = usageModelsKey();
  const stale = () => fetchSeq !== usageFetchSeq || requestedRange !== usageRange ||
    requestedSort !== usageSort || requestedModels !== usageModelsKey() || !isUsageViewOpen();
  const body = document.getElementById('usageViewBody');
  // Refetch keeps the frame: dim the previous render instead of blanking it.
  if (body.childElementCount) body.classList.add('usage-refreshing');
  else body.innerHTML = '<div class="usage-state">Loading estimated usage…</div>';
  try {
    const r = await fetch('/api/usage-summary?days=' + requestedRange + '&sort=' + requestedSort +
      (requestedModels ? '&models=' + encodeURIComponent(requestedModels) : ''));
    // A stale server (or proxy) answers with an HTML error page — surface the
    // status instead of a JSON parse error.
    if (!r.ok) throw new Error(await r.json().then(d => d.error, () => null) || `HTTP ${r.status}`);
    const d = await r.json();
    if (stale()) return;
    usageData = d;
    renderUsageView(d);
    if (d.indexing) usageTimer = setTimeout(() => { if (isUsageViewOpen()) loadUsageView(); }, 1000);
  } catch (e) {
    if (stale()) return;
    body.classList.remove('usage-refreshing');
    body.innerHTML = `<div class="usage-state">Could not load usage: ${escapeHtml(e.message)}</div>`;
  }
}

function usageMetricValue(bucket, metric) {
  if (metric === 'cost') return bucket.costs?.total || 0;
  if (metric === 'tokens') return usageTokensTotal(bucket.tokens);
  return bucket.calls || 0;
}
const USAGE_METRIC_LABELS = { cost: 'Estimated spend', tokens: 'Tokens', calls: 'Calls' };
function usageModelValue(m, metric) {
  if (metric === 'cost') return m.cost || 0;
  if (metric === 'tokens') return usageTokensTotal(m.tokens);
  return m.calls || 0;
}
function usageTokensTotal(tokens) {
  return ['input', 'output', 'cacheRead', 'cacheWrite'].reduce((s, k) => s + (tokens?.[k] || 0), 0);
}
// Compact per-row breakdown: "1.2M in / 800k out · 92% cached". The cached
// share is cacheRead over the whole prompt side (input + cache read + cache
// write) — the same denominator formatCacheStat uses in the stats modal.
function usageTokensDetail(tokens) {
  const t = tokens || {};
  const parts = [`${formatTokens(t.input)} in / ${formatTokens(t.output)} out`];
  const prompt = (t.input || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
  if (prompt > 0 && (t.cacheRead || 0) > 0) parts.push(`${Math.round((t.cacheRead || 0) / prompt * 100)}% cached`);
  return parts.join(' · ');
}

function renderUsageView(d) {
  const body = document.getElementById('usageViewBody');
  body.classList.remove('usage-refreshing');
  const t = d.totals || {}, h = d.headlineCosts || {};
  const budget = d.monthlyBudgetUsd;

  const kpis = [['Today', h.today], ['Last 7 days', h.days7], ['Last 30 days', h.days30], ['This month', h.month]]
    .map(([k, v]) => `<div class="usage-kpi"><small>${k}</small><strong>${formatEstimatedCost(v)}</strong></div>`).join('');

  let budgetHtml = '';
  if (budget) {
    const pct = Math.min(100, (h.month || 0) / budget * 100);
    const cls = pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '';
    budgetHtml = `<div class="usage-budget${cls}"><div class="usage-budget-track"><div class="usage-budget-fill" style="width:${pct.toFixed(1)}%"></div></div><small>${formatEstimatedCost(h.month)} of ~$${Number(budget).toFixed(2)} monthly budget${pct >= 100 ? ' — over budget' : ''}</small></div>`;
  }

  const ranges = USAGE_RANGES
    .map(([v, l]) => `<button class="usage-range-btn${usageRange === v ? ' active' : ''}" data-range="${v}">${l}</button>`).join('');
  const sortCtl = `<span class="usage-sort"><small>Show</small>${[['cost', 'Cost'], ['tokens', 'Tokens']]
    .map(([v, l]) => `<button class="usage-range-btn${usageSort === v ? ' active' : ''}" data-sort="${v}">${l}</button>`).join('')}</span>`;

  const summary = `<div class="usage-total-line"><strong>${formatEstimatedCost(t.costs?.total)}</strong> · ${t.calls || 0} calls · ${formatTokens(usageTokensTotal(t.tokens))} tokens in ${USAGE_RANGE_LABELS[d.range] || 'the selected range'}</div>` +
    `<div class="usage-token-line">${formatTokens(t.tokens?.input)} in · ${formatTokens(t.tokens?.output)} out · cache ${formatCacheStat(t.tokens?.cacheRead, t.tokens?.cacheWrite, t.tokens?.input)}</div>`;
  const filterNote = usageModelFilter.size
    ? `<div class="usage-filter-note">Filtered to ${[...usageModelFilter].map(r => `<b title="${escapeHtml(r)}">${escapeHtml(shortModelName(r))}</b>`).join(', ')}<button class="usage-range-btn" data-clear-models>✕ clear</button></div>`
    : '';

  // One metric drives the whole view — chart, tooltip, day detail, and the
  // breakdown bars all plot it: tokens when that toggle is chosen, else
  // spend, else calls when nothing in range carries a cost.
  const metric = usageSort === 'tokens' ? 'tokens' : (t.costs?.total || 0) > 0 ? 'cost' : 'calls';
  // Chart model: series slots follow the range's top *active* models (server
  // sort order; the model filter narrows the palette to the selected refs) so
  // the chart, its legend, and the model-share section all agree on colors.
  const activeModels = (d.groups?.models || []).filter(m => !usageModelFilter.size || usageModelFilter.has(m.key));
  const daily = d.daily || [];
  const buckets = daily.length > 90 ? aggregateUsageWeekly(daily) : daily;
  const seriesRefs = activeModels.slice(0, 5).map(m => m.key);
  usageChart = { buckets, seriesRefs, metric, activeModelCount: activeModels.length };
  const showChart = d.range !== '1' && buckets.length > 1 && (t.calls || 0) > 0;
  const chartSection = showChart
    ? `<section class="usage-section"><h4>${USAGE_METRIC_LABELS[metric]} per ${buckets === daily ? 'day' : 'week'}</h4><div class="usage-chart" id="usageChart"></div></section>`
    : '';
  if (d.range === '1' && daily.length) usageSelectedDay = daily[daily.length - 1].day;

  body.innerHTML = `
    <div class="usage-kpis">${kpis}</div>
    ${budgetHtml}
    ${d.indexing ? '<div class="usage-notice">History is indexing; totals will refresh…</div>' : ''}
    <div class="usage-ranges">${ranges}${sortCtl}</div>
    ${(t.calls || 0) === 0 ? '<div class="usage-state">No usage in this range.</div>' : summary}
    ${filterNote}
    ${chartSection}
    <div id="usageDayDetail"></div>
    ${usageModelShareHtml(d, metric, seriesRefs)}
    <div class="usage-columns">
      ${usageGroupListHtml('Workspaces', d.groups?.workspaces, 'workspace', metric)}
      ${usageGroupListHtml('Sessions', d.groups?.sessions, 'session', metric)}
    </div>
    ${d.unpricedModelCalls ? `<div class="usage-notice">${d.unpricedModelCalls} calls have unavailable pricing and are excluded from estimated spend; unknown usage is not $0 billed.</div>` : ''}
  `;
  body.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => setUsageRange(b.dataset.range)));
  body.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => setUsageSort(b.dataset.sort)));
  body.querySelector('[data-clear-models]')?.addEventListener('click', clearUsageModelFilter);
  body.querySelectorAll('[data-model-ref]').forEach(row => {
    row.addEventListener('click', () => toggleUsageModelFilter(row.dataset.modelRef));
    row.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggleUsageModelFilter(row.dataset.modelRef);
    });
  });
  // Session rows jump to the session itself — the takeover closes so the
  // transcript is visible underneath.
  body.querySelectorAll('[data-session-id]').forEach(row => row.addEventListener('click', () => {
    closeUsageView();
    selectSession(row.dataset.sessionId);
  }));
  if (showChart) drawUsageChart();
  renderUsageDayDetail();
}

// Chart geometry is computed against the holder's live width; redraw on
// resize instead of scaling a stale viewBox (bars keep their mark specs).
function drawUsageChart() {
  const holder = document.getElementById('usageChart');
  if (!holder || !usageChart) return;
  const { buckets, seriesRefs, metric } = usageChart;
  const width = Math.max(280, holder.clientWidth || 0);
  const max = Math.max(...buckets.map(b => usageMetricValue(b, metric)));
  const { step, top, ticks } = niceTicks(max);
  const dec = (String(step).split('.')[1] || '').length;
  const fmtTick = v => metric === 'cost' ? (v === 0 ? '$0' : '$' + v.toFixed(dec)) : formatTokens(v);

  const yLabelW = Math.max(...ticks.map(v => fmtTick(v).length)) * 6.5 + 12;
  const margin = { top: 8, right: 4, bottom: 22, left: Math.ceil(yLabelW) };
  const plotH = 170;
  const height = margin.top + plotH + margin.bottom;
  const plotW = Math.max(60, width - margin.left - margin.right);
  const n = buckets.length;
  const band = plotW / n;
  const barW = Math.max(2, Math.min(24, band - 2));
  const yFor = v => margin.top + plotH - (top > 0 ? v / top * plotH : 0);

  const parts = [];
  for (const v of ticks) {
    const y = yFor(v);
    if (v > 0) parts.push(`<line class="grid" x1="${margin.left}" x2="${margin.left + plotW}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text class="tick" x="${margin.left - 6}" y="${y + 3}" text-anchor="end">${fmtTick(v)}</text>`);
  }
  parts.push(`<line class="axis" x1="${margin.left}" x2="${margin.left + plotW}" y1="${yFor(0)}" y2="${yFor(0)}"/>`);
  // Sparse x labels, anchored so the newest bucket is always labeled.
  const stride = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 80))));
  for (let i = 0; i < n; i++) {
    if ((n - 1 - i) % stride !== 0) continue;
    const x = margin.left + band * (i + 0.5);
    parts.push(`<text class="tick" x="${x}" y="${margin.top + plotH + 15}" text-anchor="middle">${formatUsageDay(buckets[i].day)}</text>`);
  }

  let anyOther = false;
  for (let i = 0; i < n; i++) {
    const b = buckets[i];
    const total = usageMetricValue(b, metric);
    const byRef = new Map((b.models || []).map(m => [m.ref, m]));
    const segs = [];
    let known = 0;
    seriesRefs.forEach((ref, s) => {
      const v = byRef.has(ref) ? usageModelValue(byRef.get(ref), metric) : 0;
      known += v;
      if (v > 0) segs.push({ cls: 's' + (s + 1), v });
    });
    const other = Math.max(0, total - known);
    if (other > 0) { segs.push({ cls: 'sother', v: other }); anyOther = true; }

    const x = margin.left + band * i + (band - barW) / 2;
    const label = (b.days > 1 ? `Week of ${formatUsageDay(b.day)}` : formatUsageDay(b.day, 'long')) + ': ' +
      (metric === 'cost' ? formatEstimatedCost(b.costs?.total)
        : metric === 'tokens' ? `${formatTokens(usageTokensTotal(b.tokens))} tokens`
        : `${b.calls} calls`);
    const seg = [];
    let cursor = yFor(0);
    for (let sI = 0; sI < segs.length; sI++) {
      const hPx = top > 0 ? segs[sI].v / top * plotH : 0;
      if (hPx <= 0) continue;
      const isTop = sI === segs.length - 1;
      // 2px surface gap between stacked fills (shaved off each lower segment).
      const drawH = Math.max(0.75, hPx - (isTop ? 0 : 2));
      const yTop = cursor - hPx;
      if (isTop) {
        const r = Math.min(3, barW / 2, drawH);
        seg.push(`<path class="seg ${segs[sI].cls}" d="M${x},${(yTop + drawH).toFixed(1)} V${(yTop + r).toFixed(1)} Q${x},${yTop.toFixed(1)} ${x + r},${yTop.toFixed(1)} H${(x + barW - r).toFixed(1)} Q${x + barW},${yTop.toFixed(1)} ${x + barW},${(yTop + r).toFixed(1)} V${(yTop + drawH).toFixed(1)} Z"/>`);
      } else {
        seg.push(`<rect class="seg ${segs[sI].cls}" x="${x}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${drawH.toFixed(1)}"/>`);
      }
      cursor = yTop;
    }
    parts.push(`<g class="usage-col${b.day === usageSelectedDay ? ' selected' : ''}" data-i="${i}" tabindex="0" role="button" aria-label="${escapeHtml(label)}"><rect class="hit" x="${margin.left + band * i}" y="${margin.top}" width="${band.toFixed(2)}" height="${plotH}"/>${seg.join('')}</g>`);
  }

  const legendItems = seriesRefs.map((ref, i) =>
    `<span class="usage-legend-item" title="${escapeHtml(ref)}"><i class="swatch s${i + 1}"></i>${escapeHtml(shortModelName(ref))}</span>`);
  if (anyOther || (usageChart.activeModelCount || 0) > seriesRefs.length)
    legendItems.push('<span class="usage-legend-item"><i class="swatch sother"></i>other</span>');

  holder.innerHTML = `<svg width="${width}" height="${height}" role="img" aria-label="${USAGE_METRIC_LABELS[metric]} per ${buckets[0]?.days > 1 ? 'week' : 'day'}">${parts.join('')}</svg>` +
    (legendItems.length > 1 ? `<div class="usage-legend">${legendItems.join('')}</div>` : '');

  holder.onpointermove = e => {
    const g = e.target.closest('.usage-col');
    if (!g) { hideUsageTooltip(); return; }
    showUsageTooltip(buckets[Number(g.dataset.i)], e);
  };
  holder.onpointerleave = () => hideUsageTooltip();
  holder.onclick = e => {
    const g = e.target.closest('.usage-col');
    if (g) toggleUsageDay(buckets[Number(g.dataset.i)].day);
  };
  holder.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target.closest('.usage-col');
    if (g) { e.preventDefault(); toggleUsageDay(buckets[Number(g.dataset.i)].day); }
  };
}

function toggleUsageDay(day) {
  usageSelectedDay = usageSelectedDay === day ? null : day;
  document.querySelectorAll('#usageChart .usage-col').forEach(g => {
    g.classList.toggle('selected', usageChart.buckets[Number(g.dataset.i)]?.day === usageSelectedDay);
  });
  renderUsageDayDetail();
}

function renderUsageDayDetail() {
  const holder = document.getElementById('usageDayDetail');
  if (!holder) return;
  const bucket = usageChart?.buckets?.find(b => b.day === usageSelectedDay)
    || (usageData?.range === '1' ? usageData.daily?.[usageData.daily.length - 1] : null);
  if (!bucket || !usageSelectedDay) { holder.innerHTML = ''; return; }
  const metric = usageChart?.metric || 'cost';
  const title = bucket.days > 1
    ? `Week of ${formatUsageDay(bucket.day)} <small>· ${bucket.days} days</small>`
    : formatUsageDay(bucket.day, 'long');
  const tok = bucket.tokens || {};
  const stats = [
    ['Estimated spend', formatEstimatedCost(bucket.costs?.total)],
    ['Calls', String(bucket.calls || 0)],
    ['Tokens in / out', `${formatTokens(tok.input)} / ${formatTokens(tok.output)}`],
    ['Cache', formatCacheStat(tok.cacheRead, tok.cacheWrite, tok.input)],
  ].map(([k, v]) => `<div><small>${k}</small><strong>${v}</strong></div>`).join('');
  const slotFor = ref => {
    const i = (usageChart?.seriesRefs || []).indexOf(ref);
    return i >= 0 ? 's' + (i + 1) : 'sother';
  };
  const rows = (bucket.models || []).map(m => {
    const meta = [`${m.calls} calls`, `${formatTokens(usageTokensTotal(m.tokens))} tok`];
    if (usageTokensTotal(m.tokens) > 0) meta.push(usageTokensDetail(m.tokens));
    if (metric === 'cost') meta.push(formatEstimatedCost(m.cost));
    return `
    <div class="usage-row" title="${escapeHtml(m.ref)}">
      <i class="swatch ${slotFor(m.ref)}"></i>
      <span class="usage-row-name">${escapeHtml(shortModelName(m.model || m.ref))}<small>${escapeHtml(m.provider || '')}</small></span>
      <span class="usage-row-meta">${meta.join(' · ')}</span>
    </div>`;
  }).join('');
  holder.innerHTML = `<section class="usage-day-detail">
    <div class="usage-day-detail-header"><h4>${title}</h4><button class="btn-icon" title="Close details" data-close-day>✕</button></div>
    <div class="usage-day-stats">${stats}</div>
    ${rows || '<small class="usage-empty">No usage this day.</small>'}
  </section>`;
  holder.querySelector('[data-close-day]').addEventListener('click', () => toggleUsageDay(usageSelectedDay));
}

// Part-to-whole share of the range by model: one horizontal stacked bar
// (top five slots + other) over the per-model table that doubles as the
// chart's WCAG-clean twin. The rows are also the model filter's toggles —
// the list itself is never filtered (it's the facet control): with a filter
// active, selected rows keep their chart slot colors and share of the
// *selected* total while deselected rows dim with a hollow swatch.
function usageModelShareHtml(d, metric, seriesRefs) {
  const models = d.groups?.models || [];
  const filtered = usageModelFilter.size > 0;
  if (!models.length && !filtered) return '';
  const isOn = ref => !filtered || usageModelFilter.has(ref);
  const val = m => usageModelValue({ cost: m.costs?.total, calls: m.calls, tokens: m.tokens }, metric);
  const slotFor = ref => {
    const i = seriesRefs.indexOf(ref);
    return i >= 0 ? 's' + (i + 1) : 'sother';
  };
  const active = models.filter(m => isOn(m.key));
  const total = active.reduce((s, m) => s + val(m), 0);
  const segs = [];
  active.slice(0, 5).forEach(m => {
    const share = total > 0 ? val(m) / total : 0;
    if (share > 0.004) segs.push(`<span class="${slotFor(m.key)}" style="flex-grow:${(share * 1000).toFixed(1)}" title="${escapeHtml(shortModelName(m.key))}"></span>`);
  });
  const restShare = total > 0 ? active.slice(5).reduce((s, m) => s + val(m), 0) / total : 0;
  if (restShare > 0.004) segs.push(`<span class="sother" style="flex-grow:${(restShare * 1000).toFixed(1)}" title="other models"></span>`);
  const rowHtml = (m, on) => {
    const share = on && total > 0 ? val(m) / total : 0;
    const pct = share > 0 ? (share * 100 < 1 ? (share * 100).toFixed(1) : Math.round(share * 100)) + '%' : '—';
    const spend = m.priced === false ? 'pricing unavailable'
      : `${formatEstimatedCost(m.costs?.total)}${m.unpricedCalls ? ` + ${m.unpricedCalls} unpriced` : ''}`;
    const detail = usageTokensTotal(m.tokens) > 0 ? ` · ${usageTokensDetail(m.tokens)}` : '';
    return `<div class="usage-row model-toggle${filtered ? (on ? ' on' : ' off') : ''}" data-model-ref="${escapeHtml(m.key)}" role="button" tabindex="0" aria-pressed="${on}" title="${escapeHtml(m.key)} — click to toggle model filter">
      <i class="swatch ${on ? slotFor(m.key) : 'soff'}"></i>
      <span class="usage-row-name">${escapeHtml(shortModelName(m.model || m.key))}<small>${escapeHtml(m.provider || '')}</small></span>
      <span class="usage-row-meta">${pct} · ${m.calls} calls · ${formatTokens(usageTokensTotal(m.tokens))} tok${detail} · ${escapeHtml(spend)}</span>
    </div>`;
  };
  const rows = models.map(m => rowHtml(m, isOn(m.key))).join('');
  // Selected refs with no usage in this range still get a row, or a range
  // switch could strand a filter with nothing visible to untoggle.
  const missing = [...usageModelFilter].filter(ref => !models.some(m => m.key === ref))
    .map(ref => rowHtml({ key: ref, calls: 0, tokens: {}, costs: { total: 0 } }, true)).join('');
  return `<section class="usage-section"><h4>Models <small class="usage-hint">click to filter</small></h4>
    ${segs.length ? `<div class="usage-share-bar">${segs.join('')}</div>` : ''}
    ${rows}${missing}</section>`;
}

// Workspace/session magnitude lists: single-hue micro-bars (share of the
// largest entry) under each row — magnitude, not identity, so no palette.
function usageGroupListHtml(title, rows, kind, metric) {
  const list = (rows || []).slice(0, 12);
  const val = x => usageModelValue({ cost: x.costs?.total, calls: x.calls, tokens: x.tokens }, metric);
  const maxV = Math.max(1e-9, ...list.map(val));
  const items = list.map(x => {
    const name = kind === 'workspace' ? shortCwd(x.key) : (x.name || x.id);
    const sub = kind === 'session' && x.workspace ? shortCwd(x.workspace) : '';
    const spend = x.priced === false ? 'pricing unavailable'
      : `${formatEstimatedCost(x.costs?.total)}${x.unpricedCalls ? ` + ${x.unpricedCalls} unpriced` : ''}`;
    const attrs = kind === 'session' ? ` data-session-id="${escapeHtml(x.id)}" role="button" tabindex="0"` : '';
    const detail = usageTokensTotal(x.tokens) > 0 ? ` · ${usageTokensDetail(x.tokens)}` : '';
    return `<div class="usage-row usage-bar-row${kind === 'session' ? ' clickable' : ''}"${attrs} title="${escapeHtml(x.key || x.name || x.id)}">
      <span class="usage-row-name">${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>
      <span class="usage-row-meta">${x.calls} calls · ${formatTokens(usageTokensTotal(x.tokens))} tok${detail} · ${escapeHtml(spend)}</span>
      <span class="usage-row-bar" style="width:${(val(x) / maxV * 100).toFixed(1)}%"></span>
    </div>`;
  }).join('');
  return `<section class="usage-section"><h4>${title}</h4>${items || '<small class="usage-empty">No usage in this range.</small>'}</section>`;
}

function ensureUsageTooltip() {
  let el = document.getElementById('usageTooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'usageTooltip';
    el.className = 'usage-tooltip';
    document.body.appendChild(el);
  }
  return el;
}

// One tooltip, every series at that X; values lead, labels follow. Built
// with textContent — model names are untrusted strings.
function showUsageTooltip(bucket, e) {
  if (!bucket) return;
  const el = ensureUsageTooltip();
  el.replaceChildren();
  const metric = usageChart?.metric || 'cost';
  const head = document.createElement('div');
  head.className = 'tt-day';
  head.textContent = bucket.days > 1 ? `Week of ${formatUsageDay(bucket.day)} · ${bucket.days} days` : formatUsageDay(bucket.day, 'long');
  const total = document.createElement('div');
  total.className = 'tt-total';
  total.textContent = metric === 'cost' ? `${formatEstimatedCost(bucket.costs?.total)} · ${bucket.calls || 0} calls`
    : metric === 'tokens' ? `${formatTokens(usageTokensTotal(bucket.tokens))} tokens · ${bucket.calls || 0} calls`
    : `${bucket.calls} calls`;
  el.append(head, total);
  const seriesRefs = usageChart?.seriesRefs || [];
  const byRef = new Map((bucket.models || []).map(m => [m.ref, m]));
  const rows = [];
  seriesRefs.forEach((ref, i) => {
    const m = byRef.get(ref);
    if (m) rows.push(['s' + (i + 1), shortModelName(ref), usageModelValue(m, metric)]);
  });
  let otherV = 0, extra = 0;
  for (const m of bucket.models || []) {
    if (!seriesRefs.includes(m.ref)) { otherV += usageModelValue(m, metric); extra++; }
  }
  if (extra) rows.push(['sother', `other (${extra} model${extra > 1 ? 's' : ''})`, otherV]);
  for (const [cls, name, v] of rows) {
    const row = document.createElement('div');
    row.className = 'tt-row';
    const key = document.createElement('i');
    key.className = 'tt-key ' + cls;
    const value = document.createElement('strong');
    value.textContent = metric === 'cost' ? formatEstimatedCost(v) : metric === 'tokens' ? formatTokens(v) : String(v);
    const label = document.createElement('span');
    label.textContent = name;
    row.append(key, value, label);
    el.appendChild(row);
  }
  el.style.display = 'block';
  const pad = 12, r = el.getBoundingClientRect();
  let x = e.clientX + pad;
  if (x + r.width > window.innerWidth - 8) x = Math.max(8, e.clientX - r.width - pad);
  let y = e.clientY - r.height - pad;
  if (y < 8) y = e.clientY + pad;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

function hideUsageTooltip() {
  const el = document.getElementById('usageTooltip');
  if (el) el.style.display = 'none';
}

let usageResizeTimer = null;
window.addEventListener('resize', () => {
  if (!isUsageViewOpen()) return;
  clearTimeout(usageResizeTimer);
  usageResizeTimer = setTimeout(drawUsageChart, 150);
});

async function refreshSessionSpend() {
  const badge = document.getElementById('sessionSpendBadge');
  if (!badge) return;
  if (!showSessionSpend || !currentSession) { badge.style.display = 'none'; ++spendFetchSeq; return; }
  const id = currentSession.id, seq = ++spendFetchSeq;
  try { const r = await fetch(`/api/sessions/${id}/stats`), s = await r.json(); if (seq !== spendFetchSeq || currentSession?.id !== id || !showSessionSpend) return; badge.textContent = formatEstimatedCost(s.costs?.total ?? s.cost); badge.style.display = ''; } catch { if (seq === spendFetchSeq) badge.style.display = 'none'; }
}

// --- Session stats modal ---
function openStatsModal() {
  if (!currentSession) return;
  const modal = document.getElementById('statsModal');
  const body = document.getElementById('statsBody');
  modal.style.display = 'flex';
  body.textContent = 'Loading...';
  // Delegated once: click a copyable value (paths) to copy it to the clipboard.
  if (!body.dataset.copyBound) {
    body.dataset.copyBound = '1';
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('.stats-copy');
      if (!btn) return;
      copyTextToClipboard(btn.dataset.copy || '').then(
        () => {
          const orig = btn.textContent;
          btn.classList.add('copied');
          btn.textContent = 'Copied ✓';
          setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1200);
        },
        () => setStatus('Copy failed (clipboard blocked)', 'error'),
      );
    });
  }
  fetch(`/api/sessions/${currentSession.id}/stats`)
    .then(r => r.json())
    .then(s => {
      if (s.error) { body.textContent = s.error; return; }
      const cu = s.contextUsage || {};
      // Session-wide effective speed: output tokens over the summed
      // per-message response time (only messages with measurable timing).
      const avgSpeed = formatTokSpeed(s.genOutput, s.genMs);
      // [key, value, copyable?] — copyable rows render the value as a
      // click-to-copy button (paths, handy for jumping to the file in a shell).
      const rows = [
        ['__section', 'Summary'],
        ['Model', s.model || '—'],
        ['Thinking', s.thinkingLevel || '—'],
        ['Context', (cu.tokens != null ? formatTokens(cu.tokens) : '—') +
          ' / ' + (cu.contextWindow ? formatTokens(cu.contextWindow) : '—') +
          (cu.percent != null ? ` (${Math.round(cu.percent * 10) / 10}%)` : '')],
        ['Messages', `${s.userMessages} user · ${s.assistantMessages} assistant · ${s.toolCalls} tool calls`],
        ['__section', 'Performance'],
        s.responseTiming?.medianMs ? ['Response time', `${formatDuration(s.responseTiming.medianMs)} median · ${formatDuration(s.responseTiming.slowestMs)} slowest`] : null,
        avgSpeed ? ['Effective speed', `${avgSpeed} avg · ${formatDuration(s.genMs)} measured response time`] : null,
        ['__section', 'Tokens & cache'],
        ['Tokens in / out', `${formatTokens(s.tokens?.input)} / ${formatTokens(s.tokens?.output)}`],
        s.reasoningTokens ? ['Reasoning', formatTokens(s.reasoningTokens)] : null,
        ['Cache', formatCacheStat(s.tokens?.cacheRead, s.tokens?.cacheWrite, s.tokens?.input)],
        ['__section', 'Estimated spend'],
        ['Estimated total', formatEstimatedCost(s.costs?.total ?? s.cost)],
        ['Components', `input ${formatEstimatedCost(s.costs?.input)} · output ${formatEstimatedCost(s.costs?.output)} · cache read ${formatEstimatedCost(s.costs?.cacheRead)} · write ${formatEstimatedCost(s.costs?.cacheWrite)}`],
        ['__section', 'Location'],
        s.runtime ? ['Running in', formatRuntime(s.runtime)] : null,
        ['cwd', s.cwd || '—', !!s.cwd],
        ['Session file', s.sessionFile || '—', !!s.sessionFile],
      ].filter(Boolean);
      body.innerHTML = '<table class="stats-table">' + rows.map(([k, v, copyable]) => {
        if (k === '__section') return `<tr class="stats-section"><th colspan="2">${escapeHtml(v)}</th></tr>`;
        const val = copyable
          ? `<button type="button" class="stats-copy" data-copy="${escapeHtml(String(v))}" title="Click to copy">${escapeHtml(String(v))}</button>`
          : escapeHtml(String(v));
        return `<tr><td class="stats-key">${escapeHtml(k)}</td><td class="stats-val">${val}</td></tr>`;
      }).join('') + '</table><div class="telemetry-note">Spend is estimated from Pi catalog pricing, not provider-billed. Response time is request start → JSONL append; effective speed includes TTFT.</div>' +
        '<div class="stats-share" id="statsShare"></div>' +
        '<div class="stats-share" id="statsPages"></div>' +
        '<div class="stats-share" id="statsClose"></div>';
      loadShareSection(currentSession.id);
      loadPagesSection(currentSession.id);
      renderCloseSection(currentSession.id);
    })
    .catch(e => { body.textContent = 'Failed to load stats: ' + e.message; });
}

// Public share link section of the stats modal. Fetches current state (404 =
// no share) and renders either a "Create share link" button or the existing
// link as a click-to-copy row plus a Revoke button.
function loadShareSection(sessionId) {
  const el = document.getElementById('statsShare');
  if (!el) return;
  el.innerHTML = '<div class="stats-share-title">Public share link</div>' +
    '<div class="stats-share-body">Loading…</div>';
  fetch(`/api/sessions/${sessionId}/share`)
    .then(r => (r.status === 404 ? null : r.json()))
    .then(share => renderShareSection(sessionId, share))
    .catch(() => renderShareSection(sessionId, null));
}

function renderShareSection(sessionId, share) {
  const el = document.getElementById('statsShare');
  if (!el) return;
  const bodyEl = el.querySelector('.stats-share-body') || el;
  if (!share) {
    bodyEl.innerHTML =
      '<button type="button" class="btn-small" id="shareCreateBtn">Create share link</button>' +
      '<div class="stats-share-hint">Anyone with the link can view this session read-only.</div>';
    bodyEl.querySelector('#shareCreateBtn').addEventListener('click', () => {
      fetch(`/api/sessions/${sessionId}/share`, { method: 'POST' })
        .then(r => r.json())
        .then(s => { renderShareSection(sessionId, s); refreshArtifacts(sessionId); })
        .catch(e => setStatus('Failed to create share: ' + e.message, 'error'));
    });
    return;
  }
  const link = share.url || (location.origin + share.path);
  bodyEl.innerHTML =
    `<button type="button" class="stats-copy stats-share-link" data-copy="${escapeHtml(link)}" title="Click to copy">${escapeHtml(link)}</button>` +
    '<button type="button" class="btn-small btn-danger" id="shareRevokeBtn">Revoke</button>';
  bodyEl.querySelector('#shareRevokeBtn').addEventListener('click', () => {
    fetch(`/api/sessions/${sessionId}/share`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => { renderShareSection(sessionId, null); refreshArtifacts(sessionId); })
      .catch(e => setStatus('Failed to revoke share: ' + e.message, 'error'));
  });
}

// The hover 🔗 in a turn header: copy the session's public share URL deep
// linked to that message (?targetId=<entry id> — pi's export HTML scrolls
// there on load). Reuses the existing share; if none exists yet, creating
// one publishes the whole session, so that asks first.
async function copyMessageShareLink(btn) {
  if (!currentSession) return;
  const entryId = btn.dataset.entryId;
  if (!entryId) return;
  const sessionId = currentSession.id;
  try {
    let res = await fetch(`/api/sessions/${sessionId}/share`);
    let share = res.status === 404 ? null : await res.json();
    if (!share || share.error) {
      if (!confirm('No share link exists for this session yet — create one? Anyone with the link can view the whole session read-only.')) return;
      res = await fetch(`/api/sessions/${sessionId}/share`, { method: 'POST' });
      share = await res.json();
      if (!res.ok) throw new Error(share.error || `HTTP ${res.status}`);
      refreshArtifacts(sessionId);
    }
    const base = share.url || (location.origin + share.path);
    await copyTextToClipboard(`${base}?targetId=${encodeURIComponent(entryId)}`);
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1200);
    setStatus('Message share link copied');
  } catch (e) {
    setStatus('Share link failed: ' + e.message, 'error');
  }
}

// Close-session section of the stats modal (active sessions only): SIGTERM
// the pi process via POST /close. The transcript stays on disk and resumable —
// only the running process goes away, so this is the phone-side equivalent of
// Ctrl+D in the TUI.
function renderCloseSection(sessionId) {
  const el = document.getElementById('statsClose');
  if (!el) return;
  if (!currentSession?.isActive) { el.remove(); return; }
  el.innerHTML = '<div class="stats-share-title">Session process</div>' +
    '<div class="stats-share-body">' +
    '<button type="button" class="btn-small btn-danger" id="sessionCloseBtn">Close session</button>' +
    '<div class="stats-share-hint">Shuts down this pi process. The transcript is kept and can be resumed.</div>' +
    '</div>';
  el.querySelector('#sessionCloseBtn').addEventListener('click', async () => {
    const warn = currentSession.turnInProgress
      ? 'A turn is in progress — closing will abort it. Close this session?'
      : 'Close this session? The pi process will shut down (the transcript stays resumable).';
    if (!confirm(warn)) return;
    const btn = el.querySelector('#sessionCloseBtn');
    btn.disabled = true;
    btn.textContent = 'Closing…';
    try {
      await apiSend(`/api/sessions/${sessionId}/close`);
      closeStatsModal();
      setStatus('Session closed');
      // Re-fetch both lists (the session just moved from active to previous)
      // and re-select so the view flips to its inactive state (resume bar).
      await loadSessions(undefined, { withPrevious: true });
      if (currentSession?.id === sessionId) selectSession(sessionId);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Close session';
      setStatus('Close failed: ' + e.message, 'error');
    }
  });
}

function closeStatsModal() {
  document.getElementById('statsModal').style.display = 'none';
}

// --- File view (main-pane takeover) ---
// Opens a file mentioned in the chat (clickable .file-link spans) in place
// of the transcript, same pattern as the diff view. The server resolves the
// mention against the session's tool calls — see GET /api/sessions/:id/file.
// Markdown renders rendered; code highlights; images display inline. The
// raw text is kept for the copy button.
let fileViewRaw = null;
let fileViewAbsPath = null; // resolved path of the viewed file (publish target)
let fileViewRelPath = null;
let anchoredCommentDraft = null;
let commentAnchorRange = null;
let commentDraftVersion = 0;

function isFileViewOpen() {
  return document.getElementById('sessionView').classList.contains('file-open');
}

async function openFileViewer(mention) {
  if (!currentSession) return;
  const body = document.getElementById('fileViewBody');
  const title = document.getElementById('fileViewTitle');
  const pathEl = document.getElementById('fileViewPath');
  fileViewRaw = null;
  fileViewAbsPath = null;
  fileViewRelPath = null;
  closeCommentBubble();
  document.getElementById('fileViewPublish').style.display = 'none';
  renderFilePageRow(null);
  title.textContent = mention.replace(/:\d+(?::\d+)?$/, '').split('/').pop();
  pathEl.textContent = '';
  pathEl.title = '';
  body.innerHTML = '<div class="loading">Loading…</div>';
  closeDiffView(); // the two takeover panes are mutually exclusive
  document.getElementById('sessionView').classList.add('file-open');
  try {
    const res = await fetch(`/api/sessions/${currentSession.id}/file?path=${encodeURIComponent(mention)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    title.textContent = data.path.split('/').pop();
    fileViewAbsPath = data.path;
    fileViewRelPath = data.relPath;
    document.getElementById('fileViewPublish').style.display = '';
    // Already published (by the agent or a previous click)? Show its link.
    fetch('/api/pages')
      .then((r) => r.json())
      .then((list) => {
        if (fileViewAbsPath !== data.path) return; // view moved on
        const page = Array.isArray(list) && list.find((p) => p.root === data.path);
        if (page) renderFilePageRow(page);
      })
      .catch(() => {});
    const kb = data.size >= 10240 ? `${Math.round(data.size / 1024)} KB` : `${data.size} B`;
    pathEl.textContent = `${shortCwd(data.path)} · ${kb}${data.truncated ? ' · truncated preview' : ''}`;
    pathEl.title = data.path;
    if (data.image) {
      const src = data.image.url || `data:${data.image.mimeType};base64,${data.image.data}`;
      body.innerHTML = `<img class="file-view-img" src="${escapeHtml(src)}" decoding="async" alt="">`;
      return;
    }
    fileViewRaw = data.content;
    const ext = (data.path.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
    if (ext === 'md' || ext === 'markdown') {
      body.innerHTML = `<div class="markdown-body">${formatMarkdown(data.content)}</div>`;
    } else {
      // Skip hljs on huge files (data-highlighted makes applyHighlight leave
      // it alone) — highlighting half a megabyte janks phones.
      const skipHl = data.content.length > 80000 ? ' data-highlighted="skip"' : '';
      const lang = ext ? ` class="language-${escapeHtml(ext)}"` : '';
      body.innerHTML = `<div class="markdown-body"><pre><code${lang}${skipHl}>${escapeHtml(data.content)}</code></pre></div>`;
    }
    // Same post-pass as the transcript: copy buttons, highlighting — and a
    // markdown file's own file references become clickable in turn.
    applyHighlight(body);
  } catch (e) {
    body.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}

function closeFileView() {
  document.getElementById('sessionView').classList.remove('file-open');
  document.getElementById('fileViewBody').innerHTML = '';
  fileViewRaw = null;
  fileViewAbsPath = null;
  fileViewRelPath = null;
  closeCommentBubble();
  renderFilePageRow(null);
}

// --- Anchored review comments (file + diff views) ---
// A valid selection immediately opens a compact composer beside it.
// Files/prose use a quote with surrounding text; diffs add old/new line
// coordinates parsed from the unified hunk.

function selectionTextAnchor(root, range) {
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(root);
  after.setStart(range.endContainer, range.endOffset);
  return {
    type: 'text',
    // Keep the exact selected extent. Trimming would leave prefix/suffix
    // relative to different boundaries and break exact re-anchoring.
    quote: range.toString(),
    prefix: before.toString().slice(-300),
    suffix: after.toString().slice(0, 300),
  };
}

function isCommentBubbleOpen() {
  return document.getElementById('commentBubble').style.display !== 'none';
}

function captureFileCommentSelection(focusComposer = false) {
  if (isCommentBubbleOpen()) return;
  if (!isFileViewOpen() || !fileViewAbsPath || fileViewRaw == null) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const root = document.getElementById('fileViewBody');
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const selectedText = range.toString();
  if (!selectedText.trim() || selectedText.length > 12000) return;
  const anchor = selectionTextAnchor(root, range);

  // Plain text/code previews preserve file text exactly, so add line numbers
  // when the selected quote is unambiguous. Markdown still has the durable
  // quote/prefix/suffix selector after rendering removed its source markup.
  const first = fileViewRaw.indexOf(anchor.quote);
  if (first >= 0 && fileViewRaw.indexOf(anchor.quote, first + 1) < 0) {
    anchor.startLine = fileViewRaw.slice(0, first).split('\n').length;
    anchor.endLine = anchor.startLine + anchor.quote.split('\n').length - 1;
  }
  openCommentBubble({
    sessionId: currentSession.id,
    quote: anchor.quote,
    target: { kind: 'file', path: fileViewAbsPath, relPath: fileViewRelPath, anchor },
  }, range, focusComposer);
}

function captureDiffCommentSelection(focusComposer = false) {
  if (isCommentBubbleOpen()) return;
  if (!isDiffViewOpen()) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const patch = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest('.diff-patch');
  if (!patch) return;
  const lines = [...patch.querySelectorAll('.diff-line[data-diff-line="1"]:not(.diff-hunk)')]
    .filter((line) => { try { return range.intersectsNode(line); } catch { return false; } });
  if (!lines.length) return;
  const nums = (key) => lines.map((line) => Number(line.dataset[key])).filter((n) => Number.isInteger(n) && n > 0);
  const oldNums = nums('oldLine');
  const newNums = nums('newLine');
  const quote = lines.map((line) => line.textContent).join('\n').slice(0, 12000);
  openCommentBubble({
    sessionId: currentSession.id,
    quote,
    target: {
      kind: 'diff', repo: patch.dataset.repo, path: patch.dataset.path,
      oldPath: patch.dataset.oldPath || null,
      anchor: {
        type: 'lines', quote,
        ...(oldNums.length ? { oldStart: Math.min(...oldNums), oldEnd: Math.max(...oldNums) } : {}),
        ...(newNums.length ? { newStart: Math.min(...newNums), newEnd: Math.max(...newNums) } : {}),
      },
    },
  }, range, focusComposer);
}

function initCommentSelections() {
  const fileBody = document.getElementById('fileViewBody');
  const diffBody = document.getElementById('diffViewBody');
  fileBody.addEventListener('pointerup', () => setTimeout(captureFileCommentSelection, 0));
  diffBody.addEventListener('pointerup', () => setTimeout(captureDiffCommentSelection, 0));
  fileBody.addEventListener('scroll', positionCommentBubble);
  diffBody.addEventListener('scroll', positionCommentBubble);
  document.addEventListener('keyup', (event) => {
    if (!event.shiftKey) return;
    if (isFileViewOpen()) setTimeout(() => captureFileCommentSelection(true), 0);
    else if (isDiffViewOpen()) setTimeout(() => captureDiffCommentSelection(true), 0);
  });
  const reposition = () => positionCommentBubble();
  window.addEventListener('resize', reposition);
  window.visualViewport?.addEventListener('resize', reposition);
  window.visualViewport?.addEventListener('scroll', reposition);
  if (window.ResizeObserver) {
    new ResizeObserver(reposition).observe(document.getElementById('commentBubble'));
  }
}

function positionCommentBubble() {
  const bubble = document.getElementById('commentBubble');
  if (!commentAnchorRange || bubble.style.display === 'none') return;
  let selectionRect;
  try { selectionRect = commentAnchorRange.getBoundingClientRect(); }
  catch { return; }
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || innerWidth;
  const viewportHeight = viewport?.height || innerHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const margin = 8;
  const gap = 8;
  bubble.style.maxWidth = `${Math.max(0, viewportWidth - margin * 2)}px`;
  bubble.style.maxHeight = `${Math.max(0, viewportHeight - margin * 2)}px`;
  const width = bubble.offsetWidth;
  const height = bubble.offsetHeight;
  const left = Math.max(viewportLeft + margin, Math.min(
    viewportRight - width - margin,
    selectionRect.left + (selectionRect.width - width) / 2,
  ));
  const below = selectionRect.bottom + gap;
  const preferredTop = below + height <= viewportBottom - margin
    ? below
    : selectionRect.top - height - gap;
  const top = Math.max(viewportTop + margin, Math.min(
    viewportBottom - height - margin,
    preferredTop,
  ));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function openCommentBubble(draft, range, focusComposer = false) {
  if (!draft) return;
  anchoredCommentDraft = draft;
  commentAnchorRange = range.cloneRange();
  commentDraftVersion += 1;
  document.getElementById('commentAnchorPreview').textContent = draft.quote;
  document.getElementById('commentBody').value = '';
  document.getElementById('commentStatus').textContent = '';
  document.getElementById('commentSendBtn').disabled = false;
  const bubble = document.getElementById('commentBubble');
  bubble.style.display = 'block';
  positionCommentBubble();
  if (focusComposer) {
    document.getElementById('commentBody').focus();
    setTimeout(positionCommentBubble, 0);
  }
}

function closeCommentBubble() {
  document.getElementById('commentBubble').style.display = 'none';
  document.getElementById('commentStatus').textContent = '';
  anchoredCommentDraft = null;
  commentAnchorRange = null;
  commentDraftVersion += 1;
}

function handleCommentKey(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    submitAnchoredComment();
  }
}

async function submitAnchoredComment() {
  if (!anchoredCommentDraft) return;
  const draft = anchoredCommentDraft;
  const draftVersion = commentDraftVersion;
  const body = document.getElementById('commentBody').value.trim();
  if (!body) return document.getElementById('commentBody').focus();
  const button = document.getElementById('commentSendBtn');
  button.disabled = true;
  document.getElementById('commentStatus').textContent = 'Saving…';
  try {
    const response = await fetch('/api/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: draft.sessionId,
        body,
        target: draft.target,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    if (draftVersion === commentDraftVersion && anchoredCommentDraft === draft) {
      closeCommentBubble();
      window.getSelection()?.removeAllRanges();
    }
    setStatus('Comment saved');
  } catch (error) {
    if (draftVersion === commentDraftVersion) {
      document.getElementById('commentStatus').textContent = error.message;
    }
  } finally {
    if (draftVersion === commentDraftVersion) button.disabled = false;
  }
}

// --- Published pages (file viewer + stats modal) ---
// The agent's flow is the API itself (write plan.html, then
// `curl -X POST …/api/pages`); these are the user-initiated equivalents:
// 🌐 in the file viewer publishes the viewed file, the stats modal lists a
// session's published pages with copy/revoke.

function renderFilePageRow(page) {
  const el = document.getElementById('fileViewPage');
  if (!page) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const link = page.url || (location.origin + page.path);
  el.style.display = '';
  el.innerHTML = 'Published: ' +
    `<button type="button" class="stats-copy stats-share-link" data-copy="${escapeHtml(link)}" title="Click to copy">${escapeHtml(link)}</button>` +
    '<button type="button" class="btn-small btn-danger" id="filePageRevoke">Unpublish</button>';
  el.querySelector('.stats-copy').addEventListener('click', function () {
    copyTextToClipboard(this.dataset.copy).then(
      () => setStatus('Page link copied'),
      () => setStatus('Copy failed (clipboard blocked)', 'error'),
    );
  });
  el.querySelector('#filePageRevoke').addEventListener('click', () => {
    fetch(`/api/pages/${encodeURIComponent(page.token)}`, { method: 'DELETE' })
      .then(() => { renderFilePageRow(null); refreshArtifacts(currentSession?.id); })
      .catch((e) => setStatus('Failed to unpublish: ' + e.message, 'error'));
  });
}

async function publishFileView() {
  if (!fileViewAbsPath || !currentSession) return;
  try {
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: fileViewAbsPath,
        sessionId: currentSession.id,
        title: fileViewAbsPath.split('/').pop(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderFilePageRow(data);
    refreshArtifacts(currentSession.id);
  } catch (e) {
    setStatus('Publish failed: ' + e.message, 'error');
  }
}

// Published pages section of the stats modal (only rendered when non-empty —
// most sessions publish nothing and don't need the visual noise).
function loadPagesSection(sessionId) {
  const el = document.getElementById('statsPages');
  if (!el) return;
  fetch(`/api/pages?sessionId=${encodeURIComponent(sessionId)}`)
    .then((r) => r.json())
    .then((list) => {
      if (!Array.isArray(list) || !list.length) { el.innerHTML = ''; return; }
      el.innerHTML = '<div class="stats-share-title">Published pages</div>' +
        list.map((p) => {
          const link = p.url || (location.origin + p.path);
          const label = p.title || p.root.split('/').pop();
          return `<div class="stats-page-row" data-token="${escapeHtml(p.token)}">` +
            `<span class="stats-page-name" title="${escapeHtml(p.root)}">${escapeHtml(label)}${p.missing ? ' <span class="stats-page-missing">(file missing)</span>' : ''}</span>` +
            `<button type="button" class="stats-copy stats-share-link" data-copy="${escapeHtml(link)}" title="Click to copy">${escapeHtml(link)}</button>` +
            '<button type="button" class="btn-small btn-danger stats-page-revoke">Revoke</button></div>';
        }).join('');
      el.querySelectorAll('.stats-page-revoke').forEach((btn) => {
        btn.addEventListener('click', () => {
          const token = btn.closest('.stats-page-row').dataset.token;
          fetch(`/api/pages/${encodeURIComponent(token)}`, { method: 'DELETE' })
            .then(() => { loadPagesSection(sessionId); refreshArtifacts(sessionId); })
            .catch((e) => setStatus('Failed to revoke: ' + e.message, 'error'));
        });
      });
    })
    .catch(() => { el.innerHTML = ''; });
}

// --- Shared artifacts (header 📦: everything published/shared from the
// session in one place) ---
// Pages the agent (or the file viewer's 🌐) published plus the session share
// link. The badge count keeps them discoverable without opening the stats
// modal; refreshed on session select, turn end (agents publish mid-turn),
// and after any publish/revoke in the UI.
let sessionArtifacts = { pages: [], share: null };
let artifactsSeq = 0; // drops stale responses on fast session switches

async function refreshArtifacts(sessionId) {
  if (!sessionId) return;
  const seq = ++artifactsSeq;
  try {
    const [pagesRes, shareRes] = await Promise.all([
      fetch(`/api/pages?sessionId=${encodeURIComponent(sessionId)}`),
      fetch(`/api/sessions/${sessionId}/share`),
    ]);
    const pages = pagesRes.ok ? await pagesRes.json() : [];
    const share = (shareRes.ok && shareRes.status !== 404) ? await shareRes.json() : null;
    if (seq !== artifactsSeq || currentSession?.id !== sessionId) return;
    sessionArtifacts = { pages: Array.isArray(pages) ? pages : [], share };
    updateArtifactsBadge();
    if (document.getElementById('artifactsModal').style.display !== 'none') renderArtifactsModal();
  } catch {}
}

function updateArtifactsBadge() {
  const n = sessionArtifacts.pages.length + (sessionArtifacts.share ? 1 : 0);
  const btn = document.getElementById('btnArtifacts');
  const row = document.getElementById('cpArtifactsRow');
  if (btn) {
    btn.style.display = n ? '' : 'none';
    document.getElementById('artifactCount').textContent = n;
  }
  if (row) {
    row.style.display = n ? '' : 'none';
    document.getElementById('artifactCountMobile').textContent = String(n);
  }
}

function openArtifactsModal() {
  if (!currentSession) return;
  document.getElementById('artifactsModal').style.display = 'flex';
  renderArtifactsModal();
  refreshArtifacts(currentSession.id);
}

function closeArtifactsModal() {
  document.getElementById('artifactsModal').style.display = 'none';
}

function renderArtifactsModal() {
  const body = document.getElementById('artifactsBody');
  if (!body) return;
  const { pages, share } = sessionArtifacts;
  if (!pages.length && !share) {
    body.innerHTML = '<div class="stats-share-hint">Nothing shared from this session yet — published pages and share links show up here.</div>';
    return;
  }
  let html = '';
  if (pages.length) {
    html += '<div class="stats-share-title">Published pages</div>' + pages.map((p) => {
      const link = p.url || (location.origin + p.path);
      const label = p.title || p.root.split('/').pop();
      return `<div class="artifact-row">
        <a class="artifact-link" href="${escapeHtml(link)}" target="_blank" rel="noopener" title="${escapeHtml(p.root)}">${escapeHtml(label)}</a>
        ${p.missing ? '<span class="stats-page-missing">(file missing)</span>' : ''}
        <span class="artifact-meta">${escapeHtml(formatRelativeTime(p.createdAt))}</span>
        <button type="button" class="btn-icon artifact-copy" data-copy="${escapeHtml(link)}" title="Copy link">⧉</button>
        <button type="button" class="btn-small btn-danger artifact-revoke" data-token="${escapeHtml(p.token)}">Revoke</button>
      </div>`;
    }).join('');
  }
  if (share) {
    const link = share.url || (location.origin + share.path);
    html += '<div class="stats-share-title">Session share link</div>' +
      `<div class="artifact-row">
        <a class="artifact-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">Read-only transcript</a>
        <span class="artifact-meta"></span>
        <button type="button" class="btn-icon artifact-copy" data-copy="${escapeHtml(link)}" title="Copy link">⧉</button>
      </div>`;
  }
  body.innerHTML = html;
  body.querySelectorAll('.artifact-copy').forEach((btn) => btn.addEventListener('click', () => {
    copyTextToClipboard(btn.dataset.copy).then(
      () => setStatus('Link copied'),
      () => setStatus('Copy failed (clipboard blocked)', 'error'),
    );
  }));
  body.querySelectorAll('.artifact-revoke').forEach((btn) => btn.addEventListener('click', () => {
    fetch(`/api/pages/${encodeURIComponent(btn.dataset.token)}`, { method: 'DELETE' })
      .then(() => refreshArtifacts(currentSession?.id))
      .catch((e) => setStatus('Failed to revoke: ' + e.message, 'error'));
  }));
}

function copyFileViewContent(btn) {
  if (fileViewRaw == null) return;
  copyTextToClipboard(fileViewRaw).then(
    () => { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '⧉'; }, 1200); },
    () => setStatus('Copy failed (clipboard blocked)', 'error'),
  );
}

// --- Diff view (main-pane takeover) ---
// Aggregate uncommitted changes for every git repo under the session cwd
// (GET /api/sessions/:id/diff — polyrepo workspaces hold several checkouts
// side by side). The ± header button swaps the transcript for this view;
// `.session-view.diff-open` does the hiding in CSS. Fetched on open and on
// the ⟳ button; no polling. Closed by ✕/Escape/session switch.
function isDiffViewOpen() {
  return document.getElementById('sessionView').classList.contains('diff-open');
}

function toggleDiffView() {
  if (isDiffViewOpen()) closeDiffView();
  else openDiffView();
}

async function openDiffView() {
  if (!currentSession) return;
  closeFileView(); // the two takeover panes are mutually exclusive
  document.getElementById('sessionView').classList.add('diff-open');
  document.getElementById('btnDiff')?.classList.add('active');
  await loadDiffView();
}

function closeDiffView() {
  document.getElementById('sessionView').classList.remove('diff-open');
  document.getElementById('btnDiff')?.classList.remove('active');
  document.getElementById('diffViewBody').innerHTML = '';
  closeCommentBubble();
}

async function loadDiffView() {
  const body = document.getElementById('diffViewBody');
  const rootEl = document.getElementById('diffViewRoot');
  closeCommentBubble();
  body.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const res = await fetch(`/api/sessions/${currentSession.id}/diff`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    rootEl.textContent = shortCwd(data.root);
    body.innerHTML = renderDiffViewHtml(data);
    body.querySelectorAll('details.diff-file').forEach(details => {
      details.addEventListener('toggle', () => {
        if (details.open) loadDeferredDiffPatch(details);
      });
    });
  } catch (e) {
    body.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}

function renderDiffViewHtml(data) {
  if (!data.gitAvailable) return '<div class="diff-empty">git is not available on the server</div>';
  if (!data.repos.length) return '<div class="diff-empty">No git repositories under this session\'s cwd</div>';

  const dirty = data.repos.filter(r => r.files.length > 0 || r.error);
  const clean = data.repos.filter(r => r.files.length === 0 && !r.error);
  // Few files → open every patch; a big changeset starts collapsed.
  const totalFiles = dirty.reduce((n, r) => n + r.files.length, 0);
  const openAttr = totalFiles <= 6 ? ' open' : '';

  let html = '';
  if (!dirty.length) html += '<div class="diff-empty">All repositories are clean ✓</div>';
  for (const repo of dirty) {
    const ab = (repo.ahead ? ` <span class="diff-repo-ab" title="Commits ahead of upstream">↑${repo.ahead}</span>` : '')
      + (repo.behind ? ` <span class="diff-repo-ab" title="Commits behind upstream">↓${repo.behind}</span>` : '');
    html += `<section class="diff-repo"><div class="diff-repo-header">`
      + `<span class="diff-repo-path">${escapeHtml(repo.path)}</span>`
      + (repo.branch ? `<span class="diff-repo-branch">${escapeHtml(repo.branch)}</span>` : '')
      + ab
      + `<span class="diff-repo-stat"><span class="diff-plus">+${repo.additions}</span> <span class="diff-minus">−${repo.deletions}</span></span>`
      + `</div>`;
    if (repo.error) html += `<div class="diff-repo-error">⚠ ${escapeHtml(repo.error)}</div>`;
    for (const f of repo.files) {
      const name = f.oldPath
        ? `${escapeHtml(f.oldPath)} → ${escapeHtml(f.path)}`
        : escapeHtml(f.path);
      const counts = f.binary
        ? '<span class="diff-file-note">binary</span>'
        : `<span class="diff-plus">+${f.additions}</span> <span class="diff-minus">−${f.deletions}</span>`;
      const patchAttrs = `data-repo="${escapeHtml(repo.path)}" data-path="${escapeHtml(f.path)}" data-old-path="${escapeHtml(f.oldPath || '')}"`;
      const patchHtml = f.patch
        ? `<div class="diff-patch" ${patchAttrs}>${renderDiffHtml(f.patch)}${f.truncated ? '<div class="diff-file-note">… patch truncated</div>' : ''}</div>`
        : f.patchDeferred
          ? `<div class="diff-patch" ${patchAttrs} data-deferred="1"><div class="loading">Loading patch…</div></div>`
          : `<div class="diff-file-note diff-patch-missing">${f.binary ? 'Binary file' : f.truncated ? 'Too large to preview' : 'No patch available'}</div>`;
      html += `<details class="diff-file"${f.patch ? openAttr : ''}>`
        + `<summary><span class="diff-status diff-status-${diffStatusClass(f.status)}">${escapeHtml(f.status)}</span>`
        + `<span class="diff-file-path">${name}</span>`
        + `<span class="diff-file-counts">${counts}</span></summary>`
        + patchHtml
        + `</details>`;
    }
    if (repo.moreUntracked) {
      html += `<div class="diff-file-note">… and ${repo.moreUntracked} more untracked files</div>`;
    }
    html += '</section>';
  }
  if (clean.length) {
    const names = clean.map(r =>
      escapeHtml(r.path) + (r.ahead ? ` <span class="diff-repo-ab">↑${r.ahead}</span>` : '')).join(', ');
    html += `<div class="diff-clean">clean: ${names}</div>`;
  }
  return html;
}

async function loadDeferredDiffPatch(details) {
  const patch = details.querySelector('.diff-patch[data-deferred="1"]');
  if (!patch || patch.dataset.loading || !currentSession) return;
  patch.dataset.loading = '1';
  try {
    const query = new URLSearchParams({ repo: patch.dataset.repo, path: patch.dataset.path });
    const res = await fetch(`/api/sessions/${currentSession.id}/diff/patch?${query}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    patch.innerHTML = renderDiffHtml(data.patch) +
      (data.truncated ? '<div class="diff-file-note">… patch truncated</div>' : '');
    delete patch.dataset.deferred;
    delete patch.dataset.loading;
  } catch (e) {
    delete patch.dataset.loading;
    patch.innerHTML = `<div class="diff-file-note diff-patch-missing">Could not load patch: ${escapeHtml(e.message)}. Collapse and reopen to retry.</div>`;
  }
}

// --- Export ---
function exportSession() {
  if (!currentSession) return;
  window.open(`/api/sessions/${currentSession.id}/export`, '_blank');
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
    await apiSend('/api/sessions/' + currentSession.id + '/rename', { name: newName });
    patchSession(currentSession.id, { name: newName });
  } catch (e) { setStatus('Rename failed: ' + e.message, 'error'); }
}

function cancelRename() {
  document.getElementById('sessionNameInput').style.display = 'none';
  document.getElementById('sessionName').style.display = '';
}

// --- Model dropdown ---
let modelDropdownOpen = false;
let modelEditMode = false; // scoped-models switcher: toggle which models are enabled

async function toggleModelDropdown() {
  if (!currentSession || !currentSession.isActive) return;
  await loadModels(currentSession.id);
  modelDropdownOpen = !modelDropdownOpen;
  modelEditMode = false;
  const dropdown = document.getElementById('modelDropdown');
  if (!modelDropdownOpen) { dropdown.style.display = 'none'; return; }
  // Desktop: anchored under the header button. Mobile: the stylesheet
  // positions it (full-width sheet), so just clear any desktop inline pos.
  if (window.innerWidth > 768) {
    anchorDropdown(dropdown, document.getElementById('sessionModel').getBoundingClientRect());
  } else {
    clearDropdownPos(dropdown);
  }
  renderModelDropdown('');
  dropdown.style.display = 'flex';
  var searchInput = dropdown.querySelector('.model-search');
  if (searchInput) searchInput.focus();
  armOutsideClickClose(['modelSelector', 'modelDropdown'], closeModelDropdown, () => modelDropdownOpen);
}

function isCurrentModel(m) {
  var fullId = m.provider + '/' + m.id;
  return m.id === currentSession?.model || fullId === currentSession?.model;
}

function renderModelDropdown(query) {
  var dropdown = document.getElementById('modelDropdown');
  var filtered = filterModels(query);
  var scoped = knownModels.some(m => m && m.enabled === false);
  var hidden = 0;
  if (!modelEditMode && scoped) {
    // Scoped view: only enabled models (the active one always shows).
    var visible = filtered.filter(m => m.enabled !== false || isCurrentModel(m));
    hidden = filtered.length - visible.length;
    filtered = visible;
  }
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
    if (modelEditMode) {
      // Provider header doubles as a section toggle in edit mode: ✓ all
      // enabled, – mixed, empty none. Clicking flips the listed models.
      var provOn = groups[provider].filter(m => m.enabled !== false).length;
      var provCheck = provOn === groups[provider].length ? '✓' : (provOn ? '–' : '');
      html += '<div class="model-group-header model-group-toggle" onclick="toggleProviderEnabled(\'' + escapeHtml(provider) + '\')" ' +
        'title="Toggle all ' + escapeHtml(provider) + ' models">' +
        '<span class="model-check">' + provCheck + '</span>' + escapeHtml(provider) +
        '<span class="model-group-count">' + provOn + '/' + groups[provider].length + '</span></div>';
    } else {
      html += '<div class="model-group-header">' + escapeHtml(provider) + '</div>';
    }
    groups[provider].forEach(m => {
      // One row template for both modes — edit mode adds the checkbox span,
      // the disabled dimming, and swaps the click handler.
      var fullId = m.provider + '/' + m.id;
      var badges = '';
      if (m.free) badges += '<span class="model-badge free">free</span>';
      if (m.reasoning) badges += '<span class="model-badge reasoning">🧠</span>';
      var on = m.enabled !== false;
      var cls = 'model-option' + (isCurrentModel(m) ? ' active' : '') + (modelEditMode && !on ? ' disabled' : '');
      var check = modelEditMode ? '<span class="model-check">' + (on ? '✓' : '') + '</span>' : '';
      var handler = modelEditMode ? 'toggleModelEnabled' : 'selectModel';
      var context = m.contextWindow ? formatTokens(m.contextWindow) + ' context' : 'context unknown';
      html += '<div class="' + cls + '" onclick="' + handler + '(\'' + escapeHtml(fullId) + '\')" title="' +
        escapeHtml(fullId) + '">' + check + '<span class="model-option-copy"><span class="model-option-name">' + escapeHtml(m.id) + '</span><span class="model-option-context">' + escapeHtml(context) + '</span></span>' + badges + '</div>';
    });
  });
  if (!filtered.length) html += '<div class="model-option" style="color:var(--text-muted);cursor:default">No models found</div>';
  var scrollTop = results.scrollTop;
  results.innerHTML = html;
  results.scrollTop = scrollTop;
  renderModelDropdownFooter(dropdown, hidden);
}

// Footer: entry point to the scoped-models switcher (pi's /scoped-models) and
// its All/None/Done actions while editing.
function renderModelDropdownFooter(dropdown, hidden) {
  var footer = dropdown.querySelector('.model-dropdown-footer');
  if (!footer) { footer = document.createElement('div'); footer.className = 'model-dropdown-footer'; dropdown.appendChild(footer); }
  var html = '';
  if (modelEditMode) {
    var enabledCount = knownModels.filter(m => m && m.enabled !== false).length;
    html += '<span class="model-footer-info">' + enabledCount + ' of ' + knownModels.length + ' enabled</span>';
    html += '<button class="model-footer-btn" onclick="setAllModelsEnabled(true)">All</button>';
    html += '<button class="model-footer-btn" onclick="setAllModelsEnabled(false)">None</button>';
    html += '<button class="model-footer-btn primary" onclick="exitModelEditMode()">Done</button>';
  } else {
    if (hidden > 0) html += '<span class="model-footer-info">' + hidden + ' hidden</span>';
    html += '<button class="model-footer-btn" onclick="enterModelEditMode()" title="Choose which models are enabled (pi scoped models)">⚙ Edit models</button>';
  }
  footer.innerHTML = html;
}

function enterModelEditMode() {
  modelEditMode = true;
  renderModelDropdown(currentModelQuery());
}

function exitModelEditMode() {
  modelEditMode = false;
  renderModelDropdown(currentModelQuery());
}

function currentModelQuery() {
  var input = document.getElementById('modelDropdown').querySelector('.model-search');
  return input ? input.value : '';
}

function toggleModelEnabled(fullId) {
  var model = knownModels.find(m => m && (m.provider + '/' + m.id) === fullId);
  if (!model) return;
  model.enabled = model.enabled === false;
  renderModelDropdown(currentModelQuery());
  saveEnabledModels();
}

function setAllModelsEnabled(enabled) {
  knownModels.forEach(m => { if (m) m.enabled = enabled; });
  renderModelDropdown(currentModelQuery());
  saveEnabledModels();
}

// Flip a whole provider section. Operates on the models the header is
// currently listing (i.e. respects the search filter): all on → all off,
// anything less → all on.
function toggleProviderEnabled(provider) {
  var listed = filterModels(currentModelQuery()).filter(m => m && m.provider === provider);
  if (!listed.length) return;
  var allOn = listed.every(m => m.enabled !== false);
  listed.forEach(m => { m.enabled = !allOn; });
  renderModelDropdown(currentModelQuery());
  saveEnabledModels();
}

let saveEnabledTimer = null;
function saveEnabledModels() {
  clearTimeout(saveEnabledTimer);
  saveEnabledTimer = setTimeout(async () => {
    var enabled = knownModels.filter(m => m && m.enabled !== false);
    // Everything enabled = no filter; persist as null so pi clears enabledModels.
    var enabledIds = enabled.length === knownModels.length ? null : enabled.map(m => m.provider + '/' + m.id);
    try {
      await apiSend('/api/models/enabled', { enabledIds }, 'PUT');
    } catch (e) { setStatus('Failed to save model list: ' + e.message, 'error'); }
  }, 400);
}

function closeModelDropdown() {
  modelDropdownOpen = false;
  document.getElementById('modelDropdown').style.display = 'none';
}

async function selectModel(fullModelId) {
  closeModelDropdown();
  // Only skip on an exact provider/id match. currentSession.model is often a
  // bare id, and the same id can exist under two providers (anthropic vs a
  // Bedrock mirror) — a bare-id comparison silently swallowed those switches.
  // A redundant set_model for the truly-same model is harmless.
  var isSame = fullModelId === currentSession?.model;
  if (!currentSession || isSame) return;
  setStatus('Switching model...', 'working');
  try {
    await apiSend('/api/sessions/' + currentSession.id + '/model', { modelId: fullModelId });
    patchSession(currentSession.id, { model: fullModelId });
    setStatus('Model switched to ' + fullModelId);
  } catch (e) { setStatus('Model switch failed: ' + e.message, 'error'); }
}

// =========================================================================
// Messages
// =========================================================================

const MESSAGE_PAGE_SIZE = 50;
const TRANSCRIPT_CACHE_TTL_MS = 15 * 60 * 1000;
const TRANSCRIPT_CACHE_MAX_SESSIONS = 5;
// The session-count bound alone puts no ceiling on retained DOM — one
// deep-scrolled transcript can hold thousands of highlighted messages. Cap
// each stash at its newest messages; trimmed history re-pages in on demand.
const TRANSCRIPT_CACHE_MAX_MESSAGES = 300;
const LOAD_OLDER_SCROLL_THRESHOLD = 200;

// Pagination cursors for the currently loaded session.
let oldestLoadedIndex = null;
let lastLoadedIndex = null;
let hasMoreOlder = false;
let totalMessages = 0;
let loadingOlder = false;

// Recently viewed transcript DOM, including every page the reader explicitly
// loaded. Moving nodes into a DocumentFragment preserves expensive markdown,
// highlighting, open tool groups, and image elements without serializing or
// re-downloading them. The bounded TTL/LRU policy keeps that convenience from
// turning a tour through many large sessions into unbounded memory growth.
const transcriptCache = new Map();

function pruneTranscriptCache(skipId) {
  const now = Date.now();
  for (const [id, entry] of transcriptCache) {
    if (id !== skipId && now - entry.lastUsed > TRANSCRIPT_CACHE_TTL_MS) transcriptCache.delete(id);
  }
  while (transcriptCache.size > TRANSCRIPT_CACHE_MAX_SESSIONS) {
    const oldest = [...transcriptCache.entries()]
      .filter(([id]) => id !== skipId)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (!oldest) break;
    transcriptCache.delete(oldest[0]);
  }
}

function stashCurrentTranscript() {
  const id = currentSession?.id;
  const container = document.getElementById('messages');
  if (!id || !container || lastLoadedIndex == null || container.querySelector('.loading, .error')) return;
  const scrollTop = container.scrollTop;
  const mood = document.getElementById('moodIndicator');
  const fragment = transcriptCache.get(id)?.fragment || document.createDocumentFragment();
  fragment.replaceChildren();
  while (container.firstChild) fragment.appendChild(container.firstChild);
  const entry = {
    fragment,
    oldestLoadedIndex,
    lastLoadedIndex,
    hasMoreOlder,
    totalMessages,
    scrollTop,
    moodDescription: mood?.dataset.moodDescription || '',
    moodFace: mood?.dataset.moodFace || '',
    lastUsed: Date.now(),
  };
  trimStashedTranscript(entry);
  transcriptCache.set(id, entry);
  pruneTranscriptCache(id);
}

// Drop a stash's oldest messages past the cap and re-point its older-page
// cursor at the oldest survivor, so a restore pages the trimmed history back
// in through the normal top-of-feed path (the load-older bar goes with the
// trimmed nodes; the first implicit page-in re-renders it with a fresh count).
function trimStashedTranscript(entry) {
  const { fragment } = entry;
  const indexed = fragment.querySelectorAll('[data-msg-index]');
  if (indexed.length <= TRANSCRIPT_CACHE_MAX_MESSAGES) return;
  // Cut at the top-level ancestor of the oldest kept message — messages
  // folded into a tool-group must move (or stay) with their group.
  let keep = indexed[indexed.length - TRANSCRIPT_CACHE_MAX_MESSAGES];
  while (keep.parentNode && keep.parentNode !== fragment) keep = keep.parentNode;
  while (fragment.firstChild && fragment.firstChild !== keep) fragment.firstChild.remove();
  const first = fragment.querySelector('[data-msg-index]');
  const firstIndex = first ? parseInt(first.dataset.msgIndex, 10) : NaN;
  if (Number.isNaN(firstIndex)) return;
  entry.oldestLoadedIndex = firstIndex;
  entry.hasMoreOlder = firstIndex > 0;
}

function restoreCachedTranscript(id) {
  const cached = transcriptCache.get(id);
  if (!cached) return false;
  if (Date.now() - cached.lastUsed > TRANSCRIPT_CACHE_TTL_MS) {
    transcriptCache.delete(id);
    return false;
  }
  const container = document.getElementById('messages');
  if (!container || !cached.fragment.childNodes.length) return false;
  container.replaceChildren(cached.fragment);
  oldestLoadedIndex = cached.oldestLoadedIndex;
  lastLoadedIndex = cached.lastLoadedIndex;
  hasMoreOlder = cached.hasMoreOlder;
  totalMessages = cached.totalMessages;
  cached.lastUsed = Date.now();
  setMoodIndicator(cached.moodDescription, cached.moodFace);
  container.scrollTop = cached.scrollTop;
  updateJumpButton(container);
  pruneTranscriptCache(id);
  return true;
}

function maybeLoadOlderMessages(container) {
  if (container?.scrollTop <= LOAD_OLDER_SCROLL_THRESHOLD) loadOlderMessages();
}

function renderMessageHtml(msg) {
  const time = msg.timestamp ? formatTime(msg.timestamp) : '';
  // The stream index rides on the root element — dedup, tool grouping, and
  // search jumps all key on data-msg-index. Passed into the renderers rather
  // than string-spliced into their output afterwards.
  const idxAttr = (msg.index != null) ? ` data-msg-index="${msg.index}"` : '';
  if (msg.role === 'user') return renderUserMessage(msg, time, idxAttr);
  if (msg.role === 'assistant') return renderAssistantMessage(msg, time, { attrs: idxAttr });
  if (msg.role === 'toolResult') return renderToolResult(msg, time, idxAttr);
  if (msg.role === 'branchSummary') return renderBranchSummary(msg, time, idxAttr);
  return '';
}

async function loadMessages(id) {
  cancelStreamingRender();
  closeSearch();
  const container = document.getElementById('messages');
  if (restoreCachedTranscript(id)) {
    // Keep the warm pages visible while checking for anything appended since
    // this session was last viewed. Inactive sessions have no SSE init to do
    // this catch-up for them.
    await fetchNewMessagesSince(id);
    return;
  }
  container.innerHTML = '<div class="loading">Loading...</div>';
  oldestLoadedIndex = null;
  lastLoadedIndex = null;
  hasMoreOlder = false;
  totalMessages = 0;
  // Mood is per-session; clear here (not in renderMessages) so a tail page
  // without a set_mood call doesn't wipe a mood set earlier in the session.
  setMoodIndicator('', '');
  try {
    const res = await fetch(`/api/sessions/${id}/messages?limit=${MESSAGE_PAGE_SIZE}`);
    const data = await res.json();
    // A newer selection may have superseded us while the fetch was in flight —
    // don't clobber its transcript/cursors with this stale response.
    if (currentSession?.id !== id) return;
    const { messages, session, firstIndex, lastIndex, hasMore, totalMessages: total } = data;
    mergeCurrentSession(id, session);
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
  updateMoodFromMessages(messages);
  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 48px;"><p style="color: var(--text-muted);">No messages yet</p></div>';
    return;
  }
  container.innerHTML = renderLoadOlderBar() + messages.map(renderMessageHtml).join('');
  finalizeRender(container);
  scrollToBottom(container); // fresh session load: start at the latest message
}

async function loadOlderMessages() {
  if (loadingOlder || !hasMoreOlder || !currentSession || oldestLoadedIndex == null) return;
  loadingOlder = true;
  const sessionId = currentSession.id;
  const beforeIndex = oldestLoadedIndex;
  const container = document.getElementById('messages');
  const bar = document.getElementById('loadOlderBar');
  if (bar) bar.querySelector('.load-older-btn').textContent = 'Loading...';

  // Anchor scroll to the first existing message so the viewport doesn't jump
  // when we prepend older content.
  // Top-level children only: a message folded into a closed tool-group has
  // no box, so its rect can't anchor the scroll restore.
  const anchor = container.querySelector(':scope > .message, :scope > details.tool-group');
  const anchorOffset = anchor ? anchor.getBoundingClientRect().top : 0;

  try {
    const res = await fetch(`/api/sessions/${sessionId}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${beforeIndex}`);
    const data = await res.json();
    // The request belongs to the transcript that initiated it. A quick
    // session switch must not prepend those messages into the new session.
    if (currentSession?.id !== sessionId) return;
    const { messages, firstIndex, hasMore } = data;
    if (messages && messages.length) {
      const html = messages.map(renderMessageHtml).join('');
      // Replace the existing bar (if any) with the new bar + prepended messages.
      const existingBar = container.querySelector('#loadOlderBar');
      if (existingBar) existingBar.remove();
      oldestLoadedIndex = firstIndex != null ? firstIndex : oldestLoadedIndex;
      hasMoreOlder = !!hasMore;
      container.insertAdjacentHTML('afterbegin', renderLoadOlderBar() + html);
      finalizeRender(container, { stripLive: false });
      // Paging back can reveal the session's most recent set_mood when the
      // tail page had none — backfill only, never override a shown mood
      // (anything in this page is older than what's already displayed).
      if (!document.getElementById('moodIndicator')) updateMoodFromMessages(messages);

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
    // Bail if the user switched sessions while this catch-up was in flight.
    if (currentSession?.id !== sessionId) return;
    const { messages, lastIndex, totalMessages: total, session } = data;
    mergeCurrentSession(sessionId, session);
    if (typeof total === 'number') totalMessages = total;
    if (!messages || messages.length === 0) return;

    const container = document.getElementById('messages');
    if (!container) return;

    // Skip indices we already rendered (defensive — server uses strict >).
    const existing = new Set();
    container.querySelectorAll('[data-msg-index]').forEach(el => existing.add(parseInt(el.dataset.msgIndex, 10)));
    const fresh = messages.filter(m => !existing.has(m.index));
    updateMoodFromMessages(fresh);
    if (fresh.length === 0) {
      if (lastIndex != null) lastLoadedIndex = lastIndex;
      return;
    }

    // Now that we have authoritative JSONL versions, strip optimistic
    // (non-indexed) message DOM. Streaming placeholders + the optimistic
    // user echo get replaced by their indexed counterparts. Exception: keep
    // the finalized assistant render until a batch actually carries an
    // assistant message — a batch of tool messages only (JSONL flush lagging
    // turn_end) must not blank the answer, the vanishing-text mode the
    // streaming pipeline is designed to avoid.
    const wasPinned = isPinnedToBottom(container);
    const freshHasAssistant = fresh.some(m => m.role === 'assistant');
    container.querySelectorAll('.message:not([data-msg-index])').forEach(el => {
      if (el.classList.contains('assistant') && !freshHasAssistant) return;
      el.remove();
    });

    container.insertAdjacentHTML('beforeend', fresh.map(renderMessageHtml).join(''));
    if (lastIndex != null) lastLoadedIndex = lastIndex;
    finalizeRender(container);
    if (wasPinned) scrollToBottom(container); else updateJumpButton(container);
  } catch (e) {
    console.error('fetchNewMessagesSince failed:', e);
  }
}

// Image content blocks → a `.msg-images` thumbnail row (empty string when
// none), shared by user messages, tool results, and live tool panels so the
// tap-to-zoom lightbox delegation works everywhere. Escape both the mime type
// and the data before dropping them into the attribute — well-formed base64
// has no HTML-special chars so escaping is a no-op for it, but malformed data
// must not be able to break out of the src attribute.
function imageBlocksHtml(content, alt = 'image') {
  const images = extractImageBlocks(content);
  if (!images.length) return '';
  const imgs = images.map(img => {
    const src = img.url || `data:${img.mimeType};base64,${img.data}`;
    const loading = img.url ? ' loading="lazy" decoding="async"' : '';
    return `<img class="msg-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${loading}>`;
  }).join('');
  return `<div class="msg-images">${imgs}</div>`;
}

// Hover 🔗 on a turn header: copies the public share URL deep-linked to this
// message (pi's HTML export scrolls to ?targetId=<JSONL entry id>). Only
// JSONL-backed messages have an entry id — streaming placeholders don't.
function messageLinkBtnHtml(msg) {
  if (!msg.id) return '';
  return `<button type="button" class="msg-link-btn" data-entry-id="${escapeHtml(msg.id)}" title="Copy share link to this message">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg></button>`;
}

function renderUserMessage(msg, time, attrs = '') {
  const text = extractTextContent(msg.content);
  const imagesHtml = imageBlocksHtml(msg.content, 'attached image');
  return `<div${attrs} class="message user">
    <div class="message-header"><span class="message-role user">❯</span>${time ? `<span class="message-time">${time}</span>` : ''}${messageLinkBtnHtml(msg)}</div>
    <div class="message-content user-content">${text ? `<div class="markdown-body">${formatMarkdown(text)}</div>` : ''}${imagesHtml}</div>
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
  // Tool-only messages (no prose, no error) are fully hidden in focus mode —
  // without this their empty header row lingers as a stray marker.
  const noTextClass = messageHasVisibleText(msg) ? '' : ' no-text';
  // Effective response speed rides the header next to the time — JSONL-backed
  // renders only (streaming messages have no timing until finalized).
  let speedHtml = '';
  const hasMetadata = !opts.streaming && (msg.usage || msg.durationMs);
  const detail = hasMetadata ? responseDetailProjection(msg) : null;
  const metadata = detail ? formatResponseMetadata(detail, responseMetadataMode) : null;
  if (hasMetadata) {
    const detailId = `response-${++responseDetailSeq}`;
    // Keep only the small telemetry projection the detail modal consumes;
    // retaining full message content here would pin every transcript render.
    responseDetails.set(detailId, detail);
    if (responseDetails.size > 2000) responseDetails.delete(responseDetails.keys().next().value);
    speedHtml = `<button type="button" class="message-speed message-metadata-btn" data-detail-id="${detailId}" title="Response details. Response time is request start to JSONL append; effective speed includes time to first token."${metadata ? '' : ' style="display:none"'}>${escapeHtml(metadata || '')}</button>`;
  }

  return `<div${opts.attrs || ''} class="message assistant${streamingClass}${noTextClass}${msg.errorMessage ? ' error' : ''}" data-timestamp="${timestamp}"${streamingAttr}>
    <div class="message-header">
      <span class="message-role assistant">π</span>
      ${showModel ? `<span class="badge">${escapeHtml(msg.model)}</span>` : ''}
      ${opts.streaming ? '<span class="badge streaming">●</span>' : ''}
      ${speedHtml}
      ${time ? `<span class="message-time">${time}</span>` : ''}
      ${messageLinkBtnHtml(msg)}
    </div>
    ${thinkingHtml}${toolCallsHtml}
    ${textHtml ? `<div class="message-content"><div class="markdown-body">${textHtml}</div></div>` : ''}
    ${errorHtml}
  </div>`;
}

function updateRenderedResponseMetadata() {
  document.querySelectorAll('.message-metadata-btn').forEach(btn => {
    const text = formatResponseMetadata(responseDetails.get(btn.dataset.detailId), responseMetadataMode);
    btn.textContent = text || '';
    btn.style.display = text ? '' : 'none';
  });
}

function responsePricingKnown(msg) {
  if (Number.isFinite(msg?.usage?.cost?.total) && msg.usage.cost.total !== 0) return true;
  const modelRef = msg?.responseModel || msg?.model || '';
  const ref = parseModelId(modelRef);
  const provider = msg?.provider || ref.provider;
  const modelId = ref.id || modelRef;
  return knownModels.some(m => m?.pricing && m.provider === provider && m.id === modelId);
}

function responseDetailProjection(msg) {
  return {
    usage: msg.usage,
    durationMs: msg.durationMs,
    outputTokens: msg.outputTokens,
    provider: msg.provider,
    model: msg.model,
    responseModel: msg.responseModel,
    stopReason: msg.stopReason,
    pricingKnown: responsePricingKnown(msg),
  };
}

function refreshResponsePricingState() {
  for (const detail of responseDetails.values()) detail.pricingKnown = responsePricingKnown(detail);
  updateRenderedResponseMetadata();
}

function openResponseDetails(id) {
  const m = responseDetails.get(id); if (!m) return;
  const u = m.usage || {}, c = u.cost || {};
  const selected = m.model || currentSession?.model || '—';
  const model = m.responseModel || selected;
  const prompt = (u.input||0)+(u.cacheRead||0)+(u.cacheWrite||0);
  const modelRows = m.responseModel && m.responseModel !== selected
    ? [['Selected model', selected], ['Response model', model]]
    : [['Model', model]];
  const rows = [
    ...modelRows, ['Provider', m.provider || '—'],
    ['Response time', m.durationMs ? formatDuration(m.durationMs) : '—'],
    ['Effective speed', formatTokSpeed(m.outputTokens || u.output, m.durationMs) || '—'],
    ['Tokens', `${formatTokens(u.input)} input · ${formatTokens(u.output)} output${u.reasoning ? ` · ${formatTokens(u.reasoning)} reasoning` : ''}`],
    ['Cache', `${formatTokens(u.cacheRead)} read · ${formatTokens(u.cacheWrite)} write${prompt ? ` · ${Math.round((u.cacheRead||0)/prompt*100)}% hit` : ''}`],
    ['Estimated input', m.pricingKnown ? formatEstimatedCost(c.input) : 'Pricing unavailable'],
    ['Estimated output', m.pricingKnown ? formatEstimatedCost(c.output) : 'Pricing unavailable'],
    ['Estimated cache read / write', m.pricingKnown ? `${formatEstimatedCost(c.cacheRead)} / ${formatEstimatedCost(c.cacheWrite)}` : 'Pricing unavailable'],
    ['Estimated total', m.pricingKnown ? formatEstimatedCost(c.total) : 'Pricing unavailable'], ['Stop reason', m.stopReason || '—'],
  ];
  document.getElementById('responseDetailsBody').innerHTML = '<div class="telemetry-note">Pi catalog estimates, not provider-billed amounts. Response time is request start → JSONL append; effective speed includes TTFT.</div><table class="stats-table">' + rows.map(([k,v]) => `<tr><td class="stats-key">${escapeHtml(k)}</td><td class="stats-val">${escapeHtml(v)}</td></tr>`).join('') + '</table>';
  document.getElementById('responseDetailsModal').style.display = 'flex';
}
function closeResponseDetails() { document.getElementById('responseDetailsModal').style.display = 'none'; }

function renderThinkingBlock(thinking) {
  const preview = thinking.substring(0, 80).replace(/\n/g, ' ');
  return `<details class="thinking-block">
    <summary class="thinking-header"><span class="thinking-label">Thinking</span><span class="thinking-preview">${escapeHtml(preview)}…</span></summary>
    <div class="thinking-text">${escapeHtml(thinking)}</div>
  </details>`;
}

function renderToolCall(block) {
  const args = block.arguments || {};
  const summary = getToolSummary(block.name, args);

  return `<details class="tool-call">
    <summary class="tool-call-header">
      <span class="tool-call-icon">⚡</span><span class="tool-call-name">${escapeHtml(block.name)}</span>
      ${summary ? `<span class="tool-call-summary">${escapeHtml(summary)}</span>` : ''}
    </summary>
    <div class="tool-call-content"><pre><code>${escapeHtml(JSON.stringify(args, null, 2))}</code></pre></div>
  </details>`;
}

function renderToolResult(msg, time, attrs = '') {
  const content = extractTextContent(msg.content);
  const isError = msg.isError;
  const timestamp = msg.timestamp || Date.now();
  const lines = content.split('\n');
  const lineCount = lines.length;
  const preview = truncate(lines[0], 80);
  // A tool result carrying an image (e.g. a `read` on a PNG) opens by default
  // regardless of line count — seeing the image is the point — and flags it in
  // the header meta so it's discoverable when collapsed.
  const images = extractImageBlocks(msg.content);
  const imageCount = images.length;
  const imagesHtml = imageBlocksHtml(msg.content, 'tool result image');

  return `<div${attrs} class="message tool-result ${isError ? 'error' : ''}" data-timestamp="${timestamp}">
    <details class="tool-result-details" ${(lineCount <= 5 || imageCount) ? 'open' : ''}>
      <summary class="tool-result-header">
        <span class="tool-result-icon">${isError ? '✗' : '✓'}</span>
        <span class="tool-result-name">${escapeHtml(msg.toolName || 'result')}</span>
        ${lineCount > 5 ? `<span class="tool-result-meta">${lineCount} lines</span>` : ''}
        ${imageCount ? `<span class="tool-result-meta">${imageCount === 1 ? 'image' : imageCount + ' images'}</span>` : ''}
        ${isError ? '<span class="tool-result-meta error-badge">error</span>' : ''}
        ${lineCount > 5 ? `<span class="tool-result-preview">${escapeHtml(preview)}</span>` : ''}
      </summary>
      <div class="tool-result-content"><pre>${escapeHtml(truncate(content, 2000))}</pre>${imagesHtml}</div>
    </details>
  </div>`;
}

// Tree-navigation marker: the summary of an abandoned branch, injected into
// the model's context at this point. Collapsed by default — summaries run
// long — but stays visible in focus mode (it's conversation context, not
// tool noise).
function renderBranchSummary(msg, time, attrs = '') {
  const text = extractTextContent(msg.content);
  const timestamp = msg.timestamp || Date.now();
  const preview = truncate(text.split('\n')[0], 80);
  return `<div${attrs} class="message branch-summary" data-timestamp="${timestamp}">
    <details class="branch-summary-details">
      <summary class="branch-summary-header">
        <span class="branch-summary-icon">⎇</span>
        <span class="branch-summary-label">Branch summary</span>
        ${time ? `<span class="message-time">${time}</span>` : ''}
        <span class="branch-summary-preview">${escapeHtml(preview)}</span>
      </summary>
      <div class="message-content"><div class="markdown-body">${formatMarkdown(text)}</div></div>
    </details>
  </div>`;
}

// =========================================================================
// Live Tool Panels (streaming tool execution)
// =========================================================================

// One place for the output escaping + truncation — a freshly appended panel
// and an incrementally updated one must render output identically.
function liveToolOutputHtml(output) {
  return escapeHtml(truncate(output, 8000));
}

function buildLiveToolPanel(toolCallId, toolName, args, output, isError, isComplete, durationMs, imagesHtml = '') {
  const stateClass = isComplete ? (isError ? 'error' : 'complete') : 'running';
  const summary = getToolSummary(toolName, args);
  const openAttr = (output || imagesHtml) ? ' open' : '';

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
    ? '<div class="live-tool-output">' + liveToolOutputHtml(output) + cursorHtml + '</div>'
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
    imagesHtml +
  '</details>';
}

function appendLiveToolPanel(data) {
  const { toolCallId, toolName, args } = data;
  runningTools.set(toolCallId, toolName || 'tool');
  updateWorkingIndicator();
  if (liveToolPanels.has(toolCallId)) return; // already rendered

  const container = document.getElementById('messages');
  if (!container) return;

  const wasPinned = isPinnedToBottom(container);
  const html = buildLiveToolPanel(toolCallId, toolName, args, '', false, false);
  container.insertAdjacentHTML('beforeend', html);

  const el = container.querySelector('[data-tool-call-id="' + toolCallId + '"]');
  liveToolPanels.set(toolCallId, { el, startTime: Date.now() });
  if (wasPinned) scrollToBottom(container); else updateJumpButton(container);
}

function updateLiveToolPanel(data) {
  const { toolCallId, partialResult } = data;
  const entry = liveToolPanels.get(toolCallId);
  if (!entry || !entry.el) return;

  const output = getToolOutputText(partialResult);
  // Images derive idempotently from the latest partial result — the whole
  // `.msg-images` row is replaced each update so images never accumulate.
  const imagesHtml = imageBlocksHtml(partialResult && partialResult.content, 'tool result image');
  if (!output && !imagesHtml) return;

  const container = document.getElementById('messages');
  const wasPinned = container ? isPinnedToBottom(container) : false;

  let outputEl = entry.el.querySelector('.live-tool-output');
  if (output && !outputEl) {
    // Create output area if it doesn't exist
    const cursorHtml = '<span class="live-tool-cursor"></span>';
    outputEl = document.createElement('div');
    outputEl.className = 'live-tool-output';
    outputEl.innerHTML = liveToolOutputHtml(output) + cursorHtml;
    entry.el.appendChild(outputEl);
    // Open the details so output is visible
    entry.el.setAttribute('open', '');
  } else if (output) {
    const cursorEl = outputEl.querySelector('.live-tool-cursor');
    outputEl.innerHTML = liveToolOutputHtml(output);
    // Re-add cursor
    if (cursorEl) outputEl.appendChild(cursorEl);
    else outputEl.insertAdjacentHTML('beforeend', '<span class="live-tool-cursor"></span>');
  }

  if (imagesHtml) {
    const existing = entry.el.querySelector('.msg-images');
    if (existing) existing.outerHTML = imagesHtml;
    else entry.el.insertAdjacentHTML('beforeend', imagesHtml);
    entry.el.setAttribute('open', '');
  }

  // Follow output only while the user hasn't scrolled away.
  if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
  if (container && wasPinned) scrollToBottom(container);
}

function finalizeLiveToolPanel(data) {
  const { toolCallId, toolName, args, result, isError } = data;
  runningTools.delete(toolCallId);
  updateWorkingIndicator();
  applyMoodFromTool(toolName, args);
  const entry = liveToolPanels.get(toolCallId);
  if (!entry || !entry.el) return;

  const output = getToolOutputText(result);
  const imagesHtml = imageBlocksHtml(result && result.content, 'tool result image');
  const durationMs = entry.startTime ? (Date.now() - entry.startTime) : null;

  // Rebuild the panel in its final state
  const newHtml = buildLiveToolPanel(toolCallId, toolName || 'tool', args, output, isError, true, durationMs, imagesHtml);
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
        // Both flags, independently: auto-compaction runs inside a turn
        // (both true), a TUI /compact has neither turn nor stream events yet
        // (compacting only), and a reconnect after either ended must clear
        // stale indicators (both false). setCompacting first so the
        // turn-off path doesn't wipe status a live compaction still owns.
        setCompacting(!!data.compacting);
        setTurnInProgress(!!data.turnInProgress);
        if (data.compacting) setStatus('Compacting context...', 'working');
        else if (data.turnInProgress) setStatus('Waiting for response...', 'working');
        if (!data.turnInProgress) {
          // No turn running — incremental catch-up for any messages written
          // since our initial load (avoids full reload stall).
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

    const handleTurnEnd = () => {
      setTurnInProgress(false);
      cancelStreamingRender();
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
      refreshSessions();
      refreshArtifacts(sessionId); // the agent may have published pages mid-turn
      refreshSessionSpend();
      setStatus('');
    };
    evtSource.addEventListener('turn_end', handleTurnEnd);
    // An aborted/errored turn can end with agent_end and no paired turn_end;
    // both server backends treat it as turn-terminating, so we must too. The
    // guard avoids double catch-up when turn_end already ran.
    evtSource.addEventListener('agent_end', () => { if (turnInProgress) handleTurnEnd(); });

    // message_update streams text, thinking, and partial tool calls live —
    // rendered incrementally through the throttled streaming renderer.
    evtSource.addEventListener('message_update', (e) => {
      try {
        const { message } = JSON.parse(e.data);
        if (!message || message.role !== 'assistant') return;
        if (!turnInProgress) setTurnInProgress(true);
        queueStreamingRender(message);
      } catch (err) {}
    });

    evtSource.addEventListener('message_end', (e) => {
      try {
        const { message } = JSON.parse(e.data);
        if (!message) return;
        const container = document.getElementById('messages');
        if (!container) return;
        if (message.role === 'user') {
          // pi echoes every user message it processes — including the prompt
          // this client just rendered optimistically in sendMessage. Skip that
          // one echo or the prompt shows twice until the turn_end catch-up.
          if (pendingSelfEcho !== null && extractTextContent(message.content) === pendingSelfEcho) {
            pendingSelfEcho = null;
            return;
          }
          // A steer/follow-up pi just delivered mid-turn (or a prompt typed in
          // the TUI). Insert it un-indexed before the streaming placeholder
          // (if any); the turn_end JSONL catch-up strips un-indexed .message
          // nodes and re-inserts the authoritative indexed render, so this
          // never duplicates.
          const wasPinned = isPinnedToBottom(container);
          const streaming = container.querySelector('.message.assistant[data-streaming="true"]');
          const tmp = document.createElement('template');
          tmp.innerHTML = renderUserMessage(message, formatTime(message.timestamp || Date.now()));
          const el = tmp.content.firstElementChild;
          if (streaming) streaming.before(el);
          else container.appendChild(el);
          if (wasPinned || followStream) scrollToBottom(container); else updateJumpButton(container);
          return;
        }
        if (message.role !== 'assistant') return;
        cancelStreamingRender();
        // Swap the streaming placeholder for the finalized render in place.
        // It stays un-indexed, so the turn_end JSONL catch-up replaces it
        // with the authoritative version (fetchNewMessagesSince strips all
        // .message:not([data-msg-index]) once indexed messages land) —
        // meanwhile the text never blinks out of the transcript.
        const wasPinned = isPinnedToBottom(container);
        const streaming = container.querySelectorAll('.message.assistant[data-streaming="true"]');
        const tmp = document.createElement('template');
        tmp.innerHTML = renderAssistantMessage(message, formatTime(message.timestamp || Date.now()));
        const finalEl = tmp.content.firstElementChild;
        if (streaming.length) streaming[streaming.length - 1].before(finalEl);
        else container.appendChild(finalEl);
        streaming.forEach(el => el.remove());
        applyHighlight(finalEl);
        if (wasPinned) scrollToBottom(container); else updateJumpButton(container);
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

    evtSource.addEventListener('extension_ui_request', (e) => {
      try { handleExtensionUI(JSON.parse(e.data)); } catch (err) { console.error('extension_ui_request error:', err); }
    });

    evtSource.addEventListener('queue_update', (e) => {
      try { renderQueueStatus(JSON.parse(e.data)); } catch {}
    });

    // Dialog answered elsewhere (TUI or another browser) — dismiss ours.
    evtSource.addEventListener('extension_ui_resolved', (e) => {
      try { dismissExtDialog(JSON.parse(e.data).id); } catch {}
    });

    evtSource.addEventListener('compaction_start', () => {
      setStatus('Compacting context...', 'working');
      setCompacting(true);
    });
    evtSource.addEventListener('compaction_end', (e) => {
      setCompacting(false);
      try {
        const data = JSON.parse(e.data);
        if (data.errorMessage) {
          setStatus('Compaction failed: ' + data.errorMessage, 'error');
          return;
        }
        if (data.aborted) {
          setStatus('Compaction cancelled');
          return;
        }
        const r = data.result;
        // The bridge path knows tokensBefore but not the post-compaction size
        // (context tokens are unknown until the next LLM response).
        let msg = 'Compaction finished';
        if (r && r.tokensBefore) {
          msg = r.estimatedTokensAfter != null
            ? `Compacted: ${formatTokens(r.tokensBefore)} → ~${formatTokens(r.estimatedTokensAfter)} tokens`
            : `Compacted (was ${formatTokens(r.tokensBefore)} tokens)`;
        }
        setStatus(msg);
        refreshSessions();
      } catch { setStatus('Compaction finished'); }
    });
    // Tree navigation (from any surface — this UI, the TUI, another client)
    // rewrote the session's authoritative history: re-render the transcript
    // from the JSONL. The UI's own branch flow also reloads after its POST
    // resolves; a second forced reload of the same state is harmless.
    evtSource.addEventListener('session_tree', () => {
      if (currentSession && currentSession.id === sessionId) {
        selectSession(sessionId, { forceTranscriptReload: true });
      }
    });

    evtSource.addEventListener('auto_retry_start', (e) => {
      try {
        const d = JSON.parse(e.data);
        setStatus(`Retrying (attempt ${d.attempt}/${d.maxAttempts})...`, 'working');
      } catch {}
    });
    evtSource.addEventListener('auto_retry_end', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.success === false) setStatus('Retry failed: ' + (d.finalError || 'unknown'), 'error');
      } catch {}
    });

    evtSource.addEventListener('session_ended', () => {
      setCompacting(false);
      setTurnInProgress(false);
      setStatus('Session ended');
      refreshSessions();
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

// --- Image attachments -------------------------------------------------

var pendingImages = []; // { data: base64 (no data: prefix), mimeType }

async function addImageFiles(files) {
  for (const file of Array.from(files || [])) {
    if (!file || !file.type || !file.type.startsWith('image/')) continue;
    try {
      pendingImages.push(await prepareImageAttachment(file));
    } catch (e) {
      setStatus(`Could not attach ${file.name || 'image'}: ${e.message}`, 'error');
    }
  }
  renderAttachmentStrip();
}

// Phone photos are routinely 10MB+; downscale to a sane long edge and
// re-encode as JPEG before base64ing. Small images pass through untouched.
async function prepareImageAttachment(file) {
  const MAX_EDGE = 1568, PASSTHROUGH_BYTES = 512 * 1024;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { data: await fileToBase64(file), mimeType: file.type };
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= PASSTHROUGH_BYTES) {
    bitmap.close();
    return { data: await fileToBase64(file), mimeType: file.type };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function renderAttachmentStrip() {
  const strip = document.getElementById('attachmentStrip');
  if (!strip) return;
  if (!pendingImages.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
  strip.innerHTML = pendingImages.map((img, i) =>
    `<span class="attachment-thumb"><img src="data:${escapeHtml(img.mimeType)};base64,${img.data}" alt="">` +
    `<button class="attachment-remove" onclick="removeAttachment(${i})" title="Remove">✕</button></span>`
  ).join('');
  strip.style.display = '';
}

function removeAttachment(i) { pendingImages.splice(i, 1); renderAttachmentStrip(); }

/** Detach and clear the pending attachments (returns null when empty). */
function takePendingImages() {
  if (!pendingImages.length) return null;
  const imgs = pendingImages;
  pendingImages = [];
  renderAttachmentStrip();
  return imgs;
}

/** Put detached attachments back after a failed send. */
function restoreAttachments(images) {
  if (!images) return;
  pendingImages = images.concat(pendingImages);
  renderAttachmentStrip();
}

function openImageLightbox(src) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  const img = document.createElement('img');
  img.src = src;
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// --- Prompt drafts & history --------------------------------------------

var promptHistory = [];  // sent prompts for the current session (oldest first)
var historyIndex = -1;   // -1 = not browsing history
var historyStash = '';   // in-progress text stashed while browsing
var draftSaveTimer = null;

function draftKey(id) { return `pi-dish-draft-${id}`; }
function historyKey(id) { return `pi-dish-history-${id}`; }

function saveDraftSoon() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    if (!currentSession) return;
    const v = document.getElementById('promptInput').value;
    try {
      if (v.trim() && v.length < 50000) localStorage.setItem(draftKey(currentSession.id), v);
      else localStorage.removeItem(draftKey(currentSession.id));
    } catch {}
  }, 300);
}

function clearDraft() {
  clearTimeout(draftSaveTimer);
  if (currentSession) try { localStorage.removeItem(draftKey(currentSession.id)); } catch {}
}

/** On session switch: load that session's draft + history into the input. */
function restorePromptState() {
  const input = document.getElementById('promptInput');
  let draft = '';
  try { draft = localStorage.getItem(draftKey(currentSession.id)) || ''; } catch {}
  input.value = draft;
  autosizePromptInput(input);
  historyIndex = -1;
  historyStash = '';
  promptHistory = readJSONPref(historyKey(currentSession.id), []);
  if (!Array.isArray(promptHistory)) promptHistory = [];
}

function recordPrompt(message) {
  if (!currentSession) return;
  promptHistory = pushPromptHistory(promptHistory, message, 50);
  historyIndex = -1;
  try { localStorage.setItem(historyKey(currentSession.id), JSON.stringify(promptHistory)); } catch {}
}

function navigateHistory(dir, input) {
  if (!promptHistory.length) return false;
  if (dir < 0) {
    if (historyIndex === -1) { historyStash = input.value; historyIndex = promptHistory.length - 1; }
    else if (historyIndex > 0) historyIndex--;
    else return true; // already at oldest — swallow the keypress
  } else {
    historyIndex++;
    if (historyIndex >= promptHistory.length) historyIndex = -1; // back to the stashed draft
  }
  const val = historyIndex === -1 ? historyStash : promptHistory[historyIndex];
  input.value = val;
  input.setSelectionRange(val.length, val.length);
  autosizePromptInput(input);
  return true;
}

async function sendPrompt() {
  const input = document.getElementById('promptInput');
  const message = input.value.trim();
  if ((!message && !pendingImages.length) || !currentSession) return;

  if (message === '/tree') { input.value = ''; openTreeModal(); return; }
  hideAutocomplete();

  // Slash commands go to the command endpoint, never to the model as text.
  if (message.startsWith('/')) {
    // The bridge refuses a /compact while one runs (concurrent compactions
    // race pi's message rewrite); fail fast here too so the composer text
    // survives and the feedback is immediate.
    if (compactingNow && /^\/compact(\s|$)/.test(message)) {
      setStatus('Compaction already in progress', 'error');
      return;
    }
    input.value = '';
    input.style.height = '';
    recordPrompt(message);
    clearDraft();
    setStatus('Running ' + message.split(' ')[0] + '...', 'working');
    try {
      const data = await apiSend(`/api/sessions/${currentSession.id}/command`, { message });
      setStatus(data.info || 'Done');
      refreshSessions();
    } catch (e) {
      setStatus(`${message.split(' ')[0]}: ${e.message}`, 'error');
      input.value = message; // let the user fix and retry
      input.dispatchEvent(new Event('input'));
    }
    return;
  }

  input.value = '';
  input.style.height = '';
  recordPrompt(message);
  clearDraft();
  const images = takePendingImages();
  setStatus('Sending...', 'working');

  const container = document.getElementById('messages');
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  const optimisticContent = [];
  if (message) optimisticContent.push({ type: 'text', text: message });
  for (const img of images || []) optimisticContent.push({ type: 'image', data: img.data, mimeType: img.mimeType });
  container.insertAdjacentHTML('beforeend', renderUserMessage({
    role: 'user', content: optimisticContent, timestamp: Date.now()
  }, formatTime(Date.now())));
  // Arm the echo suppressor: pi re-emits this prompt as a user message_end
  // when the turn starts, and we've already rendered it. '' is a valid value
  // (images-only prompt), hence the null sentinel.
  pendingSelfEcho = message;
  followStream = true; // sending means: follow the stream from here on
  scrollToBottom(container);

  setTurnInProgress(true);

  try {
    const resp = await apiSend(`/api/sessions/${currentSession.id}/prompt`, images ? { message, images } : { message });
    if (resp?.result?.queued) {
      // Held by the bridge until compaction finishes; no turn is running yet.
      // Raise the compacting indicator before undoing the optimistic
      // "Working" badge so the turn-off path doesn't blank the strip/status.
      setCompacting(true);
      setTurnInProgress(false);
      setStatus('Queued — will send when compaction finishes', 'working');
    } else {
      setStatus('Waiting for response...', 'working');
    }
  } catch (e) {
    setStatus(`Error: ${e.message}`, 'error');
    setTurnInProgress(false);
    pendingSelfEcho = null; // no echo is coming for a failed send
    restoreAttachments(images); // don't lose them on a failed send
  }
}

var turnInProgress = false;

// Text of the prompt whose optimistic render is awaiting its pi echo (null
// when none) — see the user branch of the message_end stream handler.
var pendingSelfEcho = null;

// --- Live activity: elapsed turn time + currently running tool -----------
// The working badge reads "Working 1:42 · Bash" so a glance says what the
// agent is doing and for how long (mobile badge shows just the timer).
// Client-side by nature: opening a session mid-turn counts from connect.
let turnStartedAt = null;
let workingTicker = null;
const runningTools = new Map(); // toolCallId -> toolName

// Compaction state, tracked separately from the turn: manual compaction has
// no turn at all, while auto-compaction runs inside one. Whichever is on,
// the badge must say so — a send during compaction is held by the bridge,
// and the user needs to see why nothing is streaming (and must not fire a
// second /compact into it).
var compactingNow = false;
let compactingStartedAt = null;

function updateWorkingIndicator() {
  const desktop = document.querySelector('#sessionWorking .spinner-text');
  const mobile = document.querySelector('#sessionWorkingMobile .spinner-text');
  // Compacting wins the badge text over the turn: it's the rarer state and
  // the one that changes what a send does right now.
  if (compactingNow) {
    const elapsed = compactingStartedAt ? formatDuration(Date.now() - compactingStartedAt) : '';
    if (desktop) desktop.textContent = 'Compacting context…' + (elapsed ? ' ' + elapsed : '');
    if (mobile) mobile.textContent = 'Compacting…';
    return;
  }
  if (!turnInProgress || !turnStartedAt) {
    if (desktop) desktop.textContent = 'Working';
    if (mobile) mobile.textContent = '';
    return;
  }
  const elapsed = formatDuration(Date.now() - turnStartedAt);
  let tool = null;
  for (const name of runningTools.values()) tool = name; // most recently started
  if (tool && tool.length > 24) tool = tool.slice(0, 24) + '…';
  if (desktop) desktop.textContent = `Working ${elapsed}` + (tool ? ` · ${tool}` : '');
  if (mobile) mobile.textContent = elapsed;
}

// One place decides whether the pulsing badge, its ticker, and the Stop
// button are on: a running turn or a running compaction (or both, during
// auto-compaction) keeps them alive. Text comes from updateWorkingIndicator.
function syncActivityIndicator() {
  const active = turnInProgress || compactingNow;
  if (active) {
    if (!workingTicker) workingTicker = setInterval(updateWorkingIndicator, 1000);
  } else if (workingTicker) {
    clearInterval(workingTicker);
    workingTicker = null;
  }
  var workingDesktop = document.getElementById('sessionWorking');
  var workingMobile = document.getElementById('sessionWorkingMobile');
  if (workingDesktop) workingDesktop.classList.toggle('active', active);
  if (workingMobile) workingMobile.classList.toggle('active', active);
  // Stop stays reachable during compaction — the bridge cancels a running
  // compaction on abort. Steer/follow-up only make sense against a turn,
  // so they remain setTurnInProgress's business.
  var btnStop = document.getElementById('btnStop');
  if (btnStop) btnStop.style.display = active ? '' : 'none';
  updateWorkingIndicator();
}

function setTurnInProgress(active) {
  const starting = active && !turnInProgress;
  turnInProgress = active;
  if (starting) {
    turnStartedAt = Date.now();
  } else if (!active) {
    turnStartedAt = null;
    runningTools.clear();
  }
  syncActivityIndicator();
  // Reflect in the sidebar immediately — the working dot shouldn't wait for
  // the next 10s poll. (turn events only stream for the viewed session.)
  if (currentSession && !!currentSession.turnInProgress !== !!active) {
    patchSession(currentSession.id, { turnInProgress: !!active });
  }
  var btnSteer = document.getElementById('btnSteer');
  var btnFollowUp = document.getElementById('btnFollowUp');
  var btnSend = document.getElementById('btnSend');
  if (btnSteer) btnSteer.style.display = active ? '' : 'none';
  if (btnFollowUp) btnFollowUp.style.display = active ? '' : 'none';
  if (btnSend) btnSend.style.display = active ? 'none' : '';
  // A turn ending mid-compaction (manual /compact aborts the agent first;
  // auto-compaction holds queued sends) must not wipe the compaction badge,
  // the held-message strip, or the status line.
  if (!active && !compactingNow) {
    renderQueueStatus(null);
    setStatus('');
  }
}

function setCompacting(active) {
  const on = !!active;
  compactingNow = on;
  compactingStartedAt = on ? (compactingStartedAt || Date.now()) : null;
  syncActivityIndicator();
  // Sidebar dot immediately, same as the turn dot (compaction events only
  // stream for the viewed session; other rows update via the poll).
  if (currentSession && !!currentSession.compacting !== on) {
    patchSession(currentSession.id, { compacting: on });
  }
}

// Steer and follow-up share everything but the endpoint and status strings.
async function sendQueuedMessage(kind) {
  const steer = kind === 'steer';
  const input = document.getElementById('promptInput');
  const message = input.value.trim();
  if ((!message && !pendingImages.length) || !currentSession || !currentSession.isActive) return;

  input.value = '';
  input.style.height = '';
  recordPrompt(message);
  clearDraft();
  const images = takePendingImages();
  setStatus(steer ? 'Steering...' : 'Queueing follow-up...', 'working');

  const body = steer ? { message } : { message, deliverAs: 'followUp' };
  if (images) body.images = images;
  try {
    const resp = await apiSend(`/api/sessions/${currentSession.id}${steer ? '/steer' : '/prompt'}`, body);
    if (resp?.result?.queued) setStatus('Queued — will send when compaction finishes');
    else setStatus(steer ? 'Steered' : 'Queued for after this turn');
  } catch (e) {
    setStatus(`${steer ? 'Steer' : 'Follow-up'} failed: ${e.message}`, 'error');
    restoreAttachments(images); // don't lose them on a failed send
  }
}

function sendSteer() { return sendQueuedMessage('steer'); }
function sendFollowUp() { return sendQueuedMessage('followUp'); }

// Pending steering/follow-up queue strip (from queue_update events, including
// messages typed in the TUI). Always visible above the composer while the
// queue is non-empty; each row's Edit button pulls the message back out of
// pi's queue and into the composer.
var lastQueueData = null;

function renderQueueStatus(data) {
  lastQueueData = data;
  const panel = document.getElementById('queuePanel');
  if (!panel) return;
  const steering = data?.steering || [];
  const followUp = data?.followUp || [];
  if (!steering.length && !followUp.length) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  const rows = [];
  steering.forEach((text, i) => rows.push(queueRowHtml('steering', 'steer', text, i)));
  followUp.forEach((text, i) => rows.push(queueRowHtml('followUp', 'follow-up', text, i)));
  panel.innerHTML = rows.join('');
  panel.style.display = '';
}

function queueRowHtml(kind, label, text, index) {
  return `<div class="queue-item" data-kind="${kind}" data-index="${index}">
    <span class="queue-item-kind">${label}</span>
    <span class="queue-item-text" onclick="this.classList.toggle('expanded')" title="Click to expand">${escapeHtml(text)}</span>
    <button class="queue-item-edit" onclick="editQueuedMessage(this)" title="Remove from queue and edit">↩ Edit</button>
  </div>`;
}

// Cancel a queued message on the bridge and return its text to the composer.
async function editQueuedMessage(btn) {
  if (!currentSession) return;
  const row = btn.closest('.queue-item');
  if (!row) return;
  const kind = row.dataset.kind;
  const index = Number(row.dataset.index);
  const text = row.querySelector('.queue-item-text')?.textContent || '';
  if (!text) return;
  try {
    await apiSend(`/api/sessions/${currentSession.id}/queue/cancel`, { kind, index, text });
    const input = document.getElementById('promptInput');
    if (input) {
      const existing = input.value.trim();
      input.value = existing && existing !== text ? `${existing}\n\n${text}` : text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }
    // The follow-up queue_update reconciles the strip; no manual removal needed.
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function abortTurn() {
  // Compaction counts: the bridge cancels a running compaction on abort, and
  // its compaction_end (aborted) event clears the compacting indicator.
  if (!currentSession || (!turnInProgress && !compactingNow)) return;
  setStatus('Stopping...', 'working');
  try {
    await apiSend('/api/sessions/' + currentSession.id + '/abort');
    setStatus('Stopped');
    setTurnInProgress(false);
  } catch (e) { setStatus('Stop failed: ' + e.message, 'error'); }
}

// New session — cwd from the picker input unless a caller (the workspace
// header's + button) passes one explicitly.
async function createSession(cwd) {
  let target;
  try {
    target = selectedSpawnTarget();
  } catch (e) { setStatus(e.message, 'error'); return; }
  try {
    setStatus(target ? 'Spawning in tmux…' : 'Creating session...', 'working');
    if (cwd === undefined) {
      const cwdInput = document.getElementById('newSessionCwd');
      cwd = cwdInput ? cwdInput.value.trim() : '';
    }
    // Persist last-used cwd
    if (cwd) localStorage.setItem('pi-dish-cwd', cwd);
    const data = await apiSend('/api/sessions/new', { cwd: cwd || undefined, target: target || undefined });
    if (!data.id) { setStatus('Failed to create session', 'error'); return; }
    setStatus('Session created');
    switchTab('active');
    // Poll until the new session shows up in the list instead of hoping a
    // fixed delay is enough.
    for (let attempt = 0; attempt < 10; attempt++) {
      await loadSessions();
      if (findSession(data.id)) { selectSession(data.id); return; }
      await new Promise(r => setTimeout(r, 1000));
    }
    setStatus('Session created but not visible yet — try refreshing', 'error');
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

// Fuzzy-find the starting directory: known session cwds (starred, boosted)
// merged with a live filesystem search under ~ (server-side, /api/dirs).
const cwdFetcher = debouncedFetcher(120,
  async (query) => {
    const res = await fetch('/api/dirs?q=' + encodeURIComponent(query));
    return res.ok ? await res.json() : [];
  },
  (dirs, query) => renderCwdDropdown(query, dirs || []));

function showCwdDropdown(query) { cwdFetcher.fire(query); }

function renderCwdDropdown(query, dirs) {
  const dropdown = document.getElementById('cwdDropdown');
  if (!dropdown) return;

  const seen = new Set();
  let results = [];
  for (const c of [...knownCwds.map(c => ({ ...c, known: true })), ...dirs]) {
    if (seen.has(c.short)) continue;
    seen.add(c.short);
    if (!query) { results.push({ ...c, indices: [] }); continue; }
    const indices = fuzzyMatch(query, c.short);
    if (!indices) continue;
    results.push({ ...c, indices, score: fuzzyScore(indices, c.short) + (c.known ? 5 : 0) });
  }
  if (query) results.sort((a, b) => b.score - a.score);
  results = results.slice(0, 15);

  if (results.length === 0) { dropdown.style.display = 'none'; return; }

  cwdDropdownIdx = -1;
  dropdown.innerHTML = results.map((c) =>
    `<div class="cwd-option" data-path="${escapeHtml(c.short)}">${c.known ? '<span class="cwd-known">★</span>' : ''}${highlightFuzzy(c.short, c.indices)}</div>`
  ).join('');
  dropdown.style.display = 'block';

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
  cwdFetcher.cancel(); // invalidate any in-flight dir search
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cwdDropdownIdx = moveActiveItem(options, cwdDropdownIdx, e.key === 'ArrowDown' ? 1 : -1);
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
// Spawn target ("Run in") — headless RPC child (default) or a tmux window.
// A combobox like the cwd picker above it: the action rows (headless, one
// "new session…" per tmux server) stay pinned at the top, and typing
// fuzzy-filters the named tmux sessions listed below them.
// =========================================================================
// Each entry: { label, target, needsName, pinned }. target === null = headless.
let spawnTargets = [{ label: 'pi-dish (headless)', target: null, pinned: true }];
let spawnChoiceKey = 'headless';
let spawnDropdownIdx = -1;

// Stable key so a saved choice survives target re-fetches/reorders.
function spawnTargetKey(t) {
  if (!t || !t.target) return 'headless';
  if (t.needsName) return `${t.target.socket}::new`;
  return `${t.target.socket}::${t.target.tmuxSession}`;
}

function currentSpawnTarget() {
  return spawnTargets.find(t => spawnTargetKey(t) === spawnChoiceKey) || spawnTargets[0];
}

async function loadSpawnTargets() {
  const wrap = document.getElementById('newSessionTargetWrap');
  const input = document.getElementById('newSessionTarget');
  if (!wrap || !input) return;
  let data;
  try {
    const res = await fetch('/api/tmux/targets');
    data = await res.json();
  } catch { data = { available: false }; }

  // Hide the control when tmux is missing or no tmux servers are running —
  // headless is the only option anyway.
  if (!data || !data.available || !data.servers?.length) {
    wrap.style.display = 'none';
    return;
  }

  spawnTargets = [{ label: 'pi-dish (headless)', target: null, pinned: true }];
  for (const srv of data.servers) {
    spawnTargets.push({
      label: `tmux:${srv.name} — new session…`,
      target: { type: 'tmux', socket: srv.socket },
      needsName: true,
      pinned: true,
    });
  }
  for (const srv of data.servers) {
    for (const s of srv.sessions || []) {
      spawnTargets.push({
        label: `tmux:${srv.name} — ${s.name}`,
        target: { type: 'tmux', socket: srv.socket, tmuxSession: s.name },
      });
    }
  }

  // Restore last choice if its server/session still exists; else headless.
  const saved = localStorage.getItem('pi-dish-spawn-target');
  spawnChoiceKey = (saved && spawnTargets.some(t => spawnTargetKey(t) === saved)) ? saved : 'headless';
  syncSpawnTargetInput();
  wrap.style.display = '';
}

// Reflect the current choice: input shows its label, the tmux-session-name
// input reveals for "new session…" choices, and the choice persists.
function syncSpawnTargetInput() {
  const input = document.getElementById('newSessionTarget');
  const nameInput = document.getElementById('newSessionTmuxName');
  const t = currentSpawnTarget();
  if (input) input.value = t.label;
  if (nameInput) nameInput.style.display = t.needsName ? '' : 'none';
  localStorage.setItem('pi-dish-spawn-target', spawnTargetKey(t));
}

function renderSpawnTargetDropdown(query) {
  const dropdown = document.getElementById('spawnTargetDropdown');
  if (!dropdown) return;
  const q = (query || '').trim();
  let named = spawnTargets.filter(t => !t.pinned).map(t => ({ t, indices: [] }));
  if (q) {
    named = named.map(({ t }) => {
      const indices = fuzzyMatch(q, t.label);
      return indices && { t, indices, score: fuzzyScore(indices, t.label) };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
  }
  const rows = [...spawnTargets.filter(t => t.pinned).map(t => ({ t, indices: [] })), ...named];
  spawnDropdownIdx = -1;
  dropdown.innerHTML = rows.map(({ t, indices }) =>
    `<div class="cwd-option" data-key="${escapeHtml(spawnTargetKey(t))}">${indices.length ? highlightFuzzy(t.label, indices) : escapeHtml(t.label)}</div>`
  ).join('');
  dropdown.style.display = 'block';
  dropdown.querySelectorAll('.cwd-option').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      chooseSpawnTarget(el.dataset.key);
    });
  });
}

function chooseSpawnTarget(key) {
  spawnChoiceKey = key;
  syncSpawnTargetInput();
  hideSpawnTargetDropdown();
  if (currentSpawnTarget().needsName) document.getElementById('newSessionTmuxName')?.focus();
}

function hideSpawnTargetDropdown() {
  const dropdown = document.getElementById('spawnTargetDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

// Wire up the run-in combobox (same conventions as the cwd input above).
(function() {
  const input = document.getElementById('newSessionTarget');
  if (!input) return;
  // Focus selects the label so typing starts a fresh filter; blur restores
  // the chosen label over whatever filter text was left behind.
  input.addEventListener('focus', () => { input.select(); renderSpawnTargetDropdown(''); });
  input.addEventListener('input', () => renderSpawnTargetDropdown(input.value));
  input.addEventListener('blur', () => setTimeout(() => { hideSpawnTargetDropdown(); syncSpawnTargetInput(); }, 150));
  input.addEventListener('keydown', (e) => {
    const dropdown = document.getElementById('spawnTargetDropdown');
    if (!dropdown || dropdown.style.display === 'none') return;
    const options = dropdown.querySelectorAll('.cwd-option');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      spawnDropdownIdx = moveActiveItem(options, spawnDropdownIdx, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (spawnDropdownIdx >= 0 && options[spawnDropdownIdx]) {
        chooseSpawnTarget(options[spawnDropdownIdx].dataset.key);
      } else {
        hideSpawnTargetDropdown();
        syncSpawnTargetInput();
      }
    } else if (e.key === 'Escape') {
      hideSpawnTargetDropdown();
      syncSpawnTargetInput();
    }
  });
})();

// The target descriptor to send with /new. Throws if a new-tmux-session choice
// is missing its name. Returns null (headless) when the control is hidden.
function selectedSpawnTarget() {
  const wrap = document.getElementById('newSessionTargetWrap');
  if (!wrap || wrap.style.display === 'none') return null;
  const t = currentSpawnTarget();
  if (!t || !t.target) return null;
  if (t.needsName) {
    const name = (document.getElementById('newSessionTmuxName')?.value || '').trim();
    if (!name) throw new Error('Enter a name for the new tmux session');
    return { type: 'tmux', socket: t.target.socket, newTmuxSession: name };
  }
  return { type: 'tmux', socket: t.target.socket, tmuxSession: t.target.tmuxSession };
}

// For resume: the saved target if it still resolves to a concrete tmux
// session (a pending "new session…" choice has no name here → headless).
function savedResumeTarget() {
  const saved = localStorage.getItem('pi-dish-spawn-target');
  if (!saved || saved === 'headless') return null;
  const t = spawnTargets.find(x => spawnTargetKey(x) === saved);
  if (!t || !t.target || t.needsName) return null;
  return { type: 'tmux', socket: t.target.socket, tmuxSession: t.target.tmuxSession };
}

// =========================================================================
// Utilities
// =========================================================================

/**
 * POST/PUT a JSON body and parse the JSON reply. Throws Error(data.error) on
 * a non-2xx status so callers get the server's message without each
 * hand-rolling the res.ok / res.json().catch(() => ({})) dance (they used
 * to, with a slightly different fallback at every site).
 */
async function apiSend(path, body, method = 'POST') {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

/**
 * Arm a document-level "click outside closes this" chain. Clicks inside any
 * of the `ids` containers re-arm the listener; anything else calls close().
 * A target detached from the document counts as inside — an inside handler
 * that re-renders innerHTML before the click bubbles to the document (the
 * model dropdown's edit-mode toggles) must not read as an outside click.
 * `isOpen` stops a stale armed listener from acting after the panel was
 * already closed by other means.
 */
function armOutsideClickClose(ids, close, isOpen) {
  const onClick = (e) => {
    if (isOpen && !isOpen()) return;
    const inside = !document.body.contains(e.target) ||
      ids.some(id => document.getElementById(id)?.contains(e.target));
    if (inside) arm();
    else close();
  };
  const arm = () => setTimeout(() => document.addEventListener('click', onClick, { once: true }), 0);
  arm();
}

/**
 * Debounced, sequence-guarded async lookup for type-ahead dropdowns:
 * fire(args) runs fetchFn after `ms` of quiet and hands the result to
 * applyFn only if no newer fire()/cancel() superseded it — a slow response
 * can never render over a newer keystroke. cancel() also invalidates any
 * in-flight result (call it from the dropdown's hide path).
 */
function debouncedFetcher(ms, fetchFn, applyFn) {
  let timer = null;
  let seq = 0;
  return {
    fire(...args) {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const mySeq = ++seq;
        let result = null;
        try { result = await fetchFn(...args); } catch {}
        if (mySeq !== seq) return;
        applyFn(result, ...args);
      }, ms);
    },
    cancel() {
      seq++;
      clearTimeout(timer);
    },
  };
}

/**
 * Shared listbox keyboard nav: move the .active class by delta and scroll
 * the new item into view. Returns the new index. `wrap` cycles past the
 * ends (composer autocomplete); without it the index clamps (cwd picker).
 */
function moveActiveItem(items, currentIdx, delta, { wrap = false } = {}) {
  if (!items.length) return -1;
  let idx = currentIdx + delta;
  if (wrap) idx = (idx + items.length) % items.length;
  else idx = Math.max(0, Math.min(idx, items.length - 1));
  items.forEach((el, i) => el.classList.toggle('active', i === idx));
  items[idx].scrollIntoView({ block: 'nearest' });
  return idx;
}

/** Reset a fixed dropdown's inline position so the stylesheet takes over. */
function clearDropdownPos(el) {
  el.style.top = ''; el.style.left = ''; el.style.bottom = ''; el.style.right = '';
}

/**
 * Anchor a position:fixed dropdown to its trigger's rect — below it, or
 * above it (`above`) when the bottom of the screen belongs to the mobile
 * keyboard/composer.
 */
function anchorDropdown(el, rect, { above = false } = {}) {
  clearDropdownPos(el);
  el.style.left = rect.left + 'px';
  if (above) el.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  else el.style.top = (rect.bottom + 4) + 'px';
}

/** localStorage JSON read that can't throw on a corrupt/missing value. */
function readJSONPref(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

/**
 * After a JSONL-based render the on-disk messages are authoritative: drop
 * the live tool panels (their content is duplicated by the indexed
 * tool-call/tool-result messages that just landed) and stop tracking them
 * so the next turn starts fresh.
 */
function removeDuplicatedLiveContent(container) {
  container.querySelectorAll('details.live-tool-panel').forEach(el => el.remove());
  liveToolPanels.clear();
}

/**
 * The ordered DOM post-pass pipeline every JSONL-backed render runs:
 * strip superseded live panels, fold tool activity into accordions, then
 * highlight + decorate code blocks. One owner so a new pass can't be wired
 * into some render paths and missed in others. `stripLive: false` is for
 * prepending older pages — the live panels at the bottom belong to the
 * in-flight turn and must survive.
 */
function finalizeRender(container, { stripLive = true } = {}) {
  if (stripLive) removeDuplicatedLiveContent(container);
  groupToolActivity(container);
  applyHighlight(container);
}

/**
 * Collapse finished tool activity into one accordion per turn. Runs of
 * indexed tool-only assistant messages (.no-text) and tool results between
 * prose messages get wrapped in a closed <details class="tool-group">, so
 * past turns read prompt → "N tool uses" → answer. Idempotent — safe to
 * re-run after every append/prepend; adjacent groups merge so pagination
 * and incremental catch-up don't fragment a turn. Streaming elements
 * (no data-msg-index) are never grouped.
 */
function groupToolActivity(container) {
  if (!container) return;
  const isToolNoise = (el) =>
    el.matches('.message.tool-result[data-msg-index], .message.assistant.no-text[data-msg-index]');

  // Pass 1: wrap each maximal run of ungrouped tool activity.
  let run = [];
  const wrapRun = () => {
    if (!run.length) return;
    const group = document.createElement('details');
    group.className = 'tool-group';
    group.innerHTML = '<summary class="tool-group-header"><span class="tool-group-label"></span><span class="tool-group-preview"></span></summary><div class="tool-group-body"></div>';
    run[0].before(group);
    const body = group.querySelector('.tool-group-body');
    run.forEach(el => body.appendChild(el));
    run = [];
  };
  for (const child of Array.from(container.children)) {
    if (isToolNoise(child)) run.push(child);
    else wrapRun();
  }
  wrapRun();

  // Pass 2: merge adjacent groups (a turn split across pages/catch-ups).
  // The later group survives so an element being used as a scroll anchor
  // (loadOlderMessages) isn't removed from the DOM.
  container.querySelectorAll(':scope > details.tool-group').forEach(group => {
    const next = group.nextElementSibling;
    if (!next || !next.matches('details.tool-group')) return;
    next.querySelector('.tool-group-body').prepend(...group.querySelector('.tool-group-body').childNodes);
    if (group.open) next.open = true;
    group.remove();
  });

  container.querySelectorAll(':scope > details.tool-group').forEach(updateToolGroupSummary);
}

function updateToolGroupSummary(group) {
  const calls = group.querySelectorAll('details.tool-call').length;
  const results = group.querySelectorAll('.message.tool-result').length;
  const n = Math.max(calls, results);
  const names = [...new Set(
    [...group.querySelectorAll('.tool-call-name')].map(el => el.textContent.trim())
  )];
  group.querySelector('.tool-group-label').textContent =
    n ? `⚡ ${n} tool use${n === 1 ? '' : 's'}` : '🧠 thinking';
  group.querySelector('.tool-group-preview').textContent =
    names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '');
}

// =========================================================================
// Streaming assistant renderer — incremental, block-level, throttled.
//
// Every message_update carries the full message so far, so we keep one
// streaming DOM element and update only the content blocks that changed
// (the growing tail block in practice). No outerHTML swaps: <details>
// open/closed state survives naturally and layout work stays minimal.
// =========================================================================

const STREAM_RENDER_INTERVAL_MS = 80;
let streamPendingMessage = null;
let streamRenderTimer = null;

function queueStreamingRender(message) {
  streamPendingMessage = message;
  if (!streamRenderTimer) flushStreamingRender();
}

function flushStreamingRender() {
  streamRenderTimer = null;
  if (!streamPendingMessage) return;
  const msg = streamPendingMessage;
  streamPendingMessage = null;
  try { renderStreamingMessage(msg); } catch (e) { console.error('streaming render failed:', e); }
  streamRenderTimer = setTimeout(flushStreamingRender, STREAM_RENDER_INTERVAL_MS);
}

function cancelStreamingRender() {
  streamPendingMessage = null;
  if (streamRenderTimer) { clearTimeout(streamRenderTimer); streamRenderTimer = null; }
}

function ensureStreamingElement(container) {
  let el = container.querySelector('.message.assistant[data-streaming="true"]');
  if (el) return el;
  const ts = Date.now();
  container.insertAdjacentHTML('beforeend',
    `<div class="message assistant streaming no-text" data-streaming="true" data-timestamp="${ts}">
      <div class="message-header">
        <span class="message-role assistant">π</span>
        <span class="badge streaming">●</span>
        <span class="message-time">${formatTime(ts)}</span>
      </div>
    </div>`);
  return container.querySelector('.message.assistant[data-streaming="true"]');
}

function renderStreamingMessage(message) {
  const container = document.getElementById('messages');
  if (!container) return;
  const wasPinned = isPinnedToBottom(container);
  const el = ensureStreamingElement(container);

  const blocks = Array.isArray(message.content)
    ? message.content
    : (typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : []);

  blocks.forEach((block, i) => {
    let blockEl = el.querySelector(`[data-block-index="${i}"]`);
    if (blockEl && blockEl.dataset.blockType !== block.type) { blockEl.remove(); blockEl = null; }

    if (block.type === 'thinking') {
      const text = block.thinking || '';
      if (!blockEl) {
        el.insertAdjacentHTML('beforeend',
          `<details class="thinking-block" data-block-index="${i}" data-block-type="thinking">
            <summary class="thinking-header"><span class="thinking-label">Thinking</span><span class="thinking-preview"></span></summary>
            <div class="thinking-text"></div>
          </details>`);
        blockEl = el.querySelector(`[data-block-index="${i}"]`);
      }
      if (blockEl._src !== text) {
        blockEl._src = text;
        blockEl.querySelector('.thinking-preview').textContent = text.substring(0, 80).replace(/\n/g, ' ') + '…';
        blockEl.querySelector('.thinking-text').textContent = text;
      }
    } else if (block.type === 'text') {
      const text = block.text || '';
      if (!blockEl) {
        el.insertAdjacentHTML('beforeend',
          `<div class="message-content" data-block-index="${i}" data-block-type="text"><div class="markdown-body"></div></div>`);
        blockEl = el.querySelector(`[data-block-index="${i}"]`);
      }
      if (blockEl._src !== text) {
        blockEl._src = text;
        blockEl.querySelector('.markdown-body').innerHTML = formatMarkdown(text);
      }
    } else if (block.type === 'toolCall') {
      const args = block.arguments || {};
      const argsJson = JSON.stringify(args, null, 2);
      if (!blockEl) {
        el.insertAdjacentHTML('beforeend',
          `<details class="tool-call" data-block-index="${i}" data-block-type="toolCall">
            <summary class="tool-call-header">
              <span class="tool-call-icon">⚡</span><span class="tool-call-name"></span>
              <span class="tool-call-summary"></span>
            </summary>
            <div class="tool-call-content"><pre><code></code></pre></div>
          </details>`);
        blockEl = el.querySelector(`[data-block-index="${i}"]`);
      }
      if (blockEl._src !== argsJson) {
        blockEl._src = argsJson;
        blockEl.querySelector('.tool-call-name').textContent = block.name || 'tool';
        blockEl.querySelector('.tool-call-summary').textContent = getToolSummary(block.name, args);
        blockEl.querySelector('.tool-call-content code').textContent = argsJson;
      }
    }
  });

  // Same predicate as the static renderer (helpers.js) — the two maintaining
  // this independently is how they drifted on errorMessage handling.
  el.classList.toggle('no-text', !messageHasVisibleText(message));
  if (wasPinned) scrollToBottom(container); else updateJumpButton(container);
}

function setStatus(message, type = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
}

// =========================================================================
// Mood indicator — web fallback for the mood extension's custom editor
// =========================================================================

function setMoodIndicator(description, face) {
  const inputArea = document.querySelector('.input-area');
  if (!inputArea) return;

  let el = document.getElementById('moodIndicator');
  const mood = normalizeMood(description, face);
  if (!mood) {
    el?.remove();
    return;
  }

  if (!el) {
    el = document.createElement('div');
    el.id = 'moodIndicator';
    el.className = 'mood-indicator';
    inputArea.insertBefore(el, inputArea.firstChild);
  }

  el.dataset.moodDescription = mood.description;
  el.dataset.moodFace = mood.face;
  el.textContent = `${mood.description} ${mood.face}`.trim();
}

function applyMoodFromTool(toolName, args) {
  if (toolName !== 'set_mood') return;
  // Known set_mood arg shapes: {description, kaomoji} (the mood extension)
  // and {mood, label?} (footer-style variants — mood word or kaomoji, plus
  // an optional label).
  setMoodIndicator(args?.description ?? args?.label, args?.kaomoji || args?.face || args?.mood);
}

function updateMoodFromMessages(messages) {
  for (const msg of messages || []) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block?.type === 'toolCall' && block.name === 'set_mood') {
        applyMoodFromTool(block.name, block.arguments || {});
      }
    }
  }
}

// =========================================================================
// Extension UI — unobtrusive hidable cards
// =========================================================================

const extUIState = {
  widgets: new Map(),      // key -> { el, collapsed } — current session only
  statuses: new Map(),     // key -> el — current session only
  collapsed: new Map(),    // `sessionId|key` -> bool — survives session switches
};

// Extension UI is per-session: wipe the previous session's widgets, status
// badges, and dialog overlays when switching. The server replays the new
// session's remembered state once the stream connects, so elements come back
// when switching to a session that has them.
function clearExtensionUI() {
  for (const { el } of extUIState.widgets.values()) el.remove();
  extUIState.widgets.clear();
  for (const badge of extUIState.statuses.values()) badge.remove();
  extUIState.statuses.clear();
  for (const overlay of openExtDialogs.values()) overlay.remove();
  openExtDialogs.clear();
}

function getToastContainer() {
  let el = document.getElementById('extUiToasts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'extUiToasts';
    el.className = 'ext-ui-toasts';
    document.body.appendChild(el);
  }
  return el;
}

function handleExtensionUI(req) {
  // Extension strings arrive styled for the terminal (theme.fg ANSI codes) —
  // strip them everywhere up front instead of per render site.
  if (Array.isArray(req.widgetLines)) req.widgetLines = req.widgetLines.map(stripAnsi);
  if (Array.isArray(req.options)) req.options = req.options.map(o => typeof o === 'string' ? stripAnsi(o) : o);
  for (const f of ['message', 'statusText', 'title', 'text', 'prefill', 'placeholder']) {
    if (typeof req[f] === 'string') req[f] = stripAnsi(req[f]);
  }
  switch (req.method) {
    case 'notify':
      showExtToast(req.message || '', req.notifyType || 'info');
      break;
    case 'setWidget':
      showExtWidget(req.widgetKey || 'default', req.widgetLines, req.widgetPlacement);
      break;
    case 'setStatus':
      showExtStatus(req.statusKey || 'default', req.statusText);
      break;
    case 'setTitle':
      document.title = req.title || 'pi-dish';
      break;
    case 'set_editor_text': {
      const input = document.getElementById('promptInput');
      if (input) {
        input.value = req.text || '';
        // Run the normal input pipeline (autosize, draft save, autocomplete).
        input.dispatchEvent(new Event('input'));
      }
      break;
    }
    case 'select':
    case 'confirm':
    case 'input':
    case 'editor':
      // We can't respond to dialogs, so show them as read-only info cards
      showExtDialog(req);
      break;
    default:
      // Unknown method — show as a generic toast so it's not silently lost
      showExtToast(`[${req.method}] ${JSON.stringify(req).slice(0, 200)}`, 'info');
  }
}

function showExtToast(message, type) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `ext-ui-toast ${type}`;

  const icons = { info: 'ℹ', warning: '⚠', error: '✖' };
  toast.innerHTML = `
    <span class="ext-ui-toast-icon">${icons[type] || icons.info}</span>
    <span class="ext-ui-toast-body">${escapeHtml(message)}</span>
    <button class="ext-ui-toast-close" title="Dismiss">×</button>
  `;

  toast.querySelector('.ext-ui-toast-close').addEventListener('click', () => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 200);
  });

  container.appendChild(toast);

  // Auto-dismiss info toasts after 6s; warnings/errors stay until manually closed
  if (type === 'info') {
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 200);
      }
    }, 6000);
  }
}

function showExtWidget(key, lines, placement) {
  // Pi's default placement is above the editor. Keep widgets near the prompt
  // instead of at the top of the scrollback where they are easy to miss.
  // Look the element up via state, not a selector built from the raw key —
  // a key containing a quote made querySelector throw, so the widget
  // silently never rendered.
  let container = extUIState.widgets.get(key)?.el;
  if (container && !container.isConnected) container = null;

  if (!lines || !lines.length) {
    if (container) {
      container.classList.add('hidden');
      setTimeout(() => container.remove(), 200);
    }
    extUIState.widgets.delete(key);
    return;
  }

  const existing = extUIState.widgets.get(key);
  const collapsedKey = (currentSession?.id || '') + '|' + key;
  const wasCollapsed = existing?.collapsed ?? extUIState.collapsed.get(collapsedKey) ?? false;

  if (!container) {
    container = document.createElement('div');
    container.className = 'ext-ui-widget';
    container.dataset.widgetKey = key;
    if (wasCollapsed) container.classList.add('collapsed');

    container.innerHTML = `
      <div class="ext-ui-widget-header">
        <span class="ext-ui-widget-label">${escapeHtml(key)}</span>
        <span class="ext-ui-widget-toggle">▼</span>
      </div>
      <pre class="ext-ui-widget-body"></pre>
    `;

    container.querySelector('.ext-ui-widget-header').addEventListener('click', () => {
      container.classList.toggle('collapsed');
      const collapsed = container.classList.contains('collapsed');
      extUIState.widgets.set(key, { el: container, collapsed });
      extUIState.collapsed.set(collapsedKey, collapsed);
    });

    const inputArea = document.querySelector('.input-area');
    const textarea = document.getElementById('promptInput');
    if (placement === 'belowEditor' && inputArea && textarea) {
      inputArea.insertBefore(container, textarea.nextSibling);
    } else if (inputArea?.parentNode) {
      inputArea.parentNode.insertBefore(container, inputArea);
    } else {
      document.getElementById('messages')?.insertAdjacentElement('beforebegin', container);
    }
  }

  container.classList.remove('hidden');
  container.querySelector('.ext-ui-widget-body').textContent = lines.join('\n');
  extUIState.widgets.set(key, { el: container, collapsed: container.classList.contains('collapsed') });
}

function showExtStatus(key, text) {
  const meta = document.querySelector('.session-meta-desktop');
  if (!meta) return;

  // State-map lookup for the same reason as showExtWidget: the raw key is
  // not safe to splice into a CSS selector.
  let badge = extUIState.statuses.get(key);
  if (badge && !badge.isConnected) badge = null;

  if (!text) {
    badge?.remove();
    extUIState.statuses.delete(key);
    return;
  }

  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'ext-ui-status-badge';
    badge.dataset.statusKey = key;
    badge.title = `Status from ${key}`;
    meta.appendChild(badge);
  }

  badge.textContent = text;
  extUIState.statuses.set(key, badge);
}

// Interactive dialogs: extensions block on select/confirm/input/editor. We
// render a real modal and POST the answer back; the session unblocks. For TUI
// sessions the same dialog is also on screen in the terminal — whoever
// answers first wins (the server tells us via extension_ui_resolved).
const openExtDialogs = new Map(); // requestId -> overlay element

function sendExtDialogResponse(requestId, response) {
  if (!currentSession) return;
  apiSend(`/api/sessions/${currentSession.id}/ui-response`, { requestId, ...response })
    .catch(e => setStatus('Dialog response failed: ' + e.message, 'error'));
  dismissExtDialog(requestId);
}

function dismissExtDialog(requestId) {
  const overlay = openExtDialogs.get(requestId);
  if (overlay) overlay.remove();
  openExtDialogs.delete(requestId);
}

function showExtDialog(req) {
  if (!req.id || openExtDialogs.has(req.id)) return;

  const overlay = document.createElement('div');
  overlay.className = 'ext-ui-dialog-overlay';

  const card = document.createElement('div');
  card.className = 'ext-ui-dialog-modal';

  let bodyHtml = '';
  if (req.title) bodyHtml += `<div class="ext-ui-dialog-title">${escapeHtml(req.title)}</div>`;
  if (req.message) bodyHtml += `<div class="ext-ui-dialog-message">${escapeHtml(req.message)}</div>`;

  if (req.method === 'select') {
    bodyHtml += '<div class="ext-ui-dialog-options">' +
      (req.options || []).map((opt, i) =>
        `<button class="ext-ui-dialog-option" data-value="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`
      ).join('') + '</div>';
  } else if (req.method === 'confirm') {
    bodyHtml += `<div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn primary" data-action="yes">Yes</button>
      <button class="ext-ui-dialog-btn" data-action="no">No</button>
    </div>`;
  } else if (req.method === 'input') {
    bodyHtml += `<input class="ext-ui-dialog-input" type="text" placeholder="${escapeHtml(req.placeholder || '')}">
    <div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn primary" data-action="submit">Submit</button>
      <button class="ext-ui-dialog-btn" data-action="cancel">Cancel</button>
    </div>`;
  } else if (req.method === 'editor') {
    bodyHtml += `<textarea class="ext-ui-dialog-editor" rows="8">${escapeHtml(req.prefill || '')}</textarea>
    <div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn primary" data-action="submit">Submit</button>
      <button class="ext-ui-dialog-btn" data-action="cancel">Cancel</button>
    </div>`;
  }

  bodyHtml += `<button class="ext-ui-dialog-close" title="Dismiss (cancel)">×</button>`;
  card.innerHTML = bodyHtml;
  overlay.appendChild(card);

  card.querySelectorAll('.ext-ui-dialog-option').forEach(btn => {
    btn.addEventListener('click', () => sendExtDialogResponse(req.id, { value: btn.dataset.value }));
  });
  card.querySelectorAll('.ext-ui-dialog-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'yes') sendExtDialogResponse(req.id, { confirmed: true });
      else if (action === 'no') sendExtDialogResponse(req.id, { confirmed: false });
      else if (action === 'cancel') sendExtDialogResponse(req.id, { cancelled: true });
      else if (action === 'submit') {
        const field = card.querySelector('.ext-ui-dialog-input, .ext-ui-dialog-editor');
        sendExtDialogResponse(req.id, { value: field ? field.value : '' });
      }
    });
  });
  card.querySelector('.ext-ui-dialog-close').addEventListener('click', () => {
    sendExtDialogResponse(req.id, { cancelled: true });
  });

  document.body.appendChild(overlay);
  openExtDialogs.set(req.id, overlay);
  const field = card.querySelector('.ext-ui-dialog-input, .ext-ui-dialog-editor');
  if (field) field.focus();
}

// Markdown config. marked v12 dropped the `highlight` option — syntax
// highlighting happens post-render via applyHighlight() instead.
//
// marked emits raw HTML and untouched link/image URLs, and the parsed result
// is written straight to innerHTML — so harden the renderer at the one
// chokepoint every message flows through: escape raw HTML tokens (show, don't
// execute) and neutralize script-executing URL schemes in links/images.
(function() {
  if (typeof marked === 'undefined') return;
  marked.use({
    breaks: true,
    gfm: true,
    renderer: {
      html(html) { return escapeHtml(typeof html === 'string' ? html : (html && html.text) || ''); },
    },
    walkTokens(token) {
      if (token.type === 'link' || token.type === 'image') token.href = sanitizeMarkdownUrl(token.href);
    },
  });
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

// Post-render pass over final markdown: syntax-highlight fenced code blocks
// and give each one a copy button. Runs after final renders only — streaming
// re-renders skip it to stay cheap — and must stay idempotent (it re-runs on
// every append/prepend). The wrapper div keeps the button pinned while the
// <pre> scrolls horizontally (an absolutely positioned child of the <pre>
// would scroll away with the overflowing content).
function applyHighlight(el) {
  const root = el || document.getElementById('messages');
  if (!root) return;
  root.querySelectorAll('.markdown-body pre code').forEach(code => {
    const pre = code.closest('pre');
    if (pre && !pre.parentElement.classList.contains('code-block')) {
      const wrap = document.createElement('div');
      wrap.className = 'code-block';
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.title = 'Copy code';
      btn.textContent = '⧉';
      pre.replaceWith(wrap);
      wrap.append(btn, pre);
    }
    if (typeof hljs === 'undefined' || code.dataset.highlighted) return;
    try { hljs.highlightElement(code); } catch (e) {}
  });
  linkifyFilePaths(root);
}

// Mark file mentions clickable: inline code spans and tool-call summaries
// whose whole text looks like a path, plus path tokens inside plain prose
// (findPathTokens in helpers.js). Runs inside applyHighlight so every final
// render gets it; idempotent — linked elements are skipped and each
// .markdown-body's prose is walked once (data-linkified). Clicks are
// delegated on document → openFileViewer.
function linkifyFilePaths(root) {
  root.querySelectorAll('.markdown-body code, .tool-call-summary, .live-tool-summary').forEach(el => {
    if (el.closest('pre') || el.classList.contains('file-link') || el.children.length) return;
    if (looksLikeFilePath(el.textContent.trim())) {
      el.classList.add('file-link');
      el.title = 'Open file';
    }
  });

  root.querySelectorAll('.markdown-body:not([data-linkified])').forEach(body => {
    body.dataset.linkified = '1';
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        return n.parentElement && !n.parentElement.closest('code, a, pre, .file-link')
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const tokens = findPathTokens(node.textContent);
      if (!tokens.length) continue;
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const t of tokens) {
        frag.append(node.textContent.slice(pos, t.start));
        const span = document.createElement('span');
        span.className = 'file-link';
        span.title = 'Open file';
        span.textContent = t.token;
        frag.append(span);
        pos = t.end;
      }
      frag.append(node.textContent.slice(pos));
      node.replaceWith(frag);
    }
  });
}

// navigator.clipboard only exists in secure contexts — a phone hitting the
// LAN server over plain http gets undefined, which made the old copy button
// a silent no-op. Fall back to the legacy execCommand path there.
function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', ''); // no mobile keyboard flash on focus
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    if (ok) resolve(); else reject(new Error('execCommand copy rejected'));
  });
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
  if (e.key !== 'Escape') return;
  if (document.getElementById('commentBubble').style.display !== 'none') {
    e.preventDefault(); closeCommentBubble();
  } else if (document.getElementById('responseDetailsModal').style.display !== 'none') {
    e.preventDefault(); closeResponseDetails();
  } else if (document.getElementById('settingsModal').style.display !== 'none') {
    e.preventDefault(); closeSettingsModal();
  } else if (document.getElementById('treeModal').style.display !== 'none') {
    e.preventDefault(); closeTreeModal();
  } else if (document.getElementById('statsModal').style.display !== 'none') {
    e.preventDefault(); closeStatsModal();
  } else if (document.getElementById('artifactsModal').style.display !== 'none') {
    e.preventDefault(); closeArtifactsModal();
  } else if (isSearchViewOpen()) {
    e.preventDefault(); closeSearchView();
  } else if (isUsageViewOpen()) {
    e.preventDefault(); closeUsageView();
  } else if (isFileViewOpen()) {
    e.preventDefault(); closeFileView();
  } else if (isDiffViewOpen()) {
    e.preventDefault(); closeDiffView();
  }
});

function filterTree(query) {
  if (!treeData) return;
  var filterMode = document.getElementById('treeFilter').value;
  var tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  
  var filtered = treeData.nodes.filter(function(node) {
    if (filterMode === 'user-only' && !(node.type === 'message' && node.role === 'user')) return false;
    // No Tools hides the whole tool layer: results AND the text-less
    // assistant messages that only carry tool calls (keep the leaf — it's
    // the branch point the modal exists to show).
    if (filterMode === 'no-tools' && node.type === 'message' &&
        (node.role === 'toolResult' ||
         (node.role === 'assistant' && !node.text && !node.isLeaf))) return false;
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
    
    html += '<div class="' + classes + '" data-id="' + node.id + '" style="--tree-depth:' + node.depth + '" onclick="selectTreeNode(\'' + node.id + '\')">';
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
      // Tool-only message: name the calls (server sends getToolSummary
      // strings) instead of an anonymous "(tool use)".
      if (!text && node.toolCalls && node.toolCalls.length) {
        var calls = node.toolCalls.map(function(tc) { return tc.args ? tc.name + ': ' + tc.args : tc.name; }).join(' · ');
        return '<span class="tree-role assistant">assistant:</span><span class="tree-text muted">' + escapeHtml(calls) + '</span>';
      }
      if (!text) text = '(empty)';
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
  // Summarize default persists across uses — retrying a prompt wants it off,
  // the explore-then-return workflow wants it on every time.
  var summarize = localStorage.getItem('pi-dish-branch-summarize') === '1';
  document.getElementById('treeStatus').innerHTML =
    '<div class="branch-confirm">' +
      '<label class="branch-summarize-label"><input type="checkbox" id="branchSummarize"' + (summarize ? ' checked' : '') +
        ' onchange="toggleBranchInstructions()"> Summarize abandoned branch</label>' +
      '<input type="text" id="branchInstructions" class="branch-instructions" placeholder="Summary instructions (optional)"' +
        (summarize ? '' : ' style="display:none"') + '>' +
      '<span class="branch-confirm-btns">' +
        '<button class="btn-sm btn-branch" id="branchGoBtn" onclick="confirmBranch()">Branch from here</button>' +
        '<button class="btn-sm" onclick="cancelBranch()">Cancel</button>' +
      '</span>' +
    '</div>';
}

function toggleBranchInstructions() {
  var on = document.getElementById('branchSummarize')?.checked;
  var input = document.getElementById('branchInstructions');
  if (input) input.style.display = on ? '' : 'none';
}

function cancelBranch() {
  pendingBranchId = null;
  document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
  document.getElementById('treeStatus').textContent = document.querySelectorAll('.tree-node').length + ' entries';
}

async function confirmBranch() {
  if (!currentSession || !pendingBranchId) return;
  var entryId = pendingBranchId;
  var summarize = !!document.getElementById('branchSummarize')?.checked;
  var customInstructions = document.getElementById('branchInstructions')?.value.trim() || undefined;
  localStorage.setItem('pi-dish-branch-summarize', summarize ? '1' : '0');
  var btn = document.getElementById('branchGoBtn');
  if (btn) { btn.disabled = true; btn.textContent = summarize ? 'Summarizing…' : 'Branching…'; }
  setStatus(summarize ? 'Summarizing abandoned branch…' : 'Branching...', 'working');
  try {
    var data = await apiSend('/api/sessions/' + currentSession.id + '/branch',
      { entryId, summarize, customInstructions });
    pendingBranchId = null;
    closeTreeModal();
    // A user-message target means "re-edit this prompt" (leaf moves to its
    // parent) — mirror the TUI and prefill the composer, but never clobber
    // a draft already in progress. Written to the draft store because the
    // reload below runs restorePromptState, which overwrites the input.
    if (data.editorText) {
      try {
        var key = draftKey(currentSession.id);
        if (!(localStorage.getItem(key) || '').trim()) localStorage.setItem(key, data.editorText);
      } catch {}
    }
    setStatus('Branched — reloading');
    selectSession(currentSession.id, { forceTranscriptReload: true });
  } catch (e) {
    setStatus('Branch failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Branch from here'; }
  }
}

// =========================================================================
// Terminal (feature-flagged: /api/config .terminal → PI_DISH_TERMINAL=1).
// One panel, one PTY per session server-side. The PTY survives socket drops
// (phone screen lock), so reopening reattaches and replays scrollback.
// =========================================================================

let appConfig = { terminal: false };
let terminalAssetsPromise = null;

function loadTerminalAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Failed to load ${attrs.src || attrs.href}`));
    document.head.appendChild(el);
  });
}

function loadTerminalAssets() {
  if (terminalAssetsPromise) return terminalAssetsPromise;
  terminalAssetsPromise = (async () => {
    const css = loadTerminalAsset('link', { rel: 'stylesheet', href: 'vendor/xterm.css' });
    await Promise.all([
      css,
      loadTerminalAsset('script', { src: 'vendor/xterm.js' }),
    ]);
    await loadTerminalAsset('script', { src: 'vendor/xterm-addon-fit.js' });
  })();
  return terminalAssetsPromise;
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    appConfig = await res.json();
    if (appConfig.terminal) await loadTerminalAssets();
  } catch { /* feature stays hidden */ }
  updateTerminalButtons();
}

// { term, fitAddon, ws, sessionId, reconnectTimer, attempts, closedByUser, exited }
let termState = null;
let termCtrlLatch = false;

function terminalFeatureAvailable() {
  return !!(appConfig.terminal && typeof Terminal !== 'undefined');
}

function updateTerminalButtons() {
  const show = terminalFeatureAvailable() && currentSession?.isActive;
  const btn = document.getElementById('btnTerminal');
  if (btn) btn.style.display = show ? '' : 'none';
  const row = document.getElementById('cpTerminalRow');
  if (row) row.style.display = show ? '' : 'none';
}

// =========================================================================
// Theme — all colors flow from the :root tokens (style.css). Built-in themes
// are [data-theme] blocks; user themes (~/.pi/dish/themes/*.json, served by
// /api/themes) are token maps applied as inline custom properties over the
// default palette. The applied theme + tokens are cached in localStorage so
// index.html can re-apply them pre-paint; loadThemes() then refreshes the
// cache from the server (the theme file may have changed on disk).
// =========================================================================

let availableThemes = [{ id: 'solarized', builtin: true }, { id: 'graphite', builtin: true }];

async function loadThemes() {
  try {
    const res = await fetch('/api/themes');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.themes) && data.themes.length) availableThemes = data.themes;
    }
  } catch {}
  renderThemeSelect();
  // Re-resolve the saved choice against the fresh list: picks up edits to a
  // custom theme's file, and falls back to default if the file is gone.
  const saved = localStorage.getItem('pi-dish-theme');
  if (saved && saved !== 'solarized') applyTheme(saved);
}

function renderThemeSelect() {
  const sel = document.getElementById('themeSelect');
  if (!sel) return;
  const cur = localStorage.getItem('pi-dish-theme') || 'solarized';
  sel.innerHTML = availableThemes.map((t) =>
    `<option value="${escapeHtml(t.id)}"${t.id === cur ? ' selected' : ''}>${escapeHtml(t.id)}</option>`).join('');
}

function applyTheme(id) {
  const theme = availableThemes.find((t) => t.id === id) || availableThemes[0];
  const root = document.documentElement;
  // Wipe the previous theme's inline tokens (all inline --props are ours).
  for (const prop of [...root.style]) {
    if (prop.startsWith('--')) root.style.removeProperty(prop);
  }
  if (theme.id === 'solarized') delete root.dataset.theme;
  else root.dataset.theme = theme.id;
  for (const [k, v] of Object.entries(theme.tokens || {})) root.style.setProperty(k, v);
  localStorage.setItem('pi-dish-theme', theme.id);
  localStorage.setItem('pi-dish-theme-tokens', JSON.stringify(theme.tokens || null));
  renderThemeSelect();
  // The terminal bakes token colors in at open time — re-derive live.
  if (termState?.term) termState.term.options.theme = terminalTheme();
}

// xterm theme from the :root Solarized tokens; the handful of ANSI slots the
// palette has no token for (magenta/violet, bright variants) use canonical
// Solarized values.
function terminalTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    background: v('--bg-darker'),
    foreground: v('--text'),
    cursor: v('--text-bright'),
    cursorAccent: v('--bg-darker'),
    selectionBackground: v('--bg-card'),
    black: v('--bg-card'),
    red: v('--error'),
    green: v('--success'),
    yellow: v('--warning'),
    blue: v('--accent'),
    magenta: '#d33682',
    cyan: v('--cyan'),
    white: '#eee8d5',
    brightBlack: v('--text-muted'),
    brightRed: v('--orange'),
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  };
}

function toggleTerminal() {
  if (termState) closeTerminal();
  else openTerminal();
}

async function openTerminal(mode) {
  if (!terminalFeatureAvailable() || !currentSession || termState) return;
  // 'shell' (default) or 'tmux' (a grouped tmux client viewing the pane the
  // session's pi runs in). The last choice sticks per session.
  if (!mode) mode = localStorage.getItem('pi-dish-terminal-mode-' + currentSession.id) === 'tmux' ? 'tmux' : 'shell';
  const panel = document.getElementById('terminalPanel');
  const container = document.getElementById('terminalContainer');
  applySavedTerminalSize(panel);
  panel.style.display = '';
  document.getElementById('terminalCwd').textContent = shortCwd(currentSession.cwd || '~');

  // Have the Nerd Font symbols ready before xterm first paints — otherwise
  // prompt icons flash as tofu until the lazy font load lands. Never block
  // the terminal on it (offline cache miss etc. just falls back to squares).
  try {
    await Promise.race([
      document.fonts.load('12px "Symbols Nerd Font Mono"'),
      new Promise(r => setTimeout(r, 2000)),
    ]);
  } catch {}
  if (termState || !currentSession) return; // double-click / switched away during the await

  const css = getComputedStyle(document.documentElement);
  const term = new Terminal({
    fontFamily: css.getPropertyValue('--font-mono').trim() + ", 'Symbols Nerd Font Mono'",
    fontSize: window.innerWidth <= 768 ? 12 : 13,
    theme: terminalTheme(),
    scrollback: 5000,
    cursorBlink: true,
  });
  const FitCtor = window.FitAddon && (window.FitAddon.FitAddon || window.FitAddon);
  const fitAddon = FitCtor ? new FitCtor() : null;
  if (fitAddon) term.loadAddon(fitAddon);

  termState = {
    term, fitAddon, ws: null, sessionId: currentSession.id, mode,
    tmuxPrefix: null, reconnectTimer: null, attempts: 0, closedByUser: false, exited: false,
  };
  updateTerminalModeUI();

  term.open(container);
  fitTerminal();
  term.onData((data) => {
    // Ctrl latch (mobile key bar): the next printable key is sent as its
    // control character.
    if (termCtrlLatch && data.length === 1) {
      const code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) data = String.fromCharCode(code & 31);
      setTermCtrlLatch(false);
    }
    termSend({ type: 'input', data });
  });
  term.onResize(({ cols, rows }) => termSend({ type: 'resize', cols, rows }));

  window.addEventListener('resize', fitTerminal);
  window.visualViewport?.addEventListener('resize', fitTerminal);

  connectTerminalWS();
  term.focus();
}

function fitTerminal() {
  if (!termState?.fitAddon) return;
  try { termState.fitAddon.fit(); } catch {}
}

function termSend(msg) {
  const ws = termState?.ws;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function setTerminalStatus(text, cls) {
  const el = document.getElementById('terminalStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'terminal-status' + (cls ? ' ' + cls : '');
}

function connectTerminalWS() {
  if (!termState) return;
  const state = termState;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const modeQ = state.mode === 'tmux' ? '?mode=tmux' : '';
  const ws = new WebSocket(`${proto}://${location.host}/api/sessions/${encodeURIComponent(state.sessionId)}/terminal${modeQ}`);
  state.ws = ws;
  setTerminalStatus(state.attempts ? 'reconnecting…' : 'connecting…', 'reconnecting');

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'attach') {
      state.attempts = 0;
      setTerminalStatus('');
      state.tmuxPrefix = msg.tmuxPrefix || null;
      updateTerminalModeUI();
      // Reattach: the replay buffer contains everything we may have already
      // rendered — reset and replay rather than double-print.
      state.term.reset();
      if (msg.replay) state.term.write(msg.replay);
      if (msg.cwd) document.getElementById('terminalCwd').textContent = shortCwd(msg.cwd);
      fitTerminal();
      termSend({ type: 'resize', cols: state.term.cols, rows: state.term.rows });
    } else if (msg.type === 'output') {
      state.term.write(msg.data);
    } else if (msg.type === 'exit') {
      state.exited = true;
      setTerminalStatus(`shell exited (${msg.code})`);
    } else if (msg.type === 'error') {
      state.exited = true;
      setTerminalStatus(msg.error, 'error');
    }
  };

  ws.onclose = () => {
    if (state !== termState || state.closedByUser || state.exited) return;
    // Auto-reconnect with backoff while the panel is open — phones drop the
    // socket on every screen lock; the server-side PTY is still there.
    const delay = Math.min(8000, 1000 * 2 ** state.attempts);
    state.attempts++;
    setTerminalStatus('disconnected — reconnecting…', 'reconnecting');
    state.reconnectTimer = setTimeout(connectTerminalWS, delay);
  };
}

function closeTerminal() {
  if (!termState) return;
  const state = termState;
  termState = null;
  state.closedByUser = true;
  clearTimeout(state.reconnectTimer);
  try { state.ws?.close(); } catch {}
  state.term.dispose();
  window.removeEventListener('resize', fitTerminal);
  window.visualViewport?.removeEventListener('resize', fitTerminal);
  setTermCtrlLatch(false);
  setTerminalStatus('');
  document.getElementById('terminalPanel').style.display = 'none';
}

// The mode button shows the *target* mode; the keybar prefix key appears
// only on a tmux attach that reported its prefix. Both are re-derived on
// open, attach, and mode switch.
function updateTerminalModeUI() {
  const btn = document.getElementById('termModeBtn');
  if (btn) {
    const showBtn = !!(termState && appConfig.tmux && currentSession?.isActive);
    btn.style.display = showBtn ? '' : 'none';
    if (termState?.mode === 'tmux') {
      btn.textContent = '⇆ shell';
      btn.title = 'Switch to a plain shell at the session cwd';
    } else {
      btn.textContent = '⇆ pi tmux';
      btn.title = "Attach to the tmux pane the session's pi runs in";
    }
  }
  const prefixBtn = document.getElementById('termKeyPrefix');
  if (prefixBtn) {
    const seq = termState?.mode === 'tmux' ? tmuxPrefixSeq(termState.tmuxPrefix) : null;
    prefixBtn.style.display = seq ? '' : 'none';
    if (seq) prefixBtn.textContent = termState.tmuxPrefix;
  }
}

function switchTerminalMode() {
  if (!termState || !currentSession) return;
  const next = termState.mode === 'tmux' ? 'shell' : 'tmux';
  const id = termState.sessionId;
  if (next === 'tmux') localStorage.setItem('pi-dish-terminal-mode-' + id, 'tmux');
  else localStorage.removeItem('pi-dish-terminal-mode-' + id);
  closeTerminal();
  openTerminal(next);
}

function restartTerminalShell() {
  if (!termState) return;
  const q = termState.mode === 'tmux'
    ? 'Reattach the tmux client? (The tmux session and everything in it keeps running.)'
    : 'Restart shell? Anything running in it will be killed.';
  if (!confirm(q)) return;
  termState.exited = false; // a fresh shell supersedes an exited one
  if (termState.ws?.readyState === WebSocket.OPEN) {
    termSend({ type: 'restart' });
  } else {
    // Shell exited → the server closed the socket; reconnecting spawns a
    // fresh PTY (the exited one is already out of the pool).
    clearTimeout(termState.reconnectTimer);
    termState.attempts = 0;
    connectTerminalWS();
  }
  termState.term.focus();
}

function setTermCtrlLatch(on) {
  termCtrlLatch = on;
  document.getElementById('termKeyCtrl')?.classList.toggle('latched', on);
}

const TERM_KEY_SEQUENCES = {
  esc: '\x1b',
  tab: '\t',
  'ctrl-c': '\x03',
};

function termKeybarPress(key) {
  if (!termState) return;
  if (key === 'ctrl') { setTermCtrlLatch(!termCtrlLatch); return; }
  if (key === 'tmux-prefix') {
    const seq = tmuxPrefixSeq(termState.tmuxPrefix);
    if (seq) termSend({ type: 'input', data: seq });
    termState.term.focus();
    return;
  }
  let seq = TERM_KEY_SEQUENCES[key];
  if (!seq) {
    // Arrows honor DECCKM (application cursor keys) so vim/less/etc work.
    const app = termState.term.modes?.applicationCursorKeysMode;
    const dir = { up: 'A', down: 'B', right: 'C', left: 'D' }[key];
    if (!dir) return;
    seq = (app ? '\x1bO' : '\x1b[') + dir;
  }
  termSend({ type: 'input', data: seq });
  termState.term.focus();
}

// Drag the panel's top edge to resize it. Height persists as a percentage of
// the session view (so it survives window resizes and different screens);
// the flex-basis override lives in inline style, beating the stylesheet's
// 45%/52% defaults. Pointer capture keeps the drag on the handle — no
// document-level listeners needed (the handle is never reinserted mid-drag,
// unlike the pinned-session rows).
function initTerminalResize() {
  const handle = document.getElementById('terminalResizeHandle');
  const panel = document.getElementById('terminalPanel');
  if (!handle || !panel) return;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panel.offsetHeight;
    const parentHeight = panel.parentElement.clientHeight;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    const onMove = (ev) => {
      const px = clampTerminalHeight(startHeight + (startY - ev.clientY), parentHeight);
      panel.style.flexBasis = px + 'px';
      fitTerminal();
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      handle.classList.remove('dragging');
      const pct = (panel.offsetHeight / parentHeight) * 100;
      localStorage.setItem('pi-dish-terminal-size', pct.toFixed(1));
      panel.style.flexBasis = pct.toFixed(1) + '%';
      fitTerminal();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

function clampTerminalHeight(px, parentHeight) {
  return Math.min(Math.round(parentHeight * 0.8), Math.max(140, px));
}

function applySavedTerminalSize(panel) {
  const saved = parseFloat(localStorage.getItem('pi-dish-terminal-size'));
  if (Number.isFinite(saved)) {
    panel.style.flexBasis = Math.min(80, Math.max(10, saved)) + '%';
  }
}

function initTerminalKeybar() {
  const bar = document.getElementById('terminalKeybar');
  if (!bar) return;
  // pointerdown is prevented so key taps never blur the terminal's hidden
  // textarea — a blur closes the phone keyboard mid-typing.
  bar.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button[data-termkey]');
    if (!btn) return;
    e.preventDefault();
    termKeybarPress(btn.dataset.termkey);
  });
}
