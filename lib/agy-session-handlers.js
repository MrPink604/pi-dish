// Generated from src/core/agy-session-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgySessionHandlers = createAgySessionHandlers;
const http_boundary_1 = require("./http-boundary");
const bridge_session_1 = require("./bridge-session");
const agy_brain_1 = require("./agy-brain");
const session_key_1 = require("./session-key");
const session_ownership_1 = require("./session-ownership");
const helper_values_1 = require("./helper-values");
const wire_protocol_1 = require("./wire-protocol");
const INVALID_SESSION_RE = /Invalid session ID|Unknown harness/;
function parsePlanItems(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const row of raw) {
        if (!(0, helper_values_1.record)(row))
            continue;
        const content = (0, helper_values_1.text)(row.content) || (0, helper_values_1.text)(row.title);
        if (!content)
            continue;
        const status = row.status === 'completed' || row.status === 'in_progress' ? row.status : 'pending';
        const priority = (0, helper_values_1.text)(row.priority) || undefined;
        out.push({ content, status, ...(priority ? { priority } : {}) });
    }
    return out;
}
function parseRunningTools(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const row of raw) {
        if (!(0, helper_values_1.record)(row))
            continue;
        const toolCallId = (0, helper_values_1.text)(row.toolCallId);
        const toolName = (0, helper_values_1.text)(row.toolName);
        if (!toolCallId || !toolName)
            continue;
        out.push({
            toolCallId,
            toolName,
            args: row.args,
            startedAt: (0, helper_values_1.finite)(row.startedAt) ? row.startedAt : Date.now(),
        });
    }
    return out;
}
function createAgySessionHandlers({ ownership, findSessionSource }) {
    function resolveAgyTarget(routeParam) {
        const reg = ownership.getRegisteredSession(routeParam);
        const identity = (0, session_ownership_1.routeIdentity)(routeParam);
        if (reg && identity) {
            return { harnessId: identity.harnessId, nativeSessionId: identity.nativeSessionId, routeId: (0, session_key_1.canonicalSessionId)(routeParam) };
        }
        const source = findSessionSource(routeParam);
        if (source) {
            return { harnessId: source.harnessId, nativeSessionId: source.nativeSessionId, routeId: source.routeId };
        }
        return null;
    }
    async function liveAgyOverlay(routeId) {
        const reg = ownership.getRegisteredSession(routeId);
        if (!reg)
            return { isActive: false, turnInProgress: false, plan: [], runningTools: [] };
        let plan = [];
        let runningTools = [];
        let turnInProgress = reg.turnInProgress === true;
        try {
            const live = await ownership.getLiveSession(routeId);
            if (live instanceof bridge_session_1.BridgeSession) {
                const state = (0, wire_protocol_1.asRecord)(await live.send('get_state', {}, { timeout: 5000 }));
                plan = parsePlanItems(state.plan);
                runningTools = parseRunningTools(state.runningTools);
                if (typeof state.turnInProgress === 'boolean')
                    turnInProgress = state.turnInProgress;
            }
        }
        catch { /* Fall back to registry claim + brain files if bridge is momentarily busy. */ }
        return { isActive: true, turnInProgress, plan, runningTools };
    }
    const tasks = async (req, res) => {
        try {
            const target = resolveAgyTarget(req.params.id);
            if (!target) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            if (target.harnessId !== 'agy') {
                res.json({
                    supported: false,
                    sessionId: target.routeId,
                    nativeSessionId: target.nativeSessionId,
                    isActive: !!ownership.getRegisteredSession(target.routeId),
                    canControl: false,
                    plan: [],
                    tasks: [],
                    subagents: [],
                    swarm: null,
                });
                return;
            }
            const overlay = await liveAgyOverlay(target.routeId);
            // If viewing a swarm worker or subagent whose parent coordinator is live,
            // check coordinator liveness too so swarm status stays live.
            let effectiveActive = overlay.isActive;
            let coordTurn = overlay.turnInProgress;
            if (!effectiveActive) {
                const coordNative = (0, agy_brain_1.findAgySwarmCoordinator)(target.nativeSessionId);
                if (coordNative && coordNative !== target.nativeSessionId) {
                    const coordReg = ownership.getRegisteredSession((0, agy_brain_1.agyRouteId)(coordNative));
                    if (coordReg) {
                        effectiveActive = true;
                        coordTurn = coordReg.turnInProgress === true;
                    }
                }
            }
            res.json((0, agy_brain_1.readAgySessionTasks)(target.nativeSessionId, {
                isActive: effectiveActive,
                canControl: overlay.isActive,
                coordinatorTurnInProgress: coordTurn,
                livePlan: overlay.plan,
                liveRunningTools: overlay.runningTools,
            }));
        }
        catch (error) {
            res.status(INVALID_SESSION_RE.test((0, http_boundary_1.errorMessage)(error)) ? 400 : 500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    };
    const taskLog = (req, res) => {
        try {
            const target = resolveAgyTarget(req.params.id);
            if (!target || target.harnessId !== 'agy') {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            const taskId = (0, helper_values_1.text)(req.params.taskId);
            const tailParam = Number.parseInt(String(req.query.tail ?? ''), 10);
            const log = (0, agy_brain_1.readAgyTaskLog)(target.nativeSessionId, taskId, Number.isFinite(tailParam) ? tailParam : undefined);
            if (!log) {
                res.status(404).json({ error: 'Task log not found' });
                return;
            }
            res.json(log);
        }
        catch (error) {
            res.status(INVALID_SESSION_RE.test((0, http_boundary_1.errorMessage)(error)) ? 400 : 500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    };
    const swarm = (req, res) => {
        try {
            const target = resolveAgyTarget(req.params.id);
            if (!target) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            if (target.harnessId !== 'agy') {
                res.json({
                    supported: false,
                    hasSwarm: false,
                    sessionId: target.routeId,
                    coordinatorId: target.routeId,
                    coordinatorNativeId: target.nativeSessionId,
                    title: '',
                    createdAt: null,
                    isActive: false,
                    coordinatorTurnInProgress: false,
                    head: 0,
                    members: [],
                    channels: [],
                    posts: [],
                    plan: null,
                    narratorView: null,
                });
                return;
            }
            const coordNative = (0, agy_brain_1.findAgySwarmCoordinator)(target.nativeSessionId) ?? target.nativeSessionId;
            const coordRoute = (0, agy_brain_1.agyRouteId)(coordNative);
            const coordReg = ownership.getRegisteredSession(coordRoute);
            const since = Number.parseInt(String(req.query.since ?? ''), 10);
            res.json((0, agy_brain_1.readAgySwarmState)(target.nativeSessionId, {
                isActive: !!coordReg,
                coordinatorTurnInProgress: coordReg?.turnInProgress === true,
                since: Number.isFinite(since) && since > 0 ? since : 0,
            }));
        }
        catch (error) {
            res.status(INVALID_SESSION_RE.test((0, http_boundary_1.errorMessage)(error)) ? 400 : 500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    };
    const artifacts = (req, res) => {
        try {
            const target = resolveAgyTarget(req.params.id);
            if (!target) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            if (target.harnessId !== 'agy') {
                res.json({ supported: false, artifacts: [] });
                return;
            }
            res.json({ supported: true, artifacts: (0, agy_brain_1.readAgyBrainArtifacts)(target.nativeSessionId) });
        }
        catch (error) {
            res.status(INVALID_SESSION_RE.test((0, http_boundary_1.errorMessage)(error)) ? 400 : 500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    };
    return { tasks, taskLog, swarm, artifacts };
}
