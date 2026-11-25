// Generated test/tool from test/cu-agent-leases.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Focused tests for Computer-Use Slice 2:
 * - Pre-spawn agent lease acquisition and env injection (`CU_BROKER_SESSION_ID`,
 *   `CU_BROKER_SESSION_SECRET`, `CU_BROKER_LABEL`) for managed `omp` spawns
 *   (new + resumed), plus exact session-ID label binding on both un-patched
 *   Slice-1 brokers and relabel-capable brokers.
 * - Human-held spawn ("waiting for desktop"): succeeds without secret, broker
 *   blocks MCP calls (`403 LEASE_PREEMPTED`), clears when human releases.
 * - Preemption -> exactly ONE abort; hand_back -> exactly ONE resume nudge;
 *   idempotent across duplicate events and SSE reconnects via broker epochs.
 * - Release on close, spontaneous exit (dead-PID reaper), and failed spawn;
 *   closing a preempted agent never releases the human's lease.
 * - Secret hygiene: `CU_BROKER_SESSION_SECRET` never reaches HTTP responses,
 *   SSE streams, session lists, transcripts, registry/spawn stores, or logs.
 *
 * Run with: npm test -- test/cu-agent-leases.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const node_child_process_1 = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test_types_js_1 = require("./test-types.js");
// Configure isolated HOME, TMUX_TMPDIR, and broker socket BEFORE loading any
// pi-dish runtime module so REGISTRY_DIR and dishDir() bind to the temp home.
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2-home-'));
const TEST_TMUX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2-tmux-'));
const TEST_SOCK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cu-s2-sock-'));
const TEST_CWD = path.join(TEST_HOME, 'work');
const TEST_ENV_DIR = path.join(TEST_HOME, 'omp-env');
const TEST_CMD_DIR = path.join(TEST_HOME, 'omp-cmd');
const TEST_NOREGISTER_FLAG = path.join(TEST_HOME, 'noregister.flag');
const TEST_FAKE_OMP_PATH = path.join(TEST_HOME, 'fake-omp.js');
const TEST_BROKER_SOCK = path.join(TEST_SOCK_DIR, 'control.sock');
fs.mkdirSync(TEST_CWD, { recursive: true });
fs.mkdirSync(path.join(TEST_HOME, '.omp', 'agent'), { recursive: true });
process.env.HOME = TEST_HOME;
process.env.PORT = '0';
process.env.TMUX_TMPDIR = TEST_TMUX_DIR;
process.env.PI_DISH_TMUX_SCOPE = '0';
process.env.PI_DISH_CU_BROKER_SOCKET = TEST_BROKER_SOCK;
process.env.PI_DISH_CU_LIVENESS_MS = '60';
process.env.PI_DISH_CU_WATCH_RETRY_MS = '40';
process.env.PI_DISH_BOTS = 'off';
process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${TEST_FAKE_OMP_PATH}`;
const { createCuAgentLeases, CU_HAND_BACK_NUDGE } = require('../lib/cu-agent-leases');
const { resolveSessionRoute } = require('../lib/session-key');
const SECRET_PREFIX = 'cu-agent-secret-never-leak-';
function hashSecret(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
async function startFakeCuBroker(socketPath) {
    const sseClients = new Set();
    const acquireCalls = [];
    const heartbeatCalls = [];
    const releaseCalls = [];
    const issuedSecrets = new Set();
    let secretSeq = 0;
    let ticketSeq = 0;
    const ctrl = {
        socketPath,
        allowRelabelOnRefresh: false,
        state: 'idle',
        epoch: 1,
        lease: null,
        preempted: null,
        acquireCalls,
        heartbeatCalls,
        releaseCalls,
        issuedSecrets,
        sseClients,
        emitEvent(eventName, payload) {
            const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
            for (const client of [...sseClients]) {
                if (client.writableEnded || client.destroyed) {
                    sseClients.delete(client);
                    continue;
                }
                client.write(frame);
            }
        },
        dropSseClients() {
            for (const client of [...sseClients]) {
                try {
                    client.destroy();
                }
                catch { }
            }
            sseClients.clear();
        },
        publicLease(lease) {
            if (!lease)
                return null;
            return {
                holderKind: lease.holderKind,
                leaseId: lease.leaseId,
                sessionId: lease.sessionId,
                holderId: lease.holderId,
                label: lease.label,
                pid: lease.pid,
                pidStartTime: lease.pidStartTime,
                expiresAt: lease.expiresAt,
            };
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
    function snapshotPayload() {
        return {
            state: ctrl.state,
            epoch: ctrl.epoch,
            lease: ctrl.publicLease(ctrl.lease),
            preempted: ctrl.preempted
                ? { sessionId: ctrl.preempted.sessionId, leaseId: ctrl.preempted.leaseId, label: ctrl.preempted.label }
                : null,
        };
    }
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (req.method === 'GET' && url.pathname === '/v1/status') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                version: 1,
                ...snapshotPayload(),
                health: { broker: true, spacesd: true, driver: true, xvfb: true, desktop: true, chrome: true, driverWorkerRunning: true },
            }));
            return;
        }
        if (req.method === 'GET' && url.pathname === '/v1/events') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            res.flushHeaders();
            sseClients.add(res);
            res.write(`event: hello\ndata: ${JSON.stringify(snapshotPayload())}\n\n`);
            res.on('close', () => sseClients.delete(res));
            return;
        }
        if (req.method === 'GET' && url.pathname === '/v1/audit') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                entries: [{ ts: new Date().toISOString(), action: 'acquire', epoch: ctrl.epoch, tokenHash: ctrl.lease?.tokenHash ?? null }],
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
            if (req.method === 'POST' && url.pathname === '/v1/lease/acquire') {
                const call = {
                    holderKind: typeof body.holderKind === 'string' ? body.holderKind : undefined,
                    sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
                    sessionSecret: typeof body.sessionSecret === 'string' ? body.sessionSecret : undefined,
                    label: typeof body.label === 'string' ? body.label : undefined,
                    pid: typeof body.pid === 'number' ? body.pid : undefined,
                    pidStartTime: typeof body.pidStartTime === 'number' ? body.pidStartTime : undefined,
                };
                acquireCalls.push(call);
                const sid = call.sessionId || `agent-${++secretSeq}`;
                const label = (call.label || sid).slice(0, 160);
                // Idempotent refresh when same session presents matching secret.
                if ((ctrl.state === 'agent' || ctrl.state === 'waiting_for_human')
                    && ctrl.lease
                    && ctrl.lease.sessionId === sid
                    && call.sessionSecret
                    && hashSecret(call.sessionSecret) === ctrl.lease.tokenHash) {
                    let mutated = false;
                    if (ctrl.allowRelabelOnRefresh) {
                        if (call.label && ctrl.lease.label !== label) {
                            ctrl.lease.label = label;
                            mutated = true;
                        }
                        if (typeof call.pid === 'number' && ctrl.lease.pid === null) {
                            ctrl.lease.pid = call.pid;
                            ctrl.lease.pidStartTime = typeof call.pidStartTime === 'number' ? call.pidStartTime : null;
                            mutated = true;
                        }
                    }
                    const pub = ctrl.publicLease(ctrl.lease);
                    if (mutated) {
                        ctrl.emitEvent('lease_changed', { ...snapshotPayload(), reason: 'agent_relabel' });
                    }
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({
                        ok: true,
                        state: ctrl.state,
                        epoch: ctrl.epoch,
                        lease: pub,
                        sessionId: sid,
                        leaseId: ctrl.lease.leaseId,
                        sessionSecret: call.sessionSecret,
                        token: call.sessionSecret,
                        heartbeatIntervalSec: 20,
                    }));
                    return;
                }
                if (ctrl.state !== 'idle' && ctrl.lease) {
                    res.writeHead(409, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({
                        ok: false,
                        code: 'seat_busy',
                        state: ctrl.state,
                        epoch: ctrl.epoch,
                        lease: ctrl.publicLease(ctrl.lease),
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
                    holderId: sid,
                    label,
                    pid: typeof call.pid === 'number' ? call.pid : null,
                    pidStartTime: typeof call.pidStartTime === 'number' ? call.pidStartTime : null,
                    expiresAt: new Date(Date.now() + 90_000).toISOString(),
                    tokenHash: hashSecret(secret),
                    rawSecret: secret,
                };
                const pub = ctrl.publicLease(ctrl.lease);
                ctrl.emitEvent('lease_changed', { ...snapshotPayload(), reason: 'agent_acquire' });
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    ok: true,
                    state: ctrl.state,
                    epoch: ctrl.epoch,
                    lease: pub,
                    sessionId: sid,
                    leaseId: ctrl.lease.leaseId,
                    sessionSecret: secret,
                    token: secret,
                    heartbeatIntervalSec: 20,
                }));
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
                    res.end(JSON.stringify({ ok: false, code: 'lease_preempted', state: 'human', epoch: ctrl.epoch }));
                    return;
                }
                if (ctrl.lease
                    && (ctrl.lease.leaseId === lid || ctrl.lease.sessionId === sid)
                    && hashSecret(secret) === ctrl.lease.tokenHash) {
                    ctrl.lease.expiresAt = new Date(Date.now() + 90_000).toISOString();
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, state: ctrl.state, epoch: ctrl.epoch, lease: ctrl.publicLease(ctrl.lease) }));
                    return;
                }
                res.writeHead(409, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, code: 'lease_lost', state: ctrl.state, epoch: ctrl.epoch }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/lease/takeover') {
                if (ctrl.state === 'human') {
                    res.writeHead(409, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'seat_busy', state: 'human', epoch: ctrl.epoch, lease: ctrl.publicLease(ctrl.lease) }));
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
                    holderId: 'jacob',
                    label: typeof body.label === 'string' ? body.label : 'pi-dish',
                    pid: null,
                    pidStartTime: null,
                    expiresAt: new Date(Date.now() + 600_000).toISOString(),
                    tokenHash: hashSecret(leaseToken),
                    rawSecret: leaseToken,
                };
                const snap = snapshotPayload();
                if (displaced) {
                    ctrl.emitEvent('preempted', {
                        ...snap,
                        sessionId: displaced.sessionId,
                        displaced: ctrl.publicLease(displaced),
                    });
                }
                ctrl.emitEvent('lease_changed', { ...snap, reason: 'takeover' });
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    ok: true,
                    state: 'human',
                    epoch: ctrl.epoch,
                    lease: ctrl.publicLease(ctrl.lease),
                    leaseId,
                    leaseToken,
                    token: leaseToken,
                    preempted: snap.preempted,
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
                const handBack = body.handBack === true;
                if (ctrl.state === 'idle' || !ctrl.lease) {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, state: 'idle', epoch: ctrl.epoch, alreadyIdle: true, handedBackTo: null }));
                    return;
                }
                if ((ident !== ctrl.lease.leaseId && ident !== ctrl.lease.sessionId) || hashSecret(token) !== ctrl.lease.tokenHash) {
                    res.writeHead(403, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'forbidden', message: 'Invalid lease credentials.' }));
                    return;
                }
                const prev = ctrl.publicLease(ctrl.lease);
                const wasHuman = ctrl.lease.holderKind === 'human';
                if (wasHuman && handBack && ctrl.preempted) {
                    const restored = ctrl.preempted;
                    ctrl.epoch += 1;
                    ctrl.state = 'agent';
                    ctrl.preempted = null;
                    ctrl.lease = restored;
                    const snap = snapshotPayload();
                    const newPub = ctrl.publicLease(restored);
                    ctrl.emitEvent('hand_back', { ...snap, handedBackTo: newPub });
                    ctrl.emitEvent('lease_changed', { ...snap, reason: 'hand_back' });
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, ...snap, handedBackTo: newPub }));
                    return;
                }
                ctrl.epoch += 1;
                ctrl.state = 'idle';
                ctrl.lease = null;
                if (wasHuman)
                    ctrl.preempted = null;
                const snap = snapshotPayload();
                ctrl.emitEvent('seat_idle', { ...snap, reason: 'released', previous: prev });
                ctrl.emitEvent('lease_changed', { ...snap, reason: 'released' });
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, ...snap, released: prev, handedBackTo: null }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/mcp/call') {
                const sid = typeof body.sessionId === 'string' ? body.sessionId : null;
                const secret = typeof body.sessionSecret === 'string' ? body.sessionSecret : '';
                if (ctrl.state === 'human') {
                    res.writeHead(403, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, code: 'LEASE_PREEMPTED', message: 'Human holds the desktop.' }));
                    return;
                }
                if (ctrl.state === 'agent'
                    && ctrl.lease
                    && ctrl.lease.sessionId === sid
                    && hashSecret(secret) === ctrl.lease.tokenHash) {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, result: { ok: true } }));
                    return;
                }
                res.writeHead(403, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, code: 'LEASE_REQUIRED', message: 'Valid agent lease required.' }));
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
const noRegisterFlag = ${JSON.stringify(dirs.noRegisterFlag)};

if (envDir && (args.includes('--extension') || args.includes('--resume'))) {
  fs.mkdirSync(envDir, { recursive: true });
  fs.writeFileSync(path.join(envDir, \`\${process.pid}.json\`), JSON.stringify({
    pid: process.pid,
    args,
    CU_BROKER_SESSION_ID: process.env.CU_BROKER_SESSION_ID ?? null,
    CU_BROKER_SESSION_SECRET: process.env.CU_BROKER_SESSION_SECRET ?? null,
    CU_BROKER_LABEL: process.env.CU_BROKER_LABEL ?? null,
    hasSecret: Object.prototype.hasOwnProperty.call(process.env, 'CU_BROKER_SESSION_SECRET'),
  }));
}

if (noRegisterFlag && fs.existsSync(noRegisterFlag)) {
  setInterval(() => {}, 1 << 30);
} else {
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
  let sessionFile;
  let sessionId;
  if (resumeIdx >= 0 && args[resumeIdx + 1]) {
    sessionFile = args[resumeIdx + 1];
    sessionId = path.basename(sessionFile, '.jsonl');
  } else {
    sessionId = '2026-11-25T00-00-00_' + (token.slice(0, 12) || crypto.randomBytes(6).toString('hex'));
    sessionFile = path.join(home, '.omp', 'agent', 'sessions', 'proj', sessionId + '.jsonl');
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
  const socketPath = path.join(sockDir, 'omp-' + sessionId + '.sock');
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
            command: msg.command,
            message: msg.message ?? null,
            deliverAs: msg.deliverAs ?? null,
          }) + '\\n');
        }
        if (msg.command === 'abort') {
          sock.write(JSON.stringify({ type: 'response', id: msg.id, success: true }) + '\\n');
        } else if (msg.command === 'prompt') {
          sock.write(JSON.stringify({ type: 'response', id: msg.id, success: true, data: { admitted: true, queued: false } }) + '\\n');
        } else if (msg.command === 'set_session_name') {
          sock.write(JSON.stringify({ type: 'response', id: msg.id, success: true }) + '\\n');
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
    fs.writeFileSync(path.join(regDir, 'omp-' + sessionId + '-' + token + '.json'), JSON.stringify({
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
  });
  setInterval(() => {}, 1 << 30);
}
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
test('cu-agent-leases unit: preemption and hand-back are epoch-idempotent across duplicate events, reconnects, and broker restarts', async () => {
    const aborted = [];
    const resumed = [];
    const acquireReplies = [
        {
            status: 200,
            body: {
                ok: true,
                state: 'agent',
                epoch: 10,
                sessionId: 'omp-spawn-u1',
                leaseId: 'agent-10',
                sessionSecret: 'unit-secret-xyz',
                heartbeatIntervalSec: 20,
                lease: { holderKind: 'agent', sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' },
            },
        },
        {
            status: 200,
            body: {
                ok: true,
                state: 'agent',
                epoch: 10,
                sessionId: 'omp-spawn-u1',
                leaseId: 'agent-10',
                sessionSecret: 'unit-secret-xyz',
                heartbeatIntervalSec: 20,
                lease: { holderKind: 'agent', sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' },
            },
        },
    ];
    const labelBroadcasts = [];
    const mockBroker = {
        socketPath: () => '/tmp/mock.sock',
        available: () => true,
        async requestJson(_method, pathname) {
            if (pathname === '/v1/lease/acquire') {
                return acquireReplies.shift() ?? { status: 200, body: { ok: true } };
            }
            return { status: 200, body: { ok: true, state: 'idle', epoch: 99 } };
        },
        openEvents: () => null,
    };
    const leases = createCuAgentLeases({
        broker: mockBroker,
        abortSession: async (id) => { aborted.push(id); },
        resumeSession: async (id, text) => { resumed.push({ id, text }); },
        onLabelBound: snap => { labelBroadcasts.push(snap); },
        heartbeatIntervalMs: 0,
        livenessCheckMs: 0,
    });
    const sid = '~sk1_omp_unit_session_1';
    const handle = (0, test_types_js_1.present)(await leases.prepareSpawn({ knownSessionId: null }));
    assert.equal(handle.env.CU_BROKER_SESSION_SECRET, 'unit-secret-xyz');
    await leases.bindSpawnedSession(handle, { sessionId: sid, pid: null, pidStartTime: null });
    assert.equal(labelBroadcasts.length, 1, 'un-patched broker triggers normalized label_bound broadcast');
    assert.equal((0, test_types_js_1.record)(labelBroadcasts[0].lease).label, sid);
    // Normalize strips secrets everywhere including audit entries.
    const scrubbed = leases.normalizePublicPayload({
        state: 'agent',
        epoch: 10,
        sessionSecret: 'unit-secret-xyz',
        tokenHash: 'hash-1',
        lease: { holderKind: 'agent', sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1', sessionSecret: 'unit-secret-xyz', tokenHash: 'hash-2' },
        entries: [{ action: 'acquire', sessionSecret: 'unit-secret-xyz', tokenHash: 'hash-3' }],
    });
    assert.equal(JSON.stringify(scrubbed).includes('unit-secret-xyz'), false);
    assert.equal(JSON.stringify(scrubbed).includes('tokenHash'), false);
    assert.equal((0, test_types_js_1.record)(scrubbed.lease).label, sid);
    const send = (ev) => leases.handleBrokerEvent(ev);
    // Preemption cycle 1: preempted + lease_changed + reconnect hello at same epoch -> 1 abort.
    send({
        eventName: 'preempted',
        authoritativeHello: false,
        payload: { state: 'human', epoch: 11, sessionId: 'omp-spawn-u1', displaced: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' }, preempted: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    send({
        eventName: 'lease_changed',
        authoritativeHello: false,
        payload: { state: 'human', epoch: 11, reason: 'takeover', preempted: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    send({
        eventName: 'hello',
        authoritativeHello: true,
        payload: { state: 'human', epoch: 11, preempted: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    assert.deepEqual(aborted, [sid]);
    assert.deepEqual(resumed, []);
    // Hand-back cycle 1: hand_back + lease_changed + reconnect hello at same epoch -> 1 resume.
    send({
        eventName: 'hand_back',
        authoritativeHello: false,
        payload: { state: 'agent', epoch: 12, lease: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' }, handedBackTo: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    send({
        eventName: 'lease_changed',
        authoritativeHello: false,
        payload: { state: 'agent', epoch: 12, reason: 'hand_back', lease: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    send({
        eventName: 'hello',
        authoritativeHello: true,
        payload: { state: 'agent', epoch: 12, lease: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    assert.deepEqual(aborted, [sid]);
    assert.deepEqual(resumed, [{ id: sid, text: CU_HAND_BACK_NUDGE }]);
    // Missed-during-disconnect cycle 2: reconnect hello lands directly in human (13), then directly in agent (14).
    send({
        eventName: 'hello',
        authoritativeHello: true,
        payload: { state: 'human', epoch: 13, preempted: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    send({
        eventName: 'hello',
        authoritativeHello: true,
        payload: { state: 'human', epoch: 13, preempted: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    assert.equal(aborted.length, 2);
    send({
        eventName: 'hello',
        authoritativeHello: true,
        payload: { state: 'agent', epoch: 14, lease: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    send({
        eventName: 'hello',
        authoritativeHello: true,
        payload: { state: 'agent', epoch: 14, lease: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    assert.equal(resumed.length, 2);
    // Broker restart (epoch resets to 1 on authoritativeHello) resets watermarks cleanly.
    send({
        eventName: 'hello',
        authoritativeHello: true,
        payload: { state: 'human', epoch: 1, preempted: { sessionId: 'omp-spawn-u1', label: 'omp-spawn-u1' } },
    });
    assert.equal(aborted.length, 3);
    leases.stop();
});
test('CU Slice 2 end-to-end: spawn lease, preemption/hand-back idempotency, human-held waiting state, release, and secret hygiene', async (t) => {
    const home = TEST_HOME;
    const tmuxDir = TEST_TMUX_DIR;
    const sockDir = TEST_SOCK_DIR;
    const cwd = TEST_CWD;
    const envDir = TEST_ENV_DIR;
    const cmdDir = TEST_CMD_DIR;
    const noRegisterFlag = TEST_NOREGISTER_FLAG;
    const fakeOmpPath = TEST_FAKE_OMP_PATH;
    const brokerSock = TEST_BROKER_SOCK;
    writeFakeOmpScript(fakeOmpPath, path.resolve(__dirname, '..', 'lib', 'process-identity.js'), {
        envDir,
        cmdDir,
        noRegisterFlag,
    });
    const broker = await startFakeCuBroker(brokerSock);
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
    let browserStreamReq = null;
    t.after(async () => {
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
        const headlessSock = path.join(tmuxDir, 'pi-dish');
        try {
            (0, node_child_process_1.execFileSync)('tmux', ['-S', headlessSock, 'kill-server'], { stdio: 'ignore' });
        }
        catch { }
        await new Promise(resolve => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        });
        await broker.close();
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(tmuxDir, { recursive: true, force: true });
        fs.rmSync(sockDir, { recursive: true, force: true });
    });
    const apiGet = async (urlPath) => {
        const res = await fetch(base + urlPath);
        const text = await res.text();
        return { status: res.status, text, json: (() => { try {
                return JSON.parse(text);
            }
            catch {
                return null;
            } })() };
    };
    const apiPost = async (urlPath, body) => {
        const res = await fetch(base + urlPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: base },
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
        if (!fs.existsSync(envDir))
            return [];
        return fs.readdirSync(envDir).sort().map(name => JSON.parse(fs.readFileSync(path.join(envDir, name), 'utf8')));
    };
    const readCommands = (nativeSessionId) => {
        const file = path.join(cmdDir, `${nativeSessionId}.jsonl`);
        if (!fs.existsSync(file))
            return [];
        return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    };
    const nativeIdOf = (routeId) => resolveSessionRoute(routeId).nativeSessionId;
    // Wait for server's broker epoch watcher to attach.
    await waitFor(() => broker.sseClients.size >= 1, 'broker epoch watcher connected');
    // Open a browser-side /api/cu/stream listener to verify SSE label projection and secret hygiene.
    const browserStreamChunks = [];
    browserStreamReq = http.get(`${base}/api/cu/stream`, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => browserStreamChunks.push(chunk));
    });
    await waitFor(() => browserStreamChunks.join('').includes('event: hello'), 'browser /api/cu/stream hello');
    // 1. Spawn managed omp against an un-patched Slice-1 broker (allowRelabelOnRefresh = false).
    broker.allowRelabelOnRefresh = false;
    const spawn1 = await apiPost('/api/sessions/new', { harness: 'omp', cwd });
    assert.equal(spawn1.status, 200, spawn1.text);
    const sid1 = String((0, test_types_js_1.record)(spawn1.json).id);
    const native1 = nativeIdOf(sid1);
    assert.equal((0, test_types_js_1.record)(spawn1.json).cuSeat, undefined);
    // Verify pre-spawn acquire + omp env carried real CU_BROKER_SESSION_ID, CU_BROKER_SESSION_SECRET, CU_BROKER_LABEL.
    assert.ok(broker.acquireCalls.length >= 2, 'initial acquire + post-spawn bind refresh');
    const envs1 = readCapturedEnvs();
    assert.equal(envs1.length, 1);
    const env1 = envs1[0];
    assert.equal(env1.hasSecret, true);
    assert.equal(typeof env1.CU_BROKER_SESSION_ID, 'string');
    assert.equal(typeof env1.CU_BROKER_SESSION_SECRET, 'string');
    assert.ok(String(env1.CU_BROKER_SESSION_SECRET).startsWith(SECRET_PREFIX));
    assert.equal(typeof env1.CU_BROKER_LABEL, 'string');
    assert.equal(env1.CU_BROKER_SESSION_ID, broker.lease?.sessionId);
    // Even on un-patched Slice-1 broker, /api/cu/status and /api/cu/stream project exact `label === sid1`.
    const status1 = await apiGet('/api/cu/status');
    assert.equal(status1.status, 200);
    assert.equal((0, test_types_js_1.record)(status1.json).state, 'agent');
    assert.equal((0, test_types_js_1.record)((0, test_types_js_1.record)(status1.json).lease).label, sid1);
    await waitFor(() => browserStreamChunks.join('').includes(sid1), 'normalized lease_changed with exact sid1 on /api/cu/stream');
    // Another concurrent omp spawn while agent holds the seat is rejected with 409 seat_busy before tmux.
    const busySpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd });
    assert.equal(busySpawn.status, 409);
    assert.equal((0, test_types_js_1.record)(busySpawn.json).code, 'seat_busy');
    assert.equal((0, test_types_js_1.record)(busySpawn.json).state, 'agent');
    assert.equal(readCapturedEnvs().length, 1, 'no second omp process spawned on agent busy');
    // 2. Human takeover -> preempted SSE -> EXACTLY ONE abort on omp, even after SSE reconnect!
    const takeover1 = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(takeover1.status, 200, takeover1.text);
    const humanLeaseId1 = String((0, test_types_js_1.record)(takeover1.json).leaseId);
    const humanToken1 = String((0, test_types_js_1.record)(takeover1.json).leaseToken);
    await waitFor(() => readCommands(native1).filter(c => c.command === 'abort').length === 1, 'one abort after takeover');
    // Drop broker SSE clients so pi-dish reconnects and receives hello at the same preempted epoch.
    broker.dropSseClients();
    await waitFor(() => broker.sseClients.size >= 1, 'broker watcher reconnected while preempted');
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(readCommands(native1).filter(c => c.command === 'abort').length, 1, 'reconnect hello must NOT duplicate abort');
    // 3. Human hand-back -> hand_back SSE -> EXACTLY ONE resume nudge, even after SSE reconnect!
    const release1 = await apiPost('/api/cu/release', { leaseId: humanLeaseId1, leaseToken: humanToken1, handBack: true });
    assert.equal(release1.status, 200, release1.text);
    await waitFor(() => readCommands(native1).filter(c => c.command === 'prompt').length === 1, 'one resume nudge after hand_back');
    const promptCmd = readCommands(native1).find(c => c.command === 'prompt');
    assert.equal((0, test_types_js_1.present)(promptCmd).message, CU_HAND_BACK_NUDGE);
    broker.dropSseClients();
    await waitFor(() => broker.sseClients.size >= 1, 'broker watcher reconnected after hand_back');
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(readCommands(native1).filter(c => c.command === 'prompt').length, 1, 'reconnect hello must NOT duplicate resume nudge');
    // 4. Explicit close releases the agent lease cleanly back to idle.
    const close1 = await apiPost(`/api/sessions/${encodeURIComponent(sid1)}/close`, {});
    assert.equal(close1.status, 200, close1.text);
    await waitFor(() => broker.state === 'idle', 'broker idle after session close');
    // 5. Relabel-capable broker + resumed spawn passes exact sid1 pre-spawn + spontaneous exit reaps lease + secret hygiene!
    broker.allowRelabelOnRefresh = true;
    const resume1 = await apiPost(`/api/sessions/${encodeURIComponent(sid1)}/resume`, {});
    assert.equal(resume1.status, 200, resume1.text);
    const lastAcquire = broker.acquireCalls[broker.acquireCalls.length - 1];
    assert.equal(lastAcquire.label, sid1, 'resumed omp passes exact pi-dish session id to cu-broker');
    assert.equal(broker.lease?.label, sid1);
    assert.equal(typeof broker.lease?.pid, 'number');
    const resumedEnv = readCapturedEnvs().find(e => e.CU_BROKER_LABEL === sid1);
    assert.ok(resumedEnv, 'resumed omp env carries exact CU_BROKER_LABEL = session id');
    assert.equal(resumedEnv.hasSecret, true);
    // Secret hygiene check across EVERY public API, SSE stream, transcript, persisted store, and server log!
    const publicPayloads = [
        spawn1.text,
        resume1.text,
        (await apiGet('/api/sessions')).text,
        (await apiGet('/api/sessions?view=client')).text,
        (await apiGet('/api/cu/status')).text,
        (await apiGet('/api/cu/audit')).text,
        (await apiGet(`/api/sessions/${encodeURIComponent(sid1)}/messages`)).text,
        browserStreamChunks.join(''),
        capturedLogs.join('\n'),
    ];
    const diskRoots = [
        path.join(home, '.omp'),
        path.join(home, '.pi', 'dish'),
    ];
    const walkFiles = (dir, acc) => {
        if (!fs.existsSync(dir))
            return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory())
                walkFiles(full, acc);
            else if (entry.isFile())
                acc.push(full);
        }
    };
    const persistedFiles = [];
    for (const root of diskRoots)
        walkFiles(root, persistedFiles);
    for (const file of persistedFiles) {
        publicPayloads.push(fs.readFileSync(file, 'utf8'));
    }
    // Verify the long-lived tmux server process cmdline carries no agent lease secret.
    const headlessSock = path.join(tmuxDir, 'pi-dish');
    try {
        const tmuxServerPid = (0, node_child_process_1.execFileSync)('tmux', ['-N', '-S', headlessSock, 'display-message', '-p', '#{pid}'], { encoding: 'utf8' }).trim();
        if (/^\d+$/.test(tmuxServerPid) && fs.existsSync(`/proc/${tmuxServerPid}/cmdline`)) {
            publicPayloads.push(fs.readFileSync(`/proc/${tmuxServerPid}/cmdline`, 'utf8'));
        }
    }
    catch { }
    assert.ok(broker.issuedSecrets.size >= 2, 'at least two distinct agent secrets were issued');
    for (const secret of broker.issuedSecrets) {
        for (const blob of publicPayloads) {
            assert.equal(blob.includes(secret), false, `CU_BROKER_SESSION_SECRET leaked! (${secret.slice(0, 20)}...)`);
        }
    }
    // Spontaneous exit: SIGKILL the resumed omp PID -> dead-PID liveness monitor releases broker lease!
    const resumedPid = Number((0, test_types_js_1.present)(broker.lease).pid);
    process.kill(resumedPid, 'SIGKILL');
    await waitFor(() => broker.state === 'idle', 'dead-PID liveness reaper releases agent lease');
    // 6. Human-held spawn: succeeds with waiting_for_desktop, omits CU_BROKER_SESSION_SECRET, broker blocks MCP calls!
    const takeoverHuman = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(takeoverHuman.status, 200);
    const humanLeaseId2 = String((0, test_types_js_1.record)(takeoverHuman.json).leaseId);
    const humanToken2 = String((0, test_types_js_1.record)(takeoverHuman.json).leaseToken);
    const beforeWaitingPids = new Set(readCapturedEnvs().map(e => Number(e.pid)));
    const waitingSpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd });
    assert.equal(waitingSpawn.status, 200, waitingSpawn.text);
    assert.equal((0, test_types_js_1.record)(waitingSpawn.json).cuSeat, 'waiting_for_desktop');
    const waitingSid = String((0, test_types_js_1.record)(waitingSpawn.json).id);
    const waitingEnvs = readCapturedEnvs();
    const waitingEnv = (0, test_types_js_1.present)(waitingEnvs.find(e => !beforeWaitingPids.has(Number(e.pid))));
    assert.equal(waitingEnv.hasSecret, false);
    assert.equal(waitingEnv.CU_BROKER_SESSION_SECRET, null);
    assert.equal(typeof waitingEnv.CU_BROKER_SESSION_ID, 'string');
    // Verify broker blocks computer tool call for the waiting session (403 LEASE_PREEMPTED).
    const mcpCheck = await new Promise((resolve, reject) => {
        const req = http.request({
            socketPath: brokerSock,
            path: '/v1/mcp/call',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
        }, (res) => {
            const bufs = [];
            res.on('data', (c) => bufs.push(c));
            res.on('end', () => resolve({
                status: res.statusCode ?? 0,
                body: JSON.parse(Buffer.concat(bufs).toString('utf8')),
            }));
        });
        req.on('error', reject);
        req.end(JSON.stringify({ sessionId: waitingEnv.CU_BROKER_SESSION_ID, tool: 'screenshot' }));
    });
    assert.equal(mcpCheck.status, 403);
    assert.equal(mcpCheck.body.code, 'LEASE_PREEMPTED');
    // Verify /api/sessions surfaces cuWaitingForDesktop: true while human holds desktop.
    const listWhileHuman = await apiGet('/api/sessions?view=client');
    const waitingRow = (0, test_types_js_1.records)((0, test_types_js_1.record)(listWhileHuman.json).active).find(s => s.id === waitingSid);
    assert.equal((0, test_types_js_1.present)(waitingRow).cuWaitingForDesktop, true);
    // Release human -> waiting state clears cleanly on /api/sessions.
    const releaseHuman = await apiPost('/api/cu/release', { leaseId: humanLeaseId2, leaseToken: humanToken2, handBack: true });
    assert.equal(releaseHuman.status, 200);
    await waitFor(async () => {
        const res = await apiGet('/api/sessions?view=client');
        const row = (0, test_types_js_1.records)((0, test_types_js_1.record)(res.json).active).find(s => s.id === waitingSid);
        return row && row.cuWaitingForDesktop !== true;
    }, 'cuWaitingForDesktop clears once human releases desktop');
    assert.equal((await apiPost(`/api/sessions/${encodeURIComponent(waitingSid)}/close`, {})).status, 200);
    // 7. Closing a preempted agent never releases the human's lease.
    const spawn3 = await apiPost('/api/sessions/new', { harness: 'omp', cwd });
    assert.equal(spawn3.status, 200);
    const sid3 = String((0, test_types_js_1.record)(spawn3.json).id);
    const takeover3 = await apiPost('/api/cu/takeover', { label: 'pi-dish', ttlSec: 600 });
    assert.equal(takeover3.status, 200);
    const humanLeaseId3 = String((0, test_types_js_1.record)(takeover3.json).leaseId);
    const humanToken3 = String((0, test_types_js_1.record)(takeover3.json).leaseToken);
    const close3 = await apiPost(`/api/sessions/${encodeURIComponent(sid3)}/close`, {});
    assert.equal(close3.status, 200);
    assert.equal(broker.state, 'human', 'closing preempted agent must not release human lease');
    assert.equal(broker.lease?.leaseId, humanLeaseId3);
    // Release human lease back to idle (note: fake broker would hand back if preempted stayed, so clear preempted or close cleanly).
    broker.preempted = null;
    assert.equal((await apiPost('/api/cu/release', { leaseId: humanLeaseId3, leaseToken: humanToken3, handBack: true })).status, 200);
    await waitFor(() => broker.state === 'idle', 'idle before failed-spawn check');
    // 8. Failed spawn releases pre-acquired agent lease and never leaks secret in error or logs.
    fs.writeFileSync(noRegisterFlag, '1');
    process.env.PI_DISH_SPAWN_TIMEOUT_MS = '400';
    const failedSpawn = await apiPost('/api/sessions/new', { harness: 'omp', cwd });
    delete process.env.PI_DISH_SPAWN_TIMEOUT_MS;
    fs.unlinkSync(noRegisterFlag);
    assert.equal(failedSpawn.status, 500);
    await waitFor(() => broker.state === 'idle', 'failed spawn aborts and releases pre-acquired lease');
    for (const secret of broker.issuedSecrets) {
        assert.equal(failedSpawn.text.includes(secret), false, 'failed spawn error response must never contain secret');
        assert.equal(capturedLogs.join('\n').includes(secret), false, 'logs after failed spawn must never contain secret');
    }
});
