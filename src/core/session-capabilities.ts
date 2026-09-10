import type { HarnessId, BridgeCapability, AdvertisedCapabilities, SessionCapabilities, CapabilityContext } from './contracts';
import { getHarness } from './harnesses';

/**
 * Legacy Pi permits missing flags; alternative wrappers must explicitly opt in.
 * This is policy only, not harness-id validation. Typed callers must establish
 * identity through getHarness/the registry boundary before passing its id.
 */
function bridgeSupports(harnessId: HarnessId, capabilities: AdvertisedCapabilities | null | undefined, capability: BridgeCapability): boolean {
  return harnessId === 'pi' ? capabilities?.[capability] !== false : capabilities?.[capability] === true;
}

/** Project UI/API advice. Lifecycle authority is established separately by callers. */
function sessionCapabilities(harnessId: HarnessId, bridgeCapabilities: AdvertisedCapabilities = {}, {
  active = false, conflicted = false, closeAllowed = false, restartAllowed = false,
}: CapabilityContext = {}): SessionCapabilities {
  if (conflicted) return {
    prompt: false, steer: false, followUp: false, abort: false, compact: false,
    models: false, setModel: false, setThinking: false, rename: false, commands: false,
    queueCancel: false, tree: false, export: false, close: false, restart: false, resume: false,
  };
  const pi = harnessId === 'pi';
  const closeMode = getHarness(harnessId)?.closeMode || 'unsupported';
  const advertised = (name: BridgeCapability) => active && bridgeSupports(harnessId, bridgeCapabilities, name);
  return {
    prompt: advertised('prompt'),
    steer: advertised('steer'),
    followUp: advertised('followUp'),
    abort: advertised('abort'),
    compact: advertised('compact'),
    models: active ? advertised('models') : pi,
    setModel: active ? advertised('setModel') : pi,
    setThinking: advertised('setThinking'),
    rename: active ? advertised('rename') : pi,
    commands: active ? advertised('commands') : pi,
    queueCancel: advertised('queueCancel'),
    tree: pi
      ? (active ? advertised('treeNavigation') : true)
      : harnessId === 'omp' && active
        ? advertised('treeRead') && advertised('treeNavigation')
        : false,
    export: pi || harnessId === 'omp',
    // Managed harnesses may only close/detach the exact client pi-dish owns.
    close: active && (closeMode === 'logical'
      || ((closeMode === 'owned-pane' || closeMode === 'owned-agent') && closeAllowed)),
    restart: active && restartAllowed,
    resume: !active,
  };
}

export = { bridgeSupports, sessionCapabilities };
