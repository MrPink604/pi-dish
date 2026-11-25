/**
 * Focused tests for Slice 1 computer-use broker client, cua-spacesd proxy
 * rewrites/headers/path traversal, WebSocket rcdp.v2 relay, busy 409 responses,
 * and human-epoch interactive socket revocation.
 *
 * Run with: npm test -- test/cu-viewer.test.js
 */
import test = require('node:test');
import type { TestContext } from 'node:test';
import assert = require('node:assert/strict');
import express = require('express');
import fs = require('node:fs');
import http = require('node:http');
import type { AddressInfo } from 'node:net';
import os = require('node:os');
import path = require('node:path');
import vm = require('node:vm');
import WebSocketLib = require('ws');
import { createAccessHandlers } from '../lib/access-handlers';
import {
  CU_FETCH_CREDS_JS,
  buildSpacesRequestHeaders,
  createCuHandlers,
  injectFetchCredsScript,
  rewriteSpacesCsp,
  sanitizeSpacesPath,
} from '../lib/cu-handlers';
import { createRelayHandlers } from '../lib/relay-handlers';
import * as fleetArtifacts from '../lib/fleet-artifacts';
import * as remoteHosts from '../lib/remote-hosts';
import type { DirectRemote } from '../lib/remote-hosts';
import { record } from './test-types.js';

const { WebSocket, WebSocketServer } = WebSocketLib;

async function listenTcp(t: TestContext, server: http.Server, beforeClose?: () => void): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  t.after(() => new Promise<void>(resolve => {
    beforeClose?.();
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  return (server.address() as AddressInfo).port;
}

async function listenUnix(t: TestContext, server: http.Server, beforeClose?: () => void): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-sock-'));
  const sock = path.join(dir, 'control.sock');
  await new Promise<void>(resolve => server.listen(sock, () => resolve()));
  t.after(async () => {
    await new Promise<void>(resolve => {
      beforeClose?.();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return sock;
}

interface FakeBrokerState {
  state: 'idle' | 'agent' | 'waiting_for_human' | 'human';
  epoch: number;
  lease: Record<string, unknown> | null;
  preempted: Record<string, unknown> | null;
  leaseToken: string | null;
  lastTakeoverBody: Record<string, unknown> | null;
  lastReleaseBody: Record<string, unknown> | null;
  sseClients: Set<http.ServerResponse>;
  emitEvent(eventName: string, payload: Record<string, unknown>): void;
}

async function startFakeBroker(t: TestContext): Promise<{ socketPath: string; broker: FakeBrokerState }> {
  const sseClients = new Set<http.ServerResponse>();
  const broker: FakeBrokerState = {
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
    emitEvent(eventName, payload) {
      const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of sseClients) client.write(frame);
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
        epoch: broker.epoch,
        lease: broker.lease,
        preempted: broker.preempted,
        viewer: { upstream: 'http://127.0.0.1:3211' },
        health: { broker: true, spacesd: true, driver: true, xvfb: true, desktop: true, chrome: true, driverWorkerRunning: true },
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders();
      sseClients.add(res);
      res.write(`event: hello\ndata: ${JSON.stringify({ state: broker.state, epoch: broker.epoch, lease: broker.lease, preempted: broker.preempted })}\n\n`);
      res.on('close', () => sseClients.delete(res));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/audit') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, entries: [{ ts: '2026-11-24T00:00:00Z', action: 'takeover' }] }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      } catch {}

      if (req.method === 'POST' && url.pathname === '/v1/viewer/ticket') {
        const mode = body.mode === 'interactive' ? 'interactive' : 'view-only';
        if (mode === 'interactive' && (broker.state !== 'human' || body.leaseToken !== broker.leaseToken)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'human_lease_required', message: 'Active human lease required' }));
          return;
        }
        const ticket = `${mode}-ticket-${++ticketSeq}`;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          epoch: broker.epoch,
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
        if (broker.state === 'human' && body.force !== true) {
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
        const ticket = `interactive-ticket-${++ticketSeq}`;
        const reply = {
          ok: true,
          state: 'human',
          epoch: broker.epoch,
          lease: broker.lease,
          leaseId,
          leaseToken: broker.leaseToken,
          token: broker.leaseToken,
          preempted: broker.preempted,
          driverDetached: body.detachDriver === true,
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
        if (broker.lease) broker.lease.expiresAt = expiresAt;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, state: broker.state, epoch: broker.epoch, lease: broker.lease, expiresAt }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/release') {
        broker.lastReleaseBody = body;
        if (broker.state === 'human' && body.force !== true && body.leaseToken !== broker.leaseToken) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'forbidden', message: 'Wrong lease token' }));
          return;
        }
        broker.epoch += 1;
        const handedBack = body.handBack === true && broker.preempted ? broker.preempted : null;
        broker.leaseToken = null;
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
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, state: 'agent', epoch: broker.epoch, lease: broker.lease, handedBackTo: handedBack }));
          broker.emitEvent('hand_back', { state: 'agent', epoch: broker.epoch, lease: broker.lease, preempted: null });
        } else {
          broker.state = 'idle';
          broker.lease = null;
          broker.preempted = null;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, state: 'idle', epoch: broker.epoch, released: true, handedBackTo: null }));
          broker.emitEvent('seat_idle', { state: 'idle', epoch: broker.epoch, lease: null, preempted: null });
        }
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  });

  const socketPath = await listenUnix(t, server, () => {
    for (const client of sseClients) { try { client.destroy(); } catch {} }
    sseClients.clear();
  });
  return { socketPath, broker };
}

interface FakeSpacesUpstream {
  port: number;
  requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }>;
  wsConnections: Array<{ url: string; protocol: string; headers: http.IncomingHttpHeaders; ws: WebSocketLib.WebSocket }>;
}

async function startFakeSpaces(t: TestContext): Promise<FakeSpacesUpstream> {
  const requests: FakeSpacesUpstream['requests'] = [];
  const wsConnections: FakeSpacesUpstream['wsConnections'] = [];
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('rcdp.v2') ? 'rcdp.v2' : false),
  });

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method || 'GET', url: req.url || '/', headers: { ...req.headers }, body });
      if (req.url === '/viewer/' || req.url === '/viewer/index.html') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
          'x-frame-options': 'DENY',
          'access-control-allow-origin': '*',
          'set-cookie': 'evil=1; Path=/',
          etag: '"viewer-v1"',
        });
        res.end('<!doctype html><html><head><title>Cua</title></head><body><script type="module" src="./viewer.js"></script></body></html>');
        return;
      }
      if (req.url === '/viewer') {
        res.writeHead(301, { location: '/viewer/' });
        res.end();
        return;
      }
      if (req.url?.startsWith('/cua.env.v1.')) {
        res.writeHead(200, {
          'content-type': 'application/grpc-web+proto',
          'grpc-status': '0',
          'grpc-message': 'ok',
          'access-control-allow-origin': '*',
        });
        // Echo exact binary body back so tests verify no jsonBody/compression corruption.
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

  const port = await listenTcp(t, server, () => {
    for (const conn of wsConnections) { try { conn.ws.terminate(); } catch {} }
    try { wss.close(); } catch {}
  });
  return { port, requests, wsConnections };
}

test('sanitizeSpacesPath accepts valid viewer/gRPC/media paths and rejects traversal and control chars', () => {
  assert.deepEqual(sanitizeSpacesPath('/'), { pathname: '/', search: '' });
  assert.deepEqual(sanitizeSpacesPath('/viewer/'), { pathname: '/viewer/', search: '' });
  assert.deepEqual(sanitizeSpacesPath('/viewer/viewer.js'), { pathname: '/viewer/viewer.js', search: '' });
  assert.deepEqual(sanitizeSpacesPath('/cua.env.v1.EnvService/GetState'), { pathname: '/cua.env.v1.EnvService/GetState', search: '' });
  assert.deepEqual(sanitizeSpacesPath('/media?ticket=abc_123'), { pathname: '/media', search: '?ticket=abc_123' });

  for (const bad of [
    '',
    'viewer/',
    '/../etc/passwd',
    '/viewer/../../secret',
    '/%2e%2e/secret',
    '/%252e%252e/secret',
    '/viewer/%2e/index.html',
    '/viewer/%2f/secret',
    '/viewer/a\\b',
    '//127.0.0.1/viewer/',
    '/viewer//viewer.js',
    '/viewer/\x00test',
    '/media?ticket=a\r\nb',
    '/%ZZ/bad',
  ]) {
    assert.equal(sanitizeSpacesPath(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('rewriteSpacesCsp only loosens frame-ancestors to self and keeps other directives strict', () => {
  const original = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-ancestors 'none'";
  assert.equal(
    rewriteSpacesCsp(original),
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-ancestors 'self'",
  );
  assert.equal(
    rewriteSpacesCsp("default-src 'self'; script-src 'self'"),
    "default-src 'self'; script-src 'self'; frame-ancestors 'self'",
  );
});

test('injectFetchCredsScript inserts static shim before viewer.js idempotently and runtime upgrades only same-origin omit', () => {
  const html = '<html><head><title>x</title></head><body><script type="module" src="./viewer.js"></script></body></html>';
  const injected = injectFetchCredsScript(html);
  assert.equal(
    injected,
    '<html><head><title>x</title></head><body><script src="./cu-fetch-creds.js"></script><script type="module" src="./viewer.js"></script></body></html>',
  );
  assert.equal(injectFetchCredsScript(injected), injected);

  const calls: Array<{ input: unknown; init: Record<string, unknown> | undefined }> = [];
  const context = vm.createContext({
    URL,
    location: { href: 'https://dish.example/hosts/cu-sandbox/api/cu/spaces/viewer/', origin: 'https://dish.example' },
    fetch: (input: unknown, init?: Record<string, unknown>) => {
      calls.push({ input, init });
      return Promise.resolve({ ok: true });
    },
  });
  context.globalThis = context;
  vm.runInContext(CU_FETCH_CREDS_JS, context);

  vm.runInContext(`
    fetch('../cua.env.v1.Env/Ping', { method: 'POST', credentials: 'omit' });
    fetch('https://dish.example/hosts/cu-sandbox/api/cu/spaces/cua.env.v1.Env/Ping', { credentials: 'omit' });
    fetch('https://other.example/api', { credentials: 'omit' });
    fetch('../cua.env.v1.Env/Other', { credentials: 'include' });
  `, context);

  assert.equal(calls[0].init?.credentials, 'same-origin');
  assert.equal(calls[1].init?.credentials, 'same-origin');
  assert.equal(calls[2].init?.credentials, 'omit', 'cross-origin fetch must keep credentials: omit');
  assert.equal(calls[3].init?.credentials, 'include');
});

test('buildSpacesRequestHeaders drops auth, cookies, proxy-identity and hop-by-hop headers', () => {
  const headers = buildSpacesRequestHeaders({
    host: 'dish.example',
    authorization: 'Bearer secret-peer-token',
    cookie: 'CF_Authorization=jwt-secret',
    'cf-access-jwt-assertion': 'jwt-secret',
    'x-forwarded-for': '1.2.3.4',
    origin: 'https://dish.example',
    referer: 'https://dish.example/',
    'x-pi-dish-private-unlock': 'unlock-secret',
    connection: 'keep-alive, x-cua-env-authorization',
    'content-type': 'application/grpc-web+proto',
    'x-grpc-web': '1',
    'accept-encoding': 'gzip, br',
  }, 3211, { viewerHtml: true });

  assert.equal(headers.host, '127.0.0.1:3211');
  assert.equal(headers['accept-encoding'], 'identity');
  assert.equal(headers['content-type'], 'application/grpc-web+proto');
  assert.equal(headers['x-grpc-web'], '1');
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, undefined);
  assert.equal(headers['cf-access-jwt-assertion'], undefined);
  assert.equal(headers['x-forwarded-for'], undefined);
  assert.equal(headers.origin, undefined);
  assert.equal(headers['x-pi-dish-private-unlock'], undefined);
  // Listed in incoming Connection header -> treated as hop-by-hop and dropped.
  assert.equal(headers['x-cua-env-authorization'], undefined);
});

test('feature gating: missing broker socket omits capability and returns 404 on HTTP and WS', async (t) => {
  const missingSock = path.join(os.tmpdir(), `pi-dish-cu-missing-${process.pid}-${Date.now()}.sock`);
  const cu = createCuHandlers({ upgradeAuthorized: () => true, socketPath: () => missingSock });
  t.after(() => cu.stop());

  const access = createAccessHandlers({
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
  app.post('/api/cu/takeover', cu.takeover);
  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!cu.upgrade(req, socket, head, url)) socket.destroy();
  });
  const port = await listenTcp(t, server);

  assert.equal((await fetch(`http://127.0.0.1:${port}/api/cu/status`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/cu/takeover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/cu/spaces/viewer/`)).status, 404);

  const wsStatus = await new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces/media?ticket=t1`, ['rcdp.v2']);
    ws.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode ?? 0); });
    ws.once('open', () => { ws.close(); reject(new Error('Expected 404, not open')); });
    ws.once('error', () => {});
  });
  assert.equal(wsStatus, 404);
});

test('viewer proxy rewrites CSP & HTML, scrubs headers, passes raw gRPC-Web binary, and enforces strict bearer auth', async (t) => {
  const { socketPath } = await startFakeBroker(t);
  const spaces = await startFakeSpaces(t);

  const prevToken = process.env.PI_DISH_TOKEN;
  process.env.PI_DISH_TOKEN = 'cu-peer-secret-token';
  t.after(() => {
    if (prevToken === undefined) delete process.env.PI_DISH_TOKEN;
    else process.env.PI_DISH_TOKEN = prevToken;
  });

  const access = createAccessHandlers({
    version: '1.0.0',
    readDishSettings: () => ({}),
    sttAvailable: () => false,
    usageLimitsAvailable: () => false,
    botsAvailable: () => false,
    knowledgeAvailable: () => false,
    computerUseAvailable: () => cu.available(),
  });
  const cu = createCuHandlers({
    upgradeAuthorized: req => access.bearerUpgradeAuthorized(req),
    socketPath: () => socketPath,
    spacesPort: spaces.port,
  });
  t.after(() => cu.stop());

  assert.equal(access.hostDescriptor().capabilities.computerUse, true);

  const app = express();
  app.use('/api/cu/spaces', access.requireBearer, cu.spacesProxy);
  app.use(access.compression);
  app.use(access.jsonBody);
  app.use('/api', access.apiGate);
  app.get('/api/cu/status', cu.status);
  app.get('/api/cu/stream', cu.stream);
  app.post('/api/auth/ticket', access.ticket);
  const server = http.createServer(app);
  const port = await listenTcp(t, server);
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer cu-peer-secret-token' };

  // Auth cannot be bypassed via /host, /ready, or OPTIONS on /api/cu/spaces.
  assert.equal((await fetch(`${base}/api/cu/spaces/host`)).status, 401);
  assert.equal((await fetch(`${base}/api/cu/spaces/ready`)).status, 401);
  assert.equal((await fetch(`${base}/api/cu/spaces/viewer/`, { method: 'OPTIONS' })).status, 401);
  assert.equal((await fetch(`${base}/api/cu/status`)).status, 401);

  // Viewer HTML: CSP frame-ancestors rewritten, X-Frame-Options tightened to SAMEORIGIN,
  // script injected before ./viewer.js, upstream CORS & Set-Cookie stripped, auth/cookie scrubbed.
  const viewerRes = await fetch(`${base}/api/cu/spaces/viewer/`, {
    headers: {
      ...auth,
      cookie: 'CF_Authorization=do-not-forward',
      'cf-access-jwt-assertion': 'do-not-forward',
      'x-forwarded-for': '203.0.113.5',
    },
  });
  assert.equal(viewerRes.status, 200);
  assert.equal(
    viewerRes.headers.get('content-security-policy'),
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
  );
  assert.equal(viewerRes.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(viewerRes.headers.get('access-control-allow-origin'), null);
  assert.equal(viewerRes.headers.get('set-cookie'), null);
  assert.equal(viewerRes.headers.get('cache-control'), 'no-store');
  const html = await viewerRes.text();
  assert.match(html, /<script src="\.\/cu-fetch-creds\.js"><\/script><script type="module" src="\.\/viewer\.js"><\/script>/);

  const upstreamViewerReq = spaces.requests[0];
  assert.equal(upstreamViewerReq.url, '/viewer/');
  assert.equal(upstreamViewerReq.headers.authorization, undefined);
  assert.equal(upstreamViewerReq.headers.cookie, undefined);
  assert.equal(upstreamViewerReq.headers['cf-access-jwt-assertion'], undefined);
  assert.equal(upstreamViewerReq.headers['x-forwarded-for'], undefined);

  // Static cu-fetch-creds.js served directly without hitting upstream.
  const countBeforeShim = spaces.requests.length;
  const shimRes = await fetch(`${base}/api/cu/spaces/viewer/cu-fetch-creds.js`, { headers: auth });
  assert.equal(shimRes.status, 200);
  assert.match(shimRes.headers.get('content-type') || '', /application\/javascript/);
  assert.equal(shimRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await shimRes.text(), CU_FETCH_CREDS_JS);
  assert.equal(spaces.requests.length, countBeforeShim);

  // Relative redirect on /viewer -> viewer/ so subpath base is preserved.
  const redirRes = await fetch(`${base}/api/cu/spaces/viewer`, { headers: auth, redirect: 'manual' });
  assert.equal(redirRes.status, 301);
  assert.equal(redirRes.headers.get('location'), 'viewer/');

  // Binary gRPC-Web POST passes untouched before jsonBody/compression and preserves grpc-status.
  const binaryPayload = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x04, 0xde, 0xad, 0xbe, 0xef]);
  const grpcRes = await fetch(`${base}/api/cu/spaces/cua.env.v1.EnvService/Ping`, {
    method: 'POST',
    headers: {
      ...auth,
      'content-type': 'application/grpc-web+proto',
      'x-grpc-web': '1',
      'x-cua-env-authorization': 'Bearer view-only-ticket-1',
    },
    body: binaryPayload,
  });
  assert.equal(grpcRes.status, 200);
  assert.equal(grpcRes.headers.get('grpc-status'), '0');
  assert.equal(grpcRes.headers.get('grpc-message'), 'ok');
  assert.equal(grpcRes.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(Buffer.from(await grpcRes.arrayBuffer()), binaryPayload);
  const grpcUpstream = spaces.requests.at(-1)!;
  assert.equal(grpcUpstream.headers['x-cua-env-authorization'], 'Bearer view-only-ticket-1');
  assert.equal(grpcUpstream.headers.authorization, undefined);

  // Path traversal rejected with 400 without hitting upstream (raw HTTP request so URL parser does not pre-collapse).
  const countBeforeTraversal = spaces.requests.length;
  for (const rawPath of ['/api/cu/spaces/%2e%2e/secret', '/api/cu/spaces/viewer/../secret', '/api/cu/spaces/%252e%252e/secret']) {
    const travStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: rawPath, headers: auth }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(travStatus, 400, `expected 400 for ${rawPath}`);
  }
  assert.equal(spaces.requests.length, countBeforeTraversal);

  // Existing stream ticket unlocks /api/cu/stream (SSE, identity encoded).
  const ticketRes = await fetch(`${base}/api/auth/ticket`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ purpose: 'stream' }),
  });
  const ticketBody = record(await ticketRes.json());
  assert.equal(typeof ticketBody.ticket, 'string');
  const controller = new AbortController();
  const sseRes = await fetch(`${base}/api/cu/stream?ticket=${encodeURIComponent(ticketBody.ticket as string)}`, {
    headers: { 'accept-encoding': 'gzip' },
    signal: controller.signal,
  });
  assert.equal(sseRes.status, 200);
  assert.equal(sseRes.headers.get('content-encoding'), null, 'SSE must stay uncompressed');
  const reader = sseRes.body!.getReader();
  const firstChunk = new TextDecoder().decode((await reader.read()).value);
  controller.abort();
  assert.match(firstChunk, /event: hello/);
});

test('broker takeover, busy 409 with holder, hub WS rcdp.v2 relay, and human-epoch socket revocation', async (t) => {
  const { socketPath, broker } = await startFakeBroker(t);
  const spaces = await startFakeSpaces(t);

  // Guest server with peer bearer auth
  const prevToken = process.env.PI_DISH_TOKEN;
  process.env.PI_DISH_TOKEN = 'guest-peer-token';
  const guestAccess = createAccessHandlers({
    version: '1.0.0',
    readDishSettings: () => ({}),
    sttAvailable: () => false,
    usageLimitsAvailable: () => false,
    botsAvailable: () => false,
    knowledgeAvailable: () => false,
    computerUseAvailable: () => cu.available(),
  });
  if (prevToken === undefined) delete process.env.PI_DISH_TOKEN;
  else process.env.PI_DISH_TOKEN = prevToken;

  const cu = createCuHandlers({
    upgradeAuthorized: req => guestAccess.bearerUpgradeAuthorized(req),
    socketPath: () => socketPath,
    spacesPort: spaces.port,
    wsPingIntervalMs: 0,
  });
  t.after(() => cu.stop());

  const guestApp = express();
  guestApp.use('/api/cu/spaces', guestAccess.requireBearer, cu.spacesProxy);
  guestApp.use(guestAccess.compression);
  guestApp.use(guestAccess.jsonBody);
  guestApp.use('/api', guestAccess.apiGate);
  guestApp.get('/api/cu/status', cu.status);
  guestApp.get('/api/cu/stream', cu.stream);
  guestApp.post('/api/cu/takeover', cu.takeover);
  guestApp.post('/api/cu/heartbeat', cu.heartbeat);
  guestApp.post('/api/cu/release', cu.release);
  guestApp.post('/api/cu/viewer/ticket', cu.viewerTicket);
  guestApp.get('/api/cu/audit', cu.audit);
  const guestServer = http.createServer(guestApp);
  guestServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!cu.upgrade(req, socket, head, url)) socket.destroy();
  });
  const guestPort = await listenTcp(t, guestServer);

  // Hub server relaying /hosts/cu-sandbox/api/* and WS upgrades to guest
  const remote: DirectRemote = {
    name: 'cu-sandbox',
    kind: 'direct',
    origin: `http://127.0.0.1:${guestPort}`,
    token: 'guest-peer-token',
  };
  t.mock.method(remoteHosts, 'getRemote', (candidate: unknown) => (candidate === 'cu-sandbox' ? remote : null));
  t.mock.method(remoteHosts, 'reachability', () => null);
  const relay = createRelayHandlers({
    fleetArtifacts,
    localPageExists: () => false,
    publicBaseUrl: () => undefined,
    hostDescriptor: () => ({ hostId: '00000000-0000-4000-8000-000000000099', label: 'hub', version: '1.0.0', capabilities: {} }),
    upgradeAuthorized: () => true,
  });
  const hubApp = express();
  hubApp.use('/hosts/:name/api', relay.rawApi);
  const hubServer = http.createServer(hubApp);
  hubServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!relay.upgrade(req, socket, head, url)) socket.destroy();
  });
  const hubPort = await listenTcp(t, hubServer);
  const hubBase = `http://127.0.0.1:${hubPort}/hosts/cu-sandbox`;

  // 1. Status + view-only ticket through hub relay
  const statusRes = await fetch(`${hubBase}/api/cu/status`);
  assert.equal(statusRes.status, 200);
  const statusJson = record(await statusRes.json());
  assert.equal(statusJson.state, 'agent');

  const viewTicketRes = await fetch(`${hubBase}/api/cu/viewer/ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'view-only' }),
  });
  assert.equal(viewTicketRes.status, 200);
  const viewTicketJson = record(await viewTicketRes.json());
  const viewTicket = viewTicketJson.ticket as string;
  assert.equal(viewTicketJson.spacesPath, `/api/cu/spaces/viewer/#ticket=${viewTicket}`);

  // 2. Take Over preempts agent with default 10-min human lease (600s)
  const takeRes = await fetch(`${hubBase}/api/cu/takeover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'phone-browser' }),
  });
  assert.equal(takeRes.status, 200);
  const takeJson = record(await takeRes.json());
  assert.equal(takeJson.state, 'human');
  assert.equal(broker.lastTakeoverBody?.ttlSec, 600);
  const leaseId = takeJson.leaseId as string;
  const leaseToken = takeJson.leaseToken as string;
  const interactiveTicket = record(takeJson.viewer).ticket as string;

  // 3. Second takeover without force returns 409 busy with holder and clear error
  const busyRes = await fetch(`${hubBase}/api/cu/takeover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'second-tab' }),
  });
  assert.equal(busyRes.status, 409);
  const busyJson = record(await busyRes.json());
  assert.equal(busyJson.code, 'seat_busy');
  assert.equal(record(busyJson.holder).label, 'phone-browser');
  assert.equal(typeof busyJson.error, 'string');

  // 4. Open BOTH view-only and interactive /media WebSockets through the hub relay with rcdp.v2
  const openMediaWs = (ticket: string) => new Promise<WebSocketLib.WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/cu/spaces/media?ticket=${encodeURIComponent(ticket)}`, ['rcdp.v2']);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
  const viewWs = await openMediaWs(viewTicket);
  const interactiveWs = await openMediaWs(interactiveTicket);
  t.after(() => { try { viewWs.terminate(); } catch {} try { interactiveWs.terminate(); } catch {} });

  assert.equal(viewWs.protocol, 'rcdp.v2');
  assert.equal(interactiveWs.protocol, 'rcdp.v2');

  // Verify bidirectional frame relay
  const echoed = new Promise<string>(resolve => interactiveWs.once('message', data => resolve(data.toString())));
  interactiveWs.send('ping-rcdp');
  assert.equal(await echoed, 'ping-rcdp');

  // Hub relay rejects traversal WS upgrade (raw HTTP upgrade so URL parser does not pre-collapse).
  for (const rawPath of ['/hosts/cu-sandbox/api/cu/spaces/viewer/../media?ticket=t', '/hosts/cu-sandbox/api/cu/spaces/%252e%252e/media?ticket=t']) {
    const badWsStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: hubPort,
        path: rawPath,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
          'Sec-WebSocket-Protocol': 'rcdp.v2',
        },
      });
      req.once('response', (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.once('upgrade', (_res, sock) => { sock.destroy(); resolve(101); });
      req.once('error', reject);
      req.end();
    });
    assert.equal(badWsStatus, 400, `expected 400 for WS ${rawPath}`);
  }

  // 5. Hand back releases human lease -> immediately closes interactive /media WS while keeping view-only WS open
  const interactiveClosed = new Promise<number>(resolve => interactiveWs.once('close', code => resolve(code)));
  const relRes = await fetch(`${hubBase}/api/cu/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ leaseId, leaseToken, handBack: true }),
  });
  assert.equal(relRes.status, 200);
  const relJson = record(await relRes.json());
  assert.equal(relJson.state, 'agent');
  assert.equal(await interactiveClosed, 4001);
  assert.equal(viewWs.readyState, WebSocket.OPEN, 'view-only /media socket must remain open');

  // Reconnecting with the revoked interactive ticket is rejected with 403, and gRPC-Web with it is 403.
  const revokedWsStatus = await new Promise<number>(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/cu/spaces/media?ticket=${encodeURIComponent(interactiveTicket)}`, ['rcdp.v2']);
    ws.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode ?? 0); });
    ws.once('error', () => {});
  });
  assert.equal(revokedWsStatus, 403);

  const revokedGrpc = await fetch(`${hubBase}/api/cu/spaces/cua.env.v1.EnvService/Input`, {
    method: 'POST',
    headers: {
      'content-type': 'application/grpc-web+proto',
      'x-cua-env-authorization': `Bearer ${interactiveTicket}`,
    },
    body: Buffer.from([1, 2, 3]),
  });
  assert.equal(revokedGrpc.status, 403);

  // 6. Out-of-band broker SSE epoch change (e.g. TTL expiry / cu-seat release) also closes interactive WS immediately
  const take2Res = await fetch(`${hubBase}/api/cu/takeover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'phone-browser-2' }),
  });
  assert.equal(take2Res.status, 200);
  const take2Json = record(await take2Res.json());
  const interactiveTicket2 = record(take2Json.viewer).ticket as string;
  const interactiveWs2 = await openMediaWs(interactiveTicket2);
  t.after(() => { try { interactiveWs2.terminate(); } catch {} });

  // Wait briefly for the internal epoch watcher to subscribe to /v1/events.
  const deadline = Date.now() + 2000;
  while (broker.sseClients.size === 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 20));
  }
  assert.ok(broker.sseClients.size >= 1, 'guest epoch watcher should subscribe to /v1/events');

  const closedBySse = new Promise<number>(resolve => interactiveWs2.once('close', code => resolve(code)));
  broker.state = 'idle';
  broker.epoch += 1;
  broker.lease = null;
  broker.emitEvent('seat_idle', { state: 'idle', epoch: broker.epoch, lease: null, preempted: null });
  assert.equal(await closedBySse, 4001);
  assert.equal(viewWs.readyState, WebSocket.OPEN);
  viewWs.terminate();
  cu.stop();
});

export {};
