// Generated test/tool from test/cu-vault-fill.test.ts; edit that source and run npm run build:tests.
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
 * Focused tests for Slice 3 computer-use Bitwarden vault fill:
 * - One-shot sealer (`skills/pi-dish-vault/scripts/cu-fill-seal.js`) interop
 *   with Fleet's cu-broker envelope v1 vectors and AAD/key/origin bindings.
 * - Guest pi-dish `/api/cu/fill/{pending,execute,cancel,status}` proxy routes
 *   against a fake `control.sock` broker, capability gating, auth, timeouts,
 *   and non-exposure on `/api/cu/stream` and hub `/hosts/:name/api/cu/fill/*`.
 * - Hub coordinator (`lib/cu-vault-fill.js`): opt-in config, approve→execute,
 *   deny→cancel, policy refusal→cancel, expiry→cancel, helper failure→cancel,
 *   retryable execute codes, duplicate requestId de-dupe, withdrawn request
 *   cancellation, minimal env + isolated XDG_CONFIG_HOME, and zero secret
 *   leakage across logs, audit, and argv.
 *
 * Run with: npm test -- test/cu-vault-fill.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const node_child_process_1 = require("node:child_process");
const crypto = require("node:crypto");
const express = require("express");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const access_handlers_1 = require("../lib/access-handlers");
const cu_handlers_1 = require("../lib/cu-handlers");
const cu_vault_fill_1 = require("../lib/cu-vault-fill");
const fleetArtifacts = __importStar(require("../lib/fleet-artifacts"));
const relay_handlers_1 = require("../lib/relay-handlers");
const test_types_js_1 = require("./test-types.js");
const SEALER_SCRIPT = path.join(__dirname, '..', 'skills', 'pi-dish-vault', 'scripts', 'cu-fill-seal.js');
const sealerMod = require(SEALER_SCRIPT);
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const LABEL_BUF = Buffer.from(cu_vault_fill_1.CU_VAULT_FILL_ENVELOPE_LABEL, 'ascii');
const ZERO_BUF = Buffer.from([0]);
// Deterministic vector generated with Fleet's Python cryptography sealer
// (`tests/cu_broker/fill_support.py` / `docs/cu-broker-slice3-fill.md`).
const FLEET_VECTOR = {
    recipPrivHex: '10'.repeat(32),
    recipPubB64u: 'eB-quQhDAVDazN1vnWxQhuNPc6k-u6onF2XlA27fxRk',
    ephPrivHex: '20'.repeat(32),
    requestId: `fill-${'a'.repeat(32)}`,
    nonce: 'N'.repeat(43),
    origin: 'https://login.example.test',
    fields: {
        username: 'dummy.user@example.test',
        password: 'Dummy-Pa55-w0rd!7f3k',
        totp: '123456',
    },
    sealed: 'AQZFP82c71ofU6zE-UIQTAyOnifVx7N_VQfNzRYoEFlj08mhet5G7tNltvmgxcp2xSvAZkLk2UWStYFJ4dFVOCNShxN829pmKGWWwKmG0s9Hh00IrjCcUptkOXAOlihDcs1VaguBRJKFh5HAPfl1Q16Dpr5u5wCqiB1Lei8uyQCq3UHAlCk84OFnvcih-KN2dFO7hJ-arx7nUKeBgxmjgQFS-JuuMZAQ8R26fEhcXJwXUOi79B8OpZZZQ1n4EGTW25WOkWEDhie7QI2HKbBAjVlHt_u-tjd6ibyuzKWFaTx4Skk73shwXVvsANgfyJjknq_k8A2YuqVp8z2HbhdgEgXqDrE',
};
function x25519PrivateFromHex(hex) {
    return crypto.createPrivateKey({
        key: Buffer.concat([X25519_PKCS8_PREFIX, Buffer.from(hex, 'hex')]),
        format: 'der',
        type: 'pkcs8',
    });
}
function x25519RawPublic(key) {
    return crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
}
/** Independent envelope opener matching Fleet's `cu-broker` `FillKey.open()`. */
function openEnvelope(recipientPrivate, sealed, requestId, origin) {
    try {
        if (!/^[A-Za-z0-9_-]+$/.test(sealed))
            return null;
        const raw = Buffer.from(sealed, 'base64url');
        if (raw.length < 51 || raw.length > 16384 || raw[0] !== 1)
            return null;
        const epk = raw.subarray(1, 33);
        const ct = raw.subarray(33, raw.length - 16);
        const tag = raw.subarray(raw.length - 16);
        const recipientPub = x25519RawPublic(recipientPrivate);
        const ephPub = crypto.createPublicKey({
            key: Buffer.concat([X25519_SPKI_PREFIX, epk]),
            format: 'der',
            type: 'spki',
        });
        const shared = crypto.diffieHellman({ privateKey: recipientPrivate, publicKey: ephPub });
        if (shared.every(b => b === 0))
            return null;
        const rid = Buffer.from(requestId, 'ascii');
        const okm = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([epk, recipientPub]), Buffer.concat([LABEL_BUF, ZERO_BUF, rid]), 44));
        const aad = Buffer.concat([LABEL_BUF, ZERO_BUF, rid, ZERO_BUF, Buffer.from(origin, 'ascii')]);
        const decipher = crypto.createDecipheriv('chacha20-poly1305', okm.subarray(0, 32), okm.subarray(32, 44), { authTagLength: 16 });
        decipher.setAAD(aad, { plaintextLength: ct.length });
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
        return (0, test_types_js_1.record)(JSON.parse(plain));
    }
    catch {
        return null;
    }
}
async function runSealerCli(header, envVars) {
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.execFile)(process.execPath, [SEALER_SCRIPT], { env: { PATH: process.env.PATH || '', ...envVars }, windowsHide: true }, (error, stdout, stderr) => {
            const code = error && typeof error.code === 'number'
                ? error.code
                : (error ? 1 : 0);
            resolve({ stdout: String(stdout), stderr: String(stderr), code });
        });
        child.stdin?.end(typeof header === 'string' ? header : JSON.stringify(header));
    });
}
async function waitUntil(check, timeoutMs = 4_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (check())
            return;
        await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.ok(check(), 'condition did not become true before timeout');
}
// ---------------------------------------------------------------------------
// 1. Sealer interop & secret hygiene
// ---------------------------------------------------------------------------
test('cu-fill-seal matches Fleet Python/Node envelope v1 vector byte-for-byte', () => {
    const ephPriv = x25519PrivateFromHex(FLEET_VECTOR.ephPrivHex);
    const sealed = sealerMod.sealEnvelope({
        requestId: FLEET_VECTOR.requestId,
        nonce: FLEET_VECTOR.nonce,
        publicKey: FLEET_VECTOR.recipPubB64u,
        label: cu_vault_fill_1.CU_VAULT_FILL_ENVELOPE_LABEL,
        origin: FLEET_VECTOR.origin,
    }, FLEET_VECTOR.fields, { ephemeralPrivateKey: ephPriv });
    assert.equal(sealed, FLEET_VECTOR.sealed);
    const recipPriv = x25519PrivateFromHex(FLEET_VECTOR.recipPrivHex);
    const opened = openEnvelope(recipPriv, sealed, FLEET_VECTOR.requestId, FLEET_VECTOR.origin);
    assert.deepEqual(opened, {
        v: 1,
        requestId: FLEET_VECTOR.requestId,
        nonce: FLEET_VECTOR.nonce,
        fields: FLEET_VECTOR.fields,
    });
    // Every AAD / HKDF / key / tamper binding must reject mismatches.
    assert.equal(openEnvelope(recipPriv, sealed, `fill-${'b'.repeat(32)}`, FLEET_VECTOR.origin), null);
    assert.equal(openEnvelope(recipPriv, sealed, FLEET_VECTOR.requestId, 'https://evil.example.test'), null);
    const otherPriv = crypto.generateKeyPairSync('x25519').privateKey;
    assert.equal(openEnvelope(otherPriv, sealed, FLEET_VECTOR.requestId, FLEET_VECTOR.origin), null);
    const raw = Buffer.from(sealed, 'base64url');
    for (const idx of [0, 5, 40, raw.length - 1]) {
        const bad = Buffer.from(raw);
        bad[idx] ^= 1;
        assert.equal(openEnvelope(recipPriv, bad.toString('base64url'), FLEET_VECTOR.requestId, FLEET_VECTOR.origin), null, `tampered byte ${idx}`);
    }
});
test('cu-fill-seal CLI reads stdin header + env vars, outputs sealed base64url only, clears env, and never echoes secrets on error', async () => {
    const recip = crypto.generateKeyPairSync('x25519');
    const pubB64u = x25519RawPublic(recip.privateKey).toString('base64url');
    const header = {
        requestId: `fill-${'1'.repeat(32)}`,
        nonce: crypto.randomBytes(32).toString('base64url'),
        publicKey: pubB64u,
        label: cu_vault_fill_1.CU_VAULT_FILL_ENVELOPE_LABEL,
        origin: 'https://portal.acme.example',
    };
    const secretPass = 'S3cr3t-Val!99';
    const res = await runSealerCli(header, {
        CU_FILL_USERNAME: 'alice@acme.example',
        CU_FILL_PASSWORD: secretPass,
        CU_FILL_TOTP: '654321',
    });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stderr, '');
    assert.match(res.stdout, /^[A-Za-z0-9_-]{68,21846}$/, 'stdout must be bare base64url with no newline or logs');
    const opened = openEnvelope(recip.privateKey, res.stdout, header.requestId, header.origin);
    assert.deepEqual(opened, {
        v: 1,
        requestId: header.requestId,
        nonce: header.nonce,
        fields: { username: 'alice@acme.example', password: secretPass, totp: '654321' },
    });
    // readFieldsFromEnv clears the env vars even immediately in-process.
    const scratchEnv = {
        CU_FILL_USERNAME: 'u',
        CU_FILL_PASSWORD: 'p',
        CU_FILL_TOTP: '123456',
        KEEP_ME: 'ok',
    };
    const extracted = sealerMod.readFieldsFromEnv(scratchEnv);
    assert.deepEqual(extracted, { username: 'u', password: 'p', totp: '123456' });
    assert.equal(scratchEnv.CU_FILL_USERNAME, undefined);
    assert.equal(scratchEnv.CU_FILL_PASSWORD, undefined);
    assert.equal(scratchEnv.CU_FILL_TOTP, undefined);
    assert.equal(scratchEnv.KEEP_ME, 'ok');
    // Control character in password fails without ever echoing the password on stderr/stdout.
    const badSecret = 'secret-with\nnewline';
    const badRes = await runSealerCli(header, { CU_FILL_PASSWORD: badSecret });
    assert.equal(badRes.code, 1);
    assert.equal(badRes.stdout, '');
    assert.ok(!badRes.stderr.includes('secret-with'));
    assert.match(badRes.stderr, /invalid value for field password/);
    // Low-order all-zero public key, non-https origin, and >256-char origin are rejected.
    const zeroKeyRes = await runSealerCli({ ...header, publicKey: Buffer.alloc(32).toString('base64url') }, { CU_FILL_PASSWORD: 'ok' });
    assert.equal(zeroKeyRes.code, 1);
    const httpOriginRes = await runSealerCli({ ...header, origin: 'http://portal.acme.example' }, { CU_FILL_PASSWORD: 'ok' });
    assert.equal(httpOriginRes.code, 1);
    const longOrigin = `https://${'a'.repeat(245)}.test`; // 8 + 245 + 5 = 258 > 256
    const longOriginRes = await runSealerCli({ ...header, origin: longOrigin }, { CU_FILL_PASSWORD: 'ok' });
    assert.equal(longOriginRes.code, 1);
});
test('extractSealedFromStdout accepts bare sealed output or aac timestamped WARN lines, and rejects arbitrary output', () => {
    assert.equal((0, cu_vault_fill_1.extractSealedFromStdout)(FLEET_VECTOR.sealed), FLEET_VECTOR.sealed);
    assert.equal((0, cu_vault_fill_1.extractSealedFromStdout)(`2026-11-27T02:25:14.442608Z WARN ap_client::proxy: reconnecting\n${FLEET_VECTOR.sealed}`), FLEET_VECTOR.sealed);
    assert.equal((0, cu_vault_fill_1.extractSealedFromStdout)(`unexpected stdout line\n${FLEET_VECTOR.sealed}`), null);
    assert.equal((0, cu_vault_fill_1.extractSealedFromStdout)('2026-11-27T02:25:14.442608Z ERROR aac::command::run: refused'), null);
});
// ---------------------------------------------------------------------------
// 2. Guest pi-dish proxy routes with fake control.sock
// ---------------------------------------------------------------------------
async function startFakeFillBroker(t, options) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-fill-sock-'));
    const socketPath = path.join(dir, 'control.sock');
    const state = {
        capabilities: [...options.capabilities],
        seenPendingQuery: [],
        seenExecuteBodies: [],
        seenCancelBodies: [],
        seenStatusBodies: [],
        pendingAborted: 0,
        sseClients: new Set(),
    };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (req.method === 'GET' && url.pathname === '/v1/status') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                version: 1,
                state: 'agent',
                epoch: 4,
                capabilities: state.capabilities,
                nonce: 'should-be-scrubbed-from-status',
            }));
            return;
        }
        if (req.method === 'GET' && url.pathname === '/v1/events') {
            res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
            res.write(`event: hello\ndata: ${JSON.stringify({ state: 'agent', epoch: 4, capabilities: state.capabilities })}\n\n`);
            state.sseClients.add(res);
            req.on('close', () => state.sseClients.delete(res));
            return;
        }
        if (req.method === 'GET' && url.pathname === '/v1/fill/pending') {
            state.seenPendingQuery.push(url.search);
            const sendPending = () => {
                if (res.writableEnded || res.destroyed)
                    return;
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    ok: true,
                    seq: 7,
                    requests: [{
                            requestId: FLEET_VECTOR.requestId,
                            seq: 7,
                            nonce: FLEET_VECTOR.nonce,
                            publicKey: FLEET_VECTOR.recipPubB64u,
                            envelope: { version: 1, alg: cu_vault_fill_1.CU_VAULT_FILL_ENVELOPE_ALG },
                            origin: FLEET_VECTOR.origin,
                            topOrigin: 'https://www.example.test',
                            item: 'Acme Portal',
                            fields: ['username', 'password'],
                            submit: true,
                            reason: 'Sign in',
                            createdAt: new Date().toISOString(),
                            expiresAt: new Date(Date.now() + 180_000).toISOString(),
                        }],
                }));
            };
            if (options.pendingDelayMs && options.pendingDelayMs > 0) {
                const timer = setTimeout(sendPending, options.pendingDelayMs);
                timer.unref();
                req.on('close', () => {
                    clearTimeout(timer);
                    if (!res.writableEnded)
                        state.pendingAborted += 1;
                });
            }
            else {
                sendPending();
            }
            return;
        }
        if (req.method === 'POST' && (url.pathname === '/v1/fill/execute' || url.pathname === '/v1/fill/cancel' || url.pathname === '/v1/fill/status')) {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => {
                const body = (0, test_types_js_1.record)(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
                if (url.pathname === '/v1/fill/execute') {
                    state.seenExecuteBodies.push(body);
                    const reply = () => {
                        res.writeHead(200, { 'content-type': 'application/json' });
                        res.end(JSON.stringify({
                            ok: true,
                            requestId: body.requestId,
                            filled: ['username', 'password'],
                            submitted: true,
                            originSeen: FLEET_VECTOR.origin,
                            origin: FLEET_VECTOR.origin,
                        }));
                    };
                    if (options.executeDelayMs)
                        setTimeout(reply, options.executeDelayMs).unref();
                    else
                        reply();
                    return;
                }
                if (url.pathname === '/v1/fill/cancel') {
                    state.seenCancelBodies.push(body);
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, requestId: body.requestId, status: 'cancelled', code: body.reason || 'cancelled' }));
                    return;
                }
                state.seenStatusBodies.push(body);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, requestId: body.requestId, status: 'pending', origin: FLEET_VECTOR.origin }));
            });
            return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'not_found' }));
    });
    await new Promise(resolve => server.listen(socketPath, () => resolve()));
    t.after(async () => {
        for (const c of state.sseClients) {
            try {
                c.destroy();
            }
            catch { }
        }
        await new Promise(resolve => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        });
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return { socketPath, state };
}
async function mountGuestFillApp(t, socketPath, token = null) {
    const prevToken = process.env.PI_DISH_TOKEN;
    if (token === null)
        delete process.env.PI_DISH_TOKEN;
    else
        process.env.PI_DISH_TOKEN = token;
    const access = (0, access_handlers_1.createAccessHandlers)({
        version: '1.0.0',
        readDishSettings: () => ({}),
        sttAvailable: () => false,
        usageLimitsAvailable: () => false,
        botsAvailable: () => false,
        knowledgeAvailable: () => false,
        computerUseAvailable: () => true,
    });
    if (prevToken === undefined)
        delete process.env.PI_DISH_TOKEN;
    else
        process.env.PI_DISH_TOKEN = prevToken;
    const cu = (0, cu_handlers_1.createCuHandlers)({
        socketPath: () => socketPath,
        upgradeAuthorized: req => access.bearerUpgradeAuthorized(req),
        authTokenConfigured: access.hasAuthToken,
    });
    const app = express();
    app.use(access.jsonBody);
    app.use('/api', access.apiGate);
    app.get('/api/cu/status', cu.status);
    app.get('/api/cu/stream', cu.stream);
    app.get('/api/cu/fill/pending', cu.fillPending);
    app.post('/api/cu/fill/execute', access.cuMutationGuard, cu.fillExecute);
    app.post('/api/cu/fill/cancel', access.cuMutationGuard, cu.fillCancel);
    app.get('/api/cu/fill/status', cu.fillStatus);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    t.after(async () => {
        cu.stop();
        await new Promise(resolve => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        });
    });
    const port = server.address().port;
    return { base: `http://127.0.0.1:${port}`, cu };
}
test('guest fill routes are disabled (404) when broker does not advertise vault_fill', async (t) => {
    const { socketPath } = await startFakeFillBroker(t, { capabilities: ['bind', 'ordered_sse'] });
    const bearer = 'guest-bearer-no-cap';
    const { base } = await mountGuestFillApp(t, socketPath, bearer);
    const headers = { authorization: `Bearer ${bearer}` };
    assert.equal((await fetch(`${base}/api/cu/fill/pending`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/cu/fill/status?requestId=${FLEET_VECTOR.requestId}`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/cu/fill/execute`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, sealed: FLEET_VECTOR.sealed }),
    })).status, 404);
    assert.equal((await fetch(`${base}/api/cu/fill/cancel`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, reason: 'denied' }),
    })).status, 404);
});
test('guest fill routes fail closed (404) when no bearer auth token is configured', async (t) => {
    const { socketPath } = await startFakeFillBroker(t, { capabilities: ['bind', 'ordered_sse', 'vault_fill'] });
    const { base } = await mountGuestFillApp(t, socketPath, null);
    assert.equal((await fetch(`${base}/api/cu/fill/pending`)).status, 404);
    assert.equal((await fetch(`${base}/api/cu/fill/status?requestId=${FLEET_VECTOR.requestId}`)).status, 404);
    assert.equal((await fetch(`${base}/api/cu/fill/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, sealed: FLEET_VECTOR.sealed }),
    })).status, 404);
    assert.equal((await fetch(`${base}/api/cu/fill/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, reason: 'denied' }),
    })).status, 404);
});
test('guest fill routes enforce bearer auth, clamp waitMs, forward execute/cancel/status, and keep fill material off SSE and hub /hosts proxy', async (t) => {
    const { socketPath, state } = await startFakeFillBroker(t, { capabilities: ['bind', 'ordered_sse', 'vault_fill'] });
    const bearer = 'guest-bearer-token-123';
    const { base } = await mountGuestFillApp(t, socketPath, bearer);
    const authHeaders = { authorization: `Bearer ${bearer}` };
    // Unauthenticated callers are rejected with 401.
    assert.equal((await fetch(`${base}/api/cu/fill/pending`)).status, 401);
    assert.equal((await fetch(`${base}/api/cu/fill/status?requestId=${FLEET_VECTOR.requestId}`)).status, 401);
    // Pending clamps waitMs <= 25000, sets no-store, and preserves nonce + publicKey.
    const pendingRes = await fetch(`${base}/api/cu/fill/pending?since=3&waitMs=99999`, { headers: authHeaders });
    assert.equal(pendingRes.status, 200);
    assert.equal(pendingRes.headers.get('cache-control'), 'private, no-store');
    const pendingBody = (0, test_types_js_1.record)(await pendingRes.json());
    assert.equal(pendingBody.seq, 7);
    assert.equal(state.seenPendingQuery[0], '?since=3&waitMs=25000');
    const reqRow = (0, test_types_js_1.record)(pendingBody.requests[0]);
    assert.equal(reqRow.nonce, FLEET_VECTOR.nonce);
    assert.equal(reqRow.publicKey, FLEET_VECTOR.recipPubB64u);
    // Execute validates & forwards ONLY {requestId, sealed}; rejects cross-origin CSRF and >21846 sealed.
    const csrfRes = await fetch(`${base}/api/cu/fill/execute`, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, sealed: FLEET_VECTOR.sealed }),
    });
    assert.equal(csrfRes.status, 403);
    const oversizedRes = await fetch(`${base}/api/cu/fill/execute`, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, sealed: 'A'.repeat(21_847) }),
    });
    assert.equal(oversizedRes.status, 413);
    const execRes = await fetch(`${base}/api/cu/fill/execute`, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, sealed: FLEET_VECTOR.sealed, extra: 'ignored' }),
    });
    assert.equal(execRes.status, 200);
    assert.deepEqual(state.seenExecuteBodies, [{ requestId: FLEET_VECTOR.requestId, sealed: FLEET_VECTOR.sealed }]);
    // Cancel validates reason and forwards.
    const badCancel = await fetch(`${base}/api/cu/fill/cancel`, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, reason: 'bogus' }),
    });
    assert.equal(badCancel.status, 400);
    const cancelRes = await fetch(`${base}/api/cu/fill/cancel`, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, reason: 'denied' }),
    });
    assert.equal(cancelRes.status, 200);
    assert.deepEqual(state.seenCancelBodies, [{ requestId: FLEET_VECTOR.requestId, reason: 'denied' }]);
    // GET /api/cu/fill/status translates query params to broker POST /v1/fill/status.
    const statusRes = await fetch(`${base}/api/cu/fill/status?requestId=${FLEET_VECTOR.requestId}&waitMs=30000`, { headers: authHeaders });
    assert.equal(statusRes.status, 200);
    assert.deepEqual(state.seenStatusBodies, [{ requestId: FLEET_VECTOR.requestId, waitMs: 25_000 }]);
    // /api/cu/status scrubs nonce, and /api/cu/stream drops fill events and scrubs nonce/publicKey/sealed.
    const cuStatus = (0, test_types_js_1.record)(await (await fetch(`${base}/api/cu/status`, { headers: authHeaders })).json());
    assert.equal('nonce' in cuStatus, false);
    const streamAbort = new AbortController();
    const streamRes = await fetch(`${base}/api/cu/stream`, { headers: authHeaders, signal: streamAbort.signal });
    assert.equal(streamRes.status, 200);
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let sseText = '';
    const readChunk = async () => {
        const { value } = await reader.read();
        if (value)
            sseText += decoder.decode(value, { stream: true });
    };
    await readChunk(); // hello frame
    for (const client of state.sseClients) {
        client.write(`event: fill_request\ndata: ${JSON.stringify({ requestId: FLEET_VECTOR.requestId, nonce: 'secret-nonce', publicKey: 'secret-pub' })}\n\n`);
        client.write(`event: vault_fill\ndata: ${JSON.stringify({ requestId: FLEET_VECTOR.requestId, nonce: 'vault-fill-nonce' })}\n\n`);
        client.write(`event: cu_fill_done\ndata: ${JSON.stringify({ requestId: FLEET_VECTOR.requestId, note: 'cu-fill-done' })}\n\n`);
        client.write(`event: lease_changed\ndata: ${JSON.stringify({ state: 'agent', epoch: 5, nonce: 'leaked-nonce', publicKey: 'leaked-pub', sealed: 'leaked-sealed' })}\n\n`);
    }
    await readChunk();
    streamAbort.abort();
    assert.ok(!sseText.includes('secret-nonce'));
    assert.ok(!sseText.includes('vault-fill-nonce'));
    assert.ok(!sseText.includes('cu-fill-done'));
    assert.ok(!sseText.includes('leaked-nonce'));
    assert.ok(!sseText.includes('leaked-pub'));
    assert.ok(!sseText.includes('leaked-sealed'));
    assert.ok(!sseText.includes('event: fill_request'));
    assert.ok(!sseText.includes('event: vault_fill'));
    assert.ok(!sseText.includes('event: cu_fill_done'));
    assert.match(sseText, /"epoch":5/);
    // Hub HTTP /hosts/:name/api/cu/fill/* stays closed (404) so browser clients cannot pull nonces/keys.
    const prevHome = process.env.HOME;
    const hubHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-hub-relay-'));
    process.env.HOME = hubHome;
    t.after(() => {
        if (prevHome === undefined)
            delete process.env.HOME;
        else
            process.env.HOME = prevHome;
        fs.rmSync(hubHome, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(hubHome, '.pi', 'dish'), { recursive: true });
    fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'settings.json'), JSON.stringify({
        remotes: [{ name: 'cu-sandbox', url: base, token: bearer }],
    }));
    const relay = (0, relay_handlers_1.createRelayHandlers)({
        fleetArtifacts,
        localPageExists: () => false,
        publicBaseUrl: () => undefined,
        hostDescriptor: () => ({ hostId: 'hub', label: 'beelink', version: '1.0.0', capabilities: {} }),
        upgradeAuthorized: () => true,
    });
    const hubApp = express();
    hubApp.use('/hosts/:name/api', relay.rawApi);
    const hubServer = http.createServer(hubApp);
    await new Promise(resolve => hubServer.listen(0, '127.0.0.1', () => resolve()));
    t.after(() => new Promise(resolve => { hubServer.closeAllConnections?.(); hubServer.close(() => resolve()); }));
    const hubPort = hubServer.address().port;
    assert.equal((await fetch(`http://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/cu/fill/pending`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/foo/../cu/fill/pending`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/foo/..%2fcu/fill/pending`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/%2e%2e/api/cu/fill/pending`)).status, 404);
    assert.equal((0, relay_handlers_1.namesCuRoute)('/foo/../cu/fill/pending'), true);
    assert.equal((0, relay_handlers_1.namesCuRoute)('/%2e%2e/api/cu/fill/pending'), true);
    assert.equal((await fetch(`http://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/cu/fill/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: FLEET_VECTOR.requestId, sealed: FLEET_VECTOR.sealed }),
    })).status, 404);
});
test('guest fillPending aborts the control.sock long-poll if the caller disconnects', async (t) => {
    const { socketPath, state } = await startFakeFillBroker(t, {
        capabilities: ['vault_fill'],
        pendingDelayMs: 5_000,
    });
    const bearer = 'guest-bearer-abort';
    const { base } = await mountGuestFillApp(t, socketPath, bearer);
    const abort = new AbortController();
    const reqPromise = fetch(`${base}/api/cu/fill/pending?waitMs=5000`, {
        headers: { authorization: `Bearer ${bearer}` },
        signal: abort.signal,
    }).catch(() => null);
    await waitUntil(() => state.seenPendingQuery.length === 1);
    abort.abort();
    await reqPromise;
    await waitUntil(() => state.pendingAborted === 1);
    assert.equal(state.pendingAborted, 1);
});
// ---------------------------------------------------------------------------
// 3. Hub coordinator (fake relay/guest + fake pi-dish-vault + real cu-fill-seal)
// ---------------------------------------------------------------------------
test('readCuVaultFillConfig is off by default and validates opt-in config', () => {
    const tmpDish = path.join(os.tmpdir(), 'dish-cfg-test');
    assert.equal((0, cu_vault_fill_1.readCuVaultFillConfig)({}, tmpDish), null);
    assert.equal((0, cu_vault_fill_1.readCuVaultFillConfig)({ cuVaultFill: false }, tmpDish), null);
    assert.equal((0, cu_vault_fill_1.readCuVaultFillConfig)({ cuVaultFill: { enabled: false, remote: 'cu-sandbox' } }, tmpDish), null);
    const cfg = (0, cu_vault_fill_1.readCuVaultFillConfig)({ cuVaultFill: { enabled: true, remote: 'cu-sandbox' } }, tmpDish);
    assert.deepEqual(cfg, {
        remote: 'cu-sandbox',
        identity: 'cu-sandbox-proxy',
        identitiesDir: path.join(tmpDish, 'vault', 'identities'),
        xdgConfigHome: path.join(tmpDish, 'vault', 'identities', 'cu-sandbox-proxy'),
        explicitXdgConfigHome: false,
        pollWaitMs: 20_000,
    });
    const explicit = (0, cu_vault_fill_1.readCuVaultFillConfig)({
        cuVaultFill: { enabled: true, remote: 'cu-sandbox', identity: 'custom-id', xdgConfigHome: '/tmp/cu-aac', pollWaitMs: 5000 },
    }, tmpDish);
    assert.equal(explicit?.xdgConfigHome, '/tmp/cu-aac');
    assert.equal(explicit?.explicitXdgConfigHome, true);
    assert.equal(explicit?.identity, 'custom-id');
    assert.equal(explicit?.pollWaitMs, 5000);
    assert.throws(() => (0, cu_vault_fill_1.readCuVaultFillConfig)({ cuVaultFill: { enabled: true, remote: '../bad' } }, tmpDish));
    assert.throws(() => (0, cu_vault_fill_1.readCuVaultFillConfig)({ cuVaultFill: { enabled: true, remote: 'cu-sandbox', pollWaitMs: 99_999 } }, tmpDish));
});
test('buildFillApprovalReason includes topOrigin only when it differs from origin', () => {
    assert.equal((0, cu_vault_fill_1.buildFillApprovalReason)('https://login.acme.example', 'https://login.acme.example', 'Sign in'), 'CU fill: Sign in');
    assert.equal((0, cu_vault_fill_1.buildFillApprovalReason)('https://auth.acme.example', 'https://www.acme.example', 'Sign in'), 'CU fill (page https://www.acme.example): Sign in');
});
function createCoordinatorFixture(t, vaultScriptBody) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-coord-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const auditPath = path.join(dir, 'cu-vault-fill-audit.ndjson');
    const recordFile = path.join(dir, 'vault-calls.ndjson');
    const fakeVault = path.join(dir, 'fake-pi-dish-vault.js');
    fs.writeFileSync(fakeVault, `#!/usr/bin/env node\n'use strict';\n${vaultScriptBody}\n`, { mode: 0o755 });
    const identitiesDir = path.join(dir, 'identities');
    const config = {
        remote: 'cu-sandbox',
        identity: 'cu-sandbox-proxy',
        identitiesDir,
        xdgConfigHome: path.join(identitiesDir, 'cu-sandbox-proxy'),
        explicitXdgConfigHome: false,
        pollWaitMs: 5_000,
    };
    const recip = crypto.generateKeyPairSync('x25519');
    return {
        dir,
        auditPath,
        config,
        logs: [],
        fakeVault,
        recordFile,
        recipPriv: recip.privateKey,
        recipPubB64u: x25519RawPublic(recip.privateKey).toString('base64url'),
    };
}
function makePendingReq(overrides = {}) {
    return {
        requestId: `fill-${'2'.repeat(32)}`,
        seq: 1,
        nonce: crypto.randomBytes(32).toString('base64url'),
        publicKey: FLEET_VECTOR.recipPubB64u,
        envelope: { version: 1, alg: cu_vault_fill_1.CU_VAULT_FILL_ENVELOPE_ALG },
        origin: 'https://auth.acme.example',
        topOrigin: 'https://www.acme.example',
        item: 'Acme Portal',
        fields: ['username', 'password', 'totp'],
        submit: true,
        reason: 'Sign in to check order',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        ...overrides,
    };
}
function readAuditLines(auditPath) {
    if (!fs.existsSync(auditPath))
        return [];
    return fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map(line => (0, test_types_js_1.record)(JSON.parse(line)));
}
test('hub coordinator approves, seals via real cu-fill-seal, retries retryable codes, deduplicates, and keeps secrets out of logs/audit/argv', async (t) => {
    const secretUser = 'alice.secret@acme.example';
    const secretPass = 'Ultra-Secret-Pass-9876!';
    const secretTotp = '908172';
    // Fake pi-dish-vault mimics `aac run`: logs its argv/env/stdin (no secrets!)
    // and runs the `-- node cu-fill-seal.js` command with injected CU_FILL_* env vars.
    const fixture = createCoordinatorFixture(t, `
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const argv = process.argv.slice(2);
const stdinData = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify('RECORD_FILE')}, JSON.stringify({ argv, env: process.env, stdin: JSON.parse(stdinData) }) + '\\n');
const split = argv.indexOf('--');
const cmd = argv.slice(split + 1);
const child = spawnSync(cmd[0], cmd.slice(1), {
  input: stdinData,
  env: {
    PATH: process.env.PATH || '',
    CU_FILL_USERNAME: ${JSON.stringify(secretUser)},
    CU_FILL_PASSWORD: ${JSON.stringify(secretPass)},
    CU_FILL_TOTP: ${JSON.stringify(secretTotp)},
  },
  encoding: 'utf8',
});
if (child.stderr) process.stderr.write(child.stderr);
process.stdout.write(child.stdout || '');
process.exit(child.status ?? 1);
`.replace(JSON.stringify('RECORD_FILE'), 'process.env.TEST_RECORD_FILE'));
    // Inject sentinel env vars in the parent process to verify minimal child env strips them.
    const prevBw = process.env.BW_SESSION;
    const prevDishToken = process.env.PI_DISH_TOKEN;
    const prevTestRecord = process.env.TEST_RECORD_FILE;
    process.env.BW_SESSION = 'parent-bw-session-must-not-leak';
    process.env.PI_DISH_TOKEN = 'parent-dish-token-must-not-leak';
    t.after(() => {
        if (prevBw === undefined)
            delete process.env.BW_SESSION;
        else
            process.env.BW_SESSION = prevBw;
        if (prevDishToken === undefined)
            delete process.env.PI_DISH_TOKEN;
        else
            process.env.PI_DISH_TOKEN = prevDishToken;
        if (prevTestRecord === undefined)
            delete process.env.TEST_RECORD_FILE;
        else
            process.env.TEST_RECORD_FILE = prevTestRecord;
    });
    // Rewrite fakeVault with literal recordFile path so we don't need TEST_RECORD_FILE in minimal env.
    fs.writeFileSync(fixture.fakeVault, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const argv = process.argv.slice(2);
const stdinData = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(fixture.recordFile)}, JSON.stringify({ argv, env: process.env, stdin: JSON.parse(stdinData) }) + '\\n');
const split = argv.indexOf('--');
const cmd = argv.slice(split + 1);
const child = spawnSync(cmd[0], cmd.slice(1), {
  input: stdinData,
  env: {
    PATH: process.env.PATH || '',
    CU_FILL_USERNAME: ${JSON.stringify(secretUser)},
    CU_FILL_PASSWORD: ${JSON.stringify(secretPass)},
    CU_FILL_TOTP: ${JSON.stringify(secretTotp)},
  },
  encoding: 'utf8',
});
if (child.stderr) process.stderr.write(child.stderr);
process.stdout.write(child.stdout || '');
process.exit(child.status ?? 1);
`, { mode: 0o755 });
    const req = makePendingReq({ publicKey: fixture.recipPubB64u });
    const executeCalls = [];
    const cancelCalls = [];
    const retrySequence = [
        { status: 409, body: { ok: false, code: 'transition_pending', message: 'transition' } },
        { status: 409, body: { ok: false, code: 'agent_busy', message: 'busy' } },
        { status: 409, body: { ok: false, code: 'fill_in_progress', message: 'in progress' } },
        { status: 503, body: { ok: false, code: 'broker_busy', applied: false, message: 'busy' } },
        { status: 200, body: { ok: true, requestId: req.requestId, filled: ['username', 'password', 'totp'], submitted: true, originSeen: req.origin, origin: req.origin } },
    ];
    let pollCount = 0;
    const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
        config: fixture.config,
        vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
        sealerScript: SEALER_SCRIPT,
        auditFile: () => fixture.auditPath,
        executeRetryBackoffMs: [5, 5, 5],
        log: message => fixture.logs.push(message),
        requestRemote: async (remoteName, call) => {
            assert.equal(remoteName, 'cu-sandbox');
            if (call.method === 'GET' && call.path.startsWith('/api/cu/fill/pending')) {
                pollCount += 1;
                return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
            }
            if (call.method === 'POST' && call.path === '/api/cu/fill/execute') {
                executeCalls.push((0, test_types_js_1.record)(call.body));
                return retrySequence[Math.min(executeCalls.length - 1, retrySequence.length - 1)];
            }
            if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
                cancelCalls.push((0, test_types_js_1.record)(call.body));
                return { status: 200, body: { ok: true } };
            }
            return { status: 404, body: {} };
        },
    });
    t.after(() => coord.stop());
    // First poll launches approval; immediate second poll with same requestId must dedupe.
    await coord.pollOnce();
    await coord.pollOnce();
    await waitUntil(() => executeCalls.length === 5 && coord.activeCount() === 0);
    // A third poll after completion must ALSO dedupe against processed requestId.
    await coord.pollOnce();
    assert.equal(pollCount, 3);
    assert.equal(cancelCalls.length, 0);
    const vaultCalls = fs.readFileSync(fixture.recordFile, 'utf8').trim().split('\n').map(line => (0, test_types_js_1.record)(JSON.parse(line)));
    assert.equal(vaultCalls.length, 1, 'duplicate requestId must only invoke pi-dish-vault once');
    const argv = vaultCalls[0].argv;
    assert.deepEqual(argv.slice(0, 7), [
        'run', '--identity', 'cu-sandbox-proxy', '--item', 'Acme Portal', '--origin', 'https://auth.acme.example',
    ]);
    assert.equal(argv[argv.indexOf('--reason') + 1], 'CU fill (page https://www.acme.example): Sign in to check order');
    assert.ok(argv.includes('CU_FILL_USERNAME=username'));
    assert.ok(argv.includes('CU_FILL_PASSWORD=password'));
    assert.ok(argv.includes('CU_FILL_TOTP=totp'));
    assert.deepEqual(argv.slice(argv.indexOf('--') + 1), [process.execPath, SEALER_SCRIPT]);
    // Isolated XDG_CONFIG_HOME (0700) and minimal env (parent secrets stripped).
    const childEnv = (0, test_types_js_1.record)(vaultCalls[0].env);
    assert.equal(childEnv.XDG_CONFIG_HOME, fixture.config.xdgConfigHome);
    assert.equal(fs.statSync(fixture.config.xdgConfigHome).mode & 0o777, 0o700);
    assert.equal(childEnv.BW_SESSION, undefined);
    assert.equal(childEnv.PI_DISH_TOKEN, undefined);
    assert.equal(childEnv.CU_FILL_PASSWORD, undefined);
    // Stdin header carries the exact protocol label and request metadata.
    assert.deepEqual(vaultCalls[0].stdin, {
        requestId: req.requestId,
        nonce: req.nonce,
        publicKey: fixture.recipPubB64u,
        label: cu_vault_fill_1.CU_VAULT_FILL_ENVELOPE_LABEL,
        origin: 'https://auth.acme.example',
    });
    // Sealed envelope delivered to execute decrypts with the broker's private key.
    const sealed = String(executeCalls[0].sealed);
    const opened = openEnvelope(fixture.recipPriv, sealed, String(req.requestId), 'https://auth.acme.example');
    assert.deepEqual(opened, {
        v: 1,
        requestId: req.requestId,
        nonce: req.nonce,
        fields: { username: secretUser, password: secretPass, totp: secretTotp },
    });
    // Audit file is 0600, non-secret, and records the outcome.
    assert.equal(fs.statSync(fixture.auditPath).mode & 0o777, 0o600);
    const audits = readAuditLines(fixture.auditPath);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].requestId, req.requestId);
    assert.equal(audits[0].origin, 'https://auth.acme.example');
    assert.equal(audits[0].topOrigin, 'https://www.acme.example');
    assert.equal(audits[0].item, 'Acme Portal');
    assert.equal(audits[0].outcome, 'filled');
    assert.equal(audits[0].code, null);
    // Secrets and sealed ciphertext never appear in logs, audit file, or argv.
    const combined = JSON.stringify({ logs: fixture.logs, audits, argv });
    for (const sensitive of [secretUser, secretPass, secretTotp, sealed, String(req.nonce)]) {
        assert.ok(!combined.includes(sensitive), `sensitive token leaked: ${sensitive.slice(0, 12)}`);
    }
});
test('hub coordinator cancels with matching reason on deny, policy refusal, expiry, and helper failure (without logging stdout)', async (t) => {
    const cases = [
        {
            name: 'operator deny',
            requestId: `fill-${'3'.repeat(32)}`,
            expiresInMs: 60_000,
            vaultScript: `process.stderr.write('pi-dish-vault: denied in pi-dish\\n'); process.exit(4);`,
            expectedCancelReason: 'denied',
            expectedOutcome: 'denied',
            expectedCode: 'operator_denied',
        },
        {
            name: 'policy refusal',
            requestId: `fill-${'4'.repeat(32)}`,
            expiresInMs: 60_000,
            vaultScript: `process.stderr.write('pi-dish-vault: refused before approval: origin mismatch\\n'); process.exit(4);`,
            expectedCancelReason: 'denied',
            expectedOutcome: 'refused',
            expectedCode: 'policy_refused',
        },
        {
            name: 'already expired request',
            requestId: `fill-${'5'.repeat(32)}`,
            expiresInMs: -5_000,
            vaultScript: `process.exit(0);`,
            expectedCancelReason: 'timeout',
            expectedOutcome: 'timeout',
            expectedCode: 'expired',
        },
        {
            name: 'helper bad stdout never logged and stderr capped',
            requestId: `fill-${'6'.repeat(32)}`,
            expiresInMs: 60_000,
            vaultScript: `process.stderr.write('E'.repeat(500) + '\\n'); process.stdout.write('SENSITIVE_STDOUT_MUST_NOT_LOG'); process.exit(0);`,
            expectedCancelReason: 'error',
            expectedOutcome: 'error',
            expectedCode: 'invalid_sealed_output',
            forbiddenInLogs: 'SENSITIVE_STDOUT_MUST_NOT_LOG',
        },
    ];
    for (const tc of cases) {
        const fixture = createCoordinatorFixture(t, tc.vaultScript);
        const req = makePendingReq({
            requestId: tc.requestId,
            publicKey: fixture.recipPubB64u,
            expiresAt: new Date(Date.now() + tc.expiresInMs).toISOString(),
        });
        const cancels = [];
        const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
            config: fixture.config,
            vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
            sealerScript: SEALER_SCRIPT,
            auditFile: () => fixture.auditPath,
            log: message => fixture.logs.push(message),
            requestRemote: async (_remote, call) => {
                if (call.method === 'GET')
                    return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
                if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
                    cancels.push((0, test_types_js_1.record)(call.body));
                    return { status: 200, body: { ok: true } };
                }
                throw new Error(`unexpected call ${call.method} ${call.path}`);
            },
        });
        t.after(() => coord.stop());
        await coord.pollOnce();
        await waitUntil(() => cancels.length === 1 && coord.activeCount() === 0);
        assert.deepEqual(cancels[0], { requestId: tc.requestId, reason: tc.expectedCancelReason }, tc.name);
        const audits = readAuditLines(fixture.auditPath);
        assert.equal(audits.length, 1, tc.name);
        assert.equal(audits[0].outcome, tc.expectedOutcome, tc.name);
        assert.equal(audits[0].code, tc.expectedCode, tc.name);
        if (tc.forbiddenInLogs) {
            assert.ok(!fixture.logs.join('\n').includes(tc.forbiddenInLogs), `${tc.name}: stdout leaked into logs`);
        }
        for (const line of fixture.logs) {
            assert.ok(line.length <= 360, `${tc.name}: stderr log line must be bounded`);
        }
    }
});
test('hub coordinator kills waiting approval helper when broker withdraws the pending request', async (t) => {
    const startedMarker = path.join(os.tmpdir(), `pi-dish-started-${process.pid}-${Date.now()}`);
    const marker = path.join(os.tmpdir(), `pi-dish-withdrawn-${process.pid}-${Date.now()}`);
    t.after(() => {
        fs.rmSync(startedMarker, { force: true });
        fs.rmSync(marker, { force: true });
    });
    const fixture = createCoordinatorFixture(t, `
const fs = require('node:fs');
process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(marker)}, 'killed'); process.exit(143); });
fs.writeFileSync(${JSON.stringify(startedMarker)}, 'ready');
setInterval(() => {}, 1000);
`);
    const req = makePendingReq({ requestId: `fill-${'7'.repeat(32)}`, publicKey: fixture.recipPubB64u });
    let pendingList = [req];
    const cancels = [];
    const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
        config: fixture.config,
        vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
        sealerScript: SEALER_SCRIPT,
        auditFile: () => fixture.auditPath,
        log: message => fixture.logs.push(message),
        requestRemote: async (_remote, call) => {
            if (call.method === 'GET')
                return { status: 200, body: { ok: true, seq: 2, requests: pendingList } };
            if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
                cancels.push((0, test_types_js_1.record)(call.body));
                return { status: 200, body: { ok: true } };
            }
            return { status: 404, body: {} };
        },
    });
    t.after(() => coord.stop());
    await coord.pollOnce();
    assert.equal(coord.activeCount(), 1);
    await waitUntil(() => fs.existsSync(startedMarker));
    // Broker drops the request on next poll -> coordinator terminates waiting helper without calling cancel.
    pendingList = [];
    await coord.pollOnce();
    await waitUntil(() => coord.activeCount() === 0 && fs.existsSync(marker));
    assert.equal(cancels.length, 0);
    const audits = readAuditLines(fixture.auditPath);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].outcome, 'cancelled');
    assert.equal(audits[0].code, 'withdrawn');
});
test('hub coordinator talks to guest fill proxy end-to-end through remote-hosts HTTP+Bearer relay client', async (t) => {
    const { socketPath, state } = await startFakeFillBroker(t, { capabilities: ['vault_fill'] });
    const bearer = 'relay-end-to-end-token';
    const { base } = await mountGuestFillApp(t, socketPath, bearer);
    const prevHome = process.env.HOME;
    const hubHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-e2e-'));
    process.env.HOME = hubHome;
    t.after(() => {
        if (prevHome === undefined)
            delete process.env.HOME;
        else
            process.env.HOME = prevHome;
        fs.rmSync(hubHome, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(hubHome, '.pi', 'dish'), { recursive: true });
    fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'settings.json'), JSON.stringify({
        remotes: [{ name: 'cu-sandbox', url: base, token: bearer }],
    }));
    const fixture = createCoordinatorFixture(t, `
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const argv = process.argv.slice(2);
const stdinData = fs.readFileSync(0, 'utf8');
const cmd = argv.slice(argv.indexOf('--') + 1);
const child = spawnSync(cmd[0], cmd.slice(1), {
  input: stdinData,
  env: { PATH: process.env.PATH || '', CU_FILL_USERNAME: 'e2e-user', CU_FILL_PASSWORD: 'e2e-password' },
  encoding: 'utf8',
});
process.stdout.write(child.stdout || '');
process.exit(child.status ?? 1);
`);
    const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
        config: { ...fixture.config, pollWaitMs: 1_000 },
        vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
        sealerScript: SEALER_SCRIPT,
        auditFile: () => fixture.auditPath,
        log: message => fixture.logs.push(message),
    });
    t.after(() => coord.stop());
    await coord.pollOnce();
    await waitUntil(() => state.seenExecuteBodies.length === 1 && coord.activeCount() === 0);
    const recipPriv = x25519PrivateFromHex(FLEET_VECTOR.recipPrivHex);
    const opened = openEnvelope(recipPriv, String(state.seenExecuteBodies[0].sealed), FLEET_VECTOR.requestId, FLEET_VECTOR.origin);
    assert.deepEqual(opened, {
        v: 1,
        requestId: FLEET_VECTOR.requestId,
        nonce: FLEET_VECTOR.nonce,
        fields: { username: 'e2e-user', password: 'e2e-password' },
    });
    const audits = readAuditLines(fixture.auditPath);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].outcome, 'filled');
});
test('hub coordinator classifies refusals/timeouts on full stderr past 256 bytes and logs only bounded tail line', async (t) => {
    const longPrefix = 'W'.repeat(320);
    const cases = [
        {
            requestId: `fill-${'8'.repeat(32)}`,
            stderr: `${longPrefix}\npi-dish-vault: refused before approval: origin mismatch\n`,
            expectedCancel: 'denied',
            expectedOutcome: 'refused',
            expectedCode: 'policy_refused',
            expectedLogMatch: /origin mismatch$/,
        },
        {
            requestId: `fill-${'9'.repeat(32)}`,
            stderr: `${longPrefix}\npi-dish-vault: no decision in pi-dish within 180s\n`,
            expectedCancel: 'timeout',
            expectedOutcome: 'timeout',
            expectedCode: 'approval_timeout',
            expectedLogMatch: /no decision in pi-dish within 180s$/,
        },
    ];
    for (const tc of cases) {
        const fixture = createCoordinatorFixture(t, `process.stderr.write(${JSON.stringify(tc.stderr)}); process.exit(4);`);
        const req = makePendingReq({ requestId: tc.requestId, publicKey: fixture.recipPubB64u });
        const cancels = [];
        const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
            config: fixture.config,
            vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
            sealerScript: SEALER_SCRIPT,
            auditFile: () => fixture.auditPath,
            log: message => fixture.logs.push(message),
            requestRemote: async (_remote, call) => {
                if (call.method === 'GET')
                    return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
                if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
                    cancels.push((0, test_types_js_1.record)(call.body));
                    return { status: 200, body: { ok: true } };
                }
                return { status: 404, body: {} };
            },
        });
        t.after(() => coord.stop());
        await coord.pollOnce();
        await waitUntil(() => cancels.length === 1 && coord.activeCount() === 0);
        assert.deepEqual(cancels[0], { requestId: tc.requestId, reason: tc.expectedCancel });
        const audits = readAuditLines(fixture.auditPath);
        assert.equal(audits[0].outcome, tc.expectedOutcome);
        assert.equal(audits[0].code, tc.expectedCode);
        assert.equal(fixture.logs.length, 1);
        assert.match(fixture.logs[0], tc.expectedLogMatch);
        assert.ok(!fixture.logs[0].includes('WWWWWWWWWW'), 'log line must contain only the tail line, not the preamble');
    }
});
test('hub coordinator rejects non-canonical or >256-char pending origins as invalid_origin before spawning helper', async (t) => {
    const longOrigin = `https://${'a'.repeat(245)}.test`; // 258 chars > 256
    for (const [idx, badOrigin] of [
        'https://Login.Acme.Example:443',
        ' https://login.acme.example ',
        longOrigin,
    ].entries()) {
        const fixture = createCoordinatorFixture(t, `require('node:fs').writeFileSync(${JSON.stringify('NEVER')}, 'ran'); process.exit(0);`);
        const ranFile = path.join(fixture.dir, 'should-not-run');
        fs.writeFileSync(fixture.fakeVault, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(ranFile)}, 'ran');\n`, { mode: 0o755 });
        const requestId = `fill-${String(idx).padStart(32, 'b')}`;
        const req = makePendingReq({ requestId, origin: badOrigin, publicKey: fixture.recipPubB64u });
        const cancels = [];
        const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
            config: fixture.config,
            vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
            sealerScript: SEALER_SCRIPT,
            auditFile: () => fixture.auditPath,
            log: message => fixture.logs.push(message),
            requestRemote: async (_remote, call) => {
                if (call.method === 'GET')
                    return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
                if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
                    cancels.push((0, test_types_js_1.record)(call.body));
                    return { status: 200, body: { ok: true } };
                }
                return { status: 404, body: {} };
            },
        });
        t.after(() => coord.stop());
        await coord.pollOnce();
        await waitUntil(() => cancels.length === 1 && coord.activeCount() === 0);
        assert.deepEqual(cancels[0], { requestId, reason: 'error' }, badOrigin);
        assert.equal(fs.existsSync(ranFile), false, badOrigin);
        const audits = readAuditLines(fixture.auditPath);
        assert.equal(audits[0].outcome, 'error');
        assert.equal(audits[0].code, 'invalid_origin');
    }
});
test('hub coordinator retry logic requires applied:false on 503 broker_busy, bounds retryAfterMs, and caps attempts', async (t) => {
    // 1) 503 broker_busy without applied:false, and 409 retries with applied:true/'unknown', must NOT retry.
    for (const nonRetryable of [
        { status: 503, body: { ok: false, code: 'broker_busy' } },
        { status: 409, body: { ok: false, code: 'agent_busy', applied: true } },
        { status: 409, body: { ok: false, code: 'fill_in_progress', applied: 'unknown' } },
    ]) {
        const fixture = createCoordinatorFixture(t, `process.stdout.write(${JSON.stringify(FLEET_VECTOR.sealed)});`);
        const req = makePendingReq({ requestId: `fill-${'c'.repeat(32)}`, publicKey: fixture.recipPubB64u });
        let execCount = 0;
        const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
            config: fixture.config,
            vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
            sealerScript: SEALER_SCRIPT,
            auditFile: () => fixture.auditPath,
            executeRetryBackoffMs: [5],
            log: message => fixture.logs.push(message),
            requestRemote: async (_remote, call) => {
                if (call.method === 'GET')
                    return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
                if (call.method === 'POST' && call.path === '/api/cu/fill/execute') {
                    execCount += 1;
                    return nonRetryable;
                }
                return { status: 200, body: { ok: true } };
            },
        });
        t.after(() => coord.stop());
        await coord.pollOnce();
        await waitUntil(() => execCount === 1 && coord.activeCount() === 0);
        assert.equal(execCount, 1);
        assert.equal(readAuditLines(fixture.auditPath)[0].outcome, 'failed');
    }
    // 2) retryAfterMs < baseDelay still waits >= baseDelay, and attempts cap at maxExecuteAttempts -> cancel error.
    {
        const fixture = createCoordinatorFixture(t, `process.stdout.write(${JSON.stringify(FLEET_VECTOR.sealed)});`);
        const req = makePendingReq({ requestId: `fill-${'d'.repeat(32)}`, publicKey: fixture.recipPubB64u });
        const execTimestamps = [];
        const cancels = [];
        const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
            config: fixture.config,
            vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
            sealerScript: SEALER_SCRIPT,
            auditFile: () => fixture.auditPath,
            executeRetryBackoffMs: [40],
            maxExecuteAttempts: 3,
            log: message => fixture.logs.push(message),
            requestRemote: async (_remote, call) => {
                if (call.method === 'GET')
                    return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
                if (call.method === 'POST' && call.path === '/api/cu/fill/execute') {
                    execTimestamps.push(Date.now());
                    return { status: 409, body: { ok: false, code: 'agent_busy', retryAfterMs: 1 } };
                }
                if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
                    cancels.push((0, test_types_js_1.record)(call.body));
                    return { status: 200, body: { ok: true } };
                }
                return { status: 404, body: {} };
            },
        });
        t.after(() => coord.stop());
        await coord.pollOnce();
        await waitUntil(() => cancels.length === 1 && coord.activeCount() === 0);
        assert.equal(execTimestamps.length, 3, 'execute attempts must stop at maxExecuteAttempts');
        assert.ok(execTimestamps[1] - execTimestamps[0] >= 25, 'delay must respect baseDelay floor when retryAfterMs is tiny');
        assert.deepEqual(cancels[0], { requestId: req.requestId, reason: 'error' });
        assert.equal(readAuditLines(fixture.auditPath)[0].outcome, 'failed');
    }
});
test('hub coordinator cancels on execute transport error, reaches final poll backoff slot, and cancels in-flight requests on stop()', async (t) => {
    // 1) Execute transport error triggers best-effort cancelRemote(id, 'error').
    {
        const fixture = createCoordinatorFixture(t, `process.stdout.write(${JSON.stringify(FLEET_VECTOR.sealed)});`);
        const req = makePendingReq({ requestId: `fill-${'e'.repeat(32)}`, publicKey: fixture.recipPubB64u });
        const cancels = [];
        const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
            config: fixture.config,
            vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
            sealerScript: SEALER_SCRIPT,
            auditFile: () => fixture.auditPath,
            log: message => fixture.logs.push(message),
            requestRemote: async (_remote, call) => {
                if (call.method === 'GET')
                    return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
                if (call.method === 'POST' && call.path === '/api/cu/fill/execute') {
                    throw new Error('simulated transport drop');
                }
                if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
                    cancels.push((0, test_types_js_1.record)(call.body));
                    return { status: 200, body: { ok: true } };
                }
                return { status: 404, body: {} };
            },
        });
        t.after(() => coord.stop());
        await coord.pollOnce();
        await waitUntil(() => cancels.length === 1 && coord.activeCount() === 0);
        assert.deepEqual(cancels[0], { requestId: req.requestId, reason: 'error' });
        assert.equal(readAuditLines(fixture.auditPath)[0].code, 'transport_error');
    }
    // 2) Poll backoff climbs all the way to the last element (e.g., 15s slot in production).
    {
        const fixture = createCoordinatorFixture(t, 'process.exit(0);');
        const pollTimes = [];
        const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
            config: fixture.config,
            vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
            sealerScript: SEALER_SCRIPT,
            auditFile: () => fixture.auditPath,
            pollErrorBackoffMs: [5, 10, 60],
            log: message => fixture.logs.push(message),
            requestRemote: async () => {
                pollTimes.push(Date.now());
                if (pollTimes.length >= 4)
                    coord.stop();
                return { status: 503, body: {} };
            },
        });
        t.after(() => coord.stop());
        coord.start();
        await waitUntil(() => pollTimes.length >= 4);
        // 1st fail -> 5ms, 2nd fail -> 10ms, 3rd fail -> 60ms (the final slot!).
        assert.ok(pollTimes[3] - pollTimes[2] >= 45, `expected final backoff slot (>=45ms), got ${pollTimes[3] - pollTimes[2]}ms`);
    }
    // 3) stop() fires bounded best-effort cancel for in-flight requests without hanging.
    {
        const fixture = createCoordinatorFixture(t, 'setInterval(() => {}, 1000);');
        const req = makePendingReq({ requestId: `fill-${'f'.repeat(32)}`, publicKey: fixture.recipPubB64u });
        const cancels = [];
        const coord = (0, cu_vault_fill_1.createCuVaultFillCoordinator)({
            config: fixture.config,
            vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
            sealerScript: SEALER_SCRIPT,
            auditFile: () => fixture.auditPath,
            stopCancelTimeoutMs: 60,
            log: message => fixture.logs.push(message),
            requestRemote: async (_remote, call) => {
                if (call.method === 'GET')
                    return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
                if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
                    const entry = { body: (0, test_types_js_1.record)(call.body), aborted: false };
                    cancels.push(entry);
                    // Stall until aborted by stopCancelTimeoutMs to prove shutdown stays bounded.
                    return await new Promise((_resolve, reject) => {
                        call.signal?.addEventListener('abort', () => {
                            entry.aborted = true;
                            reject(new Error('aborted'));
                        }, { once: true });
                    });
                }
                return { status: 404, body: {} };
            },
        });
        await coord.pollOnce();
        assert.equal(coord.activeCount(), 1);
        const stopStart = Date.now();
        coord.stop();
        assert.ok(Date.now() - stopStart < 50, 'stop() must return synchronously without blocking');
        await waitUntil(() => cancels.length === 1 && cancels[0].aborted === true);
        assert.deepEqual(cancels[0].body, { requestId: req.requestId, reason: 'cancelled' });
    }
});
