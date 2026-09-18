import { assertBrowserApiContext } from './browser-vm.js';
import { present } from './test-types.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
assertBrowserApiContext(context);
const { createHarnessDiscovery } = context.PiDishBrowser;
const catalog = (id: string) => ({ harnesses: [{ id, label: id, available: true }] });

interface Request {
  kind: string;
  target: string | null;
  resolve(value: unknown): void;
  reject(reason?: unknown): void;
}
function fixture() {
  let host: string | null = 'self', self: string | null = 'self', preferred: string | null = null;
  const calls: Request[] = [], events: unknown[][] = [];
  const request = (kind: string) => (target: string | null) => new Promise<unknown>((resolve, reject) => calls.push({ kind, target, resolve, reject }));
  const discovery = createHarnessDiscovery({
    selectedHostId: () => host,
    selfHostId: () => self,
    requestPicker: request('picker'),
    requestBackground: request('background'),
    preferredHarness: () => preferred,
    onPreferredHarness: id => { events.push(['preferred', id]); },
    onPickerChange: () => { events.push(['picker']); },
    onCacheChange: () => { events.push(['cache']); },
  });
  return { discovery, calls, events, setHost: (value: string | null) => { host = value; },
    setSelf: (value: string | null) => { self = value; }, setPreferred: (value: string | null) => { preferred = value; } };
}

for (const failure of [false, true]) test(`retired picker ${failure ? 'failure' : 'success'} cannot change rows or cache`, async () => {
  const { discovery, calls, events, setPreferred } = fixture();
  const old = discovery.load();
  const current = discovery.load();
  setPreferred('omp');
  present(calls[1]).resolve(catalog('omp'));
  await current;
  if (failure) present(calls[0]).reject(new Error('offline'));
  else present(calls[0]).resolve(catalog('pi'));
  await old;
  assert.equal(present(discovery.rows()[0]).id, 'omp');
  assert.equal(present(discovery.cachedRows('self'))[0]?.id, 'omp');
  assert.deepEqual(events, [['cache'], ['preferred', 'omp'], ['picker']]);
});

test('switching hosts retires picker writes; cache keys capture the self alias before awaiting', async () => {
  const { discovery, calls, events, setHost, setSelf } = fixture();
  const old = discovery.load();
  setHost('peer');
  present(calls[0]).resolve(catalog('omp'));
  await old;
  assert.equal(discovery.cachedRows('self'), undefined);
  assert.equal(events.length, 0);
  setHost(null);
  const current = discovery.load();
  setSelf('renamed-self');
  present(calls[1]).resolve(catalog('prime'));
  await current;
  assert.equal(present(discovery.cachedRows('self'))[0]?.id, 'prime');
  assert.equal(discovery.cachedRows('renamed-self'), undefined);
});

test('background discovery shares requests per host and retries failure independently', async () => {
  const { discovery, calls, events } = fixture();
  const first = discovery.ensure(null);
  assert.equal(discovery.ensure('self'), first);
  const peer = discovery.ensure('peer');
  assert.deepEqual(calls.map(call => call.target), ['self', 'peer']);
  present(calls[0]).reject(new Error('offline'));
  present(calls[1]).resolve({ harnesses: [{ id: 'omp', pilotConfig: true }] });
  await Promise.all([first, peer]);
  assert.equal(discovery.cachedRows(null), undefined);
  assert.equal(present(discovery.row('peer', 'omp')).pilotConfig, true);
  assert.equal(discovery.row('self', 'omp'), null);
  await discovery.ensure('peer');
  assert.equal(calls.length, 2);
  const retry = discovery.ensure(null);
  present(calls[2]).resolve({ harnesses: [] });
  await retry;
  await discovery.ensure(null);
  assert.equal(calls.length, 3, 'successful empty catalogs are cached');
  assert.deepEqual(events, [['cache'], ['cache']]);
});

test('a delayed background catalog cannot replace a newer picker catalog', async () => {
  const { discovery, calls, events } = fixture();
  const background = discovery.ensure('self');
  const foreground = discovery.load();
  present(calls[1]).resolve({ harnesses: [{ id: 'omp', pilotConfig: true }] });
  await foreground;
  present(calls[0]).resolve(catalog('pi'));
  await background;
  assert.equal(present(discovery.row('self', 'omp')).pilotConfig, true);
  assert.equal(discovery.row('self', 'pi'), null);
  assert.deepEqual(events, [['cache'], ['picker']]);
});

test('malformed rows are isolated, missing flags remain optional, and failed discovery retains the cache', async () => {
  const { discovery, calls, events, setPreferred } = fixture();
  setPreferred('disabled');
  let pending = discovery.load();
  present(calls[0]).resolve({ harnesses: [null, 7, {}, { id: 8 }, { id: '' },
    { id: 'omp', label: {}, pilotConfig: { legacy: true }, extra: 'kept' },
    { id: 'disabled', available: false }] });
  await pending;
  const first = present(discovery.rows()[0]);
  assert.deepEqual(Array.from(discovery.rows(), row => row.id), ['omp', 'disabled']);
  assert.equal(first.label, undefined);
  assert.equal(first.available, undefined);
  assert.equal(first.extra, 'kept');
  assert.deepEqual(events, [['cache'], ['picker']]);
  pending = discovery.load();
  present(calls[1]).resolve({ harnesses: [] });
  await pending;
  assert.equal(present(discovery.rows()[0]).id, 'omp', 'empty response keeps the existing picker');
  pending = discovery.load();
  present(calls[2]).reject(new Error('HTTP 404'));
  await pending;
  assert.equal(present(discovery.rows()[0]).id, 'pi', 'older servers retain the Pi fallback');
  assert.equal(present(discovery.cachedRows('self'))[0]?.id, 'omp', 'failure does not erase settings metadata');
});

export {};
