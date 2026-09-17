'use strict';
/**
 * Shared plumbing for the vended pi-dish skill CLIs.
 *
 * Installation note: each skill directory is symlinked into
 * ~/.pi/agent/skills/ (see install.sh). Node resolves `require` through the
 * *realpath* of the requiring file, so a script at
 * skills/<skill>/scripts/foo.js reaches this module with
 *   require(path.join(__dirname, '..', '..', 'lib', 'pi-dish-client.js'))
 * even when it was invoked through the symlink. This directory is therefore
 * deliberately not a skill of its own — it ships with the repo and is reached
 * through the link, never installed beside the skills that use it.
 *
 * Zero runtime dependencies, CommonJS, and no server imports: build:edges
 * bundles the portable reference helpers for use outside the repository.
 */
import fs = require('node:fs');
import path = require('node:path');
import os = require('node:os');
import { execFileSync } from 'node:child_process';
import { resolveSessionRefAmong, stableSessionRef } from '../../src/core/helper-refs';


/** Consumed wire fields only. Unconsumed payloads remain opaque. */
export interface SessionFields {
  id?: unknown;
  name?: unknown;
  cwd?: unknown;
  model?: unknown;
  isActive?: unknown;
  turnInProgress?: unknown;
  compacting?: unknown;
  subagentLive?: unknown;
  lastActivity?: unknown;
  searchScore?: unknown;
  matchCount?: unknown;
  snippets?: unknown;
}
export interface SessionRow extends SessionFields { id: string }
export interface SessionCatalog {
  active?: unknown;
  children?: unknown;
  previous?: unknown;
  indexing?: unknown;
  discoveryTruncated?: unknown;
}
export interface SearchResponse { results?: unknown; total?: unknown; indexing?: unknown }
export interface ResolveResponse { session?: unknown; ref?: unknown }
export interface TranscriptPayload {
  session?: unknown; messages?: unknown; totalMessages?: unknown;
  firstIndex?: unknown; lastIndex?: unknown; hasMore?: unknown;
}
interface TranscriptMessage {
  role?: unknown; timestamp?: unknown; toolName?: unknown; isError?: unknown;
  customType?: unknown; content?: unknown; errorMessage?: unknown;
}
interface TranscriptBlock {
  type?: unknown; text?: unknown; thinking?: unknown; name?: unknown; arguments?: unknown;
}
export interface FleetHost {
  name?: unknown;
  label?: unknown;
  hostId?: unknown;
  self?: unknown;
  reachable?: unknown;
  error?: unknown;
  capabilities?: unknown;
}
export interface RegistryEntry {
  sessionId: unknown;
  nativeSessionId?: unknown;
  harnessId?: unknown;
  socketPath?: unknown;
  cwd?: unknown;
  name?: unknown;
  model?: unknown;
  pid?: unknown;
  updatedAt?: unknown;
  turnInProgress?: unknown;
  compacting?: unknown;
  wrapper?: unknown;
  tmux?: unknown;
}
export interface HttpResult { data: unknown; status: number }
export interface TextResult { text: string; status: number }
export interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
}
export interface ParsedRef { hostPart: string | null; hostIdForm: boolean; id: string }
export interface ResolvedHost { host: unknown; entry: FleetHost | null }
export interface ResolvedSession {
  host: unknown;
  id: string;
  session: SessionRow;
  ref?: string | null;
}
export interface SearchBucket { host?: unknown; results?: readonly SessionRow[] | null }
export interface SearchRow { host: unknown; session: SessionRow }
export interface TranscriptOptions { host?: unknown; ref?: string; limit?: number; thinking?: boolean }

/** Preserve native property access: nullish receivers fail; field values stay unknown. */
export function record(value: unknown): Record<string, unknown> {
  if (value == null) throw new TypeError(`Cannot read properties of ${value}`);
  return Object(value);
}
export function errorMessage(value: unknown): string {
  return String(record(value ?? {}).message ?? value);
}
export function errorStatus(value: unknown): unknown { return record(value ?? {}).status; }
export function errorBody(value: unknown): Record<string, unknown> { return record(record(value ?? {}).body ?? {}); }
export function isSessionRow(value: unknown): value is SessionRow {
  return typeof record(value ?? {}).id === 'string' && !!record(value ?? {}).id;
}
export function sessionRows(value: unknown): SessionRow[] {
  return Array.isArray(value) ? value.filter(isSessionRow) : [];
}
/** Fleet arrays are opaque until a particular operation consumes a row. */
export function fleetRows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function fleetHost(value: unknown): FleetHost {
  return record(value);
}
/** Check only when a caller actually invokes a string operation. */
export function stringValue(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new TypeError(message);
  return value;
}
function isRegistryEntry(value: unknown): value is RegistryEntry {
  return !!record(value ?? {}).sessionId;
}
class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) { super(message); }
}

// =========================================================================
// Output helpers
// =========================================================================

/** `fail` bound to one CLI's name, so every error line is attributable. */
function makeFail(name: string) {
  return function fail(message: unknown) {
    process.stderr.write(`${name}: ${message}\n`);
    process.exitCode = 1;
  };
}

function print(value: unknown, json?: boolean) {
  if (json) process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  else if (typeof value === 'string') process.stdout.write(value + '\n');
  else process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

// =========================================================================
// Session discovery (process ancestry → bridge registry)
// =========================================================================

function parentPid(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const match = stat.match(/^\d+ \([\s\S]*\) \S (\d+) /);
    return match ? Number(match[1]) : null;
  } catch {
    // macOS has no /proc; keep the same discovery contract via ps without
    // involving a shell. (The cwd fallback below still works if ps is absent.)
    try {
      const value = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
      return /^\d+$/.test(value) ? Number(value) : null;
    } catch {
      return null;
    }
  }
}

function ancestorPids() {
  const result = new Set<number>();
  let pid: number | null = process.pid;
  while (pid && !result.has(pid)) {
    result.add(pid);
    pid = parentPid(pid);
  }
  return result;
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return record(e).code === 'EPERM';
  }
}

function registryEntries(): RegistryEntry[] {
  const dir = path.join(os.homedir(), '.pi', 'dish', 'sessions');
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((name) => name.endsWith('.json')).flatMap((name) => {
    try {
      const entry: unknown = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (!isRegistryEntry(entry)) return [];
      // Mirror the server's scanRegistry liveness rules (minus its pruning
      // side effects — these CLIs only read): a crashed pi leaves its entry
      // behind, and a dead session must not win cwd fallback or inflate the
      // "N live sessions" count in the ambiguity error.
      if (entry.socketPath && (typeof entry.socketPath !== 'string' || !fs.existsSync(entry.socketPath))) return [];
      if (typeof entry.pid === 'number' && Number.isInteger(entry.pid) && !pidAlive(entry.pid)) return [];
      return [entry];
    } catch {
      return [];
    }
  });
}

/** The id the HTTP routes speak for a registry entry (harness-qualified). */
function registryRouteId(entry: RegistryEntry): unknown {
  const harnessId = record(entry?.wrapper ?? {}).harnessId || entry?.harnessId || 'pi';
  const nativeSessionId = entry?.nativeSessionId || entry?.sessionId;
  if (harnessId === 'pi') return nativeSessionId;
  return '~sk1_' + Buffer.from(JSON.stringify([harnessId, nativeSessionId]), 'utf8').toString('base64url');
}

/** CLI harness inference intentionally accepts a missing native id. The
 * canonical reference decoder instead requires both tuple fields; keep this
 * policy separate so spawn can still inherit a known harness. */
function decodeRouteId(routeId: unknown) {
  const raw = String(routeId || '');
  if (!raw.startsWith('~sk1_')) return null;
  try {
    const tuple: unknown = JSON.parse(Buffer.from(raw.slice(5), 'base64url').toString('utf8'));
    if (!Array.isArray(tuple) || typeof tuple[0] !== 'string' || !tuple[0]) return null;
    return { harnessId: tuple[0], nativeSessionId: typeof tuple[1] === 'string' ? tuple[1] : null };
  } catch { return null; }
}

/**
 * The harness a route id belongs to: an encoded key names it, a bare id is a
 * legacy raw Pi id. `null` means the id cannot answer the question (a
 * truncated or malformed key), so callers must ask instead of guessing.
 */
function sessionHarnessId(routeId: unknown) {
  const raw = String(routeId || '');
  if (!raw) return null;
  if (!raw.startsWith('~sk1_')) return 'pi';
  return decodeRouteId(raw)?.harnessId || null;
}

/** The harness-native session id a route id carries (its own id, for Pi). */
function nativeSessionId(routeId: unknown) {
  const raw = String(routeId || '');
  if (!raw) return null;
  if (!raw.startsWith('~sk1_')) return raw;
  return decodeRouteId(raw)?.nativeSessionId || null;
}

/**
 * Identify the session this CLI is running inside: explicit flag, env stamp,
 * then process ancestry against the bridge registry, then a unique cwd match.
 */
function discoverSession(explicit?: string, options: { noneMessage?: string } = {}): unknown {
  if (explicit) return explicit;
  if (process.env.PI_DISH_SESSION_ID) return process.env.PI_DISH_SESSION_ID;
  const entries = registryEntries();
  const ancestors = ancestorPids();
  const byPid = entries.filter((entry) => typeof entry.pid === 'number' && Number.isInteger(entry.pid) && ancestors.has(entry.pid));
  if (byPid.length) {
    byPid.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return registryRouteId(byPid[0]);
  }
  const cwd = path.resolve(process.cwd());
  const byCwd = entries.filter((entry) => {
    if (!entry.cwd) return false;
    // Let Node reject malformed cwd at this operation, preserving its native
    // error code/message without making cwd a registry-admission condition.
    const resolved: unknown = typeof entry.cwd === 'string'
      ? path.resolve(entry.cwd) : Reflect.apply(path.resolve, path, [entry.cwd]);
    return resolved === cwd;
  });
  if (byCwd.length === 1) return registryRouteId(byCwd[0]);
  if (!entries.length) throw new Error(options.noneMessage || 'no live pi-dish bridge sessions found');
  throw new Error(`could not identify this session; pass --session <id> (${entries.length} live sessions)`);
}

/** Discovery that shrugs instead of throwing (publishing works without an id). */
function discoverSessionQuietly(explicit?: string) {
  try { return discoverSession(explicit) || null; } catch { return null; }
}

// =========================================================================
// HTTP
// =========================================================================

// One token for this server. A `/hosts/<name>` request is still a request to
// the local server: it attaches each peer's own credential when it proxies, so
// the CLI never holds per-host tokens.
const TOKEN = process.env.PI_DISH_TOKEN || '';

function defaultBase(explicit?: string) {
  return explicit || process.env.PI_DISH_URL || 'http://127.0.0.1:3333';
}

function authHeaders(extra?: Record<string, string>) {
  const headers = { ...(extra || {}) };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  return headers;
}

function httpError(status: number, data: unknown, statusText?: string) {
  return new HttpError(String(record(data ?? {}).error || `HTTP ${status}${statusText ? ` ${statusText}` : ''}`), status, data);
}

async function request(base: string, pathname: string, init: RequestOptions = {}): Promise<HttpResult> {
  const response = await fetch(new URL(pathname, base), { ...init, headers: authHeaders(init.headers) });
  let data: unknown;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw httpError(response.status, data);
  return { data, status: response.status };
}

/**
 * Text-mode fetch, for routes that answer markdown (the agent docs). A failing
 * response still gets its JSON error body parsed when it has one — the
 * with-body / bodiless distinction is how capability skew is detected.
 */
async function requestText(base: string, pathname: string, init: RequestOptions = {}): Promise<TextResult> {
  const response = await fetch(new URL(pathname, base), { ...init, headers: authHeaders(init.headers) });
  const text = await response.text();
  if (!response.ok) {
    let data: unknown = null;
    try { data = JSON.parse(text); } catch {}
    throw httpError(response.status, data && typeof data === 'object' ? data : null);
  }
  return { text, status: response.status };
}

// Cross-host reach is only a path prefix: every route the CLIs already speak
// composes behind the local server's /hosts/<name> proxy (TASKS/multi-host.md
// block 6). No host means the local server, exactly as before.
function hostPath(host: unknown, pathname: string) {
  return host ? `/hosts/${encodeURIComponent(String(host))}${pathname}` : pathname;
}

async function api(base: string, host: unknown, pathname: string, init?: RequestOptions): Promise<HttpResult> {
  try {
    return await request(base, hostPath(host, pathname), init);
  } catch (e) {
    // The proxy answers an unconfigured name with a bare 404 (the fleet map is
    // not a discovery surface), so confirm against the fleet before blaming it.
    if (host && errorStatus(e) === 404 && !errorBody(e).error) {
      const unknown = await unknownHostError(base, host);
      if (unknown) throw unknown;
    }
    throw e;
  }
}

async function unknownHostError(base: string, host: unknown) {
  const hosts = await fleetHosts(base);
  if (!hosts) return null;
  const names = hosts.map((entry) => fleetHost(entry).name).filter(Boolean);
  if (names.includes(host)) return null;
  const known = names.length ? names.join(', ') : 'no remotes configured';
  return new Error(`unknown host "${host}" (known: ${known}); run 'hosts' to list the fleet`);
}

function jsonInit(body: unknown, headers: Record<string, string> = {}): RequestOptions {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) };
}

// =========================================================================
// Fleet
// =========================================================================

// Memoized per process: ref resolution, capability gating and `--host`
// validation all want the same list, and a fleet probe is not free.
let fleetPromise: Promise<unknown[] | null> | null = null;
function fleetHosts(base: string): Promise<unknown[] | null> {
  if (!fleetPromise) {
    fleetPromise = request(base, '/api/hosts')
      .then(({ data }) => fleetRows(record(data ?? {}).hosts))
      // A server too old (or too closed) to answer is not an error here: the
      // callers all degrade to capability-absent behaviour.
      .catch(() => null);
  }
  return fleetPromise;
}

function resetFleetCache() { fleetPromise = null; }

/** Absent capability means unsupported — mixed-version fleets are the norm. */
function hostSupports(value: unknown, capability: string) {
  const entry: FleetHost = record(value ?? {});
  return !!(value && entry.capabilities && record(entry.capabilities)[capability]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a session ref. Pure — the host part is only *named* here, resolving it
 * against the fleet needs the server.
 *
 *   8f3ab2c1              → { hostPart: null,    hostIdForm: false, id: '8f3ab2c1' }
 *   tycho/8f3ab2c1        → { hostPart: 'tycho', hostIdForm: false, id: '8f3ab2c1' }
 *   self/8f3ab2c1         → { hostPart: 'self',  hostIdForm: false, id: '8f3ab2c1' }
 *   <uuid>:<sessionId>    → { hostPart: uuid,    hostIdForm: true,  id: '<sessionId>' }
 */
function parseRef(raw: unknown): ParsedRef {
  const ref = String(raw ?? '').trim();
  if (!ref) throw new Error('a session ref is required');
  const slash = ref.indexOf('/');
  if (slash !== -1) {
    const hostPart = ref.slice(0, slash);
    const id = ref.slice(slash + 1);
    if (!hostPart) throw new Error(`invalid ref "${ref}": nothing before the "/" to name a host`);
    if (!id) throw new Error(`invalid ref "${ref}": nothing after the "/" to name a session`);
    return { hostPart, hostIdForm: false, id };
  }
  const colon = ref.indexOf(':');
  if (colon > 0) {
    const head = ref.slice(0, colon);
    const rest = ref.slice(colon + 1);
    // Provenance form. The id part is whole, never a prefix: this ref shape is
    // machine-produced, so a partial match would be a bug, not a shortcut.
    if (UUID_RE.test(head) && rest) return { hostPart: head, hostIdForm: true, id: rest };
  }
  return { hostPart: null, hostIdForm: false, id: ref };
}

function hostLabelOf(value: unknown) {
  if (!value) return null;
  const entry = fleetHost(value);
  if (entry.self) return '(self)';
  return entry.name || entry.label || entry.hostId || null;
}

/**
 * Resolve a ref's host part against this server's fleet: remote name first,
 * then host uuid (exact or an unambiguous ≥8-char prefix), then label. `self`
 * and any match on this host's own entry mean local (no proxy prefix).
 */
async function resolveHostPart(base: string, hostPart: string | null): Promise<ResolvedHost> {
  if (!hostPart) return { host: null, entry: null };
  const hosts = await fleetHosts(base);
  if (hostPart.toLowerCase() === 'self') {
    const entry = hosts ? hosts.find((value) => fleetHost(value).self) : null;
    return { host: null, entry: entry ? fleetHost(entry) : null };
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
    return h.hostId && stringValue(h.hostId, 'h.hostId.toLowerCase is not a function').toLowerCase() === lower;
  });
  if (!entry && lower.length >= 8) {
    const prefixed = hosts.filter((value) => {
      const h = fleetHost(value);
      return h.hostId && stringValue(h.hostId, 'h.hostId.toLowerCase is not a function').toLowerCase().startsWith(lower);
    });
    if (prefixed.length === 1) entry = prefixed[0];
    else if (prefixed.length > 1) {
      throw new Error(`ambiguous host id prefix "${hostPart}" (${prefixed.map(hostLabelOf).join(', ')})`);
    }
  }
  if (!entry) entry = hosts.find((value) => {
    const h = fleetHost(value);
    return h.label && stringValue(h.label, 'h.label.toLowerCase is not a function').toLowerCase() === lower;
  });
  if (!entry) {
    const known = hosts.map((h) => hostLabelOf(h)).filter(Boolean).join(', ') || 'none';
    throw new Error(`unknown host "${hostPart}" (known: ${known}); run 'hosts' to list the fleet`);
  }
  const resolved = fleetHost(entry);
  return { host: resolved.self ? null : resolved.name, entry: resolved };
}

/** The fleet entry a `--host NAME` flag names, when the fleet is readable. */
async function entryForHostName(base: string, host: unknown): Promise<FleetHost | null> {
  if (!host) {
    const hosts = await fleetHosts(base);
    const entry = hosts ? hosts.find((h) => fleetHost(h).self) : null;
    return entry ? fleetHost(entry) : null;
  }
  const hosts = await fleetHosts(base);
  const entry = hosts ? hosts.find((h) => fleetHost(h).name === host) : null;
  return entry ? fleetHost(entry) : null;
}

function ambiguousRefError(ref: unknown, matches: readonly SessionRow[] | null | undefined) {
  const lines = (matches || []).map((m) => {
    const state = m.isActive ? 'active' : 'inactive';
    return `  ${m.id}\t${state}\t${m.name || 'Unnamed'}\t${m.cwd || ''}`;
  });
  return new Error(
    `ambiguous session id prefix "${ref}" — ${matches?.length || 0} sessions match; use a longer prefix or the full id:\n`
    + lines.join('\n'),
  );
}

function sessionCatalog(data: unknown) {
  const catalog: SessionCatalog = record(data ?? {});
  const list = [...sessionRows(catalog.active), ...sessionRows(catalog.previous)];
  const byId = new Map<string, SessionRow>();
  for (const session of list) if (session?.id && !byId.has(session.id)) byId.set(session.id, session);
  return byId;
}

/**
 * Client-side ref resolution: for hosts that predate GET
 * /api/sessions/resolve, and for hosts whose resolver predates ref aliases —
 * resolving locally turns a short alias into the full route id the host does
 * understand, so short refs work across a mixed-version fleet.
 */
async function resolveSessionClientSide(base: string, host: unknown, id: string, exactOnly?: boolean): Promise<SessionRow> {
  const { data } = await api(base, host, '/api/sessions');
  const catalog = [...sessionCatalog(data).values()];
  if (!exactOnly && String(id).length < 4) throw new Error('id prefix must be at least 4 characters');
  const { session, matches } = resolveSessionRefAmong(catalog, id, { exactOnly });
  if (session) return session;
  if (matches.length > 1) throw ambiguousRefError(id, matches);
  throw new Error(`Session not found: ${id}`);
}

/**
 * Resolve a ref to `{ host, id, session, ref }`. A full id resolves to
 * itself, so existing callers passing bare ids are unaffected; `ref` is the
 * short handle the owning host recommends for it, when it serves one.
 */
async function resolveSessionRef(base: string, rawRef: unknown, hostFlag?: string | null): Promise<ResolvedSession> {
  const ref = parseRef(rawRef);
  let host: unknown = hostFlag || null;
  let entry: FleetHost | null = null;

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
    // A --host name is deliberately *not* pre-validated here: an unknown one
    // still has to reach the proxy so the "unknown host" message comes from
    // the same place it always did.
    entry = await entryForHostName(base, host);
  }

  if (hostSupports(entry, 'resolve')) {
    try {
      const response = await api(base, host, `/api/sessions/resolve?id=${encodeURIComponent(ref.id)}`);
      const data: ResolveResponse = record(response.data ?? {});
      if (isSessionRow(data.session)) {
        // The provenance form is machine-produced and whole: the server's
        // prefix matching must not turn a stale recorded id into a
        // near-miss on some other session.
        if (ref.hostIdForm && data.session.id !== ref.id) throw new Error(`Session not found: ${ref.id}`);
        return { host, id: data.session.id, session: data.session, ref: typeof data.ref === 'string' ? data.ref : null };
      }
    } catch (e) {
      // A JSON error body is the host's own verdict — not found, or ambiguous.
      if (errorBody(e).error) {
        if (Array.isArray(errorBody(e).matches)) throw ambiguousRefError(ref.id, sessionRows(errorBody(e).matches));
        // …except a miss on a host whose resolver predates ref aliases, which
        // cannot expand a native id or uuid tail. Resolve it here instead.
        if (errorStatus(e) !== 404 || hostSupports(entry, 'refAliases')) throw e;
      }
      // A bodiless 404 is version skew, not a missing session: fall through.
      if (errorStatus(e) !== 404) throw e;
    }
  }
  const session = await resolveSessionClientSide(base, host, ref.id, ref.hostIdForm);
  return { host, id: session.id, session };
}

// =========================================================================
// Fleet search merge (pure)
// =========================================================================

function activityMs(value: unknown) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Merge per-host search results into one ranked list. The client is the
 * aggregator (TASKS/multi-host.md) — there is no server-side merged endpoint,
 * and there must not be one.
 *
 * `hostResults`: [{ host: '(self)' | 'tycho', results: [session, …] }, …]
 * Returns: [{ host, session }, …] sorted by searchScore desc, then (for the
 * unscored tail, which sorts after every scored row) by lastActivity desc.
 */
function mergeSearchResults(hostResults: readonly SearchBucket[] | null | undefined, limit?: number): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const bucket of hostResults || []) {
    for (const session of bucket?.results || []) {
      if (session) rows.push({ host: bucket.host ?? null, session });
    }
  }
  rows.sort((a, b) => {
    const scoreA = typeof a.session.searchScore === 'number' && Number.isFinite(a.session.searchScore) ? a.session.searchScore : null;
    const scoreB = typeof b.session.searchScore === 'number' && Number.isFinite(b.session.searchScore) ? b.session.searchScore : null;
    if ((scoreA === null) !== (scoreB === null)) return scoreA === null ? 1 : -1;
    if (scoreA !== null && scoreB !== null && scoreA !== scoreB) return scoreB - scoreA;
    return activityMs(b.session.lastActivity) - activityMs(a.session.lastActivity);
  });
  const max = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : rows.length;
  return rows.slice(0, max);
}

// =========================================================================
// Transcript rendering (pure)
// =========================================================================

// Same priority as the session index's tool-arg extraction: the args a coding
// session is recognised by come first, so a bulky `oldText` cannot crowd out
// the path it edits.
const TOOL_ARG_PRIORITY = new Set([
  'path', 'file_path', 'filename', 'file', 'cwd', 'command', 'cmd',
  'url', 'pattern', 'query',
]);

function oneLine(value: unknown) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number) {
  return text.length > max ? text.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : text;
}

function summarizeToolArgs(args: unknown, max = 120) {
  if (!args || typeof args !== 'object') return '';
  const first: string[] = [];
  const rest: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value == null) continue;
    let text;
    if (typeof value === 'string') text = value;
    else if (typeof value === 'object') text = Array.isArray(value) ? `[${value.length} items]` : '{…}';
    else text = String(value);
    text = oneLine(text);
    if (!text) continue;
    (TOOL_ARG_PRIORITY.has(key) ? first : rest).push(`${key}=${text}`);
  }
  return clip(first.concat(rest).join(' '), max);
}

function truncateResult(text: unknown, maxLines = 8, maxChars = 600) {
  const source = String(text ?? '');
  const lines = source.split('\n');
  let body = lines.slice(0, maxLines).join('\n');
  let omitted = Math.max(0, lines.length - maxLines);
  if (body.length > maxChars) {
    const cut = body.slice(0, maxChars);
    omitted = Math.max(omitted, lines.length - cut.split('\n').length);
    body = cut.trimEnd() + '…';
  }
  return omitted > 0 ? `${body}\n… (+${omitted} more lines)` : body;
}

function shortId(id: unknown) {
  const value = String(id || '');
  return value.length > 12 ? value.slice(0, 12) : value;
}

function stamp(value: unknown) {
  if (value == null) return '';
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

const ROLE_HEADINGS: Readonly<Record<string, string>> = {
  user: 'user',
  assistant: 'assistant',
  toolResult: 'tool result',
  branchSummary: 'branch summary',
  custom: 'custom',
};

/**
 * Render a /messages payload as readable markdown. Pure: everything it needs
 * is in `payload` (the resolved list entry merged with the route's own
 * `session`) and `options`.
 */
function renderTranscript(input: unknown, options: TranscriptOptions = {}) {
  const payload: TranscriptPayload = record(input ?? {});
  const session: SessionFields = record(payload.session ?? {});
  const messages: unknown[] = Array.isArray(payload.messages) ? payload.messages : [];
  const out = [];
  const name = session.name || 'Unnamed session';
  out.push(`# ${name} (${shortId(session.id)})`);
  if (options.host) out.push(`- host: ${options.host}`);
  out.push(`- id: ${session.id || ''}`);
  if (session.cwd) out.push(`- cwd: ${session.cwd}`);
  if (session.model) out.push(`- model: ${session.model}`);
  out.push(`- state: ${session.isActive ? 'active' : 'inactive'}`);
  if (session.lastActivity) out.push(`- last activity: ${stamp(session.lastActivity) || session.lastActivity}`);
  const total = payload?.totalMessages;
  if (Number.isFinite(total)) {
    const range = Number.isFinite(payload.firstIndex) && Number.isFinite(payload.lastIndex)
      ? ` (indexes ${payload.firstIndex}–${payload.lastIndex})` : '';
    out.push(`- messages: ${messages.length} of ${total}${range}`);
  }

  if (!messages.length) {
    out.push('', '_No messages in this window._');
    return out.join('\n') + '\n';
  }

  for (const value of messages) {
    const message: TranscriptMessage = record(value);
    const heading = ROLE_HEADINGS[String(message.role)] || message.role || 'message';
    const when = stamp(message.timestamp);
    const extra = [];
    if (message.role === 'toolResult' && message.toolName) extra.push(message.toolName);
    if (message.isError) extra.push('error');
    if (message.role === 'custom' && message.customType) extra.push(message.customType);
    const suffix = extra.length ? ` [${extra.join(' · ')}]` : '';
    out.push('', `## ${heading}${suffix}${when ? ` · ${when}` : ''}`);

    const body = [];
    const content: unknown[] = Array.isArray(message.content) ? message.content : [];
    for (const value of content) {
      if (!value || typeof value !== 'object') continue;
      const block: TranscriptBlock = record(value);
      if (block.type === 'text') {
        const text = String(block.text ?? '');
        if (message.role === 'toolResult') body.push(truncateResult(text));
        else if (text.trim()) body.push(text.replace(/\s+$/, ''));
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        // Reasoning is verbose and rarely what a reader came for.
        if (!options.thinking) continue;
        const text = String(block.thinking ?? block.text ?? '');
        body.push(['<thinking>', text.replace(/\s+$/, ''), '</thinking>'].join('\n'));
      } else if (block.type === 'toolCall') {
        // Mirror the web summary for prime's kernel tool: bash('...') wraps
        // shell work; otherwise the first code line carries the intent.
        let args = summarizeToolArgs(block.arguments);
        const code = record(block.arguments ?? {}).code;
        if (block.name === 'ipython' && typeof code === 'string') {
          const m = /(?:^|[^A-Za-z0-9_])bash\(\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(code);
          const inner = m ? m[2].replace(/\\(['"\\])/g, '$1') : code.split('\n')[0];
          args = oneLine(inner).slice(0, 120);
        }
        body.push(`⚙ ${block.name || 'tool'}${args ? `: ${args}` : ''}`);
      } else if (block.type === 'image') {
        body.push('[image]');
      }
    }
    if (message.errorMessage) body.push(`! ${oneLine(message.errorMessage)}`);
    if (body.length) out.push(body.join('\n\n'));
    else out.push('_(no displayable content)_');
  }

  if (payload.hasMore && typeof payload.firstIndex === 'number' && Number.isFinite(payload.firstIndex) && payload.firstIndex > 0) {
    const ref = options.ref || session.id || '<ref>';
    const limit = options.limit || messages.length;
    const older = payload.firstIndex;
    out.push('', `— ${older} older message${older === 1 ? '' : 's'}. Page back with: read ${ref} --limit ${limit} --before ${older}`);
  }
  return out.join('\n') + '\n';
}

export {
  // output
  makeFail, print,
  // discovery
  parentPid, ancestorPids, pidAlive, registryEntries, registryRouteId, sessionHarnessId, nativeSessionId,
  discoverSession, discoverSessionQuietly,
  // http
  TOKEN, defaultBase, request, requestText, hostPath, api, unknownHostError, jsonInit,
  // fleet + refs
  fleetHosts, resetFleetCache, hostSupports, hostLabelOf, parseRef, resolveHostPart,
  entryForHostName, resolveSessionRef, resolveSessionClientSide,
  stableSessionRef,
  // pure helpers (unit-tested in test/skills-core.test.js)
  mergeSearchResults, renderTranscript, summarizeToolArgs, truncateResult,
};
