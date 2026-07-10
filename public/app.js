// State
let sessions = { active: [], previous: [] };
let currentSession = null;

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
  loadSpawnTargets(); // populate the "Run in" tmux selector (hidden if no tmux)
  initTerminalKeybar();
  initTerminalResize();
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

  promptInput.addEventListener('blur', () => { setTimeout(hideAutocomplete, 200); });

  const messagesEl = document.getElementById('messages');
  if (messagesEl) {
    messagesEl.addEventListener('scroll', () => updateJumpButton(messagesEl), { passive: true });
    // Any deliberate gesture in the feed cancels forced follow. Harmless when
    // already at the bottom — normal proximity pinning takes over seamlessly.
    const cancelFollow = () => { followStream = false; };
    messagesEl.addEventListener('wheel', cancelFollow, { passive: true });
    messagesEl.addEventListener('touchmove', cancelFollow, { passive: true });
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
// anywhere (fuzzy file search under the session cwd, served by fff).
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
    `<div class="autocomplete-item${i === 0 ? ' active' : ''}" data-file="${escapeHtml(f.path)}">
      <span class="autocomplete-icon">📄</span>
      <span class="autocomplete-name">${escapeHtml(f.path)}</span>
      <span class="autocomplete-desc">${GIT_STATUS_LABEL[f.gitStatus] || ''}</span>
    </div>`).join(''));
}

// Replace the @token at the caret with the chosen path.
function acceptFileMention(relPath) {
  const input = document.getElementById('promptInput');
  const caret = input.selectionStart ?? input.value.length;
  const m = input.value.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
  hideAutocomplete();
  if (!m) return;
  const start = caret - m[1].length - 1; // include the '@'
  input.value = input.value.slice(0, start) + '@' + relPath + ' ' + input.value.slice(caret);
  const pos = start + relPath.length + 2;
  input.focus();
  input.setSelectionRange(pos, pos);
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
  if (file != null) acceptFileMention(file);
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
  if (sidebarTab === 'all') {
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

// On the Active tab the historical list is invisible, so polls request
// active sessions only (?active=1 — the server then skips its full
// session-tree scan) and keep the previously fetched `previous` list.
// `withPrevious: true` forces a full fetch regardless of tab (initial load,
// which may need to restore a historical session).
async function loadSessions(query, { withPrevious = sidebarTab === 'all' } = {}) {
  try {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (!withPrevious) params.set('active', '1');
    const qs = params.toString();
    const res = await fetch('/api/sessions' + (qs ? '?' + qs : ''));
    const data = await res.json();
    sessions = {
      active: data.active || [],
      previous: withPrevious ? (data.previous || []) : sessions.previous,
    };
    // Viewing a session (with the tab visible) counts as having seen its
    // latest activity. Prune stale ids while we're at it — but only from an
    // unfiltered load, a search result is not the full list.
    if (currentSession && !document.hidden) {
      const fresh = findSession(currentSession.id);
      if (fresh) markSessionSeen(fresh.id, fresh.lastActivity);
    }
    if (!query) {
      for (const id of Object.keys(seenActivity)) {
        if (!sessions.active.some(s => s.id === id)) delete seenActivity[id];
      }
    }
    renderSessions();
    // The header renders from the detached currentSession copy — fold the
    // fresh list data (name, model, context, thinking) into it so polling
    // keeps the header honest too, not just the sidebar.
    if (currentSession) {
      const fresh = findSession(currentSession.id);
      if (fresh) {
        currentSession = { ...currentSession, ...fresh };
        updateSessionHeader();
      }
    }
  } catch (e) {
    console.error('Failed to load sessions:', e);
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
  let liveDot = '';
  if (session.turnInProgress) liveDot = '<span class="session-item-status working" title="Agent working"></span>';
  else if (isUnread(session)) liveDot = '<span class="session-item-status unread" title="New activity since you last looked"></span>';
  else if (sidebarTab === 'all' && session.isActive) liveDot = '<span class="live-dot" title="Active session"></span>';
  const displayName = session.name || 'Unnamed';
  const tokenDisplay = session.contextTokens ? `${formatTokens(session.contextTokens)} tok` : '';
  const timeAgo = formatRelativeTime(session.lastActivity);
  const isPinned = pinnedSessions.includes(session.id);
  const pinBtn = `<button class="session-pin-btn${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Unpin' : 'Pin to top'}">📌</button>`;
  // Rows in the pinned section get a drag handle (reorder) and a cwd hint —
  // they've left their workspace group, so the group label isn't there.
  const dragHandle = opts.pinnedRow ? '<span class="session-drag-handle" title="Drag to reorder">⠿</span>' : '';
  const cwdHint = opts.pinnedRow ? `<span class="session-item-cwd">${escapeHtml(shortCwd(session.cwd || '~'))}</span>` : '';

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
  const filtered = (sidebarTab === 'all' && filterQuery) ? showing : applyLocalFilter(showing, filterQuery);

  let html = '';
  if (filtered.length === 0) {
    const msg = sidebarTab === 'active'
      ? (active.length === 0 ? 'No active sessions<br><span style="font-size:11px">Click "+ New Session" or resume one from All</span>' : 'No matches')
      : (showing.length === 0 ? 'No sessions found' : 'No matches');
    html = `<div class="empty-session"><p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">${msg}</p></div>`;
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
    const tree = buildWorkspaceTree(groupByWorkspace(rest, collapsedGroups), collapsedGroups);
    html += tree.map(renderWorkspaceNode).join('');
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
 * data-cwd, the node's path prefix), this node's own sessions, then child
 * nodes nested in an indented .workspace-children. Collapsing a node hides
 * its whole subtree, so the header must not hide activity: surface the best
 * signal (working > unread) from all descendant sessions as a header dot.
 */
function renderWorkspaceNode(node) {
  const isCollapsed = collapsedGroups.has(node.path);
  let headerDot = '';
  if (isCollapsed) {
    const all = collectTreeSessions(node);
    if (all.some(s => s.turnInProgress)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
    else if (all.some(isUnread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
  }
  let body = '';
  if (!isCollapsed) {
    body = (node.sessions || []).map(s => renderSessionItem(s)).join('');
    if (node.children.length) {
      body += `<div class="workspace-children">${node.children.map(renderWorkspaceNode).join('')}</div>`;
    }
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

function findSession(id) {
  return sessions.active.find(s => s.id === id) || sessions.previous.find(s => s.id === id);
}

/**
 * Patch a session everywhere it lives. `currentSession` is a detached copy
 * of the list entry (selectSession/loadMessages spread new objects), so a
 * local change (rename, model switch, thinking level) must be written to
 * both and re-rendered — otherwise the sidebar shows stale data until the
 * next poll happens to agree.
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

// =========================================================================
// Session Selection
// =========================================================================

async function selectSession(id) {
  currentSession = findSession(id);
  if (!currentSession) return;
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
  setTurnInProgress(currentSession.isActive && !!currentSession.turnInProgress);

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
      const fmtMoney = (v) => v == null ? '—' : '$' + v.toFixed(4);
      // [key, value, copyable?] — copyable rows render the value as a
      // click-to-copy button (paths, handy for jumping to the file in a shell).
      const rows = [
        ['Model', s.model || '—'],
        ['Thinking', s.thinkingLevel || '—'],
        ['Context', (cu.tokens != null ? formatTokens(cu.tokens) : '—') +
          ' / ' + (cu.contextWindow ? formatTokens(cu.contextWindow) : '—') +
          (cu.percent != null ? ` (${Math.round(cu.percent * 10) / 10}%)` : '')],
        ['Messages', `${s.userMessages} user · ${s.assistantMessages} assistant · ${s.toolCalls} tool calls`],
        ['Tokens in / out', `${formatTokens(s.tokens?.input)} / ${formatTokens(s.tokens?.output)}`],
        ['Cache', formatCacheStat(s.tokens?.cacheRead, s.tokens?.cacheWrite, s.tokens?.input)],
        ['Cost', fmtMoney(s.cost)],
        ['cwd', s.cwd || '—', !!s.cwd],
        ['Session file', s.sessionFile || '—', !!s.sessionFile],
      ];
      body.innerHTML = '<table class="stats-table">' + rows.map(([k, v, copyable]) => {
        const val = copyable
          ? `<button type="button" class="stats-copy" data-copy="${escapeHtml(String(v))}" title="Click to copy">${escapeHtml(String(v))}</button>`
          : escapeHtml(String(v));
        return `<tr><td class="stats-key">${escapeHtml(k)}</td><td class="stats-val">${val}</td></tr>`;
      }).join('') + '</table>' +
        '<div class="stats-share" id="statsShare"></div>';
      loadShareSection(currentSession.id);
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
        .then(s => renderShareSection(sessionId, s))
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
      .then(() => renderShareSection(sessionId, null))
      .catch(e => setStatus('Failed to revoke share: ' + e.message, 'error'));
  });
}

function closeStatsModal() {
  document.getElementById('statsModal').style.display = 'none';
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
    html += '<div class="model-group-header">' + escapeHtml(provider) + '</div>';
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
      html += '<div class="' + cls + '" onclick="' + handler + '(\'' + escapeHtml(fullId) + '\')" title="' +
        escapeHtml(fullId) + '">' + check + '<span class="model-option-name">' + escapeHtml(m.id) + '</span>' + badges + '</div>';
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

// Pagination cursors for the currently loaded session.
let oldestLoadedIndex = null;
let lastLoadedIndex = null;
let hasMoreOlder = false;
let totalMessages = 0;
let loadingOlder = false;

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
  const imgs = images.map(img =>
    `<img class="msg-image" src="data:${escapeHtml(img.mimeType)};base64,${escapeHtml(img.data)}" alt="${escapeHtml(alt)}">`
  ).join('');
  return `<div class="msg-images">${imgs}</div>`;
}

function renderUserMessage(msg, time, attrs = '') {
  const text = extractTextContent(msg.content);
  const imagesHtml = imageBlocksHtml(msg.content, 'attached image');
  return `<div${attrs} class="message user">
    <div class="message-header"><span class="message-role user">❯</span>${time ? `<span class="message-time">${time}</span>` : ''}</div>
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

  return `<div${opts.attrs || ''} class="message assistant${streamingClass}${noTextClass}${msg.errorMessage ? ' error' : ''}" data-timestamp="${timestamp}"${streamingAttr}>
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
        if (data.turnInProgress) {
          setTurnInProgress(true);
          setStatus('Waiting for response...', 'working');
        } else if (data.compacting) {
          // Connected mid-compaction (e.g. a TUI /compact) — show the indicator
          // straight away instead of waiting for the next compaction event.
          setTurnInProgress(false);
          setCompacting(true);
          setStatus('Compacting context...', 'working');
          fetchNewMessagesSince(sessionId);
        } else {
          // Turn not in progress — incremental catch-up for any messages
          // written since our initial load (avoids full reload stall).
          setTurnInProgress(false);
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
      // Undo the optimistic "Working" badge and restore the compacting one.
      setTurnInProgress(false);
      setCompacting(true);
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

function updateWorkingIndicator() {
  const desktop = document.querySelector('#sessionWorking .spinner-text');
  const mobile = document.querySelector('#sessionWorkingMobile .spinner-text');
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

function setTurnInProgress(active) {
  const starting = active && !turnInProgress;
  turnInProgress = active;
  if (starting) {
    turnStartedAt = Date.now();
    if (!workingTicker) workingTicker = setInterval(updateWorkingIndicator, 1000);
  } else if (!active) {
    turnStartedAt = null;
    runningTools.clear();
    if (workingTicker) { clearInterval(workingTicker); workingTicker = null; }
  }
  updateWorkingIndicator();
  // Reflect in the sidebar immediately — the working dot shouldn't wait for
  // the next 10s poll. (turn events only stream for the viewed session.)
  if (currentSession && !!currentSession.turnInProgress !== !!active) {
    patchSession(currentSession.id, { turnInProgress: !!active });
  }
  var btnStop = document.getElementById('btnStop');
  var btnSteer = document.getElementById('btnSteer');
  var btnFollowUp = document.getElementById('btnFollowUp');
  var btnSend = document.getElementById('btnSend');
  if (btnStop) btnStop.style.display = active ? '' : 'none';
  if (btnSteer) btnSteer.style.display = active ? '' : 'none';
  if (btnFollowUp) btnFollowUp.style.display = active ? '' : 'none';
  if (btnSend) btnSend.style.display = active ? 'none' : '';
  if (!active) renderQueueStatus(null);
  
  // Dedicated working indicator — independent of transient status text
  var workingDesktop = document.getElementById('sessionWorking');
  var workingMobile = document.getElementById('sessionWorkingMobile');
  if (workingDesktop) workingDesktop.classList.toggle('active', active);
  if (workingMobile) workingMobile.classList.toggle('active', active);
  
  if (!active) setStatus('');
}

// Compaction has no turn, so setTurnInProgress doesn't cover it. Drive the same
// working badge so a TUI-started /compact is visible in the webapp, and so the
// user knows a send right now will be held until compaction finishes. During
// auto-compaction a turn is already active — its "Working" badge covers it, so
// only take over the badge when no turn is running.
function setCompacting(active) {
  if (turnInProgress) return; // the turn badge already owns the indicator
  const on = !!active;
  const workingDesktop = document.getElementById('sessionWorking');
  const workingMobile = document.getElementById('sessionWorkingMobile');
  const desktopText = document.querySelector('#sessionWorking .spinner-text');
  const mobileText = document.querySelector('#sessionWorkingMobile .spinner-text');
  if (workingDesktop) workingDesktop.classList.toggle('active', on);
  if (workingMobile) workingMobile.classList.toggle('active', on);
  if (desktopText) desktopText.textContent = on ? 'Compacting context…' : 'Working';
  if (mobileText) mobileText.textContent = on ? 'Compacting…' : '';
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
  if (!currentSession || !turnInProgress) return;
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
// Spawn target ("Run in") — headless RPC child (default) or a tmux window
// =========================================================================
// Each entry: { label, target, needsName }. target === null means headless.
let spawnTargets = [{ label: 'pi-dish (headless)', target: null }];

// Stable key so a saved choice survives target re-fetches/reorders.
function spawnTargetKey(t) {
  if (!t || !t.target) return 'headless';
  if (t.needsName) return `${t.target.socket}::new`;
  return `${t.target.socket}::${t.target.tmuxSession}`;
}

async function loadSpawnTargets() {
  const wrap = document.getElementById('newSessionTargetWrap');
  const sel = document.getElementById('newSessionTarget');
  if (!wrap || !sel) return;
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

  spawnTargets = [{ label: 'pi-dish (headless)', target: null }];
  for (const srv of data.servers) {
    for (const s of srv.sessions || []) {
      spawnTargets.push({
        label: `tmux:${srv.name} — ${s.name}`,
        target: { type: 'tmux', socket: srv.socket, tmuxSession: s.name },
      });
    }
    spawnTargets.push({
      label: `tmux:${srv.name} — new session…`,
      target: { type: 'tmux', socket: srv.socket },
      needsName: true,
    });
  }

  sel.innerHTML = spawnTargets
    .map((t, i) => `<option value="${i}">${escapeHtml(t.label)}</option>`)
    .join('');

  // Restore last choice if its server/session still exists; else headless.
  const saved = localStorage.getItem('pi-dish-spawn-target');
  const idx = saved ? spawnTargets.findIndex(t => spawnTargetKey(t) === saved) : -1;
  sel.value = String(idx >= 0 ? idx : 0);

  wrap.style.display = '';
  onSpawnTargetChange();
}

// Reveal the tmux-session-name input for "new session…" choices; persist the
// selection.
function onSpawnTargetChange() {
  const sel = document.getElementById('newSessionTarget');
  const nameInput = document.getElementById('newSessionTmuxName');
  if (!sel) return;
  const t = spawnTargets[Number(sel.value)];
  if (nameInput) nameInput.style.display = t && t.needsName ? '' : 'none';
  localStorage.setItem('pi-dish-spawn-target', spawnTargetKey(t));
}

// The target descriptor to send with /new. Throws if a new-tmux-session choice
// is missing its name. Returns null (headless) when the control is hidden.
function selectedSpawnTarget() {
  const wrap = document.getElementById('newSessionTargetWrap');
  const sel = document.getElementById('newSessionTarget');
  if (!wrap || wrap.style.display === 'none' || !sel) return null;
  const t = spawnTargets[Number(sel.value)];
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
        <span class="message-role assistant">◆</span>
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
  if (document.getElementById('treeModal').style.display !== 'none') {
    e.preventDefault(); closeTreeModal();
  } else if (document.getElementById('statsModal').style.display !== 'none') {
    e.preventDefault(); closeStatsModal();
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
    selectSession(currentSession.id);
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

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    appConfig = await res.json();
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

async function openTerminal() {
  if (!terminalFeatureAvailable() || !currentSession || termState) return;
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
    term, fitAddon, ws: null, sessionId: currentSession.id,
    reconnectTimer: null, attempts: 0, closedByUser: false, exited: false,
  };

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
  const ws = new WebSocket(`${proto}://${location.host}/api/sessions/${encodeURIComponent(state.sessionId)}/terminal`);
  state.ws = ws;
  setTerminalStatus(state.attempts ? 'reconnecting…' : 'connecting…', 'reconnecting');

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'attach') {
      state.attempts = 0;
      setTerminalStatus('');
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

function restartTerminalShell() {
  if (!termState) return;
  if (!confirm('Restart shell? Anything running in it will be killed.')) return;
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
