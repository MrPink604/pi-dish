/**
 * Guest-side computer-use HTTP routes, allowlisted cua-spacesd (127.0.0.1:3211)
 * gRPC-Web/WS proxy, vendored cua-spacesd v0.17.7 HTML5 viewer asset server,
 * and fail-closed broker-epoch revocation.
 */
import fs = require('node:fs');
import http = require('node:http');
import path = require('node:path');
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { Duplex } from 'node:stream';
import type * as WS from 'ws';
import { createCuBrokerClient, TAKEOVER_BROKER_TIMEOUT_MS, type CuBrokerClient } from './cu-broker';
import type { TransportHandler, TransportRequest, TransportResponse } from './access-handlers';
import { errorMessage, errorStatus, requestBody } from './http-boundary';
import { record as isRecord } from './helper-values';

const SPACES_HOST = '127.0.0.1' as const;
const DEFAULT_SPACES_PORT = 3211;
const SPACES_PREFIX = '/api/cu/spaces';
// Guest proxy deadline sits between broker (8s) and hub relay (15s).
export const SPACES_HTTP_TIMEOUT_MS = 10_000;
const WS_PING_INTERVAL_MS = 30_000;
const DEFAULT_WS_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const EPOCH_WATCH_RETRY_MS = 2_000;
const WATCH_SYNC_WAIT_MS = 1_500;
const DEFAULT_HUMAN_TTL_SEC = 600;
const MAX_SSE_ERROR_BYTES = 64 * 1024;
const MAX_SSE_EVENT_BYTES = 256 * 1024;
const MAX_WS_PROTOCOLS = 8;

const WS_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const WS_KEY_RE = /^[A-Za-z0-9+/]{22}==$/;

// Minimal same-origin shim: viewer.js fetches gRPC-Web POSTs with
// credentials:"omit", which drops the Cloudflare Access cookie (CF_Authorization)
// even on same-origin calls. Served externally so script-src 'self' stays intact.
export const CU_FETCH_CREDS_JS = `(() => {
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    try {
      const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && init && init.credentials === 'omit') {
        init = { ...init, credentials: 'same-origin' };
      }
    } catch {}
    return orig(input, init);
  };
})();
`;

const FETCH_CREDS_SCRIPT_TAG = '<script src="./cu-fetch-creds.js"></script>';

// Strict CSP matching cua-spacesd-html5 v0.17.7 with frame-ancestors narrowed
// to 'self' and connect-src limited to same-origin (including same-origin ws/wss).
export const CU_VIEWER_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; " +
  "connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

const VENDOR_VIEWER_DIR = path.resolve(__dirname, '..', 'vendor', 'cua-viewer');

interface VendoredViewerAsset {
  readonly contentType: string;
  readonly csp: string;
  readonly isShim?: boolean;
  readonly body: Buffer;
}

const VENDORED_VIEWER_SPECS: Readonly<Record<string, { file: string; contentType: string; injectCreds?: boolean }>> = {
  'index.html': { file: 'index.html', contentType: 'text/html; charset=utf-8', injectCreds: true },
  'index.css': { file: 'index.css', contentType: 'text/css; charset=utf-8' },
  'viewer.js': { file: 'viewer.js', contentType: 'text/javascript; charset=utf-8' },
  'audioWorklet.js': { file: 'audioWorklet.js', contentType: 'text/javascript; charset=utf-8' },
  'captureWorklet.js': { file: 'captureWorklet.js', contentType: 'text/javascript; charset=utf-8' },
};

let cachedVendoredAssets: Map<string, VendoredViewerAsset> | null = null;

function loadVendoredViewerAssets(): Map<string, VendoredViewerAsset> {
  if (cachedVendoredAssets) return cachedVendoredAssets;
  const assets = new Map<string, VendoredViewerAsset>();
  for (const [name, spec] of Object.entries(VENDORED_VIEWER_SPECS)) {
    const raw = fs.readFileSync(path.join(VENDOR_VIEWER_DIR, spec.file));
    const body = spec.injectCreds
      ? Buffer.from(injectFetchCredsScript(raw.toString('utf8')), 'utf8')
      : raw;
    assets.set(name, {
      contentType: spec.contentType,
      csp: CU_VIEWER_CSP,
      body,
    });
  }
  assets.set('cu-fetch-creds.js', {
    contentType: 'application/javascript; charset=utf-8',
    csp: "default-src 'none'",
    isShim: true,
    body: Buffer.from(CU_FETCH_CREDS_JS, 'utf8'),
  });
  cachedVendoredAssets = assets;
  return assets;
}

/**
 * Allowlisted gRPC-Web RPCs required by the pinned cua-spacesd v0.17.7 viewer.
 * File handlers (/files, /share, FilesystemService), ProcessService,
 * DriverService, WindowsService, and guest-supplied HTML are unreachable.
 */
export const ALLOWED_SPACES_GRPC_VIEW_PATHS: ReadonlySet<string> = new Set([
  '/cua.env.v1.SystemService/GetCapabilities',
  '/cua.env.v1.StreamService/ListTargets',
  '/cua.env.v1.StreamService/OpenMedia',
  '/cua.env.v1.StreamService/SetPreferences',
  '/cua.env.v1.StreamService/RequestKeyframe',
  '/cua.env.v1.StreamService/CloseMedia',
  '/cua.env.v1.PresenceService/Join',
  '/cua.env.v1.PresenceService/UpdateCursor',
  '/cua.env.v1.PresenceService/Leave',
]);

/** Interactive-only gRPC-Web RPCs refused whenever the broker is not synced in human state. */
export const ALLOWED_SPACES_GRPC_INTERACTIVE_PATHS: ReadonlySet<string> = new Set([
  '/cua.env.v1.ComputerService/GetClipboard',
  '/cua.env.v1.ComputerService/SetClipboard',
]);

export function classifySpacesHttpRoute(pathname: string): 'view' | 'interactive' | null {
  if (ALLOWED_SPACES_GRPC_VIEW_PATHS.has(pathname)) return 'view';
  if (ALLOWED_SPACES_GRPC_INTERACTIVE_PATHS.has(pathname)) return 'interactive';
  return null;
}

export function isAllowedSpacesWsPath(pathname: string): boolean {
  return pathname === '/media';
}

// Strict allowlist of request headers forwarded to loopback 127.0.0.1:3211.
// Hop-by-hop, Authorization, Cookie, Cloudflare Access, proxy-identity and
// pi-dish internal headers are never forwarded.
export const ALLOWED_SPACES_REQUEST_HEADERS: readonly string[] = [
  'accept',
  'accept-language',
  'content-type',
  'content-length',
  'x-cua-env-authorization',
  'x-grpc-web',
  'x-user-agent',
  'grpc-timeout',
  'connect-protocol-version',
  'connect-timeout-ms',
  'user-agent',
];

const HOP_BY_HOP_RESPONSE_HEADERS: Record<string, true> = {
  connection: true,
  'keep-alive': true,
  'proxy-authenticate': true,
  'proxy-authorization': true,
  te: true,
  trailer: true,
  'transfer-encoding': true,
  upgrade: true,
};

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
export function sanitizeSpacesPath(rawUrl: string): SanitizedSpacesPath | null {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/')) return null;
  const hashIndex = rawUrl.indexOf('#');
  const withoutHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl;
  const queryIndex = withoutHash.indexOf('?');
  const rawPath = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex) : '';

  if (/[\u0000-\u001f\u007f]/.test(rawPath) || /[\u0000-\u001f\u007f]/.test(search)) return null;
  if (rawPath.includes('\\') || rawPath.startsWith('//')) return null;
  if (rawPath === '/') return { pathname: '/', search };

  const trailingSlash = rawPath.endsWith('/');
  const body = trailingSlash ? rawPath.slice(1, -1) : rawPath.slice(1);
  if (body === '') return null;

  const rawSegments = body.split('/');
  const encodedSegments: string[] = [];
  for (const segment of rawSegments) {
    if (!segment) return null;
    let reading = segment;
    let decodedOnce: string | null = null;
    for (let round = 0; round < 4; round++) {
      if (/[\u0000-\u001f\u007f\\]/.test(reading)) return null;
      if (reading === '.' || reading === '..') return null;
      if (round > 0 && reading.includes('/')) return null;
      let next: string;
      try {
        next = decodeURIComponent(reading);
      } catch {
        return null;
      }
      if (round === 0) decodedOnce = next;
      if (next === reading) break;
      if (round === 3) return null;
      reading = next;
    }
    if (decodedOnce === null || decodedOnce === '.' || decodedOnce === '..') return null;
    if (/[\u0000-\u001f\u007f/\\]/.test(decodedOnce)) return null;
    encodedSegments.push(encodeURIComponent(decodedOnce));
  }

  return {
    pathname: `/${encodedSegments.join('/')}${trailingSlash ? '/' : ''}`,
    search,
  };
}

/**
 * Injects the static same-origin `./cu-fetch-creds.js` script before
 * `./viewer.js` in `/viewer/` HTML. Idempotent.
 */
export function injectFetchCredsScript(html: string): string {
  if (html.includes('./cu-fetch-creds.js')) return html;
  const viewerScript = /<script\b[^>]*\bsrc=["'](?:\.\/)?viewer\.js(?:[?#][^"']*)?["'][^>]*>/i;
  if (viewerScript.test(html)) {
    return html.replace(viewerScript, match => `${FETCH_CREDS_SCRIPT_TAG}${match}`);
  }
  const headClose = /<\/head>/i;
  if (headClose.test(html)) {
    return html.replace(headClose, `${FETCH_CREDS_SCRIPT_TAG}</head>`);
  }
  const bodyClose = /<\/body>/i;
  if (bodyClose.test(html)) {
    return html.replace(bodyClose, `${FETCH_CREDS_SCRIPT_TAG}</body>`);
  }
  return `${FETCH_CREDS_SCRIPT_TAG}${html}`;
}

/**
 * Serves the vendored pinned cua-spacesd v0.17.7 viewer assets locally from
 * the serving pi-dish (hub or direct CU host) so guest JS never executes in
 * the dish origin. Returns true when `/viewer` or `/viewer/*` was handled.
 */
export function serveVendoredCuViewer(
  req: TransportRequest,
  res: TransportResponse,
  safe: SanitizedSpacesPath,
): boolean {
  if (safe.pathname !== '/viewer' && !safe.pathname.startsWith('/viewer/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).type('text/plain').send('Method not allowed');
    return true;
  }
  if (safe.pathname === '/viewer') {
    res.status(301);
    res.setHeader('Location', 'viewer/');
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return true;
  }
  const rel = safe.pathname.slice('/viewer/'.length) || 'index.html';
  const asset = loadVendoredViewerAssets().get(rel);
  if (!asset) {
    res.status(404).type('text/plain').send('Not found');
    return true;
  }
  res.status(200);
  res.setHeader('Content-Type', asset.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', asset.csp);
  if (!asset.isShim) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'microphone=(self), clipboard-read=(self), clipboard-write=(self), fullscreen=(self), keyboard-map=(self)');
  }
  res.setHeader('Content-Length', String(asset.body.length));
  if (req.method === 'HEAD') res.end();
  else res.end(asset.body);
  return true;
}

/** Extracts lowercase Connection-nominated header names before dropping Connection. */
export function connectionNominatedHeaders(headerValue: string | string[] | undefined): Set<string> {
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : String(headerValue || '');
  return new Set(
    raw
      .split(',')
      .map(token => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Builds allowlisted outbound HTTP headers for loopback `127.0.0.1:3211`. */
export function buildSpacesRequestHeaders(
  incoming: IncomingMessage['headers'],
  port: number,
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {
    host: `${SPACES_HOST}:${port}`,
    'accept-encoding': 'identity',
  };
  const nominated = connectionNominatedHeaders(incoming.connection);
  for (const name of ALLOWED_SPACES_REQUEST_HEADERS) {
    if (nominated.has(name)) continue;
    const value = incoming[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export interface ValidatedWsHandshake {
  readonly protocols: string[];
}

/**
 * Validates the downstream RFC 6455 handshake before dialing upstream so a
 * malformed upgrade (bad key/version, invalid or duplicated Sec-WebSocket-Protocol)
 * never crashes ws or wastes an upstream dial.
 */
export function validateWebSocketHandshake(req: IncomingMessage): ValidatedWsHandshake | null {
  if (req.method !== 'GET') return null;
  const upgradeHeader = Array.isArray(req.headers.upgrade) ? req.headers.upgrade[0] : req.headers.upgrade;
  if (typeof upgradeHeader !== 'string' || upgradeHeader.trim().toLowerCase() !== 'websocket') return null;
  const connectionTokens = connectionNominatedHeaders(req.headers.connection);
  if (!connectionTokens.has('upgrade')) return null;

  const version = req.headers['sec-websocket-version'];
  if (version !== '13') return null;

  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || !WS_KEY_RE.test(key.trim())) return null;

  const rawProto = req.headers['sec-websocket-protocol'];
  if (rawProto === undefined) return { protocols: [] };
  const combined = Array.isArray(rawProto) ? rawProto.join(',') : rawProto;
  const parts = combined.split(',');
  if (parts.length > MAX_WS_PROTOCOLS) return null;
  const protocols: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const token = part.trim();
    if (!token || !WS_TOKEN_RE.test(token)) return null;
    if (seen.has(token)) return null;
    seen.add(token);
    protocols.push(token);
  }
  return { protocols };
}

function rawDataByteLength(data: WS.RawData): number {
  if (Buffer.isBuffer(data)) return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (Array.isArray(data)) {
    let total = 0;
    for (const chunk of data) total += chunk.length;
    return total;
  }
  return 0;
}

function safeCloseCode(code: number): number | undefined {
  if (code === 1000 || (code >= 3000 && code <= 4999)) return code;
  if (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) return code;
  return undefined;
}

function pickString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickFiniteNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pickBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeBrokerErrorBody(status: number, body: unknown): unknown {
  if (!isRecord(body)) return body ?? { error: `Broker returned HTTP ${status}` };
  if (status < 400) return body;
  const out: Record<string, unknown> = { ...body };
  if (typeof out.error !== 'string' || !out.error) {
    if (typeof out.message === 'string' && out.message) out.error = out.message;
    else if (status === 409) out.error = 'Computer-use seat is busy';
    else out.error = `Broker returned HTTP ${status}`;
  }
  if (status === 409 && out.holder === undefined && isRecord(out.lease)) {
    out.holder = out.lease;
  }
  return out;
}

function withSpacesViewerPath(viewer: unknown): Record<string, unknown> | null {
  if (!isRecord(viewer)) return null;
  const viewerPath = typeof viewer.path === 'string' ? viewer.path : null;
  if (!viewerPath) return viewer;
  const spacesPath = viewerPath.startsWith(SPACES_PREFIX)
    ? viewerPath
    : `${SPACES_PREFIX}${viewerPath.startsWith('/') ? '' : '/'}${viewerPath}`;
  return { ...viewer, spacesPath };
}

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

export function createCuHandlers(ports: CuHandlersPorts): CuHandlers {
  const broker: CuBrokerClient = createCuBrokerClient({ socketPath: ports.socketPath });
  const spacesPort = Number.isInteger(ports.spacesPort) && ports.spacesPort! > 0 && ports.spacesPort! <= 65535
    ? ports.spacesPort!
    : DEFAULT_SPACES_PORT;
  const wsPingIntervalMs = ports.wsPingIntervalMs ?? WS_PING_INTERVAL_MS;
  const wsMaxBufferedBytes = ports.wsMaxBufferedBytes ?? DEFAULT_WS_MAX_BUFFERED_BYTES;
  const watchRetryMs = ports.watchRetryMs ?? EPOCH_WATCH_RETRY_MS;
  const maxSseEventBytes = ports.maxSseEventBytes ?? MAX_SSE_EVENT_BYTES;
  const maxSseErrorBytes = ports.maxSseErrorBytes ?? MAX_SSE_ERROR_BYTES;

  const { WebSocket, WebSocketServer } = require('ws') as typeof WS;
  const negotiatedProtocols = new WeakMap<IncomingMessage, string>();
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    handleProtocols: (_protocols, req) => negotiatedProtocols.get(req) ?? false,
  });

  // Fail-closed broker-epoch state: no per-ticket index. Until a fresh broker
  // snapshot arrives over /v1/events, treat state as not-human and refuse
  // interactive traffic. On any human-epoch end or watch loss, terminate EVERY
  // proxied /media WebSocket, pending upgrade, and in-flight Spaces HTTP call.
  const activeMediaSockets = new Set<(reason: string) => void>();
  const pendingMediaUpgrades = new Set<(statusLine: string) => void>();
  const activeSpacesRequests = new Set<(reason: string) => void>();

  let stopped = false;
  let watcherReq: http.ClientRequest | null = null;
  let watcherRes: http.IncomingMessage | null = null;
  let watcherRetryTimer: NodeJS.Timeout | null = null;
  let brokerWatchSynced = false;
  let brokerState: string | null = null;
  let latestEpoch = -1;
  let watchSyncWaiters: Array<() => void> = [];

  function isHumanControlActive(): boolean {
    return brokerWatchSynced && brokerState === 'human';
  }

  function resolveWatchSyncWaiters(): void {
    const waiters = watchSyncWaiters;
    watchSyncWaiters = [];
    for (const notify of waiters) notify();
  }

  function revokeAllActive(reason: string): void {
    for (const rejectPending of [...pendingMediaUpgrades]) rejectPending('HTTP/1.1 403 Forbidden');
    pendingMediaUpgrades.clear();
    for (const closeSocket of [...activeMediaSockets]) closeSocket(reason);
    activeMediaSockets.clear();
    for (const abortReq of [...activeSpacesRequests]) abortReq(reason);
    activeSpacesRequests.clear();
  }

  function applyBrokerSnapshot(
    state: string,
    epoch: number,
    options: { authoritativeHello?: boolean } = {},
  ): void {
    // Ignore stale status/ticket/event responses from an older epoch unless
    // this is a fresh authoritative hello snapshot after a watcher (re)connect.
    if (!options.authoritativeHello && epoch < latestEpoch) return;
    const wasHuman = brokerState === 'human';
    const humanEpochEnded = wasHuman && (state !== 'human' || epoch !== latestEpoch);

    if (options.authoritativeHello) brokerWatchSynced = true;
    brokerState = state;
    latestEpoch = epoch;
    if (options.authoritativeHello) resolveWatchSyncWaiters();

    if (humanEpochEnded || (options.authoritativeHello && state !== 'human')) {
      revokeAllActive('Human lease ended');
    }
  }

  function stopEpochWatcher(): void {
    if (watcherRetryTimer) {
      clearTimeout(watcherRetryTimer);
      watcherRetryTimer = null;
    }
    if (watcherRes) {
      try { watcherRes.destroy(); } catch {}
      watcherRes = null;
    }
    if (watcherReq) {
      try { watcherReq.destroy(); } catch {}
      watcherReq = null;
    }
  }

  function scheduleEpochWatcherRetry(): void {
    if (stopped || watcherRetryTimer || !broker.socketPath()) return;
    watcherRetryTimer = setTimeout(() => {
      watcherRetryTimer = null;
      ensureEpochWatcher();
    }, watchRetryMs);
    watcherRetryTimer.unref();
  }

  function handleWatchLost(): void {
    brokerWatchSynced = false;
    brokerState = null;
    revokeAllActive('Broker watch lost');
    resolveWatchSyncWaiters();
    scheduleEpochWatcherRetry();
  }

  function ensureEpochWatcher(): void {
    if (stopped || watcherReq || !broker.socketPath()) return;
    if (!broker.available()) {
      handleWatchLost();
      return;
    }
    let buffer = '';
    let dataLines: string[] = [];
    let eventBytes = 0;
    let sawFirstEvent = false;
    let failed = false;

    const failWatcher = (req: http.ClientRequest | null, res?: http.IncomingMessage | null) => {
      if (failed) return;
      failed = true;
      if (res) {
        try { res.destroy(); } catch {}
      }
      if (req && watcherReq === req) {
        watcherReq = null;
        watcherRes = null;
        handleWatchLost();
      }
    };

    const flushEvent = () => {
      if (!dataLines.length) return;
      const payload = dataLines.join('\n');
      dataLines = [];
      eventBytes = 0;
      let parsed: unknown;
      try { parsed = JSON.parse(payload); } catch { return; }
      if (!isRecord(parsed)) return;
      const state = typeof parsed.state === 'string' ? parsed.state : null;
      const epoch = typeof parsed.epoch === 'number' && Number.isFinite(parsed.epoch) ? parsed.epoch : null;
      if (state === null || epoch === null) return;
      const authoritativeHello = !sawFirstEvent;
      sawFirstEvent = true;
      applyBrokerSnapshot(state, epoch, { authoritativeHello });
    };

    const req = broker.openEvents(
      (res) => {
        if (watcherReq !== req) { res.destroy(); return; }
        watcherRes = res;
        if (res.statusCode !== 200) {
          res.resume();
          failWatcher(req, res);
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (failed) return;
          buffer += chunk;
          if (buffer.length > maxSseEventBytes) {
            failWatcher(req, res);
            return;
          }
          for (;;) {
            const nl = buffer.indexOf('\n');
            if (nl < 0) break;
            const line = buffer.slice(0, nl).replace(/\r$/, '');
            buffer = buffer.slice(nl + 1);
            if (line === '') {
              flushEvent();
            } else if (line.startsWith('data:')) {
              const value = line.slice(5).replace(/^ /, '');
              eventBytes += Buffer.byteLength(value, 'utf8');
              if (eventBytes > maxSseEventBytes) {
                failWatcher(req, res);
                return;
              }
              dataLines.push(value);
            }
          }
        });
        const disconnected = () => failWatcher(req, res);
        res.on('end', disconnected);
        res.on('close', disconnected);
        res.on('error', disconnected);
      },
      () => failWatcher(req, watcherRes),
    );
    if (!req) {
      handleWatchLost();
      return;
    }
    watcherReq = req;
  }

  function waitForWatchSync(timeoutMs = WATCH_SYNC_WAIT_MS): Promise<boolean> {
    if (brokerWatchSynced) return Promise.resolve(true);
    ensureEpochWatcher();
    if (brokerWatchSynced) return Promise.resolve(true);
    if (!watcherReq) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(brokerWatchSynced);
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref();
      watchSyncWaiters.push(finish);
    });
  }

  // Start watching immediately on CU-configured hosts so the initial hello
  // snapshot arrives before browser traffic, and rearm automatically if the
  // broker socket restarts.
  if (broker.socketPath()) ensureEpochWatcher();

  function ensureAvailable(res: TransportResponse): boolean {
    if (broker.available()) {
      ensureEpochWatcher();
      return true;
    }
    res.status(404).json({ error: 'Computer-use is not available on this host' });
    return false;
  }

  function sendBrokerReply(res: TransportResponse, status: number, body: unknown): void {
    res.status(status).json(normalizeBrokerErrorBody(status, body));
  }

  function sendBrokerFailure(res: TransportResponse, error: unknown): void {
    if (res.headersSent) return;
    res.status(errorStatus(error, 502)).json({ error: errorMessage(error) });
  }

  const status: TransportHandler = async (_req, res) => {
    if (!ensureAvailable(res)) return;
    try {
      const reply = await broker.requestJson('GET', '/v1/status');
      if (reply.status === 200 && isRecord(reply.body)) {
        const st = typeof reply.body.state === 'string' ? reply.body.state : null;
        const ep = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
        if (st !== null && ep !== null) applyBrokerSnapshot(st, ep);
      }
      sendBrokerReply(res, reply.status, reply.body);
    } catch (error) {
      sendBrokerFailure(res, error);
    }
  };

  const stream: TransportHandler = (req, res) => {
    if (!ensureAvailable(res)) return;
    let closed = false;
    const upstream = broker.openEvents(
      (brokerRes) => {
        if (closed) { brokerRes.destroy(); return; }
        if (brokerRes.statusCode !== 200) {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          let settled = false;
          const finishError = (statusCode: number, body: unknown) => {
            if (settled || closed || res.headersSent) return;
            settled = true;
            sendBrokerReply(res, statusCode, body);
          };
          brokerRes.on('data', (chunk: Buffer) => {
            if (settled) return;
            totalBytes += chunk.length;
            if (totalBytes > maxSseErrorBytes) {
              finishError(502, { error: 'Broker error response exceeded size limit' });
              try { brokerRes.destroy(); } catch {}
              return;
            }
            chunks.push(chunk);
          });
          brokerRes.on('error', () => finishError(502, { error: 'Broker stream unavailable' }));
          brokerRes.on('aborted', () => finishError(502, { error: 'Broker stream aborted' }));
          brokerRes.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown = null;
            try { parsed = JSON.parse(raw); } catch {}
            finishError(brokerRes.statusCode ?? 502, parsed ?? { error: 'Broker stream unavailable' });
          });
          return;
        }
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        brokerRes.pipe(res);
        brokerRes.on('error', () => { try { res.end(); } catch {} });
        res.on('close', () => { closed = true; try { brokerRes.destroy(); } catch {} });
      },
      (error) => {
        if (closed) return;
        sendBrokerFailure(res, Object.assign(error, { statusCode: 503 }));
      },
    );
    if (!upstream) {
      res.status(404).json({ error: 'Computer-use is not available on this host' });
      return;
    }
    req.on('close', () => {
      closed = true;
      try { upstream.destroy(); } catch {}
    });
  };

  const takeover: TransportHandler = async (req, res) => {
    if (!ensureAvailable(res)) return;
    if (!(await waitForWatchSync())) {
      res.status(503).json({ error: 'Computer-use broker watch is not synced', code: 'broker_watch_unavailable' });
      return;
    }
    const raw = requestBody(req);
    // Force Take Over and Detach driver are intentionally not exposed in Slice 1.
    const payload: Record<string, unknown> = {
      label: pickString(raw, 'label') ?? 'pi-dish',
      ttlSec: pickFiniteNumber(raw, 'ttlSec') ?? DEFAULT_HUMAN_TTL_SEC,
      mintTicket: pickBoolean(raw, 'mintTicket') ?? true,
    };
    const holderId = pickString(raw, 'holderId');
    if (holderId) payload.holderId = holderId;
    const reason = pickString(raw, 'reason');
    if (reason) payload.reason = reason;
    const hardCapSec = pickFiniteNumber(raw, 'hardCapSec');
    if (hardCapSec !== undefined) payload.hardCapSec = hardCapSec;
    const ticketTtlSec = pickFiniteNumber(raw, 'ticketTtlSec');
    if (ticketTtlSec !== undefined) payload.ticketTtlSec = ticketTtlSec;

    try {
      const reply = await broker.requestJson('POST', '/v1/lease/takeover', payload, { timeoutMs: TAKEOVER_BROKER_TIMEOUT_MS });
      if (reply.status === 200 && isRecord(reply.body)) {
        const epoch = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
        if (!brokerWatchSynced) {
          res.status(503).json({ error: 'Computer-use broker watch was lost during takeover', code: 'broker_watch_unavailable' });
          return;
        }
        if (epoch !== null && epoch < latestEpoch) {
          res.status(409).json({ error: 'Takeover response was superseded by a newer epoch', code: 'human_lease_ended', epoch: latestEpoch });
          return;
        }
        if (epoch !== null) applyBrokerSnapshot('human', epoch);
        const viewer = withSpacesViewerPath(reply.body.viewer);
        const out = viewer ? { ...reply.body, viewer } : reply.body;
        res.status(200).json(out);
        return;
      }
      sendBrokerReply(res, reply.status, reply.body);
    } catch (error) {
      sendBrokerFailure(res, error);
    }
  };

  const heartbeat: TransportHandler = async (req, res) => {
    if (!ensureAvailable(res)) return;
    const raw = requestBody(req);
    const payload: Record<string, unknown> = {};
    for (const key of ['leaseId', 'sessionId', 'leaseToken', 'sessionSecret', 'token'] as const) {
      const val = pickString(raw, key);
      if (val) payload[key] = val;
    }
    const ttlSec = pickFiniteNumber(raw, 'ttlSec');
    if (ttlSec !== undefined) payload.ttlSec = ttlSec;

    try {
      const reply = await broker.requestJson('POST', '/v1/lease/heartbeat', payload);
      if (isRecord(reply.body)) {
        const st = typeof reply.body.state === 'string' ? reply.body.state : null;
        const ep = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
        if (st !== null && ep !== null) applyBrokerSnapshot(st, ep);
      }
      sendBrokerReply(res, reply.status, reply.body);
    } catch (error) {
      sendBrokerFailure(res, error);
    }
  };

  const release: TransportHandler = async (req, res) => {
    if (!ensureAvailable(res)) return;
    const raw = requestBody(req);
    // Hand Back always sends handBack: true; force / Release Seat are cut.
    const payload: Record<string, unknown> = { handBack: true };
    for (const key of ['leaseId', 'sessionId', 'leaseToken', 'sessionSecret', 'token'] as const) {
      const val = pickString(raw, key);
      if (val) payload[key] = val;
    }

    try {
      const reply = await broker.requestJson('POST', '/v1/lease/release', payload);
      if (reply.status === 200 && isRecord(reply.body)) {
        const st = typeof reply.body.state === 'string' ? reply.body.state : 'idle';
        const ep = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : latestEpoch;
        applyBrokerSnapshot(st, ep);
        // Always close open media sockets / in-flight interactive calls on a
        // successful release even if the broker stayed at the same epoch.
        if (st !== 'human') revokeAllActive('Human lease ended');
      }
      sendBrokerReply(res, reply.status, reply.body);
    } catch (error) {
      sendBrokerFailure(res, error);
    }
  };

  const viewerTicket: TransportHandler = async (req, res) => {
    if (!ensureAvailable(res)) return;
    const raw = requestBody(req);
    const mode = raw.mode === 'interactive' ? 'interactive' : (raw.mode === undefined || raw.mode === 'view-only' ? 'view-only' : null);
    if (!mode) {
      res.status(400).json({ error: "mode must be 'view-only' or 'interactive'" });
      return;
    }
    if (mode === 'interactive') {
      if (!(await waitForWatchSync())) {
        res.status(503).json({ error: 'Computer-use broker watch is not synced', code: 'broker_watch_unavailable' });
        return;
      }
      if (!isHumanControlActive()) {
        res.status(403).json({ error: 'Active human lease required', code: 'human_lease_required' });
        return;
      }
    }
    const payload: Record<string, unknown> = { mode };
    for (const key of ['leaseId', 'leaseToken', 'principalId', 'principalName'] as const) {
      const val = pickString(raw, key);
      if (val) payload[key] = val;
    }
    const ttlSec = pickFiniteNumber(raw, 'ttlSec');
    if (ttlSec !== undefined) payload.ttlSec = ttlSec;

    try {
      const reply = await broker.requestJson('POST', '/v1/viewer/ticket', payload);
      if (reply.status === 200 && isRecord(reply.body)) {
        const epoch = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
        if (epoch !== null && epoch < latestEpoch) {
          res.status(409).json({ error: 'Viewer ticket is from a superseded epoch', code: 'human_lease_ended', epoch: latestEpoch });
          return;
        }
        if (mode === 'interactive' && !isHumanControlActive()) {
          res.status(409).json({ error: 'Human lease ended while minting ticket', code: 'human_lease_ended', epoch: latestEpoch });
          return;
        }
        res.status(200).json(withSpacesViewerPath(reply.body) ?? reply.body);
        return;
      }
      sendBrokerReply(res, reply.status, reply.body);
    } catch (error) {
      sendBrokerFailure(res, error);
    }
  };

  const audit: TransportHandler = async (req, res) => {
    if (!ensureAvailable(res)) return;
    const params = new URLSearchParams();
    if (typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit)) {
      const clamped = Math.min(500, Math.max(1, Number(req.query.limit)));
      params.set('limit', String(clamped));
    }
    if (typeof req.query.sessionId === 'string' && req.query.sessionId.trim()) {
      params.set('sessionId', req.query.sessionId.trim());
    }
    const qs = params.toString();
    try {
      const reply = await broker.requestJson('GET', `/v1/audit${qs ? `?${qs}` : ''}`);
      sendBrokerReply(res, reply.status, reply.body);
    } catch (error) {
      sendBrokerFailure(res, error);
    }
  };

  function copySpacesResponseHeaders(upstreamRes: IncomingMessage, res: TransportResponse): void {
    const nominated = connectionNominatedHeaders(upstreamRes.headers.connection);
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_RESPONSE_HEADERS[lower] === true || nominated.has(lower)) continue;
      if (lower.startsWith('access-control-') || lower === 'set-cookie') continue;
      res.setHeader(key, value);
    }
  }

  /**
   * Vendored viewer asset server + allowlisted raw gRPC-Web proxy to
   * `http://127.0.0.1:3211`. Mounted BEFORE `compression` and `jsonBody`,
   * behind `accessHandlers.requireBearer`.
   */
  const spacesProxy: TransportHandler = (req: TransportRequest, res: TransportResponse) => {
    if (!broker.available()) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    ensureEpochWatcher();

    const safe = sanitizeSpacesPath(req.url || '/');
    if (!safe) {
      res.status(400).type('text/plain').send('Bad request');
      return;
    }

    // Serve pinned vendored viewer assets directly — never relay guest HTML/JS.
    if (serveVendoredCuViewer(req, res, safe)) return;

    const routeKind = classifySpacesHttpRoute(safe.pathname);
    if (!routeKind) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).type('text/plain').send('Method not allowed');
      return;
    }
    if (routeKind === 'interactive' && !isHumanControlActive()) {
      if (!brokerWatchSynced) {
        res.status(503).json({ error: 'Computer-use broker watch is not synced', code: 'broker_watch_unavailable' });
      } else {
        res.status(403).json({ error: 'Interactive viewer lease has ended', code: 'human_lease_ended' });
      }
      return;
    }

    const upstreamHeaders = buildSpacesRequestHeaders(req.headers, spacesPort);
    let activeRes: IncomingMessage | null = null;
    let finished = false;
    const cleanupRequest = () => {
      if (finished) return;
      finished = true;
      activeSpacesRequests.delete(abortOnRevoke);
    };
    const abortOnRevoke = (reason: string) => {
      cleanupRequest();
      try { upstream.destroy(); } catch {}
      if (activeRes) {
        try { activeRes.destroy(); } catch {}
      }
      if (!res.headersSent) {
        res.status(403).json({ error: reason, code: 'human_lease_ended' });
      } else {
        try { res.destroy(); } catch {}
      }
    };

    const upstream = http.request({
      host: SPACES_HOST,
      port: spacesPort,
      method: 'POST',
      path: `${safe.pathname}${safe.search}`,
      headers: upstreamHeaders,
      timeout: SPACES_HTTP_TIMEOUT_MS,
    }, (upstreamRes) => {
      if (finished) { upstreamRes.destroy(); return; }
      activeRes = upstreamRes;
      res.status(upstreamRes.statusCode ?? 502);
      copySpacesResponseHeaders(upstreamRes, res);
      upstreamRes.pipe(res);
      upstreamRes.on('end', cleanupRequest);
      upstreamRes.on('close', cleanupRequest);
      upstreamRes.on('error', () => {
        cleanupRequest();
        try { res.end(); } catch {}
      });
      res.on('close', () => {
        cleanupRequest();
        try { upstreamRes.destroy(); } catch {}
      });
    });

    activeSpacesRequests.add(abortOnRevoke);

    upstream.on('timeout', () => {
      cleanupRequest();
      try { upstream.destroy(); } catch {}
      if (!res.headersSent) res.status(504).json({ error: 'Upstream timeout' });
    });
    upstream.on('error', () => {
      cleanupRequest();
      if (!res.headersSent) res.status(502).json({ error: 'Computer-use viewer upstream unavailable' });
    });
    req.on('aborted', () => {
      cleanupRequest();
      try { upstream.destroy(); } catch {}
    });
    res.on('close', cleanupRequest);

    req.pipe(upstream);
  };

  /**
   * WebSocket upgrade proxy for `/api/cu/spaces/media` -> `ws://127.0.0.1:3211/media`.
   * Validates the handshake before dialing, preserves `Sec-WebSocket-Protocol`
   * (e.g. `rcdp.v2`), enforces backpressure and missed-pong eviction, and closes
   * EVERY proxied `/media` socket when the human epoch ends or broker watch drops.
   */
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean {
    if (!url.pathname.startsWith(`${SPACES_PREFIX}/`)) return false;
    if (!broker.available()) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return true;
    }
    ensureEpochWatcher();
    if (!ports.upgradeAuthorized(req, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return true;
    }
    const rawUrl = req.url || '';
    if (!rawUrl.startsWith(`${SPACES_PREFIX}/`)) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return true;
    }
    const suffix = rawUrl.slice(SPACES_PREFIX.length);
    const safe = sanitizeSpacesPath(suffix);
    if (!safe) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return true;
    }
    if (!isAllowedSpacesWsPath(safe.pathname)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return true;
    }

    const handshake = validateWebSocketHandshake(req);
    if (!handshake) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return true;
    }

    // Fail closed if the broker event watch is not synced: wait briefly when
    // an initial watcher handshake is in flight, otherwise refuse with 503.
    const beginUpstreamDial = () => {
      if (stopped || socket.destroyed) return;
      if (!brokerWatchSynced) {
        try { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); } catch {}
        try { socket.destroy(); } catch {}
        return;
      }

      const upstreamUrl = `ws://${SPACES_HOST}:${spacesPort}${safe.pathname}${safe.search}`;
      let upstreamWs: WS.WebSocket;
      try {
        upstreamWs = new WebSocket(upstreamUrl, handshake.protocols, {
          perMessageDeflate: false,
          handshakeTimeout: SPACES_HTTP_TIMEOUT_MS,
          headers: { host: `${SPACES_HOST}:${spacesPort}` },
        });
      } catch {
        try { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
        try { socket.destroy(); } catch {}
        return;
      }

      let settled = false;
      let admitted = false;
      const rejectHandshake = (statusLine: string) => {
        if (settled) return;
        settled = true;
        pendingMediaUpgrades.delete(rejectHandshake);
        socket.removeListener('close', onClientEarlyClose);
        socket.removeListener('error', onClientEarlyClose);
        negotiatedProtocols.delete(req);
        try { upstreamWs.terminate(); } catch {}
        try { socket.write(`${statusLine}\r\n\r\n`); } catch {}
        try { socket.destroy(); } catch {}
      };

      const onClientEarlyClose = () => {
        if (admitted) return;
        settled = true;
        pendingMediaUpgrades.delete(rejectHandshake);
        negotiatedProtocols.delete(req);
        try { upstreamWs.terminate(); } catch {}
      };

      pendingMediaUpgrades.add(rejectHandshake);
      socket.once('close', onClientEarlyClose);
      socket.once('error', onClientEarlyClose);

      upstreamWs.once('unexpected-response', (_req, upstreamRes) => {
        upstreamRes.resume();
        rejectHandshake(`HTTP/1.1 ${upstreamRes.statusCode ?? 502} ${upstreamRes.statusMessage || ''}`.trimEnd());
      });
      upstreamWs.once('error', () => {
        rejectHandshake('HTTP/1.1 502 Bad Gateway');
      });

      upstreamWs.once('open', () => {
        if (settled || stopped || socket.destroyed || !brokerWatchSynced) {
          rejectHandshake('HTTP/1.1 503 Service Unavailable');
          return;
        }
        if (upstreamWs.protocol) negotiatedProtocols.set(req, upstreamWs.protocol);

        // Keep onClientEarlyClose attached across handleUpgrade so if ws rejects
        // the handshake without invoking the callback, upstreamWs is still closed.
        try {
          wss.handleUpgrade(req, socket, head, (clientWs) => {
            negotiatedProtocols.delete(req);
            if (settled || stopped || !brokerWatchSynced) {
              try { clientWs.terminate(); } catch {}
              try { upstreamWs.terminate(); } catch {}
              return;
            }
            admitted = true;
            settled = true;
            pendingMediaUpgrades.delete(rejectHandshake);
            socket.removeListener('close', onClientEarlyClose);
            socket.removeListener('error', onClientEarlyClose);

            let closed = false;
            let pingTimer: NodeJS.Timeout | null = null;
            let clientAlive = true;
            let upstreamAlive = true;

            const cleanup = () => {
              if (closed) return;
              closed = true;
              if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
              activeMediaSockets.delete(revokeSocket);
            };

            const forceClose = (code = 4001, reason = 'Human lease ended', immediate = false) => {
              cleanup();
              try {
                if (!immediate && clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason);
                else clientWs.terminate();
              } catch {}
              try {
                upstreamWs.terminate();
              } catch {}
            };

            const revokeSocket = (reason: string) => {
              forceClose(reason === 'Server shutting down' ? 1001 : 4001, reason, reason === 'Server shutting down');
            };

            activeMediaSockets.add(revokeSocket);

            const forwardFrame = (target: WS.WebSocket, data: WS.RawData, isBinary: boolean) => {
              if (closed || target.readyState !== WebSocket.OPEN) return;
              const frameBytes = rawDataByteLength(data);
              if (target.bufferedAmount + frameBytes > wsMaxBufferedBytes) {
                forceClose(1008, 'Media buffer limit exceeded', true);
                return;
              }
              try {
                target.send(data, { binary: isBinary });
              } catch {
                forceClose(1011, 'Media send failed', true);
                return;
              }
              if (target.bufferedAmount > wsMaxBufferedBytes) {
                forceClose(1008, 'Media buffer limit exceeded', true);
              }
            };

            clientWs.on('message', (data, isBinary) => forwardFrame(upstreamWs, data, isBinary));
            upstreamWs.on('message', (data, isBinary) => forwardFrame(clientWs, data, isBinary));

            clientWs.on('pong', () => { clientAlive = true; });
            upstreamWs.on('pong', () => { upstreamAlive = true; });

            clientWs.on('close', (code, reason) => {
              cleanup();
              if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
                const safeCode = safeCloseCode(code);
                try {
                  if (safeCode !== undefined) upstreamWs.close(safeCode, reason.toString('utf8').slice(0, 120));
                  else upstreamWs.close();
                } catch {
                  try { upstreamWs.terminate(); } catch {}
                }
              }
            });
            upstreamWs.on('close', (code, reason) => {
              cleanup();
              if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
                const safeCode = safeCloseCode(code);
                try {
                  if (safeCode !== undefined) clientWs.close(safeCode, reason.toString('utf8').slice(0, 120));
                  else clientWs.close();
                } catch {
                  try { clientWs.terminate(); } catch {}
                }
              }
            });

            clientWs.on('error', () => forceClose(1011, 'Client socket error', true));
            upstreamWs.on('error', () => forceClose(1011, 'Upstream socket error', true));

            if (wsPingIntervalMs > 0) {
              pingTimer = setInterval(() => {
                if (!clientAlive || !upstreamAlive) {
                  forceClose(1001, 'WebSocket keepalive timed out', true);
                  return;
                }
                clientAlive = false;
                upstreamAlive = false;
                if (clientWs.readyState === WebSocket.OPEN) {
                  try { clientWs.ping(); } catch { forceClose(1011, 'Client ping failed', true); return; }
                }
                if (upstreamWs.readyState === WebSocket.OPEN) {
                  try { upstreamWs.ping(); } catch { forceClose(1011, 'Upstream ping failed', true); }
                }
              }, wsPingIntervalMs);
              pingTimer.unref();
            }
          });
        } catch {
          rejectHandshake('HTTP/1.1 400 Bad Request');
        }
      });
    };

    if (brokerWatchSynced) {
      beginUpstreamDial();
    } else {
      void waitForWatchSync().then(beginUpstreamDial);
    }

    return true;
  }

  function stop(): void {
    stopped = true;
    brokerWatchSynced = false;
    brokerState = null;
    stopEpochWatcher();
    resolveWatchSyncWaiters();
    revokeAllActive('Server shutting down');
    try { wss.close(); } catch {}
  }

  return {
    available: () => broker.available(),
    status,
    stream,
    takeover,
    heartbeat,
    release,
    viewerTicket,
    audit,
    spacesProxy,
    upgrade,
    stop,
  };
}
