// Generated test/tool from test/routines-api.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_types_js_1 = require("./test-types.js");
/**
 * End-to-end tests for the routines API against a real headless backend:
 * PI_DISH_HEADLESS=rpc plus test/fixtures/fake-rpc-pi.js, so an invoke really
 * spawns a child, really delivers a prompt, and the fixture's command log
 * proves what the agent was asked (including the `<invocation-input>` block).
 *
 * Same scaffolding as test/rpc-session.test.js — including its teardown rule:
 * the spawned children are live handles, so they must be killed or node:test
 * never exits.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-routines-api-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
process.env.PI_DISH_HEADLESS = 'rpc';
// oneShot's auto-close would otherwise sit out its ten-second grace period.
process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS = '0';
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-rpc-pi.js');
const CMD_LOG = path.join(tmpHome, 'rpc-commands.jsonl');
const START_LOG = path.join(tmpHome, 'rpc-starts.jsonl');
process.env.PI_FIXTURE_START_LOG = START_LOG;
process.env.PI_DISH_PI_COMMAND = `env PI_FIXTURE_LOG=${CMD_LOG} ${process.execPath} ${FIXTURE}`;
process.env.PI_DISH_OMP_COMMAND = `env PI_FIXTURE_HARNESS=omp ${process.execPath} ${path.join(__dirname, 'fixtures', 'fake-pi.js')}`;
const server = require('../server.js');
const { getAllRPCSessions } = require('../lib/rpc-session');
let base = '';
test.before(async () => {
    if (!server.listening)
        await new Promise(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Test server lacks TCP address');
    base = `http://127.0.0.1:${address.port}`;
});
test.after(() => {
    for (const rpc of getAllRPCSessions())
        rpc.kill();
    server.close();
});
const request = async (method, requestPath, body) => {
    const init = { method };
    if (body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
    }
    const response = await fetch(base + requestPath, init);
    return { status: response.status, body: (0, test_types_js_1.record)(await response.json().catch(() => ({}))) };
};
const get = (requestPath) => request('GET', requestPath);
const post = (requestPath, body) => request('POST', requestPath, body);
const put = (requestPath, body) => request('PUT', requestPath, body);
const del = (requestPath) => request('DELETE', requestPath);
const text = (value) => String(value ?? '');
const readLog = () => {
    try {
        return fs.readFileSync(CMD_LOG, 'utf8').trim().split('\n').filter(Boolean).map(line => (0, test_types_js_1.record)(JSON.parse(line)));
    }
    catch {
        return [];
    }
};
const prompts = () => readLog().filter(command => command.type === 'prompt');
const steers = () => readLog().filter(command => command.type === 'steer');
async function waitFor(predicate, { timeout = 20000, label = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const value = await predicate();
        if (value)
            return (0, test_types_js_1.present)(value);
        if (Date.now() > deadline)
            throw new Error(`timed out waiting for ${label}`);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
const invocation = async (id) => (0, test_types_js_1.record)((await get(`/api/routine-invocations/${text(id)}`)).body.invocation);
const waitForStatus = (id, ...statuses) => waitFor(async () => {
    const current = await invocation(id);
    return statuses.includes(text(current.status)) ? current : null;
}, { label: `invocation ${text(id)} to reach ${statuses.join('/')}` });
const definition = (over = {}) => ({
    name: 'api-routine',
    cwd: tmpHome,
    prompt: 'Ping.',
    ...over,
});
test('the host advertises the routines capability', async () => {
    const { body } = await get('/api/host');
    assert.equal((0, test_types_js_1.record)(body.capabilities).routines, true);
});
test('CRUD: create, list, read, update, delete', async () => {
    const created = await post('/api/routines', definition({
        name: 'crud-routine', description: 'a test routine', schedule: { cron: '0 9 * * 1-5' },
    }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const routine = (0, test_types_js_1.record)(created.body.routine);
    assert.equal(routine.promptVersion, 1);
    assert.equal(routine.mode, 'oneShot');
    assert.ok(routine.versions, 'the create response carries the full record');
    const list = await get('/api/routines');
    assert.equal(list.status, 200);
    const row = (0, test_types_js_1.present)((0, test_types_js_1.records)(list.body.routines).find(candidate => candidate.id === routine.id));
    assert.equal(row.versions, undefined, 'list rows drop the version history');
    const stats = (0, test_types_js_1.record)(row.stats);
    assert.deepEqual(Object.keys(stats).sort(), ['invocations', 'lastInvocation', 'nextRunAt', 'running']);
    assert.equal(stats.invocations, 0);
    assert.ok(Number(stats.nextRunAt) > Date.now(), 'a scheduled routine reports its next run');
    // Addressable by name as well as uuid.
    assert.equal((0, test_types_js_1.record)((await get('/api/routines/crud-routine')).body.routine).id, routine.id);
    assert.equal((0, test_types_js_1.record)((await get(`/api/routines/${routine.id}`)).body.routine).id, routine.id);
    assert.equal((await get('/api/routines/nope')).status, 404);
    // A prompt change bumps the version; other edits do not.
    const renamed = await put(`/api/routines/${routine.id}`, { description: 'edited' });
    assert.equal((0, test_types_js_1.record)(renamed.body.routine).promptVersion, 1);
    const bumped = await put('/api/routines/crud-routine', { prompt: 'Pong.' });
    assert.equal(bumped.status, 200);
    assert.equal((0, test_types_js_1.record)(bumped.body.routine).promptVersion, 2);
    assert.equal((0, test_types_js_1.records)((0, test_types_js_1.record)(bumped.body.routine).versions).length, 2);
    const removed = await del(`/api/routines/${routine.id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { success: true, invocations: 0 });
    assert.equal((await get('/api/routines/crud-routine')).status, 404);
});
test('validation errors are 400s and a duplicate name is a 409', async () => {
    const cases = [
        [definition({ name: 'Not Valid' }), /name must be lowercase/],
        [definition({ cwd: 'relative' }), /absolute path/],
        [definition({ prompt: '' }), /prompt is required/],
        [definition({ harness: 'ghost' }), /Unknown harness/],
        [definition({ schedule: { cron: 'noon-ish' } }), /Invalid schedule/],
        [definition({ mode: 'forever' }), /mode must be one of/],
    ];
    for (const [body, pattern] of cases) {
        const response = await post('/api/routines', body);
        assert.equal(response.status, 400, JSON.stringify(response.body));
        assert.match(text(response.body.error), pattern);
    }
    const first = await post('/api/routines', definition({ name: 'dupe-routine' }));
    assert.equal(first.status, 201);
    const second = await post('/api/routines', definition({ name: 'dupe-routine' }));
    assert.equal(second.status, 409);
    assert.match(text(second.body.error), /already exists/);
    await del('/api/routines/dupe-routine');
});
test('pilot errors precede definition errors without laundering untrusted selections', async () => {
    const invalid = definition({ name: 'Invalid name', model: 123, thinking: null, cwd: 42 });
    const omp = await post('/api/routines', { ...invalid, harness: 'omp' });
    assert.equal(omp.status, 400);
    assert.match(text(omp.body.error), /Model 123 is not available/);
    const pi = await post('/api/routines', { ...invalid, harness: 'pi' });
    assert.equal(pi.status, 400);
    assert.match(text(pi.body.error), /name must be lowercase/);
    const noModel = await post('/api/routines', { ...invalid, harness: 'omp', model: null, thinking: 7 });
    assert.equal(noModel.status, 400);
    assert.match(text(noModel.body.error), /Choose an Oh My Pi model/);
    const badThinking = await post('/api/routines', {
        ...invalid, harness: 'omp', model: 'zai/glm-5.2', thinking: 7,
    });
    assert.equal(badThinking.status, 400);
    assert.match(text(badThinking.body.error), /Thinking level 7 is not valid/);
    assert.equal((0, test_types_js_1.records)((await get('/api/routines')).body.routines).some(row => row.name === invalid.name), false);
});
test('routine pilot updates distinguish absent selections from explicit null', async () => {
    const created = await post('/api/routines', definition({
        name: 'pilot-update', harness: 'omp', model: 'zai/glm-5.2', thinking: 'high',
    }));
    assert.equal(created.status, 201);
    const resource = `/api/routines/${(0, test_types_js_1.record)(created.body.routine).id}`;
    const unchanged = await put(resource, { description: 'same pilot' });
    assert.equal(unchanged.status, 200);
    assert.equal((0, test_types_js_1.record)(unchanged.body.routine).model, 'zai/glm-5.2');
    assert.equal((0, test_types_js_1.record)(unchanged.body.routine).thinking, 'high');
    const cleared = await put(resource, { model: null, thinking: null });
    assert.equal(cleared.status, 200);
    assert.equal(Object.hasOwn((0, test_types_js_1.record)(cleared.body.routine), 'model'), false);
    assert.equal(Object.hasOwn((0, test_types_js_1.record)(cleared.body.routine), 'thinking'), false);
    const invalidCwd = await put(resource, { cwd: null });
    assert.equal(invalidCwd.status, 400);
    assert.match(text(invalidCwd.body.error), /cwd is required/);
    assert.equal((0, test_types_js_1.record)((await get(resource)).body.routine).cwd, tmpHome);
    await del(resource);
});
test('invoke spawns a session, delivers the prompt with the input block, completes and closes', async () => {
    const routine = (0, test_types_js_1.record)((await post('/api/routines', definition({
        name: 'oneshot-routine', prompt: 'Summarize the day.',
    }))).body.routine);
    const before = prompts().length;
    const started = await post(`/api/routines/${routine.id}/invoke`, { input: { pr: 42, repo: 'pi-dish' }, source: 'nightly-cron' });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    assert.equal((0, test_types_js_1.record)(started.body.invocation).status, 'starting');
    assert.equal((0, test_types_js_1.record)(started.body.invocation).trigger, 'invoke');
    assert.equal((0, test_types_js_1.record)(started.body.invocation).delivery, 'prompt');
    assert.equal((0, test_types_js_1.record)(started.body.invocation).source, 'nightly-cron');
    assert.equal((0, test_types_js_1.record)(started.body.invocation).version, 1);
    const id = (0, test_types_js_1.record)(started.body.invocation).id;
    const running = await waitForStatus(id, 'running', 'completed');
    assert.ok(running.sessionId, 'the invocation names its session');
    const delivered = (0, test_types_js_1.record)(await waitFor(() => prompts().length > before && prompts().at(-1), { label: 'the fixture to receive the prompt' }));
    assert.match(text(delivered.message), /^Summarize the day\./);
    assert.match(text(delivered.message), /<invocation-input source="nightly-cron" invocation="[0-9a-f-]{36}">/);
    assert.match(text(delivered.message), /"pr": 42/);
    assert.match(text(delivered.message), /<\/invocation-input>/);
    const completed = await waitForStatus(id, 'completed');
    assert.match(text(completed.summary), /^reply to: Summarize the day\./);
    assert.ok(Number(completed.durationMs) >= 0);
    assert.equal(completed.error, null);
    // oneShot closes the session after the (zeroed) grace period, and the RPC
    // child really goes away.
    const closed = await waitFor(async () => {
        const current = await invocation(id);
        return current.closed || current.closeError ? current : null;
    }, { label: 'the oneShot auto-close' });
    assert.equal(closed.closed, true, text(closed.closeError));
    assert.equal(closed.closeError, null);
    assert.ok(!getAllRPCSessions().some((session) => {
        const row = (0, test_types_js_1.record)(session);
        return row.id === closed.sessionId && row.alive;
    }), 'the spawned pi child is gone');
    // Stats reflect the run.
    const row = (0, test_types_js_1.present)((0, test_types_js_1.records)((await get('/api/routines')).body.routines).find(candidate => candidate.id === routine.id));
    const stats = (0, test_types_js_1.record)(row.stats);
    assert.equal(stats.invocations, 1);
    assert.equal(stats.running, 0);
    assert.equal((0, test_types_js_1.record)(stats.lastInvocation).id, id);
    assert.equal(stats.nextRunAt, null, 'no schedule means no next run');
    await del(`/api/routines/${routine.id}`);
});
test('a routine session is stamped and findable with routine: while it lives', async () => {
    const routine = (0, test_types_js_1.record)((await post('/api/routines', definition({
        name: 'stamped-routine', mode: 'continue', // continue never auto-closes
    }))).body.routine);
    const { body } = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
    // ?wait=1 blocks until the record leaves `starting` — a fast turn may already
    // have finished by then, which is fine; what it guarantees is a session.
    const invoked = (0, test_types_js_1.record)(body.invocation);
    assert.ok(['running', 'completed'].includes(text(invoked.status)), text(invoked.status));
    const sessionId = text(invoked.sessionId);
    assert.ok(sessionId, '?wait=1 returns an invocation that already has its session');
    const listed = await waitFor(async () => {
        const res = await get('/api/sessions?active=1');
        return (0, test_types_js_1.records)(res.body.active).find((s) => s.id === sessionId) || null;
    }, { label: 'the spawned session to appear in the list' });
    assert.equal(listed.routine, 'stamped-routine');
    assert.equal(listed.routineId, routine.id);
    assert.equal(listed.routineInvocationId, invoked.id);
    const found = await get('/api/sessions?active=1&q=routine%3Astamped-routine');
    assert.ok((0, test_types_js_1.records)(found.body.active).some((s) => s.id === sessionId), 'routine: matches the session');
    const excluded = await get('/api/sessions?active=1&q=-routine%3Astamped-routine');
    assert.ok(!(0, test_types_js_1.records)(excluded.body.active).some((s) => s.id === sessionId), '-routine: excludes it');
    const other = await get('/api/sessions?active=1&q=routine%3Asomething-else');
    assert.ok(!(0, test_types_js_1.records)(other.body.active).some((s) => s.id === sessionId));
    // Advanced search speaks the same grammar over the same stamp.
    const search = await get('/api/search?q=routine%3Astamped-routine');
    assert.ok((0, test_types_js_1.records)(search.body.results).some((s) => s.id === sessionId), 'advanced search matches too');
    await waitForStatus(invoked.id, 'completed');
    await post(`/api/sessions/${sessionId}/close`, {});
    // Closed, the run is history — and history is where automation runs pile
    // up. The browser's search view sends hideAutomation=1; the query or an
    // active scope asking for them (is:automation / routine:) lifts it, and
    // the API default stays inclusive for CLI consumers.
    await waitFor(async () => {
        const res = await get('/api/search');
        return (0, test_types_js_1.records)(res.body.results).some((s) => s.id === sessionId) ? res : null;
    }, { label: 'the closed routine run to become searchable history' });
    const hidden = await get('/api/search?hideAutomation=1');
    assert.ok(!(0, test_types_js_1.records)(hidden.body.results).some((s) => s.id === sessionId), 'hideAutomation drops the closed routine run');
    assert.ok(Number(hidden.body.hiddenByAutomation) >= 1, 'the dropped run is counted');
    const asked = await get('/api/search?hideAutomation=1&q=is%3Aautomation');
    assert.ok((0, test_types_js_1.records)(asked.body.results).some((s) => s.id === sessionId), 'is:automation affirmatively asks for it');
    const scoped = await get('/api/search?hideAutomation=1&scope=routine%3Astamped-routine');
    assert.ok((0, test_types_js_1.records)(scoped.body.results).some((s) => s.id === sessionId), 'a scope naming the routine asks for it too');
    await del(`/api/routines/${routine.id}`);
});
test('a busy routine skips with 409, then steers once onBusy says so', async () => {
    const routine = (0, test_types_js_1.record)((await post('/api/routines', definition({
        name: 'busy-routine', prompt: 'slow: hold the turn open', mode: 'continue',
    }))).body.routine);
    const first = await post(`/api/routines/${routine.id}/invoke`, {});
    const running = await waitForStatus((0, test_types_js_1.record)(first.body.invocation).id, 'running');
    const refused = await post(`/api/routines/${routine.id}/invoke`, {});
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.match(text(refused.body.error), /already running/);
    const invalidBeforeBusy = await post(`/api/routines/${routine.id}/invoke`, { source: 42 });
    assert.equal(invalidBeforeBusy.status, 400, 'HTTP source validation precedes the busy guard');
    assert.equal((0, test_types_js_1.record)(refused.body.invocation).id, (0, test_types_js_1.record)(first.body.invocation).id);
    assert.equal((0, test_types_js_1.records)((await get(`/api/routines/${routine.id}/invocations`)).body.invocations).length, 1, 'the refusal is not recorded');
    const steering = await put(`/api/routines/${routine.id}`, { onBusy: 'steer' });
    assert.equal((0, test_types_js_1.record)(steering.body.routine).onBusy, 'steer');
    const before = steers().length;
    const steered = await post(`/api/routines/${routine.id}/invoke`, { input: { note: 'also check tests' } });
    assert.equal(steered.status, 202, JSON.stringify(steered.body));
    assert.equal((0, test_types_js_1.record)(steered.body.invocation).delivery, 'steer');
    const delivered = (0, test_types_js_1.record)(await waitFor(() => steers().length > before && steers().at(-1), { label: 'the fixture to receive a steer' }));
    assert.match(text(delivered.message), /^slow: hold the turn open/);
    assert.match(text(delivered.message), /"note": "also check tests"/);
    assert.equal((await invocation((0, test_types_js_1.record)(steered.body.invocation).id)).sessionId, running.sessionId, 'the steer went into the running session, not a new one');
    // Both invocations settle at the turn that follows.
    await waitForStatus((0, test_types_js_1.record)(first.body.invocation).id, 'completed', 'interrupted');
    await waitForStatus((0, test_types_js_1.record)(steered.body.invocation).id, 'completed', 'interrupted');
    await post(`/api/sessions/${running.sessionId}/close`, {});
    await del(`/api/routines/${routine.id}`);
});
test('continue mode prompts the same session on the second run', async () => {
    const routine = (0, test_types_js_1.record)((await post('/api/routines', definition({
        name: 'continue-routine', mode: 'continue', prompt: 'Continue.',
    }))).body.routine);
    const first = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
    const firstSession = (0, test_types_js_1.record)(first.body.invocation).sessionId;
    assert.ok(firstSession);
    await waitForStatus((0, test_types_js_1.record)(first.body.invocation).id, 'completed');
    const before = prompts().length;
    const second = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
    assert.equal((0, test_types_js_1.record)(second.body.invocation).sessionId, firstSession, 'the same session is reused');
    await waitFor(() => prompts().length > before, { label: 'the second prompt' });
    const done = await waitForStatus((0, test_types_js_1.record)(second.body.invocation).id, 'completed');
    assert.equal(done.closed, false, 'continue mode does not auto-close');
    const page = await get(`/api/routines/${routine.id}/invocations?limit=1`);
    assert.equal((0, test_types_js_1.records)(page.body.invocations).length, 1);
    assert.equal((0, test_types_js_1.records)(page.body.invocations)[0].id, (0, test_types_js_1.record)(second.body.invocation).id, 'newest first');
    assert.ok(page.body.nextBefore, 'a cursor is offered when more remain');
    const older = await get(`/api/routines/${routine.id}/invocations?before=${page.body.nextBefore}`);
    assert.equal((0, test_types_js_1.records)(older.body.invocations)[0].id, (0, test_types_js_1.record)(first.body.invocation).id);
    assert.equal(older.body.nextBefore, null);
    await post(`/api/sessions/${firstSession}/close`, {});
    await del(`/api/routines/${routine.id}`);
});
test('minIntervalSec answers 429 with a retry hint and records nothing', async () => {
    const routine = (0, test_types_js_1.record)((await post('/api/routines', definition({
        name: 'rate-routine', minIntervalSec: 300, mode: 'continue',
    }))).body.routine);
    const first = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
    assert.equal(first.status, 200);
    const limited = await post(`/api/routines/${routine.id}/invoke`, {});
    assert.equal(limited.status, 429, JSON.stringify(limited.body));
    const retryAfterSec = Number(limited.body.retryAfterSec);
    assert.ok(retryAfterSec > 0 && retryAfterSec <= 300);
    assert.equal((0, test_types_js_1.record)(limited.body.lastInvocation).id, (0, test_types_js_1.record)(first.body.invocation).id);
    const invalidBeforeRate = await post(`/api/routines/${routine.id}/invoke`, { source: 42 });
    assert.equal(invalidBeforeRate.status, 400, 'HTTP source validation precedes the rate guard');
    assert.equal((0, test_types_js_1.records)((await get(`/api/routines/${routine.id}/invocations`)).body.invocations).length, 1);
    await waitForStatus((0, test_types_js_1.record)(first.body.invocation).id, 'completed');
    await post(`/api/sessions/${(0, test_types_js_1.record)(first.body.invocation).sessionId}/close`, {});
    await del(`/api/routines/${routine.id}`);
});
test('oversized input is a 413 and a bad source a 400, neither recorded', async () => {
    const routine = (0, test_types_js_1.record)((await post('/api/routines', definition({ name: 'guard-routine' }))).body.routine);
    const huge = await post(`/api/routines/${routine.id}/invoke`, { input: { blob: 'x'.repeat(40000) }, source: 'x'.repeat(200) });
    assert.equal(huge.status, 413);
    assert.match(text(huge.body.error), /at most/);
    const badSource = await post(`/api/routines/${routine.id}/invoke`, { source: 'x'.repeat(200) });
    assert.equal(badSource.status, 400);
    assert.match(text(badSource.body.error), /source must be a string/);
    const badFraming = await post(`/api/routines/${routine.id}/invoke`, { source: 'line\nbreak' });
    assert.equal(badFraming.status, 400);
    assert.match(text(badFraming.body.error), /control characters/);
    assert.equal((0, test_types_js_1.records)((await get(`/api/routines/${routine.id}/invocations`)).body.invocations).length, 0);
    assert.equal((await post('/api/routines/ghost-routine/invoke', { input: { blob: 'x'.repeat(40000) }, source: 42 })).status, 404);
    await del(`/api/routines/${routine.id}`);
});
test('deleting a routine keeps its invocations readable', async () => {
    const routine = (0, test_types_js_1.record)((await post('/api/routines', definition({
        name: 'ledger-routine', mode: 'continue',
    }))).body.routine);
    const run = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
    const id = (0, test_types_js_1.record)(run.body.invocation).id;
    await waitForStatus(id, 'completed');
    await post(`/api/sessions/${(0, test_types_js_1.record)(run.body.invocation).sessionId}/close`, {});
    const removed = await del(`/api/routines/${routine.id}`);
    assert.deepEqual(removed.body, { success: true, invocations: 1 });
    const kept = await get(`/api/routine-invocations/${id}`);
    assert.equal(kept.status, 200);
    assert.equal((0, test_types_js_1.record)(kept.body.invocation).routineName, 'ledger-routine', 'the denormalized name survives');
    assert.equal((await get(`/api/routines/${routine.id}/invocations`)).status, 404);
    assert.equal((await get('/api/routine-invocations/00000000-0000-0000-0000-000000000000')).status, 404);
});
test('saved raw launch selections retain native argv, cwd failure order and falsy fallback', async () => {
    const routine = (0, test_types_js_1.record)((await post('/api/routines', definition({ name: 'raw-launch-routine', prompt: 'slow: verify raw launch selections' }))).body.routine);
    const file = path.join(tmpHome, '.pi', 'dish', 'routines.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.assign((0, test_types_js_1.record)((0, test_types_js_1.record)((0, test_types_js_1.record)(saved).routines)[text(routine.id)]), { model: 42, thinking: ['one', 'two'] });
    fs.writeFileSync(file, JSON.stringify(saved));
    const first = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
    assert.equal(first.status, 200);
    await waitForStatus((0, test_types_js_1.record)(first.body.invocation).id, 'completed');
    const started = fs.readFileSync(START_LOG, 'utf8').trim().split('\n').map(line => (0, test_types_js_1.record)(JSON.parse(line)));
    const child = (0, test_types_js_1.present)(started.find(row => path.basename(text(row.sessionFile), '.jsonl') === (0, test_types_js_1.record)(first.body.invocation).sessionId));
    assert.deepEqual(child.args, ['--mode', 'rpc', '--model', '42', '--thinking', 'one,two']);
    await waitFor(async () => (await invocation((0, test_types_js_1.record)(first.body.invocation).id)).closed);
    (0, test_types_js_1.record)((0, test_types_js_1.record)(saved).routines)[text(routine.id)] = { ...(0, test_types_js_1.record)((0, test_types_js_1.record)((0, test_types_js_1.record)(saved).routines)[text(routine.id)]), cwd: 42 };
    fs.writeFileSync(file, JSON.stringify(saved));
    const before = fs.readFileSync(START_LOG, 'utf8');
    const failed = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
    assert.equal(failed.status, 200);
    assert.equal((0, test_types_js_1.record)(failed.body.invocation).status, 'errored');
    assert.equal((0, test_types_js_1.record)(failed.body.invocation).sessionId, null);
    assert.equal(fs.readFileSync(START_LOG, 'utf8'), before, 'cwd failure must precede native launch');
    (0, test_types_js_1.record)((0, test_types_js_1.record)(saved).routines)[text(routine.id)] = { ...(0, test_types_js_1.record)((0, test_types_js_1.record)((0, test_types_js_1.record)(saved).routines)[text(routine.id)]), cwd: 0 };
    fs.writeFileSync(file, JSON.stringify(saved));
    const fallback = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
    await waitForStatus((0, test_types_js_1.record)(fallback.body.invocation).id, 'completed');
    const lastLine = (0, test_types_js_1.present)(fs.readFileSync(START_LOG, 'utf8').trim().split('\n').at(-1));
    const last = (0, test_types_js_1.record)(JSON.parse(lastLine));
    const header = (0, test_types_js_1.record)(JSON.parse((0, test_types_js_1.present)(fs.readFileSync(text(last.sessionFile), 'utf8').split('\n')[0])));
    assert.equal(header.cwd, tmpHome);
    await waitFor(async () => (await invocation((0, test_types_js_1.record)(fallback.body.invocation).id)).closed);
    await del(`/api/routines/${routine.id}`);
});
test('raw saved continuation identity falls back to a fresh session without rewriting history', async () => {
    const routine = (0, test_types_js_1.record)((await post('/api/routines', definition({ name: 'raw-ledger-routine', mode: 'continue', prompt: 'slow: verify raw continuation identity' }))).body.routine);
    const file = path.join(tmpHome, '.pi', 'dish', 'routine-invocations.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.invocations.unshift({ id: 'external-raw-identity', routineId: routine.id, sessionId: 42, status: 'completed', startedAt: Date.now() - 1000 });
    fs.writeFileSync(file, JSON.stringify(saved));
    const run = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
    assert.equal(run.status, 200);
    const completed = await waitForStatus((0, test_types_js_1.record)(run.body.invocation).id, 'completed');
    assert.equal(typeof completed.sessionId, 'string');
    assert.equal(completed.error, null);
    assert.equal((await invocation('external-raw-identity')).sessionId, 42);
    assert.equal((await post(`/api/sessions/${completed.sessionId}/close`, {})).status, 200);
    await del(`/api/routines/${routine.id}`);
});
