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
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-routines-api-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
process.env.PI_DISH_HEADLESS = 'rpc';
// oneShot's auto-close would otherwise sit out its ten-second grace period.
process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS = '0';

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-rpc-pi.js');
const CMD_LOG = path.join(tmpHome, 'rpc-commands.jsonl');
process.env.PI_DISH_PI_COMMAND = `env PI_FIXTURE_LOG=${CMD_LOG} ${process.execPath} ${FIXTURE}`;

const server = require('../server.js');
const { getAllRPCSessions } = require('../lib/rpc-session');

let base;
test.before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  for (const rpc of getAllRPCSessions()) rpc.kill();
  server.close();
});

const request = async (method, p, body) => {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + p, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const get = (p) => request('GET', p);
const post = (p, body) => request('POST', p, body);
const put = (p, body) => request('PUT', p, body);
const del = (p) => request('DELETE', p);

const readLog = () => {
  try {
    return fs.readFileSync(CMD_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
};
const prompts = () => readLog().filter((c) => c.type === 'prompt');
const steers = () => readLog().filter((c) => c.type === 'steer');

async function waitFor(predicate, { timeout = 20000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const invocation = async (id) => (await get(`/api/routine-invocations/${id}`)).body.invocation;
const waitForStatus = (id, ...statuses) => waitFor(async () => {
  const current = await invocation(id);
  return statuses.includes(current.status) ? current : null;
}, { label: `invocation ${id} to reach ${statuses.join('/')}` });

const definition = (over = {}) => ({
  name: 'api-routine',
  cwd: tmpHome,
  prompt: 'Ping.',
  ...over,
});

test('the host advertises the routines capability', async () => {
  const { body } = await get('/api/host');
  assert.equal(body.capabilities.routines, true);
});

test('CRUD: create, list, read, update, delete', async () => {
  const created = await post('/api/routines', definition({
    name: 'crud-routine', description: 'a test routine', schedule: { cron: '0 9 * * 1-5' },
  }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const routine = created.body.routine;
  assert.equal(routine.promptVersion, 1);
  assert.equal(routine.mode, 'oneShot');
  assert.ok(routine.versions, 'the create response carries the full record');

  const list = await get('/api/routines');
  assert.equal(list.status, 200);
  const row = list.body.routines.find((r) => r.id === routine.id);
  assert.ok(row, 'the routine is listed');
  assert.equal(row.versions, undefined, 'list rows drop the version history');
  assert.deepEqual(Object.keys(row.stats).sort(), ['invocations', 'lastInvocation', 'nextRunAt', 'running']);
  assert.equal(row.stats.invocations, 0);
  assert.ok(row.stats.nextRunAt > Date.now(), 'a scheduled routine reports its next run');

  // Addressable by name as well as uuid.
  assert.equal((await get('/api/routines/crud-routine')).body.routine.id, routine.id);
  assert.equal((await get(`/api/routines/${routine.id}`)).body.routine.id, routine.id);
  assert.equal((await get('/api/routines/nope')).status, 404);

  // A prompt change bumps the version; other edits do not.
  const renamed = await put(`/api/routines/${routine.id}`, { description: 'edited' });
  assert.equal(renamed.body.routine.promptVersion, 1);
  const bumped = await put('/api/routines/crud-routine', { prompt: 'Pong.' });
  assert.equal(bumped.status, 200);
  assert.equal(bumped.body.routine.promptVersion, 2);
  assert.equal(bumped.body.routine.versions.length, 2);

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
    const res = await post('/api/routines', body);
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.error, pattern);
  }

  const first = await post('/api/routines', definition({ name: 'dupe-routine' }));
  assert.equal(first.status, 201);
  const second = await post('/api/routines', definition({ name: 'dupe-routine' }));
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already exists/);
  await del('/api/routines/dupe-routine');
});

test('invoke spawns a session, delivers the prompt with the input block, completes and closes', async () => {
  const { body: { routine } } = await post('/api/routines', definition({
    name: 'oneshot-routine', prompt: 'Summarize the day.',
  }));

  const before = prompts().length;
  const started = await post(`/api/routines/${routine.id}/invoke`,
    { input: { pr: 42, repo: 'pi-dish' }, source: 'nightly-cron' });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.equal(started.body.invocation.status, 'starting');
  assert.equal(started.body.invocation.trigger, 'invoke');
  assert.equal(started.body.invocation.delivery, 'prompt');
  assert.equal(started.body.invocation.source, 'nightly-cron');
  assert.equal(started.body.invocation.version, 1);
  const id = started.body.invocation.id;

  const running = await waitForStatus(id, 'running', 'completed');
  assert.ok(running.sessionId, 'the invocation names its session');

  const delivered = await waitFor(() => prompts().length > before && prompts().at(-1),
    { label: 'the fixture to receive the prompt' });
  assert.match(delivered.message, /^Summarize the day\./);
  assert.match(delivered.message, /<invocation-input source="nightly-cron" invocation="[0-9a-f-]{36}">/);
  assert.match(delivered.message, /"pr": 42/);
  assert.match(delivered.message, /<\/invocation-input>/);

  const completed = await waitForStatus(id, 'completed');
  assert.match(completed.summary, /^reply to: Summarize the day\./);
  assert.ok(completed.durationMs >= 0);
  assert.equal(completed.error, null);

  // oneShot closes the session after the (zeroed) grace period, and the RPC
  // child really goes away.
  const closed = await waitFor(async () => {
    const current = await invocation(id);
    return current.closed || current.closeError ? current : null;
  }, { label: 'the oneShot auto-close' });
  assert.equal(closed.closed, true, closed.closeError || '');
  assert.equal(closed.closeError, null);
  assert.ok(!getAllRPCSessions().some((s) => s.id === closed.sessionId && s.alive),
    'the spawned pi child is gone');

  // Stats reflect the run.
  const row = (await get('/api/routines')).body.routines.find((r) => r.id === routine.id);
  assert.equal(row.stats.invocations, 1);
  assert.equal(row.stats.running, 0);
  assert.equal(row.stats.lastInvocation.id, id);
  assert.equal(row.stats.nextRunAt, null, 'no schedule means no next run');

  await del(`/api/routines/${routine.id}`);
});

test('a routine session is stamped and findable with routine: while it lives', async () => {
  const { body: { routine } } = await post('/api/routines', definition({
    name: 'stamped-routine', mode: 'continue',   // continue never auto-closes
  }));
  const { body } = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
  // ?wait=1 blocks until the record leaves `starting` — a fast turn may already
  // have finished by then, which is fine; what it guarantees is a session.
  assert.ok(['running', 'completed'].includes(body.invocation.status), body.invocation.status);
  const sessionId = body.invocation.sessionId;
  assert.ok(sessionId, '?wait=1 returns an invocation that already has its session');

  const listed = await waitFor(async () => {
    const res = await get('/api/sessions?active=1');
    return res.body.active.find((s) => s.id === sessionId) || null;
  }, { label: 'the spawned session to appear in the list' });
  assert.equal(listed.routine, 'stamped-routine');
  assert.equal(listed.routineId, routine.id);
  assert.equal(listed.routineInvocationId, body.invocation.id);

  const found = await get('/api/sessions?active=1&q=routine%3Astamped-routine');
  assert.ok(found.body.active.some((s) => s.id === sessionId), 'routine: matches the session');
  const excluded = await get('/api/sessions?active=1&q=-routine%3Astamped-routine');
  assert.ok(!excluded.body.active.some((s) => s.id === sessionId), '-routine: excludes it');
  const other = await get('/api/sessions?active=1&q=routine%3Asomething-else');
  assert.ok(!other.body.active.some((s) => s.id === sessionId));

  // Advanced search speaks the same grammar over the same stamp.
  const search = await get('/api/search?q=routine%3Astamped-routine');
  assert.ok(search.body.results.some((s) => s.id === sessionId), 'advanced search matches too');

  await waitForStatus(body.invocation.id, 'completed');
  await post(`/api/sessions/${sessionId}/close`, {});
  await del(`/api/routines/${routine.id}`);
});

test('a busy routine skips with 409, then steers once onBusy says so', async () => {
  const { body: { routine } } = await post('/api/routines', definition({
    name: 'busy-routine', prompt: 'slow: hold the turn open', mode: 'continue',
  }));

  const first = await post(`/api/routines/${routine.id}/invoke`, {});
  const running = await waitForStatus(first.body.invocation.id, 'running');

  const refused = await post(`/api/routines/${routine.id}/invoke`, {});
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.match(refused.body.error, /already running/);
  assert.equal(refused.body.invocation.id, first.body.invocation.id);
  assert.equal((await get(`/api/routines/${routine.id}/invocations`)).body.invocations.length, 1,
    'the refusal is not recorded');

  const steering = await put(`/api/routines/${routine.id}`, { onBusy: 'steer' });
  assert.equal(steering.body.routine.onBusy, 'steer');

  const before = steers().length;
  const steered = await post(`/api/routines/${routine.id}/invoke`, { input: { note: 'also check tests' } });
  assert.equal(steered.status, 202, JSON.stringify(steered.body));
  assert.equal(steered.body.invocation.delivery, 'steer');
  const delivered = await waitFor(() => steers().length > before && steers().at(-1),
    { label: 'the fixture to receive a steer' });
  assert.match(delivered.message, /^slow: hold the turn open/);
  assert.match(delivered.message, /"note": "also check tests"/);
  assert.equal((await invocation(steered.body.invocation.id)).sessionId, running.sessionId,
    'the steer went into the running session, not a new one');

  // Both invocations settle at the turn that follows.
  await waitForStatus(first.body.invocation.id, 'completed', 'interrupted');
  await waitForStatus(steered.body.invocation.id, 'completed', 'interrupted');
  await post(`/api/sessions/${running.sessionId}/close`, {});
  await del(`/api/routines/${routine.id}`);
});

test('continue mode prompts the same session on the second run', async () => {
  const { body: { routine } } = await post('/api/routines', definition({
    name: 'continue-routine', mode: 'continue', prompt: 'Continue.',
  }));

  const first = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
  const firstSession = first.body.invocation.sessionId;
  assert.ok(firstSession);
  await waitForStatus(first.body.invocation.id, 'completed');

  const before = prompts().length;
  const second = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
  assert.equal(second.body.invocation.sessionId, firstSession, 'the same session is reused');
  await waitFor(() => prompts().length > before, { label: 'the second prompt' });
  const done = await waitForStatus(second.body.invocation.id, 'completed');
  assert.equal(done.closed, false, 'continue mode does not auto-close');

  const page = await get(`/api/routines/${routine.id}/invocations?limit=1`);
  assert.equal(page.body.invocations.length, 1);
  assert.equal(page.body.invocations[0].id, second.body.invocation.id, 'newest first');
  assert.ok(page.body.nextBefore, 'a cursor is offered when more remain');
  const older = await get(`/api/routines/${routine.id}/invocations?before=${page.body.nextBefore}`);
  assert.equal(older.body.invocations[0].id, first.body.invocation.id);
  assert.equal(older.body.nextBefore, null);

  await post(`/api/sessions/${firstSession}/close`, {});
  await del(`/api/routines/${routine.id}`);
});

test('minIntervalSec answers 429 with a retry hint and records nothing', async () => {
  const { body: { routine } } = await post('/api/routines', definition({
    name: 'rate-routine', minIntervalSec: 300, mode: 'continue',
  }));
  const first = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
  assert.equal(first.status, 200);

  const limited = await post(`/api/routines/${routine.id}/invoke`, {});
  assert.equal(limited.status, 429, JSON.stringify(limited.body));
  assert.ok(limited.body.retryAfterSec > 0 && limited.body.retryAfterSec <= 300);
  assert.equal(limited.body.lastInvocation.id, first.body.invocation.id);
  assert.equal((await get(`/api/routines/${routine.id}/invocations`)).body.invocations.length, 1);

  await waitForStatus(first.body.invocation.id, 'completed');
  await post(`/api/sessions/${first.body.invocation.sessionId}/close`, {});
  await del(`/api/routines/${routine.id}`);
});

test('oversized input is a 413 and a bad source a 400, neither recorded', async () => {
  const { body: { routine } } = await post('/api/routines', definition({ name: 'guard-routine' }));
  const huge = await post(`/api/routines/${routine.id}/invoke`, { input: { blob: 'x'.repeat(40000) } });
  assert.equal(huge.status, 413);
  assert.match(huge.body.error, /at most/);

  const badSource = await post(`/api/routines/${routine.id}/invoke`, { source: 'x'.repeat(200) });
  assert.equal(badSource.status, 400);
  assert.match(badSource.body.error, /source must be a string/);

  assert.equal((await get(`/api/routines/${routine.id}/invocations`)).body.invocations.length, 0);
  assert.equal((await post('/api/routines/ghost-routine/invoke', {})).status, 404);
  await del(`/api/routines/${routine.id}`);
});

test('deleting a routine keeps its invocations readable', async () => {
  const { body: { routine } } = await post('/api/routines', definition({
    name: 'ledger-routine', mode: 'continue',
  }));
  const run = await post(`/api/routines/${routine.id}/invoke?wait=1`, {});
  const id = run.body.invocation.id;
  await waitForStatus(id, 'completed');
  await post(`/api/sessions/${run.body.invocation.sessionId}/close`, {});

  const removed = await del(`/api/routines/${routine.id}`);
  assert.deepEqual(removed.body, { success: true, invocations: 1 });
  const kept = await get(`/api/routine-invocations/${id}`);
  assert.equal(kept.status, 200);
  assert.equal(kept.body.invocation.routineName, 'ledger-routine', 'the denormalized name survives');
  assert.equal((await get(`/api/routines/${routine.id}/invocations`)).status, 404);
  assert.equal((await get('/api/routine-invocations/00000000-0000-0000-0000-000000000000')).status, 404);
});
