// Generated test/tool from test/tmux-recovery.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Private-tmux integration tests for pi-dish tmux server loss recovery:
 * - Recreates pi-dish's tmux server (-f /dev/null, exit-empty off) and restores
 *   both live agent sessions (idle, no new paid turn) and active bot relays
 *   once without operator intervention, while never relaunching retired bots.
 * - Enforces the persisted rate limit / backoff on a rapid second server loss.
 * - Distinguishes a single session exiting on its own from the whole server dying,
 *   and supports on-demand server-loss detection when a tmux command fails with no server.
 * - Preserves the private-session PIN gate on /api/recovery and /api/recovery/retry.
 *
 * Every test uses its own isolated HOME and TMUX_TMPDIR and kills its private
 * tmux server and relay children on teardown.
 *
 * Run with: npm test -- test/tmux-recovery.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const test_types_js_1 = require("./test-types.js");
const test_env_js_1 = require("./test-env.js");
const session_key_js_1 = require("../lib/session-key.js");
const crypto = require("node:crypto");
const SERVER = path.join(__dirname, '..', 'server.js');
const AGY_FIXTURE = path.join(__dirname, 'fixtures', 'fake-agy-acp.js');
const BOT_MODELS = path.join(__dirname, 'fixtures', 'bot-scripted-models.js');
const agyCommand = (script) => `env FAKE_AGY_SCRIPT=${script} ${process.execPath} ${AGY_FIXTURE}`;
const tmuxOk = (0, node_child_process_1.spawnSync)('tmux', ['-V'], { stdio: 'ignore' }).status === 0;
const MEMINFO_CALM = [
    'MemTotal:       16777216 kB',
    'MemFree:         8388608 kB',
    'MemAvailable:   8388608 kB',
    'SwapTotal:       16777216 kB',
    'SwapFree:        16777216 kB',
].join('\n') + '\n';
const children = new Set();
const homes = new Set();
function botsDir(home) {
    return path.join(home, '.pi', 'dish', 'bots');
}
function relayLock(home, id) {
    try {
        return JSON.parse(fs.readFileSync(path.join(botsDir(home), id, 'relay.lock'), 'utf8'));
    }
    catch {
        return null;
    }
}
function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function tmuxSocket(home) {
    return path.join(home, 'tmux', 'pi-dish');
}
function tmuxServerPid(home) {
    try {
        const out = (0, node_child_process_1.execFileSync)('tmux', ['-N', '-S', tmuxSocket(home), 'display-message', '-p', '#{pid}'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: (0, test_env_js_1.sanitizeTestEnv)(process.env),
        }).trim();
        const pid = Number(out);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
    catch {
        return null;
    }
}
function tmuxOut(home, ...args) {
    return (0, node_child_process_1.execFileSync)('tmux', ['-N', '-S', tmuxSocket(home), ...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: (0, test_env_js_1.sanitizeTestEnv)(process.env),
    }).trim();
}
async function stopPrivateTmux(home) {
    const pids = [];
    try {
        for (const entry of fs.readdirSync(botsDir(home), { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name === 'sessions')
                continue;
            const lock = relayLock(home, entry.name);
            if (lock?.pid)
                pids.push(lock.pid);
        }
    }
    catch { }
    try {
        const out = (0, node_child_process_1.execFileSync)('tmux', ['-N', '-S', tmuxSocket(home), 'list-panes', '-a', '-F', '#{pane_pid}'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: (0, test_env_js_1.sanitizeTestEnv)(process.env),
        }).trim();
        for (const line of out.split('\n')) {
            const pid = Number(line);
            if (Number.isInteger(pid) && pid > 1)
                pids.push(pid);
        }
    }
    catch { }
    try {
        (0, node_child_process_1.execFileSync)('tmux', ['-S', tmuxSocket(home), 'kill-server'], {
            stdio: 'ignore', env: (0, test_env_js_1.sanitizeTestEnv)(process.env),
        });
    }
    catch { }
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && (tmuxServerPid(home) !== null || pids.some(alive))) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    for (const pid of pids) {
        if (alive(pid)) {
            try {
                process.kill(pid, 'SIGKILL');
            }
            catch { }
        }
    }
}
test.after(async () => {
    for (const booted of [...children])
        await booted.stop().catch(() => { });
    for (const home of [...homes]) {
        await stopPrivateTmux(home).catch(() => { });
        fs.rmSync(home, { recursive: true, force: true });
        homes.delete(home);
    }
});
function makeHome(t, settings) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-recovery-'));
    homes.add(home);
    fs.mkdirSync(path.join(home, '.pi', 'dish'), { recursive: true });
    fs.mkdirSync(path.join(home, 'tmux'), { recursive: true });
    fs.mkdirSync(path.join(home, 'proj'), { recursive: true });
    fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'), JSON.stringify(settings));
    fs.writeFileSync(path.join(home, 'meminfo.txt'), MEMINFO_CALM);
    t.after(async () => {
        await stopPrivateTmux(home).catch(() => { });
    });
    return home;
}
function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const addr = probe.address();
            if (!addr || typeof addr === 'string') {
                probe.close(() => reject(new Error('loopback probe lacked a TCP address')));
                return;
            }
            const { port } = addr;
            probe.close(error => error ? reject(error) : resolve(port));
        });
    });
}
async function until(predicate, label, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > deadline)
            throw new Error(`Timed out: ${label}`);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
async function untilAsync(predicate, label, timeout = 45_000) {
    const deadline = Date.now() + timeout;
    while (!await predicate()) {
        if (Date.now() > deadline)
            throw new Error(`Timed out: ${label}`);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
async function boot(home, extraEnv = {}) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const env = {
        ...(0, test_env_js_1.sanitizeTestEnv)(process.env),
        HOME: home,
        PORT: String(port),
        TMUX_TMPDIR: path.join(home, 'tmux'),
        PI_OFFLINE: '1',
        PI_DISH_URL: base,
        PI_DISH_MEMINFO_FILE: path.join(home, 'meminfo.txt'),
        ...extraEnv,
    };
    const child = (0, node_child_process_1.spawn)(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr?.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.stdout?.on('data', (chunk) => { output += chunk.toString('utf8'); });
    const exited = new Promise(resolve => { child.once('close', () => resolve()); });
    const booted = {
        base,
        child,
        log: () => output,
        async stop() {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGTERM');
                await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5_000))]);
            }
            if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
                await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2_000))]);
            }
            children.delete(booted);
        },
    };
    children.add(booted);
    await untilAsync(async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`server exited during startup: ${output}`);
        }
        return fetch(`${base}/api/host`).then(res => res.ok, () => false);
    }, 'server listens', 30_000);
    return booted;
}
async function get(base, requestPath, headers = {}) {
    const res = await fetch(base + requestPath, { headers });
    return { status: res.status, body: (0, test_types_js_1.record)(await res.json().catch(() => ({}))) };
}
async function post(base, requestPath, body, headers = {}) {
    const res = await fetch(base + requestPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: (0, test_types_js_1.record)(await res.json().catch(() => ({}))) };
}
async function put(base, requestPath, body, headers = {}) {
    const res = await fetch(base + requestPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: (0, test_types_js_1.record)(await res.json().catch(() => ({}))) };
}
function agyMirrorText(home) {
    const root = path.join(home, '.pi', 'dish', 'agy', 'sessions');
    try {
        const mirrors = fs.readdirSync(root).filter(name => name.endsWith('.jsonl') && !name.endsWith('.acp.jsonl'));
        return mirrors.length === 1 ? fs.readFileSync(path.join(root, mirrors[0]), 'utf8') : '';
    }
    catch {
        return '';
    }
}
function agyClaim(home) {
    const root = path.join(home, '.pi', 'dish', 'agy', 'sessions');
    try {
        const mirrors = fs.readdirSync(root).filter(name => name.endsWith('.jsonl') && !name.endsWith('.acp.jsonl'));
        if (mirrors.length !== 1)
            return null;
        const nativeId = path.basename(mirrors[0], '.jsonl');
        return (0, test_types_js_1.record)(JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'sessions', `${nativeId}.json`), 'utf8')));
    }
    catch {
        return null;
    }
}
test('killing the pi-dish tmux server restores sessions and active bot relays once, skips retired bots, and enforces persisted backoff', { skip: !tmuxOk, timeout: 180_000 }, async (t) => {
    const home = makeHome(t, { bots: true, hibernation: 'off', recoveryMode: 'restore' });
    const server = await boot(home, {
        PI_DISH_AGY_COMMAND: agyCommand('default'),
        PI_DISH_BOTS: 'on',
        PI_DISH_BOT_MODELS: BOT_MODELS,
        PI_DISH_BOT_FAUX_DIR: home,
        PI_DISH_TMUX_WATCH_MS: '200',
        PI_DISH_TMUX_SETTLE_MS: '100',
        PI_DISH_TMUX_RECOVERY_BACKOFF_MS: '60000',
    });
    t.after(() => server.stop());
    // 1. Wait for Fleet bot to boot and publish its live relay lock.
    let fleetId = '';
    let fleetRoute = '';
    await untilAsync(async () => {
        const botsRes = await get(server.base, '/api/bots');
        const fleet = (0, test_types_js_1.records)(botsRes.body.bots).find(row => row.name === 'Fleet');
        if (!fleet)
            return false;
        fleetId = String(fleet.id);
        fleetRoute = String(fleet.sessionId);
        const lock = relayLock(home, fleetId);
        if (!lock?.pid || !alive(lock.pid))
            return false;
        const sessions = await get(server.base, '/api/sessions?active=1');
        return (0, test_types_js_1.records)(sessions.body.active).some(row => row.id === fleetRoute);
    }, 'Fleet bot relay starts');
    const firstFleetPid = (0, test_types_js_1.present)(relayLock(home, fleetId)).pid;
    // 2. Create a second bot and retire it before server loss; it must never be relaunched.
    const createdBot = await post(server.base, '/api/bots', {
        parentId: fleetId,
        name: 'RetiredHelper',
        identity: 'You are a temporary bot.',
    });
    assert.equal(createdBot.status, 201, JSON.stringify(createdBot.body));
    const retiredBotId = String((0, test_types_js_1.record)(createdBot.body.bot).id);
    await until(() => {
        const lock = relayLock(home, retiredBotId);
        return !!lock?.pid && alive(lock.pid);
    }, 'RetiredHelper relay starts');
    const retiredRes = await post(server.base, `/api/bots/${encodeURIComponent(retiredBotId)}/retire`, {});
    assert.equal(retiredRes.status, 200, JSON.stringify(retiredRes.body));
    await until(() => relayLock(home, retiredBotId) === null, 'RetiredHelper stopped');
    // 3. Create an agy session and complete one turn so it has a durable conversation.
    const createdAgy = await post(server.base, '/api/sessions/new', { harness: 'agy', cwd: path.join(home, 'proj') });
    assert.equal(createdAgy.status, 200, JSON.stringify(createdAgy.body));
    const agyRoute = String((0, test_types_js_1.present)(createdAgy.body.id));
    const prompted = await post(server.base, `/api/sessions/${encodeURIComponent(agyRoute)}/prompt`, { message: 'hello recovery' });
    assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
    await until(() => agyMirrorText(home).includes('Fake Antigravity reply.'), 'agy first turn answered');
    await until(() => agyClaim(home)?.turnInProgress === false, 'agy first turn settled');
    const firstAgyPid = Number((0, test_types_js_1.present)(agyClaim(home)?.pid));
    // Verify original server flags (-f /dev/null and exit-empty off).
    const firstTmuxPid = (0, test_types_js_1.present)(tmuxServerPid(home));
    const firstArgv = fs.readFileSync(`/proc/${firstTmuxPid}/cmdline`, 'utf8').split('\0');
    assert.equal(firstArgv[firstArgv.indexOf('-f') + 1], '/dev/null');
    assert.equal(tmuxOut(home, 'show-options', '-sv', 'exit-empty'), 'off');
    // Give the watch at least one tick to snapshot both the agy session and Fleet bot.
    await new Promise(resolve => setTimeout(resolve, 600));
    // 4. Kill the private pi-dish tmux server!
    (0, node_child_process_1.execFileSync)('tmux', ['-S', tmuxSocket(home), 'kill-server'], { env: (0, test_env_js_1.sanitizeTestEnv)(process.env) });
    // 5. Assert both the agent session and Fleet bot come back automatically once.
    await untilAsync(async () => {
        const report = await get(server.base, '/api/recovery');
        const agyRow = (0, test_types_js_1.records)(report.body.sessions).find(row => row.id === agyRoute);
        const fleetLock = relayLock(home, fleetId);
        const agyLive = agyClaim(home);
        return agyRow?.status === 'restored'
            && !!agyLive && Number(agyLive.pid) !== firstAgyPid && alive(Number(agyLive.pid))
            && !!fleetLock && fleetLock.pid !== firstFleetPid && alive(fleetLock.pid);
    }, 'agy session and Fleet bot both restored automatically', 60_000);
    // Server was recreated with -f /dev/null and exit-empty off.
    const secondTmuxPid = (0, test_types_js_1.present)(tmuxServerPid(home));
    assert.notEqual(secondTmuxPid, firstTmuxPid, 'a new tmux server process was created');
    const secondArgv = fs.readFileSync(`/proc/${secondTmuxPid}/cmdline`, 'utf8').split('\0');
    assert.equal(secondArgv[secondArgv.indexOf('-f') + 1], '/dev/null', 'recreated server uses -f /dev/null');
    assert.equal(tmuxOut(home, 'show-options', '-sv', 'exit-empty'), 'off', 'recreated server keeps exit-empty off');
    // Recovered agent resumed its conversation without starting a new paid turn.
    const replies = agyMirrorText(home).match(/Fake Antigravity reply\./g) || [];
    assert.equal(replies.length, 1, 'recovered agy session must not start a new paid turn on its own');
    // Roster reports Fleet running:true and RetiredHelper running:false (never relaunched).
    const roster = await get(server.base, `/api/bots/${encodeURIComponent(fleetId)}/roster`);
    assert.equal(roster.status, 200);
    const fleetEntry = (0, test_types_js_1.present)((0, test_types_js_1.records)(roster.body.bots).find(bot => bot.id === fleetId));
    const retiredEntry = (0, test_types_js_1.present)((0, test_types_js_1.records)(roster.body.bots).find(bot => bot.id === retiredBotId));
    assert.equal(fleetEntry.running, true, 'Fleet bot is running after server loss');
    assert.equal(retiredEntry.running, false, 'RetiredHelper must not be relaunched');
    assert.equal(relayLock(home, retiredBotId), null, 'RetiredHelper has no relay lock');
    // Persisted rate-limit state recorded exactly one attempt with 0600 mode.
    const stateFile = path.join(home, '.pi', 'dish', 'tmux-recovery-state.json');
    const state = (0, test_types_js_1.record)(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
    assert.equal(Array.isArray(state.attempts) && state.attempts.length, 1);
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
    await until(() => /\[tmux-recovery\] summary: sessions recovered=1.*bots restarted=1 \[Fleet\]/.test(server.log()), 'recovery summary logged');
    // 6. Rapid second server loss hits the persisted backoff and refuses to respawn.
    const secondFleetPid = (0, test_types_js_1.present)(relayLock(home, fleetId)).pid;
    const secondAgyPid = Number((0, test_types_js_1.present)(agyClaim(home)?.pid));
    await new Promise(resolve => setTimeout(resolve, 600));
    (0, node_child_process_1.execFileSync)('tmux', ['-S', tmuxSocket(home), 'kill-server'], { env: (0, test_env_js_1.sanitizeTestEnv)(process.env) });
    await untilAsync(async () => {
        const report = await get(server.base, '/api/recovery');
        const agyRow = (0, test_types_js_1.records)(report.body.sessions).find(row => row.id === agyRoute);
        return agyRow?.status === 'needs-review' && /backoff/i.test(String(agyRow.reason ?? ''));
    }, 'second rapid server loss is rate-limited to needs-review', 30_000);
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(tmuxServerPid(home), null, 'rate-limited server loss does not recreate the tmux server');
    assert.equal(relayLock(home, fleetId), null, 'rate-limited server loss does not respawn Fleet');
    assert.equal(alive(secondFleetPid), false);
    assert.equal(alive(secondAgyPid), false);
    assert.match(server.log(), /\[tmux-recovery\] automatic recovery skipped \(rate-limited\)/);
    const stateAfterLimit = (0, test_types_js_1.record)(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
    assert.deepEqual(stateAfterLimit.suppressedBots, [fleetId], 'suppressed bot persisted in backoff state');
    assert.deepEqual(stateAfterLimit.suppressedAgents, [agyRoute], 'suppressed agent persisted in backoff state');
    // 7. Deploy restart during active backoff honours persisted suppression (neither tmux nor Fleet nor agy starts).
    await server.stop();
    const restarted = await boot(home, {
        PI_DISH_AGY_COMMAND: agyCommand('default'),
        PI_DISH_BOTS: 'on',
        PI_DISH_BOT_MODELS: BOT_MODELS,
        PI_DISH_BOT_FAUX_DIR: home,
        PI_DISH_TMUX_WATCH_MS: '200',
        PI_DISH_TMUX_SETTLE_MS: '100',
        PI_DISH_TMUX_RECOVERY_BACKOFF_MS: '60000',
    });
    t.after(() => restarted.stop());
    await until(() => /bot Fleet: startup skipped \(.*backoff/i.test(restarted.log()), 'startup bot skip logged during backoff');
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(tmuxServerPid(home), null, 'restart during backoff does not recreate tmux');
    assert.equal(relayLock(home, fleetId), null, 'restart during backoff does not relaunch suppressed Fleet');
    assert.equal(agyClaim(home), null, 'restart during backoff does not relaunch suppressed agy session');
    // Explicit manual resume clears suppression, and a subsequent restart leaves the healthy relay untouched.
    const manualResume = await post(restarted.base, `/api/sessions/${encodeURIComponent(fleetRoute)}/resume`, {});
    assert.equal(manualResume.status, 200, JSON.stringify(manualResume.body));
    await until(() => {
        const lock = relayLock(home, fleetId);
        return !!lock?.pid && alive(lock.pid);
    }, 'manually resumed Fleet relay is running');
    const healthyFleetPid = (0, test_types_js_1.present)(relayLock(home, fleetId)).pid;
    await restarted.stop();
    const afterHealthyRestart = await boot(home, {
        PI_DISH_AGY_COMMAND: agyCommand('default'),
        PI_DISH_BOTS: 'on',
        PI_DISH_BOT_MODELS: BOT_MODELS,
        PI_DISH_BOT_FAUX_DIR: home,
        PI_DISH_TMUX_WATCH_MS: '200',
        PI_DISH_TMUX_SETTLE_MS: '100',
        PI_DISH_TMUX_RECOVERY_BACKOFF_MS: '60000',
    });
    t.after(() => afterHealthyRestart.stop());
    await until(() => afterHealthyRestart.log().includes(`bot Fleet: relay ${healthyFleetPid} is already running`), 'healthy relay is left alone across restart even while backoff state remains');
    assert.equal(relayLock(home, fleetId)?.pid, healthyFleetPid, 'healthy relay PID unchanged');
});
test('killing the replacement tmux server mid-batch stops the batch, never starts a 3rd server, and reconciles all rows', { skip: !tmuxOk, timeout: 180_000 }, async (t) => {
    const home = makeHome(t, { hibernation: 'off', recoveryMode: 'restore' });
    const triggerFile = path.join(home, 'kill-on-second-resume');
    const countFile = path.join(home, 'resume-count');
    // Wrapper around fake-agy-acp: when `triggerFile` exists, records each launch
    // and kills the replacement tmux server on the 2nd launch mid-batch.
    const wrapper = path.join(home, 'agy-wrapper.js');
    fs.writeFileSync(wrapper, `#!/usr/bin/env node
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const trigger = ${JSON.stringify(triggerFile)};
const counter = ${JSON.stringify(countFile)};
const socket = ${JSON.stringify(tmuxSocket(home))};
if (fs.existsSync(trigger)) {
  const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8').trim()) : 0) + 1;
  fs.writeFileSync(counter, String(n));
  if (n === 2) {
    try { fs.unlinkSync(trigger); } catch {}
    try { execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' }); } catch {}
    process.exit(1);
  }
}
const child = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(AGY_FIXTURE)}, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, FAKE_AGY_SCRIPT: 'default' },
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
`, { mode: 0o755 });
    const server = await boot(home, {
        PI_DISH_AGY_COMMAND: `${process.execPath} ${wrapper}`,
        PI_DISH_BOTS: 'off',
        PI_DISH_TMUX_WATCH_MS: '200',
        PI_DISH_TMUX_SETTLE_MS: '100',
        PI_DISH_TMUX_RECOVERY_BACKOFF_MS: '60000',
    });
    t.after(() => server.stop());
    // Create 3 live agy sessions on the initial tmux server.
    const routes = [];
    for (let i = 0; i < 3; i++) {
        const created = await post(server.base, '/api/sessions/new', { harness: 'agy', cwd: path.join(home, 'proj') });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        routes.push(String((0, test_types_js_1.present)(created.body.id)));
    }
    const firstTmuxPid = (0, test_types_js_1.present)(tmuxServerPid(home));
    await new Promise(resolve => setTimeout(resolve, 600));
    // Arm the mid-batch killer for the 2nd resume, then kill server #1.
    fs.writeFileSync(triggerFile, '1');
    (0, node_child_process_1.execFileSync)('tmux', ['-S', tmuxSocket(home), 'kill-server'], { env: (0, test_env_js_1.sanitizeTestEnv)(process.env) });
    // Wait for mid-batch server loss detection and reconciliation of all 3 rows.
    await untilAsync(async () => {
        const report = await get(server.base, '/api/recovery');
        const rows = routes.map(id => (0, test_types_js_1.records)(report.body.sessions).find(row => row.id === id));
        return rows.every(row => row?.status === 'needs-review' && /backoff/i.test(String(row.reason ?? '')));
    }, 'all 3 sessions reconciled to needs-review after mid-batch replacement server death', 60_000);
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(tmuxServerPid(home), null, 'no 3rd tmux server was started under the first limiter reservation');
    assert.equal(Number(fs.readFileSync(countFile, 'utf8').trim()), 2, '3rd session was never launched after replacement server died');
    const state = (0, test_types_js_1.record)(JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'tmux-recovery-state.json'), 'utf8')));
    assert.equal(Array.isArray(state.attempts) && state.attempts.length, 1, 'only the first limiter reservation was consumed');
    assert.notEqual(firstTmuxPid, null);
    assert.match(server.log(), /replacement tmux server \(pid \d+\) died mid-batch/);
});
test('single session exit does not trigger server loss, while on-demand no-server detection recovers immediately', { skip: !tmuxOk, timeout: 120_000 }, async (t) => {
    const home = makeHome(t, { hibernation: 'off', recoveryMode: 'restore' });
    // Very long poll interval (60s): server-loss recovery below MUST happen via on-demand detection.
    const server = await boot(home, {
        PI_DISH_AGY_COMMAND: agyCommand('default'),
        PI_DISH_BOTS: 'off',
        PI_DISH_TMUX_WATCH_MS: '60000',
        PI_DISH_TMUX_SETTLE_MS: '100',
    });
    t.after(() => server.stop());
    const created = await post(server.base, '/api/sessions/new', { harness: 'agy', cwd: path.join(home, 'proj') });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const route = String((0, test_types_js_1.present)(created.body.id));
    await until(() => !!agyClaim(home)?.pid, 'agy registered');
    const firstPid = Number((0, test_types_js_1.present)(agyClaim(home)?.pid));
    const serverPidBefore = (0, test_types_js_1.present)(tmuxServerPid(home));
    // Wait briefly so the onHeadlessSpawn hook snapshots the live pane.
    await new Promise(resolve => setTimeout(resolve, 400));
    // Kill ONLY the single agy relay process (simulating a session exiting on its own).
    process.kill(firstPid, 'SIGTERM');
    await until(() => !alive(firstPid) && agyClaim(home) === null, 'single agy process exited');
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(tmuxServerPid(home), serverPidBefore, 'pi-dish tmux server stays alive with the same PID when its only session exits');
    assert.equal(agyClaim(home), null, 'exited session is NOT resurrected when the server stayed alive');
    // Resume the session manually, wait for snapshot, then kill the whole tmux server.
    const resumed = await post(server.base, `/api/sessions/${encodeURIComponent(route)}/resume`, {});
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    await until(() => !!agyClaim(home)?.pid, 'resumed agy registered');
    const resumedPid = Number((0, test_types_js_1.present)(agyClaim(home)?.pid));
    await new Promise(resolve => setTimeout(resolve, 400));
    (0, node_child_process_1.execFileSync)('tmux', ['-S', tmuxSocket(home), 'kill-server'], { env: (0, test_env_js_1.sanitizeTestEnv)(process.env) });
    await until(() => tmuxServerPid(home) === null && !alive(resumedPid), 'tmux server and relay died');
    // Trigger an on-demand tmux probe (GET /api/tmux/targets runs pruneSpawns/paneExists on the dead socket).
    const targets = await get(server.base, '/api/tmux/targets');
    assert.equal(targets.status, 200);
    // Even with a 60s poll interval, on-demand detection restores the session promptly.
    await untilAsync(async () => {
        const claim = agyClaim(home);
        const report = await get(server.base, '/api/recovery');
        const row = (0, test_types_js_1.records)(report.body.sessions).find(entry => entry.id === route);
        return row?.status === 'restored' && !!claim && Number(claim.pid) !== resumedPid && alive(Number(claim.pid));
    }, 'on-demand detection restored session despite 60s poll interval', 20_000);
});
test('PIN gate protects private sessions on /api/recovery and /api/recovery/retry (single id and all: true)', { timeout: 60_000 }, async (t) => {
    const home = makeHome(t, { hibernation: 'off', recoveryMode: 'off' });
    const proj = path.join(home, 'proj');
    // Write one normal Pi session, one private Pi session, and one session whose
    // saved recovery path is public while its current transcript is in the private root.
    const pubId = '2026-11-24T01-00-00-pubrec01';
    const privId = '2026-11-24T01-00-00-prvrec01';
    const movedId = '2026-11-24T01-00-00-movprv01';
    const invalidRawId = '../invalid-private-id';
    const pubFile = path.join(home, '.pi', 'agent', 'sessions', 'proj', `${pubId}.jsonl`);
    const privFile = path.join(home, '.local', 'state', 'pi-dish', 'private-sessions', 'pi', `${privId}.jsonl`);
    const movedStalePublicPath = path.join(home, '.pi', 'agent', 'sessions', 'proj', `${movedId}.jsonl`);
    const movedPrivateFile = path.join(home, '.local', 'state', 'pi-dish', 'private-sessions', 'pi', `${movedId}.jsonl`);
    for (const [id, file] of [[pubId, pubFile], [privId, privFile], [movedId, movedPrivateFile]]) {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, [
            { type: 'session', id, cwd: proj },
            { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'secret check' }] } },
        ].map(line => JSON.stringify(line)).join('\n') + '\n');
    }
    // Seed recovery observations and failed attempts via lib/session-recovery in the isolated HOME.
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
        const recoveryStore = require('../lib/session-recovery');
        for (const [id, file, name] of [
            [pubId, pubFile, 'Public Work'],
            [privId, privFile, 'Private Secret'],
            [movedId, movedStalePublicPath, 'Moved Private Secret'],
        ]) {
            const saved = (0, test_types_js_1.present)(recoveryStore.recordSession({
                harnessId: 'pi', nativeSessionId: id, sessionFile: file, cwd: proj, name,
                pid: 999999, startTime: '1', instanceId: `inst-${id}`, activity: 'idle', shutdown: false,
            }));
            recoveryStore.patchControl('pi', id, {
                attempt: { observationId: saved.observationId, status: 'failed', reason: 'earlier failure', updatedAt: Date.now() },
            });
        }
        // Also write a raw invalid-route stored record carrying a private name/cwd.
        const obsDir = path.join(home, '.pi', 'dish', 'recovery', 'observations');
        fs.mkdirSync(obsDir, { recursive: true, mode: 0o700 });
        const key = crypto.createHash('sha256').update(JSON.stringify(['pi', invalidRawId])).digest('hex');
        fs.writeFileSync(path.join(obsDir, `${key}.json`), JSON.stringify({
            version: 1, harnessId: 'pi', nativeSessionId: invalidRawId,
            sessionFile: privFile, cwd: '/secret/private/cwd', name: 'Top Secret Leak',
            model: null, thinkingLevel: null, pid: 999999, startTime: '1', instanceId: 'inst-invalid',
            activity: 'idle', runId: null, shutdown: false, bootId: null, checkpoint: null,
            observationId: 'obs-invalid', updatedAt: new Date().toISOString(),
        }), { mode: 0o600 });
    }
    finally {
        if (prevHome === undefined)
            delete process.env.HOME;
        else
            process.env.HOME = prevHome;
    }
    const fakeRpcPi = path.join(__dirname, 'fixtures', 'fake-rpc-pi.js');
    const server = await boot(home, {
        PI_DISH_BOTS: 'off',
        PI_DISH_HEADLESS: 'rpc',
        PI_DISH_PI_COMMAND: `${process.execPath} ${fakeRpcPi}`,
    });
    t.after(() => server.stop());
    // Configure PIN; locked requests must never see or retry any private session or invalid route.
    assert.equal((await put(server.base, '/api/private-sessions/pin', { pin: '2468' })).status, 200);
    const lockedReport = await get(server.base, '/api/recovery');
    assert.equal(lockedReport.status, 200);
    const lockedIds = (0, test_types_js_1.records)(lockedReport.body.sessions).map(row => row.id);
    assert.deepEqual(lockedIds, [pubId], 'locked /api/recovery hides private, moved-private, and invalid-route sessions');
    assert.equal(lockedReport.body.totalRecords, 1, 'locked totalRecords excludes private and invalid-route sessions');
    assert.equal(JSON.stringify(lockedReport.body).includes('Top Secret Leak'), false);
    const lockedSingle = await post(server.base, '/api/recovery/retry', { id: privId });
    assert.equal(lockedSingle.status, 404, 'locked single retry returns 404 for private session');
    assert.ok((0, session_key_js_1.validSessionId)(privId));
    const lockedAlias = await post(server.base, '/api/recovery/retry', { id: (0, session_key_js_1.encodeSessionKey)('pi', privId) });
    assert.equal(lockedAlias.status, 404, 'locked single retry returns 404 for encoded private Pi alias');
    const lockedMoved = await post(server.base, '/api/recovery/retry', { id: movedId });
    assert.equal(lockedMoved.status, 404, 'locked single retry returns 404 when current source is private');
    const lockedInvalid = await post(server.base, '/api/recovery/retry', { id: invalidRawId });
    assert.equal(lockedInvalid.status, 400, 'invalid route is rejected before matching any raw stored record');
    assert.equal(JSON.stringify(lockedInvalid.body).includes('Top Secret Leak'), false, 'private name never leaked');
    assert.equal(JSON.stringify(lockedInvalid.body).includes('/secret/private/cwd'), false, 'private cwd never leaked');
    const lockedAll = await post(server.base, '/api/recovery/retry', { all: true });
    assert.equal(lockedAll.status, 200, JSON.stringify(lockedAll.body));
    const lockedOutcomes = (0, test_types_js_1.records)(lockedAll.body.outcomes);
    assert.deepEqual(lockedOutcomes.map(row => row.id), [pubId], 'locked retry-all only retries public sessions');
    assert.equal(lockedOutcomes[0].status, 'restored');
    // Unlocking reveals the private sessions (including current-source private) and lets retry-all restore them.
    const unlock = await post(server.base, '/api/private-sessions/unlock', { pin: '2468' });
    assert.equal(unlock.status, 200);
    const headers = { 'X-Pi-Dish-Private-Unlock': String(unlock.body.token) };
    const unlockedReport = await get(server.base, '/api/recovery', headers);
    assert.equal(unlockedReport.status, 200);
    const unlockedIds = (0, test_types_js_1.records)(unlockedReport.body.sessions).map(row => String(row.id)).sort();
    assert.deepEqual(unlockedIds, [movedId, privId, pubId].sort());
    assert.equal(unlockedReport.body.totalRecords, 3);
    const unlockedSingle = await post(server.base, '/api/recovery/retry', { id: privId }, headers);
    assert.equal(unlockedSingle.status, 200, JSON.stringify(unlockedSingle.body));
    assert.equal(unlockedSingle.body.status, 'restored');
});
