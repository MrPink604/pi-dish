import { createHostConnections, hostKeyOf } from '../../src/browser/host-connections';
import type { HostConnectionRecord, HostConnectionState } from '../../src/browser/host-connections';
import { createHostSessionLoader } from '../../src/browser/host-session-loader';
import type { HostSessionLoaderOptions, SessionHost } from '../../src/browser/host-session-loader';
import { mergeHostEntries, sanitizeHostCatalog } from '../../src/browser/host-catalog';

const connections = createHostConnections({ onChange() {}, now: () => 1000 });
const host = { hostId: 'peer', base: '/hosts/peer', label: 'Peer' };
const state: HostConnectionState = connections.stateOf(host);
const label: string | undefined = connections.pollable([host])[0]?.label;
connections.note(host, { type: 'failure', error: new Error('offline') });
connections.seed([host]);
connections.reset(hostKeyOf(host));
connections.prune(new Set(['peer']));
void state; void label;
// @ts-expect-error Controller callers must name a supported observation.
connections.note(host, 'retry');
// @ts-expect-error Host identities are strings.
hostKeyOf({ hostId: 7 });
// @ts-expect-error The clock must return a number.
createHostConnections({ onChange() {}, now: () => 'tomorrow' });
declare const record: HostConnectionRecord;
// @ts-expect-error Observations are produced by the reducer, not patched by consumers.
record.retryAt = 0;

declare const loaderOptions: HostSessionLoaderOptions;
const loader = createHostSessionLoader(loaderOptions);
loader.load(host, 'needle', false, 1);
loader.getCache(host);
loader.prune(new Set(['peer']));
// @ts-expect-error A bare id cannot carry a captured host endpoint.
loader.load('peer', undefined, true, 1);
// @ts-expect-error Fan-out sequences are numbers.
loader.load(host, undefined, true, 'new');
declare const capturedHost: SessionHost;
// @ts-expect-error Async callbacks must not retarget a captured host.
capturedHost.hostId = 'different';
createHostSessionLoader({
  ...loaderOptions,
  // @ts-expect-error Decoded list rows must carry string session identities.
  requestList: async () => ({ active: [{ id: 7 }], previous: [] }),
});

const catalog = sanitizeHostCatalog([{ base: '/hosts/peer', token: 'fixture' }]);
const effective = mergeHostEntries({ hostId: 'self' }, [], catalog);
for (const target of connections.pollable(effective)) loader.load(target, undefined, true, 1);
const token: string | undefined = catalog[0]?.token;
void token;
// @ts-expect-error Effective routes always carry a string base.
effective[0].base = 7;
// @ts-expect-error User catalog tokens have been narrowed to strings.
catalog[0].token = {};
// @ts-expect-error Descriptor capability payloads still need a feature-specific check.
const capability: boolean = effective[0].capabilities;
void capability;
