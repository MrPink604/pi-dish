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
    createHarnessDiscovery: () => createHarnessDiscovery,
    createHostConnections: () => createHostConnections,
    createHostDiscovery: () => createHostDiscovery,
    createHostSessionLoader: () => createHostSessionLoader,
    createHostTransport: () => createHostTransport,
    createSessionApi: () => createSessionApi,
    createSessionState: () => createSessionState,
    decodeHostDescriptor: () => decodeHostDescriptor,
    decodeModelCatalog: () => decodeModelCatalog,
    hostConnReduce: () => hostConnReduce,
    hostKeyOf: () => hostKeyOf,
    mergeHostEntries: () => mergeHostEntries,
    modelCatalogUrl: () => modelCatalogUrl,
    mountModelSelector: () => mountModelSelector,
    mountThinkingSelector: () => mountThinkingSelector,
    normalizeHostBase: () => normalizeHostBase,
    sanitizeHostCatalog: () => sanitizeHostCatalog,
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
    function element(tag, className, text3) {
      const node = doc.createElement(tag);
      node.className = className;
      if (text3 !== void 0) node.textContent = text3;
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
    function button(text3, name, value = "", primary = false) {
      const node = element("button", "model-footer-btn" + (primary ? " primary" : ""), text3);
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
      const text3 = String(typeof value === "object" && "message" in value && value.message || value);
      return text3 || null;
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
    async function loadFleet() {
      fleetRequestedAt = now();
      const sequence = ++fleetSequence;
      try {
        const response = await options.request(null, "/api/hosts", { timeoutMs: 1e4 });
        if (!response.ok) return;
        const data = await response.json();
        if (sequence !== fleetSequence || !record2(data) || !Array.isArray(data.hosts)) return;
        const rows = data.hosts;
        const hosts = rows.filter(record2);
        options.onFleet({ hosts: hosts.filter((host) => !host.self), selfLabel: hosts.find((host) => host.self)?.label });
        await identify(true);
        if (sequence === fleetSequence) options.afterFleet();
      } catch {
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
  return __toCommonJS(index_exports);
})();
