import type { HostEndpoint } from './api-client';
import type { EffectiveHost } from './host-catalog';
import type { CwdAutocompleteOptions } from './cwd-autocomplete';
import type { Terminal as Xterm } from '@xterm/xterm';
import type { FitAddon as XtermFitAddon } from '@xterm/addon-fit';
declare const Terminal: typeof Xterm | undefined;
declare const FitAddon: { FitAddon: typeof XtermFitAddon } | typeof XtermFitAddon | undefined;
import type { HostTarget, RequestOptions } from './api-client';
import type { SessionEntry, SelectionOwner } from './session-state';
import type { HighlightRuntime, MarkedRuntime, MermaidRuntime } from './rich-text-vendors';
declare const PiDishBrowser: typeof import('./index');
declare const marked: MarkedRuntime | undefined, hljs: HighlightRuntime | undefined, mermaid: MermaidRuntime | undefined;
declare const OMP_MODEL_ROLES: typeof import('./shared-helpers').OMP_MODEL_ROLES;
declare const composeModelRoleRef: typeof import('./shared-helpers').composeModelRoleRef;
declare const escapeHtml: typeof import('./shared-helpers').escapeHtml;
declare const fuzzyMatch: typeof import('./shared-helpers').fuzzyMatch;
declare const fuzzyScore: typeof import('./shared-helpers').fuzzyScore;
declare const harnessBadgeInfo: typeof import('./shared-helpers').harnessBadgeInfo;
declare const highlightFuzzy: typeof import('./shared-helpers').highlightFuzzy;
declare const hostDisplayLabel: typeof import('./shared-helpers').hostDisplayLabel;
declare const hostSupportsCapability: typeof import('./shared-helpers').hostSupportsCapability;
declare const hostSupportsTerminal: typeof import('./shared-helpers').hostSupportsTerminal;
declare const modelRoleLevels: typeof import('./shared-helpers').modelRoleLevels;
declare const parseModelRoleRef: typeof import('./shared-helpers').parseModelRoleRef;
declare const parseSessionKey: typeof import('./shared-helpers').parseSessionKey;
declare const sessionKey: typeof import('./shared-helpers').sessionKey;
declare const sessionRef: typeof import('./shared-helpers').sessionRef;
declare const sessionRefKey: typeof import('./shared-helpers').sessionRefKey;
declare const shortCwd: typeof import('./shared-helpers').shortCwd;

// =========================================================================
// Hosts (TASKS/multi-host.md phase 1) — every API touch resolves a host
// entry first, so a later phase can point this client at several pi-dish
// servers at once. With an empty catalog every request resolves to the self
// host (base '', no token) and the wire traffic is exactly what a
// single-host client always sent.
// =========================================================================
// Catalog values enter through the typed normalization/merge boundary.

const hostView = PiDishBrowser.createHostView();
function appRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const HOSTS_KEY = 'pi-dish-hosts';
const KEYS_MIGRATED_KEY = 'pi-dish-keys-migrated';
// Directly-added hosts (phase 2 owns the editor UI); self is always implicit.
const hostDirectory: ReturnType<typeof PiDishBrowser.createHostDirectory> = PiDishBrowser.createHostDirectory({
  initialCatalog: readJSONPref(HOSTS_KEY, []),
  descriptor: id => hostDiscovery.descriptor(id),
  persistCatalog: catalog => localStorage.setItem(HOSTS_KEY, JSON.stringify(catalog)),
});
// hostId stays null until GET /api/host answers — and forever on a server
// too old to serve it, which is why every key path tolerates host-less keys.
// The directory owns self identity, source catalogs and their effective list.

/** Effective-list (or self) entry for a host id; unknown ids fall back to self. */
function hostById(...args: Parameters<typeof hostDirectory.hostById>) { return hostDirectory.hostById(...args); }

/** Accepts a host id, a host entry, or nothing (self). */
function resolveHost(...args: Parameters<typeof hostDirectory.resolveHost>) { return hostDirectory.resolveHost(...args); }

/**
 * The one fetch entry point for /api paths. Nothing else in this file may
 * call fetch() for the API: the host's base and bearer token are attached
 * here, so a request can't accidentally go to the serving origin when the
 * session lives elsewhere. Returns fetch's promise unchanged.
 */
const apiTransport: ReturnType<typeof PiDishBrowser.createHostTransport> = PiDishBrowser.createHostTransport({ resolveHost, fetch: (...args) => fetch(...args) });
const sessionApi: ReturnType<typeof PiDishBrowser.createSessionApi> = PiDishBrowser.createSessionApi((...args) => apiFetch(...args));

function apiFetch(host: HostTarget, path: string, opts: RequestOptions = {}) {
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
function hostAssetUrl(host: HostTarget | undefined, path: string) {
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
function withFetchTimeout(...args: Parameters<typeof PiDishBrowser.withFetchTimeout>) { return PiDishBrowser.withFetchTimeout(...args); }

/** ws(s) URL for a host path — scheme/authority come from the host's base. */
function hostWsUrl(host: HostTarget, path: string) {
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
async function mintHostTicket(host: HostTarget, purpose: string) {
  const data = await apiSend(host, '/api/auth/ticket', { purpose });
  if (!appRecord(data) || typeof data.ticket !== 'string' || !data.ticket) throw new Error('no ticket');
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
    const isBare = (key: string) => parseSessionKey(key).hostId === null;
    const compose = (id: string) => sessionKey(hostDirectory.self.hostId, id);
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

const hostConnections: ReturnType<typeof PiDishBrowser.createHostConnections> = PiDishBrowser.createHostConnections({ onChange: () => renderHostsSection() });
// GET /api/host descriptors, by hostId. Runtime only: label/version/
// capabilities belong to the host, not to this browser's catalog entry (the
// catalog deliberately persists only base/id/label/token), so they are
// overlaid onto the merged list instead of being written back into it.

function invalidateHosts() { hostDirectory.invalidate(); }
function effectiveHosts() { return hostDirectory.effectiveHosts().map(hostView); }

function hostKeyOf(...args: Parameters<typeof PiDishBrowser.hostKeyOf>) { return PiDishBrowser.hostKeyOf(...args); }
function isMultiHost() { return effectiveHosts().length > 1; }
function selfHostEntry() { return effectiveHosts()[0]; }

/** Effective entry for a host id — null when nothing in the list claims it. */
function hostEntryFor(...args: Parameters<typeof hostDirectory.entryFor>) { const host = hostDirectory.entryFor(...args); return host ? hostView(host) : null; }

function hostLabelFor(hostId?: string | null) {
  const entry = hostEntryFor(hostId);
  return entry ? hostDisplayLabel(entry) : '';
}

/** reachable | connecting | backoff | blocked — one host's connection state. */
function hostState(...args: Parameters<typeof hostConnections.stateOf>) { return hostConnections.stateOf(...args); }

/** Down = its rows are last-known, not live (backoff or blocked). */
function hostIsDown(...args: Parameters<typeof hostConnections.isDown>) { return hostConnections.isDown(...args); }
function hostIdIsDown(hostId?: string | null) {
  const entry = hostEntryFor(hostId);
  return entry ? hostIsDown(entry) : false;
}

// Connection observations and poll eligibility share the typed retry policy.
function noteHostReachable(host: Parameters<typeof hostConnections.note>[0]) { hostConnections.note(host, 'success'); }
function noteHostBlocked(host: Parameters<typeof hostConnections.note>[0]) { hostConnections.note(host, 'blocked'); }
function noteHostFailure(host: Parameters<typeof hostConnections.note>[0], error: unknown) { hostConnections.note(host, { type: 'failure', error }); }
function seedHostConnFromFleet() { hostConnections.seed(effectiveHosts()); }
function pollableHosts() { return hostConnections.pollable(effectiveHosts()); }

/** Hosts whose data may be fetched for search/usage fan-out. */
function fanoutHosts() {
  return pollableHosts();
}

// The controls are usable before async initialization finishes. Fan-out
// views wait on this first catalog load so an early click cannot capture
// self as the whole fleet and then remain permanently under-counted.
let resolveHostFleetReady: () => void;
const hostFleetReady = new Promise<void>(resolve => { resolveHostFleetReady = resolve; });
const hostDiscovery: ReturnType<typeof PiDishBrowser.createHostDiscovery> = PiDishBrowser.createHostDiscovery({
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
const hostPresentation: ReturnType<typeof PiDishBrowser.createHostPresentation> = PiDishBrowser.createHostPresentation({
  directory: hostDirectory,
  initialColors: readJSONPref(HOST_COLORS_KEY, {}),
  initialOrder: readJSONPref(HOST_COLOR_ORDER_KEY, []),
  persistColors: colors => localStorage.setItem(HOST_COLORS_KEY, JSON.stringify(colors)),
  persistOrder: order => localStorage.setItem(HOST_COLOR_ORDER_KEY, JSON.stringify(order)),
  onColorChanged: rows => {
    if (rows) renderHostsSection();
    renderSessions();
  },
  escapeHtml, displayLabel: host => hostDisplayLabel(hostView(host)), isDown: hostIsDown,
});
function hostColorFor(...args: Parameters<typeof hostPresentation.colorFor>) { return hostPresentation.colorFor(...args); }
function hostColorIsCustom(...args: Parameters<typeof hostPresentation.isCustom>) { return hostPresentation.isCustom(...args); }
function setHostColorOverride(...args: Parameters<typeof hostPresentation.setColor>) { hostPresentation.setColor(...args); }
function resolveColorToHex(...args: Parameters<typeof PiDishBrowser.resolveColorToHex>) { return PiDishBrowser.resolveColorToHex(...args); }
function hostDotHtml(...args: Parameters<typeof hostPresentation.dotHtml>) { return hostPresentation.dotHtml(...args); }
function hostChipHtml(...args: Parameters<typeof hostPresentation.chipHtml>) { return hostPresentation.chipHtml(...args); }

// All session list/selection writes and their rendering hooks share one store.
// Read its snapshots freely; mutate them only through its four state writers.
const sessionState: ReturnType<typeof PiDishBrowser.createSessionState> = PiDishBrowser.createSessionState({
  getSelfHostId: () => hostDirectory.self.hostId,
  getHostLabel: hostLabelFor,
  onListsChanged: renderSessions,
  onCurrentChanged: updateSessionHeader,
});
// Provisional rows for asynchronous harness launches. They are presentation state,
// not sessions: the durable source of truth remains tmux + the bridge registry.

// Spawn operations are server-process-local and cannot be resumed after a
// page reload, so their old draft keys have no view that could restore them.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith('pi-dish-draft-spawn:')) localStorage.removeItem(key);
  }
} catch {}
const responseDetailsController: ReturnType<typeof PiDishBrowser.createResponseDetails> = PiDishBrowser.createResponseDetails({ document, sessionState, mode: () => displayPreferences.responseMode });



// =========================================================================
// Scroll pinning — only follow streaming output while the user is at the
// bottom. Scrolling up "unpins"; new content then accumulates below without
// yanking the viewport, and a jump-to-bottom button appears.
// =========================================================================

const appChrome = PiDishBrowser.createAppChrome({ document, storage: localStorage, older: container => maybeLoadOlderMessages(container) });
function autosizePromptInput(input: HTMLTextAreaElement) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; }
function isPinnedToBottom(container: HTMLElement) { return appChrome.pinned(container); }
function scrollToBottom(container: HTMLElement) { appChrome.scroll(container); }
function updateJumpButton(container: HTMLElement) { appChrome.jump(container); }

function loadCommands(...args: Parameters<typeof composerAutocomplete.loadCommands>) { return composerAutocomplete.loadCommands(...args); }

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const startupSelection = sessionState.selectionGeneration;
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
  if (saved.sessionId && startupSelection === sessionState.selectionGeneration) {
    const found = sessionState.findSession(saved.sessionId, saved.hostId);
    if (found) selectSession(saved.sessionId, { host: found.host || null });
  }
  
  const promptInput = (document.getElementById('promptInput') as HTMLTextAreaElement);

  promptInput.addEventListener('keydown', (e) => {
    if (composerAutocomplete.visible) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveAutocomplete(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveAutocomplete(-1); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        var items = document.querySelectorAll<HTMLElement>('.autocomplete-item');
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
    if (e.key === 'Escape' && !composerAutocomplete.visible && !isRecording() && sessionActivity.turn) { e.preventDefault(); abortTurn(); }
  });

  // Global Ctrl+C to abort
  document.addEventListener('keydown', function(e) {
    // Keys typed into the terminal belong to the shell (Ctrl+C = SIGINT,
    // Ctrl+F = forward), not to the app-level shortcuts.
    if (e.target instanceof Element && e.target.closest('.terminal-panel')) return;
    if (e.ctrlKey && e.key === 'c' && sessionActivity.turn) {
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
      .map((it) => it.getAsFile()).filter((file): file is File => file !== null);
    if (!files.length) return;
    e.preventDefault();
    addImageFiles(files);
  });

  (document.getElementById('imageFileInput') as HTMLInputElement).addEventListener('change', (e) => {
    const input = e.currentTarget as HTMLInputElement; addImageFiles(input.files || []);
    input.value = ''; // allow re-picking the same file
  });

  // Tap any transcript image to view it full-size.
  document.addEventListener('click', (e) => {
    const img = (e.target instanceof Element ? e.target.closest<HTMLImageElement>('img.msg-image') : null);
    if (img) openImageLightbox(img.src);
  });

  // Tap a linkified file mention to open it in the viewer. preventDefault
  // keeps a link inside a <summary> (tool-call headers) from toggling the
  // enclosing <details>.
  document.addEventListener('click', (e) => {
    const link = (e.target instanceof Element ? e.target.closest<HTMLElement>('.file-link') : null);
    if (!link || !sessionState.currentSession) return;
    e.preventDefault();
    openFileViewer((link.textContent || '').trim());
  });

  // Per-message share link (the hover 🔗 in turn headers).
  document.addEventListener('click', (e) => {
    const btn = (e.target instanceof Element ? e.target.closest<HTMLElement>('.msg-link-btn') : null);
    if (btn) copyMessageShareLink(btn);
  });

  // Periodic refresh must preserve an in-flight server search, or the list
  // resets to unfiltered mid-search.
  sidebarLists.mount();

  sidebarControls.mount();

  const messagesEl = (document.getElementById('messages') as HTMLElement);
  if (messagesEl) {
    appChrome.mount();
    // Open the session a #ref chip names. Cross-host chips carry the host in
    // the ref, so the lookup — not the click — decides which host to switch to.
    messagesEl.addEventListener('click', (e) => {
      const chip = (e.target instanceof Element ? e.target.closest<HTMLElement>('.session-ref-chip') : null);
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
const sessionReferences: ReturnType<typeof PiDishBrowser.createSessionReferences> = PiDishBrowser.createSessionReferences({
  sessionState, selfId: () => hostDirectory.self.hostId, host: hostEntryFor, hostLabel: hostLabelFor, config: () => appConfig,
});
const composerAutocomplete: ReturnType<typeof PiDishBrowser.createComposerAutocomplete> = PiDishBrowser.createComposerAutocomplete({
  document, sessionState, composerKey: () => composerDrafts.key, provisional: () => !!sessionView.spawnId,
  request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor, references: sessionReferences,
  multiHost: isMultiHost, hostLabel: hostLabelFor, failed: error => console.error('Failed to load commands:', error),
});
function handleAutocomplete(...args: Parameters<typeof composerAutocomplete.handle>) { composerAutocomplete.handle(...args); }
function queueFileAutocomplete(...args: Parameters<typeof composerAutocomplete.queueFile>) { composerAutocomplete.queueFile(...args); }
function showFileAutocomplete(...args: Parameters<typeof composerAutocomplete.showFiles>) { composerAutocomplete.showFiles(...args); }
function acceptFileMention(...args: Parameters<typeof composerAutocomplete.acceptFile>) { composerAutocomplete.acceptFile(...args); }
function allKnownSessions() { return sessionReferences.all(); }
function sessionHostIdOf(...args: Parameters<typeof sessionReferences.hostId>) { return sessionReferences.hostId(...args); }
function sessionRefCandidates() { return sessionReferences.candidates(); }
function sameHostSessionIds(...args: Parameters<typeof sessionReferences.sameHostIds>) { return sessionReferences.sameHostIds(...args); }
function refPrefixFor(...args: Parameters<typeof sessionReferences.prefix>) { return sessionReferences.prefix(...args); }
function composerSessionRef(...args: Parameters<typeof sessionReferences.ref>) { return sessionReferences.ref(...args); }
function showSessionRefAutocomplete(...args: Parameters<typeof composerAutocomplete.showRefs>) { composerAutocomplete.showRefs(...args); }
function acceptSessionRefMention(...args: Parameters<typeof composerAutocomplete.acceptRef>) { composerAutocomplete.acceptRef(...args); }
function sessionMatchingRef(...args: Parameters<typeof sessionReferences.match>) { return sessionReferences.match(...args); }
function sessionRefHints(...args: Parameters<typeof sessionReferences.hints>) { return sessionReferences.hints(...args); }
function showAutocomplete(...args: Parameters<typeof composerAutocomplete.showCommands>) { composerAutocomplete.showCommands(...args); }
function hideAutocomplete() { composerAutocomplete.hide(); }
function moveAutocomplete(...args: Parameters<typeof composerAutocomplete.move>) { composerAutocomplete.move(...args); }
function acceptAutocomplete(...args: Parameters<typeof composerAutocomplete.accept>) { composerAutocomplete.accept(...args); }
function acceptAutocompleteByName(...args: Parameters<typeof composerAutocomplete.acceptCommand>) { composerAutocomplete.acceptCommand(...args); }

// =========================================================================
// Sidebar
// =========================================================================

// Query, list fan-out and seen activity have separate typed owners.
const sidebarActivity: ReturnType<typeof PiDishBrowser.createSidebarActivity> = PiDishBrowser.createSidebarActivity({ document, storage: localStorage, sessionState });
const sidebarQuery: ReturnType<typeof PiDishBrowser.createSidebarQuery> = PiDishBrowser.createSidebarQuery({
  document, storage: localStorage, request: (host, path, options) => apiFetch(host, path, options), host: () => hostEntryFor(null)!,
  render: () => renderSessions(), reload: query => loadSessions(query), queriedFor: () => sidebarLists.queriedFor,
  invalidateLists: () => sidebarLists.invalidate(), busy: value => setSearchBusy(value),
  searchChanged: () => { if (isSearchViewOpen()) runSearchView(); }, openSearch: query => openSearchView(query),
  prompt: (label, initial) => window.prompt(label, initial), alert: message => alert(message),
});
sidebarQuery.mount();
const sidebarLists: ReturnType<typeof PiDishBrowser.createSidebarLists> = PiDishBrowser.createSidebarLists({
  document, request: (host, path, options) => apiFetch(host, path, options), sessionState, activity: sidebarActivity,
  hosts: effectiveHosts, pollable: pollableHosts, selfId: () => hostDirectory.self.hostId,
  query: () => sidebarQuery.query, all: () => sidebarQuery.tab === 'all', refreshFleet: refreshHostFleetSoon,
  connection: (host, event) => hostConnections.note(host, event),
});
const hostSessionLoader = sidebarLists.loader;
function toggleSidebarView() { sidebarQuery.toggleView(); }
function updateViewToggle() { sidebarQuery.updateView(); }
function loadSavedFilters() { return sidebarQuery.loadFilters(); }
function persistSavedFilters(next: Parameters<typeof sidebarQuery.persistFilters>[0], host?: HostEndpoint | null) { return sidebarQuery.persistFilters(next, host || undefined); }
function scopeQuery() { return sidebarQuery.scope(); }
function toggleScope(...args: Parameters<typeof sidebarQuery.toggleScope>) { sidebarQuery.toggleScope(...args); }
function saveCurrentFilterAsScope() { return sidebarQuery.saveCurrent(); }
function renderScopeChips() { sidebarQuery.renderChips(); }
function markSessionSeen(...args: Parameters<typeof sidebarActivity.mark>) { sidebarActivity.mark(...args); }
function isUnread(...args: Parameters<typeof sidebarActivity.unread>) { return sidebarActivity.unread(...args); }
function updateUnreadTitle() { sidebarActivity.title(); }
function toggleSidebar() { sidebarQuery.toggle(); }
function closeSidebar() { sidebarQuery.close(); }
function switchTab(...args: Parameters<typeof sidebarQuery.switchTab>) { sidebarQuery.switchTab(...args); }
function onFilterInput() { sidebarQuery.onInput(); }
function setSearchBusy(...args: Parameters<typeof sidebarLists.busy>) { sidebarLists.busy(...args); }
function loadSessions(...args: Parameters<typeof sidebarLists.load>) { return sidebarLists.load(...args); }
function queryHosts(...args: Parameters<typeof PiDishBrowser.queryHosts>) { return PiDishBrowser.queryHosts(...args); }
function loadHostSessions(...args: Parameters<typeof hostSessionLoader.load>) { return hostSessionLoader.load(...args); }
function publishSessionLists() { sidebarLists.publish(); }
function refreshSessions() { return sidebarLists.refresh(); }

// Sidebar row controls own preferences, family pins, confirmation, drag and menus.
const sidebarControls: ReturnType<typeof PiDishBrowser.createSidebarControls> = PiDishBrowser.createSidebarControls({
  document, storage: localStorage, sessionState, request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor, render: () => renderSessions(), closeSidebar: () => closeSidebar(),
  select: (id, host) => selectSession(id, { host }), pending: id => showPendingSessionView(id), create: (cwd, host) => createSession(cwd, host),
  finishClose: (id, host, owner) => finishSessionClose(id, host, owner), refresh: () => loadSessions(undefined, { withPrevious: true }),
  ref: session => sessionRefFor(session), copy: text => copyTextToClipboard(text), status: (message, type) => setStatus(message, type),
});
function harnessBadgeInnerHtml(...args: Parameters<typeof PiDishBrowser.harnessBadgeInnerHtml>) { return PiDishBrowser.harnessBadgeInnerHtml(...args); }
function renderHarnessBadge(...args: Parameters<typeof PiDishBrowser.renderHarnessBadge>) { return PiDishBrowser.renderHarnessBadge(...args); }
function keyForSessionId(id: string) { return sessionKey(sessionState.sessionHostId(id), id); }
function toggleGroupCollapsed(...args: Parameters<typeof sidebarControls.toggleGroup>) { sidebarControls.toggleGroup(...args); }
function toggleSessionFamilyExpanded(...args: Parameters<typeof sidebarControls.toggleFamily>) { sidebarControls.toggleFamily(...args); }
function currentFamilyRootMap() { return sidebarControls.familyRoots(); }
function revealSessionInFamily(...args: Parameters<typeof sidebarControls.reveal>) { sidebarControls.reveal(...args); }
function toggleSessionPinned(...args: Parameters<typeof sidebarControls.togglePin>) { sidebarControls.togglePin(...args); }
function handleRowCloseClick(...args: Parameters<typeof sidebarControls.closeClick>) { sidebarControls.closeClick(...args); }
function performRowClose(...args: Parameters<typeof sidebarControls.performClose>) { return sidebarControls.performClose(...args); }
function sessionRefFor(session: Pick<SessionEntry, 'id' | 'host'> | null) { return session?.id ? sessionRef(session, hostEntryFor(session.host || null), refPrefixFor(session)) : ''; }
function isSessionMenuOpen() { return sidebarControls.menuOpen; }
function closeSessionMenu() { sidebarControls.closeMenu(); }
function openSessionMenu(...args: Parameters<typeof sidebarControls.openMenu>) { sidebarControls.openMenu(...args); }

// Render one metadata snapshot through the typed sidebar projection.
let lastSessionListHtml = '';
function renderSessions() {
  if (sidebarControls.dragging) return;
  const sidebarFamilyRootMap = currentFamilyRootMap();
  const { html, count } = PiDishBrowser.renderSidebar({
    ...sessionState.sessions, selected: sessionState.currentSession,
    tab: sidebarQuery.tab, view: sidebarQuery.view, query: sidebarQuery.query, queriedFor: sidebarLists.queriedFor, scope: scopeQuery(), indexing: sidebarLists.indexing,
    contextMetric: displayPreferences.contextMetric, pending: [...pendingSessionSpawns.entries()], selectedSpawn: sessionView.spawnId,
    expanded: sidebarControls.expanded, collapsed: sidebarControls.collapsed, pinned: sidebarControls.pinned, roots: sidebarFamilyRootMap,
    closeConfirm: sidebarControls.closeConfirm, closeBusy: sidebarControls.closeBusy, multiHost: isMultiHost(),
    unread: isUnread, hostChip: hostChipHtml,
    hosts: effectiveHosts().map(host => {
      const cache = hostSessionLoader.getCache(host);
      return { ...host, state: hostState(host), key: hostKeyOf(host), color: hostColorFor(host.hostId || null),
        dot: hostDotHtml(host.hostId || null, 'host-section-dot'), hasCache: !!cache && !!(cache.active.length || cache.previous.length) };
    }),
  });
  const countEl = (document.getElementById('countActive') as HTMLElement);
  if (countEl) countEl.textContent = count ? String(count) : '';
  if (html !== lastSessionListHtml) {
    closeSessionMenu();
    (document.getElementById('sessionList') as HTMLElement).innerHTML = html;
    lastSessionListHtml = html;
  }
  updateUnreadTitle();
}
function workspaceGroupKey(hostId: string | null, path: string) { return isMultiHost() && hostId ? sessionKey(hostId, path) : path; }

// =========================================================================
// Session Selection
// =========================================================================

function pendingComposerKey(id: string) { return `spawn:${id}`; }
const sessionView: ReturnType<typeof PiDishBrowser.createSessionView> = PiDishBrowser.createSessionView({ document, sessionState, storage: localStorage, endpoint: resolveHost,
  get drafts() { return composerDrafts; }, get activity() { return sessionActivity; }, get transcript() { return transcriptController; }, get stream() { return messageStreamController; }, get resume() { return sessionResume; },
  spawn: id => pendingSessionSpawns.get(id), resetSearch: () => sessionSearch.reset(), cancelStreaming: () => cancelStreamingRender(), stopFollowing: () => { appChrome.stopFollowing(); },
  closeViews: (_pending, keepBounce) => {
    closeSearch(); closeDiffView(); closeFileView(); closeStatsModal(); closeTreeModal(); closeModelDropdown(); closeThinkingDropdown(); closeArtifactsModal();
    closeUsageView(); closeSearchView(); closeNewSessionView(); closeSkillsView(); closeRoutinesView(); closeRecoveryView(); if (!keepBounce) closeBounceView();
  },
  closeTerminal: () => closeTerminal(), clearExtension: () => clearExtensionUI(), clearRelations: () => clearSessionRelations(), closeControls: () => closeControlPanel(), hideAutocomplete: () => hideAutocomplete(),
  retireModels: () => modelCatalog.retire(), retireCommands: () => composerAutocomplete.retireCommands(), queue: data => renderQueueStatus(data), closeBtw: () => closeBtwPanel(), resetArtifacts: () => sessionInfo.resetArtifacts(),
  thinking: () => updateThinkingBadges(), terminal: () => updateTerminalButtons(), mic: () => updateMicButton(), mood: (description, face) => setMoodIndicator(description, face), status: (message, type) => setStatus(message, type),
  render: () => renderSessions(), cancelRecording: () => cancelRecording(), hideNote: () => hideComposerNote(), math: () => loadMathAssets(), reveal: (id, host) => revealSessionInFamily(id, host),
  seen: session => markSessionSeen(session), artifacts: owner => refreshArtifacts(owner), header: () => updateSessionHeader(), relations: owner => loadSessionRelations(owner), models: (id, harness) => loadModels(id, harness), commands: id => loadCommands(id),
});
function showPendingSessionView(...args: Parameters<typeof sessionView.pending>) { sessionView.pending(...args); }
function showPendingSessionFailure(...args: Parameters<typeof sessionView.failure>) { sessionView.failure(...args); }
function selectSession(...args: Parameters<typeof sessionView.select>) { return sessionView.select(...args); }
const sessionResume: ReturnType<typeof PiDishBrowser.createSessionResume> = PiDishBrowser.createSessionResume({ document, sessionState, request: (...args) => apiFetch(...args), endpoint: resolveHost,
  target: host => savedResumeTarget(host), refresh: () => refreshSessions(), select: (id, options) => selectSession(id, options), status: (message, type) => setStatus(message, type),
});
function resetResumeModelPicker() { sessionResume.reset(); }
function loadResumeModelOptions(...args: Parameters<typeof sessionResume.load>) { return sessionResume.load(...args); }
function resumeSession() { return sessionResume.resume(); }

// =========================================================================
// Models
// =========================================================================

const modelCatalog: ReturnType<typeof PiDishBrowser.createModelCatalog> = PiDishBrowser.createModelCatalog({
  read: scope => sessionApi.models(scope.host, scope),
  persist: (scope, models) => localStorage.setItem(modelsCacheKey(scope.harnessId, scope.host.hostId), JSON.stringify(models)),
  changed: refreshResponsePricingState,
  failed: error => console.error('Failed to load models:', error),
});
function modelCatalogUrl(...args: Parameters<typeof PiDishBrowser.modelCatalogUrl>) { return PiDishBrowser.modelCatalogUrl(...args); }
function modelsCacheKey(harnessId: string, hostId: string | null) {
  return PiDishBrowser.modelsCacheKey(harnessId, hostId, hostDirectory.self.hostId);
}
function loadModels(sessionId?: string | null, harnessId?: string, cwd?: string, host?: string | null) {
  const owner = sessionId ? sessionState.captureSelection() : null;
  const storedHarness = sessionId ? sessionState.findSession(sessionId)?.harnessId : null;
  const requestedHarnessId = harnessId || (typeof storedHarness === 'string' ? storedHarness : '') || 'pi';
  const requestedHost = sessionId ? sessionState.sessionHostId(sessionId) : (host === undefined ? null : host);
  const endpoint = hostEntryFor(requestedHost);
  if (!endpoint) { modelCatalog.clear(); return Promise.resolve(); }
  const captured = Object.freeze({ ...endpoint });
  const generation = newSessionController.generation;
  const ownsRows = () => PiDishBrowser.sameDirectoryHost(captured, hostEntryFor(requestedHost))
    && (sessionId ? !!owner && owner.id === sessionId && sessionState.ownsSelection(owner)
      : generation === newSessionController.generation && isNewSessionViewOpen()
        && nsHostId() === captured.hostId && selectedHarnessId() === requestedHarnessId);
  const ownsRequest = () => ownsRows() && (!!sessionId || nsCwdValue() === (cwd || ''));
  return modelCatalog.load({ host: captured, sessionId: sessionId || undefined, harnessId: requestedHarnessId, cwd }, ownsRequest, ownsRows);
}

// =========================================================================
// Session Header
// =========================================================================

const sessionRelationsController: ReturnType<typeof PiDishBrowser.createSessionRelations> = PiDishBrowser.createSessionRelations({
  document, window, sessionState, request: (host, path, init) => apiFetch(host, path, init), endpoint: hostEntryFor,
  loadPrevious: () => loadSessions(undefined, { withPrevious: true }),
  selectSession: (id, options) => selectSession(id, options), status: setStatus,
});
function clearSessionRelations() { sessionRelationsController.clear(); }
function loadSessionRelations(...args: Parameters<typeof sessionRelationsController.load>) { return sessionRelationsController.load(...args); }
function openRelatedSession(...args: Parameters<typeof sessionRelationsController.openRelated>) { return sessionRelationsController.openRelated(...args); }
function openRelationsModal() { sessionRelationsController.openModal(); }
function closeRelationsModal() { sessionRelationsController.closeModal(); }

/**
 * Most model signal that fits the chip. The provider slug is the least
 * informative part, so it is dropped before the name is allowed to
 * ellipsize (CSS does the truncation). Full ref stays in the tooltip.
 */
const sessionHeader: ReturnType<typeof PiDishBrowser.createSessionHeader> = PiDishBrowser.createSessionHeader({ document, sessionState, multi: isMultiHost, host: hostEntryFor, down: hostIdIsDown, color: hostColorFor, label: hostLabelFor,
  settings: session => harnessSupportsSettings(session), ensureHarness: id => ensureHarnessRows(id), thinking: () => updateThinkingBadges(), terminal: () => updateTerminalButtons(), mic: () => updateMicButton(),
});
function setModelChipLabel(...args: Parameters<typeof sessionHeader.label>) { sessionHeader.label(...args); }
function updateSessionHeader() { sessionHeader.update(); }

// Header actions capture their selection before opening editors or dispatching.
const sessionControls: ReturnType<typeof PiDishBrowser.createSessionControls> = PiDishBrowser.createSessionControls({
  document, sessionState, catalog: modelCatalog, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  loadModels: (id, harness) => loadModels(id, harness), status: (message, type) => setStatus(message, type),
});
function updateThinkingBadges() { sessionControls.updateThinking(); }
function toggleThinkingDropdown() { return sessionControls.toggleThinking(); }
function closeThinkingDropdown() { sessionControls.closeThinking(); }
function selectThinkingLevel(...args: Parameters<typeof sessionControls.selectThinking>) { return sessionControls.selectThinking(...args); }

// --- Focus mode: hide tool calls/results so only user/assistant text shows ---
function setFocusMode(on: boolean) { appChrome.setFocus(on); }

// Whole-transcript search owns query requests, marks and serialized paging jumps.
const sessionSearch: ReturnType<typeof PiDishBrowser.createSessionSearch> = PiDishBrowser.createSessionSearch({
  document, sessionState, request: (host, path, init) => apiFetch(host, path, init), endpoint: hostEntryFor,
  focusMode: () => appChrome.focus, oldestIndex: () => transcriptController.oldestIndex, hasOlder: () => transcriptController.hasOlder,
  loadOlder: () => loadOlderMessages(), stopFollowing: () => { appChrome.stopFollowing(); }, updateJumpButton,
});
const search = sessionSearch.state;
function toggleSearchBar() { sessionSearch.toggle(); }
function openSearch() { sessionSearch.open(); }
function closeSearch() { sessionSearch.close(); }
function updateSearchCount(...args: Parameters<typeof sessionSearch.updateCount>) { sessionSearch.updateCount(...args); }
function runSessionSearch(...args: Parameters<typeof sessionSearch.run>) { return sessionSearch.run(...args); }
function searchPrev() { return sessionSearch.move(-1); }
function searchNext() { return sessionSearch.move(1); }
function jumpToSearchResult() { return sessionSearch.jump(); }
function handleSearchKey(...args: Parameters<typeof sessionSearch.key>) { sessionSearch.key(...args); }

// --- Mobile control panel (model/thinking/context/focus/tree/export) ---
function toggleControlPanel() { appChrome.togglePanel(); }
function openControlPanel() { appChrome.openPanel(); }
function closeControlPanel() { appChrome.closePanel(); }
function toggleFocusMode() { appChrome.toggleFocus(); }

// Display preferences own modal requests, rendered controls and device readouts.
const displayPreferences: ReturnType<typeof PiDishBrowser.createDisplayPreferences> = PiDishBrowser.createDisplayPreferences({
  document, storage: localStorage, request: (host, url, options) => apiFetch(host, url, options), host: () => hostEntryFor(null)!,
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
const recoveryController: ReturnType<typeof PiDishBrowser.createRecovery> = PiDishBrowser.createRecovery({
  root: document.querySelector<HTMLElement>('.main')!, request: apiFetch, hosts: effectiveHosts,
  supports: host => hostSupportsCapability(host, 'recovery', appConfig), down: hostIsDown,
  fleetReady: () => hostFleetReady, refreshFleet: loadHostFleet,
  selectedHost: () => sessionState.currentSession?.host || null,
  settingsOpen: () => (document.getElementById('settingsModal') as HTMLElement).style.display !== 'none',
  closeOtherViews: () => { closeSettingsModal(); closeSidebar(); closeUsageView(); closeSearchView(); closeNewSessionView(); closeSkillsView(); closeRoutinesView(); closeBounceView(); closeDiffView(); closeFileView(); },
  confirm: message => confirm(message),
});
function refreshRecoveryHosts() { recoveryController.refreshHosts(); }
function renderRecoveryPreferences() { return recoveryController.mountPreferences(); }
function isRecoveryViewOpen() { return recoveryController.isOpen(); }
function closeRecoveryView() { recoveryController.close(); }
function openRecoveryView(...args: Parameters<typeof recoveryController.open>) { recoveryController.open(...args); }
function loadRecoveryView() { return recoveryController.load(); }

// --- Hosts (settings section, not a takeover: it is a short list plus one
// add form). The catalog is device-local by design — a browser's own list of
// machines it can reach, tokens included; fleet entries come from the
// server's config and are shown read-only. ---------------------------------

const hostSettings: ReturnType<typeof PiDishBrowser.createHostSettings> = PiDishBrowser.createHostSettings({
  directory: hostDirectory, connections: hostConnections, discovery: hostDiscovery,
  request: apiFetch, protocol: () => location.protocol,
  promptToken: label => prompt(`Token for ${label}`, ''),
  displayLabel: host => hostDisplayLabel({ base: host.base, label: host.label ? String(host.label) : '', name: host.name ? String(host.name) : '' }), escapeHtml,
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
const searchViewController: ReturnType<typeof PiDishBrowser.createSearchView> = PiDishBrowser.createSearchView({
  root: document.querySelector<HTMLElement>('.main')!, request: apiFetch, sessionState,
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
function openSearchView(...args: Parameters<typeof searchViewController.open>) { searchViewController.open(...args); }
function closeSearchView() { searchViewController.close(); }
function onSearchViewInput(...args: Parameters<typeof searchViewController.input>) { searchViewController.input(...args); }
function runSearchView() { return searchViewController.run(); }
function setSearchToken(...args: Parameters<typeof searchViewController.setToken>) { searchViewController.setToken(...args); }
function openSearchResult(...args: Parameters<typeof searchViewController.openResult>) { return searchViewController.openResult(...args); }

// The skills directory and coverage view retain their entry-host ownership.
const skillsController: ReturnType<typeof PiDishBrowser.createSkills> = PiDishBrowser.createSkills({
  root: document.querySelector<HTMLElement>('.main')!, request: apiFetch, self: selfHostEntry, origin: () => location.origin,
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
function openSkillDetail(...args: Parameters<typeof skillsController.detail>) { return skillsController.detail(...args); }
function openSkillActivation(...args: Parameters<typeof skillsController.activation>) { return skillsController.activation(...args); }

// Usage owns range/filter state, progressive fleet results and chart controls.
const usageController: ReturnType<typeof PiDishBrowser.createUsageView> = PiDishBrowser.createUsageView({
  root: document.querySelector<HTMLElement>('.main')!, request: apiFetch, storage: localStorage,
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
function setUsageRange(...args: Parameters<typeof usageController.setRange>) { usageController.setRange(...args); }
function setUsageSort(...args: Parameters<typeof usageController.setSort>) { usageController.setSort(...args); }
function setUsageStack(...args: Parameters<typeof usageController.setStack>) { usageController.setStack(...args); }

// Session information owns stats/process/share controls and artifact discovery.
const sessionInfo: ReturnType<typeof PiDishBrowser.createSessionInfo> = PiDishBrowser.createSessionInfo({
  document, request: (host, path, options) => apiFetch(host, path, options), sessionState, host: hostEntryFor,
  reference: session => sessionRefFor(session), copy: text => copyTextToClipboard(text), status: (text, type) => setStatus(text, type), confirm: text => confirm(text),
  loadPrevious: () => loadSessions(undefined, { withPrevious: true }), refreshSessions: () => refreshSessions(), selectSession: (id, options) => selectSession(id, options),
});
function openStatsModal() { sessionInfo.openStats(); }
function closeStatsModal() { sessionInfo.closeStats(); }
function copyMessageShareLink(...args: Parameters<typeof sessionInfo.copyMessage>) { return sessionInfo.copyMessage(...args); }
function finishSessionClose(...args: Parameters<typeof sessionInfo.finishClose>) { return sessionInfo.finishClose(...args); }
function refreshArtifacts(...args: Parameters<typeof sessionInfo.refreshArtifacts>) { return sessionInfo.refreshArtifacts(...args); }
function updateArtifactsBadge() { sessionInfo.updateBadge(); }
function openArtifactsModal() { sessionInfo.openArtifacts(); }
function closeArtifactsModal() { sessionInfo.closeArtifacts(); }

// File and diff takeovers share a typed owner and keep comment coordination explicit.
const fileViews: ReturnType<typeof PiDishBrowser.createFileViews> = PiDishBrowser.createFileViews({
  document, sessionState, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  markdown: text => formatMarkdown(text), highlight: root => applyHighlight(root), copy: text => copyTextToClipboard(text),
  status: (message, type) => setStatus(message, type), refreshArtifacts: owner => refreshArtifacts(owner),
  closeComments: () => closeCommentBubble(), clearComments: () => setAnchoredComments([]),
  refreshComments: () => refreshAnchoredComments(), markComments: () => applyCommentMarks(),
});
function isFileViewOpen() { return fileViews.isFileOpen(); }
function ownsFileView(...args: Parameters<typeof fileViews.ownsFile>) { return fileViews.ownsFile(...args); }
function openFileViewer(...args: Parameters<typeof fileViews.openFile>) { return fileViews.openFile(...args); }
function closeFileView() { fileViews.closeFile(); }
function publishFileView() { return fileViews.publish(); }
function copyFileViewContent(...args: Parameters<typeof fileViews.copy>) { fileViews.copy(...args); }
function isDiffViewOpen() { return fileViews.isDiffOpen(); }
function ownsDiffView(...args: Parameters<typeof fileViews.ownsDiff>) { return fileViews.ownsDiff(...args); }
function toggleDiffView() { fileViews.toggleDiff(); }
function openDiffView() { return fileViews.openDiff(); }
function closeDiffView() { fileViews.closeDiff(); }
function loadDiffView() { return fileViews.loadDiff(); }
function loadDeferredDiffPatch(...args: Parameters<typeof fileViews.loadPatch>) { return fileViews.loadPatch(...args); }

// Anchored comments retain their view, request and editor lifetimes.
const anchoredCommentController: ReturnType<typeof PiDishBrowser.createAnchoredComments> = PiDishBrowser.createAnchoredComments({
  document, sessionState, views: fileViews, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  status: (message, type) => setStatus(message, type), loadPatch: details => loadDeferredDiffPatch(details),
});
function selectionTextAnchor(...args: Parameters<typeof PiDishBrowser.selectionTextAnchor>) { return PiDishBrowser.selectionTextAnchor(...args); }
function isCommentBubbleOpen() { return anchoredCommentController.isOpen(); }
function captureFileCommentSelection(...args: Parameters<typeof anchoredCommentController.captureFile>) { anchoredCommentController.captureFile(...args); }
function captureDiffCommentSelection(...args: Parameters<typeof anchoredCommentController.captureDiff>) { anchoredCommentController.captureDiff(...args); }
function initCommentSelections() { anchoredCommentController.mount(); }
function positionCommentBubble() { anchoredCommentController.position(); }
function openCommentBubble(...args: Parameters<typeof anchoredCommentController.openDraft>) { anchoredCommentController.openDraft(...args); }
function closeCommentBubble() { anchoredCommentController.close(); }
function handleCommentKey(...args: Parameters<typeof anchoredCommentController.key>) { anchoredCommentController.key(...args); }
function submitAnchoredComment() { return anchoredCommentController.submit(); }
function setAnchoredComments(...args: Parameters<typeof anchoredCommentController.set>) { anchoredCommentController.set(...args); }
function refreshAnchoredComments() { return anchoredCommentController.refresh(); }
function applyCommentMarks() { anchoredCommentController.applyMarks(); }
function renderCommentCountChips() { anchoredCommentController.renderChips(); }
function isCommentListPopoverOpen() { return anchoredCommentController.isListOpen(); }
function closeCommentListPopover() { anchoredCommentController.closeList(); }
function toggleCommentListPopover(...args: Parameters<typeof anchoredCommentController.toggleList>) { anchoredCommentController.toggleList(...args); }
function renderCommentListPopover() { anchoredCommentController.renderList(); }
function focusAnchoredComment(...args: Parameters<typeof anchoredCommentController.focus>) { return anchoredCommentController.focus(...args); }
function openCommentEditor(...args: Parameters<typeof anchoredCommentController.openEditor>) { anchoredCommentController.openEditor(...args); }
function disarmCommentDelete() { anchoredCommentController.disarmDelete(); }
function handleCommentDelete() { return anchoredCommentController.remove(); }

function exportSession() { return sessionControls.export(); }
function downloadBlob(...args: Parameters<typeof sessionControls.download>) { sessionControls.download(...args); }
function startRename() { sessionControls.startRename(); }
function handleRenameKey(...args: Parameters<typeof sessionControls.renameKey>) { sessionControls.renameKey(...args); }
function commitRename() { return sessionControls.commitRename(); }
function cancelRename() { sessionControls.cancelRename(); }
function toggleModelDropdown() { return sessionControls.toggleModels(); }
function renderModelDropdown(...args: Parameters<typeof sessionControls.renderModels>) { sessionControls.renderModels(...args); }
function enterModelEditMode() { sessionControls.setEditMode(true); }
function exitModelEditMode() { sessionControls.setEditMode(false); }
function currentModelQuery() { return sessionControls.query; }
function toggleModelEnabled(...args: Parameters<typeof sessionControls.toggleModel>) { sessionControls.toggleModel(...args); }
function setAllModelsEnabled(...args: Parameters<typeof sessionControls.setAll>) { sessionControls.setAll(...args); }
function toggleProviderEnabled(...args: Parameters<typeof sessionControls.toggleProvider>) { sessionControls.toggleProvider(...args); }
function saveEnabledModels() { sessionControls.saveEnabled(); }
function closeModelDropdown() { sessionControls.closeModels(); }
function selectModel(...args: Parameters<typeof sessionControls.selectModel>) { return sessionControls.selectModel(...args); }

// =========================================================================
// Messages
// =========================================================================

const transcriptController: ReturnType<typeof PiDishBrowser.createTranscript> = PiDishBrowser.createTranscript({
  document, sessionState, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  renderMessage: message => renderMessageHtml(message), finalize: (root, options) => finalizeRender(root, options),
  closeSearch: () => closeSearch(), cancelStreaming: () => cancelStreamingRender(), mood: (description, face) => setMoodIndicator(description, face),
  updateMood: messages => updateMoodFromMessages(messages), pinned: isPinnedToBottom, scroll: scrollToBottom, jump: updateJumpButton,
  consumeEcho: (id, content) => consumePendingSelfEcho(id, content),
});
function stashCurrentTranscript() { transcriptController.stash(); }
function restoreCachedTranscript(...args: Parameters<typeof transcriptController.restore>) { return transcriptController.restore(...args); }
function pruneTranscriptCache(...args: Parameters<typeof transcriptController.pruneCache>) { transcriptController.pruneCache(...args); }
function maybeLoadOlderMessages(...args: Parameters<typeof transcriptController.maybeOlder>) { transcriptController.maybeOlder(...args); }
function renderMessageHtml(...args: Parameters<typeof messageRenderer.message>) { return messageRenderer.message(...args); }
function loadMessages(...args: Parameters<typeof transcriptController.load>) { return transcriptController.load(...args); }
function renderLoadOlderBar() { return transcriptController.barHtml(); }
function renderMessages(...args: Parameters<typeof transcriptController.render>) { transcriptController.render(...args); }
function loadOlderMessages() { return transcriptController.loadOlder(); }
function fetchNewMessagesSince(...args: Parameters<typeof transcriptController.catchup>) { return transcriptController.catchup(...args); }

// Typed message projection and telemetry retain only their own render data.
const messageRenderer: ReturnType<typeof PiDishBrowser.createMessageRenderer> = PiDishBrowser.createMessageRenderer({
  document, sessionState, details: responseDetailsController, markdown: text => formatMarkdown(text),
  assetUrl: hostAssetUrl, matchRef: ref => sessionMatchingRef(ref), pinned: isPinnedToBottom,
  follow: () => appChrome.following, scroll: scrollToBottom, jump: updateJumpButton,
});
function imageBlocksHtml(...args: Parameters<typeof messageRenderer.images>) { return messageRenderer.images(...args); }
function renderUserMessage(...args: Parameters<typeof messageRenderer.user>) { return messageRenderer.user(...args); }
function renderAssistantMessage(...args: Parameters<typeof messageRenderer.assistant>) { return messageRenderer.assistant(...args); }
function renderCustomMessage(...args: Parameters<typeof messageRenderer.custom>) { return messageRenderer.custom(...args); }
function renderThinkingBlock(...args: Parameters<typeof messageRenderer.thinking>) { return messageRenderer.thinking(...args); }
function renderToolCall(...args: Parameters<typeof messageRenderer.tool>) { return messageRenderer.tool(...args); }
function upsertLiveCustomMessage(...args: Parameters<typeof messageRenderer.upsertCustom>) { messageRenderer.upsertCustom(...args); }
function updateRenderedResponseMetadata() { responseDetailsController.update(); }
function refreshResponsePricingState() { responseDetailsController.refreshPricing(); }
function openResponseDetails(...args: Parameters<typeof responseDetailsController.open>) { responseDetailsController.open(...args); }
function closeResponseDetails() { responseDetailsController.close(); }

// =========================================================================
// Live Tool Panels (streaming tool execution)
// =========================================================================

const liveToolsController: ReturnType<typeof PiDishBrowser.createLiveTools> = PiDishBrowser.createLiveTools({
  document, sessionState, started: (id, name) => sessionActivity.toolStarted(id, name),
  finished: id => sessionActivity.toolFinished(id), pinned: isPinnedToBottom, scroll: scrollToBottom, jump: updateJumpButton,
  images: (content, alt) => imageBlocksHtml(content, alt), mood: (name, args) => applyMoodFromTool(name, args),
});
function appendLiveToolPanel(...args: Parameters<typeof liveToolsController.append>) { return liveToolsController.append(...args); }
function updateLiveToolPanel(...args: Parameters<typeof liveToolsController.update>) { liveToolsController.update(...args); }
function finalizeLiveToolPanel(...args: Parameters<typeof liveToolsController.finish>) { liveToolsController.finish(...args); }

// =========================================================================
// SSE Streaming (RPC events only)
// =========================================================================

const messageStreamController: ReturnType<typeof PiDishBrowser.createMessageStream> = PiDishBrowser.createMessageStream({ document, sessionState, endpoint: resolveHost, ticket: host => mintHostTicket(host, 'stream'),
  get activity() { return sessionActivity; }, renderer: messageRenderer, get streaming() { return streamingRenderer; }, tools: liveToolsController, get delivery() { return promptDelivery; }, get extensionUI() { return extensionUI; },
  status: (message, type) => setStatus(message, type), catchup: owner => fetchNewMessagesSince(owner), refresh: () => refreshSessions(), artifacts: owner => refreshArtifacts(owner),
  pinned: isPinnedToBottom, follow: () => appChrome.following, scroll: scrollToBottom, jump: updateJumpButton, highlight: root => applyHighlight(root),
  select: (id, options) => selectSession(id, options), deleteCached: key => transcriptController.deleteCached(key), loadSessions: (query, options) => loadSessions(query, options),
});
function startMessageStream(...args: Parameters<typeof messageStreamController.start>) { return messageStreamController.start(...args); }

// =========================================================================
// Prompt / Turn / Abort
// =========================================================================

// Drafts and attachments share a host-qualified composer owner.
const composerDrafts: ReturnType<typeof PiDishBrowser.createComposerDrafts> = PiDishBrowser.createComposerDrafts({
  document, storage: localStorage, keyForSession: keyForSessionId, currentSessionId: () => sessionState.currentSession?.id || null,
  autosize: input => autosizePromptInput(input), status: (message, type) => setStatus(message, type),
});
function addImageFiles(...args: Parameters<typeof composerDrafts.images.add>) { return composerDrafts.images.add(...args); }
function prepareImageAttachment(...args: Parameters<typeof composerDrafts.images.prepare>) { return composerDrafts.images.prepare(...args); }
function fileToBase64(...args: Parameters<typeof composerDrafts.images.read>) { return composerDrafts.images.read(...args); }
function renderAttachmentStrip() { composerDrafts.images.render(); }
function removeAttachment(...args: Parameters<typeof composerDrafts.images.remove>) { composerDrafts.images.remove(...args); }
function takePendingImages() { return composerDrafts.images.take(); }
function openImageLightbox(...args: Parameters<typeof composerDrafts.images.openLightbox>) { composerDrafts.images.openLightbox(...args); }

// Dictation retains the composer that requested permission and transcription.
const composerNotes: ReturnType<typeof PiDishBrowser.createComposerNotes> = PiDishBrowser.createComposerNotes(document);
const composerSpeech: ReturnType<typeof PiDishBrowser.createComposerSpeech> = PiDishBrowser.createComposerSpeech({
  document, sessionState, composerKey: () => composerDrafts.key, hosts: effectiveHosts, config: () => appConfig,
  request: (host, path, options) => apiFetch(host, path, options), status: message => setStatus(message),
  showNote: text => showComposerNote(text), hideNote: () => hideComposerNote(),
});
function showComposerNote(...args: Parameters<typeof composerNotes.show>) { composerNotes.show(...args); }
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
function finishRecording(...args: Parameters<typeof composerSpeech.finish>) { composerSpeech.finish(...args); }
function transcribeRecording(...args: Parameters<typeof composerSpeech.transcribe>) { return composerSpeech.transcribe(...args); }
function insertTranscript(...args: Parameters<typeof composerSpeech.insert>) { composerSpeech.insert(...args); }

function composerOwnerKey(...args: Parameters<typeof composerDrafts.ownerKey>) { return composerDrafts.ownerKey(...args); }
function draftKey(...args: Parameters<typeof composerDrafts.draftKey>) { return composerDrafts.draftKey(...args); }
function historyKey(...args: Parameters<typeof composerDrafts.historyKey>) { return composerDrafts.historyKey(...args); }
function writeSessionDraft(...args: Parameters<typeof composerDrafts.write>) { composerDrafts.write(...args); }
function stashPromptState() { composerDrafts.stash(); }
function clearPromptComposer() { composerDrafts.clear(); }
function setComposerWaiting(...args: Parameters<typeof composerDrafts.waiting>) { composerDrafts.waiting(...args); }
function saveDraftSoon() { composerDrafts.saveSoon(); }
function clearDraft(...args: Parameters<typeof composerDrafts.clearDraft>) { composerDrafts.clearDraft(...args); }
function restorePromptState(...args: Parameters<typeof composerDrafts.restore>) { composerDrafts.restore(...args); }
function recordPrompt(...args: Parameters<typeof composerDrafts.record>) { composerDrafts.record(...args); }
function mergeComposerText(...args: Parameters<typeof PiDishBrowser.mergeComposerText>) { return PiDishBrowser.mergeComposerText(...args); }
function migratePromptState(...args: Parameters<typeof composerDrafts.migrate>) { composerDrafts.migrate(...args); }
function restorePromptToSession(...args: Parameters<typeof composerDrafts.restorePayload>) { composerDrafts.restorePayload(...args); }
function navigateHistory(...args: Parameters<typeof composerDrafts.navigate>) { return composerDrafts.navigate(...args); }

const promptDelivery: ReturnType<typeof PiDishBrowser.createPromptDelivery> = PiDishBrowser.createPromptDelivery({ document, sessionState, request: (...args) => apiFetch(...args), endpoint: resolveHost,
  restore: (key, text) => restorePromptToSession(key, text, null), status: (message, type) => setStatus(message, type),
});
function discardOptimisticPrompt(...args: Parameters<typeof promptDelivery.discard>) { promptDelivery.discard(...args); }
function consumePendingSelfEcho(id: string, content: unknown) { return promptDelivery.consume(keyForSessionId(id), content); }
function sendPrompt() { return composerSubmit.sendPrompt(); }

const sessionActivity: ReturnType<typeof PiDishBrowser.createSessionActivity> = PiDishBrowser.createSessionActivity({ document, sessionState, clearQueue: () => renderQueueStatus(null), status: message => setStatus(message) });
function updateWorkingIndicator() { sessionActivity.update(); }
function setTurnInProgress(active: boolean) { sessionActivity.setTurn(!!active); }
function setCompacting(active: boolean) { sessionActivity.setCompacting(!!active); }

function sendQueuedMessage(...args: Parameters<typeof composerSubmit.sendQueuedMessage>) { return composerSubmit.sendQueuedMessage(...args); }
function sendSteer() { return composerSubmit.sendSteer(); }
function sendFollowUp() { return composerSubmit.sendFollowUp(); }
function renderQueueStatus(...args: Parameters<typeof promptDelivery.render>) { promptDelivery.render(...args); }
function editQueuedMessage(...args: Parameters<typeof promptDelivery.edit>) { return promptDelivery.edit(...args); }

// ---------------------------------------------------------------------------
// /btw panel — ephemeral side question (OMP). The answer never lands in the
// transcript; it lives in this dismissible card above the composer, mirroring
// the TUI's btw panel. A new question replaces the panel; a session switch
// drops it (see the two selection reset points).
// ---------------------------------------------------------------------------
const btwPanel: ReturnType<typeof PiDishBrowser.createBtwPanel> = PiDishBrowser.createBtwPanel({ document, sessionState, markdown: text => formatMarkdown(text), copy: text => copyTextToClipboard(text) });
function showBtwPanel(...args: Parameters<typeof btwPanel.show>) { return btwPanel.show(...args); }
function resolveBtwPanel(...args: Parameters<typeof btwPanel.resolve>) { btwPanel.resolve(...args); }
function failBtwPanel(...args: Parameters<typeof btwPanel.fail>) { btwPanel.fail(...args); }
function closeBtwPanel() { btwPanel.close(); }
function copyBtwAnswer(...args: Parameters<typeof btwPanel.copy>) { return btwPanel.copy(...args); }

const composerSubmit: ReturnType<typeof PiDishBrowser.createComposerSubmit> = PiDishBrowser.createComposerSubmit({ document, sessionState, drafts: composerDrafts, delivery: promptDelivery, activity: sessionActivity, btw: btwPanel,
  request: (...args) => apiFetch(...args), endpoint: resolveHost, spawnId: () => sessionView.spawnId, spawnPending: () => !!sessionView.spawnId && pendingSessionSpawns.has(sessionView.spawnId),
  refs: message => sessionRefHints(message), status: (message, type) => setStatus(message, type), openTree: () => openTreeModal(), hideAutocomplete: () => hideAutocomplete(),
  refresh: () => refreshSessions(), follow: () => { appChrome.follow(); }, scroll: scrollToBottom, renderUser: (message, time, attrs) => renderUserMessage(message, time, attrs),
});
function abortTurn() { return composerSubmit.abortTurn(); }

const pendingSessionSpawns: ReturnType<typeof PiDishBrowser.createSessionSpawns> = PiDishBrowser.createSessionSpawns({
  request: apiFetch, delay: () => new Promise(resolve => setTimeout(resolve, 250)), harnessLabel,
  current: () => sessionView.spawnId, changed: renderSessions,
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
const newSessionController: ReturnType<typeof PiDishBrowser.createNewSession> = PiDishBrowser.createNewSession({
  root: document.querySelector<HTMLElement>('.main')!, storage: localStorage, request: apiFetch,
  self: selfHostEntry, host: hostEntryFor, hosts: effectiveHosts, hostDown: hostIsDown, multiHost: isMultiHost,
  sessionState, currentSpawn: () => sessionView.spawnId, spawns: pendingSessionSpawns, models: modelCatalog,
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
function submitNewSession(...args: Parameters<typeof newSessionController.submit>) { return newSessionController.submit(...args); }
function createSession(...args: Parameters<typeof newSessionController.create>) { return newSessionController.create(...args); }
function spawnNewSession() { return newSessionController.spawn(); }
function nsHost() { return newSessionController.host(); }
function nsHostId() { return newSessionController.hostId(); }
function nsHostSupports(...args: Parameters<typeof newSessionController.supports>) { return newSessionController.supports(...args); }
function nsHostOptions() { return newSessionController.hostOptions(); }
function nsCwdValue() { return newSessionController.cwd(); }
function setNsCwd(...args: Parameters<typeof newSessionController.setCwd>) { newSessionController.setCwd(...args); }
function selectedHarnessId() { return newSessionController.selectedHarness(); }
function harnessLabel(...args: Parameters<typeof newSessionController.harnessLabel>) { return newSessionController.harnessLabel(...args); }
function renderNsHosts() { newSessionController.renderHosts(); }
function renderNsHarnesses() { newSessionController.renderHarnesses(); }
function renderNsWorkspaces() { newSessionController.renderWorkspaces(); }
function onNsHostChange(...args: Parameters<typeof newSessionController.changeHost>) { newSessionController.changeHost(...args); }
function onNsHarnessChange(...args: Parameters<typeof newSessionController.changeHarness>) { newSessionController.changeHarness(...args); }
function onNsModelChange(...args: Parameters<typeof newSessionController.preferences.selectModel>) { newSessionController.preferences.selectModel(...args); }
function onNsThinkingChange(...args: Parameters<typeof newSessionController.preferences.selectThinking>) { newSessionController.preferences.selectThinking(...args); }
function syncNsThinking() { newSessionController.preferences.syncThinking(); }
function renderNsModel() { newSessionController.preferences.render(); }
function isNewSessionViewOpen() { return newSessionController.isOpen(); }
function openNewSessionView(...args: Parameters<typeof newSessionController.open>) { newSessionController.open(...args); }
function closeNewSessionView() { newSessionController.close(); }
function refreshNsPilotOptions() { newSessionController.refresh(); }
function scheduleNsPilotRefresh() { newSessionController.scheduleRefresh(); }
function initNsTree() { newSessionController.initTree(); }
function hideCwdDropdown() { newSessionController.hideCwd(); }
function nsError(...args: Parameters<typeof newSessionController.error>) { newSessionController.error(...args); }
function loadKnownCwds() { return directoryCatalog.load(); }
function loadSpawnTargets() { return spawnTargetsController.load(); }
function hideSpawnTargetDropdown() { spawnTargetPicker.hide(); }
function selectedSpawnTarget() { return newSessionController.selectedTarget(); }
function savedResumeTarget(host: string | null) { return spawnTargetsController.resume(hostEntryFor(host)); }
function loadHarnesses() { return harnessDiscovery.load(); }
function loadNsHarnessConfig(cwd = nsCwdValue()) { return newSessionConfigPreview.load(cwd); }
function harnessRow(...args: Parameters<typeof harnessDiscovery.row>) { return harnessDiscovery.row(...args); }
function ensureHarnessRows(hostId: string | null) { void harnessDiscovery.ensure(hostId); }
function harnessSupportsSettings(session: SessionEntry | null) {
  return !!session?.harnessId && !!harnessRow(sessionHostIdOf(session), session.harnessId)?.pilotConfig;
}
function modelSelectOptionsHtml(models: Parameters<typeof PiDishBrowser.modelSelectOptionsHtml>[0]) { return PiDishBrowser.modelSelectOptionsHtml(models, escapeHtml); }
function modelHiddenNote(...args: Parameters<typeof PiDishBrowser.modelHiddenNote>) { return PiDishBrowser.modelHiddenNote(...args); }

// One typed editor serves session settings and the new-session takeover.
const harnessSettingsController: ReturnType<typeof PiDishBrowser.createHarnessSettings> = PiDishBrowser.createHarnessSettings({
  root: (document.getElementById('harnessSettingsModal') as HTMLElement), host: hostEntryFor, request: apiFetch,
  fallbackModels: (host, harness) => modelCatalog.scope?.harnessId === harness
    && PiDishBrowser.sameDirectoryHost(modelCatalog.scope?.host || null, host) ? modelCatalog.rows() : [],
  escapeHtml, shortCwd, roleDefinitions: OMP_MODEL_ROLES, parseModelRoleRef, composeModelRoleRef, modelRoleLevels,
  onSaved: scope => {
    if (isNewSessionViewOpen() && selectedHarnessId() === scope.harnessId
        && nsHostId() === scope.hostId && nsCwdValue() === scope.cwd) void loadNsHarnessConfig();
  },
});
function isHarnessSettingsOpen() { return harnessSettingsController.isOpen(); }
function showHarnessSettingsTab(...args: Parameters<typeof harnessSettingsController.showTab>) { harnessSettingsController.showTab(...args); }
function closeHarnessSettings() { harnessSettingsController.close(); }
function saveHarnessSettings() { return harnessSettingsController.save(); }
async function harnessSettingsFetch(hostId: HostTarget, url: string) {
  const res = await apiFetch(hostId, url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
function openSessionHarnessSettings() {
  const session = sessionState.currentSession;
  if (!session || !harnessSupportsSettings(session)) return;
  return openHarnessSettings({ harnessId: session.harnessId || 'pi', hostId: sessionHostIdOf(session), cwd: session.cwd ?? '',
    label: session.harnessLabel || harnessBadgeInfo(session.harnessId ?? null).label });
}
function openHarnessSettings(opts: Partial<Parameters<typeof harnessSettingsController.open>[0]> = {}) {
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
}: Pick<CwdAutocompleteOptions, 'input' | 'dropdown' | 'known' | 'onPick' | 'onSubmit' | 'onBlur'> & { hostId?: () => string | null }) {
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
async function apiSend(host: HostTarget, path: string, body?: unknown, method = 'POST') {
  return PiDishBrowser.sendJson((...args) => apiFetch(...args), host, path, body, method);
}

function readJSONPref(key: string, fallback: unknown): unknown {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

/**
 * After a JSONL-based render the on-disk messages are authoritative: drop
 * the live tool panels (their content is duplicated by the indexed
 * tool-call/tool-result messages that just landed) and stop tracking them
 * so the next turn starts fresh.
 */
function removeDuplicatedLiveContent(container: HTMLElement) {
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
function finalizeRender(container: HTMLElement, { stripLive = true } = {}) {
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
function groupToolActivity(...args: Parameters<typeof PiDishBrowser.groupToolActivity>) { PiDishBrowser.groupToolActivity(...args); }
function updateToolGroupSummary(...args: Parameters<typeof PiDishBrowser.updateToolGroupSummary>) { PiDishBrowser.updateToolGroupSummary(...args); }

// =========================================================================
// Streaming assistant renderer — incremental, block-level, throttled.
//
// Every message_update carries the full message so far, so we keep one
// streaming DOM element and update only the content blocks that changed
// (the growing tail block in practice). No outerHTML swaps: <details>
// open/closed state survives naturally and layout work stays minimal.
// =========================================================================

const streamingRenderer: ReturnType<typeof PiDishBrowser.createStreamingRenderer> = PiDishBrowser.createStreamingRenderer({
  document, sessionState, markdown: text => formatMarkdown(text), pinned: isPinnedToBottom, scroll: scrollToBottom, jump: updateJumpButton,
});
function queueStreamingRender(...args: Parameters<typeof streamingRenderer.queue>) { streamingRenderer.queue(...args); }
function flushStreamingRender() { streamingRenderer.flush(); }
function cancelStreamingRender() { streamingRenderer.cancel(); }
function renderStreamingMessage(...args: Parameters<typeof streamingRenderer.render>) { streamingRenderer.render(...args); }

function setStatus(message: string, type = '') {
  const status = (document.getElementById('status') as HTMLElement);
  status.textContent = message;
  status.className = `status ${type}`;
}

// =========================================================================
// Mood indicator — web fallback for the mood extension's custom editor
// =========================================================================

const moodController: ReturnType<typeof PiDishBrowser.createMood> = PiDishBrowser.createMood(document);
function setMoodIndicator(...args: Parameters<typeof moodController.set>) { moodController.set(...args); }
function applyMoodFromTool(...args: Parameters<typeof moodController.fromTool>) { moodController.fromTool(...args); }
function updateMoodFromMessages(...args: Parameters<typeof moodController.fromMessages>) { moodController.fromMessages(...args); }

// =========================================================================
// Extension UI — unobtrusive hidable cards
// =========================================================================

const extensionUI: ReturnType<typeof PiDishBrowser.createExtensionUI> = PiDishBrowser.createExtensionUI({
  document, sessionState, storage: localStorage, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  status: (message, type) => setStatus(message, type),
});
function clearExtensionUI() { extensionUI.clear(); }
function handleExtensionUI(request: unknown, id: string, host = sessionState.sessionHostId(id)) { extensionUI.handle(request, { id, host }); }

// Rich text keeps the local vendor loaders, final render passes and diagram
// lifetimes separate from the transcript's streaming and retained DOM state.
const browserAssets: ReturnType<typeof PiDishBrowser.createBrowserAssets> = PiDishBrowser.createBrowserAssets(document);
const diagramRenderer: ReturnType<typeof PiDishBrowser.createDiagrams> = PiDishBrowser.createDiagrams({
  document, assets: browserAssets, runtime: () => typeof mermaid === 'undefined' ? null : mermaid,
  retainedRoots: () => transcriptController.retainedRoots(), isPinned: feed => isPinnedToBottom(feed), scrollBottom: feed => scrollToBottom(feed),
});
const richText: ReturnType<typeof PiDishBrowser.createRichText> = PiDishBrowser.createRichText({
  document, marked: typeof marked === 'undefined' ? null : marked, highlight: () => typeof hljs === 'undefined' ? null : hljs,
  assets: browserAssets, diagrams: diagramRenderer, sessionState, copy: text => copyTextToClipboard(text), status: (message, type) => setStatus(message, type),
});
function formatMarkdown(...args: Parameters<typeof richText.format>) { return richText.format(...args); }
function applyHighlight(...args: Parameters<typeof richText.highlight>) { richText.highlight(...args); }
function loadMathAssets() { return richText.loadMath(); }
function loadVendorAsset(...args: Parameters<typeof browserAssets.load>) { return browserAssets.load(...args); }
function refreshDiagramTheme() { diagramRenderer.refreshTheme(); }
function copyTextToClipboard(text: string) { return PiDishBrowser.copyTextToClipboard(text, document, navigator); }

// =========================================================================
// Tree Modal
// =========================================================================
const transcriptTree: ReturnType<typeof PiDishBrowser.createTranscriptTree> = PiDishBrowser.createTranscriptTree({
  document, storage: localStorage, sessionState, request: (host, path, options) => apiFetch(host, path, options), host: hostEntryFor,
  status: (message, type) => setStatus(message, type), selectSession: (id, options) => selectSession(id, options),
  saveEditorDraft: (owner, text) => {
    try { const key = draftKey(sessionRefKey(owner)); if (!(localStorage.getItem(key) || '').trim()) localStorage.setItem(key, text); } catch {}
  },
});
function openTreeModal() { return transcriptTree.open(); }
function closeTreeModal() { transcriptTree.close(); }
function selectTreeNode(...args: Parameters<typeof transcriptTree.select>) { transcriptTree.select(...args); }
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
  } else if ((document.getElementById('commentBubble') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); closeCommentBubble();
  } else if ((document.getElementById('responseDetailsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); closeResponseDetails();
  } else if (isHarnessSettingsOpen()) {
    // Modal only — the new-session takeover underneath stays open.
    e.preventDefault(); closeHarnessSettings();
  } else if ((document.getElementById('settingsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); closeSettingsModal();
  } else if ((document.getElementById('relationsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); closeRelationsModal();
  } else if ((document.getElementById('treeModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); closeTreeModal();
  } else if ((document.getElementById('statsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); closeStatsModal();
  } else if ((document.getElementById('artifactsModal') as HTMLElement).style.display !== 'none') {
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

let appConfig: Record<string, unknown> = { terminal: false };
async function loadConfig() {
  try {
    const res = await apiFetch(null, '/api/config');
    const data: unknown = await res.json(); if (res.ok && appRecord(data)) appConfig = data;
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
function sessionHostSupportsTerminal(session: SessionEntry | null) {
  return hostSupportsTerminal(hostEntryFor(session?.host), appConfig);
}

/** Same rule for the pi-tmux view button: tmux is the owning host's, too. */
function sessionHostSupportsTmux(session: SessionEntry | null) {
  return hostSupportsCapability(hostEntryFor(session?.host), 'tmux', appConfig);
}

function updateTerminalButtons() { terminalController.updateButtons(); }

// =========================================================================
// Theme payloads and pre-paint cache restoration share typed token decoding.
const themesController: ReturnType<typeof PiDishBrowser.createThemes> = PiDishBrowser.createThemes({ document, storage: localStorage, request: (host, url, options) => apiFetch(host, url, options), host: () => hostEntryFor(null)!,
  changed: () => { terminalController.refreshTheme(); refreshDiagramTheme(); },
});
function loadThemes() { return themesController.load(); }
function renderThemeSelect(...args: Parameters<typeof themesController.render>) { themesController.render(...args); }
function applyTheme(...args: Parameters<typeof themesController.apply>) { themesController.apply(...args); }
function terminalTheme() { return PiDishBrowser.terminalTheme(document); }

// Terminal lifecycle owns pending opens, host endpoints, sockets and reconnects.
const terminalController: ReturnType<typeof PiDishBrowser.createTerminalController> = PiDishBrowser.createTerminalController({
  document, storage: localStorage, sessionState, host: host => hostEntryFor(host),
  supportsTerminal: session => sessionHostSupportsTerminal(session), supportsTmux: session => sessionHostSupportsTmux(session),
  asset: (tag, attributes) => loadVendorAsset(tag, attributes),
  createTerminal: options => typeof Terminal === 'undefined' ? null : new Terminal(options),
  createFitAddon: () => { const runtime = typeof FitAddon === 'undefined' ? null : FitAddon; const Ctor = typeof runtime === 'function' ? runtime : runtime?.FitAddon; return Ctor ? new Ctor() : null; },
  socket: url => new WebSocket(url), socketUrl: (host, path) => hostWsUrl(host, path), ticket: (host, purpose) => mintHostTicket(host, purpose),
  theme: () => terminalTheme(), applySize: panel => applySavedTerminalSize(panel), confirm: message => confirm(message),
});
function terminalModeKey(...args: Parameters<typeof terminalController.modeKey>) { return terminalController.modeKey(...args); }
function loadTerminalAssets() { return terminalController.loadAssets(); }
function toggleTerminal() { terminalController.toggle(); }
function openTerminal(...args: Parameters<typeof terminalController.open>) { return terminalController.open(...args); }
function closeTerminal() { terminalController.close(); }
function fitTerminal() { terminalController.fit(); }
function termSend(...args: Parameters<typeof terminalController.send>) { terminalController.send(...args); }
function connectTerminalWS() { terminalController.connect(); }
function updateTerminalModeUI() { terminalController.updateMode(); }
function switchTerminalMode() { terminalController.switchMode(); }
function restartTerminalShell() { terminalController.restart(); }
function termKeybarPress(...args: Parameters<typeof terminalController.key>) { terminalController.key(...args); }

// Resize controllers own each pointer capture and release listeners on disposal.
const panelResize: ReturnType<typeof PiDishBrowser.createPanelResize> = PiDishBrowser.createPanelResize({ document, storage: localStorage, fitTerminal: () => fitTerminal() });
function clampSidebarWidth(px: number) { return PiDishBrowser.clampSidebarWidth(px, window.innerWidth); }
function applySavedSidebarWidth() { panelResize.sidebarWidth(); }
function initSidebarResize() { panelResize.sidebar(); }
function initTerminalResize() { panelResize.terminal(); }
function clampTerminalHeight(...args: Parameters<typeof PiDishBrowser.clampTerminalHeight>) { return PiDishBrowser.clampTerminalHeight(...args); }
function applySavedTerminalSize(...args: Parameters<typeof panelResize.terminalSize>) { panelResize.terminalSize(...args); }

function initTerminalKeybar() { terminalController.mountKeybar(); }

// =========================================================================
// Routines own their host-qualified form, catalogs, mutations and run ledger.
const routinesController: ReturnType<typeof PiDishBrowser.createRoutinesView> = PiDishBrowser.createRoutinesView({
  root: document.querySelector<HTMLElement>('.main')!, request: (host, url, options) => apiFetch(host, url, options), storage: localStorage, sessionState,
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
function selectRoutine(...args: Parameters<typeof routinesController.select>) { return routinesController.select(...args); }
function startRoutineCreate() { routinesController.create(); }
function saveRoutine() { return routinesController.save(); }
function runRoutineNow() { return routinesController.run(); }
function deleteRoutine() { return routinesController.delete(); }

// Bounce owns host snapshots, selected targets, status polling and view disposal.
const bounceController: ReturnType<typeof PiDishBrowser.createBounce> = PiDishBrowser.createBounce({
  document, request: apiFetch, hosts: effectiveHosts, fleetReady: () => hostFleetReady,
  sessionState, refreshSessions, loadPrevious: () => loadSessions(undefined, { withPrevious: true }), selectSession,
});
function isBounceViewOpen() { return bounceController.isOpen(); }
function closeBounceView() { bounceController.close(); }
function refreshBounceView() { return bounceController.refresh(); }
function selectBounceTargets(...args: Parameters<typeof bounceController.select>) { bounceController.select(...args); }
function submitBounceTargets() { return bounceController.submit(); }

const appBindings = PiDishBrowser.createAppBindings({ document, actions: {
  openUsageView: () => openUsageView(),
  openSkillsView: () => openSkillsView(),
  openRoutinesView: () => openRoutinesView(),
  openSettingsModal: () => openSettingsModal(),
  refreshSessions: () => refreshSessions(),
  openNewSessionView: () => openNewSessionView(),
  openSessionHarnessSettings: () => openSessionHarnessSettings(),
  openStatsModal: () => openStatsModal(),
  toggleSearchBar: () => toggleSearchBar(),
  toggleControlPanel: () => toggleControlPanel(),
  toggleTerminal: () => toggleTerminal(),
  toggleFocusMode: () => toggleFocusMode(),
  toggleDiffView: () => toggleDiffView(),
  openArtifactsModal: () => openArtifactsModal(),
  exportSession: () => exportSession(),
  searchKey: event => { if (event instanceof KeyboardEvent) handleSearchKey(event); },
  searchPrev: () => searchPrev(),
  searchNext: () => searchNext(),
  closeSearch: () => closeSearch(),
  loadDiffView: () => loadDiffView(),
  closeDiffView: () => closeDiffView(),
  closeFileView: () => closeFileView(),
  switchTerminalMode: () => switchTerminalMode(),
  restartTerminalShell: () => restartTerminalShell(),
  closeTerminal: () => closeTerminal(),
  resumeSession: () => resumeSession(),
  panelOpenSearch: () => { closeControlPanel(); openSearch(); },
  panelToggleTerminal: () => { closeControlPanel(); toggleTerminal(); },
  panelOpenDiffView: () => { closeControlPanel(); openDiffView(); },
  panelOpenArtifactsModal: () => { closeControlPanel(); openArtifactsModal(); },
  panelOpenTreeModal: () => { closeControlPanel(); openTreeModal(); },
  panelOpenSessionHarnessSettings: () => { closeControlPanel(); openSessionHarnessSettings(); },
  panelExportSession: () => { closeControlPanel(); exportSession(); },
  attachImage: () => (document.getElementById('imageFileInput') as HTMLInputElement).click(),
  abortTurn: () => abortTurn(),
  sendSteer: () => sendSteer(),
  sendFollowUp: () => sendFollowUp(),
  sendPrompt: () => sendPrompt(),
  loadUsageView: () => loadUsageView(),
  closeUsageView: () => closeUsageView(),
  closeSearchView: () => closeSearchView(),
  closeNewSessionView: () => closeNewSessionView(),
  onNsHostChange: (_event, node) => { if (node instanceof HTMLSelectElement) onNsHostChange(node.value); },
  onNsHarnessChange: (_event, node) => { if (node instanceof HTMLSelectElement) onNsHarnessChange(node.value); },
  onNsModelChange: (_event, node) => { if (node instanceof HTMLSelectElement) onNsModelChange(node.value); },
  onNsThinkingChange: (_event, node) => { if (node instanceof HTMLSelectElement) onNsThinkingChange(node.value); },
  editHarnessAgents: () => openHarnessSettings({ tab: 'agents' }),
  editHarnessModels: () => openHarnessSettings({ tab: 'models' }),
  spawnNewSession: () => spawnNewSession(),
  refreshRoutinesView: () => refreshRoutinesView(),
  closeRoutinesView: () => closeRoutinesView(),
  loadRecoveryView: () => loadRecoveryView(),
  closeRecoveryView: () => closeRecoveryView(),
  backdropCloseTreeModal: (event, node) => { if (event.target === node) closeTreeModal(); },
  closeTreeModal: () => closeTreeModal(),
  backdropCloseArtifactsModal: (event, node) => { if (event.target === node) closeArtifactsModal(); },
  closeArtifactsModal: () => closeArtifactsModal(),
  backdropCloseRelationsModal: (event, node) => { if (event.target === node) closeRelationsModal(); },
  closeRelationsModal: () => closeRelationsModal(),
  backdropCloseStatsModal: (event, node) => { if (event.target === node) closeStatsModal(); },
  closeStatsModal: () => closeStatsModal(),
  backdropCloseSettingsModal: (event, node) => { if (event.target === node) closeSettingsModal(); },
  closeSettingsModal: () => closeSettingsModal(),
  bounceToggle: (_event, node) => { if (node instanceof HTMLDetailsElement) { if (node.open) refreshBounceView(); else closeBounceView(); } },
  refreshBounceView: () => refreshBounceView(),
  bounceSelect: () => selectBounceTargets(true),
  bounceClear: () => selectBounceTargets(false),
  submitBounceTargets: () => submitBounceTargets(),
  backdropCloseHarnessSettings: (event, node) => { if (event.target === node) closeHarnessSettings(); },
  closeHarnessSettings: () => closeHarnessSettings(),
  harnessTabAgents: () => showHarnessSettingsTab('agents'),
  harnessTabModels: () => showHarnessSettingsTab('models'),
  saveHarnessSettings: () => saveHarnessSettings(),
  backdropCloseResponseDetails: (event, node) => { if (event.target === node) closeResponseDetails(); },
  closeResponseDetails: () => closeResponseDetails(),
} });
