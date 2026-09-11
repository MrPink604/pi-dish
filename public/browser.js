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
    ApiHttpError: () => ApiHttpError,
    HOST_BACKOFF_LADDER: () => HOST_BACKOFF_LADDER,
    HOST_BACKOFF_RESET_MS: () => HOST_BACKOFF_RESET_MS,
    HOST_COLOR_SLOTS: () => HOST_COLOR_SLOTS,
    NEW_SESSION_HARNESS_KEY: () => NEW_SESSION_HARNESS_KEY,
    NS_THINKING_LABELS: () => NS_THINKING_LABELS,
    assignHostColor: () => assignHostColor,
    createBounce: () => createBounce,
    createCwdAutocomplete: () => createCwdAutocomplete,
    createDirectoryCatalog: () => createDirectoryCatalog,
    createDirectoryTree: () => createDirectoryTree,
    createHarnessDiscovery: () => createHarnessDiscovery,
    createHarnessSettings: () => createHarnessSettings,
    createHostConnections: () => createHostConnections,
    createHostDirectory: () => createHostDirectory,
    createHostDiscovery: () => createHostDiscovery,
    createHostPresentation: () => createHostPresentation,
    createHostSessionLoader: () => createHostSessionLoader,
    createHostSettings: () => createHostSettings,
    createHostTransport: () => createHostTransport,
    createModelCatalog: () => createModelCatalog,
    createNewSession: () => createNewSession,
    createNewSessionConfigPreview: () => createNewSessionConfigPreview,
    createNewSessionPreferences: () => createNewSessionPreferences,
    createRecovery: () => createRecovery,
    createSearchView: () => createSearchView,
    createSessionApi: () => createSessionApi,
    createSessionRelations: () => createSessionRelations,
    createSessionSearch: () => createSessionSearch,
    createSessionSpawns: () => createSessionSpawns,
    createSessionState: () => createSessionState,
    createSkills: () => createSkills,
    createSpawnTargetPicker: () => createSpawnTargetPicker,
    createSpawnTargets: () => createSpawnTargets,
    decodeBounceOperation: () => decodeBounceOperation,
    decodeBounceOperations: () => decodeBounceOperations,
    decodeBouncePreview: () => decodeBouncePreview,
    decodeDirectoryChildren: () => decodeDirectoryChildren,
    decodeHarnessAgents: () => decodeHarnessAgents,
    decodeHarnessConfig: () => decodeHarnessConfig,
    decodeHarnessConfigPreview: () => decodeHarnessConfigPreview,
    decodeHostDescriptor: () => decodeHostDescriptor,
    decodeKnownDirectories: () => decodeKnownDirectories,
    decodeModelCatalog: () => decodeModelCatalog,
    decodeRecoveryMode: () => decodeRecoveryMode,
    decodeRecoveryReport: () => decodeRecoveryReport,
    decodeSearchPayload: () => decodeSearchPayload,
    decodeSessionRelations: () => decodeSessionRelations,
    decodeSessionSearch: () => decodeSessionSearch,
    decodeSkillCoverage: () => decodeSkillCoverage,
    decodeSkillDirectory: () => decodeSkillDirectory,
    decodeSpawnChoices: () => decodeSpawnChoices,
    decodeSpawnId: () => decodeSpawnId,
    decodeSpawnStatus: () => decodeSpawnStatus,
    hostConnReduce: () => hostConnReduce,
    hostKeyOf: () => hostKeyOf,
    hostSettingsHtml: () => hostSettingsHtml,
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
    resolveColorToHex: () => resolveColorToHex,
    rgbStringToHex: () => rgbStringToHex,
    sameDirectoryHost: () => sameDirectoryHost,
    sanitizeHostCatalog: () => sanitizeHostCatalog,
    sanitizeHostColorOrder: () => sanitizeHostColorOrder,
    sanitizeHostColors: () => sanitizeHostColors,
    sendJson: () => sendJson,
    sessionSpawnKey: () => sessionSpawnKey,
    spawnTargetKey: () => spawnTargetKey,
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
    constructor(message2, status) {
      super(message2);
      this.status = status;
      this.name = "ApiHttpError";
    }
    status;
  };
  function withFetchTimeout(options) {
    const { timeoutMs, ...init } = options;
    if (!init.signal && typeof timeoutMs === "number" && timeoutMs > 0 && typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    return init;
  }
  function createHostTransport(options) {
    const request = (host, path, init = {}) => {
      const { base, token } = options.resolveHost(host);
      const requestInit = withFetchTimeout(init);
      if (token) {
        const headers = new Headers(requestInit.headers);
        headers.set("Authorization", `Bearer ${token}`);
        requestInit.headers = headers;
      }
      return options.fetch(base + path, requestInit);
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
      async list(host, path, options) {
        return decodeSessionList(await jsonResponse(await request(host, path, options), "HTTP request failed"));
      },
      async models(host, options = {}) {
        const { sessionId, harnessId = "pi", cwd } = options;
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
  function mountModelSelector(root, actions, formatTokens) {
    const doc = root.ownerDocument;
    let view = null;
    let disposed = false;
    function element(tag, className, text9) {
      const node = doc.createElement(tag);
      node.className = className;
      if (text9 !== void 0) node.textContent = text9;
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
    function button(text9, name, value = "", primary = false) {
      const node = element("button", "model-footer-btn" + (primary ? " primary" : ""), text9);
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
            element("span", "model-option-context", model.contextWindow ? `${formatTokens(model.contextWindow)} context` : "context unknown")
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
  function createSessionState(options) {
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
      return findSession(id)?.host || options.getSelfHostId();
    }
    function stampSessionHost(session, hostId = options.getSelfHostId()) {
      if (!session.host && hostId) session.host = hostId;
      const label = options.getHostLabel(session.host || hostId);
      if (label) session.hostLabel = label;
      return session;
    }
    function setSessionLists(next, hostId = options.getSelfHostId()) {
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
      options.onListsChanged();
      options.onCurrentChanged();
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
      options.onListsChanged();
      if (matches(currentSession)) options.onCurrentChanged();
    }
    function mergeCurrentSession(owner, fields) {
      if (!fields || !ownsSelection(owner) || !currentSession) return;
      const { id, host } = currentSession;
      Object.assign(currentSession, fields);
      currentSession.id = id;
      currentSession.host = host;
      stampSessionHost(currentSession);
      options.onCurrentChanged();
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
      const text9 = String(typeof value === "object" && "message" in value && value.message || value);
      return text9 || null;
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
  function createHostConnections(options) {
    const records = /* @__PURE__ */ new Map();
    const now = options.now || Date.now;
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
      if (!prev || prev.state !== next.state || prev.error !== next.error) options.onChange();
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
  function createHostSessionLoader(options) {
    const caches = /* @__PURE__ */ new Map();
    const owners = /* @__PURE__ */ new Map();
    const inflight = /* @__PURE__ */ new Map();
    const indexing = /* @__PURE__ */ new Map();
    function load(host, query, withPrevious, sequence) {
      const target = Object.freeze({ ...host });
      const key = hostKeyOf(target);
      const wireQuery = options.stripHostQuery(query);
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
        const data = await options.requestList(host, "/api/sessions?" + params.toString(), { timeoutMs: 2e4 });
        if (owners.get(key) !== owner) return;
        options.onConnection(host, "success");
        if (owner.sequence !== options.currentSequence()) return;
        const cached = caches.get(key) || { active: [], previous: [] };
        if (withPrevious) {
          indexing.set(key, !!data.indexing);
          if (data.indexing) options.onIndexing();
        }
        const next = {
          active: withPrevious ? data.active : mergeActiveHints(data.active, cached.active),
          previous: withPrevious ? data.previous : mergeLiveSubagents(cached.previous, data.children)
        };
        options.beforePublish(host, next, wireQuery);
        caches.set(key, next);
        options.onPublish(owner.query);
      } catch (error) {
        if (owners.get(key) !== owner) return;
        if (error instanceof ApiHttpError && error.status === 401) {
          options.onConnection(host, "blocked");
          options.onPublish();
          return;
        }
        options.onConnection(host, { type: "failure", error });
        options.onError(host, error);
        if (owner.sequence === options.currentSequence()) options.onPublish();
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
    return { load, getCache, isIndexing, prune };
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
  function createHarnessDiscovery(options) {
    let rows = fallback();
    let sequence = 0;
    const cache = /* @__PURE__ */ new Map();
    const pending = /* @__PURE__ */ new Map();
    const cacheOwners = /* @__PURE__ */ new Map();
    const keyOf = (host) => host || options.selfHostId();
    async function load() {
      const host = options.selectedHostId();
      const key = keyOf(host);
      const seq = ++sequence;
      const ownsDiscovery = () => seq === sequence && host === options.selectedHostId();
      try {
        const data = await options.requestPicker(host);
        if (!ownsDiscovery()) return;
        if (data == null) throw new Error("Missing harness catalog");
        const discovered = decodeRows(data);
        if (discovered.length) {
          rows = discovered;
          cache.set(key, discovered);
          cacheOwners.set(key, {});
          options.onCacheChange();
          const preferred = options.preferredHarness();
          if (preferred && rows.some((row) => row.id === preferred && row.available !== false)) {
            options.onPreferredHarness(preferred);
          }
        }
      } catch {
        if (!ownsDiscovery()) return;
        rows = fallback();
      }
      options.onPickerChange();
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
          const data = await options.requestBackground(key);
          if (cacheOwners.get(key) !== owner) return;
          cache.set(key, decodeRows(data));
          options.onCacheChange();
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
  function createHostDiscovery(options) {
    const descriptors = /* @__PURE__ */ new Map();
    const requests = /* @__PURE__ */ new Map();
    const now = options.now || Date.now;
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
        const response = await options.requestSelf();
        if (!response.ok) return;
        const descriptor = decodeHostDescriptor(await response.json());
        if (sequence === selfSequence && descriptor) options.onSelf(descriptor);
      } catch {
      }
    }
    async function identify(refresh = false) {
      const pending = options.pollableHosts().filter((host) => !host.self && (!host.hostId || host.source === "user" && (refresh || !descriptors.has(host.hostId))));
      await Promise.allSettled(pending.map(async (host) => {
        const captured = Object.freeze({ ...host });
        const source = options.sourceFor(captured);
        if (!source) return;
        const sourceFields = { base: source.base, hostId: source.hostId, token: source.token };
        const owner = {};
        requests.set(source, owner);
        const ownsSource = () => requests.get(source) === owner && options.sourceFor(captured) === source && source.base === sourceFields.base && source.token === sourceFields.token;
        const owns = () => ownsSource() && source.hostId === sourceFields.hostId && options.hosts().some((current) => current.base === captured.base && current.hostId === captured.hostId && current.source === captured.source && current.token === captured.token);
        let applying = false;
        try {
          const response = await options.request(captured, "/api/host", { timeoutMs: 8e3 });
          if (!owns()) return;
          if (response.status === 401) {
            options.onConnection(captured, "blocked");
            return;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const descriptor = decodeHostDescriptor(await response.json());
          if (!owns() || !descriptor) return;
          descriptors.set(descriptor.hostId, descriptor);
          applying = true;
          options.onIdentified(host, source, descriptor);
          options.onConnection(host, "success");
        } catch (error) {
          if (applying ? ownsSource() : owns()) options.onConnection(captured, { type: "failure", error });
        } finally {
          if (requests.get(source) === owner) requests.delete(source);
        }
      }));
    }
    async function performFleet(sequence) {
      try {
        const response = await options.request(null, "/api/hosts", { timeoutMs: 1e4 });
        if (!response.ok) return;
        const data = await response.json();
        if (sequence !== fleetSequence || !record2(data) || !Array.isArray(data.hosts)) return;
        const rows = data.hosts;
        const hosts = rows.filter(record2);
        fleetPublication = sequence;
        options.onFleet({ hosts: hosts.filter((host) => !host.self), selfLabel: hosts.find((host) => host.self)?.label });
        await identify(true);
        if (sequence === fleetPublication) options.afterFleet();
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
  function createHostDirectory(options) {
    let self = { base: "", hostId: null, label: null, version: null, capabilities: null };
    let catalog = sanitizeHostCatalog(options.initialCatalog);
    let fleet = [];
    let cache = null;
    function invalidate() {
      cache = null;
    }
    function effectiveHosts() {
      if (!cache) {
        cache = mergeHostEntries(self, fleet, catalog);
        for (const host of cache) {
          const descriptor = host.hostId && options.descriptor(host.hostId);
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
      options.persistCatalog(catalog);
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
      if (user) options.persistCatalog(catalog);
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
  function createHostSettings(options) {
    let view = null;
    let sequence = 0;
    let checking = false;
    const { directory, connections, escapeHtml: escapeHtml2, displayLabel } = options;
    function status(owner, message2, error = false) {
      if (view !== owner) return;
      owner.status.textContent = message2;
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
      options.onCatalogSaved();
    }
    function promptToken(key) {
      const owner = view;
      if (!owner) return;
      const entry = directory.catalog.find((item) => (item.hostId || item.base) === key);
      if (!entry) {
        status(owner, "That host comes from this server\u2019s config \u2014 set its token there.");
        return;
      }
      const token = options.promptToken(displayLabel(entry));
      if (token === null || view !== owner) return;
      directory.setToken(key, token.trim() || void 0);
      connections.reset(key);
      save();
      options.refreshSessions();
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
      if (options.protocol() === "https:" && base.startsWith("http://")) {
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
        const response = await options.request(Object.freeze({ base, token: token || null }), "/api/host");
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
      options.discovery.rememberDescriptor(descriptor);
      directory.add({ base, hostId: descriptor.hostId, label: label || descriptor.label || null, token: token || null });
      connections.reset(descriptor.hostId);
      save();
      owner.base.value = "";
      owner.label.value = "";
      owner.token.value = "";
      status(owner, `Added ${displayLabel({ label, base })}.`);
      options.refreshSessions();
      options.renderNewSessionHosts();
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
        const custom = options.customColor(hostId);
        const hex = options.resolveColor(options.color(hostId)) || "#888888";
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
          options.setColor(input.dataset.host || null, input.value, { rows: false });
        }, listener);
        input.addEventListener("change", () => {
          if (view === owner && list.contains(input)) options.setColor(input.dataset.host || null, input.value);
        }, listener);
      }
      for (const btn of Array.from(list.querySelectorAll(".host-color-reset"))) {
        btn.addEventListener("click", () => {
          if (view === owner && list.contains(btn)) options.setColor(btn.dataset.host || null, null);
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
  function createHostPresentation(options) {
    let overrides = sanitizeHostColors(options.initialColors);
    let order = sanitizeHostColorOrder(options.initialOrder);
    function keyFor(hostId) {
      if (hostId) return hostId;
      const entry = options.directory.entryFor(null);
      return entry && (entry.hostId || entry.key) || "self";
    }
    function colorFor(hostId) {
      const assigned = assignHostColor(order, keyFor(hostId), overrides);
      if (assigned.appended) {
        order = assigned.order;
        try {
          options.persistOrder(order);
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
        options.persistColors(overrides);
      } catch {
      }
      options.onColorChanged(rows);
    }
    function dotHtml(hostId, className = "host-chip-dot") {
      return `<span class="${className}" style="--host-color:${options.escapeHtml(colorFor(hostId))}"></span>`;
    }
    function chipHtml(hostId, { note = false } = {}) {
      if (options.directory.effectiveHosts().length <= 1) return "";
      const entry = options.directory.entryFor(hostId);
      if (!entry) return "";
      const down = options.isDown(entry);
      const label = options.displayLabel(entry);
      const title = label + (down ? " \u2014 unreachable, showing last known sessions" : "");
      return `<span class="host-chip${down ? " offline" : ""}" style="--host-color:${options.escapeHtml(colorFor(hostId))}" title="${options.escapeHtml(title)}"><span class="host-chip-dot"></span>${options.escapeHtml(label)}${down && note ? " \xB7 unreachable" : ""}</span>`;
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
  function createDirectoryCatalog(options) {
    let sequence = 0;
    let owner = null;
    let rows = [];
    function current() {
      return sameDirectoryHost(owner, options.host()) ? rows : [];
    }
    function retire() {
      sequence++;
    }
    async function load() {
      const requestSequence = ++sequence;
      const selected = options.host();
      if (!selected) return;
      const host = Object.freeze({ ...selected });
      const owns = () => requestSequence === sequence && sameDirectoryHost(host, options.host());
      try {
        const response = await options.request(host, "/api/cwds");
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
  function createCwdAutocomplete(options) {
    const { input, dropdown } = options;
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
      options.onPick?.(path);
    }
    function render(query, dirs, owns, ownsRows) {
      if (!owns()) return;
      const seen = /* @__PURE__ */ new Set();
      let results = [];
      const candidates = [
        ...options.known().map((row) => ({ ...row, known: true })),
        ...dirs.map((row) => ({ ...row, known: false }))
      ];
      for (const row of candidates) {
        if (seen.has(row.short)) continue;
        seen.add(row.short);
        const indices = query ? options.match(query, row.short) : [];
        if (!indices) continue;
        results.push({ ...row, indices, score: query ? options.score(indices, row.short) + (row.known ? 5 : 0) : 0 });
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
      dropdown.innerHTML = results.map((row) => `<div class="cwd-option" data-path="${options.escapeHtml(row.short)}">${row.known ? '<span class="cwd-known">\u2605</span>' : ""}${options.highlight(row.short, row.indices)}</div>`).join("");
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
      const selected = options.host();
      if (!mounted() || !selected) return;
      const host = Object.freeze({ ...selected });
      const requestSequence = sequence;
      const rowGeneration = viewGeneration;
      const ownsRows = () => mounted() && viewGeneration === rowGeneration && sameDirectoryHost(host, options.host());
      const owns = () => mounted() && sequence === requestSequence && sameDirectoryHost(host, options.host());
      timer = setTimeout(async () => {
        timer = null;
        if (!owns()) return;
        let rows = [];
        try {
          const response = await options.request(host, "/api/dirs?q=" + encodeURIComponent(query));
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
      options.onBlur?.();
    }, listener);
    input.addEventListener("keydown", (event) => {
      if (resultOwner && !resultOwner()) hide();
      if (dropdown.style.display === "none") {
        if (event.key === "Enter" && options.onSubmit) {
          event.preventDefault();
          options.onSubmit();
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
          options.onSubmit?.();
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
  function createDirectoryTree(options) {
    const { root } = options;
    const doc = root.ownerDocument;
    let owner = null;
    function owns(target) {
      return owner === target && root.isConnected && sameDirectoryHost(target.host, options.host());
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
        options.onPick(path);
        root.querySelectorAll(".ns-tree-row.selected").forEach((item) => item.classList.remove("selected"));
        row.classList.add("selected");
      }, { signal: target.events.signal });
      row.append(chevron, name);
      node.append(row, children);
      async function load() {
        let data = { dirs: [], error: true };
        try {
          const response = await options.request(target.host, "/api/dirs/children?path=" + encodeURIComponent(path), { signal: target.events.signal });
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
      const host = options.host();
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
  function createSpawnTargets(options) {
    let sequence = 0;
    let owner = null;
    let choices = [HEADLESS];
    let choiceKey = "headless";
    function currentChoices() {
      return sameDirectoryHost(owner, options.host()) ? choices : [HEADLESS];
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
      options.changed();
      const selected2 = options.host();
      if (!selected2 || !options.supportsTmux()) return;
      const host = Object.freeze({ ...selected2 });
      const owns = () => sequence === requestSequence && sameDirectoryHost(host, options.host());
      let next;
      try {
        const response = await options.request(host, "/api/tmux/targets");
        if (!response.ok || !owns()) return;
        const data = await response.json();
        if (!owns()) return;
        next = decodeSpawnChoices(data);
      } catch {
        return;
      }
      owner = host;
      choices = next;
      const saved = options.readSaved();
      choiceKey = choices.some((choice) => spawnTargetKey(choice) === saved) ? saved || "headless" : "headless";
      options.changed();
    }
    function choose(key) {
      if (!currentChoices().some((choice) => spawnTargetKey(choice) === key)) return false;
      choiceKey = key;
      options.save(key);
      options.changed();
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
      const saved = options.readSaved();
      const choice = choices.find((item) => spawnTargetKey(item) === saved);
      if (!choice?.target?.tmuxSession || choice.needsName) return null;
      return { type: "tmux", socket: choice.target.socket, tmuxSession: choice.target.tmuxSession };
    }
    return { load, retire, choices: currentChoices, current, choose, selected, resume };
  }
  function createSpawnTargetPicker(options) {
    const { input, nameInput, wrap, dropdown, targets } = options;
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
        const indices = q ? options.match(q, choice.label) : [];
        return indices ? [{ choice, indices, score: q ? options.score(indices, choice.label) : 0 }] : [];
      });
      if (q) named = named.sort((a, b) => b.score - a.score);
      const rows = [...choices.filter((choice) => choice.pinned).map((choice) => ({ choice, indices: [] })), ...named];
      dropdown.innerHTML = rows.map(({ choice, indices }) => `<div class="cwd-option" data-key="${options.escapeHtml(spawnTargetKey(choice))}">${indices.length ? options.highlight(choice.label, indices) : options.escapeHtml(choice.label)}</div>`).join("");
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
  function createModelCatalog(options) {
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
        const data = await options.read(owner);
        if (!valid()) return;
        models = decodeModelCatalog(data);
        scope = owner;
        currentOwner = ownsRows;
        if (models.length) {
          try {
            options.persist(owner, models);
          } catch {
          }
        }
        options.changed();
      } catch (error) {
        if (!valid()) return;
        models = [];
        scope = null;
        currentOwner = null;
        options.failed(error);
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
  function createNewSessionPreferences(options) {
    let harness = "pi", model = "", thinking = "";
    function preference(kind) {
      return options.read(`pi-dish-new-${kind}:${harness}`) || (harness === "pi" ? options.read(`pi-dish-new-${kind}`) : "") || "";
    }
    function persist(kind, value) {
      options.write(`pi-dish-new-${kind}:${harness}`, value);
      if (harness === "pi") options.write(`pi-dish-new-${kind}`, value);
    }
    function restore(harnessId) {
      harness = harnessId;
      model = preference("model");
      thinking = preference("thinking");
    }
    function syncThinking() {
      const selected = options.rows().find((row) => (row.selector || `${row.provider}/${row.id}`) === options.model.value);
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
      options.thinking.innerHTML = '<option value="">(default)</option>' + levels.map((level) => `<option value="${options.escapeHtml(level)}">${options.escapeHtml(thinkingLabel(level))}</option>`).join("");
      if (!levels.includes(thinking)) {
        thinking = "";
        persist("thinking", "");
      }
      options.thinking.disabled = disabled;
      options.thinking.value = disabled ? "" : thinking;
      if (options.thinkingNote) options.thinkingNote.textContent = note;
    }
    function render() {
      const { html, enabled, hidden } = modelSelectOptionsHtml(options.rows(), options.escapeHtml);
      options.model.innerHTML = html;
      options.model.value = model && enabled.some((row) => (row.selector || `${row.provider}/${row.id}`) === model) ? model : "";
      if (options.hiddenNote) options.hiddenNote.textContent = modelHiddenNote(hidden);
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
  function createNewSessionConfigPreview(options) {
    let sequence = 0;
    let config = null;
    let owner = null;
    function current(target) {
      const now = options.scope();
      return !!target && !!now && target.view === now.view && target.cwd === now.cwd && target.harnessId === now.harnessId && sameDirectoryHost(target.host, now.host);
    }
    function retire() {
      sequence++;
      config = null;
      owner = null;
    }
    async function load(cwd) {
      retire();
      const now = options.scope();
      if (!now || now.harnessId !== "omp") {
        options.wrap.style.display = "none";
        return;
      }
      const target = Object.freeze({ ...now, cwd: cwd ?? now.cwd, host: Object.freeze({ ...now.host }) });
      const version = sequence;
      const owns = () => version === sequence && current(target);
      options.wrap.style.display = "";
      options.values.textContent = "Loading\u2026";
      for (const button of options.buttons) button.style.display = "none";
      if (options.roles) options.roles.textContent = "";
      try {
        const params = target.cwd ? `?cwd=${encodeURIComponent(target.cwd)}` : "";
        const response = await options.request(target.host, "/api/harnesses/omp/config" + params);
        if (!owns()) return;
        const data = await response.json();
        if (!owns()) return;
        if (!response.ok) throw new Error(record5(data) && typeof data.error === "string" && data.error ? data.error : `HTTP ${response.status}`);
        config = decodeHarnessConfigPreview(data, target.cwd);
        owner = target;
        options.values.textContent = `Model: ${config.defaultModel || "auto-select"} \xB7 Thinking: ${config.defaultThinkingLevel || "host default"}`;
        if (options.roles) options.roles.textContent = "Roles: " + options.roleSummary(config.modelRoles);
        for (const button of options.buttons) button.style.display = "";
      } catch (error) {
        if (!owns()) return;
        config = null;
        owner = null;
        options.values.textContent = `Defaults unavailable: ${error instanceof Error ? error.message : String(error)}`;
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
  function createHarnessSettings(options) {
    const { root, escapeHtml: escapeHtml2, shortCwd: shortCwd2, parseModelRoleRef, composeModelRoleRef, modelRoleLevels } = options;
    const AGENT_MODEL_ROLE_REFS = options.roleDefinitions.map((role) => `@${role.key}`);
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
      return sameDirectoryHost(view.host, options.host(view.scope.hostId));
    }
    function harnessSettingsError(message2) {
      $("modelRolesError").textContent = message2;
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
      const canonical = new Set(options.roleDefinitions.map((role) => role.key));
      return [...options.roleDefinitions, ...Object.keys(global).filter((key) => !canonical.has(key)).sort().map((key) => ({ key, name: key, description: "Custom role" }))].map((role) => {
        const value = global[role.key] || "", effectiveValue = effective[role.key] || "";
        return { ...role, value, override: effectiveValue && effectiveValue !== value ? effectiveValue : null };
      });
    }
    async function request(host, url, body) {
      const response = await options.request(host, url, body === void 0 ? void 0 : {
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
      const endpoint = options.host(scope.hostId);
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
      view.models = models.value || options.fallbackModels(view.host, scope.harnessId);
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
        options.onSaved(view.scope);
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
  function createSessionSpawns(options) {
    const pending = /* @__PURE__ */ new Map();
    async function monitor(key, spawn) {
      try {
        let sessionId;
        for (; ; ) {
          let response;
          try {
            response = await options.request(spawn.endpoint, `/api/session-spawns/${encodeURIComponent(spawn.spawnId)}`);
          } catch {
            await options.delay();
            continue;
          }
          const data = await response.json().catch(() => null);
          if (!response.ok && response.status !== 202) throw new Error(record7(data) && typeof data.error === "string" && data.error ? data.error : `spawn status failed (${response.status})`);
          const status = decodeSpawnStatus(data);
          if (status.status === "starting") {
            await options.delay();
            continue;
          }
          if (status.status === "error") throw new Error(status.error);
          sessionId = status.sessionId;
          break;
        }
        for (; ; ) {
          await options.loadSessions();
          if (options.hasSession(sessionId, spawn.host)) {
            pending.delete(key);
            options.changed();
            const showing = options.current() === key;
            if (showing) options.stashPrompt();
            options.migratePrompt(key, spawn.host, sessionId);
            if (showing) {
              options.status("Session created");
              options.selectSession(sessionId, spawn.host);
            }
            return;
          }
          if (options.current() === key) options.status("Session created \u2014 connecting the UI\u2026", "working");
          await options.delay();
        }
      } catch (error) {
        pending.delete(key);
        options.changed();
        const message2 = error instanceof Error ? error.message : String(error);
        if (options.current() === key) {
          options.showFailure(key, message2, spawn);
          options.status(`Session start failed: ${message2}`, "error");
        } else options.discardPrompt(key);
      }
    }
    async function submit(input) {
      const host = Object.freeze({ ...input.host });
      const target = input.target ? Object.freeze({ ...input.target }) : void 0;
      const { name, cwd, model, thinking, draft, ownsView, onAccepted } = input;
      const harness = input.harness || "pi";
      const label = options.harnessLabel(harness);
      const data = await sendJson(options.request, host, "/api/sessions/new", {
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
      if (draft) options.saveDraft(key, draft);
      onAccepted?.();
      if (ownsView()) options.showPending(key);
      else options.changed();
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

  // src/browser/helper-format.ts
  function escapeHtml(text9) {
    if (text9 == null || text9 === "") return "";
    return String(text9).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
  function shortCwd(cwd) {
    if (!cwd) return "";
    return cwd.replace(/^\/home\/[^/]+\//, "~/").replace(/^\/home\/[^/]+$/, "~");
  }

  // src/browser/helper-identity.ts
  function sessionKey(hostId, sessionId) {
    const id = sessionId == null ? "" : String(sessionId);
    return hostId ? `${hostId} ${id}` : id;
  }
  function hostDisplayLabel(host) {
    if (!host) return "";
    if (host.label) return String(host.label);
    if (host.name) return String(host.name);
    if (!host.base) return "this host";
    return String(host.base).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
  function sessionMetaText(session) {
    return [session.name, session.cwd, session.model, session.id].join(" ").toLowerCase();
  }

  // src/browser/helper-models.ts
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
  function countOccurrences(text9, token) {
    if (!text9 || !token) return 0;
    let n = 0, i = text9.indexOf(token);
    while (i !== -1) {
      n++;
      i = text9.indexOf(token, i + token.length);
    }
    return n;
  }
  function scoreSessionMatch(parsed, session, contentText) {
    const tokens = positiveQueryTokens(parsed);
    if (!tokens.length) return 0;
    const name = String(session.name || "").toLowerCase();
    const other = [session.cwd, session.model, session.id].join(" ").toLowerCase();
    let total = 0;
    for (const token of tokens) {
      if (name.includes(token)) total += 100;
      if (other.includes(token)) total += 30;
      const n = countOccurrences(contentText, token);
      if (n > 0) total += 20 + Math.min(30, Math.round(8 * Math.log2(n)));
    }
    return Math.round(total);
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
  function highlightTokens(text9, tokens) {
    const str = String(text9);
    const lower = str.toLowerCase();
    const ranges = [];
    for (const t of tokens) {
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
  function createNewSession(options) {
    const { root, storage, models, request } = options;
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
    const message2 = (error2) => error2 instanceof Error ? error2.message : String(error2);
    const isOpen = () => !disposed && root.classList.contains("new-session-open");
    const host = () => (selectedHostId ? options.host(selectedHostId) : null) || options.self();
    const hostId = () => host().hostId || null;
    const cwd = () => cwdInput.value.trim();
    const selectedHarness = () => harnessSelect.value || harnessId || "pi";
    const supports = (capability) => !host().capabilities || host().capabilities?.[capability] === true;
    const hostOptions = () => options.hosts().filter((row) => row.self || !options.hostDown(row));
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
      supportsTmux: () => supports("tmux"),
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
      selfHostId: () => options.self().hostId,
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
        if (!disposed) options.harnessCacheChanged();
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
      for (const session of [...options.sessionState.sessions.active, ...options.sessionState.sessions.previous]) {
        if (options.multiHost() && (session.host || null) !== endpoint.hostId) continue;
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
      options.closeOtherViews();
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
          const cached = JSON.parse(storage.getItem(modelsCacheKey(harness, endpoint.hostId, options.self().hostId)) || "null");
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
      options.closeSettings();
      clearTimeout(refreshTimer);
      config.retire();
      autocomplete.hide();
    }
    function captureView() {
      const view = generation, open2 = isOpen(), selection = options.sessionState.captureSelection(), pending = options.currentSpawn();
      const endpoint = Object.freeze({ ...host() }), harness = selectedHarness(), directory = cwd();
      return () => !disposed && (!open2 || sameDirectoryHost(endpoint, host()) && harness === selectedHarness() && directory === cwd()) && view === generation && open2 === isOpen() && pending === options.currentSpawn() && (selection ? options.sessionState.ownsSelection(selection) : !options.sessionState.currentSession);
    }
    function submit(value = {}) {
      if (disposed) return Promise.reject(new Error("New-session form is no longer available"));
      const target = value.host === void 0 ? hostId() : value.host;
      const endpoint = typeof target === "object" && target ? target : options.host(target);
      if (!endpoint) return Promise.reject(new Error("Host is no longer available"));
      const view = generation, submittedDraft = value.draft === void 0 ? draft : value.draft;
      return options.spawns.submit({
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
      const selected = options.host(targetHost);
      if (!selected) {
        options.status("Host is no longer available", "error");
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
        if (ownsView()) options.status(target ? "Spawning in tmux\u2026" : "Creating session...", "working");
        const directory = cwdValue === void 0 ? cwd() : cwdValue;
        if (directory) storage.setItem("pi-dish-cwd", directory);
        await submit({ cwd: directory, target, harness, host: endpoint, ownsView, draft: null });
      } catch (error2) {
        if (ownsView()) options.status(`Error: ${message2(error2)}`, "error");
      }
    }
    async function spawn() {
      if (disposed || spawnButton.disabled) return;
      const view = generation, ownsView = captureView();
      let target;
      try {
        target = selectedTarget();
      } catch (caught) {
        error(message2(caught));
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
        if (ownsView()) error(message2(caught));
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
      supports,
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
  function createRecovery(options) {
    const doc = options.root.ownerDocument;
    const element = (id) => {
      const value = doc.getElementById(id);
      if (!value) throw new Error("Missing recovery element: " + id);
      return value;
    };
    const apiFetch = options.request;
    const apiSend = (host, path, payload, method) => sendJson(apiFetch, host, path, payload, method);
    const effectiveHosts = options.hosts;
    const hostIsDown = options.down;
    const confirm = options.confirm;
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
      return effectiveHosts().filter((host) => options.supports(host));
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
        const missing = effectiveHosts().filter((host) => !options.supports(host));
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
      await options.fleetReady();
      if (disposed || mountSeq !== preferencesSeq || !section.isConnected || !options.settingsOpen()) return;
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
      hostSelect.value = selectRecoveryHost(recoveryCapableHosts(), options.selectedHost())?.hostId || "";
      let seq = 0;
      const selectedHost = () => recoveryCapableHosts().find((host) => (host.hostId || "") === hostSelect.value);
      const ownsView = () => !disposed && mountSeq === preferencesSeq && section.isConnected && options.settingsOpen();
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
      void options.refreshFleet();
    }
    function isRecoveryViewOpen() {
      return !disposed && options.root.classList.contains("recovery-open");
    }
    function closeRecoveryView() {
      if (disposed) return;
      const select = doc.getElementById("recoveryReportHost");
      if (select) select.onchange = null;
      recoveryViewSeq += 1;
      reportEvents?.abort();
      reportEvents = null;
      reportEndpoint = void 0;
      options.root.classList.remove("recovery-open");
    }
    function openRecoveryView(hostId) {
      const hosts = recoveryCapableHosts();
      if (disposed || !hosts.length) return;
      options.closeOtherViews();
      options.root.classList.add("recovery-open");
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
  function createBounce(options) {
    const document2 = options.document, apiFetch = options.request, sessionState = options.sessionState;
    const effectiveHosts = options.hosts, refreshSessions = options.refreshSessions, selectSession = options.selectSession;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing bounce element: " + id);
      return value;
    };
    const message2 = (error) => error instanceof Error ? error.message : String(error);
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
      await options.fleetReady();
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
        state.previewError = `Preview unavailable: ${message2(error)}`;
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
      const count = bounceHosts.reduce((sum, state) => sum + (bounceHostElement(state) ? state.selected.size : 0), 0);
      const mode = element("bounceMode").value === "restart" ? "Restart" : "Reload";
      const submit = element("bounceSubmit");
      submit.disabled = !count || bounceSubmitting;
      submit.textContent = bounceSubmitting ? "Queueing\u2026" : `Queue ${mode} (${count})`;
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
          state.actionNotice = `Queue request failed: ${message2(error)}. Acceptance may be unknown; check recent operations before selecting again.`;
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
        if (seq === state.readSeq) state.operationError = `Status unavailable: ${message2(error)}. Displayed operations may be stale.`;
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
        state.actionNotice = `Cancellation failed: ${message2(error)}. Check status before trying again.`;
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
      if (affected && owner && id && !sessionState.findSession(id, owner.host)) await options.loadPrevious();
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
  function createSessionRelations(options) {
    const { document: document2, window, sessionState } = options;
    const element = (id) => document2.getElementById(id);
    let sessionRelationsSeq = 0;
    let disposed = false;
    let renderOwner = null;
    let renderEndpoint = null;
    let headerEvents = new AbortController(), modalEvents = new AbortController();
    const events = new AbortController();
    let indexingTimer;
    function sameEndpoint(host, endpoint) {
      const current = options.endpoint(host);
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
      const count = document2.createElement("span");
      count.className = "session-relation-kind";
      count.textContent = `+${hiddenCount}`;
      const label2 = document2.createElement("span");
      label2.className = "session-relation-name";
      label2.textContent = "more";
      more.append(count, label2);
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
      for (let count = chips.length; count >= 0; count -= 1) {
        const hiddenCount = totalCount - count;
        let needed = prefixWidths[count] + Math.max(0, count - 1) * gap;
        if (hiddenCount > 0) {
          moreProbe.querySelector(".session-relation-kind").textContent = `+${hiddenCount}`;
          needed += (count ? gap : 0) + moreProbe.offsetWidth;
        }
        if (needed <= available) {
          chosen = count;
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
      const resolved = options.endpoint(owner.host);
      if (!resolved) return;
      const endpoint = Object.freeze({ ...resolved });
      const seq = ++sessionRelationsSeq;
      clearTimeout(indexingTimer);
      const current = () => seq === sessionRelationsSeq && owns(owner, endpoint);
      try {
        const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/related`);
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
    async function openRelatedSession(id, owner, endpoint = owner ? options.endpoint(owner.host) : null) {
      if (!owns(owner, endpoint) || !owner) return;
      const captured = endpoint ? Object.freeze({ ...endpoint }) : null;
      if (!sessionState.findSession(id, owner.host)) await options.loadPrevious();
      if (!owns(owner, captured)) return;
      if (!sessionState.findSession(id, owner.host)) {
        options.status("Related session is not available yet", "error");
        return;
      }
      await options.selectSession(id, { host: owner.host });
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
  function createSessionSearch(options) {
    const { document: document2, sessionState } = options;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing search element: " + id);
      return value;
    };
    let query = "", matches = [], pos = -1;
    let sequence = 0, disposed = false;
    let navigation = null;
    function updateCount(message2) {
      if (disposed) return;
      element("searchCount").textContent = message2 !== void 0 ? message2 : matches.length ? `${pos + 1}/${matches.length}` : query ? "no matches" : "";
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
      const current = options.endpoint(owner.host);
      return !!current && current.base === endpoint.base && (current.token || "") === (endpoint.token || "");
    }
    async function run(value, { mode = "message", closeIfEmpty = false } = {}) {
      const owner = sessionState.captureSelection();
      const resolved = owner && options.endpoint(owner.host);
      if (disposed || !owner || !resolved) return;
      const endpoint = Object.freeze({ ...resolved }), seq = ++sequence;
      const owns = () => !disposed && seq === sequence && sessionState.ownsSelection(owner) && sameEndpoint(owner, endpoint);
      updateCount("searching\u2026");
      try {
        const params = new URLSearchParams({ q: value });
        if (mode !== "message") params.set("mode", mode);
        const response = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/search?${params}`);
        const data = await response.json();
        if (!owns()) return;
        if (!response.ok || record8(data) && typeof data.error === "string" && data.error) throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
        query = value;
        const decoded = decodeSessionSearch(data);
        matches = options.focusMode() ? decoded.filter((match) => match.role !== "toolResult") : decoded;
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
      const owner = sessionState.captureSelection(), match = matches[pos], seq = sequence, tokens = query.split(/\s+/).filter(Boolean);
      const resolved = owner && options.endpoint(owner.host);
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
        while (owns() && options.oldestIndex() !== null && match.index < options.oldestIndex() && options.hasOlder() && guard++ < 200) await options.loadOlder();
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
        markSearchTokens(el, tokens);
        options.stopFollowing();
        el.scrollIntoView({ block: "center" });
        options.updateJumpButton(container);
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
  function markSearchTokens(el, tokens) {
    if (!tokens.length) return;
    const document2 = el.ownerDocument;
    const walker = document2.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement?.closest("mark, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
      const text9 = node.textContent || "";
      const lower = text9.toLowerCase();
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
      const frag = document2.createDocumentFragment();
      let cursor = 0;
      for (const [start, end] of ranges) {
        if (start < cursor) continue;
        frag.appendChild(document2.createTextNode(text9.slice(cursor, start)));
        const mark = document2.createElement("mark");
        mark.className = "search-mark";
        mark.textContent = text9.slice(start, end);
        frag.appendChild(mark);
        cursor = end;
      }
      frag.appendChild(document2.createTextNode(text9.slice(cursor)));
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
  function createSkills(options) {
    const document2 = options.root.ownerDocument, sessionState = options.sessionState;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing skills element: " + id);
      return value;
    };
    let disposed = false;
    let viewHost = null;
    let bodyEvents = new AbortController(), headerEvents = new AbortController();
    let indexingTimer, activationTimer;
    const message2 = (error) => error instanceof Error ? error.message : String(error);
    function owns(seq = skillsSeq) {
      const current = options.self();
      return seq === skillsSeq && isSkillsViewOpen() && !!viewHost && current.hostId === viewHost.hostId && current.base === viewHost.base && (current.token || "") === (viewHost.token || "");
    }
    function retireBody() {
      bodyEvents.abort();
      bodyEvents = new AbortController();
    }
    async function read(path) {
      const host = viewHost;
      if (!host) throw new Error("Skills host is no longer available");
      const response = await options.request(host, path);
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
      return !disposed && options.root.classList.contains("skills-open");
    }
    function openSkillsView() {
      if (disposed) return;
      closeSkillsView();
      options.closeOtherViews();
      viewHost = Object.freeze({ ...options.self() });
      options.root.classList.add("skills-open");
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
      options.root.classList.remove("skills-open");
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
        body.innerHTML = `<div class="usage-state">Could not load skills: ${escapeHtml(message2(e))}</div>`;
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
        body.innerHTML = `<div class="usage-state">Could not load coverage: ${escapeHtml(message2(e))}</div>`;
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
      const apiUrl = options.origin() + "/api/skills/activations?skill=" + encodeURIComponent(skill ? skill.skill : cov.skill);
      const covUrl = options.origin() + "/api/skills/coverage?skill=" + encodeURIComponent(skill ? skill.skill : cov.skill);
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
        options.copy(cov.skill);
        options.status("Skill path copied");
      }, { signal: bodyEvents.signal });
      body.querySelector(".api-box")?.addEventListener("click", () => {
        if (!owns(seq)) return;
        options.copy(apiUrl);
        options.status("Activations URL copied");
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
      options.refine({ cwd, draft, host: viewHost.hostId });
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
        "Coverage detail: " + options.origin() + "/api/skills/coverage?skill=" + encodeURIComponent(skill.filePath),
        "Raw activations (NDJSON): " + options.origin() + "/api/skills/activations?skill=" + encodeURIComponent(skill.filePath),
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
      const current = () => !disposed && navigation === skillsSeq && options.self().hostId === endpoint.hostId && options.self().base === endpoint.base && (options.self().token || "") === (endpoint.token || "");
      if (!sessionState.findSession(id, endpoint.hostId)) await options.loadPrevious();
      if (!current() || !sessionState.findSession(id, endpoint.hostId)) return;
      const selecting = options.selectSession(id, { host: endpoint.hostId });
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
  function createSearchView(options) {
    const document2 = options.root.ownerDocument, sessionState = options.sessionState;
    const element = (id) => {
      const value = document2.getElementById(id);
      if (!value) throw new Error("Missing search view element: " + id);
      return value;
    };
    const effectiveHosts = options.hosts, fanoutHosts = options.fanout, scopeQuery = options.scope;
    const hostChipHtml = (host) => options.hostChip(host || null);
    const isMultiHost = () => effectiveHosts().length > 1;
    let disposed = false;
    let rowEvents = new AbortController();
    const events = new AbortController();
    let view = 0;
    function sameHost(host) {
      const current = options.host(host.hostId);
      return !!current && current.hostId === host.hostId && current.base === host.base && (current.token || "") === (host.token || "");
    }
    const message2 = (error) => error instanceof Error ? error.message : String(error);
    let searchViewSeq = 0;
    let searchViewQuery = "";
    let searchViewRenderedQuery = "";
    let searchViewTimer;
    let searchViewRepollTimer;
    function isSearchViewOpen() {
      return !disposed && options.root.classList.contains("search-open");
    }
    function openSearchView(initialQuery) {
      if (disposed) return;
      closeSearchView();
      options.closeOtherViews();
      view++;
      if (typeof initialQuery === "string") searchViewQuery = initialQuery;
      const input2 = element("searchViewInput");
      input2.value = searchViewQuery;
      options.root.classList.add("search-open");
      input2.focus();
      input2.select();
      runSearchView();
    }
    function closeSearchView() {
      if (disposed) return;
      view++;
      rowEvents.abort();
      searchViewSeq += 1;
      options.root.classList.remove("search-open");
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
            const r = await options.request(host, "/api/search?" + params, { timeoutMs: 2e4 });
            if (r.status === 401) {
              if (sameHost(host)) options.connection(host, "blocked");
              throw new Error("needs a token");
            }
            const data = await r.json();
            if (!sameHost(host)) throw new Error("host connection changed");
            if (!r.ok) throw new Error(record8(data) && typeof data.error === "string" ? data.error : `HTTP ${r.status}`);
            payloads[i] = decodeSearchPayload(data);
            status[i] = "ok";
            options.connection(host, "success");
          } catch (e) {
            status[i] = "error";
            reasons[i] = e;
            if (!host.self && sameHost(host)) options.connection(host, "failure", e);
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
        body.innerHTML = `<div class="usage-state">Search failed: ${escapeHtml(message2(e))}</div>`;
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
      const tokens = positiveQueryTokens(parseSessionQuery(query));
      const shown = d.results || [];
      const scopesHidden = Number(d.hiddenByScopes) || 0;
      const automationHidden = Number(d.hiddenByAutomation) || 0;
      const cards = shown.map((s) => {
        let dot = "";
        if (s.turnInProgress || s.compacting) dot = '<span class="session-item-status working"></span>';
        else if (s.isActive) dot = '<span class="live-dot"></span>';
        const count = s.matchCount ? `<span class="search-result-count">${s.matchCount} ${s.matchCount === 1 ? "match" : "matches"}</span>` : "";
        const snippets = (s.snippets || []).map((sn) => `<div class="search-result-snippet">${highlightTokens(sn, tokens)}</div>`).join("");
        return `<div class="search-result" data-id="${escapeHtml(s.id)}"${s.host ? ` data-host="${escapeHtml(s.host)}"` : ""} data-content-matches="${s.matchCount > 0 ? "1" : "0"}">
        <div class="search-result-header">
          ${dot}<span class="search-result-name">${highlightTokens(s.name || "Unnamed", tokens)}</span>
          ${count}<span class="search-result-time">${formatRelativeTime(s.lastActivity)}</span>
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
      <div class="search-count-line">${shown.length === 1 ? "1 session" : `${shown.length} sessions`}${d.total > d.results.length ? ` \u2014 showing the ${d.results.length} ${tokens.length ? "best matches" : "most recent"}, narrow the query for the rest` : ""}</div>
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
    async function openSearchResult(id, hasContentMatches, host = null, renderedQuery = searchViewRenderedQuery, endpoint = options.host(host)) {
      if (!isSearchViewOpen() || !endpoint || !sameHost(endpoint)) return;
      const captured = Object.freeze({ ...endpoint });
      const tokens = positiveQueryTokens(parseSessionQuery(renderedQuery));
      closeSearchView();
      const navigation = searchViewSeq;
      if (!sessionState.findSession(id, host)) await options.loadPrevious();
      if (disposed || navigation !== searchViewSeq || !sameHost(captured)) return;
      const entry = sessionState.findSession(id, host);
      if (!entry) return;
      const selecting = options.selectSession(id, { host: entry.host || null });
      const owner = sessionState.captureSelection(), selectedView = view;
      await selecting;
      if (tokens.length && hasContentMatches && owner && selectedView === view && sessionState.ownsSelection(owner) && owner.id === id && owner.host === (entry.host || null)) {
        options.sessionSearch.open();
        const input2 = element("searchInput");
        input2.value = tokens.join(" ");
        await options.sessionSearch.run(input2.value.trim().toLowerCase(), { mode: "any", closeIfEmpty: true });
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
  return __toCommonJS(index_exports);
})();
