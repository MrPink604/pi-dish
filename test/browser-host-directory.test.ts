import { assertBrowserApiContext } from './browser-vm.js';
import { present, record } from './test-types.js';
import type { CatalogHost } from '../src/browser/host-catalog.js';
import type { HostDescriptor } from '../src/browser/host-discovery.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
assertBrowserApiContext(context);
const { createHostDirectory } = context.PiDishBrowser;
function fixture(initialCatalog: unknown = [{ base: '/hosts/peer', hostId: 'peer', token: 'fixture' }]) {
  const descriptors = new Map<string, HostDescriptor>(), writes: Array<readonly Readonly<CatalogHost>[]> = [];
  const directory = createHostDirectory({ initialCatalog, descriptor: id => descriptors.get(id),
    persistCatalog: catalog => writes.push(catalog) });
  return { directory, descriptors, writes };
}
const descriptor = (hostId = 'peer', label: unknown = 'Peer'): HostDescriptor => ({ hostId, label, version: '1', capabilities: { terminal: true } });

test('host lookup preserves self fallback while exact lookups reject unknown hosts', () => {
  const { directory } = fixture();
  assert.equal(directory.self.hostId, null);
  assert.equal(directory.hostById('missing'), directory.self);
  assert.equal(directory.entryFor('missing'), null);
  assert.equal(present(directory.entryFor(null)).source, 'self');
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
  const fleet: { hosts: Record<string, unknown>[]; selfLabel: unknown } = { hosts: [{ base: '/hosts/fleet', hostId: 'peer', label: 'Fleet label' }], selfLabel: 'Own label' };
  directory.setFleet(fleet);
  descriptors.set('peer', descriptor('peer', 'Descriptor label'));
  const first = directory.effectiveHosts();
  assert.equal(directory.effectiveHosts(), first);
  assert.equal(present(first[0]).label, 'Own label');
  assert.equal(present(first[1]).base, '/hosts/fleet');
  assert.equal(present(first[1]).label, 'Fleet label');
  assert.equal(present(first[1]).version, '1');
  assert.equal(record(present(first[1]).capabilities).terminal, true);
  assert.equal(fleet.hosts[0]?.version, undefined, 'merging does not mutate input rows');
  directory.setFleet({ hosts: [], selfLabel: 'Ignored' });
  assert.equal(present(directory.effectiveHosts()[1]).base, '/hosts/user');
  assert.equal(directory.self.label, 'Own label');
});

test('saving unrelated catalog edits preserves source objects; replacement retires them', () => {
  const { directory, writes } = fixture([{ base: '/hosts/peer', hostId: 'peer' }, { base: '/hosts/remove', hostId: 'remove' }]);
  const peer = present(directory.entryFor('peer'));
  const source = present(directory.sourceFor(peer));
  directory.remove('remove');
  directory.saveCatalog();
  assert.equal(directory.sourceFor(present(directory.entryFor('peer'))), source);
  assert.equal(present(writes[0]).length, 1);
  directory.replaceCatalog(directory.catalog);
  assert.notEqual(directory.sourceFor(present(directory.entryFor('peer'))), source);
  assert.equal(directory.applyDescriptor(peer, source, descriptor('wrong')), false);
  assert.equal(present(directory.catalog[0]).hostId, 'peer');
});

test('catalog add/remove/token operations normalize persistence and invalidate cached endpoints', () => {
  const { directory, writes } = fixture();
  const old = present(directory.entryFor('peer'));
  assert.equal(directory.setToken('peer', 'new-fixture'), true);
  assert.notEqual(directory.entryFor('peer'), old);
  assert.equal(present(directory.resolveHost('peer')).token, 'new-fixture');
  assert.equal(old.token, 'fixture', 'previous endpoint snapshots remain unchanged');
  assert.equal(directory.setToken('missing', 'unused'), false);
  assert.equal(directory.add({ base: 'not a URL', hostId: 'bad' }), false);
  assert.equal(directory.add({ base: '/hosts/new/', hostId: 'peer', label: ' New ', token: ' next ', capabilities: {} }), true);
  directory.saveCatalog();
  assert.deepEqual(structuredClone(writes[0]), [{ base: '/hosts/new', hostId: 'peer', label: 'New', token: 'next' }]);
  assert.equal(directory.remove('missing'), false);
  assert.equal(directory.remove('peer'), true);
  assert.equal(directory.entryFor('peer'), null);
  assert.equal(directory.resolveHost('peer'), directory.self);
});

test('discovery writes only its owned source, persists only catalog fields and leaves wire metadata opaque', () => {
  const { directory, descriptors, writes } = fixture([{ base: '/hosts/peer', token: 'fixture' }]);
  const host = present(directory.effectiveHosts()[1]);
  const source = present(directory.sourceFor(host));
  const data = descriptor('peer', { future: true });
  descriptors.set('peer', data);
  assert.equal(directory.applyDescriptor(host, source, data), true);
  assert.equal(present(directory.catalog[0]).hostId, 'peer');
  assert.equal(present(directory.catalog[0]).label, undefined, 'stored catalog labels remain strings');
  assert.deepEqual(structuredClone(writes[0]), [{ base: '/hosts/peer', token: 'fixture', hostId: 'peer' }]);
  const entry = present(directory.entryFor('peer'));
  assert.deepEqual(entry.label, { future: true }, 'display metadata retains the descriptor value');
  assert.equal(record(entry.capabilities).terminal, true);
  const unowned = { base: '/hosts/peer', hostId: 'peer' };
  assert.equal(directory.applyDescriptor(host, unowned, descriptor('wrong')), false);
  assert.equal(present(directory.catalog[0]).hostId, 'peer');
});

test('fleet discovery uses normalized bases and never persists or mutates the supplied fleet payload', () => {
  const { directory, writes } = fixture([]);
  const fleet: { hosts: Record<string, unknown>[]; selfLabel: unknown } = { hosts: [{ base: '/hosts/peer/' }], selfLabel: null };
  directory.setFleet(fleet);
  const host = present(directory.effectiveHosts()[1]);
  assert.equal(directory.applyDescriptor(host, present(directory.sourceFor(host)), descriptor()), true);
  assert.equal(present(directory.entryFor('peer')).label, 'Peer');
  assert.equal(fleet.hosts[0]?.hostId, undefined);
  assert.equal(writes.length, 0);
  directory.setFleet({ hosts: [{ base: '/hosts/other', hostId: 'other' }], selfLabel: null });
  assert.equal(directory.entryFor('peer'), null);
});

export {};
