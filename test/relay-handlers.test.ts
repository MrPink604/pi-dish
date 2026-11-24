/**
 * Relay first-response timeout and upload inactivity handling
 * (lib/relay-handlers.js).
 *
 * Run with: npm test -- test/relay-handlers.test.js
 */
import test = require('node:test');
import type { TestContext } from 'node:test';
import assert = require('node:assert/strict');
import express = require('express');
import { EventEmitter } from 'node:events';
import http = require('node:http');
import type { AddressInfo } from 'node:net';
import { Readable, Writable } from 'node:stream';
import * as fleetArtifacts from '../lib/fleet-artifacts';
import * as remoteHosts from '../lib/remote-hosts';
import type { DirectRemote } from '../lib/remote-hosts';
import { createRelayHandlers, relayFirstResponse } from '../lib/relay-handlers';

class StubSocket extends EventEmitter {
  connecting: boolean;
  timeoutCalls: number[] = [];

  constructor(connecting = false) {
    super();
    this.connecting = connecting;
  }

  setTimeout(ms: number): this {
    this.timeoutCalls.push(ms);
    return this;
  }
}

class StubUpstream extends Writable {
  socket: StubSocket | null = null;
  destroyedByCaller = false;

  constructor() {
    super({ autoDestroy: false });
  }

  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback();
  }

  override destroy(error?: Error): this {
    this.destroyedByCaller = true;
    return super.destroy(error);
  }

  asClientRequest(): http.ClientRequest {
    return this as unknown as http.ClientRequest;
  }
}

function makeFakePeerResponse(statusCode = 200): http.IncomingMessage {
  const response = Readable.from([]) as unknown as http.IncomingMessage;
  response.statusCode = statusCode;
  response.headers = {};
  return response;
}

async function listen(t: TestContext, server: http.Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  t.after(() => new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  return (server.address() as AddressInfo).port;
}

async function mountRawApi(t: TestContext, proxyResponseTimeoutMs: number): Promise<string> {
  const handlers = createRelayHandlers({
    fleetArtifacts,
    localPageExists: () => false,
    publicBaseUrl: () => undefined,
    hostDescriptor: () => ({ hostId: '00000000-0000-4000-8000-000000000001', label: 'hub', version: '1.0.0', capabilities: {} }),
    upgradeAuthorized: () => false,
    proxyResponseTimeoutMs,
  });
  const app = express();
  app.use('/hosts/:name/api', handlers.rawApi);
  const server = http.createServer(app);
  const port = await listen(t, server);
  return `http://127.0.0.1:${port}`;
}

function bindDirectPeer(t: TestContext, name: string, peerPort: number) {
  const remote: DirectRemote = { name, kind: 'direct', origin: `http://127.0.0.1:${peerPort}`, token: null };
  t.mock.method(remoteHosts, 'getRemote', (candidate: unknown) => (candidate === remote.name ? remote : null));
  t.mock.method(remoteHosts, 'reachability', () => null);
  const noteFailure = t.mock.method(remoteHosts, 'noteTransportFailure', () => {});
  return { remote, noteFailure };
}

test('relayFirstResponse enforces setup, socket-inactivity, and first-response deadlines with a mock clock and clears socket timeout on response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // 1. Setup deadline fires when no socket connects within timeoutMs.
  {
    const upstream = new StubUpstream();
    let failure: unknown = null;
    relayFirstResponse(
      Promise.resolve(upstream.asClientRequest()),
      100,
      () => {},
      () => assert.fail('unexpected response'),
      (reason) => { failure = reason; },
      null,
    );
    await Promise.resolve();
    t.mock.timers.tick(99);
    assert.equal(failure, null);
    t.mock.timers.tick(1);
    assert.equal(failure, 'timeout');
    assert.equal(upstream.destroyedByCaller, true);
  }

  // 2. Connecting socket keeps setup deadline until connect, then starts a fresh first-response deadline after finish.
  {
    const upstream = new StubUpstream();
    const socket = new StubSocket(true);
    let failure: unknown = null;
    relayFirstResponse(
      Promise.resolve(upstream.asClientRequest()),
      100,
      (req) => {
        upstream.socket = socket;
        req.emit('socket', socket);
        req.end();
      },
      () => assert.fail('unexpected response'),
      (reason) => { failure = reason; },
      null,
    );
    await new Promise<void>(resolve => process.nextTick(resolve));
    assert.equal(upstream.writableFinished, true);
    assert.deepEqual(socket.timeoutCalls, [100]);

    // Connect succeeds at 60ms: setup timer clears and first-response timer gets a fresh 100ms.
    t.mock.timers.tick(60);
    socket.connecting = false;
    socket.emit('connect');
    t.mock.timers.tick(99);
    assert.equal(failure, null, 'first-response deadline must start fresh after connect');
    t.mock.timers.tick(1);
    assert.equal(failure, 'timeout');
    assert.equal(upstream.destroyedByCaller, true);
    assert.deepEqual(socket.timeoutCalls, [100, 0]);
    assert.equal(socket.listenerCount('timeout'), 0);
  }

  // 2b. Connect before finish: first-response deadline starts on finish, not connect.
  {
    const upstream = new StubUpstream();
    const socket = new StubSocket(true);
    let failure: unknown = null;
    relayFirstResponse(
      Promise.resolve(upstream.asClientRequest()),
      100,
      (req) => {
        upstream.socket = socket;
        req.emit('socket', socket);
      },
      () => assert.fail('unexpected response'),
      (reason) => { failure = reason; },
      null,
    );
    await new Promise<void>(resolve => process.nextTick(resolve));
    t.mock.timers.tick(40);
    socket.connecting = false;
    socket.emit('connect');
    // Still uploading: setup timer cleared, response timer not armed yet.
    t.mock.timers.tick(90);
    assert.equal(failure, null);
    upstream.end();
    await new Promise<void>(resolve => process.nextTick(resolve));
    t.mock.timers.tick(99);
    assert.equal(failure, null, 'first-response deadline runs full timeoutMs after finish');
    t.mock.timers.tick(1);
    assert.equal(failure, 'timeout');
    assert.equal(upstream.destroyedByCaller, true);
  }

  // 3. Reused keep-alive socket arms socket timeout immediately and disarms cleanly on response.
  {
    const upstream = new StubUpstream();
    const reused = new StubSocket(false);
    let responded = false;
    relayFirstResponse(
      Promise.resolve(upstream.asClientRequest()),
      120,
      (req) => {
        upstream.socket = reused;
        req.emit('socket', reused);
        req.end();
      },
      () => { responded = true; },
      (reason) => assert.fail(`unexpected failure: ${String(reason)}`),
      null,
    );
    await Promise.resolve();
    assert.deepEqual(reused.timeoutCalls, [120]);

    t.mock.timers.tick(50);
    upstream.emit('response', makeFakePeerResponse(200));
    assert.equal(responded, true);
    assert.deepEqual(reused.timeoutCalls, [120, 0], 'socket timeout must be cleared on response');
    assert.equal(reused.listenerCount('timeout'), 0, 'timeout listener must be removed on response');

    // Advancing far past timeoutMs after response must not destroy the upstream or socket.
    t.mock.timers.tick(500);
    assert.equal(upstream.destroyedByCaller, false);
  }
});

test('proxyToRemote survives a slow streaming upload over a real loopback socket without 502 or tripping noteTransportFailure', async (t) => {
  const timeoutMs = 150;
  const peer = http.createServer((req, res) => {
    let bytes = 0;
    req.on('data', (chunk: Buffer) => { bytes += chunk.length; });
    req.on('end', () => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, bytes }));
      }, 40);
    });
  });
  const peerPort = await listen(t, peer);
  const base = await mountRawApi(t, timeoutMs);
  const { noteFailure } = bindDirectPeer(t, 'slow-stream-peer', peerPort);

  const chunks = 10;
  const chunkSize = 8 * 1024;
  const totalBytes = chunks * chunkSize;
  const started = Date.now();

  const reply = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(`${base}/hosts/slow-stream-peer/api/sessions/s1/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'content-length': totalBytes },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    const payloadChunk = Buffer.alloc(chunkSize, 0x61);
    let sent = 0;
    const iv = setInterval(() => {
      req.write(payloadChunk);
      sent++;
      if (sent >= chunks) {
        clearInterval(iv);
        req.end();
      }
    }, 45);
    t.after(() => clearInterval(iv));
  });

  const elapsed = Date.now() - started;
  assert.equal(reply.status, 200, reply.body);
  assert.deepEqual(JSON.parse(reply.body), { ok: true, bytes: totalBytes });
  assert.ok(elapsed >= timeoutMs * 2.5, `upload should span well past timeoutMs (${elapsed}ms)`);
  assert.equal(noteFailure.mock.callCount(), 0);
});

test('proxyToRemote survives a real TCP backpressured slow-draining upload without 502 or tripping noteTransportFailure', async (t) => {
  const timeoutMs = 180;
  const totalBytes = 12 * 1024 * 1024;
  const tailFlushThreshold = totalBytes - 4 * 1024 * 1024;
  const timers: NodeJS.Timeout[] = [];
  t.after(() => { for (const timer of timers) clearInterval(timer); });

  const peer = http.createServer((req, res) => {
    let bytes = 0;
    let drainingFast = false;
    req.pause();
    const iv = setInterval(() => {
      if (drainingFast) return;
      const chunk = req.read(256 * 1024) as Buffer | null;
      if (chunk) {
        bytes += chunk.length;
        if (bytes >= tailFlushThreshold) {
          drainingFast = true;
          clearInterval(iv);
          req.on('data', (rest: Buffer) => { bytes += rest.length; });
          req.resume();
        }
      }
    }, 20);
    timers.push(iv);
    req.on('close', () => clearInterval(iv));
    req.on('end', () => {
      clearInterval(iv);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, bytes }));
    });
  });
  const peerPort = await listen(t, peer);
  const base = await mountRawApi(t, timeoutMs);
  const { noteFailure } = bindDirectPeer(t, 'slow-drain-peer', peerPort);

  const started = Date.now();
  const reply = await new Promise<{ status: number; body: string; drains: number }>((resolve, reject) => {
    const req = http.request(`${base}/hosts/slow-drain-peer/api/sessions/s1/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'content-length': totalBytes },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, drains }));
    });
    req.on('error', reject);
    const chunk = Buffer.alloc(64 * 1024, 0x62);
    let remaining = totalBytes / chunk.length;
    let drains = 0;
    const pump = () => {
      while (remaining > 0) {
        remaining--;
        if (!req.write(chunk)) {
          drains++;
          req.once('drain', pump);
          return;
        }
      }
      req.end();
    };
    pump();
  });

  const elapsed = Date.now() - started;
  assert.equal(reply.status, 200, reply.body);
  assert.deepEqual(JSON.parse(reply.body), { ok: true, bytes: totalBytes });
  assert.ok(reply.drains >= 1, `expected real TCP backpressure drains, got ${reply.drains}`);
  assert.ok(elapsed >= timeoutMs * 2, `draining upload should outlast 2x timeoutMs (${elapsed}ms)`);
  assert.equal(noteFailure.mock.callCount(), 0);
});

test('proxyToRemote returns 502 and records transport timeout when an upload stalls mid-stream', async (t) => {
  const timeoutMs = 120;
  const peer = http.createServer((req) => {
    req.resume();
  });
  const peerPort = await listen(t, peer);
  const base = await mountRawApi(t, timeoutMs);
  const { remote, noteFailure } = bindDirectPeer(t, 'stall-peer', peerPort);

  const reply = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(`${base}/hosts/stall-peer/api/sessions/s1/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'content-length': 65_536 },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => {
        req.destroy();
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') return;
      reject(err);
    });
    // Write one small chunk, then stall forever without ending the upload.
    req.write(Buffer.alloc(1024, 0x63));
  });

  const json = JSON.parse(reply.body) as Record<string, unknown>;
  assert.equal(reply.status, 502);
  assert.equal(json.host, 'stall-peer');
  assert.equal(json.reason, 'timeout');
  assert.equal(noteFailure.mock.callCount(), 1);
  assert.deepEqual(noteFailure.mock.calls[0].arguments, [remote, 'timeout']);
});

test('proxyToRemote returns 502 and records transport timeout when the peer hangs after upload finishes', async (t) => {
  const timeoutMs = 120;
  const peer = http.createServer((req) => {
    req.resume();
    // Never respond after receiving the body.
  });
  const peerPort = await listen(t, peer);
  const base = await mountRawApi(t, timeoutMs);
  const { remote, noteFailure } = bindDirectPeer(t, 'hang-peer', peerPort);

  const response = await fetch(`${base}/hosts/hang-peer/api/sessions/s1/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: 'hello',
  });
  const json = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 502);
  assert.equal(json.host, 'hang-peer');
  assert.equal(json.reason, 'timeout');
  assert.equal(noteFailure.mock.callCount(), 1);
  assert.deepEqual(noteFailure.mock.calls[0].arguments, [remote, 'timeout']);
});

test('proxyToRemote clears the upstream socket inactivity timeout once response headers arrive (idle SSE survives)', async (t) => {
  const timeoutMs = 100;
  const peer = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    // Stay completely silent for 2.5x timeoutMs before emitting an SSE event.
    setTimeout(() => {
      res.write('data: alive\n\n');
      res.end();
    }, timeoutMs * 2.5);
  });
  const peerPort = await listen(t, peer);
  const base = await mountRawApi(t, timeoutMs);
  const { noteFailure } = bindDirectPeer(t, 'sse-peer', peerPort);

  const response = await fetch(`${base}/hosts/sse-peer/api/sessions/s1/stream`);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /data: alive/);
  assert.equal(noteFailure.mock.callCount(), 0);
});

export {};
