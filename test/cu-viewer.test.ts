/**
 * Focused tests for Slice 1 computer-use broker client, vendored cua-spacesd
 * v0.17.7 viewer serving, hub/guest Spaces route & header allowlisting, CSRF
 * ingress guards, WS handshake validation/backpressure/ping-pong eviction,
 * fail-closed broker-epoch revocation with distinct viewer & media tickets,
 * watcher rearming, and bounded SSE error/event buffers.
 *
 * Run with: npm test -- test/cu-viewer.test.js
 */
import test = require('node:test');
import type { TestContext } from 'node:test';
import assert = require('node:assert/strict');
import express = require('express');
import fs = require('node:fs');
import http = require('node:http');
import net = require('node:net');
import type { AddressInfo } from 'node:net';
import os = require('node:os');
import path = require('node:path');
import vm = require('node:vm');
import WebSocketLib = require('ws');
import { createAccessHandlers } from '../lib/access-handlers';
import {
  CU_FETCH_CREDS_JS,
  CU_VIEWER_CSP,
  buildSpacesRequestHeaders,
  classifySpacesHttpRoute,
  createCuHandlers,
  injectFetchCredsScript,
  isAllowedSpacesWsPath,
  sanitizeSpacesPath,
} from '../lib/cu-handlers';
import {
  buildHubCuReadHeaders,
  buildHubCuSpacesHttpHeaders,
  buildHubCuWsHeaders,
  createRelayHandlers,
  namesCuRoute,
} from '../lib/relay-handlers';
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

async function listenUnix(t: TestContext, server: http.Server, beforeClose?: () => void, fixedPath?: string): Promise<string> {
  const dir = fixedPath ? path.dirname(fixedPath) : fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-sock-'));
  const sock = fixedPath ?? path.join(dir, 'control.sock');
  try { fs.unlinkSync(sock); } catch {}
  await new Promise<void>(resolve => server.listen(sock, () => resolve()));
  t.after(async () => {
    await new Promise<void>(resolve => {
      beforeClose?.();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
    if (!fixedPath) fs.rmSync(dir, { recursive: true, force: true });
    else try { fs.unlinkSync(sock); } catch {}
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
  eventsMode: 'normal' | 'error-huge' | 'event-huge';
  overrideStatusEpoch: number | null;
  overrideTicketEpoch: number | null;
  emitEvent(eventName: string, payload: Record<string, unknown>): void;
  dropWatchers(): void;
  closeServer(): Promise<void>;
}

async function startFakeBroker(t: TestContext, fixedSocketPath?: string): Promise<{ socketPath: string; broker: FakeBrokerState }> {
  const sseClients = new Set<http.ServerResponse>();
  let serverClosed = false;
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
    eventsMode: 'normal',
    overrideStatusEpoch: null,
    overrideTicketEpoch: null,
    emitEvent(eventName, payload) {
      const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of sseClients) client.write(frame);
    },
    dropWatchers() {
      for (const client of [...sseClients]) {
        try { client.destroy(); } catch {}
      }
      sseClients.clear();
    },
    closeServer: async () => {
      if (serverClosed) return;
      serverClosed = true;
      broker.dropWatchers();
      await new Promise<void>(resolve => {
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
        if (broker.state === 'human' && body.leaseToken !== broker.leaseToken) {
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
    broker.dropWatchers();
  }, fixedSocketPath);
  return { socketPath, broker };
}

interface FakeSpacesUpstream {
  port: number;
  requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }>;
  wsConnections: Array<{ url: string; protocol: string; headers: http.IncomingHttpHeaders; ws: WebSocketLib.WebSocket }>;
  holdClipboardRequests: boolean;
  heldResponses: Set<http.ServerResponse>;
  clipboardRequestSeen: Promise<void>;
  resetClipboardWaiter(): void;
}

async function startFakeSpaces(t: TestContext): Promise<FakeSpacesUpstream> {
  const requests: FakeSpacesUpstream['requests'] = [];
  const wsConnections: FakeSpacesUpstream['wsConnections'] = [];
  const heldResponses = new Set<http.ServerResponse>();
  let resolveClipboard!: () => void;
  let clipboardRequestSeen = new Promise<void>(resolve => { resolveClipboard = resolve; });
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('rcdp.v2') ? 'rcdp.v2' : false),
  });

  const fake: FakeSpacesUpstream = {
    port: 0,
    requests,
    wsConnections,
    holdClipboardRequests: false,
    heldResponses,
    clipboardRequestSeen,
    resetClipboardWaiter() {
      fake.clipboardRequestSeen = new Promise<void>(resolve => { resolveClipboard = resolve; });
    },
  };

  let mediaSeq = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method || 'GET', url: req.url || '/', headers: { ...req.headers }, body });
      if (req.url === '/cua.env.v1.StreamService/OpenMedia') {
        // Real cua-spacesd mints a distinct media-session ticket returned in wsPath.
        const mediaTicket = `distinct-media-ticket-${++mediaSeq}`;
        res.writeHead(200, {
          'content-type': 'application/grpc-web+proto',
          'grpc-status': '0',
          'x-test-media-ws-path': `/media?ticket=${mediaTicket}`,
        });
        res.end(body);
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
    for (const r of heldResponses) { try { r.destroy(); } catch {} }
    heldResponses.clear();
    for (const conn of wsConnections) { try { conn.ws.terminate(); } catch {} }
    try { wss.close(); } catch {}
  });
  return fake;
}

function rawHttpUpgrade(port: number, rawPath: string, headers: Record<string, string>): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, headers });
    req.once('response', (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.once('upgrade', (_res, sock) => { sock.destroy(); resolve(101); });
    req.once('error', reject);
    req.end();
  });
}

test('sanitizeSpacesPath and Spaces route allowlists block traversal, file handlers, and unknown services', () => {
  assert.deepEqual(sanitizeSpacesPath('/'), { pathname: '/', search: '' });
  assert.deepEqual(sanitizeSpacesPath('/viewer/'), { pathname: '/viewer/', search: '' });
  assert.deepEqual(sanitizeSpacesPath('/cua.env.v1.StreamService/OpenMedia'), { pathname: '/cua.env.v1.StreamService/OpenMedia', search: '' });
  assert.deepEqual(sanitizeSpacesPath('/media?ticket=abc_123'), { pathname: '/media', search: '?ticket=abc_123' });

  for (const bad of [
    '', 'viewer/', '/../etc/passwd', '/viewer/../../secret', '/%2e%2e/secret',
    '/%252e%252e/secret', '/viewer/%2e/index.html', '/viewer/%2f/secret',
    '/viewer/a\\b', '//127.0.0.1/viewer/', '/viewer//viewer.js', '/viewer/\x00test',
    '/media?ticket=a\r\nb', '/%ZZ/bad',
  ]) {
    assert.equal(sanitizeSpacesPath(bad), null, `should reject ${JSON.stringify(bad)}`);
  }

  assert.equal(classifySpacesHttpRoute('/cua.env.v1.SystemService/GetCapabilities'), 'view');
  assert.equal(classifySpacesHttpRoute('/cua.env.v1.StreamService/OpenMedia'), 'view');
  assert.equal(classifySpacesHttpRoute('/cua.env.v1.PresenceService/Join'), 'view');
  assert.equal(classifySpacesHttpRoute('/cua.env.v1.ComputerService/GetClipboard'), 'interactive');
  assert.equal(classifySpacesHttpRoute('/cua.env.v1.ComputerService/SetClipboard'), 'interactive');

  for (const blocked of [
    '/files', '/files/download.html', '/share/token', '/viewer/', '/viewer/viewer.js',
    '/cua.env.v1.FilesystemService/ReadFile', '/cua.env.v1.ProcessService/StartProcess',
    '/cua.env.v1.SystemService/CreateViewerTicket', '/cua.env.v1.ComputerService/Pointer',
  ]) {
    assert.equal(classifySpacesHttpRoute(blocked), null, `should block HTTP route ${blocked}`);
  }

  assert.equal(isAllowedSpacesWsPath('/media'), true);
  assert.equal(isAllowedSpacesWsPath('/viewer/'), false);
  assert.equal(isAllowedSpacesWsPath('/files'), false);

  assert.equal(namesCuRoute('/cu/takeover'), true);
  assert.equal(namesCuRoute('/%63u/takeover'), true);
  assert.equal(namesCuRoute('/CU/spaces/files'), true);
  assert.equal(namesCuRoute('/sessions/123'), false);
});

test('injectFetchCredsScript inserts static shim idempotently and upgrades only same-origin omit', () => {
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
  const dirty: http.IncomingHttpHeaders = {
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

  const guestHeaders = buildSpacesRequestHeaders(dirty, 3211);
  assert.equal(guestHeaders.host, '127.0.0.1:3211');
  assert.equal(guestHeaders['accept-encoding'], 'identity');
  assert.equal(guestHeaders['content-type'], 'application/grpc-web+proto');
  assert.equal(guestHeaders['x-grpc-web'], '1');
  for (const forbidden of ['authorization', 'cookie', 'cf-access-jwt-assertion', 'cf-access-authenticated-user-email', 'x-forwarded-for', 'origin', 'referer', 'x-pi-dish-private-unlock', 'x-cua-env-authorization', 'x-custom-hop']) {
    assert.equal(guestHeaders[forbidden], undefined, `guest must drop ${forbidden}`);
  }

  const hubRead = buildHubCuReadHeaders(dirty);
  assert.equal(hubRead.accept, 'application/json');
  assert.equal(hubRead['accept-encoding'], 'identity');
  for (const forbidden of ['authorization', 'cookie', 'cf-access-jwt-assertion', 'cf-access-authenticated-user-email', 'origin', 'x-custom-hop']) {
    assert.equal(hubRead[forbidden], undefined, `hubRead must drop ${forbidden}`);
  }

  const hubSpaces = buildHubCuSpacesHttpHeaders(dirty);
  assert.equal(hubSpaces['x-grpc-web'], '1');
  assert.equal(hubSpaces['x-cua-env-authorization'], undefined, 'Connection-nominated header dropped before Connection');
  for (const forbidden of ['authorization', 'cookie', 'cf-access-jwt-assertion', 'origin', 'x-custom-hop']) {
    assert.equal(hubSpaces[forbidden], undefined, `hubSpaces must drop ${forbidden}`);
  }

  const hubWs = buildHubCuWsHeaders(dirty);
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
  app.post('/api/cu/takeover', access.cuMutationGuard, cu.takeover);
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

test('vendored viewer assets served from hub & guest without contacting spacesd; non-allowlisted routes & files 404; hub scrubs headers', async (t) => {
  const { socketPath } = await startFakeBroker(t);
  const spaces = await startFakeSpaces(t);

  const prevToken = process.env.PI_DISH_TOKEN;
  process.env.PI_DISH_TOKEN = 'cu-peer-secret-token';
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

  const guestHeadersSeen: Array<{ path: string; headers: http.IncomingHttpHeaders }> = [];
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
    if (!cu.upgrade(req, socket, head, url)) socket.destroy();
  });
  const guestPort = await listenTcp(t, guestServer);

  const remote: DirectRemote = {
    name: 'cu-sandbox',
    kind: 'direct',
    origin: `http://127.0.0.1:${guestPort}`,
    token: 'cu-peer-secret-token',
  };
  t.mock.method(remoteHosts, 'getRemote', (candidate: unknown) => (candidate === 'cu-sandbox' ? remote : null));
  t.mock.method(remoteHosts, 'reachability', () => null);
  const hubAccess = createAccessHandlers({
    version: '1.0.0',
    readDishSettings: () => ({}),
    sttAvailable: () => false,
    usageLimitsAvailable: () => false,
    botsAvailable: () => false,
    knowledgeAvailable: () => false,
  });
  const relay = createRelayHandlers({
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
    if (!relay.upgrade(req, socket, head, url)) socket.destroy();
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
  assert.equal(viewerRes.headers.get('content-security-policy'), CU_VIEWER_CSP);
  assert.equal(viewerRes.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(viewerRes.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(viewerRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(viewerRes.headers.get('cache-control'), 'no-store');
  const html = await viewerRes.text();
  assert.match(html, /<script src="\.\/cu-fetch-creds\.js"><\/script><script type="module" crossorigin src="\.\/viewer\.js"><\/script>/);

  for (const asset of ['viewer.js', 'index.css', 'audioWorklet.js', 'captureWorklet.js', 'cu-fetch-creds.js']) {
    const assetRes = await fetch(`${hubBase}/api/cu/spaces/viewer/${asset}`);
    assert.equal(assetRes.status, 200, `hub should serve vendored ${asset}`);
    if (asset === 'cu-fetch-creds.js') assert.equal(await assetRes.text(), CU_FETCH_CREDS_JS);
    else assert.ok((await assetRes.arrayBuffer()).byteLength > 100);
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
  const encodedStatus = await new Promise<number>((resolve, reject) => {
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
  const grpcRes = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
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
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(binaryPayload);
  });
  assert.equal(grpcRes.status, 200);
  assert.equal(grpcRes.headers['grpc-status'], '0');
  assert.deepEqual(grpcRes.body, binaryPayload);

  const guestGrpc = guestHeadersSeen.at(-1)!;
  assert.equal(guestGrpc.headers.authorization, 'Bearer cu-peer-secret-token');
  assert.equal(guestGrpc.headers.cookie, undefined, 'hub must not forward Cookie to guest');
  assert.equal(guestGrpc.headers['cf-access-jwt-assertion'], undefined, 'hub must not forward Cf-Access-* to guest');
  assert.equal(guestGrpc.headers['cf-access-authenticated-user-email'], undefined);
  assert.equal(guestGrpc.headers.origin, undefined);
  assert.equal(guestGrpc.headers['x-custom-hop'], undefined);
  assert.equal(guestGrpc.headers['x-cua-env-authorization'], 'Bearer view-only-ticket-1');

  // Hub WS header scrubbing: cookies and Cf-Access-* never reach guest; peer bearer attached separately.
  const ws = await new Promise<WebSocketLib.WebSocket>((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${hubPort}/hosts/cu-sandbox/api/cu/spaces/media?ticket=m1`, ['rcdp.v2'], {
      headers: {
        cookie: 'CF_Authorization=ws-cookie-secret',
        'cf-access-jwt-assertion': 'ws-jwt-secret',
        origin: `http://127.0.0.1:${hubPort}`,
      },
    });
    sock.once('open', () => resolve(sock));
    sock.once('error', reject);
  });
  t.after(() => { try { ws.terminate(); } catch {} });
  const guestWs = guestHeadersSeen.find(entry => entry.path.startsWith('WS '))!;
  assert.equal(guestWs.headers.authorization, 'Bearer cu-peer-secret-token');
  assert.equal(guestWs.headers.cookie, undefined, 'hub WS must not forward Cookie');
  assert.equal(guestWs.headers['cf-access-jwt-assertion'], undefined, 'hub WS must not forward Cf-Access-*');
  assert.equal(guestWs.headers.origin, undefined);
});

test('CSRF protection rejects cross-origin, Origin: null, bad Sec-Fetch-Site, non-JSON, and non-object bodies at hub ingress and direct routes', async (t) => {
  const { socketPath } = await startFakeBroker(t);
  const spaces = await startFakeSpaces(t);

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

  const remote: DirectRemote = { name: 'cu-sandbox', kind: 'direct', origin: `http://127.0.0.1:${guestPort}`, token: null };
  t.mock.method(remoteHosts, 'getRemote', (candidate: unknown) => (candidate === 'cu-sandbox' ? remote : null));
  t.mock.method(remoteHosts, 'reachability', () => null);
  const relay = createRelayHandlers({
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
  ] as const) {
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

test('fail-closed revocation: distinct viewer vs OpenMedia media tickets close on hand back, aborts in-flight interactive HTTP, and cuts force/detachDriver', async (t) => {
  const { socketPath, broker } = await startFakeBroker(t);
  const spaces = await startFakeSpaces(t);

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
    if (!cu.upgrade(req, socket, head, url)) socket.destroy();
  });
  const port = await listenTcp(t, server);
  const base = `http://127.0.0.1:${port}`;

  // Wait briefly for the initial broker hello snapshot, then verify interactive
  // clipboard RPC is refused with 403 while the agent holds the seat.
  await new Promise(resolve => setTimeout(resolve, 30));
  const preClip = await fetch(`${base}/api/cu/spaces/cua.env.v1.ComputerService/SetClipboard`, {
    method: 'POST',
    headers: { 'content-type': 'application/grpc-web+proto' },
    body: Buffer.from([1, 2, 3]),
  });
  assert.equal(preClip.status, 403);

  // Take Over — attempt to send cut fields force & detachDriver; verify server strips them.
  const takeRes = await fetch(`${base}/api/cu/takeover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'phone', force: true, detachDriver: true }),
  });
  assert.equal(takeRes.status, 200);
  assert.equal(broker.lastTakeoverBody?.force, undefined, 'force must not be forwarded');
  assert.equal(broker.lastTakeoverBody?.detachDriver, undefined, 'detachDriver must not be forwarded');
  const takeJson = record(await takeRes.json());
  const leaseId = takeJson.leaseId as string;
  const leaseToken = takeJson.leaseToken as string;
  const viewerTicket = record(takeJson.viewer).ticket as string;

  // Real cua-spacesd 0.17.7 flow: exchange viewerTicket at StreamService.OpenMedia for a DISTINCT media ticket!
  const openMediaRes = await fetch(`${base}/api/cu/spaces/cua.env.v1.StreamService/OpenMedia`, {
    method: 'POST',
    headers: {
      'content-type': 'application/grpc-web+proto',
      'x-cua-env-authorization': `Bearer ${viewerTicket}`,
    },
    body: Buffer.from([0x00, 0x01]),
  });
  assert.equal(openMediaRes.status, 200);
  const wsPath = openMediaRes.headers.get('x-test-media-ws-path')!;
  assert.match(wsPath, /^\/media\?ticket=distinct-media-ticket-/);
  assert.equal(wsPath.includes(viewerTicket), false, 'media ticket must be distinct from viewer ticket');

  // Open the interactive /media WS independently of any iframe using the DISTINCT media ticket.
  const interactiveWs = await new Promise<WebSocketLib.WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces${wsPath}`, ['rcdp.v2']);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
  t.after(() => { try { interactiveWs.terminate(); } catch {} });
  assert.equal(interactiveWs.protocol, 'rcdp.v2');

  // Hold an in-flight interactive gRPC-Web HTTP request open at spacesd.
  spaces.holdClipboardRequests = true;
  const inFlightClipPromise = fetch(`${base}/api/cu/spaces/cua.env.v1.ComputerService/SetClipboard`, {
    method: 'POST',
    headers: { 'content-type': 'application/grpc-web+proto', 'x-cua-env-authorization': `Bearer ${viewerTicket}` },
    body: Buffer.from([9, 9]),
  });
  await spaces.clipboardRequestSeen;

  // Hand Back (even if client tries handBack: false or force: true, server always sends handBack: true and no force).
  const wsClosed = new Promise<number>(resolve => interactiveWs.once('close', code => resolve(code)));
  const relRes = await fetch(`${base}/api/cu/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ leaseId, leaseToken, handBack: false, force: true }),
  });
  assert.equal(relRes.status, 200);
  assert.equal(broker.lastReleaseBody?.handBack, true, 'Hand Back must always send handBack: true');
  assert.equal(broker.lastReleaseBody?.force, undefined, 'force must not be forwarded');

  // Both the distinct-ticket /media WS AND the in-flight interactive HTTP request are terminated immediately!
  assert.equal(await wsClosed, 4001);
  const inFlightClipRes = await inFlightClipPromise;
  assert.equal(inFlightClipRes.status, 403);

  // View-only clients can cleanly reconnect /media after hand back, while interactive clipboard stays refused.
  const viewWs = await new Promise<WebSocketLib.WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces/media?ticket=view-reconnect-1`, ['rcdp.v2']);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
  t.after(() => { try { viewWs.terminate(); } catch {} });
  assert.equal(viewWs.readyState, WebSocket.OPEN);

  spaces.holdClipboardRequests = false;
  const postClip = await fetch(`${base}/api/cu/spaces/cua.env.v1.ComputerService/SetClipboard`, {
    method: 'POST',
    headers: { 'content-type': 'application/grpc-web+proto' },
    body: Buffer.from([1]),
  });
  assert.equal(postClip.status, 403);
});

test('broker watch loss fails closed, closes /media WS, ignores stale epoch, and rearms after brief socket absence', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-rearm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sockPath = path.join(dir, 'control.sock');

  const first = await startFakeBroker(t, sockPath);
  const spaces = await startFakeSpaces(t);

  const cu = createCuHandlers({
    upgradeAuthorized: () => true,
    socketPath: () => sockPath,
    spacesPort: spaces.port,
    wsPingIntervalMs: 0,
    watchRetryMs: 40,
  });
  t.after(() => cu.stop());

  const access = createAccessHandlers({
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
    if (!cu.upgrade(req, socket, head, url)) socket.destroy();
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
  const takeJson = record(await takeRes.json());
  const leaseId = takeJson.leaseId as string;
  const leaseToken = takeJson.leaseToken as string;

  // Stale epoch viewer/ticket response (epoch 2 < current epoch 4) is rejected with 409.
  first.broker.overrideTicketEpoch = 2;
  const staleTicketRes = await fetch(`${base}/api/cu/viewer/ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'interactive', leaseId, leaseToken }),
  });
  assert.equal(staleTicketRes.status, 409);
  first.broker.overrideTicketEpoch = null;

  const mediaWs = await new Promise<WebSocketLib.WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces/media?ticket=live-media`, ['rcdp.v2']);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
  t.after(() => { try { mediaWs.terminate(); } catch {} });

  // Shut down the first broker AND unlink the socket -> watch lost -> /media WS immediately closed!
  const closedOnLoss = new Promise<number>(resolve => mediaWs.once('close', code => resolve(code)));
  await first.broker.closeServer();
  try { fs.unlinkSync(sockPath); } catch {}
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
    const attempt = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces/media?ticket=after-rearm`, ['rcdp.v2']);
      ws.once('open', () => { ws.close(); resolve(true); });
      ws.once('error', () => resolve(false));
      ws.once('unexpected-response', (_r, res) => { res.resume(); resolve(false); });
    });
    if (attempt) { reconnected = true; break; }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.equal(reconnected, true, 'watcher must rearm after brief socket absence and accept view-only media again');

  // Fresh hello reported state=agent, so interactive clipboard stays refused (403).
  const clipAfterRearm = await fetch(`${base}/api/cu/spaces/cua.env.v1.ComputerService/SetClipboard`, {
    method: 'POST',
    headers: { 'content-type': 'application/grpc-web+proto' },
    body: Buffer.from([1]),
  });
  assert.equal(clipAfterRearm.status, 403);
});

test('WS handshake validation rejects malformed/duplicate protocols without crashing, backpressure ceiling & missed pong terminate pairs', async (t) => {
  const { socketPath } = await startFakeBroker(t);
  const spaces = await startFakeSpaces(t);

  const cu = createCuHandlers({
    upgradeAuthorized: () => true,
    socketPath: () => socketPath,
    spacesPort: spaces.port,
    wsPingIntervalMs: 0,
    wsMaxBufferedBytes: 512,
  });
  t.after(() => cu.stop());

  const server = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!cu.upgrade(req, socket, head, url)) socket.destroy();
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
  const bpWs = await new Promise<WebSocketLib.WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces/media?ticket=bp`, ['rcdp.v2']);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
  const bpClosed = new Promise<void>(resolve => bpWs.once('close', () => resolve()));
  bpWs.send(Buffer.alloc(1024, 0x41));
  await bpClosed;

  // Missed pong eviction: raw TCP client completes WS handshake, never answers ping frames -> terminated!
  const cuPing = createCuHandlers({
    upgradeAuthorized: () => true,
    socketPath: () => socketPath,
    spacesPort: spaces.port,
    wsPingIntervalMs: 40,
  });
  t.after(() => cuPing.stop());
  const pingServer = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
  pingServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!cuPing.upgrade(req, socket, head, url)) socket.destroy();
  });
  const pingPort = await listenTcp(t, pingServer);
  await new Promise(resolve => setTimeout(resolve, 30));

  const rawClosed = await new Promise<boolean>((resolve, reject) => {
    const sock = net.connect(pingPort, '127.0.0.1', () => {
      sock.write(
        'GET /api/cu/spaces/media?ticket=dead HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${pingPort}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${validKey}\r\n` +
        'Sec-WebSocket-Version: 13\r\n' +
        'Sec-WebSocket-Protocol: rcdp.v2\r\n\r\n',
      );
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

  const cu = createCuHandlers({
    upgradeAuthorized: () => true,
    socketPath: () => socketPath,
    spacesPort: spaces.port,
    wsPingIntervalMs: 0,
    watchRetryMs: 40,
    maxSseErrorBytes: 256,
    maxSseEventBytes: 256,
  });
  t.after(() => cu.stop());

  const app = express();
  app.get('/api/cu/stream', cu.stream);
  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!cu.upgrade(req, socket, head, url)) socket.destroy();
  });
  const port = await listenTcp(t, server);

  // Oversized non-200 error body on /api/cu/stream settles cleanly with 502.
  broker.eventsMode = 'error-huge';
  const errRes = await fetch(`http://127.0.0.1:${port}/api/cu/stream`);
  assert.equal(errRes.status, 502);
  const errJson = record(await errRes.json());
  assert.match(String(errJson.error), /size limit/i);

  // Oversized unterminated watcher event triggers fail-closed watch loss and closes /media WS.
  broker.eventsMode = 'normal';
  await new Promise(resolve => setTimeout(resolve, 60));
  const mediaWs = await new Promise<WebSocketLib.WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cu/spaces/media?ticket=sse-cap`, ['rcdp.v2']);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
  t.after(() => { try { mediaWs.terminate(); } catch {} });

  const closedOnOverflow = new Promise<number>(resolve => mediaWs.once('close', code => resolve(code)));
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
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
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
  const rogueUpgradeSockets = new Set<import('node:stream').Duplex>();
  roguePeer.on('upgrade', (req, socket) => {
    rogueUpgradeSockets.add(socket);
    socket.on('close', () => rogueUpgradeSockets.delete(socket));
    const key = req.headers['sec-websocket-key'];
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const accept = crypto.createHash('sha1')
      .update(`${String(key)}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      'Sec-WebSocket-Protocol: rcdp.v2\r\n' +
      'Set-Cookie: ws-evil=1; Path=/\r\n' +
      'X-Rogue-Ws: should-not-pass\r\n\r\n',
    );
    socket.resume();
    socket.on('end', () => { try { socket.destroy(); } catch {} });
    socket.on('error', () => {});
  });

  const peerPort = await listenTcp(t, roguePeer, () => {
    for (const s of rogueUpgradeSockets) { try { s.destroy(); } catch {} }
    rogueUpgradeSockets.clear();
  });
  const remote: DirectRemote = { name: 'cu-sandbox', kind: 'direct', origin: `http://127.0.0.1:${peerPort}`, token: null };
  t.mock.method(remoteHosts, 'getRemote', (candidate: unknown) => (candidate === 'cu-sandbox' ? remote : null));
  t.mock.method(remoteHosts, 'reachability', () => null);
  const hubAccess = createAccessHandlers({
    version: '1.0.0',
    readDishSettings: () => ({}),
    sttAvailable: () => false,
    usageLimitsAvailable: () => false,
    botsAvailable: () => false,
    knowledgeAvailable: () => false,
  });
  const relay = createRelayHandlers({
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
    if (!relay.upgrade(req, socket, head, url)) socket.destroy();
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
  const upgradeHeaders = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
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
  assert.match(CU_VIEWER_CSP, /connect-src 'self';/);
  assert.doesNotMatch(CU_VIEWER_CSP, /connect-src[^;]*(?:ws:|wss:)/);

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

  const fakeEl = { dataset: {} as Record<string, string>, innerHTML: '' };
  const ctx = vm.createContext({
    URL,
    q: 24,
    Di: () => ({ hotspot: [0, 0] }),
    Bl: (_shape: string, color: string) => `<svg fill="${color}"></svg>`,
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
  assert.equal(
    vm.runInContext(`Cc(${JSON.stringify(relayBase)}, '/media?ticket=t_123')`, ctx),
    'wss://dish.example/hosts/cu-sandbox/api/cu/spaces/media?ticket=t_123',
  );
  for (const badWsPath of [
    'https://evil.example/media?ticket=x',
    'wss://evil.example/media?ticket=x',
    '//evil.example/media?ticket=x',
    '/../sessions/1/terminal',
    '/files?ticket=x',
    'media/../../other',
  ]) {
    assert.throws(
      () => vm.runInContext(`Cc(${JSON.stringify(relayBase)}, ${JSON.stringify(badWsPath)})`, ctx),
      /Invalid media wsPath/,
      `should reject wsPath ${badWsPath}`,
    );
  }

  // Fix (3) & (9a): browser cuSpacesViewerUrl & supportsComputerUseTransport.
  const browserBundle = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'browser.js'), 'utf8');
  const browserCtx = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(browserBundle, browserCtx);
  const helpers = browserCtx.PiDishBrowser as {
    cuSpacesViewerUrl(base: string, ticket: { ticket: string; path?: string; spacesPath?: string }): string;
    decodeCuTicket(raw: unknown): { ticket: string; path: string; spacesPath: string } | null;
    supportsComputerUseTransport(host: { base?: string | null; token?: string | null } | null): boolean;
  };

  // Hostile guest-supplied path / spacesPath is completely ignored when building iframe URL.
  const decoded = helpers.decodeCuTicket({
    mode: 'view-only',
    ticket: 'tok+1/2',
    path: '//evil.example/viewer/#ticket=x',
    spacesPath: '/api/cu/spaces/../../evil.html',
  });
  assert.ok(decoded);
  assert.equal(
    helpers.cuSpacesViewerUrl('/hosts/cu-sandbox', decoded),
    '/hosts/cu-sandbox/api/cu/spaces/viewer/#ticket=tok%2B1%2F2',
  );

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
    assert.equal(
      helpers.supportsComputerUseTransport(badHost),
      false,
      `should reject host ${JSON.stringify(badHost)}`,
    );
  }
});
