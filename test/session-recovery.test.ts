import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { ChildProcess, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import type { RecoveryObservation, RecoveryRecord } from '../lib/session-recovery.js';
const { createLineSplitter }: typeof import('../lib/line-splitter.js') = require('../lib/line-splitter.js');
const { processIdentity }: typeof import('../lib/process-identity.js') = require('../lib/process-identity.js');
const recovery: typeof import('../lib/session-recovery.js') = require('../lib/session-recovery.js');
const { RPCSession }: typeof import('../lib/rpc-session.js') = require('../lib/rpc-session.js');
const { validSessionId }: typeof import('../lib/session-key.js') = require('../lib/session-key.js');

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const bunAvailable = spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0;

function requiredRecord(record: RecoveryRecord | null): RecoveryRecord {
  assert.ok(record);
  return record;
}
function fixture(t: test.TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-recovery-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const childCompletions = new Map<ChildProcess, Promise<void>>();
  const ownChild = <T extends ChildProcess>(child: T): T => {
    childCompletions.set(child, new Promise<void>((resolve) => child.once('close', () => resolve())));
    return child;
  };
  t.after(async () => {
    for (const child of childCompletions.keys()) {
      if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill('SIGKILL');
    }
    await Promise.all(childCompletions.values());
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const sessionFile = path.join(home, 'session.jsonl');
  fs.writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: 'native', cwd: home }) + '\n');
  const snapshot = {
    harnessId: 'pi', nativeSessionId: 'native', sessionFile, cwd: home,
    name: 'Durable work', model: 'provider/model', thinkingLevel: 'high',
    pid: process.pid, startTime: processIdentity(process.pid)?.startTime ?? null,
    instanceId: 'original-owner', activity: 'running', runId: 'run-one', shutdown: false,
  } satisfies RecoveryObservation;
  const read = (): RecoveryRecord => {
    const value = recovery.readRecord(snapshot.harnessId, snapshot.nativeSessionId);
    assert.ok(value);
    return value;
  };
  const append = (message: unknown): void => fs.appendFileSync(sessionFile, JSON.stringify({ type: 'message', message }) + '\n');
  return { home, sessionFile, snapshot, read, append, ownChild };
}

test('durable observations survive writer exit, registry removal and module reload without losing controls', (t: test.TestContext) => {
  const { home, snapshot, read } = fixture(t);
  recovery.patchControl('pi', 'native', { excluded: true, attempt: { delivery: 'uncertain', status: 'needs-review' } });
  const writerPath = path.join(__dirname, 'fixtures', 'session-recovery-writer.js');
  const writer = spawnSync(process.execPath, [writerPath], { env: { ...process.env, SNAPSHOT: JSON.stringify(snapshot) }, encoding: 'utf8' });
  assert.equal(writer.status, 0, writer.stderr);
  const saved = read();
  assert.equal(saved.activity, 'running');
  assert.equal(recovery.checkpointMatches(saved), true);
  const registry = path.join(home, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registry, { recursive: true });
  fs.writeFileSync(path.join(registry, 'stale.json'), '{}');
  fs.rmSync(registry, { recursive: true });
  delete require.cache[require.resolve('../lib/session-recovery')];
  const reopened: typeof import('../lib/session-recovery.js') = require('../lib/session-recovery.js');
  assert.deepEqual(reopened.listRecords(), [saved]);
  assert.deepEqual(reopened.getControl('pi', 'native'), {
    excluded: true, closed: false, attempt: { delivery: 'uncertain', status: 'needs-review' },
  });
  assert.equal(requiredRecord(reopened.recordSession(snapshot)).observationId, saved.observationId, 'identical boundaries do not churn observations');
  for (const kind of ['observations', 'controls']) {
    const dir = path.join(home, '.pi', 'dish', 'recovery', kind);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1, 'completed writes leave no temp files');
    assert.equal(fs.statSync(path.join(dir, files[0])).mode & 0o777, 0o600);
  }
});

test('checkpoints describe actual saved bytes and fail closed after changes or deletion', (t: test.TestContext) => {
  const { snapshot, sessionFile, append } = fixture(t);
  const saved = requiredRecord(recovery.recordSession(snapshot));
  append({ role: 'user', content: 'new saved prompt' });
  assert.equal(recovery.checkpointMatches(saved), false);
  const newer = requiredRecord(recovery.recordSession(snapshot));
  assert.notEqual(newer.observationId, saved.observationId);
  assert.equal(recovery.checkpointMatches(newer), true);
  fs.unlinkSync(sessionFile);
  assert.equal(recovery.checkpointMatches(newer), false);
  const missing = requiredRecord(recovery.recordSession(snapshot));
  assert.equal(missing.checkpoint, null);
  assert.equal(recovery.checkpointMatches(missing), false);
});

test('failed durable control writes leave previous exclusion and delivery evidence intact', (t: test.TestContext) => {
  fixture(t);
  const before = recovery.patchControl('pi', 'native', {
    excluded: true, attempt: { delivery: 'uncertain', status: 'needs-review' },
  });
  const fsync = fs.fsyncSync;
  fs.fsyncSync = () => { throw new Error('simulated storage failure'); };
  try {
    assert.throws(() => recovery.patchControl('pi', 'native', { excluded: false, attempt: null }), /storage failure/);
  } finally {
    fs.fsyncSync = fsync;
  }
  assert.deepEqual(recovery.getControl('pi', 'native'), before);
});

test('corrupt observations are isolated and corrupt controls cannot silently drop an exclusion', (t: test.TestContext) => {
  const { home, snapshot } = fixture(t);
  recovery.recordSession(snapshot);
  const other = recovery.recordSession({ ...snapshot, nativeSessionId: '../../other/harness', harnessId: 'omp' });
  recovery.patchControl('pi', 'native', { excluded: true });
  const dir = path.join(home, '.pi', 'dish', 'recovery');
  for (const file of fs.readdirSync(path.join(dir, 'observations'))) {
    const filePath = path.join(dir, 'observations', file);
    const data: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (typeof data === 'object' && data !== null && 'harnessId' in data && data.harnessId === 'pi') fs.writeFileSync(filePath, '{torn');
  }
  fs.writeFileSync(path.join(dir, 'observations', 'ignored.tmp'), '{torn');
  assert.equal(recovery.readRecord('pi', 'native'), null);
  assert.deepEqual(recovery.listRecords(), [other]);
  const controlFile = path.join(dir, 'controls', fs.readdirSync(path.join(dir, 'controls'))[0]);
  fs.writeFileSync(controlFile, '{torn');
  assert.equal(recovery.getControl('pi', 'native').excluded, true);
  const corruptAttempt = recovery.getControl('pi', 'native').attempt;
  assert.ok(corruptAttempt);
  assert.equal(corruptAttempt.status, 'needs-review');
  assert.throws(() => recovery.patchControl('pi', 'native', { excluded: false }));
  assert.equal(fs.readFileSync(controlFile, 'utf8'), '{torn');
});

test('HOME isolation and observation updates preserve independently written exclusions and close intent', (t: test.TestContext) => {
  const { home, snapshot } = fixture(t);
  recovery.recordSession(snapshot);
  recovery.patchControl('pi', 'native', { closed: true, excluded: true });
  recovery.recordSession({ ...snapshot, runId: 'new-run', instanceId: 'new-owner' });
  assert.deepEqual(recovery.getControl('pi', 'native'), { closed: true, excluded: true, attempt: null });
  const otherHome = path.join(home, 'other-home');
  fs.mkdirSync(otherHome);
  process.env.HOME = otherHome;
  assert.deepEqual(recovery.listRecords(), []);
  assert.equal(recovery.readRecord('pi', 'native'), null);
  assert.deepEqual(recovery.getControl('pi', 'native'), { excluded: false, closed: false, attempt: null });
  process.env.HOME = home;
  assert.equal(requiredRecord(recovery.readRecord('pi', 'native')).runId, 'new-run');
});

test('initializing or disposing a new observer cannot consume an interrupted checkpoint; actual shutdown can', async (t: test.TestContext) => {
  const { snapshot, read } = fixture(t);
  const before = recovery.recordSession(snapshot);
  const observer = recovery.createSessionObserver({ snapshot: () => ({ ...snapshot, instanceId: 'reopened' }), waitsForSettled: true });
  observer.initialize();
  observer.event('metadata');
  await delay(10);
  assert.deepEqual(read(), before);
  observer.event('shutdown');
  const ended = read();
  assert.equal(ended.instanceId, 'reopened');
  assert.equal(ended.shutdown, true);
  assert.equal(ended.activity, 'uncertain', 'generic shutdown is not proof of intentional user close');
  observer.dispose();
});

test('whole runs retain identity across model turns, wait for saved input, and settle after retries', async (t: test.TestContext) => {
  const { snapshot, read, append } = fixture(t);
  const observer = recovery.createSessionObserver({ snapshot: () => snapshot, waitsForSettled: true });
  t.after(() => observer.dispose());
  observer.initialize();
  observer.event('agent_start');
  const starting = read();
  assert.equal(starting.activity, 'uncertain', 'input has not reached JSONL yet');
  observer.event('message_end', { message: { role: 'user' } });
  assert.equal(read().observationId, starting.observationId, 'message_end precedes native append');
  append({ role: 'user', content: 'perform the task' });
  await delay(10);
  assert.equal(read().activity, 'running');
  assert.equal(recovery.checkpointMatches(read()), true);
  observer.event('message_update', { message: { role: 'assistant', content: 'partial' } });
  const stable = read();
  await delay(10);
  assert.deepEqual(read(), stable, 'stream deltas do not create durable writes');
  append({ role: 'assistant', stopReason: 'toolUse', content: [] });
  observer.event('turn_end');
  await delay(10);
  assert.equal(read().activity, 'running');
  assert.equal(read().runId, starting.runId);
  observer.event('agent_end', { messages: [{ role: 'assistant', stopReason: 'error' }], willRetry: true });
  await delay(10);
  assert.equal(read().activity, 'running');
  assert.equal(read().runId, starting.runId);
  observer.event('agent_start');
  append({ role: 'assistant', stopReason: 'stop', content: 'done' });
  observer.event('agent_end', { messages: [{ role: 'assistant', stopReason: 'stop' }] });
  await delay(10);
  assert.equal(read().activity, 'uncertain', 'post-run compaction/continuation has not settled');
  assert.equal(read().runId, starting.runId);
  observer.event('agent_settled');
  await delay(10);
  assert.equal(read().activity, 'idle');
  assert.equal(read().runId, null);
});

test('aborted runs and unobserved compaction completion stay uncertain', async (t: test.TestContext) => {
  const { snapshot, read, append } = fixture(t);
  const observer = recovery.createSessionObserver({ snapshot: () => snapshot, waitsForSettled: true });
  t.after(() => observer.dispose());
  observer.event('agent_start');
  append({ role: 'assistant', stopReason: 'aborted' });
  observer.event('agent_end', { messages: [{ role: 'assistant', stopReason: 'aborted' }] });
  observer.event('agent_settled');
  await delay(10);
  assert.equal(read().activity, 'uncertain');
  observer.event('compaction_start');
  observer.event('compaction_end', { unknown: true });
  await delay(10);
  assert.equal(read().activity, 'uncertain');
});

test('retirement cancels pending checkpoints so switched identities cannot receive stale callbacks', async (t: test.TestContext) => {
  const { snapshot, read, append } = fixture(t);
  let active = snapshot;
  const observer = recovery.createSessionObserver({ snapshot: () => active });
  observer.event('agent_start');
  append({ role: 'user', content: 'work' });
  observer.event('message_end');
  observer.event('retire');
  observer.dispose();
  active = { ...snapshot, nativeSessionId: 'switched' };
  await delay(10);
  assert.equal(read().shutdown, true);
  assert.equal(read().activity, 'uncertain');
  assert.equal(recovery.readRecord('pi', 'switched'), null);
});

test('RPC recovery fallback yields to the live bridge and never retakes ownership after registry cleanup', async (t: test.TestContext) => {
  const { home, snapshot, read, append } = fixture(t);
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdio: ChildProcessWithoutNullStreams['stdio'] = [stdin, stdout, stderr, null, null];
  const proc = Object.assign(new ChildProcess(), { pid: process.pid, stdin, stdout, stderr, stdio });
  const nativeId = 'native';
  assert.ok(validSessionId(nativeId));
  const rpc = new RPCSession(nativeId, proc);
  rpc.cwd = home;
  rpc.sessionFile = snapshot.sessionFile;
  t.after(() => rpc.recoveryObserver.dispose());
  rpc.recoveryObserver.initialize();
  rpc.recoveryObserver.event('agent_start');
  append({ role: 'user', content: 'fallback work' });
  rpc.recoveryObserver.event('message_end');
  await delay(10);
  assert.equal(read().instanceId, rpc.recoveryInstanceId);
  const dir = path.join(home, '.pi', 'dish', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify({ ...snapshot, recoveryObservation: true }));
  const bridge = recovery.recordSession({ ...snapshot, instanceId: 'bridge-owner' });
  rpc.recoveryObserver.event('agent_start');
  assert.deepEqual(read(), bridge);
  fs.rmSync(dir, { recursive: true });
  proc.emit('exit', 0);
  assert.deepEqual(read(), bridge, 'bridge shutdown must not awaken an RPC second writer');
});

test('the real bridge checkpoints without a server and retires switched sessions', { skip: !bunAvailable }, async (t: test.TestContext) => {
  const { home, ownChild } = fixture(t);
  const bridgeFixture = path.join(__dirname, 'fixtures', 'session-recovery-bridge.ts');
  const child = ownChild(spawn('bun', [bridgeFixture], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOME: home, TMUX: '', TMUX_PANE: '', PI_DISH_SOCKET_DIR: path.join(home, 'sockets') },
    stdio: ['pipe', 'pipe', 'pipe'],
  }));
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
  const pending = new Map<string, () => void>();
  const seen = new Set<string>();
  child.stdout.on('data', createLineSplitter((line: string) => {
    seen.add(line);
    pending.get(line)?.();
  }));
  const wait = (line: string): Promise<void> => seen.has(line) ? Promise.resolve() : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Missing ${line}: ${stderr}`)), 5000);
    pending.set(line, () => { clearTimeout(timer); pending.delete(line); resolve(); });
  });
  await wait('READY');
  const send = (command: string): Promise<void> => { child.stdin.write(JSON.stringify(command) + '\n'); return wait('ACK:' + command); };
  await send('run');
  const first = requiredRecord(recovery.readRecord('omp', 'bridge-old'));
  assert.equal(first.activity, 'running');
  assert.equal(recovery.checkpointMatches(first), true);
  assert.equal(recovery.readRecord('pi', 'bridge-old'), null, 'a wrapper and stock bridge must not create duplicate recovery intent');
  await send('turn');
  assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-old')).runId, first.runId);
  assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-old')).activity, 'running');
  await send('switch');
  assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-old')).shutdown, true);
  assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-new')).activity, 'idle');
  await send('child');
  assert.equal(recovery.readRecord('omp', 'worker'), null, 'nested subagents are not independently recoverable owners');
  const closed = child.exitCode === null ? once(child, 'close') : Promise.resolve();
  await send('shutdown');
  await closed;
  assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-new')).shutdown, true);
  assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-new')).activity, 'uncertain');
  assert.deepEqual(fs.readdirSync(path.join(home, '.pi', 'dish', 'sessions')), []);
  assert.equal(recovery.readRecord('pi', 'bridge-old'), null, 'wrapper shutdown must not activate a previously suppressed stock observer');
});
