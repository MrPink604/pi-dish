const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionBounces, lifecycleBlockers } = require('../lib/session-bounces');
const { inspectSubsessionExits } = require('../lib/session-discovery');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function fixture(overrides = {}) {
  const runtime = { generation: 1, blockers: ['Working'], eligible: true };
  const actions = [];
  const scheduler = createSessionBounces({
    catalog: () => [{ id: 'parent', name: 'Parent', harnessId: 'omp' }],
    capture: () => ({ generation: runtime.generation }),
    inspect: async authority => authority.generation === runtime.generation
      ? { eligible: runtime.eligible, reason: 'Ownership lost', blockers: runtime.blockers }
      : { eligible: false, reason: 'Runtime replaced', blockers: [] },
    execute: async authority => { actions.push(authority.generation); return { replacementId: 'replacement' }; },
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
  assert.match((await scheduler.list()).find(op => op.id === first.id).targets[0].reason, /Working/);
  runtime.blockers = [];
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(actions, [1]);
  const result = (await scheduler.list()).find(op => op.id === first.id).targets[0];
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
  assert.equal(scheduler.cancel(first.id).targets[0].status, 'cancelled');
  inspection.resolve({ eligible: true, blockers: [] });
  await tick;
  assert.equal(executeCount, 0);
  const second = scheduler.enqueue('restart', ['parent']);
  const secondTick = scheduler.tick();
  await started.promise;
  assert.equal(scheduler.cancel(second.id).targets[0].status, 'executing');
  const concurrentTick = scheduler.tick();
  finish.resolve();
  await Promise.all([secondTick, concurrentTick]);
  assert.equal(executeCount, 1);
});

test('failures are terminal without duplicate retries; explicit pre-action busy refusal returns to waiting', async () => {
  let attempts = 0;
  const { scheduler, runtime } = fixture({ execute: async () => {
    attempts++;
    if (attempts === 1) return { waiting: true, reason: 'New turn arrived' };
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
  const live = { alive: true, turnInProgress: false, compacting: false };
  const state = { turnInProgress: false, compacting: false,
    lifecycle: { idle: true, pendingMessages: false, pendingDialogs: 0, backgroundWork: false } };
  assert.deepEqual(lifecycleBlockers(state, live), []);
  assert.match(lifecycleBlockers({}, live).join(' '), /unknown/);
  const blocked = lifecycleBlockers({ ...state, turnInProgress: true,
    lifecycle: { idle: false, pendingMessages: true, pendingDialogs: 1, backgroundWork: true } }, live).join(' ');
  for (const reason of [/turn/, /queued input/, /dialogs/, /background/]) assert.match(blocked, reason);
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
  let proof = inspectSubsessionExits(parent);
  assert.equal(proof.complete, true);
  assert.match(proof.blockers.join(' '), /Grandchild/);
  fs.appendFileSync(grandchild, JSON.stringify({ type: 'custom', customType: 'session_exit' }) + '\n');
  assert.deepEqual(inspectSubsessionExits(parent), { complete: true, blockers: [] });
  fs.appendFileSync(grandchild, JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'revived' } }) + '\n');
  assert.match(inspectSubsessionExits(parent).blockers.join(' '), /Grandchild/);
});

test('incomplete descendant discovery fails closed on caps, malformed headers, orphan directories and symlinks', t => {
  const { parent, write, dir } = treeFixture(t);
  write('parent/Child.jsonl', 'child', true);
  write('parent/Child/Grandchild.jsonl', 'grandchild', true);
  assert.equal(inspectSubsessionExits(parent, { maxDepth: 1 }).complete, false);
  assert.equal(inspectSubsessionExits(parent, { maxFiles: 1 }).complete, false);
  assert.equal(inspectSubsessionExits(parent, { maxEntries: 1 }).complete, false);
  fs.writeFileSync(path.join(dir, 'parent', 'Broken.jsonl'), '{broken\n');
  assert.equal(inspectSubsessionExits(parent).complete, false);
  fs.unlinkSync(path.join(dir, 'parent', 'Broken.jsonl'));
  fs.unlinkSync(path.join(dir, 'parent', 'Child.jsonl'));
  assert.equal(inspectSubsessionExits(parent).complete, false);
  write('parent/Child.jsonl', 'child', true);
  fs.symlinkSync(path.join(dir, 'parent', 'Child'), path.join(dir, 'parent', 'Linked'));
  assert.equal(inspectSubsessionExits(parent).complete, false);
  fs.unlinkSync(parent);
  assert.equal(inspectSubsessionExits(parent).complete, false);
});

test('ordinary artifact directories do not invent child sessions but cannot conceal live nested transcripts', t => {
  const { parent, write, dir } = treeFixture(t);
  fs.mkdirSync(path.join(dir, 'parent', 'report', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'parent', 'report', 'assets', 'style.css'), 'body {}');
  assert.deepEqual(inspectSubsessionExits(parent), { complete: true, blockers: [] });
  write('parent/report/Worker.jsonl', 'worker');
  const proof = inspectSubsessionExits(parent);
  assert.equal(proof.complete, false);
  assert.match(proof.blockers.join(' '), /Worker/);
});
