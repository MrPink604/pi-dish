// =========================================================================
// Hosts (TASKS/multi-host.md phase 1) — every API touch resolves a host
// entry first, so a later phase can point this client at several pi-dish
// servers at once. With an empty catalog every request resolves to the self
// host (base '', no token) and the wire traffic is exactly what a
// single-host client always sent.
// =========================================================================
// Catalog values enter through the typed normalization/merge boundary.

const HOSTS_KEY = 'pi-dish-hosts';
const KEYS_MIGRATED_KEY = 'pi-dish-keys-migrated';
// Directly-added hosts (phase 2 owns the editor UI); self is always implicit.
const hostDirectory = PiDishBrowser.createHostDirectory({
  initialCatalog: readJSONPref(HOSTS_KEY, []),
  descriptor: id => hostDiscovery.descriptor(id),
  persistCatalog: catalog => localStorage.setItem(HOSTS_KEY, JSON.stringify(catalog)),
});
// hostId stays null until GET /api/host answers — and forever on a server
// too old to serve it, which is why every key path tolerates host-less keys.
// The directory owns self identity, source catalogs and their effective list.

/** Effective-list (or self) entry for a host id; unknown ids fall back to self. */
function hostById(id) { return hostDirectory.hostById(id); }

/** Accepts a host id, a host entry, or nothing (self). */
function resolveHost(host) { return hostDirectory.resolveHost(host); }

/**
 * The one fetch entry point for /api paths. Nothing else in this file may
 * call fetch() for the API: the host's base and bearer token are attached
 * here, so a request can't accidentally go to the serving origin when the
 * session lives elsewhere. Returns fetch's promise unchanged.
 */
const apiTransport = PiDishBrowser.createHostTransport({ resolveHost, fetch: (...args) => fetch(...args) });
const sessionApi = PiDishBrowser.createSessionApi((...args) => apiFetch(...args));

function apiFetch(host, path, opts = {}) {
  return apiTransport.request(host, path, opts);
}

/**
 * The `<img src>` / `<a href>` counterpart to apiFetch: a host-relative /api
 * path (or a resource URL the owning host emitted, which is the same thing)
 * resolved against that host's base. Element-driven requests never pass
 * through apiFetch, so rendering one of these verbatim points the browser at
 * the serving origin — every remote session's transcript images and file
 * links then 404 against a hub that has no such session. Token hosts stay
 * unauthenticated here exactly as window.open'd exports do: an element
 * carries no Authorization header, and a 60s ticket outlives neither a lazy
 * image nor a reopened tab.
 */
function hostAssetUrl(host, path) {
  return resolveHost(host).base + path;
}

/**
 * `opts.timeoutMs` for the fan-out paths only. A sleeping tailnet peer
 * black-holes TCP: with no deadline that request holds one of the origin's
 * six HTTP/1.1 connections for minutes and everything queued behind it reads
 * as sitewide lag. Streams, transcripts and file reads are legitimately long
 * and never pass it. Feature-detected, because an old phone browser without
 * AbortSignal.timeout must keep working exactly as before; a caller-supplied
 * signal always wins.
 */
function withFetchTimeout(opts) { return PiDishBrowser.withFetchTimeout(opts); }

/** ws(s) URL for a host path — scheme/authority come from the host's base. */
function hostWsUrl(host, path) {
  const base = resolveHost(host).base;
  const localProto = location.protocol === 'https:' ? 'wss' : 'ws';
  if (!base) return `${localProto}://${location.host}${path}`;
  if (base.startsWith('/')) return `${localProto}://${location.host}${base}${path}`;
  const url = new URL(base);
  return `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}${url.pathname.replace(/\/+$/, '')}${path}`;
}

/**
 * EventSource can't set headers and a bearer token must never sit in a URL,
 * so a token host hands out a short single-purpose ticket per connect. Every
 * (re)connect mints a fresh one — a remembered stream URL's ticket is spent
 * or expired by the time a reconnect would reuse it.
 */
async function mintHostTicket(host, purpose) {
  const data = await apiSend(host, '/api/auth/ticket', { purpose });
  if (!data || !data.ticket) throw new Error('no ticket');
  return data.ticket;
}

/**
 * Identify the serving host. A 404 (or any failure) means an older server:
 * hostId stays null, client keys stay bare, everything else is unaffected.
 */
function loadHostIdentity() { return hostDiscovery.loadIdentity(); }

/**
 * One-time rewrite of bare session-id client keys to composite ones, once
 * this host's id is known. Lossless — values move, keys that already carry a
 * host are left alone — and idempotent via the migrated flag. Everything
 * here keeps working unmigrated: sessionKey(null, id) is the bare form.
 */
function migrateClientKeys() {
  if (!hostDirectory.self.hostId) return;
  try {
    if (localStorage.getItem(KEYS_MIGRATED_KEY) === hostDirectory.self.hostId) return;
    const isBare = (key) => parseSessionKey(key).hostId === null;
    const compose = (id) => sessionKey(hostDirectory.self.hostId, id);
    const prefixes = ['pi-dish-draft-', 'pi-dish-history-', 'pi-dish-terminal-mode-'];
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const key of keys) {
      const prefix = key && prefixes.find(pre => key.startsWith(pre));
      if (!prefix) continue;
      const owner = key.slice(prefix.length);
      // Spawn composer keys are operation-local, never session ids.
      if (!owner || owner.startsWith('spawn:') || !isBare(owner)) continue;
      const value = localStorage.getItem(key);
      localStorage.removeItem(key);
      if (value !== null) localStorage.setItem(prefix + compose(owner), value);
    }
    const seenNext = {};
    for (const [id, at] of Object.entries(seenActivity)) {
      seenNext[isBare(id) ? compose(id) : id] = at;
    }
    seenActivity = seenNext;
    localStorage.setItem('pi-dish-seen', JSON.stringify(seenActivity));
    pinnedSessions = pinnedSessions.map(pin => (isBare(pin) ? compose(pin) : pin));
    savePinnedSessions();
    const families = [...expandedSessionFamilies].map(id => (isBare(id) ? compose(id) : id));
    expandedSessionFamilies.clear();
    for (const id of families) expandedSessionFamilies.add(id);
    localStorage.setItem('pi-dish-expanded-session-families', JSON.stringify(families));
    const selected = localStorage.getItem('pi-dish-session');
    if (selected && isBare(selected)) localStorage.setItem('pi-dish-session', compose(selected));
    localStorage.setItem(KEYS_MIGRATED_KEY, hostDirectory.self.hostId);
  } catch {}
}

// =========================================================================
// Effective host list + per-host connection state (multi-host phase 2)
// =========================================================================
// Three sources feed one list (mergeHostEntries in src/browser/host-catalog.ts): this server
// (always), the fleet it advertises over GET /api/hosts (runtime only, never
// persisted — an older server 404s and we simply stay single-host), and the
// directly-added hosts in the localStorage catalog. Everything downstream —
// the poll fan-out, the sidebar's host chips, the new-session picker, the
// settings section — reads effectiveHosts(), so "which hosts are there" has
// exactly one answer. With only self in it, every branch below is a no-op
// and the UI is byte-identical to the single-host one.

const hostConnections = PiDishBrowser.createHostConnections({ onChange: () => renderHostsSection() });
// GET /api/host descriptors, by hostId. Runtime only: label/version/
// capabilities belong to the host, not to this browser's catalog entry (the
// catalog deliberately persists only base/id/label/token), so they are
// overlaid onto the merged list instead of being written back into it.

function invalidateHosts() { hostDirectory.invalidate(); }
function effectiveHosts() { return hostDirectory.effectiveHosts(); }

function hostKeyOf(host) { return PiDishBrowser.hostKeyOf(host); }
function isMultiHost() { return effectiveHosts().length > 1; }
function selfHostEntry() { return effectiveHosts()[0]; }

/** Effective entry for a host id — null when nothing in the list claims it. */
function hostEntryFor(hostId) { return hostDirectory.entryFor(hostId); }

function hostLabelFor(hostId) {
  const entry = hostEntryFor(hostId);
  return entry ? hostDisplayLabel(entry) : '';
}

/** reachable | connecting | backoff | blocked — one host's connection state. */
function hostState(host) { return hostConnections.stateOf(host); }

/** Down = its rows are last-known, not live (backoff or blocked). */
function hostIsDown(host) { return hostConnections.isDown(host); }
function hostIdIsDown(hostId) {
  const entry = hostEntryFor(hostId);
  return entry ? hostIsDown(entry) : false;
}

// Connection observations and poll eligibility share the typed retry policy.
function noteHostReachable(host) { hostConnections.note(host, 'success'); }
function noteHostBlocked(host) { hostConnections.note(host, 'blocked'); }
function noteHostFailure(host, error) { hostConnections.note(host, { type: 'failure', error }); }
function seedHostConnFromFleet() { hostConnections.seed(effectiveHosts()); }
function pollableHosts() { return hostConnections.pollable(effectiveHosts()); }

/** Hosts whose data may be fetched for search/usage fan-out. */
function fanoutHosts() {
  return pollableHosts();
}

// The controls are usable before async initialization finishes. Fan-out
// views wait on this first catalog load so an early click cannot capture
// self as the whole fleet and then remain permanently under-counted.
let resolveHostFleetReady;
const hostFleetReady = new Promise(resolve => { resolveHostFleetReady = resolve; });
const hostDiscovery = PiDishBrowser.createHostDiscovery({
  request: (...args) => apiFetch(...args),
  requestSelf: () => fetch('/api/host'),
  hosts: effectiveHosts,
  pollableHosts,
  sourceFor: hostDirectory.sourceFor,
  onSelf: data => {
    hostDirectory.setSelf(data);
    migrateClientKeys();
    if (isNewSessionViewOpen()) renderNsHosts();
  },
  onFleet: data => {
    hostDirectory.setFleet(data);
    seedHostConnFromFleet();
  },
  onIdentified: (...args) => {
    if (hostDirectory.applyDescriptor(...args) && isNewSessionViewOpen()) renderNsHosts();
  },
  onConnection: (host, event) => hostConnections.note(host, event),
  afterFleet: () => {
    pruneHostCaches();
    renderHostsSection();
    updateRoutinesButton();
    updateMicButton();
    if (isNewSessionViewOpen()) renderNsHosts();
    renderSessions();
  },
});

/**
 * The fleet this server knows about. Runtime only: a peer list is the
 * serving host's configuration, not this browser's, so it is re-read rather
 * than cached in localStorage. Piggybacked on the sidebar poll at a much
 * lower rate — reachability there costs the server real probes.
 */
function loadHostFleet() { return hostDiscovery.loadFleet(); }

/** Resolve missing identities and refresh direct-host capabilities before fan-out. */
function identifyHosts(refresh = false) { return hostDiscovery.identify(refresh); }
function refreshHostFleetSoon() { hostDiscovery.refreshSoon(); }

/** Drop cached rows/state for hosts that left the effective list. */
function pruneHostCaches() {
  const live = new Set(effectiveHosts().map(hostKeyOf));
  hostConnections.prune(live);
  hostSessionLoader.prune(live);
}

// --- Host colors ---------------------------------------------------------
// Each host wears one color across the sidebar (section headings, chips), so
// "which machine is this?" lands before the label is read. Auto colors come
// from the theme's chart slots by first-seen order — tokens, so they follow
// the theme, and an order that is persisted so they never reshuffle. A user
// override is a concrete hex (user data, stored verbatim). Nothing here is
// a status light: the tint is faint, and liveness stays the dots' job.
const HOST_COLORS_KEY = 'pi-dish-host-colors';
const HOST_COLOR_ORDER_KEY = 'pi-dish-host-color-order';
const hostPresentation = PiDishBrowser.createHostPresentation({
  directory: hostDirectory,
  initialColors: readJSONPref(HOST_COLORS_KEY, {}),
  initialOrder: readJSONPref(HOST_COLOR_ORDER_KEY, []),
  persistColors: colors => localStorage.setItem(HOST_COLORS_KEY, JSON.stringify(colors)),
  persistOrder: order => localStorage.setItem(HOST_COLOR_ORDER_KEY, JSON.stringify(order)),
  onColorChanged: rows => {
    if (rows) renderHostsSection();
    renderSessions();
  },
  escapeHtml, displayLabel: hostDisplayLabel, isDown: hostIsDown,
});
function hostColorFor(hostId) { return hostPresentation.colorFor(hostId); }
function hostColorIsCustom(hostId) { return hostPresentation.isCustom(hostId); }
function setHostColorOverride(hostId, hex, options) { hostPresentation.setColor(hostId, hex, options); }
function resolveColorToHex(color) { return PiDishBrowser.resolveColorToHex(color); }
function hostDotHtml(hostId, className) { return hostPresentation.dotHtml(hostId, className); }
function hostChipHtml(hostId, options) { return hostPresentation.chipHtml(hostId, options); }

// All session list/selection writes and their rendering hooks share one store.
// Read its snapshots freely; mutate them only through its four state writers.
const sessionState = PiDishBrowser.createSessionState({
  getSelfHostId: () => hostDirectory.self.hostId,
  getHostLabel: hostLabelFor,
  onListsChanged: renderSessions,
  onCurrentChanged: updateSessionHeader,
});
// Provisional rows for asynchronous harness launches. They are presentation state,
// not sessions: the durable source of truth remains tmux + the bridge registry.
let currentSessionSpawnId = null;
// Spawn operations are server-process-local and cannot be resumed after a
// page reload, so their old draft keys have no view that could restore them.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith('pi-dish-draft-spawn:')) localStorage.removeItem(key);
  }
} catch {}
let responseDetailSeq = 0;
const responseDetails = new Map();

// Live tool panel tracking: toolCallId -> { el, startTime }
let liveToolPanels = new Map();

// =========================================================================
// Scroll pinning — only follow streaming output while the user is at the
// bottom. Scrolling up "unpins"; new content then accumulates below without
// yanking the viewport, and a jump-to-bottom button appears.
// =========================================================================

// Set when the user sends a prompt (or hits jump-to-bottom): follow the
// stream unconditionally, even if a mobile keyboard resize left the viewport
// short of the 80px pin threshold. Cleared by any deliberate scroll gesture.
let followStream = false;

/**
 * Grow the prompt textarea with its content, capped at 160px. The control
 * row is a sibling strip below the textarea, so this cap is text only.
 */
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

function loadCommands(id) { return composerAutocomplete.loadCommands(id); }

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Who is serving us — and so which host stamps/keys the sessions below.
  // Awaited before the first list load so client keys never straddle the
  // bare/composite migration mid-render.
  try {
    await loadHostIdentity();
    await loadHostFleet(); // peers this server knows about (404 on old servers)
    await identifyHosts();  // and who the catalog's own entries actually are
  } finally {
    resolveHostFleetReady();
    updateRoutinesButton(); // capability-gated sidebar icon
    updateMicButton();      // …and the capability-gated composer mic
  }
  loadConfig(); // feature flags (terminal) — fire-and-forget
  loadThemes(); // theme picker options + refresh custom-theme tokens
  updateViewToggle();
  renderScopeChips(); // cached definitions paint immediately…
  loadSavedFilters(); // …then the server copy replaces them
  initMicButton();
  initTerminalKeybar();
  initTerminalResize();
  initSidebarResize();
  initCommentSelections();
  // The default Active view needs only live rows. Fetch history only when a
  // saved inactive session must be restored; opening All fetches it on demand.
  const saved = parseSessionKey(localStorage.getItem('pi-dish-session') || '');
  await loadSessions();
  if (saved.sessionId && !sessionState.findSession(saved.sessionId, saved.hostId)) {
    await loadSessions(undefined, { withPrevious: true });
  }
  if (saved.sessionId) {
    const found = sessionState.findSession(saved.sessionId, saved.hostId);
    if (found) selectSession(saved.sessionId, { host: found.host || null });
  }
  
  const promptInput = document.getElementById('promptInput');

  promptInput.addEventListener('keydown', (e) => {
    if (composerAutocomplete.visible) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveAutocomplete(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveAutocomplete(-1); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        var items = document.querySelectorAll('.autocomplete-item');
        if (items.length > 0 && composerAutocomplete.index >= 0) {
          e.preventDefault();
          acceptAutocomplete(items[composerAutocomplete.index]);
          return;
        }
      }
      if (e.key === 'Escape') { e.preventDefault(); hideAutocomplete(); return; }
    }
    // History recall: ArrowUp with the caret at the very start (or empty box)
    // steps back through sent prompts; ArrowDown at the end steps forward and
    // finally restores whatever was being typed.
    if (!composerAutocomplete.visible && e.key === 'ArrowUp' &&
        promptInput.selectionStart === 0 && promptInput.selectionEnd === 0) {
      if (navigateHistory(-1, promptInput)) { e.preventDefault(); return; }
    }
    if (!composerAutocomplete.visible && e.key === 'ArrowDown' && composerDrafts.historyIndex !== -1 &&
        promptInput.selectionStart === promptInput.value.length) {
      if (navigateHistory(1, promptInput)) { e.preventDefault(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.ctrlKey) { e.preventDefault(); sendSteer(); }
      else { e.preventDefault(); sendPrompt(); }
    }
    // While dictating, Escape cancels the recording (handled by the document
    // listener) — it must not also abort the turn.
    if (e.key === 'Escape' && !composerAutocomplete.visible && !isRecording() && turnInProgress) { e.preventDefault(); abortTurn(); }
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
    if (e.ctrlKey && e.key === 'f' && sessionState.currentSession) {
      e.preventDefault();
      openSearch();
    }
  });

  promptInput.addEventListener('input', () => {
    autosizePromptInput(promptInput);
    handleAutocomplete(promptInput.value);
    composerDrafts.exitHistory(); // typing exits history browsing
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
    if (!link || !sessionState.currentSession) return;
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
    const familyToggle = e.target.closest('.session-family-toggle');
    if (familyToggle) {
      const item = familyToggle.closest('.session-item');
      toggleSessionFamilyExpanded(familyToggle.dataset.familyId, item.dataset.host || null);
      return;
    }
    const pinBtn = e.target.closest('.session-pin-btn');
    if (pinBtn) {
      const item = pinBtn.closest('.session-item');
      const family = item.closest('.session-family-root');
      const memberIds = family
        ? [...family.querySelectorAll('.session-item[data-id]')].map(row => row.dataset.id)
        : [item.dataset.id];
      toggleSessionPinned(item.dataset.id, family?.dataset.familyId || item.dataset.id, memberIds, item.dataset.host || null);
      return;
    }
    // Row-level close: two-tap confirm — never a row select.
    const closeBtn = e.target.closest('.session-close-btn');
    if (closeBtn) {
      e.stopPropagation();
      const item = closeBtn.closest('.session-item');
      handleRowCloseClick(item.dataset.id, item.dataset.host || null);
      return;
    }
    // A finished drag still emits a click on the handle — never treat it as a select.
    if (e.target.closest('.session-drag-handle')) return;
    // The header's + spawns a session at the node's path — not a collapse toggle.
    const newBtn = e.target.closest('.workspace-new-btn');
    // The workspace's own host spawns it — never the picker's current choice.
    if (newBtn) { createSession(newBtn.dataset.path, newBtn.dataset.host || null); return; }
    // Host sections share the collapse store (keys namespaced `host:` the way
    // Recent buckets are `date:`), just not the workspace header's chrome.
    const hostHeader = e.target.closest('.host-section-header');
    if (hostHeader) { toggleGroupCollapsed(hostHeader.dataset.hostSection); return; }
    const header = e.target.closest('.workspace-group-header');
    if (header) { if (header.dataset.cwd) toggleGroupCollapsed(header.dataset.cwd); return; }
    const item = e.target.closest('.session-item');
    if (!item) return;
    if (item.classList.contains('starting')) showPendingSessionView(item.dataset.spawnId);
    else selectSession(item.dataset.id, { host: item.dataset.host || null });
    if (window.innerWidth <= 768) closeSidebar();
  });

  // Right-click (and Android's long-press, which dispatches the same event)
  // on a row opens the copy-a-ref menu. Provisional spawn rows have no
  // session behind them yet, so they keep the browser's own menu.
  document.getElementById('sessionList').addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.session-item[data-id]');
    if (!item) return;
    const session = sessionState.findSession(item.dataset.id, item.dataset.host || null);
    if (!session) return;
    e.preventDefault();
    openSessionMenu(session, e.clientX, e.clientY);
  });

  initPinnedDrag();

  document.getElementById('scopeChips').addEventListener('click', (e) => {
    if (e.target.closest('.scope-add')) { saveCurrentFilterAsScope(); return; }
    if (e.target.closest('.search-open-chip')) { openSearchView(filterQuery); return; }
    const chip = e.target.closest('.scope-chip');
    if (chip) toggleScope(chip.dataset.name);
  });


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
    // Open the session a #ref chip names. Cross-host chips carry the host in
    // the ref, so the lookup — not the click — decides which host to switch to.
    messagesEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.session-ref-chip');
      if (!chip) return;
      const ref = chip.getAttribute('data-session-ref') || '';
      const session = sessionMatchingRef(ref);
      if (!session) { setStatus(`No session here matches ${ref}`, 'error'); return; }
      selectSession(session.id, { host: session.host || null });
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

// Reference syntax is relative to the server owning the composing session.
const sessionReferences = PiDishBrowser.createSessionReferences({
  sessionState, selfId: () => hostDirectory.self.hostId, host: hostEntryFor, hostLabel: hostLabelFor, config: () => appConfig,
});
const composerAutocomplete = PiDishBrowser.createComposerAutocomplete({
  document, sessionState, composerKey: () => composerDrafts.key, provisional: () => !!currentSessionSpawnId,
  request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor, references: sessionReferences,
  multiHost: isMultiHost, hostLabel: hostLabelFor, failed: error => console.error('Failed to load commands:', error),
});
function handleAutocomplete(text) { composerAutocomplete.handle(text); }
function queueFileAutocomplete(token) { composerAutocomplete.queueFile(token); }
function showFileAutocomplete(files) { composerAutocomplete.showFiles(files); }
function acceptFileMention(path, directory) { composerAutocomplete.acceptFile(path, directory); }
function allKnownSessions() { return sessionReferences.all(); }
function sessionHostIdOf(session) { return sessionReferences.hostId(session); }
function sessionRefCandidates() { return sessionReferences.candidates(); }
function sameHostSessionIds(session) { return sessionReferences.sameHostIds(session); }
function refPrefixFor(session) { return sessionReferences.prefix(session); }
function composerSessionRef(session, target) { return sessionReferences.ref(session, target); }
function showSessionRefAutocomplete(token) { composerAutocomplete.showRefs(token); }
function acceptSessionRefMention(ref) { composerAutocomplete.acceptRef(ref); }
function sessionMatchingRef(ref, host) { return sessionReferences.match(ref, host); }
function sessionRefHints(message) { return sessionReferences.hints(message); }
function showAutocomplete(matches) { composerAutocomplete.showCommands(matches); }
function hideAutocomplete() { composerAutocomplete.hide(); }
function moveAutocomplete(delta) { composerAutocomplete.move(delta); }
function acceptAutocomplete(element) { composerAutocomplete.accept(element); }
function acceptAutocompleteByName(name) { composerAutocomplete.acceptCommand(name); }

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
    const res = await apiFetch(null, '/api/settings');
    const data = await res.json();
    savedFilters = Array.isArray(data.savedFilters) ? data.savedFilters : [];
    localStorage.setItem('pi-dish-saved-filters-cache', JSON.stringify(savedFilters));
    renderScopeChips();
    renderSessions();
    if (isSearchViewOpen()) runSearchView();
  } catch (e) { console.error('Failed to load saved filters:', e); }
}

async function persistSavedFilters(next, host = null) {
  const res = await apiFetch(host, '/api/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ savedFilters: next }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'save failed');
  savedFilters = data.savedFilters;
  localStorage.setItem('pi-dish-saved-filters-cache', JSON.stringify(savedFilters));
  renderScopeChips();
  renderSessions();
  // A just-saved scope can absorb and clear a typed query while that query's
  // server response is still in flight. Re-fetch when the currently loaded
  // lists no longer match the input so a late filtered response cannot leave
  // the sidebar permanently narrowed after the scope changes or is deleted.
  if (listsQueriedFor !== filterQuery) loadSessions(filterQuery || undefined);
  if (isSearchViewOpen()) runSearchView();
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
  if (listsQueriedFor !== filterQuery) loadSessions(filterQuery || undefined);
  if (isSearchViewOpen()) runSearchView();
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
    // The absorbed query may still have a debounced search pending. Left to
    // fire it would land *after* this clear, re-narrowing the lists to a
    // query that is no longer typed until the next 10s poll undid it.
    clearTimeout(filterDebounceTimer);
    setSearchBusy(false);
    document.getElementById('filterInput').value = '';
    filterQuery = '';
    await persistSavedFilters(next);
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

function markSessionSeen(session, lastActivity = session?.lastActivity) {
  if (!session || !lastActivity) return;
  seenActivity[sessionRefKey(session)] = lastActivity;
  localStorage.setItem('pi-dish-seen', JSON.stringify(seenActivity));
}

function isUnread(session) {
  return isUnreadSession(session, seenActivity,
    sessionState.currentSession ? sessionRefKey(sessionState.currentSession) : null, !document.hidden);
}

// Unread count in the tab title — the "agent came back" signal when the
// tab is in the background.
function updateUnreadTitle() {
  const unread = sessionState.sessions.active.filter(isUnread).length;
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
  // Re-run any pending query under the new tab's scope (Active skips the
  // historical scan) — both tabs search server-side, so a content match on
  // All must not vanish when the same query lands on Active.
  loadSessions(filterQuery || undefined);
}

function onFilterInput() {
  clearTimeout(filterDebounceTimer);
  const q = document.getElementById('filterInput').value.trim();
  filterQuery = q;
  renderScopeChips(); // the "+ save filter" chip tracks whether a query is typed
  // Instant metadata narrowing while the server search is in flight.
  renderSessions();
  if (q.length > 0) {
    // Busy from the first keystroke — the debounce window is part of the
    // latency the user sees, and a search box that shows nothing for
    // 300ms+ reads as "not filtering".
    setSearchBusy(true);
    filterDebounceTimer = setTimeout(() => loadSessions(q), 300);
  } else {
    // Query cleared: the lists hold server-filtered results — reload.
    loadSessions();
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
let loadSessionsSeq = 0; // drops out-of-order responses (and the model catalog)
let sessionIndexing = false; // server is still backfilling its session index
let indexingRefreshTimer = null;
// The query the current `sessions` lists were server-filtered by ('' when
// unfiltered) — renderSessions falls back to local metadata narrowing until
// the lists reflect what's typed.
let listsQueriedFor = '';

async function loadSessions(query, { withPrevious = sidebarTab === 'all' } = {}) {
  const seq = ++loadSessionsSeq;
  setSearchBusy(true);
  // Fan out, never Promise.all: one slow (or dead) host must not hold the
  // whole sidebar. Each host publishes the merged lists as its own response
  // lands, so the list fills progressively.
  await Promise.allSettled(queryHosts(pollableHosts(), query).map(host => loadHostSessions(host, query, withPrevious, seq)));
  if (seq === loadSessionsSeq) setSearchBusy(false);
}

/**
 * The hosts a query can possibly match — `host:` is client-evaluated, so a
 * host no positive host term names is a wasted request. Pruning runs the
 * same evaluator the rows will, over a stand-in session carrying the host's
 * label/id, so the fan-out can't disagree with the filter. Negations never
 * prune (they narrow a fan-out, they don't name one) — those hosts are
 * fetched and filtered client-side like every other term.
 */
function queryHosts(hosts, query) { return PiDishBrowser.queryHosts(hosts, query); }

// Per-host transport ownership/cache lives in TypeScript. View effects stay
// here so the controller cannot discover or retarget a selected session.
const hostSessionLoader = PiDishBrowser.createHostSessionLoader({
  requestList: (host, path, options) => sessionApi.list(host, path, options),
  currentSequence: () => loadSessionsSeq,
  stripHostQuery: query => stripQueryField(query, 'host'),
  onConnection: (host, event) => hostConnections.note(host, event),
  onIndexing: () => {
    if (indexingRefreshTimer) return;
    indexingRefreshTimer = setTimeout(() => {
      indexingRefreshTimer = null;
      refreshSessions();
    }, 1000);
  },
  beforePublish: (host, next, wireQuery) => {
    const hostId = host.hostId || null;
    // Bookkeep fresh activity before the state writer renders unread dots.
    if (sessionState.currentSession && !document.hidden && (sessionState.currentSession.host || null) === hostId) {
      const fresh = next.active.find(s => s.id === sessionState.currentSession.id)
        || next.previous.find(s => s.id === sessionState.currentSession.id);
      if (fresh) markSessionSeen(sessionState.currentSession, fresh.lastActivity);
    }
    if (!wireQuery) {
      const live = new Set(next.active.map(s => sessionKey(s.host || hostId, s.id)));
      for (const seenKey of Object.keys(seenActivity)) {
        if (parseSessionKey(seenKey).hostId !== hostId) continue;
        if (!live.has(seenKey)) delete seenActivity[seenKey];
      }
    }
  },
  onPublish: query => {
    if (query !== undefined) listsQueriedFor = query;
    publishSessionLists();
  },
  onError: (host, error) => {
    if (host.self) console.error('Failed to load sessions:', error);
  },
});

function loadHostSessions(host, query, withPrevious, seq) {
  return hostSessionLoader.load(host, query, withPrevious, seq);
}

/**
 * Push the per-host caches through the one list writer. Hosts contribute
 * independently, so a host that has never answered simply has no rows and a
 * host that stopped answering keeps its last ones.
 */
function publishSessionLists() {
  sessionIndexing = hostSessionLoader.isIndexing();
  const parts = [];
  for (const host of effectiveHosts()) {
    const cache = hostSessionLoader.getCache(host);
    if (!cache) continue;
    parts.push({ hostId: host.hostId || null, active: cache.active, previous: cache.previous });
  }
  sessionState.setSessionLists(parts.length ? parts : [{ hostId: hostDirectory.self.hostId, active: [], previous: [] }]);
}

// Refresh the list, preserving an in-flight server-side search so a
// background poll — or the sidebar refresh button — doesn't reset it.
function refreshSessions() {
  // Fleet membership changes far more slowly than the session list, and the
  // server probes real peers to answer — piggyback, don't poll it at 10s.
  refreshHostFleetSoon();
  return loadSessions(filterQuery || undefined);
}

// Row-level close (live rows): a quiet ✕ with a two-tap inline confirm —
// first tap arms a danger-styled "close?" state that auto-reverts after ~3s,
// second tap fires POST /close. State lives in module vars (not the DOM) so
// the 10s poll's re-render restores an armed confirm instead of clearing it.
let sessionCloseConfirmId = null; // host+session key awaiting its second confirm tap
let sessionCloseConfirmTimer = null;
let sessionCloseBusyId = null;    // host+session key whose close POST is in flight

function handleRowCloseClick(id, host = sessionState.sessionHostId(id)) {
  const key = sessionKey(host, id);
  if (sessionCloseBusyId) return; // one close at a time
  if (sessionCloseConfirmId === key) { performRowClose(id, host); return; }
  clearTimeout(sessionCloseConfirmTimer);
  sessionCloseConfirmId = key;
  sessionCloseConfirmTimer = setTimeout(() => {
    sessionCloseConfirmId = null;
    renderSessions();
  }, 3000);
  renderSessions();
}

async function performRowClose(id, host = sessionState.sessionHostId(id)) {
  const owner = sessionState.captureSelection();
  clearTimeout(sessionCloseConfirmTimer);
  sessionCloseConfirmId = null;
  sessionCloseBusyId = sessionKey(host, id);
  renderSessions();
  try {
    await apiSend(host, `/api/sessions/${encodeURIComponent(id)}/close`);
    sessionCloseBusyId = null;
    await finishSessionClose(id, host, owner);
  } catch (e) {
    sessionCloseBusyId = null;
    setStatus('Close failed: ' + e.message, 'error');
    renderSessions();
  }
}

function harnessBadgeInnerHtml(info) {
  const icon = info.icon
    ? `<img class="harness-badge-icon" src="${escapeHtml(info.icon)}" alt="">`
    : '<span class="harness-badge-icon harness-badge-icon-fallback" aria-hidden="true">◆</span>';
  return icon + `<span class="harness-badge-label">${escapeHtml(info.label)}</span>`;
}

function renderHarnessBadge(harnessId, harnessLabel) {
  const id = harnessId || 'pi';
  const info = harnessBadgeInfo(id, harnessLabel);
  const title = harnessLabel || info.label;
  return `<span class="harness-badge harness-badge-${escapeHtml(id)}" title="${escapeHtml(title)} harness" aria-label="${escapeHtml(title)} harness">${harnessBadgeInnerHtml(info)}</span>`;
}

function renderSessionItem(session, opts = {}) {
  const ctxClass = contextClass(session.contextPercent);
  const activeClass = sessionState.currentSession && sessionRefKey(sessionState.currentSession) === sessionRefKey(session) ? 'active' : '';
  // A live subagent has no bridge of its own (its parent's process owns it),
  // so `isActive` is false — but it is a running session, not history, and
  // must not read as dimmed.
  const inactiveClass = session.isActive || session.subagentLive ? '' : 'inactive';
  const familyNode = opts.familyNode || null;
  const hasChildren = !!familyNode?.children?.length;
  const familyExpanded = hasChildren && expandedSessionFamilies.has(sessionRefKey(session));
  const statusSessions = hasChildren && !familyExpanded
    ? flattenSessionFamilies([familyNode]) : [session];
  // One dot, best signal wins: working (pulsing) > unread (accent) >
  // live-in-All > live subagent. A collapsed parent aggregates its
  // descendants so hiding rows never hides the fact that a child is working,
  // has unread activity, or is still running inside it.
  let liveDot = '';
  if (statusSessions.some(s => s.compacting || s.turnInProgress)) {
    liveDot = '<span class="session-item-status working" title="Session family working"></span>';
  } else if (statusSessions.some(isUnread)) {
    liveDot = '<span class="session-item-status unread" title="New activity in session family"></span>';
  } else if (sidebarTab === 'all' && statusSessions.some(s => s.isActive)) {
    liveDot = '<span class="live-dot" title="Active session family"></span>';
  } else if (statusSessions.some(s => s.subagentLive)) {
    // Deliberately the static dot: the file says the session is still loaded
    // in its parent, never whether it is mid-turn.
    liveDot = '<span class="live-dot" title="Subagent still loaded in its parent session"></span>';
  }
  const displayName = session.name || 'Unnamed';
  // One context readout, not three: percent or absolute tokens per the device
  // setting (tokens falls back to percent when the session has no token
  // count). The colour still comes from the percent — that's the warning.
  const ctxText = displayPreferences.contextMetric === 'tokens' && session.contextTokens
    ? `${formatTokens(session.contextTokens)} tok`
    : `${session.contextPercent}%`;
  const ctxTitle = session.contextTokens
    ? `${session.contextPercent}% of context · ${formatTokens(session.contextTokens)} tokens`
    : `${session.contextPercent}% of context`;
  const timeAgo = formatRelativeTime(hasChildren ? familyNode.activity : session.lastActivity);
  const canonicalRootKey = canonicalFamilyKey(opts.familyRootKey || sessionRefKey(session));
  const isPinned = opts.familyPinned ?? pinnedSessions.some(pin =>
    canonicalFamilyKey(pin) === canonicalRootKey);
  const pinBtn = `<button class="session-pin-btn${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Unpin family' : 'Pin family to top'}">📌</button>`;
  const familyToggle = hasChildren
    ? `<button class="session-family-toggle" data-family-id="${escapeHtml(session.id)}" aria-expanded="${familyExpanded}" aria-label="${familyExpanded ? 'Collapse' : 'Show'} ${familyNode.size - 1} child session${familyNode.size === 2 ? '' : 's'}" title="${familyExpanded ? 'Collapse' : 'Show'} ${familyNode.size - 1} child session${familyNode.size === 2 ? '' : 's'}"><span>${familyExpanded ? '▾' : '▸'}</span><small>${familyNode.size - 1}</small></button>`
    : (opts.familyDepth > 0 ? '<span class="session-family-leaf" aria-hidden="true">↳</span>' : '');
  // Live rows only; the confirm/busy states read the module vars so a poll
  // re-render restores an armed confirm rather than silently clearing it.
  const closeArmed = sessionCloseConfirmId === sessionRefKey(session);
  const closeBusy = sessionCloseBusyId === sessionRefKey(session);
  const detachClient = session.closeMode === 'client-only';
  const closeTitle = detachClient ? 'Detach client'
    : session.closeMode === 'owned-agent' ? 'Stop this agent and its children (transcript stays resumable)'
      : 'Close session (transcript stays resumable)';
  const closeBtn = session.isActive && sessionSupports(session, 'close')
    ? `<button class="session-close-btn${closeArmed ? ' confirm' : ''}" title="${closeArmed ? 'Tap again: ' : ''}${closeTitle}">${closeBusy ? '…' : closeArmed ? (detachClient ? 'detach?' : 'close?') : '✕'}</button>`
    : '';
  const harnessBadge = renderHarnessBadge(session.harnessId, session.harnessLabel);
  // Provenance stamp from the routine ledger (server-side, presentation only,
  // like the parent hints): this session is one routine's run.
  const routineChip = session.routine
    ? `<span class="routine-chip" title="Started by the &quot;${escapeHtml(session.routine)}&quot; routine">⏱ ${escapeHtml(session.routine)}</span>`
    : '';
  // Rows in the pinned section get a drag handle (reorder); pinned and
  // Recent-view rows get a cwd hint — they've left their workspace group,
  // so the group label isn't there.
  const dragHandle = opts.pinnedRow ? '<span class="session-drag-handle" title="Drag to reorder">⠿</span>' : '';
  const cwdHint = (opts.pinnedRow || opts.showCwd) ? `<span class="session-item-cwd">${escapeHtml(shortCwd(session.cwd || '~'))}</span>` : '';
  // Rows that have left their workspace group (pinned, Recent, search) name
  // their host too — in the workspace tree the group header carries it.
  const hostChip = (opts.pinnedRow || opts.showCwd) ? hostChipHtml(session.host) : '';
  // Rows served from a host that stopped answering are last-known, not live.
  const staleHost = hostIdIsDown(session.host) ? ' stale-host' : '';
  // Server search attaches a snippet when a session matched on message
  // content the row's metadata doesn't show — render it so the match
  // doesn't look arbitrary. Only positive plain terms can cause a content
  // match, so only they get marked.
  const snippetLine = session.searchSnippet
    ? `<div class="session-item-snippet">${highlightTokens(session.searchSnippet,
        positiveQueryTokens(parseSessionQuery(filterQuery)))}</div>`
    : '';
  // Live sessions report their thinking level; historical rows have none to
  // show, so the chip simply doesn't render there.
  const thinkingChip = session.thinkingLevel
    ? `<span class="session-item-thinking" title="Thinking level: ${escapeHtml(session.thinkingLevel)}">${escapeHtml(session.thinkingLevel)}</span>`
    : '';

  return `
    <div class="session-item ${activeClass} ${inactiveClass}${closeBusy ? ' closing' : ''}${staleHost}" data-id="${escapeHtml(session.id)}"${session.host ? ` data-host="${escapeHtml(session.host)}"` : ''}>
      <div class="session-item-header">
        ${dragHandle}${familyToggle}${liveDot}<span class="session-item-name" title="${escapeHtml(session.id)}">${escapeHtml(displayName)}</span>
        <span class="session-item-time">${timeAgo}</span>
        ${pinBtn}${closeBtn}
      </div>
      <div class="session-item-meta">
        <span class="session-item-model" title="${escapeHtml(session.model || '')}">${escapeHtml(shortModelName(session.model))}</span>
        ${thinkingChip}
        <span class="session-item-context ${ctxClass}" title="${escapeHtml(ctxTitle)}">${escapeHtml(ctxText)}</span>
      </div>
      <div class="session-item-tags${hostChip ? ' with-host' : ''}">
        ${hostChip}${harnessBadge}${routineChip}${cwdHint}
      </div>
      ${snippetLine}
    </div>
  `;
}

function renderSessionFamily(node, opts = {}, depth = 0, rootId = node.session.id,
  rootKey = sessionRefKey(node.session)) {
  const expanded = node.children.length > 0 && expandedSessionFamilies.has(sessionRefKey(node.session));
  const row = renderSessionItem(node.session, {
    familyNode: node,
    // Carried down so a row never has to look its root's host back up: the
    // sidebar renders thousands of rows and findSession is a linear scan.
    familyRootKey: rootKey,
    familyDepth: depth,
    familyPinned: !!opts.pinnedFamily,
    pinnedRow: !!opts.pinnedFamily && depth === 0,
    showCwd: !!opts.showCwd && depth === 0,
  });
  const children = expanded
    ? `<div class="session-family-children">${node.children.map(child =>
        renderSessionFamily(child, opts, depth + 1, rootId, rootKey)).join('')}</div>`
    : '';
  const classes = depth === 0 ? 'session-family session-family-root' : 'session-family session-family-child';
  const familyAttr = depth === 0 ? ` data-family-id="${escapeHtml(rootId)}" data-family-key="${escapeHtml(rootKey)}"` : '';
  return `<div class="${classes}"${familyAttr}>${row}${children}</div>`;
}

function renderPendingSessionItem(spawnId, spawn) {
  const cwd = spawn.cwd || '~';
  const label = spawn.harnessLabel || 'Pi';
  const harnessBadge = renderHarnessBadge(spawn.harness, label);
  return `
    <div class="session-item starting${currentSessionSpawnId === spawnId ? ' active' : ''}" data-spawn-id="${escapeHtml(spawnId)}">
      <div class="session-item-header">
        <span class="session-item-status working" title="Starting session"></span>
        <span class="session-item-name">Starting ${escapeHtml(label)}…</span>${harnessBadge}
        <span class="session-item-time">now</span>
      </div>
      <div class="session-item-meta">
        ${hostChipHtml(spawn.host)}<span class="session-item-cwd" title="${escapeHtml(cwd)}">${escapeHtml(shortCwd(cwd))}</span>
        <span>${spawn.target ? 'tmux' : 'headless'}</span>
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

/**
 * Composite client key for a host-local wire id. Unknown ids resolve to
 * this host, which
 * is what a not-yet-listed or just-spawned session is.
 */
function keyForSessionId(id) {
  return sessionKey(sessionState.sessionHostId(id), id);
}

/**
 * Fold a session key onto its family root's key. Pins are stored per family
 * root. Both sides of the render-time map include the owning host.
 */
function canonicalFamilyKey(key) {
  return sidebarFamilyRootMap.get(key) || key;
}

// Session families default collapsed to keep subagents quiet. Store only the
// explicit expansions so newly discovered families also start collapsed.
const expandedSessionFamilies = new Set(readJSONPref('pi-dish-expanded-session-families', []));

function toggleSessionFamilyExpanded(id, host = sessionState.sessionHostId(id)) {
  const key = sessionKey(host, id);
  if (expandedSessionFamilies.has(key)) expandedSessionFamilies.delete(key);
  else expandedSessionFamilies.add(key);
  localStorage.setItem('pi-dish-expanded-session-families', JSON.stringify([...expandedSessionFamilies]));
  renderSessions();
}

function currentFamilyRootMap() {
  const list = [...sessionState.sessions.active, ...sessionState.sessions.previous];
  const roots = buildSessionFamilies(list);
  const map = new Map();
  const visit = (node, rootKey) => {
    map.set(sessionRefKey(node.session), rootKey);
    for (const child of node.children) visit(child, rootKey);
  };
  for (const root of roots) visit(root, sessionRefKey(root.session));

  // Filtered/Active views can omit an ancestor. Follow the server-confirmed
  // same-cwd family hint beyond the visible fragment so pins retain one stable
  // family identity and collect every visible sibling fragment.
  const byKey = new Map(list.map(session => [sessionRefKey(session), session]));
  for (const [memberKey, visibleRootKey] of map) {
    let canonical = visibleRootKey;
    let cursor = byKey.get(visibleRootKey);
    const seen = new Set([canonical]);
    while (cursor?.familyParentId) {
      const parentKey = sessionKey(cursor.host, cursor.familyParentId);
      if (seen.has(parentKey)) break;
      canonical = parentKey;
      seen.add(canonical);
      cursor = byKey.get(canonical);
    }
    map.set(memberKey, canonical);
  }
  return map;
}

function revealSessionInFamily(id, host = sessionState.sessionHostId(id)) {
  const key = sessionKey(host, id);
  const roots = buildSessionFamilies([...sessionState.sessions.active, ...sessionState.sessions.previous]);
  let ancestors = null;
  const find = (node, path) => {
    if (sessionRefKey(node.session) === key) { ancestors = path; return true; }
    return node.children.some(child => find(child, [...path, node]));
  };
  roots.some(root => find(root, []));
  let changed = false;
  for (const ancestor of ancestors || []) {
    if (!expandedSessionFamilies.has(sessionRefKey(ancestor.session))) {
      expandedSessionFamilies.add(sessionRefKey(ancestor.session));
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem('pi-dish-expanded-session-families', JSON.stringify([...expandedSessionFamilies]));
  }
}

// Pinned sessions live in a section at the top of the sidebar; one stored root
// id represents the whole same-workspace family, which drags as a block.
let pinnedSessions = readJSONPref('pi-dish-pinned-sessions', []);
let sidebarFamilyRootMap = new Map(); // refreshed once per sidebar render
// Set while a pinned row is being dragged — renderSessions must not rebuild
// the list out from under the drag (the 10s poll would otherwise do so).
let pinnedDragActive = false;

function savePinnedSessions() {
  localStorage.setItem('pi-dish-pinned-sessions', JSON.stringify(pinnedSessions));
}

function toggleSessionPinned(id, displayedRootId = id, renderedMemberIds = [id], host = sessionState.sessionHostId(id)) {
  const roots = currentFamilyRootMap();
  const key = sessionKey(host, id);
  const canonicalRoot = roots.get(key) || key;
  const aliases = new Set(renderedMemberIds.map(memberId => sessionKey(host, memberId)));
  aliases.add(sessionKey(host, displayedRootId));
  // Include collapsed descendants and legacy child pins from the complete
  // lists, but keep other hosts and cross-cwd relationships independent.
  for (const [memberKey, rootKey] of roots) {
    if (rootKey === canonicalRoot) aliases.add(memberKey);
  }
  // If Active/search omits the parent, an existing parent pin should still
  // toggle off from its visible child fragment.
  const visibleKeys = new Set([...document.querySelectorAll('#sessionList .session-item[data-id]')]
    .map(row => sessionKey(row.dataset.host, row.dataset.id)));
  for (const memberKey of aliases) {
    const { hostId, sessionId } = parseSessionKey(memberKey);
    const parentId = sessionState.findSession(sessionId, hostId)?.familyParentId;
    const parentKey = sessionKey(hostId, parentId);
    if (parentId && !visibleKeys.has(parentKey)) aliases.add(parentKey);
  }
  const wasPinned = pinnedSessions.some(pin => aliases.has(pin));
  pinnedSessions = pinnedSessions.filter(pin => !aliases.has(pin));
  if (!wasPinned) pinnedSessions.push(canonicalRoot);
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
    const family = handle.closest('.session-family-root');
    const segment = family?.parentElement;
    if (!family || !segment?.classList.contains('pinned-segment')) return;
    e.preventDefault();
    pinnedDragActive = true;
    family.classList.add('dragging');

    // Listeners go on document, not the handle: reordering detaches and
    // reinserts the row, which silently releases pointer capture on it.
    const onMove = (ev) => {
      const siblings = [...segment.children].filter(el =>
        el.classList.contains('session-family-root') && !el.classList.contains('dragging'));
      const next = siblings.find(sib => {
        const r = sib.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (next) segment.insertBefore(family, next);
      else segment.appendChild(family);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      family.classList.remove('dragging');
      pinnedDragActive = false;
      pinnedSessions = [...segment.children]
        .filter(el => el.classList.contains('session-family-root'))
        .map(el => el.dataset.familyKey);
      savePinnedSessions();
      renderSessions();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}

// =========================================================================
// Session row context menu — the copy-a-ref affordance.
//
// A ref is the short handle a session is pasted into another agent's prompt
// as (helpers.js `sessionRef`). Right-click is the whole gesture: Android
// long-press dispatches `contextmenu` too, so phones get this for free and
// there is deliberately no separate long-press machinery to keep in sync.
//
// One element, created on first use and reused. It is torn down by anything
// that could move the row out from under it — outside click, Escape, a scroll
// in any container, a resize, and a session-list re-render.
// =========================================================================
let sessionMenuEl = null;
let sessionMenuTimer = null;

/** The ref for a session, resolved against the host that actually owns it and
 *  widened past every same-host sibling that shares its prefix — a copied ref
 *  that names three sessions is one the owning server refuses. */
function sessionRefFor(session) {
  if (!session || !session.id) return '';
  return sessionRef(session, hostEntryFor(session.host || null), refPrefixFor(session));
}

function isSessionMenuOpen() {
  return !!sessionMenuEl && sessionMenuEl.style.display !== 'none';
}

function closeSessionMenu() {
  clearTimeout(sessionMenuTimer);
  if (sessionMenuEl) sessionMenuEl.style.display = 'none';
}

function ensureSessionMenu() {
  if (sessionMenuEl) return sessionMenuEl;
  const el = document.createElement('div');
  el.id = 'sessionMenu';
  el.className = 'context-menu';
  el.style.display = 'none';
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const item = e.target.closest('.context-menu-item');
    if (item) copyFromSessionMenu(item);
  });
  // Scroll doesn't bubble, so the capture phase is the only way to hear a
  // scroll in whichever container the row happens to live in.
  document.addEventListener('scroll', () => { if (isSessionMenuOpen()) closeSessionMenu(); }, true);
  window.addEventListener('resize', () => { if (isSessionMenuOpen()) closeSessionMenu(); });
  sessionMenuEl = el;
  return el;
}

function openSessionMenu(session, x, y) {
  const el = ensureSessionMenu();
  const ref = sessionRefFor(session);
  // The ref is short enough to read, so it doubles as the row's own preview;
  // the full id is not, and stays behind its label.
  el.innerHTML = [
    ['Copy session ref', ref, ref],
    ['Copy session id', session.id, ''],
  ].map(([label, value, preview]) => `
    <button type="button" class="context-menu-item" data-copy="${escapeHtml(value)}">
      <span class="context-menu-label">${escapeHtml(label)}</span>
      ${preview ? `<span class="context-menu-value">${escapeHtml(preview)}</span>` : ''}
    </button>`).join('');
  el.style.display = 'block';
  // Measure at the origin, then clamp — a menu opened near the right or
  // bottom edge must stay whole rather than extend the page.
  el.style.left = '0px';
  el.style.top = '0px';
  const { offsetWidth: w, offsetHeight: h } = el;
  el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
  // The detached-target rule matters here too: copying re-renders the menu's
  // innards, and the click that did it must not read as "outside".
  armOutsideClickClose(['sessionMenu'], closeSessionMenu, isSessionMenuOpen);
}

/** Copy an item's value, confirm quietly in place, then dismiss. */
function copyFromSessionMenu(item) {
  const label = item.querySelector('.context-menu-label');
  copyTextToClipboard(item.dataset.copy || '').then(
    () => {
      if (label) label.textContent = 'Copied';
      item.classList.add('copied');
      clearTimeout(sessionMenuTimer);
      sessionMenuTimer = setTimeout(closeSessionMenu, 700);
    },
    () => {
      closeSessionMenu();
      setStatus('Copy failed (clipboard blocked)', 'error');
    },
  );
}

let lastSessionListHtml = '';

function renderSessions() {
  if (pinnedDragActive) return; // don't rebuild mid-drag; the drop re-renders
  sidebarFamilyRootMap = currentFamilyRootMap();
  hostSectionsShown = null; // only the workspace view builds host sections
  const list = document.getElementById('sessionList');
  const { active, previous } = sessionState.sessions;
  // A live subagent runs inside a live session's process, so it belongs on
  // the Active tab even though it is a historical row everywhere else (its
  // parent owns it; pi-dish has no socket to it). The count badge stays a
  // count of *controllable* sessions.
  const showing = sidebarTab === 'active'
    ? [...active, ...previous.filter(session => session.subagentLive)]
    : [...active, ...previous];
  const pending = [...pendingSessionSpawns.entries()];

  const countEl = document.getElementById('countActive');
  if (countEl) countEl.textContent = (active.length + pending.length) || '';

  // Routine-invoked sessions are automation: every cron tick is one, so the
  // historical list fills with them. They stay out of the sidebar unless the
  // typed query or an active scope affirmatively asks (`is:automation`,
  // `routine:name`); a live one is real work in flight and stays. Hidden
  // rows remain in `sessions` — selection, refs, restore and the search
  // facets all keep working; only this render skips them.
  const sq = scopeQuery();
  const scopeParsed = sq ? parseSessionQuery(sq) : null;
  const asksAutomation = queryAsksForAutomation(parseSessionQuery(filterQuery))
    || (scopeParsed ? queryAsksForAutomation(scopeParsed) : false);
  let visible = showing, automationHidden = 0;
  if (!asksAutomation) {
    visible = showing.filter((session) => {
      if (session.isActive || !isAutomationSession(session)) return true;
      automationHidden++;
      return false;
    });
  }
  // Once the lists reflect the typed query, the server's filtering (which
  // includes message content) is authoritative — re-filtering locally would
  // drop content-only matches, since the local pass is metadata-only. Until
  // that response lands, narrow locally so typing feels instant.
  // `host:` is the exception: it never reached the server, so it is applied
  // here on top of what the server-filtered lists came back with (the
  // debounce-window applyLocalFilter path evaluates it inline).
  const queried = (filterQuery && listsQueriedFor === filterQuery)
    ? applyHostTerms(visible, filterQuery)
    : applyLocalFilter(visible, filterQuery);
  // Active scopes apply client-side on top of whatever the query kept —
  // metadata/date-only by design, so they behave identically on both tabs.
  const filtered = scopeParsed ? queried.filter(s => evaluateSessionQuery(scopeParsed, s)) : queried;
  const scopesHidden = queried.length - filtered.length;

  let html = '';
  // First boot over a big corpus: the server is still indexing and the list
  // below is partial — say so (loadSessions re-polls until it settles).
  if (sidebarTab === 'all' && sessionIndexing) {
    html += '<div class="indexing-note">Indexing sessions…</div>';
  }
  if (pending.length) {
    html += `<div class="session-segment starting-segment">
      <div class="workspace-group-header starting-header">
        <span class="workspace-group-label">Starting</span>
        <span class="workspace-group-count">${pending.length}</span>
      </div>
      ${pending.map(([id, spawn]) => renderPendingSessionItem(id, spawn)).join('')}
    </div>`;
  }
  if (filtered.length === 0 && pending.length === 0) {
    // With a query, `active` is the server-filtered list — an empty one
    // means "no matches", not "no sessions running".
    const msg = sidebarTab === 'active'
      ? (active.length === 0 && !filterQuery ? 'No active sessions<br><span style="font-size:11px">Click "+ New Session" or resume one from All</span>' : 'No matches')
      : (visible.length === 0 && !filterQuery ? 'No sessions found' : 'No matches');
    html += `<div class="empty-session"><p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">${msg}</p></div>`;
  } else if (filterQuery) {
    // Search results are one flat relevance-ranked list — grouping (and the
    // pinned section, a navigation aid for the unfiltered list) would scatter
    // the best matches across workspace/date buckets. The server's
    // searchScore counts transcript occurrences too, so it wins where present;
    // the interim local-filter pass scores metadata only. Recency breaks ties.
    const parsed = parseSessionQuery(filterQuery);
    const ranked = filtered
      .map(s => [s, s.searchScore ?? scoreSessionMatch(parsed, s)])
      .sort((a, b) => b[1] - a[1]
        || new Date(b[0].lastActivity || 0) - new Date(a[0].lastActivity || 0));
    html += `<div class="session-segment ranked-segment">
      ${ranked.map(([s]) => renderSessionItem(s, { showCwd: true })).join('')}
    </div>`;
  } else {
    const families = buildSessionFamilies(filtered);
    const [pinnedFamilies, restFamilies] = partitionPinnedFamilies(families, pinnedSessions);
    if (pinnedFamilies.length > 0) {
      html += `<div class="session-segment pinned-segment">
        <div class="workspace-group-header pinned-header">
          <span class="workspace-group-label">📌 Pinned</span>
          <span class="workspace-group-count">${pinnedFamilies.length}</span>
        </div>
        ${pinnedFamilies.map(family => renderSessionFamily(family, { pinnedFamily: true, showCwd: true })).join('')}
      </div>`;
    }
    if (sidebarView === 'recent') {
      // A family belongs to the date bucket of its newest member, so a recent
      // child moves the whole parent-first block instead of splitting it.
      html += groupSessionsByDate(restFamilies).map(renderDateBucket).join('');
    } else {
      html += renderWorkspaceTrees(flattenSessionFamilies(restFamilies));
    }
  }
  // A host that is down and has no cached rows would otherwise vanish
  // silently. One quiet line, no retry button: the poll keeps trying.
  html += hostOfflineNotesHtml();
  // Sessions a forgotten chip silently removed must stay discoverable — the
  // note is the audit trail for "why isn't my session in the list?".
  if (automationHidden > 0) {
    html += `<div class="scope-hidden-note">${automationHidden} automation run${automationHidden === 1 ? '' : 's'} hidden (is:automation shows them)</div>`;
  }
  if (scopesHidden > 0) {
    html += `<div class="scope-hidden-note">${scopesHidden} hidden by scopes</div>`;
  }

  // The 10s poll usually changes nothing — skip the DOM churn (and touch/hover
  // state loss) when the rendered HTML would be identical.
  if (html !== lastSessionListHtml) {
    // The rows the menu was anchored to are gone; a menu pointing at a
    // recycled row would copy the wrong session's ref.
    closeSessionMenu();
    list.innerHTML = html;
    lastSessionListHtml = html;
  }
  updateUnreadTitle();
}

/**
 * Collapse-state key for a workspace node. With several hosts in the list the
 * same cwd on two machines is two different workspaces (the doc's rule), so
 * the key — and therefore the tree, the count, and the collapse state — is
 * host-qualified. Single-host keys stay the bare path they have always been,
 * which is what keeps existing collapse state valid.
 */
function workspaceGroupKey(hostId, path) {
  return isMultiHost() && hostId ? sessionKey(hostId, path) : path;
}

// Host ids that got their own section in the current render — the offline
// notes below are the fallback for hosts *without* one, so a down host is
// never announced twice.
let hostSectionsShown = null;

/**
 * The workspace view. One host: exactly the tree it always built. Several:
 * one **host section** per host — a prominent heading (color dot, label,
 * count, reachability, collapse chevron) over that host's own workspace tree.
 * Sections, not interleaved top-level nodes: a fleet is read machine-first,
 * and a heading that names the host makes the per-node chips redundant.
 * Order is self first then by label — stable, deliberately not recency, so
 * the headings don't shuffle under the cursor.
 */
function renderWorkspaceTrees(list) {
  if (!isMultiHost()) {
    const tree = buildWorkspaceTree(groupByWorkspace(list, collapsedGroups), collapsedGroups);
    return tree.map(node => renderWorkspaceNode(node)).join('');
  }
  hostSectionsShown = new Set();
  let html = '';
  for (const host of sortHostSections(effectiveHosts())) {
    const hostId = host.hostId || null;
    const mine = list.filter(s => (s.host || null) === hostId);
    const down = hostIsDown(host);
    // A reachable host with nothing in the list is simply absent. A *down*
    // one still gets its heading — with the state on it — so "where did that
    // machine go?" is answered in place rather than in a footnote.
    if (!mine.length && !down) continue;
    hostSectionsShown.add(hostKeyOf(host));
    const key = hostSectionKey(hostKeyOf(host));
    const isCollapsed = collapsedGroups.has(key);
    let body = '';
    if (!isCollapsed) {
      // A collapsed-set view over the host-qualified keys: groupByWorkspace and
      // buildWorkspaceTree only ever ask `has(path)`, so no helper change.
      const collapsedView = { has: (path) => collapsedGroups.has(workspaceGroupKey(hostId, path)) };
      body = buildWorkspaceTree(groupByWorkspace(mine, collapsedView), collapsedView)
        .map(node => renderWorkspaceNode(node, { hostId })).join('');
      if (!mine.length) {
        body = `<div class="host-section-empty">${escapeHtml(hostState(host) === 'blocked'
          ? 'Enter this host’s token in Settings.' : 'Nothing cached from this host yet.')}</div>`;
      }
    }
    // Collapsing a section hides the whole machine, so the heading must not
    // hide activity — same rule (and same signals) as a workspace node.
    let headerDot = '';
    if (isCollapsed && mine.length) {
      if (mine.some(s => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
      else if (mine.some(isUnread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
    }
    const stateNote = down
      ? `<span class="host-section-state">${hostState(host) === 'blocked' ? 'needs a token' : 'unreachable'}</span>`
      : '';
    html += `<div class="host-section${isCollapsed ? ' collapsed' : ''}${down ? ' offline' : ''}" style="--host-color:${escapeHtml(hostColorFor(hostId))}">
      <div class="host-section-header" data-host-section="${escapeHtml(key)}" title="${escapeHtml(hostDisplayLabel(host) + (down ? ' — showing last known sessions' : ''))}">
        <span class="host-section-chevron">${isCollapsed ? '▸' : '▾'}</span>
        ${hostDotHtml(hostId, 'host-section-dot')}
        <span class="host-section-name">${escapeHtml(hostDisplayLabel(host))}</span>
        ${stateNote}${headerDot}<span class="host-section-count">${mine.length}</span>
      </div>
      ${isCollapsed ? '' : `<div class="host-section-body">${body}</div>`}
    </div>`;
  }
  return html;
}

/**
 * Hosts that are down and have nothing to show in the current view — one
 * quiet line each. In the workspace view their section heading already says
 * it, so those are skipped.
 */
function hostOfflineNotesHtml() {
  if (!isMultiHost()) return '';
  return effectiveHosts().filter(host => {
    if (!hostIsDown(host)) return false;
    if (hostSectionsShown && hostSectionsShown.has(hostKeyOf(host))) return false;
    const cache = hostSessionLoader.getCache(host);
    return !cache || (!cache.active.length && !cache.previous.length);
  }).map(host => `<div class="host-offline-note">${escapeHtml(hostDisplayLabel(host))} — ${
    hostState(host) === 'blocked' ? 'needs a token (Settings)' : 'unreachable'}</div>`).join('');
}

/**
 * One workspace-tree node → a .session-segment: header (collapse toggle via
 * data-cwd, the node's path prefix), child nodes nested in an indented
 * .workspace-children, then this node's own sessions — folders before loose
 * sessions, file-manager style. Collapsing a node hides its whole subtree,
 * so the header must not hide activity: surface the best signal
 * (working > unread) from all descendant sessions as a header dot. Multi-host
 * trees sit inside a .host-section whose heading names the machine, so no
 * node header carries a host chip.
 */
function renderWorkspaceNode(node, opts = {}) {
  const hostId = opts.hostId || null;
  const groupKey = workspaceGroupKey(hostId, node.path);
  const isCollapsed = collapsedGroups.has(groupKey);
  let headerDot = '';
  if (isCollapsed) {
    const all = collectTreeSessions(node);
    if (all.some(s => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
    else if (all.some(isUnread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
  }
  let body = '';
  if (!isCollapsed) {
    if (node.children.length) {
      body = `<div class="workspace-children">${node.children.map(child => renderWorkspaceNode(child, { hostId })).join('')}</div>`;
    }
    body += buildSessionFamilies(node.sessions || []).map(family => renderSessionFamily(family)).join('');
  }
  return `<div class="session-segment${isCollapsed ? ' collapsed' : ''}">
    <div class="workspace-group-header" data-cwd="${escapeHtml(groupKey)}">
      <span class="workspace-group-chevron">${isCollapsed ? '▸' : '▾'}</span>
      <span class="workspace-group-label" title="${escapeHtml(node.path)}">${escapeHtml(node.label)}</span>
      ${headerDot}<span class="workspace-group-count">${node.count}</span>
      <button class="workspace-new-btn" data-path="${escapeHtml(node.path)}"${hostId ? ` data-host="${escapeHtml(hostId)}"` : ''} title="New session in ${escapeHtml(node.path)}">+</button>
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
  const bucketMembers = flattenSessionFamilies(bucket.sessions);
  let headerDot = '';
  if (isCollapsed) {
    if (bucketMembers.some(s => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
    else if (bucketMembers.some(isUnread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
  }
  const body = isCollapsed ? '' : bucket.sessions.map(family => renderSessionFamily(family, { showCwd: true })).join('');
  return `<div class="session-segment${isCollapsed ? ' collapsed' : ''}">
    <div class="workspace-group-header" data-cwd="${escapeHtml(key)}">
      <span class="workspace-group-chevron">${isCollapsed ? '▸' : '▾'}</span>
      <span class="workspace-group-label">${escapeHtml(bucket.label)}</span>
      ${headerDot}<span class="workspace-group-count">${bucketMembers.length}</span>
    </div>
    ${body}
  </div>`;
}

// =========================================================================
// Session Selection
// =========================================================================

function pendingComposerKey(spawnId) { return `spawn:${spawnId}`; }

// Show a usable pane before the bridge has produced a real session id. Keep
// currentSession null so no transcript/stream/action can accidentally target
// the operation id; only the composer is owned by the provisional key.
function showPendingSessionView(spawnId) {
  const spawn = pendingSessionSpawns.get(spawnId);
  if (!spawn) return;
  const harnessLabel = spawn.harnessLabel || 'Pi';
  sessionState.advanceSelection();
  sessionSearch.reset();
  loadingOlder = false;
  loadingOlderGeneration += 1;
  stashPromptState();
  cancelStreamingRender();
  closeSearch();
  closeDiffView();
  closeFileView();
  closeStatsModal();
  closeTreeModal();
  closeModelDropdown();
  closeThinkingDropdown();
  closeArtifactsModal();
  closeUsageView();
  closeSearchView();
  closeNewSessionView(); // the provisional pane replaces the takeover
  closeSkillsView();
  closeRoutinesView();
  closeRecoveryView();
  closeBounceView();
  stashCurrentTranscript();
  sessionState.setCurrentSession(null);
  currentSessionSpawnId = spawnId;

  if (streamReconnectTimeout) { clearTimeout(streamReconnectTimeout); streamReconnectTimeout = null; }
  if (messageStream) { messageStream.close(); messageStream = null; }
  followStream = false;
  closeTerminal();
  clearExtensionUI();
  // The provisional pane has no session identity yet. Do not leave the
  // previously selected session's parent/child chips in its header.
  clearSessionRelations();
  closeControlPanel();
  hideAutocomplete();
  modelCatalog.retire();
  composerAutocomplete.retireCommands();

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('sessionView').style.display = 'flex';
  document.querySelector('.input-area').style.display = '';
  document.getElementById('resumeBar').style.display = 'none';
  document.querySelector('.session-actions').style.display = 'none';

  renderQueueStatus(null);
  closeBtwPanel();
  setCompacting(false);
  setTurnInProgress(false);
  sessionInfo.resetArtifacts();

  const nameEl = document.getElementById('sessionName');
  nameEl.textContent = 'Starting session…';
  nameEl.classList.remove('editable-name');
  nameEl.title = '';
  const modelBtn = document.getElementById('sessionModel');
  modelBtn.textContent = `${harnessLabel} starting`;
  modelBtn.style.cursor = 'default';
  const ctxReset = document.getElementById('sessionContext');
  ctxReset.textContent = '0%';
  ctxReset.className = 'tool-btn tool-ctx';
  updateThinkingBadges();
  updateTerminalButtons();
  updateMicButton();

  oldestLoadedIndex = null;
  lastLoadedIndex = null;
  hasMoreOlder = false;
  totalMessages = 0;
  setMoodIndicator('', '');
  const targetLabel = spawn.target ? 'tmux' : 'the headless session';
  document.getElementById('messages').innerHTML = `<div class="empty-state pending-session-state" style="padding: 48px;">
    <p>Starting ${escapeHtml(harnessLabel)} in ${targetLabel}…</p>
    <small>You can write your prompt while it starts.</small>
  </div>`;

  restorePromptState(pendingComposerKey(spawnId));
  setComposerWaiting(true);
  setStatus(`${harnessLabel} is starting — your draft will be ready when it connects`, 'working');
  renderSessions();
  document.getElementById('promptInput').focus();
}

function showPendingSessionFailure(spawnId, message, spawn) {
  if (currentSessionSpawnId !== spawnId) return;
  const harnessLabel = spawn?.harnessLabel || 'Agent';
  document.getElementById('sessionName').textContent = 'Session failed to start';
  document.getElementById('messages').innerHTML = `<div class="empty-state pending-session-state" style="padding: 48px;">
    <p>${escapeHtml(harnessLabel)} could not start.</p>
    <small>${escapeHtml(message)}</small>
  </div>`;
  const input = document.getElementById('promptInput');
  input.placeholder = 'Your draft is preserved here so you can copy it';
  const btn = document.getElementById('btnSend');
  btn.disabled = true;
  btn.title = message;
}

async function selectSession(id, { forceTranscriptReload = false, host = null, keepBounceView = false } = {}) {
  // Validate the target before tearing anything down: a stale id (a resume
  // racing a filtered refresh, a pruned session) must leave the current view
  // intact instead of stashing the transcript and then bailing on a blank pane.
  if (!sessionState.findSession(id, host)) return;
  sessionState.advanceSelection();
  sessionSearch.reset();
  loadingOlder = false;
  loadingOlderGeneration += 1;
  stashPromptState();
  currentSessionSpawnId = null;
  setComposerWaiting(false);
  // Search marks are transient UI, but the pages search loaded are not. Clear
  // the marks before moving the current transcript into its short-lived DOM
  // cache so revisiting restores clean, already-finalized message nodes.
  cancelStreamingRender();
  // A recording belongs to the composer it was started from — switching away
  // discards it and releases the mic rather than dictating into a new session.
  cancelRecording();
  hideComposerNote();
  closeSearch();
  // The diff and file views show the previous session's workspace — close them
  // before stashing: their takeover CSS display:nones #messages, whose
  // scrollTop reads 0 while hidden and would be cached as the reader's spot.
  closeDiffView();
  closeFileView();
  closeStatsModal();
  closeTreeModal();
  closeModelDropdown();
  closeThinkingDropdown();
  closeArtifactsModal();
  closeUsageView(); // picking a session while the usage takeover is up means "show me that session"
  closeSearchView();
  closeNewSessionView();
  closeSkillsView();
  closeRoutinesView();
  closeRecoveryView();
  if (!keepBounceView) closeBounceView();
  stashCurrentTranscript();
  if (!sessionState.setCurrentSession(id, host)) return;
  const owner = sessionState.captureSelection();
  if (forceTranscriptReload) transcriptCache.delete(sessionRefKey(sessionState.currentSession));
  // Math rendering is transcript-only. Start its one-shot load while the
  // synchronous session chrome is updated, then gate markdown hydration on it.
  const mathAssetsReady = loadMathAssets().catch(() => {});
  revealSessionInFamily(id, sessionState.currentSession.host);
  // Tear down the previous session's stream up front, before the awaits below.
  // Left open, its in-flight turn_end/message_update events fire against the
  // session we're switching to (loadMessages has already reset the cursors).
  if (streamReconnectTimeout) { clearTimeout(streamReconnectTimeout); streamReconnectTimeout = null; }
  if (messageStream) { messageStream.close(); messageStream = null; }
  followStream = false; // forced follow doesn't carry across sessions
  // The terminal panel is per-session (its PTY keeps running server-side;
  // reopening reattaches with scrollback).
  closeTerminal();
  // Extension widgets/statuses/dialogs and relation navigation are
  // per-session; clear them before the new session's projections arrive.
  clearExtensionUI();
  clearSessionRelations();
  localStorage.setItem('pi-dish-session', sessionRefKey(sessionState.currentSession));
  markSessionSeen(sessionState.currentSession);
  
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('sessionView').style.display = 'flex';
  
  // Show/hide input area vs resume bar based on active state
  const inputArea = document.querySelector('.input-area');
  const resumeBar = document.getElementById('resumeBar');
  const sessionActions = document.querySelector('.session-actions');
  
  closeControlPanel();

  if (sessionState.currentSession.isActive) {
    if (inputArea) inputArea.style.display = '';
    if (resumeBar) resumeBar.style.display = 'none';
    resetResumeModelPicker();
    restorePromptState();
  } else {
    clearPromptComposer();
    if (inputArea) inputArea.style.display = 'none';
    // A live subagent's transcript belongs to the session running it, so
    // resuming would put a second harness process on a file that process
    // keeps appending to. The bar keeps the read-only label and Stats; only
    // the Resume affordance goes.
    const resumable = sessionSupports(sessionState.currentSession, 'resume');
    if (resumeBar) {
      resumeBar.style.display = '';
      const cwdSpan = resumeBar.querySelector('.resume-cwd');
      if (cwdSpan) cwdSpan.textContent = sessionState.currentSession.cwd || '~';
      const label = resumeBar.querySelector('.resume-label');
      if (label) {
        label.textContent = resumable
          ? 'Read-only — session is inactive'
          : 'Read-only — a live session owns this transcript';
      }
      const resumeBtn = resumeBar.querySelector('#resumeSessionBtn');
      if (resumeBtn) resumeBtn.style.display = resumable ? '' : 'none';
    }
    if (resumable) loadResumeModelOptions(sessionState.currentSession);
    else resetResumeModelPicker();
  }
  if (sessionActions) sessionActions.style.display = sessionState.currentSession.isActive ? '' : 'none';

  // Working state and queue strip are per-session — seed from the list data
  // instead of leaking the previous session's state until the init event.
  renderQueueStatus(null);
  closeBtwPanel();
  setCompacting(sessionState.currentSession.isActive && !!sessionState.currentSession.compacting);
  setTurnInProgress(sessionState.currentSession.isActive && !!sessionState.currentSession.turnInProgress);

  // Artifacts are per-session; clear the previous session's badge before the
  // fetch lands so a stale count never shows against the new session.
  sessionInfo.resetArtifacts();
  refreshArtifacts(owner);

  renderSessions();
  updateSessionHeader();
  loadSessionRelations(owner); // summary-only; don't stall transcript hydration
  if (sessionState.currentSession.isActive) {
    // Fire-and-forget: nothing below needs the results, and both can ask the
    // live session over its socket — don't stall the transcript on them.
    loadModels(id, sessionState.currentSession.harnessId);
    loadCommands(id); // refresh autocomplete with this session's commands
  }
  await mathAssetsReady;
  if (!sessionState.ownsSelection(owner)) return;
  await loadMessages(owner);
  if (!sessionState.ownsSelection(owner)) return;
  
  if (sessionState.currentSession.isActive) {
    startMessageStream(owner);
  } else {
    if (messageStream) { messageStream.close(); messageStream = null; }
  }
}

// Resume a previous session
let resumeModelsSeq = 0;

function resetResumeModelPicker() {
  resumeModelsSeq += 1;
  const wrap = document.getElementById('resumeModelWrap');
  const select = document.getElementById('resumeModelSelect');
  if (wrap) wrap.style.display = 'none';
  if (select) {
    select.disabled = true;
    select.innerHTML = '<option value="">Session model</option>';
  }
}

async function loadResumeModelOptions(session) {
  resetResumeModelPicker();
  const owner = sessionState.captureSelection();
  if (!session || session.harnessId !== 'omp' || !owner || owner.id !== session.id || owner.host !== (session.host || null)) return;
  const seq = resumeModelsSeq;
  const wrap = document.getElementById('resumeModelWrap');
  const select = document.getElementById('resumeModelSelect');
  if (!wrap || !select) return;
  wrap.style.display = 'flex';
  select.title = 'Loading Oh My Pi models…';
  try {
    const models = await sessionApi.models(owner.host, { harnessId: 'omp', cwd: session.cwd });
    if (seq !== resumeModelsSeq || !sessionState.ownsSelection(owner)) return;
    const current = session.model && session.model !== 'unknown' ? ` (${session.model})` : '';
    let html = `<option value="">Session model${escapeHtml(current)}</option>`;
    for (const model of Array.isArray(models) ? models : []) {
      const selector = model.selector || `${model.provider}/${model.id}`;
      html += `<option value="${escapeHtml(selector)}">${escapeHtml(selector)}</option>`;
    }
    select.innerHTML = html;
    select.disabled = false;
    select.title = 'Optionally override the model while resuming this OMP session';
  } catch (e) {
    if (seq !== resumeModelsSeq || !sessionState.ownsSelection(owner)) return;
    select.disabled = true;
    select.title = `Could not load Oh My Pi models: ${e.message}`;
  }
}

async function resumeSession() {
  if (!sessionState.currentSession) return;
  const owner = sessionState.captureSelection();
  const target = savedResumeTarget(owner.host);
  const model = sessionState.currentSession.harnessId === 'omp'
    ? (document.getElementById('resumeModelSelect')?.value || undefined) : undefined;
  setStatus(target ? 'Resuming in tmux…' : 'Resuming session...', 'working');

  try {
    const data = await apiSend(owner.host, `/api/sessions/${encodeURIComponent(owner.id)}/resume`, {
      ...(target ? { target } : {}),
      ...(model ? { model } : {}),
    });
    // Reload sessions and re-select (it's now active); refreshSessions
    // keeps an in-flight All-tab search intact.
    await refreshSessions();
    if (!sessionState.ownsSelection(owner)) return;
    setStatus('Session resumed');
    selectSession(data.id, { host: owner.host });
  } catch (e) {
    if (sessionState.ownsSelection(owner)) setStatus('Resume failed: ' + e.message, 'error');
  }
}

// =========================================================================
// Models
// =========================================================================

const modelCatalog = PiDishBrowser.createModelCatalog({
  read: scope => sessionApi.models(scope.host, scope),
  persist: (scope, models) => localStorage.setItem(modelsCacheKey(scope.harnessId, scope.host.hostId), JSON.stringify(models)),
  changed: refreshResponsePricingState,
  failed: error => console.error('Failed to load models:', error),
});
function modelCatalogUrl(harnessId, cwd) { return PiDishBrowser.modelCatalogUrl(harnessId, cwd); }
function modelsCacheKey(harnessId, hostId) {
  return PiDishBrowser.modelsCacheKey(harnessId, hostId, hostDirectory.self.hostId);
}
function loadModels(sessionId, harnessId, cwd, host) {
  const owner = sessionId ? sessionState.captureSelection() : null;
  const requestedHarnessId = harnessId || (sessionId ? sessionState.findSession(sessionId)?.harnessId : null) || 'pi';
  const requestedHost = sessionId ? sessionState.sessionHostId(sessionId) : (host === undefined ? null : host);
  const endpoint = hostEntryFor(requestedHost);
  if (!endpoint) { modelCatalog.clear(); return Promise.resolve(); }
  const captured = Object.freeze({ ...endpoint });
  const generation = newSessionController.generation;
  const ownsRows = () => PiDishBrowser.sameDirectoryHost(captured, hostEntryFor(requestedHost))
    && (sessionId ? owner && owner.id === sessionId && sessionState.ownsSelection(owner)
      : generation === newSessionController.generation && isNewSessionViewOpen()
        && nsHostId() === captured.hostId && selectedHarnessId() === requestedHarnessId);
  const ownsRequest = () => ownsRows() && (!!sessionId || nsCwdValue() === (cwd || ''));
  return modelCatalog.load({ host: captured, sessionId, harnessId: requestedHarnessId, cwd }, ownsRequest, ownsRows);
}

// =========================================================================
// Session Header
// =========================================================================

const sessionRelationsController = PiDishBrowser.createSessionRelations({
  document, window, sessionState, request: (host, path, init) => apiFetch(host, path, init), endpoint: hostEntryFor,
  loadPrevious: () => loadSessions(undefined, { withPrevious: true }),
  selectSession: (id, options) => selectSession(id, options), status: setStatus,
});
function clearSessionRelations() { sessionRelationsController.clear(); }
function loadSessionRelations(owner) { return sessionRelationsController.load(owner); }
function openRelatedSession(id, owner) { return sessionRelationsController.openRelated(id, owner); }
function openRelationsModal() { sessionRelationsController.openModal(); }
function closeRelationsModal() { sessionRelationsController.closeModal(); }

/**
 * Most model signal that fits the chip. The provider slug is the least
 * informative part, so it is dropped before the name is allowed to
 * ellipsize (CSS does the truncation). Full ref stays in the tooltip.
 */
function setModelChipLabel(btn, model, suffix) {
  const full = String(model || '');
  btn.title = full ? `${full} — change model` : 'Change model';
  btn.textContent = full + suffix;
  // scrollWidth is 0 while the header is hidden; then the full ref stands
  // and the next header update (the view is visible by then) trims it.
  if (btn.clientWidth && btn.scrollWidth > btn.clientWidth) {
    const short = shortModelName(full);
    if (short !== full) btn.textContent = short + suffix;
  }
}

function updateSessionHeader() {
  if (!sessionState.currentSession) return;

  document.getElementById('sessionName').textContent = sessionState.currentSession.name || 'Unnamed';
  const hostEl = document.getElementById('sessionHost');
  if (hostEl) {
    const showHost = isMultiHost() && !!hostEntryFor(sessionState.currentSession.host);
    hostEl.style.display = showHost ? '' : 'none';
    hostEl.className = 'badge host-badge' + (hostIdIsDown(sessionState.currentSession.host) ? ' offline' : '');
    // Same color the sidebar gave this host; the dot is a ::before, so the
    // badge stays a textContent write.
    hostEl.style.setProperty('--host-color', showHost ? hostColorFor(sessionState.currentSession.host) : '');
    hostEl.textContent = showHost ? hostLabelFor(sessionState.currentSession.host) : '';
  }
  const harnessEl = document.getElementById('sessionHarness');
  const showHarness = sessionState.currentSession.harnessId && sessionState.currentSession.harnessId !== 'pi';
  harnessEl.style.display = showHarness ? '' : 'none';
  if (showHarness) {
    const info = harnessBadgeInfo(sessionState.currentSession.harnessId, sessionState.currentSession.harnessLabel);
    const title = sessionState.currentSession.harnessLabel || info.label;
    ensureHarnessRows(sessionHostIdOf(sessionState.currentSession));
    // Clickable only where the host reports a settings view for this harness
    // (OMP's /agents + /models hubs today).
    const configurable = harnessSupportsSettings(sessionState.currentSession);
    harnessEl.className = `badge harness-badge harness-badge-${sessionState.currentSession.harnessId}`
      + (configurable ? ' clickable' : '');
    harnessEl.title = configurable ? `${title} settings: agents and models` : `${title} harness`;
    harnessEl.setAttribute('aria-label', configurable ? `${title} settings` : `${title} harness`);
    if (configurable) harnessEl.setAttribute('role', 'button');
    else harnessEl.removeAttribute('role');
    // Icon only in the header — the label span is CSS-hidden here, the name
    // lives in the tooltip. Sidebar rows show the full badge.
    harnessEl.innerHTML = harnessBadgeInnerHtml(info);
  } else {
    harnessEl.textContent = '';
  }
  // The tree has no header button any more (type /tree in the composer); the
  // mobile control panel keeps its row, so it still follows harness support.
  const cpTree = document.getElementById('cpTreeRow');
  if (cpTree) cpTree.style.display = sessionSupports(sessionState.currentSession, 'tree') ? '' : 'none';
  // Phone parity for the header badge: same modal from the control panel.
  const cpHarness = document.getElementById('cpHarnessRow');
  if (cpHarness) cpHarness.style.display = harnessSupportsSettings(sessionState.currentSession) ? '' : 'none';
  document.getElementById('btnExport').style.display = sessionSupports(sessionState.currentSession, 'export') ? '' : 'none';

  const nameEl = document.getElementById('sessionName');
  const canRename = sessionState.currentSession.isActive && sessionSupports(sessionState.currentSession, 'rename');
  nameEl.classList.toggle('editable-name', canRename);
  nameEl.title = canRename ? 'Click to rename' : '';

  const modelBtn = document.getElementById('sessionModel');
  const canSetModel = sessionState.currentSession.isActive && sessionSupports(sessionState.currentSession, 'setModel');
  setModelChipLabel(modelBtn, sessionState.currentSession.model, canSetModel ? ' ▾' : '');
  modelBtn.style.cursor = canSetModel ? 'pointer' : 'default';

  // One readout, in the composer field: percent only (its slot is fixed
  // width), with the token count in the tooltip.
  const ctxClass = contextClass(sessionState.currentSession.contextPercent);
  const contextEl = document.getElementById('sessionContext');
  contextEl.textContent = `${sessionState.currentSession.contextPercent}%`;
  contextEl.className = 'tool-btn tool-ctx' + (ctxClass ? ' ' + ctxClass : '');
  contextEl.title = sessionState.currentSession.contextTokens
    ? `Session stats — ${formatTokens(sessionState.currentSession.contextTokens)} tokens of context`
    : 'Session stats';

  updateThinkingBadges();
  updateTerminalButtons();
  updateMicButton();

  // Phone chip row: the working directory is the one piece of session
  // context the header used to hide behind the stats modal.
  const cwdChip = document.getElementById('sessionCwdChip');
  if (cwdChip) {
    const cwd = sessionState.currentSession.cwd || '';
    cwdChip.style.display = cwd ? '' : 'none';
    cwdChip.textContent = cwd ? (cwd.split('/').filter(Boolean).pop() || cwd) : '';
    cwdChip.title = cwd ? `${cwd} — session stats` : 'Session stats';
  }
}

// Header actions capture their selection before opening editors or dispatching.
const sessionControls = PiDishBrowser.createSessionControls({
  document, sessionState, catalog: modelCatalog, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  loadModels: (id, harness) => loadModels(id, harness), status: (message, type) => setStatus(message, type),
});
function updateThinkingBadges() { sessionControls.updateThinking(); }
function toggleThinkingDropdown() { return sessionControls.toggleThinking(); }
function closeThinkingDropdown() { sessionControls.closeThinking(); }
function selectThinkingLevel(level) { return sessionControls.selectThinking(level); }

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

// Whole-transcript search owns query requests, marks and serialized paging jumps.
const sessionSearch = PiDishBrowser.createSessionSearch({
  document, sessionState, request: (host, path, init) => apiFetch(host, path, init), endpoint: hostEntryFor,
  focusMode: () => focusMode, oldestIndex: () => oldestLoadedIndex, hasOlder: () => hasMoreOlder,
  loadOlder: () => loadOlderMessages(), stopFollowing: () => { followStream = false; }, updateJumpButton,
});
const search = sessionSearch.state;
function toggleSearchBar() { sessionSearch.toggle(); }
function openSearch() { sessionSearch.open(); }
function closeSearch() { sessionSearch.close(); }
function updateSearchCount(message) { sessionSearch.updateCount(message); }
function runSessionSearch(query, options) { return sessionSearch.run(query, options); }
function searchPrev() { return sessionSearch.move(-1); }
function searchNext() { return sessionSearch.move(1); }
function jumpToSearchResult() { return sessionSearch.jump(); }
function handleSearchKey(event) { sessionSearch.key(event); }

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

// Display preferences own modal requests, rendered controls and device readouts.
const displayPreferences = PiDishBrowser.createDisplayPreferences({
  document, storage: localStorage, request: (host, url, options) => apiFetch(host, url, options), host: () => hostEntryFor(null),
  beforeOpen: () => { closeSidebar(); closeBounceView(); },
  unmountSections: () => { recoveryController.unmountPreferences(); hostSettings.unmount(); },
  mountSections: body => { hostSettings.mount(body); refreshRecoveryHosts(); renderRecoveryPreferences(); },
  themes: { render: select => renderThemeSelect(select), apply: id => applyTheme(id) },
  filters: () => PiDishBrowser.decodeSavedFilters(savedFilters), setFilters: value => { savedFilters = [...value]; },
  persistFilters: (value, host) => persistSavedFilters([...value], host),
  metadataChanged: () => updateRenderedResponseMetadata(), contextChanged: () => renderSessions(), alert: message => alert(message),
});
function openSettingsModal() { displayPreferences.open(); }
function closeSettingsModal() { closeBounceView(); displayPreferences.close(); }
function renderPreferences() { return displayPreferences.render(); }

// Recovery owns its preferences/report views and captured host endpoints.
const recoveryController = PiDishBrowser.createRecovery({
  root: document.querySelector('.main'), request: apiFetch, hosts: effectiveHosts,
  supports: host => hostSupportsCapability(host, 'recovery', appConfig), down: hostIsDown,
  fleetReady: () => hostFleetReady, refreshFleet: loadHostFleet,
  selectedHost: () => sessionState.currentSession?.host || null,
  settingsOpen: () => document.getElementById('settingsModal').style.display !== 'none',
  closeOtherViews: () => { closeSettingsModal(); closeSidebar(); closeUsageView(); closeSearchView(); closeNewSessionView(); closeSkillsView(); closeRoutinesView(); closeBounceView(); closeDiffView(); closeFileView(); },
  confirm: message => confirm(message),
});
function refreshRecoveryHosts() { recoveryController.refreshHosts(); }
function renderRecoveryPreferences() { return recoveryController.mountPreferences(); }
function isRecoveryViewOpen() { return recoveryController.isOpen(); }
function closeRecoveryView() { recoveryController.close(); }
function openRecoveryView(hostId) { recoveryController.open(hostId); }
function loadRecoveryView() { return recoveryController.load(); }

// --- Hosts (settings section, not a takeover: it is a short list plus one
// add form). The catalog is device-local by design — a browser's own list of
// machines it can reach, tokens included; fleet entries come from the
// server's config and are shown read-only. ---------------------------------

const hostSettings = PiDishBrowser.createHostSettings({
  directory: hostDirectory, connections: hostConnections, discovery: hostDiscovery,
  request: apiFetch, protocol: () => location.protocol,
  promptToken: label => prompt(`Token for ${label}`, ''),
  displayLabel: hostDisplayLabel, escapeHtml,
  color: hostColorFor, customColor: hostColorIsCustom, resolveColor: resolveColorToHex,
  setColor: setHostColorOverride,
  onCatalogSaved: () => {
    if (isNewSessionViewOpen()) renderNsHosts();
    pruneHostCaches();
    renderHostsSection();
    renderSessions();
  },
  refreshSessions, renderNewSessionHosts: renderNsHosts,
});
function saveHostCatalog() { hostSettings.save(); }
function renderHostsSection() {
  refreshRecoveryHosts();
  hostSettings.render();
}

// Advanced search owns fleet query results, facet controls and click-through.
const searchViewController = PiDishBrowser.createSearchView({
  root: document.querySelector('.main'), request: apiFetch, sessionState,
  hosts: effectiveHosts, fanout: fanoutHosts, host: hostEntryFor, scope: scopeQuery,
  connection: (host, event, error) => {
    if (event === 'success') noteHostReachable(host);
    else if (event === 'blocked') noteHostBlocked(host);
    else noteHostFailure(host, error);
  },
  hostChip: hostChipHtml,
  closeOtherViews: () => { closeSidebar(); closeUsageView(); closeNewSessionView(); closeSkillsView(); closeRoutinesView(); closeRecoveryView(); closeBounceView(); },
  loadPrevious: () => loadSessions(undefined, { withPrevious: true }),
  selectSession: (id, options) => selectSession(id, options), sessionSearch,
});
function isSearchViewOpen() { return searchViewController.isOpen(); }
function openSearchView(query) { searchViewController.open(query); }
function closeSearchView() { searchViewController.close(); }
function onSearchViewInput(options) { searchViewController.input(options); }
function runSearchView() { return searchViewController.run(); }
function setSearchToken(prefix, value) { searchViewController.setToken(prefix, value); }
function openSearchResult(id, matches, host) { return searchViewController.openResult(id, matches, host); }

// The skills directory and coverage view retain their entry-host ownership.
const skillsController = PiDishBrowser.createSkills({
  root: document.querySelector('.main'), request: apiFetch, self: selfHostEntry, origin: () => location.origin,
  sessionState, loadPrevious: () => loadSessions(undefined, { withPrevious: true }),
  selectSession: (id, options) => selectSession(id, options),
  closeOtherViews: () => { closeSidebar(); closeUsageView(); closeSearchView(); closeNewSessionView(); closeRoutinesView(); closeRecoveryView(); closeBounceView(); },
  refine: ({ cwd, draft, host }) => { newSessionController.setHostId(host); openNewSessionView({ cwd, draft }); },
  copy: copyTextToClipboard, status: setStatus,
});
function isSkillsViewOpen() { return skillsController.isOpen(); }
function openSkillsView() { skillsController.open(); }
function closeSkillsView() { skillsController.close(); }
function refreshSkillsView() { skillsController.refresh(); }
function skillsViewEscape() { return skillsController.escape(); }
function backToSkillsDirectory() { skillsController.back(); }
function startSkillRefine() { skillsController.refine(); }
function openSkillDetail(path, options) { return skillsController.detail(path, options); }
function openSkillActivation(id, entryId) { return skillsController.activation(id, entryId); }

// Usage owns range/filter state, progressive fleet results and chart controls.
const usageController = PiDishBrowser.createUsageView({
  root: document.querySelector('.main'), request: apiFetch, storage: localStorage,
  fleetReady: () => hostFleetReady, hosts: fanoutHosts, host: hostEntryFor, multiHost: isMultiHost,
  closeOtherViews: () => { closeSidebar(); closeSearchView(); closeNewSessionView(); closeSkillsView(); closeRoutinesView(); closeRecoveryView(); closeBounceView(); },
  connection: (host, event, error) => {
    if (event === 'success') noteHostReachable(host);
    else if (event === 'blocked') noteHostBlocked(host);
    else noteHostFailure(host, error);
  },
  selectSession: (id, options) => selectSession(id, options),
});
function isUsageViewOpen() { return usageController.isOpen(); }
function openUsageView() { usageController.open(); }
function closeUsageView() { usageController.close(); }
function loadUsageView() { return usageController.load(); }
function setUsageRange(range) { usageController.setRange(range); }
function setUsageSort(sort) { usageController.setSort(sort); }
function setUsageStack(stack) { usageController.setStack(stack); }

// Session information owns stats/process/share controls and artifact discovery.
const sessionInfo = PiDishBrowser.createSessionInfo({
  document, request: (host, path, options) => apiFetch(host, path, options), sessionState, host: hostEntryFor,
  reference: session => sessionRefFor(session), copy: text => copyTextToClipboard(text), status: (text, type) => setStatus(text, type), confirm: text => confirm(text),
  loadPrevious: () => loadSessions(undefined, { withPrevious: true }), refreshSessions: () => refreshSessions(), selectSession: (id, options) => selectSession(id, options),
});
function openStatsModal() { sessionInfo.openStats(); }
function closeStatsModal() { sessionInfo.closeStats(); }
function copyMessageShareLink(button) { return sessionInfo.copyMessage(button); }
function finishSessionClose(id, host, owner) { return sessionInfo.finishClose(id, host, owner); }
function refreshArtifacts(owner) { return sessionInfo.refreshArtifacts(owner); }
function updateArtifactsBadge() { sessionInfo.updateBadge(); }
function openArtifactsModal() { sessionInfo.openArtifacts(); }
function closeArtifactsModal() { sessionInfo.closeArtifacts(); }

// File and diff takeovers share a typed owner and keep comment coordination explicit.
const fileViews = PiDishBrowser.createFileViews({
  document, sessionState, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  markdown: text => formatMarkdown(text), highlight: root => applyHighlight(root), copy: text => copyTextToClipboard(text),
  status: (message, type) => setStatus(message, type), refreshArtifacts: owner => refreshArtifacts(owner),
  closeComments: () => closeCommentBubble(), clearComments: () => setAnchoredComments([]),
  refreshComments: () => refreshAnchoredComments(), markComments: () => applyCommentMarks(),
});
function isFileViewOpen() { return fileViews.isFileOpen(); }
function ownsFileView(id, generation) { return fileViews.ownsFile(id, generation); }
function openFileViewer(mention) { return fileViews.openFile(mention); }
function closeFileView() { fileViews.closeFile(); }
function publishFileView() { return fileViews.publish(); }
function copyFileViewContent(button) { fileViews.copy(button); }
function isDiffViewOpen() { return fileViews.isDiffOpen(); }
function ownsDiffView(id, generation) { return fileViews.ownsDiff(id, generation); }
function toggleDiffView() { fileViews.toggleDiff(); }
function openDiffView() { return fileViews.openDiff(); }
function closeDiffView() { fileViews.closeDiff(); }
function loadDiffView() { return fileViews.loadDiff(); }
function loadDeferredDiffPatch(details) { return fileViews.loadPatch(details); }

// Anchored comments retain their view, request and editor lifetimes.
const anchoredCommentController = PiDishBrowser.createAnchoredComments({
  document, sessionState, views: fileViews, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  status: (message, type) => setStatus(message, type), loadPatch: details => loadDeferredDiffPatch(details),
});
function selectionTextAnchor(root, range) { return PiDishBrowser.selectionTextAnchor(root, range); }
function isCommentBubbleOpen() { return anchoredCommentController.isOpen(); }
function captureFileCommentSelection(focus) { anchoredCommentController.captureFile(focus); }
function captureDiffCommentSelection(focus) { anchoredCommentController.captureDiff(focus); }
function initCommentSelections() { anchoredCommentController.mount(); }
function positionCommentBubble() { anchoredCommentController.position(); }
function openCommentBubble(draft, range, focus) { anchoredCommentController.openDraft(draft, range, focus); }
function closeCommentBubble() { anchoredCommentController.close(); }
function handleCommentKey(event) { anchoredCommentController.key(event); }
function submitAnchoredComment() { return anchoredCommentController.submit(); }
function setAnchoredComments(list) { anchoredCommentController.set(list); }
function refreshAnchoredComments() { return anchoredCommentController.refresh(); }
function applyCommentMarks() { anchoredCommentController.applyMarks(); }
function renderCommentCountChips() { anchoredCommentController.renderChips(); }
function isCommentListPopoverOpen() { return anchoredCommentController.isListOpen(); }
function closeCommentListPopover() { anchoredCommentController.closeList(); }
function toggleCommentListPopover(chip) { anchoredCommentController.toggleList(chip); }
function renderCommentListPopover() { anchoredCommentController.renderList(); }
function focusAnchoredComment(id) { return anchoredCommentController.focus(id); }
function openCommentEditor(comment, anchor) { anchoredCommentController.openEditor(comment, anchor); }
function disarmCommentDelete() { anchoredCommentController.disarmDelete(); }
function handleCommentDelete() { return anchoredCommentController.remove(); }

function exportSession() { return sessionControls.export(); }
function downloadBlob(blob, name) { sessionControls.download(blob, name); }
function startRename() { sessionControls.startRename(); }
function handleRenameKey(event) { sessionControls.renameKey(event); }
function commitRename() { return sessionControls.commitRename(); }
function cancelRename() { sessionControls.cancelRename(); }
function toggleModelDropdown() { return sessionControls.toggleModels(); }
function renderModelDropdown(query) { sessionControls.renderModels(query); }
function enterModelEditMode() { sessionControls.setEditMode(true); }
function exitModelEditMode() { sessionControls.setEditMode(false); }
function currentModelQuery() { return sessionControls.query; }
function toggleModelEnabled(selector) { sessionControls.toggleModel(selector); }
function setAllModelsEnabled(enabled) { sessionControls.setAll(enabled); }
function toggleProviderEnabled(provider) { sessionControls.toggleProvider(provider); }
function saveEnabledModels() { sessionControls.saveEnabled(); }
function closeModelDropdown() { sessionControls.closeModels(); }
function selectModel(selector) { return sessionControls.selectModel(selector); }

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
let loadingOlderGeneration = 0;

// Recently viewed transcript DOM, keyed by host+session, including every page the reader explicitly
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
  const id = sessionState.currentSession && sessionRefKey(sessionState.currentSession);
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
  id = sessionKey(sessionState.sessionHostId(id), id);
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
  if (msg.role === 'assistant') {
    // OMP persists an empty assistant shell when thinking is interrupted. The
    // following interrupted-thinking marker carries the useful UI; avoid a
    // stray π header while preserving the message/index in the API.
    if (Array.isArray(msg.content) && msg.content.length === 0 && !msg.errorMessage) return '';
    return renderAssistantMessage(msg, time, { attrs: idxAttr });
  }
  if (msg.role === 'toolResult') return renderToolResult(msg, time, idxAttr);
  if (msg.role === 'branchSummary') return renderBranchSummary(msg, time, idxAttr);
  if (msg.role === 'custom') return renderCustomMessage(msg, time, idxAttr);
  return '';
}

async function loadMessages(owner = sessionState.captureSelection()) {
  if (!sessionState.ownsSelection(owner)) return;
  const { id, host } = owner;
  cancelStreamingRender();
  closeSearch();
  const container = document.getElementById('messages');
  if (restoreCachedTranscript(id)) {
    // Keep the warm pages visible while checking for anything appended since
    // this session was last viewed. Inactive sessions have no SSE init to do
    // this catch-up for them.
    await fetchNewMessagesSince(owner);
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
    const res = await apiFetch(host, `/api/sessions/${encodeURIComponent(id)}/messages?limit=${MESSAGE_PAGE_SIZE}`);
    const data = await res.json();
    // A newer selection may have superseded us while the fetch was in flight —
    // don't clobber its transcript/cursors with this stale response.
    if (!sessionState.ownsSelection(owner)) return;
    const { messages, session, firstIndex, lastIndex, hasMore, totalMessages: total } = data;
    sessionState.mergeCurrentSession(owner, session);
    oldestLoadedIndex = firstIndex;
    lastLoadedIndex = lastIndex;
    hasMoreOlder = !!hasMore;
    totalMessages = total || 0;
    renderMessages(messages);
  } catch (e) {
    if (!sessionState.ownsSelection(owner)) return;
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
  if (loadingOlder || !hasMoreOlder || !sessionState.currentSession || oldestLoadedIndex == null) return;
  loadingOlder = true;
  const owner = sessionState.captureSelection();
  const { id: sessionId, host } = owner;
  const requestGeneration = ++loadingOlderGeneration;
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
    const res = await apiFetch(host, `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${beforeIndex}`);
    const data = await res.json();
    // The request belongs to the transcript that initiated it. A quick
    // session switch or same-session forced reload must not prepend those
    // messages into the replacement transcript.
    if (!sessionState.ownsSelection(owner) || requestGeneration !== loadingOlderGeneration) return;
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
    if (!sessionState.ownsSelection(owner) || requestGeneration !== loadingOlderGeneration) return;
    if (bar) bar.querySelector('.load-older-btn').textContent = `Failed: ${e.message} — retry`;
  } finally {
    if (requestGeneration === loadingOlderGeneration) loadingOlder = false;
  }
}

async function fetchNewMessagesSince(owner = sessionState.captureSelection()) {
  if (!sessionState.ownsSelection(owner)) return;
  const { id: sessionId, host } = owner;
  // Incremental catch-up after turn_end / init. Avoids the full reload that
  // stalls long sessions.
  if (lastLoadedIndex == null) {
    // No baseline yet — fall back to a full tail load.
    return loadMessages(owner);
  }
  try {
    const res = await apiFetch(host, `/api/sessions/${encodeURIComponent(sessionId)}/messages?after=${lastLoadedIndex}`);
    const data = await res.json();
    // Bail if the user switched sessions or force-reloaded this same session
    // while the catch-up was in flight.
    if (!sessionState.ownsSelection(owner)) return;
    const { messages, lastIndex, totalMessages: total, session } = data;
    sessionState.mergeCurrentSession(owner, session);
    if (typeof total === 'number') totalMessages = total;
    if (!messages || messages.length === 0) return;

    const container = document.getElementById('messages');
    if (!container) return;

    // Skip indices we already rendered (defensive — server uses strict >).
    const existing = new Set();
    container.querySelectorAll('[data-msg-index]').forEach(el => existing.add(parseInt(el.dataset.msgIndex, 10)));
    const fresh = messages.filter(m => !existing.has(m.index));
    // If this browser was away when pi emitted the user echo, the stream could
    // not consume its optimistic association. The authoritative indexed user
    // message is now present, so that association no longer has work to do.
    fresh.filter(m => m.role === 'user').forEach(m => {
      consumePendingSelfEcho(sessionId, m.content);
    });
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
    if (!sessionState.ownsSelection(owner)) return;
    console.error('fetchNewMessagesSince failed:', e);
  }
}

// Image content blocks → a `.msg-images` thumbnail row (empty string when
// none), shared by user messages, tool results, and live tool panels so the
// tap-to-zoom lightbox delegation works everywhere. Escape both the mime type
// and the data before dropping them into the attribute — well-formed base64
// has no HTML-special chars so escaping is a no-op for it, but malformed data
// must not be able to break out of the src attribute.
//
// Resource URLs (everything but small live-streamed inline base64) are
// relative to the host that owns the session, and every caller here renders
// into the transcript of the selected one — so that is the host to resolve
// against, not the serving origin.
function imageBlocksHtml(content, alt = 'image') {
  const images = extractImageBlocks(content);
  if (!images.length) return '';
  const imgs = images.map(img => {
    const src = img.url
      ? hostAssetUrl(sessionState.currentSession?.host, img.url)
      : `data:${img.mimeType};base64,${img.data}`;
    const loading = img.url ? ' loading="lazy" decoding="async"' : '';
    return `<img class="msg-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${loading}>`;
  }).join('');
  return `<div class="msg-images">${imgs}</div>`;
}

// Hover 🔗 on a turn header: copies the public share URL deep-linked to this
// message (pi's HTML export scrolls to ?targetId=<JSONL entry id>). Only
// JSONL-backed messages have an entry id — streaming placeholders don't.
function messageLinkBtnHtml(msg) {
  if (!msg.id || !sessionSupports(sessionState.currentSession, 'export')) return '';
  return `<button type="button" class="msg-link-btn" data-entry-id="${escapeHtml(msg.id)}" title="Copy share link to this message">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg></button>`;
}

// The <session-refs> block the send routes append is context for the model,
// not for the reader: the transcript hides it and shows one chip per ref,
// which opens the session it names. Optimistic bubbles carry the same entries
// on `msg.sessionRefs` — the server's copy only arrives with the echo, and by
// then the echo has been suppressed.
function sessionRefChipsHtml(refs) {
  if (!refs || !refs.length) return '';
  const chips = refs.map((entry) => {
    const session = sessionMatchingRef(entry.ref);
    const label = entry.name || session?.name || entry.ref;
    const live = (session ? session.isActive : entry.isActive) ? ' live' : '';
    const title = [entry.ref, entry.host, entry.cwd].filter(Boolean).join(' · ');
    return `<button type="button" class="session-ref-chip${live}" data-session-ref="${escapeHtml(entry.ref)}" title="${escapeHtml(title)}">
      <span class="session-ref-dot">●</span>${escapeHtml(label)}</button>`;
  }).join('');
  return `<div class="session-ref-chips">${chips}</div>`;
}

function renderUserMessage(msg, time, attrs = '') {
  const { text, refs } = splitSessionRefContext(extractTextContent(msg.content));
  const imagesHtml = imageBlocksHtml(msg.content, 'attached image');
  const chipsHtml = sessionRefChipsHtml(msg.sessionRefs || refs);
  return `<div${attrs} class="message user">
    <div class="message-header"><span class="message-role user">❯</span>${time ? `<span class="message-time">${time}</span>` : ''}${messageLinkBtnHtml(msg)}</div>
    <div class="message-content user-content">${text ? `<div class="markdown-body">${formatMarkdown(text)}</div>` : ''}${imagesHtml}${chipsHtml}</div>
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
  
  const showModel = msg.model && (!sessionState.currentSession || msg.model !== sessionState.currentSession.model);
  // Tool-only messages (no prose, no error) are fully hidden in focus mode —
  // without this their empty header row lingers as a stray marker.
  const noTextClass = messageHasVisibleText(msg) ? '' : ' no-text';
  // Effective response speed rides the header next to the time — JSONL-backed
  // renders only (streaming messages have no timing until finalized).
  let speedHtml = '';
  const hasMetadata = !opts.streaming && (msg.usage || msg.durationMs);
  const detail = hasMetadata ? responseDetailProjection(msg) : null;
  const metadata = detail ? formatResponseMetadata(detail, displayPreferences.responseMode) : null;
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
    const text = formatResponseMetadata(responseDetails.get(btn.dataset.detailId), displayPreferences.responseMode);
    btn.textContent = text || '';
    btn.style.display = text ? '' : 'none';
  });
}

function responsePricingKnown(msg) {
  return Number.isFinite(msg?.usage?.cost?.total);
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
  const selected = m.model || sessionState.currentSession?.model || '—';
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
    ['Estimated input', formatEstimatedCost(c.input)],
    ['Estimated output', formatEstimatedCost(c.output)],
    ['Estimated cache read / write', `${formatEstimatedCost(c.cacheRead)} / ${formatEstimatedCost(c.cacheWrite)}`],
    ['Estimated total', formatEstimatedCost(c.total)], ['Stop reason', m.stopReason || '—'],
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
  // Prime's ipython tool takes one `code` argument; the raw JSON wrapper
  // around it is noise. Other tools keep the JSON dump.
  const bodyHtml = block.name === 'ipython' && typeof args.code === 'string'
    ? `<pre><code>${escapeHtml(args.code)}</code></pre>`
    : `<pre><code>${escapeHtml(JSON.stringify(args, null, 2))}</code></pre>`;

  return `<details class="tool-call">
    <summary class="tool-call-header">
      <span class="tool-call-icon">⚡</span><span class="tool-call-name">${escapeHtml(block.name)}</span>
      ${summary ? `<span class="tool-call-summary">${escapeHtml(summary)}</span>` : ''}
    </summary>
    <div class="tool-call-content">${bodyHtml}</div>
  </details>`;
}

function renderToolResult(msg, time, attrs = '') {
  let content = extractTextContent(msg.content);
  const isError = msg.isError;
  const timestamp = msg.timestamp || Date.now();
  // Prime's ipython results are a BashResult repr; show the wrapped command
  // output (and a nonzero-exit chip) instead of the Python repr.
  const parsed = parseIpythonResult(content);
  let exitBadge = '';
  if (parsed) {
    content = parsed.output;
    if (parsed.exitCode !== 0) exitBadge = `<span class="tool-result-meta error-badge">exit ${parsed.exitCode}</span>`;
  }
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
        ${exitBadge}
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

// OMP advisor notes — a second model passively reviewing each turn. The JSONL
// entry carries structured notes in details.notes and an <advisory> XML
// rendering of the same thing in content; prefer the structure, fall back to
// unwrapping the XML so an older/odder producer still reads as prose.
const ADVISOR_SEVERITIES = ['nit', 'concern', 'blocker'];

function advisoryTagAttr(rawAttrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(rawAttrs || '');
  return m ? m[1].trim() : '';
}

function normalizeAdvisorSeverity(value) {
  const sev = String(value || '').trim().toLowerCase();
  return ADVISOR_SEVERITIES.includes(sev) ? sev : '';
}

// Split an <advisory ...>note</advisory> batch into notes. Anything that isn't
// wrapped (or is only half-wrapped) survives as a single unwrapped note rather
// than leaking raw tags into the card.
function parseAdvisoryContent(text) {
  const notes = [];
  const re = /<advisory\b([^>]*)>([\s\S]*?)<\/advisory>/gi;
  let m;
  while ((m = re.exec(text))) {
    const note = m[2].trim();
    if (note) notes.push({ note, severity: advisoryTagAttr(m[1], 'severity'), advisor: advisoryTagAttr(m[1], 'advisor') });
  }
  if (notes.length) return notes;
  const bare = String(text || '').replace(/<\/?advisory\b[^>]*>/gi, '').trim();
  return bare ? [{ note: bare }] : [];
}

function advisorNotesFrom(msg) {
  const structured = Array.isArray(msg.details?.notes) ? msg.details.notes : null;
  const notes = (structured && structured.length ? structured : parseAdvisoryContent(extractTextContent(msg.content)))
    .map(n => ({
      note: typeof n === 'string' ? n : String(n?.note || ''),
      severity: normalizeAdvisorSeverity(typeof n === 'string' ? '' : n?.severity),
      advisor: typeof n === 'string' ? '' : String(n?.advisor || '').trim(),
    }))
    .filter(n => n.note);
  return notes;
}

// A batch may name its advisor only on the XML wrapper (multi-advisor
// rosters), so fall back to that when the structured notes carry no name.
function advisoryBatchName(msg) {
  const m = /<advisory\b([^>]*)>/i.exec(extractTextContent(msg.content));
  return m ? advisoryTagAttr(m[1], 'advisor') : '';
}

function advisorSeverityChip(severity) {
  if (!severity) return '';
  return `<span class="advisor-severity sev-${severity}">${escapeHtml(severity)}</span>`;
}

// A quiet card, not a boxed callout: hairline left accent tinted by the worst
// severity in the batch, notes rendered as markdown (they carry `code` spans).
// Conversation content, so it stays visible in focus mode.
function renderAdvisorMessage(msg, time, attrs, timestamp) {
  const notes = advisorNotesFrom(msg);
  if (!notes.length) return '';
  const worst = ADVISOR_SEVERITIES.filter(s => notes.some(n => n.severity === s)).pop() || '';
  const names = [...new Set(notes.map(n => n.advisor).filter(Boolean))];
  const name = names.length === 1 ? names[0] : (names.length ? '' : advisoryBatchName(msg));
  const single = notes.length === 1;
  const rows = notes.map(n => `<div class="advisor-note">
        ${single ? '' : advisorSeverityChip(n.severity)}${!single && !name && n.advisor ? `<span class="advisor-note-name">${escapeHtml(n.advisor)}</span>` : ''}
        <div class="markdown-body">${formatMarkdown(n.note)}</div>
      </div>`).join('');
  return `<div${attrs} class="message custom-message advisor${worst ? ` sev-${worst}` : ''}" data-timestamp="${timestamp}">
    <div class="advisor-card">
      <div class="advisor-header">
        <span class="advisor-icon">◈</span>
        <span class="advisor-label">Advisor${name ? ` · ${escapeHtml(name)}` : ''}</span>
        ${single ? advisorSeverityChip(notes[0].severity) : `<span class="advisor-count">${notes.length} notes</span>`}
        ${time ? `<span class="message-time">${time}</span>` : ''}
      </div>
      <div class="advisor-notes">${rows}</div>
    </div>
  </div>`;
}

// OMP conversational custom messages. interrupted-thinking deliberately
// carries hidden reasoning in JSONL; session-files strips that content and we
// render only this divider. Visible unknown types get a subdued generic row so
// future host additions cannot vanish without explanation.
function renderCustomMessage(msg, time, attrs = '') {
  const customType = msg.customType || 'custom-message';
  const timestamp = msg.timestamp || Date.now();
  if (customType === 'interrupted-thinking') {
    return `<div${attrs} class="message custom-message interrupted" data-timestamp="${timestamp}">
      <span class="custom-message-divider"></span><span class="custom-message-label">Interrupted</span>${time ? `<span class="message-time">${time}</span>` : ''}<span class="custom-message-divider"></span>
    </div>`;
  }

  // Unknown hidden custom messages are internal model/session continuity.
  // session-files applies the same explicit skip historically; enforce it
  // here too because live bridge events do not pass through that decoder.
  if (msg.display === false) return '';

  if (customType === 'async-result') {
    const jobs = Array.isArray(msg.details?.jobs) ? msg.details.jobs : [];
    const names = jobs.map(job => job.label || job.jobId).filter(Boolean);
    const duration = jobs.length === 1 && Number.isFinite(jobs[0].durationMs)
      ? formatDuration(jobs[0].durationMs) : '';
    const meta = [names.join(', '), duration].filter(Boolean).join(' · ');
    return `<div${attrs} class="message custom-message async-result" data-timestamp="${timestamp}">
      <span class="custom-message-icon">✓</span><span class="custom-message-label">Background job${jobs.length > 1 ? 's' : ''} finished</span>${meta ? `<span class="custom-message-meta">${escapeHtml(meta)}</span>` : ''}${time ? `<span class="message-time">${time}</span>` : ''}
    </div>`;
  }

  if (customType === 'advisor') return renderAdvisorMessage(msg, time, attrs, timestamp);

  const text = extractTextContent(msg.content);
  const label = customType.replace(/[-_]+/g, ' ');
  return `<div${attrs} class="message custom-message generic" data-timestamp="${timestamp}">
    <span class="custom-message-icon">◇</span><span class="custom-message-label">${escapeHtml(label)}</span>${text ? `<span class="custom-message-meta">${escapeHtml(truncate(text.replace(/\s+/g, ' '), 240))}</span>` : ''}${time ? `<span class="message-time">${time}</span>` : ''}
  </div>`;
}

function liveCustomMessageKey(message) {
  const jobs = Array.isArray(message?.details?.jobs)
    ? message.details.jobs.map(job => job.jobId).filter(Boolean).join(',') : '';
  return `${message?.customType || 'custom-message'}:${message?.timestamp || jobs}`;
}

function upsertLiveCustomMessage(message, { streaming = false } = {}) {
  const container = document.getElementById('messages');
  if (!container) return;
  const wasPinned = isPinnedToBottom(container);
  const key = liveCustomMessageKey(message);
  const existing = [...container.querySelectorAll('.message.custom-message[data-live-custom-key]')]
    .find(el => el.dataset.liveCustomKey === key);
  const attrs = ` data-live-custom-key="${escapeHtml(key)}"${streaming ? ' data-streaming="true"' : ''}`;
  const tmp = document.createElement('template');
  tmp.innerHTML = renderCustomMessage(message, formatTime(message.timestamp || Date.now()), attrs);
  const el = tmp.content.firstElementChild;
  if (!el) return;
  if (existing) existing.replaceWith(el);
  else container.appendChild(el);
  if (wasPinned || followStream) scrollToBottom(container); else updateJumpButton(container);
}

// =========================================================================
// Live Tool Panels (streaming tool execution)
// =========================================================================

// One place for the output escaping + truncation — a freshly appended panel
// and an incrementally updated one must render output identically. Prime's
// ipython results land here as a BashResult repr once complete; the parse
// only matches the full text, so streaming prefixes fall through raw.
function liveToolOutputHtml(output) {
  const parsed = parseIpythonResult(output);
  return escapeHtml(truncate(parsed ? parsed.output : output, 8000));
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

function appendLiveToolPanel(data, { completionOnly = false } = {}) {
  const { toolCallId, toolName, args } = data;
  if (!toolCallId) return null;
  const existing = liveToolPanels.get(toolCallId);
  const resolvedName = toolName || existing?.toolName || 'tool';
  const resolvedArgs = args ?? existing?.args ?? {};
  runningTools.set(toolCallId, resolvedName);
  updateWorkingIndicator();
  if (existing?.el?.isConnected && existing.el.classList.contains('running')) {
    return existing; // cumulative/repeated starts never duplicate a panel
  }

  const container = document.getElementById('messages');
  if (!container) return null;

  const wasPinned = isPinnedToBottom(container);
  const html = buildLiveToolPanel(toolCallId, resolvedName, resolvedArgs, '', false, false);
  let el;
  if (existing?.el?.isConnected) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    el = tmp.firstElementChild;
    existing.el.replaceWith(el);
  } else {
    container.insertAdjacentHTML('beforeend', html);
    el = container.lastElementChild;
  }

  const parsedStartedAt = Number.isFinite(data.startedAt)
    ? data.startedAt : (typeof data.startedAt === 'string' ? Date.parse(data.startedAt) : NaN);
  const entry = {
    el,
    startTime: Number.isFinite(parsedStartedAt) ? parsedStartedAt : (completionOnly ? null : Date.now()),
    toolName: resolvedName,
    args: resolvedArgs,
  };
  liveToolPanels.set(toolCallId, entry);
  if (wasPinned) scrollToBottom(container); else updateJumpButton(container);
  return entry;
}

function updateLiveToolPanel(data) {
  const { toolCallId, partialResult } = data;
  let entry = liveToolPanels.get(toolCallId);
  if (!entry?.el?.isConnected || !entry.el.classList.contains('running')) {
    // OMP may emit completion/background updates without a start, or after
    // turn-end JSONL cleanup removed the original panel. Re-open by id.
    entry = appendLiveToolPanel({
      ...data,
      toolName: data.toolName || entry?.toolName,
      args: data.args ?? entry?.args,
    });
  }
  if (!entry?.el) return;

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
  let entry = liveToolPanels.get(toolCallId);
  if (!entry?.el?.isConnected) {
    // Provider-resolved tools can legitimately be completion-only. The same
    // path also recreates a background job panel after turn-end cleanup.
    entry = appendLiveToolPanel(data, { completionOnly: true });
  }
  runningTools.delete(toolCallId);
  updateWorkingIndicator();
  const resolvedName = toolName || entry?.toolName || 'tool';
  const resolvedArgs = args ?? entry?.args ?? {};
  applyMoodFromTool(resolvedName, resolvedArgs);
  if (!entry?.el) return;

  const output = getToolOutputText(result);
  const imagesHtml = imageBlocksHtml(result && result.content, 'tool result image');
  const durationMs = entry.startTime ? (Date.now() - entry.startTime) : null;

  // Rebuild the panel in its final state
  const newHtml = buildLiveToolPanel(toolCallId, resolvedName, resolvedArgs, output, isError, true, durationMs, imagesHtml);
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newEl = tmp.firstElementChild;

  entry.el.replaceWith(newEl);
  entry.el = newEl;
  entry.toolName = resolvedName;
  entry.args = resolvedArgs;

  // Keep in map for dedup — will be cleaned up on turn_end
}

// =========================================================================
// SSE Streaming (RPC events only)
// =========================================================================

let messageStream = null;
let streamReconnectTimeout = null;

function startMessageStream(owner = sessionState.captureSelection()) {
  if (!sessionState.ownsSelection(owner)) return;
  const { id: sessionId, host: hostId } = owner;
  if (streamReconnectTimeout) { clearTimeout(streamReconnectTimeout); streamReconnectTimeout = null; }
  if (messageStream) { messageStream.close(); messageStream = null; }
  const host = resolveHost(hostId);
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/stream`;
  if (!host.token) { openMessageStream(host.base + path, owner); return; }
  // Token host: the ticket is minted per connect, never remembered — the
  // reconnect path lands back here and mints a fresh one.
  mintHostTicket(host, 'stream').then((ticket) => {
    if (messageStream || !sessionState.ownsSelection(owner)) return;
    openMessageStream(`${host.base}${path}?ticket=${encodeURIComponent(ticket)}`, owner);
  }).catch(() => {
    if (sessionState.ownsSelection(owner)) setStatus('Stream failed', 'error');
  });
}

function openMessageStream(url, owner) {
  if (!sessionState.ownsSelection(owner)) return;
  const { id: sessionId, host: hostId } = owner;
  try {
    const evtSource = new EventSource(url);
    messageStream = evtSource;
    const ownsStream = () => messageStream === evtSource && sessionState.ownsSelection(owner);
    const addOwnedListener = (event, listener) => evtSource.addEventListener(event, (e) => {
      if (ownsStream()) listener(e);
    });
    let turnCleanupDone = false;
    // OMP can deliver the same completed message event more than once. Keep
    // completion rendering idempotent for the whole turn, including a late
    // repeat after turn_end's JSONL catch-up has installed the indexed copy.
    // Two keys: the full key for custom messages (a redelivery with evolved
    // details must reach upsertLiveCustomMessage), and the core signature —
    // role/timestamp/content — for user/assistant, so a repeat that only
    // gained usage/details metadata still dedups. The core signature is also
    // what a late message_update for an already-finalized message carries
    // (timestamp is stamped at API-call start, content complete by the last
    // delta), which lets the update handler below refuse to resurrect a
    // streaming bubble for it.
    const seenMessageEnds = new Set();
    const messageEndKey = (m) => JSON.stringify(m.role === 'custom'
      ? [m.role, m.timestamp ?? null, m.content ?? null, m.errorMessage ?? null, m.customType ?? null, m.details ?? null]
      : [m.role, m.timestamp ?? null, m.content ?? null]);

    evtSource.onopen = () => { if (ownsStream()) setStatus(''); };

    // Server sends current state on connect so we can catch up
    addOwnedListener('init', (e) => {
      try {
        const data = JSON.parse(e.data);
        turnCleanupDone = !data.turnInProgress;
        // Stale dialogs for this session are pruned by the extension_ui_state
        // event that follows the connect replay — no per-init sweep needed.
        if (!data.turnInProgress) abortingSessions.delete(sessionKey(hostId, sessionId));
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
          fetchNewMessagesSince(owner);
        }
      } catch {}
    });

    addOwnedListener('stream_error', (e) => {
      try {
        const data = JSON.parse(e.data || '{}');
        setStatus(data.error || 'Stream error', 'error');
      } catch {
        setStatus('Stream error', 'error');
      }
      evtSource.close();
    });

    addOwnedListener('turn_start', () => {
      seenMessageEnds.clear();
      turnCleanupDone = false;
      setTurnInProgress(true);
    });

    const handleTurnEnd = () => {
      if (turnCleanupDone || !ownsStream()) return;
      turnCleanupDone = true;
      abortingSessions.delete(sessionKey(hostId, sessionId));
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
      fetchNewMessagesSince(owner);
      refreshSessions();
      refreshArtifacts(owner); // the agent may have published pages mid-turn
      setStatus('');
    };
    addOwnedListener('turn_end', handleTurnEnd);
    // An aborted/errored turn can end with agent_end and no paired turn_end;
    // both server backends treat it as turn-terminating, so we must too. The
    // guard avoids double catch-up when turn_end already ran.
    addOwnedListener('agent_end', handleTurnEnd);

    // message_update streams text, thinking, and partial tool calls live —
    // rendered incrementally through the throttled streaming renderer.
    addOwnedListener('message_update', (e) => {
      try {
        const { message } = JSON.parse(e.data);
        if (!message) return;
        if (message.role === 'custom') {
          upsertLiveCustomMessage(message, { streaming: true });
          return;
        }
        if (message.role !== 'assistant') return;
        // A redelivered/late update for a message whose message_end already
        // ran (OMP usage-enrichment repeats, delivery-timing corners) must not
        // resurrect a streaming bubble: the finalized render — or, post
        // turn_end, the indexed JSONL copy — is already on screen, and a
        // bubble created now would never be stripped again. It also must not
        // re-arm the turn state below.
        if (seenMessageEnds.size && seenMessageEnds.has(messageEndKey(message))) return;
        if (turnCleanupDone) seenMessageEnds.clear();
        turnCleanupDone = false;
        if (!turnInProgress) setTurnInProgress(true);
        queueStreamingRender(message);
      } catch (err) {}
    });

    addOwnedListener('message_end', (e) => {
      try {
        const { message } = JSON.parse(e.data);
        if (!message) return;
        const container = document.getElementById('messages');
        if (!container) return;
        const messageKey = messageEndKey(message);
        if (seenMessageEnds.has(messageKey)) return;
        seenMessageEnds.add(messageKey);
        if (message.role === 'user') {
          // pi echoes every user message it processes — including the prompt
          // this client just rendered optimistically in sendMessage. Skip that
          // one echo or the prompt shows twice until the turn_end catch-up.
          if (consumePendingSelfEcho(sessionId, message.content)) {
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
        if (message.role === 'custom') {
          upsertLiveCustomMessage(message);
          return;
        }
        if (message.role !== 'assistant') return;
        cancelStreamingRender();
        // OMP ends an interrupted thinking turn with an empty assistant shell
        // before its interrupted-thinking custom marker. Keep the API entry
        // but do not flash a ghost π header in the live transcript.
        if (Array.isArray(message.content) && message.content.length === 0 && !message.errorMessage) {
          container.querySelectorAll('.message.assistant[data-streaming="true"]').forEach(el => el.remove());
          return;
        }
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

    addOwnedListener('tool_execution_start', (e) => {
      try {
        const data = JSON.parse(e.data);
        appendLiveToolPanel(data);
      } catch (err) { console.error('tool_execution_start error:', err); }
    });

    addOwnedListener('tool_execution_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        updateLiveToolPanel(data);
      } catch (err) { console.error('tool_execution_update error:', err); }
    });

    addOwnedListener('tool_execution_end', (e) => {
      try {
        const data = JSON.parse(e.data);
        finalizeLiveToolPanel(data);
      } catch (err) { console.error('tool_execution_end error:', err); }
    });

    addOwnedListener('extension_ui_request', (e) => {
      try { handleExtensionUI(JSON.parse(e.data), sessionId, hostId); } catch (err) { console.error('extension_ui_request error:', err); }
    });

    addOwnedListener('queue_update', (e) => {
      try { renderQueueStatus(JSON.parse(e.data)); } catch {}
    });

    // Dialog answered elsewhere (TUI or another browser) — dismiss ours.
    addOwnedListener('extension_ui_resolved', (e) => {
      try { extensionUI.resolve(JSON.parse(e.data).id, { id: sessionId, host: hostId }); } catch {}
    });
    // Authoritative list of this session's pending dialogs, sent on (re)connect
    // after the replay burst. Prunes stashed dialogs that were answered or
    // dismissed while we were away (or orphaned by an idle session), without
    // touching other sessions' dialogs.
    addOwnedListener('extension_ui_state', (e) => {
      try {
        extensionUI.reconcile(JSON.parse(e.data), { id: sessionId, host: hostId });
      } catch {}
    });

    addOwnedListener('compaction_start', () => {
      setStatus('Compacting context...', 'working');
      setCompacting(true);
    });
    addOwnedListener('compaction_end', (e) => {
      setCompacting(false);
      // A manual compaction has no turn_end/agent_end boundary. Whether Stop
      // won the race, compaction failed, or it completed first, its end is the
      // authoritative point where a compaction-only abort gate can clear.
      if (!turnInProgress) abortingSessions.delete(sessionKey(hostId, sessionId));
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
    addOwnedListener('session_tree', () => {
      if (sessionState.currentSession && sessionState.currentSession.id === sessionId) {
        selectSession(sessionId, { forceTranscriptReload: true, host: hostId });
      }
    });
    addOwnedListener('session_switch', (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      const nextId = data?.sessionId;
      if (!nextId || nextId === sessionId) return;
      // The route identifies a different transcript even though the pane and
      // bridge socket stayed put. Never restore a prior DOM stash for that id:
      // the session may have changed since it was last viewed.
      transcriptCache.delete(sessionKey(hostId, nextId));
      void loadSessions(undefined, { withPrevious: true }).then(() => {
        if (!sessionState.ownsSelection(owner) || !sessionState.findSession(nextId, hostId)) return;
        selectSession(nextId, { forceTranscriptReload: true, host: hostId });
      });
    });

    addOwnedListener('auto_retry_start', (e) => {
      try {
        const d = JSON.parse(e.data);
        setStatus(`Retrying (attempt ${d.attempt}/${d.maxAttempts})...`, 'working');
      } catch {}
    });
    addOwnedListener('auto_retry_end', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.success === false) setStatus('Retry failed: ' + (d.finalError || 'unknown'), 'error');
      } catch {}
    });

    addOwnedListener('session_ended', () => {
      abortingSessions.delete(sessionKey(hostId, sessionId));
      setCompacting(false);
      setTurnInProgress(false);
      extensionUI.end({ id: sessionId, host: hostId });
      setStatus('Session ended');
      refreshSessions();
    });

    evtSource.onerror = () => {
      if (!ownsStream()) return;
      if (evtSource.readyState === EventSource.CLOSED) {
        setStatus('Stream disconnected', 'error');
        streamReconnectTimeout = setTimeout(() => {
          if (sessionState.ownsSelection(owner)) startMessageStream(owner);
        }, 3000);
      }
    };
  } catch (err) {
    if (!sessionState.ownsSelection(owner)) return;
    console.error('Stream failed:', err);
    setStatus('Stream failed', 'error');
  }
}

// =========================================================================
// Prompt / Turn / Abort
// =========================================================================

// Drafts and attachments share a host-qualified composer owner.
const composerDrafts = PiDishBrowser.createComposerDrafts({
  document, storage: localStorage, keyForSession: keyForSessionId, currentSessionId: () => sessionState.currentSession?.id || null,
  autosize: input => autosizePromptInput(input), status: (message, type) => setStatus(message, type),
});
function addImageFiles(files) { return composerDrafts.images.add(files); }
function prepareImageAttachment(file) { return composerDrafts.images.prepare(file); }
function fileToBase64(file) { return composerDrafts.images.read(file); }
function renderAttachmentStrip() { composerDrafts.images.render(); }
function removeAttachment(index) { composerDrafts.images.remove(index); }
function takePendingImages() { return composerDrafts.images.take(); }
function openImageLightbox(src) { composerDrafts.images.openLightbox(src); }

// Dictation retains the composer that requested permission and transcription.
const composerNotes = PiDishBrowser.createComposerNotes(document);
const composerSpeech = PiDishBrowser.createComposerSpeech({
  document, sessionState, composerKey: () => composerDrafts.key, hosts: effectiveHosts, config: () => appConfig,
  request: (host, path, options) => apiFetch(host, path, options), status: message => setStatus(message),
  showNote: text => showComposerNote(text), hideNote: () => hideComposerNote(),
});
function showComposerNote(text) { composerNotes.show(text); }
function hideComposerNote() { composerNotes.hide(); }
function sttHostFor() { return composerSpeech.host(); }
function micUnavailableReason() { return composerSpeech.reason(); }
function isRecording() { return composerSpeech.isRecording(); }
function updateMicButton() { composerSpeech.updateButton(); }
function initMicButton() { composerSpeech.mount(); }
function updateMicStatus() { composerSpeech.updateStatus(); }
function startRecording() { return composerSpeech.start(); }
function stopRecording() { composerSpeech.stop(); }
function cancelRecording() { composerSpeech.cancel(); }
function releaseMic() { composerSpeech.release(); }
function finishRecording(recorder) { composerSpeech.finish(recorder); }
function transcribeRecording(blob, mime) { return composerSpeech.transcribe(blob, mime); }
function insertTranscript(text) { composerSpeech.insert(text); }

function composerOwnerKey(owner) { return composerDrafts.ownerKey(owner); }
function draftKey(id) { return composerDrafts.draftKey(id); }
function historyKey(id) { return composerDrafts.historyKey(id); }
function writeSessionDraft(id, value) { composerDrafts.write(id, value); }
function stashPromptState() { composerDrafts.stash(); }
function clearPromptComposer() { composerDrafts.clear(); }
function setComposerWaiting(waiting) { composerDrafts.waiting(waiting); }
function saveDraftSoon() { composerDrafts.saveSoon(); }
function clearDraft(id) { composerDrafts.clearDraft(id); }
function restorePromptState(id) { composerDrafts.restore(id); }
function recordPrompt(message, id) { composerDrafts.record(message, id); }
function mergeComposerText(existing, restored) { return PiDishBrowser.mergeComposerText(existing, restored); }
function migratePromptState(from, to) { composerDrafts.migrate(from, to); }
function restorePromptToSession(id, message, images) { composerDrafts.restorePayload(id, message, images); }
function navigateHistory(direction, input) { return composerDrafts.navigate(direction, input); }

let clientPromptSequence = 0;
const pendingOptimisticPrompts = new Map();

function nextClientPromptId() {
  clientPromptSequence += 1;
  return `prompt-${Date.now().toString(36)}-${clientPromptSequence.toString(36)}`;
}

function discardOptimisticPrompt(clientPromptId) {
  const pending = pendingOptimisticPrompts.get(clientPromptId);
  if (!pending) return;
  pendingOptimisticPrompts.delete(clientPromptId);
  pending.element?.remove();
}

// The composer never sends the <session-refs> block — the server appends it —
// so every echoed prompt has to be compared with the block stripped back off.
// Comparison runs on the text blocks only: extractTextContent pads a phantom
// '\n' per image block, which never equals the composer's trimmed text and so
// let an image prompt's echo render as a second bubble.
function consumePendingSelfEcho(sessionId, content) {
  const text = splitSessionRefContext(extractTextBlocks(content)).text;
  for (const [clientPromptId, pending] of pendingOptimisticPrompts) {
    if (pending.sessionKey !== keyForSessionId(sessionId) || pending.message !== text) continue;
    pendingOptimisticPrompts.delete(clientPromptId);
    return true;
  }
  return false;
}

async function sendPrompt() {
  const input = document.getElementById('promptInput');
  const message = input.value.trim();
  if (currentSessionSpawnId) {
    if (message || composerDrafts.images.current().length) {
      const starting = pendingSessionSpawns.has(currentSessionSpawnId);
      setStatus(starting
        ? 'Pi is still starting — your prompt is saved'
        : 'Pi did not start — your prompt is preserved', starting ? 'working' : 'error');
    }
    return;
  }
  if ((!message && !composerDrafts.images.current().length) || !sessionState.currentSession) return;
  const owner = sessionState.captureSelection();
  const { id: sessionId, host: hostId } = owner;
  const ownerKey = sessionRefKey(owner);
  if (abortingSessions.has(ownerKey)) {
    setStatus('Wait for the current turn to finish stopping', 'working');
    return;
  }

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
    recordPrompt(message, ownerKey);
    clearDraft(ownerKey);
    setStatus('Running ' + message.split(' ')[0] + '...', 'working');
    // /btw's answer rides the command response, not the transcript: show the
    // question panel immediately so a long side turn has visible pending UI.
    const btwQuestion = message.match(/^\/btw\s+([\s\S]*)$/)?.[1]?.trim();
    if (btwQuestion) showBtwPanel(btwQuestion);
    try {
      const data = await apiSend(hostId, `/api/sessions/${encodeURIComponent(sessionId)}/command`, { message });
      if (!sessionState.ownsSelection(owner)) return;
      if (btwQuestion) {
        if (typeof data.answer === 'string' && data.answer) resolveBtwPanel(data.answer);
        else failBtwPanel('(no answer)');
      }
      setStatus(data.info || 'Done');
      refreshSessions();
    } catch (e) {
      restorePromptToSession(ownerKey, message, null);
      if (btwQuestion) failBtwPanel(e.message);
      if (sessionState.ownsSelection(owner)) {
        setStatus(`${message.split(' ')[0]}: ${e.message}`, 'error');
      }
    }
    return;
  }

  input.value = '';
  input.style.height = '';
  recordPrompt(message, ownerKey);
  clearDraft(ownerKey);
  const images = takePendingImages();
  const refs = sessionRefHints(message);
  setStatus('Sending...', 'working');

  const container = document.getElementById('messages');
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  const optimisticContent = [];
  if (message) optimisticContent.push({ type: 'text', text: message });
  for (const img of images || []) optimisticContent.push({ type: 'image', data: img.data, mimeType: img.mimeType });
  const clientPromptId = nextClientPromptId();
  const template = document.createElement('template');
  template.innerHTML = renderUserMessage({
    role: 'user', content: optimisticContent, timestamp: Date.now(), sessionRefs: refs,
  }, formatTime(Date.now()), ` data-client-prompt-id="${clientPromptId}"`);
  const optimisticElement = template.content.firstElementChild;
  container.appendChild(optimisticElement);
  // Arm the echo suppressor: pi re-emits this prompt as a user message_end
  // when the turn starts, and we've already rendered it. '' is a valid value
  // (images-only prompt). The stable id also lets queue Edit remove exactly
  // this optimistic bubble even when several prompts have identical text.
  pendingOptimisticPrompts.set(clientPromptId, {
    clientPromptId, sessionId, sessionKey: ownerKey, message, element: optimisticElement, status: 'sending',
  });
  followStream = true; // sending means: follow the stream from here on
  scrollToBottom(container);

  setTurnInProgress(true);

  try {
    const body = images ? { message, images } : { message };
    if (refs.length) body.refs = refs;
    const resp = await apiSend(hostId, `/api/sessions/${encodeURIComponent(sessionId)}/prompt`, body);
    const pending = pendingOptimisticPrompts.get(clientPromptId);
    if (pending) pending.status = resp?.result?.queued ? 'queued' : 'accepted';
    if (!sessionState.ownsSelection(owner)) return;
    if (resp?.result?.queued) {
      // Held by the bridge until compaction finishes; no turn is running yet.
      // Raise the compacting indicator before undoing the optimistic
      // "Working" badge so the turn-off path doesn't blank the strip/status.
      setCompacting(true);
      setTurnInProgress(false);
      setStatus('Queued — will send when compaction finishes', 'working');
      renderQueueStatus(lastQueueData);
    } else {
      setStatus('Waiting for response...', 'working');
    }
  } catch (e) {
    discardOptimisticPrompt(clientPromptId); // no echo is coming for a failed send
    restorePromptToSession(ownerKey, message, images);
    if (sessionState.ownsSelection(owner)) {
      setStatus(`Error: ${e.message}`, 'error');
      setTurnInProgress(false);
    }
  }
}

var turnInProgress = false;
const abortingSessions = new Set();

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
    // The phone's chip row leads with run state, so this cell always says
    // something — blank would make the row's anchor move.
    if (mobile) mobile.textContent = 'idle';
    return;
  }
  const elapsed = formatDuration(Date.now() - turnStartedAt);
  let tool = null;
  for (const name of runningTools.values()) tool = name; // most recently started
  if (tool && tool.length > 24) tool = tool.slice(0, 24) + '…';
  if (desktop) desktop.textContent = `Working ${elapsed}` + (tool ? ` · ${tool}` : '');
  if (mobile) mobile.textContent = elapsed + (tool ? ` · ${tool}` : '');
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
  // visibility, not display: the context readout beside it keeps its
  // position whether or not a turn is running.
  if (btnStop) btnStop.style.visibility = active ? 'visible' : 'hidden';
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
  if (sessionState.currentSession && !!sessionState.currentSession.turnInProgress !== !!active) {
    sessionState.patchSession(sessionState.currentSession.id, { turnInProgress: !!active });
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
  if (sessionState.currentSession && !!sessionState.currentSession.compacting !== on) {
    sessionState.patchSession(sessionState.currentSession.id, { compacting: on });
  }
}

// Steer and follow-up share everything but the endpoint and status strings.
async function sendQueuedMessage(kind) {
  const steer = kind === 'steer';
  const input = document.getElementById('promptInput');
  const message = input.value.trim();
  if (currentSessionSpawnId) {
    if (message || composerDrafts.images.current().length) {
      const starting = pendingSessionSpawns.has(currentSessionSpawnId);
      setStatus(starting
        ? 'Pi is still starting — your prompt is saved'
        : 'Pi did not start — your prompt is preserved', starting ? 'working' : 'error');
    }
    return;
  }
  if ((!message && !composerDrafts.images.current().length) || !sessionState.currentSession || !sessionState.currentSession.isActive) return;
  const owner = sessionState.captureSelection();
  const { id: sessionId, host: hostId } = owner;
  const ownerKey = sessionRefKey(owner);
  if (abortingSessions.has(ownerKey)) {
    setStatus('Wait for the current turn to finish stopping', 'working');
    return;
  }

  input.value = '';
  input.style.height = '';
  recordPrompt(message, ownerKey);
  clearDraft(ownerKey);
  const images = takePendingImages();
  setStatus(steer ? 'Steering...' : 'Queueing follow-up...', 'working');

  const body = steer ? { message } : { message, deliverAs: 'followUp' };
  if (images) body.images = images;
  const refs = sessionRefHints(message);
  if (refs.length) body.refs = refs;
  try {
    const resp = await apiSend(hostId, `/api/sessions/${encodeURIComponent(sessionId)}${steer ? '/steer' : '/prompt'}`, body);
    if (!sessionState.ownsSelection(owner)) return;
    if (resp?.result?.queued) setStatus('Queued — will send when compaction finishes');
    else setStatus(steer ? 'Steered' : 'Queued for after this turn');
  } catch (e) {
    restorePromptToSession(ownerKey, message, images);
    if (sessionState.ownsSelection(owner)) {
      setStatus(`${steer ? 'Steer' : 'Follow-up'} failed: ${e.message}`, 'error');
    }
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
  const associated = new Set();
  // pi's queue holds what the server sent, block and all; the strip and the
  // composer only ever deal in the text as it was typed.
  const row = (kind, label, raw, index) => {
    const text = splitSessionRefContext(raw).text;
    let clientPromptId = null;
    for (const [id, pending] of pendingOptimisticPrompts) {
      if (associated.has(id) || pending.sessionKey !== sessionRefKey(sessionState.currentSession) ||
          pending.status !== 'queued' || pending.message !== text) continue;
      clientPromptId = id;
      associated.add(id);
      break;
    }
    rows.push(queueRowHtml(kind, label, text, index, clientPromptId));
  };
  steering.forEach((text, i) => row('steering', 'steer', text, i));
  followUp.forEach((text, i) => row('followUp', 'follow-up', text, i));
  panel.innerHTML = rows.join('');
  panel.style.display = '';
}

function queueRowHtml(kind, label, text, index, clientPromptId = null) {
  const clientAttr = clientPromptId ? ` data-client-prompt-id="${escapeHtml(clientPromptId)}"` : '';
  const edit = sessionSupports(sessionState.currentSession, 'queueCancel')
    ? '<button class="queue-item-edit" onclick="editQueuedMessage(this)" title="Remove from queue and edit">↩ Edit</button>' : '';
  return `<div class="queue-item" data-kind="${kind}" data-index="${index}"${clientAttr}>
    <span class="queue-item-kind">${label}</span>
    <span class="queue-item-text" onclick="this.classList.toggle('expanded')" title="Click to expand">${escapeHtml(text)}</span>
    ${edit}
  </div>`;
}

// Cancel a queued message on the bridge and return its text to the composer.
async function editQueuedMessage(btn) {
  if (!sessionState.currentSession) return;
  const owner = sessionState.captureSelection();
  const { id: sessionId, host: hostId } = owner;
  const ownerKey = sessionRefKey(owner);
  const row = btn.closest('.queue-item');
  if (!row) return;
  const kind = row.dataset.kind;
  const index = Number(row.dataset.index);
  // Cancelling keys on pi's own queue entry, so it needs the text pi holds —
  // the rendered row shows the stripped form. lastQueueData is the same
  // snapshot the row was rendered from.
  const raw = (lastQueueData?.[kind] || [])[index];
  const text = typeof raw === 'string' && raw
    ? raw
    : (row.querySelector('.queue-item-text')?.textContent || '');
  const clientPromptId = row.dataset.clientPromptId || null;
  if (!text) return;
  const clientPrompt = clientPromptId ? pendingOptimisticPrompts.get(clientPromptId) : null;
  const previousPromptStatus = clientPrompt?.status;
  // queue_update can arrive before the cancel HTTP response. Exclude the row
  // being edited from duplicate-text reassociation while cancellation is in
  // flight, so a remaining identical prompt keeps its own client id.
  if (clientPrompt) clientPrompt.status = 'cancelling';
  try {
    await apiSend(hostId, `/api/sessions/${encodeURIComponent(sessionId)}/queue/cancel`, { kind, index, text });
    if (clientPromptId) discardOptimisticPrompt(clientPromptId);
    restorePromptToSession(ownerKey, splitSessionRefContext(text).text, null);
    // The follow-up queue_update reconciles the strip; no manual removal needed.
  } catch (e) {
    if (clientPrompt && pendingOptimisticPrompts.has(clientPromptId)) {
      clientPrompt.status = previousPromptStatus;
      renderQueueStatus(lastQueueData);
    }
    if (sessionState.ownsSelection(owner)) setStatus(e.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// /btw panel — ephemeral side question (OMP). The answer never lands in the
// transcript; it lives in this dismissible card above the composer, mirroring
// the TUI's btw panel. A new question replaces the panel; a session switch
// drops it (see the two selection reset points).
// ---------------------------------------------------------------------------
let btwAnswerText = null;

function showBtwPanel(question) {
  const panel = document.getElementById('btwPanel');
  if (!panel) return;
  btwAnswerText = null;
  panel.className = 'btw-panel pending';
  panel.innerHTML = `<div class="btw-panel-header">
    <span class="btw-panel-tag">btw</span>
    <span class="btw-panel-question" onclick="this.classList.toggle('expanded')" title="Click to expand">${escapeHtml(question)}</span>
    <button class="btw-panel-btn btw-copy" style="display:none" onclick="copyBtwAnswer(this)" title="Copy answer">Copy</button>
    <button class="btw-panel-btn" onclick="closeBtwPanel()" title="Dismiss">✕</button>
  </div>
  <div class="btw-panel-answer">Asking…</div>`;
  panel.style.display = '';
}

function resolveBtwPanel(answer) {
  const panel = document.getElementById('btwPanel');
  if (!panel || panel.style.display === 'none') return;
  btwAnswerText = answer;
  panel.className = 'btw-panel';
  panel.querySelector('.btw-panel-answer').innerHTML = `<div class="markdown-body">${formatMarkdown(answer)}</div>`;
  panel.querySelector('.btw-copy').style.display = '';
}

function failBtwPanel(error) {
  const panel = document.getElementById('btwPanel');
  if (!panel || panel.style.display === 'none') return;
  panel.className = 'btw-panel error';
  panel.querySelector('.btw-panel-answer').textContent = error;
}

function closeBtwPanel() {
  const panel = document.getElementById('btwPanel');
  if (!panel) return;
  btwAnswerText = null;
  panel.style.display = 'none';
  panel.innerHTML = '';
}

function copyBtwAnswer(btn) {
  if (!btwAnswerText) return;
  copyTextToClipboard(btwAnswerText).then(() => {
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  }).catch(() => { btn.textContent = 'Failed'; });
}

async function abortTurn() {
  // Compaction counts: the bridge cancels a running compaction on abort, and
  // its compaction_end (aborted) event clears the compacting indicator.
  if (!sessionState.currentSession || (!turnInProgress && !compactingNow)) return;
  const owner = sessionState.captureSelection();
  const { id: sessionId, host: hostId } = owner;
  const ownerKey = sessionRefKey(owner);
  if (abortingSessions.has(ownerKey)) return;
  abortingSessions.add(ownerKey);
  setStatus('Stopping...', 'working');
  try {
    await apiSend(hostId, '/api/sessions/' + encodeURIComponent(sessionId) + '/abort');
    // HTTP acknowledgement only means the abort request was accepted. Keep
    // the turn owned by the stream until turn_end/agent_end performs cleanup
    // and JSONL catch-up.
  } catch (e) {
    abortingSessions.delete(ownerKey);
    if (sessionState.ownsSelection(owner)) setStatus('Stop failed: ' + e.message, 'error');
  }
}

const pendingSessionSpawns = PiDishBrowser.createSessionSpawns({
  request: apiFetch, delay: () => new Promise(resolve => setTimeout(resolve, 250)), harnessLabel,
  current: () => currentSessionSpawnId, changed: renderSessions,
  showPending: key => { switchTab('active'); showPendingSessionView(key); if (window.innerWidth <= 768) closeSidebar(); },
  loadSessions, hasSession: (id, host) => !!sessionState.findSession(id, host),
  selectSession: (id, host) => { void selectSession(id, { host }); },
  stashPrompt: stashPromptState,
  saveDraft: (key, draft) => { try { localStorage.setItem(draftKey(pendingComposerKey(key)), draft); } catch {} },
  migratePrompt: (key, host, id) => migratePromptState(pendingComposerKey(key), sessionKey(host || hostDirectory.self.hostId, id)),
  discardPrompt: key => { const owner = pendingComposerKey(key); clearDraft(owner); composerDrafts.images.discard(owner); },
  showFailure: showPendingSessionFailure, status: setStatus,
});
// The typed takeover owns form state, controls, caches and launch view tokens.
const newSessionController = PiDishBrowser.createNewSession({
  root: document.querySelector('.main'), storage: localStorage, request: apiFetch,
  self: selfHostEntry, host: hostEntryFor, hosts: effectiveHosts, hostDown: hostIsDown, multiHost: isMultiHost,
  sessionState, currentSpawn: () => currentSessionSpawnId, spawns: pendingSessionSpawns, models: modelCatalog,
  closeOtherViews: () => { closeSidebar(); closeUsageView(); closeSearchView(); closeSkillsView(); closeRoutinesView(); closeRecoveryView(); closeBounceView(); },
  closeSettings: () => closeHarnessSettings(),
  harnessCacheChanged: () => { if (sessionState.currentSession) updateSessionHeader(); }, status: setStatus,
});
const HARNESS_KEY = PiDishBrowser.NEW_SESSION_HARNESS_KEY;
const NS_THINKING_LABELS = PiDishBrowser.NS_THINKING_LABELS;
const harnessDiscovery = newSessionController.harnesses;
const newSessionConfigPreview = newSessionController.config;
const spawnTargetsController = newSessionController.targets;
const spawnTargetPicker = newSessionController.targetPicker;
const directoryCatalog = newSessionController.directories;
function captureSpawnView() { return newSessionController.captureView(); }
function submitNewSession(value) { return newSessionController.submit(value); }
function createSession(cwd, host) { return newSessionController.create(cwd, host); }
function spawnNewSession() { return newSessionController.spawn(); }
function nsHost() { return newSessionController.host(); }
function nsHostId() { return newSessionController.hostId(); }
function nsHostSupports(capability) { return newSessionController.supports(capability); }
function nsHostOptions() { return newSessionController.hostOptions(); }
function nsCwdValue() { return newSessionController.cwd(); }
function setNsCwd(value) { newSessionController.setCwd(value); }
function selectedHarnessId() { return newSessionController.selectedHarness(); }
function harnessLabel(id) { return newSessionController.harnessLabel(id); }
function renderNsHosts() { newSessionController.renderHosts(); }
function renderNsHarnesses() { newSessionController.renderHarnesses(); }
function renderNsWorkspaces() { newSessionController.renderWorkspaces(); }
function onNsHostChange(value) { newSessionController.changeHost(value); }
function onNsHarnessChange(value) { newSessionController.changeHarness(value); }
function onNsModelChange(value) { newSessionController.preferences.selectModel(value); }
function onNsThinkingChange(value) { newSessionController.preferences.selectThinking(value); }
function syncNsThinking() { newSessionController.preferences.syncThinking(); }
function renderNsModel() { newSessionController.preferences.render(); }
function isNewSessionViewOpen() { return newSessionController.isOpen(); }
function openNewSessionView(value) { newSessionController.open(value); }
function closeNewSessionView() { newSessionController.close(); }
function refreshNsPilotOptions() { newSessionController.refresh(); }
function scheduleNsPilotRefresh() { newSessionController.scheduleRefresh(); }
function initNsTree() { newSessionController.initTree(); }
function hideCwdDropdown() { newSessionController.hideCwd(); }
function nsError(value) { newSessionController.error(value); }
function loadKnownCwds() { return directoryCatalog.load(); }
function loadSpawnTargets() { return spawnTargetsController.load(); }
function hideSpawnTargetDropdown() { spawnTargetPicker.hide(); }
function selectedSpawnTarget() { return newSessionController.selectedTarget(); }
function savedResumeTarget(host) { return spawnTargetsController.resume(hostEntryFor(host)); }
function loadHarnesses() { return harnessDiscovery.load(); }
function loadNsHarnessConfig(cwd = nsCwdValue()) { return newSessionConfigPreview.load(cwd); }
function harnessRow(hostId, harnessId) { return harnessDiscovery.row(hostId, harnessId); }
function ensureHarnessRows(hostId) { void harnessDiscovery.ensure(hostId); }
function harnessSupportsSettings(session) {
  return !!session?.harnessId && !!harnessRow(sessionHostIdOf(session), session.harnessId)?.pilotConfig;
}
function modelSelectOptionsHtml(models) { return PiDishBrowser.modelSelectOptionsHtml(models, escapeHtml); }
function modelHiddenNote(hidden) { return PiDishBrowser.modelHiddenNote(hidden); }

// One typed editor serves session settings and the new-session takeover.
const harnessSettingsController = PiDishBrowser.createHarnessSettings({
  root: document.getElementById('harnessSettingsModal'), host: hostEntryFor, request: apiFetch,
  fallbackModels: (host, harness) => modelCatalog.scope?.harnessId === harness
    && PiDishBrowser.sameDirectoryHost(modelCatalog.scope?.host || null, host) ? modelCatalog.rows() : [],
  escapeHtml, shortCwd, roleDefinitions: OMP_MODEL_ROLES, parseModelRoleRef, composeModelRoleRef, modelRoleLevels,
  onSaved: scope => {
    if (isNewSessionViewOpen() && selectedHarnessId() === scope.harnessId
        && nsHostId() === scope.hostId && nsCwdValue() === scope.cwd) void loadNsHarnessConfig();
  },
});
function isHarnessSettingsOpen() { return harnessSettingsController.isOpen(); }
function showHarnessSettingsTab(tab) { harnessSettingsController.showTab(tab); }
function closeHarnessSettings() { harnessSettingsController.close(); }
function saveHarnessSettings() { return harnessSettingsController.save(); }
async function harnessSettingsFetch(hostId, url) {
  const res = await apiFetch(hostId, url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
function openSessionHarnessSettings() {
  const session = sessionState.currentSession;
  if (!session || !harnessSupportsSettings(session)) return;
  return openHarnessSettings({ harnessId: session.harnessId, hostId: sessionHostIdOf(session), cwd: session.cwd || '',
    label: session.harnessLabel || harnessBadgeInfo(session.harnessId).label });
}
function openHarnessSettings(opts = {}) {
  const harnessId = opts.harnessId || 'omp';
  return harnessSettingsController.open({ harnessId,
    hostId: opts.hostId !== undefined ? opts.hostId : nsHostId(),
    cwd: (opts.cwd !== undefined ? opts.cwd : (newSessionConfigPreview.config?.cwd ?? nsCwdValue())) || '',
    label: opts.label || harnessLabel(harnessId), tab: opts.tab,
  });
}

function createCwdAutocomplete({
  input, dropdown, hostId = nsHostId, known = () => [],
  onPick = () => {}, onSubmit = null, onBlur = null,
}) {
  return PiDishBrowser.createCwdAutocomplete({ input, dropdown,
    host: () => hostEntryFor(hostId()), request: apiFetch, known,
    match: fuzzyMatch, score: fuzzyScore, highlight: highlightFuzzy, escapeHtml,
    onPick, onSubmit, onBlur,
  });
}

// =========================================================================
// Utilities
// =========================================================================

/**
 * POST/PUT a JSON body to a host and parse the JSON reply. Throws
 * Error(data.error) on a non-2xx status so callers get the server's message
 * without each hand-rolling the res.ok / res.json().catch(() => ({})) dance
 * (they used to, with a slightly different fallback at every site).
 */
async function apiSend(host, path, body, method = 'POST') {
  return PiDishBrowser.sendJson((...args) => apiFetch(...args), host, path, body, method);
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
      // Match the static renderer: prime's ipython tool shows its `code`
      // argument directly instead of the JSON wrapper.
      const bodyText = block.name === 'ipython' && typeof args.code === 'string' ? args.code : argsJson;
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
        blockEl.querySelector('.tool-call-content code').textContent = bodyText;
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

const extensionUI = PiDishBrowser.createExtensionUI({
  document, sessionState, storage: localStorage, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  status: (message, type) => setStatus(message, type),
});
function clearExtensionUI() { extensionUI.clear(); }
function handleExtensionUI(request, id, host = sessionState.sessionHostId(id)) { extensionUI.handle(request, { id, host }); }

// Rich text keeps the local vendor loaders, final render passes and diagram
// lifetimes separate from the transcript's streaming and retained DOM state.
const browserAssets = PiDishBrowser.createBrowserAssets(document);
const diagramRenderer = PiDishBrowser.createDiagrams({
  document, assets: browserAssets, runtime: () => typeof mermaid === 'undefined' ? null : mermaid,
  retainedRoots: () => [...transcriptCache.values()].map(entry => entry.fragment), isPinned: feed => isPinnedToBottom(feed), scrollBottom: feed => scrollToBottom(feed),
});
const richText = PiDishBrowser.createRichText({
  document, marked: typeof marked === 'undefined' ? null : marked, highlight: () => typeof hljs === 'undefined' ? null : hljs,
  assets: browserAssets, diagrams: diagramRenderer, sessionState, copy: text => copyTextToClipboard(text), status: (message, type) => setStatus(message, type),
});
function formatMarkdown(text) { return richText.format(text); }
function applyHighlight(root) { richText.highlight(root); }
function loadMathAssets() { return richText.loadMath(); }
function loadVendorAsset(tag, attributes) { return browserAssets.load(tag, attributes); }
function refreshDiagramTheme() { diagramRenderer.refreshTheme(); }
function copyTextToClipboard(text) { return PiDishBrowser.copyTextToClipboard(text, document, navigator); }

// =========================================================================
// Tree Modal
// =========================================================================
const transcriptTree = PiDishBrowser.createTranscriptTree({
  document, storage: localStorage, sessionState, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  status: (message, type) => setStatus(message, type), selectSession: (id, options) => selectSession(id, options),
  saveEditorDraft: (owner, text) => {
    try { const key = draftKey(sessionRefKey(owner)); if (!(localStorage.getItem(key) || '').trim()) localStorage.setItem(key, text); } catch {}
  },
});
function openTreeModal() { return transcriptTree.open(); }
function closeTreeModal() { transcriptTree.close(); }
function selectTreeNode(id) { transcriptTree.select(id); }
function confirmBranch() { return transcriptTree.confirm(); }

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  // A live microphone capture outranks every overlay: Escape gets the hardware
  // released (and the take discarded) before it dismisses any chrome.
  if (isRecording()) { e.preventDefault(); cancelRecording(); updateMicButton(); return; }
  // A lightbox (image or diagram zoom) floats above every modal — it goes
  // first, and it alone, so Escape never dismisses it *and* what's underneath.
  const lightbox = document.querySelector('.lightbox-overlay');
  if (lightbox) {
    e.preventDefault(); lightbox.remove();
  } else if (isSessionMenuOpen()) {
    e.preventDefault(); closeSessionMenu();
  } else if (isCommentListPopoverOpen()) {
    e.preventDefault(); closeCommentListPopover();
  } else if (document.getElementById('commentBubble').style.display !== 'none') {
    e.preventDefault(); closeCommentBubble();
  } else if (document.getElementById('responseDetailsModal').style.display !== 'none') {
    e.preventDefault(); closeResponseDetails();
  } else if (isHarnessSettingsOpen()) {
    // Modal only — the new-session takeover underneath stays open.
    e.preventDefault(); closeHarnessSettings();
  } else if (document.getElementById('settingsModal').style.display !== 'none') {
    e.preventDefault(); closeSettingsModal();
  } else if (document.getElementById('relationsModal').style.display !== 'none') {
    e.preventDefault(); closeRelationsModal();
  } else if (document.getElementById('treeModal').style.display !== 'none') {
    e.preventDefault(); closeTreeModal();
  } else if (document.getElementById('statsModal').style.display !== 'none') {
    e.preventDefault(); closeStatsModal();
  } else if (document.getElementById('artifactsModal').style.display !== 'none') {
    e.preventDefault(); closeArtifactsModal();
  } else if (isRecoveryViewOpen()) {
    e.preventDefault(); closeRecoveryView();
  } else if (isRoutinesViewOpen()) {
    e.preventDefault(); routinesViewEscape();
  } else if (isSkillsViewOpen()) {
    e.preventDefault(); skillsViewEscape();
  } else if (isNewSessionViewOpen()) {
    e.preventDefault(); closeNewSessionView();
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

// =========================================================================
// Terminal (feature-flagged: /api/config .terminal → PI_DISH_TERMINAL=1).
// One panel, one PTY per session server-side. The PTY survives socket drops
// (phone screen lock), so reopening reattaches and replays scrollback.
// =========================================================================

let appConfig = { terminal: false };
async function loadConfig() {
  try {
    const res = await apiFetch(null, '/api/config');
    appConfig = await res.json();
  } catch { /* feature stays hidden */ }
  updateTerminalButtons();
  updateRoutinesButton();
  updateMicButton();
}

/**
 * The terminal is a *per-host* feature: a session on a peer with
 * PI_DISH_TERMINAL on is reachable from an entry host that has it off, and
 * vice versa (the WS URL and ticket already follow the session's host). Gate
 * on the owning host's advertised capabilities, falling back to this host's
 * /api/config only for self — see hostSupportsTerminal in helpers.js.
 */
function sessionHostSupportsTerminal(session) {
  return hostSupportsTerminal(hostEntryFor(session?.host), appConfig);
}

/** Same rule for the pi-tmux view button: tmux is the owning host's, too. */
function sessionHostSupportsTmux(session) {
  return hostSupportsCapability(hostEntryFor(session?.host), 'tmux', appConfig);
}

function updateTerminalButtons() { terminalController.updateButtons(); }

// =========================================================================
// Theme payloads and pre-paint cache restoration share typed token decoding.
const themesController = PiDishBrowser.createThemes({ document, storage: localStorage, request: (host, url, options) => apiFetch(host, url, options), host: () => hostEntryFor(null),
  changed: () => { terminalController.refreshTheme(); refreshDiagramTheme(); },
});
function loadThemes() { return themesController.load(); }
function renderThemeSelect(select) { themesController.render(select); }
function applyTheme(id) { themesController.apply(id); }
function terminalTheme() { return PiDishBrowser.terminalTheme(document); }

// Terminal lifecycle owns pending opens, host endpoints, sockets and reconnects.
const terminalController = PiDishBrowser.createTerminalController({
  document, storage: localStorage, sessionState, host: host => hostEntryFor(host),
  supportsTerminal: session => sessionHostSupportsTerminal(session), supportsTmux: session => sessionHostSupportsTmux(session),
  asset: (tag, attributes) => loadVendorAsset(tag, attributes),
  createTerminal: options => typeof Terminal === 'undefined' ? null : new Terminal(options),
  createFitAddon: () => { const Ctor = window.FitAddon && (window.FitAddon.FitAddon || window.FitAddon); return Ctor ? new Ctor() : null; },
  socket: url => new WebSocket(url), socketUrl: (host, path) => hostWsUrl(host, path), ticket: (host, purpose) => mintHostTicket(host, purpose),
  theme: () => terminalTheme(), applySize: panel => applySavedTerminalSize(panel), confirm: message => confirm(message),
});
function terminalModeKey(id) { return terminalController.modeKey(id); }
function loadTerminalAssets() { return terminalController.loadAssets(); }
function toggleTerminal() { terminalController.toggle(); }
function openTerminal(mode) { return terminalController.open(mode); }
function closeTerminal() { terminalController.close(); }
function fitTerminal() { terminalController.fit(); }
function termSend(message) { terminalController.send(message); }
function connectTerminalWS() { terminalController.connect(); }
function updateTerminalModeUI() { terminalController.updateMode(); }
function switchTerminalMode() { terminalController.switchMode(); }
function restartTerminalShell() { terminalController.restart(); }
function termKeybarPress(key) { terminalController.key(key); }

// Resize controllers own each pointer capture and release listeners on disposal.
const panelResize = PiDishBrowser.createPanelResize({ document, storage: localStorage, fitTerminal: () => fitTerminal() });
function clampSidebarWidth(px) { return PiDishBrowser.clampSidebarWidth(px, window.innerWidth); }
function applySavedSidebarWidth() { panelResize.sidebarWidth(); }
function initSidebarResize() { panelResize.sidebar(); }
function initTerminalResize() { panelResize.terminal(); }
function clampTerminalHeight(px, parentHeight) { return PiDishBrowser.clampTerminalHeight(px, parentHeight); }
function applySavedTerminalSize(panel) { panelResize.terminalSize(panel); }

function initTerminalKeybar() { terminalController.mountKeybar(); }

// =========================================================================
// Routines own their host-qualified form, catalogs, mutations and run ledger.
const routinesController = PiDishBrowser.createRoutinesView({
  root: document.querySelector('.main'), request: (host, url, options) => apiFetch(host, url, options), storage: localStorage, sessionState,
  hosts: fanoutHosts, effectiveHosts, host: hostEntryFor, fleetReady: () => hostFleetReady, config: () => appConfig, multiHost: isMultiHost,
  hostChip: host => hostChipHtml(host),
  closeOtherViews: () => { closeSidebar(); closeUsageView(); closeSearchView(); closeNewSessionView(); closeSkillsView(); closeRecoveryView(); closeBounceView(); },
  connection: (host, event, error) => { if (event === 'success') noteHostReachable(host); else if (event === 'blocked') noteHostBlocked(host); else noteHostFailure(host, error); },
  autocomplete: options => createCwdAutocomplete(options), copy: text => copyTextToClipboard(text), status: text => setStatus(text), confirm: text => confirm(text),
  loadPrevious: () => loadSessions(undefined, { withPrevious: true }), selectSession: (id, options) => selectSession(id, options),
});
function updateRoutinesButton() { routinesController.updateButton(); }
function isRoutinesViewOpen() { return routinesController.isOpen(); }
function openRoutinesView() { routinesController.open(); }
function closeRoutinesView() { routinesController.close(); }
function refreshRoutinesView() { routinesController.refresh(); }
function routinesViewEscape() { return routinesController.escape(); }
function backToRoutinesList() { routinesController.back(); }
function selectRoutine(host, id) { return routinesController.select(host, id); }
function startRoutineCreate() { routinesController.create(); }
function saveRoutine() { return routinesController.save(); }
function runRoutineNow() { return routinesController.run(); }
function deleteRoutine() { return routinesController.delete(); }

// Bounce owns host snapshots, selected targets, status polling and view disposal.
const bounceController = PiDishBrowser.createBounce({
  document, request: apiFetch, hosts: effectiveHosts, fleetReady: () => hostFleetReady,
  sessionState, refreshSessions, loadPrevious: () => loadSessions(undefined, { withPrevious: true }), selectSession,
});
function isBounceViewOpen() { return bounceController.isOpen(); }
function closeBounceView() { bounceController.close(); }
function refreshBounceView() { return bounceController.refresh(); }
function selectBounceTargets(selected) { bounceController.select(selected); }
function submitBounceTargets() { return bounceController.submit(); }
