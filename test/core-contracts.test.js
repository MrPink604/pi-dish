const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalSessionId, encodeSessionKey, resolveSessionRoute } = require('../lib/session-key');
const { getHostId, getHostLabel } = require('../lib/host-identity');
const { readStore, writeStore } = require('../lib/dish-store');
const { PendingRequests } = require('../lib/pending-requests');
const { createLineSplitter } = require('../lib/line-splitter');
const { processIdentity, processIdentityAlive, inspectProcessAncestry } = require('../lib/process-identity');

test('canonical route ids retain legacy Pi bytes and distinguish alternate harnesses', () => {
  const native = 'same-native:id';
  assert.equal(canonicalSessionId(encodeSessionKey('pi', native)), native);
  assert.equal(canonicalSessionId(native), native);
  const omp = canonicalSessionId(encodeSessionKey('omp', native));
  const prime = canonicalSessionId(encodeSessionKey('prime', native));
  assert.notEqual(omp, prime);
  assert.equal(canonicalSessionId(omp), omp);
  assert.deepEqual(resolveSessionRoute(prime), { harnessId: 'prime', nativeSessionId: native });
  // Persisted routes must reject noncanonical encodings, not quietly acquire aliases.
  assert.throws(() => canonicalSessionId(`${omp}=`), /Malformed session key/);
  for (const input of [null, undefined, 42, {}, ['id']]) assert.throws(() => canonicalSessionId(input));
});

test('socket framing preserves split UTF-8 and JSON Unicode separators', () => {
  const lines = [];
  const feed = createLineSplitter(line => lines.push(line));
  const message = JSON.stringify({ text: '🦉\u2028middle\u2029end' });
  const bytes = Buffer.from(`\r\n${message}\r\n\nunfinished`);
  // Every possible multibyte boundary is crossed by one-byte chunks.
  for (const byte of bytes) feed(new Uint8Array([byte]));
  assert.deepEqual(lines, [message]);
  feed('\n');
  assert.deepEqual(lines, [message, 'unfinished']);
});

test('request correlation distinguishes numeric/string ids and ignores late responses', async () => {
  const pending = new PendingRequests();
  const numeric = pending.track(1);
  const text = pending.track('1');
  assert.equal(pending.settle('1', true, { owner: 'text' }), true);
  assert.equal(pending.settle(1, true, { owner: 'number' }), true);
  assert.deepEqual(await numeric, { owner: 'number' });
  assert.deepEqual(await text, { owner: 'text' });
  assert.equal(pending.settle(1, true, 'late'), false);
  assert.equal(pending.settle(null, true), false);
});

test('request timeout and socket failure reject and release their pending entries', async () => {
  const pending = new PendingRequests();
  await assert.rejects(pending.track('slow', { timeout: 5, label: 'bridge test' }), /bridge test timed out after 5ms/);
  assert.equal(pending.settle('slow', true, 'late'), false);
  const rejected = assert.rejects(pending.track('rejected'), /wire failure/);
  pending.settle('rejected', false, undefined, 'wire failure');
  await rejected;
  const writeFailure = new Error('write failed');
  const failedWrite = assert.rejects(pending.track('write'), error => error === writeFailure);
  pending.fail('write', writeFailure);
  await failedWrite;
  const disconnected = new Error('disconnected');
  const first = assert.rejects(pending.track('a'), error => error === disconnected);
  const second = assert.rejects(pending.track('b'), error => error === disconnected);
  pending.failAll(disconnected);
  await Promise.all([first, second]);
  assert.equal(pending.settle('a', true), false);
  assert.equal(pending.settle('b', true), false);
});

test('host identity and core stores follow temporary HOME changes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-core-home-'));
  const original = process.env.HOME;
  try {
    process.env.HOME = path.join(home, 'first');
    const first = getHostId();
    assert.equal(getHostId(), first);
    writeStore('settings.json', { hostLabel: ' first host ' });
    assert.equal(getHostLabel(), 'first host');
    process.env.HOME = path.join(home, 'second');
    assert.notEqual(getHostId(), first);
    assert.deepEqual(readStore('settings.json'), {});
    writeStore('settings.json', ['not a record']);
    assert.deepEqual(readStore('settings.json'), {});
    process.env.HOME = path.join(home, 'first');
    assert.equal(getHostId(), first);
    assert.equal(getHostLabel(), 'first host');
  } finally {
    if (original === undefined) delete process.env.HOME;
    else process.env.HOME = original;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('process proofs preserve birth identity and fail closed for incomplete input', { skip: process.platform !== 'linux' }, () => {
  const identity = processIdentity(process.pid);
  assert.ok(identity);
  assert.equal(processIdentityAlive(identity), true);
  assert.equal(processIdentityAlive({ pid: process.pid, startTime: '0' }), false);
  assert.equal(processIdentityAlive({ pid: process.pid }), false);
  assert.equal(processIdentityAlive(null), false);
  assert.deepEqual(inspectProcessAncestry({ pid: process.pid }), { complete: false, processes: [] });
  assert.deepEqual(inspectProcessAncestry({ ...identity, startTime: '0' }), { complete: false, processes: [] });
  const bounded = inspectProcessAncestry(identity, { maxDepth: 1 });
  assert.deepEqual(bounded.processes, [identity]);
  assert.equal(bounded.complete, false);
});
