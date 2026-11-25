// Generated from src/core/cu-agent-leases.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CuBrokerUnavailableError = exports.CuSeatBusyError = exports.REQUIRED_SLICE2_CAPABILITIES = exports.BROKER_AGENT_LABEL = exports.CU_HAND_BACK_NUDGE = void 0;
exports.hasSlice2Capabilities = hasSlice2Capabilities;
exports.createCuAgentLeases = createCuAgentLeases;
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
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dish_store_1 = require("./dish-store");
const http_boundary_1 = require("./http-boundary");
const helper_values_1 = require("./helper-values");
const process_identity_1 = require("./process-identity");
exports.CU_HAND_BACK_NUDGE = 'The desktop has been returned to you after human take-over. Inspect the current screen and browser state before continuing.';
exports.BROKER_AGENT_LABEL = 'omp';
exports.REQUIRED_SLICE2_CAPABILITIES = [
    'bind',
    'cancel_preempted',
    'ordered_sse',
    'claim_handoff',
];
const DEFAULT_AGENT_HEARTBEAT_SEC = 20;
const DEFAULT_LIVENESS_CHECK_MS = 2_000;
const DEFAULT_COMMAND_RETRY_MS = 200;
const MAX_COMMAND_RETRIES = 6;
const CLAIM_BIND_TIMEOUT_SEC = 30;
const LEASE_STORE_VERSION = 1;
const LEASE_STORE_FILENAME = 'cu-agent-leases.json';
const MAX_STORE_BYTES = 256 * 1024;
const SECRET_KEYS = new Set(['sessionSecret', 'tokenHash', 'leaseToken', 'token', 'claimNonce', 'mcpToken']);
const TRANSPORT_ERROR_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EAGAIN', 'ENOTSOCK']);
/** Structured 409 error raised when another agent or human holds the CU seat. */
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
/** Structured 503 error raised when a CU host's configured broker socket is unreachable or times out. */
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
function pickNonNegInt(source, key) {
    const value = source[key];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
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
function hasSlice2Capabilities(body) {
    if (!(0, helper_values_1.record)(body) || !Array.isArray(body.capabilities))
        return false;
    const caps = new Set(body.capabilities.filter((item) => typeof item === 'string'));
    return exports.REQUIRED_SLICE2_CAPABILITIES.every(cap => caps.has(cap));
}
function extractRef(value) {
    if (!(0, helper_values_1.record)(value))
        return null;
    const ownerId = pickString(value, 'ownerId');
    return ownerId ? { ownerId } : null;
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
    return pid !== null && pid > 1 && startTime ? `${pid}:${startTime}` : 'unbound';
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
    const pidAlive = ports.pidAlive ?? ((pid) => (0, process_identity_1.processIdentity)(pid) !== null);
    const livenessCheckMs = ports.livenessCheckMs
        ?? optionalEnvMs('PI_DISH_CU_LIVENESS_MS', 25)
        ?? DEFAULT_LIVENESS_CHECK_MS;
    const commandRetryMs = ports.commandRetryMs ?? DEFAULT_COMMAND_RETRY_MS;
    const recordsByBrokerId = new Map();
    const recordsByOwnerId = new Map();
    const brokerIdBySessionId = new Map();
    let stopped = false;
    let reconciled = false;
    let reconcileFlight = null;
    let knownGeneration = null;
    let knownCursor = -1;
    let knownEpoch = -1;
    let lastResyncHandledKey = null;
    let livenessTimer = null;
    function hasLiveClaimedPeer(obj) {
        if (!obj || obj.mcpClaimed !== true)
            return false;
        const claimedPid = pickFiniteNumber(obj, 'claimedPid');
        if (claimedPid === null || claimedPid <= 1)
            return false;
        const claimedPeer = (0, helper_values_1.record)(obj.claimedPeer) ? obj.claimedPeer : null;
        const claimedStart = claimedPeer ? pickPidStartTime(claimedPeer, 'pidStartTime') : null;
        if (claimedStart !== null) {
            return processAlive({ pid: claimedPid, startTime: claimedStart });
        }
        return pidAlive(claimedPid);
    }
    /**
     * Single ordering rule for HTTP replies, reconciliation snapshots, and SSE events.
     * Within a generation, `cursor` is the total order (§9.1); `epoch` breaks ties or
     * serves as fallback when a reply omits `cursor`.
     */
    function comparePosition(incoming, options = {}) {
        if (incoming.generation !== null && knownGeneration !== null && incoming.generation !== knownGeneration) {
            if (options.sourceGeneration && incoming.generation === options.sourceGeneration) {
                // Known state already moved to a newer generation while this HTTP request was in flight.
                return 'stale';
            }
            return options.allowNewGeneration ? 'new_generation' : 'stale';
        }
        if (incoming.cursor !== null && knownCursor >= 0) {
            if (incoming.cursor < knownCursor)
                return 'stale';
            if (incoming.cursor > knownCursor)
                return 'newer';
            if (incoming.epoch !== null && knownEpoch >= 0) {
                if (incoming.epoch < knownEpoch)
                    return 'stale';
                if (incoming.epoch > knownEpoch)
                    return 'newer';
            }
            return 'same';
        }
        if (incoming.epoch !== null && knownEpoch >= 0) {
            if (incoming.epoch < knownEpoch)
                return 'stale';
            if (incoming.epoch > knownEpoch)
                return 'newer';
            return 'same';
        }
        return 'newer';
    }
    function advanceGlobalPosition(incoming, resetForNewGeneration) {
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
    function isRecordObservationStale(rec, incoming) {
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
    function updateRecordPosition(rec, incoming) {
        const genChanged = incoming.generation !== null && rec.generation !== null && incoming.generation !== rec.generation;
        if (genChanged) {
            rec.generation = incoming.generation;
            rec.lastCursor = incoming.cursor ?? -1;
            if (incoming.epoch !== null)
                rec.epoch = incoming.epoch;
            return;
        }
        if (incoming.generation !== null)
            rec.generation = incoming.generation;
        if (incoming.cursor !== null && incoming.cursor > rec.lastCursor)
            rec.lastCursor = incoming.cursor;
        if (incoming.epoch !== null && incoming.epoch >= rec.epoch)
            rec.epoch = incoming.epoch;
    }
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
                    createdAt: persisted.createdAt,
                    leaseId: persisted.leaseId,
                    sessionSecret: null,
                    sessionId: null,
                    status: 'access_lost',
                    epoch: persisted.epoch,
                    lastCursor: -1,
                    generation: persisted.generation,
                    pid: persisted.pid,
                    pidStartTime: persisted.pidStartTime,
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
        for (const rec of recordsByBrokerId.values()) {
            if (rec.status !== 'holding' && rec.status !== 'preempted' && rec.status !== 'access_lost')
                continue;
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
    function markAccessLost(rec) {
        clearHeartbeat(rec);
        rec.sessionSecret = null;
        rec.status = 'access_lost';
    }
    function removeRecord(rec, options = {}) {
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
    function maybeStopLivenessMonitor() {
        if (!livenessTimer)
            return;
        for (const rec of recordsByBrokerId.values()) {
            if (rec.pid !== null && rec.pidStartTime && (rec.status === 'holding' || rec.status === 'preempted' || rec.status === 'access_lost')) {
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
                if (rec.pendingStartupReconcile)
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
        if (rec.pid !== null && rec.pid > 1 && rec.pidStartTime && ports.findSessionIdByProcess) {
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
    function resetAllWatermarksForNewGeneration(nextGeneration) {
        knownEpoch = -1;
        knownCursor = -1;
        lastResyncHandledKey = null;
        if (nextGeneration !== null)
            knownGeneration = nextGeneration;
        for (const rec of recordsByBrokerId.values()) {
            const gen = nextGeneration ?? rec.generation ?? 'default';
            if (nextGeneration !== null)
                rec.generation = nextGeneration;
            rec.epoch = -1;
            rec.lastCursor = -1;
            resetRecordDelivery(rec, gen, processBirthKey(rec.pid, rec.pidStartTime));
        }
    }
    function scheduleCommand(rec, kind, epoch, generation) {
        if (stopped)
            return;
        // P1-8: Never dispatch to an unbound record; birth must be proved before delivery.
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
    async function flushCommand(rec, kind) {
        if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec)
            return;
        const tracker = rec.delivery;
        const targetEpoch = kind === 'abort' ? tracker.pendingAbortEpoch : tracker.pendingNudgeEpoch;
        if (targetEpoch === null)
            return;
        if (kind === 'abort' && tracker.inFlightAbortEpoch !== null)
            return;
        if (kind === 'nudge' && tracker.inFlightNudgeEpoch !== null)
            return;
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
            if (rec.status === 'idle'
                && rec.delivery.inFlightAbortEpoch === null
                && (rec.delivery.pendingAbortEpoch === null || rec.delivery.abortRetries > MAX_COMMAND_RETRIES)) {
                removeRecord(rec, { persist: false });
            }
            else if (sameTracker) {
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
        if (stopped || !rec.sessionSecret || rec.adoptedWithoutSecret || rec.heartbeatIntervalMs <= 0)
            return;
        rec.heartbeatTimer = setInterval(() => {
            if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec) {
                clearHeartbeat(rec);
                return;
            }
            if (!rec.sessionSecret || rec.adoptedWithoutSecret) {
                clearHeartbeat(rec);
                return;
            }
            if (rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
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
        if (!secret || rec.adoptedWithoutSecret || stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec)
            return;
        const sentGeneration = rec.generation;
        const sentEpoch = rec.epoch;
        const sentCursor = rec.lastCursor;
        try {
            const reply = await ports.broker.requestJson('POST', '/v1/lease/heartbeat', {
                sessionId: rec.brokerSessionId,
                sessionSecret: secret,
            });
            if (stopped || recordsByBrokerId.get(rec.brokerSessionId) !== rec)
                return;
            const body = (0, helper_values_1.record)(reply.body) ? reply.body : {};
            const gen = pickString(body, 'generation');
            const cursor = pickNonNegInt(body, 'cursor');
            const ep = pickFiniteNumber(body, 'epoch');
            const pos = { generation: gen, cursor, epoch: ep };
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
            if (reply.status === 200 && (0, helper_values_1.record)(reply.body)) {
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
                }
                else {
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
                }
                else {
                    clearHeartbeat(rec);
                    rec.sessionSecret = null;
                    rec.status = 'idle';
                }
                persistStore();
                scheduleCommand(rec, 'abort', Math.max(0, rec.epoch), effectiveGen);
            }
        }
        catch {
            // Transient broker hiccup: retry on the next heartbeat interval.
        }
    }
    /** Strict full ownerId equality only (never falls back to weaker sessionId/leaseId). */
    function refMatchesRecord(ref, rec) {
        return ref !== null && ref.ownerId !== null && ref.ownerId === rec.leaseOwnerId;
    }
    function findRecordForRef(ref) {
        if (!ref || ref.ownerId === null)
            return null;
        return recordsByOwnerId.get(ref.ownerId) ?? null;
    }
    async function releaseRecord(rec) {
        const { brokerSessionId, leaseOwnerId, status, sessionSecret, } = rec;
        removeRecord(rec, { persist: true });
        if (status === 'idle' || status === 'access_lost') {
            return;
        }
        // P1-2: Never issue force:true mutations for secretless / re-adopted records.
        // Leave cleanup to broker TTL/PID reaping.
        if (!sessionSecret) {
            return;
        }
        if (!ports.broker.available()) {
            return;
        }
        try {
            if (status === 'preempted') {
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
                if (cancelReply.status === 409 && (0, helper_values_1.record)(cancelReply.body) && pickString(cancelReply.body, 'code') === 'lease_active') {
                    await ports.broker.requestJson('POST', '/v1/lease/release', {
                        sessionId: brokerSessionId,
                        sessionSecret,
                    });
                }
            }
        }
        catch (error) {
            log(`[cu-lease] authenticated release/cancel failed for ${leaseOwnerId}: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
    async function requestBrokerOrUnavailable(method, endpoint, body) {
        try {
            const reply = await ports.broker.requestJson(method, endpoint, body);
            if (reply.status === 502 || reply.status === 503 || reply.status === 504) {
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
            const errHttpStatus = (0, http_boundary_1.errorStatus)(error, 0);
            const errCode = (0, helper_values_1.record)(error) && typeof error.code === 'string' ? error.code : null;
            if (errHttpStatus === 502
                || errHttpStatus === 503
                || errHttpStatus === 504
                || (errCode !== null && TRANSPORT_ERROR_CODES.has(errCode))) {
                throw new CuBrokerUnavailableError(`Computer-use broker is unavailable: ${(0, http_boundary_1.errorMessage)(error)}`);
            }
            throw error;
        }
    }
    /**
     * P1-4: Feature-detect Slice 2 via §9.1 `capabilities` array BEFORE any mutation.
     * - Unconfigured host -> false (non-CU host).
     * - Configured but missing/unreachable/timing-out socket -> throws CuBrokerUnavailableError (503 fail-closed).
     * - Responding Slice-1 broker (missing required capabilities) -> false (legacy launch preserved).
     * - Responding Slice-2 broker -> true.
     */
    async function supportsSlice2() {
        if (stopped || !ports.broker.configured())
            return false;
        if (!ports.broker.available()) {
            throw new CuBrokerUnavailableError('Computer-use broker is unavailable');
        }
        const reply = await requestBrokerOrUnavailable('GET', '/v1/status');
        if (reply.status !== 200 || !(0, helper_values_1.record)(reply.body)) {
            throw new CuBrokerUnavailableError(`Computer-use broker status check failed (${reply.status})`);
        }
        return hasSlice2Capabilities(reply.body);
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
            if (!hasSlice2Capabilities(reply.body)) {
                // Responding Slice-1 broker: drop stale local records without mutating broker.
                for (const rec of pendingRecords)
                    removeRecord(rec, { persist: false });
                reconciled = true;
                persistStore();
                return;
            }
            const brokerState = pickString(reply.body, 'state') ?? 'idle';
            const brokerEpoch = pickFiniteNumber(reply.body, 'epoch') ?? 0;
            const brokerGeneration = pickString(reply.body, 'generation');
            const brokerCursor = pickNonNegInt(reply.body, 'cursor');
            const pos = { generation: brokerGeneration, cursor: brokerCursor, epoch: brokerEpoch };
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
            const activeLease = (0, helper_values_1.record)(reply.body.lease) ? reply.body.lease : null;
            const activeLeaseRef = extractRef(activeLease);
            const activeIsAgent = (brokerState === 'agent' || brokerState === 'waiting_for_human')
                && activeLease !== null
                && pickString(activeLease, 'holderKind') !== 'human';
            const preempted = (0, helper_values_1.record)(reply.body.preempted) ? reply.body.preempted : null;
            const preemptedRef = extractRef(preempted);
            // P1-2 & P1-5: Never mutate broker with force:true on secretless startup records.
            // Re-adopt ONLY when BOTH the omp birth is alive AND the broker lease has a live claimed MCP peer.
            // Otherwise: dead omp -> drop locally; live omp without live claimed peer -> mark access_lost honestly.
            let skippedStaleRecord = false;
            for (const rec of pendingRecords) {
                if (recordsByBrokerId.get(rec.brokerSessionId) !== rec)
                    continue;
                // P1-6: If this snapshot is stale against the record's own known position,
                // skip the record entirely (no state change and no command).
                if (isRecordObservationStale(rec, pos)) {
                    skippedStaleRecord = true;
                    continue;
                }
                rec.pendingStartupReconcile = false;
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
                    // Dead omp process: drop local record only (leave any broker cleanup to broker PID/TTL reaping).
                    removeRecord(rec, { persist: false });
                    continue;
                }
                rec.pid = effectivePid;
                rec.pidStartTime = effectiveStart;
                const effectiveGen = brokerGeneration ?? knownGeneration ?? rec.generation ?? 'default';
                ensureDeliveryContext(rec, effectiveGen);
                resolveSessionIdForRecord(rec);
                ensureLivenessMonitor();
                if (matchedObj && hasLiveClaimedPeer(matchedObj)) {
                    // Live omp + live already-claimed MCP peer -> re-adopt strictly for abort/nudge routing (no heartbeats!).
                    rec.leaseId = pickString(matchedObj, 'leaseId') ?? rec.leaseId;
                    updateRecordPosition(rec, pos);
                    rec.status = isActive ? 'holding' : 'preempted';
                    if (isDisplaced) {
                        scheduleCommand(rec, 'abort', brokerEpoch, effectiveGen);
                    }
                }
                else {
                    // Live omp whose lease expired or has no live claimed MCP peer (no heartbeat source across pi-dish restart):
                    // surface honest "desktop access lost — restart session" state without mutating broker.
                    markAccessLost(rec);
                }
            }
            reconciled = !skippedStaleRecord;
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
    async function mintClaimFile(brokerSessionId, sessionSecret) {
        const reply = await requestBrokerOrUnavailable('POST', '/v1/lease/claim-nonce', {
            sessionId: brokerSessionId,
            sessionSecret,
            bindTimeoutSec: CLAIM_BIND_TIMEOUT_SEC,
            requireRebind: false,
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
        // P1-1 & P1-4: When caller already probed capabilities once (e.g. restartSession),
        // honor that decision without re-probing. Otherwise probe §9.1 capabilities before
        // any mutation: Slice-1 broker -> return null (legacy path); unreachable configured
        // broker -> throws 503 CuBrokerUnavailableError (fail-closed).
        if (options.assumeSlice2 === false)
            return null;
        if (options.assumeSlice2 === true) {
            if (stopped || !ports.broker.configured())
                return null;
            if (!ports.broker.available()) {
                throw new CuBrokerUnavailableError('Computer-use broker is unavailable');
            }
        }
        else if (!(await supportsSlice2())) {
            return null;
        }
        const knownSessionId = typeof options.knownSessionId === 'string' && options.knownSessionId.trim()
            ? options.knownSessionId.trim()
            : null;
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
            const generation = pickString(reply.body, 'generation') ?? knownGeneration;
            const cursor = pickNonNegInt(reply.body, 'cursor');
            const hbSec = pickFiniteNumber(reply.body, 'heartbeatIntervalSec');
            const leaseObj = (0, helper_values_1.record)(reply.body.lease) ? reply.body.lease : null;
            const leaseId = pickString(reply.body, 'leaseId') ?? (leaseObj ? pickString(leaseObj, 'leaseId') : null);
            let claim;
            try {
                claim = await mintClaimFile(confirmedSessionId, sessionSecret);
            }
            catch (claimError) {
                await ports.broker.requestJson('POST', '/v1/lease/release', {
                    sessionId: confirmedSessionId,
                    sessionSecret,
                }).catch(() => { });
                throw claimError;
            }
            if (!claim.ok) {
                await ports.broker.requestJson('POST', '/v1/lease/release', {
                    sessionId: confirmedSessionId,
                    sessionSecret,
                }).catch(() => { });
                throw (0, http_boundary_1.httpError)(claim.message, claim.status);
            }
            const pos = { generation, cursor, epoch };
            const order = comparePosition(pos, { allowNewGeneration: true });
            if (order === 'new_generation') {
                resetAllWatermarksForNewGeneration(generation);
            }
            if (order !== 'stale') {
                advanceGlobalPosition(pos, order === 'new_generation');
            }
            const rec = {
                brokerSessionId: confirmedSessionId,
                leaseOwnerId,
                createdAt: Date.now(),
                leaseId,
                sessionSecret,
                sessionId: knownSessionId,
                status: 'holding',
                epoch,
                lastCursor: cursor ?? -1,
                generation,
                pid: null,
                pidStartTime: null,
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
                acquiredEpoch: epoch,
            };
        }
        // P1-3: Busy seat (human OR agent) ALWAYS fails closed with typed 409 seat_busy.
        if (reply.status === 409 && (0, helper_values_1.record)(reply.body)) {
            const leaseObj = (0, helper_values_1.record)(reply.body.lease) ? reply.body.lease : null;
            const busyState = pickString(reply.body, 'state')
                ?? (leaseObj && pickString(leaseObj, 'holderKind') === 'human' ? 'human' : null);
            const epoch = pickFiniteNumber(reply.body, 'epoch');
            const generation = pickString(reply.body, 'generation');
            const cursor = pickNonNegInt(reply.body, 'cursor');
            const pos = { generation, cursor, epoch };
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
        const message = (0, helper_values_1.record)(reply.body)
            ? (pickString(reply.body, 'message') ?? pickString(reply.body, 'error') ?? `cu-broker acquire failed (${reply.status})`)
            : `cu-broker acquire failed (${reply.status})`;
        throw (0, http_boundary_1.httpError)(message, reply.status >= 400 ? reply.status : 502);
    }
    async function bindSpawnedProcess(handle, proc) {
        const rec = recordsByBrokerId.get(handle.brokerSessionId);
        if (!rec) {
            throw (0, http_boundary_1.httpError)('Computer-use agent lease was lost before process bind', 409);
        }
        if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 1 || !proc.startTime) {
            throw (0, http_boundary_1.httpError)('Could not verify spawned omp process identity for computer-use lease bind', 500);
        }
        if (!rec.sessionSecret) {
            throw (0, http_boundary_1.httpError)('Computer-use agent lease credentials are unavailable for bind', 409);
        }
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
        const reply = await requestBrokerOrUnavailable('POST', '/v1/lease/bind', {
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
        // Check record still exists after await.
        if (recordsByBrokerId.get(handle.brokerSessionId) !== rec)
            return;
        const ep = pickFiniteNumber(reply.body, 'epoch');
        const gen = pickString(reply.body, 'generation');
        const cursor = pickNonNegInt(reply.body, 'cursor');
        const st = pickString(reply.body, 'state');
        const target = pickString(reply.body, 'target');
        const pos = { generation: gen, cursor, epoch: ep };
        // P1-6: If a newer SSE event (e.g. takeover) already moved this record ahead while bind was in flight,
        // keep the newer status and pending abort instead of letting the stale bind reply restore holding.
        const order = comparePosition(pos, { allowNewGeneration: true, sourceGeneration: sentGeneration });
        if (order === 'stale' || isRecordObservationStale(rec, pos)) {
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
        if (rec.pid === null && info.pid !== null && info.pid > 1 && info.pidStartTime) {
            rec.pid = info.pid;
            rec.pidStartTime = info.pidStartTime;
            ensureDeliveryContext(rec, rec.generation ?? knownGeneration ?? 'default');
            ensureLivenessMonitor();
        }
        flushPendingCommands(rec);
    }
    async function abortSpawn(handle) {
        const rec = recordsByBrokerId.get(handle.brokerSessionId);
        if (!rec)
            return;
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
        if (!rec)
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
        const cursor = event.cursor ?? pickNonNegInt(payload, 'cursor');
        const resumeObj = eventName === 'hello' && (0, helper_values_1.record)(payload.resume) ? payload.resume : null;
        const resumeStatus = event.resumeStatus ?? (resumeObj ? pickString(resumeObj, 'status') : null);
        const isResync = event.isResync === true || eventName === 'resync' || resumeStatus === 'resync_required';
        const generationChanged = event.generationChanged === true
            || (generation !== null && knownGeneration !== null && generation !== knownGeneration);
        // P1-7: Replay `hello` carries the FINAL snapshot before the missed events are replayed
        // in ascending cursor order. Do not advance watermarks or delete targets ahead of replay!
        if (eventName === 'hello' && resumeStatus === 'replayed') {
            if (generation !== null && knownGeneration === null)
                knownGeneration = generation;
            if (!reconciled)
                void reconcile();
            return;
        }
        // P1-7: Dedupe gap `hello(resync_required)` and its immediately following `event: resync`
        // at the exact same `(generation, cursor)` so one gap reconciles once (at most one abort per birth).
        const resyncKey = isResync && generation !== null && cursor !== null ? `${generation}:${cursor}` : null;
        if (resyncKey !== null && resyncKey === lastResyncHandledKey) {
            return;
        }
        const pos = { generation, cursor, epoch };
        const order = comparePosition(pos, { allowNewGeneration: authoritativeHello || isResync });
        if (generationChanged || order === 'new_generation') {
            resetAllWatermarksForNewGeneration(generation);
            advanceGlobalPosition(pos, true);
        }
        else if (isResync) {
            // Same-generation resync (cursor_too_old / cursor_ahead / subscriber_lagged):
            // DO NOT wipe ackedAbortEpoch / inFlightAbortEpoch for the same (generation, birth, epoch)
            // so the same birth is never aborted twice across a gap.
            const resyncReason = event.resyncReason ?? pickString(payload, 'reason') ?? (resumeObj ? pickString(resumeObj, 'resyncReason') : null);
            if (resyncReason === 'cursor_ahead') {
                if (cursor !== null)
                    knownCursor = cursor;
                knownEpoch = epoch;
                for (const rec of recordsByBrokerId.values()) {
                    if (cursor !== null && rec.lastCursor > cursor)
                        rec.lastCursor = cursor;
                }
            }
            else {
                if (order === 'stale')
                    return;
                advanceGlobalPosition(pos, false);
            }
        }
        else if (order === 'stale') {
            // P1-6: Ignore older same-generation snapshots (including stale hello) so they never undo newer HTTP state.
            return;
        }
        else {
            advanceGlobalPosition(pos, false);
        }
        if (resyncKey !== null) {
            lastResyncHandledKey = resyncKey;
        }
        else if (!isResync) {
            lastResyncHandledKey = null;
        }
        const effectiveGen = generation ?? knownGeneration ?? 'default';
        if (authoritativeHello && !reconciled) {
            void reconcile();
        }
        const reason = pickString(payload, 'reason');
        const leaseObj = (0, helper_values_1.record)(payload.lease) ? payload.lease : null;
        const leaseRef = extractRef(leaseObj);
        const preemptedObj = (0, helper_values_1.record)(payload.displaced)
            ? payload.displaced
            : ((0, helper_values_1.record)(payload.preempted) ? payload.preempted : null);
        const preemptedRef = extractRef(preemptedObj)
            ?? (eventName === 'preempted' && pickString(payload, 'ownerId')
                ? { ownerId: pickString(payload, 'ownerId') }
                : null);
        const handBackObj = (0, helper_values_1.record)(payload.handedBackTo) ? payload.handedBackTo : leaseObj;
        const handBackRef = extractRef(handBackObj);
        let storeDirty = false;
        const isPreemptSignal = eventName === 'preempted'
            || (state === 'human' && preemptedRef !== null);
        if (isPreemptSignal && preemptedRef) {
            const rec = findRecordForRef(preemptedRef);
            if (rec && !rec.pendingStartupReconcile && rec.status !== 'access_lost' && !isRecordObservationStale(rec, pos)) {
                // P1-5: On a broker restart (generationChanged) or re-adopted record, check claimed peer liveness.
                if ((rec.adoptedWithoutSecret || generationChanged) && preemptedObj && !hasLiveClaimedPeer(preemptedObj)) {
                    markAccessLost(rec);
                    updateRecordPosition(rec, pos);
                    storeDirty = true;
                    scheduleCommand(rec, 'abort', epoch, effectiveGen);
                }
                else {
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
                if ((rec.adoptedWithoutSecret || generationChanged) && handBackObj && !hasLiveClaimedPeer(handBackObj)) {
                    markAccessLost(rec);
                    updateRecordPosition(rec, pos);
                    storeDirty = true;
                }
                else {
                    rec.status = 'holding';
                    updateRecordPosition(rec, pos);
                    storeDirty = true;
                    scheduleCommand(rec, 'nudge', epoch, effectiveGen);
                }
            }
        }
        else if ((eventName === 'hello' || isResync) && state === 'agent' && leaseRef) {
            // Reconnect/resync: if hand_back occurred while disconnected while we knew we were preempted, nudge once.
            const rec = findRecordForRef(leaseRef);
            if (rec && !rec.pendingStartupReconcile && rec.status === 'preempted' && !isRecordObservationStale(rec, pos)) {
                if ((rec.adoptedWithoutSecret || generationChanged) && leaseObj && !hasLiveClaimedPeer(leaseObj)) {
                    markAccessLost(rec);
                    updateRecordPosition(rec, pos);
                    storeDirty = true;
                }
                else {
                    rec.status = 'holding';
                    updateRecordPosition(rec, pos);
                    storeDirty = true;
                    scheduleCommand(rec, 'nudge', epoch, effectiveGen);
                }
            }
        }
        if (state === 'idle') {
            for (const rec of [...recordsByBrokerId.values()]) {
                if (rec.pendingStartupReconcile)
                    continue;
                if ((rec.status === 'holding' || rec.status === 'preempted') && !isRecordObservationStale(rec, pos)) {
                    const wasHolding = rec.status === 'holding';
                    const unexpectedLoss = wasHolding && (reason === 'ttl_expired' || reason === 'hard_cap_expired');
                    const stillAlive = rec.pid !== null && rec.pidStartTime !== null && processAlive({ pid: rec.pid, startTime: rec.pidStartTime });
                    updateRecordPosition(rec, pos);
                    storeDirty = true;
                    if (stillAlive) {
                        markAccessLost(rec);
                        if (unexpectedLoss)
                            scheduleCommand(rec, 'abort', epoch, effectiveGen);
                    }
                    else {
                        clearHeartbeat(rec);
                        rec.sessionSecret = null;
                        rec.status = 'idle';
                        if (unexpectedLoss)
                            scheduleCommand(rec, 'abort', epoch, effectiveGen);
                        else
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
                    if (rec.status === 'access_lost' || isRecordObservationStale(rec, pos))
                        continue;
                    // P1-5: If re-adopted or after a broker restart without a live claimed peer, mark access_lost and stop heartbeats.
                    if ((rec.adoptedWithoutSecret || generationChanged) && leaseObj && !hasLiveClaimedPeer(leaseObj)) {
                        markAccessLost(rec);
                        updateRecordPosition(rec, pos);
                        storeDirty = true;
                    }
                    else {
                        rec.status = 'holding';
                        updateRecordPosition(rec, pos);
                    }
                }
                else if ((rec.status === 'holding' || rec.status === 'preempted') && !isRecordObservationStale(rec, pos) && (generationChanged || isResync || epoch > rec.epoch)) {
                    const stillAlive = rec.pid !== null && rec.pidStartTime !== null && processAlive({ pid: rec.pid, startTime: rec.pidStartTime });
                    if (stillAlive)
                        markAccessLost(rec);
                    else
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
                if (rec.pendingStartupReconcile)
                    continue;
                if (refMatchesRecord(preemptedRef, rec))
                    continue;
                if ((rec.status === 'holding' || rec.status === 'preempted') && !isRecordObservationStale(rec, pos)) {
                    const stillAlive = rec.pid !== null && rec.pidStartTime !== null && processAlive({ pid: rec.pid, startTime: rec.pidStartTime });
                    if (stillAlive)
                        markAccessLost(rec);
                    else
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
        if (!rec)
            return null;
        if (rec.status !== 'holding' && rec.status !== 'preempted')
            return null;
        if (rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
            return null;
        }
        return rec.leaseOwnerId;
    }
    function isDesktopAccessLost(sessionId) {
        const rec = recordForSessionId(sessionId);
        if (!rec || rec.status !== 'access_lost')
            return false;
        if (rec.pid !== null && rec.pidStartTime && !processAlive({ pid: rec.pid, startTime: rec.pidStartTime })) {
            return false;
        }
        return true;
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
        supportsSlice2,
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
        isDesktopAccessLost,
        stop,
    };
}
