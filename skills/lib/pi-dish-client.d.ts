// Generated edge from skills/lib/pi-dish-client.ts; edit that source and run npm run build:edges.
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
export interface SessionRow extends SessionFields {
    id: string;
}
export interface SessionCatalog {
    active?: unknown;
    children?: unknown;
    previous?: unknown;
    indexing?: unknown;
    discoveryTruncated?: unknown;
}
export interface SearchResponse {
    results?: unknown;
    total?: unknown;
    indexing?: unknown;
}
export interface ResolveResponse {
    session?: unknown;
    ref?: unknown;
}
export interface TranscriptPayload {
    session?: unknown;
    messages?: unknown;
    totalMessages?: unknown;
    firstIndex?: unknown;
    lastIndex?: unknown;
    hasMore?: unknown;
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
export interface HttpResult {
    data: unknown;
    status: number;
}
export interface TextResult {
    text: string;
    status: number;
}
export interface RequestOptions extends Omit<RequestInit, 'headers'> {
    headers?: Record<string, string>;
}
export interface ParsedRef {
    hostPart: string | null;
    hostIdForm: boolean;
    id: string;
}
export interface ResolvedHost {
    host: unknown;
    entry: FleetHost | null;
}
export interface ResolvedSession {
    host: unknown;
    id: string;
    session: SessionRow;
    ref?: string | null;
}
export interface SearchBucket {
    host?: unknown;
    results?: readonly SessionRow[] | null;
}
export interface SearchRow {
    host: unknown;
    session: SessionRow;
}
export interface TranscriptOptions {
    host?: unknown;
    ref?: string;
    limit?: number;
    thinking?: boolean;
}
/** Preserve native property access: nullish receivers fail; field values stay unknown. */
export declare function record(value: unknown): Record<string, unknown>;
export declare function errorMessage(value: unknown): string;
export declare function errorStatus(value: unknown): unknown;
export declare function errorBody(value: unknown): Record<string, unknown>;
export declare function isSessionRow(value: unknown): value is SessionRow;
export declare function sessionRows(value: unknown): SessionRow[];
/** Fleet arrays are opaque until a particular operation consumes a row. */
export declare function fleetRows(value: unknown): unknown[];
export declare function fleetHost(value: unknown): FleetHost;
/** Check only when a caller actually invokes a string operation. */
export declare function stringValue(value: unknown, message: string): string;
/** `fail` bound to one CLI's name, so every error line is attributable. */
declare function makeFail(name: string): (message: unknown) => void;
declare function print(value: unknown, json?: boolean): void;
declare function parentPid(pid: number): number | null;
declare function ancestorPids(): Set<number>;
declare function pidAlive(pid: number): boolean;
declare function registryEntries(): RegistryEntry[];
/** The id the HTTP routes speak for a registry entry (harness-qualified). */
declare function registryRouteId(entry: RegistryEntry): unknown;
/**
 * The harness a route id belongs to: an encoded key names it, a bare id is a
 * legacy raw Pi id. `null` means the id cannot answer the question (a
 * truncated or malformed key), so callers must ask instead of guessing.
 */
declare function sessionHarnessId(routeId: unknown): string | null;
/** The harness-native session id a route id carries (its own id, for Pi). */
declare function nativeSessionId(routeId: unknown): string | null;
/**
 * Identify the session this CLI is running inside: explicit flag, env stamp,
 * then process ancestry against the bridge registry, then a unique cwd match.
 */
declare function discoverSession(explicit?: string, options?: {
    noneMessage?: string;
}): unknown;
/** Discovery that shrugs instead of throwing (publishing works without an id). */
declare function discoverSessionQuietly(explicit?: string): {} | null;
declare const TOKEN: string;
declare function defaultBase(explicit?: string): string;
declare function request(base: string, pathname: string, init?: RequestOptions): Promise<HttpResult>;
/**
 * Text-mode fetch, for routes that answer markdown (the agent docs). A failing
 * response still gets its JSON error body parsed when it has one — the
 * with-body / bodiless distinction is how capability skew is detected.
 */
declare function requestText(base: string, pathname: string, init?: RequestOptions): Promise<TextResult>;
declare function hostPath(host: unknown, pathname: string): string;
declare function api(base: string, host: unknown, pathname: string, init?: RequestOptions): Promise<HttpResult>;
declare function unknownHostError(base: string, host: unknown): Promise<Error | null>;
declare function jsonInit(body: unknown, headers?: Record<string, string>): RequestOptions;
declare function fleetHosts(base: string): Promise<unknown[] | null>;
declare function resetFleetCache(): void;
/** Absent capability means unsupported — mixed-version fleets are the norm. */
declare function hostSupports(value: unknown, capability: string): boolean;
/**
 * Parse a session ref. Pure — the host part is only *named* here, resolving it
 * against the fleet needs the server.
 *
 *   8f3ab2c1              → { hostPart: null,    hostIdForm: false, id: '8f3ab2c1' }
 *   tycho/8f3ab2c1        → { hostPart: 'tycho', hostIdForm: false, id: '8f3ab2c1' }
 *   self/8f3ab2c1         → { hostPart: 'self',  hostIdForm: false, id: '8f3ab2c1' }
 *   <uuid>:<sessionId>    → { hostPart: uuid,    hostIdForm: true,  id: '<sessionId>' }
 */
declare function parseRef(raw: unknown): ParsedRef;
/** Every identifier a ref may name for one route id, most specific first. */
declare function sessionRefAliases(id: unknown): string[];
/** Exact route id, exact alias, route-id prefix, alias prefix — in that
 *  order, so a ref that resolved before aliases existed still means the same
 *  session. Returns `{ session, matches }` like the server's route. */
declare function resolveRefAmong<T extends SessionRow>(sessions: readonly T[] | null | undefined, ref: unknown, exactOnly?: boolean): {
    session: T | null;
    matches: T[];
};
/**
 * The shortest ref that still points at exactly one of `peerIds` — the uuid
 * tail where the corpus allows it, widened as far as needed, else a route-id
 * prefix. What the CLI prints instead of a 100-char key, so the next command
 * carries a handle an agent can retype without corrupting it.
 */
declare function shortSessionRef(id: unknown, peerIds?: readonly unknown[] | null, minLen?: number): string;
/**
 * The handle to *print*: `shortSessionRef`, unless the only thing it
 * shortened was the route id itself. Truncating a route id swaps a stable
 * identifier for a prefix unique only against the corpus snapshot it came
 * from, and a printed row is exactly what an agent comes back to later.
 * Naming a different identifier (native id, uuid tail) is not a truncation.
 */
declare function stableSessionRef(id: unknown, peerIds?: readonly unknown[] | null, minLen?: number): string;
declare function hostLabelOf(value: unknown): {} | null;
/**
 * Resolve a ref's host part against this server's fleet: remote name first,
 * then host uuid (exact or an unambiguous ≥8-char prefix), then label. `self`
 * and any match on this host's own entry mean local (no proxy prefix).
 */
declare function resolveHostPart(base: string, hostPart: string | null): Promise<ResolvedHost>;
/** The fleet entry a `--host NAME` flag names, when the fleet is readable. */
declare function entryForHostName(base: string, host: unknown): Promise<FleetHost | null>;
/**
 * Client-side ref resolution: for hosts that predate GET
 * /api/sessions/resolve, and for hosts whose resolver predates ref aliases —
 * resolving locally turns a short alias into the full route id the host does
 * understand, so short refs work across a mixed-version fleet.
 */
declare function resolveSessionClientSide(base: string, host: unknown, id: string, exactOnly?: boolean): Promise<SessionRow>;
/**
 * Resolve a ref to `{ host, id, session, ref }`. A full id resolves to
 * itself, so existing callers passing bare ids are unaffected; `ref` is the
 * short handle the owning host recommends for it, when it serves one.
 */
declare function resolveSessionRef(base: string, rawRef: unknown, hostFlag?: string | null): Promise<ResolvedSession>;
/**
 * Merge per-host search results into one ranked list. The client is the
 * aggregator (TASKS/multi-host.md) — there is no server-side merged endpoint,
 * and there must not be one.
 *
 * `hostResults`: [{ host: '(self)' | 'tycho', results: [session, …] }, …]
 * Returns: [{ host, session }, …] sorted by searchScore desc, then (for the
 * unscored tail, which sorts after every scored row) by lastActivity desc.
 */
declare function mergeSearchResults(hostResults: readonly SearchBucket[] | null | undefined, limit?: number): SearchRow[];
declare function summarizeToolArgs(args: unknown, max?: number): string;
declare function truncateResult(text: unknown, maxLines?: number, maxChars?: number): string;
/**
 * Render a /messages payload as readable markdown. Pure: everything it needs
 * is in `payload` (the resolved list entry merged with the route's own
 * `session`) and `options`.
 */
declare function renderTranscript(input: unknown, options?: TranscriptOptions): string;
export { makeFail, print, parentPid, ancestorPids, pidAlive, registryEntries, registryRouteId, sessionHarnessId, nativeSessionId, discoverSession, discoverSessionQuietly, TOKEN, defaultBase, request, requestText, hostPath, api, unknownHostError, jsonInit, fleetHosts, resetFleetCache, hostSupports, hostLabelOf, parseRef, resolveHostPart, entryForHostName, resolveSessionRef, resolveSessionClientSide, sessionRefAliases, resolveRefAmong, shortSessionRef, stableSessionRef, mergeSearchResults, renderTranscript, summarizeToolArgs, truncateResult, };
