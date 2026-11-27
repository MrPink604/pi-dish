// Generated from src/core/cu-handlers.ts; edit that source and run npm run build:core.
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { Duplex } from 'node:stream';
import { type CuBrokerClient } from './cu-broker';
import type { CuBrokerEvent } from './cu-agent-leases';
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
export declare function extractCuaBearerTicket(headerValue: string | string[] | undefined): string | null;
/**
 * Extracts all media ticket credentials from a `/media` WebSocket upgrade:
 * `?ticket=` query parameters plus `cua.ticket.<ticket>` / legacy
 * `rcdp.v2.ticket.<ticket>` WebSocket subprotocols (MEDIA.md §2).
 */
export declare function extractMediaWsTickets(url: URL, protocols: readonly string[]): string[];
export type ValidatedOpenMediaRequest = {
    readonly ok: true;
    readonly displayId: string;
} | {
    readonly ok: false;
    readonly error: string;
};
/**
 * Validates a `StreamService.OpenMedia` gRPC-Web request (`grpc-web+proto` or
 * `grpc-web-text+proto`) before forwarding to `127.0.0.1:3211`. Fails closed
 * unless the target is a display target (`MediaTarget.display_id`, never a
 * window) and `geometry_control` is absent or observe-only (`0` or `1`).
 */
export declare function validateOpenMediaRequest(contentType: string | string[] | undefined, contentEncoding: string | string[] | undefined, grpcEncoding: string | string[] | undefined, body: Buffer): ValidatedOpenMediaRequest;
export type ParsedOpenMediaResponse = {
    readonly kind: 'ok';
    readonly ticket: string;
    readonly expiresAtMs: number | null;
} | {
    readonly kind: 'grpc-error';
} | {
    readonly kind: 'invalid';
};
/**
 * Extracts the media ticket and expiry from a `StreamService.OpenMedia`
 * gRPC-Web response (`application/grpc-web+proto` or `grpc-web-text+proto`)
 * per pinned `cua-spacesd v0.17.7` `stream.proto`.
 */
export declare function parseOpenMediaResponse(contentType: string | string[] | undefined, grpcStatusHeader: string | string[] | undefined, body: Buffer): ParsedOpenMediaResponse;
export interface CuHandlersPorts {
    upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
    /** Optional shared broker client (created internally when omitted). */
    broker?: CuBrokerClient;
    /** Optional test seam for the broker socket path. */
    socketPath?: () => string | null;
    /** Optional listener for parsed broker SSE events (preemption, hand_back, resync, hello, etc.). */
    onBrokerEvent?: (event: CuBrokerEvent) => void;
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
    /** Optional test seam for slow SSE client backpressure drain timeout. */
    sseDrainTimeoutMs?: number;
    /** Optional test seam for max SSE client buffered bytes before eviction. */
    sseMaxBufferedBytes?: number;
}
export interface CuHandlers {
    available(): boolean;
    activeStreamCount(): number;
    status: TransportHandler;
    stream: TransportHandler;
    takeover: TransportHandler;
    heartbeat: TransportHandler;
    release: TransportHandler;
    viewerTicket: TransportHandler;
    audit: TransportHandler;
    fillPending: TransportHandler;
    fillExecute: TransportHandler;
    fillCancel: TransportHandler;
    fillStatus: TransportHandler;
    spacesProxy: TransportHandler;
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean;
    stop(): void;
}
export declare function createCuHandlers(ports: CuHandlersPorts): CuHandlers;
