// Generated from src/core/cu-handlers.ts; edit that source and run npm run build:core.
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { Duplex } from 'node:stream';
import type { TransportHandler } from './access-handlers';
export declare const CU_FETCH_CREDS_JS = "(() => {\n  const orig = globalThis.fetch.bind(globalThis);\n  globalThis.fetch = (input, init) => {\n    try {\n      const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;\n      const url = new URL(raw, location.href);\n      if (url.origin === location.origin && init && init.credentials === 'omit') {\n        init = { ...init, credentials: 'same-origin' };\n      }\n    } catch {}\n    return orig(input, init);\n  };\n})();\n";
export interface SanitizedSpacesPath {
    pathname: string;
    search: string;
}
/**
 * Validates and normalizes a `/api/cu/spaces/*` suffix before it reaches
 * `127.0.0.1:3211`. Refuses dot segments (including multi-encoded), encoded
 * path separators, backslashes, empty interior segments, and control chars.
 */
export declare function sanitizeSpacesPath(rawUrl: string): SanitizedSpacesPath | null;
/**
 * Rewrites only `frame-ancestors 'none'` -> `frame-ancestors 'self'`, keeping
 * every other CSP directive strict and untouched.
 */
export declare function rewriteSpacesCsp(csp: string): string;
/**
 * Injects the static same-origin `./cu-fetch-creds.js` script before
 * `./viewer.js` in `/viewer/` HTML. Idempotent.
 */
export declare function injectFetchCredsScript(html: string): string;
/** Builds allowlisted outbound HTTP headers for loopback `127.0.0.1:3211`. */
export declare function buildSpacesRequestHeaders(incoming: IncomingMessage['headers'], port: number, options?: {
    viewerHtml?: boolean;
}): OutgoingHttpHeaders;
export interface CuHandlersPorts {
    upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
    /** Optional test seam for the broker socket path. */
    socketPath?: () => string | null;
    /** Optional test seam for the loopback cua-spacesd port (host is always 127.0.0.1). */
    spacesPort?: number;
    /** Optional test seam for the WebSocket keepalive ping interval. */
    wsPingIntervalMs?: number;
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
