/**
 * Web Push (lib/push-notifications.js): the finished/waiting transition rules,
 * subscription admission against the host's VAPID key, and delivery policy
 * (agent-launched peers, pruning gone endpoints, baseline after enabling).
 * Delivery itself is a port; the real sender is web-push's.
 *
 * HOME points at a temp dir so ~/.pi/dish/{vapid,push-subscriptions}.json are per-test state.
 *
 * Run with: npm test
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { FINISHED_IDLE_SAMPLES, GONE_GRACE_MS, createPushNotifier, readVapidKeys, sessionTransitions } from '../lib/push-notifications';
import type { PushPayload, PushSendResult, PushSessionRow, SessionWatchState } from '../lib/push-notifications';

const originalHome = process.env.HOME;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-push-'));
process.env.HOME = tmpHome;
const dishDir = path.join(tmpHome, '.pi', 'dish');

test.after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});
test.beforeEach(() => fs.rmSync(dishDir, { recursive: true, force: true }));

const working = (id: string): PushSessionRow => ({ id, name: id, turnInProgress: true });
const idle = (id: string): PushSessionRow => ({ id, name: id, sessionFile: `/sessions/${id}.jsonl` });

/** Runs samples in order and returns each sample's transitions as `kind:id`. */
function run(samples: readonly (readonly PushSessionRow[])[]): string[][] {
  let state: SessionWatchState | null = null;
  return samples.map(rows => {
    const step = sessionTransitions(state, rows);
    state = step.state;
    return step.transitions.map(t => `${t.kind}:${t.row.id}`);
  });
}

test('a working session finishes only after consecutive idle samples; the first sample is a baseline', () => {
  assert.equal(FINISHED_IDLE_SAMPLES, 2);
  assert.deepEqual(run([[working('a'), idle('b')], [idle('a'), idle('b')], [idle('a'), idle('b')], [idle('a')]]),
    [[], [], ['finished:a'], []]);
  // Already working at the baseline still counts once it finishes.
  assert.deepEqual(run([[working('a')], [idle('a')], [idle('a')]]), [[], [], ['finished:a']]);
});

test('a gap between turns or a compaction does not ring', () => {
  assert.deepEqual(run([[idle('a')], [working('a')], [idle('a')], [working('a')], [{ id: 'a', compacting: true }], [idle('a')], [idle('a')]]),
    [[], [], [], [], [], [], ['finished:a']]);
});

test('a pending ask rings once on its rising edge, never at the baseline', () => {
  const asking: PushSessionRow = { id: 'a', turnInProgress: true, askPending: true };
  assert.deepEqual(run([[asking], [working('a')], [asking], [asking]]), [[], [], ['waiting:a'], []]);
});

test('a session that disappears mid-turn did not finish', () => {
  assert.deepEqual(run([[working('a')], [], [idle('a')], [idle('a')]]), [[], [], [], []]);
});

test('VAPID keys are generated once, private to the user, and stable', () => {
  const first = readVapidKeys();
  const file = path.join(dishDir, 'vapid.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readVapidKeys(), first);
  fs.writeFileSync(file, '{"publicKey":"not base64!"}');
  assert.throws(() => readVapidKeys(), /not a valid VAPID key file/);
});

const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: 'BP-key_value', auth: 'auth_value' } });

function notifier(rows: { current: readonly PushSessionRow[] }, options: { gone?: ReadonlySet<string>; launched?: ReadonlySet<string>; clock?: { now: number } } = {}) {
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  const instance = createPushNotifier({
    sessions: () => rows.current,
    agentLaunched: id => options.launched?.has(id) ?? false,
    readMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: 'Done:\n  all   tests pass.' }] }, { role: 'user', content: 'thanks' }],
    host: () => ({ hostId: 'host-1', label: 'laptop' }),
    send: async (target, payload): Promise<PushSendResult> => {
      sent.push({ endpoint: target.endpoint, payload });
      return { gone: options.gone?.has(target.endpoint) ?? false };
    },
    log: { error: () => {} },
    now: () => options.clock?.now ?? Date.now(),
  });
  return { instance, sent };
}

test('subscriptions are admitted only with this host key and an https endpoint', () => {
  const { instance } = notifier({ current: [] });
  const key = instance.publicKey();
  assert.deepEqual(instance.subscribe(subscription('http://push.example/x'), key), { ok: false, status: 400, error: 'Invalid push subscription.' });
  const mismatch = instance.subscribe(subscription('https://push.example/x'), 'BAnotherHostKey');
  assert.equal(mismatch.ok, false);
  assert.equal(!mismatch.ok && mismatch.status, 409);
  assert.deepEqual(instance.subscribe(subscription('https://push.example/x'), key), { ok: true });
  // Re-registering the same endpoint replaces it rather than duplicating it.
  assert.deepEqual(instance.subscribe(subscription('https://push.example/x'), key), { ok: true });
  const stored = JSON.parse(fs.readFileSync(path.join(dishDir, 'push-subscriptions.json'), 'utf8'));
  assert.equal(stored.subscriptions.length, 1);
  assert.equal(instance.unsubscribe('https://push.example/x'), true);
  assert.equal(instance.unsubscribe('https://push.example/x'), false);
});

test('a finished session notifies every device with a preview; agent-launched peers do not', async () => {
  const rows = { current: [working('a'), working('peer')] as readonly PushSessionRow[] };
  const { instance, sent } = notifier(rows, { launched: new Set(['peer']) });
  instance.subscribe(subscription('https://push.example/phone'), instance.publicKey());
  instance.subscribe(subscription('https://push.example/laptop'), instance.publicKey());
  await instance.sample();
  rows.current = [idle('a'), idle('peer')];
  await instance.sample();
  await instance.sample();
  assert.deepEqual(sent.map(entry => entry.endpoint).sort(), ['https://push.example/laptop', 'https://push.example/phone']);
  assert.deepEqual(sent[0].payload, {
    kind: 'finished', hostId: 'host-1', sessionId: 'a', title: 'a',
    body: 'Finished on laptop: Done: all tests pass.', tag: 'host-1:a',
  });
});

test('a host-level notification reaches every device with a host-scoped tag', async () => {
  const { instance, sent } = notifier({ current: [] });
  await instance.notify({ kind: 'vault', title: 'Vault request', body: 'b', sessionId: null, tag: 'vault:r1', vaultRequestId: 'r1' });
  assert.equal(sent.length, 0);
  instance.subscribe(subscription('https://push.example/phone'), instance.publicKey());
  instance.subscribe(subscription('https://push.example/laptop'), instance.publicKey());
  await instance.notify({ kind: 'vault', title: 'Vault request', body: 'b', sessionId: null, tag: 'vault:r1', vaultRequestId: 'r1' });
  assert.deepEqual(sent.map(entry => entry.endpoint).sort(), ['https://push.example/laptop', 'https://push.example/phone']);
  assert.deepEqual(sent[0].payload, {
    kind: 'vault', title: 'Vault request', body: 'b', sessionId: null, tag: 'host-1:vault:r1', vaultRequestId: 'r1', hostId: 'host-1',
  });
});

test('a gone endpoint is pruned only once its subscription is past the provisioning grace', async () => {
  const clock = { now: Date.parse('2026-10-16T00:00:00Z') };
  const endpoint = 'https://push.example/old';
  const { instance } = notifier({ current: [] }, { gone: new Set([endpoint]), clock });
  instance.subscribe(subscription(endpoint), instance.publicKey());
  clock.now += GONE_GRACE_MS - 1;
  await assert.rejects(instance.test(endpoint), /does not recognize this new subscription yet/);
  clock.now += 1;
  assert.equal(await instance.test(endpoint), false);
  const stored = JSON.parse(fs.readFileSync(path.join(dishDir, 'push-subscriptions.json'), 'utf8'));
  assert.deepEqual(stored.subscriptions, []);
});

test('work that finished while no device was subscribed never rings later', async () => {
  const rows = { current: [working('a')] as readonly PushSessionRow[] };
  const { instance, sent } = notifier(rows);
  await instance.sample();
  rows.current = [idle('a')];
  await instance.sample();
  instance.subscribe(subscription('https://push.example/phone'), instance.publicKey());
  await instance.sample();
  await instance.sample();
  assert.equal(sent.length, 0);
  assert.equal(await instance.test('https://push.example/unknown'), false);
  assert.equal(await instance.test('https://push.example/phone'), true);
  assert.equal(sent[0].payload.kind, 'test');
});
