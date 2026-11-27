/**
 * Focused tests for Computer-Use Slice 2 (guest-broker §9 contract — Round 2 hardened):
 * - Zero secrets or nonces in tmux argv/env, sibling tmux windows, omp child env,
 *   HTTP/SSE replies, persisted files, or logs (`CU_BROKER_CLAIM_FILE` only).
 * - P1-1: Fresh stop -> authenticated release/cancel -> acquire+claim+bind on managed CU restart
 *   (no requireRebind transfer; guard refusal mints nothing; busy seat refuses with typed 409 seat_busy).
 * - P1-2: Zero `force: true` release/cancel calls on re-adopted or secretless records.
 * - P1-3: Human-held seat refuses managed omp launch with typed 409 seat_busy (no waiting launch).
 * - P1-4: §9.1 capabilities array feature check before any mutation (Slice-1 legacy vs 503 outage).
 * - P1-5: Restart re-adoption strictly for routing to live claimed MCP peers (no heartbeats);
 *   unredeemed or expired sessions surface honest `cuDesktopAccessLost` state.
 * - P1-6: Single `(generation, cursor, epoch)` ordering rule ignores stale heartbeat 409 / delayed bind.
 * - P1-7: Gap `hello(resync_required)` + `event: resync` deduped to one reconcile / at most one abort;
 *   replay `hello` (no `id:`) does not drop targets before replayed events run.
 * - P1-8: Unbound targets refused; ambiguous nested omp descendants refused without dispatch.
 * - P1-9: Bind failure propagates `cleanup-incomplete` with known births and keeps writer quarantine.
 * - P1-10 (+ Fleet addendum): Strip reserved CU_BROKER_* from command & tmux -e, unset inherited
 *   CU_BROKER_* first (env -u), then set managed CU_BROKER_SESSION_ID, CU_BROKER_CLAIM_FILE, CU_BROKER_LABEL.
 * - Outage: Transport errors (`statusCode` 503/504, ECONNREFUSED/stale socket) classify as typed
 *   `CuBrokerUnavailableError`, keeping hibernation & recovery retryable without uncertain markers.
 * - SSE leak: Unconditional `activeBrokerStreams` teardown on every stream exit path.
 * - P3: Fake broker matches §9 framing (v1 + capabilities array, gap hello+resync, replay no-id hello,
 *   bind-time & pre-mutation reaping of dead births, `alreadyAbsent: true`, `mcpClaimed`/`claimedPid`).
 *
 * Run with: npm test -- test/cu-agent-leases.test.js
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import { execFileSync, spawn } from 'node:child_process';
import crypto = require('node:crypto');
import { EventEmitter } from 'node:events';
import fs = require('node:fs');
import http = require('node:http');
import net = require('node:net');
import os = require('node:os');
import path = require('node:path');
import type { NativeSessionId } from '../lib/contracts';
import type * as CuAgentLeasesMod from '../lib/cu-agent-leases';
import type * as CuBrokerMod from '../lib/cu-broker';
import type * as CuHandlersMod from '../lib/cu-handlers';
import type * as HibernationMod from '../lib/session-hibernation';
import type * as RecoveryRunnerMod from '../lib/recovery-runner';
import type * as RecoveryStoreMod from '../lib/session-recovery';
import type * as SessionLaunchMod from '../lib/session-launch';
import type * as SessionOperationsMod from '../lib/session-operations';
import type * as SessionOwnershipMod from '../lib/session-ownership';
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
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
for (const key of ['PI_DISH_URL', 'PI_DISH_SHARE_PORT', 'PI_DISH_SHARE_HOST', 'PI_DISH_SHARE_BASE_URL', 'PI_DISH_TERMINAL']) {
  delete process.env[key];
}
process.env.PRIME_AGENT_DAEMON_SOCKET = path.join(TEST_HOME, 'no-prime-daemon.sock');
process.env.PI_DISH_AGY_COMMAND = path.join(TEST_HOME, 'no-agy');
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
  CuLeaseCheckingError,
  CuSeatBusyError,
  CU_HAND_BACK_NUDGE,
  BROKER_AGENT_LABEL,
  REQUIRED_SLICE2_CAPABILITIES,
  SLICE2B_CAPABILITIES,
}: typeof CuAgentLeasesMod = require('../lib/cu-agent-leases');
const { createCuBrokerClient }: typeof CuBrokerMod = require('../lib/cu-broker');
const { createCuHandlers }: typeof CuHandlersMod = require('../lib/cu-handlers');
const { createSessionHibernation }: typeof HibernationMod = require('../lib/session-hibernation');
const { createRecoveryRuntime }: typeof RecoveryRunnerMod = require('../lib/recovery-runner');
const recoveryStore: typeof RecoveryStoreMod = require('../lib/session-recovery');
const { createSessionLaunch, LaunchError }: typeof SessionLaunchMod = require('../lib/session-launch');
const { createSessionOperations }: typeof SessionOperationsMod = require('../lib/session-operations');
const { LifecycleInterruption, OwnershipRefusal, routeSessionId }: typeof SessionOwnershipMod = require('../lib/session-ownership');
const tmux: typeof import('../lib/tmux') = require('../lib/tmux');
const { resolveSessionRoute }: typeof import('../lib/session-key') = require('../lib/session-key');
const { dishDir }: typeof import('../lib/dish-store') = require('../lib/dish-store');
const { errorStatus, httpError }: typeof import('../lib/http-boundary') = require('../lib/http-boundary');
const { processIdentity, processIdentityAlive }: typeof import('../lib/process-identity') = require('../lib/process-identity');

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
  mcpClaimed: boolean;
  claimedPid: number | null;
  allowReclaim?: boolean;
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

interface FakeBrokerClaim {
  claimId: string;
  claimFile: string;
  claimNonce: string;
  sessionId: string;
  expectedPid: number | null;
  expectedPidStartTime: number | null;
  requireRebind: boolean;
  staged: boolean;
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
  /** P1-4: Omit Slice-2 capabilities array from `/v1/status` to simulate a responding Slice-1 broker. */
  slice1Mode: boolean;
  /** Slice 2b advertised capabilities (empty by default so existing tests model an old Slice-2 broker). */
  readonly slice2bCapabilities: Set<string>;
  /** Active and staged claims tracked by sessionId. */
  readonly activeClaims: Map<string, FakeBrokerClaim>;
  readonly stagedClaims: Map<string, FakeBrokerClaim>;
  /** P3: When true, reap dead OS births via `processIdentityAlive` before mutations and status. */
  enforceRealPids: boolean;
  /** P3: Synthetic dead births (`"pid:startTime"`) reaped before mutations and status. */
  readonly deadBirths: Set<string>;
  reapedPidDeadCount: number;
  /** Fault injection hooks (one-shot, consumed on next matching call). */
  nextAcquireError: { status: number; body: Record<string, unknown>; commitBeforeError?: boolean } | null;
  nextClaimNonceError: { status: number; body: Record<string, unknown> } | null;
  nextBindError: { status: number; body: Record<string, unknown>; commitBeforeError?: boolean } | null;
  nextReleaseError: { status: number; body: Record<string, unknown>; reapToIdleFirst?: boolean } | null;
  nextRenewError: { status: number; body: Record<string, unknown> } | null;
  nextTakeoverError: { status: number; body: Record<string, unknown> } | null;
  /** Inject HTTP error status on `GET /v1/events` for SSE failure teardown tests. */
  eventsErrorStatus: number | null;
  /** Hold `GET /v1/events` responses until released (tests pending-stream browser disconnect teardown). */
  holdEventsResponses: boolean;
  readonly pendingEventsRes: http.ServerResponse[];
  statusCalls: number;
  readonly acquireCalls: Array<Record<string, unknown>>;
  readonly claimNonceCalls: Array<Record<string, unknown>>;
  readonly bindCalls: Array<Record<string, unknown>>;
  readonly abortStagedCalls: Array<Record<string, unknown>>;
  readonly renewCalls: Array<Record<string, unknown>>;
  readonly heartbeatCalls: Array<Record<string, unknown>>;
  readonly releaseCalls: Array<Record<string, unknown>>;
  readonly cancelPreemptedCalls: Array<Record<string, unknown>>;
  readonly takeoverCalls: Array<Record<string, unknown>>;
  /** Records any 400 validation failure observed on Slice 2b endpoints. */
  readonly validationErrorCalls: Array<{ path: string; code: string; body: Record<string, unknown> }>;
  /** P1-2: Records every HTTP mutation that passed `force: true`. */
  readonly forcedMutationCalls: Array<{ path: string; body: Record<string, unknown> }>;
  readonly eventsRequests: FakeEventsRequest[];
  readonly issuedSecrets: Set<string>;
  readonly issuedNonces: Set<string>;
  readonly sseClients: Set<http.ServerResponse>;
  enableSlice2b(caps?: readonly string[]): void;
  disableSlice2b(): void;
  simulateMcpClaim(claimedPid: number, target?: 'active' | 'preempted'): void;
  simulateClaimedPeerReaped(target?: 'active' | 'preempted'): void;
  simulateClaimExpired(target?: 'active' | 'preempted'): void;
  setAllowReclaim(allow: boolean, target?: 'active' | 'preempted'): void;
  resetIdleForTest(): void;
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
  const pendingEventsRes: http.ServerResponse[] = [];
  const deadBirths = new Set<string>();
  const slice2bCapabilities = new Set<string>();
  const activeClaims = new Map<string, FakeBrokerClaim>();
  const stagedClaims = new Map<string, FakeBrokerClaim>();
  const acquireCalls: Array<Record<string, unknown>> = [];
  const claimNonceCalls: Array<Record<string, unknown>> = [];
  const bindCalls: Array<Record<string, unknown>> = [];
  const abortStagedCalls: Array<Record<string, unknown>> = [];
  const renewCalls: Array<Record<string, unknown>> = [];
  const heartbeatCalls: Array<Record<string, unknown>> = [];
  const releaseCalls: Array<Record<string, unknown>> = [];
  const cancelPreemptedCalls: Array<Record<string, unknown>> = [];
  const takeoverCalls: Array<Record<string, unknown>> = [];
  const validationErrorCalls: Array<{ path: string; code: string; body: Record<string, unknown> }> = [];
  const forcedMutationCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const eventsRequests: FakeEventsRequest[] = [];
  const issuedSecrets = new Set<string>();
  const issuedNonces = new Set<string>();
  const eventRing: FakeBufferedEvent[] = [];
  const takeoverReplays = new Map<string, { fingerprint: string; leaseId: string; response: Record<string, unknown> }>();
  let secretSeq = 0;
  let nonceSeq = 0;
  let ticketSeq = 0;

  function asciiJson(value: unknown): string {
    return JSON.stringify(value).replace(/[\u0080-\uffff]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  }

  function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
    res.writeHead(statusCode, { 'content-type': 'application/json' });
    res.end(slice2bCapabilities.size > 0 ? asciiJson(payload) : JSON.stringify(payload));
  }

  function sendValidationError(res: http.ServerResponse, reqPath: string, code: string, message: string, body: Record<string, unknown>): void {
    validationErrorCalls.push({ path: reqPath, code, body });
    sendJson(res, 400, { ok: false, code, message });
  }

  function parseExpectedStates(raw: unknown, allowed: ReadonlySet<string>): Set<string> | null | 'invalid' {
    if (raw === undefined) return null;
    const expand = (val: string): string[] | null => {
      if (!allowed.has(val)) return null;
      if (val === 'active') return ['agent', 'waiting_for_human'];
      if (val === 'preempted') return ['displaced'];
      return [val];
    };
    if (typeof raw === 'string') {
      const expanded = expand(raw);
      return expanded ? new Set(expanded) : 'invalid';
    }
    if (Array.isArray(raw) && raw.length > 0 && raw.every(v => typeof v === 'string')) {
      const out = new Set<string>();
      for (const item of raw) {
        const expanded = expand(item);
        if (!expanded) return 'invalid';
        for (const s of expanded) out.add(s);
      }
      return out;
    }
    return 'invalid';
  }

  function parseExpectedBirth(body: Record<string, unknown>): { pid: number; start: number } | null | 'invalid' {
    const hasPid = 'expectedPid' in body;
    const hasStart = 'expectedPidStartTime' in body;
    if (!hasPid && !hasStart) return null;
    if (hasPid !== hasStart) return 'invalid';
    const rawPid = body.expectedPid;
    const rawStart = body.expectedPidStartTime;
    if (typeof rawPid !== 'number' || !Number.isInteger(rawPid) || rawPid <= 1) return 'invalid';
    let start: number | null = null;
    if (typeof rawStart === 'number' && Number.isSafeInteger(rawStart) && rawStart >= 0) start = rawStart;
    else if (typeof rawStart === 'string' && /^\d+$/.test(rawStart)) start = Number(rawStart);
    if (start === null) return 'invalid';
    return { pid: rawPid, start };
  }

  function publicLease(lease: FakeBrokerLease | null): Record<string, unknown> | null {
    if (!lease) return null;
    const is2b = slice2bCapabilities.size > 0;
    return {
      holderKind: lease.holderKind,
      leaseId: lease.leaseId,
      sessionId: lease.sessionId,
      ownerId: lease.ownerId,
      holderId: lease.holderId,
      label: lease.label,
      pid: lease.pid,
      pidStartTime: lease.pidStartTime,
      mcpClaimed: lease.mcpClaimed,
      claimedPid: lease.claimedPid,
      ...(is2b
        ? {
          pendingClaim: lease.sessionId ? activeClaims.has(lease.sessionId) : false,
          stagedTransfer: lease.sessionId ? stagedClaims.has(lease.sessionId) : false,
          allowReclaim: lease.allowReclaim === true,
        }
        : {}),
      expiresAt: lease.expiresAt,
    };
  }

  function publicPreempted(lease: FakeBrokerLease | null): Record<string, unknown> | null {
    if (!lease) return null;
    const is2b = slice2bCapabilities.size > 0;
    return {
      sessionId: lease.sessionId,
      ownerId: lease.ownerId,
      leaseId: lease.leaseId,
      label: lease.label,
      pid: lease.pid,
      pidStartTime: lease.pidStartTime,
      mcpClaimed: lease.mcpClaimed,
      claimedPid: lease.claimedPid,
      ...(is2b
        ? {
          pendingClaim: lease.sessionId ? activeClaims.has(lease.sessionId) : false,
          stagedTransfer: lease.sessionId ? stagedClaims.has(lease.sessionId) : false,
          allowReclaim: lease.allowReclaim === true,
        }
        : {}),
    };
  }

  function revokeSessionClaims(sid: string | null): void {
    if (!sid) return;
    for (const map of [activeClaims, stagedClaims]) {
      const claim = map.get(sid);
      if (claim) {
        try { fs.unlinkSync(claim.claimFile); } catch {}
        map.delete(sid);
      }
    }
  }

  function isLeaseBirthDead(lease: FakeBrokerLease | null, deferSid?: string | null): boolean {
    if (!lease || lease.holderKind !== 'agent') return false;
    if (lease.pid === null || lease.pidStartTime === null) return false;
    // Slice 2b bind_transfer: defer pid_dead reaping while a staged claim exists or bind is transferring this sessionId.
    if (slice2bCapabilities.has(SLICE2B_CAPABILITIES.bindTransfer) && lease.sessionId) {
      if (stagedClaims.has(lease.sessionId) || (deferSid && deferSid === lease.sessionId)) {
        return false;
      }
    }
    if (deadBirths.has(`${lease.pid}:${lease.pidStartTime}`)) return true;
    if (ctrl.enforceRealPids) {
      return !processIdentityAlive({ pid: lease.pid, startTime: String(lease.pidStartTime) });
    }
    return false;
  }

  /** P3: Matches real cu-broker `_reap_locked()` invoked before status, events, and mutations. */
  function reapDeadBirths(deferSid?: string | null): void {
    if (ctrl.lease && isLeaseBirthDead(ctrl.lease, deferSid)) {
      const prev = publicLease(ctrl.lease);
      revokeSessionClaims(ctrl.lease.sessionId);
      ctrl.reapedPidDeadCount += 1;
      ctrl.epoch += 1;
      ctrl.state = 'idle';
      ctrl.lease = null;
      ctrl.emitEvent('seat_idle', { ...ctrl.snapshotPayload(), reason: 'pid_dead', previous: prev });
      ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'pid_dead' });
    }
    if (ctrl.preempted && isLeaseBirthDead(ctrl.preempted, deferSid)) {
      const reaped = publicPreempted(ctrl.preempted);
      revokeSessionClaims(ctrl.preempted.sessionId);
      ctrl.reapedPidDeadCount += 1;
      ctrl.preempted = null;
      ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'preempted_reaped', reaped });
    }
  }

  function statusMeta(): Record<string, unknown> {
    if (ctrl.slice1Mode) {
      return { ok: true, version: 1 };
    }
    return {
      ok: true,
      version: 1,
      capabilities: [...REQUIRED_SLICE2_CAPABILITIES, ...slice2bCapabilities],
      ...(slice2bCapabilities.size > 0 ? { defaults: { defaultAllowReclaim: false }, transition: null } : {}),
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
    slice1Mode: false,
    slice2bCapabilities,
    activeClaims,
    stagedClaims,
    enforceRealPids: false,
    deadBirths,
    reapedPidDeadCount: 0,
    nextAcquireError: null,
    nextClaimNonceError: null,
    nextBindError: null,
    nextReleaseError: null,
    nextRenewError: null,
    nextTakeoverError: null,
    eventsErrorStatus: null,
    holdEventsResponses: false,
    pendingEventsRes,
    statusCalls: 0,
    acquireCalls,
    claimNonceCalls,
    bindCalls,
    abortStagedCalls,
    renewCalls,
    heartbeatCalls,
    releaseCalls,
    cancelPreemptedCalls,
    takeoverCalls,
    validationErrorCalls,
    forcedMutationCalls,
    eventsRequests,
    issuedSecrets,
    issuedNonces,
    sseClients,
    publicLease,
    enableSlice2b(caps = Object.values(SLICE2B_CAPABILITIES)) {
      slice2bCapabilities.clear();
      for (const cap of caps) slice2bCapabilities.add(cap);
    },
    disableSlice2b() {
      slice2bCapabilities.clear();
    },
    simulateMcpClaim(claimedPid, target = 'active') {
      const lease = target === 'preempted' ? ctrl.preempted : ctrl.lease;
      if (!lease) throw new Error(`No ${target} lease to claim`);
      if (lease.sessionId) activeClaims.delete(lease.sessionId);
      lease.mcpClaimed = true;
      lease.claimedPid = claimedPid;
    },
    simulateClaimedPeerReaped(target = 'active') {
      const lease = target === 'preempted' ? ctrl.preempted : ctrl.lease;
      if (!lease) throw new Error(`No ${target} lease to reap claimed peer from`);
      if (lease.sessionId) activeClaims.delete(lease.sessionId);
      lease.mcpClaimed = false;
      lease.claimedPid = null;
      ctrl.emitEvent('lease_changed', {
        ...ctrl.snapshotPayload(),
        reason: 'claimed_peer_reaped',
        target: target === 'preempted' ? 'displaced' : 'active',
      });
    },
    simulateClaimExpired(target = 'active') {
      const lease = target === 'preempted' ? ctrl.preempted : ctrl.lease;
      if (!lease) throw new Error(`No ${target} lease to expire claim from`);
      if (lease.sessionId) {
        const claim = activeClaims.get(lease.sessionId);
        if (claim) { try { fs.unlinkSync(claim.claimFile); } catch {} }
        activeClaims.delete(lease.sessionId);
      }
      ctrl.emitEvent('lease_changed', {
        ...ctrl.snapshotPayload(),
        reason: 'claim_expired',
        target: target === 'preempted' ? 'displaced' : 'active',
      });
    },
    setAllowReclaim(allow, target = 'active') {
      const lease = target === 'preempted' ? ctrl.preempted : ctrl.lease;
      if (!lease) throw new Error(`No ${target} lease to update allowReclaim`);
      lease.allowReclaim = allow;
    },
    resetIdleForTest() {
      revokeSessionClaims(ctrl.lease?.sessionId ?? null);
      revokeSessionClaims(ctrl.preempted?.sessionId ?? null);
      ctrl.epoch += 1;
      ctrl.state = 'idle';
      ctrl.lease = null;
      ctrl.preempted = null;
    },
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
        replayed: false,
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
      for (const pending of [...pendingEventsRes]) {
        try { pending.destroy(); } catch {}
      }
      pendingEventsRes.length = 0;
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
      ctrl.statusCalls += 1;
      reapDeadBirths();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ...statusMeta(),
        ...ctrl.snapshotPayload(),
        health: { broker: true, spacesd: true, driver: true, xvfb: true, desktop: true, chrome: true, driverWorkerRunning: true },
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      if (ctrl.holdEventsResponses) {
        pendingEventsRes.push(res);
        return;
      }
      if (ctrl.eventsErrorStatus !== null) {
        res.writeHead(ctrl.eventsErrorStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Injected events error (${ctrl.eventsErrorStatus})` }));
        return;
      }
      reapDeadBirths();
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

      const oldestAvailableCursor = eventRing.length ? eventRing[0].cursor : ctrl.cursor;
      const emitGap = (reason: 'generation_mismatch' | 'cursor_ahead' | 'cursor_too_old') => {
        // P3 / §9.5: `event: hello` (resume.status === 'resync_required') ALWAYS strictly first,
        // immediately followed by `event: resync` at the EXACT same `(generation, cursor)`!
        res.write(
          `id: ${ctrl.generation}:${ctrl.cursor}\nevent: hello\ndata: ${JSON.stringify({
            ...statusMeta(),
            ...ctrl.snapshotPayload(),
            resume: {
              status: 'resync_required',
              requestedGeneration: reqGen,
              requestedCursor: reqCursor,
              replayedCount: 0,
              oldestAvailableCursor,
              resyncReason: reason,
            },
          })}\n\n`,
        );
        res.write(
          `id: ${ctrl.generation}:${ctrl.cursor}\nevent: resync\ndata: ${JSON.stringify({
            ...ctrl.snapshotPayload(),
            reason,
            requestedGeneration: reqGen,
            requestedCursor: reqCursor,
            oldestAvailableCursor,
          })}\n\n`,
        );
      };

      if (reqGen !== null || reqCursor !== null) {
        if (reqGen !== null && reqGen !== ctrl.generation) {
          emitGap('generation_mismatch');
          return;
        }
        if (reqCursor !== null && reqCursor > ctrl.cursor) {
          emitGap('cursor_ahead');
          return;
        }
        if (reqCursor !== null && reqCursor < ctrl.minRetainedCursor) {
          emitGap('cursor_too_old');
          return;
        }
        const fromCursor = reqCursor ?? 0;
        const missed = eventRing.filter(e => e.generation === ctrl.generation && e.cursor > fromCursor);
        if (missed.length > 0) {
          // P3 / §9.5: `event: hello` with `resume.status === 'replayed'` MUST OMIT `id:` so
          // automatic `Last-Event-ID` reconnects never skip pending replay frames!
          res.write(
            `event: hello\ndata: ${JSON.stringify({
              ...statusMeta(),
              ...ctrl.snapshotPayload(),
              resume: {
                status: 'replayed',
                requestedGeneration: reqGen,
                requestedCursor: fromCursor,
                replayedCount: missed.length,
                oldestAvailableCursor,
                resyncReason: null,
              },
            })}\n\n`,
          );
          for (const item of missed) {
            res.write(
              `id: ${item.generation}:${item.cursor}\nevent: ${item.eventName}\ndata: ${JSON.stringify({ ...item.payload, replayed: true })}\n\n`,
            );
          }
          return;
        }
        res.write(
          `id: ${ctrl.generation}:${ctrl.cursor}\nevent: hello\ndata: ${JSON.stringify({
            ...statusMeta(),
            ...ctrl.snapshotPayload(),
            resume: {
              status: 'up_to_date',
              requestedGeneration: reqGen,
              requestedCursor: fromCursor,
              replayedCount: 0,
              oldestAvailableCursor,
              resyncReason: null,
            },
          })}\n\n`,
        );
        return;
      }

      res.write(
        `id: ${ctrl.generation}:${ctrl.cursor}\nevent: hello\ndata: ${JSON.stringify({
          ...statusMeta(),
          ...ctrl.snapshotPayload(),
          resume: {
            status: 'fresh',
            requestedGeneration: null,
            requestedCursor: null,
            replayedCount: 0,
            oldestAvailableCursor,
            resyncReason: null,
          },
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

      if (body.force === true) {
        forcedMutationCalls.push({ path: url.pathname, body });
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/acquire') {
        reapDeadBirths();
        acquireCalls.push(body);
        const sid = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : `agent-${++secretSeq}`;
        const ownerId = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : null;
        const label = typeof body.label === 'string' && body.label ? body.label : 'omp';

        if (ctrl.nextAcquireError) {
          const injected = ctrl.nextAcquireError;
          ctrl.nextAcquireError = null;
          if (injected.commitBeforeError && ctrl.state === 'idle') {
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
              pid: null,
              pidStartTime: null,
              mcpClaimed: false,
              claimedPid: null,
              expiresAt: new Date(Date.now() + 90_000).toISOString(),
              tokenHash: hashSecret(secret),
              rawSecret: secret,
            };
          }
          sendJson(res, injected.status, injected.body);
          return;
        }

        if (ctrl.state !== 'idle' && ctrl.lease) {
          sendJson(res, 409, {
            ok: false,
            code: 'seat_busy',
            generation: ctrl.generation,
            cursor: ctrl.cursor,
            state: ctrl.state,
            epoch: ctrl.epoch,
            lease: publicLease(ctrl.lease),
            message: ctrl.state === 'human' ? 'Seat is held by a human.' : 'Seat is held by another agent.',
          });
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
          mcpClaimed: false,
          claimedPid: null,
          expiresAt: new Date(Date.now() + 90_000).toISOString(),
          tokenHash: hashSecret(secret),
          rawSecret: secret,
        };
        ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'acquired' });
        sendJson(res, 200, {
          ok: true,
          ...ctrl.snapshotPayload(),
          sessionId: sid,
          leaseId: ctrl.lease.leaseId,
          sessionSecret: secret,
          token: secret,
          heartbeatIntervalSec: 20,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/claim-nonce') {
        reapDeadBirths();
        claimNonceCalls.push(body);
        if (ctrl.nextClaimNonceError) {
          const injected = ctrl.nextClaimNonceError;
          ctrl.nextClaimNonceError = null;
          sendJson(res, injected.status, injected.body);
          return;
        }
        if ('requireRebind' in body && typeof body.requireRebind !== 'boolean') {
          sendValidationError(res, url.pathname, 'invalid_claim', 'requireRebind must be a boolean', body);
          return;
        }
        const sid = typeof body.sessionId === 'string' ? body.sessionId : '';
        const secret = typeof body.sessionSecret === 'string' ? body.sessionSecret : '';
        const target = (ctrl.lease?.sessionId === sid ? ctrl.lease : null)
          ?? (ctrl.preempted?.sessionId === sid ? ctrl.preempted : null);
        if (!target || target.holderKind !== 'agent') {
          sendJson(res, 409, { ok: false, code: 'lease_not_found', message: 'No matching agent lease.' });
          return;
        }
        if (hashSecret(secret) !== target.tokenHash) {
          sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Invalid session secret.' });
          return;
        }
        const requireRebind = body.requireRebind === true;
        const staged = requireRebind && slice2bCapabilities.has(SLICE2B_CAPABILITIES.bindTransfer);
        const claimId = `claim-${++nonceSeq}`;
        const claimNonce = `${NONCE_PREFIX}${nonceSeq}-${crypto.randomBytes(6).toString('hex')}`;
        issuedNonces.add(claimNonce);
        const claimFile = path.join(claimDir, `${claimId}.json`);
        fs.writeFileSync(claimFile, JSON.stringify({
          claimId,
          sessionId: sid,
          claimNonce,
          requireRebind,
        }), { mode: 0o600 });
        const claimObj: FakeBrokerClaim = {
          claimId,
          claimFile,
          claimNonce,
          sessionId: sid,
          expectedPid: staged ? null : target.pid,
          expectedPidStartTime: staged ? null : target.pidStartTime,
          requireRebind,
          staged,
        };
        if (staged) {
          const oldStaged = stagedClaims.get(sid);
          if (oldStaged) { try { fs.unlinkSync(oldStaged.claimFile); } catch {} }
          stagedClaims.set(sid, claimObj);
          ctrl.emitEvent('lease_changed', {
            ...ctrl.snapshotPayload(),
            reason: 'claim_staged',
            target: ctrl.preempted?.sessionId === sid ? 'displaced' : 'active',
          });
        } else {
          const oldActive = activeClaims.get(sid);
          if (oldActive) { try { fs.unlinkSync(oldActive.claimFile); } catch {} }
          activeClaims.set(sid, claimObj);
          if (slice2bCapabilities.size > 0) {
            ctrl.emitEvent('lease_changed', {
              ...ctrl.snapshotPayload(),
              reason: 'claim_issued',
              target: ctrl.preempted?.sessionId === sid ? 'displaced' : 'active',
            });
          }
        }
        sendJson(res, 200, {
          ok: true,
          generation: ctrl.generation,
          cursor: ctrl.cursor,
          claimId,
          claimFile,
          claimNonce,
          sessionId: sid,
          bound: !staged && target.pid !== null,
          staged,
          allowReclaim: false,
          bindTimeoutSec: typeof body.bindTimeoutSec === 'number' ? body.bindTimeoutSec : 30,
          requireRebind,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/bind') {
        const sid = typeof body.sessionId === 'string' ? body.sessionId : '';
        const secret = typeof body.sessionSecret === 'string' ? body.sessionSecret : '';
        if ('abortStaged' in body && typeof body.abortStaged !== 'boolean') {
          sendValidationError(res, url.pathname, 'invalid_bind', 'abortStaged must be a boolean', body);
          return;
        }
        if ('claimId' in body && (typeof body.claimId !== 'string' || !body.claimId.trim())) {
          sendValidationError(res, url.pathname, 'invalid_claim_id', 'claimId must be a non-empty string', body);
          return;
        }
        if ('expectedEpoch' in body && (typeof body.expectedEpoch !== 'number' || !Number.isInteger(body.expectedEpoch) || body.expectedEpoch < 1)) {
          sendValidationError(res, url.pathname, 'invalid_epoch', 'expectedEpoch must be a positive integer', body);
          return;
        }
        const expectedBirth = parseExpectedBirth(body);
        if (expectedBirth === 'invalid') {
          sendValidationError(res, url.pathname, 'invalid_pid', 'expectedPid/expectedPidStartTime invalid', body);
          return;
        }

        if (body.abortStaged === true) {
          reapDeadBirths();
          abortStagedCalls.push(body);
          const isActive = ctrl.lease?.sessionId === sid && ctrl.lease.holderKind === 'agent';
          const isDisplaced = ctrl.preempted?.sessionId === sid && ctrl.preempted.holderKind === 'agent';
          const target = isActive ? ctrl.lease! : isDisplaced ? ctrl.preempted! : null;
          if (!target) {
            sendJson(res, 409, { ok: false, code: 'lease_not_found', ...ctrl.snapshotPayload() });
            return;
          }
          if (hashSecret(secret) !== target.tokenHash) {
            sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Invalid session secret.' });
            return;
          }
          const staged = stagedClaims.get(sid) ?? null;
          const reqClaimId = typeof body.claimId === 'string' ? body.claimId : null;
          if (reqClaimId && (!staged || staged.claimId !== reqClaimId)) {
            sendJson(res, 409, { ok: false, code: 'claim_mismatch', ...ctrl.snapshotPayload() });
            return;
          }
          if (staged) {
            try { fs.unlinkSync(staged.claimFile); } catch {}
            stagedClaims.delete(sid);
            ctrl.emitEvent('lease_changed', {
              ...ctrl.snapshotPayload(),
              reason: 'claim_staged_aborted',
              target: isDisplaced ? 'displaced' : 'active',
            });
          }
          sendJson(res, 200, {
            ok: true,
            aborted: Boolean(staged),
            abortedClaimId: staged?.claimId ?? null,
            ...ctrl.snapshotPayload(),
          });
          return;
        }

        // Slice 2b bind_transfer defers pid_dead reap for sid while in rebind window!
        reapDeadBirths(slice2bCapabilities.has(SLICE2B_CAPABILITIES.bindTransfer) ? sid : null);
        bindCalls.push(body);
        const injectedBindError = ctrl.nextBindError;
        if (injectedBindError) {
          ctrl.nextBindError = null;
          if (!injectedBindError.commitBeforeError) {
            sendJson(res, injectedBindError.status, { ...ctrl.snapshotPayload(), ...injectedBindError.body });
            return;
          }
        }
        const isActive = ctrl.lease?.sessionId === sid && ctrl.lease.holderKind === 'agent';
        const isDisplaced = ctrl.preempted?.sessionId === sid && ctrl.preempted.holderKind === 'agent';
        const target = isActive ? ctrl.lease! : isDisplaced ? ctrl.preempted! : null;
        if (!target) {
          sendJson(res, 409, { ok: false, code: 'lease_not_found', message: 'No matching agent lease.', ...ctrl.snapshotPayload() });
          return;
        }
        if (hashSecret(secret) !== target.tokenHash) {
          sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Invalid session secret.' });
          return;
        }
        if (typeof body.expectedEpoch === 'number' && body.expectedEpoch !== ctrl.epoch) {
          sendJson(res, 409, { ok: false, code: 'epoch_mismatch', message: `Expected epoch ${body.expectedEpoch}, current ${ctrl.epoch}`, ...ctrl.snapshotPayload() });
          return;
        }
        if (expectedBirth && (target.pid !== expectedBirth.pid || target.pidStartTime !== expectedBirth.start)) {
          sendJson(res, 409, { ok: false, code: 'pid_mismatch', message: 'Bound birth does not match expectedPid/expectedPidStartTime', ...ctrl.snapshotPayload() });
          return;
        }
        const staged = stagedClaims.get(sid) ?? null;
        const activeClaim = activeClaims.get(sid) ?? null;
        const reqClaimId = typeof body.claimId === 'string' ? body.claimId : null;
        if (reqClaimId) {
          const expectedClaim = staged ?? activeClaim;
          if (!expectedClaim || expectedClaim.claimId !== reqClaimId) {
            sendJson(res, 409, { ok: false, code: 'claim_mismatch', message: 'claimId does not match pending claim', ...ctrl.snapshotPayload() });
            return;
          }
        }
        const prevPid = target.pid;
        const prevStart = target.pidStartTime;
        if (typeof body.ownerId === 'string' && body.ownerId) target.ownerId = body.ownerId;
        if (typeof body.label === 'string' && body.label) target.label = body.label;
        if (typeof body.pid === 'number') target.pid = body.pid;
        if (typeof body.pidStartTime === 'number') target.pidStartTime = body.pidStartTime;
        else if (typeof body.pidStartTime === 'string' && /^\d+$/.test(body.pidStartTime)) target.pidStartTime = Number(body.pidStartTime);
        const birthChanged = prevPid !== null && (prevPid !== target.pid || prevStart !== target.pidStartTime);
        let committedClaimId: string | null = null;
        if (birthChanged || staged) {
          target.mcpClaimed = false;
          target.claimedPid = null;
        }
        if (staged) {
          if (activeClaim) { try { fs.unlinkSync(activeClaim.claimFile); } catch {} }
          stagedClaims.delete(sid);
          const promoted: FakeBrokerClaim = {
            ...staged,
            staged: false,
            requireRebind: false,
            expectedPid: target.pid,
            expectedPidStartTime: target.pidStartTime,
          };
          activeClaims.set(sid, promoted);
          committedClaimId = promoted.claimId;
        } else if (activeClaim) {
          activeClaim.expectedPid = target.pid;
          activeClaim.expectedPidStartTime = target.pidStartTime;
          committedClaimId = activeClaim.claimId;
        }
        if (injectedBindError?.commitBeforeError) {
          sendJson(res, injectedBindError.status, injectedBindError.body);
          return;
        }
        ctrl.emitEvent('lease_changed', {
          ...ctrl.snapshotPayload(),
          reason: 'bound',
          target: isDisplaced ? 'displaced' : 'active',
          transferred: Boolean(staged || birthChanged),
        });
        sendJson(res, 200, {
          ok: true,
          ...ctrl.snapshotPayload(),
          target: isDisplaced ? 'displaced' : 'active',
          transferred: Boolean(staged || birthChanged),
          ...(committedClaimId ? { committedClaimId } : {}),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/renew') {
        if (!slice2bCapabilities.has(SLICE2B_CAPABILITIES.leaseRenew)) {
          sendJson(res, 404, { ok: false, error: 'not found' });
          return;
        }
        reapDeadBirths();
        renewCalls.push(body);
        if (ctrl.nextRenewError) {
          const injected = ctrl.nextRenewError;
          ctrl.nextRenewError = null;
          sendJson(res, injected.status, { ...ctrl.snapshotPayload(), ...injected.body });
          return;
        }
        if ('expectedEpoch' in body && (typeof body.expectedEpoch !== 'number' || !Number.isInteger(body.expectedEpoch) || body.expectedEpoch < 1)) {
          sendValidationError(res, url.pathname, 'invalid_epoch', 'expectedEpoch must be a positive integer', body);
          return;
        }
        const sid = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : '';
        const ownerId = typeof body.ownerId === 'string' && body.ownerId.trim() ? body.ownerId : null;
        const reqPid = typeof body.pid === 'number' && Number.isInteger(body.pid) && body.pid > 1 ? body.pid : null;
        const reqStart = typeof body.pidStartTime === 'number' ? body.pidStartTime
          : (typeof body.pidStartTime === 'string' && /^\d+$/.test(body.pidStartTime) ? Number(body.pidStartTime) : null);
        if (!sid || !ownerId || reqPid === null || reqStart === null) {
          sendValidationError(res, url.pathname, 'invalid_renew', 'sessionId, ownerId, pid, pidStartTime required', body);
          return;
        }
        const isActive = ctrl.lease?.sessionId === sid && ctrl.lease.holderKind === 'agent';
        const isDisplaced = ctrl.preempted?.sessionId === sid && ctrl.preempted.holderKind === 'agent';
        const target = isActive ? ctrl.lease! : isDisplaced ? ctrl.preempted! : null;
        if (!target) {
          sendJson(res, 409, { ok: false, code: 'lease_not_found', ...ctrl.snapshotPayload() });
          return;
        }
        if (target.ownerId !== ownerId) {
          sendJson(res, 403, { ok: false, code: 'owner_mismatch', message: 'ownerId does not match lease owner.' });
          return;
        }
        if (target.pid !== reqPid || target.pidStartTime !== reqStart) {
          sendJson(res, 403, { ok: false, code: 'birth_mismatch', message: 'pid/pidStartTime does not match lease birth.' });
          return;
        }
        if (typeof body.expectedEpoch === 'number' && body.expectedEpoch !== ctrl.epoch) {
          sendJson(res, 409, { ok: false, code: 'epoch_mismatch', ...ctrl.snapshotPayload() });
          return;
        }
        const existingClaim = activeClaims.get(sid) ?? null;
        const claimForBirth = existingClaim !== null && (
          (existingClaim.expectedPid === reqPid && existingClaim.expectedPidStartTime === reqStart)
          || (existingClaim.expectedPid === null && !existingClaim.requireRebind)
        );
        const issueClaim = body.issueClaim === undefined ? 'auto' : body.issueClaim;
        let claimInfo: Record<string, unknown>;
        if (claimForBirth && existingClaim) {
          claimInfo = { status: 'refreshed', claimId: existingClaim.claimId, claimFile: existingClaim.claimFile, bound: true, staged: false, allowReclaim: false };
        } else if (existingClaim) {
          claimInfo = { status: 'outstanding', claimId: existingClaim.claimId, claimFile: existingClaim.claimFile, bound: true, staged: false, allowReclaim: false };
        } else if (target.mcpClaimed && target.claimedPid) {
          claimInfo = { status: 'already_claimed', claimedPeer: { pid: target.claimedPid }, allowReclaim: target.allowReclaim === true };
        } else if (issueClaim === false) {
          claimInfo = { status: target.allowReclaim === true ? 'reclaimable' : 'none', allowReclaim: target.allowReclaim === true };
        } else {
          const claimId = `claim-${++nonceSeq}`;
          const claimNonce = `${NONCE_PREFIX}${nonceSeq}-${crypto.randomBytes(6).toString('hex')}`;
          issuedNonces.add(claimNonce);
          const claimFile = path.join(claimDir, `${claimId}.json`);
          fs.writeFileSync(claimFile, JSON.stringify({ claimId, sessionId: sid, claimNonce, requireRebind: false }), { mode: 0o600 });
          activeClaims.set(sid, { claimId, claimFile, claimNonce, sessionId: sid, expectedPid: reqPid, expectedPidStartTime: reqStart, requireRebind: false, staged: false });
          claimInfo = { status: 'issued', claimId, claimFile, claimNonce, bound: true, staged: false, allowReclaim: false };
        }
        const newSecret = `${SECRET_PREFIX}${++secretSeq}-${crypto.randomBytes(6).toString('hex')}`;
        issuedSecrets.add(newSecret);
        target.rawSecret = newSecret;
        target.tokenHash = hashSecret(newSecret);
        if (isActive) target.expiresAt = new Date(Date.now() + 90_000).toISOString();
        const targetName = isDisplaced ? 'displaced' : 'active';
        ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'renewed', target: targetName });
        sendJson(res, 200, {
          ok: true,
          ...ctrl.snapshotPayload(),
          target: targetName,
          sessionId: sid,
          leaseId: target.leaseId,
          sessionSecret: newSecret,
          token: newSecret,
          heartbeatIntervalSec: 20,
          claim: claimInfo,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/cancel-preempted') {
        reapDeadBirths();
        cancelPreemptedCalls.push(body);
        const ownerMatchEnabled = slice2bCapabilities.has(SLICE2B_CAPABILITIES.ownerMatch);
        if (ownerMatchEnabled) {
          if ('force' in body && typeof body.force !== 'boolean') {
            sendValidationError(res, url.pathname, 'invalid_force', 'force must be boolean', body);
            return;
          }
          if ('ownerId' in body && (typeof body.ownerId !== 'string' || !body.ownerId.trim())) {
            sendValidationError(res, url.pathname, 'invalid_owner_id', 'ownerId invalid', body);
            return;
          }
          if ('sessionId' in body && (typeof body.sessionId !== 'string' || !body.sessionId.trim())) {
            sendValidationError(res, url.pathname, 'invalid_session_id', 'sessionId invalid', body);
            return;
          }
          if ('expectedEpoch' in body && (typeof body.expectedEpoch !== 'number' || !Number.isInteger(body.expectedEpoch) || body.expectedEpoch < 1)) {
            sendValidationError(res, url.pathname, 'invalid_epoch', 'expectedEpoch invalid', body);
            return;
          }
        }
        const sid = typeof body.sessionId === 'string' ? body.sessionId : '';
        const secret = typeof body.sessionSecret === 'string' ? body.sessionSecret : '';
        const ownerId = typeof body.ownerId === 'string' && body.ownerId.trim() ? body.ownerId : null;
        const force = body.force === true;
        const expectedStates = ownerMatchEnabled ? parseExpectedStates(body.expectedState, new Set(['preempted', 'displaced', 'human'])) : null;
        if (expectedStates === 'invalid') {
          sendValidationError(res, url.pathname, 'invalid_expected_state', 'expectedState invalid', body);
          return;
        }
        const expectedBirth = ownerMatchEnabled ? parseExpectedBirth(body) : null;
        if (expectedBirth === 'invalid') {
          sendValidationError(res, url.pathname, 'invalid_pid', 'expectedPid invalid', body);
          return;
        }
        const hasToken = secret.length > 0;
        const hasOwnerMatch = ownerMatchEnabled && ownerId !== null && !hasToken;
        if (hasOwnerMatch && (!sid || (expectedStates === null && body.expectedEpoch === undefined && expectedBirth === null))) {
          sendValidationError(res, url.pathname, 'invalid_match', 'owner-matched cancel-preempted requires ownerId, sessionId, and guard', body);
          return;
        }
        if (ctrl.preempted) {
          if (hasToken && !force) {
            if (ctrl.preempted.sessionId !== sid || hashSecret(secret) !== ctrl.preempted.tokenHash) {
              sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Invalid session secret.' });
              return;
            }
          } else if (!force && !hasOwnerMatch) {
            sendJson(res, 400, { ok: false, code: 'missing_credentials', message: 'sessionId and sessionSecret required.' });
            return;
          }
          if (ownerMatchEnabled) {
            if (typeof body.expectedEpoch === 'number' && body.expectedEpoch !== ctrl.epoch) {
              sendJson(res, 409, { ok: false, code: 'epoch_mismatch', ...ctrl.snapshotPayload() });
              return;
            }
            if (expectedStates && (ctrl.state !== 'human' || (!expectedStates.has('displaced') && !expectedStates.has('human')))) {
              sendJson(res, 409, { ok: false, code: 'state_mismatch', ...ctrl.snapshotPayload() });
              return;
            }
            if (sid && ctrl.preempted.sessionId !== sid) {
              sendJson(res, 409, { ok: false, code: 'lease_mismatch', ...ctrl.snapshotPayload() });
              return;
            }
            if (ownerId !== null && ctrl.preempted.ownerId !== ownerId) {
              sendJson(res, 409, { ok: false, code: 'owner_mismatch', ...ctrl.snapshotPayload() });
              return;
            }
            if (expectedBirth && (ctrl.preempted.pid !== expectedBirth.pid || ctrl.preempted.pidStartTime !== expectedBirth.start)) {
              sendJson(res, 409, { ok: false, code: 'pid_mismatch', ...ctrl.snapshotPayload() });
              return;
            }
          }
          const cancelled = publicPreempted(ctrl.preempted);
          revokeSessionClaims(ctrl.preempted.sessionId);
          ctrl.preempted = null;
          ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'preempted_cancelled', cancelled });
          sendJson(res, 200, {
            ok: true,
            cancelled: true,
            alreadyAbsent: false,
            cancelledReservation: cancelled,
            ...(hasOwnerMatch ? { matchedBy: 'owner' } : {}),
            ...ctrl.snapshotPayload(),
          });
          return;
        }
        const activeAgent = (ctrl.state === 'agent' || ctrl.state === 'waiting_for_human') && ctrl.lease !== null;
        if (hasOwnerMatch) {
          if (activeAgent && ctrl.lease!.ownerId === ownerId && ctrl.lease!.sessionId === sid) {
            sendJson(res, 409, { ok: false, code: 'lease_active', ...ctrl.snapshotPayload() });
            return;
          }
          sendJson(res, 409, { ok: false, code: 'no_preempted_lease', ...ctrl.snapshotPayload() });
          return;
        }
        if (ownerMatchEnabled && force) {
          sendJson(res, 409, { ok: false, code: 'no_preempted_lease', ...ctrl.snapshotPayload() });
          return;
        }
        // §9.4: preempted is null -> 409 lease_active only if !force and credentials match active agent lease.
        if (!force && activeAgent && ctrl.lease!.sessionId === sid && hashSecret(secret) === ctrl.lease!.tokenHash) {
          sendJson(res, 409, { ok: false, code: 'lease_active', ...ctrl.snapshotPayload() });
          return;
        }
        if (!force && (!sid || !secret)) {
          sendJson(res, 400, { ok: false, code: 'missing_credentials', message: 'Missing credentials.' });
          return;
        }
        if (ownerMatchEnabled && (ownerId !== null || expectedStates !== null || expectedBirth !== null || body.expectedEpoch !== undefined)) {
          sendJson(res, 409, { ok: false, code: 'no_preempted_lease', ...ctrl.snapshotPayload() });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          cancelled: false,
          alreadyAbsent: true,
          cancelledReservation: null,
          ...ctrl.snapshotPayload(),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/heartbeat') {
        reapDeadBirths();
        heartbeatCalls.push(body);
        const sid = typeof body.sessionId === 'string' ? body.sessionId : null;
        const lid = typeof body.leaseId === 'string' ? body.leaseId : null;
        const secret = typeof body.sessionSecret === 'string'
          ? body.sessionSecret
          : typeof body.leaseToken === 'string' ? body.leaseToken : '';
        if (ctrl.state === 'human' && ctrl.preempted && sid === ctrl.preempted.sessionId) {
          sendJson(res, 409, { ok: false, code: 'lease_preempted', generation: ctrl.generation, cursor: ctrl.cursor, state: 'human', epoch: ctrl.epoch });
          return;
        }
        if (
          ctrl.lease
          && (ctrl.lease.leaseId === lid || ctrl.lease.sessionId === sid)
          && hashSecret(secret) === ctrl.lease.tokenHash
        ) {
          ctrl.lease.expiresAt = new Date(Date.now() + 90_000).toISOString();
          sendJson(res, 200, { ok: true, generation: ctrl.generation, cursor: ctrl.cursor, state: ctrl.state, epoch: ctrl.epoch, lease: publicLease(ctrl.lease) });
          return;
        }
        sendJson(res, 409, { ok: false, code: 'lease_lost', generation: ctrl.generation, cursor: ctrl.cursor, state: ctrl.state, epoch: ctrl.epoch });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/takeover') {
        reapDeadBirths();
        takeoverCalls.push(body);
        if (ctrl.nextTakeoverError) {
          const injected = ctrl.nextTakeoverError;
          ctrl.nextTakeoverError = null;
          sendJson(res, injected.status, injected.body);
          return;
        }
        const requestId = typeof body.requestId === 'string' && body.requestId.trim() ? body.requestId : null;
        const fp = JSON.stringify({ label: body.label ?? 'pi-dish', ttlSec: body.ttlSec ?? 600, holderId: body.holderId ?? null });
        if (requestId && takeoverReplays.has(requestId)) {
          const prevReplay = takeoverReplays.get(requestId)!;
          if (prevReplay.fingerprint !== fp) {
            sendJson(res, 409, { ok: false, code: 'request_id_conflict', message: 'requestId already used with different body', ...ctrl.snapshotPayload() });
            return;
          }
          if (ctrl.state !== 'human' || ctrl.lease?.leaseId !== prevReplay.leaseId) {
            sendJson(res, 409, { ok: false, code: 'request_superseded', message: 'Takeover human lease has ended', ...ctrl.snapshotPayload() });
            return;
          }
          sendJson(res, 200, { ...prevReplay.response, replayed: true });
          return;
        }
        if (ctrl.state === 'human') {
          sendJson(res, 409, { ok: false, code: 'seat_busy', generation: ctrl.generation, cursor: ctrl.cursor, state: 'human', epoch: ctrl.epoch, lease: publicLease(ctrl.lease) });
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
          mcpClaimed: false,
          claimedPid: null,
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
        const resp = {
          ok: true,
          ...ctrl.snapshotPayload(),
          leaseId,
          leaseToken,
          token: leaseToken,
          heartbeatIntervalSec: 60,
          viewer: { mode: 'interactive', ticket: `t-${++ticketSeq}`, path: `/viewer/#ticket=t-${ticketSeq}` },
        };
        if (requestId) {
          takeoverReplays.set(requestId, { fingerprint: fp, leaseId, response: resp });
        }
        sendJson(res, 200, resp);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/lease/release') {
        reapDeadBirths();
        releaseCalls.push(body);
        if (ctrl.nextReleaseError) {
          const injected = ctrl.nextReleaseError;
          ctrl.nextReleaseError = null;
          if (injected.reapToIdleFirst && ctrl.lease) {
            revokeSessionClaims(ctrl.lease.sessionId);
            ctrl.epoch += 1;
            ctrl.state = 'idle';
            ctrl.lease = null;
          }
          sendJson(res, injected.status, { ...ctrl.snapshotPayload(), ...injected.body });
          return;
        }
        const ownerMatchEnabled = slice2bCapabilities.has(SLICE2B_CAPABILITIES.ownerMatch);
        if (ownerMatchEnabled) {
          if ('force' in body && typeof body.force !== 'boolean') {
            sendValidationError(res, url.pathname, 'invalid_force', 'force must be boolean', body);
            return;
          }
          if ('handBack' in body && typeof body.handBack !== 'boolean') {
            sendValidationError(res, url.pathname, 'invalid_hand_back', 'handBack must be boolean', body);
            return;
          }
          if ('ownerId' in body && (typeof body.ownerId !== 'string' || !body.ownerId.trim())) {
            sendValidationError(res, url.pathname, 'invalid_owner_id', 'ownerId invalid', body);
            return;
          }
          if ('sessionId' in body && (typeof body.sessionId !== 'string' || !body.sessionId.trim())) {
            sendValidationError(res, url.pathname, 'invalid_session_id', 'sessionId invalid', body);
            return;
          }
          if ('expectedEpoch' in body && (typeof body.expectedEpoch !== 'number' || !Number.isInteger(body.expectedEpoch) || body.expectedEpoch < 1)) {
            sendValidationError(res, url.pathname, 'invalid_epoch', 'expectedEpoch invalid', body);
            return;
          }
        }
        const reqSid = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null;
        const reqLid = typeof body.leaseId === 'string' && body.leaseId ? body.leaseId : null;
        const ident = reqLid || reqSid;
        const token = (typeof body.leaseToken === 'string' ? body.leaseToken : null)
          || (typeof body.sessionSecret === 'string' ? body.sessionSecret : null)
          || (typeof body.token === 'string' ? body.token : '');
        const ownerId = typeof body.ownerId === 'string' && body.ownerId.trim() ? body.ownerId : null;
        const force = body.force === true;
        const handBack = body.handBack === true;
        const hasToken = token.length > 0;
        const hasOwnerMatch = ownerMatchEnabled && ownerId !== null && !hasToken;
        const allowedStates = ownerId !== null ? new Set(['agent', 'waiting_for_human', 'active']) : new Set(['agent', 'waiting_for_human', 'active', 'human']);
        const expectedStates = ownerMatchEnabled ? parseExpectedStates(body.expectedState, allowedStates) : null;
        if (expectedStates === 'invalid') {
          sendValidationError(res, url.pathname, 'invalid_expected_state', 'expectedState invalid', body);
          return;
        }
        const expectedBirth = ownerMatchEnabled ? parseExpectedBirth(body) : null;
        if (expectedBirth === 'invalid') {
          sendValidationError(res, url.pathname, 'invalid_pid', 'expectedPid invalid', body);
          return;
        }
        if (hasOwnerMatch && (!ident || (expectedStates === null && body.expectedEpoch === undefined && expectedBirth === null))) {
          sendValidationError(res, url.pathname, 'invalid_match', 'owner-matched release requires ownerId, sessionId, and guard', body);
          return;
        }
        if (ctrl.state === 'idle' || !ctrl.lease) {
          if (ownerMatchEnabled && (hasOwnerMatch || ownerId !== null || expectedStates !== null || expectedBirth !== null || body.expectedEpoch !== undefined)) {
            sendJson(res, 409, { ok: false, code: 'lease_not_found', ...ctrl.snapshotPayload() });
            return;
          }
          sendJson(res, 200, { ok: true, ...ctrl.snapshotPayload(), alreadyIdle: true, handedBackTo: null });
          return;
        }
        if (hasOwnerMatch) {
          // Owner-matched authentication via control.sock (no token required).
        } else if (!force) {
          const preemptedSecretOk = ownerMatchEnabled
            && ownerId !== null
            && ctrl.state === 'human'
            && ctrl.preempted !== null
            && ctrl.preempted.sessionId === reqSid
            && hashSecret(token) === ctrl.preempted.tokenHash;
          if (!preemptedSecretOk && ((ident !== ctrl.lease.leaseId && ident !== ctrl.lease.sessionId) || hashSecret(token) !== ctrl.lease.tokenHash)) {
            sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Invalid lease credentials.' });
            return;
          }
        }
        if (ownerMatchEnabled) {
          if (ownerId !== null && (ctrl.state === 'human' || ctrl.lease.holderKind !== 'agent')) {
            if (ctrl.preempted && ctrl.preempted.ownerId === ownerId && (!reqSid || ctrl.preempted.sessionId === reqSid)) {
              sendJson(res, 409, { ok: false, code: 'lease_preempted', message: 'Agent lease was preempted by a human.', ...ctrl.snapshotPayload() });
              return;
            }
            sendJson(res, 409, { ok: false, code: 'state_mismatch', message: 'Seat is held by human.', ...ctrl.snapshotPayload() });
            return;
          }
          if (typeof body.expectedEpoch === 'number' && body.expectedEpoch !== ctrl.epoch) {
            sendJson(res, 409, { ok: false, code: 'epoch_mismatch', ...ctrl.snapshotPayload() });
            return;
          }
          if (expectedStates && !expectedStates.has(ctrl.state)) {
            sendJson(res, 409, { ok: false, code: 'state_mismatch', ...ctrl.snapshotPayload() });
            return;
          }
          if (ident && ident !== ctrl.lease.leaseId && ident !== ctrl.lease.sessionId) {
            sendJson(res, 409, { ok: false, code: 'lease_mismatch', ...ctrl.snapshotPayload() });
            return;
          }
          if (ownerId !== null && ctrl.lease.ownerId !== ownerId) {
            sendJson(res, 409, { ok: false, code: 'owner_mismatch', ...ctrl.snapshotPayload() });
            return;
          }
          if (expectedBirth && (ctrl.lease.pid !== expectedBirth.pid || ctrl.lease.pidStartTime !== expectedBirth.start)) {
            sendJson(res, 409, { ok: false, code: 'pid_mismatch', ...ctrl.snapshotPayload() });
            return;
          }
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
          sendJson(res, 200, { ok: true, ...ctrl.snapshotPayload(), handedBackTo: newPub });
          return;
        }
        revokeSessionClaims(ctrl.lease.sessionId);
        ctrl.epoch += 1;
        ctrl.state = 'idle';
        ctrl.lease = null;
        if (wasHuman) {
          revokeSessionClaims(ctrl.preempted?.sessionId ?? null);
          ctrl.preempted = null;
        }
        ctrl.emitEvent('seat_idle', { ...ctrl.snapshotPayload(), reason: 'released', previous: prev });
        ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'released' });
        sendJson(res, 200, {
          ok: true,
          ...ctrl.snapshotPayload(),
          released: prev,
          handedBackTo: null,
          ...(hasOwnerMatch ? { matchedBy: 'owner' } : {}),
        });
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
  dirs: { envDir: string; cmdDir: string; holdRegisterFlag: string; trapSignalsFlag?: string },
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
const trapSignalsFlag = ${JSON.stringify(dirs.trapSignalsFlag ?? '')};

if (trapSignalsFlag && fs.existsSync(trapSignalsFlag)) {
  process.on('SIGHUP', () => {});
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});
}

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

test('unit: P1-6 ordering rule, P1-7 gap dedupe & replay hello, P1-8 unbound refusal, pending/acked retry, and heartbeat 409 abort', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-u1-'));
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  let hbStatus = 200;
  let hbBody: Record<string, unknown> = { ok: true, state: 'agent', epoch: 10, cursor: 2, generation: 'gen-A' };
  let holdNextBind: (() => void) | null = null;
  let holdBindEnabled = false;
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
      if (pathname === '/v1/status') {
        return {
          status: 200,
          body: {
            ok: true,
            version: 1,
            capabilities: [...REQUIRED_SLICE2_CAPABILITIES],
            generation: 'gen-A',
            cursor: 1,
            state: 'idle',
            epoch: 9,
            lease: null,
            preempted: null,
          },
        };
      }
      if (pathname === '/v1/lease/acquire') {
        const bodyObj = body ? record(body) : {};
        capturedBrokerSid = String(bodyObj.sessionId ?? 'cu-agent-u1');
        capturedOwnerId = String(bodyObj.ownerId ?? 'cu-owner-u1');
        return {
          status: 200,
          body: {
            ok: true,
            generation: 'gen-A',
            cursor: 2,
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
        if (holdBindEnabled) {
          await new Promise<void>(resolve => { holdNextBind = resolve; });
        }
        return {
          status: 200,
          body: { ok: true, generation: 'gen-A', cursor: 3, state: 'agent', epoch: 10, target: 'active' },
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
    pidAlive: () => true,
    heartbeatIntervalMs: 35,
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
  const handle = present(await leases.prepareSpawn({ knownSessionId: sid }));
  assert.deepEqual(Object.keys(handle.env).sort(), ['CU_BROKER_CLAIM_FILE', 'CU_BROKER_LABEL', 'CU_BROKER_SESSION_ID']);
  assert.equal(handle.env.CU_BROKER_LABEL, BROKER_AGENT_LABEL);
  assert.equal(JSON.stringify(handle.env).includes('unit-secret-only-in-memory'), false);
  assert.equal(JSON.stringify(handle.env).includes('unit-nonce-discarded'), false);

  // P1-8: Before process birth is bound, preempted MUST NOT dispatch abort to an unbound target!
  leases.handleBrokerEvent({
    eventName: 'preempted',
    authoritativeHello: false,
    generation: 'gen-A',
    cursor: 3,
    payload: {
      generation: 'gen-A',
      cursor: 3,
      state: 'human',
      epoch: 10,
      displaced: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
      preempted: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
    },
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(abortTargets.length, 0, 'P1-8: unbound target must never receive abort');

  // P1-6: Start a delayed bind at older (epoch 10, cursor 3) while a takeover (epoch 11, cursor 4) arrives mid-flight!
  holdBindEnabled = true;
  const delayedBind = leases.bindSpawnedProcess(handle, { pid: 4242, startTime: '987654321' });
  leases.attachSpawnedSession(handle, { sessionId: sid, pid: 4242, pidStartTime: '987654321' });
  await waitFor(() => holdNextBind !== null, 'bind request in flight');

  // Preempt at (gen-A, cursor 4, epoch 11): first abort returns false -> retries and succeeds once.
  leases.handleBrokerEvent({
    eventName: 'preempted',
    authoritativeHello: false,
    generation: 'gen-A',
    cursor: 4,
    payload: {
      generation: 'gen-A',
      cursor: 4,
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

  // Now complete the stale delayed bind reply (epoch 10, cursor 3 < epoch 11, cursor 4) -> MUST NOT undo preempted!
  holdBindEnabled = false;
  holdNextBind!();
  await delayedBind;
  assert.equal(abortTargets[1].isStillValid(), true, 'P1-6: delayed bind must not undo newer preempted state');

  // P1-7: Gap `hello(resync_required)` + immediately following `event: resync` at the EXACT same (gen-A, cursor 5, epoch 11)
  // MUST dedupe AND NOT re-abort the same birth at already-acked epoch 11!
  leases.handleBrokerEvent({
    eventName: 'hello',
    authoritativeHello: true,
    isResync: true,
    resumeStatus: 'resync_required',
    resyncReason: 'cursor_too_old',
    generation: 'gen-A',
    cursor: 5,
    payload: {
      generation: 'gen-A',
      cursor: 5,
      state: 'human',
      epoch: 11,
      preempted: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
      resume: { status: 'resync_required', resyncReason: 'cursor_too_old' },
    },
  });
  leases.handleBrokerEvent({
    eventName: 'resync',
    authoritativeHello: true,
    isResync: true,
    resyncReason: 'cursor_too_old',
    generation: 'gen-A',
    cursor: 5,
    payload: {
      generation: 'gen-A',
      cursor: 5,
      state: 'human',
      epoch: 11,
      reason: 'cursor_too_old',
      preempted: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
    },
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(abortTargets.length, 2, 'P1-7: same-generation gap hello+resync at already-acked epoch must not duplicate abort');

  // Hand back at (gen-A, cursor 6, epoch 12) -> one nudge.
  // Simultaneously configure heartbeat to return a STALE 409 lease_preempted at older (epoch 11, cursor 4)!
  hbStatus = 409;
  hbBody = { ok: false, code: 'lease_preempted', generation: 'gen-A', cursor: 4, state: 'human', epoch: 11 };
  leases.handleBrokerEvent({
    eventName: 'hand_back',
    authoritativeHello: false,
    generation: 'gen-A',
    cursor: 6,
    payload: {
      generation: 'gen-A',
      cursor: 6,
      state: 'agent',
      epoch: 12,
      lease: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
      handedBackTo: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp' },
    },
  });
  await waitFor(() => resumeTargets.length === 1, 'hand_back nudge delivered');
  assert.equal(resumeTargets[0].text, CU_HAND_BACK_NUDGE);
  assert.equal(abortTargets[1].isStillValid(), false, 'old abort target invalidated after hand-back');

  // Wait >2 heartbeat ticks while broker returns stale 409 (epoch 11 < 12): P1-6 MUST ignore it (zero spurious aborts)!
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(abortTargets.length, 2, 'P1-6: late heartbeat 409 from older epoch after hand-back must NOT abort');
  assert.equal(leases.ownerIdForSession(sid), capturedOwnerId, 'session stays holding after stale heartbeat 409');

  // P1-7: New-generation gap `hello(resync_required)` + `event: resync` at the EXACT same (gen-B, cursor 0, epoch 1)
  // MUST dedupe so ONE gap produces AT MOST ONE abort!
  hbStatus = 200;
  hbBody = { ok: true, state: 'agent', epoch: 1, cursor: 0, generation: 'gen-B' };
  const abortsBeforeGap = abortTargets.length;
  leases.handleBrokerEvent({
    eventName: 'hello',
    authoritativeHello: true,
    isResync: true,
    resumeStatus: 'resync_required',
    resyncReason: 'generation_mismatch',
    generation: 'gen-B',
    cursor: 0,
    generationChanged: true,
    payload: {
      generation: 'gen-B',
      cursor: 0,
      state: 'human',
      epoch: 1,
      preempted: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp', mcpClaimed: true, claimedPid: 4299 },
      resume: { status: 'resync_required', resyncReason: 'generation_mismatch' },
    },
  });
  leases.handleBrokerEvent({
    eventName: 'resync',
    authoritativeHello: true,
    isResync: true,
    resyncReason: 'generation_mismatch',
    generation: 'gen-B',
    cursor: 0,
    generationChanged: false,
    payload: {
      generation: 'gen-B',
      cursor: 0,
      state: 'human',
      epoch: 1,
      reason: 'generation_mismatch',
      preempted: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp', mcpClaimed: true, claimedPid: 4299 },
    },
  });
  await waitFor(() => abortTargets.length === abortsBeforeGap + 1, 'gap hello+resync delivers one abort');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(abortTargets.length, abortsBeforeGap + 1, 'P1-7: trailing resync at same (gen-B, cursor 0) was deduped');

  // Hand back at (gen-B, cursor 1, epoch 2), then test P1-7 replay hello (`resumeStatus: 'replayed'`)
  // carrying FINAL `state: 'idle'` followed by replayed `lease_changed(ttl_expired)` -> MUST still abort!
  leases.handleBrokerEvent({
    eventName: 'hand_back',
    authoritativeHello: false,
    generation: 'gen-B',
    cursor: 1,
    payload: {
      generation: 'gen-B',
      cursor: 1,
      state: 'agent',
      epoch: 2,
      lease: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp', mcpClaimed: true, claimedPid: 4299 },
      handedBackTo: { ownerId: capturedOwnerId, sessionId: capturedBrokerSid, label: 'omp', mcpClaimed: true, claimedPid: 4299 },
    },
  });
  await waitFor(() => resumeTargets.length === 2, 'second hand_back delivered');

  const abortsBeforeReplay = abortTargets.length;
  leases.handleBrokerEvent({
    eventName: 'hello',
    authoritativeHello: true,
    resumeStatus: 'replayed',
    generation: 'gen-B',
    cursor: 2,
    payload: {
      generation: 'gen-B',
      cursor: 2,
      state: 'idle',
      epoch: 3,
      lease: null,
      preempted: null,
      resume: { status: 'replayed', replayedCount: 1 },
    },
  });
  // Replay hello must NOT have deleted/aborted before the replayed event arrives!
  assert.equal(leases.ownerIdForSession(sid), capturedOwnerId, 'P1-7: replay hello does not prematurely drop target');
  leases.handleBrokerEvent({
    eventName: 'lease_changed',
    authoritativeHello: false,
    generation: 'gen-B',
    cursor: 2,
    payload: {
      generation: 'gen-B',
      cursor: 2,
      state: 'idle',
      epoch: 3,
      reason: 'ttl_expired',
      replayed: true,
      lease: null,
      preempted: null,
    },
  });
  await waitFor(() => abortTargets.length === abortsBeforeReplay + 1, 'P1-7: replayed ttl_expired still aborts cleanly');
  assert.equal(leases.isDesktopAccessLost(sid), true, 'live omp with expired lease surfaces desktop-access-lost');

  processStillAlive = false;
  assert.equal(abortTargets[abortTargets.length - 1].isStillValid(), false, 'dead process invalidates command target');
  assert.equal(leases.isDesktopAccessLost(sid), false, 'dead process does not report access_lost');
});

test('unit: P1-2 zero force:true and P1-5 restart reconciliation (live claimed peer routing vs access_lost, plus cancel-preempted 409 lease_active race)', async (t) => {
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

  // Case 1 (P1-2): Dead active orphan across restart -> dropped locally with ZERO force:true broker mutations.
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

    const stat = fs.statSync(storePath);
    assert.equal(stat.mode & 0o777, 0o600);
    const rawStore = fs.readFileSync(storePath, 'utf8');
    for (const secret of broker.issuedSecrets) assert.equal(rawStore.includes(secret), false);
    for (const nonce of broker.issuedNonces) assert.equal(rawStore.includes(nonce), false);
    assert.equal(rawStore.includes('private_never_persisted'), false);
    assert.equal(rawStore.includes(present(h.leaseOwnerId)), true);

    const releaseBefore = broker.releaseCalls.length;
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
    assert.equal(broker.releaseCalls.length, releaseBefore, 'P1-2: reconcile never issues release for secretless dead orphan');
    assert.equal(broker.forcedMutationCalls.length, 0, 'P1-2: zero force:true calls');
    restarted.stop();
    broker.resetIdleForTest();
  }

  // Case 2 (P1-2): Dead displaced orphan across restart -> dropped locally with ZERO force:true; human lease untouched.
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
    assert.ok(broker.preempted);
    first.stop();

    const cancelBefore = broker.cancelPreemptedCalls.length;
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
    assert.equal(broker.state, 'human', 'human lease untouched');
    assert.equal(broker.cancelPreemptedCalls.length, cancelBefore, 'P1-2: reconcile never calls force cancel-preempted');
    assert.equal(broker.forcedMutationCalls.length, 0, 'P1-2: zero force:true calls');
    restarted.stop();
    broker.resetIdleForTest();
  }

  // Case 3 (P1-5 + P1-2): Live omp WITH live already-claimed MCP peer -> re-adopted ONLY for abort/nudge routing (zero heartbeats, zero force:true)!
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
    broker.simulateMcpClaim(55099);
    first.stop();

    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const nudges: CuAgentLeasesMod.CuCommandTarget[] = [];
    const hbBefore = broker.heartbeatCalls.length;
    const restarted = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: proc => proc.pid === 55003 && proc.startTime === '333333',
      pidAlive: pid => pid === 55099,
      findSessionIdByProcess: proc => (proc.pid === 55003 && proc.startTime === '333333' ? '~sk1_omp_live_claimed' : null),
      heartbeatIntervalMs: 25, // even with a short interval configured, re-adopted records MUST NOT heartbeat!
      livenessCheckMs: 0,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async target => { nudges.push(target); return true; },
    });
    await restarted.reconcile();
    assert.equal(restarted.ownerIdForSession('~sk1_omp_live_claimed'), ownerId, 'P1-5: live claimed peer re-adopted');
    assert.equal(restarted.isDesktopAccessLost('~sk1_omp_live_claimed'), false);
    await new Promise(resolve => setTimeout(resolve, 75));
    assert.equal(broker.heartbeatCalls.length, hbBefore, 'P1-5: re-adopted session sends ZERO heartbeats');

    // Takeover routes abort cleanly, hand-back routes nudge cleanly.
    const to = await client.requestJson('POST', '/v1/lease/takeover', { label: 'pi-dish', ttlSec: 600 });
    restarted.handleBrokerEvent({
      eventName: 'preempted',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: {
        ...broker.snapshotPayload(),
        displaced: broker.publicLease(broker.preempted),
      },
    });
    await waitFor(() => aborts.length === 1, 're-adopted live claimed session receives abort on takeover');
    const toBody = record(to.body);
    await client.requestJson('POST', '/v1/lease/release', {
      leaseId: String(toBody.leaseId),
      leaseToken: String(toBody.leaseToken),
      handBack: true,
    });
    restarted.handleBrokerEvent({
      eventName: 'hand_back',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: {
        ...broker.snapshotPayload(),
        handedBackTo: broker.publicLease(broker.lease),
      },
    });
    await waitFor(() => nudges.length === 1, 're-adopted live claimed session receives nudge on hand-back');

    // P1-2: Closing a secretless re-adopted session drops local record with ZERO force:true mutations!
    const releaseBefore = broker.releaseCalls.length;
    await restarted.releaseSession('~sk1_omp_live_claimed');
    assert.equal(broker.releaseCalls.length, releaseBefore, 'P1-2: secretless close never calls force release');
    assert.equal(broker.forcedMutationCalls.length, 0, 'P1-2: zero force:true calls');
    restarted.stop();
    broker.resetIdleForTest();
  }

  // Case 4 (P1-5): Live omp WITHOUT live claimed MCP peer (unredeemed warm-cache omp across deploy) -> access_lost!
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
    await first.bindSpawnedProcess(h, { pid: 55004, startTime: '444444' });
    // Note: broker.lease.mcpClaimed is FALSE (unredeemed lazy MCP claim).
    first.stop();

    const hbBefore = broker.heartbeatCalls.length;
    const restarted = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: proc => proc.pid === 55004 && proc.startTime === '444444',
      findSessionIdByProcess: proc => (proc.pid === 55004 && proc.startTime === '444444' ? '~sk1_omp_unredeemed' : null),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    await restarted.reconcile();
    assert.equal(restarted.isDesktopAccessLost('~sk1_omp_unredeemed'), true, 'P1-5: unredeemed lease across restart reports desktop-access-lost');
    assert.equal(restarted.ownerIdForSession('~sk1_omp_unredeemed'), null, 'P1-5: unredeemed session is not shown as holding seat');
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(broker.heartbeatCalls.length, hbBefore, 'P1-5: zero heartbeats on access_lost session');
    assert.equal(broker.forcedMutationCalls.length, 0, 'P1-2: zero force:true calls');
    restarted.stop();
    broker.resetIdleForTest();
  }

  // Case 5 (P1-5): Live omp whose lease expired while pi-dish was down -> access_lost!
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
    await first.bindSpawnedProcess(h, { pid: 55005, startTime: '555555' });
    first.stop();
    broker.resetIdleForTest(); // lease expired in broker while pi-dish restarted

    const restarted = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: proc => proc.pid === 55005 && proc.startTime === '555555',
      findSessionIdByProcess: proc => (proc.pid === 55005 && proc.startTime === '555555' ? '~sk1_omp_expired' : null),
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    await restarted.reconcile();
    assert.equal(restarted.isDesktopAccessLost('~sk1_omp_expired'), true, 'P1-5: expired lease across restart reports desktop-access-lost');
    assert.equal(restarted.ownerIdForSession('~sk1_omp_expired'), null);
    restarted.stop();
  }

  // Case 6: Authenticated cancel-preempted `409 lease_active` race falls back to authenticated release (zero force:true).
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
    await mgr.bindSpawnedProcess(h, { pid: 55006, startTime: '666666' });
    mgr.attachSpawnedSession(h, { sessionId: '~sk1_omp_race', pid: 55006, pidStartTime: '666666' });
    mgr.handleBrokerEvent({
      eventName: 'preempted',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor + 1,
      payload: {
        generation: broker.generation,
        cursor: broker.cursor + 1,
        state: 'human',
        epoch: broker.epoch + 1,
        preempted: { ownerId: h.leaseOwnerId, sessionId: h.brokerSessionId, label: 'omp' },
      },
    });
    const cancelCountBefore = broker.cancelPreemptedCalls.length;
    await mgr.releaseSession('~sk1_omp_race');
    assert.equal(broker.cancelPreemptedCalls.length, cancelCountBefore + 1, 'attempted cancel-preempted first');
    assert.equal(broker.state, 'idle', '409 lease_active race fell back to authenticated release');
    assert.equal(broker.forcedMutationCalls.length, 0, 'zero force:true calls across entire reconcile test');
    mgr.stop();
  }
});

test('unit: P1-4 capabilities gate, transport outage classification, P1-7 & P3 watcher framing, atomic SSE backpressure, and zero activeBrokerStreams leak', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-sse-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. P1-4: Slice-1 broker (omitting capabilities array) returns legacy null with ZERO mutations!
  const brokerClient = createCuBrokerClient({ socketPath: () => sockPath });
  const slice1Leases = createCuAgentLeases({
    broker: brokerClient,
    storeFile: () => path.join(tmpDir, 'slice1-store.json'),
    abortSession: async () => true,
    resumeSession: async () => true,
  });
  broker.slice1Mode = true;
  assert.equal(await slice1Leases.supportsSlice2(), false, 'P1-4: Slice-1 broker reports supportsSlice2 === false');
  assert.equal(await slice1Leases.prepareSpawn({ knownSessionId: null }), null, 'P1-4: Slice-1 broker uses legacy path');
  assert.equal(broker.acquireCalls.length, 0, 'P1-4: zero acquire calls against Slice-1 broker');
  assert.equal(broker.claimNonceCalls.length, 0, 'P1-4: zero claim-nonce calls against Slice-1 broker');
  broker.slice1Mode = false;
  assert.equal(await slice1Leases.supportsSlice2(), true, 'P1-4: Slice-2 broker capabilities array passes');
  slice1Leases.stop();

  // 2. Outage classification: missing configured socket, stale Unix socket (ECONNREFUSED), and statusCode 503/504!
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
  await assert.rejects(
    () => missingLeases.prepareSpawn({ knownSessionId: null }),
    err => err instanceof CuBrokerUnavailableError && err.status === 503,
  );
  missingLeases.stop();

  // Stale Unix socket (exists on disk as a socket, but no listener -> ECONNREFUSED).
  const staleSock = path.join(tmpDir, 'stale.sock');
  const tempSrv = net.createServer();
  await new Promise<void>(resolve => tempSrv.listen(staleSock, () => resolve()));
  // Close raw fd without unlinking by spawning a child or keeping a stale socket copy:
  // Actually Node unlinks on close, so test `httpError('broker timeout', 504)` (statusCode: 504) + ECONNREFUSED error code directly!
  await new Promise<void>(resolve => tempSrv.close(() => resolve()));
  for (const simulatedError of [
    httpError('Broker timed out', 504),
    httpError('Broker unavailable', 503),
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  ]) {
    const failingBroker: CuBrokerMod.CuBrokerClient = {
      socketPath: () => '/tmp/down.sock',
      configured: () => true,
      available: () => true,
      requestJson: async () => { throw simulatedError; },
      openEvents: () => null,
    };
    const outageLeases = createCuAgentLeases({
      broker: failingBroker,
      storeFile: () => path.join(tmpDir, 'outage-store.json'),
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    await assert.rejects(
      () => outageLeases.prepareSpawn({ knownSessionId: null }),
      err => err instanceof CuBrokerUnavailableError && err.status === 503,
      `transport error (${String(simulatedError)}) must classify as typed CuBrokerUnavailableError`,
    );
    outageLeases.stop();
  }

  // 3. P3 + P1-7: Watcher sends Last-Event-ID gen:cursor; gap emits hello(resync_required) + event:resync
  // at the same cursor and watcher dedupes them to ONE onBrokerEvent!
  const watcherEvents: CuAgentLeasesMod.CuBrokerEvent[] = [];
  const handlers = createCuHandlers({
    broker: brokerClient,
    upgradeAuthorized: () => true,
    onBrokerEvent: ev => watcherEvents.push(ev),
    sseDrainTimeoutMs: 60,
    sseMaxBufferedBytes: 512,
  });
  t.after(() => handlers.stop());

  await waitFor(() => broker.eventsRequests.length >= 1 && watcherEvents.length >= 1, 'initial watcher hello');
  broker.epoch = 5;
  broker.emitEvent('lease_changed', { ...broker.snapshotPayload(), reason: 'test' });
  await waitFor(() => watcherEvents.some(e => e.eventName === 'lease_changed'), 'watcher saw cursor 1');

  const countBeforeRestart = watcherEvents.length;
  broker.restartGeneration('gen-2', 0);
  broker.dropSseClients();
  await waitFor(() => broker.eventsRequests.length >= 2, 'watcher reconnected');
  assert.equal(broker.eventsRequests[1].lastEventId, 'gen-1:1', 'watcher sent Last-Event-ID gen:cursor');
  assert.equal(broker.eventsRequests[1].generation, 'gen-1');
  assert.equal(broker.eventsRequests[1].cursor, '1');
  await waitFor(() => watcherEvents.length > countBeforeRestart, 'watcher delivered gap event');
  await new Promise(resolve => setTimeout(resolve, 80));
  const gapEvents = watcherEvents.slice(countBeforeRestart).filter(e => e.generation === 'gen-2' && e.cursor === 0);
  assert.equal(gapEvents.length, 1, 'P1-7: gap hello(resync_required) + event:resync at same (gen-2, 0) deduped to ONE event');
  assert.equal(gapEvents[0].isResync, true);

  // 4. Atomic SSE frames, backpressure, AND zero activeBrokerStreams leak across EVERY close path!
  const makeFakeRes = (opts: { stalled?: boolean } = {}) => {
    const writes: string[] = [];
    let stalled = opts.stalled === true;
    let ended = false;
    let statusCode = 200;
    const res = new EventEmitter() as unknown as http.ServerResponse & EventEmitter;
    Object.assign(res, {
      writableEnded: false,
      destroyed: false,
      status(code: number) { statusCode = code; return res; },
      json() { ended = true; return res; },
      setHeader: () => {},
      flushHeaders: () => {},
      write(chunk: string) {
        writes.push(String(chunk));
        return !stalled;
      },
      end() {
        ended = true;
        (res as unknown as { writableEnded: boolean }).writableEnded = true;
        res.emit('close');
      },
    });
    return {
      res,
      writes,
      setStalled(v: boolean) { stalled = v; },
      isEnded: () => ended,
      getStatus: () => statusCode,
    };
  };
  const makeFakeReq = () => Object.assign(new EventEmitter(), {
    headers: {},
    query: {},
  }) as unknown as Parameters<CuHandlersMod.CuHandlers['stream']>[0] & EventEmitter;

  // Path A: Atomic hello + resync + drain timeout eviction.
  const pathA = makeFakeRes();
  handlers.stream(makeFakeReq(), pathA.res as unknown as Parameters<CuHandlersMod.CuHandlers['stream']>[1], () => {});
  await waitFor(() => pathA.writes.some(w => w.includes('event: hello')), 'initial atomic hello frame');
  assert.equal(handlers.activeStreamCount(), 1);
  assert.ok(pathA.writes[0].endsWith('\n\n') && pathA.writes[0].includes('event: hello') && pathA.writes[0].includes('data: '));
  broker.emitResync('subscriber_lagged');
  await waitFor(() => pathA.writes.some(w => w.includes('event: resync') && w.includes('subscriber_lagged')), 'resync forwarded');
  pathA.setStalled(true);
  broker.emitEvent('lease_changed', { ...broker.snapshotPayload(), reason: 'backpressure_test' });
  await waitFor(() => pathA.isEnded(), 'stalled SSE client evicted on drain timeout');
  assert.equal(handlers.activeStreamCount(), 0, 'SSE leak: drain timeout removes stream from activeBrokerStreams');

  // Path B: Ordinary browser disconnect (`req.emit('close')`).
  const reqB = makeFakeReq();
  const pathB = makeFakeRes();
  handlers.stream(reqB, pathB.res as unknown as Parameters<CuHandlersMod.CuHandlers['stream']>[1], () => {});
  await waitFor(() => pathB.writes.some(w => w.includes('event: hello')), 'pathB hello');
  assert.equal(handlers.activeStreamCount(), 1);
  reqB.emit('close');
  assert.equal(handlers.activeStreamCount(), 0, 'SSE leak: ordinary browser disconnect removes stream');

  // Path C: Broker stream premature EOF (`broker.dropSseClients()`).
  const pathC = makeFakeRes();
  handlers.stream(makeFakeReq(), pathC.res as unknown as Parameters<CuHandlersMod.CuHandlers['stream']>[1], () => {});
  await waitFor(() => pathC.writes.some(w => w.includes('event: hello')), 'pathC hello');
  assert.equal(handlers.activeStreamCount(), 1);
  broker.dropSseClients();
  await waitFor(() => handlers.activeStreamCount() === 0, 'SSE leak: broker EOF removes stream');

  // Path D: Broker returns non-200 error on `/v1/events`.
  broker.eventsErrorStatus = 503;
  const pathD = makeFakeRes();
  handlers.stream(makeFakeReq(), pathD.res as unknown as Parameters<CuHandlersMod.CuHandlers['stream']>[1], () => {});
  await waitFor(() => pathD.isEnded(), 'pathD error ended');
  assert.equal(pathD.getStatus(), 503);
  assert.equal(handlers.activeStreamCount(), 0, 'SSE leak: non-200 error removes stream');
  broker.eventsErrorStatus = null;

  // Path E: Browser disconnects BEFORE broker sends response headers (pending phase teardown).
  broker.holdEventsResponses = true;
  const reqE = makeFakeReq();
  const pathE = makeFakeRes();
  handlers.stream(reqE, pathE.res as unknown as Parameters<CuHandlersMod.CuHandlers['stream']>[1], () => {});
  assert.equal(handlers.activeStreamCount(), 1);
  reqE.emit('close');
  assert.equal(handlers.activeStreamCount(), 0, 'SSE leak: pending-phase browser disconnect removes stream');
  broker.holdEventsResponses = false;
  broker.dropSseClients();
});

test('unit: 409 seat_busy and 503 CuBrokerUnavailableError never poison hibernation or recovery records', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-nonpoison-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

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
  assert.equal(first.status, 'failed');
  assert.equal(recoveryAttempt, 1);
  const second = await runner.retry(routeId);
  assert.equal(second.status, 'failed');
  assert.equal(recoveryAttempt, 2);
  const third = await runner.retry(routeId);
  assert.equal(third.status, 'restored');
  assert.equal(recoveryAttempt, 3);
  runner.stop();
});

test('unit: P1-1 guard-refused restart mints nothing, and P1-9 cleanup-incomplete keeps writer quarantine on explicit & headless targets', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-p19-'));
  const ompDir = path.join(tmpDir, 'sessions');
  fs.mkdirSync(ompDir, { recursive: true });
  const nativeId = '2026-11-25T00-00-00_cu_p19_test' as NativeSessionId;
  const routeId = routeSessionId('omp', nativeId);
  const sessFile = path.join(ompDir, `${nativeId}.jsonl`);
  fs.writeFileSync(sessFile, JSON.stringify({ type: 'session', id: nativeId, cwd: tmpDir }) + '\n');
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const myProc = present(processIdentity(process.pid));
  let launchCalls = 0;
  let stopCalls = 0;

  // Spawn a sacrificial child process that stays alive during the quarantine test so killPaneAndWait cannot clear it.
  const holdChild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => { try { holdChild.kill('SIGKILL'); } catch {} });
  const childProc = await waitFor(() => (holdChild.pid ? processIdentity(holdChild.pid) : null), 'holdChild pid');

  const ops = createSessionOperations({
    ownership: {
      sessionSources: {
        resolve: () => ({ harnessId: 'omp', nativeSessionId: nativeId, file: sessFile }),
      },
      liveSourceObservations: () => [],
      getRegisteredSession: () => null,
      getRPCSession: () => null,
      getLiveSession: async () => null,
      liveSubsessionCandidates: () => [],
      capturePaneRestart: async () => ({
        kind: 'pane-restart',
        sessionId: routeId,
        placement: { socket: path.join(tmpDir, 'tmux.sock'), paneId: '%1', paneProcess: myProc },
        registry: { harnessId: 'omp', nativeSessionId: nativeId, sessionId: nativeId, sessionFile: sessFile, pid: myProc.pid, startTime: myProc.startTime, socketPath: path.join(tmpDir, 'b.sock') },
      }),
      preparePaneRestart: async () => ({ registry: { harnessId: 'omp', nativeSessionId: nativeId, sessionId: nativeId, sessionFile: sessFile, pid: myProc.pid, startTime: myProc.startTime, socketPath: path.join(tmpDir, 'b.sock') } }),
      revalidatePaneRestart: (_cap: unknown, proved: { registry: unknown }) => proved.registry,
      captureOwnedPaneClose: async () => ({
        sessionId: routeId,
        placement: { socket: path.join(tmpDir, 'tmux.sock'), paneId: '%1', paneProcess: myProc },
        registry: { harnessId: 'omp', nativeSessionId: nativeId, sessionId: nativeId, sessionFile: sessFile, pid: myProc.pid, startTime: myProc.startTime, socketPath: path.join(tmpDir, 'b.sock') },
        agentProcess: myProc,
      }),
      revalidateOwnedPaneClose: () => {},
    } as unknown as SessionOperationsMod.SessionOperationObservations['ownership'],
    launch: {
      validateHarnessPilotSelection: async () => {},
      launchNewSession: async () => { launchCalls++; return { kind: 'ready', id: routeId }; },
      launchResumedSession: async () => {
        launchCalls++;
        // P1-9: Simulate bind failure where killPaneAndWait also failed -> cleanup-incomplete with knownProcesses!
        return {
          kind: 'cleanup-incomplete',
          error: new LaunchError('cu-broker lease bind failed, and tmux cleanup failed', 500),
          status: 500,
          cleanup: {
            socket: path.join(tmpDir, 'missing-tmux.sock'),
            paneId: '%999',
            knownProcesses: [childProc],
            timeout: 80,
          },
        };
      },
      resumeRpcSession: async () => ({ kind: 'ready', id: routeId }),
      spawnHarnessInTmux: async () => { launchCalls++; return { kind: 'ready', id: routeId }; },
    },
    getActiveSessions: () => [],
    readSessionCwd: () => tmpDir,
    recordLaunchProvenance: () => {},
    onSessionStopped: () => { stopCalls++; },
    cuCheckSlice2: async () => true,
  });

  // 1. P1-1: Restart with a refusing `beforeAction` guard MUST NOT stop old pane, release lease, or mint anything!
  const refused = await ops.restartSession(routeId, {
    beforeAction: () => { throw new OwnershipRefusal('Session is busy mid-turn', 409); },
  });
  assert.equal(refused.kind, 'no-action');
  assert.equal(refused.status, 409);
  assert.equal(stopCalls, 0, 'P1-1: guard-refused restart did not stop/release old lease');
  assert.equal(launchCalls, 0, 'P1-1: guard-refused restart minted/launched NOTHING');

  // 2. P1-9: `cleanup-incomplete` on an EXPLICIT tmux target MUST quarantine `sessionFile` in `failedResumeCleanups`!
  await assert.rejects(
    () => ops.resumeSessionById(routeId, { target: { type: 'tmux', socket: path.join(tmpDir, 'tmux.sock'), tmuxSession: 'work' } }),
    /tmux cleanup failed/,
  );
  assert.equal(launchCalls, 1);
  // Subsequent resume MUST be refused by quarantine while `childProc` is still alive — never launching a second writer!
  await assert.rejects(
    () => ops.resumeSessionById(routeId, { target: { type: 'tmux', socket: path.join(tmpDir, 'tmux.sock'), tmuxSession: 'work' } }),
    /Previous hidden tmux cleanup is still incomplete/,
  );
  assert.equal(launchCalls, 1, 'P1-9: quarantine prevented launching a second writer while cleanup is incomplete');
});

test('unit: P1-1 single capability probe on restart (broker flipping Slice 1 -> Slice 2 never re-probes or mints before guard)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-p11-probe-'));
  const ompDir = path.join(tmpDir, 'sessions');
  fs.mkdirSync(ompDir, { recursive: true });
  const nativeId = '2026-11-25T00-00-00_cu_p11_probe' as NativeSessionId;
  const routeId = routeSessionId('omp', nativeId);
  const sessFile = path.join(ompDir, `${nativeId}.jsonl`);
  fs.writeFileSync(sessFile, JSON.stringify({ type: 'session', id: nativeId, cwd: tmpDir }) + '\n');
  const sock = path.join(TEST_TMUX_DIR, `p11-probe-${process.pid}-${Date.now()}`);
  t.after(() => {
    try { execFileSync('tmux', ['-S', sock, 'kill-server'], { stdio: 'ignore', timeout: 10_000 }); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Start a real tmux pane so real createSessionLaunch + tmux.respawnPane execute.
  const paneId = execFileSync(
    'tmux',
    ['-S', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'probe', '-P', '-F', '#{pane_id}', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    { encoding: 'utf8', timeout: 10_000 },
  ).trim();
  const paneProc = await waitFor(() => tmux.paneProcessIdentity(sock, paneId), 'initial pane process');

  let statusCalls = 0;
  let acquireCalls = 0;
  let claimNonceCalls = 0;
  const flippingBroker: CuBrokerMod.CuBrokerClient = {
    socketPath: () => '/tmp/flipping.sock',
    configured: () => true,
    available: () => true,
    async requestJson(_method, pathname) {
      if (pathname === '/v1/status') {
        statusCalls += 1;
        // First probe responds as Slice 1 (no capabilities); any subsequent probe responds as Slice 2!
        if (statusCalls === 1) {
          return { status: 200, body: { ok: true, version: 1, state: 'idle', epoch: 1, lease: null, preempted: null } };
        }
        return {
          status: 200,
          body: { ok: true, version: 1, capabilities: [...REQUIRED_SLICE2_CAPABILITIES], state: 'idle', epoch: 1, lease: null, preempted: null },
        };
      }
      if (pathname === '/v1/lease/acquire') {
        acquireCalls += 1;
        return { status: 200, body: { ok: true, generation: 'g1', cursor: 1, epoch: 2, sessionId: 's', sessionSecret: 'sec' } };
      }
      if (pathname === '/v1/lease/claim-nonce') {
        claimNonceCalls += 1;
        return { status: 200, body: { ok: true, claimFile: path.join(tmpDir, 'c.json'), claimNonce: 'n' } };
      }
      return { status: 200, body: { ok: true } };
    },
    openEvents: () => null,
  };

  const leases = createCuAgentLeases({
    broker: flippingBroker,
    storeFile: () => path.join(tmpDir, 'leases.json'),
    heartbeatIntervalMs: 0,
    livenessCheckMs: 0,
    abortSession: async () => true,
    resumeSession: async () => true,
  });
  t.after(() => leases.stop());

  const sessionLaunch = createSessionLaunch({
    runHarnessModelCommand: async () => [],
    cuLeases: leases,
  });
  const registryEntry = {
    harnessId: 'omp',
    nativeSessionId: nativeId,
    sessionId: nativeId,
    sessionFile: sessFile,
    pid: paneProc.pid,
    startTime: paneProc.startTime,
    socketPath: path.join(tmpDir, 'b.sock'),
  };
  const ops = createSessionOperations({
    ownership: {
      sessionSources: { resolve: () => ({ harnessId: 'omp', nativeSessionId: nativeId, file: sessFile }) },
      liveSourceObservations: () => [],
      getRegisteredSession: () => null,
      getRPCSession: () => null,
      getLiveSession: async () => null,
      liveSubsessionCandidates: () => [],
      capturePaneRestart: async () => ({
        kind: 'pane-restart',
        sessionId: routeId,
        placement: { socket: sock, paneId, paneProcess: paneProc },
        registry: registryEntry,
      }),
      preparePaneRestart: async () => ({ registry: registryEntry }),
      revalidatePaneRestart: (_cap: unknown, proved: { registry: unknown }) => proved.registry,
    } as unknown as SessionOperationsMod.SessionOperationObservations['ownership'],
    launch: sessionLaunch,
    getActiveSessions: () => [],
    readSessionCwd: () => tmpDir,
    recordLaunchProvenance: () => {},
    cuCheckSlice2: () => leases.supportsSlice2(),
  });

  // Guard refuses inside respawnPane -> MUST probe /v1/status ONCE and mint ZERO leases/claims!
  await assert.rejects(
    () => ops.restartSession(routeId, {
      beforeAction: () => { throw new LifecycleInterruption('waiting', 'guard refused during respawn'); },
    }),
    err => err instanceof LifecycleInterruption,
  );
  assert.equal(statusCalls, 1, 'P1-1: restart probes /v1/status exactly ONCE (no second probe in session-launch)');
  assert.equal(acquireCalls, 0, 'P1-1: zero lease acquire calls before guard passes');
  assert.equal(claimNonceCalls, 0, 'P1-1: zero claim-nonce calls before guard passes');
  assert.equal(processIdentityAlive(paneProc), true, 'original pane process stays alive untouched');
});

test('unit: P1-6 stale startup status in reconcile skips record completely with zero state changes and zero commands', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-p16-stale-'));
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const ownerId = 'cu-owner-stale-reconcile-01';
  const brokerSid = 'cu-agent-stale-reconcile-01';
  const pid = 55010;
  const startTime = '101010';
  const sid = '~sk1_omp_stale_reconcile';

  // Case A: Stale /v1/status (cursor 10, displaced) resolves AFTER SSE hand-back (cursor 12) -> ZERO aborts, NO state change!
  {
    fs.writeFileSync(storePath, JSON.stringify({
      version: 1,
      leases: [{
        leaseOwnerId: ownerId,
        brokerSessionId: brokerSid,
        leaseId: 'agent-5',
        epoch: 5,
        generation: 'gen-1',
        pid,
        pidStartTime: startTime,
        createdAt: Date.now() - 5000,
      }],
    }), { mode: 0o600 });

    let releaseStatus!: () => void;
    let statusRequested = false;
    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const mockBroker: CuBrokerMod.CuBrokerClient = {
      socketPath: () => '/tmp/stale-a.sock',
      configured: () => true,
      available: () => true,
      async requestJson(_method, pathname) {
        if (pathname === '/v1/status') {
          statusRequested = true;
          await new Promise<void>(resolve => { releaseStatus = resolve; });
          return {
            status: 200,
            body: {
              ok: true,
              version: 1,
              capabilities: [...REQUIRED_SLICE2_CAPABILITIES],
              generation: 'gen-1',
              cursor: 10,
              state: 'human',
              epoch: 5,
              lease: { holderKind: 'human', leaseId: 'human-5', label: 'pi-dish' },
              preempted: { sessionId: brokerSid, ownerId, leaseId: 'agent-5', label: 'omp', pid, pidStartTime: Number(startTime), mcpClaimed: true, claimedPid: 55099 },
            },
          };
        }
        return { status: 200, body: { ok: true } };
      },
      openEvents: () => null,
    };

    const mgr = createCuAgentLeases({
      broker: mockBroker,
      storeFile: () => storePath,
      processAlive: p => p.pid === pid && p.startTime === startTime,
      pidAlive: p => p === 55099,
      findSessionIdByProcess: p => (p.pid === pid && p.startTime === startTime ? sid : null),
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());

    const reconcilePromise = mgr.reconcile();
    await waitFor(() => statusRequested, 'startup /v1/status in flight');

    // Deliver newer hand-back at cursor 12 while /v1/status (cursor 10) is in flight!
    mgr.handleBrokerEvent({
      eventName: 'hand_back',
      authoritativeHello: false,
      generation: 'gen-1',
      cursor: 12,
      payload: {
        generation: 'gen-1',
        cursor: 12,
        state: 'agent',
        epoch: 6,
        lease: { holderKind: 'agent', sessionId: brokerSid, ownerId, leaseId: 'agent-5', label: 'omp', mcpClaimed: true, claimedPid: 55099 },
        handedBackTo: { sessionId: brokerSid, ownerId, label: 'omp', mcpClaimed: true, claimedPid: 55099 },
      },
    });

    // Release the older displaced /v1/status (cursor 10 < cursor 12).
    releaseStatus();
    await reconcilePromise;
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(aborts.length, 0, 'P1-6: stale displaced startup status after hand-back must schedule ZERO aborts');
    assert.equal(mgr.ownerIdForSession(sid), null, 'P1-6: skipped stale snapshot did not transition pending record');
  }

  // Case B: Snapshot older than a specific record's known epoch (gen-1 epoch 8 < rec.epoch 10) -> skip record entirely!
  {
    fs.writeFileSync(storePath, JSON.stringify({
      version: 1,
      leases: [{
        leaseOwnerId: ownerId,
        brokerSessionId: brokerSid,
        leaseId: 'agent-10',
        epoch: 10,
        generation: 'gen-1',
        pid,
        pidStartTime: startTime,
        createdAt: Date.now() - 5000,
      }],
    }), { mode: 0o600 });

    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const mockBroker: CuBrokerMod.CuBrokerClient = {
      socketPath: () => '/tmp/stale-b.sock',
      configured: () => true,
      available: () => true,
      async requestJson(_method, pathname) {
        if (pathname === '/v1/status') {
          return {
            status: 200,
            body: {
              ok: true,
              version: 1,
              capabilities: [...REQUIRED_SLICE2_CAPABILITIES],
              generation: 'gen-1',
              cursor: 4,
              state: 'human',
              epoch: 8,
              lease: { holderKind: 'human', leaseId: 'human-8', label: 'pi-dish' },
              preempted: { sessionId: brokerSid, ownerId, leaseId: 'agent-10', label: 'omp', pid, pidStartTime: Number(startTime), mcpClaimed: true, claimedPid: 55099 },
            },
          };
        }
        return { status: 200, body: { ok: true } };
      },
      openEvents: () => null,
    };

    const mgr = createCuAgentLeases({
      broker: mockBroker,
      storeFile: () => storePath,
      processAlive: p => p.pid === pid && p.startTime === startTime,
      pidAlive: p => p === 55099,
      findSessionIdByProcess: p => (p.pid === pid && p.startTime === startTime ? sid : null),
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());

    await mgr.reconcile();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(aborts.length, 0, 'P1-6: per-record stale startup status (epoch 8 < 10) schedules ZERO aborts');
    assert.equal(mgr.ownerIdForSession(sid), null, 'P1-6: per-record stale startup status leaves pending record untouched');
  }
});

test('unit: P1-9 quarantine retry never kills an unrelated pane after tmux server restart or pane birth mismatch', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-p19-retry-'));
  const ompDir = path.join(tmpDir, 'sessions');
  fs.mkdirSync(ompDir, { recursive: true });
  const nativeId = '2026-11-25T00-00-00_cu_p19_retry' as NativeSessionId;
  const routeId = routeSessionId('omp', nativeId);
  const sessFile = path.join(ompDir, `${nativeId}.jsonl`);
  fs.writeFileSync(sessFile, JSON.stringify({ type: 'session', id: nativeId, cwd: tmpDir }) + '\n');
  const sock = path.join(TEST_TMUX_DIR, `p19-retry-${process.pid}-${Date.now()}`);
  const writerChild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => {
    try { writerChild.kill('SIGKILL'); } catch {}
    try { execFileSync('tmux', ['-S', sock, 'kill-server'], { stdio: 'ignore', timeout: 10_000 }); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  const writerProc = await waitFor(() => (writerChild.pid ? processIdentity(writerChild.pid) : null), 'writer child pid');

  // 1. Start original tmux server S1 on `sock` with pane `%0` (birth P1).
  const origPaneId = execFileSync(
    'tmux',
    ['-S', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'work', '-P', '-F', '#{pane_id}', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    { encoding: 'utf8', timeout: 10_000 },
  ).trim();
  const server1 = present(await tmux.serverIdentity(sock));
  const pane1 = present(await tmux.paneProcessIdentity(sock, origPaneId));

  let launchCalls = 0;
  let cleanupToReturn: SessionLaunchMod.CleanupEvidence = {
    socket: sock,
    paneId: origPaneId,
    knownProcesses: [writerProc],
    timeout: 80,
    serverProcess: server1,
    paneProcess: pane1,
  };
  const ops = createSessionOperations({
    ownership: {
      sessionSources: { resolve: () => ({ harnessId: 'omp', nativeSessionId: nativeId, file: sessFile }) },
      liveSourceObservations: () => [],
      getRegisteredSession: () => null,
      getRPCSession: () => null,
      getLiveSession: async () => null,
      liveSubsessionCandidates: () => [],
    } as unknown as SessionOperationsMod.SessionOperationObservations['ownership'],
    launch: {
      validateHarnessPilotSelection: async () => {},
      launchNewSession: async () => ({ kind: 'ready', id: routeId }),
      launchResumedSession: async () => {
        launchCalls += 1;
        return {
          kind: 'cleanup-incomplete',
          error: new LaunchError('cu-broker lease bind failed, and tmux cleanup failed', 500),
          status: 500,
          cleanup: cleanupToReturn,
        };
      },
      resumeRpcSession: async () => ({ kind: 'ready', id: routeId }),
      spawnHarnessInTmux: async () => ({ kind: 'ready', id: routeId }),
    },
    getActiveSessions: () => [],
    readSessionCwd: () => tmpDir,
    recordLaunchProvenance: () => {},
  });

  // Record quarantine on explicit tmux target.
  await assert.rejects(
    () => ops.resumeSessionById(routeId, { target: { type: 'tmux', socket: sock, tmuxSession: 'work' } }),
    /tmux cleanup failed/,
  );
  assert.equal(launchCalls, 1);

  // 2. Restart the tmux server at the EXACT SAME socket -> new server S2, unrelated shell U1 now occupies `%0`!
  execFileSync('tmux', ['-S', sock, 'kill-server'], { timeout: 10_000 });
  await waitFor(
    () => !processIdentityAlive(server1) && !processIdentityAlive(pane1),
    'original tmux server S1 and pane P1 exited',
  );
  try { fs.unlinkSync(sock); } catch {}
  const reusedPaneId = execFileSync(
    'tmux',
    ['-S', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'work', '-P', '-F', '#{pane_id}', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    { encoding: 'utf8', timeout: 10_000 },
  ).trim();
  assert.equal(reusedPaneId, origPaneId, 'restarted server reused the same pane id (%0)');
  const server2 = present(await tmux.serverIdentity(sock));
  const unrelatedShell = present(await tmux.paneProcessIdentity(sock, reusedPaneId));
  assert.notEqual(`${server2.pid}:${server2.startTime}`, `${server1.pid}:${server1.startTime}`, 'server birth changed');
  assert.notEqual(`${unrelatedShell.pid}:${unrelatedShell.startTime}`, `${pane1.pid}:${pane1.startTime}`, 'pane birth changed');

  // Retry while writerChild is still alive -> MUST refuse, keep quarantine, and NEVER kill unrelatedShell!
  await assert.rejects(
    () => ops.resumeSessionById(routeId, { target: { type: 'tmux', socket: sock, tmuxSession: 'work' } }),
    /Previous hidden tmux cleanup is still incomplete/,
  );
  assert.equal(launchCalls, 1);
  assert.equal(await tmux.paneExists(sock, reusedPaneId), true, 'New P1: unrelated pane %0 on restarted server was NOT killed');
  assert.equal(processIdentityAlive(unrelatedShell), true, 'New P1: unrelated process in %0 is STILL ALIVE');

  // Even after writerChild exits, server identity mismatch (S2 != S1) keeps quarantine and STILL never kills unrelatedShell!
  writerChild.kill('SIGKILL');
  await waitFor(() => !processIdentityAlive(writerProc), 'writerChild exited');
  await assert.rejects(
    () => ops.resumeSessionById(routeId, { target: { type: 'tmux', socket: sock, tmuxSession: 'work' } }),
    /Previous hidden tmux cleanup is still incomplete/,
  );
  assert.equal(launchCalls, 1, 'New P1: quarantine kept when original server identity cannot be proved');
  assert.equal(await tmux.paneExists(sock, reusedPaneId), true, 'New P1: unrelated pane %0 STILL untouched');
  assert.equal(processIdentityAlive(unrelatedShell), true, 'New P1: unrelated process in %0 STILL ALIVE');

  // 3. Same server S2, DIFFERENT pane birth (paneProcess = pane1 != unrelatedShell) -> ALSO refuses and never kills!
  const nativeId2 = '2026-11-25T00-00-00_cu_p19_retry2' as NativeSessionId;
  const routeId2 = routeSessionId('omp', nativeId2);
  const sessFile2 = path.join(ompDir, `${nativeId2}.jsonl`);
  fs.writeFileSync(sessFile2, JSON.stringify({ type: 'session', id: nativeId2, cwd: tmpDir }) + '\n');
  cleanupToReturn = {
    socket: sock,
    paneId: reusedPaneId,
    knownProcesses: [pane1], // already dead old birth
    timeout: 80,
    serverProcess: server2,
    paneProcess: pane1, // does NOT match unrelatedShell!
  };
  const ops2 = createSessionOperations({
    ownership: {
      sessionSources: { resolve: () => ({ harnessId: 'omp', nativeSessionId: nativeId2, file: sessFile2 }) },
      liveSourceObservations: () => [],
      getRegisteredSession: () => null,
      getRPCSession: () => null,
      getLiveSession: async () => null,
      liveSubsessionCandidates: () => [],
    } as unknown as SessionOperationsMod.SessionOperationObservations['ownership'],
    launch: {
      validateHarnessPilotSelection: async () => {},
      launchNewSession: async () => ({ kind: 'ready', id: routeId2 }),
      launchResumedSession: async () => ({
        kind: 'cleanup-incomplete',
        error: new LaunchError('bind failed, and tmux cleanup failed', 500),
        status: 500,
        cleanup: cleanupToReturn,
      }),
      resumeRpcSession: async () => ({ kind: 'ready', id: routeId2 }),
      spawnHarnessInTmux: async () => ({ kind: 'ready', id: routeId2 }),
    },
    getActiveSessions: () => [],
    readSessionCwd: () => tmpDir,
    recordLaunchProvenance: () => {},
  });
  await assert.rejects(() => ops2.resumeSessionById(routeId2, { target: { type: 'tmux', socket: sock, tmuxSession: 'work' } }), /tmux cleanup failed/);
  await assert.rejects(() => ops2.resumeSessionById(routeId2, { target: { type: 'tmux', socket: sock, tmuxSession: 'work' } }), /Previous hidden tmux cleanup is still incomplete/);
  assert.equal(await tmux.paneExists(sock, reusedPaneId), true, 'New P1: same-server pane with different birth was NOT killed');
  assert.equal(processIdentityAlive(unrelatedShell), true, 'New P1: same-server unrelated process STILL ALIVE');
});

test('end-to-end: P1-4 Slice-1 legacy, P1-10 + Fleet addendum env hygiene, P1-1 fresh/displaced restart, P1-3 human seat_busy refusal, P1-8 nested omp rejection, cancel-preempted, private PIN isolation, and zero secret/nonce/force:true leakage', async (t) => {
  writeFakeOmpScript(TEST_FAKE_OMP_PATH, path.resolve(__dirname, '..', 'lib', 'process-identity.js'), {
    envDir: TEST_ENV_DIR,
    cmdDir: TEST_CMD_DIR,
    holdRegisterFlag: TEST_HOLD_REGISTER_FLAG,
  });
  const broker = await startFakeCuBroker(TEST_BROKER_SOCK, TEST_CLAIM_DIR);
  broker.enforceRealPids = true;

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
  const origOmpCommand = process.env.PI_DISH_OMP_COMMAND;
  t.after(async () => {
    process.env.PI_DISH_OMP_COMMAND = origOmpCommand;
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    if (browserStreamReq) { try { browserStreamReq.destroy(); } catch {} browserStreamReq = null; }
    try { fs.unlinkSync(TEST_HOLD_REGISTER_FLAG); } catch {}
    try { execFileSync('tmux', ['-S', headlessSock, 'kill-server'], { stdio: 'ignore', timeout: 10_000 }); } catch {}
    await new Promise<void>(resolve => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
    await broker.close();
    fs.rmSync(TEST_HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(TEST_TMUX_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(TEST_SOCK_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
    res.on('error', () => {});
  });
  browserStreamReq.on('error', () => {});
  await waitFor(() => browserStreamChunks.join('').includes('event: hello'), 'browser /api/cu/stream hello');

  // 0. P1-4: Responding Slice-1 broker (no capabilities array) gets exact main-branch legacy spawn (zero broker mutations)!
  broker.slice1Mode = true;
  const legacySpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD });
  assert.equal(legacySpawn.status, 200, legacySpawn.text);
  assert.equal(broker.acquireCalls.length, 0, 'P1-4: Slice-1 broker performs zero acquire calls');
  assert.equal(broker.claimNonceCalls.length, 0, 'P1-4: Slice-1 broker performs zero claim-nonce calls');
  assert.equal(broker.bindCalls.length, 0, 'P1-4: Slice-1 broker performs zero bind calls');
  const legacySid = String(record(legacySpawn.json).id);
  const legacyClose = await apiPost(`/api/sessions/${encodeURIComponent(legacySid)}/close`, {});
  assert.equal(legacyClose.status, 200, legacyClose.text);
  broker.slice1Mode = false;

  // 1. P1-10 (+ Fleet addendum): Pre-populate the headless tmux server environment AND pollute PI_DISH_OMP_COMMAND
  //    with reserved CU_BROKER_* assignments, then spawn omp while bridge registration is held so prompt bind is also proved!
  const PREPOP_SECRET = 'prepop-tmux-secret-must-be-unset';
  const PREPOP_NONCE = 'prepop-tmux-nonce-must-be-unset';
  const PREPOP_STALE_SID = 'prepop-stale-session-id';
  const PREPOP_STALE_CLAIM = '/tmp/prepop-stale-claim.json';
  const PREPOP_STALE_LABEL = 'prepop-stale-label';
  const PREPOP_MCP_TOKEN = 'prepop-mcp-token-must-be-unset';
  const PREPOP_AGENT_SOCKET = '/tmp/poison-agent.sock';
  const PREPOP_CUSTOM_TMUX = 'poison-custom-tmux-cu-broker-var';
  const PREPOP_CUSTOM_PROC = 'poison-custom-proc-cu-broker-var';
  const CMD_SECRET = 'cmd-supplied-secret-must-be-stripped';
  const CMD_NONCE = 'cmd-supplied-nonce-must-be-stripped';
  const CMD_STALE_SID = 'cmd-supplied-stale-session-id';

  execFileSync('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_SESSION_SECRET', PREPOP_SECRET]);
  execFileSync('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_CLAIM_NONCE', PREPOP_NONCE]);
  execFileSync('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_SESSION_ID', PREPOP_STALE_SID]);
  execFileSync('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_CLAIM_FILE', PREPOP_STALE_CLAIM]);
  execFileSync('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_LABEL', PREPOP_STALE_LABEL]);
  execFileSync('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_MCP_TOKEN', PREPOP_MCP_TOKEN]);
  execFileSync('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_AGENT_SOCKET', PREPOP_AGENT_SOCKET]);
  execFileSync('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_CUSTOM_TMUX', PREPOP_CUSTOM_TMUX]);
  process.env.CU_BROKER_CUSTOM_PROC = PREPOP_CUSTOM_PROC;
  process.env.CU_BROKER_AGENT_SOCKET = PREPOP_AGENT_SOCKET;

  process.env.PI_DISH_OMP_COMMAND =
    `CU_BROKER_SESSION_SECRET=${CMD_SECRET} CU_BROKER_SESSION_ID=${CMD_STALE_SID} CU_BROKER_AGENT_SOCKET=/tmp/cmd-agent.sock `
    + `env CU_BROKER_CLAIM_NONCE=${CMD_NONCE} CU_BROKER_LABEL=cmd-stale ${process.execPath} ${TEST_FAKE_OMP_PATH}`;

  fs.writeFileSync(TEST_HOLD_REGISTER_FLAG, '1');
  const envCountBeforeSpawn1 = readCapturedEnvs().length;
  const spawn1Promise = apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD });
  await waitFor(() => broker.bindCalls.length === 1, 'POST /v1/lease/bind called promptly before bridge registration');
  assert.equal(broker.claimNonceCalls.length, 1);
  assert.equal(broker.claimNonceCalls[0].requireRebind, false);
  assert.equal(typeof broker.bindCalls[0].pid, 'number');
  assert.ok(Number(broker.bindCalls[0].pid) > 1);
  assert.equal(broker.bindCalls[0].label, BROKER_AGENT_LABEL);
  fs.unlinkSync(TEST_HOLD_REGISTER_FLAG);

  const spawn1 = await spawn1Promise;
  delete process.env.CU_BROKER_CUSTOM_PROC;
  delete process.env.CU_BROKER_AGENT_SOCKET;
  assert.equal(spawn1.status, 200, spawn1.text);
  const sid1 = String(record(spawn1.json).id);
  const native1 = nativeIdOf(sid1);
  const ownerId1 = present(broker.lease?.ownerId);
  const brokerSid1 = present(broker.lease?.sessionId);
  assert.equal(broker.bindCalls.length, 1, 'bound ONCE right after spawnInTmux');
  assert.equal(broker.lease?.label, BROKER_AGENT_LABEL);
  assert.equal(ownerId1.includes(native1), false);
  assert.equal(ownerId1.includes(sid1), false);

  // Verify P1-10 + Fleet addendum order:
  // EVERY inherited/command-supplied CU_BROKER_* (including CU_BROKER_AGENT_SOCKET and arbitrary
  // CU_BROKER_* prefix vars from tmux & process.env) was unset FIRST, THEN the managed three
  // (CU_BROKER_SESSION_ID, CU_BROKER_CLAIM_FILE, CU_BROKER_LABEL) were set!
  const env1 = present(readCapturedEnvs().slice(envCountBeforeSpawn1)[0]);
  const cuBrokerKeysInChild = Object.keys(env1.env).filter(k => k.startsWith('CU_BROKER_')).sort();
  assert.deepEqual(
    cuBrokerKeysInChild,
    ['CU_BROKER_CLAIM_FILE', 'CU_BROKER_LABEL', 'CU_BROKER_SESSION_ID'],
    `P1-10: child omp env must contain ONLY the managed three CU_BROKER_* vars (got: ${cuBrokerKeysInChild.join(', ')})`,
  );
  assert.equal(Object.prototype.hasOwnProperty.call(env1.env, 'CU_BROKER_AGENT_SOCKET'), false, 'P1-10: inherited CU_BROKER_AGENT_SOCKET unset');
  assert.equal(Object.prototype.hasOwnProperty.call(env1.env, 'CU_BROKER_CUSTOM_TMUX'), false, 'P1-10: arbitrary tmux CU_BROKER_* unset by prefix');
  assert.equal(Object.prototype.hasOwnProperty.call(env1.env, 'CU_BROKER_CUSTOM_PROC'), false, 'P1-10: arbitrary process.env CU_BROKER_* unset by prefix');
  assert.equal(Object.prototype.hasOwnProperty.call(env1.env, 'CU_BROKER_SESSION_SECRET'), false, 'P1-10: inherited & cmd CU_BROKER_SESSION_SECRET unset');
  assert.equal(Object.prototype.hasOwnProperty.call(env1.env, 'CU_BROKER_CLAIM_NONCE'), false, 'P1-10: inherited & cmd CU_BROKER_CLAIM_NONCE unset');
  assert.equal(Object.prototype.hasOwnProperty.call(env1.env, 'CU_BROKER_MCP_TOKEN'), false, 'P1-10: inherited CU_BROKER_MCP_TOKEN unset');
  assert.equal(env1.env.CU_BROKER_SESSION_ID, brokerSid1, 'Fleet addendum: managed CU_BROKER_SESSION_ID stays in omp env after unset');
  assert.notEqual(env1.env.CU_BROKER_SESSION_ID, PREPOP_STALE_SID);
  assert.notEqual(env1.env.CU_BROKER_SESSION_ID, CMD_STALE_SID);
  assert.equal(typeof env1.env.CU_BROKER_CLAIM_FILE, 'string');
  assert.notEqual(env1.env.CU_BROKER_CLAIM_FILE, PREPOP_STALE_CLAIM);
  assert.ok(fs.existsSync(env1.env.CU_BROKER_CLAIM_FILE), 'managed claim file exists on disk');
  assert.equal(env1.env.CU_BROKER_LABEL, BROKER_AGENT_LABEL);
  assert.notEqual(env1.env.CU_BROKER_LABEL, PREPOP_STALE_LABEL);

  // Verify managed values NEVER entered tmux session env or sibling windows via `-e`!
  const tmuxSessionList = execFileSync('tmux', ['-S', headlessSock, 'list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const tmuxSessionEnvs = tmuxSessionList.map(name => execFileSync('tmux', ['-S', headlessSock, 'show-environment', '-t', name], { encoding: 'utf8' })).join('\n');
  assert.equal(tmuxSessionEnvs.includes(brokerSid1), false, 'managed CU_BROKER_SESSION_ID not stored in tmux session env');
  assert.equal(tmuxSessionEnvs.includes(env1.env.CU_BROKER_CLAIM_FILE), false, 'managed CU_BROKER_CLAIM_FILE not stored in tmux session env');
  assert.equal(tmuxSessionEnvs.includes(CMD_SECRET), false, 'command CU_BROKER_SESSION_SECRET stripped before tmux -e');
  assert.equal(tmuxSessionEnvs.includes(CMD_STALE_SID), false, 'command CU_BROKER_SESSION_ID stripped before tmux -e');

  // Clean pre-populated tmux global env now that P1-10 pre-populated test passed, and restore clean OMP command.
  for (const key of [
    'CU_BROKER_SESSION_SECRET', 'CU_BROKER_CLAIM_NONCE', 'CU_BROKER_SESSION_ID',
    'CU_BROKER_CLAIM_FILE', 'CU_BROKER_LABEL', 'CU_BROKER_MCP_TOKEN',
    'CU_BROKER_AGENT_SOCKET', 'CU_BROKER_CUSTOM_TMUX',
  ]) {
    try { execFileSync('tmux', ['-S', headlessSock, 'set-environment', '-gu', key]); } catch {}
  }
  process.env.PI_DISH_OMP_COMMAND = origOmpCommand;

  const tmuxGlobalEnv = execFileSync('tmux', ['-S', headlessSock, 'show-environment', '-g'], { encoding: 'utf8' });
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
  assert.equal(siblingEnv.includes(brokerSid1), false);
  assert.equal(siblingEnv.includes(env1.env.CU_BROKER_CLAIM_FILE), false);

  // Verify /api/sessions active row carries opaque cuOwnerId matching broker.lease.ownerId.
  const list1 = await apiGet('/api/sessions');
  assert.equal(list1.status, 200);
  const row1 = present(records(record(list1.json).active).find(r => r.id === sid1));
  assert.equal(row1.cuOwnerId, ownerId1);

  // 2. Typed async refusal when seat is busy by another agent!
  const envCountBeforeBusy = readCapturedEnvs().length;
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
  assert.equal(record(busyStatus.holder).ownerId, ownerId1);
  assert.equal(readCapturedEnvs().length, envCountBeforeBusy, 'no second omp spawned on seat_busy');

  // 3. P1-1: Managed restart probes capabilities ONCE, stops old pane, releases old lease with in-memory secret, and performs FRESH acquire+claim+bind (NO requireRebind)!
  const statusBeforeRestart = broker.statusCalls;
  const acquireBeforeRestart = broker.acquireCalls.length;
  const releaseBeforeRestart = broker.releaseCalls.length;
  const restart1 = await apiPost(`/api/sessions/${encodeURIComponent(sid1)}/restart`, {});
  assert.equal(restart1.status, 200, restart1.text);
  assert.equal(broker.statusCalls, statusBeforeRestart + 1, 'P1-1: Slice-2 restart probes /v1/status exactly ONCE');
  assert.equal(broker.releaseCalls.length, releaseBeforeRestart + 1, 'P1-1: restart released old lease cleanly');
  assert.equal(broker.acquireCalls.length, acquireBeforeRestart + 1, 'P1-1: restart performed fresh acquire');
  assert.equal(broker.claimNonceCalls.length, 2, 'P1-1: restart minted fresh claim nonce');
  assert.equal(broker.claimNonceCalls[1].requireRebind, false, 'P1-1: NO requireRebind transfer');
  assert.equal(broker.bindCalls.length, 2, 'P1-1: restart bound new pane process');
  assert.notEqual(broker.bindCalls[1].pid, broker.bindCalls[0].pid, 'P1-1: restart bound new PID');
  assert.notEqual(broker.lease?.ownerId, ownerId1, 'P1-1: fresh ownerId minted for restarted pane');

  // 4. Takeover -> 1 abort; Hand back -> 1 nudge (idempotent across reconnect).
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

  // 5. P1-1 displaced restart + P1-3 human-held seat_busy refusal:
  //    Takeover displaces sid1 -> restart stops sid1, calls cancel-preempted (leaving human untouched),
  //    and refuses new acquire with typed 409 seat_busy!
  const takeover2 = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
  assert.equal(takeover2.status, 200, takeover2.text);
  const humanLease2 = String(record(takeover2.json).leaseId);
  const humanToken2 = String(record(takeover2.json).leaseToken);
  await waitFor(() => readCommands(native1).filter(c => c.command === 'abort').length === 2, 'second takeover abort');
  assert.ok(broker.preempted);

  const cancelBeforeDisplacedRestart = broker.cancelPreemptedCalls.length;
  const envCountBeforeDisplacedRestart = readCapturedEnvs().length;
  const displacedRestart = await apiPost(`/api/sessions/${encodeURIComponent(sid1)}/restart`, {});
  assert.equal(displacedRestart.status, 409, displacedRestart.text);
  const drBody = record(displacedRestart.json);
  assert.equal(drBody.stopped, true, 'P1-1: old displaced pane stopped cleanly');
  assert.equal(drBody.code, 'seat_busy', 'P1-1: typed seat_busy returned on busy restart');
  assert.equal(drBody.state, 'human');
  assert.equal(broker.cancelPreemptedCalls.length, cancelBeforeDisplacedRestart + 1, 'P1-1: cancel-preempted called for displaced session');
  assert.equal(broker.state, 'human', 'human lease untouched after displaced restart');
  assert.equal(broker.preempted, null, 'displaced reservation cleared');
  assert.equal(readCapturedEnvs().length, envCountBeforeDisplacedRestart, 'zero new omp spawned when restart sees seat_busy');

  // P1-3: While human still holds the seat, POST /api/sessions/new fails closed with typed 409 seat_busy (NO waiting launch)!
  const busyHumanSpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD });
  assert.equal(busyHumanSpawn.status, 409, busyHumanSpawn.text);
  assert.equal(record(busyHumanSpawn.json).code, 'seat_busy', 'P1-3: human-held seat refuses omp launch');
  assert.equal(record(busyHumanSpawn.json).state, 'human');
  assert.equal(readCapturedEnvs().length, envCountBeforeDisplacedRestart, 'P1-3: zero omp processes spawned while human holds seat');

  // Release human seat (handBack: true) -> seat becomes IDLE (cancelled displaced agent NEVER regains seat).
  const release2 = await apiPost('/api/cu/release', { leaseId: humanLease2, leaseToken: humanToken2, handBack: true });
  assert.equal(release2.status, 200, release2.text);
  assert.equal(record(release2.json).state, 'idle');
  assert.equal(record(release2.json).handedBackTo, null);

  // 6. Close while displaced -> calls POST /v1/lease/cancel-preempted, human keeps seat, hand-back yields idle!
  const spawn2 = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD });
  assert.equal(spawn2.status, 200, spawn2.text);
  const sid2 = String(record(spawn2.json).id);
  const native2 = nativeIdOf(sid2);
  const takeover3 = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
  assert.equal(takeover3.status, 200, takeover3.text);
  const humanLease3 = String(record(takeover3.json).leaseId);
  const humanToken3 = String(record(takeover3.json).leaseToken);
  await waitFor(() => readCommands(native2).filter(c => c.command === 'abort').length === 1, 'abort on sid2 takeover');
  const cancelBeforeClose = broker.cancelPreemptedCalls.length;
  const closeDisplaced = await apiPost(`/api/sessions/${encodeURIComponent(sid2)}/close`, {});
  assert.equal(closeDisplaced.status, 200, closeDisplaced.text);
  await waitFor(() => broker.cancelPreemptedCalls.length === cancelBeforeClose + 1, 'cancel-preempted called on close-while-displaced');
  assert.equal(broker.state, 'human');
  assert.equal(broker.preempted, null);
  const release3 = await apiPost('/api/cu/release', { leaseId: humanLease3, leaseToken: humanToken3, handBack: true });
  assert.equal(release3.status, 200, release3.text);
  assert.equal(record(release3.json).state, 'idle');

  // 7. P1-8: Ambiguous nested omp descendants under one bound pane birth MUST receive ZERO commands!
  //    Launch a wrapper pane process that spawns TWO live registered omp children (one matching
  //    spawnToken so launch attaches to it, plus a nested sibling omp child under the same pane birth).
  //    On takeover, server-app's bridgeMatchesExpectedProcess sees 2 live omp descendants of the bound
  //    pane PID, rejects the ambiguous match, and dispatches ZERO abort commands to either child!
  const nestedLauncherPath = path.join(TEST_HOME, 'nested-omp-launcher.js');
  const nestedToken2 = 'bbbb2222bbbb2222bbbb2222bbbb2222';
  const nestedNative2 = `2026-11-25T00-00-00_${nestedToken2.slice(0, 12)}`;
  fs.writeFileSync(nestedLauncherPath, `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const c1 = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(TEST_FAKE_OMP_PATH)}, ...process.argv.slice(2)], {
  env: process.env,
  stdio: 'ignore',
});
const c2 = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(TEST_FAKE_OMP_PATH)}, '--extension', 'dummy'], {
  env: { ...process.env, PI_DISH_SPAWN_TOKEN: ${JSON.stringify(nestedToken2)} },
  stdio: 'ignore',
});
const cleanup = () => {
  try { c1.kill('SIGKILL'); } catch {}
  try { c2.kill('SIGKILL'); } catch {}
  process.exit(0);
};
process.on('SIGTERM', cleanup);
process.on('SIGHUP', cleanup);
process.on('SIGINT', cleanup);
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${nestedLauncherPath}`;
  const nestedSpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD });
  process.env.PI_DISH_OMP_COMMAND = origOmpCommand;
  assert.equal(nestedSpawn.status, 200, nestedSpawn.text);
  const nestedSid1 = String(record(nestedSpawn.json).id);
  const nestedNative1 = nativeIdOf(nestedSid1);
  const regDir = path.join(TEST_HOME, '.pi', 'dish', 'sessions');
  await waitFor(
    () => fs.existsSync(path.join(regDir, `omp-${nestedNative2}-${nestedToken2}.json`)),
    'nested sibling omp child registered',
  );

  const takeoverNested = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
  assert.equal(takeoverNested.status, 200, takeoverNested.text);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(readCommands(nestedNative1).length, 0, 'P1-8: ambiguous nested omp child 1 received ZERO commands');
  assert.equal(readCommands(nestedNative2).length, 0, 'P1-8: ambiguous nested omp child 2 received ZERO commands');
  await apiPost(`/api/sessions/${encodeURIComponent(nestedSid1)}/close`, {});
  await apiPost('/api/cu/release', {
    leaseId: String(record(takeoverNested.json).leaseId),
    leaseToken: String(record(takeoverNested.json).leaseToken),
    handBack: false,
  });
  await waitFor(() => broker.state === 'idle', 'broker idle after nested omp cleanup');

  // 8. Private (PIN-locked) session isolation: broker status/stream/audit/store NEVER see private session ID!
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
  assert.equal(cuStatusReply.text.includes(privSid), false);
  assert.equal(cuStatusReply.text.includes(privNative), false);
  assert.equal(cuAuditReply.text.includes(privSid), false);
  assert.equal(cuAuditReply.text.includes(privNative), false);
  assert.equal(cuStreamText.includes(privSid), false);
  assert.equal(cuStreamText.includes(privNative), false);

  await apiPost(`/api/sessions/${encodeURIComponent(privSid)}/close`, {}, unlockHeaders);
  await waitFor(() => broker.state === 'idle', 'broker idle after private session close');

  // 9. Final exhaustive secret + nonce + force:true sweep across ALL artifacts!
  assert.equal(broker.forcedMutationCalls.length, 0, 'P1-2: ZERO force:true broker mutations across entire E2E run');
  assert.ok(broker.issuedSecrets.size >= 3, 'broker issued agent secrets');
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

test('unit: Slice 2b capability gating — old Slice-2 broker (no 2b capabilities) keeps fail-closed behavior unchanged', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-old-s2-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  // Explicitly ensure zero Slice-2b capabilities are advertised (old Slice-2 broker).
  broker.disableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });
  const first = createCuAgentLeases({
    broker: client,
    storeFile: () => storePath,
    processAlive: () => true,
    heartbeatIntervalMs: 0,
    livenessCheckMs: 0,
    abortSession: async () => true,
    resumeSession: async () => true,
  });

  const caps = await first.probeCapabilities();
  assert.deepEqual(caps, { slice2: true, bindTransfer: false, ownerMatch: false, leaseRenew: false });

  const handle = present(await first.prepareSpawn({ knownSessionId: '~sk1_omp_old_s2' }));
  await first.bindSpawnedProcess(handle, { pid: 61001, startTime: '610010' });
  first.attachSpawnedSession(handle, { sessionId: '~sk1_omp_old_s2', pid: 61001, pidStartTime: '610010' });

  // Without bind_transfer, transfer is refused and prepareTransfer returns null without touching broker.
  assert.equal(first.canTransferSession('~sk1_omp_old_s2'), false);
  const claimsBefore = broker.claimNonceCalls.length;
  assert.equal(await first.prepareTransfer({ sessionId: '~sk1_omp_old_s2' }), null);
  assert.equal(broker.claimNonceCalls.length, claimsBefore);
  first.stop();

  // Across restart against an old Slice-2 broker (no lease_renew, no owner_match):
  // - live unredeemed lease -> ZERO /v1/lease/renew calls, marks access_lost (old Slice-2 behavior).
  const restartedUnredeemed = createCuAgentLeases({
    broker: client,
    storeFile: () => storePath,
    processAlive: p => p.pid === 61001 && p.startTime === '610010',
    findSessionIdByProcess: p => (p.pid === 61001 && p.startTime === '610010' ? '~sk1_omp_old_s2' : null),
    heartbeatIntervalMs: 25,
    livenessCheckMs: 0,
    abortSession: async () => true,
    resumeSession: async () => true,
  });
  await restartedUnredeemed.reconcile();
  assert.equal(broker.renewCalls.length, 0, 'old broker must never receive /v1/lease/renew');
  assert.equal(restartedUnredeemed.isDesktopAccessLost('~sk1_omp_old_s2'), true);
  restartedUnredeemed.stop();

  // - live claimed peer -> re-adopted secretless with ZERO heartbeats and ZERO secretless release on close.
  broker.simulateMcpClaim(61099);
  const hbBefore = broker.heartbeatCalls.length;
  const relBefore = broker.releaseCalls.length;
  const restartedClaimed = createCuAgentLeases({
    broker: client,
    storeFile: () => storePath,
    processAlive: p => p.pid === 61001 && p.startTime === '610010',
    pidAlive: p => p === 61099,
    findSessionIdByProcess: p => (p.pid === 61001 && p.startTime === '610010' ? '~sk1_omp_old_s2' : null),
    heartbeatIntervalMs: 25,
    livenessCheckMs: 0,
    abortSession: async () => true,
    resumeSession: async () => true,
  });
  await restartedClaimed.reconcile();
  assert.equal(broker.renewCalls.length, 0);
  assert.equal(restartedClaimed.ownerIdForSession('~sk1_omp_old_s2'), handle.leaseOwnerId);
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.equal(broker.heartbeatCalls.length, hbBefore, 'old broker secretless re-adoption sends zero heartbeats');
  await restartedClaimed.releaseSession('~sk1_omp_old_s2');
  assert.equal(broker.releaseCalls.length, relBefore, 'old broker without owner_match sends zero secretless releases');
  assert.equal(broker.forcedMutationCalls.length, 0);
  restartedClaimed.stop();
});

test('unit: Slice 2b Scope 1 — bind_transfer respawn (active & displaced, zero pid_dead reap), abortStaged on failed respawn & failed bind, takeover-during-transfer displaced 200, and never-prompted OMP restart refuses with 409', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2b-transfer-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // 1. Unit-level bind_transfer lifecycle: active transfer, abortStaged on failed respawn, abortStaged on failed bind, and takeover-during-transfer -> displaced 200.
  {
    const alivePids = new Set<string>(['62001:620010', '62002:620020', '62003:620030', '62004:620040']);
    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => alivePids.has(`${p.pid}:${p.startTime}`),
      heartbeatIntervalMs: 0,
      livenessCheckMs: 30,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());

    const caps = await mgr.probeCapabilities();
    assert.deepEqual(caps, { slice2: true, bindTransfer: true, ownerMatch: true, leaseRenew: true });

    const sid = '~sk1_omp_transfer_unit';
    const h1 = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h1, { pid: 62001, startTime: '620010' });
    mgr.attachSpawnedSession(h1, { sessionId: sid, pid: 62001, pidStartTime: '620010' });
    const epochBefore = broker.epoch;
    assert.equal(mgr.canTransferSession(sid), true);

    // 1a. Pre-respawn failure -> abortSpawn sends abortStaged:true and leaves old active lease & claim intact!
    const failedRespawnHandle = present(await mgr.prepareTransfer({ sessionId: sid }));
    assert.ok(failedRespawnHandle.transfer?.claimId, 'staged claimId returned');
    const lastStageCall = broker.claimNonceCalls[broker.claimNonceCalls.length - 1];
    assert.equal(lastStageCall.requireRebind, true);
    assert.equal(broker.stagedClaims.has(h1.brokerSessionId), true);
    assert.equal(broker.activeClaims.has(h1.brokerSessionId), true, 'old active claim kept untouched during staging');
    await mgr.abortSpawn(failedRespawnHandle);
    assert.equal(broker.abortStagedCalls.length, 1, 'abortSpawn sent abortStaged:true');
    assert.equal(broker.abortStagedCalls[0].claimId, failedRespawnHandle.transfer!.claimId);
    assert.equal(broker.stagedClaims.has(h1.brokerSessionId), false, 'staged claim cleared');
    assert.equal(broker.activeClaims.has(h1.brokerSessionId), true, 'old active claim still intact after abortStaged');
    assert.equal(mgr.ownerIdForSession(sid), h1.leaseOwnerId, 'old lease remains active');

    // 1b. Failed bind -> bindSpawnedProcess sends abortStaged:true and restores record birth!
    const failedBindHandle = present(await mgr.prepareTransfer({ sessionId: sid }));
    broker.nextBindError = { status: 409, body: { ok: false, code: 'claim_mismatch', message: 'Injected bind failure' } };
    const abortsStagedBefore = broker.abortStagedCalls.length;
    await assert.rejects(
      () => mgr.bindSpawnedProcess(failedBindHandle, { pid: 62002, startTime: '620020' }),
      /Injected bind failure/,
    );
    assert.equal(broker.abortStagedCalls.length, abortsStagedBefore + 1, 'failed bind immediately called abortStaged:true');
    assert.equal(broker.abortStagedCalls[broker.abortStagedCalls.length - 1].claimId, failedBindHandle.transfer!.claimId);
    assert.equal(mgr.ownerIdForSession(sid), h1.leaseOwnerId, 'record preserved when old birth still alive');

    // 1c. Successful active bind_transfer even after old PID dies and bridge retires during respawn (zero pid_dead reap, same epoch!).
    const transferHandle = present(await mgr.prepareTransfer({ sessionId: sid }));
    alivePids.delete('62001:620010');
    broker.deadBirths.add('62001:620010');
    // Simulate old bridge disconnect + liveness monitor tick while transfer is pending!
    mgr.handleSessionRetired(sid);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(broker.releaseCalls.length, 0, 'pending transfer prevents handleSessionRetired & liveness monitor from releasing lease');
    assert.equal(broker.reapedPidDeadCount, 0, 'rebind window defers pid_dead reaping');

    await mgr.bindSpawnedProcess(transferHandle, { pid: 62002, startTime: '620020' });
    mgr.attachSpawnedSession(transferHandle, { sessionId: sid, pid: 62002, pidStartTime: '620020' });
    assert.equal(broker.epoch, epochBefore, 'bind_transfer never increments epoch');
    assert.equal(broker.reapedPidDeadCount, 0, 'zero pid_dead reaps across bind_transfer');
    assert.equal(broker.lease?.pid, 62002);
    assert.equal(broker.lease?.pidStartTime, 620020);
    const commitBind = broker.bindCalls[broker.bindCalls.length - 1];
    assert.equal(commitBind.claimId, transferHandle.transfer!.claimId);
    assert.equal(commitBind.expectedEpoch, epochBefore);
    assert.equal(commitBind.expectedPid, 62001);
    assert.equal(commitBind.expectedPidStartTime, 620010);

    // 1d. Takeover happens BETWEEN prepareTransfer and bindSpawnedProcess -> epoch_mismatch retry -> displaced 200 -> preempted + abort!
    const takeoverTransferHandle = present(await mgr.prepareTransfer({ sessionId: sid }));
    await client.requestJson('POST', '/v1/lease/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(broker.state, 'human');
    assert.equal(broker.preempted?.sessionId, h1.brokerSessionId);
    alivePids.delete('62002:620020');
    broker.deadBirths.add('62002:620020');
    await mgr.bindSpawnedProcess(takeoverTransferHandle, { pid: 62003, startTime: '620030' });
    mgr.attachSpawnedSession(takeoverTransferHandle, { sessionId: sid, pid: 62003, pidStartTime: '620030' });
    await waitFor(() => aborts.some(a => a.pid === 62003), 'displaced bind_transfer schedules abort on new birth');
    assert.equal(broker.state, 'human', 'human lease undisturbed');
    assert.equal(broker.preempted?.pid, 62003, 'displaced reservation updated to new birth');

    // 1e. Direct bind_transfer on an already-displaced reservation answers 200 displaced immediately!
    const displacedTransferHandle = present(await mgr.prepareTransfer({ sessionId: sid }));
    alivePids.delete('62003:620030');
    broker.deadBirths.add('62003:620030');
    await mgr.bindSpawnedProcess(displacedTransferHandle, { pid: 62004, startTime: '620040' });
    mgr.attachSpawnedSession(displacedTransferHandle, { sessionId: sid, pid: 62004, pidStartTime: '620040' });
    await waitFor(() => aborts.some(a => a.pid === 62004), 'already-displaced bind_transfer answers 200 displaced and schedules abort');
    assert.equal(broker.preempted?.pid, 62004);
    assert.equal(broker.validationErrorCalls.length, 0, 'zero 400 validation errors');
    assert.equal(broker.forcedMutationCalls.length, 0, 'zero force:true calls');

    broker.resetIdleForTest();
  }

  // 2. Real tmux pane + SessionOperations restartSession:
  //    - C1: Never-prompted OMP session (missing .jsonl on disk -> ENOENT) refuses with 409 (main's exact behavior), keeping pane & lease untouched.
  //    - Resumable OMP session (.jsonl present) restarts cleanly in place via bind_transfer (same paneId, same epoch, zero pid_dead reap!).
  //    - access_lost session restart falls back to fresh acquire+claim+bind and restores desktop access!
  {
    const tmuxDir = tmux.tmuxTmpdir();
    fs.mkdirSync(tmuxDir, { recursive: true, mode: 0o700 });
    const tmuxSock = path.join(tmuxDir, `s2b-transfer-${process.pid}-${Date.now()}`);
    const ompEnvDir = path.join(tmpDir, 'omp-env');
    const ompCmdDir = path.join(tmpDir, 'omp-cmd');
    const fakeOmp = path.join(tmpDir, 'fake-omp-s2b.js');
    writeFakeOmpScript(fakeOmp, require.resolve('../lib/process-identity'), {
      envDir: ompEnvDir,
      cmdDir: ompCmdDir,
      holdRegisterFlag: path.join(tmpDir, 'no-hold'),
    });
    const prevOmpCmd = process.env.PI_DISH_OMP_COMMAND;
    process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${fakeOmp}`;
    t.after(() => {
      if (prevOmpCmd === undefined) delete process.env.PI_DISH_OMP_COMMAND;
      else process.env.PI_DISH_OMP_COMMAND = prevOmpCmd;
      try { execFileSync('tmux', ['-S', tmuxSock, 'kill-server'], { stdio: 'ignore', timeout: 10_000 }); } catch {}
    });

    broker.enforceRealPids = true;
    const leases = createCuAgentLeases({
      broker: client,
      storeFile: () => path.join(tmpDir, 'ops-leases.json'),
      heartbeatIntervalMs: 0,
      livenessCheckMs: 50,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => leases.stop());

    const sessionLaunch = createSessionLaunch({
      runHarnessModelCommand: async () => [],
      cuLeases: leases,
    });
    const { getHarness } = require('../lib/harnesses') as typeof import('../lib/harnesses');
    const { getRegisteredSessionByNativeId, invalidateRegistryCache } = require('../lib/bridge-session') as typeof import('../lib/bridge-session');
    const ompDescriptor = present(getHarness('omp'));

    const initialLaunch = await sessionLaunch.launchNewSession({
      descriptor: ompDescriptor,
      cwd: tmpDir,
      target: { type: 'tmux', socket: tmuxSock, newTmuxSession: 'cu-never-prompted' },
    });
    assert.equal(
      initialLaunch.kind,
      'ready',
      initialLaunch.kind === 'ready' ? '' : `initialLaunch failed: ${String(initialLaunch.error)}`,
    );
    const initialRouteId = initialLaunch.id;
    const initialSpawn = present(tmux.getSpawn(initialRouteId));
    const initialPaneId = initialSpawn.paneId;
    const initialOwnerId = present(leases.ownerIdForSession(initialRouteId));
    const initialEpoch = broker.epoch;

    invalidateRegistryCache();
    const initialNative = present(resolveSessionRoute(initialRouteId)).nativeSessionId;
    const initialReg = present(getRegisteredSessionByNativeId('omp', initialNative));
    const sessionFilePath = String(initialReg.sessionFile);
    const savedSessionFile = fs.readFileSync(sessionFilePath, 'utf8');

    const ops = createSessionOperations({
      ownership: {
        sessionSources: { resolve: () => null },
        liveSourceObservations: () => [],
        getRegisteredSession: () => initialReg,
        getRPCSession: () => null,
        getLiveSession: async () => null,
        liveSubsessionCandidates: () => [],
        capturePaneRestart: async () => ({
          kind: 'pane-restart',
          sessionId: initialRouteId,
          placement: initialSpawn,
          registry: initialReg,
        }),
        preparePaneRestart: async () => ({ registry: initialReg }),
        revalidatePaneRestart: (_cap: unknown, proved: { registry: unknown }) => proved.registry,
        captureOwnedPaneClose: async () => ({
          sessionId: initialRouteId,
          placement: initialSpawn,
          registry: initialReg,
          agentProcess: present(initialSpawn.paneProcess),
        }),
        revalidateOwnedPaneClose: () => {},
      } as unknown as SessionOperationsMod.SessionOperationObservations['ownership'],
      launch: sessionLaunch,
      getActiveSessions: () => [],
      readSessionCwd: () => tmpDir,
      recordLaunchProvenance: () => {},
      onSessionStopped: id => leases.releaseSession(id),
      cuCheckCapabilities: () => leases.probeCapabilities(),
      cuCanTransferSession: id => leases.canTransferSession(id),
      cuIsChecking: id => leases.isDesktopChecking(id),
    });

    // C1: Delete the .jsonl file to model a never-prompted OMP session -> MUST refuse with 409 (main's exact behavior) and touch nothing!
    fs.unlinkSync(sessionFilePath);
    assert.equal(fs.existsSync(sessionFilePath), false, 'precondition: never-prompted session has no JSONL file on disk');
    const claimBefore409 = broker.claimNonceCalls.length;
    const bindBefore409 = broker.bindCalls.length;
    const releaseBefore409 = broker.releaseCalls.length;
    const acquireBefore409 = broker.acquireCalls.length;
    const missingFileResp = await ops.restartSessionById(initialRouteId);
    assert.equal(missingFileResp.status, 409, 'never-prompted OMP restart refuses with 409');
    assert.equal(missingFileResp.body.error, 'The active agent has no resumable session file.');
    const initialPaneRec = record(initialSpawn.paneProcess);
    const initialPaneProc = { pid: Number(initialPaneRec.pid), startTime: String(initialPaneRec.startTime) };
    assert.equal(processIdentityAlive(initialPaneProc), true, 'refused 409 restart leaves pane process alive');
    assert.equal(broker.claimNonceCalls.length, claimBefore409, 'refused 409 restart mints no claim');
    assert.equal(broker.bindCalls.length, bindBefore409, 'refused 409 restart sends no bind');
    assert.equal(broker.releaseCalls.length, releaseBefore409, 'refused 409 restart releases nothing');
    assert.equal(broker.acquireCalls.length, acquireBefore409, 'refused 409 restart acquires nothing');

    // Restore .jsonl on disk -> resumable OMP session restarts in place via bind_transfer!
    fs.writeFileSync(sessionFilePath, savedSessionFile);
    const reapedBefore = broker.reapedPidDeadCount;
    const acquireBefore = broker.acquireCalls.length;
    const restarted = await ops.restartSession(initialRouteId);
    assert.equal(restarted.kind, 'stopped', `resumable OMP bind_transfer restart must succeed (got ${JSON.stringify(restarted)})`);
    const replacement = present(restarted.replacement);
    assert.equal(replacement.paneId, initialPaneId, 'bind_transfer restarted in place in the same tmux pane');
    assert.equal(broker.epoch, initialEpoch, 'bind_transfer kept epoch unchanged');
    assert.equal(broker.acquireCalls.length, acquireBefore, 'bind_transfer did not do a fresh acquire');
    assert.equal(broker.reapedPidDeadCount, reapedBefore, 'restart transferred cleanly with zero pid_dead reap');
    assert.equal(leases.ownerIdForSession(replacement.id), initialOwnerId, 'restarted session retained the same CU ownerId');

    // Now simulate access_lost on that session (e.g. broker lost lease) -> restart must fall back to fresh acquire and restore access!
    const nextSpawn = present(tmux.getSpawn(replacement.id));
    invalidateRegistryCache();
    const nextNative = present(resolveSessionRoute(replacement.id)).nativeSessionId;
    const nextReg = present(getRegisteredSessionByNativeId('omp', nextNative));
    broker.resetIdleForTest();
    leases.handleBrokerEvent({
      eventName: 'seat_idle',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor + 1,
      payload: { ...broker.snapshotPayload(), cursor: broker.cursor + 1, reason: 'ttl_expired' },
    });
    assert.equal(leases.isDesktopAccessLost(replacement.id), true, 'precondition: session is access_lost');
    assert.equal(leases.canTransferSession(replacement.id), false, 'access_lost session is not transferable');

    const opsAccessLost = createSessionOperations({
      ownership: {
        sessionSources: { resolve: () => ({ harnessId: 'omp', nativeSessionId: nextNative, file: String(nextReg.sessionFile) }) },
        liveSourceObservations: () => [],
        getRegisteredSession: () => nextReg,
        getRPCSession: () => null,
        getLiveSession: async () => null,
        liveSubsessionCandidates: () => [],
        capturePaneRestart: async () => ({
          kind: 'pane-restart',
          sessionId: replacement.id,
          placement: nextSpawn,
          registry: nextReg,
        }),
        preparePaneRestart: async () => ({ registry: nextReg }),
        revalidatePaneRestart: (_cap: unknown, proved: { registry: unknown }) => proved.registry,
        captureOwnedPaneClose: async () => ({
          sessionId: replacement.id,
          placement: nextSpawn,
          registry: nextReg,
          agentProcess: present(nextSpawn.paneProcess),
        }),
        revalidateOwnedPaneClose: () => {},
      } as unknown as SessionOperationsMod.SessionOperationObservations['ownership'],
      launch: sessionLaunch,
      getActiveSessions: () => [],
      readSessionCwd: () => tmpDir,
      recordLaunchProvenance: () => {},
      onSessionStopped: id => leases.releaseSession(id),
      cuCheckCapabilities: () => leases.probeCapabilities(),
      cuCanTransferSession: id => leases.canTransferSession(id),
    });

    const restored = await opsAccessLost.restartSession(replacement.id);
    assert.equal(restored.kind, 'stopped', `access_lost fallback restart must succeed (got ${JSON.stringify(restored)})`);
    assert.equal(leases.isDesktopAccessLost(present(restored.replacement).id), false);
    assert.ok(leases.ownerIdForSession(present(restored.replacement).id), 'access_lost fallback restored fresh desktop lease');
    assert.equal(broker.validationErrorCalls.length, 0);
    assert.equal(broker.forcedMutationCalls.length, 0);
  }
});

test('unit: Slice 2b Scope 2 — owner_match secretless release/cancel, owner mismatch refusal (human & other agent untouched, zero force:true), dead-orphan cleanup, and 409 transition_pending after idle reap', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2b-owner-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  // Enable owner_match ONLY (without lease_renew) so re-adopted records stay secretless and exercise pure owner_match!
  broker.enableSlice2b([SLICE2B_CAPABILITIES.ownerMatch]);
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Case 1: Secretless re-adopted active lease close uses owner_match release (no secret, no force:true) -> seat becomes idle!
  {
    const first = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: '~sk1_omp_om1' }));
    await first.bindSpawnedProcess(h, { pid: 63001, startTime: '630010' });
    broker.simulateMcpClaim(63091);
    first.stop();

    const restarted = createCuAgentLeases({
      broker: client, storeFile: () => storePath,
      processAlive: p => p.pid === 63001 && p.startTime === '630010',
      pidAlive: p => p === 63091,
      findSessionIdByProcess: p => (p.pid === 63001 && p.startTime === '630010' ? '~sk1_omp_om1' : null),
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    await restarted.reconcile();
    const relBefore = broker.releaseCalls.length;
    await restarted.releaseSession('~sk1_omp_om1');
    assert.equal(broker.releaseCalls.length, relBefore + 1);
    const relCall = broker.releaseCalls[broker.releaseCalls.length - 1];
    assert.equal(relCall.ownerId, h.leaseOwnerId);
    assert.equal(relCall.sessionId, h.brokerSessionId);
    assert.equal(relCall.expectedState, 'active');
    assert.equal(relCall.sessionSecret, undefined, 'secretless owner_match omits sessionSecret');
    assert.equal(relCall.force, undefined, 'never sends force');
    assert.equal(broker.state, 'idle', 'secretless owner_match released owned active lease');
    restarted.stop();
  }

  // Case 2: Active lease preempted by human right before close -> owner_match release gets 409 lease_preempted -> cancels displaced reservation, human untouched!
  {
    const mgr = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    await mgr.probeCapabilities();
    const h = present(await mgr.prepareSpawn({ knownSessionId: '~sk1_omp_om2' }));
    await mgr.bindSpawnedProcess(h, { pid: 63002, startTime: '630020' });
    mgr.attachSpawnedSession(h, { sessionId: '~sk1_omp_om2', pid: 63002, pidStartTime: '630020' });
    // Human takes over in broker, but mgr has NOT yet processed SSE preempted (still thinks status === 'holding').
    await client.requestJson('POST', '/v1/lease/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(broker.state, 'human');
    assert.equal(broker.preempted?.ownerId, h.leaseOwnerId);

    const cancelBefore = broker.cancelPreemptedCalls.length;
    await mgr.releaseSession('~sk1_omp_om2');
    assert.equal(broker.cancelPreemptedCalls.length, cancelBefore + 1, '409 lease_preempted followed up with cancel-preempted');
    assert.equal(broker.cancelPreemptedCalls[broker.cancelPreemptedCalls.length - 1].ownerId, h.leaseOwnerId);
    assert.equal(broker.cancelPreemptedCalls[broker.cancelPreemptedCalls.length - 1].expectedState, 'displaced');
    assert.equal(broker.state, 'human', 'human lease untouched');
    assert.equal(broker.preempted, null, 'displaced reservation cancelled');
    mgr.stop();
    broker.resetIdleForTest();
  }

  // Case 3: Owner mismatch -> broker holds a DIFFERENT owner's agent lease (and also human lease) -> release refuses without force:true, other holder untouched!
  {
    const first = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: '~sk1_omp_om3' }));
    await first.bindSpawnedProcess(h, { pid: 63003, startTime: '630030' });
    broker.simulateMcpClaim(63093);
    first.stop();

    const restarted = createCuAgentLeases({
      broker: client, storeFile: () => storePath,
      processAlive: p => p.pid === 63003 && p.startTime === '630030',
      pidAlive: p => p === 63093,
      findSessionIdByProcess: p => (p.pid === 63003 && p.startTime === '630030' ? '~sk1_omp_om3' : null),
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    await restarted.reconcile();
    // Replace broker's active lease with a DIFFERENT owner's agent lease!
    broker.resetIdleForTest();
    await client.requestJson('POST', '/v1/lease/acquire', {
      holderKind: 'agent',
      sessionId: 'cu-agent-foreign',
      ownerId: 'cu-owner-foreign-someone-else',
      label: 'omp',
    });
    const foreignLeaseId = broker.lease?.leaseId;
    await restarted.releaseSession('~sk1_omp_om3');
    assert.equal(broker.state, 'agent', 'foreign agent lease MUST NOT be evicted on owner mismatch');
    assert.equal(broker.lease?.leaseId, foreignLeaseId);
    assert.equal(broker.lease?.ownerId, 'cu-owner-foreign-someone-else');
    restarted.stop();
    broker.resetIdleForTest();
  }

  // Case 4: Dead orphan cleanup on startup reconcile with owner_match releases our dead lease cleanly (zero force:true).
  {
    const first = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: '~sk1_omp_om4' }));
    await first.bindSpawnedProcess(h, { pid: 63004, startTime: '630040' });
    first.stop();

    const restarted = createCuAgentLeases({
      broker: client, storeFile: () => storePath,
      processAlive: () => false, // omp died while pi-dish was down
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    await restarted.reconcile();
    assert.equal(broker.state, 'idle', 'owner_match dead-orphan cleanup released dead agent lease');
    restarted.stop();
  }

  // Case 5: Known broker leftover — release returns 409 transition_pending AFTER reaping seat to idle -> tolerated cleanly!
  {
    const mgr = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    await mgr.probeCapabilities();
    const h = present(await mgr.prepareSpawn({ knownSessionId: '~sk1_omp_om5' }));
    await mgr.bindSpawnedProcess(h, { pid: 63005, startTime: '630050' });
    mgr.attachSpawnedSession(h, { sessionId: '~sk1_omp_om5', pid: 63005, pidStartTime: '630050' });
    broker.nextReleaseError = {
      status: 409,
      reapToIdleFirst: true,
      body: { ok: false, code: 'transition_pending', retryAfterMs: 150, message: 'Transition pending after reap to idle' },
    };
    const relBefore = broker.releaseCalls.length;
    await mgr.releaseSession('~sk1_omp_om5');
    assert.equal(broker.releaseCalls.length, relBefore + 1, 'stopped immediately when 409 transition_pending showed state:idle');
    assert.equal(broker.state, 'idle');
    mgr.stop();
  }

  assert.equal(broker.validationErrorCalls.length, 0, 'zero 400 validation errors across owner_match tests');
  assert.equal(broker.forcedMutationCalls.length, 0, 'ZERO force:true calls across owner_match tests');
});

test('unit: Slice 2b Scope 3 — lease_renew re-adoption (active & displaced, periodic heartbeats & full abort/nudge routing), failed renew aborts & marks access_lost, and checking state before reconcile', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2b-renew-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Case 1: Active unredeemed lease across pi-dish restart:
  // - BEFORE reconcile(): isDesktopAccessLost === false, isDesktopChecking === true (no transient access_lost!).
  // - reconcile() calls POST /v1/lease/renew (issueClaim:false) -> restores sessionSecret, restarts periodic heartbeats,
  //   restores full abort/nudge routing, and enables bind_transfer!
  {
    const sid = '~sk1_omp_renew_active';
    const first = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: sid }));
    await first.bindSpawnedProcess(h, { pid: 64001, startTime: '640010' });
    // Note: NOT mcpClaimed — only active unredeemed claim exists (claim.status === 'refreshed').
    first.stop();

    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const nudges: Array<{ target: CuAgentLeasesMod.CuCommandTarget; text: string }> = [];
    const restarted = createCuAgentLeases({
      broker: client, storeFile: () => storePath,
      processAlive: p => p.pid === 64001 && p.startTime === '640010',
      findSessionIdByProcess: p => (p.pid === 64001 && p.startTime === '640010' ? sid : null),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async (target, text) => { nudges.push({ target, text }); return true; },
    });
    t.after(() => restarted.stop());

    // Pre-reconcile check: NO transient access_lost, checking state is true!
    assert.equal(restarted.isDesktopAccessLost(sid), false, 'before reconcile: never flashes access_lost');
    assert.equal(restarted.isDesktopChecking(sid), true, 'before reconcile: reports checking state');
    assert.equal(restarted.ownerIdForSession(sid), null, 'before reconcile: does not claim ownership prematurely');

    const renewBefore = broker.renewCalls.length;
    const hbBefore = broker.heartbeatCalls.length;
    await restarted.reconcile();

    assert.equal(broker.renewCalls.length, renewBefore + 1, 'reconcile called /v1/lease/renew');
    assert.equal(broker.renewCalls[broker.renewCalls.length - 1].issueClaim, false);
    assert.equal(restarted.isDesktopChecking(sid), false, 'checking clears after reconcile');
    assert.equal(restarted.isDesktopAccessLost(sid), false);
    assert.equal(restarted.ownerIdForSession(sid), h.leaseOwnerId);
    assert.equal(restarted.canTransferSession(sid), true, 'renewed session restored sessionSecret for bind_transfer');

    // Periodic heartbeats resume using the rotated sessionSecret!
    await waitFor(() => broker.heartbeatCalls.length > hbBefore, 'periodic heartbeat sent after lease_renew');

    // Full abort + hand-back nudge routing works on renewed session!
    const to = await client.requestJson('POST', '/v1/lease/takeover', { label: 'pi-dish', ttlSec: 600 });
    restarted.handleBrokerEvent({
      eventName: 'preempted',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: { ...broker.snapshotPayload(), displaced: broker.publicLease(broker.preempted) },
    });
    await waitFor(() => aborts.length === 1, 'renewed session receives abort on takeover');

    const toBody = record(to.body);
    await client.requestJson('POST', '/v1/lease/release', {
      leaseId: String(toBody.leaseId), leaseToken: String(toBody.leaseToken), handBack: true,
    });
    restarted.handleBrokerEvent({
      eventName: 'hand_back',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: { ...broker.snapshotPayload(), handedBackTo: broker.publicLease(broker.lease) },
    });
    await waitFor(() => nudges.length === 1, 'renewed session receives hand-back nudge');
    assert.equal(nudges[0].text, CU_HAND_BACK_NUDGE);

    restarted.stop();
    broker.resetIdleForTest();
  }

  // Case 2: Failed renew (broker rejects renew with 403 birth_mismatch) -> MUST mark access_lost AND schedule abort (never silently continue)!
  {
    const sid = '~sk1_omp_renew_fail_err';
    const first = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: sid }));
    await first.bindSpawnedProcess(h, { pid: 64002, startTime: '640020' });
    first.stop();

    broker.nextRenewError = { status: 403, body: { ok: false, code: 'birth_mismatch', message: 'Birth mismatch on renew' } };
    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const hbBefore = broker.heartbeatCalls.length;
    const restarted = createCuAgentLeases({
      broker: client, storeFile: () => storePath,
      processAlive: p => p.pid === 64002 && p.startTime === '640020',
      findSessionIdByProcess: p => (p.pid === 64002 && p.startTime === '640020' ? sid : null),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async () => true,
    });
    await restarted.reconcile();
    assert.equal(restarted.isDesktopChecking(sid), false);
    assert.equal(restarted.isDesktopAccessLost(sid), true, 'failed renew marks desktop access lost');
    assert.equal(restarted.ownerIdForSession(sid), null);
    await waitFor(() => aborts.length === 1, 'failed renew schedules abort');
    await new Promise(resolve => setTimeout(resolve, 65));
    assert.equal(broker.heartbeatCalls.length, hbBefore, 'failed renew starts zero heartbeats');
    restarted.stop();
    broker.resetIdleForTest();
  }

  // Case 3: Renew returns 200 with claim.status === 'none' (no active claim and no live claimed peer, e.g. broker restarted) -> MUST mark access_lost + abort!
  {
    const sid = '~sk1_omp_renew_none';
    const first = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: sid }));
    await first.bindSpawnedProcess(h, { pid: 64003, startTime: '640030' });
    // Wipe in-memory active claim to model a broker restart while claim was unredeemed.
    broker.activeClaims.delete(h.brokerSessionId);
    first.stop();

    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const restarted = createCuAgentLeases({
      broker: client, storeFile: () => storePath,
      processAlive: p => p.pid === 64003 && p.startTime === '640030',
      findSessionIdByProcess: p => (p.pid === 64003 && p.startTime === '640030' ? sid : null),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async () => true,
    });
    await restarted.reconcile();
    assert.equal(restarted.isDesktopAccessLost(sid), true, 'renew with claim.status=none marks access_lost');
    assert.equal(broker.state, 'idle', 'F2: renew with claim.status=none releases seat via owner_match so seat frees');
    await waitFor(() => aborts.length === 1, 'renew with unusable claim schedules abort');
    restarted.stop();
    broker.resetIdleForTest();
  }

  // Case 4: Displaced lease re-adopted via lease_renew -> marks preempted, schedules abort, restores sessionSecret,
  // and resumes periodic heartbeats + hand-back nudge once human hands back!
  {
    const sid = '~sk1_omp_renew_displaced';
    const first = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: sid }));
    await first.bindSpawnedProcess(h, { pid: 64004, startTime: '640040' });
    const to = await client.requestJson('POST', '/v1/lease/takeover', { label: 'pi-dish', ttlSec: 600 });
    const toBody = record(to.body);
    assert.equal(broker.state, 'human');
    assert.equal(broker.preempted?.ownerId, h.leaseOwnerId);
    first.stop();

    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const nudges: Array<{ target: CuAgentLeasesMod.CuCommandTarget; text: string }> = [];
    const hbBefore = broker.heartbeatCalls.length;
    const restarted = createCuAgentLeases({
      broker: client, storeFile: () => storePath,
      processAlive: p => p.pid === 64004 && p.startTime === '640040',
      findSessionIdByProcess: p => (p.pid === 64004 && p.startTime === '640040' ? sid : null),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async (target, text) => { nudges.push({ target, text }); return true; },
    });
    t.after(() => restarted.stop());

    await restarted.reconcile();
    assert.equal(restarted.isDesktopChecking(sid), false);
    assert.equal(restarted.isDesktopAccessLost(sid), false);
    assert.equal(restarted.ownerIdForSession(sid), h.leaseOwnerId);
    assert.equal(restarted.canTransferSession(sid), true);
    await waitFor(() => aborts.length === 1, 'renewed displaced lease schedules abort');

    await client.requestJson('POST', '/v1/lease/release', {
      leaseId: String(toBody.leaseId), leaseToken: String(toBody.leaseToken), handBack: true,
    });
    restarted.handleBrokerEvent({
      eventName: 'hand_back',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: { ...broker.snapshotPayload(), handedBackTo: broker.publicLease(broker.lease) },
    });
    await waitFor(() => nudges.length === 1, 'renewed displaced lease receives hand-back nudge');
    await waitFor(() => broker.heartbeatCalls.length > hbBefore, 'periodic heartbeats run after displaced lease hand-back');
    restarted.stop();
    broker.resetIdleForTest();
  }

  assert.equal(broker.validationErrorCalls.length, 0);
  assert.equal(broker.forcedMutationCalls.length, 0);
});

test('unit: Slice 2b Scope 4 & 5 — applied:"unknown" uncertain mapping + unbound acquire cleanup, broker_shutting_down typed/retryable, displaced 200 on bind, requestId takeover replay, ASCII JSON, and hand-back nudge text', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2b-errors-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Scope 5: Hand-back nudge text says control is back and agent can continue its task — does NOT invite browser/screen exploration!
  assert.match(CU_HAND_BACK_NUDGE, /control/i);
  assert.match(CU_HAND_BACK_NUDGE, /continue/i);
  assert.equal(/browser|inspect|screen|explor/i.test(CU_HAND_BACK_NUDGE), false,
    `CU_HAND_BACK_NUDGE must not invite browser/screen exploration: ${CU_HAND_BACK_NUDGE}`);

  const mgr = createCuAgentLeases({
    broker: client,
    storeFile: () => storePath,
    processAlive: () => true,
    heartbeatIntervalMs: 0,
    livenessCheckMs: 0,
    abortSession: async () => true,
    resumeSession: async () => true,
  });
  t.after(() => mgr.stop());
  await mgr.probeCapabilities();

  // Scope 4a: acquire returning 503 broker_busy with applied:"unknown" is mapped as uncertain (NEVER applied:false!)
  // AND performs guarded owner-matched cleanup of any committed unbound lease (zero force:true)!
  broker.nextAcquireError = {
    status: 503,
    commitBeforeError: true,
    body: { ok: false, code: 'broker_busy', applied: 'unknown', retryAfterMs: 250, message: 'Commit grace elapsed; outcome unknown' },
  };
  await assert.rejects(
    () => mgr.prepareSpawn({ knownSessionId: '~sk1_omp_uncertain', assumeSlice2: true }),
    (err: unknown) => {
      assert.ok(err instanceof CuBrokerUnavailableError);
      assert.equal(err.status, 503);
      assert.equal(err.code, 'cu_broker_uncertain');
      assert.equal(err.brokerCode, 'broker_busy');
      assert.equal(err.applied, 'unknown');
      assert.equal(err.uncertain, true);
      assert.equal(err.retryable, true);
      assert.equal(err.retryAfterMs, 250);
      return true;
    },
  );
  assert.equal(broker.state, 'idle', 'guarded owner-matched cleanup released the committed-but-unanswered unbound acquire');
  assert.equal(broker.forcedMutationCalls.length, 0, 'zero force:true during uncertain acquire cleanup');

  // Scope 4b: 503 broker_shutting_down is typed and retryable (not uncertain).
  broker.nextAcquireError = {
    status: 503,
    body: { ok: false, code: 'broker_shutting_down', message: 'cu-broker is shutting down.' },
  };
  await assert.rejects(
    () => mgr.prepareSpawn({ knownSessionId: '~sk1_omp_shutdown', assumeSlice2: true }),
    (err: unknown) => {
      assert.ok(err instanceof CuBrokerUnavailableError);
      assert.equal(err.status, 503);
      assert.equal(err.code, 'broker_shutting_down');
      assert.equal(err.brokerCode, 'broker_shutting_down');
      assert.equal(err.retryable, true);
      assert.equal(err.uncertain, false);
      return true;
    },
  );

  // Scope 4c: Fresh bind on a lease displaced between acquire and bind answers 200 target:"displaced" -> enters displaced (preempted) state and schedules abort!
  {
    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const dispMgr = createCuAgentLeases({
      broker: client,
      storeFile: () => path.join(tmpDir, 'disp-leases.json'),
      processAlive: () => true,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async () => true,
    });
    t.after(() => dispMgr.stop());
    const sid = '~sk1_omp_bind_displaced';
    const h = present(await dispMgr.prepareSpawn({ knownSessionId: sid }));
    // Human takes over before bind arrives!
    await client.requestJson('POST', '/v1/lease/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(broker.state, 'human');
    await dispMgr.bindSpawnedProcess(h, { pid: 65001, startTime: '650010' });
    dispMgr.attachSpawnedSession(h, { sessionId: sid, pid: 65001, pidStartTime: '650010' });
    await waitFor(() => aborts.length === 1 && aborts[0].pid === 65001, 'displaced 200 on bind transitions to displaced state and schedules abort');
    assert.equal(dispMgr.ownerIdForSession(sid), h.leaseOwnerId);
    broker.resetIdleForTest();
  }

  // Scope 4d: cu-handlers normalizes applied:"unknown" + broker_shutting_down, forwards requestId on takeover replay, and decodes ASCII-escaped JSON!
  {
    const handlers = createCuHandlers({ broker: client, upgradeAuthorized: () => true });
    t.after(() => handlers.stop());

    const invokeHandler = async (
      handler: CuHandlersMod.CuHandlers['takeover'],
      body: Record<string, unknown>,
    ): Promise<{ status: number; json: Record<string, unknown> }> => {
      let statusCode = 200;
      let payload: unknown = null;
      const req = { method: 'POST', body, headers: {}, query: {} } as unknown as Parameters<typeof handler>[0];
      const res = {
        headersSent: false,
        status(code: number) { statusCode = code; return res; },
        json(val: unknown) { payload = val; res.headersSent = true; return res; },
        setHeader() {},
      } as unknown as Parameters<typeof handler>[1];
      await handler(req, res, () => {});
      return { status: statusCode, json: record(payload) };
    };

    // Wait for watch sync via status/watcher.
    await waitFor(() => broker.eventsRequests.length >= 1, 'cu-handlers watcher synced');
    await new Promise(resolve => setTimeout(resolve, 40));

    // applied:"unknown" on takeover -> uncertain:true, applied:"unknown", retryable:true (never applied:false).
    broker.nextTakeoverError = {
      status: 503,
      body: { ok: false, code: 'broker_busy', applied: 'unknown', message: 'Applying takeover; outcome unknown' },
    };
    const unk = await invokeHandler(handlers.takeover, { label: 'pi-dish', requestId: 'req-0123456789abcdef' });
    assert.equal(unk.status, 503);
    assert.equal(unk.json.applied, 'unknown');
    assert.equal(unk.json.uncertain, true);
    assert.equal(unk.json.retryable, true);

    // broker_shutting_down on takeover -> code:'broker_shutting_down', retryable:true.
    broker.nextTakeoverError = {
      status: 503,
      body: { ok: false, code: 'broker_shutting_down', message: 'cu-broker is shutting down.' },
    };
    const sd = await invokeHandler(handlers.takeover, { label: 'pi-dish', requestId: 'req-0123456789abcdef' });
    assert.equal(sd.status, 503);
    assert.equal(sd.json.code, 'broker_shutting_down');
    assert.equal(sd.json.retryable, true);

    // Same-requestId takeover replay + non-ASCII label (ASCII-escaped by broker JSON) decoded cleanly!
    const rid = 'req-replay-0123456789abcdef';
    const firstTake = await invokeHandler(handlers.takeover, { label: 'café-viewer', requestId: rid });
    assert.equal(firstTake.status, 200);
    assert.equal(record(firstTake.json.lease).label, 'café-viewer', 'ASCII-escaped JSON decoded cleanly');
    const replayTake = await invokeHandler(handlers.takeover, { label: 'café-viewer', requestId: rid });
    assert.equal(replayTake.status, 200);
    assert.equal(replayTake.json.replayed, true, 'same requestId replayed takeover outcome');
    assert.equal(replayTake.json.leaseToken, firstTake.json.leaseToken);
  }
});

test('unit: F1 (B3) — bind succeeds, registration fails, cleanup fails -> replacement lease released via owner_match and heartbeats stop; pre-commit keeps only proven original birth', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-f1-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Part A: Real tmux + SessionLaunch + CuAgentLeases:
  // bind commits replacement birth -> registration times out -> tmux cleanup fails (replacement process stays alive!)
  // -> abortSpawn MUST release the replacement birth via owner_match and stop heartbeats!
  {
    const tmuxDir = tmux.tmuxTmpdir();
    fs.mkdirSync(tmuxDir, { recursive: true, mode: 0o700 });
    const tmuxSock = path.join(tmuxDir, `f1-cleanup-fail-${process.pid}-${Date.now()}`);
    const holdFlag = path.join(tmpDir, 'hold-register.flag');
    const trapFlag = path.join(tmpDir, 'trap-signals.flag');
    const fakeOmp = path.join(tmpDir, 'fake-omp-f1.js');
    writeFakeOmpScript(fakeOmp, require.resolve('../lib/process-identity'), {
      envDir: path.join(tmpDir, 'env'),
      cmdDir: path.join(tmpDir, 'cmd'),
      holdRegisterFlag: holdFlag,
      trapSignalsFlag: trapFlag,
    });

    const prevOmpCmd = process.env.PI_DISH_OMP_COMMAND;
    const prevTimeout = process.env.PI_DISH_SPAWN_TIMEOUT_MS;
    const survivingPids: number[] = [];
    process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${fakeOmp}`;
    t.after(() => {
      if (prevOmpCmd === undefined) delete process.env.PI_DISH_OMP_COMMAND;
      else process.env.PI_DISH_OMP_COMMAND = prevOmpCmd;
      if (prevTimeout === undefined) delete process.env.PI_DISH_SPAWN_TIMEOUT_MS;
      else process.env.PI_DISH_SPAWN_TIMEOUT_MS = prevTimeout;
      for (const pid of survivingPids) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
      try { execFileSync('tmux', ['-S', tmuxSock, 'kill-server'], { stdio: 'ignore', timeout: 10_000 }); } catch {}
    });

    broker.enforceRealPids = true;
    const leases = createCuAgentLeases({
      broker: client,
      storeFile: () => path.join(tmpDir, 'f1-real-leases.json'),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 50,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => leases.stop());

    const sessionLaunch = createSessionLaunch({
      runHarnessModelCommand: async () => [],
      cuLeases: leases,
    });
    const { getHarness } = require('../lib/harnesses') as typeof import('../lib/harnesses');
    const { getRegisteredSessionByNativeId, invalidateRegistryCache } = require('../lib/bridge-session') as typeof import('../lib/bridge-session');
    const ompDescriptor = present(getHarness('omp'));

    const initialLaunch = await sessionLaunch.launchNewSession({
      descriptor: ompDescriptor,
      cwd: tmpDir,
      target: { type: 'tmux', socket: tmuxSock, newTmuxSession: 'f1-test' },
    });
    assert.equal(initialLaunch.kind, 'ready', initialLaunch.kind === 'ready' ? '' : String(initialLaunch.error));
    const initialRouteId = initialLaunch.id;
    const initialSpawn = present(tmux.getSpawn(initialRouteId));
    const initialOwnerId = present(leases.ownerIdForSession(initialRouteId));
    invalidateRegistryCache();
    const initialNative = present(resolveSessionRoute(initialRouteId)).nativeSessionId;
    const initialReg = present(getRegisteredSessionByNativeId('omp', initialNative));
    const sessionFile = String(initialReg.sessionFile);

    // Confirm heartbeats are actively ticking before transfer.
    const hbInitial = broker.heartbeatCalls.length;
    await waitFor(() => broker.heartbeatCalls.length > hbInitial, 'initial lease sends periodic heartbeats');

    // Replacement process will ignore SIGHUP/SIGTERM and never register -> registration timeout + cleanup-incomplete!
    fs.writeFileSync(holdFlag, '1');
    fs.writeFileSync(trapFlag, '1');
    process.env.PI_DISH_SPAWN_TIMEOUT_MS = '250';

    const bindCountBefore = broker.bindCalls.length;
    const releaseCountBefore = broker.releaseCalls.length;
    const initialPaneRec = record(initialSpawn.paneProcess);
    const initialPaneProc = { pid: Number(initialPaneRec.pid), startTime: String(initialPaneRec.startTime) };
    const outcome = await sessionLaunch.spawnHarnessInTmux({
      descriptor: ompDescriptor,
      target: { socket: tmuxSock },
      args: ompDescriptor.argv.resume({ file: sessionFile }),
      cwd: tmpDir,
      name: 'F1 Cleanup Fail',
      restartPane: {
        sessionId: initialRouteId,
        paneId: initialSpawn.paneId,
        paneProcess: initialPaneProc,
        spawn: initialSpawn,
        registry: initialReg,
      },
      cuSlice2: true,
      cuBindTransfer: true,
    });
    if (outcome.kind === 'cleanup-incomplete') {
      for (const proc of outcome.cleanup.knownProcesses) survivingPids.push(proc.pid);
    }

    assert.equal(outcome.kind, 'cleanup-incomplete', `expected cleanup-incomplete, got ${outcome.kind}`);
    const replacementProc = present(outcome.cleanup.paneProcess ?? outcome.cleanup.knownProcesses[0]);
    assert.equal(processIdentityAlive(replacementProc), true, 'replacement process survived tmux cleanup failure');

    // Verify bind committed the replacement birth before registration failed.
    assert.equal(broker.bindCalls.length, bindCountBefore + 1, 'transfer bind committed before registration timeout');
    const committedBind = broker.bindCalls[broker.bindCalls.length - 1];
    assert.equal(committedBind.pid, replacementProc.pid);
    assert.equal(committedBind.pidStartTime, Number(replacementProc.startTime));

    // Verify abortSpawn released the REPLACEMENT birth via owner_match (zero force:true) even though replacement is still alive!
    assert.equal(broker.state, 'idle', 'committed replacement lease MUST be released even when cleanup fails');
    assert.equal(broker.releaseCalls.length, releaseCountBefore + 1);
    const rel = broker.releaseCalls[broker.releaseCalls.length - 1];
    assert.equal(rel.ownerId, initialOwnerId);
    assert.equal(rel.expectedPid, replacementProc.pid);
    assert.equal(rel.expectedPidStartTime, Number(replacementProc.startTime));
    assert.equal(rel.force, undefined);
    assert.equal(leases.ownerIdForSession(initialRouteId), null);

    // Verify heartbeats completely stopped!
    const hbAfterAbort = broker.heartbeatCalls.length;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(broker.heartbeatCalls.length, hbAfterAbort, 'heartbeats MUST stop after committed transfer abort');

    // Kill trapped replacement now so subsequent sub-tests stay completely clean.
    for (const pid of survivingPids.splice(0)) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    leases.stop();
    broker.enforceRealPids = false;
    broker.resetIdleForTest();
  }

  // Part B: Pre-commit vs post-commit displaced birth invariants:
  // - Before commit: if original birth is dead (even if another PID is alive), abortSpawn releases the lease.
  // - After commit to displaced reservation: abortSpawn cancels the displaced replacement birth via owner_match and leaves human untouched.
  {
    const alivePids = new Set<string>(['66001:660010', '66002:660020', '66003:660030', '66004:660040']);
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => path.join(tmpDir, 'f1-unit-leases.json'),
      processAlive: p => alivePids.has(`${p.pid}:${p.startTime}`),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    // B1: Pre-commit bind fails AFTER respawn killed original birth -> abortSpawn releases (never treats arbitrary live pid as surviving old pane).
    const sid1 = '~sk1_omp_f1_precommit_dead';
    const h1 = present(await mgr.prepareSpawn({ knownSessionId: sid1 }));
    await mgr.bindSpawnedProcess(h1, { pid: 66001, startTime: '660010' });
    mgr.attachSpawnedSession(h1, { sessionId: sid1, pid: 66001, pidStartTime: '660010' });
    const t1 = present(await mgr.prepareTransfer({ sessionId: sid1 }));
    alivePids.delete('66001:660010'); // original pane died during respawn
    broker.nextBindError = { status: 409, body: { ok: false, code: 'claim_mismatch', message: 'Injected pre-commit bind failure' } };
    await assert.rejects(() => mgr.bindSpawnedProcess(t1, { pid: 66002, startTime: '660020' }), /Injected pre-commit bind failure/);
    await mgr.abortSpawn(t1);
    assert.equal(broker.state, 'idle', 'pre-commit abort with dead original birth releases lease');
    const hbB1 = broker.heartbeatCalls.length;
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(broker.heartbeatCalls.length, hbB1, 'pre-commit release stops heartbeats');

    // B2: Post-commit on displaced reservation -> registration/cleanup fails -> abortSpawn cancels displaced replacement birth, human untouched!
    const sid2 = '~sk1_omp_f1_displaced_postcommit';
    const h2 = present(await mgr.prepareSpawn({ knownSessionId: sid2 }));
    await mgr.bindSpawnedProcess(h2, { pid: 66003, startTime: '660030' });
    mgr.attachSpawnedSession(h2, { sessionId: sid2, pid: 66003, pidStartTime: '660030' });
    const t2 = present(await mgr.prepareTransfer({ sessionId: sid2 }));
    await client.requestJson('POST', '/v1/lease/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(broker.state, 'human');
    // Bind commits replacement birth 66004 as 200 target:"displaced" (replacement 66004 stays alive!)
    await mgr.bindSpawnedProcess(t2, { pid: 66004, startTime: '660040' });
    assert.equal(broker.preempted?.pid, 66004);
    const cancelBefore = broker.cancelPreemptedCalls.length;
    await mgr.abortSpawn(t2);
    assert.equal(broker.cancelPreemptedCalls.length, cancelBefore + 1, 'post-commit displaced abort cancels replacement reservation');
    const cancelCall = broker.cancelPreemptedCalls[broker.cancelPreemptedCalls.length - 1];
    assert.equal(cancelCall.ownerId, h2.leaseOwnerId);
    assert.equal(cancelCall.expectedPid, 66004);
    assert.equal(cancelCall.expectedPidStartTime, 660040);
    assert.equal(broker.preempted, null, 'displaced replacement reservation cleared');
    assert.equal(broker.state, 'human', 'human lease untouched');

    assert.equal(broker.validationErrorCalls.length, 0);
    assert.equal(broker.forcedMutationCalls.length, 0);
  }
});

test('unit: F2 (B4) — claimed_peer_reaped and peer-gone status outside staged transfer mark access_lost, stop heartbeats, and release via owner_match', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-f2-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Case 1: Active holding session with periodic heartbeats receives claimed_peer_reaped ->
  // marks access_lost, stops heartbeats, and releases seat to idle via owner_match (zero force:true).
  {
    const sid = '~sk1_omp_f2_active_reaped';
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 67001 && p.startTime === '670010',
      pidAlive: p => p === 67091,
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h, { pid: 67001, startTime: '670010' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 67001, pidStartTime: '670010' });
    broker.simulateMcpClaim(67091);

    const hbBefore = broker.heartbeatCalls.length;
    await waitFor(() => broker.heartbeatCalls.length > hbBefore, 'active session sends heartbeats before peer reap');

    const relBefore = broker.releaseCalls.length;
    broker.simulateClaimedPeerReaped('active');
    mgr.handleBrokerEvent({
      eventName: 'lease_changed',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: { ...broker.snapshotPayload(), reason: 'claimed_peer_reaped', target: 'active' },
    });

    await waitFor(() => broker.state === 'idle', 'claimed_peer_reaped releases active seat via owner_match');
    assert.equal(mgr.isDesktopAccessLost(sid), true, 'marks access_lost');
    assert.equal(mgr.ownerIdForSession(sid), null, 'clears active ownerId');
    assert.equal(broker.releaseCalls.length, relBefore + 1);
    const rel = broker.releaseCalls[broker.releaseCalls.length - 1];
    assert.equal(rel.ownerId, h.leaseOwnerId);
    assert.equal(rel.sessionId, h.brokerSessionId);
    assert.equal(rel.expectedPid, 67001);
    assert.equal(rel.expectedPidStartTime, 670010);
    assert.equal(rel.sessionSecret, undefined, 'uses pure owner_match release');
    assert.equal(rel.force, undefined);

    const hbAfter = broker.heartbeatCalls.length;
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(broker.heartbeatCalls.length, hbAfter, 'heartbeats stopped after claimed_peer_reaped');
    mgr.stop();
  }

  // Case 2: Status/SSE snapshot (hello/resync) showing peer gone with no usable claim ->
  // marks access_lost, stops heartbeats, and frees seat via owner_match.
  {
    const sid = '~sk1_omp_f2_status_peer_gone';
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 67002 && p.startTime === '670020',
      pidAlive: () => false,
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h, { pid: 67002, startTime: '670020' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 67002, pidStartTime: '670020' });
    // Clear pending claim without any live claimed peer (e.g. missed claimed_peer_reaped across disconnect).
    broker.activeClaims.delete(h.brokerSessionId);
    broker.cursor += 1;

    mgr.handleBrokerEvent({
      eventName: 'hello',
      authoritativeHello: true,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: { ...broker.snapshotPayload(), capabilities: [...REQUIRED_SLICE2_CAPABILITIES, ...Object.values(SLICE2B_CAPABILITIES)] },
    });

    await waitFor(() => broker.state === 'idle', 'status snapshot with peer gone and no usable claim releases seat');
    assert.equal(mgr.isDesktopAccessLost(sid), true);
    const hbAfter = broker.heartbeatCalls.length;
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(broker.heartbeatCalls.length, hbAfter, 'heartbeats stopped after peer-gone status');
    mgr.stop();
  }

  // Case 3: Displaced lease receives claimed_peer_reaped -> marks access_lost and cancels displaced reservation via owner_match, human untouched!
  {
    const sid = '~sk1_omp_f2_displaced_reaped';
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 67003 && p.startTime === '670030',
      pidAlive: p => p === 67093,
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h, { pid: 67003, startTime: '670030' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 67003, pidStartTime: '670030' });
    broker.simulateMcpClaim(67093);
    await client.requestJson('POST', '/v1/lease/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(broker.state, 'human');
    assert.equal(broker.preempted?.ownerId, h.leaseOwnerId);

    const cancelBefore = broker.cancelPreemptedCalls.length;
    broker.simulateClaimedPeerReaped('preempted');
    mgr.handleBrokerEvent({
      eventName: 'lease_changed',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: { ...broker.snapshotPayload(), reason: 'claimed_peer_reaped', target: 'displaced' },
    });

    await waitFor(() => broker.preempted === null, 'displaced claimed_peer_reaped cancels reservation via owner_match');
    assert.equal(mgr.isDesktopAccessLost(sid), true);
    assert.equal(broker.state, 'human', 'human lease stays untouched');
    assert.equal(broker.cancelPreemptedCalls.length, cancelBefore + 1);
    assert.equal(broker.cancelPreemptedCalls[broker.cancelPreemptedCalls.length - 1].ownerId, h.leaseOwnerId);
    mgr.stop();
    broker.resetIdleForTest();
  }

  // Case 4: DURING a staged transfer, claimed_peer_reaped for the outgoing peer MUST NOT mark access_lost or release the lease!
  {
    const sid = '~sk1_omp_f2_during_staged';
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 67004 && p.startTime === '670040',
      pidAlive: () => false,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h, { pid: 67004, startTime: '670040' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 67004, pidStartTime: '670040' });
    broker.simulateMcpClaim(67094);

    const transferHandle = present(await mgr.prepareTransfer({ sessionId: sid }));
    const relBefore = broker.releaseCalls.length;
    broker.simulateClaimedPeerReaped('active');
    mgr.handleBrokerEvent({
      eventName: 'lease_changed',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: { ...broker.snapshotPayload(), reason: 'claimed_peer_reaped', target: 'active' },
    });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(mgr.isDesktopAccessLost(sid), false, 'staged transfer ignores outgoing claimed_peer_reaped');
    assert.equal(mgr.ownerIdForSession(sid), h.leaseOwnerId);
    assert.equal(broker.state, 'agent', 'lease stays active during staged transfer');
    assert.equal(broker.releaseCalls.length, relBefore, 'zero releases during staged transfer');
    await mgr.abortSpawn(transferHandle);
    mgr.stop();
    broker.resetIdleForTest();
  }

  assert.equal(broker.validationErrorCalls.length, 0);
  assert.equal(broker.forcedMutationCalls.length, 0);
});

test('unit: F3 — restart while CU lease is checking returns typed retryable 409 cu_checking and kills nothing', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-f3-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Persist a bound lease belonging to our current live process (so processAlive passes), then
  // create a fresh lease manager WITHOUT running reconcile() -> record is in 'checking' state!
  const selfProc = present(processIdentity(process.pid));
  const nativeId = '2026-11-26T00-00-00_f3checking01' as NativeSessionId;
  const routeId = routeSessionId('omp', nativeId);
  const sessionFile = path.join(tmpDir, `${nativeId}.jsonl`);
  fs.writeFileSync(sessionFile, `${JSON.stringify({ type: 'session', id: nativeId, cwd: tmpDir })}\n`);

  const first = createCuAgentLeases({
    broker: client,
    storeFile: () => storePath,
    processAlive: p => p.pid === selfProc.pid && p.startTime === selfProc.startTime,
    heartbeatIntervalMs: 0,
    livenessCheckMs: 0,
    abortSession: async () => true,
    resumeSession: async () => true,
  });
  const h = present(await first.prepareSpawn({ knownSessionId: routeId }));
  await first.bindSpawnedProcess(h, { pid: selfProc.pid, startTime: selfProc.startTime });
  first.stop();

  const checkingMgr = createCuAgentLeases({
    broker: client,
    storeFile: () => storePath,
    processAlive: p => p.pid === selfProc.pid && p.startTime === selfProc.startTime,
    findSessionIdByProcess: p => (p.pid === selfProc.pid && p.startTime === selfProc.startTime ? routeId : null),
    heartbeatIntervalMs: 0,
    livenessCheckMs: 0,
    abortSession: async () => true,
    resumeSession: async () => true,
  });
  t.after(() => checkingMgr.stop());

  assert.equal(checkingMgr.isDesktopChecking(routeId), true, 'precondition: persisted lease is checking before reconcile');
  assert.equal(checkingMgr.canTransferSession(routeId), false, 'checking lease is not yet transferable');

  let closeOrKillCalled = 0;
  let launchCalled = 0;
  const fakeReg = {
    protocolVersion: 2,
    harnessId: 'omp',
    nativeSessionId: nativeId,
    sessionId: nativeId,
    sessionFile,
    cwd: tmpDir,
    pid: selfProc.pid,
    startTime: selfProc.startTime,
    socketPath: path.join(tmpDir, 'fake.sock'),
    name: 'F3 Checking Session',
  };
  const fakePlacement = {
    sessionId: routeId,
    socket: path.join(tmpDir, 'no-tmux.sock'),
    paneId: '%99',
    paneProcess: selfProc,
  };

  const ops = createSessionOperations({
    ownership: {
      sessionSources: { resolve: () => ({ harnessId: 'omp', nativeSessionId: nativeId, file: sessionFile }) },
      liveSourceObservations: () => [],
      getRegisteredSession: () => fakeReg,
      getRPCSession: () => null,
      getLiveSession: async () => null,
      liveSubsessionCandidates: () => [],
      capturePaneRestart: async () => ({
        kind: 'pane-restart',
        sessionId: routeId,
        placement: fakePlacement,
        registry: fakeReg,
      }),
      preparePaneRestart: async () => ({ registry: fakeReg }),
      revalidatePaneRestart: (_cap: unknown, proved: { registry: unknown }) => proved.registry,
      captureOwnedPaneClose: async () => {
        closeOrKillCalled += 1;
        throw new Error('captureOwnedPaneClose MUST NOT be called while CU lease is checking');
      },
      revalidateOwnedPaneClose: () => {},
    } as unknown as SessionOperationsMod.SessionOperationObservations['ownership'],
    launch: {
      spawnHarnessInTmux: async () => { launchCalled += 1; throw new Error('spawnHarnessInTmux MUST NOT run while checking'); },
      launchResumedSession: async () => { launchCalled += 1; throw new Error('launchResumedSession MUST NOT run while checking'); },
      launchNewSession: async () => { launchCalled += 1; throw new Error('launchNewSession MUST NOT run while checking'); },
    } as unknown as SessionLaunchMod.SessionLaunch,
    getActiveSessions: () => [],
    readSessionCwd: () => tmpDir,
    recordLaunchProvenance: () => {},
    onSessionStopped: () => { closeOrKillCalled += 1; },
    cuCheckCapabilities: () => checkingMgr.probeCapabilities(),
    cuCanTransferSession: id => checkingMgr.canTransferSession(id),
    cuIsChecking: id => checkingMgr.isDesktopChecking(id),
  });

  const relBefore = broker.releaseCalls.length;
  const acqBefore = broker.acquireCalls.length;
  const claimBefore = broker.claimNonceCalls.length;
  const bindBefore = broker.bindCalls.length;

  const outcome = await ops.restartSession(routeId);
  assert.equal(outcome.kind, 'no-action');
  assert.equal(outcome.status, 409);
  assert.ok(outcome.cause instanceof CuLeaseCheckingError);

  const response = await ops.restartSessionById(routeId);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'cu_checking');
  assert.equal(response.body.retryable, true);
  assert.equal(closeOrKillCalled, 0, 'checking restart refusal MUST kill nothing');
  assert.equal(launchCalled, 0, 'checking restart refusal MUST launch nothing');
  assert.equal(broker.state, 'agent', 'broker lease untouched');
  assert.equal(broker.releaseCalls.length, relBefore);
  assert.equal(broker.acquireCalls.length, acqBefore);
  assert.equal(broker.claimNonceCalls.length, claimBefore);
  assert.equal(broker.bindCalls.length, bindBefore);
});

test('unit: G1 — ambiguous bind (503 applied:"unknown" after commit or pre-commit) stops heartbeats, releases via owner_match (replacement -> original -> no-pid, zero force:true), and keeps access_lost record until confirmed', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-g1-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Case 1 (required): Real tmux + SessionLaunch — bind commits replacement birth then returns
  // 503 applied:"unknown" -> launch fails -> heartbeats stop and broker ends with no lease for us!
  {
    const tmuxDir = tmux.tmuxTmpdir();
    fs.mkdirSync(tmuxDir, { recursive: true, mode: 0o700 });
    const tmuxSock = path.join(tmuxDir, `g1-ambig-bind-${process.pid}-${Date.now()}`);
    const fakeOmp = path.join(tmpDir, 'fake-omp-g1.js');
    writeFakeOmpScript(fakeOmp, require.resolve('../lib/process-identity'), {
      envDir: path.join(tmpDir, 'env'),
      cmdDir: path.join(tmpDir, 'cmd'),
      holdRegisterFlag: path.join(tmpDir, 'no-hold'),
    });
    const prevOmpCmd = process.env.PI_DISH_OMP_COMMAND;
    process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${fakeOmp}`;
    t.after(() => {
      if (prevOmpCmd === undefined) delete process.env.PI_DISH_OMP_COMMAND;
      else process.env.PI_DISH_OMP_COMMAND = prevOmpCmd;
      try { execFileSync('tmux', ['-S', tmuxSock, 'kill-server'], { stdio: 'ignore', timeout: 10_000 }); } catch {}
    });

    broker.enforceRealPids = true;
    const leases = createCuAgentLeases({
      broker: client,
      storeFile: () => path.join(tmpDir, 'g1-real-leases.json'),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 50,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => leases.stop());

    const sessionLaunch = createSessionLaunch({
      runHarnessModelCommand: async () => [],
      cuLeases: leases,
    });
    const { getHarness } = require('../lib/harnesses') as typeof import('../lib/harnesses');
    const { getRegisteredSessionByNativeId, invalidateRegistryCache } = require('../lib/bridge-session') as typeof import('../lib/bridge-session');
    const ompDescriptor = present(getHarness('omp'));

    const initialLaunch = await sessionLaunch.launchNewSession({
      descriptor: ompDescriptor,
      cwd: tmpDir,
      target: { type: 'tmux', socket: tmuxSock, newTmuxSession: 'g1-test' },
    });
    assert.equal(initialLaunch.kind, 'ready', initialLaunch.kind === 'ready' ? '' : String(initialLaunch.error));
    const initialRouteId = initialLaunch.id;
    const initialSpawn = present(tmux.getSpawn(initialRouteId));
    const initialOwnerId = present(leases.ownerIdForSession(initialRouteId));
    invalidateRegistryCache();
    const initialNative = present(resolveSessionRoute(initialRouteId)).nativeSessionId;
    const initialReg = present(getRegisteredSessionByNativeId('omp', initialNative));
    const sessionFile = String(initialReg.sessionFile);
    const initialPaneRec = record(initialSpawn.paneProcess);
    const initialPaneProc = { pid: Number(initialPaneRec.pid), startTime: String(initialPaneRec.startTime) };

    const hbBefore = broker.heartbeatCalls.length;
    await waitFor(() => broker.heartbeatCalls.length > hbBefore, 'initial lease sends heartbeats before transfer');

    // Broker commits the bind to the replacement birth, then answers 503 applied:"unknown"!
    broker.nextBindError = {
      status: 503,
      commitBeforeError: true,
      body: { ok: false, code: 'broker_busy', applied: 'unknown', message: 'Bind commit grace elapsed; outcome unknown' },
    };
    const relBefore = broker.releaseCalls.length;
    const outcome = await sessionLaunch.spawnHarnessInTmux({
      descriptor: ompDescriptor,
      target: { socket: tmuxSock },
      args: ompDescriptor.argv.resume({ file: sessionFile }),
      cwd: tmpDir,
      name: 'G1 Ambiguous Bind',
      restartPane: {
        sessionId: initialRouteId,
        paneId: initialSpawn.paneId,
        paneProcess: initialPaneProc,
        spawn: initialSpawn,
        registry: initialReg,
      },
      cuSlice2: true,
      cuBindTransfer: true,
    });

    assert.notEqual(outcome.kind, 'ready', 'ambiguous 503 applied:"unknown" bind fails launch');
    assert.equal(broker.state, 'idle', 'broker ends with no lease for us after ambiguous committed bind');
    assert.equal(broker.lease, null);
    assert.equal(broker.preempted, null);
    assert.ok(broker.releaseCalls.length > relBefore, 'owner_match release sent for committed replacement birth');
    const lastBind = broker.bindCalls[broker.bindCalls.length - 1];
    const rel = broker.releaseCalls[broker.releaseCalls.length - 1];
    assert.equal(rel.ownerId, initialOwnerId);
    assert.equal(rel.expectedPid, lastBind.pid, 'tried attempted replacement birth first');
    assert.equal(rel.expectedPidStartTime, lastBind.pidStartTime);
    assert.equal(rel.sessionSecret, undefined, 'pure owner_match release');
    assert.equal(rel.force, undefined, 'never sends force:true');
    assert.equal(leases.ownerIdForSession(initialRouteId), null);

    const hbAfter = broker.heartbeatCalls.length;
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(broker.heartbeatCalls.length, hbAfter, 'heartbeats stop completely after ambiguous bind abort');

    leases.stop();
    broker.enforceRealPids = false;
    broker.resetIdleForTest();
  }

  // Case 2: Fallback order (replacement -> original -> no-pid) and unconfirmed-release retention (keep access_lost).
  {
    const storePath = path.join(tmpDir, 'g1-fallback-leases.json');
    const alivePids = new Set<string>(['68001:680010', '68002:680020', '68003:680030', '68004:680040', '68005:680050', '68006:680060']);
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => alivePids.has(`${p.pid}:${p.startTime}`),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    // 2a. Bind returns 503 applied:"unknown" WITHOUT committing (broker still holds original birth 68001):
    //     abortSpawn tries 68002 (409 pid_mismatch) -> falls back to 68001 -> released to idle!
    const sidA = '~sk1_omp_g1_fallback_orig';
    const hA = present(await mgr.prepareSpawn({ knownSessionId: sidA }));
    await mgr.bindSpawnedProcess(hA, { pid: 68001, startTime: '680010' });
    mgr.attachSpawnedSession(hA, { sessionId: sidA, pid: 68001, pidStartTime: '680010' });
    const tA = present(await mgr.prepareTransfer({ sessionId: sidA }));
    broker.nextBindError = {
      status: 503,
      commitBeforeError: false,
      body: { ok: false, code: 'broker_busy', applied: 'unknown', message: 'Outcome unknown (did not commit)' },
    };
    await assert.rejects(() => mgr.bindSpawnedProcess(tA, { pid: 68002, startTime: '680020' }));
    const relBeforeA = broker.releaseCalls.length;
    await mgr.abortSpawn(tA);
    assert.equal(broker.state, 'idle', 'fell back from replacement birth to original birth and released');
    const callsA = broker.releaseCalls.slice(relBeforeA);
    assert.equal(callsA.length, 2);
    assert.equal(callsA[0].expectedPid, 68002, '1st attempt used attempted replacement birth');
    assert.equal(callsA[1].expectedPid, 68001, '2nd attempt fell back to original birth');

    // 2b. Broker holds a third birth (68099) for our exact (ownerId, sessionId):
    //     abortSpawn tries replacement (pid_mismatch) -> original (pid_mismatch) -> no expectedPid -> released!
    const sidB = '~sk1_omp_g1_fallback_nopid';
    const hB = present(await mgr.prepareSpawn({ knownSessionId: sidB }));
    await mgr.bindSpawnedProcess(hB, { pid: 68003, startTime: '680030' });
    mgr.attachSpawnedSession(hB, { sessionId: sidB, pid: 68003, pidStartTime: '680030' });
    const tB = present(await mgr.prepareTransfer({ sessionId: sidB }));
    broker.nextBindError = {
      status: 503,
      commitBeforeError: false,
      body: { ok: false, code: 'broker_busy', applied: 'unknown', message: 'Outcome unknown' },
    };
    await assert.rejects(() => mgr.bindSpawnedProcess(tB, { pid: 68004, startTime: '680040' }));
    // Mutate broker birth so both replacement (68004) and original (68003) get 409 pid_mismatch.
    const leaseB = present(broker.lease as FakeBrokerLease | null);
    leaseB.pid = 68099;
    leaseB.pidStartTime = 680990;
    const relBeforeB = broker.releaseCalls.length;
    await mgr.abortSpawn(tB);
    assert.equal(broker.state, 'idle', 'fell back to ownerId+sessionId without expectedPid and released');
    const callsB = broker.releaseCalls.slice(relBeforeB);
    assert.equal(callsB.length, 3);
    assert.equal(callsB[0].expectedPid, 68004);
    assert.equal(callsB[1].expectedPid, 68003);
    assert.equal(callsB[2].expectedPid, undefined, '3rd attempt omitted expectedPid while keeping ownerId+sessionId+expectedState');
    assert.equal(callsB[2].ownerId, hB.leaseOwnerId);
    assert.equal(callsB[2].sessionId, hB.brokerSessionId);

    // 2c. Release itself fails unconfirmed (503 broker_shutting_down) -> record MUST be kept marked access_lost
    //     (not dropped early!), heartbeats stopped, and later releaseSession finishes releasing!
    const sidC = '~sk1_omp_g1_keep_until_confirmed';
    const hC = present(await mgr.prepareSpawn({ knownSessionId: sidC }));
    await mgr.bindSpawnedProcess(hC, { pid: 68005, startTime: '680050' });
    mgr.attachSpawnedSession(hC, { sessionId: sidC, pid: 68005, pidStartTime: '680050' });
    const tC = present(await mgr.prepareTransfer({ sessionId: sidC }));
    broker.nextBindError = {
      status: 503,
      commitBeforeError: true,
      body: { ok: false, code: 'broker_busy', applied: 'unknown', message: 'Ambiguous commit' },
    };
    await assert.rejects(() => mgr.bindSpawnedProcess(tC, { pid: 68006, startTime: '680060' }));
    broker.nextReleaseError = {
      status: 503,
      body: { ok: false, code: 'broker_shutting_down', message: 'Broker restarting' },
    };
    await mgr.abortSpawn(tC);
    assert.equal(broker.state, 'agent', 'release was unconfirmed while broker was shutting down');
    assert.equal(mgr.isDesktopAccessLost(sidC), true, 'unconfirmed release keeps record marked access_lost');
    assert.equal(mgr.ownerIdForSession(sidC), null);
    const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8')) as { leases: Array<{ leaseOwnerId: string }> };
    assert.equal(
      persisted.leases.some(r => r.leaseOwnerId === hC.leaseOwnerId),
      true,
      'persisted store retains tracking until release is confirmed',
    );
    const hbC = broker.heartbeatCalls.length;
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(broker.heartbeatCalls.length, hbC, 'heartbeats stay stopped while release is unconfirmed');

    // Once broker recovers, releaseSession completes cleanup and drops the record.
    await mgr.releaseSession(sidC);
    assert.equal(broker.state, 'idle', 'follow-up release confirmed once broker recovered');
    assert.equal(mgr.isDesktopAccessLost(sidC), false, 'record removed once release confirmed');

    assert.equal(broker.validationErrorCalls.length, 0);
    assert.equal(broker.forcedMutationCalls.length, 0);
  }
});

test('unit: G2 — with SSE down, peer-gone heartbeat reply and peer-gone /v1/status reply mark access_lost, stop heartbeats, and release via owner_match', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-g2-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  // Keep SSE completely unavailable throughout this test (no /v1/events stream!).
  broker.eventsErrorStatus = 503;
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Case 1 (required): With SSE down, a peer-gone heartbeat reply -> access_lost, heartbeats stop, owner_match release!
  {
    const sid = '~sk1_omp_g2_heartbeat_peer_gone';
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 69001 && p.startTime === '690010',
      pidAlive: () => false,
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h, { pid: 69001, startTime: '690010' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 69001, pidStartTime: '690010' });

    // Confirm normal heartbeats run while pending claim exists.
    const hbInitial = broker.heartbeatCalls.length;
    await waitFor(() => broker.heartbeatCalls.length > hbInitial, 'heartbeats run while claim is pending');
    assert.equal(broker.state, 'agent');
    assert.equal(mgr.isDesktopAccessLost(sid), false);
    assert.equal(broker.sseClients.size, 0, 'precondition: SSE is down');

    // Peer dies / claim disappears on broker with NO SSE delivered!
    broker.activeClaims.delete(h.brokerSessionId);
    assert.ok(broker.lease);
    broker.lease.mcpClaimed = false;
    broker.lease.claimedPid = null;
    broker.cursor += 1;

    const relBefore = broker.releaseCalls.length;
    await waitFor(() => broker.state === 'idle', 'peer-gone heartbeat reply triggers owner_match release with SSE down');
    assert.equal(mgr.isDesktopAccessLost(sid), true, 'marks access_lost on peer-gone heartbeat reply');
    assert.equal(mgr.ownerIdForSession(sid), null);
    assert.equal(broker.releaseCalls.length, relBefore + 1);
    const rel = broker.releaseCalls[broker.releaseCalls.length - 1];
    assert.equal(rel.ownerId, h.leaseOwnerId);
    assert.equal(rel.sessionId, h.brokerSessionId);
    assert.equal(rel.expectedPid, 69001);
    assert.equal(rel.expectedPidStartTime, 690010);
    assert.equal(rel.sessionSecret, undefined);
    assert.equal(rel.force, undefined);

    const hbAfter = broker.heartbeatCalls.length;
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(broker.heartbeatCalls.length, hbAfter, 'heartbeats stopped immediately after peer-gone heartbeat reply');
    mgr.stop();
  }

  // Case 2: With SSE down, a peer-gone /v1/status reply (probeCapabilities) -> access_lost, heartbeats stop, owner_match release!
  {
    const sid = '~sk1_omp_g2_status_peer_gone';
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 69002 && p.startTime === '690020',
      pidAlive: () => false,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h, { pid: 69002, startTime: '690020' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 69002, pidStartTime: '690020' });

    broker.activeClaims.delete(h.brokerSessionId);
    assert.ok(broker.lease);
    broker.lease.mcpClaimed = false;
    broker.lease.claimedPid = null;
    broker.cursor += 1;

    const relBefore = broker.releaseCalls.length;
    await mgr.probeCapabilities();
    assert.equal(broker.state, 'idle', 'peer-gone /v1/status reply releases seat via owner_match');
    assert.equal(mgr.isDesktopAccessLost(sid), true);
    assert.equal(broker.releaseCalls.length, relBefore + 1);
    assert.equal(broker.releaseCalls[broker.releaseCalls.length - 1].ownerId, h.leaseOwnerId);
    mgr.stop();
  }

  // Case 3: Staged-transfer guard still protects an active transfer during /v1/status!
  {
    const sid = '~sk1_omp_g2_status_staged_guard';
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 69003 && p.startTime === '690030',
      pidAlive: () => false,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h, { pid: 69003, startTime: '690030' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 69003, pidStartTime: '690030' });
    const tHandle = present(await mgr.prepareTransfer({ sessionId: sid }));

    broker.activeClaims.delete(h.brokerSessionId);
    assert.ok(broker.lease);
    broker.lease.mcpClaimed = false;
    broker.cursor += 1;

    await mgr.probeCapabilities();
    assert.equal(broker.state, 'agent', 'staged transfer protects lease during /v1/status');
    assert.equal(mgr.isDesktopAccessLost(sid), false);
    await mgr.abortSpawn(tHandle);
    mgr.stop();
    broker.resetIdleForTest();
  }

  assert.equal(broker.validationErrorCalls.length, 0);
  assert.equal(broker.forcedMutationCalls.length, 0);
});

test('unit: G3 — allowReclaim never counts as a usable claim; claim expiring before redemption with allowReclaim:true triggers access_lost and owner_match release', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-g3-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const storePath = path.join(tmpDir, 'cu-agent-leases.json');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const client = createCuBrokerClient({ socketPath: () => sockPath });

  // Case 1 (required): First claim expires before redemption with allowReclaim:true -> access_lost, heartbeats stop, owner_match release!
  {
    const sid = '~sk1_omp_g3_expire_allow_reclaim';
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 70001 && p.startTime === '700010',
      pidAlive: () => false,
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h, { pid: 70001, startTime: '700010' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 70001, pidStartTime: '700010' });
    // Broker lease has allowReclaim: true, and MCP never redeemed the first claim!
    broker.setAllowReclaim(true, 'active');

    const hbBefore = broker.heartbeatCalls.length;
    await waitFor(() => broker.heartbeatCalls.length > hbBefore, 'heartbeats run before first claim expires');

    const relBefore = broker.releaseCalls.length;
    broker.simulateClaimExpired('active');
    mgr.handleBrokerEvent({
      eventName: 'lease_changed',
      authoritativeHello: false,
      generation: broker.generation,
      cursor: broker.cursor,
      payload: { ...broker.snapshotPayload(), reason: 'claim_expired', target: 'active' },
    });

    await waitFor(() => broker.state === 'idle', 'claim_expired with allowReclaim:true releases seat via owner_match');
    assert.equal(mgr.isDesktopAccessLost(sid), true, 'allowReclaim:true never masks expired claim');
    assert.equal(mgr.ownerIdForSession(sid), null);
    assert.equal(broker.releaseCalls.length, relBefore + 1);
    const rel = broker.releaseCalls[broker.releaseCalls.length - 1];
    assert.equal(rel.ownerId, h.leaseOwnerId);
    assert.equal(rel.sessionId, h.brokerSessionId);
    assert.equal(rel.sessionSecret, undefined);
    assert.equal(rel.force, undefined);

    const hbAfter = broker.heartbeatCalls.length;
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(broker.heartbeatCalls.length, hbAfter, 'heartbeats stopped after claim_expired release');
    mgr.stop();
  }

  // Case 2: Status snapshot with allowReclaim:true and no pending claim / no live peer -> releases via owner_match!
  {
    const sid = '~sk1_omp_g3_status_allow_reclaim';
    const mgr = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 70002 && p.startTime === '700020',
      pidAlive: () => false,
      heartbeatIntervalMs: 0,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await mgr.bindSpawnedProcess(h, { pid: 70002, startTime: '700020' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 70002, pidStartTime: '700020' });
    broker.setAllowReclaim(true, 'active');
    broker.activeClaims.delete(h.brokerSessionId);
    broker.cursor += 1;

    await mgr.probeCapabilities();
    assert.equal(broker.state, 'idle', 'status snapshot with allowReclaim:true and no claim/peer releases seat');
    assert.equal(mgr.isDesktopAccessLost(sid), true);
    mgr.stop();
  }

  // Case 3: Startup reconcile when /v1/lease/renew returns claim.status === 'reclaimable' -> fails closed, marks access_lost, releases!
  {
    const sid = '~sk1_omp_g3_renew_reclaimable';
    const first = createCuAgentLeases({
      broker: client, storeFile: () => storePath, processAlive: () => true,
      heartbeatIntervalMs: 0, livenessCheckMs: 0, abortSession: async () => true, resumeSession: async () => true,
    });
    const h = present(await first.prepareSpawn({ knownSessionId: sid }));
    await first.bindSpawnedProcess(h, { pid: 70003, startTime: '700030' });
    broker.setAllowReclaim(true, 'active');
    broker.activeClaims.delete(h.brokerSessionId);
    first.stop();

    const aborts: CuAgentLeasesMod.CuCommandTarget[] = [];
    const restarted = createCuAgentLeases({
      broker: client,
      storeFile: () => storePath,
      processAlive: p => p.pid === 70003 && p.startTime === '700030',
      findSessionIdByProcess: p => (p.pid === 70003 && p.startTime === '700030' ? sid : null),
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async target => { aborts.push(target); return true; },
      resumeSession: async () => true,
    });
    const hbBefore = broker.heartbeatCalls.length;
    await restarted.reconcile();
    assert.equal(restarted.isDesktopAccessLost(sid), true, 'renew claim.status=reclaimable marks access_lost');
    assert.equal(broker.state, 'idle', 'renew claim.status=reclaimable releases seat via owner_match');
    await waitFor(() => aborts.length === 1, 'renew claim.status=reclaimable aborts session');
    await new Promise(resolve => setTimeout(resolve, 75));
    assert.equal(broker.heartbeatCalls.length, hbBefore, 'starts zero heartbeats');
    restarted.stop();
  }

  assert.equal(broker.validationErrorCalls.length, 0);
  assert.equal(broker.forcedMutationCalls.length, 0);
});

test('unit: G4 — pre-bind heartbeat resolving during in-flight initial bind does not release lease, while real PID mismatch or lost claim still releases', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-g4-'));
  const sockPath = path.join(tmpDir, 'broker.sock');
  const claimDir = path.join(tmpDir, 'claims');
  const broker = await startFakeCuBroker(sockPath, claimDir);
  broker.enableSlice2b();
  t.after(async () => {
    await broker.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseClient = createCuBrokerClient({ socketPath: () => sockPath });

  // Case 1: Hold POST /v1/lease/bind reply while a stale pre-bind heartbeat reply (pid:null, pendingClaim:true,
  // pre-bind cursor) resolves first. Initial bind MUST succeed, lease MUST stay active, and heartbeats MUST continue.
  {
    const caseStorePath = path.join(tmpDir, 'cu-agent-leases-case1.json');
    let holdPreBindHb = true;
    let capturedPreBindHb = false;
    let releasePreBindHb: (() => void) | null = null;
    let preBindHbReturned = false;
    let holdSubsequentHbs = false;
    const subsequentHbReleases: Array<() => void> = [];
    let holdBind = false;
    let bindReachedBroker = false;
    let releaseBind: (() => void) | null = null;

    const controlledClient: CuBrokerMod.CuBrokerClient = {
      socketPath: () => baseClient.socketPath(),
      configured: () => baseClient.configured(),
      available: () => baseClient.available(),
      openEvents: (...args) => baseClient.openEvents(...args),
      async requestJson(method, pathname, body) {
        if (pathname === '/v1/lease/heartbeat' && holdPreBindHb) {
          holdPreBindHb = false;
          holdSubsequentHbs = true;
          // Execute heartbeat against broker BEFORE bind so the snapshot genuinely predates bind (pid:null, pendingClaim:true).
          const reply = await baseClient.requestJson(method, pathname, body);
          const replyBody = record(reply.body);
          const replyLease = record(replyBody.lease);
          assert.equal(reply.status, 200);
          assert.equal(replyLease.pid, null, 'precondition: heartbeat snapshot predates bind (pid is null)');
          assert.equal(replyLease.pendingClaim, true, 'precondition: pre-bind snapshot has pendingClaim:true');
          capturedPreBindHb = true;
          await new Promise<void>(resolve => { releasePreBindHb = resolve; });
          preBindHbReturned = true;
          return reply;
        }
        if (pathname === '/v1/lease/heartbeat' && holdSubsequentHbs) {
          await new Promise<void>(resolve => { subsequentHbReleases.push(resolve); });
          return baseClient.requestJson(method, pathname, body);
        }
        if (pathname === '/v1/lease/bind' && holdBind) {
          holdBind = false;
          // Execute bind on the broker, then hold the bind reply so the stale pre-bind heartbeat resolves first.
          const reply = await baseClient.requestJson(method, pathname, body);
          bindReachedBroker = true;
          await new Promise<void>(resolve => { releaseBind = resolve; });
          return reply;
        }
        return baseClient.requestJson(method, pathname, body);
      },
    };

    const sid = '~sk1_omp_g4_prebind_hb_race';
    const mgr = createCuAgentLeases({
      broker: controlledClient,
      storeFile: () => caseStorePath,
      processAlive: p => p.pid === 71001 && p.startTime === '710010',
      pidAlive: () => false,
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await waitFor(() => capturedPreBindHb && releasePreBindHb !== null, 'pre-bind heartbeat captured before bind');

    const relBefore = broker.releaseCalls.length;
    holdBind = true;
    const bindPromise = mgr.bindSpawnedProcess(h, { pid: 71001, startTime: '710010' });
    await waitFor(() => bindReachedBroker && releaseBind !== null, 'initial bind held in flight');

    // Let the stale pre-bind heartbeat reply resolve while initial bind is still in flight.
    releasePreBindHb!();
    await waitFor(() => preBindHbReturned, 'stale pre-bind heartbeat reply delivered');
    // Allow sendHeartbeat's continuation (and any erroneous release call) to run before finishing bind.
    await new Promise(resolve => setTimeout(resolve, 40));

    holdSubsequentHbs = false;
    while (subsequentHbReleases.length) subsequentHbReleases.shift()!();
    releaseBind!();
    await bindPromise;
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 71001, pidStartTime: '710010' });

    assert.equal(broker.releaseCalls.length, relBefore, 'pre-bind heartbeat during initial bind must NOT release lease');
    assert.equal(broker.state, 'agent', 'broker lease remains active after initial bind');
    assert.equal(broker.lease?.pid, 71001);
    assert.equal(mgr.isDesktopAccessLost(sid), false, 'lease is NOT marked access_lost');
    assert.equal(mgr.ownerIdForSession(sid), h.leaseOwnerId, 'session still owns lease');

    const hbAfterBind = broker.heartbeatCalls.length;
    await waitFor(() => broker.heartbeatCalls.length > hbAfterBind, 'lease continues sending heartbeats after bind');
    assert.equal(broker.state, 'agent');
    assert.equal(mgr.isDesktopAccessLost(sid), false);
    assert.equal(broker.releaseCalls.length, relBefore);

    await mgr.releaseSession(sid);
    assert.equal(broker.state, 'idle');
    mgr.stop();
  }

  // Case 1b: A pre-bind heartbeat reply (pid:null, pendingClaim:true, pre-bind cursor) arriving AFTER the bind reply
  // completes is dropped as stale by cursor ordering; lease stays active and heartbeats continue.
  {
    const caseStorePath = path.join(tmpDir, 'cu-agent-leases-case1b.json');
    let holdPreBindHb = true;
    let capturedPreBindHb = false;
    let releasePreBindHb: (() => void) | null = null;
    let preBindHbReturned = false;
    let holdSubsequentHbs = false;
    const subsequentHbReleases: Array<() => void> = [];

    const controlledClient: CuBrokerMod.CuBrokerClient = {
      socketPath: () => baseClient.socketPath(),
      configured: () => baseClient.configured(),
      available: () => baseClient.available(),
      openEvents: (...args) => baseClient.openEvents(...args),
      async requestJson(method, pathname, body) {
        if (pathname === '/v1/lease/heartbeat' && holdPreBindHb) {
          holdPreBindHb = false;
          holdSubsequentHbs = true;
          const reply = await baseClient.requestJson(method, pathname, body);
          const replyBody = record(reply.body);
          const replyLease = record(replyBody.lease);
          assert.equal(reply.status, 200);
          assert.equal(replyLease.pid, null, 'precondition: delayed heartbeat snapshot predates bind');
          assert.equal(replyLease.pendingClaim, true);
          capturedPreBindHb = true;
          await new Promise<void>(resolve => { releasePreBindHb = resolve; });
          preBindHbReturned = true;
          return reply;
        }
        if (pathname === '/v1/lease/heartbeat' && holdSubsequentHbs) {
          await new Promise<void>(resolve => { subsequentHbReleases.push(resolve); });
          return baseClient.requestJson(method, pathname, body);
        }
        return baseClient.requestJson(method, pathname, body);
      },
    };

    const sid = '~sk1_omp_g4_prebind_hb_after_bind';
    const mgr = createCuAgentLeases({
      broker: controlledClient,
      storeFile: () => caseStorePath,
      processAlive: p => p.pid === 71005 && p.startTime === '710050',
      pidAlive: () => false,
      heartbeatIntervalMs: 25,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await waitFor(() => capturedPreBindHb && releasePreBindHb !== null, 'pre-bind heartbeat captured before bind');

    const relBefore = broker.releaseCalls.length;
    await mgr.bindSpawnedProcess(h, { pid: 71005, startTime: '710050' });
    mgr.attachSpawnedSession(h, { sessionId: sid, pid: 71005, pidStartTime: '710050' });

    // Deliver the stale pre-bind heartbeat reply AFTER initial bind has already completed.
    releasePreBindHb!();
    await waitFor(() => preBindHbReturned, 'delayed pre-bind heartbeat reply delivered after bind');
    await new Promise(resolve => setTimeout(resolve, 40));

    holdSubsequentHbs = false;
    while (subsequentHbReleases.length) subsequentHbReleases.shift()!();

    assert.equal(broker.releaseCalls.length, relBefore, 'stale pre-bind heartbeat arriving after bind must be dropped without releasing');
    assert.equal(broker.state, 'agent', 'broker lease remains active after stale pre-bind heartbeat');
    assert.equal(broker.lease?.pid, 71005);
    assert.equal(mgr.isDesktopAccessLost(sid), false);
    assert.equal(mgr.ownerIdForSession(sid), h.leaseOwnerId);

    const hbAfter = broker.heartbeatCalls.length;
    await waitFor(() => broker.heartbeatCalls.length > hbAfter, 'lease continues sending heartbeats after stale reply dropped');
    assert.equal(broker.state, 'agent');
    assert.equal(mgr.isDesktopAccessLost(sid), false);
    assert.equal(broker.releaseCalls.length, relBefore);

    await mgr.releaseSession(sid);
    assert.equal(broker.state, 'idle');
    mgr.stop();
  }

  // Case 2a: While initial bind is in flight, a heartbeat reporting a genuinely DIFFERENT non-null PID still releases.
  {
    const caseStorePath = path.join(tmpDir, 'cu-agent-leases-case2a.json');
    let holdWrongPidHb = true;
    let capturedWrongPidHb = false;
    let releaseWrongPidHb: (() => void) | null = null;
    let holdSubsequentHbs = false;
    const subsequentHbReleases: Array<() => void> = [];
    let holdBind = false;
    let bindHeld = false;
    let releaseBind: (() => void) | null = null;

    const controlledClient: CuBrokerMod.CuBrokerClient = {
      socketPath: () => baseClient.socketPath(),
      configured: () => baseClient.configured(),
      available: () => baseClient.available(),
      openEvents: (...args) => baseClient.openEvents(...args),
      async requestJson(method, pathname, body) {
        if (pathname === '/v1/lease/heartbeat' && holdWrongPidHb) {
          holdWrongPidHb = false;
          holdSubsequentHbs = true;
          const reply = await baseClient.requestJson(method, pathname, body);
          const replyBody = record(reply.body);
          const replyLease = record(replyBody.lease);
          // Mutate snapshot to report a genuinely different non-null PID.
          const forged = {
            ...replyBody,
            lease: { ...replyLease, pid: 71999, pidStartTime: 719990, pendingClaim: true },
          };
          capturedWrongPidHb = true;
          await new Promise<void>(resolve => { releaseWrongPidHb = resolve; });
          return { status: reply.status, body: forged };
        }
        if (pathname === '/v1/lease/heartbeat' && holdSubsequentHbs) {
          await new Promise<void>(resolve => { subsequentHbReleases.push(resolve); });
          return baseClient.requestJson(method, pathname, body);
        }
        if (pathname === '/v1/lease/bind' && holdBind) {
          holdBind = false;
          bindHeld = true;
          await new Promise<void>(resolve => { releaseBind = resolve; });
          return baseClient.requestJson(method, pathname, body);
        }
        return baseClient.requestJson(method, pathname, body);
      },
    };

    const sid = '~sk1_omp_g4_different_pid_inflight';
    const mgr = createCuAgentLeases({
      broker: controlledClient,
      storeFile: () => caseStorePath,
      processAlive: p => p.pid === 71002 && p.startTime === '710020',
      pidAlive: () => false,
      heartbeatIntervalMs: 20,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    const h = present(await mgr.prepareSpawn({ knownSessionId: sid }));
    await waitFor(() => capturedWrongPidHb && releaseWrongPidHb !== null, 'forged different-pid heartbeat captured');

    const relBefore = broker.releaseCalls.length;
    holdBind = true;
    const bindPromise = mgr.bindSpawnedProcess(h, { pid: 71002, startTime: '710020' });
    await waitFor(() => bindHeld && releaseBind !== null, 'bind held for different-pid test');

    releaseWrongPidHb!();
    await waitFor(() => broker.state === 'idle', 'genuinely different non-null PID during initial bind still releases lease');
    assert.ok(broker.releaseCalls.length > relBefore);
    assert.equal(mgr.isDesktopAccessLost(sid), true);

    holdSubsequentHbs = false;
    while (subsequentHbReleases.length) subsequentHbReleases.shift()!();
    releaseBind!();
    await assert.rejects(() => bindPromise);
    mgr.stop();
  }

  // Case 2b: After initial bind completes, a different PID or a lost claim still marks access_lost and releases.
  {
    const caseStorePath = path.join(tmpDir, 'cu-agent-leases-case2b.json');
    const sidDiff = '~sk1_omp_g4_postbind_different_pid';
    const mgr = createCuAgentLeases({
      broker: baseClient,
      storeFile: () => caseStorePath,
      processAlive: p => (p.pid === 71003 && p.startTime === '710030') || (p.pid === 71004 && p.startTime === '710040'),
      pidAlive: () => false,
      heartbeatIntervalMs: 20,
      livenessCheckMs: 0,
      abortSession: async () => true,
      resumeSession: async () => true,
    });
    t.after(() => mgr.stop());
    await mgr.probeCapabilities();

    // Different PID after bind
    const hDiff = present(await mgr.prepareSpawn({ knownSessionId: sidDiff }));
    await mgr.bindSpawnedProcess(hDiff, { pid: 71003, startTime: '710030' });
    mgr.attachSpawnedSession(hDiff, { sessionId: sidDiff, pid: 71003, pidStartTime: '710030' });
    const hb1 = broker.heartbeatCalls.length;
    await waitFor(() => broker.heartbeatCalls.length > hb1, 'post-bind heartbeat succeeds while birth matches');
    assert.ok(broker.lease);
    broker.lease.pid = 71888;
    broker.lease.pidStartTime = 718880;
    broker.cursor += 1;
    await waitFor(() => broker.state === 'idle', 'different PID after bind releases lease');
    assert.equal(mgr.isDesktopAccessLost(sidDiff), true);

    // Lost claim after bind
    const sidLost = '~sk1_omp_g4_postbind_lost_claim';
    const hLost = present(await mgr.prepareSpawn({ knownSessionId: sidLost }));
    await mgr.bindSpawnedProcess(hLost, { pid: 71004, startTime: '710040' });
    mgr.attachSpawnedSession(hLost, { sessionId: sidLost, pid: 71004, pidStartTime: '710040' });
    const hb2 = broker.heartbeatCalls.length;
    await waitFor(() => broker.heartbeatCalls.length > hb2, 'post-bind heartbeat succeeds while claim pending');
    broker.activeClaims.delete(hLost.brokerSessionId);
    broker.cursor += 1;
    await waitFor(() => broker.state === 'idle', 'lost claim after bind releases lease');
    assert.equal(mgr.isDesktopAccessLost(sidLost), true);

    mgr.stop();
  }

  assert.equal(broker.validationErrorCalls.length, 0);
  assert.equal(broker.forcedMutationCalls.length, 0);
});

export {};
