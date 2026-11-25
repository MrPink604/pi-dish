// Generated test/tool from test/cu-viewer.test.ts; edit that source and run npm run build:tests.
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
/**
 * Focused tests for Slice 1 computer-use broker client, vendored cua-spacesd
 * v0.17.7 viewer serving, hub/guest Spaces route & header allowlisting, CSRF
 * ingress guards, WS handshake validation/backpressure/ping-pong eviction,
 * fail-closed broker-epoch revocation with distinct viewer & media tickets,
 * watcher rearming, and bounded SSE error/event buffers.
 *
 * Run with: npm test -- test/cu-viewer.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const WebSocketLib = require("ws");
const access_handlers_1 = require("../lib/access-handlers");
const cu_handlers_1 = require("../lib/cu-handlers");
const relay_handlers_1 = require("../lib/relay-handlers");
const fleetArtifacts = __importStar(require("../lib/fleet-artifacts"));
const remoteHosts = __importStar(require("../lib/remote-hosts"));
const test_types_js_1 = require("./test-types.js");
const { WebSocket, WebSocketServer } = WebSocketLib;
async function listenTcp(t, server, beforeClose) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    t.after(() => new Promise(resolve => {
        beforeClose?.();
        server.closeAllConnections?.();
        server.close(() => resolve());
    }));
    return server.address().port;
}
async function listenUnix(t, server, beforeClose, fixedPath) {
    const dir = fixedPath ? path.dirname(fixedPath) : fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-sock-'));
    const sock = fixedPath ?? path.join(dir, 'control.sock');
    try {
        fs.unlinkSync(sock);
    }
    catch { }
    await new Promise(resolve => server.listen(sock, () => resolve()));
    t.after(async () => {
        await new Promise(resolve => {
            beforeClose?.();
            server.closeAllConnections?.();
            server.close(() => resolve());
        });
        if (!fixedPath)
            fs.rmSync(dir, { recursive: true, force: true });
        else
            try {
                fs.unlinkSync(sock);
            }
            catch { }
    });
    return sock;
}
async function startFakeBroker(t, fixedSocketPath) {
    const sseClients = new Set();
    let serverClosed = false;
    const broker = {
        state: 'agent',
        epoch: 3,
        lease: {
            leaseId: 'lease-agent-1',
            sessionId: 'omp-sess-1',
            holderKind: 'agent',
            label: 'omp-worker',
            expiresAt: new Date(Date.now() + 90_000).toISOString(),
        },
        preempted: null,
        leaseToken: null,
        lastTakeoverBody: null,
        lastReleaseBody: null,
        sseClients,
        eventsMode: 'normal',
        overrideStatusEpoch: null,
        overrideTicketEpoch: null,
        dropWatchOnNextTakeover: false,
        holdNextRelease: null,
        emitEvent(eventName, payload) {
            const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
            for (const client of sseClients)
                client.write(frame);
        },
        dropWatchers() {
            for (const client of [...sseClients]) {
                try {
                    client.destroy();
                }
                catch { }
            }
            sseClients.clear();
        },
        closeServer: async () => {
            if (serverClosed)
                return;
            serverClosed = true;
            broker.dropWatchers();
            await new Promise(resolve => {
                server.closeAllConnections?.();
                server.close(() => resolve());
            });
        },
    };
    let ticketSeq = 0;
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (req.method === 'GET' && url.pathname === '/v1/status') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                version: 1,
                state: broker.state,
                epoch: broker.overrideStatusEpoch ?? broker.epoch,
                lease: broker.lease,
                preempted: broker.preempted,
                viewer: { upstream: 'http://127.0.0.1:3211' },
                health: { broker: true, spacesd: true, driver: true, xvfb: true, desktop: true, chrome: true, driverWorkerRunning: true },
            }));
            return;
        }
        if (req.method === 'GET' && url.pathname === '/v1/events') {
            if (broker.eventsMode === 'error-huge') {
                res.writeHead(500, { 'content-type': 'text/plain' });
                res.end('X'.repeat(2048));
                return;
            }
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            res.flushHeaders();
            sseClients.add(res);
            res.write(`event: hello\ndata: ${JSON.stringify({ state: broker.state, epoch: broker.epoch, lease: broker.lease, preempted: broker.preempted })}\n\n`);
            if (broker.eventsMode === 'event-huge') {
                res.write(`data: ${'A'.repeat(2048)}`);
            }
            res.on('close', () => sseClients.delete(res));
            return;
        }
        if (req.method === 'GET' && url.pathname === '/v1/audit') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, entries: [{ ts: '2026-11-24T00:00:00Z', action: 'takeover' }] }));
            return;
        }
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            let body = {};
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                    body = parsed;
            }
            catch { }
            if (req.method === 'POST' && url.pathname === '/v1/viewer/ticket') {
                const mode = body.mode === 'interactive' ? 'interactive' : 'view-only';
                if (mode === 'interactive' && (broker.state !== 'human' || body.leaseToken !== broker.leaseToken)) {
                    res.writeHead(403, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'human_lease_required', message: 'Active human lease required' }));
                    return;
                }
                const ticket = `${mode}-viewer-ticket-${++ticketSeq}`;
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    ok: true,
                    epoch: broker.overrideTicketEpoch ?? broker.epoch,
                    mode,
                    ticket,
                    path: `/viewer/#ticket=${ticket}`,
                    ttlSec: mode === 'interactive' ? 1800 : 3600,
                    expiresAt: new Date(Date.now() + 1800_000).toISOString(),
                    upstream: 'http://127.0.0.1:3211',
                }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/lease/takeover') {
                broker.lastTakeoverBody = body;
                if (broker.state === 'human') {
                    res.writeHead(409, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({
                        ok: false,
                        code: 'seat_busy',
                        state: 'human',
                        epoch: broker.epoch,
                        lease: broker.lease,
                        message: 'Desktop is held by another human session',
                    }));
                    return;
                }
                const previousAgent = broker.state === 'agent' && broker.lease
                    ? { sessionId: broker.lease.sessionId, label: broker.lease.label }
                    : null;
                broker.epoch += 1;
                broker.state = 'human';
                broker.preempted = previousAgent;
                broker.leaseToken = `human-tok-${broker.epoch}`;
                const ttlSec = typeof body.ttlSec === 'number' ? body.ttlSec : 600;
                const leaseId = `human-lease-${broker.epoch}`;
                broker.lease = {
                    leaseId,
                    holderKind: 'human',
                    label: typeof body.label === 'string' ? body.label : 'pi-dish',
                    expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
                };
                const ticket = `interactive-viewer-ticket-${++ticketSeq}`;
                const reply = {
                    ok: true,
                    state: 'human',
                    epoch: broker.epoch,
                    lease: broker.lease,
                    leaseId,
                    leaseToken: broker.leaseToken,
                    token: broker.leaseToken,
                    preempted: broker.preempted,
                    heartbeatIntervalSec: 60,
                    viewer: {
                        mode: 'interactive',
                        ticket,
                        path: `/viewer/#ticket=${ticket}`,
                        ttlSec: 1800,
                        expiresAt: new Date(Date.now() + 1800_000).toISOString(),
                        upstream: 'http://127.0.0.1:3211',
                    },
                };
                if (broker.dropWatchOnNextTakeover) {
                    broker.dropWatchOnNextTakeover = false;
                    broker.dropWatchers();
                    setTimeout(() => {
                        res.writeHead(200, { 'content-type': 'application/json' });
                        res.end(JSON.stringify(reply));
                    }, 25);
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(reply));
                broker.emitEvent('lease_changed', { state: broker.state, epoch: broker.epoch, lease: broker.lease, preempted: broker.preempted });
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/lease/heartbeat') {
                if (broker.state !== 'human' || body.leaseToken !== broker.leaseToken) {
                    res.writeHead(409, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'lease_lost', state: broker.state, epoch: broker.epoch, lease: broker.lease, message: 'Lease is no longer active' }));
                    return;
                }
                const expiresAt = new Date(Date.now() + 600_000).toISOString();
                if (broker.lease)
                    broker.lease.expiresAt = expiresAt;
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, state: broker.state, epoch: broker.epoch, lease: broker.lease, expiresAt }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/lease/release') {
                broker.lastReleaseBody = body;
                if (broker.state === 'human' && body.leaseToken !== broker.leaseToken) {
                    res.writeHead(403, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'forbidden', message: 'Wrong lease token' }));
                    return;
                }
                broker.epoch += 1;
                const handedBack = body.handBack === true && broker.preempted ? broker.preempted : null;
                broker.leaseToken = null;
                let replyJson;
                if (handedBack) {
                    broker.state = 'agent';
                    broker.lease = {
                        leaseId: 'lease-agent-1',
                        sessionId: handedBack.sessionId,
                        holderKind: 'agent',
                        label: handedBack.label,
                        expiresAt: new Date(Date.now() + 90_000).toISOString(),
                    };
                    broker.preempted = null;
                    replyJson = JSON.stringify({ ok: true, state: 'agent', epoch: broker.epoch, lease: broker.lease, handedBackTo: handedBack });
                    broker.emitEvent('hand_back', { state: 'agent', epoch: broker.epoch, lease: broker.lease, preempted: null });
                }
                else {
                    broker.state = 'idle';
                    broker.lease = null;
                    broker.preempted = null;
                    replyJson = JSON.stringify({ ok: true, state: 'idle', epoch: broker.epoch, released: true, handedBackTo: null });
                    broker.emitEvent('seat_idle', { state: 'idle', epoch: broker.epoch, lease: null, preempted: null });
                }
                const hold = broker.holdNextRelease;
                broker.holdNextRelease = null;
                if (hold) {
                    void hold.then(() => {
                        if (!res.writableEnded && !res.destroyed) {
                            res.writeHead(200, { 'content-type': 'application/json' });
                            res.end(replyJson);
                        }
                    });
                }
                else {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(replyJson);
                }
                return;
            }
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        });
    });
    const socketPath = await listenUnix(t, server, () => {
        broker.dropWatchers();
    }, fixedSocketPath);
    return { socketPath, broker };
}
function encodeProtoVarint(value) {
    let n = BigInt(value);
    const bytes = [];
    do {
        let b = Number(n & 0x7fn);
        n >>= 7n;
        if (n > 0n)
            b |= 0x80;
        bytes.push(b);
    } while (n > 0n);
    return Buffer.from(bytes);
}
function encodeProtoFieldBytes(field, payload) {
    return Buffer.concat([encodeProtoVarint((field << 3) | 2), encodeProtoVarint(payload.length), payload]);
}
function encodeProtoFieldString(field, value) {
    return encodeProtoFieldBytes(field, Buffer.from(value, 'utf8'));
}
function encodeGrpcWebFrame(flags, payload) {
    const header = Buffer.alloc(5);
    header[0] = flags;
    header.writeUInt32BE(payload.length, 1);
    return Buffer.concat([header, payload]);
}
function encodeOpenMediaResponse(opts) {
    const parts = [];
    if (opts.mediaSessionId !== undefined)
        parts.push(encodeProtoFieldString(1, opts.mediaSessionId));
    if (opts.ticket !== undefined)
        parts.push(encodeProtoFieldString(2, opts.ticket));
    if (opts.expiresAtSec !== undefined) {
        const tsPayload = Buffer.concat([encodeProtoVarint((1 << 3) | 0), encodeProtoVarint(opts.expiresAtSec)]);
        parts.push(encodeProtoFieldBytes(3, tsPayload));
    }
    if (opts.wsPath !== undefined)
        parts.push(encodeProtoFieldString(4, opts.wsPath));
    const dataFrame = encodeGrpcWebFrame(opts.compressed ? 0x01 : 0x00, Buffer.concat(parts));
    const frames = [dataFrame];
    if (opts.grpcStatusTrailer !== undefined) {
        frames.push(encodeGrpcWebFrame(0x80, Buffer.from(`grpc-status: ${opts.grpcStatusTrailer}\r\n`, 'ascii')));
    }
    const combined = Buffer.concat(frames);
    return opts.textBase64 ? Buffer.from(combined.toString('base64'), 'ascii') : combined;
}
function encodeProtoFieldVarint(field, value) {
    return Buffer.concat([encodeProtoVarint((field << 3) | 0), encodeProtoVarint(value)]);
}
function encodeOpenMediaRequest(opts) {
    const parts = [];
    if (opts.displayId !== undefined || opts.windowId !== undefined) {
        const targetParts = [];
        if (opts.displayId !== undefined)
            targetParts.push(encodeProtoFieldString(1, opts.displayId));
        if (opts.windowId !== undefined) {
            const windowRef = encodeProtoFieldString(1, `win-${opts.windowId}`);
            targetParts.push(encodeProtoFieldBytes(2, windowRef));
        }
        parts.push(encodeProtoFieldBytes(1, Buffer.concat(targetParts)));
    }
    if (opts.secondTargetWindowId !== undefined) {
        const windowRef = encodeProtoFieldString(1, `win-${opts.secondTargetWindowId}`);
        parts.push(encodeProtoFieldBytes(1, encodeProtoFieldBytes(2, windowRef)));
    }
    if (opts.codecs && opts.codecs.length > 0) {
        parts.push(encodeProtoFieldBytes(2, Buffer.concat(opts.codecs.map(c => encodeProtoVarint(c)))));
    }
    if (opts.maxFps !== undefined)
        parts.push(encodeProtoFieldVarint(3, opts.maxFps));
    if (opts.maxDimension !== undefined)
        parts.push(encodeProtoFieldVarint(4, opts.maxDimension));
    if (opts.policy !== undefined)
        parts.push(encodeProtoFieldVarint(6, opts.policy));
    if (opts.geometryControl !== undefined)
        parts.push(encodeProtoFieldVarint(7, opts.geometryControl));
    if (opts.ticketTtlSec !== undefined) {
        parts.push(encodeProtoFieldBytes(8, encodeProtoFieldVarint(1, opts.ticketTtlSec)));
    }
    if (opts.audioEnabled) {
        const enc = Buffer.concat([encodeProtoFieldBytes(1, encodeProtoVarint(1)), encodeProtoFieldVarint(7, 20)]);
        const audio = Buffer.concat([encodeProtoFieldVarint(1, 1), encodeProtoFieldBytes(3, enc)]);
        parts.push(encodeProtoFieldBytes(10, audio));
    }
    const frame = encodeGrpcWebFrame(opts.compressed ? 0x01 : 0x00, Buffer.concat(parts));
    return opts.textBase64 ? Buffer.from(frame.toString('base64'), 'ascii') : frame;
}
const VALID_DISPLAY_OPEN_MEDIA_BODY = encodeOpenMediaRequest({
    displayId: 'primary',
    codecs: [1, 3],
    maxFps: 60,
    maxDimension: 1280,
    policy: 1,
    ticketTtlSec: 600,
    audioEnabled: true,
});
async function mintMediaViaOpenMedia(base, viewerTicket, extraHeaders = {}) {
    const res = await fetch(`${base}/api/cu/spaces/cua.env.v1.StreamService/OpenMedia`, {
        method: 'POST',
        headers: {
            'content-type': 'application/grpc-web+proto',
            'x-cua-env-authorization': `Bearer ${viewerTicket}`,
            ...extraHeaders,
        },
        body: VALID_DISPLAY_OPEN_MEDIA_BODY,
    });
    assert.equal(res.status, 200, `OpenMedia should succeed (got ${res.status})`);
    const body = Buffer.from(await res.arrayBuffer());
    const parsed = (0, cu_handlers_1.parseOpenMediaResponse)(res.headers.get('content-type') ?? undefined, res.headers.get('grpc-status') ?? undefined, body);
    assert.equal(parsed.kind, 'ok');
    return { mediaTicket: parsed.ticket, wsPath: `/media?ticket=${encodeURIComponent(parsed.ticket)}` };
}
async function mintViewOnlyMedia(base, extraHeaders = {}) {
    const ticketRes = await fetch(`${base}/api/cu/viewer/ticket`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...extraHeaders },
        body: JSON.stringify({ mode: 'view-only' }),
    });
    assert.equal(ticketRes.status, 200, `view-only ticket should succeed (got ${ticketRes.status})`);
    const ticketJson = (0, test_types_js_1.record)(await ticketRes.json());
    const viewerTicket = ticketJson.ticket;
    const { mediaTicket, wsPath } = await mintMediaViaOpenMedia(base, viewerTicket, extraHeaders);
    return { viewerTicket, mediaTicket, wsPath };
}
function dialWsStatus(url, protocols = ['rcdp.v2']) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, protocols);
        ws.once('open', () => { ws.close(); resolve(101); });
        ws.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode ?? 0); });
        ws.once('error', (err) => reject(err));
    });
}
async function startFakeSpaces(t) {
    const requests = [];
    const wsConnections = [];
    const heldResponses = new Set();
    let resolveClipboard;
    let clipboardRequestSeen = new Promise(resolve => { resolveClipboard = resolve; });
    const wss = new WebSocketServer({
        noServer: true,
        handleProtocols: (protocols) => (protocols.has('rcdp.v2') ? 'rcdp.v2' : false),
    });
    const fake = {
        port: 0,
        requests,
        wsConnections,
        holdClipboardRequests: false,
        heldResponses,
        clipboardRequestSeen,
        resetClipboardWaiter() {
            fake.clipboardRequestSeen = new Promise(resolve => { resolveClipboard = resolve; });
        },
    };
    let mediaSeq = 0;
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            requests.push({ method: req.method || 'GET', url: req.url || '/', headers: { ...req.headers }, body });
            if (req.url === '/cua.env.v1.StreamService/OpenMedia') {
                // Real cua-spacesd v0.17.7 mints a distinct media-session ticket returned in
                // OpenMediaResponse proto3 fields (2: ticket, 3: ticket_expires_at, 4: ws_path).
                const seq = ++mediaSeq;
                const mediaTicket = `distinct-media-ticket-${seq}`;
                const wsPath = `/media?ticket=${mediaTicket}`;
                const protoRes = encodeOpenMediaResponse({
                    mediaSessionId: `media-sess-${seq}`,
                    ticket: mediaTicket,
                    expiresAtSec: Math.floor(Date.now() / 1000) + 600,
                    wsPath,
                    grpcStatusTrailer: '0',
                });
                res.writeHead(200, {
                    'content-type': 'application/grpc-web+proto',
                    'content-length': String(protoRes.length),
                });
                res.end(protoRes);
                return;
            }
            if (req.url === '/cua.env.v1.ComputerService/SetClipboard' && fake.holdClipboardRequests) {
                heldResponses.add(res);
                res.on('close', () => heldResponses.delete(res));
                resolveClipboard();
                return;
            }
            if (req.url?.startsWith('/cua.env.v1.')) {
                res.writeHead(200, {
                    'content-type': 'application/grpc-web+proto',
                    'grpc-status': '0',
                    'grpc-message': 'ok',
                    'access-control-allow-origin': '*',
                });
                res.end(body);
                return;
            }
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('upstream not found');
        });
    });
    server.on('upgrade', (req, socket, head) => {
        const url = req.url || '/';
        if (!url.startsWith('/media')) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            wsConnections.push({ url, protocol: ws.protocol, headers: { ...req.headers }, ws });
            ws.on('message', (data, isBinary) => {
                ws.send(data, { binary: isBinary });
            });
        });
    });
    fake.port = await listenTcp(t, server, () => {
        for (const r of heldResponses) {
            try {
                r.destroy();
            }
            catch { }
        }
        heldResponses.clear();
        for (const conn of wsConnections) {
            try {
                conn.ws.terminate();
            }
            catch { }
        }
        try {
            wss.close();
        }
        catch { }
    });
    return fake;
}
function rawHttpUpgrade(port, rawPath, headers) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: rawPath, headers });
        req.once('response', (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.once('upgrade', (_res, sock) => { sock.destroy(); resolve(101); });
        req.once('error', reject);
        req.end();
    });
}
test('sanitizeSpacesPath and Spaces route allowlists block traversal, file handlers, and unknown services', () => {
    assert.deepEqual((0, cu_handlers_1.sanitizeSpacesPath)('/'), { pathname: '/', search: '' });
    assert.deepEqual((0, cu_handlers_1.sanitizeSpacesPath)('/viewer/'), { pathname: '/viewer/', search: '' });
    assert.deepEqual((0, cu_handlers_1.sanitizeSpacesPath)('/cua.env.v1.StreamService/OpenMedia'), { pathname: '/cua.env.v1.StreamService/OpenMedia', search: '' });
    assert.deepEqual((0, cu_handlers_1.sanitizeSpacesPath)('/media?ticket=abc_123'), { pathname: '/media', search: '?ticket=abc_123' });
    for (const bad of [
        '', 'viewer/', '/../etc/passwd', '/viewer/../../secret', '/%2e%2e/secret',
        '/%252e%252e/secret', '/viewer/%2e/index.html', '/viewer/%2f/secret',
        '/viewer/a\\b', '//127.0.0.1/viewer/', '/viewer//viewer.js', '/viewer/\x00test',
        '/media?ticket=a\r\nb', '/%ZZ/bad',
    ]) {
        assert.equal((0, cu_handlers_1.sanitizeSpacesPath)(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
    assert.equal((0, cu_handlers_1.classifySpacesHttpRoute)('/cua.env.v1.SystemService/GetCapabilities'), 'view');
    assert.equal((0, cu_handlers_1.classifySpacesHttpRoute)('/cua.env.v1.StreamService/OpenMedia'), 'view');
    assert.equal((0, cu_handlers_1.classifySpacesHttpRoute)('/cua.env.v1.PresenceService/Join'), 'view');
    assert.equal((0, cu_handlers_1.classifySpacesHttpRoute)('/cua.env.v1.ComputerService/GetClipboard'), 'interactive');
    assert.equal((0, cu_handlers_1.classifySpacesHttpRoute)('/cua.env.v1.ComputerService/SetClipboard'), 'interactive');
    for (const blocked of [
        '/files', '/files/download.html', '/share/token', '/viewer/', '/viewer/viewer.js',
        '/cua.env.v1.FilesystemService/ReadFile', '/cua.env.v1.ProcessService/StartProcess',
        '/cua.env.v1.SystemService/CreateViewerTicket', '/cua.env.v1.ComputerService/Pointer',
    ]) {
        assert.equal((0, cu_handlers_1.classifySpacesHttpRoute)(blocked), null, `should block HTTP route ${blocked}`);
    }
    assert.equal((0, cu_handlers_1.isAllowedSpacesWsPath)('/media'), true);
    assert.equal((0, cu_handlers_1.isAllowedSpacesWsPath)('/viewer/'), false);
    assert.equal((0, cu_handlers_1.isAllowedSpacesWsPath)('/files'), false);
    assert.equal((0, relay_handlers_1.namesCuRoute)('/cu/takeover'), true);
    assert.equal((0, relay_handlers_1.namesCuRoute)('/%63u/takeover'), true);
    assert.equal((0, relay_handlers_1.namesCuRoute)('/CU/spaces/files'), true);
    assert.equal((0, relay_handlers_1.namesCuRoute)('/sessions/123'), false);
});
test('injectFetchCredsScript inserts static shim idempotently and upgrades only same-origin omit', () => {
    const html = '<html><head><title>x</title></head><body><script type="module" src="./viewer.js"></script></body></html>';
    const injected = (0, cu_handlers_1.injectFetchCredsScript)(html);
    assert.equal(injected, '<html><head><title>x</title></head><body><script src="./cu-fetch-creds.js"></script><script type="module" src="./viewer.js"></script></body></html>');
    assert.equal((0, cu_handlers_1.injectFetchCredsScript)(injected), injected);
    const calls = [];
    const context = vm.createContext({
        URL,
        location: { href: 'https://dish.example/hosts/cu-sandbox/api/cu/spaces/viewer/', origin: 'https://dish.example' },
        fetch: (input, init) => {
            calls.push({ input, init });
            return Promise.resolve({ ok: true });
        },
    });
    context.globalThis = context;
    vm.runInContext(cu_handlers_1.CU_FETCH_CREDS_JS, context);
    vm.runInContext(`
    fetch('../cua.env.v1.StreamService/OpenMedia', { method: 'POST', credentials: 'omit' });
    fetch('https://dish.example/hosts/cu-sandbox/api/cu/spaces/cua.env.v1.StreamService/OpenMedia', { credentials: 'omit' });
    fetch('https://other.example/api', { credentials: 'omit' });
    fetch('../cua.env.v1.StreamService/ListTargets', { credentials: 'include' });
  `, context);
    assert.equal(calls[0].init?.credentials, 'same-origin');
    assert.equal(calls[1].init?.credentials, 'same-origin');
    assert.equal(calls[2].init?.credentials, 'omit', 'cross-origin fetch must keep credentials: omit');
    assert.equal(calls[3].init?.credentials, 'include');
});
test('hub and guest CU header allowlists strip cookies, Cf-Access-*, auth, and Connection-nominated headers', () => {
    const dirty = {
        host: 'dish.example',
        authorization: 'Bearer secret-hub-token',
        cookie: 'CF_Authorization=jwt-secret',
        'cf-access-jwt-assertion': 'jwt-secret',
        'cf-access-authenticated-user-email': 'owner@example.com',
        'x-forwarded-for': '1.2.3.4',
        origin: 'https://dish.example',
        referer: 'https://dish.example/',
        'x-pi-dish-private-unlock': 'unlock-secret',
        connection: 'Upgrade, keep-alive, x-cua-env-authorization, x-custom-hop',
        'x-custom-hop': 'should-not-pass',
        'content-type': 'application/grpc-web+proto',
        'x-grpc-web': '1',
        'x-cua-env-authorization': 'Bearer viewer-ticket',
        'accept-encoding': 'gzip, br',
        accept: 'application/json',
        upgrade: 'websocket',
        'sec-websocket-key': Buffer.from('0123456789abcdef').toString('base64'),
        'sec-websocket-version': '13',
        'sec-websocket-protocol': 'rcdp.v2',
        'sec-websocket-extensions': 'permessage-deflate',
    };
    const guestHeaders = (0, cu_handlers_1.buildSpacesRequestHeaders)(dirty, 3211);
    assert.equal(guestHeaders.host, '127.0.0.1:3211');
    assert.equal(guestHeaders['accept-encoding'], 'identity');
    assert.equal(guestHeaders['content-type'], 'application/grpc-web+proto');
    assert.equal(guestHeaders['x-grpc-web'], '1');
    for (const forbidden of ['authorization', 'cookie', 'cf-access-jwt-assertion', 'cf-access-authenticated-user-email', 'x-forwarded-for', 'origin', 'referer', 'x-pi-dish-private-unlock', 'x-cua-env-authorization', 'x-custom-hop']) {
        assert.equal(guestHeaders[forbidden], undefined, `guest must drop ${forbidden}`);
    }
    const hubRead = (0, relay_handlers_1.buildHubCuReadHeaders)(dirty);
    assert.equal(hubRead.accept, 'application/json');
    assert.equal(hubRead['accept-encoding'], 'identity');
    for (const forbidden of ['authorization', 'cookie', 'cf-access-jwt-assertion', 'cf-access-authenticated-user-email', 'origin', 'x-custom-hop']) {
        assert.equal(hubRead[forbidden], undefined, `hubRead must drop ${forbidden}`);
    }
    const hubSpaces = (0, relay_handlers_1.buildHubCuSpacesHttpHeaders)(dirty);
    assert.equal(hubSpaces['x-grpc-web'], '1');
    assert.equal(hubSpaces['x-cua-env-authorization'], undefined, 'Connection-nominated header dropped before Connection');
    for (const forbidden of ['authorization', 'cookie', 'cf-access-jwt-assertion', 'origin', 'x-custom-hop']) {
        assert.equal(hubSpaces[forbidden], undefined, `hubSpaces must drop ${forbidden}`);
    }
    const hubWs = (0, relay_handlers_1.buildHubCuWsHeaders)(dirty);
    assert.equal(hubWs.upgrade, 'websocket');
    assert.equal(hubWs['sec-websocket-protocol'], 'rcdp.v2');
    assert.equal(hubWs['sec-websocket-version'], '13');
    assert.equal(hubWs['sec-websocket-extensions'], undefined);
    for (const forbidden of ['authorization', 'cookie', 'cf-access-jwt-assertion', 'cf-access-authenticated-user-email', 'origin', 'x-custom-hop']) {
        assert.equal(hubWs[forbidden], undefined, `hubWs must drop ${forbidden}`);
    }
});
test('feature gating: missing broker socket omits capability and returns 404 on HTTP and WS', async (t) => {
    const missingSock = path.join(os.tmpdir(), `pi-dish-cu-missing-${process.pid}-${Date.now()}.sock`);
    const cu = (0, cu_handlers_1.createCuHandlers)({ upgradeAuthorized: () => true, socketPath: () => missingSock });
    t.after(() => cu.stop());
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
        computerUseAvailable: () => cu.available(),
    });
    assert.equal(cu.available(), false);
    assert.equal('computerUse' in access.hostDescriptor().capabilities, false);
    const app = express();
    app.use('/api/cu/spaces', access.requireBearer, cu.spacesProxy);
    app.use(access.jsonBody);
    app.get('/api/cu/status', cu.status);
    app.post('/api/cu/takeover', access.cuMutationGuard, cu.takeover);
    const server = http.createServer(app);
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!cu.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const port = await listenTcp(t, server);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/cu/status`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/cu/takeover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/cu/spaces/viewer/`)).status, 404);
    const wsStatus = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces/media?ticket=t1`, ['rcdp.v2']);
        ws.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode ?? 0); });
        ws.once('open', () => { ws.close(); reject(new Error('Expected 404, not open')); });
        ws.once('error', () => { });
    });
    assert.equal(wsStatus, 404);
});
test('vendored viewer assets served from hub & guest without contacting spacesd; non-allowlisted routes & files 404; hub scrubs headers', async (t) => {
    const { socketPath } = await startFakeBroker(t);
    const spaces = await startFakeSpaces(t);
    const prevToken = process.env.PI_DISH_TOKEN;
    process.env.PI_DISH_TOKEN = 'cu-peer-secret-token';
    const guestAccess = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
        computerUseAvailable: () => cu.available(),
    });
    if (prevToken === undefined)
        delete process.env.PI_DISH_TOKEN;
    else
        process.env.PI_DISH_TOKEN = prevToken;
    const cu = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: req => guestAccess.bearerUpgradeAuthorized(req),
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
    });
    t.after(() => cu.stop());
    const guestHeadersSeen = [];
    const guestApp = express();
    guestApp.use((req, _res, next) => {
        guestHeadersSeen.push({ path: req.url, headers: { ...req.headers } });
        next();
    });
    guestApp.use('/api/cu/spaces', guestAccess.requireBearer, cu.spacesProxy);
    guestApp.use(guestAccess.compression);
    guestApp.use(guestAccess.jsonBody);
    guestApp.use('/api', guestAccess.apiGate);
    guestApp.get('/api/cu/status', cu.status);
    guestApp.get('/api/cu/stream', cu.stream);
    guestApp.post('/api/cu/takeover', guestAccess.cuMutationGuard, cu.takeover);
    guestApp.post('/api/cu/viewer/ticket', guestAccess.cuMutationGuard, cu.viewerTicket);
    const guestServer = http.createServer(guestApp);
    guestServer.on('upgrade', (req, socket, head) => {
        guestHeadersSeen.push({ path: `WS ${req.url}`, headers: { ...req.headers } });
        const url = new URL(req.url || '/', 'http://localhost');
        if (!cu.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const guestPort = await listenTcp(t, guestServer);
    const remote = {
        name: 'cu-sandbox',
        kind: 'direct',
        origin: `http://127.0.0.1:${guestPort}`,
        token: 'cu-peer-secret-token',
    };
    t.mock.method(remoteHosts, 'getRemote', (candidate) => (candidate === 'cu-sandbox' ? remote : null));
    t.mock.method(remoteHosts, 'reachability', () => null);
    const hubAccess = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
    });
    const relay = (0, relay_handlers_1.createRelayHandlers)({
        fleetArtifacts,
        localPageExists: () => false,
        publicBaseUrl: () => undefined,
        hostDescriptor: hubAccess.hostDescriptor,
        upgradeAuthorized: () => true,
        checkCuMutationIngress: hubAccess.checkCuMutationIngress,
    });
    const hubApp = express();
    hubApp.use('/hosts/:name/api', relay.rawApi);
    const hubServer = http.createServer(hubApp);
    hubServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!relay.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const hubPort = await listenTcp(t, hubServer);
    const hubBase = `http://127.0.0.1:${hubPort}/hosts/cu-sandbox`;
    const guestBase = `http://127.0.0.1:${guestPort}`;
    // Guest bearer auth cannot be bypassed via /host, /ready, or OPTIONS on /api/cu/spaces.
    assert.equal((await fetch(`${guestBase}/api/cu/spaces/host`)).status, 401);
    assert.equal((await fetch(`${guestBase}/api/cu/spaces/ready`)).status, 401);
    assert.equal((await fetch(`${guestBase}/api/cu/spaces/viewer/`, { method: 'OPTIONS' })).status, 401);
    // Hub serves vendored cua-spacesd v0.17.7 viewer assets locally — guest is NEVER contacted.
    const guestCountBeforeViewer = guestHeadersSeen.length;
    const viewerRes = await fetch(`${hubBase}/api/cu/spaces/viewer/`);
    assert.equal(viewerRes.status, 200);
    assert.equal(viewerRes.headers.get('content-security-policy'), cu_handlers_1.CU_VIEWER_CSP);
    assert.equal(viewerRes.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(viewerRes.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(viewerRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(viewerRes.headers.get('cache-control'), 'no-store');
    const html = await viewerRes.text();
    assert.match(html, /<script src="\.\/cu-fetch-creds\.js"><\/script><script type="module" crossorigin src="\.\/viewer\.js"><\/script>/);
    for (const asset of ['viewer.js', 'index.css', 'audioWorklet.js', 'captureWorklet.js', 'cu-fetch-creds.js']) {
        const assetRes = await fetch(`${hubBase}/api/cu/spaces/viewer/${asset}`);
        assert.equal(assetRes.status, 200, `hub should serve vendored ${asset}`);
        if (asset === 'cu-fetch-creds.js')
            assert.equal(await assetRes.text(), cu_handlers_1.CU_FETCH_CREDS_JS);
        else
            assert.ok((await assetRes.arrayBuffer()).byteLength > 100);
    }
    const redirRes = await fetch(`${hubBase}/api/cu/spaces/viewer`, { redirect: 'manual' });
    assert.equal(redirRes.status, 301);
    assert.equal(redirRes.headers.get('location'), 'viewer/');
    // Non-allowlisted viewer files (e.g. LICENSE, UPSTREAM.txt) return 404.
    assert.equal((await fetch(`${hubBase}/api/cu/spaces/viewer/LICENSE`)).status, 404);
    assert.equal((await fetch(`${hubBase}/api/cu/spaces/viewer/UPSTREAM.txt`)).status, 404);
    assert.equal(guestHeadersSeen.length, guestCountBeforeViewer, 'hub must serve vendored viewer without hitting guest');
    assert.equal(spaces.requests.length, 0, 'spacesd must never be hit for /viewer/*');
    // File handlers, share handlers, and non-allowlisted gRPC services return 404 at BOTH hub and guest.
    for (const blocked of [
        '/api/cu/spaces/files/inline.html',
        '/api/cu/spaces/share/abc',
        '/api/cu/spaces/cua.env.v1.FilesystemService/ReadFile',
        '/api/cu/spaces/cua.env.v1.ProcessService/StartProcess',
        '/api/cu/spaces/cua.env.v1.SystemService/CreateViewerTicket',
    ]) {
        assert.equal((await fetch(`${hubBase}${blocked}`, { method: 'POST', body: 'x' })).status, 404, `hub must block ${blocked}`);
        assert.equal((await fetch(`${guestBase}${blocked}`, {
            method: 'POST',
            headers: { authorization: 'Bearer cu-peer-secret-token' },
            body: 'x',
        })).status, 404, `guest must block ${blocked}`);
    }
    assert.equal(spaces.requests.length, 0, 'blocked routes must never reach spacesd');
    // Percent-encoded CU path cannot bypass hub CU handling.
    const encodedStatus = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: hubPort, method: 'POST', path: '/hosts/cu-sandbox/api/%63u/takeover' }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end('{}');
    });
    assert.equal(encodedStatus, 404);
    // Hub HTTP header scrubbing: cookies, Cf-Access-*, Origin, and Connection-nominated headers never reach guest.
    const binaryPayload = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x04, 0xde, 0xad, 0xbe, 0xef]);
    const grpcRes = await new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port: hubPort,
            method: 'POST',
            path: '/hosts/cu-sandbox/api/cu/spaces/cua.env.v1.SystemService/GetCapabilities',
            headers: {
                'content-type': 'application/grpc-web+proto',
                'content-length': String(binaryPayload.length),
                'x-grpc-web': '1',
                'x-cua-env-authorization': 'Bearer view-only-ticket-1',
                cookie: 'CF_Authorization=hub-secret-cookie',
                'cf-access-jwt-assertion': 'hub-secret-jwt',
                'cf-access-authenticated-user-email': 'owner@example.com',
                origin: `http://127.0.0.1:${hubPort}`,
                connection: 'keep-alive, x-custom-hop',
                'x-custom-hop': 'hop-secret',
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end(binaryPayload);
    });
    assert.equal(grpcRes.status, 200);
    assert.equal(grpcRes.headers['grpc-status'], '0');
    assert.deepEqual(grpcRes.body, binaryPayload);
    const guestGrpc = guestHeadersSeen.at(-1);
    assert.equal(guestGrpc.headers.authorization, 'Bearer cu-peer-secret-token');
    assert.equal(guestGrpc.headers.cookie, undefined, 'hub must not forward Cookie to guest');
    assert.equal(guestGrpc.headers['cf-access-jwt-assertion'], undefined, 'hub must not forward Cf-Access-* to guest');
    assert.equal(guestGrpc.headers['cf-access-authenticated-user-email'], undefined);
    assert.equal(guestGrpc.headers.origin, undefined);
    assert.equal(guestGrpc.headers['x-custom-hop'], undefined);
    assert.equal(guestGrpc.headers['x-cua-env-authorization'], 'Bearer view-only-ticket-1');
    // Hub WS header scrubbing: cookies and Cf-Access-* never reach guest; peer bearer attached separately.
    const { wsPath: hubMediaWsPath } = await mintViewOnlyMedia(hubBase, { origin: `http://127.0.0.1:${hubPort}` });
    const ws = await new Promise((resolve, reject) => {
        const sock = new WebSocket(`ws://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/cu/spaces${hubMediaWsPath}`, ['rcdp.v2'], {
            headers: {
                cookie: 'CF_Authorization=ws-cookie-secret',
                'cf-access-jwt-assertion': 'ws-jwt-secret',
                origin: `http://127.0.0.1:${hubPort}`,
            },
        });
        sock.once('open', () => resolve(sock));
        sock.once('error', reject);
    });
    t.after(() => { try {
        ws.terminate();
    }
    catch { } });
    const guestWs = guestHeadersSeen.find(entry => entry.path.startsWith('WS '));
    assert.equal(guestWs.headers.authorization, 'Bearer cu-peer-secret-token');
    assert.equal(guestWs.headers.cookie, undefined, 'hub WS must not forward Cookie');
    assert.equal(guestWs.headers['cf-access-jwt-assertion'], undefined, 'hub WS must not forward Cf-Access-*');
    assert.equal(guestWs.headers.origin, undefined);
});
test('CSRF protection rejects cross-origin, Origin: null, bad Sec-Fetch-Site, non-JSON, and non-object bodies at hub ingress and direct routes', async (t) => {
    const { socketPath } = await startFakeBroker(t);
    const spaces = await startFakeSpaces(t);
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
        computerUseAvailable: () => cu.available(),
    });
    const cu = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
    });
    t.after(() => cu.stop());
    const guestApp = express();
    guestApp.use(access.jsonBody);
    guestApp.post('/api/cu/takeover', access.cuMutationGuard, cu.takeover);
    guestApp.post('/api/cu/release', access.cuMutationGuard, cu.release);
    const guestPort = await listenTcp(t, http.createServer(guestApp));
    const remote = { name: 'cu-sandbox', kind: 'direct', origin: `http://127.0.0.1:${guestPort}`, token: null };
    t.mock.method(remoteHosts, 'getRemote', (candidate) => (candidate === 'cu-sandbox' ? remote : null));
    t.mock.method(remoteHosts, 'reachability', () => null);
    const relay = (0, relay_handlers_1.createRelayHandlers)({
        fleetArtifacts,
        localPageExists: () => false,
        publicBaseUrl: () => undefined,
        hostDescriptor: access.hostDescriptor,
        upgradeAuthorized: () => true,
        checkCuMutationIngress: access.checkCuMutationIngress,
    });
    const hubApp = express();
    hubApp.use('/hosts/:name/api', relay.rawApi);
    const hubPort = await listenTcp(t, http.createServer(hubApp));
    for (const [label, url, port] of [
        ['hub ingress', `http://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/cu/takeover`, hubPort],
        ['direct route', `http://127.0.0.1:${guestPort}/api/cu/takeover`, guestPort],
    ]) {
        // Cross-origin Origin -> 403
        assert.equal((await fetch(url, {
            method: 'POST',
            headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
            body: '{}',
        })).status, 403, `${label}: cross-origin Origin`);
        // Opaque Origin: null -> 403
        assert.equal((await fetch(url, {
            method: 'POST',
            headers: { origin: 'null', 'content-type': 'application/json' },
            body: '{}',
        })).status, 403, `${label}: Origin null`);
        // Cross-site / same-site Sec-Fetch-Site -> 403
        assert.equal((await fetch(url, {
            method: 'POST',
            headers: { 'sec-fetch-site': 'cross-site', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' },
            body: '{}',
        })).status, 403, `${label}: Sec-Fetch-Site cross-site`);
        assert.equal((await fetch(url, {
            method: 'POST',
            headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
            body: '{}',
        })).status, 403, `${label}: Sec-Fetch-Site without Origin`);
        // Non-JSON Content-Type -> 415
        assert.equal((await fetch(url, {
            method: 'POST',
            headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'text/plain' },
            body: '{}',
        })).status, 415, `${label}: text/plain`);
        // Empty body or non-object JSON -> 400
        assert.equal((await fetch(url, {
            method: 'POST',
            headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' },
            body: '',
        })).status, 400, `${label}: empty body`);
        assert.equal((await fetch(url, {
            method: 'POST',
            headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' },
            body: '[]',
        })).status, 400, `${label}: array body`);
    }
    // Same-origin JSON object succeeds on hub ingress (and release hands back).
    const okTake = await fetch(`http://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/cu/takeover`, {
        method: 'POST',
        headers: {
            origin: `http://127.0.0.1:${hubPort}`,
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json',
        },
        body: JSON.stringify({ label: 'same-origin-browser' }),
    });
    assert.equal(okTake.status, 200);
});
test('authority + close-all revocation: distinct viewer vs OpenMedia tickets fail closed after hand back and restart, aborts in-flight interactive HTTP, and cuts force/detachDriver', async (t) => {
    const { socketPath, broker } = await startFakeBroker(t);
    const spaces = await startFakeSpaces(t);
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
        computerUseAvailable: () => cu.available(),
    });
    const cu = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
    });
    t.after(() => cu.stop());
    const app = express();
    app.use('/api/cu/spaces', access.requireBearer, cu.spacesProxy);
    app.use(access.jsonBody);
    app.get('/api/cu/status', cu.status);
    app.post('/api/cu/takeover', access.cuMutationGuard, cu.takeover);
    app.post('/api/cu/release', access.cuMutationGuard, cu.release);
    app.post('/api/cu/viewer/ticket', access.cuMutationGuard, cu.viewerTicket);
    const server = http.createServer(app);
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!cu.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const port = await listenTcp(t, server);
    const base = `http://127.0.0.1:${port}`;
    // Wait briefly for the initial broker hello snapshot, then verify unknown
    // OpenMedia/media tickets and interactive clipboard RPCs fail closed with 403.
    await new Promise(resolve => setTimeout(resolve, 30));
    const unknownOpenMedia = await fetch(`${base}/api/cu/spaces/cua.env.v1.StreamService/OpenMedia`, {
        method: 'POST',
        headers: { 'content-type': 'application/grpc-web+proto', 'x-cua-env-authorization': 'Bearer unminted-viewer-ticket' },
        body: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]),
    });
    assert.equal(unknownOpenMedia.status, 403);
    assert.equal(await dialWsStatus(`ws://127.0.0.1:${port}/api/cu/spaces/media?ticket=unminted-media-ticket`), 403);
    const preClip = await fetch(`${base}/api/cu/spaces/cua.env.v1.ComputerService/SetClipboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/grpc-web+proto' },
        body: Buffer.from([1, 2, 3]),
    });
    assert.equal(preClip.status, 403);
    // 1. Take Over — strip cut fields force & detachDriver — and obtain a DISTINCT interactive media ticket via OpenMedia.
    const takeRes = await fetch(`${base}/api/cu/takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'phone', force: true, detachDriver: true }),
    });
    assert.equal(takeRes.status, 200);
    assert.equal(broker.lastTakeoverBody?.force, undefined, 'force must not be forwarded');
    assert.equal(broker.lastTakeoverBody?.detachDriver, undefined, 'detachDriver must not be forwarded');
    const takeJson = (0, test_types_js_1.record)(await takeRes.json());
    const leaseId = takeJson.leaseId;
    const leaseToken = takeJson.leaseToken;
    const interactiveViewerTicket = (0, test_types_js_1.record)(takeJson.viewer).ticket;
    const { mediaTicket: interactiveMediaTicket, wsPath } = await mintMediaViaOpenMedia(base, interactiveViewerTicket);
    assert.match(wsPath, /^\/media\?ticket=distinct-media-ticket-/);
    assert.notEqual(interactiveMediaTicket, interactiveViewerTicket, 'media ticket must be distinct from viewer ticket');
    // Open the interactive /media WS independently of any iframe using the DISTINCT media ticket.
    const interactiveWs = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces${wsPath}`, ['rcdp.v2']);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
    t.after(() => { try {
        interactiveWs.terminate();
    }
    catch { } });
    assert.equal(interactiveWs.protocol, 'rcdp.v2');
    // Hold an in-flight interactive gRPC-Web HTTP request open at spacesd.
    spaces.holdClipboardRequests = true;
    const inFlightClipPromise = fetch(`${base}/api/cu/spaces/cua.env.v1.ComputerService/SetClipboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/grpc-web+proto', 'x-cua-env-authorization': `Bearer ${interactiveViewerTicket}` },
        body: Buffer.from([9, 9]),
    });
    await spaces.clipboardRequestSeen;
    // 2. Hand Back (server always sends handBack: true and no force).
    const wsClosed = new Promise(resolve => interactiveWs.once('close', code => resolve(code)));
    const relRes = await fetch(`${base}/api/cu/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leaseId, leaseToken, handBack: false, force: true }),
    });
    assert.equal(relRes.status, 200);
    assert.equal(broker.lastReleaseBody?.handBack, true, 'Hand Back must always send handBack: true');
    assert.equal(broker.lastReleaseBody?.force, undefined, 'force must not be forwarded');
    // Both the distinct-ticket /media WS AND the in-flight interactive HTTP request are terminated immediately.
    assert.equal(await wsClosed, 4001);
    const inFlightClipRes = await inFlightClipPromise;
    assert.equal(inFlightClipRes.status, 403);
    // 3. Redial /media with the OLD interactive media credential (?ticket= and cua.ticket.* subprotocol): REFUSED.
    assert.equal(await dialWsStatus(`ws://127.0.0.1:${port}/api/cu/spaces${wsPath}`), 403, 'old interactive media ticket via ?ticket= must be refused after hand back');
    assert.equal(await dialWsStatus(`ws://127.0.0.1:${port}/api/cu/spaces/media`, ['rcdp.v2', `cua.ticket.${interactiveMediaTicket}`]), 403, 'old interactive media ticket via cua.ticket.* subprotocol must be refused after hand back');
    // 4. Call OpenMedia with the OLD interactive viewer ticket: REFUSED.
    const staleOpenMediaRes = await fetch(`${base}/api/cu/spaces/cua.env.v1.StreamService/OpenMedia`, {
        method: 'POST',
        headers: {
            'content-type': 'application/grpc-web+proto',
            'x-cua-env-authorization': `Bearer ${interactiveViewerTicket}`,
        },
        body: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]),
    });
    assert.equal(staleOpenMediaRes.status, 403, 'OpenMedia with old interactive viewer ticket must be refused after hand back');
    // 5. Fresh view-only ticket + OpenMedia + /media still works, while smuggling old interactive ticket fails closed.
    const freshView = await mintViewOnlyMedia(base);
    const viewWs = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces${freshView.wsPath}`, ['rcdp.v2']);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
    t.after(() => { try {
        viewWs.terminate();
    }
    catch { } });
    assert.equal(viewWs.readyState, WebSocket.OPEN);
    const viewEcho = await new Promise((resolve) => {
        viewWs.once('message', data => resolve(data.toString()));
        viewWs.send('view-ping');
    });
    assert.equal(viewEcho, 'view-ping');
    assert.equal(await dialWsStatus(`ws://127.0.0.1:${port}/api/cu/spaces${freshView.wsPath}`, ['rcdp.v2', `cua.ticket.${interactiveMediaTicket}`]), 403, 'smuggling revoked interactive ticket alongside valid view-only ticket must be refused');
    spaces.holdClipboardRequests = false;
    for (const clipTicket of [undefined, freshView.viewerTicket, interactiveViewerTicket]) {
        const headers = { 'content-type': 'application/grpc-web+proto' };
        if (clipTicket)
            headers['x-cua-env-authorization'] = `Bearer ${clipTicket}`;
        const postClip = await fetch(`${base}/api/cu/spaces/cua.env.v1.ComputerService/SetClipboard`, {
            method: 'POST',
            headers,
            body: Buffer.from([1]),
        });
        assert.equal(postClip.status, 403);
    }
    // 6. Restart case: a fresh createCuHandlers instance refuses previously-minted viewer & media tickets (fail closed).
    const cuRestarted = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
    });
    t.after(() => cuRestarted.stop());
    const restartedApp = express();
    restartedApp.use('/api/cu/spaces', cuRestarted.spacesProxy);
    restartedApp.use(access.jsonBody);
    restartedApp.post('/api/cu/viewer/ticket', access.cuMutationGuard, cuRestarted.viewerTicket);
    const restartedServer = http.createServer(restartedApp);
    restartedServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!cuRestarted.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const restartedPort = await listenTcp(t, restartedServer);
    const restartedBase = `http://127.0.0.1:${restartedPort}`;
    await new Promise(resolve => setTimeout(resolve, 30));
    const restartOpenMedia = await fetch(`${restartedBase}/api/cu/spaces/cua.env.v1.StreamService/OpenMedia`, {
        method: 'POST',
        headers: {
            'content-type': 'application/grpc-web+proto',
            'x-cua-env-authorization': `Bearer ${freshView.viewerTicket}`,
        },
        body: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]),
    });
    assert.equal(restartOpenMedia.status, 403, 'restarted pi-dish must refuse pre-restart viewer ticket on OpenMedia');
    assert.equal(await dialWsStatus(`ws://127.0.0.1:${restartedPort}/api/cu/spaces${freshView.wsPath}`), 403, 'restarted pi-dish must refuse pre-restart media ticket on /media');
    // Reminting a fresh view-only ticket after restart works normally.
    const reminted = await mintViewOnlyMedia(restartedBase);
    assert.equal(await dialWsStatus(`ws://127.0.0.1:${restartedPort}/api/cu/spaces${reminted.wsPath}`), 101);
});
test('broker watch loss fails closed, closes /media WS, ignores stale epoch, and rearms after brief socket absence', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-rearm-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const sockPath = path.join(dir, 'control.sock');
    const first = await startFakeBroker(t, sockPath);
    const spaces = await startFakeSpaces(t);
    const cu = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => sockPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
        watchRetryMs: 40,
    });
    t.after(() => cu.stop());
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
    });
    const app = express();
    app.use('/api/cu/spaces', cu.spacesProxy);
    app.use(access.jsonBody);
    app.get('/api/cu/status', cu.status);
    app.post('/api/cu/takeover', access.cuMutationGuard, cu.takeover);
    app.post('/api/cu/viewer/ticket', access.cuMutationGuard, cu.viewerTicket);
    const server = http.createServer(app);
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!cu.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const port = await listenTcp(t, server);
    const base = `http://127.0.0.1:${port}`;
    // Take over to enter human epoch 4 and open a /media WS.
    const takeRes = await fetch(`${base}/api/cu/takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    });
    assert.equal(takeRes.status, 200);
    const takeJson = (0, test_types_js_1.record)(await takeRes.json());
    const leaseId = takeJson.leaseId;
    const leaseToken = takeJson.leaseToken;
    const interactiveViewerTicket = (0, test_types_js_1.record)(takeJson.viewer).ticket;
    // Stale epoch viewer/ticket response (epoch 2 < current epoch 4) is rejected with 409.
    first.broker.overrideTicketEpoch = 2;
    const staleTicketRes = await fetch(`${base}/api/cu/viewer/ticket`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'interactive', leaseId, leaseToken }),
    });
    assert.equal(staleTicketRes.status, 409);
    first.broker.overrideTicketEpoch = null;
    const { wsPath: interactiveWsPath } = await mintMediaViaOpenMedia(base, interactiveViewerTicket);
    const mediaWs = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces${interactiveWsPath}`, ['rcdp.v2']);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
    t.after(() => { try {
        mediaWs.terminate();
    }
    catch { } });
    // Shut down the first broker AND unlink the socket -> watch lost -> /media WS immediately closed!
    const closedOnLoss = new Promise(resolve => mediaWs.once('close', code => resolve(code)));
    await first.broker.closeServer();
    try {
        fs.unlinkSync(sockPath);
    }
    catch { }
    assert.equal(await closedOnLoss, 4001);
    // Wait >2 retry intervals while socket is absent to confirm watcher keeps rearming.
    await new Promise(resolve => setTimeout(resolve, 110));
    // Bring a fresh broker up at the same socket path (starts in agent state, epoch 1).
    const second = await startFakeBroker(t, sockPath);
    second.broker.state = 'agent';
    second.broker.epoch = 1;
    // Watcher automatically reconnects and syncs fresh hello snapshot!
    const deadline = Date.now() + 2000;
    let reconnected = false;
    while (Date.now() < deadline) {
        const ticketAttempt = await fetch(`${base}/api/cu/viewer/ticket`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'view-only' }),
        });
        if (ticketAttempt.status === 200) {
            const vt = (0, test_types_js_1.record)(await ticketAttempt.json()).ticket;
            const { wsPath: rearmWsPath } = await mintMediaViaOpenMedia(base, vt);
            if ((await dialWsStatus(`ws://127.0.0.1:${port}/api/cu/spaces${rearmWsPath}`)) === 101) {
                reconnected = true;
                break;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.equal(reconnected, true, 'watcher must rearm after brief socket absence and accept view-only media again');
    // Pre-loss interactive viewer/media credentials stay revoked, and interactive clipboard stays refused (403).
    assert.equal(await dialWsStatus(`ws://127.0.0.1:${port}/api/cu/spaces${interactiveWsPath}`), 403);
    const clipAfterRearm = await fetch(`${base}/api/cu/spaces/cua.env.v1.ComputerService/SetClipboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/grpc-web+proto', 'x-cua-env-authorization': `Bearer ${interactiveViewerTicket}` },
        body: Buffer.from([1]),
    });
    assert.equal(clipAfterRearm.status, 403);
});
test('WS handshake validation rejects malformed/duplicate protocols without crashing, backpressure ceiling & missed pong terminate pairs', async (t) => {
    const { socketPath } = await startFakeBroker(t);
    const spaces = await startFakeSpaces(t);
    const cu = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
        wsMaxBufferedBytes: 512,
    });
    t.after(() => cu.stop());
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
    });
    const app = express();
    app.use('/api/cu/spaces', cu.spacesProxy);
    app.use(access.jsonBody);
    app.post('/api/cu/viewer/ticket', access.cuMutationGuard, cu.viewerTicket);
    const server = http.createServer(app);
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!cu.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const port = await listenTcp(t, server);
    // Wait briefly for initial broker hello.
    await new Promise(resolve => setTimeout(resolve, 30));
    const validKey = Buffer.from('0123456789abcdef').toString('base64');
    // Duplicate protocol, bad protocol token, invalid key, wrong version -> all 400 without dialing upstream.
    assert.equal(await rawHttpUpgrade(port, '/api/cu/spaces/media?ticket=t', {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': validKey, 'Sec-WebSocket-Protocol': 'rcdp.v2, rcdp.v2',
    }), 400);
    assert.equal(await rawHttpUpgrade(port, '/api/cu/spaces/media?ticket=t', {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': validKey, 'Sec-WebSocket-Protocol': 'bad proto',
    }), 400);
    assert.equal(await rawHttpUpgrade(port, '/api/cu/spaces/media?ticket=t', {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'not-base64-16bytes', 'Sec-WebSocket-Protocol': 'rcdp.v2',
    }), 400);
    assert.equal(await rawHttpUpgrade(port, '/api/cu/spaces/media?ticket=t', {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '12',
        'Sec-WebSocket-Key': validKey, 'Sec-WebSocket-Protocol': 'rcdp.v2',
    }), 400);
    // Non-/media WS path -> 404.
    assert.equal(await rawHttpUpgrade(port, '/api/cu/spaces/files?ticket=t', {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': validKey, 'Sec-WebSocket-Protocol': 'rcdp.v2',
    }), 404);
    assert.equal(spaces.wsConnections.length, 0, 'invalid upgrades must never dial spacesd');
    // Backpressure ceiling: frame larger than wsMaxBufferedBytes (512B) terminates pair.
    const bpMedia = await mintViewOnlyMedia(`http://127.0.0.1:${port}`);
    const bpWs = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces${bpMedia.wsPath}`, ['rcdp.v2']);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
    const bpClosed = new Promise(resolve => bpWs.once('close', () => resolve()));
    bpWs.send(Buffer.alloc(1024, 0x41));
    await bpClosed;
    // Missed pong eviction: raw TCP client completes WS handshake, never answers ping frames -> terminated!
    const cuPing = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 40,
    });
    t.after(() => cuPing.stop());
    const pingApp = express();
    pingApp.use('/api/cu/spaces', cuPing.spacesProxy);
    pingApp.use(access.jsonBody);
    pingApp.post('/api/cu/viewer/ticket', access.cuMutationGuard, cuPing.viewerTicket);
    const pingServer = http.createServer(pingApp);
    pingServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!cuPing.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const pingPort = await listenTcp(t, pingServer);
    await new Promise(resolve => setTimeout(resolve, 30));
    const pingMedia = await mintViewOnlyMedia(`http://127.0.0.1:${pingPort}`);
    const rawClosed = await new Promise((resolve, reject) => {
        const sock = net.connect(pingPort, '127.0.0.1', () => {
            sock.write(`GET /api/cu/spaces${pingMedia.wsPath} HTTP/1.1\r\n` +
                `Host: 127.0.0.1:${pingPort}\r\n` +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Key: ${validKey}\r\n` +
                'Sec-WebSocket-Version: 13\r\n' +
                'Sec-WebSocket-Protocol: rcdp.v2\r\n\r\n');
        });
        const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 1500);
        sock.on('close', () => { clearTimeout(timer); resolve(true); });
        sock.on('error', (err) => { clearTimeout(timer); reject(err); });
        // Read and discard incoming ping frames without sending pong.
        sock.resume();
    });
    assert.equal(rawClosed, true, 'dead WS peer that misses pong must be terminated');
});
test('SSE error body and watcher event buffer are bounded', async (t) => {
    const { socketPath, broker } = await startFakeBroker(t);
    const spaces = await startFakeSpaces(t);
    const cu = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
        watchRetryMs: 40,
        maxSseErrorBytes: 256,
        maxSseEventBytes: 256,
    });
    t.after(() => cu.stop());
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
    });
    const app = express();
    app.use('/api/cu/spaces', cu.spacesProxy);
    app.use(access.jsonBody);
    app.get('/api/cu/stream', cu.stream);
    app.post('/api/cu/viewer/ticket', access.cuMutationGuard, cu.viewerTicket);
    const server = http.createServer(app);
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!cu.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const port = await listenTcp(t, server);
    // Oversized non-200 error body on /api/cu/stream settles cleanly with 502.
    broker.eventsMode = 'error-huge';
    const errRes = await fetch(`http://127.0.0.1:${port}/api/cu/stream`);
    assert.equal(errRes.status, 502);
    const errJson = (0, test_types_js_1.record)(await errRes.json());
    assert.match(String(errJson.error), /size limit/i);
    // Oversized unterminated watcher event triggers fail-closed watch loss and closes /media WS.
    broker.eventsMode = 'normal';
    await new Promise(resolve => setTimeout(resolve, 60));
    const sseMedia = await mintViewOnlyMedia(`http://127.0.0.1:${port}`);
    const mediaWs = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces${sseMedia.wsPath}`, ['rcdp.v2']);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
    t.after(() => { try {
        mediaWs.terminate();
    }
    catch { } });
    const closedOnOverflow = new Promise(resolve => mediaWs.once('close', code => resolve(code)));
    for (const client of broker.sseClients) {
        client.write(`data: ${'B'.repeat(512)}`);
    }
    assert.equal(await closedOnOverflow, 4001);
});
test('hub CU relay enforces route Content-Type, rejects redirects/HTML, allowlists HTTP & 101 headers, and forwards validated JSON verbatim without throwing', async (t) => {
    let receivedMutationBody = '';
    const roguePeer = http.createServer((req, res) => {
        const url = req.url || '/';
        if (url === '/api/cu/status?mode=html') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'evil=1' });
            res.end('<html><script>alert(1)</script></html>');
            return;
        }
        if (url === '/api/cu/status?mode=redirect') {
            res.writeHead(302, { location: 'https://evil.example/', 'content-type': 'application/json' });
            res.end('{}');
            return;
        }
        if (url === '/api/cu/audit?mode=svg') {
            res.writeHead(200, { 'content-type': 'image/svg+xml' });
            res.end('<svg onload="alert(1)"/>');
            return;
        }
        if (url === '/api/cu/stream?mode=html') {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<html>bad</html>');
            return;
        }
        if (url === '/api/cu/spaces/cua.env.v1.SystemService/GetCapabilities?mode=html') {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<html>bad</html>');
            return;
        }
        if (url === '/api/cu/spaces/cua.env.v1.SystemService/GetCapabilities?mode=redirect') {
            res.writeHead(307, { location: 'https://evil.example/' });
            res.end();
            return;
        }
        if (url === '/api/cu/status?mode=headers') {
            res.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
                'set-cookie': 'guest-cookie=evil',
                'x-rogue-header': 'drop-me',
                'content-disposition': 'attachment; filename=x.html',
            });
            res.end(JSON.stringify({ ok: true, state: 'idle', epoch: 1 }));
            return;
        }
        if (url === '/api/cu/takeover') {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                receivedMutationBody = Buffer.concat(chunks).toString('utf8');
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, state: 'human', epoch: 2 }));
            });
            return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"error":"not found"}');
    });
    // 101 Switching Protocols with extra rogue headers that hub must strip.
    const rogueUpgradeSockets = new Set();
    roguePeer.on('upgrade', (req, socket) => {
        rogueUpgradeSockets.add(socket);
        socket.on('close', () => rogueUpgradeSockets.delete(socket));
        const key = req.headers['sec-websocket-key'];
        const crypto = require('node:crypto');
        const accept = crypto.createHash('sha1')
            .update(`${String(key)}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest('base64');
        socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n` +
            'Sec-WebSocket-Protocol: rcdp.v2\r\n' +
            'Set-Cookie: ws-evil=1; Path=/\r\n' +
            'X-Rogue-Ws: should-not-pass\r\n\r\n');
        socket.resume();
        socket.on('end', () => { try {
            socket.destroy();
        }
        catch { } });
        socket.on('error', () => { });
    });
    const peerPort = await listenTcp(t, roguePeer, () => {
        for (const s of rogueUpgradeSockets) {
            try {
                s.destroy();
            }
            catch { }
        }
        rogueUpgradeSockets.clear();
    });
    const remote = { name: 'cu-sandbox', kind: 'direct', origin: `http://127.0.0.1:${peerPort}`, token: null };
    t.mock.method(remoteHosts, 'getRemote', (candidate) => (candidate === 'cu-sandbox' ? remote : null));
    t.mock.method(remoteHosts, 'reachability', () => null);
    const hubAccess = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
    });
    const relay = (0, relay_handlers_1.createRelayHandlers)({
        fleetArtifacts,
        localPageExists: () => false,
        publicBaseUrl: () => undefined,
        hostDescriptor: hubAccess.hostDescriptor,
        upgradeAuthorized: () => true,
        checkCuMutationIngress: hubAccess.checkCuMutationIngress,
    });
    const hubApp = express();
    hubApp.use('/hosts/:name/api', relay.rawApi);
    const hubServer = http.createServer(hubApp);
    hubServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!relay.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const hubPort = await listenTcp(t, hubServer);
    const hubBase = `http://127.0.0.1:${hubPort}/hosts/cu-sandbox`;
    // HTML, SVG, and redirects from guest CU routes are rejected with 502 + nosniff.
    for (const badPath of [
        '/api/cu/status?mode=html',
        '/api/cu/status?mode=redirect',
        '/api/cu/audit?mode=svg',
        '/api/cu/stream?mode=html',
    ]) {
        const res = await fetch(`${hubBase}${badPath}`, { redirect: 'manual' });
        assert.equal(res.status, 502, `expected 502 for ${badPath}`);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('set-cookie'), null);
    }
    for (const badGrpc of [
        '/api/cu/spaces/cua.env.v1.SystemService/GetCapabilities?mode=html',
        '/api/cu/spaces/cua.env.v1.SystemService/GetCapabilities?mode=redirect',
    ]) {
        const res = await fetch(`${hubBase}${badGrpc}`, { method: 'POST', redirect: 'manual', body: Buffer.from([0]) });
        assert.equal(res.status, 502, `expected 502 for ${badGrpc}`);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    }
    // Valid JSON status carries nosniff and strips non-allowlisted response headers.
    const okRes = await fetch(`${hubBase}/api/cu/status?mode=headers`);
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(okRes.headers.get('set-cookie'), null);
    assert.equal(okRes.headers.get('x-rogue-header'), null);
    assert.equal(okRes.headers.get('content-disposition'), null);
    // 101 Switching Protocols allowlists WS handshake headers only (strips Set-Cookie / X-Rogue-Ws).
    const validKey = Buffer.from('0123456789abcdef').toString('base64');
    const upgradeHeaders = await new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port: hubPort,
            path: '/hosts/cu-sandbox/api/cu/spaces/media?ticket=t1',
            headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': validKey,
                'Sec-WebSocket-Protocol': 'rcdp.v2',
            },
        });
        req.once('upgrade', (res, sock) => { sock.destroy(); resolve(res.headers); });
        req.once('response', (res) => { res.resume(); reject(new Error(`unexpected status ${res.statusCode}`)); });
        req.once('error', reject);
        req.end();
    });
    assert.equal(upgradeHeaders['sec-websocket-protocol'], 'rcdp.v2');
    assert.equal(upgradeHeaders['set-cookie'], undefined, '101 must strip Set-Cookie');
    assert.equal(upgradeHeaders['x-rogue-ws'], undefined, '101 must strip non-allowlisted headers');
    // Fix (6): validated JSON text is forwarded verbatim (no second JSON.stringify) and deep nesting never crashes hub.
    const rawMutation = '{  "label" : "verbatim" , "ttlSec" : 600  }';
    const verbRes = await fetch(`${hubBase}/api/cu/takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: rawMutation,
    });
    assert.equal(verbRes.status, 200);
    assert.equal(receivedMutationBody, rawMutation);
    const deepJson = `${'{"a":'.repeat(6000)}1${'}'.repeat(6000)}`;
    const deepRes = await fetch(`${hubBase}/api/cu/takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: deepJson,
    });
    assert.ok(deepRes.status === 200 || deepRes.status === 400, `deep JSON must settle cleanly without crashing (got ${deepRes.status})`);
});
test('vendored viewer.js validates principal.color before innerHTML, constrains wsPath to exact /media, CSP limits connect-src to self, and transport/URL helpers reject unsafe inputs', () => {
    // Fix (4): CSP connect-src is strictly 'self' (no ws:/wss: wildcard hosts).
    assert.match(cu_handlers_1.CU_VIEWER_CSP, /connect-src 'self';/);
    assert.doesNotMatch(cu_handlers_1.CU_VIEWER_CSP, /connect-src[^;]*(?:ws:|wss:)/);
    // Extract and execute the patched fs() and Cc() definitions from vendor/cua-viewer/viewer.js.
    const viewerSrc = fs.readFileSync(path.resolve(__dirname, '..', 'vendor', 'cua-viewer', 'viewer.js'), 'utf8');
    assert.match(viewerSrc, /\/\* pi-dish-patch:validate-color \*\//);
    assert.match(viewerSrc, /\/\* pi-dish-patch:validate-principal-color \*\//);
    assert.match(viewerSrc, /\/\* pi-dish-patch:constrain-media-wspath \*\//);
    const fsStart = viewerSrc.indexOf('function fs(t,e,n,s){');
    const fsEnd = viewerSrc.indexOf('function ms(', fsStart);
    assert.ok(fsStart > 0 && fsEnd > fsStart);
    const fsCode = viewerSrc.slice(fsStart, fsEnd);
    const ccStart = viewerSrc.indexOf('function Cc(t,e){');
    const ccEnd = viewerSrc.indexOf('function Wc(', ccStart);
    assert.ok(ccStart > 0 && ccEnd > ccStart);
    const ccCode = viewerSrc.slice(ccStart, ccEnd);
    const fakeEl = { dataset: {}, innerHTML: '' };
    const ctx = vm.createContext({
        URL,
        q: 24,
        Di: () => ({ hotspot: [0, 0] }),
        Bl: (_shape, color) => `<svg fill="${color}"></svg>`,
        Gl: () => '#000000',
        fakeEl,
    });
    vm.runInContext(`${fsCode}\n${ccCode}`, ctx);
    // Hostile principal.color must be replaced with default #60a5fa before SVG/HTML interpolation.
    vm.runInContext(`fs(fakeEl, 'arrow', '"><img src=x onerror=alert(1)>', 'Mallory');`, ctx);
    assert.match(fakeEl.innerHTML, /fill="#60a5fa"/);
    assert.match(fakeEl.innerHTML, /background:#60a5fa/);
    assert.doesNotMatch(fakeEl.innerHTML, /<img|onerror=/i);
    // Valid hex color passes through.
    vm.runInContext(`fs(fakeEl, 'arrow', '#22c55e', 'Alice');`, ctx);
    assert.match(fakeEl.innerHTML, /fill="#22c55e"/);
    assert.match(fakeEl.innerHTML, /background:#22c55e/);
    // Cc (mediaSocketUrl) accepts only exact <baseUrl>/media on same origin.
    const relayBase = 'https://dish.example/hosts/cu-sandbox/api/cu/spaces/';
    assert.equal(vm.runInContext(`Cc(${JSON.stringify(relayBase)}, '/media?ticket=t_123')`, ctx), 'wss://dish.example/hosts/cu-sandbox/api/cu/spaces/media?ticket=t_123');
    for (const badWsPath of [
        'https://evil.example/media?ticket=x',
        'wss://evil.example/media?ticket=x',
        '//evil.example/media?ticket=x',
        '/../sessions/1/terminal',
        '/files?ticket=x',
        'media/../../other',
    ]) {
        assert.throws(() => vm.runInContext(`Cc(${JSON.stringify(relayBase)}, ${JSON.stringify(badWsPath)})`, ctx), /Invalid media wsPath/, `should reject wsPath ${badWsPath}`);
    }
    // Fix (3) & (9a): browser cuSpacesViewerUrl & supportsComputerUseTransport.
    const browserBundle = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'browser.js'), 'utf8');
    const browserCtx = vm.createContext({ URL, URLSearchParams });
    vm.runInContext(browserBundle, browserCtx);
    const helpers = browserCtx.PiDishBrowser;
    // Hostile guest-supplied path / spacesPath is completely ignored when building iframe URL.
    const decoded = helpers.decodeCuTicket({
        mode: 'view-only',
        ticket: 'tok+1/2',
        path: '//evil.example/viewer/#ticket=x',
        spacesPath: '/api/cu/spaces/../../evil.html',
    });
    assert.ok(decoded);
    assert.equal(helpers.cuSpacesViewerUrl('/hosts/cu-sandbox', decoded), '/hosts/cu-sandbox/api/cu/spaces/viewer/#ticket=tok%2B1%2F2');
    // supportsComputerUseTransport accepts only "" and canonical /hosts/<name>; rejects //evil & non-canonical paths.
    assert.equal(helpers.supportsComputerUseTransport({ base: '', token: null }), true);
    assert.equal(helpers.supportsComputerUseTransport({ base: '/hosts/cu-sandbox', token: null }), true);
    for (const badHost of [
        { base: '//evil.example', token: null },
        { base: '//evil.example/hosts/cu-sandbox', token: null },
        { base: '/hosts/cu-sandbox/extra', token: null },
        { base: '/hosts/..', token: null },
        { base: '/hosts/BAD_NAME', token: null },
        { base: '/other', token: null },
        { base: 'https://evil.example', token: null },
        { base: '/hosts/cu-sandbox', token: 'secret-token' },
        { base: '', token: 'secret-token' },
    ]) {
        assert.equal(helpers.supportsComputerUseTransport(badHost), false, `should reject host ${JSON.stringify(badHost)}`);
    }
});
test('parseOpenMediaResponse and ticket extractors handle binary/text gRPC-Web, trailers, subprotocols, and fail closed on invalid frames', () => {
    assert.equal((0, cu_handlers_1.extractCuaBearerTicket)('Bearer tok_123'), 'tok_123');
    assert.equal((0, cu_handlers_1.extractCuaBearerTicket)('bearer   tok_456  '), 'tok_456');
    assert.equal((0, cu_handlers_1.extractCuaBearerTicket)('Basic abc'), null);
    assert.equal((0, cu_handlers_1.extractCuaBearerTicket)(undefined), null);
    assert.deepEqual((0, cu_handlers_1.extractMediaWsTickets)(new URL('/media?ticket=q1', 'http://localhost'), ['rcdp.v2', 'cua.ticket.p1', 'rcdp.v2.ticket.p2']), ['q1', 'p1', 'p2']);
    const expSec = Math.floor(Date.now() / 1000) + 300;
    const binBody = encodeOpenMediaResponse({
        mediaSessionId: 'ms-1',
        ticket: 'media_tok_bin',
        expiresAtSec: expSec,
        wsPath: '/media?ticket=media_tok_bin',
        grpcStatusTrailer: '0',
    });
    const parsedBin = (0, cu_handlers_1.parseOpenMediaResponse)('application/grpc-web+proto', undefined, binBody);
    assert.deepEqual(parsedBin, { kind: 'ok', ticket: 'media_tok_bin', expiresAtMs: expSec * 1000 });
    const textBody = encodeOpenMediaResponse({
        mediaSessionId: 'ms-2',
        ticket: 'media_tok_txt',
        expiresAtSec: expSec,
        wsPath: '/media?ticket=media_tok_txt',
        grpcStatusTrailer: '0',
        textBase64: true,
    });
    const parsedText = (0, cu_handlers_1.parseOpenMediaResponse)('application/grpc-web-text+proto', undefined, textBody);
    assert.deepEqual(parsedText, { kind: 'ok', ticket: 'media_tok_txt', expiresAtMs: expSec * 1000 });
    // Non-zero grpc-status header or trailer -> grpc-error (pass through without recording).
    assert.deepEqual((0, cu_handlers_1.parseOpenMediaResponse)('application/grpc-web+proto', '16', Buffer.alloc(0)), { kind: 'grpc-error' });
    const trailerErr = encodeOpenMediaResponse({ ticket: 'ignored', grpcStatusTrailer: '7' });
    assert.deepEqual((0, cu_handlers_1.parseOpenMediaResponse)('application/grpc-web+proto', undefined, trailerErr), { kind: 'grpc-error' });
    // Compressed data frame, mismatched ticket vs ws_path, non-/media ws_path, or duplicate distinct ?ticket= -> invalid.
    assert.deepEqual((0, cu_handlers_1.parseOpenMediaResponse)('application/grpc-web+proto', undefined, encodeOpenMediaResponse({ ticket: 't', compressed: true })), { kind: 'invalid' });
    assert.deepEqual((0, cu_handlers_1.parseOpenMediaResponse)('application/grpc-web+proto', undefined, encodeOpenMediaResponse({ ticket: 't1', wsPath: '/media?ticket=t2' })), { kind: 'invalid' });
    assert.deepEqual((0, cu_handlers_1.parseOpenMediaResponse)('application/grpc-web+proto', undefined, encodeOpenMediaResponse({ ticket: 't1', wsPath: '/other?ticket=t1' })), { kind: 'invalid' });
    assert.deepEqual((0, cu_handlers_1.parseOpenMediaResponse)('application/grpc-web+proto', undefined, encodeOpenMediaResponse({ wsPath: '/media?ticket=t1&ticket=t2' })), { kind: 'invalid' });
});
test('committed takeover when broker watch drops compensates via hand-back and never strands the seat', async (t) => {
    const { socketPath, broker } = await startFakeBroker(t);
    const spaces = await startFakeSpaces(t);
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
    });
    const cu = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
        watchRetryMs: 40,
    });
    t.after(() => cu.stop());
    const app = express();
    app.use('/api/cu/spaces', cu.spacesProxy);
    app.use(access.jsonBody);
    app.get('/api/cu/status', cu.status);
    app.post('/api/cu/takeover', access.cuMutationGuard, cu.takeover);
    const port = await listenTcp(t, http.createServer(app));
    const base = `http://127.0.0.1:${port}`;
    await new Promise(resolve => setTimeout(resolve, 30));
    // Case A: broker started in agent state; watch drops right after takeover commits -> 503 AND broker handed back to agent.
    assert.equal(broker.state, 'agent');
    broker.dropWatchOnNextTakeover = true;
    const resAgent = await fetch(`${base}/api/cu/takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'dropped-watch-agent' }),
    });
    assert.equal(resAgent.status, 503);
    assert.equal(broker.state, 'agent', 'broker must be handed back to agent, never stranded in human');
    assert.equal(broker.lastReleaseBody?.handBack, true);
    assert.equal(typeof broker.lastReleaseBody?.leaseId, 'string');
    assert.equal(typeof broker.lastReleaseBody?.leaseToken, 'string');
    // Wait for watcher to reconnect before Case B (broker starts idle/free).
    await new Promise(resolve => setTimeout(resolve, 90));
    broker.state = 'idle';
    broker.lease = null;
    broker.preempted = null;
    broker.epoch += 1;
    broker.emitEvent('seat_idle', { state: 'idle', epoch: broker.epoch, lease: null, preempted: null });
    await new Promise(resolve => setTimeout(resolve, 20));
    broker.dropWatchOnNextTakeover = true;
    const resIdle = await fetch(`${base}/api/cu/takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'dropped-watch-idle' }),
    });
    assert.equal(resIdle.status, 503);
    assert.equal(broker.state, 'idle', 'broker must end in idle/free, never stranded in human');
});
test('delayed stale release reply from an older epoch does not revoke a newer human epoch', async (t) => {
    const { socketPath, broker } = await startFakeBroker(t);
    const spaces = await startFakeSpaces(t);
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
    });
    const cu = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
    });
    t.after(() => cu.stop());
    const app = express();
    app.use('/api/cu/spaces', cu.spacesProxy);
    app.use(access.jsonBody);
    app.post('/api/cu/takeover', access.cuMutationGuard, cu.takeover);
    app.post('/api/cu/release', access.cuMutationGuard, cu.release);
    const server = http.createServer(app);
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!cu.upgrade(req, socket, head, url))
            socket.destroy();
    });
    const port = await listenTcp(t, server);
    const base = `http://127.0.0.1:${port}`;
    await new Promise(resolve => setTimeout(resolve, 30));
    // Take over into human epoch 4.
    const take1 = (0, test_types_js_1.record)(await (await fetch(`${base}/api/cu/takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'first-human' }),
    })).json());
    const epoch1 = take1.epoch;
    // Hold the HTTP 200 reply of POST /api/cu/release (epoch 5), while broker already
    // commits the release to agent (epoch 5) and emits the SSE hand_back event.
    let unblockDelayedRelease;
    broker.holdNextRelease = new Promise(resolve => { unblockDelayedRelease = resolve; });
    const delayedReleasePromise = fetch(`${base}/api/cu/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leaseId: take1.leaseId, leaseToken: take1.leaseToken }),
    });
    // Wait for broker to process release (epoch 5) and watcher to receive SSE hand_back.
    const waitDeadline = Date.now() + 2000;
    while (broker.state !== 'agent' && Date.now() < waitDeadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(broker.state, 'agent');
    assert.equal(broker.epoch, epoch1 + 1);
    await new Promise(resolve => setTimeout(resolve, 25));
    // Start a newer human takeover (epoch 6) and open an epoch-6 interactive /media WS.
    const take2Res = await fetch(`${base}/api/cu/takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'second-human' }),
    });
    assert.equal(take2Res.status, 200);
    const take2 = (0, test_types_js_1.record)(await take2Res.json());
    assert.equal(take2.epoch, epoch1 + 2);
    const viewerTicket2 = (0, test_types_js_1.record)(take2.viewer).ticket;
    const { wsPath: wsPath2 } = await mintMediaViaOpenMedia(base, viewerTicket2);
    const ws2 = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces${wsPath2}`, ['rcdp.v2']);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
    t.after(() => { try {
        ws2.terminate();
    }
    catch { } });
    // Now let the delayed stale epoch-5 release HTTP reply land!
    unblockDelayedRelease();
    const delayedReleaseRes = await delayedReleasePromise;
    assert.equal(delayedReleaseRes.status, 200);
    assert.equal((0, test_types_js_1.record)(await delayedReleaseRes.json()).epoch, epoch1 + 1);
    await new Promise(resolve => setTimeout(resolve, 40));
    // Epoch-6 interactive /media WS and interactive clipboard must remain completely unaffected.
    assert.equal(ws2.readyState, WebSocket.OPEN, 'delayed stale release reply must NOT close newer epoch /media WS');
    const echo = await new Promise((resolve, reject) => {
        ws2.once('message', data => resolve(data.toString()));
        ws2.once('close', () => reject(new Error('WS closed unexpectedly after stale release reply')));
        ws2.send('still-alive');
    });
    assert.equal(echo, 'still-alive');
    const clip2 = await fetch(`${base}/api/cu/spaces/cua.env.v1.ComputerService/SetClipboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/grpc-web+proto', 'x-cua-env-authorization': `Bearer ${viewerTicket2}` },
        body: Buffer.from([1, 2]),
    });
    assert.equal(clip2.status, 200, 'newer epoch interactive clipboard must remain allowed after stale release reply');
});
test('OpenMedia request gate enforces display-only targets and observe-only geometry before dialing spacesd', async (t) => {
    // Confirm vendored viewer.js constructs display-only OpenMedia requests with no geometryControl.
    const viewerSrc = fs.readFileSync(path.resolve(__dirname, '..', 'vendor', 'cua-viewer', 'viewer.js'), 'utf8');
    const reqIdx = viewerSrc.indexOf('request(e){const n=this.api.endpoint.params');
    assert.ok(reqIdx > 0, 'vendored viewer.js request() method must exist');
    const reqSnippet = viewerSrc.slice(reqIdx, reqIdx + 600);
    assert.match(reqSnippet, /target:\{target:\{case:"displayId",value:this\.displayId\}\}/);
    assert.doesNotMatch(reqSnippet, /geometryControl|window/i);
    // Unit checks for validateOpenMediaRequest (binary + grpc-web-text).
    assert.deepEqual((0, cu_handlers_1.validateOpenMediaRequest)('application/grpc-web+proto', undefined, undefined, VALID_DISPLAY_OPEN_MEDIA_BODY), { ok: true, displayId: 'primary' });
    assert.deepEqual((0, cu_handlers_1.validateOpenMediaRequest)('application/grpc-web-text+proto', undefined, undefined, encodeOpenMediaRequest({ displayId: 'display-1', geometryControl: 1, textBase64: true })), { ok: true, displayId: 'display-1' });
    assert.deepEqual((0, cu_handlers_1.validateOpenMediaRequest)('application/grpc-web+proto', undefined, undefined, encodeOpenMediaRequest({ displayId: 'primary', geometryControl: 0 })), { ok: true, displayId: 'primary' });
    // Refused cases: window target, submessage merge to window, bidirectional/unknown geometry, malformed/compressed/wrong encodings.
    const invalidCases = [
        ['window target (binary)', 'application/grpc-web+proto', undefined, undefined, encodeOpenMediaRequest({ windowId: 42 })],
        ['window target (grpc-web-text)', 'application/grpc-web-text+proto', undefined, undefined, encodeOpenMediaRequest({ windowId: 42, textBase64: true })],
        ['window target with bidirectional geometry', 'application/grpc-web+proto', undefined, undefined, encodeOpenMediaRequest({ windowId: 42, geometryControl: 2 })],
        ['merged target adding window after display', 'application/grpc-web+proto', undefined, undefined, encodeOpenMediaRequest({ displayId: 'primary', secondTargetWindowId: 42 })],
        ['display target with bidirectional geometry (binary)', 'application/grpc-web+proto', undefined, undefined, encodeOpenMediaRequest({ displayId: 'primary', geometryControl: 2 })],
        ['display target with bidirectional geometry (text)', 'application/grpc-web-text+proto', undefined, undefined, encodeOpenMediaRequest({ displayId: 'primary', geometryControl: 2, textBase64: true })],
        ['display target with unknown geometry enum', 'application/grpc-web+proto', undefined, undefined, encodeOpenMediaRequest({ displayId: 'primary', geometryControl: 99 })],
        ['missing target', 'application/grpc-web+proto', undefined, undefined, encodeOpenMediaRequest({ maxFps: 30 })],
        ['empty display_id', 'application/grpc-web+proto', undefined, undefined, encodeOpenMediaRequest({ displayId: '   ' })],
        ['compressed frame flag 0x01', 'application/grpc-web+proto', undefined, undefined, encodeOpenMediaRequest({ displayId: 'primary', compressed: true })],
        ['truncated gRPC-Web frame', 'application/grpc-web+proto', undefined, undefined, Buffer.from([0x00, 0x00, 0x00, 0x00, 0x08, 0x01, 0x02])],
        ['trailing bytes after frame', 'application/grpc-web+proto', undefined, undefined, Buffer.concat([VALID_DISPLAY_OPEN_MEDIA_BODY, Buffer.from([0x00])])],
        ['truncated protobuf varint', 'application/grpc-web+proto', undefined, undefined, encodeGrpcWebFrame(0x00, Buffer.from([0x0a, 0x80]))],
        ['bad grpc-web-text base64', 'application/grpc-web-text+proto', undefined, undefined, Buffer.from('not!base64', 'utf8')],
        ['non-ASCII high-bit bytes in grpc-web-text', 'application/grpc-web-text+proto', undefined, undefined, Buffer.from([0xc1, 0xc1, 0xc1, 0xc1])],
        ['unsupported content-type', 'application/json', undefined, undefined, Buffer.from('{}')],
        ['unsupported content-encoding', 'application/grpc-web+proto', 'gzip', undefined, VALID_DISPLAY_OPEN_MEDIA_BODY],
        ['unsupported grpc-encoding', 'application/grpc-web+proto', undefined, 'gzip', VALID_DISPLAY_OPEN_MEDIA_BODY],
    ];
    for (const [label, ct, ce, ge, body] of invalidCases) {
        assert.equal((0, cu_handlers_1.validateOpenMediaRequest)(ct, ce, ge, body).ok, false, `must reject: ${label}`);
    }
    // End-to-end guest proxy check: rejected OpenMedia requests return 403 and NEVER dial spacesd,
    // for BOTH view-only and interactive viewer tickets.
    const { socketPath } = await startFakeBroker(t);
    const spaces = await startFakeSpaces(t);
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
    });
    const cu = (0, cu_handlers_1.createCuHandlers)({
        upgradeAuthorized: () => true,
        socketPath: () => socketPath,
        spacesPort: spaces.port,
        wsPingIntervalMs: 0,
    });
    t.after(() => cu.stop());
    const app = express();
    app.use('/api/cu/spaces', cu.spacesProxy);
    app.use(access.jsonBody);
    app.post('/api/cu/takeover', access.cuMutationGuard, cu.takeover);
    app.post('/api/cu/viewer/ticket', access.cuMutationGuard, cu.viewerTicket);
    const port = await listenTcp(t, http.createServer(app));
    const base = `http://127.0.0.1:${port}`;
    await new Promise(resolve => setTimeout(resolve, 30));
    const viewTicket = (0, test_types_js_1.record)(await (await fetch(`${base}/api/cu/viewer/ticket`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'view-only' }),
    })).json()).ticket;
    const interactiveTicket = (0, test_types_js_1.record)((0, test_types_js_1.record)(await (await fetch(`${base}/api/cu/takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'display-only-test' }),
    })).json()).viewer).ticket;
    const spacesRequestsBefore = spaces.requests.length;
    for (const [modeLabel, ticket] of [['view-only', viewTicket], ['interactive', interactiveTicket]]) {
        for (const [caseLabel, ct, body] of [
            ['window target', 'application/grpc-web+proto', encodeOpenMediaRequest({ windowId: 7, geometryControl: 2 })],
            ['window target (text)', 'application/grpc-web-text+proto', encodeOpenMediaRequest({ windowId: 7, textBase64: true })],
            ['non-observe geometry', 'application/grpc-web+proto', encodeOpenMediaRequest({ displayId: 'primary', geometryControl: 2 })],
            ['malformed protobuf', 'application/grpc-web+proto', Buffer.from([0x00, 0x00, 0x00, 0x00, 0x02, 0xff, 0xff])],
        ]) {
            const res = await fetch(`${base}/api/cu/spaces/cua.env.v1.StreamService/OpenMedia`, {
                method: 'POST',
                headers: { 'content-type': ct, 'x-cua-env-authorization': `Bearer ${ticket}` },
                body,
            });
            assert.equal(res.status, 403, `${modeLabel} ${caseLabel} must return 403`);
        }
    }
    assert.equal(spaces.requests.length, spacesRequestsBefore, 'refused OpenMedia requests must NEVER reach spacesd');
    // Valid display-only + observe-only/absent-geometry requests succeed for both ticket modes (binary & text).
    const okBin = await fetch(`${base}/api/cu/spaces/cua.env.v1.StreamService/OpenMedia`, {
        method: 'POST',
        headers: { 'content-type': 'application/grpc-web+proto', 'x-cua-env-authorization': `Bearer ${viewTicket}` },
        body: VALID_DISPLAY_OPEN_MEDIA_BODY,
    });
    assert.equal(okBin.status, 200);
    const okText = await fetch(`${base}/api/cu/spaces/cua.env.v1.StreamService/OpenMedia`, {
        method: 'POST',
        headers: { 'content-type': 'application/grpc-web-text+proto', 'x-cua-env-authorization': `Bearer ${interactiveTicket}` },
        body: encodeOpenMediaRequest({ displayId: 'primary', geometryControl: 1, policy: 3, textBase64: true }),
    });
    assert.equal(okText.status, 200);
    assert.equal(spaces.requests.length, spacesRequestsBefore + 2);
});
