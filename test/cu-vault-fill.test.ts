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
import test = require('node:test');
import type { TestContext } from 'node:test';
import assert = require('node:assert/strict');
import { execFile } from 'node:child_process';
import crypto = require('node:crypto');
import express = require('express');
import fs = require('node:fs');
import http = require('node:http');
import type { AddressInfo } from 'node:net';
import os = require('node:os');
import path = require('node:path');
import { createAccessHandlers } from '../lib/access-handlers';
import { createCuHandlers } from '../lib/cu-handlers';
import {
  CU_VAULT_FILL_ENVELOPE_ALG,
  CU_VAULT_FILL_ENVELOPE_LABEL,
  buildFillApprovalReason,
  createCuVaultFillCoordinator,
  readCuVaultFillConfig,
  type CuVaultFillConfig,
  type CuVaultFillHttpRequest,
  type CuVaultFillHttpResponse,
} from '../lib/cu-vault-fill';
import * as fleetArtifacts from '../lib/fleet-artifacts';
import { createRelayHandlers } from '../lib/relay-handlers';
import { record } from './test-types.js';

const SEALER_SCRIPT = path.join(__dirname, '..', 'skills', 'pi-dish-vault', 'scripts', 'cu-fill-seal.js');
const sealerMod: typeof import('../skills/pi-dish-vault/scripts/cu-fill-seal.js') = require(SEALER_SCRIPT);

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const LABEL_BUF = Buffer.from(CU_VAULT_FILL_ENVELOPE_LABEL, 'ascii');
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
  sealed:
    'AQZFP82c71ofU6zE-UIQTAyOnifVx7N_VQfNzRYoEFlj08mhet5G7tNltvmgxcp2xSvAZkLk2UWStYFJ4dFVOCNShxN829pmKGWWwKmG0s9Hh00IrjCcUptkOXAOlihDcs1VaguBRJKFh5HAPfl1Q16Dpr5u5wCqiB1Lei8uyQCq3UHAlCk84OFnvcih-KN2dFO7hJ-arx7nUKeBgxmjgQFS-JuuMZAQ8R26fEhcXJwXUOi79B8OpZZZQ1n4EGTW25WOkWEDhie7QI2HKbBAjVlHt_u-tjd6ibyuzKWFaTx4Skk73shwXVvsANgfyJjknq_k8A2YuqVp8z2HbhdgEgXqDrE',
} as const;

function x25519PrivateFromHex(hex: string): crypto.KeyObject {
  return crypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
}

function x25519RawPublic(key: crypto.KeyObject): Buffer {
  return crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
}

/** Independent envelope opener matching Fleet's `cu-broker` `FillKey.open()`. */
function openEnvelope(
  recipientPrivate: crypto.KeyObject,
  sealed: string,
  requestId: string,
  origin: string,
): Record<string, unknown> | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(sealed)) return null;
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length < 51 || raw.length > 16384 || raw[0] !== 1) return null;
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
    if (shared.every(b => b === 0)) return null;
    const rid = Buffer.from(requestId, 'ascii');
    const okm = Buffer.from(crypto.hkdfSync(
      'sha256',
      shared,
      Buffer.concat([epk, recipientPub]),
      Buffer.concat([LABEL_BUF, ZERO_BUF, rid]),
      44,
    ));
    const aad = Buffer.concat([LABEL_BUF, ZERO_BUF, rid, ZERO_BUF, Buffer.from(origin, 'ascii')]);
    const decipher = crypto.createDecipheriv('chacha20-poly1305', okm.subarray(0, 32), okm.subarray(32, 44), { authTagLength: 16 });
    decipher.setAAD(aad, { plaintextLength: ct.length });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    return record(JSON.parse(plain));
  } catch {
    return null;
  }
}

async function runSealerCli(
  header: unknown,
  envVars: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [SEALER_SCRIPT],
      { env: { PATH: process.env.PATH || '', ...envVars }, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : (error ? 1 : 0);
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
    child.stdin?.end(typeof header === 'string' ? header : JSON.stringify(header));
  });
}

async function waitUntil(check: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.ok(check(), 'condition did not become true before timeout');
}

// ---------------------------------------------------------------------------
// 1. Sealer interop & secret hygiene
// ---------------------------------------------------------------------------

test('cu-fill-seal matches Fleet Python/Node envelope v1 vector byte-for-byte', () => {
  const ephPriv = x25519PrivateFromHex(FLEET_VECTOR.ephPrivHex);
  const sealed = sealerMod.sealEnvelope(
    {
      requestId: FLEET_VECTOR.requestId,
      nonce: FLEET_VECTOR.nonce,
      publicKey: FLEET_VECTOR.recipPubB64u,
      label: CU_VAULT_FILL_ENVELOPE_LABEL,
      origin: FLEET_VECTOR.origin,
    },
    FLEET_VECTOR.fields,
    { ephemeralPrivateKey: ephPriv },
  );
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
    label: CU_VAULT_FILL_ENVELOPE_LABEL,
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
  const scratchEnv: NodeJS.ProcessEnv = {
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

  // Low-order all-zero public key and non-https origin are rejected.
  const zeroKeyRes = await runSealerCli({ ...header, publicKey: Buffer.alloc(32).toString('base64url') }, { CU_FILL_PASSWORD: 'ok' });
  assert.equal(zeroKeyRes.code, 1);
  const httpOriginRes = await runSealerCli({ ...header, origin: 'http://portal.acme.example' }, { CU_FILL_PASSWORD: 'ok' });
  assert.equal(httpOriginRes.code, 1);
});

// ---------------------------------------------------------------------------
// 2. Guest pi-dish proxy routes with fake control.sock
// ---------------------------------------------------------------------------

async function startFakeFillBroker(t: TestContext, options: {
  capabilities: readonly string[];
  pendingDelayMs?: number;
  executeDelayMs?: number;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-fill-sock-'));
  const socketPath = path.join(dir, 'control.sock');
  const state = {
    capabilities: [...options.capabilities],
    seenPendingQuery: [] as string[],
    seenExecuteBodies: [] as Array<Record<string, unknown>>,
    seenCancelBodies: [] as Array<Record<string, unknown>>,
    seenStatusBodies: [] as Array<Record<string, unknown>>,
    pendingAborted: 0,
    sseClients: new Set<http.ServerResponse>(),
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
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          seq: 7,
          requests: [{
            requestId: FLEET_VECTOR.requestId,
            seq: 7,
            nonce: FLEET_VECTOR.nonce,
            publicKey: FLEET_VECTOR.recipPubB64u,
            envelope: { version: 1, alg: CU_VAULT_FILL_ENVELOPE_ALG },
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
          if (!res.writableEnded) state.pendingAborted += 1;
        });
      } else {
        sendPending();
      }
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/v1/fill/execute' || url.pathname === '/v1/fill/cancel' || url.pathname === '/v1/fill/status')) {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
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
          if (options.executeDelayMs) setTimeout(reply, options.executeDelayMs).unref();
          else reply();
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

  await new Promise<void>(resolve => server.listen(socketPath, () => resolve()));
  t.after(async () => {
    for (const c of state.sseClients) { try { c.destroy(); } catch {} }
    await new Promise<void>(resolve => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { socketPath, state };
}

async function mountGuestFillApp(t: TestContext, socketPath: string, token: string | null = null) {
  const prevToken = process.env.PI_DISH_TOKEN;
  if (token === null) delete process.env.PI_DISH_TOKEN;
  else process.env.PI_DISH_TOKEN = token;
  const access = createAccessHandlers({
    version: '1.0.0',
    readDishSettings: () => ({}),
    sttAvailable: () => false,
    usageLimitsAvailable: () => false,
    botsAvailable: () => false,
    knowledgeAvailable: () => false,
    computerUseAvailable: () => true,
  });
  if (prevToken === undefined) delete process.env.PI_DISH_TOKEN;
  else process.env.PI_DISH_TOKEN = prevToken;

  const cu = createCuHandlers({
    socketPath: () => socketPath,
    upgradeAuthorized: req => access.bearerUpgradeAuthorized(req),
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
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  t.after(async () => {
    cu.stop();
    await new Promise<void>(resolve => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  });
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, cu };
}

test('guest fill routes are disabled (404) when broker does not advertise vault_fill', async (t) => {
  const { socketPath } = await startFakeFillBroker(t, { capabilities: ['bind', 'ordered_sse'] });
  const { base } = await mountGuestFillApp(t, socketPath);

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
  const pendingBody = record(await pendingRes.json());
  assert.equal(pendingBody.seq, 7);
  assert.equal(state.seenPendingQuery[0], '?since=3&waitMs=25000');
  const reqRow = record((pendingBody.requests as unknown[])[0]);
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
  const cuStatus = record(await (await fetch(`${base}/api/cu/status`, { headers: authHeaders })).json());
  assert.equal('nonce' in cuStatus, false);

  const streamAbort = new AbortController();
  const streamRes = await fetch(`${base}/api/cu/stream`, { headers: authHeaders, signal: streamAbort.signal });
  assert.equal(streamRes.status, 200);
  const reader = streamRes.body!.getReader();
  const decoder = new TextDecoder();
  let sseText = '';
  const readChunk = async () => {
    const { value } = await reader.read();
    if (value) sseText += decoder.decode(value, { stream: true });
  };
  await readChunk(); // hello frame
  for (const client of state.sseClients) {
    client.write(`event: fill_request\ndata: ${JSON.stringify({ requestId: FLEET_VECTOR.requestId, nonce: 'secret-nonce', publicKey: 'secret-pub' })}\n\n`);
    client.write(`event: lease_changed\ndata: ${JSON.stringify({ state: 'agent', epoch: 5, nonce: 'leaked-nonce', publicKey: 'leaked-pub', sealed: 'leaked-sealed' })}\n\n`);
  }
  await readChunk();
  streamAbort.abort();
  assert.ok(!sseText.includes('secret-nonce'));
  assert.ok(!sseText.includes('leaked-nonce'));
  assert.ok(!sseText.includes('leaked-pub'));
  assert.ok(!sseText.includes('leaked-sealed'));
  assert.ok(!sseText.includes('fill_request'));
  assert.match(sseText, /"epoch":5/);

  // Hub HTTP /hosts/:name/api/cu/fill/* stays closed (404) so browser clients cannot pull nonces/keys.
  const prevHome = process.env.HOME;
  const hubHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-hub-relay-'));
  process.env.HOME = hubHome;
  t.after(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(hubHome, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(hubHome, '.pi', 'dish'), { recursive: true });
  fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'settings.json'), JSON.stringify({
    remotes: [{ name: 'cu-sandbox', url: base, token: bearer }],
  }));
  const relay = createRelayHandlers({
    fleetArtifacts,
    localPageExists: () => false,
    publicBaseUrl: () => undefined,
    hostDescriptor: () => ({ hostId: 'hub', label: 'beelink', version: '1.0.0', capabilities: {} }),
    upgradeAuthorized: () => true,
  });
  const hubApp = express();
  hubApp.use('/hosts/:name/api', relay.rawApi);
  const hubServer = http.createServer(hubApp);
  await new Promise<void>(resolve => hubServer.listen(0, '127.0.0.1', () => resolve()));
  t.after(() => new Promise<void>(resolve => { hubServer.closeAllConnections?.(); hubServer.close(() => resolve()); }));
  const hubPort = (hubServer.address() as AddressInfo).port;
  assert.equal((await fetch(`http://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/cu/fill/pending`)).status, 404);
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
  const { base } = await mountGuestFillApp(t, socketPath);
  const abort = new AbortController();
  const reqPromise = fetch(`${base}/api/cu/fill/pending?waitMs=5000`, { signal: abort.signal }).catch(() => null);
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
  assert.equal(readCuVaultFillConfig({}, tmpDish), null);
  assert.equal(readCuVaultFillConfig({ cuVaultFill: false }, tmpDish), null);
  assert.equal(readCuVaultFillConfig({ cuVaultFill: { enabled: false, remote: 'cu-sandbox' } }, tmpDish), null);

  const cfg = readCuVaultFillConfig({ cuVaultFill: { enabled: true, remote: 'cu-sandbox' } }, tmpDish);
  assert.deepEqual(cfg, {
    remote: 'cu-sandbox',
    identity: 'cu-sandbox-proxy',
    identitiesDir: path.join(tmpDish, 'vault', 'identities'),
    xdgConfigHome: path.join(tmpDish, 'vault', 'identities', 'cu-sandbox-proxy'),
    explicitXdgConfigHome: false,
    pollWaitMs: 20_000,
  });

  const explicit = readCuVaultFillConfig({
    cuVaultFill: { enabled: true, remote: 'cu-sandbox', identity: 'custom-id', xdgConfigHome: '/tmp/cu-aac', pollWaitMs: 5000 },
  }, tmpDish);
  assert.equal(explicit?.xdgConfigHome, '/tmp/cu-aac');
  assert.equal(explicit?.explicitXdgConfigHome, true);
  assert.equal(explicit?.identity, 'custom-id');
  assert.equal(explicit?.pollWaitMs, 5000);

  assert.throws(() => readCuVaultFillConfig({ cuVaultFill: { enabled: true, remote: '../bad' } }, tmpDish));
  assert.throws(() => readCuVaultFillConfig({ cuVaultFill: { enabled: true, remote: 'cu-sandbox', pollWaitMs: 99_999 } }, tmpDish));
});

test('buildFillApprovalReason includes topOrigin only when it differs from origin', () => {
  assert.equal(
    buildFillApprovalReason('https://login.acme.example', 'https://login.acme.example', 'Sign in'),
    'CU fill: Sign in',
  );
  assert.equal(
    buildFillApprovalReason('https://auth.acme.example', 'https://www.acme.example', 'Sign in'),
    'CU fill (page https://www.acme.example): Sign in',
  );
});

interface CoordinatorFixture {
  dir: string;
  auditPath: string;
  config: CuVaultFillConfig;
  logs: string[];
  fakeVault: string;
  recordFile: string;
  recipPriv: crypto.KeyObject;
  recipPubB64u: string;
}

function createCoordinatorFixture(t: TestContext, vaultScriptBody: string): CoordinatorFixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-coord-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const auditPath = path.join(dir, 'cu-vault-fill-audit.ndjson');
  const recordFile = path.join(dir, 'vault-calls.ndjson');
  const fakeVault = path.join(dir, 'fake-pi-dish-vault.js');
  fs.writeFileSync(fakeVault, `#!/usr/bin/env node\n'use strict';\n${vaultScriptBody}\n`, { mode: 0o755 });
  const identitiesDir = path.join(dir, 'identities');
  const config: CuVaultFillConfig = {
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

function makePendingReq(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: `fill-${'2'.repeat(32)}`,
    seq: 1,
    nonce: crypto.randomBytes(32).toString('base64url'),
    publicKey: FLEET_VECTOR.recipPubB64u,
    envelope: { version: 1, alg: CU_VAULT_FILL_ENVELOPE_ALG },
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

function readAuditLines(auditPath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(auditPath)) return [];
  return fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map(line => record(JSON.parse(line)));
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
    if (prevBw === undefined) delete process.env.BW_SESSION; else process.env.BW_SESSION = prevBw;
    if (prevDishToken === undefined) delete process.env.PI_DISH_TOKEN; else process.env.PI_DISH_TOKEN = prevDishToken;
    if (prevTestRecord === undefined) delete process.env.TEST_RECORD_FILE; else process.env.TEST_RECORD_FILE = prevTestRecord;
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
  const executeCalls: Array<Record<string, unknown>> = [];
  const cancelCalls: Array<Record<string, unknown>> = [];
  const retrySequence: CuVaultFillHttpResponse[] = [
    { status: 409, body: { ok: false, code: 'transition_pending', message: 'transition' } },
    { status: 409, body: { ok: false, code: 'agent_busy', message: 'busy' } },
    { status: 409, body: { ok: false, code: 'fill_in_progress', message: 'in progress' } },
    { status: 503, body: { ok: false, code: 'broker_busy', applied: false, message: 'busy' } },
    { status: 200, body: { ok: true, requestId: req.requestId, filled: ['username', 'password', 'totp'], submitted: true, originSeen: req.origin, origin: req.origin } },
  ];
  let pollCount = 0;

  const coord = createCuVaultFillCoordinator({
    config: fixture.config,
    vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
    sealerScript: SEALER_SCRIPT,
    auditFile: () => fixture.auditPath,
    executeRetryBackoffMs: [5, 5, 5],
    log: message => fixture.logs.push(message),
    requestRemote: async (remoteName, call: CuVaultFillHttpRequest): Promise<CuVaultFillHttpResponse> => {
      assert.equal(remoteName, 'cu-sandbox');
      if (call.method === 'GET' && call.path.startsWith('/api/cu/fill/pending')) {
        pollCount += 1;
        return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
      }
      if (call.method === 'POST' && call.path === '/api/cu/fill/execute') {
        executeCalls.push(record(call.body));
        return retrySequence[Math.min(executeCalls.length - 1, retrySequence.length - 1)]!;
      }
      if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
        cancelCalls.push(record(call.body));
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

  const vaultCalls = fs.readFileSync(fixture.recordFile, 'utf8').trim().split('\n').map(line => record(JSON.parse(line)));
  assert.equal(vaultCalls.length, 1, 'duplicate requestId must only invoke pi-dish-vault once');
  const argv = vaultCalls[0].argv as string[];
  assert.deepEqual(argv.slice(0, 7), [
    'run', '--identity', 'cu-sandbox-proxy', '--item', 'Acme Portal', '--origin', 'https://auth.acme.example',
  ]);
  assert.equal(argv[argv.indexOf('--reason') + 1], 'CU fill (page https://www.acme.example): Sign in to check order');
  assert.ok(argv.includes('CU_FILL_USERNAME=username'));
  assert.ok(argv.includes('CU_FILL_PASSWORD=password'));
  assert.ok(argv.includes('CU_FILL_TOTP=totp'));
  assert.deepEqual(argv.slice(argv.indexOf('--') + 1), [process.execPath, SEALER_SCRIPT]);

  // Isolated XDG_CONFIG_HOME (0700) and minimal env (parent secrets stripped).
  const childEnv = record(vaultCalls[0].env);
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
    label: CU_VAULT_FILL_ENVELOPE_LABEL,
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
  const cases: Array<{
    name: string;
    requestId: string;
    expiresInMs: number;
    vaultScript: string;
    expectedCancelReason: string;
    expectedOutcome: string;
    expectedCode: string;
    forbiddenInLogs?: string;
  }> = [
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
    const cancels: Array<Record<string, unknown>> = [];
    const coord = createCuVaultFillCoordinator({
      config: fixture.config,
      vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
      sealerScript: SEALER_SCRIPT,
      auditFile: () => fixture.auditPath,
      log: message => fixture.logs.push(message),
      requestRemote: async (_remote, call) => {
        if (call.method === 'GET') return { status: 200, body: { ok: true, seq: 1, requests: [req] } };
        if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
          cancels.push(record(call.body));
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
  let pendingList: Array<Record<string, unknown>> = [req];
  const cancels: Array<Record<string, unknown>> = [];
  const coord = createCuVaultFillCoordinator({
    config: fixture.config,
    vaultCli: { file: process.execPath, prefixArgs: [fixture.fakeVault] },
    sealerScript: SEALER_SCRIPT,
    auditFile: () => fixture.auditPath,
    log: message => fixture.logs.push(message),
    requestRemote: async (_remote, call) => {
      if (call.method === 'GET') return { status: 200, body: { ok: true, seq: 2, requests: pendingList } };
      if (call.method === 'POST' && call.path === '/api/cu/fill/cancel') {
        cancels.push(record(call.body));
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
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
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

  const coord = createCuVaultFillCoordinator({
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
