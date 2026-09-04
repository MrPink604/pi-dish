const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecoveryRunner, continuationSafety, RECOVERY_PROMPT } = require('../lib/recovery-runner');

function scenario(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-recovery-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, [
    { type: 'session', id: 'session', cwd: dir },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Deploy this project' }] } },
  ].map(JSON.stringify).join('\n') + '\n');
  const record = { harnessId: 'pi', nativeSessionId: 'session', sessionFile: file, cwd: dir,
    observationId: 'observation', updatedAt: 1, activity: 'idle', runId: null, shutdown: false, ...overrides.record };
  let mode = overrides.mode || 'restore', current = record, live = overrides.live || null;
  let control = { excluded: false, closed: false, attempt: null, ...overrides.control };
  let matched = true;
  const prompts = [], launches = [];
  const store = {
    listRecords: () => [current], readRecord: () => current,
    getControl: () => control,
    patchControl: (_harness, _id, patch) => { control = { ...control, ...patch }; return control; },
    checkpointMatches: () => matched,
  };
  const deps = {
    store, getMode: () => mode, routeId: r => r.nativeSessionId,
    probeLive: async () => live,
    validateRecord: async r => { if (!fs.existsSync(r.cwd)) throw new Error('Original working directory is missing'); },
    restore: async r => { launches.push(r.nativeSessionId); live = { turnInProgress: false }; return { id: r.nativeSessionId }; },
    continueSession: async (_r, _session, text) => { prompts.push(text); },
    ...overrides.deps,
  };
  const runner = createRecoveryRunner(deps);
  return { runner, deps, record, store, prompts, launches, file,
    control: () => control, row: () => runner.report().sessions[0],
    setMode: v => { mode = v; }, setMatch: v => { matched = v; },
    setLive: v => { live = v; }, setRecord: v => { current = v; } };
}

test('off startup never launches, including a later settings change without another startup', async t => {
  const s = scenario(t, { mode: 'off' });
  await s.runner.start();
  s.setMode('continue');
  await s.runner.start();
  assert.deepEqual(s.launches, []);
  assert.deepEqual(s.prompts, []);
});

test('delayed configured startup restores old observations once without a browser or prompt', async t => {
  const s = scenario(t);
  await Promise.all([s.runner.start(), s.runner.start()]);
  assert.deepEqual(s.launches, ['session']);
  assert.deepEqual(s.prompts, []);
  assert.equal(s.row().status, 'restored');
});

test('idle working-set sessions restore again after a later process loss without prompting', async t => {
  const s = scenario(t, { mode: 'continue' });
  await s.runner.start();
  s.setLive(null);
  const nextStartup = createRecoveryRunner(s.deps);
  await nextStartup.start();
  assert.deepEqual(s.launches, ['session', 'session']);
  assert.deepEqual(s.prompts, []);
  assert.equal(nextStartup.report().sessions[0].status, 'restored');
});

test('a surviving live agent takes precedence over old interrupted evidence', async t => {
  const s = scenario(t, { mode: 'continue', live: { turnInProgress: true }, record: { activity: 'running', runId: 'run' } });
  await s.runner.start();
  assert.equal(s.row().status, 'live');
  assert.deepEqual(s.launches, []);
  assert.deepEqual(s.prompts, []);
});

test('an interrupted matched run receives one inspection prompt, never the original request', async t => {
  const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
  await s.runner.start();
  assert.equal(s.row().status, 'continued');
  assert.deepEqual(s.prompts, [RECOVERY_PROMPT]);
  assert.notEqual(s.prompts[0], 'Deploy this project');
  s.setLive(null);
  const restart = createRecoveryRunner(s.deps);
  await restart.start();
  assert.equal(restart.report().sessions[0].status, 'needs-review');
  assert.equal(s.launches.length, 1);
  assert.equal(s.prompts.length, 1);
});

test('advanced transcripts restore without an automatic prompt', async t => {
  const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
  s.setMatch(false);
  await s.runner.start();
  assert.equal(s.row().status, 'needs-review');
  assert.deepEqual(s.launches, ['session']);
  assert.deepEqual(s.prompts, []);
});

test('a new lifecycle observation during restore suppresses continuation', async t => {
  const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
  const restore = s.deps.restore;
  s.deps.restore = async r => { const result = await restore(r); s.setRecord({ ...r, activity: 'idle', observationId: 'new' }); return result; };
  const runner = createRecoveryRunner(s.deps);
  await runner.start();
  assert.equal(runner.report().sessions[0].status, 'needs-review');
  assert.deepEqual(s.prompts, []);
});

test('uncertain delivery remains reviewable even when the agent survives', async t => {
  const s = scenario(t, { mode: 'continue', live: { turnInProgress: false },
    control: { attempt: { observationId: 'old', status: 'restoring', delivery: 'uncertain' } } });
  await s.runner.start();
  assert.equal(s.row().status, 'needs-review');
  assert.deepEqual(s.launches, []);
  assert.deepEqual(s.prompts, []);
});

test('lost prompt acknowledgement cannot cause a restart or explicit retry to resend', async t => {
  const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
  s.deps.continueSession = async (_r, _live, text) => { s.prompts.push(text); throw new Error('socket closed after send'); };
  const runner = createRecoveryRunner(s.deps);
  await runner.start();
  assert.equal(runner.report().sessions[0].status, 'needs-review');
  assert.equal(s.control().attempt.delivery, 'uncertain');
  s.setLive(null);
  const restart = createRecoveryRunner(s.deps);
  await restart.start();
  assert.equal(s.launches.length, 1);
  await restart.retry('session');
  assert.equal(s.launches.length, 2);
  assert.equal(s.prompts.length, 1);
  assert.equal(restart.report().sessions[0].status, 'needs-review');
});

test('overlapping explicit restores share one launch', async t => {
  const s = scenario(t);
  await Promise.all([s.runner.retry('session'), s.runner.retry('session')]);
  assert.deepEqual(s.launches, ['session']);
});

test('excluded and explicitly closed sessions do not recover', async t => {
  const excluded = scenario(t, { control: { excluded: true } });
  const closed = scenario(t, { control: { closed: true } });
  await Promise.all([excluded.runner.start(), closed.runner.start()]);
  assert.deepEqual(excluded.launches, []);
  assert.deepEqual(closed.launches, []);
  assert.equal(excluded.row().excluded, true);
  assert.equal(closed.row().status, 'closed');
});

test('generic shutdown does not resurrect a deliberately quit TUI', async t => {
  const s = scenario(t, { mode: 'continue', record: { shutdown: true, activity: 'running', runId: 'run' } });
  await s.runner.start();
  assert.equal(s.row().status, 'needs-review');
  assert.deepEqual(s.launches, []);
});

test('missing original cwd fails before launching rather than falling back', async t => {
  const s = scenario(t, { record: { cwd: '/definitely-missing-recovery-workspace' } });
  await s.runner.start();
  assert.equal(s.row().status, 'failed');
  assert.deepEqual(s.launches, []);
});

test('unresolved tool effects and corrupt tails require review', async t => {
  const s = scenario(t);
  fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
    role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'deploy', name: 'bash' }],
  } }) + '\n');
  assert.match(await continuationSafety(s.file), /no recorded result/);
  fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
    role: 'toolResult', toolCallId: 'deploy', content: [{ type: 'text', text: 'done' }],
  } }) + '\n');
  assert.equal(await continuationSafety(s.file), null);
  fs.appendFileSync(s.file, '{"type":"message"');
  assert.match(await continuationSafety(s.file), /corrupt/);
});

test('aborted responses and compaction are never automatically continued', async t => {
  const s = scenario(t);
  fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
    role: 'assistant', stopReason: 'aborted', content: [],
  } }) + '\n');
  assert.match(await continuationSafety(s.file), /aborted/);
  fs.appendFileSync(s.file, JSON.stringify({ type: 'compaction', summary: 'partial' }) + '\n');
  assert.match(await continuationSafety(s.file), /compaction/);
});

test('a compacting recovered session cannot receive a queued recovery prompt', async t => {
  const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
  const restore = s.deps.restore;
  s.deps.restore = async record => {
    const result = await restore(record);
    s.setLive({ turnInProgress: false, compacting: true });
    return result;
  };
  const runner = createRecoveryRunner(s.deps);
  await runner.start();
  assert.equal(runner.report().sessions[0].status, 'needs-review');
  assert.deepEqual(s.prompts, []);
});

test('an exclusion arriving during the final live handshake cancels continuation', async t => {
  const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
  const probe = s.deps.probeLive;
  let probes = 0;
  s.deps.probeLive = async record => {
    const live = await probe(record);
    if (++probes === 2) s.store.patchControl('pi', 'session', { excluded: true });
    return live;
  };
  const runner = createRecoveryRunner(s.deps);
  await runner.start();
  assert.deepEqual(s.prompts, []);
  assert.equal(s.control().excluded, true);
});

test('a genuine new run retires an old review outcome but not uncertain delivery', async t => {
  const s = scenario(t, { control: { attempt: {
    observationId: 'observation', status: 'needs-review', reason: 'old failure', delivery: null,
  } } });
  await s.runner.start();
  s.setRecord({ ...s.record, observationId: 'new-user-run', activity: 'idle' });
  assert.equal(s.row().status, 'pending');
  const restart = createRecoveryRunner(s.deps);
  await restart.start();
  assert.deepEqual(s.launches, ['session']);
  assert.equal(restart.report().sessions[0].status, 'restored');
});

test('bounded reports prefer newest observations and closed records do not crowd out startup work', async t => {
  const s = scenario(t);
  const records = Array.from({ length: 5001 }, (_, index) => ({
    ...s.record, nativeSessionId: `closed-${index}`, updatedAt: index + 2,
  }));
  records.push({ ...s.record, nativeSessionId: 'eligible', updatedAt: 1 });
  s.deps.store.listRecords = () => [...records];
  const getControl = s.deps.store.getControl;
  s.deps.store.getControl = (harness, id) => ({ ...getControl(harness, id), closed: id.startsWith('closed-') });
  const runner = createRecoveryRunner(s.deps);
  const report = runner.report();
  assert.equal(report.truncated, true);
  assert.equal(report.totalRecords, 5002);
  assert.equal(report.sessions.length, 5000);
  assert.equal(report.sessions[0].id, 'closed-5000');
  await runner.start();
  assert.deepEqual(s.launches, ['eligible']);
});
