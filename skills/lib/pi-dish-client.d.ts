// Generated edge from skills/lib/pi-dish-client.ts; edit that source and run npm run build:edges.
import { stableSessionRef } from '../../src/core/helper-refs';
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
export declare function sessionRows(value: unknown): SessionRow[];
/** Fleet arrays are opaque until a particular operation consumes a row. */
export declare function fleetRows(value: unknown): unknown[];
export declare function fleetHost(value: unknown): FleetHost;
/** Check only when a caller actually invokes a string operation. */
export declare function stringValue(value: unknown, message: string): string;
/** `fail` bound to one CLI's name, so every error line is attributable. */
declare function makeFail(name: string): (message: unknown) => void;
declare function print(value: unknown, json?: boolean): void;
export interface CommandLine {
    command: string;
    positional: string[];
    json: boolean;
    session?: string;
    url?: string;
    /** Command-specific value flags, keyed without their leading dashes. */
    values: Record<string, string | undefined>;
}
/**
 * Parse `<command> [args] [flags]`: `--json`, `--session` and `--url` are
 * common, `flags` adds command-specific value flags.
 */
declare function parseCommandLine(argv: readonly string[], fallback: string, flags?: readonly string[]): CommandLine;
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
declare function jsonInit(body: unknown, headers?: Record<string, string>): RequestOptions;
declare function fleetHosts(base: string): Promise<unknown[] | null>;
/** Absent capability means unsupported — mixed-version fleets are the norm. */
declare function hostSupports(value: unknown, capability: string): boolean;
/**
 * Parse a session ref: `[host/]id`, where a `<uuid>:<id>` head is the
 * machine-produced provenance form. Pure — the host part is only named here.
 */
declare function parseRef(raw: unknown): ParsedRef;
/**
 * The calling session as `<hostId>:<sessionId>`, qualified with this machine's
 * persisted host id. Every server accepts that form, so the CLI need not know
 * whether its URL lands on its own host. Without a host id the id stays bare.
 */
declare function fleetCallerId(sessionId: unknown): string;
/** The fleet entry a `--host NAME` flag names, when the fleet is readable. */
declare function entryForHostName(base: string, host: unknown): Promise<FleetHost | null>;
/**
 * Resolve locally for hosts that predate /api/sessions/resolve or its ref
 * aliases: a short alias becomes the full route id the host does understand.
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
 * aggregator: there is no server-side merged endpoint, and there must not be
 * one. Rows are sorted by searchScore descending, then the unscored tail by
 * lastActivity descending.
 */
declare function mergeSearchResults(hostResults: readonly SearchBucket[] | null | undefined, limit?: number): SearchRow[];
/**
 * Render a /messages payload as readable markdown. Pure: everything it needs
 * is in `payload` (the resolved list entry merged with the route's own
 * `session`) and `options`.
 */
declare function renderTranscript(input: unknown, options?: TranscriptOptions): string;
export { makeFail, print, parseCommandLine, registryEntries, registryRouteId, sessionHarnessId, nativeSessionId, discoverSession, discoverSessionQuietly, fleetCallerId, TOKEN, defaultBase, request, requestText, hostPath, api, jsonInit, fleetHosts, hostSupports, parseRef, entryForHostName, resolveSessionRef, resolveSessionClientSide, stableSessionRef, mergeSearchResults, renderTranscript, };
