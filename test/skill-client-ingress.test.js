// Generated test/tool from test/skill-client-ingress.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const test_types_js_1 = require("./test-types.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const run = (0, node_util_1.promisify)(node_child_process_1.execFile);
const cli = path.join(__dirname, '../skills/pi-dish-sessions/scripts/pi-dish-sessions.js');
const client = path.join(__dirname, '../skills/lib/pi-dish-client.js');
const cwdDriver = path.join(__dirname, 'fixtures', 'skill-client-cwd-driver.js');
function fixture(t, entry) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-skill-ingress-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const registry = path.join(home, '.pi', 'dish', 'sessions');
    fs.mkdirSync(registry, { recursive: true });
    if (entry)
        fs.writeFileSync(path.join(registry, 'entry.json'), JSON.stringify(entry));
    const env = {
        ...process.env, HOME: home, PI_DISH_SESSION_ID: '', PI_DISH_TOKEN: '', PI_DISH_URL: '', TMUX: '', TMUX_PANE: '',
    };
    return { home, env };
}
async function serve(t, respond) {
    const server = http.createServer(respond);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Test server lacks TCP address');
    return `http://127.0.0.1:${address.port}`;
}
test('ancestor discovery retains truthy identities despite unused malformed metadata', async (t) => {
    const { env } = fixture(t, {
        sessionId: 42, pid: process.pid, name: { unexpected: true }, model: 17, cwd: 23,
    });
    const { stdout } = await run(process.execPath, [cli, 'session', '--json'], { env });
    assert.equal(JSON.parse(stdout), 42);
});
test('cwd discovery still exposes the native path error when malformed cwd is consumed', async (t) => {
    const { env } = fixture(t, { sessionId: 'cwd-only', cwd: 23 });
    const { stdout } = await run(process.execPath, [cwdDriver, client], { env });
    assert.deepEqual(JSON.parse(stdout), { name: 'TypeError', code: 'ERR_INVALID_ARG_TYPE' });
});
test('attach JSON retains metadata that only interactive name matching needs to interpret', async (t) => {
    const { home, env } = fixture(t);
    const entry = {
        sessionId: 'attach-entry', pid: process.pid, name: 17, model: { id: 'opaque-model' }, cwd: home,
        tmux: { socket: path.join(home, 'absent-tmux.sock'), pane: '%1' },
    };
    fs.writeFileSync(path.join(home, '.pi', 'dish', 'sessions', 'entry.json'), JSON.stringify(entry));
    const { stdout } = await run(process.execPath, [cli, 'attach', '--json'], { env });
    const attached = (0, test_types_js_1.present)((0, test_types_js_1.records)(JSON.parse(stdout))[0]);
    assert.equal(attached.sessionId, 'attach-entry');
    assert.equal(attached.name, 17);
    assert.deepEqual(attached.model, { id: 'opaque-model' });
});
test('fleet name resolution retains malformed labels but label matching still fails on them', async (t) => {
    const { env } = fixture(t);
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/hosts') {
            res.end(JSON.stringify({ hosts: [{
                        name: 'peer', label: 17, hostId: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', reachable: true,
                        capabilities: { resolve: true, refAliases: true },
                    }] }));
            return;
        }
        if (req.url === '/hosts/peer/api/sessions/resolve?id=peer-session') {
            res.end(JSON.stringify({ session: { id: 'peer-session', name: 'Peer' } }));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Session not found' }));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Test server lacks TCP address');
    const base = `http://127.0.0.1:${address.port}`;
    const { stdout } = await run(process.execPath, [cli, 'resolve', 'peer/peer-session', '--url', base, '--json'], { env });
    const resolved = (0, test_types_js_1.record)(JSON.parse(stdout));
    assert.equal(resolved.host, 'peer');
    assert.equal(resolved.id, 'peer-session');
    await assert.rejects(run(process.execPath, [cli, 'resolve', 'unknown/peer-session', '--url', base], { env }), (error) => (0, test_types_js_1.record)(error).code === 1 && /toLowerCase is not a function/.test((0, test_types_js_1.errorMessage)(error)));
});
test('pages preserves raw null JSON and absent hub mappings without false human success', async (t) => {
    const { home, env } = fixture(t);
    env.PI_DISH_PUBLIC_VIA = '';
    const pageCli = path.join(__dirname, '../skills/pi-dish-pages/scripts/pi-dish-pages.js');
    const file = path.join(home, 'page.html');
    fs.writeFileSync(file, '<p>page</p>');
    let page = null;
    const base = await serve(t, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(req.url === '/api/host' ? { hostId: 'owner' } : req.url === '/api/pages' ? page : null));
    });
    const args = [pageCli, 'publish', file, '--session', 'caller', '--url', base];
    await assert.rejects(run(process.execPath, args, { env }), (error) => {
        const detail = (0, test_types_js_1.record)(error);
        assert.equal(detail.code, 1);
        assert.equal(detail.stdout, '');
        assert.match((0, test_types_js_1.errorMessage)(error), /TypeError/);
        return true;
    });
    const json = await run(process.execPath, [...args, '--json'], { env });
    assert.deepEqual(JSON.parse(json.stdout), { hub: null, hubError: null });
    page = { token: 'published', url: 'https://example.invalid/published' };
    const via = await run(process.execPath, [...args, '--via', 'hub'], { env });
    assert.equal(via.stdout, 'https://example.invalid/published\n');
    const viaJson = await run(process.execPath, [...args, '--via', 'hub', '--json'], { env });
    assert.deepEqual(JSON.parse(viaJson.stdout), { ...page, hub: null, hubError: null });
});
test('CLI field consumers reject missing response bodies while raw JSON remains readable', async (t) => {
    const { env } = fixture(t);
    const commentsCli = path.join(__dirname, '../skills/pi-dish-comments/scripts/pi-dish-comments.js');
    const base = await serve(t, (req, res) => {
        if (req.url?.startsWith('/api/comments/count'))
            return res.end();
        if (req.url === '/api/comments/get')
            return res.end('not JSON');
        if (req.url === '/api/hosts') {
            res.statusCode = 204;
            return res.end();
        }
        res.setHeader('Content-Type', 'application/json');
        res.end('null');
    });
    const cases = [
        [commentsCli, ['count']], [commentsCli, ['get', 'comment']],
        [cli, ['hosts']], [cli, ['list']],
    ];
    for (const [script, command] of cases) {
        const args = [script, ...command, '--session', 'caller', '--url', base];
        await assert.rejects(run(process.execPath, args, { env }), (error) => {
            const detail = (0, test_types_js_1.record)(error);
            assert.equal(detail.code, 1);
            assert.equal(detail.stdout, '');
            return true;
        });
        const json = await run(process.execPath, [...args, '--json'], { env });
        assert.equal(JSON.parse(json.stdout), null);
    }
    for (const format of [[], ['--json']]) {
        await assert.rejects(run(process.execPath, [cli, 'search', 'needle', '--url', base, ...format], { env }), (error) => (0, test_types_js_1.record)(error).code === 1 && (0, test_types_js_1.record)(error).stdout === '');
    }
});
test('spawn keeps advisory null fallbacks and waits through a bodyless 202', async (t) => {
    const { env } = fixture(t);
    let starting = true;
    let noWait = false;
    const base = await serve(t, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/hosts/peer/api/sessions/new') {
            return res.end(JSON.stringify(noWait ? null : { spawnId: 'pending' }));
        }
        if (req.url === '/hosts/peer/api/session-spawns/pending') {
            if (starting) {
                starting = false;
                res.statusCode = 202;
                return res.end();
            }
            return res.end(JSON.stringify({ status: 'ready', sessionId: 'child' }));
        }
        res.end('null');
    });
    const args = [cli, 'spawn', '--host', 'peer', '--harness', 'pi', '--session', 'caller', '--url', base, '--json'];
    const completed = await run(process.execPath, args, { env });
    assert.deepEqual(JSON.parse(completed.stdout), {
        status: 'ready', sessionId: 'child', spawnId: 'pending', harness: 'pi', host: 'peer',
    });
    noWait = true;
    const immediate = await run(process.execPath, [...args, '--no-wait'], { env });
    assert.deepEqual(JSON.parse(immediate.stdout), { harness: 'pi' });
});
test('message views retain catalog metadata when optional response fields are absent', async (t) => {
    const { env } = fixture(t);
    const session = { id: 'message-session', name: 'Catalog name', cwd: '/catalog' };
    let body = 'null';
    const base = await serve(t, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/hosts')
            return res.end(JSON.stringify({ hosts: [{ self: true, capabilities: { resolve: true } }] }));
        if (req.url?.startsWith('/api/sessions/resolve?'))
            return res.end(JSON.stringify({ session }));
        if (req.url?.startsWith('/api/sessions/message-session/messages?'))
            return res.end(body);
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Unexpected route' }));
    });
    const args = [session.id, '--url', base];
    const shown = await run(process.execPath, [cli, 'show', ...args], { env });
    assert.deepEqual(JSON.parse(shown.stdout), { session });
    body = 'not JSON';
    const nonJson = await run(process.execPath, [cli, 'show', ...args], { env });
    assert.deepEqual(JSON.parse(nonJson.stdout), { session });
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Preserved transcript content' }] }];
    body = JSON.stringify({ messages });
    const absent = await run(process.execPath, [cli, 'read', ...args], { env });
    assert.match(absent.stdout, /Catalog name/);
    assert.match(absent.stdout, /Preserved transcript content/);
    body = JSON.stringify({ messages, session: null });
    const nullSession = await run(process.execPath, [cli, 'read', ...args], { env });
    assert.equal(nullSession.stdout, absent.stdout);
    body = JSON.stringify({ messages, session: { name: 'Message name' } });
    const richer = await run(process.execPath, [cli, 'read', ...args], { env });
    assert.match(richer.stdout, /Message name/);
    assert.doesNotMatch(richer.stdout, /Catalog name/);
    assert.match(richer.stdout, /\/catalog/);
    assert.match(richer.stdout, /Preserved transcript content/);
});
test('legacy-host CLI fallback preserves staged precedence, ambiguity and provenance exact-only', async (t) => {
    const { env } = fixture(t);
    const hostId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const encoded = (native) => '~sk1_' + Buffer.from(JSON.stringify(['omp', native])).toString('base64url');
    const active = [
        { id: 'route-hit', name: 'Exact route' }, { id: encoded('route-hit'), name: 'Shadowed alias' },
        { id: encoded('alias-hit'), name: 'Exact alias' }, { id: 'alias-hit-long', name: 'Shadowed route prefix' },
        { id: 'prefix-hit-long', name: 'Route prefix' }, { id: encoded('prefix-hit-other'), name: 'Shadowed alias prefix' },
        { id: 'twin-a' }, { id: 'twin-b' },
    ];
    const base = await serve(t, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/hosts')
            return res.end(JSON.stringify({ hosts: [{ self: true, hostId, capabilities: {} }] }));
        if (req.url === '/api/sessions')
            return res.end(JSON.stringify({ active, previous: [{ id: 'route-hit', name: 'Old duplicate' }] }));
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Unexpected route' }));
    });
    const resolve = (ref) => run(process.execPath, [cli, 'resolve', ref, '--url', base, '--json'], { env });
    const references = [
        ['route-hit', 'route-hit', 'Exact route'],
        ['alias-hit', encoded('alias-hit'), 'Exact alias'],
        ['prefix-hit', 'prefix-hit-long', 'Route prefix'],
        [`${hostId}:alias-hit`, encoded('alias-hit'), 'Exact alias'],
    ];
    for (const [ref, id, name] of references) {
        const resolved = (0, test_types_js_1.record)(JSON.parse((await resolve(ref)).stdout));
        assert.equal(resolved.id, id);
        assert.equal((0, test_types_js_1.record)(resolved.session).name, name);
    }
    await assert.rejects(resolve('twin-'), (error) => (0, test_types_js_1.record)(error).code === 1
        && /ambiguous/.test((0, test_types_js_1.errorMessage)(error)) && /twin-a/.test((0, test_types_js_1.errorMessage)(error)) && /twin-b/.test((0, test_types_js_1.errorMessage)(error)));
    await assert.rejects(resolve(`${hostId}:prefix-hit`), (error) => (0, test_types_js_1.record)(error).code === 1 && /Session not found/.test((0, test_types_js_1.errorMessage)(error)));
});
