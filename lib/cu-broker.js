// Generated from src/core/cu-broker.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAKEOVER_BROKER_TIMEOUT_MS = exports.DEFAULT_BROKER_TIMEOUT_MS = void 0;
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
    function liveSocket() {
        const candidate = resolveSocket();
        return isSocketPathLive(candidate) ? candidate : null;
    }
    function requestJson(method, endpointPath, body, reqOptions = {}) {
        const socket = liveSocket();
        if (!socket) {
            return Promise.reject((0, http_boundary_1.httpError)('Computer-use broker is not available on this host', 404));
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
            const finish = (outcome) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
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
            req.on('error', () => {
                finish({ ok: false, error: (0, http_boundary_1.httpError)('cu-broker is unavailable', 503) });
            });
            if (payload !== null)
                req.write(payload);
            req.end();
        });
    }
    function openEvents(onResponse, onError) {
        const socket = liveSocket();
        if (!socket)
            return null;
        const req = http.request({
            socketPath: socket,
            method: 'GET',
            path: '/v1/events',
            headers: {
                host: 'localhost',
                accept: 'text/event-stream',
                'cache-control': 'no-cache',
            },
        }, onResponse);
        req.on('error', onError);
        req.end();
        return req;
    }
    return {
        socketPath: resolveSocket,
        available: () => liveSocket() !== null,
        requestJson,
        openEvents,
    };
}
