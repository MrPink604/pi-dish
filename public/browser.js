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
    decodeModelCatalog: () => decodeModelCatalog,
    modelCatalogUrl: () => modelCatalogUrl,
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
  return __toCommonJS(index_exports);
})();
