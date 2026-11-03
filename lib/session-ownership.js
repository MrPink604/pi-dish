// Generated from src/core/session-ownership.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleInterruption = exports.OwnershipRefusal = void 0;
exports.routeIdentity = routeIdentity;
exports.routeSessionId = routeSessionId;
exports.registryIdentity = registryIdentity;
exports.sameProcessIdentity = sameProcessIdentity;
exports.spawnMatchesRegistryClaim = spawnMatchesRegistryClaim;
exports.proveBridgeRegistryClaim = proveBridgeRegistryClaim;
exports.spawnAllowsOwnedPaneClose = spawnAllowsOwnedPaneClose;
exports.primeAgentMatchesSummary = primeAgentMatchesSummary;
exports.primeAgentSameWorker = primeAgentSameWorker;
exports.sameTranscriptFile = sameTranscriptFile;
exports.primeLaunchAuthority = primeLaunchAuthority;
exports.primeLaunchAuthorityForRoute = primeLaunchAuthorityForRoute;
exports.spawnAllowsManagedClose = spawnAllowsManagedClose;
exports.spawnAllowsRestart = spawnAllowsRestart;
exports.liveSessionSupports = liveSessionSupports;
exports.sessionIdentityFields = sessionIdentityFields;
exports.sessionSwitchRouteData = sessionSwitchRouteData;
exports.recoveryRouteId = recoveryRouteId;
exports.validateRecoveryRecord = validateRecoveryRecord;
exports.createSessionOwnership = createSessionOwnership;
const fs = require("fs");
const path = require("path");
const bridge_session_1 = require("./bridge-session");
const rpc_session_1 = require("./rpc-session");
const prime_daemon_1 = require("./prime-daemon");
const session_capabilities_1 = require("./session-capabilities");
const harnesses_1 = require("./harnesses");
const process_identity_1 = require("./process-identity");
const session_key_1 = require("./session-key");
const session_source_1 = require("./session-source");
const private_sessions_1 = require("./private-sessions");
const session_discovery_1 = require("./session-discovery");
const helper_values_1 = require("./helper-values");
const tmux = __importStar(require("./tmux"));
const recoveryStore = __importStar(require("./session-recovery"));
class OwnershipRefusal extends Error {
    status;
    constructor(message, status = 409) {
        super(message);
        this.status = status;
    }
}
exports.OwnershipRefusal = OwnershipRefusal;
/** Waiting/skipped actions preserve the exact interruption through launch/stop layers. */
class LifecycleInterruption extends Error {
    disposition;
    constructor(disposition, message) {
        super(message);
        this.disposition = disposition;
    }
}
exports.LifecycleInterruption = LifecycleInterruption;
function routeIdentity(value) {
    try {
        return { ...(0, session_key_1.resolveSessionRoute)(value), encoded: typeof value === 'string' && value.startsWith(session_key_1.VERSION) };
    }
    catch {
        return null;
    }
}
function routeSessionId(harnessId, nativeSessionId) {
    return harnessId === 'pi' ? nativeSessionId : (0, session_key_1.encodeSessionKey)(harnessId, nativeSessionId);
}
function registryIdentity(input) {
    if (!(0, helper_values_1.record)(input))
        return null;
    const wrapper = (0, helper_values_1.record)(input.wrapper) ? input.wrapper : null;
    const descriptor = (0, harnesses_1.getHarness)(wrapper?.harnessId || input.harnessId || 'pi');
    const nativeSessionId = input.nativeSessionId || input.sessionId;
    return descriptor && (0, session_key_1.validSessionId)(nativeSessionId) ? { harnessId: descriptor.id, nativeSessionId } : null;
}
function observedPid(pid) {
    return pid == null || typeof pid === 'number' || typeof pid === 'string' ? pid : Number(pid);
}
/** Preserve the process module's Number/String coercions without copying normal observations. */
function processEvidence(value) {
    if (!(0, helper_values_1.record)(value))
        return null;
    if ((value.pid === undefined || typeof value.pid === 'number' || typeof value.pid === 'string')
        && (value.startTime === undefined || typeof value.startTime === 'number' || typeof value.startTime === 'string'))
        return value;
    return { pid: Number(value.pid), startTime: String(value.startTime) };
}
function sameProcessIdentity(left, right) {
    return (0, helper_values_1.record)(left) && (0, helper_values_1.record)(right)
        && Number(left.pid) === Number(right.pid)
        && String(left.startTime) === String(right.startTime);
}
function spawnMatchesRegistryClaim(spawn, registryEntry) {
    const pane = spawn && (0, helper_values_1.record)(spawn.paneProcess) ? spawn.paneProcess : null;
    return !!spawn?.spawnToken && !!pane?.pid && !!pane.startTime && spawn.spawnToken === registryEntry?.spawnToken;
}
async function proveBridgeRegistryClaim(entry) {
    const probe = new bridge_session_1.BridgeSession(entry);
    try {
        await probe.connect();
        await probe.waitForHello({ timeout: 2000 });
    }
    finally {
        probe.close();
    }
}
/** Synchronous observations, not an authorization that survives an await. */
function spawnAllowsOwnedPaneClose(spawn, registryEntry) {
    if (!spawnMatchesRegistryClaim(spawn, registryEntry) || !registryEntry || !spawn)
        return false;
    const agentIdentity = processEvidence(registryEntry);
    const ancestry = (0, process_identity_1.inspectProcessAncestry)(agentIdentity);
    return ancestry.complete
        && sameProcessIdentity(ancestry.processes[0], agentIdentity)
        && (0, process_identity_1.processIdentityAlive)(processEvidence(spawn.paneProcess))
        && ancestry.processes.some(ancestor => sameProcessIdentity(ancestor, spawn.paneProcess));
}
function primeAgentMatchesSummary(agent, summary) {
    return agent.activeSessionId === summary.activeSessionId
        && agent.workerInstanceId === (summary.workerInstanceId || null)
        && agent.sessionFile === summary.sessionFile;
}
/**
 * The same resident worker. A Prime `/new` moves the agent to a new transcript
 * while `activeSessionId` and `workerInstanceId` survive, so transcript equality
 * is not part of worker identity.
 */
function primeAgentSameWorker(agent, summary) {
    return agent.activeSessionId === summary.activeSessionId
        && agent.workerInstanceId === (summary.workerInstanceId || null);
}
/**
 * The recorded Prime launch for this route, falling back to the spawn record
 * whose worker matches the roster when the route key moved while pi-dish was
 * down (a TUI `/new` pi-dish never observed).
 */
function findPrimeSpawn(sessionId, summary) {
    if (!summary)
        return null;
    const direct = tmux.getSpawn(sessionId);
    const directAgent = tmux.spawnPrimeAgent(direct);
    if (direct?.socket && direct.paneId && directAgent && primeAgentSameWorker(directAgent, summary)) {
        return { spawnKey: sessionId, placement: direct, agent: directAgent };
    }
    let fallback = null;
    for (const [spawnKey, placement] of Object.entries(tmux.listSpawns())) {
        if (spawnKey === sessionId || !placement.socket || !placement.paneId)
            continue;
        const agent = tmux.spawnPrimeAgent(placement);
        if (!agent || !primeAgentSameWorker(agent, summary))
            continue;
        if ((0, process_identity_1.processIdentityAlive)(processEvidence(placement.paneProcess)))
            return { spawnKey, placement, agent };
        fallback ??= { spawnKey, placement, agent };
    }
    return fallback;
}
/**
 * Adopt a route key whose launch record still names the same worker: re-key
 * the record and refresh its agent evidence to the live roster row.
 */
function adoptPrimeSpawn(sessionId, found, summary) {
    const agent = {
        daemonSocket: found.agent.daemonSocket,
        activeSessionId: summary.activeSessionId,
        workerInstanceId: summary.workerInstanceId || null,
        sessionFile: summary.sessionFile,
    };
    if (found.spawnKey === sessionId && primeAgentMatchesSummary(found.agent, summary))
        return found.placement;
    if (found.spawnKey !== sessionId && !tmux.rekeySpawn(found.spawnKey, sessionId, found.placement)) {
        throw new OwnershipRefusal('The Prime launch record changed while adopting this session; retry.');
    }
    tmux.recordSpawn(sessionId, {
        socket: found.placement.socket,
        paneId: found.placement.paneId,
        paneProcess: processEvidence(found.placement.paneProcess),
        primeAgent: agent,
    });
    return tmux.getSpawn(sessionId) ?? { ...found.placement, primeAgent: agent };
}
/** Compare transcripts through their real paths without inventing a match on failure. */
function sameTranscriptFile(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || !left || !right)
        return false;
    try {
        return fs.realpathSync(left) === fs.realpathSync(right);
    }
    catch {
        return false;
    }
}
/**
 * Prime launch authority for one route id: a recorded launch must name the
 * same resident worker as the roster summary, even when the route key moved.
 * Synchronous by design; callers refresh the roster before projecting a row.
 */
function primeLaunchAuthority(sessionId, summary) {
    const found = findPrimeSpawn(sessionId, summary);
    const currentDaemon = (0, prime_daemon_1.getPrimeDaemon)().socketPath;
    const closeAllowed = !!found && path.resolve(found.agent.daemonSocket) === path.resolve(currentDaemon);
    const paneProcess = found && (0, helper_values_1.record)(found.placement.paneProcess) ? found.placement.paneProcess : null;
    return {
        closeAllowed,
        restartAllowed: closeAllowed && !!paneProcess && (0, process_identity_1.processIdentityAlive)(paneProcess),
    };
}
/** Resolve the cached roster root for a Prime route, then apply primeLaunchAuthority. */
function primeLaunchAuthorityForRoute(sessionId) {
    const identity = routeIdentity(sessionId);
    const summary = identity?.harnessId === 'prime'
        ? (0, prime_daemon_1.getPrimeDaemon)().byNativeId(identity.nativeSessionId)?.summary ?? null
        : null;
    return primeLaunchAuthority(sessionId, summary);
}
function spawnAllowsManagedClose(spawn, registryEntry, closeMode) {
    if (closeMode === 'owned-pane')
        return spawnAllowsOwnedPaneClose(spawn, registryEntry);
    if (closeMode !== 'owned-agent')
        return false;
    const agent = tmux.spawnPrimeAgent(spawn);
    if (!agent || !spawn?.socket || !spawn.paneId)
        return false;
    const root = (0, prime_daemon_1.getPrimeDaemon)().byActiveSessionId(agent.activeSessionId);
    return !!root && primeAgentSameWorker(agent, root.summary);
}
function spawnAllowsRestart(spawn, registryEntry, closeMode) {
    return closeMode === 'owned-agent'
        ? spawnAllowsManagedClose(spawn, registryEntry, closeMode) && !!(0, helper_values_1.record)(spawn?.paneProcess) && (0, process_identity_1.processIdentityAlive)(spawn.paneProcess)
        : spawnAllowsOwnedPaneClose(spawn, registryEntry);
}
function liveSessionSupports(session, capability) {
    // A Prime daemon root has no bridge advertisement: the transport itself fixes
    // which commands exist (no extension UI, side chat, fast mode or share snapshot).
    if (session instanceof prime_daemon_1.PrimeDaemonSession)
        return session_capabilities_1.PRIME_DAEMON_CAPABILITIES[capability] === true;
    if (!(session instanceof bridge_session_1.BridgeSession))
        return true;
    return (0, session_capabilities_1.bridgeSupports)(session.harnessId, session.capabilities, capability);
}
/** A Prime route's live root. Prime 0.10+ never registers with the bridge. */
function primeDaemonSessionFor(identity) {
    return (0, harnesses_1.getHarness)(identity.harnessId)?.liveTransport === 'prime-daemon'
        ? (0, prime_daemon_1.getPrimeDaemon)().byNativeId(identity.nativeSessionId) : null;
}
function sessionIdentityFields(harnessId, nativeSessionId) {
    const descriptor = (0, harnesses_1.getHarness)(harnessId);
    return {
        id: routeSessionId(harnessId, nativeSessionId), sessionKey: (0, session_key_1.encodeSessionKey)(harnessId, nativeSessionId),
        harnessId, harnessLabel: descriptor?.label || harnessId, nativeSessionId,
    };
}
function sessionSwitchRouteData(session, input) {
    if (!(0, helper_values_1.record)(input) || !input.sessionId || !input.previousSessionId)
        return null;
    const descriptor = session instanceof prime_daemon_1.PrimeDaemonSession ? (0, harnesses_1.getHarness)('prime')
        : session instanceof bridge_session_1.BridgeSession ? (0, harnesses_1.getHarness)(session.harnessId || 'pi') : (0, harnesses_1.getHarness)('pi');
    if (!descriptor || !(0, session_key_1.validSessionId)(input.sessionId) || !(0, session_key_1.validSessionId)(input.previousSessionId))
        return null;
    return {
        ...input,
        sessionId: routeSessionId(descriptor.id, input.sessionId),
        previousSessionId: routeSessionId(descriptor.id, input.previousSessionId),
        nativeSessionId: input.sessionId, previousNativeSessionId: input.previousSessionId,
    };
}
/** Persisted Pi ids keep their legacy raw route; alternate routes require an encoded tuple. */
function recoveryRouteId(saved) {
    if (saved.harnessId === 'pi')
        return saved.nativeSessionId;
    const descriptor = (0, harnesses_1.getHarness)(saved.harnessId);
    if (!descriptor || !(0, session_key_1.validSessionId)(saved.nativeSessionId))
        throw new TypeError('Invalid session identity');
    return (0, session_key_1.encodeSessionKey)(descriptor.id, saved.nativeSessionId);
}
/** Validate historical evidence without granting ownership of any live runtime. */
function validateRecoveryRecord(saved) {
    const descriptor = (0, harnesses_1.getHarness)(saved.harnessId);
    const id = recoveryRouteId(saved);
    if (!descriptor || !descriptor.argv?.resume || !routeIdentity(id)) {
        throw new OwnershipRefusal('The saved harness or session identity is unsupported.');
    }
    if (!path.isAbsolute(saved.sessionFile || '') || !path.isAbsolute(saved.cwd || '')) {
        throw new OwnershipRefusal('Recovery requires an absolute saved transcript and original working directory.');
    }
    let file;
    try {
        file = fs.realpathSync(saved.sessionFile);
        if (!fs.statSync(saved.cwd).isDirectory())
            throw new Error('not a directory');
        if (!fs.statSync(file).isFile())
            throw new Error('not a file');
    }
    catch {
        throw new OwnershipRefusal('The saved transcript or original working directory is missing or unreadable; recovery does not fall back to HOME.');
    }
    const roots = (0, private_sessions_1.sessionRootsFor)(descriptor);
    const contained = roots.some(({ root }) => {
        try {
            return file.startsWith(fs.realpathSync(root) + path.sep);
        }
        catch {
            return false;
        }
    });
    if (!contained)
        throw new OwnershipRefusal('The saved transcript is outside this harness session store.');
    let source = null;
    for (const { root, singleWorkspace, private: privateRoot } of roots) {
        const discovery = (0, session_discovery_1.findSessionCandidate)(root, saved.nativeSessionId, {
            descriptor, allowPartial: false, singleWorkspace, private: privateRoot,
        });
        // A truncated scan cannot prove the exact identity either way.
        if (discovery.truncated)
            throw new OwnershipRefusal('The exact saved transcript identity cannot be verified unambiguously.');
        if (discovery.candidate) {
            source = discovery.candidate;
            break;
        }
    }
    if (!source || fs.realpathSync(source.file) !== file || !(0, session_discovery_1.readSessionHeader)(file, descriptor.profileId)) {
        throw new OwnershipRefusal('The exact saved transcript identity cannot be verified unambiguously.');
    }
    if (descriptor.nestedSubsessions && (source.parentSession || fs.existsSync(`${path.dirname(file)}.jsonl`))) {
        throw new OwnershipRefusal('This is a parent-owned subagent transcript; automatic recovery never resurrects subagents.');
    }
    const boot = recoveryStore.bootId();
    if (!boot || !saved.bootId || !saved.startTime || !saved.pid || !saved.instanceId || !saved.checkpoint) {
        throw new OwnershipRefusal('The saved process identity or transcript checkpoint is incomplete; inspect this session manually.');
    }
    if (boot === saved.bootId && (0, process_identity_1.processIdentityAlive)({ pid: saved.pid, startTime: saved.startTime })) {
        throw new OwnershipRefusal('The saved process is still alive without a verified bridge; refusing another transcript writer.');
    }
    const launch = recoveryStore.getControl(saved.harnessId, saved.nativeSessionId).attempt?.launch;
    if ((0, helper_values_1.record)(launch) && launch.bootId === boot && (launch.uncertain || (0, process_identity_1.processIdentityAlive)(processEvidence(launch)))) {
        throw new OwnershipRefusal('A previous recovery launch may still own this transcript; inspect its process before retrying.');
    }
    return source;
}
function createSessionOwnership(observations) {
    const sessionSources = (0, session_source_1.createSessionSourceResolver)();
    const runtimeCache = new Map();
    const RUNTIME_CACHE_TTL_MS = 60_000;
    async function capturePaneRestart(sessionId, descriptor) {
        if (descriptor.closeMode === 'owned-agent')
            return capturePrimeRestart(sessionId, descriptor);
        const registry = getRegisteredSession(sessionId);
        if (!registry)
            throw new OwnershipRefusal('Session not active', 404);
        const placement = tmux.getSpawn(sessionId);
        if (!placement?.socket || !placement.paneId || !spawnMatchesRegistryClaim(placement, registry)) {
            throw new OwnershipRefusal('Restart is available only for RPC sessions and tmux panes launched by pi-dish.');
        }
        const paneProcess = await tmux.paneProcessIdentity(placement.socket, placement.paneId);
        if (!sameProcessIdentity(paneProcess, placement.paneProcess) || !spawnAllowsRestart(placement, registry, descriptor.closeMode)) {
            throw new OwnershipRefusal('The recorded tmux pane no longer proves ownership of this agent, so pi-dish will not restart it.');
        }
        return { kind: 'pane-restart', sessionId, descriptor, registry, placement };
    }
    async function capturePrimeRestart(sessionId, descriptor) {
        const identity = routeIdentity(sessionId);
        if (!identity || identity.harnessId !== 'prime') {
            throw new OwnershipRefusal(`Restart is available only for ${descriptor.label} sessions pi-dish launched into a tmux pane.`);
        }
        const daemon = (0, prime_daemon_1.getPrimeDaemon)();
        const root = (await daemon.refresh()).find(session => session.nativeSessionId === identity.nativeSessionId);
        const found = findPrimeSpawn(sessionId, root?.summary ?? null);
        if (!found) {
            const direct = tmux.getSpawn(sessionId);
            throw new OwnershipRefusal(direct?.socket && direct.paneId && tmux.spawnPrimeAgent(direct)
                ? 'The recorded Prime launch no longer matches this live agent, so pi-dish will not restart it.'
                : `Restart is available only for ${descriptor.label} sessions pi-dish launched into a tmux pane.`);
        }
        if (path.resolve(daemon.socketPath) !== path.resolve(found.agent.daemonSocket)) {
            throw new OwnershipRefusal('The Prime daemon socket changed since this session was launched, so pi-dish will not restart it.');
        }
        if (!root)
            throw new OwnershipRefusal('The recorded Prime launch no longer matches this live agent, so pi-dish will not restart it.');
        const paneProcess = await tmux.paneProcessIdentity(found.placement.socket, found.placement.paneId);
        if (!sameProcessIdentity(paneProcess, found.placement.paneProcess)
            || !(0, helper_values_1.record)(found.placement.paneProcess) || !(0, process_identity_1.processIdentityAlive)(found.placement.paneProcess)) {
            throw new OwnershipRefusal('The recorded tmux pane no longer proves ownership of this agent, so pi-dish will not restart it.');
        }
        const placement = adoptPrimeSpawn(sessionId, found, root.summary);
        let sessionFile;
        try {
            sessionFile = fs.realpathSync(root.summary.sessionFile);
        }
        catch {
            throw new OwnershipRefusal('The active agent has no resumable session file.');
        }
        return {
            kind: 'prime-restart', sessionId, descriptor, placement, daemon, summary: root.summary, sessionFile,
            agent: { daemonSocket: found.agent.daemonSocket, activeSessionId: root.summary.activeSessionId,
                workerInstanceId: root.summary.workerInstanceId || null, sessionFile: root.summary.sessionFile },
        };
    }
    async function preparePaneRestart(capture) {
        const fresh = refreshRegisteredSession(capture.sessionId);
        if (!fresh || !(0, bridge_session_1.sameRegistryClaim)(fresh, capture.registry)) {
            throw new OwnershipRefusal('The live bridge changed while restart was being authorized; no pane was replaced.');
        }
        try {
            await proveBridgeRegistryClaim(fresh);
        }
        catch (error) {
            throw new OwnershipRefusal(`The live bridge could not re-prove its identity before restart: ${error instanceof Error ? error.message : String(error)}`);
        }
        const paneProcess = await tmux.paneProcessIdentity(capture.placement.socket, capture.placement.paneId);
        if (!sameProcessIdentity(paneProcess, capture.placement.paneProcess)
            || !spawnAllowsRestart(capture.placement, fresh, capture.descriptor.closeMode)) {
            throw new OwnershipRefusal('The tmux pane ownership proof changed before restart; no pane was replaced.');
        }
        return fresh;
    }
    function revalidatePaneRestart(capture, proved) {
        const registry = refreshRegisteredSession(capture.sessionId);
        if (!registry || !(0, bridge_session_1.sameRegistryClaim)(registry, proved)) {
            throw new OwnershipRefusal('The live bridge changed immediately before restart; no pane was replaced.');
        }
        return registry;
    }
    function checkPrimeRestartLaunch(capture) {
        const current = tmux.getSpawn(capture.sessionId);
        const agent = tmux.spawnPrimeAgent(current);
        if (!current || current.socket !== capture.placement.socket || current.paneId !== capture.placement.paneId
            || !sameProcessIdentity(current.paneProcess, capture.placement.paneProcess)
            || !agent || !primeAgentMatchesSummary(agent, capture.summary)) {
            throw new Error('Prime launch ownership changed during restart');
        }
    }
    async function preparePrimeRestartStop(capture, beforeAction) {
        const finalCheck = beforeAction ? await beforeAction() : null;
        return () => {
            checkPrimeRestartLaunch(capture);
            // The daemon re-reads the roster immediately before this check runs;
            // the cached root must still be the exact worker we captured.
            const root = capture.daemon.byActiveSessionId(capture.agent.activeSessionId);
            if (!root || !primeAgentMatchesSummary(capture.agent, root.summary))
                throw new Error('Prime worker changed during restart');
            if (finalCheck)
                finalCheck();
        };
    }
    async function preparePrimeReplacement(capture, sessionFile) {
        // Never launch a second writer while the roster still lists the transcript.
        await capture.daemon.refresh();
        if (capture.daemon.list().some(session => sameTranscriptFile(session.summary.sessionFile, sessionFile))) {
            throw new Error('A live Prime agent still claims this transcript; refusing another writer');
        }
        return () => {
            checkPrimeRestartLaunch(capture);
            if (capture.daemon.list().some(session => sameTranscriptFile(session.summary.sessionFile, sessionFile))) {
                throw new Error('A live Prime agent still claims this transcript; refusing another writer');
            }
        };
    }
    function captureBounceAuthority(row) {
        const sessionId = row.id;
        const rpc = getRPCSession(sessionId);
        const reg = getRegisteredSession(sessionId);
        const spawn = tmux.getSpawn(sessionId);
        const descriptor = (0, harnesses_1.getHarness)(row.harnessId || 'pi');
        if (!descriptor || descriptor.closeMode === 'owned-agent' || descriptor.closeMode === 'unsupported' || row.conflicted)
            return null;
        if (rpc?.alive) {
            return {
                sessionId, harnessId: descriptor.id, rpc,
                reg: reg ? structuredClone(reg) : null, spawn: spawn ? structuredClone(spawn) : null,
                sessionFile: rpc.sessionFile || reg?.sessionFile || null,
            };
        }
        if (!reg || !spawn || !spawnAllowsOwnedPaneClose(spawn, reg))
            return null;
        return {
            sessionId, harnessId: descriptor.id, rpc: null,
            reg: structuredClone(reg), spawn: structuredClone(spawn),
            sessionFile: rpc?.sessionFile || reg.sessionFile || null,
        };
    }
    function bounceIdentityFailure(authority) {
        (0, bridge_session_1.invalidateRegistryCache)();
        const rpc = getRPCSession(authority.sessionId);
        if (authority.rpc) {
            if (rpc !== authority.rpc || !rpc.alive || rpc.sessionFile !== authority.sessionFile)
                return 'The original RPC runtime exited or was replaced.';
            const reg = getRegisteredSession(authority.sessionId);
            if (authority.reg ? !reg || !(0, bridge_session_1.sameRegistryClaim)(reg, authority.reg) : !!reg)
                return 'The RPC bridge identity changed after the target snapshot.';
        }
        else {
            const reg = getRegisteredSession(authority.sessionId);
            if (!reg || !(0, bridge_session_1.sameRegistryClaim)(reg, authority.reg) || reg.sessionFile !== authority.sessionFile)
                return 'The original bridge runtime exited, switched sessions, or was replaced.';
            const spawn = tmux.getSpawn(authority.sessionId);
            if (!spawn || spawn.socket !== authority.spawn?.socket || spawn.paneId !== authority.spawn?.paneId
                || spawn.spawnToken !== authority.spawn?.spawnToken
                || !sameProcessIdentity(spawn.paneProcess, authority.spawn?.paneProcess)
                || !spawnAllowsOwnedPaneClose(spawn, reg))
                return 'The original pi-dish pane ownership proof no longer matches.';
        }
        return null;
    }
    function captureRpcClose(sessionId) {
        const rpc = getRPCSession(sessionId);
        return rpc?.alive ? { kind: 'rpc', rpc, registry: getRegisteredSession(sessionId) } : null;
    }
    async function captureOwnedPaneClose(sessionId, descriptor) {
        const registry = getRegisteredSession(sessionId);
        if (!registry)
            throw new OwnershipRefusal(`${descriptor.label} has no single unambiguous live bridge instance to close.`);
        const placement = tmux.getSpawn(sessionId);
        if (!placement?.socket || !placement.paneId) {
            throw new OwnershipRefusal(`This ${descriptor.label} session was not launched by pi-dish, so its tmux pane cannot be closed remotely.`);
        }
        if (!spawnMatchesRegistryClaim(placement, registry)) {
            tmux.removeSpawn(sessionId, placement);
            throw new OwnershipRefusal(`The recorded ${descriptor.label} pane no longer matches this live agent, so pi-dish will not close it.`);
        }
        const paneProcess = await tmux.paneProcessIdentity(placement.socket, placement.paneId);
        if (!sameProcessIdentity(paneProcess, placement.paneProcess)) {
            tmux.removeSpawn(sessionId, placement);
            throw new OwnershipRefusal(`The recorded ${descriptor.label} pane has exited or been replaced, so pi-dish will not close it.`);
        }
        if (!spawnAllowsOwnedPaneClose(placement, registry)) {
            throw new OwnershipRefusal(`Could not prove that the live ${descriptor.label} agent belongs to the recorded tmux pane, so pi-dish will not close it.`);
        }
        const fresh = refreshRegisteredSession(sessionId);
        if (!fresh || !(0, bridge_session_1.sameRegistryClaim)(fresh, registry)) {
            throw new OwnershipRefusal(`The live ${descriptor.label} bridge changed while close was being authorized, so pi-dish will not kill the pane.`);
        }
        try {
            await proveBridgeRegistryClaim(fresh);
        }
        catch (error) {
            throw new OwnershipRefusal(`The live ${descriptor.label} bridge could not re-prove its identity before close: ${error instanceof Error ? error.message : String(error)}`);
        }
        const finalPaneProcess = await tmux.paneProcessIdentity(placement.socket, placement.paneId);
        if (!sameProcessIdentity(finalPaneProcess, placement.paneProcess) || !spawnAllowsOwnedPaneClose(placement, fresh)) {
            throw new OwnershipRefusal(`The ${descriptor.label} pane ownership proof changed before close, so pi-dish will not kill the pane.`);
        }
        return { kind: 'owned-pane', sessionId, descriptor, registry: fresh, placement,
            agentProcess: { pid: Number(fresh.pid), startTime: String(fresh.startTime) } };
    }
    function revalidateOwnedPaneClose(capture) {
        const fresh = refreshRegisteredSession(capture.sessionId);
        if (!fresh || !(0, bridge_session_1.sameRegistryClaim)(fresh, capture.registry)) {
            throw new OwnershipRefusal(`The live ${capture.descriptor.label} bridge changed immediately before close, so pi-dish will not kill the pane.`);
        }
    }
    async function capturePrimeClose(sessionId, descriptor) {
        const daemon = (0, prime_daemon_1.getPrimeDaemon)();
        const identity = routeIdentity(sessionId);
        const root = identity?.harnessId === 'prime'
            ? (await daemon.refresh()).find(session => session.nativeSessionId === identity.nativeSessionId)
            : null;
        const found = findPrimeSpawn(sessionId, root?.summary ?? null);
        if (!found) {
            const direct = tmux.getSpawn(sessionId);
            throw new OwnershipRefusal(direct?.socket && direct.paneId && tmux.spawnPrimeAgent(direct)
                ? 'The recorded Prime launch no longer matches this live agent.'
                : `This ${descriptor.label} session was not launched by pi-dish, so it cannot be closed remotely.`);
        }
        if (path.resolve(daemon.socketPath) !== path.resolve(found.agent.daemonSocket)) {
            throw new OwnershipRefusal('The Prime daemon socket changed since this session was launched, so pi-dish will not close it.');
        }
        if (!root)
            throw new OwnershipRefusal('The recorded Prime launch no longer matches this live agent.');
        return {
            kind: 'owned-agent', sessionId, descriptor, daemon,
            placement: adoptPrimeSpawn(sessionId, found, root.summary),
            agent: { daemonSocket: found.agent.daemonSocket, activeSessionId: root.summary.activeSessionId,
                workerInstanceId: root.summary.workerInstanceId || null, sessionFile: root.summary.sessionFile },
        };
    }
    async function checkPrimeClosePane(capture, keepPane) {
        const placement = capture.placement;
        const current = await tmux.paneProcessIdentity(placement.socket, placement.paneId);
        if (sameProcessIdentity(current, placement.paneProcess))
            return true;
        if (keepPane || current || (0, process_identity_1.processIdentityAlive)(processEvidence(placement.paneProcess))
            || await tmux.paneExists(placement.socket, placement.paneId)) {
            throw new Error('The recorded Prime client pane has been replaced; pi-dish will not close it');
        }
        return false;
    }
    async function preparePrimeClose(capture, keepPane, beforeAction) {
        await checkPrimeClosePane(capture, keepPane);
        const finalCheck = beforeAction ? await beforeAction() : null;
        const placement = tmux.getSpawn(capture.sessionId);
        const agent = tmux.spawnPrimeAgent(placement);
        const root = capture.daemon.byActiveSessionId(capture.agent.activeSessionId);
        if (!placement || placement.socket !== capture.placement.socket || placement.paneId !== capture.placement.paneId
            || !sameProcessIdentity(placement.paneProcess, capture.placement.paneProcess)
            || !agent
            || agent.daemonSocket !== capture.agent.daemonSocket || agent.activeSessionId !== capture.agent.activeSessionId
            || agent.workerInstanceId !== capture.agent.workerInstanceId || agent.sessionFile !== capture.agent.sessionFile
            || !root || !primeAgentMatchesSummary(capture.agent, root.summary)) {
            throw new Error('Prime launch ownership changed before close');
        }
        if (finalCheck)
            finalCheck();
    }
    async function captureLogicalClose(sessionId, registry) {
        const hasBirthMarker = Object.prototype.hasOwnProperty.call(registry, 'startTime');
        let legacyProcess = null;
        let legacyBridge = null;
        if (!hasBirthMarker) {
            try {
                legacyBridge = await getBridgeSession(sessionId);
                const hello = await legacyBridge.waitForHello({ timeout: 2000 });
                if (legacyBridge.socketPath !== registry.socketPath
                    || hello?.sessionId !== sessionId || Number(hello?.pid) !== Number(registry.pid)) {
                    legacyBridge.close();
                    (0, bridge_session_1.invalidateRegistryCache)();
                    throw new OwnershipRefusal('Refusing to close this legacy bridge entry because its live handshake did not prove the registered session and PID. Refresh or reload the bridge, then retry.');
                }
                legacyProcess = (0, process_identity_1.processIdentity)(Number(registry.pid));
            }
            catch (error) {
                if (error instanceof OwnershipRefusal)
                    throw error;
                (0, bridge_session_1.pruneUnreachableRegisteredSession)(registry, error);
                throw new OwnershipRefusal(`Refusing to signal legacy registry pid ${registry.pid} without a successful bridge identity handshake: ${error instanceof Error ? error.message : String(error)}. Reload or upgrade that pi bridge, then retry.`);
            }
            if (!legacyProcess) {
                (0, bridge_session_1.pruneRegisteredSession)(registry);
                throw new OwnershipRefusal(`Refusing to signal legacy registry pid ${registry.pid} because its exact process identity could not be verified. Reload or upgrade that pi bridge, then retry.`);
            }
        }
        return { kind: 'logical', sessionId, registry, hasBirthMarker, legacyProcess, legacyBridge };
    }
    /** Call synchronously next to SIGTERM, after any legacy hello preparation. */
    function revalidateLogicalClose(capture) {
        const registry = refreshRegisteredSession(capture.sessionId);
        if (!registry || !(0, bridge_session_1.sameRegistryClaim)(capture.registry, registry)) {
            throw new OwnershipRefusal('The bridge registry identity changed while closing; no process was signaled. Refresh the session and retry.');
        }
        let identity = capture.legacyProcess;
        if (capture.hasBirthMarker)
            identity = { pid: Number(registry.pid), startTime: String(registry.startTime) };
        else if (!capture.legacyBridge?.alive) {
            throw new OwnershipRefusal('The legacy bridge disconnected before its process could be signaled; no process was signaled. Reload or upgrade the bridge, then retry.');
        }
        if (!identity || !(0, process_identity_1.processIdentityAlive)(identity)) {
            (0, bridge_session_1.pruneRegisteredSession)(registry);
            throw new OwnershipRefusal(`The registered pi identity for pid ${registry.pid} is stale; no process was signaled. The stale registry claim was discarded.`);
        }
        return { registry, process: identity };
    }
    function getRegisteredSession(sessionId) {
        const identity = routeIdentity(sessionId);
        return identity ? (0, bridge_session_1.getRegisteredSessionByNativeId)(identity.harnessId, identity.nativeSessionId) : null;
    }
    function refreshRegisteredSession(sessionId) {
        (0, bridge_session_1.invalidateRegistryCache)();
        return getRegisteredSession(sessionId);
    }
    function getRPCSession(sessionId) {
        const identity = routeIdentity(sessionId);
        return identity?.harnessId === 'pi' ? (0, rpc_session_1.getRPCSession)(identity.nativeSessionId) : null;
    }
    async function getBridgeSession(sessionId) {
        const entry = getRegisteredSession(sessionId);
        if (!entry)
            throw new Error(`session ${sessionId} not registered or has conflicting bridge instances`);
        return (0, bridge_session_1.getBridgeSession)(entry);
    }
    function liveSourceObservations(sessionId) {
        const identity = routeIdentity(sessionId);
        if (!identity)
            return [];
        // Prime's roster is the only live source for its routes: an old-style
        // registry claim for a 0.10+ agent cannot prove a daemon worker.
        if ((0, harnesses_1.getHarness)(identity.harnessId)?.liveTransport === 'prime-daemon') {
            const live = primeDaemonSessionFor(identity);
            return live ? [{ kind: 'prime-daemon', ...identity, file: typeof live.sessionFile === 'string' ? live.sessionFile || null : null }] : [];
        }
        const registered = getRegisteredSession(sessionId);
        const rpc = identity.harnessId === 'pi' ? getRPCSession(sessionId) : null;
        const out = [];
        if (registered)
            out.push({ kind: 'registered', ...identity, file: typeof registered.sessionFile === 'string' ? registered.sessionFile || null : null });
        if (rpc) {
            const file = rpc.sessionFile || rpc.state?.sessionFile || null;
            out.push({ kind: 'rpc', ...identity, file: typeof file === 'string' ? file : null });
        }
        return out;
    }
    function resolveSessionCandidate(sessionId, { discover = true } = {}) {
        return sessionSources.resolve({ route: sessionId, exact: true, discover, live: liveSourceObservations(sessionId) });
    }
    function liveSessionHistoryPending(sessionId) {
        const identity = routeIdentity(sessionId);
        if (identity && (0, harnesses_1.getHarness)(identity.harnessId)?.liveTransport === 'prime-daemon') {
            const prime = primeDaemonSessionFor(identity);
            return !!prime && (!prime.sessionFile || !fs.existsSync(prime.sessionFile));
        }
        const registered = getRegisteredSession(sessionId);
        if (registered)
            return typeof registered.sessionFile !== 'string' || !registered.sessionFile || !fs.existsSync(registered.sessionFile);
        const rpc = getRPCSession(sessionId);
        const file = rpc?.sessionFile || rpc?.state?.sessionFile;
        return !!rpc?.alive && (typeof file !== 'string' || !file || !fs.existsSync(file));
    }
    function track(session) {
        observations.onLive(session);
        return session;
    }
    async function getLiveSession(sessionId) {
        const identity = routeIdentity(sessionId);
        if (identity && (0, harnesses_1.getHarness)(identity.harnessId)?.liveTransport === 'prime-daemon') {
            const daemon = (0, prime_daemon_1.getPrimeDaemon)();
            const cached = daemon.byNativeId(identity.nativeSessionId);
            if (cached)
                return track(cached);
            // The roster may be cold (first request after start, or an agent that has
            // not been polled yet): read it once more before declaring the route dead.
            await daemon.refresh();
            const fresh = daemon.byNativeId(identity.nativeSessionId);
            return fresh ? track(fresh) : null;
        }
        const registered = getRegisteredSession(sessionId);
        if (registered) {
            let bridgeError;
            try {
                return track(await (0, bridge_session_1.getBridgeSession)(registered));
            }
            catch (error) {
                bridgeError = error;
                (0, bridge_session_1.pruneUnreachableRegisteredSession)(registered, error);
                // Refresh exactly once after a retired socket; never prune its replacement.
                const replacement = refreshRegisteredSession(sessionId);
                if (replacement && !(0, bridge_session_1.sameRegistryClaim)(replacement, registered)) {
                    try {
                        return track(await (0, bridge_session_1.getBridgeSession)(replacement));
                    }
                    catch (replacementError) {
                        bridgeError = replacementError;
                        (0, bridge_session_1.pruneUnreachableRegisteredSession)(replacement, replacementError);
                    }
                }
                const rpc = getRPCSession(sessionId);
                if (rpc?.alive)
                    return track(rpc);
                throw bridgeError;
            }
        }
        const rpc = getRPCSession(sessionId);
        return rpc?.alive ? track(rpc) : null;
    }
    function adoptBridgeSessionSwitch(session, data) {
        const routed = sessionSwitchRouteData(session, data);
        if (!routed || routed.sessionId === routed.previousSessionId)
            return;
        const spawn = tmux.getSpawn(routed.previousSessionId);
        const instance = session instanceof bridge_session_1.BridgeSession ? session.bridgeInstanceId : undefined;
        if (spawn && (!spawn.bridgeInstanceId || !instance || spawn.bridgeInstanceId === instance)) {
            tmux.rekeySpawn(routed.previousSessionId, routed.sessionId, spawn);
        }
        (0, bridge_session_1.invalidateRegistryCache)();
        for (const route of [routed.previousSessionId, routed.sessionId]) {
            runtimeCache.delete(route);
            observations.onRetired(route);
            sessionSources.invalidateRoute(route);
        }
    }
    async function describeRuntime(sessionId) {
        const rpc = getRPCSession(sessionId);
        if (rpc?.alive)
            return { kind: 'rpc', pid: rpc.proc?.pid ?? null };
        if (routeIdentity(sessionId)?.harnessId === 'prime')
            return describePrimeRuntime(sessionId);
        const reg = getRegisteredSession(sessionId);
        if (!reg)
            return null;
        const cached = runtimeCache.get(sessionId);
        if (cached && cached.pid === (reg.pid ?? null) && Date.now() - cached.at < RUNTIME_CACHE_TTL_MS)
            return cached.value;
        const value = await resolveRuntime(sessionId, reg);
        if (runtimeCache.size >= 200)
            runtimeCache.clear();
        runtimeCache.set(sessionId, { pid: reg.pid ?? null, at: Date.now(), value });
        return value;
    }
    /** Prime has no bridge entry: the pane comes from the spawn record, the pid from the roster. */
    async function describePrimeRuntime(sessionId) {
        const placement = tmux.getSpawn(sessionId);
        const agent = tmux.spawnPrimeAgent(placement);
        const root = agent ? (0, prime_daemon_1.getPrimeDaemon)().byActiveSessionId(agent.activeSessionId) : null;
        const pid = root?.summary.workerPid ?? (placement && (0, helper_values_1.record)(placement.paneProcess) ? observedPid(placement.paneProcess.pid) : null) ?? null;
        const cached = runtimeCache.get(sessionId);
        if (cached && cached.pid === pid && Date.now() - cached.at < RUNTIME_CACHE_TTL_MS)
            return cached.value;
        let loc = null;
        let server = null;
        if (placement?.socket && placement.paneId) {
            loc = await tmux.paneLocation(placement.socket, placement.paneId);
            server = path.basename(placement.socket);
        }
        if (!loc) {
            const pane = await tmux.findPaneByPid(pid);
            if (pane) {
                loc = pane;
                server = path.basename(pane.socket);
            }
        }
        const value = loc && server
            ? { kind: 'tmux', pid, server, tmuxSession: loc.tmuxSession ?? null, windowIndex: loc.windowIndex ?? null, windowName: loc.windowName ?? null }
            : { kind: 'terminal', pid };
        if (runtimeCache.size >= 200)
            runtimeCache.clear();
        runtimeCache.set(sessionId, { pid, at: Date.now(), value });
        return value;
    }
    async function resolveRuntime(sessionId, reg) {
        const spawn = tmux.getSpawn(sessionId);
        const stamp = (0, helper_values_1.record)(reg.tmux) ? reg.tmux : null;
        const socket = stamp?.socket || spawn?.socket || null;
        const pid = observedPid(reg.pid);
        if (typeof socket === 'string' && socket) {
            const paneId = (stamp?.socket ? stamp.pane : spawn?.paneId) || null;
            let loc = typeof paneId === 'string' && paneId ? await tmux.paneLocation(socket, paneId) : null;
            let server = path.basename(socket);
            if (!loc) {
                const pane = await tmux.findPaneByPid(pid);
                if (pane) {
                    loc = pane;
                    server = path.basename(pane.socket);
                }
            }
            return { kind: 'tmux', pid: reg.pid ?? null, server,
                tmuxSession: loc?.tmuxSession ?? null, windowIndex: loc?.windowIndex ?? null, windowName: loc?.windowName ?? null };
        }
        const pane = await tmux.findPaneByPid(pid);
        if (pane)
            return { kind: 'tmux', pid: reg.pid ?? null, server: path.basename(pane.socket),
                tmuxSession: pane.tmuxSession, windowIndex: pane.windowIndex, windowName: pane.windowName };
        return { kind: 'terminal', pid: reg.pid ?? null };
    }
    /** Weak location advice for terminal/send-keys; never a destructive ownership capture. */
    async function locatePiPane(sessionId) {
        if (routeIdentity(sessionId)?.harnessId === 'prime') {
            const placement = tmux.getSpawn(sessionId);
            if (placement?.socket && placement.paneId && await tmux.paneExists(placement.socket, placement.paneId)) {
                return { socket: placement.socket, paneId: placement.paneId };
            }
            const agent = tmux.spawnPrimeAgent(placement);
            const root = agent ? (0, prime_daemon_1.getPrimeDaemon)().byActiveSessionId(agent.activeSessionId) : null;
            return root?.summary.workerPid ? tmux.findPaneByPid(root.summary.workerPid) : null;
        }
        const reg = getRegisteredSession(sessionId);
        if (!reg)
            return null;
        const candidates = [];
        const stamp = (0, helper_values_1.record)(reg.tmux) ? reg.tmux : null;
        if (typeof stamp?.socket === 'string' && stamp.socket && typeof stamp.pane === 'string' && stamp.pane)
            candidates.push({ socket: stamp.socket, paneId: stamp.pane });
        const spawn = tmux.getSpawn(sessionId);
        if (spawn?.socket && spawn.paneId)
            candidates.push({ socket: spawn.socket, paneId: spawn.paneId });
        for (const candidate of candidates)
            if (await tmux.paneExists(candidate.socket, candidate.paneId))
                return candidate;
        return tmux.findPaneByPid(observedPid(reg.pid));
    }
    function liveSubagentProof(descriptor, candidate) {
        if (descriptor.sessionExitCustomType) {
            let tail;
            try {
                tail = observations.readSessionTailEntry(candidate);
            }
            catch {
                return false;
            }
            return !((0, helper_values_1.record)(tail) && tail.type === 'custom' && tail.customType === descriptor.sessionExitCustomType);
        }
        if (descriptor.subagentArtifacts) {
            try {
                const entry = JSON.parse(fs.readFileSync(path.join(path.dirname(candidate.file), 'rlm-subagent.json'), 'utf8'));
                return (0, helper_values_1.record)(entry) && entry.type === 'rlm_subagent' && entry.status === 'running';
            }
            catch {
                return false;
            }
        }
        return false;
    }
    function liveSubsessionCandidates(active) {
        const claimed = new Set(active.map(session => session.id));
        const out = [];
        for (const session of active) {
            const descriptor = (0, harnesses_1.getHarness)(session.harnessId);
            if (!descriptor || (!descriptor.nestedSubsessions && !descriptor.subagentArtifacts) || typeof session.sessionFile !== 'string' || !session.sessionFile)
                continue;
            let candidates;
            try {
                candidates = (0, session_discovery_1.discoverSubsessionCandidates)(session.sessionFile, { descriptor });
            }
            catch {
                continue;
            }
            for (const candidate of candidates) {
                if (claimed.has(candidate.routeId) || !liveSubagentProof(descriptor, candidate))
                    continue;
                claimed.add(candidate.routeId);
                out.push(candidate);
            }
        }
        return out;
    }
    return { sessionSources, getRegisteredSession, refreshRegisteredSession, getRPCSession, getBridgeSession,
        liveSourceObservations, resolveSessionCandidate, liveSessionHistoryPending, getLiveSession,
        adoptBridgeSessionSwitch, describeRuntime, locatePiPane, liveSubsessionCandidates,
        captureRpcClose, captureOwnedPaneClose, revalidateOwnedPaneClose, capturePrimeClose,
        checkPrimeClosePane, preparePrimeClose, captureLogicalClose, revalidateLogicalClose,
        capturePaneRestart, preparePaneRestart, revalidatePaneRestart, preparePrimeRestartStop,
        preparePrimeReplacement, captureBounceAuthority, bounceIdentityFailure };
}
