import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type OmpHost from '@oh-my-pi/pi-coding-agent';
import mood from '../../extensions/mood.js';
import piBridge from '../../extensions/pi-dish-bridge/index.js';
import { createBridge, type BridgeDescriptor } from '../../extensions/pi-dish-bridge/core.js';
import { getPiPrivateSession } from '../../extensions/pi-dish-bridge/pi-private.js';
import ompBridge, { bridgeDescriptor as ompDescriptor, createHarnessBridge as createOmpBridge } from '../../extensions/pi-dish-bridge-omp/index.js';
import primeBridge, { bridgeDescriptor as primeDescriptor, createHarnessBridge as createPrimeBridge } from '../../extensions/pi-dish-bridge-prime/index.js';
import { getOmpNativeSession, patchOmpAgentSession, subscribeOmpNativeProjection } from '../../extensions/pi-dish-bridge-omp/native-state.js';

// Pi entrypoints consume the real installed SDK; alternate factories accept an
// opaque host and perform runtime narrowing, not an assignment/cast to Pi's API.
const piExtensions: readonly ((pi: ExtensionAPI) => void)[] = [mood, piBridge];
const nativeExtensions: readonly ((host: unknown) => void)[] = [ompBridge, primeBridge];
const descriptors: readonly BridgeDescriptor[] = [ompDescriptor, primeDescriptor];
const hostConstructors: readonly unknown[] = [null, {}, { prototype: null }, class EmptyHost {}];
for (const constructor of hostConstructors) patchOmpAgentSession(constructor);
createOmpBridge('launch-token', hostConstructors[3]);
createPrimeBridge('launch-token');
createBridge({ ...primeDescriptor, spawnToken: 'adopted-token' });

const unsubscribe: () => void = subscribeOmpNativeProjection(projection => {
  const todos: unknown[] = projection.todos;
  const enabled: boolean | undefined = projection.advisor?.enabled;
  void [todos, enabled];
});

// The exact host-only import has no declared SDK members.
declare const opaqueModule: typeof OmpHost;
// @ts-expect-error OMP's AgentSession is unavailable until runtime member guards narrow the unknown module.
opaqueModule.AgentSession;

const captured = getOmpNativeSession();
if (captured) {
  // @ts-expect-error A captured host's member is unknown, not a modeled Pi method.
  captured.runEphemeralTurn({ promptText: 'question' });
}
// @ts-expect-error Private capture is opaque outside the Pi module, never an alternate host SDK facade.
const fakePiApi: ExtensionAPI = getPiPrivateSession();
// @ts-expect-error Advertised capabilities must be booleans, not truthy strings.
createBridge({ ...ompDescriptor, capabilities: { compact: 'yes' } });
// @ts-expect-error Native projection subscription must provide an unsubscribe function.
createBridge({ ...ompDescriptor, nativeProjection: { get: () => null, subscribe: () => undefined } });

void [piExtensions, nativeExtensions, descriptors, unsubscribe, fakePiApi];

// The alternate context intentionally does not satisfy Pi's compact or thinking
// contracts. This exercises the checked wrapper seam, including a host switch,
// without claiming a second SDK declaration.
const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
const alternateHost = {
  on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
    handlers.set(name, handler);
  },
  registerCommand(_name: string, _options: unknown) {},
  setThinkingLevel(_level: 'max' | 'auto') {},
};
const alternateContext = {
  cwd: '/isolated/native-fixture',
  sessionManager: {
    getSessionFile: () => '/isolated/native-fixture/new.jsonl',
    getSessionId: () => 'new',
  },
  async compact(_instructions: string): Promise<void> {},
};
createOmpBridge()(alternateHost);
handlers.get('session_switch')?.({
  type: 'session_switch', reason: 'new', previousSessionFile: '/isolated/native-fixture/old.jsonl',
}, alternateContext);
// @ts-expect-error Alternate hosts are not assignable to the real Pi extension API.
mood(alternateHost);
