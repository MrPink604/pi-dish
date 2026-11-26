// Generated from src/core/relay-handlers.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CU_PROXY_RESPONSE_TIMEOUT_MS = void 0;
exports.namesPageForms = namesPageForms;
exports.namesCuRoute = namesCuRoute;
exports.namesOmpModelsRoute = namesOmpModelsRoute;
exports.buildHubCuReadHeaders = buildHubCuReadHeaders;
exports.buildHubCuSpacesHttpHeaders = buildHubCuSpacesHttpHeaders;
exports.buildHubCuWsHeaders = buildHubCuWsHeaders;
exports.encodedAssetPath = encodedAssetPath;
exports.relayFirstResponse = relayFirstResponse;
exports.createRelayHandlers = createRelayHandlers;
const hostIdentity = require("./host-identity");
const remoteHosts = __importStar(require("./remote-hosts"));
const access_handlers_1 = require("./access-handlers");
const artifact_isolation_1 = require("./artifact-isolation");
const cu_handlers_1 = require("./cu-handlers");
const helper_values_1 = require("./helper-values");
const wire_protocol_1 = require("./wire-protocol");
const page_forms_1 = require("./page-forms");
/**
 * Whether a generic-proxy path reaches the owner's page-form routes as any
 * hop could read it: Express matches routes case-insensitively, and a
 * normalizing proxy may decode (repeatedly), turn backslashes into slashes and
 * collapse repeated slashes. An undecodable path is treated as a match.
 */
function namesPageForms(path) {
    let decoded = path;
    for (let round = 0; round < 3; round++) {
        let next;
        try {
            next = decodeURIComponent(decoded);
        }
        catch {
            return true;
        }
        if (next === decoded)
            break;
        decoded = next;
    }
    return /(?:^|\/)page-forms(?:\/|$)/.test(decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase());
}
/**
 * Matches any `/hosts/:name/api` suffix that a downstream hop could interpret
 * as a `/api/cu` route (including percent-encoded, mixed-case, or duplicate-slash
 * variants) so CU requests never bypass the hub's header allowlist, CSRF guard,
 * or Spaces route allowlist.
 */
function namesCuRoute(reqPath) {
    let decoded = reqPath;
    for (let round = 0; round < 3; round++) {
        let next;
        try {
            next = decodeURIComponent(decoded);
        }
        catch {
            return true;
        }
        if (next === decoded)
            break;
        decoded = next;
    }
    return /^\/cu(?:\/|$)/.test(decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase());
}
/** Matches `/omp-models` routes, which are strictly local-host only (never proxied to peers). */
function namesOmpModelsRoute(reqPath) {
    let decoded = reqPath;
    for (let round = 0; round < 3; round++) {
        let next;
        try {
            next = decodeURIComponent(decoded);
        }
        catch {
            return true;
        }
        if (next === decoded)
            break;
        decoded = next;
    }
    return /^\/omp-models(?:\/|$)/.test(decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase());
}
const HUB_CU_READ_HEADERS = [
    'accept',
    'accept-language',
    'cache-control',
    'last-event-id',
    'user-agent',
];
const HUB_CU_WS_HEADERS = [
    'upgrade',
    'sec-websocket-key',
    'sec-websocket-version',
    'sec-websocket-protocol',
];
const HUB_CU_RESPONSE_HEADERS = {
    json: ['content-type', 'content-length', 'cache-control'],
    sse: ['content-type', 'content-length', 'cache-control', 'x-accel-buffering'],
    'grpc-web': ['content-type', 'content-length', 'cache-control', 'grpc-status', 'grpc-message', 'grpc-encoding', 'grpc-status-details-bin'],
};
const HUB_CU_WS_RESPONSE_HEADERS = new Set([
    'upgrade',
    'connection',
    'sec-websocket-accept',
    'sec-websocket-protocol',
]);
function mimeEssence(header) {
    const raw = Array.isArray(header) ? header[0] : header;
    if (typeof raw !== 'string')
        return '';
    return raw.split(';')[0].trim().toLowerCase();
}
function isAllowedCuResponse(kind, status, contentType) {
    if (!Number.isInteger(status) || status < 200 || status >= 600)
        return false;
    if (status >= 300 && status < 400)
        return false;
    const mime = mimeEssence(contentType);
    if (kind === 'json')
        return mime === 'application/json';
    if (kind === 'sse') {
        if (status === 200)
            return mime === 'text/event-stream';
        return status >= 400 && mime === 'application/json';
    }
    const isGrpcWeb = mime === 'application/grpc-web'
        || mime === 'application/grpc-web+proto'
        || mime === 'application/grpc-web-text'
        || mime === 'application/grpc-web-text+proto';
    if (status === 200)
        return isGrpcWeb;
    return status >= 400 && (isGrpcWeb || mime === 'application/json');
}
function copyAllowlistedCuResponseHeaders(peerRes, res, kind) {
    const nominated = (0, cu_handlers_1.connectionNominatedHeaders)(peerRes.headers.connection);
    for (const name of HUB_CU_RESPONSE_HEADERS[kind]) {
        if (nominated.has(name))
            continue;
        const value = peerRes.headers[name];
        if (value !== undefined)
            res.setHeader(name, value);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
}
function allowlistHeaders(incoming, allowed, options = {}) {
    const nominated = (0, cu_handlers_1.connectionNominatedHeaders)(incoming.connection);
    if (options.keepUpgradeToken)
        nominated.delete('upgrade');
    const out = {};
    for (const name of allowed) {
        if (nominated.has(name))
            continue;
        const value = incoming[name];
        if (value !== undefined)
            out[name] = value;
    }
    return out;
}
/** Strict hub->guest header allowlist for CU control-plane GET/SSE requests. */
function buildHubCuReadHeaders(incoming) {
    return {
        ...allowlistHeaders(incoming, HUB_CU_READ_HEADERS),
        'accept-encoding': 'identity',
    };
}
/** Strict hub->guest header allowlist for CU Spaces gRPC-Web POST requests. */
function buildHubCuSpacesHttpHeaders(incoming) {
    return {
        ...allowlistHeaders(incoming, cu_handlers_1.ALLOWED_SPACES_REQUEST_HEADERS),
        'accept-encoding': 'identity',
    };
}
/** Strict hub->guest header allowlist for CU `/media` WebSocket upgrades. */
function buildHubCuWsHeaders(incoming) {
    return allowlistHeaders(incoming, HUB_CU_WS_HEADERS, { keepUpgradeToken: true });
}
/**
 * A page asset path (already decoded by Express) re-encoded segment by segment
 * for the owner, or null when a hop could read it as different path
 * structure. Redundant separators collapse, as they do when the owner serves
 * the file itself. A segment is refused when it, or any further decode of it,
 * is a dot segment, holds a control character, decodes to a separator, or has
 * a dot part between backslashes (some hops treat `\` as `/`). Literal `%` and
 * `\` names otherwise pass, encoded.
 */
function encodedAssetPath(rest) {
    if (rest === '' || rest === '/')
        return rest;
    if (!rest.startsWith('/'))
        return null;
    const segments = rest.slice(1).split('/').filter(segment => segment !== '');
    if (segments.some(unsafeSegment))
        return null;
    const trailing = rest.endsWith('/') && segments.length ? '/' : '';
    return `/${segments.map(encodeURIComponent).join('/')}${trailing}`;
}
function unsafeSegment(segment) {
    let reading = segment;
    for (let round = 0; round < 4; round++) {
        if (/[\u0000-\u001f\u007f]/.test(reading) || (round > 0 && reading.includes('/')))
            return true;
        if (reading.split('\\').some(part => part === '.' || part === '..'))
            return true;
        let next;
        try {
            next = decodeURIComponent(reading);
        }
        catch {
            return false;
        }
        if (next === reading)
            return false;
        reading = next;
    }
    return true;
}
const PROXY_TERMINAL_PATH_RE = /^\/hosts\/([^/]+)\/api\/sessions\/[^/]+\/terminal$/;
const PROXY_CU_SPACES_PATH_RE = /^\/hosts\/([^/]+)\/api\/cu\/spaces(\/.*)$/;
const PROXY_RESPONSE_TIMEOUT_MS = 10_000;
// Hub CU relay headroom over guest spaces proxy (10s) and broker (8s).
exports.CU_PROXY_RESPONSE_TIMEOUT_MS = 15_000;
const MAX_CU_MUTATION_BODY_BYTES = 64 * 1024;
const CU_READ_PATHS = new Set(['/cu/status', '/cu/stream', '/cu/audit']);
const CU_MUTATION_PATHS = new Set(['/cu/takeover', '/cu/heartbeat', '/cu/release', '/cu/viewer/ticket']);
const HOSTS_PROBE_DEADLINE_MS = 3000;
const HOP_BY_HOP_HEADERS = {
    connection: true, 'keep-alive': true, 'transfer-encoding': true, te: true,
    trailer: true, upgrade: true, 'proxy-authenticate': true,
};
// The request promise includes SSH setup, so deadlines arm only once it yields a
// request; any response clears both the socket inactivity timeout and response
// deadline for good (idle SSE streams included). During a large upload, the
// upstream socket's native inactivity timeout counts real kernel I/O so actively
// draining uploads stay alive while stalled uploads and post-finish hangs time out.
function relayFirstResponse(opening, timeoutMs, send, respond, onFailure, classifyError) {
    let settled = false;
    const fail = (reason) => {
        if (settled)
            return;
        settled = true;
        onFailure(reason);
    };
    const error = (cause) => fail(classifyError ? classifyError(cause) : undefined);
    opening.then((upstream) => {
        let setupTimer = null;
        let responseTimer = null;
        let activeSocket = null;
        let connectHandler = null;
        const clearSetupTimer = () => {
            if (setupTimer !== null) {
                clearTimeout(setupTimer);
                setupTimer = null;
            }
        };
        const clearResponseTimer = () => {
            if (responseTimer !== null) {
                clearTimeout(responseTimer);
                responseTimer = null;
            }
        };
        const clearSocketTimeout = () => {
            if (!activeSocket)
                return;
            activeSocket.removeListener('timeout', onTimeout);
            if (connectHandler) {
                activeSocket.removeListener('connect', connectHandler);
                connectHandler = null;
            }
            if (typeof activeSocket.setTimeout === 'function')
                activeSocket.setTimeout(0);
            activeSocket = null;
        };
        const disarm = () => {
            clearSetupTimer();
            clearResponseTimer();
            clearSocketTimeout();
        };
        const onTimeout = () => {
            if (settled)
                return;
            disarm();
            try {
                upstream.destroy();
            }
            catch { }
            fail('timeout');
        };
        const armResponseDeadline = () => {
            if (settled || responseTimer !== null)
                return;
            responseTimer = setTimeout(onTimeout, timeoutMs);
        };
        const attachSocket = (socket) => {
            if (settled || activeSocket === socket)
                return;
            clearSocketTimeout();
            activeSocket = socket;
            if (typeof socket.setTimeout === 'function') {
                socket.setTimeout(timeoutMs);
                socket.on('timeout', onTimeout);
                if (!socket.connecting) {
                    clearSetupTimer();
                    clearResponseTimer();
                    if (upstream.writableFinished)
                        armResponseDeadline();
                }
                else {
                    clearResponseTimer();
                    connectHandler = () => {
                        connectHandler = null;
                        if (settled)
                            return;
                        clearSetupTimer();
                        if (upstream.writableFinished)
                            armResponseDeadline();
                    };
                    socket.once('connect', connectHandler);
                }
            }
        };
        setupTimer = setTimeout(onTimeout, timeoutMs);
        if (upstream.socket)
            attachSocket(upstream.socket);
        else
            upstream.once('socket', attachSocket);
        upstream.once('finish', () => {
            if (settled)
                return;
            if (activeSocket && !activeSocket.connecting)
                armResponseDeadline();
        });
        upstream.on('error', (cause) => { disarm(); error(cause); });
        upstream.once('close', disarm);
        upstream.on('response', (peerRes) => {
            disarm();
            if (settled)
                return peerRes.resume();
            settled = true;
            respond(peerRes);
        });
        send(upstream);
    }).catch(error);
}
function copyRelayResponseHeaders(peerRes, res) {
    for (const [key, value] of Object.entries(peerRes.headers)) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS[lower] === true || lower.startsWith('access-control-'))
            continue;
        res.setHeader(key, value);
    }
}
// The race keeps one wedged peer from holding the fleet list open.
function boundedProbe(remote) {
    return Promise.race([
        remoteHosts.probe(remote).catch(() => ({ reachable: false })),
        new Promise((resolve) => setTimeout(() => resolve({ reachable: false, error: 'timeout' }), HOSTS_PROBE_DEADLINE_MS).unref()),
    ]);
}
function createRelayHandlers(ports) {
    const { fleetArtifacts } = ports;
    const proxyResponseTimeoutMs = ports.proxyResponseTimeoutMs ?? PROXY_RESPONSE_TIMEOUT_MS;
    const cuProxyResponseTimeoutMs = ports.cuProxyResponseTimeoutMs ?? exports.CU_PROXY_RESPONSE_TIMEOUT_MS;
    const checkCuMutationIngress = ports.checkCuMutationIngress
        ?? ((req, res) => (0, access_handlers_1.checkCuMutationIngressRequest)(req, res));
    const rawApi = (req, res) => {
        const remote = remoteHosts.getRemote(req.params.name);
        // Bare 404: the fleet map is not a discovery surface.
        if (!remote)
            return res.status(404).type('text/plain').send('Not found');
        // The vault bridge belongs to the host's own listener; it is never a fleet route.
        if (/^\/vault\/bridge(?:\/|$)/.test(req.path))
            return res.status(404).type('text/plain').send('Not found');
        // Page forms are owner-only: only this host's dedicated relay (behind its
        // same-origin check) may carry them, never the generic API proxy.
        if (namesPageForms(req.path)) {
            return res.status(403).json({ error: 'page forms are answered through /api/page-forms on this host, not the /hosts proxy' });
        }
        // OMP model allow-list management is local-host only (no peer proxying).
        if (namesOmpModelsRoute(req.path)) {
            return res.status(501).json({ available: false, error: 'unavailable', message: 'OMP model allow-list management is only available on the local host.' });
        }
        // Computer-use routes use strict header allowlists, ingress CSRF checks,
        // vendored local viewer assets, and allowlisted Spaces RPC routes.
        if (namesCuRoute(req.url.split('?')[0]) || namesCuRoute(req.path)) {
            return handleCuRelay(remote, req, res);
        }
        proxyToRemote(remote, req, res, fleetArtifactHook(remote, req));
    };
    function handleCuRelay(remote, req, res) {
        const rawUrl = req.url || '/';
        const queryAt = rawUrl.indexOf('?');
        const rawPath = queryAt >= 0 ? rawUrl.slice(0, queryAt) : rawUrl;
        const search = queryAt >= 0 ? rawUrl.slice(queryAt) : '';
        if (rawPath === '/cu/spaces' || rawPath.startsWith('/cu/spaces/')) {
            const suffix = rawPath.slice('/cu/spaces'.length) + search;
            if (!suffix.startsWith('/')) {
                res.status(404).type('text/plain').send('Not found');
                return;
            }
            const safe = (0, cu_handlers_1.sanitizeSpacesPath)(suffix);
            if (!safe) {
                res.status(400).type('text/plain').send('Bad request');
                return;
            }
            // Serve pinned vendored cua-spacesd v0.17.7 viewer assets from the hub
            // directly so guest-supplied HTML/JS never enters the dish origin.
            if ((0, cu_handlers_1.serveVendoredCuViewer)(req, res, safe))
                return;
            const routeKind = (0, cu_handlers_1.classifySpacesHttpRoute)(safe.pathname);
            if (!routeKind) {
                res.status(404).type('text/plain').send('Not found');
                return;
            }
            if (req.method !== 'POST') {
                res.status(405).type('text/plain').send('Method not allowed');
                return;
            }
            const headers = buildHubCuSpacesHttpHeaders(req.headers);
            proxyToRemote(remote, req, res, null, {
                path: `/api/cu/spaces${safe.pathname}${safe.search}`,
                headers,
                timeoutMs: cuProxyResponseTimeoutMs,
                cuResponseKind: 'grpc-web',
            });
            return;
        }
        if (CU_READ_PATHS.has(rawPath)) {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.status(405).type('text/plain').send('Method not allowed');
                return;
            }
            const headers = buildHubCuReadHeaders(req.headers);
            proxyToRemote(remote, req, res, null, {
                path: `/api${rawPath}${search}`,
                headers,
                timeoutMs: cuProxyResponseTimeoutMs,
                cuResponseKind: rawPath === '/cu/stream' ? 'sse' : 'json',
            });
            return;
        }
        if (CU_MUTATION_PATHS.has(rawPath)) {
            if (req.method !== 'POST') {
                res.status(405).type('text/plain').send('Method not allowed');
                return;
            }
            // Enforce browser Origin / Fetch Metadata and JSON Content-Type at hub
            // ingress BEFORE remoteHosts.request strips Origin.
            if (!checkCuMutationIngress(req, res))
                return;
            const chunks = [];
            let totalBytes = 0;
            let done = false;
            req.on('data', (chunk) => {
                if (done)
                    return;
                totalBytes += chunk.length;
                if (totalBytes > MAX_CU_MUTATION_BODY_BYTES) {
                    done = true;
                    res.status(413).json({ error: 'Computer-use request body too large' });
                    req.resume();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('aborted', () => { done = true; });
            req.on('error', () => {
                if (done)
                    return;
                done = true;
                if (!res.headersSent)
                    res.status(400).json({ error: 'Invalid request body' });
            });
            req.on('end', () => {
                if (done)
                    return;
                done = true;
                const text = Buffer.concat(chunks).toString('utf8').trim();
                let parsed;
                try {
                    parsed = text ? JSON.parse(text) : null;
                }
                catch {
                    res.status(400).json({ error: 'Expected a valid JSON object body' });
                    return;
                }
                if (!(0, helper_values_1.record)(parsed)) {
                    res.status(400).json({ error: 'Expected a JSON object body' });
                    return;
                }
                // Forward the already-validated JSON text directly with its UTF-8 byte
                // length (no second JSON.stringify, avoiding recursion throws in callbacks).
                const nominated = (0, cu_handlers_1.connectionNominatedHeaders)(req.headers.connection);
                const headers = {
                    accept: 'application/json',
                    'accept-encoding': 'identity',
                    'content-type': 'application/json',
                    'content-length': String(Buffer.byteLength(text, 'utf8')),
                };
                if (!nominated.has('user-agent') && req.headers['user-agent'] !== undefined) {
                    headers['user-agent'] = req.headers['user-agent'];
                }
                proxyToRemote(remote, req, res, null, {
                    path: `/api${rawPath}${search}`,
                    headers,
                    timeoutMs: cuProxyResponseTimeoutMs,
                    bodyPayload: text,
                    cuResponseKind: 'json',
                });
            });
            return;
        }
        res.status(404).type('text/plain').send('Not found');
    }
    function proxyToRemote(remote, req, res, hook = null, override = {}) {
        const unreachable = (reason) => {
            res.status(502).json({ error: `Host ${remote.name} is unreachable`, host: remote.name, reason });
        };
        // A peer known down answers instantly: a sleeping tailscale machine
        // black-holes the connect and would cost the whole first-byte timer.
        const known = remoteHosts.reachability(remote);
        if (known && !known.reachable)
            return unreachable(known.error || 'unreachable');
        // A hooked response is parsed, not relayed byte for byte, so it must be uncompressed.
        const baseHeaders = override.headers ?? req.headers;
        const headers = hook ? { ...baseHeaders, 'accept-encoding': 'identity' } : baseHeaders;
        const targetPath = override.path ?? `/api${req.url}`;
        const timeoutMs = override.timeoutMs ?? proxyResponseTimeoutMs;
        relayFirstResponse(remoteHosts.request(remote, { method: req.method, path: targetPath, headers }), timeoutMs, (upstream) => {
            if (override.bodyPayload !== undefined) {
                upstream.end(override.bodyPayload);
            }
            else {
                req.on('aborted', () => { try {
                    upstream.destroy();
                }
                catch { } });
                req.pipe(upstream);
            }
        }, (peerRes) => {
            if (override.cuResponseKind) {
                const statusCode = peerRes.statusCode ?? 0;
                if (!isAllowedCuResponse(override.cuResponseKind, statusCode, peerRes.headers['content-type'])) {
                    peerRes.resume();
                    try {
                        peerRes.destroy();
                    }
                    catch { }
                    res.setHeader('X-Content-Type-Options', 'nosniff');
                    res.status(502).json({ error: 'Unexpected response type or redirect from computer-use host' });
                    return;
                }
                res.status(statusCode);
                copyAllowlistedCuResponseHeaders(peerRes, res, override.cuResponseKind);
                if (override.cuResponseKind === 'sse' && statusCode === 200)
                    res.flushHeaders();
                peerRes.pipe(res);
                res.on('close', () => { try {
                    peerRes.destroy();
                }
                catch { } });
                return;
            }
            res.status(peerRes.statusCode);
            copyRelayResponseHeaders(peerRes, res);
            if (hook && String(peerRes.headers['content-type'] || '').includes('application/json')) {
                // The body may be rewritten, changing its length.
                res.removeHeader('Content-Length');
                return relayHookedJson(peerRes, res, hook);
            }
            // Content-Encoding passes through (compression already excludes
            // /hosts/*), so event streams arrive as the peer wrote them.
            if (String(peerRes.headers['content-type'] || '').startsWith('text/event-stream'))
                res.flushHeaders();
            peerRes.pipe(res);
            res.on('close', () => { try {
                peerRes.destroy();
            }
            catch { } });
        }, (reason) => {
            // Only transport failures reach here; peer HTTP statuses don't trip the breaker.
            remoteHosts.noteTransportFailure(remote, reason);
            unreachable(reason);
        }, remoteHosts.errorCode);
    }
    // The only buffered exception to the byte-relay rule: small JSON creation/revocation replies.
    const FLEET_ARTIFACT_BODY_LIMIT = 64 * 1024;
    const PROXY_SHARE_PATH_RE = /^\/sessions\/[^/]+\/share$/;
    const PROXY_PAGE_TOKEN_PATH_RE = /^\/pages\/([^/]+)$/;
    const PUBLIC_ARTIFACT_TIMEOUT_MS = 10_000;
    // Allowlist so the hub's origin/credentials never leak into a peer's logs.
    const PUBLIC_FORWARD_HEADERS = ['accept', 'accept-language', 'range', 'if-range', 'if-none-match', 'if-modified-since', 'user-agent'];
    // Set by a hub fronting this page from a listener with no /api (see serveFleetArtifact).
    const PAGE_COMMENTS_HEADER = 'x-pi-dish-page-comments';
    // Marks every hub→peer public-artifact request; the receiver answers from its
    // local registry only, bounding mutually-remote fleets to one hop. Never copied
    // from the client request.
    const ARTIFACT_HOP_HEADER = 'x-pi-dish-artifact-hop';
    // Discovery bounds: negative cache against refresh storms, shared in-flight
    // lookups, and a global cap on outbound traffic an anonymous listener can cause.
    const DISCOVERY_NEGATIVE_TTL_MS = 30_000;
    const DISCOVERY_NEGATIVE_CAP = 1000;
    const DISCOVERY_CONCURRENCY = 16;
    const discoveryAbsent = new Map();
    const discoveryInFlight = new Map();
    /** null when no public base is configured (client builds it). */
    function publicUrlFor(publicPath) {
        const base = ports.publicBaseUrl();
        return base ? base.replace(/\/+$/, '') + publicPath : null;
    }
    function fleetArtifactPayload(token, kind) {
        const publicPath = kind === 'share' ? `/share/${token}` : `/page/${token}`;
        return { token, path: publicPath, url: publicUrlFor(publicPath) };
    }
    /**
     * A peer minting a share/page through this hub records where the token lives
     * and answers with the hub's public URL: the peer's PI_DISH_SHARE_BASE_URL may
     * describe a front door this reader lacks.
     */
    function fleetArtifactHook(remote, req) {
        const reqPath = req.url.split('?')[0];
        const isShare = PROXY_SHARE_PATH_RE.test(reqPath);
        const pageTokenMatch = PROXY_PAGE_TOKEN_PATH_RE.exec(reqPath);
        // /shares/import: an OMP share is a snapshot the peer minted, fronted like any other.
        if (req.method === 'POST' && (isShare || reqPath === '/shares/import' || reqPath === '/pages')) {
            const kind = reqPath === '/pages' ? 'page' : 'share';
            return (status, body) => {
                if (status < 200 || status >= 300)
                    return body;
                if (!body || typeof body !== 'object' || !fleetArtifacts.record((0, wire_protocol_1.asRecord)(body).token, remote.name, kind))
                    return body;
                return { ...body, ...fleetArtifactPayload((0, wire_protocol_1.asRecord)(body).token, kind) };
            };
        }
        if (req.method === 'DELETE' && (isShare || pageTokenMatch)) {
            // A page revoke names its token in the path; a share revoke reports it in
            // the body (when it doesn't, the serving path's 404 prune is the backstop).
            const pathToken = pageTokenMatch ? decodeURIComponent(pageTokenMatch[1]) : null;
            return (status, body) => {
                if (status < 200 || status >= 300)
                    return body;
                const token = pathToken || (body && typeof (0, wire_protocol_1.asRecord)(body).token === 'string' ? (0, wire_protocol_1.asRecord)(body).token : null);
                if (token)
                    fleetArtifacts.remove(token, remote.name);
                return body;
            };
        }
        return null;
    }
    function relayHookedJson(peerRes, res, hook) {
        let raw = '';
        let relaying = false;
        peerRes.setEncoding('utf8');
        peerRes.on('data', (chunk) => {
            if (relaying)
                return void res.write(chunk);
            raw += chunk;
            // Too large for an artifact reply: stop interpreting and relay.
            if (raw.length > FLEET_ARTIFACT_BODY_LIMIT) {
                relaying = true;
                res.write(raw);
                raw = '';
            }
        });
        peerRes.on('error', () => { try {
            res.end();
        }
        catch { } });
        peerRes.on('end', () => {
            if (relaying)
                return res.end();
            let body;
            try {
                body = JSON.parse(raw);
            }
            catch {
                return res.end(raw);
            }
            let out = body;
            try {
                out = hook(peerRes.statusCode, body);
            }
            catch {
                out = body;
            }
            res.end(JSON.stringify(out === undefined ? body : out));
        });
        res.on('close', () => { try {
            peerRes.destroy();
        }
        catch { } });
    }
    /** Fleet-map membership is the authorization: only known remotes are probed. */
    async function findRemoteByHostId(hostId) {
        const remotes = remoteHosts.listRemotes();
        const probes = await Promise.all(remotes.map(boundedProbe));
        const index = probes.findIndex((probe) => probe.reachable && probe.descriptor?.hostId === hostId);
        return index >= 0 ? remotes[index] : null;
    }
    // A peer's agent publishes locally, then asks the hub (via its own server's
    // proxy) to front it, so it never needs the hub's address or credential.
    const registerArtifact = async (req, res) => {
        const { token, kind, hostId } = (0, wire_protocol_1.asRecord)(req.body);
        if (!fleetArtifacts.isValidToken(token)) {
            return res.status(400).json({ error: 'token required (base64url, max 128 characters)' });
        }
        if (!fleetArtifacts.isValidKind(kind)) {
            return res.status(400).json({ error: 'kind must be "share" or "page"' });
        }
        if (typeof hostId !== 'string' || !hostId || hostId.length > 256) {
            return res.status(400).json({ error: 'hostId required' });
        }
        if (hostId === hostIdentity.getHostId()) {
            return res.status(404).json({ error: 'hostId is this host, not one of its configured remotes' });
        }
        const remote = await findRemoteByHostId(hostId);
        if (!remote) {
            return res.status(404).json({ error: 'no configured, reachable remote has that hostId' });
        }
        if (!fleetArtifacts.record(token, remote.name, kind)) {
            return res.status(400).json({ error: 'artifact could not be recorded' });
        }
        res.json({ ...fleetArtifactPayload(token, kind), host: remote.name });
    };
    const listArtifacts = (_req, res) => {
        const artifacts = [];
        for (const [host, entries] of Object.entries(fleetArtifacts.listByHost())) {
            for (const entry of entries)
                artifacts.push({ ...entry, host, ...fleetArtifactPayload(entry.token, entry.kind) });
        }
        artifacts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        res.json({ artifacts });
    };
    const removeArtifact = (req, res) => {
        // Only ends public reachability through this hub; the owner revokes the
        // artifact. The tombstone stops rediscovery until the artifact is re-created.
        res.json({ revoked: fleetArtifacts.suppress(req.params.token) });
    };
    function knownAbsent(key) {
        const expires = discoveryAbsent.get(key);
        if (expires === undefined)
            return false;
        if (expires > Date.now())
            return true;
        discoveryAbsent.delete(key);
        return false;
    }
    function rememberAbsent(key) {
        discoveryAbsent.delete(key);
        discoveryAbsent.set(key, Date.now() + DISCOVERY_NEGATIVE_TTL_MS);
        // Map iteration is insertion order: first key is oldest.
        while (discoveryAbsent.size > DISCOVERY_NEGATIVE_CAP) {
            const oldest = discoveryAbsent.keys().next().value;
            if (oldest === undefined)
                break;
            discoveryAbsent.delete(oldest);
        }
    }
    /**
     * HEADs the token's document on each remote (any 2xx/3xx claims it). Tokens are
     * ≥128-bit random capabilities, only fleet-map members are contacted, and the
     * hop header keeps it to one hop.
     */
    function discoverOwner(token, kind) {
        const key = `${kind}:${token}`;
        const joined = discoveryInFlight.get(key);
        if (joined)
            return joined;
        if (knownAbsent(key))
            return Promise.resolve(null);
        const remotes = remoteHosts.listRemotes();
        // No fleet, no traffic: the single-host invariant.
        if (remotes.length === 0)
            return Promise.resolve(null);
        // Over the cap: not-found without probing or caching — the token may exist.
        if (discoveryInFlight.size >= DISCOVERY_CONCURRENCY)
            return Promise.resolve(null);
        const discovery = new Promise((resolve) => {
            const docPath = kind === 'share' ? `/share/${token}` : `/page/${token}`;
            let pending = 0;
            let claimed = false;
            let definite = true;
            let probed = 0;
            const settle = () => {
                if (claimed || --pending > 0)
                    return;
                if (probed > 0 && definite)
                    rememberAbsent(key);
                resolve(null);
            };
            for (const remote of remotes) {
                // Skip known-down peers; one may own the token, so nothing is cached.
                const known = remoteHosts.reachability(remote);
                if (known && !known.reachable) {
                    definite = false;
                    continue;
                }
                pending++;
                probed++;
                relayFirstResponse(remoteHosts.request(remote, {
                    method: 'HEAD',
                    path: docPath,
                    headers: { 'accept-encoding': 'identity', [ARTIFACT_HOP_HEADER]: '1' },
                }), PUBLIC_ARTIFACT_TIMEOUT_MS, (upstream) => upstream.end(), (peerRes) => {
                    peerRes.resume();
                    const status = peerRes.statusCode || 0;
                    if (status >= 200 && status < 400 && !claimed) {
                        claimed = true;
                        // A concurrent explicit unmap wins over discovery.
                        if (fleetArtifacts.isSuppressed(token))
                            return resolve(null);
                        return resolve(fleetArtifacts.record(token, remote.name, kind));
                    }
                    settle();
                }, (reason) => {
                    remoteHosts.noteTransportFailure(remote, reason);
                    definite = false;
                    settle();
                }, remoteHosts.errorCode);
            }
            if (pending === 0)
                resolve(null);
        }).finally(() => { discoveryInFlight.delete(key); });
        discoveryInFlight.set(key, discovery);
        return discovery;
    }
    /**
     * Fallback for a /share or /page token this host doesn't own. Unmapped
     * (suppressed) tokens and hub hop requests 404 without contacting anybody.
     */
    function serveFleetArtifact(req, res, kind, { annotate = true } = {}) {
        const token = req.params.token;
        const notFound = () => { if (!res.headersSent)
            res.status(404).type('text/plain').send('Not found'); };
        // Another hub asking: the local registry, already checked, is the whole answer.
        if (req.headers[ARTIFACT_HOP_HEADER] !== undefined)
            return notFound();
        if (!fleetArtifacts.isValidToken(token))
            return notFound();
        const mapping = fleetArtifacts.get(token);
        if (mapping) {
            if (mapping.kind !== kind)
                return notFound();
            return relayMapped(req, res, kind, annotate, token, mapping, notFound);
        }
        if (fleetArtifacts.isSuppressed(token))
            return notFound();
        discoverOwner(token, kind).then((found) => {
            if (!found || found.kind !== kind)
                return notFound();
            relayMapped(req, res, kind, annotate, token, found, notFound);
        }, notFound);
    }
    function relayMapped(req, res, kind, annotate, token, mapping, notFound) {
        const remote = remoteHosts.getRemote(mapping.host);
        if (!remote)
            return notFound();
        const rawRest = kind === 'page' ? (req.params[0] || (req.path.endsWith('/') ? '/' : '')) : '';
        // Rebuilt from validated, re-encoded segments: a path a normalizing proxy
        // could resolve elsewhere never leaves this host with the owner's credential.
        const rest = encodedAssetPath(rawRest);
        if (rest === null)
            return notFound();
        const documentRequest = kind === 'share' || rest === '' || rest === '/';
        const queryAt = req.originalUrl.indexOf('?');
        const query = queryAt >= 0 ? req.originalUrl.slice(queryAt) : '';
        const peerPath = kind === 'share' ? `/share/${token}${query}` : `/page/${token}${rest}${query}`;
        const headers = { 'accept-encoding': 'identity', [ARTIFACT_HOP_HEADER]: '1' };
        for (const name of PUBLIC_FORWARD_HEADERS) {
            if (req.headers[name] !== undefined)
                headers[name] = req.headers[name];
        }
        // The overlay's calls are relative and need /api; ask the owner to skip
        // injection so this listener serves raw HTML as it does for local pages.
        if (kind === 'page' && !annotate)
            headers[PAGE_COMMENTS_HEADER] = 'off';
        // This front serves pi-dish's /forms view, so the owner may link its form there.
        if (kind === 'page' && annotate)
            headers['x-pi-dish-forms'] = '1';
        relayFirstResponse(remoteHosts.request(remote, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', path: peerPath, headers }), PUBLIC_ARTIFACT_TIMEOUT_MS, (upstream) => upstream.end(), (peerRes) => {
            if (peerRes.statusCode === 404) {
                // Only the token's own document proves a revoke (a missing asset is the
                // page's own 404). A single-file page 404s `/page/t/` while `/page/t`
                // lives, so verify the bare form before pruning and redirect there.
                peerRes.resume();
                if (!documentRequest)
                    return notFound();
                if (kind === 'page' && rest === '/') {
                    return relayFirstResponse(remoteHosts.request(remote, { method: 'GET', path: `/page/${token}`, headers }), PUBLIC_ARTIFACT_TIMEOUT_MS, (check) => check.end(), (checkRes) => {
                        checkRes.resume();
                        if (checkRes.statusCode === 404) {
                            fleetArtifacts.remove(token, mapping.host);
                            return notFound();
                        }
                        res.redirect(302, `/page/${token}${query}`);
                    }, notFound, null);
                }
                fleetArtifacts.remove(token, mapping.host);
                return notFound();
            }
            res.status(peerRes.statusCode);
            copyRelayResponseHeaders(peerRes, res);
            (0, artifact_isolation_1.isolateArtifact)(res, kind);
            peerRes.pipe(res);
            res.on('close', () => { try {
                peerRes.destroy();
            }
            catch { } });
        }, () => { res.status(502).type('text/plain').send('Host unavailable'); }, null);
    }
    const hosts = async (_req, res) => {
        const remotes = remoteHosts.listRemotes();
        const probes = await Promise.all(remotes.map(boundedProbe));
        const hosts = [{
                self: true,
                name: null,
                base: '',
                ...ports.hostDescriptor(),
                reachable: true,
            }];
        remotes.forEach((remote, i) => {
            const probe = probes[i];
            const entry = { name: remote.name, base: `/hosts/${remote.name}`, kind: remote.kind, reachable: !!probe.reachable };
            if (probe.reachable && probe.descriptor) {
                entry.hostId = probe.descriptor.hostId;
                entry.label = probe.descriptor.label || remote.name;
                entry.version = probe.descriptor.version;
                entry.capabilities = probe.descriptor.capabilities;
            }
            else {
                entry.error = ('error' in probe && probe.error) || 'unreachable';
            }
            hosts.push(entry);
        });
        res.json({ hosts });
    };
    // Feedback on a fronted page belongs to the owner host whose agent reads it.
    // The owner URL is built from route params alone (never a request suffix).
    // `capability`: what the owner must advertise first (an older host gets a 404).
    function ownerPageRelay(build, bodyLimit, capability = null) {
        return (req, res, next) => {
            const token = req.params.token;
            // Another hub's relayed call: answered from this host's own pages only.
            if (req.headers[ARTIFACT_HOP_HEADER] !== undefined)
                return next();
            if (!fleetArtifacts.isValidToken(token) || ports.localPageExists(token))
                return next();
            const peerPath = build(req, token);
            if (peerPath === null)
                return res.status(404).json({ error: 'not found' });
            const relay = (mapping) => {
                const remote = mapping?.kind === 'page' ? remoteHosts.getRemote(mapping.host) : null;
                if (!remote)
                    return next();
                if (!capability)
                    return proxyToPageOwner(remote, req, res, peerPath, bodyLimit);
                void remoteHosts.probe(remote).then((probe) => {
                    if (!probe.reachable)
                        return res.status(502).json({ error: `Host ${remote.name} is unreachable`, host: remote.name });
                    if (probe.descriptor?.capabilities?.[capability] !== true) {
                        return res.status(404).json({ error: `Host ${remote.name} runs a pi-dish that cannot take form answers`, host: remote.name });
                    }
                    proxyToPageOwner(remote, req, res, peerPath, bodyLimit);
                });
            };
            const mapping = fleetArtifacts.get(token);
            if (mapping || fleetArtifacts.isSuppressed(token))
                return relay(mapping);
            // A form view opened straight from a link: find the page's host first.
            discoverOwner(token, 'page').then(relay, () => next());
        };
    }
    // Ids are opaque tokens; anything else is refused here rather than relayed.
    const COMMENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
    const segment = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
    // Comment replies keep their long-standing limit, counted in UTF-16 units as
    // it always was (a long CJK quote and comment fit); the form budget is bytes.
    const COMMENT_BODY_LIMIT = { max: FLEET_ARTIFACT_BODY_LIMIT, count: chunk => chunk.length };
    const FORM_BODY_LIMIT = { max: page_forms_1.PAGE_FORMS_RELAY_LIMIT, count: chunk => Buffer.byteLength(chunk) };
    const pageComments = route => ownerPageRelay((req, token) => {
        const base = `/api/page-comments/${encodeURIComponent(token)}`;
        if (route === 'list')
            return base;
        const id = segment(req.params.id, COMMENT_ID_RE);
        return id && `${base}/${id}${route === 'delete' ? '/delete' : ''}`;
    }, COMMENT_BODY_LIMIT);
    // A form's spec, answers and receipts are budgeted under this (src/core/page-forms.ts).
    const pageForms = route => ownerPageRelay((req, token) => {
        const base = `/api/page-forms/${encodeURIComponent(token)}`;
        if (route === 'receipt') {
            const id = segment(req.params.id, page_forms_1.SUBMISSION_ID_RE);
            return id && `${base}/receipts/${id}`;
        }
        if (req.query.submission === undefined)
            return base;
        const submission = segment(req.query.submission, page_forms_1.SUBMISSION_ID_RE);
        return submission && `${base}?submission=${submission}`;
    }, FORM_BODY_LIMIT, page_forms_1.PAGE_FORMS_CAPABILITY);
    // Small JSON both ways with the body already parsed by express: the same
    // buffered exception as artifact creation replies. A body cut short is a 502,
    // never a truncated or empty success.
    function proxyToPageOwner(remote, req, res, peerPath, bodyLimit) {
        const payload = req.method === 'GET' || req.method === 'HEAD' ? null : JSON.stringify(req.body ?? {});
        const headers = {
            accept: 'application/json', 'accept-encoding': 'identity', [ARTIFACT_HOP_HEADER]: '1', [page_forms_1.FORM_CLIENT_HEADER]: 'relay',
        };
        if (payload !== null) {
            headers['content-type'] = 'application/json';
            headers['content-length'] = String(Buffer.byteLength(payload));
        }
        relayFirstResponse(remoteHosts.request(remote, { method: req.method, path: peerPath, headers }), proxyResponseTimeoutMs, (upstream) => {
            if (payload !== null)
                upstream.write(payload);
            upstream.end();
        }, (peerRes) => {
            let raw = '';
            let size = 0;
            let done = false;
            const fail = (error) => {
                if (done)
                    return;
                done = true;
                peerRes.destroy();
                if (!res.headersSent)
                    res.status(502).json({ error: `Host ${remote.name} ${error}`, host: remote.name });
            };
            peerRes.setEncoding('utf8');
            peerRes.on('data', (chunk) => {
                if (done)
                    return;
                raw += chunk;
                size += bodyLimit.count(chunk);
                if (size > bodyLimit.max)
                    fail('returned an oversized page response');
            });
            peerRes.on('aborted', () => fail('sent an incomplete response'));
            peerRes.on('error', () => fail('sent an incomplete response'));
            peerRes.on('end', () => {
                if (done)
                    return;
                if (!peerRes.complete || (!raw && req.method !== 'HEAD'))
                    return fail('sent an incomplete response');
                done = true;
                if (req.method === 'HEAD') {
                    // The owner's metadata for the body it would send.
                    res.status(peerRes.statusCode);
                    for (const name of ['content-type', 'content-length', 'cache-control']) {
                        const value = peerRes.headers[name];
                        if (value !== undefined)
                            res.setHeader(name, value);
                    }
                    res.end();
                    return;
                }
                res.status(peerRes.statusCode).type('application/json').send(raw);
            });
        }, (reason) => { res.status(502).json({ error: `Host ${remote.name} is unreachable`, host: remote.name, reason }); }, remoteHosts.errorCode);
    }
    // Works even when this host's terminal or computer-use feature is off: the
    // PTY or cua-spacesd lives on the peer.
    const upgrade = (req, socket, head, url) => {
        const terminalMatch = PROXY_TERMINAL_PATH_RE.exec(url.pathname);
        const cuSpacesMatch = terminalMatch ? null : PROXY_CU_SPACES_PATH_RE.exec(url.pathname);
        const hostName = terminalMatch?.[1] ?? cuSpacesMatch?.[1];
        if (!hostName)
            return false;
        const remote = remoteHosts.getRemote(hostName);
        if (!remote) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return true;
        }
        let cuUpgradeOverride;
        if (cuSpacesMatch) {
            const rawPrefix = `/hosts/${hostName}/api/cu/spaces`;
            const rawUrl = req.url || '';
            const safe = rawUrl.startsWith(`${rawPrefix}/`) ? (0, cu_handlers_1.sanitizeSpacesPath)(rawUrl.slice(rawPrefix.length)) : null;
            if (!safe) {
                socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                socket.destroy();
                return true;
            }
            if (!(0, cu_handlers_1.isAllowedSpacesWsPath)(safe.pathname)) {
                socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                socket.destroy();
                return true;
            }
            if (!(0, cu_handlers_1.validateWebSocketHandshake)(req)) {
                socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                socket.destroy();
                return true;
            }
            // Allowlist CU WS headers at the hub so browser cookies and Cf-Access-*
            // identity headers never reach the sandbox; remoteHosts attaches peer bearer.
            cuUpgradeOverride = {
                headers: buildHubCuWsHeaders(req.headers),
                peerPath: `/api/cu/spaces${safe.pathname}${safe.search}`,
                cuWs: true,
            };
        }
        // This host's gate, applied by hand; the peer's own credential is attached
        // downstream, never the caller's.
        if (!ports.upgradeAuthorized(req, url)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return true;
        }
        proxyUpgrade(remote, req, socket, head, url, cuUpgradeOverride);
        return true;
    };
    function proxyUpgrade(remote, req, socket, head, url, override) {
        const teardown = () => { try {
            socket.destroy();
        }
        catch { } };
        const peerPath = override?.peerPath ?? (url.pathname.slice(`/hosts/${remote.name}`.length) + url.search);
        const headers = override?.headers ?? req.headers;
        remoteHosts.request(remote, { method: 'GET', path: peerPath, headers, upgrade: true })
            .then((upstream) => {
            upstream.on('error', teardown);
            socket.on('error', teardown);
            // A client hanging up mid-handshake must not leave a half-open peer request.
            socket.once('close', () => { try {
                upstream.destroy();
            }
            catch { } });
            upstream.on('upgrade', (peerRes, peerSocket, peerHead) => {
                if (override?.cuWs && peerRes.statusCode !== 101) {
                    try {
                        peerSocket.destroy();
                    }
                    catch { }
                    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                    teardown();
                    return;
                }
                const lines = [`HTTP/1.1 ${peerRes.statusCode} ${peerRes.statusMessage || 'Switching Protocols'}`];
                for (const [key, value] of Object.entries(peerRes.headers)) {
                    if (override?.cuWs && !HUB_CU_WS_RESPONSE_HEADERS.has(key.toLowerCase()))
                        continue;
                    for (const one of Array.isArray(value) ? value : [value]) {
                        if (one === undefined)
                            continue;
                        if (override?.cuWs && /[\r\n]/.test(one))
                            continue;
                        lines.push(`${key}: ${one}`);
                    }
                }
                socket.write(`${lines.join('\r\n')}\r\n\r\n`);
                if (peerHead && peerHead.length)
                    socket.write(peerHead);
                if (head && head.length)
                    peerSocket.write(head);
                peerSocket.on('error', teardown);
                peerSocket.on('close', teardown);
                socket.on('close', () => { try {
                    peerSocket.destroy();
                }
                catch { } });
                socket.pipe(peerSocket);
                peerSocket.pipe(socket);
            });
            // Peer refused the handshake: relay its status, not a dead socket.
            upstream.on('response', (peerRes) => {
                peerRes.resume();
                const status = peerRes.statusCode ?? 502;
                if (override?.cuWs && status >= 300 && status < 400) {
                    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                }
                else {
                    socket.write(`HTTP/1.1 ${status} ${peerRes.statusMessage || ''}\r\n\r\n`);
                }
                socket.destroy();
            });
            upstream.end();
        })
            .catch(() => {
            try {
                socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            }
            catch { }
            teardown();
        });
    }
    return { rawApi, registerArtifact, listArtifacts, removeArtifact, hosts, pageComments, pageForms, publicArtifacts: { serve: serveFleetArtifact }, upgrade };
}
