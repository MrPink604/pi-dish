// Generated test/tool from test/bot-relay-restart.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Bots onto new code: when pi-dish starts and a bot's relay runs another build, the relay is restarted through the
 * bounce queue once it is idle. Each case boots server.js against a temp HOME and an isolated tmux server with bots
 * on; the relay in the pane is the real one, its model scripted by `fixtures/bot-scripted-models.js`
 * (`PI_DISH_BOT_MODELS`). A relay from before builds were recorded is made by removing the build from its lock and
 * its `relay-build` file, which is how the first deploy of this change finds the bots already running.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const test_types_js_1 = require("./test-types.js");
const test_env_js_1 = require("./test-env.js");
const SERVER = path.join(__dirname, '..', 'server.js');
const MODELS = path.join(__dirname, 'fixtures', 'bot-scripted-models.js');
const children = new Set();
const homes = new Set();
test.after(async () => {
    for (const booted of children)
        await booted.stop().catch(() => { });
    for (const home of homes) {
        const relays = fs.readdirSync(botsDir(home), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== 'sessions')
            .map(entry => relayLock(home, entry.name)?.pid).filter((pid) => typeof pid === 'number');
        // Relay panes outlive the server; the isolated tmux server must not, and a relay stops with its pane.
        try {
            (0, node_child_process_1.execFileSync)('tmux', ['-S', path.join(home, 'tmux', 'pi-dish'), 'kill-server'], { stdio: 'ignore' });
        }
        catch { }
        for (const pid of relays)
            await until(() => !alive(pid), `relay ${pid} stops with its pane`, 15_000).catch(() => process.kill(pid, 'SIGKILL'));
        fs.rmSync(home, { recursive: true, force: true });
    }
});
function makeHome() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bot-restart-'));
    homes.add(home);
    fs.mkdirSync(path.join(home, '.pi', 'dish'), { recursive: true });
    fs.mkdirSync(path.join(home, 'tmux'), { recursive: true });
    fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'), JSON.stringify({ bots: true }));
    return home;
}
function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const port = probe.address().port;
            probe.close(error => error ? reject(error) : resolve(port));
        });
    });
}
/** A server on `port` with bots on; the same port each time, so a relay started by an earlier server still reaches it. */
async function boot(home, port) {
    const base = `http://127.0.0.1:${port}`;
    const env = {
        ...(0, test_env_js_1.sanitizeTestEnv)(process.env), HOME: home, PORT: String(port), TMUX_TMPDIR: path.join(home, 'tmux'), PI_OFFLINE: '1',
        PI_DISH_BOTS: 'on', PI_DISH_URL: base, PI_DISH_BOT_MODELS: MODELS, PI_DISH_BOT_FAUX_DIR: home,
    };
    const child = (0, node_child_process_1.spawn)(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr?.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.stdout?.on('data', (chunk) => { output += chunk.toString('utf8'); });
    const exited = new Promise(resolve => { child.once('close', () => resolve()); });
    const booted = {
        base, child, log: () => output,
        async stop() {
            if (child.exitCode === null && child.signalCode === null)
                child.kill('SIGTERM');
            await exited;
            children.delete(booted);
        },
    };
    children.add(booted);
    await untilAsync(async () => {
        if (child.exitCode !== null || child.signalCode !== null)
            throw new Error(`server exited during startup: ${output}`);
        return fetch(`${base}/api/host`).then(response => response.ok, () => false);
    }, 'the server listens');
    return booted;
}
async function until(predicate, message, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > deadline)
            throw new Error(`Timed out: ${message}`);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
async function untilAsync(predicate, message, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (!await predicate()) {
        if (Date.now() > deadline)
            throw new Error(`Timed out: ${message}`);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
async function get(base, requestPath) {
    return (0, test_types_js_1.record)(await (await fetch(base + requestPath)).json());
}
async function prompt(base, route, message) {
    const response = await fetch(`${base}/api/sessions/${encodeURIComponent(route)}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
    });
    assert.equal(response.status, 200, `the prompt is taken: ${await response.text()}`);
}
const botsDir = (home) => path.join(home, '.pi', 'dish', 'bots');
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
/** What the bot's chat holds: each message's role and text, and each notice's type and text. */
function chat(home, id) {
    let lines;
    try {
        lines = fs.readFileSync(path.join(botsDir(home), 'sessions', `${id}.jsonl`), 'utf8').split('\n').filter(Boolean);
    }
    catch {
        return [];
    }
    return lines.map(line => (0, test_types_js_1.record)(JSON.parse(line))).flatMap(entry => {
        const message = entry.type === 'message' ? (0, test_types_js_1.record)(entry.message) : entry.type === 'custom_message' ? entry : null;
        if (!message)
            return [];
        const text = (0, test_types_js_1.records)(message.content).filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('');
        return [{ kind: entry.type === 'message' ? String(message.role) : String(entry.customType), text }];
    });
}
const said = (home, id, text) => chat(home, id).filter(entry => entry.kind === 'assistant' && entry.text === text).length;
/** Fleet, once its relay is up and listed as a live session. */
async function liveFleet(booted, home) {
    let fleet;
    await untilAsync(async () => {
        fleet = (0, test_types_js_1.records)((await get(booted.base, '/api/bots')).bots)[0];
        if (!fleet)
            return false;
        const lock = relayLock(home, String(fleet.id));
        if (!lock?.build || !alive(lock.pid))
            return false;
        const sessions = await get(booted.base, '/api/sessions?active=1').catch(() => ({ active: [] }));
        return (0, test_types_js_1.records)((0, test_types_js_1.record)(sessions).active).some(row => row.id === fleet.sessionId);
    }, 'Fleet\u2019s relay runs and is listed');
    const id = String(fleet.id);
    const lock = relayLock(home, id);
    return { id, route: String(fleet.sessionId), pid: lock.pid, build: lock.build };
}
/** Makes the running relay look like one from before relays recorded their build. */
function forgetBuild(home, id) {
    const lock = relayLock(home, id);
    fs.writeFileSync(path.join(botsDir(home), id, 'relay.lock'), JSON.stringify({ pid: lock.pid, startTime: lock.startTime }));
    fs.rmSync(path.join(botsDir(home), id, 'relay-build'), { force: true });
}
async function bounces(base) {
    return (0, test_types_js_1.records)((await get(base, '/api/session-bounces')).operations).flatMap(operation => (0, test_types_js_1.records)((0, test_types_js_1.record)(operation).targets));
}
test('pi-dish restarts an idle relay from another build once, keeping its conversation, and leaves one on its own build alone', { timeout: 180_000 }, async () => {
    const home = makeHome();
    const port = await freePort();
    let server = await boot(home, port);
    const before = await liveFleet(server, home);
    assert.match(before.build, /^[0-9a-f]{12}$/, 'the relay records the build it started from');
    await prompt(server.base, before.route, 'Remember seven.');
    await until(() => said(home, before.id, 'echo 1: Remember seven.') === 1, 'Fleet answers');
    await server.stop();
    assert.ok(alive(before.pid), 'the relay outlives the server');
    forgetBuild(home, before.id);
    server = await boot(home, port);
    await until(() => relayLock(home, before.id)?.pid !== before.pid && relayLock(home, before.id)?.build === before.build, 'the stale relay is replaced by one on the server\u2019s build');
    await until(() => !alive(before.pid), 'the old relay stops');
    await until(() => server.log().includes(`bot Fleet: restarted onto build ${before.build}`), 'the server logs the restart');
    const after = await liveFleet(server, home);
    assert.deepEqual(chat(home, before.id).filter(entry => entry.kind === 'bot-restart'), [{ kind: 'bot-restart', text: `Restarted onto new pi-dish code (build ${before.build}).` }], 'the chat says so');
    await prompt(server.base, after.route, 'What did I ask you to remember?');
    await until(() => said(home, before.id, 'echo 2: What did I ask you to remember?') === 1, 'Fleet answers from its stored conversation');
    const targets = await bounces(server.base);
    assert.deepEqual(targets.map(target => [target.sessionId, target.status]), [[after.route, 'completed']], 'one restart, done');
    assert.equal(relayLock(home, before.id)?.pid, after.pid, 'restarted once');
    await server.stop();
    // The next start finds the relay on its own build.
    server = await boot(home, port);
    await until(() => server.log().includes(`bot Fleet: relay ${after.pid} is already running`), 'the server finds the relay running');
    assert.deepEqual(await bounces(server.base), [], 'nothing is queued');
    // Bounce agents can restart it by hand.
    const preview = (0, test_types_js_1.records)((await get(server.base, '/api/session-bounces/preview?mode=restart')).targets);
    assert.deepEqual(preview.map(target => [target.sessionId, target.eligible, target.blockers]), [[after.route, true, []]]);
    assert.equal(relayLock(home, before.id)?.pid, after.pid);
    assert.equal(chat(home, before.id).filter(entry => entry.kind === 'bot-restart').length, 1);
    await server.stop();
});
test('a stale relay in a run is restarted only once the run ends', { timeout: 180_000 }, async () => {
    const home = makeHome();
    const port = await freePort();
    let server = await boot(home, port);
    const before = await liveFleet(server, home);
    fs.writeFileSync(path.join(home, 'hold'), '');
    await prompt(server.base, before.route, 'Take your time.');
    await until(() => fs.existsSync(path.join(home, 'holding')), 'the run waits on its model');
    await server.stop();
    forgetBuild(home, before.id);
    server = await boot(home, port);
    await untilAsync(async () => (await bounces(server.base)).some(target => target.status === 'waiting'
        && /Waiting for the current turn to finish/.test(String(target.reason))), 'the restart waits for the run');
    assert.equal(relayLock(home, before.id)?.pid, before.pid, 'the relay in its run is left alone');
    assert.equal(said(home, before.id, 'echo 1: Take your time.'), 0);
    fs.rmSync(path.join(home, 'hold'));
    await until(() => relayLock(home, before.id)?.pid !== before.pid && relayLock(home, before.id)?.build === before.build, 'the restart follows the run');
    const kinds = chat(home, before.id).map(entry => entry.kind === 'assistant' ? entry.text : entry.kind);
    assert.deepEqual(kinds.slice(-2), ['echo 1: Take your time.', 'bot-restart'], 'the run answered before the relay restarted');
    await untilAsync(async () => (await bounces(server.base)).some(target => target.status === 'completed'), 'the restart completes');
    await server.stop();
});
test('a message sent while a bot\u2019s relay is down starts it and is delivered once', { timeout: 180_000 }, async () => {
    const home = makeHome();
    const port = await freePort();
    const server = await boot(home, port);
    const before = await liveFleet(server, home);
    process.kill(before.pid, 'SIGKILL');
    await until(() => !alive(before.pid), 'the relay is down');
    await prompt(server.base, before.route, 'Are you there?');
    await until(() => said(home, before.id, 'echo 1: Are you there?') === 1, 'the bot is back and answers');
    assert.notEqual(relayLock(home, before.id)?.pid, before.pid);
    assert.equal(chat(home, before.id).filter(entry => entry.kind === 'user' && entry.text === 'Are you there?').length, 1, 'delivered once');
    await server.stop();
});
