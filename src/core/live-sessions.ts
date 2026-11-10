import { BridgeSession } from './bridge-session';
import { getPrimeDaemon, PrimeDaemonSession } from './prime-daemon';
import { isAskDialog, removeExtensionUIDialog } from './extension-ui-state';
import { getHarness } from './harnesses';
import { routeIdentity, routeSessionId } from './session-ownership';
import type { LiveSession } from './session-ownership';

/** The cached daemon root for a Prime route, without touching other harnesses. */
export function primeLiveSession(sessionId: string): PrimeDaemonSession | null {
  const identity = routeIdentity(sessionId);
  return identity?.harnessId === 'prime' ? getPrimeDaemon().byNativeId(identity.nativeSessionId) : null;
}

export interface LiveSessionLifecyclePorts {
  wakeSession(routeId: string): void;
  adoptSessionSwitch(session: LiveSession, data: unknown): void;
}

/**
 * Route id for a live transport: bridge and Prime rows carry a harness.
 * Application policy stays separate from transport-owned replay reduction,
 * and switch adoption rekeys the application only after the transport has
 * cleared its old replay state.
 */
export function createSessionLifecycleObserver(ports: LiveSessionLifecyclePorts): (session: LiveSession) => void {
  const observed = new WeakSet<LiveSession>();

  function liveRouteId(session: LiveSession): string {
    if (session instanceof PrimeDaemonSession) return routeSessionId('prime', session.id);
    if (session instanceof BridgeSession) return routeSessionId(getHarness(session.harnessId)?.id || 'pi', session.id);
    return session.id;
  }

  return (session) => {
    ports.wakeSession(liveRouteId(session));
    const dismissAskDialogs = (source: string) => {
      for (const [id, data] of session.extUIState.dialogs) {
        if (!isAskDialog(data)) continue;
        removeExtensionUIDialog(session.extUIState, id);
        // Only bridge asks are dispatched as events; RPC and Prime have no emitter.
        if (session instanceof BridgeSession) session.emit('extension_ui_resolved', { id, source });
        Promise.resolve(session.respondExtensionUI(id as string, { cancelled: true })).catch(() => {});
      }
    };
    // A replayed ask on an idle session is orphaned state from a failed or
    // reloaded UI wrapper; recheck even when observers already exist.
    if (!session.turnInProgress) dismissAskDialogs('idle');
    if (observed.has(session)) return;
    observed.add(session);
    session.on('session_switch', data => ports.adoptSessionSwitch(session, data));
    session.on('turn_end', () => dismissAskDialogs('turn-end'));
    session.on('agent_end', () => dismissAskDialogs('agent-end'));
  };
}
