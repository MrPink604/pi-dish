import { createAppModels } from './app-models';
import { OMP_MODEL_ROLES, composeModelRoleRef, modelRoleLevels, parseModelRoleRef } from '../core/helper-models';
import { escapeHtml } from '../core/helper-format';
import { record } from '../core/helper-values';
import { fuzzyMatch, fuzzyScore, highlightFuzzy } from '../core/helper-query';
import { sessionRef } from '../core/helper-refs';
import { harnessBadgeInfo, hostDisplayLabel, hostSupportsCapability, hostSupportsTerminal, parseSessionKey, sessionKey, sessionRefKey } from './helper-identity';
import { shortCwd } from './helper-format';
import { createHostView } from './host-view';
import { createHostDirectory } from './host-directory';
import { createHostTransport, createSessionApi, sendJson, type ApiRequest, type HostTarget } from './api-client';
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
import { renderSidebar, type SidebarProjectionMemo } from './sidebar-render';
import { createSessionView } from './session-view';
import { createMainPane } from './main-pane';
import { createSessionResume } from './session-resume';
import { createModelCatalog, modelsCacheKey } from './model-catalog';
import { sameDirectoryHost } from './directory-catalog';
import { createSessionRelations } from './session-relations';
import { createSubagentsView } from './subagents-view';
import { createSessionHeader } from './session-header';
import { createSessionControls } from './session-controls';
import { createSessionSearch } from './session-search';
import { createDisplayPreferences } from './display-preferences';
import { createPushNotifications, type PushNotifications } from './push-notifications';
import { createRecovery } from './recovery';
import { createHostSettings, hostSettingsHtml } from './host-settings';
import { createFleetView } from './fleet-view';
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
import { createPromptHistory, type PromptHistoryController } from './prompt-history';
import { createComposerNotes } from './composer-notes';
import { createComposerSpeech } from './composer-speech';
import { createPromptDelivery } from './prompt-delivery';
import { createSessionActivity } from './session-activity';
import { createSideChat, type SideChatController } from './side-chat';
import { createComposerSubmit } from './composer-submit';
import { createSessionSpawns, pendingComposerKey } from './session-spawns';
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
import { copyTextToClipboard } from './clipboard';
import { createTranscriptTree } from './transcript-tree';
import { createThemes, terminalTheme as terminalThemeBase } from './themes';
import { createTerminalController } from './terminal';
import { createPanelResize } from './panel-resize';
import { createRoutinesView } from './routines-view';
import { createVaultApprovals, type VaultApprovalsController } from './vault-approvals';
import { createBounce } from './bounce';
import { createAppBindings } from './app-bindings';
import type { CwdAutocompleteOptions } from './cwd-autocomplete';
import type { Terminal as Xterm } from '@xterm/xterm';
import type { FitAddon as XtermFitAddon } from '@xterm/addon-fit';
declare const Terminal: typeof Xterm | undefined;
declare const FitAddon: { FitAddon: typeof XtermFitAddon } | typeof XtermFitAddon | undefined;
import type { SessionEntry } from './session-state';
import type { HighlightRuntime, MarkedRuntime, MermaidRuntime } from './rich-text-vendors';
declare const marked: MarkedRuntime | undefined, hljs: HighlightRuntime | undefined, mermaid: MermaidRuntime | undefined;

const hostView = createHostView();
const HOSTS_KEY = 'pi-dish-hosts';
const KEYS_MIGRATED_KEY = 'pi-dish-keys-migrated';
const hostDirectory: ReturnType<typeof createHostDirectory> = createHostDirectory({
  initialCatalog: readJSONPref(HOSTS_KEY, []),
  descriptor: id => hostDiscovery.descriptor(id),
  persistCatalog: catalog => localStorage.setItem(HOSTS_KEY, JSON.stringify(catalog)),
});

// The only fetch entry point for /api paths: it attaches the owning host's
// base and bearer token, so a request cannot reach the serving origin when
// the session lives elsewhere.
const apiTransport: ReturnType<typeof createHostTransport> = createHostTransport({ resolveHost, fetch: (...args) => fetch(...args) });
// Shared ports resolve the owner's method on every call: fixtures and tests
// replace feature methods (e.g. `apiTransport.request`) at runtime.
const request: ApiRequest = (host, path, options) => apiTransport.request(host, path, options);
function resolveHost(host?: HostTarget) { return hostDirectory.resolveHost(host); }
function selectSession(...args: Parameters<ReturnType<typeof createSessionView>['select']>) { return sessionView.select(...args); }
function refreshSessions() { return sidebarLists.refresh(); }
function hostDown(host: Parameters<typeof hostConnections.isDown>[0]) { return hostConnections.isDown(host); }
function noteHost(...args: Parameters<typeof hostConnections.note>) { hostConnections.note(...args); }
function hostChip(hostId?: string | null) { return hostPresentation.chipHtml(hostId); }
function hostColor(hostId: string | null | undefined) { return hostPresentation.colorFor(hostId); }
const chromeScroll = {
  pinned: (container: HTMLElement) => appChrome.pinned(container),
  scroll: (container: HTMLElement) => appChrome.scroll(container),
  jump: (container: HTMLElement) => appChrome.jump(container),
};
const sessionApi: ReturnType<typeof createSessionApi> = createSessionApi(request);

// Element-driven requests (`<img src>`, `<a href>`) cannot carry the bearer
// token and stay unauthenticated, exactly like window.open'd exports.
function hostAssetUrl(host: HostTarget | undefined, path: string) {
  return resolveHost(host).base + path;
}

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
  const data = await sendJson(request, host, '/api/auth/ticket', { purpose });
  if (!record(data) || typeof data.ticket !== 'string' || !data.ticket) throw new Error('no ticket');
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

// Self, the advertised fleet and the device-local catalog merge into one
// list; everything downstream reads effectiveHosts(), so "which hosts exist"
// has exactly one answer.
const hostConnections: ReturnType<typeof createHostConnections> = createHostConnections({ onChange: () => renderHostsSection() });

function effectiveHosts() { return hostDirectory.effectiveHosts().map(hostView); }

function isMultiHost() { return effectiveHosts().length > 1; }
function selfHostEntry() { return effectiveHosts()[0]; }

function hostEntryFor(hostId?: string | null) { const host = hostDirectory.entryFor(hostId); return host ? hostView(host) : null; }

function hostLabelFor(hostId?: string | null) {
  const entry = hostEntryFor(hostId);
  return entry ? hostDisplayLabel(entry) : '';
}

function hostIdIsDown(hostId?: string | null) {
  const entry = hostEntryFor(hostId);
  return entry ? hostConnections.isDown(entry) : false;
}

function seedHostConnFromFleet() { hostConnections.seed(effectiveHosts()); }
function pollableHosts() { return hostConnections.pollable(effectiveHosts()); }

// The controls are usable before async initialization finishes. Fan-out
// views wait on this first catalog load so an early click cannot capture
// self as the whole fleet and then remain permanently under-counted.
let resolveHostFleetReady: () => void;
const hostFleetReady = new Promise<void>(resolve => { resolveHostFleetReady = resolve; });
let startDiscoveredHosts: (() => void) | null = null;
const hostDiscovery: ReturnType<typeof createHostDiscovery> = createHostDiscovery({
  request,
  requestSelf: () => fetch('/api/host'),
  hosts: effectiveHosts,
  pollableHosts,
  sourceFor: hostDirectory.sourceFor,
  onSelf: data => {
    hostDirectory.setSelf(data);
    migrateClientKeys();
    if (newSessionController.isOpen()) newSessionController.renderHosts();
    void pushNotifications.sync();
  },
  onFleet: data => {
    hostDirectory.setFleet(data);
    seedHostConnFromFleet();
  },
  onIdentified: (...args) => {
    if (hostDirectory.applyDescriptor(...args) && newSessionController.isOpen()) newSessionController.renderHosts();
    pruneHostCaches();
    renderHostsSection();
    routinesController.updateButton();
    composerSpeech.updateButton();
    renderSessions();
    startDiscoveredHosts?.();
    void pushNotifications.sync();
  },
  onConnection: (host, event) => hostConnections.note(host, event),
  afterFleet: () => {
    pruneHostCaches();
    renderHostsSection();
    routinesController.updateButton();
    composerSpeech.updateButton();
    if (newSessionController.isOpen()) newSessionController.renderHosts();
    renderSessions();
    startDiscoveredHosts?.();
  },
});

function pruneHostCaches() {
  const live = new Set(effectiveHosts().map(hostKeyOf));
  hostConnections.prune(live);
  hostSessionLoader.prune(live);
}

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
  escapeHtml, displayLabel: host => hostDisplayLabel(hostView(host)), isDown: hostDown,
});

const sessionState: ReturnType<typeof createSessionState> = createSessionState({
  getSelfHostId: () => hostDirectory.self.hostId,
  getHostLabel: hostLabelFor,
  onListsChanged: () => { renderSessions(); vaultApprovals.render(); },
  onCurrentChanged: () => { sessionHeader.update(); vaultApprovals.render(); },
});

// Spawn operations are server-process-local and cannot be resumed after a
// page reload, so their old draft keys have no view that could restore them.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith('pi-dish-draft-spawn:')) localStorage.removeItem(key);
  }
} catch {}
const responseDetailsController: ReturnType<typeof createResponseDetails> = createResponseDetails({ document, sessionState, mode: () => displayPreferences.responseMode });

// Scroll pinning: follow streaming output only while the reader is at the
// bottom, so new content never yanks the viewport.
const appChrome = createAppChrome({ document, storage: localStorage, older: container => transcriptController.maybeOlder(container) });
function autosizePromptInput(input: HTMLTextAreaElement) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; }

document.addEventListener('DOMContentLoaded', async () => {
  const startupSelection = sessionState.selectionGeneration;
  
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
    if (e.key === 'Escape' && !composerAutocomplete.visible && !composerSpeech.isRecording()) {
      if (sideChat.active()) { e.preventDefault(); void sideChat.close(); return; }
      if (sessionActivity.turn) { e.preventDefault(); composerSubmit.abortTurn(); }
    }
  });

  document.addEventListener('keydown', function(e) {
    // Keys typed into the terminal belong to the shell (Ctrl+C = SIGINT,
    // Ctrl+F = forward), not to the app-level shortcuts.
    if (e.target instanceof Element && e.target.closest('.terminal-panel')) return;
    if (e.ctrlKey && e.key === 'c' && sessionActivity.turn) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { e.preventDefault(); composerSubmit.abortTurn(); }
    }
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

  document.addEventListener('click', (e) => {
    const img = (e.target instanceof Element ? e.target.closest<HTMLImageElement>('img.msg-image') : null);
    if (img) composerDrafts.images.openLightbox(img.src);
  });

  // Tap a linkified file mention to open it in the viewer. preventDefault
  // keeps a link inside a <summary> (tool-call headers) from toggling the
  // enclosing <details>. Markdown links to bare file paths carry the href in
  // data-file-path (rich-text.ts); everything else names the path in its text.
  document.addEventListener('click', (e) => {
    const link = (e.target instanceof Element ? e.target.closest<HTMLElement>('.file-link') : null);
    if (!link || !sessionState.currentSession) return;
    e.preventDefault();
    fileViews.openFile(link.dataset.filePath || (link.textContent || '').trim());
  });

  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const link = target?.closest<HTMLElement>('.msg-link-btn');
    if (link) { sessionInfo.copyMessage(link); return; }
    const branch = target?.closest<HTMLElement>('.msg-branch-btn');
    if (branch) { transcriptTree.messageBranch(branch); return; }
    const more = target?.closest<HTMLElement>('.msg-more-btn');
    if (more) transcriptTree.messageMenu(more);
  });

  // A task job's id (wait rows, background-job cards) opens that subagent's
  // run in the family view, selected once the lineage lists it.
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest<HTMLElement>('.job-agent-link') : null;
    const agentId = link?.dataset.agentId;
    if (!agentId) return;
    e.preventDefault();
    const owner = sessionState.captureSelection(), endpoint = owner ? hostEntryFor(owner.host) : null;
    if (owner && endpoint) subagentsController.open(owner, endpoint, sessionRelationsController.data, agentId);
  });


  sidebarControls.mount();
  appChrome.mount();

  // Inline refs carry the identity resolved at render time; chips use the
  // same host-aware resolver. Delegation also covers refs in peek transcripts.
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest<HTMLElement>('.session-ref-link, .session-ref-chip') : null;
    if (!link) return;
    e.preventDefault();
    if (link.dataset.sessionId) { sessionView.select(link.dataset.sessionId, { host: link.dataset.sessionHost || null }); return; }
    const ref = link.getAttribute('data-session-ref') || '', session = sessionReferences.match(ref);
    if (!session) { setStatus(`No session here matches ${ref}`, 'error'); return; }
    sessionView.select(session.id, { host: session.host || null });
  });

  appChrome.setFocus(localStorage.getItem('pi-dish-focus') === '1');

  // A backgrounded phone or slept laptop can leave the event stream half-open
  // without an error, so returning to the tab reconnects the selected session.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    sidebarLists.refresh();
    if (sessionState.currentSession?.isActive) void messageStreamController.start();
  });

  // Only self identity must precede list publication and client-key migration.
  // Peer identification publishes independently; it is not a startup barrier.
  await hostDiscovery.loadIdentity();
  void hostDiscovery.loadFleet().finally(() => {
    resolveHostFleetReady();
    routinesController.updateButton();
    composerSpeech.updateButton();
  });
  loadConfig(); // feature flags (terminal) — fire-and-forget
  themesController.load(); // theme picker options + refresh custom-theme tokens
  sidebarQuery.updateView();
  sidebarQuery.renderChips(); // cached definitions paint immediately…
  sidebarQuery.loadFilters(); // …then the server copy replaces them
  composerSpeech.mount();
  pushNotifications.mount();
  vaultApprovals.mount();
  terminalController.mountKeybar();
  panelResize.terminal();
  panelResize.sidebar();
  anchoredCommentController.mount();
  // The default Active view needs only live rows. Fetch history only when a
  // saved inactive session must be restored; opening All fetches it on demand.
  // A notification opening a new window names its session the same way.
  const opened = new URLSearchParams(location.search);
  const openHost = opened.get('openHost'), openSession = opened.get('openSession');
  if (openHost && openSession) {
    try { localStorage.setItem('pi-dish-session', sessionKey(openHost, openSession)); } catch {}
    history.replaceState(null, '', location.pathname);
  }
  if (opened.has('openVault')) {
    vaultApprovals.open(opened.get('openVault'));
    history.replaceState(null, '', location.pathname);
  }
  const saved = parseSessionKey(localStorage.getItem('pi-dish-session') || '');
  let restoring = false;
  let restored = false;
  async function restoreSavedSession() {
    if (restoring || restored || !saved.sessionId || startupSelection !== sessionState.selectionGeneration) return;
    const endpoint = hostEntryFor(saved.hostId);
    if (!endpoint || (!endpoint.self && !endpoint.hostId)) return;
    restoring = true;
    try {
      await sidebarLists.loadHost(saved.hostId);
      if (startupSelection !== sessionState.selectionGeneration) return;
      if (!sessionState.findSession(saved.sessionId, saved.hostId)) {
        await sidebarLists.loadHost(saved.hostId, true);
      }
      if (startupSelection !== sessionState.selectionGeneration) return;
      const found = sessionState.findSession(saved.sessionId, saved.hostId);
      if (found) {
        restored = true;
        void sessionView.select(saved.sessionId, { host: found.host || null });
      }
    } finally { restoring = false; }
  }
  const startedHosts = new Set<string>();
  startDiscoveredHosts = () => {
    const present = new Set<string>();
    for (const host of pollableHosts()) {
      if (!host.self && !host.hostId) continue;
      const key = JSON.stringify([host.hostId, host.base, host.token]);
      present.add(key);
      if (startedHosts.has(key)) continue;
      startedHosts.add(key);
      void sidebarLists.loadHost(host.hostId || null, sidebarQuery.tab === 'all', sidebarQuery.query || undefined);
    }
    for (const key of startedHosts) if (!present.has(key)) startedHosts.delete(key);
    void restoreSavedSession();
  };
  startDiscoveredHosts();
  void hostDiscovery.identify();
  // Periodic refresh must preserve an in-flight server search, or the list
  // resets to unfiltered mid-search.
  sidebarLists.mount();
});

const sessionReferences: ReturnType<typeof createSessionReferences> = createSessionReferences({
  sessionState, selfId: () => hostDirectory.self.hostId, host: hostEntryFor, hostLabel: hostLabelFor, config: () => appConfig,
});
const composerAutocomplete: ReturnType<typeof createComposerAutocomplete> = createComposerAutocomplete({
  document, sessionState, composerKey: () => composerDrafts.key, provisional: () => !!sessionView.spawnId,
  request, host: hostEntryFor, references: sessionReferences,
  multiHost: isMultiHost, hostLabel: hostLabelFor, failed: error => console.error('Failed to load commands:', error),
  models: { get scope() { return modelCatalog.scope; }, rows: () => modelCatalog.rows() },
  loadModels: (id, harness) => appModels.load(id, harness),
});


const sidebarActivity: ReturnType<typeof createSidebarActivity> = createSidebarActivity({ document, storage: localStorage, sessionState });
const sidebarQuery: ReturnType<typeof createSidebarQuery> = createSidebarQuery({
  document, storage: localStorage, request, host: () => hostEntryFor(null)!,
  render: () => renderSessions(), reload: query => sidebarLists.load(query), queriedFor: () => sidebarLists.queriedFor,
  invalidateLists: () => sidebarLists.invalidate(), busy: value => sidebarLists.busy(value),
  searchChanged: () => { if (searchViewController.isOpen()) searchViewController.run(); }, openSearch: query => searchViewController.open(query),
  prompt: (label, initial) => window.prompt(label, initial), alert: message => alert(message),
});
sidebarQuery.mount();
const sidebarLists: ReturnType<typeof createSidebarLists> = createSidebarLists({
  document, request, sessionState, activity: sidebarActivity,
  hosts: effectiveHosts, pollable: pollableHosts, selfId: () => hostDirectory.self.hostId,
  query: () => sidebarQuery.query, all: () => sidebarQuery.tab === 'all', refreshFleet: () => hostDiscovery.refreshSoon(),
  connection: noteHost,
  askBlocked: (session, host) => extensionUI.toast(`${session.name || 'Unnamed'} is waiting for an answer`, 'warning', () => { void revealSession(session.id, host); }),
});
const hostSessionLoader = sidebarLists.loader;
const loadPrevious = () => sidebarLists.load(undefined, { withPrevious: true });

const sidebarControls: ReturnType<typeof createSidebarControls> = createSidebarControls({
  document, storage: localStorage, sessionState, request,
  host: hostEntryFor, render: () => renderSessions(), closeSidebar: () => sidebarQuery.close(),
  select: (id, host) => sessionView.select(id, { host }), pending: id => sessionView.pending(id), create: (cwd, host) => newSessionController.create(cwd, host),
  finishClose: (id, host, owner) => sessionInfo.finishClose(id, host, owner), refresh: loadPrevious,
  ref: session => sessionRefFor(session), copy: copyTextToClipboard, status: setStatus,
});

function keyForSessionId(id: string) { return sessionKey(sessionState.sessionHostId(id), id); }

function sessionRefFor(session: Pick<SessionEntry, 'id' | 'host'> | null) { return session?.id ? sessionRef(session, hostEntryFor(session.host || null), sessionReferences.prefix(session)) : ''; }

// State publications stay immediate; paint the latest snapshot once per frame.
let sessionListFrame: number | null = null;
const sidebarProjectionMemo: SidebarProjectionMemo = {};
function renderSessions() {
  sidebarActivity.title(); // Hidden tabs still need their unread indicator.
  if (sessionListFrame !== null) return;
  sessionListFrame = requestAnimationFrame(() => {
    sessionListFrame = null;
    if (sidebarControls.dragging) return;
    const sidebarFamilyRootMap = sidebarControls.familyRoots();
    const projection = renderSidebar({
      ...sessionState.sessions, selected: sessionState.currentSession,
      tab: sidebarQuery.tab, view: sidebarQuery.view, query: sidebarQuery.query, queriedFor: sidebarLists.queriedFor, scope: sidebarQuery.scope(), indexing: sidebarLists.indexing,
      contextMetric: displayPreferences.contextMetric, pending: [...pendingSessionSpawns.entries()], selectedSpawn: sessionView.spawnId,
      expanded: sidebarControls.expanded, collapsed: sidebarControls.collapsed, pinned: sidebarControls.pinned, roots: sidebarFamilyRootMap,
      closeConfirm: sidebarControls.closeConfirm, closeBusy: sidebarControls.closeBusy, multiHost: isMultiHost(),
      unread: sidebarActivity.unread, hostChip,
      hosts: effectiveHosts().map(host => {
        const cache = hostSessionLoader.getCache(host);
        return { ...host, state: hostConnections.stateOf(host), key: hostKeyOf(host), color: hostPresentation.colorFor(host.hostId || null),
          dot: hostPresentation.dotHtml(host.hostId || null, 'host-section-dot'), hasCache: !!cache && !!(cache.active.length || cache.previous.length) };
      }),
    }, sidebarProjectionMemo);
    const countEl = (document.getElementById('countActive') as HTMLElement);
    if (countEl) countEl.textContent = projection.count ? String(projection.count) : '';
    sidebarControls.updateList(projection);
  });
}


function refreshSessionControls() {
  sessionControls.updateThinking();
  terminalController.updateButtons();
  composerSpeech.updateButton();
}

const sessionView: ReturnType<typeof createSessionView> = createSessionView({ document, sessionState, storage: localStorage, endpoint: resolveHost,
  get drafts() { return composerDrafts; }, get activity() { return sessionActivity; }, get transcript() { return transcriptController; }, get stream() { return messageStreamController; }, get resume() { return sessionResume; },
  spawn: id => pendingSessionSpawns.get(id), resetSearch: () => sessionSearch.reset(), cancelStreaming: () => streamingRenderer.cancel(), stopFollowing: () => appChrome.stopFollowing(),
  closeViews: keepBounce => mainPane.beforeSelection(keepBounce),
  closeTerminal: () => terminalController.close(), clearExtension: () => extensionUI.clear(), clearRelations: () => sessionRelationsController.clear(), closeControls: () => appChrome.closePanel(), hideAutocomplete: () => composerAutocomplete.hide(),
  retireModels: () => modelCatalog.retire(), retireCommands: () => composerAutocomplete.retireCommands(), queue: data => promptDelivery.render(data), resetSideChat: () => sideChat.reset(), resetArtifacts: () => sessionInfo.resetArtifacts(),
  controls: refreshSessionControls, mood: (description, face) => moodController.set(description, face), status: setStatus,
  render: () => renderSessions(), cancelRecording: () => composerSpeech.cancel(), hideNote: () => composerNotes.hide(), reveal: (id, host) => sidebarControls.reveal(id, host),
  seen: session => sidebarActivity.mark(session), artifacts: owner => sessionInfo.refreshArtifacts(owner), header: () => sessionHeader.update(), relations: owner => sessionRelationsController.load(owner), models: (id, harness) => appModels.load(id, harness), commands: id => composerAutocomplete.loadCommands(id),
});

const sessionResume: ReturnType<typeof createSessionResume> = createSessionResume({ document, sessionState, request, endpoint: resolveHost,
  target: host => savedResumeTarget(host), refresh: refreshSessions, select: selectSession, status: setStatus,
});


const modelCatalog: ReturnType<typeof createModelCatalog> = createModelCatalog({
  read: scope => sessionApi.models(scope.host, scope),
  persist: (scope, models) => localStorage.setItem(modelsCacheKey(scope.harnessId, scope.host.hostId, hostDirectory.self.hostId), JSON.stringify(models)),
  changed: () => responseDetailsController.refreshPricing(),
  failed: error => console.error('Failed to load models:', error),
});

const appModels = createAppModels({ sessions: sessionState, catalog: modelCatalog, host: hostEntryFor });


const sessionRelationsController: ReturnType<typeof createSessionRelations> = createSessionRelations({
  document, window, sessionState, request, endpoint: hostEntryFor,
  loadPrevious,
  openView: (owner, endpoint, initial) => subagentsController.open(owner, endpoint, initial),
  // The takeover's own lineage poll covers an open view (the header chip is
  // hidden there); the header poll defers to it instead of doubling requests.
  takeoverActive: () => subagentsController.isOpen(),
  selectSession, status: setStatus,
});

const sessionHeader: ReturnType<typeof createSessionHeader> = createSessionHeader({ document, sessionState, multi: isMultiHost, host: hostEntryFor, down: hostIdIsDown, color: hostColor, label: hostLabelFor,
  settings: harnessSupportsSettings, ensureHarness: ensureHarnessRows, controls: refreshSessionControls,
});

const sessionControls: ReturnType<typeof createSessionControls> = createSessionControls({
  document, sessionState, catalog: modelCatalog, request, host: hostEntryFor,
  loadModels: (id, harness) => appModels.load(id, harness), status: setStatus,
});

const sessionSearch: ReturnType<typeof createSessionSearch> = createSessionSearch({
  document, sessionState, request, endpoint: hostEntryFor,
  focusMode: () => appChrome.focus, ensureMessage: (index, owns) => transcriptController.ensureMessage(index, owns),
  stopFollowing: () => appChrome.stopFollowing(), updateJumpButton: chromeScroll.jump,
});

const displayPreferences: ReturnType<typeof createDisplayPreferences> = createDisplayPreferences({
  document, storage: localStorage, request, host: () => hostEntryFor(null)!,
  beforeOpen: () => { sidebarQuery.close(); },
  openFleet: () => { closeSettingsModal(); fleetController.open(); },
  themes: { render: select => themesController.render(select), apply: id => themesController.apply(id) },
  filters: () => sidebarQuery.filters, setFilters: value => sidebarQuery.setFilters(value),
  persistFilters: (value, host) => sidebarQuery.persistFilters([...value], host),
  metadataChanged: () => responseDetailsController.update(), contextChanged: () => renderSessions(), alert: message => alert(message),
  notifications: (container, signal) => pushNotifications.renderSettings(container, signal),
  sentPrompts: (container, signal) => promptHistory.renderSettings(container, signal),
});

const pushNotifications: PushNotifications = createPushNotifications({
  window, storage: localStorage, request, hosts: effectiveHosts,
  supports: host => hostSupportsCapability(host, 'push', appConfig), label: host => hostDisplayLabel(host),
  changed: () => { void displayPreferences.render(); },
  // A click is a fresh user selection: anything selected while lists load wins.
  open: async (hostId, sessionId) => {
    const generation = sessionState.selectionGeneration;
    if (!hostEntryFor(hostId)) return;
    await sidebarLists.loadHost(hostId);
    if (!sessionState.findSession(sessionId, hostId)) await sidebarLists.loadHost(hostId, true);
    const found = sessionState.findSession(sessionId, hostId);
    if (found && generation === sessionState.selectionGeneration) void revealSession(sessionId, found.host || null);
  },
  openVault: requestId => vaultApprovals.open(requestId),
});

const vaultApprovals: VaultApprovalsController = createVaultApprovals({
  document, window, request,
  sessions: () => [...sessionState.sessions.active, ...sessionState.sessions.previous],
  current: () => sessionState.currentSession,
  reveal: (id, host) => { void revealSession(id, host); },
  toast: (message, open) => extensionUI.toast(message, 'warning', open),
});

function closeSettingsModal() { displayPreferences.close(); }
/** An explicit "take me there" (toast or notification click) also clears what would hide the chat. */
function revealSession(id: string, host: string | null) {
  closeSettingsModal();
  if (window.innerWidth <= 768) sidebarQuery.close();
  return sessionView.select(id, { host });
}

const recoveryController: ReturnType<typeof createRecovery> = createRecovery({
  root: document.querySelector<HTMLElement>('.main')!, request, hosts: effectiveHosts,
  supports: host => hostSupportsCapability(host, 'recovery', appConfig), down: hostDown,
  fleetReady: () => hostFleetReady, refreshFleet: () => hostDiscovery.loadFleet(),
  selectedHost: () => sessionState.currentSession?.host || null,
  preferencesOpen: () => fleetController.isOpen(),
  closeOtherViews: () => mainPane.beforeTakeover('recovery'),
  confirm: message => confirm(message),
});


const hostSettings: ReturnType<typeof createHostSettings> = createHostSettings({
  directory: hostDirectory, connections: hostConnections, discovery: hostDiscovery,
  request, protocol: () => location.protocol,
  promptToken: label => prompt(`Token for ${label}`, ''),
  displayLabel: host => hostDisplayLabel({ base: host.base, label: host.label ? String(host.label) : '', name: host.name ? String(host.name) : '' }), escapeHtml,
  color: hostColor, customColor: hostId => hostPresentation.isCustom(hostId), resolveColor: resolveColorToHex,
  setColor: (...args) => hostPresentation.setColor(...args),
  onCatalogSaved: () => {
    if (newSessionController.isOpen()) newSessionController.renderHosts();
    pruneHostCaches();
    renderHostsSection();
    renderSessions();
  },
  refreshSessions, renderNewSessionHosts: (...args) => newSessionController.renderHosts(...args),
});

function renderHostsSection() {
  recoveryController.refreshHosts();
  hostSettings.render();
  fleetController.render();
}

const fleetController: ReturnType<typeof createFleetView> = createFleetView({
  root: document.querySelector<HTMLElement>('.main')!, request, hosts: effectiveHosts,
  connection: host => hostConnections.stateOf(host), supports: host => hostSupportsCapability(host, 'hostHealth', appConfig),
  clientSessions: hostId => {
    const self = selfHostEntry();
    const rows = sessionState.sessions.active.filter(session => (session.host || null) === hostId || (!session.host && self?.hostId === hostId));
    return { live: rows.length, working: rows.filter(session => session.turnInProgress).length };
  },
  dot: hostId => hostPresentation.dotHtml(hostId, 'fleet-host-dot'),
  noteConnection: noteHost,
  closeOtherViews: () => mainPane.beforeTakeover('fleet'),
  mountSections: () => {
    const connections = document.getElementById('fleetConnections')!;
    connections.innerHTML = hostSettingsHtml;
    hostSettings.mount(connections);
    recoveryController.refreshHosts();
    void recoveryController.mountPreferences();
  },
  unmountSections: () => { recoveryController.unmountPreferences(); hostSettings.unmount(); },
  closeBounce: () => bounceController.close(),
});

const searchViewController: ReturnType<typeof createSearchView> = createSearchView({
  root: document.querySelector<HTMLElement>('.main')!, request, sessionState,
  hosts: effectiveHosts, fanout: pollableHosts, host: hostEntryFor, scope: () => sidebarQuery.scope(),
  connection: noteHost,
  hostChip,
  closeOtherViews: () => mainPane.beforeTakeover('search'),
  loadPrevious,
  selectSession, sessionSearch,
});

const skillsController: ReturnType<typeof createSkills> = createSkills({
  root: document.querySelector<HTMLElement>('.main')!, request, self: selfHostEntry, origin: () => location.origin,
  sessionState, loadPrevious,
  selectSession,
  closeOtherViews: () => mainPane.beforeTakeover('skills'),
  refine: ({ cwd, draft, host }) => { newSessionController.setHostId(host); newSessionController.open({ cwd, draft }); },
  copy: copyTextToClipboard, status: setStatus,
});

const usageController: ReturnType<typeof createUsageView> = createUsageView({
  root: document.querySelector<HTMLElement>('.main')!, request, storage: localStorage,
  fleetReady: () => hostFleetReady, hosts: pollableHosts, host: hostEntryFor, multiHost: isMultiHost,
  closeOtherViews: () => mainPane.beforeTakeover('usage'),
  connection: noteHost,
  selectSession,
});

const sessionInfo: ReturnType<typeof createSessionInfo> = createSessionInfo({
  document, request, sessionState, host: hostEntryFor,
  reference: session => sessionRefFor(session), copy: copyTextToClipboard, status: setStatus, confirm: text => confirm(text),
  loadPrevious, refreshSessions, selectSession,
});

const fileViews: ReturnType<typeof createFileViews> = createFileViews({
  document, sessionState, request, host: hostEntryFor,
  markdown: text => richText.format(text), highlight: root => richText.highlight(root), copy: copyTextToClipboard,
  status: setStatus, refreshArtifacts: owner => sessionInfo.refreshArtifacts(owner),
  closeComments: () => anchoredCommentController.close(), clearComments: () => anchoredCommentController.set([]),
  refreshComments: () => anchoredCommentController.refresh(), markComments: () => anchoredCommentController.applyMarks(),
});

const anchoredCommentController: ReturnType<typeof createAnchoredComments> = createAnchoredComments({
  document, sessionState, views: fileViews, request, host: hostEntryFor,
  status: setStatus, loadPatch: details => fileViews.loadPatch(details),
});


const transcriptController: ReturnType<typeof createTranscript> = createTranscript({
  document, sessionState, request, host: hostEntryFor,
  renderMessage: message => messageRenderer.message(message), finalize: (root, options) => finalizeRender(root, options),
  closeSearch: () => sessionSearch.close(), cancelStreaming: () => streamingRenderer.cancel(), mood: (description, face) => moodController.set(description, face),
  updateMood: messages => moodController.fromMessages(messages), ...chromeScroll,
  consumeEcho: (id, content) => promptDelivery.consume(keyForSessionId(id), content),
});

const messageRenderer: ReturnType<typeof createMessageRenderer> = createMessageRenderer({
  document, sessionState, details: responseDetailsController, markdown: text => richText.format(text),
  assetUrl: hostAssetUrl, matchRef: ref => sessionReferences.match(ref), ...chromeScroll, follow: () => appChrome.following,
});

const subagentsController: ReturnType<typeof createSubagentsView> = createSubagentsView({
  root: document.querySelector<HTMLElement>('.main')!, request, sessionState, endpoint: hostEntryFor,
  closeOtherViews: () => mainPane.beforeTakeover('subagents'),
  loadPrevious,
  selectSession, status: setStatus,
  markdown: text => richText.format(text), assetUrl: hostAssetUrl, matchRef: ref => sessionReferences.match(ref), details: responseDetailsController,
});


const liveToolsController: ReturnType<typeof createLiveTools> = createLiveTools({
  document, sessionState, started: (id, name) => sessionActivity.toolStarted(id, name),
  finished: id => sessionActivity.toolFinished(id), ...chromeScroll,
  images: (content, alt) => messageRenderer.images(content, alt), mood: (name, args) => moodController.fromTool(name, args),
});


const messageStreamController: ReturnType<typeof createMessageStream> = createMessageStream({ document, sessionState, endpoint: resolveHost, ticket: host => mintHostTicket(host, 'stream'),
  get activity() { return sessionActivity; }, renderer: messageRenderer, get streaming() { return streamingRenderer; }, tools: liveToolsController, get delivery() { return promptDelivery; }, get extensionUI() { return extensionUI; }, get sideChat() { return sideChat; },
  status: setStatus, catchup: owner => transcriptController.catchup(owner), refresh: refreshSessions, artifacts: owner => sessionInfo.refreshArtifacts(owner),
  ...chromeScroll, follow: () => appChrome.following, highlight: root => richText.highlight(root),
  select: selectSession, deleteCached: key => transcriptController.deleteCached(key), loadSessions: (query, options) => sidebarLists.load(query, options),
});


const composerDrafts: ReturnType<typeof createComposerDrafts> = createComposerDrafts({
  document, storage: localStorage, keyForSession: keyForSessionId, currentSessionId: () => sessionState.currentSession?.id || null,
  autosize: input => autosizePromptInput(input), status: setStatus,
  historyChanged: () => promptHistory.update(),
});

const promptHistory: PromptHistoryController = createPromptHistory({
  document, storage: localStorage, drafts: composerDrafts, copy: copyTextToClipboard, status: setStatus, confirm: text => confirm(text),
  label: owner => {
    if (owner.startsWith('spawn:')) return { name: null, detail: 'Pending new session' };
    const { hostId, sessionId } = parseSessionKey(owner), host = hostId ? hostLabelFor(hostId) || hostId : hostLabelFor(null);
    return { name: sessionState.findSession(sessionId, hostId)?.name || null, detail: [host, sessionId.slice(0, 8)].filter(Boolean).join(' · ') };
  },
});

const composerNotes: ReturnType<typeof createComposerNotes> = createComposerNotes(document);
const composerSpeech: ReturnType<typeof createComposerSpeech> = createComposerSpeech({
  document, sessionState, composerKey: () => composerDrafts.key, hosts: effectiveHosts, config: () => appConfig,
  request, status: setStatus,
  showNote: text => composerNotes.show(text), hideNote: () => composerNotes.hide(),
});

const promptDelivery: ReturnType<typeof createPromptDelivery> = createPromptDelivery({ document, sessionState, request, endpoint: resolveHost,
  restore: (key, text) => composerDrafts.restorePayload(key, text, null), status: setStatus,
});

const sessionActivity: ReturnType<typeof createSessionActivity> = createSessionActivity({ document, sessionState, clearQueue: () => promptDelivery.render(null), status: setStatus,
  sideChatActive: () => !!sideChat.active() });

function syncComposerMode(active: boolean) {
  sessionActivity.syncComposerButtons();
  const input = document.getElementById('promptInput') as HTMLTextAreaElement | null;
  if (input) input.placeholder = active ? 'Ask a follow-up in the side chat…' : 'Send a message...';
}
const sideChat: SideChatController = createSideChat({ document, sessionState, markdown: text => richText.format(text), copy: copyTextToClipboard,
  request, endpoint: resolveHost, status: setStatus,
  onChange: syncComposerMode });

const composerSubmit: ReturnType<typeof createComposerSubmit> = createComposerSubmit({ document, sessionState, drafts: composerDrafts, delivery: promptDelivery, activity: sessionActivity, sideChat,
  request, endpoint: resolveHost, spawnId: () => sessionView.spawnId, spawnPending: () => !!sessionView.spawnId && pendingSessionSpawns.has(sessionView.spawnId),
  refs: message => sessionReferences.hints(message), status: setStatus, openTree: () => transcriptTree.open(), hideAutocomplete: () => composerAutocomplete.hide(),
  refresh: refreshSessions, follow: () => appChrome.follow(), scroll: chromeScroll.scroll, renderUser: (message, time, attrs) => messageRenderer.user(message, time, attrs),
  woke: async (id, host) => { await sidebarLists.refresh(); const current = sessionState.currentSession; if (current?.id === id && (current.host || null) === host) await sessionView.select(id, { host }); },
});

const pendingSessionSpawns: ReturnType<typeof createSessionSpawns> = createSessionSpawns({
  request, delay: attempt => new Promise(resolve => setTimeout(resolve, attempt < 50 ? 100 : 250)), harnessLabel: (...args) => newSessionController.harnessLabel(...args),
  current: () => sessionView.spawnId, changed: renderSessions,
  showPending: key => { sidebarQuery.switchTab('active'); sessionView.pending(key); if (window.innerWidth <= 768) sidebarQuery.close(); },
  loadHost: host => sidebarLists.loadHost(host), hasSession: (id, host) => !!sessionState.findSession(id, host),
  selectSession: (id, host) => { void sessionView.select(id, { host }); },
  stashPrompt: () => composerDrafts.stash(),
  saveDraft: (key, draft) => { try { localStorage.setItem(composerDrafts.draftKey(pendingComposerKey(key)), draft); } catch {} },
  migratePrompt: (key, host, id) => composerDrafts.migrate(pendingComposerKey(key), sessionKey(host || hostDirectory.self.hostId, id)),
  discardPrompt: key => { const owner = pendingComposerKey(key); composerDrafts.clearDraft(owner); composerDrafts.images.discard(owner); },
  showFailure: (...args) => sessionView.failure(...args), status: setStatus,
});
const newSessionController: ReturnType<typeof createNewSession> = createNewSession({
  root: document.querySelector<HTMLElement>('.main')!, storage: localStorage, request,
  self: selfHostEntry, host: hostEntryFor, hosts: effectiveHosts, hostDown, multiHost: isMultiHost,
  sessionState, currentSpawn: () => sessionView.spawnId, spawns: pendingSessionSpawns, models: modelCatalog,
  closeOtherViews: () => mainPane.beforeTakeover('newSession'),
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

const harnessSettingsController: ReturnType<typeof createHarnessSettings> = createHarnessSettings({
  root: (document.getElementById('harnessSettingsModal') as HTMLElement), host: hostEntryFor, request,
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
    host: () => hostEntryFor(hostId()), request, known,
    match: fuzzyMatch, score: fuzzyScore, highlight: highlightFuzzy, escapeHtml,
    onPick, onSubmit, onBlur,
  });
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
function finalizeRender(container: HTMLElement, { stripLive = true, inserted }: { stripLive?: boolean; inserted?: readonly HTMLElement[] } = {}) {
  if (stripLive) liveToolsController.clear(container);
  groupToolActivity(container);
  if (inserted) {
    for (const root of inserted) richText.highlight(root);
  } else richText.highlight(container);
}


const streamingRenderer: ReturnType<typeof createStreamingRenderer> = createStreamingRenderer({
  document, sessionState, markdown: text => richText.format(text), ...chromeScroll,
  stream: (previous, text) => richText.stream(previous, text),
});

function setStatus(message: string, type = '') {
  const status = (document.getElementById('status') as HTMLElement);
  status.textContent = message;
  status.className = `status ${type}`;
}


const moodController: ReturnType<typeof createMood> = createMood(document);


const extensionUI: ReturnType<typeof createExtensionUI> = createExtensionUI({
  document, sessionState, storage: localStorage, request, host: hostEntryFor,
  status: setStatus,
});

const browserAssets: ReturnType<typeof createBrowserAssets> = createBrowserAssets(document);
const diagramRenderer: ReturnType<typeof createDiagrams> = createDiagrams({
  document, assets: browserAssets, runtime: () => typeof mermaid === 'undefined' ? null : mermaid,
  retainedRoots: () => transcriptController.retainedRoots(), isPinned: feed => appChrome.pinned(feed), scrollBottom: feed => appChrome.scroll(feed),
});
const richText: ReturnType<typeof createRichText> = createRichText({
  document, marked: typeof marked === 'undefined' ? null : marked, highlight: () => typeof hljs === 'undefined' ? null : hljs,
  assets: browserAssets, diagrams: diagramRenderer, sessionState, copy: copyTextToClipboard, status: setStatus,
  retainedRoots: () => transcriptController.retainedRoots(),
  matchRef: ref => sessionReferences.match(ref),
});

const transcriptTree: ReturnType<typeof createTranscriptTree> = createTranscriptTree({
  document, storage: localStorage, sessionState, request, host: hostEntryFor,
  status: setStatus, selectSession,
  copyMessageLink: button => sessionInfo.copyMessage(button),
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
  } else if (sidebarControls.menuOpen) {
    e.preventDefault(); sidebarControls.closeMenu();
  } else if (promptHistory.isOpen()) {
    e.preventDefault(); promptHistory.close();
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
  } else if (subagentsController.isOpen()) {
    e.preventDefault(); subagentsController.close();
  } else if ((document.getElementById('treeModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); transcriptTree.close();
  } else if ((document.getElementById('statsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); sessionInfo.closeStats();
  } else if ((document.getElementById('artifactsModal') as HTMLElement).style.display !== 'none') {
    e.preventDefault(); sessionInfo.closeArtifacts();
  } else if (recoveryController.isOpen()) {
    e.preventDefault(); recoveryController.close();
  } else if (fleetController.isOpen()) {
    e.preventDefault(); fleetController.close();
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


let appConfig: Record<string, unknown> = { terminal: false };
async function loadConfig() {
  try {
    const res = await request(null, '/api/config');
    const data: unknown = await res.json(); if (res.ok && record(data)) appConfig = data;
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
 * /api/config only for self — see hostSupportsTerminal in helper-identity.ts.
 */
function sessionHostSupportsTerminal(session: SessionEntry | null) {
  return hostSupportsTerminal(hostEntryFor(session?.host), appConfig);
}

/** Same rule for the pi-tmux view button: tmux is the owning host's, too. */
function sessionHostSupportsTmux(session: SessionEntry | null) {
  return hostSupportsCapability(hostEntryFor(session?.host), 'tmux', appConfig);
}

const themesController: ReturnType<typeof createThemes> = createThemes({ document, storage: localStorage, request, host: () => hostEntryFor(null)!,
  changed: () => { terminalController.refreshTheme(); diagramRenderer.refreshTheme(); },
});

function terminalTheme() { return terminalThemeBase(document); }

const terminalController: ReturnType<typeof createTerminalController> = createTerminalController({
  document, storage: localStorage, sessionState, host: host => hostEntryFor(host),
  supportsTerminal: session => sessionHostSupportsTerminal(session), supportsTmux: session => sessionHostSupportsTmux(session),
  asset: (tag, attributes) => browserAssets.load(tag, attributes),
  createTerminal: options => typeof Terminal === 'undefined' ? null : new Terminal(options),
  createFitAddon: () => { const runtime = typeof FitAddon === 'undefined' ? null : FitAddon; const Ctor = typeof runtime === 'function' ? runtime : runtime?.FitAddon; return Ctor ? new Ctor() : null; },
  socket: url => new WebSocket(url), socketUrl: (host, path) => hostWsUrl(host, path), ticket: (host, purpose) => mintHostTicket(host, purpose),
  theme: () => terminalTheme(), applySize: panel => panelResize.terminalSize(panel), confirm: message => confirm(message),
});

const panelResize: ReturnType<typeof createPanelResize> = createPanelResize({ document, storage: localStorage, fitTerminal: () => terminalController.fit() });

const routinesController: ReturnType<typeof createRoutinesView> = createRoutinesView({
  root: document.querySelector<HTMLElement>('.main')!, request, storage: localStorage, sessionState,
  hosts: pollableHosts, effectiveHosts, host: hostEntryFor, fleetReady: () => hostFleetReady, config: () => appConfig, multiHost: isMultiHost,
  hostChip,
  closeOtherViews: () => mainPane.beforeTakeover('routines'),
  connection: noteHost,
  autocomplete: options => createCwdAutocomplete(options), copy: copyTextToClipboard, status: setStatus, confirm: text => confirm(text),
  loadPrevious, selectSession,
});

const bounceController: ReturnType<typeof createBounce> = createBounce({
  document, request, hosts: effectiveHosts, fleetReady: () => hostFleetReady,
  sessionState, refreshSessions, loadPrevious, selectSession,
});

const mainPane = createMainPane({
  takeovers: {
    usage: { close: () => usageController.close() },
    search: { close: () => searchViewController.close() },
    subagents: { close: () => subagentsController.close(), clearsSessionSurfaces: true },
    newSession: { close: () => newSessionController.close() },
    skills: { close: () => skillsController.close() },
    routines: { close: () => routinesController.close() },
    recovery: { close: () => recoveryController.close(), clearsSessionSurfaces: true },
    fleet: { close: () => fleetController.close(), hostsBounce: true },
  },
  sessionSurfaces: {
    search: { close: () => sessionSearch.close() },
    diff: { close: () => fileViews.closeDiff(), closeOnTakeover: true },
    file: { close: () => fileViews.closeFile(), closeOnTakeover: true },
  },
  overlays: {
    settings: () => closeSettingsModal(),
    sidebar: () => sidebarQuery.close(),
    session: {
      stats: () => sessionInfo.closeStats(),
      tree: () => transcriptTree.close(),
      models: () => sessionControls.closeModels(),
      thinking: () => sessionControls.closeThinking(),
      artifacts: () => sessionInfo.closeArtifacts(),
      promptHistory: () => promptHistory.close(),
    },
    bounce: () => bounceController.close(),
  },
});

createAppBindings({ document, actions: {
  openUsageView: () => usageController.open(),
  openSkillsView: () => skillsController.open(),
  openRoutinesView: () => routinesController.open(),
  openSettingsModal: () => displayPreferences.open(),
  openFleetView: () => fleetController.open(),
  toggleVaultPanel: () => vaultApprovals.togglePanel(),
  refreshFleetView: () => fleetController.refresh(),
  closeFleetView: () => fleetController.close(),
  refreshSessions,
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
  searchPrev: () => sessionSearch.move(-1),
  searchNext: () => sessionSearch.move(1),
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
  // Closing the takeover resyncs the header count — the family may have
  // changed while it was open.
  closeSubagentsView: () => { subagentsController.close(); const owner = sessionState.captureSelection(); if (owner) void sessionRelationsController.load(owner); },
  reloadSubagentsView: () => subagentsController.reload(),
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
  saveHarnessSettings: () => harnessSettingsController.save(),
  backdropCloseResponseDetails: (event, node) => { if (event.target === node) responseDetailsController.close(); },
  closeResponseDetails: () => responseDetailsController.close(),
  togglePromptHistory: () => promptHistory.toggle(),
} });
