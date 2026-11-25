// Generated from src/core/cu-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_SPACES_REQUEST_HEADERS = exports.ALLOWED_SPACES_GRPC_INTERACTIVE_PATHS = exports.ALLOWED_SPACES_GRPC_VIEW_PATHS = exports.CU_VIEWER_CSP = exports.CU_FETCH_CREDS_JS = exports.SPACES_HTTP_TIMEOUT_MS = void 0;
exports.classifySpacesHttpRoute = classifySpacesHttpRoute;
exports.isAllowedSpacesWsPath = isAllowedSpacesWsPath;
exports.sanitizeSpacesPath = sanitizeSpacesPath;
exports.injectFetchCredsScript = injectFetchCredsScript;
exports.serveVendoredCuViewer = serveVendoredCuViewer;
exports.connectionNominatedHeaders = connectionNominatedHeaders;
exports.buildSpacesRequestHeaders = buildSpacesRequestHeaders;
exports.validateWebSocketHandshake = validateWebSocketHandshake;
exports.extractCuaBearerTicket = extractCuaBearerTicket;
exports.extractMediaWsTickets = extractMediaWsTickets;
exports.validateOpenMediaRequest = validateOpenMediaRequest;
exports.parseOpenMediaResponse = parseOpenMediaResponse;
exports.createCuHandlers = createCuHandlers;
/**
 * Guest-side computer-use HTTP routes, allowlisted cua-spacesd (127.0.0.1:3211)
 * gRPC-Web/WS proxy, vendored cua-spacesd v0.17.7 HTML5 viewer asset server,
 * and fail-closed broker-epoch revocation.
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const cu_broker_1 = require("./cu-broker");
const http_boundary_1 = require("./http-boundary");
const helper_values_1 = require("./helper-values");
const SPACES_HOST = '127.0.0.1';
const DEFAULT_SPACES_PORT = 3211;
const SPACES_PREFIX = '/api/cu/spaces';
// Guest proxy deadline sits between broker (8s) and hub relay (15s).
exports.SPACES_HTTP_TIMEOUT_MS = 10_000;
const WS_PING_INTERVAL_MS = 30_000;
const DEFAULT_WS_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const EPOCH_WATCH_RETRY_MS = 2_000;
const WATCH_SYNC_WAIT_MS = 1_500;
const DEFAULT_HUMAN_TTL_SEC = 600;
const MAX_SSE_ERROR_BYTES = 64 * 1024;
const MAX_SSE_EVENT_BYTES = 256 * 1024;
const MAX_OPEN_MEDIA_REQUEST_BYTES = 64 * 1024;
const MAX_OPEN_MEDIA_RESPONSE_BYTES = 256 * 1024;
const MAX_TRACKED_TICKETS = 512;
const DEFAULT_VIEWER_TICKET_TTL_MS = 60 * 60_000;
const DEFAULT_MEDIA_TICKET_TTL_MS = 10 * 60_000;
const MAX_MEDIA_TICKET_TTL_MS = 15 * 60_000;
const MAX_WS_PROTOCOLS = 8;
const OPEN_MEDIA_PATH = '/cua.env.v1.StreamService/OpenMedia';
const WS_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const WS_KEY_RE = /^[A-Za-z0-9+/]{22}==$/;
// Minimal same-origin shim: viewer.js fetches gRPC-Web POSTs with
// credentials:"omit", which drops the Cloudflare Access cookie (CF_Authorization)
// even on same-origin calls. Served externally so script-src 'self' stays intact.
exports.CU_FETCH_CREDS_JS = `(() => {
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
exports.CU_VIEWER_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; " +
    "connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
const VENDOR_VIEWER_DIR = path.resolve(__dirname, '..', 'vendor', 'cua-viewer');
const VENDORED_VIEWER_SPECS = {
    'index.html': { file: 'index.html', contentType: 'text/html; charset=utf-8', injectCreds: true },
    'index.css': { file: 'index.css', contentType: 'text/css; charset=utf-8' },
    'viewer.js': { file: 'viewer.js', contentType: 'text/javascript; charset=utf-8' },
    'audioWorklet.js': { file: 'audioWorklet.js', contentType: 'text/javascript; charset=utf-8' },
    'captureWorklet.js': { file: 'captureWorklet.js', contentType: 'text/javascript; charset=utf-8' },
};
let cachedVendoredAssets = null;
function loadVendoredViewerAssets() {
    if (cachedVendoredAssets)
        return cachedVendoredAssets;
    const assets = new Map();
    for (const [name, spec] of Object.entries(VENDORED_VIEWER_SPECS)) {
        const raw = fs.readFileSync(path.join(VENDOR_VIEWER_DIR, spec.file));
        const body = spec.injectCreds
            ? Buffer.from(injectFetchCredsScript(raw.toString('utf8')), 'utf8')
            : raw;
        assets.set(name, {
            contentType: spec.contentType,
            csp: exports.CU_VIEWER_CSP,
            body,
        });
    }
    assets.set('cu-fetch-creds.js', {
        contentType: 'application/javascript; charset=utf-8',
        csp: "default-src 'none'",
        isShim: true,
        body: Buffer.from(exports.CU_FETCH_CREDS_JS, 'utf8'),
    });
    cachedVendoredAssets = assets;
    return assets;
}
/**
 * Allowlisted gRPC-Web RPCs required by the pinned cua-spacesd v0.17.7 viewer.
 * File handlers (/files, /share, FilesystemService), ProcessService,
 * DriverService, WindowsService, and guest-supplied HTML are unreachable.
 */
exports.ALLOWED_SPACES_GRPC_VIEW_PATHS = new Set([
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
exports.ALLOWED_SPACES_GRPC_INTERACTIVE_PATHS = new Set([
    '/cua.env.v1.ComputerService/GetClipboard',
    '/cua.env.v1.ComputerService/SetClipboard',
]);
function classifySpacesHttpRoute(pathname) {
    if (exports.ALLOWED_SPACES_GRPC_VIEW_PATHS.has(pathname))
        return 'view';
    if (exports.ALLOWED_SPACES_GRPC_INTERACTIVE_PATHS.has(pathname))
        return 'interactive';
    return null;
}
function isAllowedSpacesWsPath(pathname) {
    return pathname === '/media';
}
// Strict allowlist of request headers forwarded to loopback 127.0.0.1:3211.
// Hop-by-hop, Authorization, Cookie, Cloudflare Access, proxy-identity and
// pi-dish internal headers are never forwarded.
exports.ALLOWED_SPACES_REQUEST_HEADERS = [
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
const HOP_BY_HOP_RESPONSE_HEADERS = {
    connection: true,
    'keep-alive': true,
    'proxy-authenticate': true,
    'proxy-authorization': true,
    te: true,
    trailer: true,
    'transfer-encoding': true,
    upgrade: true,
};
/**
 * Validates and normalizes a `/api/cu/spaces/*` suffix before it reaches
 * vendored viewer serving or `127.0.0.1:3211`. Refuses dot segments (including
 * multi-encoded), encoded path separators, backslashes, empty interior
 * segments, and control chars.
 */
function sanitizeSpacesPath(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/'))
        return null;
    const hashIndex = rawUrl.indexOf('#');
    const withoutHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl;
    const queryIndex = withoutHash.indexOf('?');
    const rawPath = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
    const search = queryIndex >= 0 ? withoutHash.slice(queryIndex) : '';
    if (/[\u0000-\u001f\u007f]/.test(rawPath) || /[\u0000-\u001f\u007f]/.test(search))
        return null;
    if (rawPath.includes('\\') || rawPath.startsWith('//'))
        return null;
    if (rawPath === '/')
        return { pathname: '/', search };
    const trailingSlash = rawPath.endsWith('/');
    const body = trailingSlash ? rawPath.slice(1, -1) : rawPath.slice(1);
    if (body === '')
        return null;
    const rawSegments = body.split('/');
    const encodedSegments = [];
    for (const segment of rawSegments) {
        if (!segment)
            return null;
        let reading = segment;
        let decodedOnce = null;
        for (let round = 0; round < 4; round++) {
            if (/[\u0000-\u001f\u007f\\]/.test(reading))
                return null;
            if (reading === '.' || reading === '..')
                return null;
            if (round > 0 && reading.includes('/'))
                return null;
            let next;
            try {
                next = decodeURIComponent(reading);
            }
            catch {
                return null;
            }
            if (round === 0)
                decodedOnce = next;
            if (next === reading)
                break;
            if (round === 3)
                return null;
            reading = next;
        }
        if (decodedOnce === null || decodedOnce === '.' || decodedOnce === '..')
            return null;
        if (/[\u0000-\u001f\u007f/\\]/.test(decodedOnce))
            return null;
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
function injectFetchCredsScript(html) {
    if (html.includes('./cu-fetch-creds.js'))
        return html;
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
function serveVendoredCuViewer(req, res, safe) {
    if (safe.pathname !== '/viewer' && !safe.pathname.startsWith('/viewer/'))
        return false;
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
    if (req.method === 'HEAD')
        res.end();
    else
        res.end(asset.body);
    return true;
}
/** Extracts lowercase Connection-nominated header names before dropping Connection. */
function connectionNominatedHeaders(headerValue) {
    const raw = Array.isArray(headerValue) ? headerValue.join(',') : String(headerValue || '');
    return new Set(raw
        .split(',')
        .map(token => token.trim().toLowerCase())
        .filter(Boolean));
}
/** Builds allowlisted outbound HTTP headers for loopback `127.0.0.1:3211`. */
function buildSpacesRequestHeaders(incoming, port) {
    const out = {
        host: `${SPACES_HOST}:${port}`,
        'accept-encoding': 'identity',
    };
    const nominated = connectionNominatedHeaders(incoming.connection);
    for (const name of exports.ALLOWED_SPACES_REQUEST_HEADERS) {
        if (nominated.has(name))
            continue;
        const value = incoming[name];
        if (value !== undefined)
            out[name] = value;
    }
    return out;
}
/**
 * Validates the downstream RFC 6455 handshake before dialing upstream so a
 * malformed upgrade (bad key/version, invalid or duplicated Sec-WebSocket-Protocol)
 * never crashes ws or wastes an upstream dial.
 */
function validateWebSocketHandshake(req) {
    if (req.method !== 'GET')
        return null;
    const upgradeHeader = Array.isArray(req.headers.upgrade) ? req.headers.upgrade[0] : req.headers.upgrade;
    if (typeof upgradeHeader !== 'string' || upgradeHeader.trim().toLowerCase() !== 'websocket')
        return null;
    const connectionTokens = connectionNominatedHeaders(req.headers.connection);
    if (!connectionTokens.has('upgrade'))
        return null;
    const version = req.headers['sec-websocket-version'];
    if (version !== '13')
        return null;
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || !WS_KEY_RE.test(key.trim()))
        return null;
    const rawProto = req.headers['sec-websocket-protocol'];
    if (rawProto === undefined)
        return { protocols: [] };
    const combined = Array.isArray(rawProto) ? rawProto.join(',') : rawProto;
    const parts = combined.split(',');
    if (parts.length > MAX_WS_PROTOCOLS)
        return null;
    const protocols = [];
    const seen = new Set();
    for (const part of parts) {
        const token = part.trim();
        if (!token || !WS_TOKEN_RE.test(token))
            return null;
        if (seen.has(token))
            return null;
        seen.add(token);
        protocols.push(token);
    }
    return { protocols };
}
function extractCuaBearerTicket(headerValue) {
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof raw !== 'string')
        return null;
    const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
    return match && match[1].trim() ? match[1].trim() : null;
}
/**
 * Extracts all media ticket credentials from a `/media` WebSocket upgrade:
 * `?ticket=` query parameters plus `cua.ticket.<ticket>` / legacy
 * `rcdp.v2.ticket.<ticket>` WebSocket subprotocols (MEDIA.md §2).
 */
function extractMediaWsTickets(url, protocols) {
    const tickets = [];
    for (const q of url.searchParams.getAll('ticket')) {
        const trimmed = q.trim();
        if (trimmed)
            tickets.push(trimmed);
    }
    for (const proto of protocols) {
        if (proto.startsWith('cua.ticket.') && proto.length > 'cua.ticket.'.length) {
            tickets.push(proto.slice('cua.ticket.'.length));
        }
        else if (proto.startsWith('rcdp.v2.ticket.') && proto.length > 'rcdp.v2.ticket.'.length) {
            tickets.push(proto.slice('rcdp.v2.ticket.'.length));
        }
    }
    return tickets;
}
function readProtobufVarint(buf, start) {
    let result = 0n;
    let shift = 0n;
    let pos = start;
    for (let i = 0; i < 10; i++) {
        if (pos >= buf.length)
            return null;
        const byte = buf[pos++];
        result |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0)
            return { value: result, next: pos };
        shift += 7n;
    }
    return null;
}
function parseTimestampSecondsMs(buf) {
    let pos = 0;
    let seconds = null;
    while (pos < buf.length) {
        const tag = readProtobufVarint(buf, pos);
        if (!tag)
            return null;
        pos = tag.next;
        const field = Number(tag.value >> 3n);
        const wire = Number(tag.value & 7n);
        if (wire === 0) {
            const val = readProtobufVarint(buf, pos);
            if (!val)
                return null;
            pos = val.next;
            if (field === 1)
                seconds = val.value;
        }
        else if (wire === 1) {
            if (pos + 8 > buf.length)
                return null;
            pos += 8;
        }
        else if (wire === 2) {
            const len = readProtobufVarint(buf, pos);
            if (!len || len.value > BigInt(buf.length - len.next))
                return null;
            pos = len.next + Number(len.value);
        }
        else if (wire === 5) {
            if (pos + 4 > buf.length)
                return null;
            pos += 4;
        }
        else {
            return null;
        }
    }
    if (seconds === null || seconds <= 0n || seconds > 253402300799n)
        return null;
    return Number(seconds) * 1000;
}
function parseOpenMediaProto(buf) {
    let pos = 0;
    let ticket = '';
    let wsPath = '';
    let expiresAtMs = null;
    while (pos < buf.length) {
        const tag = readProtobufVarint(buf, pos);
        if (!tag)
            return null;
        pos = tag.next;
        const field = Number(tag.value >> 3n);
        const wire = Number(tag.value & 7n);
        if (wire === 0) {
            const val = readProtobufVarint(buf, pos);
            if (!val)
                return null;
            pos = val.next;
        }
        else if (wire === 1) {
            if (pos + 8 > buf.length)
                return null;
            pos += 8;
        }
        else if (wire === 2) {
            const len = readProtobufVarint(buf, pos);
            if (!len || len.value > BigInt(buf.length - len.next))
                return null;
            const slice = buf.subarray(len.next, len.next + Number(len.value));
            pos = len.next + Number(len.value);
            if (field === 2)
                ticket = slice.toString('utf8').trim();
            else if (field === 3)
                expiresAtMs = parseTimestampSecondsMs(slice);
            else if (field === 4)
                wsPath = slice.toString('utf8').trim();
        }
        else if (wire === 5) {
            if (pos + 4 > buf.length)
                return null;
            pos += 4;
        }
        else {
            return null;
        }
    }
    let wsTicket = '';
    if (wsPath) {
        try {
            const parsed = new URL(wsPath, 'http://localhost');
            if (parsed.pathname !== '/media')
                return null;
            const wsTickets = parsed.searchParams.getAll('ticket').map(s => s.trim()).filter(Boolean);
            const uniqueWsTickets = new Set(wsTickets);
            if (uniqueWsTickets.size > 1)
                return null;
            wsTicket = wsTickets[0] ?? '';
        }
        catch {
            return null;
        }
    }
    if (ticket && wsTicket && ticket !== wsTicket)
        return null;
    const resolved = ticket || wsTicket;
    if (!resolved)
        return null;
    return { ticket: resolved, expiresAtMs };
}
function parseMediaTargetDisplayOnly(buf, state) {
    let pos = 0;
    while (pos < buf.length) {
        const tag = readProtobufVarint(buf, pos);
        if (!tag || tag.value === 0n || tag.value > 0xffffffffn)
            return false;
        pos = tag.next;
        const field = Number(tag.value >> 3n);
        const wire = Number(tag.value & 7n);
        // MediaTarget.target oneof: only field 1 (string display_id, wire 2) is permitted.
        // Field 2 (WindowRef window) and any other field or wire type fail closed.
        if (field !== 1 || wire !== 2)
            return false;
        const len = readProtobufVarint(buf, pos);
        if (!len || len.value > BigInt(buf.length - len.next))
            return false;
        const slice = buf.subarray(len.next, len.next + Number(len.value));
        pos = len.next + Number(len.value);
        state.hasDisplayId = true;
        state.displayId = slice.toString('utf8');
    }
    return true;
}
function validateOpenMediaRequestProto(buf) {
    let pos = 0;
    const targetState = { hasDisplayId: false, displayId: '' };
    while (pos < buf.length) {
        const tag = readProtobufVarint(buf, pos);
        if (!tag || tag.value === 0n || tag.value > 0xffffffffn) {
            return { ok: false, error: 'Malformed OpenMediaRequest protobuf' };
        }
        pos = tag.next;
        const field = Number(tag.value >> 3n);
        const wire = Number(tag.value & 7n);
        if (field <= 0)
            return { ok: false, error: 'Malformed OpenMediaRequest protobuf' };
        if (field === 1) {
            if (wire !== 2)
                return { ok: false, error: 'Invalid OpenMediaRequest target' };
            const len = readProtobufVarint(buf, pos);
            if (!len || len.value > BigInt(buf.length - len.next)) {
                return { ok: false, error: 'Malformed OpenMediaRequest target' };
            }
            const slice = buf.subarray(len.next, len.next + Number(len.value));
            pos = len.next + Number(len.value);
            if (!parseMediaTargetDisplayOnly(slice, targetState)) {
                return { ok: false, error: 'Only display media targets are allowed' };
            }
        }
        else if (field === 7) {
            // GeometryControl: 0 = UNSPECIFIED (observe-only), 1 = OBSERVE_ONLY.
            // 2 = BIDIRECTIONAL or any other value fails closed.
            if (wire !== 0)
                return { ok: false, error: 'Invalid OpenMediaRequest geometry_control' };
            const val = readProtobufVarint(buf, pos);
            if (!val)
                return { ok: false, error: 'Malformed OpenMediaRequest geometry_control' };
            pos = val.next;
            if (val.value !== 0n && val.value !== 1n) {
                return { ok: false, error: 'Geometry control must be observe-only' };
            }
        }
        else if (wire === 0) {
            const val = readProtobufVarint(buf, pos);
            if (!val)
                return { ok: false, error: 'Malformed OpenMediaRequest protobuf' };
            pos = val.next;
        }
        else if (wire === 1) {
            if (pos + 8 > buf.length)
                return { ok: false, error: 'Malformed OpenMediaRequest protobuf' };
            pos += 8;
        }
        else if (wire === 2) {
            const len = readProtobufVarint(buf, pos);
            if (!len || len.value > BigInt(buf.length - len.next)) {
                return { ok: false, error: 'Malformed OpenMediaRequest protobuf' };
            }
            pos = len.next + Number(len.value);
        }
        else if (wire === 5) {
            if (pos + 4 > buf.length)
                return { ok: false, error: 'Malformed OpenMediaRequest protobuf' };
            pos += 4;
        }
        else {
            return { ok: false, error: 'Unsupported OpenMediaRequest wire type' };
        }
    }
    const displayId = targetState.displayId.trim();
    if (!targetState.hasDisplayId || !displayId || /[\u0000-\u001f\u007f]/.test(displayId)) {
        return { ok: false, error: 'OpenMediaRequest requires a display target' };
    }
    return { ok: true, displayId };
}
/**
 * Validates a `StreamService.OpenMedia` gRPC-Web request (`grpc-web+proto` or
 * `grpc-web-text+proto`) before forwarding to `127.0.0.1:3211`. Fails closed
 * unless the target is a display target (`MediaTarget.display_id`, never a
 * window) and `geometry_control` is absent or observe-only (`0` or `1`).
 */
function validateOpenMediaRequest(contentType, contentEncoding, grpcEncoding, body) {
    const rawCe = Array.isArray(contentEncoding) ? contentEncoding.join(',') : contentEncoding;
    if (typeof rawCe === 'string' && rawCe.trim() !== '' && rawCe.trim().toLowerCase() !== 'identity') {
        return { ok: false, error: 'Unsupported OpenMedia content encoding' };
    }
    const rawGe = Array.isArray(grpcEncoding) ? grpcEncoding.join(',') : grpcEncoding;
    if (typeof rawGe === 'string' && rawGe.trim() !== '' && rawGe.trim().toLowerCase() !== 'identity') {
        return { ok: false, error: 'Unsupported OpenMedia gRPC encoding' };
    }
    const rawCt = Array.isArray(contentType) ? contentType[0] : contentType;
    const mime = typeof rawCt === 'string' ? rawCt.split(';')[0].trim().toLowerCase() : '';
    let frames;
    if (mime === 'application/grpc-web' || mime === 'application/grpc-web+proto') {
        frames = body;
    }
    else if (mime === 'application/grpc-web-text' || mime === 'application/grpc-web-text+proto') {
        const cleaned = body.toString('latin1').replace(/\s+/g, '');
        if (!cleaned || cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
            return { ok: false, error: 'Malformed grpc-web-text OpenMedia request' };
        }
        frames = Buffer.from(cleaned, 'base64');
    }
    else {
        return { ok: false, error: 'Unsupported OpenMedia content type' };
    }
    if (frames.length < 5)
        return { ok: false, error: 'Malformed OpenMedia gRPC-Web frame' };
    const flags = frames[0];
    if (flags !== 0x00) {
        return { ok: false, error: 'Compressed or non-data OpenMedia request frame is not allowed' };
    }
    const len = frames.readUInt32BE(1);
    if (5 + len !== frames.length)
        return { ok: false, error: 'Invalid OpenMedia gRPC-Web frame length' };
    return validateOpenMediaRequestProto(frames.subarray(5, 5 + len));
}
/**
 * Extracts the media ticket and expiry from a `StreamService.OpenMedia`
 * gRPC-Web response (`application/grpc-web+proto` or `grpc-web-text+proto`)
 * per pinned `cua-spacesd v0.17.7` `stream.proto`.
 */
function parseOpenMediaResponse(contentType, grpcStatusHeader, body) {
    const headerStatus = Array.isArray(grpcStatusHeader) ? grpcStatusHeader[0] : grpcStatusHeader;
    if (typeof headerStatus === 'string' && headerStatus.trim() !== '' && headerStatus.trim() !== '0') {
        return { kind: 'grpc-error' };
    }
    const rawCt = Array.isArray(contentType) ? contentType[0] : contentType;
    const mime = typeof rawCt === 'string' ? rawCt.split(';')[0].trim().toLowerCase() : '';
    let frames;
    if (mime === 'application/grpc-web' || mime === 'application/grpc-web+proto') {
        frames = body;
    }
    else if (mime === 'application/grpc-web-text' || mime === 'application/grpc-web-text+proto') {
        const cleaned = body.toString('ascii').replace(/\s+/g, '');
        if (!cleaned || cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
            return { kind: 'invalid' };
        }
        frames = Buffer.from(cleaned, 'base64');
    }
    else {
        return { kind: 'invalid' };
    }
    let offset = 0;
    let dataPayload = null;
    let trailerGrpcStatus = null;
    while (offset < frames.length) {
        if (offset + 5 > frames.length)
            return { kind: 'invalid' };
        const flags = frames[offset];
        const len = frames.readUInt32BE(offset + 1);
        offset += 5;
        if (offset + len > frames.length)
            return { kind: 'invalid' };
        const payload = frames.subarray(offset, offset + len);
        offset += len;
        if ((flags & 0x80) !== 0) {
            const trailerText = payload.toString('ascii');
            for (const line of trailerText.split(/\r?\n/)) {
                const idx = line.indexOf(':');
                if (idx <= 0)
                    continue;
                if (line.slice(0, idx).trim().toLowerCase() === 'grpc-status') {
                    trailerGrpcStatus = line.slice(idx + 1).trim();
                }
            }
        }
        else if ((flags & 0x01) !== 0) {
            // Compressed data frame cannot be inspected: fail closed.
            return { kind: 'invalid' };
        }
        else if (flags === 0x00) {
            if (dataPayload !== null)
                return { kind: 'invalid' };
            dataPayload = payload;
        }
        else {
            return { kind: 'invalid' };
        }
    }
    if (trailerGrpcStatus !== null && trailerGrpcStatus !== '0') {
        return { kind: 'grpc-error' };
    }
    if (!dataPayload)
        return { kind: 'invalid' };
    const parsed = parseOpenMediaProto(dataPayload);
    if (!parsed)
        return { kind: 'invalid' };
    return { kind: 'ok', ticket: parsed.ticket, expiresAtMs: parsed.expiresAtMs };
}
function rawDataByteLength(data) {
    if (Buffer.isBuffer(data))
        return data.length;
    if (data instanceof ArrayBuffer)
        return data.byteLength;
    if (Array.isArray(data)) {
        let total = 0;
        for (const chunk of data)
            total += chunk.length;
        return total;
    }
    return 0;
}
function safeCloseCode(code) {
    if (code === 1000 || (code >= 3000 && code <= 4999))
        return code;
    if (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006)
        return code;
    return undefined;
}
function pickString(source, key) {
    const value = source[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function pickFiniteNumber(source, key) {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function pickBoolean(source, key) {
    const value = source[key];
    return typeof value === 'boolean' ? value : undefined;
}
function normalizeBrokerErrorBody(status, body) {
    if (!(0, helper_values_1.record)(body))
        return body ?? { error: `Broker returned HTTP ${status}` };
    if (status < 400)
        return body;
    const out = { ...body };
    if (typeof out.error !== 'string' || !out.error) {
        if (typeof out.message === 'string' && out.message)
            out.error = out.message;
        else if (status === 409)
            out.error = 'Computer-use seat is busy';
        else
            out.error = `Broker returned HTTP ${status}`;
    }
    if (status === 409 && out.holder === undefined && (0, helper_values_1.record)(out.lease)) {
        out.holder = out.lease;
    }
    return out;
}
function withSpacesViewerPath(viewer) {
    if (!(0, helper_values_1.record)(viewer))
        return null;
    const viewerPath = typeof viewer.path === 'string' ? viewer.path : null;
    if (!viewerPath)
        return viewer;
    const spacesPath = viewerPath.startsWith(SPACES_PREFIX)
        ? viewerPath
        : `${SPACES_PREFIX}${viewerPath.startsWith('/') ? '' : '/'}${viewerPath}`;
    return { ...viewer, spacesPath };
}
function createCuHandlers(ports) {
    const broker = ports.broker ?? (0, cu_broker_1.createCuBrokerClient)({ socketPath: ports.socketPath });
    const normalizePublic = (payload) => (ports.normalizePublicPayload ? ports.normalizePublicPayload(payload) : payload);
    const spacesPort = Number.isInteger(ports.spacesPort) && ports.spacesPort > 0 && ports.spacesPort <= 65535
        ? ports.spacesPort
        : DEFAULT_SPACES_PORT;
    const wsPingIntervalMs = ports.wsPingIntervalMs ?? WS_PING_INTERVAL_MS;
    const wsMaxBufferedBytes = ports.wsMaxBufferedBytes ?? DEFAULT_WS_MAX_BUFFERED_BYTES;
    const watchRetryMs = ports.watchRetryMs ?? EPOCH_WATCH_RETRY_MS;
    const maxSseEventBytes = ports.maxSseEventBytes ?? MAX_SSE_EVENT_BYTES;
    const maxSseErrorBytes = ports.maxSseErrorBytes ?? MAX_SSE_ERROR_BYTES;
    const { WebSocket, WebSocketServer } = require('ws');
    const negotiatedProtocols = new WeakMap();
    const wss = new WebSocketServer({
        noServer: true,
        perMessageDeflate: false,
        handleProtocols: (_protocols, req) => negotiatedProtocols.get(req) ?? false,
    });
    const viewerTickets = new Map();
    const mediaTickets = new Map();
    const activeMediaSockets = new Set();
    const pendingMediaUpgrades = new Set();
    const activeSpacesRequests = new Set();
    const activeBrokerStreams = new Set();
    let stopped = false;
    let watcherReq = null;
    let watcherRes = null;
    let watcherRetryTimer = null;
    let brokerWatchSynced = false;
    let brokerState = null;
    let latestEpoch = -1;
    let watchSyncWaiters = [];
    function isHumanControlActive() {
        return brokerWatchSynced && brokerState === 'human';
    }
    function pruneTicketMap(map, nowMs = Date.now()) {
        for (const [ticket, entry] of map) {
            if (entry.expiresAtMs <= nowMs)
                map.delete(ticket);
        }
    }
    function recordTicket(map, ticket, entry) {
        const nowMs = Date.now();
        pruneTicketMap(map, nowMs);
        if (entry.expiresAtMs <= nowMs)
            return;
        map.delete(ticket);
        while (map.size >= MAX_TRACKED_TICKETS) {
            const oldest = map.keys().next().value;
            if (oldest === undefined)
                break;
            map.delete(oldest);
        }
        map.set(ticket, entry);
    }
    function revokeInteractiveTickets(keepHumanEpoch) {
        for (const map of [viewerTickets, mediaTickets]) {
            for (const [ticket, entry] of map) {
                if (entry.mode === 'interactive' && (keepHumanEpoch === null || entry.epoch !== keepHumanEpoch)) {
                    map.delete(ticket);
                }
            }
        }
    }
    function computeViewerExpiryMs(expiresAtRaw, ttlSecRaw) {
        const nowMs = Date.now();
        const parsed = typeof expiresAtRaw === 'string' ? Date.parse(expiresAtRaw) : Number.NaN;
        if (Number.isFinite(parsed))
            return parsed;
        if (typeof ttlSecRaw === 'number' && Number.isFinite(ttlSecRaw) && ttlSecRaw > 0) {
            return nowMs + ttlSecRaw * 1000;
        }
        return nowMs + DEFAULT_VIEWER_TICKET_TTL_MS;
    }
    function computeMediaExpiryMs(expiresAtMs) {
        const nowMs = Date.now();
        if (expiresAtMs !== null && Number.isFinite(expiresAtMs)) {
            return Math.min(expiresAtMs, nowMs + MAX_MEDIA_TICKET_TTL_MS);
        }
        return nowMs + DEFAULT_MEDIA_TICKET_TTL_MS;
    }
    function authorizeTrackedCredential(map, ticket, options = {}) {
        if (!ticket) {
            return { ok: false, status: 403, code: 'viewer_ticket_required', error: 'A valid computer-use ticket is required' };
        }
        const nowMs = Date.now();
        pruneTicketMap(map, nowMs);
        const entry = map.get(ticket);
        if (!entry) {
            return { ok: false, status: 403, code: 'ticket_unknown', error: 'Unknown, expired, or revoked computer-use ticket' };
        }
        if (options.requireInteractive && entry.mode !== 'interactive') {
            return { ok: false, status: 403, code: 'human_lease_required', error: 'Interactive viewer lease required' };
        }
        if (entry.mode === 'interactive') {
            if (!brokerWatchSynced) {
                return { ok: false, status: 503, code: 'broker_watch_unavailable', error: 'Computer-use broker watch is not synced' };
            }
            if (brokerState !== 'human' || entry.epoch !== latestEpoch) {
                map.delete(ticket);
                return { ok: false, status: 403, code: 'human_lease_ended', error: 'Interactive viewer lease has ended' };
            }
        }
        return { ok: true, entry };
    }
    function resolveWatchSyncWaiters() {
        const waiters = watchSyncWaiters;
        watchSyncWaiters = [];
        for (const notify of waiters)
            notify();
    }
    function revokeAllActive(reason) {
        for (const rejectPending of [...pendingMediaUpgrades])
            rejectPending('HTTP/1.1 403 Forbidden');
        pendingMediaUpgrades.clear();
        for (const closeSocket of [...activeMediaSockets])
            closeSocket(reason);
        activeMediaSockets.clear();
        for (const abortReq of [...activeSpacesRequests])
            abortReq(reason);
        activeSpacesRequests.clear();
    }
    function applyBrokerSnapshot(state, epoch, options = {}) {
        // Ignore stale status/ticket/release/event responses from an older epoch
        // unless this is a fresh authoritative hello snapshot after (re)connect.
        if (!options.authoritativeHello && epoch < latestEpoch)
            return false;
        const wasHuman = brokerState === 'human';
        const humanEpochEnded = wasHuman && (state !== 'human' || epoch !== latestEpoch);
        if (options.authoritativeHello)
            brokerWatchSynced = true;
        brokerState = state;
        latestEpoch = epoch;
        if (options.authoritativeHello)
            resolveWatchSyncWaiters();
        revokeInteractiveTickets(state === 'human' ? epoch : null);
        if (humanEpochEnded || (options.authoritativeHello && state !== 'human')) {
            revokeAllActive('Human lease ended');
        }
        return true;
    }
    function stopEpochWatcher() {
        if (watcherRetryTimer) {
            clearTimeout(watcherRetryTimer);
            watcherRetryTimer = null;
        }
        if (watcherRes) {
            try {
                watcherRes.destroy();
            }
            catch { }
            watcherRes = null;
        }
        if (watcherReq) {
            try {
                watcherReq.destroy();
            }
            catch { }
            watcherReq = null;
        }
    }
    function scheduleEpochWatcherRetry() {
        if (stopped || watcherRetryTimer || !broker.socketPath())
            return;
        watcherRetryTimer = setTimeout(() => {
            watcherRetryTimer = null;
            ensureEpochWatcher();
        }, watchRetryMs);
        watcherRetryTimer.unref();
    }
    function handleWatchLost() {
        brokerWatchSynced = false;
        brokerState = null;
        revokeInteractiveTickets(null);
        revokeAllActive('Broker watch lost');
        resolveWatchSyncWaiters();
        scheduleEpochWatcherRetry();
    }
    function ensureEpochWatcher() {
        if (stopped || watcherReq || !broker.socketPath())
            return;
        if (!broker.available()) {
            handleWatchLost();
            return;
        }
        let buffer = '';
        let eventName = '';
        let dataLines = [];
        let eventBytes = 0;
        let sawFirstEvent = false;
        let failed = false;
        const failWatcher = (req, res) => {
            if (failed)
                return;
            failed = true;
            if (res) {
                try {
                    res.destroy();
                }
                catch { }
            }
            if (req && watcherReq === req) {
                watcherReq = null;
                watcherRes = null;
                handleWatchLost();
            }
        };
        const flushEvent = () => {
            const currentEventName = eventName;
            eventName = '';
            if (!dataLines.length)
                return;
            const payload = dataLines.join('\n');
            dataLines = [];
            eventBytes = 0;
            let parsed;
            try {
                parsed = JSON.parse(payload);
            }
            catch {
                return;
            }
            if (!(0, helper_values_1.record)(parsed))
                return;
            const state = typeof parsed.state === 'string' ? parsed.state : null;
            const epoch = typeof parsed.epoch === 'number' && Number.isFinite(parsed.epoch) ? parsed.epoch : null;
            if (state === null || epoch === null)
                return;
            const authoritativeHello = !sawFirstEvent;
            sawFirstEvent = true;
            applyBrokerSnapshot(state, epoch, { authoritativeHello });
            ports.onBrokerEvent?.({
                eventName: currentEventName || (authoritativeHello ? 'hello' : 'message'),
                authoritativeHello,
                payload: parsed,
            });
        };
        const req = broker.openEvents((res) => {
            if (watcherReq !== req) {
                res.destroy();
                return;
            }
            watcherRes = res;
            if (res.statusCode !== 200) {
                res.resume();
                failWatcher(req, res);
                return;
            }
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                if (failed)
                    return;
                buffer += chunk;
                if (buffer.length > maxSseEventBytes) {
                    failWatcher(req, res);
                    return;
                }
                for (;;) {
                    const nl = buffer.indexOf('\n');
                    if (nl < 0)
                        break;
                    const line = buffer.slice(0, nl).replace(/\r$/, '');
                    buffer = buffer.slice(nl + 1);
                    if (line === '') {
                        flushEvent();
                    }
                    else if (line.startsWith('event:')) {
                        eventName = line.slice(6).trim();
                    }
                    else if (line.startsWith('data:')) {
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
        }, () => failWatcher(req, watcherRes));
        if (!req) {
            handleWatchLost();
            return;
        }
        watcherReq = req;
    }
    function waitForWatchSync(timeoutMs = WATCH_SYNC_WAIT_MS) {
        if (brokerWatchSynced)
            return Promise.resolve(true);
        ensureEpochWatcher();
        if (brokerWatchSynced)
            return Promise.resolve(true);
        if (!watcherReq)
            return Promise.resolve(false);
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done)
                    return;
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
    if (broker.socketPath())
        ensureEpochWatcher();
    function ensureAvailable(res) {
        if (broker.available()) {
            ensureEpochWatcher();
            return true;
        }
        res.status(404).json({ error: 'Computer-use is not available on this host' });
        return false;
    }
    function stripAgentSecrets(value) {
        const normalized = normalizePublic(value);
        if (!(0, helper_values_1.record)(normalized))
            return normalized;
        if (!('sessionSecret' in normalized) && !('tokenHash' in normalized))
            return normalized;
        const copy = { ...normalized };
        delete copy.sessionSecret;
        delete copy.tokenHash;
        return copy;
    }
    function sendBrokerReply(res, status, body) {
        res.status(status).json(stripAgentSecrets(normalizeBrokerErrorBody(status, body)));
    }
    function sendBrokerFailure(res, error) {
        if (res.headersSent)
            return;
        res.status((0, http_boundary_1.errorStatus)(error, 502)).json({ error: (0, http_boundary_1.errorMessage)(error) });
    }
    function broadcastEvent(eventName, payload) {
        if (stopped || activeBrokerStreams.size === 0)
            return;
        const frame = `event: ${eventName}\ndata: ${JSON.stringify(stripAgentSecrets(payload))}\n\n`;
        for (const client of [...activeBrokerStreams]) {
            if (client.writableEnded || client.destroyed) {
                activeBrokerStreams.delete(client);
                continue;
            }
            try {
                client.write(frame);
                client.flush?.();
            }
            catch {
                activeBrokerStreams.delete(client);
            }
        }
    }
    const status = async (_req, res) => {
        if (!ensureAvailable(res))
            return;
        try {
            const reply = await broker.requestJson('GET', '/v1/status');
            if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
                const st = typeof reply.body.state === 'string' ? reply.body.state : null;
                const ep = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
                if (st !== null && ep !== null)
                    applyBrokerSnapshot(st, ep);
            }
            sendBrokerReply(res, reply.status, reply.body);
        }
        catch (error) {
            sendBrokerFailure(res, error);
        }
    };
    const stream = (req, res) => {
        if (!ensureAvailable(res))
            return;
        let closed = false;
        const upstream = broker.openEvents((brokerRes) => {
            if (closed) {
                brokerRes.destroy();
                return;
            }
            if (brokerRes.statusCode !== 200) {
                const chunks = [];
                let totalBytes = 0;
                let settled = false;
                const finishError = (statusCode, body) => {
                    if (settled || closed || res.headersSent)
                        return;
                    settled = true;
                    sendBrokerReply(res, statusCode, body);
                };
                brokerRes.on('data', (chunk) => {
                    if (settled)
                        return;
                    totalBytes += chunk.length;
                    if (totalBytes > maxSseErrorBytes) {
                        finishError(502, { error: 'Broker error response exceeded size limit' });
                        try {
                            brokerRes.destroy();
                        }
                        catch { }
                        return;
                    }
                    chunks.push(chunk);
                });
                brokerRes.on('error', () => finishError(502, { error: 'Broker stream unavailable' }));
                brokerRes.on('aborted', () => finishError(502, { error: 'Broker stream aborted' }));
                brokerRes.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let parsed = null;
                    try {
                        parsed = JSON.parse(raw);
                    }
                    catch { }
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
            activeBrokerStreams.add(res);
            let sseBuffer = '';
            let sseDataLines = [];
            let sseEventBytes = 0;
            const closeClient = () => {
                closed = true;
                activeBrokerStreams.delete(res);
                try {
                    brokerRes.destroy();
                }
                catch { }
                if (!res.writableEnded) {
                    try {
                        res.end();
                    }
                    catch { }
                }
            };
            const writeOut = (chunk) => {
                if (closed || res.writableEnded || res.destroyed)
                    return;
                res.write(chunk);
            };
            const flushDataBlock = () => {
                if (!sseDataLines.length)
                    return;
                const rawData = sseDataLines.join('\n');
                sseDataLines = [];
                sseEventBytes = 0;
                let parsed;
                try {
                    parsed = JSON.parse(rawData);
                }
                catch {
                    writeOut(`data: ${rawData.replace(/\n/g, '\ndata: ')}\n`);
                    return;
                }
                const normalized = stripAgentSecrets(parsed);
                writeOut(`data: ${JSON.stringify(normalized)}\n`);
            };
            brokerRes.setEncoding('utf8');
            brokerRes.on('data', (chunk) => {
                if (closed)
                    return;
                sseBuffer += chunk;
                if (sseBuffer.length > maxSseEventBytes) {
                    closeClient();
                    return;
                }
                for (;;) {
                    const nl = sseBuffer.indexOf('\n');
                    if (nl < 0)
                        break;
                    const line = sseBuffer.slice(0, nl).replace(/\r$/, '');
                    sseBuffer = sseBuffer.slice(nl + 1);
                    if (line === '') {
                        flushDataBlock();
                        writeOut('\n');
                        res.flush?.();
                    }
                    else if (line.startsWith('data:')) {
                        const value = line.slice(5).replace(/^ /, '');
                        sseEventBytes += Buffer.byteLength(value, 'utf8');
                        if (sseEventBytes > maxSseEventBytes) {
                            closeClient();
                            return;
                        }
                        sseDataLines.push(value);
                    }
                    else {
                        writeOut(`${line}\n`);
                    }
                }
            });
            brokerRes.on('end', closeClient);
            brokerRes.on('error', closeClient);
            res.on('close', () => {
                closed = true;
                activeBrokerStreams.delete(res);
                try {
                    brokerRes.destroy();
                }
                catch { }
            });
        }, (error) => {
            if (closed)
                return;
            sendBrokerFailure(res, Object.assign(error, { statusCode: 503 }));
        });
        if (!upstream) {
            res.status(404).json({ error: 'Computer-use is not available on this host' });
            return;
        }
        req.on('close', () => {
            closed = true;
            try {
                upstream.destroy();
            }
            catch { }
        });
    };
    async function compensateDroppedTakeover(takeoverBody) {
        const releasePayload = { handBack: true };
        const leaseId = pickString(takeoverBody, 'leaseId')
            ?? ((0, helper_values_1.record)(takeoverBody.lease) ? pickString(takeoverBody.lease, 'leaseId') : undefined);
        const leaseToken = pickString(takeoverBody, 'leaseToken') ?? pickString(takeoverBody, 'token');
        if (leaseId)
            releasePayload.leaseId = leaseId;
        if (leaseToken)
            releasePayload.leaseToken = leaseToken;
        try {
            const comp = await broker.requestJson('POST', '/v1/lease/release', releasePayload);
            if (comp.status === 200 && (0, helper_values_1.record)(comp.body)) {
                const st = typeof comp.body.state === 'string' ? comp.body.state : null;
                const ep = typeof comp.body.epoch === 'number' && Number.isFinite(comp.body.epoch) ? comp.body.epoch : null;
                if (st !== null && ep !== null)
                    applyBrokerSnapshot(st, ep);
            }
        }
        catch {
            // Best-effort compensation: still return 503 fail-closed.
        }
    }
    const takeover = async (req, res) => {
        if (!ensureAvailable(res))
            return;
        if (!(await waitForWatchSync())) {
            res.status(503).json({ error: 'Computer-use broker watch is not synced', code: 'broker_watch_unavailable' });
            return;
        }
        const raw = (0, http_boundary_1.requestBody)(req);
        // Force Take Over and Detach driver are intentionally not exposed in Slice 1.
        const payload = {
            label: pickString(raw, 'label') ?? 'pi-dish',
            ttlSec: pickFiniteNumber(raw, 'ttlSec') ?? DEFAULT_HUMAN_TTL_SEC,
            mintTicket: pickBoolean(raw, 'mintTicket') ?? true,
        };
        const holderId = pickString(raw, 'holderId');
        if (holderId)
            payload.holderId = holderId;
        const reason = pickString(raw, 'reason');
        if (reason)
            payload.reason = reason;
        const hardCapSec = pickFiniteNumber(raw, 'hardCapSec');
        if (hardCapSec !== undefined)
            payload.hardCapSec = hardCapSec;
        const ticketTtlSec = pickFiniteNumber(raw, 'ticketTtlSec');
        if (ticketTtlSec !== undefined)
            payload.ticketTtlSec = ticketTtlSec;
        try {
            const reply = await broker.requestJson('POST', '/v1/lease/takeover', payload, { timeoutMs: cu_broker_1.TAKEOVER_BROKER_TIMEOUT_MS });
            if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
                const epoch = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
                if (!brokerWatchSynced) {
                    // Broker committed takeover while our watch dropped: immediately
                    // hand back with the returned credentials so the seat is never stranded.
                    await compensateDroppedTakeover(reply.body);
                    res.status(503).json({ error: 'Computer-use broker watch was lost during takeover', code: 'broker_watch_unavailable' });
                    return;
                }
                if (epoch !== null && epoch < latestEpoch) {
                    res.status(409).json({ error: 'Takeover response was superseded by a newer epoch', code: 'human_lease_ended', epoch: latestEpoch });
                    return;
                }
                if (epoch !== null)
                    applyBrokerSnapshot('human', epoch);
                const viewer = withSpacesViewerPath(reply.body.viewer);
                const mintedTicket = viewer && typeof viewer.ticket === 'string' ? viewer.ticket.trim() : '';
                if (mintedTicket && epoch !== null) {
                    recordTicket(viewerTickets, mintedTicket, {
                        mode: 'interactive',
                        epoch,
                        expiresAtMs: computeViewerExpiryMs(viewer?.expiresAt, viewer?.ttlSec),
                    });
                }
                const out = viewer ? { ...reply.body, viewer } : reply.body;
                res.status(200).json(stripAgentSecrets(out));
                return;
            }
            sendBrokerReply(res, reply.status, reply.body);
        }
        catch (error) {
            sendBrokerFailure(res, error);
        }
    };
    const heartbeat = async (req, res) => {
        if (!ensureAvailable(res))
            return;
        const raw = (0, http_boundary_1.requestBody)(req);
        const payload = {};
        for (const key of ['leaseId', 'sessionId', 'leaseToken', 'sessionSecret', 'token']) {
            const val = pickString(raw, key);
            if (val)
                payload[key] = val;
        }
        const ttlSec = pickFiniteNumber(raw, 'ttlSec');
        if (ttlSec !== undefined)
            payload.ttlSec = ttlSec;
        try {
            const reply = await broker.requestJson('POST', '/v1/lease/heartbeat', payload);
            if ((0, helper_values_1.record)(reply.body)) {
                const st = typeof reply.body.state === 'string' ? reply.body.state : null;
                const ep = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
                if (st !== null && ep !== null)
                    applyBrokerSnapshot(st, ep);
            }
            sendBrokerReply(res, reply.status, reply.body);
        }
        catch (error) {
            sendBrokerFailure(res, error);
        }
    };
    const release = async (req, res) => {
        if (!ensureAvailable(res))
            return;
        const raw = (0, http_boundary_1.requestBody)(req);
        // Hand Back always sends handBack: true; force / Release Seat are cut.
        const payload = { handBack: true };
        for (const key of ['leaseId', 'sessionId', 'leaseToken', 'sessionSecret', 'token']) {
            const val = pickString(raw, key);
            if (val)
                payload[key] = val;
        }
        try {
            const reply = await broker.requestJson('POST', '/v1/lease/release', payload);
            if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
                const st = typeof reply.body.state === 'string' ? reply.body.state : 'idle';
                const ep = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
                // Revoke only as part of accepting a non-stale epoch transition.
                if (ep !== null)
                    applyBrokerSnapshot(st, ep);
            }
            sendBrokerReply(res, reply.status, reply.body);
        }
        catch (error) {
            sendBrokerFailure(res, error);
        }
    };
    const viewerTicket = async (req, res) => {
        if (!ensureAvailable(res))
            return;
        const raw = (0, http_boundary_1.requestBody)(req);
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
        const payload = { mode };
        for (const key of ['leaseId', 'leaseToken', 'principalId', 'principalName']) {
            const val = pickString(raw, key);
            if (val)
                payload[key] = val;
        }
        const ttlSec = pickFiniteNumber(raw, 'ttlSec');
        if (ttlSec !== undefined)
            payload.ttlSec = ttlSec;
        try {
            const reply = await broker.requestJson('POST', '/v1/viewer/ticket', payload);
            if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
                const epoch = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
                if (epoch !== null && epoch < latestEpoch) {
                    res.status(409).json({ error: 'Viewer ticket is from a superseded epoch', code: 'human_lease_ended', epoch: latestEpoch });
                    return;
                }
                if (mode === 'interactive' && (!isHumanControlActive() || (epoch !== null && epoch !== latestEpoch))) {
                    res.status(409).json({ error: 'Human lease ended while minting ticket', code: 'human_lease_ended', epoch: latestEpoch });
                    return;
                }
                const mintedTicket = typeof reply.body.ticket === 'string' ? reply.body.ticket.trim() : '';
                if (mintedTicket) {
                    recordTicket(viewerTickets, mintedTicket, {
                        mode,
                        epoch: epoch ?? latestEpoch,
                        expiresAtMs: computeViewerExpiryMs(reply.body.expiresAt, reply.body.ttlSec),
                    });
                }
                res.status(200).json(withSpacesViewerPath(reply.body) ?? reply.body);
                return;
            }
            sendBrokerReply(res, reply.status, reply.body);
        }
        catch (error) {
            sendBrokerFailure(res, error);
        }
    };
    const audit = async (req, res) => {
        if (!ensureAvailable(res))
            return;
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
        }
        catch (error) {
            sendBrokerFailure(res, error);
        }
    };
    function copySpacesResponseHeaders(upstreamRes, res) {
        const nominated = connectionNominatedHeaders(upstreamRes.headers.connection);
        for (const [key, value] of Object.entries(upstreamRes.headers)) {
            if (value === undefined)
                continue;
            const lower = key.toLowerCase();
            if (HOP_BY_HOP_RESPONSE_HEADERS[lower] === true || nominated.has(lower))
                continue;
            if (lower.startsWith('access-control-') || lower === 'set-cookie')
                continue;
            res.setHeader(key, value);
        }
    }
    /**
     * Vendored viewer asset server + allowlisted raw gRPC-Web proxy to
     * `http://127.0.0.1:3211`. Mounted BEFORE `compression` and `jsonBody`,
     * behind `accessHandlers.requireBearer`.
     */
    const spacesProxy = (req, res) => {
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
        if (serveVendoredCuViewer(req, res, safe))
            return;
        const routeKind = classifySpacesHttpRoute(safe.pathname);
        if (!routeKind) {
            res.status(404).type('text/plain').send('Not found');
            return;
        }
        if (req.method !== 'POST') {
            res.status(405).type('text/plain').send('Method not allowed');
            return;
        }
        if (routeKind === 'interactive') {
            const bearer = extractCuaBearerTicket(req.headers['x-cua-env-authorization']);
            const authz = authorizeTrackedCredential(viewerTickets, bearer, { requireInteractive: true });
            if (!authz.ok) {
                res.status(authz.status).json({ error: authz.error, code: authz.code });
                return;
            }
        }
        const isOpenMedia = safe.pathname === OPEN_MEDIA_PATH;
        let openMediaBearer = null;
        let openMediaViewerEntry = null;
        const forwardToSpaces = (bufferedRequestBody) => {
            const upstreamHeaders = buildSpacesRequestHeaders(req.headers, spacesPort);
            if (bufferedRequestBody !== null) {
                upstreamHeaders['content-length'] = String(bufferedRequestBody.length);
            }
            let activeRes = null;
            let finished = false;
            const cleanupRequest = () => {
                if (finished)
                    return;
                finished = true;
                activeSpacesRequests.delete(abortOnRevoke);
            };
            const abortOnRevoke = (reason) => {
                cleanupRequest();
                try {
                    upstream.destroy();
                }
                catch { }
                if (activeRes) {
                    try {
                        activeRes.destroy();
                    }
                    catch { }
                }
                if (!res.headersSent) {
                    res.status(403).json({ error: reason, code: 'human_lease_ended' });
                }
                else {
                    try {
                        res.destroy();
                    }
                    catch { }
                }
            };
            const upstream = http.request({
                host: SPACES_HOST,
                port: spacesPort,
                method: 'POST',
                path: `${safe.pathname}${safe.search}`,
                headers: upstreamHeaders,
                timeout: exports.SPACES_HTTP_TIMEOUT_MS,
            }, (upstreamRes) => {
                if (finished) {
                    upstreamRes.destroy();
                    return;
                }
                activeRes = upstreamRes;
                if (isOpenMedia && openMediaViewerEntry) {
                    const openMediaEntry = openMediaViewerEntry;
                    const statusCode = upstreamRes.statusCode ?? 502;
                    if (statusCode !== 200) {
                        res.status(statusCode);
                        copySpacesResponseHeaders(upstreamRes, res);
                        upstreamRes.pipe(res);
                        upstreamRes.on('end', cleanupRequest);
                        upstreamRes.on('close', cleanupRequest);
                        upstreamRes.on('error', () => { cleanupRequest(); try {
                            res.end();
                        }
                        catch { } });
                        res.on('close', () => { cleanupRequest(); try {
                            upstreamRes.destroy();
                        }
                        catch { } });
                        return;
                    }
                    const chunks = [];
                    let totalBytes = 0;
                    let overflowed = false;
                    upstreamRes.on('data', (chunk) => {
                        if (finished || overflowed)
                            return;
                        totalBytes += chunk.length;
                        if (totalBytes > MAX_OPEN_MEDIA_RESPONSE_BYTES) {
                            overflowed = true;
                            cleanupRequest();
                            if (!res.headersSent)
                                res.status(502).json({ error: 'OpenMedia response exceeded size limit' });
                            try {
                                upstreamRes.destroy();
                            }
                            catch { }
                            return;
                        }
                        chunks.push(chunk);
                    });
                    upstreamRes.on('error', () => {
                        cleanupRequest();
                        if (!res.headersSent)
                            res.status(502).json({ error: 'OpenMedia upstream error' });
                    });
                    upstreamRes.on('end', () => {
                        if (finished || overflowed)
                            return;
                        cleanupRequest();
                        const body = Buffer.concat(chunks);
                        const parsed = parseOpenMediaResponse(upstreamRes.headers['content-type'], upstreamRes.headers['grpc-status'], body);
                        if (parsed.kind === 'invalid') {
                            if (!res.headersSent)
                                res.status(502).json({ error: 'Invalid OpenMedia response from spacesd' });
                            return;
                        }
                        if (parsed.kind === 'ok') {
                            const recheck = authorizeTrackedCredential(viewerTickets, openMediaBearer, {
                                requireInteractive: openMediaEntry.mode === 'interactive',
                            });
                            if (!recheck.ok || recheck.entry.epoch !== openMediaEntry.epoch) {
                                if (!res.headersSent) {
                                    const status = !recheck.ok ? recheck.status : 403;
                                    const code = !recheck.ok ? recheck.code : 'human_lease_ended';
                                    const error = !recheck.ok ? recheck.error : 'Interactive viewer lease has ended';
                                    res.status(status).json({ error, code });
                                }
                                return;
                            }
                            recordTicket(mediaTickets, parsed.ticket, {
                                mode: openMediaEntry.mode,
                                epoch: openMediaEntry.epoch,
                                expiresAtMs: computeMediaExpiryMs(parsed.expiresAtMs),
                            });
                        }
                        if (res.headersSent)
                            return;
                        res.status(200);
                        copySpacesResponseHeaders(upstreamRes, res);
                        res.setHeader('Content-Length', String(body.length));
                        res.end(body);
                    });
                    res.on('close', () => { cleanupRequest(); try {
                        upstreamRes.destroy();
                    }
                    catch { } });
                    return;
                }
                res.status(upstreamRes.statusCode ?? 502);
                copySpacesResponseHeaders(upstreamRes, res);
                upstreamRes.pipe(res);
                upstreamRes.on('end', cleanupRequest);
                upstreamRes.on('close', cleanupRequest);
                upstreamRes.on('error', () => {
                    cleanupRequest();
                    try {
                        res.end();
                    }
                    catch { }
                });
                res.on('close', () => {
                    cleanupRequest();
                    try {
                        upstreamRes.destroy();
                    }
                    catch { }
                });
            });
            activeSpacesRequests.add(abortOnRevoke);
            upstream.on('timeout', () => {
                cleanupRequest();
                try {
                    upstream.destroy();
                }
                catch { }
                if (!res.headersSent)
                    res.status(504).json({ error: 'Upstream timeout' });
            });
            upstream.on('error', () => {
                cleanupRequest();
                if (!res.headersSent)
                    res.status(502).json({ error: 'Computer-use viewer upstream unavailable' });
            });
            req.on('aborted', () => {
                cleanupRequest();
                try {
                    upstream.destroy();
                }
                catch { }
            });
            res.on('close', cleanupRequest);
            if (bufferedRequestBody !== null)
                upstream.end(bufferedRequestBody);
            else
                req.pipe(upstream);
        };
        if (isOpenMedia) {
            openMediaBearer = extractCuaBearerTicket(req.headers['x-cua-env-authorization']);
            const authz = authorizeTrackedCredential(viewerTickets, openMediaBearer);
            if (!authz.ok) {
                res.status(authz.status).json({ error: authz.error, code: authz.code });
                return;
            }
            openMediaViewerEntry = authz.entry;
            const reqChunks = [];
            let reqBytes = 0;
            let reqDone = false;
            const cleanupRead = () => {
                if (reqDone)
                    return;
                reqDone = true;
                activeSpacesRequests.delete(abortRead);
            };
            const abortRead = (reason) => {
                cleanupRead();
                if (!res.headersSent)
                    res.status(403).json({ error: reason, code: 'human_lease_ended' });
                req.resume();
            };
            activeSpacesRequests.add(abortRead);
            req.on('data', (chunk) => {
                if (reqDone)
                    return;
                reqBytes += chunk.length;
                if (reqBytes > MAX_OPEN_MEDIA_REQUEST_BYTES) {
                    cleanupRead();
                    if (!res.headersSent) {
                        res.status(403).json({ error: 'OpenMedia request exceeded size limit', code: 'open_media_forbidden' });
                    }
                    req.resume();
                    return;
                }
                reqChunks.push(chunk);
            });
            req.on('aborted', cleanupRead);
            req.on('error', () => {
                if (reqDone)
                    return;
                cleanupRead();
                if (!res.headersSent) {
                    res.status(403).json({ error: 'Invalid OpenMedia request stream', code: 'open_media_forbidden' });
                }
            });
            req.on('end', () => {
                if (reqDone)
                    return;
                cleanupRead();
                const recheck = authorizeTrackedCredential(viewerTickets, openMediaBearer, {
                    requireInteractive: openMediaViewerEntry.mode === 'interactive',
                });
                if (!recheck.ok || recheck.entry.epoch !== openMediaViewerEntry.epoch) {
                    if (!res.headersSent) {
                        const status = !recheck.ok ? recheck.status : 403;
                        const code = !recheck.ok ? recheck.code : 'human_lease_ended';
                        const error = !recheck.ok ? recheck.error : 'Interactive viewer lease has ended';
                        res.status(status).json({ error, code });
                    }
                    return;
                }
                const reqBody = Buffer.concat(reqChunks);
                const validated = validateOpenMediaRequest(req.headers['content-type'], req.headers['content-encoding'], req.headers['grpc-encoding'], reqBody);
                if (!validated.ok) {
                    if (!res.headersSent) {
                        res.status(403).json({ error: validated.error, code: 'open_media_forbidden' });
                    }
                    return;
                }
                forwardToSpaces(reqBody);
            });
            return;
        }
        forwardToSpaces(null);
    };
    /**
     * WebSocket upgrade proxy for `/api/cu/spaces/media` -> `ws://127.0.0.1:3211/media`.
     * Validates the handshake before dialing, preserves `Sec-WebSocket-Protocol`
     * (e.g. `rcdp.v2`), enforces backpressure and missed-pong eviction, and closes
     * EVERY proxied `/media` socket when the human epoch ends or broker watch drops.
     */
    function upgrade(req, socket, head, url) {
        if (!url.pathname.startsWith(`${SPACES_PREFIX}/`))
            return false;
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
        // Require a media ticket recorded from a pi-dish-authorized OpenMedia call
        // (checking both ?ticket= and cua.ticket.* / rcdp.v2.ticket.* subprotocols).
        const safeUrl = new URL(`${safe.pathname}${safe.search}`, 'http://localhost');
        const presentedMediaTickets = extractMediaWsTickets(safeUrl, handshake.protocols);
        if (presentedMediaTickets.length === 0) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return true;
        }
        const authorizeMediaUpgrade = () => {
            let hasInteractive = false;
            let interactiveEpoch = -1;
            for (const candidate of presentedMediaTickets) {
                const authz = authorizeTrackedCredential(mediaTickets, candidate);
                if (!authz.ok) {
                    return { ok: false, statusLine: authz.status === 503 ? 'HTTP/1.1 503 Service Unavailable' : 'HTTP/1.1 403 Forbidden' };
                }
                if (authz.entry.mode === 'interactive') {
                    hasInteractive = true;
                    interactiveEpoch = authz.entry.epoch;
                }
            }
            return { ok: true, isInteractive: hasInteractive, epoch: interactiveEpoch };
        };
        const initialMediaAuth = authorizeMediaUpgrade();
        if (!initialMediaAuth.ok && initialMediaAuth.statusLine === 'HTTP/1.1 403 Forbidden') {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return true;
        }
        // Dial upstream once media credential authorization passes (waiting briefly
        // for initial broker watch sync only when an interactive upgrade races boot).
        const beginUpstreamDial = () => {
            if (stopped || socket.destroyed)
                return;
            const checked = authorizeMediaUpgrade();
            if (!checked.ok) {
                try {
                    socket.write(`${checked.statusLine}\r\n\r\n`);
                }
                catch { }
                try {
                    socket.destroy();
                }
                catch { }
                return;
            }
            const upstreamUrl = `ws://${SPACES_HOST}:${spacesPort}${safe.pathname}${safe.search}`;
            let upstreamWs;
            try {
                upstreamWs = new WebSocket(upstreamUrl, handshake.protocols, {
                    perMessageDeflate: false,
                    handshakeTimeout: exports.SPACES_HTTP_TIMEOUT_MS,
                    headers: { host: `${SPACES_HOST}:${spacesPort}` },
                });
            }
            catch {
                try {
                    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                }
                catch { }
                try {
                    socket.destroy();
                }
                catch { }
                return;
            }
            let settled = false;
            let admitted = false;
            const rejectHandshake = (statusLine) => {
                if (settled)
                    return;
                settled = true;
                pendingMediaUpgrades.delete(rejectHandshake);
                socket.removeListener('close', onClientEarlyClose);
                socket.removeListener('error', onClientEarlyClose);
                negotiatedProtocols.delete(req);
                try {
                    upstreamWs.terminate();
                }
                catch { }
                try {
                    socket.write(`${statusLine}\r\n\r\n`);
                }
                catch { }
                try {
                    socket.destroy();
                }
                catch { }
            };
            const onClientEarlyClose = () => {
                if (admitted)
                    return;
                settled = true;
                pendingMediaUpgrades.delete(rejectHandshake);
                negotiatedProtocols.delete(req);
                try {
                    upstreamWs.terminate();
                }
                catch { }
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
                if (settled || stopped || socket.destroyed) {
                    rejectHandshake('HTTP/1.1 503 Service Unavailable');
                    return;
                }
                const recheck = authorizeMediaUpgrade();
                if (!recheck.ok) {
                    rejectHandshake(recheck.statusLine);
                    return;
                }
                if (upstreamWs.protocol)
                    negotiatedProtocols.set(req, upstreamWs.protocol);
                // Keep onClientEarlyClose attached across handleUpgrade so if ws rejects
                // the handshake without invoking the callback, upstreamWs is still closed.
                try {
                    wss.handleUpgrade(req, socket, head, (clientWs) => {
                        negotiatedProtocols.delete(req);
                        const finalCheck = authorizeMediaUpgrade();
                        if (settled || stopped || !finalCheck.ok) {
                            try {
                                clientWs.terminate();
                            }
                            catch { }
                            try {
                                upstreamWs.terminate();
                            }
                            catch { }
                            return;
                        }
                        admitted = true;
                        settled = true;
                        pendingMediaUpgrades.delete(rejectHandshake);
                        socket.removeListener('close', onClientEarlyClose);
                        socket.removeListener('error', onClientEarlyClose);
                        let closed = false;
                        let pingTimer = null;
                        let clientAlive = true;
                        let upstreamAlive = true;
                        const cleanup = () => {
                            if (closed)
                                return;
                            closed = true;
                            if (pingTimer) {
                                clearInterval(pingTimer);
                                pingTimer = null;
                            }
                            activeMediaSockets.delete(revokeSocket);
                        };
                        const forceClose = (code = 4001, reason = 'Human lease ended', immediate = false) => {
                            cleanup();
                            try {
                                if (!immediate && clientWs.readyState === WebSocket.OPEN)
                                    clientWs.close(code, reason);
                                else
                                    clientWs.terminate();
                            }
                            catch { }
                            try {
                                upstreamWs.terminate();
                            }
                            catch { }
                        };
                        const revokeSocket = (reason) => {
                            forceClose(reason === 'Server shutting down' ? 1001 : 4001, reason, reason === 'Server shutting down');
                        };
                        activeMediaSockets.add(revokeSocket);
                        const forwardFrame = (target, data, isBinary) => {
                            if (closed || target.readyState !== WebSocket.OPEN)
                                return;
                            const frameBytes = rawDataByteLength(data);
                            if (target.bufferedAmount + frameBytes > wsMaxBufferedBytes) {
                                forceClose(1008, 'Media buffer limit exceeded', true);
                                return;
                            }
                            try {
                                target.send(data, { binary: isBinary });
                            }
                            catch {
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
                                    if (safeCode !== undefined)
                                        upstreamWs.close(safeCode, reason.toString('utf8').slice(0, 120));
                                    else
                                        upstreamWs.close();
                                }
                                catch {
                                    try {
                                        upstreamWs.terminate();
                                    }
                                    catch { }
                                }
                            }
                        });
                        upstreamWs.on('close', (code, reason) => {
                            cleanup();
                            if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
                                const safeCode = safeCloseCode(code);
                                try {
                                    if (safeCode !== undefined)
                                        clientWs.close(safeCode, reason.toString('utf8').slice(0, 120));
                                    else
                                        clientWs.close();
                                }
                                catch {
                                    try {
                                        clientWs.terminate();
                                    }
                                    catch { }
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
                                    try {
                                        clientWs.ping();
                                    }
                                    catch {
                                        forceClose(1011, 'Client ping failed', true);
                                        return;
                                    }
                                }
                                if (upstreamWs.readyState === WebSocket.OPEN) {
                                    try {
                                        upstreamWs.ping();
                                    }
                                    catch {
                                        forceClose(1011, 'Upstream ping failed', true);
                                    }
                                }
                            }, wsPingIntervalMs);
                            pingTimer.unref();
                        }
                    });
                }
                catch {
                    rejectHandshake('HTTP/1.1 400 Bad Request');
                }
            });
        };
        if (initialMediaAuth.ok) {
            beginUpstreamDial();
        }
        else {
            void waitForWatchSync().then(beginUpstreamDial);
        }
        return true;
    }
    function stop() {
        stopped = true;
        brokerWatchSynced = false;
        brokerState = null;
        viewerTickets.clear();
        mediaTickets.clear();
        for (const client of [...activeBrokerStreams]) {
            try {
                client.end();
            }
            catch { }
        }
        activeBrokerStreams.clear();
        stopEpochWatcher();
        resolveWatchSyncWaiters();
        revokeAllActive('Server shutting down');
        try {
            wss.close();
        }
        catch { }
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
        broadcastEvent,
        stop,
    };
}
