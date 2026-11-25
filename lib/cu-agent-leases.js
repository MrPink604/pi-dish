// Generated from src/core/cu-agent-leases.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CuBrokerUnavailableError = exports.CuSeatBusyError = exports.BROKER_AGENT_LABEL = exports.CU_HAND_BACK_NUDGE = void 0;
exports.createCuAgentLeases = createCuAgentLeases;
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
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dish_store_1 = require("./dish-store");
const http_boundary_1 = require("./http-boundary");
const helper_values_1 = require("./helper-values");
const process_identity_1 = require("./process-identity");
exports.CU_HAND_BACK_NUDGE = 'The desktop has been returned to you after human take-over. Inspect the current screen and browser state before continuing.';
exports.BROKER_AGENT_LABEL = 'omp';
const DEFAULT_AGENT_HEARTBEAT_SEC = 20;
const DEFAULT_LIVENESS_CHECK_MS = 2_000;
const DEFAULT_COMMAND_RETRY_MS = 200;
const MAX_COMMAND_RETRIES = 6;
const CLAIM_BIND_TIMEOUT_SEC = 30;
const LEASE_STORE_VERSION = 1;
const LEASE_STORE_FILENAME = 'cu-agent-leases.json';
const MAX_STORE_BYTES = 256 * 1024;
const SECRET_KEYS = new Set(['sessionSecret', 'tokenHash', 'leaseToken', 'token', 'claimNonce', 'mcpToken']);
/** Structured 409 error raised when another agent already holds the CU seat. */
class CuSeatBusyError extends Error {
    status = 409;
    code = 'seat_busy';
    state;
    epoch;
    holder;
    constructor(message, details) {
        super(message);
        this.name = 'CuSeatBusyError';
        this.state = details.state;
        this.epoch = details.epoch;
        this.holder = details.holder;
    }
}
exports.CuSeatBusyError = CuSeatBusyError;
/** Structured 503 error raised when a CU host's configured broker socket is unreachable. */
class CuBrokerUnavailableError extends Error {
    status = 503;
    code = 'cu_broker_unavailable';
    constructor(message = 'Computer-use broker is unavailable') {
        super(message);
        this.name = 'CuBrokerUnavailableError';
    }
}
exports.CuBrokerUnavailableError = CuBrokerUnavailableError;
function pickString(source, key) {
    const value = source[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function pickFiniteNumber(source, key) {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}
function pickPidStartTime(source, key) {
    const value = source[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        return String(value);
    if (typeof value === 'string' && /^\d+$/.test(value.trim()))
        return value.trim();
    return null;
}
function formatPidStartTimeForBroker(startTime) {
    if (/^\d+$/.test(startTime)) {
        const asNum = Number(startTime);
        if (Number.isSafeInteger(asNum) && asNum >= 0)
            return asNum;
    }
    return startTime;
}
function extractRef(value) {
    if (!(0, helper_values_1.record)(value))
        return null;
    const ownerId = pickString(value, 'ownerId');
    const sessionId = pickString(value, 'sessionId');
    const leaseId = pickString(value, 'leaseId');
    if (!ownerId && !sessionId && !leaseId)
        return null;
    return { ownerId, sessionId, leaseId };
}
function sanitizeHolder(value) {
    if (!(0, helper_values_1.record)(value))
        return null;
    const out = {};
    for (const [key, val] of Object.entries(value)) {
        if (SECRET_KEYS.has(key))
            continue;
        out[key] = val;
    }
    return out;
}
function optionalEnvMs(name, min) {
    const raw = process.env[name];
    if (raw === undefined || raw === '')
        return undefined;
    const num = Number(raw);
    return Number.isFinite(num) && num >= min ? num : undefined;
}
function processBirthKey(pid, startTime) {
    return pid !== null && startTime ? `${pid}:${startTime}` : 'unbound';
}
function createDeliveryTracker(generation, processBirth) {
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
function clearDeliveryTimers(tracker) {
    if (tracker.abortRetryTimer) {
        clearTimeout(tracker.abortRetryTimer);
        tracker.abortRetryTimer = null;
    }
    if (tracker.nudgeRetryTimer) {
        clearTimeout(tracker.nudgeRetryTimer);
        tracker.nudgeRetryTimer = null;
    }
}
function parsePersistedRecord(value) {
    if (!(0, helper_values_1.record)(value))
        return null;
    const leaseOwnerId = pickString(value, 'leaseOwnerId');
    const brokerSessionId = pickString(value, 'brokerSessionId');
    if (!leaseOwnerId || !brokerSessionId)
        return null;
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
function createCuAgentLeases(ports) {
    const log = ports.log ?? ((line) => console.error(line));
    const storeFile = ports.storeFile ?? (() => path.join((0, dish_store_1.dishDir)(), LEASE_STORE_FILENAME));
    const processAlive = ports.processAlive ?? ((identity) => (0, process_identity_1.processIdentityAlive)(identity));
    const livenessCheckMs = ports.livenessCheckMs
        ?? optionalEnvMs('PI_DISH_CU_LIVENESS_MS', 25)
        ?? DEFAULT_LIVENESS_CHECK_MS;
    const commandRetryMs = ports.commandRetryMs ?? DEFAULT_COMMAND_RETRY_MS;
    const recordsByBrokerId = new Map();
    const recordsByOwnerId = new Map();
    const brokerIdBySessionId = new Map();
    /** Broker IDs kept only in persisted store when a release failed while broker was down. */
    const persistedOrphans = new Map();
    let stopped = false;
    let reconciled = false;
    let reconcileFlight = null;
    let latestBrokerState = null;
    let latestBrokerEpoch = -1;
    let latestBrokerGeneration = null;
    let livenessTimer = null;
    function loadPersistedStore() {
        if (!ports.broker.configured())
            return;
        const file = storeFile();
        let fd;
        try {
            fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.size > MAX_STORE_BYTES)
                return;
            const parsed = JSON.parse(fs.readFileSync(fd, 'utf8'));
            if (!(0, helper_values_1.record)(parsed) || parsed.version !== LEASE_STORE_VERSION || !Array.isArray(parsed.leases))
                return;
            for (const item of parsed.leases) {
                const persisted = parsePersistedRecord(item);
                if (!persisted || recordsByBrokerId.has(persisted.brokerSessionId))
                    continue;
                const birth = processBirthKey(persisted.pid, persisted.pidStartTime);
                const rec = {
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
        }
        catch (error) {
            if (!(0, helper_values_1.record)(error) || error.code !== 'ENOENT') {
                log(`[cu-lease] could not load persisted lease store: ${(0, http_boundary_1.errorMessage)(error)}`);
            }
        }
        finally {
            if (fd !== undefined)
                fs.closeSync(fd);
        }
    }
    function persistStore() {
        if (!ports.broker.configured())
            return;
        const leases = [];
        const seen = new Set();
        for (const rec of recordsByBrokerId.values()) {
            if (!rec.hasBrokerLease || !rec.leaseOwnerId)
                continue;
            if (rec.status !== 'holding' && rec.status !== 'preempted')
                continue;
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
            if (!seen.has(orphan.brokerSessionId))
                leases.push(orphan);
        }
        const file = storeFile();
        try {
            const dir = path.dirname(file);
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            try {
                fs.chmodSync(dir, 0o700);
            }
            catch { }
            (0, dish_store_1.replaceFileDurably)(file, JSON.stringify({ version: LEASE_STORE_VERSION, leases }) + '\n');
        }
        catch (error) {
            log(`[cu-lease] failed to persist lease store: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
    function resolveHeartbeatMs(brokerIntervalSec) {
        if (ports.heartbeatIntervalMs !== undefined)
            return ports.heartbeatIntervalMs;
        const sec = brokerIntervalSec !== null && brokerIntervalSec >= 5 ? brokerIntervalSec : DEFAULT_AGENT_HEARTBEAT_SEC;
        return sec * 1000;
    }
    function clearHeartbeat(rec) {
        if (rec.heartbeatTimer) {
            clearInterval(rec.heartbeatTimer);
            rec.heartbeatTimer = null;
        }
    }
    function removeRecord(rec, options = {}) {
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
    function maybeStopLivenessMonitor() {
        if (!livenessTimer)
            return;
        for (const rec of recordsByBrokerId.values()) {
            if (rec.pid !== null && rec.pidStartTime && (rec.status === 'holding' || rec.status === 'preempted' || rec.status === 'waiting_for_desktop')) {
                return;
            }
        }
        clearInterval(livenessTimer);
        livenessTimer = null;
    }
    function ensureLivenessMonitor() {
        if (stopped || livenessTimer || livenessCheckMs <= 0)
            return;
        livenessTimer = setInterval(() => {
            if (stopped)
                return;
            for (const rec of [...recordsByBrokerId.values()]) {
                if (rec.pendingStartupReconcile || rec.rebindInProgress)
                    continue;
                if (rec.pid === null || !rec.pidStartTime)
                    continue;
                if (processAlive({ pid: rec.pid, startTime: rec.pidStartTime }))
                    continue;
                void releaseRecord(rec);
            }
            maybeStopLivenessMonitor();
        }, livenessCheckMs);
        livenessTimer.unref();
    }
    function resolveSessionIdForRecord(rec) {
        if (rec.sessionId)
            return rec.sessionId;
        if (rec.pid !== null && rec.pidStartTime && ports.findSessionIdByProcess) {
            if (!processAlive({ pid: rec.pid, startTime: rec.pidStartTime }))
                return null;
            const found = ports.findSessionIdByProcess({ pid: rec.pid, startTime: rec.pidStartTime });
            if (found) {
                rec.sessionId = found;
                brokerIdBySessionId.set(found, rec.brokerSessionId);
                return found;
            }
        }
        return null;
    }
    function recordForSessionId(sessionId) {
        const directBrokerId = brokerIdBySessionId.get(sessionId);
        if (directBrokerId) {
            const direct = recordsByBrokerId.get(directBrokerId);
            if (direct)
                return direct;
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
    function resetRecordDelivery(rec, nextGeneration, nextBirth) {
        clearDeliveryTimers(rec.delivery);
        rec.delivery = createDeliveryTracker(nextGeneration, nextBirth);
    }
    function ensureDeliveryContext(rec, generation) {
        const birth = processBirthKey(rec.pid, rec.pidStartTime);
        if (rec.delivery.generation !== generation || rec.delivery.processBirth !== birth) {
            resetRecordDelivery(rec, generation, birth);
        }
        return rec.delivery;
    }
    function resetAllWatermarks(nextGeneration) {
        latestBrokerEpoch = -1;
        if (nextGeneration !== null)
            latestBrokerGeneration = nextGeneration;
        for (const rec of recordsByBrokerId.values()) {
            const gen = nextGeneration ?? rec.generation ?? 'default';
            if (nextGeneration !== null)
                rec.generation = nextGeneration;
            resetRecordDelivery(rec, gen, processBirthKey(rec.pid, rec.pidStartTime));
        }
    }
    function scheduleCommand(rec, kind, epoch, generation) {
        if (stopped || !rec.hasBrokerLease || !rec.leaseOwnerId)
            return;
        const tracker = ensureDeliveryContext(rec, generation);
        if (kind === 'abort') {
            // An abort supersedes any pending hand-back nudge.
            tracker.pendingNudgeEpoch = null;
            if (tracker.nudgeRetryTimer) {
                clearTimeout(tracker.nudgeRetryTimer);
                tracker.nudgeRetryTimer = null;
            }
            if (epoch <= tracker.ackedAbortEpoch)
                return;
            if (tracker.inFlightAbortEpoch !== null && epoch <= tracker.inFlightAbortEpoch)
                return;
            tracker.pendingAbortEpoch = Math.max(tracker.pendingAbortEpoch ?? -1, epoch);
            tracker.abortRetries = 0;
            void flushCommand(rec, 'abort');
            return;
        }
        // A hand-back nudge supersedes any pending abort.
        tracker.pendingAbortEpoch = null;
        if (tracker.abortRetryTimer) {
            clearTimeout(tracker.abortRetryTimer);
            tracker.abortRetryTimer = null;
        }
        if (epoch <= tracker.ackedNudgeEpoch)
            return;
        if (tracker.inFlightNudgeEpoch !== null && epoch <= tracker.inFlightNudgeEpoch)
            return;
        tracker.pendingNudgeEpoch = Math.max(tracker.pendingNudgeEpoch ?? -1, epoch);
        tracker.nudgeRetries = 0;
        void flushCommand(rec, 'nudge');
    }
    function commandStillValid(rec, kind, targetOwnerId, targetSessionId, targetGen, targetEpoch, targetPid, targetPidStartTime) {
        if (stopped)
            return false;
        if (recordsByBrokerId.get(rec.brokerSessionId) !== rec)
            return false;
        if (rec.leaseOwnerId !== targetOwnerId)
            return false;
        if (rec.sessionId !== targetSessionId)
            return false;
        if (rec.delivery.generation !== targetGen)
            return false;
        if (rec.pid !== targetPid || rec.pidStartTime !== targetPidStartTime)
            return false;
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
    async function flushCommand(rec, kind) {
        if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec)
            return;
        if (!rec.leaseOwnerId)
            return;
        const tracker = rec.delivery;
        const targetEpoch = kind === 'abort' ? tracker.pendingAbortEpoch : tracker.pendingNudgeEpoch;
        if (targetEpoch === null)
            return;
        if (kind === 'abort' && tracker.inFlightAbortEpoch !== null)
            return;
        if (kind === 'nudge' && tracker.inFlightNudgeEpoch !== null)
            return;
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
                        if (kind === 'abort')
                            tracker.abortRetryTimer = null;
                        else
                            tracker.nudgeRetryTimer = null;
                        void flushCommand(rec, kind);
                    }, delayMs);
                    timer.unref();
                    if (kind === 'abort') {
                        if (tracker.abortRetryTimer)
                            clearTimeout(tracker.abortRetryTimer);
                        tracker.abortRetryTimer = timer;
                    }
                    else {
                        if (tracker.nudgeRetryTimer)
                            clearTimeout(tracker.nudgeRetryTimer);
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
        const checkValid = () => commandStillValid(rec, kind, targetOwnerId, sessionId, targetGen, targetEpoch, targetPid, targetPidStartTime);
        if (!checkValid()) {
            if (kind === 'abort')
                tracker.pendingAbortEpoch = null;
            else
                tracker.pendingNudgeEpoch = null;
            if (rec.status === 'idle' && tracker.pendingAbortEpoch === null && tracker.inFlightAbortEpoch === null) {
                removeRecord(rec, { persist: false });
            }
            return;
        }
        if (kind === 'abort') {
            tracker.pendingAbortEpoch = null;
            tracker.inFlightAbortEpoch = targetEpoch;
        }
        else {
            tracker.pendingNudgeEpoch = null;
            tracker.inFlightNudgeEpoch = targetEpoch;
        }
        const target = {
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
                : await ports.resumeSession(target, exports.CU_HAND_BACK_NUDGE);
        }
        catch (error) {
            log(`[cu-lease] ${kind} failed for ${targetOwnerId} at ${targetGen}#${targetEpoch}: ${(0, http_boundary_1.errorMessage)(error)}`);
            delivered = false;
        }
        finally {
            const sameTracker = rec.delivery === tracker && tracker.generation === targetGen && tracker.processBirth === targetBirth;
            if (sameTracker) {
                if (kind === 'abort' && tracker.inFlightAbortEpoch === targetEpoch)
                    tracker.inFlightAbortEpoch = null;
                if (kind === 'nudge' && tracker.inFlightNudgeEpoch === targetEpoch)
                    tracker.inFlightNudgeEpoch = null;
            }
            if (sameTracker && delivered) {
                if (kind === 'abort') {
                    tracker.ackedAbortEpoch = Math.max(tracker.ackedAbortEpoch, targetEpoch);
                    tracker.abortRetries = 0;
                }
                else {
                    tracker.ackedNudgeEpoch = Math.max(tracker.ackedNudgeEpoch, targetEpoch);
                    tracker.nudgeRetries = 0;
                }
            }
            else if (sameTracker && !delivered && checkValid()) {
                // Keep pending (NOT acked!) and schedule bounded retry if still valid.
                const retries = kind === 'abort' ? ++tracker.abortRetries : ++tracker.nudgeRetries;
                if (kind === 'abort') {
                    tracker.pendingAbortEpoch = Math.max(tracker.pendingAbortEpoch ?? -1, targetEpoch);
                }
                else {
                    tracker.pendingNudgeEpoch = Math.max(tracker.pendingNudgeEpoch ?? -1, targetEpoch);
                }
                if (retries <= MAX_COMMAND_RETRIES && commandRetryMs > 0 && !stopped) {
                    const delayMs = Math.min(2_000, commandRetryMs * retries);
                    const timer = setTimeout(() => {
                        if (kind === 'abort')
                            tracker.abortRetryTimer = null;
                        else
                            tracker.nudgeRetryTimer = null;
                        void flushCommand(rec, kind);
                    }, delayMs);
                    timer.unref();
                    if (kind === 'abort') {
                        if (tracker.abortRetryTimer)
                            clearTimeout(tracker.abortRetryTimer);
                        tracker.abortRetryTimer = timer;
                    }
                    else {
                        if (tracker.nudgeRetryTimer)
                            clearTimeout(tracker.nudgeRetryTimer);
                        tracker.nudgeRetryTimer = timer;
                    }
                }
            }
            // Clean up idle lease_lost records once their final abort finishes (acked or exhausted).
            if (rec.status === 'idle'
                && rec.delivery.inFlightAbortEpoch === null
                && (rec.delivery.pendingAbortEpoch === null || rec.delivery.abortRetries > MAX_COMMAND_RETRIES)) {
                removeRecord(rec, { persist: false });
            }
            else if (sameTracker) {
                // Flush if a newer epoch was queued while this command was in flight.
                if (kind === 'abort' && tracker.pendingAbortEpoch !== null && tracker.abortRetryTimer === null && delivered) {
                    void flushCommand(rec, 'abort');
                }
                else if (kind === 'nudge' && tracker.pendingNudgeEpoch !== null && tracker.nudgeRetryTimer === null && delivered) {
                    void flushCommand(rec, 'nudge');
                }
            }
        }
    }
    function flushPendingCommands(rec) {
        if (rec.delivery.pendingAbortEpoch !== null)
            void flushCommand(rec, 'abort');
        if (rec.delivery.pendingNudgeEpoch !== null)
            void flushCommand(rec, 'nudge');
    }
    function startHeartbeat(rec) {
        clearHeartbeat(rec);
        if (stopped || !rec.sessionSecret || rec.heartbeatIntervalMs <= 0)
            return;
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
            if (rec.status !== 'holding')
                return;
            void sendHeartbeat(rec);
        }, rec.heartbeatIntervalMs);
        rec.heartbeatTimer.unref();
    }
    async function sendHeartbeat(rec) {
        const secret = rec.sessionSecret;
        if (!secret || stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec)
            return;
        try {
            const reply = await ports.broker.requestJson('POST', '/v1/lease/heartbeat', {
                sessionId: rec.brokerSessionId,
                sessionSecret: secret,
            });
            if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec)
                return;
            if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
                const ep = pickFiniteNumber(reply.body, 'epoch');
                const gen = pickString(reply.body, 'generation');
                if (ep !== null && ep >= rec.epoch)
                    rec.epoch = ep;
                if (gen)
                    rec.generation = gen;
                return;
            }
            if (reply.status === 409) {
                const body = (0, helper_values_1.record)(reply.body) ? reply.body : {};
                const code = pickString(body, 'code');
                const ep = pickFiniteNumber(body, 'epoch') ?? Math.max(0, rec.epoch);
                const gen = pickString(body, 'generation') ?? rec.generation ?? latestBrokerGeneration ?? 'default';
                if (ep >= rec.epoch)
                    rec.epoch = ep;
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
        }
        catch {
            // Transient broker hiccup: retry on the next heartbeat interval.
        }
    }
    function refMatchesRecord(ref, rec) {
        if (!ref || !rec.hasBrokerLease)
            return false;
        if (ref.ownerId !== null && rec.leaseOwnerId !== null) {
            return ref.ownerId === rec.leaseOwnerId;
        }
        if (ref.sessionId !== null && ref.sessionId === rec.brokerSessionId)
            return true;
        if (ref.leaseId !== null && rec.leaseId !== null && ref.leaseId === rec.leaseId)
            return true;
        return false;
    }
    function findRecordForRef(ref) {
        if (!ref)
            return null;
        if (ref.ownerId !== null) {
            const byOwner = recordsByOwnerId.get(ref.ownerId);
            if (byOwner)
                return byOwner;
            // When broker supplies an explicit ownerId, do not fall back to a different owner.
            return null;
        }
        if (ref.sessionId !== null) {
            const direct = recordsByBrokerId.get(ref.sessionId);
            if (direct)
                return direct;
        }
        for (const rec of recordsByBrokerId.values()) {
            if (refMatchesRecord(ref, rec))
                return rec;
        }
        return null;
    }
    async function releaseWithoutSecret(info) {
        // Re-adopted record without sessionSecret: verify exact ownerId on broker before any force call.
        const statusReply = await ports.broker.requestJson('GET', '/v1/status');
        if (statusReply.status !== 200 || !(0, helper_values_1.record)(statusReply.body))
            return false;
        const st = pickString(statusReply.body, 'state');
        const activeLease = (0, helper_values_1.record)(statusReply.body.lease) ? statusReply.body.lease : null;
        const preempted = (0, helper_values_1.record)(statusReply.body.preempted) ? statusReply.body.preempted : null;
        const target = { hasBrokerLease: true, ...info };
        if (preempted && refMatchesRecord(extractRef(preempted), target)) {
            const cancelReply = await ports.broker.requestJson('POST', '/v1/lease/cancel-preempted', {
                sessionId: info.brokerSessionId,
                force: true,
            });
            if (cancelReply.status === 409 && (0, helper_values_1.record)(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
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
    async function releaseRecord(rec) {
        const { brokerSessionId, leaseOwnerId, leaseId, hasBrokerLease, status, sessionSecret, epoch, generation, pid, pidStartTime, createdAt, } = rec;
        removeRecord(rec, { persist: false });
        if (!hasBrokerLease || status === 'waiting_for_desktop' || status === 'idle') {
            persistStore();
            return;
        }
        const rememberOrphanForReconcile = () => {
            if (!leaseOwnerId)
                return;
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
                if (!ok)
                    rememberOrphanForReconcile();
                else
                    persistStore();
                return;
            }
            if (status === 'preempted') {
                const cancelReply = await ports.broker.requestJson('POST', '/v1/lease/cancel-preempted', {
                    sessionId: brokerSessionId,
                    sessionSecret,
                });
                if (cancelReply.status === 409 && (0, helper_values_1.record)(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
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
                if (cancelReply.status === 409 && (0, helper_values_1.record)(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
                    await ports.broker.requestJson('POST', '/v1/lease/release', {
                        sessionId: brokerSessionId,
                        sessionSecret,
                    });
                }
            }
            persistStore();
        }
        catch (error) {
            log(`[cu-lease] release/cancel failed for ${leaseOwnerId ?? brokerSessionId}: ${(0, http_boundary_1.errorMessage)(error)}`);
            rememberOrphanForReconcile();
        }
    }
    async function reconcile() {
        if (stopped || !ports.broker.configured()) {
            reconciled = true;
            return;
        }
        if (reconcileFlight)
            return reconcileFlight;
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
            }
            catch (error) {
                log(`[cu-lease] startup reconciliation deferred (broker unreachable): ${(0, http_boundary_1.errorMessage)(error)}`);
                reconciled = false;
                return;
            }
            if (stopped)
                return;
            if (reply.status !== 200 || !(0, helper_values_1.record)(reply.body)) {
                reconciled = false;
                return;
            }
            const brokerState = pickString(reply.body, 'state') ?? 'idle';
            const brokerEpoch = pickFiniteNumber(reply.body, 'epoch') ?? 0;
            const brokerGeneration = pickString(reply.body, 'generation');
            const activeLease = (0, helper_values_1.record)(reply.body.lease) ? reply.body.lease : null;
            const activeLeaseRef = extractRef(activeLease);
            const activeIsAgent = (brokerState === 'agent' || brokerState === 'waiting_for_human')
                && activeLease !== null
                && pickString(activeLease, 'holderKind') !== 'human';
            const preempted = (0, helper_values_1.record)(reply.body.preempted) ? reply.body.preempted : null;
            const preemptedRef = extractRef(preempted);
            if (brokerGeneration)
                latestBrokerGeneration = brokerGeneration;
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
                        if (cancelReply.status === 409 && (0, helper_values_1.record)(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
                            await ports.broker.requestJson('POST', '/v1/lease/release', {
                                sessionId: orphan.brokerSessionId,
                                ...(orphan.leaseId ? { leaseId: orphan.leaseId } : {}),
                                force: true,
                            });
                        }
                    }
                    else if (isActive) {
                        await ports.broker.requestJson('POST', '/v1/lease/release', {
                            sessionId: orphan.brokerSessionId,
                            ...(orphan.leaseId ? { leaseId: orphan.leaseId } : {}),
                            force: true,
                        });
                    }
                    persistedOrphans.delete(orphan.brokerSessionId);
                }
                catch (error) {
                    log(`[cu-lease] orphan cleanup failed for ${orphan.leaseOwnerId}: ${(0, http_boundary_1.errorMessage)(error)}`);
                }
            }
            // Reconcile persisted launch records against broker status and live processes.
            for (const rec of pendingRecords) {
                if (recordsByBrokerId.get(rec.brokerSessionId) !== rec)
                    continue;
                rec.pendingStartupReconcile = false;
                const isActive = activeIsAgent && refMatchesRecord(activeLeaseRef, rec);
                const isDisplaced = preemptedRef !== null && refMatchesRecord(preemptedRef, rec);
                if (!isActive && !isDisplaced) {
                    removeRecord(rec, { persist: false });
                    continue;
                }
                const matchedObj = isActive ? activeLease : preempted;
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
                            if (cancelReply.status === 409 && (0, helper_values_1.record)(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
                                await ports.broker.requestJson('POST', '/v1/lease/release', {
                                    sessionId: rec.brokerSessionId,
                                    ...(rec.leaseId ? { leaseId: rec.leaseId } : {}),
                                    force: true,
                                });
                            }
                        }
                        else {
                            await ports.broker.requestJson('POST', '/v1/lease/release', {
                                sessionId: rec.brokerSessionId,
                                ...(rec.leaseId ? { leaseId: rec.leaseId } : {}),
                                force: true,
                            });
                        }
                    }
                    catch (error) {
                        log(`[cu-lease] startup orphan cleanup failed for ${rec.leaseOwnerId}: ${(0, http_boundary_1.errorMessage)(error)}`);
                    }
                    removeRecord(rec, { persist: false });
                    continue;
                }
                // Process is alive AND broker still tracks this exact leaseOwnerId -> re-adopt!
                rec.pid = effectivePid;
                rec.pidStartTime = effectiveStart;
                rec.leaseId = pickString(matchedObj, 'leaseId') ?? rec.leaseId;
                rec.epoch = brokerEpoch;
                if (brokerGeneration)
                    rec.generation = brokerGeneration;
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
        }
        finally {
            if (reconcileFlight === flight)
                reconcileFlight = null;
        }
    }
    async function requestBrokerOrUnavailable(method, endpoint, body) {
        try {
            const reply = await ports.broker.requestJson(method, endpoint, body);
            if (reply.status === 503) {
                const msg = (0, helper_values_1.record)(reply.body)
                    ? (pickString(reply.body, 'message') ?? pickString(reply.body, 'error') ?? 'Computer-use broker is unavailable')
                    : 'Computer-use broker is unavailable';
                throw new CuBrokerUnavailableError(msg);
            }
            return reply;
        }
        catch (error) {
            if (error instanceof CuBrokerUnavailableError)
                throw error;
            const errStatus = (0, helper_values_1.record)(error) && typeof error.status === 'number' ? error.status : null;
            const errCode = (0, helper_values_1.record)(error) && typeof error.code === 'string' ? error.code : null;
            if (errStatus === 503
                || errCode === 'ENOENT'
                || errCode === 'ECONNREFUSED'
                || errCode === 'ECONNRESET'
                || errCode === 'EPIPE'
                || errCode === 'ETIMEDOUT') {
                throw new CuBrokerUnavailableError(`Computer-use broker is unavailable: ${(0, http_boundary_1.errorMessage)(error)}`);
            }
            throw error;
        }
    }
    async function mintClaimFile(brokerSessionId, sessionSecret, requireRebind) {
        const reply = await requestBrokerOrUnavailable('POST', '/v1/lease/claim-nonce', {
            sessionId: brokerSessionId,
            sessionSecret,
            bindTimeoutSec: CLAIM_BIND_TIMEOUT_SEC,
            requireRebind,
        });
        if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
            const claimFile = pickString(reply.body, 'claimFile');
            // Deliberately discard reply.body.claimNonce — never log, store, or pass it.
            if (!claimFile) {
                return { ok: false, status: 502, code: 'missing_claim_file', message: 'cu-broker did not return a claimFile path' };
            }
            return { ok: true, claimFile };
        }
        const body = (0, helper_values_1.record)(reply.body) ? reply.body : {};
        return {
            ok: false,
            status: reply.status >= 400 ? reply.status : 502,
            code: pickString(body, 'code'),
            message: pickString(body, 'message') ?? pickString(body, 'error') ?? `cu-broker claim-nonce failed (${reply.status})`,
        };
    }
    async function prepareSpawn(options) {
        if (stopped || !ports.broker.configured())
            return null;
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
                                CU_BROKER_LABEL: exports.BROKER_AGENT_LABEL,
                            }),
                            waitingForDesktop: false,
                            reusedExisting: true,
                            acquiredEpoch: existing.epoch,
                        };
                    }
                    if (claim.status === 409 && (claim.code === 'lease_not_found' || claim.code === 'not_agent_lease')) {
                        removeRecord(existing);
                    }
                    else {
                        throw (0, http_boundary_1.httpError)(claim.message, claim.status);
                    }
                }
                else {
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
            label: exports.BROKER_AGENT_LABEL,
        });
        if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
            const confirmedSessionId = pickString(reply.body, 'sessionId') ?? brokerSessionId;
            const sessionSecret = pickString(reply.body, 'sessionSecret') ?? pickString(reply.body, 'token');
            if (!sessionSecret) {
                throw (0, http_boundary_1.httpError)('cu-broker did not return an agent lease secret', 502);
            }
            const epoch = pickFiniteNumber(reply.body, 'epoch') ?? 0;
            const generation = pickString(reply.body, 'generation') ?? latestBrokerGeneration;
            const hbSec = pickFiniteNumber(reply.body, 'heartbeatIntervalSec');
            const leaseObj = (0, helper_values_1.record)(reply.body.lease) ? reply.body.lease : null;
            const leaseId = pickString(reply.body, 'leaseId') ?? (leaseObj ? pickString(leaseObj, 'leaseId') : null);
            let claim;
            try {
                claim = await mintClaimFile(confirmedSessionId, sessionSecret, false);
            }
            catch (claimError) {
                await ports.broker.requestJson('POST', '/v1/lease/release', {
                    sessionId: confirmedSessionId,
                    sessionSecret,
                }).catch(() => { });
                throw claimError;
            }
            if (!claim.ok) {
                // Compensate immediately so a failed claim-nonce never leaves an orphaned active lease.
                await ports.broker.requestJson('POST', '/v1/lease/release', {
                    sessionId: confirmedSessionId,
                    sessionSecret,
                }).catch(() => { });
                throw (0, http_boundary_1.httpError)(claim.message, claim.status);
            }
            const rec = {
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
            if (knownSessionId)
                brokerIdBySessionId.set(knownSessionId, confirmedSessionId);
            if (generation)
                latestBrokerGeneration = generation;
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
                    CU_BROKER_LABEL: exports.BROKER_AGENT_LABEL,
                }),
                waitingForDesktop: false,
                reusedExisting: false,
                acquiredEpoch: epoch,
            };
        }
        if (reply.status === 409 && (0, helper_values_1.record)(reply.body)) {
            const leaseObj = (0, helper_values_1.record)(reply.body.lease) ? reply.body.lease : null;
            const busyState = pickString(reply.body, 'state')
                ?? (leaseObj && pickString(leaseObj, 'holderKind') === 'human' ? 'human' : null);
            const epoch = pickFiniteNumber(reply.body, 'epoch');
            const generation = pickString(reply.body, 'generation');
            if (generation)
                latestBrokerGeneration = generation;
            if (busyState === 'human') {
                // Human holds the desktop: spawn omp without a claim file or secret so
                // computer tools are blocked while the human works, and surface waiting_for_desktop.
                const rec = {
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
                if (knownSessionId)
                    brokerIdBySessionId.set(knownSessionId, brokerSessionId);
                if (epoch !== null && epoch >= latestBrokerEpoch) {
                    latestBrokerEpoch = epoch;
                    latestBrokerState = 'human';
                }
                return {
                    brokerSessionId,
                    leaseOwnerId: null,
                    env: Object.freeze({
                        CU_BROKER_SESSION_ID: brokerSessionId,
                        CU_BROKER_LABEL: exports.BROKER_AGENT_LABEL,
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
        const message = (0, helper_values_1.record)(reply.body)
            ? (pickString(reply.body, 'message') ?? pickString(reply.body, 'error') ?? `cu-broker acquire failed (${reply.status})`)
            : `cu-broker acquire failed (${reply.status})`;
        throw (0, http_boundary_1.httpError)(message, reply.status >= 400 ? reply.status : 502);
    }
    async function bindSpawnedProcess(handle, proc) {
        const rec = recordsByBrokerId.get(handle.brokerSessionId);
        if (!rec) {
            if (handle.waitingForDesktop)
                return;
            throw (0, http_boundary_1.httpError)('Computer-use agent lease was lost before process bind', 409);
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
        if (handle.reusedExisting)
            rec.reboundNewProcess = true;
        if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 1 || !proc.startTime) {
            rec.rebindInProgress = false;
            throw (0, http_boundary_1.httpError)('Could not verify spawned omp process identity for computer-use lease bind', 500);
        }
        if (!rec.sessionSecret || !rec.leaseOwnerId) {
            rec.rebindInProgress = false;
            throw (0, http_boundary_1.httpError)('Computer-use agent lease credentials are unavailable for bind', 409);
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
            label: exports.BROKER_AGENT_LABEL,
            pid: proc.pid,
            pidStartTime: formatPidStartTimeForBroker(proc.startTime),
        });
        if (reply.status !== 200 || !(0, helper_values_1.record)(reply.body)) {
            const body = (0, helper_values_1.record)(reply.body) ? reply.body : {};
            const message = pickString(body, 'message') ?? pickString(body, 'error') ?? `cu-broker lease bind failed (${reply.status})`;
            throw (0, http_boundary_1.httpError)(message, reply.status >= 400 ? reply.status : 502);
        }
        const ep = pickFiniteNumber(reply.body, 'epoch');
        const gen = pickString(reply.body, 'generation');
        const st = pickString(reply.body, 'state');
        const target = pickString(reply.body, 'target');
        if (ep !== null)
            rec.epoch = ep;
        if (gen) {
            rec.generation = gen;
            latestBrokerGeneration = gen;
            ensureDeliveryContext(rec, gen);
        }
        if (target === 'displaced' || st === 'human') {
            rec.status = 'preempted';
            scheduleCommand(rec, 'abort', rec.epoch, rec.generation ?? latestBrokerGeneration ?? 'default');
        }
        else {
            rec.status = 'holding';
        }
        persistStore();
    }
    function attachSpawnedSession(handle, info) {
        const rec = recordsByBrokerId.get(handle.brokerSessionId);
        if (!rec)
            return;
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
    async function abortSpawn(handle) {
        const rec = recordsByBrokerId.get(handle.brokerSessionId);
        if (!rec)
            return;
        rec.rebindInProgress = false;
        if (handle.reusedExisting && !rec.reboundNewProcess) {
            // respawnPane failed before replacing the existing pane: preserve the live old pane's lease.
            return;
        }
        await releaseRecord(rec);
    }
    async function releaseSession(sessionId) {
        const rec = recordForSessionId(sessionId);
        if (!rec)
            return;
        await releaseRecord(rec);
    }
    function handleSessionRetired(sessionId) {
        const rec = recordForSessionId(sessionId);
        if (!rec || rec.rebindInProgress)
            return;
        // Only release/cancel on bridge retirement if the OS process is actually gone.
        if (rec.pid !== null && rec.pidStartTime && processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
            return;
        }
        void releaseRecord(rec);
    }
    function adoptSessionSwitch(previousSessionId, nextSessionId) {
        if (!previousSessionId || !nextSessionId || previousSessionId === nextSessionId)
            return;
        const rec = recordForSessionId(previousSessionId);
        if (!rec)
            return;
        if (brokerIdBySessionId.get(previousSessionId) === rec.brokerSessionId) {
            brokerIdBySessionId.delete(previousSessionId);
        }
        rec.sessionId = nextSessionId;
        brokerIdBySessionId.set(nextSessionId, rec.brokerSessionId);
    }
    function handleBrokerEvent(event) {
        if (stopped)
            return;
        const { eventName, authoritativeHello, payload } = event;
        const state = pickString(payload, 'state');
        const epoch = pickFiniteNumber(payload, 'epoch');
        if (state === null || epoch === null)
            return;
        const generation = event.generation ?? pickString(payload, 'generation');
        const isResync = event.isResync === true || eventName === 'resync';
        const generationChanged = event.generationChanged === true
            || (generation !== null && latestBrokerGeneration !== null && generation !== latestBrokerGeneration);
        if (generationChanged || isResync || (authoritativeHello && epoch < latestBrokerEpoch)) {
            resetAllWatermarks(generation);
        }
        else {
            if (generation !== null && latestBrokerGeneration === null) {
                latestBrokerGeneration = generation;
            }
            if (!authoritativeHello && epoch < latestBrokerEpoch)
                return;
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
                if (generation)
                    rec.generation = generation;
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
                if (generation)
                    rec.generation = generation;
                storeDirty = true;
                scheduleCommand(rec, 'nudge', epoch, effectiveGen);
            }
        }
        else if ((eventName === 'hello' || isResync) && state === 'agent' && leaseRef) {
            // Reconnect/resync recovery: if hand_back occurred while SSE was down or lagged, nudge once.
            const rec = findRecordForRef(leaseRef);
            if (rec && rec.hasBrokerLease && rec.status === 'preempted') {
                rec.status = 'holding';
                rec.epoch = epoch;
                if (generation)
                    rec.generation = generation;
                storeDirty = true;
                scheduleCommand(rec, 'nudge', epoch, effectiveGen);
            }
        }
        if (state === 'idle') {
            for (const rec of [...recordsByBrokerId.values()]) {
                if (rec.pendingStartupReconcile)
                    continue;
                if (rec.status === 'waiting_for_desktop') {
                    removeRecord(rec, { persist: false });
                }
                else if ((rec.status === 'holding' || rec.status === 'preempted') && (authoritativeHello || isResync || epoch >= rec.epoch)) {
                    const wasHolding = rec.status === 'holding';
                    const unexpectedLoss = wasHolding && (reason === 'ttl_expired' || reason === 'hard_cap_expired');
                    clearHeartbeat(rec);
                    rec.sessionSecret = null;
                    rec.status = 'idle';
                    rec.epoch = epoch;
                    if (generation)
                        rec.generation = generation;
                    storeDirty = true;
                    if (unexpectedLoss) {
                        scheduleCommand(rec, 'abort', epoch, effectiveGen);
                    }
                    else {
                        removeRecord(rec, { persist: false });
                    }
                }
            }
            if (storeDirty)
                persistStore();
            return;
        }
        if (state === 'agent' || state === 'waiting_for_human') {
            for (const rec of [...recordsByBrokerId.values()]) {
                if (rec.pendingStartupReconcile)
                    continue;
                if (refMatchesRecord(leaseRef, rec)) {
                    rec.status = 'holding';
                    rec.epoch = epoch;
                    if (generation)
                        rec.generation = generation;
                }
                else if (rec.status === 'waiting_for_desktop') {
                    removeRecord(rec, { persist: false });
                }
                else if ((rec.status === 'holding' || rec.status === 'preempted') && (authoritativeHello || isResync || epoch > rec.epoch)) {
                    removeRecord(rec, { persist: false });
                    storeDirty = true;
                }
            }
            if (storeDirty)
                persistStore();
            return;
        }
        if (state === 'human') {
            for (const rec of [...recordsByBrokerId.values()]) {
                if (rec.pendingStartupReconcile || !rec.hasBrokerLease)
                    continue;
                if (refMatchesRecord(preemptedRef, rec))
                    continue;
                if ((rec.status === 'holding' || rec.status === 'preempted') && (authoritativeHello || isResync || epoch >= rec.epoch)) {
                    // Broker is in human state without this record in preempted (e.g. preempted_cancelled / preempted_reaped).
                    removeRecord(rec, { persist: false });
                    storeDirty = true;
                }
            }
            if (storeDirty)
                persistStore();
        }
    }
    function ownerIdForSession(sessionId) {
        const rec = recordForSessionId(sessionId);
        if (!rec || !rec.hasBrokerLease || !rec.leaseOwnerId)
            return null;
        if (rec.status !== 'holding' && rec.status !== 'preempted')
            return null;
        if (rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
            return null;
        }
        return rec.leaseOwnerId;
    }
    function isWaitingForDesktop(sessionId) {
        const rec = recordForSessionId(sessionId);
        if (!rec || rec.status !== 'waiting_for_desktop')
            return false;
        return latestBrokerState === null || latestBrokerState === 'human';
    }
    function getSessionSeatState(sessionId) {
        return isWaitingForDesktop(sessionId) ? 'waiting_for_desktop' : null;
    }
    function stop() {
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
