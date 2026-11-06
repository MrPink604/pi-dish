/**
 * Unit tests for the Prime daemon transport (src/core/prime-daemon.ts) against
 * a fake daemon Unix socket — no Prime install, no provider credentials.
 */
import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { setTimeout as delay } from 'node:timers/promises';
import { getPrimeDaemon, resetPrimeDaemon } from '../lib/prime-daemon.js';
import { liveSessionSupports } from '../lib/session-ownership.js';
import { primeRow, startFakePrimeDaemon, type FakePrimeDaemon } from './fixtures/fake-prime-daemon.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-daemon-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let socketCounter = 0;
function fixturePath(name: string): string {
  socketCounter += 1;
  return path.join(tmp, `${name}-${socketCounter}.sock`);
}

function daemonFor(socketPath: string) {
  return getPrimeDaemon({ PRIME_AGENT_DAEMON_SOCKET: socketPath } as NodeJS.ProcessEnv);
}

/** Retire the singleton and the fake server; the daemon socket is per test. */
function cleanup(t: test.TestContext, fake: FakePrimeDaemon | null): void {
  t.after(async () => {
    resetPrimeDaemon();
    if (fake) await fake.close();
  });
}

function lastCommand(fake: FakePrimeDaemon) {
  return fake.commands[fake.commands.length - 1];
}

/** Wait for a streamed event instead of guessing a socket round-trip delay. */
async function until(predicate: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the fake daemon event');
    await delay(10);
  }
}

test('refuses a daemon speaking an unsupported protocol version', async t => {
  const socketPath = fixturePath('protocol');
  const fake = await startFakePrimeDaemon(socketPath, { protocolVersion: 6, rows: [primeRow()] });
  cleanup(t, fake);
  const daemon = daemonFor(socketPath);

  assert.deepEqual(await daemon.refresh(), []);
  assert.equal(daemon.list().length, 0);
  assert.match(String(daemon.lastError), /Unsupported Prime daemon protocol prime-agent\.daemon v6/);
  assert.equal(fake.commands.length, 0, 'a mismatched hello exchanges no commands');
});

test('lists root agents only and attaches to each one', async t => {
  const root = primeRow({ activeSessionId: 'root-a', sessionId: 'prime-root-a' });
  const subagent = primeRow({ activeSessionId: 'sub-a', sessionId: 'prime-sub-a', runtimeKind: 'subagent', rlmDepth: 1 });
  const nested = primeRow({ activeSessionId: 'nested-a', sessionId: 'prime-nested-a', parentActiveSessionId: 'root-a' });
  const fake = await startFakePrimeDaemon(fixturePath('roots'), { rows: [root, subagent, nested] });
  cleanup(t, fake);
  const daemon = daemonFor(fake.socketPath);

  const sessions = await daemon.refresh();
  assert.equal(sessions.length, 1);
  const [session] = daemon.list();
  assert.equal(session.nativeSessionId, 'prime-root-a');
  assert.equal(session.activeSessionId, 'root-a');
  assert.equal(session.sessionFile, String(root.sessionFile));
  assert.equal(session.state.sessionName, 'Prime One');
  assert.deepEqual(session.state.model, { provider: 'prime', id: 'prime-model' });
  assert.equal(daemon.byNativeId('prime-root-a'), session);
  assert.equal(daemon.byActiveSessionId('root-a'), session);
  assert.equal(daemon.byNativeId('prime-sub-a'), null, 'RLM children are not roots');
  assert.ok(fake.commands.some(command => command.type === 'attach' && command.activeSessionId === 'root-a'));
});

test('liveSessionSupports reflects the daemon command set, not bridge flags', async t => {
  const fake = await startFakePrimeDaemon(fixturePath('caps'), { rows: [primeRow({ activeSessionId: 'root-a', sessionId: 'prime-root-a' })] });
  cleanup(t, fake);
  const daemon = daemonFor(fake.socketPath);
  const [session] = await daemon.refresh();
  for (const capability of ['prompt', 'steer', 'followUp', 'abort', 'compact', 'models', 'setModel',
    'setThinking', 'rename', 'commands', 'queueRead', 'queueCancel', 'treeRead', 'treeNavigation', 'reload'] as const) {
    assert.equal(liveSessionSupports(session, capability), true, capability);
  }
  for (const capability of ['extensionUI', 'sideChat', 'fastMode', 'login', 'shareSnapshot', 'guardedReload'] as const) {
    assert.equal(liveSessionSupports(session, capability), false, capability);
  }
});

test('routes session events: queue updates carry Prime action lanes', async t => {
  const fake = await startFakePrimeDaemon(fixturePath('events'), { rows: [primeRow({ activeSessionId: 'root-a', sessionId: 'prime-root-a' })] });
  cleanup(t, fake);
  const daemon = daemonFor(fake.socketPath);
  const [session] = await daemon.refresh();
  const queueUpdates: unknown[] = [];
  const messageEnds: unknown[] = [];
  session.on('queue_update', data => queueUpdates.push(data));
  session.on('message_end', data => messageEnds.push(data));

  fake.emit('root-a', { type: 'session_action_update', actions: { queuedCount: 3, steering: ['steer now'], followUps: ['later', 'sooner'] } });
  await until(() => queueUpdates.length > 0);
  assert.deepEqual(session.queueState, { steering: ['steer now'], followUp: ['later', 'sooner'] });
  assert.deepEqual(queueUpdates, [{ steering: ['steer now'], followUp: ['later', 'sooner'] }]);

  fake.emit('root-a', { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
  await until(() => messageEnds.length > 0);
  assert.equal(messageEnds.length, 1);
  assert.equal((messageEnds[0] as { message: { role: string } }).message.role, 'assistant');

  const named: string[] = [];
  session.on('session_info_changed', () => named.push(String(session.state.sessionName)));
  fake.emit('root-a', { type: 'session_info_changed', name: 'Renamed by Prime' });
  await until(() => named.length > 0);
  assert.equal(session.state.sessionName, 'Renamed by Prime');
});

test('delta-only message updates are rebuilt into a whole assistant message', async t => {
  const fake = await startFakePrimeDaemon(fixturePath('deltas'), { rows: [primeRow({ activeSessionId: 'root-a', sessionId: 'prime-root-a' })] });
  cleanup(t, fake);
  const [session] = await daemonFor(fake.socketPath).refresh();
  const updates: { message: { content: unknown[]; custom?: unknown } }[] = [];
  session.on('message_update', data => updates.push(data as { message: { content: unknown[] } }));

  fake.emit('root-a', { type: 'message_start', message: { role: 'assistant', content: [], custom: 'kept' } });
  for (const assistantMessageEvent of [
    { type: 'text_start', contentIndex: 0 },
    { type: 'text_delta', contentIndex: 0, delta: 'partial' },
    { type: 'text_end', contentIndex: 0, content: 'whole answer' },
    { type: 'thinking_start', contentIndex: 1 },
    { type: 'thinking_delta', contentIndex: 1, delta: 'reasoning' },
    { type: 'toolcall_end', contentIndex: 2, toolCall: { type: 'toolCall', id: 't1', name: 'Read' } },
  ]) fake.emit('root-a', { type: 'message_update', assistantMessageEvent });
  await until(() => updates.length === 6);
  assert.deepEqual(updates.at(-1)?.message.content, [
    { type: 'text', text: 'whole answer' },
    { type: 'thinking', thinking: 'reasoning' },
    { type: 'toolCall', id: 't1', name: 'Read' },
  ]);
  assert.equal(updates.at(-1)?.message.custom, 'kept', 'the snapshot keeps fields the deltas never touch');

  const final = { role: 'assistant', content: [{ type: 'text', text: 'whole answer' }] };
  fake.emit('root-a', { type: 'message_end', message: final });
  await until(() => session.streamingAssistantMessage === null);
});

test('a prompt to a busy agent steers unless the caller asks for a follow-up', async t => {
  const busy = primeRow({ activeSessionId: 'busy-a', sessionId: 'prime-busy-a', isStreaming: true });
  const idle = primeRow({ activeSessionId: 'idle-a', sessionId: 'prime-idle-a', sessionActions: { queuedCount: 0, steering: [], followUps: [] } });
  const fake = await startFakePrimeDaemon(fixturePath('prompt'), { rows: [busy, idle] });
  cleanup(t, fake);
  const daemon = daemonFor(fake.socketPath);
  await daemon.refresh();
  const busySession = daemon.byActiveSessionId('busy-a')!;
  const idleSession = daemon.byActiveSessionId('idle-a')!;

  await busySession.prompt('while busy');
  assert.equal(lastCommand(fake).type, 'prompt');
  assert.equal(lastCommand(fake).streamingBehavior, 'steer');
  assert.equal(lastCommand(fake).activeSessionId, 'busy-a');

  await busySession.prompt('explicit follow-up', { deliverAs: 'followUp' });
  assert.equal(lastCommand(fake).streamingBehavior, 'followUp');

  await idleSession.prompt('idle hello');
  assert.equal(lastCommand(fake).type, 'prompt');
  assert.equal(lastCommand(fake).streamingBehavior, undefined);

  await idleSession.steer('change course');
  assert.equal(lastCommand(fake).type, 'steer');
  assert.equal(lastCommand(fake).message, 'change course');
});

test('queue cancellation uses the daemon mutate_queued_message contract', async t => {
  const fake = await startFakePrimeDaemon(fixturePath('queue'), { rows: [primeRow({ activeSessionId: 'root-a', sessionId: 'prime-root-a' })] });
  cleanup(t, fake);
  const daemon = daemonFor(fake.socketPath);
  const [session] = await daemon.refresh();

  await session.cancelQueued('followUp', 2, 'queued text');
  const command = lastCommand(fake);
  assert.equal(command.type, 'mutate_queued_message');
  assert.equal(command.activeSessionId, 'root-a');
  assert.equal(command.lane, 'followUp');
  assert.equal(command.index, 2);
  assert.equal(command.expectedText, 'queued text');
  assert.deepEqual(command.mutation, { type: 'delete' });
});

test('a queue cancel Prime rejects (entry already delivered or edited) fails instead of reporting success', async t => {
  const fake = await startFakePrimeDaemon(fixturePath('queue-stale'), {
    rows: [primeRow({ activeSessionId: 'root-a', sessionId: 'prime-root-a' })],
    // Prime answers success with status 'rejected' when expectedText no longer matches.
    respond: command => command.type === 'mutate_queued_message' ? { data: { status: 'rejected' } } : undefined,
  });
  cleanup(t, fake);
  const [session] = await daemonFor(fake.socketPath).refresh();
  await assert.rejects(session.cancelQueued('followUp', 0, 'already delivered'), /already delivered or changed/);
});

test('a vanished agent retires its session with exit and close', async t => {
  const fake = await startFakePrimeDaemon(fixturePath('vanish'), { rows: [primeRow({ activeSessionId: 'root-a', sessionId: 'prime-root-a' })] });
  cleanup(t, fake);
  const daemon = daemonFor(fake.socketPath);
  const [session] = await daemon.refresh();
  let exits = 0, closes = 0;
  session.on('exit', () => { exits += 1; });
  session.on('close', () => { closes += 1; });

  fake.rows.length = 0;
  assert.deepEqual(await daemon.refresh(), []);
  assert.equal(session.alive, false);
  assert.equal(exits, 1);
  assert.equal(closes, 1);
  assert.equal(daemon.byNativeId('prime-root-a'), null);
});

test('an unreachable daemon socket means no live Prime sessions', async t => {
  const missing = daemonFor(fixturePath('missing'));
  cleanup(t, null);
  assert.deepEqual(await missing.refresh(), []);
  assert.equal(missing.list().length, 0);
  assert.equal(missing.lastError, null);

  const stalePath = fixturePath('stale');
  fs.writeFileSync(stalePath, 'not a socket');
  const stale = daemonFor(stalePath);
  assert.deepEqual(await stale.refresh(), []);
  assert.equal(stale.list().length, 0);
  assert.ok(String(stale.lastError).length > 0, 'a dead socket reports why it is not usable');
});

test('stop refuses a roster mismatch before dispatching kill and reports stopRequested', async t => {
  const row = primeRow({ activeSessionId: 'root-a', sessionId: 'prime-root-a' });
  const fake = await startFakePrimeDaemon(fixturePath('stop'), { rows: [row] });
  cleanup(t, fake);
  const daemon = daemonFor(fake.socketPath);
  const [session] = await daemon.refresh();
  const expected = {
    activeSessionId: 'root-a',
    workerInstanceId: String(row.workerInstanceId),
    sessionFile: String(row.sessionFile),
  };

  fake.rows[0].workerInstanceId = 'replacement-worker';
  let beforeStopCalled = false;
  await assert.rejects(
    daemon.stop(expected, () => { beforeStopCalled = true; }),
    (error: unknown) => {
      assert.match(String((error as Error).message), /does not match the owned root agent/);
      assert.equal((error as { stopRequested?: boolean }).stopRequested, false);
      return true;
    },
  );
  assert.equal(beforeStopCalled, false, 'the roster is re-read before any stop callback runs');
  assert.ok(!fake.commands.some(command => command.type === 'kill'));
  assert.equal(session.alive, true);

  fake.rows[0].workerInstanceId = expected.workerInstanceId;
  await daemon.stop(expected, () => { beforeStopCalled = true; });
  assert.equal(beforeStopCalled, true);
  assert.ok(fake.commands.some(command => command.type === 'kill' && command.activeSessionId === 'root-a'));
  assert.equal(session.alive, false);
  assert.equal(daemon.list().length, 0);
});
