import { createHostDirectory } from '../../src/browser/host-directory';
import { createHostDiscovery } from '../../src/browser/host-discovery';
import type { HostDiscoveryOptions } from '../../src/browser/host-discovery';
const directory = createHostDirectory({ initialCatalog: [], descriptor: () => undefined, persistCatalog: rows => {
  const base: string | undefined = rows[0]?.base;
  void base;
} });
declare const discoveryOptions: HostDiscoveryOptions;
createHostDiscovery({ ...discoveryOptions, hosts: directory.effectiveHosts,
  pollableHosts: directory.effectiveHosts, sourceFor: directory.sourceFor,
  onSelf: directory.setSelf, onFleet: directory.setFleet, onIdentified: directory.applyDescriptor });
// @ts-expect-error Public catalog snapshots are read-only.
directory.catalog.push({ base: '/hosts/peer' });
// @ts-expect-error Token changes belong to the directory writer.
directory.catalog[0].token = 'different';
// @ts-expect-error Self identity changes belong to the directory writer.
directory.self.hostId = 'different';
// @ts-expect-error Effective routes are read-only to view consumers.
directory.effectiveHosts()[0].base = '/hosts/wrong';
// @ts-expect-error Routing accepts a host id or a captured endpoint, not a number.
directory.resolveHost(7);

// @ts-expect-error Discovery source references expose identity, not another mutation path.
directory.sourceFor(directory.effectiveHosts()[0])!.base = '/hosts/other';
