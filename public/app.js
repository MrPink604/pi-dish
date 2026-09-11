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
let sessionRelationsSeq = 0;
const RESPONSE_MODE_KEY = 'pi-dish-response-metadata';
const RESPONSE_MODES = new Set(['hidden', 'compact', 'performance', 'performance-cost']);
let responseMetadataMode = RESPONSE_MODES.has(localStorage.getItem(RESPONSE_MODE_KEY)) ? localStorage.getItem(RESPONSE_MODE_KEY) : 'compact';
// Which context number the sidebar rows carry. Device-local like the other
// display preferences — it's a reading habit, not a fleet-wide setting.
const CONTEXT_METRIC_KEY = 'pi-dish-sidebar-context-metric';
let sidebarContextMetric = localStorage.getItem(CONTEXT_METRIC_KEY) === 'tokens' ? 'tokens' : 'percent';
let responseDetailSeq = 0;
const responseDetails = new Map();
let usageRange = '30', usageTimer = null, usageData = null, usageChart = null, usageSelectedDay = null;
let usageHostErrors = []; // hosts that did not answer the last fan-out
let usageHostPending = []; // hosts the current fan-out is still waiting on
// Subscription-limit reports (/api/usage-limits), per host, fetched alongside
// the summary. Account-level quota isn't summable, so unlike the summary
// these stay per-host entries and render through usageLimitsHtml.
let usageLimitsEntries = [], usageLimitsPending = 0;
let usageSort = localStorage.getItem('pi-dish-usage-sort') === 'tokens' ? 'tokens' : 'cost';
// Chart stacking pivot: by model (identity) or by cost bucket (read/cached/
// output/cache write). Client-side only — same payload, no refetch.
let usageStack = localStorage.getItem('pi-dish-usage-stack') === 'buckets' ? 'buckets' : 'models';
let usageModelFilter = new Set(); // multi-select model refs; empty = all models
let settingsRenderSeq = 0, usageFetchSeq = 0;

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

// Load slash commands — when a session is given, the server asks the live
// session so the list matches exactly what that session supports. The seq
// guard drops out-of-order responses: switching sessions quickly must not
// let the previous session's slower reply clobber the new session's list.
let commandsSeq = 0;
async function loadCommands(sessionId) {
  const seq = ++commandsSeq;
  try {
    const qs = sessionId ? ('?sessionId=' + encodeURIComponent(sessionId)) : '';
    const res = await apiFetch(sessionState.sessionHostId(sessionId), '/api/commands' + qs);
    const data = await res.json();
    if (seq !== commandsSeq) return; // superseded by a newer session's fetch
    if (Array.isArray(data)) slashCommands = data;
  } catch (e) {
    console.error('Failed to load commands:', e);
  }
}

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
    // While dictating, Escape cancels the recording (handled by the document
    // listener) — it must not also abort the turn.
    if (e.key === 'Escape' && !autocompleteVisible && !isRecording() && turnInProgress) { e.preventDefault(); abortTurn(); }
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
    if (!link || !sessionState.currentSession) return;
    e.preventDefault();
    openFileViewer(link.textContent.trim());
  });

  // Per-message share link (the hover 🔗 in turn headers).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.msg-link-btn');
    if (btn) copyMessageShareLink(btn);
  });

  // Fenced-block controls: copy source, and for diagram fences the
  // source/diagram toggle and the zoom overlay. Delegated on document because
  // code blocks appear in the transcript *and* the file viewer, and both
  // re-render often.
  document.addEventListener('click', (e) => {
    const copy = e.target.closest('.code-copy-btn');
    if (copy) {
      const code = copy.closest('.code-block')?.querySelector('pre code');
      copyTextToClipboard(code ? code.textContent : '').then(
        () => { copy.textContent = '✓'; setTimeout(() => { copy.textContent = '⧉'; }, 1200); },
        () => setStatus('Copy failed (clipboard blocked)', 'error'),
      );
      return;
    }
    const block = e.target.closest('.diagram-block');
    if (!block) return;
    if (e.target.closest('.diagram-source-btn')) toggleDiagramSource(block);
    else if (e.target.closest('.diagram-zoom-btn')) openDiagramLightbox(block);
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

  const searchViewInput = document.getElementById('searchViewInput');
  searchViewInput.addEventListener('input', () => onSearchViewInput());
  searchViewInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearchViewInput({ immediate: true }); });
  document.getElementById('searchViewBody').addEventListener('click', (e) => {
    const card = e.target.closest('.search-result');
    if (card) openSearchResult(card.dataset.id, card.dataset.contentMatches === '1', card.dataset.host || null);
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

// =========================================================================
// Autocomplete — slash commands at the start of the input, @file mentions
// anywhere (fuzzy file search under the session cwd via fff; @/abs, @~/ and
// @../ tokens get shell-style path completion anywhere on the filesystem),
// and #session refs anywhere (fuzzy search over the sessions this client
// already holds — no fetch, the sidebar list is the index).
// =========================================================================

function handleAutocomplete(text) {
  // A provisional composer has no session cwd or live command set yet.
  if (currentSessionSpawnId) { hideAutocomplete(); return; }
  // @token ending at the caret → file mention
  const input = document.getElementById('promptInput');
  const caret = input.selectionStart ?? text.length;
  const at = text.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
  if (at && sessionState.currentSession) { queueFileAutocomplete(at[1]); return; }
  // #token ending at the caret → session ref. `# ` (a markdown heading) can't
  // reach here: the token charset excludes the space.
  const hash = text.slice(0, caret).match(/(?:^|\s)#([^\s#]*)$/);
  if (hash && sessionState.currentSession) { showSessionRefAutocomplete(hash[1]); return; }

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
    const res = await apiFetch(sessionState.currentSession.host, `/api/sessions/${encodeURIComponent(sessionState.currentSession.id)}/files?q=${encodeURIComponent(token)}`);
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

// --- #session refs ---
// The picker is local: every session this client can address is already in
// `sessions` (the fleet is aggregated client-side), so ranking them is a sort,
// not a round trip. Knowing the whole corpus is also what lets the picker
// write a ref that resolves — see refPrefixFor.

function allKnownSessions() {
  return [...sessionState.sessions.active, ...sessionState.sessions.previous];
}

function sessionHostIdOf(session) {
  return (session && session.host) || hostDirectory.self.hostId;
}

function sessionRefCandidates() {
  const all = allKnownSessions();
  if (!sessionState.currentSession) return all;
  const currentHost = sessionHostIdOf(sessionState.currentSession);
  return all.filter(s => s.id !== sessionState.currentSession.id || sessionHostIdOf(s) !== currentHost);
}

/** Ids sharing a session's host — the only ones a ref has to beat. */
function sameHostSessionIds(session) {
  const hostId = sessionHostIdOf(session);
  return allKnownSessions().filter(s => sessionHostIdOf(s) === hostId).map(s => s.id);
}

/**
 * The short id part of a ref, from the point of view of the host that will
 * expand it — always the session's owner. `shortSessionRef` may name the
 * native id or uuid tail inside an encoded route id, which only a host
 * advertising `refAliases` resolves; an older peer gets the route-id prefix
 * it understands (long for a non-Pi session, but resolvable there).
 */
function refPrefixFor(session) {
  const ids = sameHostSessionIds(session);
  const owner = hostEntryFor(sessionHostIdOf(session));
  return hostSupportsCapability(owner, 'refAliases', appConfig)
    ? shortSessionRef(session.id, ids)
    : uniqueSessionPrefix(session.id, ids);
}

/**
 * The ref to insert for `session` while composing into `target`. A ref is
 * resolved by the *target's* server, so it must read from that server's point
 * of view, not this client's: same host is a bare prefix, and a cross-host ref
 * takes the name-independent `hostId:fullId` form — except when the target is
 * this client's own host, whose fleet names are exactly the ones this client
 * knows and can therefore write.
 */
function composerSessionRef(session, target) {
  const sessionHost = sessionHostIdOf(session);
  const targetHost = sessionHostIdOf(target);
  const prefix = refPrefixFor(session);
  if (sessionHost === targetHost) return prefix;
  if (targetHost === hostDirectory.self.hostId) {
    const entry = hostEntryFor(sessionHost);
    if (entry && entry.name) return `${entry.name}/${prefix}`;
  }
  return `${sessionHost}:${session.id}`;
}

function showSessionRefAutocomplete(token) {
  const rows = searchSessionsForRef(sessionRefCandidates(), token, 8);
  if (!rows.length) { hideAutocomplete(); return; }
  showAutocompleteList(rows.map(({ session, indices }, i) => {
    const ref = composerSessionRef(session, sessionState.currentSession);
    const name = session.name || session.id.slice(0, 8);
    const desc = [
      isMultiHost() ? hostLabelFor(session.host) : '',
      ref,
      shortCwd(session.cwd || ''),
    ].filter(Boolean).join(' · ');
    return `<div class="autocomplete-item${i === 0 ? ' active' : ''}" data-session-ref="${escapeHtml(ref)}">
      <span class="autocomplete-icon session-ref-dot${session.isActive ? ' live' : ''}">●</span>
      <span class="autocomplete-name">${indices ? highlightFuzzy(name, indices) : escapeHtml(name)}</span>
      <span class="autocomplete-desc">${escapeHtml(desc)}</span>
    </div>`;
  }).join(''));
}

/** Replace the #token at the caret with the chosen ref. */
function acceptSessionRefMention(ref) {
  const input = document.getElementById('promptInput');
  const caret = input.selectionStart ?? input.value.length;
  const m = input.value.slice(0, caret).match(/(?:^|\s)#([^\s#]*)$/);
  hideAutocomplete();
  if (!m) return;
  const start = caret - m[1].length - 1; // include the '#'
  const insert = ref + ' ';
  input.value = input.value.slice(0, start) + '#' + insert + input.value.slice(caret);
  const pos = start + 1 + insert.length;
  input.focus();
  input.setSelectionRange(pos, pos);
  input.dispatchEvent(new Event('input')); // resize, save the draft, close
}

/** The session a ref addresses, resolved the way its owning server would. */
function sessionMatchingRef(ref, localHostId = sessionState.currentSession ? sessionHostIdOf(sessionState.currentSession) : hostDirectory.self.hostId) {
  const parts = parseSessionRefParts(ref);
  if (!parts) return null;
  const onHost = allKnownSessions().filter((session) => {
    const hostId = sessionHostIdOf(session);
    // Bare and self/ refs are local to the server that owns the transcript,
    // which is not necessarily the browser's serving host.
    if (!parts.hostPart) return hostId === localHostId;
    if (parts.hostIdForm) return hostId === parts.hostPart;
    if (parts.hostPart.toLowerCase() === 'self') return hostId === localHostId;
    const entry = hostEntryFor(hostId);
    return !!entry && String(entry.name || '').toLowerCase() === parts.hostPart.toLowerCase();
  });
  const exact = onHost.find(s => s.id === parts.id);
  if (exact || parts.hostIdForm) return exact || null;
  const matches = onHost.filter(s => s.id.startsWith(parts.id));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Metadata for the `#ref` tokens in a prompt, sent alongside it. The target's
 * server resolves its own sessions itself; these hints exist so a *peer's*
 * session can still be named in the block, since this client is the only
 * party that aggregates the fleet.
 */
function sessionRefHints(message) {
  const hints = [];
  for (const { ref } of parseSessionRefTokens(message)) {
    const session = sessionMatchingRef(ref);
    if (!session) continue;
    hints.push({
      ref,
      name: session.name || '',
      host: hostLabelFor(session.host) || '',
      cwd: session.cwd || '',
      isActive: !!session.isActive,
    });
  }
  return hints;
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
    var icon = cmd.source === 'builtin' || cmd.source === 'host' ? '⚙️' : cmd.source === 'extension' ? '🧩' : cmd.source === 'skill' ? '📚' : '📝';
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
  if (file != null) { acceptFileMention(file, el.hasAttribute('data-dir')); return; }
  const ref = el.getAttribute('data-session-ref');
  if (ref != null) { acceptSessionRefMention(ref); return; }
  acceptAutocompleteByName(el.getAttribute('data-name'));
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
    const res = await apiFetch(null, '/api/settings');
    const data = await res.json();
    savedFilters = Array.isArray(data.savedFilters) ? data.savedFilters : [];
    localStorage.setItem('pi-dish-saved-filters-cache', JSON.stringify(savedFilters));
    renderScopeChips();
    renderSessions();
    if (isSearchViewOpen()) runSearchView();
  } catch (e) { console.error('Failed to load saved filters:', e); }
}

async function persistSavedFilters(next) {
  const res = await apiFetch(null, '/api/settings', {
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
function queryHosts(hosts, query) {
  if (!query) return hosts;
  const terms = parseSessionQuery(query).terms.filter(t => t.field === 'host' && !t.neg);
  if (!terms.length) return hosts;
  const parsed = { terms, since: null, before: null };
  return hosts.filter(host => evaluateSessionQuery(parsed, {
    hostLabel: hostDisplayLabel(host), host: host.hostId || null,
  }));
}

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
  const ctxText = sidebarContextMetric === 'tokens' && session.contextTokens
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
  search.navigating = false;
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
  commandsSeq += 1;

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('sessionView').style.display = 'flex';
  document.querySelector('.input-area').style.display = '';
  document.getElementById('resumeBar').style.display = 'none';
  document.querySelector('.session-actions').style.display = 'none';

  renderQueueStatus(null);
  closeBtwPanel();
  setCompacting(false);
  setTurnInProgress(false);
  sessionArtifacts = { pages: [], share: null };
  updateArtifactsBadge();

  const nameEl = document.getElementById('sessionName');
  nameEl.textContent = 'Starting session…';
  nameEl.classList.remove('editable-name');
  nameEl.title = '';
  nameEl.onclick = null;
  const modelBtn = document.getElementById('sessionModel');
  modelBtn.textContent = `${harnessLabel} starting`;
  modelBtn.onclick = null;
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
  search.navigating = false;
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
  sessionArtifacts = { pages: [], share: null };
  updateArtifactsBadge();
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

function clearSessionRelations() {
  sessionRelationsSeq += 1;
  sessionRelations = [];
  closeRelationsModal();
  const el = document.getElementById('sessionRelations');
  if (!el) return;
  el.replaceChildren();
  el.style.display = 'none';
}

const RELATION_LABELS = {
  parent: 'Parent',
  child: 'Child',
  startedFrom: 'Started from',
  startedHere: 'Started here',
};

// Plural forms for the overflow modal's group headings.
const RELATION_GROUP_LABELS = {
  parent: 'Parent',
  child: 'Children',
  startedFrom: 'Started from',
  startedHere: 'Started here',
};

// Subagent fan-outs can relate a session to dozens of children. The header
// fills one physical row with live child chips; closed children and any live
// chips that do not fit go behind a "+N more" chip that opens the relations
// modal. The fallback is only used if the header has no measurable width yet.
const RELATION_FALLBACK_VISIBLE_CHIPS = 6;
let sessionRelations = [];
let relationResizeTimer = null;

function createRelationChip(relation) {
  const target = relation?.session;
  if (!target?.id) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'session-relation-chip';
  button.title = `${RELATION_LABELS[relation.kind] || 'Related session'} · ${relation.source || 'session metadata'}`;
  const kind = document.createElement('span');
  kind.className = 'session-relation-kind';
  kind.textContent = RELATION_LABELS[relation.kind] || 'Related';
  const name = document.createElement('span');
  name.className = 'session-relation-name';
  name.textContent = target.name || target.id.slice(0, 8);
  button.append(kind, name);
  button.addEventListener('click', () => {
    openRelatedSession(target.id, sessionState.captureSelection());
  });
  return button;
}

function createMoreRelationChip(hiddenCount) {
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'session-relation-chip session-relation-more';
  more.title = `Show ${hiddenCount} hidden related session${hiddenCount === 1 ? '' : 's'}`;
  const count = document.createElement('span');
  count.className = 'session-relation-kind';
  count.textContent = `+${hiddenCount}`;
  const label = document.createElement('span');
  label.className = 'session-relation-name';
  label.textContent = 'more';
  more.append(count, label);
  more.addEventListener('click', openRelationsModal);
  return more;
}

// Pick the largest prefix that fits in one row, reserving room for the
// overflow chip when any relation is hidden. The buttons are measured after
// insertion so long/short child names naturally determine how many fit.
function fitRelationChipCount(el, chips, totalCount) {
  const available = el.clientWidth;
  if (!available) return Math.min(chips.length, RELATION_FALLBACK_VISIBLE_CHIPS);

  const style = getComputedStyle(el);
  const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
  const moreProbe = createMoreRelationChip(totalCount);
  el.replaceChildren(...chips, moreProbe);
  const widths = chips.map(chip => chip.offsetWidth);
  const prefixWidths = [0];
  for (const width of widths) prefixWidths.push(prefixWidths[prefixWidths.length - 1] + width);

  let chosen = 0;
  for (let count = chips.length; count >= 0; count -= 1) {
    const hiddenCount = totalCount - count;
    let needed = prefixWidths[count] + Math.max(0, count - 1) * gap;
    if (hiddenCount > 0) {
      moreProbe.querySelector('.session-relation-kind').textContent = `+${hiddenCount}`;
      needed += (count ? gap : 0) + moreProbe.offsetWidth;
    }
    if (needed <= available) {
      chosen = count;
      break;
    }
  }
  return chosen;
}

function renderSessionRelations(relations) {
  const el = document.getElementById('sessionRelations');
  if (!el) return;
  // Keep all valid relations for the modal, but only live child relations are
  // eligible for the header. Parent/started-from links remain useful even
  // when those sessions are no longer active.
  sessionRelations = sortRelations(relations).filter(relation => relation?.session?.id);
  el.replaceChildren();
  if (!sessionRelations.length) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';

  const headerRelations = [
    // Keep live child bubbles visible when the row is tight; parent/source
    // links can still be reached from the overflow modal.
    ...sessionRelations.filter(relation => isChildRelation(relation) && relation.session.isActive),
    ...sessionRelations.filter(relation => !isChildRelation(relation)),
  ];
  const chips = headerRelations.map(createRelationChip).filter(Boolean);
  const visibleCount = fitRelationChipCount(el, chips, sessionRelations.length);
  const hiddenCount = sessionRelations.length - visibleCount;
  el.replaceChildren(...chips.slice(0, visibleCount));
  if (hiddenCount > 0) el.appendChild(createMoreRelationChip(hiddenCount));

  // The indexing re-poll can grow the list while the modal is open.
  const modal = document.getElementById('relationsModal');
  if (modal && modal.style.display !== 'none') renderRelationsModal();
}

window.addEventListener('resize', () => {
  if (!sessionRelations.length) return;
  clearTimeout(relationResizeTimer);
  relationResizeTimer = setTimeout(() => {
    const el = document.getElementById('sessionRelations');
    if (sessionState.currentSession && el?.style.display !== 'none') renderSessionRelations(sessionRelations);
  }, 100);
});

function openRelationsModal() {
  if (!sessionState.currentSession || !sessionRelations.length) return;
  document.getElementById('relationsModal').style.display = 'flex';
  renderRelationsModal();
}

function closeRelationsModal() {
  const modal = document.getElementById('relationsModal');
  if (modal) modal.style.display = 'none';
}

function renderRelationsModal() {
  const body = document.getElementById('relationsBody');
  if (!body) return;
  body.replaceChildren();
  const owner = sessionState.captureSelection();
  for (const group of groupRelations(sessionRelations)) {
    const title = document.createElement('div');
    title.className = 'stats-share-title relation-group-title';
    const label = RELATION_GROUP_LABELS[group.kind] || RELATION_LABELS[group.kind] || 'Related';
    title.textContent = group.relations.length > 1 ? `${label} (${group.relations.length})` : label;
    body.appendChild(title);
    for (const relation of group.relations) {
      const target = relation?.session;
      if (!target?.id) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'relation-row';
      row.title = target.cwd || target.id;
      if (target.isActive) {
        const dot = document.createElement('span');
        dot.className = 'live-dot';
        row.appendChild(dot);
      }
      const name = document.createElement('span');
      name.className = 'relation-row-name';
      name.textContent = target.name || target.id.slice(0, 8);
      row.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'relation-row-meta';
      meta.textContent = formatRelativeTime(target.lastActivity);
      row.appendChild(meta);
      row.addEventListener('click', () => {
        closeRelationsModal();
        openRelatedSession(target.id, owner);
      });
      body.appendChild(row);
    }
  }
}

async function loadSessionRelations(owner) {
  if (!sessionState.ownsSelection(owner)) return;
  const { id: sessionId, host } = owner;
  const seq = ++sessionRelationsSeq;
  try {
    const res = await apiFetch(host, `/api/sessions/${encodeURIComponent(sessionId)}/related`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (seq !== sessionRelationsSeq || !sessionState.ownsSelection(owner)) return;
    renderSessionRelations(data.relations);
    if (data.indexing) {
      setTimeout(() => {
        if (sessionState.ownsSelection(owner)) loadSessionRelations(owner);
      }, 1000);
    }
  } catch (e) {
    if (seq === sessionRelationsSeq && sessionState.ownsSelection(owner)) renderSessionRelations([]);
    console.error('Failed to load related sessions:', e);
  }
}

async function openRelatedSession(sessionId, owner) {
  if (!sessionState.ownsSelection(owner)) return;
  if (!sessionState.findSession(sessionId, owner.host)) await loadSessions(undefined, { withPrevious: true });
  if (!sessionState.ownsSelection(owner)) return;
  if (!sessionState.findSession(sessionId, owner.host)) {
    setStatus('Related session is not available yet', 'error');
    return;
  }
  selectSession(sessionId, { host: owner.host });
}

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
  nameEl.onclick = canRename ? startRename : null;

  const modelBtn = document.getElementById('sessionModel');
  const canSetModel = sessionState.currentSession.isActive && sessionSupports(sessionState.currentSession, 'setModel');
  setModelChipLabel(modelBtn, sessionState.currentSession.model, canSetModel ? ' ▾' : '');
  modelBtn.onclick = canSetModel ? toggleModelDropdown : null;
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

// --- Thinking level selector (levels from helpers.thinkingLevelsFor: pi's
//     fixed vocabulary, OMP's model-supported subset + off/auto) ---
let thinkingDropdownOpen = false;
let thinkingSelector = null;

function updateThinkingBadges() {
  const level = sessionState.currentSession?.thinkingLevel;
  const show = !!(sessionState.currentSession && sessionState.currentSession.isActive && sessionSupports(sessionState.currentSession, 'setThinking'));
  const label = (level || '?') + ' ▾';
  const badge = document.getElementById('sessionThinking');
  if (badge) {
    badge.style.display = show ? '' : 'none';
    badge.textContent = label;
  }
}

async function toggleThinkingDropdown() {
  if (!sessionState.currentSession || !sessionState.currentSession.isActive || !sessionSupports(sessionState.currentSession, 'setThinking')) return;
  // Load the model list so OMP can trim the dropdown to what the session's
  // model supports (cached after the first fetch).
  const owner = sessionState.captureSelection();
  await loadModels(owner.id, sessionState.currentSession.harnessId);
  if (!sessionState.ownsSelection(owner)) return;
  const dropdown = document.getElementById('thinkingDropdown');
  thinkingDropdownOpen = !thinkingDropdownOpen;
  if (!thinkingDropdownOpen) { closeThinkingDropdown(); return; }

  const ref = sessionState.currentSession.model || '';
  const model = modelCatalog.rows().find(m => m &&
    (m.selector === ref || m.id === ref || `${m.provider}/${m.id}` === ref));
  if (!thinkingSelector) {
    // Unowned actions must not dismiss or mutate a newer selection. Normal
    // selection changes already dispose this instance before the view reset.
    thinkingSelector = PiDishBrowser.mountThinkingSelector(dropdown, {
      selectLevel: (target, level) => {
        if (sessionState.ownsSelection(target)) selectThinkingLevel(level);
      },
      requestClose: target => {
        if (sessionState.ownsSelection(target)) closeThinkingDropdown();
      },
    });
  }
  thinkingSelector.update({ owner, levels: thinkingLevelsFor(sessionState.currentSession.harnessId, model),
    currentLevel: sessionState.currentSession.thinkingLevel || null });

  // Desktop: anchored under the header button. Mobile: the stylesheet
  // positions it (full-width sheet, same as the model dropdown). The button
  // is looked up by id, never taken off the click event: the await above
  // outlives the event dispatch, so `event.currentTarget` is null by here.
  if (window.innerWidth > 768) {
    anchorDropdown(dropdown, document.getElementById('sessionThinking').getBoundingClientRect());
  } else {
    clearDropdownPos(dropdown);
  }
  dropdown.style.display = 'block';
  // The badge counts as inside, or clicking it while open would close the
  // dropdown here and let this handler's own toggle reopen it.
  armOutsideClickClose(['sessionThinking', 'thinkingDropdown'], closeThinkingDropdown, () => thinkingDropdownOpen);
}

function closeThinkingDropdown() {
  thinkingDropdownOpen = false;
  thinkingSelector?.dispose();
  thinkingSelector = null;
  document.getElementById('thinkingDropdown').style.display = 'none';
}

async function selectThinkingLevel(level) {
  closeThinkingDropdown();
  if (!sessionState.currentSession || !sessionSupports(sessionState.currentSession, 'setThinking')) return;
  const owner = sessionState.captureSelection();
  const { id, host } = owner;
  try {
    const data = await sessionApi.setThinking(owner, level);
    // The harness clamps to what the model supports; trust the reported
    // level, and say so when it differs from what was asked for.
    const reported = data.level || level;
    sessionState.patchSession(id, { thinkingLevel: reported }, host);
    if (!sessionState.ownsSelection(owner)) return;
    setStatus(reported !== level
      ? `Thinking level: ${reported} (model doesn't support ${level})`
      : `Thinking level: ${reported}`);
  } catch (e) {
    if (sessionState.ownsSelection(owner)) setStatus('Thinking level failed: ' + e.message, 'error');
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
  if (!sessionState.currentSession) return;
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

async function runSessionSearch(query, { mode = 'message', closeIfEmpty = false } = {}) {
  if (!sessionState.currentSession) return;
  const owner = sessionState.captureSelection();
  const sessionId = owner.id;
  updateSearchCount('searching…');
  try {
    const params = new URLSearchParams({ q: query });
    if (mode !== 'message') params.set('mode', mode);
    const res = await apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/search?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!sessionState.ownsSelection(owner)) return;
    search.query = query;
    search.matches = visibleSearchMatchesOf(data.matches || []);
    search.pos = search.matches.length - 1; // start from the latest match
    if (search.matches.length) await jumpToSearchResult();
    else if (closeIfEmpty) { closeSearch(); return; }
    if (!sessionState.ownsSelection(owner)) return;
    updateSearchCount();
  } catch (e) {
    if (!sessionState.ownsSelection(owner)) return;
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
  if (!match || !sessionState.currentSession) return;
  const owner = sessionState.captureSelection();
  search.navigating = true;
  try {
    const container = document.getElementById('messages');
    // Page older messages in until the match is loaded.
    let guard = 0;
    while (sessionState.ownsSelection(owner) && oldestLoadedIndex != null && match.index < oldestLoadedIndex && hasMoreOlder && guard++ < 200) {
      await loadOlderMessages();
    }
    if (!sessionState.ownsSelection(owner)) return;
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
    if (sessionState.ownsSelection(owner)) search.navigating = false;
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
  closeSidebar();
  closeBounceView();
  document.getElementById('settingsModal').style.display = 'flex';
  renderPreferences();
  document.querySelector('#settingsModal .settings-body').scrollTop = 0;
}

function closeSettingsModal() {
  recoveryController.unmountPreferences();
  hostSettings.unmount();
  closeBounceView();
  document.getElementById('settingsModal').style.display = 'none';
}

async function renderPreferences() {
  recoveryController.unmountPreferences();
  hostSettings.unmount();
  const renderSeq = ++settingsRenderSeq;
  const body = document.getElementById('settingsBody');
  body.innerHTML = `<div class="preference-row"><label for="settingsTheme"><strong>Theme</strong><small>Stored on this device. Built-ins plus any token files in <code>~/.pi/dish/themes/</code>.</small></label>
    <select id="settingsTheme"></select></div>
    <div class="preference-row"><label for="sidebarContextMetric"><strong>Session list context readout</strong><small>Stored on this device. Which number each sidebar row shows for context use.</small></label>
    <select id="sidebarContextMetric"><option value="percent">Percent of context</option><option value="tokens">Token count</option></select></div>
    <div class="preference-row"><label for="responseMetadataMode"><strong>Response metadata</strong><small>Stored on this device. “Effective speed” includes time to first token and JSONL append.</small></label>
    <select id="responseMetadataMode"><option value="hidden">Hidden</option><option value="compact">Compact</option><option value="performance">Performance</option><option value="performance-cost">Performance + estimated cost</option></select></div>
    <div class="preference-row"><label for="monthlyBudget"><strong>Monthly budget warning (USD)</strong><small>Server-global: applies to every device. Estimates use each session harness's catalog pricing; blank clears.</small></label><div class="budget-save"><input id="monthlyBudget" type="number" min="0.01" step="0.01" placeholder="No warning"><button class="btn-small" id="saveBudget">Save</button></div><small id="budgetStatus"></small></div>
    <div id="recoveryPreferences" class="preference-row recovery-preferences" hidden></div>
    ${PiDishBrowser.hostSettingsHtml}
    <div class="preference-row"><label><strong>Saved sidebar filters</strong><small>Server-global. Chips under the sidebar filter toggle these per device; type a query there and hit “+ save filter” to add one.</small></label><div id="savedFiltersList" class="saved-filters-list"></div></div>`;
  const mode = body.querySelector('#responseMetadataMode'); mode.value = responseMetadataMode;
  mode.addEventListener('change', () => {
    responseMetadataMode = RESPONSE_MODES.has(mode.value) ? mode.value : 'compact';
    localStorage.setItem(RESPONSE_MODE_KEY, responseMetadataMode); updateRenderedResponseMetadata();
  });
  const themeSel = body.querySelector('#settingsTheme');
  renderThemeSelect(themeSel);
  themeSel.addEventListener('change', () => applyTheme(themeSel.value));
  const ctxMetric = body.querySelector('#sidebarContextMetric'); ctxMetric.value = sidebarContextMetric;
  ctxMetric.addEventListener('change', () => {
    sidebarContextMetric = ctxMetric.value === 'tokens' ? 'tokens' : 'percent';
    localStorage.setItem(CONTEXT_METRIC_KEY, sidebarContextMetric);
    renderSessions();
  });
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
  hostSettings.mount(body);
  refreshRecoveryHosts();
  renderRecoveryPreferences();
  try {
    const r = await apiFetch(null, '/api/settings'), s = await r.json();
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
    try { const r = await apiFetch(null, '/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ monthlyBudgetUsd:value }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); status.textContent = 'Saved for all devices.'; }
    catch (e) { status.textContent = 'Save failed: ' + e.message; }
  });
}

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

// --- Advanced search (main-pane takeover) ---
// Full-width search over every session: the sidebar grammar verbatim (one
// dialect — never fork it), multiple highlighted snippets per session with
// an occurrence count, facet controls that are pure UI over the grammar
// (they rewrite the query text, which stays the single source of truth),
// and click-through that opens the session and hands the positive tokens to
// the in-session search so the reader lands on the match. `<main>`-level
// like the usage view because search isn't session-scoped; active scopes are
// sent separately so the server applies them before its result cap.
let searchViewSeq = 0;
let searchViewQuery = '';
let searchViewRenderedQuery = '';
let searchViewTimer = null;
let searchViewRepollTimer = null;

function isSearchViewOpen() {
  return document.querySelector('.main').classList.contains('search-open');
}

function openSearchView(initialQuery) {
  closeSidebar();
  closeUsageView(); // takeovers are mutually exclusive
  closeNewSessionView();
  closeSkillsView();
  closeRoutinesView();
  closeRecoveryView();
  closeBounceView();
  if (typeof initialQuery === 'string') searchViewQuery = initialQuery;
  const input = document.getElementById('searchViewInput');
  input.value = searchViewQuery;
  document.querySelector('.main').classList.add('search-open');
  input.focus();
  input.select();
  runSearchView();
}

function closeSearchView() {
  searchViewSeq += 1;
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

/**
 * Merge per-host /api/search payloads into one ranked list. Scores are
 * directly comparable across hosts — ranking is the shared scoreSessionMatch
 * and only the owning host can count its own transcript occurrences — so the
 * merge is a re-sort, with recency breaking ties exactly as it does locally.
 */
function mergeSearchPayloads(entries, query) {
  // Every result carries its host id *and* label: `host:` is evaluated on
  // this side (the servers never saw the term) and matches on the label.
  const stampHost = (session, host) => ({
    ...session,
    ...(host.hostId ? { host: host.hostId } : {}),
    ...(hostDisplayLabel(host) ? { hostLabel: hostDisplayLabel(host) } : {}),
  });
  if (entries.length === 1 && !entries[0].host.hostId) {
    const { host, payload } = entries[0];
    return { ...payload, results: (payload.results || []).map(s => stampHost(s, host)) };
  }
  const parsed = parseSessionQuery(query);
  const results = [];
  let total = 0, hiddenByScopes = 0, hiddenByAutomation = 0, indexing = false;
  for (const { host, payload } of entries) {
    for (const session of payload.results || []) results.push(stampHost(session, host));
    total += Number(payload.total) || (payload.results || []).length;
    hiddenByScopes += Number(payload.hiddenByScopes) || 0;
    hiddenByAutomation += Number(payload.hiddenByAutomation) || 0;
    if (payload.indexing) indexing = true;
  }
  results.sort((a, b) =>
    (b.searchScore ?? scoreSessionMatch(parsed, b)) - (a.searchScore ?? scoreSessionMatch(parsed, a))
    || new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  return { results, total, hiddenByScopes, hiddenByAutomation, indexing };
}

async function runSearchView() {
  const seq = ++searchViewSeq;
  const query = searchViewQuery.trim();
  const scope = scopeQuery().trim();
  const body = document.getElementById('searchViewBody');
  if (body.childElementCount) body.classList.add('usage-refreshing');
  else body.innerHTML = '<div class="usage-state">Searching…</div>';
  // `host:` stays on this side of the wire — in the query and in any
  // active scope — or every server would answer with nothing. Positive
  // host terms prune the fan-out instead; the rest is applied to the
  // merged results below.
  const params = new URLSearchParams({ q: stripQueryField(query, 'host') });
  // The browser's default: inactive routine runs are cron noise — the server
  // drops them (before its result cap) unless the query or an active scope
  // affirmatively asks. Sent as a param so API/CLI consumers of /api/search
  // keep the inclusive corpus.
  params.set('hideAutomation', '1');
  const wireScope = stripQueryField(scope, 'host');
  if (wireScope) params.set('scope', wireScope);
  // Every host searches its own index and ranks with the same shared
  // scoreSessionMatch, so the merge is a plain re-sort on searchScore.
  const hosts = queryHosts(queryHosts(fanoutHosts(), query), scope);
  const stale = () => seq !== searchViewSeq || !isSearchViewOpen() ||
    query !== searchViewQuery.trim() || scope !== scopeQuery().trim();
  // Render as each host lands: a fleet's slowest peer must not decide when
  // the fastest one's results become readable. renderSearchView is a full
  // idempotent render, and on one host the first settle *is* the final one —
  // single-host behavior is unchanged, hint and all.
  const status = hosts.map(() => 'pending');
  const payloads = new Array(hosts.length);
  const reasons = new Array(hosts.length);
  let rendered = null;
  const render = () => {
    if (stale()) return;
    const ok = hosts.map((host, i) => (status[i] === 'ok' ? { host, payload: payloads[i] } : null)).filter(Boolean);
    const d = ok.length
      ? mergeSearchPayloads(ok, query)
      : { results: [], total: 0, hiddenByScopes: 0, hiddenByAutomation: 0, indexing: false };
    // The client-only half of the grammar, applied to what came back: the
    // query's remaining host terms (negations, and positives on a host that
    // serves several labels), then any host term in an active scope. Every
    // partial render goes through it — partial results must not bypass the
    // grammar for even one frame.
    d.results = applyHostTerms(d.results, query);
    const inScope = applyHostTerms(d.results, scope);
    d.hiddenByScopes += d.results.length - inScope.length;
    d.results = inScope;
    d.hostErrors = hosts.filter((_, i) => status[i] === 'error').map(hostDisplayLabel);
    d.hostPending = hosts.filter((_, i) => status[i] === 'pending').map(hostDisplayLabel);
    searchViewRenderedQuery = query;
    rendered = d;
    renderSearchView(d, query);
  };
  try {
    await Promise.all(hosts.map(async (host, i) => {
      try {
        const r = await apiFetch(host, '/api/search?' + params, { timeoutMs: 20000 });
        if (r.status === 401) { noteHostBlocked(host); throw new Error('needs a token'); }
        if (!r.ok) throw new Error(await r.json().then(d => d.error, () => null) || `HTTP ${r.status}`);
        payloads[i] = await r.json();
        status[i] = 'ok';
        noteHostReachable(host);
      } catch (e) {
        status[i] = 'error';
        reasons[i] = e;
        if (!host.self) noteHostFailure(host, e);
      }
      // Until one host has answered there is nothing to show: keep the
      // previous render (or "Searching…") instead of flashing an empty list.
      if (status.some(s => s === 'ok')) render();
    }));
    if (!status.some(s => s === 'ok')) {
      // Every host pruned away is an answer, not a failure: the query named a
      // host none of them is, so the result set is empty.
      if (hosts.length) throw reasons.find(Boolean) || new Error('no hosts answered');
      render();
    }
    if (stale() || !rendered) return;
    if (rendered.indexing) searchViewRepollTimer = setTimeout(() => { if (isSearchViewOpen()) runSearchView(); }, 1000);
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
    host: val('host'),
    activeOnly: parsed.terms.some(t => t.field === 'is' && !t.neg && t.value === 'active'),
    automationOnly: parsed.terms.some(t => t.field === 'is' && !t.neg && t.value === 'automation'),
    since: (searchViewQuery.match(/(?:^|\s)since:(\S+)/i) || [])[1] || '',
  };
}

// Facet options come from the sidebar's session lists (the full corpus the
// client already knows), not from the current results — otherwise picking a
// workspace would immediately empty every other option.
function searchFacetOptions() {
  const all = [...sessionState.sessions.active, ...sessionState.sessions.previous];
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
  // The host facet exists only where there is a fleet to choose from, and
  // its options come from the client's own host list — hosts are a client
  // concept, so no result payload could source them.
  const hostSelect = !isMultiHost() ? '' : `<select class="search-facet-select" id="searchFacetHost">${
    ['<option value="">All hosts</option>', ...effectiveHosts().map(h => hostDisplayLabel(h)).filter(Boolean).map(label =>
      `<option value="${escapeHtml(label)}"${label.toLowerCase() === st.host ? ' selected' : ''}>${escapeHtml(label)}</option>`)].join('')
  }</select>`;
  return `<div class="search-facets">
    <div class="usage-ranges">${presets}</div>
    <select class="search-facet-select" id="searchFacetCwd">${cwdOptions}</select>
    <select class="search-facet-select" id="searchFacetModel">${modelOptions}</select>
    ${hostSelect}
    <button class="scope-chip${st.activeOnly ? ' active' : ''}" id="searchFacetActive" title="is:active">Active only</button>
    <button class="scope-chip${st.automationOnly ? ' active' : ''}" id="searchFacetAutomation" title="is:automation">Automation</button>
  </div>`;
}

function renderSearchView(d, query = searchViewQuery) {
  const body = document.getElementById('searchViewBody');
  body.classList.remove('usage-refreshing');
  const tokens = positiveQueryTokens(parseSessionQuery(query));
  const shown = d.results || [];
  const scopesHidden = Number(d.hiddenByScopes) || 0;
  const automationHidden = Number(d.hiddenByAutomation) || 0;

  const cards = shown.map(s => {
    let dot = '';
    if (s.turnInProgress || s.compacting) dot = '<span class="session-item-status working"></span>';
    else if (s.isActive) dot = '<span class="live-dot"></span>';
    const count = s.matchCount
      ? `<span class="search-result-count">${s.matchCount} ${s.matchCount === 1 ? 'match' : 'matches'}</span>` : '';
    const snippets = (s.snippets || []).map(sn =>
      `<div class="search-result-snippet">${highlightTokens(sn, tokens)}</div>`).join('');
    return `<div class="search-result" data-id="${escapeHtml(s.id)}"${s.host ? ` data-host="${escapeHtml(s.host)}"` : ''} data-content-matches="${s.matchCount > 0 ? '1' : '0'}">
      <div class="search-result-header">
        ${dot}<span class="search-result-name">${highlightTokens(s.name || 'Unnamed', tokens)}</span>
        ${count}<span class="search-result-time">${formatRelativeTime(s.lastActivity)}</span>
      </div>
      <div class="search-result-meta">${hostChipHtml(s.host)}${escapeHtml(shortCwd(s.cwd || '~'))} · ${escapeHtml(s.model)}</div>
      ${snippets}
    </div>`;
  }).join('');

  body.innerHTML = `
    ${renderSearchFacetsHtml()}
    ${d.indexing ? '<div class="usage-notice">History is indexing; results will refresh…</div>' : ''}
    ${d.hostErrors?.length ? `<div class="usage-notice">Not searched: ${escapeHtml(d.hostErrors.join(', '))} did not answer.</div>` : ''}
    ${d.hostPending?.length ? `<div class="usage-notice">Still searching ${escapeHtml(d.hostPending.join(', '))}…</div>` : ''}
    <div class="search-count-line">${shown.length === 1 ? '1 session' : `${shown.length} sessions`}${d.total > d.results.length ? ` — showing the ${d.results.length} ${tokens.length ? 'best matches' : 'most recent'}, narrow the query for the rest` : ''}</div>
    ${cards || '<div class="usage-state">No matching sessions.</div>'}
    ${scopesHidden > 0 ? `<div class="scope-hidden-note">${scopesHidden} hidden by scopes</div>` : ''}
    ${automationHidden > 0 ? `<div class="scope-hidden-note">${automationHidden} automation run${automationHidden === 1 ? '' : 's'} hidden (is:automation shows them)</div>` : ''}
  `;
  body.querySelectorAll('[data-since]').forEach(b =>
    b.addEventListener('click', () => setSearchToken('since', b.dataset.since || null)));
  body.querySelector('#searchFacetCwd').addEventListener('change', (e) =>
    setSearchToken('cwd', e.target.value || null));
  body.querySelector('#searchFacetModel').addEventListener('change', (e) =>
    setSearchToken('model', e.target.value || null));
  body.querySelector('#searchFacetHost')?.addEventListener('change', (e) =>
    setSearchToken('host', e.target.value || null));
  body.querySelector('#searchFacetActive').addEventListener('click', () =>
    setSearchToken('is', searchFacetState().activeOnly ? null : 'active'));
  body.querySelector('#searchFacetAutomation').addEventListener('click', () =>
    setSearchToken('is', searchFacetState().automationOnly ? null : 'automation'));
}

/**
 * Click-through: close the takeover, show the session, and — when the query
 * had text terms — hand them to the in-session search so the reader lands on
 * the actual match instead of at the transcript's tail.
 */
async function openSearchResult(id, hasContentMatches, host = null) {
  const tokens = positiveQueryTokens(parseSessionQuery(searchViewRenderedQuery));
  closeSearchView();
  const navigation = searchViewSeq;
  // Search results span the whole corpus; the sidebar lists may be narrowed
  // (or Active-tab-only) right now, and selectSession validates against them.
  if (!sessionState.findSession(id, host)) await loadSessions(undefined, { withPrevious: true });
  if (navigation !== searchViewSeq) return;
  const entry = sessionState.findSession(id, host);
  if (!entry) return;
  const selecting = selectSession(id, { host: entry.host || null });
  const owner = sessionState.captureSelection();
  await selecting;
  if (tokens.length && hasContentMatches && sessionState.ownsSelection(owner) && owner.id === id && owner.host === (entry.host || null)) {
    openSearch();
    const input = document.getElementById('searchInput');
    input.value = tokens.join(' ');
    await runSessionSearch(input.value.trim().toLowerCase(), { mode: 'any', closeIfEmpty: true });
  }
}

// --- Skills view (main-pane takeover) ------------------------------------
// Observational directory of discovered skills and their mined activation
// coverage. Directory + an in-takeover detail page (never a modal). Every
// token number is a chars/4 estimate; every usage number is inferred from
// tool calls — badged accordingly, and quiet skills are warm-muted, never
// alarm-colored. See TASKS/skills-view-phase1.md.
let skillsData = null;        // GET /api/skills payload
let skillsRefine = null;      // refine config from the same payload
let skillsSort = 'recent';
let skillsFilter = '';
let skillsDetailPath = null;  // absolute SKILL.md path when the detail is open
let skillsDetail = null;      // GET /api/skills/coverage payload
let skillsSeq = 0;

function isSkillsViewOpen() {
  return document.querySelector('.main').classList.contains('skills-open');
}

function openSkillsView() {
  closeSidebar();
  closeUsageView(); // takeovers are mutually exclusive
  closeSearchView();
  closeNewSessionView();
  closeRoutinesView();
  closeRecoveryView();
  closeBounceView();
  document.querySelector('.main').classList.add('skills-open');
  skillsDetailPath = null;
  loadSkillsDirectory();
}

function closeSkillsView() {
  document.querySelector('.main').classList.remove('skills-open');
}

function refreshSkillsView() {
  if (skillsDetailPath) openSkillDetail(skillsDetailPath, { force: true });
  else loadSkillsDirectory();
}

// Escape on the detail page steps back to the directory; on the directory it
// closes the takeover. Wired into the global Escape handler.
function skillsViewEscape() {
  if (skillsDetailPath) { backToSkillsDirectory(); return true; }
  closeSkillsView();
  return true;
}

function fmtTok(n) {
  n = Number(n) || 0;
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
function fmtEditedDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Single-hue sparkline: bars scaled to `maxPx`, zero weeks as --chart-other
// stubs (never omitted). `pct` renders flex bars with % heights instead.
function renderSpark(weeks, { maxPx = 22, cls = 'spark', pct = false } = {}) {
  const max = Math.max(1, ...weeks);
  const bars = weeks.map(w => {
    if (!w) return '<i class="z"></i>';
    if (pct) return `<i style="height:${Math.max(9, Math.round(w / max * 100))}%"></i>`;
    return `<i style="height:${Math.max(3, Math.round(w / max * maxPx))}px"></i>`;
  }).join('');
  return `<div class="${cls}">${bars}</div>`;
}

async function loadSkillsDirectory() {
  const seq = ++skillsSeq;
  const body = document.getElementById('skillsViewBody');
  renderSkillsHeader('directory');
  if (!body.childElementCount) body.innerHTML = '<div class="usage-state">Loading skills…</div>';
  else body.classList.add('usage-refreshing');
  try {
    const r = await apiFetch(null, '/api/skills');
    if (!r.ok) throw new Error(await r.json().then(d => d.error, () => null) || `HTTP ${r.status}`);
    const d = await r.json();
    if (seq !== skillsSeq || !isSkillsViewOpen() || skillsDetailPath) return;
    skillsData = d;
    skillsRefine = d.refine;
    renderSkillsDirectory(d);
    if (d.indexing) setTimeout(() => { if (isSkillsViewOpen() && !skillsDetailPath) loadSkillsDirectory(); }, 1000);
  } catch (e) {
    if (seq !== skillsSeq || !isSkillsViewOpen()) return;
    body.classList.remove('usage-refreshing');
    body.innerHTML = `<div class="usage-state">Could not load skills: ${escapeHtml(e.message)}</div>`;
  }
}

function renderSkillsHeader(mode, skill) {
  const el = document.getElementById('skillsViewHeader');
  if (!el) return;
  if (mode === 'detail' && skill) {
    const chips = `<span class="chip ${skill.advertised ? 'adv' : ''}">${skill.advertised ? 'advertised' : 'manual only'}</span>` +
      `<span class="chip">${escapeHtml(skill.source)}</span>`;
    el.innerHTML = `
      <a class="skills-back" onclick="backToSkillsDirectory()">‹ Skills</a>
      <h1 class="skills-detail-title">${escapeHtml(skill.name)} ${chips}</h1>
      <div class="skills-header-spacer"></div>
      <button class="btn refine-btn" onclick="startSkillRefine()">✎ Refine with an agent</button>
      <button class="btn-icon" onclick="refreshSkillsView()" title="Refresh">⟳</button>
      <button class="btn-icon" onclick="closeSkillsView()" title="Close (Esc)">✕</button>`;
  } else {
    el.innerHTML = `
      <span class="usage-view-title">Skills</span>
      <span class="skills-scope">${escapeHtml(skillsData?.scope === 'all' ? 'all workspaces' : (skillsData?.scope || 'all workspaces'))}</span>
      <div class="skills-header-spacer"></div>
      <button class="btn-icon" onclick="refreshSkillsView()" title="Refresh">⟳</button>
      <button class="btn-icon" onclick="closeSkillsView()" title="Close (Esc)">✕</button>`;
  }
}

function sortedSkills(d) {
  let list = d.skills.slice();
  const q = skillsFilter.trim().toLowerCase();
  if (q) list = list.filter(s =>
    s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q) ||
    s.filePath.toLowerCase().includes(q));
  const byRecent = (a, b) => (b.usage.lastUsedTs || 0) - (a.usage.lastUsedTs || 0);
  const cmp = {
    recent: byRecent,
    most: (a, b) => b.usage.count30d - a.usage.count30d || byRecent(a, b),
    least: (a, b) => a.usage.count30d - b.usage.count30d || byRecent(a, b),
    largest: (a, b) => b.bodyTokensEst - a.bodyTokensEst || byRecent(a, b),
    name: (a, b) => a.name.localeCompare(b.name),
  }[skillsSort] || byRecent;
  return list.sort(cmp);
}

const STALE_MS = 60 * 86400000;

function renderSkillsDirectory(d) {
  const body = document.getElementById('skillsViewBody');
  body.classList.remove('usage-refreshing');
  const s = d.summary;
  const now = Date.now();
  const sortOpts = [['recent', 'Recently used'], ['most', 'Most used (30d)'], ['least', 'Least used'], ['largest', 'Largest'], ['name', 'Name']]
    .map(([v, l]) => `<option value="${v}"${skillsSort === v ? ' selected' : ''}>${l}</option>`).join('');

  const rows = sortedSkills(d).map(sk => {
    const u = sk.usage;
    const last = u.lastUsedTs ? formatRelativeTime(u.lastUsedTs) : '—';
    const stale = u.lastUsedTs == null || (now - u.lastUsedTs) > STALE_MS;
    const manual = sk.advertised ? '' : '<span class="manual">manual</span>';
    return `<div class="sk-row" data-skill="${escapeHtml(sk.skill)}">
      <div><div class="sk-name">${escapeHtml(sk.name)}${manual}</div><div class="sk-desc">${escapeHtml(sk.description || '')}</div></div>
      <div class="src">${escapeHtml(sk.source)}</div>
      <div class="tok">${fmtTok(sk.bodyTokensEst)}</div>
      ${renderSpark(u.weeks12)}
      <div class="num">${u.count30d}</div>
      <div class="last${stale ? ' stale' : ''}">${escapeHtml(last)}</div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="sk-summary">
      <div class="stat"><b>${s.discovered}</b><span>discovered</span></div>
      <div class="stat"><b>${s.advertised}</b><span>advertised · catalog ~${fmtTok(s.catalogTokensEst)} tok est</span></div>
      <div class="stat"><b>${s.activations30d}</b><span>activations · 30d</span></div>
      <div class="stat"><b>${s.quiet60d}</b><span>quiet &gt; 60d</span></div>
      <span class="badge-inferred" title="Usage is inferred from mined read/bash tool calls, not telemetry">inferred from tool calls</span>
    </div>
    <div class="sk-controls">
      <input id="skillsFilterInput" placeholder="Filter skills…" value="${escapeHtml(skillsFilter)}">
      <select id="skillsSortSelect">${sortOpts}</select>
    </div>
    <div class="sk-list">
      <div class="sk-colhead">
        <div>Skill</div><div>Source</div><div class="num">~Tok est</div><div>12 weeks</div><div class="num">30d</div><div style="text-align:right">Last used</div>
      </div>
      ${rows || '<div class="usage-state">No skills match.</div>'}
    </div>
    <div class="sk-foot">GET /api/skills · GET /api/skills/activations — NDJSON, filters: skill, since, cwd, kind</div>`;

  const filt = document.getElementById('skillsFilterInput');
  filt.addEventListener('input', () => { skillsFilter = filt.value; renderSkillsDirectory(skillsData); });
  // keep focus/caret after the re-render
  filt.focus(); filt.setSelectionRange(filt.value.length, filt.value.length);
  document.getElementById('skillsSortSelect').addEventListener('change', (e) => {
    skillsSort = e.target.value; renderSkillsDirectory(skillsData);
  });
  body.querySelectorAll('.sk-row').forEach(row =>
    row.addEventListener('click', () => openSkillDetail(row.dataset.skill)));
}

async function openSkillDetail(skillPath, { force = false } = {}) {
  const seq = ++skillsSeq;
  skillsDetailPath = skillPath;
  const skill = (skillsData?.skills || []).find(s => s.skill === skillPath);
  renderSkillsHeader('detail', skill);
  const body = document.getElementById('skillsViewBody');
  body.classList.remove('usage-refreshing');
  if (force || !skillsDetail || skillsDetail.skill !== skillPath) {
    body.innerHTML = '<div class="usage-state">Loading coverage…</div>';
  }
  try {
    const r = await apiFetch(null, '/api/skills/coverage?skill=' + encodeURIComponent(skillPath));
    if (!r.ok) throw new Error(await r.json().then(d => d.error, () => null) || `HTTP ${r.status}`);
    const cov = await r.json();
    if (seq !== skillsSeq || !isSkillsViewOpen() || skillsDetailPath !== skillPath) return;
    skillsDetail = cov;
    renderSkillDetail(skill, cov);
  } catch (e) {
    if (seq !== skillsSeq || skillsDetailPath !== skillPath) return;
    body.innerHTML = `<div class="usage-state">Could not load coverage: ${escapeHtml(e.message)}</div>`;
  }
}

function backToSkillsDirectory() {
  skillsDetailPath = null;
  skillsDetail = null;
  renderSkillsHeader('directory');
  if (skillsData) renderSkillsDirectory(skillsData);
  else loadSkillsDirectory();
}

// Line-heat bucket from a line's read count relative to the mapped-read total.
function heatClass(hits, numMapped) {
  if (!hits) return 'h0';
  const r = hits / Math.max(1, numMapped);
  if (r >= 0.75) return 'h12';
  if (r >= 0.4) return 'h9';
  return 'h4';
}

function renderSkillDetail(skill, cov) {
  const body = document.getElementById('skillsViewBody');
  const u = skill?.usage || {};

  // Coverage centrepiece.
  let coverageHtml;
  if (cov.numMapped === 0) {
    coverageHtml = `<div class="cov-cap">No ranged reads recorded since this file was last edited${cov.excludedBeforeMtime ? ` (${cov.excludedBeforeMtime} older read${cov.excludedBeforeMtime === 1 ? '' : 's'} predate it)` : ''}.</div>`;
  } else if (cov.flatFullRead) {
    coverageHtml = `<div class="cov-flat">This skill is short enough that every one of the last
      ${cov.numMapped} read${cov.numMapped === 1 ? '' : 's'} loaded it in full — nothing has been
      skipped, so there is no partial-coverage map to show.</div>`;
  } else {
    const secRows = cov.sections.map((sec, i) => {
      const pct = Math.round(sec.fraction * 100);
      const cold = sec.neverRead ? ' cold' : '';
      const never = sec.neverRead ? '<span class="never">never read</span>' : '';
      const heads = escapeHtml(sec.heading === '(intro)' ? '(intro)' : sec.heading);
      return `<div class="sec-row${cold}" data-sec="${i}">
          <span class="sec-name">${heads} <span class="lines">${sec.startLine}–${sec.endLine}</span>${never}</span>
          <div class="cov-bar">${sec.reads ? `<i style="width:${pct}%"></i>` : ''}</div>
          <span class="sec-frac">${sec.reads}/${cov.numMapped}</span>
        </div>
        <div class="sec-open" id="skSecOpen${i}" style="display:none"></div>`;
    }).join('');
    coverageHtml = `
      <div class="cov-headline"><b>~${fmtTok(cov.unreadTokensEst)} tok</b> (est) never entered context across the last ${cov.numMapped} read${cov.numMapped === 1 ? '' : 's'}</div>
      <div class="cov-cap">${cov.numMapped} ranged read${cov.numMapped === 1 ? '' : 's'} mapped · ${cov.targetedTouches} targeted access${cov.targetedTouches === 1 ? '' : 'es'} (counted as touches, not mapped)${cov.excludedBeforeMtime ? ` · ${cov.excludedBeforeMtime} older read${cov.excludedBeforeMtime === 1 ? '' : 's'} predate this version` : ''}</div>
      ${secRows}
      <div class="d-note">Coverage maps ranged reads against the current file version only —
        activations before the last edit count toward totals but aren't mapped. A short skill
        that's always read in full shows a single line here instead of a map.</div>`;
  }

  const kinds = cov.kindSplit || {};
  const wsLine = u.topCwd
    ? `Used in ${cov.cwdCount || u.cwdCount || 1} workspace${(cov.cwdCount || u.cwdCount || 1) === 1 ? '' : 's'}, mostly <span class="mono">${escapeHtml(shortCwd(cov.topCwd))}</span>`
    : 'No workspace activity recorded yet';
  let latestHtml = '';
  if (cov.latest && cov.latest.sessionId) {
    const label = cov.latest.name || 'session';
    latestHtml = `<div class="latest"><a onclick="openSkillActivation('${escapeHtml(cov.latest.sessionId)}','${escapeHtml(cov.latest.entryId || '')}')">latest activation: ${escapeHtml(label)} →</a>
      <span>${formatRelativeTime(cov.latest.ts)}${cov.latest.model ? ' · ' + escapeHtml(cov.latest.model) : ''}</span></div>`;
  }
  const apiUrl = location.origin + '/api/skills/activations?skill=' + encodeURIComponent(skill ? skill.skill : cov.skill);
  const covUrl = location.origin + '/api/skills/coverage?skill=' + encodeURIComponent(skill ? skill.skill : cov.skill);

  body.innerHTML = `<div class="skills-detail-wrap"><div class="cols">
    <div class="main-col">
      <div class="d-path" data-path="${escapeHtml(cov.skill)}" title="Copy path">${escapeHtml(cov.skill)}</div>
      <div class="d-meta">
        body <b>${fmtBytes(skill ? skill.bodyBytes : 0)}</b> · <b>~${fmtTok(skill ? skill.bodyTokensEst : 0)} tok</b> <span class="badge-inferred">est</span>
        ${skill && skill.advertised ? `&nbsp;·&nbsp; catalog entry <b>~${fmtTok(skill.catalogTokensEst)} tok</b> <span class="badge-inferred">est</span>` : ''}
        &nbsp;·&nbsp; last edited <b>${fmtEditedDate(cov.mtimeMs)}</b>
      </div>
      <div class="d-sec">Read coverage · since last edit <span class="badge-inferred">inferred</span></div>
      ${coverageHtml}
    </div>
    <div class="side-col">
      <div class="d-sec">Activity · 26 weeks <span class="badge-inferred">inferred</span></div>
      ${renderSpark(cov.weeks26, { cls: 'spark-lg', pct: true })}
      <div class="spark-cap"><span>${cov.weeks26.length}w ago</span><span>peak ${Math.max(0, ...cov.weeks26)}/wk</span><span>now</span></div>

      <div class="d-sec">Usage</div>
      <div class="kind-split">
        <div><b>${kinds.read || 0}</b>auto reads</div>
        <div><b>${kinds.explicit || 0}</b>explicit</div>
        <div><b>${cov.sessionCount || 0}</b>sessions</div>
      </div>
      <div class="ws-line">${wsLine}</div>
      ${latestHtml}

      <div class="d-sec">The primitive</div>
      <div class="api-box" data-copy="${escapeHtml(apiUrl)}"><span class="copy-hint">⧉</span><span class="c"># activations, NDJSON</span>
${escapeHtml(apiUrl)}

<span class="c"># current coverage rollup</span>
${escapeHtml(covUrl)}</div>
      <div class="d-note">The ✎ button opens a new session with a drafted prompt carrying this
        evidence (path, stats, cold sections) — the refinement methodology itself is pluggable.</div>
    </div>
  </div></div>`;

  // Path copy.
  body.querySelector('.d-path')?.addEventListener('click', (e) => {
    copyTextToClipboard(e.currentTarget.dataset.path);
    setStatus('Skill path copied');
  });
  body.querySelector('.api-box')?.addEventListener('click', (e) => {
    copyTextToClipboard(e.currentTarget.dataset.copy);
    setStatus('Activations URL copied');
  });
  // Section expand → line-level shading.
  body.querySelectorAll('.sec-row[data-sec]').forEach(row => {
    row.addEventListener('click', () => {
      const i = Number(row.dataset.sec);
      const open = document.getElementById('skSecOpen' + i);
      if (!open) return;
      if (open.style.display !== 'none') { open.style.display = 'none'; open.innerHTML = ''; return; }
      const sec = cov.sections[i];
      open.innerHTML = sec.lines.map(ln =>
        `<div class="ln ${heatClass(ln.hits, cov.numMapped)}"><span class="g"></span><span class="t">${escapeHtml(ln.text || ' ')}</span></div>`).join('');
      open.style.display = '';
    });
  });
}

// The ✎ launcher: prefill the new-session takeover with the skill dir as cwd
// and an evidence-bundle draft. Never auto-sends — the user reviews the draft
// in the composer after the session spawns.
function startSkillRefine() {
  const skill = (skillsData?.skills || []).find(s => s.skill === skillsDetailPath);
  if (!skill || !skillsDetail) return;
  const draft = buildRefineDraft(skill, skillsDetail, skillsRefine || { mode: 'default' });
  const cwd = skill.baseDir || skill.filePath.replace(/\/SKILL\.md$/, '');
  closeSkillsView();
  openNewSessionView({ cwd, draft });
}

function buildRefineDraft(skill, cov, refine) {
  const u = skill.usage || {};
  const lead = [];
  const usesSkillLead = refine.mode === 'skill' || (refine.mode === 'default' && refine.discovered);
  if (usesSkillLead) lead.push('/skill:' + refine.skillName, '');
  const cold = (cov.sections || []).filter(s => s.neverRead).map(s => s.heading);
  const parts = [
    'Help me refine this skill based on how it is actually being used.',
    '',
    'Skill: ' + skill.filePath,
    'Source: ' + skill.source + (skill.advertised ? ' · advertised' : ' · manual only'),
    'Body: ' + fmtBytes(skill.bodyBytes) + ' · ~' + skill.bodyTokensEst + ' tok (est)',
    'Usage (inferred from tool calls): ' + (u.total || 0) + ' activations, ' + (u.count30d || 0) +
      ' in the last 30d, across ' + (u.sessionCount || 0) + ' session(s); last used ' +
      (u.lastUsedTs ? formatRelativeTime(u.lastUsedTs) : 'never'),
    '~' + cov.unreadTokensEst + ' tok (est) never entered context across the last ' + cov.numMapped + ' mapped read(s).',
  ];
  if (cold.length) parts.push('Sections never read since the last edit: ' + cold.join('; '));
  parts.push(
    'Coverage detail: ' + location.origin + '/api/skills/coverage?skill=' + encodeURIComponent(skill.filePath),
    'Raw activations (NDJSON): ' + location.origin + '/api/skills/activations?skill=' + encodeURIComponent(skill.filePath),
    '');
  if (!usesSkillLead) {
    const ref = refine.mdPath || (refine.mode === 'path' ? refine.mdPath : null);
    if (ref) parts.push('Read ' + ref + ' and follow its methodology.');
  }
  parts.push('Note: read-coverage is not the same as adherence — ground-truth any cold section against a recent transcript before trimming it.');
  return lead.join('\n') + parts.join('\n');
}

// "latest activation →": select the session and best-effort scroll to the
// activating entry (the per-message deep-link machinery keys on entry id).
async function openSkillActivation(sessionId, entryId) {
  closeSkillsView();
  if (!sessionState.findSession(sessionId)) await loadSessions(undefined, { withPrevious: true });
  await selectSession(sessionId);
  if (!entryId) return;
  setTimeout(() => {
    const el = document.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`);
    const msg = el && el.closest('.message');
    if (msg) { msg.scrollIntoView({ block: 'center' }); msg.classList.add('search-current'); }
  }, 400);
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
  closeNewSessionView();
  closeSkillsView();
  closeRoutinesView();
  closeRecoveryView();
  closeBounceView();
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
function setUsageStack(stack) {
  if (usageStack === stack) return;
  usageStack = stack;
  localStorage.setItem('pi-dish-usage-stack', stack);
  if (usageData) renderUsageView(usageData);
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

// Subscription limits ride their own fan-out: hosts without the capability
// (older builds, no supporting harness) are skipped, a failed host just
// contributes nothing (quota is supplementary to the spend view), and each
// settle re-renders the view — renderUsageView is idempotent, so the section
// simply appears once data exists.
async function loadUsageLimits(fetchSeq) {
  const stale = () => fetchSeq !== usageFetchSeq || !isUsageViewOpen();
  usageLimitsEntries = []; usageLimitsPending = 0;
  await hostFleetReady;
  if (stale()) return;
  const hosts = fanoutHosts().filter(h => h.capabilities?.usageLimits);
  if (!hosts.length) return;
  usageLimitsPending = hosts.length;
  await Promise.all(hosts.map(async host => {
    try {
      const r = await apiFetch(host, '/api/usage-limits', { timeoutMs: 20000 });
      if (r.status === 401) { noteHostBlocked(host); throw new Error('needs a token'); }
      if (!r.ok) throw new Error(await r.json().then(d => d.error, () => null) || `HTTP ${r.status}`);
      const payload = await r.json();
      if (payload.harnesses?.length) {
        usageLimitsEntries = [...usageLimitsEntries,
          { hostLabel: hostDisplayLabel(host), payload }]
          .sort((a, b) => a.hostLabel.localeCompare(b.hostLabel));
      }
    } catch { /* supplementary: an unreachable host just has no limits rows */ }
    usageLimitsPending--;
    if (!stale() && usageData) renderUsageView(usageData);
  }));
}

async function loadUsageView() {
  const fetchSeq = ++usageFetchSeq;
  loadUsageLimits(fetchSeq); // parallel; fills the limits section as hosts settle
  const requestedRange = usageRange, requestedSort = usageSort, requestedModels = usageModelsKey();
  const stale = () => fetchSeq !== usageFetchSeq || requestedRange !== usageRange ||
    requestedSort !== usageSort || requestedModels !== usageModelsKey() || !isUsageViewOpen();
  const body = document.getElementById('usageViewBody');
  // Refetch keeps the frame: dim the previous render instead of blanking it.
  if (body.childElementCount) body.classList.add('usage-refreshing');
  else body.innerHTML = '<div class="usage-state">Loading estimated usage…</div>';
  try {
    await hostFleetReady;
    if (stale()) return;
    const url = '/api/usage-summary?days=' + requestedRange + '&sort=' + requestedSort +
      (requestedModels ? '&models=' + encodeURIComponent(requestedModels) : '');
    // Fan out and merge client-side (mergeUsageSummaries): each host owns its
    // own index and prices from its own model catalog, and there is
    // deliberately no hub-side merged endpoint. Near-simultaneous answers
    // are coalesced so a healthy fleet's first paint is already complete;
    // genuinely slow hosts still produce a progressive partial render and
    // stay named in its notice. On one host the first settle is final.
    const hosts = fanoutHosts();
    const status = hosts.map(() => 'pending');
    const entries = new Array(hosts.length);
    const reasons = new Array(hosts.length);
    let rendered = null;
    const render = () => {
      if (stale()) return;
      const ok = entries.filter((entry, i) => status[i] === 'ok' && entry);
      if (!ok.length) return;
      usageHostErrors = hosts.filter((_, i) => status[i] === 'error').map(hostDisplayLabel);
      usageHostPending = hosts.filter((_, i) => status[i] === 'pending').map(hostDisplayLabel);
      const d = mergeUsageSummaries(ok);
      usageData = d;
      rendered = d;
      renderUsageView(d);
    };
    // A hub's healthy same-origin proxy responses usually land a few
    // milliseconds apart. Debounce those into one complete first paint
    // without making an actually slow peer hold the useful partial view.
    const queueRender = createFanoutRenderQueue(status, render);
    await Promise.all(hosts.map(async (host, i) => {
      try {
        const r = await apiFetch(host, url, { timeoutMs: 20000 });
        if (r.status === 401) { noteHostBlocked(host); throw new Error('needs a token'); }
        // A stale server (or proxy) answers with an HTML error page — surface the
        // status instead of a JSON parse error.
        if (!r.ok) throw new Error(await r.json().then(d => d.error, () => null) || `HTTP ${r.status}`);
        const summary = await r.json();
        entries[i] = { hostId: host.hostId || null, hostLabel: hostDisplayLabel(host), summary };
        status[i] = 'ok';
        noteHostReachable(host);
      } catch (e) {
        status[i] = 'error';
        reasons[i] = e;
        if (!host.self) noteHostFailure(host, e);
      }
      queueRender();
    }));
    if (!status.some(s => s === 'ok')) throw reasons.find(Boolean) || new Error('no hosts answered');
    if (stale() || !rendered) return;
    if (rendered.indexing) usageTimer = setTimeout(() => { if (isUsageViewOpen()) loadUsageView(); }, 1000);
  } catch (e) {
    if (stale()) return;
    body.classList.remove('usage-refreshing');
    body.innerHTML = `<div class="usage-state">Could not load usage: ${escapeHtml(e.message)}</div>`;
  }
}

function usageMetricValue(bucket, metric) {
  if (metric === 'cost') return Number.isFinite(bucket.costs?.total) ? bucket.costs.total : 0;
  if (metric === 'tokens') return usageTokensTotal(bucket.tokens);
  return bucket.calls || 0;
}
const USAGE_METRIC_LABELS = { cost: 'Estimated spend', tokens: 'Tokens', calls: 'Calls' };
// Cost attribution buckets, in legend/stack order: prompt-side reads split
// into uncached input and cached reads, then generation and cache writes.
const USAGE_COST_BUCKETS = [
  ['input', 'Read', 'c1'],
  ['cacheRead', 'Cached read', 'c2'],
  ['output', 'Output', 'c3'],
  ['cacheWrite', 'Cache write', 'c4'],
];
// Compact per-bucket cost list for titles and detail rows; null when nothing
// is priced so callers can fall back to the total-only display.
function usageCostBreakdown(costs) {
  if (!costs || !Number.isFinite(costs.total)) return null;
  const parts = USAGE_COST_BUCKETS.map(([key, label]) => `${label} ${formatEstimatedCost(costs[key])}`);
  const unattributed = usageUnattributedCost(costs);
  if (unattributed > 1e-12) parts.push(`Unattributed ${formatEstimatedCost(unattributed)}`);
  return parts.join(' · ');
}
function usageModelValue(m, metric) {
  if (metric === 'cost') return Number.isFinite(m.cost) ? m.cost : 0;
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
  const hu = d.headlineCostUnavailable || {};
  const budget = d.monthlyBudgetUsd;

  const hbb = d.headlineCostsByBucket || {};
  const kpis = [['Today', 'today'], ['Last 7 days', 'days7'], ['Last 30 days', 'days30'], ['This month', 'month']]
    .map(([label, key]) => {
      // Hover pivots the window's spend into its four cost buckets.
      const title = [usageCostBreakdown(hbb[key]),
        hu[key] ? `${hu[key]} unpriced calls are omitted from this estimate` : null].filter(Boolean).join('\n');
      return `<div class="usage-kpi"${title ? ` title="${escapeHtml(title)}"` : ''}><small>${label}</small><strong>${formatUsageCost(h[key], hu[key])}</strong></div>`;
    }).join('');

  let budgetHtml = '';
  if (budget) {
    if (Number.isFinite(h.month)) {
      const pct = Math.min(100, h.month / budget * 100);
      const cls = pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '';
      const partial = hu.month ? ` · ${hu.month} unpriced calls omitted` : '';
      budgetHtml = `<div class="usage-budget${cls}"><div class="usage-budget-track"><div class="usage-budget-fill" style="width:${pct.toFixed(1)}%"></div></div><small>${formatUsageCost(h.month, hu.month)} of ~$${Number(budget).toFixed(2)} monthly budget${partial}${pct >= 100 ? ' — over budget' : ''}</small></div>`;
    }
    else {
      budgetHtml = `<div class="usage-budget"><small>Budget tracking unavailable${hu.month ? ` — ${hu.month} calls have unavailable pricing` : ''}.</small></div>`;
    }
  }

  const summary = `<div class="usage-total-line"><strong>${formatUsageCost(t.costs?.total, t.costUnavailable?.total)}</strong> · ${t.calls || 0} calls · ${formatTokens(usageTokensTotal(t.tokens))} tokens in ${USAGE_RANGE_LABELS[d.range] || 'the selected range'}</div>` +
    `<div class="usage-token-line">${formatTokens(t.tokens?.input)} in · ${formatTokens(t.tokens?.output)} out · cache ${formatCacheStat(t.tokens?.cacheRead, t.tokens?.cacheWrite, t.tokens?.input)}</div>`;
  const filterNote = usageModelFilter.size
    ? `<div class="usage-filter-note">Filtered to ${[...usageModelFilter].map(r => `<b title="${escapeHtml(r)}">${escapeHtml(shortModelName(r))}</b>`).join(', ')}<button class="usage-range-btn" data-clear-models>✕ clear</button></div>`
    : '';

  // One metric drives the whole view — chart, tooltip, day detail, and the
  // breakdown bars all plot it: tokens when that toggle is chosen, else
  // spend, else calls when nothing in range carries a cost.
  const metric = usageSort === 'tokens' ? 'tokens' : Number.isFinite(t.costs?.total) && t.costs.total > 0 ? 'cost' : 'calls';
  const ranges = USAGE_RANGES
    .map(([v, l]) => `<button class="usage-range-btn${usageRange === v ? ' active' : ''}" data-range="${v}">${l}</button>`).join('');
  const sortCtl = `<span class="usage-sort"><small>Show</small>${[['cost', 'Cost'], ['tokens', 'Tokens']]
    .map(([v, l]) => `<button class="usage-range-btn${usageSort === v ? ' active' : ''}" data-sort="${v}">${l}</button>`).join('')}</span>`;
  // Chart model: series slots follow the range's top *active* models (server
  // sort order; the model filter narrows the palette to the selected refs) so
  // the chart, its legend, and the model-share section all agree on colors.
  const activeModels = (d.groups?.models || []).filter(m => !usageModelFilter.size || usageModelFilter.has(m.key));
  const daily = d.daily || [];
  const buckets = daily.length > 90 ? aggregateUsageWeekly(daily) : daily;
  const seriesRefs = activeModels.slice(0, 5).map(m => m.key);
  usageChart = { buckets, seriesRefs, metric, activeModelCount: activeModels.length, stack: metric === 'cost' ? usageStack : 'models' };
  const showChart = d.range !== '1' && buckets.length > 1 && (t.calls || 0) > 0;
  // The stack pivot only exists when the chart plots spend: bucket stacking
  // of a token/call chart would be a second, different metric.
  const stackCtl = showChart && metric === 'cost'
    ? `<span class="usage-sort"><small>Stack</small>${[['models', 'Models'], ['buckets', 'Cost buckets']]
      .map(([v, l]) => `<button class="usage-range-btn${usageChart.stack === v ? ' active' : ''}" data-stack="${v}">${l}</button>`).join('')}</span>`
    : '';
  const chartSection = showChart
    ? `<section class="usage-section"><h4>${USAGE_METRIC_LABELS[metric]} per ${buckets === daily ? 'day' : 'week'}</h4><div class="usage-chart" id="usageChart"></div></section>`
    : '';
  if (d.range === '1' && daily.length) usageSelectedDay = daily[daily.length - 1].day;

  body.innerHTML = `
    <div class="usage-kpis">${kpis}</div>
    ${budgetHtml}
    ${d.indexing ? '<div class="usage-notice">History is indexing; totals will refresh…</div>' : ''}
    ${usageHostErrors.length ? `<div class="usage-notice">Not counted: ${escapeHtml(usageHostErrors.join(', '))} did not answer.</div>` : ''}
    ${usageHostPending.length ? `<div class="usage-notice">Still counting ${escapeHtml(usageHostPending.join(', '))}…</div>` : ''}
    <div class="usage-ranges">${ranges}${sortCtl}${stackCtl}</div>
    ${(t.calls || 0) === 0 ? '<div class="usage-state">No usage in this range.</div>' : summary}
    ${filterNote}
    ${usageBucketShareHtml(t)}
    ${chartSection}
    <div id="usageDayDetail"></div>
    ${usageModelShareHtml(d, metric, seriesRefs)}
    <div class="usage-columns">
      ${usageGroupListHtml('Workspaces', d.groups?.workspaces, 'workspace', metric)}
      ${usageGroupListHtml('Sessions', d.groups?.sessions, 'session', metric)}
    </div>
    ${d.unpricedModelCalls ? `<div class="usage-notice">* Known priced usage only; ${d.unpricedModelCalls} call${d.unpricedModelCalls === 1 ? '' : 's'} ${d.unpricedModelCalls === 1 ? 'has' : 'have'} unavailable pricing and ${d.unpricedModelCalls === 1 ? 'is' : 'are'} omitted.</div>` : ''}
    ${usageLimitsHtml(usageLimitsEntries)}
  `;
  body.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => setUsageRange(b.dataset.range)));
  body.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => setUsageSort(b.dataset.sort)));
  body.querySelectorAll('[data-stack]').forEach(b => b.addEventListener('click', () => setUsageStack(b.dataset.stack)));
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
    selectSession(row.dataset.sessionId, { host: row.dataset.sessionHost || null });
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
  const stackBuckets = usageChart.stack === 'buckets';
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
    const segs = [];
    if (stackBuckets) {
      USAGE_COST_BUCKETS.forEach(([key, , cls]) => {
        const v = Number.isFinite(b.costs?.[key]) ? b.costs[key] : 0;
        if (v > 0) segs.push({ cls, v });
      });
      // Older recordings can carry a known total with no component split.
      // Keep that spend visible instead of drawing a mysteriously short bar.
      const unattributed = usageUnattributedCost(b.costs);
      if (unattributed > 1e-12) {
        segs.push({ cls: 'sother', v: unattributed });
        anyOther = true;
      }
    } else {
      const byRef = new Map((b.models || []).map(m => [m.ref, m]));
      let known = 0;
      seriesRefs.forEach((ref, s) => {
        const v = byRef.has(ref) ? usageModelValue(byRef.get(ref), metric) : 0;
        known += v;
        if (v > 0) segs.push({ cls: 's' + (s + 1), v });
      });
      const other = Math.max(0, total - known);
      if (other > 0) { segs.push({ cls: 'sother', v: other }); anyOther = true; }
    }

    const x = margin.left + band * i + (band - barW) / 2;
    const label = (b.days > 1 ? `Week of ${formatUsageDay(b.day)}` : formatUsageDay(b.day, 'long')) + ': ' +
      (metric === 'cost' ? formatUsageCost(b.costs?.total, b.costUnavailable?.total)
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

  const legendItems = stackBuckets
    ? USAGE_COST_BUCKETS.map(([, label, cls]) => `<span class="usage-legend-item"><i class="swatch ${cls}"></i>${escapeHtml(label)}</span>`)
    : seriesRefs.map((ref, i) =>
      `<span class="usage-legend-item" title="${escapeHtml(ref)}"><i class="swatch s${i + 1}"></i>${escapeHtml(shortModelName(ref))}</span>`);
  if (stackBuckets && anyOther)
    legendItems.push('<span class="usage-legend-item"><i class="swatch sother"></i>Unattributed</span>');
  else if (!stackBuckets && (anyOther || (usageChart.activeModelCount || 0) > seriesRefs.length))
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
    ['Estimated spend', formatUsageCost(bucket.costs?.total, bucket.costUnavailable?.total)],
    ['Calls', String(bucket.calls || 0)],
    ['Tokens in / out', `${formatTokens(tok.input)} / ${formatTokens(tok.output)}`],
    ['Cache', formatCacheStat(tok.cacheRead, tok.cacheWrite, tok.input)],
    // Per-bucket spend keeps the day detail pivoted like the range totals.
    ...(Number.isFinite(bucket.costs?.total)
      ? [
          ...USAGE_COST_BUCKETS.map(([key, label]) => [label, formatEstimatedCost(bucket.costs[key])]),
          ...(usageUnattributedCost(bucket.costs) > 1e-12
            ? [['Unattributed', formatEstimatedCost(usageUnattributedCost(bucket.costs))]] : []),
        ]
      : []),
  ].map(([k, v]) => `<div><small>${k}</small><strong>${v}</strong></div>`).join('');
  const slotFor = ref => {
    const i = (usageChart?.seriesRefs || []).indexOf(ref);
    return i >= 0 ? 's' + (i + 1) : 'sother';
  };
  const rows = (bucket.models || []).map(m => {
    const meta = [`${m.calls} calls`, `${formatTokens(usageTokensTotal(m.tokens))} tok`];
    if (usageTokensTotal(m.tokens) > 0) meta.push(usageTokensDetail(m.tokens));
    if (metric === 'cost') meta.push(formatUsageCost(m.cost, m.costUnavailable?.total));
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

// Part-to-whole share of the range total across the four cost buckets: one
// stacked bar plus per-bucket amounts, so every cost view answers "where did
// the spend go" (read vs cached read vs output vs cache write) without a
// hover. Follows the model filter through `totals`; unpriced calls stay out
// of the bar and are named in the heading, like the total line's `*`.
function usageBucketShareHtml(t) {
  if (!Number.isFinite(t.costs?.total) || t.costs.total <= 0) return '';
  const total = t.costs.total, unpriced = t.costUnavailable?.total || 0;
  const segs = [], legend = [];
  for (const [key, label, cls] of USAGE_COST_BUCKETS) {
    const v = Number.isFinite(t.costs[key]) ? t.costs[key] : 0;
    const share = v / total;
    if (share > 0.004) segs.push(`<span class="${cls}" style="flex-grow:${(share * 1000).toFixed(1)}" title="${escapeHtml(label)}"></span>`);
    legend.push(`<span class="usage-legend-item"><i class="swatch ${cls}"></i>${escapeHtml(label)} <b>${formatEstimatedCost(v)}</b> <small>${Math.round(share * 100)}%</small></span>`);
  }
  const unattributed = usageUnattributedCost(t.costs);
  if (unattributed > 1e-12) {
    const share = unattributed / total;
    if (share > 0.004) segs.push(`<span class="sother" style="flex-grow:${(share * 1000).toFixed(1)}" title="Unattributed"></span>`);
    legend.push(`<span class="usage-legend-item"><i class="swatch sother"></i>Unattributed <b>${formatEstimatedCost(unattributed)}</b> <small>${Math.round(share * 100)}%</small></span>`);
  }
  return `<section class="usage-section"><h4>Spend by bucket${unpriced ? ` <small class="usage-hint">${unpriced} unpriced call${unpriced === 1 ? '' : 's'} omitted</small>` : ''}</h4>
    <div class="usage-share-bar">${segs.join('')}</div>
    <div class="usage-legend">${legend.join('')}</div></section>`;
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
    const spend = `${formatUsageCost(m.costs?.total, m.unpricedCalls)}${m.unpricedCalls ? ` · ${m.unpricedCalls} unpriced` : ''}`;
    const detail = usageTokensTotal(m.tokens) > 0 ? ` · ${usageTokensDetail(m.tokens)}` : '';
    const breakdown = usageCostBreakdown(m.costs);
    return `<div class="usage-row model-toggle${filtered ? (on ? ' on' : ' off') : ''}" data-model-ref="${escapeHtml(m.key)}" role="button" tabindex="0" aria-pressed="${on}" title="${escapeHtml([m.key, breakdown].filter(Boolean).join('\n'))} — click to toggle model filter">
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
    const spend = `${formatUsageCost(x.costs?.total, x.unpricedCalls)}${x.unpricedCalls ? ` · ${x.unpricedCalls} unpriced` : ''}`;
    const attrs = kind === 'session'
      ? ` data-session-id="${escapeHtml(x.id)}"${x.host ? ` data-session-host="${escapeHtml(x.host)}"` : ''} role="button" tabindex="0"`
      : '';
    // Merged rows keep their host: the same path (or session id) on two
    // machines is two different rows.
    const hostTag = isMultiHost() && x.hostLabel ? `<small class="usage-row-host">${escapeHtml(x.hostLabel)}</small>` : '';
    const detail = usageTokensTotal(x.tokens) > 0 ? ` · ${usageTokensDetail(x.tokens)}` : '';
    const breakdown = usageCostBreakdown(x.costs);
    return `<div class="usage-row usage-bar-row${kind === 'session' ? ' clickable' : ''}"${attrs} title="${escapeHtml([x.key || x.name || x.id, breakdown].filter(Boolean).join('\n'))}">
      <span class="usage-row-name">${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}${hostTag}</span>
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
  total.textContent = metric === 'cost' ? `${formatUsageCost(bucket.costs?.total, bucket.costUnavailable?.total)} · ${bucket.calls || 0} calls`
    : metric === 'tokens' ? `${formatTokens(usageTokensTotal(bucket.tokens))} tokens · ${bucket.calls || 0} calls`
    : `${bucket.calls} calls`;
  el.append(head, total);
  const rows = [];
  if (usageChart?.stack === 'buckets' && metric === 'cost') {
    USAGE_COST_BUCKETS.forEach(([key, label, cls]) => {
      rows.push([cls, label, Number.isFinite(bucket.costs?.[key]) ? bucket.costs[key] : 0]);
    });
    const unattributed = usageUnattributedCost(bucket.costs);
    if (unattributed > 1e-12) rows.push(['sother', 'Unattributed', unattributed]);
  } else {
    const seriesRefs = usageChart?.seriesRefs || [];
    const byRef = new Map((bucket.models || []).map(m => [m.ref, m]));
    seriesRefs.forEach((ref, i) => {
      const m = byRef.get(ref);
      if (m) rows.push(['s' + (i + 1), shortModelName(ref), usageModelValue(m, metric)]);
    });
    let otherV = 0, extra = 0;
    for (const m of bucket.models || []) {
      if (!seriesRefs.includes(m.ref)) { otherV += usageModelValue(m, metric); extra++; }
    }
    if (extra) rows.push(['sother', `other (${extra} model${extra > 1 ? 's' : ''})`, otherV]);
  }
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


// --- Session stats modal ---
let statsModalGeneration = 0;
let statsModalOwner = null;

function ownsStatsModal(owner, generation) {
  return statsModalOwner === owner && sessionState.ownsSelection(owner) && statsModalGeneration === generation &&
    document.getElementById('statsModal').style.display !== 'none';
}

function openStatsModal() {
  if (!sessionState.currentSession) return;
  const owner = sessionState.captureSelection();
  const sessionId = owner.id;
  // Resolved now, while the selection is certainly this session — the stats
  // response lands a round-trip later.
  const ref = sessionRefFor(sessionState.currentSession);
  const generation = ++statsModalGeneration;
  statsModalOwner = owner;
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
      const copyOwner = statsModalOwner;
      const copyGeneration = statsModalGeneration;
      copyTextToClipboard(btn.dataset.copy || '').then(
        () => {
          if (!ownsStatsModal(copyOwner, copyGeneration)) return;
          const orig = btn.textContent;
          btn.classList.add('copied');
          btn.textContent = 'Copied ✓';
          setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1200);
        },
        () => { if (ownsStatsModal(copyOwner, copyGeneration)) setStatus('Copy failed (clipboard blocked)', 'error'); },
      );
    });
  }
  apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/stats`)
    .then(r => r.json())
    .then(s => {
      if (!ownsStatsModal(owner, generation)) return;
      if (s.error) { body.textContent = s.error; return; }
      const cu = s.contextUsage || {};
      // Session-wide effective speed: output tokens over the summed
      // per-message response time (only messages with measurable timing).
      const avgSpeed = formatTokSpeed(s.genOutput, s.genMs);
      // [key, value, copyable?] — copyable rows render the value as a
      // click-to-copy button (paths, handy for jumping to the file in a shell).
      const rows = [
        ['__section', 'Summary'],
        // The pasteable handle for this session, click-to-copy like the paths
        // below it — the modal-side twin of the sidebar row's context menu.
        ['Ref', ref, !!ref],
        ['Model', s.model || '—'],
        ['Thinking', s.thinkingLevel || '—'],
        ['Context', (cu.tokens != null ? formatTokens(cu.tokens) : '—') +
          ' / ' + (cu.contextWindow ? formatTokens(cu.contextWindow) : '—') +
          (cu.percent != null ? ` (${Math.round(cu.percent * 10) / 10}%)` : '')],
        ['Messages', `${s.userMessages} user · ${s.assistantMessages} assistant · ${s.toolCalls} tool calls`],
        // Always shown, including zero: how often the context was rebuilt is
        // read together with the Context row above it.
        ['Compactions', String(s.compactions ?? 0)],
        ['__section', 'Performance'],
        s.responseTiming?.medianMs ? ['Response time', `${formatDuration(s.responseTiming.medianMs)} median · ${formatDuration(s.responseTiming.slowestMs)} slowest`] : null,
        avgSpeed ? ['Effective speed', `${avgSpeed} avg · ${formatDuration(s.genMs)} measured response time`] : null,
        ['__section', 'Tokens & cache'],
        ['Tokens in / out', `${formatTokens(s.tokens?.input)} / ${formatTokens(s.tokens?.output)}`],
        s.reasoningTokens ? ['Reasoning', formatTokens(s.reasoningTokens)] : null,
        ['Cache', formatCacheStat(s.tokens?.cacheRead, s.tokens?.cacheWrite, s.tokens?.input)],
        ['__section', 'Estimated spend'],
        ['Estimated total', formatUsageCost(s.costs?.total ?? s.cost, s.costUnavailable?.total)],
        ['Components', `input ${formatUsageCost(s.costs?.input, s.costUnavailable?.input)} · output ${formatUsageCost(s.costs?.output, s.costUnavailable?.output)} · cache read ${formatUsageCost(s.costs?.cacheRead, s.costUnavailable?.cacheRead)} · write ${formatUsageCost(s.costs?.cacheWrite, s.costUnavailable?.cacheWrite)}`],
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
      }).join('') + '</table><div class="telemetry-note">Spend is estimated from the session harness catalog, not provider-billed. Response time is request start → JSONL append; effective speed includes TTFT.</div>' +
        '<div class="stats-share" id="statsShare"></div>' +
        '<div class="stats-share" id="statsPages"></div>' +
        '<div class="stats-share" id="statsClose"></div>';
      loadShareSection(owner, generation);
      loadPagesSection(owner, generation);
      renderCloseSection(owner, generation);
    })
    .catch(e => {
      if (ownsStatsModal(owner, generation)) body.textContent = 'Failed to load stats: ' + e.message;
    });
}

// Public share link section of the stats modal. Fetches current state (404 =
// no share) and renders either a "Create share link" button or the existing
// link as a click-to-copy row plus a Revoke button.
function loadShareSection(owner, generation) {
  if (!ownsStatsModal(owner, generation)) return;
  const sessionId = owner.id;
  const el = document.getElementById('statsShare');
  if (!el) return;
  const session = sessionState.findSession(sessionId, owner.host);
  if (!sessionSupports(session, 'export')) { el.remove(); return; }
  el.innerHTML = '<div class="stats-share-title">Public share link</div>' +
    '<div class="stats-share-body">Loading…</div>';
  apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/share`)
    .then(r => (r.status === 404 ? null : r.json()))
    .then(share => renderShareSection(owner, share, generation))
    .catch(() => renderShareSection(owner, null, generation));
}

function renderShareSection(owner, share, generation) {
  if (!ownsStatsModal(owner, generation)) return;
  const sessionId = owner.id;
  const el = document.getElementById('statsShare');
  if (!el) return;
  const bodyEl = el.querySelector('.stats-share-body') || el;
  if (!share) {
    bodyEl.innerHTML =
      '<button type="button" class="btn-small" id="shareCreateBtn">Create share link</button>' +
      '<div class="stats-share-hint">Anyone with the link can view this session read-only.</div>';
    bodyEl.querySelector('#shareCreateBtn').addEventListener('click', () => {
      if (!ownsStatsModal(owner, generation)) return;
      apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/share`, { method: 'POST' })
        .then(r => r.json())
        .then(s => {
          if (!ownsStatsModal(owner, generation)) return;
          renderShareSection(owner, s, generation);
          refreshArtifacts(owner);
        })
        .catch(e => {
          if (ownsStatsModal(owner, generation)) setStatus('Failed to create share: ' + e.message, 'error');
        });
    });
    return;
  }
  const link = share.url || (location.origin + share.path);
  bodyEl.innerHTML =
    `<button type="button" class="stats-copy stats-share-link" data-copy="${escapeHtml(link)}" title="Click to copy">${escapeHtml(link)}</button>` +
    '<button type="button" class="btn-small btn-danger" id="shareRevokeBtn">Revoke</button>';
  bodyEl.querySelector('#shareRevokeBtn').addEventListener('click', () => {
    if (!ownsStatsModal(owner, generation)) return;
    apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/share`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => {
        if (!ownsStatsModal(owner, generation)) return;
        renderShareSection(owner, null, generation);
        refreshArtifacts(owner);
      })
      .catch(e => {
        if (ownsStatsModal(owner, generation)) setStatus('Failed to revoke share: ' + e.message, 'error');
      });
  });
}

// The hover 🔗 in a turn header: copy the session's public share URL deep
// linked to that message (?targetId=<entry id> — pi's export HTML scrolls
// there on load). Reuses the existing share; if none exists yet, creating
// one publishes the whole session, so that asks first.
async function copyMessageShareLink(btn) {
  if (!sessionState.currentSession) return;
  const entryId = btn.dataset.entryId;
  if (!entryId) return;
  const owner = sessionState.captureSelection();
  const sessionId = owner.id;
  try {
    let res = await apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/share`);
    let share = res.status === 404 ? null : await res.json();
    if (!share || share.error) {
      if (!sessionState.ownsSelection(owner)) return;
      if (!confirm('No share link exists for this session yet — create one? Anyone with the link can view the whole session read-only.')) return;
      res = await apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/share`, { method: 'POST' });
      share = await res.json();
      if (!res.ok) throw new Error(share.error || `HTTP ${res.status}`);
      refreshArtifacts(owner);
    }
    const base = share.url || (location.origin + share.path);
    await copyTextToClipboard(`${base}?targetId=${encodeURIComponent(entryId)}`);
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1200);
    if (sessionState.ownsSelection(owner)) setStatus('Message share link copied');
  } catch (e) {
    if (sessionState.ownsSelection(owner)) setStatus('Share link failed: ' + e.message, 'error');
  }
}

// Shared post-close handling (stats-modal close and the sidebar row ✕):
// re-fetch both lists (the session just moved from active to previous) and,
// when it was the selected session, re-select so the view flips to its
// inactive state (resume bar).
async function finishSessionClose(sessionId, host, owner) {
  if (!owner || sessionState.ownsSelection(owner)) setStatus('Session closed');
  await loadSessions(undefined, { withPrevious: true });
  if (sessionState.ownsSelection(owner) && owner.id === sessionId && owner.host === (host || null)) {
    await selectSession(sessionId, { host });
  }
}

// Session-process controls in the stats modal. Restart is advertised only for
// a pi-dish-owned tmux pane or RPC child; the server replaces that exact
// placement so startup-only CLI code/settings refresh without creating a new
// tmux session or window.
function renderCloseSection(owner, generation) {
  if (!ownsStatsModal(owner, generation)) return;
  const sessionId = owner.id;
  const el = document.getElementById('statsClose');
  if (!el) return;
  const session = sessionState.findSession(sessionId, owner.host);
  if (!session?.isActive || !sessionSupports(session, 'close')) { el.remove(); return; }
  const host = owner.host;
  const detach = session.closeMode === 'client-only'; // Older fleet hosts still only detach Prime clients.
  const ownedAgent = session.closeMode === 'owned-agent';
  const restartable = session.capabilities?.restart === true;
  el.innerHTML = '<div class="stats-share-title">Session process</div>' +
    '<div class="stats-share-body">' +
    (restartable ? '<button type="button" class="btn-small" id="sessionRestartBtn">Restart agent</button>' : '') +
    `<button type="button" class="btn-small btn-danger" id="sessionCloseBtn">${detach ? 'Detach client' : 'Close session'}</button>` +
    `<div class="stats-share-hint">${detach
      ? 'Disconnects this client. The logical agent continues independently.'
      : ownedAgent
        ? (restartable
          ? 'Restart stops this agent and its children, then resumes the root in the same pane. Close also removes the client pane. The transcript is kept; other root agents keep running.'
          : 'Stops this agent and its children, then closes its pi-dish-owned client pane. The transcript stays resumable.')
        : restartable
        ? 'Restarts the agent in its current pi-dish-owned pane or RPC slot. The transcript is kept.'
        : 'Shuts down this agent process. The transcript is kept and can be resumed.'}</div>` +
    '</div>';

  const closeBtn = el.querySelector('#sessionCloseBtn');
  closeBtn.addEventListener('click', async () => {
    if (!ownsStatsModal(owner, generation)) return;
    const warn = detach
      ? 'Detach this client? The logical agent will continue independently.'
      : ownedAgent
        ? 'Stop this agent and its children? Any work in progress will be aborted; the transcript stays resumable.'
        : sessionState.findSession(sessionId, host)?.turnInProgress
        ? 'A turn is in progress — closing will abort it. Close this session?'
        : 'Close this session? The agent process will shut down (the transcript stays resumable).';
    if (!confirm(warn)) return;
    closeBtn.disabled = true;
    closeBtn.textContent = detach ? 'Detaching…' : 'Closing…';
    try {
      await apiSend(host, `/api/sessions/${encodeURIComponent(sessionId)}/close`);
      if (!ownsStatsModal(owner, generation)) return;
      closeStatsModal();
      await finishSessionClose(sessionId, host, owner);
    } catch (e) {
      if (!ownsStatsModal(owner, generation)) return;
      closeBtn.disabled = false;
      closeBtn.textContent = detach ? 'Detach client' : 'Close session';
      setStatus('Close failed: ' + e.message, 'error');
    }
  });

  const restartBtn = el.querySelector('#sessionRestartBtn');
  if (!restartBtn) return;
  restartBtn.addEventListener('click', async () => {
    if (!ownsStatsModal(owner, generation)) return;
    const active = sessionState.findSession(sessionId, host);
    const warn = ownedAgent
      ? 'Restart this agent? This stops the root and its children, aborting any work in progress, then resumes the root in the same pane. The transcript is kept; other root agents keep running.'
      : active?.turnInProgress
      ? 'A turn is in progress — restarting will abort it. Restart this agent?'
      : 'Restart this agent? The current process will stop, then the session will resume with updated CLI code and startup settings.';
    if (!confirm(warn)) return;

    closeBtn.disabled = true;
    restartBtn.disabled = true;
    restartBtn.textContent = 'Restarting…';
    setStatus('Restarting agent…', 'working');
    try {
      const data = await apiSend(host, `/api/sessions/${encodeURIComponent(sessionId)}/restart`);
      if (ownsStatsModal(owner, generation)) closeStatsModal();
      if (sessionState.ownsSelection(owner)) setStatus('Agent restarted');
      await refreshSessions();
      if (sessionState.ownsSelection(owner)) {
        selectSession(data.id, { host });
      }
    } catch (e) {
      if (ownsStatsModal(owner, generation)) closeStatsModal();
      await loadSessions(undefined, { withPrevious: true });
      if (sessionState.ownsSelection(owner)) {
        selectSession(sessionId, { host });
        setStatus('Restart failed: ' + e.message, 'error');
      }
    }
  });
}

function closeStatsModal() {
  statsModalGeneration += 1;
  statsModalOwner = null;
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
let fileViewSessionId = null;
let fileViewGeneration = 0;
let fileViewOwner = null;
let anchoredCommentDraft = null;
let commentOwner = null;
let commentAnchorRange = null;
let commentDraftVersion = 0;
let anchoredComments = [];        // open comments anchored in the open view
let commentEditTarget = null;     // non-null while the bubble edits an existing comment
let commentDeleteArmed = false;
let commentDeleteTimer = null;

function isFileViewOpen() {
  return document.getElementById('sessionView').classList.contains('file-open');
}

function ownsFileView(sessionId, generation) {
  return fileViewSessionId === sessionId && fileViewGeneration === generation &&
    sessionState.ownsSelection(fileViewOwner) && isFileViewOpen();
}

async function openFileViewer(mention) {
  if (!sessionState.currentSession) return;
  const owner = sessionState.captureSelection();
  const sessionId = owner.id;
  const generation = ++fileViewGeneration;
  fileViewSessionId = sessionId;
  fileViewOwner = owner;
  const body = document.getElementById('fileViewBody');
  const title = document.getElementById('fileViewTitle');
  const pathEl = document.getElementById('fileViewPath');
  fileViewRaw = null;
  fileViewAbsPath = null;
  fileViewRelPath = null;
  closeCommentBubble();
  document.getElementById('fileViewPublish').style.display = 'none';
  const rawLink = document.getElementById('fileViewRaw');
  rawLink.style.display = 'none';
  rawLink.removeAttribute('href');
  renderFilePageRow(null);
  title.textContent = mention.replace(/:\d+(?::\d+)?$/, '').split('/').pop();
  pathEl.textContent = '';
  pathEl.title = '';
  body.innerHTML = '<div class="loading">Loading…</div>';
  closeDiffView(); // the two takeover panes are mutually exclusive
  document.getElementById('sessionView').classList.add('file-open');
  try {
    const res = await apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(mention)}`);
    const data = await res.json();
    if (!ownsFileView(sessionId, generation)) return;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    title.textContent = data.path.split('/').pop();
    fileViewAbsPath = data.path;
    fileViewRelPath = data.relPath;
    rawLink.href = hostAssetUrl(owner.host,
      `/api/sessions/${encodeURIComponent(sessionId)}/file/content?path=${encodeURIComponent(data.path)}&v=${data.mtime}-${data.size}`);
    rawLink.style.display = '';
    document.getElementById('fileViewPublish').style.display = '';
    // Already published (by the agent or a previous click)? Show its link.
    apiFetch(owner.host, '/api/pages')
      .then((r) => r.json())
      .then((list) => {
        if (!ownsFileView(sessionId, generation) || fileViewAbsPath !== data.path) return;
        const page = Array.isArray(list) && list.find((p) => p.root === data.path);
        if (page) renderFilePageRow(page, sessionId, generation);
      })
      .catch(() => {});
    const kb = data.size >= 10240 ? `${Math.round(data.size / 1024)} KB` : `${data.size} B`;
    pathEl.textContent = `${shortCwd(data.path)} · ${kb}${data.truncated ? ' · truncated preview' : ''}`;
    pathEl.title = data.path;
    if (data.image) {
      const src = data.image.url
        ? hostAssetUrl(owner.host, data.image.url)
        : `data:${data.image.mimeType};base64,${data.image.data}`;
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
    // Marks go on last, over the final DOM this produced.
    refreshAnchoredComments();
  } catch (e) {
    if (!ownsFileView(sessionId, generation)) return;
    body.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}

function closeFileView() {
  fileViewGeneration += 1;
  fileViewSessionId = null;
  fileViewOwner = null;
  document.getElementById('sessionView').classList.remove('file-open');
  document.getElementById('fileViewBody').innerHTML = '';
  fileViewRaw = null;
  fileViewAbsPath = null;
  fileViewRelPath = null;
  const rawLink = document.getElementById('fileViewRaw');
  rawLink.style.display = 'none';
  rawLink.removeAttribute('href');
  closeCommentBubble();
  setAnchoredComments([]);
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
    sessionId: fileViewSessionId,
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
    sessionId: diffViewSessionId,
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
  // Clicking an existing mark (or a commented diff row) edits that comment.
  // A drag that ends on one is a new selection, so only collapsed clicks count.
  document.addEventListener('click', (event) => {
    const row = event.target.closest?.('.comment-list-row');
    if (row) return void focusAnchoredComment(row.dataset.commentId);
    const marked = event.target.closest?.('mark.comment-mark, .diff-line.comment-line');
    if (marked && window.getSelection()?.isCollapsed !== false) {
      const comment = anchoredComments.find((entry) => entry.id === marked.dataset.commentId);
      if (comment) return void openCommentEditor(comment, marked);
    }
    if (isCommentListPopoverOpen() && !event.target.closest?.('.view-comment-chip, .comment-list-popover')) {
      closeCommentListPopover();
    }
  });
  const reposition = () => { positionCommentBubble(); closeCommentListPopover(); };
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
  const owner = sessionState.captureSelection();
  if (!owner || owner.id !== draft.sessionId) return;
  commentOwner = owner;
  anchoredCommentDraft = draft;
  commentEditTarget = null;
  commentAnchorRange = range.cloneRange();
  commentDraftVersion += 1;
  disarmCommentDelete();
  document.getElementById('commentBubbleTitle').textContent = 'Comment for agent';
  document.getElementById('commentDeleteBtn').style.display = 'none';
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
  document.getElementById('commentDeleteBtn').style.display = 'none';
  anchoredCommentDraft = null;
  commentOwner = null;
  commentEditTarget = null;
  commentAnchorRange = null;
  commentDraftVersion += 1;
  disarmCommentDelete();
}

function handleCommentKey(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    submitAnchoredComment();
  }
}

async function submitAnchoredComment() {
  const draft = anchoredCommentDraft;
  const editing = commentEditTarget;
  if (!draft && !editing) return;
  const owner = commentOwner;
  if (!sessionState.ownsSelection(owner) || owner.id !== (editing || draft).sessionId) return;
  const draftVersion = commentDraftVersion;
  const body = document.getElementById('commentBody').value.trim();
  if (!body) return document.getElementById('commentBody').focus();
  const button = document.getElementById('commentSendBtn');
  button.disabled = true;
  document.getElementById('commentStatus').textContent = 'Saving…';
  try {
    const response = editing
      ? await apiFetch(owner.host, `/api/comments/${encodeURIComponent(editing.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: editing.sessionId, body }),
      })
      : await apiFetch(owner.host, '/api/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: draft.sessionId, body, target: draft.target }),
      });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    if (!sessionState.ownsSelection(owner)) return;
    if (draftVersion === commentDraftVersion
        && (editing ? commentEditTarget === editing : anchoredCommentDraft === draft)) {
      closeCommentBubble();
      window.getSelection()?.removeAllRanges();
    }
    setStatus(editing ? 'Comment updated' : 'Comment saved');
    // The point of saving is to see it: re-anchor immediately.
    refreshAnchoredComments();
  } catch (error) {
    if (draftVersion === commentDraftVersion && sessionState.ownsSelection(owner)) {
      document.getElementById('commentStatus').textContent = error.message;
    }
  } finally {
    if (draftVersion === commentDraftVersion && sessionState.ownsSelection(owner)) button.disabled = false;
  }
}

// --- Open comments rendered back into the file and diff views ---
// A saved comment is not filed away: until the agent acknowledges it, it
// stays visible where it was written (an anchored mark or a tinted diff row)
// and stays editable/deletable. Acknowledged comments are the agent's record
// and disappear from these views entirely — the server refuses to touch them.

function setAnchoredComments(list) {
  anchoredComments = list;
  applyCommentMarks();
  renderCommentCountChips();
}

// Comments are enrichment over the view: every failure path here degrades to
// "no marks", never to a broken file/diff render.
async function refreshAnchoredComments() {
  const fileOpen = isFileViewOpen();
  const diffOpen = !fileOpen && isDiffViewOpen();
  if (!fileOpen && !diffOpen) return setAnchoredComments([]);
  const sessionId = fileOpen ? fileViewSessionId : diffViewSessionId;
  const owner = fileOpen ? fileViewOwner : diffViewOwner;
  const generation = fileOpen ? fileViewGeneration : diffViewGeneration;
  const filePath = fileViewAbsPath;
  if (!sessionId || !sessionState.ownsSelection(owner) || (fileOpen && !filePath)) return setAnchoredComments([]);
  // The view can be closed, refreshed, or pointed at another file while these
  // two round trips are in flight — same generation guard as the views.
  const owns = () => (fileOpen
    ? ownsFileView(sessionId, generation) && fileViewAbsPath === filePath
    : ownsDiffView(sessionId, generation));
  try {
    const indexRes = await apiFetch(owner.host, `/api/comments/index?sessionId=${encodeURIComponent(sessionId)}`);
    const index = await indexRes.json();
    if (!indexRes.ok || !owns()) return;
    const ids = (index.comments || [])
      .filter((entry) => (fileOpen
        ? entry.target?.kind === 'file' && entry.target.path === filePath
        : entry.target?.kind === 'diff'))
      .map((entry) => entry.id);
    if (!ids.length) return setAnchoredComments([]);
    const fullRes = await apiFetch(owner.host, '/api/comments/get', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ids }),
    });
    const full = await fullRes.json();
    if (!fullRes.ok || !owns()) return;
    setAnchoredComments(full.comments || []);
  } catch { /* leave whatever marks are already up */ }
}

function applyCommentMarks() {
  if (isFileViewOpen()) {
    const root = document.getElementById('fileViewBody');
    clearCommentMarks(root);
    for (const comment of anchoredComments) {
      if (comment.target?.kind === 'file') markCommentQuote(root, comment.target.anchor, comment.id);
    }
  } else if (isDiffViewOpen()) {
    markDiffCommentLines();
  }
}

function clearCommentMarks(root) {
  root.querySelectorAll('mark.comment-mark').forEach((mark) => {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent));
    parent?.normalize();
  });
}

// A rendered quote routinely spans several text nodes (markdown turns one
// sentence into text + <code> + text), so markSearchTokens' per-node scan
// can't find it. Flatten the subtree into one string with per-node offsets,
// locate the quote there, then wrap the covered slice of each node.
function collectTextRuns(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('script, style')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const runs = [];
  let text = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    runs.push({ node, start: text.length, end: text.length + node.textContent.length });
    text += node.textContent;
  }
  return { runs, text };
}

function commonSuffixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// Repeated quotes are the normal case for short selections, so pick the
// occurrence whose neighbours best match the anchor's recorded context.
function findQuoteOffset(text, anchor) {
  const quote = anchor?.quote;
  if (!quote) return -1;
  const hits = [];
  let from = 0;
  let at;
  while ((at = text.indexOf(quote, from)) !== -1) {
    hits.push(at);
    from = at + Math.max(1, quote.length);
  }
  if (hits.length < 2) return hits.length ? hits[0] : -1;
  const prefix = anchor.prefix || '';
  const suffix = anchor.suffix || '';
  let best = hits[0];
  let bestScore = -1;
  for (const hit of hits) {
    const before = text.slice(Math.max(0, hit - prefix.length), hit);
    const after = text.slice(hit + quote.length, hit + quote.length + suffix.length);
    const score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
    if (score > bestScore) { bestScore = score; best = hit; }
  }
  return best;
}

function markCommentQuote(root, anchor, commentId) {
  const quote = anchor?.quote;
  if (!quote) return false;
  const { runs, text } = collectTextRuns(root);
  const start = findQuoteOffset(text, anchor);
  if (start < 0) return false; // unanchorable — the chip list still reaches it
  const end = start + quote.length;
  let marked = false;
  for (const run of runs) {
    if (run.end <= start || run.start >= end) continue;
    const from = Math.max(0, start - run.start);
    const to = Math.min(run.node.textContent.length, end - run.start);
    if (to <= from) continue;
    const source = run.node.textContent;
    const mark = document.createElement('mark');
    mark.className = 'comment-mark';
    mark.dataset.commentId = commentId;
    mark.textContent = source.slice(from, to);
    const frag = document.createDocumentFragment();
    if (from > 0) frag.appendChild(document.createTextNode(source.slice(0, from)));
    frag.appendChild(mark);
    if (to < source.length) frag.appendChild(document.createTextNode(source.slice(to)));
    // Replacing only this node keeps every other run reference (and the
    // flattened offsets they were computed from) valid.
    run.node.replaceWith(frag);
    marked = true;
  }
  return marked;
}

function diffPatchFor(comment) {
  const target = comment.target || {};
  return [...document.querySelectorAll('#diffViewBody .diff-patch')].find((patch) =>
    patch.dataset.repo === target.repo && patch.dataset.path === target.path) || null;
}

function markDiffCommentLines() {
  document.querySelectorAll('#diffViewBody .diff-line.comment-line').forEach((line) => {
    line.classList.remove('comment-line');
    delete line.dataset.commentId;
  });
  for (const comment of anchoredComments) {
    if (comment.target?.kind !== 'diff') continue;
    const patch = diffPatchFor(comment);
    if (!patch) continue;
    const anchor = comment.target.anchor || {};
    // renderDiffHtml writes an empty attribute for the side a line is absent
    // from, and Number('') is 0 — an empty coordinate is no coordinate.
    const lineNum = (value) => (value ? Number(value) : NaN);
    const inRange = (value, from, to) => Number.isInteger(from) && Number.isInteger(to)
      && Number.isInteger(value) && value >= from && value <= to;
    for (const line of patch.querySelectorAll('.diff-line')) {
      const hit = inRange(lineNum(line.dataset.newLine), anchor.newStart, anchor.newEnd)
        || (!Number.isInteger(anchor.newStart)
          && inRange(lineNum(line.dataset.oldLine), anchor.oldStart, anchor.oldEnd));
      if (!hit) continue;
      line.classList.add('comment-line');
      line.dataset.commentId = comment.id;
    }
  }
}

function renderCommentCountChips() {
  const fileChip = document.getElementById('fileViewComments');
  const diffChip = document.getElementById('diffViewComments');
  const active = isFileViewOpen() ? fileChip : isDiffViewOpen() ? diffChip : null;
  for (const chip of [fileChip, diffChip]) {
    if (!chip) continue;
    if (chip !== active || !anchoredComments.length) { chip.style.display = 'none'; continue; }
    chip.style.display = '';
    chip.textContent = `💬 ${anchoredComments.length}`;
  }
  if (!anchoredComments.length) closeCommentListPopover();
  else if (isCommentListPopoverOpen()) renderCommentListPopover();
}

function isCommentListPopoverOpen() {
  return document.getElementById('commentListPopover').style.display !== 'none';
}

function closeCommentListPopover() {
  document.getElementById('commentListPopover').style.display = 'none';
}

function toggleCommentListPopover(chip) {
  if (isCommentListPopoverOpen()) return closeCommentListPopover();
  if (!anchoredComments.length) return;
  const popover = document.getElementById('commentListPopover');
  renderCommentListPopover();
  popover.style.display = 'block';
  const rect = chip.getBoundingClientRect();
  const width = popover.offsetWidth;
  popover.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left))}px`;
  popover.style.top = `${rect.bottom + 6}px`;
}

function renderCommentListPopover() {
  document.getElementById('commentListPopover').innerHTML = anchoredComments.map((comment) => {
    const quote = (comment.target?.anchor?.quote || '').replace(/\s+/g, ' ').trim();
    return `<button type="button" class="comment-list-row" data-comment-id="${escapeHtml(comment.id)}">`
      + `<span class="comment-list-body">${escapeHtml(comment.body.slice(0, 160))}</span>`
      + (quote ? `<span class="comment-list-quote">${escapeHtml(quote.slice(0, 90))}</span>` : '')
      + '</button>';
  }).join('');
}

async function focusAnchoredComment(id) {
  const comment = anchoredComments.find((entry) => entry.id === id);
  if (!comment) return;
  const fileOpen = isFileViewOpen();
  const owner = fileOpen ? fileViewOwner : diffViewOwner;
  const generation = fileOpen ? fileViewGeneration : diffViewGeneration;
  const owns = () => owner && (fileOpen
    ? ownsFileView(owner.id, generation) : ownsDiffView(owner.id, generation));
  if (!owns()) return;
  closeCommentListPopover();
  if (comment.target?.kind === 'diff') {
    const details = diffPatchFor(comment)?.closest('details.diff-file');
    if (details && !details.open) {
      // The toggle event is async, so loading here wins the in-flight guard
      // and we can render the marks once the patch really exists.
      details.open = true;
      await loadDeferredDiffPatch(details);
      if (!owns()) return;
      applyCommentMarks();
    }
  }
  const mark = document.querySelector(`[data-comment-id="${CSS.escape(id)}"]`);
  if (mark) mark.scrollIntoView({ block: 'center' });
  openCommentEditor(comment, mark
    || document.getElementById(isFileViewOpen() ? 'fileViewComments' : 'diffViewComments'));
}

function openCommentEditor(comment, anchorEl) {
  if (!comment || !anchorEl) return;
  const owner = sessionState.captureSelection();
  if (!owner || owner.id !== comment.sessionId) return;
  commentOwner = owner;
  const range = document.createRange();
  range.selectNodeContents(anchorEl);
  anchoredCommentDraft = null;
  commentEditTarget = comment;
  commentAnchorRange = range;
  commentDraftVersion += 1;
  disarmCommentDelete();
  document.getElementById('commentBubbleTitle').textContent = 'Edit comment';
  document.getElementById('commentAnchorPreview').textContent = comment.target?.anchor?.quote || '';
  document.getElementById('commentBody').value = comment.body;
  document.getElementById('commentStatus').textContent = '';
  document.getElementById('commentSendBtn').disabled = false;
  document.getElementById('commentDeleteBtn').style.display = '';
  document.getElementById('commentBubble').style.display = 'block';
  positionCommentBubble();
  document.getElementById('commentBody').focus();
  setTimeout(positionCommentBubble, 0);
}

function disarmCommentDelete() {
  clearTimeout(commentDeleteTimer);
  commentDeleteArmed = false;
  const button = document.getElementById('commentDeleteBtn');
  button.textContent = 'Delete';
  button.classList.remove('armed');
}

// Two-tap confirm, same idiom as the sidebar's row-level session close.
async function handleCommentDelete() {
  if (!commentEditTarget) return;
  const owner = commentOwner;
  if (!sessionState.ownsSelection(owner) || owner.id !== commentEditTarget.sessionId) return;
  const button = document.getElementById('commentDeleteBtn');
  if (!commentDeleteArmed) {
    commentDeleteArmed = true;
    button.textContent = 'Delete?';
    button.classList.add('armed');
    commentDeleteTimer = setTimeout(disarmCommentDelete, 3000);
    return;
  }
  const comment = commentEditTarget;
  const draftVersion = commentDraftVersion;
  button.disabled = true;
  document.getElementById('commentStatus').textContent = 'Deleting…';
  try {
    const response = await apiFetch(owner.host, `/api/comments/${encodeURIComponent(comment.id)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: comment.sessionId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    if (!sessionState.ownsSelection(owner)) return;
    if (draftVersion === commentDraftVersion) closeCommentBubble();
    setStatus('Comment deleted');
    refreshAnchoredComments();
  } catch (error) {
    if (draftVersion === commentDraftVersion && sessionState.ownsSelection(owner)) {
      document.getElementById('commentStatus').textContent = error.message;
      disarmCommentDelete();
    }
  } finally {
    if (draftVersion === commentDraftVersion && sessionState.ownsSelection(owner)) button.disabled = false;
  }
}

// --- Published pages (file viewer + stats modal) ---
// The agent's flow is the API itself (write plan.html, then
// `curl -X POST …/api/pages`); these are the user-initiated equivalents:
// 🌐 in the file viewer publishes the viewed file, the stats modal lists a
// session's published pages with copy/revoke.

function renderFilePageRow(page, sessionId, generation) {
  const el = document.getElementById('fileViewPage');
  if (!page) { el.style.display = 'none'; el.innerHTML = ''; return; }
  if (!ownsFileView(sessionId, generation)) return;
  const owner = fileViewOwner;
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
    if (!ownsFileView(sessionId, generation)) return;
    apiFetch(owner.host, `/api/pages/${encodeURIComponent(page.token)}`, { method: 'DELETE' })
      .then(() => {
        if (!ownsFileView(sessionId, generation)) return;
        renderFilePageRow(null, sessionId, generation);
        refreshArtifacts(owner);
      })
      .catch((e) => {
        if (ownsFileView(sessionId, generation)) setStatus('Failed to unpublish: ' + e.message, 'error');
      });
  });
}

async function publishFileView() {
  if (!fileViewAbsPath || !sessionState.currentSession) return;
  const sessionId = fileViewSessionId;
  const generation = fileViewGeneration;
  const path = fileViewAbsPath;
  if (!ownsFileView(sessionId, generation)) return;
  const owner = fileViewOwner;
  try {
    const res = await apiFetch(owner.host, '/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        sessionId,
        title: path.split('/').pop(),
        renderer: 'file',
      }),
    });
    const data = await res.json();
    if (!ownsFileView(sessionId, generation)) return;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderFilePageRow(data, sessionId, generation);
    refreshArtifacts(owner);
  } catch (e) {
    if (ownsFileView(sessionId, generation)) setStatus('Publish failed: ' + e.message, 'error');
  }
}

// Published pages section of the stats modal (only rendered when non-empty —
// most sessions publish nothing and don't need the visual noise).
function loadPagesSection(owner, generation) {
  if (!ownsStatsModal(owner, generation)) return;
  const sessionId = owner.id;
  const el = document.getElementById('statsPages');
  if (!el) return;
  apiFetch(owner.host, `/api/pages?sessionId=${encodeURIComponent(sessionId)}`)
    .then((r) => r.json())
    .then((list) => {
      if (!ownsStatsModal(owner, generation)) return;
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
          if (!ownsStatsModal(owner, generation)) return;
          const token = btn.closest('.stats-page-row').dataset.token;
          apiFetch(owner.host, `/api/pages/${encodeURIComponent(token)}`, { method: 'DELETE' })
            .then(() => {
              if (!ownsStatsModal(owner, generation)) return;
              loadPagesSection(owner, generation);
              refreshArtifacts(owner);
            })
            .catch((e) => {
              if (ownsStatsModal(owner, generation)) setStatus('Failed to revoke: ' + e.message, 'error');
            });
        });
      });
    })
    .catch(() => { if (ownsStatsModal(owner, generation)) el.innerHTML = ''; });
}

// --- Shared artifacts (header 📦: everything published/shared from the
// session in one place) ---
// Pages the agent (or the file viewer's 🌐) published plus the session share
// link. The badge count keeps them discoverable without opening the stats
// modal; refreshed on session select, turn end (agents publish mid-turn),
// and after any publish/revoke in the UI.
let sessionArtifacts = { pages: [], share: null };
let artifactsSeq = 0; // drops stale responses on fast session switches

async function refreshArtifacts(owner = sessionState.captureSelection()) {
  if (!sessionState.ownsSelection(owner)) return;
  const sessionId = owner.id;
  const seq = ++artifactsSeq;
  try {
    const [pagesRes, shareRes] = await Promise.all([
      apiFetch(owner.host, `/api/pages?sessionId=${encodeURIComponent(sessionId)}`),
      apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/share`),
    ]);
    const pages = pagesRes.ok ? await pagesRes.json() : [];
    const share = (shareRes.ok && shareRes.status !== 404) ? await shareRes.json() : null;
    if (seq !== artifactsSeq || !sessionState.ownsSelection(owner)) return;
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
  if (!sessionState.currentSession) return;
  document.getElementById('artifactsModal').style.display = 'flex';
  renderArtifactsModal();
  refreshArtifacts();
}

function closeArtifactsModal() {
  document.getElementById('artifactsModal').style.display = 'none';
}

function renderArtifactsModal() {
  const owner = sessionState.captureSelection();
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
    if (!sessionState.ownsSelection(owner)) return;
    apiFetch(owner.host, `/api/pages/${encodeURIComponent(btn.dataset.token)}`, { method: 'DELETE' })
      .then(() => refreshArtifacts(owner))
      .catch((e) => { if (sessionState.ownsSelection(owner)) setStatus('Failed to revoke: ' + e.message, 'error'); });
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
let diffViewSessionId = null;
let diffViewGeneration = 0;
let diffViewOwner = null;
let diffPatchRequestGeneration = 0;

function isDiffViewOpen() {
  return document.getElementById('sessionView').classList.contains('diff-open');
}

function ownsDiffView(sessionId, generation) {
  return diffViewSessionId === sessionId && diffViewGeneration === generation &&
    sessionState.ownsSelection(diffViewOwner) && isDiffViewOpen();
}

function toggleDiffView() {
  if (isDiffViewOpen()) closeDiffView();
  else openDiffView();
}

async function openDiffView() {
  if (!sessionState.currentSession) return;
  closeFileView(); // the two takeover panes are mutually exclusive
  document.getElementById('sessionView').classList.add('diff-open');
  document.getElementById('btnDiff')?.classList.add('active');
  await loadDiffView();
}

function closeDiffView() {
  diffViewGeneration += 1;
  diffViewSessionId = null;
  diffViewOwner = null;
  document.getElementById('sessionView').classList.remove('diff-open');
  document.getElementById('btnDiff')?.classList.remove('active');
  document.getElementById('diffViewBody').innerHTML = '';
  closeCommentBubble();
  setAnchoredComments([]);
}

async function loadDiffView() {
  if (!sessionState.currentSession || !isDiffViewOpen()) return;
  const owner = sessionState.captureSelection();
  const sessionId = owner.id;
  const generation = ++diffViewGeneration;
  diffViewSessionId = sessionId;
  diffViewOwner = owner;
  const body = document.getElementById('diffViewBody');
  const rootEl = document.getElementById('diffViewRoot');
  closeCommentBubble();
  body.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const res = await apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/diff`);
    const data = await res.json();
    if (!ownsDiffView(sessionId, generation)) return;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    rootEl.textContent = shortCwd(data.root);
    body.innerHTML = renderDiffViewHtml(data);
    body.querySelectorAll('details.diff-file').forEach(details => {
      details.addEventListener('toggle', () => {
        if (details.open) loadDeferredDiffPatch(details);
      });
    });
    refreshAnchoredComments();
  } catch (e) {
    if (!ownsDiffView(sessionId, generation)) return;
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
      const patchAttrs = `data-repo="${escapeHtml(repo.path)}" data-path="${escapeHtml(f.path)}" data-old-path="${escapeHtml(f.oldPath || '')}" data-snapshot="${escapeHtml(data.snapshotId || '')}"`;
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
  if (!patch || patch.dataset.loading || !sessionState.currentSession || !diffViewSessionId) return;
  const sessionId = diffViewSessionId;
  const viewGeneration = diffViewGeneration;
  const requestGeneration = ++diffPatchRequestGeneration;
  if (!ownsDiffView(sessionId, viewGeneration)) return;
  const owner = diffViewOwner;
  patch.dataset.loading = '1';
  patch.dataset.requestGeneration = String(requestGeneration);
  try {
    const query = new URLSearchParams({
      repo: patch.dataset.repo,
      path: patch.dataset.path,
      snapshot: patch.dataset.snapshot,
    });
    const res = await apiFetch(owner.host, `/api/sessions/${encodeURIComponent(sessionId)}/diff/patch?${query}`);
    const data = await res.json();
    if (!ownsDiffView(sessionId, viewGeneration) || !patch.isConnected ||
        patch.dataset.requestGeneration !== String(requestGeneration)) return;
    if (res.status === 409 && data.stale) {
      patch.innerHTML = '<div class="diff-file-note">Working tree changed — refreshing the diff…</div>';
      await loadDiffView();
      return;
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    patch.innerHTML = renderDiffHtml(data.patch) +
      (data.truncated ? '<div class="diff-file-note">… patch truncated</div>' : '');
    delete patch.dataset.deferred;
    delete patch.dataset.loading;
    delete patch.dataset.requestGeneration;
    applyCommentMarks(); // the rows this patch just built may carry comments
  } catch (e) {
    if (!ownsDiffView(sessionId, viewGeneration) || !patch.isConnected ||
        patch.dataset.requestGeneration !== String(requestGeneration)) return;
    delete patch.dataset.loading;
    delete patch.dataset.requestGeneration;
    patch.innerHTML = `<div class="diff-file-note diff-patch-missing">Could not load patch: ${escapeHtml(e.message)}. Collapse and reopen to retry.</div>`;
  }
}

// --- Export ---
//
// The export is a Content-Disposition attachment, and the session may live on
// any host in the fleet — so this cannot be a window.open() of a *bare* path.
// A bare path resolves against location.origin, i.e. the hub, where a peer's
// session id does not exist.
//
// It stays a navigation whenever the owning host needs no bearer, which keeps
// the single-host behaviour byte for byte (the attachment streams straight to
// disk instead of through a blob in memory — a long transcript exports to tens
// of MB) and works for a peer too, since the /hosts/<name> proxy relays
// Content-Disposition untouched. A navigation cannot carry an Authorization
// header, so a token host — and only a token host — goes through apiFetch and
// saves the bytes by hand. That split is also what CORS wants: a cross-origin
// peer only emits CORS headers when it has a token configured, so the
// tokenless case *must* be the navigation.
//
// Neither path takes a deadline: the exporter runs over the whole session
// before the first byte.
async function exportSession() {
  if (!sessionState.currentSession) return;
  const session = sessionState.currentSession;
  const host = resolveHost(session.host);
  const path = `/api/sessions/${encodeURIComponent(session.id)}/export`;
  if (!host.token) { window.open(host.base + path, '_blank'); return; }

  setStatus('Exporting session…', 'working');
  try {
    const res = await apiFetch(host, path);
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try { message = (await res.json()).error || message; } catch { /* not JSON */ }
      throw new Error(message);
    }
    const fallback = `${(session.name || session.id).replace(/[^\w.-]+/g, '-')}.html`;
    downloadBlob(await res.blob(),
      filenameFromContentDisposition(res.headers.get('Content-Disposition'), fallback));
    setStatus('Session exported');
  } catch (e) {
    setStatus('Export failed: ' + e.message, 'error');
  }
}

/** Save already-fetched bytes to disk under `name`. */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late on purpose: revoking in the same tick cancels the save in
  // some browsers, which read the blob only after the click is handled.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// --- Inline rename ---
function startRename() {
  if (!sessionState.currentSession || !sessionState.currentSession.isActive || !sessionSupports(sessionState.currentSession, 'rename')) return;
  const nameEl = document.getElementById('sessionName');
  const inputEl = document.getElementById('sessionNameInput');
  nameEl.style.display = 'none';
  inputEl.style.display = '';
  inputEl.value = sessionState.currentSession.name || '';
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
  if (!sessionState.currentSession || !newName || newName === sessionState.currentSession.name || !sessionState.currentSession.isActive) return;
  const owner = sessionState.captureSelection();
  const { id, host } = owner;
  try {
    await sessionApi.rename(owner, newName);
    sessionState.patchSession(id, { name: newName }, host);
  } catch (e) {
    if (sessionState.ownsSelection(owner)) setStatus('Rename failed: ' + e.message, 'error');
  }
}

function cancelRename() {
  document.getElementById('sessionNameInput').style.display = 'none';
  document.getElementById('sessionName').style.display = '';
}

// --- Model dropdown ---
let modelDropdownOpen = false;
let modelEditMode = false; // scoped-models switcher: toggle which models are enabled
let modelQuery = '';
let modelSelector = null;

async function toggleModelDropdown() {
  if (!sessionState.currentSession || !sessionState.currentSession.isActive || !sessionSupports(sessionState.currentSession, 'setModel')) return;
  const owner = sessionState.captureSelection();
  await loadModels(owner.id, sessionState.currentSession.harnessId);
  if (!sessionState.ownsSelection(owner)) return;
  modelDropdownOpen = !modelDropdownOpen;
  modelEditMode = false;
  const dropdown = document.getElementById('modelDropdown');
  if (!modelDropdownOpen) { closeModelDropdown(); return; }
  // Desktop: anchored under the header button. Mobile: the stylesheet
  // positions it (full-width sheet), so just clear any desktop inline pos.
  if (window.innerWidth > 768) {
    anchorDropdown(dropdown, document.getElementById('sessionModel').getBoundingClientRect());
  } else {
    clearDropdownPos(dropdown);
  }
  renderModelDropdown('');
  dropdown.style.display = 'flex';
  modelSelector.focusSearch();
  armOutsideClickClose(['modelSelector', 'modelDropdown'], closeModelDropdown, () => modelDropdownOpen);
}

function renderModelDropdown(query) {
  const owner = sessionState.captureSelection();
  if (!owner) return;
  modelQuery = query;
  if (!modelSelector) {
    // Every action is bound to the view that emitted it, before invoking the
    // existing request/catalog writers. The component never reads global state.
    const owned = action => (target, ...args) => {
      if (sessionState.ownsSelection(target)) action(...args);
    };
    modelSelector = PiDishBrowser.mountModelSelector(document.getElementById('modelDropdown'), {
      requestClose: owned(closeModelDropdown),
      queryChanged: owned(renderModelDropdown),
      editModeChanged: owned(editing => editing ? enterModelEditMode() : exitModelEditMode()),
      selectModel: owned(selectModel),
      toggleModel: owned(toggleModelEnabled),
      toggleProvider: owned(toggleProviderEnabled),
      setAllEnabled: owned(setAllModelsEnabled),
    }, formatTokens);
  }
  modelSelector.update({ owner, models: modelCatalog.rows(), currentModel: sessionState.currentSession.model || null,
    harnessId: sessionState.currentSession.harnessId || null, query, editMode: modelEditMode });
}

function enterModelEditMode() {
  if (sessionState.currentSession?.harnessId !== 'pi') return;
  modelEditMode = true;
  renderModelDropdown(currentModelQuery());
}

function exitModelEditMode() {
  modelEditMode = false;
  renderModelDropdown(currentModelQuery());
}

function currentModelQuery() { return modelQuery; }

function toggleModelEnabled(fullId) {
  modelCatalog.toggle(fullId);
  renderModelDropdown(currentModelQuery());
  saveEnabledModels();
}
function setAllModelsEnabled(enabled) {
  modelCatalog.setAll(enabled);
  renderModelDropdown(currentModelQuery());
  saveEnabledModels();
}
function toggleProviderEnabled(provider) {
  modelCatalog.toggleProvider(provider, currentModelQuery());
  renderModelDropdown(currentModelQuery());
  saveEnabledModels();
}

let saveEnabledTimer = null;
function saveEnabledModels() {
  // Snapshot the owner's edit before the debounce can observe another catalog.
  const enabledIds = modelCatalog.enabledIds();
  if (enabledIds === undefined) return; // Retired rows cannot clear the server-local preference.
  clearTimeout(saveEnabledTimer);
  saveEnabledTimer = setTimeout(async () => {
    try {
      await sessionApi.setEnabledModels(enabledIds);
    } catch (e) { setStatus('Failed to save model list: ' + e.message, 'error'); }
  }, 400);
}

function closeModelDropdown() {
  modelDropdownOpen = false;
  modelSelector?.dispose();
  modelSelector = null;
  document.getElementById('modelDropdown').style.display = 'none';
}

async function selectModel(fullModelId) {
  closeModelDropdown();
  // Only skip on an exact provider/id match. currentSession.model is often a
  // bare id, and the same id can exist under two providers (anthropic vs a
  // Bedrock mirror) — a bare-id comparison silently swallowed those switches.
  // A redundant set_model for the truly-same model is harmless.
  var isSame = fullModelId === sessionState.currentSession?.model;
  if (!sessionState.currentSession || !sessionSupports(sessionState.currentSession, 'setModel') || isSame) return;
  const owner = sessionState.captureSelection();
  const { id, host } = owner;
  setStatus('Switching model...', 'working');
  try {
    await sessionApi.setModel(owner, fullModelId);
    sessionState.patchSession(id, { model: fullModelId }, host);
    if (sessionState.ownsSelection(owner)) setStatus('Model switched to ' + fullModelId);
  } catch (e) {
    if (sessionState.ownsSelection(owner)) setStatus('Model switch failed: ' + e.message, 'error');
  }
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
      try { handleExtensionUI(JSON.parse(e.data), sessionId); } catch (err) { console.error('extension_ui_request error:', err); }
    });

    addOwnedListener('queue_update', (e) => {
      try { renderQueueStatus(JSON.parse(e.data)); } catch {}
    });

    // Dialog answered elsewhere (TUI or another browser) — dismiss ours.
    addOwnedListener('extension_ui_resolved', (e) => {
      try { dismissExtDialog(extDialogKey(JSON.parse(e.data).id, sessionId, hostId)); } catch {}
    });
    // Authoritative list of this session's pending dialogs, sent on (re)connect
    // after the replay burst. Prunes stashed dialogs that were answered or
    // dismissed while we were away (or orphaned by an idle session), without
    // touching other sessions' dialogs.
    addOwnedListener('extension_ui_state', (e) => {
      try {
        const pending = new Set(JSON.parse(e.data).dialogs || []);
        for (const [requestId, entry] of [...openExtDialogs]) {
          if (entry.sessionKey === sessionKey(hostId, sessionId) && !pending.has(entry.requestId)) dismissExtDialog(requestId);
        }
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
      for (const [requestId, entry] of [...openExtDialogs]) {
        if (entry.sessionKey === sessionKey(hostId, sessionId)) dismissExtDialog(requestId);
      }
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

// --- Image attachments -------------------------------------------------

var pendingImages = []; // { data: base64 (no data: prefix), mimeType }
const pendingImagesBySession = new Map();
let composerSessionKey = null;
let composerDraftDirty = false;

async function addImageFiles(files) {
  const owner = composerSessionKey;
  if (!owner) return;
  for (const file of Array.from(files || [])) {
    if (!file || !file.type || !file.type.startsWith('image/')) continue;
    try {
      const image = await prepareImageAttachment(file);
      if (composerSessionKey === owner) {
        pendingImages.push(image);
        renderAttachmentStrip();
      } else {
        pendingImagesBySession.set(owner, [...(pendingImagesBySession.get(owner) || []), image]);
      }
    } catch (e) {
      if (composerSessionKey === owner) setStatus(`Could not attach ${file.name || 'image'}: ${e.message}`, 'error');
    }
  }
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

function openImageLightbox(src) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  const img = document.createElement('img');
  img.src = src;
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// --- Composer notes ------------------------------------------------------
//
// A quiet one-line strip above the prompt box for composer-side failures the
// reader can act on: a denied microphone, an insecure origin, a transcription
// error. Not setStatus(), which is a transient badge — these want to stay put
// until dismissed, and some of them are a paragraph long. textContent only.

function showComposerNote(text) {
  const el = document.getElementById('composerNote');
  if (!el) return;
  el.textContent = '';
  const span = document.createElement('span');
  span.className = 'composer-note-text';
  span.textContent = String(text || '');
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'composer-note-dismiss';
  dismiss.title = 'Dismiss';
  dismiss.textContent = '✕';
  dismiss.addEventListener('click', hideComposerNote);
  el.appendChild(span);
  el.appendChild(dismiss);
  el.style.display = '';
}

function hideComposerNote() {
  const el = document.getElementById('composerNote');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

// --- Speech to text (composer mic) ---------------------------------------
//
// Batch dictation, deliberately not streaming: hold (or click) to record,
// release to transcribe, and the transcript lands at the caret for review —
// it never sends itself. The bytes go to this server's /api/stt, which holds
// the endpoint and its key (lib/stt.js); the browser never sees either.

let micRecorder = null;    // the live MediaRecorder, or null
let micStream = null;      // its MediaStream, so the tracks can be released
let micChunks = [];
let micStartedAt = 0;
let micTimer = null;       // 1s status ticker
let micBusy = false;       // transcription in flight
let micStarting = false;   // getUserMedia in flight (double-tap guard)
let micCancelled = false;  // Escape / session switch: discard on stop
let micPointerType = '';   // last pointerdown: touch is hold-to-talk

const MIC_MAX_MS = 5 * 60 * 1000;
// First supported wins. Chrome/Firefox land on webm/opus, iOS Safari on mp4;
// an empty result means "let the browser pick", which every one of these
// endpoints can still sniff from the filename the server derives.
const MIC_MIME_CANDIDATES = [
  'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg',
];

/**
 * Transcription isn't session-scoped — any capable host can do it — so unlike
 * the terminal this gates on the *fleet*, not the session's owning host. Self
 * sorts first in effectiveHosts(), so a local endpoint always wins.
 */
function sttHostFor() {
  return effectiveHosts().find(host => hostSupportsCapability(host, 'stt', appConfig)) || null;
}

/** Why the mic can't run in *this* browser/origin (helpers.js), or null. */
function micUnavailableReason() {
  return sttUnavailableReason({
    isSecureContext: !!window.isSecureContext,
    hasGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    hasMediaRecorder: typeof window.MediaRecorder === 'function',
    origin: location.origin,
  });
}

function isRecording() { return !!micRecorder; }

/**
 * Three states, in order: no capable host hides the button entirely; a
 * capable host the browser can't serve keeps it visible but `aria-disabled`
 * and explains itself on tap — never a real `disabled` attribute, which
 * swallows the tap and leaves a phone with no way to read the reason, since
 * `title` never shows on touch.
 */
function updateMicButton() {
  const btn = document.getElementById('btnMic');
  if (!btn) return;
  if (!sttHostFor()) {
    btn.style.display = 'none';
    return;
  }
  const reason = micUnavailableReason();
  btn.style.display = 'inline-flex';
  btn.classList.toggle('unavailable', !!reason);
  if (reason) btn.setAttribute('aria-disabled', 'true');
  else btn.removeAttribute('aria-disabled');
  btn.classList.toggle('recording', isRecording());
  btn.classList.toggle('busy', micBusy);
  // The glyph is the inline SVG: recording adds its slash (see the
  // .mic-slash rules), busy dims. Writing textContent here used to replace
  // the SVG with the 🎙 emoji — the one icon that didn't match the set.
  btn.title = reason ? reason.message
    : isRecording() ? 'Stop recording'
    : micBusy ? 'Transcribing…'
    : 'Dictate (speech to text)';
}

function initMicButton() {
  const btn = document.getElementById('btnMic');
  if (!btn) return;
  btn.addEventListener('pointerdown', (e) => {
    micPointerType = e.pointerType || 'mouse';
    const reason = micUnavailableReason();
    if (reason) { showComposerNote(reason.message); return; }
    // Touch is hold-to-talk: a phone user holds the button and speaks, and
    // releasing anywhere (up/cancel/leave) ends the take.
    if (micPointerType === 'touch') {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch {}
      startRecording();
    }
  });
  const releaseHold = (e) => {
    if ((e.pointerType || micPointerType) === 'touch' && isRecording()) stopRecording();
  };
  btn.addEventListener('pointerup', releaseHold);
  btn.addEventListener('pointercancel', releaseHold);
  btn.addEventListener('pointerleave', releaseHold);
  // Mouse/pen (and keyboard activation) toggle instead: holding a mouse
  // button down to dictate is nobody's habit on a desktop.
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const held = micPointerType === 'touch';
    micPointerType = '';
    if (held) return;
    const reason = micUnavailableReason();
    if (reason) { showComposerNote(reason.message); return; }
    if (micBusy) return;
    if (isRecording()) stopRecording(); else startRecording();
  });
}

function updateMicStatus() {
  if (!isRecording()) return;
  const elapsed = Date.now() - micStartedAt;
  if (elapsed >= MIC_MAX_MS) { stopRecording(); return; }
  setStatus(`Recording ${formatDuration(elapsed)}`);
}

async function startRecording() {
  if (micRecorder || micBusy || micStarting) return;
  const reason = micUnavailableReason();
  if (reason) { showComposerNote(reason.message); return; }
  hideComposerNote();
  micStarting = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    micStarting = false;
    const name = e && e.name;
    if (name === 'NotAllowedError') {
      showComposerNote("Microphone access was denied. Allow the microphone for this site in the browser's site settings and try again.");
    } else if (name === 'NotFoundError') {
      showComposerNote('No microphone found.');
    } else {
      showComposerNote(`Microphone error: ${name || 'unknown'}`);
    }
    return;
  }
  micStarting = false;
  const mimeType = MIC_MIME_CANDIDATES.find(t =>
    typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t));
  let recorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch {
    try { recorder = new MediaRecorder(stream); }
    catch (e) {
      stream.getTracks().forEach(t => t.stop());
      showComposerNote(`Microphone error: ${(e && e.name) || 'unknown'}`);
      return;
    }
  }
  micStream = stream;
  micRecorder = recorder;
  micChunks = [];
  micCancelled = false;
  micStartedAt = Date.now();
  recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) micChunks.push(e.data); });
  recorder.addEventListener('stop', () => finishRecording(recorder));
  recorder.start();
  micTimer = setInterval(updateMicStatus, 1000);
  updateMicStatus();
  updateMicButton();
}

function stopRecording() {
  if (!micRecorder) return;
  try { micRecorder.stop(); } catch { releaseMic(); updateMicButton(); }
}

/** Escape / session switch: keep the bytes nowhere and let the mic go. */
function cancelRecording() {
  if (!micRecorder) return;
  micCancelled = true;
  stopRecording();
  setStatus('');
}

function releaseMic() {
  if (micTimer) { clearInterval(micTimer); micTimer = null; }
  if (micStream) { try { micStream.getTracks().forEach(t => t.stop()); } catch {} micStream = null; }
  micRecorder = null;
}

function finishRecording(recorder) {
  const cancelled = micCancelled;
  const chunks = micChunks;
  micChunks = [];
  micCancelled = false;
  releaseMic();
  updateMicButton();
  if (cancelled) { setStatus(''); return; }
  const mime = (recorder && recorder.mimeType) || 'audio/webm';
  const blob = new Blob(chunks, { type: mime });
  // A tap that never became a take: an empty container still weighs a few
  // hundred bytes, so size is the only honest "did anything land" signal.
  if (blob.size < 1024) { setStatus(''); showComposerNote('Nothing was recorded.'); return; }
  transcribeRecording(blob, mime);
}

async function transcribeRecording(blob, mime) {
  const host = sttHostFor();
  if (!host) { setStatus(''); return; }
  micBusy = true;
  updateMicButton();
  setStatus('Transcribing…');
  try {
    const res = await apiFetch(host, '/api/stt', {
      method: 'POST', headers: { 'Content-Type': mime }, body: blob,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || `Transcription failed (HTTP ${res.status})`);
    const text = String((data && data.text) || '').trim();
    if (!text) { showComposerNote('No speech detected.'); return; }
    insertTranscript(text);
  } catch (e) {
    showComposerNote((e && e.message) || 'Transcription failed');
  } finally {
    micBusy = false;
    setStatus('');
    updateMicButton();
  }
}

/** Land the transcript at the caret; the reader edits and sends it. */
function insertTranscript(text) {
  const input = document.getElementById('promptInput');
  if (!input) return;
  const { value, caret } = insertAtCaret(input.value, input.selectionStart, input.selectionEnd, text);
  input.value = value;
  try { input.setSelectionRange(caret, caret); } catch {}
  // Draft persistence and autosize both hang off the input event.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

// --- Prompt drafts & history --------------------------------------------

var promptHistory = [];  // sent prompts for the current session (oldest first)
var historyIndex = -1;   // -1 = not browsing history
var historyStash = '';   // in-progress text stashed while browsing
var draftSaveTimer = null;

// Composer owners are captured host-qualified session keys or `spawn:<id>`
// operation keys. Bare wire ids are normalized at synchronous call boundaries.
// Spawn operations are server-process-local and never outlive a reload (cleared at boot).
function composerOwnerKey(owner) {
  return String(owner).startsWith('spawn:') || String(owner).includes(' ') ? owner : keyForSessionId(owner);
}
function draftKey(id) { return `pi-dish-draft-${composerOwnerKey(id)}`; }
function historyKey(id) { return `pi-dish-history-${composerOwnerKey(id)}`; }

function writeSessionDraft(sessionId, value) {
  if (sessionId) sessionId = composerOwnerKey(sessionId);
  if (!sessionId) return;
  try {
    if (value.trim() && value.length < 50000) localStorage.setItem(draftKey(sessionId), value);
    else localStorage.removeItem(draftKey(sessionId));
  } catch {}
}

// Save the visible composer before currentSession changes. Attachments are
// memory-only but, like text drafts, belong to the session where they were
// added and must not follow a rapid session switch.
function stashPromptState() {
  clearTimeout(draftSaveTimer);
  if (!composerSessionKey) return;
  const input = document.getElementById('promptInput');
  if (composerDraftDirty) writeSessionDraft(composerSessionKey, input?.value || '');
  if (pendingImages.length) pendingImagesBySession.set(composerSessionKey, pendingImages);
  else pendingImagesBySession.delete(composerSessionKey);
  pendingImages = [];
  composerSessionKey = null;
  composerDraftDirty = false;
  renderAttachmentStrip();
}

function clearPromptComposer() {
  composerSessionKey = null;
  composerDraftDirty = false;
  pendingImages = [];
  const input = document.getElementById('promptInput');
  if (input) { input.value = ''; input.style.height = ''; }
  renderAttachmentStrip();
}

function setComposerWaiting(waiting) {
  const input = document.getElementById('promptInput');
  if (input) input.placeholder = waiting ? 'Write your prompt while Pi starts…' : 'Send a message...';
  const btn = document.getElementById('btnSend');
  if (!btn) return;
  btn.disabled = waiting;
  btn.title = waiting ? 'Your draft will be preserved until Pi connects' : 'Send';
}

function saveDraftSoon() {
  clearTimeout(draftSaveTimer);
  const sessionId = composerSessionKey;
  composerDraftDirty = true;
  draftSaveTimer = setTimeout(() => {
    if (!sessionId || composerSessionKey !== sessionId) return;
    const v = document.getElementById('promptInput').value;
    writeSessionDraft(sessionId, v);
    composerDraftDirty = false;
  }, 300);
}

function clearDraft(sessionId = composerSessionKey) {
  if (sessionId) sessionId = composerOwnerKey(sessionId);
  clearTimeout(draftSaveTimer);
  if (sessionId) try { localStorage.removeItem(draftKey(sessionId)); } catch {}
  if (composerSessionKey === sessionId) composerDraftDirty = false;
}

/** On session switch: load that session's draft + history into the input. */
function restorePromptState(ownerId = sessionState.currentSession?.id) {
  if (!ownerId) return;
  ownerId = composerOwnerKey(ownerId);
  const input = document.getElementById('promptInput');
  composerSessionKey = ownerId;
  composerDraftDirty = false;
  let draft = '';
  try { draft = localStorage.getItem(draftKey(ownerId)) || ''; } catch {}
  input.value = draft;
  pendingImages = pendingImagesBySession.get(ownerId) || [];
  pendingImagesBySession.delete(ownerId);
  renderAttachmentStrip();
  autosizePromptInput(input);
  historyIndex = -1;
  historyStash = '';
  promptHistory = readJSONPref(historyKey(ownerId), []);
  if (!Array.isArray(promptHistory)) promptHistory = [];
}

function recordPrompt(message, sessionId = composerSessionKey) {
  if (sessionId) sessionId = composerOwnerKey(sessionId);
  if (!sessionId) return;
  promptHistory = pushPromptHistory(promptHistory, message, 50);
  historyIndex = -1;
  try { localStorage.setItem(historyKey(sessionId), JSON.stringify(promptHistory)); } catch {}
}

function mergeComposerText(existing, restored) {
  const current = (existing || '').trim();
  if (!current || current === restored) return restored;
  return `${existing}\n\n${restored}`;
}

function migratePromptState(fromId, toId) {
  fromId = composerOwnerKey(fromId);
  toId = composerOwnerKey(toId);
  let sourceDraft = '', destinationDraft = '';
  try {
    sourceDraft = localStorage.getItem(draftKey(fromId)) || '';
    destinationDraft = localStorage.getItem(draftKey(toId)) || '';
    localStorage.removeItem(draftKey(fromId));
  } catch {}
  const destinationVisible = composerSessionKey === toId;
  if (sourceDraft) {
    const input = document.getElementById('promptInput');
    const merged = mergeComposerText(destinationVisible ? input.value : destinationDraft, sourceDraft);
    writeSessionDraft(toId, merged);
    if (destinationVisible) {
      input.value = merged;
      composerDraftDirty = false;
      autosizePromptInput(input);
    }
  }

  const sourceImages = pendingImagesBySession.get(fromId) || [];
  if (sourceImages.length) {
    if (destinationVisible) {
      pendingImages = sourceImages.concat(pendingImages);
      renderAttachmentStrip();
    } else {
      pendingImagesBySession.set(toId, sourceImages.concat(pendingImagesBySession.get(toId) || []));
    }
  }
  pendingImagesBySession.delete(fromId);
}

// Failed sends and queue edits complete asynchronously. Restore their payload
// to the originating session even if another session now owns the composer.
function restorePromptToSession(sessionId, message, images) {
  if (sessionId) sessionId = composerOwnerKey(sessionId);
  let saved = '';
  try { saved = localStorage.getItem(draftKey(sessionId)) || ''; } catch {}
  const restored = message ? mergeComposerText(saved, message) : saved;
  writeSessionDraft(sessionId, restored);

  if (images?.length) {
    if (composerSessionKey === sessionId) {
      pendingImages = images.concat(pendingImages);
      renderAttachmentStrip();
    } else {
      pendingImagesBySession.set(sessionId, images.concat(pendingImagesBySession.get(sessionId) || []));
    }
  }

  if (composerSessionKey === sessionId && message) {
    const input = document.getElementById('promptInput');
    input.value = mergeComposerText(input.value, message);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
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
    if (message || pendingImages.length) {
      const starting = pendingSessionSpawns.has(currentSessionSpawnId);
      setStatus(starting
        ? 'Pi is still starting — your prompt is saved'
        : 'Pi did not start — your prompt is preserved', starting ? 'working' : 'error');
    }
    return;
  }
  if ((!message && !pendingImages.length) || !sessionState.currentSession) return;
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
    if (message || pendingImages.length) {
      const starting = pendingSessionSpawns.has(currentSessionSpawnId);
      setStatus(starting
        ? 'Pi is still starting — your prompt is saved'
        : 'Pi did not start — your prompt is preserved', starting ? 'working' : 'error');
    }
    return;
  }
  if ((!message && !pendingImages.length) || !sessionState.currentSession || !sessionState.currentSession.isActive) return;
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
  discardPrompt: key => { const owner = pendingComposerKey(key); clearDraft(owner); pendingImagesBySession.delete(owner); },
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

const extUIState = {
  widgets: new Map(),      // key -> { el, collapsed } — current session only
  statuses: new Map(),     // key -> el — current session only
  collapsed: new Map(),    // `host sessionId|key` -> bool — survives session switches
};

function clearExtensionUI() {
  for (const entry of extUIState.widgets.values()) {
    clearTimeout(entry.removeTimer);
    entry.el.remove();
  }
  extUIState.widgets.clear();
  for (const badge of extUIState.statuses.values()) { clearTimeout(badge.removeTimer); badge.remove(); }
  extUIState.statuses.clear();
  syncExtStatusRow();
  // Dialogs are stashed, not destroyed: detaching keeps in-progress
  // selections/inputs intact, the stream replay re-docks them when switching
  // back, and extension_ui_state drops any resolved in the meantime.
  for (const entry of openExtDialogs.values()) entry.el.remove();
  updateExtDialogDock();
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

function handleExtensionUI(req, sessionId) {
  // Extension strings arrive styled for the terminal (theme.fg ANSI codes) —
  // strip them everywhere up front instead of per render site.
  if (Array.isArray(req.widgetLines)) req.widgetLines = req.widgetLines.map(stripAnsi);
  if (Array.isArray(req.options)) req.options = req.options.map(o => typeof o === 'string' ? stripAnsi(o) : o);
  if (Array.isArray(req.questions)) {
    req.questions = req.questions.map(question => {
      if (!question || typeof question !== 'object') return question;
      return {
        ...question,
        question: typeof question.question === 'string' ? stripAnsi(question.question) : question.question,
        header: typeof question.header === 'string' ? stripAnsi(question.header) : question.header,
        options: Array.isArray(question.options) ? question.options.map(option => {
          if (!option || typeof option !== 'object') return option;
          return {
            ...option,
            label: typeof option.label === 'string' ? stripAnsi(option.label) : option.label,
            description: typeof option.description === 'string' ? stripAnsi(option.description) : option.description,
            preview: typeof option.preview === 'string' ? stripAnsi(option.preview) : option.preview,
          };
        }) : [],
      };
    });
  }
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
      showExtDialog(req, sessionId);
      break;
    case 'ask':
      showExtAskDialog(req, sessionId);
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

// A cleared widget fades out only after a visible hold: the grace absorbs
// clear/set churn from hosts re-projecting mid-turn, the fade is the
// collapse animation once the clear proves genuine.
const EXT_WIDGET_REMOVE_GRACE_MS = 500;
const EXT_WIDGET_REMOVE_FADE_MS = 200;

function showExtWidget(key, lines, placement) {
  // Pi's default placement is above the editor. Keep widgets near the prompt
  // instead of at the top of the scrollback where they are easy to miss.
  // Look the element up via state, not a selector built from the raw key —
  // a key containing a quote made querySelector throw, so the widget
  // silently never rendered.
  let container = extUIState.widgets.get(key)?.el;
  if (container && !container.isConnected) container = null;

  const existing = extUIState.widgets.get(key);
  if (!lines || !lines.length) {
    if (!container) { extUIState.widgets.delete(key); return; }
    // Keep the map entry and hold the card visible through a grace window
    // before the fade starts. Hosts re-project widgets while a turn runs,
    // and hiding on the clear half of a clear/set pair collapses and
    // reopens the frame on every rewrite — the flicker a todo-style widget
    // shows during active sessions. A re-set inside either window cancels
    // the pending phase and reuses this very element instead of stacking a
    // second card while a stale timer destroys the fresh one.
    clearTimeout(existing.removeTimer);
    existing.removeTimer = setTimeout(() => {
      if (extUIState.widgets.get(key) !== existing) return;
      container.classList.add('hidden');
      existing.removeTimer = setTimeout(() => {
        existing.removeTimer = null;
        container.remove();
        if (extUIState.widgets.get(key) === existing) extUIState.widgets.delete(key);
      }, EXT_WIDGET_REMOVE_FADE_MS);
    }, EXT_WIDGET_REMOVE_GRACE_MS);
    return;
  }
  if (existing?.removeTimer) { clearTimeout(existing.removeTimer); existing.removeTimer = null; }
  const collapsedKey = sessionRefKey(sessionState.currentSession) + '|' + key;
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
  // Identical re-sets (forced pushes, reconnect replays) skip the text swap —
  // replacing the text node forces a reflow that reads as a flicker.
  const bodyText = lines.join('\n');
  const body = container.querySelector('.ext-ui-widget-body');
  if (body.textContent !== bodyText) body.textContent = bodyText;
  extUIState.widgets.set(key, { el: container, collapsed: container.classList.contains('collapsed') });
}

let extStatusPrefApplied = false;
// Grace before a cleared status badge is actually removed. Hosts re-project
// their status lines at turn boundaries (OMP's goal/advisor/prewalk reads
// fire on every status-line render), and a clear/set pair inside the window
// would otherwise destroy and recreate the badge — replaying its pop
// animation and reading as rapid flickering. Matches showExtWidget's
// cancellable-removal treatment.
const EXT_STATUS_REMOVE_GRACE_MS = 500;
let extStatusRowObserver = null;

// Status lines live in their own strip under the header badges, not inline
// with them: a host's goal/advisor line is a whole sentence (OMP clips at 60
// chars), and inside the badge row it wrapped into a six-line block that
// doubled the header height on a phone and pushed the model selector out of
// reach. Collapsed (the default) the strip is one clipped line; the ▾ opens
// it to full text, like the widget cards above the composer.
function extStatusRow() {
  return document.getElementById('extUiStatuses');
}

function syncExtStatusRow() {
  const row = extStatusRow();
  if (!row) return;
  if (!extStatusPrefApplied) {
    extStatusPrefApplied = true;
    let open = false;
    try { open = localStorage.getItem('pi-dish-ext-status-open') === '1'; } catch {}
    if (open) toggleExtStatusRow();
  }
  const items = document.getElementById('extUiStatusItems');
  row.style.display = items && items.children.length ? '' : 'none';
  const toggle = document.getElementById('extUiStatusToggle');
  if (toggle && items) {
    // The arrow only earns its place when the collapsed strip actually clips
    // text: a single short line expands to exactly itself, so an always-on
    // toggle read as a dead control. Expanded always keeps it — that is how
    // the strip collapses again. The clip happens inside each badge (they
    // shrink to max-width:100% and ellipsis their own text), so measure the
    // badges, not the row.
    const clipped = () => [...items.children].some((el) => el.scrollWidth > el.clientWidth + 1);
    const update = () => {
      toggle.style.display = !row.classList.contains('collapsed') || clipped() ? '' : 'none';
    };
    update();
    // Width changes (window, sidebar, a sibling badge) create or remove the
    // clip without a status event — re-measure on row resize.
    if (!extStatusRowObserver && typeof ResizeObserver !== 'undefined') {
      extStatusRowObserver = new ResizeObserver(update);
      extStatusRowObserver.observe(items);
    }
  }
}

function toggleExtStatusRow() {
  const row = extStatusRow();
  if (!row) return;
  const collapsed = !row.classList.contains('collapsed');
  row.classList.toggle('collapsed', collapsed);
  const toggle = document.getElementById('extUiStatusToggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Show full status' : 'Collapse status';
  }
  try { localStorage.setItem('pi-dish-ext-status-open', collapsed ? '0' : '1'); } catch {}
  syncExtStatusRow();
}

function showExtStatus(key, text) {
  const items = document.getElementById('extUiStatusItems');
  if (!items) return;

  // State-map lookup for the same reason as showExtWidget: the raw key is
  // not safe to splice into a CSS selector.
  let badge = extUIState.statuses.get(key);
  if (badge && !badge.isConnected) badge = null;

  if (!text) {
    if (!badge) {
      extUIState.statuses.delete(key);
      syncExtStatusRow();
      return;
    }
    // Cancellable removal: a re-set inside the grace window reuses this very
    // badge instead of stacking a fresh one (with its pop animation) while
    // the stale timer still fires — the clear/set churn of re-projected
    // goal/advisor lines read as constant flickering.
    clearTimeout(badge.removeTimer);
    badge.removeTimer = setTimeout(() => {
      badge.remove();
      if (extUIState.statuses.get(key) === badge) extUIState.statuses.delete(key);
      syncExtStatusRow();
    }, EXT_STATUS_REMOVE_GRACE_MS);
    return;
  }
  if (badge?.removeTimer) { clearTimeout(badge.removeTimer); badge.removeTimer = null; }

  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'ext-ui-status-badge';
    badge.dataset.statusKey = key;
    items.appendChild(badge);
  }

  // Identical re-sets (forced pushes, reconnect replays) skip the text swap —
  // replacing the text node forces a reflow that reads as a flicker.
  if (badge.textContent !== text) badge.textContent = text;
  // The collapsed strip clips, so the full line stays reachable on hover and
  // as the accessible name.
  const title = `${text}\n(status from ${key})`;
  if (badge.title !== title) badge.title = title;
  extUIState.statuses.set(key, badge);
  syncExtStatusRow();
}

// Interactive dialogs: extensions block on select/confirm/input/editor/ask.
// The dialog docks as a card above the owning session's chat box — the
// transcript, composer, and sidebar all stay usable — and a minimize button
// backgrounds it to a slim bar. The answer POSTs back and the session
// unblocks. For TUI sessions the same dialog is also on screen in the
// terminal — whoever answers first wins (the server tells us via
// extension_ui_resolved).
const openExtDialogs = new Map(); // host/session/request key -> stashed dialog
function extDialogKey(requestId, sessionId, hostId = sessionState.sessionHostId(sessionId)) {
  return JSON.stringify([hostId, sessionId, requestId]);
}

// Content signature for re-emission dedupe: some hosts re-invoke the dialog
// primitive (fresh request id each time) while one is already open. Identity
// is the payload, not the id.
function extDialogSig(req) {
  try {
    if (req.method === 'ask') return 'ask:' + JSON.stringify(req.questions || []);
    return `${req.method}:${JSON.stringify([req.title, req.message, req.options, req.placeholder, req.prefill])}`;
  } catch {
    return null;
  }
}

// An identical dialog already docked (or stashed) for this session absorbs
// the re-emission; the new request id is left for turn-end cleanup.
function findDuplicateExtDialog(req, sessionId) {
  const sig = extDialogSig(req);
  if (sig === null) return null;
  for (const entry of openExtDialogs.values()) {
    if (entry.sessionKey === keyForSessionId(sessionId) && entry.sig === sig) return entry;
  }
  return null;
}

function getExtDialogDock() {
  const inputArea = document.querySelector('.input-area');
  if (!inputArea) return null;
  let dock = document.getElementById('extUiDialogs');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'extUiDialogs';
    dock.className = 'ext-ui-dialog-dock';
    inputArea.insertBefore(dock, document.getElementById('attachmentStrip'));
  }
  return dock;
}

// Drop the dock element once it empties. The composer stays put either way —
// the dock sits above it like an extension widget and caps its own height.
function updateExtDialogDock() {
  const dock = document.getElementById('extUiDialogs');
  if (dock && !dock.children.length) dock.remove();
}

function dockExtDialog(entry) {
  const dock = getExtDialogDock();
  if (!dock) return;
  if (entry.el.parentNode !== dock) dock.appendChild(entry.el);
  entry.el.classList.toggle('minimized', entry.minimized);
  updateExtDialogDock();
}

function setExtDialogMinimized(requestId, minimized) {
  const entry = openExtDialogs.get(requestId);
  if (!entry) return;
  entry.minimized = minimized;
  entry.el.classList.toggle('minimized', minimized);
  updateExtDialogDock();
  if (!minimized) {
    entry.el.querySelector('.ext-ui-ask-option, .ext-ui-dialog-option, .ext-ui-dialog-input, .ext-ui-dialog-editor')?.focus();
  }
}

function sendExtDialogResponse(dialogKey, response) {
  const entry = openExtDialogs.get(dialogKey);
  if (!entry) return;
  const owner = sessionState.captureSelection();
  apiSend(entry.hostId, `/api/sessions/${encodeURIComponent(entry.sessionId)}/ui-response`, { requestId: entry.requestId, ...response })
    .catch(e => {
      if (sessionState.ownsSelection(owner) && owner.id === entry.sessionId && owner.host === (entry.hostId || null)) {
        setStatus('Dialog response failed: ' + e.message, 'error');
      }
    });
  dismissExtDialog(dialogKey);
}

function dismissExtDialog(requestId) {
  const entry = openExtDialogs.get(requestId);
  if (!entry) return;
  entry.el.remove();
  openExtDialogs.delete(requestId);
  updateExtDialogDock();
}

// Shared chrome: title row with minimize (background) and close (cancel),
// then the per-method body, then the label shown while minimized.
function buildExtDialogCard(requestId, { title, bodyHtml, footerHtml, collapsedLabel, onClose }) {
  const card = document.createElement('div');
  card.className = 'ext-ui-dialog-modal ext-ui-docked-dialog';
  card.innerHTML = `
    <div class="ext-ui-dialog-head">
      <div class="ext-ui-dialog-title">${escapeHtml(title)}</div>
      <button class="ext-ui-dialog-min" title="Background — keep the composer usable and answer later">–</button>
      <button class="ext-ui-dialog-close" title="Dismiss (cancel)">×</button>
    </div>
    <div class="ext-ui-dialog-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="ext-ui-dialog-foot">${footerHtml}</div>` : ''}
    <div class="ext-ui-dialog-collapsed-label">${escapeHtml(collapsedLabel)}</div>`;
  card.querySelector('.ext-ui-dialog-min').addEventListener('click', (e) => {
    e.stopPropagation();
    setExtDialogMinimized(requestId, true);
  });
  card.querySelector('.ext-ui-dialog-close').addEventListener('click', (e) => {
    e.stopPropagation();
    onClose();
  });
  card.addEventListener('click', () => {
    if (openExtDialogs.get(requestId)?.minimized) setExtDialogMinimized(requestId, false);
  });
  return card;
}

function showExtAskDialog(req, sessionId) {
  if (!req.id) return;
  const hostId = sessionState.sessionHostId(sessionId);
  const dialogKey = extDialogKey(req.id, sessionId, hostId);
  // Replayed request for a dialog we still hold (e.g. switch-back): re-dock
  // the live element so in-progress selections survive.
  const existing = openExtDialogs.get(dialogKey);
  if (existing) {
    dockExtDialog(existing);
    return;
  }
  const duplicate = findDuplicateExtDialog(req, sessionId);
  if (duplicate) {
    dockExtDialog(duplicate);
    return;
  }
  const questions = Array.isArray(req.questions)
    ? req.questions.filter(question => question && typeof question === 'object' && typeof question.id === 'string')
    : [];
  if (!questions.length) {
    showExtToast('Ask dialog had no valid questions', 'warning');
    return;
  }

  const card = buildExtDialogCard(dialogKey, {
    title: questions.length === 1 ? 'Question' : `${questions.length} questions`,
    collapsedLabel: questions.length === 1
      ? `Question pending: ${questions[0].question || ''}`
      : `${questions.length} questions pending — click to answer`,
    onClose: () => sendExtDialogResponse(dialogKey, { cancelled: true }),
    bodyHtml: `
    <div class="ext-ui-ask-questions">
      ${questions.map((question, questionIndex) => {
        const options = Array.isArray(question.options) ? question.options : [];
        return `<section class="ext-ui-ask-question" data-question-index="${questionIndex}">
          ${question.header ? `<div class="ext-ui-ask-header">${escapeHtml(question.header)}</div>` : ''}
          <div class="ext-ui-ask-prompt">${escapeHtml(question.question || '')}</div>
          <div class="ext-ui-dialog-options">
            ${options.map((option, optionIndex) => {
              const normalized = typeof option === 'string' ? { label: option } : option || {};
              const recommended = question.recommended === optionIndex;
              return `<button type="button" class="ext-ui-dialog-option ext-ui-ask-option${recommended ? ' recommended' : ''}"
                data-question-index="${questionIndex}" data-option-index="${optionIndex}" aria-pressed="false">
                <span class="ext-ui-ask-marker">${question.multi ? '☐' : '○'}</span>
                <span class="ext-ui-ask-option-copy">
                  <span class="ext-ui-ask-option-label">${escapeHtml(normalized.label || '')}${recommended ? ' <span class="ext-ui-ask-recommended">Recommended</span>' : ''}</span>
                  ${normalized.description ? `<span class="ext-ui-ask-option-description">${escapeHtml(normalized.description)}</span>` : ''}
                  ${normalized.preview ? `<pre class="ext-ui-ask-option-preview">${escapeHtml(normalized.preview)}</pre>` : ''}
                </span>
              </button>`;
            }).join('')}
          </div>
          <input class="ext-ui-dialog-input ext-ui-ask-custom" data-question-index="${questionIndex}"
            type="text" placeholder="Other (type your own)">
          <input class="ext-ui-dialog-input ext-ui-ask-note" data-question-index="${questionIndex}"
            type="text" placeholder="Optional note">
          <div class="ext-ui-ask-error" hidden>Choose an option or enter your own answer.</div>
        </section>`;
      }).join('')}
    </div>
    `,
    footerHtml: `
    <div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn" data-action="chat">Chat about this</button>
      <button class="ext-ui-dialog-btn primary" data-action="submit-ask">Submit</button>
    </div>`,
  });
  card.classList.add('ext-ui-ask-modal');

  const selections = questions.map(() => new Set());
  card.querySelectorAll('.ext-ui-ask-option').forEach(button => {
    button.addEventListener('click', () => {
      const questionIndex = Number(button.dataset.questionIndex);
      const optionIndex = Number(button.dataset.optionIndex);
      const question = questions[questionIndex];
      if (!question || !Number.isInteger(optionIndex)) return;
      const selected = selections[questionIndex];
      if (question.multi) {
        if (selected.has(optionIndex)) selected.delete(optionIndex);
        else selected.add(optionIndex);
      } else {
        selected.clear();
        selected.add(optionIndex);
      }
      card.querySelectorAll(`.ext-ui-ask-option[data-question-index="${questionIndex}"]`).forEach(candidate => {
        const index = Number(candidate.dataset.optionIndex);
        const active = selected.has(index);
        candidate.classList.toggle('selected', active);
        candidate.setAttribute('aria-pressed', active ? 'true' : 'false');
        candidate.querySelector('.ext-ui-ask-marker').textContent = question.multi
          ? (active ? '☑' : '☐')
          : (active ? '●' : '○');
      });
      const custom = card.querySelector(`.ext-ui-ask-custom[data-question-index="${questionIndex}"]`);
      if (!question.multi && custom) custom.value = '';
      card.querySelector(`.ext-ui-ask-question[data-question-index="${questionIndex}"] .ext-ui-ask-error`)?.setAttribute('hidden', '');
    });
  });

  card.querySelectorAll('.ext-ui-ask-custom').forEach(input => {
    input.addEventListener('input', () => {
      const questionIndex = Number(input.dataset.questionIndex);
      const question = questions[questionIndex];
      if (!question || question.multi || !input.value.trim()) return;
      selections[questionIndex].clear();
      card.querySelectorAll(`.ext-ui-ask-option[data-question-index="${questionIndex}"]`).forEach(candidate => {
        candidate.classList.remove('selected');
        candidate.setAttribute('aria-pressed', 'false');
        candidate.querySelector('.ext-ui-ask-marker').textContent = '○';
      });
    });
  });

  card.querySelector('[data-action="chat"]').addEventListener('click', () => {
    sendExtDialogResponse(dialogKey, { value: { kind: 'chat' } });
  });
  card.querySelector('[data-action="submit-ask"]').addEventListener('click', () => {
    let invalid = null;
    const results = questions.map((question, questionIndex) => {
      const options = Array.isArray(question.options) ? question.options : [];
      const customField = card.querySelector(`.ext-ui-ask-custom[data-question-index="${questionIndex}"]`);
      const noteField = card.querySelector(`.ext-ui-ask-note[data-question-index="${questionIndex}"]`);
      const customInput = customField?.value.trim() || undefined;
      const note = noteField?.value.trim() || undefined;
      const selectedOptions = [...selections[questionIndex]]
        .sort((a, b) => a - b)
        .map(index => {
          const option = options[index];
          return typeof option === 'string' ? option : option?.label;
        })
        .filter(label => typeof label === 'string');
      if (!question.multi && selectedOptions.length === 0 && customInput === undefined) {
        const section = card.querySelector(`.ext-ui-ask-question[data-question-index="${questionIndex}"]`);
        section?.querySelector('.ext-ui-ask-error')?.removeAttribute('hidden');
        invalid ||= section;
      }
      return {
        id: question.id,
        question: question.question || '',
        options: options.map(option => typeof option === 'string' ? option : option?.label || ''),
        multi: question.multi === true,
        selectedOptions,
        ...(customInput !== undefined ? { customInput } : {}),
        ...(note !== undefined ? { note } : {}),
      };
    });
    if (invalid) {
      invalid.scrollIntoView({ block: 'nearest' });
      invalid.querySelector('.ext-ui-ask-option, .ext-ui-ask-custom')?.focus();
      return;
    }
    sendExtDialogResponse(dialogKey, { value: { kind: 'submit', results } });
  });

  const entry = { el: card, sessionId, hostId, sessionKey: sessionKey(hostId, sessionId), requestId: req.id, minimized: false, sig: extDialogSig(req) };
  openExtDialogs.set(dialogKey, entry);
  dockExtDialog(entry);
  card.querySelector('.ext-ui-ask-option, .ext-ui-ask-custom')?.focus();
}

function showExtDialog(req, sessionId) {
  if (!req.id) return;
  const hostId = sessionState.sessionHostId(sessionId);
  const dialogKey = extDialogKey(req.id, sessionId, hostId);
  const existing = openExtDialogs.get(dialogKey);
  if (existing) {
    dockExtDialog(existing);
    return;
  }
  const duplicate = findDuplicateExtDialog(req, sessionId);
  if (duplicate) {
    dockExtDialog(duplicate);
    return;
  }

  let bodyHtml = '';
  if (req.message) bodyHtml += `<div class="ext-ui-dialog-message">${escapeHtml(req.message)}</div>`;

  if (req.method === 'select') {
    bodyHtml += '<div class="ext-ui-dialog-options">' +
      (req.options || []).map((opt, i) => {
        const label = typeof opt === 'string' ? opt : opt?.label || '';
        const description = typeof opt === 'object' && opt?.description
          ? `<span class="ext-ui-ask-option-description">${escapeHtml(opt.description)}</span>` : '';
        return `<button class="ext-ui-dialog-option" data-option-index="${i}">
          <span class="ext-ui-ask-option-label">${escapeHtml(label)}</span>${description}
        </button>`;
      }).join('') + '</div>';
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

  const title = req.title || { select: 'Select', confirm: 'Confirm', input: 'Input', editor: 'Editor' }[req.method] || 'Dialog';
  const card = buildExtDialogCard(dialogKey, {
    title,
    bodyHtml,
    collapsedLabel: `${title} pending — click to answer`,
    onClose: () => sendExtDialogResponse(dialogKey, { cancelled: true }),
  });

  card.querySelectorAll('.ext-ui-dialog-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const option = (req.options || [])[Number(btn.dataset.optionIndex)];
      sendExtDialogResponse(dialogKey, { value: typeof option === 'string' ? option : option?.label || '' });
    });
  });
  card.querySelectorAll('.ext-ui-dialog-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'yes') sendExtDialogResponse(dialogKey, { confirmed: true });
      else if (action === 'no') sendExtDialogResponse(dialogKey, { confirmed: false });
      else if (action === 'cancel') sendExtDialogResponse(dialogKey, { cancelled: true });
      else if (action === 'submit') {
        const field = card.querySelector('.ext-ui-dialog-input, .ext-ui-dialog-editor');
        sendExtDialogResponse(dialogKey, { value: field ? field.value : '' });
      }
    });
  });

  const entry = { el: card, sessionId, hostId, sessionKey: sessionKey(hostId, sessionId), requestId: req.id, minimized: false, sig: extDialogSig(req) };
  openExtDialogs.set(dialogKey, entry);
  dockExtDialog(entry);
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
    // Marked's GFM tokenizer accepts both ~text~ and ~~text~~ as deletion.
    // Models commonly use a single tilde literally (paths, approximation,
    // shell syntax), so require the explicit double-tilde form instead.
    tokenizer: {
      del(src) {
        const cap = /^(~~)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/.exec(src);
        if (!cap) return;
        return {
          type: 'del',
          raw: cap[0],
          text: cap[2],
          tokens: this.lexer.inlineTokens(cap[2]),
        };
      },
    },
    renderer: {
      html(html) { return escapeHtml(typeof html === 'string' ? html : (html && html.text) || ''); },
    },
    walkTokens(token) {
      if (token.type === 'link' || token.type === 'image') token.href = sanitizeMarkdownUrl(token.href);
    },
    extensions: typeof createMathExtensions === 'function' ? createMathExtensions() : [],
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

// Post-render pass over final markdown: syntax-highlight fenced code blocks,
// give each one a copy button, and turn diagram fences into rendered
// diagrams. Runs after final renders only — streaming re-renders skip it to
// stay cheap (and half a diagram is not parseable anyway) — and must stay
// idempotent (it re-runs on every append/prepend). The wrapper div keeps the
// button pinned while the <pre> scrolls horizontally (an absolutely
// positioned child of the <pre> would scroll away with the overflowing
// content).
function applyHighlight(el) {
  const root = el || document.getElementById('messages');
  if (!root) return;
  const pendingHighlight = [];
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
    const kind = diagramKindForFence(fenceLanguage(code), code.textContent);
    if (kind) {
      prepareDiagramBlock(pre && pre.parentElement, kind);
      // hljs has no mermaid grammar in the common bundle, so highlighting the
      // source view would only be auto-detection noise.
      code.dataset.highlighted = 'diagram';
    }
    if (code.dataset.highlighted) return;
    if (typeof hljs === 'undefined') {
      pendingHighlight.push(code);
      return;
    }
    try { hljs.highlightElement(code); } catch (e) {}
  });
  if (pendingHighlight.length) {
    loadHighlightAssets().then(() => {
      for (const code of pendingHighlight) {
        if (code.dataset.highlighted) continue;
        try { hljs.highlightElement(code); } catch (e) {}
      }
    }).catch(() => {});
  }
  renderDiagrams(root);
  linkifyFilePaths(root);
}

/** The fence's declared language, from marked's `language-x` class. */
function fenceLanguage(code) {
  const cls = [...code.classList].find((c) => c.startsWith('language-'));
  return cls ? cls.slice('language-'.length) : '';
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
        // .diagram-render holds an SVG: a <span> spliced into an SVG <text>
        // renders nothing, so a linkified label would silently vanish.
        return n.parentElement && !n.parentElement.closest('code, a, pre, .file-link, .katex, .math-block, .diagram-render')
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

/**
 * Lazily pull a vendored asset into <head>. Heavy or feature-specific vendor
 * bundles are loaded only when the corresponding surface is used.
 */
function loadVendorAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Failed to load ${attrs.src || attrs.href}`));
    document.head.appendChild(el);
  });
}


let mathAssetsPromise = null;
function loadMathAssets() {
  if (mathAssetsPromise) return mathAssetsPromise;
  mathAssetsPromise = Promise.all([
    loadVendorAsset('link', { rel: 'stylesheet', href: 'vendor/katex.min.css' }),
    loadVendorAsset('script', { src: 'vendor/katex.min.js' }),
  ]).catch((err) => {
    mathAssetsPromise = null;
    throw err;
  });
  return mathAssetsPromise;
}
let highlightAssetsPromise = null;
function loadHighlightAssets() {
  if (highlightAssetsPromise) return highlightAssetsPromise;
  highlightAssetsPromise = Promise.all([
    loadVendorAsset('link', { rel: 'stylesheet', href: 'vendor/hljs-theme.min.css' }),
    loadVendorAsset('script', { src: 'vendor/highlight.js' }),
  ]).then(() => hljs).catch((err) => {
    highlightAssetsPromise = null;
    throw err;
  });
  return highlightAssetsPromise;
}

// =========================================================================
// Diagrams (mermaid)
//
// Agents write mermaid — flowcharts, sequence/class/state diagrams, ER, gantt
// — into fenced blocks, and before this the reader got the source. Rendering
// lives in the same final-render post-pass as highlighting: never mid-stream
// (a half-streamed diagram doesn't parse), always idempotent, and the source
// <pre> is never removed — it stays in the DOM behind the SVG, which keeps the
// copy button, focus mode, in-session search and anchored comments working off
// the same text they always did.
//
// mermaid.min.js is 3.5MB (~1MB gzipped), so it is vendored but *lazy*: no
// transcript without a diagram ever downloads it, matching the xterm rule.
// =========================================================================

let mermaidPromise = null;
let diagramSeq = 0;

function loadMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = loadVendorAsset('script', { src: 'vendor/mermaid.min.js' }).then(() => {
    if (typeof mermaid === 'undefined') throw new Error('mermaid did not load');
    mermaid.initialize(mermaidConfig());
    return mermaid;
  }).catch((err) => {
    mermaidPromise = null; // a dropped LAN connection must not be permanent
    throw err;
  });
  return mermaidPromise;
}

/**
 * mermaid config derived from the live theme tokens, the way terminalTheme()
 * derives xterm's palette. Tokens are resolved to concrete hex first: several
 * are color-mix() over another token, and mermaid does color math (lighten,
 * darken, contrast) on whatever it is handed.
 */
function mermaidConfig() {
  const css = getComputedStyle(document.documentElement);
  const hex = (name, fallback) => resolveColorToHex(css.getPropertyValue(name).trim()) || fallback;
  const bg = hex('--bg-darker', '#00212b');
  const card = hex('--bg-card', '#073642');
  const hover = hex('--bg-hover', '#0b4354');
  const text = hex('--text-bright', '#dbe5e6');
  const muted = hex('--text-muted', '#6f8b93');
  const border = hex('--accent-dim', '#1c6ba3');
  const line = hex('--border', '#11475a');
  return {
    startOnLoad: false,
    // The SVG is written into transcript DOM, so mermaid's own sanitizer is
    // what keeps diagram-authored HTML labels (<br>, <b>) inert.
    securityLevel: 'strict',
    // A failed render must leave the code block standing, not mermaid's own
    // error graphic.
    suppressErrorRendering: true,
    theme: 'base',
    fontFamily: getComputedStyle(document.body).fontFamily,
    flowchart: { htmlLabels: true, useMaxWidth: true },
    themeVariables: {
      darkMode: isDarkColorHex(bg),
      background: bg,
      primaryColor: card,
      primaryTextColor: text,
      primaryBorderColor: border,
      secondaryColor: hover,
      secondaryTextColor: text,
      tertiaryColor: bg,
      tertiaryTextColor: text,
      lineColor: muted,
      textColor: text,
      mainBkg: card,
      nodeBorder: border,
      clusterBkg: bg,
      clusterBorder: line,
      titleColor: text,
      edgeLabelBackground: bg,
      labelBoxBkgColor: card,
      labelBoxBorderColor: border,
      actorBkg: card,
      actorBorder: border,
      actorTextColor: text,
      signalColor: muted,
      signalTextColor: text,
      noteBkgColor: hover,
      noteBorderColor: border,
      noteTextColor: text,
      fontSize: '14px',
    },
  };
}

/**
 * Equip a wrapped code block for diagram rendering: the source/zoom controls
 * join the copy button in one actions row. Idempotent — `data-diagram` is the
 * marker, and CSS keeps the controls hidden until an SVG actually lands.
 */
function prepareDiagramBlock(block, kind) {
  if (!block || block.dataset.diagram) return;
  block.dataset.diagram = kind;
  block.classList.add('diagram-block');
  const actions = document.createElement('div');
  actions.className = 'diagram-actions';
  const source = document.createElement('button');
  source.className = 'diagram-btn diagram-source-btn';
  source.title = 'Show diagram source';
  source.textContent = '</>';
  const zoom = document.createElement('button');
  zoom.className = 'diagram-btn diagram-zoom-btn';
  zoom.title = 'Zoom diagram';
  zoom.textContent = '⤢';
  actions.append(source, zoom);
  const copy = block.querySelector('.code-copy-btn');
  if (copy) actions.append(copy);
  block.prepend(actions);
}

/**
 * Render every diagram block under `root` that hasn't been rendered yet.
 * Fire-and-forget: the code block stays on screen until the SVG replaces it,
 * so a slow (or absent) renderer never blanks content.
 */
function renderDiagrams(root) {
  const blocks = [...root.querySelectorAll('.diagram-block:not([data-diagram-state])')];
  if (!blocks.length) return;
  for (const block of blocks) block.dataset.diagramState = 'loading';
  // Deferred a task, never started inside the render pass that found the
  // blocks. mermaid.render() does its parsing and layout in heavy chunks
  // between awaits, so once mermaid is loaded a render started here would run
  // in the same microtask checkpoint as the transcript load's own
  // continuations (loadMessages → selectSession → whatever awaits them),
  // paying the diagram layout before the text paints. It also broke the
  // browser smoke: a CDP `awaitPromise` holds the awaited promise only weakly
  // once it settles, and a GC in that checkpoint reported it "collected"
  // (Playwright's "Execution context was destroyed") while the app's own
  // chain completed fine. A task boundary separates the two.
  setTimeout(() => {
    loadMermaid().then(
      (m) => { for (const block of blocks) renderDiagramBlock(m, block); },
      () => { for (const block of blocks) setDiagramError(block, 'diagram renderer unavailable'); },
    );
  }, 0);
}

async function renderDiagramBlock(m, block) {
  const code = block.querySelector('pre code');
  if (!code) { block.dataset.diagramState = 'error'; return; }
  // The SVG is taller than its source, so a reader sitting at the bottom of a
  // live feed must be carried down with it.
  const feed = document.getElementById('messages');
  const pinned = feed && feed.contains(block) && isPinnedToBottom(feed);
  try {
    // mermaid measures text in a throwaway element it appends to <body>, so
    // this works for a block inside a closed tool group or a cached
    // (detached) transcript fragment.
    const { svg } = await m.render(`pi-dish-diagram-${++diagramSeq}`, code.textContent);
    let figure = block.querySelector('.diagram-render');
    if (!figure) {
      figure = document.createElement('div');
      figure.className = 'diagram-render';
      block.insertBefore(figure, block.querySelector('pre'));
    }
    // mermaid sanitized this string (securityLevel strict). Diagram `click`
    // interactions are deliberately left unbound — bindFunctions() would wire
    // diagram-authored callbacks and link navigation into the app.
    figure.innerHTML = svg;
    block.querySelector('.diagram-error')?.remove();
    block.classList.remove('diagram-failed');
    block.dataset.diagramState = 'rendered';
    if (pinned) scrollToBottom(feed);
  } catch (err) {
    // mermaid's message is a multi-line parser dump; its first line ("Parse
    // error on line 2:") is the only part worth a quiet note.
    setDiagramError(block, String((err && err.message) || err).split('\n')[0].replace(/:\s*$/, ''));
  }
}

/** Keep the source visible and say why it stayed source. */
function setDiagramError(block, message) {
  block.dataset.diagramState = 'error';
  block.classList.add('diagram-failed');
  let note = block.querySelector('.diagram-error');
  if (!note) {
    note = document.createElement('div');
    note.className = 'diagram-error';
    block.insertBefore(note, block.querySelector('pre'));
  }
  note.textContent = `⚠ ${message}`;
}

function toggleDiagramSource(block) {
  const showing = block.classList.toggle('diagram-source');
  const btn = block.querySelector('.diagram-source-btn');
  if (btn) {
    btn.textContent = showing ? '▦' : '</>';
    btn.title = showing ? 'Show diagram' : 'Show diagram source';
  }
}

/**
 * Zoom a rendered diagram. Inside the reading column a wide flowchart shrinks
 * to unreadable, so the overlay shows the SVG at its own size in a scrollable
 * stage with explicit zoom steps — a phone has no wheel, and pinch-zoom inside
 * a fixed overlay is not dependable.
 */
function openDiagramLightbox(block) {
  const svg = block.querySelector('.diagram-render svg');
  if (!svg) return;
  const box = svg.viewBox && svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  const baseW = (box && box.width) || rect.width || 800;
  const baseH = (box && box.height) || rect.height || 600;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay diagram-lightbox';
  const bar = document.createElement('div');
  bar.className = 'diagram-zoom-bar';
  const stage = document.createElement('div');
  stage.className = 'diagram-stage';
  const clone = svg.cloneNode(true);
  clone.removeAttribute('style'); // mermaid's own max-width fights the zoom
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  stage.appendChild(clone);
  overlay.append(bar, stage);
  document.body.appendChild(overlay);

  const fitScale = () => Math.min(1, (stage.clientWidth - 24) / baseW, (stage.clientHeight - 24) / baseH) || 1;
  let scale = fitScale();
  const label = document.createElement('span');
  label.className = 'diagram-zoom-label';
  const apply = () => {
    clone.style.width = `${Math.round(baseW * scale)}px`;
    clone.style.height = `${Math.round(baseH * scale)}px`;
    label.textContent = `${Math.round(scale * 100)}%`;
  };
  const step = (factor) => { scale = Math.min(8, Math.max(0.1, scale * factor)); apply(); };
  const button = (text, title, onClick) => {
    const b = document.createElement('button');
    b.className = 'diagram-btn';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  bar.append(
    button('−', 'Zoom out', () => step(1 / 1.25)),
    label,
    button('+', 'Zoom in', () => step(1.25)),
    button('⤾', 'Fit to screen', () => { scale = fitScale(); apply(); }),
    button('✕', 'Close', () => overlay.remove()),
  );
  apply();
  // Backdrop only — clicks on the diagram itself are for panning/selection.
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target === stage) overlay.remove(); });
}

/**
 * Theme change: diagram colors are baked into each SVG at render time, so
 * re-initialize mermaid and re-render what's on screen — plus the retained
 * transcripts, which are restored without another applyHighlight pass.
 */
function refreshDiagramTheme() {
  if (!mermaidPromise) return; // nothing rendered yet; the next load reads the new tokens
  mermaidPromise.then((m) => {
    m.initialize(mermaidConfig());
    const roots = [document, ...[...transcriptCache.values()].map((entry) => entry.fragment)];
    for (const root of roots) {
      root.querySelectorAll('.diagram-block[data-diagram-state]').forEach((block) => {
        block.querySelector('.diagram-render')?.remove();
        delete block.dataset.diagramState;
      });
      renderDiagrams(root);
    }
  }).catch(() => {});
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
var treeOwner = null;
var treeViewGeneration = 0;

function ownsTree(owner, generation) {
  return owner === treeOwner && generation === treeViewGeneration && sessionState.ownsSelection(owner);
}
var treeToolCallMap = new Map();

async function openTreeModal() {
  if (!sessionState.currentSession) return;
  closeTreeModal();
  const owner = sessionState.captureSelection();
  const generation = ++treeViewGeneration;
  treeOwner = owner;
  treeData = null;
  pendingBranchId = null;
  setStatus('Loading tree...', 'working');
  try {
    const res = await apiFetch(owner.host, '/api/sessions/' + encodeURIComponent(owner.id) + '/tree');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (!ownsTree(owner, generation)) return;
    treeData = data;
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
  } catch (e) {
    if (ownsTree(owner, generation)) setStatus('Failed to load tree: ' + e.message, 'error');
  }
}

function closeTreeModal() {
  treeViewGeneration += 1;
  treeOwner = null;
  pendingBranchId = null;
  document.getElementById('treeModal').style.display = 'none';
  treeData = null;
}

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
  if (!treeData || !ownsTree(treeOwner, treeViewGeneration)) return;
  if (entryId === treeData.leafId) { closeTreeModal(); return; }
  document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
  var el = document.querySelector('.tree-node[data-id="' + entryId + '"]');
  if (el) el.classList.add('selected');
  pendingBranchId = entryId;
  // Summarize default persists across uses — retrying a prompt wants it off,
  // the explore-then-return workflow wants it on every time.
  var summarize = localStorage.getItem('pi-dish-branch-summarize') === '1';
  // OMP's public navigateTree API accepts { summarize } but has no custom
  // instructions field. Keep the supported summary toggle and avoid showing
  // an input the host would have to ignore.
  var allowSummaryInstructions = sessionState.currentSession.harnessId !== 'omp';
  document.getElementById('treeStatus').innerHTML =
    '<div class="branch-confirm">' +
      '<label class="branch-summarize-label"><input type="checkbox" id="branchSummarize"' + (summarize ? ' checked' : '') +
        ' onchange="toggleBranchInstructions()"> Summarize abandoned branch</label>' +
      (allowSummaryInstructions
        ? '<input type="text" id="branchInstructions" class="branch-instructions" placeholder="Summary instructions (optional)"' +
          (summarize ? '' : ' style="display:none"') + '>'
        : '') +
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
  const owner = treeOwner;
  const generation = treeViewGeneration;
  if (!treeData || !pendingBranchId || !ownsTree(owner, generation)) return;
  var entryId = pendingBranchId;
  var summarize = !!document.getElementById('branchSummarize')?.checked;
  var customInstructions = document.getElementById('branchInstructions')?.value.trim() || undefined;
  localStorage.setItem('pi-dish-branch-summarize', summarize ? '1' : '0');
  var btn = document.getElementById('branchGoBtn');
  if (btn) { btn.disabled = true; btn.textContent = summarize ? 'Summarizing…' : 'Branching…'; }
  setStatus(summarize ? 'Summarizing abandoned branch…' : 'Branching...', 'working');
  try {
    var data = await apiSend(owner.host, '/api/sessions/' + encodeURIComponent(owner.id) + '/branch',
      { entryId, summarize, customInstructions });
    // A user-message target means "re-edit this prompt" (leaf moves to its
    // parent) — mirror the TUI and prefill the composer, but never clobber
    // a draft already in progress. Written to the draft store because the
    // reload below runs restorePromptState, which overwrites the input.
    if (data.editorText) {
      try {
        var key = draftKey(sessionRefKey(owner));
        if (!(localStorage.getItem(key) || '').trim()) localStorage.setItem(key, data.editorText);
      } catch {}
    }
    if (!sessionState.ownsSelection(owner)) return;
    closeTreeModal();
    setStatus('Branched — reloading');
    selectSession(owner.id, { host: owner.host, forceTranscriptReload: true });
  } catch (e) {
    if (!sessionState.ownsSelection(owner)) return;
    setStatus('Branch failed: ' + e.message, 'error');
    if (ownsTree(owner, generation) && btn) { btn.disabled = false; btn.textContent = 'Branch from here'; }
  }
}

// =========================================================================
// Terminal (feature-flagged: /api/config .terminal → PI_DISH_TERMINAL=1).
// One panel, one PTY per session server-side. The PTY survives socket drops
// (phone screen lock), so reopening reattaches and replays scrollback.
// =========================================================================

let appConfig = { terminal: false };
let terminalAssetsPromise = null;

// The vendor asset loader lives with the diagrams (see loadVendorAsset).

function loadTerminalAssets() {
  if (terminalAssetsPromise) return terminalAssetsPromise;
  terminalAssetsPromise = (async () => {
    const css = loadVendorAsset('link', { rel: 'stylesheet', href: 'vendor/xterm.css' });
    await Promise.all([
      css,
      loadVendorAsset('script', { src: 'vendor/xterm.js' }),
    ]);
    await loadVendorAsset('script', { src: 'vendor/xterm-addon-fit.js' });
  })();
  return terminalAssetsPromise;
}

async function loadConfig() {
  try {
    const res = await apiFetch(null, '/api/config');
    appConfig = await res.json();
  } catch { /* feature stays hidden */ }
  updateTerminalButtons();
  updateRoutinesButton();
  updateMicButton();
}

// { term, fitAddon, ws, sessionId, reconnectTimer, attempts, closedByUser, exited }
let termState = null;
let termCtrlLatch = false;

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

function updateTerminalButtons() {
  const supported = sessionHostSupportsTerminal(sessionState.currentSession);
  const show = supported && sessionState.currentSession?.isActive;
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
    const res = await apiFetch(null, '/api/themes');
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

function renderThemeSelect(sel = document.getElementById('settingsTheme')) {
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
  // Diagram SVGs bake their colors in at render time — re-render them too.
  refreshDiagramTheme();
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

// Per-session, host-namespaced; the panel size next to it is device-global.
function terminalModeKey(sessionId) {
  return 'pi-dish-terminal-mode-' + keyForSessionId(sessionId);
}

function toggleTerminal() {
  if (termState) closeTerminal();
  else openTerminal();
}

async function openTerminal(mode) {
  if (!sessionState.currentSession || termState || !sessionHostSupportsTerminal(sessionState.currentSession)) return;
  const session = sessionState.currentSession;
  const owner = sessionState.captureSelection();
  const sessionId = owner.id;
  // Assets may still be in flight (or never requested, on a load whose first
  // terminal-capable session is a remote one) — the promise is one-shot.
  try { await loadTerminalAssets(); } catch { return; }
  if (typeof Terminal === 'undefined') return;
  if (termState || !sessionState.ownsSelection(owner)) return;
  // 'shell' (default) or 'tmux' (a grouped tmux client viewing the pane the
  // session's pi runs in). The last choice sticks per session.
  if (!mode) mode = localStorage.getItem(terminalModeKey(sessionId)) === 'tmux' ? 'tmux' : 'shell';

  // Have the Nerd Font symbols ready before xterm first paints — otherwise
  // prompt icons flash as tofu until the lazy font load lands. Never block
  // the terminal on it (offline cache miss etc. just falls back to squares).
  try {
    await Promise.race([
      document.fonts.load('12px "Symbols Nerd Font Mono"'),
      new Promise(r => setTimeout(r, 2000)),
    ]);
  } catch {}
  if (termState || !sessionState.ownsSelection(owner)) return;

  const panel = document.getElementById('terminalPanel');
  const container = document.getElementById('terminalContainer');
  applySavedTerminalSize(panel);
  panel.style.display = '';
  document.getElementById('terminalCwd').textContent = shortCwd(session.cwd || '~');

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
    term, fitAddon, ws: null, sessionId, owner, mode,
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
  if (!sessionState.ownsSelection(state.owner)) return;
  const host = resolveHost(state.owner.host);
  const modeQ = state.mode === 'tmux' ? '?mode=tmux' : '';
  const url = hostWsUrl(host, `/api/sessions/${encodeURIComponent(state.sessionId)}/terminal${modeQ}`);
  if (!host.token) { openTerminalWS(state, url); return; }
  // Same ticket rule as the SSE stream: minted per connect, never reused.
  setTerminalStatus(state.attempts ? 'reconnecting…' : 'connecting…', 'reconnecting');
  mintHostTicket(host, 'terminal').then((ticket) => {
    if (termState !== state || state.closedByUser || !sessionState.ownsSelection(state.owner)) return;
    openTerminalWS(state, `${url}${modeQ ? '&' : '?'}ticket=${encodeURIComponent(ticket)}`);
  }).catch(() => {
    if (termState === state && sessionState.ownsSelection(state.owner)) setTerminalStatus('connect failed', 'error');
  });
}

function openTerminalWS(state, url) {
  if (state !== termState || state.closedByUser || !sessionState.ownsSelection(state.owner)) return;
  const ws = new WebSocket(url);
  const previous = state.ws;
  state.ws = ws;
  // Publish the replacement first, so even an immediate old close callback
  // cannot schedule another reconnect. Retired sockets must also detach.
  try { previous?.close(); } catch {}
  setTerminalStatus(state.attempts ? 'reconnecting…' : 'connecting…', 'reconnecting');

  ws.onmessage = (ev) => {
    if (state !== termState || state.ws !== ws || state.closedByUser || !sessionState.ownsSelection(state.owner)) return;
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
    if (state !== termState || state.ws !== ws || state.closedByUser || state.exited || !sessionState.ownsSelection(state.owner)) return;
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
    const showBtn = !!(termState && sessionHostSupportsTmux(sessionState.currentSession) && sessionState.currentSession?.isActive);
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
  if (!termState || !sessionState.currentSession) return;
  const next = termState.mode === 'tmux' ? 'shell' : 'tmux';
  const id = termState.sessionId;
  if (next === 'tmux') localStorage.setItem(terminalModeKey(id), 'tmux');
  else localStorage.removeItem(terminalModeKey(id));
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
// Sidebar width — session titles are long and wide monitors have room, so the
// right edge is a drag handle. Persisted in px (unlike the terminal's %: the
// sidebar's useful width is a function of the text in it, not of the viewport)
// and applied as an inline width over the --sidebar-width default. Pointer
// capture keeps the drag on the handle, so no document-level listeners; the
// mobile breakpoint hides the handle and overrides the width in CSS.
const SIDEBAR_WIDTH_KEY = 'pi-dish-sidebar-width';
const SIDEBAR_WIDTH_MIN = 220;

function clampSidebarWidth(px) {
  // Never let the drag eat the reading column: half the viewport is the cap.
  return Math.round(Math.min(Math.max(SIDEBAR_WIDTH_MIN, px), Math.max(SIDEBAR_WIDTH_MIN, window.innerWidth * 0.5)));
}

function applySavedSidebarWidth() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const saved = parseFloat(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  sidebar.style.width = Number.isFinite(saved) ? clampSidebarWidth(saved) + 'px' : '';
}

function initSidebarResize() {
  const handle = document.getElementById('sidebarResizeHandle');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;
  applySavedSidebarWidth();
  handle.addEventListener('dblclick', () => {
    localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    sidebar.style.width = '';
  });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebar.offsetWidth;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    const onMove = (ev) => {
      sidebar.style.width = clampSidebarWidth(startWidth + (ev.clientX - startX)) + 'px';
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      handle.classList.remove('dragging');
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebar.offsetWidth));
      // The terminal is sized off the pane the sidebar just took width from.
      fitTerminal();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

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

// =========================================================================
// Routines takeover (main-pane, usage-view pattern)
// =========================================================================
// A routine is a session template; an invocation is a session. This surface
// edits the template (name, harness/cwd/model/thinking, schedule, prompt) and
// reads the ledger of runs it produced — the transcript, cost and duration of
// each run stay where every other session's do. See TASKS/routines.md.
//
// Fleet: GET /api/routines fans out per capable host exactly like the usage
// view (Promise.allSettled, 20s deadlines, progressive render). Every routine
// carries the host it lives on and every subsequent call for it goes through
// apiFetch(routine.host, …) — the client is the aggregator, there is no
// hub-side merged endpoint. On a single host none of the host chrome renders.

let routinesList = [];            // [{ ...RoutineSummary, host, hostLabel }]
let routinesHostErrors = [];      // labels of hosts that didn't answer
let routinesHostPending = [];     // labels still outstanding during a partial render
let routinesSeq = 0;
let routinesListError = '';
// Selection is (host, id) — two hosts may legitimately hold the same name.
let routineSelKey = null;
let routineSelected = null;       // GET /api/routines/:id (carries `versions`)
let routineCreating = false;      // detail pane holds a blank create form
let routineFormBaseline = null;   // JSON snapshot for the dirty guard
let routineFormError = '';
let routineDeleteArmed = false;
let routineBusy = false;          // a save/invoke/delete is in flight
let routineInvocations = [];
let routineInvocationsNextBefore = null;
let routineInvocationsInflight = false;
let routineInvocationsTimer = null;
let routineVersionFilter = null;  // clicking a version row filters the table
let routineVersionShown = null;   // which version's prompt is expanded inline
let routineNotice = '';           // transient success line under the actions
// Per (host|harness|cwd) model catalogs. Deliberately *not* the global
// modelCatalog.rows(): that one belongs to the session header and the new-session
// takeover, and a routine's catalog is a different harness/cwd/host triple.
const routineModelCatalogs = new Map();
const routineHarnessCatalogs = new Map();
let routineModelSeq = 0;
let routineCwdAutocomplete = null;
function disposeRoutineCwdAutocomplete() {
  routineCwdAutocomplete?.dispose();
  routineCwdAutocomplete = null;
}
let routineCreateHostId = null;   // host picked in the create form

const ROUTINE_CRON_PRESETS = [
  ['', 'No schedule (manual only)'],
  ['0 * * * *', 'Every hour'],
  ['0 9 * * *', 'Daily at 09:00'],
  ['0 9 * * 1-5', 'Weekdays at 09:00'],
  ['0 9 * * 1', 'Weekly, Monday 09:00'],
];
const ROUTINE_ON_BUSY = [
  ['skip', 'Skip the run'],
  ['steer', 'Steer the running turn'],
  ['followUp', 'Queue as a follow-up'],
];
const ROUTINE_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function routineKey(host, id) { return sessionKey(host || null, id); }

/** Hosts that advertise `routines`. Absent capability = unsupported. */
function routinesCapableHosts() {
  return fanoutHosts().filter(host => hostSupportsCapability(host, 'routines', appConfig));
}

function anyHostSupportsRoutines() {
  return effectiveHosts().some(host => hostSupportsCapability(host, 'routines', appConfig));
}

/** The sidebar icon exists only where the feature does. */
function updateRoutinesButton() {
  const btn = document.getElementById('btnRoutines');
  if (!btn) return;
  const supported = anyHostSupportsRoutines();
  btn.style.display = supported ? '' : 'none';
  if (!supported && isRoutinesViewOpen()) closeRoutinesView();
}

function isRoutinesViewOpen() {
  return document.querySelector('.main').classList.contains('routines-open');
}

function openRoutinesView() {
  closeSidebar();
  closeUsageView(); // takeovers are mutually exclusive
  closeSearchView();
  closeNewSessionView();
  closeSkillsView();
  closeRecoveryView();
  closeBounceView();
  if (isRoutinesViewOpen()) return;
  document.querySelector('.main').classList.add('routines-open');
  // Re-opening restores the last selection (and its poll); with none, the
  // detail pane is the placeholder and the phone starts on the list. The form
  // is only repainted when the pane doesn't already hold it, so closing and
  // reopening the takeover can't silently discard an unsaved edit.
  if (!routineSelected && !routineCreating) backToRoutinesList();
  if (!document.getElementById('routinesDetail')?.querySelector('#rtName')) renderRoutineDetail();
  loadRoutinesView();
  if (routineSelected) {
    loadRoutineInvocations({ reset: true });
    startRoutineInvocationPoll();
  }
}

function closeRoutinesView() {
  routineCwdAutocomplete?.hide();
  document.querySelector('.main').classList.remove('routines-open');
  stopRoutineInvocationPoll();
}

function refreshRoutinesView() {
  loadRoutinesView();
  if (routineSelected) loadRoutineInvocations({ reset: true });
}

/** Mobile back-out: Escape leaves the detail before it leaves the takeover. */
function routinesViewEscape() {
  const view = document.getElementById('routinesView');
  if (view && view.classList.contains('detail-open') && window.matchMedia('(max-width: 768px)').matches) {
    backToRoutinesList();
    return true;
  }
  closeRoutinesView();
  return true;
}

function backToRoutinesList() {
  routineCwdAutocomplete?.hide();
  document.getElementById('routinesView')?.classList.remove('detail-open');
}

// --- list (fleet fan-out) ------------------------------------------------

async function loadRoutinesView() {
  const seq = ++routinesSeq;
  const stale = () => seq !== routinesSeq || !isRoutinesViewOpen();
  const listEl = document.getElementById('routinesList');
  if (listEl && !listEl.childElementCount) listEl.innerHTML = '<div class="usage-state">Loading routines…</div>';
  await hostFleetReady;
  if (stale()) return;

  const hosts = routinesCapableHosts();
  if (!hosts.length) {
    routinesList = [];
    routinesListError = 'No reachable host offers routines.';
    renderRoutinesList();
    return;
  }
  const status = hosts.map(() => 'pending');
  const entries = new Array(hosts.length);
  const reasons = new Array(hosts.length);
  const render = () => {
    if (stale()) return;
    if (!status.some((s, i) => s === 'ok' && entries[i])) return;
    routinesHostErrors = hosts.filter((_, i) => status[i] === 'error').map(hostDisplayLabel);
    routinesHostPending = hosts.filter((_, i) => status[i] === 'pending').map(hostDisplayLabel);
    routinesListError = '';
    routinesList = entries.flat().filter(Boolean);
    renderRoutinesList();
  };
  const queueRender = createFanoutRenderQueue(status, render);
  await Promise.allSettled(hosts.map(async (host, i) => {
    try {
      const res = await apiFetch(host, '/api/routines', { timeoutMs: 20000 });
      if (res.status === 401) { noteHostBlocked(host); throw new Error('needs a token'); }
      if (!res.ok) throw new Error(await res.json().then(d => d.error, () => null) || `HTTP ${res.status}`);
      const data = await res.json();
      entries[i] = (Array.isArray(data?.routines) ? data.routines : []).map(r => ({
        ...r, host: host.hostId || null, hostLabel: hostDisplayLabel(host),
      }));
      status[i] = 'ok';
      noteHostReachable(host);
    } catch (e) {
      status[i] = 'error';
      reasons[i] = e;
      if (!host.self) noteHostFailure(host, e);
    }
    queueRender();
  }));
  if (stale()) return;
  if (!status.some(s => s === 'ok')) {
    routinesList = [];
    routinesListError = (reasons.find(Boolean) || new Error('no hosts answered')).message;
    renderRoutinesList();
  }
}

function routineStatusClass(status) {
  if (status === 'starting' || status === 'running') return 'working';
  if (status === 'completed') return 'ok';
  if (status === 'errored' || status === 'interrupted') return 'bad';
  return 'muted';
}

/** "in 3h" / "in 12m" — the schedule line's forward-looking twin. */
function formatRoutineCountdown(ts) {
  if (!ts) return '';
  const diff = new Date(ts).getTime() - Date.now();
  if (!Number.isFinite(diff)) return '';
  if (diff <= 0) return 'due now';
  const m = Math.round(diff / 60000);
  if (m < 60) return `in ${Math.max(1, m)}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

function routineScheduleLine(routine) {
  const cron = routine.schedule?.cron;
  if (!cron) return '<span class="rt-sched muted">manual only</span>';
  if (routine.enabled === false) {
    return `<span class="rt-sched paused"><code>${escapeHtml(cron)}</code> · paused</span>`;
  }
  const next = formatRoutineCountdown(routine.stats?.nextRunAt);
  return `<span class="rt-sched"><code>${escapeHtml(cron)}</code>${next ? ` · ${escapeHtml(next)}` : ''}</span>`;
}

function renderRoutinesList() {
  const el = document.getElementById('routinesList');
  if (!el) return;
  const notices = [
    routinesHostErrors.length ? `<div class="usage-notice">Not listed: ${escapeHtml(routinesHostErrors.join(', '))} did not answer.</div>` : '',
    routinesHostPending.length ? `<div class="usage-notice">Still loading ${escapeHtml(routinesHostPending.join(', '))}…</div>` : '',
  ].join('');

  const sorted = routinesList.slice().sort((a, b) =>
    (b.stats?.lastInvocation?.startedAt || 0) - (a.stats?.lastInvocation?.startedAt || 0) ||
    String(a.name || '').localeCompare(String(b.name || '')));

  const rows = sorted.map(r => {
    const key = routineKey(r.host, r.id);
    const last = r.stats?.lastInvocation || null;
    const dot = `<span class="rt-dot ${last ? routineStatusClass(last.status) : 'none'}" title="${escapeHtml(last ? last.status : 'never run')}"></span>`;
    const lastLine = last
      ? `${dot}${escapeHtml(last.status)} · ${escapeHtml(formatRelativeTime(last.startedAt))}`
      : `${dot}never run`;
    const count = r.stats?.invocations || 0;
    return `<div class="rt-row${routineSelKey === key ? ' selected' : ''}" data-routine="${escapeHtml(r.id)}" data-host="${escapeHtml(r.host || '')}">
      <div class="rt-row-top">
        <span class="rt-name">${escapeHtml(r.name || r.id)}</span>
        ${hostChipHtml(r.host)}
      </div>
      <div class="rt-row-sched">${routineScheduleLine(r)}</div>
      <div class="rt-row-meta">${escapeHtml(r.mode === 'continue' ? 'continue' : 'one-shot')} · on busy ${escapeHtml(r.onBusy || 'skip')}</div>
      <div class="rt-row-last">${lastLine}<span class="rt-count">${count} run${count === 1 ? '' : 's'}</span></div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="rt-list-head">
      <button class="btn-small" id="rtNewBtn" onclick="startRoutineCreate()">+ New routine</button>
    </div>
    ${notices}
    ${routinesListError ? `<div class="usage-state">${escapeHtml(routinesListError)}</div>` : ''}
    ${rows || (routinesListError ? '' : '<div class="usage-state">No routines yet.</div>')}`;

  el.querySelectorAll('.rt-row').forEach(row => {
    row.addEventListener('click', () => selectRoutine(row.dataset.host || null, row.dataset.routine));
  });
}

// --- selection + detail --------------------------------------------------

function routineFormDirty() {
  if (!routineFormBaseline) return false;
  const now = readRoutineForm();
  return now && JSON.stringify(now) !== routineFormBaseline;
}

/** The unsaved-changes guard the spec asks for: a plain confirm, once. */
function confirmLeaveRoutineForm() {
  if (!routineFormDirty()) return true;
  return confirm('This routine has unsaved changes. Discard them?');
}

async function selectRoutine(host, id) {
  const key = routineKey(host, id);
  if (routineSelKey === key && routineSelected) {
    document.getElementById('routinesView')?.classList.add('detail-open');
    return;
  }
  if (!confirmLeaveRoutineForm()) return;
  disposeRoutineCwdAutocomplete();
  routineSelKey = key;
  routineCreating = false;
  routineSelected = null;
  routineFormBaseline = null;
  routineFormError = '';
  routineNotice = '';
  routineDeleteArmed = false;
  routineVersionFilter = null;
  routineVersionShown = null;
  routineInvocations = [];
  routineInvocationsNextBefore = null;
  stopRoutineInvocationPoll();
  renderRoutinesList();
  document.getElementById('routinesView')?.classList.add('detail-open');
  const detail = document.getElementById('routinesDetail');
  if (detail) detail.innerHTML = '<div class="usage-state">Loading routine…</div>';
  try {
    const res = await apiFetch(host, `/api/routines/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(await res.json().then(d => d.error, () => null) || `HTTP ${res.status}`);
    const data = await res.json();
    if (routineSelKey !== key) return;
    routineSelected = { ...(data.routine || data), host: host || null };
    renderRoutineDetail();
    loadRoutineInvocations({ reset: true });
    startRoutineInvocationPoll();
  } catch (e) {
    if (routineSelKey !== key) return;
    if (detail) detail.innerHTML = `<div class="usage-state">Could not load routine: ${escapeHtml(e.message)}</div>`;
  }
}

function startRoutineCreate() {
  if (!confirmLeaveRoutineForm()) return;
  const hosts = routinesCapableHosts();
  const host = hosts.find(h => h.self) || hosts[0];
  routineSelKey = null;
  routineSelected = null;
  routineCreating = true;
  routineFormError = '';
  routineNotice = '';
  routineDeleteArmed = false;
  routineVersionFilter = null;
  routineVersionShown = null;
  routineInvocations = [];
  routineInvocationsNextBefore = null;
  stopRoutineInvocationPoll();
  routineCreateHostId = host ? (host.hostId || null) : null;
  renderRoutinesList();
  document.getElementById('routinesView')?.classList.add('detail-open');
  renderRoutineDetail();
}

/** The host the detail pane's calls go to — the routine's, or the create pick. */
function routineFormHostId() {
  return routineCreating ? routineCreateHostId : (routineSelected?.host ?? null);
}

/**
 * Known cwds for the form's host, taken from the client's own session lists.
 * The new-session takeover's /api/cwds cache belongs to *its* host; deriving
 * from `sessions` keeps a peer's routine from suggesting this machine's paths.
 */
function routineKnownCwds() {
  const hostId = routineFormHostId();
  const seen = new Set();
  const out = [];
  for (const s of [...sessionState.sessions.active, ...sessionState.sessions.previous]) {
    if (isMultiHost() && (s.host || null) !== hostId) continue;
    if (!s.cwd || seen.has(s.cwd)) continue;
    seen.add(s.cwd);
    out.push({ path: s.cwd, short: shortCwd(s.cwd) });
  }
  return out;
}

async function loadRoutineHarnesses(hostId) {
  const key = String(hostId || '');
  if (routineHarnessCatalogs.has(key)) return routineHarnessCatalogs.get(key);
  let list = [{ id: 'pi', label: 'Pi', available: true }];
  try {
    const res = await apiFetch(hostId, '/api/harnesses');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.harnesses) && data.harnesses.length) list = data.harnesses;
    }
  } catch {}
  routineHarnessCatalogs.set(key, list);
  return list;
}

async function loadRoutineModels(hostId, harnessId, cwd) {
  const key = `${hostId || ''}|${harnessId}|${cwd || ''}`;
  if (routineModelCatalogs.has(key)) return routineModelCatalogs.get(key);
  const seq = ++routineModelSeq;
  let models = [];
  try {
    const url = harnessId !== 'pi' ? modelCatalogUrl(harnessId, cwd) : '/api/models';
    const res = await apiFetch(hostId, url);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) models = data;
    }
  } catch {}
  if (seq !== routineModelSeq) return models;
  routineModelCatalogs.set(key, models);
  return models;
}

/** Current form values, normalized to the wire shape the routes take. */
function readRoutineForm() {
  const detail = document.getElementById('routinesDetail');
  if (!detail || !detail.querySelector('#rtName')) return null;
  const val = (id) => (detail.querySelector('#' + id)?.value ?? '').trim();
  const minInterval = parseInt(detail.querySelector('#rtMinInterval')?.value, 10);
  return {
    name: val('rtName'),
    description: val('rtDescription'),
    harness: val('rtHarness') || 'pi',
    cwd: val('rtCwd'),
    model: val('rtModel'),
    thinking: val('rtThinking'),
    cron: val('rtCron'),
    enabled: !!detail.querySelector('#rtEnabled')?.checked,
    mode: detail.querySelector('input[name="rtMode"]:checked')?.value || 'oneShot',
    onBusy: val('rtOnBusy') || 'skip',
    minIntervalSec: Number.isFinite(minInterval) && minInterval > 0 ? minInterval : 0,
    prompt: detail.querySelector('#rtPrompt')?.value ?? '',
  };
}

function routineFormDefaults() {
  if (routineSelected) {
    return {
      name: routineSelected.name || '',
      description: routineSelected.description || '',
      harness: routineSelected.harness || 'pi',
      cwd: routineSelected.cwd || '',
      model: routineSelected.model || '',
      thinking: routineSelected.thinking || '',
      cron: routineSelected.schedule?.cron || '',
      enabled: routineSelected.enabled !== false,
      mode: routineSelected.mode === 'continue' ? 'continue' : 'oneShot',
      onBusy: routineSelected.onBusy || 'skip',
      minIntervalSec: routineSelected.minIntervalSec || 0,
      prompt: routineSelected.prompt || '',
    };
  }
  return {
    name: '', description: '', harness: 'pi',
    cwd: localStorage.getItem('pi-dish-cwd') || '',
    model: '', thinking: '', cron: '', enabled: true,
    mode: 'oneShot', onBusy: 'skip', minIntervalSec: 0, prompt: '',
  };
}

function renderRoutineDetail() {
  disposeRoutineCwdAutocomplete();
  const el = document.getElementById('routinesDetail');
  if (!el) return;
  if (!routineSelected && !routineCreating) {
    el.innerHTML = '<div class="usage-state">Select a routine, or create one.</div>';
    return;
  }
  const v = routineFormDefaults();
  const hosts = routinesCapableHosts();
  const hostRow = (routineCreating && hosts.length > 1)
    ? `<label class="rt-field">
         <span class="ns-label">Host</span>
         <select class="ns-select" id="rtHost">${hosts.map(h =>
           `<option value="${escapeHtml(h.hostId || '')}"${(h.hostId || null) === routineCreateHostId ? ' selected' : ''}>${escapeHtml(hostDisplayLabel(h))}</option>`).join('')}</select>
       </label>`
    : '';

  const presets = ROUTINE_CRON_PRESETS.map(([value, label]) =>
    `<option value="${escapeHtml(value)}"${value === v.cron ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const onBusy = ROUTINE_ON_BUSY.map(([value, label]) =>
    `<option value="${escapeHtml(value)}"${value === v.onBusy ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const thinking = ['<option value="">(default)</option>'].concat(ROUTINE_THINKING_LEVELS.map(level =>
    `<option value="${level}"${level === v.thinking ? ' selected' : ''}>${escapeHtml(NS_THINKING_LABELS[level] || level)}</option>`)).join('');

  el.innerHTML = `
    <div class="rt-detail-head">
      <button class="rt-back" onclick="backToRoutinesList()">‹ Routines</button>
      <h2 class="rt-detail-title">${escapeHtml(routineCreating ? 'New routine' : (routineSelected.name || routineSelected.id))}</h2>
      ${routineCreating ? '' : hostChipHtml(routineSelected.host)}
      ${routineCreating ? '' : `<span class="rt-version-badge">v${routineSelected.promptVersion || 1}</span>`}
    </div>

    <div class="rt-form">
      ${hostRow}
      <div class="rt-field-row">
        <label class="rt-field">
          <span class="ns-label">Name</span>
          <input type="text" class="cwd-input" id="rtName" value="${escapeHtml(v.name)}"
            placeholder="nightly-review" spellcheck="false" autocomplete="off">
        </label>
        <label class="rt-field">
          <span class="ns-label">Agent</span>
          <select class="ns-select" id="rtHarness"><option value="${escapeHtml(v.harness)}">${escapeHtml(v.harness)}</option></select>
        </label>
      </div>

      <label class="rt-field">
        <span class="ns-label">Description <span class="ns-label-optional">(optional)</span></span>
        <input type="text" class="cwd-input" id="rtDescription" value="${escapeHtml(v.description)}"
          placeholder="What this routine is for" autocomplete="off">
      </label>

      <label class="rt-field">
        <span class="ns-label">Working directory</span>
        <div class="cwd-input-wrap">
          <input type="text" class="cwd-input" id="rtCwd" value="${escapeHtml(v.cwd)}" placeholder="~" spellcheck="false" autocomplete="off">
          <div class="cwd-dropdown" id="rtCwdDropdown"></div>
        </div>
      </label>

      <div class="rt-field-row">
        <label class="rt-field">
          <span class="ns-label">Model</span>
          <select class="ns-select" id="rtModel"><option value="">(default)</option></select>
          <span class="ns-hidden-note" id="rtModelNote"></span>
        </label>
        <label class="rt-field">
          <span class="ns-label">Thinking level</span>
          <select class="ns-select" id="rtThinking">${thinking}</select>
        </label>
      </div>

      <div class="rt-field-row">
        <label class="rt-field">
          <span class="ns-label">Schedule (cron, local time)</span>
          <input type="text" class="cwd-input" id="rtCron" value="${escapeHtml(v.cron)}"
            placeholder="0 9 * * 1-5" spellcheck="false" autocomplete="off">
        </label>
        <label class="rt-field">
          <span class="ns-label">Preset</span>
          <select class="ns-select" id="rtCronPreset">${presets}<option value="__custom" ${ROUTINE_CRON_PRESETS.some(([p]) => p === v.cron) ? '' : 'selected'}>Custom…</option></select>
        </label>
      </div>
      <label class="rt-check">
        <input type="checkbox" id="rtEnabled"${v.enabled ? ' checked' : ''}>
        <span>Schedule armed <small>— unchecking pauses the cadence; Run now and the invoke route keep working</small></span>
      </label>

      <div class="rt-field">
        <span class="ns-label">Mode</span>
        <label class="rt-radio"><input type="radio" name="rtMode" value="oneShot"${v.mode === 'oneShot' ? ' checked' : ''}>
          <span>One-shot <small>— every run spawns a fresh session and closes it when the turn ends</small></span></label>
        <label class="rt-radio"><input type="radio" name="rtMode" value="continue"${v.mode === 'continue' ? ' checked' : ''}>
          <span>Continue <small>— reuse this routine's last session (resuming it if needed); never auto-closed</small></span></label>
      </div>

      <div class="rt-field-row">
        <label class="rt-field">
          <span class="ns-label">When the routine is busy</span>
          <select class="ns-select" id="rtOnBusy">${onBusy}</select>
          <span class="ns-hidden-note">Scheduled ticks always skip; this applies to invokes.</span>
        </label>
        <label class="rt-field">
          <span class="ns-label">Minimum interval (seconds)</span>
          <input type="number" class="cwd-input" id="rtMinInterval" min="0" step="1" value="${escapeHtml(String(v.minIntervalSec))}">
          <span class="ns-hidden-note">Invokes closer together than this are rejected with 429.</span>
        </label>
      </div>

      <label class="rt-field">
        <span class="ns-label">Prompt</span>
        <textarea class="rt-prompt" id="rtPrompt" rows="12" spellcheck="false" placeholder="What this routine asks the agent to do">${escapeHtml(v.prompt)}</textarea>
        <span class="ns-hidden-note">Saving a changed prompt appends a new version. <code>#refs</code> resolve like they do in the composer; an invoke's <code>input</code> is appended as an <code>&lt;invocation-input&gt;</code> block.</span>
      </label>

      <div class="rt-actions">
        <span class="rt-error" id="rtError">${escapeHtml(routineFormError)}</span>
        <span class="rt-notice" id="rtNotice">${escapeHtml(routineNotice)}</span>
        ${routineCreating ? '' : `<button class="btn-small btn-danger" id="rtDeleteBtn" onclick="deleteRoutine()">${routineDeleteArmed ? 'Delete?' : 'Delete'}</button>`}
        ${routineCreating ? '' : '<button class="btn" id="rtRunBtn" onclick="runRoutineNow()">Run now</button>'}
        <button class="btn btn-primary" id="rtSaveBtn" onclick="saveRoutine()">${routineCreating ? 'Create routine' : 'Save'}</button>
      </div>
    </div>

    ${routineCreating ? '' : renderRoutineInvokeBox()}
    ${routineCreating ? '' : renderRoutineVersions()}
    ${routineCreating ? '' : '<div class="rt-invocations" id="rtInvocations"></div>'}`;

  wireRoutineForm(v);
  if (!routineCreating) renderRoutineInvocations();
}

function wireRoutineForm(values) {
  const el = document.getElementById('routinesDetail');
  if (!el) return;

  const hostSel = el.querySelector('#rtHost');
  if (hostSel) hostSel.addEventListener('change', () => {
    routineCwdAutocomplete?.hide();
    routineCreateHostId = hostSel.value || null;
    // Everything under the picker is host-scoped — harnesses, catalogs, dirs.
    const harness = el.querySelector('#rtHarness')?.value || values.harness;
    const model = el.querySelector('#rtModel')?.value || '';
    refreshRoutineHarnessOptions(harness).then(() => refreshRoutineModelOptions(model));
  });

  const harnessSel = el.querySelector('#rtHarness');
  if (harnessSel) harnessSel.addEventListener('change', () => refreshRoutineModelOptions(''));

  const cwdInput = el.querySelector('#rtCwd');
  const cwdDropdown = el.querySelector('#rtCwdDropdown');
  if (cwdInput && cwdDropdown) {
    routineCwdAutocomplete = createCwdAutocomplete({
      input: cwdInput,
      dropdown: cwdDropdown,
      hostId: () => routineFormHostId(),
      known: () => routineKnownCwds(),
      onPick: () => refreshRoutineModelOptions(),
      onBlur: () => refreshRoutineModelOptions(),
    });
  }

  const preset = el.querySelector('#rtCronPreset');
  const cron = el.querySelector('#rtCron');
  if (preset && cron) {
    preset.addEventListener('change', () => {
      if (preset.value === '__custom') return;
      cron.value = preset.value;
    });
    // Typing a custom expression must not leave a stale preset label claiming it.
    cron.addEventListener('input', () => {
      const match = ROUTINE_CRON_PRESETS.some(([p]) => p === cron.value.trim());
      preset.value = match ? cron.value.trim() : '__custom';
    });
  }

  // The catalogs are fetched, so the selects only reach their saved values
  // asynchronously. The dirty baseline therefore comes from the *defaults*
  // object rather than from the DOM — same keys, same order — so the guard
  // is correct from the first frame and a slow catalog can't rebaseline an
  // edit the user already made.
  routineFormBaseline = JSON.stringify(values);
  refreshRoutineHarnessOptions(values.harness).then(() => refreshRoutineModelOptions(values.model));
}

async function refreshRoutineHarnessOptions(preferred) {
  const sel = document.getElementById('rtHarness');
  if (!sel) return;
  const hostId = routineFormHostId();
  const list = await loadRoutineHarnesses(hostId);
  if (document.getElementById('rtHarness') !== sel) return;
  const available = list.filter(h => h && h.available !== false);
  const want = preferred || sel.value || 'pi';
  sel.innerHTML = available.map(h =>
    `<option value="${escapeHtml(h.id)}">${escapeHtml(h.label || h.id)}</option>`).join('')
    || `<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`;
  // A routine may name a harness this host no longer reports; keep it rather
  // than silently rewriting the record on the next save.
  if (!available.some(h => h.id === want)) {
    sel.insertAdjacentHTML('afterbegin', `<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`);
  }
  sel.value = want;
}

async function refreshRoutineModelOptions(preferred) {
  const sel = document.getElementById('rtModel');
  if (!sel) return;
  const want = preferred !== undefined ? preferred : sel.value;
  const hostId = routineFormHostId();
  const harnessId = document.getElementById('rtHarness')?.value || 'pi';
  const cwd = (document.getElementById('rtCwd')?.value || '').trim();
  const models = await loadRoutineModels(hostId, harnessId, cwd);
  if (document.getElementById('rtModel') !== sel) return;
  const { html, enabled, hidden } = modelSelectOptionsHtml(models);
  sel.innerHTML = html;
  // A saved ref the catalog doesn't list stays selectable — the record is
  // authoritative, and a model can disappear from a catalog for credential
  // reasons that say nothing about what this routine should run.
  if (want && !enabled.some(m => (m.selector || `${m.provider}/${m.id}`) === want)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`);
  }
  sel.value = want || '';
  const note = document.getElementById('rtModelNote');
  if (note) note.textContent = modelHiddenNote(hidden);
}

// --- invoke box ----------------------------------------------------------

/**
 * The invoke URL for the *owning* host, absolute so the curl works from
 * anywhere: a fleet peer reached through this hub keeps its /hosts/<name>
 * proxy prefix, because that is the address the reader can actually reach.
 */
function routineInvokeUrl(routine) {
  const base = resolveHost(routine.host).base || '';
  const path = `/api/routines/${encodeURIComponent(routine.id)}/invoke`;
  try { return new URL(base + path, location.origin).href; } catch { return base + path; }
}

function routineInvokeCurl(routine) {
  const authed = !!resolveHost(routine.host).token;
  return [
    `curl -X POST '${routineInvokeUrl(routine)}' \\`,
    "  -H 'Content-Type: application/json' \\",
    ...(authed ? ['  -H "Authorization: Bearer $PI_DISH_TOKEN" \\'] : []),
    `  -d '{"source":"my-script","input":{"note":"anything JSON"}}'`,
  ].join('\n');
}

function renderRoutineInvokeBox() {
  const curl = routineInvokeCurl(routineSelected);
  return `<details class="rt-box" open>
    <summary>Invoke from a script</summary>
    <pre class="rt-curl" id="rtCurl">${escapeHtml(curl)}</pre>
    <div class="rt-box-actions">
      <button class="btn-small" onclick="copyRoutineCurl()">Copy</button>
      <span class="ns-hidden-note">The optional <code>input</code> JSON is appended to the prompt as an <code>&lt;invocation-input&gt;</code> block. Add <code>?wait=1</code> to block until the run leaves <code>starting</code>.</span>
    </div>
  </details>`;
}

function copyRoutineCurl() {
  if (!routineSelected) return;
  copyTextToClipboard(routineInvokeCurl(routineSelected));
  setStatus('Invoke command copied');
}

// --- prompt versions -----------------------------------------------------

function renderRoutineVersions() {
  const versions = Array.isArray(routineSelected?.versions) ? routineSelected.versions.slice().reverse() : [];
  if (!versions.length) return '';
  const rows = versions.map(entry => {
    const active = routineVersionFilter === entry.version;
    const shown = routineVersionShown === entry.version;
    return `<div class="rt-version${active ? ' filtered' : ''}">
      <div class="rt-version-row" data-version="${entry.version}">
        <span class="rt-version-num">v${entry.version}</span>
        <span class="rt-version-when" title="${escapeHtml(new Date(entry.savedAt).toLocaleString())}">${escapeHtml(formatRelativeTime(entry.savedAt))}</span>
        ${entry.version === (routineSelected.promptVersion || 1) ? '<span class="rt-version-current">current</span>' : ''}
        <span class="rt-version-hint">${active ? 'filtering runs' : 'click to filter runs'}</span>
        <button class="btn-small rt-version-view" data-view="${entry.version}">${shown ? 'hide' : 'view'}</button>
        <button class="btn-small rt-version-restore" data-restore="${entry.version}">restore</button>
      </div>
      ${shown ? `<pre class="rt-version-text">${escapeHtml(entry.prompt || '')}</pre>` : ''}
    </div>`;
  }).join('');
  return `<details class="rt-box" id="rtVersions"${routineVersionFilter || routineVersionShown ? ' open' : ''}>
    <summary>Prompt versions (${versions.length})</summary>
    ${rows}
    <div class="ns-hidden-note">Restoring only writes the text back into the editor — saving it then creates a <em>new</em> version.</div>
  </details>`;
}

// Delegated so the versions block can be re-rendered freely.
document.addEventListener('click', (e) => {
  const view = e.target.closest('.rt-version-view');
  if (view) {
    const version = Number(view.dataset.view);
    routineVersionShown = routineVersionShown === version ? null : version;
    rerenderRoutineVersions();
    return;
  }
  const restore = e.target.closest('.rt-version-restore');
  if (restore) {
    const version = Number(restore.dataset.restore);
    const entry = (routineSelected?.versions || []).find(v => v.version === version);
    const textarea = document.getElementById('rtPrompt');
    if (entry && textarea) {
      textarea.value = entry.prompt || '';
      routineNotice = `Restored v${version} into the editor — save to make it the new version.`;
      const notice = document.getElementById('rtNotice');
      if (notice) notice.textContent = routineNotice;
    }
    return;
  }
  const row = e.target.closest('.rt-version-row');
  if (row && document.getElementById('rtVersions')?.contains(row)) {
    const version = Number(row.dataset.version);
    routineVersionFilter = routineVersionFilter === version ? null : version;
    rerenderRoutineVersions();
    renderRoutineInvocations();
  }
});

function rerenderRoutineVersions() {
  const existing = document.getElementById('rtVersions');
  if (!existing) return;
  existing.outerHTML = renderRoutineVersions();
}

// --- invocations ---------------------------------------------------------

function stopRoutineInvocationPoll() {
  clearInterval(routineInvocationsTimer);
  routineInvocationsTimer = null;
}

function startRoutineInvocationPoll() {
  stopRoutineInvocationPoll();
  routineInvocationsTimer = setInterval(() => {
    if (!isRoutinesViewOpen() || !routineSelected) { stopRoutineInvocationPoll(); return; }
    loadRoutineInvocations({ reset: true, quiet: true });
  }, 10000);
}

async function loadRoutineInvocations({ reset = false, quiet = false } = {}) {
  if (!routineSelected) return;
  if (routineInvocationsInflight) return; // single-flight
  routineInvocationsInflight = true;
  const key = routineSelKey;
  const before = reset ? null : routineInvocationsNextBefore;
  try {
    const params = new URLSearchParams({ limit: '50' });
    if (before) params.set('before', String(before));
    const res = await apiFetch(routineSelected.host,
      `/api/routines/${encodeURIComponent(routineSelected.id)}/invocations?${params}`, { timeoutMs: 20000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (key !== routineSelKey) return;
    const list = Array.isArray(data?.invocations) ? data.invocations : [];
    routineInvocations = reset ? list : routineInvocations.concat(list);
    routineInvocationsNextBefore = data?.nextBefore ?? null;
    renderRoutineInvocations();
    // The poll only asks for this routine's runs, so patch its list row's
    // last-run line from the page rather than re-fanning out over the fleet
    // every 10s. The run *count* still comes from the next full list load.
    if (reset) {
      const row = routinesList.find(r => routineKey(r.host, r.id) === key);
      if (row && row.stats) {
        row.stats.lastInvocation = list[0] || null;
        renderRoutinesList();
      }
    }
  } catch (e) {
    if (!quiet && key === routineSelKey) {
      const el = document.getElementById('rtInvocations');
      if (el) el.innerHTML = `<div class="usage-state">Could not load runs: ${escapeHtml(e.message)}</div>`;
    }
  } finally {
    routineInvocationsInflight = false;
  }
}

function routineInvocationDetail(inv) {
  const parts = [];
  if (inv.skipReason) parts.push(`skipped: ${inv.skipReason}`);
  if (inv.error) parts.push(inv.error);
  if (inv.closeError) parts.push(`close: ${inv.closeError}`);
  if (!parts.length && inv.summary) parts.push(inv.summary);
  return parts.join(' · ');
}

/**
 * Label for a run's session cell. Every run of a routine spawns on the same
 * day, so the app's usual 8-character ref is all date and distinguishes
 * nothing here — prefer the session's own name when this client has it.
 */
function routineSessionLabel(sessionId) {
  const known = sessionState.findSession(sessionId, routineSelected?.host || null);
  if (known && known.name) return truncate(known.name, 28, '…');
  // Pi's ids lead with a timestamp, so the app's usual first-8 ref would read
  // "2026-09-" on every row; the distinguishing part is the tail. Uuid-shaped
  // ids (OMP) keep the familiar leading form.
  return /^\d{4}-\d\d-\d\d/.test(sessionId) ? sessionId.slice(-8) : sessionId.slice(0, 8);
}

function renderRoutineInvocations() {
  const el = document.getElementById('rtInvocations');
  if (!el) return;
  const filtered = routineVersionFilter
    ? routineInvocations.filter(inv => inv.version === routineVersionFilter)
    : routineInvocations;

  const rows = filtered.map(inv => {
    const trigger = inv.trigger + (inv.source ? ` (${inv.source})` : '');
    const started = inv.startedAt
      ? `<span title="${escapeHtml(new Date(inv.startedAt).toLocaleString())}">${escapeHtml(formatRelativeTime(inv.startedAt))}</span>`
      : '—';
    const duration = Number.isFinite(inv.durationMs) ? formatDuration(inv.durationMs) : '—';
    const session = inv.sessionId
      ? `<a class="rt-session-link" data-session="${escapeHtml(inv.sessionId)}" data-host="${escapeHtml(routineSelected?.host || '')}" title="${escapeHtml(inv.sessionId)}">${escapeHtml(routineSessionLabel(inv.sessionId))}</a>`
      : '—';
    const detail = routineInvocationDetail(inv);
    return `<tr data-invocation="${escapeHtml(inv.id)}">
      <td class="rt-num">v${escapeHtml(String(inv.version ?? ''))}</td>
      <td>${escapeHtml(trigger)}</td>
      <td>${escapeHtml(inv.delivery || '')}</td>
      <td><span class="rt-dot ${routineStatusClass(inv.status)}"></span>${escapeHtml(inv.status || '')}</td>
      <td>${started}</td>
      <td class="rt-num">${escapeHtml(duration)}</td>
      <td>${session}</td>
      <td class="rt-detail-cell" title="${escapeHtml(detail)}">${escapeHtml(detail)}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="rt-invocations-head">
      <h3>Runs${routineVersionFilter ? ` <span class="rt-filter-chip">v${routineVersionFilter} only <button class="rt-filter-clear" onclick="clearRoutineVersionFilter()">✕</button></span>` : ''}</h3>
    </div>
    ${filtered.length ? `<div class="rt-table-wrap"><table class="rt-table">
      <thead><tr><th>Ver</th><th>Trigger</th><th>Delivery</th><th>Status</th><th>Started</th><th>Duration</th><th>Session</th><th>Detail</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`
      : '<div class="usage-state">No runs yet.</div>'}
    ${routineInvocationsNextBefore ? '<button class="btn-small rt-load-more" onclick="loadMoreRoutineInvocations()">Load more</button>' : ''}`;

  el.querySelectorAll('.rt-session-link').forEach(link => {
    link.addEventListener('click', () => openRoutineSession(link.dataset.session, link.dataset.host || null));
  });
}

function clearRoutineVersionFilter() {
  routineVersionFilter = null;
  rerenderRoutineVersions();
  renderRoutineInvocations();
}

function loadMoreRoutineInvocations() {
  loadRoutineInvocations({ reset: false });
}

/**
 * Click-through to the run's session — the advanced-search pattern: the
 * sidebar lists may be Active-only or narrowed by a filter right now, and
 * selectSession validates against them.
 */
async function openRoutineSession(sessionId, host) {
  if (!sessionId) return;
  closeRoutinesView();
  if (!sessionState.findSession(sessionId, host)) await loadSessions(undefined, { withPrevious: true });
  await selectSession(sessionId, { host });
}

// --- mutations -----------------------------------------------------------

function routineFormBody(values) {
  return {
    name: values.name,
    description: values.description,
    harness: values.harness,
    cwd: values.cwd,
    // Explicit null, not undefined: JSON.stringify drops undefined keys, and
    // a PUT is a partial update — a dropped key would leave the old model in
    // place instead of clearing it back to the harness default.
    model: values.model || null,
    thinking: values.thinking || null,
    prompt: values.prompt,
    schedule: values.cron ? { cron: values.cron } : null,
    enabled: values.enabled,
    mode: values.mode,
    onBusy: values.onBusy,
    minIntervalSec: values.minIntervalSec,
  };
}

function setRoutineFormError(message) {
  routineFormError = message || '';
  const el = document.getElementById('rtError');
  if (el) el.textContent = routineFormError;
}

function setRoutineNotice(message) {
  routineNotice = message || '';
  const el = document.getElementById('rtNotice');
  if (el) el.textContent = routineNotice;
}

async function saveRoutine() {
  if (routineBusy) return;
  const values = readRoutineForm();
  if (!values) return;
  const btn = document.getElementById('rtSaveBtn');
  const creating = routineCreating;
  const hostId = routineFormHostId();
  setRoutineFormError('');
  setRoutineNotice('');
  routineBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const path = creating ? '/api/routines' : `/api/routines/${encodeURIComponent(routineSelected.id)}`;
    const res = await apiFetch(hostId, path, {
      method: creating ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routineFormBody(values)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const saved = data.routine || data;
    routineCreating = false;
    routineSelected = { ...saved, host: hostId };
    routineSelKey = routineKey(hostId, saved.id);
    routineVersionShown = null;
    renderRoutineDetail();
    setRoutineNotice(creating ? 'Routine created.' : `Saved (v${saved.promptVersion || 1}).`);
    await loadRoutinesView();
    if (creating) {
      routineInvocations = [];
      routineInvocationsNextBefore = null;
      startRoutineInvocationPoll();
    }
    loadRoutineInvocations({ reset: true });
  } catch (e) {
    setRoutineFormError(e.message);
  } finally {
    routineBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = creating ? 'Create routine' : 'Save'; }
  }
}

async function runRoutineNow() {
  if (routineBusy || !routineSelected) return;
  const btn = document.getElementById('rtRunBtn');
  setRoutineFormError('');
  setRoutineNotice('');
  routineBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  try {
    const res = await apiFetch(routineSelected.host,
      `/api/routines/${encodeURIComponent(routineSelected.id)}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'pi-dish-ui' }),
      });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 409 busy / 429 rate-limited carry their own useful shapes.
      const extra = res.status === 429 && data.retryAfterSec ? ` (retry in ${data.retryAfterSec}s)` : '';
      throw new Error((data.error || `HTTP ${res.status}`) + extra);
    }
    setRoutineNotice('Run started.');
    await loadRoutineInvocations({ reset: true });
    loadRoutinesView(); // the row's run count and last-run line just changed
  } catch (e) {
    setRoutineFormError(e.message);
  } finally {
    routineBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Run now'; }
  }
}

let routineDeleteArmTimer = null;

async function deleteRoutine() {
  if (routineBusy || !routineSelected) return;
  const btn = document.getElementById('rtDeleteBtn');
  if (!routineDeleteArmed) {
    // Two-tap arm, like the sidebar's row-level close.
    routineDeleteArmed = true;
    if (btn) btn.textContent = 'Delete?';
    clearTimeout(routineDeleteArmTimer);
    routineDeleteArmTimer = setTimeout(() => {
      routineDeleteArmed = false;
      const live = document.getElementById('rtDeleteBtn');
      if (live) live.textContent = 'Delete';
    }, 3000);
    return;
  }
  clearTimeout(routineDeleteArmTimer);
  routineDeleteArmed = false;
  routineBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    const res = await apiFetch(routineSelected.host,
      `/api/routines/${encodeURIComponent(routineSelected.id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    stopRoutineInvocationPoll();
    routineSelected = null;
    routineSelKey = null;
    routineFormBaseline = null;
    routineInvocations = [];
    backToRoutinesList();
    renderRoutineDetail();
    await loadRoutinesView();
  } catch (e) {
    routineBusy = false;
    setRoutineFormError(e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
    return;
  }
  routineBusy = false;
}

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
