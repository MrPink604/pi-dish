// Generated from src/browser/; edit sources and run npm run build:browser.
var PiDishBrowser = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser/index.ts
  var index_exports = {};
  __export(index_exports, {
    APP_ACTION_NAMES: () => APP_ACTION_NAMES,
    ApiHttpError: () => ApiHttpError,
    HOST_BACKOFF_LADDER: () => HOST_BACKOFF_LADDER,
    HOST_BACKOFF_RESET_MS: () => HOST_BACKOFF_RESET_MS,
    HOST_COLOR_SLOTS: () => HOST_COLOR_SLOTS,
    NEW_SESSION_HARNESS_KEY: () => NEW_SESSION_HARNESS_KEY,
    NS_THINKING_LABELS: () => NS_THINKING_LABELS,
    applyCachedTheme: () => applyCachedTheme,
    assignHostColor: () => assignHostColor,
    clampSidebarWidth: () => clampSidebarWidth,
    clampTerminalHeight: () => clampTerminalHeight,
    copyTextToClipboard: () => copyTextToClipboard,
    createAnchoredComments: () => createAnchoredComments,
    createAppBindings: () => createAppBindings,
    createAppChrome: () => createAppChrome,
    createBounce: () => createBounce,
    createBrowserAssets: () => createBrowserAssets,
    createBtwPanel: () => createBtwPanel,
    createComposerAutocomplete: () => createComposerAutocomplete,
    createComposerDrafts: () => createComposerDrafts,
    createComposerImages: () => createComposerImages,
    createComposerNotes: () => createComposerNotes,
    createComposerSpeech: () => createComposerSpeech,
    createComposerSubmit: () => createComposerSubmit,
    createCwdAutocomplete: () => createCwdAutocomplete,
    createDiagrams: () => createDiagrams,
    createDirectoryCatalog: () => createDirectoryCatalog,
    createDirectoryTree: () => createDirectoryTree,
    createDisplayPreferences: () => createDisplayPreferences,
    createExtensionUI: () => createExtensionUI,
    createFileViews: () => createFileViews,
    createHarnessDiscovery: () => createHarnessDiscovery,
    createHarnessSettings: () => createHarnessSettings,
    createHostConnections: () => createHostConnections,
    createHostDirectory: () => createHostDirectory,
    createHostDiscovery: () => createHostDiscovery,
    createHostPresentation: () => createHostPresentation,
    createHostSessionLoader: () => createHostSessionLoader,
    createHostSettings: () => createHostSettings,
    createHostTransport: () => createHostTransport,
    createHostView: () => createHostView,
    createLiveTools: () => createLiveTools,
    createMessageRenderer: () => createMessageRenderer,
    createMessageStream: () => createMessageStream,
    createModelCatalog: () => createModelCatalog,
    createMood: () => createMood,
    createNewSession: () => createNewSession,
    createNewSessionConfigPreview: () => createNewSessionConfigPreview,
    createNewSessionPreferences: () => createNewSessionPreferences,
    createPanelResize: () => createPanelResize,
    createPromptDelivery: () => createPromptDelivery,
    createRecovery: () => createRecovery,
    createResponseDetails: () => createResponseDetails,
    createRichText: () => createRichText,
    createRoutinesView: () => createRoutinesView,
    createSearchView: () => createSearchView,
    createSessionActivity: () => createSessionActivity,
    createSessionApi: () => createSessionApi,
    createSessionControls: () => createSessionControls,
    createSessionHeader: () => createSessionHeader,
    createSessionInfo: () => createSessionInfo,
    createSessionReferences: () => createSessionReferences,
    createSessionRelations: () => createSessionRelations,
    createSessionResume: () => createSessionResume,
    createSessionSearch: () => createSessionSearch,
    createSessionSpawns: () => createSessionSpawns,
    createSessionState: () => createSessionState,
    createSessionView: () => createSessionView,
    createSidebarActivity: () => createSidebarActivity,
    createSidebarControls: () => createSidebarControls,
    createSidebarLists: () => createSidebarLists,
    createSidebarQuery: () => createSidebarQuery,
    createSkills: () => createSkills,
    createSpawnTargetPicker: () => createSpawnTargetPicker,
    createSpawnTargets: () => createSpawnTargets,
    createStreamingRenderer: () => createStreamingRenderer,
    createTerminalController: () => createTerminalController,
    createThemes: () => createThemes,
    createTranscript: () => createTranscript,
    createTranscriptCache: () => createTranscriptCache,
    createTranscriptTree: () => createTranscriptTree,
    createUsageView: () => createUsageView,
    decodeAnchoredComments: () => decodeAnchoredComments,
    decodeBounceOperation: () => decodeBounceOperation,
    decodeBounceOperations: () => decodeBounceOperations,
    decodeBouncePreview: () => decodeBouncePreview,
    decodeCommentIndex: () => decodeCommentIndex,
    decodeCommentTarget: () => decodeCommentTarget,
    decodeComposerImages: () => decodeComposerImages,
    decodeDiffPatch: () => decodeDiffPatch,
    decodeDiffView: () => decodeDiffView,
    decodeDirectoryChildren: () => decodeDirectoryChildren,
    decodeExtensionRequest: () => decodeExtensionRequest,
    decodeFileCompletions: () => decodeFileCompletions,
    decodeFilePreview: () => decodeFilePreview,
    decodeHarnessAgents: () => decodeHarnessAgents,
    decodeHarnessConfig: () => decodeHarnessConfig,
    decodeHarnessConfigPreview: () => decodeHarnessConfigPreview,
    decodeHostDescriptor: () => decodeHostDescriptor,
    decodeKnownDirectories: () => decodeKnownDirectories,
    decodeMessageContent: () => decodeMessageContent,
    decodeMessageUsage: () => decodeMessageUsage,
    decodeModelCatalog: () => decodeModelCatalog,
    decodePublishedPages: () => decodePublishedPages,
    decodeQueueData: () => decodeQueueData,
    decodeRecoveryMode: () => decodeRecoveryMode,
    decodeRecoveryReport: () => decodeRecoveryReport,
    decodeRenderMessage: () => decodeRenderMessage,
    decodeRoutine: () => decodeRoutine,
    decodeRoutineInvocations: () => decodeRoutineInvocations,
    decodeRoutineList: () => decodeRoutineList,
    decodeSavedFilters: () => decodeSavedFilters,
    decodeSearchPayload: () => decodeSearchPayload,
    decodeSessionRelations: () => decodeSessionRelations,
    decodeSessionSearch: () => decodeSessionSearch,
    decodeSessionShare: () => decodeSessionShare,
    decodeSessionStats: () => decodeSessionStats,
    decodeSkillCoverage: () => decodeSkillCoverage,
    decodeSkillDirectory: () => decodeSkillDirectory,
    decodeSlashCommands: () => decodeSlashCommands,
    decodeSpawnChoices: () => decodeSpawnChoices,
    decodeSpawnId: () => decodeSpawnId,
    decodeSpawnStatus: () => decodeSpawnStatus,
    decodeTerminalOutput: () => decodeTerminalOutput,
    decodeThemeTokens: () => decodeThemeTokens,
    decodeThemes: () => decodeThemes,
    decodeTranscriptPage: () => decodeTranscriptPage,
    decodeTranscriptTree: () => decodeTranscriptTree,
    decodeUsageLimits: () => decodeUsageLimits,
    decodeUsageSummary: () => decodeUsageSummary,
    findQuoteOffset: () => findQuoteOffset,
    groupToolActivity: () => groupToolActivity,
    harnessBadgeInnerHtml: () => harnessBadgeInnerHtml,
    hostConnReduce: () => hostConnReduce,
    hostKeyOf: () => hostKeyOf,
    hostSettingsHtml: () => hostSettingsHtml,
    markCommentQuote: () => markCommentQuote,
    mergeComposerText: () => mergeComposerText,
    mergeHostEntries: () => mergeHostEntries,
    mergeSearchPayloads: () => mergeSearchPayloads,
    modelCatalogUrl: () => modelCatalogUrl,
    modelHiddenNote: () => modelHiddenNote,
    modelSelectOptionsHtml: () => modelSelectOptionsHtml,
    modelsCacheKey: () => modelsCacheKey,
    mountModelSelector: () => mountModelSelector,
    mountThinkingSelector: () => mountThinkingSelector,
    normalizeHostBase: () => normalizeHostBase,
    queryHosts: () => queryHosts,
    reconcileHostCatalog: () => reconcileHostCatalog,
    renderDiffViewHtml: () => renderDiffViewHtml,
    renderHarnessBadge: () => renderHarnessBadge,
    renderSidebar: () => renderSidebar,
    resolveColorToHex: () => resolveColorToHex,
    responseMode: () => responseMode,
    rgbStringToHex: () => rgbStringToHex,
    sameDirectoryHost: () => sameDirectoryHost,
    sanitizeHostCatalog: () => sanitizeHostCatalog,
    sanitizeHostColorOrder: () => sanitizeHostColorOrder,
    sanitizeHostColors: () => sanitizeHostColors,
    selectionTextAnchor: () => selectionTextAnchor,
    sendJson: () => sendJson,
    sessionSpawnKey: () => sessionSpawnKey,
    sidebarSession: () => sidebarSession,
    spawnTargetKey: () => spawnTargetKey,
    terminalTheme: () => terminalTheme,
    updateToolGroupSummary: () => updateToolGroupSummary,
    withFetchTimeout: () => withFetchTimeout
  });

  // src/core/session-api.ts
  function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function text(value) {
    return typeof value === "string" && value.length > 0;
  }
  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function invalid(kind) {
    throw new Error(`Invalid ${kind} response`);
  }
  function decodeSessionMetadata(value) {
    if (!record(value) || !text(value.id)) return invalid("session");
    for (const key of ["name", "model", "thinkingLevel"]) {
      if (value[key] !== void 0 && value[key] !== null && typeof value[key] !== "string") return invalid("session");
    }
    if (value.harnessId !== void 0 && !text(value.harnessId)) return invalid("session");
    if (value.isActive !== void 0 && typeof value.isActive !== "boolean") return invalid("session");
    let capabilities;
    if (value.capabilities !== void 0) {
      if (!record(value.capabilities)) return invalid("session capabilities");
      capabilities = {};
      for (const [key, enabled] of Object.entries(value.capabilities)) {
        if (typeof enabled !== "boolean") return invalid("session capabilities");
        Object.defineProperty(capabilities, key, { value: enabled, enumerable: true, configurable: true, writable: true });
      }
    }
    return { ...value, ...capabilities ? { capabilities } : {} };
  }
  function decodeSessionList(value) {
    if (!record(value) || !Array.isArray(value.active) || !Array.isArray(value.previous) || value.children !== void 0 && !Array.isArray(value.children)) return invalid("session list");
    return {
      ...value,
      active: value.active.map(decodeSessionMetadata),
      previous: value.previous.map(decodeSessionMetadata),
      ...Array.isArray(value.children) ? { children: value.children.map(decodeSessionMetadata) } : {}
    };
  }
  function pricing(value) {
    if (!record(value) || !finite(value.input) || !finite(value.output)) return null;
    return {
      input: value.input,
      output: value.output,
      ...finite(value.cacheRead) ? { cacheRead: value.cacheRead } : {},
      ...finite(value.cacheWrite) ? { cacheWrite: value.cacheWrite } : {}
    };
  }
  var THINKING_LEVELS = /* @__PURE__ */ new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
  function normalizeModels(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (typeof item === "string") {
        const slash = item.indexOf("/");
        if (slash <= 0 || slash === item.length - 1) return [];
        const provider = item.slice(0, slash), id2 = item.slice(slash + 1);
        return [{
          id: id2,
          provider,
          name: id2,
          selector: item,
          contextWindow: 0,
          reasoning: false,
          thinking: null,
          pricing: null,
          free: false
        }];
      }
      if (!record(item)) return [];
      const id = item.id || item.modelId;
      if (!text(id) || !text(item.provider)) return [];
      const cost = pricing(item.pricing || item.cost);
      return [{
        id,
        provider: item.provider,
        name: text(item.name) ? item.name : id,
        selector: text(item.selector) ? item.selector : `${item.provider}/${id}`,
        contextWindow: finite(item.contextWindow) ? item.contextWindow : 0,
        reasoning: !!item.reasoning,
        thinking: Array.isArray(item.thinking) ? item.thinking.filter((level) => typeof level === "string" && THINKING_LEVELS.has(level)) : null,
        pricing: cost,
        free: !!cost && cost.input === 0 && cost.output === 0
      }];
    });
  }
  function decodeModelCatalog(value) {
    if (!Array.isArray(value)) return invalid("model catalog");
    return value.map((item) => {
      if (!record(item) || !text(item.id) || !text(item.provider)) return invalid("model catalog");
      if (item.enabled !== void 0 && typeof item.enabled !== "boolean") return invalid("model catalog");
      if (item.selector !== void 0 && item.selector !== null && typeof item.selector !== "string") return invalid("model catalog");
      const model = normalizeModels([item])[0];
      return { ...item, ...model, ...item.enabled === void 0 ? {} : { enabled: item.enabled } };
    });
  }
  function decodeMutationResult(value) {
    if (!record(value) || value.success !== true) return invalid("mutation");
    return { ...value, success: true };
  }
  function decodeThinkingResult(value) {
    const result = decodeMutationResult(value);
    if (!text(result.level)) return invalid("thinking");
    return { ...result, level: result.level };
  }
  function decodeEnabledModelsResult(value) {
    const result = decodeMutationResult(value);
    if (result.enabledModels !== null && (!Array.isArray(result.enabledModels) || !result.enabledModels.every(text))) return invalid("enabled models");
    return { ...result, enabledModels: result.enabledModels === null ? null : [...result.enabledModels] };
  }

  // src/browser/api-client.ts
  var ApiHttpError = class extends Error {
    constructor(message3, status) {
      super(message3);
      this.status = status;
      this.name = "ApiHttpError";
    }
    status;
  };
  function withFetchTimeout(options2) {
    const { timeoutMs, ...init } = options2;
    if (!init.signal && typeof timeoutMs === "number" && timeoutMs > 0 && typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    return init;
  }
  function createHostTransport(options2) {
    const request = (host, path, init = {}) => {
      const { base, token } = options2.resolveHost(host);
      const requestInit = withFetchTimeout(init);
      if (token) {
        const headers = new Headers(requestInit.headers);
        headers.set("Authorization", `Bearer ${token}`);
        requestInit.headers = headers;
      }
      return options2.fetch(base + path, requestInit);
    };
    return { request };
  }
  async function jsonResponse(response, fallback2) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = data && typeof data === "object" && "error" in data ? data.error : null;
      throw new ApiHttpError(typeof error === "string" && error ? error : `${fallback2} (${response.status})`, response.status);
    }
    return data;
  }
  async function sendJson(request, host, path, body, method = "POST") {
    const response = await request(host, path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    return jsonResponse(response, "request failed");
  }
  function modelCatalogUrl(harnessId, cwd) {
    const params = new URLSearchParams({ harness: harnessId });
    if (cwd) params.set("cwd", cwd);
    return "/api/models?" + params.toString();
  }
  function createSessionApi(request) {
    function mutate(owner, operation, body) {
      const { host, id } = owner;
      return sendJson(request, host, `/api/sessions/${encodeURIComponent(id)}/${operation}`, body);
    }
    return {
      async list(host, path, options2) {
        return decodeSessionList(await jsonResponse(await request(host, path, options2), "HTTP request failed"));
      },
      async models(host, options2 = {}) {
        const { sessionId, harnessId = "pi", cwd } = options2;
        const path = sessionId ? "/api/models?sessionId=" + encodeURIComponent(sessionId) : harnessId !== "pi" ? modelCatalogUrl(harnessId, cwd) : "/api/models";
        return decodeModelCatalog(await jsonResponse(await request(host, path), "Model catalog request failed"));
      },
      async setModel(owner, modelId) {
        const body = { modelId };
        return decodeMutationResult(await mutate(owner, "model", body));
      },
      async setThinking(owner, level) {
        const body = { level };
        return decodeThinkingResult(await mutate(owner, "thinking", body));
      },
      async rename(owner, name) {
        return decodeMutationResult(await mutate(owner, "rename", { name }));
      },
      async setEnabledModels(enabledIds) {
        const body = { enabledIds: enabledIds && [...enabledIds] };
        return decodeEnabledModelsResult(await sendJson(request, null, "/api/models/enabled", body, "PUT"));
      }
    };
  }

  // src/browser/model-selector.ts
  function mountModelSelector(root, actions, formatTokens2) {
    const doc = root.ownerDocument;
    let view = null;
    let disposed = false;
    function element(tag, className, text17) {
      const node = doc.createElement(tag);
      node.className = className;
      if (text17 !== void 0) node.textContent = text17;
      return node;
    }
    const search = element("input", "model-search");
    search.type = "text";
    search.placeholder = "Search models...";
    const results = element("div", "model-results");
    const footer = element("div", "model-dropdown-footer");
    root.replaceChildren(search, results, footer);
    function active(model, current) {
      return model.id === current || `${model.provider}/${model.id}` === current;
    }
    function action(node, name, value = "") {
      node.dataset.action = name;
      node.dataset.value = value;
      return node;
    }
    function button(text17, name, value = "", primary = false) {
      const node = element("button", "model-footer-btn" + (primary ? " primary" : ""), text17);
      node.type = "button";
      return action(node, name, value);
    }
    function update(next) {
      if (disposed) return;
      view = { ...next, models: next.models.map((model) => ({ ...model })) };
      const { models, currentModel, query, editMode, harnessId } = view;
      if (search.value !== query) search.value = query;
      const q = query.toLowerCase();
      const filtered = models.filter((model) => !q || [model.id, model.provider, model.name].some((value) => value.toLowerCase().includes(q)));
      const visible = editMode ? filtered : filtered.filter((model) => model.enabled !== false || active(model, currentModel));
      const hidden = filtered.length - visible.length;
      const groups = /* @__PURE__ */ new Map();
      for (const model of visible) {
        const group = groups.get(model.provider) || [];
        group.push(model);
        groups.set(model.provider, group);
      }
      const fragment = doc.createDocumentFragment();
      for (const provider of [...groups.keys()].sort()) {
        const group = groups.get(provider);
        const header = element("div", "model-group-header" + (editMode ? " model-group-toggle" : ""));
        if (editMode) {
          const on = group.filter((model) => model.enabled !== false).length;
          action(header, "provider", provider);
          header.title = `Toggle all ${provider} models`;
          header.append(
            element("span", "model-check", on === group.length ? "\u2713" : on ? "\u2013" : ""),
            doc.createTextNode(provider),
            element("span", "model-group-count", `${on}/${group.length}`)
          );
        } else header.textContent = provider;
        fragment.append(header);
        for (const model of group) {
          const on = model.enabled !== false;
          const fullId = `${model.provider}/${model.id}`;
          const row = element("div", "model-option" + (active(model, currentModel) ? " active" : "") + (editMode && !on ? " disabled" : ""));
          row.title = fullId;
          action(row, editMode ? "toggle" : "select", fullId);
          if (editMode) row.append(element("span", "model-check", on ? "\u2713" : ""));
          const copy = element("span", "model-option-copy");
          copy.append(
            element("span", "model-option-name", model.id),
            element("span", "model-option-context", model.contextWindow ? `${formatTokens2(model.contextWindow)} context` : "context unknown")
          );
          row.append(copy);
          if (model.free) row.append(element("span", "model-badge free", "free"));
          if (model.reasoning) row.append(element("span", "model-badge reasoning", "\u{1F9E0}"));
          fragment.append(row);
        }
      }
      if (!visible.length) {
        const empty = element("div", "model-option", "No models found");
        empty.style.color = "var(--text-muted)";
        empty.style.cursor = "default";
        fragment.append(empty);
      }
      const scrollTop = results.scrollTop;
      results.replaceChildren(fragment);
      results.scrollTop = scrollTop;
      footer.replaceChildren();
      if (editMode) {
        footer.append(
          element("span", "model-footer-info", `${models.filter((model) => model.enabled !== false).length} of ${models.length} enabled`),
          button("All", "all", "true"),
          button("None", "all", "false"),
          button("Done", "edit", "false", true)
        );
      } else {
        if (hidden) footer.append(element("span", "model-footer-info", `${hidden} hidden`));
        if (harnessId === "pi") {
          const edit = button("\u2699 Edit models", "edit", "true");
          edit.title = "Choose which models are enabled (pi scoped models)";
          footer.append(edit);
        }
      }
    }
    function onInput(event) {
      if (view && event.target === search) actions.queryChanged(view.owner, search.value);
    }
    function onKeydown(event) {
      if (view && event.key === "Escape") actions.requestClose(view.owner);
    }
    function onClick(event) {
      const target = event.target;
      if (!view || !(target instanceof Element)) return;
      const node = target.closest("[data-action]");
      if (!node || !root.contains(node)) return;
      const { owner } = view;
      const value = node.dataset.value || "";
      switch (node.dataset.action) {
        case "select":
          actions.selectModel(owner, value);
          break;
        case "toggle":
          actions.toggleModel(owner, value);
          break;
        case "provider":
          actions.toggleProvider(owner, value);
          break;
        case "all":
          actions.setAllEnabled(owner, value === "true");
          break;
        case "edit":
          actions.editModeChanged(owner, value === "true");
          break;
      }
    }
    root.addEventListener("input", onInput);
    root.addEventListener("keydown", onKeydown);
    root.addEventListener("click", onClick);
    return {
      update,
      focusSearch() {
        if (!disposed) search.focus();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        view = null;
        root.removeEventListener("input", onInput);
        root.removeEventListener("keydown", onKeydown);
        root.removeEventListener("click", onClick);
        root.replaceChildren();
      }
    };
  }

  // src/browser/session-state.ts
  function createSessionState(options2) {
    let sessions = { active: [], previous: [] };
    let currentSession = null;
    let generation = 0;
    function findSession(id, host) {
      if (!host && currentSession && currentSession.id === id) host = currentSession.host;
      let found;
      for (const list of [sessions.active, sessions.previous]) {
        for (const session of list) {
          if (session.id !== id || host && (session.host || null) !== host) continue;
          if (found && (found.host || null) !== (session.host || null)) return void 0;
          if (!found) found = session;
        }
      }
      return found;
    }
    function sessionHostId(id) {
      if (id && currentSession?.id === id && currentSession.host) return currentSession.host;
      return findSession(id)?.host || options2.getSelfHostId();
    }
    function stampSessionHost(session, hostId = options2.getSelfHostId()) {
      if (!session.host && hostId) session.host = hostId;
      const label = options2.getHostLabel(session.host || hostId);
      if (label) session.hostLabel = label;
      return session;
    }
    function setSessionLists(next, hostId = options2.getSelfHostId()) {
      const parts = Array.isArray(next) ? next : [{ hostId, active: next.active, previous: next.previous }];
      const merged = { active: [], previous: [] };
      for (const part of parts) {
        for (const session of part.active || []) merged.active.push(stampSessionHost(session, part.hostId));
        for (const session of part.previous || []) merged.previous.push(stampSessionHost(session, part.hostId));
      }
      sessions = merged;
      if (currentSession) {
        const fresh = findSession(currentSession.id, currentSession.host);
        if (fresh) currentSession = { ...currentSession, ...fresh };
      }
      options2.onListsChanged();
      options2.onCurrentChanged();
    }
    function setCurrentSession(id, host) {
      const entry = findSession(id, host);
      currentSession = entry ? stampSessionHost({ ...entry }) : null;
      return currentSession;
    }
    function patchSession(id, patch, host = sessionHostId(id)) {
      const matches = (session) => session !== null && session.id === id && (session.host || null) === (host || null);
      for (const list of [sessions.active, sessions.previous]) {
        const session = list.find(matches);
        if (session) stampSessionHost(Object.assign(session, patch));
      }
      if (matches(currentSession) && currentSession) stampSessionHost(Object.assign(currentSession, patch));
      options2.onListsChanged();
      if (matches(currentSession)) options2.onCurrentChanged();
    }
    function mergeCurrentSession(owner, fields) {
      if (!fields || !ownsSelection(owner) || !currentSession) return;
      const { id, host } = currentSession;
      Object.assign(currentSession, fields);
      currentSession.id = id;
      currentSession.host = host;
      stampSessionHost(currentSession);
      options2.onCurrentChanged();
    }
    function advanceSelection() {
      generation += 1;
    }
    function captureSelection() {
      return currentSession ? Object.freeze({ id: currentSession.id, host: currentSession.host || null, generation }) : null;
    }
    function ownsSelection(owner) {
      return !!owner && !!currentSession && owner.id === currentSession.id && owner.host === (currentSession.host || null) && owner.generation === generation;
    }
    return {
      get sessions() {
        return sessions;
      },
      get currentSession() {
        return currentSession;
      },
      get selectionGeneration() {
        return generation;
      },
      findSession,
      sessionHostId,
      setSessionLists,
      setCurrentSession,
      patchSession,
      mergeCurrentSession,
      advanceSelection,
      captureSelection,
      ownsSelection
    };
  }

  // src/browser/host-connections.ts
  var HOST_BACKOFF_LADDER = [3e3, 4e3, 8e3, 16e3];
  var HOST_BACKOFF_RESET_MS = 3e4;
  function hostKeyOf(host) {
    return host && (host.key || host.hostId || host.base) || "self";
  }
  function hostConnReduce(prev, event, now) {
    const at = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
    const kind = typeof event === "string" ? event : event && typeof event === "object" && "type" in event && event.type || "";
    const state = prev && typeof prev === "object" ? prev : null;
    const errText = (value) => {
      if (value == null) return null;
      const text17 = String(typeof value === "object" && "message" in value && value.message || value);
      return text17 || null;
    };
    const eventError = event && typeof event === "object" && "error" in event ? errText(event.error) : null;
    if (kind === "blocked") {
      if (state && state.state === "blocked") return state;
      return { state: "blocked", failures: 0, retryAt: 0, error: "Unauthorized", reachableSince: 0 };
    }
    if (kind === "success") {
      const since = state && state.state === "reachable" && state.reachableSince ? state.reachableSince : at;
      const forgiven = at - since >= HOST_BACKOFF_RESET_MS;
      return {
        state: "reachable",
        failures: forgiven ? 0 : state && state.failures || 0,
        retryAt: 0,
        error: null,
        reachableSince: since
      };
    }
    if (kind === "failure") {
      if (state && state.state === "blocked") return state;
      const failures = (state && state.failures || 0) + 1;
      const wait = HOST_BACKOFF_LADDER[Math.min(failures - 1, HOST_BACKOFF_LADDER.length - 1)];
      return { state: "backoff", failures, retryAt: at + wait, error: eventError, reachableSince: 0 };
    }
    if (kind === "seed-down") {
      if (state) return state;
      return { state: "backoff", failures: 1, retryAt: at + HOST_BACKOFF_LADDER[0], error: eventError, reachableSince: 0 };
    }
    return state;
  }
  function createHostConnections(options2) {
    const records = /* @__PURE__ */ new Map();
    const now = options2.now || Date.now;
    function stateOf(host) {
      const entry = records.get(hostKeyOf(host));
      if (entry) return entry.state;
      if (host && host.self) return "reachable";
      if (host && host.reachable === false) return "backoff";
      return "connecting";
    }
    function isDown(host) {
      const state = stateOf(host);
      return state === "backoff" || state === "blocked";
    }
    function note(host, event) {
      const key = hostKeyOf(host);
      const prev = records.get(key) || null;
      const next = hostConnReduce(prev, event, now());
      if (!next || next === prev) return;
      records.set(key, next);
      if (!prev || prev.state !== next.state || prev.error !== next.error) options2.onChange();
    }
    function seed(hosts) {
      const at = now();
      for (const host of hosts) {
        if (host.self || host.reachable !== false) continue;
        const key = hostKeyOf(host);
        if (records.has(key)) continue;
        const next = hostConnReduce(null, { type: "seed-down", error: host.error || "unreachable" }, at);
        if (next) records.set(key, next);
      }
    }
    function pollable(hosts) {
      const at = now();
      return hosts.filter((host) => {
        if (host.self) return true;
        const entry = records.get(hostKeyOf(host));
        if (!entry) return true;
        if (entry.state === "blocked") return false;
        return !entry.retryAt || entry.retryAt <= at;
      });
    }
    function reset(key) {
      records.delete(key);
    }
    function prune(liveKeys) {
      for (const key of records.keys()) if (!liveKeys.has(key)) records.delete(key);
    }
    return { stateOf, isDown, note, seed, pollable, reset, prune };
  }

  // src/browser/host-session-loader.ts
  function mergeLiveSubagents(previous, children) {
    const fresh = new Map((children || []).map((session) => [session.id, session]));
    const merged = (previous || []).map((session) => {
      const live = fresh.get(session.id);
      if (live) {
        fresh.delete(session.id);
        return { ...session, ...live };
      }
      return session.subagentLive ? { ...session, subagentLive: false } : session;
    });
    for (const session of fresh.values()) merged.push(session);
    return merged;
  }
  function mergeActiveHints(active, previousActive) {
    const prior = new Map(previousActive.map((session) => [session.id, session]));
    return active.map((session) => {
      const old = prior.get(session.id);
      if (!old) return session;
      const preserveParent = !session.parentId && old.parentId;
      const preserveFamily = !session.familyParentId && old.familyParentId;
      return preserveParent || preserveFamily ? {
        ...session,
        ...preserveParent ? { parentId: old.parentId, parentSource: old.parentSource } : {},
        ...preserveFamily ? { familyParentId: old.familyParentId } : {}
      } : session;
    });
  }
  function createHostSessionLoader(options2) {
    const caches = /* @__PURE__ */ new Map();
    const owners = /* @__PURE__ */ new Map();
    const inflight = /* @__PURE__ */ new Map();
    const indexing = /* @__PURE__ */ new Map();
    function load(host, query, withPrevious, sequence) {
      const target = Object.freeze({ ...host });
      const key = hostKeyOf(target);
      const wireQuery = options2.stripHostQuery(query);
      const pending = inflight.get(key);
      if (pending && pending.wireQuery === wireQuery && pending.withPrevious === withPrevious && pending.host.base === target.base && pending.host.token === target.token && pending.host.hostId === target.hostId) {
        pending.owner.sequence = sequence;
        pending.owner.query = query || "";
        return pending.promise;
      }
      const owner = { sequence, query: query || "" };
      owners.set(key, owner);
      const promise = run(target, key, wireQuery, withPrevious, owner).finally(() => {
        if (inflight.get(key)?.promise === promise) inflight.delete(key);
      });
      inflight.set(key, { host: target, owner, promise, wireQuery, withPrevious });
      return promise;
    }
    async function run(host, key, wireQuery, withPrevious, owner) {
      try {
        const params = new URLSearchParams();
        if (wireQuery) params.set("q", wireQuery);
        if (!withPrevious) params.set("active", "1");
        params.set("view", "client");
        const data = await options2.requestList(host, "/api/sessions?" + params.toString(), { timeoutMs: 2e4 });
        if (owners.get(key) !== owner) return;
        options2.onConnection(host, "success");
        if (owner.sequence !== options2.currentSequence()) return;
        const cached = caches.get(key) || { active: [], previous: [] };
        if (withPrevious) {
          indexing.set(key, !!data.indexing);
          if (data.indexing) options2.onIndexing();
        }
        const next = {
          active: withPrevious ? data.active : mergeActiveHints(data.active, cached.active),
          previous: withPrevious ? data.previous : mergeLiveSubagents(cached.previous, data.children)
        };
        options2.beforePublish(host, next, wireQuery);
        caches.set(key, next);
        options2.onPublish(owner.query);
      } catch (error) {
        if (owners.get(key) !== owner) return;
        if (error instanceof ApiHttpError && error.status === 401) {
          options2.onConnection(host, "blocked");
          options2.onPublish();
          return;
        }
        options2.onConnection(host, { type: "failure", error });
        options2.onError(host, error);
        if (owner.sequence === options2.currentSequence()) options2.onPublish();
      }
    }
    function getCache(host) {
      return caches.get(hostKeyOf(host));
    }
    function isIndexing() {
      return [...indexing.values()].some(Boolean);
    }
    function prune(liveKeys) {
      for (const map of [caches, owners, inflight, indexing]) {
        for (const key of map.keys()) if (!liveKeys.has(key)) map.delete(key);
      }
    }
    return { load, getCache, isIndexing, prune, retireRequests() {
      owners.clear();
      inflight.clear();
    } };
  }

  // src/browser/thinking-selector.ts
  function mountThinkingSelector(root, actions) {
    let view = null;
    let disposed = false;
    function update(next) {
      if (disposed) return;
      const levels = [...next.levels];
      if (next.currentLevel && !levels.includes(next.currentLevel)) levels.push(next.currentLevel);
      view = { owner: next.owner, levels, currentLevel: next.currentLevel };
      const fragment = root.ownerDocument.createDocumentFragment();
      for (const level of levels) {
        const button = root.ownerDocument.createElement("button");
        button.type = "button";
        const active = level === next.currentLevel;
        button.className = "thinking-option" + (active ? " active" : "");
        button.setAttribute("aria-pressed", String(active));
        button.dataset.level = level;
        button.textContent = level;
        fragment.append(button);
      }
      root.replaceChildren(fragment);
    }
    function onClick(event) {
      if (!view || !(event.target instanceof Element)) return;
      const button = event.target.closest("button.thinking-option");
      if (!button || !root.contains(button)) return;
      actions.selectLevel(view.owner, button.dataset.level || "");
    }
    function onKeydown(event) {
      if (view && event.key === "Escape") actions.requestClose(view.owner);
    }
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeydown);
    return {
      update,
      dispose() {
        if (disposed) return;
        disposed = true;
        view = null;
        root.removeEventListener("click", onClick);
        root.removeEventListener("keydown", onKeydown);
        root.replaceChildren();
      }
    };
  }

  // src/browser/host-catalog.ts
  function object(value) {
    return value !== null && typeof value === "object";
  }
  function text2(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  function normalizeHostBase(input) {
    if (input == null) return "";
    const raw = String(input).trim();
    if (!raw) return "";
    if (/\s/.test(raw)) return null;
    const segmentsOk = (path2) => path2.split("/").filter(Boolean).every((seg) => seg !== "." && seg !== ".." && /^[\w.~%\-]+$/.test(seg));
    if (raw.startsWith("/")) {
      if (!segmentsOk(raw)) return null;
      return raw.replace(/\/+$/, "");
    }
    if (!/^https?:\/\//i.test(raw)) return null;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!url.hostname) return null;
    const path = url.pathname.replace(/\/+$/, "");
    if (!segmentsOk(path)) return null;
    return url.origin + path;
  }
  function sanitizeHostCatalog(raw) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    if (!Array.isArray(raw)) return out;
    const rows = raw;
    for (const item of rows) {
      if (!object(item)) continue;
      let base;
      try {
        base = normalizeHostBase(item.base);
      } catch {
        continue;
      }
      if (!base) continue;
      const hostId = text2(item.hostId);
      const dedupe = hostId || base;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const entry = { base };
      if (hostId) entry.hostId = hostId;
      const label = text2(item.label);
      if (label) entry.label = label;
      const token = text2(item.token);
      if (token) entry.token = token;
      out.push(entry);
    }
    return out;
  }
  function reconcileHostCatalog(current) {
    return sanitizeHostCatalog(current).map((normalized) => {
      const source = current.find((row) => row.base === normalized.base);
      if (!source) return normalized;
      const keys = Object.keys(source);
      if (keys.length !== Object.keys(normalized).length) return normalized;
      for (const key of keys) {
        if (key !== "base" && key !== "hostId" && key !== "label" && key !== "token") return normalized;
        if (source[key] !== normalized[key]) return normalized;
      }
      return source;
    });
  }
  function mergeHostEntries(self, fleet, catalog) {
    const out = [];
    const byId = /* @__PURE__ */ new Map();
    const byBase = /* @__PURE__ */ new Map();
    function absorb(into, extra) {
      function field(key) {
        if (into[key] == null && extra[key] != null) into[key] = extra[key];
      }
      for (const key of ["label", "name", "token", "version", "capabilities", "kind", "error"]) field(key);
    }
    function push(entry) {
      const hostId = text2(entry.hostId);
      const base = entry.base;
      const existing = hostId && byId.get(hostId) || byBase.get(base);
      if (existing) {
        absorb(existing, entry);
        return;
      }
      const merged = { ...entry, base, hostId: hostId || null, key: hostId || base || "self" };
      if (hostId) byId.set(hostId, merged);
      byBase.set(base, merged);
      out.push(merged);
    }
    push({
      hostId: text2(self && self.hostId),
      base: "",
      label: self && self.label || null,
      version: self && self.version || null,
      capabilities: self && self.capabilities || null,
      source: "self",
      self: true,
      reachable: true
    });
    const rows = Array.isArray(fleet) ? fleet : [];
    for (const entry of rows) {
      if (!object(entry) || entry.self) continue;
      let base;
      try {
        base = normalizeHostBase(entry.base);
      } catch {
        continue;
      }
      if (base == null) continue;
      push({
        hostId: text2(entry.hostId),
        base,
        label: text2(entry.label),
        name: text2(entry.name),
        kind: text2(entry.kind),
        version: entry.version || null,
        capabilities: entry.capabilities || null,
        reachable: entry.reachable !== false,
        error: text2(entry.error),
        source: "fleet"
      });
    }
    for (const entry of sanitizeHostCatalog(catalog)) push({ ...entry, hostId: entry.hostId || null, source: "user" });
    return out;
  }

  // src/browser/harness-discovery.ts
  function decodeRows(data) {
    if (!data || typeof data !== "object" || !("harnesses" in data) || !Array.isArray(data.harnesses)) return [];
    const rows = data.harnesses;
    return rows.flatMap((value) => {
      if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !value.id) return [];
      const row = {
        ...value,
        id: value.id,
        label: "label" in value && typeof value.label === "string" ? value.label : void 0
      };
      return [row];
    });
  }
  var fallback = () => [{ id: "pi", label: "Pi", available: true }];
  function createHarnessDiscovery(options2) {
    let rows = fallback();
    let sequence = 0;
    const cache = /* @__PURE__ */ new Map();
    const pending = /* @__PURE__ */ new Map();
    const cacheOwners = /* @__PURE__ */ new Map();
    const keyOf = (host) => host || options2.selfHostId();
    async function load() {
      const host = options2.selectedHostId();
      const key = keyOf(host);
      const seq = ++sequence;
      const ownsDiscovery = () => seq === sequence && host === options2.selectedHostId();
      try {
        const data = await options2.requestPicker(host);
        if (!ownsDiscovery()) return;
        if (data == null) throw new Error("Missing harness catalog");
        const discovered = decodeRows(data);
        if (discovered.length) {
          rows = discovered;
          cache.set(key, discovered);
          cacheOwners.set(key, {});
          options2.onCacheChange();
          const preferred = options2.preferredHarness();
          if (preferred && rows.some((row) => row.id === preferred && row.available !== false)) {
            options2.onPreferredHarness(preferred);
          }
        }
      } catch {
        if (!ownsDiscovery()) return;
        rows = fallback();
      }
      options2.onPickerChange();
    }
    function ensure(host) {
      const key = keyOf(host);
      if (cache.has(key)) return Promise.resolve();
      const existing = pending.get(key);
      if (existing) return existing;
      const owner = {};
      cacheOwners.set(key, owner);
      const request = (async () => {
        try {
          const data = await options2.requestBackground(key);
          if (cacheOwners.get(key) !== owner) return;
          cache.set(key, decodeRows(data));
          options2.onCacheChange();
        } catch {
        }
      })().finally(() => {
        pending.delete(key);
      });
      pending.set(key, request);
      return request;
    }
    return {
      load,
      ensure,
      rows: () => rows,
      cachedRows: (host) => cache.get(keyOf(host)),
      row: (host, harness) => cache.get(keyOf(host))?.find((row) => row.id === harness) || null
    };
  }

  // src/browser/host-discovery.ts
  var REFRESH_MS = 6e4;
  function record2(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function decodeHostDescriptor(value) {
    if (!record2(value) || typeof value.hostId !== "string" || !value.hostId) return null;
    return {
      hostId: value.hostId,
      label: value.label || null,
      version: value.version || null,
      capabilities: value.capabilities || null
    };
  }
  function createHostDiscovery(options2) {
    const descriptors = /* @__PURE__ */ new Map();
    const requests = /* @__PURE__ */ new Map();
    const now = options2.now || Date.now;
    let selfSequence = 0;
    let fleetSequence = 0;
    let fleetPublication = 0;
    let fleetPending = null;
    let fleetRequestedAt = 0;
    function rememberDescriptor(value) {
      const descriptor = decodeHostDescriptor(value);
      if (descriptor) descriptors.set(descriptor.hostId, descriptor);
      return descriptor;
    }
    async function loadIdentity() {
      const sequence = ++selfSequence;
      try {
        const response = await options2.requestSelf();
        if (!response.ok) return;
        const descriptor = decodeHostDescriptor(await response.json());
        if (sequence === selfSequence && descriptor) options2.onSelf(descriptor);
      } catch {
      }
    }
    async function identify(refresh = false) {
      const pending = options2.pollableHosts().filter((host) => !host.self && (!host.hostId || host.source === "user" && (refresh || !descriptors.has(host.hostId))));
      await Promise.allSettled(pending.map(async (host) => {
        const captured = Object.freeze({ ...host });
        const source = options2.sourceFor(captured);
        if (!source) return;
        const sourceFields = { base: source.base, hostId: source.hostId, token: source.token };
        const owner = {};
        requests.set(source, owner);
        const ownsSource = () => requests.get(source) === owner && options2.sourceFor(captured) === source && source.base === sourceFields.base && source.token === sourceFields.token;
        const owns = () => ownsSource() && source.hostId === sourceFields.hostId && options2.hosts().some((current) => current.base === captured.base && current.hostId === captured.hostId && current.source === captured.source && current.token === captured.token);
        let applying = false;
        try {
          const response = await options2.request(captured, "/api/host", { timeoutMs: 8e3 });
          if (!owns()) return;
          if (response.status === 401) {
            options2.onConnection(captured, "blocked");
            return;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const descriptor = decodeHostDescriptor(await response.json());
          if (!owns() || !descriptor) return;
          descriptors.set(descriptor.hostId, descriptor);
          applying = true;
          options2.onIdentified(host, source, descriptor);
          options2.onConnection(host, "success");
        } catch (error) {
          if (applying ? ownsSource() : owns()) options2.onConnection(captured, { type: "failure", error });
        } finally {
          if (requests.get(source) === owner) requests.delete(source);
        }
      }));
    }
    async function performFleet(sequence) {
      try {
        const response = await options2.request(null, "/api/hosts", { timeoutMs: 1e4 });
        if (!response.ok) return;
        const data = await response.json();
        if (sequence !== fleetSequence || !record2(data) || !Array.isArray(data.hosts)) return;
        const rows = data.hosts;
        const hosts = rows.filter(record2);
        fleetPublication = sequence;
        options2.onFleet({ hosts: hosts.filter((host) => !host.self), selfLabel: hosts.find((host) => host.self)?.label });
        await identify(true);
        if (sequence === fleetPublication) options2.afterFleet();
      } catch {
      }
    }
    async function loadFleet() {
      fleetRequestedAt = now();
      let work = performFleet(++fleetSequence);
      fleetPending = work;
      try {
        await work;
        while (fleetPending && fleetPending !== work) {
          work = fleetPending;
          await work;
        }
      } finally {
        if (fleetPending === work) fleetPending = null;
      }
    }
    function refreshSoon() {
      if (now() - fleetRequestedAt < REFRESH_MS) return;
      void loadFleet();
    }
    return {
      loadIdentity,
      loadFleet,
      identify,
      refreshSoon,
      rememberDescriptor,
      descriptor: (hostId) => descriptors.get(hostId)
    };
  }

  // src/browser/host-directory.ts
  function createHostDirectory(options2) {
    let self = { base: "", hostId: null, label: null, version: null, capabilities: null };
    let catalog = sanitizeHostCatalog(options2.initialCatalog);
    let fleet = [];
    let cache = null;
    function invalidate() {
      cache = null;
    }
    function effectiveHosts() {
      if (!cache) {
        cache = mergeHostEntries(self, fleet, catalog);
        for (const host of cache) {
          const descriptor = host.hostId && options2.descriptor(host.hostId);
          if (!descriptor) continue;
          for (const field of ["label", "version", "capabilities"]) {
            if (host[field] == null && descriptor[field] != null) host[field] = descriptor[field];
          }
        }
      }
      return cache;
    }
    function entryFor(hostId) {
      const hosts = effectiveHosts();
      return hostId ? hosts.find((host) => host.hostId === hostId) || null : hosts[0];
    }
    function hostById(hostId) {
      if (!hostId || hostId === self.hostId) return self;
      return entryFor(hostId) || self;
    }
    function resolveHost(target) {
      if (!target) return self;
      return typeof target === "string" ? hostById(target) : target;
    }
    function sourceFor(host) {
      if (host.source === "user") return catalog.find((row) => row.base === host.base) || null;
      if (host.source !== "fleet") return null;
      return fleet.find((row) => {
        try {
          return normalizeHostBase(row.base) === host.base;
        } catch {
          return false;
        }
      }) || null;
    }
    function setSelf(descriptor) {
      self = { ...descriptor, base: "", label: typeof descriptor.label === "string" ? descriptor.label : null };
      invalidate();
    }
    function setFleet(data) {
      fleet = data.hosts.map((row) => ({ ...row }));
      if (data.selfLabel && !self.label) self = { ...self, label: data.selfLabel };
      invalidate();
    }
    function replaceCatalog(value) {
      catalog = sanitizeHostCatalog(value);
      invalidate();
    }
    function saveCatalog() {
      catalog = reconcileHostCatalog(catalog);
      options2.persistCatalog(catalog);
      invalidate();
    }
    function remove(key) {
      const next = catalog.filter((row) => (row.hostId || row.base) !== key);
      if (next.length === catalog.length) return false;
      catalog = next;
      invalidate();
      return true;
    }
    function setToken(key, token) {
      const row = catalog.find((entry) => (entry.hostId || entry.base) === key);
      if (!row) return false;
      row.token = token;
      invalidate();
      return true;
    }
    function add(value) {
      const row = sanitizeHostCatalog([value])[0];
      if (!row) return false;
      catalog = catalog.filter((entry) => (!row.hostId || entry.hostId !== row.hostId) && entry.base !== row.base);
      catalog.push(row);
      invalidate();
      return true;
    }
    function applyDescriptor(host, source, data) {
      if (sourceFor(host) !== source) return false;
      const user = catalog.find((row) => row === source);
      const remote = fleet.find((row) => row === source);
      if (!user && !remote) return false;
      host.hostId = data.hostId;
      for (const field of ["label", "version", "capabilities"]) {
        if (!host[field] && data[field]) host[field] = data[field];
      }
      if (user) {
        user.hostId = data.hostId;
        if (!user.label && typeof data.label === "string" && data.label) user.label = data.label;
      }
      if (remote) {
        remote.hostId = data.hostId;
        if (!remote.label && data.label) remote.label = data.label;
      }
      invalidate();
      if (user) options2.persistCatalog(catalog);
      return true;
    }
    return {
      get self() {
        return self;
      },
      get catalog() {
        return catalog;
      },
      effectiveHosts,
      entryFor,
      hostById,
      resolveHost,
      sourceFor,
      invalidate,
      setSelf,
      setFleet,
      replaceCatalog,
      saveCatalog,
      remove,
      setToken,
      add,
      applyDescriptor
    };
  }

  // src/browser/host-settings.ts
  var hostSettingsHtml = `<div class="preference-row"><label><strong>Hosts</strong><small>Added hosts are stored on this device (with their token). Entries this server publishes \u2014 and this host itself \u2014 are read-only.</small></label>
      <div class="hosts-list" id="hostsList"></div>
      <div class="host-add">
        <input id="addHostBase" class="cwd-input" type="text" placeholder="http://tycho:3333" spellcheck="false" autocomplete="off">
        <input id="addHostLabel" class="cwd-input" type="text" placeholder="Label (optional)" autocomplete="off">
        <input id="addHostToken" class="cwd-input" type="password" placeholder="Token (optional)" autocomplete="off">
        <button class="btn-small" id="addHostBtn">Add host</button>
      </div>
      <small class="host-add-status" id="addHostStatus"></small>
    </div>`;
  var STATE_TITLES = {
    reachable: "Reachable",
    connecting: "Not contacted yet",
    backoff: "Unreachable \u2014 retrying",
    blocked: "Needs a token"
  };
  function createHostSettings(options2) {
    let view = null;
    let sequence = 0;
    let checking = false;
    const { directory, connections, escapeHtml: escapeHtml2, displayLabel } = options2;
    function status(owner, message3, error = false) {
      if (view !== owner) return;
      owner.status.textContent = message3;
      owner.status.classList.toggle("error", error);
    }
    function unmount() {
      sequence++;
      checking = false;
      view?.events.abort();
      view?.rowEvents.abort();
      view = null;
    }
    function mount(root) {
      unmount();
      const list = root.querySelector("#hostsList");
      const base = root.querySelector("#addHostBase");
      const label = root.querySelector("#addHostLabel");
      const token = root.querySelector("#addHostToken");
      const statusElement = root.querySelector("#addHostStatus");
      const button = root.querySelector("#addHostBtn");
      if (!list || !base || !label || !token || !statusElement || !button) return;
      const events = new AbortController();
      view = { root, list, base, label, token, status: statusElement, events, rowEvents: new AbortController() };
      const owner = view;
      const listener = { signal: events.signal };
      button.addEventListener("click", () => {
        void addFromForm();
      }, listener);
      base.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void addFromForm();
      }, listener);
      for (const input of [base, label, token]) input.addEventListener("input", () => {
        sequence++;
        if (checking) {
          checking = false;
          status(owner, "");
        }
      }, listener);
      render();
    }
    function save() {
      directory.saveCatalog();
      options2.onCatalogSaved();
    }
    function promptToken(key) {
      const owner = view;
      if (!owner) return;
      const entry = directory.catalog.find((item) => (item.hostId || item.base) === key);
      if (!entry) {
        status(owner, "That host comes from this server\u2019s config \u2014 set its token there.");
        return;
      }
      const token = options2.promptToken(displayLabel(entry));
      if (token === null || view !== owner) return;
      directory.setToken(key, token.trim() || void 0);
      connections.reset(key);
      save();
      options2.refreshSessions();
    }
    async function addFromForm() {
      const owner = view;
      if (!owner) return;
      const requestSequence = ++sequence;
      checking = false;
      const raw = owner.base.value.trim();
      if (!raw) {
        status(owner, "Enter the host URL.", true);
        return;
      }
      const base = normalizeHostBase(raw);
      if (!base) {
        status(owner, "That is not a usable host URL.", true);
        return;
      }
      if (options2.protocol() === "https:" && base.startsWith("http://")) {
        status(owner, "This page is https, so the browser will block plain-http hosts. Serve that host over https (tailscale serve) or open pi-dish over http.", true);
        return;
      }
      const token = owner.token.value.trim();
      const label = owner.label.value.trim();
      const owns = () => view === owner && owner.root.isConnected && sequence === requestSequence;
      status(owner, "Checking\u2026");
      checking = true;
      let descriptor;
      try {
        const response = await options2.request(Object.freeze({ base, token: token || null }), "/api/host");
        if (!owns()) return;
        if (response.status === 401) throw new Error("that host needs a token");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!owns()) return;
        descriptor = decodeHostDescriptor(data);
        if (!descriptor) throw new Error("no host descriptor");
      } catch (error) {
        if (owns()) status(owner, `Could not reach that host: ${error instanceof Error ? error.message : String(error)}. A host on another origin must allowlist this one (allowedOrigins in its settings).`, true);
        return;
      } finally {
        if (owns()) checking = false;
      }
      if (descriptor.hostId === directory.self.hostId) {
        status(owner, "That is this host.", true);
        return;
      }
      options2.discovery.rememberDescriptor(descriptor);
      directory.add({ base, hostId: descriptor.hostId, label: label || descriptor.label || null, token: token || null });
      connections.reset(descriptor.hostId);
      save();
      owner.base.value = "";
      owner.label.value = "";
      owner.token.value = "";
      status(owner, `Added ${displayLabel({ label, base })}.`);
      options2.refreshSessions();
      options2.renderNewSessionHosts();
    }
    function render() {
      const owner = view;
      if (!owner) return;
      const { list } = owner;
      owner.rowEvents.abort();
      owner.rowEvents = new AbortController();
      const listener = { signal: owner.rowEvents.signal };
      const hosts = directory.effectiveHosts();
      list.innerHTML = hosts.map((host) => {
        const state = connections.stateOf(host);
        const version = host.version ? `v${host.version}` : "";
        const detail = [host.self ? "this server" : host.base, version].filter(Boolean).join(" \xB7 ");
        const actions = [];
        if (state === "blocked") actions.push(`<button class="btn-small host-token-btn" data-key="${escapeHtml2(host.key)}">token?</button>`);
        if (host.source === "user") actions.push(`<button class="btn-icon host-remove-btn" data-key="${escapeHtml2(host.key)}" title="Remove host">\u2715</button>`);
        const hostId = host.hostId || null;
        const custom = options2.customColor(hostId);
        const hex = options2.resolveColor(options2.color(hostId)) || "#888888";
        const colorControls = hosts.length > 1 ? `
        <input type="color" class="host-color-input" data-host="${escapeHtml2(hostId || "")}"
          value="${escapeHtml2(hex)}" style="background:${escapeHtml2(hex)}"
          title="${custom ? "Custom color for this host" : "Automatic color \u2014 pick one to override it"}">
        <button class="btn-icon host-color-reset${custom ? "" : " hidden"}" data-host="${escapeHtml2(hostId || "")}" title="Back to the automatic color">\u21BA</button>` : "";
        return `<div class="host-row">
        <span class="host-dot ${escapeHtml2(state)}" title="${escapeHtml2(STATE_TITLES[state] || state)}"></span>
        <span class="host-row-name">${escapeHtml2(displayLabel(host))}</span>
        <span class="host-row-detail" title="${escapeHtml2(host.base || "")}">${escapeHtml2(detail)}</span>
        <span class="host-row-actions">${colorControls}${actions.join("")}</span>
      </div>`;
      }).join("");
      for (const input of Array.from(list.querySelectorAll(".host-color-input"))) {
        input.addEventListener("input", () => {
          if (view !== owner || !list.contains(input)) return;
          input.style.background = input.value;
          options2.setColor(input.dataset.host || null, input.value, { rows: false });
        }, listener);
        input.addEventListener("change", () => {
          if (view === owner && list.contains(input)) options2.setColor(input.dataset.host || null, input.value);
        }, listener);
      }
      for (const btn of Array.from(list.querySelectorAll(".host-color-reset"))) {
        btn.addEventListener("click", () => {
          if (view === owner && list.contains(btn)) options2.setColor(btn.dataset.host || null, null);
        }, listener);
      }
      for (const btn of Array.from(list.querySelectorAll(".host-remove-btn"))) {
        btn.addEventListener("click", () => {
          if (view !== owner || !list.contains(btn)) return;
          directory.remove(btn.dataset.key || "");
          save();
        }, listener);
      }
      for (const btn of Array.from(list.querySelectorAll(".host-token-btn"))) {
        btn.addEventListener("click", () => {
          if (view === owner && list.contains(btn)) promptToken(btn.dataset.key || "");
        }, listener);
      }
    }
    return { mount, unmount, render, save, addFromForm };
  }

  // src/core/host-colors.ts
  var HOST_COLOR_SLOTS = 5;
  function sanitizeHostColors(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const entries = [];
    for (const [key, value] of Object.entries(raw)) {
      if (key && typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) entries.push([key, value.toLowerCase()]);
    }
    return Object.fromEntries(entries);
  }
  function sanitizeHostColorOrder(raw) {
    if (!Array.isArray(raw)) return [];
    const rows = raw;
    return [...new Set(rows.filter((item) => typeof item === "string" && !!item))];
  }
  function assignHostColor(order, key, overrides) {
    const list = sanitizeHostColorOrder(order);
    const map = sanitizeHostColors(overrides);
    let index = list.indexOf(key);
    const appended = !!key && index < 0;
    if (appended) {
      list.push(key);
      index = list.length - 1;
    }
    const auto = index < 0 ? "var(--text-muted)" : `var(--chart-${index % HOST_COLOR_SLOTS + 1})`;
    const custom = Object.prototype.hasOwnProperty.call(map, key);
    return { color: custom ? map[key] : auto, order: list, index, appended, custom };
  }
  function rgbStringToHex(value) {
    if (typeof value !== "string") return null;
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
    const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value.trim());
    if (!match) return null;
    const part = (input) => Math.max(0, Math.min(255, Math.round(Number(input)))).toString(16).padStart(2, "0");
    return "#" + part(match[1]) + part(match[2]) + part(match[3]);
  }

  // src/browser/host-presentation.ts
  function createHostPresentation(options2) {
    let overrides = sanitizeHostColors(options2.initialColors);
    let order = sanitizeHostColorOrder(options2.initialOrder);
    function keyFor(hostId) {
      if (hostId) return hostId;
      const entry = options2.directory.entryFor(null);
      return entry && (entry.hostId || entry.key) || "self";
    }
    function colorFor(hostId) {
      const assigned = assignHostColor(order, keyFor(hostId), overrides);
      if (assigned.appended) {
        order = assigned.order;
        try {
          options2.persistOrder(order);
        } catch {
        }
      }
      return assigned.color;
    }
    function isCustom(hostId) {
      return Object.prototype.hasOwnProperty.call(overrides, keyFor(hostId));
    }
    function setColor(hostId, hex, { rows = true } = {}) {
      overrides = sanitizeHostColors({ ...overrides, [keyFor(hostId)]: hex });
      try {
        options2.persistColors(overrides);
      } catch {
      }
      options2.onColorChanged(rows);
    }
    function dotHtml(hostId, className = "host-chip-dot") {
      return `<span class="${className}" style="--host-color:${options2.escapeHtml(colorFor(hostId))}"></span>`;
    }
    function chipHtml(hostId, { note = false } = {}) {
      if (options2.directory.effectiveHosts().length <= 1) return "";
      const entry = options2.directory.entryFor(hostId);
      if (!entry) return "";
      const down = options2.isDown(entry);
      const label = options2.displayLabel(entry);
      const title = label + (down ? " \u2014 unreachable, showing last known sessions" : "");
      return `<span class="host-chip${down ? " offline" : ""}" style="--host-color:${options2.escapeHtml(colorFor(hostId))}" title="${options2.escapeHtml(title)}"><span class="host-chip-dot"></span>${options2.escapeHtml(label)}${down && note ? " \xB7 unreachable" : ""}</span>`;
    }
    return { colorFor, isCustom, setColor, dotHtml, chipHtml };
  }
  function resolveColorToHex(color, doc = document) {
    const direct = rgbStringToHex(color);
    if (direct) return direct;
    const probe = doc.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
    probe.style.color = color;
    doc.body.appendChild(probe);
    try {
      return rgbStringToHex(doc.defaultView?.getComputedStyle(probe).color);
    } finally {
      probe.remove();
    }
  }

  // src/browser/directory-catalog.ts
  function sameDirectoryHost(a, b) {
    return !!a && !!b && a.hostId === b.hostId && a.base === b.base && a.token === b.token;
  }
  function record3(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function decodeKnownDirectories(value) {
    if (!Array.isArray(value)) return [];
    const rows = value;
    return rows.flatMap((row) => record3(row) && typeof row.path === "string" && typeof row.short === "string" ? [{ path: row.path, short: row.short }] : []);
  }
  function decodeDirectoryChildren(value) {
    if (!record3(value)) return { dirs: [], error: true };
    const rows = Array.isArray(value.dirs) ? value.dirs : [];
    return { dirs: rows.flatMap((row) => record3(row) && typeof row.path === "string" && typeof row.name === "string" ? [{ path: row.path, name: row.name }] : []), error: !!value.error };
  }
  function createDirectoryCatalog(options2) {
    let sequence = 0;
    let owner = null;
    let rows = [];
    function current() {
      return sameDirectoryHost(owner, options2.host()) ? rows : [];
    }
    function retire() {
      sequence++;
    }
    async function load() {
      const requestSequence = ++sequence;
      const selected = options2.host();
      if (!selected) return;
      const host = Object.freeze({ ...selected });
      const owns = () => requestSequence === sequence && sameDirectoryHost(host, options2.host());
      try {
        const response = await options2.request(host, "/api/cwds");
        if (!response.ok || !owns()) return;
        const data = await response.json();
        if (!owns()) return;
        rows = decodeKnownDirectories(data);
        owner = host;
      } catch {
      }
    }
    return { current, load, retire };
  }

  // src/browser/cwd-autocomplete.ts
  function createCwdAutocomplete(options2) {
    const { input, dropdown } = options2;
    const listeners = new AbortController();
    let rowsController = new AbortController();
    let timer = null;
    let blurTimer = null;
    let sequence = 0;
    let viewGeneration = 0;
    let disposed = false;
    let activeIndex = -1;
    let resultOwner = null;
    const mounted = () => !disposed && input.isConnected && dropdown.isConnected;
    function retireRequest() {
      sequence++;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
    function hide() {
      retireRequest();
      viewGeneration++;
      rowsController.abort();
      dropdown.style.display = "none";
      activeIndex = -1;
      resultOwner = null;
    }
    function pick(path) {
      if (!resultOwner?.()) {
        hide();
        return;
      }
      input.value = path;
      hide();
      options2.onPick?.(path);
    }
    function render(query, dirs, owns, ownsRows) {
      if (!owns()) return;
      const seen = /* @__PURE__ */ new Set();
      let results = [];
      const candidates = [
        ...options2.known().map((row) => ({ ...row, known: true })),
        ...dirs.map((row) => ({ ...row, known: false }))
      ];
      for (const row of candidates) {
        if (seen.has(row.short)) continue;
        seen.add(row.short);
        const indices = query ? options2.match(query, row.short) : [];
        if (!indices) continue;
        results.push({ ...row, indices, score: query ? options2.score(indices, row.short) + (row.known ? 5 : 0) : 0 });
      }
      if (query) results.sort((a, b) => b.score - a.score);
      results = results.slice(0, 15);
      rowsController.abort();
      rowsController = new AbortController();
      activeIndex = -1;
      resultOwner = ownsRows;
      if (!results.length) {
        dropdown.style.display = "none";
        return;
      }
      dropdown.innerHTML = results.map((row) => `<div class="cwd-option" data-path="${options2.escapeHtml(row.short)}">${row.known ? '<span class="cwd-known">\u2605</span>' : ""}${options2.highlight(row.short, row.indices)}</div>`).join("");
      dropdown.style.display = "block";
      for (const row of Array.from(dropdown.querySelectorAll(".cwd-option"))) {
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          if (dropdown.contains(row)) pick(row.dataset.path || "");
        }, { signal: rowsController.signal });
      }
    }
    function show(query) {
      retireRequest();
      if (resultOwner && !resultOwner()) hide();
      if (blurTimer !== null) clearTimeout(blurTimer);
      blurTimer = null;
      const selected = options2.host();
      if (!mounted() || !selected) return;
      const host = Object.freeze({ ...selected });
      const requestSequence = sequence;
      const rowGeneration = viewGeneration;
      const ownsRows = () => mounted() && viewGeneration === rowGeneration && sameDirectoryHost(host, options2.host());
      const owns = () => mounted() && sequence === requestSequence && sameDirectoryHost(host, options2.host());
      timer = setTimeout(async () => {
        timer = null;
        if (!owns()) return;
        let rows = [];
        try {
          const response = await options2.request(host, "/api/dirs?q=" + encodeURIComponent(query));
          if (!owns()) return;
          if (response.ok) rows = decodeKnownDirectories(await response.json());
        } catch {
        }
        render(query, rows, owns, ownsRows);
      }, 120);
    }
    const listener = { signal: listeners.signal };
    input.addEventListener("focus", () => show(input.value), listener);
    input.addEventListener("input", () => show(input.value), listener);
    input.addEventListener("blur", () => {
      if (blurTimer !== null) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        blurTimer = null;
        hide();
      }, 150);
      options2.onBlur?.();
    }, listener);
    input.addEventListener("keydown", (event) => {
      if (resultOwner && !resultOwner()) hide();
      if (dropdown.style.display === "none") {
        if (event.key === "Enter" && options2.onSubmit) {
          event.preventDefault();
          options2.onSubmit();
        }
        return;
      }
      const rows = Array.from(dropdown.querySelectorAll(".cwd-option"));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!rows.length) {
          activeIndex = -1;
          return;
        }
        const delta = event.key === "ArrowDown" ? 1 : -1;
        activeIndex = Math.max(0, Math.min(activeIndex + delta, rows.length - 1));
        rows.forEach((row, index) => row.classList.toggle("active", index === activeIndex));
        rows[activeIndex].scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selected = rows[activeIndex];
        if (selected) pick(selected.dataset.path || "");
        else {
          hide();
          options2.onSubmit?.();
        }
      } else if (event.key === "Escape") {
        event.stopPropagation();
        hide();
      }
    }, listener);
    function dispose() {
      disposed = true;
      hide();
      if (blurTimer !== null) clearTimeout(blurTimer);
      blurTimer = null;
      listeners.abort();
    }
    return { show, hide, dispose };
  }

  // src/browser/directory-tree.ts
  function createDirectoryTree(options2) {
    const { root } = options2;
    const doc = root.ownerDocument;
    let owner = null;
    function owns(target) {
      return owner === target && root.isConnected && sameDirectoryHost(target.host, options2.host());
    }
    function makeNode(target, path, label, depth) {
      const node = doc.createElement("div");
      node.className = "ns-tree-node";
      const row = doc.createElement("div");
      row.className = "ns-tree-row";
      row.style.paddingLeft = 8 + depth * 16 + "px";
      row.dataset.path = path;
      const chevron = doc.createElement("span");
      chevron.className = "ns-tree-chevron";
      chevron.textContent = "\u25B8";
      const name = doc.createElement("span");
      name.className = "ns-tree-name";
      name.textContent = label;
      const children = doc.createElement("div");
      children.className = "ns-tree-children";
      children.style.display = "none";
      let loaded = false;
      chevron.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!owns(target) || !root.contains(node)) return;
        if (loaded) {
          const open = children.style.display !== "none";
          children.style.display = open ? "none" : "";
          chevron.classList.toggle("open", !open);
          return;
        }
        loaded = true;
        node.dataset.loaded = "1";
        chevron.classList.add("open");
        children.style.display = "";
        const pending = doc.createElement("div");
        pending.className = "ns-tree-empty";
        pending.style.paddingLeft = 8 + (depth + 1) * 16 + "px";
        pending.textContent = "\u2026";
        children.replaceChildren(pending);
        void load();
      }, { signal: target.events.signal });
      row.addEventListener("click", () => {
        if (!owns(target) || !root.contains(node)) return;
        options2.onPick(path);
        root.querySelectorAll(".ns-tree-row.selected").forEach((item) => item.classList.remove("selected"));
        row.classList.add("selected");
      }, { signal: target.events.signal });
      row.append(chevron, name);
      node.append(row, children);
      async function load() {
        let data = { dirs: [], error: true };
        try {
          const response = await options2.request(target.host, "/api/dirs/children?path=" + encodeURIComponent(path), { signal: target.events.signal });
          if (!owns(target) || !root.contains(node)) return;
          data = decodeDirectoryChildren(await response.json());
        } catch {
        }
        if (!owns(target) || !root.contains(node)) return;
        children.replaceChildren();
        if (!data.dirs.length) {
          const empty = doc.createElement("div");
          empty.className = "ns-tree-empty";
          empty.style.paddingLeft = 8 + (depth + 1) * 16 + "px";
          empty.textContent = data.error ? "(unreadable)" : "(empty)";
          children.appendChild(empty);
          return;
        }
        for (const child of data.dirs) children.appendChild(makeNode(target, child.path, child.name, depth + 1));
      }
      return node;
    }
    function dispose() {
      owner?.events.abort();
      owner = null;
    }
    function reset() {
      dispose();
      root.replaceChildren();
      const host = options2.host();
      if (!host) return;
      owner = { host: Object.freeze({ ...host }), events: new AbortController() };
      root.appendChild(makeNode(owner, "~", "~", 0));
    }
    return { reset, dispose, isCurrent: () => !!owner && owns(owner) };
  }

  // src/browser/spawn-targets.ts
  var HEADLESS = { label: "pi-dish (headless)", target: null, pinned: true };
  function spawnTargetKey(choice) {
    if (!choice.target) return "headless";
    return `${choice.target.socket}::${choice.needsName ? "new" : choice.target.tmuxSession}`;
  }
  function record4(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function decodeSpawnChoices(value) {
    if (!record4(value) || !value.available || !Array.isArray(value.servers)) return [HEADLESS];
    const values = value.servers;
    const servers = values.flatMap((server) => record4(server) && typeof server.name === "string" && typeof server.socket === "string" && server.socket ? [{ name: server.name, socket: server.socket, sessions: server.sessions }] : []);
    const choices = [HEADLESS];
    for (const server of servers) choices.push({
      label: `tmux:${server.name} \u2014 new session\u2026`,
      target: { type: "tmux", socket: server.socket },
      needsName: true,
      pinned: true
    });
    for (const server of servers) {
      const sessions = Array.isArray(server.sessions) ? server.sessions : [];
      for (const session of sessions) if (record4(session) && typeof session.name === "string" && session.name) {
        choices.push({
          label: `tmux:${server.name} \u2014 ${session.name}`,
          target: { type: "tmux", socket: server.socket, tmuxSession: session.name }
        });
      }
    }
    return choices;
  }
  function createSpawnTargets(options2) {
    let sequence = 0;
    let owner = null;
    let choices = [HEADLESS];
    let choiceKey = "headless";
    function currentChoices() {
      return sameDirectoryHost(owner, options2.host()) ? choices : [HEADLESS];
    }
    function current() {
      return currentChoices().find((choice) => spawnTargetKey(choice) === choiceKey) || HEADLESS;
    }
    function retire() {
      sequence++;
    }
    async function load() {
      const requestSequence = ++sequence;
      owner = null;
      choices = [HEADLESS];
      choiceKey = "headless";
      options2.changed();
      const selected2 = options2.host();
      if (!selected2 || !options2.supportsTmux()) return;
      const host = Object.freeze({ ...selected2 });
      const owns = () => sequence === requestSequence && sameDirectoryHost(host, options2.host());
      let next;
      try {
        const response = await options2.request(host, "/api/tmux/targets");
        if (!response.ok || !owns()) return;
        const data = await response.json();
        if (!owns()) return;
        next = decodeSpawnChoices(data);
      } catch {
        return;
      }
      owner = host;
      choices = next;
      const saved = options2.readSaved();
      choiceKey = choices.some((choice) => spawnTargetKey(choice) === saved) ? saved || "headless" : "headless";
      options2.changed();
    }
    function choose(key) {
      if (!currentChoices().some((choice) => spawnTargetKey(choice) === key)) return false;
      choiceKey = key;
      options2.save(key);
      options2.changed();
      return true;
    }
    function selected(name) {
      const choice = current();
      if (!choice.target) return null;
      if (choice.needsName) {
        const trimmed = name.trim();
        if (!trimmed) throw new Error("Enter a name for the new tmux session");
        return { type: "tmux", socket: choice.target.socket, newTmuxSession: trimmed };
      }
      return choice.target.tmuxSession ? { type: "tmux", socket: choice.target.socket, tmuxSession: choice.target.tmuxSession } : null;
    }
    function resume(host) {
      if (!sameDirectoryHost(owner, host)) return null;
      const saved = options2.readSaved();
      const choice = choices.find((item) => spawnTargetKey(item) === saved);
      if (!choice?.target?.tmuxSession || choice.needsName) return null;
      return { type: "tmux", socket: choice.target.socket, tmuxSession: choice.target.tmuxSession };
    }
    return { load, retire, choices: currentChoices, current, choose, selected, resume };
  }
  function createSpawnTargetPicker(options2) {
    const { input, nameInput, wrap, dropdown, targets } = options2;
    const listeners = new AbortController();
    let rowListeners = new AbortController();
    let blurTimer = null;
    let activeIndex = -1;
    let rendered = null;
    function hide() {
      rowListeners.abort();
      rendered = null;
      dropdown.style.display = "none";
      activeIndex = -1;
      if (blurTimer !== null) clearTimeout(blurTimer);
      blurTimer = null;
    }
    function sync() {
      hide();
      input.value = targets.current().label;
      nameInput.style.display = targets.current().needsName ? "" : "none";
      wrap.style.display = targets.choices().length > 1 ? "" : "none";
    }
    function choose(key) {
      if (!rendered || rendered !== targets.choices()) {
        sync();
        return;
      }
      if (!targets.choose(key)) return;
      sync();
      if (targets.current().needsName) nameInput.focus();
    }
    function render(query) {
      hide();
      const choices = targets.choices();
      if (choices.length < 2) {
        sync();
        return;
      }
      rendered = choices;
      const q = query.trim();
      let named = choices.filter((choice) => !choice.pinned).flatMap((choice) => {
        const indices = q ? options2.match(q, choice.label) : [];
        return indices ? [{ choice, indices, score: q ? options2.score(indices, choice.label) : 0 }] : [];
      });
      if (q) named = named.sort((a, b) => b.score - a.score);
      const rows = [...choices.filter((choice) => choice.pinned).map((choice) => ({ choice, indices: [] })), ...named];
      dropdown.innerHTML = rows.map(({ choice, indices }) => `<div class="cwd-option" data-key="${options2.escapeHtml(spawnTargetKey(choice))}">${indices.length ? options2.highlight(choice.label, indices) : options2.escapeHtml(choice.label)}</div>`).join("");
      dropdown.style.display = "block";
      rowListeners = new AbortController();
      for (const row of Array.from(dropdown.querySelectorAll(".cwd-option"))) {
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          if (dropdown.contains(row)) choose(row.dataset.key || "");
        }, { signal: rowListeners.signal });
      }
    }
    const listener = { signal: listeners.signal };
    input.addEventListener("focus", () => {
      input.select();
      render("");
    }, listener);
    input.addEventListener("input", () => render(input.value), listener);
    input.addEventListener("blur", () => {
      if (blurTimer !== null) clearTimeout(blurTimer);
      blurTimer = setTimeout(sync, 150);
    }, listener);
    input.addEventListener("keydown", (event) => {
      if (dropdown.style.display === "none") return;
      if (rendered !== targets.choices()) {
        sync();
        return;
      }
      const rows = Array.from(dropdown.querySelectorAll(".cwd-option"));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!rows.length) return;
        activeIndex = Math.max(0, Math.min(activeIndex + (event.key === "ArrowDown" ? 1 : -1), rows.length - 1));
        rows.forEach((row, index) => row.classList.toggle("active", index === activeIndex));
        rows[activeIndex].scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter") {
        event.preventDefault();
        const row = rows[activeIndex];
        if (row) choose(row.dataset.key || "");
        else sync();
      } else if (event.key === "Escape") {
        event.stopPropagation();
        sync();
      }
    }, listener);
    return { sync, render, hide, dispose() {
      hide();
      listeners.abort();
    } };
  }

  // src/browser/model-catalog.ts
  function modelsCacheKey(harnessId, hostId, selfId) {
    const base = harnessId === "pi" ? "pi-dish-models-cache" : `pi-dish-models-cache:${harnessId}`;
    return hostId && hostId !== selfId ? `${base}@${hostId}` : base;
  }
  function createModelCatalog(options2) {
    let sequence = 0;
    let models = [];
    let scope = null;
    let currentOwner = null;
    const current = () => !currentOwner || currentOwner();
    function rows() {
      return current() ? models : [];
    }
    function retire() {
      sequence++;
    }
    function clear() {
      retire();
      models = [];
      scope = null;
      currentOwner = null;
    }
    function snapshot(target) {
      return Object.freeze({ ...target, host: Object.freeze({ ...target.host }) });
    }
    function seed(target, data, owns) {
      clear();
      if (!owns()) return;
      const decoded = decodeModelCatalog(data);
      scope = snapshot(target);
      models = decoded;
      currentOwner = owns;
    }
    async function load(target, ownsRequest, ownsRows = ownsRequest) {
      const requestSequence = ++sequence;
      const owner = snapshot(target);
      const valid = () => requestSequence === sequence && ownsRequest();
      try {
        const data = await options2.read(owner);
        if (!valid()) return;
        models = decodeModelCatalog(data);
        scope = owner;
        currentOwner = ownsRows;
        if (models.length) {
          try {
            options2.persist(owner, models);
          } catch {
          }
        }
        options2.changed();
      } catch (error) {
        if (!valid()) return;
        models = [];
        scope = null;
        currentOwner = null;
        options2.failed(error);
      }
    }
    function filter(query) {
      const q = query.toLowerCase();
      return rows().filter((model) => !q || [model.id, model.provider, model.name].some((value) => value.toLowerCase().includes(q)));
    }
    function replaceEnabled(matches, enabled) {
      if (!current()) return;
      models = models.map((model) => matches(model) ? { ...model, enabled: enabled(model) } : model);
    }
    function toggle(selector) {
      replaceEnabled((model) => `${model.provider}/${model.id}` === selector, (model) => model.enabled === false);
    }
    function setAll(enabled) {
      replaceEnabled(() => true, () => enabled);
    }
    function toggleProvider(provider, query) {
      const listed = new Set(filter(query).filter((model) => model.provider === provider));
      if (!listed.size) return;
      const enabled = ![...listed].every((model) => model.enabled !== false);
      replaceEnabled((model) => listed.has(model), () => enabled);
    }
    function enabledIds() {
      if (!current()) return void 0;
      const list = rows(), enabled = list.filter((model) => model.enabled !== false);
      return enabled.length === list.length ? null : enabled.map((model) => `${model.provider}/${model.id}`);
    }
    return { rows, get scope() {
      return current() ? scope : null;
    }, load, seed, retire, clear, filter, toggle, setAll, toggleProvider, enabledIds };
  }
  function modelSelectOptionsHtml(models, escapeHtml2) {
    const enabled = models.filter((model) => model.enabled !== false);
    const byProvider = /* @__PURE__ */ new Map();
    for (const model of enabled) {
      const group = byProvider.get(model.provider) || [];
      group.push(model);
      byProvider.set(model.provider, group);
    }
    let html = '<option value="">(default)</option>';
    for (const provider of [...byProvider.keys()].sort()) {
      html += `<optgroup label="${escapeHtml2(provider)}">`;
      for (const model of byProvider.get(provider) || []) {
        html += `<option value="${escapeHtml2(model.selector || `${model.provider}/${model.id}`)}">${escapeHtml2(model.name || model.id)}</option>`;
      }
      html += "</optgroup>";
    }
    return { html, enabled, hidden: models.length - enabled.length };
  }
  function modelHiddenNote(hidden) {
    return hidden > 0 ? `${hidden} model${hidden === 1 ? "" : "s"} hidden (not enabled)` : "";
  }

  // src/browser/new-session-options.ts
  var NS_THINKING_LABELS = Object.freeze({
    off: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Maximum"
  });
  var thinkingLabel = (level) => Object.hasOwn(NS_THINKING_LABELS, level) ? NS_THINKING_LABELS[level] : level;
  function createNewSessionPreferences(options2) {
    let harness = "pi", model = "", thinking = "";
    function preference(kind) {
      return options2.read(`pi-dish-new-${kind}:${harness}`) || (harness === "pi" ? options2.read(`pi-dish-new-${kind}`) : "") || "";
    }
    function persist(kind, value) {
      options2.write(`pi-dish-new-${kind}:${harness}`, value);
      if (harness === "pi") options2.write(`pi-dish-new-${kind}`, value);
    }
    function restore(harnessId) {
      harness = harnessId;
      model = preference("model");
      thinking = preference("thinking");
    }
    function syncThinking() {
      const selected = options2.rows().find((row) => (row.selector || `${row.provider}/${row.id}`) === options2.model.value);
      let levels = Object.keys(NS_THINKING_LABELS);
      let disabled = selected?.reasoning === false;
      let note = disabled ? "The selected model does not support configurable thinking" : "";
      if (harness === "omp") {
        levels = selected?.thinking || [];
        disabled = !selected || levels.length === 0;
        if (!selected) note = "Select a model to choose an explicit thinking level";
        else if (!levels.length) note = "This model has no configurable thinking levels";
        else note = `Valid for this model: ${levels.map(thinkingLabel).join(", ")}`;
      }
      options2.thinking.innerHTML = '<option value="">(default)</option>' + levels.map((level) => `<option value="${options2.escapeHtml(level)}">${options2.escapeHtml(thinkingLabel(level))}</option>`).join("");
      if (!levels.includes(thinking)) {
        thinking = "";
        persist("thinking", "");
      }
      options2.thinking.disabled = disabled;
      options2.thinking.value = disabled ? "" : thinking;
      if (options2.thinkingNote) options2.thinkingNote.textContent = note;
    }
    function render() {
      const { html, enabled, hidden } = modelSelectOptionsHtml(options2.rows(), options2.escapeHtml);
      options2.model.innerHTML = html;
      options2.model.value = model && enabled.some((row) => (row.selector || `${row.provider}/${row.id}`) === model) ? model : "";
      if (options2.hiddenNote) options2.hiddenNote.textContent = modelHiddenNote(hidden);
      syncThinking();
    }
    return {
      restore,
      render,
      syncThinking,
      selectModel(value) {
        model = value || "";
        persist("model", model);
        syncThinking();
      },
      selectThinking(value) {
        thinking = value || "";
        persist("thinking", thinking);
      }
    };
  }
  function record5(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function decodeHarnessConfigPreview(value, cwd) {
    if (!record5(value)) throw new Error("Invalid harness defaults");
    const roles = record5(value.modelRoles) ? Object.fromEntries(Object.entries(value.modelRoles).filter((entry) => typeof entry[1] === "string")) : {};
    return {
      cwd,
      defaultModel: typeof value.defaultModel === "string" ? value.defaultModel : "",
      defaultThinkingLevel: typeof value.defaultThinkingLevel === "string" ? value.defaultThinkingLevel : "",
      modelRoles: roles
    };
  }
  function createNewSessionConfigPreview(options2) {
    let sequence = 0;
    let config = null;
    let owner = null;
    function current(target) {
      const now = options2.scope();
      return !!target && !!now && target.view === now.view && target.cwd === now.cwd && target.harnessId === now.harnessId && sameDirectoryHost(target.host, now.host);
    }
    function retire() {
      sequence++;
      config = null;
      owner = null;
    }
    async function load(cwd) {
      retire();
      const now = options2.scope();
      if (!now || now.harnessId !== "omp") {
        options2.wrap.style.display = "none";
        return;
      }
      const target = Object.freeze({ ...now, cwd: cwd ?? now.cwd, host: Object.freeze({ ...now.host }) });
      const version = sequence;
      const owns = () => version === sequence && current(target);
      options2.wrap.style.display = "";
      options2.values.textContent = "Loading\u2026";
      for (const button of options2.buttons) button.style.display = "none";
      if (options2.roles) options2.roles.textContent = "";
      try {
        const params = target.cwd ? `?cwd=${encodeURIComponent(target.cwd)}` : "";
        const response = await options2.request(target.host, "/api/harnesses/omp/config" + params);
        if (!owns()) return;
        const data = await response.json();
        if (!owns()) return;
        if (!response.ok) throw new Error(record5(data) && typeof data.error === "string" && data.error ? data.error : `HTTP ${response.status}`);
        config = decodeHarnessConfigPreview(data, target.cwd);
        owner = target;
        options2.values.textContent = `Model: ${config.defaultModel || "auto-select"} \xB7 Thinking: ${config.defaultThinkingLevel || "host default"}`;
        if (options2.roles) options2.roles.textContent = "Roles: " + options2.roleSummary(config.modelRoles);
        for (const button of options2.buttons) button.style.display = "";
      } catch (error) {
        if (!owns()) return;
        config = null;
        owner = null;
        options2.values.textContent = `Defaults unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return { load, retire, get config() {
      return current(owner) ? config : null;
    } };
  }

  // src/browser/harness-settings-data.ts
  function record6(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  var text3 = (value) => typeof value === "string" ? value : "";
  function stringRecord(value) {
    const result = Object.fromEntries(record6(value) ? Object.entries(value).filter((entry) => typeof entry[1] === "string") : []);
    Object.setPrototypeOf(result, null);
    return result;
  }
  function booleanRecord(value) {
    const result = Object.fromEntries(record6(value) ? Object.entries(value).filter((entry) => typeof entry[1] === "boolean") : []);
    Object.setPrototypeOf(result, null);
    return result;
  }
  function decodeHarnessConfig(value) {
    if (!record6(value)) throw new Error("Invalid harness configuration");
    return {
      defaultModel: text3(value.defaultModel),
      defaultThinkingLevel: text3(value.defaultThinkingLevel),
      globalModelRoles: stringRecord(value.globalModelRoles),
      modelRoles: stringRecord(value.modelRoles)
    };
  }
  function settings(value) {
    if (!record6(value)) return null;
    return {
      disabled: Array.isArray(value.disabled) ? value.disabled.filter((name) => typeof name === "string") : [],
      modelOverrides: stringRecord(value.modelOverrides),
      prewalk: booleanRecord(value.prewalk),
      advisor: booleanRecord(value.advisor)
    };
  }
  function decodeHarnessAgents(value) {
    if (!record6(value)) throw new Error("Invalid harness agents");
    const agents = Array.isArray(value.agents) ? value.agents : [];
    return {
      agents: agents.flatMap((agent) => record6(agent) && typeof agent.name === "string" && agent.name ? [{ name: agent.name, description: text3(agent.description), source: text3(agent.source), model: text3(agent.model), thinkingLevel: text3(agent.thinkingLevel) }] : []),
      settings: settings(value.settings),
      globalSettings: settings(value.globalSettings)
    };
  }

  // src/browser/harness-settings.ts
  function createHarnessSettings(options2) {
    const { root, escapeHtml: escapeHtml2, shortCwd: shortCwd2, parseModelRoleRef, composeModelRoleRef, modelRoleLevels } = options2;
    const AGENT_MODEL_ROLE_REFS = options2.roleDefinitions.map((role) => `@${role.key}`);
    let harnessSettings = null;
    let sequence = 0;
    const listeners = new AbortController();
    function $(id) {
      const el = root.querySelector(`#${id}`);
      if (!(el instanceof HTMLElement)) throw new Error(`Missing harness settings control: ${id}`);
      return el;
    }
    const saveButton = $("modelRolesSave");
    if (!(saveButton instanceof HTMLButtonElement)) throw new Error("Missing harness settings save button");
    const button = saveButton;
    const errorMessage = (error) => error instanceof Error ? error.message : String(error);
    function isOpen() {
      return root.style.display === "flex";
    }
    function owns(view) {
      return harnessSettings === view && isOpen();
    }
    function ownsHost(view) {
      return sameDirectoryHost(view.host, options2.host(view.scope.hostId));
    }
    function harnessSettingsError(message3) {
      $("modelRolesError").textContent = message3;
    }
    function showTab(tab) {
      for (const [name, tabId, paneId] of [["agents", "hsTabAgents", "hsPaneAgents"], ["models", "hsTabModels", "hsPaneModels"]]) {
        const active = name === (tab === "models" ? "models" : "agents");
        $(tabId).classList.toggle("active", active);
        $(tabId).setAttribute("aria-selected", active ? "true" : "false");
        $(paneId).style.display = active ? "" : "none";
      }
    }
    function buildRoleRows(config) {
      const global = stringRecord(config?.globalModelRoles), effective = stringRecord(config?.modelRoles);
      const canonical = new Set(options2.roleDefinitions.map((role) => role.key));
      return [...options2.roleDefinitions, ...Object.keys(global).filter((key) => !canonical.has(key)).sort().map((key) => ({ key, name: key, description: "Custom role" }))].map((role) => {
        const value = global[role.key] || "", effectiveValue = effective[role.key] || "";
        return { ...role, value, override: effectiveValue && effectiveValue !== value ? effectiveValue : null };
      });
    }
    async function request(host, url, body) {
      const response = await options2.request(host, url, body === void 0 ? void 0 : {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" && data.error ? data.error : `HTTP ${response.status}`);
      return data;
    }
    async function settle(promise) {
      try {
        return { value: await promise };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    }
    function hostChanged() {
      harnessSettingsError("Host changed. Reopen settings to edit its current configuration.");
      button.disabled = true;
    }
    async function open(scope) {
      const version = ++sequence;
      const endpoint = options2.host(scope.hostId);
      root.style.display = "flex";
      $("harnessSettingsTitle").textContent = `${scope.label} settings`;
      $("harnessSettingsScope").textContent = scope.cwd ? shortCwd2(scope.cwd) : "host default";
      $("harnessSettingsScope").title = scope.cwd || "No working directory: the harness reads its global config only";
      $("harnessAgentsBody").textContent = "Loading\u2026";
      $("harnessSettingsDefaults").textContent = "Loading\u2026";
      $("modelRolesBody").innerHTML = "";
      harnessSettingsError("");
      button.disabled = false;
      button.textContent = "Save";
      showTab(scope.tab);
      if (!endpoint) {
        harnessSettings = null;
        hostChanged();
        return;
      }
      const view = {
        scope: Object.freeze({ ...scope }),
        host: Object.freeze({ ...endpoint }),
        config: null,
        agents: [],
        settings: null,
        globalSettings: null,
        models: [],
        saving: false
      };
      harnessSettings = view;
      const params = scope.cwd ? `?cwd=${encodeURIComponent(scope.cwd)}` : "";
      const base = `/api/harnesses/${encodeURIComponent(scope.harnessId)}`;
      const [config, agents, models] = await Promise.all([
        settle(request(view.host, `${base}/config${params}`).then(decodeHarnessConfig)),
        settle(request(view.host, `${base}/agents${params}`).then(decodeHarnessAgents)),
        settle(request(view.host, modelCatalogUrl(scope.harnessId, scope.cwd)).then(decodeModelCatalog))
      ]);
      if (version !== sequence || !owns(view)) return;
      if (!ownsHost(view)) {
        hostChanged();
        return;
      }
      view.config = config.value || null;
      view.models = models.value || options2.fallbackModels(view.host, scope.harnessId);
      if (agents.value) {
        view.agents = agents.value.agents;
        view.settings = agents.value.settings;
        view.globalSettings = agents.value.globalSettings;
      }
      renderHarnessAgents(agents.error);
      renderHarnessDefaults(config.error);
      renderModelRoles();
    }
    function close() {
      sequence++;
      harnessSettings = null;
      root.style.display = "none";
    }
    function renderHarnessDefaults(error) {
      const el = $("harnessSettingsDefaults");
      if (!el) return;
      const config = harnessSettings?.config;
      if (!config) {
        el.textContent = `Defaults unavailable: ${error || "no response"}`;
        return;
      }
      el.textContent = `Default model: ${config.defaultModel || "auto-select"} \xB7 Thinking: ${config.defaultThinkingLevel || "host default"}`;
    }
    function harnessSettingsModelSelectors() {
      const models = harnessSettings?.models || [];
      return models.map((m) => m.selector || `${m.provider}/${m.id}`);
    }
    function modelRoleOptions(value) {
      const known = harnessSettingsModelSelectors();
      let html = `<option value=""${value ? "" : " selected"}>(unset)</option>`;
      if (value && !known.includes(value)) {
        html += `<option value="${escapeHtml2(value)}" selected>(current) ${escapeHtml2(value)}</option>`;
      }
      known.forEach((selector) => {
        html += `<option value="${escapeHtml2(selector)}"${selector === value ? " selected" : ""}>${escapeHtml2(selector)}</option>`;
      });
      return html;
    }
    function modelRoleLevelOptions(level, modelSelector, keepUnknown) {
      const models = harnessSettings?.models || [];
      const entry = models.find((m) => (m.selector || `${m.provider}/${m.id}`) === modelSelector);
      const levels = modelRoleLevels(entry);
      let html = `<option value=""${level ? "" : " selected"}>(inherit)</option>`;
      if (level && keepUnknown && !levels.includes(level)) {
        html += `<option value="${escapeHtml2(level)}" selected>(current) ${escapeHtml2(level)}</option>`;
      }
      for (const name of levels) {
        html += `<option value="${escapeHtml2(name)}"${name === level ? " selected" : ""}>${escapeHtml2(name)}</option>`;
      }
      return html;
    }
    function modelRoleModelChanged(select) {
      const levelSelect = select.closest(".model-role-row")?.querySelector(".model-role-level");
      if (!levelSelect) return;
      levelSelect.innerHTML = modelRoleLevelOptions(levelSelect.value, select.value, false);
    }
    function renderModelRoles() {
      const body = $("modelRolesBody");
      if (!body) return;
      const rows = buildRoleRows(harnessSettings?.config);
      const known = harnessSettingsModelSelectors();
      body.innerHTML = rows.map((row) => {
        const { model, level } = parseModelRoleRef(row.value, known);
        return `<div class="model-role-row" data-role="${escapeHtml2(row.key)}">
      <div class="model-role-label">
        <strong>${escapeHtml2(row.name)}</strong>
        <code class="model-role-key">${escapeHtml2(row.key)}</code>
        <small>${escapeHtml2(row.description)}</small>
        ${row.override ? `<small class="model-role-override">project override: ${escapeHtml2(row.override)} (.omp/config.yml wins here)</small>` : ""}
      </div>
      <select class="model-role-select" data-role="${escapeHtml2(row.key)}" data-initial="${escapeHtml2(model)}">${modelRoleOptions(model)}</select>
      <select class="model-role-level" data-role="${escapeHtml2(row.key)}" data-initial="${escapeHtml2(level)}"
              title="Thinking level for this role">${modelRoleLevelOptions(level, model, true)}</select>
    </div>`;
      }).join("");
    }
    function agentModelOptions(value, inherited) {
      const known = harnessSettingsModelSelectors();
      const inheritLabel = inherited ? `(inherit ${inherited})` : "(inherit)";
      let html = `<option value=""${value ? "" : " selected"}>${escapeHtml2(inheritLabel)}</option>`;
      if (value && !known.includes(value) && !AGENT_MODEL_ROLE_REFS.includes(value)) {
        html += `<option value="${escapeHtml2(value)}" selected>(current) ${escapeHtml2(value)}</option>`;
      }
      const group = (label, values) => {
        if (!values.length) return "";
        return `<optgroup label="${escapeHtml2(label)}">` + values.map((entry) => `<option value="${escapeHtml2(entry)}"${entry === value ? " selected" : ""}>${escapeHtml2(entry)}</option>`).join("") + "</optgroup>";
      };
      return html + group("Roles", AGENT_MODEL_ROLE_REFS) + group("Models", known);
    }
    function triStateOptions(value) {
      const state = value === true ? "on" : value === false ? "off" : "";
      return [["", "Inherit"], ["on", "On"], ["off", "Off"]].map(([option, label]) => `<option value="${option}"${option === state ? " selected" : ""}>${label}</option>`).join("");
    }
    function triStateValue(state) {
      return state === "on" ? true : state === "off" ? false : null;
    }
    function renderHarnessAgents(error) {
      const body = $("harnessAgentsBody");
      if (!body) return;
      const global = harnessSettings?.globalSettings;
      const effective = harnessSettings?.settings;
      const agents = harnessSettings?.agents || [];
      if (!global) {
        body.textContent = `Agents unavailable: ${error || "no response"}`;
        return;
      }
      if (!agents.length) {
        body.textContent = "No task agents discovered for this harness.";
        return;
      }
      const disabled = new Set(global.disabled || []);
      const effectiveDisabled = new Set(effective?.disabled || []);
      body.innerHTML = agents.map((agent) => {
        const name = agent.name;
        const model = global.modelOverrides?.[name] || "";
        const prewalk = global.prewalk?.[name];
        const advisor = global.advisor?.[name];
        const isDisabled = disabled.has(name);
        const overrides = [];
        if (effectiveDisabled.has(name) !== isDisabled) {
          overrides.push(effectiveDisabled.has(name) ? "disabled here" : "enabled here");
        }
        const effectiveModel = effective?.modelOverrides?.[name] || "";
        if (effectiveModel !== model) overrides.push(`model ${effectiveModel || "inherited"}`);
        const definition = [agent.model, agent.thinkingLevel && `thinking ${agent.thinkingLevel}`].filter(Boolean).join(" \xB7 ");
        return `<div class="hs-agent-row${isDisabled ? " disabled" : ""}" data-agent="${escapeHtml2(name)}">
      <div class="hs-agent-label">
        <label class="hs-agent-enable">
          <input type="checkbox" class="hs-agent-enabled" data-agent="${escapeHtml2(name)}"
                 data-initial="${isDisabled ? "off" : "on"}"${isDisabled ? "" : " checked"}>
          <strong>${escapeHtml2(name)}</strong>
        </label>
        <span class="hs-agent-source hs-agent-source-${escapeHtml2(agent.source || "bundled")}">${escapeHtml2(agent.source || "bundled")}</span>
        ${definition ? `<code class="hs-agent-definition">${escapeHtml2(definition)}</code>` : ""}
        <small>${escapeHtml2(agent.description || "")}</small>
        ${overrides.length ? `<small class="model-role-override">project override: ${escapeHtml2(overrides.join(", "))} (.omp/config.yml wins here)</small>` : ""}
      </div>
      <div class="hs-agent-controls">
        <label class="hs-agent-field">Model
          <select class="hs-agent-model" data-agent="${escapeHtml2(name)}" data-initial="${escapeHtml2(model)}">${agentModelOptions(model, agent.model)}</select>
        </label>
        <label class="hs-agent-field">Prewalk
          <select class="hs-agent-prewalk" data-agent="${escapeHtml2(name)}" data-initial="${prewalk === true ? "on" : prewalk === false ? "off" : ""}">${triStateOptions(prewalk)}</select>
        </label>
        <label class="hs-agent-field">Advisor
          <select class="hs-agent-advisor" data-agent="${escapeHtml2(name)}" data-initial="${advisor === true ? "on" : advisor === false ? "off" : ""}">${triStateOptions(advisor)}</select>
        </label>
      </div>
    </div>`;
      }).join("");
    }
    function collectHarnessSettingsPatch() {
      const roles = /* @__PURE__ */ Object.create(null);
      const levelSelects = /* @__PURE__ */ new Map();
      for (const select of Array.from(root.querySelectorAll("#modelRolesBody .model-role-level"))) {
        if (select.dataset.role) levelSelects.set(select.dataset.role, select);
      }
      for (const select of Array.from(root.querySelectorAll("#modelRolesBody .model-role-select"))) {
        if (!select.dataset.role) continue;
        const levelSelect = levelSelects.get(select.dataset.role);
        const level = levelSelect?.value || "";
        if (select.value === select.dataset.initial && level === (levelSelect?.dataset.initial || "")) continue;
        roles[select.dataset.role] = select.value ? composeModelRoleRef(select.value, level) : null;
      }
      const agents = /* @__PURE__ */ Object.create(null);
      const field = (name, key, value) => {
        if (!name) return;
        agents[name] = agents[name] || {};
        agents[name][key] = value;
      };
      for (const box of Array.from(root.querySelectorAll("#harnessAgentsBody .hs-agent-enabled"))) {
        const state = box.checked ? "on" : "off";
        if (state !== box.dataset.initial) field(box.dataset.agent, "disabled", !box.checked);
      }
      for (const select of Array.from(root.querySelectorAll("#harnessAgentsBody .hs-agent-model"))) {
        if (select.value === select.dataset.initial) continue;
        field(select.dataset.agent, "model", select.value || null);
      }
      for (const [cls, key] of [["hs-agent-prewalk", "prewalk"], ["hs-agent-advisor", "advisor"]]) {
        for (const select of Array.from(root.querySelectorAll(`#harnessAgentsBody .${cls}`))) {
          if (select.value === select.dataset.initial) continue;
          field(select.dataset.agent, key, triStateValue(select.value));
        }
      }
      return { roles, agents };
    }
    async function save() {
      const view = harnessSettings;
      if (!view || !owns(view) || view.saving) return;
      if (!ownsHost(view)) {
        hostChanged();
        return;
      }
      const { roles, agents } = collectHarnessSettingsPatch();
      if (!Object.keys(roles).length && !Object.keys(agents).length) {
        close();
        return;
      }
      const { cwd, harnessId } = view.scope;
      const base = `/api/harnesses/${encodeURIComponent(harnessId)}`;
      view.saving = true;
      harnessSettingsError("");
      button.disabled = true;
      button.textContent = "Saving\u2026";
      try {
        if (Object.keys(agents).length) await request(view.host, `${base}/agents`, { agents, cwd: cwd || void 0 });
        if (Object.keys(roles).length) await request(view.host, `${base}/model-roles`, { roles, cwd: cwd || void 0 });
        if (owns(view)) close();
        options2.onSaved(view.scope);
      } catch (error) {
        if (owns(view)) harnessSettingsError(errorMessage(error));
      } finally {
        view.saving = false;
        if (owns(view)) {
          button.disabled = false;
          button.textContent = "Save";
        }
      }
    }
    root.addEventListener("change", (event) => {
      const view = harnessSettings;
      if (!view || !owns(view) || !ownsHost(view)) return;
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.matches(".model-role-select")) modelRoleModelChanged(target);
      if (target instanceof HTMLInputElement && target.matches(".hs-agent-enabled")) target.closest(".hs-agent-row")?.classList.toggle("disabled", !target.checked);
    }, { signal: listeners.signal });
    return { open, close, save, showTab, isOpen, dispose() {
      close();
      listeners.abort();
    } };
  }

  // src/browser/session-spawns.ts
  function record7(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function decodeSpawnId(value) {
    if (!record7(value) || typeof value.spawnId !== "string" || !value.spawnId) throw new Error("Failed to start session");
    return value.spawnId;
  }
  function decodeSpawnStatus(value) {
    if (record7(value)) {
      if (value.status === "starting") return { status: "starting" };
      if (value.status === "error") return { status: "error", error: typeof value.error === "string" && value.error ? value.error : "Session failed to start" };
      if (value.status === "ready" && typeof value.sessionId === "string" && value.sessionId) return { status: "ready", sessionId: value.sessionId };
    }
    throw new Error("Session spawn returned an invalid result");
  }
  function sessionSpawnKey(host, spawnId) {
    return JSON.stringify([host, spawnId]);
  }
  function createSessionSpawns(options2) {
    const pending = /* @__PURE__ */ new Map();
    async function monitor(key, spawn) {
      try {
        let sessionId;
        for (; ; ) {
          let response;
          try {
            response = await options2.request(spawn.endpoint, `/api/session-spawns/${encodeURIComponent(spawn.spawnId)}`);
          } catch {
            await options2.delay();
            continue;
          }
          const data = await response.json().catch(() => null);
          if (!response.ok && response.status !== 202) throw new Error(record7(data) && typeof data.error === "string" && data.error ? data.error : `spawn status failed (${response.status})`);
          const status = decodeSpawnStatus(data);
          if (status.status === "starting") {
            await options2.delay();
            continue;
          }
          if (status.status === "error") throw new Error(status.error);
          sessionId = status.sessionId;
          break;
        }
        for (; ; ) {
          await options2.loadSessions();
          if (options2.hasSession(sessionId, spawn.host)) {
            pending.delete(key);
            options2.changed();
            const showing = options2.current() === key;
            if (showing) options2.stashPrompt();
            options2.migratePrompt(key, spawn.host, sessionId);
            if (showing) {
              options2.status("Session created");
              options2.selectSession(sessionId, spawn.host);
            }
            return;
          }
          if (options2.current() === key) options2.status("Session created \u2014 connecting the UI\u2026", "working");
          await options2.delay();
        }
      } catch (error) {
        pending.delete(key);
        options2.changed();
        const message3 = error instanceof Error ? error.message : String(error);
        if (options2.current() === key) {
          options2.showFailure(key, message3, spawn);
          options2.status(`Session start failed: ${message3}`, "error");
        } else options2.discardPrompt(key);
      }
    }
    async function submit(input) {
      const host = Object.freeze({ ...input.host });
      const target = input.target ? Object.freeze({ ...input.target }) : void 0;
      const { name, cwd, model, thinking, draft, ownsView, onAccepted } = input;
      const harness = input.harness || "pi";
      const label = options2.harnessLabel(harness);
      const data = await sendJson(options2.request, host, "/api/sessions/new", {
        name: name || void 0,
        cwd: cwd || void 0,
        model: model || void 0,
        thinking: thinking || void 0,
        target,
        harness,
        async: true
      });
      const spawnId = decodeSpawnId(data);
      const key = sessionSpawnKey(host.hostId || null, spawnId);
      const spawn = Object.freeze({
        spawnId,
        endpoint: host,
        host: host.hostId || null,
        cwd: cwd || "~",
        target: !!target,
        harness,
        harnessLabel: label
      });
      pending.set(key, spawn);
      if (draft) options2.saveDraft(key, draft);
      onAccepted?.();
      if (ownsView()) options2.showPending(key);
      else options2.changed();
      void monitor(key, spawn);
      return key;
    }
    return {
      submit,
      has: (key) => pending.has(key),
      get: (key) => pending.get(key),
      entries: () => [...pending.entries()]
    };
  }

  // src/browser/helper-values.ts
  function record8(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function finite2(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function timestampMillis(value) {
    return new Date(value === void 0 ? NaN : value === null ? 0 : value).getTime();
  }

  // src/browser/helper-format.ts
  function escapeHtml(text17) {
    if (text17 == null || text17 === "") return "";
    return String(text17).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function stripAnsi(text17) {
    if (text17 == null || text17 === "") return "";
    return String(text17).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "").replace(/\x1b\[[0-9;:?]*[ -\/]*[@-~]/g, "").replace(/\x1b[ -\/]*./g, "");
  }
  function formatTokens(tokens2) {
    if (!tokens2 || tokens2 === 0) return "0";
    if (tokens2 >= 1e6) return `${(tokens2 / 1e6).toFixed(1)}M`;
    if (tokens2 >= 1e3) return `${(tokens2 / 1e3).toFixed(1)}k`;
    return `${tokens2}`;
  }
  function formatCacheStat(cacheRead, cacheWrite, input) {
    const read = cacheRead || 0;
    const write = cacheWrite || 0;
    const prompt = read + write + (input || 0);
    if (prompt === 0) return "\u2014";
    let s = `${formatTokens(read)} read (${Math.round(read / prompt * 100)}% hit)`;
    if (write > 0) s += ` \xB7 ${formatTokens(write)} written`;
    else if (read > 0) s += " \xB7 writes not reported";
    return s;
  }
  function formatRuntime(r) {
    if (!r || !r.kind) return "\u2014";
    const pid = r.pid ? ` \xB7 pid ${r.pid}` : "";
    if (r.kind === "rpc") return `pi-dish server (headless)${pid}`;
    if (r.kind === "tmux") {
      if (r.server === "pi-dish") {
        const sess = r.tmuxSession && r.tmuxSession !== "headless" ? ` \xB7 ${r.tmuxSession}` : "";
        return `headless (hidden tmux \u2014 survives restarts)${sess}${pid}`;
      }
      let where = `tmux ${r.server || "?"}`;
      if (r.tmuxSession) {
        where += ` \xB7 ${r.tmuxSession}`;
        if (r.windowIndex != null) where += `:${r.windowIndex}`;
        if (r.windowName) where += ` ${r.windowName}`;
      }
      return where + pid;
    }
    return `terminal${pid}`;
  }
  function formatTokSpeed(outputTokens, durationMs) {
    if (!outputTokens || !durationMs || durationMs < 1e3) return null;
    const rate = outputTokens / (durationMs / 1e3);
    if (!finite2(rate) || rate <= 0) return null;
    return (rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10) + " tok/s";
  }
  function formatEstimatedCost(value, digits = 4) {
    if (!finite2(value)) return "Unavailable";
    if (value === 0) return "~$0";
    const precision = value < 1e-4 ? Math.max(digits, 6) : value < 0.01 ? Math.max(digits, 4) : 2;
    return `~$${value.toFixed(precision)}`;
  }
  function formatUsageCost(value, unavailable = 0) {
    const formatted = formatEstimatedCost(value);
    return finite2(value) && unavailable ? `${formatted}*` : formatted;
  }
  function formatResponseMetadata(msg, mode = "compact") {
    if (!msg || mode === "hidden") return null;
    const usage = msg.usage || {};
    const speed = formatTokSpeed(msg.outputTokens || usage.output, msg.durationMs);
    const tokens2 = usage.output ? `${formatTokens(usage.output)} out` : null;
    const elapsed = finite2(msg.durationMs) && msg.durationMs > 0 ? `${msg.durationMs < 1e4 ? (msg.durationMs / 1e3).toFixed(1) : Math.round(msg.durationMs / 1e3)}s` : null;
    if (mode === "compact") return speed || tokens2;
    const performance = [elapsed, speed].filter(Boolean).join(" \xB7 ");
    if (mode === "performance-cost") {
      const cost = msg.pricingKnown !== false && finite2(usage.cost?.total) ? formatEstimatedCost(usage.cost.total) : null;
      return [performance, cost].filter(Boolean).join(" \xB7 ") || tokens2;
    }
    return performance || tokens2;
  }
  function formatRelativeTime(ts) {
    if (!ts) return "";
    const diff = Math.max(0, Date.now() - new Date(ts).getTime());
    const s = Math.floor(diff / 1e3), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (s < 60) return "just now";
    if (m < 60) return m + "m ago";
    if (h < 24) return h + "h ago";
    if (d === 1) return "yesterday";
    if (d < 7) return d + "d ago";
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1e3));
    const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return (h ? `${h}:${mm}` : mm) + ":" + String(s).padStart(2, "0");
  }
  function shortCwd(cwd) {
    if (!cwd) return "";
    return cwd.replace(/^\/home\/[^/]+\//, "~/").replace(/^\/home\/[^/]+$/, "~");
  }
  function truncate(text17, maxLen, suffix = " \u2026 (truncated)") {
    if (!text17 || text17.length <= maxLen) return text17;
    return text17.slice(0, maxLen) + suffix;
  }
  function contextClass(percent) {
    return percent > 66 ? "critical" : percent > 33 ? "high" : "";
  }
  function normalizeMood(description, face) {
    description = String(description || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
    face = String(face || "").trim().replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ");
    if (!description && !face) return null;
    return { description, face };
  }
  function pushPromptHistory(list, message3, cap) {
    const out = Array.isArray(list) ? list.filter((value) => typeof value === "string") : [];
    const msg = String(message3 || "").trim();
    if (!msg) return out;
    if (out[out.length - 1] === msg) return out;
    out.push(msg);
    const max = typeof cap === "number" && cap > 0 ? cap : 50;
    return out.length > max ? out.slice(out.length - max) : out;
  }
  function sttUnavailableReason({ isSecureContext, hasGetUserMedia, hasMediaRecorder, origin } = {}) {
    if (!isSecureContext) {
      const where = origin || "this origin";
      return {
        code: "insecure",
        message: `Microphone needs a secure origin. This page is on ${where}, so the browser withholds the mic. Open pi-dish over https or localhost, or in Chrome (desktop and Android) add ${where} at chrome://flags/#unsafely-treat-insecure-origin-as-secure and relaunch. iOS Safari has no override \u2014 use https (tailscale serve, cloudflared, or a self-signed cert).`
      };
    }
    if (!hasGetUserMedia) return { code: "no-getusermedia", message: "This browser exposes no microphone API." };
    if (!hasMediaRecorder) return { code: "no-recorder", message: "This browser can't record audio (no MediaRecorder)." };
    return null;
  }
  function insertAtCaret(value, selectionStart, selectionEnd, text17) {
    const source = typeof value === "string" ? value : "";
    const insert = typeof text17 === "string" ? text17 : "";
    const max = source.length;
    let start = finite2(selectionStart) ? Math.max(0, Math.min(max, selectionStart)) : max;
    let end = finite2(selectionEnd) ? Math.max(0, Math.min(max, selectionEnd)) : start;
    if (end < start) [start, end] = [end, start];
    const before = source.slice(0, start);
    const after = source.slice(end);
    if (!insert) return { value: before + after, caret: before.length };
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const suffix = after && !/^\s/.test(after) ? " " : "";
    const middle = prefix + insert + suffix;
    return { value: before + middle + after, caret: before.length + prefix.length + insert.length };
  }
  function tmuxPrefixSeq(prefix) {
    if (typeof prefix !== "string") return null;
    if (/^C-Space$/i.test(prefix)) return "\0";
    let m = /^C-([a-zA-Z@[\\\]^_?])$/.exec(prefix);
    if (m) {
      if (m[1] === "?") return "\x7F";
      const code = m[1].toUpperCase().charCodeAt(0);
      return String.fromCharCode(code & 31);
    }
    m = /^M-(.)$/.exec(prefix);
    if (m) return "\x1B" + m[1];
    return null;
  }
  function filenameFromContentDisposition(header, fallback2) {
    const clean = (raw) => {
      if (typeof raw !== "string") return "";
      const base = (raw.replace(/\\/g, "/").split("/").pop() || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
      return base === "." || base === ".." ? "" : base;
    };
    const value = typeof header === "string" ? header : "";
    const extended = value.match(/;\s*filename\*\s*=\s*([^;]+)/i);
    if (extended) {
      const parts = extended[1].trim().match(/^[^']*'[^']*'(.*)$/);
      if (parts) {
        try {
          const decoded = clean(decodeURIComponent(parts[1]));
          if (decoded) return decoded;
        } catch {
        }
      }
    }
    const quoted = value.match(/;\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
    if (quoted) {
      const decoded = clean(quoted[1].replace(/\\(.)/g, "$1"));
      if (decoded) return decoded;
    }
    const bare = value.match(/;\s*filename\s*=\s*([^;"][^;]*)/i);
    if (bare) {
      const decoded = clean(bare[1]);
      if (decoded) return decoded;
    }
    return fallback2;
  }

  // src/browser/helper-identity.ts
  function sessionKey(hostId, sessionId) {
    const id = sessionId == null ? "" : String(sessionId);
    return hostId ? `${hostId} ${id}` : id;
  }
  function parseSessionKey(key) {
    const raw = key == null ? "" : String(key);
    const sep = raw.indexOf(" ");
    if (sep < 0) return { hostId: null, sessionId: raw };
    return { hostId: raw.slice(0, sep), sessionId: raw.slice(sep + 1) };
  }
  function sessionRefKey(session) {
    return sessionKey(session && session.host, session && session.id);
  }
  function hostDisplayLabel(host) {
    if (!host) return "";
    if (host.label) return String(host.label);
    if (host.name) return String(host.name);
    if (!host.base) return "this host";
    return String(host.base).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
  function hostSupportsCapability(hostEntry, capability, config) {
    const caps = hostEntry && hostEntry.capabilities;
    if (caps && typeof caps === "object") return caps[capability] === true;
    const isSelf = !!hostEntry && (hostEntry.self === true || hostEntry.base === "");
    return isSelf ? !!(config && config[capability]) : false;
  }
  function sortHostSections(hosts) {
    const rows = Array.isArray(hosts) ? [...hosts] : [];
    return rows.sort((a, b) => {
      if (!!a.self !== !!b.self) return a.self ? -1 : 1;
      const byLabel = hostDisplayLabel(a).localeCompare(hostDisplayLabel(b), void 0, { sensitivity: "base" });
      if (byLabel) return byLabel;
      return String(a.hostId || a.base || "").localeCompare(String(b.hostId || b.base || ""));
    });
  }
  function hostSectionKey(hostKey) {
    return "host:" + (hostKey || "self");
  }
  function sessionMetaText(session) {
    return [session.name, session.cwd, session.model, session.id].join(" ").toLowerCase();
  }
  function sessionSupports(session, capability) {
    return session?.capabilities?.[capability] !== false;
  }
  function harnessBadgeInfo(harnessId, harnessLabel) {
    const known = {
      pi: { label: "Pi", icon: "vendor/harness-pi.svg" },
      omp: { label: "OMP", icon: "vendor/harness-omp.svg" },
      prime: { label: "Prime", icon: "vendor/harness-prime.svg" }
    };
    return (harnessId && Object.hasOwn(known, harnessId) ? known[harnessId] : null) || {
      label: harnessLabel || harnessId || "Agent",
      icon: null
    };
  }

  // src/browser/helper-models.ts
  var THINKING_LEVEL_NAMES = ["off", "minimal", "low", "medium", "high", "xhigh"];
  var OMP_THINKING_LEVEL_NAMES = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"];
  function thinkingLevelsFor(harnessId, model) {
    if (harnessId !== "omp") return THINKING_LEVEL_NAMES;
    const supported = Array.isArray(model?.thinking) && model.thinking.length ? model.thinking : OMP_THINKING_LEVEL_NAMES.slice(0, -1);
    return [.../* @__PURE__ */ new Set(["off", ...supported, "auto"])];
  }
  var OMP_MODEL_ROLES = [
    { key: "default", name: "Default", description: "Main agent model" },
    { key: "smol", name: "Fast", description: "Fast/cheap model for lightweight tasks, summaries, and fallbacks" },
    { key: "slow", name: "Thinking", description: "Deep-reasoning model for thorough analysis" },
    { key: "vision", name: "Vision", description: "Vision-capable model for image inspection and descriptions" },
    { key: "plan", name: "Architect", description: "Planning/architecture mode" },
    { key: "designer", name: "Designer", description: "UI and design tasks" },
    { key: "commit", name: "Commit", description: "Commit message generation" },
    { key: "tiny", name: "Tiny", description: "Session titles and micro-classifiers (falls back to smol)" },
    { key: "task", name: "Subtask", description: "Default model for subagent tasks" },
    { key: "advisor", name: "Advisor", description: "Paired reviewer model that watches each turn" }
  ];
  function modelRoleRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === "string" && !!entry[1]));
  }
  function formatModelRoleSummary(roles, limit = 4) {
    const record9 = modelRoleRecord(roles);
    const order = OMP_MODEL_ROLES.map((role) => role.key);
    const rank = (key) => order.indexOf(key) < 0 ? order.length : order.indexOf(key);
    const entries = Object.keys(record9).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((key) => `${key} ${record9[key]}`);
    if (!entries.length) return "No roles assigned";
    const shown = entries.slice(0, limit);
    const rest = entries.length - shown.length;
    return shown.join(" \xB7 ") + (rest > 0 ? ` \xB7 +${rest} more` : "");
  }

  // src/browser/helper-query.ts
  var QUERY_FIELDS = /* @__PURE__ */ new Set(["name", "cwd", "model", "id", "is", "host", "routine"]);
  function parseQueryDate(value, now) {
    const rel = /^(\d+)([hdw])$/.exec(value);
    if (rel) {
      const ms = Number(rel[1]) * (rel[2] === "h" ? 36e5 : rel[2] === "d" ? 864e5 : 7 * 864e5);
      return now - ms;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (iso) {
      const year = Number(iso[1]), month = Number(iso[2]), day = Number(iso[3]);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const maxDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
      if (!maxDay || day < 1 || day > maxDay) return null;
      const t = (/* @__PURE__ */ new Date(value + "T00:00:00")).getTime();
      return finite2(t) ? t : null;
    }
    return null;
  }
  function queryTokenRe() {
    return /(-?)([a-zA-Z]+:)?("([^"]*)"|\S+)/g;
  }
  function stripQueryField(query, field) {
    if (!query) return "";
    const want = String(field || "").toLowerCase();
    const tokenRe = queryTokenRe();
    const kept = [];
    let m;
    while ((m = tokenRe.exec(query)) !== null) {
      const prefix = m[2] ? m[2].slice(0, -1).toLowerCase() : null;
      if (prefix !== want) kept.push(m[0]);
    }
    return kept.join(" ");
  }
  function parseSessionQuery(query, now = Date.now()) {
    const parsed = { terms: [], since: null, before: null };
    if (!query) return parsed;
    const tokenRe = queryTokenRe();
    let m;
    while ((m = tokenRe.exec(query)) !== null) {
      const neg = m[1] === "-";
      const rawPrefix = m[2] ? m[2].slice(0, -1).toLowerCase() : null;
      const value = (m[4] !== void 0 ? m[4] : m[3]).toLowerCase();
      if (!neg && (rawPrefix === "since" || rawPrefix === "before")) {
        const t = parseQueryDate(value, now);
        if (t !== null) {
          if (rawPrefix === "since") parsed.since = Math.max(parsed.since ?? -Infinity, t);
          else parsed.before = Math.min(parsed.before ?? Infinity, t);
          continue;
        }
      }
      if (rawPrefix && QUERY_FIELDS.has(rawPrefix)) {
        if (value) parsed.terms.push({ neg, field: rawPrefix, value });
        continue;
      }
      const literal = (rawPrefix ? rawPrefix + ":" : "") + value;
      if (literal) parsed.terms.push({ neg, field: null, value: literal });
    }
    return parsed;
  }
  function positiveQueryTokens(parsed) {
    return parsed.terms.filter((t) => !t.neg && !t.field).map((t) => t.value);
  }
  function isAutomationSession(session) {
    return !!(session && (session.routine || session.routineId));
  }
  function queryAsksForAutomation(parsed) {
    return (parsed?.terms || []).some((term) => !term.neg && (term.field === "routine" || term.field === "is" && term.value === "automation"));
  }
  function evaluateSessionQuery(parsed, session, contentText) {
    if (parsed.since !== null || parsed.before !== null) {
      const t = new Date(session.lastActivity || 0).getTime();
      if (parsed.since !== null && !(t >= parsed.since)) return false;
      if (parsed.before !== null && !(t < parsed.before)) return false;
    }
    const meta = sessionMetaText(session);
    for (const term of parsed.terms) {
      let hit;
      if (term.field === "host") {
        hit = String(session.hostLabel || session.host || "").toLowerCase().includes(term.value);
      } else if (term.field === "is") {
        hit = term.value === "active" && !!session.isActive || term.value === "automation" && isAutomationSession(session);
      } else {
        const hay = term.field ? String(session[term.field] || "").toLowerCase() : meta;
        hit = hay.includes(term.value);
        if (!hit && !term.neg && !term.field && contentText) hit = contentText.includes(term.value);
      }
      if (hit === term.neg) return false;
    }
    return true;
  }
  function countOccurrences(text17, token) {
    if (!text17 || !token) return 0;
    let n = 0, i = text17.indexOf(token);
    while (i !== -1) {
      n++;
      i = text17.indexOf(token, i + token.length);
    }
    return n;
  }
  function scoreSessionMatch(parsed, session, contentText) {
    const tokens2 = positiveQueryTokens(parsed);
    if (!tokens2.length) return 0;
    const name = String(session.name || "").toLowerCase();
    const other = [session.cwd, session.model, session.id].join(" ").toLowerCase();
    let total = 0;
    for (const token of tokens2) {
      if (name.includes(token)) total += 100;
      if (other.includes(token)) total += 30;
      const n = countOccurrences(contentText, token);
      if (n > 0) total += 20 + Math.min(30, Math.round(8 * Math.log2(n)));
    }
    return Math.round(total);
  }
  function applyLocalFilter(list, query) {
    if (!query) return list;
    const parsed = parseSessionQuery(query);
    const out = list.filter((s) => evaluateSessionQuery(parsed, s));
    if (!positiveQueryTokens(parsed).length) return out;
    return out.map((s) => [s, scoreSessionMatch(parsed, s)]).sort((a, b) => b[1] - a[1] || new Date(b[0].lastActivity || 0).getTime() - new Date(a[0].lastActivity || 0).getTime()).map(([s]) => s);
  }
  function applyHostTerms(list, query) {
    if (!query) return list;
    const terms = parseSessionQuery(query).terms.filter((t) => t.field === "host");
    if (!terms.length) return list;
    const parsed = { terms, since: null, before: null };
    return list.filter((s) => evaluateSessionQuery(parsed, s));
  }
  function fuzzyMatch(query, str) {
    query = query.toLowerCase();
    str = str.toLowerCase();
    let qi = 0;
    const indices = [];
    for (let si = 0; si < str.length && qi < query.length; si++) {
      if (str[si] === query[qi]) {
        indices.push(si);
        qi++;
      }
    }
    return qi === query.length ? indices : null;
  }
  function fuzzyScore(indices, str) {
    if (!indices) return -Infinity;
    let score = 0;
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === indices[i - 1] + 1) score += 10;
    }
    score -= indices[0];
    score -= str.length * 0.1;
    return score;
  }
  function highlightFuzzy(str, indices) {
    if (!indices || !indices.length) return escapeHtml(str);
    let result = "";
    let last = 0;
    for (const idx of indices) {
      result += escapeHtml(str.slice(last, idx));
      result += `<span class="cwd-match">${escapeHtml(str[idx])}</span>`;
      last = idx + 1;
    }
    result += escapeHtml(str.slice(last));
    return result;
  }
  function highlightTokens(text17, tokens2) {
    const str = String(text17);
    const lower = str.toLowerCase();
    const ranges = [];
    for (const t of tokens2) {
      if (!t) continue;
      const needle = String(t).toLowerCase();
      for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + 1)) {
        ranges.push([i, i + needle.length]);
      }
    }
    if (!ranges.length) return escapeHtml(str);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0]];
    for (const [s, e] of ranges.slice(1)) {
      const last = merged[merged.length - 1];
      if (s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    let out = "", pos = 0;
    for (const [s, e] of merged) {
      out += escapeHtml(str.slice(pos, s)) + "<mark>" + escapeHtml(str.slice(s, e)) + "</mark>";
      pos = e;
    }
    return out + escapeHtml(str.slice(pos));
  }

  // src/browser/new-session.ts
  var NEW_SESSION_HARNESS_KEY = "pi-dish-new-harness";
  var HOST_KEY = "pi-dish-new-host";
  function createNewSession(options2) {
    const { root, storage, models, request } = options2;
    function element(id) {
      const node = root.querySelector("#" + id);
      if (!(node instanceof HTMLElement)) throw new Error(`Missing new-session control: ${id}`);
      return node;
    }
    function input(id) {
      const node = element(id);
      if (!(node instanceof HTMLInputElement)) throw new Error(`Invalid new-session input: ${id}`);
      return node;
    }
    function select(id) {
      const node = element(id);
      if (!(node instanceof HTMLSelectElement)) throw new Error(`Invalid new-session select: ${id}`);
      return node;
    }
    const cwdInput = input("newSessionCwd"), nameInput = input("newSessionName");
    const hostSelect = select("nsHostSelect"), harnessSelect = select("nsHarnessSelect");
    const modelSelect = select("nsModelSelect"), thinkingSelect = select("nsThinkingSelect");
    const spawnElement = element("nsSpawnBtn");
    if (!(spawnElement instanceof HTMLButtonElement)) throw new Error("Invalid spawn button");
    const spawnButton = spawnElement;
    const workspaceRoot = element("nsWorkspaces");
    let selectedHostId = storage.getItem(HOST_KEY) || null;
    let harnessId = "pi";
    let generation = 0;
    let draft = null;
    let refreshTimer;
    let directoryTree = null;
    let workspaceEvents = new AbortController();
    let disposed = false;
    const message3 = (error2) => error2 instanceof Error ? error2.message : String(error2);
    const isOpen = () => !disposed && root.classList.contains("new-session-open");
    const host = () => (selectedHostId ? options2.host(selectedHostId) : null) || options2.self();
    const hostId = () => host().hostId || null;
    const cwd = () => cwdInput.value.trim();
    const selectedHarness = () => harnessSelect.value || harnessId || "pi";
    const supports2 = (capability) => !host().capabilities || host().capabilities?.[capability] === true;
    const hostOptions = () => options2.hosts().filter((row) => row.self || !options2.hostDown(row));
    const error = (value) => {
      if (!disposed) element("nsError").textContent = value;
    };
    const preferences = createNewSessionPreferences({
      model: modelSelect,
      thinking: thinkingSelect,
      hiddenNote: element("nsModelHidden"),
      thinkingNote: element("nsThinkingNote"),
      rows: () => models.rows(),
      read: (key) => storage.getItem(key),
      write: (key, value) => storage.setItem(key, value),
      escapeHtml
    });
    const config = createNewSessionConfigPreview({
      wrap: element("nsHarnessConfig"),
      values: element("nsHarnessConfigValues"),
      roles: element("nsHarnessRoles"),
      buttons: [element("nsEditAgents"), element("nsEditRoles")],
      scope: () => isOpen() ? { host: host(), harnessId: selectedHarness(), cwd: cwd(), view: generation } : null,
      request,
      roleSummary: formatModelRoleSummary
    });
    const directories = createDirectoryCatalog({ host, request });
    const targets = createSpawnTargets({
      host,
      supportsTmux: () => supports2("tmux"),
      request,
      readSaved: () => storage.getItem("pi-dish-spawn-target"),
      save: (key) => storage.setItem("pi-dish-spawn-target", key),
      changed: () => targetPicker.sync()
    });
    const targetPicker = createSpawnTargetPicker({
      input: input("newSessionTarget"),
      nameInput: input("newSessionTmuxName"),
      wrap: element("newSessionTargetWrap"),
      dropdown: element("spawnTargetDropdown"),
      targets,
      match: fuzzyMatch,
      score: fuzzyScore,
      highlight: highlightFuzzy,
      escapeHtml
    });
    const selectedTarget = () => targets.selected(input("newSessionTmuxName").value);
    async function readHarnesses(target) {
      const response = await request(target, "/api/harnesses");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }
    const harnesses = createHarnessDiscovery({
      selectedHostId: hostId,
      selfHostId: () => options2.self().hostId,
      requestPicker: readHarnesses,
      requestBackground: readHarnesses,
      preferredHarness: () => storage.getItem(NEW_SESSION_HARNESS_KEY),
      onPreferredHarness: (value) => {
        if (!disposed) harnessId = value;
      },
      onPickerChange: () => {
        if (disposed) return;
        renderHarnesses();
        if (isOpen()) changeHarness(selectedHarness());
      },
      onCacheChange: () => {
        if (!disposed) options2.harnessCacheChanged();
      }
    });
    const harnessLabel = (id) => harnesses.rows().find((row) => row.id === id)?.label || (id === "pi" ? "Pi" : id);
    const autocomplete = createCwdAutocomplete({
      input: cwdInput,
      dropdown: element("cwdDropdown"),
      host,
      request,
      known: () => directories.current(),
      match: fuzzyMatch,
      score: fuzzyScore,
      highlight: highlightFuzzy,
      escapeHtml,
      onPick: (value) => {
        storage.setItem("pi-dish-cwd", value);
        scheduleRefresh();
      },
      onBlur: scheduleRefresh,
      onSubmit: () => {
        void spawn();
      }
    });
    const savedCwd = storage.getItem("pi-dish-cwd");
    if (savedCwd) cwdInput.value = savedCwd;
    function renderHosts() {
      if (disposed) return;
      if (isOpen() && directoryTree && !directoryTree.isCurrent()) {
        autocomplete.hide();
        initTree();
        void directories.load();
        renderWorkspaces();
      }
      const row = element("nsHostRow"), available = hostOptions();
      if (available.length < 2) {
        row.style.display = "none";
        return;
      }
      row.style.display = "";
      hostSelect.innerHTML = available.map((value) => `<option value="${escapeHtml(value.hostId || "")}">${escapeHtml(hostDisplayLabel(value))}</option>`).join("");
      hostSelect.value = hostId() || "";
    }
    function setHostId(value) {
      if (disposed) return;
      selectedHostId = value || null;
      if (selectedHostId) storage.setItem(HOST_KEY, selectedHostId);
      else storage.removeItem(HOST_KEY);
    }
    function changeHost(value) {
      if (disposed) return;
      autocomplete.hide();
      setHostId(value);
      models.clear();
      void directories.load();
      void targets.load();
      void harnesses.load();
      renderWorkspaces();
      initTree();
      changeHarness(selectedHarness());
    }
    function renderHarnesses() {
      if (disposed) return;
      const available = harnesses.rows().filter((row) => row.available !== false);
      harnessSelect.innerHTML = available.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label || row.id)}</option>`).join("");
      if (!available.some((row) => row.id === harnessId)) harnessId = available[0]?.id || "pi";
      harnessSelect.value = harnessId;
    }
    function changeHarness(value) {
      if (disposed) return;
      harnessId = value || "pi";
      storage.setItem(NEW_SESSION_HARNESS_KEY, harnessId);
      preferences.restore(harnessId);
      models.clear();
      preferences.render();
      refresh();
    }
    function refresh() {
      if (!isOpen()) return;
      const endpoint = Object.freeze({ ...host() }), harness = selectedHarness(), directory = cwd(), view = generation;
      const ownsRows = () => view === generation && isOpen() && selectedHarness() === harness && sameDirectoryHost(endpoint, host());
      models.retire();
      preferences.render();
      void models.load({ host: endpoint, harnessId: harness, cwd: directory }, () => ownsRows() && cwd() === directory, ownsRows).then(() => {
        if (ownsRows()) preferences.render();
      });
      void config.load(directory);
    }
    function scheduleRefresh() {
      if (disposed) return;
      models.retire();
      config.retire();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 300);
    }
    function initTree() {
      if (disposed) return;
      directoryTree?.dispose();
      directoryTree = createDirectoryTree({ root: element("nsTree"), host, request, onPick: setCwd });
      directoryTree.reset();
    }
    function setCwd(value) {
      if (disposed) return;
      cwdInput.value = value;
      storage.setItem("pi-dish-cwd", value);
      scheduleRefresh();
    }
    function renderWorkspaces() {
      if (disposed) return;
      workspaceEvents.abort();
      workspaceEvents = new AbortController();
      const endpoint = Object.freeze({ ...host() }), view = generation;
      const seen = /* @__PURE__ */ new Set(), values = [];
      for (const session of [...options2.sessionState.sessions.active, ...options2.sessionState.sessions.previous]) {
        if (options2.multiHost() && (session.host || null) !== endpoint.hostId) continue;
        if (typeof session.cwd === "string" && session.cwd && !seen.has(session.cwd)) {
          seen.add(session.cwd);
          values.push(session.cwd);
        }
      }
      if (!values.length) {
        workspaceRoot.innerHTML = "";
        return;
      }
      workspaceRoot.innerHTML = '<span class="ns-workspaces-label">Workspaces</span>' + values.slice(0, 12).map((value) => `<button class="ns-workspace-chip" data-cwd="${escapeHtml(value)}" title="${escapeHtml(value)}">${escapeHtml(shortCwd(value))}</button>`).join("");
      for (const button of workspaceRoot.querySelectorAll(".ns-workspace-chip")) {
        const path = button.dataset.cwd;
        button.addEventListener("click", () => {
          if (path && isOpen() && view === generation && sameDirectoryHost(endpoint, host())) setCwd(path);
        }, { signal: workspaceEvents.signal });
      }
    }
    function open(value = {}) {
      if (disposed) return;
      generation++;
      spawnButton.disabled = false;
      spawnButton.textContent = "+ New session";
      options2.closeOtherViews();
      root.classList.add("new-session-open");
      draft = value.draft || null;
      nameInput.value = "";
      renderHosts();
      void directories.load().then(() => {
        if (isOpen()) renderWorkspaces();
      });
      void targets.load();
      void harnesses.load();
      cwdInput.value = value.cwd || storage.getItem("pi-dish-cwd") || "";
      error("");
      harnessId = storage.getItem(NEW_SESSION_HARNESS_KEY) || "pi";
      renderHarnesses();
      preferences.restore(harnessId);
      if (models.scope?.harnessId !== harnessId || !sameDirectoryHost(models.scope?.host || null, host())) {
        models.clear();
        try {
          const endpoint = Object.freeze({ ...host() }), harness = harnessId, view = generation;
          const cached = JSON.parse(storage.getItem(modelsCacheKey(harness, endpoint.hostId, options2.self().hostId)) || "null");
          if (Array.isArray(cached)) models.seed(
            { host: endpoint, harnessId: harness },
            cached,
            () => view === generation && isOpen() && sameDirectoryHost(endpoint, host()) && selectedHarness() === harness
          );
        } catch {
        }
      }
      preferences.render();
      renderWorkspaces();
      initTree();
    }
    function close() {
      if (isOpen()) {
        generation++;
        models.retire();
      }
      targets.retire();
      targetPicker.hide();
      directories.retire();
      directoryTree?.dispose();
      directoryTree = null;
      workspaceEvents.abort();
      root.classList.remove("new-session-open");
      options2.closeSettings();
      clearTimeout(refreshTimer);
      config.retire();
      autocomplete.hide();
    }
    function captureView() {
      const view = generation, open2 = isOpen(), selection = options2.sessionState.captureSelection(), pending = options2.currentSpawn();
      const endpoint = Object.freeze({ ...host() }), harness = selectedHarness(), directory = cwd();
      return () => !disposed && (!open2 || sameDirectoryHost(endpoint, host()) && harness === selectedHarness() && directory === cwd()) && view === generation && open2 === isOpen() && pending === options2.currentSpawn() && (selection ? options2.sessionState.ownsSelection(selection) : !options2.sessionState.currentSession);
    }
    function submit(value = {}) {
      if (disposed) return Promise.reject(new Error("New-session form is no longer available"));
      const target = value.host === void 0 ? hostId() : value.host;
      const endpoint = typeof target === "object" && target ? target : options2.host(target);
      if (!endpoint) return Promise.reject(new Error("Host is no longer available"));
      const view = generation, submittedDraft = value.draft === void 0 ? draft : value.draft;
      return options2.spawns.submit({
        ...value,
        host: endpoint,
        draft: submittedDraft,
        ownsView: value.ownsView || captureView(),
        onAccepted: () => {
          if (view === generation && draft === submittedDraft) draft = null;
        }
      });
    }
    async function create(cwdValue, targetHost = hostId()) {
      if (disposed) return;
      const selected = options2.host(targetHost);
      if (!selected) {
        options2.status("Host is no longer available", "error");
        return;
      }
      const endpoint = Object.freeze({ ...selected }), ownsView = captureView();
      let harness = storage.getItem(NEW_SESSION_HARNESS_KEY) || "pi";
      let target = null;
      try {
        if (cwdValue !== void 0 && sameDirectoryHost(endpoint, host())) await Promise.all([targets.load(), harnesses.load()]);
        if (sameDirectoryHost(endpoint, host())) {
          target = selectedTarget();
          harness = selectedHarness();
        }
        if (ownsView()) options2.status(target ? "Spawning in tmux\u2026" : "Creating session...", "working");
        const directory = cwdValue === void 0 ? cwd() : cwdValue;
        if (directory) storage.setItem("pi-dish-cwd", directory);
        await submit({ cwd: directory, target, harness, host: endpoint, ownsView, draft: null });
      } catch (error2) {
        if (ownsView()) options2.status(`Error: ${message3(error2)}`, "error");
      }
    }
    async function spawn() {
      if (disposed || spawnButton.disabled) return;
      const view = generation, ownsView = captureView();
      let target;
      try {
        target = selectedTarget();
      } catch (caught) {
        error(message3(caught));
        return;
      }
      const name = nameInput.value.trim(), directory = cwd();
      error("");
      spawnButton.disabled = true;
      spawnButton.textContent = "Starting\u2026";
      try {
        if (directory) storage.setItem("pi-dish-cwd", directory);
        await submit({
          name,
          cwd: directory,
          model: modelSelect.value || void 0,
          thinking: thinkingSelect.value || void 0,
          target,
          harness: selectedHarness(),
          ownsView
        });
      } catch (caught) {
        if (ownsView()) error(message3(caught));
      } finally {
        if (view === generation) {
          spawnButton.disabled = false;
          spawnButton.textContent = "+ New session";
        }
      }
    }
    return {
      open,
      close,
      isOpen,
      host,
      hostId,
      hostOptions,
      supports: supports2,
      setHostId,
      changeHost,
      cwd,
      setCwd,
      selectedHarness,
      changeHarness,
      harnessLabel,
      renderHosts,
      renderHarnesses,
      renderWorkspaces,
      refresh,
      scheduleRefresh,
      initTree,
      selectedTarget,
      captureView,
      submit,
      create,
      spawn,
      preferences,
      config,
      harnesses,
      directories,
      targets,
      targetPicker,
      hideCwd: () => autocomplete.hide(),
      error,
      get generation() {
        return generation;
      },
      get pendingDraft() {
        return draft;
      },
      dispose() {
        close();
        disposed = true;
        autocomplete.dispose();
        targetPicker.dispose();
      }
    };
  }

  // src/browser/recovery.ts
  var text4 = (value) => typeof value === "string" ? value : "";
  var message = (value) => value instanceof Error ? value.message : String(value);
  function decodeRecoveryMode(value) {
    return value === "restore" || value === "continue" ? value : "off";
  }
  function decodeRecoveryReport(value) {
    if (!record8(value)) throw new Error("Invalid recovery report");
    const rows = Array.isArray(value.sessions) ? value.sessions : [];
    const sessions = rows.flatMap((row) => record8(row) && typeof row.id === "string" && row.id ? [{
      id: row.id,
      name: text4(row.name),
      harnessId: text4(row.harnessId),
      cwd: text4(row.cwd),
      reason: text4(row.reason),
      status: text4(row.status),
      excluded: row.excluded === true,
      updatedAt: typeof row.updatedAt === "string" || typeof row.updatedAt === "number" ? row.updatedAt : null
    }] : []);
    return {
      mode: text4(value.mode) || "off",
      sessions,
      truncated: value.truncated === true,
      totalRecords: typeof value.totalRecords === "number" && Number.isFinite(value.totalRecords) ? value.totalRecords : sessions.length
    };
  }
  function createRecovery(options2) {
    const doc = options2.root.ownerDocument;
    const element = (id) => {
      const value = doc.getElementById(id);
      if (!value) throw new Error("Missing recovery element: " + id);
      return value;
    };
    const apiFetch = options2.request;
    const apiSend = (host, path, payload, method) => sendJson(apiFetch, host, path, payload, method);
    const effectiveHosts = options2.hosts;
    const hostIsDown = options2.down;
    const confirm = options2.confirm;
    let disposed = false;
    let preferencesSeq = 0;
    let preferenceEvents = null;
    let reportEvents = null;
    let preferenceEndpoint;
    let reportEndpoint;
    const snapshot = (host) => Object.freeze({ ...host });
    const sameHost = (left, right) => !!left && !!right && left.hostId === right.hostId && left.base === right.base && (left.token || "") === (right.token || "");
    function unmountPreferences() {
      ++preferencesSeq;
      preferenceEvents?.abort();
      preferenceEvents = null;
      preferenceEndpoint = void 0;
    }
    let recoveryHostId = null;
    let recoveryViewSeq = 0;
    function recoveryCapableHosts() {
      return effectiveHosts().filter((host) => options2.supports(host));
    }
    function selectRecoveryHost(hosts, preferredId) {
      return hosts.find((host) => host.hostId === preferredId) || hosts.find((host) => host.hostId === recoveryHostId) || hosts[0];
    }
    function recoveryHostOptions(hosts) {
      return hosts.map((host) => `<option value="${escapeHtml(host.hostId || "")}">${escapeHtml(hostDisplayLabel(host))}</option>`).join("");
    }
    function refreshRecoveryHosts() {
      if (disposed) return;
      const hosts = recoveryCapableHosts();
      const optionHtml = recoveryHostOptions(hosts);
      for (const id of ["recoverySettingsHost", "recoveryReportHost"]) {
        const select = doc.getElementById(id);
        if (!select || id === "recoveryReportHost" && !isRecoveryViewOpen()) continue;
        const previous = select.value;
        if (select.innerHTML !== optionHtml) {
          select.innerHTML = optionHtml;
          select.value = selectRecoveryHost(hosts, previous)?.hostId || "";
        }
        select.disabled = !hosts.length;
        const liveHost = hosts.find((host) => (host.hostId || "") === select.value);
        const endpoint = id === "recoverySettingsHost" ? preferenceEndpoint : reportEndpoint;
        if (select.value !== previous || endpoint && !sameHost(endpoint, liveHost)) select.dispatchEvent(new Event("change"));
      }
      const unavailable = doc.getElementById("recoveryUnavailableHosts");
      if (unavailable) {
        const missing = effectiveHosts().filter((host) => !options2.supports(host));
        unavailable.textContent = missing.map((host) => {
          const reason = hostIsDown(host) ? "unreachable or needs a token" : host.capabilities ? "update and restart pi-dish to enable recovery" : "capabilities not yet available";
          return hostDisplayLabel(host) + ": " + reason + ".";
        }).join(" ");
        unavailable.hidden = !missing.length;
      }
    }
    async function renderRecoveryPreferences() {
      unmountPreferences();
      const mountSeq = preferencesSeq;
      const section = doc.getElementById("recoveryPreferences");
      if (!section || disposed) return;
      await options2.fleetReady();
      if (disposed || mountSeq !== preferencesSeq || !section.isConnected || !options2.settingsOpen()) return;
      const events = preferenceEvents = new AbortController();
      const listener = { signal: events.signal };
      section.hidden = false;
      section.innerHTML = `<label for="recoveryMode"><strong>Session recovery</strong><small>Saved on the selected host for all devices. Runs whenever its server is launched; no boot-service setup is required. Restore opens sessions idle. Continue may incur model cost and perform external actions; tool execution is not exactly-once.</small></label>
      <div class="recovery-controls">
        <label for="recoverySettingsHost">Host</label><select id="recoverySettingsHost"></select>
        <select id="recoveryMode" disabled aria-label="Recovery mode"><option value="off">Off</option><option value="restore">Restore open sessions</option><option value="continue">Restore and continue interrupted work</option></select>
        <div class="recovery-actions"><button class="btn-small" id="saveRecoveryMode" disabled>Save</button><button class="btn-small" id="openRecoveryReport">Recovery report</button></div>
        <small id="recoverySettingsStatus" role="status"></small>
        <small id="recoveryUnavailableHosts" role="status" hidden></small>
      </div>`;
      const hostSelect = section.querySelector("#recoverySettingsHost");
      const mode = section.querySelector("#recoveryMode");
      const save = section.querySelector("#saveRecoveryMode");
      const status = section.querySelector("#recoverySettingsStatus");
      const report = section.querySelector("#openRecoveryReport");
      hostSelect.innerHTML = recoveryHostOptions(recoveryCapableHosts());
      hostSelect.value = selectRecoveryHost(recoveryCapableHosts(), options2.selectedHost())?.hostId || "";
      let seq = 0;
      const selectedHost = () => recoveryCapableHosts().find((host) => (host.hostId || "") === hostSelect.value);
      const ownsView = () => !disposed && mountSeq === preferencesSeq && section.isConnected && options2.settingsOpen();
      const owns = (request, host) => ownsView() && seq === request && sameHost(host, selectedHost());
      const load = async () => {
        if (!ownsView()) return;
        const request = ++seq, selected = selectedHost();
        const host = preferenceEndpoint = selected ? snapshot(selected) : void 0;
        mode.disabled = save.disabled = report.disabled = true;
        if (!host) {
          status.textContent = "No connected host currently advertises recovery support.";
          return;
        }
        recoveryHostId = host.hostId;
        report.disabled = false;
        status.textContent = "Loading host setting\u2026";
        try {
          const res = await apiFetch(host, "/api/settings", { timeoutMs: 2e4 });
          const data = await res.json();
          if (!res.ok) throw new Error(record8(data) && text4(data.error) || `HTTP ${res.status}`);
          if (!owns(request, host)) return;
          mode.value = decodeRecoveryMode(record8(data) ? data.recoveryMode : null);
          mode.disabled = save.disabled = false;
          status.textContent = "";
        } catch (error) {
          if (owns(request, host)) status.textContent = "Could not load: " + message(error);
        }
      };
      hostSelect.addEventListener("change", () => {
        void load();
      }, listener);
      report.addEventListener("click", () => {
        const host = selectedHost();
        if (host && ownsView()) openRecoveryView(host.hostId);
      }, listener);
      save.addEventListener("click", async () => {
        const selected = selectedHost(), value = decodeRecoveryMode(mode.value);
        if (!selected || !ownsView() || save.disabled || !sameHost(preferenceEndpoint, selected)) return;
        const host = snapshot(selected);
        if (value === "continue" && !confirm("On future server launches, continue interrupted work automatically? This may incur cost and repeat external actions. Tool execution is not exactly-once.")) return;
        const request = ++seq;
        mode.disabled = save.disabled = true;
        status.textContent = "Saving\u2026";
        try {
          await apiSend(host, "/api/settings", { recoveryMode: value }, "PUT");
          if (owns(request, host)) status.textContent = "Saved on " + hostDisplayLabel(host) + " for future server launches.";
        } catch (error) {
          if (owns(request, host)) status.textContent = "Save failed: " + message(error);
        } finally {
          if (owns(request, host)) mode.disabled = save.disabled = false;
        }
      }, listener);
      void load();
      refreshRecoveryHosts();
      void options2.refreshFleet();
    }
    function isRecoveryViewOpen() {
      return !disposed && options2.root.classList.contains("recovery-open");
    }
    function closeRecoveryView() {
      if (disposed) return;
      const select = doc.getElementById("recoveryReportHost");
      if (select) select.onchange = null;
      recoveryViewSeq += 1;
      reportEvents?.abort();
      reportEvents = null;
      reportEndpoint = void 0;
      options2.root.classList.remove("recovery-open");
    }
    function openRecoveryView(hostId) {
      const hosts = recoveryCapableHosts();
      if (disposed || !hosts.length) return;
      options2.closeOtherViews();
      options2.root.classList.add("recovery-open");
      const hostSelect = element("recoveryReportHost");
      hostSelect.innerHTML = recoveryHostOptions(hosts);
      hostSelect.value = selectRecoveryHost(hosts, hostId)?.hostId || "";
      hostSelect.onchange = () => {
        void loadRecoveryView();
      };
      loadRecoveryView();
    }
    async function loadRecoveryView() {
      if (!isRecoveryViewOpen()) return;
      const seq = ++recoveryViewSeq;
      reportEvents?.abort();
      const events = reportEvents = new AbortController();
      const listener = { signal: events.signal };
      const hostSelect = element("recoveryReportHost");
      const selectedHost = () => recoveryCapableHosts().find((entry) => (entry.hostId || "") === hostSelect.value);
      const selected = selectedHost();
      const host = reportEndpoint = selected ? snapshot(selected) : void 0;
      const body = element("recoveryViewBody");
      const owns = () => seq === recoveryViewSeq && isRecoveryViewOpen() && sameHost(host, selectedHost());
      if (!host) {
        body.textContent = "This host no longer advertises recovery support.";
        return;
      }
      recoveryHostId = host.hostId;
      body.innerHTML = '<div class="usage-state" role="status">Loading recovery report\u2026</div>';
      try {
        const res = await apiFetch(host, "/api/recovery", { timeoutMs: 2e4 });
        const data = await res.json();
        if (!owns()) return;
        if (!res.ok) throw new Error(record8(data) && text4(data.error) || `HTTP ${res.status}`);
        const report = decodeRecoveryReport(data);
        const modes = { off: "Off", restore: "Restore open sessions", continue: "Restore and continue interrupted work" };
        body.innerHTML = `<p class="recovery-note"><strong>${escapeHtml(Object.hasOwn(modes, report.mode) ? modes[report.mode] : report.mode)}</strong> on ${escapeHtml(hostDisplayLabel(host))}. Recovery runs when this host\u2019s server starts, not when this report opens.</p>
        <p class="recovery-note">Needs review means recovery could not safely decide what happened. Inspect the transcript and any external actions before proceeding. Restore only reopens the session idle; it does not replay an uncertain prompt. Excluding a session prevents automatic recovery, without closing it.</p>
        <div id="recoveryActionStatus" role="status" class="recovery-note"></div>
        <div class="recovery-list"></div>`;
        const list = body.querySelector(".recovery-list");
        const records = report.sessions;
        let actionBusy = false;
        if (report.truncated) {
          const note = doc.createElement("p");
          note.className = "recovery-note";
          note.textContent = `Showing the newest ${records.length} of ${report.totalRecords} recovery records. Older observations are not shown.`;
          list.before(note);
        }
        if (!records.length) list.innerHTML = '<div class="usage-state">No recorded sessions on this host yet.</div>';
        for (const record9 of records) {
          const row = doc.createElement("article");
          row.className = "recovery-row";
          row.dataset.sessionId = record9.id;
          const canRestore = ["needs-review", "failed"].includes(record9.status);
          row.innerHTML = `<div class="recovery-row-heading"><strong>${escapeHtml(record9.name || record9.id)}</strong><span class="recovery-status">${escapeHtml(record9.status)}</span></div>
          <div class="recovery-meta">${escapeHtml(record9.harnessId || "")} \xB7 ${escapeHtml(record9.cwd || "Working directory unavailable")}</div>
          <div class="recovery-reason">${escapeHtml(record9.reason || "")}</div>
          <div class="recovery-meta">${escapeHtml(record9.id)}${record9.updatedAt ? " \xB7 " + escapeHtml(new Date(record9.updatedAt).toLocaleString()) : ""}</div>
          <div class="recovery-actions"><label><input type="checkbox" class="recovery-excluded"${record9.excluded ? " checked" : ""}> Exclude from automatic recovery</label>${canRestore ? '<button class="btn-small recovery-restore">Restore idle</button>' : ""}</div>`;
          list.appendChild(row);
          const action = async (path, payload, method) => {
            if (!owns() || actionBusy) return;
            actionBusy = true;
            const controls = body.querySelectorAll("input, button");
            controls.forEach((control) => {
              control.disabled = true;
            });
            const status = body.querySelector("#recoveryActionStatus");
            status.textContent = "Updating " + (record9.name || record9.id) + "\u2026";
            try {
              await apiSend(host, path, payload, method);
              if (owns()) await loadRecoveryView();
            } catch (error) {
              if (!owns()) return;
              status.textContent = "Action failed: " + message(error) + ". Refresh the report to check the host\u2019s outcome before trying again.";
              row.querySelector(".recovery-excluded").checked = record9.excluded;
              actionBusy = false;
              controls.forEach((control) => {
                control.disabled = false;
              });
            }
          };
          const excluded = row.querySelector(".recovery-excluded");
          excluded.addEventListener("change", () => {
            void action(`/api/sessions/${encodeURIComponent(record9.id)}/recovery`, { excluded: excluded.checked }, "PUT");
          }, listener);
          row.querySelector(".recovery-restore")?.addEventListener("click", () => {
            if (owns() && !actionBusy && confirm("Restore " + (record9.name || record9.id) + " idle? This will not replay uncertain work. Review its transcript before sending another prompt.")) {
              void action("/api/recovery/retry", { id: record9.id }, "POST");
            }
          }, listener);
        }
      } catch (error) {
        if (owns()) body.textContent = "Could not load recovery report: " + message(error);
      }
    }
    function dispose() {
      unmountPreferences();
      closeRecoveryView();
      disposed = true;
      const select = doc.getElementById("recoveryReportHost");
      if (select) select.onchange = null;
    }
    return {
      mountPreferences: renderRecoveryPreferences,
      unmountPreferences,
      refreshHosts: refreshRecoveryHosts,
      open: openRecoveryView,
      close: closeRecoveryView,
      isOpen: isRecoveryViewOpen,
      load: loadRecoveryView,
      dispose
    };
  }

  // src/browser/bounce-data.ts
  var text5 = (value) => typeof value === "string" ? value : "";
  var bounceMode = (value) => value === "restart" ? "restart" : "reload";
  function decodeBouncePreview(value) {
    if (!record8(value) || !Array.isArray(value.targets)) throw new Error("Invalid preview response");
    return value.targets.flatMap((target) => record8(target) && typeof target.sessionId === "string" && target.sessionId ? [{
      sessionId: target.sessionId,
      name: text5(target.name),
      harnessId: text5(target.harnessId),
      eligible: target.eligible === true,
      reason: text5(target.reason),
      blockers: Array.isArray(target.blockers) ? target.blockers.filter((v) => typeof v === "string") : []
    }] : []);
  }
  function decodeBounceOperation(value) {
    if (!record8(value) || typeof value.id !== "string" || !value.id || !Array.isArray(value.targets) || value.mode !== "reload" && value.mode !== "restart") throw new Error("Invalid operation response");
    return {
      id: value.id,
      mode: value.mode,
      createdAt: typeof value.createdAt === "string" || typeof value.createdAt === "number" ? value.createdAt : "",
      targets: value.targets.flatMap((target) => record8(target) && typeof target.sessionId === "string" && target.sessionId ? [{
        sessionId: target.sessionId,
        name: text5(target.name),
        harnessId: text5(target.harnessId),
        status: text5(target.status),
        reason: text5(target.reason),
        replacementId: text5(target.replacementId)
      }] : [])
    };
  }
  function decodeBounceOperations(value) {
    if (!record8(value) || !Array.isArray(value.operations)) throw new Error("Invalid operations response");
    return value.operations.map(decodeBounceOperation);
  }

  // src/browser/bounce.ts
  function createBounce(options2) {
    const document2 = options2.document, apiFetch = options2.request, sessionState = options2.sessionState;
    const effectiveHosts = options2.hosts, refreshSessions = options2.refreshSessions, selectSession = options2.selectSession;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing bounce element: " + id);
      return value;
    };
    const message3 = (error) => error instanceof Error ? error.message : String(error);
    let disposed = false;
    function retire(state) {
      clearTimeout(state.timer);
      state.previewEvents.abort();
      state.operationEvents.abort();
    }
    function sameHost(host) {
      return effectiveHosts().some((current) => current.hostId === host.hostId && current.base === host.base && (current.token || "") === (host.token || ""));
    }
    let bounceHosts = [];
    let bounceGeneration = 0;
    let bounceSubmitting = false;
    const bouncePendingRestarts = /* @__PURE__ */ new Set();
    function isBounceViewOpen() {
      return !disposed && element("bounceView").open;
    }
    function closeBounceView() {
      if (disposed) return;
      element("bounceView").open = false;
      ++bounceGeneration;
      for (const state of bounceHosts) retire(state);
    }
    async function refreshBounceView() {
      if (bounceSubmitting || !isBounceViewOpen()) return;
      const generation = ++bounceGeneration;
      for (const state of bounceHosts) retire(state);
      bounceHosts = [];
      updateBounceSelection();
      element("bounceHosts").textContent = "Loading hosts\u2026";
      element("bounceNotice").textContent = "";
      await options2.fleetReady();
      if (generation !== bounceGeneration || !isBounceViewOpen()) return;
      const mode = bounceMode(element("bounceMode").value);
      bounceHosts = effectiveHosts().map((host) => ({
        host: Object.freeze({ ...host }),
        mode,
        generation,
        supported: host.capabilities?.sessionBounces === true,
        targets: [],
        selected: /* @__PURE__ */ new Set(),
        operations: [],
        previewError: "",
        operationError: "",
        actionNotice: "",
        cancelling: /* @__PURE__ */ new Set(),
        loading: true,
        timer: void 0,
        polling: false,
        readSeq: 0,
        previewEvents: new AbortController(),
        operationEvents: new AbortController()
      }));
      element("bounceHosts").innerHTML = bounceHosts.map((state, index) => `<section class="bounce-host" data-bounce-host="${index}">
        <h3>${escapeHtml(hostDisplayLabel(state.host))}</h3>
        ${state.supported ? `<div class="bounce-preview"></div><div class="bounce-operations"></div>` : '<p class="bounce-help">Update this host to enable bouncing.</p>'}
      </section>`).join("");
      for (const state of bounceHosts) {
        if (!state.supported) continue;
        renderBouncePreview(state);
        renderBounceOperations(state);
        loadBouncePreview(state);
        pollBounceOperations(state);
      }
    }
    function bounceHostElement(state) {
      if (state.generation !== bounceGeneration || !isBounceViewOpen() || !sameHost(state.host)) return null;
      const index = bounceHosts.indexOf(state);
      return index < 0 ? null : document2.querySelector(`[data-bounce-host="${index}"]`);
    }
    async function loadBouncePreview(state) {
      try {
        const res = await apiFetch(state.host, `/api/session-bounces/preview?mode=${state.mode}`, { timeoutMs: 2e4 });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(record8(data) && typeof data.error === "string" && data.error || `HTTP ${res.status}`);
        if (!bounceHostElement(state)) return;
        state.targets = decodeBouncePreview(data);
      } catch (error) {
        state.previewError = `Preview unavailable: ${message3(error)}`;
      }
      state.loading = false;
      renderBouncePreview(state);
      updateBounceSelection();
    }
    function renderBouncePreview(state) {
      const root = bounceHostElement(state)?.querySelector(".bounce-preview");
      if (!root) return;
      state.previewEvents.abort();
      state.previewEvents = new AbortController();
      root.innerHTML = state.loading ? '<p class="bounce-help">Loading preview\u2026</p>' : state.previewError ? `<p class="bounce-error" role="status">${escapeHtml(state.previewError)}</p>` : state.targets.length ? state.targets.map((target, index) => {
        const eligible = target.eligible === true;
        const blockers = Array.isArray(target.blockers) ? target.blockers : [];
        const reason = [target.reason, ...blockers].filter(Boolean).join(" \xB7 ");
        return `<label class="bounce-target${eligible ? "" : " ineligible"}">
          <input type="checkbox" data-bounce-target="${index}" ${eligible && !bounceSubmitting ? "" : "disabled"} ${state.selected.has(target.sessionId) ? "checked" : ""}>
          <span><strong>${escapeHtml(target.name || target.sessionId)}</strong>
            <small>${escapeHtml(target.harnessId || "Unknown harness")} \xB7 ${eligible ? blockers.length ? "Eligible \u2014 waiting" : "Eligible" : "Ineligible"}</small>
            ${reason ? `<small>${escapeHtml(reason)}</small>` : ""}
          </span>
        </label>`;
      }).join("") : '<p class="bounce-help">No active sessions.</p>';
      root.querySelectorAll("[data-bounce-target]").forEach((input) => input.addEventListener("change", () => {
        const target = state.targets[Number(input.dataset.bounceTarget)];
        if (!bounceHostElement(state) || bounceSubmitting || !target?.eligible) return;
        if (input.checked) state.selected.add(target.sessionId);
        else state.selected.delete(target.sessionId);
        updateBounceSelection();
      }, { signal: state.previewEvents.signal }));
    }
    function selectBounceTargets(selected) {
      if (bounceSubmitting || !isBounceViewOpen()) return;
      for (const state of bounceHosts) {
        if (!bounceHostElement(state)) continue;
        state.selected = new Set(selected ? state.targets.filter((target) => target.eligible === true).map((target) => target.sessionId) : []);
        renderBouncePreview(state);
      }
      updateBounceSelection();
    }
    function updateBounceSelection() {
      if (disposed) return;
      const count2 = bounceHosts.reduce((sum, state) => sum + (bounceHostElement(state) ? state.selected.size : 0), 0);
      const mode = element("bounceMode").value === "restart" ? "Restart" : "Reload";
      const submit = element("bounceSubmit");
      submit.disabled = !count2 || bounceSubmitting;
      submit.textContent = bounceSubmitting ? "Queueing\u2026" : `Queue ${mode} (${count2})`;
      for (const id of ["bounceMode", "bounceRefresh", "bounceSelectEligible", "bounceClearSelection"]) {
        element(id).disabled = bounceSubmitting;
      }
    }
    async function submitBounceTargets() {
      if (bounceSubmitting || !isBounceViewOpen()) return;
      const snapshot = bounceHosts.filter((state) => state.selected.size && bounceHostElement(state)).map((state) => ({ state, sessionIds: [...state.selected] }));
      if (!snapshot.length) return;
      bounceSubmitting = true;
      updateBounceSelection();
      for (const { state } of snapshot) {
        state.selected.clear();
        state.actionNotice = "";
        renderBouncePreview(state);
      }
      await Promise.allSettled(snapshot.map(async ({ state, sessionIds }) => {
        try {
          const res = await apiFetch(state.host, "/api/session-bounces", {
            method: "POST",
            timeoutMs: 2e4,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: state.mode, sessionIds })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(record8(data) && typeof data.error === "string" && data.error || `HTTP ${res.status}`);
          const operation = decodeBounceOperation(record8(data) ? data.operation : null);
          ++state.readSeq;
          state.operations = [operation, ...state.operations.filter((op) => op.id !== operation.id)];
          state.actionNotice = "Snapshot queued on this host.";
          await reconcileBounceRestarts(state, [operation], true);
        } catch (error) {
          state.actionNotice = `Queue request failed: ${message3(error)}. Acceptance may be unknown; check recent operations before selecting again.`;
        }
        renderBounceOperations(state);
      }));
      bounceSubmitting = false;
      updateBounceSelection();
      for (const state of bounceHosts) renderBouncePreview(state);
      if (isBounceViewOpen() && bounceHosts.some((state) => state.generation !== bounceGeneration)) refreshBounceView();
    }
    async function pollBounceOperations(state) {
      if (!bounceHostElement(state) || state.polling) return;
      clearTimeout(state.timer);
      state.polling = true;
      const seq = ++state.readSeq;
      try {
        const res = await apiFetch(state.host, "/api/session-bounces", { timeoutMs: 2e4 });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(record8(data) && typeof data.error === "string" && data.error || `HTTP ${res.status}`);
        const operations = decodeBounceOperations(data);
        if (seq === state.readSeq && bounceHostElement(state)) {
          state.operations = operations;
          state.operationError = "";
          await reconcileBounceRestarts(state, operations);
        }
      } catch (error) {
        if (seq === state.readSeq) state.operationError = `Status unavailable: ${message3(error)}. Displayed operations may be stale.`;
      }
      state.polling = false;
      renderBounceOperations(state);
      if (bounceHostElement(state)) state.timer = setTimeout(() => pollBounceOperations(state), 2500);
    }
    function renderBounceOperations(state) {
      const root = bounceHostElement(state)?.querySelector(".bounce-operations");
      if (!root) return;
      const html = `${state.actionNotice ? `<p class="usage-notice" role="status">${escapeHtml(state.actionNotice)}</p>` : ""}
      ${state.operationError ? `<p class="bounce-error" role="status">${escapeHtml(state.operationError)}</p>` : ""}
      ${state.operations.length ? state.operations.map((operation, index) => {
        const waiting = operation.targets.some((target) => target.status === "waiting");
        return `<article class="bounce-operation" data-operation-id="${escapeHtml(operation.id)}">
          <div class="bounce-operation-header"><strong>${operation.mode === "restart" ? "Restart" : "Reload"}</strong>
            <time>${escapeHtml(new Date(operation.createdAt).toLocaleString())}</time>
            ${waiting ? `<button class="btn-small" data-bounce-cancel="${index}" ${state.cancelling.has(operation.id) ? "disabled" : ""}>${state.cancelling.has(operation.id) ? "Cancelling\u2026" : "Cancel waiting"}</button>` : ""}
          </div>
          <ul>${operation.targets.map((target) => `<li><span class="bounce-result" data-status="${escapeHtml(target.status)}">${escapeHtml(target.status)}</span>
            <span><strong>${escapeHtml(target.name || target.sessionId)}</strong><small>${escapeHtml(target.harnessId || "")}${target.reason ? ` \xB7 ${escapeHtml(target.reason)}` : ""}</small></span></li>`).join("")}</ul>
        </article>`;
      }).join("") : ""}`;
      if (root.innerHTML === html) return;
      state.operationEvents.abort();
      state.operationEvents = new AbortController();
      root.innerHTML = html;
      root.querySelectorAll("[data-bounce-cancel]").forEach((button) => {
        const operation = state.operations[Number(button.dataset.bounceCancel)];
        button.addEventListener("click", () => {
          if (operation && state.operations.some((current) => current.id === operation.id)) void cancelBounceWaiting(state, operation);
        }, { signal: state.operationEvents.signal });
      });
    }
    async function cancelBounceWaiting(state, operation) {
      if (!bounceHostElement(state) || state.cancelling.has(operation.id)) return;
      state.cancelling.add(operation.id);
      renderBounceOperations(state);
      try {
        const res = await apiFetch(state.host, `/api/session-bounces/${encodeURIComponent(operation.id)}`, { method: "DELETE", timeoutMs: 2e4 });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(record8(data) && typeof data.error === "string" && data.error || `HTTP ${res.status}`);
        const updated = decodeBounceOperation(record8(data) ? data.operation : null);
        ++state.readSeq;
        state.operations = state.operations.map((op) => op.id === operation.id ? updated : op);
        state.actionNotice = "Waiting targets cancelled. Executing targets continue.";
        await reconcileBounceRestarts(state, [updated]);
      } catch (error) {
        state.actionNotice = `Cancellation failed: ${message3(error)}. Check status before trying again.`;
      }
      state.cancelling.delete(operation.id);
      renderBounceOperations(state);
    }
    async function reconcileBounceRestarts(state, operations, submitted = false) {
      if (disposed) return;
      const completed = [];
      for (const operation of operations) {
        if (operation.mode !== "restart") continue;
        for (const target of operation.targets) {
          const key = sessionKey(state.host.hostId, `${operation.id}:${target.sessionId}`);
          if (target.status === "waiting" || target.status === "executing") bouncePendingRestarts.add(key);
          else if (target.status === "completed") {
            if (submitted) bouncePendingRestarts.add(key);
            if (bouncePendingRestarts.has(key)) completed.push({ target, key });
          } else bouncePendingRestarts.delete(key);
        }
      }
      if (!completed.length || !bounceHostElement(state)) return;
      const owner = sessionState.captureSelection();
      const affected = completed.find(({ target }) => target.sessionId === owner?.id && owner?.host === (state.host.hostId || null))?.target;
      await refreshSessions();
      if (!bounceHostElement(state)) return;
      const id = affected?.replacementId || affected?.sessionId;
      if (affected && owner && id && !sessionState.findSession(id, owner.host)) await options2.loadPrevious();
      if (!bounceHostElement(state)) return;
      for (const { key } of completed) bouncePendingRestarts.delete(key);
      if (!affected || !id || !owner || !sessionState.ownsSelection(owner)) return;
      await selectSession(id, { host: owner.host, keepBounceView: true });
    }
    return {
      close: closeBounceView,
      isOpen: isBounceViewOpen,
      refresh: refreshBounceView,
      select: selectBounceTargets,
      submit: submitBounceTargets,
      dispose() {
        closeBounceView();
        disposed = true;
        bouncePendingRestarts.clear();
      }
    };
  }

  // src/browser/helper-sessions.ts
  function groupByWorkspace(list, collapsedSet) {
    const groups = /* @__PURE__ */ new Map();
    for (const s of list) {
      const key = s.cwd || "~";
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(s);
    }
    for (const [, sessions] of groups) {
      sessions.sort((a, b) => timestampMillis(b.lastActivity) - timestampMillis(a.lastActivity));
    }
    const collapsed = (cwd) => collapsedSet?.has(cwd) ? 1 : 0;
    return [...groups.entries()].sort((a, b) => collapsed(a[0]) - collapsed(b[0]) || timestampMillis(b[1][0].lastActivity) - timestampMillis(a[1][0].lastActivity));
  }
  function buildWorkspaceTree(groups, collapsedSet) {
    const root = { label: "", path: "", sessions: null, children: /* @__PURE__ */ new Map(), order: 0 };
    groups.forEach(([cwd, sessions], order) => {
      let segs = cwd.split("/").filter(Boolean);
      if (segs.length === 0) segs = [cwd];
      let node = root;
      for (const seg of segs) {
        const path = node === root ? cwd[0] === "/" && seg !== cwd ? "/" + seg : seg : node.path + "/" + seg;
        let child = node.children.get(seg);
        if (!child) {
          child = { label: seg, path, sessions: null, children: /* @__PURE__ */ new Map(), order };
          node.children.set(seg, child);
        }
        node = child;
        node.order = Math.min(node.order, order);
      }
      node.sessions = sessions;
    });
    const flatten = (node) => {
      while (node.children.size === 1 && !node.sessions) {
        const child = node.children.values().next().value;
        if (!child) break;
        node.label = node.label ? node.label + "/" + child.label : child.label;
        node.path = child.path;
        node.sessions = child.sessions;
        node.children = child.children;
      }
      for (const child of node.children.values()) flatten(child);
    };
    for (const top of root.children.values()) flatten(top);
    const tops = [...root.children.values()];
    const homeIdx = tops.findIndex((t) => shortCwd(t.path) === "~" && !t.sessions && t.children.size);
    if (homeIdx !== -1) tops.splice(homeIdx, 1, ...tops[homeIdx].children.values());
    const collapsed = (path) => collapsedSet?.has(path) ? 1 : 0;
    const finalize = (node, topLevel) => {
      const children = [...node.children.values()].map((child) => finalize(child, false));
      children.sort((a, b) => collapsed(a.path) - collapsed(b.path) || a.order - b.order);
      return {
        ...node,
        children,
        count: (node.sessions ? node.sessions.length : 0) + children.reduce((n, child) => n + child.count, 0),
        label: topLevel ? shortCwd(node.path) : node.label
      };
    };
    return tops.map((top) => finalize(top, true)).sort((a, b) => collapsed(a.path) - collapsed(b.path) || a.order - b.order);
  }
  function groupSessionsByDate(list, now = Date.now()) {
    const day = (t) => {
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };
    const today = day(now);
    const yesterday = today - 864e5;
    const weekStart = today - (new Date(today).getDay() + 6) % 7 * 864e5;
    const lastWeekStart = weekStart - 7 * 864e5;
    const bucketOf = (t) => {
      if (!finite2(t) || t <= 0) return { key: "undated", label: "Undated" };
      if (t >= today) return { key: "today", label: "Today" };
      if (t >= yesterday) return { key: "yesterday", label: "Yesterday" };
      if (t >= weekStart) return { key: "week", label: "This week" };
      if (t >= lastWeekStart) return { key: "lastweek", label: "Last week" };
      const d = new Date(t);
      return {
        key: `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString(void 0, { month: "long", year: "numeric" })
      };
    };
    const timestampOf = (item) => finite2(item?.activity) ? item.activity : new Date(item?.lastActivity || 0).getTime();
    const sorted = [...list].sort((a, b) => timestampOf(b) - timestampOf(a));
    const buckets = /* @__PURE__ */ new Map();
    for (const s of sorted) {
      const b = bucketOf(timestampOf(s));
      let bucket2 = buckets.get(b.key);
      if (!bucket2) {
        bucket2 = { ...b, sessions: [] };
        buckets.set(b.key, bucket2);
      }
      bucket2.sessions.push(s);
    }
    const out = [...buckets.values()];
    const u = out.findIndex((b) => b.key === "undated");
    if (u !== -1) out.push(out.splice(u, 1)[0]);
    return out;
  }
  function collectTreeSessions(node, out = []) {
    if (node.sessions) out.push(...node.sessions);
    for (const child of node.children) collectTreeSessions(child, out);
    return out;
  }
  function sessionFamilyParentId(session) {
    return Object.prototype.hasOwnProperty.call(session || {}, "familyParentId") ? session?.familyParentId : session?.parentId;
  }
  function buildSessionFamilies(list) {
    const nodes = /* @__PURE__ */ new Map();
    (list || []).forEach((session, order) => {
      if (session?.id && !nodes.has(sessionRefKey(session))) {
        nodes.set(sessionRefKey(session), { session, children: [], activity: 0, size: 1, order });
      }
    });
    const attached = /* @__PURE__ */ new Set();
    for (const node of nodes.values()) {
      const parent = nodes.get(sessionKey(node.session.host, sessionFamilyParentId(node.session)));
      if (!parent || parent === node || (parent.session.cwd || "~") !== (node.session.cwd || "~")) continue;
      let cursor2 = parent;
      const seen = /* @__PURE__ */ new Set();
      let cyclic = false;
      while (cursor2 && !seen.has(cursor2)) {
        if (cursor2 === node) {
          cyclic = true;
          break;
        }
        seen.add(cursor2);
        const next = nodes.get(sessionKey(cursor2.session.host, sessionFamilyParentId(cursor2.session)));
        cursor2 = next && (next.session.cwd || "~") === (cursor2.session.cwd || "~") ? next : null;
      }
      if (cyclic) continue;
      parent.children.push(node);
      attached.add(sessionRefKey(node.session));
    }
    const activityMs = (session) => {
      const value = new Date(session.lastActivity || 0).getTime();
      return finite2(value) ? value : 0;
    };
    const finalize = (node) => {
      node.activity = activityMs(node.session);
      node.size = 1;
      for (const child of node.children) {
        finalize(child);
        node.activity = Math.max(node.activity, child.activity);
        node.size += child.size;
      }
      node.children.sort((a, b) => b.activity - a.activity || a.order - b.order);
      return node;
    };
    const roots = [...nodes.values()].filter((node) => !attached.has(sessionRefKey(node.session))).map(finalize);
    return roots.sort((a, b) => b.activity - a.activity || a.order - b.order);
  }
  function flattenSessionFamilies(families, out = []) {
    for (const family of families || []) {
      out.push(family.session);
      flattenSessionFamilies(family.children, out);
    }
    return out;
  }
  function partitionPinnedFamilies(families, pinnedKeys) {
    if (!pinnedKeys?.length) return [[], families || []];
    const rootByMember = /* @__PURE__ */ new Map();
    const index = (node, root) => {
      rootByMember.set(sessionRefKey(node.session), root);
      for (const child of node.children) index(child, root);
    };
    for (const root of families || []) index(root, root);
    const rootsByMissingParent = /* @__PURE__ */ new Map();
    for (const root of families || []) {
      const parentId = sessionFamilyParentId(root.session);
      if (!parentId) continue;
      const parentKey = sessionKey(root.session.host, parentId);
      if (rootByMember.has(parentKey)) continue;
      const roots = rootsByMissingParent.get(parentKey) || [];
      roots.push(root);
      rootsByMissingParent.set(parentKey, roots);
    }
    const pinned = [];
    const pinnedRoots = /* @__PURE__ */ new Set();
    for (const id of pinnedKeys) {
      const known = rootByMember.get(id);
      const matches = known ? [known] : rootsByMissingParent.get(id) || [];
      for (const root of matches) {
        if (pinnedRoots.has(sessionRefKey(root.session))) continue;
        pinned.push(root);
        pinnedRoots.add(sessionRefKey(root.session));
      }
    }
    return [pinned, (families || []).filter((root) => !pinnedRoots.has(sessionRefKey(root.session)))];
  }
  var RELATION_KIND_ORDER = { parent: 0, startedFrom: 1, child: 2, startedHere: 3 };
  var RELATION_CHILD_KINDS = /* @__PURE__ */ new Set(["child", "startedHere"]);
  function relationKindRank(kind) {
    const rank = kind && Object.hasOwn(RELATION_KIND_ORDER, kind) ? RELATION_KIND_ORDER[kind] : void 0;
    return rank === void 0 ? 99 : rank;
  }
  function sortRelations(relations) {
    return (relations || []).map((relation, index) => ({ relation, index })).sort((a, b) => relationKindRank(a.relation && a.relation.kind) - relationKindRank(b.relation && b.relation.kind) || a.index - b.index).map(({ relation }) => relation);
  }
  function isChildRelation(relation) {
    return RELATION_CHILD_KINDS.has(relation?.kind || "");
  }
  function groupRelations(relations) {
    const groups = [];
    const byKind = /* @__PURE__ */ new Map();
    for (const relation of relations || []) {
      const kind = relation && relation.kind || "related";
      let group = byKind.get(kind);
      if (!group) {
        group = { kind, relations: [] };
        byKind.set(kind, group);
        groups.push(group);
      }
      group.relations.push(relation);
    }
    groups.sort((a, b) => relationKindRank(a.kind) - relationKindRank(b.kind));
    return groups;
  }
  function isUnreadSession(session, seenMap, currentKey, viewingVisible) {
    if (!session.isActive || session.turnInProgress) return false;
    const key = sessionRefKey(session);
    if (key === currentKey && viewingVisible) return false;
    const seen = seenMap[key];
    return !seen || timestampMillis(session.lastActivity) > timestampMillis(seen);
  }

  // src/browser/session-relations.ts
  var text6 = (value) => typeof value === "string" ? value : "";
  function decodeSessionRelations(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((row) => {
      if (!record8(row) || !record8(row.session) || typeof row.session.id !== "string" || !row.session.id) return [];
      const session = row.session;
      return [{ kind: text6(row.kind), source: text6(row.source), session: {
        id: session.id,
        name: text6(session.name),
        cwd: text6(session.cwd),
        isActive: session.isActive === true,
        lastActivity: typeof session.lastActivity === "string" || typeof session.lastActivity === "number" ? session.lastActivity : null
      } }];
    });
  }
  function createSessionRelations(options2) {
    const { document: document2, window, sessionState } = options2;
    const element = (id) => document2.getElementById(id);
    let sessionRelationsSeq = 0;
    let disposed = false;
    let renderOwner = null;
    let renderEndpoint = null;
    let headerEvents = new AbortController(), modalEvents = new AbortController();
    const events = new AbortController();
    let indexingTimer;
    function sameEndpoint(host, endpoint) {
      const current = options2.endpoint(host);
      return !!endpoint && !!current && current.base === endpoint.base && (current.token || "") === (endpoint.token || "");
    }
    const owns = (owner, endpoint = renderEndpoint) => !disposed && sessionState.ownsSelection(owner) && !!owner && sameEndpoint(owner.host, endpoint);
    const label = (labels, kind, fallback2) => Object.hasOwn(labels, kind) ? labels[kind] : fallback2;
    function clearSessionRelations() {
      sessionRelationsSeq += 1;
      clearTimeout(indexingTimer);
      clearTimeout(relationResizeTimer);
      headerEvents.abort();
      renderOwner = null;
      renderEndpoint = null;
      sessionRelations = [];
      closeRelationsModal();
      const el = document2.getElementById("sessionRelations");
      if (!el) return;
      el.replaceChildren();
      el.style.display = "none";
    }
    const RELATION_LABELS = {
      parent: "Parent",
      child: "Child",
      startedFrom: "Started from",
      startedHere: "Started here"
    };
    const RELATION_GROUP_LABELS = {
      parent: "Parent",
      child: "Children",
      startedFrom: "Started from",
      startedHere: "Started here"
    };
    const RELATION_FALLBACK_VISIBLE_CHIPS = 6;
    let sessionRelations = [];
    let relationResizeTimer;
    function createRelationChip(relation) {
      const target = relation?.session;
      if (!target?.id) return null;
      const button = document2.createElement("button");
      button.type = "button";
      button.className = "session-relation-chip";
      button.title = `${label(RELATION_LABELS, relation.kind, "Related session")} \xB7 ${relation.source || "session metadata"}`;
      const kind = document2.createElement("span");
      kind.className = "session-relation-kind";
      kind.textContent = label(RELATION_LABELS, relation.kind, "Related");
      const name = document2.createElement("span");
      name.className = "session-relation-name";
      name.textContent = target.name || target.id.slice(0, 8);
      button.append(kind, name);
      const owner = renderOwner, endpoint = renderEndpoint;
      button.addEventListener("click", () => {
        if (owns(owner, endpoint)) void openRelatedSession(target.id, owner, endpoint);
      }, { signal: headerEvents.signal });
      return button;
    }
    function createMoreRelationChip(hiddenCount) {
      const more = document2.createElement("button");
      more.type = "button";
      more.className = "session-relation-chip session-relation-more";
      more.title = `Show ${hiddenCount} hidden related session${hiddenCount === 1 ? "" : "s"}`;
      const count2 = document2.createElement("span");
      count2.className = "session-relation-kind";
      count2.textContent = `+${hiddenCount}`;
      const label2 = document2.createElement("span");
      label2.className = "session-relation-name";
      label2.textContent = "more";
      more.append(count2, label2);
      const owner = renderOwner, endpoint = renderEndpoint;
      more.addEventListener("click", () => {
        if (owns(owner, endpoint)) openRelationsModal();
      }, { signal: headerEvents.signal });
      return more;
    }
    function fitRelationChipCount(el, chips, totalCount) {
      const available = el.clientWidth;
      if (!available) return Math.min(chips.length, RELATION_FALLBACK_VISIBLE_CHIPS);
      const style = getComputedStyle(el);
      const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
      const moreProbe = createMoreRelationChip(totalCount);
      el.replaceChildren(...chips, moreProbe);
      const widths = chips.map((chip) => chip.offsetWidth);
      const prefixWidths = [0];
      for (const width of widths) prefixWidths.push(prefixWidths[prefixWidths.length - 1] + width);
      let chosen = 0;
      for (let count2 = chips.length; count2 >= 0; count2 -= 1) {
        const hiddenCount = totalCount - count2;
        let needed = prefixWidths[count2] + Math.max(0, count2 - 1) * gap;
        if (hiddenCount > 0) {
          moreProbe.querySelector(".session-relation-kind").textContent = `+${hiddenCount}`;
          needed += (count2 ? gap : 0) + moreProbe.offsetWidth;
        }
        if (needed <= available) {
          chosen = count2;
          break;
        }
      }
      return chosen;
    }
    function renderSessionRelations(relations, owner = renderOwner, endpoint = renderEndpoint) {
      if (!owns(owner, endpoint)) return;
      renderOwner = owner;
      renderEndpoint = endpoint;
      headerEvents.abort();
      headerEvents = new AbortController();
      const el = element("sessionRelations");
      if (!el) return;
      sessionRelations = sortRelations(relations).filter((relation) => relation?.session?.id);
      el.replaceChildren();
      if (!sessionRelations.length) {
        closeRelationsModal();
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      const headerRelations = [
        // Keep live child bubbles visible when the row is tight; parent/source
        // links can still be reached from the overflow modal.
        ...sessionRelations.filter((relation) => isChildRelation(relation) && relation.session.isActive),
        ...sessionRelations.filter((relation) => !isChildRelation(relation))
      ];
      const chips = headerRelations.map(createRelationChip).filter((chip) => chip !== null);
      const visibleCount = fitRelationChipCount(el, chips, sessionRelations.length);
      const hiddenCount = sessionRelations.length - visibleCount;
      el.replaceChildren(...chips.slice(0, visibleCount));
      if (hiddenCount > 0) el.appendChild(createMoreRelationChip(hiddenCount));
      const modal = document2.getElementById("relationsModal");
      if (modal && modal.style.display !== "none") renderRelationsModal();
    }
    window.addEventListener("resize", () => {
      if (!owns(renderOwner) || !sessionRelations.length) return;
      clearTimeout(relationResizeTimer);
      relationResizeTimer = setTimeout(() => {
        const el = document2.getElementById("sessionRelations");
        if (sessionState.currentSession && el?.style.display !== "none") renderSessionRelations(sessionRelations);
      }, 100);
    }, { signal: events.signal });
    function openRelationsModal() {
      if (!owns(renderOwner) || !sessionRelations.length) return;
      const modal = element("relationsModal");
      if (!modal) return;
      modal.style.display = "flex";
      renderRelationsModal();
    }
    function closeRelationsModal() {
      modalEvents.abort();
      const modal = document2.getElementById("relationsModal");
      if (modal) modal.style.display = "none";
    }
    function renderRelationsModal() {
      if (!owns(renderOwner)) return;
      modalEvents.abort();
      modalEvents = new AbortController();
      const body = document2.getElementById("relationsBody");
      if (!body) return;
      body.replaceChildren();
      const owner = renderOwner, endpoint = renderEndpoint;
      for (const group of groupRelations(sessionRelations)) {
        const title = document2.createElement("div");
        title.className = "stats-share-title relation-group-title";
        const groupLabel = label(RELATION_GROUP_LABELS, group.kind || "", label(RELATION_LABELS, group.kind || "", "Related"));
        title.textContent = group.relations.length > 1 ? `${groupLabel} (${group.relations.length})` : groupLabel;
        body.appendChild(title);
        for (const relation of group.relations) {
          const target = relation?.session;
          if (!target?.id) continue;
          const row = document2.createElement("button");
          row.type = "button";
          row.className = "relation-row";
          row.title = target.cwd || target.id;
          if (target.isActive) {
            const dot = document2.createElement("span");
            dot.className = "live-dot";
            row.appendChild(dot);
          }
          const name = document2.createElement("span");
          name.className = "relation-row-name";
          name.textContent = target.name || target.id.slice(0, 8);
          row.appendChild(name);
          const meta = document2.createElement("span");
          meta.className = "relation-row-meta";
          meta.textContent = formatRelativeTime(target.lastActivity);
          row.appendChild(meta);
          row.addEventListener("click", () => {
            if (!owns(owner, endpoint)) return;
            closeRelationsModal();
            void openRelatedSession(target.id, owner, endpoint);
          }, { signal: modalEvents.signal });
          body.appendChild(row);
        }
      }
    }
    async function loadSessionRelations(owner) {
      if (disposed || !owner || !sessionState.ownsSelection(owner)) return;
      const resolved = options2.endpoint(owner.host);
      if (!resolved) return;
      const endpoint = Object.freeze({ ...resolved });
      const seq = ++sessionRelationsSeq;
      clearTimeout(indexingTimer);
      const current = () => seq === sessionRelationsSeq && owns(owner, endpoint);
      try {
        const res = await options2.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/related`);
        const data = await res.json();
        if (!current()) return;
        if (!res.ok) throw new Error(record8(data) && text6(data.error) || `HTTP ${res.status}`);
        renderSessionRelations(decodeSessionRelations(record8(data) ? data.relations : null), owner, endpoint);
        if (record8(data) && data.indexing === true) indexingTimer = setTimeout(() => {
          if (current()) void loadSessionRelations(owner);
        }, 1e3);
      } catch (error) {
        if (current()) {
          renderSessionRelations([], owner, endpoint);
          console.error("Failed to load related sessions:", error);
        }
      }
    }
    async function openRelatedSession(id, owner, endpoint = owner ? options2.endpoint(owner.host) : null) {
      if (!owns(owner, endpoint) || !owner) return;
      const captured = endpoint ? Object.freeze({ ...endpoint }) : null;
      if (!sessionState.findSession(id, owner.host)) await options2.loadPrevious();
      if (!owns(owner, captured)) return;
      if (!sessionState.findSession(id, owner.host)) {
        options2.status("Related session is not available yet", "error");
        return;
      }
      await options2.selectSession(id, { host: owner.host });
    }
    return {
      clear: clearSessionRelations,
      load: loadSessionRelations,
      openRelated: openRelatedSession,
      openModal: openRelationsModal,
      closeModal: closeRelationsModal,
      dispose() {
        clearSessionRelations();
        events.abort();
        disposed = true;
      }
    };
  }

  // src/browser/session-search.ts
  function decodeSessionSearch(value) {
    if (!record8(value) || !Array.isArray(value.matches)) throw new Error("Invalid session search response");
    return value.matches.flatMap((match) => record8(match) && typeof match.index === "number" && Number.isInteger(match.index) && match.index >= 0 ? [{ index: match.index, role: typeof match.role === "string" ? match.role : "" }] : []);
  }
  function createSessionSearch(options2) {
    const { document: document2, sessionState } = options2;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing search element: " + id);
      return value;
    };
    let query = "", matches = [], pos = -1;
    let sequence = 0, disposed = false;
    let navigation = null;
    function updateCount(message3) {
      if (disposed) return;
      element("searchCount").textContent = message3 !== void 0 ? message3 : matches.length ? `${pos + 1}/${matches.length}` : query ? "no matches" : "";
    }
    function clearMarks() {
      document2.querySelectorAll(".message.search-current").forEach((el) => el.classList.remove("search-current"));
      document2.querySelectorAll("mark.search-mark").forEach((mark) => {
        const parent = mark.parentNode;
        mark.replaceWith(document2.createTextNode(mark.textContent || ""));
        parent?.normalize();
      });
    }
    function open() {
      if (disposed || !sessionState.currentSession) return;
      element("searchBar").style.display = "";
      const input = element("searchInput");
      input.focus();
      input.select();
    }
    function close() {
      if (disposed) return;
      sequence++;
      element("searchBar").style.display = "none";
      query = "";
      matches = [];
      pos = -1;
      clearMarks();
      updateCount();
    }
    function reset() {
      close();
      navigation = null;
    }
    function toggle() {
      if (element("searchBar").style.display === "none") open();
      else close();
    }
    function sameEndpoint(owner, endpoint) {
      const current = options2.endpoint(owner.host);
      return !!current && current.base === endpoint.base && (current.token || "") === (endpoint.token || "");
    }
    async function run(value, { mode = "message", closeIfEmpty = false } = {}) {
      const owner = sessionState.captureSelection();
      const resolved = owner && options2.endpoint(owner.host);
      if (disposed || !owner || !resolved) return;
      const endpoint = Object.freeze({ ...resolved }), seq = ++sequence;
      const owns = () => !disposed && seq === sequence && sessionState.ownsSelection(owner) && sameEndpoint(owner, endpoint);
      updateCount("searching\u2026");
      try {
        const params = new URLSearchParams({ q: value });
        if (mode !== "message") params.set("mode", mode);
        const response = await options2.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/search?${params}`);
        const data = await response.json();
        if (!owns()) return;
        if (!response.ok || record8(data) && typeof data.error === "string" && data.error) throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
        query = value;
        const decoded = decodeSessionSearch(data);
        matches = options2.focusMode() ? decoded.filter((match) => match.role !== "toolResult") : decoded;
        pos = matches.length - 1;
        if (matches.length) await jump();
        else if (closeIfEmpty) {
          close();
          return;
        }
        if (owns()) updateCount();
      } catch (error) {
        if (owns()) {
          updateCount("search failed");
          console.error("Session search failed:", error);
        }
      }
    }
    async function jump() {
      const owner = sessionState.captureSelection(), match = matches[pos], seq = sequence, tokens2 = query.split(/\s+/).filter(Boolean);
      const resolved = owner && options2.endpoint(owner.host);
      if (disposed || !owner || !match || !resolved) return;
      const endpoint = Object.freeze({ ...resolved });
      const owns = () => !disposed && seq === sequence && sessionState.ownsSelection(owner) && sameEndpoint(owner, endpoint);
      if (navigation) {
        const pending = navigation;
        await pending.done;
        if (owns()) await jump();
        return;
      }
      let finish;
      const active = { owner, done: new Promise((resolve) => {
        finish = resolve;
      }) };
      navigation = active;
      try {
        const container = element("messages");
        let guard = 0;
        while (owns() && options2.oldestIndex() !== null && match.index < options2.oldestIndex() && options2.hasOlder() && guard++ < 200) await options2.loadOlder();
        if (!owns()) return;
        const el = container.querySelector(`[data-msg-index="${match.index}"]`);
        if (!el) {
          updateCount("not loaded");
          return;
        }
        const group = el.closest("details.tool-group");
        if (group) group.open = true;
        clearMarks();
        el.classList.add("search-current");
        markSearchTokens(el, tokens2);
        options2.stopFollowing();
        el.scrollIntoView({ block: "center" });
        options2.updateJumpButton(container);
        updateCount();
      } finally {
        if (navigation === active) navigation = null;
        finish();
      }
    }
    async function move(delta) {
      if (disposed || !matches.length || navigation) return;
      pos = (pos + delta + matches.length) % matches.length;
      updateCount();
      await jump();
    }
    function key(event) {
      if (disposed) return;
      if (event.key === "Enter") {
        event.preventDefault();
        const value = element("searchInput").value.trim().toLowerCase();
        if (!value) return;
        if (value !== query) void run(value);
        else void move(event.shiftKey ? 1 : -1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    const state = Object.freeze({ get query() {
      return query;
    }, get matches() {
      return matches;
    }, get pos() {
      return pos;
    }, get navigating() {
      return navigation !== null;
    } });
    return {
      state,
      open,
      close,
      reset,
      toggle,
      run,
      jump,
      move,
      key,
      clearMarks,
      updateCount,
      dispose() {
        reset();
        disposed = true;
      }
    };
  }
  function markSearchTokens(el, tokens2) {
    if (!tokens2.length) return;
    const document2 = el.ownerDocument;
    const walker = document2.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement?.closest("mark, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
      const text17 = node.textContent || "";
      const lower = text17.toLowerCase();
      const ranges = [];
      for (const token of tokens2) {
        let from = 0, at;
        while ((at = lower.indexOf(token, from)) !== -1) {
          ranges.push([at, at + token.length]);
          from = at + token.length;
        }
      }
      if (!ranges.length) continue;
      ranges.sort((a, b) => a[0] - b[0]);
      const frag = document2.createDocumentFragment();
      let cursor2 = 0;
      for (const [start, end] of ranges) {
        if (start < cursor2) continue;
        frag.appendChild(document2.createTextNode(text17.slice(cursor2, start)));
        const mark = document2.createElement("mark");
        mark.className = "search-mark";
        mark.textContent = text17.slice(start, end);
        frag.appendChild(mark);
        cursor2 = end;
      }
      frag.appendChild(document2.createTextNode(text17.slice(cursor2)));
      node.replaceWith(frag);
    }
  }

  // src/browser/skills-data.ts
  var text7 = (value) => typeof value === "string" ? value : "";
  var number = (value) => finite2(value) ? value : 0;
  var object2 = (value) => record8(value) ? value : {};
  var numbers = (value) => Array.isArray(value) ? value.map(number) : [];
  function decodeSkillDirectory(value) {
    if (!record8(value) || !Array.isArray(value.skills)) throw new Error("Invalid skills directory");
    const summary = object2(value.summary), refine = object2(value.refine);
    return {
      scope: text7(value.scope),
      indexing: value.indexing === true,
      refine: { mode: refine.mode === "skill" || refine.mode === "path" ? refine.mode : "default", discovered: refine.discovered === true, skillName: text7(refine.skillName), mdPath: text7(refine.mdPath) },
      summary: { discovered: number(summary.discovered), advertised: number(summary.advertised), catalogTokensEst: number(summary.catalogTokensEst), activations30d: number(summary.activations30d), quiet60d: number(summary.quiet60d) },
      skills: value.skills.flatMap((row) => {
        if (!record8(row) || typeof row.skill !== "string" || !row.skill) return [];
        const usage = object2(row.usage);
        return [{
          skill: row.skill,
          filePath: text7(row.filePath) || row.skill,
          baseDir: text7(row.baseDir),
          name: text7(row.name),
          description: text7(row.description),
          source: text7(row.source),
          advertised: row.advertised === true,
          bodyTokensEst: number(row.bodyTokensEst),
          bodyBytes: number(row.bodyBytes),
          catalogTokensEst: number(row.catalogTokensEst),
          usage: {
            lastUsedTs: finite2(usage.lastUsedTs) ? usage.lastUsedTs : null,
            count30d: number(usage.count30d),
            total: number(usage.total),
            sessionCount: number(usage.sessionCount),
            cwdCount: number(usage.cwdCount),
            topCwd: text7(usage.topCwd),
            weeks12: numbers(usage.weeks12)
          }
        }];
      })
    };
  }
  function decodeSkillCoverage(value) {
    if (!record8(value) || typeof value.skill !== "string" || !value.skill) throw new Error("Invalid skill coverage");
    const kinds = object2(value.kindSplit), latest = object2(value.latest);
    const sections = Array.isArray(value.sections) ? value.sections : [];
    return {
      skill: value.skill,
      numMapped: number(value.numMapped),
      excludedBeforeMtime: number(value.excludedBeforeMtime),
      flatFullRead: value.flatFullRead === true,
      unreadTokensEst: number(value.unreadTokensEst),
      targetedTouches: number(value.targetedTouches),
      cwdCount: number(value.cwdCount),
      topCwd: text7(value.topCwd),
      mtimeMs: number(value.mtimeMs),
      weeks26: numbers(value.weeks26),
      kindSplit: { read: number(kinds.read), explicit: number(kinds.explicit) },
      sessionCount: number(value.sessionCount),
      latest: typeof latest.sessionId === "string" && latest.sessionId ? { sessionId: latest.sessionId, entryId: text7(latest.entryId), name: text7(latest.name), ts: number(latest.ts), model: text7(latest.model) } : null,
      sections: sections.flatMap((section) => {
        if (!record8(section)) return [];
        const lines = Array.isArray(section.lines) ? section.lines : [];
        return [{
          heading: text7(section.heading),
          startLine: number(section.startLine),
          endLine: number(section.endLine),
          reads: number(section.reads),
          fraction: Math.max(0, Math.min(1, number(section.fraction))),
          neverRead: section.neverRead === true,
          lines: lines.flatMap((line) => record8(line) ? [{ text: text7(line.text), hits: number(line.hits) }] : [])
        }];
      })
    };
  }

  // src/browser/skills.ts
  function createSkills(options2) {
    const document2 = options2.root.ownerDocument, sessionState = options2.sessionState;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing skills element: " + id);
      return value;
    };
    let disposed = false;
    let viewHost = null;
    let bodyEvents = new AbortController(), headerEvents = new AbortController();
    let indexingTimer, activationTimer;
    const message3 = (error) => error instanceof Error ? error.message : String(error);
    function owns(seq = skillsSeq) {
      const current = options2.self();
      return seq === skillsSeq && isSkillsViewOpen() && !!viewHost && current.hostId === viewHost.hostId && current.base === viewHost.base && (current.token || "") === (viewHost.token || "");
    }
    function retireBody() {
      bodyEvents.abort();
      bodyEvents = new AbortController();
    }
    async function read(path) {
      const host = viewHost;
      if (!host) throw new Error("Skills host is no longer available");
      const response = await options2.request(host, path);
      const data = await response.json();
      if (!response.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
      return data;
    }
    let skillsData = null;
    let skillsRefine = null;
    let skillsSort = "recent";
    let skillsFilter = "";
    let skillsDetailPath = null;
    let skillsDetail = null;
    let skillsSeq = 0;
    function isSkillsViewOpen() {
      return !disposed && options2.root.classList.contains("skills-open");
    }
    function openSkillsView() {
      if (disposed) return;
      closeSkillsView();
      options2.closeOtherViews();
      viewHost = Object.freeze({ ...options2.self() });
      options2.root.classList.add("skills-open");
      skillsDetailPath = null;
      loadSkillsDirectory();
    }
    function closeSkillsView() {
      if (disposed) return;
      ++skillsSeq;
      bodyEvents.abort();
      headerEvents.abort();
      clearTimeout(indexingTimer);
      clearTimeout(activationTimer);
      options2.root.classList.remove("skills-open");
    }
    function refreshSkillsView() {
      if (skillsDetailPath) openSkillDetail(skillsDetailPath, { force: true });
      else loadSkillsDirectory();
    }
    function skillsViewEscape() {
      if (skillsDetailPath) {
        backToSkillsDirectory();
        return true;
      }
      closeSkillsView();
      return true;
    }
    function fmtTok(n) {
      n = Number(n) || 0;
      if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
      return String(n);
    }
    function fmtBytes(n) {
      n = Number(n) || 0;
      if (n >= 1024 * 1024) return (n / 1048576).toFixed(1) + " MB";
      if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
      return n + " B";
    }
    function fmtEditedDate(ms) {
      if (!ms) return "\u2014";
      const d = new Date(ms);
      return d.toLocaleDateString(void 0, { month: "short", day: "numeric" });
    }
    function renderSpark(weeks, { maxPx = 22, cls = "spark", pct = false } = {}) {
      const max = Math.max(1, ...weeks);
      const bars = weeks.map((w) => {
        if (!w) return '<i class="z"></i>';
        if (pct) return `<i style="height:${Math.max(9, Math.round(w / max * 100))}%"></i>`;
        return `<i style="height:${Math.max(3, Math.round(w / max * maxPx))}px"></i>`;
      }).join("");
      return `<div class="${cls}">${bars}</div>`;
    }
    async function loadSkillsDirectory() {
      if (!owns() || skillsDetailPath) return;
      clearTimeout(indexingTimer);
      retireBody();
      const seq = ++skillsSeq;
      const body = element("skillsViewBody");
      renderSkillsHeader("directory");
      if (!body.childElementCount) body.innerHTML = '<div class="usage-state">Loading skills\u2026</div>';
      else body.classList.add("usage-refreshing");
      try {
        const data = await read("/api/skills");
        if (!owns(seq)) return;
        const d = decodeSkillDirectory(data);
        if (!owns(seq) || skillsDetailPath) return;
        skillsData = d;
        skillsRefine = d.refine;
        renderSkillsDirectory(d);
        if (d.indexing) indexingTimer = setTimeout(() => {
          if (owns(seq) && !skillsDetailPath) void loadSkillsDirectory();
        }, 1e3);
      } catch (e) {
        if (!owns(seq)) return;
        body.classList.remove("usage-refreshing");
        body.innerHTML = `<div class="usage-state">Could not load skills: ${escapeHtml(message3(e))}</div>`;
      }
    }
    function renderSkillsHeader(mode, skill) {
      headerEvents.abort();
      headerEvents = new AbortController();
      const seq = skillsSeq;
      const el = document2.getElementById("skillsViewHeader");
      if (!el) return;
      if (mode === "detail" && skill) {
        const chips = `<span class="chip ${skill.advertised ? "adv" : ""}">${skill.advertised ? "advertised" : "manual only"}</span><span class="chip">${escapeHtml(skill.source)}</span>`;
        el.innerHTML = `
        <a class="skills-back" data-skills-action="back">\u2039 Skills</a>
        <h1 class="skills-detail-title">${escapeHtml(skill.name)} ${chips}</h1>
        <div class="skills-header-spacer"></div>
        <button class="btn refine-btn" data-skills-action="refine"${skillsDetail?.skill === skillsDetailPath ? "" : " disabled"}>\u270E Refine with an agent</button>
        <button class="btn-icon" data-skills-action="refresh" title="Refresh">\u27F3</button>
        <button class="btn-icon" data-skills-action="close" title="Close (Esc)">\u2715</button>`;
      } else {
        el.innerHTML = `
        <span class="usage-view-title">Skills</span>
        <span class="skills-scope">${escapeHtml(skillsData?.scope === "all" ? "all workspaces" : skillsData?.scope || "all workspaces")}</span>
        <div class="skills-header-spacer"></div>
        <button class="btn-icon" data-skills-action="refresh" title="Refresh">\u27F3</button>
        <button class="btn-icon" data-skills-action="close" title="Close (Esc)">\u2715</button>`;
      }
      const actions = { back: backToSkillsDirectory, refine: startSkillRefine, refresh: refreshSkillsView, close: closeSkillsView };
      el.querySelectorAll("[data-skills-action]").forEach((button) => button.addEventListener("click", () => {
        const action = button.dataset.skillsAction || "";
        if (owns(seq) && Object.hasOwn(actions, action)) actions[action]();
      }, { signal: headerEvents.signal }));
    }
    function sortedSkills(d) {
      let list = d.skills.slice();
      const q = skillsFilter.trim().toLowerCase();
      if (q) list = list.filter((s) => s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q) || s.filePath.toLowerCase().includes(q));
      const byRecent = (a, b) => (b.usage.lastUsedTs || 0) - (a.usage.lastUsedTs || 0);
      const comparisons = {
        recent: byRecent,
        most: (a, b) => b.usage.count30d - a.usage.count30d || byRecent(a, b),
        least: (a, b) => a.usage.count30d - b.usage.count30d || byRecent(a, b),
        largest: (a, b) => b.bodyTokensEst - a.bodyTokensEst || byRecent(a, b),
        name: (a, b) => a.name.localeCompare(b.name)
      };
      return list.sort(Object.hasOwn(comparisons, skillsSort) ? comparisons[skillsSort] : byRecent);
    }
    const STALE_MS = 60 * 864e5;
    function renderSkillsDirectory(d) {
      if (!owns() || skillsDetailPath) return;
      retireBody();
      const seq = skillsSeq;
      const body = element("skillsViewBody");
      body.classList.remove("usage-refreshing");
      const s = d.summary;
      const now = Date.now();
      const sortOpts = [["recent", "Recently used"], ["most", "Most used (30d)"], ["least", "Least used"], ["largest", "Largest"], ["name", "Name"]].map(([v, l]) => `<option value="${v}"${skillsSort === v ? " selected" : ""}>${l}</option>`).join("");
      const rows = sortedSkills(d).map((sk) => {
        const u = sk.usage;
        const last = u.lastUsedTs ? formatRelativeTime(u.lastUsedTs) : "\u2014";
        const stale = u.lastUsedTs == null || now - u.lastUsedTs > STALE_MS;
        const manual = sk.advertised ? "" : '<span class="manual">manual</span>';
        return `<div class="sk-row" data-skill="${escapeHtml(sk.skill)}">
        <div><div class="sk-name">${escapeHtml(sk.name)}${manual}</div><div class="sk-desc">${escapeHtml(sk.description || "")}</div></div>
        <div class="src">${escapeHtml(sk.source)}</div>
        <div class="tok">${fmtTok(sk.bodyTokensEst)}</div>
        ${renderSpark(u.weeks12)}
        <div class="num">${u.count30d}</div>
        <div class="last${stale ? " stale" : ""}">${escapeHtml(last)}</div>
      </div>`;
      }).join("");
      body.innerHTML = `
      <div class="sk-summary">
        <div class="stat"><b>${s.discovered}</b><span>discovered</span></div>
        <div class="stat"><b>${s.advertised}</b><span>advertised \xB7 catalog ~${fmtTok(s.catalogTokensEst)} tok est</span></div>
        <div class="stat"><b>${s.activations30d}</b><span>activations \xB7 30d</span></div>
        <div class="stat"><b>${s.quiet60d}</b><span>quiet &gt; 60d</span></div>
        <span class="badge-inferred" title="Usage is inferred from mined read/bash tool calls, not telemetry">inferred from tool calls</span>
      </div>
      <div class="sk-controls">
        <input id="skillsFilterInput" placeholder="Filter skills\u2026" value="${escapeHtml(skillsFilter)}">
        <select id="skillsSortSelect">${sortOpts}</select>
      </div>
      <div class="sk-list">
        <div class="sk-colhead">
          <div>Skill</div><div>Source</div><div class="num">~Tok est</div><div>12 weeks</div><div class="num">30d</div><div style="text-align:right">Last used</div>
        </div>
        ${rows || '<div class="usage-state">No skills match.</div>'}
      </div>
      <div class="sk-foot">GET /api/skills \xB7 GET /api/skills/activations \u2014 NDJSON, filters: skill, since, cwd, kind</div>`;
      const filt = element("skillsFilterInput");
      filt.addEventListener("input", () => {
        if (!owns(seq)) return;
        skillsFilter = filt.value;
        renderSkillsDirectory(d);
      }, { signal: bodyEvents.signal });
      filt.focus();
      filt.setSelectionRange(filt.value.length, filt.value.length);
      const sort = element("skillsSortSelect");
      sort.addEventListener("change", () => {
        if (!owns(seq)) return;
        skillsSort = sort.value;
        renderSkillsDirectory(d);
      }, { signal: bodyEvents.signal });
      body.querySelectorAll(".sk-row").forEach((row) => row.addEventListener("click", () => {
        if (owns(seq) && row.dataset.skill) void openSkillDetail(row.dataset.skill);
      }, { signal: bodyEvents.signal }));
    }
    async function openSkillDetail(skillPath, { force = false } = {}) {
      if (!owns()) return;
      clearTimeout(indexingTimer);
      retireBody();
      const seq = ++skillsSeq;
      skillsDetailPath = skillPath;
      const skill = (skillsData?.skills || []).find((s) => s.skill === skillPath);
      renderSkillsHeader("detail", skill);
      const body = element("skillsViewBody");
      body.classList.remove("usage-refreshing");
      if (force || !skillsDetail || skillsDetail.skill !== skillPath) {
        body.innerHTML = '<div class="usage-state">Loading coverage\u2026</div>';
      }
      try {
        const data = await read("/api/skills/coverage?skill=" + encodeURIComponent(skillPath));
        if (!owns(seq)) return;
        const cov = decodeSkillCoverage(data);
        if (cov.skill !== skillPath) throw new Error("Coverage belongs to another skill");
        if (!owns(seq) || skillsDetailPath !== skillPath) return;
        skillsDetail = cov;
        renderSkillsHeader("detail", skill);
        renderSkillDetail(skill, cov);
      } catch (e) {
        if (!owns(seq) || skillsDetailPath !== skillPath) return;
        body.innerHTML = `<div class="usage-state">Could not load coverage: ${escapeHtml(message3(e))}</div>`;
      }
    }
    function backToSkillsDirectory() {
      if (!owns()) return;
      skillsSeq++;
      clearTimeout(indexingTimer);
      retireBody();
      skillsDetailPath = null;
      skillsDetail = null;
      renderSkillsHeader("directory");
      if (skillsData) renderSkillsDirectory(skillsData);
      else loadSkillsDirectory();
    }
    function heatClass(hits, numMapped) {
      if (!hits) return "h0";
      const r = hits / Math.max(1, numMapped);
      if (r >= 0.75) return "h12";
      if (r >= 0.4) return "h9";
      return "h4";
    }
    function renderSkillDetail(skill, cov) {
      if (!owns() || skillsDetailPath !== cov.skill) return;
      retireBody();
      const seq = skillsSeq;
      const body = element("skillsViewBody");
      const u = skill?.usage;
      let coverageHtml;
      if (cov.numMapped === 0) {
        coverageHtml = `<div class="cov-cap">No ranged reads recorded since this file was last edited${cov.excludedBeforeMtime ? ` (${cov.excludedBeforeMtime} older read${cov.excludedBeforeMtime === 1 ? "" : "s"} predate it)` : ""}.</div>`;
      } else if (cov.flatFullRead) {
        coverageHtml = `<div class="cov-flat">This skill is short enough that every one of the last
        ${cov.numMapped} read${cov.numMapped === 1 ? "" : "s"} loaded it in full \u2014 nothing has been
        skipped, so there is no partial-coverage map to show.</div>`;
      } else {
        const secRows = cov.sections.map((sec, i) => {
          const pct = Math.round(sec.fraction * 100);
          const cold = sec.neverRead ? " cold" : "";
          const never = sec.neverRead ? '<span class="never">never read</span>' : "";
          const heads = escapeHtml(sec.heading === "(intro)" ? "(intro)" : sec.heading);
          return `<div class="sec-row${cold}" data-sec="${i}">
            <span class="sec-name">${heads} <span class="lines">${sec.startLine}\u2013${sec.endLine}</span>${never}</span>
            <div class="cov-bar">${sec.reads ? `<i style="width:${pct}%"></i>` : ""}</div>
            <span class="sec-frac">${sec.reads}/${cov.numMapped}</span>
          </div>
          <div class="sec-open" id="skSecOpen${i}" style="display:none"></div>`;
        }).join("");
        coverageHtml = `
        <div class="cov-headline"><b>~${fmtTok(cov.unreadTokensEst)} tok</b> (est) never entered context across the last ${cov.numMapped} read${cov.numMapped === 1 ? "" : "s"}</div>
        <div class="cov-cap">${cov.numMapped} ranged read${cov.numMapped === 1 ? "" : "s"} mapped \xB7 ${cov.targetedTouches} targeted access${cov.targetedTouches === 1 ? "" : "es"} (counted as touches, not mapped)${cov.excludedBeforeMtime ? ` \xB7 ${cov.excludedBeforeMtime} older read${cov.excludedBeforeMtime === 1 ? "" : "s"} predate this version` : ""}</div>
        ${secRows}
        <div class="d-note">Coverage maps ranged reads against the current file version only \u2014
          activations before the last edit count toward totals but aren't mapped. A short skill
          that's always read in full shows a single line here instead of a map.</div>`;
      }
      const kinds = cov.kindSplit || {};
      const wsLine = u?.topCwd ? `Used in ${cov.cwdCount || u.cwdCount || 1} workspace${(cov.cwdCount || u.cwdCount || 1) === 1 ? "" : "s"}, mostly <span class="mono">${escapeHtml(shortCwd(cov.topCwd))}</span>` : "No workspace activity recorded yet";
      let latestHtml = "";
      if (cov.latest && cov.latest.sessionId) {
        const label = cov.latest.name || "session";
        latestHtml = `<div class="latest"><a class="skill-activation">latest activation: ${escapeHtml(label)} \u2192</a>
        <span>${formatRelativeTime(cov.latest.ts)}${cov.latest.model ? " \xB7 " + escapeHtml(cov.latest.model) : ""}</span></div>`;
      }
      const apiUrl = options2.origin() + "/api/skills/activations?skill=" + encodeURIComponent(skill ? skill.skill : cov.skill);
      const covUrl = options2.origin() + "/api/skills/coverage?skill=" + encodeURIComponent(skill ? skill.skill : cov.skill);
      body.innerHTML = `<div class="skills-detail-wrap"><div class="cols">
      <div class="main-col">
        <div class="d-path" data-path="${escapeHtml(cov.skill)}" title="Copy path">${escapeHtml(cov.skill)}</div>
        <div class="d-meta">
          body <b>${fmtBytes(skill ? skill.bodyBytes : 0)}</b> \xB7 <b>~${fmtTok(skill ? skill.bodyTokensEst : 0)} tok</b> <span class="badge-inferred">est</span>
          ${skill && skill.advertised ? `&nbsp;\xB7&nbsp; catalog entry <b>~${fmtTok(skill.catalogTokensEst)} tok</b> <span class="badge-inferred">est</span>` : ""}
          &nbsp;\xB7&nbsp; last edited <b>${fmtEditedDate(cov.mtimeMs)}</b>
        </div>
        <div class="d-sec">Read coverage \xB7 since last edit <span class="badge-inferred">inferred</span></div>
        ${coverageHtml}
      </div>
      <div class="side-col">
        <div class="d-sec">Activity \xB7 26 weeks <span class="badge-inferred">inferred</span></div>
        ${renderSpark(cov.weeks26, { cls: "spark-lg", pct: true })}
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
        <div class="api-box" data-copy="${escapeHtml(apiUrl)}"><span class="copy-hint">\u29C9</span><span class="c"># activations, NDJSON</span>
  ${escapeHtml(apiUrl)}

  <span class="c"># current coverage rollup</span>
  ${escapeHtml(covUrl)}</div>
        <div class="d-note">The \u270E button opens a new session with a drafted prompt carrying this
          evidence (path, stats, cold sections) \u2014 the refinement methodology itself is pluggable.</div>
      </div>
    </div></div>`;
      body.querySelector(".d-path")?.addEventListener("click", () => {
        if (!owns(seq)) return;
        options2.copy(cov.skill);
        options2.status("Skill path copied");
      }, { signal: bodyEvents.signal });
      body.querySelector(".api-box")?.addEventListener("click", () => {
        if (!owns(seq)) return;
        options2.copy(apiUrl);
        options2.status("Activations URL copied");
      }, { signal: bodyEvents.signal });
      body.querySelector(".skill-activation")?.addEventListener("click", () => {
        if (owns(seq) && cov.latest) void openSkillActivation(cov.latest.sessionId, cov.latest.entryId);
      }, { signal: bodyEvents.signal });
      body.querySelectorAll(".sec-row[data-sec]").forEach((row) => {
        row.addEventListener("click", () => {
          if (!owns(seq)) return;
          const i = Number(row.dataset.sec);
          const open = document2.getElementById("skSecOpen" + i);
          if (!open) return;
          if (open.style.display !== "none") {
            open.style.display = "none";
            open.innerHTML = "";
            return;
          }
          const sec = cov.sections[i];
          open.innerHTML = sec.lines.map((ln) => `<div class="ln ${heatClass(ln.hits, cov.numMapped)}"><span class="g"></span><span class="t">${escapeHtml(ln.text || " ")}</span></div>`).join("");
          open.style.display = "";
        }, { signal: bodyEvents.signal });
      });
    }
    function startSkillRefine() {
      if (!owns() || !viewHost) return;
      const skill = (skillsData?.skills || []).find((s) => s.skill === skillsDetailPath);
      if (!skill || !skillsDetail || skillsDetail.skill !== skillsDetailPath) return;
      const draft = buildRefineDraft(skill, skillsDetail, skillsRefine || { mode: "default", discovered: false, skillName: "", mdPath: "" });
      const cwd = skill.baseDir || skill.filePath.replace(/\/SKILL\.md$/, "");
      closeSkillsView();
      options2.refine({ cwd, draft, host: viewHost.hostId });
    }
    function buildRefineDraft(skill, cov, refine) {
      const u = skill.usage || {};
      const lead = [];
      const usesSkillLead = refine.mode === "skill" || refine.mode === "default" && refine.discovered;
      if (usesSkillLead) lead.push("/skill:" + refine.skillName, "");
      const cold = (cov.sections || []).filter((s) => s.neverRead).map((s) => s.heading);
      const parts = [
        "Help me refine this skill based on how it is actually being used.",
        "",
        "Skill: " + skill.filePath,
        "Source: " + skill.source + (skill.advertised ? " \xB7 advertised" : " \xB7 manual only"),
        "Body: " + fmtBytes(skill.bodyBytes) + " \xB7 ~" + skill.bodyTokensEst + " tok (est)",
        "Usage (inferred from tool calls): " + (u.total || 0) + " activations, " + (u.count30d || 0) + " in the last 30d, across " + (u.sessionCount || 0) + " session(s); last used " + (u.lastUsedTs ? formatRelativeTime(u.lastUsedTs) : "never"),
        "~" + cov.unreadTokensEst + " tok (est) never entered context across the last " + cov.numMapped + " mapped read(s)."
      ];
      if (cold.length) parts.push("Sections never read since the last edit: " + cold.join("; "));
      parts.push(
        "Coverage detail: " + options2.origin() + "/api/skills/coverage?skill=" + encodeURIComponent(skill.filePath),
        "Raw activations (NDJSON): " + options2.origin() + "/api/skills/activations?skill=" + encodeURIComponent(skill.filePath),
        ""
      );
      if (!usesSkillLead) {
        const ref = refine.mdPath || (refine.mode === "path" ? refine.mdPath : null);
        if (ref) parts.push("Read " + ref + " and follow its methodology.");
      }
      parts.push("Note: read-coverage is not the same as adherence \u2014 ground-truth any cold section against a recent transcript before trimming it.");
      return lead.join("\n") + parts.join("\n");
    }
    async function openSkillActivation(id, entryId) {
      if (!owns() || !viewHost) return;
      const endpoint = viewHost;
      closeSkillsView();
      const navigation = skillsSeq;
      const current = () => !disposed && navigation === skillsSeq && options2.self().hostId === endpoint.hostId && options2.self().base === endpoint.base && (options2.self().token || "") === (endpoint.token || "");
      if (!sessionState.findSession(id, endpoint.hostId)) await options2.loadPrevious();
      if (!current() || !sessionState.findSession(id, endpoint.hostId)) return;
      const selecting = options2.selectSession(id, { host: endpoint.hostId });
      const owner = sessionState.captureSelection(), selectedView = skillsSeq;
      await selecting;
      if (!entryId || !owner || !sessionState.ownsSelection(owner) || owner.id !== id || owner.host !== endpoint.hostId) return;
      activationTimer = setTimeout(() => {
        if (disposed || selectedView !== skillsSeq || !sessionState.ownsSelection(owner)) return;
        const el = document2.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`);
        const msg = el?.closest(".message");
        if (msg) {
          msg.scrollIntoView({ block: "center" });
          msg.classList.add("search-current");
        }
      }, 400);
    }
    return {
      open: openSkillsView,
      close: closeSkillsView,
      isOpen: isSkillsViewOpen,
      refresh: refreshSkillsView,
      escape: skillsViewEscape,
      load: loadSkillsDirectory,
      detail: openSkillDetail,
      back: backToSkillsDirectory,
      refine: startSkillRefine,
      activation: openSkillActivation,
      dispose() {
        closeSkillsView();
        disposed = true;
      }
    };
  }

  // src/browser/search-data.ts
  var text8 = (value) => typeof value === "string" ? value : "";
  var number2 = (value) => finite2(value) ? value : 0;
  function decodeSearchPayload(value) {
    if (!record8(value) || !Array.isArray(value.results)) throw new Error("Invalid search response");
    const results = value.results.flatMap((row) => record8(row) && typeof row.id === "string" && row.id ? [{
      id: row.id,
      name: text8(row.name),
      cwd: text8(row.cwd),
      model: text8(row.model),
      lastActivity: typeof row.lastActivity === "string" || finite2(row.lastActivity) ? row.lastActivity : null,
      isActive: row.isActive === true,
      turnInProgress: row.turnInProgress === true,
      compacting: row.compacting === true,
      searchScore: finite2(row.searchScore) ? row.searchScore : void 0,
      matchCount: number2(row.matchCount),
      snippets: Array.isArray(row.snippets) ? row.snippets.filter((value2) => typeof value2 === "string") : []
    }] : []);
    return { results, total: number2(value.total) || results.length, hiddenByScopes: number2(value.hiddenByScopes), hiddenByAutomation: number2(value.hiddenByAutomation), indexing: value.indexing === true };
  }
  function queryHosts(hosts, query) {
    if (!query) return hosts;
    const terms = parseSessionQuery(query).terms.filter((term) => term.field === "host" && !term.neg);
    if (!terms.length) return hosts;
    const parsed = { terms, since: null, before: null };
    return hosts.filter((host) => evaluateSessionQuery(parsed, { id: "", hostLabel: hostDisplayLabel(host), host: host.hostId || null }));
  }
  function mergeSearchPayloads(entries, query) {
    const parsed = parseSessionQuery(query), results = [];
    let total = 0, hiddenByScopes = 0, hiddenByAutomation = 0, indexing = false;
    for (const { host, payload } of entries) {
      for (const session of payload.results) results.push({ ...session, host: host.hostId, hostLabel: hostDisplayLabel(host) });
      total += payload.total;
      hiddenByScopes += payload.hiddenByScopes;
      hiddenByAutomation += payload.hiddenByAutomation;
      if (payload.indexing) indexing = true;
    }
    if (!(entries.length === 1 && !entries[0].host.hostId)) results.sort((a, b) => (b.searchScore ?? scoreSessionMatch(parsed, b)) - (a.searchScore ?? scoreSessionMatch(parsed, a)) || new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime());
    return { results, total, hiddenByScopes, hiddenByAutomation, indexing };
  }

  // src/browser/search-view.ts
  function createSearchView(options2) {
    const document2 = options2.root.ownerDocument, sessionState = options2.sessionState;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing search view element: " + id);
      return value;
    };
    const effectiveHosts = options2.hosts, fanoutHosts = options2.fanout, scopeQuery = options2.scope;
    const hostChipHtml = (host) => options2.hostChip(host || null);
    const isMultiHost = () => effectiveHosts().length > 1;
    let disposed = false;
    let rowEvents = new AbortController();
    const events = new AbortController();
    let view = 0;
    function sameHost(host) {
      const current = options2.host(host.hostId);
      return !!current && current.hostId === host.hostId && current.base === host.base && (current.token || "") === (host.token || "");
    }
    const message3 = (error) => error instanceof Error ? error.message : String(error);
    let searchViewSeq = 0;
    let searchViewQuery = "";
    let searchViewRenderedQuery = "";
    let searchViewTimer;
    let searchViewRepollTimer;
    function isSearchViewOpen() {
      return !disposed && options2.root.classList.contains("search-open");
    }
    function openSearchView(initialQuery) {
      if (disposed) return;
      closeSearchView();
      options2.closeOtherViews();
      view++;
      if (typeof initialQuery === "string") searchViewQuery = initialQuery;
      const input2 = element("searchViewInput");
      input2.value = searchViewQuery;
      options2.root.classList.add("search-open");
      input2.focus();
      input2.select();
      runSearchView();
    }
    function closeSearchView() {
      if (disposed) return;
      view++;
      rowEvents.abort();
      searchViewSeq += 1;
      options2.root.classList.remove("search-open");
      clearTimeout(searchViewTimer);
      clearTimeout(searchViewRepollTimer);
    }
    function onSearchViewInput({ immediate = false } = {}) {
      if (!isSearchViewOpen()) return;
      ++searchViewSeq;
      clearTimeout(searchViewRepollTimer);
      searchViewQuery = element("searchViewInput").value;
      clearTimeout(searchViewTimer);
      if (immediate) runSearchView();
      else searchViewTimer = setTimeout(runSearchView, 300);
    }
    async function runSearchView() {
      if (!isSearchViewOpen()) return;
      clearTimeout(searchViewRepollTimer);
      const seq = ++searchViewSeq;
      const query = searchViewQuery.trim();
      const scope = scopeQuery().trim();
      const body = element("searchViewBody");
      if (body.childElementCount) body.classList.add("usage-refreshing");
      else body.innerHTML = '<div class="usage-state">Searching\u2026</div>';
      const params = new URLSearchParams({ q: stripQueryField(query, "host") });
      params.set("hideAutomation", "1");
      const wireScope = stripQueryField(scope, "host");
      if (wireScope) params.set("scope", wireScope);
      const hosts = queryHosts(queryHosts(fanoutHosts(), query), scope).map((host) => Object.freeze({ ...host }));
      const stale = () => seq !== searchViewSeq || !isSearchViewOpen() || query !== searchViewQuery.trim() || scope !== scopeQuery().trim();
      const status = hosts.map(() => "pending");
      const payloads = new Array(hosts.length);
      const reasons = new Array(hosts.length);
      let renderedIndexing = false;
      let didRender = false;
      const render = () => {
        if (stale()) return;
        const ok = hosts.flatMap((host, i) => {
          const payload = payloads[i];
          return status[i] === "ok" && payload ? [{ host, payload }] : [];
        });
        const d = ok.length ? mergeSearchPayloads(ok, query) : { results: [], total: 0, hiddenByScopes: 0, hiddenByAutomation: 0, indexing: false };
        d.results = applyHostTerms(d.results, query);
        const inScope = applyHostTerms(d.results, scope);
        d.hiddenByScopes += d.results.length - inScope.length;
        d.results = inScope;
        d.hostErrors = hosts.filter((_, i) => status[i] === "error").map(hostDisplayLabel);
        d.hostPending = hosts.filter((_, i) => status[i] === "pending").map(hostDisplayLabel);
        searchViewRenderedQuery = query;
        didRender = true;
        renderedIndexing = d.indexing;
        renderSearchView(d, query, hosts);
      };
      try {
        await Promise.all(hosts.map(async (host, i) => {
          try {
            const r = await options2.request(host, "/api/search?" + params, { timeoutMs: 2e4 });
            if (r.status === 401) {
              if (sameHost(host)) options2.connection(host, "blocked");
              throw new Error("needs a token");
            }
            const data = await r.json();
            if (!sameHost(host)) throw new Error("host connection changed");
            if (!r.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${r.status}`);
            payloads[i] = decodeSearchPayload(data);
            status[i] = "ok";
            options2.connection(host, "success");
          } catch (e) {
            status[i] = "error";
            reasons[i] = e;
            if (!host.self && sameHost(host)) options2.connection(host, "failure", e);
          }
          if (status.some((s) => s === "ok")) render();
        }));
        if (!status.some((s) => s === "ok")) {
          if (hosts.length) throw reasons.find(Boolean) || new Error("no hosts answered");
          render();
        }
        if (stale() || !didRender) return;
        if (renderedIndexing) searchViewRepollTimer = setTimeout(() => {
          if (!stale()) void runSearchView();
        }, 1e3);
      } catch (e) {
        if (stale()) return;
        body.classList.remove("usage-refreshing");
        body.innerHTML = `<div class="usage-state">Search failed: ${escapeHtml(message3(e))}</div>`;
      }
    }
    function setSearchToken(prefix, value) {
      if (!isSearchViewOpen()) return;
      const input2 = element("searchViewInput");
      let q = input2.value.replace(new RegExp(`(^|\\s)-?${prefix}:("[^"]*"|\\S+)`, "gi"), " ").replace(/\s{2,}/g, " ").trim();
      if (value) q = (q ? q + " " : "") + prefix + ":" + (/\s/.test(value) ? `"${value}"` : value);
      input2.value = q;
      onSearchViewInput({ immediate: true });
    }
    const SEARCH_DATE_PRESETS = [["", "Any time"], ["1d", "24h"], ["7d", "7 days"], ["30d", "30 days"]];
    function searchFacetState() {
      const parsed = parseSessionQuery(searchViewQuery);
      const val = (f) => parsed.terms.find((t) => t.field === f && !t.neg)?.value || "";
      return {
        cwd: val("cwd"),
        model: val("model"),
        host: val("host"),
        activeOnly: parsed.terms.some((t) => t.field === "is" && !t.neg && t.value === "active"),
        automationOnly: parsed.terms.some((t) => t.field === "is" && !t.neg && t.value === "automation"),
        since: (searchViewQuery.match(/(?:^|\s)since:(\S+)/i) || [])[1] || ""
      };
    }
    function searchFacetOptions() {
      const all = [...sessionState.sessions.active, ...sessionState.sessions.previous];
      const cwds = /* @__PURE__ */ new Map(), models = /* @__PURE__ */ new Set();
      for (const s of all) {
        if (typeof s.cwd === "string" && s.cwd) cwds.set(s.cwd, shortCwd(s.cwd));
        if (typeof s.model === "string" && s.model && s.model !== "unknown") models.add(s.model);
      }
      return {
        cwds: [...cwds.entries()].sort((a, b) => a[1].localeCompare(b[1])),
        models: [...models].sort()
      };
    }
    function renderSearchFacetsHtml() {
      const st = searchFacetState();
      const opts = searchFacetOptions();
      const presets = SEARCH_DATE_PRESETS.map(([v, l]) => `<button class="usage-range-btn${st.since === v ? " active" : ""}" data-since="${v}">${l}</button>`).join("");
      const cwdOptions = [
        '<option value="">All workspaces</option>',
        ...opts.cwds.map(([cwd, label]) => `<option value="${escapeHtml(cwd)}"${cwd.toLowerCase() === st.cwd ? " selected" : ""}>${escapeHtml(label)}</option>`)
      ].join("");
      const modelOptions = [
        '<option value="">All models</option>',
        ...opts.models.map((m) => `<option value="${escapeHtml(m)}"${m.toLowerCase() === st.model ? " selected" : ""}>${escapeHtml(m)}</option>`)
      ].join("");
      const hostSelect = !isMultiHost() ? "" : `<select class="search-facet-select" id="searchFacetHost">${['<option value="">All hosts</option>', ...effectiveHosts().map((h) => hostDisplayLabel(h)).filter(Boolean).map((label) => `<option value="${escapeHtml(label)}"${label.toLowerCase() === st.host ? " selected" : ""}>${escapeHtml(label)}</option>`)].join("")}</select>`;
      return `<div class="search-facets">
      <div class="usage-ranges">${presets}</div>
      <select class="search-facet-select" id="searchFacetCwd">${cwdOptions}</select>
      <select class="search-facet-select" id="searchFacetModel">${modelOptions}</select>
      ${hostSelect}
      <button class="scope-chip${st.activeOnly ? " active" : ""}" id="searchFacetActive" title="is:active">Active only</button>
      <button class="scope-chip${st.automationOnly ? " active" : ""}" id="searchFacetAutomation" title="is:automation">Automation</button>
    </div>`;
    }
    function renderSearchView(d, query, hosts) {
      if (!isSearchViewOpen()) return;
      rowEvents.abort();
      rowEvents = new AbortController();
      const renderedView = view;
      const owns = () => renderedView === view && isSearchViewOpen();
      const listener = { signal: rowEvents.signal };
      const body = element("searchViewBody");
      body.classList.remove("usage-refreshing");
      const tokens2 = positiveQueryTokens(parseSessionQuery(query));
      const shown = d.results || [];
      const scopesHidden = Number(d.hiddenByScopes) || 0;
      const automationHidden = Number(d.hiddenByAutomation) || 0;
      const cards = shown.map((s) => {
        let dot = "";
        if (s.turnInProgress || s.compacting) dot = '<span class="session-item-status working"></span>';
        else if (s.isActive) dot = '<span class="live-dot"></span>';
        const count2 = s.matchCount ? `<span class="search-result-count">${s.matchCount} ${s.matchCount === 1 ? "match" : "matches"}</span>` : "";
        const snippets = (s.snippets || []).map((sn) => `<div class="search-result-snippet">${highlightTokens(sn, tokens2)}</div>`).join("");
        return `<div class="search-result" data-id="${escapeHtml(s.id)}"${s.host ? ` data-host="${escapeHtml(s.host)}"` : ""} data-content-matches="${s.matchCount > 0 ? "1" : "0"}">
        <div class="search-result-header">
          ${dot}<span class="search-result-name">${highlightTokens(s.name || "Unnamed", tokens2)}</span>
          ${count2}<span class="search-result-time">${formatRelativeTime(s.lastActivity)}</span>
        </div>
        <div class="search-result-meta">${hostChipHtml(s.host)}${escapeHtml(shortCwd(s.cwd || "~"))} \xB7 ${escapeHtml(s.model)}</div>
        ${snippets}
      </div>`;
      }).join("");
      body.innerHTML = `
      ${renderSearchFacetsHtml()}
      ${d.indexing ? '<div class="usage-notice">History is indexing; results will refresh\u2026</div>' : ""}
      ${d.hostErrors?.length ? `<div class="usage-notice">Not searched: ${escapeHtml(d.hostErrors.join(", "))} did not answer.</div>` : ""}
      ${d.hostPending?.length ? `<div class="usage-notice">Still searching ${escapeHtml(d.hostPending.join(", "))}\u2026</div>` : ""}
      <div class="search-count-line">${shown.length === 1 ? "1 session" : `${shown.length} sessions`}${d.total > d.results.length ? ` \u2014 showing the ${d.results.length} ${tokens2.length ? "best matches" : "most recent"}, narrow the query for the rest` : ""}</div>
      ${cards || '<div class="usage-state">No matching sessions.</div>'}
      ${scopesHidden > 0 ? `<div class="scope-hidden-note">${scopesHidden} hidden by scopes</div>` : ""}
      ${automationHidden > 0 ? `<div class="scope-hidden-note">${automationHidden} automation run${automationHidden === 1 ? "" : "s"} hidden (is:automation shows them)</div>` : ""}
    `;
      body.querySelectorAll("[data-since]").forEach((button) => button.addEventListener("click", () => {
        if (owns()) setSearchToken("since", button.dataset.since || null);
      }, listener));
      for (const [id, prefix] of [["searchFacetCwd", "cwd"], ["searchFacetModel", "model"], ["searchFacetHost", "host"]]) {
        const select = body.querySelector("#" + id);
        select?.addEventListener("change", () => {
          if (owns()) setSearchToken(prefix, select.value || null);
        }, listener);
      }
      body.querySelector("#searchFacetActive")?.addEventListener("click", () => {
        if (owns()) setSearchToken("is", searchFacetState().activeOnly ? null : "active");
      }, listener);
      body.querySelector("#searchFacetAutomation")?.addEventListener("click", () => {
        if (owns()) setSearchToken("is", searchFacetState().automationOnly ? null : "automation");
      }, listener);
      body.querySelectorAll(".search-result").forEach((card) => {
        const id = card.dataset.id, host = card.dataset.host || null, endpoint = hosts.find((value) => value.hostId === host);
        card.addEventListener("click", () => {
          if (owns() && id && endpoint && sameHost(endpoint)) void openSearchResult(id, card.dataset.contentMatches === "1", host, query, endpoint);
        }, listener);
      });
    }
    async function openSearchResult(id, hasContentMatches, host = null, renderedQuery = searchViewRenderedQuery, endpoint = options2.host(host)) {
      if (!isSearchViewOpen() || !endpoint || !sameHost(endpoint)) return;
      const captured = Object.freeze({ ...endpoint });
      const tokens2 = positiveQueryTokens(parseSessionQuery(renderedQuery));
      closeSearchView();
      const navigation = searchViewSeq;
      if (!sessionState.findSession(id, host)) await options2.loadPrevious();
      if (disposed || navigation !== searchViewSeq || !sameHost(captured)) return;
      const entry = sessionState.findSession(id, host);
      if (!entry) return;
      const selecting = options2.selectSession(id, { host: entry.host || null });
      const owner = sessionState.captureSelection(), selectedView = view;
      await selecting;
      if (tokens2.length && hasContentMatches && owner && selectedView === view && sessionState.ownsSelection(owner) && owner.id === id && owner.host === (entry.host || null)) {
        options2.sessionSearch.open();
        const input2 = element("searchInput");
        input2.value = tokens2.join(" ");
        await options2.sessionSearch.run(input2.value.trim().toLowerCase(), { mode: "any", closeIfEmpty: true });
      }
    }
    const input = element("searchViewInput");
    input.addEventListener("input", () => onSearchViewInput(), { signal: events.signal });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") onSearchViewInput({ immediate: true });
    }, { signal: events.signal });
    return {
      open: openSearchView,
      close: closeSearchView,
      isOpen: isSearchViewOpen,
      run: runSearchView,
      input: onSearchViewInput,
      setToken: setSearchToken,
      openResult: openSearchResult,
      dispose() {
        closeSearchView();
        events.abort();
        disposed = true;
      }
    };
  }

  // src/browser/helper-usage.ts
  var USAGE_MERGE_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite", "total"];
  var USAGE_MERGE_TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
  function createFanoutRenderQueue(states, render, delayMs = 100) {
    let timer;
    let disposed = false;
    const queue = () => {
      if (disposed) return;
      clearTimeout(timer);
      if (states.every((state) => state !== "pending")) render();
      else timer = setTimeout(render, delayMs);
    };
    return Object.assign(queue, { dispose() {
      disposed = true;
      clearTimeout(timer);
    } });
  }
  function emptyTokens() {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  }
  function emptyCosts() {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  }
  function emptyMergedUsage() {
    return {
      tokens: emptyTokens(),
      costs: emptyCosts(),
      costUnavailable: emptyCosts(),
      calls: 0,
      measured: 0,
      durationMs: 0,
      slowestMs: 0
    };
  }
  function addMergedUsage(to, from) {
    if (!from) return to;
    for (const k of USAGE_MERGE_TOKEN_KEYS) to.tokens[k] += from.tokens?.[k] || 0;
    for (const k of USAGE_MERGE_COST_KEYS) {
      to.costUnavailable[k] += from.costUnavailable?.[k] || 0;
      const value = from.costs?.[k];
      if (finite2(value)) {
        to.costs[k] = (finite2(to.costs[k]) ? to.costs[k] : 0) + value;
      }
    }
    for (const k of ["calls", "measured", "durationMs"]) to[k] += from[k] || 0;
    to.slowestMs = Math.max(to.slowestMs, from.slowestMs || 0);
    return to;
  }
  function pricedUsageFields(bucket2) {
    bucket2.unpricedCalls = bucket2.costUnavailable?.total || 0;
    bucket2.priced = !bucket2.unpricedCalls;
    return bucket2;
  }
  function usageDisplayTokens(tokens2) {
    return (tokens2?.input || 0) + (tokens2?.output || 0) + (tokens2?.cacheRead || 0) + (tokens2?.cacheWrite || 0);
  }
  function usageUnattributedCost(costs2) {
    if (!finite2(costs2?.total)) return 0;
    const attributed = ["input", "output", "cacheRead", "cacheWrite"].reduce((sum, key) => sum + (finite2(costs2[key]) ? costs2[key] : 0), 0);
    return Math.max(0, costs2.total - attributed);
  }
  function compareUsageBuckets(a, b, sort) {
    if (sort === "tokens") return usageDisplayTokens(b.tokens) - usageDisplayTokens(a.tokens) || b.calls - a.calls;
    const aKnown = finite2(a.costs?.total), bKnown = finite2(b.costs?.total);
    if (aKnown !== bKnown) return Number(bKnown) - Number(aKnown);
    return (bKnown ? b.costs.total - a.costs.total : 0) || b.calls - a.calls;
  }
  function mergeUsageSummaries(list) {
    const items = Array.isArray(list) ? list : [];
    const entries = items.map((item) => item && typeof item === "object" && "summary" in item && item.summary ? item : { summary: item }).filter((item) => !!item.summary && typeof item.summary === "object");
    if (!entries.length) return null;
    if (entries.length === 1) return entries[0].summary;
    const first = entries[0].summary;
    const sort = first.sort === "tokens" ? "tokens" : "cost";
    const totals = emptyMergedUsage();
    let unpricedModelCalls = 0;
    const headlineKeys = /* @__PURE__ */ new Set();
    const headlineCosts = /* @__PURE__ */ Object.create(null), headlineCostUnavailable = /* @__PURE__ */ Object.create(null);
    const headlineCostsByBucket = /* @__PURE__ */ Object.create(null);
    const days = /* @__PURE__ */ new Map();
    const models = /* @__PURE__ */ new Map();
    const workspaces = /* @__PURE__ */ new Map();
    const sessionRows = /* @__PURE__ */ new Map();
    let indexing = false, discoveryTruncated = false, discoverySkipped = 0;
    let monthlyBudgetUsd = null;
    for (const { summary, hostId = null, hostLabel = null } of entries) {
      addMergedUsage(totals, summary.totals);
      unpricedModelCalls += summary.unpricedModelCalls || 0;
      for (const [key, value] of Object.entries(summary.headlineCosts || {})) {
        headlineKeys.add(key);
        headlineCostUnavailable[key] = (headlineCostUnavailable[key] || 0) + (summary.headlineCostUnavailable?.[key] || 0);
        if (finite2(value)) {
          headlineCosts[key] = (finite2(headlineCosts[key]) ? headlineCosts[key] : 0) + value;
        }
      }
      for (const [key, costs2] of Object.entries(summary.headlineCostsByBucket || {})) {
        headlineKeys.add(key);
        const row = headlineCostsByBucket[key] || (headlineCostsByBucket[key] = emptyCosts());
        for (const k of USAGE_MERGE_COST_KEYS) if (finite2(costs2?.[k])) row[k] += costs2[k];
      }
      for (const day of summary.daily || []) {
        if (!day || !day.day) continue;
        let slot = days.get(day.day);
        if (!slot) {
          slot = { bucket: emptyMergedUsage(), models: /* @__PURE__ */ new Map() };
          days.set(day.day, slot);
        }
        addMergedUsage(slot.bucket, day);
        for (const model of day.models || []) {
          if (!model || !model.ref) continue;
          let row = slot.models.get(model.ref);
          if (!row) {
            row = {
              ref: model.ref,
              provider: model.provider,
              model: model.model,
              calls: 0,
              cost: 0,
              costUnavailable: emptyCosts(),
              tokens: emptyTokens()
            };
            slot.models.set(model.ref, row);
          }
          row.calls += model.calls || 0;
          for (const k of USAGE_MERGE_TOKEN_KEYS) row.tokens[k] += model.tokens?.[k] || 0;
          for (const k of USAGE_MERGE_COST_KEYS) row.costUnavailable[k] = (row.costUnavailable[k] || 0) + (model.costUnavailable?.[k] || 0);
          if (finite2(model.cost)) {
            row.cost = (finite2(row.cost) ? row.cost : 0) + model.cost;
          }
        }
      }
      for (const bucket2 of summary.groups?.models || []) {
        if (!bucket2 || !bucket2.key) continue;
        let row = models.get(bucket2.key);
        if (!row) {
          row = { key: bucket2.key, provider: bucket2.provider, model: bucket2.model, ...emptyMergedUsage() };
          models.set(bucket2.key, row);
        }
        addMergedUsage(row, bucket2);
      }
      for (const bucket2 of summary.groups?.workspaces || []) {
        if (!bucket2 || bucket2.key == null) continue;
        const key = hostId + " " + bucket2.key;
        let row = workspaces.get(key);
        if (!row) {
          row = { key: bucket2.key, host: hostId, hostLabel, ...emptyMergedUsage() };
          workspaces.set(key, row);
        }
        addMergedUsage(row, bucket2);
      }
      for (const bucket2 of summary.groups?.sessions || []) {
        if (!bucket2 || bucket2.id == null) continue;
        const key = hostId + " " + bucket2.id;
        let row = sessionRows.get(key);
        if (!row) {
          row = { ...bucket2, host: hostId, hostLabel, ...emptyMergedUsage() };
          sessionRows.set(key, row);
        }
        addMergedUsage(row, bucket2);
      }
      if (summary.indexing) indexing = true;
      if (summary.discoveryTruncated) discoveryTruncated = true;
      discoverySkipped += Number(summary.discoverySkipped) || 0;
      if (monthlyBudgetUsd == null && summary.monthlyBudgetUsd != null) monthlyBudgetUsd = summary.monthlyBudgetUsd;
    }
    pricedUsageFields(totals);
    totals.unpricedCalls = unpricedModelCalls;
    const daily = [...days.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([day, slot]) => ({
      day,
      ...slot.bucket,
      models: [...slot.models.values()].sort((a, b) => Number(finite2(b.cost)) - Number(finite2(a.cost)) || (finite2(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls)
    }));
    const rank = (rows) => rows.map(pricedUsageFields).sort((a, b) => compareUsageBuckets(a, b, sort)).slice(0, 20);
    return {
      range: first.range,
      sort: first.sort,
      models: first.models || null,
      totals,
      groups: {
        models: rank([...models.values()]),
        workspaces: rank([...workspaces.values()]),
        sessions: rank([...sessionRows.values()])
      },
      headlineCosts: Object.fromEntries([...headlineKeys].map((k) => [k, headlineCosts[k] ?? null])),
      headlineCostsByBucket: Object.fromEntries([...headlineKeys].map((k) => [k, headlineCostsByBucket[k] || null])),
      headlineCostUnavailable: Object.fromEntries([...headlineKeys].map((k) => [k, headlineCostUnavailable[k] || 0])),
      daily,
      unpricedModelCalls,
      indexing,
      discoveryTruncated,
      discoverySkipped,
      monthlyBudgetUsd
    };
  }
  function shortModelName(model) {
    if (!model) return "unknown";
    let name = String(model);
    const slash = name.lastIndexOf("/");
    if (slash >= 0) name = name.slice(slash + 1);
    name = name.replace(/^(?:[a-z]{2,3}\.)?(?:anthropic|amazon|meta|mistral|cohere|ai21|google|deepseek|qwen)\./, "");
    name = name.replace(/-v\d+:\d+$/, "");
    name = name.replace(/[-@](?:20\d{6}|20\d{2}-\d{2}-\d{2})$/, "");
    return name || String(model);
  }
  function niceTicks(max, target = 4) {
    if (!finite2(max) || max <= 0) return { step: 1, top: 1, ticks: [0, 1] };
    const rawStep = max / target;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    let step = 10 * mag;
    for (const m of [1, 2, 2.5, 5]) {
      if (rawStep <= m * mag) {
        step = m * mag;
        break;
      }
    }
    const ticks = [];
    const top = Math.ceil(max / step - 1e-9) * step;
    for (let i = 0; i * step <= top + step / 2; i++) ticks.push(Math.round(i * step * 1e9) / 1e9);
    return { step, top: ticks[ticks.length - 1], ticks };
  }
  var USAGE_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var USAGE_WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function formatUsageDay(day, style = "short") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
    if (!m) return String(day || "");
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const label = `${USAGE_MONTH_NAMES[mo - 1] || m[2]} ${d}`;
    if (style !== "long") return label;
    return `${USAGE_WEEKDAY_NAMES[new Date(y, mo - 1, d, 12).getDay()]}, ${label}, ${y}`;
  }
  function aggregateUsageWeekly(daily) {
    const out = [];
    const tokenKeys = USAGE_MERGE_TOKEN_KEYS;
    const costKeys = USAGE_MERGE_COST_KEYS;
    for (let end = daily.length; end > 0; end -= 7) {
      const chunk = daily.slice(Math.max(0, end - 7), end);
      const models = /* @__PURE__ */ new Map();
      const agg = {
        day: chunk[0].day,
        days: chunk.length,
        calls: 0,
        tokens: emptyTokens(),
        costs: emptyCosts(),
        costUnavailable: emptyCosts(),
        models: []
      };
      for (const d of chunk) {
        agg.calls += d.calls || 0;
        for (const k of tokenKeys) agg.tokens[k] += d.tokens?.[k] || 0;
        for (const k of costKeys) {
          agg.costUnavailable[k] += d.costUnavailable?.[k] || 0;
          const value = d.costs?.[k];
          if (finite2(value)) {
            agg.costs[k] = (finite2(agg.costs[k]) ? agg.costs[k] : 0) + value;
          }
        }
        for (const dm of d.models || []) {
          const t = models.get(dm.ref) || { ref: dm.ref, provider: dm.provider, model: dm.model, calls: 0, cost: 0, costUnavailable: { total: 0 }, tokens: emptyTokens() };
          t.calls += dm.calls || 0;
          t.costUnavailable.total = (t.costUnavailable.total || 0) + (dm.costUnavailable?.total || 0);
          if (finite2(dm.cost)) {
            t.cost = (finite2(t.cost) ? t.cost : 0) + dm.cost;
          }
          for (const k of tokenKeys) t.tokens[k] += dm.tokens?.[k] || 0;
          models.set(dm.ref, t);
        }
      }
      agg.models = [...models.values()].sort((a, b) => Number(finite2(b.cost)) - Number(finite2(a.cost)) || (finite2(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls);
      out.unshift(agg);
    }
    return out;
  }
  function formatLimitReset(resetsAt, now = Date.now()) {
    const ms = Number(resetsAt) - now;
    if (!finite2(ms) || ms <= 0) return "now";
    const mins = Math.ceil(ms / 6e4);
    if (mins < 60) return `in ${mins}m`;
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h < 24) return m ? `in ${h}h ${m}m` : `in ${h}h`;
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `in ${d}d ${rh}h` : `in ${d}d`;
  }
  function mergeUsageLimits(entries, { fractionTolerance = 0.02, resetToleranceMs = 15 * 6e4 } = {}) {
    const providers = /* @__PURE__ */ new Map();
    const errors = [];
    for (const entry of entries || []) {
      for (const h of entry?.payload?.harnesses || []) {
        if (h.error) {
          errors.push({ hostLabel: entry.hostLabel, harnessLabel: h.label || h.harness, error: h.error });
          continue;
        }
        for (const report of h.reports || []) {
          let prov = providers.get(report.provider);
          if (!prov) providers.set(report.provider, prov = { provider: report.provider, planTypes: /* @__PURE__ */ new Set(), groups: /* @__PURE__ */ new Map() });
          if (report.planType) prov.planTypes.add(report.planType);
          for (const limit of report.limits || []) {
            const key = `${limit.label}${limit.windowLabel || ""}`;
            let group = prov.groups.get(key);
            if (!group) prov.groups.set(key, group = { rows: [] });
            group.rows.push({
              ...limit,
              planType: report.planType || null,
              fetchedAt: report.fetchedAt || 0,
              hostLabel: entry.hostLabel
            });
          }
        }
      }
    }
    const equivalent = (a, b) => a.planType === b.planType && Math.abs(a.usedFraction - b.usedFraction) <= fractionTolerance && (a.resetsAt == null && b.resetsAt == null || a.resetsAt != null && b.resetsAt != null && Math.abs(a.resetsAt - b.resetsAt) <= resetToleranceMs);
    const reports = [...providers.values()].map((prov) => {
      const hostCount = new Set([...prov.groups.values()].flatMap((g) => g.rows.map((r) => r.hostLabel))).size;
      const limits = [...prov.groups.values()].flatMap((group) => {
        const clusters = [];
        for (const row of [...group.rows].sort((a, b) => b.fetchedAt - a.fetchedAt)) {
          const cluster = clusters.find((c) => equivalent(c.rep, row));
          if (cluster) cluster.hosts.push(row.hostLabel);
          else clusters.push({ rep: row, hosts: [row.hostLabel] });
        }
        return clusters.map((c) => ({
          ...c.rep,
          hosts: c.hosts.length >= hostCount ? null : [...new Set(c.hosts)].sort()
        }));
      });
      return {
        provider: prov.provider,
        planType: prov.planTypes.size === 1 ? [...prov.planTypes][0] : null,
        limits
      };
    }).filter((p) => p.limits.length);
    return { reports, errors };
  }
  function usageLimitsHtml(entries, { now = Date.now() } = {}) {
    const { reports, errors } = mergeUsageLimits(entries);
    if (!reports.length && !errors.length) return "";
    const body = reports.map((report) => {
      const rows = report.limits.map((limit) => {
        const pct = Math.min(100, Math.max(0, limit.usedFraction * 100));
        const cls = pct >= 100 ? " over" : pct >= 80 ? " warn" : "";
        const reset = limit.resetsAt ? ` \xB7 resets ${formatLimitReset(limit.resetsAt, now)}` : "";
        const host = limit.hosts ? ` \xB7 ${escapeHtml(limit.hosts.join(", "))}` : "";
        return `<div class="usage-limit-row"><div class="usage-limit-head"><span>${escapeHtml(limit.label)}</span><small>${Math.round(limit.usedFraction * 100)}% used${escapeHtml(reset)}${host}</small></div><div class="usage-limit-track"><div class="usage-limit-fill${cls}" style="width:${pct.toFixed(1)}%"></div></div></div>`;
      }).join("");
      const plan = report.planType ? ` <small>${escapeHtml(report.planType)}</small>` : "";
      return `<div class="usage-limits-provider"><div class="usage-limits-provider-name">${escapeHtml(report.provider)}${plan}</div>${rows}</div>`;
    }).join("");
    const errHtml = errors.map((e) => `<div class="usage-limits-error">${escapeHtml(e.harnessLabel)} on ${escapeHtml(e.hostLabel)}: ${escapeHtml(e.error)}</div>`).join("");
    return `<section class="usage-section usage-limits"><h4>Subscription limits <span class="usage-hint">reported by the harness CLI \u2014 quota, not spend</span></h4>${body}${errHtml}</section>`;
  }

  // src/browser/usage-data.ts
  var object3 = (value) => record8(value) ? value : {};
  var text9 = (value) => typeof value === "string" ? value : "";
  var number3 = (value) => finite2(value) ? value : 0;
  function costs(value) {
    const row = object3(value);
    return Object.fromEntries(USAGE_MERGE_COST_KEYS.map((key) => [key, finite2(row[key]) ? row[key] : null]));
  }
  function counts(value) {
    const row = object3(value);
    return Object.fromEntries(USAGE_MERGE_COST_KEYS.map((key) => [key, number3(row[key])]));
  }
  function tokens(value) {
    const row = object3(value);
    return Object.fromEntries(USAGE_MERGE_TOKEN_KEYS.map((key) => [key, number3(row[key])]));
  }
  function bucket(value) {
    const row = object3(value);
    return {
      tokens: tokens(row.tokens),
      costs: costs(row.costs),
      costUnavailable: counts(row.costUnavailable),
      calls: number3(row.calls),
      measured: number3(row.measured),
      durationMs: number3(row.durationMs),
      slowestMs: number3(row.slowestMs),
      priced: row.priced === true,
      unpricedCalls: number3(row.unpricedCalls)
    };
  }
  function decodeUsageSummary(value, host) {
    if (!record8(value)) throw new Error("Invalid usage summary");
    const groups = object3(value.groups);
    const decodeGroups = (value2, kind) => Array.isArray(value2) ? value2.flatMap((row) => {
      if (!record8(row) || (kind === "sessions" ? typeof row.id !== "string" : typeof row.key !== "string")) return [];
      return [{
        ...bucket(row),
        key: text9(row.key),
        id: text9(row.id),
        name: text9(row.name),
        workspace: text9(row.workspace),
        provider: text9(row.provider),
        model: text9(row.model),
        ...kind === "models" ? {} : { host: host.hostId, hostLabel: host.label }
      }];
    }) : [];
    const daily = Array.isArray(value.daily) ? value.daily.flatMap((row) => {
      if (!record8(row) || typeof row.day !== "string") return [];
      return [{ ...bucket(row), day: row.day, days: number3(row.days) || 1, models: Array.isArray(row.models) ? row.models.flatMap((model) => {
        if (!record8(model) || typeof model.ref !== "string") return [];
        return [{
          ref: model.ref,
          provider: text9(model.provider),
          model: text9(model.model),
          calls: number3(model.calls),
          cost: finite2(model.cost) ? model.cost : null,
          tokens: tokens(model.tokens),
          costUnavailable: counts(model.costUnavailable)
        }];
      }) : [] }];
    }) : [];
    return {
      range: text9(value.range),
      sort: text9(value.sort),
      models: Array.isArray(value.models) ? value.models.filter((value2) => typeof value2 === "string") : null,
      totals: bucket(value.totals),
      groups: { models: decodeGroups(groups.models, "models"), workspaces: decodeGroups(groups.workspaces, "workspaces"), sessions: decodeGroups(groups.sessions, "sessions") },
      daily,
      headlineCosts: Object.fromEntries(Object.entries(object3(value.headlineCosts)).map(([key, value2]) => [key, finite2(value2) ? value2 : null])),
      headlineCostsByBucket: Object.fromEntries(Object.entries(object3(value.headlineCostsByBucket)).map(([key, value2]) => [key, costs(value2)])),
      headlineCostUnavailable: Object.fromEntries(Object.entries(object3(value.headlineCostUnavailable)).map(([key, value2]) => [key, number3(value2)])),
      unpricedModelCalls: number3(value.unpricedModelCalls),
      indexing: value.indexing === true,
      discoveryTruncated: value.discoveryTruncated === true,
      discoverySkipped: number3(value.discoverySkipped),
      monthlyBudgetUsd: finite2(value.monthlyBudgetUsd) ? value.monthlyBudgetUsd : null
    };
  }
  function decodeUsageLimits(value) {
    if (!record8(value) || !Array.isArray(value.harnesses)) return { harnesses: [] };
    return { harnesses: value.harnesses.flatMap((harness) => {
      if (!record8(harness)) return [];
      return [{ harness: text9(harness.harness), label: text9(harness.label), error: text9(harness.error), reports: Array.isArray(harness.reports) ? harness.reports.flatMap((report) => {
        if (!record8(report) || typeof report.provider !== "string") return [];
        return [{ provider: report.provider, planType: text9(report.planType), fetchedAt: number3(report.fetchedAt), limits: Array.isArray(report.limits) ? report.limits.flatMap((limit) => {
          if (!record8(limit) || typeof limit.label !== "string" || !finite2(limit.usedFraction)) return [];
          return [{ label: limit.label, windowLabel: text9(limit.windowLabel), usedFraction: limit.usedFraction, resetsAt: finite2(limit.resetsAt) ? limit.resetsAt : null }];
        }) : [] }];
      }) : [] }];
    }) };
  }

  // src/browser/usage-view.ts
  function createUsageView(options2) {
    const document2 = options2.root.ownerDocument, window = document2.defaultView;
    const localStorage = options2.storage, isMultiHost = options2.multiHost;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing usage element: " + id);
      return value;
    };
    const message3 = (error) => error instanceof Error ? error.message : String(error);
    let disposed = false, dataSequence = 0;
    let bodyEvents = new AbortController(), chartEvents = new AbortController(), detailEvents = new AbortController();
    const events = new AbortController();
    let renderGeneration = 0;
    let renderQueue = null;
    let usageRange = "30", usageTimer;
    let usageData = null, usageChart = null, usageSelectedDay = null;
    let usageHostErrors = [], usageHostPending = [];
    let usageLimitsEntries = [], usageFetchSeq = 0;
    let usageSort = localStorage.getItem("pi-dish-usage-sort") === "tokens" ? "tokens" : "cost";
    let usageStack = localStorage.getItem("pi-dish-usage-stack") === "buckets" ? "buckets" : "models";
    const usageModelFilter = /* @__PURE__ */ new Set();
    function sameHost(host) {
      const current = options2.host(host.hostId);
      return !!current && current.hostId === host.hostId && current.base === host.base && (current.token || "") === (host.token || "");
    }
    function retireRender() {
      renderGeneration++;
      bodyEvents.abort();
      chartEvents.abort();
      detailEvents.abort();
      hideUsageTooltip();
    }
    const USAGE_RANGES = [["1", "Today"], ["7", "7 days"], ["30", "30 days"], ["all", "All time"]];
    const USAGE_RANGE_LABELS = { 1: "today", 7: "the last 7 days", 30: "the last 30 days", all: "all time" };
    function isUsageViewOpen() {
      return !disposed && options2.root.classList.contains("usage-open");
    }
    function openUsageView() {
      if (disposed) return;
      options2.closeOtherViews();
      if (isUsageViewOpen()) return;
      options2.root.classList.add("usage-open");
      loadUsageView();
    }
    function closeUsageView() {
      if (disposed) return;
      usageFetchSeq++;
      retireRender();
      renderQueue?.dispose();
      renderQueue = null;
      clearTimeout(usageResizeTimer);
      options2.root.classList.remove("usage-open");
      clearTimeout(usageTimer);
      usageTimer = void 0;
      hideUsageTooltip();
    }
    function setUsageRange(range) {
      if (!isUsageViewOpen()) return;
      usageRange = range;
      usageSelectedDay = null;
      loadUsageView();
    }
    function setUsageSort(sort) {
      if (!isUsageViewOpen()) return;
      if (usageSort === sort) return;
      usageSort = sort;
      localStorage.setItem("pi-dish-usage-sort", sort);
      loadUsageView();
    }
    function setUsageStack(stack) {
      if (!isUsageViewOpen()) return;
      if (usageStack === stack) return;
      usageStack = stack;
      localStorage.setItem("pi-dish-usage-stack", stack);
      if (usageData) renderUsageView(usageData);
    }
    function usageModelsKey() {
      return [...usageModelFilter].join(",");
    }
    function toggleUsageModelFilter(ref) {
      if (!isUsageViewOpen()) return;
      if (usageModelFilter.has(ref)) usageModelFilter.delete(ref);
      else usageModelFilter.add(ref);
      loadUsageView();
    }
    function clearUsageModelFilter() {
      if (!isUsageViewOpen()) return;
      if (!usageModelFilter.size) return;
      usageModelFilter.clear();
      loadUsageView();
    }
    async function loadUsageLimits(fetchSeq) {
      const stale = () => fetchSeq !== usageFetchSeq || !isUsageViewOpen();
      usageLimitsEntries = [];
      await options2.fleetReady();
      if (stale()) return;
      const hosts = options2.hosts().filter((host) => host.capabilities?.usageLimits).map((host) => Object.freeze({ ...host }));
      const entries = [];
      await Promise.all(hosts.map(async (host) => {
        try {
          const response = await options2.request(host, "/api/usage-limits", { timeoutMs: 2e4 });
          if (response.status === 401) {
            if (sameHost(host)) options2.connection(host, "blocked");
            throw new Error("needs a token");
          }
          const data = await response.json();
          if (!response.ok || stale() || !sameHost(host)) return;
          const payload = decodeUsageLimits(data);
          if (payload.harnesses?.length) entries.push({ hostLabel: hostDisplayLabel(host), payload });
        } catch {
        }
        if (stale()) return;
        usageLimitsEntries = [...entries].sort((a, b) => a.hostLabel.localeCompare(b.hostLabel));
        if (usageData && dataSequence === fetchSeq) renderUsageView(usageData);
      }));
    }
    async function loadUsageView() {
      if (!isUsageViewOpen()) return;
      const fetchSeq = ++usageFetchSeq;
      clearTimeout(usageTimer);
      renderQueue?.dispose();
      renderQueue = null;
      void loadUsageLimits(fetchSeq);
      const range = usageRange, sort = usageSort, models = usageModelsKey();
      const stale = () => fetchSeq !== usageFetchSeq || range !== usageRange || sort !== usageSort || models !== usageModelsKey() || !isUsageViewOpen();
      const body = element("usageViewBody");
      if (body.childElementCount) body.classList.add("usage-refreshing");
      else body.innerHTML = '<div class="usage-state">Loading estimated usage\u2026</div>';
      try {
        await options2.fleetReady();
        if (stale()) return;
        const url = "/api/usage-summary?days=" + range + "&sort=" + sort + (models ? "&models=" + encodeURIComponent(models) : "");
        const hosts = options2.hosts().map((host) => Object.freeze({ ...host }));
        const status = hosts.map(() => "pending");
        const entries = new Array(hosts.length), reasons = new Array(hosts.length);
        let indexing = false, rendered = false;
        const render = () => {
          if (stale()) return;
          const ok = entries.filter((entry, i) => status[i] === "ok" && !!entry);
          const data = mergeUsageSummaries(ok);
          if (!data) return;
          usageHostErrors = hosts.filter((_, i) => status[i] === "error").map(hostDisplayLabel);
          usageHostPending = hosts.filter((_, i) => status[i] === "pending").map(hostDisplayLabel);
          usageData = data;
          dataSequence = fetchSeq;
          rendered = true;
          indexing = data.indexing === true;
          renderUsageView(data);
        };
        const queueRender = renderQueue = createFanoutRenderQueue(status, render);
        await Promise.all(hosts.map(async (host, i) => {
          try {
            const response = await options2.request(host, url, { timeoutMs: 2e4 });
            if (response.status === 401) {
              if (sameHost(host)) options2.connection(host, "blocked");
              throw new Error("needs a token");
            }
            const data = await response.json();
            if (!sameHost(host)) throw new Error("host connection changed");
            if (!response.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
            entries[i] = { hostId: host.hostId, hostLabel: hostDisplayLabel(host), summary: decodeUsageSummary(data, { hostId: host.hostId, label: hostDisplayLabel(host) }) };
            status[i] = "ok";
            options2.connection(host, "success");
          } catch (error) {
            status[i] = "error";
            reasons[i] = error;
            if (!host.self && sameHost(host)) options2.connection(host, "failure", error);
          }
          queueRender();
        }));
        if (!status.some((state) => state === "ok")) throw reasons.find(Boolean) || new Error("no hosts answered");
        if (stale() || !rendered) return;
        if (indexing) usageTimer = setTimeout(() => {
          if (!stale()) void loadUsageView();
        }, 1e3);
      } catch (error) {
        if (stale()) return;
        retireRender();
        body.classList.remove("usage-refreshing");
        body.innerHTML = `<div class="usage-state">Could not load usage: ${escapeHtml(message3(error))}</div>`;
      }
    }
    function usageMetricValue(bucket2, metric) {
      if (metric === "cost") return finite2(bucket2.costs?.total) ? bucket2.costs.total : 0;
      if (metric === "tokens") return usageTokensTotal(bucket2.tokens);
      return bucket2.calls || 0;
    }
    const USAGE_METRIC_LABELS = { cost: "Estimated spend", tokens: "Tokens", calls: "Calls" };
    const USAGE_COST_BUCKETS = [
      ["input", "Read", "c1"],
      ["cacheRead", "Cached read", "c2"],
      ["output", "Output", "c3"],
      ["cacheWrite", "Cache write", "c4"]
    ];
    function usageCostBreakdown(costs2) {
      if (!costs2 || !finite2(costs2.total)) return null;
      const parts = USAGE_COST_BUCKETS.map(([key, label]) => `${label} ${formatEstimatedCost(costs2[key])}`);
      const unattributed = usageUnattributedCost(costs2);
      if (unattributed > 1e-12) parts.push(`Unattributed ${formatEstimatedCost(unattributed)}`);
      return parts.join(" \xB7 ");
    }
    function usageModelValue(m, metric) {
      if (metric === "cost") return finite2(m?.cost) ? m.cost : 0;
      if (metric === "tokens") return usageTokensTotal(m?.tokens);
      return m?.calls || 0;
    }
    function usageTokensTotal(tokens2) {
      return ["input", "output", "cacheRead", "cacheWrite"].reduce((s, k) => s + (tokens2?.[k] || 0), 0);
    }
    function usageTokensDetail(tokens2) {
      const t = tokens2 || {};
      const parts = [`${formatTokens(t.input)} in / ${formatTokens(t.output)} out`];
      const prompt = (t.input || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
      if (prompt > 0 && (t.cacheRead || 0) > 0) parts.push(`${Math.round((t.cacheRead || 0) / prompt * 100)}% cached`);
      return parts.join(" \xB7 ");
    }
    function renderUsageView(d) {
      if (!isUsageViewOpen()) return;
      retireRender();
      bodyEvents = new AbortController();
      const generation = renderGeneration;
      const owns = () => generation === renderGeneration && isUsageViewOpen();
      const listener = { signal: bodyEvents.signal };
      const body = element("usageViewBody");
      body.classList.remove("usage-refreshing");
      const t = d.totals || {}, h = d.headlineCosts || {};
      const hu = d.headlineCostUnavailable || {};
      const budget = d.monthlyBudgetUsd;
      const hbb = d.headlineCostsByBucket || {};
      const kpis = [["Today", "today"], ["Last 7 days", "days7"], ["Last 30 days", "days30"], ["This month", "month"]].map(([label, key]) => {
        const title = [
          usageCostBreakdown(hbb[key]),
          hu[key] ? `${hu[key]} unpriced calls are omitted from this estimate` : null
        ].filter(Boolean).join("\n");
        return `<div class="usage-kpi"${title ? ` title="${escapeHtml(title)}"` : ""}><small>${label}</small><strong>${formatUsageCost(h[key], hu[key])}</strong></div>`;
      }).join("");
      let budgetHtml = "";
      if (budget) {
        if (finite2(h.month)) {
          const pct = Math.min(100, h.month / budget * 100);
          const cls = pct >= 100 ? " over" : pct >= 80 ? " warn" : "";
          const partial = hu.month ? ` \xB7 ${hu.month} unpriced calls omitted` : "";
          budgetHtml = `<div class="usage-budget${cls}"><div class="usage-budget-track"><div class="usage-budget-fill" style="width:${pct.toFixed(1)}%"></div></div><small>${formatUsageCost(h.month, hu.month)} of ~$${Number(budget).toFixed(2)} monthly budget${partial}${pct >= 100 ? " \u2014 over budget" : ""}</small></div>`;
        } else {
          budgetHtml = `<div class="usage-budget"><small>Budget tracking unavailable${hu.month ? ` \u2014 ${hu.month} calls have unavailable pricing` : ""}.</small></div>`;
        }
      }
      const summary = `<div class="usage-total-line"><strong>${formatUsageCost(t.costs?.total, t.costUnavailable?.total)}</strong> \xB7 ${t.calls || 0} calls \xB7 ${formatTokens(usageTokensTotal(t.tokens))} tokens in ${USAGE_RANGE_LABELS[d.range || ""] || "the selected range"}</div><div class="usage-token-line">${formatTokens(t.tokens?.input)} in \xB7 ${formatTokens(t.tokens?.output)} out \xB7 cache ${formatCacheStat(t.tokens?.cacheRead, t.tokens?.cacheWrite, t.tokens?.input)}</div>`;
      const filterNote = usageModelFilter.size ? `<div class="usage-filter-note">Filtered to ${[...usageModelFilter].map((r) => `<b title="${escapeHtml(r)}">${escapeHtml(shortModelName(r))}</b>`).join(", ")}<button class="usage-range-btn" data-clear-models>\u2715 clear</button></div>` : "";
      const metric = usageSort === "tokens" ? "tokens" : finite2(t.costs?.total) && t.costs.total > 0 ? "cost" : "calls";
      const ranges = USAGE_RANGES.map(([v, l]) => `<button class="usage-range-btn${usageRange === v ? " active" : ""}" data-range="${v}">${l}</button>`).join("");
      const sortCtl = `<span class="usage-sort"><small>Show</small>${[["cost", "Cost"], ["tokens", "Tokens"]].map(([v, l]) => `<button class="usage-range-btn${usageSort === v ? " active" : ""}" data-sort="${v}">${l}</button>`).join("")}</span>`;
      const activeModels = (d.groups?.models || []).filter((m) => !usageModelFilter.size || usageModelFilter.has(m.key || ""));
      const daily = d.daily || [];
      const buckets = daily.length > 90 ? aggregateUsageWeekly(daily) : daily;
      const seriesRefs = activeModels.slice(0, 5).map((m) => m.key || "");
      usageChart = { buckets, seriesRefs, metric, activeModelCount: activeModels.length, stack: metric === "cost" ? usageStack : "models" };
      const showChart = d.range !== "1" && buckets.length > 1 && (t.calls || 0) > 0;
      const stackCtl = showChart && metric === "cost" ? `<span class="usage-sort"><small>Stack</small>${[["models", "Models"], ["buckets", "Cost buckets"]].map(([v, l]) => `<button class="usage-range-btn${usageChart?.stack === v ? " active" : ""}" data-stack="${v}">${l}</button>`).join("")}</span>` : "";
      const chartSection = showChart ? `<section class="usage-section"><h4>${USAGE_METRIC_LABELS[metric]} per ${buckets === daily ? "day" : "week"}</h4><div class="usage-chart" id="usageChart"></div></section>` : "";
      if (d.range === "1" && daily.length) usageSelectedDay = daily[daily.length - 1].day;
      body.innerHTML = `
      <div class="usage-kpis">${kpis}</div>
      ${budgetHtml}
      ${d.indexing ? '<div class="usage-notice">History is indexing; totals will refresh\u2026</div>' : ""}
      ${usageHostErrors.length ? `<div class="usage-notice">Not counted: ${escapeHtml(usageHostErrors.join(", "))} did not answer.</div>` : ""}
      ${usageHostPending.length ? `<div class="usage-notice">Still counting ${escapeHtml(usageHostPending.join(", "))}\u2026</div>` : ""}
      <div class="usage-ranges">${ranges}${sortCtl}${stackCtl}</div>
      ${(t.calls || 0) === 0 ? '<div class="usage-state">No usage in this range.</div>' : summary}
      ${filterNote}
      ${usageBucketShareHtml(t)}
      ${chartSection}
      <div id="usageDayDetail"></div>
      ${usageModelShareHtml(d, metric, seriesRefs)}
      <div class="usage-columns">
        ${usageGroupListHtml("Workspaces", d.groups?.workspaces, "workspace", metric)}
        ${usageGroupListHtml("Sessions", d.groups?.sessions, "session", metric)}
      </div>
      ${d.unpricedModelCalls ? `<div class="usage-notice">* Known priced usage only; ${d.unpricedModelCalls} call${d.unpricedModelCalls === 1 ? "" : "s"} ${d.unpricedModelCalls === 1 ? "has" : "have"} unavailable pricing and ${d.unpricedModelCalls === 1 ? "is" : "are"} omitted.</div>` : ""}
      ${usageLimitsHtml(usageLimitsEntries)}
    `;
      body.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => {
        const range = button.dataset.range;
        if (owns() && (range === "1" || range === "7" || range === "30" || range === "all")) setUsageRange(range);
      }, listener));
      body.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
        const sort = button.dataset.sort;
        if (owns() && (sort === "cost" || sort === "tokens")) setUsageSort(sort);
      }, listener));
      body.querySelectorAll("[data-stack]").forEach((button) => button.addEventListener("click", () => {
        const stack = button.dataset.stack;
        if (owns() && (stack === "models" || stack === "buckets")) setUsageStack(stack);
      }, listener));
      body.querySelector("[data-clear-models]")?.addEventListener("click", () => {
        if (owns()) clearUsageModelFilter();
      }, listener);
      body.querySelectorAll("[data-model-ref]").forEach((row) => {
        const ref = row.dataset.modelRef;
        const activate = () => {
          if (owns() && ref) toggleUsageModelFilter(ref);
        };
        row.addEventListener("click", activate, listener);
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        }, listener);
      });
      body.querySelectorAll("[data-session-id]").forEach((row) => {
        const id = row.dataset.sessionId, host = row.dataset.sessionHost || null;
        const endpoint = options2.host(host);
        const captured = endpoint ? Object.freeze({ ...endpoint }) : null;
        row.addEventListener("click", () => {
          if (!owns() || !id || !captured || !sameHost(captured)) return;
          closeUsageView();
          void options2.selectSession(id, { host });
        }, listener);
      });
      if (showChart) drawUsageChart();
      renderUsageDayDetail();
    }
    function drawUsageChart() {
      if (!isUsageViewOpen()) return;
      chartEvents.abort();
      chartEvents = new AbortController();
      const generation = renderGeneration;
      const owns = () => generation === renderGeneration && isUsageViewOpen();
      const holder = document2.getElementById("usageChart");
      if (!holder || !usageChart) return;
      const { buckets, seriesRefs, metric } = usageChart;
      const stackBuckets = usageChart.stack === "buckets";
      const width = Math.max(280, holder.clientWidth || 0);
      const max = Math.max(...buckets.map((b) => usageMetricValue(b, metric)));
      const { step, top, ticks } = niceTicks(max);
      const dec = (String(step).split(".")[1] || "").length;
      const fmtTick = (v) => metric === "cost" ? v === 0 ? "$0" : "$" + v.toFixed(dec) : formatTokens(v);
      const yLabelW = Math.max(...ticks.map((v) => fmtTick(v).length)) * 6.5 + 12;
      const margin = { top: 8, right: 4, bottom: 22, left: Math.ceil(yLabelW) };
      const plotH = 170;
      const height = margin.top + plotH + margin.bottom;
      const plotW = Math.max(60, width - margin.left - margin.right);
      const n = buckets.length;
      const band = plotW / n;
      const barW = Math.max(2, Math.min(24, band - 2));
      const yFor = (v) => margin.top + plotH - (top > 0 ? v / top * plotH : 0);
      const parts = [];
      for (const v of ticks) {
        const y = yFor(v);
        if (v > 0) parts.push(`<line class="grid" x1="${margin.left}" x2="${margin.left + plotW}" y1="${y}" y2="${y}"/>`);
        parts.push(`<text class="tick" x="${margin.left - 6}" y="${y + 3}" text-anchor="end">${fmtTick(v)}</text>`);
      }
      parts.push(`<line class="axis" x1="${margin.left}" x2="${margin.left + plotW}" y1="${yFor(0)}" y2="${yFor(0)}"/>`);
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
            const v = finite2(b.costs?.[key]) ? b.costs[key] : 0;
            if (v > 0) segs.push({ cls, v });
          });
          const unattributed = usageUnattributedCost(b.costs);
          if (unattributed > 1e-12) {
            segs.push({ cls: "sother", v: unattributed });
            anyOther = true;
          }
        } else {
          const byRef = new Map((b.models || []).map((m) => [m.ref, m]));
          let known = 0;
          seriesRefs.forEach((ref, s) => {
            const v = byRef.has(ref) ? usageModelValue(byRef.get(ref), metric) : 0;
            known += v;
            if (v > 0) segs.push({ cls: "s" + (s + 1), v });
          });
          const other = Math.max(0, total - known);
          if (other > 0) {
            segs.push({ cls: "sother", v: other });
            anyOther = true;
          }
        }
        const x = margin.left + band * i + (band - barW) / 2;
        const label = ((b.days || 1) > 1 ? `Week of ${formatUsageDay(b.day)}` : formatUsageDay(b.day, "long")) + ": " + (metric === "cost" ? formatUsageCost(b.costs?.total, b.costUnavailable?.total) : metric === "tokens" ? `${formatTokens(usageTokensTotal(b.tokens))} tokens` : `${b.calls} calls`);
        const seg = [];
        let cursor2 = yFor(0);
        for (let sI = 0; sI < segs.length; sI++) {
          const hPx = top > 0 ? segs[sI].v / top * plotH : 0;
          if (hPx <= 0) continue;
          const isTop = sI === segs.length - 1;
          const drawH = Math.max(0.75, hPx - (isTop ? 0 : 2));
          const yTop = cursor2 - hPx;
          if (isTop) {
            const r = Math.min(3, barW / 2, drawH);
            seg.push(`<path class="seg ${segs[sI].cls}" d="M${x},${(yTop + drawH).toFixed(1)} V${(yTop + r).toFixed(1)} Q${x},${yTop.toFixed(1)} ${x + r},${yTop.toFixed(1)} H${(x + barW - r).toFixed(1)} Q${x + barW},${yTop.toFixed(1)} ${x + barW},${(yTop + r).toFixed(1)} V${(yTop + drawH).toFixed(1)} Z"/>`);
          } else {
            seg.push(`<rect class="seg ${segs[sI].cls}" x="${x}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${drawH.toFixed(1)}"/>`);
          }
          cursor2 = yTop;
        }
        parts.push(`<g class="usage-col${b.day === usageSelectedDay ? " selected" : ""}" data-i="${i}" tabindex="0" role="button" aria-label="${escapeHtml(label)}"><rect class="hit" x="${margin.left + band * i}" y="${margin.top}" width="${band.toFixed(2)}" height="${plotH}"/>${seg.join("")}</g>`);
      }
      const legendItems = stackBuckets ? USAGE_COST_BUCKETS.map(([, label, cls]) => `<span class="usage-legend-item"><i class="swatch ${cls}"></i>${escapeHtml(label)}</span>`) : seriesRefs.map((ref, i) => `<span class="usage-legend-item" title="${escapeHtml(ref)}"><i class="swatch s${i + 1}"></i>${escapeHtml(shortModelName(ref))}</span>`);
      if (stackBuckets && anyOther)
        legendItems.push('<span class="usage-legend-item"><i class="swatch sother"></i>Unattributed</span>');
      else if (!stackBuckets && (anyOther || (usageChart.activeModelCount || 0) > seriesRefs.length))
        legendItems.push('<span class="usage-legend-item"><i class="swatch sother"></i>other</span>');
      holder.innerHTML = `<svg width="${width}" height="${height}" role="img" aria-label="${USAGE_METRIC_LABELS[metric]} per ${(buckets[0]?.days || 1) > 1 ? "week" : "day"}">${parts.join("")}</svg>` + (legendItems.length > 1 ? `<div class="usage-legend">${legendItems.join("")}</div>` : "");
      const listener = { signal: chartEvents.signal };
      const column = (event) => event.target instanceof Element ? event.target.closest(".usage-col") : null;
      holder.addEventListener("pointermove", (event) => {
        if (!owns()) return;
        const g = column(event), bucket2 = g ? buckets[Number(g.dataset.i)] : null;
        if (!bucket2) {
          hideUsageTooltip();
          return;
        }
        showUsageTooltip(bucket2, event);
      }, listener);
      holder.addEventListener("pointerleave", () => {
        if (owns()) hideUsageTooltip();
      }, listener);
      const activate = (event) => {
        const g = column(event), bucket2 = g ? buckets[Number(g.dataset.i)] : null;
        if (owns() && bucket2) toggleUsageDay(bucket2.day);
      };
      holder.addEventListener("click", activate, listener);
      holder.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(event);
        }
      }, listener);
    }
    function toggleUsageDay(day) {
      if (!isUsageViewOpen()) return;
      usageSelectedDay = usageSelectedDay === day ? null : day;
      document2.querySelectorAll("#usageChart .usage-col").forEach((g) => {
        g.classList.toggle("selected", usageChart?.buckets[Number(g.dataset.i)]?.day === usageSelectedDay);
      });
      renderUsageDayDetail();
    }
    function renderUsageDayDetail() {
      if (!isUsageViewOpen()) return;
      detailEvents.abort();
      detailEvents = new AbortController();
      const generation = renderGeneration, day = usageSelectedDay;
      const holder = document2.getElementById("usageDayDetail");
      if (!holder) return;
      const bucket2 = usageChart?.buckets?.find((b) => b.day === usageSelectedDay) || (usageData?.range === "1" ? usageData.daily?.[usageData.daily.length - 1] : null);
      if (!bucket2 || !usageSelectedDay) {
        holder.innerHTML = "";
        return;
      }
      const metric = usageChart?.metric || "cost";
      const title = (bucket2.days || 1) > 1 ? `Week of ${formatUsageDay(bucket2.day)} <small>\xB7 ${bucket2.days} days</small>` : formatUsageDay(bucket2.day, "long");
      const tok = bucket2.tokens || {};
      const stats = [
        ["Estimated spend", formatUsageCost(bucket2.costs?.total, bucket2.costUnavailable?.total)],
        ["Calls", String(bucket2.calls || 0)],
        ["Tokens in / out", `${formatTokens(tok.input)} / ${formatTokens(tok.output)}`],
        ["Cache", formatCacheStat(tok.cacheRead, tok.cacheWrite, tok.input)],
        // Per-bucket spend keeps the day detail pivoted like the range totals.
        ...finite2(bucket2.costs?.total) ? [
          ...USAGE_COST_BUCKETS.map(([key, label]) => [label, formatEstimatedCost(bucket2.costs?.[key])]),
          ...usageUnattributedCost(bucket2.costs) > 1e-12 ? [["Unattributed", formatEstimatedCost(usageUnattributedCost(bucket2.costs))]] : []
        ] : []
      ].map(([k, v]) => `<div><small>${k}</small><strong>${v}</strong></div>`).join("");
      const slotFor = (ref) => {
        const i = (usageChart?.seriesRefs || []).indexOf(ref || "");
        return i >= 0 ? "s" + (i + 1) : "sother";
      };
      const rows = (bucket2.models || []).map((m) => {
        const meta = [`${m.calls} calls`, `${formatTokens(usageTokensTotal(m.tokens))} tok`];
        if (usageTokensTotal(m.tokens) > 0) meta.push(usageTokensDetail(m.tokens));
        if (metric === "cost") meta.push(formatUsageCost(m.cost, m.costUnavailable?.total));
        return `
      <div class="usage-row" title="${escapeHtml(m.ref)}">
        <i class="swatch ${slotFor(m.ref)}"></i>
        <span class="usage-row-name">${escapeHtml(shortModelName(m.model || m.ref))}<small>${escapeHtml(m.provider || "")}</small></span>
        <span class="usage-row-meta">${meta.join(" \xB7 ")}</span>
      </div>`;
      }).join("");
      holder.innerHTML = `<section class="usage-day-detail">
      <div class="usage-day-detail-header"><h4>${title}</h4><button class="btn-icon" title="Close details" data-close-day>\u2715</button></div>
      <div class="usage-day-stats">${stats}</div>
      ${rows || '<small class="usage-empty">No usage this day.</small>'}
    </section>`;
      holder.querySelector("[data-close-day]")?.addEventListener("click", () => {
        if (generation === renderGeneration && day === usageSelectedDay) toggleUsageDay(day);
      }, { signal: detailEvents.signal });
    }
    function usageBucketShareHtml(t) {
      if (!finite2(t.costs?.total) || t.costs.total <= 0) return "";
      const total = t.costs.total, unpriced = t.costUnavailable?.total || 0;
      const segs = [], legend = [];
      for (const [key, label, cls] of USAGE_COST_BUCKETS) {
        const v = finite2(t.costs[key]) ? t.costs[key] : 0;
        const share = v / total;
        if (share > 4e-3) segs.push(`<span class="${cls}" style="flex-grow:${(share * 1e3).toFixed(1)}" title="${escapeHtml(label)}"></span>`);
        legend.push(`<span class="usage-legend-item"><i class="swatch ${cls}"></i>${escapeHtml(label)} <b>${formatEstimatedCost(v)}</b> <small>${Math.round(share * 100)}%</small></span>`);
      }
      const unattributed = usageUnattributedCost(t.costs);
      if (unattributed > 1e-12) {
        const share = unattributed / total;
        if (share > 4e-3) segs.push(`<span class="sother" style="flex-grow:${(share * 1e3).toFixed(1)}" title="Unattributed"></span>`);
        legend.push(`<span class="usage-legend-item"><i class="swatch sother"></i>Unattributed <b>${formatEstimatedCost(unattributed)}</b> <small>${Math.round(share * 100)}%</small></span>`);
      }
      return `<section class="usage-section"><h4>Spend by bucket${unpriced ? ` <small class="usage-hint">${unpriced} unpriced call${unpriced === 1 ? "" : "s"} omitted</small>` : ""}</h4>
      <div class="usage-share-bar">${segs.join("")}</div>
      <div class="usage-legend">${legend.join("")}</div></section>`;
    }
    function usageModelShareHtml(d, metric, seriesRefs) {
      const models = d.groups?.models || [];
      const filtered = usageModelFilter.size > 0;
      if (!models.length && !filtered) return "";
      const isOn = (ref) => !filtered || usageModelFilter.has(ref || "");
      const val = (m) => usageModelValue({ cost: m.costs?.total, calls: m.calls, tokens: m.tokens }, metric);
      const slotFor = (ref) => {
        const i = seriesRefs.indexOf(ref || "");
        return i >= 0 ? "s" + (i + 1) : "sother";
      };
      const active = models.filter((m) => isOn(m.key));
      const total = active.reduce((s, m) => s + val(m), 0);
      const segs = [];
      active.slice(0, 5).forEach((m) => {
        const share = total > 0 ? val(m) / total : 0;
        if (share > 4e-3) segs.push(`<span class="${slotFor(m.key)}" style="flex-grow:${(share * 1e3).toFixed(1)}" title="${escapeHtml(shortModelName(m.key))}"></span>`);
      });
      const restShare = total > 0 ? active.slice(5).reduce((s, m) => s + val(m), 0) / total : 0;
      if (restShare > 4e-3) segs.push(`<span class="sother" style="flex-grow:${(restShare * 1e3).toFixed(1)}" title="other models"></span>`);
      const rowHtml = (m, on) => {
        const share = on && total > 0 ? val(m) / total : 0;
        const pct = share > 0 ? (share * 100 < 1 ? (share * 100).toFixed(1) : Math.round(share * 100)) + "%" : "\u2014";
        const spend = `${formatUsageCost(m.costs?.total, m.unpricedCalls)}${m.unpricedCalls ? ` \xB7 ${m.unpricedCalls} unpriced` : ""}`;
        const detail = usageTokensTotal(m.tokens) > 0 ? ` \xB7 ${usageTokensDetail(m.tokens)}` : "";
        const breakdown = usageCostBreakdown(m.costs);
        return `<div class="usage-row model-toggle${filtered ? on ? " on" : " off" : ""}" data-model-ref="${escapeHtml(m.key)}" role="button" tabindex="0" aria-pressed="${on}" title="${escapeHtml([m.key, breakdown].filter(Boolean).join("\n"))} \u2014 click to toggle model filter">
        <i class="swatch ${on ? slotFor(m.key) : "soff"}"></i>
        <span class="usage-row-name">${escapeHtml(shortModelName(m.model || m.key))}<small>${escapeHtml(m.provider || "")}</small></span>
        <span class="usage-row-meta">${pct} \xB7 ${m.calls} calls \xB7 ${formatTokens(usageTokensTotal(m.tokens))} tok${detail} \xB7 ${escapeHtml(spend)}</span>
      </div>`;
      };
      const rows = models.map((m) => rowHtml(m, isOn(m.key))).join("");
      const missing = [...usageModelFilter].filter((ref) => !models.some((m) => m.key === ref)).map((ref) => rowHtml({ key: ref, calls: 0, tokens: {}, costs: { total: 0 } }, true)).join("");
      return `<section class="usage-section"><h4>Models <small class="usage-hint">click to filter</small></h4>
      ${segs.length ? `<div class="usage-share-bar">${segs.join("")}</div>` : ""}
      ${rows}${missing}</section>`;
    }
    function usageGroupListHtml(title, rows, kind, metric) {
      const list = (rows || []).slice(0, 12);
      const val = (x) => usageModelValue({ cost: x.costs?.total, calls: x.calls, tokens: x.tokens }, metric);
      const maxV = Math.max(1e-9, ...list.map(val));
      const items = list.map((x) => {
        const name = kind === "workspace" ? shortCwd(x.key) : x.name || x.id;
        const sub = kind === "session" && x.workspace ? shortCwd(x.workspace) : "";
        const spend = `${formatUsageCost(x.costs?.total, x.unpricedCalls)}${x.unpricedCalls ? ` \xB7 ${x.unpricedCalls} unpriced` : ""}`;
        const attrs = kind === "session" ? ` data-session-id="${escapeHtml(x.id)}"${x.host ? ` data-session-host="${escapeHtml(x.host)}"` : ""} role="button" tabindex="0"` : "";
        const hostTag = isMultiHost() && x.hostLabel ? `<small class="usage-row-host">${escapeHtml(x.hostLabel)}</small>` : "";
        const detail = usageTokensTotal(x.tokens) > 0 ? ` \xB7 ${usageTokensDetail(x.tokens)}` : "";
        const breakdown = usageCostBreakdown(x.costs);
        return `<div class="usage-row usage-bar-row${kind === "session" ? " clickable" : ""}"${attrs} title="${escapeHtml([x.key || x.name || x.id, breakdown].filter(Boolean).join("\n"))}">
        <span class="usage-row-name">${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ""}${hostTag}</span>
        <span class="usage-row-meta">${x.calls} calls \xB7 ${formatTokens(usageTokensTotal(x.tokens))} tok${detail} \xB7 ${escapeHtml(spend)}</span>
        <span class="usage-row-bar" style="width:${(val(x) / maxV * 100).toFixed(1)}%"></span>
      </div>`;
      }).join("");
      return `<section class="usage-section"><h4>${title}</h4>${items || '<small class="usage-empty">No usage in this range.</small>'}</section>`;
    }
    function ensureUsageTooltip() {
      let el = document2.getElementById("usageTooltip");
      if (!el) {
        el = document2.createElement("div");
        el.id = "usageTooltip";
        el.className = "usage-tooltip";
        document2.body.appendChild(el);
      }
      return el;
    }
    function showUsageTooltip(bucket2, e) {
      if (!bucket2) return;
      const el = ensureUsageTooltip();
      el.replaceChildren();
      const metric = usageChart?.metric || "cost";
      const head = document2.createElement("div");
      head.className = "tt-day";
      head.textContent = (bucket2.days || 1) > 1 ? `Week of ${formatUsageDay(bucket2.day)} \xB7 ${bucket2.days} days` : formatUsageDay(bucket2.day, "long");
      const total = document2.createElement("div");
      total.className = "tt-total";
      total.textContent = metric === "cost" ? `${formatUsageCost(bucket2.costs?.total, bucket2.costUnavailable?.total)} \xB7 ${bucket2.calls || 0} calls` : metric === "tokens" ? `${formatTokens(usageTokensTotal(bucket2.tokens))} tokens \xB7 ${bucket2.calls || 0} calls` : `${bucket2.calls} calls`;
      el.append(head, total);
      const rows = [];
      if (usageChart?.stack === "buckets" && metric === "cost") {
        USAGE_COST_BUCKETS.forEach(([key, label, cls]) => {
          rows.push([cls, label, finite2(bucket2.costs?.[key]) ? bucket2.costs[key] : 0]);
        });
        const unattributed = usageUnattributedCost(bucket2.costs);
        if (unattributed > 1e-12) rows.push(["sother", "Unattributed", unattributed]);
      } else {
        const seriesRefs = usageChart?.seriesRefs || [];
        const byRef = new Map((bucket2.models || []).map((m) => [m.ref, m]));
        seriesRefs.forEach((ref, i) => {
          const m = byRef.get(ref);
          if (m) rows.push(["s" + (i + 1), shortModelName(ref), usageModelValue(m, metric)]);
        });
        let otherV = 0, extra = 0;
        for (const m of bucket2.models || []) {
          if (!seriesRefs.includes(m.ref)) {
            otherV += usageModelValue(m, metric);
            extra++;
          }
        }
        if (extra) rows.push(["sother", `other (${extra} model${extra > 1 ? "s" : ""})`, otherV]);
      }
      for (const [cls, name, v] of rows) {
        const row = document2.createElement("div");
        row.className = "tt-row";
        const key = document2.createElement("i");
        key.className = "tt-key " + cls;
        const value = document2.createElement("strong");
        value.textContent = metric === "cost" ? formatEstimatedCost(v) : metric === "tokens" ? formatTokens(v) : String(v);
        const label = document2.createElement("span");
        label.textContent = name;
        row.append(key, value, label);
        el.appendChild(row);
      }
      el.style.display = "block";
      const pad = 12, r = el.getBoundingClientRect();
      let x = e.clientX + pad;
      if (x + r.width > window.innerWidth - 8) x = Math.max(8, e.clientX - r.width - pad);
      let y = e.clientY - r.height - pad;
      if (y < 8) y = e.clientY + pad;
      el.style.left = x + "px";
      el.style.top = y + "px";
    }
    function hideUsageTooltip() {
      const el = document2.getElementById("usageTooltip");
      if (el) el.style.display = "none";
    }
    let usageResizeTimer;
    window.addEventListener("resize", () => {
      if (!isUsageViewOpen()) return;
      clearTimeout(usageResizeTimer);
      usageResizeTimer = setTimeout(drawUsageChart, 150);
    }, { signal: events.signal });
    return {
      open: openUsageView,
      close: closeUsageView,
      isOpen: isUsageViewOpen,
      load: loadUsageView,
      setRange: setUsageRange,
      setSort: setUsageSort,
      setStack: setUsageStack,
      get data() {
        return usageData;
      },
      get chart() {
        return usageChart;
      },
      dispose() {
        closeUsageView();
        events.abort();
        document2.getElementById("usageTooltip")?.remove();
        disposed = true;
      }
    };
  }

  // src/browser/themes.ts
  function decodeThemeTokens(value) {
    if (!record8(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry) => /^--[a-z][a-z0-9-]*$/.test(entry[0]) && typeof entry[1] === "string"));
  }
  function decodeThemes(value) {
    if (!record8(value) || !Array.isArray(value.themes)) return [];
    return value.themes.flatMap((row) => record8(row) && typeof row.id === "string" && row.id ? [{ id: row.id, builtin: row.builtin === true, tokens: decodeThemeTokens(row.tokens) }] : []);
  }
  function applyCachedTheme(document2, storage) {
    try {
      const id = storage.getItem("pi-dish-theme");
      if (id && id !== "solarized") document2.documentElement.dataset.theme = id;
      const tokens2 = JSON.parse(storage.getItem("pi-dish-theme-tokens") || "null");
      for (const [key, value] of Object.entries(decodeThemeTokens(tokens2))) document2.documentElement.style.setProperty(key, value);
    } catch {
    }
  }
  function terminalTheme(document2) {
    const css = document2.defaultView.getComputedStyle(document2.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    return {
      background: v("--bg-darker"),
      foreground: v("--text"),
      cursor: v("--text-bright"),
      cursorAccent: v("--bg-darker"),
      selectionBackground: v("--bg-card"),
      black: v("--bg-card"),
      red: v("--error"),
      green: v("--success"),
      yellow: v("--warning"),
      blue: v("--accent"),
      magenta: "#d33682",
      cyan: v("--cyan"),
      white: "#eee8d5",
      brightBlack: v("--text-muted"),
      brightRed: v("--orange"),
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3"
    };
  }
  function createThemes(options2) {
    const { document: document2, storage } = options2;
    let disposed = false, sequence = 0;
    let available = [{ id: "solarized", builtin: true, tokens: {} }, { id: "graphite", builtin: true, tokens: {} }];
    function render(select = document2.querySelector("#settingsTheme")) {
      if (disposed || !select) return;
      const current = storage.getItem("pi-dish-theme") || "solarized";
      select.innerHTML = available.map((theme) => `<option value="${escapeHtml(theme.id)}"${theme.id === current ? " selected" : ""}>${escapeHtml(theme.id)}</option>`).join("");
    }
    function apply(id) {
      if (disposed) return;
      const theme = available.find((theme2) => theme2.id === id) || available[0];
      const root = document2.documentElement;
      for (const prop of [...root.style]) if (prop.startsWith("--")) root.style.removeProperty(prop);
      if (theme.id === "solarized") delete root.dataset.theme;
      else root.dataset.theme = theme.id;
      for (const [key, value] of Object.entries(theme.tokens)) root.style.setProperty(key, value);
      storage.setItem("pi-dish-theme", theme.id);
      storage.setItem("pi-dish-theme-tokens", JSON.stringify(Object.keys(theme.tokens).length ? theme.tokens : null));
      render();
      options2.changed();
    }
    async function load() {
      if (disposed) return;
      const own = ++sequence, endpoint = Object.freeze({ ...options2.host() });
      const current = () => !disposed && own === sequence && endpoint.base === options2.host().base && (endpoint.token || "") === (options2.host().token || "");
      try {
        const response = await options2.request(endpoint, "/api/themes");
        if (response.ok) {
          const data = await response.json();
          if (!current()) return;
          const decoded = decodeThemes(data);
          if (decoded.length) available = decoded;
        }
      } catch {
      }
      if (!current()) return;
      render();
      const saved = storage.getItem("pi-dish-theme");
      if (saved && saved !== "solarized") apply(saved);
    }
    return { render, apply, load, dispose() {
      disposed = true;
      sequence++;
    } };
  }

  // src/browser/panel-resize.ts
  var SIDEBAR_WIDTH_KEY = "pi-dish-sidebar-width";
  function clampSidebarWidth(px, viewportWidth) {
    return Math.round(Math.min(Math.max(220, px), Math.max(220, viewportWidth * 0.5)));
  }
  function clampTerminalHeight(px, parentHeight) {
    return Math.min(Math.round(parentHeight * 0.8), Math.max(140, px));
  }
  function createPanelResize(options2) {
    const { document: document2, storage } = options2, window = document2.defaultView;
    const events = new AbortController();
    const mounts = /* @__PURE__ */ new Set();
    const drags = /* @__PURE__ */ new Set();
    let disposed = false;
    function sidebarWidth() {
      if (disposed) return;
      const sidebar = document2.getElementById("sidebar");
      if (!sidebar) return;
      const saved = parseFloat(storage.getItem(SIDEBAR_WIDTH_KEY) || "");
      sidebar.style.width = Number.isFinite(saved) ? clampSidebarWidth(saved, window.innerWidth) + "px" : "";
    }
    function terminalSize(panel) {
      if (disposed) return;
      const saved = parseFloat(storage.getItem("pi-dish-terminal-size") || "");
      if (Number.isFinite(saved)) panel.style.flexBasis = Math.min(80, Math.max(10, saved)) + "%";
    }
    function mount(kind) {
      if (disposed || mounts.has(kind)) return;
      const handle = document2.getElementById(kind === "sidebar" ? "sidebarResizeHandle" : "terminalResizeHandle");
      const panel = document2.getElementById(kind === "sidebar" ? "sidebar" : "terminalPanel");
      if (!handle || !panel) return;
      mounts.add(kind);
      if (kind === "sidebar") {
        sidebarWidth();
        handle.addEventListener("dblclick", () => {
          storage.removeItem(SIDEBAR_WIDTH_KEY);
          panel.style.width = "";
          options2.fitTerminal();
        }, { signal: events.signal });
      }
      let cancelDrag = null;
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        cancelDrag?.();
        const startX = event.clientX, startY = event.clientY, startWidth = panel.offsetWidth, startHeight = panel.offsetHeight;
        const parentHeight = panel.parentElement?.clientHeight || 0;
        if (kind === "terminal" && parentHeight <= 0) return;
        const dragEvents = new AbortController(), pointer = event.pointerId;
        handle.setPointerCapture(pointer);
        handle.classList.add("dragging");
        let active = true;
        const finish = (save) => {
          if (!active) return;
          active = false;
          dragEvents.abort();
          drags.delete(cancel);
          cancelDrag = null;
          handle.classList.remove("dragging");
          if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
          if (!save || disposed) return;
          if (kind === "sidebar") storage.setItem(SIDEBAR_WIDTH_KEY, String(panel.offsetWidth));
          else {
            const pct = (panel.offsetHeight / parentHeight * 100).toFixed(1);
            storage.setItem("pi-dish-terminal-size", pct);
            panel.style.flexBasis = pct + "%";
          }
          options2.fitTerminal();
        };
        const cancel = () => finish(false);
        cancelDrag = cancel;
        drags.add(cancel);
        handle.addEventListener("pointermove", (move) => {
          if (move.pointerId !== pointer) return;
          if (kind === "sidebar") panel.style.width = clampSidebarWidth(startWidth + move.clientX - startX, window.innerWidth) + "px";
          else {
            panel.style.flexBasis = clampTerminalHeight(startHeight + startY - move.clientY, parentHeight) + "px";
            options2.fitTerminal();
          }
        }, { signal: dragEvents.signal });
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, (end) => {
          if (end.pointerId === pointer) finish(true);
        }, { signal: dragEvents.signal });
      }, { signal: events.signal });
    }
    return {
      sidebarWidth,
      terminalSize,
      sidebar: () => mount("sidebar"),
      terminal: () => mount("terminal"),
      dispose() {
        disposed = true;
        events.abort();
        for (const cancel of [...drags]) cancel();
        mounts.clear();
      }
    };
  }

  // src/browser/display-preferences.ts
  function decodeSavedFilters(value) {
    return Array.isArray(value) ? value.flatMap((row) => record8(row) && typeof row.name === "string" && typeof row.query === "string" ? [{ name: row.name, query: row.query }] : []) : [];
  }
  function responseMode(value) {
    return value === "hidden" || value === "performance" || value === "performance-cost" ? value : "compact";
  }
  var RESPONSE_MODE_KEY = "pi-dish-response-metadata";
  var CONTEXT_METRIC_KEY = "pi-dish-sidebar-context-metric";
  function createDisplayPreferences(options2) {
    const { document: document2, storage } = options2;
    const modal = document2.getElementById("settingsModal"), body = document2.getElementById("settingsBody");
    let disposed = false, sequence = 0;
    let events = new AbortController(), filterEvents = new AbortController();
    let mode = responseMode(storage.getItem(RESPONSE_MODE_KEY));
    let context = storage.getItem(CONTEXT_METRIC_KEY) === "tokens" ? "tokens" : "percent";
    function isOpen() {
      return !disposed && modal.style.display === "flex";
    }
    function retire() {
      sequence++;
      events.abort();
      filterEvents.abort();
      options2.unmountSections();
    }
    function close() {
      if (disposed) return;
      retire();
      modal.style.display = "none";
    }
    function open() {
      if (disposed) return;
      options2.beforeOpen();
      modal.style.display = "flex";
      void render();
      const scroll = modal.querySelector(".settings-body");
      if (scroll) scroll.scrollTop = 0;
    }
    async function render() {
      if (!isOpen()) return;
      retire();
      events = new AbortController();
      const seq = sequence, endpoint = Object.freeze({ ...options2.host() });
      const owns = () => seq === sequence && isOpen() && endpoint.base === options2.host().base && (endpoint.token || "") === (options2.host().token || "");
      const listener = { signal: events.signal };
      body.innerHTML = `<div class="preference-row"><label for="settingsTheme"><strong>Theme</strong><small>Stored on this device. Built-ins plus any token files in <code>~/.pi/dish/themes/</code>.</small></label>
    <select id="settingsTheme"></select></div>
    <div class="preference-row"><label for="sidebarContextMetric"><strong>Session list context readout</strong><small>Stored on this device. Which number each sidebar row shows for context use.</small></label>
    <select id="sidebarContextMetric"><option value="percent">Percent of context</option><option value="tokens">Token count</option></select></div>
    <div class="preference-row"><label for="responseMetadataMode"><strong>Response metadata</strong><small>Stored on this device. \u201CEffective speed\u201D includes time to first token and JSONL append.</small></label>
    <select id="responseMetadataMode"><option value="hidden">Hidden</option><option value="compact">Compact</option><option value="performance">Performance</option><option value="performance-cost">Performance + estimated cost</option></select></div>
    <div class="preference-row"><label for="monthlyBudget"><strong>Monthly budget warning (USD)</strong><small>Server-global: applies to every device. Estimates use each session harness's catalog pricing; blank clears.</small></label><div class="budget-save"><input id="monthlyBudget" type="number" min="0.01" step="0.01" placeholder="No warning"><button class="btn-small" id="saveBudget">Save</button></div><small id="budgetStatus"></small></div>
    <div id="recoveryPreferences" class="preference-row recovery-preferences" hidden></div>
    ${hostSettingsHtml}
    <div class="preference-row"><label><strong>Saved sidebar filters</strong><small>Server-global. Chips under the sidebar filter toggle these per device; type a query there and hit \u201C+ save filter\u201D to add one.</small></label><div id="savedFiltersList" class="saved-filters-list"></div></div>`;
      const modeSelect = body.querySelector("#responseMetadataMode");
      modeSelect.value = mode;
      modeSelect.addEventListener("change", () => {
        if (!owns()) return;
        mode = responseMode(modeSelect.value);
        storage.setItem(RESPONSE_MODE_KEY, mode);
        options2.metadataChanged();
      }, listener);
      const theme = body.querySelector("#settingsTheme");
      options2.themes.render(theme);
      theme.addEventListener("change", () => {
        if (owns()) options2.themes.apply(theme.value);
      }, listener);
      const metric = body.querySelector("#sidebarContextMetric");
      metric.value = context;
      metric.addEventListener("change", () => {
        if (!owns()) return;
        context = metric.value === "tokens" ? "tokens" : "percent";
        storage.setItem(CONTEXT_METRIC_KEY, context);
        options2.contextChanged();
      }, listener);
      function renderFilters() {
        if (!owns()) return;
        filterEvents.abort();
        filterEvents = new AbortController();
        const list = body.querySelector("#savedFiltersList");
        const filters = options2.filters();
        list.innerHTML = filters.length ? filters.map((filter) => `<div class="saved-filter-row"><span class="saved-filter-name">${escapeHtml(filter.name)}</span><code class="saved-filter-query">${escapeHtml(filter.query)}</code><button class="btn-icon saved-filter-del" data-name="${escapeHtml(filter.name)}" title="Delete filter">\u2715</button></div>`).join("") : '<small class="saved-filters-empty">No saved filters yet.</small>';
        for (const button of list.querySelectorAll(".saved-filter-del")) {
          const name = button.dataset.name;
          button.addEventListener("click", async () => {
            if (!owns() || button.disabled) return;
            button.disabled = true;
            try {
              await options2.persistFilters(options2.filters().filter((filter) => filter.name !== name), endpoint);
              if (owns()) renderFilters();
            } catch (error) {
              if (owns()) {
                button.disabled = false;
                options2.alert("Could not delete filter: " + message2(error));
              }
            }
          }, { signal: filterEvents.signal });
        }
      }
      renderFilters();
      options2.mountSections(body);
      const input = body.querySelector("#monthlyBudget"), status = body.querySelector("#budgetStatus"), save = body.querySelector("#saveBudget");
      save.disabled = true;
      try {
        const response = await options2.request(endpoint, "/api/settings");
        const data = await response.json();
        if (!owns()) return;
        if (!response.ok || !record8(data)) throw new Error("Could not load server setting.");
        input.value = finite2(data.monthlyBudgetUsd) ? String(data.monthlyBudgetUsd) : "";
        if (Array.isArray(data.savedFilters)) {
          options2.setFilters(decodeSavedFilters(data.savedFilters));
          renderFilters();
        }
      } catch {
        if (owns()) status.textContent = "Could not load server setting.";
      }
      if (!owns()) return;
      save.disabled = false;
      save.addEventListener("click", async () => {
        if (!owns() || save.disabled) return;
        save.disabled = true;
        const value = input.value.trim() === "" ? null : Number(input.value);
        try {
          const response = await options2.request(endpoint, "/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monthlyBudgetUsd: value }) });
          const data = await response.json();
          if (!response.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : "Save failed");
          if (owns()) status.textContent = "Saved for all devices.";
        } catch (error) {
          if (owns()) status.textContent = "Save failed: " + message2(error);
        } finally {
          if (owns()) save.disabled = false;
        }
      }, listener);
    }
    return { open, close, render, get responseMode() {
      return mode;
    }, get contextMetric() {
      return context;
    }, dispose() {
      close();
      disposed = true;
    } };
  }
  function message2(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // src/browser/terminal.ts
  function decodeTerminalOutput(value) {
    if (!record8(value)) return null;
    switch (value.type) {
      case "attach":
        return { type: "attach", replay: typeof value.replay === "string" ? value.replay : "", cwd: typeof value.cwd === "string" ? value.cwd : "", tmuxPrefix: typeof value.tmuxPrefix === "string" ? value.tmuxPrefix : null };
      case "output":
        return typeof value.data === "string" ? { type: "output", data: value.data } : null;
      case "exit":
        return { type: "exit", code: finite2(value.code) ? value.code : null };
      case "error":
        return typeof value.error === "string" ? { type: "error", error: value.error } : null;
      default:
        return null;
    }
  }
  function createTerminalController(options2) {
    const { document: document2, storage, sessionState } = options2, window = document2.defaultView;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing terminal element: " + id);
      return value;
    };
    let state = null, disposed = false, generation = 0, ctrlLatch = false;
    let assets = null, cancelOpen = null;
    const events = new AbortController();
    let keybarMounted = false;
    function sameHost(owner, endpoint) {
      const host = options2.host(owner.host);
      return !!host && host.base === endpoint.base && (host.token || "") === (endpoint.token || "");
    }
    function owns(value) {
      return !disposed && value === state && sessionState.ownsSelection(value.owner) && sameHost(value.owner, value.endpoint);
    }
    function modeKey(id, host = sessionState.sessionHostId(id)) {
      return "pi-dish-terminal-mode-" + sessionKey(host, id);
    }
    function loadAssets() {
      if (disposed) return Promise.resolve();
      if (!assets) assets = (async () => {
        await Promise.all([options2.asset("link", { rel: "stylesheet", href: "vendor/xterm.css" }), options2.asset("script", { src: "vendor/xterm.js" })]);
        await options2.asset("script", { src: "vendor/xterm-addon-fit.js" });
      })();
      return assets;
    }
    function status(text17 = "", cls = "") {
      const value = document2.getElementById("terminalStatus");
      if (!value) return;
      value.textContent = text17;
      value.className = "terminal-status" + (cls ? " " + cls : "");
    }
    function setCtrl(on) {
      ctrlLatch = on;
      document2.getElementById("termKeyCtrl")?.classList.toggle("latched", on);
    }
    function updateButtons() {
      if (disposed) return;
      const show = options2.supportsTerminal(sessionState.currentSession) && sessionState.currentSession?.isActive === true;
      for (const id of ["btnTerminal", "cpTerminalRow"]) {
        const value = document2.getElementById(id);
        if (value) value.style.display = show ? "" : "none";
      }
    }
    function updateMode() {
      if (disposed) return;
      const button = document2.getElementById("termModeBtn");
      if (button) {
        button.style.display = state && options2.supportsTmux(sessionState.currentSession) && sessionState.currentSession?.isActive === true ? "" : "none";
        button.textContent = state?.mode === "tmux" ? "\u21C6 shell" : "\u21C6 pi tmux";
        button.title = state?.mode === "tmux" ? "Switch to a plain shell at the session cwd" : "Attach to the tmux pane the session's pi runs in";
      }
      const prefix = document2.getElementById("termKeyPrefix");
      if (prefix) {
        const sequence = state?.mode === "tmux" ? tmuxPrefixSeq(state.tmuxPrefix) : null;
        prefix.style.display = sequence ? "" : "none";
        if (sequence) prefix.textContent = state?.tmuxPrefix || "";
      }
    }
    function fit() {
      if (state && owns(state)) try {
        state.fitAddon?.fit();
      } catch {
      }
    }
    function send(message3, owner = state) {
      if (!owner || !owns(owner)) return;
      const socket = owner.ws;
      if (socket && socket.readyState === 1) socket.send(JSON.stringify(message3));
    }
    async function open(mode) {
      if (disposed || state || !sessionState.currentSession || !options2.supportsTerminal(sessionState.currentSession)) return;
      cancelOpen?.();
      const own = ++generation;
      const session = sessionState.currentSession, owner = sessionState.captureSelection();
      if (!owner) return;
      const resolved = options2.host(owner.host);
      if (!resolved) return;
      const endpoint = Object.freeze({ ...resolved });
      let cancel;
      const cancelled = new Promise((resolve) => {
        cancel = resolve;
      });
      cancelOpen = cancel;
      const current = () => !disposed && own === generation && !state && sessionState.ownsSelection(owner) && sameHost(owner, endpoint);
      let fontTimer;
      try {
        try {
          await Promise.race([loadAssets(), cancelled]);
        } catch {
          return;
        }
        if (!current()) return;
        mode ||= storage.getItem(modeKey(owner.id, owner.host)) === "tmux" ? "tmux" : "shell";
        try {
          await Promise.race([document2.fonts.load('12px "Symbols Nerd Font Mono"'), cancelled, new Promise((resolve) => {
            fontTimer = setTimeout(resolve, 2e3);
          })]);
        } catch {
        } finally {
          clearTimeout(fontTimer);
        }
        if (!current()) return;
        const css = window.getComputedStyle(document2.documentElement);
        const term = options2.createTerminal({ fontFamily: css.getPropertyValue("--font-mono").trim() + ", 'Symbols Nerd Font Mono'", fontSize: window.innerWidth <= 768 ? 12 : 13, theme: options2.theme(), scrollback: 5e3, cursorBlink: true });
        if (!term) return;
        const fitAddon = options2.createFitAddon();
        if (fitAddon) term.loadAddon(fitAddon);
        const next = { term, fitAddon, sessionId: owner.id, owner, endpoint, mode, events: new AbortController(), ws: null, tmuxPrefix: null, reconnectTimer: void 0, attempts: 0, exited: false, connection: 0 };
        state = next;
        const panel = element("terminalPanel");
        options2.applySize(panel);
        panel.style.display = "";
        element("terminalCwd").textContent = shortCwd(typeof session.cwd === "string" ? session.cwd : "~");
        updateMode();
        term.open(element("terminalContainer"));
        fit();
        term.onData((data) => {
          if (!owns(next)) return;
          if (ctrlLatch && data.length === 1) {
            const code = data.toUpperCase().charCodeAt(0);
            if (code >= 64 && code <= 95) data = String.fromCharCode(code & 31);
            setCtrl(false);
          }
          send({ type: "input", data }, next);
        });
        term.onResize(({ cols, rows }) => send({ type: "resize", cols, rows }, next));
        window.addEventListener("resize", fit, { signal: next.events.signal });
        window.visualViewport?.addEventListener("resize", fit, { signal: next.events.signal });
        connect();
        term.focus();
      } finally {
        clearTimeout(fontTimer);
        if (cancelOpen === cancel) cancelOpen = null;
      }
    }
    function connect() {
      const current = state;
      if (!current || !owns(current)) return;
      clearTimeout(current.reconnectTimer);
      const sequence = ++current.connection;
      const query = current.mode === "tmux" ? "?mode=tmux" : "";
      const url = options2.socketUrl(current.endpoint, `/api/sessions/${encodeURIComponent(current.sessionId)}/terminal${query}`);
      const ready = () => owns(current) && sequence === current.connection;
      if (!current.endpoint.token) {
        openSocket(current, url, sequence);
        return;
      }
      status(current.attempts ? "reconnecting\u2026" : "connecting\u2026", "reconnecting");
      void options2.ticket(current.endpoint, "terminal").then((ticket) => {
        if (ready()) openSocket(current, `${url}${query ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`, sequence);
      }).catch(() => {
        if (ready()) status("connect failed", "error");
      });
    }
    function openSocket(current, url, sequence) {
      if (!owns(current) || sequence !== current.connection) return;
      const socket = options2.socket(url), previous = current.ws;
      current.ws = socket;
      try {
        previous?.close();
      } catch {
      }
      const active = () => owns(current) && current.ws === socket && current.connection === sequence;
      status(current.attempts ? "reconnecting\u2026" : "connecting\u2026", "reconnecting");
      socket.onmessage = (event) => {
        if (!active() || typeof event.data !== "string") return;
        let message3;
        try {
          const value = JSON.parse(event.data);
          message3 = decodeTerminalOutput(value);
        } catch {
          return;
        }
        if (!message3) return;
        if (message3.type === "attach") {
          current.attempts = 0;
          status();
          current.tmuxPrefix = message3.tmuxPrefix;
          updateMode();
          current.term.reset();
          if (message3.replay) current.term.write(message3.replay);
          if (message3.cwd) element("terminalCwd").textContent = shortCwd(message3.cwd);
          fit();
          send({ type: "resize", cols: current.term.cols, rows: current.term.rows }, current);
        } else if (message3.type === "output") current.term.write(message3.data);
        else if (message3.type === "exit") {
          current.exited = true;
          status(`shell exited (${message3.code})`);
        } else {
          current.exited = true;
          status(message3.error, "error");
        }
      };
      socket.onclose = () => {
        if (!active() || current.exited) return;
        const delay = Math.min(8e3, 1e3 * 2 ** current.attempts++);
        status("disconnected \u2014 reconnecting\u2026", "reconnecting");
        clearTimeout(current.reconnectTimer);
        current.reconnectTimer = setTimeout(() => {
          if (active()) connect();
        }, delay);
      };
    }
    function close() {
      if (disposed) return;
      generation++;
      cancelOpen?.();
      cancelOpen = null;
      const current = state;
      state = null;
      if (current) {
        clearTimeout(current.reconnectTimer);
        current.events.abort();
        try {
          current.ws?.close();
        } catch {
        }
        current.term.dispose();
      }
      setCtrl(false);
      status();
      element("terminalPanel").style.display = "none";
    }
    function switchMode() {
      const current = state;
      if (!current || !owns(current)) return;
      const mode = current.mode === "tmux" ? "shell" : "tmux";
      if (mode === "tmux" && !options2.supportsTmux(sessionState.currentSession)) return;
      if (mode === "tmux") storage.setItem(modeKey(current.sessionId, current.owner.host), mode);
      else storage.removeItem(modeKey(current.sessionId, current.owner.host));
      close();
      void open(mode);
    }
    function restart() {
      const current = state;
      if (!current || !owns(current)) return;
      if (!options2.confirm(current.mode === "tmux" ? "Reattach the tmux client? (The tmux session and everything in it keeps running.)" : "Restart shell? Anything running in it will be killed.") || !owns(current)) return;
      current.exited = false;
      if (current.ws?.readyState === 1) send({ type: "restart" }, current);
      else {
        clearTimeout(current.reconnectTimer);
        current.attempts = 0;
        connect();
      }
      current.term.focus();
    }
    function key(key2) {
      const current = state;
      if (!current || !owns(current)) return;
      if (key2 === "ctrl") {
        setCtrl(!ctrlLatch);
        return;
      }
      let sequence;
      if (key2 === "tmux-prefix") sequence = tmuxPrefixSeq(current.tmuxPrefix);
      else {
        const sequences = { esc: "\x1B", tab: "	", "ctrl-c": "" };
        sequence = sequences[key2];
        if (!sequence) {
          const direction = { up: "A", down: "B", right: "C", left: "D" };
          if (!direction[key2]) return;
          sequence = (current.term.modes.applicationCursorKeysMode ? "\x1BO" : "\x1B[") + direction[key2];
        }
      }
      if (sequence) send({ type: "input", data: sequence }, current);
      current.term.focus();
    }
    function mountKeybar() {
      if (disposed || keybarMounted) return;
      const bar = document2.getElementById("terminalKeybar");
      if (!bar) return;
      keybarMounted = true;
      bar.addEventListener("pointerdown", (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest("button[data-termkey]");
        if (!button) return;
        event.preventDefault();
        key(button.dataset.termkey || "");
      }, { signal: events.signal });
    }
    return {
      open,
      close,
      loadAssets,
      fit,
      send,
      connect,
      switchMode,
      restart,
      key,
      mountKeybar,
      modeKey,
      updateButtons,
      updateMode,
      toggle() {
        if (state || cancelOpen) close();
        else void open();
      },
      refreshTheme() {
        if (state && owns(state)) state.term.options.theme = options2.theme();
      },
      get state() {
        return state;
      },
      dispose() {
        close();
        events.abort();
        disposed = true;
      }
    };
  }

  // src/browser/routines-data.ts
  var text10 = (value) => typeof value === "string" ? value : "";
  var number4 = (value) => finite2(value) ? value : 0;
  function decodeRoutineInvocations(value) {
    if (!record8(value)) throw new Error("Invalid routine invocation response");
    return { invocations: Array.isArray(value.invocations) ? value.invocations.flatMap((row) => {
      if (!record8(row) || typeof row.id !== "string") return [];
      return [{
        id: row.id,
        version: finite2(row.version) ? row.version : null,
        trigger: text10(row.trigger),
        source: text10(row.source),
        delivery: text10(row.delivery),
        status: text10(row.status),
        startedAt: finite2(row.startedAt) ? row.startedAt : null,
        durationMs: finite2(row.durationMs) ? row.durationMs : null,
        sessionId: text10(row.sessionId),
        skipReason: text10(row.skipReason),
        error: text10(row.error),
        closeError: text10(row.closeError),
        summary: text10(row.summary)
      }];
    }) : [], nextBefore: finite2(value.nextBefore) ? value.nextBefore : null };
  }
  function decodeRoutine(value, host) {
    if (!record8(value)) throw new Error("Invalid routine response");
    const row = record8(value.routine) ? value.routine : value;
    if (typeof row.id !== "string" || !row.id) throw new Error("Invalid routine identity");
    const stats = record8(row.stats) ? row.stats : {};
    const versions = Array.isArray(row.versions) ? row.versions.flatMap((version) => record8(version) && finite2(version.version) && typeof version.prompt === "string" ? [{ version: version.version, savedAt: number4(version.savedAt), prompt: version.prompt }] : []) : [];
    return {
      id: row.id,
      name: text10(row.name),
      description: text10(row.description),
      harness: text10(row.harness) || "pi",
      cwd: text10(row.cwd),
      model: text10(row.model),
      thinking: text10(row.thinking),
      schedule: record8(row.schedule) && typeof row.schedule.cron === "string" ? { cron: row.schedule.cron } : null,
      enabled: row.enabled !== false,
      mode: row.mode === "continue" ? "continue" : "oneShot",
      onBusy: row.onBusy === "steer" || row.onBusy === "followUp" ? row.onBusy : "skip",
      minIntervalSec: number4(row.minIntervalSec),
      prompt: text10(row.prompt),
      promptVersion: number4(row.promptVersion) || 1,
      versions,
      stats: { invocations: number4(stats.invocations), nextRunAt: finite2(stats.nextRunAt) ? stats.nextRunAt : null, lastInvocation: decodeRoutineInvocations({ invocations: [stats.lastInvocation] }).invocations[0] || null },
      host: host.hostId,
      hostLabel: host.label || "",
      endpoint: Object.freeze({ base: host.base, token: host.token })
    };
  }
  function decodeRoutineList(value, host) {
    if (!record8(value) || !Array.isArray(value.routines)) throw new Error("Invalid routines response");
    return value.routines.flatMap((row) => {
      try {
        return [decodeRoutine(row, host)];
      } catch {
        return [];
      }
    });
  }

  // src/browser/routines-view.ts
  function createRoutinesView(options2) {
    const document2 = options2.root.ownerDocument, window = document2.defaultView, location = window.location;
    const localStorage = options2.storage, sessionState = options2.sessionState;
    const apiFetch = (host, path, init) => {
      if (host && typeof host === "object" && "hostId" in host && (typeof host.hostId === "string" || host.hostId === null)) {
        const current = options2.host(host.hostId);
        if (!current || current.base !== host.base) return Promise.reject(new Error("Routine host changed; select the routine again."));
        return options2.request({ ...host, token: current.token }, path, init);
      }
      return options2.request(host, path, init);
    };
    const isMultiHost = options2.multiHost, hostChipHtml = options2.hostChip;
    const copyTextToClipboard2 = options2.copy, setStatus = options2.status, confirm = options2.confirm;
    const createCwdAutocomplete2 = options2.autocomplete;
    const modelSelectOptionsHtml2 = (models) => modelSelectOptionsHtml(models, escapeHtml);
    const field = (id) => document2.getElementById(id);
    const errorMessage = (error) => error instanceof Error ? error.message : String(error);
    let disposed = false;
    let viewGeneration = 0, formGeneration = 0, harnessRequest = 0, modelRequest = 0;
    let listEvents = new AbortController(), formEvents = new AbortController(), versionEvents = new AbortController(), invocationEvents = new AbortController();
    let listQueue = null;
    let invocationToken = null, mutationToken = null;
    function sameHost(id, endpoint) {
      const current = options2.host(id);
      return !!current && current.hostId === id && current.base === endpoint.base;
    }
    function captureForm() {
      const current = options2.host(routineFormHostId());
      if (!current) return null;
      const id = current.hostId;
      return { view: viewGeneration, form: formGeneration, key: routineSelKey, creating: routineCreating, id, endpoint: Object.freeze({ ...current, ...routineSelected?.host === id ? routineSelected.endpoint : {} }) };
    }
    function ownsForm(owner) {
      return !!owner && isRoutinesViewOpen() && owner.view === viewGeneration && owner.form === formGeneration && owner.key === routineSelKey && owner.creating === routineCreating && owner.id === options2.host(routineFormHostId())?.hostId && sameHost(owner.id, owner.endpoint);
    }
    function retireForm() {
      formGeneration++;
      harnessRequest++;
      modelRequest++;
      formEvents.abort();
      versionEvents.abort();
      invocationEvents.abort();
      disposeRoutineCwdAutocomplete();
      invocationToken = null;
      mutationToken = null;
      routineBusy = false;
      clearTimeout(routineDeleteArmTimer);
      routineDeleteArmed = false;
    }
    async function httpError(response) {
      const data = await response.json().catch(() => null);
      return record8(data) && typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    }
    function payloadError(data, status) {
      return record8(data) && typeof data.error === "string" ? data.error : `HTTP ${status}`;
    }
    let routinesList = [];
    let routinesHostErrors = [];
    let routinesHostPending = [];
    let routinesSeq = 0;
    let routinesListError = "";
    let routineSelKey = null;
    let routineSelectedHostId = null;
    let routineSelected = null;
    let routineCreating = false;
    let routineFormBaseline = null;
    let routineFormError = "";
    let routineDeleteArmed = false;
    let routineBusy = false;
    let routineInvocations = [];
    let routineInvocationsNextBefore = null;
    let routineInvocationsTimer = null;
    let routineVersionFilter = null;
    let routineVersionShown = null;
    let routineNotice = "";
    const routineModelCatalogs = /* @__PURE__ */ new Map();
    const routineHarnessCatalogs = /* @__PURE__ */ new Map();
    let routineModelSeq = 0;
    let routineCwdAutocomplete = null;
    function disposeRoutineCwdAutocomplete() {
      routineCwdAutocomplete?.dispose();
      routineCwdAutocomplete = null;
    }
    let routineCreateHostId = null;
    const ROUTINE_CRON_PRESETS = [
      ["", "No schedule (manual only)"],
      ["0 * * * *", "Every hour"],
      ["0 9 * * *", "Daily at 09:00"],
      ["0 9 * * 1-5", "Weekdays at 09:00"],
      ["0 9 * * 1", "Weekly, Monday 09:00"]
    ];
    const ROUTINE_ON_BUSY = [
      ["skip", "Skip the run"],
      ["steer", "Steer the running turn"],
      ["followUp", "Queue as a follow-up"]
    ];
    const ROUTINE_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    function routineKey(host, id) {
      return sessionKey(host || null, id);
    }
    function routinesCapableHosts() {
      return options2.hosts().filter((host) => hostSupportsCapability(host, "routines", options2.config()));
    }
    function anyHostSupportsRoutines() {
      return options2.effectiveHosts().some((host) => hostSupportsCapability(host, "routines", options2.config()));
    }
    function updateRoutinesButton() {
      if (disposed) return;
      const btn = document2.getElementById("btnRoutines");
      if (!btn) return;
      const supported = anyHostSupportsRoutines();
      btn.style.display = supported ? "" : "none";
      if (!supported && isRoutinesViewOpen()) closeRoutinesView();
    }
    function isRoutinesViewOpen() {
      return !disposed && options2.root.classList.contains("routines-open");
    }
    function openRoutinesView() {
      if (disposed) return;
      options2.closeOtherViews();
      if (isRoutinesViewOpen()) return;
      viewGeneration++;
      options2.root.classList.add("routines-open");
      if (!routineSelected && !routineCreating) backToRoutinesList();
      const retained = readRoutineForm();
      if (retained) wireRoutineForm(retained, false);
      else renderRoutineDetail();
      loadRoutinesView();
      if (routineSelected) {
        renderRoutineInvocations();
        loadRoutineInvocations({ reset: true });
        startRoutineInvocationPoll();
      }
    }
    function closeRoutinesView() {
      if (disposed) return;
      viewGeneration++;
      routinesSeq++;
      listEvents.abort();
      listQueue?.dispose();
      listQueue = null;
      retireForm();
      options2.root.classList.remove("routines-open");
      stopRoutineInvocationPoll();
    }
    function refreshRoutinesView() {
      if (!isRoutinesViewOpen()) return;
      loadRoutinesView();
      if (routineSelected) loadRoutineInvocations({ reset: true });
    }
    function routinesViewEscape() {
      const view = document2.getElementById("routinesView");
      if (view && view.classList.contains("detail-open") && window.matchMedia("(max-width: 768px)").matches) {
        backToRoutinesList();
        return true;
      }
      closeRoutinesView();
      return true;
    }
    function backToRoutinesList() {
      if (!isRoutinesViewOpen()) return;
      routineCwdAutocomplete?.hide();
      document2.getElementById("routinesView")?.classList.remove("detail-open");
    }
    async function loadRoutinesView() {
      if (!isRoutinesViewOpen()) return;
      listQueue?.dispose();
      listQueue = null;
      const seq = ++routinesSeq;
      const stale = () => seq !== routinesSeq || !isRoutinesViewOpen();
      const listEl = document2.getElementById("routinesList");
      if (listEl && !listEl.childElementCount) listEl.innerHTML = '<div class="usage-state">Loading routines\u2026</div>';
      await options2.fleetReady();
      if (stale()) return;
      const hosts = routinesCapableHosts().map((host) => Object.freeze({ ...host }));
      if (!hosts.length) {
        routinesList = [];
        routinesListError = "No reachable host offers routines.";
        renderRoutinesList();
        return;
      }
      const status = hosts.map(() => "pending");
      const entries = new Array(hosts.length);
      const reasons = new Array(hosts.length);
      const render = () => {
        if (stale()) return;
        if (!status.some((s, i) => s === "ok" && entries[i])) return;
        routinesHostErrors = hosts.filter((_, i) => status[i] === "error").map(hostDisplayLabel);
        routinesHostPending = hosts.filter((_, i) => status[i] === "pending").map(hostDisplayLabel);
        routinesListError = "";
        routinesList = entries.flat().filter(Boolean);
        renderRoutinesList();
      };
      const queueRender = listQueue = createFanoutRenderQueue(status, render);
      await Promise.allSettled(hosts.map(async (host, i) => {
        try {
          const res = await apiFetch(host, "/api/routines", { timeoutMs: 2e4 });
          if (res.status === 401) {
            if (sameHost(host.hostId, host)) options2.connection(host, "blocked");
            throw new Error("needs a token");
          }
          if (!res.ok) throw new Error(await httpError(res));
          const data = await res.json();
          if (!sameHost(host.hostId, host)) throw new Error("host connection changed");
          entries[i] = decodeRoutineList(data, { ...host, label: hostDisplayLabel(host) });
          status[i] = "ok";
          options2.connection(host, "success");
        } catch (e) {
          status[i] = "error";
          reasons[i] = e;
          if (!host.self && sameHost(host.hostId, host)) options2.connection(host, "failure", e);
        }
        queueRender();
      }));
      if (stale()) return;
      if (!status.some((s) => s === "ok")) {
        routinesList = [];
        routinesListError = errorMessage(reasons.find(Boolean) || new Error("no hosts answered"));
        renderRoutinesList();
      }
    }
    function routineStatusClass(status) {
      if (status === "starting" || status === "running") return "working";
      if (status === "completed") return "ok";
      if (status === "errored" || status === "interrupted") return "bad";
      return "muted";
    }
    function formatRoutineCountdown(ts) {
      if (!ts) return "";
      const diff = new Date(ts).getTime() - Date.now();
      if (!Number.isFinite(diff)) return "";
      if (diff <= 0) return "due now";
      const m = Math.round(diff / 6e4);
      if (m < 60) return `in ${Math.max(1, m)}m`;
      const h = Math.round(m / 60);
      if (h < 48) return `in ${h}h`;
      return `in ${Math.round(h / 24)}d`;
    }
    function routineScheduleLine(routine) {
      const cron = routine.schedule?.cron;
      if (!cron) return '<span class="rt-sched muted">manual only</span>';
      if (routine.enabled === false) {
        return `<span class="rt-sched paused"><code>${escapeHtml(cron)}</code> \xB7 paused</span>`;
      }
      const next = formatRoutineCountdown(routine.stats?.nextRunAt);
      return `<span class="rt-sched"><code>${escapeHtml(cron)}</code>${next ? ` \xB7 ${escapeHtml(next)}` : ""}</span>`;
    }
    function renderRoutinesList() {
      if (!isRoutinesViewOpen()) return;
      listEvents.abort();
      listEvents = new AbortController();
      const view = viewGeneration;
      const el = document2.getElementById("routinesList");
      if (!el) return;
      const notices = [
        routinesHostErrors.length ? `<div class="usage-notice">Not listed: ${escapeHtml(routinesHostErrors.join(", "))} did not answer.</div>` : "",
        routinesHostPending.length ? `<div class="usage-notice">Still loading ${escapeHtml(routinesHostPending.join(", "))}\u2026</div>` : ""
      ].join("");
      const sorted = routinesList.slice().sort((a, b) => (b.stats?.lastInvocation?.startedAt || 0) - (a.stats?.lastInvocation?.startedAt || 0) || String(a.name || "").localeCompare(String(b.name || "")));
      const rows = sorted.map((r) => {
        const key = routineKey(r.host, r.id);
        const last = r.stats?.lastInvocation || null;
        const dot = `<span class="rt-dot ${last ? routineStatusClass(last.status) : "none"}" title="${escapeHtml(last ? last.status : "never run")}"></span>`;
        const lastLine = last ? `${dot}${escapeHtml(last.status)} \xB7 ${escapeHtml(formatRelativeTime(last.startedAt))}` : `${dot}never run`;
        const count2 = r.stats?.invocations || 0;
        return `<div class="rt-row${routineSelKey === key ? " selected" : ""}" data-routine="${escapeHtml(r.id)}" data-host="${escapeHtml(r.host || "")}">
        <div class="rt-row-top">
          <span class="rt-name">${escapeHtml(r.name || r.id)}</span>
          ${hostChipHtml(r.host)}
        </div>
        <div class="rt-row-sched">${routineScheduleLine(r)}</div>
        <div class="rt-row-meta">${escapeHtml(r.mode === "continue" ? "continue" : "one-shot")} \xB7 on busy ${escapeHtml(r.onBusy || "skip")}</div>
        <div class="rt-row-last">${lastLine}<span class="rt-count">${count2} run${count2 === 1 ? "" : "s"}</span></div>
      </div>`;
      }).join("");
      el.innerHTML = `
      <div class="rt-list-head">
        <button class="btn-small" id="rtNewBtn" data-rt-action="new">+ New routine</button>
      </div>
      ${notices}
      ${routinesListError ? `<div class="usage-state">${escapeHtml(routinesListError)}</div>` : ""}
      ${rows || (routinesListError ? "" : '<div class="usage-state">No routines yet.</div>')}`;
      el.querySelector('[data-rt-action="new"]')?.addEventListener("click", () => {
        if (isRoutinesViewOpen() && view === viewGeneration) startRoutineCreate();
      }, { signal: listEvents.signal });
      el.querySelectorAll(".rt-row").forEach((row) => {
        const id = row.dataset.routine || "", host = row.dataset.host || null;
        const resolved = options2.host(host), endpoint = resolved ? Object.freeze({ ...resolved }) : null;
        row.addEventListener("click", () => {
          if (isRoutinesViewOpen() && view === viewGeneration && endpoint && !!options2.host(host)) void selectRoutine(host, id);
        }, { signal: listEvents.signal });
      });
    }
    function routineFormDirty() {
      if (!routineFormBaseline) return false;
      const now = readRoutineForm();
      return now && JSON.stringify(now) !== routineFormBaseline;
    }
    function confirmLeaveRoutineForm() {
      if (!routineFormDirty()) return true;
      return confirm("This routine has unsaved changes. Discard them?");
    }
    async function selectRoutine(host, id) {
      if (!isRoutinesViewOpen()) return;
      const resolved = options2.host(host);
      if (!resolved) return;
      host = resolved.hostId;
      const key = routineKey(host, id);
      if (routineSelKey === key && routineSelected && sameHost(host, routineSelected.endpoint)) {
        document2.getElementById("routinesView")?.classList.add("detail-open");
        return;
      }
      if (!confirmLeaveRoutineForm()) return;
      retireForm();
      routineSelKey = key;
      routineSelectedHostId = host;
      routineCreating = false;
      routineSelected = null;
      routineFormBaseline = null;
      routineFormError = "";
      routineNotice = "";
      routineDeleteArmed = false;
      routineVersionFilter = null;
      routineVersionShown = null;
      routineInvocations = [];
      routineInvocationsNextBefore = null;
      stopRoutineInvocationPoll();
      renderRoutinesList();
      document2.getElementById("routinesView")?.classList.add("detail-open");
      const owner = captureForm();
      if (!ownsForm(owner)) return;
      const detail = document2.getElementById("routinesDetail");
      if (detail) detail.innerHTML = '<div class="usage-state">Loading routine\u2026</div>';
      try {
        const res = await apiFetch(owner.endpoint, `/api/routines/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(await httpError(res));
        const data = await res.json();
        if (!ownsForm(owner)) return;
        routineSelected = decodeRoutine(data, owner.endpoint);
        renderRoutineDetail();
        loadRoutineInvocations({ reset: true });
        startRoutineInvocationPoll();
      } catch (e) {
        if (!ownsForm(owner)) return;
        if (detail) detail.innerHTML = `<div class="usage-state">Could not load routine: ${escapeHtml(errorMessage(e))}</div>`;
      }
    }
    function startRoutineCreate() {
      if (!isRoutinesViewOpen()) return;
      if (!confirmLeaveRoutineForm()) return;
      const hosts = routinesCapableHosts();
      const host = hosts.find((h) => h.self) || hosts[0];
      if (!host) return;
      retireForm();
      routineSelKey = null;
      routineSelected = null;
      routineCreating = true;
      routineFormError = "";
      routineNotice = "";
      routineDeleteArmed = false;
      routineVersionFilter = null;
      routineVersionShown = null;
      routineInvocations = [];
      routineInvocationsNextBefore = null;
      stopRoutineInvocationPoll();
      routineCreateHostId = host ? host.hostId || null : null;
      renderRoutinesList();
      document2.getElementById("routinesView")?.classList.add("detail-open");
      renderRoutineDetail();
    }
    function routineFormHostId() {
      return routineCreating ? routineCreateHostId : routineSelected?.host ?? routineSelectedHostId;
    }
    function routineKnownCwds() {
      const hostId = routineFormHostId();
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      for (const s of [...sessionState.sessions.active, ...sessionState.sessions.previous]) {
        if (isMultiHost() && (s.host || null) !== hostId) continue;
        if (typeof s.cwd !== "string" || !s.cwd || seen.has(s.cwd)) continue;
        seen.add(s.cwd);
        out.push({ path: s.cwd, short: shortCwd(s.cwd) });
      }
      return out;
    }
    async function loadRoutineHarnesses(hostId) {
      const resolved = options2.host(hostId);
      if (!resolved) return [];
      const endpoint = Object.freeze({ ...resolved });
      const key = JSON.stringify([hostId, endpoint.base, endpoint.token || ""]);
      if (routineHarnessCatalogs.has(key)) return routineHarnessCatalogs.get(key);
      let list = [{ id: "pi", label: "Pi", available: true }];
      try {
        const res = await apiFetch(endpoint, "/api/harnesses");
        if (res.ok) {
          const data = await res.json();
          if (record8(data) && Array.isArray(data.harnesses) && data.harnesses.length) list = data.harnesses.flatMap((row) => record8(row) && typeof row.id === "string" ? [{ id: row.id, label: typeof row.label === "string" ? row.label : row.id, available: row.available !== false }] : []);
        }
      } catch {
      }
      if (!disposed && sameHost(hostId, endpoint)) routineHarnessCatalogs.set(key, list);
      return list;
    }
    async function loadRoutineModels(hostId, harnessId, cwd) {
      const resolved = options2.host(hostId);
      if (!resolved) return [];
      const endpoint = Object.freeze({ ...resolved });
      const key = JSON.stringify([hostId, endpoint.base, endpoint.token || "", harnessId, cwd]);
      if (routineModelCatalogs.has(key)) return routineModelCatalogs.get(key);
      const seq = ++routineModelSeq;
      let models = [];
      try {
        const url = harnessId !== "pi" ? modelCatalogUrl(harnessId, cwd) : "/api/models";
        const res = await apiFetch(endpoint, url);
        if (res.ok) {
          const data = await res.json();
          models = decodeModelCatalog(data);
        }
      } catch {
      }
      if (disposed || seq !== routineModelSeq || !sameHost(hostId, endpoint)) return models;
      routineModelCatalogs.set(key, models);
      return models;
    }
    function readRoutineForm() {
      const detail = document2.getElementById("routinesDetail");
      if (!detail || !detail.querySelector("#rtName")) return null;
      const val = (id) => (field(id)?.value ?? "").trim();
      const minInterval = parseInt(field("rtMinInterval")?.value || "", 10);
      return {
        name: val("rtName"),
        description: val("rtDescription"),
        harness: val("rtHarness") || "pi",
        cwd: val("rtCwd"),
        model: val("rtModel"),
        thinking: val("rtThinking"),
        cron: val("rtCron"),
        enabled: !!field("rtEnabled")?.checked,
        mode: detail.querySelector('input[name="rtMode"]:checked')?.value === "continue" ? "continue" : "oneShot",
        onBusy: val("rtOnBusy") === "steer" ? "steer" : val("rtOnBusy") === "followUp" ? "followUp" : "skip",
        minIntervalSec: Number.isFinite(minInterval) && minInterval > 0 ? minInterval : 0,
        prompt: field("rtPrompt")?.value ?? ""
      };
    }
    function routineFormDefaults() {
      if (routineSelected) {
        return {
          name: routineSelected.name || "",
          description: routineSelected.description || "",
          harness: routineSelected.harness || "pi",
          cwd: routineSelected.cwd || "",
          model: routineSelected.model || "",
          thinking: routineSelected.thinking || "",
          cron: routineSelected.schedule?.cron || "",
          enabled: routineSelected.enabled !== false,
          mode: routineSelected.mode === "continue" ? "continue" : "oneShot",
          onBusy: routineSelected.onBusy || "skip",
          minIntervalSec: routineSelected.minIntervalSec || 0,
          prompt: routineSelected.prompt || ""
        };
      }
      return {
        name: "",
        description: "",
        harness: "pi",
        cwd: localStorage.getItem("pi-dish-cwd") || "",
        model: "",
        thinking: "",
        cron: "",
        enabled: true,
        mode: "oneShot",
        onBusy: "skip",
        minIntervalSec: 0,
        prompt: ""
      };
    }
    function renderRoutineDetail(values, baseline) {
      if (!isRoutinesViewOpen()) return;
      retireForm();
      const el = document2.getElementById("routinesDetail");
      if (!el) return;
      if (!routineSelected && !routineCreating) {
        el.innerHTML = '<div class="usage-state">Select a routine, or create one.</div>';
        return;
      }
      const v = values || routineFormDefaults();
      const hosts = routinesCapableHosts();
      const hostRow = routineCreating && hosts.length > 1 ? `<label class="rt-field">
           <span class="ns-label">Host</span>
           <select class="ns-select" id="rtHost">${hosts.map((h) => `<option value="${escapeHtml(h.hostId || "")}"${(h.hostId || null) === routineCreateHostId ? " selected" : ""}>${escapeHtml(hostDisplayLabel(h))}</option>`).join("")}</select>
         </label>` : "";
      const presets = ROUTINE_CRON_PRESETS.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === v.cron ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
      const onBusy = ROUTINE_ON_BUSY.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === v.onBusy ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
      const thinking = ['<option value="">(default)</option>'].concat(ROUTINE_THINKING_LEVELS.map((level) => `<option value="${level}"${level === v.thinking ? " selected" : ""}>${escapeHtml(NS_THINKING_LABELS[level] || level)}</option>`)).join("");
      el.innerHTML = `
      <div class="rt-detail-head">
        <button class="rt-back" data-rt-action="back">\u2039 Routines</button>
        <h2 class="rt-detail-title">${escapeHtml(routineCreating ? "New routine" : routineSelected?.name || routineSelected?.id || "")}</h2>
        ${routineCreating ? "" : hostChipHtml(routineSelected?.host || null)}
        ${routineCreating ? "" : `<span class="rt-version-badge">v${routineSelected?.promptVersion || 1}</span>`}
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
            <select class="ns-select" id="rtModel"><option value="">(default)</option>${v.model ? `<option value="${escapeHtml(v.model)}" selected>${escapeHtml(v.model)}</option>` : ""}</select>
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
            <select class="ns-select" id="rtCronPreset">${presets}<option value="__custom" ${ROUTINE_CRON_PRESETS.some(([p]) => p === v.cron) ? "" : "selected"}>Custom\u2026</option></select>
          </label>
        </div>
        <label class="rt-check">
          <input type="checkbox" id="rtEnabled"${v.enabled ? " checked" : ""}>
          <span>Schedule armed <small>\u2014 unchecking pauses the cadence; Run now and the invoke route keep working</small></span>
        </label>

        <div class="rt-field">
          <span class="ns-label">Mode</span>
          <label class="rt-radio"><input type="radio" name="rtMode" value="oneShot"${v.mode === "oneShot" ? " checked" : ""}>
            <span>One-shot <small>\u2014 every run spawns a fresh session and closes it when the turn ends</small></span></label>
          <label class="rt-radio"><input type="radio" name="rtMode" value="continue"${v.mode === "continue" ? " checked" : ""}>
            <span>Continue <small>\u2014 reuse this routine's last session (resuming it if needed); never auto-closed</small></span></label>
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
          ${routineCreating ? "" : `<button class="btn-small btn-danger" id="rtDeleteBtn" data-rt-action="delete">${routineDeleteArmed ? "Delete?" : "Delete"}</button>`}
          ${routineCreating ? "" : '<button class="btn" id="rtRunBtn" data-rt-action="run">Run now</button>'}
          <button class="btn btn-primary" id="rtSaveBtn" data-rt-action="save">${routineCreating ? "Create routine" : "Save"}</button>
        </div>
      </div>

      ${routineCreating ? "" : renderRoutineInvokeBox()}
      ${routineCreating ? "" : renderRoutineVersions()}
      ${routineCreating ? "" : '<div class="rt-invocations" id="rtInvocations"></div>'}`;
      if (baseline !== void 0) routineFormBaseline = baseline;
      wireRoutineForm(v, baseline === void 0);
      if (!routineCreating) renderRoutineInvocations();
    }
    function wireRoutineForm(values, baseline = true) {
      if (!isRoutinesViewOpen()) return;
      formEvents.abort();
      formEvents = new AbortController();
      disposeRoutineCwdAutocomplete();
      const owner = captureForm(), listener = { signal: formEvents.signal };
      const el = document2.getElementById("routinesDetail");
      if (!el) return;
      const view = viewGeneration, form = formGeneration;
      el.querySelector('[data-rt-action="back"]')?.addEventListener("click", () => {
        if (isRoutinesViewOpen() && view === viewGeneration && form === formGeneration) backToRoutinesList();
      }, listener);
      if (!ownsForm(owner)) {
        const error = field("rtError");
        if (error) error.textContent = "Routine host changed or was removed. Return to Routines and select it again.";
        for (const button of el.querySelectorAll('[data-rt-action]:not([data-rt-action="back"])')) button.disabled = true;
        return;
      }
      const hostSel = el.querySelector("#rtHost");
      if (hostSel) hostSel.addEventListener("change", () => {
        if (!ownsForm(owner)) return;
        routineCwdAutocomplete?.hide();
        routineCreateHostId = hostSel.value || null;
        const harness = el.querySelector("#rtHarness")?.value || values.harness;
        const current = readRoutineForm();
        retireForm();
        if (current) wireRoutineForm({ ...current, harness }, false);
      }, listener);
      const harnessSel = el.querySelector("#rtHarness");
      if (harnessSel) harnessSel.addEventListener("change", () => {
        if (ownsForm(owner)) {
          harnessRequest++;
          void refreshRoutineModelOptions("");
        }
      }, listener);
      field("rtModel")?.addEventListener("change", () => {
        if (ownsForm(owner)) modelRequest++;
      }, listener);
      const cwdInput = el.querySelector("#rtCwd");
      cwdInput?.addEventListener("input", () => {
        if (ownsForm(owner)) modelRequest++;
      }, listener);
      const cwdDropdown = el.querySelector("#rtCwdDropdown");
      if (cwdInput && cwdDropdown) {
        routineCwdAutocomplete = createCwdAutocomplete2({
          input: cwdInput,
          dropdown: cwdDropdown,
          hostId: () => routineFormHostId(),
          known: () => routineKnownCwds(),
          onPick: () => {
            if (ownsForm(owner)) void refreshRoutineModelOptions();
          },
          onBlur: () => {
            if (ownsForm(owner)) void refreshRoutineModelOptions();
          }
        });
      }
      const preset = el.querySelector("#rtCronPreset");
      const cron = el.querySelector("#rtCron");
      if (preset && cron) {
        preset.addEventListener("change", () => {
          if (!ownsForm(owner) || preset.value === "__custom") return;
          cron.value = preset.value;
        }, listener);
        cron.addEventListener("input", () => {
          if (!ownsForm(owner)) return;
          const match = ROUTINE_CRON_PRESETS.some(([p]) => p === cron.value.trim());
          preset.value = match ? cron.value.trim() : "__custom";
        }, listener);
      }
      if (baseline) routineFormBaseline = JSON.stringify(values);
      const actions = { back: backToRoutinesList, save: saveRoutine, run: runRoutineNow, delete: deleteRoutine, copy: copyRoutineCurl };
      for (const button of el.querySelectorAll('[data-rt-action]:not([data-rt-action="back"])')) {
        const action = actions[button.dataset.rtAction || ""];
        if (action) button.addEventListener("click", () => {
          if (ownsForm(owner)) action();
        }, listener);
      }
      for (const [id, label] of [["rtSaveBtn", routineCreating ? "Create routine" : "Save"], ["rtRunBtn", "Run now"], ["rtDeleteBtn", "Delete"]]) {
        const button = field(id);
        if (button) {
          button.disabled = false;
          button.textContent = label;
        }
      }
      mountVersions();
      refreshRoutineHarnessOptions(values.harness).then((ready) => {
        if (ready && ownsForm(owner)) return refreshRoutineModelOptions(values.model);
      });
    }
    async function refreshRoutineHarnessOptions(preferred) {
      const sel = field("rtHarness");
      if (!sel) return false;
      const owner = captureForm(), request = ++harnessRequest;
      const hostId = routineFormHostId();
      const list = await loadRoutineHarnesses(hostId);
      if (!ownsForm(owner) || request !== harnessRequest || field("rtHarness") !== sel) return false;
      const available = list.filter((h) => h && h.available !== false);
      const want = preferred || sel.value || "pi";
      sel.innerHTML = available.map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.label || h.id)}</option>`).join("") || `<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`;
      if (!available.some((h) => h.id === want)) {
        sel.insertAdjacentHTML("afterbegin", `<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`);
      }
      sel.value = want;
      return true;
    }
    async function refreshRoutineModelOptions(preferred) {
      const sel = field("rtModel");
      if (!sel) return;
      const owner = captureForm(), request = ++modelRequest;
      const want = preferred !== void 0 ? preferred : sel.value;
      const hostId = routineFormHostId();
      const harnessId = field("rtHarness")?.value || "pi";
      const cwd = (field("rtCwd")?.value || "").trim();
      const models = await loadRoutineModels(hostId, harnessId, cwd);
      if (!ownsForm(owner) || request !== modelRequest || field("rtModel") !== sel || (field("rtHarness")?.value || "pi") !== harnessId || (field("rtCwd")?.value || "").trim() !== cwd) return;
      const { html, enabled, hidden } = modelSelectOptionsHtml2(models);
      sel.innerHTML = html;
      if (want && !enabled.some((m) => (m.selector || `${m.provider}/${m.id}`) === want)) {
        sel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`);
      }
      sel.value = want || "";
      const note = document2.getElementById("rtModelNote");
      if (note) note.textContent = modelHiddenNote(hidden);
    }
    function routineInvokeUrl(routine) {
      const base = routine.endpoint.base || "";
      const path = `/api/routines/${encodeURIComponent(routine.id)}/invoke`;
      try {
        return new URL(base + path, location.origin).href;
      } catch {
        return base + path;
      }
    }
    function routineInvokeCurl(routine) {
      const authed = !!routine.endpoint.token;
      return [
        `curl -X POST '${routineInvokeUrl(routine)}' \\`,
        "  -H 'Content-Type: application/json' \\",
        ...authed ? ['  -H "Authorization: Bearer $PI_DISH_TOKEN" \\'] : [],
        `  -d '{"source":"my-script","input":{"note":"anything JSON"}}'`
      ].join("\n");
    }
    function renderRoutineInvokeBox() {
      if (!routineSelected) return "";
      const curl = routineInvokeCurl(routineSelected);
      return `<details class="rt-box" open>
      <summary>Invoke from a script</summary>
      <pre class="rt-curl" id="rtCurl">${escapeHtml(curl)}</pre>
      <div class="rt-box-actions">
        <button class="btn-small" data-rt-action="copy">Copy</button>
        <span class="ns-hidden-note">The optional <code>input</code> JSON is appended to the prompt as an <code>&lt;invocation-input&gt;</code> block. Add <code>?wait=1</code> to block until the run leaves <code>starting</code>.</span>
      </div>
    </details>`;
    }
    function copyRoutineCurl() {
      if (!isRoutinesViewOpen() || !routineSelected) return;
      copyTextToClipboard2(routineInvokeCurl(routineSelected));
      setStatus("Invoke command copied");
    }
    function renderRoutineVersions() {
      const versions = Array.isArray(routineSelected?.versions) ? routineSelected.versions.slice().reverse() : [];
      if (!versions.length) return "";
      const rows = versions.map((entry) => {
        const active = routineVersionFilter === entry.version;
        const shown = routineVersionShown === entry.version;
        return `<div class="rt-version${active ? " filtered" : ""}">
        <div class="rt-version-row" data-version="${entry.version}">
          <span class="rt-version-num">v${entry.version}</span>
          <span class="rt-version-when" title="${escapeHtml(new Date(entry.savedAt).toLocaleString())}">${escapeHtml(formatRelativeTime(entry.savedAt))}</span>
          ${entry.version === (routineSelected?.promptVersion || 1) ? '<span class="rt-version-current">current</span>' : ""}
          <span class="rt-version-hint">${active ? "filtering runs" : "click to filter runs"}</span>
          <button class="btn-small rt-version-view" data-view="${entry.version}">${shown ? "hide" : "view"}</button>
          <button class="btn-small rt-version-restore" data-restore="${entry.version}">restore</button>
        </div>
        ${shown ? `<pre class="rt-version-text">${escapeHtml(entry.prompt || "")}</pre>` : ""}
      </div>`;
      }).join("");
      return `<details class="rt-box" id="rtVersions"${routineVersionFilter || routineVersionShown ? " open" : ""}>
      <summary>Prompt versions (${versions.length})</summary>
      ${rows}
      <div class="ns-hidden-note">Restoring only writes the text back into the editor \u2014 saving it then creates a <em>new</em> version.</div>
    </details>`;
    }
    function mountVersions() {
      versionEvents.abort();
      versionEvents = new AbortController();
      const root = document2.getElementById("rtVersions"), owner = captureForm();
      if (!root) return;
      root.addEventListener("click", (e) => {
        if (!ownsForm(owner) || document2.getElementById("rtVersions") !== root || !(e.target instanceof Element)) return;
        const view = e.target.closest(".rt-version-view");
        if (view) {
          const version = Number(view.dataset.view);
          routineVersionShown = routineVersionShown === version ? null : version;
          rerenderRoutineVersions();
          return;
        }
        const restore = e.target.closest(".rt-version-restore");
        if (restore) {
          const version = Number(restore.dataset.restore);
          const entry = (routineSelected?.versions || []).find((v) => v.version === version);
          const textarea = field("rtPrompt");
          if (entry && textarea) {
            textarea.value = entry.prompt || "";
            routineNotice = `Restored v${version} into the editor \u2014 save to make it the new version.`;
            const notice = document2.getElementById("rtNotice");
            if (notice) notice.textContent = routineNotice;
          }
          return;
        }
        const row = e.target.closest(".rt-version-row");
        if (row && document2.getElementById("rtVersions")?.contains(row)) {
          const version = Number(row.dataset.version);
          routineVersionFilter = routineVersionFilter === version ? null : version;
          rerenderRoutineVersions();
          renderRoutineInvocations();
        }
      }, { signal: versionEvents.signal });
    }
    function rerenderRoutineVersions() {
      const existing = document2.getElementById("rtVersions");
      if (!existing) return;
      existing.outerHTML = renderRoutineVersions();
      mountVersions();
    }
    function stopRoutineInvocationPoll() {
      if (routineInvocationsTimer !== null) clearInterval(routineInvocationsTimer);
      routineInvocationsTimer = null;
    }
    function startRoutineInvocationPoll() {
      if (!isRoutinesViewOpen()) return;
      stopRoutineInvocationPoll();
      routineInvocationsTimer = setInterval(() => {
        if (!isRoutinesViewOpen() || !routineSelected || !options2.host(routineSelected.host)) {
          stopRoutineInvocationPoll();
          return;
        }
        loadRoutineInvocations({ reset: true, quiet: true });
      }, 1e4);
    }
    async function loadRoutineInvocations({ reset = false, quiet = false } = {}) {
      if (!isRoutinesViewOpen() || !routineSelected || invocationToken) return;
      const owner = captureForm();
      if (!ownsForm(owner)) return;
      const token = invocationToken = /* @__PURE__ */ Symbol();
      const selected = routineSelected;
      const key = routineSelKey;
      const before = reset ? null : routineInvocationsNextBefore;
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (before) params.set("before", String(before));
        const res = await apiFetch(
          owner.endpoint,
          `/api/routines/${encodeURIComponent(selected.id)}/invocations?${params}`,
          { timeoutMs: 2e4 }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!ownsForm(owner) || invocationToken !== token) return;
        const decoded = decodeRoutineInvocations(data), list = decoded.invocations;
        routineInvocations = reset ? list : routineInvocations.concat(list);
        routineInvocationsNextBefore = decoded.nextBefore;
        renderRoutineInvocations();
        if (reset) {
          const row = routinesList.find((r) => routineKey(r.host, r.id) === key);
          if (row && row.stats) {
            row.stats.lastInvocation = list[0] || null;
            renderRoutinesList();
          }
        }
      } catch (e) {
        if (!quiet && ownsForm(owner) && invocationToken === token) {
          const el = document2.getElementById("rtInvocations");
          if (el) el.innerHTML = `<div class="usage-state">Could not load runs: ${escapeHtml(errorMessage(e))}</div>`;
        }
      } finally {
        if (invocationToken === token) invocationToken = null;
      }
    }
    function routineInvocationDetail(inv) {
      const parts = [];
      if (inv.skipReason) parts.push(`skipped: ${inv.skipReason}`);
      if (inv.error) parts.push(inv.error);
      if (inv.closeError) parts.push(`close: ${inv.closeError}`);
      if (!parts.length && inv.summary) parts.push(inv.summary);
      return parts.join(" \xB7 ");
    }
    function routineSessionLabel(sessionId) {
      const known = sessionState.findSession(sessionId, routineSelected?.host || null);
      if (known && known.name) return truncate(typeof known.name === "string" ? known.name : "", 28, "\u2026");
      return /^\d{4}-\d\d-\d\d/.test(sessionId) ? sessionId.slice(-8) : sessionId.slice(0, 8);
    }
    function renderRoutineInvocations() {
      if (!isRoutinesViewOpen()) return;
      invocationEvents.abort();
      invocationEvents = new AbortController();
      const owner = captureForm();
      const el = document2.getElementById("rtInvocations");
      if (!el) return;
      const filtered = routineVersionFilter ? routineInvocations.filter((inv) => inv.version === routineVersionFilter) : routineInvocations;
      const rows = filtered.map((inv) => {
        const trigger = inv.trigger + (inv.source ? ` (${inv.source})` : "");
        const started = inv.startedAt ? `<span title="${escapeHtml(new Date(inv.startedAt).toLocaleString())}">${escapeHtml(formatRelativeTime(inv.startedAt))}</span>` : "\u2014";
        const duration = Number.isFinite(inv.durationMs) ? formatDuration(inv.durationMs || 0) : "\u2014";
        const session = inv.sessionId ? `<a class="rt-session-link" data-session="${escapeHtml(inv.sessionId)}" data-host="${escapeHtml(routineSelected?.host || "")}" title="${escapeHtml(inv.sessionId)}">${escapeHtml(routineSessionLabel(inv.sessionId))}</a>` : "\u2014";
        const detail = routineInvocationDetail(inv);
        return `<tr data-invocation="${escapeHtml(inv.id)}">
        <td class="rt-num">v${escapeHtml(String(inv.version ?? ""))}</td>
        <td>${escapeHtml(trigger)}</td>
        <td>${escapeHtml(inv.delivery || "")}</td>
        <td><span class="rt-dot ${routineStatusClass(inv.status)}"></span>${escapeHtml(inv.status || "")}</td>
        <td>${started}</td>
        <td class="rt-num">${escapeHtml(duration)}</td>
        <td>${session}</td>
        <td class="rt-detail-cell" title="${escapeHtml(detail)}">${escapeHtml(detail)}</td>
      </tr>`;
      }).join("");
      el.innerHTML = `
      <div class="rt-invocations-head">
        <h3>Runs${routineVersionFilter ? ` <span class="rt-filter-chip">v${routineVersionFilter} only <button class="rt-filter-clear" data-rt-action="clear">\u2715</button></span>` : ""}</h3>
      </div>
      ${filtered.length ? `<div class="rt-table-wrap"><table class="rt-table">
        <thead><tr><th>Ver</th><th>Trigger</th><th>Delivery</th><th>Status</th><th>Started</th><th>Duration</th><th>Session</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<div class="usage-state">No runs yet.</div>'}
      ${routineInvocationsNextBefore ? '<button class="btn-small rt-load-more" data-rt-action="more">Load more</button>' : ""}`;
      const listener = { signal: invocationEvents.signal };
      el.querySelector('[data-rt-action="clear"]')?.addEventListener("click", () => {
        if (ownsForm(owner)) clearRoutineVersionFilter();
      }, listener);
      el.querySelector('[data-rt-action="more"]')?.addEventListener("click", () => {
        if (ownsForm(owner)) loadMoreRoutineInvocations();
      }, listener);
      el.querySelectorAll(".rt-session-link").forEach((link) => {
        const id = link.dataset.session || "", host = link.dataset.host || null;
        link.addEventListener("click", () => {
          if (ownsForm(owner)) void openRoutineSession(id, host);
        }, listener);
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
    async function openRoutineSession(sessionId, host) {
      if (!isRoutinesViewOpen() || !sessionId) return;
      const resolved = options2.host(host);
      if (!resolved) return;
      const selection = sessionState.captureSelection(), endpoint = Object.freeze({ ...resolved });
      closeRoutinesView();
      const view = viewGeneration;
      if (!sessionState.findSession(sessionId, host)) await options2.loadPrevious();
      if (disposed || view !== viewGeneration || isRoutinesViewOpen() || !sameHost(host, endpoint) || (selection ? !sessionState.ownsSelection(selection) : sessionState.currentSession !== null)) return;
      await options2.selectSession(sessionId, { host });
    }
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
        minIntervalSec: values.minIntervalSec
      };
    }
    function setRoutineFormError(message3) {
      if (!isRoutinesViewOpen()) return;
      routineFormError = message3 || "";
      const el = document2.getElementById("rtError");
      if (el) el.textContent = routineFormError;
    }
    function setRoutineNotice(message3) {
      if (!isRoutinesViewOpen()) return;
      routineNotice = message3 || "";
      const el = document2.getElementById("rtNotice");
      if (el) el.textContent = routineNotice;
    }
    async function saveRoutine() {
      if (!isRoutinesViewOpen() || routineBusy) return;
      const values = readRoutineForm();
      if (!values) return;
      const btn = field("rtSaveBtn");
      const creating = routineCreating;
      const hostId = routineFormHostId(), owner = captureForm(), selected = routineSelected;
      if (!routineCreating && !selected) return;
      if (!ownsForm(owner)) return;
      const token = mutationToken = /* @__PURE__ */ Symbol();
      setRoutineFormError("");
      setRoutineNotice("");
      routineBusy = true;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Saving\u2026";
      }
      try {
        const path = creating ? "/api/routines" : `/api/routines/${encodeURIComponent(selected.id)}`;
        const res = await apiFetch(owner.endpoint, path, {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(routineFormBody(values))
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payloadError(data, res.status));
        if (!ownsForm(owner) || mutationToken !== token) return;
        const saved = decodeRoutine(data, owner.endpoint);
        const edited = readRoutineForm();
        routineCreating = false;
        routineSelected = saved;
        routineSelKey = routineKey(hostId, saved.id);
        routineVersionShown = null;
        renderRoutineDetail(edited && JSON.stringify(edited) !== JSON.stringify(values) ? edited : void 0, JSON.stringify(values));
        setRoutineNotice(creating ? "Routine created." : `Saved (v${saved.promptVersion || 1}).`);
        void loadRoutinesView();
        if (creating) {
          routineInvocations = [];
          routineInvocationsNextBefore = null;
          startRoutineInvocationPoll();
        }
        loadRoutineInvocations({ reset: true });
      } catch (e) {
        if (ownsForm(owner) && mutationToken === token) setRoutineFormError(errorMessage(e));
      } finally {
        if (ownsForm(owner) && mutationToken === token) {
          mutationToken = null;
          routineBusy = false;
          if (btn) {
            btn.disabled = false;
            btn.textContent = creating ? "Create routine" : "Save";
          }
        }
      }
    }
    async function runRoutineNow() {
      if (!isRoutinesViewOpen() || routineBusy || !routineSelected) return;
      const btn = field("rtRunBtn"), owner = captureForm(), selected = routineSelected;
      if (!ownsForm(owner)) return;
      const token = mutationToken = /* @__PURE__ */ Symbol();
      setRoutineFormError("");
      setRoutineNotice("");
      routineBusy = true;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Starting\u2026";
      }
      try {
        const res = await apiFetch(
          owner.endpoint,
          `/api/routines/${encodeURIComponent(selected.id)}/invoke`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "pi-dish-ui" })
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const extra = res.status === 429 && record8(data) && typeof data.retryAfterSec === "number" ? ` (retry in ${data.retryAfterSec}s)` : "";
          throw new Error(payloadError(data, res.status) + extra);
        }
        if (!ownsForm(owner) || mutationToken !== token) return;
        setRoutineNotice("Run started.");
        await loadRoutineInvocations({ reset: true });
        if (ownsForm(owner)) void loadRoutinesView();
      } catch (e) {
        if (ownsForm(owner) && mutationToken === token) setRoutineFormError(errorMessage(e));
      } finally {
        if (ownsForm(owner) && mutationToken === token) {
          mutationToken = null;
          routineBusy = false;
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Run now";
          }
        }
      }
    }
    let routineDeleteArmTimer;
    async function deleteRoutine() {
      if (!isRoutinesViewOpen() || routineBusy || !routineSelected) return;
      const btn = field("rtDeleteBtn"), owner = captureForm(), selected = routineSelected;
      if (!ownsForm(owner)) return;
      if (!routineDeleteArmed) {
        routineDeleteArmed = true;
        if (btn) btn.textContent = "Delete?";
        clearTimeout(routineDeleteArmTimer);
        routineDeleteArmTimer = setTimeout(() => {
          if (!ownsForm(owner)) return;
          routineDeleteArmed = false;
          const live = field("rtDeleteBtn");
          if (live) live.textContent = "Delete";
        }, 3e3);
        return;
      }
      clearTimeout(routineDeleteArmTimer);
      const token = mutationToken = /* @__PURE__ */ Symbol();
      routineDeleteArmed = false;
      routineBusy = true;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Deleting\u2026";
      }
      try {
        const res = await apiFetch(
          owner.endpoint,
          `/api/routines/${encodeURIComponent(selected.id)}`,
          { method: "DELETE" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payloadError(data, res.status));
        if (!ownsForm(owner) || mutationToken !== token) return;
        stopRoutineInvocationPoll();
        routineSelected = null;
        routineSelKey = null;
        routineFormBaseline = null;
        routineInvocations = [];
        backToRoutinesList();
        renderRoutineDetail();
        await loadRoutinesView();
      } catch (e) {
        if (!ownsForm(owner) || mutationToken !== token) return;
        mutationToken = null;
        routineBusy = false;
        setRoutineFormError(errorMessage(e));
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Delete";
        }
        return;
      }
      if (mutationToken === token) {
        mutationToken = null;
        routineBusy = false;
      }
    }
    return {
      open: openRoutinesView,
      close: closeRoutinesView,
      isOpen: isRoutinesViewOpen,
      refresh: refreshRoutinesView,
      escape: routinesViewEscape,
      back: backToRoutinesList,
      select: selectRoutine,
      create: startRoutineCreate,
      updateButton: updateRoutinesButton,
      save: saveRoutine,
      run: runRoutineNow,
      delete: deleteRoutine,
      get invocations() {
        return routineInvocations;
      },
      dispose() {
        closeRoutinesView();
        disposed = true;
        routineModelCatalogs.clear();
        routineHarnessCatalogs.clear();
      }
    };
  }

  // src/browser/session-info-data.ts
  var text11 = (value) => typeof value === "string" ? value : "";
  var number5 = (value) => finite2(value) ? value : 0;
  var nullable = (value) => finite2(value) ? value : null;
  var object4 = (value) => record8(value) ? value : {};
  function decodeSessionStats(value) {
    if (!record8(value)) throw new Error("Invalid session stats");
    if (typeof value.error === "string" && value.error) throw new Error(value.error);
    const context = object4(value.contextUsage), timing = object4(value.responseTiming), costs2 = object4(value.costs), unavailable = object4(value.costUnavailable), tokens2 = object4(value.tokens), runtime = object4(value.runtime);
    return {
      model: text11(value.model),
      thinkingLevel: text11(value.thinkingLevel),
      cwd: text11(value.cwd),
      sessionFile: text11(value.sessionFile),
      userMessages: number5(value.userMessages),
      assistantMessages: number5(value.assistantMessages),
      toolCalls: number5(value.toolCalls),
      compactions: number5(value.compactions),
      genOutput: number5(value.genOutput),
      genMs: number5(value.genMs),
      reasoningTokens: number5(value.reasoningTokens),
      cost: nullable(value.cost),
      contextUsage: { tokens: nullable(context.tokens), contextWindow: nullable(context.contextWindow), percent: nullable(context.percent) },
      responseTiming: { medianMs: number5(timing.medianMs), slowestMs: number5(timing.slowestMs) },
      costs: Object.fromEntries(USAGE_MERGE_COST_KEYS.map((key) => [key, nullable(costs2[key])])),
      costUnavailable: Object.fromEntries(USAGE_MERGE_COST_KEYS.map((key) => [key, number5(unavailable[key])])),
      tokens: Object.fromEntries(USAGE_MERGE_TOKEN_KEYS.map((key) => [key, number5(tokens2[key])])),
      runtime: typeof runtime.kind === "string" ? { kind: runtime.kind, pid: nullable(runtime.pid), server: text11(runtime.server), tmuxSession: text11(runtime.tmuxSession), windowIndex: nullable(runtime.windowIndex), windowName: text11(runtime.windowName) } : null
    };
  }
  function decodeSessionShare(value) {
    if (!record8(value) || value.error) return null;
    const path = text11(value.path), url = text11(value.url);
    return path || url ? { path, url } : null;
  }
  function decodePublishedPages(value) {
    return Array.isArray(value) ? value.flatMap((page) => record8(page) && typeof page.token === "string" && typeof page.root === "string" && (typeof page.path === "string" || typeof page.url === "string") ? [{ token: page.token, root: page.root, path: text11(page.path), url: text11(page.url), title: text11(page.title), missing: page.missing === true, createdAt: number5(page.createdAt) }] : []) : [];
  }

  // src/browser/session-info.ts
  function createSessionInfo(options2) {
    const { document: document2, sessionState } = options2, location = document2.defaultView.location;
    const copyTextToClipboard2 = options2.copy, setStatus = options2.status, confirm = options2.confirm, sessionRefFor = options2.reference;
    const apiFetch = options2.request, refreshSessions = options2.refreshSessions, selectSession = options2.selectSession;
    const errorMessage = (error) => error instanceof Error ? error.message : String(error);
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing session info element: " + id);
      return value;
    };
    let disposed = false;
    let statsEndpoint = null;
    let statsEvents = new AbortController(), shareEvents = new AbortController(), pagesEvents = new AbortController(), processEvents = new AbortController(), artifactEvents = new AbortController();
    let shareSequence = 0, pagesSequence = 0, artifactGeneration = 0;
    let artifactOwner = null, artifactEndpoint = null;
    let messageCopies = /* @__PURE__ */ new WeakMap();
    const statsTimers = /* @__PURE__ */ new Set(), messageTimers = /* @__PURE__ */ new Set();
    function clearTimers(timers) {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    }
    function later(timers, callback) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, 1200);
      timers.add(timer);
    }
    function endpoint(owner) {
      const host = options2.host(owner.host);
      return host ? Object.freeze({ ...host }) : null;
    }
    function owns(owner, host) {
      if (disposed || !owner || !host || !sessionState.ownsSelection(owner)) return false;
      const current = options2.host(owner.host);
      return !!current && current.base === host.base && (current.token || "") === (host.token || "");
    }
    function sessionSupports2(session, capability) {
      const capabilities = session?.capabilities;
      return !record8(capabilities) || capabilities[capability] !== false;
    }
    async function json(host, path, init) {
      const response = await apiFetch(host, path, init);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
      return data;
    }
    async function shareFor(host, id) {
      const response = await apiFetch(host, `/api/sessions/${encodeURIComponent(id)}/share`);
      if (response.status === 404) return null;
      const value = await response.json();
      if (!response.ok) throw new Error(record8(value) && typeof value.error === "string" ? value.error : `HTTP ${response.status}`);
      return decodeSessionShare(value);
    }
    async function apiSend(host, path) {
      const response = await apiFetch(host, path, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
      return data;
    }
    let statsModalGeneration = 0;
    let statsModalOwner = null;
    function ownsStatsModal(owner, generation) {
      return statsModalOwner === owner && owns(owner, statsEndpoint) && statsModalGeneration === generation && element("statsModal").style.display !== "none";
    }
    function openStatsModal() {
      if (disposed || !sessionState.currentSession) return;
      const owner = sessionState.captureSelection();
      if (!owner) return;
      const sessionId = owner.id;
      const host = endpoint(owner);
      if (!host) return;
      closeStatsModal();
      statsEndpoint = host;
      const ref = sessionRefFor(sessionState.currentSession);
      const generation = ++statsModalGeneration;
      statsModalOwner = owner;
      const modal = element("statsModal");
      const body = element("statsBody");
      modal.style.display = "flex";
      body.textContent = "Loading...";
      statsEvents = new AbortController();
      body.addEventListener("click", (event) => {
        if (!(event.target instanceof Element) || !ownsStatsModal(owner, generation)) return;
        const button = event.target.closest(".stats-copy");
        if (!button || !body.contains(button)) return;
        void copyTextToClipboard2(button.dataset.copy || "").then(() => {
          if (!ownsStatsModal(owner, generation) || !button.isConnected) return;
          const original = button.textContent;
          button.classList.add("copied");
          button.textContent = "Copied \u2713";
          later(statsTimers, () => {
            if (ownsStatsModal(owner, generation) && button.isConnected) {
              button.textContent = original;
              button.classList.remove("copied");
            }
          });
        }, () => {
          if (ownsStatsModal(owner, generation)) setStatus("Copy failed (clipboard blocked)", "error");
        });
      }, { signal: statsEvents.signal });
      json(host, `/api/sessions/${encodeURIComponent(sessionId)}/stats`).then(decodeSessionStats).then((s) => {
        if (!ownsStatsModal(owner, generation)) return;
        const cu = s.contextUsage || {};
        const avgSpeed = formatTokSpeed(s.genOutput, s.genMs);
        const rows = [
          ["__section", "Summary"],
          // The pasteable handle for this session, click-to-copy like the paths
          // below it — the modal-side twin of the sidebar row's context menu.
          ["Ref", ref, !!ref],
          ["Model", s.model || "\u2014"],
          ["Thinking", s.thinkingLevel || "\u2014"],
          ["Context", (cu.tokens != null ? formatTokens(cu.tokens) : "\u2014") + " / " + (cu.contextWindow ? formatTokens(cu.contextWindow) : "\u2014") + (cu.percent != null ? ` (${Math.round(cu.percent * 10) / 10}%)` : "")],
          ["Messages", `${s.userMessages} user \xB7 ${s.assistantMessages} assistant \xB7 ${s.toolCalls} tool calls`],
          // Always shown, including zero: how often the context was rebuilt is
          // read together with the Context row above it.
          ["Compactions", String(s.compactions ?? 0)],
          ["__section", "Performance"],
          s.responseTiming?.medianMs ? ["Response time", `${formatDuration(s.responseTiming.medianMs)} median \xB7 ${formatDuration(s.responseTiming.slowestMs)} slowest`] : null,
          avgSpeed ? ["Effective speed", `${avgSpeed} avg \xB7 ${formatDuration(s.genMs)} measured response time`] : null,
          ["__section", "Tokens & cache"],
          ["Tokens in / out", `${formatTokens(s.tokens?.input)} / ${formatTokens(s.tokens?.output)}`],
          s.reasoningTokens ? ["Reasoning", formatTokens(s.reasoningTokens)] : null,
          ["Cache", formatCacheStat(s.tokens?.cacheRead, s.tokens?.cacheWrite, s.tokens?.input)],
          ["__section", "Estimated spend"],
          ["Estimated total", formatUsageCost(s.costs?.total ?? s.cost, s.costUnavailable?.total)],
          ["Components", `input ${formatUsageCost(s.costs?.input, s.costUnavailable?.input)} \xB7 output ${formatUsageCost(s.costs?.output, s.costUnavailable?.output)} \xB7 cache read ${formatUsageCost(s.costs?.cacheRead, s.costUnavailable?.cacheRead)} \xB7 write ${formatUsageCost(s.costs?.cacheWrite, s.costUnavailable?.cacheWrite)}`],
          ["__section", "Location"],
          s.runtime ? ["Running in", formatRuntime(s.runtime)] : null,
          ["cwd", s.cwd || "\u2014", !!s.cwd],
          ["Session file", s.sessionFile || "\u2014", !!s.sessionFile]
        ];
        body.innerHTML = '<table class="stats-table">' + rows.filter((row) => row !== null).map(([k, v, copyable]) => {
          if (k === "__section") return `<tr class="stats-section"><th colspan="2">${escapeHtml(v)}</th></tr>`;
          const val = copyable ? `<button type="button" class="stats-copy" data-copy="${escapeHtml(String(v))}" title="Click to copy">${escapeHtml(String(v))}</button>` : escapeHtml(String(v));
          return `<tr><td class="stats-key">${escapeHtml(k)}</td><td class="stats-val">${val}</td></tr>`;
        }).join("") + '</table><div class="telemetry-note">Spend is estimated from the session harness catalog, not provider-billed. Response time is request start \u2192 JSONL append; effective speed includes TTFT.</div><div class="stats-share" id="statsShare"></div><div class="stats-share" id="statsPages"></div><div class="stats-share" id="statsClose"></div>';
        loadShareSection(owner, generation);
        loadPagesSection(owner, generation);
        renderCloseSection(owner, generation);
      }).catch((e) => {
        if (ownsStatsModal(owner, generation)) body.textContent = "Failed to load stats: " + errorMessage(e);
      });
    }
    async function loadShareSection(owner, generation) {
      if (!ownsStatsModal(owner, generation) || !statsEndpoint) return;
      const host = statsEndpoint, sequence = ++shareSequence, element2 = document2.getElementById("statsShare");
      if (!element2) return;
      if (!sessionSupports2(sessionState.findSession(owner.id, owner.host), "export")) {
        element2.remove();
        return;
      }
      element2.innerHTML = '<div class="stats-share-title">Public share link</div><div class="stats-share-body">Loading\u2026</div>';
      try {
        const share = await shareFor(host, owner.id);
        if (sequence === shareSequence) renderShareSection(owner, share, generation);
      } catch {
        if (sequence === shareSequence) renderShareSection(owner, null, generation);
      }
    }
    function renderShareSection(owner, share, generation) {
      if (!ownsStatsModal(owner, generation) || !statsEndpoint) return;
      shareEvents.abort();
      shareEvents = new AbortController();
      const sequence = ++shareSequence, host = statsEndpoint;
      const current = () => sequence === shareSequence && ownsStatsModal(owner, generation);
      const element2 = document2.getElementById("statsShare");
      if (!element2) return;
      const body = element2.querySelector(".stats-share-body") || element2;
      const link = share ? share.url || location.origin + share.path : "";
      body.innerHTML = share ? `<button type="button" class="stats-copy stats-share-link" data-copy="${escapeHtml(link)}" title="Click to copy">${escapeHtml(link)}</button><button type="button" class="btn-small btn-danger" id="shareRevokeBtn">Revoke</button>` : '<button type="button" class="btn-small" id="shareCreateBtn">Create share link</button><div class="stats-share-hint">Anyone with the link can view this session read-only.</div>';
      const button = body.querySelector(share ? "#shareRevokeBtn" : "#shareCreateBtn");
      button.addEventListener("click", async () => {
        if (!current() || button.disabled) return;
        button.disabled = true;
        try {
          const data = await json(host, `/api/sessions/${encodeURIComponent(owner.id)}/share`, { method: share ? "DELETE" : "POST" });
          const next = share ? null : decodeSessionShare(data);
          if (!share && !next) throw new Error("Invalid share response");
          if (!current()) return;
          renderShareSection(owner, next, generation);
          void refreshArtifacts(owner);
        } catch (error) {
          if (current()) {
            button.disabled = false;
            setStatus(`Failed to ${share ? "revoke" : "create"} share: ` + errorMessage(error), "error");
          }
        }
      }, { signal: shareEvents.signal });
    }
    async function copyMessageShareLink(button) {
      const owner = sessionState.captureSelection(), id = button.dataset.entryId;
      if (disposed || !owner || !id || messageCopies.has(button)) return;
      const host = endpoint(owner);
      if (!host) return;
      const token = /* @__PURE__ */ Symbol();
      messageCopies.set(button, token);
      const current = () => owns(owner, host) && messageCopies.get(button) === token;
      try {
        let share = await shareFor(host, owner.id);
        if (!current()) return;
        if (!share) {
          if (!confirm("No share link exists for this session yet \u2014 create one? Anyone with the link can view the whole session read-only.") || !current()) return;
          share = decodeSessionShare(await json(host, `/api/sessions/${encodeURIComponent(owner.id)}/share`, { method: "POST" }));
          if (!share) throw new Error("Invalid share response");
          if (!current()) return;
          void refreshArtifacts(owner);
        }
        if (!current()) return;
        const base = share.url || location.origin + share.path;
        await copyTextToClipboard2(`${base}?targetId=${encodeURIComponent(id)}`);
        if (!current()) return;
        button.classList.add("copied");
        later(messageTimers, () => {
          if (owns(owner, host)) button.classList.remove("copied");
        });
        setStatus("Message share link copied");
      } catch (error) {
        if (current()) setStatus("Share link failed: " + errorMessage(error), "error");
      } finally {
        if (messageCopies.get(button) === token) messageCopies.delete(button);
      }
    }
    async function finishSessionClose(sessionId, host, owner) {
      if (disposed) return;
      if (!owner || sessionState.ownsSelection(owner)) setStatus("Session closed");
      await options2.loadPrevious();
      if (!disposed && owner && sessionState.ownsSelection(owner) && owner.id === sessionId && owner.host === (host || null)) {
        await selectSession(sessionId, { host });
      }
    }
    function renderCloseSection(owner, generation) {
      if (!ownsStatsModal(owner, generation) || !statsEndpoint) return;
      processEvents.abort();
      processEvents = new AbortController();
      const endpoint2 = statsEndpoint;
      let busy = false;
      const listener = { signal: processEvents.signal };
      const sessionId = owner.id;
      const el = document2.getElementById("statsClose");
      if (!el) return;
      const session = sessionState.findSession(sessionId, owner.host);
      if (!session?.isActive || !sessionSupports2(session, "close")) {
        el.remove();
        return;
      }
      const host = owner.host;
      const detach = session.closeMode === "client-only";
      const ownedAgent = session.closeMode === "owned-agent";
      const restartable = record8(session.capabilities) && session.capabilities.restart === true;
      el.innerHTML = '<div class="stats-share-title">Session process</div><div class="stats-share-body">' + (restartable ? '<button type="button" class="btn-small" id="sessionRestartBtn">Restart agent</button>' : "") + `<button type="button" class="btn-small btn-danger" id="sessionCloseBtn">${detach ? "Detach client" : "Close session"}</button><div class="stats-share-hint">${detach ? "Disconnects this client. The logical agent continues independently." : ownedAgent ? restartable ? "Restart stops this agent and its children, then resumes the root in the same pane. Close also removes the client pane. The transcript is kept; other root agents keep running." : "Stops this agent and its children, then closes its pi-dish-owned client pane. The transcript stays resumable." : restartable ? "Restarts the agent in its current pi-dish-owned pane or RPC slot. The transcript is kept." : "Shuts down this agent process. The transcript is kept and can be resumed."}</div></div>`;
      const closeBtn = el.querySelector("#sessionCloseBtn");
      closeBtn.addEventListener("click", async () => {
        if (!ownsStatsModal(owner, generation) || busy) return;
        const warn = detach ? "Detach this client? The logical agent will continue independently." : ownedAgent ? "Stop this agent and its children? Any work in progress will be aborted; the transcript stays resumable." : sessionState.findSession(sessionId, host)?.turnInProgress ? "A turn is in progress \u2014 closing will abort it. Close this session?" : "Close this session? The agent process will shut down (the transcript stays resumable).";
        if (!confirm(warn) || !ownsStatsModal(owner, generation)) return;
        busy = true;
        closeBtn.disabled = true;
        closeBtn.textContent = detach ? "Detaching\u2026" : "Closing\u2026";
        try {
          await apiSend(endpoint2, `/api/sessions/${encodeURIComponent(sessionId)}/close`);
          if (!ownsStatsModal(owner, generation)) return;
          closeStatsModal();
          await finishSessionClose(sessionId, host, owner);
        } catch (e) {
          if (!ownsStatsModal(owner, generation)) return;
          busy = false;
          closeBtn.disabled = false;
          closeBtn.textContent = detach ? "Detach client" : "Close session";
          setStatus("Close failed: " + errorMessage(e), "error");
        }
      }, listener);
      const restartBtn = el.querySelector("#sessionRestartBtn");
      if (!restartBtn) return;
      restartBtn.addEventListener("click", async () => {
        if (!ownsStatsModal(owner, generation) || busy) return;
        const active = sessionState.findSession(sessionId, host);
        const warn = ownedAgent ? "Restart this agent? This stops the root and its children, aborting any work in progress, then resumes the root in the same pane. The transcript is kept; other root agents keep running." : active?.turnInProgress ? "A turn is in progress \u2014 restarting will abort it. Restart this agent?" : "Restart this agent? The current process will stop, then the session will resume with updated CLI code and startup settings.";
        if (!confirm(warn) || !ownsStatsModal(owner, generation)) return;
        busy = true;
        closeBtn.disabled = true;
        restartBtn.disabled = true;
        restartBtn.textContent = "Restarting\u2026";
        setStatus("Restarting agent\u2026", "working");
        try {
          const data = await apiSend(endpoint2, `/api/sessions/${encodeURIComponent(sessionId)}/restart`);
          if (!record8(data) || typeof data.id !== "string" || !data.id) throw new Error("Invalid restart response");
          if (ownsStatsModal(owner, generation)) closeStatsModal();
          if (owns(owner, endpoint2)) setStatus("Agent restarted");
          await refreshSessions();
          if (owns(owner, endpoint2) && record8(data) && typeof data.id === "string") {
            void selectSession(data.id, { host });
          }
        } catch (e) {
          if (ownsStatsModal(owner, generation)) closeStatsModal();
          await options2.loadPrevious();
          if (owns(owner, endpoint2)) {
            void selectSession(sessionId, { host });
            setStatus("Restart failed: " + errorMessage(e), "error");
          }
        }
      }, listener);
    }
    function closeStatsModal() {
      if (disposed) return;
      statsEvents.abort();
      shareEvents.abort();
      pagesEvents.abort();
      processEvents.abort();
      clearTimers(statsTimers);
      statsEndpoint = null;
      shareSequence++;
      pagesSequence++;
      statsModalGeneration += 1;
      statsModalOwner = null;
      element("statsModal").style.display = "none";
    }
    async function loadPagesSection(owner, generation) {
      if (!ownsStatsModal(owner, generation) || !statsEndpoint) return;
      const host = statsEndpoint, sequence = ++pagesSequence;
      pagesEvents.abort();
      pagesEvents = new AbortController();
      const current = () => sequence === pagesSequence && ownsStatsModal(owner, generation);
      const element2 = document2.getElementById("statsPages");
      if (!element2) return;
      try {
        const pages = decodePublishedPages(await json(host, `/api/pages?sessionId=${encodeURIComponent(owner.id)}`));
        if (!current()) return;
        element2.innerHTML = pages.length ? '<div class="stats-share-title">Published pages</div>' + pages.map((page) => {
          const link = page.url || location.origin + page.path, label = page.title || page.root.split("/").pop();
          return `<div class="stats-page-row" data-token="${escapeHtml(page.token)}"><span class="stats-page-name" title="${escapeHtml(page.root)}">${escapeHtml(label)}${page.missing ? ' <span class="stats-page-missing">(file missing)</span>' : ""}</span><button type="button" class="stats-copy stats-share-link" data-copy="${escapeHtml(link)}" title="Click to copy">${escapeHtml(link)}</button><button type="button" class="btn-small btn-danger stats-page-revoke">Revoke</button></div>`;
        }).join("") : "";
        element2.querySelectorAll(".stats-page-revoke").forEach((button) => {
          const token = button.closest(".stats-page-row")?.dataset.token;
          if (!token) return;
          button.addEventListener("click", async () => {
            if (!current() || button.disabled) return;
            button.disabled = true;
            try {
              await json(host, `/api/pages/${encodeURIComponent(token)}`, { method: "DELETE" });
              if (!current()) return;
              void loadPagesSection(owner, generation);
              void refreshArtifacts(owner);
            } catch (error) {
              if (current()) {
                button.disabled = false;
                setStatus("Failed to revoke: " + errorMessage(error), "error");
              }
            }
          }, { signal: pagesEvents.signal });
        });
      } catch {
        if (current()) element2.innerHTML = "";
      }
    }
    let sessionArtifacts = { pages: [], share: null };
    let artifactsSeq = 0;
    async function refreshArtifacts(owner = sessionState.captureSelection()) {
      if (disposed || !owner || !sessionState.ownsSelection(owner)) return;
      const sessionId = owner.id;
      const host = endpoint(owner);
      if (!host) return;
      const seq = ++artifactsSeq;
      try {
        const [pagesRes, shareRes] = await Promise.all([
          apiFetch(host, `/api/pages?sessionId=${encodeURIComponent(sessionId)}`),
          apiFetch(host, `/api/sessions/${encodeURIComponent(sessionId)}/share`)
        ]);
        const pages = pagesRes.ok ? await pagesRes.json() : [];
        const share = shareRes.ok && shareRes.status !== 404 ? await shareRes.json() : null;
        if (seq !== artifactsSeq || !owns(owner, host)) return;
        sessionArtifacts = { pages: decodePublishedPages(pages), share: decodeSessionShare(share) };
        artifactOwner = owner;
        artifactEndpoint = host;
        updateArtifactsBadge();
        if (element("artifactsModal").style.display !== "none") renderArtifactsModal();
      } catch {
      }
    }
    function updateArtifactsBadge() {
      if (disposed) return;
      const n = sessionArtifacts.pages.length + (sessionArtifacts.share ? 1 : 0);
      const btn = document2.getElementById("btnArtifacts");
      const row = document2.getElementById("cpArtifactsRow");
      if (btn) {
        btn.style.display = n ? "" : "none";
        element("artifactCount").textContent = String(n);
      }
      if (row) {
        row.style.display = n ? "" : "none";
        element("artifactCountMobile").textContent = String(n);
      }
    }
    function openArtifactsModal() {
      if (disposed || !sessionState.currentSession) return;
      artifactGeneration++;
      element("artifactsModal").style.display = "flex";
      renderArtifactsModal();
      refreshArtifacts();
    }
    function closeArtifactsModal() {
      if (disposed) return;
      artifactGeneration++;
      artifactEvents.abort();
      element("artifactsModal").style.display = "none";
    }
    function renderArtifactsModal() {
      if (disposed || element("artifactsModal").style.display === "none") return;
      artifactEvents.abort();
      artifactEvents = new AbortController();
      const owner = artifactOwner, host = artifactEndpoint, generation = ++artifactGeneration;
      const current = () => generation === artifactGeneration && owns(owner, host) && element("artifactsModal").style.display !== "none";
      const body = document2.getElementById("artifactsBody");
      if (!body) return;
      const { pages, share } = owns(owner, host) ? sessionArtifacts : { pages: [], share: null };
      if (!pages.length && !share) {
        body.innerHTML = '<div class="stats-share-hint">Nothing shared from this session yet \u2014 published pages and share links show up here.</div>';
        return;
      }
      let html = "";
      if (pages.length) {
        html += '<div class="stats-share-title">Published pages</div>' + pages.map((p) => {
          const link = p.url || location.origin + p.path;
          const label = p.title || p.root.split("/").pop();
          return `<div class="artifact-row">
          <a class="artifact-link" href="${escapeHtml(link)}" target="_blank" rel="noopener" title="${escapeHtml(p.root)}">${escapeHtml(label)}</a>
          ${p.missing ? '<span class="stats-page-missing">(file missing)</span>' : ""}
          <span class="artifact-meta">${escapeHtml(formatRelativeTime(p.createdAt))}</span>
          <button type="button" class="btn-icon artifact-copy" data-copy="${escapeHtml(link)}" title="Copy link">\u29C9</button>
          <button type="button" class="btn-small btn-danger artifact-revoke" data-token="${escapeHtml(p.token)}">Revoke</button>
        </div>`;
        }).join("");
      }
      if (share) {
        const link = share.url || location.origin + share.path;
        html += `<div class="stats-share-title">Session share link</div><div class="artifact-row">
          <a class="artifact-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">Read-only transcript</a>
          <span class="artifact-meta"></span>
          <button type="button" class="btn-icon artifact-copy" data-copy="${escapeHtml(link)}" title="Copy link">\u29C9</button>
        </div>`;
      }
      body.innerHTML = html;
      body.querySelectorAll(".artifact-copy").forEach((button) => {
        const text17 = button.dataset.copy || "";
        button.addEventListener("click", () => {
          if (!current()) return;
          void copyTextToClipboard2(text17).then(() => {
            if (current()) setStatus("Link copied");
          }, () => {
            if (current()) setStatus("Copy failed (clipboard blocked)", "error");
          });
        }, { signal: artifactEvents.signal });
      });
      body.querySelectorAll(".artifact-revoke").forEach((button) => {
        const token = button.dataset.token;
        button.addEventListener("click", async () => {
          if (!current() || !token || !owner || !host || button.disabled) return;
          button.disabled = true;
          try {
            await json(host, `/api/pages/${encodeURIComponent(token)}`, { method: "DELETE" });
            if (current()) await refreshArtifacts(owner);
          } catch (error) {
            if (current()) {
              button.disabled = false;
              setStatus("Failed to revoke: " + errorMessage(error), "error");
            }
          }
        }, { signal: artifactEvents.signal });
      });
    }
    return {
      openStats: openStatsModal,
      closeStats: closeStatsModal,
      copyMessage: copyMessageShareLink,
      finishClose: finishSessionClose,
      openArtifacts: openArtifactsModal,
      closeArtifacts: closeArtifactsModal,
      refreshArtifacts,
      updateBadge: updateArtifactsBadge,
      get statsOwner() {
        return statsModalOwner;
      },
      resetArtifacts() {
        if (disposed) return;
        sessionArtifacts = { pages: [], share: null };
        artifactOwner = null;
        artifactEndpoint = null;
        artifactsSeq++;
        artifactEvents.abort();
        messageCopies = /* @__PURE__ */ new WeakMap();
        clearTimers(messageTimers);
        updateArtifactsBadge();
      },
      dispose() {
        closeStatsModal();
        closeArtifactsModal();
        clearTimers(messageTimers);
        messageCopies = /* @__PURE__ */ new WeakMap();
        artifactsSeq++;
        disposed = true;
      }
    };
  }

  // src/browser/transcript-tree-data.ts
  var text12 = (value) => typeof value === "string" ? value : "";
  var count = (value) => finite2(value) ? Math.max(0, Math.floor(value)) : 0;
  function decodeTranscriptTree(value) {
    if (!record8(value) || !Array.isArray(value.nodes)) throw new Error("Invalid session tree");
    const maxDepth = value.nodes.length;
    return {
      leafId: typeof value.leafId === "string" ? value.leafId : null,
      activePathIds: Array.isArray(value.activePathIds) ? value.activePathIds.filter((id) => typeof id === "string") : [],
      nodes: value.nodes.flatMap((node) => {
        if (!record8(node) || typeof node.id !== "string" || !node.id) return [];
        return [{
          id: node.id,
          parentId: typeof node.parentId === "string" ? node.parentId : null,
          type: text12(node.type),
          role: text12(node.role),
          depth: Math.min(count(node.depth), maxDepth),
          childCount: count(node.childCount),
          isLeaf: node.isLeaf === true,
          text: text12(node.text),
          label: text12(node.label),
          toolName: text12(node.toolName),
          toolCallId: text12(node.toolCallId),
          modelId: text12(node.modelId),
          summary: text12(node.summary),
          stopReason: text12(node.stopReason),
          errorMessage: text12(node.errorMessage),
          isError: node.isError === true,
          tokensBefore: count(node.tokensBefore),
          toolCalls: Array.isArray(node.toolCalls) ? node.toolCalls.flatMap((tool) => record8(tool) && typeof tool.id === "string" ? [{ id: tool.id, name: text12(tool.name), args: text12(tool.args) }] : []) : []
        }];
      })
    };
  }

  // src/browser/transcript-tree.ts
  function createTranscriptTree(options2) {
    const { document: document2, sessionState, storage, status: setStatus } = options2;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing tree element: " + id);
      return value;
    };
    const errorMessage = (error) => error instanceof Error ? error.message : String(error);
    let disposed = false, treeViewGeneration = 0, branchGeneration = 0, operationGeneration = 0;
    let treeData = null, treeOwner = null, treeEndpoint = null;
    let pendingBranchId = null;
    const treeToolCallMap = /* @__PURE__ */ new Map();
    let viewEvents = new AbortController(), rowEvents = new AbortController(), branchEvents = new AbortController();
    function ownsSelection(owner, host) {
      if (disposed || !owner || !host || !sessionState.ownsSelection(owner)) return false;
      const current = options2.host(owner.host);
      return !!current && current.base === host.base && (current.token || "") === (host.token || "");
    }
    function ownsView(owner, host, generation) {
      return generation === treeViewGeneration && owner === treeOwner && ownsSelection(owner, host);
    }
    function retireBranch() {
      branchGeneration++;
      pendingBranchId = null;
      branchEvents.abort();
      branchEvents = new AbortController();
    }
    function closeTreeModal() {
      treeViewGeneration++;
      treeOwner = null;
      treeEndpoint = null;
      treeData = null;
      treeToolCallMap.clear();
      viewEvents.abort();
      rowEvents.abort();
      retireBranch();
      element("treeModal").style.display = "none";
    }
    async function openTreeModal() {
      if (disposed || !sessionState.currentSession) return;
      closeTreeModal();
      operationGeneration++;
      const owner = sessionState.captureSelection();
      if (!owner) return;
      const endpoint = options2.host(owner.host);
      if (!endpoint) return;
      const host = Object.freeze({ ...endpoint }), generation = ++treeViewGeneration;
      treeOwner = owner;
      treeEndpoint = host;
      setStatus("Loading tree...", "working");
      try {
        const response = await options2.request(host, "/api/sessions/" + encodeURIComponent(owner.id) + "/tree");
        if (!response.ok) throw new Error(await response.text());
        const data = decodeTranscriptTree(await response.json());
        if (!ownsView(owner, host, generation)) return;
        treeData = data;
        for (const node of data.nodes) if (node.role === "assistant") for (const tool of node.toolCalls) treeToolCallMap.set(tool.id, tool);
        const search = element("treeSearch"), filter = element("treeFilter");
        search.value = "";
        filter.value = "default";
        viewEvents = new AbortController();
        const update = () => {
          if (ownsView(owner, host, generation)) filterTree(search.value);
        };
        search.addEventListener("input", update, { signal: viewEvents.signal });
        filter.addEventListener("change", update, { signal: viewEvents.signal });
        filterTree("");
        element("treeModal").style.display = "flex";
        search.focus();
        setStatus("");
      } catch (error) {
        if (ownsView(owner, host, generation)) setStatus("Failed to load tree: " + errorMessage(error), "error");
      }
    }
    function filterTree(query) {
      if (!treeData || !ownsView(treeOwner, treeEndpoint, treeViewGeneration)) return;
      var filterMode = element("treeFilter").value;
      var tokens2 = query.toLowerCase().split(/\s+/).filter(Boolean);
      var filtered = treeData.nodes.filter(function(node) {
        if (filterMode === "user-only" && !(node.type === "message" && node.role === "user")) return false;
        if (filterMode === "no-tools" && node.type === "message" && (node.role === "toolResult" || node.role === "assistant" && !node.text && !node.isLeaf)) return false;
        if (filterMode === "default") {
          if (["model_change", "thinking_level_change", "label", "custom"].includes(node.type)) return false;
          if (node.type === "message" && node.role === "assistant" && !node.text && !node.isLeaf) return false;
        }
        if (tokens2.length > 0) {
          var text17 = getNodeSearchText(node).toLowerCase();
          return tokens2.every((t) => text17.includes(t));
        }
        return true;
      });
      renderTree(filtered);
    }
    function getNodeSearchText(node) {
      return [node.text, node.role, node.label, node.toolName, node.modelId, node.summary].filter(Boolean).join(" ");
    }
    function renderTree(nodes) {
      var body = element("treeBody");
      if (!treeData || !ownsView(treeOwner, treeEndpoint, treeViewGeneration)) return;
      var activeSet = new Set(treeData.activePathIds);
      const childrenOf = /* @__PURE__ */ new Map();
      for (var n of nodes) {
        var pid = n.parentId || "__root__";
        const siblings2 = childrenOf.get(pid) || [];
        siblings2.push(n);
        childrenOf.set(pid, siblings2);
      }
      var html = "";
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var isActive = activeSet.has(node.id);
        var indent = "  ".repeat(Math.min(node.depth, treeData.nodes.length));
        var siblings = childrenOf.get(node.parentId || "__root__") || [];
        var isLast = siblings.indexOf(node) === siblings.length - 1;
        var connector = node.depth > 0 && siblings.length > 1 ? isLast ? "\u2514 " : "\u251C " : "";
        var marker = isActive ? "\u2022" : " ";
        var classes = "tree-node" + (isActive ? " active" : "") + (node.isLeaf ? " is-leaf" : "");
        var badge = node.childCount > 1 ? '<span class="tree-branch-badge">' + node.childCount + "</span>" : "";
        html += '<div class="' + classes + '" data-id="' + escapeHtml(node.id) + '" style="--tree-depth:' + node.depth + '">';
        html += '<span class="tree-prefix">' + indent + connector + "</span>";
        html += '<span class="tree-marker ' + (isActive ? "active-marker" : "inactive-marker") + '">' + marker + " </span>";
        html += renderTreeNodeContent(node) + badge + "</div>";
      }
      retireBranch();
      rowEvents.abort();
      rowEvents = new AbortController();
      const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration;
      body.innerHTML = html;
      body.querySelectorAll(".tree-node").forEach((row) => {
        const id = row.dataset.id;
        row.addEventListener("click", () => {
          if (id && ownsView(owner, host, generation)) selectTreeNode(id);
        }, { signal: rowEvents.signal });
      });
      element("treeStatus").textContent = nodes.length + " entries";
      var leaf = body.querySelector(".is-leaf");
      if (leaf) leaf.scrollIntoView({ block: "center", behavior: "instant" });
    }
    function renderTreeNodeContent(node) {
      if (node.type === "message") {
        if (node.role === "user") return '<span class="tree-role user">user:</span><span class="tree-text">' + escapeHtml(node.text || "(empty)") + "</span>";
        if (node.role === "assistant") {
          var text17 = node.text || "";
          if (!text17 && node.stopReason === "aborted") text17 = "(aborted)";
          if (!text17 && node.errorMessage) return '<span class="tree-role assistant">assistant:</span><span class="tree-text error-text">' + escapeHtml(node.errorMessage.substring(0, 80)) + "</span>";
          if (!text17 && node.toolCalls && node.toolCalls.length) {
            var calls = node.toolCalls.map(function(tc2) {
              return tc2.args ? tc2.name + ": " + tc2.args : tc2.name;
            }).join(" \xB7 ");
            return '<span class="tree-role assistant">assistant:</span><span class="tree-text muted">' + escapeHtml(calls) + "</span>";
          }
          if (!text17) text17 = "(empty)";
          return '<span class="tree-role assistant">assistant:</span><span class="tree-text">' + escapeHtml(text17) + "</span>";
        }
        if (node.role === "toolResult") {
          var tc = node.toolCallId ? treeToolCallMap.get(node.toolCallId) : null;
          var disp = tc ? "[" + tc.name + ": " + tc.args + "]" : "[" + (node.toolName || "tool") + "]";
          return '<span class="tree-role tool">' + escapeHtml(disp) + "</span>" + (node.isError ? '<span class="tree-text error-text"> error</span>' : "");
        }
        return '<span class="tree-text muted">[' + escapeHtml(node.role || "message") + "]</span>";
      }
      if (node.type === "compaction") return '<span class="tree-role system">[compaction: ' + Math.round((node.tokensBefore || 0) / 1e3) + "k tokens]</span>";
      if (node.type === "model_change") return '<span class="tree-text muted">[model: ' + escapeHtml(node.modelId || "") + "]</span>";
      if (node.type === "branch_summary") return '<span class="tree-role system">[branch summary]</span> <span class="tree-text muted">' + escapeHtml(node.summary || "") + "</span>";
      if (node.type === "session_info") return '<span class="tree-text muted">[session info]</span>';
      return '<span class="tree-text muted">[' + escapeHtml(node.type) + "]</span>";
    }
    function selectTreeNode(entryId) {
      const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration;
      if (!treeData || !ownsView(owner, host, generation) || !treeData.nodes.some((node) => node.id === entryId)) return;
      if (entryId === treeData.leafId) {
        closeTreeModal();
        return;
      }
      retireBranch();
      pendingBranchId = entryId;
      const branch = branchGeneration;
      const current = () => branch === branchGeneration && pendingBranchId === entryId && ownsView(owner, host, generation);
      element("treeBody").querySelectorAll(".tree-node").forEach((row) => row.classList.toggle("selected", row.dataset.id === entryId));
      const summarize = storage.getItem("pi-dish-branch-summarize") === "1";
      const allowInstructions = sessionState.currentSession?.harnessId !== "omp";
      element("treeStatus").innerHTML = '<div class="branch-confirm"><label class="branch-summarize-label"><input type="checkbox" id="branchSummarize"' + (summarize ? " checked" : "") + "> Summarize abandoned branch</label>" + (allowInstructions ? '<input type="text" id="branchInstructions" class="branch-instructions" placeholder="Summary instructions (optional)"' + (summarize ? "" : ' style="display:none"') + ">" : "") + '<span class="branch-confirm-btns"><button class="btn-sm btn-branch" id="branchGoBtn">Branch from here</button><button class="btn-sm" id="branchCancelBtn">Cancel</button></span></div>';
      element("branchSummarize").addEventListener("change", () => {
        if (current()) toggleBranchInstructions();
      }, { signal: branchEvents.signal });
      element("branchGoBtn").addEventListener("click", () => {
        if (current()) void confirmBranch();
      }, { signal: branchEvents.signal });
      element("branchCancelBtn").addEventListener("click", () => {
        if (current()) cancelBranch();
      }, { signal: branchEvents.signal });
    }
    function toggleBranchInstructions() {
      const input = document2.getElementById("branchInstructions");
      if (input) input.style.display = element("branchSummarize").checked ? "" : "none";
    }
    function cancelBranch() {
      retireBranch();
      element("treeBody").querySelectorAll(".selected").forEach((row) => row.classList.remove("selected"));
      element("treeStatus").textContent = element("treeBody").querySelectorAll(".tree-node").length + " entries";
    }
    async function confirmBranch() {
      const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration;
      if (!treeData || !pendingBranchId || !host || !ownsView(owner, host, generation)) return;
      const button = element("branchGoBtn");
      if (button.disabled) return;
      const entryId = pendingBranchId, branch = branchGeneration, operation = ++operationGeneration;
      const summarize = element("branchSummarize").checked;
      const customInstructions = document2.getElementById("branchInstructions")?.value.trim() || void 0;
      storage.setItem("pi-dish-branch-summarize", summarize ? "1" : "0");
      button.disabled = true;
      button.textContent = summarize ? "Summarizing\u2026" : "Branching\u2026";
      setStatus(summarize ? "Summarizing abandoned branch\u2026" : "Branching...", "working");
      try {
        const data = await sendJson(options2.request, host, "/api/sessions/" + encodeURIComponent(owner.id) + "/branch", { entryId, summarize, customInstructions });
        if (!disposed && record8(data) && typeof data.editorText === "string" && data.editorText) options2.saveEditorDraft(owner, data.editorText);
        if (operation !== operationGeneration || !ownsSelection(owner, host)) return;
        closeTreeModal();
        setStatus("Branched \u2014 reloading");
        await options2.selectSession(owner.id, { host: owner.host, forceTranscriptReload: true });
      } catch (error) {
        if (operation !== operationGeneration || !ownsSelection(owner, host)) return;
        setStatus("Branch failed: " + errorMessage(error), "error");
        if (branch === branchGeneration && ownsView(owner, host, generation)) {
          button.disabled = false;
          button.textContent = "Branch from here";
        }
      }
    }
    return {
      open: openTreeModal,
      close: closeTreeModal,
      filter: filterTree,
      select: selectTreeNode,
      confirm: confirmBranch,
      cancel: cancelBranch,
      get data() {
        return treeData;
      },
      dispose() {
        closeTreeModal();
        operationGeneration++;
        disposed = true;
      }
    };
  }

  // src/browser/browser-assets.ts
  function createBrowserAssets(document2) {
    let disposed = false;
    const loaded = /* @__PURE__ */ new Map();
    const pending = /* @__PURE__ */ new Set();
    function load(tag, attributes) {
      if (disposed) return Promise.reject(new Error("Browser assets disposed"));
      const url = "src" in attributes ? attributes.src : attributes.href;
      const key = tag + ":" + url;
      const existing = loaded.get(key);
      if (existing) return existing;
      const promise = new Promise((resolve, reject) => {
        const element = document2.createElement(tag);
        Object.assign(element, attributes);
        const cleanup = () => {
          pending.delete(cancel);
          element.onload = null;
          element.onerror = null;
        };
        const cancel = () => {
          cleanup();
          element.remove();
          reject(new Error("Browser assets disposed"));
        };
        pending.add(cancel);
        element.onload = () => {
          cleanup();
          resolve();
        };
        element.onerror = () => {
          cleanup();
          element.remove();
          reject(new Error("Failed to load " + url));
        };
        document2.head.append(element);
      }).catch((error) => {
        loaded.delete(key);
        throw error;
      });
      loaded.set(key, promise);
      return promise;
    }
    return { load, dispose() {
      disposed = true;
      for (const cancel of [...pending]) cancel();
      loaded.clear();
    } };
  }

  // src/browser/helper-markdown.ts
  function sanitizeMarkdownUrl(url) {
    const raw = String(url == null ? "" : url).trim();
    const scheme = raw.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
    if (/^(javascript|vbscript|data):/.test(scheme)) return "#";
    return raw;
  }
  var MERMAID_FENCE_LANGS = /* @__PURE__ */ new Set(["mermaid", "mmd"]);
  var DIAGRAM_SNIFF_LANGS = /* @__PURE__ */ new Set(["", "text", "txt", "plain", "plaintext", "diagram", "uml"]);
  var MERMAID_DECLARATIONS = [
    /^(?:graph|flowchart(?:-elk)?)\s+(?:TB|TD|BT|RL|LR)\b/,
    /^(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|mindmap|timeline|kanban|zenuml|quadrantChart|requirementDiagram|gitGraph|architecture-beta|block-beta|packet(?:-beta)?|radar-beta|sankey-beta|treemap(?:-beta)?|xychart-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/,
    /^pie(?:\s+(?:title|showData)\b|\s*$)/
  ];
  function mermaidDeclarationLine(text17) {
    const lines = String(text17 == null ? "" : text17).split("\n");
    let i = 0;
    if (lines[0] !== void 0 && lines[0].trim() === "---") {
      const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === "---");
      if (end > 0) i = end + 1;
    }
    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("%%")) continue;
      return line;
    }
    return "";
  }
  function looksLikeMermaid(text17) {
    const decl = mermaidDeclarationLine(text17);
    return !!decl && MERMAID_DECLARATIONS.some((re) => re.test(decl));
  }
  function diagramKindForFence(lang, source) {
    const tag = String(lang == null ? "" : lang).trim().toLowerCase().split(/[\s,:;]/)[0];
    if (MERMAID_FENCE_LANGS.has(tag)) return "mermaid";
    if (!DIAGRAM_SNIFF_LANGS.has(tag)) return null;
    return looksLikeMermaid(source) ? "mermaid" : null;
  }
  function isDarkColorHex(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex == null ? "" : hex).trim());
    if (!m) return true;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const lin = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.5;
  }
  function createMathExtensions(katexLib) {
    const getKatex = () => katexLib || (typeof katex !== "undefined" ? katex : null);
    const blockMath = {
      name: "blockMath",
      level: "block",
      start(src) {
        const match = src.match(/\$\$|\\\[/);
        return match ? match.index : -1;
      },
      tokenizer(src) {
        const match = /^(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])/.exec(src);
        if (match) {
          const text17 = match[1] !== void 0 ? match[1] : match[2];
          return {
            type: "blockMath",
            raw: match[0],
            text: text17.trim()
          };
        }
      },
      renderer(token) {
        const k = getKatex();
        if (!k) return `<pre class="math-block"><code>${escapeHtml(token.raw)}</code></pre>
`;
        try {
          return `<div class="math-block">${k.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>
`;
        } catch (e) {
          return `<pre class="math-error"><code>${escapeHtml(token.raw)}</code></pre>
`;
        }
      }
    };
    const inlineMath = {
      name: "inlineMath",
      level: "inline",
      start(src) {
        const match = src.match(/\$|\\\(|\\\[/);
        return match ? match.index : -1;
      },
      tokenizer(src) {
        const bracketMatch = /^\\\[([\s\S]*?)\\\]/.exec(src);
        if (bracketMatch) {
          return {
            type: "inlineMath",
            raw: bracketMatch[0],
            text: bracketMatch[1].trim(),
            display: true
          };
        }
        const parenMatch = /^\\\(([\s\S]*?)\\\)/.exec(src);
        if (parenMatch) {
          return {
            type: "inlineMath",
            raw: parenMatch[0],
            text: parenMatch[1].trim(),
            display: false
          };
        }
        const doubleDollarMatch = /^\$\$([\s\S]*?)\$\$/.exec(src);
        if (doubleDollarMatch) {
          return {
            type: "inlineMath",
            raw: doubleDollarMatch[0],
            text: doubleDollarMatch[1].trim(),
            display: true
          };
        }
        const dollarMatch = /^\$((?:\\\$|[^\$\s\n])(?:(?:\\\$|[^\$\n])*?(?:\\\$|[^\$\s\n]))?)\$/.exec(src);
        if (dollarMatch) {
          return {
            type: "inlineMath",
            raw: dollarMatch[0],
            text: dollarMatch[1],
            display: false
          };
        }
      },
      renderer(token) {
        const k = getKatex();
        if (!k) return escapeHtml(token.raw);
        try {
          return k.renderToString(token.text, { displayMode: Boolean(token.display), throwOnError: false });
        } catch (e) {
          return escapeHtml(token.raw);
        }
      }
    };
    return [blockMath, inlineMath];
  }
  var FILE_MENTION_RE = /^(?:~\/|\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?$/;
  var FILE_EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
  function looksLikeFilePath(text17) {
    const s = String(text17 == null ? "" : text17).trim();
    if (!s || s.length > 260) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false;
    if (!FILE_MENTION_RE.test(s)) return false;
    const stripped = s.replace(/:\d+(?::\d+)?$/, "");
    return stripped.includes("/") || FILE_EXT_RE.test(stripped);
  }
  var PATH_TOKEN_RE = /(?:~\/|\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?/g;
  var BARE_EXT_STOPLIST = /* @__PURE__ */ new Set(["com", "org", "net", "io", "ai", "dev", "co", "app"]);
  function findPathTokens(text17) {
    const s = String(text17 == null ? "" : text17);
    const out = [];
    PATH_TOKEN_RE.lastIndex = 0;
    let m;
    while (m = PATH_TOKEN_RE.exec(s)) {
      const token = m[0].replace(/[.,;:!?]+$/, "");
      if (!token) continue;
      const prev = s[m.index - 1];
      if (prev && /[\w.@:/+-]/.test(prev)) continue;
      if (!looksLikeFilePath(token)) continue;
      const stripped = token.replace(/:\d+(?::\d+)?$/, "");
      const rooted = /^(?:~\/|\.{1,2}\/|\/)/.test(stripped);
      const ext = (stripped.match(FILE_EXT_RE) || [""])[0].slice(1);
      if (!rooted && !ext) continue;
      if (!rooted && !stripped.includes("/") && BARE_EXT_STOPLIST.has(ext.toLowerCase())) continue;
      out.push({ start: m.index, end: m.index + token.length, token });
    }
    return out;
  }
  function renderDiffHtml(patch) {
    if (!patch) return "";
    const out = [];
    let inHunk = false;
    let oldLine = null, newLine = null;
    const lines = String(patch).split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const line of lines) {
      if (line.startsWith("@@")) {
        inHunk = true;
        const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        oldLine = match ? Number(match[1]) : null;
        newLine = match ? Number(match[2]) : null;
        out.push(`<div class="diff-line diff-hunk" data-diff-line="1">${escapeHtml(line)}</div>`);
        continue;
      }
      if (!inHunk) continue;
      if (line[0] === "\\") {
        out.push(`<div class="diff-line diff-note">${escapeHtml(line)}</div>`);
        continue;
      }
      const cls = line[0] === "+" ? " diff-add" : line[0] === "-" ? " diff-del" : "";
      const oldAt = line[0] === "+" ? null : oldLine;
      const newAt = line[0] === "-" ? null : newLine;
      const attrs = ` data-diff-line="1" data-old-line="${oldAt ?? ""}" data-new-line="${newAt ?? ""}"`;
      out.push(`<div class="diff-line${cls}"${attrs}>${escapeHtml(line) || " "}</div>`);
      if (line[0] !== "+" && oldLine != null) oldLine++;
      if (line[0] !== "-" && newLine != null) newLine++;
    }
    return out.join("");
  }
  function diffStatusClass(letter) {
    switch (letter) {
      case "A":
      case "?":
        return "add";
      case "D":
        return "del";
      case "R":
      case "C":
        return "ren";
      case "U":
        return "conflict";
      default:
        return "mod";
    }
  }

  // src/browser/rich-text.ts
  function createRichText(options2) {
    const { document: document2, sessionState } = options2;
    const events = new AbortController(), copyTimers = /* @__PURE__ */ new Set();
    let copies = /* @__PURE__ */ new WeakMap();
    document2.addEventListener("click", (event) => {
      if (disposed || !(event.target instanceof Element)) return;
      const copy = event.target.closest(".code-copy-btn");
      if (copy) {
        const owner = sessionState.captureSelection(), token = /* @__PURE__ */ Symbol();
        copies.set(copy, token);
        const current = () => !disposed && copy.isConnected && copies.get(copy) === token && (owner ? sessionState.ownsSelection(owner) : !sessionState.currentSession);
        const source = copy.closest(".code-block")?.querySelector("pre code")?.textContent || "";
        void options2.copy(source).then(() => {
          if (!current()) return;
          copy.textContent = "\u2713";
          const timer = setTimeout(() => {
            copyTimers.delete(timer);
            if (current()) copy.textContent = "\u29C9";
          }, 1200);
          copyTimers.add(timer);
        }, () => {
          if (current()) options2.status("Copy failed (clipboard blocked)", "error");
        });
        return;
      }
      const block = event.target.closest(".diagram-block");
      if (!block) return;
      if (event.target.closest(".diagram-source-btn")) options2.diagrams.toggleSource(block);
      else if (event.target.closest(".diagram-zoom-btn")) options2.diagrams.openLightbox(block);
    }, { signal: events.signal });
    let disposed = false, mathAssetsPromise = null, highlightAssetsPromise = null;
    options2.marked?.use({
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
            type: "del",
            raw: cap[0],
            text: cap[2],
            tokens: this.lexer.inlineTokens(cap[2])
          };
        }
      },
      renderer: {
        html(html) {
          return escapeHtml(typeof html === "string" ? html : record8(html) && typeof html.text === "string" ? html.text : "");
        }
      },
      walkTokens(token) {
        if (token.type === "link" || token.type === "image") token.href = sanitizeMarkdownUrl(token.href);
      },
      extensions: createMathExtensions()
    });
    function formatMarkdown(text17) {
      if (!text17) return "";
      if (options2.marked) {
        try {
          return options2.marked.parse(text17);
        } catch (e) {
        }
      }
      let html = escapeHtml(text17);
      html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => `<pre><code class="language-${lang}">${code.trim()}</code></pre>`);
      html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
      html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/\n/g, "<br>");
      return html;
    }
    function applyHighlight(el) {
      const root = el || document2.getElementById("messages");
      if (disposed || !root) return;
      const pendingHighlight = [];
      root.querySelectorAll(".markdown-body pre code").forEach((code) => {
        const pre = code.closest("pre");
        if (pre && !pre.parentElement?.classList.contains("code-block")) {
          const wrap = document2.createElement("div");
          wrap.className = "code-block";
          const btn = document2.createElement("button");
          btn.className = "code-copy-btn";
          btn.title = "Copy code";
          btn.textContent = "\u29C9";
          pre.replaceWith(wrap);
          wrap.append(btn, pre);
        }
        const kind = diagramKindForFence(fenceLanguage(code), code.textContent);
        if (kind) {
          options2.diagrams.prepare(pre?.parentElement || null, kind);
          code.dataset.highlighted = "diagram";
        }
        if (code.dataset.highlighted) return;
        const hljs = options2.highlight();
        if (!hljs) {
          pendingHighlight.push({ code, source: code.textContent || "" });
          return;
        }
        try {
          hljs.highlightElement(code);
        } catch (e) {
        }
      });
      if (pendingHighlight.length) {
        loadHighlightAssets().then((hljs) => {
          if (disposed) return;
          for (const { code, source } of pendingHighlight) {
            if (code.dataset.highlighted || code.textContent !== source) continue;
            try {
              hljs.highlightElement(code);
            } catch (e) {
            }
          }
        }).catch(() => {
        });
      }
      options2.diagrams.render(root);
      linkifyFilePaths(root);
    }
    function fenceLanguage(code) {
      const cls = [...code.classList].find((c) => c.startsWith("language-"));
      return cls ? cls.slice("language-".length) : "";
    }
    function linkifyFilePaths(root) {
      root.querySelectorAll(".markdown-body code, .tool-call-summary, .live-tool-summary").forEach((el) => {
        if (el.closest("pre") || el.classList.contains("file-link") || el.children.length) return;
        if (looksLikeFilePath((el.textContent || "").trim())) {
          el.classList.add("file-link");
          el.title = "Open file";
        }
      });
      root.querySelectorAll(".markdown-body:not([data-linkified])").forEach((body) => {
        body.dataset.linkified = "1";
        const walker = document2.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
          acceptNode(n) {
            return n.parentElement && !n.parentElement.closest("code, a, pre, .file-link, .katex, .math-block, .diagram-render") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          const tokens2 = findPathTokens(node.data);
          if (!tokens2.length) continue;
          const frag = document2.createDocumentFragment();
          let pos = 0;
          for (const t of tokens2) {
            frag.append(node.data.slice(pos, t.start));
            const span = document2.createElement("span");
            span.className = "file-link";
            span.title = "Open file";
            span.textContent = t.token;
            frag.append(span);
            pos = t.end;
          }
          frag.append(node.data.slice(pos));
          node.replaceWith(frag);
        }
      });
    }
    function loadMathAssets() {
      if (disposed) return Promise.reject(new Error("Rich text disposed"));
      return mathAssetsPromise ||= Promise.all([
        options2.assets.load("link", { rel: "stylesheet", href: "vendor/katex.min.css" }),
        options2.assets.load("script", { src: "vendor/katex.min.js" })
      ]).catch((error) => {
        mathAssetsPromise = null;
        throw error;
      });
    }
    function loadHighlightAssets() {
      if (disposed) return Promise.reject(new Error("Rich text disposed"));
      return highlightAssetsPromise ||= Promise.all([
        options2.assets.load("link", { rel: "stylesheet", href: "vendor/hljs-theme.min.css" }),
        options2.assets.load("script", { src: "vendor/highlight.js" })
      ]).then(() => {
        const runtime = options2.highlight();
        if (!runtime) throw new Error("Syntax highlighter did not load");
        return runtime;
      }).catch((error) => {
        highlightAssetsPromise = null;
        throw error;
      });
    }
    return { format: formatMarkdown, highlight: applyHighlight, loadMath: loadMathAssets, dispose() {
      disposed = true;
      events.abort();
      copies = /* @__PURE__ */ new WeakMap();
      for (const timer of copyTimers) clearTimeout(timer);
      copyTimers.clear();
    } };
  }

  // src/browser/diagrams.ts
  function createDiagrams(options2) {
    const { document: document2 } = options2, window = document2.defaultView;
    let disposed = false, themeGeneration = 0;
    let renders = /* @__PURE__ */ new WeakMap();
    const tasks = /* @__PURE__ */ new Set();
    let lightbox = null;
    function closeLightbox() {
      lightbox?.events.abort();
      lightbox?.element.remove();
      lightbox = null;
    }
    function owns(block, owner) {
      return !disposed && owner.generation === themeGeneration && renders.get(block) === owner && block.querySelector("pre code")?.textContent === owner.source;
    }
    let mermaidPromise = null;
    let diagramSeq = 0;
    function loadMermaid() {
      if (disposed) return Promise.reject(new Error("Diagrams disposed"));
      if (mermaidPromise) return mermaidPromise;
      mermaidPromise = options2.assets.load("script", { src: "vendor/mermaid.min.js" }).then(() => {
        const mermaid = options2.runtime();
        if (!mermaid) throw new Error("mermaid did not load");
        if (disposed) throw new Error("Diagrams disposed");
        mermaid.initialize(mermaidConfig());
        return mermaid;
      }).catch((err) => {
        mermaidPromise = null;
        throw err;
      });
      return mermaidPromise;
    }
    function mermaidConfig() {
      const css = window.getComputedStyle(document2.documentElement);
      const hex = (name, fallback2) => resolveColorToHex(css.getPropertyValue(name).trim(), document2) || fallback2;
      const bg = hex("--bg-darker", "#00212b");
      const card = hex("--bg-card", "#073642");
      const hover = hex("--bg-hover", "#0b4354");
      const text17 = hex("--text-bright", "#dbe5e6");
      const muted = hex("--text-muted", "#6f8b93");
      const border = hex("--accent-dim", "#1c6ba3");
      const line = hex("--border", "#11475a");
      return {
        startOnLoad: false,
        // The SVG is written into transcript DOM, so mermaid's own sanitizer is
        // what keeps diagram-authored HTML labels (<br>, <b>) inert.
        securityLevel: "strict",
        // A failed render must leave the code block standing, not mermaid's own
        // error graphic.
        suppressErrorRendering: true,
        theme: "base",
        fontFamily: window.getComputedStyle(document2.body).fontFamily,
        flowchart: { htmlLabels: true, useMaxWidth: true },
        themeVariables: {
          darkMode: isDarkColorHex(bg),
          background: bg,
          primaryColor: card,
          primaryTextColor: text17,
          primaryBorderColor: border,
          secondaryColor: hover,
          secondaryTextColor: text17,
          tertiaryColor: bg,
          tertiaryTextColor: text17,
          lineColor: muted,
          textColor: text17,
          mainBkg: card,
          nodeBorder: border,
          clusterBkg: bg,
          clusterBorder: line,
          titleColor: text17,
          edgeLabelBackground: bg,
          labelBoxBkgColor: card,
          labelBoxBorderColor: border,
          actorBkg: card,
          actorBorder: border,
          actorTextColor: text17,
          signalColor: muted,
          signalTextColor: text17,
          noteBkgColor: hover,
          noteBorderColor: border,
          noteTextColor: text17,
          fontSize: "14px"
        }
      };
    }
    function prepareDiagramBlock(block, kind) {
      if (disposed || !block || block.dataset.diagram) return;
      block.dataset.diagram = kind;
      block.classList.add("diagram-block");
      const actions = document2.createElement("div");
      actions.className = "diagram-actions";
      const source = document2.createElement("button");
      source.className = "diagram-btn diagram-source-btn";
      source.title = "Show diagram source";
      source.textContent = "</>";
      const zoom = document2.createElement("button");
      zoom.className = "diagram-btn diagram-zoom-btn";
      zoom.title = "Zoom diagram";
      zoom.textContent = "\u2922";
      actions.append(source, zoom);
      const copy = block.querySelector(".code-copy-btn");
      if (copy) actions.append(copy);
      block.prepend(actions);
    }
    function renderDiagrams(root) {
      const blocks = [...root.querySelectorAll(".diagram-block:not([data-diagram-state])")];
      if (disposed || !blocks.length) return;
      const pending = blocks.map((block) => {
        const owner = { generation: themeGeneration, source: block.querySelector("pre code")?.textContent || "" };
        renders.set(block, owner);
        block.dataset.diagramState = "loading";
        return { block, owner };
      });
      const timer = setTimeout(() => {
        tasks.delete(timer);
        if (disposed) return;
        loadMermaid().then(
          (m) => {
            for (const { block, owner } of pending) if (owns(block, owner)) void renderDiagramBlock(m, block, owner);
          },
          () => {
            for (const { block, owner } of pending) if (owns(block, owner)) setDiagramError(block, "diagram renderer unavailable");
          }
        );
      }, 0);
      tasks.add(timer);
    }
    async function renderDiagramBlock(m, block, owner) {
      const code = block.querySelector("pre code");
      if (!code) {
        block.dataset.diagramState = "error";
        return;
      }
      const feed = document2.getElementById("messages");
      const pinned = feed && feed.contains(block) && options2.isPinned(feed);
      try {
        const { svg } = await m.render(`pi-dish-diagram-${++diagramSeq}`, owner.source);
        if (!owns(block, owner)) return;
        const stillPinned = pinned && feed.contains(block) && options2.isPinned(feed);
        let figure = block.querySelector(".diagram-render");
        if (!figure) {
          figure = document2.createElement("div");
          figure.className = "diagram-render";
          block.insertBefore(figure, block.querySelector("pre"));
        }
        figure.innerHTML = svg;
        block.querySelector(".diagram-error")?.remove();
        block.classList.remove("diagram-failed");
        block.dataset.diagramState = "rendered";
        if (stillPinned) options2.scrollBottom(feed);
      } catch (err) {
        if (!owns(block, owner)) return;
        setDiagramError(block, String(err instanceof Error ? err.message : err).split("\n")[0].replace(/:\s*$/, ""));
      }
    }
    function setDiagramError(block, message3) {
      block.dataset.diagramState = "error";
      block.classList.add("diagram-failed");
      let note = block.querySelector(".diagram-error");
      if (!note) {
        note = document2.createElement("div");
        note.className = "diagram-error";
        block.insertBefore(note, block.querySelector("pre"));
      }
      note.textContent = `\u26A0 ${message3}`;
    }
    function toggleDiagramSource(block) {
      if (disposed) return;
      const showing = block.classList.toggle("diagram-source");
      const btn = block.querySelector(".diagram-source-btn");
      if (btn) {
        btn.textContent = showing ? "\u25A6" : "</>";
        btn.title = showing ? "Show diagram" : "Show diagram source";
      }
    }
    function openDiagramLightbox(block) {
      const svg = block.querySelector(".diagram-render svg");
      if (disposed || !svg) return;
      closeLightbox();
      const box = svg.viewBox && svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      const baseW = box && box.width || rect.width || 800;
      const baseH = box && box.height || rect.height || 600;
      const overlay = document2.createElement("div");
      overlay.className = "lightbox-overlay diagram-lightbox";
      const events = new AbortController();
      lightbox = { element: overlay, events };
      const current = () => !disposed && lightbox?.element === overlay && overlay.isConnected;
      const bar = document2.createElement("div");
      bar.className = "diagram-zoom-bar";
      const stage = document2.createElement("div");
      stage.className = "diagram-stage";
      const clone = svg.cloneNode(true);
      clone.removeAttribute("style");
      clone.removeAttribute("width");
      clone.removeAttribute("height");
      stage.appendChild(clone);
      overlay.append(bar, stage);
      document2.body.appendChild(overlay);
      const fitScale = () => Math.max(0.1, Math.min(1, (stage.clientWidth - 24) / baseW, (stage.clientHeight - 24) / baseH));
      let scale = fitScale();
      const label = document2.createElement("span");
      label.className = "diagram-zoom-label";
      const apply = () => {
        clone.style.width = `${Math.round(baseW * scale)}px`;
        clone.style.height = `${Math.round(baseH * scale)}px`;
        label.textContent = `${Math.round(scale * 100)}%`;
      };
      const step = (factor) => {
        scale = Math.min(8, Math.max(0.1, scale * factor));
        apply();
      };
      const button = (text17, title, onClick) => {
        const b = document2.createElement("button");
        b.className = "diagram-btn";
        b.textContent = text17;
        b.title = title;
        b.addEventListener("click", () => {
          if (current()) onClick();
        }, { signal: events.signal });
        return b;
      };
      bar.append(
        button("\u2212", "Zoom out", () => step(1 / 1.25)),
        label,
        button("+", "Zoom in", () => step(1.25)),
        button("\u293E", "Fit to screen", () => {
          scale = fitScale();
          apply();
        }),
        button("\u2715", "Close", closeLightbox)
      );
      apply();
      overlay.addEventListener("click", (e) => {
        if (current() && (e.target === overlay || e.target === stage)) closeLightbox();
      }, { signal: events.signal });
    }
    function refreshDiagramTheme() {
      if (disposed || !mermaidPromise) return;
      const generation = ++themeGeneration;
      mermaidPromise.then((m) => {
        if (disposed || generation !== themeGeneration) return;
        m.initialize(mermaidConfig());
        const roots = [document2, ...options2.retainedRoots()];
        for (const root of roots) {
          root.querySelectorAll(".diagram-block[data-diagram-state]").forEach((block) => {
            block.querySelector(".diagram-render")?.remove();
            delete block.dataset.diagramState;
          });
          renderDiagrams(root);
        }
      }).catch(() => {
      });
    }
    return {
      prepare: prepareDiagramBlock,
      render: renderDiagrams,
      toggleSource: toggleDiagramSource,
      openLightbox: openDiagramLightbox,
      refreshTheme: refreshDiagramTheme,
      dispose() {
        disposed = true;
        themeGeneration++;
        renders = /* @__PURE__ */ new WeakMap();
        for (const timer of tasks) clearTimeout(timer);
        tasks.clear();
        closeLightbox();
      }
    };
  }

  // src/browser/clipboard.ts
  function copyTextToClipboard(text17, document2 = globalThis.document, navigator = globalThis.navigator) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text17);
    }
    return new Promise((resolve, reject) => {
      const ta = document2.createElement("textarea");
      ta.value = text17;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document2.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      let ok = false;
      try {
        ok = document2.execCommand("copy");
      } catch (e) {
      }
      ta.remove();
      if (ok) resolve();
      else reject(new Error("execCommand copy rejected"));
    });
  }

  // src/browser/extension-dialogs.ts
  function createExtensionDialogs(options2) {
    const { document: document2, sessionState } = options2;
    let disposed = false;
    const openExtDialogs = /* @__PURE__ */ new Map();
    function extDialogKey(requestId, sessionId, hostId) {
      return JSON.stringify([hostId, sessionId, requestId]);
    }
    function extDialogSig(req) {
      return req.method === "ask" ? "ask:" + JSON.stringify(req.questions) : `${req.method}:${JSON.stringify([req.title, req.message, req.options, req.placeholder, req.prefill])}`;
    }
    function matches(entry) {
      const selected = sessionState.currentSession, host = options2.host(entry.hostId);
      return !!selected && selected.id === entry.sessionId && (selected.host || null) === entry.hostId && !!host && host.base === entry.endpoint.base;
    }
    function currentCard(key, card) {
      const entry = openExtDialogs.get(key);
      return !disposed && !!entry && entry.el === card && card.isConnected && matches(entry) && sessionState.ownsSelection(entry.owner);
    }
    function findDuplicateExtDialog(req, session) {
      const sig = extDialogSig(req), key = sessionKey(session.host, session.id);
      return [...openExtDialogs.values()].find((entry) => entry.sessionKey === key && entry.sig === sig && matches(entry)) || null;
    }
    function getExtDialogDock() {
      const inputArea = document2.querySelector(".input-area");
      if (!inputArea) return null;
      let dock = document2.getElementById("extUiDialogs");
      if (!dock) {
        dock = document2.createElement("div");
        dock.id = "extUiDialogs";
        dock.className = "ext-ui-dialog-dock";
        inputArea.insertBefore(dock, document2.getElementById("attachmentStrip"));
      }
      return dock;
    }
    function updateExtDialogDock() {
      const dock = document2.getElementById("extUiDialogs");
      if (dock && !dock.children.length) dock.remove();
    }
    function dockExtDialog(entry) {
      if (disposed || !matches(entry)) return;
      const dock = getExtDialogDock();
      if (!dock) return;
      entry.owner = sessionState.captureSelection();
      if (entry.el.parentNode !== dock) dock.appendChild(entry.el);
      entry.el.classList.toggle("minimized", entry.minimized);
      updateExtDialogDock();
    }
    function setExtDialogMinimized(requestId, minimized) {
      const entry = openExtDialogs.get(requestId);
      if (!entry) return;
      entry.minimized = minimized;
      entry.el.classList.toggle("minimized", minimized);
      updateExtDialogDock();
      if (!minimized) {
        entry.el.querySelector(".ext-ui-ask-option, .ext-ui-dialog-option, .ext-ui-dialog-input, .ext-ui-dialog-editor")?.focus();
      }
    }
    function sendExtDialogResponse(dialogKey, response, card) {
      const entry = openExtDialogs.get(dialogKey);
      if (!entry || !currentCard(dialogKey, card)) return;
      const host = options2.host(entry.hostId);
      if (!host || host.base !== entry.endpoint.base) return;
      const owner = entry.owner;
      void sendJson(options2.request, Object.freeze({ ...host }), `/api/sessions/${encodeURIComponent(entry.sessionId)}/ui-response`, { requestId: entry.requestId, ...response }).catch((error) => {
        if (!disposed && sessionState.ownsSelection(owner)) options2.status("Dialog response failed: " + (error instanceof Error ? error.message : String(error)), "error");
      });
      dismissExtDialog(dialogKey);
    }
    function dismissExtDialog(requestId) {
      const entry = openExtDialogs.get(requestId);
      if (!entry) return;
      entry.events.abort();
      entry.el.remove();
      openExtDialogs.delete(requestId);
      updateExtDialogDock();
    }
    function buildExtDialogCard(requestId, events, { title, bodyHtml, footerHtml, collapsedLabel, onClose }) {
      const card = document2.createElement("div");
      card.className = "ext-ui-dialog-modal ext-ui-docked-dialog";
      card.innerHTML = `
    <div class="ext-ui-dialog-head">
      <div class="ext-ui-dialog-title">${escapeHtml(title)}</div>
      <button class="ext-ui-dialog-min" title="Background \u2014 keep the composer usable and answer later">\u2013</button>
      <button class="ext-ui-dialog-close" title="Dismiss (cancel)">\xD7</button>
    </div>
    <div class="ext-ui-dialog-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="ext-ui-dialog-foot">${footerHtml}</div>` : ""}
    <div class="ext-ui-dialog-collapsed-label">${escapeHtml(collapsedLabel)}</div>`;
      card.querySelector(".ext-ui-dialog-min").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentCard(requestId, card)) return;
        setExtDialogMinimized(requestId, true);
      }, { signal: events.signal });
      card.querySelector(".ext-ui-dialog-close").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentCard(requestId, card)) return;
        onClose();
      }, { signal: events.signal });
      card.addEventListener("click", () => {
        if (currentCard(requestId, card) && openExtDialogs.get(requestId)?.minimized) setExtDialogMinimized(requestId, false);
      }, { signal: events.signal });
      return card;
    }
    function showExtAskDialog(req, session) {
      if (!req.id) return;
      const { id: sessionId, host: hostId } = session;
      const endpoint = options2.host(hostId);
      if (disposed || !endpoint) return;
      const dialogKey = extDialogKey(req.id, sessionId, hostId);
      const previous = openExtDialogs.get(dialogKey);
      if (previous && previous.endpoint.base !== endpoint.base) dismissExtDialog(dialogKey);
      const existing = openExtDialogs.get(dialogKey);
      if (existing) {
        dockExtDialog(existing);
        return;
      }
      const duplicate = findDuplicateExtDialog(req, session);
      if (duplicate) {
        dockExtDialog(duplicate);
        return;
      }
      const questions = req.questions;
      if (!questions.length) {
        options2.toast("Ask dialog had no valid questions", "warning");
        return;
      }
      const events = new AbortController();
      const card = buildExtDialogCard(dialogKey, events, {
        title: questions.length === 1 ? "Question" : `${questions.length} questions`,
        collapsedLabel: questions.length === 1 ? `Question pending: ${questions[0].question || ""}` : `${questions.length} questions pending \u2014 click to answer`,
        onClose: () => sendExtDialogResponse(dialogKey, { cancelled: true }, card),
        bodyHtml: `
    <div class="ext-ui-ask-questions">
      ${questions.map((question, questionIndex) => {
          const options3 = question.options;
          return `<section class="ext-ui-ask-question" data-question-index="${questionIndex}">
          ${question.header ? `<div class="ext-ui-ask-header">${escapeHtml(question.header)}</div>` : ""}
          <div class="ext-ui-ask-prompt">${escapeHtml(question.question || "")}</div>
          <div class="ext-ui-dialog-options">
            ${options3.map((option, optionIndex) => {
            const normalized = option;
            const recommended = question.recommended === optionIndex;
            return `<button type="button" class="ext-ui-dialog-option ext-ui-ask-option${recommended ? " recommended" : ""}"
                data-question-index="${questionIndex}" data-option-index="${optionIndex}" aria-pressed="false">
                <span class="ext-ui-ask-marker">${question.multi ? "\u2610" : "\u25CB"}</span>
                <span class="ext-ui-ask-option-copy">
                  <span class="ext-ui-ask-option-label">${escapeHtml(normalized.label || "")}${recommended ? ' <span class="ext-ui-ask-recommended">Recommended</span>' : ""}</span>
                  ${normalized.description ? `<span class="ext-ui-ask-option-description">${escapeHtml(normalized.description)}</span>` : ""}
                  ${normalized.preview ? `<pre class="ext-ui-ask-option-preview">${escapeHtml(normalized.preview)}</pre>` : ""}
                </span>
              </button>`;
          }).join("")}
          </div>
          <input class="ext-ui-dialog-input ext-ui-ask-custom" data-question-index="${questionIndex}"
            type="text" placeholder="Other (type your own)">
          <input class="ext-ui-dialog-input ext-ui-ask-note" data-question-index="${questionIndex}"
            type="text" placeholder="Optional note">
          <div class="ext-ui-ask-error" hidden>Choose an option or enter your own answer.</div>
        </section>`;
        }).join("")}
    </div>
    `,
        footerHtml: `
    <div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn" data-action="chat">Chat about this</button>
      <button class="ext-ui-dialog-btn primary" data-action="submit-ask">Submit</button>
    </div>`
      });
      card.classList.add("ext-ui-ask-modal");
      const selections = questions.map(() => /* @__PURE__ */ new Set());
      card.querySelectorAll(".ext-ui-ask-option").forEach((button) => {
        button.addEventListener("click", () => {
          if (!currentCard(dialogKey, card)) return;
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
          card.querySelectorAll(`.ext-ui-ask-option[data-question-index="${questionIndex}"]`).forEach((candidate) => {
            const index = Number(candidate.dataset.optionIndex);
            const active = selected.has(index);
            candidate.classList.toggle("selected", active);
            candidate.setAttribute("aria-pressed", active ? "true" : "false");
            candidate.querySelector(".ext-ui-ask-marker").textContent = question.multi ? active ? "\u2611" : "\u2610" : active ? "\u25CF" : "\u25CB";
          });
          const custom = card.querySelector(`.ext-ui-ask-custom[data-question-index="${questionIndex}"]`);
          if (!question.multi && custom) custom.value = "";
          card.querySelector(`.ext-ui-ask-question[data-question-index="${questionIndex}"] .ext-ui-ask-error`)?.setAttribute("hidden", "");
        }, { signal: events.signal });
      });
      card.querySelectorAll(".ext-ui-ask-custom").forEach((input) => {
        input.addEventListener("input", () => {
          if (!currentCard(dialogKey, card)) return;
          const questionIndex = Number(input.dataset.questionIndex);
          const question = questions[questionIndex];
          if (!question || question.multi || !input.value.trim()) return;
          selections[questionIndex].clear();
          card.querySelectorAll(`.ext-ui-ask-option[data-question-index="${questionIndex}"]`).forEach((candidate) => {
            candidate.classList.remove("selected");
            candidate.setAttribute("aria-pressed", "false");
            candidate.querySelector(".ext-ui-ask-marker").textContent = "\u25CB";
          });
        }, { signal: events.signal });
      });
      card.querySelector('[data-action="chat"]').addEventListener("click", () => {
        sendExtDialogResponse(dialogKey, { value: { kind: "chat" } }, card);
      }, { signal: events.signal });
      card.querySelector('[data-action="submit-ask"]').addEventListener("click", () => {
        if (!currentCard(dialogKey, card)) return;
        const invalidSections = [];
        const results = questions.map((question, questionIndex) => {
          const options3 = question.options;
          const customField = card.querySelector(`.ext-ui-ask-custom[data-question-index="${questionIndex}"]`);
          const noteField = card.querySelector(`.ext-ui-ask-note[data-question-index="${questionIndex}"]`);
          const customInput = customField?.value.trim() || void 0;
          const note = noteField?.value.trim() || void 0;
          const selectedOptions = [...selections[questionIndex]].sort((a, b) => a - b).map((index) => {
            const option = options3[index];
            return option?.label;
          }).filter((label) => typeof label === "string");
          if (!question.multi && selectedOptions.length === 0 && customInput === void 0) {
            const section = card.querySelector(`.ext-ui-ask-question[data-question-index="${questionIndex}"]`);
            section?.querySelector(".ext-ui-ask-error")?.removeAttribute("hidden");
            if (section) invalidSections.push(section);
          }
          return {
            id: question.id,
            question: question.question || "",
            options: options3.map((option) => option.label),
            multi: question.multi === true,
            selectedOptions,
            ...customInput !== void 0 ? { customInput } : {},
            ...note !== void 0 ? { note } : {}
          };
        });
        const invalid2 = invalidSections[0];
        if (invalid2) {
          invalid2.scrollIntoView({ block: "nearest" });
          invalid2.querySelector(".ext-ui-ask-option, .ext-ui-ask-custom")?.focus();
          return;
        }
        sendExtDialogResponse(dialogKey, { value: { kind: "submit", results } }, card);
      }, { signal: events.signal });
      const entry = { el: card, events, endpoint: Object.freeze({ ...endpoint }), owner: sessionState.captureSelection(), sessionId, hostId, sessionKey: sessionKey(hostId, sessionId), requestId: req.id, minimized: false, sig: extDialogSig(req) };
      openExtDialogs.set(dialogKey, entry);
      dockExtDialog(entry);
      card.querySelector(".ext-ui-ask-option, .ext-ui-ask-custom")?.focus();
    }
    function showExtDialog(req, session) {
      if (!req.id) return;
      const { id: sessionId, host: hostId } = session;
      const endpoint = options2.host(hostId);
      if (disposed || !endpoint) return;
      const dialogKey = extDialogKey(req.id, sessionId, hostId);
      const previous = openExtDialogs.get(dialogKey);
      if (previous && previous.endpoint.base !== endpoint.base) dismissExtDialog(dialogKey);
      const existing = openExtDialogs.get(dialogKey);
      if (existing) {
        dockExtDialog(existing);
        return;
      }
      const duplicate = findDuplicateExtDialog(req, session);
      if (duplicate) {
        dockExtDialog(duplicate);
        return;
      }
      let bodyHtml = "";
      if (req.message) bodyHtml += `<div class="ext-ui-dialog-message">${escapeHtml(req.message)}</div>`;
      if (req.method === "select") {
        bodyHtml += '<div class="ext-ui-dialog-options">' + req.options.map((opt, i) => {
          const label = opt.label;
          const description = opt.description ? `<span class="ext-ui-ask-option-description">${escapeHtml(opt.description)}</span>` : "";
          return `<button class="ext-ui-dialog-option" data-option-index="${i}">
          <span class="ext-ui-ask-option-label">${escapeHtml(label)}</span>${description}
        </button>`;
        }).join("") + "</div>";
      } else if (req.method === "confirm") {
        bodyHtml += `<div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn primary" data-action="yes">Yes</button>
      <button class="ext-ui-dialog-btn" data-action="no">No</button>
    </div>`;
      } else if (req.method === "input") {
        bodyHtml += `<input class="ext-ui-dialog-input" type="text" placeholder="${escapeHtml(req.placeholder || "")}">
    <div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn primary" data-action="submit">Submit</button>
      <button class="ext-ui-dialog-btn" data-action="cancel">Cancel</button>
    </div>`;
      } else if (req.method === "editor") {
        bodyHtml += `<textarea class="ext-ui-dialog-editor" rows="8">${escapeHtml(req.prefill || "")}</textarea>
    <div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn primary" data-action="submit">Submit</button>
      <button class="ext-ui-dialog-btn" data-action="cancel">Cancel</button>
    </div>`;
      }
      const titles = { select: "Select", confirm: "Confirm", input: "Input", editor: "Editor" };
      const title = req.title || titles[req.method] || "Dialog";
      const events = new AbortController();
      const card = buildExtDialogCard(dialogKey, events, {
        title,
        bodyHtml,
        collapsedLabel: `${title} pending \u2014 click to answer`,
        onClose: () => sendExtDialogResponse(dialogKey, { cancelled: true }, card)
      });
      card.querySelectorAll(".ext-ui-dialog-option").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!currentCard(dialogKey, card)) return;
          const option = req.options[Number(btn.dataset.optionIndex)];
          sendExtDialogResponse(dialogKey, { value: option?.label || "" }, card);
        }, { signal: events.signal });
      });
      card.querySelectorAll(".ext-ui-dialog-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!currentCard(dialogKey, card)) return;
          const action = btn.dataset.action;
          if (action === "yes") sendExtDialogResponse(dialogKey, { confirmed: true }, card);
          else if (action === "no") sendExtDialogResponse(dialogKey, { confirmed: false }, card);
          else if (action === "cancel") sendExtDialogResponse(dialogKey, { cancelled: true }, card);
          else if (action === "submit") {
            const field2 = card.querySelector(".ext-ui-dialog-input, .ext-ui-dialog-editor");
            sendExtDialogResponse(dialogKey, { value: field2 ? field2.value : "" }, card);
          }
        }, { signal: events.signal });
      });
      const entry = { el: card, events, endpoint: Object.freeze({ ...endpoint }), owner: sessionState.captureSelection(), sessionId, hostId, sessionKey: sessionKey(hostId, sessionId), requestId: req.id, minimized: false, sig: extDialogSig(req) };
      openExtDialogs.set(dialogKey, entry);
      dockExtDialog(entry);
      const field = card.querySelector(".ext-ui-dialog-input, .ext-ui-dialog-editor");
      if (field) field.focus();
    }
    function removeSession(session) {
      const key = sessionKey(session.host, session.id);
      for (const [id, entry] of openExtDialogs) if (entry.sessionKey === key) dismissExtDialog(id);
    }
    return {
      show(request, session) {
        if (disposed) return;
        if (request.method === "ask") showExtAskDialog(request, session);
        else showExtDialog(request, session);
      },
      detach() {
        for (const entry of openExtDialogs.values()) {
          entry.el.remove();
          entry.owner = null;
        }
        updateExtDialogDock();
      },
      resolved(id, session) {
        if (typeof id === "string") dismissExtDialog(extDialogKey(id, session.id, session.host));
      },
      reconcile(value, session) {
        if (disposed || !record8(value) || !Array.isArray(value.dialogs)) return;
        const pending = new Set(value.dialogs.filter((id) => typeof id === "string")), key = sessionKey(session.host, session.id);
        for (const [id, entry] of openExtDialogs) if (entry.sessionKey === key && !pending.has(entry.requestId)) dismissExtDialog(id);
      },
      removeSession,
      dispose() {
        disposed = true;
        for (const id of [...openExtDialogs.keys()]) dismissExtDialog(id);
      }
    };
  }

  // src/browser/extension-display.ts
  function createExtensionDisplay(options2) {
    const { document: document2, sessionState, storage } = options2;
    const widgets = /* @__PURE__ */ new Map(), statuses = /* @__PURE__ */ new Map(), collapsed = /* @__PURE__ */ new Map();
    const toasts = /* @__PURE__ */ new Set(), toastTimers = /* @__PURE__ */ new Set(), events = new AbortController();
    let disposed = false, preferenceApplied = false, observer = null;
    const cancel = (timer) => {
      if (timer !== null) clearTimeout(timer);
    };
    const current = (owner) => !disposed && sessionState.ownsSelection(owner);
    function later(callback, delay) {
      const timer = setTimeout(() => {
        toastTimers.delete(timer);
        if (!disposed) callback();
      }, delay);
      toastTimers.add(timer);
      return timer;
    }
    function toast(message3, type) {
      if (disposed) return;
      let root = document2.getElementById("extUiToasts");
      if (!root) {
        root = document2.createElement("div");
        root.id = "extUiToasts";
        root.className = "ext-ui-toasts";
        document2.body.append(root);
      }
      const node = document2.createElement("div");
      node.className = "ext-ui-toast " + type;
      const icons = { info: "\u2139", warning: "\u26A0", error: "\u2716" };
      node.innerHTML = `<span class="ext-ui-toast-icon">${icons[type]}</span><span class="ext-ui-toast-body">${escapeHtml(message3)}</span><button class="ext-ui-toast-close" title="Dismiss">\xD7</button>`;
      toasts.add(node);
      root.append(node);
      let hiding = false;
      const hide = () => {
        if (disposed || hiding || !toasts.has(node)) return;
        hiding = true;
        node.classList.add("hiding");
        later(() => {
          node.remove();
          toasts.delete(node);
        }, 200);
      };
      node.querySelector("button").addEventListener("click", hide, { signal: events.signal });
      if (type === "info") later(hide, 6e3);
    }
    function widget(key, lines, placement) {
      if (disposed) return;
      let entry = widgets.get(key);
      if (entry && !entry.el.isConnected) {
        cancel(entry.timer);
        entry.events.abort();
        widgets.delete(key);
        entry = void 0;
      }
      if (!lines.length) {
        if (!entry) return;
        cancel(entry.timer);
        const retained = entry;
        retained.timer = setTimeout(() => {
          if (disposed || widgets.get(key) !== retained) return;
          retained.el.classList.add("hidden");
          retained.timer = setTimeout(() => {
            if (disposed || widgets.get(key) !== retained) return;
            retained.timer = null;
            retained.events.abort();
            retained.el.remove();
            widgets.delete(key);
          }, 200);
        }, 500);
        return;
      }
      if (entry) {
        cancel(entry.timer);
        entry.timer = null;
      }
      const owner = sessionState.captureSelection(), collapsedKey = sessionRefKey(owner) + "|" + key;
      if (!entry) {
        const el = document2.createElement("div");
        el.className = "ext-ui-widget";
        el.dataset.widgetKey = key;
        entry = { el, collapsed: collapsed.get(collapsedKey) || false, timer: null, events: new AbortController(), owner };
        el.classList.toggle("collapsed", entry.collapsed);
        el.innerHTML = `<div class="ext-ui-widget-header"><span class="ext-ui-widget-label">${escapeHtml(key)}</span><span class="ext-ui-widget-toggle">\u25BC</span></div><pre class="ext-ui-widget-body"></pre>`;
        const retained = entry;
        el.querySelector(".ext-ui-widget-header").addEventListener("click", () => {
          if (!current(retained.owner) || widgets.get(key) !== retained || !el.isConnected) return;
          retained.collapsed = el.classList.toggle("collapsed");
          collapsed.set(collapsedKey, retained.collapsed);
        }, { signal: entry.events.signal });
        const input = document2.querySelector(".input-area"), textarea = document2.getElementById("promptInput");
        if (placement === "belowEditor" && input && textarea) input.insertBefore(el, textarea.nextSibling);
        else if (input?.parentNode) input.parentNode.insertBefore(el, input);
        else document2.getElementById("messages")?.insertAdjacentElement("beforebegin", el);
        widgets.set(key, entry);
      }
      entry.el.classList.remove("hidden");
      const body = entry.el.querySelector(".ext-ui-widget-body"), text17 = lines.join("\n");
      if (body.textContent !== text17) body.textContent = text17;
    }
    function measure() {
      if (disposed) return;
      const row = document2.getElementById("extUiStatuses"), items = document2.getElementById("extUiStatusItems"), toggle = document2.getElementById("extUiStatusToggle");
      if (!row || !items || !toggle) return;
      const clipped = [...items.children].some((el) => el.scrollWidth > el.clientWidth + 1);
      toggle.style.display = !row.classList.contains("collapsed") || clipped ? "" : "none";
    }
    function sync() {
      if (disposed) return;
      const row = document2.getElementById("extUiStatuses");
      if (!row) return;
      if (!preferenceApplied) {
        preferenceApplied = true;
        let open = false;
        try {
          open = storage.getItem("pi-dish-ext-status-open") === "1";
        } catch {
        }
        if (open) toggleStatus();
      }
      const items = document2.getElementById("extUiStatusItems");
      row.style.display = items?.children.length ? "" : "none";
      measure();
      if (!observer && items && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(items);
      }
    }
    function toggleStatus() {
      if (disposed) return;
      const row = document2.getElementById("extUiStatuses");
      if (!row) return;
      const isCollapsed = row.classList.toggle("collapsed"), toggle = document2.getElementById("extUiStatusToggle");
      if (toggle) {
        toggle.setAttribute("aria-expanded", String(!isCollapsed));
        toggle.title = isCollapsed ? "Show full status" : "Collapse status";
      }
      try {
        storage.setItem("pi-dish-ext-status-open", isCollapsed ? "0" : "1");
      } catch {
      }
      sync();
    }
    document2.getElementById("extUiStatusToggle")?.addEventListener("click", toggleStatus, { signal: events.signal });
    function status(key, text17) {
      if (disposed) return;
      const items = document2.getElementById("extUiStatusItems");
      if (!items) return;
      let entry = statuses.get(key);
      if (entry && !entry.el.isConnected) {
        cancel(entry.timer);
        statuses.delete(key);
        entry = void 0;
      }
      if (!text17) {
        if (!entry) {
          sync();
          return;
        }
        cancel(entry.timer);
        const retained = entry;
        retained.timer = setTimeout(() => {
          if (disposed || statuses.get(key) !== retained) return;
          retained.el.remove();
          statuses.delete(key);
          sync();
        }, 500);
        return;
      }
      if (entry) {
        cancel(entry.timer);
        entry.timer = null;
      } else {
        const el = document2.createElement("span");
        el.className = "ext-ui-status-badge";
        el.dataset.statusKey = key;
        items.append(el);
        entry = { el, timer: null };
        statuses.set(key, entry);
      }
      if (entry.el.textContent !== text17) entry.el.textContent = text17;
      const title = `${text17}
(status from ${key})`;
      if (entry.el.title !== title) entry.el.title = title;
      sync();
    }
    function clear() {
      for (const entry of widgets.values()) {
        cancel(entry.timer);
        entry.events.abort();
        entry.el.remove();
      }
      widgets.clear();
      for (const entry of statuses.values()) {
        cancel(entry.timer);
        entry.el.remove();
      }
      statuses.clear();
      sync();
    }
    return {
      toast,
      widget,
      status,
      clear,
      toggleStatus,
      dispose() {
        clear();
        disposed = true;
        events.abort();
        observer?.disconnect();
        observer = null;
        for (const timer of toastTimers) clearTimeout(timer);
        toastTimers.clear();
        for (const node of toasts) node.remove();
        toasts.clear();
        collapsed.clear();
      }
    };
  }

  // src/browser/extension-ui-data.ts
  var text13 = (value) => typeof value === "string" ? stripAnsi(value) : "";
  function options(value) {
    return Array.isArray(value) ? value.map((row) => typeof row === "string" ? { label: text13(row), description: "", preview: "" } : { label: record8(row) ? text13(row.label) : "", description: record8(row) ? text13(row.description) : "", preview: record8(row) ? text13(row.preview) : "" }) : [];
  }
  function decodeExtensionRequest(value) {
    if (!record8(value) || typeof value.method !== "string") return null;
    return {
      id: typeof value.id === "string" ? value.id : "",
      method: value.method,
      title: text13(value.title),
      message: text13(value.message),
      text: text13(value.text),
      prefill: text13(value.prefill),
      placeholder: text13(value.placeholder),
      widgetKey: typeof value.widgetKey === "string" && value.widgetKey ? value.widgetKey : "default",
      widgetLines: Array.isArray(value.widgetLines) ? value.widgetLines.map(text13) : [],
      widgetPlacement: text13(value.widgetPlacement),
      statusKey: typeof value.statusKey === "string" && value.statusKey ? value.statusKey : "default",
      statusText: text13(value.statusText),
      notifyType: value.notifyType === "warning" || value.notifyType === "error" ? value.notifyType : "info",
      options: options(value.options),
      questions: Array.isArray(value.questions) ? value.questions.flatMap((row) => {
        if (!record8(row) || typeof row.id !== "string") return [];
        return [{
          id: row.id,
          question: text13(row.question),
          header: text13(row.header),
          multi: row.multi === true,
          recommended: finite2(row.recommended) && Number.isInteger(row.recommended) ? row.recommended : null,
          options: options(row.options)
        }];
      }) : []
    };
  }

  // src/browser/extension-ui.ts
  function createExtensionUI(options2) {
    const { document: document2, sessionState } = options2;
    const display = createExtensionDisplay(options2), dialogs = createExtensionDialogs({ ...options2, toast: display.toast });
    let disposed = false;
    function handle(value, session) {
      const selected = sessionState.currentSession;
      if (disposed || !selected || selected.id !== session.id || (selected.host || null) !== session.host) return;
      const request = decodeExtensionRequest(value);
      if (!request) return;
      switch (request.method) {
        case "notify":
          display.toast(request.message, request.notifyType);
          break;
        case "setWidget":
          display.widget(request.widgetKey, request.widgetLines, request.widgetPlacement);
          break;
        case "setStatus":
          display.status(request.statusKey, request.statusText);
          break;
        case "setTitle":
          document2.title = request.title || "pi-dish";
          break;
        case "set_editor_text": {
          const input = document2.getElementById("promptInput");
          if (input) {
            input.value = request.text;
            input.dispatchEvent(new Event("input"));
          }
          break;
        }
        case "select":
        case "confirm":
        case "input":
        case "editor":
        case "ask":
          dialogs.show(request, session);
          break;
        default:
          display.toast(`[${request.method}] ${JSON.stringify(request).slice(0, 200)}`, "info");
      }
    }
    return {
      handle,
      clear() {
        if (!disposed) {
          display.clear();
          dialogs.detach();
        }
      },
      resolve: dialogs.resolved,
      reconcile: dialogs.reconcile,
      end: dialogs.removeSession,
      dispose() {
        disposed = true;
        display.dispose();
        dialogs.dispose();
      }
    };
  }

  // src/browser/file-view-data.ts
  var text14 = (v) => typeof v === "string" ? v : "";
  var number6 = (v) => finite2(v) ? v : 0;
  function decodeFilePreview(v) {
    if (!record8(v) || typeof v.path !== "string" || !v.path) throw new Error("Invalid file preview");
    return {
      path: v.path,
      relPath: text14(v.relPath),
      content: text14(v.content),
      size: number6(v.size),
      mtime: number6(v.mtime),
      truncated: v.truncated === true,
      image: record8(v.image) ? { url: text14(v.image.url), mimeType: text14(v.image.mimeType), data: text14(v.image.data) } : null
    };
  }
  function decodeDiffView(v) {
    if (!record8(v) || !Array.isArray(v.repos)) throw new Error("Invalid diff response");
    return { root: text14(v.root), gitAvailable: v.gitAvailable === true, snapshotId: text14(v.snapshotId), repos: v.repos.flatMap((r) => record8(r) && typeof r.path === "string" ? [{
      path: r.path,
      branch: text14(r.branch),
      ahead: number6(r.ahead),
      behind: number6(r.behind),
      additions: number6(r.additions),
      deletions: number6(r.deletions),
      error: text14(r.error),
      moreUntracked: number6(r.moreUntracked),
      files: Array.isArray(r.files) ? r.files.flatMap((f) => record8(f) && typeof f.path === "string" ? [{ path: f.path, oldPath: text14(f.oldPath), status: text14(f.status), additions: number6(f.additions), deletions: number6(f.deletions), binary: f.binary === true, truncated: f.truncated === true, patch: text14(f.patch), patchDeferred: f.patchDeferred === true }] : []) : []
    }] : []) };
  }
  function decodeDiffPatch(v) {
    const p = record8(v) ? v : {};
    return { patch: text14(p.patch), stale: p.stale === true, truncated: p.truncated === true };
  }

  // src/browser/file-view-render.ts
  function renderDiffViewHtml(data) {
    if (!data.gitAvailable) return '<div class="diff-empty">git is not available on the server</div>';
    if (!data.repos.length) return `<div class="diff-empty">No git repositories under this session's cwd</div>`;
    const dirty = data.repos.filter((r) => r.files.length > 0 || r.error);
    const clean = data.repos.filter((r) => r.files.length === 0 && !r.error);
    const totalFiles = dirty.reduce((n, r) => n + r.files.length, 0);
    const openAttr = totalFiles <= 6 ? " open" : "";
    let html = "";
    if (!dirty.length) html += '<div class="diff-empty">All repositories are clean \u2713</div>';
    for (const repo of dirty) {
      const ab = (repo.ahead ? ` <span class="diff-repo-ab" title="Commits ahead of upstream">\u2191${repo.ahead}</span>` : "") + (repo.behind ? ` <span class="diff-repo-ab" title="Commits behind upstream">\u2193${repo.behind}</span>` : "");
      html += `<section class="diff-repo"><div class="diff-repo-header"><span class="diff-repo-path">${escapeHtml(repo.path)}</span>` + (repo.branch ? `<span class="diff-repo-branch">${escapeHtml(repo.branch)}</span>` : "") + ab + `<span class="diff-repo-stat"><span class="diff-plus">+${repo.additions}</span> <span class="diff-minus">\u2212${repo.deletions}</span></span></div>`;
      if (repo.error) html += `<div class="diff-repo-error">\u26A0 ${escapeHtml(repo.error)}</div>`;
      for (const f of repo.files) {
        const name = f.oldPath ? `${escapeHtml(f.oldPath)} \u2192 ${escapeHtml(f.path)}` : escapeHtml(f.path);
        const counts2 = f.binary ? '<span class="diff-file-note">binary</span>' : `<span class="diff-plus">+${f.additions}</span> <span class="diff-minus">\u2212${f.deletions}</span>`;
        const patchAttrs = `data-repo="${escapeHtml(repo.path)}" data-path="${escapeHtml(f.path)}" data-old-path="${escapeHtml(f.oldPath || "")}" data-snapshot="${escapeHtml(data.snapshotId || "")}"`;
        const patchHtml = f.patch ? `<div class="diff-patch" ${patchAttrs}>${renderDiffHtml(f.patch)}${f.truncated ? '<div class="diff-file-note">\u2026 patch truncated</div>' : ""}</div>` : f.patchDeferred ? `<div class="diff-patch" ${patchAttrs} data-deferred="1"><div class="loading">Loading patch\u2026</div></div>` : `<div class="diff-file-note diff-patch-missing">${f.binary ? "Binary file" : f.truncated ? "Too large to preview" : "No patch available"}</div>`;
        html += `<details class="diff-file"${f.patch ? openAttr : ""}><summary><span class="diff-status diff-status-${diffStatusClass(f.status)}">${escapeHtml(f.status)}</span><span class="diff-file-path">${name}</span><span class="diff-file-counts">${counts2}</span></summary>` + patchHtml + `</details>`;
      }
      if (repo.moreUntracked) {
        html += `<div class="diff-file-note">\u2026 and ${repo.moreUntracked} more untracked files</div>`;
      }
      html += "</section>";
    }
    if (clean.length) {
      const names = clean.map((r) => escapeHtml(r.path) + (r.ahead ? ` <span class="diff-repo-ab">\u2191${r.ahead}</span>` : "")).join(", ");
      html += `<div class="diff-clean">clean: ${names}</div>`;
    }
    return html;
  }

  // src/browser/file-views.ts
  function createFileViews(options2) {
    const { document: document2, sessionState } = options2;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing file view element: " + id);
      return value;
    };
    const errorText = (e) => e instanceof Error ? e.message : String(e);
    const file = { owner: null, endpoint: null, sessionId: null, generation: 0, raw: null, path: null, relPath: null };
    const diff = { owner: null, endpoint: null, sessionId: null, generation: 0 };
    let disposed = false, pageSequence = 0, copySequence = 0;
    let displayedPage = null;
    let fileEvents = new AbortController(), pageEvents = new AbortController(), diffEvents = new AbortController();
    const timers = /* @__PURE__ */ new Set();
    const patchOwners = /* @__PURE__ */ new WeakMap();
    function isOpen(kind) {
      return !disposed && element("sessionView").classList.contains(kind + "-open");
    }
    function owns(view, kind, id, generation) {
      if (disposed || !view.owner || !view.endpoint || view.sessionId !== id || view.generation !== generation || !isOpen(kind) || !sessionState.ownsSelection(view.owner)) return false;
      const current = options2.host(view.owner.host);
      return !!current && current.base === view.endpoint.base;
    }
    const ownsFile = (id, generation) => owns(file, "file", id, generation);
    const ownsDiff = (id, generation) => owns(diff, "diff", id, generation);
    function capture(view) {
      const owner = sessionState.captureSelection();
      if (!owner) return null;
      const endpoint = options2.host(owner.host);
      if (!endpoint) return null;
      view.owner = owner;
      view.sessionId = owner.id;
      view.endpoint = Object.freeze({ ...endpoint });
      view.generation++;
      return { owner, endpoint: view.endpoint, id: owner.id, generation: view.generation };
    }
    function request(owner, endpoint, path, init) {
      const current = options2.host(owner.host);
      if (disposed || !current || current.base !== endpoint.base) return Promise.reject(new Error("Host connection changed; reopen this view"));
      return options2.request({ ...endpoint, token: current.token }, path, init);
    }
    async function json(response) {
      const value = await response.json().catch(() => null);
      if (!response.ok) throw new Error(record8(value) && typeof value.error === "string" ? value.error : `HTTP ${response.status}`);
      return value;
    }
    function closeFile() {
      file.generation++;
      file.owner = null;
      file.endpoint = null;
      file.sessionId = null;
      file.raw = null;
      file.path = null;
      file.relPath = null;
      fileEvents.abort();
      pageEvents.abort();
      pageSequence++;
      copySequence++;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      element("sessionView").classList.remove("file-open");
      element("fileViewBody").innerHTML = "";
      const raw = element("fileViewRaw");
      raw.style.display = "none";
      raw.removeAttribute("href");
      const publish2 = element("fileViewPublish");
      publish2.disabled = false;
      publish2.style.display = "none";
      element("fileViewCopy").textContent = "\u29C9";
      clearPage();
      options2.closeComments();
      options2.clearComments();
    }
    function closeDiff() {
      diff.generation++;
      diff.owner = null;
      diff.endpoint = null;
      diff.sessionId = null;
      diffEvents.abort();
      element("sessionView").classList.remove("diff-open");
      element("btnDiff").classList.remove("active");
      element("diffViewBody").innerHTML = "";
      options2.closeComments();
      options2.clearComments();
    }
    function clearPage() {
      displayedPage = null;
      pageEvents.abort();
      const row = element("fileViewPage");
      row.style.display = "none";
      row.innerHTML = "";
    }
    function renderPage(page, id, generation) {
      if (!ownsFile(id, generation) || !file.owner || !file.endpoint) return;
      clearPage();
      displayedPage = page;
      pageEvents = new AbortController();
      const events = pageEvents, owner = file.owner, endpoint = file.endpoint, sequence = ++pageSequence;
      const current = () => !events.signal.aborted && sequence === pageSequence && ownsFile(id, generation);
      const link = page.url || document2.defaultView.location.origin + page.path, row = element("fileViewPage");
      row.style.display = "";
      row.innerHTML = `Published: <button type="button" class="stats-copy stats-share-link" title="Click to copy">${escapeHtml(link)}</button><button type="button" class="btn-small btn-danger" id="filePageRevoke">Unpublish</button>`;
      row.querySelector(".stats-copy").addEventListener("click", () => {
        if (!current()) return;
        void options2.copy(link).then(() => {
          if (current()) options2.status("Page link copied");
        }, () => {
          if (current()) options2.status("Copy failed (clipboard blocked)", "error");
        });
      }, { signal: events.signal });
      const revoke = row.querySelector("#filePageRevoke");
      revoke.addEventListener("click", () => {
        if (!current() || revoke.disabled) return;
        revoke.disabled = true;
        void request(owner, endpoint, `/api/pages/${encodeURIComponent(page.token)}`, { method: "DELETE" }).then(json).then(() => {
          if (!current()) return;
          pageSequence++;
          clearPage();
          options2.refreshArtifacts(owner);
        }).catch((e) => {
          if (current()) {
            revoke.disabled = false;
            options2.status("Failed to unpublish: " + errorText(e), "error");
          }
        });
      }, { signal: events.signal });
    }
    async function publish() {
      const { owner, endpoint, sessionId: id, generation, path } = file;
      const button = element("fileViewPublish");
      if (!owner || !endpoint || !id || !path || !ownsFile(id, generation) || button.disabled) return;
      const previousPage = displayedPage;
      const sequence = ++pageSequence;
      pageEvents.abort();
      button.disabled = true;
      const current = () => ownsFile(id, generation) && pageSequence === sequence;
      try {
        const value = await json(await request(owner, endpoint, "/api/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, sessionId: id, title: path.split("/").pop(), renderer: "file" }) }));
        if (!current()) return;
        const page = decodePublishedPages([value])[0];
        if (!page) throw new Error("Invalid published page");
        button.disabled = false;
        renderPage(page, id, generation);
        options2.refreshArtifacts(owner);
      } catch (e) {
        if (current()) {
          button.disabled = false;
          if (previousPage) renderPage(previousPage, id, generation);
          options2.status("Publish failed: " + errorText(e), "error");
        }
      }
    }
    function copy(button) {
      const { sessionId: id, generation, raw } = file;
      if (raw === null || !ownsFile(id, generation) || !button.isConnected || !element("fileView").contains(button)) return;
      const sequence = ++copySequence;
      const current = () => ownsFile(id, generation) && sequence === copySequence && button.isConnected;
      void options2.copy(raw).then(() => {
        if (!current()) return;
        button.textContent = "\u2713";
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (current()) button.textContent = "\u29C9";
        }, 1200);
        timers.add(timer);
      }, () => {
        if (current()) options2.status("Copy failed (clipboard blocked)", "error");
      });
    }
    async function openFile(mention) {
      if (disposed || !sessionState.currentSession) return;
      closeFile();
      closeDiff();
      const captured = capture(file);
      if (!captured) return;
      const { owner, endpoint, id, generation } = captured;
      element("sessionView").classList.add("file-open");
      fileEvents = new AbortController();
      element("fileViewPublish").addEventListener("click", () => {
        if (ownsFile(id, generation)) void publish();
      }, { signal: fileEvents.signal });
      const copyButton = element("fileViewCopy");
      copyButton.addEventListener("click", () => {
        if (ownsFile(id, generation)) copy(copyButton);
      }, { signal: fileEvents.signal });
      const body = element("fileViewBody"), title = element("fileViewTitle"), path = element("fileViewPath"), rawLink = element("fileViewRaw");
      title.textContent = mention.replace(/:\d+(?::\d+)?$/, "").split("/").pop() || "";
      path.textContent = "";
      path.title = "";
      body.innerHTML = '<div class="loading">Loading\u2026</div>';
      try {
        const data = decodeFilePreview(await json(await request(owner, endpoint, `/api/sessions/${encodeURIComponent(id)}/file?path=${encodeURIComponent(mention)}`)));
        if (!ownsFile(id, generation)) return;
        title.textContent = data.path.split("/").pop() || "";
        file.path = data.path;
        file.relPath = data.relPath;
        rawLink.href = endpoint.base + `/api/sessions/${encodeURIComponent(id)}/file/content?path=${encodeURIComponent(data.path)}&v=${data.mtime}-${data.size}`;
        rawLink.style.display = "";
        element("fileViewPublish").style.display = "";
        const sequence = pageSequence;
        void request(owner, endpoint, "/api/pages").then(json).then((value) => {
          if (!ownsFile(id, generation) || file.path !== data.path || sequence !== pageSequence) return;
          const page = decodePublishedPages(value).find((page2) => page2.root === data.path);
          if (page) renderPage(page, id, generation);
        }).catch(() => {
        });
        const size = data.size >= 10240 ? `${Math.round(data.size / 1024)} KB` : `${data.size} B`;
        path.textContent = `${shortCwd(data.path)} \xB7 ${size}${data.truncated ? " \xB7 truncated preview" : ""}`;
        path.title = data.path;
        if (data.image) {
          const src = data.image.url ? endpoint.base + data.image.url : `data:${data.image.mimeType};base64,${data.image.data}`;
          body.innerHTML = `<img class="file-view-img" src="${escapeHtml(src)}" decoding="async" alt="">`;
          return;
        }
        file.raw = data.content;
        const ext = data.path.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
        if (ext === "md" || ext === "markdown") body.innerHTML = `<div class="markdown-body">${options2.markdown(data.content)}</div>`;
        else body.innerHTML = `<div class="markdown-body"><pre><code${ext ? ` class="language-${escapeHtml(ext)}"` : ""}${data.content.length > 8e4 ? ' data-highlighted="skip"' : ""}>${escapeHtml(data.content)}</code></pre></div>`;
        options2.highlight(body);
        options2.refreshComments();
      } catch (e) {
        if (ownsFile(id, generation)) body.innerHTML = `<div class="error">${escapeHtml(errorText(e))}</div>`;
      }
    }
    async function openDiff() {
      if (disposed || !sessionState.currentSession) return;
      closeFile();
      element("sessionView").classList.add("diff-open");
      element("btnDiff").classList.add("active");
      await loadDiff();
    }
    function toggleDiff() {
      if (isOpen("diff")) closeDiff();
      else void openDiff();
    }
    async function loadDiff() {
      if (disposed || !sessionState.currentSession || !isOpen("diff")) return;
      const captured = capture(diff);
      if (!captured) return;
      const { owner, endpoint, id, generation } = captured;
      diffEvents.abort();
      diffEvents = new AbortController();
      const body = element("diffViewBody");
      options2.closeComments();
      body.innerHTML = '<div class="loading">Loading\u2026</div>';
      try {
        const data = decodeDiffView(await json(await request(owner, endpoint, `/api/sessions/${encodeURIComponent(id)}/diff`)));
        if (!ownsDiff(id, generation)) return;
        element("diffViewRoot").textContent = shortCwd(data.root);
        body.innerHTML = renderDiffViewHtml(data);
        body.querySelectorAll("details.diff-file").forEach((details) => {
          const patch = details.querySelector(".diff-patch");
          if (patch) patchOwners.set(patch, { generation, owner, endpoint, request: null });
          details.addEventListener("toggle", () => {
            if (ownsDiff(id, generation) && body.contains(details) && details.open) void loadPatch(details);
          }, { signal: diffEvents.signal });
        });
        options2.refreshComments();
      } catch (e) {
        if (ownsDiff(id, generation)) body.innerHTML = `<div class="error">${escapeHtml(errorText(e))}</div>`;
      }
    }
    async function loadPatch(details) {
      const patch = details.querySelector('.diff-patch[data-deferred="1"]');
      if (!patch || !element("diffViewBody").contains(details)) return;
      const owned = patchOwners.get(patch);
      if (!owned || owned.request || !ownsDiff(owned.owner.id, owned.generation)) return;
      const token = /* @__PURE__ */ Symbol("patch");
      owned.request = token;
      patch.dataset.loading = "1";
      const { repo = "", path = "", snapshot = "" } = patch.dataset;
      const current = () => ownsDiff(owned.owner.id, owned.generation) && element("diffViewBody").contains(patch) && patchOwners.get(patch) === owned && owned.request === token && patch.dataset.repo === repo && patch.dataset.path === path && patch.dataset.snapshot === snapshot;
      try {
        const query = new URLSearchParams({ repo, path, snapshot });
        const response = await request(owned.owner, owned.endpoint, `/api/sessions/${encodeURIComponent(owned.owner.id)}/diff/patch?${query}`);
        const value = await response.json();
        const data = decodeDiffPatch(value);
        if (!current()) return;
        if (response.status === 409 && data.stale) {
          patch.innerHTML = '<div class="diff-file-note">Working tree changed \u2014 refreshing the diff\u2026</div>';
          await loadDiff();
          return;
        }
        if (!response.ok) throw new Error(record8(value) && typeof value.error === "string" ? value.error : `HTTP ${response.status}`);
        patch.innerHTML = renderDiffHtml(data.patch) + (data.truncated ? '<div class="diff-file-note">\u2026 patch truncated</div>' : "");
        delete patch.dataset.deferred;
        delete patch.dataset.loading;
        owned.request = null;
        options2.markComments();
      } catch (e) {
        if (!current()) return;
        delete patch.dataset.loading;
        owned.request = null;
        patch.innerHTML = `<div class="diff-file-note diff-patch-missing">Could not load patch: ${escapeHtml(errorText(e))}. Collapse and reopen to retry.</div>`;
      }
    }
    return {
      openFile,
      closeFile,
      publish,
      copy,
      openDiff,
      closeDiff,
      toggleDiff,
      loadDiff,
      loadPatch,
      ownsFile,
      ownsDiff,
      isFileOpen: () => isOpen("file"),
      isDiffOpen: () => isOpen("diff"),
      get file() {
        return file;
      },
      get diff() {
        return diff;
      },
      dispose() {
        closeFile();
        closeDiff();
        disposed = true;
      }
    };
  }

  // src/browser/anchored-comment-data.ts
  var text15 = (v) => typeof v === "string" ? v : "";
  function decodeCommentTarget(v) {
    if (!record8(v) || v.kind !== "file" && v.kind !== "diff" || typeof v.path !== "string") return null;
    const a = record8(v.anchor) ? v.anchor : {};
    const positions = {};
    for (const key of ["startLine", "endLine", "oldStart", "oldEnd", "newStart", "newEnd"]) if (typeof a[key] === "number" && Number.isInteger(a[key]) && a[key] > 0) positions[key] = a[key];
    const anchor = { type: a.type === "lines" ? "lines" : "text", quote: text15(a.quote), prefix: text15(a.prefix), suffix: text15(a.suffix), ...positions };
    return v.kind === "file" ? { kind: "file", path: v.path, relPath: typeof v.relPath === "string" ? v.relPath : null, anchor } : typeof v.repo === "string" ? { kind: "diff", repo: v.repo, path: v.path, oldPath: typeof v.oldPath === "string" ? v.oldPath : null, anchor } : null;
  }
  function decodeAnchoredComments(value) {
    return Array.isArray(value) ? value.flatMap((v) => {
      if (!record8(v) || typeof v.id !== "string" || typeof v.sessionId !== "string" || typeof v.body !== "string") return [];
      const target = decodeCommentTarget(v.target);
      return target ? [{ id: v.id, sessionId: v.sessionId, body: v.body, target }] : [];
    }) : [];
  }
  function decodeCommentIndex(value) {
    return record8(value) && Array.isArray(value.comments) ? value.comments.flatMap((v) => {
      if (!record8(v) || typeof v.id !== "string") return [];
      const target = decodeCommentTarget(v.target);
      return target ? [{ id: v.id, target }] : [];
    }) : [];
  }

  // src/browser/comment-anchors.ts
  function selectionTextAnchor(root, range) {
    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(root);
    after.setStart(range.endContainer, range.endOffset);
    return {
      type: "text",
      // Keep the exact selected extent. Trimming would leave prefix/suffix
      // relative to different boundaries and break exact re-anchoring.
      quote: range.toString(),
      prefix: before.toString().slice(-300),
      suffix: after.toString().slice(0, 300)
    };
  }
  function clearCommentMarks(root) {
    root.querySelectorAll("mark.comment-mark").forEach((mark) => {
      const parent = mark.parentNode;
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
      parent?.normalize();
    });
  }
  function collectTextRuns(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest("script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const runs = [];
    let text17 = "";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      runs.push({ node, start: text17.length, end: text17.length + node.textContent.length });
      text17 += node.textContent;
    }
    return { runs, text: text17 };
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
  function findQuoteOffset(text17, anchor) {
    const quote = anchor?.quote;
    if (!quote) return -1;
    const hits = [];
    let from = 0;
    let at;
    while ((at = text17.indexOf(quote, from)) !== -1) {
      hits.push(at);
      from = at + Math.max(1, quote.length);
    }
    if (hits.length < 2) return hits.length ? hits[0] : -1;
    const prefix = anchor.prefix || "";
    const suffix = anchor.suffix || "";
    let best = hits[0];
    let bestScore = -1;
    for (const hit of hits) {
      const before = text17.slice(Math.max(0, hit - prefix.length), hit);
      const after = text17.slice(hit + quote.length, hit + quote.length + suffix.length);
      const score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
      if (score > bestScore) {
        bestScore = score;
        best = hit;
      }
    }
    return best;
  }
  function markCommentQuote(root, anchor, commentId) {
    const quote = anchor?.quote;
    if (!quote) return false;
    const { runs, text: text17 } = collectTextRuns(root);
    const start = findQuoteOffset(text17, anchor);
    if (start < 0) return false;
    const end = start + quote.length;
    let marked = false;
    for (const run of runs) {
      if (run.end <= start || run.start >= end) continue;
      const from = Math.max(0, start - run.start);
      const to = Math.min(run.node.textContent.length, end - run.start);
      if (to <= from) continue;
      const source = run.node.textContent;
      const mark = document.createElement("mark");
      mark.className = "comment-mark";
      mark.dataset.commentId = commentId;
      mark.textContent = source.slice(from, to);
      const frag = document.createDocumentFragment();
      if (from > 0) frag.appendChild(document.createTextNode(source.slice(0, from)));
      frag.appendChild(mark);
      if (to < source.length) frag.appendChild(document.createTextNode(source.slice(to)));
      run.node.replaceWith(frag);
      marked = true;
    }
    return marked;
  }

  // src/browser/anchored-comments.ts
  function createAnchoredComments(options2) {
    const { document: document2, sessionState, views } = options2, window = document2.defaultView;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing comment element: " + id);
      return value;
    };
    let disposed = false, mounted = false, refreshSequence = 0, focusSequence = 0;
    let bubble = null, comments = [], listOwner = null;
    let deleteArmed = false, deleteTimer = null;
    const timers = /* @__PURE__ */ new Set();
    const lifetime = new AbortController();
    let bubbleEvents = new AbortController(), listEvents = new AbortController();
    let observer = null;
    const marks = /* @__PURE__ */ new WeakMap();
    function later(callback, ms = 0) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!disposed) callback();
      }, ms);
      timers.add(timer);
      return timer;
    }
    function cancelTimer(timer) {
      if (timer !== null) {
        clearTimeout(timer);
        timers.delete(timer);
      }
    }
    function capture() {
      if (disposed) return null;
      const kind = views.isFileOpen() ? "file" : views.isDiffOpen() ? "diff" : null;
      if (!kind) return null;
      const view = kind === "file" ? views.file : views.diff;
      if (!view.owner || !view.endpoint || !view.sessionId) return null;
      const captured = { kind, owner: view.owner, endpoint: view.endpoint, id: view.sessionId, generation: view.generation, path: kind === "file" ? views.file.path : null };
      return owns(captured) ? captured : null;
    }
    function owns(view) {
      return !!view && !disposed && (view.kind === "file" ? views.ownsFile(view.id, view.generation) && views.file.path === view.path : views.ownsDiff(view.id, view.generation));
    }
    function belongs(comment, view) {
      return comment.sessionId === view.id && (view.kind === "file" ? comment.target.kind === "file" && comment.target.path === view.path : comment.target.kind === "diff");
    }
    function ownsBubble(entry) {
      return !!entry && bubble === entry && owns(entry.view) && isOpen();
    }
    function isOpen() {
      return !disposed && element("commentBubble").style.display !== "none";
    }
    function isListOpen() {
      return !disposed && element("commentListPopover").style.display !== "none";
    }
    async function request(view, path, init) {
      const endpoint = options2.host(view.owner.host);
      if (!owns(view) || !endpoint || endpoint.base !== view.endpoint.base) throw new Error("Comment view changed");
      const response = await options2.request({ ...view.endpoint, token: endpoint.token }, path, init);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
      return data;
    }
    function position() {
      const entry = bubble;
      if (!ownsBubble(entry)) return;
      const el = element("commentBubble");
      let rect;
      try {
        rect = entry.range.getBoundingClientRect();
      } catch {
        return;
      }
      const viewport = window.visualViewport, left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight, margin = 8, gap = 8;
      el.style.maxWidth = `${Math.max(0, width - 2 * margin)}px`;
      el.style.maxHeight = `${Math.max(0, height - 2 * margin)}px`;
      el.style.left = `${Math.max(left + margin, Math.min(left + width - el.offsetWidth - margin, rect.left + (rect.width - el.offsetWidth) / 2))}px`;
      const below = rect.bottom + gap, preferred = below + el.offsetHeight <= top + height - margin ? below : rect.top - el.offsetHeight - gap;
      el.style.top = `${Math.max(top + margin, Math.min(top + height - el.offsetHeight - margin, preferred))}px`;
    }
    function disarmDelete() {
      cancelTimer(deleteTimer);
      deleteTimer = null;
      deleteArmed = false;
      const button = element("commentDeleteBtn");
      button.textContent = "Delete";
      button.classList.remove("armed");
    }
    function close() {
      bubbleEvents.abort();
      bubble = null;
      focusSequence++;
      element("commentBubble").style.display = "none";
      element("commentStatus").textContent = "";
      element("commentDeleteBtn").style.display = "none";
      disarmDelete();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    }
    function bindBubble(entry, focus2) {
      bubbleEvents.abort();
      bubbleEvents = new AbortController();
      bubble = entry;
      disarmDelete();
      const { draft, editing } = entry;
      element("commentBubbleTitle").textContent = editing ? "Edit comment" : "Comment for agent";
      element("commentAnchorPreview").textContent = editing?.target.anchor.quote || draft?.quote || "";
      element("commentBody").value = editing?.body || "";
      element("commentStatus").textContent = "";
      const send = element("commentSendBtn"), remove = element("commentDeleteBtn");
      send.disabled = false;
      remove.disabled = false;
      remove.style.display = editing ? "" : "none";
      element("commentBubble").style.display = "block";
      position();
      const signal = bubbleEvents.signal;
      send.addEventListener("click", () => {
        if (ownsBubble(entry)) void submit();
      }, { signal });
      remove.addEventListener("click", () => {
        if (ownsBubble(entry)) void removeComment();
      }, { signal });
      element("commentBody").addEventListener("keydown", (event) => {
        if (ownsBubble(entry)) key(event);
      }, { signal });
      element("commentBubble").querySelectorAll("[data-comment-close]").forEach((button) => button.addEventListener("click", () => {
        if (ownsBubble(entry)) close();
      }, { signal }));
      if (focus2) {
        element("commentBody").focus();
        later(() => {
          if (ownsBubble(entry)) position();
        });
      }
    }
    function openDraft(draft, range, focus2 = false) {
      const view = capture();
      if (!view || draft.sessionId !== view.id || draft.target.kind !== view.kind || draft.target.kind === "file" && draft.target.path !== view.path) return;
      bindBubble({ view, draft, editing: null, range: range.cloneRange(), busy: false }, focus2);
    }
    function openEditor(comment, anchor) {
      const view = capture();
      if (!view || !owns(listOwner) || !comments.includes(comment) || !belongs(comment, view) || !anchor.isConnected) return;
      const range = document2.createRange();
      range.selectNodeContents(anchor);
      bindBubble({ view, draft: null, editing: comment, range, busy: false }, true);
    }
    function captureFile(focus2 = false) {
      if (isOpen()) return;
      const view = capture(), raw = views.file.raw, path = views.file.path;
      if (!view || view.kind !== "file" || !path || raw === null) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const root = element("fileViewBody"), range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const text17 = range.toString();
      if (!text17.trim() || text17.length > 12e3) return;
      const base = selectionTextAnchor(root, range), first = raw.indexOf(base.quote);
      const startLine = first >= 0 && raw.indexOf(base.quote, first + 1) < 0 ? raw.slice(0, first).split("\n").length : null;
      const anchor = startLine === null ? base : { ...base, startLine, endLine: startLine + base.quote.split("\n").length - 1 };
      openDraft({ sessionId: view.id, quote: anchor.quote, target: { kind: "file", path, relPath: views.file.relPath, anchor } }, range, focus2);
    }
    function captureDiff(focus2 = false) {
      if (isOpen()) return;
      const view = capture();
      if (!view || view.kind !== "diff") return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0), node = range.commonAncestorContainer;
      const patch = (node instanceof Element ? node : node.parentElement)?.closest(".diff-patch");
      if (!patch || !element("diffViewBody").contains(patch)) return;
      const lines = [...patch.querySelectorAll('.diff-line[data-diff-line="1"]:not(.diff-hunk)')].filter((line) => {
        try {
          return range.intersectsNode(line);
        } catch {
          return false;
        }
      });
      if (!lines.length) return;
      const nums = (key2) => lines.map((line) => Number(line.dataset[key2])).filter((n) => Number.isInteger(n) && n > 0);
      const oldNums = nums("oldLine"), newNums = nums("newLine"), quote = lines.map((line) => line.textContent).join("\n").slice(0, 12e3);
      openDraft({ sessionId: view.id, quote, target: {
        kind: "diff",
        repo: patch.dataset.repo || "",
        path: patch.dataset.path || "",
        oldPath: patch.dataset.oldPath || null,
        anchor: { type: "lines", quote, ...oldNums.length ? { oldStart: Math.min(...oldNums), oldEnd: Math.max(...oldNums) } : {}, ...newNums.length ? { newStart: Math.min(...newNums), newEnd: Math.max(...newNums) } : {} }
      } }, range, focus2);
    }
    function key(event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    }
    async function submit() {
      const entry = bubble;
      if (!ownsBubble(entry) || entry.busy) return;
      const body = element("commentBody").value.trim();
      if (!body) {
        element("commentBody").focus();
        return;
      }
      const { editing, draft, view } = entry;
      if (!editing && !draft) return;
      entry.busy = true;
      element("commentSendBtn").disabled = true;
      element("commentDeleteBtn").disabled = true;
      element("commentStatus").textContent = "Saving\u2026";
      try {
        await request(view, editing ? `/api/comments/${encodeURIComponent(editing.id)}` : "/api/comments", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { sessionId: editing.sessionId, body } : { sessionId: draft.sessionId, body, target: draft.target }) });
        if (!owns(view)) return;
        if (ownsBubble(entry)) {
          close();
          window.getSelection()?.removeAllRanges();
        }
        options2.status(editing ? "Comment updated" : "Comment saved");
        void refresh();
      } catch (error) {
        if (ownsBubble(entry)) element("commentStatus").textContent = error instanceof Error ? error.message : String(error);
      } finally {
        entry.busy = false;
        if (ownsBubble(entry)) {
          element("commentSendBtn").disabled = false;
          element("commentDeleteBtn").disabled = false;
        }
      }
    }
    async function removeComment() {
      const entry = bubble;
      if (!ownsBubble(entry) || entry.busy || !entry.editing) return;
      const button = element("commentDeleteBtn");
      if (!deleteArmed) {
        deleteArmed = true;
        button.textContent = "Delete?";
        button.classList.add("armed");
        deleteTimer = later(() => {
          if (ownsBubble(entry)) disarmDelete();
        }, 3e3);
        return;
      }
      const { editing, view } = entry;
      entry.busy = true;
      button.disabled = true;
      element("commentSendBtn").disabled = true;
      element("commentStatus").textContent = "Deleting\u2026";
      try {
        await request(view, `/api/comments/${encodeURIComponent(editing.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: editing.sessionId }) });
        if (!owns(view)) return;
        if (ownsBubble(entry)) close();
        options2.status("Comment deleted");
        void refresh();
      } catch (error) {
        if (ownsBubble(entry)) {
          element("commentStatus").textContent = error instanceof Error ? error.message : String(error);
          disarmDelete();
        }
      } finally {
        entry.busy = false;
        if (ownsBubble(entry)) {
          button.disabled = false;
          element("commentSendBtn").disabled = false;
        }
      }
    }
    function set(value) {
      refreshSequence++;
      listOwner = capture();
      comments = listOwner ? decodeAnchoredComments(value).filter((comment) => belongs(comment, listOwner)) : [];
      applyMarks();
      renderChips();
    }
    async function refresh() {
      const view = capture(), sequence = ++refreshSequence;
      if (!view || view.kind === "file" && !view.path) {
        set([]);
        return;
      }
      const current = () => owns(view) && refreshSequence === sequence;
      try {
        const index = decodeCommentIndex(await request(view, `/api/comments/index?sessionId=${encodeURIComponent(view.id)}`));
        if (!current()) return;
        const ids = index.filter((entry) => view.kind === "file" ? entry.target.kind === "file" && entry.target.path === view.path : entry.target.kind === "diff").map((entry) => entry.id);
        if (!ids.length) {
          set([]);
          return;
        }
        const full = await request(view, "/api/comments/get", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: view.id, ids }) });
        if (!current()) return;
        set(record8(full) ? full.comments : []);
      } catch {
      }
    }
    function diffPatch(comment) {
      const target = comment.target;
      return target.kind === "diff" ? [...element("diffViewBody").querySelectorAll(".diff-patch")].find((patch) => patch.dataset.repo === target.repo && patch.dataset.path === target.path) || null : null;
    }
    function applyMarks() {
      if (disposed) return;
      const current = owns(listOwner);
      if (views.isFileOpen()) {
        const root = element("fileViewBody");
        clearCommentMarks(root);
        if (current) {
          for (const comment of comments) if (comment.target.kind === "file") {
            markCommentQuote(root, comment.target.anchor, comment.id);
            for (const mark of root.querySelectorAll("mark.comment-mark")) if (mark.dataset.commentId === comment.id) marks.set(mark, { view: listOwner, comment });
          }
        }
      } else if (views.isDiffOpen()) {
        for (const line of element("diffViewBody").querySelectorAll(".diff-line.comment-line")) {
          line.classList.remove("comment-line");
          delete line.dataset.commentId;
        }
        if (current) for (const comment of comments) {
          if (comment.target.kind !== "diff") continue;
          const patch = diffPatch(comment);
          if (!patch) continue;
          const anchor = comment.target.anchor;
          const inRange = (value, from, to) => !!value && from !== void 0 && to !== void 0 && Number.isInteger(Number(value)) && Number(value) >= from && Number(value) <= to;
          for (const line of patch.querySelectorAll(".diff-line")) {
            const hit = inRange(line.dataset.newLine, anchor.newStart, anchor.newEnd) || anchor.newStart === void 0 && inRange(line.dataset.oldLine, anchor.oldStart, anchor.oldEnd);
            if (hit) {
              line.classList.add("comment-line");
              line.dataset.commentId = comment.id;
              marks.set(line, { view: listOwner, comment });
            }
          }
        }
      }
    }
    function renderChips() {
      const active = owns(listOwner) ? listOwner.kind === "file" ? "fileViewComments" : "diffViewComments" : null;
      for (const id of ["fileViewComments", "diffViewComments"]) {
        const chip = element(id);
        chip.style.display = id === active && comments.length ? "" : "none";
        chip.textContent = `\u{1F4AC} ${comments.length}`;
      }
      if (!comments.length || !active) closeList();
      else if (isListOpen()) renderList();
    }
    function closeList() {
      listEvents.abort();
      const popover = element("commentListPopover");
      popover.style.display = "none";
      popover.innerHTML = "";
    }
    function renderList() {
      listEvents.abort();
      listEvents = new AbortController();
      const events = listEvents, view = listOwner;
      const popover = element("commentListPopover");
      popover.innerHTML = comments.map((comment) => {
        const quote = comment.target.anchor.quote.replace(/\s+/g, " ").trim();
        return `<button type="button" class="comment-list-row" data-comment-id="${escapeHtml(comment.id)}"><span class="comment-list-body">${escapeHtml(comment.body.slice(0, 160))}</span>${quote ? `<span class="comment-list-quote">${escapeHtml(quote.slice(0, 90))}</span>` : ""}</button>`;
      }).join("");
      for (const row of popover.querySelectorAll(".comment-list-row")) row.addEventListener("click", () => {
        if (!events.signal.aborted && owns(view) && isListOpen()) void focus(row.dataset.commentId || "");
      }, { signal: events.signal });
    }
    function toggleList(chip) {
      if (isListOpen()) {
        closeList();
        return;
      }
      if (!owns(listOwner) || !comments.length || !chip.isConnected) return;
      renderList();
      const popover = element("commentListPopover");
      popover.style.display = "block";
      const rect = chip.getBoundingClientRect();
      popover.style.left = `${Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, rect.left))}px`;
      popover.style.top = `${rect.bottom + 6}px`;
    }
    async function focus(id) {
      const view = listOwner, comment = comments.find((entry) => entry.id === id);
      if (!owns(view) || !comment) return;
      const sequence = ++focusSequence;
      const current = () => owns(view) && comments.includes(comment) && focusSequence === sequence;
      closeList();
      if (comment.target.kind === "diff") {
        const details = diffPatch(comment)?.closest("details.diff-file");
        if (details && !details.open) {
          details.open = true;
          await options2.loadPatch(details);
          if (!current()) return;
          applyMarks();
        }
      }
      if (!current()) return;
      const root = element(view.kind === "file" ? "fileViewBody" : "diffViewBody");
      const mark = [...root.querySelectorAll("[data-comment-id]")].find((el) => el.dataset.commentId === id);
      mark?.scrollIntoView({ block: "center" });
      openEditor(comment, mark || element(view.kind === "file" ? "fileViewComments" : "diffViewComments"));
    }
    function mount() {
      if (disposed || mounted) return;
      mounted = true;
      const signal = lifetime.signal;
      const queueSelection = (kind, focusComposer = false) => {
        const view = capture();
        if (!view || view.kind !== kind) return;
        later(() => {
          if (owns(view)) {
            if (kind === "file") captureFile(focusComposer);
            else captureDiff(focusComposer);
          }
        });
      };
      for (const kind of ["file", "diff"]) {
        const body = element(kind + "ViewBody");
        body.addEventListener("pointerup", () => queueSelection(kind), { signal });
        body.addEventListener("scroll", position, { signal });
        const chip = element(kind + "ViewComments");
        chip.addEventListener("click", () => toggleList(chip), { signal });
      }
      document2.addEventListener("keyup", (event) => {
        if (event.shiftKey) {
          if (views.isFileOpen()) queueSelection("file", true);
          else if (views.isDiffOpen()) queueSelection("diff", true);
        }
      }, { signal });
      document2.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const marked = target.closest("mark.comment-mark, .diff-line.comment-line");
        const entry = marked ? marks.get(marked) : null;
        if (marked && entry && marked.isConnected && owns(entry.view) && comments.includes(entry.comment) && window.getSelection()?.isCollapsed !== false) {
          openEditor(entry.comment, marked);
          return;
        }
        if (isListOpen() && !target.closest(".view-comment-chip, .comment-list-popover")) closeList();
      }, { signal });
      const reposition = () => {
        position();
        closeList();
      };
      window.addEventListener("resize", reposition, { signal });
      window.visualViewport?.addEventListener("resize", reposition, { signal });
      window.visualViewport?.addEventListener("scroll", reposition, { signal });
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(reposition);
        observer.observe(element("commentBubble"));
      }
    }
    return {
      mount,
      isOpen,
      close,
      openDraft,
      openEditor,
      captureFile,
      captureDiff,
      position,
      key,
      submit,
      remove: removeComment,
      disarmDelete,
      set,
      refresh,
      applyMarks,
      renderChips,
      isListOpen,
      closeList,
      toggleList,
      renderList,
      focus,
      get editing() {
        return bubble?.editing || null;
      },
      dispose() {
        close();
        closeList();
        set([]);
        lifetime.abort();
        observer?.disconnect();
        disposed = true;
      }
    };
  }

  // src/browser/session-controls.ts
  function createSessionControls(options2) {
    const { document: document2, sessionState, catalog } = options2, window = document2.defaultView;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing session control: " + id);
      return value;
    };
    const errorText = (error) => error instanceof Error ? error.message : String(error);
    function header() {
      const row = sessionState.currentSession;
      if (!row) return null;
      return {
        id: row.id,
        isActive: row.isActive === true,
        name: typeof row.name === "string" ? row.name : "",
        model: typeof row.model === "string" ? row.model : "",
        harnessId: typeof row.harnessId === "string" ? row.harnessId : void 0,
        thinkingLevel: typeof row.thinkingLevel === "string" ? row.thinkingLevel : "",
        capabilities: record8(row.capabilities) ? row.capabilities : {}
      };
    }
    function sessionSupports2(row, capability) {
      return row.capabilities[capability] !== false;
    }
    let disposed = false, modelOwner = null, thinkingOwner = null, renameOwner = null;
    let modelOpen = false, thinkingOpen = false, editMode = false, query = "";
    let modelSelector = null, thinkingSelector = null;
    let modelEvents = new AbortController(), thinkingEvents = new AbortController(), renameEvents = new AbortController();
    const lifetime = new AbortController(), mutations = /* @__PURE__ */ new Map(), timers = /* @__PURE__ */ new Set(), urls = /* @__PURE__ */ new Map();
    let enabledTimer = null, enabledSequence = 0, exportSequence = 0;
    function later(callback, ms = 0) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!disposed) callback();
      }, ms);
      timers.add(timer);
      return timer;
    }
    function capture() {
      const selection = sessionState.captureSelection();
      if (disposed || !selection) return null;
      const endpoint = options2.host(selection.host);
      return endpoint ? { selection, endpoint: Object.freeze({ ...endpoint }) } : null;
    }
    function endpointCurrent(owner) {
      const endpoint = options2.host(owner.selection.host);
      return !disposed && endpoint && endpoint.base === owner.endpoint.base ? { ...owner.endpoint, token: endpoint.token } : null;
    }
    function owns(owner) {
      return !!owner && !!endpointCurrent(owner) && sessionState.ownsSelection(owner.selection);
    }
    function api(owner) {
      const endpoint = endpointCurrent(owner);
      if (!endpoint) throw new Error("Host connection changed");
      return createSessionApi((_host, path, init) => options2.request(endpoint, path, init));
    }
    function mutation(owner, kind) {
      const key = sessionKey(owner.selection.host, owner.selection.id) + ":" + kind, token = Symbol(kind);
      mutations.set(key, token);
      return () => endpointCurrent(owner) && mutations.get(key) === token;
    }
    function place(dropdown, trigger) {
      dropdown.style.top = "";
      dropdown.style.left = "";
      dropdown.style.bottom = "";
      dropdown.style.right = "";
      if (window.innerWidth > 768) {
        const rect = trigger.getBoundingClientRect();
        dropdown.style.left = rect.left + "px";
        dropdown.style.top = rect.bottom + 4 + "px";
      }
    }
    function outside(ids, events, current, close) {
      later(() => {
        if (events.signal.aborted || !current()) return;
        document2.addEventListener("click", (event) => {
          if (!current() || !(event.target instanceof Node)) return;
          if (!document2.body.contains(event.target) || ids.some((id) => element(id).contains(event.target))) return;
          close();
        }, { signal: events.signal });
      });
    }
    function closeModels() {
      modelOwner = null;
      modelOpen = false;
      modelEvents.abort();
      modelSelector?.dispose();
      modelSelector = null;
      element("modelDropdown").style.display = "none";
    }
    function closeThinking() {
      thinkingOwner = null;
      thinkingOpen = false;
      thinkingEvents.abort();
      thinkingSelector?.dispose();
      thinkingSelector = null;
      element("thinkingDropdown").style.display = "none";
    }
    const ownsModels = (owner = modelOwner) => !!owner && owner === modelOwner && owns(owner) && modelOpen;
    const ownsThinking = (owner = thinkingOwner) => !!owner && owner === thinkingOwner && owns(owner) && thinkingOpen;
    async function toggleModels() {
      if (modelOwner) {
        closeModels();
        return;
      }
      const session = header(), owner = capture();
      if (!owner || !session?.isActive || !sessionSupports2(session, "setModel")) return;
      modelOwner = owner;
      try {
        await options2.loadModels(owner.selection.id, session.harnessId);
      } catch {
        if (modelOwner === owner) closeModels();
        return;
      }
      if (!owns(owner) || modelOwner !== owner) return;
      modelOpen = true;
      editMode = false;
      query = "";
      modelEvents = new AbortController();
      const dropdown = element("modelDropdown");
      place(dropdown, element("sessionModel"));
      renderModels("");
      dropdown.style.display = "flex";
      modelSelector?.focusSearch();
      outside(["modelSelector", "modelDropdown"], modelEvents, () => ownsModels(owner), closeModels);
    }
    function renderModels(nextQuery) {
      const owner = modelOwner, session = header();
      if (!ownsModels(owner) || !session) return;
      query = nextQuery;
      const owned = (target) => ownsModels(owner) && owner.selection === target;
      if (!modelSelector) modelSelector = mountModelSelector(element("modelDropdown"), {
        requestClose: (target) => {
          if (owned(target)) closeModels();
        },
        queryChanged: (target, value) => {
          if (owned(target)) renderModels(value);
        },
        editModeChanged: (target, value) => {
          if (owned(target)) setEditMode(value);
        },
        selectModel: (target, value) => {
          if (owned(target)) void selectModel(value);
        },
        toggleModel: (target, value) => {
          if (owned(target)) toggleModel(value);
        },
        toggleProvider: (target, value) => {
          if (owned(target)) toggleProvider(value);
        },
        setAllEnabled: (target, value) => {
          if (owned(target)) setAll(value);
        }
      }, formatTokens);
      modelSelector.update({ owner: owner.selection, models: catalog.rows(), currentModel: session.model || null, harnessId: session.harnessId || null, query, editMode });
    }
    function setEditMode(value) {
      if (!ownsModels() || value && header()?.harnessId !== "pi") return;
      editMode = value;
      renderModels(query);
    }
    function toggleModel(selector) {
      if (!ownsModels() || !editMode) return;
      catalog.toggle(selector);
      renderModels(query);
      saveEnabled();
    }
    function toggleProvider(provider) {
      if (!ownsModels() || !editMode) return;
      catalog.toggleProvider(provider, query);
      renderModels(query);
      saveEnabled();
    }
    function setAll(enabled) {
      if (!ownsModels() || !editMode) return;
      catalog.setAll(enabled);
      renderModels(query);
      saveEnabled();
    }
    function saveEnabled() {
      const enabled = catalog.enabledIds(), self = options2.host(null);
      if (disposed || enabled === void 0 || !self) return;
      const endpoint = Object.freeze({ ...self }), ids = enabled && [...enabled], sequence = ++enabledSequence;
      if (enabledTimer !== null) {
        clearTimeout(enabledTimer);
        timers.delete(enabledTimer);
      }
      enabledTimer = later(() => {
        enabledTimer = null;
        const current = options2.host(null);
        if (!current || current.base !== endpoint.base) return;
        void sendJson(options2.request, { ...endpoint, token: current.token }, "/api/models/enabled", { enabledIds: ids }, "PUT").catch((error) => {
          if (!disposed && sequence === enabledSequence && options2.host(null)?.base === endpoint.base) options2.status("Failed to save model list: " + errorText(error), "error");
        });
      }, 400);
    }
    async function selectModel(selector) {
      const session = header(), owner = capture();
      closeModels();
      if (!owner || !session || !sessionSupports2(session, "setModel") || selector === session.model) return;
      const current = mutation(owner, "model");
      options2.status("Switching model...", "working");
      try {
        await api(owner).setModel(owner.selection, selector);
        if (!current()) return;
        sessionState.patchSession(owner.selection.id, { model: selector }, owner.selection.host);
        if (owns(owner)) options2.status("Model switched to " + selector);
      } catch (error) {
        if (current() && owns(owner)) options2.status("Model switch failed: " + errorText(error), "error");
      }
    }
    function updateThinking() {
      const session = header(), badge = element("sessionThinking");
      badge.style.display = session?.isActive && sessionSupports2(session, "setThinking") ? "" : "none";
      badge.textContent = (session?.thinkingLevel || "?") + " \u25BE";
    }
    async function toggleThinking() {
      if (thinkingOwner) {
        closeThinking();
        return;
      }
      const session = header(), owner = capture();
      if (!owner || !session?.isActive || !sessionSupports2(session, "setThinking")) return;
      thinkingOwner = owner;
      try {
        await options2.loadModels(owner.selection.id, session.harnessId);
      } catch {
        if (thinkingOwner === owner) closeThinking();
        return;
      }
      if (!owns(owner) || thinkingOwner !== owner) return;
      thinkingOpen = true;
      thinkingEvents = new AbortController();
      const dropdown = element("thinkingDropdown");
      const current = header(), ref = current.model || "";
      const model = catalog.rows().find((row) => row.selector === ref || row.id === ref || `${row.provider}/${row.id}` === ref);
      thinkingSelector = mountThinkingSelector(dropdown, {
        selectLevel: (target, value) => {
          if (ownsThinking(owner) && target === owner.selection) void selectThinking(value);
        },
        requestClose: (target) => {
          if (ownsThinking(owner) && target === owner.selection) closeThinking();
        }
      });
      thinkingSelector.update({ owner: owner.selection, levels: thinkingLevelsFor(current.harnessId, model), currentLevel: current.thinkingLevel || null });
      place(dropdown, element("sessionThinking"));
      dropdown.style.display = "block";
      outside(["sessionThinking", "thinkingDropdown"], thinkingEvents, () => ownsThinking(owner), closeThinking);
    }
    async function selectThinking(level) {
      const session = header(), owner = capture();
      closeThinking();
      if (!owner || !session || !sessionSupports2(session, "setThinking")) return;
      const current = mutation(owner, "thinking");
      try {
        const result = await api(owner).setThinking(owner.selection, level);
        if (!current()) return;
        const reported = result.level || level;
        sessionState.patchSession(owner.selection.id, { thinkingLevel: reported }, owner.selection.host);
        if (owns(owner)) options2.status(reported !== level ? `Thinking level: ${reported} (model doesn't support ${level})` : `Thinking level: ${reported}`);
      } catch (error) {
        if (current() && owns(owner)) options2.status("Thinking level failed: " + errorText(error), "error");
      }
    }
    function cancelRename() {
      renameOwner = null;
      renameEvents.abort();
      element("sessionNameInput").style.display = "none";
      element("sessionName").style.display = "";
    }
    function startRename() {
      const session = header(), owner = capture();
      if (!owner || !session?.isActive || !sessionSupports2(session, "rename")) return;
      cancelRename();
      renameOwner = owner;
      renameEvents = new AbortController();
      const input = element("sessionNameInput");
      element("sessionName").style.display = "none";
      input.style.display = "";
      input.value = session.name || "";
      input.focus();
      input.select();
      const signal = renameEvents.signal;
      input.addEventListener("blur", () => {
        if (renameOwner === owner) void commitRename();
      }, { signal });
      input.addEventListener("keydown", (event) => {
        if (renameOwner === owner) renameKey(event);
      }, { signal });
    }
    function renameKey(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        void commitRename();
      } else if (event.key === "Escape") cancelRename();
    }
    async function commitRename() {
      const owner = renameOwner, value = element("sessionNameInput").value.trim();
      cancelRename();
      const session = header();
      if (!owns(owner) || !session?.isActive || !sessionSupports2(session, "rename") || !value || value === session.name) return;
      const current = mutation(owner, "rename");
      try {
        await api(owner).rename(owner.selection, value);
        if (current()) sessionState.patchSession(owner.selection.id, { name: value }, owner.selection.host);
      } catch (error) {
        if (current() && owns(owner)) options2.status("Rename failed: " + errorText(error), "error");
      }
    }
    function download(blob, name) {
      if (disposed) return;
      const url = URL.createObjectURL(blob), link = document2.createElement("a");
      link.href = url;
      link.download = name;
      link.rel = "noopener";
      document2.body.appendChild(link);
      link.click();
      link.remove();
      const timer = later(() => {
        URL.revokeObjectURL(url);
        urls.delete(url);
      }, 6e4);
      urls.set(url, timer);
    }
    async function exportSession() {
      const session = header(), owner = capture();
      if (!owner || !session) return;
      const endpoint = endpointCurrent(owner);
      if (!endpoint) return;
      const path = `/api/sessions/${encodeURIComponent(owner.selection.id)}/export`, sequence = ++exportSequence;
      if (!endpoint.token) {
        window.open(endpoint.base + path, "_blank");
        return;
      }
      options2.status("Exporting session\u2026", "working");
      try {
        const response = await options2.request(endpoint, path);
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
        }
        const blob = await response.blob();
        if (!endpointCurrent(owner)) return;
        const fallback2 = `${(session.name || session.id).replace(/[^\w.-]+/g, "-")}.html`;
        download(blob, filenameFromContentDisposition(response.headers.get("Content-Disposition"), fallback2));
        if (sequence === exportSequence && owns(owner)) options2.status("Session exported");
      } catch (error) {
        if (sequence === exportSequence && owns(owner)) options2.status("Export failed: " + errorText(error), "error");
      }
    }
    element("sessionName").addEventListener("click", startRename, { signal: lifetime.signal });
    element("sessionModel").addEventListener("click", () => {
      void toggleModels();
    }, { signal: lifetime.signal });
    element("sessionThinking").addEventListener("click", () => {
      void toggleThinking();
    }, { signal: lifetime.signal });
    return {
      toggleModels,
      closeModels,
      renderModels,
      setEditMode,
      toggleModel,
      toggleProvider,
      setAll,
      saveEnabled,
      selectModel,
      toggleThinking,
      closeThinking,
      selectThinking,
      updateThinking,
      startRename,
      cancelRename,
      commitRename,
      renameKey,
      export: exportSession,
      download,
      get modelOpen() {
        return modelOpen;
      },
      get thinkingOpen() {
        return thinkingOpen;
      },
      get query() {
        return query;
      },
      get modelSelector() {
        return modelSelector;
      },
      get thinkingSelector() {
        return thinkingSelector;
      },
      dispose() {
        closeModels();
        closeThinking();
        cancelRename();
        disposed = true;
        lifetime.abort();
        mutations.clear();
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        for (const url of urls.keys()) URL.revokeObjectURL(url);
        urls.clear();
      }
    };
  }

  // src/browser/composer-notes.ts
  function createComposerNotes(document2) {
    let disposed = false, events = new AbortController();
    function hide() {
      events.abort();
      const element = document2.getElementById("composerNote");
      if (element) {
        element.style.display = "none";
        element.textContent = "";
      }
    }
    function show(text17) {
      if (disposed) return;
      const element = document2.getElementById("composerNote");
      if (!element) return;
      hide();
      events = new AbortController();
      const owned = events;
      const message3 = document2.createElement("span");
      message3.className = "composer-note-text";
      message3.textContent = text17;
      const dismiss = document2.createElement("button");
      dismiss.type = "button";
      dismiss.className = "composer-note-dismiss";
      dismiss.title = "Dismiss";
      dismiss.textContent = "\u2715";
      dismiss.addEventListener("click", () => {
        if (!owned.signal.aborted && element.contains(dismiss)) hide();
      }, { signal: owned.signal });
      element.append(message3, dismiss);
      element.style.display = "";
    }
    return { show, hide, dispose() {
      hide();
      disposed = true;
    } };
  }

  // src/browser/composer-speech.ts
  function createComposerSpeech(options2) {
    const { document: document2, sessionState } = options2, window = document2.defaultView, navigator = window.navigator;
    const button = () => document2.getElementById("btnMic");
    let disposed = false, mounted = false, take = null, transcription = null, pointerType = "";
    const lifetime = new AbortController();
    const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
    const errorName = (e) => record8(e) && typeof e.name === "string" ? e.name : "unknown";
    function capture() {
      const key = options2.composerKey();
      return !disposed && key ? { key, selection: sessionState.captureSelection() } : null;
    }
    function owns(owner) {
      return !disposed && options2.composerKey() === owner.key && (!owner.selection || sessionState.ownsSelection(owner.selection));
    }
    function host() {
      return options2.hosts().find((entry) => record8(entry.capabilities) ? entry.capabilities.stt === true : (entry.self === true || entry.base === "") && !!options2.config().stt) || null;
    }
    function reason() {
      return sttUnavailableReason({ isSecureContext: !!window.isSecureContext, hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia, hasMediaRecorder: typeof window.MediaRecorder === "function", origin: window.location.origin });
    }
    function isRecording() {
      return !!take;
    }
    function updateButton() {
      const btn = button();
      if (!btn || disposed) return;
      if (!host()) {
        btn.style.display = "none";
        return;
      }
      const unavailable = reason();
      btn.style.display = "inline-flex";
      btn.classList.toggle("unavailable", !!unavailable);
      if (unavailable) btn.setAttribute("aria-disabled", "true");
      else btn.removeAttribute("aria-disabled");
      btn.classList.toggle("recording", !!take?.recorder);
      btn.classList.toggle("busy", !!transcription);
      btn.title = unavailable ? unavailable.message : take ? "Stop recording" : transcription ? "Transcribing\u2026" : "Dictate (speech to text)";
    }
    function stopTracks(stream) {
      if (stream) for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
        }
      }
    }
    function retire(entry, stopRecorder = false) {
      entry.events.abort();
      if (entry.timer !== null) clearInterval(entry.timer);
      entry.timer = null;
      if (take === entry) take = null;
      if (stopRecorder && entry.recorder && entry.recorder.state !== "inactive") {
        try {
          entry.recorder.stop();
        } catch {
        }
      }
      stopTracks(entry.stream);
      entry.stream = null;
      entry.chunks = [];
    }
    function release() {
      if (take) retire(take, true);
      updateButton();
    }
    function cancel() {
      const active = !!take || !!transcription;
      if (take) retire(take, true);
      if (transcription) {
        transcription.events.abort();
        transcription = null;
      }
      if (active) options2.status("");
      updateButton();
    }
    function updateStatus() {
      const entry = take;
      if (!entry?.recorder) return;
      if (!owns(entry.owner)) {
        retire(entry, true);
        updateButton();
        return;
      }
      const elapsed = Date.now() - entry.started;
      if (elapsed >= 5 * 60 * 1e3) {
        stop();
        return;
      }
      options2.status(`Recording ${formatDuration(elapsed)}`);
    }
    async function start() {
      if (disposed || take || transcription) return;
      const owner = capture();
      if (!owner || !host()) return;
      const unavailable = reason();
      if (unavailable) {
        options2.showNote(unavailable.message);
        return;
      }
      options2.hideNote();
      const entry = { owner, stream: null, recorder: null, chunks: [], started: 0, timer: null, events: new AbortController() };
      take = entry;
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        if (take !== entry) return;
        retire(entry);
        if (!owns(owner)) {
          updateButton();
          return;
        }
        const name = errorName(error);
        options2.showNote(name === "NotAllowedError" ? "Microphone access was denied. Allow the microphone for this site in the browser's site settings and try again." : name === "NotFoundError" ? "No microphone found." : `Microphone error: ${name}`);
        updateButton();
        return;
      }
      if (take !== entry || !owns(owner)) {
        stopTracks(stream);
        if (take === entry) retire(entry);
        updateButton();
        return;
      }
      entry.stream = stream;
      const mime = MIME_TYPES.find((type) => typeof window.MediaRecorder.isTypeSupported === "function" && window.MediaRecorder.isTypeSupported(type));
      let recorder;
      try {
        recorder = mime ? new window.MediaRecorder(stream, { mimeType: mime }) : new window.MediaRecorder(stream);
      } catch {
        try {
          recorder = new window.MediaRecorder(stream);
        } catch (error) {
          retire(entry);
          if (owns(owner)) options2.showNote(`Microphone error: ${errorName(error)}`);
          updateButton();
          return;
        }
      }
      entry.recorder = recorder;
      entry.started = Date.now();
      recorder.addEventListener("dataavailable", (event) => {
        if (take === entry && owns(owner) && event.data?.size) entry.chunks.push(event.data);
      }, { signal: entry.events.signal });
      recorder.addEventListener("stop", () => finish(recorder), { signal: entry.events.signal });
      recorder.addEventListener("error", (event) => {
        if (take !== entry) return;
        retire(entry);
        if (owns(owner)) options2.showNote(`Microphone error: ${"error" in event ? errorName(event.error) : "unknown"}`);
        updateButton();
      }, { signal: entry.events.signal });
      try {
        recorder.start();
      } catch (error) {
        retire(entry);
        if (owns(owner)) options2.showNote(`Microphone error: ${errorName(error)}`);
        updateButton();
        return;
      }
      if (take !== entry) return;
      entry.timer = setInterval(updateStatus, 1e3);
      updateStatus();
      updateButton();
    }
    function stop() {
      const entry = take;
      if (!entry) return;
      if (!entry.recorder) {
        cancel();
        return;
      }
      try {
        if (entry.recorder.state !== "inactive") entry.recorder.stop();
      } catch {
        retire(entry);
        updateButton();
      }
    }
    function finish(recorder) {
      const entry = take;
      if (!entry || entry.recorder !== recorder) return;
      const chunks = [...entry.chunks], owner = entry.owner, mime = recorder.mimeType || "audio/webm";
      retire(entry);
      updateButton();
      if (!owns(owner)) return;
      const blob = new Blob(chunks, { type: mime });
      if (blob.size < 1024) {
        options2.status("");
        options2.showNote("Nothing was recorded.");
        return;
      }
      void transcribe(blob, mime, owner);
    }
    async function transcribe(blob, mime, owner = capture()) {
      if (!owner || !owns(owner) || transcription) return;
      const endpoint = host();
      if (!endpoint) {
        options2.status("");
        return;
      }
      const entry = { owner, host: Object.freeze({ ...endpoint }), events: new AbortController() };
      transcription = entry;
      const current = () => transcription === entry && owns(owner) && options2.hosts().some((host2) => host2.hostId === entry.host.hostId && host2.base === entry.host.base);
      updateButton();
      options2.status("Transcribing\u2026");
      try {
        const response = await options2.request(entry.host, "/api/stt", { method: "POST", headers: { "Content-Type": mime }, body: blob, signal: entry.events.signal });
        const value = await response.json().catch(() => null);
        if (!current()) return;
        if (!response.ok) throw new Error(record8(value) && typeof value.error === "string" ? value.error : `Transcription failed (HTTP ${response.status})`);
        const text17 = record8(value) && typeof value.text === "string" ? value.text.trim() : "";
        if (!text17) {
          options2.showNote("No speech detected.");
          return;
        }
        insert(text17);
      } catch (error) {
        if (current()) options2.showNote(error instanceof Error ? error.message : "Transcription failed");
      } finally {
        if (transcription === entry) {
          transcription = null;
          if (owns(owner)) options2.status("");
          updateButton();
        }
      }
    }
    function insert(text17) {
      if (disposed) return;
      const input = document2.getElementById("promptInput");
      if (!input) return;
      const result = insertAtCaret(input.value, input.selectionStart, input.selectionEnd, text17);
      input.value = result.value;
      try {
        input.setSelectionRange(result.caret, result.caret);
      } catch {
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
    function mount() {
      const btn = button();
      if (!btn || disposed || mounted) return;
      mounted = true;
      const signal = lifetime.signal;
      btn.addEventListener("pointerdown", (event) => {
        pointerType = event.pointerType || "mouse";
        const unavailable = reason();
        if (unavailable) {
          options2.showNote(unavailable.message);
          return;
        }
        if (pointerType === "touch") {
          event.preventDefault();
          try {
            btn.setPointerCapture(event.pointerId);
          } catch {
          }
          void start();
        }
      }, { signal });
      const releaseHold = (event) => {
        if ((event.pointerType || pointerType) === "touch") stop();
      };
      btn.addEventListener("pointerup", releaseHold, { signal });
      btn.addEventListener("pointercancel", releaseHold, { signal });
      btn.addEventListener("pointerleave", releaseHold, { signal });
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        const held = pointerType === "touch";
        pointerType = "";
        if (held) return;
        const unavailable = reason();
        if (unavailable) {
          options2.showNote(unavailable.message);
          return;
        }
        if (transcription) return;
        if (take) stop();
        else void start();
      }, { signal });
    }
    return {
      host,
      reason,
      isRecording,
      updateButton,
      mount,
      updateStatus,
      start,
      stop,
      cancel,
      release,
      finish,
      transcribe,
      insert,
      dispose() {
        cancel();
        lifetime.abort();
        disposed = true;
      }
    };
  }

  // src/browser/composer-images.ts
  function decodeComposerImages(value) {
    return Array.isArray(value) ? value.flatMap((image) => record8(image) && typeof image.data === "string" && typeof image.mimeType === "string" && image.mimeType.startsWith("image/") ? [{ data: image.data, mimeType: image.mimeType }] : []) : [];
  }
  function createComposerImages(options2) {
    const { document: document2 } = options2;
    const stored = /* @__PURE__ */ new Map(), aliases = /* @__PURE__ */ new Map();
    const batches = /* @__PURE__ */ new Set(), readers = /* @__PURE__ */ new Set();
    let disposed = false, renderEvents = new AbortController(), lightbox = null;
    function resolve(key) {
      const seen = /* @__PURE__ */ new Set();
      while (aliases.has(key) && !seen.has(key)) {
        seen.add(key);
        key = aliases.get(key);
      }
      return key;
    }
    function currentKey() {
      const key = options2.owner();
      return key ? resolve(key) : null;
    }
    function current() {
      const key = currentKey();
      return key ? stored.get(key) || [] : [];
    }
    function render() {
      renderEvents.abort();
      const strip = document2.getElementById("attachmentStrip");
      if (!strip) return;
      strip.innerHTML = "";
      const key = currentKey(), images = current();
      if (disposed || !key || !images.length) {
        strip.style.display = "none";
        return;
      }
      renderEvents = new AbortController();
      const events = renderEvents;
      for (const image of images) {
        const thumb = document2.createElement("span");
        thumb.className = "attachment-thumb";
        const img = document2.createElement("img");
        img.src = `data:${image.mimeType};base64,${image.data}`;
        img.alt = "";
        const remove2 = document2.createElement("button");
        remove2.className = "attachment-remove";
        remove2.title = "Remove";
        remove2.textContent = "\u2715";
        remove2.addEventListener("click", () => {
          if (events.signal.aborted || currentKey() !== key || stored.get(key) !== images || !strip.contains(remove2)) return;
          stored.set(key, images.filter((candidate) => candidate !== image));
          render();
        }, { signal: events.signal });
        thumb.append(img, remove2);
        strip.append(thumb);
      }
      strip.style.display = "";
    }
    function replace(key, value) {
      if (disposed) return;
      stored.set(resolve(key), decodeComposerImages(value));
      if (currentKey() === resolve(key)) render();
    }
    function append(key, value, prepend = true) {
      if (disposed) return;
      key = resolve(key);
      const images = decodeComposerImages(value), before = stored.get(key) || [];
      if (images.length) stored.set(key, prepend ? [...images, ...before] : [...before, ...images]);
      if (currentKey() === key) render();
    }
    function discard(key) {
      key = resolve(key);
      stored.delete(key);
      for (const batch of batches) if (batch.key === key) batch.retired = true;
      if (currentKey() === key) render();
    }
    function migrate(from, to) {
      from = resolve(from);
      to = resolve(to);
      if (disposed || from === to) return;
      const source = stored.get(from) || [];
      if (source.length) stored.set(to, [...source, ...stored.get(to) || []]);
      stored.delete(from);
      aliases.set(from, to);
      for (const batch of batches) if (batch.key === from) batch.key = to;
      render();
    }
    function take() {
      const key = currentKey(), images = current();
      if (!key || !images.length || disposed) return null;
      stored.delete(key);
      render();
      return images;
    }
    function remove(index) {
      const key = currentKey(), images = current();
      if (disposed || !key || !Number.isInteger(index) || index < 0 || index >= images.length) return;
      stored.set(key, images.filter((_, i) => i !== index));
      render();
    }
    function read(file) {
      if (disposed) return Promise.reject(new Error("Image attachments disposed"));
      return new Promise((resolve2, reject) => {
        const reader = new FileReader();
        readers.add(reader);
        const cleanup = () => {
          readers.delete(reader);
          reader.onload = null;
          reader.onerror = null;
          reader.onabort = null;
        };
        reader.onload = () => {
          const value = String(reader.result);
          cleanup();
          resolve2(value.slice(value.indexOf(",") + 1));
        };
        reader.onerror = reader.onabort = () => {
          cleanup();
          reject(new Error("read failed"));
        };
        try {
          reader.readAsDataURL(file);
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    }
    async function prepare(file) {
      if (disposed) throw new Error("Image attachments disposed");
      const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(file).catch(() => null) : null;
      if (disposed) {
        bitmap?.close();
        throw new Error("Image attachments disposed");
      }
      if (!bitmap) return { data: await read(file), mimeType: file.type };
      try {
        const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
        if (scale === 1 && file.size <= 512 * 1024) return { data: await read(file), mimeType: file.type };
        const canvas = document2.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image canvas unavailable");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", 0.85);
        return { data: url.slice(url.indexOf(",") + 1), mimeType: "image/jpeg" };
      } finally {
        bitmap.close();
      }
    }
    async function add(files) {
      const key = currentKey();
      if (disposed || !key) return;
      const batch = { key, retired: false };
      batches.add(batch);
      try {
        for (const file of Array.from(files || [])) {
          if (disposed || batch.retired) break;
          if (!file?.type?.startsWith("image/")) continue;
          try {
            const image = await prepare(file);
            if (!disposed && !batch.retired) append(batch.key, [image], false);
          } catch (error) {
            if (!disposed && !batch.retired && currentKey() === batch.key) options2.status(`Could not attach ${file.name || "image"}: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
        }
      } finally {
        batches.delete(batch);
      }
    }
    function closeLightbox() {
      if (lightbox) {
        lightbox.events.abort();
        lightbox.element.remove();
        lightbox = null;
      }
    }
    function openLightbox(src) {
      if (disposed) return;
      closeLightbox();
      const overlay = document2.createElement("div");
      overlay.className = "lightbox-overlay";
      const image = document2.createElement("img");
      image.src = src;
      overlay.append(image);
      const entry = { element: overlay, events: new AbortController() };
      lightbox = entry;
      overlay.addEventListener("click", () => {
        if (lightbox === entry) closeLightbox();
      }, { signal: entry.events.signal });
      document2.body.append(overlay);
    }
    return {
      current,
      render,
      replace,
      append,
      discard,
      migrate,
      take,
      remove,
      prepare,
      read,
      add,
      openLightbox,
      closeLightbox,
      stored: (key) => stored.get(resolve(key)) || [],
      dispose() {
        disposed = true;
        for (const batch of batches) batch.retired = true;
        for (const reader of [...readers]) reader.abort();
        stored.clear();
        aliases.clear();
        renderEvents.abort();
        render();
        closeLightbox();
      }
    };
  }

  // src/browser/composer-drafts.ts
  function mergeComposerText(existing, restored) {
    const current = existing.trim();
    return !current || current === restored ? restored : `${existing}

${restored}`;
  }
  function createComposerDrafts(options2) {
    const { document: document2, storage } = options2;
    let key = null, dirty = false, history = [], historyIndex = -1, historyStash = "", timer = null, generation = 0, disposed = false;
    const images = createComposerImages({ document: document2, owner: () => key, status: options2.status });
    const input = () => document2.getElementById("promptInput");
    function ownerKey(id) {
      return id.startsWith("spawn:") || id.includes(" ") ? id : options2.keyForSession(id);
    }
    function draftKey(id) {
      return "pi-dish-draft-" + ownerKey(id);
    }
    function historyKey(id) {
      return "pi-dish-history-" + ownerKey(id);
    }
    function read(name) {
      try {
        return storage.getItem(name) || "";
      } catch {
        return "";
      }
    }
    function readHistory(id) {
      try {
        const value = JSON.parse(read(historyKey(id)) || "[]");
        return Array.isArray(value) ? value.filter((value2) => typeof value2 === "string").slice(-50) : [];
      } catch {
        return [];
      }
    }
    function cancelTimer() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
    function write(id, value) {
      if (disposed || !id) return;
      try {
        if (value.trim() && value.length < 5e4) storage.setItem(draftKey(id), value);
        else storage.removeItem(draftKey(id));
      } catch {
      }
    }
    function stash() {
      cancelTimer();
      generation++;
      if (!key) return;
      if (dirty) write(key, input().value);
      key = null;
      dirty = false;
      images.render();
    }
    function clear() {
      cancelTimer();
      generation++;
      if (key) images.discard(key);
      key = null;
      dirty = false;
      input().value = "";
      input().style.height = "";
      images.render();
    }
    function waiting(value) {
      input().placeholder = value ? "Write your prompt while Pi starts\u2026" : "Send a message...";
      const button = document2.getElementById("btnSend");
      if (button) {
        button.disabled = value;
        button.title = value ? "Your draft will be preserved until Pi connects" : "Send";
      }
    }
    function saveSoon() {
      if (disposed) return;
      cancelTimer();
      const owner = key, version = generation;
      dirty = true;
      timer = setTimeout(() => {
        timer = null;
        if (disposed || !owner || key !== owner || generation !== version) return;
        write(owner, input().value);
        dirty = false;
      }, 300);
    }
    function clearDraft(id = key) {
      if (disposed || !id) return;
      const owner = ownerKey(id);
      if (key === owner) {
        cancelTimer();
        dirty = false;
      }
      try {
        storage.removeItem(draftKey(owner));
      } catch {
      }
    }
    function restore(id = options2.currentSessionId()) {
      if (disposed || !id) return;
      const owner = ownerKey(id);
      if (key && dirty) write(key, input().value);
      cancelTimer();
      key = owner;
      dirty = false;
      generation++;
      input().value = read(draftKey(owner));
      images.render();
      options2.autosize(input());
      historyIndex = -1;
      historyStash = "";
      history = readHistory(owner);
    }
    function record9(message3, id = key) {
      if (disposed || !id) return;
      const owner = ownerKey(id), next = pushPromptHistory(key === owner ? history : readHistory(owner), message3, 50);
      if (key === owner) {
        history = next;
        historyIndex = -1;
      }
      try {
        storage.setItem(historyKey(owner), JSON.stringify(next));
      } catch {
      }
    }
    function migrate(from, to) {
      if (disposed) return;
      from = ownerKey(from);
      to = ownerKey(to);
      if (from === to) return;
      if (key === from && dirty) {
        cancelTimer();
        write(from, input().value);
        dirty = false;
      }
      const source = read(draftKey(from)), destination = read(draftKey(to));
      try {
        storage.removeItem(draftKey(from));
      } catch {
      }
      if (source) {
        const merged = mergeComposerText(key === to ? input().value : destination, source);
        write(to, merged);
        if (key === to) {
          input().value = merged;
          dirty = false;
          options2.autosize(input());
        }
      }
      images.migrate(from, to);
    }
    function restorePayload(id, message3, attachments) {
      if (disposed || !id) return;
      const owner = ownerKey(id), saved = read(draftKey(owner));
      write(owner, message3 ? mergeComposerText(saved, message3) : saved);
      if (attachments?.length) images.append(owner, attachments);
      if (key === owner && message3) {
        input().value = mergeComposerText(input().value, message3);
        input().dispatchEvent(new Event("input", { bubbles: true }));
        input().focus();
      }
    }
    function navigate(direction, target = input()) {
      if (disposed || !key || !history.length || target !== input()) return false;
      if (direction < 0) {
        if (historyIndex === -1) {
          historyStash = target.value;
          historyIndex = history.length - 1;
        } else if (historyIndex > 0) historyIndex--;
        else return true;
      } else {
        historyIndex++;
        if (historyIndex >= history.length) historyIndex = -1;
      }
      const value = historyIndex === -1 ? historyStash : history[historyIndex];
      target.value = value;
      target.setSelectionRange(value.length, value.length);
      options2.autosize(target);
      return true;
    }
    return {
      images,
      ownerKey,
      draftKey,
      historyKey,
      write,
      stash,
      clear,
      waiting,
      saveSoon,
      clearDraft,
      restore,
      record: record9,
      migrate,
      restorePayload,
      navigate,
      exitHistory() {
        historyIndex = -1;
      },
      get key() {
        return key;
      },
      get historyIndex() {
        return historyIndex;
      },
      dispose() {
        stash();
        disposed = true;
        images.dispose();
      }
    };
  }

  // src/browser/helper-refs.ts
  function uniqueSessionPrefix(id, peerIds, minLen = 8) {
    const self = String(id == null ? "" : id);
    if (!self) return "";
    const peers = (peerIds || []).filter((peer) => peer && peer !== self);
    for (let len = Math.min(minLen, self.length); len < self.length; len++) {
      const candidate = self.slice(0, len);
      if (!peers.some((peer) => String(peer).startsWith(candidate))) return candidate;
    }
    return self;
  }
  var SESSION_ROUTE_KEY_PREFIX = "~sk1_";
  var SESSION_UUID_TAIL_RE = /(?:^|[_-])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  function decodeBase64Url(value) {
    const normalized = String(value == null ? "" : value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
    if (typeof atob !== "function") return "";
    return atob(padded);
  }
  function decodeRouteSessionId(id) {
    const raw = String(id == null ? "" : id);
    if (!raw.startsWith(SESSION_ROUTE_KEY_PREFIX)) return null;
    try {
      const tuple = JSON.parse(decodeBase64Url(raw.slice(SESSION_ROUTE_KEY_PREFIX.length)));
      if (!Array.isArray(tuple)) return null;
      if (typeof tuple[0] !== "string" || !tuple[0]) return null;
      if (typeof tuple[1] !== "string" || !tuple[1]) return null;
      return { harnessId: tuple[0], nativeSessionId: tuple[1] };
    } catch {
      return null;
    }
  }
  function sessionRefAliases(id) {
    const routeId = String(id == null ? "" : id);
    if (!routeId) return [];
    const aliases = [routeId];
    const decoded = decodeRouteSessionId(routeId);
    const native = decoded ? decoded.nativeSessionId : routeId;
    if (native !== routeId) aliases.push(native);
    const uuid = SESSION_UUID_TAIL_RE.exec(native);
    if (uuid) aliases.push(uuid[1]);
    return aliases;
  }
  function shortSessionRef(id, peerIds, minLen = 8) {
    const self = String(id == null ? "" : id);
    if (!self) return "";
    const peers = [];
    for (const peer of peerIds || []) {
      const other = String(peer == null ? "" : peer);
      if (!other || other === self) continue;
      peers.push(...sessionRefAliases(other));
    }
    let best = self;
    for (const alias of sessionRefAliases(self).slice().reverse()) {
      const candidate = uniqueSessionPrefix(alias, peers, minLen);
      if (candidate && candidate.length < best.length) best = candidate;
    }
    return best;
  }
  var SESSION_REF_TOKEN_RE = /(?:^|[\s(\[{<"'])#([A-Za-z0-9][A-Za-z0-9._:/-]{3,})/g;
  function parseSessionRefTokens(text17) {
    const out = [];
    if (!text17) return out;
    const seen = /* @__PURE__ */ new Set();
    SESSION_REF_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = SESSION_REF_TOKEN_RE.exec(String(text17))) !== null) {
      const ref = match[1].replace(/[.:/]+$/, "");
      if (ref.length < 4 || seen.has(ref)) continue;
      seen.add(ref);
      out.push({ token: "#" + ref, ref });
    }
    return out;
  }
  var SESSION_REF_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function parseSessionRefParts(raw) {
    const ref = String(raw == null ? "" : raw).trim();
    if (!ref) return null;
    const slash = ref.indexOf("/");
    if (slash !== -1) {
      const hostPart = ref.slice(0, slash);
      const id = ref.slice(slash + 1);
      return hostPart && id ? { hostPart, hostIdForm: false, id } : null;
    }
    const colon = ref.indexOf(":");
    if (colon > 0) {
      const head = ref.slice(0, colon);
      const rest = ref.slice(colon + 1);
      if (SESSION_REF_UUID_RE.test(head) && rest) return { hostPart: head, hostIdForm: true, id: rest };
    }
    return { hostPart: null, hostIdForm: false, id: ref };
  }
  var SESSION_REF_BLOCK_RE = /\n*<session-refs>\n([\s\S]*?)\n<\/session-refs>[ \t]*$/;
  var SESSION_REF_PREAMBLE = [
    "The message above references other pi-dish sessions by `#ref`. Each is a real",
    "peer session, not a label: use the pi-dish-sessions skill CLI to read its",
    "transcript (`read <ref>`) or to message it (`send` / `steer` / `follow-up`",
    "<ref>). Never guess what a referenced session holds \u2014 read it."
  ].join("\n");
  function splitSessionRefContext(text17) {
    const body = String(text17 == null ? "" : text17);
    const match = body.match(SESSION_REF_BLOCK_RE);
    if (!match) return { text: body, refs: [] };
    const refs = [];
    for (const line of match[1].split("\n")) {
      if (!line.startsWith("- ref=")) continue;
      const entry = /* @__PURE__ */ Object.create(null);
      for (const field of line.slice(2).split(" | ")) {
        const eq = field.indexOf("=");
        if (eq > 0) entry[field.slice(0, eq)] = field.slice(eq + 1);
      }
      if (!entry.ref) continue;
      refs.push({
        ref: entry.ref,
        name: entry.name || "",
        host: entry.host || "",
        cwd: entry.cwd || "",
        isActive: entry.active === "yes"
      });
    }
    return { text: body.slice(0, match.index).replace(/\s+$/, ""), refs };
  }
  function searchSessionsForRef(list, query, limit = 8) {
    const q = String(query == null ? "" : query).trim();
    const lower = q.toLowerCase();
    const rows = [];
    for (const session of list || []) {
      if (!session || !session.id) continue;
      let score = 0;
      let indices = null;
      if (q) {
        const name = String(session.name || "");
        indices = fuzzyMatch(q, name);
        if (indices) {
          score = 1e3 + fuzzyScore(indices, name);
        } else {
          const cwd = String(session.cwd || "");
          const cwdIndices = fuzzyMatch(q, cwd);
          if (cwdIndices) score = 500 + fuzzyScore(cwdIndices, cwd);
          else if (sessionRefAliases(session.id).some((alias) => alias.toLowerCase().startsWith(lower))) score = 250;
          else continue;
        }
      }
      rows.push({ session, score, indices });
    }
    rows.sort((a, b) => b.score - a.score || (b.session.isActive ? 1 : 0) - (a.session.isActive ? 1 : 0) || new Date(b.session.lastActivity || 0).getTime() - new Date(a.session.lastActivity || 0).getTime());
    return rows.slice(0, Math.max(0, limit));
  }

  // src/browser/session-references.ts
  function createSessionReferences(options2) {
    const { sessionState } = options2;
    function hostId(session) {
      return session?.host || options2.selfId();
    }
    function all() {
      return [...sessionState.sessions.active, ...sessionState.sessions.previous].map((row) => ({
        id: row.id,
        host: row.host || null,
        name: typeof row.name === "string" ? row.name : "",
        cwd: typeof row.cwd === "string" ? row.cwd : "",
        isActive: row.isActive === true,
        lastActivity: typeof row.lastActivity === "number" || typeof row.lastActivity === "string" ? row.lastActivity : 0
      }));
    }
    function candidates() {
      const current = sessionState.currentSession;
      return all().filter((row) => !current || row.id !== current.id || hostId(row) !== hostId(current));
    }
    function sameHostIds(session) {
      return all().filter((row) => hostId(row) === hostId(session)).map((row) => row.id);
    }
    function prefix(session) {
      const endpoint = options2.host(hostId(session)), ids = sameHostIds(session);
      const aliases = endpoint && (record8(endpoint.capabilities) ? endpoint.capabilities.refAliases === true : (endpoint.self === true || endpoint.base === "") && !!options2.config().refAliases);
      return aliases ? shortSessionRef(session.id, ids) : uniqueSessionPrefix(session.id, ids);
    }
    function ref(session, target) {
      const sourceHost = hostId(session), targetHost = hostId(target), short = prefix(session);
      if (sourceHost === targetHost) return short;
      if (targetHost === options2.selfId()) {
        const entry = options2.host(sourceHost);
        if (entry?.name) return `${entry.name}/${short}`;
      }
      return `${sourceHost}:${session.id}`;
    }
    function match(value, localHostId = sessionState.currentSession ? hostId(sessionState.currentSession) : options2.selfId()) {
      const parts = parseSessionRefParts(value);
      if (!parts) return null;
      const onHost = all().filter((session) => {
        const host = hostId(session);
        if (!parts.hostPart) return host === localHostId;
        if (parts.hostIdForm) return host === parts.hostPart;
        if (parts.hostPart.toLowerCase() === "self") return host === localHostId;
        const entry = options2.host(host);
        return !!entry && String(entry.name || "").toLowerCase() === parts.hostPart.toLowerCase();
      });
      const exact = onHost.find((row) => row.id === parts.id);
      if (exact || parts.hostIdForm) return exact || null;
      const matches = onHost.filter((row) => row.id.startsWith(parts.id));
      return matches.length === 1 ? matches[0] : null;
    }
    function hints(message3) {
      return parseSessionRefTokens(message3).flatMap(({ ref: ref2 }) => {
        const session = match(ref2);
        return session ? [{ ref: ref2, name: session.name, host: options2.hostLabel(session.host) || "", cwd: session.cwd, isActive: session.isActive }] : [];
      });
    }
    return { all, hostId, candidates, sameHostIds, prefix, ref, match, hints, search: (token) => searchSessionsForRef(candidates(), token, 8) };
  }

  // src/browser/composer-autocomplete-data.ts
  var text16 = (v) => typeof v === "string" ? v : "";
  function decodeSlashCommands(value) {
    return Array.isArray(value) ? value.flatMap((v) => record8(v) && typeof v.name === "string" && v.name ? [{ name: v.name, description: text16(v.description), source: text16(v.source), args: text16(v.args) }] : []) : [];
  }
  function decodeFileCompletions(value) {
    return Array.isArray(value) ? value.flatMap((v) => record8(v) && typeof v.path === "string" ? [{ path: v.path, isDir: v.isDir === true, gitStatus: text16(v.gitStatus) }] : []) : [];
  }

  // src/browser/composer-autocomplete.ts
  function createComposerAutocomplete(options2) {
    const { document: document2, sessionState, references } = options2;
    const input = () => document2.getElementById("promptInput");
    let disposed = false, visible = false, index = 0, fileSequence = 0, commandSequence = 0;
    let fileTimer = null, events = new AbortController(), view = null, commandOwner = null;
    let commands = [];
    const lifetime = new AbortController(), blurTimers = /* @__PURE__ */ new Set();
    const choices = /* @__PURE__ */ new WeakMap();
    function captureRequest() {
      const selection = sessionState.captureSelection();
      if (disposed || !selection) return null;
      const endpoint = options2.host(selection.host);
      return endpoint ? { selection, endpoint: Object.freeze({ ...endpoint }) } : null;
    }
    function ownsRequest(owner) {
      return !!owner && !disposed && sessionState.ownsSelection(owner.selection) && options2.host(owner.selection.host)?.base === owner.endpoint.base;
    }
    function capture() {
      const owner = captureRequest(), composer = options2.composerKey();
      return owner && composer && !options2.provisional() ? { ...owner, composer, text: input().value, caret: input().selectionStart } : null;
    }
    function owns(owner) {
      return ownsRequest(owner) && !!owner && !options2.provisional() && owner.composer === options2.composerKey() && owner.text === input().value && owner.caret === input().selectionStart;
    }
    function container() {
      let root = document2.getElementById("autocomplete");
      if (!root) {
        root = document2.createElement("div");
        root.id = "autocomplete";
        root.className = "autocomplete-dropdown";
        document2.querySelector(".input-area").appendChild(root);
      }
      return root;
    }
    function hide() {
      for (const timer of blurTimers) clearTimeout(timer);
      blurTimers.clear();
      visible = false;
      view = null;
      fileSequence++;
      if (fileTimer !== null) clearTimeout(fileTimer);
      fileTimer = null;
      events.abort();
      const root = document2.getElementById("autocomplete");
      if (root) {
        root.style.display = "none";
        root.innerHTML = "";
      }
    }
    function render(rows, owner = capture()) {
      hide();
      if (!owns(owner) || !rows.length) return;
      view = owner;
      visible = true;
      index = 0;
      events = new AbortController();
      const ownedEvents = events, root = container();
      rows.forEach((row, i) => {
        const element = document2.createElement("div");
        element.className = "autocomplete-item" + (i === 0 ? " active" : "");
        const { choice } = row;
        choices.set(element, choice);
        if (choice.kind === "file") {
          element.dataset.file = choice.path;
          if (choice.directory) element.dataset.dir = "1";
        } else if (choice.kind === "ref") element.dataset.sessionRef = choice.ref;
        else element.dataset.name = choice.name;
        element.innerHTML = `<span class="autocomplete-icon${choice.kind === "ref" ? " session-ref-dot" + (row.live ? " live" : "") : ""}">${row.icon}</span><span class="autocomplete-name">${row.nameHtml}</span><span class="autocomplete-desc">${escapeHtml(row.description)}</span>`;
        element.addEventListener("click", () => {
          if (!ownedEvents.signal.aborted && view === owner && owns(owner)) accept(element);
        }, { signal: ownedEvents.signal });
        root.append(element);
      });
      root.style.display = "block";
    }
    function showCommands(value) {
      const rows = decodeSlashCommands(value);
      render(rows.map((command) => ({ choice: { kind: "command", name: command.name }, icon: command.source === "builtin" || command.source === "host" ? "\u2699\uFE0F" : command.source === "extension" ? "\u{1F9E9}" : command.source === "skill" ? "\u{1F4DA}" : "\u{1F4DD}", nameHtml: "/" + escapeHtml(command.name) + (command.args ? ` <span class="autocomplete-args">${escapeHtml(command.args)}</span>` : ""), description: command.description })));
    }
    function showFiles(value, owner = capture()) {
      const labels = { modified: "\xB1 modified", untracked: "+ new", staged: "\u25CF staged" };
      render(decodeFileCompletions(value).map((file) => ({ choice: { kind: "file", path: file.path, directory: file.isDir }, icon: file.isDir ? "\u{1F4C1}" : "\u{1F4C4}", nameHtml: escapeHtml(file.path) + (file.isDir ? "/" : ""), description: Object.hasOwn(labels, file.gitStatus) ? labels[file.gitStatus] : "" })), owner);
    }
    function showRefs(token) {
      const current = sessionState.currentSession;
      if (!current) {
        hide();
        return;
      }
      render(references.search(token).map(({ session, indices }) => {
        const ref = references.ref(session, current), name = session.name || session.id.slice(0, 8);
        return { choice: { kind: "ref", ref }, icon: "\u25CF", nameHtml: indices ? highlightFuzzy(name, indices) : escapeHtml(name), description: [options2.multiHost() ? options2.hostLabel(session.host) : "", ref, shortCwd(session.cwd)].filter(Boolean).join(" \xB7 "), live: session.isActive };
      }));
    }
    async function loadCommands(id) {
      const owner = captureRequest(), sequence = ++commandSequence;
      commands = [];
      commandOwner = null;
      if (!owner || id && owner.selection.id !== id) return;
      try {
        const response = await options2.request(owner.endpoint, "/api/commands" + (id ? "?sessionId=" + encodeURIComponent(id) : ""));
        const value = await response.json();
        if (!response.ok || !ownsRequest(owner) || sequence !== commandSequence) return;
        commands = decodeSlashCommands(value);
        commandOwner = owner;
      } catch (error) {
        if (ownsRequest(owner) && sequence === commandSequence) options2.failed(error);
      }
    }
    function queueFile(token) {
      hide();
      const owner = capture();
      if (!owner) return;
      const sequence = ++fileSequence;
      fileTimer = setTimeout(() => {
        fileTimer = null;
        if (!owns(owner) || sequence !== fileSequence) return;
        const endpoint = options2.host(owner.selection.host);
        if (!endpoint || endpoint.base !== owner.endpoint.base) return;
        void options2.request({ ...owner.endpoint, token: endpoint.token }, `/api/sessions/${encodeURIComponent(owner.selection.id)}/files?q=${encodeURIComponent(token)}`).then(async (response) => {
          const value = await response.json();
          if (!owns(owner) || sequence !== fileSequence) return;
          if (document2.activeElement !== input()) {
            hide();
            return;
          }
          if (response.ok && record8(value)) showFiles(value.files, owner);
          else hide();
        }).catch(() => {
          if (owns(owner) && sequence === fileSequence) hide();
        });
      }, 120);
    }
    function handle(text17) {
      if (disposed || options2.provisional()) {
        hide();
        return;
      }
      const caret = input().selectionStart, at = text17.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
      if (at && sessionState.currentSession) {
        queueFile(at[1]);
        return;
      }
      const hash = text17.slice(0, caret).match(/(?:^|\s)#([^\s#]*)$/);
      if (hash && sessionState.currentSession) {
        showRefs(hash[1]);
        return;
      }
      if (!text17.startsWith("/") || text17.includes(" ") || !ownsRequest(commandOwner)) {
        hide();
        return;
      }
      const query = text17.slice(1), matches = commands.filter((command) => command.name.toLowerCase().startsWith(query.toLowerCase()));
      if (!matches.length || matches.length === 1 && matches[0].name === query) {
        hide();
        return;
      }
      showCommands(matches);
    }
    function insert(choice) {
      const owner = view;
      if (!owns(owner)) return;
      const target = input(), caret = target.selectionStart;
      if (choice.kind === "command") {
        hide();
        target.value = "/" + choice.name + " ";
        target.focus();
        target.dispatchEvent(new Event("input"));
        return;
      }
      const token = choice.kind === "file" ? "@" : "#", match = target.value.slice(0, caret).match(choice.kind === "file" ? /(?:^|\s)@([^\s@]*)$/ : /(?:^|\s)#([^\s#]*)$/);
      hide();
      if (!match) return;
      const start = caret - match[1].length - 1, value = choice.kind === "file" ? choice.path + (choice.directory ? "/" : " ") : choice.ref + " ";
      target.value = target.value.slice(0, start) + token + value + target.value.slice(caret);
      const position = start + 1 + value.length;
      target.focus();
      target.setSelectionRange(position, position);
      target.dispatchEvent(new Event("input"));
    }
    function accept(element) {
      if (!visible || !owns(view) || !container().contains(element)) return;
      const choice = choices.get(element);
      if (choice) insert(choice);
    }
    function move(delta) {
      if (!visible || !owns(view)) return;
      const rows = [...container().querySelectorAll(".autocomplete-item")];
      if (!rows.length) return;
      index = (index + delta + rows.length) % rows.length;
      rows.forEach((row, i) => row.classList.toggle("active", i === index));
      rows[index].scrollIntoView({ block: "nearest" });
    }
    input().addEventListener("blur", () => {
      const owner = view, timer = setTimeout(() => {
        blurTimers.delete(timer);
        if (!disposed && view === owner && document2.activeElement !== input()) hide();
      }, 200);
      blurTimers.add(timer);
    }, { signal: lifetime.signal });
    const retireMovedCaret = () => {
      if (view && !owns(view)) hide();
    };
    document2.addEventListener("selectionchange", retireMovedCaret, { signal: lifetime.signal });
    input().addEventListener("select", retireMovedCaret, { signal: lifetime.signal });
    function retireCommands() {
      commandSequence++;
      commands = [];
      commandOwner = null;
    }
    return {
      retireCommands,
      loadCommands,
      handle,
      queueFile,
      showFiles,
      showRefs,
      showCommands,
      hide,
      move,
      accept,
      acceptFile: (path, directory) => insert({ kind: "file", path, directory }),
      acceptRef: (ref) => insert({ kind: "ref", ref }),
      acceptCommand: (name) => insert({ kind: "command", name }),
      get visible() {
        return visible && owns(view);
      },
      get index() {
        return index;
      },
      dispose() {
        hide();
        lifetime.abort();
        commandSequence++;
        commands = [];
        commandOwner = null;
        disposed = true;
      }
    };
  }

  // src/browser/sidebar-render.ts
  function sidebarSession(row) {
    const string3 = (value) => typeof value === "string" ? value : "";
    const capabilities = {};
    if (record8(row.capabilities)) {
      for (const [key, value] of Object.entries(row.capabilities)) if (typeof value === "boolean") capabilities[key] = value;
    }
    const parent = typeof row.familyParentId === "string" ? row.familyParentId : null;
    return {
      id: row.id,
      host: row.host,
      hostLabel: typeof row.hostLabel === "string" ? row.hostLabel : void 0,
      name: string3(row.name),
      cwd: string3(row.cwd),
      model: string3(row.model),
      lastActivity: typeof row.lastActivity === "string" || finite2(row.lastActivity) ? row.lastActivity : null,
      isActive: row.isActive === true,
      turnInProgress: row.turnInProgress === true,
      subagentLive: row.subagentLive === true,
      compacting: row.compacting === true,
      parentId: string3(row.parentId),
      ...Object.hasOwn(row, "familyParentId") ? { familyParentId: parent } : {},
      routine: string3(row.routine),
      routineId: string3(row.routineId),
      capabilities,
      contextPercent: finite2(row.contextPercent) ? row.contextPercent : 0,
      contextTokens: finite2(row.contextTokens) ? row.contextTokens : void 0,
      thinkingLevel: string3(row.thinkingLevel),
      closeMode: string3(row.closeMode),
      harnessId: string3(row.harnessId),
      harnessLabel: string3(row.harnessLabel),
      searchSnippet: string3(row.searchSnippet),
      searchScore: finite2(row.searchScore) ? row.searchScore : void 0
    };
  }
  function harnessBadgeInnerHtml(info) {
    const icon = info.icon ? `<img class="harness-badge-icon" src="${escapeHtml(info.icon)}" alt="">` : '<span class="harness-badge-icon harness-badge-icon-fallback" aria-hidden="true">\u25C6</span>';
    return icon + `<span class="harness-badge-label">${escapeHtml(info.label)}</span>`;
  }
  function renderHarnessBadge(harnessId, harnessLabel) {
    const id = harnessId || "pi";
    const info = harnessBadgeInfo(id, harnessLabel);
    const title = harnessLabel || info.label;
    return `<span class="harness-badge harness-badge-${escapeHtml(id)}" title="${escapeHtml(title)} harness" aria-label="${escapeHtml(title)} harness">${harnessBadgeInnerHtml(info)}</span>`;
  }
  function renderSidebar(options2) {
    const canonical = (key) => options2.roots.get(key) || key;
    const hostIsDown = (host) => host.state === "blocked" || host.state === "backoff";
    function renderSessionItem(session, opts = {}) {
      const ctxClass = contextClass(session.contextPercent);
      const activeClass = options2.selected && sessionRefKey(options2.selected) === sessionRefKey(session) ? "active" : "";
      const inactiveClass = session.isActive || session.subagentLive ? "" : "inactive";
      const familyNode = opts.familyNode || null;
      const hasChildren = !!familyNode?.children?.length;
      const familyExpanded = hasChildren && options2.expanded.has(sessionRefKey(session));
      const statusSessions = hasChildren && !familyExpanded ? flattenSessionFamilies(familyNode ? [familyNode] : []) : [session];
      let liveDot = "";
      if (statusSessions.some((s) => s.compacting || s.turnInProgress)) {
        liveDot = '<span class="session-item-status working" title="Session family working"></span>';
      } else if (statusSessions.some(options2.unread)) {
        liveDot = '<span class="session-item-status unread" title="New activity in session family"></span>';
      } else if (options2.tab === "all" && statusSessions.some((s) => s.isActive)) {
        liveDot = '<span class="live-dot" title="Active session family"></span>';
      } else if (statusSessions.some((s) => s.subagentLive)) {
        liveDot = '<span class="live-dot" title="Subagent still loaded in its parent session"></span>';
      }
      const displayName = session.name || "Unnamed";
      const ctxText = options2.contextMetric === "tokens" && session.contextTokens ? `${formatTokens(session.contextTokens)} tok` : `${session.contextPercent}%`;
      const ctxTitle = session.contextTokens ? `${session.contextPercent}% of context \xB7 ${formatTokens(session.contextTokens)} tokens` : `${session.contextPercent}% of context`;
      const timeAgo = formatRelativeTime(hasChildren ? familyNode.activity : session.lastActivity);
      const canonicalRootKey = canonical(opts.familyRootKey || sessionRefKey(session));
      const isPinned = opts.familyPinned ?? options2.pinned.some((pin) => canonical(pin) === canonicalRootKey);
      const pinBtn = `<button class="session-pin-btn${isPinned ? " pinned" : ""}" title="${isPinned ? "Unpin family" : "Pin family to top"}">\u{1F4CC}</button>`;
      const familyToggle = hasChildren ? `<button class="session-family-toggle" data-family-id="${escapeHtml(session.id)}" aria-expanded="${familyExpanded}" aria-label="${familyExpanded ? "Collapse" : "Show"} ${familyNode.size - 1} child session${familyNode.size === 2 ? "" : "s"}" title="${familyExpanded ? "Collapse" : "Show"} ${familyNode.size - 1} child session${familyNode.size === 2 ? "" : "s"}"><span>${familyExpanded ? "\u25BE" : "\u25B8"}</span><small>${familyNode.size - 1}</small></button>` : (opts.familyDepth || 0) > 0 ? '<span class="session-family-leaf" aria-hidden="true">\u21B3</span>' : "";
      const closeArmed = options2.closeConfirm === sessionRefKey(session);
      const closeBusy = options2.closeBusy === sessionRefKey(session);
      const detachClient = session.closeMode === "client-only";
      const closeTitle = detachClient ? "Detach client" : session.closeMode === "owned-agent" ? "Stop this agent and its children (transcript stays resumable)" : "Close session (transcript stays resumable)";
      const closeBtn = session.isActive && sessionSupports(session, "close") ? `<button class="session-close-btn${closeArmed ? " confirm" : ""}" title="${closeArmed ? "Tap again: " : ""}${closeTitle}">${closeBusy ? "\u2026" : closeArmed ? detachClient ? "detach?" : "close?" : "\u2715"}</button>` : "";
      const harnessBadge = renderHarnessBadge(session.harnessId, session.harnessLabel);
      const routineChip = session.routine ? `<span class="routine-chip" title="Started by the &quot;${escapeHtml(session.routine)}&quot; routine">\u23F1 ${escapeHtml(session.routine)}</span>` : "";
      const dragHandle = opts.pinnedRow ? '<span class="session-drag-handle" title="Drag to reorder">\u283F</span>' : "";
      const cwdHint = opts.pinnedRow || opts.showCwd ? `<span class="session-item-cwd">${escapeHtml(shortCwd(session.cwd || "~"))}</span>` : "";
      const hostChip = opts.pinnedRow || opts.showCwd ? options2.hostChip(session.host) : "";
      const staleHost = options2.hosts.some((host) => (host.hostId || null) === (session.host || null) && hostIsDown(host)) ? " stale-host" : "";
      const snippetLine = session.searchSnippet ? `<div class="session-item-snippet">${highlightTokens(
        session.searchSnippet,
        positiveQueryTokens(parseSessionQuery(options2.query))
      )}</div>` : "";
      const thinkingChip = session.thinkingLevel ? `<span class="session-item-thinking" title="Thinking level: ${escapeHtml(session.thinkingLevel)}">${escapeHtml(session.thinkingLevel)}</span>` : "";
      return `
    <div class="session-item ${activeClass} ${inactiveClass}${closeBusy ? " closing" : ""}${staleHost}" data-id="${escapeHtml(session.id)}"${session.host ? ` data-host="${escapeHtml(session.host)}"` : ""}>
      <div class="session-item-header">
        ${dragHandle}${familyToggle}${liveDot}<span class="session-item-name" title="${escapeHtml(session.id)}">${escapeHtml(displayName)}</span>
        <span class="session-item-time">${timeAgo}</span>
        ${pinBtn}${closeBtn}
      </div>
      <div class="session-item-meta">
        <span class="session-item-model" title="${escapeHtml(session.model || "")}">${escapeHtml(shortModelName(session.model))}</span>
        ${thinkingChip}
        <span class="session-item-context ${ctxClass}" title="${escapeHtml(ctxTitle)}">${escapeHtml(ctxText)}</span>
      </div>
      <div class="session-item-tags${hostChip ? " with-host" : ""}">
        ${hostChip}${harnessBadge}${routineChip}${cwdHint}
      </div>
      ${snippetLine}
    </div>
  `;
    }
    function renderSessionFamily(node, opts = {}, depth = 0, rootId = node.session.id, rootKey = sessionRefKey(node.session)) {
      const expanded = node.children.length > 0 && options2.expanded.has(sessionRefKey(node.session));
      const row = renderSessionItem(node.session, {
        familyNode: node,
        // Carried down so a row never has to look its root's host back up: the
        // sidebar renders thousands of rows and findSession is a linear scan.
        familyRootKey: rootKey,
        familyDepth: depth,
        familyPinned: !!opts.pinnedFamily,
        pinnedRow: !!opts.pinnedFamily && depth === 0,
        showCwd: !!opts.showCwd && depth === 0
      });
      const children = expanded ? `<div class="session-family-children">${node.children.map((child) => renderSessionFamily(child, opts, depth + 1, rootId, rootKey)).join("")}</div>` : "";
      const classes = depth === 0 ? "session-family session-family-root" : "session-family session-family-child";
      const familyAttr = depth === 0 ? ` data-family-id="${escapeHtml(rootId)}" data-family-key="${escapeHtml(rootKey)}"` : "";
      return `<div class="${classes}"${familyAttr}>${row}${children}</div>`;
    }
    function renderPendingSessionItem(spawnId, spawn) {
      const cwd = spawn.cwd || "~";
      const label = spawn.harnessLabel || "Pi";
      const harnessBadge = renderHarnessBadge(spawn.harness, label);
      return `
    <div class="session-item starting${options2.selectedSpawn === spawnId ? " active" : ""}" data-spawn-id="${escapeHtml(spawnId)}">
      <div class="session-item-header">
        <span class="session-item-status working" title="Starting session"></span>
        <span class="session-item-name">Starting ${escapeHtml(label)}\u2026</span>${harnessBadge}
        <span class="session-item-time">now</span>
      </div>
      <div class="session-item-meta">
        ${options2.hostChip(spawn.host)}<span class="session-item-cwd" title="${escapeHtml(cwd)}">${escapeHtml(shortCwd(cwd))}</span>
        <span>${spawn.target ? "tmux" : "headless"}</span>
      </div>
    </div>
  `;
    }
    function renderSessions() {
      hostSectionsShown = null;
      const active = options2.active.map(sidebarSession), previous = options2.previous.map(sidebarSession);
      const showing = options2.tab === "active" ? [...active, ...previous.filter((session) => session.subagentLive)] : [...active, ...previous];
      const pending = options2.pending;
      const sq = options2.scope;
      const scopeParsed = sq ? parseSessionQuery(sq) : null;
      const asksAutomation = queryAsksForAutomation(parseSessionQuery(options2.query)) || (scopeParsed ? queryAsksForAutomation(scopeParsed) : false);
      let visible = showing, automationHidden = 0;
      if (!asksAutomation) {
        visible = showing.filter((session) => {
          if (session.isActive || !isAutomationSession(session)) return true;
          automationHidden++;
          return false;
        });
      }
      const queried = options2.query && options2.queriedFor === options2.query ? applyHostTerms(visible, options2.query) : applyLocalFilter(visible, options2.query);
      const filtered = scopeParsed ? queried.filter((s) => evaluateSessionQuery(scopeParsed, s)) : queried;
      const scopesHidden = queried.length - filtered.length;
      let html = "";
      if (options2.tab === "all" && options2.indexing) {
        html += '<div class="indexing-note">Indexing sessions\u2026</div>';
      }
      if (pending.length) {
        html += `<div class="session-segment starting-segment">
      <div class="workspace-group-header starting-header">
        <span class="workspace-group-label">Starting</span>
        <span class="workspace-group-count">${pending.length}</span>
      </div>
      ${pending.map(([id, spawn]) => renderPendingSessionItem(id, spawn)).join("")}
    </div>`;
      }
      if (filtered.length === 0 && pending.length === 0) {
        const msg = options2.tab === "active" ? active.length === 0 && !options2.query ? 'No active sessions<br><span style="font-size:11px">Click "+ New Session" or resume one from All</span>' : "No matches" : visible.length === 0 && !options2.query ? "No sessions found" : "No matches";
        html += `<div class="empty-session"><p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">${msg}</p></div>`;
      } else if (options2.query) {
        const parsed = parseSessionQuery(options2.query);
        const ranked = filtered.map((s) => [s, s.searchScore ?? scoreSessionMatch(parsed, s)]).sort((a, b) => b[1] - a[1] || new Date(b[0].lastActivity || 0).getTime() - new Date(a[0].lastActivity || 0).getTime());
        html += `<div class="session-segment ranked-segment">
      ${ranked.map(([s]) => renderSessionItem(s, { showCwd: true })).join("")}
    </div>`;
      } else {
        const families = buildSessionFamilies(filtered);
        const [pinnedFamilies, restFamilies] = partitionPinnedFamilies(families, options2.pinned);
        if (pinnedFamilies.length > 0) {
          html += `<div class="session-segment pinned-segment">
        <div class="workspace-group-header pinned-header">
          <span class="workspace-group-label">\u{1F4CC} Pinned</span>
          <span class="workspace-group-count">${pinnedFamilies.length}</span>
        </div>
        ${pinnedFamilies.map((family) => renderSessionFamily(family, { pinnedFamily: true, showCwd: true })).join("")}
      </div>`;
        }
        if (options2.view === "recent") {
          html += groupSessionsByDate(restFamilies).map(renderDateBucket).join("");
        } else {
          html += renderWorkspaceTrees(flattenSessionFamilies(restFamilies));
        }
      }
      html += hostOfflineNotesHtml();
      if (automationHidden > 0) {
        html += `<div class="scope-hidden-note">${automationHidden} automation run${automationHidden === 1 ? "" : "s"} hidden (is:automation shows them)</div>`;
      }
      if (scopesHidden > 0) {
        html += `<div class="scope-hidden-note">${scopesHidden} hidden by scopes</div>`;
      }
      return { html, count: active.length + pending.length };
    }
    function workspaceGroupKey(hostId, path) {
      return options2.multiHost && hostId ? sessionKey(hostId, path) : path;
    }
    let hostSectionsShown = null;
    function renderWorkspaceTrees(list) {
      if (!options2.multiHost) {
        const tree = buildWorkspaceTree(groupByWorkspace(list, options2.collapsed), options2.collapsed);
        return tree.map((node) => renderWorkspaceNode(node)).join("");
      }
      hostSectionsShown = /* @__PURE__ */ new Set();
      let html = "";
      for (const host of sortHostSections(options2.hosts)) {
        const hostId = host.hostId || null;
        const mine = list.filter((s) => (s.host || null) === hostId);
        const down = hostIsDown(host);
        if (!mine.length && !down) continue;
        hostSectionsShown.add(host.key);
        const key = hostSectionKey(host.key);
        const isCollapsed = options2.collapsed.has(key);
        let body = "";
        if (!isCollapsed) {
          const collapsedView = hostId ? new Set([...options2.collapsed].filter((key2) => key2.startsWith(hostId + " ")).map((key2) => key2.slice((hostId + " ").length))) : options2.collapsed;
          body = buildWorkspaceTree(groupByWorkspace(mine, collapsedView), collapsedView).map((node) => renderWorkspaceNode(node, { hostId })).join("");
          if (!mine.length) {
            body = `<div class="host-section-empty">${escapeHtml(host.state === "blocked" ? "Enter this host\u2019s token in Settings." : "Nothing cached from this host yet.")}</div>`;
          }
        }
        let headerDot = "";
        if (isCollapsed && mine.length) {
          if (mine.some((s) => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
          else if (mine.some(options2.unread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
        }
        const stateNote = down ? `<span class="host-section-state">${host.state === "blocked" ? "needs a token" : "unreachable"}</span>` : "";
        html += `<div class="host-section${isCollapsed ? " collapsed" : ""}${down ? " offline" : ""}" style="--host-color:${escapeHtml(host.color)}">
      <div class="host-section-header" data-host-section="${escapeHtml(key)}" title="${escapeHtml(hostDisplayLabel(host) + (down ? " \u2014 showing last known sessions" : ""))}">
        <span class="host-section-chevron">${isCollapsed ? "\u25B8" : "\u25BE"}</span>
        ${host.dot}
        <span class="host-section-name">${escapeHtml(hostDisplayLabel(host))}</span>
        ${stateNote}${headerDot}<span class="host-section-count">${mine.length}</span>
      </div>
      ${isCollapsed ? "" : `<div class="host-section-body">${body}</div>`}
    </div>`;
      }
      return html;
    }
    function hostOfflineNotesHtml() {
      if (!options2.multiHost) return "";
      return options2.hosts.filter((host) => {
        if (!hostIsDown(host)) return false;
        if (hostSectionsShown && hostSectionsShown.has(host.key)) return false;
        return !host.hasCache;
      }).map((host) => `<div class="host-offline-note">${escapeHtml(hostDisplayLabel(host))} \u2014 ${host.state === "blocked" ? "needs a token (Settings)" : "unreachable"}</div>`).join("");
    }
    function renderWorkspaceNode(node, opts = {}) {
      const hostId = opts.hostId || null;
      const groupKey = workspaceGroupKey(hostId, node.path);
      const isCollapsed = options2.collapsed.has(groupKey);
      let headerDot = "";
      if (isCollapsed) {
        const all = collectTreeSessions(node);
        if (all.some((s) => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
        else if (all.some(options2.unread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
      }
      let body = "";
      if (!isCollapsed) {
        if (node.children.length) {
          body = `<div class="workspace-children">${node.children.map((child) => renderWorkspaceNode(child, { hostId })).join("")}</div>`;
        }
        body += buildSessionFamilies(node.sessions || []).map((family) => renderSessionFamily(family)).join("");
      }
      return `<div class="session-segment${isCollapsed ? " collapsed" : ""}">
    <div class="workspace-group-header" data-cwd="${escapeHtml(groupKey)}">
      <span class="workspace-group-chevron">${isCollapsed ? "\u25B8" : "\u25BE"}</span>
      <span class="workspace-group-label" title="${escapeHtml(node.path)}">${escapeHtml(node.label)}</span>
      ${headerDot}<span class="workspace-group-count">${node.count}</span>
      <button class="workspace-new-btn" data-path="${escapeHtml(node.path)}"${hostId ? ` data-host="${escapeHtml(hostId)}"` : ""} title="New session in ${escapeHtml(node.path)}">+</button>
    </div>
    ${body}
  </div>`;
    }
    function renderDateBucket(bucket2) {
      const key = "date:" + bucket2.key;
      const isCollapsed = options2.collapsed.has(key);
      const bucketMembers = flattenSessionFamilies(bucket2.sessions);
      let headerDot = "";
      if (isCollapsed) {
        if (bucketMembers.some((s) => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
        else if (bucketMembers.some(options2.unread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
      }
      const body = isCollapsed ? "" : bucket2.sessions.map((family) => renderSessionFamily(family, { showCwd: true })).join("");
      return `<div class="session-segment${isCollapsed ? " collapsed" : ""}">
    <div class="workspace-group-header" data-cwd="${escapeHtml(key)}">
      <span class="workspace-group-chevron">${isCollapsed ? "\u25B8" : "\u25BE"}</span>
      <span class="workspace-group-label">${escapeHtml(bucket2.label)}</span>
      ${headerDot}<span class="workspace-group-count">${bucketMembers.length}</span>
    </div>
    ${body}
  </div>`;
    }
    return renderSessions();
  }

  // src/browser/sidebar-controls.ts
  function createSidebarControls(options2) {
    const { document: document2, storage, sessionState } = options2, window = document2.defaultView;
    const list = document2.getElementById("sessionList");
    const lifetime = new AbortController();
    let disposed = false, mounted = false;
    function read(key) {
      try {
        const value = JSON.parse(storage.getItem(key) || "[]");
        return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
      } catch {
        return [];
      }
    }
    function write(key, value) {
      try {
        storage.setItem(key, JSON.stringify([...value]));
      } catch {
      }
    }
    const collapsed = new Set(read("pi-dish-collapsed-groups")), expanded = new Set(read("pi-dish-expanded-session-families"));
    let pinned = read("pi-dish-pinned-sessions");
    const render = () => {
      if (!disposed) options2.render();
    };
    function savePins() {
      write("pi-dish-pinned-sessions", pinned);
    }
    function saveExpanded() {
      write("pi-dish-expanded-session-families", expanded);
    }
    function reloadPreferences() {
      if (disposed) return;
      pinned = read("pi-dish-pinned-sessions");
      expanded.clear();
      for (const key of read("pi-dish-expanded-session-families")) expanded.add(key);
      collapsed.clear();
      for (const key of read("pi-dish-collapsed-groups")) collapsed.add(key);
    }
    function migrate(host) {
      if (disposed) return;
      const qualify = (key) => parseSessionKey(key).hostId === null ? sessionKey(host, key) : key;
      pinned = pinned.map(qualify);
      savePins();
      const next = [...expanded].map(qualify);
      expanded.clear();
      for (const key of next) expanded.add(key);
      saveExpanded();
    }
    function toggleGroup(key) {
      if (disposed) return;
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      write("pi-dish-collapsed-groups", collapsed);
      render();
    }
    function toggleFamily(id, host = sessionState.sessionHostId(id)) {
      if (disposed) return;
      const key = sessionKey(host, id);
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      saveExpanded();
      render();
    }
    const sessions = () => [...sessionState.sessions.active, ...sessionState.sessions.previous].map(sidebarSession);
    function familyRoots() {
      const rows = sessions(), roots = buildSessionFamilies(rows), map = /* @__PURE__ */ new Map();
      const visit = (node, root) => {
        map.set(sessionRefKey(node.session), root);
        for (const child of node.children) visit(child, root);
      };
      for (const root of roots) visit(root, sessionRefKey(root.session));
      const byKey = new Map(rows.map((row) => [sessionRefKey(row), row]));
      for (const [member, visibleRoot] of map) {
        let canonical = visibleRoot, cursor2 = byKey.get(visibleRoot);
        const seen = /* @__PURE__ */ new Set([canonical]);
        while (cursor2?.familyParentId) {
          const parent = sessionKey(cursor2.host, cursor2.familyParentId);
          if (seen.has(parent)) break;
          canonical = parent;
          seen.add(canonical);
          cursor2 = byKey.get(canonical);
        }
        map.set(member, canonical);
      }
      return map;
    }
    function reveal(id, host = sessionState.sessionHostId(id)) {
      if (disposed) return;
      const key = sessionKey(host, id), roots = buildSessionFamilies(sessions());
      function find(node, ancestors) {
        if (sessionRefKey(node.session) === key) return ancestors;
        for (const child of node.children) {
          const found = find(child, [...ancestors, sessionRefKey(node.session)]);
          if (found) return found;
        }
        return null;
      }
      for (const root of roots) {
        const ancestors = find(root, []);
        if (ancestors) {
          for (const key2 of ancestors) expanded.add(key2);
          saveExpanded();
          return;
        }
      }
    }
    function togglePin(id, displayedRoot = id, members = [id], host = sessionState.sessionHostId(id)) {
      if (disposed) return;
      const roots = familyRoots(), key = sessionKey(host, id), canonical = roots.get(key) || key;
      const aliases = new Set(members.map((member) => sessionKey(host, member)));
      aliases.add(sessionKey(host, displayedRoot));
      for (const [member, root] of roots) if (root === canonical) aliases.add(member);
      const visible = new Set(Array.from(list.querySelectorAll(".session-item[data-id]")).map((row) => sessionKey(row.dataset.host, row.dataset.id)));
      for (const member of aliases) {
        const { hostId, sessionId } = parseSessionKey(member), parentId = sessionState.findSession(sessionId, hostId)?.familyParentId;
        const parentKey = sessionKey(hostId, parentId);
        if (typeof parentId === "string" && parentId && !visible.has(parentKey)) aliases.add(parentKey);
      }
      const wasPinned = pinned.some((pin) => aliases.has(pin));
      pinned = pinned.filter((pin) => !aliases.has(pin));
      if (!wasPinned) pinned.push(canonical);
      savePins();
      render();
    }
    let confirm = null, busy = null, confirmTimer = null;
    function captureClose(id, host) {
      const endpoint2 = options2.host(host);
      return disposed || !endpoint2 ? null : { id, host, key: sessionKey(host, id), endpoint: Object.freeze({ ...endpoint2 }), owner: sessionState.captureSelection(), generation: sessionState.selectionGeneration };
    }
    const endpoint = (entry) => {
      const current = options2.host(entry.host);
      return !disposed && current && current.base === entry.endpoint.base ? { ...entry.endpoint, token: current.token } : null;
    };
    const ownsFeedback = (entry) => entry.owner ? sessionState.ownsSelection(entry.owner) : sessionState.selectionGeneration === entry.generation && !sessionState.currentSession;
    function clearConfirm() {
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = null;
      confirm = null;
    }
    async function performClose(id, host = sessionState.sessionHostId(id), captured) {
      if (disposed || busy) return;
      const entry = captured || captureClose(id, host);
      if (!entry) return;
      const target = endpoint(entry);
      if (!target) {
        clearConfirm();
        render();
        return;
      }
      clearConfirm();
      busy = entry;
      render();
      try {
        await sendJson(options2.request, target, `/api/sessions/${encodeURIComponent(id)}/close`, void 0);
        if (busy !== entry || !endpoint(entry)) return;
        busy = null;
        if (!entry.owner && !ownsFeedback(entry)) await options2.refresh();
        else await options2.finishClose(id, host, entry.owner);
      } catch (error) {
        if (busy !== entry || !endpoint(entry)) return;
        if (ownsFeedback(entry)) options2.status("Close failed: " + (error instanceof Error ? error.message : String(error)), "error");
      } finally {
        if (busy === entry) busy = null;
        render();
      }
    }
    function closeClick(id, host = sessionState.sessionHostId(id)) {
      if (disposed || busy) return;
      const key = sessionKey(host, id);
      if (confirm?.key === key && endpoint(confirm)) {
        void performClose(id, host, confirm);
        return;
      }
      clearConfirm();
      confirm = captureClose(id, host);
      if (!confirm) return;
      const entry = confirm;
      confirmTimer = setTimeout(() => {
        if (confirm !== entry || disposed) return;
        clearConfirm();
        render();
      }, 3e3);
      render();
    }
    let menu = null, menuOwner = null, menuEvents = new AbortController();
    const menuTimers = /* @__PURE__ */ new Set();
    function later(callback, ms) {
      const timer = setTimeout(() => {
        menuTimers.delete(timer);
        if (!disposed) callback();
      }, ms);
      menuTimers.add(timer);
    }
    function closeMenu() {
      menuOwner = null;
      menuEvents.abort();
      for (const timer of menuTimers) clearTimeout(timer);
      menuTimers.clear();
      if (menu) menu.style.display = "none";
    }
    function openMenu(session, x, y) {
      if (disposed) return;
      closeMenu();
      if (!menu) {
        menu = document2.createElement("div");
        menu.id = "sessionMenu";
        menu.className = "context-menu";
        document2.body.append(menu);
      }
      const el = menu, owner = /* @__PURE__ */ Symbol("menu");
      menuOwner = owner;
      menuEvents = new AbortController();
      const { signal } = menuEvents;
      const current = () => !disposed && menuOwner === owner && !signal.aborted && el.isConnected;
      const ref = options2.ref(session);
      el.innerHTML = [["Copy session ref", ref, ref], ["Copy session id", session.id, ""]].map(([label, value, preview]) => `<button type="button" class="context-menu-item" data-copy="${escapeHtml(value)}"><span class="context-menu-label">${escapeHtml(label)}</span>${preview ? `<span class="context-menu-value">${escapeHtml(preview)}</span>` : ""}</button>`).join("");
      el.style.display = "block";
      el.style.left = "0px";
      el.style.top = "0px";
      el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8))}px`;
      el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8))}px`;
      for (const item of Array.from(el.querySelectorAll(".context-menu-item"))) {
        const value = item.dataset.copy || "";
        item.addEventListener("click", () => {
          if (!current() || !el.contains(item)) return;
          void options2.copy(value).then(() => {
            if (!current() || !el.contains(item)) return;
            const label = item.querySelector(".context-menu-label");
            if (label) label.textContent = "Copied";
            item.classList.add("copied");
            later(() => {
              if (current()) closeMenu();
            }, 700);
          }, () => {
            if (current()) {
              closeMenu();
              options2.status("Copy failed (clipboard blocked)", "error");
            }
          });
        }, { signal });
      }
      document2.addEventListener("scroll", closeMenu, { capture: true, signal });
      window.addEventListener("resize", closeMenu, { signal });
      later(() => {
        if (!current()) return;
        document2.addEventListener("click", (event) => {
          if (current() && event.target instanceof Node && document2.body.contains(event.target) && !el.contains(event.target)) closeMenu();
        }, { signal });
      }, 0);
    }
    let drag = null;
    function finishDrag(entry, save) {
      if (drag !== entry) return;
      drag = null;
      entry.events.abort();
      entry.family.classList.remove("dragging");
      if (save && !disposed && list.contains(entry.segment) && entry.segment.contains(entry.family)) {
        pinned = Array.from(entry.segment.children).filter((el) => el instanceof HTMLElement && el.classList.contains("session-family-root")).map((el) => el.dataset.familyKey || "").filter(Boolean);
        savePins();
      }
      render();
    }
    function mount() {
      if (disposed || mounted) return;
      mounted = true;
      const { signal } = lifetime;
      list.addEventListener("pointerdown", (event) => {
        if (drag || !(event.target instanceof Element)) return;
        const handle = event.target.closest(".session-drag-handle"), family = handle?.closest(".session-family-root"), segment = family?.parentElement;
        if (!family || !segment?.classList.contains("pinned-segment") || !list.contains(segment)) return;
        event.preventDefault();
        const entry = { pointer: event.pointerId, family, segment, events: new AbortController() };
        drag = entry;
        family.classList.add("dragging");
        const signal2 = entry.events.signal;
        document2.addEventListener("pointermove", (move) => {
          if (drag !== entry || move.pointerId !== entry.pointer || !list.contains(segment)) return;
          const siblings = Array.from(segment.children).filter((el) => el.classList.contains("session-family-root") && el !== family);
          const next = siblings.find((sib) => {
            const rect = sib.getBoundingClientRect();
            return move.clientY < rect.top + rect.height / 2;
          });
          if (next) segment.insertBefore(family, next);
          else segment.appendChild(family);
        }, { signal: signal2 });
        document2.addEventListener("pointerup", (up) => {
          if (up.pointerId === entry.pointer) finishDrag(entry, true);
        }, { signal: signal2 });
        document2.addEventListener("pointercancel", (cancel) => {
          if (cancel.pointerId === entry.pointer) finishDrag(entry, true);
        }, { signal: signal2 });
      }, { signal });
      list.addEventListener("click", (event) => {
        if (!(event.target instanceof Element) || !list.contains(event.target)) return;
        const target = event.target, item = target.closest(".session-item"), id = item?.dataset.id, host = item?.dataset.host || null;
        const familyToggle = target.closest(".session-family-toggle");
        if (familyToggle) {
          if (familyToggle.dataset.familyId) toggleFamily(familyToggle.dataset.familyId, host);
          return;
        }
        if (target.closest(".session-pin-btn")) {
          if (id && item) {
            const family = item.closest(".session-family-root");
            const members = family ? Array.from(family.querySelectorAll(".session-item[data-id]")).map((row) => row.dataset.id).filter(Boolean) : [id];
            togglePin(id, family?.dataset.familyId || id, members, host);
          }
          return;
        }
        if (target.closest(".session-close-btn")) {
          event.stopPropagation();
          if (id) closeClick(id, host);
          return;
        }
        if (target.closest(".session-drag-handle")) return;
        const newButton = target.closest(".workspace-new-btn");
        if (newButton) {
          if (newButton.dataset.path) options2.create(newButton.dataset.path, newButton.dataset.host || null);
          return;
        }
        const hostHeader = target.closest(".host-section-header");
        if (hostHeader) {
          if (hostHeader.dataset.hostSection) toggleGroup(hostHeader.dataset.hostSection);
          return;
        }
        const header = target.closest(".workspace-group-header");
        if (header) {
          if (header.dataset.cwd) toggleGroup(header.dataset.cwd);
          return;
        }
        if (!item) return;
        if (item.classList.contains("starting")) {
          if (item.dataset.spawnId) options2.pending(item.dataset.spawnId);
        } else if (id) options2.select(id, host);
        if (window.innerWidth <= 768) options2.closeSidebar();
      }, { signal });
      list.addEventListener("contextmenu", (event) => {
        if (!(event.target instanceof Element)) return;
        const item = event.target.closest(".session-item[data-id]");
        if (!item || !list.contains(item)) return;
        const session = sessionState.findSession(item.dataset.id, item.dataset.host || null);
        if (!session) return;
        event.preventDefault();
        openMenu(session, event.clientX, event.clientY);
      }, { signal });
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      clearConfirm();
      busy = null;
      closeMenu();
      menu?.remove();
      menu = null;
      if (drag) finishDrag(drag, false);
    }
    return {
      mount,
      dispose,
      migrate,
      reloadPreferences,
      toggleGroup,
      toggleFamily,
      familyRoots,
      reveal,
      togglePin,
      closeClick,
      performClose,
      openMenu,
      closeMenu,
      get menuOpen() {
        return !!menuOwner;
      },
      get dragging() {
        return !!drag;
      },
      get closeConfirm() {
        return confirm?.key || null;
      },
      get closeBusy() {
        return busy?.key || null;
      },
      get collapsed() {
        return collapsed;
      },
      get expanded() {
        return expanded;
      },
      get pinned() {
        return pinned;
      }
    };
  }

  // src/browser/sidebar-activity.ts
  function createSidebarActivity(options2) {
    const { document: document2, storage, sessionState } = options2;
    let seen = /* @__PURE__ */ Object.create(null);
    function reload() {
      try {
        const value = JSON.parse(storage.getItem("pi-dish-seen") || "{}");
        seen = /* @__PURE__ */ Object.create(null);
        if (record8(value)) {
          for (const [key, at] of Object.entries(value)) if (typeof at === "string" || typeof at === "number" && Number.isFinite(at)) seen[key] = at;
        }
      } catch {
      }
    }
    function save() {
      try {
        storage.setItem("pi-dish-seen", JSON.stringify(seen));
      } catch {
      }
    }
    function mark(session, at = session?.lastActivity) {
      if (!session || !at || typeof at !== "string" && typeof at !== "number") return;
      seen[sessionRefKey(session)] = at;
      save();
    }
    function unread(session) {
      return isUnreadSession(sidebarSession(session), seen, sessionState.currentSession ? sessionRefKey(sessionState.currentSession) : null, !document2.hidden);
    }
    function title() {
      const count2 = sessionState.sessions.active.filter(unread).length;
      document2.title = count2 ? `(${count2}) pi-dish` : "pi-dish";
    }
    function prune(host, active) {
      const live = new Set(active.map((row) => sessionKey(row.host || host, row.id)));
      for (const key of Object.keys(seen)) if (parseSessionKey(key).hostId === host && !live.has(key)) delete seen[key];
    }
    function migrate(host) {
      const next = /* @__PURE__ */ Object.create(null);
      for (const [key, at] of Object.entries(seen)) next[parseSessionKey(key).hostId ? key : sessionKey(host, key)] = at;
      seen = next;
      save();
    }
    reload();
    return { reload, mark, unread, title, prune, migrate };
  }

  // src/browser/sidebar-lists.ts
  function createSidebarLists(options2) {
    const { document: document2, sessionState } = options2, api = createSessionApi(options2.request);
    let disposed = false, sequence = 0, indexing = false, queriedFor = "";
    let indexingTimer = null, pollTimer = null;
    function busy(value) {
      if (!disposed) document2.querySelector(".sidebar-filter")?.classList.toggle("searching", value);
    }
    const loader = createHostSessionLoader({
      requestList: (host, path, init) => api.list(host, path, init),
      currentSequence: () => sequence,
      stripHostQuery: (query) => stripQueryField(query, "host"),
      onConnection: (host, event) => {
        if (!disposed) options2.connection(host, event);
      },
      onIndexing: () => {
        if (disposed || indexingTimer) return;
        indexingTimer = setTimeout(() => {
          indexingTimer = null;
          void refresh();
        }, 1e3);
      },
      beforePublish: (host, next, wireQuery) => {
        if (disposed) return;
        const hostId = host.hostId || null, selected = sessionState.currentSession;
        if (selected && !document2.hidden && (selected.host || null) === hostId) {
          const fresh = next.active.find((row) => row.id === selected.id) || next.previous.find((row) => row.id === selected.id);
          if (fresh) options2.activity.mark(selected, fresh.lastActivity);
        }
        if (!wireQuery) options2.activity.prune(hostId, next.active);
      },
      onPublish: (query) => {
        if (disposed) return;
        if (query !== void 0) queriedFor = query;
        publish();
      },
      onError: (host, error) => {
        if (!disposed && host.self) console.error("Failed to load sessions:", error);
      }
    });
    function publish() {
      if (disposed) return;
      indexing = loader.isIndexing();
      const parts = [];
      for (const host of options2.hosts()) {
        const cache = loader.getCache(host);
        if (cache) parts.push({ hostId: host.hostId || null, ...cache });
      }
      sessionState.setSessionLists(parts.length ? parts : [{ hostId: options2.selfId(), active: [], previous: [] }]);
    }
    async function load(query, { withPrevious = options2.all() } = {}) {
      if (disposed) return;
      const current = ++sequence;
      busy(true);
      await Promise.allSettled(queryHosts(options2.pollable(), query || "").map((host) => loader.load(host, query, withPrevious, current)));
      if (!disposed && current === sequence) busy(false);
    }
    function invalidate() {
      sequence++;
      loader.retireRequests();
    }
    function refresh() {
      if (disposed) return Promise.resolve();
      options2.refreshFleet();
      return load(options2.query() || void 0);
    }
    function mount() {
      if (!disposed && !pollTimer) pollTimer = setInterval(() => {
        void refresh();
      }, 1e4);
    }
    function dispose() {
      if (disposed) return;
      busy(false);
      disposed = true;
      sequence++;
      if (pollTimer) clearInterval(pollTimer);
      if (indexingTimer) clearTimeout(indexingTimer);
      pollTimer = indexingTimer = null;
      loader.prune(/* @__PURE__ */ new Set());
    }
    return { loader, load, refresh, publish, busy, invalidate, mount, dispose, get indexing() {
      return indexing;
    }, get queriedFor() {
      return queriedFor;
    } };
  }

  // src/browser/sidebar-query.ts
  function createSidebarQuery(options2) {
    const { document: document2, storage } = options2;
    const input = document2.getElementById("filterInput"), chips = document2.getElementById("scopeChips");
    const lifetime = new AbortController();
    let chipEvents = new AbortController();
    let disposed = false, mounted = false, tab = "active", view = storage.getItem("pi-dish-sidebar-view") === "recent" ? "recent" : "workspace", query = "";
    function read(key, fallback2) {
      try {
        return JSON.parse(storage.getItem(key) || "null") ?? fallback2;
      } catch {
        return fallback2;
      }
    }
    function store(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {
      }
    }
    let filters = decodeSavedFilters(read("pi-dish-saved-filters-cache", []));
    const rawScopes = read("pi-dish-active-scopes", []), scopes = new Set(Array.isArray(rawScopes) ? rawScopes.filter((v) => typeof v === "string") : []);
    let debounce = null, queryGeneration = 0, settingsGeneration = 0;
    function cancelDebounce() {
      queryGeneration++;
      if (debounce) clearTimeout(debounce);
      debounce = null;
    }
    function scope() {
      return filters.filter((filter) => scopes.has(filter.name)).map((filter) => filter.query).join(" ");
    }
    function toggleView() {
      if (disposed) return;
      view = view === "recent" ? "workspace" : "recent";
      try {
        storage.setItem("pi-dish-sidebar-view", view);
      } catch {
      }
      updateView();
      options2.render();
    }
    function updateView() {
      if (disposed) return;
      const button = document2.getElementById("viewToggle");
      if (!button) return;
      button.innerHTML = view === "recent" ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
      button.title = view === "recent" ? "Grouped by date \u2014 switch to workspaces" : "Grouped by workspace \u2014 switch to recent";
    }
    function refreshViews(reload = true) {
      if (disposed) return;
      renderChips();
      options2.render();
      if (reload && options2.queriedFor() !== query) void options2.reload(query || void 0);
      options2.searchChanged();
    }
    function setFilters(value) {
      if (disposed) return;
      settingsGeneration++;
      filters = decodeSavedFilters(value);
    }
    function commitFilters(next) {
      filters = [...next];
      store("pi-dish-saved-filters-cache", filters);
    }
    async function loadFilters() {
      if (disposed) return;
      const generation = ++settingsGeneration, target = Object.freeze({ ...options2.host() });
      try {
        const response = await options2.request(target, "/api/settings"), data = await response.json();
        if (disposed || generation !== settingsGeneration || options2.host().base !== target.base) return;
        if (!response.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : "Failed to load filters");
        commitFilters(decodeSavedFilters(record8(data) ? data.savedFilters : void 0));
        refreshViews(false);
      } catch (error) {
        if (!disposed && generation === settingsGeneration && options2.host().base === target.base) console.error("Failed to load saved filters:", error);
      }
    }
    async function persistFilters(next, host = options2.host()) {
      if (disposed) return;
      const generation = ++settingsGeneration, target = Object.freeze({ ...host });
      const response = await options2.request(target, "/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ savedFilters: decodeSavedFilters(next) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : "save failed");
      if (disposed || generation !== settingsGeneration || options2.host().base !== target.base) return;
      commitFilters(decodeSavedFilters(record8(data) ? data.savedFilters : void 0));
      refreshViews();
    }
    function toggleScope(name) {
      if (disposed) return;
      if (scopes.has(name)) scopes.delete(name);
      else scopes.add(name);
      store("pi-dish-active-scopes", [...scopes]);
      refreshViews();
    }
    async function saveCurrent() {
      if (disposed) return;
      const captured = query.trim();
      if (!captured) return;
      const name = options2.prompt("Name this filter:", "");
      if (!name?.trim()) return;
      const trimmed = name.trim().slice(0, 60), next = filters.filter((filter) => filter.name !== trimmed).concat([{ name: trimmed, query: captured }]);
      scopes.add(trimmed);
      store("pi-dish-active-scopes", [...scopes]);
      cancelDebounce();
      options2.invalidateLists();
      options2.busy(false);
      input.value = "";
      query = "";
      const generation = queryGeneration;
      try {
        await persistFilters(next);
      } catch (error) {
        if (!disposed && generation === queryGeneration) options2.alert("Could not save filter: " + (error instanceof Error ? error.message : String(error)));
      }
    }
    function renderChips() {
      if (disposed) return;
      chipEvents.abort();
      chipEvents = new AbortController();
      const { signal } = chipEvents;
      const html = filters.map((filter) => `<button class="scope-chip${scopes.has(filter.name) ? " active" : ""}" data-name="${escapeHtml(filter.name)}" title="${escapeHtml(filter.query)}">${escapeHtml(filter.name)}</button>`);
      if (query.trim()) html.push('<button class="scope-chip scope-add" title="Save the current query as a reusable filter">+ save filter</button>', '<button class="scope-chip search-open-chip" title="Open this query in the full search view">\u2922 full search</button>');
      chips.innerHTML = html.join("");
      chips.style.display = html.length ? "" : "none";
      for (const button of Array.from(chips.querySelectorAll("button"))) {
        const name = button.dataset.name, captured = query;
        button.addEventListener("click", () => {
          if (disposed || signal.aborted || !chips.contains(button)) return;
          if (button.classList.contains("scope-add")) void saveCurrent();
          else if (button.classList.contains("search-open-chip")) options2.openSearch(captured);
          else if (name !== void 0) toggleScope(name);
        }, { signal });
      }
    }
    function switchTab(next) {
      if (disposed) return;
      tab = next === "all" ? "all" : "active";
      cancelDebounce();
      document2.getElementById("tabActive")?.classList.toggle("active", tab === "active");
      document2.getElementById("tabAll")?.classList.toggle("active", tab === "all");
      input.placeholder = tab === "active" ? "Filter active sessions..." : "Search all sessions...";
      options2.render();
      void options2.reload(query || void 0);
    }
    function onInput() {
      if (disposed) return;
      cancelDebounce();
      query = input.value.trim();
      options2.invalidateLists();
      renderChips();
      options2.render();
      if (query) {
        options2.busy(true);
        const generation = queryGeneration, captured = query;
        debounce = setTimeout(() => {
          debounce = null;
          if (!disposed && generation === queryGeneration) void options2.reload(captured);
        }, 300);
      } else void options2.reload();
    }
    function toggle() {
      if (disposed) return;
      const sidebar = document2.getElementById("sidebar"), open = !sidebar.classList.contains("open");
      sidebar.classList.toggle("open", open);
      document2.getElementById("sidebarOverlay")?.classList.toggle("active", open);
      document2.body.classList.toggle("sidebar-open", open);
    }
    function close() {
      document2.getElementById("sidebar")?.classList.remove("open");
      document2.getElementById("sidebarOverlay")?.classList.remove("active");
      document2.body.classList.remove("sidebar-open");
    }
    function mount() {
      if (disposed || mounted) return;
      mounted = true;
      const { signal } = lifetime;
      input.addEventListener("input", onInput, { signal });
      document2.getElementById("tabActive")?.addEventListener("click", () => switchTab("active"), { signal });
      document2.getElementById("tabAll")?.addEventListener("click", () => switchTab("all"), { signal });
      document2.getElementById("viewToggle")?.addEventListener("click", toggleView, { signal });
      document2.querySelector(".filter-search-btn")?.addEventListener("click", () => options2.openSearch(query || void 0), { signal });
      for (const button of Array.from(document2.querySelectorAll("[data-toggle-sidebar]"))) button.addEventListener("click", toggle, { signal });
    }
    function dispose() {
      if (disposed) return;
      cancelDebounce();
      settingsGeneration++;
      options2.invalidateLists();
      options2.busy(false);
      close();
      disposed = true;
      lifetime.abort();
      chipEvents.abort();
    }
    return {
      mount,
      dispose,
      toggleView,
      updateView,
      scope,
      setFilters,
      loadFilters,
      persistFilters,
      toggleScope,
      saveCurrent,
      renderChips,
      switchTab,
      onInput,
      toggle,
      close,
      get filters() {
        return filters;
      },
      get tab() {
        return tab;
      },
      get view() {
        return view;
      },
      get query() {
        return query;
      }
    };
  }

  // src/browser/message-data.ts
  var string = (value) => typeof value === "string" ? value : void 0;
  var number7 = (value) => finite2(value) ? value : void 0;
  function decodeMessageUsage(value) {
    if (!record8(value)) return void 0;
    const cost = record8(value.cost) ? value.cost : null, price = (value2) => value2 === null ? null : number7(value2);
    return {
      input: number7(value.input),
      output: number7(value.output),
      reasoning: number7(value.reasoning),
      cacheRead: number7(value.cacheRead),
      cacheWrite: number7(value.cacheWrite),
      cost: cost ? { input: price(cost.input), output: price(cost.output), cacheRead: price(cost.cacheRead), cacheWrite: price(cost.cacheWrite), total: price(cost.total) } : void 0
    };
  }
  function decodeMessageContent(value) {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return void 0;
    return value.flatMap((block) => typeof block === "string" ? [block] : !record8(block) || typeof block.type !== "string" ? [] : [{
      type: block.type,
      text: string(block.text),
      thinking: string(block.thinking),
      name: string(block.name),
      id: string(block.id),
      arguments: record8(block.arguments) ? block.arguments : void 0,
      url: string(block.url),
      data: string(block.data),
      mimeType: string(block.mimeType)
    }]);
  }
  function decodeRenderMessage(value) {
    const row = record8(value) ? value : {}, details = record8(row.details) ? row.details : null;
    return {
      role: string(row.role) || "",
      id: string(row.id),
      index: finite2(row.index) && Number.isInteger(row.index) && row.index >= 0 ? row.index : void 0,
      timestamp: typeof row.timestamp === "string" || finite2(row.timestamp) || row.timestamp instanceof Date ? row.timestamp : void 0,
      content: decodeMessageContent(row.content),
      model: string(row.model),
      responseModel: string(row.responseModel),
      provider: string(row.provider),
      stopReason: string(row.stopReason),
      errorMessage: string(row.errorMessage),
      toolName: string(row.toolName),
      toolCallId: string(row.toolCallId),
      isError: row.isError === true,
      customType: string(row.customType),
      display: typeof row.display === "boolean" ? row.display : void 0,
      usage: decodeMessageUsage(row.usage),
      durationMs: number7(row.durationMs),
      outputTokens: number7(row.outputTokens),
      sessionRefs: Array.isArray(row.sessionRefs) ? row.sessionRefs.flatMap((entry) => record8(entry) && typeof entry.ref === "string" ? [{ ref: entry.ref, name: string(entry.name), host: string(entry.host), cwd: string(entry.cwd), isActive: entry.isActive === true }] : []) : void 0,
      details: details ? {
        notes: Array.isArray(details.notes) ? details.notes.flatMap((note) => typeof note === "string" ? [{ note }] : record8(note) && typeof note.note === "string" ? [{ note: note.note, severity: string(note.severity), advisor: string(note.advisor) }] : []) : void 0,
        jobs: Array.isArray(details.jobs) ? details.jobs.flatMap((job) => record8(job) ? [{ label: string(job.label), jobId: string(job.jobId), durationMs: number7(job.durationMs) }] : []) : void 0
      } : void 0
    };
  }

  // src/browser/helper-content.ts
  function extractTextContent(content) {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const blocks = content;
      return blocks.map((c) => typeof c === "string" ? c : record8(c) && c.type === "text" && typeof c.text === "string" ? c.text : "").join("\n");
    }
    return "";
  }
  function extractTextBlocks(content) {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const blocks = content;
    return blocks.filter((c) => typeof c === "string" || record8(c) && c.type === "text").map((c) => typeof c === "string" ? c : record8(c) && typeof c.text === "string" ? c.text : "").join("\n");
  }
  function ipythonCodeSummary(code) {
    if (typeof code !== "string" || !code) return "";
    const m = /(?:^|[^A-Za-z0-9_])bash\(\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(code);
    const inner = m ? m[2].replace(/\\(['"\\])/g, "$1") : code.split("\n")[0];
    return truncate(inner, 60);
  }
  function getToolSummary(toolName, args) {
    if (!record8(args)) return "";
    if (toolName === "Bash" || toolName === "bash") return typeof args.command === "string" && args.command ? truncate(args.command.split("\n")[0], 60) : "";
    if (toolName === "ipython") return ipythonCodeSummary(args.code);
    if (["Read", "read", "Edit", "edit", "Write", "write"].includes(toolName)) return typeof args.path === "string" ? args.path : "";
    const keys = Object.keys(args);
    if (keys.length) return truncate(String(args[keys[0]]), 40);
    return "";
  }
  function parseIpythonResult(text17) {
    if (typeof text17 !== "string") return null;
    const m = /^BashResult\(exit_code=(-?\d+), output=(['"])((?:\\.|(?!\2).)*)\2(?:, duration=([0-9.eE+-]+))?\)\s*$/.exec(text17);
    if (!m) return null;
    return { exitCode: Number(m[1]), output: pythonReprUnescape(m[3]), durationMs: m[4] != null ? Math.round(Number(m[4]) * 1e3) : null };
  }
  function pythonReprUnescape(text17) {
    return text17.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (all, seq) => {
      if (seq[0] === "x") return String.fromCharCode(parseInt(seq.slice(1), 16));
      if (seq[0] === "u") return String.fromCharCode(parseInt(seq.slice(1), 16));
      const map = { n: "\n", t: "	", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0", "\n": "" };
      return Object.hasOwn(map, seq) ? map[seq] : seq;
    });
  }
  function messageHasVisibleText(msg) {
    if (!record8(msg)) return false;
    if (msg.errorMessage) return true;
    if (typeof msg.content === "string") return !!msg.content;
    return Array.isArray(msg.content) && msg.content.some((b) => record8(b) && b.type === "text" && typeof b.text === "string" && !!b.text);
  }
  function getToolOutputText(partialResult) {
    if (!record8(partialResult) || !Array.isArray(partialResult.content)) return "";
    const blocks = partialResult.content;
    return blocks.filter((c) => record8(c) && c.type === "text").map((c) => typeof c.text === "string" ? c.text : "").join("");
  }
  function extractImageBlocks(content) {
    if (!Array.isArray(content)) return [];
    const out = [];
    const blocks = content;
    for (const block of blocks) {
      if (!record8(block) || block.type !== "image") continue;
      const mimeType = typeof block.mimeType === "string" && block.mimeType ? block.mimeType : "image/png";
      if (typeof block.url === "string" && block.url) out.push({ url: block.url, mimeType });
      else if (typeof block.data === "string" && block.data) out.push({ data: block.data, mimeType });
    }
    return out;
  }

  // src/browser/message-render.ts
  function createMessageRenderer(options2) {
    const { document: document2 } = options2;
    let disposed = false;
    function renderMessageHtml(msg) {
      const time = msg.timestamp ? formatTime(msg.timestamp) : "";
      const idxAttr = msg.index != null ? ` data-msg-index="${escapeHtml(msg.index)}"` : "";
      if (msg.role === "user") return renderUserMessage(msg, time, idxAttr);
      if (msg.role === "assistant") {
        if (Array.isArray(msg.content) && msg.content.length === 0 && !msg.errorMessage) return "";
        return renderAssistantMessage(msg, time, { attrs: idxAttr });
      }
      if (msg.role === "toolResult") return renderToolResult(msg, time, idxAttr);
      if (msg.role === "branchSummary") return renderBranchSummary(msg, time, idxAttr);
      if (msg.role === "custom") return renderCustomMessage(msg, time, idxAttr);
      return "";
    }
    function imageBlocksHtml(content, alt = "image") {
      const images = extractImageBlocks(content);
      if (!images.length) return "";
      const imgs = images.map((img) => {
        const src = img.url ? options2.assetUrl(options2.sessionState.currentSession?.host, img.url) : `data:${img.mimeType};base64,${img.data}`;
        const loading = img.url ? ' loading="lazy" decoding="async"' : "";
        return `<img class="msg-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${loading}>`;
      }).join("");
      return `<div class="msg-images">${imgs}</div>`;
    }
    function messageLinkBtnHtml(msg) {
      if (!msg.id || record8(options2.sessionState.currentSession?.capabilities) && options2.sessionState.currentSession.capabilities.export === false) return "";
      return `<button type="button" class="msg-link-btn" data-entry-id="${escapeHtml(msg.id)}" title="Copy share link to this message">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg></button>`;
    }
    function sessionRefChipsHtml(refs) {
      if (!refs || !refs.length) return "";
      const chips = refs.map((entry) => {
        const session = options2.matchRef(entry.ref);
        const label = entry.name || session?.name || entry.ref;
        const live = (session ? session.isActive : entry.isActive) ? " live" : "";
        const title = [entry.ref, entry.host, entry.cwd].filter(Boolean).join(" \xB7 ");
        return `<button type="button" class="session-ref-chip${live}" data-session-ref="${escapeHtml(entry.ref)}" title="${escapeHtml(title)}">
      <span class="session-ref-dot">\u25CF</span>${escapeHtml(label)}</button>`;
      }).join("");
      return `<div class="session-ref-chips">${chips}</div>`;
    }
    function renderUserMessage(msg, time, attrs = "") {
      const { text: text17, refs } = splitSessionRefContext(extractTextContent(msg.content));
      const imagesHtml = imageBlocksHtml(msg.content, "attached image");
      const chipsHtml = sessionRefChipsHtml(msg.sessionRefs || refs);
      return `<div${attrs} class="message user">
    <div class="message-header"><span class="message-role user">\u276F</span>${time ? `<span class="message-time">${time}</span>` : ""}${messageLinkBtnHtml(msg)}</div>
    <div class="message-content user-content">${text17 ? `<div class="markdown-body">${options2.markdown(text17)}</div>` : ""}${imagesHtml}${chipsHtml}</div>
  </div>`;
    }
    function renderAssistantMessage(msg, time, opts = {}) {
      let thinkingHtml = "", textHtml = "", toolCallsHtml = "";
      const timestamp = msg.timestamp || Date.now();
      const streamingClass = opts.streaming ? " streaming" : "";
      const streamingAttr = opts.streaming ? ' data-streaming="true"' : "";
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === "string") continue;
          if (block.type === "thinking" && block.thinking) thinkingHtml += renderThinkingBlock(block.thinking);
          else if (block.type === "text" && block.text) textHtml += options2.markdown(block.text);
          else if (block.type === "toolCall") toolCallsHtml += renderToolCall(block);
        }
      } else if (typeof msg.content === "string") {
        textHtml = options2.markdown(msg.content);
      }
      let errorHtml = "";
      if (msg.errorMessage) {
        errorHtml = `<div class="message-content message-error"><div class="markdown-body"><strong>Error:</strong> ${escapeHtml(msg.errorMessage)}</div></div>`;
      }
      const showModel = msg.model && (!options2.sessionState.currentSession || msg.model !== options2.sessionState.currentSession.model);
      const noTextClass = messageHasVisibleText(msg) ? "" : " no-text";
      let speedHtml = "";
      const hasMetadata = !opts.streaming && (msg.usage || msg.durationMs);
      if (hasMetadata) speedHtml = options2.details.button(msg);
      return `<div${opts.attrs || ""} class="message assistant${streamingClass}${noTextClass}${msg.errorMessage ? " error" : ""}" data-timestamp="${escapeHtml(String(timestamp))}"${streamingAttr}>
    <div class="message-header">
      <span class="message-role assistant">\u03C0</span>
      ${showModel ? `<span class="badge">${escapeHtml(msg.model)}</span>` : ""}
      ${opts.streaming ? '<span class="badge streaming">\u25CF</span>' : ""}
      ${speedHtml}
      ${time ? `<span class="message-time">${time}</span>` : ""}
      ${messageLinkBtnHtml(msg)}
    </div>
    ${thinkingHtml}${toolCallsHtml}
    ${textHtml ? `<div class="message-content"><div class="markdown-body">${textHtml}</div></div>` : ""}
    ${errorHtml}
  </div>`;
    }
    function renderThinkingBlock(thinking) {
      const preview = thinking.substring(0, 80).replace(/\n/g, " ");
      return `<details class="thinking-block">
    <summary class="thinking-header"><span class="thinking-label">Thinking</span><span class="thinking-preview">${escapeHtml(preview)}\u2026</span></summary>
    <div class="thinking-text">${escapeHtml(thinking)}</div>
  </details>`;
    }
    function renderToolCall(block) {
      const args = block.arguments || {};
      const summary = getToolSummary(block.name || "", args);
      const bodyHtml = block.name === "ipython" && typeof args.code === "string" ? `<pre><code>${escapeHtml(args.code)}</code></pre>` : `<pre><code>${escapeHtml(JSON.stringify(args, null, 2))}</code></pre>`;
      return `<details class="tool-call">
    <summary class="tool-call-header">
      <span class="tool-call-icon">\u26A1</span><span class="tool-call-name">${escapeHtml(block.name)}</span>
      ${summary ? `<span class="tool-call-summary">${escapeHtml(summary)}</span>` : ""}
    </summary>
    <div class="tool-call-content">${bodyHtml}</div>
  </details>`;
    }
    function renderToolResult(msg, time, attrs = "") {
      let content = extractTextContent(msg.content);
      const isError = msg.isError;
      const timestamp = msg.timestamp || Date.now();
      const parsed = parseIpythonResult(content);
      let exitBadge = "";
      if (parsed) {
        content = parsed.output;
        if (parsed.exitCode !== 0) exitBadge = `<span class="tool-result-meta error-badge">exit ${parsed.exitCode}</span>`;
      }
      const lines = content.split("\n");
      const lineCount = lines.length;
      const preview = truncate(lines[0], 80);
      const images = extractImageBlocks(msg.content);
      const imageCount = images.length;
      const imagesHtml = imageBlocksHtml(msg.content, "tool result image");
      return `<div${attrs} class="message tool-result ${isError ? "error" : ""}" data-timestamp="${escapeHtml(String(timestamp))}">
    <details class="tool-result-details" ${lineCount <= 5 || imageCount ? "open" : ""}>
      <summary class="tool-result-header">
        <span class="tool-result-icon">${isError ? "\u2717" : "\u2713"}</span>
        <span class="tool-result-name">${escapeHtml(msg.toolName || "result")}</span>
        ${lineCount > 5 ? `<span class="tool-result-meta">${lineCount} lines</span>` : ""}
        ${imageCount ? `<span class="tool-result-meta">${imageCount === 1 ? "image" : imageCount + " images"}</span>` : ""}
        ${exitBadge}
        ${isError ? '<span class="tool-result-meta error-badge">error</span>' : ""}
        ${lineCount > 5 ? `<span class="tool-result-preview">${escapeHtml(preview)}</span>` : ""}
      </summary>
      <div class="tool-result-content"><pre>${escapeHtml(truncate(content, 2e3))}</pre>${imagesHtml}</div>
    </details>
  </div>`;
    }
    function renderBranchSummary(msg, time, attrs = "") {
      const text17 = extractTextContent(msg.content);
      const timestamp = msg.timestamp || Date.now();
      const preview = truncate(text17.split("\n")[0], 80);
      return `<div${attrs} class="message branch-summary" data-timestamp="${escapeHtml(String(timestamp))}">
    <details class="branch-summary-details">
      <summary class="branch-summary-header">
        <span class="branch-summary-icon">\u2387</span>
        <span class="branch-summary-label">Branch summary</span>
        ${time ? `<span class="message-time">${time}</span>` : ""}
        <span class="branch-summary-preview">${escapeHtml(preview)}</span>
      </summary>
      <div class="message-content"><div class="markdown-body">${options2.markdown(text17)}</div></div>
    </details>
  </div>`;
    }
    const ADVISOR_SEVERITIES = ["nit", "concern", "blocker"];
    function advisoryTagAttr(rawAttrs, name) {
      const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(rawAttrs || "");
      return m ? m[1].trim() : "";
    }
    function normalizeAdvisorSeverity(value) {
      const sev = String(value || "").trim().toLowerCase();
      return ADVISOR_SEVERITIES.includes(sev) ? sev : "";
    }
    function parseAdvisoryContent(text17) {
      const notes = [];
      const re = /<advisory\b([^>]*)>([\s\S]*?)<\/advisory>/gi;
      let m;
      while (m = re.exec(text17)) {
        const note = m[2].trim();
        if (note) notes.push({ note, severity: advisoryTagAttr(m[1], "severity"), advisor: advisoryTagAttr(m[1], "advisor") });
      }
      if (notes.length) return notes;
      const bare = String(text17 || "").replace(/<\/?advisory\b[^>]*>/gi, "").trim();
      return bare ? [{ note: bare }] : [];
    }
    function advisorNotesFrom(msg) {
      const structured = Array.isArray(msg.details?.notes) ? msg.details.notes : null;
      const notes = (structured && structured.length ? structured : parseAdvisoryContent(extractTextContent(msg.content))).map((n) => ({
        note: n.note,
        severity: normalizeAdvisorSeverity(n.severity),
        advisor: (n.advisor || "").trim()
      })).filter((n) => n.note);
      return notes;
    }
    function advisoryBatchName(msg) {
      const m = /<advisory\b([^>]*)>/i.exec(extractTextContent(msg.content));
      return m ? advisoryTagAttr(m[1], "advisor") : "";
    }
    function advisorSeverityChip(severity) {
      if (!severity) return "";
      return `<span class="advisor-severity sev-${severity}">${escapeHtml(severity)}</span>`;
    }
    function renderAdvisorMessage(msg, time, attrs, timestamp) {
      const notes = advisorNotesFrom(msg);
      if (!notes.length) return "";
      const worst = ADVISOR_SEVERITIES.filter((s) => notes.some((n) => n.severity === s)).pop() || "";
      const names = [...new Set(notes.map((n) => n.advisor).filter(Boolean))];
      const name = names.length === 1 ? names[0] : names.length ? "" : advisoryBatchName(msg);
      const single = notes.length === 1;
      const rows = notes.map((n) => `<div class="advisor-note">
        ${single ? "" : advisorSeverityChip(n.severity)}${!single && !name && n.advisor ? `<span class="advisor-note-name">${escapeHtml(n.advisor)}</span>` : ""}
        <div class="markdown-body">${options2.markdown(n.note)}</div>
      </div>`).join("");
      return `<div${attrs} class="message custom-message advisor${worst ? ` sev-${worst}` : ""}" data-timestamp="${escapeHtml(String(timestamp))}">
    <div class="advisor-card">
      <div class="advisor-header">
        <span class="advisor-icon">\u25C8</span>
        <span class="advisor-label">Advisor${name ? ` \xB7 ${escapeHtml(name)}` : ""}</span>
        ${single ? advisorSeverityChip(notes[0].severity) : `<span class="advisor-count">${notes.length} notes</span>`}
        ${time ? `<span class="message-time">${time}</span>` : ""}
      </div>
      <div class="advisor-notes">${rows}</div>
    </div>
  </div>`;
    }
    function renderCustomMessage(msg, time, attrs = "") {
      const customType = msg.customType || "custom-message";
      const timestamp = msg.timestamp || Date.now();
      if (customType === "interrupted-thinking") {
        return `<div${attrs} class="message custom-message interrupted" data-timestamp="${escapeHtml(String(timestamp))}">
      <span class="custom-message-divider"></span><span class="custom-message-label">Interrupted</span>${time ? `<span class="message-time">${time}</span>` : ""}<span class="custom-message-divider"></span>
    </div>`;
      }
      if (msg.display === false) return "";
      if (customType === "async-result") {
        const jobs = Array.isArray(msg.details?.jobs) ? msg.details.jobs : [];
        const names = jobs.map((job) => job.label || job.jobId).filter(Boolean);
        const duration = jobs.length === 1 && Number.isFinite(jobs[0].durationMs) ? formatDuration(jobs[0].durationMs) : "";
        const meta = [names.join(", "), duration].filter(Boolean).join(" \xB7 ");
        return `<div${attrs} class="message custom-message async-result" data-timestamp="${escapeHtml(String(timestamp))}">
      <span class="custom-message-icon">\u2713</span><span class="custom-message-label">Background job${jobs.length > 1 ? "s" : ""} finished</span>${meta ? `<span class="custom-message-meta">${escapeHtml(meta)}</span>` : ""}${time ? `<span class="message-time">${time}</span>` : ""}
    </div>`;
      }
      if (customType === "advisor") return renderAdvisorMessage(msg, time, attrs, timestamp);
      const text17 = extractTextContent(msg.content);
      const label = customType.replace(/[-_]+/g, " ");
      return `<div${attrs} class="message custom-message generic" data-timestamp="${escapeHtml(String(timestamp))}">
    <span class="custom-message-icon">\u25C7</span><span class="custom-message-label">${escapeHtml(label)}</span>${text17 ? `<span class="custom-message-meta">${escapeHtml(truncate(text17.replace(/\s+/g, " "), 240))}</span>` : ""}${time ? `<span class="message-time">${time}</span>` : ""}
  </div>`;
    }
    function liveCustomMessageKey(message3) {
      const jobs = Array.isArray(message3?.details?.jobs) ? message3.details.jobs.map((job) => job.jobId).filter(Boolean).join(",") : "";
      return `${message3?.customType || "custom-message"}:${message3?.timestamp || jobs}`;
    }
    function upsertLiveCustomMessage(value, { streaming = false } = {}) {
      if (disposed) return;
      const message3 = decodeRenderMessage(value);
      const container = document2.getElementById("messages");
      if (!container) return;
      const wasPinned = options2.pinned(container);
      const key = liveCustomMessageKey(message3);
      const existing = [...container.querySelectorAll(".message.custom-message[data-live-custom-key]")].find((el2) => el2.dataset.liveCustomKey === key);
      const attrs = ` data-live-custom-key="${escapeHtml(key)}"${streaming ? ' data-streaming="true"' : ""}`;
      const tmp = document2.createElement("template");
      tmp.innerHTML = renderCustomMessage(message3, formatTime(message3.timestamp || Date.now()), attrs);
      const el = tmp.content.firstElementChild;
      if (!el) return;
      if (existing) existing.replaceWith(el);
      else container.appendChild(el);
      if (wasPinned || options2.follow()) options2.scroll(container);
      else options2.jump(container);
    }
    return {
      message: (value) => renderMessageHtml(decodeRenderMessage(value)),
      user: (value, time, attrs = "") => renderUserMessage(decodeRenderMessage(value), time, attrs),
      assistant: (value, time, opts) => renderAssistantMessage(decodeRenderMessage(value), time, opts),
      custom: (value, time, attrs = "") => renderCustomMessage(decodeRenderMessage(value), time, attrs),
      images: imageBlocksHtml,
      thinking: renderThinkingBlock,
      tool: renderToolCall,
      upsertCustom: upsertLiveCustomMessage,
      dispose() {
        disposed = true;
      }
    };
  }

  // src/browser/response-details.ts
  function createResponseDetails(options2) {
    const { document: document2, sessionState } = options2;
    const responseDetails = /* @__PURE__ */ new Map();
    let responseDetailSeq = 0, disposed = false;
    const lifetime = new AbortController();
    const key = () => sessionState.currentSession ? sessionRefKey(sessionState.currentSession) : null;
    const model = () => typeof sessionState.currentSession?.model === "string" ? sessionState.currentSession.model : "";
    const current = (detail) => !disposed && detail.key === key();
    function button(value) {
      if (disposed) return "";
      const message3 = decodeRenderMessage(value), detail = responseDetailProjection(message3), id = `response-${++responseDetailSeq}`;
      responseDetails.set(id, detail);
      if (responseDetails.size > 2e3) {
        const first = responseDetails.keys().next().value;
        if (first) responseDetails.delete(first);
      }
      const metadata = formatResponseMetadata(detail, options2.mode());
      return `<button type="button" class="message-speed message-metadata-btn" data-detail-id="${id}" title="Response details. Response time is request start to JSONL append; effective speed includes time to first token."${metadata ? "" : ' style="display:none"'}>${escapeHtml(metadata || "")}</button>`;
    }
    function updateRenderedResponseMetadata() {
      if (disposed) return;
      document2.querySelectorAll(".message-metadata-btn").forEach((btn) => {
        const text17 = formatResponseMetadata(responseDetails.get(btn.dataset.detailId || ""), options2.mode());
        btn.textContent = text17 || "";
        btn.style.display = text17 ? "" : "none";
      });
    }
    function responsePricingKnown(msg) {
      return Number.isFinite(msg?.usage?.cost?.total);
    }
    function responseDetailProjection(msg) {
      return {
        key: key(),
        selectedModel: model(),
        usage: msg.usage,
        durationMs: msg.durationMs,
        outputTokens: msg.outputTokens,
        provider: msg.provider,
        model: msg.model,
        responseModel: msg.responseModel,
        stopReason: msg.stopReason,
        pricingKnown: responsePricingKnown(msg)
      };
    }
    function refreshResponsePricingState() {
      if (disposed) return;
      for (const detail of responseDetails.values()) detail.pricingKnown = responsePricingKnown(detail);
      updateRenderedResponseMetadata();
    }
    function openResponseDetails(id) {
      const m = responseDetails.get(id);
      if (!m || !current(m)) return;
      const u = m.usage || {}, c = u.cost || {};
      const selected = m.model || m.selectedModel || "\u2014";
      const model2 = m.responseModel || selected;
      const prompt = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
      const modelRows = m.responseModel && m.responseModel !== selected ? [["Selected model", selected], ["Response model", model2]] : [["Model", model2]];
      const rows = [
        ...modelRows,
        ["Provider", m.provider || "\u2014"],
        ["Response time", m.durationMs ? formatDuration(m.durationMs) : "\u2014"],
        ["Effective speed", formatTokSpeed(m.outputTokens || u.output, m.durationMs) || "\u2014"],
        ["Tokens", `${formatTokens(u.input)} input \xB7 ${formatTokens(u.output)} output${u.reasoning ? ` \xB7 ${formatTokens(u.reasoning)} reasoning` : ""}`],
        ["Cache", `${formatTokens(u.cacheRead)} read \xB7 ${formatTokens(u.cacheWrite)} write${prompt ? ` \xB7 ${Math.round((u.cacheRead || 0) / prompt * 100)}% hit` : ""}`],
        ["Estimated input", formatEstimatedCost(c.input)],
        ["Estimated output", formatEstimatedCost(c.output)],
        ["Estimated cache read / write", `${formatEstimatedCost(c.cacheRead)} / ${formatEstimatedCost(c.cacheWrite)}`],
        ["Estimated total", formatEstimatedCost(c.total)],
        ["Stop reason", m.stopReason || "\u2014"]
      ];
      document2.getElementById("responseDetailsBody").innerHTML = '<div class="telemetry-note">Pi catalog estimates, not provider-billed amounts. Response time is request start \u2192 JSONL append; effective speed includes TTFT.</div><table class="stats-table">' + rows.map(([k, v]) => `<tr><td class="stats-key">${escapeHtml(k)}</td><td class="stats-val">${escapeHtml(v)}</td></tr>`).join("") + "</table>";
      document2.getElementById("responseDetailsModal").style.display = "flex";
    }
    function closeResponseDetails() {
      document2.getElementById("responseDetailsModal").style.display = "none";
    }
    document2.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const button2 = event.target.closest(".message-metadata-btn");
      if (button2?.isConnected && button2.dataset.detailId) openResponseDetails(button2.dataset.detailId);
    }, { signal: lifetime.signal });
    return {
      button,
      update: updateRenderedResponseMetadata,
      refreshPricing: refreshResponsePricingState,
      open: openResponseDetails,
      close: closeResponseDetails,
      get size() {
        return responseDetails.size;
      },
      dispose() {
        if (disposed) return;
        closeResponseDetails();
        disposed = true;
        lifetime.abort();
        responseDetails.clear();
      }
    };
  }

  // src/browser/message-groups.ts
  function groupToolActivity(container) {
    if (!container) return;
    const document2 = container.ownerDocument;
    const isToolNoise = (el) => el.matches(".message.tool-result[data-msg-index], .message.assistant.no-text[data-msg-index]");
    let run = [];
    const wrapRun = () => {
      if (!run.length) return;
      const group = document2.createElement("details");
      group.className = "tool-group";
      group.innerHTML = '<summary class="tool-group-header"><span class="tool-group-label"></span><span class="tool-group-preview"></span></summary><div class="tool-group-body"></div>';
      run[0].before(group);
      const body = group.querySelector(".tool-group-body");
      run.forEach((el) => body.appendChild(el));
      run = [];
    };
    for (const child of Array.from(container.children)) {
      if (isToolNoise(child)) run.push(child);
      else wrapRun();
    }
    wrapRun();
    container.querySelectorAll(":scope > details.tool-group").forEach((group) => {
      const next = group.nextElementSibling;
      if (!next || !next.matches("details.tool-group")) return;
      next.querySelector(".tool-group-body").prepend(...group.querySelector(".tool-group-body").childNodes);
      if (group.open && next instanceof HTMLDetailsElement) next.open = true;
      group.remove();
    });
    container.querySelectorAll(":scope > details.tool-group").forEach(updateToolGroupSummary);
  }
  function updateToolGroupSummary(group) {
    const calls = group.querySelectorAll("details.tool-call").length;
    const results = group.querySelectorAll(".message.tool-result").length;
    const n = Math.max(calls, results);
    const names = [...new Set(
      [...group.querySelectorAll(".tool-call-name")].map((el) => (el.textContent || "").trim())
    )];
    group.querySelector(".tool-group-label").textContent = n ? `\u26A1 ${n} tool use${n === 1 ? "" : "s"}` : "\u{1F9E0} thinking";
    group.querySelector(".tool-group-preview").textContent = names.slice(0, 4).join(", ") + (names.length > 4 ? "\u2026" : "");
  }

  // src/browser/live-tools.ts
  function decode(value) {
    if (!record8(value) || typeof value.toolCallId !== "string" || !value.toolCallId) return null;
    return {
      toolCallId: value.toolCallId,
      toolName: typeof value.toolName === "string" ? value.toolName : void 0,
      args: value.args,
      startedAt: typeof value.startedAt === "string" || finite2(value.startedAt) ? value.startedAt : void 0,
      partialResult: record8(value.partialResult) ? { content: value.partialResult.content } : void 0,
      result: record8(value.result) ? { content: value.result.content } : void 0,
      isError: value.isError === true
    };
  }
  function createLiveTools(options2) {
    const { document: document2, sessionState } = options2;
    let disposed = false;
    const liveToolPanels = /* @__PURE__ */ new Map(), retained = /* @__PURE__ */ new WeakMap();
    const owns = (owner) => !disposed && sessionState.ownsSelection(owner);
    function lookup(id) {
      const owner = sessionState.captureSelection(), container = document2.getElementById("messages");
      if (disposed || !owner || !container) return null;
      const matches = (entry2) => !!entry2 && entry2.owner.id === owner.id && entry2.owner.host === owner.host && container.contains(entry2.el);
      let entry = liveToolPanels.get(id);
      if (!matches(entry)) entry = Array.from(container.querySelectorAll("details.live-tool-panel")).filter((el) => el.dataset.toolCallId === id).map((el) => retained.get(el)).find(matches);
      if (!entry || !matches(entry)) return null;
      entry.owner = owner;
      liveToolPanels.set(id, entry);
      return entry;
    }
    function liveToolOutputHtml(output) {
      const parsed = parseIpythonResult(output);
      return escapeHtml(truncate(parsed ? parsed.output : output, 8e3));
    }
    function buildLiveToolPanel(toolCallId, toolName, args, output, isError, isComplete, durationMs = null, imagesHtml = "") {
      const stateClass = isComplete ? isError ? "error" : "complete" : "running";
      const summary = getToolSummary(toolName, args);
      const openAttr = output || imagesHtml ? " open" : "";
      let statusHtml = "";
      if (isComplete) {
        if (isError) {
          statusHtml = '<span class="live-tool-status error-label">\u2717 error</span>';
        } else {
          const dur = durationMs != null ? (durationMs / 1e3).toFixed(1) + "s" : "";
          statusHtml = '<span class="live-tool-status success-label">\u2713</span>' + (dur ? '<span class="live-tool-status duration">' + dur + "</span>" : "");
        }
      } else {
        statusHtml = '<span class="live-tool-status running-label">running</span>';
      }
      const cursorHtml = isComplete ? "" : '<span class="live-tool-cursor"></span>';
      const outputHtml = output ? '<div class="live-tool-output">' + liveToolOutputHtml(output) + cursorHtml + "</div>" : !isComplete ? '<div class="live-tool-output"><span class="live-tool-cursor"></span></div>' : "";
      return '<details class="live-tool-panel ' + stateClass + '" data-tool-call-id="' + escapeHtml(toolCallId) + '"' + openAttr + '><summary class="live-tool-header"><span class="live-tool-icon">\u26A1</span><span class="live-tool-name">' + escapeHtml(toolName) + "</span>" + (summary ? '<span class="live-tool-summary">' + escapeHtml(summary) + "</span>" : "") + statusHtml + '<span class="live-tool-status-dot"></span></summary>' + outputHtml + imagesHtml + "</details>";
    }
    function appendLiveToolPanel(data, { completionOnly = false } = {}) {
      const owner = sessionState.captureSelection();
      if (disposed || !owner) return null;
      const { toolCallId, toolName, args } = data;
      if (!toolCallId) return null;
      const existing = lookup(toolCallId);
      const resolvedName = toolName || existing?.toolName || "tool";
      const resolvedArgs = args ?? existing?.args ?? {};
      options2.started(toolCallId, resolvedName);
      if (existing?.el?.isConnected && existing.el.classList.contains("running")) {
        return existing;
      }
      const container = document2.getElementById("messages");
      if (!container) return null;
      const wasPinned = options2.pinned(container);
      const html = buildLiveToolPanel(toolCallId, resolvedName, resolvedArgs, "", false, false);
      let el;
      if (existing?.el?.isConnected) {
        const tmp = document2.createElement("div");
        tmp.innerHTML = html;
        el = tmp.firstElementChild;
        existing.el.replaceWith(el);
      } else {
        container.insertAdjacentHTML("beforeend", html);
        el = container.lastElementChild;
      }
      const parsedStartedAt = finite2(data.startedAt) ? data.startedAt : typeof data.startedAt === "string" ? Date.parse(data.startedAt) : NaN;
      const entry = {
        owner,
        el,
        startTime: finite2(parsedStartedAt) ? parsedStartedAt : completionOnly ? null : Date.now(),
        toolName: resolvedName,
        args: resolvedArgs
      };
      liveToolPanels.set(toolCallId, entry);
      retained.set(el, entry);
      if (wasPinned) options2.scroll(container);
      else options2.jump(container);
      return entry;
    }
    function updateLiveToolPanel(data) {
      if (disposed || !sessionState.captureSelection()) return;
      const { toolCallId, partialResult } = data;
      let entry = lookup(toolCallId);
      if (!entry?.el?.isConnected || !entry.el.classList.contains("running")) {
        entry = appendLiveToolPanel({
          ...data,
          toolName: data.toolName || entry?.toolName,
          args: data.args ?? entry?.args
        });
      }
      if (!entry?.el) return;
      const output = getToolOutputText(partialResult);
      const imagesHtml = options2.images(partialResult && partialResult.content, "tool result image");
      if (!output && !imagesHtml) return;
      const container = document2.getElementById("messages");
      const wasPinned = container ? options2.pinned(container) : false;
      let outputEl = entry.el.querySelector(".live-tool-output");
      if (output && !outputEl) {
        const cursorHtml = '<span class="live-tool-cursor"></span>';
        outputEl = document2.createElement("div");
        outputEl.className = "live-tool-output";
        outputEl.innerHTML = liveToolOutputHtml(output) + cursorHtml;
        entry.el.appendChild(outputEl);
        entry.el.setAttribute("open", "");
      } else if (output && outputEl) {
        const cursorEl = outputEl.querySelector(".live-tool-cursor");
        outputEl.innerHTML = liveToolOutputHtml(output);
        if (cursorEl) outputEl.appendChild(cursorEl);
        else outputEl.insertAdjacentHTML("beforeend", '<span class="live-tool-cursor"></span>');
      }
      if (imagesHtml) {
        const existing = entry.el.querySelector(".msg-images");
        if (existing) existing.outerHTML = imagesHtml;
        else entry.el.insertAdjacentHTML("beforeend", imagesHtml);
        entry.el.setAttribute("open", "");
      }
      if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
      if (container && wasPinned) options2.scroll(container);
    }
    function finalizeLiveToolPanel(data) {
      if (disposed || !sessionState.captureSelection()) return;
      const { toolCallId, toolName, args, result, isError } = data;
      let entry = lookup(toolCallId);
      if (!entry?.el?.isConnected) {
        entry = appendLiveToolPanel(data, { completionOnly: true });
      }
      options2.finished(toolCallId);
      const resolvedName = toolName || entry?.toolName || "tool";
      const resolvedArgs = args ?? entry?.args ?? {};
      options2.mood(resolvedName, resolvedArgs);
      if (!entry?.el) return;
      const output = getToolOutputText(result);
      const imagesHtml = options2.images(result && result.content, "tool result image");
      const durationMs = entry.startTime ? Date.now() - entry.startTime : null;
      const newHtml = buildLiveToolPanel(toolCallId, resolvedName, resolvedArgs, output, isError, true, durationMs, imagesHtml);
      const tmp = document2.createElement("div");
      tmp.innerHTML = newHtml;
      const newEl = tmp.firstElementChild;
      entry.el.replaceWith(newEl);
      entry.el = newEl;
      retained.set(newEl, entry);
      entry.toolName = resolvedName;
      entry.args = resolvedArgs;
    }
    function clear(container) {
      container?.querySelectorAll("details.live-tool-panel").forEach((el) => el.remove());
      liveToolPanels.clear();
    }
    function finishRunning() {
      for (const entry of liveToolPanels.values()) {
        if (!owns(entry.owner) || !entry.el.classList.contains("running")) continue;
        entry.el.classList.remove("running");
        entry.el.classList.add("complete");
        const dot = entry.el.querySelector(".live-tool-status-dot");
        if (dot) dot.style.display = "none";
        entry.el.querySelector(".live-tool-cursor")?.remove();
      }
    }
    return {
      append(value, options3) {
        const data = decode(value);
        return data ? appendLiveToolPanel(data, options3) : null;
      },
      update(value) {
        const data = decode(value);
        if (data) updateLiveToolPanel(data);
      },
      finish(value) {
        const data = decode(value);
        if (data) finalizeLiveToolPanel(data);
      },
      clear,
      finishRunning,
      get count() {
        return liveToolPanels.size;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        liveToolPanels.clear();
      }
    };
  }

  // src/browser/streaming-render.ts
  function createStreamingRenderer(options2) {
    const { document: document2, sessionState } = options2;
    const sources = /* @__PURE__ */ new WeakMap();
    let disposed = false, timer = null;
    let pending = null;
    function queue(value) {
      const owner = sessionState.captureSelection();
      if (disposed || !owner) return;
      pending = { message: decodeRenderMessage(value), owner };
      if (!timer) flush();
    }
    function flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      const frame = pending;
      pending = null;
      if (disposed || !frame || !sessionState.ownsSelection(frame.owner)) return;
      try {
        renderStreamingMessage(frame.message, frame.owner);
      } catch (error) {
        console.error("streaming render failed:", error);
      }
      timer = setTimeout(flush, 80);
    }
    function cancel() {
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
    }
    function ensureStreamingElement(container) {
      let el = container.querySelector('.message.assistant[data-streaming="true"]');
      if (el) return el;
      const ts = Date.now();
      container.insertAdjacentHTML(
        "beforeend",
        `<div class="message assistant streaming no-text" data-streaming="true" data-timestamp="${ts}">
      <div class="message-header">
        <span class="message-role assistant">\u03C0</span>
        <span class="badge streaming">\u25CF</span>
        <span class="message-time">${formatTime(ts)}</span>
      </div>
    </div>`
      );
      return container.querySelector('.message.assistant[data-streaming="true"]');
    }
    function renderStreamingMessage(message3, owner = sessionState.captureSelection()) {
      if (disposed || !sessionState.ownsSelection(owner)) return;
      const container = document2.getElementById("messages");
      if (!container) return;
      const wasPinned = options2.pinned(container);
      const el = ensureStreamingElement(container);
      const blocks = Array.isArray(message3.content) ? message3.content : typeof message3.content === "string" ? [{ type: "text", text: message3.content }] : [];
      blocks.forEach((block, i) => {
        if (typeof block === "string") return;
        let blockEl = el.querySelector(`[data-block-index="${i}"]`);
        if (blockEl && blockEl.dataset.blockType !== block.type) {
          blockEl.remove();
          blockEl = null;
        }
        if (block.type === "thinking") {
          const text17 = block.thinking || "";
          if (!blockEl) {
            el.insertAdjacentHTML(
              "beforeend",
              `<details class="thinking-block" data-block-index="${i}" data-block-type="thinking">
            <summary class="thinking-header"><span class="thinking-label">Thinking</span><span class="thinking-preview"></span></summary>
            <div class="thinking-text"></div>
          </details>`
            );
            blockEl = el.querySelector(`[data-block-index="${i}"]`);
          }
          if (!blockEl) return;
          if (sources.get(blockEl) !== text17) {
            sources.set(blockEl, text17);
            blockEl.querySelector(".thinking-preview").textContent = text17.substring(0, 80).replace(/\n/g, " ") + "\u2026";
            blockEl.querySelector(".thinking-text").textContent = text17;
          }
        } else if (block.type === "text") {
          const text17 = block.text || "";
          if (!blockEl) {
            el.insertAdjacentHTML(
              "beforeend",
              `<div class="message-content" data-block-index="${i}" data-block-type="text"><div class="markdown-body"></div></div>`
            );
            blockEl = el.querySelector(`[data-block-index="${i}"]`);
          }
          if (!blockEl) return;
          if (sources.get(blockEl) !== text17) {
            sources.set(blockEl, text17);
            blockEl.querySelector(".markdown-body").innerHTML = options2.markdown(text17);
          }
        } else if (block.type === "toolCall") {
          const args = block.arguments || {};
          const argsJson = JSON.stringify(args, null, 2);
          const bodyText = block.name === "ipython" && typeof args.code === "string" ? args.code : argsJson;
          if (!blockEl) {
            el.insertAdjacentHTML(
              "beforeend",
              `<details class="tool-call" data-block-index="${i}" data-block-type="toolCall">
            <summary class="tool-call-header">
              <span class="tool-call-icon">\u26A1</span><span class="tool-call-name"></span>
              <span class="tool-call-summary"></span>
            </summary>
            <div class="tool-call-content"><pre><code></code></pre></div>
          </details>`
            );
            blockEl = el.querySelector(`[data-block-index="${i}"]`);
          }
          if (!blockEl) return;
          const signature = JSON.stringify([block.name, args]);
          if (sources.get(blockEl) !== signature) {
            sources.set(blockEl, signature);
            blockEl.querySelector(".tool-call-name").textContent = block.name || "tool";
            blockEl.querySelector(".tool-call-summary").textContent = getToolSummary(block.name || "", args);
            blockEl.querySelector(".tool-call-content code").textContent = bodyText;
          }
        }
      });
      el.classList.toggle("no-text", !messageHasVisibleText(message3));
      if (wasPinned) options2.scroll(container);
      else options2.jump(container);
    }
    return { queue, flush, cancel, render(value) {
      renderStreamingMessage(decodeRenderMessage(value));
    }, dispose() {
      cancel();
      disposed = true;
    } };
  }

  // src/browser/mood.ts
  function createMood(document2) {
    function setMoodIndicator(description, face) {
      const inputArea = document2.querySelector(".input-area");
      if (!inputArea) return;
      let el = document2.getElementById("moodIndicator");
      const mood = normalizeMood(description, face);
      if (!mood) {
        el?.remove();
        return;
      }
      if (!el) {
        el = document2.createElement("div");
        el.id = "moodIndicator";
        el.className = "mood-indicator";
        inputArea.insertBefore(el, inputArea.firstChild);
      }
      el.dataset.moodDescription = String(mood.description);
      el.dataset.moodFace = String(mood.face);
      el.textContent = `${mood.description} ${mood.face}`.trim();
    }
    function applyMoodFromTool(toolName, value) {
      const args = record8(value) ? value : {};
      if (toolName !== "set_mood") return;
      setMoodIndicator(args?.description ?? args?.label, args?.kaomoji || args?.face || args?.mood);
    }
    function updateMoodFromMessages(messages) {
      for (const value of messages || []) {
        const msg = decodeRenderMessage(value);
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const block of content) {
          if (typeof block !== "string" && block?.type === "toolCall" && block.name === "set_mood") {
            applyMoodFromTool(block.name, block.arguments || {});
          }
        }
      }
    }
    return { set: setMoodIndicator, fromTool: applyMoodFromTool, fromMessages: updateMoodFromMessages };
  }

  // src/browser/transcript-cache.ts
  function createTranscriptCache(document2) {
    const entries = /* @__PURE__ */ new Map();
    function prune(skip) {
      const now = Date.now();
      for (const [key, entry] of entries) if (key !== skip && now - entry.lastUsed > 15 * 60 * 1e3) entries.delete(key);
      while (entries.size > 5) {
        const oldest = [...entries].filter(([key]) => key !== skip).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        if (!oldest) break;
        entries.delete(oldest[0]);
      }
    }
    function stash(key, base, cursors, container) {
      if (cursors.lastIndex == null || container.querySelector(".loading, .error")) return;
      const scrollTop = container.scrollTop, mood = document2.getElementById("moodIndicator"), fragment = entries.get(key)?.fragment || document2.createDocumentFragment();
      fragment.replaceChildren();
      while (container.firstChild) fragment.appendChild(container.firstChild);
      const entry = { ...cursors, fragment, base, scrollTop, moodDescription: mood?.dataset.moodDescription || "", moodFace: mood?.dataset.moodFace || "", lastUsed: Date.now() };
      const indexed = fragment.querySelectorAll("[data-msg-index]");
      if (indexed.length > 300) {
        let keep = indexed[indexed.length - 300];
        while (keep.parentNode && keep.parentNode !== fragment) keep = keep.parentNode;
        while (fragment.firstChild && fragment.firstChild !== keep) fragment.firstChild.remove();
        const first = fragment.querySelector("[data-msg-index]"), index = Number.parseInt(first?.dataset.msgIndex || "", 10);
        if (Number.isFinite(index)) {
          entry.oldestIndex = index;
          entry.hasOlder = index > 0;
        }
      }
      entries.set(key, entry);
      prune(key);
    }
    function restore(key, base, container) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.base !== base || Date.now() - entry.lastUsed > 15 * 60 * 1e3) {
        entries.delete(key);
        return null;
      }
      if (!entry.fragment.childNodes.length) return null;
      container.replaceChildren(entry.fragment);
      container.scrollTop = entry.scrollTop;
      entry.lastUsed = Date.now();
      prune(key);
      return entry;
    }
    return { stash, restore, prune, delete: (key) => entries.delete(key), roots: () => [...entries.values()].map((entry) => entry.fragment), clear: () => entries.clear(), get size() {
      return entries.size;
    } };
  }

  // src/browser/transcript-data.ts
  var cursor = (value) => finite2(value) && Number.isInteger(value) && value >= 0 ? value : null;
  function decodeTranscriptPage(value) {
    if (!record8(value) || !Array.isArray(value.messages)) throw new Error("Invalid transcript page");
    const session = record8(value.session) ? { ...value.session } : {};
    delete session.id;
    delete session.host;
    return { messages: value.messages.map(decodeRenderMessage), session, firstIndex: cursor(value.firstIndex), lastIndex: cursor(value.lastIndex), hasMore: value.hasMore === true, totalMessages: cursor(value.totalMessages) };
  }

  // src/browser/transcript.ts
  function createTranscript(options2) {
    const { document: document2, sessionState } = options2, container = document2.getElementById("messages");
    const cache = createTranscriptCache(document2), requests = /* @__PURE__ */ new Set();
    let disposed = false, generation = 0, catchupSequence = 0, older = null, barEvents = new AbortController();
    let cursors = { oldestIndex: null, lastIndex: null, hasOlder: false, total: 0 };
    let loaded = null;
    function capture(selection = sessionState.captureSelection()) {
      if (disposed || !selection || !sessionState.ownsSelection(selection)) return null;
      const endpoint = options2.host(selection.host);
      return endpoint ? { selection, endpoint: Object.freeze({ ...endpoint }), generation } : null;
    }
    const owns = (owner) => !disposed && owner.generation === generation && sessionState.ownsSelection(owner.selection) && options2.host(owner.selection.host)?.base === owner.endpoint.base;
    function retire() {
      generation++;
      catchupSequence++;
      older = null;
      barEvents.abort();
      for (const request of requests) request.abort();
      requests.clear();
    }
    function reset() {
      retire();
      loaded = null;
      cursors = { oldestIndex: null, lastIndex: null, hasOlder: false, total: 0 };
    }
    async function page(owner, suffix) {
      const endpoint = options2.host(owner.selection.host);
      if (!owns(owner) || !endpoint) throw new Error("Transcript ownership changed");
      const controller = new AbortController();
      requests.add(controller);
      try {
        const response = await options2.request({ ...owner.endpoint, token: endpoint.token }, `/api/sessions/${encodeURIComponent(owner.selection.id)}/messages?${suffix}`, { signal: controller.signal });
        const value = await response.json();
        if (!response.ok) throw new Error(record8(value) && typeof value.error === "string" ? value.error : `Transcript request failed (${response.status})`);
        return decodeTranscriptPage(value);
      } finally {
        requests.delete(controller);
      }
    }
    function barHtml() {
      return cursors.hasOlder ? `<div class="load-older-bar" id="loadOlderBar"><button class="load-older-btn">Load older messages (${cursors.oldestIndex ?? 0} earlier)</button></div>` : "";
    }
    function bindBar() {
      barEvents.abort();
      barEvents = new AbortController();
      const owner = capture(), button = container.querySelector(".load-older-btn");
      if (owner && button) button.addEventListener("click", () => {
        if (owns(owner) && button.isConnected && container.contains(button)) void loadOlder();
      }, { signal: barEvents.signal });
    }
    function stash() {
      const selected = sessionState.currentSession;
      if (disposed || !selected || !loaded || loaded.key !== sessionRefKey(selected)) return;
      cache.stash(loaded.key, loaded.base, cursors, container);
    }
    function restore(id) {
      const owner = capture();
      if (!owner || owner.selection.id !== id) return false;
      const key = sessionRefKey(owner.selection), entry = cache.restore(key, owner.endpoint.base, container);
      if (!entry) return false;
      cursors = { oldestIndex: entry.oldestIndex, lastIndex: entry.lastIndex, hasOlder: entry.hasOlder, total: entry.total };
      loaded = { key, base: owner.endpoint.base };
      options2.mood(entry.moodDescription, entry.moodFace);
      options2.jump(container);
      bindBar();
      return true;
    }
    function render(messages) {
      if (disposed) return;
      options2.updateMood(messages);
      if (!messages.length) {
        container.innerHTML = '<div class="empty-state" style="padding: 48px;"><p style="color: var(--text-muted);">No messages yet</p></div>';
        barEvents.abort();
        return;
      }
      container.innerHTML = barHtml() + messages.map(options2.renderMessage).join("");
      bindBar();
      options2.finalize(container);
      options2.scroll(container);
    }
    async function load(selection = sessionState.captureSelection()) {
      if (!capture(selection)) return;
      retire();
      const owner = capture(selection);
      if (!owner) return;
      options2.cancelStreaming();
      options2.closeSearch();
      if (restore(owner.selection.id)) {
        await catchup(selection);
        return;
      }
      loaded = null;
      container.innerHTML = '<div class="loading">Loading...</div>';
      cursors = { oldestIndex: null, lastIndex: null, hasOlder: false, total: 0 };
      options2.mood("", "");
      try {
        const data = await page(owner, "limit=50");
        if (!owns(owner)) return;
        sessionState.mergeCurrentSession(owner.selection, data.session);
        loaded = { key: sessionRefKey(owner.selection), base: owner.endpoint.base };
        cursors = { oldestIndex: data.firstIndex, lastIndex: data.lastIndex, hasOlder: data.hasMore, total: data.totalMessages || 0 };
        render(data.messages);
      } catch (error) {
        if (owns(owner)) container.innerHTML = `<div class="error">Failed to load messages: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
      }
    }
    async function loadOlder() {
      if (older || !cursors.hasOlder || cursors.oldestIndex == null) return;
      const owner = capture();
      if (!owner) return;
      const operation = /* @__PURE__ */ Symbol("older"), before = cursors.oldestIndex;
      older = operation;
      const bar = container.querySelector("#loadOlderBar"), button = bar?.querySelector(".load-older-btn");
      if (button) button.textContent = "Loading...";
      const anchor = container.querySelector(":scope > .message, :scope > details.tool-group"), offset = anchor?.getBoundingClientRect().top || 0;
      try {
        const data = await page(owner, "limit=50&before=" + before);
        if (!owns(owner) || older !== operation) return;
        if (data.messages.length) {
          const html = data.messages.map(options2.renderMessage).join("");
          container.querySelector("#loadOlderBar")?.remove();
          cursors.oldestIndex = data.firstIndex ?? cursors.oldestIndex;
          cursors.hasOlder = data.hasMore;
          container.insertAdjacentHTML("afterbegin", barHtml() + html);
          bindBar();
          options2.finalize(container, { stripLive: false });
          if (!document2.getElementById("moodIndicator")) options2.updateMood(data.messages);
          if (anchor?.isConnected && container.contains(anchor)) container.scrollTop += anchor.getBoundingClientRect().top - offset;
        } else {
          cursors.hasOlder = false;
          container.querySelector("#loadOlderBar")?.remove();
          barEvents.abort();
        }
      } catch (error) {
        if (owns(owner) && older === operation && button?.isConnected) button.textContent = `Failed: ${error instanceof Error ? error.message : String(error)} \u2014 retry`;
      } finally {
        if (older === operation) older = null;
      }
    }
    async function catchup(selection = sessionState.captureSelection()) {
      const owner = capture(selection);
      if (!owner) return;
      if (cursors.lastIndex == null) return load(selection);
      const sequence = ++catchupSequence, after = cursors.lastIndex;
      try {
        const data = await page(owner, "after=" + after);
        if (!owns(owner) || sequence !== catchupSequence) return;
        sessionState.mergeCurrentSession(owner.selection, data.session);
        if (data.totalMessages != null) cursors.total = data.totalMessages;
        if (!data.messages.length) return;
        const existing = new Set(Array.from(container.querySelectorAll("[data-msg-index]")).map((el) => Number.parseInt(el.dataset.msgIndex || "", 10)));
        const fresh = data.messages.filter((message3) => message3.index == null || !existing.has(message3.index));
        for (const message3 of fresh) if (message3.role === "user") options2.consumeEcho(owner.selection.id, message3.content);
        options2.updateMood(fresh);
        if (!fresh.length) {
          if (data.lastIndex != null) cursors.lastIndex = Math.max(cursors.lastIndex ?? 0, data.lastIndex);
          return;
        }
        const pinned = options2.pinned(container), assistant = fresh.some((message3) => message3.role === "assistant");
        container.querySelectorAll(".message:not([data-msg-index])").forEach((el) => {
          if (el.classList.contains("assistant") && !assistant) return;
          el.remove();
        });
        container.insertAdjacentHTML("beforeend", fresh.map(options2.renderMessage).join(""));
        if (data.lastIndex != null) cursors.lastIndex = Math.max(cursors.lastIndex ?? 0, data.lastIndex);
        options2.finalize(container);
        if (pinned) options2.scroll(container);
        else options2.jump(container);
      } catch (error) {
        if (owns(owner) && sequence === catchupSequence) console.error("fetchNewMessagesSince failed:", error);
      }
    }
    return {
      load,
      loadOlder,
      catchup,
      render,
      stash,
      restore,
      reset,
      retire,
      barHtml,
      maybeOlder(root) {
        if (root && root.scrollTop <= 200) void loadOlder();
      },
      deleteCached: (key) => cache.delete(key),
      retainedRoots: cache.roots,
      pruneCache: cache.prune,
      get oldestIndex() {
        return cursors.oldestIndex;
      },
      get lastIndex() {
        return cursors.lastIndex;
      },
      get hasOlder() {
        return cursors.hasOlder;
      },
      get total() {
        return cursors.total;
      },
      get loadingOlder() {
        return !!older;
      },
      dispose() {
        if (disposed) return;
        retire();
        disposed = true;
        cache.clear();
        loaded = null;
      }
    };
  }

  // src/browser/session-activity.ts
  function createSessionActivity(options2) {
    const { document: document2, sessionState } = options2;
    let turnInProgress = false, disposed = false;
    let owner = null;
    let turnStartedAt = null;
    let workingTicker = null;
    const runningTools = /* @__PURE__ */ new Map();
    let compactingNow = false;
    let compactingStartedAt = null;
    function updateWorkingIndicator() {
      if (disposed || !sessionState.ownsSelection(owner)) return;
      const desktop = document2.querySelector("#sessionWorking .spinner-text");
      const mobile = document2.querySelector("#sessionWorkingMobile .spinner-text");
      if (compactingNow) {
        const elapsed2 = compactingStartedAt ? formatDuration(Date.now() - compactingStartedAt) : "";
        if (desktop) desktop.textContent = "Compacting context\u2026" + (elapsed2 ? " " + elapsed2 : "");
        if (mobile) mobile.textContent = "Compacting\u2026";
        return;
      }
      if (!turnInProgress || !turnStartedAt) {
        if (desktop) desktop.textContent = "Working";
        if (mobile) mobile.textContent = "idle";
        return;
      }
      const elapsed = formatDuration(Date.now() - turnStartedAt);
      let tool = null;
      for (const name of runningTools.values()) tool = name;
      if (tool && tool.length > 24) tool = tool.slice(0, 24) + "\u2026";
      if (desktop) desktop.textContent = `Working ${elapsed}` + (tool ? ` \xB7 ${tool}` : "");
      if (mobile) mobile.textContent = elapsed + (tool ? ` \xB7 ${tool}` : "");
    }
    function syncActivityIndicator() {
      const active = turnInProgress || compactingNow;
      if (active) {
        if (!workingTicker) workingTicker = setInterval(updateWorkingIndicator, 1e3);
      } else if (workingTicker) {
        clearInterval(workingTicker);
        workingTicker = null;
      }
      var workingDesktop = document2.getElementById("sessionWorking");
      var workingMobile = document2.getElementById("sessionWorkingMobile");
      if (workingDesktop) workingDesktop.classList.toggle("active", active);
      if (workingMobile) workingMobile.classList.toggle("active", active);
      var btnStop = document2.getElementById("btnStop");
      if (btnStop) btnStop.style.visibility = active ? "visible" : "hidden";
      updateWorkingIndicator();
    }
    function setTurnInProgress(active) {
      if (disposed) return;
      owner = sessionState.captureSelection();
      const starting = active && !turnInProgress;
      turnInProgress = active;
      if (starting) {
        turnStartedAt = Date.now();
      } else if (!active) {
        turnStartedAt = null;
        runningTools.clear();
      }
      syncActivityIndicator();
      if (sessionState.currentSession && !!sessionState.currentSession.turnInProgress !== !!active) {
        sessionState.patchSession(sessionState.currentSession.id, { turnInProgress: !!active });
      }
      var btnSteer = document2.getElementById("btnSteer");
      var btnFollowUp = document2.getElementById("btnFollowUp");
      var btnSend = document2.getElementById("btnSend");
      if (btnSteer) btnSteer.style.display = active ? "" : "none";
      if (btnFollowUp) btnFollowUp.style.display = active ? "" : "none";
      if (btnSend) btnSend.style.display = active ? "none" : "";
      if (!active && !compactingNow) {
        options2.clearQueue();
        options2.status("");
      }
    }
    function setCompacting(active) {
      if (disposed) return;
      owner = sessionState.captureSelection();
      const on = !!active;
      compactingNow = on;
      compactingStartedAt = on ? compactingStartedAt || Date.now() : null;
      syncActivityIndicator();
      if (sessionState.currentSession && !!sessionState.currentSession.compacting !== on) {
        sessionState.patchSession(sessionState.currentSession.id, { compacting: on });
      }
    }
    function toolStarted(id, name) {
      if (disposed) return;
      runningTools.set(id, name);
      updateWorkingIndicator();
    }
    function toolFinished(id) {
      if (disposed) return;
      runningTools.delete(id);
      updateWorkingIndicator();
    }
    const aborts = /* @__PURE__ */ new Map();
    function beginAbort(key) {
      if (disposed || aborts.has(key)) return null;
      const token = /* @__PURE__ */ Symbol();
      aborts.set(key, token);
      return token;
    }
    function endAbort(key, token) {
      if (token === void 0 || aborts.get(key) === token) aborts.delete(key);
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      if (workingTicker) clearInterval(workingTicker);
      workingTicker = null;
      runningTools.clear();
      aborts.clear();
    }
    return {
      setTurn: setTurnInProgress,
      setCompacting,
      update: updateWorkingIndicator,
      toolStarted,
      toolFinished,
      beginAbort,
      endAbort,
      isAborting: (key) => aborts.has(key),
      dispose,
      get turn() {
        return turnInProgress;
      },
      get compacting() {
        return compactingNow;
      }
    };
  }

  // src/browser/btw-panel.ts
  function createBtwPanel(options2) {
    const panel = options2.document.getElementById("btwPanel");
    let current = null, generation = 0, answer = null, disposed = false;
    let events = new AbortController(), timer = null;
    function owns(owner) {
      return !disposed && !!owner && current === owner && options2.sessionState.ownsSelection(owner.selection);
    }
    function close() {
      current = null;
      answer = null;
      events.abort();
      if (timer) clearTimeout(timer);
      timer = null;
      panel.style.display = "none";
      panel.innerHTML = "";
    }
    function show(question) {
      if (disposed) return null;
      close();
      const selection = options2.sessionState.captureSelection();
      if (!selection) return null;
      const owner = Object.freeze({ selection, generation: ++generation });
      current = owner;
      events = new AbortController();
      const { signal } = events;
      panel.className = "btw-panel pending";
      panel.innerHTML = `<div class="btw-panel-header"><span class="btw-panel-tag">btw</span>
      <span class="btw-panel-question" title="Click to expand">${escapeHtml(question)}</span>
      <button class="btw-panel-btn btw-copy" style="display:none" title="Copy answer">Copy</button>
      <button class="btw-panel-btn btw-dismiss" title="Dismiss">\u2715</button></div><div class="btw-panel-answer">Asking\u2026</div>`;
      panel.style.display = "";
      panel.querySelector(".btw-panel-question").addEventListener("click", (event) => {
        if (owns(owner)) event.currentTarget.classList.toggle("expanded");
      }, { signal });
      panel.querySelector(".btw-dismiss").addEventListener("click", () => {
        if (owns(owner)) close();
      }, { signal });
      const button = panel.querySelector(".btw-copy");
      button.addEventListener("click", () => {
        void copy(button, owner);
      }, { signal });
      return owner;
    }
    function resolve(text17, owner) {
      if (!owns(owner)) return;
      answer = text17;
      panel.className = "btw-panel";
      panel.querySelector(".btw-panel-answer").innerHTML = `<div class="markdown-body">${options2.markdown(text17)}</div>`;
      panel.querySelector(".btw-copy").style.display = "";
    }
    function fail(error, owner) {
      if (!owns(owner)) return;
      panel.className = "btw-panel error";
      panel.querySelector(".btw-panel-answer").textContent = error;
    }
    async function copy(button, owner = current) {
      if (!owns(owner) || !answer || !panel.contains(button)) return;
      const captured = answer;
      button.disabled = true;
      try {
        await options2.copy(captured);
        if (!owns(owner) || !panel.contains(button)) return;
        button.textContent = "Copied";
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (owns(owner) && panel.contains(button)) button.textContent = "Copy";
        }, 1500);
      } catch {
        if (owns(owner) && panel.contains(button)) button.textContent = "Failed";
      } finally {
        if (owns(owner) && panel.contains(button)) button.disabled = false;
      }
    }
    function dispose() {
      if (disposed) return;
      close();
      disposed = true;
    }
    return { show, resolve, fail, close, copy, owns, dispose };
  }

  // src/browser/prompt-delivery.ts
  function decodeQueueData(value) {
    const strings = (items) => Array.isArray(items) ? items.filter((item) => typeof item === "string") : [];
    return { steering: strings(record8(value) ? value.steering : null), followUp: strings(record8(value) ? value.followUp : null) };
  }
  function createPromptDelivery(options2) {
    const { document: document2, sessionState } = options2, pending = /* @__PURE__ */ new Map();
    const panel = document2.getElementById("queuePanel");
    let sequence = 0, generation = 0, disposed = false, events = new AbortController();
    let data = decodeQueueData(null);
    const rows = /* @__PURE__ */ new WeakMap(), cancelling = /* @__PURE__ */ new Set();
    function add(key, message3, element, id = nextId()) {
      if (!disposed) pending.set(id, { key, message: message3, element, status: "sending" });
      return id;
    }
    function nextId() {
      return `prompt-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    }
    function acknowledge(id, queued) {
      const entry = pending.get(id);
      if (entry && entry.status === "sending") entry.status = queued ? "queued" : "accepted";
    }
    function discard(id) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.element?.remove();
    }
    function consume(key, content) {
      const text17 = splitSessionRefContext(extractTextBlocks(content)).text;
      for (const [id, entry] of pending) {
        if (entry.key === key && entry.message === text17) {
          pending.delete(id);
          return true;
        }
      }
      return false;
    }
    function canCancelQueue() {
      const caps = sessionState.currentSession?.capabilities;
      return !record8(caps) || caps.queueCancel !== false;
    }
    function owns(row) {
      return !disposed && row.generation === generation && sessionState.ownsSelection(row.owner) && options2.endpoint(row.owner.host).base === row.endpoint.base;
    }
    function render(value) {
      if (disposed) return;
      data = decodeQueueData(value);
      generation++;
      events.abort();
      events = new AbortController();
      panel.innerHTML = "";
      panel.style.display = "none";
      const owner = sessionState.captureSelection();
      if (!owner) return;
      const endpoint = Object.freeze({ ...options2.endpoint(owner.host) }), key = sessionRefKey(owner), associated = /* @__PURE__ */ new Set();
      const canCancel = canCancelQueue();
      for (const kind of ["steering", "followUp"]) data[kind].forEach((text17, index) => {
        const stripped = splitSessionRefContext(text17).text;
        let clientId = null;
        for (const [id, entry] of pending) {
          if (!associated.has(id) && entry.key === key && entry.status === "queued" && entry.message === stripped) {
            clientId = id;
            associated.add(id);
            break;
          }
        }
        const element = document2.createElement("div");
        element.className = "queue-item";
        element.dataset.kind = kind;
        element.dataset.index = String(index);
        if (clientId) element.dataset.clientPromptId = clientId;
        element.innerHTML = `<span class="queue-item-kind">${kind === "steering" ? "steer" : "follow-up"}</span><span class="queue-item-text" title="Click to expand">${escapeHtml(stripped)}</span>${canCancel ? '<button class="queue-item-edit" title="Remove from queue and edit">\u21A9 Edit</button>' : ""}`;
        const row = Object.freeze({ owner, endpoint, generation, kind, index, text: text17, clientId });
        rows.set(element, row);
        const label = element.querySelector(".queue-item-text");
        label.addEventListener("click", () => {
          if (owns(row)) label.classList.toggle("expanded");
        }, { signal: events.signal });
        const button = element.querySelector(".queue-item-edit");
        button?.addEventListener("click", () => {
          void edit(button);
        }, { signal: events.signal });
        panel.append(element);
      });
      if (panel.childElementCount) panel.style.display = "";
    }
    async function edit(button) {
      const element = button.closest(".queue-item"), row = element && rows.get(element);
      if (!row || !owns(row) || !panel.contains(button) || cancelling.has(row) || !row.text || !canCancelQueue()) return;
      cancelling.add(row);
      const prompt = row.clientId ? pending.get(row.clientId) : void 0, previous = prompt?.status;
      if (prompt) prompt.status = "cancelling";
      if (button instanceof HTMLButtonElement) button.disabled = true;
      try {
        await sendJson(options2.request, Object.freeze({ ...options2.endpoint(row.owner.host) }), `/api/sessions/${encodeURIComponent(row.owner.id)}/queue/cancel`, { kind: row.kind, index: row.index, text: row.text });
        if (disposed) return;
        if (row.clientId) discard(row.clientId);
        options2.restore(sessionRefKey(row.owner), splitSessionRefContext(row.text).text);
      } catch (error) {
        if (disposed) return;
        if (prompt && row.clientId && pending.get(row.clientId) === prompt && previous) prompt.status = previous;
        if (sessionState.ownsSelection(row.owner) && options2.endpoint(row.owner.host).base === row.endpoint.base) {
          render(data);
          options2.status(error instanceof Error ? error.message : String(error), "error");
        }
      } finally {
        cancelling.delete(row);
        if (owns(row) && button instanceof HTMLButtonElement) button.disabled = false;
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      events.abort();
      pending.clear();
      cancelling.clear();
    }
    return { add, nextId, acknowledge, discard, consume, render, edit, dispose, has: (id) => pending.has(id), get queue() {
      return data;
    } };
  }

  // src/browser/composer-submit.ts
  function createComposerSubmit(options2) {
    const { document: document2, sessionState, delivery, drafts: composerDrafts, activity: sessionActivity, btw: btwPanel } = options2;
    let disposed = false, feedbackSequence = 0;
    async function send(endpoint, path, body) {
      const value = await sendJson(options2.request, endpoint, path, body), data = record8(value) ? value : {};
      return { info: typeof data.info === "string" ? data.info : "", answer: typeof data.answer === "string" ? data.answer : "", result: { queued: record8(data.result) && data.result.queued === true } };
    }
    async function sendPrompt() {
      const input = document2.getElementById("promptInput");
      if (disposed) return;
      const message3 = input.value.trim();
      if (options2.spawnId()) {
        if (message3 || composerDrafts.images.current().length) {
          const starting = options2.spawnPending();
          options2.status(starting ? "Pi is still starting \u2014 your prompt is saved" : "Pi did not start \u2014 your prompt is preserved", starting ? "working" : "error");
        }
        return;
      }
      if (!message3 && !composerDrafts.images.current().length || !sessionState.currentSession) return;
      const owner = sessionState.captureSelection();
      if (!owner || disposed) return;
      const endpoint = Object.freeze({ ...options2.endpoint(owner.host) }), sequence = ++feedbackSequence;
      const owns = () => !disposed && sequence === feedbackSequence && sessionState.ownsSelection(owner) && options2.endpoint(owner.host).base === endpoint.base;
      const { id: sessionId } = owner;
      const ownerKey = sessionRefKey(owner);
      if (sessionActivity.isAborting(ownerKey)) {
        options2.status("Wait for the current turn to finish stopping", "working");
        return;
      }
      if (message3 === "/tree") {
        input.value = "";
        options2.openTree();
        return;
      }
      options2.hideAutocomplete();
      if (message3.startsWith("/")) {
        if (sessionActivity.compacting && /^\/compact(\s|$)/.test(message3)) {
          options2.status("Compaction already in progress", "error");
          return;
        }
        input.value = "";
        input.style.height = "";
        composerDrafts.record(message3, ownerKey);
        composerDrafts.clearDraft(ownerKey);
        options2.status("Running " + message3.split(" ")[0] + "...", "working");
        const btwQuestion = message3.match(/^\/btw\s+([\s\S]*)$/)?.[1]?.trim();
        const btwOwner = btwQuestion ? btwPanel.show(btwQuestion) : null;
        try {
          const data = await send(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/command`, { message: message3 });
          if (disposed || !sessionState.ownsSelection(owner) || options2.endpoint(owner.host).base !== endpoint.base) return;
          if (btwQuestion) {
            if (typeof data.answer === "string" && data.answer) btwPanel.resolve(data.answer, btwOwner);
            else btwPanel.fail("(no answer)", btwOwner);
          }
          if (owns()) options2.status(data.info || "Done");
          options2.refresh();
        } catch (error) {
          if (disposed) return;
          const e = { message: error instanceof Error ? error.message : String(error) };
          composerDrafts.restorePayload(ownerKey, message3, null);
          if (btwQuestion && options2.endpoint(owner.host).base === endpoint.base) btwPanel.fail(e.message, btwOwner);
          if (owns()) {
            options2.status(`${message3.split(" ")[0]}: ${e.message}`, "error");
          }
        }
        return;
      }
      input.value = "";
      input.style.height = "";
      composerDrafts.record(message3, ownerKey);
      composerDrafts.clearDraft(ownerKey);
      const images = composerDrafts.images.take();
      const refs = options2.refs(message3);
      options2.status("Sending...", "working");
      const container = document2.getElementById("messages");
      const emptyState = container.querySelector(".empty-state");
      if (emptyState) emptyState.remove();
      const optimisticContent = [];
      if (message3) optimisticContent.push({ type: "text", text: message3 });
      for (const img of images || []) optimisticContent.push({ type: "image", data: img.data, mimeType: img.mimeType });
      const clientPromptId = delivery.nextId();
      const template = document2.createElement("template");
      template.innerHTML = options2.renderUser({
        role: "user",
        content: optimisticContent,
        timestamp: Date.now(),
        sessionRefs: refs
      }, formatTime(Date.now()), ` data-client-prompt-id="${clientPromptId}"`);
      const optimisticElement = template.content.firstElementChild;
      if (optimisticElement) container.appendChild(optimisticElement);
      delivery.add(ownerKey, message3, optimisticElement, clientPromptId);
      options2.follow();
      options2.scroll(container);
      sessionActivity.setTurn(true);
      try {
        const body = images ? { message: message3, images } : { message: message3 };
        if (refs.length) body.refs = refs;
        const resp = await send(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/prompt`, body);
        if (!disposed) delivery.acknowledge(clientPromptId, !!resp.result?.queued);
        if (!owns()) return;
        if (resp?.result?.queued) {
          sessionActivity.setCompacting(true);
          sessionActivity.setTurn(false);
          options2.status("Queued \u2014 will send when compaction finishes", "working");
          delivery.render(delivery.queue);
        } else {
          options2.status("Waiting for response...", "working");
        }
      } catch (error) {
        if (disposed) return;
        const e = { message: error instanceof Error ? error.message : String(error) };
        delivery.discard(clientPromptId);
        composerDrafts.restorePayload(ownerKey, message3, images);
        if (owns()) {
          options2.status(`Error: ${e.message}`, "error");
          sessionActivity.setTurn(false);
        }
      }
    }
    async function sendQueuedMessage(kind) {
      const steer = kind === "steer";
      const input = document2.getElementById("promptInput");
      if (disposed) return;
      const message3 = input.value.trim();
      if (options2.spawnId()) {
        if (message3 || composerDrafts.images.current().length) {
          const starting = options2.spawnPending();
          options2.status(starting ? "Pi is still starting \u2014 your prompt is saved" : "Pi did not start \u2014 your prompt is preserved", starting ? "working" : "error");
        }
        return;
      }
      if (!message3 && !composerDrafts.images.current().length || !sessionState.currentSession || !sessionState.currentSession.isActive) return;
      const owner = sessionState.captureSelection();
      if (!owner || disposed) return;
      const endpoint = Object.freeze({ ...options2.endpoint(owner.host) }), sequence = ++feedbackSequence;
      const owns = () => !disposed && sequence === feedbackSequence && sessionState.ownsSelection(owner) && options2.endpoint(owner.host).base === endpoint.base;
      const { id: sessionId } = owner;
      const ownerKey = sessionRefKey(owner);
      if (sessionActivity.isAborting(ownerKey)) {
        options2.status("Wait for the current turn to finish stopping", "working");
        return;
      }
      input.value = "";
      input.style.height = "";
      composerDrafts.record(message3, ownerKey);
      composerDrafts.clearDraft(ownerKey);
      const images = composerDrafts.images.take();
      options2.status(steer ? "Steering..." : "Queueing follow-up...", "working");
      const body = steer ? { message: message3 } : { message: message3, deliverAs: "followUp" };
      if (images) body.images = images;
      const refs = options2.refs(message3);
      if (refs.length) body.refs = refs;
      try {
        const resp = await send(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}${steer ? "/steer" : "/prompt"}`, body);
        if (!owns()) return;
        if (resp?.result?.queued) options2.status("Queued \u2014 will send when compaction finishes");
        else options2.status(steer ? "Steered" : "Queued for after this turn");
      } catch (error) {
        if (disposed) return;
        const e = { message: error instanceof Error ? error.message : String(error) };
        composerDrafts.restorePayload(ownerKey, message3, images);
        if (owns()) {
          options2.status(`${steer ? "Steer" : "Follow-up"} failed: ${e.message}`, "error");
        }
      }
    }
    function sendSteer() {
      return sendQueuedMessage("steer");
    }
    function sendFollowUp() {
      return sendQueuedMessage("followUp");
    }
    async function abortTurn() {
      if (disposed) return;
      if (!sessionState.currentSession || !sessionActivity.turn && !sessionActivity.compacting) return;
      const owner = sessionState.captureSelection();
      if (!owner || disposed) return;
      const endpoint = Object.freeze({ ...options2.endpoint(owner.host) }), sequence = ++feedbackSequence;
      const owns = () => !disposed && sequence === feedbackSequence && sessionState.ownsSelection(owner) && options2.endpoint(owner.host).base === endpoint.base;
      const { id: sessionId } = owner;
      const ownerKey = sessionRefKey(owner);
      if (sessionActivity.isAborting(ownerKey)) return;
      const abortOwner = sessionActivity.beginAbort(ownerKey);
      if (!abortOwner) return;
      options2.status("Stopping...", "working");
      try {
        await send(endpoint, "/api/sessions/" + encodeURIComponent(sessionId) + "/abort");
      } catch (error) {
        if (disposed) return;
        const e = { message: error instanceof Error ? error.message : String(error) };
        sessionActivity.endAbort(ownerKey, abortOwner);
        if (owns()) options2.status("Stop failed: " + e.message, "error");
      }
    }
    return { sendPrompt, sendQueuedMessage, sendSteer, sendFollowUp, abortTurn, dispose() {
      disposed = true;
      feedbackSequence++;
    } };
  }

  // src/browser/message-stream.ts
  function parseRecord(text17) {
    const value = JSON.parse(text17);
    return record8(value) ? value : {};
  }
  function createMessageStream(options2) {
    const { document: document2, sessionState, renderer, tools } = options2;
    let source = null, reconnect = null, connectionGeneration = 0, disposed = false;
    function ownsConnection(owner, target, generation) {
      return !disposed && generation === connectionGeneration && sessionState.ownsSelection(owner) && options2.endpoint(owner.host).base === target.base;
    }
    function stop() {
      connectionGeneration++;
      if (reconnect) clearTimeout(reconnect);
      reconnect = null;
      source?.close();
      source = null;
    }
    async function start(owner = sessionState.captureSelection()) {
      if (disposed || !owner || !sessionState.ownsSelection(owner)) return;
      stop();
      const generation = connectionGeneration, target = Object.freeze({ ...options2.endpoint(owner.host) });
      const path = `/api/sessions/${encodeURIComponent(owner.id)}/stream`;
      if (!target.token) {
        open(target.base + path, owner, target, generation);
        return;
      }
      try {
        const ticket = await options2.ticket(target);
        if (!ownsConnection(owner, target, generation)) return;
        open(`${target.base}${path}?ticket=${encodeURIComponent(ticket)}`, owner, target, generation);
      } catch {
        if (ownsConnection(owner, target, generation)) options2.status("Stream failed", "error");
      }
    }
    function open(url, owner, target, generation) {
      if (!ownsConnection(owner, target, generation)) return;
      const { id: sessionId, host: hostId } = owner;
      try {
        const evtSource = (options2.source || ((url2) => new EventSource(url2)))(url);
        source = evtSource;
        const ownsStream = () => source === evtSource && ownsConnection(owner, target, generation);
        const addOwnedListener = (event, listener) => evtSource.addEventListener(event, (event2) => {
          if (ownsStream() && event2 instanceof MessageEvent && typeof event2.data === "string") listener(event2);
        });
        let switchSequence = 0;
        let turnCleanupDone = false;
        const seenMessageEnds = /* @__PURE__ */ new Set();
        const messageEndKey = (m) => JSON.stringify(m.role === "custom" ? [m.role, m.timestamp ?? null, m.content ?? null, m.errorMessage ?? null, m.customType ?? null, m.details ?? null] : [m.role, m.timestamp ?? null, m.content ?? null]);
        evtSource.onopen = () => {
          if (ownsStream()) options2.status("");
        };
        addOwnedListener("init", (e) => {
          try {
            const data = parseRecord(e.data);
            turnCleanupDone = !data.turnInProgress;
            if (!data.turnInProgress) options2.activity.endAbort(sessionKey(hostId, sessionId));
            options2.activity.setCompacting(!!data.compacting);
            options2.activity.setTurn(!!data.turnInProgress);
            if (data.compacting) options2.status("Compacting context...", "working");
            else if (data.turnInProgress) options2.status("Waiting for response...", "working");
            if (!data.turnInProgress) {
              options2.catchup(owner);
            }
          } catch {
          }
        });
        addOwnedListener("stream_error", (e) => {
          try {
            const data = parseRecord(e.data || "{}");
            options2.status(typeof data.error === "string" && data.error || "Stream error", "error");
          } catch {
            options2.status("Stream error", "error");
          }
          stop();
        });
        addOwnedListener("turn_start", () => {
          seenMessageEnds.clear();
          turnCleanupDone = false;
          options2.activity.setTurn(true);
        });
        const handleTurnEnd = () => {
          if (turnCleanupDone || !ownsStream()) return;
          turnCleanupDone = true;
          options2.activity.endAbort(sessionKey(hostId, sessionId));
          options2.activity.setTurn(false);
          options2.streaming.cancel();
          tools.finishRunning();
          options2.catchup(owner);
          options2.refresh();
          options2.artifacts(owner);
          options2.status("");
        };
        addOwnedListener("turn_end", handleTurnEnd);
        addOwnedListener("agent_end", handleTurnEnd);
        addOwnedListener("message_update", (e) => {
          try {
            const message3 = decodeRenderMessage(parseRecord(e.data).message);
            if (!message3) return;
            if (message3.role === "custom") {
              renderer.upsertCustom(message3, { streaming: true });
              return;
            }
            if (message3.role !== "assistant") return;
            if (seenMessageEnds.size && seenMessageEnds.has(messageEndKey(message3))) return;
            if (turnCleanupDone) seenMessageEnds.clear();
            turnCleanupDone = false;
            if (!options2.activity.turn) options2.activity.setTurn(true);
            options2.streaming.queue(message3);
          } catch (err) {
          }
        });
        addOwnedListener("message_end", (e) => {
          try {
            const message3 = decodeRenderMessage(parseRecord(e.data).message);
            if (!message3) return;
            const container = document2.getElementById("messages");
            if (!container) return;
            const messageKey = messageEndKey(message3);
            if (seenMessageEnds.has(messageKey)) return;
            seenMessageEnds.add(messageKey);
            if (message3.role === "user") {
              if (options2.delivery.consume(sessionKey(hostId, sessionId), message3.content)) {
                return;
              }
              const wasPinned2 = options2.pinned(container);
              const streaming2 = container.querySelector('.message.assistant[data-streaming="true"]');
              const tmp2 = document2.createElement("template");
              tmp2.innerHTML = renderer.user(message3, formatTime(message3.timestamp || Date.now()));
              const el = tmp2.content.firstElementChild;
              if (!el) return;
              if (streaming2) streaming2.before(el);
              else container.appendChild(el);
              if (wasPinned2 || options2.follow()) options2.scroll(container);
              else options2.jump(container);
              return;
            }
            if (message3.role === "custom") {
              renderer.upsertCustom(message3);
              return;
            }
            if (message3.role !== "assistant") return;
            options2.streaming.cancel();
            if (Array.isArray(message3.content) && message3.content.length === 0 && !message3.errorMessage) {
              container.querySelectorAll('.message.assistant[data-streaming="true"]').forEach((el) => el.remove());
              return;
            }
            const wasPinned = options2.pinned(container);
            const streaming = container.querySelectorAll('.message.assistant[data-streaming="true"]');
            const tmp = document2.createElement("template");
            tmp.innerHTML = renderer.assistant(message3, formatTime(message3.timestamp || Date.now()));
            const finalEl = tmp.content.firstElementChild;
            if (!finalEl) return;
            if (streaming.length) streaming[streaming.length - 1].before(finalEl);
            else container.appendChild(finalEl);
            streaming.forEach((el) => el.remove());
            options2.highlight(finalEl);
            if (wasPinned) options2.scroll(container);
            else options2.jump(container);
          } catch (err) {
          }
        });
        addOwnedListener("tool_execution_start", (e) => {
          try {
            const data = parseRecord(e.data);
            tools.append(data);
          } catch (err) {
            console.error("tool_execution_start error:", err);
          }
        });
        addOwnedListener("tool_execution_update", (e) => {
          try {
            const data = parseRecord(e.data);
            tools.update(data);
          } catch (err) {
            console.error("tool_execution_update error:", err);
          }
        });
        addOwnedListener("tool_execution_end", (e) => {
          try {
            const data = parseRecord(e.data);
            tools.finish(data);
          } catch (err) {
            console.error("tool_execution_end error:", err);
          }
        });
        addOwnedListener("extension_ui_request", (e) => {
          try {
            options2.extensionUI.handle(JSON.parse(e.data), { id: sessionId, host: hostId });
          } catch (err) {
            console.error("extension_ui_request error:", err);
          }
        });
        addOwnedListener("queue_update", (e) => {
          try {
            options2.delivery.render(JSON.parse(e.data));
          } catch {
          }
        });
        addOwnedListener("extension_ui_resolved", (e) => {
          try {
            options2.extensionUI.resolve(parseRecord(e.data).id, { id: sessionId, host: hostId });
          } catch {
          }
        });
        addOwnedListener("extension_ui_state", (e) => {
          try {
            options2.extensionUI.reconcile(JSON.parse(e.data), { id: sessionId, host: hostId });
          } catch {
          }
        });
        addOwnedListener("compaction_start", () => {
          options2.status("Compacting context...", "working");
          options2.activity.setCompacting(true);
        });
        addOwnedListener("compaction_end", (e) => {
          options2.activity.setCompacting(false);
          if (!options2.activity.turn) options2.activity.endAbort(sessionKey(hostId, sessionId));
          try {
            const data = parseRecord(e.data);
            if (data.errorMessage) {
              options2.status("Compaction failed: " + data.errorMessage, "error");
              return;
            }
            if (data.aborted) {
              options2.status("Compaction cancelled");
              return;
            }
            const r = record8(data.result) ? data.result : null;
            let msg = "Compaction finished";
            if (r && typeof r.tokensBefore === "number" && Number.isFinite(r.tokensBefore) && r.tokensBefore) {
              msg = typeof r.estimatedTokensAfter === "number" && Number.isFinite(r.estimatedTokensAfter) ? `Compacted: ${formatTokens(r.tokensBefore)} \u2192 ~${formatTokens(r.estimatedTokensAfter)} tokens` : `Compacted (was ${formatTokens(r.tokensBefore)} tokens)`;
            }
            options2.status(msg);
            options2.refresh();
          } catch {
            options2.status("Compaction finished");
          }
        });
        addOwnedListener("session_tree", () => {
          if (sessionState.currentSession && sessionState.currentSession.id === sessionId) {
            options2.select(sessionId, { forceTranscriptReload: true, host: hostId });
          }
        });
        addOwnedListener("session_switch", (e) => {
          let data;
          try {
            data = JSON.parse(e.data);
          } catch {
            return;
          }
          const nextId = record8(data) && typeof data.sessionId === "string" ? data.sessionId : "";
          const switchOwner = ++switchSequence;
          if (!nextId || nextId === sessionId) return;
          options2.deleteCached(sessionKey(hostId, nextId));
          void options2.loadSessions(void 0, { withPrevious: true }).then(() => {
            if (!ownsStream() || switchOwner !== switchSequence || !sessionState.findSession(nextId, hostId)) return;
            options2.select(nextId, { forceTranscriptReload: true, host: hostId });
          });
        });
        addOwnedListener("auto_retry_start", (e) => {
          try {
            const d = parseRecord(e.data);
            options2.status(`Retrying (attempt ${d.attempt}/${d.maxAttempts})...`, "working");
          } catch {
          }
        });
        addOwnedListener("auto_retry_end", (e) => {
          try {
            const d = parseRecord(e.data);
            if (d.success === false) options2.status("Retry failed: " + (d.finalError || "unknown"), "error");
          } catch {
          }
        });
        addOwnedListener("session_ended", () => {
          options2.activity.endAbort(sessionKey(hostId, sessionId));
          options2.activity.setCompacting(false);
          options2.activity.setTurn(false);
          options2.extensionUI.end({ id: sessionId, host: hostId });
          options2.status("Session ended");
          options2.refresh();
        });
        evtSource.onerror = () => {
          if (!ownsStream()) return;
          if (evtSource.readyState === EventSource.CLOSED) {
            options2.status("Stream disconnected", "error");
            if (reconnect) clearTimeout(reconnect);
            reconnect = setTimeout(() => {
              reconnect = null;
              if (ownsStream()) start(owner);
            }, 3e3);
          }
        };
      } catch (err) {
        if (!ownsConnection(owner, target, generation)) return;
        console.error("Stream failed:", err);
        options2.status("Stream failed", "error");
      }
    }
    return { start, stop, get source() {
      return source;
    }, dispose() {
      if (disposed) return;
      stop();
      disposed = true;
    } };
  }

  // src/browser/session-view.ts
  function createSessionView(options2) {
    const { document: document2, sessionState } = options2;
    const element = (id) => document2.getElementById(id);
    let currentSessionSpawnId = null, disposed = false;
    function pendingComposerKey(spawnId) {
      return `spawn:${spawnId}`;
    }
    function showPendingSessionView(spawnId) {
      if (disposed) return;
      const spawn = options2.spawn(spawnId);
      if (!spawn) return;
      const harnessLabel = spawn.harnessLabel || "Pi";
      sessionState.advanceSelection();
      options2.resetSearch();
      options2.transcript.retire();
      options2.drafts.stash();
      options2.cancelStreaming();
      options2.cancelRecording();
      options2.hideNote();
      options2.closeViews(true, false);
      options2.transcript.stash();
      sessionState.setCurrentSession(null);
      currentSessionSpawnId = spawnId;
      options2.stream.stop();
      options2.stopFollowing();
      options2.closeTerminal();
      options2.clearExtension();
      options2.clearRelations();
      options2.closeControls();
      options2.hideAutocomplete();
      options2.retireModels();
      options2.retireCommands();
      element("emptyState").style.display = "none";
      element("sessionView").style.display = "flex";
      document2.querySelector(".input-area").style.display = "";
      element("resumeBar").style.display = "none";
      document2.querySelector(".session-actions").style.display = "none";
      options2.queue(null);
      options2.closeBtw();
      options2.activity.setCompacting(false);
      options2.activity.setTurn(false);
      options2.resetArtifacts();
      const nameEl = element("sessionName");
      nameEl.textContent = "Starting session\u2026";
      nameEl.classList.remove("editable-name");
      nameEl.title = "";
      const modelBtn = element("sessionModel");
      modelBtn.textContent = `${harnessLabel} starting`;
      modelBtn.style.cursor = "default";
      const ctxReset = element("sessionContext");
      ctxReset.textContent = "0%";
      ctxReset.className = "tool-btn tool-ctx";
      options2.thinking();
      options2.terminal();
      options2.mic();
      options2.transcript.reset();
      options2.mood("", "");
      const targetLabel = spawn.target ? "tmux" : "the headless session";
      element("messages").innerHTML = `<div class="empty-state pending-session-state" style="padding: 48px;">
    <p>Starting ${escapeHtml(harnessLabel)} in ${targetLabel}\u2026</p>
    <small>You can write your prompt while it starts.</small>
  </div>`;
      options2.drafts.restore(pendingComposerKey(spawnId));
      options2.drafts.waiting(true);
      options2.status(`${harnessLabel} is starting \u2014 your draft will be ready when it connects`, "working");
      options2.render();
      element("promptInput").focus();
    }
    function showPendingSessionFailure(spawnId, message3, spawn) {
      if (disposed || currentSessionSpawnId !== spawnId) return;
      const harnessLabel = spawn?.harnessLabel || "Agent";
      element("sessionName").textContent = "Session failed to start";
      element("messages").innerHTML = `<div class="empty-state pending-session-state" style="padding: 48px;">
    <p>${escapeHtml(harnessLabel)} could not start.</p>
    <small>${escapeHtml(message3)}</small>
  </div>`;
      const input = element("promptInput");
      input.placeholder = "Your draft is preserved here so you can copy it";
      const btn = element("btnSend");
      btn.disabled = true;
      btn.title = message3;
    }
    async function selectSession(id, { forceTranscriptReload = false, host = null, keepBounceView = false } = {}) {
      if (disposed || !sessionState.findSession(id, host)) return;
      sessionState.advanceSelection();
      options2.resetSearch();
      options2.transcript.retire();
      options2.drafts.stash();
      currentSessionSpawnId = null;
      options2.drafts.waiting(false);
      options2.cancelStreaming();
      options2.cancelRecording();
      options2.hideNote();
      options2.closeViews(false, keepBounceView);
      options2.transcript.stash();
      const current = sessionState.setCurrentSession(id, host);
      if (!current) return;
      const owner = sessionState.captureSelection();
      if (!owner) return;
      const endpoint = Object.freeze({ ...options2.endpoint(owner.host) });
      const owns = () => !disposed && sessionState.ownsSelection(owner) && options2.endpoint(owner.host).base === endpoint.base;
      if (forceTranscriptReload) options2.transcript.deleteCached(sessionRefKey(current));
      const mathAssetsReady = options2.math().catch(() => {
      });
      options2.reveal(id, current.host);
      options2.stream.stop();
      options2.stopFollowing();
      options2.closeTerminal();
      options2.clearExtension();
      options2.clearRelations();
      options2.storage.setItem("pi-dish-session", sessionRefKey(current));
      options2.seen(current);
      element("emptyState").style.display = "none";
      element("sessionView").style.display = "flex";
      const inputArea = document2.querySelector(".input-area");
      const resumeBar = element("resumeBar");
      const sessionActions = document2.querySelector(".session-actions");
      options2.closeControls();
      if (current.isActive) {
        if (inputArea) inputArea.style.display = "";
        if (resumeBar) resumeBar.style.display = "none";
        options2.resume.reset();
        options2.drafts.restore();
      } else {
        options2.drafts.clear();
        if (inputArea) inputArea.style.display = "none";
        const caps = current.capabilities, resumable = !record8(caps) || caps.resume !== false;
        if (resumeBar) {
          resumeBar.style.display = "";
          const cwdSpan = resumeBar.querySelector(".resume-cwd");
          if (cwdSpan) cwdSpan.textContent = typeof current.cwd === "string" && current.cwd || "~";
          const label = resumeBar.querySelector(".resume-label");
          if (label) {
            label.textContent = resumable ? "Read-only \u2014 session is inactive" : "Read-only \u2014 a live session owns this transcript";
          }
          const resumeBtn = resumeBar.querySelector("#resumeSessionBtn");
          if (resumeBtn) resumeBtn.style.display = resumable ? "" : "none";
        }
        if (resumable) options2.resume.load(current);
        else options2.resume.reset();
      }
      if (sessionActions) sessionActions.style.display = current.isActive ? "" : "none";
      options2.queue(null);
      options2.closeBtw();
      options2.activity.setCompacting(!!current.isActive && !!current.compacting);
      options2.activity.setTurn(!!current.isActive && !!current.turnInProgress);
      options2.resetArtifacts();
      options2.artifacts(owner);
      options2.render();
      options2.header();
      options2.relations(owner);
      if (current.isActive) {
        options2.models(id, typeof current.harnessId === "string" ? current.harnessId : void 0);
        options2.commands(id);
      }
      await mathAssetsReady;
      if (!owns()) return;
      await options2.transcript.load(owner);
      if (!owns()) return;
      if (sessionState.currentSession?.isActive) {
        options2.stream.start(owner);
      } else {
        options2.stream.stop();
      }
    }
    return { select: selectSession, pending: showPendingSessionView, failure: showPendingSessionFailure, get spawnId() {
      return currentSessionSpawnId;
    }, dispose() {
      if (disposed) return;
      disposed = true;
      options2.stream.stop();
      options2.transcript.retire();
      options2.resume.dispose();
    } };
  }

  // src/browser/session-resume.ts
  function createSessionResume(options2) {
    const { document: document2, sessionState } = options2, api = createSessionApi(options2.request);
    const wrap = document2.getElementById("resumeModelWrap"), select = document2.getElementById("resumeModelSelect");
    let sequence = 0, disposed = false;
    const pending = /* @__PURE__ */ new Map();
    function reset() {
      sequence++;
      if (wrap) wrap.style.display = "none";
      if (select) {
        select.disabled = true;
        select.innerHTML = '<option value="">Session model</option>';
      }
    }
    async function load(session) {
      if (disposed) return;
      reset();
      const owner = sessionState.captureSelection();
      if (!session || session.harnessId !== "omp" || !owner || owner.id !== session.id || owner.host !== (session.host || null) || !wrap || !select) return;
      const generation = sequence, endpoint = Object.freeze({ ...options2.endpoint(owner.host) });
      const owns = () => !disposed && generation === sequence && sessionState.ownsSelection(owner) && options2.endpoint(owner.host).base === endpoint.base;
      wrap.style.display = "flex";
      select.title = "Loading Oh My Pi models\u2026";
      try {
        const models = await api.models(endpoint, { harnessId: "omp", cwd: typeof session.cwd === "string" ? session.cwd : void 0 });
        if (!owns()) return;
        const current = typeof session.model === "string" && session.model !== "unknown" && session.model ? ` (${session.model})` : "";
        select.innerHTML = `<option value="">Session model${escapeHtml(current)}</option>` + models.map((model) => {
          const name = model.selector || `${model.provider}/${model.id}`;
          return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
        }).join("");
        select.disabled = false;
        select.title = "Optionally override the model while resuming this OMP session";
      } catch (error) {
        if (owns()) {
          select.disabled = true;
          select.title = `Could not load Oh My Pi models: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }
    async function resume() {
      const owner = sessionState.captureSelection();
      if (disposed || !owner) return;
      const caps = sessionState.currentSession?.capabilities;
      if (record8(caps) && caps.resume === false) return;
      const key = sessionRefKey(owner);
      if (pending.has(key)) return;
      const token = /* @__PURE__ */ Symbol(), endpoint = Object.freeze({ ...options2.endpoint(owner.host) }), target = options2.target(owner.host);
      const model = sessionState.currentSession?.harnessId === "omp" ? select?.value || void 0 : void 0;
      const owns = () => !disposed && pending.get(key) === token && sessionState.ownsSelection(owner) && options2.endpoint(owner.host).base === endpoint.base;
      pending.set(key, token);
      options2.status(target ? "Resuming in tmux\u2026" : "Resuming session...", "working");
      try {
        const data = await sendJson(options2.request, endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/resume`, { ...target ? { target: { ...target } } : {}, ...model ? { model } : {} });
        if (disposed) return;
        if (!record8(data) || typeof data.id !== "string" || !data.id) throw new Error("Resume returned an invalid session");
        await options2.refresh();
        if (!owns()) return;
        options2.status("Session resumed");
        options2.select(data.id, { host: owner.host });
      } catch (error) {
        if (owns()) options2.status("Resume failed: " + (error instanceof Error ? error.message : String(error)), "error");
      } finally {
        if (pending.get(key) === token) pending.delete(key);
      }
    }
    return { reset, load, resume, dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      pending.clear();
    } };
  }

  // src/browser/session-header.ts
  function string2(value) {
    return typeof value === "string" ? value : "";
  }
  function number8(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  function supports(session, capability) {
    const caps = session.capabilities;
    return !record8(caps) || caps[capability] !== false;
  }
  function createSessionHeader(options2) {
    const { document: document2, sessionState } = options2;
    let disposed = false;
    const element = (id) => document2.getElementById(id);
    function setModelChipLabel(btn, model, suffix) {
      const full = String(model || "");
      btn.title = full ? `${full} \u2014 change model` : "Change model";
      btn.textContent = full + suffix;
      if (btn.clientWidth && btn.scrollWidth > btn.clientWidth) {
        const short = shortModelName(full);
        if (short !== full) btn.textContent = short + suffix;
      }
    }
    function updateSessionHeader() {
      if (disposed || !sessionState.currentSession) return;
      const raw = sessionState.currentSession, current = {
        ...raw,
        name: string2(raw.name),
        model: string2(raw.model),
        cwd: string2(raw.cwd),
        harnessId: string2(raw.harnessId),
        harnessLabel: string2(raw.harnessLabel),
        contextPercent: number8(raw.contextPercent),
        contextTokens: number8(raw.contextTokens),
        isActive: !!raw.isActive
      };
      element("sessionName").textContent = current.name || "Unnamed";
      const hostEl = element("sessionHost");
      if (hostEl) {
        const showHost = options2.multi() && !!options2.host(current.host);
        hostEl.style.display = showHost ? "" : "none";
        hostEl.className = "badge host-badge" + (options2.down(current.host) ? " offline" : "");
        hostEl.style.setProperty("--host-color", showHost ? options2.color(current.host) : "");
        hostEl.textContent = showHost ? options2.label(current.host) : "";
      }
      const harnessEl = element("sessionHarness");
      const showHarness = current.harnessId && current.harnessId !== "pi";
      harnessEl.style.display = showHarness ? "" : "none";
      if (showHarness) {
        const info = harnessBadgeInfo(current.harnessId, current.harnessLabel);
        const title = current.harnessLabel || info.label;
        options2.ensureHarness(current.host || null);
        const configurable = options2.settings(raw);
        harnessEl.className = `badge harness-badge harness-badge-${current.harnessId}` + (configurable ? " clickable" : "");
        harnessEl.title = configurable ? `${title} settings: agents and models` : `${title} harness`;
        harnessEl.setAttribute("aria-label", configurable ? `${title} settings` : `${title} harness`);
        if (configurable) harnessEl.setAttribute("role", "button");
        else harnessEl.removeAttribute("role");
        harnessEl.innerHTML = harnessBadgeInnerHtml(info);
      } else {
        harnessEl.textContent = "";
      }
      const cpTree = element("cpTreeRow");
      if (cpTree) cpTree.style.display = supports(raw, "tree") ? "" : "none";
      const cpHarness = element("cpHarnessRow");
      if (cpHarness) cpHarness.style.display = options2.settings(raw) ? "" : "none";
      element("btnExport").style.display = supports(raw, "export") ? "" : "none";
      const nameEl = element("sessionName");
      const canRename = current.isActive && supports(raw, "rename");
      nameEl.classList.toggle("editable-name", canRename);
      nameEl.title = canRename ? "Click to rename" : "";
      const modelBtn = element("sessionModel");
      const canSetModel = current.isActive && supports(raw, "setModel");
      setModelChipLabel(modelBtn, current.model, canSetModel ? " \u25BE" : "");
      modelBtn.style.cursor = canSetModel ? "pointer" : "default";
      const ctxClass = contextClass(current.contextPercent);
      const contextEl = element("sessionContext");
      contextEl.textContent = `${current.contextPercent}%`;
      contextEl.className = "tool-btn tool-ctx" + (ctxClass ? " " + ctxClass : "");
      contextEl.title = current.contextTokens ? `Session stats \u2014 ${formatTokens(current.contextTokens)} tokens of context` : "Session stats";
      options2.thinking();
      options2.terminal();
      options2.mic();
      const cwdChip = element("sessionCwdChip");
      if (cwdChip) {
        const cwd = current.cwd || "";
        cwdChip.style.display = cwd ? "" : "none";
        cwdChip.textContent = cwd ? cwd.split("/").filter(Boolean).pop() || cwd : "";
        cwdChip.title = cwd ? `${cwd} \u2014 session stats` : "Session stats";
      }
    }
    return { update: updateSessionHeader, label: setModelChipLabel, dispose() {
      disposed = true;
    } };
  }

  // src/browser/host-view.ts
  function createHostView() {
    const cache = /* @__PURE__ */ new WeakMap();
    return (host) => {
      const prior = cache.get(host);
      if (prior) return prior;
      const raw = host.capabilities, capabilities = raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw).filter((entry) => typeof entry[1] === "boolean")) : void 0;
      const value = Object.freeze({ ...host, label: host.label ? String(host.label) : void 0, capabilities });
      cache.set(host, value);
      return value;
    };
  }

  // src/browser/app-chrome.ts
  function createAppChrome(options2) {
    const { document: document2, storage } = options2, messages = document2.getElementById("messages");
    const lifetime = new AbortController();
    let panelEvents = new AbortController();
    let following = false, focus = false, panelOpen = false, mounted = false, disposed = false, panelGeneration = 0;
    let panelTimer = null;
    function pinned(container) {
      return following || container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    }
    function scroll(container) {
      if (disposed) return;
      container.scrollTop = container.scrollHeight;
      jump(container);
    }
    function jump(container) {
      if (disposed) return;
      let button = document2.getElementById("jumpToBottom");
      if (pinned(container)) {
        if (button) button.style.display = "none";
        return;
      }
      if (!button) {
        button = document2.createElement("button");
        button.id = "jumpToBottom";
        button.className = "jump-to-bottom";
        button.textContent = "\u2193";
        button.title = "Jump to latest";
        button.addEventListener("click", () => {
          following = true;
          scroll(messages);
        }, { signal: lifetime.signal });
        (document2.getElementById("sessionView") || document2.body).append(button);
      }
      button.style.display = "";
    }
    function setFocus(on) {
      if (disposed) return;
      focus = !!on;
      storage.setItem("pi-dish-focus", focus ? "1" : "0");
      messages.classList.toggle("focus-mode", focus);
      for (const id of ["btnFocus", "btnFocusMobile"]) document2.getElementById(id)?.classList.toggle("active", focus);
      const state = document2.getElementById("focusModeState");
      if (state) state.textContent = focus ? "on" : "off";
    }
    function toggleFocus() {
      setFocus(!focus);
      if (pinned(messages)) scroll(messages);
    }
    function closePanel() {
      panelGeneration++;
      panelOpen = false;
      panelEvents.abort();
      if (panelTimer) clearTimeout(panelTimer);
      panelTimer = null;
      document2.getElementById("controlPanel")?.classList.remove("open");
      document2.getElementById("btnPanel")?.classList.remove("active");
    }
    function openPanel() {
      if (disposed) return;
      closePanel();
      panelOpen = true;
      const generation = panelGeneration;
      panelEvents = new AbortController();
      document2.getElementById("controlPanel")?.classList.add("open");
      document2.getElementById("btnPanel")?.classList.add("active");
      panelTimer = setTimeout(() => {
        panelTimer = null;
        if (disposed || !panelOpen || generation !== panelGeneration) return;
        document2.addEventListener("click", (event) => {
          if (disposed || !panelOpen || generation !== panelGeneration) return;
          const target = event.target instanceof Node ? event.target : null;
          const inside = !document2.body.contains(target) || ["controlPanel", "btnPanel", "modelDropdown", "thinkingDropdown"].some((id) => document2.getElementById(id)?.contains(target));
          if (!inside) closePanel();
        }, { signal: panelEvents.signal });
      }, 0);
    }
    function stopFollowing() {
      following = false;
    }
    function mount() {
      if (disposed || mounted) return;
      mounted = true;
      const { signal } = lifetime;
      messages.addEventListener("scroll", () => {
        jump(messages);
        options2.older(messages);
      }, { passive: true, signal });
      messages.addEventListener("wheel", (event) => {
        stopFollowing();
        if (event.deltaY < 0) options2.older(messages);
      }, { passive: true, signal });
      messages.addEventListener("touchmove", () => {
        stopFollowing();
        options2.older(messages);
      }, { passive: true, signal });
      messages.addEventListener("mousedown", stopFollowing, { passive: true, signal });
    }
    return {
      pinned,
      scroll,
      jump,
      setFocus,
      toggleFocus,
      closePanel,
      openPanel,
      togglePanel() {
        if (panelOpen) closePanel();
        else openPanel();
      },
      mount,
      follow() {
        if (!disposed) following = true;
      },
      stopFollowing,
      get following() {
        return following;
      },
      get focus() {
        return focus;
      },
      get panelOpen() {
        return panelOpen;
      },
      dispose() {
        if (disposed) return;
        closePanel();
        disposed = true;
        lifetime.abort();
      }
    };
  }

  // src/browser/app-bindings.ts
  var APP_ACTION_NAMES = [
    "openUsageView",
    "openSkillsView",
    "openRoutinesView",
    "openSettingsModal",
    "refreshSessions",
    "openNewSessionView",
    "openSessionHarnessSettings",
    "openStatsModal",
    "toggleSearchBar",
    "toggleControlPanel",
    "toggleTerminal",
    "toggleFocusMode",
    "toggleDiffView",
    "openArtifactsModal",
    "exportSession",
    "searchKey",
    "searchPrev",
    "searchNext",
    "closeSearch",
    "loadDiffView",
    "closeDiffView",
    "closeFileView",
    "switchTerminalMode",
    "restartTerminalShell",
    "closeTerminal",
    "resumeSession",
    "panelOpenSearch",
    "panelToggleTerminal",
    "panelOpenDiffView",
    "panelOpenArtifactsModal",
    "panelOpenTreeModal",
    "panelOpenSessionHarnessSettings",
    "panelExportSession",
    "attachImage",
    "abortTurn",
    "sendSteer",
    "sendFollowUp",
    "sendPrompt",
    "loadUsageView",
    "closeUsageView",
    "closeSearchView",
    "closeNewSessionView",
    "onNsHostChange",
    "onNsHarnessChange",
    "onNsModelChange",
    "onNsThinkingChange",
    "editHarnessAgents",
    "editHarnessModels",
    "spawnNewSession",
    "refreshRoutinesView",
    "closeRoutinesView",
    "loadRecoveryView",
    "closeRecoveryView",
    "backdropCloseTreeModal",
    "closeTreeModal",
    "backdropCloseArtifactsModal",
    "closeArtifactsModal",
    "backdropCloseRelationsModal",
    "closeRelationsModal",
    "backdropCloseStatsModal",
    "closeStatsModal",
    "backdropCloseSettingsModal",
    "closeSettingsModal",
    "bounceToggle",
    "refreshBounceView",
    "bounceSelect",
    "bounceClear",
    "submitBounceTargets",
    "backdropCloseHarnessSettings",
    "closeHarnessSettings",
    "harnessTabAgents",
    "harnessTabModels",
    "saveHarnessSettings",
    "backdropCloseResponseDetails",
    "closeResponseDetails"
  ];
  function createAppBindings(options2) {
    const lifetime = new AbortController();
    let disposed = false;
    for (const event of ["click", "change", "keydown", "toggle"]) {
      for (const node of Array.from(options2.document.querySelectorAll(`[data-app-${event}]`))) {
        const name = node.getAttribute(`data-app-${event}`);
        const action = APP_ACTION_NAMES.find((action2) => action2 === name);
        if (!action) throw new Error("Unknown app action: " + name);
        node.addEventListener(event, (value) => {
          if (!disposed && node.isConnected) options2.actions[action](value, node);
        }, { signal: lifetime.signal });
      }
    }
    return { dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
    } };
  }
  return __toCommonJS(index_exports);
})();
