import { BridgeSession } from './bridge-session';
import { PrimeDaemonSession } from './prime-daemon';
import { getPrimeDaemon } from './prime-daemon';
import { removeExtensionUIDialog } from './extension-ui-state';
import { getHarness } from './harnesses';
import { routeIdentity, routeSessionId } from './session-ownership';
import { record as isRecord } from './helper-values';
import { errorMessage } from './http-boundary';
import type { LiveSession, SessionOwnership } from './session-ownership';

export function createLiveSessionInfo(ownership: SessionOwnership) {
  const { getRegisteredSession, getRPCSession } = ownership;

  /** The cached daemon root for a Prime route, without touching other harnesses. */
  function primeLiveSession(sessionId: string): PrimeDaemonSession | null {
    const identity = routeIdentity(sessionId);
    return identity?.harnessId === 'prime' ? getPrimeDaemon().byNativeId(identity.nativeSessionId) : null;
  }

  /** Any live transport for a route: bridge registry, RPC child, Prime root. */
  function isLive(sessionId: string): boolean {
    return !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId)?.alive || !!primeLiveSession(sessionId);
  }

  /** Live context usage, whichever backend reports it (roster beats transport stats). */
  function getLiveContextUsage(sessionId: string): unknown {
    const registered = getRegisteredSession(sessionId);
    if (registered?.contextUsage) return registered.contextUsage;
    const stats = getRPCSession(sessionId)?.lastStats;
    if (stats != null) return (isRecord(stats) && stats.contextUsage) || null;
    const primeStats = primeLiveSession(sessionId)?.lastStats;
    return isRecord(primeStats) ? primeStats.contextUsage || null : null;
  }

  /** Leaf-only tree read, falling back to the full tree for older bridges. */
  async function liveTreeLeafId(session: InstanceType<typeof BridgeSession>): Promise<unknown> {
    if (!session.treeLeafUnsupported) {
      try {
        const result = await session.readTreeLeaf();
        return (isRecord(result) ? result.leafId : undefined) ?? null;
      } catch (error) {
        if (!/unknown command/i.test(errorMessage(error))) throw error;
        // Remember per connection: a reconnect may be a newer extension.
        session.treeLeafUnsupported = true;
      }
    }
    const result = await session.readTree();
    return (isRecord(result) ? result.leafId : undefined) ?? null;
  }

  return { primeLiveSession, isLive, getLiveContextUsage, liveTreeLeafId };
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
        if (!isRecord(data) || data.method !== 'ask') continue;
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
