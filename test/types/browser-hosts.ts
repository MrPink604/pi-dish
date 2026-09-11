import { createHostConnections, hostKeyOf } from '../../src/browser/host-connections';
import type { HostConnectionRecord, HostConnectionState } from '../../src/browser/host-connections';

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
