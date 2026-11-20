import type { HarnessId, BridgeCapability, AdvertisedCapabilities, SessionCapabilities, CapabilityContext } from './contracts';
import { getHarness } from './harnesses';

/**
 * What the Prime daemon transport carries for one live root agent. Prime loads
 * no extensions, so this mirrors `PrimeDaemonSession`'s commands, not a bridge
 * claim. Absent: extensionUI, sideChat, fastMode, login, guardedReload,
 * shareSnapshot, and branch (Prime has no `/branch`).
 */
const PRIME_DAEMON_CAPABILITIES: AdvertisedCapabilities = Object.freeze({
  prompt: true, steer: true, followUp: true, abort: true, compact: true,
  models: true, setModel: true, setThinking: true, rename: true, commands: true,
  queueRead: true, queueCancel: true, treeRead: true, treeNavigation: true,
  reload: true,
});

/**
 * What the agy relay advertises in its bridge claim. Fixed: ACP has no pi
 * extension to advertise through, so the relay publishes this exact set.
 * Absent: followUp (a prompt during a turn steers), compact, rename (no ACP
 * method), reload, queue*, tree*, sideChat, fastMode, login, shareSnapshot,
 * guardedReload.
 */
const AGY_ACP_CAPABILITIES: AdvertisedCapabilities = Object.freeze({
  prompt: true, steer: true, abort: true, models: true, setModel: true,
  setThinking: true, commands: true, extensionUI: true, sideChat: true,
});

/**
 * What a bot relay advertises. A bot runs one durable conversation: input
 * starts a run, joins it as a steer, or queues behind it as a follow-up, and
 * Esc aborts it. Absent: models and setModel (the model is the bot's registry
 * entry), setThinking, compact (a bot rolls its window over instead), rename
 * (the name is the registry's), commands, reload, queue*, tree*, extensionUI,
 * sideChat, fastMode, login, shareSnapshot, guardedReload.
 */
const BOT_CAPABILITIES: AdvertisedCapabilities = Object.freeze({
  prompt: true, steer: true, followUp: true, abort: true,
});

/**
 * Pi permits missing flags; alternative wrappers (known or not) must
 * explicitly opt in. Policy only, not harness-id validation.
 */
function bridgeSupports(harnessId: unknown, capabilities: AdvertisedCapabilities | null | undefined, capability: BridgeCapability): boolean {
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
    fastMode: false,
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
    // OMP-only host control; the permissive legacy-Pi bridge rule must not
    // advertise it for sessions that can never toggle a service tier.
    fastMode: harnessId === 'omp' && advertised('fastMode'),
    commands: active ? advertised('commands') : pi,
    queueCancel: advertised('queueCancel'),
    // Prime's daemon tree commands cover read and navigation together; OMP
    // advertises them separately; Pi keeps its legacy bridge default.
    tree: pi
      ? (active ? advertised('treeNavigation') : true)
      : harnessId === 'omp' && active
        ? advertised('treeRead') && advertised('treeNavigation')
        : harnessId === 'prime' ? advertised('treeNavigation') : false,
    export: pi || harnessId === 'omp' || harnessId === 'agy',
    // Managed harnesses may only close/detach the exact client pi-dish owns.
    close: active && (closeMode === 'logical'
      || ((closeMode === 'owned-pane' || closeMode === 'owned-agent') && closeAllowed)),
    restart: active && restartAllowed,
    resume: !active,
  };
}

export = { bridgeSupports, sessionCapabilities, PRIME_DAEMON_CAPABILITIES, AGY_ACP_CAPABILITIES, BOT_CAPABILITIES };
