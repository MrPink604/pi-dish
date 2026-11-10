// Generated from src/core/live-sessions.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.primeLiveSession = primeLiveSession;
exports.createSessionLifecycleObserver = createSessionLifecycleObserver;
const bridge_session_1 = require("./bridge-session");
const prime_daemon_1 = require("./prime-daemon");
const extension_ui_state_1 = require("./extension-ui-state");
const harnesses_1 = require("./harnesses");
const session_ownership_1 = require("./session-ownership");
/** The cached daemon root for a Prime route, without touching other harnesses. */
function primeLiveSession(sessionId) {
    const identity = (0, session_ownership_1.routeIdentity)(sessionId);
    return identity?.harnessId === 'prime' ? (0, prime_daemon_1.getPrimeDaemon)().byNativeId(identity.nativeSessionId) : null;
}
/**
 * Route id for a live transport: bridge and Prime rows carry a harness.
 * Application policy stays separate from transport-owned replay reduction,
 * and switch adoption rekeys the application only after the transport has
 * cleared its old replay state.
 */
function createSessionLifecycleObserver(ports) {
    const observed = new WeakSet();
    function liveRouteId(session) {
        if (session instanceof prime_daemon_1.PrimeDaemonSession)
            return (0, session_ownership_1.routeSessionId)('prime', session.id);
        if (session instanceof bridge_session_1.BridgeSession)
            return (0, session_ownership_1.routeSessionId)((0, harnesses_1.getHarness)(session.harnessId)?.id || 'pi', session.id);
        return session.id;
    }
    return (session) => {
        ports.wakeSession(liveRouteId(session));
        const dismissAskDialogs = (source) => {
            for (const [id, data] of session.extUIState.dialogs) {
                if (!(0, extension_ui_state_1.isAskDialog)(data))
                    continue;
                (0, extension_ui_state_1.removeExtensionUIDialog)(session.extUIState, id);
                // Only bridge asks are dispatched as events; RPC and Prime have no emitter.
                if (session instanceof bridge_session_1.BridgeSession)
                    session.emit('extension_ui_resolved', { id, source });
                Promise.resolve(session.respondExtensionUI(id, { cancelled: true })).catch(() => { });
            }
        };
        // A replayed ask on an idle session is orphaned state from a failed or
        // reloaded UI wrapper; recheck even when observers already exist.
        if (!session.turnInProgress)
            dismissAskDialogs('idle');
        if (observed.has(session))
            return;
        observed.add(session);
        session.on('session_switch', data => ports.adoptSessionSwitch(session, data));
        session.on('turn_end', () => dismissAskDialogs('turn-end'));
        session.on('agent_end', () => dismissAskDialogs('agent-end'));
    };
}
