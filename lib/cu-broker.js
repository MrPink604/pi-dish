// Generated from src/core/cu-broker.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILL_CANCEL_BROKER_TIMEOUT_MS = exports.FILL_EXECUTE_BROKER_TIMEOUT_MS = exports.FILL_PENDING_TIMEOUT_HEADROOM_MS = exports.FILL_MAX_WAIT_MS = exports.TAKEOVER_BROKER_TIMEOUT_MS = exports.DEFAULT_BROKER_TIMEOUT_MS = void 0;
exports.resolveCuBrokerSocket = resolveCuBrokerSocket;
exports.isSocketPathLive = isSocketPathLive;
exports.createCuBrokerClient = createCuBrokerClient;
/**
 * HTTP/1.1 JSON + SSE client for the guest-side cu-broker Unix domain socket
 * (PI_DISH_CU_BROKER_SOCKET). The browser never talks to the socket directly.
 */
const fs = require("node:fs");
const http = require("node:http");
const http_boundary_1 = require("./http-boundary");
// Innermost deadline in the CU call chain:
// broker (8s) < guest spaces proxy (10s) < hub relay (15s) < browser (25s).
exports.DEFAULT_BROKER_TIMEOUT_MS = 8_000;
exports.TAKEOVER_BROKER_TIMEOUT_MS = 8_000;
// Slice 3 vault fill calls carry their own longer broker deadlines.
exports.FILL_MAX_WAIT_MS = 25_000;
exports.FILL_PENDING_TIMEOUT_HEADROOM_MS = 10_000;
exports.FILL_EXECUTE_BROKER_TIMEOUT_MS = 45_000;
exports.FILL_CANCEL_BROKER_TIMEOUT_MS = 15_000;
const MAX_BROKER_BODY_BYTES = 2 * 1024 * 1024;
function resolveCuBrokerSocket() {
    const configured = (process.env.PI_DISH_CU_BROKER_SOCKET || '').trim();
    return configured || null;
}
function isSocketPathLive(socketPath) {
    if (!socketPath)
        return false;
    try {
        return fs.statSync(socketPath).isSocket();
    }
    catch {
        return false;
    }
}
function createCuBrokerClient(options = {}) {
    const resolveSocket = options.socketPath ?? resolveCuBrokerSocket;
    function configured() {
        return resolveSocket() !== null;
    }
    function liveSocket() {
        const candidate = resolveSocket();
        return isSocketPathLive(candidate) ? candidate : null;
    }
    function requestJson(method, endpointPath, body, reqOptions = {}) {
        const candidate = resolveSocket();
        if (!candidate) {
            return Promise.reject((0, http_boundary_1.httpError)('Computer-use broker is not available on this host', 404));
        }
        const socket = isSocketPathLive(candidate) ? candidate : null;
        if (!socket) {
            return Promise.reject((0, http_boundary_1.httpError)('Computer-use broker is unavailable', 503));
        }
        const signal = reqOptions.signal;
        if (signal?.aborted) {
            return Promise.reject((0, http_boundary_1.httpError)('cu-broker request aborted', 499));
        }
        const timeoutMs = reqOptions.timeoutMs ?? exports.DEFAULT_BROKER_TIMEOUT_MS;
        const payload = body !== undefined ? JSON.stringify(body) : null;
        const headers = {
            host: 'localhost',
            accept: 'application/json',
        };
        if (payload !== null) {
            headers['content-type'] = 'application/json';
            headers['content-length'] = String(Buffer.byteLength(payload));
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => {
                try {
                    req.destroy();
                }
                catch { }
                finish({ ok: false, error: (0, http_boundary_1.httpError)('cu-broker request aborted', 499) });
            };
            const finish = (outcome) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                if (outcome.ok)
                    resolve(outcome.value);
                else
                    reject(outcome.error);
            };
            const req = http.request({ socketPath: socket, method, path: endpointPath, headers }, (res) => {
                const chunks = [];
                let totalBytes = 0;
                res.on('data', (chunk) => {
                    totalBytes += chunk.length;
                    if (totalBytes > MAX_BROKER_BODY_BYTES) {
                        res.destroy();
                        finish({ ok: false, error: (0, http_boundary_1.httpError)('cu-broker response exceeded size limit', 502) });
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('error', () => {
                    finish({ ok: false, error: (0, http_boundary_1.httpError)('cu-broker stream failed', 502) });
                });
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let parsed = null;
                    if (raw.length > 0) {
                        try {
                            parsed = JSON.parse(raw);
                        }
                        catch {
                            parsed = { error: raw.slice(0, 500) };
                        }
                    }
                    finish({ ok: true, value: { status: res.statusCode ?? 502, body: parsed } });
                });
            });
            const timer = setTimeout(() => {
                try {
                    req.destroy();
                }
                catch { }
                finish({ ok: false, error: (0, http_boundary_1.httpError)('cu-broker request timed out', 504) });
            }, timeoutMs);
            timer.unref();
            signal?.addEventListener('abort', onAbort, { once: true });
            req.on('error', () => {
                finish({ ok: false, error: (0, http_boundary_1.httpError)('cu-broker is unavailable', 503) });
            });
            if (payload !== null)
                req.write(payload);
            req.end();
        });
    }
    function openEvents(onResponse, onError, eventsOptions) {
        const socket = liveSocket();
        if (!socket)
            return null;
        const headers = {
            host: 'localhost',
            accept: 'text/event-stream',
            'cache-control': 'no-cache',
        };
        const params = new URLSearchParams();
        const generation = typeof eventsOptions?.generation === 'string' && eventsOptions.generation.trim()
            ? eventsOptions.generation.trim()
            : null;
        const cursor = typeof eventsOptions?.cursor === 'number'
            && Number.isInteger(eventsOptions.cursor)
            && eventsOptions.cursor >= 0
            ? eventsOptions.cursor
            : null;
        if (generation !== null)
            params.set('generation', generation);
        if (cursor !== null)
            params.set('cursor', String(cursor));
        const explicitLastEventId = typeof eventsOptions?.lastEventId === 'string'
            ? eventsOptions.lastEventId.replace(/[\r\n\0]+/g, '').trim().slice(0, 256)
            : '';
        if (generation !== null && cursor !== null) {
            headers['last-event-id'] = `${generation}:${cursor}`;
        }
        else if (explicitLastEventId) {
            headers['last-event-id'] = explicitLastEventId;
        }
        const qs = params.toString();
        const req = http.request({
            socketPath: socket,
            method: 'GET',
            path: `/v1/events${qs ? `?${qs}` : ''}`,
            headers,
        }, onResponse);
        req.on('error', onError);
        req.end();
        return req;
    }
    return {
        socketPath: resolveSocket,
        configured,
        available: () => liveSocket() !== null,
        requestJson,
        openEvents,
    };
}
