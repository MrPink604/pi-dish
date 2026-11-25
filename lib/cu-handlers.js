// Generated from src/core/cu-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CU_FETCH_CREDS_JS = void 0;
exports.sanitizeSpacesPath = sanitizeSpacesPath;
exports.rewriteSpacesCsp = rewriteSpacesCsp;
exports.injectFetchCredsScript = injectFetchCredsScript;
exports.buildSpacesRequestHeaders = buildSpacesRequestHeaders;
exports.createCuHandlers = createCuHandlers;
/**
 * Guest-side computer-use HTTP routes, cua-spacesd (127.0.0.1:3211) HTTP/gRPC-Web/WS
 * reverse proxy, and human-epoch revocation for interactive viewer sessions.
 */
const http = require("node:http");
const cu_broker_1 = require("./cu-broker");
const http_boundary_1 = require("./http-boundary");
const helper_values_1 = require("./helper-values");
const SPACES_HOST = '127.0.0.1';
const DEFAULT_SPACES_PORT = 3211;
const SPACES_PREFIX = '/api/cu/spaces';
const SPACES_HTTP_TIMEOUT_MS = 15_000;
const MAX_VIEWER_HTML_BYTES = 1024 * 1024;
const WS_PING_INTERVAL_MS = 30_000;
const EPOCH_WATCH_RETRY_MS = 2_000;
const DEFAULT_HUMAN_TTL_SEC = 600;
const MAX_REVOKED_EPOCHS = 256;
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
// Strict allowlist of request headers forwarded to loopback 127.0.0.1:3211.
// Hop-by-hop, Authorization, Cookie, Cloudflare Access, proxy-identity and
// pi-dish internal headers are never forwarded.
const ALLOWED_SPACES_REQUEST_HEADERS = [
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
    'range',
    'if-range',
];
const CONDITIONAL_ASSET_HEADERS = [
    'if-none-match',
    'if-modified-since',
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
const ALLOWED_SPACES_METHODS = new Set(['GET', 'HEAD', 'POST']);
/**
 * Validates and normalizes a `/api/cu/spaces/*` suffix before it reaches
 * `127.0.0.1:3211`. Refuses dot segments (including multi-encoded), encoded
 * path separators, backslashes, empty interior segments, and control chars.
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
 * Rewrites only `frame-ancestors 'none'` -> `frame-ancestors 'self'`, keeping
 * every other CSP directive strict and untouched.
 */
function rewriteSpacesCsp(csp) {
    let sawFrameAncestors = false;
    const directives = csp
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .map(directive => {
        if (/^frame-ancestors(?:\s|$)/i.test(directive)) {
            sawFrameAncestors = true;
            return directive.replace(/'none'/gi, "'self'");
        }
        return directive;
    });
    if (!sawFrameAncestors)
        directives.push("frame-ancestors 'self'");
    return directives.join('; ');
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
/** Builds allowlisted outbound HTTP headers for loopback `127.0.0.1:3211`. */
function buildSpacesRequestHeaders(incoming, port, options = {}) {
    const out = {
        host: `${SPACES_HOST}:${port}`,
        'accept-encoding': 'identity',
    };
    const connectionTokens = new Set(String(incoming.connection || '')
        .split(',')
        .map(token => token.trim().toLowerCase())
        .filter(Boolean));
    const allow = options.viewerHtml
        ? ALLOWED_SPACES_REQUEST_HEADERS
        : [...ALLOWED_SPACES_REQUEST_HEADERS, ...CONDITIONAL_ASSET_HEADERS];
    for (const name of allow) {
        if (connectionTokens.has(name))
            continue;
        const value = incoming[name];
        if (value !== undefined)
            out[name] = value;
    }
    return out;
}
function isViewerHtmlPath(pathname) {
    return pathname === '/viewer/' || pathname === '/viewer/index.html';
}
function isViewerRoutePath(pathname) {
    return pathname === '/viewer' || pathname.startsWith('/viewer/');
}
function extractCuaBearerTicket(headerValue) {
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof raw !== 'string')
        return null;
    const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
    return match ? match[1].trim() : null;
}
function parseWebSocketProtocols(headerValue) {
    const raw = Array.isArray(headerValue) ? headerValue.join(',') : (headerValue || '');
    return raw
        .split(',')
        .map(part => part.trim())
        .filter(token => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(token));
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
    const path = typeof viewer.path === 'string' ? viewer.path : null;
    if (!path)
        return viewer;
    const spacesPath = path.startsWith(SPACES_PREFIX) ? path : `${SPACES_PREFIX}${path.startsWith('/') ? '' : '/'}${path}`;
    return { ...viewer, spacesPath };
}
function createCuHandlers(ports) {
    const broker = (0, cu_broker_1.createCuBrokerClient)({ socketPath: ports.socketPath });
    const spacesPort = Number.isInteger(ports.spacesPort) && ports.spacesPort > 0 && ports.spacesPort <= 65535
        ? ports.spacesPort
        : DEFAULT_SPACES_PORT;
    const wsPingIntervalMs = ports.wsPingIntervalMs ?? WS_PING_INTERVAL_MS;
    const { WebSocket, WebSocketServer } = require('ws');
    const negotiatedProtocols = new WeakMap();
    const wss = new WebSocketServer({
        noServer: true,
        perMessageDeflate: false,
        handleProtocols: (_protocols, req) => negotiatedProtocols.get(req) ?? false,
    });
    // Track interactive tickets minted through pi-dish and their live /media
    // sockets by broker epoch so leaving a human epoch revokes control immediately.
    const interactiveTickets = new Map();
    const revokedTickets = new Map();
    const revokedEpochs = new Set();
    const interactiveSockets = new Map();
    const allOpenSockets = new Set();
    let stopped = false;
    let watcherReq = null;
    let watcherRes = null;
    let watcherRetryTimer = null;
    let lastKnownState = null;
    function pruneExpiredTickets() {
        const now = Date.now();
        for (const [ticket, info] of interactiveTickets) {
            if (info.expiresAtMs <= now)
                interactiveTickets.delete(ticket);
        }
        for (const [ticket, expiresAtMs] of revokedTickets) {
            if (expiresAtMs <= now)
                revokedTickets.delete(ticket);
        }
        while (revokedEpochs.size > MAX_REVOKED_EPOCHS) {
            const oldest = revokedEpochs.values().next().value;
            if (oldest === undefined)
                break;
            revokedEpochs.delete(oldest);
        }
    }
    function rememberRevokedEpoch(epoch) {
        revokedEpochs.add(epoch);
        const expiryFallback = Date.now() + 35 * 60_000;
        for (const [ticket, info] of interactiveTickets) {
            if (info.epoch === epoch) {
                interactiveTickets.delete(ticket);
                revokedTickets.set(ticket, Math.max(info.expiresAtMs, expiryFallback));
            }
        }
        const sockets = interactiveSockets.get(epoch);
        if (sockets) {
            interactiveSockets.delete(epoch);
            for (const pair of [...sockets])
                pair.close();
        }
        pruneExpiredTickets();
        maybeStopEpochWatcher();
    }
    function reconcileBrokerState(state, epoch) {
        lastKnownState = { state, epoch };
        const epochsToRevoke = new Set();
        for (const activeEpoch of interactiveSockets.keys()) {
            if (state !== 'human' || epoch !== activeEpoch)
                epochsToRevoke.add(activeEpoch);
        }
        for (const info of interactiveTickets.values()) {
            if (state !== 'human' || epoch !== info.epoch)
                epochsToRevoke.add(info.epoch);
        }
        for (const deadEpoch of epochsToRevoke)
            rememberRevokedEpoch(deadEpoch);
    }
    function parseBrokerSsePayload(dataText) {
        let parsed;
        try {
            parsed = JSON.parse(dataText);
        }
        catch {
            return;
        }
        if (!(0, helper_values_1.record)(parsed))
            return;
        const state = typeof parsed.state === 'string' ? parsed.state : null;
        const epoch = typeof parsed.epoch === 'number' && Number.isFinite(parsed.epoch) ? parsed.epoch : null;
        if (state !== null && epoch !== null)
            reconcileBrokerState(state, epoch);
    }
    function hasTrackedInteractiveState() {
        pruneExpiredTickets();
        return interactiveTickets.size > 0 || interactiveSockets.size > 0;
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
    function maybeStopEpochWatcher() {
        if (!hasTrackedInteractiveState())
            stopEpochWatcher();
    }
    function scheduleEpochWatcherRetry() {
        if (stopped || watcherRetryTimer || !hasTrackedInteractiveState())
            return;
        watcherRetryTimer = setTimeout(() => {
            watcherRetryTimer = null;
            ensureEpochWatcher();
        }, EPOCH_WATCH_RETRY_MS);
        watcherRetryTimer.unref();
    }
    function ensureEpochWatcher() {
        if (stopped || watcherReq || !hasTrackedInteractiveState() || !broker.available())
            return;
        let buffer = '';
        let dataLines = [];
        const flushEvent = () => {
            if (!dataLines.length)
                return;
            const payload = dataLines.join('\n');
            dataLines = [];
            parseBrokerSsePayload(payload);
        };
        const req = broker.openEvents((res) => {
            if (watcherReq !== req) {
                res.destroy();
                return;
            }
            watcherRes = res;
            if (res.statusCode !== 200) {
                res.resume();
                stopEpochWatcher();
                scheduleEpochWatcherRetry();
                return;
            }
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                buffer += chunk;
                for (;;) {
                    const nl = buffer.indexOf('\n');
                    if (nl < 0)
                        break;
                    const line = buffer.slice(0, nl).replace(/\r$/, '');
                    buffer = buffer.slice(nl + 1);
                    if (line === '') {
                        flushEvent();
                    }
                    else if (line.startsWith('data:')) {
                        dataLines.push(line.slice(5).replace(/^ /, ''));
                    }
                }
            });
            const disconnected = () => {
                if (watcherReq === req) {
                    watcherReq = null;
                    watcherRes = null;
                    scheduleEpochWatcherRetry();
                }
            };
            res.on('end', disconnected);
            res.on('close', disconnected);
            res.on('error', disconnected);
        }, () => {
            if (watcherReq === req) {
                watcherReq = null;
                watcherRes = null;
                scheduleEpochWatcherRetry();
            }
        });
        watcherReq = req;
        if (!req)
            scheduleEpochWatcherRetry();
    }
    function trackInteractiveTicket(ticket, epoch, expiresAtRaw) {
        pruneExpiredTickets();
        const parsedExpiry = typeof expiresAtRaw === 'string' ? Date.parse(expiresAtRaw) : Number.NaN;
        const expiresAtMs = Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 30 * 60_000;
        revokedEpochs.delete(epoch);
        revokedTickets.delete(ticket);
        interactiveTickets.set(ticket, { epoch, expiresAtMs });
        lastKnownState = { state: 'human', epoch };
        ensureEpochWatcher();
    }
    function isRevokedInteractiveTicket(ticket) {
        if (!ticket)
            return false;
        pruneExpiredTickets();
        if (revokedTickets.has(ticket))
            return true;
        const tracked = interactiveTickets.get(ticket);
        if (!tracked)
            return false;
        if (revokedEpochs.has(tracked.epoch))
            return true;
        if (lastKnownState && (lastKnownState.state !== 'human' || lastKnownState.epoch !== tracked.epoch)) {
            rememberRevokedEpoch(tracked.epoch);
            return true;
        }
        return false;
    }
    function ensureAvailable(res) {
        if (broker.available())
            return true;
        res.status(404).json({ error: 'Computer-use is not available on this host' });
        return false;
    }
    function sendBrokerReply(res, status, body) {
        res.status(status).json(normalizeBrokerErrorBody(status, body));
    }
    function sendBrokerFailure(res, error) {
        if (res.headersSent)
            return;
        res.status((0, http_boundary_1.errorStatus)(error, 502)).json({ error: (0, http_boundary_1.errorMessage)(error) });
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
                    reconcileBrokerState(st, ep);
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
                brokerRes.on('data', (chunk) => chunks.push(chunk));
                brokerRes.on('end', () => {
                    if (closed || res.headersSent)
                        return;
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let parsed = null;
                    try {
                        parsed = JSON.parse(raw);
                    }
                    catch { }
                    sendBrokerReply(res, brokerRes.statusCode ?? 502, parsed ?? { error: 'Broker stream unavailable' });
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
            brokerRes.on('error', () => { try {
                res.end();
            }
            catch { } });
            res.on('close', () => { closed = true; try {
                brokerRes.destroy();
            }
            catch { } });
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
    const takeover = async (req, res) => {
        if (!ensureAvailable(res))
            return;
        const raw = (0, http_boundary_1.requestBody)(req);
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
        const detachDriver = pickBoolean(raw, 'detachDriver');
        if (detachDriver !== undefined)
            payload.detachDriver = detachDriver;
        const force = pickBoolean(raw, 'force');
        if (force !== undefined)
            payload.force = force;
        const ticketTtlSec = pickFiniteNumber(raw, 'ticketTtlSec');
        if (ticketTtlSec !== undefined)
            payload.ticketTtlSec = ticketTtlSec;
        try {
            const reply = await broker.requestJson('POST', '/v1/lease/takeover', payload, { timeoutMs: cu_broker_1.TAKEOVER_BROKER_TIMEOUT_MS });
            if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
                const epoch = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : null;
                const viewer = withSpacesViewerPath(reply.body.viewer);
                if (epoch !== null) {
                    reconcileBrokerState('human', epoch);
                    if (viewer && typeof viewer.ticket === 'string' && viewer.ticket) {
                        trackInteractiveTicket(viewer.ticket, epoch, viewer.expiresAt);
                    }
                }
                const out = viewer ? { ...reply.body, viewer } : reply.body;
                res.status(200).json(out);
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
                    reconcileBrokerState(st, ep);
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
        const payload = {};
        for (const key of ['leaseId', 'sessionId', 'leaseToken', 'sessionSecret', 'token']) {
            const val = pickString(raw, key);
            if (val)
                payload[key] = val;
        }
        const handBack = pickBoolean(raw, 'handBack');
        if (handBack !== undefined)
            payload.handBack = handBack;
        const force = pickBoolean(raw, 'force');
        if (force !== undefined)
            payload.force = force;
        try {
            const reply = await broker.requestJson('POST', '/v1/lease/release', payload);
            if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
                const st = typeof reply.body.state === 'string' ? reply.body.state : 'idle';
                const ep = typeof reply.body.epoch === 'number' && Number.isFinite(reply.body.epoch) ? reply.body.epoch : -1;
                reconcileBrokerState(st, ep);
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
                if (mode === 'interactive' && epoch !== null && typeof reply.body.ticket === 'string' && reply.body.ticket) {
                    trackInteractiveTicket(reply.body.ticket, epoch, reply.body.expiresAt);
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
    function copySpacesResponseHeaders(upstreamRes, res, pathname, rewritingHtml) {
        const connectionTokens = new Set(String(upstreamRes.headers.connection || '')
            .split(',')
            .map(token => token.trim().toLowerCase())
            .filter(Boolean));
        for (const [key, value] of Object.entries(upstreamRes.headers)) {
            if (value === undefined)
                continue;
            const lower = key.toLowerCase();
            if (HOP_BY_HOP_RESPONSE_HEADERS[lower] === true || connectionTokens.has(lower))
                continue;
            if (lower.startsWith('access-control-') || lower === 'set-cookie')
                continue;
            if (rewritingHtml && (lower === 'content-length' || lower === 'etag' || lower === 'cache-control'))
                continue;
            if (lower === 'content-security-policy') {
                const rawCsp = Array.isArray(value) ? value.join(', ') : String(value);
                res.setHeader('Content-Security-Policy', isViewerRoutePath(pathname) ? rewriteSpacesCsp(rawCsp) : rawCsp);
                continue;
            }
            if (lower === 'x-frame-options' && isViewerRoutePath(pathname)) {
                const rawXfo = Array.isArray(value) ? value[0] : String(value);
                res.setHeader('X-Frame-Options', /^deny$/i.test(rawXfo.trim()) ? 'SAMEORIGIN' : rawXfo);
                continue;
            }
            if (lower === 'location' && pathname === '/viewer') {
                const rawLoc = Array.isArray(value) ? value[0] : String(value);
                if (rawLoc === '/viewer/') {
                    res.setHeader('Location', 'viewer/');
                    continue;
                }
            }
            res.setHeader(key, value);
        }
    }
    /**
     * Raw HTTP/gRPC-Web proxy to `http://127.0.0.1:3211/*`.
     * Mounted BEFORE `compression` and `jsonBody`, behind `accessHandlers.requireBearer`.
     */
    const spacesProxy = (req, res) => {
        if (!broker.available()) {
            res.status(404).type('text/plain').send('Not found');
            return;
        }
        if (!ALLOWED_SPACES_METHODS.has(req.method)) {
            res.status(405).type('text/plain').send('Method not allowed');
            return;
        }
        const safe = sanitizeSpacesPath(req.url || '/');
        if (!safe) {
            res.status(400).type('text/plain').send('Bad request');
            return;
        }
        // Serve the static same-origin fetch-credentials shim directly.
        if (safe.pathname === '/viewer/cu-fetch-creds.js') {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.status(405).type('text/plain').send('Method not allowed');
                return;
            }
            res.status(200);
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', "default-src 'none'");
            res.setHeader('Content-Length', String(Buffer.byteLength(exports.CU_FETCH_CREDS_JS)));
            if (req.method === 'HEAD')
                res.end();
            else
                res.end(exports.CU_FETCH_CREDS_JS);
            return;
        }
        // Reject gRPC-Web / API requests bearing an interactive ticket whose human epoch ended.
        const bearerTicket = extractCuaBearerTicket(req.headers['x-cua-env-authorization']);
        if (isRevokedInteractiveTicket(bearerTicket)) {
            res.status(403).json({ error: 'Interactive viewer lease has ended', code: 'human_lease_ended' });
            return;
        }
        const viewerHtmlCandidate = req.method === 'GET' && isViewerHtmlPath(safe.pathname);
        const upstreamHeaders = buildSpacesRequestHeaders(req.headers, spacesPort, { viewerHtml: viewerHtmlCandidate });
        const upstream = http.request({
            host: SPACES_HOST,
            port: spacesPort,
            method: req.method,
            path: `${safe.pathname}${safe.search}`,
            headers: upstreamHeaders,
            timeout: SPACES_HTTP_TIMEOUT_MS,
        }, (upstreamRes) => {
            const contentType = String(upstreamRes.headers['content-type'] || '').toLowerCase();
            const rewriteHtml = viewerHtmlCandidate
                && upstreamRes.statusCode === 200
                && contentType.startsWith('text/html');
            if (rewriteHtml) {
                const chunks = [];
                let totalBytes = 0;
                let overflowed = false;
                upstreamRes.on('data', (chunk) => {
                    if (overflowed)
                        return;
                    totalBytes += chunk.length;
                    if (totalBytes > MAX_VIEWER_HTML_BYTES) {
                        overflowed = true;
                        upstreamRes.destroy();
                        if (!res.headersSent)
                            res.status(502).type('text/plain').send('Viewer HTML too large');
                        return;
                    }
                    chunks.push(chunk);
                });
                upstreamRes.on('error', () => {
                    if (!res.headersSent)
                        res.status(502).type('text/plain').send('Upstream viewer error');
                });
                upstreamRes.on('end', () => {
                    if (overflowed || res.headersSent)
                        return;
                    const rewritten = injectFetchCredsScript(Buffer.concat(chunks).toString('utf8'));
                    res.status(200);
                    copySpacesResponseHeaders(upstreamRes, res, safe.pathname, true);
                    res.setHeader('Cache-Control', 'no-store');
                    res.setHeader('Content-Length', String(Buffer.byteLength(rewritten)));
                    res.end(rewritten);
                });
                res.on('close', () => { try {
                    upstreamRes.destroy();
                }
                catch { } });
                return;
            }
            res.status(upstreamRes.statusCode ?? 502);
            copySpacesResponseHeaders(upstreamRes, res, safe.pathname, false);
            upstreamRes.pipe(res);
            upstreamRes.on('error', () => { try {
                res.end();
            }
            catch { } });
            res.on('close', () => { try {
                upstreamRes.destroy();
            }
            catch { } });
        });
        upstream.on('timeout', () => {
            try {
                upstream.destroy();
            }
            catch { }
            if (!res.headersSent)
                res.status(504).type('text/plain').send('Upstream timeout');
        });
        upstream.on('error', () => {
            if (!res.headersSent)
                res.status(502).type('text/plain').send('Computer-use viewer upstream unavailable');
        });
        req.on('aborted', () => { try {
            upstream.destroy();
        }
        catch { } });
        if (req.method === 'GET' || req.method === 'HEAD')
            upstream.end();
        else
            req.pipe(upstream);
    };
    /**
     * WebSocket upgrade proxy for `/api/cu/spaces/*` -> `ws://127.0.0.1:3211/*`.
     * Preserves `Sec-WebSocket-Protocol` (e.g. `rcdp.v2`), sends 30s keepalive
     * pings, and closes interactive `/media` sockets when the human epoch ends.
     */
    function upgrade(req, socket, head, url) {
        if (!url.pathname.startsWith(`${SPACES_PREFIX}/`))
            return false;
        if (!broker.available()) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return true;
        }
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
        const ticket = url.searchParams.get('ticket');
        if (isRevokedInteractiveTicket(ticket)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return true;
        }
        const trackedInteractive = ticket ? interactiveTickets.get(ticket) ?? null : null;
        const protocols = parseWebSocketProtocols(req.headers['sec-websocket-protocol']);
        const upstreamUrl = `ws://${SPACES_HOST}:${spacesPort}${safe.pathname}${safe.search}`;
        const upstreamWs = new WebSocket(upstreamUrl, protocols, {
            perMessageDeflate: false,
            handshakeTimeout: SPACES_HTTP_TIMEOUT_MS,
            headers: { host: `${SPACES_HOST}:${spacesPort}` },
        });
        let settled = false;
        const rejectHandshake = (statusLine) => {
            if (settled)
                return;
            settled = true;
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
            if (!settled) {
                settled = true;
                try {
                    upstreamWs.terminate();
                }
                catch { }
            }
        };
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
            if (settled) {
                try {
                    upstreamWs.terminate();
                }
                catch { }
                return;
            }
            if (isRevokedInteractiveTicket(ticket)) {
                rejectHandshake('HTTP/1.1 403 Forbidden');
                return;
            }
            settled = true;
            socket.removeListener('close', onClientEarlyClose);
            socket.removeListener('error', onClientEarlyClose);
            if (upstreamWs.protocol)
                negotiatedProtocols.set(req, upstreamWs.protocol);
            wss.handleUpgrade(req, socket, head, (clientWs) => {
                negotiatedProtocols.delete(req);
                let closed = false;
                let pingTimer = null;
                let trackedPair = null;
                const cleanup = () => {
                    if (closed)
                        return;
                    closed = true;
                    if (pingTimer) {
                        clearInterval(pingTimer);
                        pingTimer = null;
                    }
                    allOpenSockets.delete(terminateOnStop);
                    if (trackedPair) {
                        const set = interactiveSockets.get(trackedPair.epoch);
                        set?.delete(trackedPair);
                        if (set && set.size === 0)
                            interactiveSockets.delete(trackedPair.epoch);
                        trackedPair = null;
                        maybeStopEpochWatcher();
                    }
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
                const terminateOnStop = () => forceClose(1001, 'Server shutting down', true);
                allOpenSockets.add(terminateOnStop);
                if (trackedInteractive) {
                    trackedPair = { epoch: trackedInteractive.epoch, close: () => forceClose(4001, 'Human lease ended') };
                    let bucket = interactiveSockets.get(trackedInteractive.epoch);
                    if (!bucket) {
                        bucket = new Set();
                        interactiveSockets.set(trackedInteractive.epoch, bucket);
                    }
                    bucket.add(trackedPair);
                    ensureEpochWatcher();
                    // Re-check after registering in case revocation raced the upgrade.
                    if (isRevokedInteractiveTicket(ticket)) {
                        forceClose(4001, 'Human lease ended');
                        return;
                    }
                }
                clientWs.on('message', (data, isBinary) => {
                    if (upstreamWs.readyState === WebSocket.OPEN) {
                        upstreamWs.send(data, { binary: isBinary });
                    }
                });
                upstreamWs.on('message', (data, isBinary) => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(data, { binary: isBinary });
                    }
                });
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
                clientWs.on('error', () => forceClose(1011, 'Client socket error'));
                upstreamWs.on('error', () => forceClose(1011, 'Upstream socket error'));
                if (wsPingIntervalMs > 0) {
                    pingTimer = setInterval(() => {
                        if (clientWs.readyState === WebSocket.OPEN) {
                            try {
                                clientWs.ping();
                            }
                            catch { }
                        }
                        if (upstreamWs.readyState === WebSocket.OPEN) {
                            try {
                                upstreamWs.ping();
                            }
                            catch { }
                        }
                    }, wsPingIntervalMs);
                    pingTimer.unref();
                }
            });
        });
        return true;
    }
    function stop() {
        stopped = true;
        stopEpochWatcher();
        for (const close of [...allOpenSockets])
            close();
        allOpenSockets.clear();
        interactiveSockets.clear();
        interactiveTickets.clear();
        revokedTickets.clear();
        revokedEpochs.clear();
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
        stop,
    };
}
