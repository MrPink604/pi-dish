import { assertBrowserApiContext } from './browser-vm.js';
import { present } from './test-types.js';
import type { HostTarget, RequestOptions } from '../src/browser/api-client.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const context = { encodeURIComponent };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
assertBrowserApiContext(context);
const { createSessionSpawns, decodeSpawnId, decodeSpawnStatus, sessionSpawnKey } = context.PiDishBrowser;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve: value => present(resolve)(value) };
}
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture() {
  const reads: Array<Deferred<Response> & { host: HostTarget; path: string; init: RequestOptions | undefined }> = [];
  const events: unknown[][] = [], drafts = new Map<string, string>();
  let current: string | null = null, available = true;
  const controller = createSessionSpawns({
    request: (host, path, init) => { const wait = deferred<Response>(); reads.push({ host, path, init, ...wait }); return wait.promise; },
    delay: async () => {}, harnessLabel: harness => harness.toUpperCase(),
    current: () => current, changed: () => { events.push(['changed']); },
    showPending: key => { current = key; events.push(['show', key]); },
    loadHost: async () => {}, hasSession: () => available,
    selectSession: (id, host) => { events.push(['select', id, host]); }, stashPrompt: () => { events.push(['stash']); },
    saveDraft: (key, draft) => drafts.set(key, draft), migratePrompt: (...args) => { events.push(['migrate', ...args]); },
    discardPrompt: key => { events.push(['discard', key]); },
    showFailure: (key, message) => { events.push(['failure', key, message]); }, status: () => {},
  });
  return { controller, reads, events, drafts, select: (key: string) => { current = key; }, present: (value: boolean) => { available = value; } };
}
const host = { hostId: 'a', base: '/a', token: 'fixture' };

test('spawn wire decoders reject untyped ids and narrow readiness', () => {
  for (const wire of [null, {}, { spawnId: 4 }, { spawnId: '' }]) assert.throws(() => decodeSpawnId(wire), /Failed/);
  assert.equal(decodeSpawnId({ spawnId: 'id', extra: true }), 'id');
  assert.deepEqual(plain(decodeSpawnStatus({ status: 'error', error: {} })), { status: 'error', error: 'Session failed to start' });
  assert.deepEqual(plain(decodeSpawnStatus({ status: 'ready', sessionId: 'ready' })), { status: 'ready', sessionId: 'ready' });
  assert.throws(() => decodeSpawnStatus({ status: 'ready', sessionId: 7 }), /invalid result/);
});

test('submitted spawns copy their host, target and draft before acceptance and keep replacement views', async () => {
  const f = fixture(), endpoint = { ...host };
  const target: { type: 'tmux'; socket: string; tmuxSession: string } = { type: 'tmux', socket: '/sock', tmuxSession: 'original' };
  let owned = true;
  const input = { host: endpoint, cwd: '/old', draft: 'old draft', target, ownsView: () => owned };
  const submit = f.controller.submit(input);
  endpoint.base = '/changed'; endpoint.token = 'changed'; target.tmuxSession = 'changed'; input.draft = 'new draft'; owned = false;
  present(f.reads[0]).resolve(response({ spawnId: 'op' })); const key = await submit;
  const statusRead = present(f.reads[1]), kickoff = present(f.reads[0]);
  assert.equal(typeof statusRead.host === 'object' && statusRead.host ? statusRead.host.base : undefined, '/a');
  assert.equal(typeof statusRead.host === 'object' && statusRead.host ? statusRead.host.token : undefined, 'fixture');
  if (typeof kickoff.init?.body !== 'string') throw new Error('Spawn kickoff lacks JSON body');
  assert.equal(plain(JSON.parse(kickoff.init.body)).target.tmuxSession, 'original');
  assert.equal(f.drafts.get(key), 'old draft'); assert.ok(!f.events.some(event => event[0] === 'show'));
  statusRead.resolve(response({ status: 'ready', sessionId: 'session' })); await settle();
  assert.equal(f.controller.has(key), false);
  assert.ok(f.events.some(event => JSON.stringify(event) === JSON.stringify(['migrate', key, 'a', 'session'])));
  assert.ok(!f.events.some(event => event[0] === 'select' || event[0] === 'stash'));
});

test('identical operation ids from different hosts remain distinct and readiness selects only the current one', async () => {
  const f = fixture();
  const first = f.controller.submit({ host, ownsView: () => true });
  present(f.reads[0]).resolve(response({ spawnId: 'same' })); const a = await first;
  const second = f.controller.submit({ host: { hostId: 'b', base: '/b' }, ownsView: () => true });
  present(f.reads[2]).resolve(response({ spawnId: 'same' })); const b = await second;
  assert.notEqual(a, b); assert.equal(a, sessionSpawnKey('a', 'same')); assert.equal(f.controller.entries().length, 2);
  present(f.reads[1]).resolve(response({ status: 'ready', sessionId: 'same-session' })); await settle();
  assert.ok(!f.events.some(event => event[0] === 'select'));
  present(f.reads[3]).resolve(response({ status: 'ready', sessionId: 'same-session' })); await settle();
  assert.deepEqual(f.events.filter(event => event[0] === 'select'), [['select', 'same-session', 'b']]);
  assert.equal(f.controller.entries().length, 0);
});

test('a failed background spawn discards only its composer while the current failure preserves its draft', async () => {
  const f = fixture();
  const first = f.controller.submit({ host, ownsView: () => true });
  present(f.reads[0]).resolve(response({ spawnId: 'old' })); const old = await first;
  const second = f.controller.submit({ host, ownsView: () => true });
  present(f.reads[2]).resolve(response({ spawnId: 'new' })); const current = await second;
  present(f.reads[1]).resolve(response({ status: 'error', error: 'old failure' })); await settle();
  assert.ok(f.events.some(event => event[0] === 'discard' && event[1] === old));
  assert.ok(!f.events.some(event => event[0] === 'failure'));
  present(f.reads[3]).resolve(response({ status: 'error', error: 'current failure' })); await settle();
  assert.ok(f.events.some(event => event[0] === 'failure' && event[1] === current));
  assert.ok(!f.events.some(event => event[0] === 'discard' && event[1] === current));
});

export {};
