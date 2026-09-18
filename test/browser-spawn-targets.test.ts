import { assertBrowserApiContext } from './browser-vm.js';
import { present } from './test-types.js';
import type { HostTarget } from '../src/browser/api-client.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
assertBrowserApiContext(context);
const { createSpawnTargets, decodeSpawnChoices, spawnTargetKey } = context.PiDishBrowser;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve: value => present(resolve)(value) };
}
const payload = (name: string) => ({ available: true, servers: [{ name, socket: '/' + name, sessions: [{ name: 'work' }] }] });
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
function fixture() {
  let host: { hostId: string; base: string; token: string } | null = { hostId: 'a', base: '/a', token: 'fixture-a' }, saved = '/a::work', supported = true;
  const requests: Array<Deferred<Response> & { host: HostTarget; url: string }> = [], changes: unknown[] = [];
  const controller = createSpawnTargets({ host: () => host, supportsTmux: () => supported,
    request: (target, url) => { const wait = deferred<Response>(); requests.push({ host: target, url, ...wait }); return wait.promise; },
    readSaved: () => saved, save: key => { saved = key; }, changed: () => { changes.push(plain(controller.current())); } });
  return { controller, requests, changes, host: () => host, saved: () => saved,
    select(id: string | null) { host = id ? { hostId: id, base: '/' + id, token: 'fixture-' + id } : null; },
    support(value: boolean) { supported = value; } };
}

test('tmux payload decoder narrows server/session identity and preserves pinned order', () => {
  const servers: unknown[] = [...payload('a').servers];
  const value = { available: true, servers };
  servers.push(null, { name: 'bad', socket: 1 }, { name: 'b', socket: '/b', sessions: [null, { name: 1 }, { name: 'second' }] });
  const rows = decodeSpawnChoices(value);
  assert.deepEqual(plain(rows.map(spawnTargetKey)), ['headless', '/a::new', '/b::new', '/a::work', '/b::second']);
  for (const bad of [null, {}, { available: false, servers: value.servers }]) assert.equal(decodeSpawnChoices(bad).length, 1);
});

test('target choices restore preferences and validate the new tmux session name', async () => {
  const f = fixture(), load = f.controller.load();
  present(f.requests[0]).resolve(response(payload('a'))); await load;
  assert.deepEqual(plain(f.controller.selected('')), { type: 'tmux', socket: '/a', tmuxSession: 'work' });
  assert.equal(f.controller.choose('/a::new'), true);
  assert.throws(() => f.controller.selected('  '), /Enter a name/);
  assert.deepEqual(plain(f.controller.selected(' next ')), { type: 'tmux', socket: '/a', newTmuxSession: 'next' });
  assert.equal(f.controller.resume(f.host()), null);
  assert.equal(f.controller.choose('missing'), false);
  assert.equal(f.saved(), '/a::new');
});

test('targets retire old host requests and route saved resume choices to their catalog owner', async () => {
  const f = fixture(), old = f.controller.load();
  f.select('b'); const newer = f.controller.load();
  present(f.requests[1]).resolve(response(payload('b'))); await newer;
  f.controller.choose('/b::work');
  present(f.requests[0]).resolve(response(payload('a'))); await old;
  assert.deepEqual(plain(f.controller.resume(present(f.host()))), { type: 'tmux', socket: '/b', tmuxSession: 'work' });
  assert.equal(f.controller.resume({ hostId: 'a', base: '/a', token: 'fixture-a' }), null);
  f.select('a');
  assert.equal(f.controller.selected(''), null);
  assert.equal(f.controller.choices().length, 1);
  const firstRequest = present(f.requests[0]);
  assert.equal(typeof firstRequest.host === 'object' && firstRequest.host ? firstRequest.host.base : undefined, '/a');
  assert.equal(Object.isFrozen(firstRequest.host), true);
});

test('target body reads cannot publish after close, token change or replacement', async () => {
  for (const action of ['close', 'token', 'replacement']) {
    const f = fixture(), body = deferred<unknown>(), old = f.controller.load();
    const delayed = new Response('{}');
    Object.defineProperty(delayed, 'json', { value: () => body.promise });
    present(f.requests[0]).resolve(delayed); await Promise.resolve();
    if (action === 'close') f.controller.retire();
    else if (action === 'token') present(f.host()).token = 'changed-fixture';
    else {
      const latest = f.controller.load(); present(f.requests[1]).resolve(response(payload('b'))); await latest;
    }
    body.resolve(payload('a')); await old;
    assert.equal(f.controller.choices().some(choice => spawnTargetKey(choice) === '/a::work'), false);
    const firstRequest = present(f.requests[0]);
    assert.equal(typeof firstRequest.host === 'object' && firstRequest.host ? firstRequest.host.token : undefined, 'fixture-a');
  }
});

test('refresh immediately clears old targets and failed reads leave resume headless', async () => {
  const f = fixture(), initial = f.controller.load();
  present(f.requests[0]).resolve(response(payload('a'))); await initial;
  assert.ok(f.controller.resume(present(f.host())));
  const next = f.controller.load();
  assert.equal(f.controller.selected(''), null);
  assert.equal(f.controller.resume(present(f.host())), null);
  present(f.requests[1]).resolve(new Response('{}', { status: 500 })); await next;
  assert.equal(f.controller.current().target, null);
  assert.equal(f.saved(), '/a::work');
});

test('unsupported or removed hosts do not read or inherit target choices', async () => {
  const f = fixture(); f.support(false); await f.controller.load();
  assert.equal(f.requests.length, 0);
  f.support(true); f.select(null); await f.controller.load();
  assert.equal(f.requests.length, 0);
  assert.equal(f.controller.selected(''), null);
});

export {};
