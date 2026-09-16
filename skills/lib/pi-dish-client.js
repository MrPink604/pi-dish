// Generated edge from skills/lib/pi-dish-client.ts; edit that source and run npm run build:edges.
"use strict";
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

// skills/lib/pi-dish-client.ts
var pi_dish_client_exports = {};
__export(pi_dish_client_exports, {
  TOKEN: () => TOKEN,
  ancestorPids: () => ancestorPids,
  api: () => api,
  defaultBase: () => defaultBase,
  discoverSession: () => discoverSession,
  discoverSessionQuietly: () => discoverSessionQuietly,
  entryForHostName: () => entryForHostName,
  errorBody: () => errorBody,
  errorMessage: () => errorMessage,
  errorStatus: () => errorStatus,
  fleetHost: () => fleetHost,
  fleetHosts: () => fleetHosts,
  fleetRows: () => fleetRows,
  hostLabelOf: () => hostLabelOf,
  hostPath: () => hostPath,
  hostSupports: () => hostSupports,
  isSessionRow: () => isSessionRow,
  jsonInit: () => jsonInit,
  makeFail: () => makeFail,
  mergeSearchResults: () => mergeSearchResults,
  nativeSessionId: () => nativeSessionId,
  parentPid: () => parentPid,
  parseRef: () => parseRef,
  pidAlive: () => pidAlive,
  print: () => print,
  record: () => record,
  registryEntries: () => registryEntries,
  registryRouteId: () => registryRouteId,
  renderTranscript: () => renderTranscript,
  request: () => request,
  requestText: () => requestText,
  resetFleetCache: () => resetFleetCache,
  resolveHostPart: () => resolveHostPart,
  resolveSessionClientSide: () => resolveSessionClientSide,
  resolveSessionRef: () => resolveSessionRef,
  sessionHarnessId: () => sessionHarnessId,
  sessionRows: () => sessionRows,
  stableSessionRef: () => stableSessionRef,
  stringValue: () => stringValue,
  summarizeToolArgs: () => summarizeToolArgs,
  truncateResult: () => truncateResult,
  unknownHostError: () => unknownHostError
});
module.exports = __toCommonJS(pi_dish_client_exports);
var import_node_child_process = require("node:child_process");

// src/core/helper-refs.ts
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
var SESSION_REF_PREAMBLE = [
  "The message above references other pi-dish sessions by `#ref`. Each is a real",
  "peer session, not a label: use the pi-dish-sessions skill CLI to read its",
  "transcript (`read <ref>`) or to message it (`send` / `steer` / `follow-up`",
  "<ref>). Never guess what a referenced session holds \u2014 read it."
].join("\n");

// skills/lib/pi-dish-client.ts
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
function record(value) {
  if (value == null) throw new TypeError(`Cannot read properties of ${value}`);
  return Object(value);
}
function errorMessage(value) {
  return String(record(value ?? {}).message ?? value);
}
function errorStatus(value) {
  return record(value ?? {}).status;
}
function errorBody(value) {
  return record(record(value ?? {}).body ?? {});
}
function isSessionRow(value) {
  return typeof record(value ?? {}).id === "string" && !!record(value ?? {}).id;
}
function sessionRows(value) {
  return Array.isArray(value) ? value.filter(isSessionRow) : [];
}
function fleetRows(value) {
  return Array.isArray(value) ? value : [];
}
function fleetHost(value) {
  return record(value);
}
function stringValue(value, message) {
  if (typeof value !== "string") throw new TypeError(message);
  return value;
}
function isRegistryEntry(value) {
  return !!record(value ?? {}).sessionId;
}
var HttpError = class extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
  status;
  body;
};
function makeFail(name) {
  return function fail(message) {
    process.stderr.write(`${name}: ${message}
`);
    process.exitCode = 1;
  };
}
function print(value, json) {
  if (json) process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  else if (typeof value === "string") process.stdout.write(value + "\n");
  else process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
function parentPid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const match = stat.match(/^\d+ \([\s\S]*\) \S (\d+) /);
    return match ? Number(match[1]) : null;
  } catch {
    try {
      const value = (0, import_node_child_process.execFileSync)("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim();
      return /^\d+$/.test(value) ? Number(value) : null;
    } catch {
      return null;
    }
  }
}
function ancestorPids() {
  const result = /* @__PURE__ */ new Set();
  let pid = process.pid;
  while (pid && !result.has(pid)) {
    result.add(pid);
    pid = parentPid(pid);
  }
  return result;
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return record(e).code === "EPERM";
  }
}
function registryEntries() {
  const dir = path.join(os.homedir(), ".pi", "dish", "sessions");
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(".json")).flatMap((name) => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (!isRegistryEntry(entry)) return [];
      if (entry.socketPath && (typeof entry.socketPath !== "string" || !fs.existsSync(entry.socketPath))) return [];
      if (typeof entry.pid === "number" && Number.isInteger(entry.pid) && !pidAlive(entry.pid)) return [];
      return [entry];
    } catch {
      return [];
    }
  });
}
function registryRouteId(entry) {
  const harnessId = record(entry?.wrapper ?? {}).harnessId || entry?.harnessId || "pi";
  const nativeSessionId2 = entry?.nativeSessionId || entry?.sessionId;
  if (harnessId === "pi") return nativeSessionId2;
  return "~sk1_" + Buffer.from(JSON.stringify([harnessId, nativeSessionId2]), "utf8").toString("base64url");
}
function decodeRouteId(routeId) {
  const raw = String(routeId || "");
  if (!raw.startsWith("~sk1_")) return null;
  try {
    const tuple = JSON.parse(Buffer.from(raw.slice(5), "base64url").toString("utf8"));
    if (!Array.isArray(tuple) || typeof tuple[0] !== "string" || !tuple[0]) return null;
    return { harnessId: tuple[0], nativeSessionId: typeof tuple[1] === "string" ? tuple[1] : null };
  } catch {
    return null;
  }
}
function sessionHarnessId(routeId) {
  const raw = String(routeId || "");
  if (!raw) return null;
  if (!raw.startsWith("~sk1_")) return "pi";
  return decodeRouteId(raw)?.harnessId || null;
}
function nativeSessionId(routeId) {
  const raw = String(routeId || "");
  if (!raw) return null;
  if (!raw.startsWith("~sk1_")) return raw;
  return decodeRouteId(raw)?.nativeSessionId || null;
}
function discoverSession(explicit, options = {}) {
  if (explicit) return explicit;
  if (process.env.PI_DISH_SESSION_ID) return process.env.PI_DISH_SESSION_ID;
  const entries = registryEntries();
  const ancestors = ancestorPids();
  const byPid = entries.filter((entry) => typeof entry.pid === "number" && Number.isInteger(entry.pid) && ancestors.has(entry.pid));
  if (byPid.length) {
    byPid.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return registryRouteId(byPid[0]);
  }
  const cwd = path.resolve(process.cwd());
  const byCwd = entries.filter((entry) => {
    if (!entry.cwd) return false;
    const resolved = typeof entry.cwd === "string" ? path.resolve(entry.cwd) : Reflect.apply(path.resolve, path, [entry.cwd]);
    return resolved === cwd;
  });
  if (byCwd.length === 1) return registryRouteId(byCwd[0]);
  if (!entries.length) throw new Error(options.noneMessage || "no live pi-dish bridge sessions found");
  throw new Error(`could not identify this session; pass --session <id> (${entries.length} live sessions)`);
}
function discoverSessionQuietly(explicit) {
  try {
    return discoverSession(explicit) || null;
  } catch {
    return null;
  }
}
var TOKEN = process.env.PI_DISH_TOKEN || "";
function defaultBase(explicit) {
  return explicit || process.env.PI_DISH_URL || "http://127.0.0.1:3333";
}
function authHeaders(extra) {
  const headers = { ...extra || {} };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  return headers;
}
function httpError(status, data, statusText) {
  return new HttpError(String(record(data ?? {}).error || `HTTP ${status}${statusText ? ` ${statusText}` : ""}`), status, data);
}
async function request(base, pathname, init = {}) {
  const response = await fetch(new URL(pathname, base), { ...init, headers: authHeaders(init.headers) });
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw httpError(response.status, data);
  return { data, status: response.status };
}
async function requestText(base, pathname, init = {}) {
  const response = await fetch(new URL(pathname, base), { ...init, headers: authHeaders(init.headers) });
  const text = await response.text();
  if (!response.ok) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
    }
    throw httpError(response.status, data && typeof data === "object" ? data : null);
  }
  return { text, status: response.status };
}
function hostPath(host, pathname) {
  return host ? `/hosts/${encodeURIComponent(String(host))}${pathname}` : pathname;
}
async function api(base, host, pathname, init) {
  try {
    return await request(base, hostPath(host, pathname), init);
  } catch (e) {
    if (host && errorStatus(e) === 404 && !errorBody(e).error) {
      const unknown = await unknownHostError(base, host);
      if (unknown) throw unknown;
    }
    throw e;
  }
}
async function unknownHostError(base, host) {
  const hosts = await fleetHosts(base);
  if (!hosts) return null;
  const names = hosts.map((entry) => fleetHost(entry).name).filter(Boolean);
  if (names.includes(host)) return null;
  const known = names.length ? names.join(", ") : "no remotes configured";
  return new Error(`unknown host "${host}" (known: ${known}); run 'hosts' to list the fleet`);
}
function jsonInit(body, headers = {}) {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body || {}) };
}
var fleetPromise = null;
function fleetHosts(base) {
  if (!fleetPromise) {
    fleetPromise = request(base, "/api/hosts").then(({ data }) => fleetRows(record(data ?? {}).hosts)).catch(() => null);
  }
  return fleetPromise;
}
function resetFleetCache() {
  fleetPromise = null;
}
function hostSupports(value, capability) {
  const entry = record(value ?? {});
  return !!(value && entry.capabilities && record(entry.capabilities)[capability]);
}
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseRef(raw) {
  const ref = String(raw ?? "").trim();
  if (!ref) throw new Error("a session ref is required");
  const slash = ref.indexOf("/");
  if (slash !== -1) {
    const hostPart = ref.slice(0, slash);
    const id = ref.slice(slash + 1);
    if (!hostPart) throw new Error(`invalid ref "${ref}": nothing before the "/" to name a host`);
    if (!id) throw new Error(`invalid ref "${ref}": nothing after the "/" to name a session`);
    return { hostPart, hostIdForm: false, id };
  }
  const colon = ref.indexOf(":");
  if (colon > 0) {
    const head = ref.slice(0, colon);
    const rest = ref.slice(colon + 1);
    if (UUID_RE.test(head) && rest) return { hostPart: head, hostIdForm: true, id: rest };
  }
  return { hostPart: null, hostIdForm: false, id: ref };
}
function hostLabelOf(value) {
  if (!value) return null;
  const entry = fleetHost(value);
  if (entry.self) return "(self)";
  return entry.name || entry.label || entry.hostId || null;
}
async function resolveHostPart(base, hostPart) {
  if (!hostPart) return { host: null, entry: null };
  const hosts = await fleetHosts(base);
  if (hostPart.toLowerCase() === "self") {
    const entry2 = hosts ? hosts.find((value) => fleetHost(value).self) : null;
    return { host: null, entry: entry2 ? fleetHost(entry2) : null };
  }
  if (!hosts) {
    throw new Error(`cannot resolve host "${hostPart}": this server did not answer /api/hosts`);
  }
  const lower = hostPart.toLowerCase();
  let entry = hosts.find((value) => {
    const h = fleetHost(value);
    return h.name && h.name === hostPart;
  });
  if (!entry) entry = hosts.find((value) => {
    const h = fleetHost(value);
    return h.hostId && stringValue(h.hostId, "h.hostId.toLowerCase is not a function").toLowerCase() === lower;
  });
  if (!entry && lower.length >= 8) {
    const prefixed = hosts.filter((value) => {
      const h = fleetHost(value);
      return h.hostId && stringValue(h.hostId, "h.hostId.toLowerCase is not a function").toLowerCase().startsWith(lower);
    });
    if (prefixed.length === 1) entry = prefixed[0];
    else if (prefixed.length > 1) {
      throw new Error(`ambiguous host id prefix "${hostPart}" (${prefixed.map(hostLabelOf).join(", ")})`);
    }
  }
  if (!entry) entry = hosts.find((value) => {
    const h = fleetHost(value);
    return h.label && stringValue(h.label, "h.label.toLowerCase is not a function").toLowerCase() === lower;
  });
  if (!entry) {
    const known = hosts.map((h) => hostLabelOf(h)).filter(Boolean).join(", ") || "none";
    throw new Error(`unknown host "${hostPart}" (known: ${known}); run 'hosts' to list the fleet`);
  }
  const resolved = fleetHost(entry);
  return { host: resolved.self ? null : resolved.name, entry: resolved };
}
async function entryForHostName(base, host) {
  if (!host) {
    const hosts2 = await fleetHosts(base);
    const entry2 = hosts2 ? hosts2.find((h) => fleetHost(h).self) : null;
    return entry2 ? fleetHost(entry2) : null;
  }
  const hosts = await fleetHosts(base);
  const entry = hosts ? hosts.find((h) => fleetHost(h).name === host) : null;
  return entry ? fleetHost(entry) : null;
}
function ambiguousRefError(ref, matches) {
  const lines = (matches || []).map((m) => {
    const state = m.isActive ? "active" : "inactive";
    return `  ${m.id}	${state}	${m.name || "Unnamed"}	${m.cwd || ""}`;
  });
  return new Error(
    `ambiguous session id prefix "${ref}" \u2014 ${matches?.length || 0} sessions match; use a longer prefix or the full id:
` + lines.join("\n")
  );
}
function sessionCatalog(data) {
  const catalog = record(data ?? {});
  const list = [...sessionRows(catalog.active), ...sessionRows(catalog.previous)];
  const byId = /* @__PURE__ */ new Map();
  for (const session of list) if (session?.id && !byId.has(session.id)) byId.set(session.id, session);
  return byId;
}
async function resolveSessionClientSide(base, host, id, exactOnly) {
  const { data } = await api(base, host, "/api/sessions");
  const catalog = [...sessionCatalog(data).values()];
  if (!exactOnly && String(id).length < 4) throw new Error("id prefix must be at least 4 characters");
  const { session, matches } = resolveSessionRefAmong(catalog, id, { exactOnly });
  if (session) return session;
  if (matches.length > 1) throw ambiguousRefError(id, matches);
  throw new Error(`Session not found: ${id}`);
}
async function resolveSessionRef(base, rawRef, hostFlag) {
  const ref = parseRef(rawRef);
  let host = hostFlag || null;
  let entry = null;
  if (ref.hostPart) {
    const resolved = await resolveHostPart(base, ref.hostPart);
    if (hostFlag) {
      const flagEntry = await entryForHostName(base, hostFlag);
      const flagHost = flagEntry && flagEntry.self ? null : hostFlag;
      if (flagHost !== resolved.host) {
        throw new Error(`ref "${rawRef}" names host "${ref.hostPart}" but --host ${hostFlag} was also given`);
      }
    }
    host = resolved.host;
    entry = resolved.entry;
  } else {
    entry = await entryForHostName(base, host);
  }
  if (hostSupports(entry, "resolve")) {
    try {
      const response = await api(base, host, `/api/sessions/resolve?id=${encodeURIComponent(ref.id)}`);
      const data = record(response.data ?? {});
      if (isSessionRow(data.session)) {
        if (ref.hostIdForm && data.session.id !== ref.id) throw new Error(`Session not found: ${ref.id}`);
        return { host, id: data.session.id, session: data.session, ref: typeof data.ref === "string" ? data.ref : null };
      }
    } catch (e) {
      if (errorBody(e).error) {
        if (Array.isArray(errorBody(e).matches)) throw ambiguousRefError(ref.id, sessionRows(errorBody(e).matches));
        if (errorStatus(e) !== 404 || hostSupports(entry, "refAliases")) throw e;
      }
      if (errorStatus(e) !== 404) throw e;
    }
  }
  const session = await resolveSessionClientSide(base, host, ref.id, ref.hostIdForm);
  return { host, id: session.id, session };
}
function activityMs(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
function mergeSearchResults(hostResults, limit) {
  const rows = [];
  for (const bucket of hostResults || []) {
    for (const session of bucket?.results || []) {
      if (session) rows.push({ host: bucket.host ?? null, session });
    }
  }
  rows.sort((a, b) => {
    const scoreA = typeof a.session.searchScore === "number" && Number.isFinite(a.session.searchScore) ? a.session.searchScore : null;
    const scoreB = typeof b.session.searchScore === "number" && Number.isFinite(b.session.searchScore) ? b.session.searchScore : null;
    if (scoreA === null !== (scoreB === null)) return scoreA === null ? 1 : -1;
    if (scoreA !== null && scoreB !== null && scoreA !== scoreB) return scoreB - scoreA;
    return activityMs(b.session.lastActivity) - activityMs(a.session.lastActivity);
  });
  const max = typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : rows.length;
  return rows.slice(0, max);
}
var TOOL_ARG_PRIORITY = /* @__PURE__ */ new Set([
  "path",
  "file_path",
  "filename",
  "file",
  "cwd",
  "command",
  "cmd",
  "url",
  "pattern",
  "query"
]);
function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}
function clip(text, max) {
  return text.length > max ? text.slice(0, Math.max(0, max - 1)).trimEnd() + "\u2026" : text;
}
function summarizeToolArgs(args, max = 120) {
  if (!args || typeof args !== "object") return "";
  const first = [];
  const rest = [];
  for (const [key, value] of Object.entries(args)) {
    if (value == null) continue;
    let text;
    if (typeof value === "string") text = value;
    else if (typeof value === "object") text = Array.isArray(value) ? `[${value.length} items]` : "{\u2026}";
    else text = String(value);
    text = oneLine(text);
    if (!text) continue;
    (TOOL_ARG_PRIORITY.has(key) ? first : rest).push(`${key}=${text}`);
  }
  return clip(first.concat(rest).join(" "), max);
}
function truncateResult(text, maxLines = 8, maxChars = 600) {
  const source = String(text ?? "");
  const lines = source.split("\n");
  let body = lines.slice(0, maxLines).join("\n");
  let omitted = Math.max(0, lines.length - maxLines);
  if (body.length > maxChars) {
    const cut = body.slice(0, maxChars);
    omitted = Math.max(omitted, lines.length - cut.split("\n").length);
    body = cut.trimEnd() + "\u2026";
  }
  return omitted > 0 ? `${body}
\u2026 (+${omitted} more lines)` : body;
}
function shortId(id) {
  const value = String(id || "");
  return value.length > 12 ? value.slice(0, 12) : value;
}
function stamp(value) {
  if (value == null) return "";
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";
}
var ROLE_HEADINGS = {
  user: "user",
  assistant: "assistant",
  toolResult: "tool result",
  branchSummary: "branch summary",
  custom: "custom"
};
function renderTranscript(input, options = {}) {
  const payload = record(input ?? {});
  const session = record(payload.session ?? {});
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const out = [];
  const name = session.name || "Unnamed session";
  out.push(`# ${name} (${shortId(session.id)})`);
  if (options.host) out.push(`- host: ${options.host}`);
  out.push(`- id: ${session.id || ""}`);
  if (session.cwd) out.push(`- cwd: ${session.cwd}`);
  if (session.model) out.push(`- model: ${session.model}`);
  out.push(`- state: ${session.isActive ? "active" : "inactive"}`);
  if (session.lastActivity) out.push(`- last activity: ${stamp(session.lastActivity) || session.lastActivity}`);
  const total = payload?.totalMessages;
  if (Number.isFinite(total)) {
    const range = Number.isFinite(payload.firstIndex) && Number.isFinite(payload.lastIndex) ? ` (indexes ${payload.firstIndex}\u2013${payload.lastIndex})` : "";
    out.push(`- messages: ${messages.length} of ${total}${range}`);
  }
  if (!messages.length) {
    out.push("", "_No messages in this window._");
    return out.join("\n") + "\n";
  }
  for (const value of messages) {
    const message = record(value);
    const heading = ROLE_HEADINGS[String(message.role)] || message.role || "message";
    const when = stamp(message.timestamp);
    const extra = [];
    if (message.role === "toolResult" && message.toolName) extra.push(message.toolName);
    if (message.isError) extra.push("error");
    if (message.role === "custom" && message.customType) extra.push(message.customType);
    const suffix = extra.length ? ` [${extra.join(" \xB7 ")}]` : "";
    out.push("", `## ${heading}${suffix}${when ? ` \xB7 ${when}` : ""}`);
    const body = [];
    const content = Array.isArray(message.content) ? message.content : [];
    for (const value2 of content) {
      if (!value2 || typeof value2 !== "object") continue;
      const block = record(value2);
      if (block.type === "text") {
        const text = String(block.text ?? "");
        if (message.role === "toolResult") body.push(truncateResult(text));
        else if (text.trim()) body.push(text.replace(/\s+$/, ""));
      } else if (block.type === "thinking" || block.type === "redacted_thinking") {
        if (!options.thinking) continue;
        const text = String(block.thinking ?? block.text ?? "");
        body.push(["<thinking>", text.replace(/\s+$/, ""), "</thinking>"].join("\n"));
      } else if (block.type === "toolCall") {
        let args = summarizeToolArgs(block.arguments);
        const code = record(block.arguments ?? {}).code;
        if (block.name === "ipython" && typeof code === "string") {
          const m = /(?:^|[^A-Za-z0-9_])bash\(\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(code);
          const inner = m ? m[2].replace(/\\(['"\\])/g, "$1") : code.split("\n")[0];
          args = oneLine(inner).slice(0, 120);
        }
        body.push(`\u2699 ${block.name || "tool"}${args ? `: ${args}` : ""}`);
      } else if (block.type === "image") {
        body.push("[image]");
      }
    }
    if (message.errorMessage) body.push(`! ${oneLine(message.errorMessage)}`);
    if (body.length) out.push(body.join("\n\n"));
    else out.push("_(no displayable content)_");
  }
  if (payload.hasMore && typeof payload.firstIndex === "number" && Number.isFinite(payload.firstIndex) && payload.firstIndex > 0) {
    const ref = options.ref || session.id || "<ref>";
    const limit = options.limit || messages.length;
    const older = payload.firstIndex;
    out.push("", `\u2014 ${older} older message${older === 1 ? "" : "s"}. Page back with: read ${ref} --limit ${limit} --before ${older}`);
  }
  return out.join("\n") + "\n";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TOKEN,
  ancestorPids,
  api,
  defaultBase,
  discoverSession,
  discoverSessionQuietly,
  entryForHostName,
  errorBody,
  errorMessage,
  errorStatus,
  fleetHost,
  fleetHosts,
  fleetRows,
  hostLabelOf,
  hostPath,
  hostSupports,
  isSessionRow,
  jsonInit,
  makeFail,
  mergeSearchResults,
  nativeSessionId,
  parentPid,
  parseRef,
  pidAlive,
  print,
  record,
  registryEntries,
  registryRouteId,
  renderTranscript,
  request,
  requestText,
  resetFleetCache,
  resolveHostPart,
  resolveSessionClientSide,
  resolveSessionRef,
  sessionHarnessId,
  sessionRows,
  stableSessionRef,
  stringValue,
  summarizeToolArgs,
  truncateResult,
  unknownHostError
});
