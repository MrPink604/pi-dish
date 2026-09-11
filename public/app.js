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
    sidebarActivity.migrate(hostDirectory.self.hostId);
    sidebarControls.migrate(hostDirectory.self.hostId);
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
const responseDetailsController = PiDishBrowser.createResponseDetails({ document, sessionState, mode: () => displayPreferences.responseMode });



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
  sidebarLists.mount();

  sidebarControls.mount();

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

// Query, list fan-out and seen activity have separate typed owners.
const sidebarActivity = PiDishBrowser.createSidebarActivity({ document, storage: localStorage, sessionState });
const sidebarQuery = PiDishBrowser.createSidebarQuery({
  document, storage: localStorage, request: (host, path, options) => apiFetch(host, path, options), host: () => hostEntryFor(null),
  render: () => renderSessions(), reload: query => loadSessions(query), queriedFor: () => sidebarLists.queriedFor,
  invalidateLists: () => sidebarLists.invalidate(), busy: value => setSearchBusy(value),
  searchChanged: () => { if (isSearchViewOpen()) runSearchView(); }, openSearch: query => openSearchView(query),
  prompt: (label, initial) => window.prompt(label, initial), alert: message => alert(message),
});
sidebarQuery.mount();
const sidebarLists = PiDishBrowser.createSidebarLists({
  document, request: (host, path, options) => apiFetch(host, path, options), sessionState, activity: sidebarActivity,
  hosts: effectiveHosts, pollable: pollableHosts, selfId: () => hostDirectory.self.hostId,
  query: () => sidebarQuery.query, all: () => sidebarQuery.tab === 'all', refreshFleet: refreshHostFleetSoon,
  connection: (host, event) => hostConnections.note(host, event),
});
const hostSessionLoader = sidebarLists.loader;
function toggleSidebarView() { sidebarQuery.toggleView(); }
function updateViewToggle() { sidebarQuery.updateView(); }
function loadSavedFilters() { return sidebarQuery.loadFilters(); }
function persistSavedFilters(next, host) { return sidebarQuery.persistFilters(next, host || undefined); }
function scopeQuery() { return sidebarQuery.scope(); }
function toggleScope(name) { sidebarQuery.toggleScope(name); }
function saveCurrentFilterAsScope() { return sidebarQuery.saveCurrent(); }
function renderScopeChips() { sidebarQuery.renderChips(); }
function markSessionSeen(session, lastActivity) { sidebarActivity.mark(session, lastActivity); }
function isUnread(session) { return sidebarActivity.unread(session); }
function updateUnreadTitle() { sidebarActivity.title(); }
function toggleSidebar() { sidebarQuery.toggle(); }
function closeSidebar() { sidebarQuery.close(); }
function switchTab(tab) { sidebarQuery.switchTab(tab); }
function onFilterInput() { sidebarQuery.onInput(); }
function setSearchBusy(value) { sidebarLists.busy(value); }
function loadSessions(query, options) { return sidebarLists.load(query, options); }
function queryHosts(hosts, query) { return PiDishBrowser.queryHosts(hosts, query); }
function loadHostSessions(host, query, withPrevious, sequence) { return hostSessionLoader.load(host, query, withPrevious, sequence); }
function publishSessionLists() { sidebarLists.publish(); }
function refreshSessions() { return sidebarLists.refresh(); }

// Sidebar row controls own preferences, family pins, confirmation, drag and menus.
const sidebarControls = PiDishBrowser.createSidebarControls({
  document, storage: localStorage, sessionState, request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor, render: () => renderSessions(), closeSidebar: () => closeSidebar(),
  select: (id, host) => selectSession(id, { host }), pending: id => showPendingSessionView(id), create: (cwd, host) => createSession(cwd, host),
  finishClose: (id, host, owner) => finishSessionClose(id, host, owner), refresh: () => loadSessions(undefined, { withPrevious: true }),
  ref: session => sessionRefFor(session), copy: text => copyTextToClipboard(text), status: (message, type) => setStatus(message, type),
});
function harnessBadgeInnerHtml(info) { return PiDishBrowser.harnessBadgeInnerHtml(info); }
function renderHarnessBadge(id, label) { return PiDishBrowser.renderHarnessBadge(id, label); }
function keyForSessionId(id) { return sessionKey(sessionState.sessionHostId(id), id); }
function toggleGroupCollapsed(key) { sidebarControls.toggleGroup(key); }
function toggleSessionFamilyExpanded(id, host) { sidebarControls.toggleFamily(id, host); }
function currentFamilyRootMap() { return sidebarControls.familyRoots(); }
function revealSessionInFamily(id, host) { sidebarControls.reveal(id, host); }
function toggleSessionPinned(id, root, members, host) { sidebarControls.togglePin(id, root, members, host); }
function handleRowCloseClick(id, host) { sidebarControls.closeClick(id, host); }
function performRowClose(id, host) { return sidebarControls.performClose(id, host); }
function sessionRefFor(session) { return session?.id ? sessionRef(session, hostEntryFor(session.host || null), refPrefixFor(session)) : ''; }
function isSessionMenuOpen() { return sidebarControls.menuOpen; }
function closeSessionMenu() { sidebarControls.closeMenu(); }
function openSessionMenu(session, x, y) { sidebarControls.openMenu(session, x, y); }

// Render one metadata snapshot through the typed sidebar projection.
let lastSessionListHtml = '';
function renderSessions() {
  if (sidebarControls.dragging) return;
  const sidebarFamilyRootMap = currentFamilyRootMap();
  const { html, count } = PiDishBrowser.renderSidebar({
    ...sessionState.sessions, selected: sessionState.currentSession,
    tab: sidebarQuery.tab, view: sidebarQuery.view, query: sidebarQuery.query, queriedFor: sidebarLists.queriedFor, scope: scopeQuery(), indexing: sidebarLists.indexing,
    contextMetric: displayPreferences.contextMetric, pending: [...pendingSessionSpawns.entries()], selectedSpawn: currentSessionSpawnId,
    expanded: sidebarControls.expanded, collapsed: sidebarControls.collapsed, pinned: sidebarControls.pinned, roots: sidebarFamilyRootMap,
    closeConfirm: sidebarControls.closeConfirm, closeBusy: sidebarControls.closeBusy, multiHost: isMultiHost(),
    unread: isUnread, hostChip: hostChipHtml,
    hosts: effectiveHosts().map(host => {
      const cache = hostSessionLoader.getCache(host);
      return { ...host, state: hostState(host), key: hostKeyOf(host), color: hostColorFor(host.hostId || null),
        dot: hostDotHtml(host.hostId || null, 'host-section-dot'), hasCache: !!cache && !!(cache.active.length || cache.previous.length) };
    }),
  });
  const countEl = document.getElementById('countActive');
  if (countEl) countEl.textContent = count || '';
  if (html !== lastSessionListHtml) {
    closeSessionMenu();
    document.getElementById('sessionList').innerHTML = html;
    lastSessionListHtml = html;
  }
  updateUnreadTitle();
}
function workspaceGroupKey(hostId, path) { return isMultiHost() && hostId ? sessionKey(hostId, path) : path; }

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
  transcriptController.retire();
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

  transcriptController.reset();
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
  transcriptController.retire();
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
  if (forceTranscriptReload) transcriptController.deleteCached(sessionRefKey(sessionState.currentSession));
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
  focusMode: () => focusMode, oldestIndex: () => transcriptController.oldestIndex, hasOlder: () => transcriptController.hasOlder,
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
  filters: () => sidebarQuery.filters, setFilters: value => sidebarQuery.setFilters(value),
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

const transcriptController = PiDishBrowser.createTranscript({
  document, sessionState, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  renderMessage: message => renderMessageHtml(message), finalize: (root, options) => finalizeRender(root, options),
  closeSearch: () => closeSearch(), cancelStreaming: () => cancelStreamingRender(), mood: (description, face) => setMoodIndicator(description, face),
  updateMood: messages => updateMoodFromMessages(messages), pinned: isPinnedToBottom, scroll: scrollToBottom, jump: updateJumpButton,
  consumeEcho: (id, content) => consumePendingSelfEcho(id, content),
});
function stashCurrentTranscript() { transcriptController.stash(); }
function restoreCachedTranscript(id) { return transcriptController.restore(id); }
function pruneTranscriptCache(id) { transcriptController.pruneCache(id); }
function maybeLoadOlderMessages(container) { transcriptController.maybeOlder(container); }
function renderMessageHtml(message) { return messageRenderer.message(message); }
function loadMessages(owner) { return transcriptController.load(owner); }
function renderLoadOlderBar() { return transcriptController.barHtml(); }
function renderMessages(messages) { transcriptController.render(messages); }
function loadOlderMessages() { return transcriptController.loadOlder(); }
function fetchNewMessagesSince(owner) { return transcriptController.catchup(owner); }

// Typed message projection and telemetry retain only their own render data.
const messageRenderer = PiDishBrowser.createMessageRenderer({
  document, sessionState, details: responseDetailsController, markdown: text => formatMarkdown(text),
  assetUrl: hostAssetUrl, matchRef: ref => sessionMatchingRef(ref), pinned: isPinnedToBottom,
  follow: () => followStream, scroll: scrollToBottom, jump: updateJumpButton,
});
function imageBlocksHtml(content, alt) { return messageRenderer.images(content, alt); }
function renderUserMessage(message, time, attrs) { return messageRenderer.user(message, time, attrs); }
function renderAssistantMessage(message, time, options) { return messageRenderer.assistant(message, time, options); }
function renderCustomMessage(message, time, attrs) { return messageRenderer.custom(message, time, attrs); }
function renderThinkingBlock(text) { return messageRenderer.thinking(text); }
function renderToolCall(block) { return messageRenderer.tool(block); }
function upsertLiveCustomMessage(message, options) { messageRenderer.upsertCustom(message, options); }
function updateRenderedResponseMetadata() { responseDetailsController.update(); }
function refreshResponsePricingState() { responseDetailsController.refreshPricing(); }
function openResponseDetails(id) { responseDetailsController.open(id); }
function closeResponseDetails() { responseDetailsController.close(); }

// =========================================================================
// Live Tool Panels (streaming tool execution)
// =========================================================================

const liveToolsController = PiDishBrowser.createLiveTools({
  document, sessionState, started: (id, name) => { runningTools.set(id, name); updateWorkingIndicator(); },
  finished: id => { runningTools.delete(id); updateWorkingIndicator(); }, pinned: isPinnedToBottom, scroll: scrollToBottom, jump: updateJumpButton,
  images: (content, alt) => imageBlocksHtml(content, alt), mood: (name, args) => applyMoodFromTool(name, args),
});
function appendLiveToolPanel(data, options) { return liveToolsController.append(data, options); }
function updateLiveToolPanel(data) { liveToolsController.update(data); }
function finalizeLiveToolPanel(data) { liveToolsController.finish(data); }

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
      liveToolsController.finishRunning();
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
      transcriptController.deleteCached(sessionKey(hostId, nextId));
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
  liveToolsController.clear(container);
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
function groupToolActivity(container) { PiDishBrowser.groupToolActivity(container); }
function updateToolGroupSummary(group) { PiDishBrowser.updateToolGroupSummary(group); }

// =========================================================================
// Streaming assistant renderer — incremental, block-level, throttled.
//
// Every message_update carries the full message so far, so we keep one
// streaming DOM element and update only the content blocks that changed
// (the growing tail block in practice). No outerHTML swaps: <details>
// open/closed state survives naturally and layout work stays minimal.
// =========================================================================

const streamingRenderer = PiDishBrowser.createStreamingRenderer({
  document, sessionState, markdown: text => formatMarkdown(text), pinned: isPinnedToBottom, scroll: scrollToBottom, jump: updateJumpButton,
});
function queueStreamingRender(message) { streamingRenderer.queue(message); }
function flushStreamingRender() { streamingRenderer.flush(); }
function cancelStreamingRender() { streamingRenderer.cancel(); }
function renderStreamingMessage(message) { streamingRenderer.render(message); }

function setStatus(message, type = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
}

// =========================================================================
// Mood indicator — web fallback for the mood extension's custom editor
// =========================================================================

const moodController = PiDishBrowser.createMood(document);
function setMoodIndicator(description, face) { moodController.set(description, face); }
function applyMoodFromTool(name, args) { moodController.fromTool(name, args); }
function updateMoodFromMessages(messages) { moodController.fromMessages(messages); }

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
  retainedRoots: () => transcriptController.retainedRoots(), isPinned: feed => isPinnedToBottom(feed), scrollBottom: feed => scrollToBottom(feed),
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
