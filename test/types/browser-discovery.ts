import { createHostDiscovery, decodeHostDescriptor } from '../../src/browser/host-discovery';
import type { HostDiscoveryOptions } from '../../src/browser/host-discovery';

declare const options: HostDiscoveryOptions;
const discovery = createHostDiscovery(options);
const read: Promise<void> = discovery.identify(true);
const id: string | undefined = decodeHostDescriptor({})?.hostId;
void read; void id;
// @ts-expect-error Descriptor capabilities are opaque until their consuming feature narrows them.
const terminal: boolean = discovery.descriptor('peer')?.capabilities;
void terminal;
// @ts-expect-error A captured descriptor identity is not mutable.
discovery.descriptor('peer')!.hostId = 'other';
createHostDiscovery({ ...options, onConnection(host) {
  // @ts-expect-error Callbacks cannot retarget the captured endpoint.
  host.base = '/hosts/other';
} });
// @ts-expect-error Refresh is an explicit boolean.
discovery.identify('yes');
