const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { createSpawnTargets, decodeSpawnChoices, spawnTargetKey } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const payload = name => ({ available: true, servers: [{ name, socket: '/' + name, sessions: [{ name: 'work' }] }] });
const response = data => ({ ok: true, json: async () => data });
function fixture() {
  let host = { hostId: 'a', base: '/a', token: 'fixture-a' }, saved = '/a::work', supported = true;
  const requests = [], changes = [];
  const controller = createSpawnTargets({ host: () => host, supportsTmux: () => supported,
    request: (host, url) => { const wait = deferred(); requests.push({ host, url, ...wait }); return wait.promise; },
    readSaved: () => saved, save: key => { saved = key; }, changed: () => changes.push(plain(controller.current())) });
  return { controller, requests, changes, host: () => host, saved: () => saved,
    select(id) { host = id ? { hostId: id, base: '/' + id, token: 'fixture-' + id } : null; },
    support(value) { supported = value; } };
}

test('tmux payload decoder narrows server/session identity and preserves pinned order', () => {
  const value = payload('a');
  value.servers.push(null, { name: 'bad', socket: 1 }, { name: 'b', socket: '/b', sessions: [null, { name: 1 }, { name: 'second' }] });
  const rows = decodeSpawnChoices(value);
  assert.deepEqual(plain(rows.map(spawnTargetKey)), ['headless', '/a::new', '/b::new', '/a::work', '/b::second']);
  for (const bad of [null, {}, { available: false, servers: value.servers }]) assert.equal(decodeSpawnChoices(bad).length, 1);
});

test('target choices restore preferences and validate the new tmux session name', async () => {
  const f = fixture(), load = f.controller.load();
  f.requests[0].resolve(response(payload('a'))); await load;
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
  f.requests[1].resolve(response(payload('b'))); await newer;
  f.controller.choose('/b::work');
  f.requests[0].resolve(response(payload('a'))); await old;
  assert.deepEqual(plain(f.controller.resume(f.host())), { type: 'tmux', socket: '/b', tmuxSession: 'work' });
  assert.equal(f.controller.resume({ hostId: 'a', base: '/a', token: 'fixture-a' }), null);
  f.select('a');
  assert.equal(f.controller.selected(''), null);
  assert.equal(f.controller.choices().length, 1);
  assert.equal(f.requests[0].host.base, '/a');
  assert.equal(Object.isFrozen(f.requests[0].host), true);
});

test('target body reads cannot publish after close, token change or replacement', async () => {
  for (const action of ['close', 'token', 'replacement']) {
    const f = fixture(), body = deferred(), old = f.controller.load();
    f.requests[0].resolve({ ok: true, json: () => body.promise }); await Promise.resolve();
    if (action === 'close') f.controller.retire();
    else if (action === 'token') f.host().token = 'changed-fixture';
    else {
      const latest = f.controller.load(); f.requests[1].resolve(response(payload('b'))); await latest;
    }
    body.resolve(payload('a')); await old;
    assert.equal(f.controller.choices().some(choice => spawnTargetKey(choice) === '/a::work'), false);
    assert.equal(f.requests[0].host.token, 'fixture-a');
  }
});

test('refresh immediately clears old targets and failed reads leave resume headless', async () => {
  const f = fixture(), initial = f.controller.load();
  f.requests[0].resolve(response(payload('a'))); await initial;
  assert.ok(f.controller.resume(f.host()));
  const next = f.controller.load();
  assert.equal(f.controller.selected(''), null);
  assert.equal(f.controller.resume(f.host()), null);
  f.requests[1].resolve({ ok: false }); await next;
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
