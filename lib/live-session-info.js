// Generated from src/core/live-session-info.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLiveSessionInfo = createLiveSessionInfo;
const prime_daemon_1 = require("./prime-daemon");
const session_ownership_1 = require("./session-ownership");
const wire_protocol_1 = require("./wire-protocol");
function createLiveSessionInfo(ownership) {
    const { getRegisteredSession, getRPCSession } = ownership;
    /** The cached daemon root for a Prime route, without touching other harnesses. */
    function primeLiveSession(sessionId) {
        const identity = (0, session_ownership_1.routeIdentity)(sessionId);
        return identity?.harnessId === 'prime' ? (0, prime_daemon_1.getPrimeDaemon)().byNativeId(identity.nativeSessionId) : null;
    }
    /** Any live transport for a route: bridge registry, RPC child, Prime root. */
    function isLive(sessionId) {
        return !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId)?.alive || !!primeLiveSession(sessionId);
    }
    /** Live context usage, whichever backend reports it (roster beats transport stats). */
    function getLiveContextUsage(sessionId) {
        const registered = getRegisteredSession(sessionId);
        if (registered?.contextUsage)
            return registered.contextUsage;
        const stats = getRPCSession(sessionId)?.lastStats;
        if (stats != null)
            return ((0, wire_protocol_1.isRecord)(stats) && stats.contextUsage) || null;
        const primeStats = primeLiveSession(sessionId)?.lastStats;
        return (0, wire_protocol_1.isRecord)(primeStats) ? primeStats.contextUsage || null : null;
    }
    /** Leaf-only tree read, falling back to the full tree for older bridges. */
    async function liveTreeLeafId(session) {
        if (!session.treeLeafUnsupported) {
            try {
                const result = await session.readTreeLeaf();
                return ((0, wire_protocol_1.isRecord)(result) ? result.leafId : undefined) ?? null;
            }
            catch (error) {
                if (!/unknown command/i.test(String(error instanceof Error ? error.message : error)))
                    throw error;
                // Remember per connection: a reconnect may be a newer extension.
                session.treeLeafUnsupported = true;
            }
        }
        const result = await session.readTree();
        return ((0, wire_protocol_1.isRecord)(result) ? result.leafId : undefined) ?? null;
    }
    return { primeLiveSession, isLive, getLiveContextUsage, liveTreeLeafId };
}
