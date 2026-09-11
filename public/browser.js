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
    createHostTransport: () => createHostTransport,
    createSessionApi: () => createSessionApi,
    createSessionState: () => createSessionState,
    decodeModelCatalog: () => decodeModelCatalog,
    modelCatalogUrl: () => modelCatalogUrl,
    mountModelSelector: () => mountModelSelector,
    sendJson: () => sendJson,
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
    constructor(message, status) {
      super(message);
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
  async function jsonResponse(response, fallback) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = data && typeof data === "object" && "error" in data ? data.error : null;
      throw new ApiHttpError(typeof error === "string" && error ? error : `${fallback} (${response.status})`, response.status);
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
    function element(tag, className, text2) {
      const node = doc.createElement(tag);
      node.className = className;
      if (text2 !== void 0) node.textContent = text2;
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
    function button(text2, name, value = "", primary = false) {
      const node = element("button", "model-footer-btn" + (primary ? " primary" : ""), text2);
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
  return __toCommonJS(index_exports);
})();
