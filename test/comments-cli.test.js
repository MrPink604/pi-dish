// Generated test/tool from test/comments-cli.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const node_events_1 = require("node:events");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const { encodeSessionKey } = require('../lib/session-key');
const test_types_js_1 = require("./test-types.js");
const run = (0, node_util_1.promisify)(node_child_process_1.execFile);
const cli = path.join(__dirname, '..', 'skills', 'pi-dish-comments', 'scripts', 'pi-dish-comments.js');
test('comments CLI discovers its ancestor pi session, pages, and acknowledges', async (t) => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-comments-cli-'));
    t.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));
    const registry = path.join(tmpHome, '.pi', 'dish', 'sessions');
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, 'session-1.json'), JSON.stringify({
        sessionId: 'session-1', pid: process.pid, cwd: process.cwd(), updatedAt: new Date().toISOString(),
    }));
    const openComment = {
        id: 'comment-1', sessionId: 'session-1', body: 'Tighten this sentence.', createdAt: Date.now(),
        target: {
            kind: 'file', path: '/work/README.md', relPath: 'README.md',
            anchor: { type: 'text', quote: 'A vague sentence', startLine: 4, endLine: 4 },
        },
    };
    let ackBody = null;
    let getBody = null;
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && req.url?.startsWith('/api/comments/index?')) {
            res.end(JSON.stringify({
                comments: [{
                        id: openComment.id, createdAt: openComment.createdAt,
                        bodyPreview: openComment.body,
                        target: { ...openComment.target, anchor: { type: 'text', startLine: 4, endLine: 4, quotePreview: 'A vague sentence' } },
                    }],
                total: 1,
            }));
            return;
        }
        if (req.method === 'GET' && req.url?.startsWith('/api/comments/count?')) {
            res.end(JSON.stringify({ total: 1 }));
            return;
        }
        if (req.method === 'POST' && req.url === '/api/comments/get') {
            let raw = '';
            req.on('data', (chunk) => { raw += chunk; });
            req.on('end', () => {
                getBody = JSON.parse(raw);
                res.end(JSON.stringify({ comments: [openComment], missing: [], total: 1, hasMore: false }));
            });
            return;
        }
        if (req.method === 'POST' && req.url === '/api/comments/comment-1/ack') {
            let raw = '';
            req.on('data', (chunk) => { raw += chunk; });
            req.on('end', () => {
                ackBody = JSON.parse(raw);
                res.end(JSON.stringify({ ...openComment, acknowledgedAt: Date.now() }));
            });
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
    });
    server.listen(0, '127.0.0.1');
    await (0, node_events_1.once)(server, 'listening');
    t.after(() => server.close());
    const address = server.address();
    if (address === null || typeof address === 'string')
        throw new Error('Expected comments fixture TCP address');
    const base = `http://127.0.0.1:${address.port}`;
    const env = { ...process.env, HOME: tmpHome, PI_DISH_URL: base };
    const session = await run(process.execPath, [cli, 'session'], { env });
    assert.equal(session.stdout.trim(), 'session-1');
    const index = await run(process.execPath, [cli, 'list', '--json'], { env });
    const parsedIndex = (0, test_types_js_1.record)(JSON.parse(index.stdout));
    const comments = (0, test_types_js_1.records)(parsedIndex.comments);
    const indexed = (0, test_types_js_1.record)(comments[0]);
    const target = (0, test_types_js_1.record)(indexed.target);
    const anchor = (0, test_types_js_1.record)(target.anchor);
    assert.equal(anchor.quotePreview, 'A vague sentence');
    const humanIndex = await run(process.execPath, [cli, 'list'], { env });
    assert.match(humanIndex.stdout, /\[comment-1\] file: README\.md:4 — Tighten this sentence\./);
    assert.match(humanIndex.stdout, /1 open comments indexed/);
    const selected = await run(process.execPath, [cli, 'get', 'comment-1', '--json'], { env });
    const selectedBody = (0, test_types_js_1.record)(JSON.parse(selected.stdout));
    const selectedComments = (0, test_types_js_1.records)(selectedBody.comments);
    assert.equal((0, test_types_js_1.record)(selectedComments[0]).body, 'Tighten this sentence.');
    assert.deepEqual(getBody, { sessionId: 'session-1', ids: ['comment-1'] });
    const count = await run(process.execPath, [cli, 'count'], { env });
    assert.equal(count.stdout.trim(), '1');
    const ack = await run(process.execPath, [cli, 'ack', 'comment-1'], { env });
    assert.match(ack.stdout, /Acknowledged comment-1/);
    assert.deepEqual(ackBody, { sessionId: 'session-1' });
});
test('comments CLI reports the canonical route for an alternative registry entry', async (t) => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-comments-alt-'));
    t.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));
    const registry = path.join(tmpHome, '.pi', 'dish', 'sessions');
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, 'omp-worker.json'), JSON.stringify({
        protocolVersion: 2,
        wrapper: { harnessId: 'omp' },
        harnessId: 'omp',
        nativeSessionId: 'omp-native',
        sessionId: 'omp-native',
        pid: process.pid,
        cwd: process.cwd(),
        updatedAt: new Date().toISOString(),
    }));
    const env = { ...process.env, HOME: tmpHome };
    delete env.PI_DISH_SESSION_ID;
    const session = await run(process.execPath, [cli, 'session'], { env });
    assert.equal(session.stdout.trim(), encodeSessionKey('omp', (0, test_types_js_1.nativeId)('omp-native')));
});
