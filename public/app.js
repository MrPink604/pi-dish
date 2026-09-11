// Generated from src/browser/; edit sources and run npm run build:browser.
const hostView = PiDishBrowser.createHostView();
function appRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const HOSTS_KEY = "pi-dish-hosts";
const KEYS_MIGRATED_KEY = "pi-dish-keys-migrated";
const hostDirectory = PiDishBrowser.createHostDirectory({
  initialCatalog: readJSONPref(HOSTS_KEY, []),
  descriptor: (id) => hostDiscovery.descriptor(id),
  persistCatalog: (catalog) => localStorage.setItem(HOSTS_KEY, JSON.stringify(catalog))
});
function hostById(...args) {
  return hostDirectory.hostById(...args);
}
function resolveHost(...args) {
  return hostDirectory.resolveHost(...args);
}
const apiTransport = PiDishBrowser.createHostTransport({ resolveHost, fetch: (...args) => fetch(...args) });
const sessionApi = PiDishBrowser.createSessionApi((...args) => apiFetch(...args));
function apiFetch(host, path, opts = {}) {
  return apiTransport.request(host, path, opts);
}
function hostAssetUrl(host, path) {
  return resolveHost(host).base + path;
}
function withFetchTimeout(...args) {
  return PiDishBrowser.withFetchTimeout(...args);
}
function hostWsUrl(host, path) {
  const base = resolveHost(host).base;
  const localProto = location.protocol === "https:" ? "wss" : "ws";
  if (!base) return `${localProto}://${location.host}${path}`;
  if (base.startsWith("/")) return `${localProto}://${location.host}${base}${path}`;
  const url = new URL(base);
  return `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}${url.pathname.replace(/\/+$/, "")}${path}`;
}
async function mintHostTicket(host, purpose) {
  const data = await apiSend(host, "/api/auth/ticket", { purpose });
  if (!appRecord(data) || typeof data.ticket !== "string" || !data.ticket) throw new Error("no ticket");
  return data.ticket;
}
function loadHostIdentity() {
  return hostDiscovery.loadIdentity();
}
function migrateClientKeys() {
  if (!hostDirectory.self.hostId) return;
  try {
    if (localStorage.getItem(KEYS_MIGRATED_KEY) === hostDirectory.self.hostId) return;
    const isBare = (key) => parseSessionKey(key).hostId === null;
    const compose = (id) => sessionKey(hostDirectory.self.hostId, id);
    const prefixes = ["pi-dish-draft-", "pi-dish-history-", "pi-dish-terminal-mode-"];
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const key of keys) {
      const prefix = key && prefixes.find((pre) => key.startsWith(pre));
      if (!prefix) continue;
      const owner = key.slice(prefix.length);
      if (!owner || owner.startsWith("spawn:") || !isBare(owner)) continue;
      const value = localStorage.getItem(key);
      localStorage.removeItem(key);
      if (value !== null) localStorage.setItem(prefix + compose(owner), value);
    }
    sidebarActivity.migrate(hostDirectory.self.hostId);
    sidebarControls.migrate(hostDirectory.self.hostId);
    const selected = localStorage.getItem("pi-dish-session");
    if (selected && isBare(selected)) localStorage.setItem("pi-dish-session", compose(selected));
    localStorage.setItem(KEYS_MIGRATED_KEY, hostDirectory.self.hostId);
  } catch {
  }
}
const hostConnections = PiDishBrowser.createHostConnections({ onChange: () => renderHostsSection() });
function invalidateHosts() {
  hostDirectory.invalidate();
}
function effectiveHosts() {
  return hostDirectory.effectiveHosts().map(hostView);
}
function hostKeyOf(...args) {
  return PiDishBrowser.hostKeyOf(...args);
}
function isMultiHost() {
  return effectiveHosts().length > 1;
}
function selfHostEntry() {
  return effectiveHosts()[0];
}
function hostEntryFor(...args) {
  const host = hostDirectory.entryFor(...args);
  return host ? hostView(host) : null;
}
function hostLabelFor(hostId) {
  const entry = hostEntryFor(hostId);
  return entry ? hostDisplayLabel(entry) : "";
}
function hostState(...args) {
  return hostConnections.stateOf(...args);
}
function hostIsDown(...args) {
  return hostConnections.isDown(...args);
}
function hostIdIsDown(hostId) {
  const entry = hostEntryFor(hostId);
  return entry ? hostIsDown(entry) : false;
}
function noteHostReachable(host) {
  hostConnections.note(host, "success");
}
function noteHostBlocked(host) {
  hostConnections.note(host, "blocked");
}
function noteHostFailure(host, error) {
  hostConnections.note(host, { type: "failure", error });
}
function seedHostConnFromFleet() {
  hostConnections.seed(effectiveHosts());
}
function pollableHosts() {
  return hostConnections.pollable(effectiveHosts());
}
function fanoutHosts() {
  return pollableHosts();
}
let resolveHostFleetReady;
const hostFleetReady = new Promise((resolve) => {
  resolveHostFleetReady = resolve;
});
const hostDiscovery = PiDishBrowser.createHostDiscovery({
  request: (...args) => apiFetch(...args),
  requestSelf: () => fetch("/api/host"),
  hosts: effectiveHosts,
  pollableHosts,
  sourceFor: hostDirectory.sourceFor,
  onSelf: (data) => {
    hostDirectory.setSelf(data);
    migrateClientKeys();
    if (isNewSessionViewOpen()) renderNsHosts();
  },
  onFleet: (data) => {
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
  }
});
function loadHostFleet() {
  return hostDiscovery.loadFleet();
}
function identifyHosts(refresh = false) {
  return hostDiscovery.identify(refresh);
}
function refreshHostFleetSoon() {
  hostDiscovery.refreshSoon();
}
function pruneHostCaches() {
  const live = new Set(effectiveHosts().map(hostKeyOf));
  hostConnections.prune(live);
  hostSessionLoader.prune(live);
}
const HOST_COLORS_KEY = "pi-dish-host-colors";
const HOST_COLOR_ORDER_KEY = "pi-dish-host-color-order";
const hostPresentation = PiDishBrowser.createHostPresentation({
  directory: hostDirectory,
  initialColors: readJSONPref(HOST_COLORS_KEY, {}),
  initialOrder: readJSONPref(HOST_COLOR_ORDER_KEY, []),
  persistColors: (colors) => localStorage.setItem(HOST_COLORS_KEY, JSON.stringify(colors)),
  persistOrder: (order) => localStorage.setItem(HOST_COLOR_ORDER_KEY, JSON.stringify(order)),
  onColorChanged: (rows) => {
    if (rows) renderHostsSection();
    renderSessions();
  },
  escapeHtml,
  displayLabel: (host) => hostDisplayLabel(hostView(host)),
  isDown: hostIsDown
});
function hostColorFor(...args) {
  return hostPresentation.colorFor(...args);
}
function hostColorIsCustom(...args) {
  return hostPresentation.isCustom(...args);
}
function setHostColorOverride(...args) {
  hostPresentation.setColor(...args);
}
function resolveColorToHex(...args) {
  return PiDishBrowser.resolveColorToHex(...args);
}
function hostDotHtml(...args) {
  return hostPresentation.dotHtml(...args);
}
function hostChipHtml(...args) {
  return hostPresentation.chipHtml(...args);
}
const sessionState = PiDishBrowser.createSessionState({
  getSelfHostId: () => hostDirectory.self.hostId,
  getHostLabel: hostLabelFor,
  onListsChanged: renderSessions,
  onCurrentChanged: updateSessionHeader
});
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith("pi-dish-draft-spawn:")) localStorage.removeItem(key);
  }
} catch {
}
const responseDetailsController = PiDishBrowser.createResponseDetails({ document, sessionState, mode: () => displayPreferences.responseMode });
const appChrome = PiDishBrowser.createAppChrome({ document, storage: localStorage, older: (container) => maybeLoadOlderMessages(container) });
function autosizePromptInput(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
function isPinnedToBottom(container) {
  return appChrome.pinned(container);
}
function scrollToBottom(container) {
  appChrome.scroll(container);
}
function updateJumpButton(container) {
  appChrome.jump(container);
}
function loadCommands(...args) {
  return composerAutocomplete.loadCommands(...args);
}
document.addEventListener("DOMContentLoaded", async () => {
  const startupSelection = sessionState.selectionGeneration;
  try {
    await loadHostIdentity();
    await loadHostFleet();
    await identifyHosts();
  } finally {
    resolveHostFleetReady();
    updateRoutinesButton();
    updateMicButton();
  }
  loadConfig();
  loadThemes();
  updateViewToggle();
  renderScopeChips();
  loadSavedFilters();
  initMicButton();
  initTerminalKeybar();
  initTerminalResize();
  initSidebarResize();
  initCommentSelections();
  const saved = parseSessionKey(localStorage.getItem("pi-dish-session") || "");
  await loadSessions();
  if (saved.sessionId && !sessionState.findSession(saved.sessionId, saved.hostId)) {
    await loadSessions(void 0, { withPrevious: true });
  }
  if (saved.sessionId && startupSelection === sessionState.selectionGeneration) {
    const found = sessionState.findSession(saved.sessionId, saved.hostId);
    if (found) selectSession(saved.sessionId, { host: found.host || null });
  }
  const promptInput = document.getElementById("promptInput");
  promptInput.addEventListener("keydown", (e) => {
    if (composerAutocomplete.visible) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveAutocomplete(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveAutocomplete(-1);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        var items = document.querySelectorAll(".autocomplete-item");
        if (items.length > 0 && composerAutocomplete.index >= 0) {
          e.preventDefault();
          acceptAutocomplete(items[composerAutocomplete.index]);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideAutocomplete();
        return;
      }
    }
    if (!composerAutocomplete.visible && e.key === "ArrowUp" && promptInput.selectionStart === 0 && promptInput.selectionEnd === 0) {
      if (navigateHistory(-1, promptInput)) {
        e.preventDefault();
        return;
      }
    }
    if (!composerAutocomplete.visible && e.key === "ArrowDown" && composerDrafts.historyIndex !== -1 && promptInput.selectionStart === promptInput.value.length) {
      if (navigateHistory(1, promptInput)) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.ctrlKey) {
        e.preventDefault();
        sendSteer();
      } else {
        e.preventDefault();
        sendPrompt();
      }
    }
    if (e.key === "Escape" && !composerAutocomplete.visible && !isRecording() && sessionActivity.turn) {
      e.preventDefault();
      abortTurn();
    }
  });
  document.addEventListener("keydown", function(e) {
    if (e.target instanceof Element && e.target.closest(".terminal-panel")) return;
    if (e.ctrlKey && e.key === "c" && sessionActivity.turn) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        e.preventDefault();
        abortTurn();
      }
    }
    if (e.ctrlKey && e.key === "f" && sessionState.currentSession) {
      e.preventDefault();
      openSearch();
    }
  });
  promptInput.addEventListener("input", () => {
    autosizePromptInput(promptInput);
    handleAutocomplete(promptInput.value);
    composerDrafts.exitHistory();
    saveDraftSoon();
  });
  promptInput.addEventListener("paste", (e) => {
    const files = Array.from(e.clipboardData?.items || []).filter((it) => it.type && it.type.startsWith("image/")).map((it) => it.getAsFile()).filter((file) => file !== null);
    if (!files.length) return;
    e.preventDefault();
    addImageFiles(files);
  });
  document.getElementById("imageFileInput").addEventListener("change", (e) => {
    const input = e.currentTarget;
    addImageFiles(input.files || []);
    input.value = "";
  });
  document.addEventListener("click", (e) => {
    const img = e.target instanceof Element ? e.target.closest("img.msg-image") : null;
    if (img) openImageLightbox(img.src);
  });
  document.addEventListener("click", (e) => {
    const link = e.target instanceof Element ? e.target.closest(".file-link") : null;
    if (!link || !sessionState.currentSession) return;
    e.preventDefault();
    openFileViewer((link.textContent || "").trim());
  });
  document.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest(".msg-link-btn") : null;
    if (btn) copyMessageShareLink(btn);
  });
  sidebarLists.mount();
  sidebarControls.mount();
  const messagesEl = document.getElementById("messages");
  if (messagesEl) {
    appChrome.mount();
    messagesEl.addEventListener("click", (e) => {
      const chip = e.target instanceof Element ? e.target.closest(".session-ref-chip") : null;
      if (!chip) return;
      const ref = chip.getAttribute("data-session-ref") || "";
      const session = sessionMatchingRef(ref);
      if (!session) {
        setStatus(`No session here matches ${ref}`, "error");
        return;
      }
      selectSession(session.id, { host: session.host || null });
    });
  }
  setFocusMode(localStorage.getItem("pi-dish-focus") === "1");
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshSessions();
  });
});
const sessionReferences = PiDishBrowser.createSessionReferences({
  sessionState,
  selfId: () => hostDirectory.self.hostId,
  host: hostEntryFor,
  hostLabel: hostLabelFor,
  config: () => appConfig
});
const composerAutocomplete = PiDishBrowser.createComposerAutocomplete({
  document,
  sessionState,
  composerKey: () => composerDrafts.key,
  provisional: () => !!sessionView.spawnId,
  request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor,
  references: sessionReferences,
  multiHost: isMultiHost,
  hostLabel: hostLabelFor,
  failed: (error) => console.error("Failed to load commands:", error)
});
function handleAutocomplete(...args) {
  composerAutocomplete.handle(...args);
}
function queueFileAutocomplete(...args) {
  composerAutocomplete.queueFile(...args);
}
function showFileAutocomplete(...args) {
  composerAutocomplete.showFiles(...args);
}
function acceptFileMention(...args) {
  composerAutocomplete.acceptFile(...args);
}
function allKnownSessions() {
  return sessionReferences.all();
}
function sessionHostIdOf(...args) {
  return sessionReferences.hostId(...args);
}
function sessionRefCandidates() {
  return sessionReferences.candidates();
}
function sameHostSessionIds(...args) {
  return sessionReferences.sameHostIds(...args);
}
function refPrefixFor(...args) {
  return sessionReferences.prefix(...args);
}
function composerSessionRef(...args) {
  return sessionReferences.ref(...args);
}
function showSessionRefAutocomplete(...args) {
  composerAutocomplete.showRefs(...args);
}
function acceptSessionRefMention(...args) {
  composerAutocomplete.acceptRef(...args);
}
function sessionMatchingRef(...args) {
  return sessionReferences.match(...args);
}
function sessionRefHints(...args) {
  return sessionReferences.hints(...args);
}
function showAutocomplete(...args) {
  composerAutocomplete.showCommands(...args);
}
function hideAutocomplete() {
  composerAutocomplete.hide();
}
function moveAutocomplete(...args) {
  composerAutocomplete.move(...args);
}
function acceptAutocomplete(...args) {
  composerAutocomplete.accept(...args);
}
function acceptAutocompleteByName(...args) {
  composerAutocomplete.acceptCommand(...args);
}
const sidebarActivity = PiDishBrowser.createSidebarActivity({ document, storage: localStorage, sessionState });
const sidebarQuery = PiDishBrowser.createSidebarQuery({
  document,
  storage: localStorage,
  request: (host, path, options) => apiFetch(host, path, options),
  host: () => hostEntryFor(null),
  render: () => renderSessions(),
  reload: (query) => loadSessions(query),
  queriedFor: () => sidebarLists.queriedFor,
  invalidateLists: () => sidebarLists.invalidate(),
  busy: (value) => setSearchBusy(value),
  searchChanged: () => {
    if (isSearchViewOpen()) runSearchView();
  },
  openSearch: (query) => openSearchView(query),
  prompt: (label, initial) => window.prompt(label, initial),
  alert: (message) => alert(message)
});
sidebarQuery.mount();
const sidebarLists = PiDishBrowser.createSidebarLists({
  document,
  request: (host, path, options) => apiFetch(host, path, options),
  sessionState,
  activity: sidebarActivity,
  hosts: effectiveHosts,
  pollable: pollableHosts,
  selfId: () => hostDirectory.self.hostId,
  query: () => sidebarQuery.query,
  all: () => sidebarQuery.tab === "all",
  refreshFleet: refreshHostFleetSoon,
  connection: (host, event) => hostConnections.note(host, event)
});
const hostSessionLoader = sidebarLists.loader;
function toggleSidebarView() {
  sidebarQuery.toggleView();
}
function updateViewToggle() {
  sidebarQuery.updateView();
}
function loadSavedFilters() {
  return sidebarQuery.loadFilters();
}
function persistSavedFilters(next, host) {
  return sidebarQuery.persistFilters(next, host || void 0);
}
function scopeQuery() {
  return sidebarQuery.scope();
}
function toggleScope(...args) {
  sidebarQuery.toggleScope(...args);
}
function saveCurrentFilterAsScope() {
  return sidebarQuery.saveCurrent();
}
function renderScopeChips() {
  sidebarQuery.renderChips();
}
function markSessionSeen(...args) {
  sidebarActivity.mark(...args);
}
function isUnread(...args) {
  return sidebarActivity.unread(...args);
}
function updateUnreadTitle() {
  sidebarActivity.title();
}
function toggleSidebar() {
  sidebarQuery.toggle();
}
function closeSidebar() {
  sidebarQuery.close();
}
function switchTab(...args) {
  sidebarQuery.switchTab(...args);
}
function onFilterInput() {
  sidebarQuery.onInput();
}
function setSearchBusy(...args) {
  sidebarLists.busy(...args);
}
function loadSessions(...args) {
  return sidebarLists.load(...args);
}
function queryHosts(...args) {
  return PiDishBrowser.queryHosts(...args);
}
function loadHostSessions(...args) {
  return hostSessionLoader.load(...args);
}
function publishSessionLists() {
  sidebarLists.publish();
}
function refreshSessions() {
  return sidebarLists.refresh();
}
const sidebarControls = PiDishBrowser.createSidebarControls({
  document,
  storage: localStorage,
  sessionState,
  request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor,
  render: () => renderSessions(),
  closeSidebar: () => closeSidebar(),
  select: (id, host) => selectSession(id, { host }),
  pending: (id) => showPendingSessionView(id),
  create: (cwd, host) => createSession(cwd, host),
  finishClose: (id, host, owner) => finishSessionClose(id, host, owner),
  refresh: () => loadSessions(void 0, { withPrevious: true }),
  ref: (session) => sessionRefFor(session),
  copy: (text) => copyTextToClipboard(text),
  status: (message, type) => setStatus(message, type)
});
function harnessBadgeInnerHtml(...args) {
  return PiDishBrowser.harnessBadgeInnerHtml(...args);
}
function renderHarnessBadge(...args) {
  return PiDishBrowser.renderHarnessBadge(...args);
}
function keyForSessionId(id) {
  return sessionKey(sessionState.sessionHostId(id), id);
}
function toggleGroupCollapsed(...args) {
  sidebarControls.toggleGroup(...args);
}
function toggleSessionFamilyExpanded(...args) {
  sidebarControls.toggleFamily(...args);
}
function currentFamilyRootMap() {
  return sidebarControls.familyRoots();
}
function revealSessionInFamily(...args) {
  sidebarControls.reveal(...args);
}
function toggleSessionPinned(...args) {
  sidebarControls.togglePin(...args);
}
function handleRowCloseClick(...args) {
  sidebarControls.closeClick(...args);
}
function performRowClose(...args) {
  return sidebarControls.performClose(...args);
}
function sessionRefFor(session) {
  return session?.id ? sessionRef(session, hostEntryFor(session.host || null), refPrefixFor(session)) : "";
}
function isSessionMenuOpen() {
  return sidebarControls.menuOpen;
}
function closeSessionMenu() {
  sidebarControls.closeMenu();
}
function openSessionMenu(...args) {
  sidebarControls.openMenu(...args);
}
let lastSessionListHtml = "";
function renderSessions() {
  if (sidebarControls.dragging) return;
  const sidebarFamilyRootMap = currentFamilyRootMap();
  const { html, count } = PiDishBrowser.renderSidebar({
    ...sessionState.sessions,
    selected: sessionState.currentSession,
    tab: sidebarQuery.tab,
    view: sidebarQuery.view,
    query: sidebarQuery.query,
    queriedFor: sidebarLists.queriedFor,
    scope: scopeQuery(),
    indexing: sidebarLists.indexing,
    contextMetric: displayPreferences.contextMetric,
    pending: [...pendingSessionSpawns.entries()],
    selectedSpawn: sessionView.spawnId,
    expanded: sidebarControls.expanded,
    collapsed: sidebarControls.collapsed,
    pinned: sidebarControls.pinned,
    roots: sidebarFamilyRootMap,
    closeConfirm: sidebarControls.closeConfirm,
    closeBusy: sidebarControls.closeBusy,
    multiHost: isMultiHost(),
    unread: isUnread,
    hostChip: hostChipHtml,
    hosts: effectiveHosts().map((host) => {
      const cache = hostSessionLoader.getCache(host);
      return {
        ...host,
        state: hostState(host),
        key: hostKeyOf(host),
        color: hostColorFor(host.hostId || null),
        dot: hostDotHtml(host.hostId || null, "host-section-dot"),
        hasCache: !!cache && !!(cache.active.length || cache.previous.length)
      };
    })
  });
  const countEl = document.getElementById("countActive");
  if (countEl) countEl.textContent = count ? String(count) : "";
  if (html !== lastSessionListHtml) {
    closeSessionMenu();
    document.getElementById("sessionList").innerHTML = html;
    lastSessionListHtml = html;
  }
  updateUnreadTitle();
}
function workspaceGroupKey(hostId, path) {
  return isMultiHost() && hostId ? sessionKey(hostId, path) : path;
}
function pendingComposerKey(id) {
  return `spawn:${id}`;
}
const sessionView = PiDishBrowser.createSessionView({
  document,
  sessionState,
  storage: localStorage,
  endpoint: resolveHost,
  get drafts() {
    return composerDrafts;
  },
  get activity() {
    return sessionActivity;
  },
  get transcript() {
    return transcriptController;
  },
  get stream() {
    return messageStreamController;
  },
  get resume() {
    return sessionResume;
  },
  spawn: (id) => pendingSessionSpawns.get(id),
  resetSearch: () => sessionSearch.reset(),
  cancelStreaming: () => cancelStreamingRender(),
  stopFollowing: () => {
    appChrome.stopFollowing();
  },
  closeViews: (_pending, keepBounce) => {
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
    closeNewSessionView();
    closeSkillsView();
    closeRoutinesView();
    closeRecoveryView();
    if (!keepBounce) closeBounceView();
  },
  closeTerminal: () => closeTerminal(),
  clearExtension: () => clearExtensionUI(),
  clearRelations: () => clearSessionRelations(),
  closeControls: () => closeControlPanel(),
  hideAutocomplete: () => hideAutocomplete(),
  retireModels: () => modelCatalog.retire(),
  retireCommands: () => composerAutocomplete.retireCommands(),
  queue: (data) => renderQueueStatus(data),
  closeBtw: () => closeBtwPanel(),
  resetArtifacts: () => sessionInfo.resetArtifacts(),
  thinking: () => updateThinkingBadges(),
  terminal: () => updateTerminalButtons(),
  mic: () => updateMicButton(),
  mood: (description, face) => setMoodIndicator(description, face),
  status: (message, type) => setStatus(message, type),
  render: () => renderSessions(),
  cancelRecording: () => cancelRecording(),
  hideNote: () => hideComposerNote(),
  math: () => loadMathAssets(),
  reveal: (id, host) => revealSessionInFamily(id, host),
  seen: (session) => markSessionSeen(session),
  artifacts: (owner) => refreshArtifacts(owner),
  header: () => updateSessionHeader(),
  relations: (owner) => loadSessionRelations(owner),
  models: (id, harness) => loadModels(id, harness),
  commands: (id) => loadCommands(id)
});
function showPendingSessionView(...args) {
  sessionView.pending(...args);
}
function showPendingSessionFailure(...args) {
  sessionView.failure(...args);
}
function selectSession(...args) {
  return sessionView.select(...args);
}
const sessionResume = PiDishBrowser.createSessionResume({
  document,
  sessionState,
  request: (...args) => apiFetch(...args),
  endpoint: resolveHost,
  target: (host) => savedResumeTarget(host),
  refresh: () => refreshSessions(),
  select: (id, options) => selectSession(id, options),
  status: (message, type) => setStatus(message, type)
});
function resetResumeModelPicker() {
  sessionResume.reset();
}
function loadResumeModelOptions(...args) {
  return sessionResume.load(...args);
}
function resumeSession() {
  return sessionResume.resume();
}
const modelCatalog = PiDishBrowser.createModelCatalog({
  read: (scope) => sessionApi.models(scope.host, scope),
  persist: (scope, models) => localStorage.setItem(modelsCacheKey(scope.harnessId, scope.host.hostId), JSON.stringify(models)),
  changed: refreshResponsePricingState,
  failed: (error) => console.error("Failed to load models:", error)
});
function modelCatalogUrl(...args) {
  return PiDishBrowser.modelCatalogUrl(...args);
}
function modelsCacheKey(harnessId, hostId) {
  return PiDishBrowser.modelsCacheKey(harnessId, hostId, hostDirectory.self.hostId);
}
function loadModels(sessionId, harnessId, cwd, host) {
  const owner = sessionId ? sessionState.captureSelection() : null;
  const storedHarness = sessionId ? sessionState.findSession(sessionId)?.harnessId : null;
  const requestedHarnessId = harnessId || (typeof storedHarness === "string" ? storedHarness : "") || "pi";
  const requestedHost = sessionId ? sessionState.sessionHostId(sessionId) : host === void 0 ? null : host;
  const endpoint = hostEntryFor(requestedHost);
  if (!endpoint) {
    modelCatalog.clear();
    return Promise.resolve();
  }
  const captured = Object.freeze({ ...endpoint });
  const generation = newSessionController.generation;
  const ownsRows = () => PiDishBrowser.sameDirectoryHost(captured, hostEntryFor(requestedHost)) && (sessionId ? !!owner && owner.id === sessionId && sessionState.ownsSelection(owner) : generation === newSessionController.generation && isNewSessionViewOpen() && nsHostId() === captured.hostId && selectedHarnessId() === requestedHarnessId);
  const ownsRequest = () => ownsRows() && (!!sessionId || nsCwdValue() === (cwd || ""));
  return modelCatalog.load({ host: captured, sessionId: sessionId || void 0, harnessId: requestedHarnessId, cwd }, ownsRequest, ownsRows);
}
const sessionRelationsController = PiDishBrowser.createSessionRelations({
  document,
  window,
  sessionState,
  request: (host, path, init) => apiFetch(host, path, init),
  endpoint: hostEntryFor,
  loadPrevious: () => loadSessions(void 0, { withPrevious: true }),
  selectSession: (id, options) => selectSession(id, options),
  status: setStatus
});
function clearSessionRelations() {
  sessionRelationsController.clear();
}
function loadSessionRelations(...args) {
  return sessionRelationsController.load(...args);
}
function openRelatedSession(...args) {
  return sessionRelationsController.openRelated(...args);
}
function openRelationsModal() {
  sessionRelationsController.openModal();
}
function closeRelationsModal() {
  sessionRelationsController.closeModal();
}
const sessionHeader = PiDishBrowser.createSessionHeader({
  document,
  sessionState,
  multi: isMultiHost,
  host: hostEntryFor,
  down: hostIdIsDown,
  color: hostColorFor,
  label: hostLabelFor,
  settings: (session) => harnessSupportsSettings(session),
  ensureHarness: (id) => ensureHarnessRows(id),
  thinking: () => updateThinkingBadges(),
  terminal: () => updateTerminalButtons(),
  mic: () => updateMicButton()
});
function setModelChipLabel(...args) {
  sessionHeader.label(...args);
}
function updateSessionHeader() {
  sessionHeader.update();
}
const sessionControls = PiDishBrowser.createSessionControls({
  document,
  sessionState,
  catalog: modelCatalog,
  request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor,
  loadModels: (id, harness) => loadModels(id, harness),
  status: (message, type) => setStatus(message, type)
});
function updateThinkingBadges() {
  sessionControls.updateThinking();
}
function toggleThinkingDropdown() {
  return sessionControls.toggleThinking();
}
function closeThinkingDropdown() {
  sessionControls.closeThinking();
}
function selectThinkingLevel(...args) {
  return sessionControls.selectThinking(...args);
}
function setFocusMode(on) {
  appChrome.setFocus(on);
}
const sessionSearch = PiDishBrowser.createSessionSearch({
  document,
  sessionState,
  request: (host, path, init) => apiFetch(host, path, init),
  endpoint: hostEntryFor,
  focusMode: () => appChrome.focus,
  oldestIndex: () => transcriptController.oldestIndex,
  hasOlder: () => transcriptController.hasOlder,
  loadOlder: () => loadOlderMessages(),
  stopFollowing: () => {
    appChrome.stopFollowing();
  },
  updateJumpButton
});
const search = sessionSearch.state;
function toggleSearchBar() {
  sessionSearch.toggle();
}
function openSearch() {
  sessionSearch.open();
}
function closeSearch() {
  sessionSearch.close();
}
function updateSearchCount(...args) {
  sessionSearch.updateCount(...args);
}
function runSessionSearch(...args) {
  return sessionSearch.run(...args);
}
function searchPrev() {
  return sessionSearch.move(-1);
}
function searchNext() {
  return sessionSearch.move(1);
}
function jumpToSearchResult() {
  return sessionSearch.jump();
}
function handleSearchKey(...args) {
  sessionSearch.key(...args);
}
function toggleControlPanel() {
  appChrome.togglePanel();
}
function openControlPanel() {
  appChrome.openPanel();
}
function closeControlPanel() {
  appChrome.closePanel();
}
function toggleFocusMode() {
  appChrome.toggleFocus();
}
const displayPreferences = PiDishBrowser.createDisplayPreferences({
  document,
  storage: localStorage,
  request: (host, url, options) => apiFetch(host, url, options),
  host: () => hostEntryFor(null),
  beforeOpen: () => {
    closeSidebar();
    closeBounceView();
  },
  unmountSections: () => {
    recoveryController.unmountPreferences();
    hostSettings.unmount();
  },
  mountSections: (body) => {
    hostSettings.mount(body);
    refreshRecoveryHosts();
    renderRecoveryPreferences();
  },
  themes: { render: (select) => renderThemeSelect(select), apply: (id) => applyTheme(id) },
  filters: () => sidebarQuery.filters,
  setFilters: (value) => sidebarQuery.setFilters(value),
  persistFilters: (value, host) => persistSavedFilters([...value], host),
  metadataChanged: () => updateRenderedResponseMetadata(),
  contextChanged: () => renderSessions(),
  alert: (message) => alert(message)
});
function openSettingsModal() {
  displayPreferences.open();
}
function closeSettingsModal() {
  closeBounceView();
  displayPreferences.close();
}
function renderPreferences() {
  return displayPreferences.render();
}
const recoveryController = PiDishBrowser.createRecovery({
  root: document.querySelector(".main"),
  request: apiFetch,
  hosts: effectiveHosts,
  supports: (host) => hostSupportsCapability(host, "recovery", appConfig),
  down: hostIsDown,
  fleetReady: () => hostFleetReady,
  refreshFleet: loadHostFleet,
  selectedHost: () => sessionState.currentSession?.host || null,
  settingsOpen: () => document.getElementById("settingsModal").style.display !== "none",
  closeOtherViews: () => {
    closeSettingsModal();
    closeSidebar();
    closeUsageView();
    closeSearchView();
    closeNewSessionView();
    closeSkillsView();
    closeRoutinesView();
    closeBounceView();
    closeDiffView();
    closeFileView();
  },
  confirm: (message) => confirm(message)
});
function refreshRecoveryHosts() {
  recoveryController.refreshHosts();
}
function renderRecoveryPreferences() {
  return recoveryController.mountPreferences();
}
function isRecoveryViewOpen() {
  return recoveryController.isOpen();
}
function closeRecoveryView() {
  recoveryController.close();
}
function openRecoveryView(...args) {
  recoveryController.open(...args);
}
function loadRecoveryView() {
  return recoveryController.load();
}
const hostSettings = PiDishBrowser.createHostSettings({
  directory: hostDirectory,
  connections: hostConnections,
  discovery: hostDiscovery,
  request: apiFetch,
  protocol: () => location.protocol,
  promptToken: (label) => prompt(`Token for ${label}`, ""),
  displayLabel: (host) => hostDisplayLabel({ base: host.base, label: host.label ? String(host.label) : "", name: host.name ? String(host.name) : "" }),
  escapeHtml,
  color: hostColorFor,
  customColor: hostColorIsCustom,
  resolveColor: resolveColorToHex,
  setColor: setHostColorOverride,
  onCatalogSaved: () => {
    if (isNewSessionViewOpen()) renderNsHosts();
    pruneHostCaches();
    renderHostsSection();
    renderSessions();
  },
  refreshSessions,
  renderNewSessionHosts: renderNsHosts
});
function saveHostCatalog() {
  hostSettings.save();
}
function renderHostsSection() {
  refreshRecoveryHosts();
  hostSettings.render();
}
const searchViewController = PiDishBrowser.createSearchView({
  root: document.querySelector(".main"),
  request: apiFetch,
  sessionState,
  hosts: effectiveHosts,
  fanout: fanoutHosts,
  host: hostEntryFor,
  scope: scopeQuery,
  connection: (host, event, error) => {
    if (event === "success") noteHostReachable(host);
    else if (event === "blocked") noteHostBlocked(host);
    else noteHostFailure(host, error);
  },
  hostChip: hostChipHtml,
  closeOtherViews: () => {
    closeSidebar();
    closeUsageView();
    closeNewSessionView();
    closeSkillsView();
    closeRoutinesView();
    closeRecoveryView();
    closeBounceView();
  },
  loadPrevious: () => loadSessions(void 0, { withPrevious: true }),
  selectSession: (id, options) => selectSession(id, options),
  sessionSearch
});
function isSearchViewOpen() {
  return searchViewController.isOpen();
}
function openSearchView(...args) {
  searchViewController.open(...args);
}
function closeSearchView() {
  searchViewController.close();
}
function onSearchViewInput(...args) {
  searchViewController.input(...args);
}
function runSearchView() {
  return searchViewController.run();
}
function setSearchToken(...args) {
  searchViewController.setToken(...args);
}
function openSearchResult(...args) {
  return searchViewController.openResult(...args);
}
const skillsController = PiDishBrowser.createSkills({
  root: document.querySelector(".main"),
  request: apiFetch,
  self: selfHostEntry,
  origin: () => location.origin,
  sessionState,
  loadPrevious: () => loadSessions(void 0, { withPrevious: true }),
  selectSession: (id, options) => selectSession(id, options),
  closeOtherViews: () => {
    closeSidebar();
    closeUsageView();
    closeSearchView();
    closeNewSessionView();
    closeRoutinesView();
    closeRecoveryView();
    closeBounceView();
  },
  refine: ({ cwd, draft, host }) => {
    newSessionController.setHostId(host);
    openNewSessionView({ cwd, draft });
  },
  copy: copyTextToClipboard,
  status: setStatus
});
function isSkillsViewOpen() {
  return skillsController.isOpen();
}
function openSkillsView() {
  skillsController.open();
}
function closeSkillsView() {
  skillsController.close();
}
function refreshSkillsView() {
  skillsController.refresh();
}
function skillsViewEscape() {
  return skillsController.escape();
}
function backToSkillsDirectory() {
  skillsController.back();
}
function startSkillRefine() {
  skillsController.refine();
}
function openSkillDetail(...args) {
  return skillsController.detail(...args);
}
function openSkillActivation(...args) {
  return skillsController.activation(...args);
}
const usageController = PiDishBrowser.createUsageView({
  root: document.querySelector(".main"),
  request: apiFetch,
  storage: localStorage,
  fleetReady: () => hostFleetReady,
  hosts: fanoutHosts,
  host: hostEntryFor,
  multiHost: isMultiHost,
  closeOtherViews: () => {
    closeSidebar();
    closeSearchView();
    closeNewSessionView();
    closeSkillsView();
    closeRoutinesView();
    closeRecoveryView();
    closeBounceView();
  },
  connection: (host, event, error) => {
    if (event === "success") noteHostReachable(host);
    else if (event === "blocked") noteHostBlocked(host);
    else noteHostFailure(host, error);
  },
  selectSession: (id, options) => selectSession(id, options)
});
function isUsageViewOpen() {
  return usageController.isOpen();
}
function openUsageView() {
  usageController.open();
}
function closeUsageView() {
  usageController.close();
}
function loadUsageView() {
  return usageController.load();
}
function setUsageRange(...args) {
  usageController.setRange(...args);
}
function setUsageSort(...args) {
  usageController.setSort(...args);
}
function setUsageStack(...args) {
  usageController.setStack(...args);
}
const sessionInfo = PiDishBrowser.createSessionInfo({
  document,
  request: (host, path, options) => apiFetch(host, path, options),
  sessionState,
  host: hostEntryFor,
  reference: (session) => sessionRefFor(session),
  copy: (text) => copyTextToClipboard(text),
  status: (text, type) => setStatus(text, type),
  confirm: (text) => confirm(text),
  loadPrevious: () => loadSessions(void 0, { withPrevious: true }),
  refreshSessions: () => refreshSessions(),
  selectSession: (id, options) => selectSession(id, options)
});
function openStatsModal() {
  sessionInfo.openStats();
}
function closeStatsModal() {
  sessionInfo.closeStats();
}
function copyMessageShareLink(...args) {
  return sessionInfo.copyMessage(...args);
}
function finishSessionClose(...args) {
  return sessionInfo.finishClose(...args);
}
function refreshArtifacts(...args) {
  return sessionInfo.refreshArtifacts(...args);
}
function updateArtifactsBadge() {
  sessionInfo.updateBadge();
}
function openArtifactsModal() {
  sessionInfo.openArtifacts();
}
function closeArtifactsModal() {
  sessionInfo.closeArtifacts();
}
const fileViews = PiDishBrowser.createFileViews({
  document,
  sessionState,
  request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor,
  markdown: (text) => formatMarkdown(text),
  highlight: (root) => applyHighlight(root),
  copy: (text) => copyTextToClipboard(text),
  status: (message, type) => setStatus(message, type),
  refreshArtifacts: (owner) => refreshArtifacts(owner),
  closeComments: () => closeCommentBubble(),
  clearComments: () => setAnchoredComments([]),
  refreshComments: () => refreshAnchoredComments(),
  markComments: () => applyCommentMarks()
});
function isFileViewOpen() {
  return fileViews.isFileOpen();
}
function ownsFileView(...args) {
  return fileViews.ownsFile(...args);
}
function openFileViewer(...args) {
  return fileViews.openFile(...args);
}
function closeFileView() {
  fileViews.closeFile();
}
function publishFileView() {
  return fileViews.publish();
}
function copyFileViewContent(...args) {
  fileViews.copy(...args);
}
function isDiffViewOpen() {
  return fileViews.isDiffOpen();
}
function ownsDiffView(...args) {
  return fileViews.ownsDiff(...args);
}
function toggleDiffView() {
  fileViews.toggleDiff();
}
function openDiffView() {
  return fileViews.openDiff();
}
function closeDiffView() {
  fileViews.closeDiff();
}
function loadDiffView() {
  return fileViews.loadDiff();
}
function loadDeferredDiffPatch(...args) {
  return fileViews.loadPatch(...args);
}
const anchoredCommentController = PiDishBrowser.createAnchoredComments({
  document,
  sessionState,
  views: fileViews,
  request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor,
  status: (message, type) => setStatus(message, type),
  loadPatch: (details) => loadDeferredDiffPatch(details)
});
function selectionTextAnchor(...args) {
  return PiDishBrowser.selectionTextAnchor(...args);
}
function isCommentBubbleOpen() {
  return anchoredCommentController.isOpen();
}
function captureFileCommentSelection(...args) {
  anchoredCommentController.captureFile(...args);
}
function captureDiffCommentSelection(...args) {
  anchoredCommentController.captureDiff(...args);
}
function initCommentSelections() {
  anchoredCommentController.mount();
}
function positionCommentBubble() {
  anchoredCommentController.position();
}
function openCommentBubble(...args) {
  anchoredCommentController.openDraft(...args);
}
function closeCommentBubble() {
  anchoredCommentController.close();
}
function handleCommentKey(...args) {
  anchoredCommentController.key(...args);
}
function submitAnchoredComment() {
  return anchoredCommentController.submit();
}
function setAnchoredComments(...args) {
  anchoredCommentController.set(...args);
}
function refreshAnchoredComments() {
  return anchoredCommentController.refresh();
}
function applyCommentMarks() {
  anchoredCommentController.applyMarks();
}
function renderCommentCountChips() {
  anchoredCommentController.renderChips();
}
function isCommentListPopoverOpen() {
  return anchoredCommentController.isListOpen();
}
function closeCommentListPopover() {
  anchoredCommentController.closeList();
}
function toggleCommentListPopover(...args) {
  anchoredCommentController.toggleList(...args);
}
function renderCommentListPopover() {
  anchoredCommentController.renderList();
}
function focusAnchoredComment(...args) {
  return anchoredCommentController.focus(...args);
}
function openCommentEditor(...args) {
  anchoredCommentController.openEditor(...args);
}
function disarmCommentDelete() {
  anchoredCommentController.disarmDelete();
}
function handleCommentDelete() {
  return anchoredCommentController.remove();
}
function exportSession() {
  return sessionControls.export();
}
function downloadBlob(...args) {
  sessionControls.download(...args);
}
function startRename() {
  sessionControls.startRename();
}
function handleRenameKey(...args) {
  sessionControls.renameKey(...args);
}
function commitRename() {
  return sessionControls.commitRename();
}
function cancelRename() {
  sessionControls.cancelRename();
}
function toggleModelDropdown() {
  return sessionControls.toggleModels();
}
function renderModelDropdown(...args) {
  sessionControls.renderModels(...args);
}
function enterModelEditMode() {
  sessionControls.setEditMode(true);
}
function exitModelEditMode() {
  sessionControls.setEditMode(false);
}
function currentModelQuery() {
  return sessionControls.query;
}
function toggleModelEnabled(...args) {
  sessionControls.toggleModel(...args);
}
function setAllModelsEnabled(...args) {
  sessionControls.setAll(...args);
}
function toggleProviderEnabled(...args) {
  sessionControls.toggleProvider(...args);
}
function saveEnabledModels() {
  sessionControls.saveEnabled();
}
function closeModelDropdown() {
  sessionControls.closeModels();
}
function selectModel(...args) {
  return sessionControls.selectModel(...args);
}
const transcriptController = PiDishBrowser.createTranscript({
  document,
  sessionState,
  request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor,
  renderMessage: (message) => renderMessageHtml(message),
  finalize: (root, options) => finalizeRender(root, options),
  closeSearch: () => closeSearch(),
  cancelStreaming: () => cancelStreamingRender(),
  mood: (description, face) => setMoodIndicator(description, face),
  updateMood: (messages) => updateMoodFromMessages(messages),
  pinned: isPinnedToBottom,
  scroll: scrollToBottom,
  jump: updateJumpButton,
  consumeEcho: (id, content) => consumePendingSelfEcho(id, content)
});
function stashCurrentTranscript() {
  transcriptController.stash();
}
function restoreCachedTranscript(...args) {
  return transcriptController.restore(...args);
}
function pruneTranscriptCache(...args) {
  transcriptController.pruneCache(...args);
}
function maybeLoadOlderMessages(...args) {
  transcriptController.maybeOlder(...args);
}
function renderMessageHtml(...args) {
  return messageRenderer.message(...args);
}
function loadMessages(...args) {
  return transcriptController.load(...args);
}
function renderLoadOlderBar() {
  return transcriptController.barHtml();
}
function renderMessages(...args) {
  transcriptController.render(...args);
}
function loadOlderMessages() {
  return transcriptController.loadOlder();
}
function fetchNewMessagesSince(...args) {
  return transcriptController.catchup(...args);
}
const messageRenderer = PiDishBrowser.createMessageRenderer({
  document,
  sessionState,
  details: responseDetailsController,
  markdown: (text) => formatMarkdown(text),
  assetUrl: hostAssetUrl,
  matchRef: (ref) => sessionMatchingRef(ref),
  pinned: isPinnedToBottom,
  follow: () => appChrome.following,
  scroll: scrollToBottom,
  jump: updateJumpButton
});
function imageBlocksHtml(...args) {
  return messageRenderer.images(...args);
}
function renderUserMessage(...args) {
  return messageRenderer.user(...args);
}
function renderAssistantMessage(...args) {
  return messageRenderer.assistant(...args);
}
function renderCustomMessage(...args) {
  return messageRenderer.custom(...args);
}
function renderThinkingBlock(...args) {
  return messageRenderer.thinking(...args);
}
function renderToolCall(...args) {
  return messageRenderer.tool(...args);
}
function upsertLiveCustomMessage(...args) {
  messageRenderer.upsertCustom(...args);
}
function updateRenderedResponseMetadata() {
  responseDetailsController.update();
}
function refreshResponsePricingState() {
  responseDetailsController.refreshPricing();
}
function openResponseDetails(...args) {
  responseDetailsController.open(...args);
}
function closeResponseDetails() {
  responseDetailsController.close();
}
const liveToolsController = PiDishBrowser.createLiveTools({
  document,
  sessionState,
  started: (id, name) => sessionActivity.toolStarted(id, name),
  finished: (id) => sessionActivity.toolFinished(id),
  pinned: isPinnedToBottom,
  scroll: scrollToBottom,
  jump: updateJumpButton,
  images: (content, alt) => imageBlocksHtml(content, alt),
  mood: (name, args) => applyMoodFromTool(name, args)
});
function appendLiveToolPanel(...args) {
  return liveToolsController.append(...args);
}
function updateLiveToolPanel(...args) {
  liveToolsController.update(...args);
}
function finalizeLiveToolPanel(...args) {
  liveToolsController.finish(...args);
}
const messageStreamController = PiDishBrowser.createMessageStream({
  document,
  sessionState,
  endpoint: resolveHost,
  ticket: (host) => mintHostTicket(host, "stream"),
  get activity() {
    return sessionActivity;
  },
  renderer: messageRenderer,
  get streaming() {
    return streamingRenderer;
  },
  tools: liveToolsController,
  get delivery() {
    return promptDelivery;
  },
  get extensionUI() {
    return extensionUI;
  },
  status: (message, type) => setStatus(message, type),
  catchup: (owner) => fetchNewMessagesSince(owner),
  refresh: () => refreshSessions(),
  artifacts: (owner) => refreshArtifacts(owner),
  pinned: isPinnedToBottom,
  follow: () => appChrome.following,
  scroll: scrollToBottom,
  jump: updateJumpButton,
  highlight: (root) => applyHighlight(root),
  select: (id, options) => selectSession(id, options),
  deleteCached: (key) => transcriptController.deleteCached(key),
  loadSessions: (query, options) => loadSessions(query, options)
});
function startMessageStream(...args) {
  return messageStreamController.start(...args);
}
const composerDrafts = PiDishBrowser.createComposerDrafts({
  document,
  storage: localStorage,
  keyForSession: keyForSessionId,
  currentSessionId: () => sessionState.currentSession?.id || null,
  autosize: (input) => autosizePromptInput(input),
  status: (message, type) => setStatus(message, type)
});
function addImageFiles(...args) {
  return composerDrafts.images.add(...args);
}
function prepareImageAttachment(...args) {
  return composerDrafts.images.prepare(...args);
}
function fileToBase64(...args) {
  return composerDrafts.images.read(...args);
}
function renderAttachmentStrip() {
  composerDrafts.images.render();
}
function removeAttachment(...args) {
  composerDrafts.images.remove(...args);
}
function takePendingImages() {
  return composerDrafts.images.take();
}
function openImageLightbox(...args) {
  composerDrafts.images.openLightbox(...args);
}
const composerNotes = PiDishBrowser.createComposerNotes(document);
const composerSpeech = PiDishBrowser.createComposerSpeech({
  document,
  sessionState,
  composerKey: () => composerDrafts.key,
  hosts: effectiveHosts,
  config: () => appConfig,
  request: (host, path, options) => apiFetch(host, path, options),
  status: (message) => setStatus(message),
  showNote: (text) => showComposerNote(text),
  hideNote: () => hideComposerNote()
});
function showComposerNote(...args) {
  composerNotes.show(...args);
}
function hideComposerNote() {
  composerNotes.hide();
}
function sttHostFor() {
  return composerSpeech.host();
}
function micUnavailableReason() {
  return composerSpeech.reason();
}
function isRecording() {
  return composerSpeech.isRecording();
}
function updateMicButton() {
  composerSpeech.updateButton();
}
function initMicButton() {
  composerSpeech.mount();
}
function updateMicStatus() {
  composerSpeech.updateStatus();
}
function startRecording() {
  return composerSpeech.start();
}
function stopRecording() {
  composerSpeech.stop();
}
function cancelRecording() {
  composerSpeech.cancel();
}
function releaseMic() {
  composerSpeech.release();
}
function finishRecording(...args) {
  composerSpeech.finish(...args);
}
function transcribeRecording(...args) {
  return composerSpeech.transcribe(...args);
}
function insertTranscript(...args) {
  composerSpeech.insert(...args);
}
function composerOwnerKey(...args) {
  return composerDrafts.ownerKey(...args);
}
function draftKey(...args) {
  return composerDrafts.draftKey(...args);
}
function historyKey(...args) {
  return composerDrafts.historyKey(...args);
}
function writeSessionDraft(...args) {
  composerDrafts.write(...args);
}
function stashPromptState() {
  composerDrafts.stash();
}
function clearPromptComposer() {
  composerDrafts.clear();
}
function setComposerWaiting(...args) {
  composerDrafts.waiting(...args);
}
function saveDraftSoon() {
  composerDrafts.saveSoon();
}
function clearDraft(...args) {
  composerDrafts.clearDraft(...args);
}
function restorePromptState(...args) {
  composerDrafts.restore(...args);
}
function recordPrompt(...args) {
  composerDrafts.record(...args);
}
function mergeComposerText(...args) {
  return PiDishBrowser.mergeComposerText(...args);
}
function migratePromptState(...args) {
  composerDrafts.migrate(...args);
}
function restorePromptToSession(...args) {
  composerDrafts.restorePayload(...args);
}
function navigateHistory(...args) {
  return composerDrafts.navigate(...args);
}
const promptDelivery = PiDishBrowser.createPromptDelivery({
  document,
  sessionState,
  request: (...args) => apiFetch(...args),
  endpoint: resolveHost,
  restore: (key, text) => restorePromptToSession(key, text, null),
  status: (message, type) => setStatus(message, type)
});
function discardOptimisticPrompt(...args) {
  promptDelivery.discard(...args);
}
function consumePendingSelfEcho(id, content) {
  return promptDelivery.consume(keyForSessionId(id), content);
}
function sendPrompt() {
  return composerSubmit.sendPrompt();
}
const sessionActivity = PiDishBrowser.createSessionActivity({ document, sessionState, clearQueue: () => renderQueueStatus(null), status: (message) => setStatus(message) });
function updateWorkingIndicator() {
  sessionActivity.update();
}
function setTurnInProgress(active) {
  sessionActivity.setTurn(!!active);
}
function setCompacting(active) {
  sessionActivity.setCompacting(!!active);
}
function sendQueuedMessage(...args) {
  return composerSubmit.sendQueuedMessage(...args);
}
function sendSteer() {
  return composerSubmit.sendSteer();
}
function sendFollowUp() {
  return composerSubmit.sendFollowUp();
}
function renderQueueStatus(...args) {
  promptDelivery.render(...args);
}
function editQueuedMessage(...args) {
  return promptDelivery.edit(...args);
}
const btwPanel = PiDishBrowser.createBtwPanel({ document, sessionState, markdown: (text) => formatMarkdown(text), copy: (text) => copyTextToClipboard(text) });
function showBtwPanel(...args) {
  return btwPanel.show(...args);
}
function resolveBtwPanel(...args) {
  btwPanel.resolve(...args);
}
function failBtwPanel(...args) {
  btwPanel.fail(...args);
}
function closeBtwPanel() {
  btwPanel.close();
}
function copyBtwAnswer(...args) {
  return btwPanel.copy(...args);
}
const composerSubmit = PiDishBrowser.createComposerSubmit({
  document,
  sessionState,
  drafts: composerDrafts,
  delivery: promptDelivery,
  activity: sessionActivity,
  btw: btwPanel,
  request: (...args) => apiFetch(...args),
  endpoint: resolveHost,
  spawnId: () => sessionView.spawnId,
  spawnPending: () => !!sessionView.spawnId && pendingSessionSpawns.has(sessionView.spawnId),
  refs: (message) => sessionRefHints(message),
  status: (message, type) => setStatus(message, type),
  openTree: () => openTreeModal(),
  hideAutocomplete: () => hideAutocomplete(),
  refresh: () => refreshSessions(),
  follow: () => {
    appChrome.follow();
  },
  scroll: scrollToBottom,
  renderUser: (message, time, attrs) => renderUserMessage(message, time, attrs)
});
function abortTurn() {
  return composerSubmit.abortTurn();
}
const pendingSessionSpawns = PiDishBrowser.createSessionSpawns({
  request: apiFetch,
  delay: () => new Promise((resolve) => setTimeout(resolve, 250)),
  harnessLabel,
  current: () => sessionView.spawnId,
  changed: renderSessions,
  showPending: (key) => {
    switchTab("active");
    showPendingSessionView(key);
    if (window.innerWidth <= 768) closeSidebar();
  },
  loadSessions,
  hasSession: (id, host) => !!sessionState.findSession(id, host),
  selectSession: (id, host) => {
    void selectSession(id, { host });
  },
  stashPrompt: stashPromptState,
  saveDraft: (key, draft) => {
    try {
      localStorage.setItem(draftKey(pendingComposerKey(key)), draft);
    } catch {
    }
  },
  migratePrompt: (key, host, id) => migratePromptState(pendingComposerKey(key), sessionKey(host || hostDirectory.self.hostId, id)),
  discardPrompt: (key) => {
    const owner = pendingComposerKey(key);
    clearDraft(owner);
    composerDrafts.images.discard(owner);
  },
  showFailure: showPendingSessionFailure,
  status: setStatus
});
const newSessionController = PiDishBrowser.createNewSession({
  root: document.querySelector(".main"),
  storage: localStorage,
  request: apiFetch,
  self: selfHostEntry,
  host: hostEntryFor,
  hosts: effectiveHosts,
  hostDown: hostIsDown,
  multiHost: isMultiHost,
  sessionState,
  currentSpawn: () => sessionView.spawnId,
  spawns: pendingSessionSpawns,
  models: modelCatalog,
  closeOtherViews: () => {
    closeSidebar();
    closeUsageView();
    closeSearchView();
    closeSkillsView();
    closeRoutinesView();
    closeRecoveryView();
    closeBounceView();
  },
  closeSettings: () => closeHarnessSettings(),
  harnessCacheChanged: () => {
    if (sessionState.currentSession) updateSessionHeader();
  },
  status: setStatus
});
const HARNESS_KEY = PiDishBrowser.NEW_SESSION_HARNESS_KEY;
const NS_THINKING_LABELS = PiDishBrowser.NS_THINKING_LABELS;
const harnessDiscovery = newSessionController.harnesses;
const newSessionConfigPreview = newSessionController.config;
const spawnTargetsController = newSessionController.targets;
const spawnTargetPicker = newSessionController.targetPicker;
const directoryCatalog = newSessionController.directories;
function captureSpawnView() {
  return newSessionController.captureView();
}
function submitNewSession(...args) {
  return newSessionController.submit(...args);
}
function createSession(...args) {
  return newSessionController.create(...args);
}
function spawnNewSession() {
  return newSessionController.spawn();
}
function nsHost() {
  return newSessionController.host();
}
function nsHostId() {
  return newSessionController.hostId();
}
function nsHostSupports(...args) {
  return newSessionController.supports(...args);
}
function nsHostOptions() {
  return newSessionController.hostOptions();
}
function nsCwdValue() {
  return newSessionController.cwd();
}
function setNsCwd(...args) {
  newSessionController.setCwd(...args);
}
function selectedHarnessId() {
  return newSessionController.selectedHarness();
}
function harnessLabel(...args) {
  return newSessionController.harnessLabel(...args);
}
function renderNsHosts() {
  newSessionController.renderHosts();
}
function renderNsHarnesses() {
  newSessionController.renderHarnesses();
}
function renderNsWorkspaces() {
  newSessionController.renderWorkspaces();
}
function onNsHostChange(...args) {
  newSessionController.changeHost(...args);
}
function onNsHarnessChange(...args) {
  newSessionController.changeHarness(...args);
}
function onNsModelChange(...args) {
  newSessionController.preferences.selectModel(...args);
}
function onNsThinkingChange(...args) {
  newSessionController.preferences.selectThinking(...args);
}
function syncNsThinking() {
  newSessionController.preferences.syncThinking();
}
function renderNsModel() {
  newSessionController.preferences.render();
}
function isNewSessionViewOpen() {
  return newSessionController.isOpen();
}
function openNewSessionView(...args) {
  newSessionController.open(...args);
}
function closeNewSessionView() {
  newSessionController.close();
}
function refreshNsPilotOptions() {
  newSessionController.refresh();
}
function scheduleNsPilotRefresh() {
  newSessionController.scheduleRefresh();
}
function initNsTree() {
  newSessionController.initTree();
}
function hideCwdDropdown() {
  newSessionController.hideCwd();
}
function nsError(...args) {
  newSessionController.error(...args);
}
function loadKnownCwds() {
  return directoryCatalog.load();
}
function loadSpawnTargets() {
  return spawnTargetsController.load();
}
function hideSpawnTargetDropdown() {
  spawnTargetPicker.hide();
}
function selectedSpawnTarget() {
  return newSessionController.selectedTarget();
}
function savedResumeTarget(host) {
  return spawnTargetsController.resume(hostEntryFor(host));
}
function loadHarnesses() {
  return harnessDiscovery.load();
}
function loadNsHarnessConfig(cwd = nsCwdValue()) {
  return newSessionConfigPreview.load(cwd);
}
function harnessRow(...args) {
  return harnessDiscovery.row(...args);
}
function ensureHarnessRows(hostId) {
  void harnessDiscovery.ensure(hostId);
}
function harnessSupportsSettings(session) {
  return !!session && typeof session.harnessId === "string" && !!session.harnessId && !!harnessRow(sessionHostIdOf(session), session.harnessId)?.pilotConfig;
}
function modelSelectOptionsHtml(models) {
  return PiDishBrowser.modelSelectOptionsHtml(models, escapeHtml);
}
function modelHiddenNote(...args) {
  return PiDishBrowser.modelHiddenNote(...args);
}
const harnessSettingsController = PiDishBrowser.createHarnessSettings({
  root: document.getElementById("harnessSettingsModal"),
  host: hostEntryFor,
  request: apiFetch,
  fallbackModels: (host, harness) => modelCatalog.scope?.harnessId === harness && PiDishBrowser.sameDirectoryHost(modelCatalog.scope?.host || null, host) ? modelCatalog.rows() : [],
  escapeHtml,
  shortCwd,
  roleDefinitions: OMP_MODEL_ROLES,
  parseModelRoleRef,
  composeModelRoleRef,
  modelRoleLevels,
  onSaved: (scope) => {
    if (isNewSessionViewOpen() && selectedHarnessId() === scope.harnessId && nsHostId() === scope.hostId && nsCwdValue() === scope.cwd) void loadNsHarnessConfig();
  }
});
function isHarnessSettingsOpen() {
  return harnessSettingsController.isOpen();
}
function showHarnessSettingsTab(...args) {
  harnessSettingsController.showTab(...args);
}
function closeHarnessSettings() {
  harnessSettingsController.close();
}
function saveHarnessSettings() {
  return harnessSettingsController.save();
}
async function harnessSettingsFetch(hostId, url) {
  const res = await apiFetch(hostId, url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
function openSessionHarnessSettings() {
  const session = sessionState.currentSession;
  if (!session || !harnessSupportsSettings(session)) return;
  return openHarnessSettings({
    harnessId: typeof session.harnessId === "string" ? session.harnessId : "pi",
    hostId: sessionHostIdOf(session),
    cwd: typeof session.cwd === "string" ? session.cwd : "",
    label: typeof session.harnessLabel === "string" && session.harnessLabel || harnessBadgeInfo(typeof session.harnessId === "string" ? session.harnessId : null).label
  });
}
function openHarnessSettings(opts = {}) {
  const harnessId = opts.harnessId || "omp";
  return harnessSettingsController.open({
    harnessId,
    hostId: opts.hostId !== void 0 ? opts.hostId : nsHostId(),
    cwd: (opts.cwd !== void 0 ? opts.cwd : newSessionConfigPreview.config?.cwd ?? nsCwdValue()) || "",
    label: opts.label || harnessLabel(harnessId),
    tab: opts.tab
  });
}
function createCwdAutocomplete({
  input,
  dropdown,
  hostId = nsHostId,
  known = () => [],
  onPick = () => {
  },
  onSubmit = null,
  onBlur = null
}) {
  return PiDishBrowser.createCwdAutocomplete({
    input,
    dropdown,
    host: () => hostEntryFor(hostId()),
    request: apiFetch,
    known,
    match: fuzzyMatch,
    score: fuzzyScore,
    highlight: highlightFuzzy,
    escapeHtml,
    onPick,
    onSubmit,
    onBlur
  });
}
async function apiSend(host, path, body, method = "POST") {
  return PiDishBrowser.sendJson((...args) => apiFetch(...args), host, path, body, method);
}
function readJSONPref(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function removeDuplicatedLiveContent(container) {
  liveToolsController.clear(container);
}
function finalizeRender(container, { stripLive = true } = {}) {
  if (stripLive) removeDuplicatedLiveContent(container);
  groupToolActivity(container);
  applyHighlight(container);
}
function groupToolActivity(...args) {
  PiDishBrowser.groupToolActivity(...args);
}
function updateToolGroupSummary(...args) {
  PiDishBrowser.updateToolGroupSummary(...args);
}
const streamingRenderer = PiDishBrowser.createStreamingRenderer({
  document,
  sessionState,
  markdown: (text) => formatMarkdown(text),
  pinned: isPinnedToBottom,
  scroll: scrollToBottom,
  jump: updateJumpButton
});
function queueStreamingRender(...args) {
  streamingRenderer.queue(...args);
}
function flushStreamingRender() {
  streamingRenderer.flush();
}
function cancelStreamingRender() {
  streamingRenderer.cancel();
}
function renderStreamingMessage(...args) {
  streamingRenderer.render(...args);
}
function setStatus(message, type = "") {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = `status ${type}`;
}
const moodController = PiDishBrowser.createMood(document);
function setMoodIndicator(...args) {
  moodController.set(...args);
}
function applyMoodFromTool(...args) {
  moodController.fromTool(...args);
}
function updateMoodFromMessages(...args) {
  moodController.fromMessages(...args);
}
const extensionUI = PiDishBrowser.createExtensionUI({
  document,
  sessionState,
  storage: localStorage,
  request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor,
  status: (message, type) => setStatus(message, type)
});
function clearExtensionUI() {
  extensionUI.clear();
}
function handleExtensionUI(request, id, host = sessionState.sessionHostId(id)) {
  extensionUI.handle(request, { id, host });
}
const browserAssets = PiDishBrowser.createBrowserAssets(document);
const diagramRenderer = PiDishBrowser.createDiagrams({
  document,
  assets: browserAssets,
  runtime: () => typeof mermaid === "undefined" ? null : mermaid,
  retainedRoots: () => transcriptController.retainedRoots(),
  isPinned: (feed) => isPinnedToBottom(feed),
  scrollBottom: (feed) => scrollToBottom(feed)
});
const richText = PiDishBrowser.createRichText({
  document,
  marked: typeof marked === "undefined" ? null : marked,
  highlight: () => typeof hljs === "undefined" ? null : hljs,
  assets: browserAssets,
  diagrams: diagramRenderer,
  sessionState,
  copy: (text) => copyTextToClipboard(text),
  status: (message, type) => setStatus(message, type)
});
function formatMarkdown(...args) {
  return richText.format(...args);
}
function applyHighlight(...args) {
  richText.highlight(...args);
}
function loadMathAssets() {
  return richText.loadMath();
}
function loadVendorAsset(...args) {
  return browserAssets.load(...args);
}
function refreshDiagramTheme() {
  diagramRenderer.refreshTheme();
}
function copyTextToClipboard(text) {
  return PiDishBrowser.copyTextToClipboard(text, document, navigator);
}
const transcriptTree = PiDishBrowser.createTranscriptTree({
  document,
  storage: localStorage,
  sessionState,
  request: (host, path, options) => apiFetch(host, path, options),
  host: hostEntryFor,
  status: (message, type) => setStatus(message, type),
  selectSession: (id, options) => selectSession(id, options),
  saveEditorDraft: (owner, text) => {
    try {
      const key = draftKey(sessionRefKey(owner));
      if (!(localStorage.getItem(key) || "").trim()) localStorage.setItem(key, text);
    } catch {
    }
  }
});
function openTreeModal() {
  return transcriptTree.open();
}
function closeTreeModal() {
  transcriptTree.close();
}
function selectTreeNode(...args) {
  transcriptTree.select(...args);
}
function confirmBranch() {
  return transcriptTree.confirm();
}
document.addEventListener("keydown", function(e) {
  if (e.key !== "Escape") return;
  if (isRecording()) {
    e.preventDefault();
    cancelRecording();
    updateMicButton();
    return;
  }
  const lightbox = document.querySelector(".lightbox-overlay");
  if (lightbox) {
    e.preventDefault();
    lightbox.remove();
  } else if (isSessionMenuOpen()) {
    e.preventDefault();
    closeSessionMenu();
  } else if (isCommentListPopoverOpen()) {
    e.preventDefault();
    closeCommentListPopover();
  } else if (document.getElementById("commentBubble").style.display !== "none") {
    e.preventDefault();
    closeCommentBubble();
  } else if (document.getElementById("responseDetailsModal").style.display !== "none") {
    e.preventDefault();
    closeResponseDetails();
  } else if (isHarnessSettingsOpen()) {
    e.preventDefault();
    closeHarnessSettings();
  } else if (document.getElementById("settingsModal").style.display !== "none") {
    e.preventDefault();
    closeSettingsModal();
  } else if (document.getElementById("relationsModal").style.display !== "none") {
    e.preventDefault();
    closeRelationsModal();
  } else if (document.getElementById("treeModal").style.display !== "none") {
    e.preventDefault();
    closeTreeModal();
  } else if (document.getElementById("statsModal").style.display !== "none") {
    e.preventDefault();
    closeStatsModal();
  } else if (document.getElementById("artifactsModal").style.display !== "none") {
    e.preventDefault();
    closeArtifactsModal();
  } else if (isRecoveryViewOpen()) {
    e.preventDefault();
    closeRecoveryView();
  } else if (isRoutinesViewOpen()) {
    e.preventDefault();
    routinesViewEscape();
  } else if (isSkillsViewOpen()) {
    e.preventDefault();
    skillsViewEscape();
  } else if (isNewSessionViewOpen()) {
    e.preventDefault();
    closeNewSessionView();
  } else if (isSearchViewOpen()) {
    e.preventDefault();
    closeSearchView();
  } else if (isUsageViewOpen()) {
    e.preventDefault();
    closeUsageView();
  } else if (isFileViewOpen()) {
    e.preventDefault();
    closeFileView();
  } else if (isDiffViewOpen()) {
    e.preventDefault();
    closeDiffView();
  }
});
let appConfig = { terminal: false };
async function loadConfig() {
  try {
    const res = await apiFetch(null, "/api/config");
    const data = await res.json();
    if (res.ok && appRecord(data)) appConfig = data;
  } catch {
  }
  updateTerminalButtons();
  updateRoutinesButton();
  updateMicButton();
}
function sessionHostSupportsTerminal(session) {
  return hostSupportsTerminal(hostEntryFor(session?.host), appConfig);
}
function sessionHostSupportsTmux(session) {
  return hostSupportsCapability(hostEntryFor(session?.host), "tmux", appConfig);
}
function updateTerminalButtons() {
  terminalController.updateButtons();
}
const themesController = PiDishBrowser.createThemes({
  document,
  storage: localStorage,
  request: (host, url, options) => apiFetch(host, url, options),
  host: () => hostEntryFor(null),
  changed: () => {
    terminalController.refreshTheme();
    refreshDiagramTheme();
  }
});
function loadThemes() {
  return themesController.load();
}
function renderThemeSelect(...args) {
  themesController.render(...args);
}
function applyTheme(...args) {
  themesController.apply(...args);
}
function terminalTheme() {
  return PiDishBrowser.terminalTheme(document);
}
const terminalController = PiDishBrowser.createTerminalController({
  document,
  storage: localStorage,
  sessionState,
  host: (host) => hostEntryFor(host),
  supportsTerminal: (session) => sessionHostSupportsTerminal(session),
  supportsTmux: (session) => sessionHostSupportsTmux(session),
  asset: (tag, attributes) => loadVendorAsset(tag, attributes),
  createTerminal: (options) => typeof Terminal === "undefined" ? null : new Terminal(options),
  createFitAddon: () => {
    const runtime = typeof FitAddon === "undefined" ? null : FitAddon;
    const Ctor = typeof runtime === "function" ? runtime : runtime?.FitAddon;
    return Ctor ? new Ctor() : null;
  },
  socket: (url) => new WebSocket(url),
  socketUrl: (host, path) => hostWsUrl(host, path),
  ticket: (host, purpose) => mintHostTicket(host, purpose),
  theme: () => terminalTheme(),
  applySize: (panel) => applySavedTerminalSize(panel),
  confirm: (message) => confirm(message)
});
function terminalModeKey(...args) {
  return terminalController.modeKey(...args);
}
function loadTerminalAssets() {
  return terminalController.loadAssets();
}
function toggleTerminal() {
  terminalController.toggle();
}
function openTerminal(...args) {
  return terminalController.open(...args);
}
function closeTerminal() {
  terminalController.close();
}
function fitTerminal() {
  terminalController.fit();
}
function termSend(...args) {
  terminalController.send(...args);
}
function connectTerminalWS() {
  terminalController.connect();
}
function updateTerminalModeUI() {
  terminalController.updateMode();
}
function switchTerminalMode() {
  terminalController.switchMode();
}
function restartTerminalShell() {
  terminalController.restart();
}
function termKeybarPress(...args) {
  terminalController.key(...args);
}
const panelResize = PiDishBrowser.createPanelResize({ document, storage: localStorage, fitTerminal: () => fitTerminal() });
function clampSidebarWidth(px) {
  return PiDishBrowser.clampSidebarWidth(px, window.innerWidth);
}
function applySavedSidebarWidth() {
  panelResize.sidebarWidth();
}
function initSidebarResize() {
  panelResize.sidebar();
}
function initTerminalResize() {
  panelResize.terminal();
}
function clampTerminalHeight(...args) {
  return PiDishBrowser.clampTerminalHeight(...args);
}
function applySavedTerminalSize(...args) {
  panelResize.terminalSize(...args);
}
function initTerminalKeybar() {
  terminalController.mountKeybar();
}
const routinesController = PiDishBrowser.createRoutinesView({
  root: document.querySelector(".main"),
  request: (host, url, options) => apiFetch(host, url, options),
  storage: localStorage,
  sessionState,
  hosts: fanoutHosts,
  effectiveHosts,
  host: hostEntryFor,
  fleetReady: () => hostFleetReady,
  config: () => appConfig,
  multiHost: isMultiHost,
  hostChip: (host) => hostChipHtml(host),
  closeOtherViews: () => {
    closeSidebar();
    closeUsageView();
    closeSearchView();
    closeNewSessionView();
    closeSkillsView();
    closeRecoveryView();
    closeBounceView();
  },
  connection: (host, event, error) => {
    if (event === "success") noteHostReachable(host);
    else if (event === "blocked") noteHostBlocked(host);
    else noteHostFailure(host, error);
  },
  autocomplete: (options) => createCwdAutocomplete(options),
  copy: (text) => copyTextToClipboard(text),
  status: (text) => setStatus(text),
  confirm: (text) => confirm(text),
  loadPrevious: () => loadSessions(void 0, { withPrevious: true }),
  selectSession: (id, options) => selectSession(id, options)
});
function updateRoutinesButton() {
  routinesController.updateButton();
}
function isRoutinesViewOpen() {
  return routinesController.isOpen();
}
function openRoutinesView() {
  routinesController.open();
}
function closeRoutinesView() {
  routinesController.close();
}
function refreshRoutinesView() {
  routinesController.refresh();
}
function routinesViewEscape() {
  return routinesController.escape();
}
function backToRoutinesList() {
  routinesController.back();
}
function selectRoutine(...args) {
  return routinesController.select(...args);
}
function startRoutineCreate() {
  routinesController.create();
}
function saveRoutine() {
  return routinesController.save();
}
function runRoutineNow() {
  return routinesController.run();
}
function deleteRoutine() {
  return routinesController.delete();
}
const bounceController = PiDishBrowser.createBounce({
  document,
  request: apiFetch,
  hosts: effectiveHosts,
  fleetReady: () => hostFleetReady,
  sessionState,
  refreshSessions,
  loadPrevious: () => loadSessions(void 0, { withPrevious: true }),
  selectSession
});
function isBounceViewOpen() {
  return bounceController.isOpen();
}
function closeBounceView() {
  bounceController.close();
}
function refreshBounceView() {
  return bounceController.refresh();
}
function selectBounceTargets(...args) {
  bounceController.select(...args);
}
function submitBounceTargets() {
  return bounceController.submit();
}
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
  searchKey: (event) => {
    if (event instanceof KeyboardEvent) handleSearchKey(event);
  },
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
  panelOpenSearch: () => {
    closeControlPanel();
    openSearch();
  },
  panelToggleTerminal: () => {
    closeControlPanel();
    toggleTerminal();
  },
  panelOpenDiffView: () => {
    closeControlPanel();
    openDiffView();
  },
  panelOpenArtifactsModal: () => {
    closeControlPanel();
    openArtifactsModal();
  },
  panelOpenTreeModal: () => {
    closeControlPanel();
    openTreeModal();
  },
  panelOpenSessionHarnessSettings: () => {
    closeControlPanel();
    openSessionHarnessSettings();
  },
  panelExportSession: () => {
    closeControlPanel();
    exportSession();
  },
  attachImage: () => document.getElementById("imageFileInput").click(),
  abortTurn: () => abortTurn(),
  sendSteer: () => sendSteer(),
  sendFollowUp: () => sendFollowUp(),
  sendPrompt: () => sendPrompt(),
  loadUsageView: () => loadUsageView(),
  closeUsageView: () => closeUsageView(),
  closeSearchView: () => closeSearchView(),
  closeNewSessionView: () => closeNewSessionView(),
  onNsHostChange: (_event, node) => {
    if (node instanceof HTMLSelectElement) onNsHostChange(node.value);
  },
  onNsHarnessChange: (_event, node) => {
    if (node instanceof HTMLSelectElement) onNsHarnessChange(node.value);
  },
  onNsModelChange: (_event, node) => {
    if (node instanceof HTMLSelectElement) onNsModelChange(node.value);
  },
  onNsThinkingChange: (_event, node) => {
    if (node instanceof HTMLSelectElement) onNsThinkingChange(node.value);
  },
  editHarnessAgents: () => openHarnessSettings({ tab: "agents" }),
  editHarnessModels: () => openHarnessSettings({ tab: "models" }),
  spawnNewSession: () => spawnNewSession(),
  refreshRoutinesView: () => refreshRoutinesView(),
  closeRoutinesView: () => closeRoutinesView(),
  loadRecoveryView: () => loadRecoveryView(),
  closeRecoveryView: () => closeRecoveryView(),
  backdropCloseTreeModal: (event, node) => {
    if (event.target === node) closeTreeModal();
  },
  closeTreeModal: () => closeTreeModal(),
  backdropCloseArtifactsModal: (event, node) => {
    if (event.target === node) closeArtifactsModal();
  },
  closeArtifactsModal: () => closeArtifactsModal(),
  backdropCloseRelationsModal: (event, node) => {
    if (event.target === node) closeRelationsModal();
  },
  closeRelationsModal: () => closeRelationsModal(),
  backdropCloseStatsModal: (event, node) => {
    if (event.target === node) closeStatsModal();
  },
  closeStatsModal: () => closeStatsModal(),
  backdropCloseSettingsModal: (event, node) => {
    if (event.target === node) closeSettingsModal();
  },
  closeSettingsModal: () => closeSettingsModal(),
  bounceToggle: (_event, node) => {
    if (node instanceof HTMLDetailsElement) {
      if (node.open) refreshBounceView();
      else closeBounceView();
    }
  },
  refreshBounceView: () => refreshBounceView(),
  bounceSelect: () => selectBounceTargets(true),
  bounceClear: () => selectBounceTargets(false),
  submitBounceTargets: () => submitBounceTargets(),
  backdropCloseHarnessSettings: (event, node) => {
    if (event.target === node) closeHarnessSettings();
  },
  closeHarnessSettings: () => closeHarnessSettings(),
  harnessTabAgents: () => showHarnessSettingsTab("agents"),
  harnessTabModels: () => showHarnessSettingsTab("models"),
  saveHarnessSettings: () => saveHarnessSettings(),
  backdropCloseResponseDetails: (event, node) => {
    if (event.target === node) closeResponseDetails();
  },
  closeResponseDetails: () => closeResponseDetails()
} });
