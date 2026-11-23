// Generated tool from test/tmux-service.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const test = require("node:test");
const ROOT = path.resolve(__dirname, '..');
const tmux = require('../lib/tmux');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (predicate())
            return;
        await delay(25);
    }
    throw new Error(`timed out waiting for ${label}`);
}
function freePort() {
    return new Promise(resolve => {
        const probe = net.createServer();
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            assert.ok(address && typeof address !== 'string');
            const { port } = address;
            probe.close(() => resolve(port));
        });
    });
}
const alive = (pid) => {
    if (pid === undefined || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
};
// The scripts locate their root from their own path and the manager kills every
// matching process under it, so the fixture copies them into a throwaway root:
// a test must never reap the developer's own server. `server.js` there is a
// stub that idles, which is all the supervisor and the /proc scan care about.
function fixtureRoot(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-service-'));
    t.after(() => {
        (0, node_child_process_1.spawnSync)(path.join(root, 'scripts', 'pi-dish-tmux.sh'), ['stop'], { env: fixtureEnv(root, 0) });
        fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'bin'));
    for (const script of ['pi-dish-tmux.sh', 'supervise-tailnet.sh', 'run-tailnet.sh']) {
        fs.copyFileSync(path.join(ROOT, 'scripts', script), path.join(root, 'scripts', script));
        fs.chmodSync(path.join(root, 'scripts', script), 0o755);
    }
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'service-marker-server.js'), path.join(root, 'server.js'));
    // tmux and curl are stubbed: the duplicate-instance guards under test are
    // process-level, and a real tmux server would outlive the temp root.
    fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'bin', 'curl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    return root;
}
function fixtureEnv(root, port) {
    return {
        HOME: root,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        // Never source the operator's env file - it would override HOST/PORT.
        PI_DISH_ENV_FILE: path.join(root, 'no-such-env'),
        PI_DISH_LEGACY_ROOT: '',
        XDG_RUNTIME_DIR: root,
        TMUX_LOG: path.join(root, 'tmux-env.log'),
        PI_DISH_SERVICE_MARKER: path.join(root, 'started'),
        HOST: '127.0.0.1',
        PORT: String(port),
        PI_DISH_RESTART_DELAY: '1',
    };
}
test('a second supervisor on the same endpoint exits instead of looping', async (t) => {
    const root = fixtureRoot(t);
    const port = await freePort();
    const env = fixtureEnv(root, port);
    const first = (0, node_child_process_1.spawn)(path.join(root, 'scripts', 'supervise-tailnet.sh'), { env, stdio: 'ignore' });
    t.after(() => {
        if (first.pid !== undefined) {
            try {
                process.kill(-first.pid, 'SIGKILL');
            }
            catch { }
        }
        first.kill('SIGKILL');
    });
    await waitFor(() => fs.existsSync(path.join(root, 'started')), 'first server start');
    const winnerPid = Number(fs.readFileSync(path.join(root, 'started'), 'utf8'));
    assert.ok(Number.isInteger(winnerPid) && winnerPid > 0);
    const second = (0, node_child_process_1.spawnSync)(path.join(root, 'scripts', 'supervise-tailnet.sh'), { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(second.status, 3, second.stderr);
    // Exit 3 is the non-restarting path; the winning server must be untouched.
    assert.equal(Number(fs.readFileSync(path.join(root, 'started'), 'utf8')), winnerPid);
    assert.equal(alive(winnerPid), true);
});
test('stop reaps the supervisor, not just the server it respawns', async (t) => {
    const root = fixtureRoot(t);
    const port = await freePort();
    const env = fixtureEnv(root, port);
    const supervisor = (0, node_child_process_1.spawn)(path.join(root, 'scripts', 'supervise-tailnet.sh'), { env, stdio: 'ignore' });
    await waitFor(() => fs.existsSync(path.join(root, 'started')), 'server start');
    const serverPid = Number(fs.readFileSync(path.join(root, 'started'), 'utf8'));
    assert.ok(Number.isInteger(serverPid) && serverPid > 0);
    const stop = (0, node_child_process_1.spawnSync)(path.join(root, 'scripts', 'pi-dish-tmux.sh'), ['stop'], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
    assert.equal(stop.status, 0, stop.stderr);
    await waitFor(() => !alive(supervisor.pid) && !alive(serverPid), 'supervisor and server exit');
    // Nothing respawned in the window a live supervisor would have used.
    fs.rmSync(path.join(root, 'started'));
    await delay(1500);
    assert.equal(fs.existsSync(path.join(root, 'started')), false);
});
test('tmux service manager ignores the caller tmux socket', t => {
    const temp = fixtureRoot(t);
    const bin = path.join(temp, 'bin');
    const log = path.join(temp, 'tmux-env.log');
    fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\nif [ "\${TMUX+x}" = x ]; then\n  printf 'set:%s\\n' "$TMUX" >> "$TMUX_LOG"\nelse\n  printf 'unset\\n' >> "$TMUX_LOG"\nfi\nexit 1\n`, { mode: 0o755 });
    const result = (0, node_child_process_1.spawnSync)(path.join(temp, 'scripts', 'pi-dish-tmux.sh'), ['stop'], {
        cwd: temp,
        env: {
            ...fixtureEnv(temp, 3333),
            PATH: `${bin}:${process.env.PATH}`,
            TMUX: '/tmp/tmux-1000/other,123,0',
            TMUX_LOG: log,
            HOST: '127.0.0.1',
            PORT: '3333',
            PI_DISH_TMUX_SESSION: 'test-service',
        },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['unset']);
});
test('status follows loopback HTTP health without querying tmux or Tailscale', t => {
    const root = fixtureRoot(t);
    const envFile = path.join(root, 'env');
    fs.writeFileSync(envFile, 'PORT=4321\n');
    const bin = path.join(root, 'bin');
    for (const cmd of ['tmux', 'tailscale']) {
        fs.writeFileSync(path.join(bin, cmd), '#!/bin/sh\nprintf "called\\n" >> "$TMUX_LOG"\nexit 1\n', { mode: 0o755 });
    }
    fs.writeFileSync(path.join(bin, 'curl'), [
        '#!/bin/sh',
        'case "$*" in',
        '  *" http://127.0.0.1:4321/api/host") exit "$CURL_STATUS" ;;',
        '  *) exit 99 ;;',
        'esac',
    ].join('\n'), { mode: 0o755 });
    const env = { ...fixtureEnv(root, 0), HOST: undefined, PORT: undefined, PI_DISH_ENV_FILE: envFile };
    const status = (code) => (0, node_child_process_1.spawnSync)(path.join(root, 'scripts', 'pi-dish-tmux.sh'), ['status'], {
        env: { ...env, CURL_STATUS: code }, encoding: 'utf8',
    });
    const healthy = status('0');
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.match(healthy.stdout, /healthy at http:\/\/127\.0\.0\.1:4321/);
    const down = status('22');
    assert.equal(down.status, 1);
    assert.match(down.stderr, /not healthy at http:\/\/127\.0\.0\.1:4321/);
    assert.equal(fs.existsSync(path.join(root, 'tmux-env.log')), false);
});
// A unix socket where the user systemd manager's private socket would be. It
// drops every connection: tmux itself dials it to place panes and would
// otherwise wait on a manager that never answers.
async function fakeUserManager(t, runtimeDir) {
    fs.mkdirSync(path.join(runtimeDir, 'systemd'), { recursive: true });
    const manager = net.createServer(connection => connection.destroy());
    await new Promise(resolve => manager.listen(path.join(runtimeDir, 'systemd', 'private'), resolve));
    t.after(() => manager.close());
}
// Logs its argv, then runs the command after `--` the way a created scope does.
const systemdRunStub = (exitStatus) => [
    '#!/bin/sh',
    'printf "systemd-run %s\\n" "$*" >> "$TMUX_LOG"',
    ...(exitStatus === null ? ['while [ "$1" != -- ]; do shift; done', 'shift', 'exec "$@"'] : [`exit ${exitStatus}`]),
].join('\n');
test('start bootstraps the default tmux server in its own systemd scope, falling back unscoped', async (t) => {
    const cases = [
        { name: 'scoped', manager: true, systemdRun: null, env: {}, scoped: true },
        { name: 'scope refused', manager: true, systemdRun: 1, env: {}, scoped: false },
        { name: 'opted out', manager: true, systemdRun: null, env: { PI_DISH_TMUX_SCOPE: '0' }, scoped: false },
        { name: 'no user manager', manager: false, systemdRun: null, env: {}, scoped: false },
    ];
    for (const scenario of cases) {
        const root = fixtureRoot(t);
        const bin = path.join(root, 'bin');
        const log = path.join(root, 'tmux-env.log');
        if (scenario.manager)
            await fakeUserManager(t, root);
        fs.writeFileSync(path.join(bin, 'systemd-run'), systemdRunStub(scenario.systemdRun), { mode: 0o755 });
        // No server is running until the bootstrap session starts one.
        fs.writeFileSync(path.join(bin, 'tmux'), [
            '#!/bin/sh',
            'printf "tmux %s\\n" "$*" >> "$TMUX_LOG"',
            'case "$1" in list-sessions|has-session) exit 1 ;; esac',
        ].join('\n'), { mode: 0o755 });
        fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        const start = (0, node_child_process_1.spawnSync)(path.join(root, 'scripts', 'pi-dish-tmux.sh'), ['start'], {
            cwd: root,
            env: { ...fixtureEnv(root, 3333), PI_DISH_TMUX_STARTUP_DELAY: '0', ...scenario.env },
            encoding: 'utf8',
            timeout: 20000,
        });
        assert.equal(start.status, 0, `${scenario.name}: ${start.stderr}`);
        const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
        const bootstrap = /new-session -d -s pi-dish-bootstrap-\d+ -n bootstrap sleep 30$/;
        const scopeCalls = calls.filter(line => line.startsWith('systemd-run '));
        const direct = calls.filter(line => line.startsWith('tmux ') && bootstrap.test(line));
        // The bootstrap tmux client runs exactly once either way; only it starts a server.
        assert.equal(direct.length, 1, `${scenario.name}: ${calls.join('\n')}`);
        if (scenario.scoped) {
            assert.equal(scopeCalls.length, 1, scenario.name);
            assert.match(scopeCalls[0], /^systemd-run --user --scope --quiet --collect --unit=pi-dish-tmux-default-\d+-\d+\.scope -- tmux new-session /);
        }
        else {
            assert.equal(scopeCalls.length, scenario.systemdRun === 1 ? 1 : 0, `${scenario.name}: ${calls.join('\n')}`);
        }
        if (scenario.systemdRun === 1)
            assert.match(start.stderr, /starting tmux unscoped/);
        // The managed window joins the running server and never gets a scope.
        assert.ok(calls.some(line => /^tmux -N new-session -d -s pi-dish -n server /.test(line)), scenario.name);
    }
});
test('start scopes the replacement tmux server when stop_service kills the last session', async (t) => {
    const root = fixtureRoot(t);
    const bin = path.join(root, 'bin');
    const log = path.join(root, 'tmux-env.log');
    const stateFile = path.join(root, 'tmux-alive');
    fs.writeFileSync(stateFile, '1');
    await fakeUserManager(t, root);
    fs.writeFileSync(path.join(bin, 'systemd-run'), systemdRunStub(null), { mode: 0o755 });
    // Simulate a server whose only window is pi-dish:server: kill-window shuts the server down.
    fs.writeFileSync(path.join(bin, 'tmux'), [
        '#!/bin/sh',
        'printf "tmux %s\\n" "$*" >> "$TMUX_LOG"',
        'case "$1" in',
        `  list-sessions|has-session) [ -f "${stateFile}" ] ;;`,
        `  kill-window) rm -f "${stateFile}" ;;`,
        `  new-session) : > "${stateFile}" ;;`,
        'esac',
    ].join('\n'), { mode: 0o755 });
    // First health probe fails (triggering recovery), later wait_until_healthy probes succeed.
    const probeFile = path.join(root, 'curl-probed');
    fs.writeFileSync(path.join(bin, 'curl'), [
        '#!/bin/sh',
        `if [ ! -f "${probeFile}" ]; then : > "${probeFile}"; exit 22; fi`,
        'exit 0',
    ].join('\n'), { mode: 0o755 });
    const start = (0, node_child_process_1.spawnSync)(path.join(root, 'scripts', 'pi-dish-tmux.sh'), ['start'], {
        cwd: root,
        env: { ...fixtureEnv(root, 3333), PI_DISH_TMUX_STARTUP_DELAY: '0' },
        encoding: 'utf8',
        timeout: 20000,
    });
    assert.equal(start.status, 0, start.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    const scopeCalls = calls.filter(line => line.startsWith('systemd-run '));
    assert.equal(scopeCalls.length, 1, calls.join('\n'));
    assert.match(scopeCalls[0], /^systemd-run --user --scope --quiet --collect --unit=pi-dish-tmux-default-\d+-\d+\.scope -- tmux new-session -d -s pi-dish -n server /);
});
test('tmux server scope argv needs a user manager, systemd-run and no opt-out', async (t) => {
    const { tmuxServerScopeArgv } = tmux;
    const root = fixtureRoot(t);
    const bin = path.join(root, 'bin');
    fs.writeFileSync(path.join(bin, 'systemd-run'), systemdRunStub(null), { mode: 0o755 });
    const env = { XDG_RUNTIME_DIR: root, PATH: bin };
    assert.equal(tmuxServerScopeArgv('/tmp/tmux-1/pi-dish', env), null, 'no manager socket');
    await fakeUserManager(t, root);
    const argv = tmuxServerScopeArgv('/tmp/tmux-1/pi-dish', env);
    assert.ok(argv);
    assert.deepEqual(argv.slice(0, 5), [path.join(bin, 'systemd-run'), '--user', '--scope', '--quiet', '--collect']);
    assert.match(argv[5], new RegExp(`^--unit=pi-dish-tmux-pi-dish-${process.pid}-[0-9a-z]+\\.scope$`));
    assert.deepEqual(argv.slice(6), ['--', 'tmux']);
    assert.match(tmuxServerScopeArgv('/tmp/tmux-1/odd name.$x', env)?.[5] ?? '', /^--unit=pi-dish-tmux-odd_name_x-/);
    assert.equal(tmuxServerScopeArgv('/tmp/tmux-1/pi-dish', { ...env, PI_DISH_TMUX_SCOPE: '0' }), null, 'opt-out');
    assert.equal(tmuxServerScopeArgv('/tmp/tmux-1/pi-dish', { ...env, PATH: path.join(root, 'scripts') }), null, 'no systemd-run');
});
const tmuxOk = (0, node_child_process_1.spawnSync)('tmux', ['-V']).status === 0;
test('spawnInTmux starts an absent server in its own scope and joins a running one directly', { skip: !tmuxOk }, async (t) => {
    const root = fixtureRoot(t);
    // Only systemd-run is stubbed: the real tmux runs on sockets under the temp
    // root. The fixture's stub tmux stays first on PATH for the root's `stop`.
    const bin = path.join(root, 'scope-bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'systemd-run'), systemdRunStub(null), { mode: 0o755 });
    const log = path.join(root, 'tmux-env.log');
    await fakeUserManager(t, root);
    const saved = { PATH: process.env.PATH, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, TMUX_LOG: process.env.TMUX_LOG, PI_DISH_TMUX_SCOPE: process.env.PI_DISH_TMUX_SCOPE };
    Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: root, TMUX_LOG: log });
    delete process.env.PI_DISH_TMUX_SCOPE;
    // Outside the fixture root, whose own cleanup may remove it first.
    const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-scope-'));
    const sockets = [];
    t.after(() => {
        for (const socket of sockets)
            (0, node_child_process_1.spawnSync)('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
        fs.rmSync(socketDir, { recursive: true, force: true });
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined)
                delete process.env[key];
            else
                process.env[key] = value;
        }
    });
    const spawnSession = (socket, name) => tmux.spawnInTmux({
        socket, newTmuxSessionName: name, command: ['sleep', '60'],
    });
    const scopeCalls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    const scoped = path.join(socketDir, 'scoped');
    sockets.push(scoped);
    assert.match((await spawnSession(scoped, 'first')).paneId, /^%\d+$/);
    assert.equal(scopeCalls().length, 1);
    assert.match(scopeCalls()[0], /--unit=pi-dish-tmux-scoped-\d+-[0-9a-z]+\.scope -- tmux -S \S+\/scoped new-session -d -s first /);
    assert.match((await spawnSession(scoped, 'second')).paneId, /^%\d+$/);
    assert.equal(scopeCalls().length, 1, 'a running server is joined without a scope');
    // systemd-run refusing the scope never runs tmux; the server starts unscoped.
    fs.writeFileSync(path.join(bin, 'systemd-run'), systemdRunStub(1), { mode: 0o755 });
    const refused = path.join(socketDir, 'refused');
    sockets.push(refused);
    assert.match((await spawnSession(refused, 'only')).paneId, /^%\d+$/);
    assert.equal(scopeCalls().length, 2);
    assert.equal((0, node_child_process_1.spawnSync)('tmux', ['-S', refused, 'has-session', '-t', '=only']).status, 0);
});
