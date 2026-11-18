// Generated test/tool from test/sessions-cli-bounds.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Default output bounds of the pi-dish-sessions CLI against a real server, and
 * the opt-in `limit`/`fields` params of GET /api/sessions they sit beside.
 * Agents read these outputs into context, so each bounded command must stay
 * bounded by default, lift its bound on request, and say so only when it cut.
 */
const test = require("node:test");
const test_types_js_1 = require("./test-types.js");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const node_events_1 = require("node:events");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cli-bounds-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cli-bounds-tmux-'));
const CLI = path.join(__dirname, '..', 'skills', 'pi-dish-sessions', 'scripts', 'pi-dish-sessions.js');
const DEFAULT_MAX_CHARS = 12000;
const SHORT_COUNT = 60;
const LONG_ID = '2026-07-02T09-00-00-long0001';
const LONG_MESSAGES = 40;
const shortId = (i) => `2026-07-01T09-00-${String(i).padStart(2, '0')}-bnd${String(i).padStart(4, '0')}`;
const sessionDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-boundproj--');
fs.mkdirSync(sessionDir, { recursive: true });
function writeSession(id, timestamp, messages) {
    const entries = [
        { type: 'session', cwd: '/home/user/boundproj', timestamp },
        ...messages.map(({ role, text }) => ({ type: 'message', message: { role, content: [{ type: 'text', text }], timestamp } })),
    ];
    fs.writeFileSync(path.join(sessionDir, `${id}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
for (let i = 0; i < SHORT_COUNT; i++) {
    writeSession(shortId(i), `2026-07-01T09:00:${String(i).padStart(2, '0')}.000Z`, [
        { role: 'user', text: `quuxbound fixture ${i}` },
        { role: 'assistant', text: `quuxbound reply ${i}` },
    ]);
}
// Forty ~1 KB messages and a 5 KB newest one: well past the default cap.
writeSession(LONG_ID, '2026-07-02T09:00:00.000Z', Array.from({ length: LONG_MESSAGES }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    text: `msg-${String(i).padStart(2, '0')} ` + (i === LONG_MESSAGES - 1 ? 'z'.repeat(5000) : 'x'.repeat(1000)),
})));
const TOTAL_SESSIONS = SHORT_COUNT + 1;
const server = require('../server.js');
let base = '';
test.before(async () => {
    if (!server.listening)
        await (0, node_events_1.once)(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Test server lacks TCP address');
    base = `http://127.0.0.1:${address.port}`;
    // A transcript read refreshes harness pricing, which re-indexes every
    // session and briefly hides them from ref resolution. The usage summary
    // awaits that refresh, so do it once up front, then let the index settle.
    await fetch(`${base}/api/usage-summary`);
    for (let i = 0; i < 400; i++) {
        const body = (0, test_types_js_1.record)(await (await fetch(`${base}/api/sessions`)).json());
        if (!body.indexing && (0, test_types_js_1.records)(body.previous).length >= TOTAL_SESSIONS)
            return;
    }
    throw new Error('fixture sessions never finished indexing');
});
test.after(() => {
    server.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
});
function run(args) {
    const env = { ...process.env, HOME: tmpHome, PI_DISH_URL: base };
    delete env.PI_DISH_TOKEN;
    delete env.PI_DISH_SESSION_ID;
    return execFileAsync(process.execPath, [CLI, ...args], { env, maxBuffer: 16 * 1024 * 1024 });
}
const rowLines = (stdout) => stdout.split('\n').filter(line => line && !line.startsWith('#') && !line.startsWith(' '));
const catalogRows = (body) => [...(0, test_types_js_1.records)(body.active), ...(0, test_types_js_1.records)(body.children), ...(0, test_types_js_1.records)(body.previous)];
test('GET /api/sessions is unchanged without bounds and honours opt-in limit and fields', async () => {
    const plain = (0, test_types_js_1.record)(await (await fetch(`${base}/api/sessions`)).json());
    assert.equal('total' in plain, false, 'the browser request carries no bounds and gets no new key');
    assert.equal(catalogRows(plain).length, TOTAL_SESSIONS);
    assert.ok(catalogRows(plain).every(row => 'sessionKey' in row), 'unbounded rows keep every field');
    const bounded = (0, test_types_js_1.record)(await (await fetch(`${base}/api/sessions?limit=3&fields=name,cwd`)).json());
    assert.equal(bounded.total, TOTAL_SESSIONS);
    const rows = catalogRows(bounded);
    assert.equal(rows.length, 3);
    for (const row of rows)
        assert.deepEqual(Object.keys(row).sort(), ['cwd', 'id', 'name']);
    assert.equal(bounded.indexing, false, 'catalog flags survive the bounds');
    for (const query of ['limit=0', 'limit=x', 'fields=', 'fields=a.b']) {
        const res = await fetch(`${base}/api/sessions?${query}`);
        assert.equal(res.status, 400, query);
    }
});
test('list shows 50 rows by default, more on request, and says when it cut', async () => {
    const bounded = await run(['list']);
    assert.equal(rowLines(bounded.stdout).length, 50);
    assert.match(bounded.stdout, new RegExp(`^# Showing 50 of ${TOTAL_SESSIONS} sessions \\(live first\\); --limit N or --full for more\\.$`, 'm'));
    assert.equal(rowLines((await run(['list', '--limit', '55'])).stdout).length, 55);
    const full = await run(['list', '--full']);
    assert.equal(rowLines(full.stdout).length, TOTAL_SESSIONS);
    assert.equal(full.stdout.includes('# Showing'), false, 'no notice when nothing was cut');
});
test('list --json keeps the catalog shape, a compact field set, and notices on stderr', async () => {
    const bounded = await run(['list', '--json']);
    const body = (0, test_types_js_1.record)(JSON.parse(bounded.stdout));
    assert.equal(body.total, TOTAL_SESSIONS);
    const rows = catalogRows(body);
    assert.equal(rows.length, 50);
    for (const row of rows) {
        assert.equal('sessionKey' in row, false, 'wide fields are dropped by default');
        assert.equal(typeof row.ref, 'string', 'each row carries the ref list prints');
    }
    assert.match(bounded.stderr, /^# Showing 50 of \d+ sessions/);
    const full = await run(['list', '--json', '--full']);
    const fullRows = catalogRows((0, test_types_js_1.record)(JSON.parse(full.stdout)));
    assert.equal(fullRows.length, TOTAL_SESSIONS);
    assert.ok(fullRows.every(row => 'sessionKey' in row));
    assert.equal(full.stderr, '');
    const picked = catalogRows((0, test_types_js_1.record)(JSON.parse((await run(['list', '--json', '--limit', '2', '--fields', 'name'])).stdout)));
    assert.deepEqual(picked.map(row => Object.keys(row).sort()), [['id', 'name'], ['id', 'name']]);
});
test('read caps a long window at the newest messages and prints the command that pages back', async () => {
    const bounded = await run(['read', LONG_ID]);
    assert.ok(bounded.stdout.length <= DEFAULT_MAX_CHARS + 400, `read stayed near the cap (${bounded.stdout.length})`);
    assert.ok(bounded.stdout.includes(`msg-${LONG_MESSAGES - 1}`), 'the newest message is kept');
    assert.equal(bounded.stdout.includes('msg-10 '), false, 'the oldest messages of the window are dropped');
    const hint = (0, test_types_js_1.present)(bounded.stdout.trim().split('\n').at(-1));
    assert.match(hint, /^— Cut to fit --max-chars 12000: the \d+ oldest messages of this window not shown; \d+ older messages in all\. Page back with: read \S+ --limit 30 --before \d+ \(or --max-chars 0 for no cap\)$/);
    // Replaying the printed command reaches the dropped messages.
    const before = Number((0, test_types_js_1.present)(/--before (\d+)/.exec(hint))[1]);
    const older = await run(['read', LONG_ID, '--limit', '30', '--before', String(before)]);
    assert.ok(older.stdout.includes(`msg-${String(before - 1).padStart(2, '0')} `));
    const full = await run(['read', LONG_ID, '--max-chars', '0']);
    assert.ok(full.stdout.includes('msg-10 ') && full.stdout.includes('z'.repeat(5000)));
    assert.equal(full.stdout.includes('Cut to fit'), false);
    assert.equal((await run(['read', shortId(0)])).stdout.includes('Cut to fit'), false, 'a short transcript is not cut');
});
test('show clips long strings, drops the oldest messages, and notices on stderr', async () => {
    const bounded = await run(['show', LONG_ID]);
    assert.ok(bounded.stdout.length <= DEFAULT_MAX_CHARS, `show stayed within the cap (${bounded.stdout.length})`);
    const body = (0, test_types_js_1.record)(JSON.parse(bounded.stdout));
    const messages = (0, test_types_js_1.records)(body.messages);
    const newest = String((0, test_types_js_1.record)((0, test_types_js_1.records)((0, test_types_js_1.present)(messages.at(-1)).content)[0]).text);
    assert.match(newest, /^msg-39 z{1993}…\[\+3007 chars\]$/);
    assert.match(bounded.stderr, /^# show cut to fit --max-chars 12000: 1 string clipped to 2000 chars; the \d+ oldest messages dropped \(show \S+ --limit 20 --before \d+ pages back\); --max-chars 0 or --full for everything\.\n$/);
    assert.equal(Number(body.firstIndex), LONG_MESSAGES - messages.length, 'firstIndex moves with the kept window');
    const full = await run(['show', LONG_ID, '--full']);
    assert.equal(full.stderr, '');
    const fullMessages = (0, test_types_js_1.records)((0, test_types_js_1.record)(JSON.parse(full.stdout)).messages);
    assert.equal(fullMessages.length, 20);
    assert.ok(String((0, test_types_js_1.record)((0, test_types_js_1.records)((0, test_types_js_1.present)(fullMessages.at(-1)).content)[0]).text).endsWith('z'.repeat(5000)));
    assert.equal((await run(['show', shortId(0)])).stderr, '', 'a short window is not cut');
});
test('search shows 20 results by default and more on request', async () => {
    const bounded = await run(['search', 'quuxbound']);
    assert.equal(rowLines(bounded.stdout).length, 20);
    assert.match(bounded.stdout, new RegExp(`^# ${SHORT_COUNT - 20} more results not shown; refine the query, raise --limit \\(max 100\\) or --full\\.$`, 'm'));
    assert.equal(rowLines((await run(['search', 'quuxbound', '--limit', '30'])).stdout).length, 30);
    const full = await run(['search', 'quuxbound', '--full']);
    assert.equal(rowLines(full.stdout).length, SHORT_COUNT);
    assert.equal(full.stdout.includes('more results not shown'), false);
    const json = await run(['search', 'quuxbound', '--json']);
    const results = (0, test_types_js_1.records)((0, test_types_js_1.record)(JSON.parse(json.stdout)).results);
    assert.equal(results.length, 20);
    assert.ok(results.every(row => !('sessionKey' in row) && typeof row.ref === 'string'));
    assert.match(json.stderr, /^# 40 more results not shown/);
});
test('resolve --json keeps a compact session unless asked for every field', async () => {
    const compact = (0, test_types_js_1.record)((0, test_types_js_1.record)(JSON.parse((await run(['resolve', LONG_ID, '--json'])).stdout)).session);
    const full = (0, test_types_js_1.record)((0, test_types_js_1.record)(JSON.parse((await run(['resolve', LONG_ID, '--json', '--fields', 'all'])).stdout)).session);
    assert.equal(compact.id, LONG_ID);
    assert.equal(compact.cwd, '/home/user/boundproj');
    assert.equal('sessionKey' in compact, false);
    assert.ok('sessionKey' in full);
    for (const key of Object.keys(compact))
        assert.ok(key in full, key);
});
test('hosts text is capped only when asked below its size', async () => {
    const plain = await run(['hosts']);
    assert.equal(plain.stdout.includes('# Output cut'), false);
    const cut = await run(['hosts', '--max-chars', '10']);
    assert.match(cut.stdout, /^# Output cut at --max-chars 10 \(\d+ more chars\); --max-chars N or --full for more/m);
    await assert.rejects(run(['hosts', '--max-chars', 'lots']), (error) => /--max-chars needs a whole number/.test((0, test_types_js_1.errorMessage)(error)));
});
