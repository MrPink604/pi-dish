/**
 * Guest-side computer-use agent lease lifecycle for managed `omp` sessions.
 *
 * Security & durability contract (Slice 2, §9 of docs/computer-use-integration.md):
 * - Feature-detects Slice 2 via the §9.1 `capabilities` array BEFORE any
 *   broker mutation: a responding Slice-1 broker keeps legacy launch behavior,
 *   while an unreachable configured broker fails closed with 503.
 * - Zero secrets or nonces ever enter tmux argv/env, child process env, logs,
 *   HTTP/SSE responses, or persisted stores. Only `CU_BROKER_SESSION_ID`,
 *   `CU_BROKER_CLAIM_FILE`, and non-identifying `CU_BROKER_LABEL` (`"omp"`)
 *   are passed to the spawned `omp` pane; `/usr/local/bin/cua-driver-mcp`
 *   redeems the one-use `claimFile` over `agent.sock` under `SO_PEERCRED` +
 *   process-lineage + binary verification.
 * - `sessionSecret` lives strictly in private Node heap memory for authenticated
 *   control-plane calls (`bind`, `claim-nonce`, `heartbeat`, `release`,
 *   `cancel-preempted`). Secretless/re-adopted records NEVER issue `force: true`
 *   mutations; broker TTL/PID reaping handles secretless cleanup.
 * - Busy seats (human or agent) fail closed with typed `409 seat_busy` — never
 *   spawning an unleased pane. Managed restarts stop the old pane, release/cancel
 *   its authenticated lease, and perform a fresh acquire+claim+bind.
 * - A durable NON-SECRET record (`cu-agent-leases.json`, 0600) persists
 *   `leaseOwnerId`, `brokerSessionId`, `leaseId`, `epoch`, `generation`, and
 *   `(pid, pidStartTime)`. After a pi-dish restart, re-adoption is strictly for
 *   routing abort/nudge to a live, already-claimed MCP peer; sessions with no
 *   live claimed peer (or whose lease expired) surface `desktop access lost —
 *   restart session` honestly without pi-dish heartbeating or renewing them.
 * - One `(generation, cursor, epoch)` ordering rule governs HTTP replies,
 *   reconciliation, and watcher snapshots so stale replies never undo newer
 *   transitions. Commands require a proved OS birth `(pid, pidStartTime)`.
 */
import crypto = require('node:crypto');
import fs = require('node:fs');
import path = require('node:path');
import type { CuBrokerClient } from './cu-broker';
import { dishDir, replaceFileDurably } from './dish-store';
import { errorMessage, errorStatus, httpError } from './http-boundary';
import { record as isRecord } from './helper-values';
import { processIdentity, processIdentityAlive } from './process-identity';

export const CU_HAND_BACK_NUDGE =
  'Desktop control has been returned to you. You can continue your task.';

export const BROKER_AGENT_LABEL = 'omp';

export const REQUIRED_SLICE2_CAPABILITIES = [
  'bind',
  'cancel_preempted',
  'ordered_sse',
  'claim_handoff',
] as const;

export const SLICE2B_CAPABILITIES = {
  bindTransfer: 'bind_transfer',
  ownerMatch: 'owner_match',
  leaseRenew: 'lease_renew',
  claimReclaim: 'claim_reclaim',
  deferredClaim: 'deferred_claim',
} as const;

const DEFAULT_AGENT_HEARTBEAT_SEC = 20;
const DEFAULT_LIVENESS_CHECK_MS = 2_000;
const DEFAULT_COMMAND_RETRY_MS = 200;
const MAX_COMMAND_RETRIES = 6;
const CLAIM_BIND_TIMEOUT_SEC = 30;
const MAX_TRANSIENT_BROKER_RETRIES = 2;
const LEASE_STORE_VERSION = 1;
const LEASE_STORE_FILENAME = 'cu-agent-leases.json';
const MAX_STORE_BYTES = 256 * 1024;
const SECRET_KEYS = new Set(['sessionSecret', 'tokenHash', 'leaseToken', 'token', 'claimNonce', 'mcpToken']);
const TRANSPORT_ERROR_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EAGAIN', 'ENOTSOCK']);
const RETRYABLE_BROKER_CODES = new Set([
  'broker_shutting_down',
  'broker_busy',
  'worker_exit_unconfirmed',
  'state_persist_failed',
  'claim_file_error',
  'connection_limit',
  'sse_capacity',
]);

export type ManagedLeaseStatus = 'checking' | 'holding' | 'preempted' | 'access_lost' | 'idle';

export interface CuBrokerCapabilities {
  readonly slice2: boolean;
  readonly bindTransfer: boolean;
  readonly ownerMatch: boolean;
  readonly leaseRenew: boolean;
}

export interface CuSeatBusyDetails {
  readonly state: string | null;
  readonly epoch: number | null;
  readonly holder: Record<string, unknown> | null;
}

/** Structured 409 error raised when another agent or human holds the CU seat. */
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

export interface CuBrokerUnavailableDetails {
  readonly code?: string;
  readonly brokerCode?: string | null;
  readonly retryable?: boolean;
  readonly applied?: boolean | 'unknown' | null;
  readonly uncertain?: boolean;
  readonly retryAfterMs?: number | null;
}

/** Structured 503 error raised when a CU host's configured broker socket is unreachable, shutting down, busy, or uncertain. */
export class CuBrokerUnavailableError extends Error {
  readonly status = 503;
  readonly code: string;
  readonly brokerCode: string | null;
  readonly retryable: boolean;
  readonly applied: boolean | 'unknown' | null;
  readonly uncertain: boolean;
  readonly retryAfterMs: number | null;

  constructor(message = 'Computer-use broker is unavailable', details: CuBrokerUnavailableDetails = {}) {
    super(message);
    this.name = 'CuBrokerUnavailableError';
    const brokerCode = details.brokerCode ?? null;
    const applied = details.applied ?? null;
    const uncertain = details.uncertain ?? (applied === 'unknown');
    this.brokerCode = brokerCode;
    this.applied = applied;
    this.uncertain = uncertain;
    this.code = details.code
      ?? (brokerCode === 'broker_shutting_down'
        ? 'broker_shutting_down'
        : uncertain
          ? 'cu_broker_uncertain'
          : 'cu_broker_unavailable');
    this.retryable = details.retryable ?? (brokerCode === null || RETRYABLE_BROKER_CODES.has(brokerCode));
    this.retryAfterMs = details.retryAfterMs ?? null;
  }
}

/** Internal pre-respawn signal indicating no active/displaced lease is available to transfer in place. */
export class CuTransferUnavailableError extends Error {
  readonly status = 409;
  readonly code = 'cu_transfer_unavailable' as const;

  constructor(message = 'Computer-use lease is not transferable in place') {
    super(message);
    this.name = 'CuTransferUnavailableError';
  }
}

/** Structured retryable 409 error raised when a CU session's lease is still being verified by startup reconcile. */
export class CuLeaseCheckingError extends Error {
  readonly status = 409;
  readonly code = 'cu_checking' as const;
  readonly retryable = true as const;

  constructor(message = 'Computer-use desktop access is still being verified after restart; retry shortly') {
    super(message);
    this.name = 'CuLeaseCheckingError';
  }
}

export function cuBrokerUnavailableResponseFields(error: CuBrokerUnavailableError): {
  code: string;
  retryable: boolean;
  brokerCode?: string;
  applied?: boolean | 'unknown';
  uncertain?: true;
  retryAfterMs?: number;
} {
  return {
    code: error.code,
    retryable: error.retryable,
    ...(error.brokerCode ? { brokerCode: error.brokerCode } : {}),
    ...(error.applied !== null ? { applied: error.applied } : {}),
    ...(error.uncertain ? { uncertain: true as const } : {}),
    ...(error.retryAfterMs !== null ? { retryAfterMs: error.retryAfterMs } : {}),
  };
}

export interface CuBrokerEvent {
  readonly eventName: string;
  readonly eventId?: string | null;
  readonly authoritativeHello: boolean;
  readonly isResync?: boolean;
  readonly resyncReason?: string | null;
  readonly resumeStatus?: string | null;
  readonly generation?: string | null;
  readonly cursor?: number | null;
  readonly generationChanged?: boolean;
  readonly payload: Record<string, unknown>;
}

export interface CuTransferHandleDetails {
  readonly claimId: string;
  readonly expectedEpoch: number | null;
  readonly expectedPid: number;
  readonly expectedPidStartTime: string;
}

export interface CuAgentSpawnHandle {
  readonly brokerSessionId: string;
  readonly leaseOwnerId: string;
  readonly env: Readonly<Record<string, string>>;
  readonly acquiredEpoch: number;
  readonly transfer?: CuTransferHandleDetails;
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
  readonly pid: number;
  readonly pidStartTime: string;
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
  /** Maps a surviving OS process birth back to its unique live canonical pi-dish route sessionId (null if absent/ambiguous). */
  findSessionIdByProcess?(process: { readonly pid: number; readonly startTime: string }): string | null;
  /** Optional test seam overriding the durable non-secret store path. */
  storeFile?: () => string;
  /** Optional test seam overriding agent heartbeat interval in milliseconds. */
  heartbeatIntervalMs?: number;
  /** Optional test seam overriding dead-PID liveness check interval in milliseconds. */
  livenessCheckMs?: number;
  /** Optional test seam overriding command retry delay in milliseconds. */
  commandRetryMs?: number;
  /** Optional test seam overriding OS process birth liveness verification. */
  processAlive?: (identity: { readonly pid: number; readonly startTime: string }) => boolean;
  /** Optional test seam overriding claimed MCP peer PID liveness check. */
  pidAlive?: (pid: number) => boolean;
  log?: (message: string) => void;
}

export interface CuAgentLeases {
  configured(): boolean;
  available(): boolean;
  /** Probes §9.1 capabilities before mutation. Returns false on non-CU or Slice-1 broker; throws 503 if configured broker is unreachable. */
  supportsSlice2(): Promise<boolean>;
  /** Probes Slice-2 and Slice-2b capabilities before mutation; throws 503 if configured broker is unreachable. */
  probeCapabilities(): Promise<CuBrokerCapabilities>;
  /** True when the session holds an authenticated active/displaced lease and the broker advertises `bind_transfer`. */
  canTransferSession(sessionId: string): boolean;
  reconcile(): Promise<void>;
  prepareSpawn(options: { knownSessionId?: string | null; assumeSlice2?: boolean }): Promise<CuAgentSpawnHandle | null>;
  prepareTransfer(options: { sessionId: string; expectedPid?: number | null; expectedPidStartTime?: string | null }): Promise<CuAgentSpawnHandle | null>;
  bindSpawnedProcess(handle: CuAgentSpawnHandle, process: CuBindProcessInfo | null): Promise<void>;
  attachSpawnedSession(handle: CuAgentSpawnHandle, info: CuAttachSessionInfo): void;
  abortSpawn(handle: CuAgentSpawnHandle): Promise<void>;
  releaseSession(sessionId: string): Promise<void>;
  handleSessionRetired(sessionId: string): void;
  adoptSessionSwitch(previousSessionId: string, nextSessionId: string): void;
  handleBrokerEvent(event: CuBrokerEvent): void;
  ownerIdForSession(sessionId: string): string | null;
  isDesktopAccessLost(sessionId: string): boolean;
  isDesktopChecking(sessionId: string): boolean;
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
  readonly leaseOwnerId: string;
  readonly createdAt: number;
  leaseId: string | null;
  sessionSecret: string | null;
  sessionId: string | null;
  status: ManagedLeaseStatus;
  epoch: number;
  lastCursor: number;
  generation: string | null;
  pid: number | null;
  pidStartTime: string | null;
  adoptedWithoutSecret: boolean;
  reAdopted: boolean;
  pendingStartupReconcile: boolean;
  pendingTransferClaimId: string | null;
  heartbeatTimer: NodeJS.Timeout | null;
  heartbeatIntervalMs: number;
  delivery: DeliveryTracker;
}

interface BrokerRef {
  readonly ownerId: string | null;
}

interface BrokerPosition {
  readonly generation: string | null;
  readonly cursor: number | null;
  readonly epoch: number | null;
}

function pickString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function pickFiniteNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function pickNonNegInt(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
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

export function extractCapabilities(body: unknown): Set<string> {
  if (!isRecord(body) || !Array.isArray(body.capabilities)) return new Set();
  return new Set(body.capabilities.filter((item): item is string => typeof item === 'string'));
}

export function hasSlice2Capabilities(body: unknown): boolean {
  const caps = extractCapabilities(body);
  return REQUIRED_SLICE2_CAPABILITIES.every(cap => caps.has(cap));
}

function parseBrokerApplied(body: Record<string, unknown>): boolean | 'unknown' | null {
  if (body.applied === 'unknown') return 'unknown';
  if (typeof body.applied === 'boolean') return body.applied;
  return null;
}

function boundedRetryDelay(rawRetryAfterMs: number | null): Promise<void> {
  const delayMs = Math.min(400, Math.max(10, rawRetryAfterMs ?? 100));
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref();
  });
}

function extractRef(value: unknown): BrokerRef | null {
  if (!isRecord(value)) return null;
  const ownerId = pickString(value, 'ownerId');
  return ownerId ? { ownerId } : null;
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
  return pid !== null && pid > 1 && startTime ? `${pid}:${startTime}` : 'unbound';
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
  const pidAlive = ports.pidAlive ?? ((pid: number) => processIdentity(pid) !== null);
  const livenessCheckMs = ports.livenessCheckMs
    ?? optionalEnvMs('PI_DISH_CU_LIVENESS_MS', 25)
    ?? DEFAULT_LIVENESS_CHECK_MS;
  const commandRetryMs = ports.commandRetryMs ?? DEFAULT_COMMAND_RETRY_MS;

  interface TransferState {
    aborted: boolean;
    committed: boolean;
    readonly originalPid: number;
    readonly originalPidStartTime: string;
    replacementPid: number | null;
    replacementPidStartTime: string | null;
  }

  const recordsByBrokerId = new Map<string, ManagedLeaseRecord>();
  const recordsByOwnerId = new Map<string, ManagedLeaseRecord>();
  const brokerIdBySessionId = new Map<string, string>();
  const transferStates = new WeakMap<CuAgentSpawnHandle, TransferState>();

  let stopped = false;
  let reconciled = false;
  let reconcileFlight: Promise<void> | null = null;
  let advertisedCapabilities: Set<string> | null = null;
  let knownGeneration: string | null = null;
  let knownCursor = -1;
  let knownEpoch = -1;
  let lastResyncHandledKey: string | null = null;
  let livenessTimer: NodeJS.Timeout | null = null;

  function recordCapabilities(body: unknown): void {
    if (!isRecord(body)) return;
    if (Array.isArray(body.capabilities)) {
      advertisedCapabilities = extractCapabilities(body);
    } else if (!('capabilities' in body)) {
      advertisedCapabilities = new Set();
    }
  }

  function hasCap(cap: string): boolean {
    return advertisedCapabilities?.has(cap) === true;
  }

  function hasLiveClaimedPeer(obj: Record<string, unknown> | null): boolean {
    if (!obj || obj.mcpClaimed !== true) return false;
    const claimedPid = pickFiniteNumber(obj, 'claimedPid');
    if (claimedPid === null || claimedPid <= 1) return false;
    const claimedPeer = isRecord(obj.claimedPeer) ? obj.claimedPeer : null;
    const claimedStart = claimedPeer ? pickPidStartTime(claimedPeer, 'pidStartTime') : null;
    if (claimedStart !== null) {
      return processAlive({ pid: claimedPid, startTime: claimedStart });
    }
    return pidAlive(claimedPid);
  }

  /**
   * True when the broker reports that a bound lease (outside any staged transfer)
   * lost its claimed MCP peer and has no usable claim or reclaim path left.
   */
  function hasLostUsableClaimOrPeer(
    rec: ManagedLeaseRecord,
    obj: Record<string, unknown> | null,
    reason: string | null,
  ): boolean {
    if (rec.pendingTransferClaimId !== null) return false;
    if (obj && obj.stagedTransfer === true) return false;
    if (rec.pid === null || rec.pid <= 1 || !rec.pidStartTime) return false;
    if (reason === 'acquired') return false;

    if (reason === 'claimed_peer_reaped' || reason === 'claim_expired') {
      if (obj && (hasLiveClaimedPeer(obj) || obj.pendingClaim === true || obj.allowReclaim === true)) {
        return false;
      }
      return true;
    }

    if (obj && typeof obj.pendingClaim === 'boolean') {
      const peerLive = hasLiveClaimedPeer(obj);
      const hasPending = obj.pendingClaim === true;
      const reclaimEnabled = obj.allowReclaim === true;
      if (!peerLive && !hasPending && !reclaimEnabled) {
        return true;
      }
    }
    return false;
  }

  /**
   * Marks a live session `access_lost` (stopping heartbeats while keeping the local
   * record so `isDesktopAccessLost()` remains true) and releases/cancels the broker
   * seat via pure `owner_match` (never `force: true`) so the seat frees promptly.
   */
  function markAccessLostAndRelease(
    rec: ManagedLeaseRecord,
    initialTarget: 'active' | 'displaced',
    epoch: number | null,
  ): Promise<void> {
    const {
      brokerSessionId,
      leaseOwnerId,
      pid,
      pidStartTime,
    } = rec;
    const effectiveEpoch = epoch !== null && epoch >= 1 ? epoch : (rec.epoch >= 1 ? rec.epoch : null);
    markAccessLost(rec);
    if (!ports.broker.available() || !hasCap(SLICE2B_CAPABILITIES.ownerMatch)) {
      return Promise.resolve();
    }
    return ownerMatchedReleaseOrCancel({
      brokerSessionId,
      leaseOwnerId,
      sessionSecret: null,
      pid,
      pidStartTime,
      epoch: effectiveEpoch,
      initialTarget,
    }).catch(error => {
      log(`[cu-lease] owner-matched access_lost release failed for ${leaseOwnerId}: ${errorMessage(error)}`);
    });
  }

  /**
   * Single ordering rule for HTTP replies, reconciliation snapshots, and SSE events.
   * Within a generation, `cursor` is the total order (§9.1); `epoch` breaks ties or
   * serves as fallback when a reply omits `cursor`.
   */
  function comparePosition(
    incoming: BrokerPosition,
    options: { allowNewGeneration?: boolean; sourceGeneration?: string | null } = {},
  ): 'stale' | 'same' | 'newer' | 'new_generation' {
    if (incoming.generation !== null && knownGeneration !== null && incoming.generation !== knownGeneration) {
      if (options.sourceGeneration && incoming.generation === options.sourceGeneration) {
        // Known state already moved to a newer generation while this HTTP request was in flight.
        return 'stale';
      }
      return options.allowNewGeneration ? 'new_generation' : 'stale';
    }
    if (incoming.cursor !== null && knownCursor >= 0) {
      if (incoming.cursor < knownCursor) return 'stale';
      if (incoming.cursor > knownCursor) return 'newer';
      if (incoming.epoch !== null && knownEpoch >= 0) {
        if (incoming.epoch < knownEpoch) return 'stale';
        if (incoming.epoch > knownEpoch) return 'newer';
      }
      return 'same';
    }
    if (incoming.epoch !== null && knownEpoch >= 0) {
      if (incoming.epoch < knownEpoch) return 'stale';
      if (incoming.epoch > knownEpoch) return 'newer';
      return 'same';
    }
    return 'newer';
  }

  function advanceGlobalPosition(incoming: BrokerPosition, resetForNewGeneration: boolean): void {
    if (resetForNewGeneration) {
      knownGeneration = incoming.generation;
      knownCursor = incoming.cursor ?? -1;
      knownEpoch = incoming.epoch ?? -1;
      return;
    }
    if (incoming.generation !== null && knownGeneration === null) {
      knownGeneration = incoming.generation;
    }
    if (incoming.cursor !== null && incoming.cursor > knownCursor) {
      knownCursor = incoming.cursor;
    }
    if (incoming.epoch !== null && incoming.epoch > knownEpoch) {
      knownEpoch = incoming.epoch;
    }
  }

  function isRecordObservationStale(rec: ManagedLeaseRecord, incoming: BrokerPosition): boolean {
    if (incoming.generation !== null && rec.generation !== null && incoming.generation !== rec.generation) {
      return false;
    }
    if (incoming.cursor !== null && rec.lastCursor >= 0 && incoming.cursor < rec.lastCursor) {
      return true;
    }
    if (incoming.epoch !== null && incoming.epoch < rec.epoch) {
      return true;
    }
    return false;
  }

  function updateRecordPosition(rec: ManagedLeaseRecord, incoming: BrokerPosition): void {
    const genChanged = incoming.generation !== null && rec.generation !== null && incoming.generation !== rec.generation;
    if (genChanged) {
      rec.generation = incoming.generation;
      rec.lastCursor = incoming.cursor ?? -1;
      if (incoming.epoch !== null) rec.epoch = incoming.epoch;
      return;
    }
    if (incoming.generation !== null) rec.generation = incoming.generation;
    if (incoming.cursor !== null && incoming.cursor > rec.lastCursor) rec.lastCursor = incoming.cursor;
    if (incoming.epoch !== null && incoming.epoch >= rec.epoch) rec.epoch = incoming.epoch;
  }

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
          createdAt: persisted.createdAt,
          leaseId: persisted.leaseId,
          sessionSecret: null,
          sessionId: null,
          status: 'checking',
          epoch: persisted.epoch,
          lastCursor: -1,
          generation: persisted.generation,
          pid: persisted.pid,
          pidStartTime: persisted.pidStartTime,
          adoptedWithoutSecret: true,
          reAdopted: true,
          pendingStartupReconcile: true,
          pendingTransferClaimId: null,
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
    for (const rec of recordsByBrokerId.values()) {
      if (rec.status !== 'checking' && rec.status !== 'holding' && rec.status !== 'preempted' && rec.status !== 'access_lost') continue;
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

  function markAccessLost(rec: ManagedLeaseRecord): void {
    clearHeartbeat(rec);
    rec.sessionSecret = null;
    rec.status = 'access_lost';
  }

  function removeRecord(rec: ManagedLeaseRecord, options: { persist?: boolean } = {}): void {
    clearHeartbeat(rec);
    clearDeliveryTimers(rec.delivery);
    rec.sessionSecret = null;
    recordsByBrokerId.delete(rec.brokerSessionId);
    if (recordsByOwnerId.get(rec.leaseOwnerId) === rec) {
      recordsByOwnerId.delete(rec.leaseOwnerId);
    }
    if (rec.sessionId && brokerIdBySessionId.get(rec.sessionId) === rec.brokerSessionId) {
      brokerIdBySessionId.delete(rec.sessionId);
    }
    maybeStopLivenessMonitor();
    if (options.persist !== false) {
      persistStore();
    }
  }

  function maybeStopLivenessMonitor(): void {
    if (!livenessTimer) return;
    for (const rec of recordsByBrokerId.values()) {
      if (rec.pid !== null && rec.pidStartTime && (rec.status === 'checking' || rec.status === 'holding' || rec.status === 'preempted' || rec.status === 'access_lost')) {
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
        if (rec.pendingStartupReconcile || rec.pendingTransferClaimId !== null) continue;
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
    if (rec.pid !== null && rec.pid > 1 && rec.pidStartTime && ports.findSessionIdByProcess) {
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

  function resetAllWatermarksForNewGeneration(nextGeneration: string | null): void {
    knownEpoch = -1;
    knownCursor = -1;
    lastResyncHandledKey = null;
    if (nextGeneration !== null) knownGeneration = nextGeneration;
    for (const rec of recordsByBrokerId.values()) {
      const gen = nextGeneration ?? rec.generation ?? 'default';
      if (nextGeneration !== null) rec.generation = nextGeneration;
      rec.epoch = -1;
      rec.lastCursor = -1;
      resetRecordDelivery(rec, gen, processBirthKey(rec.pid, rec.pidStartTime));
    }
  }

  function scheduleCommand(
    rec: ManagedLeaseRecord,
    kind: 'abort' | 'nudge',
    epoch: number,
    generation: string,
  ): void {
    if (stopped) return;
    // P1-8: Never dispatch to an unbound record; birth must be proved before delivery.
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
    targetPid: number,
    targetPidStartTime: string,
  ): boolean {
    if (stopped) return false;
    if (recordsByBrokerId.get(rec.brokerSessionId) !== rec) return false;
    if (rec.leaseOwnerId !== targetOwnerId) return false;
    if (rec.sessionId !== targetSessionId) return false;
    if (rec.delivery.generation !== targetGen) return false;
    if (rec.pid !== targetPid || rec.pidStartTime !== targetPidStartTime) return false;
    if (targetPid <= 1 || !targetPidStartTime || !processAlive({ pid: targetPid, startTime: targetPidStartTime })) {
      return false;
    }
    if (kind === 'abort') {
      // Abort is valid while preempted, access_lost, or idle — never after hand-back restored holding.
      return rec.status !== 'holding';
    }
    // Nudge is valid ONLY while this exact owner still holds the seat at this epoch.
    return rec.status === 'holding' && rec.epoch === targetEpoch;
  }

  async function flushCommand(rec: ManagedLeaseRecord, kind: 'abort' | 'nudge'): Promise<void> {
    if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) return;
    const tracker = rec.delivery;
    const targetEpoch = kind === 'abort' ? tracker.pendingAbortEpoch : tracker.pendingNudgeEpoch;
    if (targetEpoch === null) return;
    if (kind === 'abort' && tracker.inFlightAbortEpoch !== null) return;
    if (kind === 'nudge' && tracker.inFlightNudgeEpoch !== null) return;

    // P1-8: Refuse dispatch until a real OS process birth `(pid, pidStartTime)` is proved.
    if (rec.pid === null || rec.pid <= 1 || !rec.pidStartTime) {
      return;
    }
    const targetPid = rec.pid;
    const targetPidStartTime = rec.pidStartTime;

    const sessionId = resolveSessionIdForRecord(rec);
    if (!sessionId) {
      // Bridge not yet visible (or ambiguous descendant match -> refused).
      // For re-adopted records (no attachSpawnedSession coming), schedule a bounded retry.
      if (rec.reAdopted || rec.adoptedWithoutSecret) {
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

      if (
        rec.status === 'idle'
        && rec.delivery.inFlightAbortEpoch === null
        && (rec.delivery.pendingAbortEpoch === null || rec.delivery.abortRetries > MAX_COMMAND_RETRIES)
      ) {
        removeRecord(rec, { persist: false });
      } else if (sameTracker) {
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
    if (stopped || !rec.sessionSecret || rec.adoptedWithoutSecret || rec.heartbeatIntervalMs <= 0) return;
    rec.heartbeatTimer = setInterval(() => {
      if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) {
        clearHeartbeat(rec);
        return;
      }
      if (!rec.sessionSecret || rec.adoptedWithoutSecret) {
        clearHeartbeat(rec);
        return;
      }
      if (rec.pendingTransferClaimId !== null) return;
      if (rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
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
    if (!secret || rec.adoptedWithoutSecret || stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) return;
    const sentGeneration = rec.generation;
    const sentEpoch = rec.epoch;
    const sentCursor = rec.lastCursor;
    try {
      const reply = await ports.broker.requestJson('POST', '/v1/lease/heartbeat', {
        sessionId: rec.brokerSessionId,
        sessionSecret: secret,
      });
      if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) return;
      const body = isRecord(reply.body) ? reply.body : {};
      const gen = pickString(body, 'generation');
      const cursor = pickNonNegInt(body, 'cursor');
      const ep = pickFiniteNumber(body, 'epoch');
      const pos: BrokerPosition = { generation: gen, cursor, epoch: ep };

      // P1-6: Single ordering rule — ignore delayed heartbeat replies older than known state.
      const order = comparePosition(pos, { allowNewGeneration: true, sourceGeneration: sentGeneration });
      if (order === 'stale' || isRecordObservationStale(rec, pos)) {
        return;
      }
      if (gen === null && cursor === null && ep === null) {
        // Unordered error reply (e.g. bare 403): ignore if record moved on while request was in flight.
        if (rec.generation !== sentGeneration || rec.epoch > sentEpoch || rec.lastCursor > sentCursor) {
          return;
        }
      }

      if (reply.status === 200 && isRecord(reply.body)) {
        advanceGlobalPosition(pos, order === 'new_generation');
        updateRecordPosition(rec, pos);
        return;
      }

      if (reply.status === 409) {
        const code = pickString(body, 'code');
        const effectiveGen = gen ?? rec.generation ?? knownGeneration ?? 'default';
        const effectiveEpoch = ep ?? Math.max(0, rec.epoch);
        if (order === 'new_generation') {
          resetAllWatermarksForNewGeneration(gen);
        }
        advanceGlobalPosition(pos, order === 'new_generation');
        updateRecordPosition(rec, { generation: effectiveGen, cursor, epoch: effectiveEpoch });
        if (code === 'lease_preempted') {
          rec.status = 'preempted';
          persistStore();
          scheduleCommand(rec, 'abort', rec.epoch, effectiveGen);
          return;
        }
        // Any other heartbeat 409 (lease_lost, etc.) must immediately abort and surface access_lost while alive.
        const stillAlive = rec.pid !== null && rec.pidStartTime !== null && processAlive({ pid: rec.pid, startTime: rec.pidStartTime });
        if (stillAlive) {
          markAccessLost(rec);
        } else {
          clearHeartbeat(rec);
          rec.sessionSecret = null;
          rec.status = 'idle';
        }
        persistStore();
        scheduleCommand(rec, 'abort', rec.epoch, effectiveGen);
        return;
      }

      if (reply.status === 403) {
        const effectiveGen = gen ?? rec.generation ?? knownGeneration ?? 'default';
        const stillAlive = rec.pid !== null && rec.pidStartTime !== null && processAlive({ pid: rec.pid, startTime: rec.pidStartTime });
        if (stillAlive) {
          markAccessLost(rec);
        } else {
          clearHeartbeat(rec);
          rec.sessionSecret = null;
          rec.status = 'idle';
        }
        persistStore();
        scheduleCommand(rec, 'abort', Math.max(0, rec.epoch), effectiveGen);
      }
    } catch {
      // Transient broker hiccup: retry on the next heartbeat interval.
    }
  }

  /** Strict full ownerId equality only (never falls back to weaker sessionId/leaseId). */
  function refMatchesRecord(ref: BrokerRef | null, rec: Pick<ManagedLeaseRecord, 'leaseOwnerId'>): boolean {
    return ref !== null && ref.ownerId !== null && ref.ownerId === rec.leaseOwnerId;
  }

  function findRecordForRef(ref: BrokerRef | null): ManagedLeaseRecord | null {
    if (!ref || ref.ownerId === null) return null;
    return recordsByOwnerId.get(ref.ownerId) ?? null;
  }

  function snapshotObjMatchesOwner(
    obj: unknown,
    ownerId: string,
    brokerSessionId: string,
  ): boolean {
    if (!isRecord(obj)) return false;
    return pickString(obj, 'ownerId') === ownerId && pickString(obj, 'sessionId') === brokerSessionId;
  }

  async function ownerMatchedReleaseOrCancel(params: {
    brokerSessionId: string;
    leaseOwnerId: string;
    sessionSecret: string | null;
    pid: number | null;
    pidStartTime: string | null;
    epoch: number | null;
    initialTarget: 'active' | 'displaced';
  }): Promise<void> {
    if (!ports.broker.available()) return;
    let target: 'active' | 'displaced' = params.initialTarget;
    let attemptEpoch: number | null = params.epoch !== null && params.epoch >= 1 ? params.epoch : null;
    let switchedTarget = false;
    let retriedEpoch = false;
    let transientRetries = 0;

    for (let step = 0; step < 6; step++) {
      if (stopped) return;
      const endpoint = target === 'displaced' ? '/v1/lease/cancel-preempted' : '/v1/lease/release';
      const payload: Record<string, unknown> = {
        ownerId: params.leaseOwnerId,
        sessionId: params.brokerSessionId,
        expectedState: target === 'displaced' ? 'displaced' : 'active',
      };
      if (params.sessionSecret) {
        payload.sessionSecret = params.sessionSecret;
      }
      if (params.pid !== null && params.pid > 1 && params.pidStartTime) {
        payload.expectedPid = params.pid;
        payload.expectedPidStartTime = formatPidStartTimeForBroker(params.pidStartTime);
      }
      if (attemptEpoch !== null && attemptEpoch >= 1) {
        payload.expectedEpoch = attemptEpoch;
      }

      const reply = await ports.broker.requestJson('POST', endpoint, payload);
      if (reply.status === 200) return;

      const body = isRecord(reply.body) ? reply.body : {};
      const code = pickString(body, 'code');

      if (reply.status === 409) {
        const conflictEpoch = pickFiniteNumber(body, 'epoch');
        const conflictState = pickString(body, 'state');
        const activeMatchesUs = conflictState !== 'human'
          && (!isRecord(body.lease) || pickString(body.lease, 'holderKind') !== 'human')
          && snapshotObjMatchesOwner(body.lease, params.leaseOwnerId, params.brokerSessionId);
        const displacedMatchesUs = snapshotObjMatchesOwner(body.preempted, params.leaseOwnerId, params.brokerSessionId);

        if (target === 'active' && (code === 'lease_preempted' || (code === 'state_mismatch' && displacedMatchesUs)) && !switchedTarget) {
          switchedTarget = true;
          target = 'displaced';
          attemptEpoch = conflictEpoch !== null && conflictEpoch >= 1 ? conflictEpoch : null;
          continue;
        }
        if (target === 'displaced' && (code === 'lease_active' || (code === 'state_mismatch' && activeMatchesUs)) && !switchedTarget) {
          switchedTarget = true;
          target = 'active';
          attemptEpoch = conflictEpoch !== null && conflictEpoch >= 1 ? conflictEpoch : null;
          continue;
        }
        if (code === 'epoch_mismatch' && !retriedEpoch && conflictEpoch !== null && conflictEpoch >= 1) {
          retriedEpoch = true;
          if (activeMatchesUs) {
            target = 'active';
            attemptEpoch = conflictEpoch;
            continue;
          }
          if (displacedMatchesUs) {
            target = 'displaced';
            attemptEpoch = conflictEpoch;
            continue;
          }
          return;
        }
        if (target === 'active' && code === 'transition_pending') {
          // Broker leftover tolerance: release can answer 409 transition_pending after
          // reaping the seat to idle while stopping workers are still exiting.
          if (conflictState === 'idle' || (conflictState !== null && !activeMatchesUs && !displacedMatchesUs)) {
            return;
          }
          if (transientRetries < MAX_TRANSIENT_BROKER_RETRIES) {
            transientRetries += 1;
            await boundedRetryDelay(pickNonNegInt(body, 'retryAfterMs'));
            continue;
          }
          return;
        }
        // owner_mismatch, state_mismatch, lease_mismatch, pid_mismatch, lease_not_found,
        // no_preempted_lease: never force-release a lease we cannot prove we own.
        return;
      }

      if (reply.status === 503) {
        if (
          (code === 'worker_exit_unconfirmed' || code === 'state_persist_failed' || code === 'broker_busy')
          && transientRetries < MAX_TRANSIENT_BROKER_RETRIES
        ) {
          transientRetries += 1;
          await boundedRetryDelay(pickNonNegInt(body, 'retryAfterMs'));
          continue;
        }
        return;
      }

      // 403 / 400 / other: stop cleanly, never escalate to force:true.
      return;
    }
  }

  async function releaseRecord(rec: ManagedLeaseRecord): Promise<void> {
    const {
      brokerSessionId,
      leaseOwnerId,
      status,
      sessionSecret,
      pid,
      pidStartTime,
      epoch,
    } = rec;
    removeRecord(rec, { persist: true });
    if (status === 'idle' || status === 'access_lost') {
      return;
    }
    if (!ports.broker.available()) {
      return;
    }
    const useOwnerMatch = hasCap(SLICE2B_CAPABILITIES.ownerMatch);
    // P1-2: Without broker owner_match, never issue force:true mutations for secretless
    // / re-adopted records — leave cleanup to broker TTL/PID reaping.
    if (!useOwnerMatch && !sessionSecret) {
      return;
    }
    try {
      if (useOwnerMatch) {
        await ownerMatchedReleaseOrCancel({
          brokerSessionId,
          leaseOwnerId,
          sessionSecret,
          pid,
          pidStartTime,
          epoch: epoch >= 1 ? epoch : null,
          initialTarget: status === 'preempted' ? 'displaced' : 'active',
        });
        return;
      }
      if (!sessionSecret) return;
      if (status === 'preempted') {
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
        return;
      }
      const relReply = await ports.broker.requestJson('POST', '/v1/lease/release', {
        sessionId: brokerSessionId,
        sessionSecret,
      });
      if (relReply.status === 403) {
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
    } catch (error) {
      log(`[cu-lease] release/cancel failed for ${leaseOwnerId}: ${errorMessage(error)}`);
    }
  }

  async function requestBrokerOrUnavailable(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    try {
      const reply = await ports.broker.requestJson(method, endpoint, body);
      if (reply.status === 502 || reply.status === 503 || reply.status === 504) {
        const resBody = isRecord(reply.body) ? reply.body : {};
        const brokerCode = pickString(resBody, 'code');
        const applied = parseBrokerApplied(resBody);
        const retryAfterMs = pickNonNegInt(resBody, 'retryAfterMs');
        const uncertain = applied === 'unknown';
        const defaultMsg = uncertain
          ? 'Computer-use broker request outcome is uncertain (may have been applied)'
          : brokerCode === 'broker_shutting_down'
            ? 'Computer-use broker is shutting down; retry shortly'
            : 'Computer-use broker is unavailable';
        const msg = pickString(resBody, 'message') ?? pickString(resBody, 'error') ?? defaultMsg;
        throw new CuBrokerUnavailableError(msg, {
          brokerCode,
          applied,
          uncertain,
          retryAfterMs,
          retryable: uncertain || brokerCode === null || RETRYABLE_BROKER_CODES.has(brokerCode),
        });
      }
      return reply;
    } catch (error) {
      if (error instanceof CuBrokerUnavailableError) throw error;
      const errHttpStatus = errorStatus(error, 0);
      const errCode = isRecord(error) && typeof error.code === 'string' ? error.code : null;
      if (
        errHttpStatus === 502
        || errHttpStatus === 503
        || errHttpStatus === 504
        || (errCode !== null && TRANSPORT_ERROR_CODES.has(errCode))
      ) {
        throw new CuBrokerUnavailableError(`Computer-use broker is unavailable: ${errorMessage(error)}`, {
          retryable: true,
        });
      }
      throw error;
    }
  }

  /**
   * P1-4 + Slice 2b: Feature-detect Slice 2 & Slice 2b via `capabilities` BEFORE any mutation.
   * - Unconfigured host -> all false (non-CU host).
   * - Configured but missing/unreachable/timing-out socket -> throws CuBrokerUnavailableError (503 fail-closed).
   * - Responding Slice-1 broker (missing required Slice-2 capabilities) -> slice2: false (legacy launch preserved).
   * - Responding Slice-2 / Slice-2b broker -> reports each advertised capability individually.
   */
  async function probeCapabilities(): Promise<CuBrokerCapabilities> {
    if (stopped || !ports.broker.configured()) {
      return { slice2: false, bindTransfer: false, ownerMatch: false, leaseRenew: false };
    }
    if (!ports.broker.available()) {
      throw new CuBrokerUnavailableError('Computer-use broker is unavailable', { retryable: true });
    }
    const reply = await requestBrokerOrUnavailable('GET', '/v1/status');
    if (reply.status !== 200 || !isRecord(reply.body)) {
      throw new CuBrokerUnavailableError(`Computer-use broker status check failed (${reply.status})`);
    }
    recordCapabilities(reply.body);
    return {
      slice2: hasSlice2Capabilities(reply.body),
      bindTransfer: hasCap(SLICE2B_CAPABILITIES.bindTransfer),
      ownerMatch: hasCap(SLICE2B_CAPABILITIES.ownerMatch),
      leaseRenew: hasCap(SLICE2B_CAPABILITIES.leaseRenew),
    };
  }

  async function supportsSlice2(): Promise<boolean> {
    return (await probeCapabilities()).slice2;
  }

  async function renewAdoptedRecord(
    rec: ManagedLeaseRecord,
    initialEpoch: number,
    matchedObj: Record<string, unknown>,
  ): Promise<
    | { ok: true; body: Record<string, unknown>; sessionSecret: string }
    | { ok: false; reason: string; releaseOnFailure?: boolean; target?: 'active' | 'displaced'; epoch?: number | null }
  > {
    if (rec.pid === null || rec.pid <= 1 || !rec.pidStartTime) {
      return { ok: false, reason: 'missing_birth' };
    }
    let attemptEpoch: number | null = initialEpoch >= 1 ? initialEpoch : null;
    let retriedEpoch = false;
    let transientRetries = 0;

    for (let step = 0; step < 5; step++) {
      if (stopped) return { ok: false, reason: 'stopped' };
      const payload: Record<string, unknown> = {
        sessionId: rec.brokerSessionId,
        ownerId: rec.leaseOwnerId,
        pid: rec.pid,
        pidStartTime: formatPidStartTimeForBroker(rec.pidStartTime),
        issueClaim: false,
      };
      if (attemptEpoch !== null && attemptEpoch >= 1) {
        payload.expectedEpoch = attemptEpoch;
      }

      let reply: { status: number; body: unknown };
      try {
        reply = await ports.broker.requestJson('POST', '/v1/lease/renew', payload);
      } catch (error) {
        return { ok: false, reason: errorMessage(error) };
      }

      const body = isRecord(reply.body) ? reply.body : {};
      if (reply.status === 200) {
        const newSecret = pickString(body, 'sessionSecret') ?? pickString(body, 'token');
        if (!newSecret) {
          return { ok: false, reason: 'missing_session_secret' };
        }
        const renewTarget = pickString(body, 'target');
        const renewState = pickString(body, 'state');
        const targetKind: 'active' | 'displaced' = renewTarget === 'displaced' || renewState === 'human' ? 'displaced' : 'active';
        const renewEpoch = pickFiniteNumber(body, 'epoch') ?? attemptEpoch;
        const renewObj = targetKind === 'displaced'
          ? (isRecord(body.preempted) ? body.preempted : matchedObj)
          : (isRecord(body.lease) ? body.lease : matchedObj);
        const claimObj = isRecord(body.claim) ? body.claim : null;
        const claimStatus = claimObj ? pickString(claimObj, 'status') : null;
        const claimedPeerAlive = claimStatus === 'already_claimed'
          ? (renewObj && 'mcpClaimed' in renewObj ? hasLiveClaimedPeer(renewObj) : true)
          : hasLiveClaimedPeer(renewObj);
        const claimUsable = claimStatus === 'refreshed'
          || (claimStatus === 'already_claimed' && claimedPeerAlive)
          || claimStatus === 'reclaimable'
          || ((claimStatus === 'outstanding' || claimStatus === null) && claimedPeerAlive);
        if (!claimUsable) {
          return {
            ok: false,
            reason: `unusable_claim_status:${claimStatus ?? 'missing'}`,
            releaseOnFailure: true,
            target: targetKind,
            epoch: renewEpoch,
          };
        }
        return { ok: true, body, sessionSecret: newSecret };
      }

      const code = pickString(body, 'code');
      if (reply.status === 409 && code === 'epoch_mismatch' && !retriedEpoch) {
        retriedEpoch = true;
        const conflictEpoch = pickFiniteNumber(body, 'epoch');
        const stillOurs = snapshotObjMatchesOwner(body.lease, rec.leaseOwnerId, rec.brokerSessionId)
          || snapshotObjMatchesOwner(body.preempted, rec.leaseOwnerId, rec.brokerSessionId);
        if (stillOurs && conflictEpoch !== null && conflictEpoch >= 1) {
          attemptEpoch = conflictEpoch;
          continue;
        }
        return { ok: false, reason: 'epoch_mismatch' };
      }

      if (
        reply.status === 503
        && (code === 'claim_file_error' || code === 'state_persist_failed' || code === 'broker_busy')
        && transientRetries < MAX_TRANSIENT_BROKER_RETRIES
      ) {
        transientRetries += 1;
        await boundedRetryDelay(pickNonNegInt(body, 'retryAfterMs'));
        continue;
      }

      return { ok: false, reason: code ?? `http_${reply.status}` };
    }
    return { ok: false, reason: 'renew_retries_exhausted' };
  }

  async function reconcile(): Promise<void> {
    if (stopped || !ports.broker.configured()) {
      reconciled = true;
      return;
    }
    if (reconcileFlight) return reconcileFlight;
    const flight = (async () => {
      const pendingRecords = [...recordsByBrokerId.values()].filter(r => r.pendingStartupReconcile);
      if (!pendingRecords.length) {
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
      recordCapabilities(reply.body);
      if (!hasSlice2Capabilities(reply.body)) {
        // Responding Slice-1 broker: drop stale local records without mutating broker.
        for (const rec of pendingRecords) removeRecord(rec, { persist: false });
        reconciled = true;
        persistStore();
        return;
      }

      const canRenew = hasCap(SLICE2B_CAPABILITIES.leaseRenew);
      const canOwnerMatch = hasCap(SLICE2B_CAPABILITIES.ownerMatch);

      const brokerState = pickString(reply.body, 'state') ?? 'idle';
      const brokerEpoch = pickFiniteNumber(reply.body, 'epoch') ?? 0;
      const brokerGeneration = pickString(reply.body, 'generation');
      const brokerCursor = pickNonNegInt(reply.body, 'cursor');
      const pos: BrokerPosition = { generation: brokerGeneration, cursor: brokerCursor, epoch: brokerEpoch };
      const order = comparePosition(pos, { allowNewGeneration: true });
      // P1-6: Never apply a stale startup status snapshot (older than global known
      // state observed from SSE/HTTP while /v1/status was in flight). Leave pending
      // records untouched with zero state changes and zero commands.
      if (order === 'stale') {
        reconciled = false;
        return;
      }
      if (order === 'new_generation') {
        resetAllWatermarksForNewGeneration(brokerGeneration);
      }
      advanceGlobalPosition(pos, order === 'new_generation');

      const activeLease = isRecord(reply.body.lease) ? reply.body.lease : null;
      const activeLeaseRef = extractRef(activeLease);
      const activeIsAgent = (brokerState === 'agent' || brokerState === 'waiting_for_human')
        && activeLease !== null
        && pickString(activeLease, 'holderKind') !== 'human';
      const preempted = isRecord(reply.body.preempted) ? reply.body.preempted : null;
      const preemptedRef = extractRef(preempted);

      let skippedStaleRecord = false;
      for (const rec of pendingRecords) {
        if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) continue;
        // P1-6: If this snapshot is stale against the record's own known position,
        // skip the record entirely (no state change and no command).
        if (isRecordObservationStale(rec, pos)) {
          skippedStaleRecord = true;
          continue;
        }

        const isActive = activeIsAgent && refMatchesRecord(activeLeaseRef, rec);
        const isDisplaced = preemptedRef !== null && refMatchesRecord(preemptedRef, rec);
        const matchedObj = isActive ? activeLease : isDisplaced ? preempted : null;

        const effectivePid = rec.pid ?? (matchedObj ? pickFiniteNumber(matchedObj, 'pid') : null);
        const effectiveStart = rec.pidStartTime ?? (matchedObj ? pickPidStartTime(matchedObj, 'pidStartTime') : null);
        const ompAlive = effectivePid !== null
          && effectivePid > 1
          && effectiveStart !== null
          && processAlive({ pid: effectivePid, startTime: effectiveStart });

        if (!ompAlive) {
          rec.pendingStartupReconcile = false;
          if (matchedObj && canOwnerMatch) {
            try {
              await ownerMatchedReleaseOrCancel({
                brokerSessionId: rec.brokerSessionId,
                leaseOwnerId: rec.leaseOwnerId,
                sessionSecret: null,
                pid: effectivePid,
                pidStartTime: effectiveStart,
                epoch: brokerEpoch >= 1 ? brokerEpoch : null,
                initialTarget: isDisplaced ? 'displaced' : 'active',
              });
            } catch (error) {
              log(`[cu-lease] owner-matched orphan cleanup failed for ${rec.leaseOwnerId}: ${errorMessage(error)}`);
            }
          }
          if (recordsByBrokerId.get(rec.brokerSessionId) === rec) {
            removeRecord(rec, { persist: false });
          }
          continue;
        }

        rec.pid = effectivePid;
        rec.pidStartTime = effectiveStart;
        const effectiveGen = brokerGeneration ?? knownGeneration ?? rec.generation ?? 'default';
        ensureDeliveryContext(rec, effectiveGen);
        resolveSessionIdForRecord(rec);
        ensureLivenessMonitor();

        if (!canRenew) {
          // Old Slice-2 broker (no lease_renew): preserve exact fail-closed Slice-2 behavior.
          rec.pendingStartupReconcile = false;
          if (matchedObj && hasLiveClaimedPeer(matchedObj)) {
            rec.leaseId = pickString(matchedObj, 'leaseId') ?? rec.leaseId;
            updateRecordPosition(rec, pos);
            rec.status = isActive ? 'holding' : 'preempted';
            if (isDisplaced) {
              scheduleCommand(rec, 'abort', brokerEpoch, effectiveGen);
            }
          } else if (canOwnerMatch && matchedObj && hasLostUsableClaimOrPeer(rec, matchedObj, null)) {
            await markAccessLostAndRelease(rec, isDisplaced ? 'displaced' : 'active', brokerEpoch);
          } else {
            markAccessLost(rec);
          }
          continue;
        }

        if (!matchedObj) {
          rec.pendingStartupReconcile = false;
          markAccessLost(rec);
          continue;
        }

        // Slice 2b: renew via POST /v1/lease/renew while keeping record in 'checking'
        // until renewal resolves. On failure, abort + mark access_lost (never silently continue).
        const renewed = await renewAdoptedRecord(rec, brokerEpoch, matchedObj);
        if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) continue;
        rec.pendingStartupReconcile = false;

        if (!renewed.ok) {
          log(`[cu-lease] startup renew failed for ${rec.leaseOwnerId}: ${renewed.reason}`);
          if (renewed.releaseOnFailure) {
            await markAccessLostAndRelease(rec, renewed.target ?? (isDisplaced ? 'displaced' : 'active'), renewed.epoch ?? brokerEpoch);
          } else {
            markAccessLost(rec);
          }
          scheduleCommand(rec, 'abort', Math.max(0, brokerEpoch), effectiveGen);
          continue;
        }

        const renewBody = renewed.body;
        const renewGen = pickString(renewBody, 'generation') ?? effectiveGen;
        const renewCursor = pickNonNegInt(renewBody, 'cursor') ?? brokerCursor;
        const renewEpoch = pickFiniteNumber(renewBody, 'epoch') ?? brokerEpoch;
        const renewPos: BrokerPosition = { generation: renewGen, cursor: renewCursor, epoch: renewEpoch };
        const renewOrder = comparePosition(renewPos, { allowNewGeneration: true });
        if (renewOrder === 'new_generation') {
          resetAllWatermarksForNewGeneration(renewGen);
        }
        if (renewOrder !== 'stale') {
          advanceGlobalPosition(renewPos, renewOrder === 'new_generation');
          updateRecordPosition(rec, renewPos);
        } else {
          updateRecordPosition(rec, pos);
        }

        const renewTarget = pickString(renewBody, 'target');
        const renewState = pickString(renewBody, 'state') ?? brokerState;
        const displaced = renewTarget === 'displaced' || renewState === 'human';
        const renewObj = displaced
          ? (isRecord(renewBody.preempted) ? renewBody.preempted : matchedObj)
          : (isRecord(renewBody.lease) ? renewBody.lease : matchedObj);
        const finalGen = rec.generation ?? renewGen;
        ensureDeliveryContext(rec, finalGen);

        if (hasLostUsableClaimOrPeer(rec, renewObj, null)) {
          await markAccessLostAndRelease(rec, displaced ? 'displaced' : 'active', renewEpoch);
          scheduleCommand(rec, 'abort', Math.max(0, rec.epoch), finalGen);
          continue;
        }

        rec.sessionSecret = renewed.sessionSecret;
        rec.adoptedWithoutSecret = false;
        rec.leaseId = pickString(renewBody, 'leaseId') ?? pickString(matchedObj, 'leaseId') ?? rec.leaseId;
        rec.heartbeatIntervalMs = resolveHeartbeatMs(pickFiniteNumber(renewBody, 'heartbeatIntervalSec'));

        rec.status = displaced ? 'preempted' : 'holding';
        startHeartbeat(rec);
        if (displaced) {
          scheduleCommand(rec, 'abort', Math.max(0, rec.epoch), finalGen);
        }
      }

      reconciled = !skippedStaleRecord;
      persistStore();
    })();
    reconcileFlight = flight;
    try {
      await flight;
    } finally {
      if (reconcileFlight === flight) reconcileFlight = null;
    }
  }

  async function mintClaimFile(
    brokerSessionId: string,
    sessionSecret: string,
    options: { requireRebind?: boolean } = {},
  ): Promise<
    | { ok: true; claimFile: string; claimId: string | null; generation: string | null; cursor: number | null }
    | { ok: false; status: number; code: string | null; message: string }
  > {
    const requireRebind = options.requireRebind === true;
    for (let attempt = 0; attempt <= MAX_TRANSIENT_BROKER_RETRIES; attempt++) {
      let reply: { status: number; body: unknown };
      try {
        reply = await requestBrokerOrUnavailable('POST', '/v1/lease/claim-nonce', {
          sessionId: brokerSessionId,
          sessionSecret,
          bindTimeoutSec: CLAIM_BIND_TIMEOUT_SEC,
          requireRebind,
        });
      } catch (error) {
        if (
          error instanceof CuBrokerUnavailableError
          && (error.brokerCode === 'claim_file_error' || error.brokerCode === 'state_persist_failed')
          && attempt < MAX_TRANSIENT_BROKER_RETRIES
          && !stopped
        ) {
          await boundedRetryDelay(error.retryAfterMs);
          continue;
        }
        throw error;
      }
      if (reply.status === 200 && isRecord(reply.body)) {
        const claimFile = pickString(reply.body, 'claimFile');
        const claimId = pickString(reply.body, 'claimId');
        // Deliberately discard reply.body.claimNonce — never log, store, or pass it.
        if (!claimFile) {
          return { ok: false, status: 502, code: 'missing_claim_file', message: 'cu-broker did not return a claimFile path' };
        }
        return {
          ok: true,
          claimFile,
          claimId,
          generation: pickString(reply.body, 'generation'),
          cursor: pickNonNegInt(reply.body, 'cursor'),
        };
      }
      const body = isRecord(reply.body) ? reply.body : {};
      return {
        ok: false,
        status: reply.status >= 400 ? reply.status : 502,
        code: pickString(body, 'code'),
        message: pickString(body, 'message') ?? pickString(body, 'error') ?? `cu-broker claim-nonce failed (${reply.status})`,
      };
    }
    return { ok: false, status: 503, code: 'claim_file_error', message: 'cu-broker claim-nonce failed after retries' };
  }

  async function releaseUnboundAcquire(
    brokerSessionId: string,
    leaseOwnerId: string,
    sessionSecret: string | null,
    epoch: number | null,
  ): Promise<void> {
    try {
      if (hasCap(SLICE2B_CAPABILITIES.ownerMatch)) {
        await ownerMatchedReleaseOrCancel({
          brokerSessionId,
          leaseOwnerId,
          sessionSecret,
          pid: null,
          pidStartTime: null,
          epoch,
          initialTarget: 'active',
        });
        return;
      }
      if (sessionSecret) {
        await ports.broker.requestJson('POST', '/v1/lease/release', {
          sessionId: brokerSessionId,
          sessionSecret,
        });
      }
    } catch {
      // Best-effort cleanup of failed/uncertain acquire.
    }
  }

  async function prepareSpawn(
    options: { knownSessionId?: string | null; assumeSlice2?: boolean },
  ): Promise<CuAgentSpawnHandle | null> {
    // P1-1 & P1-4: When caller already probed capabilities once (e.g. restartSession),
    // honor that decision without re-probing. Otherwise probe §9.1 capabilities before
    // any mutation: Slice-1 broker -> return null (legacy path); unreachable configured
    // broker -> throws 503 CuBrokerUnavailableError (fail-closed).
    if (options.assumeSlice2 === false) return null;
    if (options.assumeSlice2 === true) {
      if (stopped || !ports.broker.configured()) return null;
      if (!ports.broker.available()) {
        throw new CuBrokerUnavailableError('Computer-use broker is unavailable', { retryable: true });
      }
    } else if (!(await supportsSlice2())) {
      return null;
    }

    const knownSessionId = typeof options.knownSessionId === 'string' && options.knownSessionId.trim()
      ? options.knownSessionId.trim()
      : null;

    const leaseOwnerId = `cu-owner-${crypto.randomBytes(16).toString('hex')}`;
    const brokerSessionId = `cu-agent-${crypto.randomUUID()}`;
    let reply: { status: number; body: unknown };
    try {
      reply = await requestBrokerOrUnavailable('POST', '/v1/lease/acquire', {
        holderKind: 'agent',
        sessionId: brokerSessionId,
        ownerId: leaseOwnerId,
        label: BROKER_AGENT_LABEL,
      });
    } catch (error) {
      if (error instanceof CuBrokerUnavailableError && error.uncertain && hasCap(SLICE2B_CAPABILITIES.ownerMatch)) {
        // Spec pi-dish item 8: acquire with applied:"unknown" may have created an unbound lease.
        // Clean it up with guarded owner-match release (never force:true) and still surface uncertain error.
        await releaseUnboundAcquire(brokerSessionId, leaseOwnerId, null, null);
      }
      throw error;
    }

    if (reply.status === 200 && isRecord(reply.body)) {
      const confirmedSessionId = pickString(reply.body, 'sessionId') ?? brokerSessionId;
      const sessionSecret = pickString(reply.body, 'sessionSecret') ?? pickString(reply.body, 'token');
      if (!sessionSecret) {
        throw httpError('cu-broker did not return an agent lease secret', 502);
      }
      const epoch = pickFiniteNumber(reply.body, 'epoch') ?? 0;
      const generation = pickString(reply.body, 'generation') ?? knownGeneration;
      const cursor = pickNonNegInt(reply.body, 'cursor');
      const hbSec = pickFiniteNumber(reply.body, 'heartbeatIntervalSec');
      const leaseObj = isRecord(reply.body.lease) ? reply.body.lease : null;
      const leaseId = pickString(reply.body, 'leaseId') ?? (leaseObj ? pickString(leaseObj, 'leaseId') : null);

      let claim;
      try {
        claim = await mintClaimFile(confirmedSessionId, sessionSecret, { requireRebind: false });
      } catch (claimError) {
        await releaseUnboundAcquire(confirmedSessionId, leaseOwnerId, sessionSecret, epoch >= 1 ? epoch : null);
        throw claimError;
      }
      if (!claim.ok) {
        await releaseUnboundAcquire(confirmedSessionId, leaseOwnerId, sessionSecret, epoch >= 1 ? epoch : null);
        throw httpError(claim.message, claim.status);
      }

      const initialCursor = Math.max(cursor ?? -1, claim.cursor ?? -1);
      const pos: BrokerPosition = { generation: claim.generation ?? generation, cursor: initialCursor >= 0 ? initialCursor : null, epoch };
      const order = comparePosition(pos, { allowNewGeneration: true });
      if (order === 'new_generation') {
        resetAllWatermarksForNewGeneration(pos.generation);
      }
      if (order !== 'stale') {
        advanceGlobalPosition(pos, order === 'new_generation');
      }

      const rec: ManagedLeaseRecord = {
        brokerSessionId: confirmedSessionId,
        leaseOwnerId,
        createdAt: Date.now(),
        leaseId,
        sessionSecret,
        sessionId: knownSessionId,
        status: 'holding',
        epoch,
        lastCursor: initialCursor,
        generation: pos.generation,
        pid: null,
        pidStartTime: null,
        adoptedWithoutSecret: false,
        reAdopted: false,
        pendingStartupReconcile: false,
        pendingTransferClaimId: null,
        heartbeatTimer: null,
        heartbeatIntervalMs: resolveHeartbeatMs(hbSec),
        delivery: createDeliveryTracker(generation ?? 'default', 'unbound'),
      };
      recordsByBrokerId.set(confirmedSessionId, rec);
      recordsByOwnerId.set(leaseOwnerId, rec);
      if (knownSessionId) brokerIdBySessionId.set(knownSessionId, confirmedSessionId);
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
        acquiredEpoch: epoch,
      };
    }

    // P1-3: Busy seat (human OR agent) ALWAYS fails closed with typed 409 seat_busy.
    if (reply.status === 409 && isRecord(reply.body)) {
      const leaseObj = isRecord(reply.body.lease) ? reply.body.lease : null;
      const busyState = pickString(reply.body, 'state')
        ?? (leaseObj && pickString(leaseObj, 'holderKind') === 'human' ? 'human' : null);
      const epoch = pickFiniteNumber(reply.body, 'epoch');
      const generation = pickString(reply.body, 'generation');
      const cursor = pickNonNegInt(reply.body, 'cursor');
      const pos: BrokerPosition = { generation, cursor, epoch };
      const order = comparePosition(pos, { allowNewGeneration: true });
      if (order !== 'stale') {
        advanceGlobalPosition(pos, order === 'new_generation');
      }
      const message = pickString(reply.body, 'message')
        ?? pickString(reply.body, 'error')
        ?? (busyState === 'human'
          ? 'Computer-use desktop seat is held by a human'
          : 'Computer-use desktop seat is held by another agent session');
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

  function canTransferSession(sessionId: string): boolean {
    if (stopped || !ports.broker.configured() || !hasCap(SLICE2B_CAPABILITIES.bindTransfer)) return false;
    const rec = recordForSessionId(sessionId);
    if (!rec) return false;
    if (rec.status !== 'holding' && rec.status !== 'preempted') return false;
    if (!rec.sessionSecret || rec.adoptedWithoutSecret) return false;
    if (rec.pendingTransferClaimId !== null) return false;
    if (rec.pid === null || rec.pid <= 1 || !rec.pidStartTime) return false;
    return true;
  }

  async function prepareTransfer(options: {
    sessionId: string;
    expectedPid?: number | null;
    expectedPidStartTime?: string | null;
  }): Promise<CuAgentSpawnHandle | null> {
    if (stopped || !ports.broker.configured() || !hasCap(SLICE2B_CAPABILITIES.bindTransfer)) return null;
    if (!ports.broker.available()) {
      throw new CuBrokerUnavailableError('Computer-use broker is unavailable', { retryable: true });
    }
    const rec = recordForSessionId(options.sessionId);
    if (!rec || !rec.sessionSecret || rec.adoptedWithoutSecret) return null;
    if (rec.status !== 'holding' && rec.status !== 'preempted') return null;
    if (rec.pendingTransferClaimId !== null) return null;

    const expectedPid = options.expectedPid !== undefined && options.expectedPid !== null
      ? options.expectedPid
      : rec.pid;
    const expectedPidStartTime = options.expectedPidStartTime !== undefined && options.expectedPidStartTime !== null
      ? options.expectedPidStartTime
      : rec.pidStartTime;
    if (expectedPid === null || expectedPid <= 1 || !expectedPidStartTime) return null;

    const claim = await mintClaimFile(rec.brokerSessionId, rec.sessionSecret, { requireRebind: true });
    if (!claim.ok) {
      if (claim.status === 409 && (claim.code === 'lease_not_found' || claim.code === 'not_agent_lease')) {
        markAccessLost(rec);
        persistStore();
        return null;
      }
      if (claim.status === 403) {
        markAccessLost(rec);
        persistStore();
        return null;
      }
      throw httpError(claim.message, claim.status);
    }
    if (!claim.claimId) {
      throw httpError('cu-broker did not return a staged claimId for bind transfer', 502);
    }
    if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) {
      return null;
    }

    const pos: BrokerPosition = { generation: claim.generation, cursor: claim.cursor, epoch: null };
    const order = comparePosition(pos, { allowNewGeneration: true });
    if (order !== 'stale') {
      advanceGlobalPosition(pos, order === 'new_generation');
      updateRecordPosition(rec, pos);
    }

    const stagedEpoch = rec.epoch;
    rec.pendingTransferClaimId = claim.claimId;
    const handle: CuAgentSpawnHandle = {
      brokerSessionId: rec.brokerSessionId,
      leaseOwnerId: rec.leaseOwnerId,
      env: Object.freeze({
        CU_BROKER_SESSION_ID: rec.brokerSessionId,
        CU_BROKER_CLAIM_FILE: claim.claimFile,
        CU_BROKER_LABEL: BROKER_AGENT_LABEL,
      }),
      acquiredEpoch: stagedEpoch,
      transfer: Object.freeze({
        claimId: claim.claimId,
        expectedEpoch: stagedEpoch >= 1 ? stagedEpoch : null,
        expectedPid,
        expectedPidStartTime,
      }),
    };
    transferStates.set(handle, {
      aborted: false,
      committed: false,
      originalPid: expectedPid,
      originalPidStartTime: expectedPidStartTime,
      replacementPid: null,
      replacementPidStartTime: null,
    });
    return handle;
  }

  async function abortStagedTransfer(rec: ManagedLeaseRecord, handle: CuAgentSpawnHandle): Promise<void> {
    const transfer = handle.transfer;
    if (!transfer) return;
    const state = transferStates.get(handle);
    if (state?.aborted) return;
    if (state) state.aborted = true;
    if (!rec.sessionSecret || !ports.broker.available()) return;
    try {
      await ports.broker.requestJson('POST', '/v1/lease/bind', {
        sessionId: rec.brokerSessionId,
        sessionSecret: rec.sessionSecret,
        abortStaged: true,
        claimId: transfer.claimId,
      });
    } catch (error) {
      log(`[cu-lease] abortStaged failed for ${rec.leaseOwnerId}: ${errorMessage(error)}`);
    }
  }

  async function bindSpawnedProcess(handle: CuAgentSpawnHandle, proc: CuBindProcessInfo | null): Promise<void> {
    const rec = recordsByBrokerId.get(handle.brokerSessionId);
    if (!rec) {
      throw httpError('Computer-use agent lease was lost before process bind', 409);
    }
    const transfer = handle.transfer ?? null;
    if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 1 || !proc.startTime) {
      if (transfer) {
        await abortStagedTransfer(rec, handle);
        if (rec.pendingTransferClaimId === transfer.claimId) rec.pendingTransferClaimId = null;
      }
      throw httpError('Could not verify spawned omp process identity for computer-use lease bind', 500);
    }
    if (!rec.sessionSecret) {
      if (transfer && rec.pendingTransferClaimId === transfer.claimId) rec.pendingTransferClaimId = null;
      throw httpError('Computer-use agent lease credentials are unavailable for bind', 409);
    }

    const prevPid = rec.pid;
    const prevStart = rec.pidStartTime;
    const prevDelivery = rec.delivery;
    const previousBirth = processBirthKey(rec.pid, rec.pidStartTime);
    const nextBirth = processBirthKey(proc.pid, proc.startTime);
    rec.pid = proc.pid;
    rec.pidStartTime = proc.startTime;
    if (previousBirth !== nextBirth) {
      resetRecordDelivery(rec, rec.generation ?? knownGeneration ?? 'default', nextBirth);
    }
    persistStore();
    ensureLivenessMonitor();

    const sentGeneration = rec.generation;
    let attemptEpoch: number | null = transfer ? transfer.expectedEpoch : null;
    let retriedEpoch = false;
    let transientRetries = 0;
    let reply: { status: number; body: unknown } | null = null;

    try {
      for (let step = 0; step < 5; step++) {
        const bindPayload: Record<string, unknown> = {
          sessionId: rec.brokerSessionId,
          sessionSecret: rec.sessionSecret,
          ownerId: rec.leaseOwnerId,
          label: BROKER_AGENT_LABEL,
          pid: proc.pid,
          pidStartTime: formatPidStartTimeForBroker(proc.startTime),
        };
        if (transfer) {
          bindPayload.claimId = transfer.claimId;
          bindPayload.expectedPid = transfer.expectedPid;
          bindPayload.expectedPidStartTime = formatPidStartTimeForBroker(transfer.expectedPidStartTime);
          if (attemptEpoch !== null && attemptEpoch >= 1) {
            bindPayload.expectedEpoch = attemptEpoch;
          }
        }

        try {
          reply = await requestBrokerOrUnavailable('POST', '/v1/lease/bind', bindPayload);
        } catch (error) {
          if (
            error instanceof CuBrokerUnavailableError
            && (error.brokerCode === 'worker_exit_unconfirmed' || error.brokerCode === 'state_persist_failed')
            && transientRetries < MAX_TRANSIENT_BROKER_RETRIES
            && !stopped
          ) {
            transientRetries += 1;
            await boundedRetryDelay(error.retryAfterMs);
            continue;
          }
          throw error;
        }

        if (reply.status === 200 && isRecord(reply.body)) {
          break;
        }

        const body = isRecord(reply.body) ? reply.body : {};
        const code = pickString(body, 'code');
        if (reply.status === 409 && transfer && code === 'epoch_mismatch' && !retriedEpoch) {
          // A human takeover may have displaced our lease between claim-nonce and bind.
          // If our exact (ownerId, sessionId) is still present in preempted or lease,
          // retry bind once with the updated epoch so broker answers 200 target:"displaced".
          retriedEpoch = true;
          const conflictEpoch = pickFiniteNumber(body, 'epoch');
          const stillOurs = snapshotObjMatchesOwner(body.preempted, rec.leaseOwnerId, rec.brokerSessionId)
            || snapshotObjMatchesOwner(body.lease, rec.leaseOwnerId, rec.brokerSessionId);
          if (stillOurs && conflictEpoch !== null && conflictEpoch >= 1) {
            attemptEpoch = conflictEpoch;
            continue;
          }
        }
        if (reply.status === 409 && code === 'transition_pending' && transientRetries < MAX_TRANSIENT_BROKER_RETRIES && !stopped) {
          transientRetries += 1;
          await boundedRetryDelay(pickNonNegInt(body, 'retryAfterMs'));
          continue;
        }
        const message = pickString(body, 'message') ?? pickString(body, 'error') ?? `cu-broker lease bind failed (${reply.status})`;
        throw httpError(message, reply.status >= 400 ? reply.status : 502);
      }

      if (!reply || reply.status !== 200 || !isRecord(reply.body)) {
        throw httpError('cu-broker lease bind did not succeed', 502);
      }
    } catch (bindError) {
      if (transfer) {
        rec.pid = prevPid;
        rec.pidStartTime = prevStart;
        rec.delivery = prevDelivery;
        await abortStagedTransfer(rec, handle);
        if (rec.pendingTransferClaimId === transfer.claimId) rec.pendingTransferClaimId = null;
        persistStore();
      }
      throw bindError;
    }

    if (transfer) {
      const state = transferStates.get(handle);
      if (state) {
        state.committed = true;
        state.replacementPid = proc.pid;
        state.replacementPidStartTime = proc.startTime;
      }
      if (rec.pendingTransferClaimId === transfer.claimId) {
        rec.pendingTransferClaimId = null;
      }
    }

    // Check record still exists after await.
    if (recordsByBrokerId.get(handle.brokerSessionId) !== rec) return;

    const ep = pickFiniteNumber(reply.body, 'epoch');
    const gen = pickString(reply.body, 'generation');
    const cursor = pickNonNegInt(reply.body, 'cursor');
    const st = pickString(reply.body, 'state');
    const target = pickString(reply.body, 'target');
    const pos: BrokerPosition = { generation: gen, cursor, epoch: ep };

    // P1-6: If a newer SSE event (e.g. takeover) already moved this record ahead while bind was in flight,
    // keep the newer status and pending abort instead of letting the stale bind reply restore holding.
    const order = comparePosition(pos, { allowNewGeneration: true, sourceGeneration: sentGeneration });
    if (order === 'stale' || isRecordObservationStale(rec, pos)) {
      if (target === 'displaced' || st === 'human') {
        rec.status = 'preempted';
        scheduleCommand(rec, 'abort', Math.max(0, rec.epoch), rec.generation ?? knownGeneration ?? 'default');
      }
      flushPendingCommands(rec);
      persistStore();
      return;
    }

    if (order === 'new_generation') {
      resetAllWatermarksForNewGeneration(gen);
    }
    advanceGlobalPosition(pos, order === 'new_generation');
    updateRecordPosition(rec, pos);
    const effectiveGen = rec.generation ?? knownGeneration ?? 'default';
    ensureDeliveryContext(rec, effectiveGen);

    if (target === 'displaced' || st === 'human') {
      rec.status = 'preempted';
      scheduleCommand(rec, 'abort', rec.epoch, effectiveGen);
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
    if (rec.pid === null && info.pid !== null && info.pid > 1 && info.pidStartTime) {
      rec.pid = info.pid;
      rec.pidStartTime = info.pidStartTime;
      ensureDeliveryContext(rec, rec.generation ?? knownGeneration ?? 'default');
      ensureLivenessMonitor();
    }
    flushPendingCommands(rec);
  }

  async function abortSpawn(handle: CuAgentSpawnHandle): Promise<void> {
    const rec = recordsByBrokerId.get(handle.brokerSessionId);
    if (!rec) return;
    if (handle.transfer) {
      const state = transferStates.get(handle);
      if (rec.pendingTransferClaimId === handle.transfer.claimId) {
        rec.pendingTransferClaimId = null;
      }
      if (!state?.committed) {
        await abortStagedTransfer(rec, handle);
        // Before bind commits, keep the lease ONLY when the proven original pre-transfer
        // birth is still alive and still matches the record's bound birth. Never treat an
        // arbitrary live rec.pid as proof the old pane survived.
        const origPid = state?.originalPid ?? handle.transfer.expectedPid;
        const origStart = state?.originalPidStartTime ?? handle.transfer.expectedPidStartTime;
        const originalProvenAlive = origPid > 1
          && Boolean(origStart)
          && rec.pid === origPid
          && rec.pidStartTime === origStart
          && processAlive({ pid: origPid, startTime: origStart });
        if (originalProvenAlive) {
          return;
        }
        await releaseRecord(rec);
        return;
      }
      // After bind committed to the replacement birth, any registration or launch failure
      // MUST stop heartbeats and release/cancel the replacement birth — even if tmux cleanup
      // failed and the replacement process is still alive.
      if (state.replacementPid !== null && state.replacementPidStartTime !== null) {
        rec.pid = state.replacementPid;
        rec.pidStartTime = state.replacementPidStartTime;
      }
      await releaseRecord(rec);
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
    if (!rec) return;
    if (rec.pendingTransferClaimId !== null) return;
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
    if (eventName === 'hello' && Array.isArray(payload.capabilities)) {
      recordCapabilities(payload);
    }
    const state = pickString(payload, 'state');
    const epoch = pickFiniteNumber(payload, 'epoch');
    if (state === null || epoch === null) return;

    const generation = event.generation ?? pickString(payload, 'generation');
    const cursor = event.cursor ?? pickNonNegInt(payload, 'cursor');
    const resumeObj = eventName === 'hello' && isRecord(payload.resume) ? payload.resume : null;
    const resumeStatus = event.resumeStatus ?? (resumeObj ? pickString(resumeObj, 'status') : null);
    const isResync = event.isResync === true || eventName === 'resync' || resumeStatus === 'resync_required';
    const generationChanged = event.generationChanged === true
      || (generation !== null && knownGeneration !== null && generation !== knownGeneration);

    // P1-7: Replay `hello` carries the FINAL snapshot before the missed events are replayed
    // in ascending cursor order. Do not advance watermarks or delete targets ahead of replay!
    if (eventName === 'hello' && resumeStatus === 'replayed') {
      if (generation !== null && knownGeneration === null) knownGeneration = generation;
      if (!reconciled) void reconcile();
      return;
    }

    // P1-7: Dedupe gap `hello(resync_required)` and its immediately following `event: resync`
    // at the exact same `(generation, cursor)` so one gap reconciles once (at most one abort per birth).
    const resyncKey = isResync && generation !== null && cursor !== null ? `${generation}:${cursor}` : null;
    if (resyncKey !== null && resyncKey === lastResyncHandledKey) {
      return;
    }

    const pos: BrokerPosition = { generation, cursor, epoch };
    const order = comparePosition(pos, { allowNewGeneration: authoritativeHello || isResync });

    if (generationChanged || order === 'new_generation') {
      resetAllWatermarksForNewGeneration(generation);
      advanceGlobalPosition(pos, true);
    } else if (isResync) {
      // Same-generation resync (cursor_too_old / cursor_ahead / subscriber_lagged):
      // DO NOT wipe ackedAbortEpoch / inFlightAbortEpoch for the same (generation, birth, epoch)
      // so the same birth is never aborted twice across a gap.
      const resyncReason = event.resyncReason ?? pickString(payload, 'reason') ?? (resumeObj ? pickString(resumeObj, 'resyncReason') : null);
      if (resyncReason === 'cursor_ahead') {
        if (cursor !== null) knownCursor = cursor;
        knownEpoch = epoch;
        for (const rec of recordsByBrokerId.values()) {
          if (cursor !== null && rec.lastCursor > cursor) rec.lastCursor = cursor;
        }
      } else {
        if (order === 'stale') return;
        advanceGlobalPosition(pos, false);
      }
    } else if (order === 'stale') {
      // P1-6: Ignore older same-generation snapshots (including stale hello) so they never undo newer HTTP state.
      return;
    } else {
      advanceGlobalPosition(pos, false);
    }

    if (resyncKey !== null) {
      lastResyncHandledKey = resyncKey;
    } else if (!isResync) {
      lastResyncHandledKey = null;
    }

    const effectiveGen = generation ?? knownGeneration ?? 'default';

    if (authoritativeHello && !reconciled) {
      void reconcile();
    }

    const reason = pickString(payload, 'reason');
    const leaseObj = isRecord(payload.lease) ? payload.lease : null;
    const leaseRef = extractRef(leaseObj);
    const preemptedObj = isRecord(payload.displaced)
      ? payload.displaced
      : (isRecord(payload.preempted) ? payload.preempted : null);
    const preemptedRef = extractRef(preemptedObj)
      ?? (eventName === 'preempted' && pickString(payload, 'ownerId')
        ? { ownerId: pickString(payload, 'ownerId') }
        : null);
    const handBackObj = isRecord(payload.handedBackTo) ? payload.handedBackTo : leaseObj;
    const handBackRef = extractRef(handBackObj);

    let storeDirty = false;

    const isPreemptSignal = eventName === 'preempted'
      || (state === 'human' && preemptedRef !== null);
    if (isPreemptSignal && preemptedRef) {
      const rec = findRecordForRef(preemptedRef);
      if (rec && !rec.pendingStartupReconcile && rec.status !== 'access_lost' && !isRecordObservationStale(rec, pos)) {
        if (hasLostUsableClaimOrPeer(rec, preemptedObj, reason)) {
          updateRecordPosition(rec, pos);
          void markAccessLostAndRelease(rec, 'displaced', epoch);
          storeDirty = true;
          scheduleCommand(rec, 'abort', epoch, effectiveGen);
        } else if ((rec.adoptedWithoutSecret || generationChanged) && preemptedObj && !hasLiveClaimedPeer(preemptedObj)) {
          // P1-5: On a broker restart (generationChanged) or re-adopted record, check claimed peer liveness.
          markAccessLost(rec);
          updateRecordPosition(rec, pos);
          storeDirty = true;
          scheduleCommand(rec, 'abort', epoch, effectiveGen);
        } else {
          rec.status = 'preempted';
          updateRecordPosition(rec, pos);
          storeDirty = true;
          scheduleCommand(rec, 'abort', epoch, effectiveGen);
        }
      }
    }

    const explicitHandBack = eventName === 'hand_back'
      || (eventName === 'lease_changed' && reason === 'hand_back');
    if (explicitHandBack && handBackRef) {
      const rec = findRecordForRef(handBackRef);
      if (rec && !rec.pendingStartupReconcile && rec.status !== 'access_lost' && !isRecordObservationStale(rec, pos)) {
        if (hasLostUsableClaimOrPeer(rec, handBackObj, reason)) {
          updateRecordPosition(rec, pos);
          void markAccessLostAndRelease(rec, 'active', epoch);
          storeDirty = true;
        } else if ((rec.adoptedWithoutSecret || generationChanged) && handBackObj && !hasLiveClaimedPeer(handBackObj)) {
          markAccessLost(rec);
          updateRecordPosition(rec, pos);
          storeDirty = true;
        } else {
          rec.status = 'holding';
          updateRecordPosition(rec, pos);
          storeDirty = true;
          scheduleCommand(rec, 'nudge', epoch, effectiveGen);
        }
      }
    } else if ((eventName === 'hello' || isResync) && state === 'agent' && leaseRef) {
      // Reconnect/resync: if hand_back occurred while disconnected while we knew we were preempted, nudge once.
      const rec = findRecordForRef(leaseRef);
      if (rec && !rec.pendingStartupReconcile && rec.status === 'preempted' && !isRecordObservationStale(rec, pos)) {
        if (hasLostUsableClaimOrPeer(rec, leaseObj, reason)) {
          updateRecordPosition(rec, pos);
          void markAccessLostAndRelease(rec, 'active', epoch);
          storeDirty = true;
        } else if ((rec.adoptedWithoutSecret || generationChanged) && leaseObj && !hasLiveClaimedPeer(leaseObj)) {
          markAccessLost(rec);
          updateRecordPosition(rec, pos);
          storeDirty = true;
        } else {
          rec.status = 'holding';
          updateRecordPosition(rec, pos);
          storeDirty = true;
          scheduleCommand(rec, 'nudge', epoch, effectiveGen);
        }
      }
    }

    if (state === 'idle') {
      for (const rec of [...recordsByBrokerId.values()]) {
        if (rec.pendingStartupReconcile) continue;
        if ((rec.status === 'holding' || rec.status === 'preempted') && !isRecordObservationStale(rec, pos)) {
          const wasHolding = rec.status === 'holding';
          const unexpectedLoss = wasHolding && (reason === 'ttl_expired' || reason === 'hard_cap_expired');
          const stillAlive = rec.pid !== null && rec.pidStartTime !== null && processAlive({ pid: rec.pid, startTime: rec.pidStartTime });
          updateRecordPosition(rec, pos);
          storeDirty = true;
          if (stillAlive) {
            markAccessLost(rec);
            if (unexpectedLoss) scheduleCommand(rec, 'abort', epoch, effectiveGen);
          } else {
            clearHeartbeat(rec);
            rec.sessionSecret = null;
            rec.status = 'idle';
            if (unexpectedLoss) scheduleCommand(rec, 'abort', epoch, effectiveGen);
            else removeRecord(rec, { persist: false });
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
          if (rec.status === 'access_lost' || isRecordObservationStale(rec, pos)) continue;
          if (hasLostUsableClaimOrPeer(rec, leaseObj, reason)) {
            updateRecordPosition(rec, pos);
            void markAccessLostAndRelease(rec, 'active', epoch);
            storeDirty = true;
          } else if ((rec.adoptedWithoutSecret || generationChanged) && leaseObj && !hasLiveClaimedPeer(leaseObj)) {
            // P1-5: If re-adopted or after a broker restart without a live claimed peer, mark access_lost and stop heartbeats.
            markAccessLost(rec);
            updateRecordPosition(rec, pos);
            storeDirty = true;
          } else {
            rec.status = 'holding';
            updateRecordPosition(rec, pos);
          }
        } else if ((rec.status === 'holding' || rec.status === 'preempted') && !isRecordObservationStale(rec, pos) && (generationChanged || isResync || epoch > rec.epoch)) {
          const stillAlive = rec.pid !== null && rec.pidStartTime !== null && processAlive({ pid: rec.pid, startTime: rec.pidStartTime });
          if (stillAlive) markAccessLost(rec);
          else removeRecord(rec, { persist: false });
          storeDirty = true;
        }
      }
      if (storeDirty) persistStore();
      return;
    }

    if (state === 'human') {
      for (const rec of [...recordsByBrokerId.values()]) {
        if (rec.pendingStartupReconcile) continue;
        if (refMatchesRecord(preemptedRef, rec)) continue;
        if ((rec.status === 'holding' || rec.status === 'preempted') && !isRecordObservationStale(rec, pos)) {
          const stillAlive = rec.pid !== null && rec.pidStartTime !== null && processAlive({ pid: rec.pid, startTime: rec.pidStartTime });
          if (stillAlive) markAccessLost(rec);
          else removeRecord(rec, { persist: false });
          storeDirty = true;
        }
      }
      if (storeDirty) persistStore();
    }
  }

  function ownerIdForSession(sessionId: string): string | null {
    const rec = recordForSessionId(sessionId);
    if (!rec) return null;
    if (rec.status !== 'holding' && rec.status !== 'preempted') return null;
    if (rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
      return null;
    }
    return rec.leaseOwnerId;
  }

  function isDesktopAccessLost(sessionId: string): boolean {
    const rec = recordForSessionId(sessionId);
    if (!rec || rec.status !== 'access_lost') return false;
    if (rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
      return false;
    }
    return true;
  }

  function isDesktopChecking(sessionId: string): boolean {
    const rec = recordForSessionId(sessionId);
    if (!rec || rec.status !== 'checking') return false;
    if (rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
      return false;
    }
    return true;
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
    supportsSlice2,
    probeCapabilities,
    canTransferSession,
    reconcile,
    prepareSpawn,
    prepareTransfer,
    bindSpawnedProcess,
    attachSpawnedSession,
    abortSpawn,
    releaseSession,
    handleSessionRetired,
    adoptSessionSwitch,
    handleBrokerEvent,
    ownerIdForSession,
    isDesktopAccessLost,
    isDesktopChecking,
    stop,
  };
}
