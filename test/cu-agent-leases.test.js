// Generated test/tool from test/cu-agent-leases.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const test = require("node:test");
const assert = require("node:assert/strict");
const node_child_process_1 = require("node:child_process");
const crypto = require("node:crypto");
const node_events_1 = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test_types_js_1 = require("./test-types.js");
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
const { createCuAgentLeases, CuBrokerUnavailableError, CuSeatBusyError, CU_HAND_BACK_NUDGE, BROKER_AGENT_LABEL, REQUIRED_SLICE2_CAPABILITIES, } = require('../lib/cu-agent-leases');
const { createCuBrokerClient } = require('../lib/cu-broker');
const { createCuHandlers } = require('../lib/cu-handlers');
const { createSessionHibernation } = require('../lib/session-hibernation');
const { createRecoveryRuntime } = require('../lib/recovery-runner');
const recoveryStore = require('../lib/session-recovery');
const { LaunchError } = require('../lib/session-launch');
const { createSessionOperations } = require('../lib/session-operations');
const { OwnershipRefusal, routeSessionId } = require('../lib/session-ownership');
const { resolveSessionRoute } = require('../lib/session-key');
const { dishDir } = require('../lib/dish-store');
const { errorStatus, httpError } = require('../lib/http-boundary');
const { processIdentity, processIdentityAlive } = require('../lib/process-identity');
const SECRET_PREFIX = 'cu-agent-secret-never-leak-';
const NONCE_PREFIX = 'cu-claim-nonce-never-leak-';
function hashSecret(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
async function startFakeCuBroker(socketPath, claimDir) {
    fs.mkdirSync(claimDir, { recursive: true, mode: 0o700 });
    const sseClients = new Set();
    const pendingEventsRes = [];
    const deadBirths = new Set();
    const acquireCalls = [];
    const claimNonceCalls = [];
    const bindCalls = [];
    const heartbeatCalls = [];
    const releaseCalls = [];
    const cancelPreemptedCalls = [];
    const forcedMutationCalls = [];
    const eventsRequests = [];
    const issuedSecrets = new Set();
    const issuedNonces = new Set();
    const eventRing = [];
    let secretSeq = 0;
    let nonceSeq = 0;
    let ticketSeq = 0;
    function publicLease(lease) {
        if (!lease)
            return null;
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
            expiresAt: lease.expiresAt,
        };
    }
    function publicPreempted(lease) {
        if (!lease)
            return null;
        return {
            sessionId: lease.sessionId,
            ownerId: lease.ownerId,
            leaseId: lease.leaseId,
            label: lease.label,
            pid: lease.pid,
            pidStartTime: lease.pidStartTime,
            mcpClaimed: lease.mcpClaimed,
            claimedPid: lease.claimedPid,
        };
    }
    function isLeaseBirthDead(lease) {
        if (!lease || lease.holderKind !== 'agent')
            return false;
        if (lease.pid === null || lease.pidStartTime === null)
            return false;
        if (deadBirths.has(`${lease.pid}:${lease.pidStartTime}`))
            return true;
        if (ctrl.enforceRealPids) {
            return !processIdentityAlive({ pid: lease.pid, startTime: String(lease.pidStartTime) });
        }
        return false;
    }
    /** P3: Matches real cu-broker `_reap_locked()` invoked before status, events, and mutations. */
    function reapDeadBirths() {
        if (ctrl.lease && isLeaseBirthDead(ctrl.lease)) {
            const prev = publicLease(ctrl.lease);
            ctrl.epoch += 1;
            ctrl.state = 'idle';
            ctrl.lease = null;
            ctrl.emitEvent('seat_idle', { ...ctrl.snapshotPayload(), reason: 'pid_dead', previous: prev });
            ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'pid_dead' });
        }
        if (ctrl.preempted && isLeaseBirthDead(ctrl.preempted)) {
            const reaped = publicPreempted(ctrl.preempted);
            ctrl.preempted = null;
            ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'preempted_reaped', reaped });
        }
    }
    function statusMeta() {
        if (ctrl.slice1Mode) {
            return { ok: true, version: 1 };
        }
        return {
            ok: true,
            version: 1,
            capabilities: [...REQUIRED_SLICE2_CAPABILITIES],
        };
    }
    const ctrl = {
        socketPath,
        generation: 'gen-1',
        cursor: 0,
        state: 'idle',
        epoch: 1,
        lease: null,
        preempted: null,
        minRetainedCursor: 0,
        slice1Mode: false,
        enforceRealPids: false,
        deadBirths,
        eventsErrorStatus: null,
        holdEventsResponses: false,
        pendingEventsRes,
        acquireCalls,
        claimNonceCalls,
        bindCalls,
        heartbeatCalls,
        releaseCalls,
        cancelPreemptedCalls,
        forcedMutationCalls,
        eventsRequests,
        issuedSecrets,
        issuedNonces,
        sseClients,
        publicLease,
        simulateMcpClaim(claimedPid, target = 'active') {
            const lease = target === 'preempted' ? ctrl.preempted : ctrl.lease;
            if (!lease)
                throw new Error(`No ${target} lease to claim`);
            lease.mcpClaimed = true;
            lease.claimedPid = claimedPid;
        },
        resetIdleForTest() {
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
            const fullPayload = {
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
                try {
                    client.destroy();
                }
                catch { }
            }
            sseClients.clear();
            for (const pending of [...pendingEventsRes]) {
                try {
                    pending.destroy();
                }
                catch { }
            }
            pendingEventsRes.length = 0;
        },
        async close() {
            ctrl.dropSseClients();
            await new Promise(resolve => {
                server.closeAllConnections?.();
                server.close(() => resolve());
            });
            try {
                fs.unlinkSync(socketPath);
            }
            catch { }
        },
    };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (req.method === 'GET' && url.pathname === '/v1/status') {
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
            let reqCursor = qCursor !== null && /^\d+$/.test(qCursor) ? Number(qCursor) : null;
            if (lastEventId && lastEventId.includes(':')) {
                const idx = lastEventId.lastIndexOf(':');
                reqGen = reqGen || lastEventId.slice(0, idx);
                const tail = lastEventId.slice(idx + 1);
                if (reqCursor === null && /^\d+$/.test(tail))
                    reqCursor = Number(tail);
            }
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            res.flushHeaders();
            sseClients.add(res);
            res.on('close', () => sseClients.delete(res));
            const oldestAvailableCursor = eventRing.length ? eventRing[0].cursor : ctrl.cursor;
            const emitGap = (reason) => {
                // P3 / §9.5: `event: hello` (resume.status === 'resync_required') ALWAYS strictly first,
                // immediately followed by `event: resync` at the EXACT same `(generation, cursor)`!
                res.write(`id: ${ctrl.generation}:${ctrl.cursor}\nevent: hello\ndata: ${JSON.stringify({
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
                })}\n\n`);
                res.write(`id: ${ctrl.generation}:${ctrl.cursor}\nevent: resync\ndata: ${JSON.stringify({
                    ...ctrl.snapshotPayload(),
                    reason,
                    requestedGeneration: reqGen,
                    requestedCursor: reqCursor,
                    oldestAvailableCursor,
                })}\n\n`);
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
                    res.write(`event: hello\ndata: ${JSON.stringify({
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
                    })}\n\n`);
                    for (const item of missed) {
                        res.write(`id: ${item.generation}:${item.cursor}\nevent: ${item.eventName}\ndata: ${JSON.stringify({ ...item.payload, replayed: true })}\n\n`);
                    }
                    return;
                }
                res.write(`id: ${ctrl.generation}:${ctrl.cursor}\nevent: hello\ndata: ${JSON.stringify({
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
                })}\n\n`);
                return;
            }
            res.write(`id: ${ctrl.generation}:${ctrl.cursor}\nevent: hello\ndata: ${JSON.stringify({
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
            })}\n\n`);
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
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            let body = {};
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                    body = parsed;
            }
            catch { }
            if (body.force === true) {
                forcedMutationCalls.push({ path: url.pathname, body });
            }
            if (req.method === 'POST' && url.pathname === '/v1/lease/acquire') {
                reapDeadBirths();
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
                        cursor: ctrl.cursor,
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
                    mcpClaimed: false,
                    claimedPid: null,
                    expiresAt: new Date(Date.now() + 90_000).toISOString(),
                    tokenHash: hashSecret(secret),
                    rawSecret: secret,
                };
                ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'acquired' });
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
                reapDeadBirths();
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
                // P3: Real cu-broker runs `_reap_locked()` before lookup so dead births return 409 lease_not_found.
                reapDeadBirths();
                bindCalls.push(body);
                const sid = typeof body.sessionId === 'string' ? body.sessionId : '';
                const secret = typeof body.sessionSecret === 'string' ? body.sessionSecret : '';
                const isActive = ctrl.lease?.sessionId === sid && ctrl.lease.holderKind === 'agent';
                const isDisplaced = ctrl.preempted?.sessionId === sid && ctrl.preempted.holderKind === 'agent';
                const target = isActive ? ctrl.lease : isDisplaced ? ctrl.preempted : null;
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
                if (typeof body.ownerId === 'string' && body.ownerId)
                    target.ownerId = body.ownerId;
                if (typeof body.label === 'string' && body.label)
                    target.label = body.label;
                if (typeof body.pid === 'number')
                    target.pid = body.pid;
                if (typeof body.pidStartTime === 'number')
                    target.pidStartTime = body.pidStartTime;
                else if (typeof body.pidStartTime === 'string' && /^\d+$/.test(body.pidStartTime))
                    target.pidStartTime = Number(body.pidStartTime);
                ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'bound', target: isDisplaced ? 'displaced' : 'active' });
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    ok: true,
                    ...ctrl.snapshotPayload(),
                    target: isDisplaced ? 'displaced' : 'active',
                }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/lease/cancel-preempted') {
                reapDeadBirths();
                cancelPreemptedCalls.push(body);
                const sid = typeof body.sessionId === 'string' ? body.sessionId : '';
                const secret = typeof body.sessionSecret === 'string' ? body.sessionSecret : '';
                const force = body.force === true;
                if (ctrl.preempted) {
                    if (!force && (ctrl.preempted.sessionId !== sid || hashSecret(secret) !== ctrl.preempted.tokenHash)) {
                        res.writeHead(403, { 'content-type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, code: 'forbidden', message: 'Invalid session secret.' }));
                        return;
                    }
                    const cancelled = publicPreempted(ctrl.preempted);
                    ctrl.preempted = null;
                    ctrl.emitEvent('lease_changed', { ...ctrl.snapshotPayload(), reason: 'preempted_cancelled', cancelled });
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({
                        ok: true,
                        cancelled: true,
                        alreadyAbsent: false,
                        cancelledReservation: cancelled,
                        ...ctrl.snapshotPayload(),
                    }));
                    return;
                }
                // §9.4: preempted is null -> 409 lease_active only if !force and credentials match active agent lease.
                if (!force && ctrl.state === 'agent' && ctrl.lease && ctrl.lease.sessionId === sid && hashSecret(secret) === ctrl.lease.tokenHash) {
                    res.writeHead(409, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'lease_active', ...ctrl.snapshotPayload() }));
                    return;
                }
                if (!force && (!sid || !secret)) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'missing_credentials', message: 'Missing credentials.' }));
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    ok: true,
                    cancelled: false,
                    alreadyAbsent: true,
                    cancelledReservation: null,
                    ...ctrl.snapshotPayload(),
                }));
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
                    res.writeHead(409, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'lease_preempted', generation: ctrl.generation, cursor: ctrl.cursor, state: 'human', epoch: ctrl.epoch }));
                    return;
                }
                if (ctrl.lease
                    && (ctrl.lease.leaseId === lid || ctrl.lease.sessionId === sid)
                    && hashSecret(secret) === ctrl.lease.tokenHash) {
                    ctrl.lease.expiresAt = new Date(Date.now() + 90_000).toISOString();
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, generation: ctrl.generation, cursor: ctrl.cursor, state: ctrl.state, epoch: ctrl.epoch, lease: publicLease(ctrl.lease) }));
                    return;
                }
                res.writeHead(409, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, code: 'lease_lost', generation: ctrl.generation, cursor: ctrl.cursor, state: ctrl.state, epoch: ctrl.epoch }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/lease/takeover') {
                reapDeadBirths();
                if (ctrl.state === 'human') {
                    res.writeHead(409, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'seat_busy', generation: ctrl.generation, cursor: ctrl.cursor, state: 'human', epoch: ctrl.epoch, lease: publicLease(ctrl.lease) }));
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
                reapDeadBirths();
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
                if (wasHuman)
                    ctrl.preempted = null;
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
    try {
        fs.unlinkSync(socketPath);
    }
    catch { }
    await new Promise(resolve => server.listen(socketPath, () => resolve()));
    return ctrl;
}
function writeFakeOmpScript(scriptPath, processIdentityPath, dirs) {
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
async function waitFor(fn, label, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const val = await fn();
        if (val !== null && val !== undefined && val !== false)
            return val;
        if (Date.now() >= deadline)
            throw new Error(`Timed out waiting for: ${label}`);
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}
function collectFilesRecursively(dir) {
    if (!fs.existsSync(dir))
        return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
            out.push(...collectFilesRecursively(full));
        else if (entry.isFile())
            out.push(full);
    }
    return out;
}
test('unit: P1-6 ordering rule, P1-7 gap dedupe & replay hello, P1-8 unbound refusal, pending/acked retry, and heartbeat 409 abort', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-u1-'));
    const storePath = path.join(tmpDir, 'cu-agent-leases.json');
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
    let hbStatus = 200;
    let hbBody = { ok: true, state: 'agent', epoch: 10, cursor: 2, generation: 'gen-A' };
    let holdNextBind = null;
    let holdBindEnabled = false;
    let capturedBrokerSid = '';
    let capturedOwnerId = '';
    const abortTargets = [];
    const resumeTargets = [];
    let failNextAbort = true;
    let processStillAlive = true;
    const mockBroker = {
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
                const bodyObj = body ? (0, test_types_js_1.record)(body) : {};
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
                    await new Promise(resolve => { holdNextBind = resolve; });
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
        abortSession: async (target) => {
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
    const handle = (0, test_types_js_1.present)(await leases.prepareSpawn({ knownSessionId: sid }));
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
    holdNextBind();
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
        const h = (0, test_types_js_1.present)(await first.prepareSpawn({ knownSessionId: null }));
        await first.bindSpawnedProcess(h, { pid: 55001, startTime: '111111' });
        first.attachSpawnedSession(h, { sessionId: '~sk1_omp_private_never_persisted', pid: 55001, pidStartTime: '111111' });
        first.stop();
        const stat = fs.statSync(storePath);
        assert.equal(stat.mode & 0o777, 0o600);
        const rawStore = fs.readFileSync(storePath, 'utf8');
        for (const secret of broker.issuedSecrets)
            assert.equal(rawStore.includes(secret), false);
        for (const nonce of broker.issuedNonces)
            assert.equal(rawStore.includes(nonce), false);
        assert.equal(rawStore.includes('private_never_persisted'), false);
        assert.equal(rawStore.includes((0, test_types_js_1.present)(h.leaseOwnerId)), true);
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
        const h = (0, test_types_js_1.present)(await first.prepareSpawn({ knownSessionId: null }));
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
        const h = (0, test_types_js_1.present)(await first.prepareSpawn({ knownSessionId: null }));
        await first.bindSpawnedProcess(h, { pid: 55003, startTime: '333333' });
        const ownerId = (0, test_types_js_1.present)(h.leaseOwnerId);
        broker.simulateMcpClaim(55099);
        first.stop();
        const aborts = [];
        const nudges = [];
        const hbBefore = broker.heartbeatCalls.length;
        const restarted = createCuAgentLeases({
            broker: client,
            storeFile: () => storePath,
            processAlive: proc => proc.pid === 55003 && proc.startTime === '333333',
            pidAlive: pid => pid === 55099,
            findSessionIdByProcess: proc => (proc.pid === 55003 && proc.startTime === '333333' ? '~sk1_omp_live_claimed' : null),
            heartbeatIntervalMs: 25, // even with a short interval configured, re-adopted records MUST NOT heartbeat!
            livenessCheckMs: 0,
            abortSession: async (target) => { aborts.push(target); return true; },
            resumeSession: async (target) => { nudges.push(target); return true; },
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
        const toBody = (0, test_types_js_1.record)(to.body);
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
        const h = (0, test_types_js_1.present)(await first.prepareSpawn({ knownSessionId: null }));
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
        const h = (0, test_types_js_1.present)(await first.prepareSpawn({ knownSessionId: null }));
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
        const h = (0, test_types_js_1.present)(await mgr.prepareSpawn({ knownSessionId: null }));
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
    await assert.rejects(() => missingBroker.requestJson('GET', '/v1/status'), (err) => errorStatus(err, 0) === 503);
    const missingLeases = createCuAgentLeases({
        broker: missingBroker,
        storeFile: () => path.join(tmpDir, 'missing-store.json'),
        abortSession: async () => true,
        resumeSession: async () => true,
    });
    await assert.rejects(() => missingLeases.prepareSpawn({ knownSessionId: null }), err => err instanceof CuBrokerUnavailableError && err.status === 503);
    missingLeases.stop();
    // Stale Unix socket (exists on disk as a socket, but no listener -> ECONNREFUSED).
    const staleSock = path.join(tmpDir, 'stale.sock');
    const tempSrv = net.createServer();
    await new Promise(resolve => tempSrv.listen(staleSock, () => resolve()));
    // Close raw fd without unlinking by spawning a child or keeping a stale socket copy:
    // Actually Node unlinks on close, so test `httpError('broker timeout', 504)` (statusCode: 504) + ECONNREFUSED error code directly!
    await new Promise(resolve => tempSrv.close(() => resolve()));
    for (const simulatedError of [
        httpError('Broker timed out', 504),
        httpError('Broker unavailable', 503),
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    ]) {
        const failingBroker = {
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
        await assert.rejects(() => outageLeases.prepareSpawn({ knownSessionId: null }), err => err instanceof CuBrokerUnavailableError && err.status === 503, `transport error (${String(simulatedError)}) must classify as typed CuBrokerUnavailableError`);
        outageLeases.stop();
    }
    // 3. P3 + P1-7: Watcher sends Last-Event-ID gen:cursor; gap emits hello(resync_required) + event:resync
    // at the same cursor and watcher dedupes them to ONE onBrokerEvent!
    const watcherEvents = [];
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
    const makeFakeRes = (opts = {}) => {
        const writes = [];
        let stalled = opts.stalled === true;
        let ended = false;
        let statusCode = 200;
        const res = new node_events_1.EventEmitter();
        Object.assign(res, {
            writableEnded: false,
            destroyed: false,
            status(code) { statusCode = code; return res; },
            json() { ended = true; return res; },
            setHeader: () => { },
            flushHeaders: () => { },
            write(chunk) {
                writes.push(String(chunk));
                return !stalled;
            },
            end() {
                ended = true;
                res.writableEnded = true;
                res.emit('close');
            },
        });
        return {
            res,
            writes,
            setStalled(v) { stalled = v; },
            isEnded: () => ended,
            getStatus: () => statusCode,
        };
    };
    const makeFakeReq = () => Object.assign(new node_events_1.EventEmitter(), {
        headers: {},
        query: {},
    });
    // Path A: Atomic hello + resync + drain timeout eviction.
    const pathA = makeFakeRes();
    handlers.stream(makeFakeReq(), pathA.res, () => { });
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
    handlers.stream(reqB, pathB.res, () => { });
    await waitFor(() => pathB.writes.some(w => w.includes('event: hello')), 'pathB hello');
    assert.equal(handlers.activeStreamCount(), 1);
    reqB.emit('close');
    assert.equal(handlers.activeStreamCount(), 0, 'SSE leak: ordinary browser disconnect removes stream');
    // Path C: Broker stream premature EOF (`broker.dropSseClients()`).
    const pathC = makeFakeRes();
    handlers.stream(makeFakeReq(), pathC.res, () => { });
    await waitFor(() => pathC.writes.some(w => w.includes('event: hello')), 'pathC hello');
    assert.equal(handlers.activeStreamCount(), 1);
    broker.dropSseClients();
    await waitFor(() => handlers.activeStreamCount() === 0, 'SSE leak: broker EOF removes stream');
    // Path D: Broker returns non-200 error on `/v1/events`.
    broker.eventsErrorStatus = 503;
    const pathD = makeFakeRes();
    handlers.stream(makeFakeReq(), pathD.res, () => { });
    await waitFor(() => pathD.isEnded(), 'pathD error ended');
    assert.equal(pathD.getStatus(), 503);
    assert.equal(handlers.activeStreamCount(), 0, 'SSE leak: non-200 error removes stream');
    broker.eventsErrorStatus = null;
    // Path E: Browser disconnects BEFORE broker sends response headers (pending phase teardown).
    broker.holdEventsResponses = true;
    const reqE = makeFakeReq();
    const pathE = makeFakeRes();
    handlers.stream(reqE, pathE.res, () => { });
    assert.equal(handlers.activeStreamCount(), 1);
    reqE.emit('close');
    assert.equal(handlers.activeStreamCount(), 0, 'SSE leak: pending-phase browser disconnect removes stream');
    broker.holdEventsResponses = false;
    broker.dropSseClients();
});
test('unit: 409 seat_busy and 503 CuBrokerUnavailableError never poison hibernation or recovery records', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-nonpoison-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
    const hibRouteId = routeSessionId('omp', '2026-11-25T00-00-00_cu_hib_test');
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
    t.after(() => { try {
        fs.unlinkSync(hibFile);
    }
    catch { } });
    let resumeAttempt = 0;
    const hib = createSessionHibernation({
        readSettings: () => ({}),
        readMeminfo: () => null,
        candidates: () => [],
        viewers: () => 0,
        capture: () => null,
        paneAttached: async () => false,
        inspect: async () => ({ eligible: false }),
        execute: async () => { },
        resume: async () => {
            resumeAttempt += 1;
            if (resumeAttempt === 1)
                throw new CuSeatBusyError('Seat busy', { state: 'agent', epoch: 2, holder: null });
            if (resumeAttempt === 2)
                throw new CuBrokerUnavailableError('Broker down');
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
    t.after(() => { try {
        fs.unlinkSync(sessFile);
    }
    catch { } });
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
    const routeId = routeSessionId('omp', nativeId);
    const runner = createRecoveryRuntime({
        operations: {
            resumeSessionById: async () => {
                recoveryAttempt += 1;
                if (recoveryAttempt === 1)
                    throw new CuSeatBusyError('Seat busy', { state: 'agent', epoch: 3, holder: null });
                if (recoveryAttempt === 2)
                    throw new CuBrokerUnavailableError('Broker down');
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
            waitBounceActionUnlock: async () => { },
            activeOperations: () => [],
            isSessionClosing: () => false,
            isSessionResuming: () => false,
        },
        ownership: {
            getLiveSession: async () => null,
            getRegisteredSession: () => null,
        },
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
    const nativeId = '2026-11-25T00-00-00_cu_p19_test';
    const routeId = routeSessionId('omp', nativeId);
    const sessFile = path.join(ompDir, `${nativeId}.jsonl`);
    fs.writeFileSync(sessFile, JSON.stringify({ type: 'session', id: nativeId, cwd: tmpDir }) + '\n');
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
    const myProc = (0, test_types_js_1.present)(processIdentity(process.pid));
    let launchCalls = 0;
    let stopCalls = 0;
    // Spawn a sacrificial child process that stays alive during the quarantine test so killPaneAndWait cannot clear it.
    const holdChild = (0, node_child_process_1.spawn)(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    t.after(() => { try {
        holdChild.kill('SIGKILL');
    }
    catch { } });
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
            revalidatePaneRestart: (_cap, proved) => proved.registry,
            captureOwnedPaneClose: async () => ({
                sessionId: routeId,
                placement: { socket: path.join(tmpDir, 'tmux.sock'), paneId: '%1', paneProcess: myProc },
                registry: { harnessId: 'omp', nativeSessionId: nativeId, sessionId: nativeId, sessionFile: sessFile, pid: myProc.pid, startTime: myProc.startTime, socketPath: path.join(tmpDir, 'b.sock') },
                agentProcess: myProc,
            }),
            revalidateOwnedPaneClose: () => { },
        },
        launch: {
            validateHarnessPilotSelection: async () => { },
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
        recordLaunchProvenance: () => { },
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
    await assert.rejects(() => ops.resumeSessionById(routeId, { target: { type: 'tmux', socket: path.join(tmpDir, 'tmux.sock'), tmuxSession: 'work' } }), /tmux cleanup failed/);
    assert.equal(launchCalls, 1);
    // Subsequent resume MUST be refused by quarantine while `childProc` is still alive — never launching a second writer!
    await assert.rejects(() => ops.resumeSessionById(routeId, { target: { type: 'tmux', socket: path.join(tmpDir, 'tmux.sock'), tmuxSession: 'work' } }), /Previous hidden tmux cleanup is still incomplete/);
    assert.equal(launchCalls, 1, 'P1-9: quarantine prevented launching a second writer while cleanup is incomplete');
});
test('end-to-end: P1-4 Slice-1 legacy, P1-10 + Fleet addendum env hygiene, P1-1 fresh/displaced restart, P1-3 human seat_busy refusal, P1-8 nested omp rejection, cancel-preempted, private PIN isolation, and zero secret/nonce/force:true leakage', async (t) => {
    writeFakeOmpScript(TEST_FAKE_OMP_PATH, path.resolve(__dirname, '..', 'lib', 'process-identity.js'), {
        envDir: TEST_ENV_DIR,
        cmdDir: TEST_CMD_DIR,
        holdRegisterFlag: TEST_HOLD_REGISTER_FLAG,
    });
    const broker = await startFakeCuBroker(TEST_BROKER_SOCK, TEST_CLAIM_DIR);
    broker.enforceRealPids = true;
    const capturedLogs = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    const capture = (orig) => (...args) => {
        capturedLogs.push(args.map(arg => (typeof arg === 'string' ? arg : (() => { try {
            return JSON.stringify(arg);
        }
        catch {
            return String(arg);
        } })())).join(' '));
        orig(...args);
    };
    console.log = capture(origLog);
    console.warn = capture(origWarn);
    console.error = capture(origError);
    const server = require('../server.js');
    if (!server.listening)
        await new Promise(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Expected TCP address');
    const base = `http://127.0.0.1:${address.port}`;
    const headlessSock = path.join(TEST_TMUX_DIR, 'pi-dish');
    let browserStreamReq = null;
    const origOmpCommand = process.env.PI_DISH_OMP_COMMAND;
    t.after(async () => {
        process.env.PI_DISH_OMP_COMMAND = origOmpCommand;
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        if (browserStreamReq) {
            try {
                browserStreamReq.destroy();
            }
            catch { }
            browserStreamReq = null;
        }
        try {
            fs.unlinkSync(TEST_HOLD_REGISTER_FLAG);
        }
        catch { }
        try {
            (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'kill-server'], { stdio: 'ignore' });
        }
        catch { }
        await new Promise(resolve => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        });
        await broker.close();
        fs.rmSync(TEST_HOME, { recursive: true, force: true });
        fs.rmSync(TEST_TMUX_DIR, { recursive: true, force: true });
        fs.rmSync(TEST_SOCK_DIR, { recursive: true, force: true });
    });
    const apiGet = async (urlPath, headers = {}) => {
        const res = await fetch(base + urlPath, { headers });
        const text = await res.text();
        return { status: res.status, text, json: (() => { try {
                return JSON.parse(text);
            }
            catch {
                return null;
            } })() };
    };
    const apiPost = async (urlPath, body, headers = {}) => {
        const res = await fetch(base + urlPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        return { status: res.status, text, json: (() => { try {
                return JSON.parse(text);
            }
            catch {
                return null;
            } })() };
    };
    const apiPut = async (urlPath, body, headers = {}) => {
        const res = await fetch(base + urlPath, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        return { status: res.status, text, json: (() => { try {
                return JSON.parse(text);
            }
            catch {
                return null;
            } })() };
    };
    const readCapturedEnvs = () => {
        if (!fs.existsSync(TEST_ENV_DIR))
            return [];
        return fs.readdirSync(TEST_ENV_DIR).sort().map(name => JSON.parse(fs.readFileSync(path.join(TEST_ENV_DIR, name), 'utf8')));
    };
    const readCommands = (nativeSessionId) => {
        const file = path.join(TEST_CMD_DIR, `${nativeSessionId}.jsonl`);
        if (!fs.existsSync(file))
            return [];
        return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    };
    const nativeIdOf = (routeId) => resolveSessionRoute(routeId).nativeSessionId;
    await waitFor(() => broker.sseClients.size >= 1, 'broker epoch watcher connected');
    const browserStreamChunks = [];
    browserStreamReq = http.get(`${base}/api/cu/stream`, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => browserStreamChunks.push(chunk));
    });
    await waitFor(() => browserStreamChunks.join('').includes('event: hello'), 'browser /api/cu/stream hello');
    // 0. P1-4: Responding Slice-1 broker (no capabilities array) gets exact main-branch legacy spawn (zero broker mutations)!
    broker.slice1Mode = true;
    const legacySpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD });
    assert.equal(legacySpawn.status, 200, legacySpawn.text);
    assert.equal(broker.acquireCalls.length, 0, 'P1-4: Slice-1 broker performs zero acquire calls');
    assert.equal(broker.claimNonceCalls.length, 0, 'P1-4: Slice-1 broker performs zero claim-nonce calls');
    assert.equal(broker.bindCalls.length, 0, 'P1-4: Slice-1 broker performs zero bind calls');
    const legacySid = String((0, test_types_js_1.record)(legacySpawn.json).id);
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
    const CMD_SECRET = 'cmd-supplied-secret-must-be-stripped';
    const CMD_NONCE = 'cmd-supplied-nonce-must-be-stripped';
    const CMD_STALE_SID = 'cmd-supplied-stale-session-id';
    (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_SESSION_SECRET', PREPOP_SECRET]);
    (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_CLAIM_NONCE', PREPOP_NONCE]);
    (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_SESSION_ID', PREPOP_STALE_SID]);
    (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_CLAIM_FILE', PREPOP_STALE_CLAIM]);
    (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_LABEL', PREPOP_STALE_LABEL]);
    (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'set-environment', '-g', 'CU_BROKER_MCP_TOKEN', PREPOP_MCP_TOKEN]);
    process.env.PI_DISH_OMP_COMMAND =
        `CU_BROKER_SESSION_SECRET=${CMD_SECRET} CU_BROKER_SESSION_ID=${CMD_STALE_SID} `
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
    assert.equal(spawn1.status, 200, spawn1.text);
    const sid1 = String((0, test_types_js_1.record)(spawn1.json).id);
    const native1 = nativeIdOf(sid1);
    const ownerId1 = (0, test_types_js_1.present)(broker.lease?.ownerId);
    const brokerSid1 = (0, test_types_js_1.present)(broker.lease?.sessionId);
    assert.equal(broker.bindCalls.length, 1, 'bound ONCE right after spawnInTmux');
    assert.equal(broker.lease?.label, BROKER_AGENT_LABEL);
    assert.equal(ownerId1.includes(native1), false);
    assert.equal(ownerId1.includes(sid1), false);
    // Verify P1-10 + Fleet addendum order:
    // Inherited/command-supplied CU_BROKER_* were stripped/unset FIRST, THEN the managed allowlist
    // (CU_BROKER_SESSION_ID, CU_BROKER_CLAIM_FILE, CU_BROKER_LABEL) was set so omp retains fresh CU_BROKER_SESSION_ID!
    const env1 = (0, test_types_js_1.present)(readCapturedEnvs().slice(envCountBeforeSpawn1)[0]);
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
    const tmuxSessionList = (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const tmuxSessionEnvs = tmuxSessionList.map(name => (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'show-environment', '-t', name], { encoding: 'utf8' })).join('\n');
    assert.equal(tmuxSessionEnvs.includes(brokerSid1), false, 'managed CU_BROKER_SESSION_ID not stored in tmux session env');
    assert.equal(tmuxSessionEnvs.includes(env1.env.CU_BROKER_CLAIM_FILE), false, 'managed CU_BROKER_CLAIM_FILE not stored in tmux session env');
    assert.equal(tmuxSessionEnvs.includes(CMD_SECRET), false, 'command CU_BROKER_SESSION_SECRET stripped before tmux -e');
    assert.equal(tmuxSessionEnvs.includes(CMD_STALE_SID), false, 'command CU_BROKER_SESSION_ID stripped before tmux -e');
    // Clean pre-populated tmux global env now that P1-10 pre-populated test passed, and restore clean OMP command.
    for (const key of ['CU_BROKER_SESSION_SECRET', 'CU_BROKER_CLAIM_NONCE', 'CU_BROKER_SESSION_ID', 'CU_BROKER_CLAIM_FILE', 'CU_BROKER_LABEL', 'CU_BROKER_MCP_TOKEN']) {
        try {
            (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'set-environment', '-gu', key]);
        }
        catch { }
    }
    process.env.PI_DISH_OMP_COMMAND = origOmpCommand;
    const tmuxGlobalEnv = (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'show-environment', '-g'], { encoding: 'utf8' });
    const siblingEnvFile = path.join(TEST_HOME, 'sibling-window-env.txt');
    (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'new-window', '-d', '-t', tmuxSessionList[0], `env > ${JSON.stringify(siblingEnvFile)}`]);
    const siblingEnv = await waitFor(() => (fs.existsSync(siblingEnvFile) && fs.readFileSync(siblingEnvFile, 'utf8').length > 0 ? fs.readFileSync(siblingEnvFile, 'utf8') : null), 'sibling tmux window env dumped');
    const tmuxServerPid = Number((0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'display-message', '-p', '#{pid}'], { encoding: 'utf8' }).trim());
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
    const row1 = (0, test_types_js_1.present)((0, test_types_js_1.records)((0, test_types_js_1.record)(list1.json).active).find(r => r.id === sid1));
    assert.equal(row1.cuOwnerId, ownerId1);
    // 2. Typed async refusal when seat is busy by another agent!
    const envCountBeforeBusy = readCapturedEnvs().length;
    const asyncBusy = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD, async: true });
    assert.equal(asyncBusy.status, 202, asyncBusy.text);
    const busySpawnId = String((0, test_types_js_1.record)(asyncBusy.json).spawnId);
    const busyStatus = await waitFor(async () => {
        const r = await apiGet(`/api/session-spawns/${encodeURIComponent(busySpawnId)}`);
        const body = (0, test_types_js_1.record)(r.json);
        return body.status !== 'starting' ? body : null;
    }, 'typed async seat_busy refusal');
    assert.equal(busyStatus.status, 'error');
    assert.equal(busyStatus.code, 'seat_busy');
    assert.equal(busyStatus.httpStatus, 409);
    assert.equal(busyStatus.state, 'agent');
    assert.equal(typeof busyStatus.epoch, 'number');
    assert.equal((0, test_types_js_1.record)(busyStatus.holder).ownerId, ownerId1);
    assert.equal(readCapturedEnvs().length, envCountBeforeBusy, 'no second omp spawned on seat_busy');
    // 3. P1-1: Managed restart stops old pane, releases old lease with in-memory secret, and performs FRESH acquire+claim+bind (NO requireRebind)!
    const acquireBeforeRestart = broker.acquireCalls.length;
    const releaseBeforeRestart = broker.releaseCalls.length;
    const restart1 = await apiPost(`/api/sessions/${encodeURIComponent(sid1)}/restart`, {});
    assert.equal(restart1.status, 200, restart1.text);
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
    const humanLease1 = String((0, test_types_js_1.record)(takeover1.json).leaseId);
    const humanToken1 = String((0, test_types_js_1.record)(takeover1.json).leaseToken);
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
    const humanLease2 = String((0, test_types_js_1.record)(takeover2.json).leaseId);
    const humanToken2 = String((0, test_types_js_1.record)(takeover2.json).leaseToken);
    await waitFor(() => readCommands(native1).filter(c => c.command === 'abort').length === 2, 'second takeover abort');
    assert.ok(broker.preempted);
    const cancelBeforeDisplacedRestart = broker.cancelPreemptedCalls.length;
    const envCountBeforeDisplacedRestart = readCapturedEnvs().length;
    const displacedRestart = await apiPost(`/api/sessions/${encodeURIComponent(sid1)}/restart`, {});
    assert.equal(displacedRestart.status, 409, displacedRestart.text);
    const drBody = (0, test_types_js_1.record)(displacedRestart.json);
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
    assert.equal((0, test_types_js_1.record)(busyHumanSpawn.json).code, 'seat_busy', 'P1-3: human-held seat refuses omp launch');
    assert.equal((0, test_types_js_1.record)(busyHumanSpawn.json).state, 'human');
    assert.equal(readCapturedEnvs().length, envCountBeforeDisplacedRestart, 'P1-3: zero omp processes spawned while human holds seat');
    // Release human seat (handBack: true) -> seat becomes IDLE (cancelled displaced agent NEVER regains seat).
    const release2 = await apiPost('/api/cu/release', { leaseId: humanLease2, leaseToken: humanToken2, handBack: true });
    assert.equal(release2.status, 200, release2.text);
    assert.equal((0, test_types_js_1.record)(release2.json).state, 'idle');
    assert.equal((0, test_types_js_1.record)(release2.json).handedBackTo, null);
    // 6. Close while displaced -> calls POST /v1/lease/cancel-preempted, human keeps seat, hand-back yields idle!
    const spawn2 = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD });
    assert.equal(spawn2.status, 200, spawn2.text);
    const sid2 = String((0, test_types_js_1.record)(spawn2.json).id);
    const native2 = nativeIdOf(sid2);
    const takeover3 = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(takeover3.status, 200, takeover3.text);
    const humanLease3 = String((0, test_types_js_1.record)(takeover3.json).leaseId);
    const humanToken3 = String((0, test_types_js_1.record)(takeover3.json).leaseToken);
    await waitFor(() => readCommands(native2).filter(c => c.command === 'abort').length === 1, 'abort on sid2 takeover');
    const cancelBeforeClose = broker.cancelPreemptedCalls.length;
    const closeDisplaced = await apiPost(`/api/sessions/${encodeURIComponent(sid2)}/close`, {});
    assert.equal(closeDisplaced.status, 200, closeDisplaced.text);
    await waitFor(() => broker.cancelPreemptedCalls.length === cancelBeforeClose + 1, 'cancel-preempted called on close-while-displaced');
    assert.equal(broker.state, 'human');
    assert.equal(broker.preempted, null);
    const release3 = await apiPost('/api/cu/release', { leaseId: humanLease3, leaseToken: humanToken3, handBack: true });
    assert.equal(release3.status, 200, release3.text);
    assert.equal((0, test_types_js_1.record)(release3.json).state, 'idle');
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
    const nestedSid1 = String((0, test_types_js_1.record)(nestedSpawn.json).id);
    const nestedNative1 = nativeIdOf(nestedSid1);
    const regDir = path.join(TEST_HOME, '.pi', 'dish', 'sessions');
    await waitFor(() => fs.existsSync(path.join(regDir, `omp-${nestedNative2}-${nestedToken2}.json`)), 'nested sibling omp child registered');
    const takeoverNested = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(takeoverNested.status, 200, takeoverNested.text);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(readCommands(nestedNative1).length, 0, 'P1-8: ambiguous nested omp child 1 received ZERO commands');
    assert.equal(readCommands(nestedNative2).length, 0, 'P1-8: ambiguous nested omp child 2 received ZERO commands');
    await apiPost(`/api/sessions/${encodeURIComponent(nestedSid1)}/close`, {});
    await apiPost('/api/cu/release', {
        leaseId: String((0, test_types_js_1.record)(takeoverNested.json).leaseId),
        leaseToken: String((0, test_types_js_1.record)(takeoverNested.json).leaseToken),
        handBack: false,
    });
    await waitFor(() => broker.state === 'idle', 'broker idle after nested omp cleanup');
    // 8. Private (PIN-locked) session isolation: broker status/stream/audit/store NEVER see private session ID!
    const setPin = await apiPut('/api/private-sessions/pin', { pin: '2468' });
    assert.equal(setPin.status, 200, setPin.text);
    const unlock = await apiPost('/api/private-sessions/unlock', { pin: '2468' });
    assert.equal(unlock.status, 200, unlock.text);
    const unlockToken = String((0, test_types_js_1.record)(unlock.json).token);
    const unlockHeaders = { 'x-pi-dish-private-unlock': unlockToken };
    const privSpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd: TEST_CWD, private: true }, unlockHeaders);
    assert.equal(privSpawn.status, 200, privSpawn.text);
    const privSid = String((0, test_types_js_1.record)(privSpawn.json).id);
    const privNative = nativeIdOf(privSid);
    const privOwnerId = (0, test_types_js_1.present)(broker.lease?.ownerId);
    const lockedSessions = await apiGet('/api/sessions');
    assert.equal((0, test_types_js_1.records)((0, test_types_js_1.record)(lockedSessions.json).active).some(r => r.id === privSid), false, 'locked /api/sessions hides private row');
    const unlockedSessions = await apiGet('/api/sessions', unlockHeaders);
    const privRow = (0, test_types_js_1.present)((0, test_types_js_1.records)((0, test_types_js_1.record)(unlockedSessions.json).active).find(r => r.id === privSid));
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
    const haystacks = [
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
