import type { BounceOperation } from '../../src/browser/bounce-data';
import type { BounceHost, createBounce } from '../../src/browser/bounce';
declare const operation: BounceOperation;
declare const host: BounceHost;
declare const controller: ReturnType<typeof createBounce>;
// @ts-expect-error host identity cannot be externally replaced
host.hostId = 'other';
// @ts-expect-error decoded result arrays are readonly
operation.targets.push({ sessionId: 'other' });
// @ts-expect-error selection accepts an explicit boolean
controller.select('all');
