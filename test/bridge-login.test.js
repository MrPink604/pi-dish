// Generated test/tool from test/bridge-login.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_events_1 = require("node:events");
const promises_1 = require("node:timers/promises");
const test_types_js_1 = require("./test-types.js");
const bridge = require('../lib/bridge-session.js');
const sessionKey = require('../lib/session-key.js');
const bunAvailable = (0, node_child_process_1.spawnSync)('bun', ['--version'], { stdio: 'ignore' }).status === 0;
async function startHost(profile) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `pi-dish-login-${profile}-`));
    const home = path.join(root, 'home');
    const socketDir = path.join(root, 'sockets');
    const logFile = path.join(root, 'host.jsonl');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    const child = (0, node_child_process_1.spawn)('bun', [path.join(__dirname, 'fixtures', 'fake-login-host.ts')], {
        cwd: path.resolve(__dirname, '..'),
        env: {
            ...process.env, HOME: home, TMUX: '', TMUX_PANE: '', PI_DISH_SOCKET_DIR: socketDir,
            FAKE_SESSION_FILE: path.join(root, 'session.jsonl'), FAKE_LOGIN_PROFILE: profile, FAKE_LOGIN_LOG: logFile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const close = async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const closed = (0, node_events_1.once)(child, 'close');
            child.kill('SIGTERM');
            await Promise.race([closed, (0, promises_1.setTimeout)(3000)]);
            if (child.exitCode === null && child.signalCode === null)
                child.kill('SIGKILL');
        }
        fs.rmSync(root, { recursive: true, force: true });
    };
    try {
        let stdout = '';
        const ready = (async () => {
            for await (const chunk of child.stdout) {
                stdout += chunk;
                if (stdout.includes('READY'))
                    return;
            }
            throw new Error(`fake host exited ${child.exitCode}: ${stderr}`);
        })();
        // The external Bun fixture exposes only its READY line; real time bounds a missing process signal.
        const timeout = new AbortController();
        try {
            await Promise.race([ready, (0, promises_1.setTimeout)(5000, undefined, { signal: timeout.signal }).then(() => { throw new Error(`fake host timeout: ${stderr}`); })]);
        }
        finally {
            timeout.abort();
        }
    }
    catch (error) {
        await close();
        throw error;
    }
    const registryDir = path.join(home, '.pi', 'dish', 'sessions');
    const registryName = fs.readdirSync(registryDir).find(name => name.endsWith('.json'));
    assert.ok(registryName);
    const claim = (0, test_types_js_1.record)(JSON.parse(fs.readFileSync(path.join(registryDir, registryName), 'utf8')));
    assert.ok(sessionKey.validSessionId(claim.sessionId) && typeof claim.socketPath === 'string');
    const session = new bridge.BridgeSession({ ...claim, sessionId: claim.sessionId, socketPath: claim.socketPath });
    const events = [];
    const waiters = new Set();
    const push = (name) => (data) => {
        events.push({ name, data: (0, test_types_js_1.record)(data) });
        for (const wake of waiters)
            wake();
    };
    session.on('extension_ui_request', push('request'));
    session.on('extension_ui_resolved', push('resolved'));
    await session.connect();
    // Resolves with the first event after `from` (an index into events) matching
    // `match`. Woken by each socket event; the deadline only bounds a host that
    // never sends it.
    function next(from, match) {
        return new Promise((resolve, reject) => {
            const check = () => {
                const hit = events.slice(from).find(match);
                if (!hit)
                    return;
                waiters.delete(check);
                clearTimeout(deadline);
                resolve(hit);
            };
            const deadline = setTimeout(() => {
                waiters.delete(check);
                reject(new Error(`no matching event; saw ${JSON.stringify(events.slice(from))}`));
            }, 5000);
            waiters.add(check);
            check();
        });
    }
    const step = (from, match = () => true) => next(from, event => event.name === 'request' && event.data.method === 'auth' && match(event.data)).then(event => event.data);
    const toast = (from) => next(from, event => event.name === 'request' && event.data.method === 'notify').then(event => event.data);
    const hostLog = () => fs.existsSync(logFile)
        ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map(line => (0, test_types_js_1.record)(JSON.parse(line))) : [];
    return {
        session, events, step, toast, hostLog, next, child,
        async close() { session.close(); await close(); },
    };
}
const prompted = (kind) => (data) => (0, test_types_js_1.record)(data.prompt ?? {}).kind === kind;
test('OMP /login walks provider choice, a rejected paste and a matching redirect URL to a stored login', { skip: !bunAvailable }, async () => {
    const host = await startHost('omp');
    try {
        assert.equal(host.session.capabilities.login, true);
        const listed = (0, test_types_js_1.records)((0, test_types_js_1.record)(await host.session.getCommands()).commands).find(command => command.name === 'login');
        assert.equal(listed?.supported, true);
        let mark = host.events.length;
        assert.equal((0, test_types_js_1.record)(await host.session.runCommand('/login')).info, 'Choose a provider to sign in');
        const choice = await host.step(mark, prompted('select'));
        const options = (0, test_types_js_1.records)((0, test_types_js_1.record)(choice.prompt).options);
        assert.deepEqual(options.map(option => option.id), ['oauth:fake-fail', 'oauth:fake-oauth'], 'unavailable providers are not offered');
        mark = host.events.length;
        await host.session.respondExtensionUI(String(choice.id), { value: 'oauth:fake-oauth' });
        const codeStep = await host.step(mark, prompted('code'));
        assert.equal(codeStep.loginId, choice.loginId, 'every step belongs to the same login');
        assert.equal(codeStep.title, 'Log in to Fake OAuth');
        assert.equal(codeStep.url, 'https://auth.example/omp?state=s1');
        assert.equal(codeStep.instructions, 'Finish in the browser.');
        assert.ok(await host.next(mark, event => event.name === 'resolved' && event.data.id === choice.id && event.data.source === 'superseded'));
        mark = host.events.length;
        await host.session.respondExtensionUI(String(codeStep.id), { value: 'http://localhost:1455/cb?code=x&state=other-login' });
        const retry = await host.step(mark, data => prompted('code')(data) && data.id !== codeStep.id);
        assert.match(String(retry.message), /didn't complete sign-in/);
        mark = host.events.length;
        await host.session.respondExtensionUI(String(retry.id), { value: 'http://localhost:1455/cb?code=x&state=s1' });
        const done = await host.toast(mark);
        assert.equal(done.message, 'Logged in to Fake OAuth as me@example.com');
        const pending = host.events.slice(mark).filter(event => event.name === 'request' && event.data.method === 'auth').map(event => event.data.id);
        const resolved = new Set(host.events.filter(event => event.name === 'resolved').map(event => event.data.id));
        assert.ok(pending.every(id => resolved.has(id)), 'no login step is left pending');
        assert.deepEqual(host.hostLog().filter(entry => entry.op !== 'login'), [
            { op: 'code', input: 'http://localhost:1455/cb?code=x&state=other-login' },
            { op: 'code', input: 'http://localhost:1455/cb?code=x&state=s1' },
            { op: 'refresh', id: 'fake-models', mode: 'online' },
        ]);
    }
    finally {
        await host.close();
    }
});
test('OMP /login cancel aborts the host flow; failures and unknown providers are reported', { skip: !bunAvailable }, async () => {
    const host = await startHost('omp');
    try {
        let mark = host.events.length;
        await host.session.runCommand('/login Fake OAuth');
        const codeStep = await host.step(mark, prompted('code'));
        mark = host.events.length;
        await host.session.respondExtensionUI(String(codeStep.id), { cancelled: true });
        assert.equal((await host.toast(mark)).message, 'Login cancelled');
        assert.ok(host.events.some(event => event.name === 'resolved' && event.data.id === codeStep.id && event.data.source === 'login'));
        assert.ok(host.hostLog().some(entry => entry.op === 'aborted'), 'the host flow saw the abort signal');
        mark = host.events.length;
        await host.session.runCommand('/login fake-fail');
        const failed = await host.toast(mark);
        assert.equal(failed.notifyType, 'error');
        assert.equal(failed.message, 'Login to Fake Failure failed: provider exploded');
        await assert.rejects(host.session.runCommand('/login nope'), /Unknown login provider "nope"/);
    }
    finally {
        await host.close();
    }
});
test('Pi /login asks for the auth method and finishes when the loopback callback wins', { skip: !bunAvailable }, async () => {
    const host = await startHost('pi');
    try {
        let mark = host.events.length;
        await host.session.runCommand('/login fake');
        const method = await host.step(mark, prompted('select'));
        assert.deepEqual((0, test_types_js_1.records)((0, test_types_js_1.record)(method.prompt).options).map(option => [option.id, option.label, option.description]), [
            ['oauth:fake', 'Sign in with an account', 'configured'],
            ['api_key:fake', 'API key', 'configured'],
        ]);
        mark = host.events.length;
        await host.session.respondExtensionUI(String(method.id), { value: 'oauth:fake' });
        const codeStep = await host.step(mark, prompted('code'));
        assert.equal(codeStep.url, 'https://auth.example/pi?state=p1');
        assert.equal((0, test_types_js_1.record)(codeStep.prompt).placeholder, 'http://localhost:53692/callback');
        mark = host.events.length;
        host.child.kill('SIGUSR2'); // the browser reached the harness's loopback callback
        assert.equal((await host.toast(mark)).message, 'Logged in to Fake');
        const later = host.events.slice(mark).filter(event => event.name === 'request' && event.data.method === 'auth');
        assert.ok(later.length > 0 && later.every(event => event.data.prompt === undefined), 'the paste box goes away once the callback answers');
        assert.ok(host.events.some(event => event.name === 'resolved' && event.data.id === codeStep.id));
        assert.deepEqual(host.hostLog(), [
            { op: 'login', id: 'fake', type: 'oauth' },
            { op: 'manual-aborted' },
            { op: 'refresh', providers: ['fake'] },
        ]);
    }
    finally {
        await host.close();
    }
});
test('Pi /login lists only providers that can log in and saves a prompted API key', { skip: !bunAvailable }, async () => {
    const host = await startHost('pi');
    try {
        await assert.rejects(host.session.runCommand('/login ambient'), /Unknown login provider/);
        let mark = host.events.length;
        await host.session.runCommand('/login');
        const choice = await host.step(mark, prompted('select'));
        assert.deepEqual((0, test_types_js_1.records)((0, test_types_js_1.record)(choice.prompt).options).map(option => option.id), ['oauth:fake', 'api_key:fake']);
        mark = host.events.length;
        await host.session.respondExtensionUI(String(choice.id), { value: 'api_key:fake' });
        const secret = await host.step(mark, prompted('secret'));
        mark = host.events.length;
        await host.session.respondExtensionUI(String(secret.id), { value: 'sk-123' });
        assert.equal((await host.toast(mark)).message, 'Saved API key for Fake');
        assert.deepEqual(host.hostLog().slice(0, 2), [{ op: 'login', id: 'fake', type: 'api_key' }, { op: 'key', key: 'sk-123' }]);
    }
    finally {
        await host.close();
    }
});
