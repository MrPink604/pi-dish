const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripQueryField } = require('../public/helpers');
const context = { URLSearchParams };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { createHostSessionLoader, ApiHttpError } = context.PiDishBrowser;

function fixture() {
  let sequence = 1;
  const calls = [], events = [];
  const loader = createHostSessionLoader({
    requestList: (host, path, options) => new Promise((resolve, reject) => calls.push({ host, path, options, resolve, reject })),
    currentSequence: () => sequence,
    stripHostQuery: query => stripQueryField(query, 'host'),
    onConnection: (host, event) => events.push({ type: 'connection', host, event }),
    onIndexing: () => events.push({ type: 'indexing' }),
    beforePublish: (host, lists, wireQuery) => events.push({ type: 'before', host, lists, wireQuery }),
    onPublish: query => events.push({ type: 'publish', query }),
    onError: (host, error) => events.push({ type: 'error', host, error }),
  });
  return { loader, calls, events, setSequence: value => { sequence = value; } };
}
const host = { hostId: 'peer', base: '/hosts/peer' };
const rows = name => ({ active: [{ id: 'one', name }], previous: [] });

test('identical host polls share a request and publish for the newest joining query', async () => {
  const { loader, calls, events, setSequence } = fixture();
  const first = loader.load(host, 'host:old needle', false, 1);
  setSequence(2);
  const joined = loader.load(host, 'host:new needle', false, 2);
  assert.equal(first, joined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].path, 'http://fixture');
  assert.equal(url.searchParams.get('q'), 'needle');
  assert.equal(url.searchParams.get('active'), '1');
  assert.equal(url.searchParams.get('view'), 'client');
  assert.equal(calls[0].options.timeoutMs, 20000);
  calls[0].resolve(rows('current'));
  await joined;
  assert.deepEqual(events.map(e => e.type), ['connection', 'before', 'publish']);
  assert.equal(events[1].wireQuery, 'needle');
  assert.equal(events[2].query, 'host:new needle');
  assert.equal(loader.getCache(host).active[0].name, 'current');
});

test('superseded responses cannot publish or clear a newer in-flight request', async () => {
  const { loader, calls, events, setSequence } = fixture();
  const first = loader.load(host, 'old', true, 1);
  setSequence(2);
  const second = loader.load(host, 'new', true, 2);
  calls[0].resolve(rows('stale'));
  await first;
  assert.equal(loader.getCache(host), undefined);
  assert.equal(events.length, 0);
  assert.equal(loader.load(host, 'new', true, 2), second, 'old finally must not erase the new request');
  assert.equal(calls.length, 2);
  calls[1].resolve(rows('fresh'));
  await second;
  assert.equal(loader.getCache(host).active[0].name, 'fresh');
});

test('hosts publish independently and an obsolete fan-out cannot change cached rows', async () => {
  const { loader, calls, events, setSequence } = fixture();
  const self = { hostId: 'self', base: '', self: true };
  const slow = loader.load(host, undefined, true, 1);
  const fast = loader.load(self, undefined, true, 1);
  calls[1].resolve(rows('local'));
  await fast;
  assert.equal(loader.getCache(self).active[0].name, 'local');
  assert.equal(loader.getCache(host), undefined);
  setSequence(2);
  calls[0].resolve(rows('obsolete query'));
  await slow;
  assert.equal(loader.getCache(host), undefined);
  assert.equal(events.filter(e => e.type === 'publish').length, 1);
});

test('active polls preserve advisory family hints and merge live children until a full refresh', async () => {
  const { loader, calls, events } = fixture();
  let pending = loader.load(host, undefined, true, 1);
  calls[0].resolve({
    active: [{ id: 'one', parentId: 'parent', parentSource: 'native', familyParentId: 'family' }],
    previous: [{ id: 'child', name: 'old', subagentLive: true }, { id: 'finished', subagentLive: true }], indexing: true,
  });
  await pending;
  assert.equal(loader.isIndexing(), true);
  assert.equal(events.filter(e => e.type === 'indexing').length, 1);
  pending = loader.load(host, undefined, false, 1);
  const incoming = { active: [{ id: 'one', name: 'fresh' }], previous: [], children: [{ id: 'child', name: 'live', subagentLive: true }, { id: 'new', subagentLive: true }] };
  calls[1].resolve(incoming);
  await pending;
  const cached = loader.getCache(host);
  assert.equal(cached.active[0].parentId, 'parent');
  assert.equal(cached.active[0].parentSource, 'native');
  assert.equal(cached.active[0].familyParentId, 'family');
  assert.equal(incoming.active[0].parentId, undefined, 'hint merging does not mutate the wire row');
  assert.deepEqual(Array.from(cached.previous, row => [row.id, row.name, row.subagentLive]), [
    ['child', 'live', true], ['finished', undefined, false], ['new', undefined, true],
  ]);
  assert.equal(loader.isIndexing(), true, 'active-only responses cannot end full-list indexing');
  pending = loader.load(host, undefined, true, 1);
  calls[2].resolve(rows('full refresh'));
  await pending;
  assert.equal(loader.getCache(host).active[0].parentId, undefined);
  assert.equal(loader.getCache(host).previous.length, 0);
  assert.equal(loader.isIndexing(), false);
});

test('failed and unauthorized polls retain cached rows and report the current host state', async () => {
  const { loader, calls, events } = fixture();
  let pending = loader.load(host, undefined, true, 1);
  calls[0].resolve(rows('cached'));
  await pending;
  const cached = loader.getCache(host);
  events.length = 0;
  pending = loader.load(host, undefined, true, 1);
  calls[1].reject(new ApiHttpError('Unauthorized', 401));
  await pending;
  assert.equal(loader.getCache(host), cached);
  assert.deepEqual(events.map(e => e.type), ['connection', 'publish']);
  assert.equal(events[0].event, 'blocked');
  assert.equal(events[1].query, undefined, 'a failure must not claim the lists match a different query');
  events.length = 0;
  pending = loader.load(host, undefined, true, 1);
  const offline = new Error('offline');
  calls[2].reject(offline);
  await pending;
  assert.equal(loader.getCache(host), cached);
  assert.deepEqual(events.map(e => e.type), ['connection', 'error', 'publish']);
  assert.equal(events[0].event.error, offline);
});

test('pruning retires old requests even when the same host is added again', async () => {
  const { loader, calls, events } = fixture();
  let pending = loader.load(host, undefined, true, 1);
  calls[0].resolve({ ...rows('cached'), indexing: true });
  await pending;
  const old = loader.load(host, undefined, true, 1);
  loader.prune(new Set());
  assert.equal(loader.getCache(host), undefined);
  assert.equal(loader.isIndexing(), false);
  events.length = 0;
  pending = loader.load(host, undefined, true, 1);
  calls[2].resolve(rows('replacement'));
  await pending;
  const count = events.length;
  calls[1].resolve({ ...rows('retired'), indexing: true });
  await old;
  assert.equal(events.length, count);
  assert.equal(loader.getCache(host).active[0].name, 'replacement');
  assert.equal(loader.isIndexing(), false);
});

test('a changed host endpoint starts a new request and a retired 401 cannot block its success', async () => {
  const { loader, calls, events } = fixture();
  const mutable = { ...host, token: 'fixture-old' };
  const old = loader.load(mutable, undefined, true, 1);
  mutable.base = '/hosts/replacement';
  mutable.token = 'fixture-new';
  const replacement = loader.load(mutable, undefined, true, 1);
  assert.notEqual(old, replacement);
  assert.equal(calls[0].host.base, '/hosts/peer');
  assert.equal(calls[0].host.token, 'fixture-old');
  assert.equal(Object.isFrozen(calls[0].host), true);
  calls[1].resolve(rows('replacement'));
  await replacement;
  const count = events.length;
  calls[0].reject(new ApiHttpError('Unauthorized', 401));
  await old;
  assert.equal(events.length, count);
  assert.equal(loader.getCache(mutable).active[0].name, 'replacement');
});
