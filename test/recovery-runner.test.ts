import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { spawn } from 'node:child_process';
import { createRecoveryRunner, createTmuxLossLimiter, continuationSafety, RECOVERY_PROMPT, watchTmuxServer } from '../lib/recovery-runner';
import type { TestContext } from 'node:test';
import type { RecoveryMode, RecoveryRunnerOptions, TmuxServerLossEvent } from '../lib/recovery-runner';
import type { RecoveryRecord, RecoveryControl, RecoveryAttempt } from '../lib/session-recovery';
import type { LiveSession } from '../lib/session-ownership';
import type { LiveTmuxPane, TmuxServerSnapshot } from '../lib/tmux';
import { processIdentity } from '../lib/process-identity';
import { BridgeSession } from '../lib/bridge-session';
import { getHarness } from '../lib/harnesses';
import { validSessionId } from '../lib/session-key';
import { sourceForIdentity } from '../lib/session-source';

type FixtureLiveObservation = Pick<LiveSession, 'turnInProgress'> & Partial<Pick<LiveSession, 'compacting'>>;
interface ScenarioOverrides {
  record?: Partial<RecoveryRecord>;
  mode?: RecoveryMode;
  live?: FixtureLiveObservation | null;
  control?: Partial<RecoveryControl>;
  deps?: Partial<RecoveryRunnerOptions>;
}

function scenario(t: TestContext, overrides: ScenarioOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-recovery-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, [
    { type: 'session', id: 'session', cwd: dir },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Deploy this project' }] } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const record: RecoveryRecord = { version: 1, harnessId: 'pi', nativeSessionId: 'session', sessionFile: file, cwd: dir,
    name: null, model: null, thinkingLevel: null, pid: 42, startTime: null, instanceId: 'fixture',
    bootId: null, checkpoint: null,
    observationId: 'observation', updatedAt: new Date(1).toISOString(), activity: 'idle', runId: null, shutdown: false, ...overrides.record };
  function observedLive(observation: FixtureLiveObservation | null, recovered: RecoveryRecord = record) {
    if (!observation) return null;
    const sessionId = recovered.nativeSessionId;
    assert.ok(validSessionId(sessionId));
    const session = new BridgeSession({ sessionId, socketPath: path.join(dir, 'unused.sock'),
      harnessId: recovered.harnessId, sessionFile: recovered.sessionFile, cwd: recovered.cwd });
    session.turnInProgress = observation.turnInProgress;
    if (observation.compacting !== undefined) session.compacting = observation.compacting;
    return session;
  }
  let mode: RecoveryMode = overrides.mode || 'restore';
  let current = record;
  let live = observedLive(overrides.live || null);
  let control: RecoveryControl = { excluded: false, closed: false, attempt: null, ...overrides.control };
  let matched = true;
  const prompts: string[] = [], launches: string[] = [];
  const store: RecoveryRunnerOptions['store'] = {
    listRecords: () => [current], readRecord: () => current,
    getControl: () => control,
    patchControl: (_harness, _id, patch) => { control = { ...control, ...patch }; return control; },
    checkpointMatches: () => matched,
  };
  const deps: RecoveryRunnerOptions = {
    store, getMode: () => mode, routeId: r => r.nativeSessionId,
    probeLive: async () => live,
    validateRecord: r => {
      if (!fs.existsSync(r.cwd)) throw new Error('Original working directory is missing');
      const descriptor = getHarness(r.harnessId);
      assert.ok(descriptor);
      assert.ok(validSessionId(r.nativeSessionId));
      return sourceForIdentity(descriptor.id, r.nativeSessionId, r.sessionFile);
    },
    restore: async r => { launches.push(r.nativeSessionId); live = observedLive({ turnInProgress: false }, r); return { success: true, id: r.nativeSessionId }; },
    continueSession: async (_r, _session, text) => { prompts.push(text); },
    ...overrides.deps,
  };
  const runner = createRecoveryRunner(deps);
  return { runner, deps, record, store, prompts, launches, file,
    control: () => control, row: () => {
      const row = runner.report().sessions[0];
      assert.ok(row);
      return row;
    },
    setMode: (v: RecoveryMode) => { mode = v; }, setMatch: (v: boolean) => { matched = v; },
    setLive: (v: FixtureLiveObservation | null) => { live = observedLive(v, current); },
    setRecord: (v: RecoveryRecord) => { current = v; } };
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
  const attempt = s.control().attempt;
  assert.ok(attempt);
  assert.equal(attempt.delivery, 'uncertain');
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

test('hibernated sessions wait for a message at startup but stay explicitly restorable', async t => {
  const s = scenario(t);
  const runner = createRecoveryRunner({ ...s.deps, hibernated: id => id === 'session' });
  await runner.start();
  assert.deepEqual(s.launches, []);
  const row = runner.report().sessions[0];
  assert.equal(row.status, 'pending');
  assert.match(String(row.reason), /^Hibernated under memory pressure/);
  await runner.retry('session');
  assert.deepEqual(s.launches, ['session']);
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
  const missingResultReason = await continuationSafety(s.file);
  assert.ok(typeof missingResultReason === 'string');
  assert.equal(Boolean(missingResultReason), true);
  fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
    role: 'toolResult', toolCallId: 'deploy', content: [{ type: 'text', text: 'done' }],
  } }) + '\n');
  assert.equal(await continuationSafety(s.file), null);
  fs.appendFileSync(s.file, '{"type":"message"');
  const corruptReason = await continuationSafety(s.file);
  assert.ok(typeof corruptReason === 'string');
  assert.equal(Boolean(corruptReason), true);
});

test('transcript entries that are not JSON objects cannot be verified', async t => {
  const s = scenario(t);
  const base = JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }) + '\n';
  for (const line of ['null', '[]', '42', '"text"']) {
    fs.writeFileSync(s.file, base + line + '\n');
    assert.ok(typeof await continuationSafety(s.file) === 'string', `${line} is not a verifiable entry`);
  }
});

test('unverifiable assistant content restores for review without continuing automatically', async t => {
  const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
  fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
    role: 'assistant', stopReason: 'toolUse', content: [null],
  } }) + '\n');
  await s.runner.start();
  assert.deepEqual(s.launches, ['session']);
  assert.equal(s.row().status, 'needs-review');
  assert.deepEqual(s.prompts, []);
  assert.equal(s.control().attempt?.delivery, null);
});

test('aborted responses and compaction are never automatically continued', async t => {
  const s = scenario(t);
  fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
    role: 'assistant', stopReason: 'aborted', content: [],
  } }) + '\n');
  const abortedReason = await continuationSafety(s.file);
  assert.ok(typeof abortedReason === 'string');
  assert.equal(Boolean(abortedReason), true);
  fs.appendFileSync(s.file, JSON.stringify({ type: 'compaction', summary: 'partial' }) + '\n');
  const compactionReason = await continuationSafety(s.file);
  assert.ok(typeof compactionReason === 'string');
  assert.equal(Boolean(compactionReason), true);
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
  const records: RecoveryRecord[] = Array.from({ length: 5001 }, (_, index) => ({
    ...s.record, nativeSessionId: `closed-${index}`, updatedAt: new Date(index + 2).toISOString(),
  }));
  records.push({ ...s.record, nativeSessionId: 'eligible', updatedAt: new Date(1).toISOString() });
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

test('a malformed truthy delivery marker cannot authorize another idle restore', async t => {
  const delivery = { unexpected: 'confirmed' };
  const s = scenario(t, { control: { attempt: {
    observationId: 'observation', status: 'restored', delivery,
  } } });
  await s.runner.start();
  assert.deepEqual(s.launches, []);
  assert.deepEqual(s.prompts, []);
  assert.equal(s.row().status, 'needs-review');
  const attempt = s.control().attempt;
  assert.ok(attempt);
  assert.deepEqual(attempt.delivery, delivery);
});

test('legacy report values survive without broadening literal ambiguity checks', async t => {
  const attempt: RecoveryAttempt = {
    observationId: 'observation', status: ['restoring'], delivery: { value: 'uncertain' },
    reason: { legacy: 'detail' }, updatedAt: ['old timestamp'],
  };
  const s = scenario(t, { live: { turnInProgress: false }, control: { attempt } });
  assert.deepEqual(s.row().status, attempt.status);
  assert.deepEqual(s.row().reason, attempt.reason);
  assert.deepEqual(s.row().updatedAt, attempt.updatedAt);
  await s.runner.start();
  assert.equal(s.row().status, 'live');
  assert.deepEqual(s.launches, []);
  assert.deepEqual(s.prompts, []);
  assert.deepEqual(s.control().attempt, attempt);
});

test('an interrupted agy relay receives one recovery prompt like Pi and OMP', async t => {
  const s = scenario(t, { mode: 'continue', record: { harnessId: 'agy', activity: 'running', runId: 'run' } });
  await s.runner.start();
  assert.equal(s.row().status, 'continued');
  assert.deepEqual(s.launches, ['session']);
  assert.deepEqual(s.prompts, [RECOVERY_PROMPT]);
});

test('a harness without a verified recovery prompt path restores but never prompts', async t => {
  const s = scenario(t, { mode: 'continue', record: { harnessId: 'prime', activity: 'running', runId: 'run' } });
  await s.runner.start();
  assert.deepEqual(s.launches, ['session'], 'the transcript is restored for review');
  assert.equal(s.row().status, 'needs-review');
  assert.match(String(s.row().reason), /no verified recovery prompt path/);
  assert.deepEqual(s.prompts, []);
});

test('a launch whose agent is not running and registered is never reported restored', async t => {
  const s = scenario(t, { deps: { restore: async r => ({ success: true, id: r.nativeSessionId }) } });
  await s.runner.start();
  assert.equal(s.row().status, 'needs-review');
  assert.match(String(s.row().reason), /not running with a registered bridge/);
});

test('a tmux server loss marks hung-up agents lost without auto-relaunching, respects continuationSafety and skips pending routine closes', async t => {
  const s = scenario(t, { mode: 'restore', record: { shutdown: true, activity: 'uncertain' } });
  await s.runner.start();
  assert.equal(s.row().status, 'needs-review', 'at startup a generic shutdown is still ambiguous');
  assert.deepEqual(s.launches, []);

  await s.runner.markLost(['session']);
  assert.equal(s.row().status, 'pending', 'tmux loss marks non-running sessions pending for manual retry');
  assert.deepEqual(s.launches, [], 'agent sessions are never auto-relaunched on tmux loss');
  assert.deepEqual(s.prompts, []);

  const retried = await s.runner.retryAll();
  assert.deepEqual(retried.map(outcome => outcome.status), ['restored']);
  assert.deepEqual(s.launches, ['session']);
  assert.deepEqual(s.prompts, []);
  assert.deepEqual(await s.runner.retryAll(), [], 'a running session leaves the retry-all set');

  // An interrupted running turn is flagged needs-review with continuationSafety findings
  // and stays one-by-one (not launched automatically or by retry-all).
  const interrupted = scenario(t, { mode: 'continue', record: { shutdown: false, activity: 'running', runId: 'run-1' } });
  fs.appendFileSync(interrupted.file, JSON.stringify({
    type: 'message',
    message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'tc-1', name: 'bash' }] },
  }) + '\n');
  await interrupted.runner.markLost(['session']);
  assert.deepEqual(interrupted.launches, [], 'interrupted sessions are not auto-relaunched');
  assert.deepEqual(interrupted.prompts, [], 'tmux server loss must never send an automatic prompt');
  assert.equal(interrupted.row().status, 'needs-review');
  assert.match(String(interrupted.row().reason), /Tool calls have no recorded result/);
  assert.deepEqual(await interrupted.runner.retryAll(), [], 'needs-review interrupted rows stay one-by-one');

  // A completed one-shot routine waiting on its close grace timer is never resurrected.
  const closing = scenario(t, {
    mode: 'restore',
    record: { shutdown: true, activity: 'uncertain' },
    deps: { isPendingClose: id => id === 'session' },
  });
  await closing.runner.markLost(['session']);
  assert.deepEqual(closing.launches, []);
  assert.equal(closing.row().status, 'closed');
  assert.deepEqual(await closing.runner.retryAll(), []);
});

test('retry-all retries failed rows, leaves needs-review/ambiguous one-by-one, and honors the private PIN gate', async t => {
  const shutdown = scenario(t, { record: { shutdown: true, activity: 'uncertain' } });
  await shutdown.runner.start();
  assert.deepEqual(await shutdown.runner.retryAll(), []);
  assert.deepEqual(shutdown.launches, []);

  // Ambiguous delivery stays one-by-one even if it was also in the tmux-lost set.
  const ambiguous = scenario(t, {
    mode: 'off',
    control: { attempt: { observationId: 'observation', status: 'needs-review', delivery: 'uncertain' } },
  });
  await ambiguous.runner.markLost(['session']);
  assert.deepEqual(await ambiguous.runner.retryAll(), []);
  assert.deepEqual(ambiguous.launches, []);

  // Private sessions are hidden from locked reports and skipped by locked retry-all.
  const priv = scenario(t, {
    record: { nativeSessionId: 'private-sess', cwd: '/definitely-missing-recovery-workspace' },
    deps: { isPrivate: r => r.nativeSessionId === 'private-sess' },
  });
  await priv.runner.start();
  assert.equal(priv.runner.report().sessions.length, 1);
  assert.deepEqual(priv.runner.report({ includePrivate: false }).sessions, []);
  assert.equal(priv.runner.report({ includePrivate: false }).totalRecords, 0);

  priv.setRecord({ ...priv.record, nativeSessionId: 'private-sess', cwd: path.dirname(priv.file) });
  assert.deepEqual(await priv.runner.retryAll({ includePrivate: false }), []);
  assert.deepEqual(priv.launches, [], 'locked retry-all must never launch a private session');

  const unlocked = await priv.runner.retryAll({ includePrivate: true });
  assert.deepEqual(unlocked.map(outcome => outcome.status), ['restored']);
  assert.deepEqual(priv.launches, ['private-sess']);
});

test('persisted tmux loss limiter enforces exponential backoff, rolling cap, restart persistence and fail-closed corruption', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-recovery-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'tmux-recovery-state.json');
  let clock = 1_000_000;
  const open = () => createTmuxLossLimiter({
    file: () => stateFile,
    now: () => clock,
    baseBackoffMs: 10_000,
    maxBackoffMs: 60_000,
    windowMs: 100_000,
    maxAttempts: 3,
  });

  const first = open();
  assert.equal(first.check().allowed, true);
  first.record();
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);

  // Re-open (simulating a pi-dish restart): backoff must persist across processes.
  const afterRestart = open();
  clock += 5_000;
  const blocked1 = afterRestart.check();
  assert.equal(blocked1.allowed, false);
  assert.match(blocked1.reason, /backoff/i);

  // After baseBackoffMs (10s), attempt 2 succeeds and backoff doubles to 20s.
  clock += 5_000;
  assert.equal(afterRestart.check().allowed, true);
  afterRestart.record();
  clock += 15_000;
  assert.equal(open().check().allowed, false, 'second backoff doubled to 20s');

  // After 20s, attempt 3 succeeds and reaches maxAttempts=3 in the 100s window.
  clock += 5_000;
  assert.equal(open().check().allowed, true);
  open().record();
  clock += 50_000;
  const capped = open().check();
  assert.equal(capped.allowed, false);
  assert.match(capped.reason, /limit of 3 attempt/);

  // Once the oldest attempt ages past windowMs (100s from initial 1_000_000), recovery opens again.
  clock = 1_000_000 + 100_000;
  assert.equal(open().check().allowed, true);

  // Corrupt state file fails closed.
  fs.writeFileSync(stateFile, '{corrupt');
  const corrupt = open().check();
  assert.equal(corrupt.allowed, false);
  assert.match(corrupt.reason, /corrupt/i);
});

test('startup recovery honours persisted backoff suppression while leaving live sessions alone', async t => {
  const suppressed = scenario(t, {
    mode: 'restore',
    deps: { suppressedAtStartup: id => id === 'session' ? 'Backoff active (4m remaining).' : null },
  });
  await suppressed.runner.start();
  assert.deepEqual(suppressed.launches, []);
  assert.equal(suppressed.row().status, 'needs-review');
  assert.match(String(suppressed.row().reason), /Backoff active/);

  // Explicit operator retry still works even while automatic startup is suppressed.
  const retried = await suppressed.runner.retry('session');
  assert.equal(retried.status, 'restored');
  assert.deepEqual(suppressed.launches, ['session']);

  // A healthy live session is always left alone even if startup suppression is set.
  const live = scenario(t, {
    mode: 'restore',
    live: { turnInProgress: false },
    deps: { suppressedAtStartup: () => 'Backoff active.' },
  });
  await live.runner.start();
  assert.deepEqual(live.launches, []);
  assert.equal(live.row().status, 'live');
});

test('overlapping start() and markLost() never sends a paid continuation prompt', async t => {
  // Case 1: loss arrives while start() is awaiting restore().
  let releaseRestore!: () => void;
  let restoreEntered!: () => void;
  const restoreWait = new Promise<void>(resolve => { releaseRestore = resolve; });
  const enteredRestore = new Promise<void>(resolve => { restoreEntered = resolve; });

  const s1 = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run-1' } });
  const baseRestore = s1.deps.restore;
  s1.deps.restore = async record => {
    restoreEntered();
    await restoreWait;
    return baseRestore(record);
  };
  const runner1 = createRecoveryRunner(s1.deps);
  const startFlight = runner1.start();
  await enteredRestore;
  const lostFlight = runner1.markLost(['session']);
  releaseRestore();
  await startFlight;
  await lostFlight;

  assert.deepEqual(s1.launches, ['session'], 'no second launch is triggered by markLost');
  assert.deepEqual(s1.prompts, [], 'overlapping start() and markLost() must never send a paid prompt');
  assert.notEqual(runner1.report().sessions[0]?.status, 'continued');

  // Case 2: loss is detected right before delivery (during the post-restore live handshake).
  let releaseSecondProbe!: () => void;
  let enteredSecondProbe!: () => void;
  const secondProbeWait = new Promise<void>(resolve => { releaseSecondProbe = resolve; });
  const atSecondProbe = new Promise<void>(resolve => { enteredSecondProbe = resolve; });

  const s2 = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run-2' } });
  const baseProbe = s2.deps.probeLive;
  let probes = 0;
  s2.deps.probeLive = async record => {
    const result = await baseProbe(record);
    if (++probes === 2) {
      enteredSecondProbe();
      await secondProbeWait;
    }
    return result;
  };
  const runner2 = createRecoveryRunner(s2.deps);
  const startFlight2 = runner2.start();
  await atSecondProbe;
  runner2.markLostRestoreOnly(['session']);
  releaseSecondProbe();
  await startFlight2;

  assert.deepEqual(s2.launches, ['session']);
  assert.deepEqual(s2.prompts, [], 'marking restore-only right before delivery blocks continuation');
  assert.equal(runner2.report().sessions[0]?.status, 'needs-review');
});

test('retry rejects invalid routes and enforces private authorization on the matched record', async t => {
  const s = scenario(t, {
    record: { nativeSessionId: '../invalid-private', name: 'Secret Name', cwd: '/secret/cwd' },
    deps: { isPrivate: () => true },
  });
  assert.deepEqual(s.runner.report({ includePrivate: true }).sessions, [], 'invalid-route records are omitted from report');
  await assert.rejects(
    () => s.runner.retry('../invalid-private'),
    (error: unknown) => error instanceof Error && 'status' in error && (error as { status: number }).status === 400,
    'invalid route is rejected with 400 before matching any stored record',
  );

  const priv = scenario(t, {
    record: { nativeSessionId: 'private-only' },
    deps: { isPrivate: r => r.nativeSessionId === 'private-only' },
  });
  await assert.rejects(
    () => priv.runner.retry('private-only', { includePrivate: false }),
    (error: unknown) => error instanceof Error && 'status' in error && (error as { status: number }).status === 404,
    'locked single retry refuses matched private record with 404',
  );
  const unlocked = await priv.runner.retry('private-only', { includePrivate: true });
  assert.equal(unlocked.status, 'restored');
});

test('watchTmuxServer distinguishes dead/replaced servers from slow servers, gates config on verified placements, and retries failed config writes', async t => {
  const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' });
  t.after(() => sleeper.kill('SIGKILL'));
  const deadPid = sleeper.pid;
  assert.ok(deadPid);
  const deadIdentity = processIdentity(deadPid);
  const selfIdentity = processIdentity(process.pid);
  const parentIdentity = processIdentity(process.ppid);
  assert.ok(deadIdentity && selfIdentity && parentIdentity);

  const livePane = (paneId: string): LiveTmuxPane => ({ paneId, panePid: process.pid, dead: false, paneProcess: selfIdentity });
  let snapshot: TmuxServerSnapshot | null = { pid: selfIdentity.pid, server: selfIdentity, panes: new Map() };
  let agentIds = ['a', 'b'];
  let botIds = ['bot-1'];
  const lost: TmuxServerLossEvent[] = [];
  const detected: TmuxServerLossEvent[] = [];
  let configuredCount = 0;
  let configBehavior: 'fail' | 'throw' | 'ok' = 'fail';

  const watch = watchTmuxServer({
    socket: '/unused',
    inspectServer: async () => snapshot,
    configureServer: async () => {
      configuredCount++;
      if (configBehavior === 'fail') return false;
      if (configBehavior === 'throw') throw new Error('tmux busy');
      return true;
    },
    snapshotSessions: (_socket, panes) => {
      const livePanes = [...panes.values()].filter(pane => !pane.dead);
      return livePanes.length
        ? { agentIds: [...agentIds], botIds: [...botIds], processes: [] }
        : { agentIds: [], botIds: [], processes: [] };
    },
    onLossDetected: event => { detected.push(event); },
    onLost: async event => { lost.push(event); },
    intervalMs: 3_600_000,
    settleMs: 0,
    exitWaitMs: 0,
  });
  t.after(() => watch.stop());

  // Unverified server (0 live pi-dish placements): must NOT call configureServer.
  await watch.tick();
  assert.equal(configuredCount, 0, 'never configures a server before verifying a live pi-dish placement');

  // Once a verified placement appears, a failed or throwing exit-empty write is NOT remembered as success.
  snapshot = { pid: selfIdentity.pid, server: selfIdentity, panes: new Map([['%0', livePane('%0')]]) };
  await watch.tick();
  assert.equal(configuredCount, 1);
  configBehavior = 'throw';
  await watch.tick();
  assert.equal(configuredCount, 2, 'retries exit-empty write after false return');
  configBehavior = 'ok';
  await watch.tick();
  assert.equal(configuredCount, 3, 'retries exit-empty write after thrown error');
  await watch.tick();
  assert.equal(configuredCount, 3, 'stops re-configuring once exit-empty write succeeds');

  // Slow running server: snapshot is null while server process is still alive -> NOT a loss.
  snapshot = null;
  await watch.tick();
  assert.equal(lost.length, 0, 'no answer from a live server process is not a loss');

  // Single session exits while server keeps the same identity -> NOT a loss.
  snapshot = { pid: selfIdentity.pid, server: selfIdentity, panes: new Map() };
  await watch.tick();
  assert.equal(lost.length, 0, 'an empty server with the same identity means sessions exited on their own');

  // Dead remain-on-exit pane is excluded and never queued for recovery.
  snapshot = {
    pid: selfIdentity.pid,
    server: selfIdentity,
    panes: new Map([['%0', { paneId: '%0', panePid: null, dead: true, paneProcess: null }]]),
  };
  await watch.tick();
  assert.equal(lost.length, 0);

  // Re-populate live pane, then replace server PID -> triggers onLossDetected and onLost with agents and bots.
  snapshot = { pid: selfIdentity.pid, server: selfIdentity, panes: new Map([['%0', livePane('%0')]]) };
  await watch.tick();
  snapshot = { pid: parentIdentity.pid, server: parentIdentity, panes: new Map() };
  await watch.tick();
  assert.equal(detected.length, 1);
  assert.equal(lost.length, 1);
  assert.deepEqual(lost[0]?.agentIds, ['a', 'b']);
  assert.deepEqual(lost[0]?.botIds, ['bot-1']);
  assert.equal(lost[0]?.replacementPid, parentIdentity.pid);

  // Dead server process exits -> triggers onLost.
  agentIds = ['c'];
  botIds = [];
  snapshot = { pid: deadIdentity.pid, server: deadIdentity, panes: new Map([['%1', livePane('%1')]]) };
  await watch.tick();
  sleeper.kill('SIGKILL');
  await new Promise(resolve => sleeper.once('exit', resolve));
  snapshot = null;
  await watch.tick();
  assert.equal(detected.length, 2);
  assert.equal(lost.length, 2);
  assert.deepEqual(lost[1]?.agentIds, ['c']);
  assert.deepEqual(lost[1]?.botIds, []);
  assert.equal(lost[1]?.replacementPid, null);
});

