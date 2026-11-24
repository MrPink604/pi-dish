/**
 * Relay first-response timeout and upload backpressure handling
 * (lib/relay-handlers.js).
 *
 * Run with: npm test -- test/relay-handlers.test.js
 */
import test = require('node:test');
import type { TestContext } from 'node:test';
import assert = require('node:assert/strict');
import express = require('express');
import http = require('node:http');
import type { AddressInfo } from 'node:net';
import { Readable, Writable } from 'node:stream';
import * as fleetArtifacts from '../lib/fleet-artifacts';
import * as remoteHosts from '../lib/remote-hosts';
import type { DirectRemote } from '../lib/remote-hosts';
import { createRelayHandlers, relayFirstResponse } from '../lib/relay-handlers';

interface FakeSocket {
  bytesWritten: number;
}

interface FakeUpstreamOptions {
  highWaterMark?: number;
  initialBytesWritten?: number | null;
  onWrite?: (chunk: Buffer, done: (error?: Error | null) => void, upstream: FakeUpstream) => void;
}

class FakeUpstream extends Writable {
  socket: FakeSocket | null;
  destroyedByCaller = false;
  readonly received: Buffer[] = [];
  private readonly writeHandler: FakeUpstreamOptions['onWrite'];

  constructor(options: FakeUpstreamOptions = {}) {
    super({ highWaterMark: options.highWaterMark ?? 16, autoDestroy: false });
    this.socket = options.initialBytesWritten === null
      ? null
      : { bytesWritten: options.initialBytesWritten ?? 0 };
    this.writeHandler = options.onWrite;
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.received.push(buffer);
    if (this.writeHandler) {
      this.writeHandler(buffer, callback, this);
      return;
    }
    if (this.socket) this.socket.bytesWritten += buffer.length;
    callback();
  }

  override destroy(error?: Error): this {
    this.destroyedByCaller = true;
    return super.destroy(error);
  }

  asClientRequest(): http.ClientRequest {
    return this as unknown as http.ClientRequest;
  }

  emitPeerResponse(statusCode: number, body: string, headers: http.IncomingHttpHeaders = { 'content-type': 'application/json' }): http.IncomingMessage {
    const response = Readable.from([Buffer.from(body)]) as unknown as http.IncomingMessage;
    response.statusCode = statusCode;
    response.headers = headers;
    this.emit('response', response);
    return response;
  }
}

function makeFakePeerResponse(statusCode = 200): http.IncomingMessage {
  const response = Readable.from([]) as unknown as http.IncomingMessage;
  response.statusCode = statusCode;
  response.headers = {};
  return response;
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
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  t.after(() => new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function mockRemote(t: TestContext, remote: DirectRemote, openUpstream: () => FakeUpstream) {
  t.mock.method(remoteHosts, 'getRemote', (name: unknown) => (name === remote.name ? remote : null));
  t.mock.method(remoteHosts, 'reachability', () => null);
  t.mock.method(remoteHosts, 'request', async () => openUpstream().asClientRequest());
  return t.mock.method(remoteHosts, 'noteTransportFailure', () => {});
}

test('relayFirstResponse keeps uploading requests alive while socket bytesWritten advances without progress callbacks', async (t) => {
  const upstream = new FakeUpstream({ initialBytesWritten: 0 });
  const timeoutMs = 80;
  let responded: http.IncomingMessage | null = null;
  let failure: unknown = null;
  const timers: NodeJS.Timeout[] = [];
  t.after(() => { for (const timer of timers) clearTimeout(timer); });

  const done = new Promise<void>((resolve) => {
    relayFirstResponse(
      Promise.resolve(upstream.asClientRequest()),
      timeoutMs,
      () => {
        // Inbound req stops emitting data early; only socket writes advance.
        for (let step = 1; step <= 4; step++) {
          timers.push(setTimeout(() => {
            if (upstream.socket) upstream.socket.bytesWritten += 16_384;
          }, step * 50));
        }
        timers.push(setTimeout(() => {
          upstream.end();
          upstream.emit('response', makeFakePeerResponse(200));
        }, 230));
      },
      (peerRes) => { responded = peerRes; resolve(); },
      (reason) => { failure = reason; resolve(); },
      null,
    );
  });

  await done;
  assert.equal(failure, null);
  assert.equal(upstream.destroyedByCaller, false);
  assert.ok(responded, 'peer response should settle the relay');
  assert.equal((responded as http.IncomingMessage).statusCode, 200);
});

test('relayFirstResponse times out a stalled upstream when no bytes are written', async () => {
  const upstream = new FakeUpstream({ initialBytesWritten: 0 });
  const timeoutMs = 80;
  let responded = false;
  let failure: unknown = null;

  const started = Date.now();
  await new Promise<void>((resolve) => {
    relayFirstResponse(
      Promise.resolve(upstream.asClientRequest()),
      timeoutMs,
      () => {
        // Upload never finishes and writes zero bytes.
      },
      () => { responded = true; resolve(); },
      (reason) => { failure = reason; resolve(); },
      null,
    );
  });
  const elapsed = Date.now() - started;

  assert.equal(responded, false);
  assert.equal(failure, 'timeout');
  assert.equal(upstream.destroyedByCaller, true);
  assert.ok(elapsed >= timeoutMs - 20, `timed out too early: ${elapsed}ms`);
});

test('relayFirstResponse baselines reused keep-alive sockets on socket event and times out promptly if stalled', async () => {
  const upstream = new FakeUpstream({ initialBytesWritten: null });
  const timeoutMs = 120;
  let failure: unknown = null;

  const started = Date.now();
  await new Promise<void>((resolve) => {
    relayFirstResponse(
      Promise.resolve(upstream.asClientRequest()),
      timeoutMs,
      (req) => {
        // Reused keep-alive socket already carries bytes from an earlier request.
        const reused: FakeSocket = { bytesWritten: 8192 };
        upstream.socket = reused;
        req.emit('socket', reused);
      },
      () => resolve(),
      (reason) => { failure = reason; resolve(); },
      null,
    );
  });
  const elapsed = Date.now() - started;

  assert.equal(failure, 'timeout');
  assert.equal(upstream.destroyedByCaller, true);
  assert.ok(elapsed < timeoutMs * 1.85, `reused socket bytes should not grant a free refresh (${elapsed}ms)`);
});

test('relayFirstResponse advances the bytesWritten watermark on progress() so a later stall times out in one window', async () => {
  const upstream = new FakeUpstream({ initialBytesWritten: 0 });
  const timeoutMs = 120;
  let failure: unknown = null;

  const started = Date.now();
  await new Promise<void>((resolve) => {
    relayFirstResponse(
      Promise.resolve(upstream.asClientRequest()),
      timeoutMs,
      (_req, progress) => {
        if (upstream.socket) upstream.socket.bytesWritten = 4096;
        progress();
        // Stall immediately after reporting progress.
      },
      () => resolve(),
      (reason) => { failure = reason; resolve(); },
      null,
    );
  });
  const elapsed = Date.now() - started;

  assert.equal(failure, 'timeout');
  assert.equal(upstream.destroyedByCaller, true);
  assert.ok(elapsed < timeoutMs * 1.85, `stall after progress() should time out in one window (${elapsed}ms)`);
});

test('relayFirstResponse times out after writableFinished becomes true if the peer never responds', async (t) => {
  const upstream = new FakeUpstream({ initialBytesWritten: 0 });
  const timeoutMs = 80;
  let failure: unknown = null;
  let finishedAt = 0;
  const timers: NodeJS.Timeout[] = [];
  t.after(() => { for (const timer of timers) clearTimeout(timer); });

  await new Promise<void>((resolve) => {
    relayFirstResponse(
      Promise.resolve(upstream.asClientRequest()),
      timeoutMs,
      (req, progress) => {
        req.on('finish', progress);
        // Stay alive across one timeout via socket progress, then finish uploading.
        timers.push(setTimeout(() => {
          if (upstream.socket) upstream.socket.bytesWritten += 4096;
        }, 45));
        timers.push(setTimeout(() => {
          finishedAt = Date.now();
          upstream.end();
          assert.equal(upstream.destroyedByCaller, false, 'finishing upload must not destroy upstream');
        }, 110));
      },
      () => resolve(),
      (reason) => { failure = reason; resolve(); },
      null,
    );
  });
  const afterFinishMs = Date.now() - finishedAt;

  assert.equal(upstream.writableFinished, true);
  assert.equal(failure, 'timeout');
  assert.equal(upstream.destroyedByCaller, true);
  assert.ok(finishedAt > 0, 'upload should have finished before timing out');
  assert.ok(afterFinishMs >= timeoutMs - 20, `should allow a full timeoutMs after finish (${afterFinishMs}ms)`);
});

test('proxyToRemote survives a backpressured slow-draining upload without 502 or tripping noteTransportFailure', async (t) => {
  const timeoutMs = 100;
  const base = await mountRawApi(t, timeoutMs);
  const remote: DirectRemote = { name: 'slow-peer', kind: 'direct', origin: 'http://127.0.0.1:1', token: null };
  const timers: NodeJS.Timeout[] = [];
  t.after(() => { for (const timer of timers) clearTimeout(timer); });

  let upstream!: FakeUpstream;
  let drains = 0;
  let finishedAt = 0;
  const started = Date.now();
  const noteFailure = mockRemote(t, remote, () => {
    upstream = new FakeUpstream({
      highWaterMark: 16 * 1024,
      initialBytesWritten: 0,
      onWrite(chunk, done, self) {
        // Hold each chunk for 65ms so req pauses under backpressure and the total
        // upload spans well past timeoutMs while draining chunk by chunk.
        timers.push(setTimeout(() => {
          if (self.socket) self.socket.bytesWritten += chunk.length;
          done();
        }, 65));
      },
    });
    upstream.on('drain', () => { drains++; });
    upstream.on('finish', () => {
      finishedAt = Date.now();
      // Peer answers 65ms after finish: > timeoutMs after the last inbound req
      // chunk (65ms + 65ms = 130ms > 100ms), proving 'finish' reset the timer.
      timers.push(setTimeout(() => {
        upstream.emitPeerResponse(200, JSON.stringify({ ok: true }));
      }, 65));
    });
    return upstream;
  });

  // 256 KiB produces multiple IncomingMessage read chunks (> highWaterMark) so
  // req.pipe(upstream) genuinely backpressures and pauses req between drains.
  const payload = Buffer.alloc(256 * 1024, 0x61);
  const reply = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(`${base}/hosts/slow-peer/api/sessions/s1/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'content-length': payload.length },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(payload);
  });

  assert.equal(reply.status, 200, reply.body);
  assert.deepEqual(JSON.parse(reply.body), { ok: true });
  assert.equal(upstream.destroyedByCaller, false);
  assert.equal(Buffer.concat(upstream.received).length, payload.length);
  assert.ok(drains >= 2, `expected multiple backpressure drains, got ${drains}`);
  assert.ok(finishedAt - started >= timeoutMs * 2, `upload should outlast 2x timeoutMs while draining (${finishedAt - started}ms)`);
  assert.equal(noteFailure.mock.callCount(), 0, 'slow healthy upload must not trip transport failure');
});

test('proxyToRemote survives when local req finishes early while upstream is still flushing slowly to the peer socket', async (t) => {
  const timeoutMs = 90;
  const base = await mountRawApi(t, timeoutMs);
  const remote: DirectRemote = { name: 'flush-peer', kind: 'direct', origin: 'http://127.0.0.1:1', token: null };
  const timers: NodeJS.Timeout[] = [];
  t.after(() => { for (const timer of timers) clearTimeout(timer); });

  let upstream!: FakeUpstream;
  let firstWriteAt = 0;
  let finishedAt = 0;
  const noteFailure = mockRemote(t, remote, () => {
    upstream = new FakeUpstream({
      highWaterMark: 1024,
      initialBytesWritten: 0,
      onWrite(_chunk, done, self) {
        if (!firstWriteAt) firstWriteAt = Date.now();
        // Fast local req finishes immediately; upstream flushes over 220ms (> 2.4x timeoutMs).
        for (let step = 1; step <= 4; step++) {
          timers.push(setTimeout(() => {
            if (self.socket) self.socket.bytesWritten += 256;
          }, step * 50));
        }
        timers.push(setTimeout(() => {
          done();
        }, 220));
      },
    });
    upstream.on('finish', () => {
      finishedAt = Date.now();
      timers.push(setTimeout(() => {
        upstream.emitPeerResponse(200, JSON.stringify({ stored: true }));
      }, 45));
    });
    return upstream;
  });

  const body = 'x'.repeat(512);
  const response = await fetch(`${base}/hosts/flush-peer/api/sessions/s1/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  });
  const json = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.deepEqual(json, { stored: true });
  assert.equal(upstream.destroyedByCaller, false);
  assert.equal(Buffer.concat(upstream.received).toString('utf8'), body);
  assert.ok(finishedAt - firstWriteAt >= timeoutMs * 2, `flush should outlast 2x timeoutMs (${finishedAt - firstWriteAt}ms)`);
  assert.equal(noteFailure.mock.callCount(), 0);
});

test('proxyToRemote returns 502 and records transport timeout when the peer hangs after upload finishes', async (t) => {
  const timeoutMs = 80;
  const base = await mountRawApi(t, timeoutMs);
  const remote: DirectRemote = { name: 'hang-peer', kind: 'direct', origin: 'http://127.0.0.1:1', token: null };

  let upstream!: FakeUpstream;
  const noteFailure = mockRemote(t, remote, () => {
    upstream = new FakeUpstream({ initialBytesWritten: 0 });
    return upstream;
  });

  const response = await fetch(`${base}/hosts/hang-peer/api/sessions/s1/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: 'hello',
  });
  const json = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 502);
  assert.equal(json.host, 'hang-peer');
  assert.equal(json.reason, 'timeout');
  assert.equal(upstream.writableFinished, true);
  assert.equal(upstream.destroyedByCaller, true);
  assert.equal(noteFailure.mock.callCount(), 1);
  assert.deepEqual(noteFailure.mock.calls[0].arguments, [remote, 'timeout']);
});

export {};
