/**
 * Focused tests for Computer-Use Slice 2 (guest-broker §9 contract):
 * - Zero secrets or nonces in tmux argv/env, sibling tmux windows, omp child env,
 *   HTTP/SSE replies, persisted files, or logs (`CU_BROKER_CLAIM_FILE` only).
 * - Prompt bind once right after `spawnInTmux`, and `requireRebind: true` + rebind on `respawnPane`.
 * - Durable non-secret lease store (`cu-agent-leases.json`, 0600) + startup reconciliation
 *   (releases dead active orphans, cancels dead displaced orphans, re-adopts live ones).
 * - Close/death while displaced calls `POST /v1/lease/cancel-preempted` (with `409 lease_active`
 *   fallback to `release`), never letting a closed agent regain the seat on hand-back.
 * - Reliable command delivery keyed by `(generation, processBirth)`, separate pending/acked
 *   tracking, pre-send owner+PID recheck, and heartbeat `409` immediate abort.
 * - Ordered broker event watcher with `Last-Event-ID: <gen>:<cursor>`, generation & resync
 *   watermark resets (`generation_mismatch`, `cursor_too_old`, `cursor_ahead`, `subscriber_lagged`),
 *   and atomic SSE frames with backpressure on `/api/cu/stream`.
 * - Private (PIN-locked) session isolation (opaque `ownerId`, never route/session IDs in broker).
 * - Recovery & hibernation non-poisoning on `409 seat_busy` / `503` broker unavailable.
 * - Configured-but-missing broker socket fails closed (`503`), plus typed async refusal.
 *
 * Run with: npm test -- test/cu-agent-leases.test.js
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import { execFileSync } from 'node:child_process';
import crypto = require('node:crypto');
import { EventEmitter } from 'node:events';
import fs = require('node:fs');
import http = require('node:http');
import os = require('node:os');
import path = require('node:path');
import type { NativeSessionId } from '../lib/contracts';
import type * as CuAgentLeasesMod from '../lib/cu-agent-leases';
import type * as CuBrokerMod from '../lib/cu-broker';
import type * as CuHandlersMod from '../lib/cu-handlers';
import type * as HibernationMod from '../lib/session-hibernation';
import type * as RecoveryRunnerMod from '../lib/recovery-runner';
import type * as RecoveryStoreMod from '../lib/session-recovery';
import { present, record, records } from './test-types.js';

// Configure isolated HOME, TMUX_TMPDIR, and broker socket BEFORE loading any
// pi-dish runtime module so REGISTRY_DIR and dishDir() bind to the temp home.
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2b-home-'));
const TEST_TMUX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2b-tmux-'));
const TEST_SOCK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2b-sock-'));
const TEST_CLAIM_DIR = path.join(TEST_SOCK_DIR, 'claims');
const TEST_CWD = path.join(TEST_HOME, 'work');
const TEST_ENV_DIR = path.join(TEST_HOME, 'omp-env');
const TEST_CMD_DIR = path.join(TEST_HOME, 'omp-cmd');
const TEST_HOLD_REGISTER_FLAG = path.join(TEST_HOME, 'hold-register.flag');
const TEST_FAKE_OMP_PATH = path.join(TEST_HOME, 'fake-omp.js');
const TEST_BROKER_SOCK = path.join(TEST_SOCK_DIR, 'control.sock');
fs.mkdirSync(TEST_CWD, { recursive: true });
fs.mkdirSync(TEST_CLAIM_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(TEST_HOME, '.omp', 'agent'), { recursive: true });

process.env.HOME = TEST_HOME;
process.env.PORT = '0';
process.env.TMUX_TMPDIR = TEST_TMUX_DIR;
process.env.PI_DISH_TMUX_SCOPE = '0';
process.env.PI_DISH_CU_BROKER_SOCKET = TEST_BROKER_SOCK;
process.env.PI_DISH_CU_LIVENESS_MS = '60';
process.env.PI_DISH_CU_WATCH_RETRY_MS = '35';
process.env.PI_DISH_BOTS = 'off';
process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${TEST_FAKE_OMP_PATH}`;

const {
  createCuAgentLeases,
  CuBrokerUnavailableError,
  CuSeatBusyError,
  CU_HAND_BACK_NUDGE,
  BROKER_AGENT_LABEL,
}: typeof CuAgentLeasesMod = require('../lib/cu-agent-leases');
const { createCuBrokerClient }: typeof CuBrokerMod = require('../lib/cu-broker');
const { createCuHandlers }: typeof CuHandlersMod = require('../lib/cu-handlers');
const { createSessionHibernation }: typeof HibernationMod = require('../lib/session-hibernation');
const { createRecoveryRuntime }: typeof RecoveryRunnerMod = require('../lib/recovery-runner');
const recoveryStore: typeof RecoveryStoreMod = require('../lib/session-recovery');
const { resolveSessionRoute }: typeof import('../lib/session-key') = require('../lib/session-key');
const { routeSessionId }: typeof import('../lib/session-ownership') = require('../lib/session-ownership');
const { dishDir }: typeof import('../lib/dish-store') = require('../lib/dish-store');
const { errorStatus }: typeof import('../lib/http-boundary') = require('../lib/http-boundary');

const SECRET_PREFIX = 'cu-agent-secret-never-leak-';
const NONCE_PREFIX = 'cu-claim-nonce-never-leak-';

interface FakeBrokerLease {
  holderKind: 'agent' | 'human';
  leaseId: string;
  sessionId: string | null;
  ownerId: string | null;
  holderId: string | null;
  label: string;
  pid: number | null;
  pidStartTime: number | null;
  expiresAt: string;
  tokenHash: string;
  rawSecret: string;
}

interface FakeBufferedEvent {
  generation: string;
  cursor: number;
  eventName: string;
  payload: Record<string, unknown>;
}

interface FakeEventsRequest {
  url: string;
  lastEventId: string | null;
  generation: string | null;
  cursor: string | null;
}

interface FakeBrokerController {
  readonly socketPath: string;
  generation: string;
  cursor: number;
  state: 'idle' | 'agent' | 'waiting_for_human' | 'human';
  epoch: number;
  lease: FakeBrokerLease | null;
  preempted: FakeBrokerLease | null;
  minRetainedCursor: number;
  readonly acquireCalls: Array<Record<string, unknown>>;
  readonly claimNonceCalls: Array<Record<string, unknown>>;
  readonly bindCalls: Array<Record<string, unknown>>;
  readonly heartbeatCalls: Array<Record<string, unknown>>;
  readonly releaseCalls: Array<Record<string, unknown>>;
  readonly cancelPreemptedCalls: Array<Record<string, unknown>>;
  readonly eventsRequests: FakeEventsRequest[];
  readonly issuedSecrets: Set<string>;
  readonly issuedNonces: Set<string>;
  readonly sseClients: Set<http.ServerResponse>;
  emitEvent(eventName: string, payload: Record<string, unknown>): void;
  emitResync(reason: string): void;
  restartGeneration(nextGeneration: string, nextEpoch?: number): void;
  dropSseClients(): void;
  publicLease(lease: FakeBrokerLease | null): Record<string, unknown> | null;
  snapshotPayload(): Record<string, unknown>;
  close(): Promise<void>;
}

function hashSecret(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function startFakeCuBroker(socketPath: string, claimDir: string): Promise<FakeBrokerController> {
  fs.mkdirSync(claimDir, { recursive: true, mode: 0o700 });
  const sseClients = new Set<http.ServerResponse>();
  const acquireCalls: Array<Record<string, unknown>> = [];
  const claimNonceCalls: Array<Record<string, unknown>> = [];
  const bindCalls: Array<Record<string, unknown>> = [];
  const heartbeatCalls: Array<Record<string, unknown>> = [];
  const releaseCalls: Array<Record<string, unknown>> = [];
  const cancelPreemptedCalls: Array<Record<string, unknown>> = [];
  const eventsRequests: FakeEventsRequest[] = [];
  const issuedSecrets = new Set<string>();
  const issuedNonces = new Set<string>();
  const eventRing: FakeBufferedEvent[] = [];
  let secretSeq = 0;
  let nonceSeq = 0;
  let ticketSeq = 0;

  function publicLease(lease: FakeBrokerLease | null): Record<string, unknown> | null {
    if (!lease) return null;
    return {
      holderKind: lease.holderKind,
      leaseId: lease.leaseId,
      sessionId: lease.sessionId,
      ownerId: lease.ownerId,
      holderId: lease.holderId,
      label: lease.label,
      pid: lease.pid,
      pidStartTime: lease.pidStartTime,
      expiresAt: lease.expiresAt,
    };
  }

  function publicPreempted(lease: FakeBrokerLease | null): Record<string, unknown> | null {
    if (!lease) return null;
    return {
      sessionId: lease.sessionId,
      ownerId: lease.ownerId,
      leaseId: lease.leaseId,
      label: lease.label,
      pid: lease.pid,
      pidStartTime: lease.pidStartTime,
    };
  }

  const ctrl: FakeBrokerController = {
    socketPath,
    generation: 'gen-1',
    cursor: 0,
    state: 'idle',
    epoch: 1,
    lease: null,
    preempted: null,
    minRetainedCursor: 0,
    acquireCalls,
    claimNonceCalls,
    bindCalls,
    heartbeatCalls,
    releaseCalls,
    cancelPreemptedCalls,
    eventsRequests,
    issuedSecrets,
    issuedNonces,
    sseClients,
    publicLease,
    snapshotPayload() {
      return {
        generation: ctrl.generation,
        cursor: ctrl.cursor,
        state: ctrl.state,
        epoch: ctrl.epoch,
        lease: publicLease(ctrl.lease),
        preempted: publicPreempted(ctrl.preempted),
      };
    },
    emitEvent(eventName, payload) {
      ctrl.cursor += 1;
      const fullPayload: Record<string, unknown> = {
        ...payload,
        generation: ctrl.generation,
        cursor: ctrl.cursor,
      };
      eventRing.push({ generation: ctrl.generation, cursor: ctrl.cursor, eventName, payload: fullPayload });
      if (eventRing.length > 64) {
        eventRing.shift();
        ctrl.minRetainedCursor = eventRing[0].cursor - 1;
      }
      const frame = `id: ${ctrl.generation}:${ctrl.cursor}\nevent: ${eventName}\ndata: ${JSON.stringify(fullPayload)}\n\n`;
      for (const client of [...sseClients]) {
        if (client.writableEnded || client.destroyed) {
          sseClients.delete(client);
          continue;
        }
        client.write(frame);
      }
    },
    emitResync(reason) {
      const fullPayload = { ...ctrl.snapshotPayload(), reason };
      const frame = `id: ${ctrl.generation}:${ctrl.cursor}\nevent: resync\ndata: ${JSON.stringify(fullPayload)}\n\n`;
      for (const client of [...sseClients]) {
        if (client.writableEnded || client.destroyed) {
          sseClients.delete(client);
          continue;
        }
        client.write(frame);
      }
    },
    restartGeneration(nextGeneration, nextEpoch = 0) {
      ctrl.generation = nextGeneration;
      ctrl.cursor = 0;
      ctrl.minRetainedCursor = 0;
      ctrl.epoch = nextEpoch;
      eventRing.length = 0;
    },
    dropSseClients() {
      for (const client of [...sseClients]) {
        try { client.destroy(); } catch {}
      }
      sseClients.clear();
    },
    async close() {
      ctrl.dropSseClients();
      await new Promise<void>(resolve => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
      try { fs.unlinkSync(socketPath); } catch {}
    },
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/v1/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        version: 2,
        capabilities: { claimNonce: true, bind: true, cancelPreempted: true, orderedEvents: true },
        ...ctrl.snapshotPayload(),
        health: { broker: true, spacesd: true, driver: true, xvfb: true, desktop: true, chrome: true, driverWorkerRunning: true },
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      const lastEventId = typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : null;
      const qGen = url.searchParams.get('generation');
      const qCursor = url.searchParams.get('cursor');
      eventsRequests.push({ url: req.url || '/v1/events', lastEventId, generation: qGen, cursor: qCursor });

      let reqGen = qGen;
      let reqCursor: number | null = qCursor !== null && /^\d+$/.test(qCursor) ? Number(qCursor) : null;
      if (lastEventId && lastEventId.includes(':')) {
        const idx = lastEventId.lastIndexOf(':');
        reqGen = reqGen || lastEventId.slice(0, idx);
        const tail = lastEventId.slice(idx + 1);
        if (reqCursor === null && /^\d+$/.test(tail)) reqCursor = Number(tail);
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders();
      sseClients.add(res);
      res.on('close', () => sseClients.delete(res));

      if (reqGen !== null || reqCursor !== null) {
        if (reqGen !== null && reqGen !== ctrl.generation) {
          res.write(`id: ${ctrl.generation}:${ctrl.cursor}\nevent: resync\ndata: ${JSON.stringify({ ...ctrl.snapshotPayload(), reason: 'generation_mismatch' })}\n\n`);
          return;
        }
        if (reqCursor !== null && reqCursor > ctrl.cursor) {
          res.write(`id: ${ctrl.generation}:${ctrl.cursor}\nevent: resync\ndata: ${JSON.stringify({ ...ctrl.snapshotPayload(), reason: 'cursor_ahead' })}\n\n`);
          return;
        }
        if (reqCursor !== null && reqCursor < ctrl.minRetainedCursor) {
          res.write(`id: ${ctrl.generation}:${ctrl.cursor}\nevent: resync\ndata: ${JSON.stringify({ ...ctrl.snapshotPayload(), reason: 'cursor_too_old' })}\n\n`);
          return;
        }
        const fromCursor = reqCursor ?? 0;
        const missed = eventRing.filter(e => e.generation === ctrl.generation && e.cursor > fromCursor);
        // §9.5: hello with resume.status === 'replayed' carries the client's pre-replay cursor.
        res.write(
          `id: ${ctrl.generation}:${fromCursor}\nevent: hello\ndata: ${JSON.stringify({
            ...ctrl.snapshotPayload(),
            resume: { status: 'replayed', generation: ctrl.generation, cursor: fromCursor, currentCursor: ctrl.cursor },
          })}\n\n`,
        );
        for (const item of missed) {
          res.write(`id: ${item.generation}:${item.cursor}\nevent: ${item.eventName}\ndata: ${JSON.stringify(item.payload)}\n\n`);
        }
        return;
      }

      res.write(
        `id: ${ctrl.generation}:${ctrl.cursor}\nevent: hello\ndata: ${JSON.stringify({
          ...ctrl.snapshotPayload(),
          resume: { status: 'fresh', generation: ctrl.generation, cursor: ctrl.cursor },
        })}\n\n`,
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/audit') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        entries: [{
          ts: new Date().toISOString(),
          action: 'acquire',
          epoch: ctrl.epoch,
          ownerId: ctrl.lease?.ownerId ?? null,
          tokenHash: ctrl.lease?.tokenHash ?? null,
        }],
      }));
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

      if (req.method === 'POST' && url.pathname === '/v1/lease/acquire') {
        acquireCalls.push(body);
        const sid = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : `agent-${++secretSeq}`;
        const ownerId = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : null;
        const label = typeof body.label === 'string' && body.label ? body.label : 'omp';

        if (ctrl.state !== 'idle' && ctrl.lease) {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            code: 'seat_busy',
            generation: ctrl.generation,
            state: ctrl.state,
            epoch: ctrl.epoch,
            lease: publicLease(ctrl.lease),
            message: ctrl.state === 'human' ? 'Seat is held by a human.' : 'Seat is held by another agent.',
          }));
          return;
        }

        const secret = `${SECRET_PREFIX}${++secretSeq}-${crypto.randomBytes(6).toString('hex')}`;
        issuedSecrets.add(secret);
        ctrl.epoch += 1;
        ctrl.state = 'agent';
        ctrl.preempted = null;
        ctrl.lease = {
          holderKind: 'agent',
          leaseId: `agent-${ctrl.epoch}`,
          sessionId: sid,
          ownerId,
          holderId: ownerId ?? sid,
          label,
          pid: typeof body.pid === 'number' ? body.pid : null,
          pidStartTime: typeof body.pidStartTime === 'number' ? body.pidStartTime : null,
          expiresAt: new Date(Date.now() + 90_000).toISOString(),
          tokenHash: hashSecret(secret),
          rawSecret: secret,
        };
        ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'agent_acquire' });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          ...ctrl.snapshotPayload(),
          sessionId: sid,
          leaseId: ctrl.lease.leaseId,
          sessionSecret: secret,
          token: secret,
          heartbeatIntervalSec: 20,
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/claim-nonce') {
        claimNonceCalls.push(body);
        const sid = typeof body.sessionId === 'string' ? body.sessionId : '';
        const secret = typeof body.sessionSecret === 'string' ? body.sessionSecret : '';
        const target = (ctrl.lease?.sessionId === sid ? ctrl.lease : null)
          ?? (ctrl.preempted?.sessionId === sid ? ctrl.preempted : null);
        if (!target || target.holderKind !== 'agent') {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'lease_not_found', message: 'No matching agent lease.' }));
          return;
        }
        if (hashSecret(secret) !== target.tokenHash) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'forbidden', message: 'Invalid session secret.' }));
          return;
        }
        const claimNonce = `${NONCE_PREFIX}${++nonceSeq}-${crypto.randomBytes(6).toString('hex')}`;
        issuedNonces.add(claimNonce);
        const claimFile = path.join(claimDir, `claim-${nonceSeq}.json`);
        fs.writeFileSync(claimFile, JSON.stringify({
          sessionId: sid,
          claimNonce,
          requireRebind: body.requireRebind === true,
        }), { mode: 0o600 });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          claimFile,
          claimNonce,
          bindTimeoutSec: typeof body.bindTimeoutSec === 'number' ? body.bindTimeoutSec : 30,
          requireRebind: body.requireRebind === true,
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/bind') {
        bindCalls.push(body);
        const sid = typeof body.sessionId === 'string' ? body.sessionId : '';
        const secret = typeof body.sessionSecret === 'string' ? body.sessionSecret : '';
        const isActive = ctrl.lease?.sessionId === sid && ctrl.lease.holderKind === 'agent';
        const isDisplaced = ctrl.preempted?.sessionId === sid && ctrl.preempted.holderKind === 'agent';
        const target = isActive ? ctrl.lease! : isDisplaced ? ctrl.preempted! : null;
        if (!target) {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'lease_not_found', message: 'No matching agent lease.' }));
          return;
        }
        if (hashSecret(secret) !== target.tokenHash) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'forbidden', message: 'Invalid session secret.' }));
          return;
        }
        if (typeof body.ownerId === 'string' && body.ownerId) target.ownerId = body.ownerId;
        if (typeof body.label === 'string' && body.label) target.label = body.label;
        if (typeof body.pid === 'number') target.pid = body.pid;
        if (typeof body.pidStartTime === 'number') target.pidStartTime = body.pidStartTime;
        else if (typeof body.pidStartTime === 'string' && /^\d+$/.test(body.pidStartTime)) target.pidStartTime = Number(body.pidStartTime);
        ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'agent_bind' });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          ...ctrl.snapshotPayload(),
          target: isDisplaced ? 'displaced' : 'active',
          boundLease: publicLease(target),
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/cancel-preempted') {
        cancelPreemptedCalls.push(body);
        const sid = typeof body.sessionId === 'string' ? body.sessionId : '';
        const secret = typeof body.sessionSecret === 'string' ? body.sessionSecret : '';
        const force = body.force === true;
        if (ctrl.state === 'agent' && ctrl.lease && ctrl.lease.sessionId === sid) {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'lease_active', ...ctrl.snapshotPayload() }));
          return;
        }
        if (!ctrl.preempted || (sid && ctrl.preempted.sessionId !== sid)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, cancelled: false, ...ctrl.snapshotPayload() }));
          return;
        }
        if (!force && hashSecret(secret) !== ctrl.preempted.tokenHash) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'forbidden', message: 'Invalid session secret.' }));
          return;
        }
        const cancelled = publicPreempted(ctrl.preempted);
        ctrl.preempted = null;
        ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'preempted_cancelled', cancelled });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, cancelled: true, ...ctrl.snapshotPayload() }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/heartbeat') {
        heartbeatCalls.push(body);
        const sid = typeof body.sessionId === 'string' ? body.sessionId : null;
        const lid = typeof body.leaseId === 'string' ? body.leaseId : null;
        const secret = typeof body.sessionSecret === 'string'
          ? body.sessionSecret
          : typeof body.leaseToken === 'string' ? body.leaseToken : '';
        if (ctrl.state === 'human' && ctrl.preempted && sid === ctrl.preempted.sessionId) {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'lease_preempted', generation: ctrl.generation, state: 'human', epoch: ctrl.epoch }));
          return;
        }
        if (
          ctrl.lease
          && (ctrl.lease.leaseId === lid || ctrl.lease.sessionId === sid)
          && hashSecret(secret) === ctrl.lease.tokenHash
        ) {
          ctrl.lease.expiresAt = new Date(Date.now() + 90_000).toISOString();
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, generation: ctrl.generation, state: ctrl.state, epoch: ctrl.epoch, lease: publicLease(ctrl.lease) }));
          return;
        }
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'lease_lost', generation: ctrl.generation, state: ctrl.state, epoch: ctrl.epoch }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/takeover') {
        if (ctrl.state === 'human') {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'seat_busy', generation: ctrl.generation, state: 'human', epoch: ctrl.epoch, lease: publicLease(ctrl.lease) }));
          return;
        }
        const displaced = ctrl.state === 'agent' && ctrl.lease ? ctrl.lease : null;
        ctrl.preempted = displaced;
        ctrl.epoch += 1;
        ctrl.state = 'human';
        const leaseId = `human-${ctrl.epoch}`;
        const leaseToken = `human-tok-${ctrl.epoch}`;
        ctrl.lease = {
          holderKind: 'human',
          leaseId,
          sessionId: null,
          ownerId: null,
          holderId: 'jacob',
          label: typeof body.label === 'string' ? body.label : 'pi-dish',
          pid: null,
          pidStartTime: null,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          tokenHash: hashSecret(leaseToken),
          rawSecret: leaseToken,
        };
        if (displaced) {
          ctrl.emitEvent('preempted', {
            ...ctrl.snapshotPayload(),
            sessionId: displaced.sessionId,
            ownerId: displaced.ownerId,
            displaced: publicLease(displaced),
          });
        }
        ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'takeover' });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          ...ctrl.snapshotPayload(),
          leaseId,
          leaseToken,
          token: leaseToken,
          heartbeatIntervalSec: 60,
          viewer: { mode: 'interactive', ticket: `t-${++ticketSeq}`, path: `/viewer/#ticket=t-${ticketSeq}` },
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/release') {
        releaseCalls.push(body);
        const ident = (typeof body.leaseId === 'string' ? body.leaseId : null)
          || (typeof body.sessionId === 'string' ? body.sessionId : null);
        const token = (typeof body.leaseToken === 'string' ? body.leaseToken : null)
          || (typeof body.sessionSecret === 'string' ? body.sessionSecret : null)
          || (typeof body.token === 'string' ? body.token : '');
        const force = body.force === true;
        const handBack = body.handBack === true;
        if (ctrl.state === 'idle' || !ctrl.lease) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...ctrl.snapshotPayload(), alreadyIdle: true, handedBackTo: null }));
          return;
        }
        if (!force && ((ident !== ctrl.lease.leaseId && ident !== ctrl.lease.sessionId) || hashSecret(token) !== ctrl.lease.tokenHash)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'forbidden', message: 'Invalid lease credentials.' }));
          return;
        }
        const prev = publicLease(ctrl.lease);
        const wasHuman = ctrl.lease.holderKind === 'human';
        if (wasHuman && handBack && ctrl.preempted) {
          const restored = ctrl.preempted;
          ctrl.epoch += 1;
          ctrl.state = 'agent';
          ctrl.preempted = null;
          ctrl.lease = restored;
          const newPub = publicLease(restored);
          ctrl.emitEvent('hand_back', { ...ctrl.snapshotPayload(), handedBackTo: newPub });
          ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'hand_back' });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...ctrl.snapshotPayload(), handedBackTo: newPub }));
          return;
        }
        ctrl.epoch += 1;
        ctrl.state = 'idle';
        ctrl.lease = null;
        if (wasHuman) ctrl.preempted = null;
        ctrl.emitEvent('seat_idle', { ...ctrl.snapshotPayload(), reason: 'released', previous: prev });
        ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'released' });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...ctrl.snapshotPayload(), released: prev, handedBackTo: null }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
    });
  });

  try { fs.unlinkSync(socketPath); } catch {}
  await new Promise<void>(resolve => server.listen(socketPath, () => resolve()));
  return ctrl;
}

function writeFakeOmpScript(
  scriptPath: string,
  processIdentityPath: string,
  dirs: { envDir: string; cmdDir: string; holdRegisterFlag: string },
): void {
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { processIdentity } = require(${JSON.stringify(processIdentityPath)});

const home = process.env.HOME || os.homedir();
const args = process.argv.slice(2);
const envDir = ${JSON.stringify(dirs.envDir)};
const cmdDir = ${JSON.stringify(dirs.cmdDir)};
const holdRegisterFlag = ${JSON.stringify(dirs.holdRegisterFlag)};

if (!args.includes('--extension') && !args.includes('--resume')) {
  process.exit(0);
}

if (envDir) {
  fs.mkdirSync(envDir, { recursive: true });
  const envCopy = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') envCopy[k] = v;
  }
  fs.writeFileSync(path.join(envDir, \`\${process.pid}.json\`), JSON.stringify({
    pid: process.pid,
    startTime: processIdentity(process.pid)?.startTime ?? null,
    args,
    env: envCopy,
  }));
}

function startBridge() {
  const extIdx = args.indexOf('--extension');
  let wrapperToken = '';
  if (extIdx >= 0 && args[extIdx + 1]) {
    try {
      const src = fs.readFileSync(args[extIdx + 1], 'utf8');
      const m = src.match(/createHarnessBridge\\(("[a-f0-9]+")/);
      if (m) wrapperToken = JSON.parse(m[1]);
    } catch {}
  }
  const token = wrapperToken || process.env.PI_DISH_SPAWN_TOKEN || '';
  const resumeIdx = args.indexOf('--resume');
  const sessionDirIdx = args.indexOf('--session-dir');
  const sessionDir = sessionDirIdx >= 0 && args[sessionDirIdx + 1]
    ? args[sessionDirIdx + 1]
    : path.join(home, '.omp', 'agent', 'sessions', 'proj');
  let sessionFile;
  let sessionId;
  if (resumeIdx >= 0 && args[resumeIdx + 1]) {
    sessionFile = args[resumeIdx + 1];
    sessionId = path.basename(sessionFile, '.jsonl');
  } else {
    sessionId = '2026-11-25T00-00-00_' + (token.slice(0, 12) || crypto.randomBytes(6).toString('hex'));
    sessionFile = path.join(sessionDir, sessionId + '.jsonl');
  }
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  if (!fs.existsSync(sessionFile)) {
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({ type: 'title', title: 'CU OMP Session' }) + '\\n' +
      JSON.stringify({ type: 'session', id: sessionId, cwd: process.cwd() }) + '\\n',
    );
  }
  const regDir = path.join(home, '.pi', 'dish', 'sessions');
  const sockDir = path.join(home, '.pi', 'dish', 'sockets');
  fs.mkdirSync(regDir, { recursive: true });
  fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });
  const socketPath = path.join(sockDir, 'omp-' + process.pid + '.sock');
  const bridgeInstanceId = 'cu-test-' + token;
  const startTime = processIdentity(process.pid)?.startTime;
  const capabilities = {
    prompt: true, steer: true, followUp: true, followUpIfBusy: true, abort: true,
    models: true, setModel: true, setThinking: true, rename: true, commands: true,
    reload: false, queueCancel: false, treeNavigation: false,
  };
  try { fs.unlinkSync(socketPath); } catch {}
  const srv = net.createServer((sock) => {
    sock.write(JSON.stringify({
      type: 'hello',
      protocolVersion: 2,
      wrapper: { harnessId: 'omp', name: 'omp', wrapperVersion: 'test' },
      harnessId: 'omp',
      nativeSessionId: sessionId,
      sessionId,
      sessionFile,
      bridgeInstanceId,
      instanceId: bridgeInstanceId,
      pid: process.pid,
      startTime,
      socketPath,
      spawnToken: token,
      capabilities,
      turnInProgress: false,
    }) + '\\n');
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (cmdDir) {
          fs.mkdirSync(cmdDir, { recursive: true });
          fs.appendFileSync(path.join(cmdDir, sessionId + '.jsonl'), JSON.stringify({
            ts: Date.now(),
            pid: process.pid,
            command: msg.command,
            message: msg.message ?? null,
            deliverAs: msg.deliverAs ?? null,
          }) + '\\n');
        }
        if (msg.command === 'prompt') {
          sock.write(JSON.stringify({ type: 'response', id: msg.id, success: true, data: { admitted: true, queued: false } }) + '\\n');
        } else if (msg.command === 'get_commands') {
          sock.write(JSON.stringify({ type: 'response', id: msg.id, success: true, data: { commands: [] } }) + '\\n');
        } else {
          sock.write(JSON.stringify({ type: 'response', id: msg.id, success: true }) + '\\n');
        }
      }
    });
    sock.on('error', () => {});
  });
  srv.listen(socketPath, () => {
    const regFile = path.join(regDir, 'omp-' + sessionId + '-' + token + '.json');
    const regTmp = regFile + '.tmp';
    fs.writeFileSync(regTmp, JSON.stringify({
      protocolVersion: 2,
      wrapper: { harnessId: 'omp', name: 'omp', wrapperVersion: 'test' },
      harnessId: 'omp',
      nativeSessionId: sessionId,
      sessionId,
      bridgeInstanceId,
      instanceId: bridgeInstanceId,
      sessionFile,
      cwd: process.cwd(),
      pid: process.pid,
      startTime,
      socketPath,
      name: 'CU OMP Session',
      model: 'anthropic/claude-opus-4',
      launchArgs: args,
      spawnToken: token,
      capabilities,
    }));
    fs.renameSync(regTmp, regFile);
  });
}

if (holdRegisterFlag && fs.existsSync(holdRegisterFlag)) {
  const timer = setInterval(() => {
    if (!fs.existsSync(holdRegisterFlag)) {
      clearInterval(timer);
      startBridge();
    }
  }, 20);
} else {
  startBridge();
}
setInterval(() => {}, 1 << 30);
`;
  fs.writeFileSync(scriptPath, source, { mode: 0o755 });
}

async function waitFor<T>(fn: () => T | Promise<T>, label: string, timeoutMs = 8000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const val = await fn();
    if (val !== null && val !== undefined && val !== false) return val as NonNullable<T>;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function collectFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFilesRecursively(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test('unit: command delivery tracks pending vs acked, rechecks owner/PID, aborts on heartbeat 409, and resets on generation/resync', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-u1-'));
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  let hbStatus = 200;
  let hbBody: Record<string, unknown> = { ok: true, state: 'agent', epoch: 10, generation: 'gen-A' };
  let capturedBrokerSid = '';
  let capturedOwnerId = '';
  const abortTargets: CuAgentLeasesMod.CuCommandTarget[] = [];
  const resumeTargets: Array<{ target: CuAgentLeasesMod.CuCommandTarget; text: string }> = [];
  let failNextAbort = true;
  let processStillAlive = true;

  const mockBroker: CuBrokerMod.CuBrokerClient = {
    socketPath: () => '/tmp/mock.sock',
    configured: () => true,
    available: () => true,
    async requestJson(_method, pathname, body) {
      if (pathname === '/v1/lease/acquire') {
        const bodyObj = body ? record(body) : {};
        capturedBrokerSid = String(bodyObj.sessionId ?? 'cu-agent-u1');
        capturedOwnerId = String(bodyObj.ownerId ?? 'cu-owner-u1');
        return {
          status: 200,
          body: {
            ok: true,
            generation: 'gen-A',
            state: 'agent',
            epoch: 10,
            sessionId: capturedBrokerSid,
            leaseId: 'agent-10',
            sessionSecret: 'unit-secret-only-in-memory',
            heartbeatIntervalSec: 20,
            lease: { holderKind: 'agent', sessionId: capturedBrokerSid, ownerId: capturedOwnerId, label: BROKER_AGENT_LABEL },
          },
        };
      }
      if (pathname === '/v1/lease/claim-nonce') {
        return {
          status: 200,
          body: { ok: true, claimFile: path.join(tmpDir, 'claim-1.json'), claimNonce: 'unit-nonce-discarded' },
        };
      }
      if (pathname === '/v1/lease/bind') {
        return {
          status: 200,
          body: { ok: true, generation: 'gen-A', state: 'agent', epoch: 10, target: 'active' },
        };
      }
      if (pathname === '/v1/lease/heartbeat') {
        return { status: hbStatus, body: hbBody };
      }
      return { status: 200, body: { ok: true, state: 'idle', epoch: 99 } };
    },
    openEvents: () => null,
  };

  const leases = createCuAgentLeases({
    broker: mockBroker,
    storeFile: () => storePath,
    processAlive: () => processStillAlive,
    heartbeatIntervalMs: 40,
    livenessCheckMs: 0,
    commandRetryMs: 25,
    abortSession: async target => {
      abortTargets.push(target);
      if (failNextAbort) {
        failNextAbort = false;
        return false; // transient failure -> stays pending, NOT acked
      }
      assert.equal(target.isStillValid(), true);
      return true;
    },
    resumeSession: async (target, text) => {
      assert.equal(target.isStillValid(), true);
      resumeTargets.push({ target, text });
      return true;
    },
  });
  t.after(() => leases.stop());

  const sid = '~sk1_omp_unit_delivery';
  const handle = present(await leases.prepareSpawn({ knownSessionId: null }));
  // Verify handle.env carries ONLY claim file, opaque brokerSessionId, and non-identifying label — zero secret or nonce.
  assert.deepEqual(Object.keys(handle.env).sort(), ['CU_BROKER_CLAIM_FILE', 'CU_BROKER_LABEL', 'CU_BROKER_SESSION_ID']);
  assert.equal(handle.env.CU_BROKER_LABEL, BROKER_AGENT_LABEL);
  assert.equal(JSON.stringify(handle.env).includes('unit-secret-only-in-memory'), false);
  assert.equal(JSON.stringify(handle.env).includes('unit-nonce-discarded'), false);

  await leases.bindSpawnedProcess(handle, { pid: 4242, startTime: '987654321' });
  leases.attachSpawnedSession(handle, { sessionId: sid, pid: 4242, pidStartTime: '987654321' });

  // Preempt at epoch 11: first abort returns false (pending, not acked), retry succeeds once; duplicate at epoch 11 ignored.
  leases.handleBrokerEvent({
    eventName: 'preempted',
    authoritativeHello: false,
    generation: 'gen-A',
    payload: {
      generation: 'gen-A',
      state: 'human',
      epoch: 11,
      displaced: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
      preempted: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
    },
  });
  await waitFor(() => abortTargets.length === 2, 'retry delivered after transient abort failure');
  assert.equal(abortTargets[0].generation, 'gen-A');
  assert.equal(abortTargets[0].pid, 4242);
  assert.equal(abortTargets[0].pidStartTime, '987654321');

  // Duplicate event at same (gen-A, epoch 11) must NOT re-abort once acked.
  leases.handleBrokerEvent({
    eventName: 'hello',
    authoritativeHello: true,
    generation: 'gen-A',
    payload: {
      generation: 'gen-A',
      state: 'human',
      epoch: 11,
      preempted: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
    },
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(abortTargets.length, 2);

  // Hand back at epoch 12 -> one nudge, and previously captured abort target.isStillValid() is now false!
  leases.handleBrokerEvent({
    eventName: 'hand_back',
    authoritativeHello: false,
    generation: 'gen-A',
    payload: {
      generation: 'gen-A',
      state: 'agent',
      epoch: 12,
      lease: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
      handedBackTo: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
    },
  });
  await waitFor(() => resumeTargets.length === 1, 'hand_back nudge delivered');
  assert.equal(resumeTargets[0].text, CU_HAND_BACK_NUDGE);
  assert.equal(abortTargets[1].isStillValid(), false, 'old abort target is invalidated after hand-back');

  // Resync with ALL four reasons resets watermarks so a lower epoch (1 < 12) triggers cleanly!
  for (const [idx, reason] of (['generation_mismatch', 'cursor_too_old', 'cursor_ahead', 'subscriber_lagged'] as const).entries()) {
    const nextGen = reason === 'generation_mismatch' ? 'gen-B' : 'gen-B';
    const expectedAborts = abortTargets.length + 1;
    leases.handleBrokerEvent({
      eventName: 'resync',
      authoritativeHello: true,
      isResync: true,
      resyncReason: reason,
      generation: nextGen,
      generationChanged: reason === 'generation_mismatch',
      payload: {
        generation: nextGen,
        state: 'human',
        epoch: 1 + idx,
        preempted: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
      },
    });
    await waitFor(() => abortTargets.length === expectedAborts, `abort after resync (${reason})`);
  }

  // Return to holding, then simulate heartbeat 409 lease_lost -> MUST immediately abort without SSE!
  leases.handleBrokerEvent({
    eventName: 'hand_back',
    authoritativeHello: false,
    generation: 'gen-B',
    payload: {
      generation: 'gen-B',
      state: 'agent',
      epoch: 5,
      lease: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
      handedBackTo: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
    },
  });
  await waitFor(() => resumeTargets.length === 2, 'second hand_back nudge delivered');
  const abortsBeforeHb409 = abortTargets.length;
  hbStatus = 409;
  hbBody = { ok: false, code: 'lease_lost', generation: 'gen-B', state: 'idle', epoch: 6 };
  await waitFor(() => abortTargets.length === abortsBeforeHb409 + 1, 'heartbeat 409 triggers immediate abort');
  processStillAlive = false;
  assert.equal(abortTargets[abortTargets.length - 1].isStillValid(), false, 'dead process invalidates command target');
});

test('unit: restart reconciliation releases dead active orphans, cancels dead displaced orphans, re-adopts live ones, and handles cancel-preempted 409 lease_active race', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-reconcile-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Case 1: Dead active orphan -> persisted before crash, fresh manager reconciles and releases it.
  {
    const first = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: () => true,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: null }));
    await first.bindSpawnedProcess(h, { pid: 55001, startTime: '111111' });
    first.attachSpawnedSession(h, { sessionId: '~sk1_omp_private_never_persisted', pid: 55001, pidStartTime: '111111' });
    first.stop();

    // Verify durable store exists (0600) and contains NO secrets, NO nonces, NO route session IDs.
    const stat = fs.statSync(storePath);
    assert.equal(stat.mode & 0o777, 0o600);
    const rawStore = fs.readFileSync(storePath, 'utf8');
    for (const secret of broker.issuedSecrets) assert.equal(rawStore.includes(secret), false);
    for (const nonce of broker.issuedNonces) assert.equal(rawStore.includes(nonce), false);
    assert.equal(rawStore.includes('private_never_persisted'), false);
    assert.equal(rawStore.includes(present(h.leaseOwnerId)), true);

    const restarted = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: () => false, // process died across restart
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    await restarted.reconcile();
    assert.equal(broker.state, 'idle', 'dead active orphan released on startup reconcile');
    restarted.stop();
  }

  // Case 2: Dead displaced orphan while human holds seat -> cancel-preempted leaves human lease intact!
  {
    const first = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: () => true,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: null }));
    await first.bindSpawnedProcess(h, { pid: 55002, startTime: '222222' });
    await client.requestJson('POST', '/v1/lease/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(broker.state, 'human');
    assert.ok(broker.preempted, 'agent is displaced before restart');
    first.stop();

    const restarted = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: () => false,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    await restarted.reconcile();
    assert.equal(broker.state, 'human', 'human lease untouched after cancelling dead displaced orphan');
    assert.equal(broker.preempted, null, 'dead displaced orphan removed from preempted slot');
    restarted.stop();

    // Release human seat cleanly for Case 3.
    await client.requestJson('POST', '/v1/lease/release', { leaseId: broker.lease!.leaseId, force: true });
    assert.equal(broker.state, 'idle');
  }

  // Case 3: Live active process -> re-adopted across restart, exposes ownerIdForSession, and close releases it.
  {
    const first = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: () => true,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: null }));
    await first.bindSpawnedProcess(h, { pid: 55003, startTime: '333333' });
    const ownerId = present(h.leaseOwnerId);
    first.stop();

    const restarted = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: proc => proc.pid === 55003 && proc.startTime === '333333',
      findSessionIdByProcess: proc => (proc.pid === 55003 && proc.startTime === '333333' ? '~sk1_omp_live_adopted' : null),
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    await restarted.reconcile();
    assert.equal(broker.state, 'agent', 'live process lease preserved on reconcile');
    assert.equal(restarted.ownerIdForSession('~sk1_omp_live_adopted'), ownerId, 're-adopted session exposes exact ownerId');

    // Race test: mark record preempted locally while broker already handed back (state === 'agent') ->
    // releaseSession calls cancel-preempted, gets 409 lease_active, and falls back to release!
    await restarted.releaseSession('~sk1_omp_live_adopted');
    assert.equal(broker.state, 'idle', 're-adopted live session releases cleanly without persisted secret');
    restarted.stop();
  }

  // Case 4: cancel-preempted `409 lease_active` race with active secret falls back to `POST /v1/lease/release`.
  {
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: () => true,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    const h = present(await mgr.prepareSpawn({ knownSessionId: null }));
    await mgr.bindSpawnedProcess(h, { pid: 55004, startTime: '444444' });
    mgr.attachSpawnedSession(h, { sessionId: '~sk1_omp_race', pid: 55004, pidStartTime: '444444' });
    // Tell manager it is preempted while broker is actually already back in `agent` state (simulates hand-back race).
    mgr.handleBrokerEvent({
      eventName: 'preempted',
      authoritativeHello: false,
      generation: broker.generation,
      payload: {
        generation: broker.generation,
        state: 'human',
        epoch: broker.epoch + 1,
        preempted: { ownerId: h.leaseOwnerId, sessionId: h.brokerSessionId, label: 'omp' },
      },
    });
    const cancelCountBefore = broker.cancelPreemptedCalls.length;
    await mgr.releaseSession('~sk1_omp_race');
    assert.equal(broker.cancelPreemptedCalls.length, cancelCountBefore + 1, 'attempted cancel-preempted first');
    assert.equal(broker.state, 'idle', '409 lease_active race fell back to release and freed the seat');
    mgr.stop();
  }
});

test('unit: watcher sends Last-Event-ID gen:cursor, forwards resync, writes atomic SSE frames with backpressure, and missing configured socket fails closed (503)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-sse-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. Configured-but-missing socket is NOT "not a CU host": fail closed with 503.
  const missingSock = path.join(tmpDir, 'missing.sock');
  const missingBroker = createCuBrokerClient({ socketPath: () => missingSock });
  assert.equal(missingBroker.configured(), true);
  assert.equal(missingBroker.available(), false);
  await assert.rejects(
    () => missingBroker.requestJson('GET', '/v1/status'),
    (err: unknown) => errorStatus(err, 0) === 503,
  );
  const missingLeases = createCuAgentLeases({
    broker: missingBroker,
    storeFile: () => path.join(tmpDir, 'missing-store.json'),
    abortSession: async () => true,
    resumeSession: async () => true,
  });
  assert.equal(missingLeases.configured(), true);
  await assert.rejects(
    () => missingLeases.prepareSpawn({ knownSessionId: null }),
    err => err instanceof CuBrokerUnavailableError && err.status === 503,
  );
  missingLeases.stop();

  // 2. Watcher sends Last-Event-ID: <gen>:<cursor> on reconnect and forwards resync to /api/cu/stream!
  const watcherEvents: CuAgentLeasesMod.CuBrokerEvent[] = [];
  const brokerClient = createCuBrokerClient({ socketPath: () => sockPath });
  const handlers = createCuHandlers({
    broker: brokerClient,
    upgradeAuthorized: () => true,
    onBrokerEvent: ev => watcherEvents.push(ev),
    sseDrainTimeoutMs: 60,
    sseMaxBufferedBytes: 512,
  });
  t.after(() => handlers.stop());

  await waitFor(() => broker.eventsRequests.length >= 1 && watcherEvents.length >= 1, 'initial watcher hello');
  // Advance broker cursor and drop SSE to force reconnect with Last-Event-ID.
  broker.epoch = 5;
  broker.emitEvent('lease_changed', { ...broker.snapshotPayload(), reason: 'test' });
  await waitFor(() => watcherEvents.some(e => e.eventName === 'lease_changed'), 'watcher saw cursor 1');

  // Restart broker generation so reconnect receives `event: resync` (generation_mismatch) with epoch 0!
  broker.restartGeneration('gen-2', 0);
  broker.dropSseClients();
  await waitFor(() => broker.eventsRequests.length >= 2, 'watcher reconnected');
  assert.equal(broker.eventsRequests[1].lastEventId, 'gen-1:1', 'watcher sent Last-Event-ID gen:cursor');
  assert.equal(broker.eventsRequests[1].generation, 'gen-1');
  assert.equal(broker.eventsRequests[1].cursor, '1');
  await waitFor(
    () => watcherEvents.some(e => e.eventName === 'resync' && e.isResync === true && e.generation === 'gen-2'),
    'watcher received and decoded generation_mismatch resync',
  );

  // 3. Atomic SSE frames & backpressure on `/api/cu/stream`:
  // Verify each event is written in a SINGLE `res.write(frame)` call, and backpressure (`write() => false`)
  // pauses/resumes on drain and evicts permanently stalled clients after `sseDrainTimeoutMs`.
  const writes: string[] = [];
  let stalled = false;
  let ended = false;
  const fakeRes = new EventEmitter() as unknown as http.ServerResponse & EventEmitter;
  Object.assign(fakeRes, {
    writableEnded: false,
    destroyed: false,
    status: () => fakeRes,
    json: () => fakeRes,
    setHeader: () => {},
    flushHeaders: () => {},
    write(chunk: string) {
      writes.push(String(chunk));
      return !stalled;
    },
    end() {
      ended = true;
      (fakeRes as unknown as { writableEnded: boolean }).writableEnded = true;
      fakeRes.emit('close');
    },
  });
  const fakeReq = Object.assign(new EventEmitter(), {
    headers: {},
    query: {},
  }) as unknown as Parameters<CuHandlersMod.CuHandlers['stream']>[0];

  handlers.stream(fakeReq, fakeRes as unknown as Parameters<CuHandlersMod.CuHandlers['stream']>[1], () => {});
  await waitFor(() => writes.some(w => w.includes('event: hello')), 'initial atomic hello frame');
  assert.ok(writes[0].endsWith('\n\n') && writes[0].includes('event: hello') && writes[0].includes('data: '), 'hello written as one atomic SSE frame');

  // Trigger subscriber_lagged resync while client is healthy -> forwarded atomically!
  broker.emitResync('subscriber_lagged');
  await waitFor(() => writes.some(w => w.includes('event: resync') && w.includes('subscriber_lagged')), 'resync forwarded to browser stream');
  const resyncFrame = present(writes.find(w => w.includes('event: resync')));
  assert.ok(resyncFrame.endsWith('\n\n'), 'resync written as one atomic SSE frame');

  // Now stall the client -> drain timeout evicts it cleanly.
  stalled = true;
  broker.emitEvent('lease_changed', { ...broker.snapshotPayload(), reason: 'backpressure_test' });
  await waitFor(() => ended, 'stalled SSE client evicted on drain timeout');
});

test('unit: 409 seat_busy and 503 CuBrokerUnavailableError never poison hibernation or recovery records', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-nonpoison-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // 1. Hibernation wake preserves hibernated record when resume throws CuSeatBusyError or CuBrokerUnavailableError.
  const hibRouteId = routeSessionId('omp', '2026-11-25T00-00-00_cu_hib_test' as NativeSessionId);
  const hibFile = path.join(dishDir(), 'hibernation.json');
  fs.mkdirSync(path.dirname(hibFile), { recursive: true });
  fs.writeFileSync(hibFile, JSON.stringify({
    [hibRouteId]: {
      hibernatedAt: new Date(Date.now() - 5000).toISOString(),
      reason: 'memory pressure',
      freedBytes: 1024 * 1024,
      discarded: [],
    },
  }));
  t.after(() => { try { fs.unlinkSync(hibFile); } catch {} });
  let resumeAttempt = 0;
  const hib = createSessionHibernation({
    readSettings: () => ({}),
    readMeminfo: () => null,
    candidates: () => [],
    viewers: () => 0,
    capture: () => null,
    paneAttached: async () => false,
    inspect: async () => ({ eligible: false }),
    execute: async () => {},
    resume: async () => {
      resumeAttempt += 1;
      if (resumeAttempt === 1) throw new CuSeatBusyError('Seat busy', { state: 'agent', epoch: 2, holder: null });
      if (resumeAttempt === 2) throw new CuBrokerUnavailableError('Broker down');
    },
  });
  await assert.rejects(() => hib.wake(hibRouteId), err => err instanceof CuSeatBusyError);
  assert.equal(hib.isHibernated(hibRouteId), true, '409 seat_busy must not forget hibernated session');
  await assert.rejects(() => hib.wake(hibRouteId), err => err instanceof CuBrokerUnavailableError);
  assert.equal(hib.isHibernated(hibRouteId), true, '503 broker unavailable must not forget hibernated session');
  assert.equal(await hib.wake(hibRouteId), true, 'subsequent wake succeeds once seat is free');
  assert.equal(hib.isHibernated(hibRouteId), false);
  hib.stop();

  // 2. Recovery runner keeps status retryable ('failed', NOT 'needs-review') on CuSeatBusyError / CuBrokerUnavailableError.
  const nativeId = '2026-11-25T00-00-00_cu_rec_test';
  const ompSessionsDir = path.join(TEST_HOME, '.omp', 'agent', 'sessions', 'proj');
  fs.mkdirSync(ompSessionsDir, { recursive: true });
  const sessFile = path.join(ompSessionsDir, `${nativeId}.jsonl`);
  fs.writeFileSync(sessFile, JSON.stringify({ type: 'session', id: nativeId, cwd: TEST_CWD }) + '\n');
  t.after(() => { try { fs.unlinkSync(sessFile); } catch {} });
  recoveryStore.recordSession({
    harnessId: 'omp',
    nativeSessionId: nativeId,
    sessionFile: sessFile,
    cwd: TEST_CWD,
    pid: 999999,
    startTime: '12345',
    instanceId: 'inst-1',
    activity: 'idle',
  });
  let recoveryAttempt = 0;
  let recoveryRestored = false;
  const routeId = routeSessionId('omp', nativeId as NativeSessionId);
  const runner = createRecoveryRuntime({
    operations: {
      resumeSessionById: async () => {
        recoveryAttempt += 1;
        if (recoveryAttempt === 1) throw new CuSeatBusyError('Seat busy', { state: 'agent', epoch: 3, holder: null });
        if (recoveryAttempt === 2) throw new CuBrokerUnavailableError('Broker down');
        recoveryRestored = true;
        return { success: true, id: routeId };
      },
      probeRecoveryLive: async () => (recoveryRestored ? { alive: true, proc: { pid: process.pid } } : null),
      restartSessionById: async () => ({ status: 200, body: {} }),
      closeSessionById: async () => ({ status: 200, body: {} }),
      createSession: async () => ({ id: routeId }),
      startAsyncSessionSpawn: () => ({ spawnId: 's', status: 'starting' }),
      getSpawnStatus: () => null,
      admitHttpAction: () => null,
      waitBounceActionUnlock: async () => {},
      activeOperations: () => [],
      isSessionClosing: () => false,
      isSessionResuming: () => false,
    } as unknown as Parameters<typeof createRecoveryRuntime>[0]['operations'],
    ownership: {
      getLiveSession: async () => null,
      getRegisteredSession: () => null,
    } as unknown as Parameters<typeof createRecoveryRuntime>[0]['ownership'],
    getMode: () => 'manual',
    hibernated: () => false,
  });

  const first = await runner.retry(routeId);
  assert.equal(first.status, 'failed', `409 seat_busy leaves recovery retryable (got: ${first.status} / ${first.reason})`);
  assert.equal(recoveryAttempt, 1);
  const second = await runner.retry(routeId);
  assert.equal(second.status, 'failed', `503 broker unavailable leaves recovery retryable (got: ${second.status} / ${second.reason})`);
  assert.equal(recoveryAttempt, 2);
  const third = await runner.retry(routeId);
  assert.equal(third.status, 'restored', `subsequent recovery retry succeeds once seat is free (got: ${third.status} / ${third.reason})`);
  assert.equal(recoveryAttempt, 3);
  runner.stop();
});

test('end-to-end: zero secret/nonce leakage in tmux & omp, prompt bind, requireRebind on restart, cancel-preempted on close-while-displaced, private PIN isolation, typed async refusal, and waiting-for-desktop', async (t) => {
  writeFakeOmpScript(TEST_FAKE_OMP_PATH, path.resolve(__dirname, '..', 'lib', 'process-identity.js'), {
    envDir: TEST_ENV_DIR,
    cmdDir: TEST_CMD_DIR,
    holdRegisterFlag: TEST_HOLD_REGISTER_FLAG,
  });
  const broker = await startFakeCuBroker(TEST_BROKER_SOCK, TEST_CLAIM_DIR);

  const capturedLogs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const capture = (orig: (...args: unknown[]) => void) => (...args: unknown[]) => {
    capturedLogs.push(args.map(arg => (typeof arg === 'string' ? arg : (() => { try { return JSON.stringify(arg); } catch { return String(arg); } })())).join(' '));
    orig(...args);
  };
  console.log = capture(origLog);
  console.warn = capture(origWarn);
  console.error = capture(origError);

  const server: import('node:http').Server = require('../server.js');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const headlessSock = path.join(TEST_TMUX_DIR, 'pi-dish');

  let browserStreamReq: http.ClientRequest | null = null;
  t.after(async () => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    if (browserStreamReq) { try { browserStreamReq.destroy(); } catch {} browserStreamReq = null; }
    try { fs.unlinkSync(TEST_HOLD_REGISTER_FLAG); } catch {}
    try { execFileSync('tmux', ['-S', headlessSock, 'kill-server'], { stdio: 'ignore' }); } catch {}
    await new Promise<void>(resolve => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
    await broker.close();
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    fs.rmSync(TEST_TMUX_DIR, { recursive: true, force: true });
    fs.rmSync(TEST_SOCK_DIR, { recursive: true, force: true });
  });

  const apiGet = async (urlPath: string, headers: Record<string, string> = {}) => {
    const res = await fetch(base + urlPath, { headers });
    const text = await res.text();
    return { status: res.status, text, json: (() => { try { return JSON.parse(text) as unknown; } catch { return null; } })() };
  };
  const apiPost = async (urlPath: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + urlPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, json: (() => { try { return JSON.parse(text) as unknown; } catch { return null; } })() };
  };
  const apiPut = async (urlPath: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + urlPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, json: (() => { try { return JSON.parse(text) as unknown; } catch { return null; } })() };
  };
  const readCapturedEnvs = (): Array<{ pid: number; startTime: string | null; args: string[]; env: Record<string, string> }> => {
    if (!fs.existsSync(TEST_ENV_DIR)) return [];
    return fs.readdirSync(TEST_ENV_DIR).sort().map(name => JSON.parse(fs.readFileSync(path.join(TEST_ENV_DIR, name), 'utf8')));
  };
  const readCommands = (nativeSessionId: string): Array<Record<string, unknown>> => {
    const file = path.join(TEST_CMD_DIR, `${nativeSessionId}.jsonl`);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  };
  const nativeIdOf = (routeId: string): string => resolveSessionRoute(routeId).nativeSessionId;

  await waitFor(() => broker.sseClients.size >= 1, 'broker epoch watcher connected');

  const browserStreamChunks: string[] = [];
  browserStreamReq = http.get(`${base}/api/cu/stream`, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => browserStreamChunks.push(chunk));
  });
  await waitFor(() => browserStreamChunks.join('').includes('event: hello'), 'browser /api/cu/stream hello');

  // 1. Spawn managed omp while bridge registration is briefly held -> prove POST /v1/lease/bind runs PROMPTLY right after spawnInTmux!
  fs.writeFileSync(TEST_HOLD_REGISTER_FLAG, '1');
  const spawn1Promise = apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD });
  await waitFor(() => broker.bindCalls.length === 1, 'POST /v1/lease/bind called right after spawnInTmux before bridge registration');
  assert.equal(broker.claimNonceCalls.length, 1);
  assert.equal(broker.claimNonceCalls[0].requireRebind, false);
  assert.equal(typeof broker.bindCalls[0].pid, 'number');
  assert.ok(Number(broker.bindCalls[0].pid) > 1);
  assert.equal(broker.bindCalls[0].label, BROKER_AGENT_LABEL);
  // Release bridge registration now that prompt bind has already completed.
  fs.unlinkSync(TEST_HOLD_REGISTER_FLAG);

  const spawn1 = await spawn1Promise;
  assert.equal(spawn1.status, 200, spawn1.text);
  const sid1 = String(record(spawn1.json).id);
  const native1 = nativeIdOf(sid1);
  const ownerId1 = present(broker.lease?.ownerId);
  assert.equal(broker.bindCalls.length, 1, 'bound ONCE right after spawnInTmux (no second bind on attach)');
  assert.equal(broker.lease?.label, BROKER_AGENT_LABEL, 'broker label never carries route or session id');
  assert.equal(ownerId1.includes(native1), false, 'ownerId is opaque, never contains native session id');
  assert.equal(ownerId1.includes(sid1), false, 'ownerId is opaque, never contains route session id');

  // Verify /api/sessions active row carries opaque cuOwnerId matching broker.lease.ownerId.
  const list1 = await apiGet('/api/sessions');
  assert.equal(list1.status, 200);
  const row1 = present(records(record(list1.json).active).find(r => r.id === sid1));
  assert.equal(row1.cuOwnerId, ownerId1);

  // 2. PROOF OF ZERO SECRET / NONCE LEAKAGE across omp env, tmux show-environment, sibling window, and /proc cmdlines!
  const envs1 = readCapturedEnvs();
  assert.equal(envs1.length, 1);
  const env1 = envs1[0];
  assert.equal(env1.env.CU_BROKER_SESSION_ID, broker.lease?.sessionId);
  assert.equal(env1.env.CU_BROKER_LABEL, BROKER_AGENT_LABEL);
  assert.equal(typeof env1.env.CU_BROKER_CLAIM_FILE, 'string');
  assert.ok(fs.existsSync(env1.env.CU_BROKER_CLAIM_FILE), 'claim file exists on disk');
  assert.equal(Object.prototype.hasOwnProperty.call(env1.env, 'CU_BROKER_SESSION_SECRET'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(env1.env, 'CU_BROKER_CLAIM_NONCE'), false);

  const tmuxGlobalEnv = execFileSync('tmux', ['-S', headlessSock, 'show-environment', '-g'], { encoding: 'utf8' });
  const tmuxSessionList = execFileSync('tmux', ['-S', headlessSock, 'list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const tmuxSessionEnvs = tmuxSessionList.map(name => execFileSync('tmux', ['-S', headlessSock, 'show-environment', '-t', name], { encoding: 'utf8' })).join('\n');
  const siblingEnvFile = path.join(TEST_HOME, 'sibling-window-env.txt');
  execFileSync('tmux', ['-S', headlessSock, 'new-window', '-d', '-t', tmuxSessionList[0], `env > ${JSON.stringify(siblingEnvFile)}`]);
  const siblingEnv = await waitFor(
    () => (fs.existsSync(siblingEnvFile) && fs.readFileSync(siblingEnvFile, 'utf8').length > 0 ? fs.readFileSync(siblingEnvFile, 'utf8') : null),
    'sibling tmux window env dumped',
  );
  const tmuxServerPid = Number(execFileSync('tmux', ['-S', headlessSock, 'display-message', '-p', '#{pid}'], { encoding: 'utf8' }).trim());
  const tmuxServerCmdline = fs.existsSync(`/proc/${tmuxServerPid}/cmdline`)
    ? fs.readFileSync(`/proc/${tmuxServerPid}/cmdline`, 'utf8')
    : '';
  const ompCmdline = fs.existsSync(`/proc/${env1.pid}/cmdline`)
    ? fs.readFileSync(`/proc/${env1.pid}/cmdline`, 'utf8')
    : '';

  // Sibling window and tmux environments must not inherit CU_BROKER_* variables at all.
  assert.equal(/^CU_BROKER_/m.test(tmuxGlobalEnv), false);
  assert.equal(/^CU_BROKER_/m.test(tmuxSessionEnvs), false);
  assert.equal(/^CU_BROKER_/m.test(siblingEnv), false);

  // 3. Typed async refusal when seat is busy by another agent!
  const asyncBusy = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD, async: true });
  assert.equal(asyncBusy.status, 202, asyncBusy.text);
  const busySpawnId = String(record(asyncBusy.json).spawnId);
  const busyStatus = await waitFor(async () => {
    const r = await apiGet(`/api/session-spawns/${encodeURIComponent(busySpawnId)}`);
    const body = record(r.json);
    return body.status !== 'starting' ? body : null;
  }, 'typed async seat_busy refusal');
  assert.equal(busyStatus.status, 'error');
  assert.equal(busyStatus.code, 'seat_busy');
  assert.equal(busyStatus.httpStatus, 409);
  assert.equal(busyStatus.state, 'agent');
  assert.equal(typeof busyStatus.epoch, 'number');
  assert.ok(record(busyStatus.holder).ownerId === ownerId1);
  assert.equal(readCapturedEnvs().length, 1, 'no second omp spawned on seat_busy');

  // 4. Restart (`respawnPane`) uses `requireRebind: true` and binds again with the NEW pane PID!
  const restart1 = await apiPost(`/api/sessions/${encodeURIComponent(sid1)}/restart`, {});
  assert.equal(restart1.status, 200, restart1.text);
  assert.equal(broker.claimNonceCalls.length, 2, 'restart minted fresh claim nonce');
  assert.equal(broker.claimNonceCalls[1].requireRebind, true, 'restart sets requireRebind: true');
  assert.equal(broker.bindCalls.length, 2, 'restart binds new pane process');
  assert.notEqual(broker.bindCalls[1].pid, broker.bindCalls[0].pid, 'restart bound new PID');

  // 5. Takeover -> 1 abort; Hand back -> 1 nudge (idempotent across reconnect).
  const takeover1 = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
  assert.equal(takeover1.status, 200, takeover1.text);
  const humanLease1 = String(record(takeover1.json).leaseId);
  const humanToken1 = String(record(takeover1.json).leaseToken);
  await waitFor(() => readCommands(native1).filter(c => c.command === 'abort').length === 1, 'one abort after takeover');

  broker.dropSseClients();
  await waitFor(() => broker.sseClients.size >= 1, 'watcher reconnected while preempted');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(readCommands(native1).filter(c => c.command === 'abort').length, 1, 'reconnect must not duplicate abort');

  const release1 = await apiPost('/api/cu/release', { leaseId: humanLease1, leaseToken: humanToken1, handBack: true });
  assert.equal(release1.status, 200, release1.text);
  await waitFor(() => readCommands(native1).filter(c => c.command === 'prompt').length === 1, 'one nudge after hand-back');
  assert.equal(readCommands(native1).find(c => c.command === 'prompt')?.message, CU_HAND_BACK_NUDGE);

  // 6. Close while displaced -> calls POST /v1/lease/cancel-preempted, human keeps seat, hand-back yields idle (NOT closed agent)!
  const takeover2 = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
  assert.equal(takeover2.status, 200, takeover2.text);
  const humanLease2 = String(record(takeover2.json).leaseId);
  const humanToken2 = String(record(takeover2.json).leaseToken);
  await waitFor(() => readCommands(native1).filter(c => c.command === 'abort').length === 2, 'second takeover abort');
  assert.ok(broker.preempted, 'agent is displaced before close');

  const cancelBeforeClose = broker.cancelPreemptedCalls.length;
  const closeDisplaced = await apiPost(`/api/sessions/${encodeURIComponent(sid1)}/close`, {});
  assert.equal(closeDisplaced.status, 200, closeDisplaced.text);
  await waitFor(() => broker.cancelPreemptedCalls.length === cancelBeforeClose + 1, 'cancel-preempted called on close-while-displaced');
  assert.equal(broker.state, 'human', 'closing displaced agent does NOT disturb active human lease');
  assert.equal(broker.preempted, null, 'displaced agent cleared from broker preempted slot');

  // While human still holds seat, spawning a new omp enters waiting_for_desktop without claim file or secret.
  const waitingSpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD });
  assert.equal(waitingSpawn.status, 200, waitingSpawn.text);
  assert.equal(record(waitingSpawn.json).cuSeat, 'waiting_for_desktop');
  const waitingSid = String(record(waitingSpawn.json).id);
  const waitingEnv = readCapturedEnvs().at(-1)!;
  assert.equal(Object.prototype.hasOwnProperty.call(waitingEnv.env, 'CU_BROKER_CLAIM_FILE'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(waitingEnv.env, 'CU_BROKER_SESSION_SECRET'), false);
  const waitingList = await apiGet('/api/sessions');
  const waitingRow = present(records(record(waitingList.json).active).find(r => r.id === waitingSid));
  assert.equal(waitingRow.cuWaitingForDesktop, true);
  assert.equal(waitingRow.cuOwnerId, undefined);

  // Hand back from human -> seat becomes IDLE (closed displaced agent sid1 NEVER regains the seat!).
  const release2 = await apiPost('/api/cu/release', { leaseId: humanLease2, leaseToken: humanToken2, handBack: true });
  assert.equal(release2.status, 200, release2.text);
  assert.equal(record(release2.json).state, 'idle', 'hand-back returns to idle, NOT closed displaced agent');
  assert.equal(record(release2.json).handedBackTo, null);
  await apiPost(`/api/sessions/${encodeURIComponent(waitingSid)}/close`, {});

  // 7. Private (PIN-locked) session isolation: broker status/stream/audit/store NEVER see private session ID!
  const setPin = await apiPut('/api/private-sessions/pin', { pin: '2468' });
  assert.equal(setPin.status, 200, setPin.text);
  const unlock = await apiPost('/api/private-sessions/unlock', { pin: '2468' });
  assert.equal(unlock.status, 200, unlock.text);
  const unlockToken = String(record(unlock.json).token);
  const unlockHeaders = { 'x-pi-dish-private-unlock': unlockToken };

  const privSpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD, private: true }, unlockHeaders);
  assert.equal(privSpawn.status, 200, privSpawn.text);
  const privSid = String(record(privSpawn.json).id);
  const privNative = nativeIdOf(privSid);
  const privOwnerId = present(broker.lease?.ownerId);

  const lockedSessions = await apiGet('/api/sessions');
  assert.equal(records(record(lockedSessions.json).active).some(r => r.id === privSid), false, 'locked /api/sessions hides private row');
  const unlockedSessions = await apiGet('/api/sessions', unlockHeaders);
  const privRow = present(records(record(unlockedSessions.json).active).find(r => r.id === privSid));
  assert.equal(privRow.cuOwnerId, privOwnerId, 'unlocked /api/sessions exposes opaque cuOwnerId');

  const cuStatusReply = await apiGet('/api/cu/status');
  const cuAuditReply = await apiGet('/api/cu/audit');
  const cuStreamText = browserStreamChunks.join('');
  assert.equal(cuStatusReply.text.includes(privSid), false, 'private route ID absent from /api/cu/status');
  assert.equal(cuStatusReply.text.includes(privNative), false, 'private native ID absent from /api/cu/status');
  assert.equal(cuAuditReply.text.includes(privSid), false, 'private route ID absent from /api/cu/audit');
  assert.equal(cuAuditReply.text.includes(privNative), false, 'private native ID absent from /api/cu/audit');
  assert.equal(cuStreamText.includes(privSid), false, 'private route ID absent from /api/cu/stream');
  assert.equal(cuStreamText.includes(privNative), false, 'private native ID absent from /api/cu/stream');

  await apiPost(`/api/sessions/${encodeURIComponent(privSid)}/close`, {}, unlockHeaders);
  await waitFor(() => broker.state === 'idle', 'broker idle after private session close');

  // 8. Final exhaustive secret + nonce sweep across ALL artifacts!
  assert.ok(broker.issuedSecrets.size >= 2, 'broker issued agent secrets');
  assert.ok(broker.issuedNonces.size >= 3, 'broker issued claim nonces');
  const dishFilesContent = [
    ...collectFilesRecursively(path.join(TEST_HOME, '.pi', 'dish')),
    ...collectFilesRecursively(path.join(TEST_HOME, '.omp')),
  ].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const allEnvDumps = JSON.stringify(readCapturedEnvs());
  const allHttpAndLogs = [
    cuStatusReply.text,
    cuAuditReply.text,
    cuStreamText,
    lockedSessions.text,
    unlockedSessions.text,
    spawn1.text,
    privSpawn.text,
    capturedLogs.join('\n'),
  ].join('\n');

  const haystacks: Array<[string, string]> = [
    ['omp child envs', allEnvDumps],
    ['tmux global env', tmuxGlobalEnv],
    ['tmux session envs', tmuxSessionEnvs],
    ['sibling tmux window env', siblingEnv],
    ['tmux server /proc/cmdline', tmuxServerCmdline],
    ['omp /proc/cmdline', ompCmdline],
    ['~/.pi/dish + ~/.omp files', dishFilesContent],
    ['HTTP API replies, SSE stream, and server logs', allHttpAndLogs],
  ];
  for (const secret of broker.issuedSecrets) {
    for (const [where, content] of haystacks) {
      assert.equal(content.includes(secret), false, `sessionSecret leaked in ${where}`);
    }
  }
  for (const nonce of broker.issuedNonces) {
    for (const [where, content] of haystacks) {
      assert.equal(content.includes(nonce), false, `claimNonce leaked in ${where}`);
    }
  }
  assert.equal(cuAuditReply.text.includes('tokenHash'), false, 'tokenHash stripped from /api/cu/audit');
});

export {};
