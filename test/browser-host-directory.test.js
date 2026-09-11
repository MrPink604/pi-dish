const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { createHostDirectory } = context.PiDishBrowser;
function fixture(initialCatalog = [{ base: '/hosts/peer', hostId: 'peer', token: 'fixture' }]) {
  const descriptors = new Map(), writes = [];
  const directory = createHostDirectory({ initialCatalog, descriptor: id => descriptors.get(id),
    persistCatalog: catalog => writes.push(JSON.parse(JSON.stringify(catalog))) });
  return { directory, descriptors, writes };
}
const descriptor = (hostId = 'peer', label = 'Peer') => ({ hostId, label, version: '1', capabilities: { terminal: true } });

test('host lookup preserves self fallback while exact lookups reject unknown hosts', () => {
  const { directory } = fixture();
  assert.equal(directory.self.hostId, null);
  assert.equal(directory.hostById('missing'), directory.self);
  assert.equal(directory.entryFor('missing'), null);
  assert.equal(directory.entryFor(null).source, 'self');
  directory.setSelf(descriptor('self', 'Local'));
  assert.equal(directory.hostById('self'), directory.self);
  assert.equal(directory.resolveHost(null), directory.self);
  assert.equal(directory.resolveHost('peer').base, '/hosts/peer');
  const endpoint = { base: '/hosts/explicit', token: 'explicit-fixture' };
  assert.equal(directory.resolveHost(endpoint), endpoint);
  directory.setSelf(descriptor('self', {}));
  assert.equal(directory.self.label, null, 'self labels retain the string-only policy');
});

test('effective host caching preserves source precedence and fills only absent metadata', () => {
  const { directory, descriptors } = fixture([{ base: '/hosts/user', hostId: 'peer', label: 'User label' }]);
  const fleet = { hosts: [{ base: '/hosts/fleet', hostId: 'peer', label: 'Fleet label' }], selfLabel: 'Own label' };
  directory.setFleet(fleet);
  descriptors.set('peer', descriptor('peer', 'Descriptor label'));
  const first = directory.effectiveHosts();
  assert.equal(directory.effectiveHosts(), first);
  assert.equal(first[0].label, 'Own label');
  assert.equal(first[1].base, '/hosts/fleet');
  assert.equal(first[1].label, 'Fleet label');
  assert.equal(first[1].version, '1');
  assert.equal(first[1].capabilities.terminal, true);
  assert.equal(fleet.hosts[0].version, undefined, 'merging does not mutate input rows');
  directory.setFleet({ hosts: [], selfLabel: 'Ignored' });
  assert.equal(directory.effectiveHosts()[1].base, '/hosts/user');
  assert.equal(directory.self.label, 'Own label');
});

test('saving unrelated catalog edits preserves source objects; replacement retires them', () => {
  const { directory, writes } = fixture([{ base: '/hosts/peer', hostId: 'peer' }, { base: '/hosts/remove', hostId: 'remove' }]);
  const peer = directory.entryFor('peer');
  const source = directory.sourceFor(peer);
  directory.remove('remove');
  directory.saveCatalog();
  assert.equal(directory.sourceFor(directory.entryFor('peer')), source);
  assert.equal(writes[0].length, 1);
  directory.replaceCatalog(directory.catalog);
  assert.notEqual(directory.sourceFor(directory.entryFor('peer')), source);
  assert.equal(directory.applyDescriptor(peer, source, descriptor('wrong')), false);
  assert.equal(directory.catalog[0].hostId, 'peer');
});

test('catalog add/remove/token operations normalize persistence and invalidate cached endpoints', () => {
  const { directory, writes } = fixture();
  const old = directory.entryFor('peer');
  assert.equal(directory.setToken('peer', 'new-fixture'), true);
  assert.notEqual(directory.entryFor('peer'), old);
  assert.equal(directory.resolveHost('peer').token, 'new-fixture');
  assert.equal(old.token, 'fixture', 'previous endpoint snapshots remain unchanged');
  assert.equal(directory.setToken('missing', 'unused'), false);
  assert.equal(directory.add({ base: 'not a URL', hostId: 'bad' }), false);
  assert.equal(directory.add({ base: '/hosts/new/', hostId: 'peer', label: ' New ', token: ' next ', capabilities: {} }), true);
  directory.saveCatalog();
  assert.deepEqual(writes[0], [{ base: '/hosts/new', hostId: 'peer', label: 'New', token: 'next' }]);
  assert.equal(directory.remove('missing'), false);
  assert.equal(directory.remove('peer'), true);
  assert.equal(directory.entryFor('peer'), null);
  assert.equal(directory.resolveHost('peer'), directory.self);
});

test('discovery writes only its owned source, persists only catalog fields and leaves wire metadata opaque', () => {
  const { directory, descriptors, writes } = fixture([{ base: '/hosts/peer', token: 'fixture' }]);
  const host = directory.effectiveHosts()[1];
  const source = directory.sourceFor(host);
  const data = descriptor('peer', { future: true });
  descriptors.set('peer', data);
  assert.equal(directory.applyDescriptor(host, source, data), true);
  assert.equal(directory.catalog[0].hostId, 'peer');
  assert.equal(directory.catalog[0].label, undefined, 'stored catalog labels remain strings');
  assert.deepEqual(writes[0], [{ base: '/hosts/peer', token: 'fixture', hostId: 'peer' }]);
  assert.deepEqual(directory.entryFor('peer').label, { future: true }, 'display metadata retains the descriptor value');
  assert.equal(directory.entryFor('peer').capabilities.terminal, true);
  const unowned = { base: '/hosts/peer', hostId: 'peer' };
  assert.equal(directory.applyDescriptor(host, unowned, descriptor('wrong')), false);
  assert.equal(directory.catalog[0].hostId, 'peer');
});

test('fleet discovery uses normalized bases and never persists or mutates the supplied fleet payload', () => {
  const { directory, writes } = fixture([]);
  const fleet = { hosts: [{ base: '/hosts/peer/' }], selfLabel: null };
  directory.setFleet(fleet);
  const host = directory.effectiveHosts()[1];
  assert.equal(directory.applyDescriptor(host, directory.sourceFor(host), descriptor()), true);
  assert.equal(directory.entryFor('peer').label, 'Peer');
  assert.equal(fleet.hosts[0].hostId, undefined);
  assert.equal(writes.length, 0);
  directory.setFleet({ hosts: [{ base: '/hosts/other', hostId: 'other' }], selfLabel: null });
  assert.equal(directory.entryFor('peer'), null);
});
