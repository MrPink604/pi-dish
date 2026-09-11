const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { createDirectoryCatalog, decodeKnownDirectories, decodeDirectoryChildren } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let selected = { hostId: 'a', base: '/hosts/a', token: 'a-fixture' };
  const requests = [];
  const catalog = createDirectoryCatalog({ host: () => selected, request: (host, url) => {
    const response = deferred(); requests.push({ host, url, ...response }); return response.promise;
  } });
  return { catalog, requests, select(hostId, token = hostId + '-fixture') { selected = hostId ? { hostId, base: '/hosts/' + hostId, token } : null; },
    current: () => selected };
}
const row = short => ({ path: '/home/fixture/' + short.slice(2), short });
const response = rows => ({ ok: true, json: async () => rows });

test('directory boundaries narrow only the fields consumed by the views', () => {
  assert.deepEqual(plain(decodeKnownDirectories([row('~/a'), null, { path: 1, short: 'bad' }, { path: '/a', short: 2 }])), [row('~/a')]);
  assert.deepEqual(plain(decodeKnownDirectories({ error: 'bad' })), []);
  assert.deepEqual(plain(decodeDirectoryChildren({ dirs: [{ path: '/a', name: 'a' }, { path: '/b', name: null }] })), { dirs: [{ path: '/a', name: 'a' }], error: false });
  assert.equal(decodeDirectoryChildren(null).error, true);
  assert.equal(decodeDirectoryChildren({ error: 'unreadable', dirs: [] }).error, true);
});

test('known directory rows disappear immediately when their selected host changes', async () => {
  const f = fixture();
  const first = f.catalog.load();
  f.requests[0].resolve(response([row('~/a')])); await first;
  assert.deepEqual(plain(f.catalog.current()), [row('~/a')]);
  f.select('b');
  assert.deepEqual(plain(f.catalog.current()), []);
  const second = f.catalog.load();
  f.requests[1].resolve(response([row('~/b')])); await second;
  assert.deepEqual(plain(f.catalog.current()), [row('~/b')]);
});

test('an older host request cannot replace the current host directory catalog', async () => {
  const f = fixture();
  const first = f.catalog.load();
  f.select('b');
  const second = f.catalog.load();
  f.requests[1].resolve(response([row('~/b')])); await second;
  f.requests[0].resolve(response([row('~/retired-a')])); await first;
  assert.deepEqual(plain(f.catalog.current()), [row('~/b')]);
  assert.equal(f.requests[0].host.base, '/hosts/a');
  assert.equal(f.requests[0].host.token, 'a-fixture');
  assert.equal(Object.isFrozen(f.requests[0].host), true);
});

test('directory body reads retire after a new request, close, or changed credentials', async () => {
  for (const action of ['newer', 'close', 'token']) {
    const f = fixture(), body = deferred();
    const first = f.catalog.load();
    f.requests[0].resolve({ ok: true, json: () => body.promise });
    await Promise.resolve();
    if (action === 'newer') {
      const second = f.catalog.load();
      f.requests[1].resolve(response([row('~/new')])); await second;
    } else if (action === 'close') f.catalog.retire();
    else f.current().token = 'replacement-fixture';
    body.resolve([row('~/retired')]); await first;
    assert.deepEqual(plain(f.catalog.current()), action === 'newer' ? [row('~/new')] : []);
    assert.equal(f.requests[0].host.token, 'a-fixture');
  }
});

test('failed directory refresh retains only the same host previous catalog', async () => {
  const f = fixture();
  const first = f.catalog.load(); f.requests[0].resolve(response([row('~/saved')])); await first;
  const failed = f.catalog.load(); f.requests[1].resolve({ ok: false }); await failed;
  assert.deepEqual(plain(f.catalog.current()), [row('~/saved')]);
  f.select(null); await f.catalog.load();
  assert.equal(f.requests.length, 2);
  assert.deepEqual(plain(f.catalog.current()), []);
});
