// Generated test/tool from test/session-control-cli.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const test_types_js_1 = require("./test-types.js");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const node_util_1 = require("node:util");
const node_child_process_1 = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const { encodeSessionKey } = require('../lib/session-key');
const listenServer = (server) => new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string')
            return reject(new Error('Mock server lacks TCP address'));
        resolve(`http://127.0.0.1:${address.port}`);
    });
});
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const cli = path.join(__dirname, '..', 'skills', 'pi-dish-sessions', 'scripts', 'pi-dish-sessions.js');
function mockServer() {
    const requests = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            let body = null;
            try {
                body = (0, test_types_js_1.record)(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
            }
            catch { }
            requests.push({ method: req.method, url: req.url, body, source: req.headers['x-pi-dish-session-id'] });
            res.setHeader('Content-Type', 'application/json');
            if (req.method === 'POST' && req.url === '/api/sessions/new') {
                res.statusCode = 202;
                res.end(JSON.stringify({ pending: true, spawnId: 'spawn-1' }));
                return;
            }
            if (req.method === 'GET' && req.url === '/api/session-spawns/spawn-1') {
                res.end(JSON.stringify({ status: 'ready', sessionId: 'peer-1' }));
                return;
            }
            if (req.method === 'GET' && req.url === '/api/harnesses') {
                res.end(JSON.stringify({ harnesses: [
                        { id: 'pi', label: 'Pi', available: true },
                        { id: 'omp', label: 'Oh My Pi', available: true },
                        { id: 'prime', label: 'Prime', available: false },
                    ] }));
                return;
            }
            if (req.method === 'GET' && (req.url === '/api/sessions' || req.url === '/api/sessions?active=1')) {
                res.end(JSON.stringify({ active: [{ id: 'peer-1', isActive: true, name: 'Peer', cwd: '/work' }], previous: [] }));
                return;
            }
            if (req.method === 'GET' && req.url === '/api/sessions/peer-1/related') {
                res.end(JSON.stringify({ relations: [{ kind: 'startedFrom', source: 'pi-dish-launch', session: { id: 'source-1', name: 'Source' } }] }));
                return;
            }
            if (req.method === 'GET' && req.url === '/api/sessions/peer-1/messages?limit=5') {
                res.end(JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }] }));
                return;
            }
            const url = req.url ?? '';
            if (req.method === 'POST' && /^\/api\/sessions\/peer-1\/(rename|prompt|steer|follow-up|abort|resume|close)$/.test(url)) {
                res.end(JSON.stringify({ success: true }));
                return;
            }
            if (req.method === 'GET' && url.startsWith('/api/search?')) {
                res.end(JSON.stringify({
                    results: [
                        { id: 'hit-1', isActive: false, name: 'Torn tail fix', cwd: '/work/api',
                            lastActivity: '2026-08-01T10:00:00.000Z', matchCount: 3,
                            snippets: ['skip the torn tail\non load', 'reindex after the torn tail'] },
                        { id: 'hit-2', isActive: true, name: 'Follow-up', cwd: '/work/api',
                            lastActivity: '2026-08-10T09:00:00.000Z', matchCount: 0, snippets: [] },
                    ],
                    total: 25, indexing: true,
                }));
                return;
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'not found' }));
        });
    });
    return { server, requests };
}
async function run(args, base) {
    return execFileAsync(process.execPath, [cli, ...args, '--url', base], {
        env: { ...process.env, PI_DISH_SESSION_ID: 'source-1' },
    });
}
test('peer-session CLI attributes spawn and uses semantic control routes', async (t) => {
    const { server, requests } = mockServer();
    const base = await listenServer(server);
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const spawned = await run(['spawn', '--cwd', '/work', '--name', 'Peer', '--prompt', 'Investigate', '--json'], base);
    assert.equal((0, test_types_js_1.record)(JSON.parse(spawned.stdout)).sessionId, 'peer-1');
    const create = (0, test_types_js_1.present)(requests.find(request => request.url === '/api/sessions/new')), createBody = (0, test_types_js_1.present)(create.body);
    assert.equal(createBody.requestedBySessionId, 'source-1');
    assert.equal(createBody.cwd, '/work');
    assert.equal(createBody.harness, 'pi', 'a bare Pi caller id inherits the Pi harness');
    assert.equal(create.source, 'source-1');
    assert.ok(requests.some(request => request.url === '/api/sessions/peer-1/rename'));
    assert.ok(requests.some(request => request.url === '/api/sessions/peer-1/prompt' && request.body?.message === 'Investigate'));
    const controls = [['send', 'prompt'], ['steer', 'steer'], ['follow-up', 'follow-up']];
    for (const [command, route] of controls) {
        await run([command, 'peer-1', 'Then', 'summarize'], base);
        assert.ok(requests.some(request => request.url === `/api/sessions/peer-1/${route}` && request.body?.message === 'Then summarize'));
    }
    for (const command of ['interrupt', 'resume', 'close'])
        await run([command, 'peer-1'], base);
    assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/abort'));
    assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/resume'));
    assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/close'));
    const related = await run(['related', 'peer-1'], base);
    assert.match(related.stdout, /startedFrom\s+source-1\s+Source/);
    const shown = await run(['show', 'peer-1', '--limit', '5'], base);
    const shownBody = (0, test_types_js_1.record)(JSON.parse(shown.stdout)), shownMessages = (0, test_types_js_1.records)(shownBody.messages);
    assert.equal((0, test_types_js_1.record)((0, test_types_js_1.present)((0, test_types_js_1.records)((0, test_types_js_1.present)(shownMessages[0]).content)[0])).text, 'done');
    const listed = await run(['list', '--active'], base);
    assert.match(listed.stdout, /peer-1\s+active\s+Peer/);
    const searched = await run(['search', 'torn', 'tail', 'cwd:/work/api'], base);
    const searchReq = (0, test_types_js_1.present)(requests.find(request => request.url?.startsWith('/api/search?')));
    assert.equal(new URL((0, test_types_js_1.present)(searchReq.url), base).searchParams.get('q'), 'torn tail cwd:/work/api', 'positional terms join into one grammar query');
    assert.match(searched.stdout, /hit-1\tinactive\tTorn tail fix\t\/work\/api\t2026-08-01\t3 matches/);
    assert.match(searched.stdout, /…skip the torn tail on load…/, 'snippets are shown with whitespace flattened');
    assert.match(searched.stdout, /hit-2\tactive\t.*metadata match/);
    assert.match(searched.stdout, /# 23 more results not shown/);
    assert.match(searched.stdout, /index is still building/);
    const searchedJson = await run(['search', 'torn', '--limit', '1', '--json'], base);
    const parsed = (0, test_types_js_1.record)(JSON.parse(searchedJson.stdout)), results = (0, test_types_js_1.records)(parsed.results);
    assert.equal(results.length, 1, '--limit slices JSON results too');
    assert.equal((0, test_types_js_1.present)(results[0]).id, 'hit-1');
    assert.equal(parsed.total, 25);
});
// A peer spawned from an OMP session must be an OMP session: the harness comes
// from the caller's own identity, never the HTTP route's Pi default.
test('peer-session CLI spawns the caller\'s own harness and honours --harness', async (t) => {
    const { server, requests } = mockServer();
    const base = await listenServer(server);
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const ompCaller = encodeSessionKey('omp', (0, test_types_js_1.nativeId)('omp-native'));
    const asOmp = (args) => execFileAsync(process.execPath, [cli, ...args, '--url', base], {
        env: { ...process.env, PI_DISH_SESSION_ID: ompCaller },
    });
    const spawned = await asOmp(['spawn', '--cwd', '/work', '--json']);
    assert.equal((0, test_types_js_1.record)(JSON.parse(spawned.stdout)).harness, 'omp', 'the spawn result names the harness launched');
    const creates = () => requests.filter(request => request.url === '/api/sessions/new');
    assert.equal((0, test_types_js_1.present)((0, test_types_js_1.present)(creates().at(-1)).body).harness, 'omp');
    await asOmp(['spawn', '--harness', 'pi', '--json']);
    assert.equal((0, test_types_js_1.present)((0, test_types_js_1.present)(creates().at(-1)).body).harness, 'pi', '--harness crosses harnesses deliberately');
    await assert.rejects(() => asOmp(['spawn', '--harness', 'prime']), (error) => {
        assert.match(String((0, test_types_js_1.record)(error).stderr ?? ''), /harness "prime" is not installed.*available: pi, omp/);
        return true;
    }, 'a harness the host lacks fails before launching');
    await assert.rejects(() => asOmp(['spawn', '--harness', 'nope']), (error) => {
        assert.match(String((0, test_types_js_1.record)(error).stderr ?? ''), /unknown harness "nope" \(available: pi, omp\)/);
        return true;
    });
    assert.equal(requests.filter(r => r.url === '/api/sessions/new').length, 2, 'rejected harnesses never reach the spawn route');
});
test('peer-session CLI reports the canonical route for an alternative registry entry', async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-session-cli-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const registry = path.join(home, '.pi', 'dish', 'sessions');
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, 'prime-worker.json'), JSON.stringify({
        protocolVersion: 2,
        wrapper: { harnessId: 'prime' },
        harnessId: 'prime',
        nativeSessionId: 'prime-native',
        sessionId: 'prime-native',
        pid: process.pid,
        cwd: process.cwd(),
        updatedAt: new Date().toISOString(),
    }));
    const env = { ...process.env, HOME: home };
    delete env.PI_DISH_SESSION_ID;
    const result = await execFileAsync(process.execPath, [cli, 'session'], { env });
    assert.equal(result.stdout.trim(), encodeSessionKey('prime', (0, test_types_js_1.nativeId)('prime-native')));
});
test('peer-session CLI attach command lists active tmux entries with --json', async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-session-attach-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const registry = path.join(home, '.pi', 'dish', 'sessions');
    const sockets = path.join(home, '.pi', 'dish', 'sockets');
    fs.mkdirSync(registry, { recursive: true });
    fs.mkdirSync(sockets, { recursive: true });
    const sockPath = path.join(sockets, 'test.sock');
    fs.writeFileSync(sockPath, '');
    fs.writeFileSync(path.join(registry, 'pi-test.json'), JSON.stringify({
        sessionId: 'session-xyz',
        pid: process.pid,
        name: 'refactor-auth',
        cwd: '/work/app',
        model: 'anthropic/claude-3-5-sonnet',
        socketPath: sockPath,
        tmux: { socket: '/tmp/tmux-test', pane: '%42' },
        updatedAt: new Date().toISOString(),
    }));
    const env = { ...process.env, HOME: home };
    const res = await execFileAsync(process.execPath, [cli, 'attach', '--json'], { env });
    const entries = (0, test_types_js_1.records)(JSON.parse(res.stdout));
    assert.equal(entries.length, 1);
    assert.equal((0, test_types_js_1.present)(entries[0]).name, 'refactor-auth');
    assert.equal((0, test_types_js_1.present)(entries[0]).socket, '/tmp/tmux-test');
    assert.equal((0, test_types_js_1.present)(entries[0]).pane, '%42');
});
// =========================================================================
// Short refs for encoded route ids
//
// An OMP route id is ~100 base64 characters whose leading ~30 are shared by
// every OMP session on the host: printing it invites an agent to retype it,
// and a mistyped key still decodes, so the server can only answer "not
// found". The CLI therefore prints the shortest handle the *owning* host can
// resolve, and a host too old to resolve aliases is handled client-side.
// =========================================================================
const ALIAS_NATIVE = '2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0';
const ALIAS_ROUTE = encodeSessionKey('omp', (0, test_types_js_1.nativeId)(ALIAS_NATIVE));
function aliasServer({ refAliases }) {
    const requests = [];
    const session = { id: ALIAS_ROUTE, isActive: true, name: 'Orchestrator', cwd: '/work/osbg' };
    const capabilities = { sessions: true, search: true, resolve: true, docs: true };
    if (refAliases)
        capabilities.refAliases = true;
    const server = http.createServer((req, res) => {
        const requestUrl = req.url ?? '';
        requests.push(requestUrl);
        res.setHeader('Content-Type', 'application/json');
        if (requestUrl === '/api/hosts') {
            res.end(JSON.stringify({ hosts: [{ self: true, name: null, label: 'framework', reachable: true, capabilities }] }));
            return;
        }
        if (requestUrl === '/api/sessions' || requestUrl === '/api/sessions?active=1') {
            res.end(JSON.stringify({ active: [session], previous: [] }));
            return;
        }
        if (requestUrl.startsWith('/api/sessions/resolve?')) {
            const ref = new URL(requestUrl, 'http://x').searchParams.get('id') ?? '';
            // The legacy shape: route-id prefixes only, and no `ref` in the reply.
            const hit = refAliases
                ? [ALIAS_ROUTE, ALIAS_NATIVE, '01a070d2-43fb-7360-aaba-a4ddf8d1deb0'].some(a => a.startsWith(ref))
                : ALIAS_ROUTE.startsWith(ref);
            if (!hit) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Session not found' }));
                return;
            }
            res.end(JSON.stringify(refAliases ? { session, ref: '01a070d2' } : { session }));
            return;
        }
        if (req.method === 'POST' && requestUrl === `/api/sessions/${encodeURIComponent(ALIAS_ROUTE)}/steer`) {
            res.end(JSON.stringify({ success: true }));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
    });
    return { server, requests };
}
async function withAliasServer(t, options) {
    const { server, requests } = aliasServer(options);
    const base = await listenServer(server);
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    return { base, requests };
}
test('peer-session CLI prints short refs and resolves them on a capable host', async (t) => {
    const { base, requests } = await withAliasServer(t, { refAliases: true });
    const listed = await run(['list', '--active'], base);
    assert.match(listed.stdout, /^01a070d2\tactive\tOrchestrator\t\/work\/osbg$/m, 'the row leads with a handle an agent can retype, not the encoded key');
    assert.ok(!listed.stdout.includes(ALIAS_ROUTE), 'the ~100-char route id is not what the CLI hands back');
    const resolved = await run(['resolve', '01a070d2'], base);
    assert.match(resolved.stdout, /^ref: 01a070d2$/m);
    assert.match(resolved.stdout, new RegExp(`^${ALIAS_ROUTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), 'the full route id is still shown — it is what the HTTP routes speak');
    // The short ref drives a real control call; the route still gets the full id.
    await run(['steer', '01a070d2', 'Use the new routing'], base);
    assert.ok(requests.includes(`/api/sessions/${encodeURIComponent(ALIAS_ROUTE)}/steer`));
});
test('peer-session CLI resolves a short ref client-side on a host without ref aliases', async (t) => {
    const { base, requests } = await withAliasServer(t, { refAliases: false });
    // The host's resolver 404s the uuid tail, so the CLI resolves it against
    // that host's own session list and carries on with the full route id.
    await run(['steer', '01a070d2', 'Use the new routing'], base);
    assert.ok(requests.includes(`/api/sessions/${encodeURIComponent(ALIAS_ROUTE)}/steer`), 'the control call reaches the session despite the older resolver');
    // Rows on such a host keep printing full ids: a short one would not resolve.
    const listed = await run(['list', '--active'], base);
    assert.match(listed.stdout, new RegExp(`^${ALIAS_ROUTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\tactive`, 'm'));
    // A genuinely unknown ref is still an error, not a retry loop.
    await assert.rejects(() => run(['resolve', 'ffffffff'], base), (error) => {
        assert.match(String((0, test_types_js_1.record)(error).stderr ?? ''), /Session not found/);
        return true;
    });
});
