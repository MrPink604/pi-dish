import type { SessionSpawnInput, PendingSessionSpawn } from '../../src/browser/session-spawns';
import { createSessionSpawns } from '../../src/browser/session-spawns';
declare const input: SessionSpawnInput;
declare const pending: PendingSessionSpawn;
declare const controller: ReturnType<typeof createSessionSpawns>;
// @ts-expect-error launch endpoint is immutable at the request boundary
input.host.base = '/retargeted';
// @ts-expect-error provisional rows expose no mutable request host
pending.endpoint.token = 'changed';
// @ts-expect-error pending operation collections are read-only
controller.entries().push(['injected', pending]);
// @ts-expect-error pending rows cannot be replaced by a caller
controller.set('injected', pending);
