/**
 * Peer-message hold regressions (lib/message-hold.js): arrivals inside one
 * window group into a single batch in arrival order, an expired window opens a
 * new batch, a restart delivers every durable batch exactly once, an inactive
 * session's batch survives a failed attempt until wake() accelerates it, and a
 * failed harness delivery is reported and retried.
 *
 * HOME points at a temp dir so ~/.pi/dish/message-holds.json is per-test state;
 * createMessageHold() re-reads that file at construction, so a fresh instance
 * is how a process restart is simulated.
 *
 * The module owns a real Date/setTimeout window and exposes no clock seam, so
 * the few absence assertions below use a genuine short delay (documented at
 * each site); every positive assertion awaits an observed signal instead.
 *
 * Run with: npm test
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { createMessageHold, messageHoldWindowMs, peerSender } from '../lib/message-hold';
import type { PeerSender } from '../lib/message-hold';
import type { LiveSession } from '../lib/session-ownership';

const originalHome = process.env.HOME;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-message-hold-'));
process.env.HOME = tmpHome;
const dishDir = path.join(tmpHome, '.pi', 'dish');
const inboxFile = path.join(dishDir, 'message-holds.json');

test.after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});
test.beforeEach(() => fs.rmSync(dishDir, { recursive: true, force: true }));

type Json = Record<string, unknown>;
const sender = (id: string, ref: string, name: string): PeerSender => ({ id, ref, name });
const S1 = sender('session-aaaa', 'tycho/aaaa', 'Tycho');
const S2 = sender('session-bbbb', 'lyra/bbbb', 'Lyra');
const entries = (batch: Json): Json[] => batch.entries as Json[];

function readBatches(): Json[] {
  const store = JSON.parse(fs.readFileSync(inboxFile, 'utf8')) as { batches: Json[] };
  return store.batches;
}

interface Prompt { text: string; options: unknown }

function fixture({ windowMs = 30, live = true, promptFails = false }: { windowMs?: number; live?: boolean; promptFails?: boolean } = {}) {
  const settings: Json = { messageHoldWindowMs: windowMs };
  const prompts: Prompt[] = [];
  const errors: unknown[] = [];
  let getCalls = 0;
  let liveNow = live;
  let promptImpl: (text: string) => Promise<unknown> = promptFails
    ? () => Promise.reject(new Error('harness offline'))
    : async () => ({ ok: true });
  const session = {
    prompt: (text: string, options?: unknown) => { prompts.push({ text, options }); return promptImpl(text); },
  };
  const ports = {
    getLiveSession: async (): Promise<LiveSession | null> => {
      getCalls++;
      return liveNow ? session as unknown as LiveSession : null;
    },
    supports: () => true,
    readSettings: () => settings,
    onError: (error: unknown) => { errors.push(error); },
  };
  return {
    ports, settings, prompts, errors,
    get getCalls() { return getCalls; },
    setLive(value: boolean) { liveNow = value; },
    setPrompt(impl: (text: string) => Promise<unknown>) { promptImpl = impl; },
  };
}

// Real-timer wait: the hold schedules its own unref'd setTimeout, and absence
// assertions need a bounded grace period rather than a condition signal.
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function waitFor<T>(predicate: () => T | false | null | undefined, label: string, timeout = 4000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(5);
  }
}

test('arrivals inside one window form a single batch in arrival order', () => {
  const f = fixture({ windowMs: 60_000 });
  const hold = createMessageHold(f.ports);
  hold.start();
  const first = hold.enqueue('sess-1', 'prompt', 'first message', S1);
  const second = hold.enqueue('sess-1', 'prompt', 'second message', S2);
  hold.stop();

  assert.match(first.until, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(second.until, first.until, 'later arrivals share the batch deadline');
  const batches = readBatches();
  assert.equal(batches.length, 1);
  assert.equal(batches[0].sessionId, 'sess-1');
  assert.equal(batches[0].delivery, 'prompt');
  assert.equal(new Date(batches[0].until as number).toISOString(), first.until);
  const [entry1, entry2] = entries(batches[0]);
  assert.deepEqual([entry1.message, entry2.message], ['first message', 'second message']);
  assert.deepEqual(entry1.sender, S1);
  assert.deepEqual(entry2.sender, S2);
  assert.ok(!Number.isNaN(Date.parse(String(entry1.sentAt))));
});

test('delivery modes and sessions never share a batch', () => {
  const f = fixture({ windowMs: 60_000 });
  const hold = createMessageHold(f.ports);
  hold.start();
  hold.enqueue('sess-1', 'prompt', 'p1', S1);
  hold.enqueue('sess-1', 'followUp', 'f1', S1);
  hold.enqueue('sess-2', 'prompt', 'p2', S2);
  hold.stop();

  const batches = readBatches();
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map(batch => `${String(batch.sessionId)}/${String(batch.delivery)}`).sort(),
    ['sess-1/followUp', 'sess-1/prompt', 'sess-2/prompt']);
  for (const batch of batches) assert.equal(entries(batch).length, 1);
});

test('an expired window starts a new batch for the next arrival', async () => {
  const f = fixture({ windowMs: 25, live: false });
  const hold = createMessageHold(f.ports);
  hold.start();
  const early = hold.enqueue('sess-1', 'prompt', 'early', S1);
  await waitFor(() => f.getCalls >= 1, 'the first delivery attempt');
  assert.ok(Date.parse(early.until) <= Date.now(), 'the first window elapsed');
  const late = hold.enqueue('sess-1', 'prompt', 'late', S1);
  hold.stop();

  assert.notEqual(late.until, early.until);
  assert.deepEqual(readBatches().map(batch => entries(batch).map(entry => entry.message)), [['early'], ['late']]);
});

test('a restart delivers each durable batch exactly once and empties the inbox', async () => {
  const before = fixture({ windowMs: 20, live: false });
  const hold1 = createMessageHold(before.ports);
  hold1.start();
  hold1.enqueue('sess-1', 'prompt', 'one', S1);
  hold1.enqueue('sess-1', 'prompt', 'two', S2);
  hold1.stop();
  assert.equal(before.getCalls, 0, 'a stopped hold never attempts delivery');
  assert.equal(readBatches().length, 1);

  const persisted = entries(readBatches()[0]);
  const expected = persisted
    .map(entry => `[${(entry.sender as PeerSender).ref} · ${(entry.sender as PeerSender).name} · ${String(entry.sentAt)}]\n${String(entry.message)}`)
    .join('\n\n');

  const after = fixture({ windowMs: 20, live: true });
  const hold2 = createMessageHold(after.ports);
  hold2.start();
  await waitFor(() => after.prompts.length >= 1, 'the restarted delivery');
  await delay(30); // no second timer may redeliver the same durable batch
  assert.equal(after.prompts.length, 1, 'one prompt per persisted batch');
  assert.equal(after.prompts[0].text, expected);
  assert.deepEqual(after.prompts[0].options, {});
  assert.equal(readBatches().length, 0, 'an acknowledged batch leaves the inbox');
  hold2.stop();

  const third = createMessageHold(after.ports);
  third.start(); // an emptied inbox has nothing to schedule
  assert.equal(after.prompts.length, 1);
  third.stop();
});

test('a follow-up batch is delivered as a follow-up', async () => {
  const f = fixture({ windowMs: 20, live: true });
  const hold = createMessageHold(f.ports);
  hold.start();
  hold.enqueue('sess-1', 'followUp', 'queued note', S1);
  await waitFor(() => f.prompts.length >= 1, 'the follow-up delivery');
  assert.match(f.prompts[0].text, /queued note/);
  assert.deepEqual(f.prompts[0].options, { deliverAs: 'followUp' });
  hold.stop();
});

test('an inactive session keeps its batch and wake() accelerates the retry', async () => {
  const f = fixture({ windowMs: 20, live: false });
  const hold = createMessageHold(f.ports);
  hold.start();
  hold.enqueue('sess-1', 'prompt', 'hello peer', S1);
  await waitFor(() => f.getCalls >= 1, 'the failed attempt while inactive');
  assert.equal(f.prompts.length, 0);
  assert.equal(readBatches().length, 1, 'an unowned session does not retire the batch');

  f.setLive(true);
  hold.wake('sess-1');
  await waitFor(() => f.prompts.length >= 1, 'delivery after wake');
  assert.match(f.prompts[0].text, /hello peer/);
  assert.equal(readBatches().length, 0);
  hold.stop();
});

test('wake() before the window elapses does not deliver early', async () => {
  const f = fixture({ windowMs: 5_000, live: true });
  const hold = createMessageHold(f.ports);
  hold.start();
  hold.enqueue('sess-1', 'prompt', 'later', S1);
  hold.wake('sess-1');
  await delay(40); // well inside the five-second window; nothing may fire
  assert.equal(f.prompts.length, 0);
  assert.equal(readBatches().length, 1);
  hold.stop();
});

test('a failed harness delivery is reported and retried, then retired once', async () => {
  const f = fixture({ windowMs: 20, live: true, promptFails: true });
  const hold = createMessageHold(f.ports);
  hold.start();
  hold.enqueue('sess-1', 'prompt', 'retry me', S1);
  await waitFor(() => f.errors.length >= 1, 'the failure report');
  assert.equal((f.errors[0] as Error).message, 'harness offline');
  assert.equal(readBatches().length, 1, 'a failed delivery stays durable');
  assert.equal(f.prompts.length, 1);

  f.setPrompt(async () => ({ ok: true }));
  hold.wake('sess-1');
  await waitFor(() => readBatches().length === 0, 'the acknowledged delivery');
  assert.equal(f.prompts.length, 2, 'the retry reuses the same batch');
  assert.equal(f.errors.length, 1, 'a successful retry reports nothing');
  hold.stop();
});

test('stop() halts delivery and preserves the batch', async () => {
  const f = fixture({ windowMs: 20, live: true });
  const hold = createMessageHold(f.ports);
  hold.start();
  hold.enqueue('sess-1', 'prompt', 'parked', S1);
  hold.stop();
  await delay(60); // the window has long passed; a live timer would have fired
  assert.equal(f.getCalls, 0);
  assert.equal(f.prompts.length, 0);
  assert.equal(readBatches().length, 1);
});

test('an unstarted hold keeps the batch until start() schedules it', async () => {
  const f = fixture({ windowMs: 20, live: true });
  const hold = createMessageHold(f.ports);
  hold.enqueue('sess-1', 'prompt', 'waiting', S1);
  await delay(60); // the window has long passed; no timer runs before start()
  assert.equal(f.prompts.length, 0, 'no timer runs before start()');

  hold.start();
  await waitFor(() => f.prompts.length >= 1, 'delivery after start');
  assert.match(f.prompts[0].text, /waiting/);
  hold.stop();
});

test('an unreadable inbox is refused rather than discarded', () => {
  const f = fixture();
  fs.mkdirSync(dishDir, { recursive: true });
  fs.writeFileSync(inboxFile, JSON.stringify({ batches: [{ sessionId: 'sess-1' }] }));
  assert.throws(() => createMessageHold(f.ports), /refusing to discard/);
  fs.writeFileSync(inboxFile, '{ not json');
  assert.throws(() => createMessageHold(f.ports), SyntaxError);
});

test('messageHoldWindowMs accepts only bounded safe integers', () => {
  assert.equal(messageHoldWindowMs({}), 0);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: undefined }), 0);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: null }), 0);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: '100' }), 0);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: -1 }), 0);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: 1.5 }), 0);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: Number.NaN }), 0);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: Number.POSITIVE_INFINITY }), 0);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: 0 }), 0);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: 250 }), 250);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: 24 * 60 * 60 * 1000 }), 86_400_000);
  assert.equal(messageHoldWindowMs({ messageHoldWindowMs: 24 * 60 * 60 * 1000 + 1 }), 0);
});

test('peerSender narrows exactly the identity the inbox persists', () => {
  assert.deepEqual(peerSender({ id: 'i', ref: 'ref/x', name: 'Name', extra: true }), sender('i', 'ref/x', 'Name'));
  assert.equal(peerSender(null), null);
  assert.equal(peerSender([]), null);
  assert.equal(peerSender('sender'), null);
  assert.equal(peerSender({ id: '', ref: 'r', name: 'N' }), null);
  assert.equal(peerSender({ id: 'i', ref: 'r', name: '' }), null);
  assert.equal(peerSender({ id: 'i', ref: 'r', name: 'N'.repeat(201) }), null);
  assert.equal(peerSender({ id: 'i', ref: 'ref\nx', name: 'N' }), null);
  assert.equal(peerSender({ id: 'i', ref: 'r', name: 'N\r\nx' }), null);
  assert.equal(peerSender({ id: 1, ref: 'r', name: 'N' }), null);
});
