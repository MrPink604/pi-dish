// Generated tool from test/session-bounces.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const session_bounces_1 = require("../lib/session-bounces");
const session_discovery_1 = require("../lib/session-discovery");
const bridge_session_1 = require("../lib/bridge-session");
const session_key_1 = require("../lib/session-key");
const tmux = require("../lib/tmux");
function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    assert.ok(resolve);
    return { promise, resolve };
}
function fixture(overrides = {}) {
    const runtime = { generation: 1, blockers: ['Working'], eligible: true };
    const actions = [];
    const scheduler = (0, session_bounces_1.createSessionBounces)({
        catalog: () => [{ id: 'parent', name: 'Parent', harnessId: 'omp' }],
        capture: () => ({ generation: runtime.generation }),
        inspect: async (authority) => authority.generation === runtime.generation
            ? { eligible: runtime.eligible, reason: 'Ownership lost', blockers: runtime.blockers }
            : { eligible: false, reason: 'Runtime replaced', blockers: [] },
        execute: async (authority) => { actions.push(authority.generation); return { replacementId: 'replacement' }; },
        ...overrides,
    });
    return { scheduler, runtime, actions };
}
test('waiting targets execute only once after blockers clear; duplicates and unknown IDs grant no authority', async () => {
    const { scheduler, runtime, actions } = fixture();
    const first = scheduler.enqueue('restart', ['parent']);
    const duplicate = scheduler.enqueue('reload', ['parent', 'unknown']);
    assert.deepEqual(duplicate.targets.map(t => t.status), ['skipped', 'skipped']);
    await scheduler.tick();
    assert.deepEqual(actions, []);
    const waiting = (await scheduler.list()).find(op => op.id === first.id);
    assert.ok(waiting);
    const reason = waiting.targets[0].reason;
    assert.ok(typeof reason === 'string');
    assert.match(reason, /Working/);
    runtime.blockers = [];
    await scheduler.tick();
    await scheduler.tick();
    assert.deepEqual(actions, [1]);
    const completed = (await scheduler.list()).find(op => op.id === first.id);
    assert.ok(completed);
    const result = completed.targets[0];
    assert.equal(result.status, 'completed');
    assert.equal(result.replacementId, 'replacement');
});
test('replaced runtime and revoked ownership are skipped, never inherited by queued work', async () => {
    const { scheduler, runtime, actions } = fixture();
    scheduler.enqueue('restart', ['parent']);
    runtime.generation++;
    runtime.blockers = [];
    await scheduler.tick();
    assert.equal((await scheduler.list())[0].targets[0].status, 'skipped');
    scheduler.enqueue('restart', ['parent']);
    runtime.eligible = false;
    await scheduler.tick();
    assert.equal((await scheduler.list())[0].targets[0].status, 'skipped');
    assert.deepEqual(actions, []);
});
test('cancel wins while safety inspection is awaiting, but never interrupts executing work', async () => {
    const inspection = deferred();
    const started = deferred();
    const finish = deferred();
    let executeCount = 0;
    const { scheduler } = fixture({
        inspect: () => inspection.promise,
        execute: async () => { executeCount++; started.resolve(); await finish.promise; },
    });
    const first = scheduler.enqueue('restart', ['parent']);
    const tick = scheduler.tick();
    const cancelled = scheduler.cancel(first.id);
    assert.ok(cancelled);
    assert.equal(cancelled.targets[0].status, 'cancelled');
    inspection.resolve({ eligible: true, blockers: [] });
    await tick;
    assert.equal(executeCount, 0);
    const second = scheduler.enqueue('restart', ['parent']);
    const secondTick = scheduler.tick();
    await started.promise;
    const executing = scheduler.cancel(second.id);
    assert.ok(executing);
    assert.equal(executing.targets[0].status, 'executing');
    const concurrentTick = scheduler.tick();
    finish.resolve();
    await Promise.all([secondTick, concurrentTick]);
    assert.equal(executeCount, 1);
});
test('failures are terminal without duplicate retries; explicit pre-action busy refusal returns to waiting', async () => {
    let attempts = 0;
    const { scheduler, runtime } = fixture({ execute: async () => {
            attempts++;
            if (attempts === 1)
                return { waiting: true, reason: 'New turn arrived' };
            throw new Error('Replacement failed to register');
        } });
    runtime.blockers = [];
    scheduler.enqueue('restart', ['parent']);
    await scheduler.tick();
    assert.equal((await scheduler.list())[0].targets[0].status, 'waiting');
    await scheduler.tick();
    await scheduler.tick();
    assert.equal(attempts, 2);
    assert.equal((await scheduler.list())[0].targets[0].status, 'failed');
});
test('operation retention is bounded without evicting pending authority', async () => {
    const { scheduler, runtime } = fixture({ maxOperations: 2 });
    scheduler.enqueue('restart', ['parent']);
    scheduler.enqueue('restart', ['unknown']);
    scheduler.enqueue('restart', ['other']);
    assert.equal((await scheduler.list()).length, 2);
    runtime.blockers = [];
    await scheduler.tick();
    scheduler.enqueue('restart', ['parent']);
    assert.equal((await scheduler.list()).length, 2);
    assert.throws(() => scheduler.enqueue('force', ['parent']), /mode/);
});
test('unknown activity, dialogs mid-turn, queued input and background jobs all block idle safety', () => {
    const sessionId = 'parent';
    assert.ok((0, session_key_1.validSessionId)(sessionId));
    const live = new bridge_session_1.BridgeSession({ sessionId, socketPath: '/unused-lifecycle' });
    live.alive = true;
    live.turnInProgress = false;
    live.compacting = false;
    const state = { turnInProgress: false, compacting: false,
        lifecycle: { idle: true, pendingMessages: false, pendingDialogs: 0, backgroundWork: false } };
    assert.deepEqual((0, session_bounces_1.lifecycleBlockers)(state, live), []);
    assert.match((0, session_bounces_1.lifecycleBlockers)({}, live).join(' '), /unknown/);
    const blocked = (0, session_bounces_1.lifecycleBlockers)({ ...state, turnInProgress: true,
        lifecycle: { idle: false, pendingMessages: true, pendingDialogs: 1, backgroundWork: true } }, live).join(' ');
    for (const reason of [/turn/, /queued input/, /dialogs/, /background/])
        assert.match(blocked, reason);
});
function productionFixture(t) {
    const sessionId = 'parent';
    assert.ok((0, session_key_1.validSessionId)(sessionId));
    const claim = { sessionId, socketPath: '/unused-original', sessionFile: '/parent.jsonl',
        harnessId: 'pi', pid: 42, startTime: '100', bridgeInstanceId: 'original', capabilities: { guardedReload: true } };
    const paneProcess = { pid: 41, startTime: '90' };
    const live = new bridge_session_1.BridgeSession(claim);
    live.alive = true;
    const state = { turnInProgress: false, compacting: false,
        lifecycle: { idle: true, pendingMessages: false, pendingDialogs: 0, backgroundWork: false } };
    const actions = [];
    const authority = { sessionId: 'parent', harnessId: 'pi', sessionFile: claim.sessionFile, rpc: null, reg: claim,
        spawn: { socket: '/unused-tmux', paneId: '%1', paneProcess } };
    t.mock.method(tmux, 'paneProcessIdentity', async () => paneProcess);
    t.mock.method(live, 'send', async (command) => {
        if (command === 'get_state')
            return state;
        assert.equal(command, 'guarded_reload');
        actions.push('reload');
        return {};
    });
    const ownership = {
        captureBounceAuthority: () => authority,
        bounceIdentityFailure: () => null,
        getLiveSession: async () => live,
        refreshRegisteredSession: () => claim,
    };
    const operations = {
        beginBounceAction: (_id, session) => { session.bounceExecuting = true; },
        endBounceAction: (_id, session) => { session.bounceExecuting = false; },
        restartSession: async (_id, options) => {
            assert.ok(options?.beforeAction);
            const guard = await options.beforeAction();
            guard();
            actions.push('restart');
            return { kind: 'stopped', replacement: { id: 'replacement', placement: 'tmux' } };
        },
    };
    const scheduler = (0, session_bounces_1.createSessionBounceRuntime)({
        operations, ownership, catalog: () => [{ id: 'parent', name: 'Parent', harnessId: 'pi' }],
    });
    t.after(() => scheduler.stop());
    return { scheduler, ownership, operations, live, state, claim, actions };
}
test('production safety rejects transient activity during inspection even when the reply is idle', async (t) => {
    const { scheduler, live, state, actions } = productionFixture(t);
    const reading = deferred();
    const reply = deferred();
    const send = t.mock.method(live, 'send', async () => { reading.resolve(); return reply.promise; });
    const queued = scheduler.enqueue('restart', ['parent']);
    const tick = scheduler.tick();
    await reading.promise;
    live.emit('message_start', {});
    reply.resolve(state);
    await tick;
    assert.equal((await scheduler.list())[0].targets[0].status, 'waiting');
    assert.deepEqual(actions, []);
    assert.equal(Object.hasOwn(queued.targets[0], 'authority'), false);
    send.mock.restore();
    await scheduler.tick();
    assert.deepEqual(actions, ['restart']);
});
test('production execution rechecks activity after the last await and releases execution exclusion on waiting', async (t) => {
    const { scheduler, operations, live, actions } = productionFixture(t);
    const prepared = deferred();
    const proceed = deferred();
    const restart = t.mock.method(operations, 'restartSession', async (_id, options) => {
        assert.ok(options?.beforeAction);
        const guard = await options.beforeAction();
        prepared.resolve();
        await proceed.promise;
        guard();
        actions.push('unsafe restart');
        return { kind: 'stopped' };
    });
    scheduler.enqueue('restart', ['parent']);
    const tick = scheduler.tick();
    await prepared.promise;
    live.emit('queue_update', {});
    proceed.resolve();
    await tick;
    assert.equal((await scheduler.list())[0].targets[0].status, 'waiting');
    assert.equal(live.bounceExecuting, false);
    assert.deepEqual(actions, []);
    restart.mock.restore();
    await scheduler.tick();
    assert.deepEqual(actions, ['restart']);
    assert.equal((await scheduler.list())[0].targets[0].status, 'completed');
});
test('production restart distinguishes pre-action refusal from a stopped replacement with the same status', async (t) => {
    const { scheduler, operations } = productionFixture(t);
    t.mock.method(operations, 'restartSession', async () => ({ kind: 'no-action', status: 409, error: 'Ownership changed' }));
    scheduler.enqueue('restart', ['parent']);
    await scheduler.tick();
    assert.equal((await scheduler.list())[0].targets[0].status, 'skipped');
    t.mock.method(operations, 'restartSession', async () => ({
        kind: 'replacement-not-ready', stopped: true, status: 409, error: 'Replacement identity changed',
    }));
    scheduler.enqueue('restart', ['parent']);
    await scheduler.tick();
    await scheduler.tick();
    assert.equal((await scheduler.list())[0].targets[0].status, 'failed');
});
test('guarded reload completes only after a new connected claim on the captured process and transcript', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { scheduler, ownership, live, claim, actions } = productionFixture(t);
    let observed = claim;
    let connected = live;
    let polled = deferred();
    t.mock.method(ownership, 'refreshRegisteredSession', () => { polled.resolve(); return observed; });
    t.mock.method(ownership, 'getLiveSession', async () => connected);
    const operation = scheduler.enqueue('reload', ['parent']);
    const tick = scheduler.tick();
    await polled.promise;
    const initialCancellation = scheduler.cancel(operation.id);
    assert.ok(initialCancellation);
    assert.equal(initialCancellation.targets[0].status, 'executing');
    observed = { ...claim, bridgeInstanceId: 'replacement', socketPath: '/unused-replacement', startTime: '101' };
    connected = new bridge_session_1.BridgeSession(observed);
    connected.alive = true;
    polled = deferred();
    t.mock.timers.tick(100);
    await polled.promise;
    const wrongProcessCancellation = scheduler.cancel(operation.id);
    assert.ok(wrongProcessCancellation);
    assert.equal(wrongProcessCancellation.targets[0].status, 'executing');
    observed = { ...observed, startTime: claim.startTime, sessionFile: '/other.jsonl' };
    connected = new bridge_session_1.BridgeSession(observed);
    connected.alive = true;
    polled = deferred();
    t.mock.timers.tick(100);
    await polled.promise;
    const wrongTranscriptCancellation = scheduler.cancel(operation.id);
    assert.ok(wrongTranscriptCancellation);
    assert.equal(wrongTranscriptCancellation.targets[0].status, 'executing');
    observed = { ...observed, sessionFile: claim.sessionFile };
    connected = new bridge_session_1.BridgeSession(observed);
    // A fresh registry entry alone is not completion; its transport must be connected.
    polled = deferred();
    t.mock.timers.tick(100);
    await polled.promise;
    const disconnectedCancellation = scheduler.cancel(operation.id);
    assert.ok(disconnectedCancellation);
    assert.equal(disconnectedCancellation.targets[0].status, 'executing');
    await Promise.resolve();
    connected.alive = true;
    t.mock.timers.tick(100);
    await tick;
    assert.deepEqual(actions, ['reload']);
    assert.equal((await scheduler.list())[0].targets[0].status, 'completed');
    assert.equal(live.bounceExecuting, false);
});
test('unconfirmed guarded reload is terminal and is never redispatched', async (t) => {
    const { scheduler, ownership, claim, actions, live } = productionFixture(t);
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(ownership, 'refreshRegisteredSession', () => { now += 15000; return claim; });
    scheduler.enqueue('reload', ['parent']);
    await scheduler.tick();
    await scheduler.tick();
    assert.equal((await scheduler.list())[0].targets[0].status, 'failed');
    assert.deepEqual(actions, ['reload']);
    assert.equal(live.bounceExecuting, false);
});
function treeFixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-bounce-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const write = (relative, id, exited = false) => {
        const file = path.join(dir, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ type: 'session', id }) + '\n'
            + (exited ? JSON.stringify({ type: 'custom', customType: 'session_exit' }) + '\n' : ''));
        return file;
    };
    return { dir, write, parent: write('parent.jsonl', 'parent') };
}
test('all OMP descendants must exit, including idle children and grandchildren beneath exited children', t => {
    const { parent, write } = treeFixture(t);
    write('parent/Child.jsonl', 'child', true);
    const grandchild = write('parent/Child/Grandchild.jsonl', 'grandchild');
    let proof = (0, session_discovery_1.inspectSubsessionExits)(parent);
    assert.equal(proof.complete, true);
    assert.match(proof.blockers.join(' '), /Grandchild/);
    fs.appendFileSync(grandchild, JSON.stringify({ type: 'custom', customType: 'session_exit' }) + '\n');
    assert.deepEqual((0, session_discovery_1.inspectSubsessionExits)(parent), { complete: true, blockers: [] });
    fs.appendFileSync(grandchild, JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'revived' } }) + '\n');
    assert.match((0, session_discovery_1.inspectSubsessionExits)(parent).blockers.join(' '), /Grandchild/);
});
test('incomplete descendant discovery fails closed on caps, malformed headers, orphan directories and symlinks', t => {
    const { parent, write, dir } = treeFixture(t);
    write('parent/Child.jsonl', 'child', true);
    write('parent/Child/Grandchild.jsonl', 'grandchild', true);
    assert.equal((0, session_discovery_1.inspectSubsessionExits)(parent, { maxDepth: 1 }).complete, false);
    assert.equal((0, session_discovery_1.inspectSubsessionExits)(parent, { maxFiles: 1 }).complete, false);
    assert.equal((0, session_discovery_1.inspectSubsessionExits)(parent, { maxEntries: 1 }).complete, false);
    fs.writeFileSync(path.join(dir, 'parent', 'Broken.jsonl'), '{broken\n');
    assert.equal((0, session_discovery_1.inspectSubsessionExits)(parent).complete, false);
    fs.unlinkSync(path.join(dir, 'parent', 'Broken.jsonl'));
    fs.unlinkSync(path.join(dir, 'parent', 'Child.jsonl'));
    assert.equal((0, session_discovery_1.inspectSubsessionExits)(parent).complete, false);
    write('parent/Child.jsonl', 'child', true);
    fs.symlinkSync(path.join(dir, 'parent', 'Child'), path.join(dir, 'parent', 'Linked'));
    assert.equal((0, session_discovery_1.inspectSubsessionExits)(parent).complete, false);
    fs.unlinkSync(parent);
    assert.equal((0, session_discovery_1.inspectSubsessionExits)(parent).complete, false);
});
test('ordinary artifact directories do not invent child sessions but cannot conceal live nested transcripts', t => {
    const { parent, write, dir } = treeFixture(t);
    fs.mkdirSync(path.join(dir, 'parent', 'report', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'parent', 'report', 'assets', 'style.css'), 'body {}');
    assert.deepEqual((0, session_discovery_1.inspectSubsessionExits)(parent), { complete: true, blockers: [] });
    write('parent/report/Worker.jsonl', 'worker');
    const proof = (0, session_discovery_1.inspectSubsessionExits)(parent);
    assert.equal(proof.complete, false);
    assert.match(proof.blockers.join(' '), /Worker/);
});
