// Generated from src/core/cu-handlers.ts; edit that source and run npm run build:core.
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { Duplex } from 'node:stream';
import type { TransportHandler, TransportRequest, TransportResponse } from './access-handlers';
export declare const SPACES_HTTP_TIMEOUT_MS = 10000;
export declare const CU_FETCH_CREDS_JS = "(() => {\n  const orig = globalThis.fetch.bind(globalThis);\n  globalThis.fetch = (input, init) => {\n    try {\n      const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;\n      const url = new URL(raw, location.href);\n      if (url.origin === location.origin && init && init.credentials === 'omit') {\n        init = { ...init, credentials: 'same-origin' };\n      }\n    } catch {}\n    return orig(input, init);\n  };\n})();\n";
export declare const CU_VIEWER_CSP: string;
/**
 * Allowlisted gRPC-Web RPCs required by the pinned cua-spacesd v0.17.7 viewer.
 * File handlers (/files, /share, FilesystemService), ProcessService,
 * DriverService, WindowsService, and guest-supplied HTML are unreachable.
 */
export declare const ALLOWED_SPACES_GRPC_VIEW_PATHS: ReadonlySet<string>;
/** Interactive-only gRPC-Web RPCs refused whenever the broker is not synced in human state. */
export declare const ALLOWED_SPACES_GRPC_INTERACTIVE_PATHS: ReadonlySet<string>;
export declare function classifySpacesHttpRoute(pathname: string): 'view' | 'interactive' | null;
export declare function isAllowedSpacesWsPath(pathname: string): boolean;
export declare const ALLOWED_SPACES_REQUEST_HEADERS: readonly string[];
export interface SanitizedSpacesPath {
    pathname: string;
    search: string;
}
/**
 * Validates and normalizes a `/api/cu/spaces/*` suffix before it reaches
 * vendored viewer serving or `127.0.0.1:3211`. Refuses dot segments (including
 * multi-encoded), encoded path separators, backslashes, empty interior
 * segments, and control chars.
 */
export declare function sanitizeSpacesPath(rawUrl: string): SanitizedSpacesPath | null;
/**
 * Injects the static same-origin `./cu-fetch-creds.js` script before
 * `./viewer.js` in `/viewer/` HTML. Idempotent.
 */
export declare function injectFetchCredsScript(html: string): string;
/**
 * Serves the vendored pinned cua-spacesd v0.17.7 viewer assets locally from
 * the serving pi-dish (hub or direct CU host) so guest JS never executes in
 * the dish origin. Returns true when `/viewer` or `/viewer/*` was handled.
 */
export declare function serveVendoredCuViewer(req: TransportRequest, res: TransportResponse, safe: SanitizedSpacesPath): boolean;
/** Extracts lowercase Connection-nominated header names before dropping Connection. */
export declare function connectionNominatedHeaders(headerValue: string | string[] | undefined): Set<string>;
/** Builds allowlisted outbound HTTP headers for loopback `127.0.0.1:3211`. */
export declare function buildSpacesRequestHeaders(incoming: IncomingMessage['headers'], port: number): OutgoingHttpHeaders;
export interface ValidatedWsHandshake {
    readonly protocols: string[];
}
/**
 * Validates the downstream RFC 6455 handshake before dialing upstream so a
 * malformed upgrade (bad key/version, invalid or duplicated Sec-WebSocket-Protocol)
 * never crashes ws or wastes an upstream dial.
 */
export declare function validateWebSocketHandshake(req: IncomingMessage): ValidatedWsHandshake | null;
export interface CuHandlersPorts {
    upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
    /** Optional test seam for the broker socket path. */
    socketPath?: () => string | null;
    /** Optional test seam for the loopback cua-spacesd port (host is always 127.0.0.1). */
    spacesPort?: number;
    /** Optional test seam for the WebSocket keepalive ping interval. */
    wsPingIntervalMs?: number;
    /** Optional test seam for the WebSocket bufferedAmount backpressure ceiling. */
    wsMaxBufferedBytes?: number;
    /** Optional test seam for broker watcher reconnect retry delay. */
    watchRetryMs?: number;
    /** Optional test seam for SSE event/error buffer caps. */
    maxSseEventBytes?: number;
    maxSseErrorBytes?: number;
}
export interface CuHandlers {
    available(): boolean;
    status: TransportHandler;
    stream: TransportHandler;
    takeover: TransportHandler;
    heartbeat: TransportHandler;
    release: TransportHandler;
    viewerTicket: TransportHandler;
    audit: TransportHandler;
    spacesProxy: TransportHandler;
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean;
    stop(): void;
}
export declare function createCuHandlers(ports: CuHandlersPorts): CuHandlers;
