const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { createHostDiscovery, decodeHostDescriptor, reconcileHostCatalog } = context.PiDishBrowser;
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const descriptor = (hostId = 'peer', label = 'Peer') => ({ hostId, label, capabilities: { terminal: true } });
function fixture(overrides = {}) {
  let sources = [{ base: '/hosts/peer', hostId: 'peer', token: 'fixture' }];
  let hosts = [{ ...sources[0], key: 'peer', source: 'user' }];
  let now = 100000;
  const calls = [], events = [], waiters = new Map();
  const pending = (host, url, options) => new Promise((resolve, reject) => {
    const call = { host, url, options, resolve, reject };
    const index = calls.length;
    calls.push(call);
    waiters.get(index)?.(call);
  });
  const waitForCall = index => calls[index] ? Promise.resolve(calls[index])
    : new Promise(resolve => waiters.set(index, resolve));
  const discovery = createHostDiscovery({
    request: pending,
    requestSelf: () => pending(null, 'self'),
    hosts: () => hosts,
    pollableHosts: () => hosts,
    sourceFor: host => sources.find(row => row.base === host.base) || null,
    onSelf: data => events.push(['self', data]),
    onFleet: data => events.push(['fleet', data]),
    onIdentified: (host, source, data) => {
      source.hostId = host.hostId = data.hostId;
      events.push(['identified', host, source, data]);
    },
    onConnection: (host, event) => events.push(['connection', host, event]),
    afterFleet: () => events.push(['afterFleet']),
    now: () => now,
    ...overrides,
  });
  return { discovery, calls, events, waitForCall, getSources: () => sources, getHosts: () => hosts,
    setSources: value => { sources = value; }, setHosts: value => { hosts = value; },
    setNow: value => { now = value; } };
}

test('descriptor decoding validates identity and preserves opaque capability/version values', () => {
  for (const raw of [null, [], 4, {}, { hostId: 4 }, { hostId: '' }]) assert.equal(decodeHostDescriptor(raw), null);
  const decoded = decodeHostDescriptor({ hostId: 'peer', label: 7, version: { future: true }, capabilities: ['future'] });
  assert.equal(decoded.hostId, 'peer');
  assert.equal(decoded.label, 7);
  assert.deepEqual(decoded.version, { future: true });
  assert.deepEqual(decoded.capabilities, ['future']);
});

test('self identity accepts only the latest request and preserves older-server fallback', async () => {
  const { discovery, calls, events } = fixture();
  const old = discovery.loadIdentity();
  const current = discovery.loadIdentity();
  calls[1].resolve(response(descriptor('self-new')));
  await current;
  calls[0].resolve(response(descriptor('self-old')));
  await old;
  assert.deepEqual(events.map(e => [e[0], e[1].hostId]), [['self', 'self-new']]);
  const missing = discovery.loadIdentity();
  calls[2].resolve(response(null, 404));
  await missing;
  assert.equal(events.length, 1);
});

for (const failure of [false, true]) test(`a superseded descriptor ${failure ? '401' : 'success'} cannot replace newer metadata or connection state`, async () => {
  const { discovery, calls, events } = fixture();
  const old = discovery.identify(true);
  const current = discovery.identify(true);
  calls[1].resolve(response(descriptor('peer', 'New')));
  await current;
  calls[0].resolve(response(descriptor('other', 'Old'), failure ? 401 : 200));
  await old;
  assert.equal(discovery.descriptor('peer').label, 'New');
  assert.equal(discovery.descriptor('other'), undefined);
  assert.deepEqual(events.map(e => e[0]), ['identified', 'connection']);
  assert.equal(events[1][2], 'success');
});

test('removed and re-added sources cannot inherit the old descriptor request', async () => {
  const { discovery, calls, events, getSources, setSources } = fixture();
  const old = discovery.identify(true);
  setSources(getSources().map(row => ({ ...row })));
  calls[0].resolve(response(descriptor('wrong')));
  await old;
  assert.equal(events.length, 0);
  assert.equal(discovery.descriptor('wrong'), undefined);
  assert.equal(getSources()[0].hostId, 'peer');
});

test('in-place credential changes retire requests and routing was captured before awaiting', async () => {
  const { discovery, calls, events, getSources, getHosts } = fixture();
  const old = discovery.identify(true);
  getSources()[0].token = getHosts()[0].token = 'new-fixture';
  assert.equal(calls[0].host.token, 'fixture');
  assert.equal(calls[0].host.base, '/hosts/peer');
  assert.equal(calls[0].options.timeoutMs, 8000);
  assert.equal(Object.isFrozen(calls[0].host), true);
  calls[0].reject(new Error('old failure'));
  await old;
  assert.equal(events.length, 0);
});

test('an entry hidden by a new effective route cannot publish a descriptor', async () => {
  const { discovery, calls, events, getHosts, setHosts } = fixture();
  const old = discovery.identify(true);
  setHosts([{ ...getHosts()[0], source: 'fleet', base: '/hosts/new-route' }]);
  calls[0].resolve(response(descriptor()));
  await old;
  assert.equal(events.length, 0);
});

test('ownership is rechecked after delayed response body decoding', async () => {
  const { discovery, calls, events, setSources } = fixture();
  let finishBody, markBodyStarted;
  const bodyStarted = new Promise(resolve => { markBodyStarted = resolve; });
  const old = discovery.identify(true);
  calls[0].resolve({ ok: true, status: 200, json: () => new Promise(resolve => {
    finishBody = resolve;
    markBodyStarted();
  }) });
  await bodyStarted;
  setSources([]);
  finishBody(descriptor());
  await old;
  assert.equal(events.length, 0);
});

test('current descriptor failures are isolated and remembered descriptors skip non-refresh reads', async () => {
  const { discovery, calls, events } = fixture();
  let pending = discovery.identify();
  calls[0].resolve(response(null, 401));
  await pending;
  assert.equal(events[0][2], 'blocked');
  pending = discovery.identify();
  calls[1].resolve(response(null, 503));
  await pending;
  assert.equal(events[1][2].type, 'failure');
  pending = discovery.identify();
  calls[2].resolve(response({ hostId: 3 }));
  await pending;
  assert.equal(events.length, 2, 'invalid identity does not count as reachable');
  discovery.rememberDescriptor(descriptor());
  await discovery.identify();
  assert.equal(calls.length, 3);
  pending = discovery.identify(true);
  calls[3].resolve(response(descriptor()));
  await pending;
  assert.equal(events.at(-1)[2], 'success');
});

test('fleet results reject old completions, isolate malformed rows and preserve refresh timing', async () => {
  const { discovery, calls, events, setHosts, setNow } = fixture();
  setHosts([]);
  const old = discovery.loadFleet();
  const current = discovery.loadFleet();
  assert.equal(calls[0].options.timeoutMs, 10000);
  calls[1].resolve(response({ hosts: [null, 7, [], { self: true, label: 'Self' }, { base: '/hosts/new' }] }));
  await current;
  calls[0].resolve(response({ hosts: [{ base: '/hosts/old' }] }));
  await old;
  assert.deepEqual(events.map(e => e[0]), ['fleet', 'afterFleet']);
  assert.equal(events[0][1].hosts.length, 1);
  assert.equal(events[0][1].hosts[0].base, '/hosts/new');
  assert.equal(events[0][1].selfLabel, 'Self');
  setNow(159999);
  discovery.refreshSoon();
  assert.equal(calls.length, 2);
  setNow(160000);
  discovery.refreshSoon();
  discovery.refreshSoon();
  assert.equal(calls.length, 3, 'a new attempt resets the timer immediately');
  calls[2].resolve(response(null, 404));
  await Promise.resolve();
  assert.equal(events.length, 2);
});

test('a failed newer fleet refresh preserves the render owed by the current published list', async () => {
  const { discovery, calls, events, waitForCall } = fixture();
  const old = discovery.loadFleet();
  calls[0].resolve(response({ hosts: [] }));
  assert.equal((await waitForCall(1)).url, '/api/host');
  const current = discovery.loadFleet();
  calls[2].resolve(response(null, 404));
  await current;
  calls[1].resolve(response(descriptor()));
  await old;
  assert.equal(events.filter(e => e[0] === 'afterFleet').length, 1);
});


test('a persistence failure after learning identity still reports failure for the owned source', async () => {
  const { discovery, calls, events } = fixture({
    onIdentified: (host, source, data) => {
      host.hostId = source.hostId = data.hostId;
      throw new Error('storage unavailable');
    },
  });
  const pending = discovery.identify(true);
  calls[0].resolve(response(descriptor('new-identity')));
  await pending;
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'connection');
  assert.equal(events[0][2].type, 'failure');
  assert.equal(events[0][2].error.message, 'storage unavailable');
});


test('a superseded fleet waiter stays pending until the latest load settles', async () => {
  const { discovery, calls, events, setHosts } = fixture();
  setHosts([]);
  let ready = false;
  const startup = discovery.loadFleet().then(() => { ready = true; });
  const replacement = discovery.loadFleet();
  calls[0].resolve(response({ hosts: [{ base: '/hosts/old' }] }));
  // Drain a full event-loop turn to observe any premature readiness resolution.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, false);
  assert.equal(events.length, 0);
  calls[1].resolve(response({ hosts: [{ base: '/hosts/current' }] }));
  await Promise.all([startup, replacement]);
  assert.equal(ready, true);
  assert.equal(events[0][1].hosts[0].base, '/hosts/current');
});

test('fleet waiters follow repeated replacements without allowing old publication callbacks', async () => {
  const { discovery, calls, events, waitForCall } = fixture();
  let ready = false;
  const first = discovery.loadFleet().then(() => { ready = true; });
  calls[0].resolve(response({ hosts: [] }));
  await waitForCall(1); // First publication's peer descriptor is pending.
  const second = discovery.loadFleet();
  const third = discovery.loadFleet();
  calls[2].resolve(response({ hosts: [{ base: '/hosts/superseded' }] }));
  calls[3].resolve(response({ hosts: [{ base: '/hosts/current' }] }));
  await waitForCall(4); // Third publication starts the replacement descriptor.
  calls[1].resolve(response(descriptor('peer', 'Old')));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, false);
  assert.equal(events.filter(e => e[0] === 'afterFleet').length, 0);
  calls[4].resolve(response(descriptor('peer', 'Current')));
  await Promise.all([first, second, third]);
  assert.equal(ready, true);
  assert.equal(events.filter(e => e[0] === 'afterFleet').length, 1);
});

test('saving a catalog preserves unrelated source owners while removing changed or extra fields', async () => {
  const { discovery, calls, events, getSources, setSources } = fixture();
  const unchanged = getSources()[0];
  const current = discovery.identify(true);
  const extra = { base: '/hosts/extra', hostId: 'extra', capabilities: { terminal: true } };
  const whitespace = { base: '/hosts/space', label: ' Space ' };
  setSources(reconcileHostCatalog([unchanged, extra, whitespace]));
  assert.equal(getSources()[0], unchanged, 'unrelated discovery keeps its owner');
  assert.notEqual(getSources()[1], extra);
  assert.equal(getSources()[1].capabilities, undefined);
  assert.notEqual(getSources()[2], whitespace);
  assert.equal(getSources()[2].label, 'Space');
  calls[0].resolve(response(descriptor()));
  await current;
  assert.equal(events[0][0], 'identified');
});
