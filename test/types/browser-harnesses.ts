import { createHarnessDiscovery } from '../../src/browser/harness-discovery';
import type { HarnessDiscoveryOptions } from '../../src/browser/harness-discovery';

declare const options: HarnessDiscoveryOptions;
const discovery = createHarnessDiscovery(options);
const request: Promise<void> = discovery.load();
discovery.ensure(null);
const id: string | undefined = discovery.rows()[0]?.id;
const label: string | undefined = discovery.row('peer', 'omp')?.label;
void request; void id; void label;
// @ts-expect-error Host identities cannot be numeric.
discovery.ensure(7);
// @ts-expect-error Consumers cannot mutate the controller's catalog.
discovery.rows().push({ id: 'pi' });
// @ts-expect-error Row identities cannot be rewritten by consumers.
discovery.rows()[0].id = 'different';
// @ts-expect-error Capability payloads remain opaque until their feature checks them.
const configurable: boolean = discovery.row('peer', 'omp')?.pilotConfig;
void configurable;
