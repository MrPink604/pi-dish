/**
 * Unit tests for lib/routines.js (the store) and lib/routine-runner.js (the
 * lifecycle) with fake deps — no spawn backend, no HTTP.
 *
 * HOME points at a temp dir so the two JSON stores are per-test state; the
 * store re-reads per call, so simply emptying the files between tests is
 * enough to isolate them.
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-routines-test-'));
process.env.HOME = tmpHome;
// The runner reads the grace at close time; ~0 keeps the oneShot close
// assertions from waiting ten real seconds.
process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS = '0';

const store = require('../lib/routines');
const { createRoutineRunner, STARTING_WATCHDOG_MS } = require('../lib/routine-runner');

const dishDir = path.join(tmpHome, '.pi', 'dish');
function reset() {
  fs.mkdirSync(dishDir, { recursive: true });
  fs.writeFileSync(path.join(dishDir, 'routines.json'), JSON.stringify({ version: 1, routines: {} }));
  fs.writeFileSync(path.join(dishDir, 'routine-invocations.json'), JSON.stringify({ version: 1, invocations: [] }));
}
test.beforeEach(reset);

const definition = (over = {}) => ({
  name: 'nightly-review',
  cwd: '/tmp/work',
  prompt: 'Review the day.',
  ...over,
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
/** assert.throws doesn't hand back the error, and these carry status/payload. */
function catchError(fn) {
  try { fn(); } catch (error) { return error; }
  throw new assert.AssertionError({ message: 'expected the call to throw' });
}
const settleTwice = async () => { await settle(); await settle(); await settle(); };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

test('createRoutine fills the defaults and seeds version 1', () => {
  const routine = store.createRoutine(definition());
  assert.equal(routine.harness, 'pi');
  assert.equal(routine.mode, 'oneShot');
  assert.equal(routine.onBusy, 'skip');
  assert.equal(routine.minIntervalSec, 0);
  assert.equal(routine.enabled, true);
  assert.equal(routine.schedule, null);
  assert.equal(routine.description, '');
  assert.equal(routine.promptVersion, 1);
  assert.deepEqual(routine.versions.map((v) => v.version), [1]);
  assert.equal(routine.versions[0].prompt, 'Review the day.');
});

test('validation rejects bad names, cwds, prompts, enums and cron', () => {
  const bad = [
    [{ name: 'Nightly' }, /name must be lowercase/],
    [{ name: '-leading' }, /name must be lowercase/],
    [{ name: 'a'.repeat(49) }, /name must be lowercase/],
    [{ cwd: 'relative/path' }, /absolute path or start with ~/],
    [{ cwd: undefined }, /cwd is required/],
    [{ prompt: '' }, /prompt is required/],
    [{ prompt: 'x'.repeat(store.MAX_PROMPT + 1) }, /at most/],
    [{ harness: 'nope' }, /Unknown harness/],
    [{ mode: 'loop' }, /mode must be one of/],
    [{ onBusy: 'queue' }, /onBusy must be one of/],
    [{ thinking: 'ultra' }, /thinking must be one of/],
    [{ minIntervalSec: -1 }, /integer >= 0/],
    [{ minIntervalSec: 1.5 }, /integer >= 0/],
    [{ schedule: { cron: 'every day' } }, /Invalid schedule/],
    [{ description: 'x'.repeat(501) }, /at most 500/],
  ];
  for (const [over, pattern] of bad) {
    assert.throws(() => store.createRoutine(definition(over)), pattern, JSON.stringify(over));
  }
  // Valid cron and ~-relative cwd are accepted.
  const ok = store.createRoutine(definition({ schedule: { cron: '@daily' }, cwd: '~/work' }));
  assert.deepEqual(ok.schedule, { cron: '@daily' });
});

test('names are unique per host, case-insensitively', () => {
  store.createRoutine(definition());
  const clash = catchError(() => store.createRoutine(definition({ name: 'Nightly-Review'.toLowerCase() })));
  assert.equal(clash.status, 409);
  // A rename onto another routine's name is refused the same way.
  const other = store.createRoutine(definition({ name: 'other' }));
  assert.throws(() => store.updateRoutine(other.id, { name: 'nightly-review' }), /already exists/);
  // Renaming to its own name is fine.
  assert.equal(store.updateRoutine(other.id, { name: 'other' }).name, 'other');
});

test('getRoutine accepts the uuid or the name', () => {
  const routine = store.createRoutine(definition());
  assert.equal(store.getRoutine(routine.id).id, routine.id);
  assert.equal(store.getRoutine('nightly-review').id, routine.id);
  assert.equal(store.getRoutine('NIGHTLY-REVIEW').id, routine.id);
  assert.equal(store.getRoutine('missing'), null);
});

test('only a prompt change bumps the version; the 50-entry cap keeps the current one', () => {
  const routine = store.createRoutine(definition());
  const untouched = store.updateRoutine(routine.id, { description: 'nightly', enabled: false });
  assert.equal(untouched.promptVersion, 1);
  assert.equal(untouched.versions.length, 1);

  const same = store.updateRoutine(routine.id, { prompt: 'Review the day.' });
  assert.equal(same.promptVersion, 1, 'an identical prompt is not a new version');

  let current = store.updateRoutine(routine.id, { prompt: 'v2' });
  assert.equal(current.promptVersion, 2);
  assert.equal(current.versions.length, 2);

  for (let i = 3; i <= 60; i++) current = store.updateRoutine(routine.id, { prompt: `v${i}` });
  assert.equal(current.promptVersion, 60);
  assert.equal(current.versions.length, store.MAX_VERSIONS);
  assert.equal(current.versions[current.versions.length - 1].version, 60,
    'the current version survives the trim');
  assert.equal(current.versions[current.versions.length - 1].prompt, current.prompt);
  assert.equal(current.versions[0].version, 11, 'the oldest entries are the ones trimmed');
});

test('the ledger is newest-first, capped, and indexable by session id', () => {
  const routine = store.createRoutine(definition());
  const first = store.createInvocation({ routine, trigger: 'invoke', status: 'starting', startedAt: 1000 });
  const second = store.createInvocation({ routine, trigger: 'invoke', status: 'starting', startedAt: 2000 });
  assert.deepEqual(store.readInvocations().map((e) => e.id), [second.id, first.id]);

  store.updateInvocation(first.id, { sessionId: 'sess-a', status: 'completed', endedAt: 1500 });
  store.updateInvocation(second.id, { sessionId: 'sess-a', status: 'running' });
  const bySession = store.invocationsBySessionId();
  assert.equal(bySession.get('sess-a').id, second.id, 'the latest invocation wins a session');

  // durationMs is derived from endedAt when it isn't supplied.
  assert.equal(store.getInvocation(first.id).durationMs, 500);

  // Cap: write past MAX_INVOCATIONS and the oldest fall off.
  const many = [];
  for (let i = 0; i < store.MAX_INVOCATIONS + 5; i++) {
    many.push({ id: `bulk-${i}`, routineId: routine.id, startedAt: 10000 - i, status: 'completed' });
  }
  fs.writeFileSync(path.join(dishDir, 'routine-invocations.json'),
    JSON.stringify({ version: 1, invocations: many }));
  store.createInvocation({ routine, trigger: 'invoke', status: 'starting', startedAt: 99999 });
  const after = store.readInvocations();
  assert.equal(after.length, store.MAX_INVOCATIONS);
  assert.equal(after[0].startedAt, 99999, 'the newest entry is first');
  assert.ok(!after.some((e) => e.id === `bulk-${store.MAX_INVOCATIONS + 4}`), 'the oldest was trimmed');
});

test('deleting a routine keeps its ledger entries', () => {
  const routine = store.createRoutine(definition());
  store.createInvocation({ routine, trigger: 'invoke', status: 'completed' });
  store.deleteRoutine(routine.id);
  assert.equal(store.getRoutine(routine.id), null);
  assert.equal(store.countInvocations(routine.id), 1);
  assert.equal(store.readInvocations()[0].routineName, 'nightly-review', 'the name is denormalized');
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** A live session that behaves like both backends: EventEmitter + prompt/steer. */
class FakeSession extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.turnInProgress = false;
    this.prompts = [];
    this.steers = [];
    this.names = [];
  }
  async prompt(text, opts = {}) { this.prompts.push({ text, opts }); this.turnInProgress = true; }
  async steer(text) { this.steers.push(text); }
  async setName(name) { this.names.push(name); }
  endTurn(text = 'all done') {
    this.emit('message_end', { message: { role: 'assistant', content: [{ type: 'text', text }] } });
    this.turnInProgress = false;
    this.emit('turn_end', {});
  }
}

function harness(overrides = {}) {
  const sessions = new Map();
  const closed = [];
  const created = [];
  const resumed = [];
  let nextId = 1;
  const deps = {
    store,
    createSession: async (spec) => {
      created.push(spec);
      const id = `sess-${nextId++}`;
      sessions.set(id, new FakeSession(id));
      return id;
    },
    resumeSession: async (id) => {
      resumed.push(id);
      sessions.set(id, new FakeSession(id));
      return { id };
    },
    getLiveSession: async (id) => sessions.get(id) || null,
    closeSession: async (id) => { closed.push(id); sessions.delete(id); return { status: 200, body: { success: true } }; },
    composePrompt: (routine, invocation) =>
      routine.prompt + (invocation.input ? `\n<input>${JSON.stringify(invocation.input)}</input>` : ''),
    isTurnInProgress: (sess) => !!sess?.turnInProgress,
    supports: () => true,
    log: { error() {}, warn() {} },
    ...overrides,
  };
  return { runner: createRoutineRunner(deps), sessions, closed, created, resumed, deps };
}

test('invoke spawns, names, prompts, completes and closes a oneShot run', async () => {
  const routine = store.createRoutine(definition({ model: 'test/fake-model', thinking: 'high' }));
  const { runner, sessions, closed, created } = harness();

  const invocation = runner.invoke(routine, { trigger: 'invoke', source: 'cli', input: { pr: 42 } });
  assert.equal(invocation.status, 'starting');
  assert.equal(invocation.trigger, 'invoke');
  assert.equal(invocation.delivery, 'prompt');
  assert.equal(invocation.source, 'cli');
  assert.equal(invocation.version, 1);

  await settleTwice();
  const running = store.getInvocation(invocation.id);
  assert.equal(running.status, 'running');
  assert.equal(running.sessionId, 'sess-1');
  assert.deepEqual(created[0], {
    harness: 'pi', model: 'test/fake-model', thinking: 'high', cwd: '/tmp/work',
  });

  const sess = sessions.get('sess-1');
  assert.match(sess.names[0], /^nightly-review \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(sess.prompts[0].text, /Review the day\./);
  assert.match(sess.prompts[0].text, /"pr": 42|\{"pr":42\}/);

  sess.endTurn('found two issues');
  await settleTwice();
  const done = store.getInvocation(invocation.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.summary, 'found two issues');
  assert.ok(done.endedAt >= done.startedAt);
  assert.equal(typeof done.durationMs, 'number');

  // The close runs after the (zeroed) grace period.
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(closed, ['sess-1']);
  assert.equal(store.getInvocation(invocation.id).closed, true);
  assert.equal(store.getInvocation(invocation.id).closeError, null);
});

test('a refused close records closeError and leaves the session alone', async () => {
  const routine = store.createRoutine(definition());
  const { runner, sessions } = harness({
    closeSession: async () => ({ status: 409, body: { error: 'Closing Prime Agent sessions is not supported' } }),
  });
  const invocation = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  sessions.get('sess-1').endTurn();
  await settleTwice();
  await new Promise((r) => setTimeout(r, 30));
  const done = store.getInvocation(invocation.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.closed, false);
  assert.match(done.closeError, /not supported/);
});

test('an agent_end with no paired turn_end is interrupted', async () => {
  const routine = store.createRoutine(definition({ mode: 'continue' }));
  const { runner, sessions } = harness();
  const invocation = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  sessions.get('sess-1').emit('agent_end', {});
  await new Promise((r) => setTimeout(r, 400));
  const done = store.getInvocation(invocation.id);
  assert.equal(done.status, 'interrupted');
  assert.match(done.error, /without completing/);
});

test('a session that goes away mid-run is interrupted', async () => {
  const routine = store.createRoutine(definition({ mode: 'continue' }));
  const { runner, sessions } = harness();
  const invocation = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  sessions.get('sess-1').emit('exit', { code: 0 });   // RPCSession's spelling
  await settleTwice();
  assert.equal(store.getInvocation(invocation.id).status, 'interrupted');
});

test('busy: skip refuses with 409, steer and followUp deliver into the running session', async () => {
  const routine = store.createRoutine(definition());
  const { runner, sessions, created } = harness();
  const first = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  assert.equal(store.getInvocation(first.id).status, 'running');

  const refused = catchError(() => runner.invoke(routine, { trigger: 'invoke' }));
  assert.equal(refused.status, 409);
  assert.equal(refused.invocation.id, first.id);

  // A scheduled tick never queues into a busy routine — it records a skip.
  const skipped = runner.invoke(routine, { trigger: 'schedule' });
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.skipReason, 'busy');
  assert.equal(skipped.endedAt, skipped.startedAt);

  const steering = store.updateRoutine(routine.id, { onBusy: 'steer' });
  const steered = runner.invoke(steering, { trigger: 'invoke' });
  assert.equal(steered.delivery, 'steer');
  await settleTwice();
  assert.deepEqual(sessions.get('sess-1').steers, ['Review the day.']);
  assert.equal(store.getInvocation(steered.id).sessionId, 'sess-1');
  assert.equal(created.length, 1, 'no second session was spawned');

  // The steered invocation completes at the next turn_end; the first one, whose
  // observers are also still attached, completes there too.
  sessions.get('sess-1').endTurn();
  await settleTwice();
  assert.equal(store.getInvocation(steered.id).status, 'completed');
  assert.equal(store.getInvocation(first.id).status, 'completed');
});

test('followUp delivery uses prompt(deliverAs: followUp)', async () => {
  const routine = store.createRoutine(definition({ onBusy: 'followUp', mode: 'continue' }));
  const { runner, sessions } = harness();
  runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  const second = runner.invoke(routine, { trigger: 'invoke' });
  assert.equal(second.delivery, 'followUp');
  await settleTwice();
  assert.deepEqual(sessions.get('sess-1').prompts[1].opts, { deliverAs: 'followUp' });
});

test('a session that lacks the busy delivery capability errors the invocation', async () => {
  const routine = store.createRoutine(definition({ onBusy: 'steer', mode: 'continue' }));
  const { runner } = harness({ supports: (_sess, capability) => capability !== 'steer' });
  runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  const second = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  const failed = store.getInvocation(second.id);
  assert.equal(failed.status, 'errored');
  assert.match(failed.error, /does not support steer/);
});

test('continue mode reuses a live session, resumes a dead one, and spawns when both fail', async () => {
  const routine = store.createRoutine(definition({ mode: 'continue' }));
  const { runner, sessions, created, resumed, closed } = harness();

  const first = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  sessions.get('sess-1').endTurn();
  await settleTwice();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(closed, [], 'continue mode never auto-closes');

  // Still live: reused.
  const second = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  assert.equal(store.getInvocation(second.id).sessionId, 'sess-1');
  assert.equal(created.length, 1);
  sessions.get('sess-1').endTurn();
  await settleTwice();

  // Gone: resumed through the same dispatch /resume uses.
  sessions.delete('sess-1');
  const third = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  assert.deepEqual(resumed, ['sess-1']);
  assert.equal(store.getInvocation(third.id).sessionId, 'sess-1');
  assert.equal(created.length, 1, 'resume means no new spawn');
  assert.equal(store.getInvocation(first.id).status, 'completed');
});

test('continue mode spawns fresh when the resume fails, without dirtying the record', async () => {
  const routine = store.createRoutine(definition({ mode: 'continue' }));
  const { runner, sessions, created } = harness({
    resumeSession: async () => { throw new Error('Session file not found'); },
  });
  runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  sessions.get('sess-1').endTurn();
  await settleTwice();
  sessions.delete('sess-1');
  const second = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  const record = store.getInvocation(second.id);
  assert.equal(record.sessionId, 'sess-2');
  assert.equal(record.error, null, 'a recovered run is not annotated with the resume failure');
  assert.equal(created.length, 2);
});

test('minIntervalSec rate-limits invokes without recording the rejection', async () => {
  const routine = store.createRoutine(definition({ minIntervalSec: 60, mode: 'continue' }));
  const { runner, sessions } = harness();
  const first = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  sessions.get('sess-1').endTurn();
  await settleTwice();

  const limited = catchError(() => runner.invoke(routine, { trigger: 'invoke' }));
  assert.equal(limited.status, 429);
  assert.ok(limited.retryAfterSec > 0 && limited.retryAfterSec <= 60);
  assert.equal(limited.lastInvocation.id, first.id);
  assert.equal(store.readInvocations().length, 1, 'the rejection is not in the ledger');
});

test('a skipped run does not start the rate-guard clock', () => {
  const routine = store.createRoutine(definition({ minIntervalSec: 60 }));
  const { runner } = harness();
  store.createInvocation({ routine, trigger: 'schedule', status: 'skipped', skipReason: 'busy' });
  assert.doesNotThrow(() => runner.invoke(routine, { trigger: 'invoke' }));
});

test('tick fires a scheduled routine once per minute and never twice', async () => {
  const routine = store.createRoutine(definition({
    schedule: { cron: '*/5 * * * *' }, mode: 'continue',
  }));
  const { runner } = harness();
  const minute = new Date(2026, 8, 3, 9, 5, 0, 0).getTime();

  runner.tick(minute);
  await settleTwice();
  assert.equal(store.countInvocations(routine.id), 1);
  assert.equal(store.readInvocations()[0].trigger, 'schedule');
  assert.equal(store.getRoutine(routine.id).lastScheduledMinute, minute);

  runner.tick(minute + 20000);   // the second 30s tick inside the same minute
  await settleTwice();
  assert.equal(store.countInvocations(routine.id), 1, 'the minute mark suppresses the re-fire');

  // A minute the expression does not match is not a run either.
  runner.tick(new Date(2026, 8, 3, 9, 6, 0, 0).getTime());
  await settleTwice();
  assert.equal(store.countInvocations(routine.id), 1);
});

test('disabled routines never fire on a tick, and a schedule trigger records why', async () => {
  const routine = store.createRoutine(definition({ schedule: { cron: '@hourly' }, enabled: false }));
  const { runner } = harness();
  runner.tick(new Date(2026, 8, 3, 9, 0, 0, 0).getTime());
  await settleTwice();
  assert.equal(store.countInvocations(routine.id), 0);

  const skipped = runner.invoke(routine, { trigger: 'schedule' });
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.skipReason, 'disabled');
});

test('an unparseable schedule is inert rather than fatal', async () => {
  const routine = store.createRoutine(definition({ schedule: { cron: '@hourly' } }));
  // Corrupt it behind the store's validation, the way a hand-edited file would.
  const raw = JSON.parse(fs.readFileSync(path.join(dishDir, 'routines.json'), 'utf8'));
  raw.routines[routine.id].schedule = { cron: 'nonsense' };
  fs.writeFileSync(path.join(dishDir, 'routines.json'), JSON.stringify(raw));
  const { runner } = harness();
  assert.doesNotThrow(() => runner.tick(Date.now()));
  assert.equal(runner.nextRunAt(store.getRoutine(routine.id)), null);
  assert.equal(store.countInvocations(routine.id), 0);
});

test('nextRunAt reports the next matching minute, and null without a schedule', () => {
  const { runner } = harness();
  const scheduled = store.createRoutine(definition({ schedule: { cron: '30 9 * * *' } }));
  const from = new Date(2026, 8, 3, 10, 0, 0, 0).getTime();
  assert.equal(runner.nextRunAt(scheduled, from), new Date(2026, 8, 4, 9, 30, 0, 0).getTime());
  assert.equal(runner.nextRunAt(store.createRoutine(definition({ name: 'manual' }))), null);
});

test('the starting watchdog errors a spawn that never became live', async () => {
  const routine = store.createRoutine(definition());
  const { runner } = harness({
    // A createSession that never settles is exactly the hung-spawn case.
    createSession: () => new Promise(() => {}),
  });
  const invocation = runner.invoke(routine, { trigger: 'invoke' });
  await settleTwice();
  assert.equal(store.getInvocation(invocation.id).status, 'starting');

  runner.tick(invocation.startedAt + STARTING_WATCHDOG_MS - 1000);
  assert.equal(store.getInvocation(invocation.id).status, 'starting', 'not yet');

  runner.tick(invocation.startedAt + STARTING_WATCHDOG_MS + 1);
  const errored = store.getInvocation(invocation.id);
  assert.equal(errored.status, 'errored');
  assert.match(errored.error, /did not start within/);

  // A long *running* turn is never watchdogged.
  const long = store.createInvocation({ routine, trigger: 'invoke', status: 'running', startedAt: 0 });
  runner.tick(STARTING_WATCHDOG_MS * 10);
  assert.equal(store.getInvocation(long.id).status, 'running');
});

test('restart recovery reconciles starting, live-idle, live-working and gone runs', async () => {
  const oneShot = store.createRoutine(definition());
  const continued = store.createRoutine(definition({ name: 'continued', mode: 'continue' }));

  const starting = store.createInvocation({ routine: oneShot, trigger: 'invoke', status: 'starting' });
  const idle = store.createInvocation({ routine: oneShot, trigger: 'invoke', status: 'starting' });
  store.updateInvocation(idle.id, { status: 'running', sessionId: 'live-idle' });
  const working = store.createInvocation({ routine: continued, trigger: 'invoke', status: 'starting' });
  store.updateInvocation(working.id, { status: 'running', sessionId: 'live-working' });
  const gone = store.createInvocation({ routine: continued, trigger: 'invoke', status: 'starting' });
  store.updateInvocation(gone.id, { status: 'running', sessionId: 'vanished' });

  const live = new Map();
  live.set('live-idle', new FakeSession('live-idle'));
  const busy = new FakeSession('live-working');
  busy.turnInProgress = true;
  live.set('live-working', busy);

  const closed = [];
  const { runner } = harness({
    getLiveSession: async (id) => live.get(id) || null,
    closeSession: async (id) => { closed.push(id); return { status: 200, body: { success: true } }; },
  });
  await runner.recoverAfterRestart(Date.now());

  assert.equal(store.getInvocation(starting.id).status, 'errored');
  assert.match(store.getInvocation(starting.id).error, /pi-dish restarted/);
  assert.equal(store.getInvocation(gone.id).status, 'interrupted');
  assert.match(store.getInvocation(gone.id).error, /pi-dish restarted/);

  const recovered = store.getInvocation(idle.id);
  assert.equal(recovered.status, 'completed', 'a live but idle session finished while we were down');
  assert.equal(recovered.summary, null);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(closed, ['live-idle'], 'the oneShot close path still runs');

  // The still-working one is re-observed, so its turn_end lands in the ledger.
  assert.equal(store.getInvocation(working.id).status, 'running');
  busy.endTurn('resumed and finished');
  await settleTwice();
  const finished = store.getInvocation(working.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.summary, 'resumed and finished');
  assert.deepEqual(closed, ['live-idle'], 'continue mode is still never auto-closed');
});

test('input larger than the cap is refused before anything is recorded', () => {
  const routine = store.createRoutine(definition());
  const { runner } = harness();
  const huge = { blob: 'x'.repeat(store.MAX_INPUT_BYTES + 100) };
  const error = catchError(() => runner.invoke(routine, { trigger: 'invoke', input: huge }));
  assert.equal(error.status, 413);
  assert.equal(store.countInvocations(routine.id), 0);
});
