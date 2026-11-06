import { BridgeSession } from './bridge-session';
import { getPrimeDaemon, type PrimeDaemonSession } from './prime-daemon';
import { routeIdentity } from './session-ownership';
import { isRecord } from './wire-protocol';
import type { SessionOwnership } from './session-ownership';

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
        if (!/unknown command/i.test(String(error instanceof Error ? error.message : error))) throw error;
        // Remember per connection: a reconnect may be a newer extension.
        session.treeLeafUnsupported = true;
      }
    }
    const result = await session.readTree();
    return (isRecord(result) ? result.leafId : undefined) ?? null;
  }

  return { primeLiveSession, isLive, getLiveContextUsage, liveTreeLeafId };
}
