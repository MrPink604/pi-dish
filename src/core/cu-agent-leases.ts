/**
 * Guest-side computer-use agent lease lifecycle for managed `omp` sessions.
 *
 * Acquires an agent lease from `cu-broker` (`control.sock`) before launching
 * `omp`, supplies `CU_BROKER_SESSION_ID`, `CU_BROKER_SESSION_SECRET`, and
 * `CU_BROKER_LABEL` to the child process environment, binds the exact pi-dish
 * session ID (`~sk1_...`) upon bridge registration, keeps the lease alive via
 * heartbeats, aborts on preemption and resumes on `hand_back` idempotently by
 * broker epoch, and releases the lease when the session ends or closes.
 *
 * Secret hygiene: `sessionSecret` lives strictly in this module's private
 * in-memory map and the spawned child's process environment. It is never
 * persisted to disk, logged, returned in HTTP/SSE payloads, or written to any
 * session transcript.
 */
import crypto = require('node:crypto');
import type { CuBrokerClient } from './cu-broker';
import { errorMessage, httpError } from './http-boundary';
import { record as isRecord } from './helper-values';
import { processIdentityAlive } from './process-identity';
import { routeIdentity, routeSessionId } from './session-ownership';

export const CU_HAND_BACK_NUDGE =
  'The desktop has been returned to you after human take-over. Inspect the current screen and browser state before continuing.';

const MAX_BROKER_LABEL_CHARS = 160;
const DEFAULT_AGENT_HEARTBEAT_SEC = 20;
const DEFAULT_LIVENESS_CHECK_MS = 2_000;
const MAX_WATERMARKS = 256;

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

export interface CuBrokerEvent {
  readonly eventName: string;
  readonly authoritativeHello: boolean;
  readonly payload: Record<string, unknown>;
}

export interface CuAgentSpawnHandle {
  readonly brokerSessionId: string;
  readonly env: Readonly<Record<string, string>>;
  readonly waitingForDesktop: boolean;
  readonly reusedExisting: boolean;
  readonly acquiredEpoch: number | null;
}

export interface CuBindSpawnedSession {
  readonly sessionId: string;
  readonly pid: number | null;
  readonly pidStartTime: string | null;
}

export interface CuAgentLeasesPorts {
  readonly broker: CuBrokerClient;
  abortSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string, nudgeText: string): Promise<void>;
  /** Optional check for post-restart fallback matching on live managed OMP sessions. */
  isLiveManagedSession?(sessionId: string): boolean;
  /** Emits a normalized snapshot to connected `/api/cu/stream` clients after post-spawn label binding. */
  onLabelBound?(snapshot: Record<string, unknown>): void;
  /** Optional test seam overriding agent heartbeat interval in milliseconds. */
  heartbeatIntervalMs?: number;
  /** Optional test seam overriding dead-PID liveness check interval in milliseconds. */
  livenessCheckMs?: number;
  log?: (message: string) => void;
}

export interface CuAgentLeases {
  available(): boolean;
  prepareSpawn(options: { knownSessionId?: string | null; isRestart?: boolean }): Promise<CuAgentSpawnHandle | null>;
  bindSpawnedSession(handle: CuAgentSpawnHandle, info: CuBindSpawnedSession): Promise<void>;
  abortSpawn(handle: CuAgentSpawnHandle): Promise<void>;
  releaseSession(sessionId: string): Promise<void>;
  handleSessionRetired(sessionId: string): void;
  adoptSessionSwitch(previousSessionId: string, nextSessionId: string): void;
  handleBrokerEvent(event: CuBrokerEvent): void;
  normalizePublicPayload<T>(payload: T): T;
  isWaitingForDesktop(sessionId: string): boolean;
  getSessionSeatState(sessionId: string): 'waiting_for_desktop' | null;
  stop(): void;
}

interface ManagedLeaseRecord {
  readonly brokerSessionId: string;
  sessionSecret: string | null;
  sessionId: string | null;
  brokerLabel: string;
  status: ManagedLeaseStatus;
  epoch: number;
  pid: number | null;
  pidStartTime: string | null;
  heartbeatTimer: NodeJS.Timeout | null;
  heartbeatIntervalMs: number;
  pendingAbortEpoch: number | null;
  pendingResumeEpoch: number | null;
}

interface EpochWatermark {
  lastAbortedEpoch: number;
  lastResumedEpoch: number;
}

interface BrokerRef {
  readonly sessionId: string | null;
  readonly label: string | null;
}

function pickString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function pickFiniteNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function truncateBrokerLabel(value: string): string {
  return value.slice(0, MAX_BROKER_LABEL_CHARS);
}

function extractRef(value: unknown): BrokerRef | null {
  if (!isRecord(value)) return null;
  const sessionId = pickString(value, 'sessionId') ?? pickString(value, 'leaseId');
  const label = pickString(value, 'label');
  if (!sessionId && !label) return null;
  return { sessionId, label };
}

function sanitizeHolder(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === 'sessionSecret' || key === 'tokenHash' || key === 'leaseToken' || key === 'token') continue;
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

export function createCuAgentLeases(ports: CuAgentLeasesPorts): CuAgentLeases {
  const log = ports.log ?? ((line: string) => console.error(line));
  const livenessCheckMs = ports.livenessCheckMs
    ?? optionalEnvMs('PI_DISH_CU_LIVENESS_MS', 25)
    ?? DEFAULT_LIVENESS_CHECK_MS;

  const recordsByBrokerId = new Map<string, ManagedLeaseRecord>();
  const brokerIdBySessionId = new Map<string, string>();
  const watermarks = new Map<string, EpochWatermark>();

  let stopped = false;
  let latestBrokerState: string | null = null;
  let latestBrokerEpoch = -1;
  let livenessTimer: NodeJS.Timeout | null = null;

  function watermarkFor(key: string): EpochWatermark {
    let entry = watermarks.get(key);
    if (!entry) {
      while (watermarks.size >= MAX_WATERMARKS) {
        const oldest = watermarks.keys().next().value;
        if (oldest === undefined) break;
        watermarks.delete(oldest);
      }
      entry = { lastAbortedEpoch: -1, lastResumedEpoch: -1 };
      watermarks.set(key, entry);
    }
    return entry;
  }

  function clearHeartbeat(rec: ManagedLeaseRecord): void {
    if (rec.heartbeatTimer) {
      clearInterval(rec.heartbeatTimer);
      rec.heartbeatTimer = null;
    }
  }

  function removeRecord(rec: ManagedLeaseRecord): void {
    clearHeartbeat(rec);
    rec.sessionSecret = null;
    recordsByBrokerId.delete(rec.brokerSessionId);
    if (rec.sessionId && brokerIdBySessionId.get(rec.sessionId) === rec.brokerSessionId) {
      brokerIdBySessionId.delete(rec.sessionId);
    }
    maybeStopLivenessMonitor();
  }

  function maybeStopLivenessMonitor(): void {
    if (!livenessTimer) return;
    for (const rec of recordsByBrokerId.values()) {
      if (rec.pid !== null && (rec.status === 'holding' || rec.status === 'preempted' || rec.status === 'waiting_for_desktop')) {
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
        if (rec.pid === null || !rec.pidStartTime) continue;
        if (processIdentityAlive({ pid: rec.pid, startTime: rec.pidStartTime })) continue;
        if (rec.sessionId) void releaseSession(rec.sessionId);
        else void releaseRecord(rec);
      }
      maybeStopLivenessMonitor();
    }, livenessCheckMs);
    livenessTimer.unref();
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
      if (rec.pid !== null && rec.pidStartTime && !processIdentityAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
        if (rec.sessionId) void releaseSession(rec.sessionId);
        else void releaseRecord(rec);
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
        if (ep !== null && ep >= rec.epoch) rec.epoch = ep;
        return;
      }
      if (reply.status === 409 && isRecord(reply.body)) {
        const code = pickString(reply.body, 'code');
        const ep = pickFiniteNumber(reply.body, 'epoch');
        if (code === 'lease_preempted') {
          rec.status = 'preempted';
          if (ep !== null && ep >= rec.epoch) rec.epoch = ep;
          // Retain sessionSecret so hand_back resumes seamlessly.
          return;
        }
        if (code === 'lease_lost') {
          clearHeartbeat(rec);
          rec.sessionSecret = null;
          rec.status = 'idle';
        }
      }
    } catch {
      // Transient broker hiccup: retry on the next heartbeat interval.
    }
  }

  async function releaseRecord(rec: ManagedLeaseRecord): Promise<void> {
    const secret = rec.sessionSecret;
    const brokerSessionId = rec.brokerSessionId;
    removeRecord(rec);
    if (!secret || !ports.broker.available()) return;
    try {
      await ports.broker.requestJson('POST', '/v1/lease/release', {
        sessionId: brokerSessionId,
        sessionSecret: secret,
      });
    } catch (error) {
      log(`[cu-lease] release failed for ${brokerSessionId}: ${errorMessage(error)}`);
    }
  }

  function resolveHeartbeatMs(brokerIntervalSec: number | null): number {
    if (ports.heartbeatIntervalMs !== undefined) return ports.heartbeatIntervalMs;
    const sec = brokerIntervalSec !== null && brokerIntervalSec >= 5 ? brokerIntervalSec : DEFAULT_AGENT_HEARTBEAT_SEC;
    return sec * 1000;
  }

  function refMatchesRecord(ref: BrokerRef | null, rec: ManagedLeaseRecord): boolean {
    if (!ref) return false;
    if (ref.sessionId && ref.sessionId === rec.brokerSessionId) return true;
    if (rec.sessionId) {
      const exactLabel = truncateBrokerLabel(rec.sessionId);
      if (ref.sessionId === rec.sessionId || ref.label === exactLabel || ref.label === rec.sessionId) return true;
    }
    return false;
  }

  function findRecordForRef(ref: BrokerRef | null): ManagedLeaseRecord | null {
    if (!ref) return null;
    if (ref.sessionId) {
      const direct = recordsByBrokerId.get(ref.sessionId);
      if (direct) return direct;
      const bySid = brokerIdBySessionId.get(ref.sessionId);
      if (bySid) {
        const mapped = recordsByBrokerId.get(bySid);
        if (mapped) return mapped;
      }
    }
    for (const rec of recordsByBrokerId.values()) {
      if (refMatchesRecord(ref, rec)) return rec;
    }
    return null;
  }

  function fallbackRouteIdForRef(ref: BrokerRef | null): string | null {
    if (!ref || !ports.isLiveManagedSession) return null;
    for (const candidate of [ref.label, ref.sessionId]) {
      if (!candidate) continue;
      const identity = routeIdentity(candidate);
      if (!identity || identity.harnessId !== 'omp') continue;
      const canonical = routeSessionId(identity.harnessId, identity.nativeSessionId);
      if (ports.isLiveManagedSession(canonical)) return canonical;
    }
    return null;
  }

  function triggerAbortOnce(sessionId: string, epoch: number): void {
    const wm = watermarkFor(sessionId);
    if (epoch <= wm.lastAbortedEpoch) return;
    wm.lastAbortedEpoch = epoch;
    void ports.abortSession(sessionId).catch(error => {
      log(`[cu-lease] abort failed for ${sessionId} at epoch ${epoch}: ${errorMessage(error)}`);
    });
  }

  function triggerResumeOnce(sessionId: string, epoch: number): void {
    const wm = watermarkFor(sessionId);
    if (epoch <= wm.lastResumedEpoch) return;
    wm.lastResumedEpoch = epoch;
    void ports.resumeSession(sessionId, CU_HAND_BACK_NUDGE).catch(error => {
      log(`[cu-lease] hand-back resume failed for ${sessionId} at epoch ${epoch}: ${errorMessage(error)}`);
    });
  }

  async function prepareSpawn(
    options: { knownSessionId?: string | null; isRestart?: boolean },
  ): Promise<CuAgentSpawnHandle | null> {
    if (stopped || !ports.broker.available()) return null;
    const knownSessionId = typeof options.knownSessionId === 'string' && options.knownSessionId.trim()
      ? options.knownSessionId.trim()
      : null;

    if (knownSessionId) {
      const existingBrokerId = brokerIdBySessionId.get(knownSessionId);
      const existing = existingBrokerId ? recordsByBrokerId.get(existingBrokerId) : undefined;
      if (existing && existing.sessionSecret && (existing.status === 'holding' || existing.status === 'preempted')) {
        const label = truncateBrokerLabel(knownSessionId);
        return {
          brokerSessionId: existing.brokerSessionId,
          env: Object.freeze({
            CU_BROKER_SESSION_ID: existing.brokerSessionId,
            CU_BROKER_SESSION_SECRET: existing.sessionSecret,
            CU_BROKER_LABEL: label,
          }),
          waitingForDesktop: false,
          reusedExisting: true,
          acquiredEpoch: existing.epoch,
        };
      }
    }

    const brokerSessionId = knownSessionId || `omp-spawn-${crypto.randomUUID()}`;
    const initialLabel = truncateBrokerLabel(knownSessionId || brokerSessionId);
    const reply = await ports.broker.requestJson('POST', '/v1/lease/acquire', {
      holderKind: 'agent',
      sessionId: brokerSessionId,
      label: initialLabel,
    });

    if (reply.status === 200 && isRecord(reply.body)) {
      const confirmedSessionId = pickString(reply.body, 'sessionId') ?? brokerSessionId;
      const sessionSecret = pickString(reply.body, 'sessionSecret') ?? pickString(reply.body, 'token');
      if (!sessionSecret) {
        throw httpError('cu-broker did not return an agent lease secret', 502);
      }
      const epoch = pickFiniteNumber(reply.body, 'epoch') ?? 0;
      const hbSec = pickFiniteNumber(reply.body, 'heartbeatIntervalSec');
      const leaseObj = isRecord(reply.body.lease) ? reply.body.lease : null;
      const brokerLabel = (leaseObj ? pickString(leaseObj, 'label') : null) ?? initialLabel;
      const rec: ManagedLeaseRecord = {
        brokerSessionId: confirmedSessionId,
        sessionSecret,
        sessionId: knownSessionId,
        brokerLabel,
        status: 'holding',
        epoch,
        pid: null,
        pidStartTime: null,
        heartbeatTimer: null,
        heartbeatIntervalMs: resolveHeartbeatMs(hbSec),
        pendingAbortEpoch: null,
        pendingResumeEpoch: null,
      };
      recordsByBrokerId.set(confirmedSessionId, rec);
      if (knownSessionId) brokerIdBySessionId.set(knownSessionId, confirmedSessionId);
      if (epoch >= latestBrokerEpoch) {
        latestBrokerEpoch = epoch;
        latestBrokerState = 'agent';
      }
      startHeartbeat(rec);
      return {
        brokerSessionId: confirmedSessionId,
        env: Object.freeze({
          CU_BROKER_SESSION_ID: confirmedSessionId,
          CU_BROKER_SESSION_SECRET: sessionSecret,
          CU_BROKER_LABEL: brokerLabel,
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
      if (busyState === 'human') {
        // Human holds the desktop: still start omp, omit CU_BROKER_SESSION_SECRET
        // so the broker blocks computer tools until the human releases the seat,
        // and surface a clear waiting-for-desktop state.
        const rec: ManagedLeaseRecord = {
          brokerSessionId,
          sessionSecret: null,
          sessionId: knownSessionId,
          brokerLabel: initialLabel,
          status: 'waiting_for_desktop',
          epoch: epoch ?? Math.max(0, latestBrokerEpoch),
          pid: null,
          pidStartTime: null,
          heartbeatTimer: null,
          heartbeatIntervalMs: resolveHeartbeatMs(null),
          pendingAbortEpoch: null,
          pendingResumeEpoch: null,
        };
        recordsByBrokerId.set(brokerSessionId, rec);
        if (knownSessionId) brokerIdBySessionId.set(knownSessionId, brokerSessionId);
        if (epoch !== null && epoch >= latestBrokerEpoch) {
          latestBrokerEpoch = epoch;
          latestBrokerState = 'human';
        }
        return {
          brokerSessionId,
          env: Object.freeze({
            CU_BROKER_SESSION_ID: brokerSessionId,
            CU_BROKER_LABEL: initialLabel,
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

  async function bindSpawnedSession(handle: CuAgentSpawnHandle, info: CuBindSpawnedSession): Promise<void> {
    const rec = recordsByBrokerId.get(handle.brokerSessionId);
    if (!rec) return;
    if (rec.sessionId && rec.sessionId !== info.sessionId && brokerIdBySessionId.get(rec.sessionId) === rec.brokerSessionId) {
      brokerIdBySessionId.delete(rec.sessionId);
    }
    rec.sessionId = info.sessionId;
    rec.pid = info.pid;
    rec.pidStartTime = info.pidStartTime;
    brokerIdBySessionId.set(info.sessionId, rec.brokerSessionId);
    if (rec.pid !== null && rec.pidStartTime) ensureLivenessMonitor();

    const targetLabel = truncateBrokerLabel(info.sessionId);
    if (rec.sessionSecret && rec.status === 'holding' && (rec.brokerLabel !== targetLabel || rec.pid !== null)) {
      const pidStart = rec.pidStartTime !== null && /^\d+$/.test(rec.pidStartTime)
        ? Number(rec.pidStartTime)
        : undefined;
      try {
        const reply = await ports.broker.requestJson('POST', '/v1/lease/acquire', {
          holderKind: 'agent',
          sessionId: rec.brokerSessionId,
          sessionSecret: rec.sessionSecret,
          label: targetLabel,
          ...(rec.pid !== null ? { pid: rec.pid, ...(pidStart !== undefined ? { pidStartTime: pidStart } : {}) } : {}),
        });
        if (reply.status === 200 && isRecord(reply.body) && isRecord(reply.body.lease)) {
          const updatedLabel = pickString(reply.body.lease, 'label');
          if (updatedLabel) rec.brokerLabel = updatedLabel;
          // If the guest cu-broker is still Slice 1 (does not mutate label on
          // idempotent refresh), push a normalized lease_changed frame so live
          // browsers immediately match `lease.label === session.id`.
          if (rec.brokerLabel !== targetLabel && ports.onLabelBound) {
            const snapshot = normalizePublicPayload({
              state: pickString(reply.body, 'state') ?? 'agent',
              epoch: pickFiniteNumber(reply.body, 'epoch') ?? rec.epoch,
              lease: reply.body.lease,
              preempted: null,
              reason: 'label_bound',
            });
            ports.onLabelBound(snapshot);
          }
        }
      } catch (error) {
        log(`[cu-lease] post-spawn bind failed for ${info.sessionId}: ${errorMessage(error)}`);
      }
    }

    if (rec.pendingAbortEpoch !== null && rec.status === 'preempted') {
      const pending = rec.pendingAbortEpoch;
      rec.pendingAbortEpoch = null;
      triggerAbortOnce(info.sessionId, pending);
    } else if (rec.pendingResumeEpoch !== null && rec.status === 'holding') {
      const pending = rec.pendingResumeEpoch;
      rec.pendingResumeEpoch = null;
      triggerResumeOnce(info.sessionId, pending);
    }
  }

  async function abortSpawn(handle: CuAgentSpawnHandle): Promise<void> {
    if (handle.reusedExisting) return;
    const rec = recordsByBrokerId.get(handle.brokerSessionId);
    if (!rec) return;
    await releaseRecord(rec);
  }

  async function releaseSession(sessionId: string): Promise<void> {
    const brokerSessionId = brokerIdBySessionId.get(sessionId);
    if (!brokerSessionId) return;
    const rec = recordsByBrokerId.get(brokerSessionId);
    if (!rec) {
      brokerIdBySessionId.delete(sessionId);
      return;
    }
    await releaseRecord(rec);
  }

  function handleSessionRetired(sessionId: string): void {
    const brokerSessionId = brokerIdBySessionId.get(sessionId);
    if (!brokerSessionId) return;
    const rec = recordsByBrokerId.get(brokerSessionId);
    if (!rec) {
      brokerIdBySessionId.delete(sessionId);
      return;
    }
    // Only release on bridge retirement if the OS process is actually gone.
    if (rec.pid !== null && rec.pidStartTime && processIdentityAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
      return;
    }
    void releaseRecord(rec);
  }

  function adoptSessionSwitch(previousSessionId: string, nextSessionId: string): void {
    if (!previousSessionId || !nextSessionId || previousSessionId === nextSessionId) return;
    const brokerSessionId = brokerIdBySessionId.get(previousSessionId);
    if (!brokerSessionId) return;
    const rec = recordsByBrokerId.get(brokerSessionId);
    if (!rec) return;
    brokerIdBySessionId.delete(previousSessionId);
    rec.sessionId = nextSessionId;
    brokerIdBySessionId.set(nextSessionId, brokerSessionId);
    const prevWm = watermarks.get(previousSessionId);
    if (prevWm) {
      watermarks.set(nextSessionId, { ...prevWm });
    }
    const targetLabel = truncateBrokerLabel(nextSessionId);
    if (rec.sessionSecret && rec.status === 'holding') {
      void ports.broker.requestJson('POST', '/v1/lease/acquire', {
        holderKind: 'agent',
        sessionId: rec.brokerSessionId,
        sessionSecret: rec.sessionSecret,
        label: targetLabel,
      }).then(reply => {
        if (reply.status === 200 && isRecord(reply.body) && isRecord(reply.body.lease)) {
          const updated = pickString(reply.body.lease, 'label');
          if (updated) rec.brokerLabel = updated;
          if (rec.brokerLabel !== targetLabel && ports.onLabelBound) {
            ports.onLabelBound(normalizePublicPayload({
              state: pickString(reply.body, 'state') ?? 'agent',
              epoch: pickFiniteNumber(reply.body, 'epoch') ?? rec.epoch,
              lease: reply.body.lease,
              preempted: null,
              reason: 'label_bound',
            }));
          }
        }
      }).catch(() => {});
    }
  }

  function handleBrokerEvent(event: CuBrokerEvent): void {
    if (stopped) return;
    const { eventName, authoritativeHello, payload } = event;
    const state = pickString(payload, 'state');
    const epoch = pickFiniteNumber(payload, 'epoch');
    if (state === null || epoch === null) return;

    if (!authoritativeHello && epoch < latestBrokerEpoch) return;
    if (authoritativeHello && epoch < latestBrokerEpoch) {
      // Broker restarted with a reset epoch counter: clear stale epoch watermarks.
      watermarks.clear();
    }
    latestBrokerEpoch = epoch;
    latestBrokerState = state;

    const reason = pickString(payload, 'reason');
    const leaseRef = extractRef(payload.lease);
    const preemptedRef = extractRef(payload.displaced)
      ?? extractRef(payload.preempted)
      ?? (eventName === 'preempted' ? { sessionId: pickString(payload, 'sessionId'), label: null } : null);
    const handBackRef = extractRef(payload.handedBackTo) ?? leaseRef;

    const isPreemptSignal = eventName === 'preempted'
      || (state === 'human' && preemptedRef !== null);
    if (isPreemptSignal && preemptedRef) {
      const rec = findRecordForRef(preemptedRef);
      if (rec && rec.status !== 'waiting_for_desktop') {
        rec.status = 'preempted';
        rec.epoch = epoch;
        rec.pendingResumeEpoch = null;
        if (rec.sessionId) triggerAbortOnce(rec.sessionId, epoch);
        else rec.pendingAbortEpoch = epoch;
      } else if (!rec) {
        const fallback = fallbackRouteIdForRef(preemptedRef);
        if (fallback) triggerAbortOnce(fallback, epoch);
      }
    }

    const explicitHandBack = eventName === 'hand_back'
      || (eventName === 'lease_changed' && reason === 'hand_back');
    if (explicitHandBack && handBackRef) {
      const rec = findRecordForRef(handBackRef);
      if (rec) {
        rec.status = 'holding';
        rec.epoch = epoch;
        rec.pendingAbortEpoch = null;
        if (rec.sessionId) triggerResumeOnce(rec.sessionId, epoch);
        else rec.pendingResumeEpoch = epoch;
      } else {
        const fallback = fallbackRouteIdForRef(handBackRef);
        if (fallback) triggerResumeOnce(fallback, epoch);
      }
    } else if (eventName === 'hello' && state === 'agent' && leaseRef) {
      // Reconnect recovery: if hand_back happened while SSE was down, resume once.
      const rec = findRecordForRef(leaseRef);
      if (rec && rec.status === 'preempted') {
        const wmKey = rec.sessionId ?? rec.brokerSessionId;
        const wm = watermarkFor(wmKey);
        if (epoch > wm.lastAbortedEpoch) {
          rec.status = 'holding';
          rec.epoch = epoch;
          rec.pendingAbortEpoch = null;
          if (rec.sessionId) triggerResumeOnce(rec.sessionId, epoch);
          else rec.pendingResumeEpoch = epoch;
        }
      }
    }

    if (state === 'idle') {
      for (const rec of recordsByBrokerId.values()) {
        if (rec.status === 'waiting_for_desktop') {
          rec.status = 'idle';
          rec.epoch = epoch;
        } else if ((rec.status === 'holding' || rec.status === 'preempted') && (authoritativeHello || epoch >= rec.epoch)) {
          clearHeartbeat(rec);
          rec.sessionSecret = null;
          rec.status = 'idle';
          rec.epoch = epoch;
          rec.pendingAbortEpoch = null;
          rec.pendingResumeEpoch = null;
        }
      }
      return;
    }

    if (state === 'agent' || state === 'waiting_for_human') {
      for (const rec of recordsByBrokerId.values()) {
        if (refMatchesRecord(leaseRef, rec)) {
          rec.status = 'holding';
          rec.epoch = epoch;
        } else if (rec.status === 'waiting_for_desktop') {
          rec.status = 'idle';
          rec.epoch = epoch;
        } else if (rec.status === 'holding' && (authoritativeHello || epoch > rec.epoch)) {
          clearHeartbeat(rec);
          rec.sessionSecret = null;
          rec.status = 'idle';
          rec.epoch = epoch;
        }
      }
    }
  }

  function normalizeLeaseObject(value: unknown): unknown {
    if (!isRecord(value)) return value;
    let changed = false;
    const out: Record<string, unknown> = { ...value };
    if ('sessionSecret' in out) { delete out.sessionSecret; changed = true; }
    if ('tokenHash' in out) { delete out.tokenHash; changed = true; }
    const holderKind = pickString(out, 'holderKind');
    if (holderKind !== 'human') {
      const ref = extractRef(out);
      const rec = findRecordForRef(ref);
      if (rec?.sessionId) {
        const targetLabel = truncateBrokerLabel(rec.sessionId);
        if (out.label !== targetLabel) {
          out.label = targetLabel;
          changed = true;
        }
      }
    }
    return changed ? out : value;
  }

  function normalizePublicPayload<T>(payload: T): T {
    if (!isRecord(payload)) return payload;
    let changed = false;
    const out: Record<string, unknown> = { ...payload };
    if ('sessionSecret' in out) { delete out.sessionSecret; changed = true; }
    if ('tokenHash' in out) { delete out.tokenHash; changed = true; }
    for (const key of ['lease', 'preempted', 'handedBackTo', 'displaced', 'previous', 'released', 'holder'] as const) {
      if (key in out && isRecord(out[key])) {
        const normalized = normalizeLeaseObject(out[key]);
        if (normalized !== out[key]) {
          out[key] = normalized;
          changed = true;
        }
      }
    }
    for (const listKey of ['entries', 'events'] as const) {
      const list = out[listKey];
      if (!Array.isArray(list)) continue;
      let listChanged = false;
      const sanitized = list.map((item: unknown) => {
        if (!isRecord(item) || (!('sessionSecret' in item) && !('tokenHash' in item))) return item;
        listChanged = true;
        const copy: Record<string, unknown> = { ...item };
        delete copy.sessionSecret;
        delete copy.tokenHash;
        return copy;
      });
      if (listChanged) {
        out[listKey] = sanitized;
        changed = true;
      }
    }
    return (changed ? out : payload) as T;
  }

  function isWaitingForDesktop(sessionId: string): boolean {
    const brokerSessionId = brokerIdBySessionId.get(sessionId);
    if (!brokerSessionId) return false;
    const rec = recordsByBrokerId.get(brokerSessionId);
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
    }
  }

  return {
    available: () => !stopped && ports.broker.available(),
    prepareSpawn,
    bindSpawnedSession,
    abortSpawn,
    releaseSession,
    handleSessionRetired,
    adoptSessionSwitch,
    handleBrokerEvent,
    normalizePublicPayload,
    isWaitingForDesktop,
    getSessionSeatState,
    stop,
  };
}
