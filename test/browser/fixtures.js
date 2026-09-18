// Generated test/tool from test/browser/fixtures.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHILD = exports.ROOT = exports.expect = exports.test = void 0;
exports.requiredRoute = requiredRoute;
const test_1 = require("@playwright/test");
Object.defineProperty(exports, "expect", { enumerable: true, get: function () { return test_1.expect; } });
const node_child_process_1 = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test_env_js_1 = require("../test-env.js");
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const browser_app_js_1 = require("../fixtures/browser-app.js");
const ROOT = '2026-09-09T00-00-00-shared-root';
exports.ROOT = ROOT;
const CHILD = '2026-09-09T00-01-00-shared-child';
exports.CHILD = CHILD;
function isStartedBrowserHost(host) {
    return !!host.child && Array.isArray(host.commands) && typeof host.emit === 'function'
        && typeof host.base === 'string' && typeof host.hostId === 'string';
}
function requiredRoute(route) {
    if (!route)
        throw new Error('Expected a held Playwright route');
    return route;
}
async function startHost(label, logs, hosts, origin, liveSessions) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-browser-'));
    const host = { home, label, token: `browser-fixture-${label}` };
    hosts.push(host); // Register before setup so partial failures also clean up.
    const dish = path.join(home, '.pi/dish');
    fs.mkdirSync(dish, { recursive: true });
    if (origin) {
        fs.writeFileSync(path.join(dish, 'token'), host.token);
        fs.writeFileSync(path.join(dish, 'settings.json'), JSON.stringify({ allowedOrigins: [origin] }));
    }
    const dir = path.join(home, '.pi/agent/sessions/project');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(home, 'tmux'));
    for (const id of [ROOT, CHILD]) {
        const header = { type: 'session', cwd: '/fixture/project', timestamp: '2026-09-09T00:00:00.000Z' };
        if (id === CHILD)
            header.parentSession = path.join(dir, `${ROOT}.jsonl`);
        fs.writeFileSync(path.join(dir, `${id}.jsonl`), [
            header,
            { type: 'message', message: { role: 'user', content: `${label} ${id === ROOT ? 'root' : 'child'} transcript` } },
        ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    }
    const child = (0, node_child_process_1.fork)(path.join(__dirname, '../fixtures/browser-server.js'), [], {
        env: { ...(0, test_env_js_1.sanitizeTestEnv)(), HOME: home, TMUX_TMPDIR: path.join(home, 'tmux'),
            PI_DISH_INDEX_SYNC_BUDGET: '1000',
            ...(liveSessions ? { PI_DISH_TEST_LIVE_SESSION: ROOT } : {}),
            PI_DISH_OMP_COMMAND: `${process.execPath} ${path.join(__dirname, '../fixtures/fake-omp-export.js')}` },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    host.child = child;
    for (const stream of [child.stdout, child.stderr]) {
        stream?.on('data', (data) => logs.push(`${label}: ${data}`));
    }
    const commands = [];
    host.commands = commands;
    child.on('message', (event) => {
        if (!(0, wire_protocol_js_1.isRecord)(event))
            throw new Error('Browser host sent an invalid event');
        if (event.type === 'command') {
            if (!(0, wire_protocol_js_1.isRecord)(event.message))
                throw new Error('Browser host sent an invalid command');
            commands.push(event.message);
        }
    });
    host.emit = (event, data, entry) => child.send({ event, data, entry });
    host.base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} startup timed out`)), 15000);
        const failed = (err) => { clearTimeout(timer); reject(err); };
        child.once('error', failed);
        child.once('exit', (code) => failed(new Error(`${label} exited (${code})`)));
        child.once('message', (message) => { if (!(0, wire_protocol_js_1.isRecord)(message) || typeof message.base !== 'string')
            return failed(new Error(`${label} returned an invalid base URL`)); clearTimeout(timer); resolve(message.base); });
    });
    const response = await fetch(`${host.base}/api/host`);
    if (!response.ok)
        throw new Error(`${label} descriptor: ${response.status}`);
    const descriptor = await response.json();
    if (!(0, wire_protocol_js_1.isRecord)(descriptor))
        throw new Error(`${label} descriptor is invalid`);
    if (typeof descriptor.hostId !== 'string')
        throw new Error(`${label} descriptor lacks hostId`);
    host.hostId = descriptor.hostId;
    if (!isStartedBrowserHost(host))
        throw new Error(`${label} fixture did not finish initialization`);
    return host;
}
async function stopHost(host) {
    const child = host.child;
    if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise(resolve => {
            const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
            child.kill('SIGTERM');
        });
    }
    fs.rmSync(host.home, { recursive: true, force: true });
}
const test = test_1.test.extend({
    liveSessions: [false, { option: true }],
    instrumentApp: [true, { option: true }],
    fleet: async ({ page, liveSessions, instrumentApp }, use, testInfo) => {
        const hosts = [], logs = [], errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        try {
            if (instrumentApp)
                await (0, browser_app_js_1.installFixtureApp)(page);
            const self = await startHost('self', logs, hosts, null, liveSessions);
            const peer = await startHost('peer', logs, hosts, self.base, liveSessions);
            await page.addInitScript(({ entry, instrumentApp }) => {
                // Tests that need registry/list facts replace the list snapshot through
                // its actual writer; mutation/transcript patches deliberately cannot.
                if (instrumentApp)
                    window.fixtureSessionListPatch = (id, fields, host = fixtureApp.features.sessionState.sessionHostId(id)) => {
                        const parts = new Map();
                        for (const kind of ['active', 'previous']) {
                            for (const row of fixtureApp.features.sessionState.sessions[kind]) {
                                const key = row.host || null;
                                if (!parts.has(key))
                                    parts.set(key, { hostId: key, active: [], previous: [] });
                                const part = fixtureElement(parts.get(key), 'browser host session partition');
                                part[kind].push(row.id === id && key === (host || null) ? { ...row, ...fields } : row);
                            }
                        }
                        fixtureApp.features.sessionState.setSessionLists([...parts.values()]);
                    };
                localStorage.setItem('pi-dish-hosts', JSON.stringify([entry]));
            }, { entry: { base: peer.base, hostId: peer.hostId, label: peer.label, token: peer.token }, instrumentApp });
            await page.goto(self.base);
            await page.locator('#tabAll').click();
            await (0, test_1.expect)(page.locator(`.session-item[data-id="${ROOT}"]`)).toHaveCount(2);
            const row = (host, id = ROOT) => page.locator(`.session-item[data-id="${id}"][data-host="${host.hostId}"]`);
            const select = async (host, id = ROOT) => {
                if (instrumentApp)
                    return page.evaluate(({ id, host }) => fixtureApp.features.sessionView.select(id, { host }), { id, host: host.hostId });
                await row(host, id).click();
                await (0, test_1.expect)(row(host, id)).toHaveClass(/\bactive\b/);
            };
            await use({ self, peer, select, row });
        }
        finally {
            await Promise.all(hosts.map(stopHost));
            if (testInfo.status !== testInfo.expectedStatus) {
                await testInfo.attach('server-output', { body: logs.join(''), contentType: 'text/plain' });
            }
        }
    },
});
exports.test = test;
