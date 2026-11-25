/**
 * Guest-side computer-use agent lease lifecycle for managed `omp` sessions.
 *
 * Security & durability contract (Slice 2, §9 of docs/computer-use-integration.md):
 * - Zero secrets or nonces ever enter tmux argv/env, child process env, logs,
 *   HTTP/SSE responses, or persisted stores. Only `CU_BROKER_SESSION_ID`,
 *   `CU_BROKER_CLAIM_FILE`, and non-identifying `CU_BROKER_LABEL` (`"omp"`)
 *   are passed to the spawned `omp` pane; `/usr/local/bin/cua-driver-mcp`
 *   redeems the one-use `claimFile` over `agent.sock` under `SO_PEERCRED` +
 *   process-lineage + binary verification.
 * - `sessionSecret` lives strictly in private Node heap memory for control-plane
 *   calls (`bind`, `claim-nonce`, `heartbeat`, `release`, `cancel-preempted`).
 * - Each launch uses a fresh opaque `leaseOwnerId` and `brokerSessionId`; route
 *   and private session IDs never leave pi-dish into broker status, labels, or
 *   audit logs. The route↔lease mapping stays local to pi-dish.
 * - A durable NON-SECRET record (`cu-agent-leases.json`, 0600) persists
 *   `leaseOwnerId`, `brokerSessionId`, `leaseId`, `epoch`, `generation`, and
 *   `(pid, pidStartTime)` so startup reconciliation releases/cancels orphans
 *   and re-adopts live `omp` processes across pi-dish restarts.
 * - Closing or losing a displaced agent calls `POST /v1/lease/cancel-preempted`
 *   (falling back to `release` on `409 lease_active`), never leaving a dead
 *   session eligible for hand-back and never disrupting an active human lease.
 * - Abort and hand-back nudge commands are addressed by `(generation, pid:startTime)`,
 *   track pending vs acked epochs separately, recheck owner + OS process birth
 *   right before delivery, and abort immediately on heartbeat `409`.
 */
import crypto = require('node:crypto');
import fs = require('node:fs');
import path = require('node:path');
import type { CuBrokerClient } from './cu-broker';
import { dishDir, replaceFileDurably } from './dish-store';
import { errorMessage, httpError } from './http-boundary';
import { record as isRecord } from './helper-values';
import { processIdentityAlive } from './process-identity';

export const CU_HAND_BACK_NUDGE =
  'The desktop has been returned to you after human take-over. Inspect the current screen and browser state before continuing.';

export const BROKER_AGENT_LABEL = 'omp';

const DEFAULT_AGENT_HEARTBEAT_SEC = 20;
const DEFAULT_LIVENESS_CHECK_MS = 2_000;
const DEFAULT_COMMAND_RETRY_MS = 200;
const MAX_COMMAND_RETRIES = 6;
const CLAIM_BIND_TIMEOUT_SEC = 30;
const LEASE_STORE_VERSION = 1;
const LEASE_STORE_FILENAME = 'cu-agent-leases.json';
const MAX_STORE_BYTES = 256 * 1024;
const SECRET_KEYS = new Set(['sessionSecret', 'tokenHash', 'leaseToken', 'token', 'claimNonce', 'mcpToken']);

export type ManagedLeaseStatus = 'holding' | 'waiting_for_desktop' | 'preempted' | 'idle';

export interface CuSeatBusyDetails {
  readonly state: string | null;
  readonly epoch: number | null;
  readonly holder: Record<string, unknown> | null;
}

/** Structured 409 error raised when another agent already holds the CU seat. */
export class CuSeatBusyError extends Error {
  readonly status = 409;
  readonly code = 'seat_busy' as const;
  readonly state: string | null;
  readonly epoch: number | null;
  readonly holder: Record<string, unknown> | null;

  constructor(message: string, details: CuSeatBusyDetails) {
    super(message);
    this.name = 'CuSeatBusyError';
    this.state = details.state;
    this.epoch = details.epoch;
    this.holder = details.holder;
  }
}

/** Structured 503 error raised when a CU host's configured broker socket is unreachable. */
export class CuBrokerUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'cu_broker_unavailable' as const;

  constructor(message = 'Computer-use broker is unavailable') {
    super(message);
    this.name = 'CuBrokerUnavailableError';
  }
}

export interface CuBrokerEvent {
  readonly eventName: string;
  readonly eventId?: string | null;
  readonly authoritativeHello: boolean;
  readonly isResync?: boolean;
  readonly resyncReason?: string | null;
  readonly generation?: string | null;
  readonly cursor?: number | null;
  readonly generationChanged?: boolean;
  readonly payload: Record<string, unknown>;
}

export interface CuAgentSpawnHandle {
  readonly brokerSessionId: string;
  readonly leaseOwnerId: string | null;
  readonly env: Readonly<Record<string, string>>;
  readonly waitingForDesktop: boolean;
  readonly reusedExisting: boolean;
  readonly acquiredEpoch: number | null;
}

export interface CuBindProcessInfo {
  readonly pid: number;
  readonly startTime: string;
}

export interface CuAttachSessionInfo {
  readonly sessionId: string;
  readonly pid: number | null;
  readonly pidStartTime: string | null;
}

export interface CuCommandTarget {
  readonly sessionId: string;
  readonly leaseOwnerId: string;
  readonly generation: string;
  readonly epoch: number;
  readonly pid: number | null;
  readonly pidStartTime: string | null;
  /** Synchronous recheck run immediately before dispatching abort/prompt on the bridge. */
  readonly isStillValid: () => boolean;
}

export interface PersistedCuLeaseRecord {
  readonly leaseOwnerId: string;
  readonly brokerSessionId: string;
  readonly leaseId: string | null;
  readonly epoch: number;
  readonly generation: string | null;
  readonly pid: number | null;
  readonly pidStartTime: string | null;
  readonly createdAt: number;
}

export interface CuAgentLeasesPorts {
  readonly broker: CuBrokerClient;
  /** Must return true ONLY when abort was verified and acknowledged by the target process. */
  abortSession(target: CuCommandTarget): Promise<boolean>;
  /** Must return true ONLY when hand-back nudge was verified and acknowledged by the target process. */
  resumeSession(target: CuCommandTarget, nudgeText: string): Promise<boolean>;
  /** Maps a surviving OS process birth back to its live canonical pi-dish route sessionId. */
  findSessionIdByProcess?(process: { readonly pid: number; readonly startTime: string }): string | null;
  /** Optional test seam overriding the durable non-secret store path. */
  storeFile?: () => string;
  /** Optional test seam overriding agent heartbeat interval in milliseconds. */
  heartbeatIntervalMs?: number;
  /** Optional test seam overriding dead-PID liveness check interval in milliseconds. */
  livenessCheckMs?: number;
  /** Optional test seam overriding command retry delay in milliseconds. */
  commandRetryMs?: number;
  /** Optional test seam overriding OS process liveness verification. */
  processAlive?: (identity: { readonly pid: number; readonly startTime: string }) => boolean;
  log?: (message: string) => void;
}

export interface CuAgentLeases {
  configured(): boolean;
  available(): boolean;
  reconcile(): Promise<void>;
  prepareSpawn(options: { knownSessionId?: string | null; isRestart?: boolean }): Promise<CuAgentSpawnHandle | null>;
  bindSpawnedProcess(handle: CuAgentSpawnHandle, process: CuBindProcessInfo | null): Promise<void>;
  attachSpawnedSession(handle: CuAgentSpawnHandle, info: CuAttachSessionInfo): void;
  abortSpawn(handle: CuAgentSpawnHandle): Promise<void>;
  releaseSession(sessionId: string): Promise<void>;
  handleSessionRetired(sessionId: string): void;
  adoptSessionSwitch(previousSessionId: string, nextSessionId: string): void;
  handleBrokerEvent(event: CuBrokerEvent): void;
  ownerIdForSession(sessionId: string): string | null;
  isWaitingForDesktop(sessionId: string): boolean;
  getSessionSeatState(sessionId: string): 'waiting_for_desktop' | null;
  stop(): void;
}

interface DeliveryTracker {
  generation: string;
  processBirth: string;
  pendingAbortEpoch: number | null;
  inFlightAbortEpoch: number | null;
  ackedAbortEpoch: number;
  abortRetries: number;
  abortRetryTimer: NodeJS.Timeout | null;
  pendingNudgeEpoch: number | null;
  inFlightNudgeEpoch: number | null;
  ackedNudgeEpoch: number;
  nudgeRetries: number;
  nudgeRetryTimer: NodeJS.Timeout | null;
}

interface ManagedLeaseRecord {
  readonly brokerSessionId: string;
  readonly leaseOwnerId: string | null;
  readonly hasBrokerLease: boolean;
  readonly createdAt: number;
  leaseId: string | null;
  sessionSecret: string | null;
  sessionId: string | null;
  status: ManagedLeaseStatus;
  epoch: number;
  generation: string | null;
  pid: number | null;
  pidStartTime: string | null;
  rebindInProgress: boolean;
  reboundNewProcess: boolean;
  adoptedWithoutSecret: boolean;
  pendingStartupReconcile: boolean;
  heartbeatTimer: NodeJS.Timeout | null;
  heartbeatIntervalMs: number;
  delivery: DeliveryTracker;
}

interface BrokerRef {
  readonly ownerId: string | null;
  readonly sessionId: string | null;
  readonly leaseId: string | null;
}

function pickString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function pickFiniteNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function pickPidStartTime(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
  return null;
}

function formatPidStartTimeForBroker(startTime: string): number | string {
  if (/^\d+$/.test(startTime)) {
    const asNum = Number(startTime);
    if (Number.isSafeInteger(asNum) && asNum >= 0) return asNum;
  }
  return startTime;
}

function extractRef(value: unknown): BrokerRef | null {
  if (!isRecord(value)) return null;
  const ownerId = pickString(value, 'ownerId');
  const sessionId = pickString(value, 'sessionId');
  const leaseId = pickString(value, 'leaseId');
  if (!ownerId && !sessionId && !leaseId) return null;
  return { ownerId, sessionId, leaseId };
}

function sanitizeHolder(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = val;
  }
  return out;
}

function optionalEnvMs(name: string, min: number): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num >= min ? num : undefined;
}

function processBirthKey(pid: number | null, startTime: string | null): string {
  return pid !== null && startTime ? `${pid}:${startTime}` : 'unbound';
}

function createDeliveryTracker(generation: string, processBirth: string): DeliveryTracker {
  return {
    generation,
    processBirth,
    pendingAbortEpoch: null,
    inFlightAbortEpoch: null,
    ackedAbortEpoch: -1,
    abortRetries: 0,
    abortRetryTimer: null,
    pendingNudgeEpoch: null,
    inFlightNudgeEpoch: null,
    ackedNudgeEpoch: -1,
    nudgeRetries: 0,
    nudgeRetryTimer: null,
  };
}

function clearDeliveryTimers(tracker: DeliveryTracker): void {
  if (tracker.abortRetryTimer) {
    clearTimeout(tracker.abortRetryTimer);
    tracker.abortRetryTimer = null;
  }
  if (tracker.nudgeRetryTimer) {
    clearTimeout(tracker.nudgeRetryTimer);
    tracker.nudgeRetryTimer = null;
  }
}

function parsePersistedRecord(value: unknown): PersistedCuLeaseRecord | null {
  if (!isRecord(value)) return null;
  const leaseOwnerId = pickString(value, 'leaseOwnerId');
  const brokerSessionId = pickString(value, 'brokerSessionId');
  if (!leaseOwnerId || !brokerSessionId) return null;
  const leaseId = pickString(value, 'leaseId');
  const epoch = pickFiniteNumber(value, 'epoch') ?? 0;
  const generation = pickString(value, 'generation');
  const rawPid = pickFiniteNumber(value, 'pid');
  const pid = rawPid !== null && rawPid > 1 ? rawPid : null;
  const pidStartTime = pid !== null ? pickPidStartTime(value, 'pidStartTime') : null;
  const createdAt = pickFiniteNumber(value, 'createdAt') ?? Date.now();
  return {
    leaseOwnerId,
    brokerSessionId,
    leaseId,
    epoch,
    generation,
    pid,
    pidStartTime,
    createdAt,
  };
}

export function createCuAgentLeases(ports: CuAgentLeasesPorts): CuAgentLeases {
  const log = ports.log ?? ((line: string) => console.error(line));
  const storeFile = ports.storeFile ?? (() => path.join(dishDir(), LEASE_STORE_FILENAME));
  const processAlive = ports.processAlive ?? ((identity: { readonly pid: number; readonly startTime: string }) => processIdentityAlive(identity));
  const livenessCheckMs = ports.livenessCheckMs
    ?? optionalEnvMs('PI_DISH_CU_LIVENESS_MS', 25)
    ?? DEFAULT_LIVENESS_CHECK_MS;
  const commandRetryMs = ports.commandRetryMs ?? DEFAULT_COMMAND_RETRY_MS;

  const recordsByBrokerId = new Map<string, ManagedLeaseRecord>();
  const recordsByOwnerId = new Map<string, ManagedLeaseRecord>();
  const brokerIdBySessionId = new Map<string, string>();
  /** Broker IDs kept only in persisted store when a release failed while broker was down. */
  const persistedOrphans = new Map<string, PersistedCuLeaseRecord>();

  let stopped = false;
  let reconciled = false;
  let reconcileFlight: Promise<void> | null = null;
  let latestBrokerState: string | null = null;
  let latestBrokerEpoch = -1;
  let latestBrokerGeneration: string | null = null;
  let livenessTimer: NodeJS.Timeout | null = null;

  function loadPersistedStore(): void {
    if (!ports.broker.configured()) return;
    const file = storeFile();
    let fd: number | undefined;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_STORE_BYTES) return;
      const parsed: unknown = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (!isRecord(parsed) || parsed.version !== LEASE_STORE_VERSION || !Array.isArray(parsed.leases)) return;
      for (const item of parsed.leases) {
        const persisted = parsePersistedRecord(item);
        if (!persisted || recordsByBrokerId.has(persisted.brokerSessionId)) continue;
        const birth = processBirthKey(persisted.pid, persisted.pidStartTime);
        const rec: ManagedLeaseRecord = {
          brokerSessionId: persisted.brokerSessionId,
          leaseOwnerId: persisted.leaseOwnerId,
          hasBrokerLease: true,
          createdAt: persisted.createdAt,
          leaseId: persisted.leaseId,
          sessionSecret: null,
          sessionId: null,
          status: 'holding',
          epoch: persisted.epoch,
          generation: persisted.generation,
          pid: persisted.pid,
          pidStartTime: persisted.pidStartTime,
          rebindInProgress: false,
          reboundNewProcess: false,
          adoptedWithoutSecret: true,
          pendingStartupReconcile: true,
          heartbeatTimer: null,
          heartbeatIntervalMs: resolveHeartbeatMs(null),
          delivery: createDeliveryTracker(persisted.generation ?? 'default', birth),
        };
        if (rec.pid !== null && rec.pidStartTime && processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
          const foundSid = ports.findSessionIdByProcess?.({ pid: rec.pid, startTime: rec.pidStartTime }) ?? null;
          if (foundSid) {
            rec.sessionId = foundSid;
            brokerIdBySessionId.set(foundSid, rec.brokerSessionId);
          }
        }
        recordsByBrokerId.set(rec.brokerSessionId, rec);
        recordsByOwnerId.set(persisted.leaseOwnerId, rec);
      }
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') {
        log(`[cu-lease] could not load persisted lease store: ${errorMessage(error)}`);
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  function persistStore(): void {
    if (!ports.broker.configured()) return;
    const leases: PersistedCuLeaseRecord[] = [];
    const seen = new Set<string>();
    for (const rec of recordsByBrokerId.values()) {
      if (!rec.hasBrokerLease || !rec.leaseOwnerId) continue;
      if (rec.status !== 'holding' && rec.status !== 'preempted') continue;
      seen.add(rec.brokerSessionId);
      leases.push({
        leaseOwnerId: rec.leaseOwnerId,
        brokerSessionId: rec.brokerSessionId,
        leaseId: rec.leaseId,
        epoch: rec.epoch,
        generation: rec.generation,
        pid: rec.pid,
        pidStartTime: rec.pidStartTime,
        createdAt: rec.createdAt,
      });
    }
    for (const orphan of persistedOrphans.values()) {
      if (!seen.has(orphan.brokerSessionId)) leases.push(orphan);
    }
    const file = storeFile();
    try {
      const dir = path.dirname(file);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try { fs.chmodSync(dir, 0o700); } catch {}
      replaceFileDurably(file, JSON.stringify({ version: LEASE_STORE_VERSION, leases }) + '\n');
    } catch (error) {
      log(`[cu-lease] failed to persist lease store: ${errorMessage(error)}`);
    }
  }

  function resolveHeartbeatMs(brokerIntervalSec: number | null): number {
    if (ports.heartbeatIntervalMs !== undefined) return ports.heartbeatIntervalMs;
    const sec = brokerIntervalSec !== null && brokerIntervalSec >= 5 ? brokerIntervalSec : DEFAULT_AGENT_HEARTBEAT_SEC;
    return sec * 1000;
  }

  function clearHeartbeat(rec: ManagedLeaseRecord): void {
    if (rec.heartbeatTimer) {
      clearInterval(rec.heartbeatTimer);
      rec.heartbeatTimer = null;
    }
  }

  function removeRecord(rec: ManagedLeaseRecord, options: { persist?: boolean } = {}): void {
    clearHeartbeat(rec);
    clearDeliveryTimers(rec.delivery);
    rec.sessionSecret = null;
    recordsByBrokerId.delete(rec.brokerSessionId);
    if (rec.leaseOwnerId && recordsByOwnerId.get(rec.leaseOwnerId) === rec) {
      recordsByOwnerId.delete(rec.leaseOwnerId);
    }
    if (rec.sessionId && brokerIdBySessionId.get(rec.sessionId) === rec.brokerSessionId) {
      brokerIdBySessionId.delete(rec.sessionId);
    }
    maybeStopLivenessMonitor();
    if (options.persist !== false && rec.hasBrokerLease) {
      persistStore();
    }
  }

  function maybeStopLivenessMonitor(): void {
    if (!livenessTimer) return;
    for (const rec of recordsByBrokerId.values()) {
      if (rec.pid !== null && rec.pidStartTime && (rec.status === 'holding' || rec.status === 'preempted' || rec.status === 'waiting_for_desktop')) {
        return;
      }
    }
    clearInterval(livenessTimer);
    livenessTimer = null;
  }

  function ensureLivenessMonitor(): void {
    if (stopped || livenessTimer || livenessCheckMs <= 0) return;
    livenessTimer = setInterval(() => {
      if (stopped) return;
      for (const rec of [...recordsByBrokerId.values()]) {
        if (rec.pendingStartupReconcile || rec.rebindInProgress) continue;
        if (rec.pid === null || !rec.pidStartTime) continue;
        if (processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) continue;
        void releaseRecord(rec);
      }
      maybeStopLivenessMonitor();
    }, livenessCheckMs);
    livenessTimer.unref();
  }

  function resolveSessionIdForRecord(rec: ManagedLeaseRecord): string | null {
    if (rec.sessionId) return rec.sessionId;
    if (rec.pid !== null && rec.pidStartTime && ports.findSessionIdByProcess) {
      if (!processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) return null;
      const found = ports.findSessionIdByProcess({ pid: rec.pid, startTime: rec.pidStartTime });
      if (found) {
        rec.sessionId = found;
        brokerIdBySessionId.set(found, rec.brokerSessionId);
        return found;
      }
    }
    return null;
  }

  function recordForSessionId(sessionId: string): ManagedLeaseRecord | null {
    const directBrokerId = brokerIdBySessionId.get(sessionId);
    if (directBrokerId) {
      const direct = recordsByBrokerId.get(directBrokerId);
      if (direct) return direct;
      brokerIdBySessionId.delete(sessionId);
    }
    for (const rec of recordsByBrokerId.values()) {
      if (rec.sessionId === sessionId) {
        brokerIdBySessionId.set(sessionId, rec.brokerSessionId);
        return rec;
      }
      if (!rec.sessionId && resolveSessionIdForRecord(rec) === sessionId) {
        return rec;
      }
    }
    return null;
  }

  function resetRecordDelivery(rec: ManagedLeaseRecord, nextGeneration: string, nextBirth: string): void {
    clearDeliveryTimers(rec.delivery);
    rec.delivery = createDeliveryTracker(nextGeneration, nextBirth);
  }

  function ensureDeliveryContext(rec: ManagedLeaseRecord, generation: string): DeliveryTracker {
    const birth = processBirthKey(rec.pid, rec.pidStartTime);
    if (rec.delivery.generation !== generation || rec.delivery.processBirth !== birth) {
      resetRecordDelivery(rec, generation, birth);
    }
    return rec.delivery;
  }

  function resetAllWatermarks(nextGeneration: string | null): void {
    latestBrokerEpoch = -1;
    if (nextGeneration !== null) latestBrokerGeneration = nextGeneration;
    for (const rec of recordsByBrokerId.values()) {
      const gen = nextGeneration ?? rec.generation ?? 'default';
      if (nextGeneration !== null) rec.generation = nextGeneration;
      resetRecordDelivery(rec, gen, processBirthKey(rec.pid, rec.pidStartTime));
    }
  }

  function scheduleCommand(
    rec: ManagedLeaseRecord,
    kind: 'abort' | 'nudge',
    epoch: number,
    generation: string,
  ): void {
    if (stopped || !rec.hasBrokerLease || !rec.leaseOwnerId) return;
    const tracker = ensureDeliveryContext(rec, generation);
    if (kind === 'abort') {
      // An abort supersedes any pending hand-back nudge.
      tracker.pendingNudgeEpoch = null;
      if (tracker.nudgeRetryTimer) { clearTimeout(tracker.nudgeRetryTimer); tracker.nudgeRetryTimer = null; }
      if (epoch <= tracker.ackedAbortEpoch) return;
      if (tracker.inFlightAbortEpoch !== null && epoch <= tracker.inFlightAbortEpoch) return;
      tracker.pendingAbortEpoch = Math.max(tracker.pendingAbortEpoch ?? -1, epoch);
      tracker.abortRetries = 0;
      void flushCommand(rec, 'abort');
      return;
    }
    // A hand-back nudge supersedes any pending abort.
    tracker.pendingAbortEpoch = null;
    if (tracker.abortRetryTimer) { clearTimeout(tracker.abortRetryTimer); tracker.abortRetryTimer = null; }
    if (epoch <= tracker.ackedNudgeEpoch) return;
    if (tracker.inFlightNudgeEpoch !== null && epoch <= tracker.inFlightNudgeEpoch) return;
    tracker.pendingNudgeEpoch = Math.max(tracker.pendingNudgeEpoch ?? -1, epoch);
    tracker.nudgeRetries = 0;
    void flushCommand(rec, 'nudge');
  }

  function commandStillValid(
    rec: ManagedLeaseRecord,
    kind: 'abort' | 'nudge',
    targetOwnerId: string,
    targetSessionId: string,
    targetGen: string,
    targetEpoch: number,
    targetPid: number | null,
    targetPidStartTime: string | null,
  ): boolean {
    if (stopped) return false;
    if (recordsByBrokerId.get(rec.brokerSessionId) !== rec) return false;
    if (rec.leaseOwnerId !== targetOwnerId) return false;
    if (rec.sessionId !== targetSessionId) return false;
    if (rec.delivery.generation !== targetGen) return false;
    if (rec.pid !== targetPid || rec.pidStartTime !== targetPidStartTime) return false;
    if (targetPid !== null && targetPidStartTime !== null && !processAlive({ pid: targetPid, startTime: targetPidStartTime })) {
      return false;
    }
    if (kind === 'abort') {
      // Abort is valid while preempted or idle (heartbeat 409 / lease_lost), never after hand-back restored holding.
      return rec.status !== 'holding' && rec.status !== 'waiting_for_desktop';
    }
    // Nudge is valid ONLY while this exact owner still holds the seat at this epoch.
    return rec.status === 'holding' && rec.epoch === targetEpoch;
  }

  async function flushCommand(rec: ManagedLeaseRecord, kind: 'abort' | 'nudge'): Promise<void> {
    if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) return;
    if (!rec.leaseOwnerId) return;
    const tracker = rec.delivery;
    const targetEpoch = kind === 'abort' ? tracker.pendingAbortEpoch : tracker.pendingNudgeEpoch;
    if (targetEpoch === null) return;
    if (kind === 'abort' && tracker.inFlightAbortEpoch !== null) return;
    if (kind === 'nudge' && tracker.inFlightNudgeEpoch !== null) return;

    const sessionId = resolveSessionIdForRecord(rec);
    if (!sessionId) {
      // Bridge has not registered yet; keep pending until attachSpawnedSession() flushes it.
      // For re-adopted records (no attachSpawnedSession coming), schedule a bounded retry so
      // a late-visible bridge still receives the pending abort/nudge.
      if (rec.adoptedWithoutSecret) {
        const retries = kind === 'abort' ? ++tracker.abortRetries : ++tracker.nudgeRetries;
        if (retries <= MAX_COMMAND_RETRIES && commandRetryMs > 0 && !stopped) {
          const delayMs = Math.min(2_000, commandRetryMs * retries);
          const timer = setTimeout(() => {
            if (kind === 'abort') tracker.abortRetryTimer = null;
            else tracker.nudgeRetryTimer = null;
            void flushCommand(rec, kind);
          }, delayMs);
          timer.unref();
          if (kind === 'abort') {
            if (tracker.abortRetryTimer) clearTimeout(tracker.abortRetryTimer);
            tracker.abortRetryTimer = timer;
          } else {
            if (tracker.nudgeRetryTimer) clearTimeout(tracker.nudgeRetryTimer);
            tracker.nudgeRetryTimer = timer;
          }
        }
      }
      return;
    }

    const targetOwnerId = rec.leaseOwnerId;
    const targetGen = tracker.generation;
    const targetPid = rec.pid;
    const targetPidStartTime = rec.pidStartTime;
    const targetBirth = tracker.processBirth;

    const checkValid = () => commandStillValid(
      rec,
      kind,
      targetOwnerId,
      sessionId,
      targetGen,
      targetEpoch,
      targetPid,
      targetPidStartTime,
    );

    if (!checkValid()) {
      if (kind === 'abort') tracker.pendingAbortEpoch = null;
      else tracker.pendingNudgeEpoch = null;
      if (rec.status === 'idle' && tracker.pendingAbortEpoch === null && tracker.inFlightAbortEpoch === null) {
        removeRecord(rec, { persist: false });
      }
      return;
    }

    if (kind === 'abort') {
      tracker.pendingAbortEpoch = null;
      tracker.inFlightAbortEpoch = targetEpoch;
    } else {
      tracker.pendingNudgeEpoch = null;
      tracker.inFlightNudgeEpoch = targetEpoch;
    }

    const target: CuCommandTarget = {
      sessionId,
      leaseOwnerId: targetOwnerId,
      generation: targetGen,
      epoch: targetEpoch,
      pid: targetPid,
      pidStartTime: targetPidStartTime,
      isStillValid: checkValid,
    };

    let delivered = false;
    try {
      delivered = kind === 'abort'
        ? await ports.abortSession(target)
        : await ports.resumeSession(target, CU_HAND_BACK_NUDGE);
    } catch (error) {
      log(`[cu-lease] ${kind} failed for ${targetOwnerId} at ${targetGen}#${targetEpoch}: ${errorMessage(error)}`);
      delivered = false;
    } finally {
      const sameTracker = rec.delivery === tracker && tracker.generation === targetGen && tracker.processBirth === targetBirth;
      if (sameTracker) {
        if (kind === 'abort' && tracker.inFlightAbortEpoch === targetEpoch) tracker.inFlightAbortEpoch = null;
        if (kind === 'nudge' && tracker.inFlightNudgeEpoch === targetEpoch) tracker.inFlightNudgeEpoch = null;
      }
      if (sameTracker && delivered) {
        if (kind === 'abort') {
          tracker.ackedAbortEpoch = Math.max(tracker.ackedAbortEpoch, targetEpoch);
          tracker.abortRetries = 0;
        } else {
          tracker.ackedNudgeEpoch = Math.max(tracker.ackedNudgeEpoch, targetEpoch);
          tracker.nudgeRetries = 0;
        }
      } else if (sameTracker && !delivered && checkValid()) {
        // Keep pending (NOT acked!) and schedule bounded retry if still valid.
        const retries = kind === 'abort' ? ++tracker.abortRetries : ++tracker.nudgeRetries;
        if (kind === 'abort') {
          tracker.pendingAbortEpoch = Math.max(tracker.pendingAbortEpoch ?? -1, targetEpoch);
        } else {
          tracker.pendingNudgeEpoch = Math.max(tracker.pendingNudgeEpoch ?? -1, targetEpoch);
        }
        if (retries <= MAX_COMMAND_RETRIES && commandRetryMs > 0 && !stopped) {
          const delayMs = Math.min(2_000, commandRetryMs * retries);
          const timer = setTimeout(() => {
            if (kind === 'abort') tracker.abortRetryTimer = null;
            else tracker.nudgeRetryTimer = null;
            void flushCommand(rec, kind);
          }, delayMs);
          timer.unref();
          if (kind === 'abort') {
            if (tracker.abortRetryTimer) clearTimeout(tracker.abortRetryTimer);
            tracker.abortRetryTimer = timer;
          } else {
            if (tracker.nudgeRetryTimer) clearTimeout(tracker.nudgeRetryTimer);
            tracker.nudgeRetryTimer = timer;
          }
        }
      }

      // Clean up idle lease_lost records once their final abort finishes (acked or exhausted).
      if (
        rec.status === 'idle'
        && rec.delivery.inFlightAbortEpoch === null
        && (rec.delivery.pendingAbortEpoch === null || rec.delivery.abortRetries > MAX_COMMAND_RETRIES)
      ) {
        removeRecord(rec, { persist: false });
      } else if (sameTracker) {
        // Flush if a newer epoch was queued while this command was in flight.
        if (kind === 'abort' && tracker.pendingAbortEpoch !== null && tracker.abortRetryTimer === null && delivered) {
          void flushCommand(rec, 'abort');
        } else if (kind === 'nudge' && tracker.pendingNudgeEpoch !== null && tracker.nudgeRetryTimer === null && delivered) {
          void flushCommand(rec, 'nudge');
        }
      }
    }
  }

  function flushPendingCommands(rec: ManagedLeaseRecord): void {
    if (rec.delivery.pendingAbortEpoch !== null) void flushCommand(rec, 'abort');
    if (rec.delivery.pendingNudgeEpoch !== null) void flushCommand(rec, 'nudge');
  }

  function startHeartbeat(rec: ManagedLeaseRecord): void {
    clearHeartbeat(rec);
    if (stopped || !rec.sessionSecret || rec.heartbeatIntervalMs <= 0) return;
    rec.heartbeatTimer = setInterval(() => {
      if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) {
        clearHeartbeat(rec);
        return;
      }
      if (!rec.sessionSecret) {
        clearHeartbeat(rec);
        return;
      }
      if (!rec.rebindInProgress && rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
        void releaseRecord(rec);
        return;
      }
      if (rec.status !== 'holding') return;
      void sendHeartbeat(rec);
    }, rec.heartbeatIntervalMs);
    rec.heartbeatTimer.unref();
  }

  async function sendHeartbeat(rec: ManagedLeaseRecord): Promise<void> {
    const secret = rec.sessionSecret;
    if (!secret || stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) return;
    try {
      const reply = await ports.broker.requestJson('POST', '/v1/lease/heartbeat', {
        sessionId: rec.brokerSessionId,
        sessionSecret: secret,
      });
      if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) return;
      if (reply.status === 200 && isRecord(reply.body)) {
        const ep = pickFiniteNumber(reply.body, 'epoch');
        const gen = pickString(reply.body, 'generation');
        if (ep !== null && ep >= rec.epoch) rec.epoch = ep;
        if (gen) rec.generation = gen;
        return;
      }
      if (reply.status === 409) {
        const body = isRecord(reply.body) ? reply.body : {};
        const code = pickString(body, 'code');
        const ep = pickFiniteNumber(body, 'epoch') ?? Math.max(0, rec.epoch);
        const gen = pickString(body, 'generation') ?? rec.generation ?? latestBrokerGeneration ?? 'default';
        if (ep >= rec.epoch) rec.epoch = ep;
        rec.generation = gen;
        if (code === 'lease_preempted') {
          rec.status = 'preempted';
          // Retain sessionSecret so cancel-preempted and hand_back work seamlessly.
          persistStore();
          scheduleCommand(rec, 'abort', rec.epoch, gen);
          return;
        }
        // Any other heartbeat 409 (lease_lost, etc.) must immediately abort and drop lease credentials.
        clearHeartbeat(rec);
        rec.sessionSecret = null;
        rec.status = 'idle';
        persistStore();
        scheduleCommand(rec, 'abort', rec.epoch, gen);
        return;
      }
      if (reply.status === 403) {
        clearHeartbeat(rec);
        rec.sessionSecret = null;
        rec.status = 'idle';
        persistStore();
        const gen = rec.generation ?? latestBrokerGeneration ?? 'default';
        scheduleCommand(rec, 'abort', Math.max(0, rec.epoch), gen);
      }
    } catch {
      // Transient broker hiccup: retry on the next heartbeat interval.
    }
  }

  function refMatchesRecord(ref: BrokerRef | null, rec: Pick<ManagedLeaseRecord, 'hasBrokerLease' | 'leaseOwnerId' | 'brokerSessionId' | 'leaseId'>): boolean {
    if (!ref || !rec.hasBrokerLease) return false;
    if (ref.ownerId !== null && rec.leaseOwnerId !== null) {
      return ref.ownerId === rec.leaseOwnerId;
    }
    if (ref.sessionId !== null && ref.sessionId === rec.brokerSessionId) return true;
    if (ref.leaseId !== null && rec.leaseId !== null && ref.leaseId === rec.leaseId) return true;
    return false;
  }

  function findRecordForRef(ref: BrokerRef | null): ManagedLeaseRecord | null {
    if (!ref) return null;
    if (ref.ownerId !== null) {
      const byOwner = recordsByOwnerId.get(ref.ownerId);
      if (byOwner) return byOwner;
      // When broker supplies an explicit ownerId, do not fall back to a different owner.
      return null;
    }
    if (ref.sessionId !== null) {
      const direct = recordsByBrokerId.get(ref.sessionId);
      if (direct) return direct;
    }
    for (const rec of recordsByBrokerId.values()) {
      if (refMatchesRecord(ref, rec)) return rec;
    }
    return null;
  }

  async function releaseWithoutSecret(info: {
    brokerSessionId: string;
    leaseOwnerId: string | null;
    leaseId: string | null;
  }): Promise<boolean> {
    // Re-adopted record without sessionSecret: verify exact ownerId on broker before any force call.
    const statusReply = await ports.broker.requestJson('GET', '/v1/status');
    if (statusReply.status !== 200 || !isRecord(statusReply.body)) return false;
    const st = pickString(statusReply.body, 'state');
    const activeLease = isRecord(statusReply.body.lease) ? statusReply.body.lease : null;
    const preempted = isRecord(statusReply.body.preempted) ? statusReply.body.preempted : null;
    const target = { hasBrokerLease: true, ...info };
    if (preempted && refMatchesRecord(extractRef(preempted), target)) {
      const cancelReply = await ports.broker.requestJson('POST', '/v1/lease/cancel-preempted', {
        sessionId: info.brokerSessionId,
        force: true,
      });
      if (cancelReply.status === 409 && isRecord(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
        await ports.broker.requestJson('POST', '/v1/lease/release', {
          sessionId: info.brokerSessionId,
          ...(info.leaseId ? { leaseId: info.leaseId } : {}),
          force: true,
        });
      }
      return true;
    }
    if ((st === 'agent' || st === 'waiting_for_human') && activeLease && pickString(activeLease, 'holderKind') !== 'human' && refMatchesRecord(extractRef(activeLease), target)) {
      await ports.broker.requestJson('POST', '/v1/lease/release', {
        sessionId: info.brokerSessionId,
        ...(info.leaseId ? { leaseId: info.leaseId } : {}),
        force: true,
      });
      return true;
    }
    // Already absent or owned by someone else — leave current holder untouched.
    return true;
  }

  async function releaseRecord(rec: ManagedLeaseRecord): Promise<void> {
    const {
      brokerSessionId,
      leaseOwnerId,
      leaseId,
      hasBrokerLease,
      status,
      sessionSecret,
      epoch,
      generation,
      pid,
      pidStartTime,
      createdAt,
    } = rec;
    removeRecord(rec, { persist: false });
    if (!hasBrokerLease || status === 'waiting_for_desktop' || status === 'idle') {
      persistStore();
      return;
    }
    const rememberOrphanForReconcile = () => {
      if (!leaseOwnerId) return;
      persistedOrphans.set(brokerSessionId, {
        leaseOwnerId,
        brokerSessionId,
        leaseId,
        epoch,
        generation,
        pid,
        pidStartTime,
        createdAt,
      });
      reconciled = false;
      persistStore();
    };
    if (!ports.broker.available()) {
      rememberOrphanForReconcile();
      return;
    }
    try {
      if (!sessionSecret) {
        const ok = await releaseWithoutSecret({ brokerSessionId, leaseOwnerId, leaseId });
        if (!ok) rememberOrphanForReconcile();
        else persistStore();
        return;
      }
      if (status === 'preempted') {
        const cancelReply = await ports.broker.requestJson('POST', '/v1/lease/cancel-preempted', {
          sessionId: brokerSessionId,
          sessionSecret,
        });
        if (cancelReply.status === 409 && isRecord(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
          // Hand-back raced ahead of cancel-preempted: release the now-active agent lease instead.
          await ports.broker.requestJson('POST', '/v1/lease/release', {
            sessionId: brokerSessionId,
            sessionSecret,
          });
        }
        persistStore();
        return;
      }
      const relReply = await ports.broker.requestJson('POST', '/v1/lease/release', {
        sessionId: brokerSessionId,
        sessionSecret,
      });
      if (relReply.status === 403) {
        // Belt-and-suspenders: if takeover raced on an older broker that rejected release on preempted, cancel-preempted.
        const cancelReply = await ports.broker.requestJson('POST', '/v1/lease/cancel-preempted', {
          sessionId: brokerSessionId,
          sessionSecret,
        });
        if (cancelReply.status === 409 && isRecord(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
          await ports.broker.requestJson('POST', '/v1/lease/release', {
            sessionId: brokerSessionId,
            sessionSecret,
          });
        }
      }
      persistStore();
    } catch (error) {
      log(`[cu-lease] release/cancel failed for ${leaseOwnerId ?? brokerSessionId}: ${errorMessage(error)}`);
      rememberOrphanForReconcile();
    }
  }

  async function reconcile(): Promise<void> {
    if (stopped || !ports.broker.configured()) {
      reconciled = true;
      return;
    }
    if (reconcileFlight) return reconcileFlight;
    const flight = (async () => {
      const pendingRecords = [...recordsByBrokerId.values()].filter(r => r.pendingStartupReconcile);
      const orphans = [...persistedOrphans.values()];
      if (!pendingRecords.length && !orphans.length) {
        reconciled = true;
        return;
      }
      if (!ports.broker.available()) {
        reconciled = false;
        return;
      }
      let reply;
      try {
        reply = await ports.broker.requestJson('GET', '/v1/status');
      } catch (error) {
        log(`[cu-lease] startup reconciliation deferred (broker unreachable): ${errorMessage(error)}`);
        reconciled = false;
        return;
      }
      if (stopped) return;
      if (reply.status !== 200 || !isRecord(reply.body)) {
        reconciled = false;
        return;
      }
      const brokerState = pickString(reply.body, 'state') ?? 'idle';
      const brokerEpoch = pickFiniteNumber(reply.body, 'epoch') ?? 0;
      const brokerGeneration = pickString(reply.body, 'generation');
      const activeLease = isRecord(reply.body.lease) ? reply.body.lease : null;
      const activeLeaseRef = extractRef(activeLease);
      const activeIsAgent = (brokerState === 'agent' || brokerState === 'waiting_for_human')
        && activeLease !== null
        && pickString(activeLease, 'holderKind') !== 'human';
      const preempted = isRecord(reply.body.preempted) ? reply.body.preempted : null;
      const preemptedRef = extractRef(preempted);

      if (brokerGeneration) latestBrokerGeneration = brokerGeneration;
      if (brokerEpoch >= latestBrokerEpoch) {
        latestBrokerEpoch = brokerEpoch;
        latestBrokerState = brokerState;
      }

      // First clean up any previously queued orphans whose release failed while broker was offline.
      for (const orphan of orphans) {
        const target = {
          hasBrokerLease: true,
          leaseOwnerId: orphan.leaseOwnerId,
          brokerSessionId: orphan.brokerSessionId,
          leaseId: orphan.leaseId,
        };
        const isActive = activeIsAgent && refMatchesRecord(activeLeaseRef, target);
        const isDisplaced = preemptedRef !== null && refMatchesRecord(preemptedRef, target);
        try {
          if (isDisplaced) {
            const cancelReply = await ports.broker.requestJson('POST', '/v1/lease/cancel-preempted', {
              sessionId: orphan.brokerSessionId,
              force: true,
            });
            if (cancelReply.status === 409 && isRecord(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
              await ports.broker.requestJson('POST', '/v1/lease/release', {
                sessionId: orphan.brokerSessionId,
                ...(orphan.leaseId ? { leaseId: orphan.leaseId } : {}),
                force: true,
              });
            }
          } else if (isActive) {
            await ports.broker.requestJson('POST', '/v1/lease/release', {
              sessionId: orphan.brokerSessionId,
              ...(orphan.leaseId ? { leaseId: orphan.leaseId } : {}),
              force: true,
            });
          }
          persistedOrphans.delete(orphan.brokerSessionId);
        } catch (error) {
          log(`[cu-lease] orphan cleanup failed for ${orphan.leaseOwnerId}: ${errorMessage(error)}`);
        }
      }

      // Reconcile persisted launch records against broker status and live processes.
      for (const rec of pendingRecords) {
        if (recordsByBrokerId.get(rec.brokerSessionId) !== rec) continue;
        rec.pendingStartupReconcile = false;
        const isActive = activeIsAgent && refMatchesRecord(activeLeaseRef, rec);
        const isDisplaced = preemptedRef !== null && refMatchesRecord(preemptedRef, rec);
        if (!isActive && !isDisplaced) {
          removeRecord(rec, { persist: false });
          continue;
        }
        const matchedObj = isActive ? activeLease! : preempted!;
        const effectivePid = rec.pid ?? pickFiniteNumber(matchedObj, 'pid');
        const effectiveStart = rec.pidStartTime ?? pickPidStartTime(matchedObj, 'pidStartTime');
        const alive = effectivePid !== null
          && effectivePid > 1
          && effectiveStart !== null
          && processAlive({ pid: effectivePid, startTime: effectiveStart });

        if (!alive) {
          // Dead or unbound orphan: cancel if displaced (preserving human lease), release if active.
          try {
            if (isDisplaced) {
              const cancelReply = await ports.broker.requestJson('POST', '/v1/lease/cancel-preempted', {
                sessionId: rec.brokerSessionId,
                force: true,
              });
              if (cancelReply.status === 409 && isRecord(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
                await ports.broker.requestJson('POST', '/v1/lease/release', {
                  sessionId: rec.brokerSessionId,
                  ...(rec.leaseId ? { leaseId: rec.leaseId } : {}),
                  force: true,
                });
              }
            } else {
              await ports.broker.requestJson('POST', '/v1/lease/release', {
                sessionId: rec.brokerSessionId,
                ...(rec.leaseId ? { leaseId: rec.leaseId } : {}),
                force: true,
              });
            }
          } catch (error) {
            log(`[cu-lease] startup orphan cleanup failed for ${rec.leaseOwnerId}: ${errorMessage(error)}`);
          }
          removeRecord(rec, { persist: false });
          continue;
        }

        // Process is alive AND broker still tracks this exact leaseOwnerId -> re-adopt!
        rec.pid = effectivePid;
        rec.pidStartTime = effectiveStart;
        rec.leaseId = pickString(matchedObj, 'leaseId') ?? rec.leaseId;
        rec.epoch = brokerEpoch;
        if (brokerGeneration) rec.generation = brokerGeneration;
        rec.status = isActive ? 'holding' : 'preempted';
        const effectiveGen = rec.generation ?? latestBrokerGeneration ?? 'default';
        ensureDeliveryContext(rec, effectiveGen);
        resolveSessionIdForRecord(rec);
        ensureLivenessMonitor();
        if (isDisplaced) {
          scheduleCommand(rec, 'abort', brokerEpoch, effectiveGen);
        }
      }

      reconciled = persistedOrphans.size === 0;
      persistStore();
    })();
    reconcileFlight = flight;
    try {
      await flight;
    } finally {
      if (reconcileFlight === flight) reconcileFlight = null;
    }
  }

  async function requestBrokerOrUnavailable(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    try {
      const reply = await ports.broker.requestJson(method, endpoint, body);
      if (reply.status === 503) {
        const msg = isRecord(reply.body)
          ? (pickString(reply.body, 'message') ?? pickString(reply.body, 'error') ?? 'Computer-use broker is unavailable')
          : 'Computer-use broker is unavailable';
        throw new CuBrokerUnavailableError(msg);
      }
      return reply;
    } catch (error) {
      if (error instanceof CuBrokerUnavailableError) throw error;
      const errStatus = isRecord(error) && typeof error.status === 'number' ? error.status : null;
      const errCode = isRecord(error) && typeof error.code === 'string' ? error.code : null;
      if (
        errStatus === 503
        || errCode === 'ENOENT'
        || errCode === 'ECONNREFUSED'
        || errCode === 'ECONNRESET'
        || errCode === 'EPIPE'
        || errCode === 'ETIMEDOUT'
      ) {
        throw new CuBrokerUnavailableError(`Computer-use broker is unavailable: ${errorMessage(error)}`);
      }
      throw error;
    }
  }

  async function mintClaimFile(
    brokerSessionId: string,
    sessionSecret: string,
    requireRebind: boolean,
  ): Promise<{ ok: true; claimFile: string } | { ok: false; status: number; code: string | null; message: string }> {
    const reply = await requestBrokerOrUnavailable('POST', '/v1/lease/claim-nonce', {
      sessionId: brokerSessionId,
      sessionSecret,
      bindTimeoutSec: CLAIM_BIND_TIMEOUT_SEC,
      requireRebind,
    });
    if (reply.status === 200 && isRecord(reply.body)) {
      const claimFile = pickString(reply.body, 'claimFile');
      // Deliberately discard reply.body.claimNonce — never log, store, or pass it.
      if (!claimFile) {
        return { ok: false, status: 502, code: 'missing_claim_file', message: 'cu-broker did not return a claimFile path' };
      }
      return { ok: true, claimFile };
    }
    const body = isRecord(reply.body) ? reply.body : {};
    return {
      ok: false,
      status: reply.status >= 400 ? reply.status : 502,
      code: pickString(body, 'code'),
      message: pickString(body, 'message') ?? pickString(body, 'error') ?? `cu-broker claim-nonce failed (${reply.status})`,
    };
  }

  async function prepareSpawn(
    options: { knownSessionId?: string | null; isRestart?: boolean },
  ): Promise<CuAgentSpawnHandle | null> {
    if (stopped || !ports.broker.configured()) return null;
    if (!ports.broker.available()) {
      throw new CuBrokerUnavailableError('Computer-use broker is unavailable');
    }

    const knownSessionId = typeof options.knownSessionId === 'string' && options.knownSessionId.trim()
      ? options.knownSessionId.trim()
      : null;

    if (options.isRestart && knownSessionId) {
      const existing = recordForSessionId(knownSessionId);
      if (existing && existing.hasBrokerLease && (existing.status === 'holding' || existing.status === 'preempted')) {
        if (existing.sessionSecret) {
          const claim = await mintClaimFile(existing.brokerSessionId, existing.sessionSecret, true);
          if (claim.ok) {
            existing.rebindInProgress = true;
            existing.reboundNewProcess = false;
            return {
              brokerSessionId: existing.brokerSessionId,
              leaseOwnerId: existing.leaseOwnerId,
              env: Object.freeze({
                CU_BROKER_SESSION_ID: existing.brokerSessionId,
                CU_BROKER_CLAIM_FILE: claim.claimFile,
                CU_BROKER_LABEL: BROKER_AGENT_LABEL,
              }),
              waitingForDesktop: false,
              reusedExisting: true,
              acquiredEpoch: existing.epoch,
            };
          }
          if (claim.status === 409 && (claim.code === 'lease_not_found' || claim.code === 'not_agent_lease')) {
            removeRecord(existing);
          } else {
            throw httpError(claim.message, claim.status);
          }
        } else {
          // Re-adopted record without sessionSecret: release/cancel old verified owner, then acquire fresh lease.
          await releaseRecord(existing);
        }
      }
    }

    const leaseOwnerId = `cu-owner-${crypto.randomBytes(16).toString('hex')}`;
    const brokerSessionId = `cu-agent-${crypto.randomUUID()}`;
    const reply = await requestBrokerOrUnavailable('POST', '/v1/lease/acquire', {
      holderKind: 'agent',
      sessionId: brokerSessionId,
      ownerId: leaseOwnerId,
      label: BROKER_AGENT_LABEL,
    });

    if (reply.status === 200 && isRecord(reply.body)) {
      const confirmedSessionId = pickString(reply.body, 'sessionId') ?? brokerSessionId;
      const sessionSecret = pickString(reply.body, 'sessionSecret') ?? pickString(reply.body, 'token');
      if (!sessionSecret) {
        throw httpError('cu-broker did not return an agent lease secret', 502);
      }
      const epoch = pickFiniteNumber(reply.body, 'epoch') ?? 0;
      const generation = pickString(reply.body, 'generation') ?? latestBrokerGeneration;
      const hbSec = pickFiniteNumber(reply.body, 'heartbeatIntervalSec');
      const leaseObj = isRecord(reply.body.lease) ? reply.body.lease : null;
      const leaseId = pickString(reply.body, 'leaseId') ?? (leaseObj ? pickString(leaseObj, 'leaseId') : null);

      let claim: { ok: true; claimFile: string } | { ok: false; status: number; code: string | null; message: string };
      try {
        claim = await mintClaimFile(confirmedSessionId, sessionSecret, false);
      } catch (claimError) {
        await ports.broker.requestJson('POST', '/v1/lease/release', {
          sessionId: confirmedSessionId,
          sessionSecret,
        }).catch(() => {});
        throw claimError;
      }
      if (!claim.ok) {
        // Compensate immediately so a failed claim-nonce never leaves an orphaned active lease.
        await ports.broker.requestJson('POST', '/v1/lease/release', {
          sessionId: confirmedSessionId,
          sessionSecret,
        }).catch(() => {});
        throw httpError(claim.message, claim.status);
      }

      const rec: ManagedLeaseRecord = {
        brokerSessionId: confirmedSessionId,
        leaseOwnerId,
        hasBrokerLease: true,
        createdAt: Date.now(),
        leaseId,
        sessionSecret,
        sessionId: knownSessionId,
        status: 'holding',
        epoch,
        generation,
        pid: null,
        pidStartTime: null,
        rebindInProgress: false,
        reboundNewProcess: false,
        adoptedWithoutSecret: false,
        pendingStartupReconcile: false,
        heartbeatTimer: null,
        heartbeatIntervalMs: resolveHeartbeatMs(hbSec),
        delivery: createDeliveryTracker(generation ?? 'default', 'unbound'),
      };
      recordsByBrokerId.set(confirmedSessionId, rec);
      recordsByOwnerId.set(leaseOwnerId, rec);
      if (knownSessionId) brokerIdBySessionId.set(knownSessionId, confirmedSessionId);
      if (generation) latestBrokerGeneration = generation;
      if (epoch >= latestBrokerEpoch) {
        latestBrokerEpoch = epoch;
        latestBrokerState = 'agent';
      }
      persistStore();
      startHeartbeat(rec);
      return {
        brokerSessionId: confirmedSessionId,
        leaseOwnerId,
        env: Object.freeze({
          CU_BROKER_SESSION_ID: confirmedSessionId,
          CU_BROKER_CLAIM_FILE: claim.claimFile,
          CU_BROKER_LABEL: BROKER_AGENT_LABEL,
        }),
        waitingForDesktop: false,
        reusedExisting: false,
        acquiredEpoch: epoch,
      };
    }

    if (reply.status === 409 && isRecord(reply.body)) {
      const leaseObj = isRecord(reply.body.lease) ? reply.body.lease : null;
      const busyState = pickString(reply.body, 'state')
        ?? (leaseObj && pickString(leaseObj, 'holderKind') === 'human' ? 'human' : null);
      const epoch = pickFiniteNumber(reply.body, 'epoch');
      const generation = pickString(reply.body, 'generation');
      if (generation) latestBrokerGeneration = generation;
      if (busyState === 'human') {
        // Human holds the desktop: spawn omp without a claim file or secret so
        // computer tools are blocked while the human works, and surface waiting_for_desktop.
        const rec: ManagedLeaseRecord = {
          brokerSessionId,
          leaseOwnerId: null,
          hasBrokerLease: false,
          createdAt: Date.now(),
          leaseId: null,
          sessionSecret: null,
          sessionId: knownSessionId,
          status: 'waiting_for_desktop',
          epoch: epoch ?? Math.max(0, latestBrokerEpoch),
          generation: generation ?? latestBrokerGeneration,
          pid: null,
          pidStartTime: null,
          rebindInProgress: false,
          reboundNewProcess: false,
          adoptedWithoutSecret: false,
          pendingStartupReconcile: false,
          heartbeatTimer: null,
          heartbeatIntervalMs: resolveHeartbeatMs(null),
          delivery: createDeliveryTracker(generation ?? latestBrokerGeneration ?? 'default', 'unbound'),
        };
        recordsByBrokerId.set(brokerSessionId, rec);
        if (knownSessionId) brokerIdBySessionId.set(knownSessionId, brokerSessionId);
        if (epoch !== null && epoch >= latestBrokerEpoch) {
          latestBrokerEpoch = epoch;
          latestBrokerState = 'human';
        }
        return {
          brokerSessionId,
          leaseOwnerId: null,
          env: Object.freeze({
            CU_BROKER_SESSION_ID: brokerSessionId,
            CU_BROKER_LABEL: BROKER_AGENT_LABEL,
          }),
          waitingForDesktop: true,
          reusedExisting: false,
          acquiredEpoch: null,
        };
      }
      const message = pickString(reply.body, 'message')
        ?? pickString(reply.body, 'error')
        ?? 'Computer-use desktop seat is held by another agent session';
      throw new CuSeatBusyError(message, {
        state: busyState,
        epoch,
        holder: sanitizeHolder(leaseObj ?? reply.body.holder),
      });
    }

    const message = isRecord(reply.body)
      ? (pickString(reply.body, 'message') ?? pickString(reply.body, 'error') ?? `cu-broker acquire failed (${reply.status})`)
      : `cu-broker acquire failed (${reply.status})`;
    throw httpError(message, reply.status >= 400 ? reply.status : 502);
  }

  async function bindSpawnedProcess(handle: CuAgentSpawnHandle, proc: CuBindProcessInfo | null): Promise<void> {
    const rec = recordsByBrokerId.get(handle.brokerSessionId);
    if (!rec) {
      if (handle.waitingForDesktop) return;
      throw httpError('Computer-use agent lease was lost before process bind', 409);
    }
    if (handle.waitingForDesktop) {
      if (proc && Number.isInteger(proc.pid) && proc.pid > 1 && proc.startTime) {
        rec.pid = proc.pid;
        rec.pidStartTime = proc.startTime;
        ensureLivenessMonitor();
      }
      return;
    }
    // Mark reboundNewProcess as soon as respawnPane returned (before bind I/O)
    // so abortSpawn cleans up if bind or registration subsequently fails.
    if (handle.reusedExisting) rec.reboundNewProcess = true;
    if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 1 || !proc.startTime) {
      rec.rebindInProgress = false;
      throw httpError('Could not verify spawned omp process identity for computer-use lease bind', 500);
    }
    if (!rec.sessionSecret || !rec.leaseOwnerId) {
      rec.rebindInProgress = false;
      throw httpError('Computer-use agent lease credentials are unavailable for bind', 409);
    }

    const previousBirth = processBirthKey(rec.pid, rec.pidStartTime);
    const nextBirth = processBirthKey(proc.pid, proc.startTime);
    rec.pid = proc.pid;
    rec.pidStartTime = proc.startTime;
    rec.rebindInProgress = false;
    if (previousBirth !== nextBirth) {
      resetRecordDelivery(rec, rec.generation ?? latestBrokerGeneration ?? 'default', nextBirth);
    }
    persistStore();
    ensureLivenessMonitor();

    const reply = await ports.broker.requestJson('POST', '/v1/lease/bind', {
      sessionId: rec.brokerSessionId,
      sessionSecret: rec.sessionSecret,
      ownerId: rec.leaseOwnerId,
      label: BROKER_AGENT_LABEL,
      pid: proc.pid,
      pidStartTime: formatPidStartTimeForBroker(proc.startTime),
    });
    if (reply.status !== 200 || !isRecord(reply.body)) {
      const body = isRecord(reply.body) ? reply.body : {};
      const message = pickString(body, 'message') ?? pickString(body, 'error') ?? `cu-broker lease bind failed (${reply.status})`;
      throw httpError(message, reply.status >= 400 ? reply.status : 502);
    }

    const ep = pickFiniteNumber(reply.body, 'epoch');
    const gen = pickString(reply.body, 'generation');
    const st = pickString(reply.body, 'state');
    const target = pickString(reply.body, 'target');
    if (ep !== null) rec.epoch = ep;
    if (gen) {
      rec.generation = gen;
      latestBrokerGeneration = gen;
      ensureDeliveryContext(rec, gen);
    }
    if (target === 'displaced' || st === 'human') {
      rec.status = 'preempted';
      scheduleCommand(rec, 'abort', rec.epoch, rec.generation ?? latestBrokerGeneration ?? 'default');
    } else {
      rec.status = 'holding';
    }
    persistStore();
  }

  function attachSpawnedSession(handle: CuAgentSpawnHandle, info: CuAttachSessionInfo): void {
    const rec = recordsByBrokerId.get(handle.brokerSessionId);
    if (!rec) return;
    if (rec.sessionId && rec.sessionId !== info.sessionId && brokerIdBySessionId.get(rec.sessionId) === rec.brokerSessionId) {
      brokerIdBySessionId.delete(rec.sessionId);
    }
    rec.sessionId = info.sessionId;
    brokerIdBySessionId.set(info.sessionId, rec.brokerSessionId);
    if (rec.pid === null && info.pid !== null && info.pidStartTime) {
      rec.pid = info.pid;
      rec.pidStartTime = info.pidStartTime;
      ensureDeliveryContext(rec, rec.generation ?? latestBrokerGeneration ?? 'default');
      ensureLivenessMonitor();
    }
    flushPendingCommands(rec);
  }

  async function abortSpawn(handle: CuAgentSpawnHandle): Promise<void> {
    const rec = recordsByBrokerId.get(handle.brokerSessionId);
    if (!rec) return;
    rec.rebindInProgress = false;
    if (handle.reusedExisting && !rec.reboundNewProcess) {
      // respawnPane failed before replacing the existing pane: preserve the live old pane's lease.
      return;
    }
    await releaseRecord(rec);
  }

  async function releaseSession(sessionId: string): Promise<void> {
    const rec = recordForSessionId(sessionId);
    if (!rec) return;
    await releaseRecord(rec);
  }

  function handleSessionRetired(sessionId: string): void {
    const rec = recordForSessionId(sessionId);
    if (!rec || rec.rebindInProgress) return;
    // Only release/cancel on bridge retirement if the OS process is actually gone.
    if (rec.pid !== null && rec.pidStartTime && processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
      return;
    }
    void releaseRecord(rec);
  }

  function adoptSessionSwitch(previousSessionId: string, nextSessionId: string): void {
    if (!previousSessionId || !nextSessionId || previousSessionId === nextSessionId) return;
    const rec = recordForSessionId(previousSessionId);
    if (!rec) return;
    if (brokerIdBySessionId.get(previousSessionId) === rec.brokerSessionId) {
      brokerIdBySessionId.delete(previousSessionId);
    }
    rec.sessionId = nextSessionId;
    brokerIdBySessionId.set(nextSessionId, rec.brokerSessionId);
  }

  function handleBrokerEvent(event: CuBrokerEvent): void {
    if (stopped) return;
    const { eventName, authoritativeHello, payload } = event;
    const state = pickString(payload, 'state');
    const epoch = pickFiniteNumber(payload, 'epoch');
    if (state === null || epoch === null) return;

    const generation = event.generation ?? pickString(payload, 'generation');
    const isResync = event.isResync === true || eventName === 'resync';
    const generationChanged = event.generationChanged === true
      || (generation !== null && latestBrokerGeneration !== null && generation !== latestBrokerGeneration);

    if (generationChanged || isResync || (authoritativeHello && epoch < latestBrokerEpoch)) {
      resetAllWatermarks(generation);
    } else {
      if (generation !== null && latestBrokerGeneration === null) {
        latestBrokerGeneration = generation;
      }
      if (!authoritativeHello && epoch < latestBrokerEpoch) return;
    }

    latestBrokerEpoch = epoch;
    latestBrokerState = state;
    const effectiveGen = generation ?? latestBrokerGeneration ?? 'default';

    if (authoritativeHello && !reconciled) {
      void reconcile();
    }

    const reason = pickString(payload, 'reason');
    const leaseRef = extractRef(payload.lease);
    const preemptedRef = extractRef(payload.displaced)
      ?? extractRef(payload.preempted)
      ?? (eventName === 'preempted'
        ? { ownerId: pickString(payload, 'ownerId'), sessionId: pickString(payload, 'sessionId'), leaseId: null }
        : null);
    const handBackRef = extractRef(payload.handedBackTo) ?? leaseRef;

    let storeDirty = false;

    const isPreemptSignal = eventName === 'preempted'
      || (state === 'human' && preemptedRef !== null);
    if (isPreemptSignal && preemptedRef) {
      const rec = findRecordForRef(preemptedRef);
      if (rec && rec.hasBrokerLease) {
        rec.status = 'preempted';
        rec.epoch = epoch;
        if (generation) rec.generation = generation;
        storeDirty = true;
        scheduleCommand(rec, 'abort', epoch, effectiveGen);
      }
    }

    const explicitHandBack = eventName === 'hand_back'
      || (eventName === 'lease_changed' && reason === 'hand_back');
    if (explicitHandBack && handBackRef) {
      const rec = findRecordForRef(handBackRef);
      if (rec && rec.hasBrokerLease) {
        rec.status = 'holding';
        rec.epoch = epoch;
        if (generation) rec.generation = generation;
        storeDirty = true;
        scheduleCommand(rec, 'nudge', epoch, effectiveGen);
      }
    } else if ((eventName === 'hello' || isResync) && state === 'agent' && leaseRef) {
      // Reconnect/resync recovery: if hand_back occurred while SSE was down or lagged, nudge once.
      const rec = findRecordForRef(leaseRef);
      if (rec && rec.hasBrokerLease && rec.status === 'preempted') {
        rec.status = 'holding';
        rec.epoch = epoch;
        if (generation) rec.generation = generation;
        storeDirty = true;
        scheduleCommand(rec, 'nudge', epoch, effectiveGen);
      }
    }

    if (state === 'idle') {
      for (const rec of [...recordsByBrokerId.values()]) {
        if (rec.pendingStartupReconcile) continue;
        if (rec.status === 'waiting_for_desktop') {
          removeRecord(rec, { persist: false });
        } else if ((rec.status === 'holding' || rec.status === 'preempted') && (authoritativeHello || isResync || epoch >= rec.epoch)) {
          const wasHolding = rec.status === 'holding';
          const unexpectedLoss = wasHolding && (reason === 'ttl_expired' || reason === 'hard_cap_expired');
          clearHeartbeat(rec);
          rec.sessionSecret = null;
          rec.status = 'idle';
          rec.epoch = epoch;
          if (generation) rec.generation = generation;
          storeDirty = true;
          if (unexpectedLoss) {
            scheduleCommand(rec, 'abort', epoch, effectiveGen);
          } else {
            removeRecord(rec, { persist: false });
          }
        }
      }
      if (storeDirty) persistStore();
      return;
    }

    if (state === 'agent' || state === 'waiting_for_human') {
      for (const rec of [...recordsByBrokerId.values()]) {
        if (rec.pendingStartupReconcile) continue;
        if (refMatchesRecord(leaseRef, rec)) {
          rec.status = 'holding';
          rec.epoch = epoch;
          if (generation) rec.generation = generation;
        } else if (rec.status === 'waiting_for_desktop') {
          removeRecord(rec, { persist: false });
        } else if ((rec.status === 'holding' || rec.status === 'preempted') && (authoritativeHello || isResync || epoch > rec.epoch)) {
          removeRecord(rec, { persist: false });
          storeDirty = true;
        }
      }
      if (storeDirty) persistStore();
      return;
    }

    if (state === 'human') {
      for (const rec of [...recordsByBrokerId.values()]) {
        if (rec.pendingStartupReconcile || !rec.hasBrokerLease) continue;
        if (refMatchesRecord(preemptedRef, rec)) continue;
        if ((rec.status === 'holding' || rec.status === 'preempted') && (authoritativeHello || isResync || epoch >= rec.epoch)) {
          // Broker is in human state without this record in preempted (e.g. preempted_cancelled / preempted_reaped).
          removeRecord(rec, { persist: false });
          storeDirty = true;
        }
      }
      if (storeDirty) persistStore();
    }
  }

  function ownerIdForSession(sessionId: string): string | null {
    const rec = recordForSessionId(sessionId);
    if (!rec || !rec.hasBrokerLease || !rec.leaseOwnerId) return null;
    if (rec.status !== 'holding' && rec.status !== 'preempted') return null;
    if (rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
      return null;
    }
    return rec.leaseOwnerId;
  }

  function isWaitingForDesktop(sessionId: string): boolean {
    const rec = recordForSessionId(sessionId);
    if (!rec || rec.status !== 'waiting_for_desktop') return false;
    return latestBrokerState === null || latestBrokerState === 'human';
  }

  function getSessionSeatState(sessionId: string): 'waiting_for_desktop' | null {
    return isWaitingForDesktop(sessionId) ? 'waiting_for_desktop' : null;
  }

  function stop(): void {
    stopped = true;
    if (livenessTimer) {
      clearInterval(livenessTimer);
      livenessTimer = null;
    }
    for (const rec of recordsByBrokerId.values()) {
      clearHeartbeat(rec);
      clearDeliveryTimers(rec.delivery);
    }
  }

  loadPersistedStore();

  return {
    configured: () => !stopped && ports.broker.configured(),
    available: () => !stopped && ports.broker.available(),
    reconcile,
    prepareSpawn,
    bindSpawnedProcess,
    attachSpawnedSession,
    abortSpawn,
    releaseSession,
    handleSessionRetired,
    adoptSessionSwitch,
    handleBrokerEvent,
    ownerIdForSession,
    isWaitingForDesktop,
    getSessionSeatState,
    stop,
  };
}
