// Generated from src/browser/; edit sources and run npm run build:browser.
var PiDishHelpers = (() => {
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

  // src/browser/shared-helpers.ts
  var shared_helpers_exports = {};
  __export(shared_helpers_exports, {
    HOST_COLOR_SLOTS: () => HOST_COLOR_SLOTS,
    OMP_MODEL_ROLES: () => OMP_MODEL_ROLES,
    OMP_ROLE_THINKING_LEVELS: () => OMP_ROLE_THINKING_LEVELS,
    RELATION_KIND_ORDER: () => RELATION_KIND_ORDER,
    THINKING_LEVEL_NAMES: () => THINKING_LEVEL_NAMES,
    aggregateUsageWeekly: () => aggregateUsageWeekly,
    appendSessionRefContext: () => appendSessionRefContext,
    applyHostTerms: () => applyHostTerms,
    applyLocalFilter: () => applyLocalFilter,
    assignHostColor: () => assignHostColor,
    buildModelRoleRows: () => buildModelRoleRows,
    buildSessionFamilies: () => buildSessionFamilies,
    buildSnippet: () => buildSnippet,
    buildSnippets: () => buildSnippets,
    buildWorkspaceTree: () => buildWorkspaceTree,
    collectTreeSessions: () => collectTreeSessions,
    composeModelRoleRef: () => composeModelRoleRef,
    contextClass: () => contextClass,
    createFanoutRenderQueue: () => createFanoutRenderQueue,
    createMathExtensions: () => createMathExtensions,
    decodeRouteSessionId: () => decodeRouteSessionId,
    diagramKindForFence: () => diagramKindForFence,
    diffStatusClass: () => diffStatusClass,
    escapeHtml: () => escapeHtml,
    evaluateSessionQuery: () => evaluateSessionQuery,
    extractImageBlocks: () => extractImageBlocks,
    extractTextBlocks: () => extractTextBlocks,
    extractTextContent: () => extractTextContent,
    filenameFromContentDisposition: () => filenameFromContentDisposition,
    findPathTokens: () => findPathTokens,
    flattenSessionFamilies: () => flattenSessionFamilies,
    formatCacheStat: () => formatCacheStat,
    formatDuration: () => formatDuration,
    formatEstimatedCost: () => formatEstimatedCost,
    formatLimitReset: () => formatLimitReset,
    formatModelRef: () => formatModelRef,
    formatModelRoleSummary: () => formatModelRoleSummary,
    formatRelativeTime: () => formatRelativeTime,
    formatResponseMetadata: () => formatResponseMetadata,
    formatRuntime: () => formatRuntime,
    formatSessionRefContext: () => formatSessionRefContext,
    formatTime: () => formatTime,
    formatTokSpeed: () => formatTokSpeed,
    formatTokens: () => formatTokens,
    formatUsageCost: () => formatUsageCost,
    formatUsageDay: () => formatUsageDay,
    fuzzyMatch: () => fuzzyMatch,
    fuzzyScore: () => fuzzyScore,
    getToolOutputText: () => getToolOutputText,
    getToolSummary: () => getToolSummary,
    groupByWorkspace: () => groupByWorkspace,
    groupRelations: () => groupRelations,
    groupSessionsByDate: () => groupSessionsByDate,
    harnessBadgeInfo: () => harnessBadgeInfo,
    highlightFuzzy: () => highlightFuzzy,
    highlightTokens: () => highlightTokens,
    hostDisplayLabel: () => hostDisplayLabel,
    hostSectionKey: () => hostSectionKey,
    hostSupportsCapability: () => hostSupportsCapability,
    hostSupportsTerminal: () => hostSupportsTerminal,
    insertAtCaret: () => insertAtCaret,
    isAutomationSession: () => isAutomationSession,
    isChildRelation: () => isChildRelation,
    isDarkColorHex: () => isDarkColorHex,
    isModelEnabled: () => isModelEnabled,
    isUnreadSession: () => isUnreadSession,
    looksLikeFilePath: () => looksLikeFilePath,
    looksLikeMermaid: () => looksLikeMermaid,
    mergeUsageLimits: () => mergeUsageLimits,
    mergeUsageSummaries: () => mergeUsageSummaries,
    mermaidDeclarationLine: () => mermaidDeclarationLine,
    messageHasVisibleText: () => messageHasVisibleText,
    modelMatchesPattern: () => modelMatchesPattern,
    modelRoleLevels: () => modelRoleLevels,
    niceTicks: () => niceTicks,
    normalizeMood: () => normalizeMood,
    parseIpythonResult: () => parseIpythonResult,
    parseModelId: () => parseModelId,
    parseModelRoleRef: () => parseModelRoleRef,
    parseSessionKey: () => parseSessionKey,
    parseSessionQuery: () => parseSessionQuery,
    parseSessionRefParts: () => parseSessionRefParts,
    parseSessionRefTokens: () => parseSessionRefTokens,
    partitionPinned: () => partitionPinned,
    partitionPinnedFamilies: () => partitionPinnedFamilies,
    positiveQueryTokens: () => positiveQueryTokens,
    pushPromptHistory: () => pushPromptHistory,
    queryAsksForAutomation: () => queryAsksForAutomation,
    renderDiffHtml: () => renderDiffHtml,
    resolveSessionRefAmong: () => resolveSessionRefAmong,
    rgbStringToHex: () => rgbStringToHex,
    sanitizeHostColorOrder: () => sanitizeHostColorOrder,
    sanitizeHostColors: () => sanitizeHostColors,
    sanitizeMarkdownUrl: () => sanitizeMarkdownUrl,
    scoreSessionMatch: () => scoreSessionMatch,
    searchSessionsForRef: () => searchSessionsForRef,
    sessionKey: () => sessionKey,
    sessionMetaText: () => sessionMetaText,
    sessionRef: () => sessionRef,
    sessionRefAliases: () => sessionRefAliases,
    sessionRefKey: () => sessionRefKey,
    sessionSupports: () => sessionSupports,
    shortCwd: () => shortCwd,
    shortModelName: () => shortModelName,
    shortSessionRef: () => shortSessionRef,
    sortHostSections: () => sortHostSections,
    sortRelations: () => sortRelations,
    splitSessionRefContext: () => splitSessionRefContext,
    stableSessionRef: () => stableSessionRef,
    stripAnsi: () => stripAnsi,
    stripQueryField: () => stripQueryField,
    sttUnavailableReason: () => sttUnavailableReason,
    thinkingLevelsFor: () => thinkingLevelsFor,
    tmuxPrefixSeq: () => tmuxPrefixSeq,
    truncate: () => truncate,
    uniqueSessionPrefix: () => uniqueSessionPrefix,
    usageLimitsHtml: () => usageLimitsHtml,
    usageUnattributedCost: () => usageUnattributedCost
  });

  // src/browser/helper-values.ts
  function record(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function timestampMillis(value) {
    return new Date(value === void 0 ? NaN : value === null ? 0 : value).getTime();
  }

  // src/browser/helper-format.ts
  function escapeHtml(text) {
    if (text == null || text === "") return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function stripAnsi(text) {
    if (text == null || text === "") return "";
    return String(text).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "").replace(/\x1b\[[0-9;:?]*[ -\/]*[@-~]/g, "").replace(/\x1b[ -\/]*./g, "");
  }
  function formatTokens(tokens) {
    if (!tokens || tokens === 0) return "0";
    if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`;
    if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)}k`;
    return `${tokens}`;
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
    if (!finite(rate) || rate <= 0) return null;
    return (rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10) + " tok/s";
  }
  function formatEstimatedCost(value, digits = 4) {
    if (!finite(value)) return "Unavailable";
    if (value === 0) return "~$0";
    const precision = value < 1e-4 ? Math.max(digits, 6) : value < 0.01 ? Math.max(digits, 4) : 2;
    return `~$${value.toFixed(precision)}`;
  }
  function formatUsageCost(value, unavailable = 0) {
    const formatted = formatEstimatedCost(value);
    return finite(value) && unavailable ? `${formatted}*` : formatted;
  }
  function formatResponseMetadata(msg, mode = "compact") {
    if (!msg || mode === "hidden") return null;
    const usage = msg.usage || {};
    const speed = formatTokSpeed(msg.outputTokens || usage.output, msg.durationMs);
    const tokens = usage.output ? `${formatTokens(usage.output)} out` : null;
    const elapsed = finite(msg.durationMs) && msg.durationMs > 0 ? `${msg.durationMs < 1e4 ? (msg.durationMs / 1e3).toFixed(1) : Math.round(msg.durationMs / 1e3)}s` : null;
    if (mode === "compact") return speed || tokens;
    const performance = [elapsed, speed].filter(Boolean).join(" \xB7 ");
    if (mode === "performance-cost") {
      const cost = msg.pricingKnown !== false && finite(usage.cost?.total) ? formatEstimatedCost(usage.cost.total) : null;
      return [performance, cost].filter(Boolean).join(" \xB7 ") || tokens;
    }
    return performance || tokens;
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
  function truncate(text, maxLen, suffix = " \u2026 (truncated)") {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, maxLen) + suffix;
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
  function pushPromptHistory(list, message, cap) {
    const out = Array.isArray(list) ? list.filter((value) => typeof value === "string") : [];
    const msg = String(message || "").trim();
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
  function insertAtCaret(value, selectionStart, selectionEnd, text) {
    const source = typeof value === "string" ? value : "";
    const insert = typeof text === "string" ? text : "";
    const max = source.length;
    let start = finite(selectionStart) ? Math.max(0, Math.min(max, selectionStart)) : max;
    let end = finite(selectionEnd) ? Math.max(0, Math.min(max, selectionEnd)) : start;
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
  function filenameFromContentDisposition(header, fallback) {
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
    return fallback;
  }

  // src/browser/helper-content.ts
  function extractTextContent(content) {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const blocks = content;
      return blocks.map((c) => typeof c === "string" ? c : record(c) && c.type === "text" && typeof c.text === "string" ? c.text : "").join("\n");
    }
    return "";
  }
  function extractTextBlocks(content) {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const blocks = content;
    return blocks.filter((c) => typeof c === "string" || record(c) && c.type === "text").map((c) => typeof c === "string" ? c : record(c) && typeof c.text === "string" ? c.text : "").join("\n");
  }
  function ipythonCodeSummary(code) {
    if (typeof code !== "string" || !code) return "";
    const m = /(?:^|[^A-Za-z0-9_])bash\(\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(code);
    const inner = m ? m[2].replace(/\\(['"\\])/g, "$1") : code.split("\n")[0];
    return truncate(inner, 60);
  }
  function getToolSummary(toolName, args) {
    if (!record(args)) return "";
    if (toolName === "Bash" || toolName === "bash") return typeof args.command === "string" && args.command ? truncate(args.command.split("\n")[0], 60) : "";
    if (toolName === "ipython") return ipythonCodeSummary(args.code);
    if (["Read", "read", "Edit", "edit", "Write", "write"].includes(toolName)) return typeof args.path === "string" ? args.path : "";
    const keys = Object.keys(args);
    if (keys.length) return truncate(String(args[keys[0]]), 40);
    return "";
  }
  function parseIpythonResult(text) {
    if (typeof text !== "string") return null;
    const m = /^BashResult\(exit_code=(-?\d+), output=(['"])((?:\\.|(?!\2).)*)\2(?:, duration=([0-9.eE+-]+))?\)\s*$/.exec(text);
    if (!m) return null;
    return { exitCode: Number(m[1]), output: pythonReprUnescape(m[3]), durationMs: m[4] != null ? Math.round(Number(m[4]) * 1e3) : null };
  }
  function pythonReprUnescape(text) {
    return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (all, seq) => {
      if (seq[0] === "x") return String.fromCharCode(parseInt(seq.slice(1), 16));
      if (seq[0] === "u") return String.fromCharCode(parseInt(seq.slice(1), 16));
      const map = { n: "\n", t: "	", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0", "\n": "" };
      return Object.hasOwn(map, seq) ? map[seq] : seq;
    });
  }
  function messageHasVisibleText(msg) {
    if (!record(msg)) return false;
    if (msg.errorMessage) return true;
    if (typeof msg.content === "string") return !!msg.content;
    return Array.isArray(msg.content) && msg.content.some((b) => record(b) && b.type === "text" && typeof b.text === "string" && !!b.text);
  }
  function getToolOutputText(partialResult) {
    if (!record(partialResult) || !Array.isArray(partialResult.content)) return "";
    const blocks = partialResult.content;
    return blocks.filter((c) => record(c) && c.type === "text").map((c) => typeof c.text === "string" ? c.text : "").join("");
  }
  function extractImageBlocks(content) {
    if (!Array.isArray(content)) return [];
    const out = [];
    const blocks = content;
    for (const block of blocks) {
      if (!record(block) || block.type !== "image") continue;
      const mimeType = typeof block.mimeType === "string" && block.mimeType ? block.mimeType : "image/png";
      if (typeof block.url === "string" && block.url) out.push({ url: block.url, mimeType });
      else if (typeof block.data === "string" && block.data) out.push({ data: block.data, mimeType });
    }
    return out;
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
  function hostSupportsTerminal(hostEntry, config) {
    return hostSupportsCapability(hostEntry, "terminal", config);
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
      if (!finite(t) || t <= 0) return { key: "undated", label: "Undated" };
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
    const timestampOf = (item) => finite(item?.activity) ? item.activity : new Date(item?.lastActivity || 0).getTime();
    const sorted = [...list].sort((a, b) => timestampOf(b) - timestampOf(a));
    const buckets = /* @__PURE__ */ new Map();
    for (const s of sorted) {
      const b = bucketOf(timestampOf(s));
      let bucket = buckets.get(b.key);
      if (!bucket) {
        bucket = { ...b, sessions: [] };
        buckets.set(b.key, bucket);
      }
      bucket.sessions.push(s);
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
      let cursor = parent;
      const seen = /* @__PURE__ */ new Set();
      let cyclic = false;
      while (cursor && !seen.has(cursor)) {
        if (cursor === node) {
          cyclic = true;
          break;
        }
        seen.add(cursor);
        const next = nodes.get(sessionKey(cursor.session.host, sessionFamilyParentId(cursor.session)));
        cursor = next && (next.session.cwd || "~") === (cursor.session.cwd || "~") ? next : null;
      }
      if (cyclic) continue;
      parent.children.push(node);
      attached.add(sessionRefKey(node.session));
    }
    const activityMs = (session) => {
      const value = new Date(session.lastActivity || 0).getTime();
      return finite(value) ? value : 0;
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
  function partitionPinned(list, pinnedIds) {
    if (!pinnedIds || pinnedIds.length === 0) return [[], list];
    const byId = new Map(list.map((s) => [s.id, s]));
    const pinned = pinnedIds.map((id) => byId.get(id)).filter((value) => value !== void 0);
    const pinnedSet = new Set(pinned.map((s) => s.id));
    return [pinned, list.filter((s) => !pinnedSet.has(s.id))];
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
      return finite(t) ? t : null;
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
  function countOccurrences(text, token) {
    if (!text || !token) return 0;
    let n = 0, i = text.indexOf(token);
    while (i !== -1) {
      n++;
      i = text.indexOf(token, i + token.length);
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
  function buildSnippet(text, tokens, radius = 60) {
    return buildSnippets(text, tokens, { radius, max: 1 }).snippets[0] || "";
  }
  function buildSnippets(text, tokens, { radius = 60, max = 4 } = {}) {
    const valid = tokens.filter(Boolean);
    if (!valid.length) return { snippets: [], count: 0 };
    let count = 0;
    for (const t of valid) {
      let i = text.indexOf(t);
      while (i !== -1) {
        count++;
        i = text.indexOf(t, i + t.length);
      }
    }
    const snippets = [];
    let from = 0;
    while (snippets.length < max) {
      let at = -1, tokenLen = 0;
      for (const t of valid) {
        const i = text.indexOf(t, from);
        if (i !== -1 && (at === -1 || i < at)) {
          at = i;
          tokenLen = t.length;
        }
      }
      if (at === -1) break;
      let start = Math.max(snippets.length ? from : 0, at - radius);
      let end = Math.min(text.length, at + tokenLen + radius);
      if (start > 0) {
        const ws = text.indexOf(" ", start);
        if (ws !== -1 && ws < at) start = ws + 1;
      }
      if (end < text.length) {
        const ws = text.lastIndexOf(" ", end);
        if (ws >= at + tokenLen) end = ws;
      }
      snippets.push((start > 0 ? "\u2026" : "") + text.slice(start, end).trim() + (end < text.length ? "\u2026" : ""));
      from = end + 1;
    }
    return { snippets, count };
  }
  function highlightTokens(text, tokens) {
    const str = String(text);
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
  function resolveSessionRefAmong(sessions, ref, options) {
    const needle = String(ref == null ? "" : ref);
    if (!needle) return { session: null, matches: [] };
    const byId = /* @__PURE__ */ new Map();
    for (const session of sessions || []) {
      if (session && session.id && !byId.has(session.id)) byId.set(session.id, session);
    }
    const entries = [...byId.values()].map((session) => ({ session, aliases: sessionRefAliases(session.id) }));
    const stages = [
      (entry) => entry.session.id === needle,
      (entry) => entry.aliases.includes(needle),
      (entry) => entry.session.id.startsWith(needle),
      (entry) => entry.aliases.some((alias) => alias.startsWith(needle))
    ];
    const depth = options && options.exactOnly ? 2 : stages.length;
    let candidates = [];
    for (let stage = 0; stage < depth; stage++) {
      const matches = entries.filter(stages[stage]).map((entry) => entry.session);
      if (matches.length === 1) return { session: matches[0], matches };
      if (matches.length && !candidates.length) candidates = matches;
    }
    return { session: null, matches: candidates };
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
  function stableSessionRef(id, peerIds, minLen = 8) {
    const self = String(id == null ? "" : id);
    if (!self) return "";
    const ref = shortSessionRef(self, peerIds, minLen);
    if (ref === self) return self;
    return sessionRefAliases(self).slice(1).some((alias) => alias.startsWith(ref)) ? ref : self;
  }
  function sessionRef(session, host, prefix) {
    const id = typeof session === "string" ? session : session && session.id || "";
    if (typeof id !== "string" || !id) return "";
    const short = typeof prefix === "string" && prefix ? prefix : id.slice(0, 8);
    if (!host || typeof host !== "object") return short;
    if (host.self === true || host.base === "") return short;
    if (host.name) return `${host.name}/${short}`;
    if (host.hostId) return `${host.hostId}:${id}`;
    return short;
  }
  var SESSION_REF_TOKEN_RE = /(?:^|[\s(\[{<"'])#([A-Za-z0-9][A-Za-z0-9._:/-]{3,})/g;
  function parseSessionRefTokens(text) {
    const out = [];
    if (!text) return out;
    const seen = /* @__PURE__ */ new Set();
    SESSION_REF_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = SESSION_REF_TOKEN_RE.exec(String(text))) !== null) {
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
  function sessionRefField(value) {
    return String(value == null ? "" : value).replace(/[\r\n|<>]+/g, " ").trim().slice(0, 200);
  }
  function formatSessionRefContext(entries) {
    const rows = [];
    for (const entry of entries || []) {
      const ref = sessionRefField(entry && entry.ref);
      if (!ref) continue;
      const fields = [`ref=${ref}`];
      const name = sessionRefField(entry.name);
      if (name) fields.push(`name=${name}`);
      const host = sessionRefField(entry.host);
      if (host) fields.push(`host=${host}`);
      if (entry.isActive != null) fields.push(`active=${entry.isActive ? "yes" : "no"}`);
      const cwd = sessionRefField(entry.cwd);
      if (cwd) fields.push(`cwd=${cwd}`);
      rows.push("- " + fields.join(" | "));
    }
    if (!rows.length) return "";
    return `<session-refs>
${SESSION_REF_PREAMBLE}
${rows.join("\n")}
</session-refs>`;
  }
  function appendSessionRefContext(text, entries) {
    const body = String(text == null ? "" : text);
    const block = formatSessionRefContext(entries);
    if (!block) return body;
    return body ? `${body}

${block}` : block;
  }
  function splitSessionRefContext(text) {
    const body = String(text == null ? "" : text);
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

  // src/browser/helper-usage.ts
  var USAGE_MERGE_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite", "total"];
  var USAGE_MERGE_TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
  function createFanoutRenderQueue(states, render, delayMs = 100) {
    let timer;
    return () => {
      clearTimeout(timer);
      if (states.every((state) => state !== "pending")) render();
      else timer = setTimeout(render, delayMs);
    };
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
      if (finite(value)) {
        to.costs[k] = (finite(to.costs[k]) ? to.costs[k] : 0) + value;
      }
    }
    for (const k of ["calls", "measured", "durationMs"]) to[k] += from[k] || 0;
    to.slowestMs = Math.max(to.slowestMs, from.slowestMs || 0);
    return to;
  }
  function pricedUsageFields(bucket) {
    bucket.unpricedCalls = bucket.costUnavailable?.total || 0;
    bucket.priced = !bucket.unpricedCalls;
    return bucket;
  }
  function usageDisplayTokens(tokens) {
    return (tokens?.input || 0) + (tokens?.output || 0) + (tokens?.cacheRead || 0) + (tokens?.cacheWrite || 0);
  }
  function usageUnattributedCost(costs) {
    if (!finite(costs?.total)) return 0;
    const attributed = ["input", "output", "cacheRead", "cacheWrite"].reduce((sum, key) => sum + (finite(costs[key]) ? costs[key] : 0), 0);
    return Math.max(0, costs.total - attributed);
  }
  function compareUsageBuckets(a, b, sort) {
    if (sort === "tokens") return usageDisplayTokens(b.tokens) - usageDisplayTokens(a.tokens) || b.calls - a.calls;
    const aKnown = finite(a.costs?.total), bKnown = finite(b.costs?.total);
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
        if (finite(value)) {
          headlineCosts[key] = (finite(headlineCosts[key]) ? headlineCosts[key] : 0) + value;
        }
      }
      for (const [key, costs] of Object.entries(summary.headlineCostsByBucket || {})) {
        headlineKeys.add(key);
        const row = headlineCostsByBucket[key] || (headlineCostsByBucket[key] = emptyCosts());
        for (const k of USAGE_MERGE_COST_KEYS) if (finite(costs?.[k])) row[k] += costs[k];
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
          if (finite(model.cost)) {
            row.cost = (finite(row.cost) ? row.cost : 0) + model.cost;
          }
        }
      }
      for (const bucket of summary.groups?.models || []) {
        if (!bucket || !bucket.key) continue;
        let row = models.get(bucket.key);
        if (!row) {
          row = { key: bucket.key, provider: bucket.provider, model: bucket.model, ...emptyMergedUsage() };
          models.set(bucket.key, row);
        }
        addMergedUsage(row, bucket);
      }
      for (const bucket of summary.groups?.workspaces || []) {
        if (!bucket || bucket.key == null) continue;
        const key = hostId + " " + bucket.key;
        let row = workspaces.get(key);
        if (!row) {
          row = { key: bucket.key, host: hostId, hostLabel, ...emptyMergedUsage() };
          workspaces.set(key, row);
        }
        addMergedUsage(row, bucket);
      }
      for (const bucket of summary.groups?.sessions || []) {
        if (!bucket || bucket.id == null) continue;
        const key = hostId + " " + bucket.id;
        let row = sessionRows.get(key);
        if (!row) {
          row = { ...bucket, host: hostId, hostLabel, ...emptyMergedUsage() };
          sessionRows.set(key, row);
        }
        addMergedUsage(row, bucket);
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
      models: [...slot.models.values()].sort((a, b) => Number(finite(b.cost)) - Number(finite(a.cost)) || (finite(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls)
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
    if (!finite(max) || max <= 0) return { step: 1, top: 1, ticks: [0, 1] };
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
          if (finite(value)) {
            agg.costs[k] = (finite(agg.costs[k]) ? agg.costs[k] : 0) + value;
          }
        }
        for (const dm of d.models || []) {
          const t = models.get(dm.ref) || { ref: dm.ref, provider: dm.provider, model: dm.model, calls: 0, cost: 0, costUnavailable: { total: 0 }, tokens: emptyTokens() };
          t.calls += dm.calls || 0;
          t.costUnavailable.total = (t.costUnavailable.total || 0) + (dm.costUnavailable?.total || 0);
          if (finite(dm.cost)) {
            t.cost = (finite(t.cost) ? t.cost : 0) + dm.cost;
          }
          for (const k of tokenKeys) t.tokens[k] += dm.tokens?.[k] || 0;
          models.set(dm.ref, t);
        }
      }
      agg.models = [...models.values()].sort((a, b) => Number(finite(b.cost)) - Number(finite(a.cost)) || (finite(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls);
      out.unshift(agg);
    }
    return out;
  }
  function formatLimitReset(resetsAt, now = Date.now()) {
    const ms = Number(resetsAt) - now;
    if (!finite(ms) || ms <= 0) return "now";
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

  // src/browser/helper-models.ts
  function parseModelId(fullModelId) {
    const slashIdx = fullModelId.indexOf("/");
    if (slashIdx > 0) {
      return { provider: fullModelId.slice(0, slashIdx), id: fullModelId.slice(slashIdx + 1) };
    }
    return { provider: "", id: fullModelId };
  }
  function formatModelRef(model) {
    if (!model) return null;
    if (typeof model === "string") return model;
    const provider = model.provider;
    const id = model.id || model.modelId;
    return provider && id ? `${provider}/${id}` : null;
  }
  var THINKING_LEVEL_NAMES = ["off", "minimal", "low", "medium", "high", "xhigh"];
  function stripThinkingSuffix(pattern) {
    const idx = pattern.lastIndexOf(":");
    if (idx === -1) return pattern;
    const suffix = pattern.slice(idx + 1).toLowerCase();
    return THINKING_LEVEL_NAMES.includes(suffix) ? pattern.slice(0, idx) : pattern;
  }
  var OMP_THINKING_LEVEL_NAMES = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"];
  function thinkingLevelsFor(harnessId, model) {
    if (harnessId !== "omp") return THINKING_LEVEL_NAMES;
    const supported = Array.isArray(model?.thinking) && model.thinking.length ? model.thinking : OMP_THINKING_LEVEL_NAMES.slice(0, -1);
    return [.../* @__PURE__ */ new Set(["off", ...supported, "auto"])];
  }
  var OMP_ROLE_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"];
  function parseModelRoleRef(value, knownSelectors) {
    const ref = typeof value === "string" ? value.trim() : "";
    if (!ref) return { model: "", level: "" };
    if (Array.isArray(knownSelectors) && knownSelectors.includes(ref)) return { model: ref, level: "" };
    const idx = ref.lastIndexOf(":");
    if (idx > 0) {
      const suffix = ref.slice(idx + 1).toLowerCase();
      if (suffix === "inherit") return { model: ref.slice(0, idx), level: "" };
      if (OMP_ROLE_THINKING_LEVELS.includes(suffix)) return { model: ref.slice(0, idx), level: suffix };
    }
    return { model: ref, level: "" };
  }
  function composeModelRoleRef(model, level) {
    const ref = typeof model === "string" ? model.trim() : "";
    if (!ref) return "";
    return level && level !== "inherit" ? `${ref}:${level}` : ref;
  }
  function modelRoleLevels(model) {
    const supported = Array.isArray(model?.thinking) && model.thinking.length ? model.thinking : OMP_THINKING_LEVEL_NAMES.slice(0, -1);
    return [.../* @__PURE__ */ new Set(["off", "auto", ...supported])];
  }
  function globToRegExp(glob) {
    const source = glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    try {
      return new RegExp("^" + source + "$", "i");
    } catch {
      return null;
    }
  }
  function modelMatchesPattern(pattern, model) {
    const patternText = stripThinkingSuffix(String(pattern || ""));
    if (!patternText || !model || !model.id) return false;
    const fullId = (model.provider ? model.provider + "/" : "") + model.id;
    if (/[*?[]/.test(patternText)) {
      const re = globToRegExp(patternText);
      return !!re && (re.test(fullId) || re.test(model.id));
    }
    const p = patternText.toLowerCase();
    const id = model.id.toLowerCase();
    return p === fullId.toLowerCase() || p === id || id.startsWith(p + "-");
  }
  function isModelEnabled(patterns, model) {
    if (!Array.isArray(patterns) || patterns.length === 0) return true;
    const values = patterns;
    return values.some((p) => modelMatchesPattern(p, model));
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
  function buildModelRoleRows(globalRoles, effectiveRoles) {
    const global = modelRoleRecord(globalRoles);
    const effective = modelRoleRecord(effectiveRoles);
    const row = (key, name, description, custom) => {
      const value = Object.hasOwn(global, key) ? global[key] : "";
      const effectiveValue = Object.hasOwn(effective, key) ? effective[key] : "";
      return {
        key,
        name,
        description,
        custom,
        value,
        effectiveValue,
        override: effectiveValue && effectiveValue !== value ? effectiveValue : null
      };
    };
    const canonical = new Set(OMP_MODEL_ROLES.map((role) => role.key));
    return [
      ...OMP_MODEL_ROLES.map((role) => row(role.key, role.name, role.description, false)),
      ...Object.keys(global).filter((key) => !canonical.has(key)).sort().map((key) => row(key, key, "Custom role", true))
    ];
  }
  function formatModelRoleSummary(roles, limit = 4) {
    const record2 = modelRoleRecord(roles);
    const order = OMP_MODEL_ROLES.map((role) => role.key);
    const rank = (key) => order.indexOf(key) < 0 ? order.length : order.indexOf(key);
    const entries = Object.keys(record2).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((key) => `${key} ${record2[key]}`);
    if (!entries.length) return "No roles assigned";
    const shown = entries.slice(0, limit);
    const rest = entries.length - shown.length;
    return shown.join(" \xB7 ") + (rest > 0 ? ` \xB7 +${rest} more` : "");
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
  function mermaidDeclarationLine(text) {
    const lines = String(text == null ? "" : text).split("\n");
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
  function looksLikeMermaid(text) {
    const decl = mermaidDeclarationLine(text);
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
          const text = match[1] !== void 0 ? match[1] : match[2];
          return {
            type: "blockMath",
            raw: match[0],
            text: text.trim()
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
  function looksLikeFilePath(text) {
    const s = String(text == null ? "" : text).trim();
    if (!s || s.length > 260) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false;
    if (!FILE_MENTION_RE.test(s)) return false;
    const stripped = s.replace(/:\d+(?::\d+)?$/, "");
    return stripped.includes("/") || FILE_EXT_RE.test(stripped);
  }
  var PATH_TOKEN_RE = /(?:~\/|\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?/g;
  var BARE_EXT_STOPLIST = /* @__PURE__ */ new Set(["com", "org", "net", "io", "ai", "dev", "co", "app"]);
  function findPathTokens(text) {
    const s = String(text == null ? "" : text);
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
  return __toCommonJS(shared_helpers_exports);
})();
if (typeof module !== "undefined" && module.exports) module.exports = PiDishHelpers; else Object.assign(globalThis, PiDishHelpers);
