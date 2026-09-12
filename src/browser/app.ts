import { createAppModels } from './app-models';
import { OMP_MODEL_ROLES, composeModelRoleRef, escapeHtml, fuzzyMatch, fuzzyScore, harnessBadgeInfo, highlightFuzzy, hostDisplayLabel, hostSupportsCapability, hostSupportsTerminal, modelRoleLevels, parseModelRoleRef, parseSessionKey, sessionKey, sessionRef, sessionRefKey, shortCwd } from './shared-helpers';
import { createHostView } from './host-view';
import { createHostDirectory } from './host-directory';
import { createHostTransport, createSessionApi, sendJson } from './api-client';
import { createHostConnections, hostKeyOf } from './host-connections';
import { createHostDiscovery } from './host-discovery';
import { createHostPresentation, resolveColorToHex } from './host-presentation';
import { createSessionState } from './session-state';
import { createResponseDetails } from './response-details';
import { createAppChrome } from './app-chrome';
import { createSessionReferences } from './session-references';
import { createComposerAutocomplete } from './composer-autocomplete';
import { createSidebarActivity } from './sidebar-activity';
import { createSidebarQuery } from './sidebar-query';
import { createSidebarLists } from './sidebar-lists';
import { createSidebarControls } from './sidebar-controls';
import { renderSidebar } from './sidebar-render';
import { createSessionView } from './session-view';
import { createSessionResume } from './session-resume';
import { createModelCatalog, modelsCacheKey as modelsCacheKeyBase } from './model-catalog';
import { sameDirectoryHost } from './directory-catalog';
import { createSessionRelations } from './session-relations';
import { createSessionHeader } from './session-header';
import { createSessionControls } from './session-controls';
import { createSessionSearch } from './session-search';
import { createDisplayPreferences } from './display-preferences';
import { createRecovery } from './recovery';
import { createHostSettings } from './host-settings';
import { createSearchView } from './search-view';
import { createSkills } from './skills';
import { createUsageView } from './usage-view';
import { createSessionInfo } from './session-info';
import { createFileViews } from './file-views';
import { createAnchoredComments } from './anchored-comments';
import { createTranscript } from './transcript';
import { createMessageRenderer } from './message-render';
import { createLiveTools } from './live-tools';
import { createMessageStream } from './message-stream';
import { createComposerDrafts } from './composer-drafts';
import { createComposerNotes } from './composer-notes';
import { createComposerSpeech } from './composer-speech';
import { createPromptDelivery } from './prompt-delivery';
import { createSessionActivity } from './session-activity';
import { createBtwPanel } from './btw-panel';
import { createComposerSubmit } from './composer-submit';
import { createSessionSpawns } from './session-spawns';
import { createNewSession } from './new-session';
import { createHarnessSettings } from './harness-settings';
import { createCwdAutocomplete as createCwdAutocompleteBase } from './cwd-autocomplete';
import { groupToolActivity } from './message-groups';
import { createStreamingRenderer } from './streaming-render';
import { createMood } from './mood';
import { createExtensionUI } from './extension-ui';
import { createBrowserAssets } from './browser-assets';
import { createDiagrams } from './diagrams';
import { createRichText } from './rich-text';
import { copyTextToClipboard as copyTextToClipboardBase } from './clipboard';
import { createTranscriptTree } from './transcript-tree';
import { createThemes, terminalTheme as terminalThemeBase } from './themes';
import { createTerminalController } from './terminal';
import { createPanelResize } from './panel-resize';
import { createRoutinesView } from './routines-view';
import { createBounce } from './bounce';
import { createAppBindings } from './app-bindings';
import type { HostEndpoint } from './api-client';
import type { CwdAutocompleteOptions } from './cwd-autocomplete';
import type { Terminal as Xterm } from '@xterm/xterm';
import type { FitAddon as XtermFitAddon } from '@xterm/addon-fit';
declare const Terminal: typeof Xterm | undefined;
declare const FitAddon: { FitAddon: typeof XtermFitAddon } | typeof XtermFitAddon | undefined;
import type { HostTarget } from './api-client';
import type { SessionEntry } from './session-state';
import type { HighlightRuntime, MarkedRuntime, MermaidRuntime } from './rich-text-vendors';
declare const marked: MarkedRuntime | undefined, hljs: HighlightRuntime | undefined, mermaid: MermaidRuntime | undefined;

// =========================================================================
// Hosts (TASKS/multi-host.md phase 1) — every API touch resolves a host
// entry first, so a later phase can point this client at several pi-dish
// servers at once. With an empty catalog every request resolves to the self
// host (base '', no token) and the wire traffic is exactly what a
// single-host client always sent.
// =========================================================================
// Catalog values enter through the typed normalization/merge boundary.

const hostView = createHostView();
function appRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const HOSTS_KEY = 'pi-dish-hosts';
const KEYS_MIGRATED_KEY = 'pi-dish-keys-migrated';
// Directly-added hosts (phase 2 owns the editor UI); self is always implicit.
const hostDirectory: ReturnType<typeof createHostDirectory> = createHostDirectory({
  initialCatalog: readJSONPref(HOSTS_KEY, []),
  descriptor: id => hostDiscovery.descriptor(id),
  persistCatalog: catalog => localStorage.setItem(HOSTS_KEY, JSON.stringify(catalog)),
});

/**
 * The one fetch entry point for /api paths. Nothing else in this file may
 * call fetch() for the API: the host's base and bearer token are attached
 * here, so a request can't accidentally go to the serving origin when the
 * session lives elsewhere. Returns fetch's promise unchanged.
 */
const apiTransport: ReturnType<typeof createHostTransport> = createHostTransport({ resolveHost: (...args) => hostDirectory.resolveHost(...args), fetch: (...args) => fetch(...args) });
const sessionApi: ReturnType<typeof createSessionApi> = createSessionApi((...args) => apiTransport.request(...args));

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
  return hostDirectory.resolveHost(host).base + path;
}

/** ws(s) URL for a host path — scheme/authority come from the host's base. */
function hostWsUrl(host: HostTarget, path: string) {
  const base = hostDirectory.resolveHost(host).base;
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

const hostConnections: ReturnType<typeof createHostConnections> = createHostConnections({ onChange: () => renderHostsSection() });

function effectiveHosts() { return hostDirectory.effectiveHosts().map(hostView); }

function isMultiHost() { return effectiveHosts().length > 1; }
function selfHostEntry() { return effectiveHosts()[0]; }

/** Effective entry for a host id — null when nothing in the list claims it. */
function hostEntryFor(...args: Parameters<typeof hostDirectory.entryFor>) { const host = hostDirectory.entryFor(...args); return host ? hostView(host) : null; }

function hostLabelFor(hostId?: string | null) {
  const entry = hostEntryFor(hostId);
  return entry ? hostDisplayLabel(entry) : '';
}

function hostIdIsDown(hostId?: string | null) {
  const entry = hostEntryFor(hostId);
  return entry ? hostConnections.isDown(entry) : false;
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
const hostDiscovery: ReturnType<typeof createHostDiscovery> = createHostDiscovery({
  request: (...args) => apiTransport.request(...args),
  requestSelf: () => fetch('/api/host'),
  hosts: effectiveHosts,
  pollableHosts,
  sourceFor: hostDirectory.sourceFor,
  onSelf: data => {
    hostDirectory.setSelf(data);
    migrateClientKeys();
    if (newSessionController.isOpen()) newSessionController.renderHosts();
  },
  onFleet: data => {
    hostDirectory.setFleet(data);
    seedHostConnFromFleet();
  },
  onIdentified: (...args) => {
    if (hostDirectory.applyDescriptor(...args) && newSessionController.isOpen()) newSessionController.renderHosts();
  },
  onConnection: (host, event) => hostConnections.note(host, event),
  afterFleet: () => {
    pruneHostCaches();
    renderHostsSection();
    routinesController.updateButton();
    composerSpeech.updateButton();
    if (newSessionController.isOpen()) newSessionController.renderHosts();
    renderSessions();
  },
});

/** Resolve missing identities and refresh direct-host capabilities before fan-out. */
function identifyHosts(refresh = false) { return hostDiscovery.identify(refresh); }

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
const hostPresentation: ReturnType<typeof createHostPresentation> = createHostPresentation({
  directory: hostDirectory,
  initialColors: readJSONPref(HOST_COLORS_KEY, {}),
  initialOrder: readJSONPref(HOST_COLOR_ORDER_KEY, []),
  persistColors: colors => localStorage.setItem(HOST_COLORS_KEY, JSON.stringify(colors)),
  persistOrder: order => localStorage.setItem(HOST_COLOR_ORDER_KEY, JSON.stringify(order)),
  onColorChanged: rows => {
    if (rows) renderHostsSection();
    renderSessions();
  },
  escapeHtml, displayLabel: host => hostDisplayLabel(hostView(host)), isDown: (...args) => hostConnections.isDown(...args),
});

// All session list/selection writes and their rendering hooks share one store.
// Read its snapshots freely; mutate them only through its four state writers.
const sessionState: ReturnType<typeof createSessionState> = createSessionState({
  getSelfHostId: () => hostDirectory.self.hostId,
  getHostLabel: hostLabelFor,
  onListsChanged: renderSessions,
  onCurrentChanged: (...args) => sessionHeader.update(...args),
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
const responseDetailsController: ReturnType<typeof createResponseDetails> = createResponseDetails({ document, sessionState, mode: () => displayPreferences.responseMode });

// =========================================================================
// Scroll pinning — only follow streaming output while the user is at the
// bottom. Scrolling up "unpins"; new content then accumulates below without
// yanking the viewport, and a jump-to-bottom button appears.
// =========================================================================

const appChrome = createAppChrome({ document, storage: localStorage, older: container => transcriptController.maybeOlder(container) });
function autosizePromptInput(input: HTMLTextAreaElement) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; }

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const startupSelection = sessionState.selectionGeneration;
  // Who is serving us — and so which host stamps/keys the sessions below.
  // Awaited before the first list load so client keys never straddle the
  // bare/composite migration mid-render.
  try {
    await hostDiscovery.loadIdentity();
    await hostDiscovery.loadFleet(); // peers this server knows about (404 on old servers)
    await identifyHosts();  // and who the catalog's own entries actually are
  } finally {
    resolveHostFleetReady();
    routinesController.updateButton(); // capability-gated sidebar icon
    composerSpeech.updateButton();      // …and the capability-gated composer mic
  }
  loadConfig(); // feature flags (terminal) — fire-and-forget
  themesController.load(); // theme picker options + refresh custom-theme tokens
  sidebarQuery.updateView();
  sidebarQuery.renderChips(); // cached definitions paint immediately…
  sidebarQuery.loadFilters(); // …then the server copy replaces them
  composerSpeech.mount();
  terminalController.mountKeybar();
  panelResize.terminal();
  panelResize.sidebar();
  anchoredCommentController.mount();
  // The default Active view needs only live rows. Fetch history only when a
  // saved inactive session must be restored; opening All fetches it on demand.
  const saved = parseSessionKey(localStorage.getItem('pi-dish-session') || '');
  await sidebarLists.load();
  if (saved.sessionId && !sessionState.findSession(saved.sessionId, saved.hostId)) {
    await sidebarLists.load(undefined, { withPrevious: true });
  }
  if (saved.sessionId && startupSelection === sessionState.selectionGeneration) {
    const found = sessionState.findSession(saved.sessionId, saved.hostId);
    if (found) sessionView.select(saved.sessionId, { host: found.host || null });
  }
  
  const promptInput = (document.getElementById('promptInput') as HTMLTextAreaElement);

  promptInput.addEventListener('keydown', (e) => {
    if (composerAutocomplete.visible) {
      if (e.key === 'ArrowDown') { e.preventDefault(); composerAutocomplete.move(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); composerAutocomplete.move(-1); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        var items = document.querySelectorAll<HTMLElement>('.autocomplete-item');
        if (items.length > 0 && composerAutocomplete.index >= 0) {
          e.preventDefault();
          composerAutocomplete.accept(items[composerAutocomplete.index]);
          return;
        }
      }
      if (e.key === 'Escape') { e.preventDefault(); composerAutocomplete.hide(); return; }
    }
    // History recall: ArrowUp with the caret at the very start (or empty box)
    // steps back through sent prompts; ArrowDown at the end steps forward and
    // finally restores whatever was being typed.
    if (!composerAutocomplete.visible && e.key === 'ArrowUp' &&
        promptInput.selectionStart === 0 && promptInput.selectionEnd === 0) {
      if (composerDrafts.navigate(-1, promptInput)) { e.preventDefault(); return; }
    }
    if (!composerAutocomplete.visible && e.key === 'ArrowDown' && composerDrafts.historyIndex !== -1 &&
        promptInput.selectionStart === promptInput.value.length) {
      if (composerDrafts.navigate(1, promptInput)) { e.preventDefault(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.ctrlKey) { e.preventDefault(); composerSubmit.sendSteer(); }
      else { e.preventDefault(); composerSubmit.sendPrompt(); }
    }
    // While dictating, Escape cancels the recording (handled by the document
    // listener) — it must not also abort the turn.
    if (e.key === 'Escape' && !composerAutocomplete.visible && !composerSpeech.isRecording() && sessionActivity.turn) { e.preventDefault(); composerSubmit.abortTurn(); }
  });

  // Global Ctrl+C to abort
  document.addEventListener('keydown', function(e) {
    // Keys typed into the terminal belong to the shell (Ctrl+C = SIGINT,
    // Ctrl+F = forward), not to the app-level shortcuts.
    if (e.target instanceof Element && e.target.closest('.terminal-panel')) return;
    if (e.ctrlKey && e.key === 'c' && sessionActivity.turn) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { e.preventDefault(); composerSubmit.abortTurn(); }
    }
    // Ctrl+F opens in-session search when a session is showing
    if (e.ctrlKey && e.key === 'f' && sessionState.currentSession) {
      e.preventDefault();
      sessionSearch.open();
    }
  });

  promptInput.addEventListener('input', () => {
    autosizePromptInput(promptInput);
    composerAutocomplete.handle(promptInput.value);
    composerDrafts.exitHistory(); // typing exits history browsing
    composerDrafts.saveSoon();
  });

  // Pasted screenshots become attachments instead of getting dropped.
  promptInput.addEventListener('paste', (e) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.type && it.type.startsWith('image/'))
      .map((it) => it.getAsFile()).filter((file): file is File => file !== null);
    if (!files.length) return;
    e.preventDefault();
    composerDrafts.images.add(files);
  });

  (document.getElementById('imageFileInput') as HTMLInputElement).addEventListener('change', (e) => {
    const input = e.currentTarget as HTMLInputElement; composerDrafts.images.add(input.files || []);
    input.value = ''; // allow re-picking the same file
  });

  // Tap any transcript image to view it full-size.
  document.addEventListener('click', (e) => {
    const img = (e.target instanceof Element ? e.target.closest<HTMLImageElement>('img.msg-image') : null);
    if (img) composerDrafts.images.openLightbox(img.src);
  });

  // Tap a linkified file mention to open it in the viewer. preventDefault
  // keeps a link inside a <summary> (tool-call headers) from toggling the
  // enclosing <details>.
  document.addEventListener('click', (e) => {
    const link = (e.target instanceof Element ? e.target.closest<HTMLElement>('.file-link') : null);
    if (!link || !sessionState.currentSession) return;
    e.preventDefault();
    fileViews.openFile((link.textContent || '').trim());
  });

  // Per-message share link (the hover 🔗 in turn headers).
  document.addEventListener('click', (e) => {
    const btn = (e.target instanceof Element ? e.target.closest<HTMLElement>('.msg-link-btn') : null);
    if (btn) sessionInfo.copyMessage(btn);
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
      const session = sessionReferences.match(ref);
      if (!session) { setStatus(`No session here matches ${ref}`, 'error'); return; }
      sessionView.select(session.id, { host: session.host || null });
    });
  }

  // Restore focus mode (hide tool calls/results) preference
  appChrome.setFocus(localStorage.getItem('pi-dish-focus') === '1');

  // Coming back to the tab: refresh the list so unread dots resolve against
  // what's now actually on screen.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sidebarLists.refresh();
  });
});

// Reference syntax is relative to the server owning the composing session.
const sessionReferences: ReturnType<typeof createSessionReferences> = createSessionReferences({
  sessionState, selfId: () => hostDirectory.self.hostId, host: hostEntryFor, hostLabel: hostLabelFor, config: () => appConfig,
});
const composerAutocomplete: ReturnType<typeof createComposerAutocomplete> = createComposerAutocomplete({
  document, sessionState, composerKey: () => composerDrafts.key, provisional: () => !!sessionView.spawnId,
  request: (host, path, options) => apiTransport.request(host, path, options), host: hostEntryFor, references: sessionReferences,
  multiHost: isMultiHost, hostLabel: hostLabelFor, failed: error => console.error('Failed to load commands:', error),
});

// =========================================================================
// Sidebar
// =========================================================================

// Query, list fan-out and seen activity have separate typed owners.
const sidebarActivity: ReturnType<typeof createSidebarActivity> = createSidebarActivity({ document, storage: localStorage, sessionState });
const sidebarQuery: ReturnType<typeof createSidebarQuery> = createSidebarQuery({
  document, storage: localStorage, request: (host, path, options) => apiTransport.request(host, path, options), host: () => hostEntryFor(null)!,
  render: () => renderSessions(), reload: query => sidebarLists.load(query), queriedFor: () => sidebarLists.queriedFor,
  invalidateLists: () => sidebarLists.invalidate(), busy: value => sidebarLists.busy(value),
  searchChanged: () => { if (searchViewController.isOpen()) searchViewController.run(); }, openSearch: query => searchViewController.open(query),
  prompt: (label, initial) => window.prompt(label, initial), alert: message => alert(message),
});
sidebarQuery.mount();
const sidebarLists: ReturnType<typeof createSidebarLists> = createSidebarLists({
  document, request: (host, path, options) => apiTransport.request(host, path, options), sessionState, activity: sidebarActivity,
  hosts: effectiveHosts, pollable: pollableHosts, selfId: () => hostDirectory.self.hostId,
  query: () => sidebarQuery.query, all: () => sidebarQuery.tab === 'all', refreshFleet: (...args) => hostDiscovery.refreshSoon(...args),
  connection: (host, event) => hostConnections.note(host, event),
});
const hostSessionLoader = sidebarLists.loader;

function persistSavedFilters(next: Parameters<typeof sidebarQuery.persistFilters>[0], host?: HostEndpoint | null) { return sidebarQuery.persistFilters(next, host || undefined); }

// Sidebar row controls own preferences, family pins, confirmation, drag and menus.
const sidebarControls: ReturnType<typeof createSidebarControls> = createSidebarControls({
  document, storage: localStorage, sessionState, request: (host, path, options) => apiTransport.request(host, path, options),
  host: hostEntryFor, render: () => renderSessions(), closeSidebar: () => sidebarQuery.close(),
  select: (id, host) => sessionView.select(id, { host }), pending: id => sessionView.pending(id), create: (cwd, host) => newSessionController.create(cwd, host),
  finishClose: (id, host, owner) => sessionInfo.finishClose(id, host, owner), refresh: () => sidebarLists.load(undefined, { withPrevious: true }),
  ref: session => sessionRefFor(session), copy: text => copyTextToClipboard(text), status: (message, type) => setStatus(message, type),
});

function keyForSessionId(id: string) { return sessionKey(sessionState.sessionHostId(id), id); }

function sessionRefFor(session: Pick<SessionEntry, 'id' | 'host'> | null) { return session?.id ? sessionRef(session, hostEntryFor(session.host || null), sessionReferences.prefix(session)) : ''; }
function isSessionMenuOpen() { return sidebarControls.menuOpen; }

// Render one metadata snapshot through the typed sidebar projection.
let lastSessionListHtml = '';
function renderSessions() {
  if (sidebarControls.dragging) return;
  const sidebarFamilyRootMap = sidebarControls.familyRoots();
  const { html, count } = renderSidebar({
    ...sessionState.sessions, selected: sessionState.currentSession,
    tab: sidebarQuery.tab, view: sidebarQuery.view, query: sidebarQuery.query, queriedFor: sidebarLists.queriedFor, scope: sidebarQuery.scope(), indexing: sidebarLists.indexing,
    contextMetric: displayPreferences.contextMetric, pending: [...pendingSessionSpawns.entries()], selectedSpawn: sessionView.spawnId,
    expanded: sidebarControls.expanded, collapsed: sidebarControls.collapsed, pinned: sidebarControls.pinned, roots: sidebarFamilyRootMap,
    closeConfirm: sidebarControls.closeConfirm, closeBusy: sidebarControls.closeBusy, multiHost: isMultiHost(),
    unread: (...args) => sidebarActivity.unread(...args), hostChip: (...args) => hostPresentation.chipHtml(...args),
    hosts: effectiveHosts().map(host => {
      const cache = hostSessionLoader.getCache(host);
      return { ...host, state: hostConnections.stateOf(host), key: hostKeyOf(host), color: hostPresentation.colorFor(host.hostId || null),
        dot: hostPresentation.dotHtml(host.hostId || null, 'host-section-dot'), hasCache: !!cache && !!(cache.active.length || cache.previous.length) };
    }),
  });
  const countEl = (document.getElementById('countActive') as HTMLElement);
  if (countEl) countEl.textContent = count ? String(count) : '';
  if (html !== lastSessionListHtml) {
    sidebarControls.closeMenu();
    (document.getElementById('sessionList') as HTMLElement).innerHTML = html;
    lastSessionListHtml = html;
  }
  sidebarActivity.title();
}

// =========================================================================
// Session Selection
// =========================================================================

function pendingComposerKey(id: string) { return `spawn:${id}`; }
const sessionView: ReturnType<typeof createSessionView> = createSessionView({ document, sessionState, storage: localStorage, endpoint: (...args) => hostDirectory.resolveHost(...args),
  get drafts() { return composerDrafts; }, get activity() { return sessionActivity; }, get transcript() { return transcriptController; }, get stream() { return messageStreamController; }, get resume() { return sessionResume; },
  spawn: id => pendingSessionSpawns.get(id), resetSearch: () => sessionSearch.reset(), cancelStreaming: () => streamingRenderer.cancel(), stopFollowing: () => { appChrome.stopFollowing(); },
  closeViews: (_pending, keepBounce) => {
    sessionSearch.close(); fileViews.closeDiff(); fileViews.closeFile(); sessionInfo.closeStats(); transcriptTree.close(); sessionControls.closeModels(); sessionControls.closeThinking(); sessionInfo.closeArtifacts();
    usageController.close(); searchViewController.close(); newSessionController.close(); skillsController.close(); routinesController.close(); recoveryController.close(); if (!keepBounce) bounceController.close();
  },
  closeTerminal: () => terminalController.close(), clearExtension: () => extensionUI.clear(), clearRelations: () => sessionRelationsController.clear(), closeControls: () => appChrome.closePanel(), hideAutocomplete: () => composerAutocomplete.hide(),
  retireModels: () => modelCatalog.retire(), retireCommands: () => composerAutocomplete.retireCommands(), queue: data => promptDelivery.render(data), closeBtw: () => btwPanel.close(), resetArtifacts: () => sessionInfo.resetArtifacts(),
  thinking: () => sessionControls.updateThinking(), terminal: () => terminalController.updateButtons(), mic: () => composerSpeech.updateButton(), mood: (description, face) => moodController.set(description, face), status: (message, type) => setStatus(message, type),
  render: () => renderSessions(), cancelRecording: () => composerSpeech.cancel(), hideNote: () => composerNotes.hide(), math: () => richText.loadMath(), reveal: (id, host) => sidebarControls.reveal(id, host),
  seen: session => sidebarActivity.mark(session), artifacts: owner => sessionInfo.refreshArtifacts(owner), header: () => sessionHeader.update(), relations: owner => sessionRelationsController.load(owner), models: (id, harness) => appModels.load(id, harness), commands: id => composerAutocomplete.loadCommands(id),
});

const sessionResume: ReturnType<typeof createSessionResume> = createSessionResume({ document, sessionState, request: (...args) => apiTransport.request(...args), endpoint: (...args) => hostDirectory.resolveHost(...args),
  target: host => savedResumeTarget(host), refresh: () => sidebarLists.refresh(), select: (id, options) => sessionView.select(id, options), status: (message, type) => setStatus(message, type),
});

// =========================================================================
// Models
// =========================================================================

const modelCatalog: ReturnType<typeof createModelCatalog> = createModelCatalog({
  read: scope => sessionApi.models(scope.host, scope),
  persist: (scope, models) => localStorage.setItem(modelsCacheKey(scope.harnessId, scope.host.hostId), JSON.stringify(models)),
  changed: (...args) => responseDetailsController.refreshPricing(...args),
  failed: error => console.error('Failed to load models:', error),
});

function modelsCacheKey(harnessId: string, hostId: string | null) {
  return modelsCacheKeyBase(harnessId, hostId, hostDirectory.self.hostId);
}
const appModels = createAppModels({ sessions: sessionState, catalog: modelCatalog, host: hostEntryFor, takeover: () => newSessionController });

// =========================================================================
// Session Header
// =========================================================================

const sessionRelationsController: ReturnType<typeof createSessionRelations> = createSessionRelations({
  document, window, sessionState, request: (host, path, init) => apiTransport.request(host, path, init), endpoint: hostEntryFor,
  loadPrevious: () => sidebarLists.load(undefined, { withPrevious: true }),
  selectSession: (id, options) => sessionView.select(id, options), status: setStatus,
});

/**
 * Most model signal that fits the chip. The provider slug is the least
 * informative part, so it is dropped before the name is allowed to
 * ellipsize (CSS does the truncation). Full ref stays in the tooltip.
 */
const sessionHeader: ReturnType<typeof createSessionHeader> = createSessionHeader({ document, sessionState, multi: isMultiHost, host: hostEntryFor, down: hostIdIsDown, color: (...args) => hostPresentation.colorFor(...args), label: hostLabelFor,
  settings: session => harnessSupportsSettings(session), ensureHarness: id => ensureHarnessRows(id), thinking: () => sessionControls.updateThinking(), terminal: () => terminalController.updateButtons(), mic: () => composerSpeech.updateButton(),
});

// Header actions capture their selection before opening editors or dispatching.
const sessionControls: ReturnType<typeof createSessionControls> = createSessionControls({
  document, sessionState, catalog: modelCatalog, request: (host, path, options) => apiTransport.request(host, path, options), host: hostEntryFor,
  loadModels: (id, harness) => appModels.load(id, harness), status: (message, type) => setStatus(message, type),
});

// Whole-transcript search owns query requests, marks and serialized paging jumps.
const sessionSearch: ReturnType<typeof createSessionSearch> = createSessionSearch({
  document, sessionState, request: (host, path, init) => apiTransport.request(host, path, init), endpoint: hostEntryFor,
  focusMode: () => appChrome.focus, oldestIndex: () => transcriptController.oldestIndex, hasOlder: () => transcriptController.hasOlder,
  loadOlder: () => transcriptController.loadOlder(), stopFollowing: () => { appChrome.stopFollowing(); }, updateJumpButton: (...args) => appChrome.jump(...args),
});

function searchPrev() { return sessionSearch.move(-1); }
function searchNext() { return sessionSearch.move(1); }

// Display preferences own modal requests, rendered controls and device readouts.
const displayPreferences: ReturnType<typeof createDisplayPreferences> = createDisplayPreferences({
  document, storage: localStorage, request: (host, url, options) => apiTransport.request(host, url, options), host: () => hostEntryFor(null)!,
  beforeOpen: () => { sidebarQuery.close(); bounceController.close(); },
  unmountSections: () => { recoveryController.unmountPreferences(); hostSettings.unmount(); },
  mountSections: body => { hostSettings.mount(body); recoveryController.refreshHosts(); recoveryController.mountPreferences(); },
  themes: { render: select => themesController.render(select), apply: id => themesController.apply(id) },
  filters: () => sidebarQuery.filters, setFilters: value => sidebarQuery.setFilters(value),
  persistFilters: (value, host) => persistSavedFilters([...value], host),
  metadataChanged: () => responseDetailsController.update(), contextChanged: () => renderSessions(), alert: message => alert(message),
});

function closeSettingsModal() { bounceController.close(); displayPreferences.close(); }

// Recovery owns its preferences/report views and captured host endpoints.
const recoveryController: ReturnType<typeof createRecovery> = createRecovery({
  root: document.querySelector<HTMLElement>('.main')!, request: (...args) => apiTransport.request(...args), hosts: effectiveHosts,
  supports: host => hostSupportsCapability(host, 'recovery', appConfig), down: (...args) => hostConnections.isDown(...args),
  fleetReady: () => hostFleetReady, refreshFleet: (...args) => hostDiscovery.loadFleet(...args),
  selectedHost: () => sessionState.currentSession?.host || null,
  settingsOpen: () => (document.getElementById('settingsModal') as HTMLElement).style.display !== 'none',
  closeOtherViews: () => { closeSettingsModal(); sidebarQuery.close(); usageController.close(); searchViewController.close(); newSessionController.close(); skillsController.close(); routinesController.close(); bounceController.close(); fileViews.closeDiff(); fileViews.closeFile(); },
  confirm: message => confirm(message),
});

// --- Hosts (settings section, not a takeover: it is a short list plus one
// add form). The catalog is device-local by design — a browser's own list of
// machines it can reach, tokens included; fleet entries come from the
// server's config and are shown read-only. ---------------------------------

const hostSettings: ReturnType<typeof createHostSettings> = createHostSettings({
  directory: hostDirectory, connections: hostConnections, discovery: hostDiscovery,
  request: (...args) => apiTransport.request(...args), protocol: () => location.protocol,
  promptToken: label => prompt(`Token for ${label}`, ''),
  displayLabel: host => hostDisplayLabel({ base: host.base, label: host.label ? String(host.label) : '', name: host.name ? String(host.name) : '' }), escapeHtml,
  color: (...args) => hostPresentation.colorFor(...args), customColor: (...args) => hostPresentation.isCustom(...args), resolveColor: (...args) => resolveColorToHex(...args),
  setColor: (...args) => hostPresentation.setColor(...args),
  onCatalogSaved: () => {
    if (newSessionController.isOpen()) newSessionController.renderHosts();
    pruneHostCaches();
    renderHostsSection();
    renderSessions();
  },
  refreshSessions: (...args) => sidebarLists.refresh(...args), renderNewSessionHosts: (...args) => newSessionController.renderHosts(...args),
});

function renderHostsSection() {
  recoveryController.refreshHosts();
  hostSettings.render();
}

// Advanced search owns fleet query results, facet controls and click-through.
const searchViewController: ReturnType<typeof createSearchView> = createSearchView({
  root: document.querySelector<HTMLElement>('.main')!, request: (...args) => apiTransport.request(...args), sessionState,
  hosts: effectiveHosts, fanout: fanoutHosts, host: hostEntryFor, scope: (...args) => sidebarQuery.scope(...args),
  connection: (host, event, error) => {
    if (event === 'success') noteHostReachable(host);
    else if (event === 'blocked') noteHostBlocked(host);
    else noteHostFailure(host, error);
  },
  hostChip: (...args) => hostPresentation.chipHtml(...args),
  closeOtherViews: () => { sidebarQuery.close(); usageController.close(); newSessionController.close(); skillsController.close(); routinesController.close(); recoveryController.close(); bounceController.close(); },
  loadPrevious: () => sidebarLists.load(undefined, { withPrevious: true }),
  selectSession: (id, options) => sessionView.select(id, options), sessionSearch,
});

// The skills directory and coverage view retain their entry-host ownership.
const skillsController: ReturnType<typeof createSkills> = createSkills({
  root: document.querySelector<HTMLElement>('.main')!, request: (...args) => apiTransport.request(...args), self: selfHostEntry, origin: () => location.origin,
  sessionState, loadPrevious: () => sidebarLists.load(undefined, { withPrevious: true }),
  selectSession: (id, options) => sessionView.select(id, options),
  closeOtherViews: () => { sidebarQuery.close(); usageController.close(); searchViewController.close(); newSessionController.close(); routinesController.close(); recoveryController.close(); bounceController.close(); },
  refine: ({ cwd, draft, host }) => { newSessionController.setHostId(host); newSessionController.open({ cwd, draft }); },
  copy: copyTextToClipboard, status: setStatus,
});

// Usage owns range/filter state, progressive fleet results and chart controls.
const usageController: ReturnType<typeof createUsageView> = createUsageView({
  root: document.querySelector<HTMLElement>('.main')!, request: (...args) => apiTransport.request(...args), storage: localStorage,
  fleetReady: () => hostFleetReady, hosts: fanoutHosts, host: hostEntryFor, multiHost: isMultiHost,
  closeOtherViews: () => { sidebarQuery.close(); searchViewController.close(); newSessionController.close(); skillsController.close(); routinesController.close(); recoveryController.close(); bounceController.close(); },
  connection: (host, event, error) => {
    if (event === 'success') noteHostReachable(host);
    else if (event === 'blocked') noteHostBlocked(host);
    else noteHostFailure(host, error);
  },
  selectSession: (id, options) => sessionView.select(id, options),
});

// Session information owns stats/process/share controls and artifact discovery.
const sessionInfo: ReturnType<typeof createSessionInfo> = createSessionInfo({
  document, request: (host, path, options) => apiTransport.request(host, path, options), sessionState, host: hostEntryFor,
  reference: session => sessionRefFor(session), copy: text => copyTextToClipboard(text), status: (text, type) => setStatus(text, type), confirm: text => confirm(text),
  loadPrevious: () => sidebarLists.load(undefined, { withPrevious: true }), refreshSessions: () => sidebarLists.refresh(), selectSession: (id, options) => sessionView.select(id, options),
});

// File and diff takeovers share a typed owner and keep comment coordination explicit.
const fileViews: ReturnType<typeof createFileViews> = createFileViews({
  document, sessionState, request: (host, path, options) => apiTransport.request(host, path, options), host: hostEntryFor,
  markdown: text => richText.format(text), highlight: root => richText.highlight(root), copy: text => copyTextToClipboard(text),
  status: (message, type) => setStatus(message, type), refreshArtifacts: owner => sessionInfo.refreshArtifacts(owner),
  closeComments: () => anchoredCommentController.close(), clearComments: () => anchoredCommentController.set([]),
  refreshComments: () => anchoredCommentController.refresh(), markComments: () => anchoredCommentController.applyMarks(),
});

// Anchored comments retain their view, request and editor lifetimes.
const anchoredCommentController: ReturnType<typeof createAnchoredComments> = createAnchoredComments({
  document, sessionState, views: fileViews, request: (host, path, options) => apiTransport.request(host, path, options), host: hostEntryFor,
  status: (message, type) => setStatus(message, type), loadPatch: details => fileViews.loadPatch(details),
});

// =========================================================================
// Messages
// =========================================================================

const transcriptController: ReturnType<typeof createTranscript> = createTranscript({
  document, sessionState, request: (host, path, options) => apiTransport.request(host, path, options), host: hostEntryFor,
  renderMessage: message => messageRenderer.message(message), finalize: (root, options) => finalizeRender(root, options),
  closeSearch: () => sessionSearch.close(), cancelStreaming: () => streamingRenderer.cancel(), mood: (description, face) => moodController.set(description, face),
  updateMood: messages => moodController.fromMessages(messages), pinned: (...args) => appChrome.pinned(...args), scroll: (...args) => appChrome.scroll(...args), jump: (...args) => appChrome.jump(...args),
  consumeEcho: (id, content) => consumePendingSelfEcho(id, content),
});

// Typed message projection and telemetry retain only their own render data.
const messageRenderer: ReturnType<typeof createMessageRenderer> = createMessageRenderer({
  document, sessionState, details: responseDetailsController, markdown: text => richText.format(text),
  assetUrl: hostAssetUrl, matchRef: ref => sessionReferences.match(ref), pinned: (...args) => appChrome.pinned(...args),
  follow: () => appChrome.following, scroll: (...args) => appChrome.scroll(...args), jump: (...args) => appChrome.jump(...args),
});

// =========================================================================
// Live Tool Panels (streaming tool execution)
// =========================================================================

const liveToolsController: ReturnType<typeof createLiveTools> = createLiveTools({
  document, sessionState, started: (id, name) => sessionActivity.toolStarted(id, name),
  finished: id => sessionActivity.toolFinished(id), pinned: (...args) => appChrome.pinned(...args), scroll: (...args) => appChrome.scroll(...args), jump: (...args) => appChrome.jump(...args),
  images: (content, alt) => messageRenderer.images(content, alt), mood: (name, args) => moodController.fromTool(name, args),
});

// =========================================================================
// SSE Streaming (RPC events only)
// =========================================================================

const messageStreamController: ReturnType<typeof createMessageStream> = createMessageStream({ document, sessionState, endpoint: (...args) => hostDirectory.resolveHost(...args), ticket: host => mintHostTicket(host, 'stream'),
  get activity() { return sessionActivity; }, renderer: messageRenderer, get streaming() { return streamingRenderer; }, tools: liveToolsController, get delivery() { return promptDelivery; }, get extensionUI() { return extensionUI; },
  status: (message, type) => setStatus(message, type), catchup: owner => transcriptController.catchup(owner), refresh: () => sidebarLists.refresh(), artifacts: owner => sessionInfo.refreshArtifacts(owner),
  pinned: (...args) => appChrome.pinned(...args), follow: () => appChrome.following, scroll: (...args) => appChrome.scroll(...args), jump: (...args) => appChrome.jump(...args), highlight: root => richText.highlight(root),
  select: (id, options) => sessionView.select(id, options), deleteCached: key => transcriptController.deleteCached(key), loadSessions: (query, options) => sidebarLists.load(query, options),
});

// =========================================================================
// Prompt / Turn / Abort
// =========================================================================

// Drafts and attachments share a host-qualified composer owner.
const composerDrafts: ReturnType<typeof createComposerDrafts> = createComposerDrafts({
  document, storage: localStorage, keyForSession: keyForSessionId, currentSessionId: () => sessionState.currentSession?.id || null,
  autosize: input => autosizePromptInput(input), status: (message, type) => setStatus(message, type),
});

// Dictation retains the composer that requested permission and transcription.
const composerNotes: ReturnType<typeof createComposerNotes> = createComposerNotes(document);
const composerSpeech: ReturnType<typeof createComposerSpeech> = createComposerSpeech({
  document, sessionState, composerKey: () => composerDrafts.key, hosts: effectiveHosts, config: () => appConfig,
  request: (host, path, options) => apiTransport.request(host, path, options), status: message => setStatus(message),
  showNote: text => composerNotes.show(text), hideNote: () => composerNotes.hide(),
});

const promptDelivery: ReturnType<typeof createPromptDelivery> = createPromptDelivery({ document, sessionState, request: (...args) => apiTransport.request(...args), endpoint: (...args) => hostDirectory.resolveHost(...args),
  restore: (key, text) => composerDrafts.restorePayload(key, text, null), status: (message, type) => setStatus(message, type),
});

function consumePendingSelfEcho(id: string, content: unknown) { return promptDelivery.consume(keyForSessionId(id), content); }

const sessionActivity: ReturnType<typeof createSessionActivity> = createSessionActivity({ document, sessionState, clearQueue: () => promptDelivery.render(null), status: message => setStatus(message) });

// ---------------------------------------------------------------------------
// /btw panel — ephemeral side question (OMP). The answer never lands in the
// transcript; it lives in this dismissible card above the composer, mirroring
// the TUI's btw panel. A new question replaces the panel; a session switch
// drops it (see the two selection reset points).
// ---------------------------------------------------------------------------
const btwPanel: ReturnType<typeof createBtwPanel> = createBtwPanel({ document, sessionState, markdown: text => richText.format(text), copy: text => copyTextToClipboard(text) });

const composerSubmit: ReturnType<typeof createComposerSubmit> = createComposerSubmit({ document, sessionState, drafts: composerDrafts, delivery: promptDelivery, activity: sessionActivity, btw: btwPanel,
  request: (...args) => apiTransport.request(...args), endpoint: (...args) => hostDirectory.resolveHost(...args), spawnId: () => sessionView.spawnId, spawnPending: () => !!sessionView.spawnId && pendingSessionSpawns.has(sessionView.spawnId),
  refs: message => sessionReferences.hints(message), status: (message, type) => setStatus(message, type), openTree: () => transcriptTree.open(), hideAutocomplete: () => composerAutocomplete.hide(),
  refresh: () => sidebarLists.refresh(), follow: () => { appChrome.follow(); }, scroll: (...args) => appChrome.scroll(...args), renderUser: (message, time, attrs) => messageRenderer.user(message, time, attrs),
});

const pendingSessionSpawns: ReturnType<typeof createSessionSpawns> = createSessionSpawns({
  request: (...args) => apiTransport.request(...args), delay: () => new Promise(resolve => setTimeout(resolve, 250)), harnessLabel: (...args) => newSessionController.harnessLabel(...args),
  current: () => sessionView.spawnId, changed: renderSessions,
  showPending: key => { sidebarQuery.switchTab('active'); sessionView.pending(key); if (window.innerWidth <= 768) sidebarQuery.close(); },
  loadSessions: (...args) => sidebarLists.load(...args), hasSession: (id, host) => !!sessionState.findSession(id, host),
  selectSession: (id, host) => { void sessionView.select(id, { host }); },
  stashPrompt: (...args) => composerDrafts.stash(...args),
  saveDraft: (key, draft) => { try { localStorage.setItem(composerDrafts.draftKey(pendingComposerKey(key)), draft); } catch {} },
  migratePrompt: (key, host, id) => composerDrafts.migrate(pendingComposerKey(key), sessionKey(host || hostDirectory.self.hostId, id)),
  discardPrompt: key => { const owner = pendingComposerKey(key); composerDrafts.clearDraft(owner); composerDrafts.images.discard(owner); },
  showFailure: (...args) => sessionView.failure(...args), status: setStatus,
});
// The typed takeover owns form state, controls, caches and launch view tokens.
const newSessionController: ReturnType<typeof createNewSession> = createNewSession({
  root: document.querySelector<HTMLElement>('.main')!, storage: localStorage, request: (...args) => apiTransport.request(...args),
  self: selfHostEntry, host: hostEntryFor, hosts: effectiveHosts, hostDown: (...args) => hostConnections.isDown(...args), multiHost: isMultiHost,
  sessionState, currentSpawn: () => sessionView.spawnId, spawns: pendingSessionSpawns, models: modelCatalog,
  closeOtherViews: () => { sidebarQuery.close(); usageController.close(); searchViewController.close(); skillsController.close(); routinesController.close(); recoveryController.close(); bounceController.close(); },
  closeSettings: () => harnessSettingsController.close(),
  harnessCacheChanged: () => { if (sessionState.currentSession) sessionHeader.update(); }, status: setStatus,
});

const harnessDiscovery = newSessionController.harnesses;
const newSessionConfigPreview = newSessionController.config;
const spawnTargetsController = newSessionController.targets;

function savedResumeTarget(host: string | null) { return spawnTargetsController.resume(hostEntryFor(host)); }

function loadNsHarnessConfig(cwd = newSessionController.cwd()) { return newSessionConfigPreview.load(cwd); }

function ensureHarnessRows(hostId: string | null) { void harnessDiscovery.ensure(hostId); }
function harnessSupportsSettings(session: SessionEntry | null) {
  return !!session?.harnessId && !!harnessDiscovery.row(sessionReferences.hostId(session), session.harnessId)?.pilotConfig;
}

// One typed editor serves session settings and the new-session takeover.
const harnessSettingsController: ReturnType<typeof createHarnessSettings> = createHarnessSettings({
  root: (document.getElementById('harnessSettingsModal') as HTMLElement), host: hostEntryFor, request: (...args) => apiTransport.request(...args),
  fallbackModels: (host, harness) => modelCatalog.scope?.harnessId === harness
    && sameDirectoryHost(modelCatalog.scope?.host || null, host) ? modelCatalog.rows() : [],
  escapeHtml, shortCwd, roleDefinitions: OMP_MODEL_ROLES, parseModelRoleRef, composeModelRoleRef, modelRoleLevels,
  onSaved: scope => {
    if (newSessionController.isOpen() && newSessionController.selectedHarness() === scope.harnessId
        && newSessionController.hostId() === scope.hostId && newSessionController.cwd() === scope.cwd) void loadNsHarnessConfig();
  },
});

function openSessionHarnessSettings() {
  const session = sessionState.currentSession;
  if (!session || !harnessSupportsSettings(session)) return;
  return openHarnessSettings({ harnessId: session.harnessId || 'pi', hostId: sessionReferences.hostId(session), cwd: session.cwd ?? '',
    label: session.harnessLabel || harnessBadgeInfo(session.harnessId ?? null).label });
}
function openHarnessSettings(opts: Partial<Parameters<typeof harnessSettingsController.open>[0]> = {}) {
  const harnessId = opts.harnessId || 'omp';
  return harnessSettingsController.open({ harnessId,
    hostId: opts.hostId !== undefined ? opts.hostId : newSessionController.hostId(),
    cwd: (opts.cwd !== undefined ? opts.cwd : (newSessionConfigPreview.config?.cwd ?? newSessionController.cwd())) || '',
    label: opts.label || newSessionController.harnessLabel(harnessId), tab: opts.tab,
  });
}

function createCwdAutocomplete({
  input, dropdown, hostId = (...args) => newSessionController.hostId(...args), known = () => [],
  onPick = () => {}, onSubmit = null, onBlur = null,
}: Pick<CwdAutocompleteOptions, 'input' | 'dropdown' | 'known' | 'onPick' | 'onSubmit' | 'onBlur'> & { hostId?: () => string | null }) {
  return createCwdAutocompleteBase({ input, dropdown,
    host: () => hostEntryFor(hostId()), request: (...args) => apiTransport.request(...args), known,
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
  return sendJson((...args) => apiTransport.request(...args), host, path, body, method);
}

function readJSONPref(key: string, fallback: unknown): unknown {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
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
  if (stripLive) liveToolsController.clear(container);
  groupToolActivity(container);
  richText.highlight(container);
}

// =========================================================================
// Streaming assistant renderer — incremental, block-level, throttled.
//
// Every message_update carries the full message so far, so we keep one
// streaming DOM element and update only the content blocks that changed
// (the growing tail block in practice). No outerHTML swaps: <details>
// open/closed state survives naturally and layout work stays minimal.
// =========================================================================

const streamingRenderer: ReturnType<typeof createStreamingRenderer> = createStreamingRenderer({
  document, sessionState, markdown: text => richText.format(text), pinned: (...args) => appChrome.pinned(...args), scroll: (...args) => appChrome.scroll(...args), jump: (...args) => appChrome.jump(...args),
});

function setStatus(message: string, type = '') {
  const status = (document.getElementById('status') as HTMLElement);
  status.textContent = message;
  status.className = `status ${type}`;
}

// =========================================================================
// Mood indicator — web fallback for the mood extension's custom editor
// =========================================================================

const moodController: ReturnType<typeof createMood> = createMood(document);

// =========================================================================
// Extension UI — unobtrusive hidable cards
// =========================================================================

const extensionUI: ReturnType<typeof createExtensionUI> = createExtensionUI({
  document, sessionState, storage: localStorage, request: (host, path, options) => apiTransport.request(host, path, options), host: hostEntryFor,
  status: (message, type) => setStatus(message, type),
});

// Rich text keeps the local vendor loaders, final render passes and diagram
// lifetimes separate from the transcript's streaming and retained DOM state.
const browserAssets: ReturnType<typeof createBrowserAssets> = createBrowserAssets(document);
const diagramRenderer: ReturnType<typeof createDiagrams> = createDiagrams({
  document, assets: browserAssets, runtime: () => typeof mermaid === 'undefined' ? null : mermaid,
  retainedRoots: () => transcriptController.retainedRoots(), isPinned: feed => appChrome.pinned(feed), scrollBottom: feed => appChrome.scroll(feed),
});
const richText: ReturnType<typeof createRichText> = createRichText({
  document, marked: typeof marked === 'undefined' ? null : marked, highlight: () => typeof hljs === 'undefined' ? null : hljs,
  assets: browserAssets, diagrams: diagramRenderer, sessionState, copy: text => copyTextToClipboard(text), status: (message, type) => setStatus(message, type),
});

function copyTextToClipboard(text: string) { return copyTextToClipboardBase(text, document, navigator); }

// =========================================================================
// Tree Modal
// =========================================================================
const transcriptTree: ReturnType<typeof createTranscriptTree> = createTranscriptTree({
  document, storage: localStorage, sessionState, request: (host, path, options) => apiTransport.request(host, path, options), host: hostEntryFor,
  status: (message, type) => setStatus(message, type), selectSession: (id, options) => sessionView.select(id, options),
  saveEditorDraft: (owner, text) => {
    try { const key = composerDrafts.draftKey(sessionRefKey(owner)); if (!(localStorage.getItem(key) || '').trim()) localStorage.setItem(key, text); } catch {}
  },
});

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  // A live microphone capture outranks every overlay: Escape gets the hardware
  // released (and the take discarded) before it dismisses any chrome.
  if (composerSpeech.isRecording()) { e.preventDefault(); composerSpeech.cancel(); composerSpeech.updateButton(); return; }
  // A lightbox (image or diagram zoom) floats above every modal — it goes
  // first, and it alone, so Escape never dismisses it *and* what's underneath.
  const lightbox = document.querySelector('.lightbox-overlay');
  if (lightbox) {
    e.preventDefault(); lightbox.remove();
  } else if (isSessionMenuOpen()) {
    e.preventDefault(); sidebarControls.closeMenu();
  } else if (anchoredCommentController.isListOpen()) {
    e.preventDefault(); anchoredCommentController.closeList();
  } else if ((document.getElementById('commentBubble') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); anchoredCommentController.close();
  } else if ((document.getElementById('responseDetailsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); responseDetailsController.close();
  } else if (harnessSettingsController.isOpen()) {
    // Modal only — the new-session takeover underneath stays open.
    e.preventDefault(); harnessSettingsController.close();
  } else if ((document.getElementById('settingsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); closeSettingsModal();
  } else if ((document.getElementById('relationsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); sessionRelationsController.closeModal();
  } else if ((document.getElementById('treeModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); transcriptTree.close();
  } else if ((document.getElementById('statsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); sessionInfo.closeStats();
  } else if ((document.getElementById('artifactsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); sessionInfo.closeArtifacts();
  } else if (recoveryController.isOpen()) {
    e.preventDefault(); recoveryController.close();
  } else if (routinesController.isOpen()) {
    e.preventDefault(); routinesController.escape();
  } else if (skillsController.isOpen()) {
    e.preventDefault(); skillsController.escape();
  } else if (newSessionController.isOpen()) {
    e.preventDefault(); newSessionController.close();
  } else if (searchViewController.isOpen()) {
    e.preventDefault(); searchViewController.close();
  } else if (usageController.isOpen()) {
    e.preventDefault(); usageController.close();
  } else if (fileViews.isFileOpen()) {
    e.preventDefault(); fileViews.closeFile();
  } else if (fileViews.isDiffOpen()) {
    e.preventDefault(); fileViews.closeDiff();
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
    const res = await apiTransport.request(null, '/api/config');
    const data: unknown = await res.json(); if (res.ok && appRecord(data)) appConfig = data;
  } catch { /* feature stays hidden */ }
  terminalController.updateButtons();
  routinesController.updateButton();
  composerSpeech.updateButton();
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

// =========================================================================
// Theme payloads and pre-paint cache restoration share typed token decoding.
const themesController: ReturnType<typeof createThemes> = createThemes({ document, storage: localStorage, request: (host, url, options) => apiTransport.request(host, url, options), host: () => hostEntryFor(null)!,
  changed: () => { terminalController.refreshTheme(); diagramRenderer.refreshTheme(); },
});

function terminalTheme() { return terminalThemeBase(document); }

// Terminal lifecycle owns pending opens, host endpoints, sockets and reconnects.
const terminalController: ReturnType<typeof createTerminalController> = createTerminalController({
  document, storage: localStorage, sessionState, host: host => hostEntryFor(host),
  supportsTerminal: session => sessionHostSupportsTerminal(session), supportsTmux: session => sessionHostSupportsTmux(session),
  asset: (tag, attributes) => browserAssets.load(tag, attributes),
  createTerminal: options => typeof Terminal === 'undefined' ? null : new Terminal(options),
  createFitAddon: () => { const runtime = typeof FitAddon === 'undefined' ? null : FitAddon; const Ctor = typeof runtime === 'function' ? runtime : runtime?.FitAddon; return Ctor ? new Ctor() : null; },
  socket: url => new WebSocket(url), socketUrl: (host, path) => hostWsUrl(host, path), ticket: (host, purpose) => mintHostTicket(host, purpose),
  theme: () => terminalTheme(), applySize: panel => panelResize.terminalSize(panel), confirm: message => confirm(message),
});

// Resize controllers own each pointer capture and release listeners on disposal.
const panelResize: ReturnType<typeof createPanelResize> = createPanelResize({ document, storage: localStorage, fitTerminal: () => terminalController.fit() });

// =========================================================================
// Routines own their host-qualified form, catalogs, mutations and run ledger.
const routinesController: ReturnType<typeof createRoutinesView> = createRoutinesView({
  root: document.querySelector<HTMLElement>('.main')!, request: (host, url, options) => apiTransport.request(host, url, options), storage: localStorage, sessionState,
  hosts: fanoutHosts, effectiveHosts, host: hostEntryFor, fleetReady: () => hostFleetReady, config: () => appConfig, multiHost: isMultiHost,
  hostChip: host => hostPresentation.chipHtml(host),
  closeOtherViews: () => { sidebarQuery.close(); usageController.close(); searchViewController.close(); newSessionController.close(); skillsController.close(); recoveryController.close(); bounceController.close(); },
  connection: (host, event, error) => { if (event === 'success') noteHostReachable(host); else if (event === 'blocked') noteHostBlocked(host); else noteHostFailure(host, error); },
  autocomplete: options => createCwdAutocomplete(options), copy: text => copyTextToClipboard(text), status: text => setStatus(text), confirm: text => confirm(text),
  loadPrevious: () => sidebarLists.load(undefined, { withPrevious: true }), selectSession: (id, options) => sessionView.select(id, options),
});

// Bounce owns host snapshots, selected targets, status polling and view disposal.
const bounceController: ReturnType<typeof createBounce> = createBounce({
  document, request: (...args) => apiTransport.request(...args), hosts: effectiveHosts, fleetReady: () => hostFleetReady,
  sessionState, refreshSessions: (...args) => sidebarLists.refresh(...args), loadPrevious: () => sidebarLists.load(undefined, { withPrevious: true }), selectSession: (...args) => sessionView.select(...args),
});

createAppBindings({ document, actions: {
  openUsageView: () => usageController.open(),
  openSkillsView: () => skillsController.open(),
  openRoutinesView: () => routinesController.open(),
  openSettingsModal: () => displayPreferences.open(),
  refreshSessions: () => sidebarLists.refresh(),
  openNewSessionView: () => newSessionController.open(),
  openSessionHarnessSettings: () => openSessionHarnessSettings(),
  openStatsModal: () => sessionInfo.openStats(),
  toggleSearchBar: () => sessionSearch.toggle(),
  toggleControlPanel: () => appChrome.togglePanel(),
  toggleTerminal: () => terminalController.toggle(),
  toggleFocusMode: () => appChrome.toggleFocus(),
  toggleDiffView: () => fileViews.toggleDiff(),
  openArtifactsModal: () => sessionInfo.openArtifacts(),
  exportSession: () => sessionControls.export(),
  searchKey: event => { if (event instanceof KeyboardEvent) sessionSearch.key(event); },
  searchPrev: () => searchPrev(),
  searchNext: () => searchNext(),
  closeSearch: () => sessionSearch.close(),
  loadDiffView: () => fileViews.loadDiff(),
  closeDiffView: () => fileViews.closeDiff(),
  closeFileView: () => fileViews.closeFile(),
  switchTerminalMode: () => terminalController.switchMode(),
  restartTerminalShell: () => terminalController.restart(),
  closeTerminal: () => terminalController.close(),
  resumeSession: () => sessionResume.resume(),
  panelOpenSearch: () => { appChrome.closePanel(); sessionSearch.open(); },
  panelToggleTerminal: () => { appChrome.closePanel(); terminalController.toggle(); },
  panelOpenDiffView: () => { appChrome.closePanel(); fileViews.openDiff(); },
  panelOpenArtifactsModal: () => { appChrome.closePanel(); sessionInfo.openArtifacts(); },
  panelOpenTreeModal: () => { appChrome.closePanel(); transcriptTree.open(); },
  panelOpenSessionHarnessSettings: () => { appChrome.closePanel(); openSessionHarnessSettings(); },
  panelExportSession: () => { appChrome.closePanel(); sessionControls.export(); },
  attachImage: () => (document.getElementById('imageFileInput') as HTMLInputElement).click(),
  abortTurn: () => composerSubmit.abortTurn(),
  sendSteer: () => composerSubmit.sendSteer(),
  sendFollowUp: () => composerSubmit.sendFollowUp(),
  sendPrompt: () => composerSubmit.sendPrompt(),
  loadUsageView: () => usageController.load(),
  closeUsageView: () => usageController.close(),
  closeSearchView: () => searchViewController.close(),
  closeNewSessionView: () => newSessionController.close(),
  onNsHostChange: (_event, node) => { if (node instanceof HTMLSelectElement) newSessionController.changeHost(node.value); },
  onNsHarnessChange: (_event, node) => { if (node instanceof HTMLSelectElement) newSessionController.changeHarness(node.value); },
  onNsModelChange: (_event, node) => { if (node instanceof HTMLSelectElement) newSessionController.preferences.selectModel(node.value); },
  onNsThinkingChange: (_event, node) => { if (node instanceof HTMLSelectElement) newSessionController.preferences.selectThinking(node.value); },
  editHarnessAgents: () => openHarnessSettings({ tab: 'agents' }),
  editHarnessModels: () => openHarnessSettings({ tab: 'models' }),
  spawnNewSession: () => newSessionController.spawn(),
  refreshRoutinesView: () => routinesController.refresh(),
  closeRoutinesView: () => routinesController.close(),
  loadRecoveryView: () => recoveryController.load(),
  closeRecoveryView: () => recoveryController.close(),
  backdropCloseTreeModal: (event, node) => { if (event.target === node) transcriptTree.close(); },
  closeTreeModal: () => transcriptTree.close(),
  backdropCloseArtifactsModal: (event, node) => { if (event.target === node) sessionInfo.closeArtifacts(); },
  closeArtifactsModal: () => sessionInfo.closeArtifacts(),
  backdropCloseRelationsModal: (event, node) => { if (event.target === node) sessionRelationsController.closeModal(); },
  closeRelationsModal: () => sessionRelationsController.closeModal(),
  backdropCloseStatsModal: (event, node) => { if (event.target === node) sessionInfo.closeStats(); },
  closeStatsModal: () => sessionInfo.closeStats(),
  backdropCloseSettingsModal: (event, node) => { if (event.target === node) closeSettingsModal(); },
  closeSettingsModal: () => closeSettingsModal(),
  bounceToggle: (_event, node) => { if (node instanceof HTMLDetailsElement) { if (node.open) bounceController.refresh(); else bounceController.close(); } },
  refreshBounceView: () => bounceController.refresh(),
  bounceSelect: () => bounceController.select(true),
  bounceClear: () => bounceController.select(false),
  submitBounceTargets: () => bounceController.submit(),
  backdropCloseHarnessSettings: (event, node) => { if (event.target === node) harnessSettingsController.close(); },
  closeHarnessSettings: () => harnessSettingsController.close(),
  harnessTabAgents: () => harnessSettingsController.showTab('agents'),
  harnessTabModels: () => harnessSettingsController.showTab('models'),
  saveHarnessSettings: () => harnessSettingsController.save(),
  backdropCloseResponseDetails: (event, node) => { if (event.target === node) responseDetailsController.close(); },
  closeResponseDetails: () => responseDetailsController.close(),
} });
