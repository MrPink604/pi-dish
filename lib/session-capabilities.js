// Generated from src/core/session-capabilities.ts; edit that source and run npm run build:core.
"use strict";
const harnesses_1 = require("./harnesses");
/**
 * What the Prime daemon transport carries for one live root agent. Prime loads
 * no extensions, so this mirrors `PrimeDaemonSession`'s commands, not a bridge
 * claim. Absent: extensionUI, sideChat, fastMode, login, guardedReload,
 * shareSnapshot, and branch (Prime has no `/branch`).
 */
const PRIME_DAEMON_CAPABILITIES = Object.freeze({
    prompt: true, steer: true, followUp: true, abort: true, compact: true,
    models: true, setModel: true, setThinking: true, rename: true, commands: true,
    queueRead: true, queueCancel: true, treeRead: true, treeNavigation: true,
    reload: true,
});
/**
 * Pi permits missing flags; alternative wrappers (known or not) must
 * explicitly opt in. Policy only, not harness-id validation.
 */
function bridgeSupports(harnessId, capabilities, capability) {
    return harnessId === 'pi' ? capabilities?.[capability] !== false : capabilities?.[capability] === true;
}
/** Project UI/API advice. Lifecycle authority is established separately by callers. */
function sessionCapabilities(harnessId, bridgeCapabilities = {}, { active = false, conflicted = false, closeAllowed = false, restartAllowed = false, } = {}) {
    if (conflicted)
        return {
            prompt: false, steer: false, followUp: false, abort: false, compact: false,
            models: false, setModel: false, setThinking: false, rename: false, commands: false,
            queueCancel: false, tree: false, export: false, close: false, restart: false, resume: false,
            fastMode: false,
        };
    const pi = harnessId === 'pi';
    const closeMode = (0, harnesses_1.getHarness)(harnessId)?.closeMode || 'unsupported';
    const advertised = (name) => active && bridgeSupports(harnessId, bridgeCapabilities, name);
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
        export: pi || harnessId === 'omp',
        // Managed harnesses may only close/detach the exact client pi-dish owns.
        close: active && (closeMode === 'logical'
            || ((closeMode === 'owned-pane' || closeMode === 'owned-agent') && closeAllowed)),
        restart: active && restartAllowed,
        resume: !active,
    };
}
module.exports = { bridgeSupports, sessionCapabilities, PRIME_DAEMON_CAPABILITIES };
