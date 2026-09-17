// Generated tool from test/routines.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for lib/routines.js (the store) and lib/routine-runner.js (the
 * lifecycle) with fake deps — no spawn backend; one owned loopback HTTP fixture.
 *
 * HOME points at a temp dir so the two JSON stores are per-test state; the
 * store re-reads per call, so simply emptying the files between tests is
 * enough to isolate them.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const originalHome = process.env.HOME;
const originalCloseGrace = process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-routines-test-'));
process.env.HOME = tmpHome;
// The runner reads the grace at close time; ~0 keeps the oneShot close
// assertions from waiting ten real seconds.
process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS = '0';
const store = require('../lib/routines.js');
const { createRoutineRunner, STARTING_WATCHDOG_MS } = require('../lib/routine-runner.js');
const { BridgeSession } = require('../lib/bridge-session.js');
const { validSessionId } = require('../lib/session-key.js');
const { isRecord } = require('../lib/wire-protocol.js');
const runners = new Set();
test.after(() => {
    for (const runner of runners)
        runner.stop();
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (originalHome === undefined)
        delete process.env.HOME;
    else
        process.env.HOME = originalHome;
    if (originalCloseGrace === undefined)
        delete process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS;
    else
        process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS = originalCloseGrace;
});
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
    try {
        fn();
    }
    catch (error) {
        assert.ok(error instanceof Error && 'status' in error);
        return error;
    }
    throw new assert.AssertionError({ message: 'expected the call to throw' });
}
const settleTwice = async () => { await settle(); await settle(); await settle(); };
function existingInvocation(id) {
    const entry = store.getInvocation(id);
    assert.ok(entry);
    return entry;
}
function updateRoutine(ref, patch) {
    const routine = store.updateRoutine(ref, patch);
    assert.ok(routine);
    return routine;
}
// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
test('validation rejects bad names, cwds, prompts, enums and cron', () => {
    const bad = [
        [{ name: 'Nightly' }, 'name'],
        [{ name: '-leading' }, 'name'],
        [{ name: 'a'.repeat(49) }, 'name'],
        [{ cwd: 'relative/path' }, 'cwd'],
        [{ cwd: undefined }, 'cwd'],
        [{ prompt: '' }, 'prompt'],
        [{ prompt: 'x'.repeat(store.MAX_PROMPT + 1) }, 'prompt'],
        [{ harness: 'nope' }, 'harness'],
        [{ mode: 'loop' }, 'mode'],
        [{ onBusy: 'queue' }, 'onBusy'],
        [{ thinking: 'ultra' }, 'thinking'],
        [{ minIntervalSec: -1 }, 'minIntervalSec'],
        [{ minIntervalSec: 1.5 }, 'minIntervalSec'],
        [{ schedule: { cron: 'every day' } }, 'schedule'],
        [{ description: 'x'.repeat(501) }, 'description'],
    ];
    for (const [over, field] of bad) {
        const error = catchError(() => store.createRoutine(definition(over)));
        assert.equal(error.status, 400, JSON.stringify(over));
        assert.ok(error.message.toLowerCase().includes(field.toLowerCase()));
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
    assert.equal(catchError(() => updateRoutine(other.id, { name: 'nightly-review' })).status, 409);
    // Renaming to its own name is fine.
    assert.equal(updateRoutine(other.id, { name: 'other' }).name, 'other');
});
test('getRoutine accepts the uuid or the name', () => {
    const routine = store.createRoutine(definition());
    assert.equal(store.getRoutine(routine.id)?.id, routine.id);
    assert.equal(store.getRoutine('nightly-review')?.id, routine.id);
    assert.equal(store.getRoutine('NIGHTLY-REVIEW')?.id, routine.id);
    assert.equal(store.getRoutine('missing'), null);
});
test('only a prompt change bumps the version; the 50-entry cap keeps the current one', () => {
    const routine = store.createRoutine(definition());
    const untouched = updateRoutine(routine.id, { description: 'nightly', enabled: false });
    assert.equal(untouched.promptVersion, 1);
    assert.ok(Array.isArray(untouched.versions));
    assert.equal(untouched.versions.length, 1);
    const same = updateRoutine(routine.id, { prompt: 'Review the day.' });
    assert.equal(same.promptVersion, 1, 'an identical prompt is not a new version');
    let current = updateRoutine(routine.id, { prompt: 'v2' });
    assert.equal(current.promptVersion, 2);
    assert.ok(Array.isArray(current.versions));
    assert.equal(current.versions.length, 2);
    for (let i = 3; i <= 60; i++)
        current = updateRoutine(routine.id, { prompt: `v${i}` });
    assert.equal(current.promptVersion, 60);
    assert.ok(Array.isArray(current.versions));
    assert.equal(current.versions.length, store.MAX_VERSIONS);
    const newest = current.versions[current.versions.length - 1];
    const oldest = current.versions[0];
    assert.ok(isRecord(newest) && isRecord(oldest));
    assert.equal(newest.version, 60, 'the current version survives the trim');
    assert.equal(newest.prompt, current.prompt);
    assert.equal(oldest.version, 11, 'the oldest entries are the ones trimmed');
});
test('the ledger is newest-first, capped, and indexable by session id', () => {
    const routine = store.createRoutine(definition());
    const first = store.createInvocation({ routine, trigger: 'invoke', status: 'starting', startedAt: 1000 });
    const second = store.createInvocation({ routine, trigger: 'invoke', status: 'starting', startedAt: 2000 });
    assert.deepEqual(store.readInvocations().map((e) => e.id), [second.id, first.id]);
    store.updateInvocation(first.id, { sessionId: 'sess-a', status: 'completed', endedAt: 1500 });
    store.updateInvocation(second.id, { sessionId: 'sess-a', status: 'running' });
    const bySession = store.invocationsBySessionId();
    assert.equal(bySession.get('sess-a')?.id, second.id, 'the latest invocation wins a session');
    // durationMs is derived from endedAt when it isn't supplied.
    assert.equal(existingInvocation(first.id).durationMs, 500);
    // Cap: write past MAX_INVOCATIONS and the oldest fall off.
    const many = [];
    for (let i = 0; i < store.MAX_INVOCATIONS + 5; i++) {
        many.push({ id: `bulk-${i}`, routineId: routine.id, startedAt: 10000 - i, status: 'completed' });
    }
    fs.writeFileSync(path.join(dishDir, 'routine-invocations.json'), JSON.stringify({ version: 1, invocations: many }));
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
test('external partial records keep their fields and native version arithmetic across updates', () => {
    const saved = { id: 'external', name: 42, prompt: 'old', promptVersion: '2', versions: [], extra: { retained: true } };
    fs.writeFileSync(path.join(dishDir, 'routines.json'), JSON.stringify({
        routines: { external: saved, wrongKey: { id: 'other' } },
    }));
    assert.deepEqual(store.listRoutines(), [saved]);
    const updated = updateRoutine('external', { prompt: 'new' });
    assert.equal(updated.promptVersion, '21');
    assert.deepEqual(updated.versions, [{ version: '21', prompt: 'new', savedAt: updated.updatedAt }]);
    assert.deepEqual(updated.extra, saved.extra);
    assert.equal(updated.name, 42);
    const run = { id: 'external-run', routineId: 'external', startedAt: '100', status: 'running', extra: 'kept' };
    fs.writeFileSync(path.join(dishDir, 'routine-invocations.json'), JSON.stringify({ invocations: [run, { id: 1 }] }));
    assert.deepEqual(store.readInvocations(), [run]);
    const completed = store.updateInvocation(run.id, { status: 'completed', endedAt: '150', extra: 'ignored' });
    assert.ok(completed);
    assert.equal(completed.durationMs, 50);
    assert.equal(completed.endedAt, '150');
    assert.equal(completed.extra, 'kept');
});
test('direct ledger admission retains validation order and rejects without persisting', () => {
    const routine = store.createRoutine(definition());
    const input = { blob: 'x'.repeat(store.MAX_INPUT_BYTES) };
    const cases = [
        [{ status: 'bad', source: 42, input }, 400, /routine/],
        [{ routine, status: 'bad', source: 42, input }, 400, /status/],
        [{ routine, status: 'starting', source: 42, input }, 400, /source/],
        [{ routine, status: 'starting', input }, 413, /input/],
    ];
    for (const [fields, status, message] of cases) {
        const error = catchError(() => store.createInvocation(fields));
        assert.equal(error.status, status);
        assert.match(error.message, message);
    }
    const cyclic = {};
    cyclic.self = cyclic;
    for (const value of [cyclic, 1n, Symbol('input'), () => null]) {
        assert.throws(() => store.createInvocation({ routine, status: 'starting', input: value }), TypeError);
    }
    assert.deepEqual(store.readInvocations(), []);
    const accepted = store.createInvocation({ routine, status: 'completed', source: 'line\nbreak', input: null });
    assert.equal(existingInvocation(accepted.id).source, 'line\nbreak', 'HTTP framing policy is not a ledger policy');
});
test('input cap counts UTF-8 bytes and includes JSON string quotes', () => {
    const routine = store.createRoutine(definition());
    const input = 'é'.repeat((store.MAX_INPUT_BYTES - 2) / 2);
    const accepted = store.createInvocation({ routine, status: 'completed', input });
    assert.equal(existingInvocation(accepted.id).input, input);
    const error = catchError(() => store.createInvocation({ routine, status: 'completed', input: input + 'a' }));
    assert.equal(error.status, 413);
    assert.deepEqual(store.readInvocations().map(row => row.id), [accepted.id]);
});
test('admission owns its original input and rejects forged size receipts as raw input', () => {
    const routine = store.createRoutine(definition());
    const input = { note: 'before' };
    const admission = store.RoutineInputAdmission.prepare(input);
    assert.ok(admission);
    const huge = { blob: 'x'.repeat(store.MAX_INPUT_BYTES) };
    const prototypeForgery = Object.assign(Object.create(Object.getPrototypeOf(admission)), { input: huge, size: 0 });
    for (const forged of [{ input: huge, size: 0 }, prototypeForgery]) {
        const error = catchError(() => store.createInvocation({ routine, status: 'completed', input: forged }));
        assert.equal(error.status, 413);
    }
    assert.deepEqual(store.readInvocations(), []);
    input.note = 'after';
    Object.assign(admission, { input: huge, size: 0 });
    const accepted = store.createInvocation({ routine, status: 'completed', input: admission });
    assert.equal(accepted.input, input, 'the genuine private slot, not public lookalike fields, owns input');
    assert.deepEqual(existingInvocation(accepted.id).input, { note: 'after' }, 'measurement is not a normalized snapshot');
});
// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
/** Native, unconnected session shape with only the consumed fake delivery methods. */
class FakeSession extends BridgeSession {
    prompts = [];
    steers = [];
    names = [];
    constructor(id) {
        assert.ok(validSessionId(id));
        super({ sessionId: id, socketPath: path.join(tmpHome, 'unused.sock'), harnessId: 'pi' });
        this.alive = true;
    }
    async prompt(text, opts = {}) {
        this.prompts.push({ text, opts });
        this.turnInProgress = true;
    }
    async steer(text) { this.steers.push(text); }
    async setName(name) { this.names.push(name); }
    endTurn(text = 'all done') {
        this.emit('message_end', { message: { role: 'assistant', content: [{ type: 'text', text }] } });
        this.turnInProgress = false;
        this.emit('turn_end', {});
    }
}
function existingSession(sessions, id) {
    const session = sessions.get(id);
    assert.ok(session);
    return session;
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
            assert.ok(validSessionId(id));
            sessions.set(id, new FakeSession(id));
            return { success: true, id };
        },
        getLiveSession: async (id) => sessions.get(id) || null,
        closeSession: async (id) => { closed.push(id); sessions.delete(id); return { status: 200, body: { success: true } }; },
        composePrompt: (routine, invocation) => routine.prompt + (invocation.input ? `\n<input>${JSON.stringify(invocation.input)}</input>` : ''),
        isTurnInProgress: (sess) => !!sess?.turnInProgress,
        supports: () => true,
        log: { error() { }, warn() { } },
        ...overrides,
    };
    const runner = createRoutineRunner(deps);
    runners.add(runner);
    return { runner, sessions, closed, created, resumed, deps };
}
test('invoke spawns, names, prompts, completes and closes a oneShot run', async () => {
    const routine = store.createRoutine(definition());
    const { runner, sessions, closed } = harness();
    const invocation = runner.invoke(routine, { trigger: 'invoke', source: 'cli', input: { pr: 42 } });
    assert.equal(invocation.status, 'starting');
    assert.equal(invocation.trigger, 'invoke');
    assert.equal(invocation.delivery, 'prompt');
    assert.equal(invocation.source, 'cli');
    assert.equal(invocation.version, 1);
    await settleTwice();
    const running = existingInvocation(invocation.id);
    assert.equal(running.status, 'running');
    assert.equal(running.sessionId, 'sess-1');
    const sess = existingSession(sessions, 'sess-1');
    assert.match(sess.names[0], /^nightly-review \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.match(sess.prompts[0].text, /Review the day\./);
    assert.match(sess.prompts[0].text, /"pr": 42|\{"pr":42\}/);
    sess.endTurn('found two issues');
    await settleTwice();
    const done = existingInvocation(invocation.id);
    assert.equal(done.status, 'completed');
    assert.equal(done.summary, 'found two issues');
    assert.ok(typeof done.endedAt === 'number' && typeof done.startedAt === 'number');
    assert.ok(done.endedAt >= done.startedAt);
    assert.equal(typeof done.durationMs, 'number');
    // The close runs after the (zeroed) grace period.
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(closed, ['sess-1']);
    assert.equal(existingInvocation(invocation.id).closed, true);
    assert.equal(existingInvocation(invocation.id).closeError, null);
});
test('a refused close records closeError and leaves the session alone', async () => {
    const routine = store.createRoutine(definition());
    const { runner, sessions } = harness({
        closeSession: async () => ({ status: 409, body: { error: 'fixture close refused' } }),
    });
    const invocation = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    existingSession(sessions, 'sess-1').endTurn();
    await settleTwice();
    await new Promise((r) => setTimeout(r, 30));
    const done = existingInvocation(invocation.id);
    assert.equal(done.status, 'completed');
    assert.equal(done.closed, false);
    assert.equal(done.closeError, 'fixture close refused');
    assert.ok(sessions.has('sess-1'));
});
test('an agent_end with no paired turn_end is interrupted', async () => {
    const routine = store.createRoutine(definition({ mode: 'continue' }));
    const { runner, sessions } = harness();
    const invocation = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    existingSession(sessions, 'sess-1').emit('agent_end', {});
    await new Promise((r) => setTimeout(r, 400));
    const done = existingInvocation(invocation.id);
    assert.equal(done.status, 'interrupted');
});
test('a session that goes away mid-run is interrupted', async () => {
    const routine = store.createRoutine(definition({ mode: 'continue' }));
    const { runner, sessions } = harness();
    const invocation = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    existingSession(sessions, 'sess-1').emit('exit', { code: 0 }); // RPCSession's spelling
    await settleTwice();
    assert.equal(existingInvocation(invocation.id).status, 'interrupted');
});
test('busy: skip refuses with 409, steer and followUp deliver into the running session', async () => {
    const routine = store.createRoutine(definition());
    const { runner, sessions, created } = harness();
    const first = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    assert.equal(existingInvocation(first.id).status, 'running');
    const refused = catchError(() => runner.invoke(routine, { trigger: 'invoke', source: 42 }));
    assert.equal(refused.status, 409);
    assert.ok('invocation' in refused && isRecord(refused.invocation));
    assert.equal(refused.invocation.id, first.id);
    // A scheduled tick never queues into a busy routine — it records a skip.
    const skipped = runner.invoke(routine, { trigger: 'schedule' });
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.skipReason, 'busy');
    assert.equal(skipped.endedAt, skipped.startedAt);
    const steering = updateRoutine(routine.id, { onBusy: 'steer' });
    const steered = runner.invoke(steering, { trigger: 'invoke' });
    assert.equal(steered.delivery, 'steer');
    await settleTwice();
    assert.deepEqual(existingSession(sessions, 'sess-1').steers, ['Review the day.']);
    assert.equal(existingInvocation(steered.id).sessionId, 'sess-1');
    assert.equal(created.length, 1, 'no second session was spawned');
    // The steered invocation completes at the next turn_end; the first one, whose
    // observers are also still attached, completes there too.
    existingSession(sessions, 'sess-1').endTurn();
    await settleTwice();
    assert.equal(existingInvocation(steered.id).status, 'completed');
    assert.equal(existingInvocation(first.id).status, 'completed');
});
test('followUp delivery uses prompt(deliverAs: followUp)', async () => {
    const routine = store.createRoutine(definition({ onBusy: 'followUp', mode: 'continue' }));
    const { runner, sessions } = harness();
    runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    const second = runner.invoke(routine, { trigger: 'invoke' });
    assert.equal(second.delivery, 'followUp');
    await settleTwice();
    assert.deepEqual(existingSession(sessions, 'sess-1').prompts[1].opts, { deliverAs: 'followUp' });
});
test('a session that lacks the busy delivery capability errors the invocation', async () => {
    const routine = store.createRoutine(definition({ onBusy: 'steer', mode: 'continue' }));
    const { runner } = harness({ supports: (_sess, capability) => capability !== 'steer' });
    runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    const second = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    const failed = existingInvocation(second.id);
    assert.equal(failed.status, 'errored');
    assert.ok(typeof failed.error === 'string');
    assert.match(failed.error, /\bsteer\b/);
});
test('continue mode reuses a live session, resumes a dead one, and spawns when both fail', async () => {
    const routine = store.createRoutine(definition({ mode: 'continue' }));
    const { runner, sessions, created, resumed, closed } = harness();
    const first = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    existingSession(sessions, 'sess-1').endTurn();
    await settleTwice();
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(closed, [], 'continue mode never auto-closes');
    // Still live: reused.
    const second = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    assert.equal(existingInvocation(second.id).sessionId, 'sess-1');
    assert.equal(created.length, 1);
    existingSession(sessions, 'sess-1').endTurn();
    await settleTwice();
    // Gone: resumed through the same dispatch /resume uses.
    sessions.delete('sess-1');
    const third = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    assert.deepEqual(resumed, ['sess-1']);
    assert.equal(existingInvocation(third.id).sessionId, 'sess-1');
    assert.equal(created.length, 1, 'resume means no new spawn');
    assert.equal(existingInvocation(first.id).status, 'completed');
});
test('continue mode spawns fresh when the resume fails, without dirtying the record', async () => {
    const routine = store.createRoutine(definition({ mode: 'continue' }));
    const { runner, sessions, created } = harness({
        resumeSession: async () => { throw new Error('Session file not found'); },
    });
    runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    existingSession(sessions, 'sess-1').endTurn();
    await settleTwice();
    sessions.delete('sess-1');
    const second = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    const record = existingInvocation(second.id);
    assert.equal(record.sessionId, 'sess-2');
    assert.equal(record.error, null, 'a recovered run is not annotated with the resume failure');
    assert.equal(created.length, 2);
});
test('minIntervalSec rate-limits invokes without recording the rejection', async () => {
    const routine = store.createRoutine(definition({ minIntervalSec: 60, mode: 'continue' }));
    const { runner, sessions } = harness();
    const first = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    existingSession(sessions, 'sess-1').endTurn();
    await settleTwice();
    const limited = catchError(() => runner.invoke(routine, { trigger: 'invoke', source: 42 }));
    assert.equal(limited.status, 429);
    assert.ok('retryAfterSec' in limited && typeof limited.retryAfterSec === 'number');
    assert.ok(limited.retryAfterSec > 0 && limited.retryAfterSec <= 60);
    assert.ok('lastInvocation' in limited && isRecord(limited.lastInvocation));
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
    assert.equal(store.getRoutine(routine.id)?.lastScheduledMinute, minute);
    runner.tick(minute + 20000); // the second 30s tick inside the same minute
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
    assert.ok(isRecord(raw) && isRecord(raw.routines));
    const storedRoutine = raw.routines[routine.id];
    assert.ok(isRecord(storedRoutine));
    storedRoutine.schedule = { cron: 'nonsense' };
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
        createSession: () => new Promise(() => { }),
    });
    const invocation = runner.invoke(routine, { trigger: 'invoke' });
    await settleTwice();
    assert.equal(existingInvocation(invocation.id).status, 'starting');
    assert.ok(typeof invocation.startedAt === 'number');
    runner.tick(invocation.startedAt + STARTING_WATCHDOG_MS - 1000);
    assert.equal(existingInvocation(invocation.id).status, 'starting', 'not yet');
    runner.tick(invocation.startedAt + STARTING_WATCHDOG_MS + 1);
    const errored = existingInvocation(invocation.id);
    assert.equal(errored.status, 'errored');
    // A long *running* turn is never watchdogged.
    const long = store.createInvocation({ routine, trigger: 'invoke', status: 'running', startedAt: 0 });
    runner.tick(STARTING_WATCHDOG_MS * 10);
    assert.equal(existingInvocation(long.id).status, 'running');
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
    assert.equal(existingInvocation(starting.id).status, 'errored');
    assert.equal(existingInvocation(gone.id).status, 'interrupted');
    const recovered = existingInvocation(idle.id);
    assert.equal(recovered.status, 'completed', 'a live but idle session finished while we were down');
    assert.equal(recovered.summary, null);
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(closed, ['live-idle'], 'the oneShot close path still runs');
    // The still-working one is re-observed, so its turn_end lands in the ledger.
    assert.equal(existingInvocation(working.id).status, 'running');
    busy.endTurn('resumed and finished');
    await settleTwice();
    const finished = existingInvocation(working.id);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.summary, 'resumed and finished');
    assert.deepEqual(closed, ['live-idle'], 'continue mode is still never auto-closed');
});
test('restored idle and uncertain routine sessions stay interrupted rather than auto-closing', async () => {
    const routine = store.createRoutine(definition());
    const { runner, sessions, closed, created, resumed } = harness({
        recoveryOutcome: id => ({ status: id === 'restored' ? 'restored' : 'needs-review', reason: 'Inspect interrupted work' }),
    });
    const invocations = ['restored', 'uncertain'].map(id => {
        sessions.set(id, new FakeSession(id));
        const invocation = store.createInvocation({ routine, trigger: 'invoke', status: 'starting' });
        store.updateInvocation(invocation.id, { status: 'running', sessionId: id });
        return invocation;
    });
    await runner.recoverAfterRestart();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(invocations.map(invocation => existingInvocation(invocation.id).status), ['interrupted', 'interrupted']);
    assert.deepEqual(closed, []);
    assert.deepEqual(created, []);
    assert.deepEqual(resumed, []);
});
test('continued recovery observes the existing routine invocation without creating a new one', async () => {
    const routine = store.createRoutine(definition({ mode: 'continue' }));
    const { runner, sessions, created, resumed } = harness({ recoveryOutcome: () => ({ status: 'continued', reason: undefined }) });
    const live = new FakeSession('recovered');
    live.turnInProgress = true;
    sessions.set(live.id, live);
    const invocation = store.createInvocation({ routine, trigger: 'invoke', status: 'starting' });
    store.updateInvocation(invocation.id, { status: 'running', sessionId: live.id });
    await runner.recoverAfterRestart();
    live.endTurn('reconciled external state');
    assert.equal(existingInvocation(invocation.id).status, 'completed');
    assert.equal(store.countInvocations(routine.id), 1);
    assert.deepEqual(created, []);
    assert.deepEqual(resumed, []);
    assert.deepEqual(live.prompts, []);
});
test('input larger than the cap is refused before anything is recorded', () => {
    const routine = store.createRoutine(definition());
    const { runner } = harness();
    const huge = { blob: 'x'.repeat(store.MAX_INPUT_BYTES + 100) };
    const error = catchError(() => runner.invoke(routine, { trigger: 'invoke', input: huge }));
    assert.equal(error.status, 413);
    assert.equal(store.countInvocations(routine.id), 0);
});
test('admission measures the first toJSON value without normalizing later persistence', () => {
    const routine = store.createRoutine(definition());
    const { runner } = harness({ createSession: () => new Promise(() => { }) });
    let value = { note: 'admission' };
    const later = { blob: 'x'.repeat(store.MAX_INPUT_BYTES) };
    const input = { toJSON() { const current = value; value = later; return current; } };
    try {
        const invocation = runner.invoke(routine, { input });
        assert.equal(invocation.input, input);
        assert.deepEqual(existingInvocation(invocation.id).input, later, 'persistence still serializes the original object after the single admission observation');
    }
    finally {
        runner.stop();
    }
});
test('HTTP input admission retains JSON 413 versus native serialization rejection ownership', async () => {
    const { createRoutineHandlers } = require('../lib/routine-handlers.js');
    const routine = store.createRoutine(definition());
    const { runner } = harness();
    const handlers = createRoutineHandlers({ runner, validateHarnessPilotSelection: async () => { } });
    const app = express();
    const nativeErrors = [];
    const fixtureErrorStatus = 599;
    let injectedInput;
    // These raw JavaScript values cannot all traverse JSON wire encoding.
    const injectInput = (req, _res, next) => {
        req.body = { input: injectedInput, source: 42 };
        next();
    };
    const forwardInvocation = (req, res, next) => {
        // Express4 does not forward rejected handler promises automatically.
        void Promise.resolve(handlers.invoke(req, res, next)).catch(next);
    };
    const observeNativeFailure = (error, _req, res, _next) => {
        nativeErrors.push(error);
        res.status(fixtureErrorStatus).end();
    };
    app.post('/routines/:id/invoke', injectInput, forwardInvocation);
    app.use(observeNativeFailure);
    const server = http.createServer(app);
    const cyclic = {};
    cyclic.self = cyclic;
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const invoke = (input) => {
            injectedInput = input;
            return fetch(`http://127.0.0.1:${address.port}/routines/${encodeURIComponent(routine.id)}/invoke`, { method: 'POST' });
        };
        for (const input of [cyclic, 1n, Symbol('input'), () => null]) {
            const before = nativeErrors.length;
            const response = await invoke(input);
            assert.equal(response.status, fixtureErrorStatus, 'native failures reach the fixture error boundary');
            await response.arrayBuffer();
            assert.equal(nativeErrors.length, before + 1);
            assert.ok(nativeErrors[before] instanceof TypeError);
        }
        assert.deepEqual(store.readInvocations(), []);
        const failuresBeforeOversize = nativeErrors.length;
        const response = await invoke({ blob: 'x'.repeat(store.MAX_INPUT_BYTES) });
        assert.equal(response.status, 413, 'the actual route rejects size before invalid source42');
        const payload = await response.json();
        assert.ok(isRecord(payload) && typeof payload.error === 'string');
        assert.equal(nativeErrors.length, failuresBeforeOversize, '413 is handled by the route, not the fixture error boundary');
        assert.deepEqual(store.readInvocations(), []);
    }
    finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(() => resolve()));
        runner.stop();
    }
});
