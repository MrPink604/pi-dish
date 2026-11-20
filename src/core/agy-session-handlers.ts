/**
 * Session-scoped Antigravity (`agy`) HTTP read handlers for background tasks,
 * task logs, plan checklists, subagent status, and live swarm boards.
 */
import type { RouteHandler } from './http-boundary';
import { errorMessage } from './http-boundary';
import { BridgeSession } from './bridge-session';
import {
  agyRouteId,
  findAgySwarmCoordinator,
  readAgyBrainArtifacts,
  readAgySessionTasks,
  readAgySwarmState,
  readAgyTaskLog,
  type AgyPlanItem,
} from './agy-brain';
import { canonicalSessionId } from './session-key';
import { routeIdentity } from './session-ownership';
import type { LiveSession, SessionOwnership } from './session-ownership';
import type { SessionSource } from './session-source';
import { finite, record as isRecord, text } from './helper-values';
import { asRecord } from './wire-protocol';

export interface AgySessionHandlerPorts {
  ownership: SessionOwnership;
  findSessionSource(id: string, options?: { exact?: boolean }): SessionSource | null;
}

const INVALID_SESSION_RE = /Invalid session ID|Unknown harness/;

function parsePlanItems(raw: unknown): AgyPlanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AgyPlanItem[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const content = text(row.content) || text(row.title);
    if (!content) continue;
    const status = row.status === 'completed' || row.status === 'in_progress' ? row.status : 'pending';
    const priority = text(row.priority) || undefined;
    out.push({ content, status, ...(priority ? { priority } : {}) });
  }
  return out;
}

function parseRunningTools(raw: unknown): { toolCallId: string; toolName: string; args: unknown; startedAt: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { toolCallId: string; toolName: string; args: unknown; startedAt: number }[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const toolCallId = text(row.toolCallId);
    const toolName = text(row.toolName);
    if (!toolCallId || !toolName) continue;
    out.push({
      toolCallId,
      toolName,
      args: row.args,
      startedAt: finite(row.startedAt) ? row.startedAt : Date.now(),
    });
  }
  return out;
}

export function createAgySessionHandlers({ ownership, findSessionSource }: AgySessionHandlerPorts) {
  function resolveAgyTarget(routeParam: string): { harnessId: string; nativeSessionId: string; routeId: string } | null {
    const reg = ownership.getRegisteredSession(routeParam);
    const identity = routeIdentity(routeParam);
    if (reg && identity) {
      return { harnessId: identity.harnessId, nativeSessionId: identity.nativeSessionId, routeId: canonicalSessionId(routeParam) };
    }
    const source = findSessionSource(routeParam);
    if (source) {
      return { harnessId: source.harnessId, nativeSessionId: source.nativeSessionId, routeId: source.routeId };
    }
    return null;
  }

  async function liveAgyOverlay(routeId: string): Promise<{
    isActive: boolean;
    turnInProgress: boolean;
    plan: AgyPlanItem[];
    runningTools: { toolCallId: string; toolName: string; args: unknown; startedAt: number }[];
  }> {
    const reg = ownership.getRegisteredSession(routeId);
    if (!reg) return { isActive: false, turnInProgress: false, plan: [], runningTools: [] };
    let plan: AgyPlanItem[] = [];
    let runningTools: { toolCallId: string; toolName: string; args: unknown; startedAt: number }[] = [];
    let turnInProgress = reg.turnInProgress === true;
    try {
      const live: LiveSession | null = await ownership.getLiveSession(routeId);
      if (live instanceof BridgeSession) {
        const state = asRecord(await live.send('get_state', {}, { timeout: 5000 }));
        plan = parsePlanItems(state.plan);
        runningTools = parseRunningTools(state.runningTools);
        if (typeof state.turnInProgress === 'boolean') turnInProgress = state.turnInProgress;
      }
    } catch { /* Fall back to registry claim + brain files if bridge is momentarily busy. */ }
    return { isActive: true, turnInProgress, plan, runningTools };
  }

  const tasks: RouteHandler = async (req, res) => {
    try {
      const target = resolveAgyTarget(req.params.id);
      if (!target) { res.status(404).json({ error: 'Session not found' }); return; }
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
        const coordNative = findAgySwarmCoordinator(target.nativeSessionId);
        if (coordNative && coordNative !== target.nativeSessionId) {
          const coordReg = ownership.getRegisteredSession(agyRouteId(coordNative));
          if (coordReg) {
            effectiveActive = true;
            coordTurn = coordReg.turnInProgress === true;
          }
        }
      }
      res.json(readAgySessionTasks(target.nativeSessionId, {
        isActive: effectiveActive,
        canControl: overlay.isActive,
        coordinatorTurnInProgress: coordTurn,
        livePlan: overlay.plan,
        liveRunningTools: overlay.runningTools,
      }));
    } catch (error) {
      res.status(INVALID_SESSION_RE.test(errorMessage(error)) ? 400 : 500).json({ error: errorMessage(error) });
    }
  };

  const taskLog: RouteHandler = (req, res) => {
    try {
      const target = resolveAgyTarget(req.params.id);
      if (!target || target.harnessId !== 'agy') { res.status(404).json({ error: 'Session not found' }); return; }
      const taskId = text(req.params.taskId);
      const tailParam = Number.parseInt(String(req.query.tail ?? ''), 10);
      const log = readAgyTaskLog(target.nativeSessionId, taskId, Number.isFinite(tailParam) ? tailParam : undefined);
      if (!log) { res.status(404).json({ error: 'Task log not found' }); return; }
      res.json(log);
    } catch (error) {
      res.status(INVALID_SESSION_RE.test(errorMessage(error)) ? 400 : 500).json({ error: errorMessage(error) });
    }
  };

  const swarm: RouteHandler = (req, res) => {
    try {
      const target = resolveAgyTarget(req.params.id);
      if (!target) { res.status(404).json({ error: 'Session not found' }); return; }
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
      const coordNative = findAgySwarmCoordinator(target.nativeSessionId) ?? target.nativeSessionId;
      const coordRoute = agyRouteId(coordNative);
      const coordReg = ownership.getRegisteredSession(coordRoute);
      const since = Number.parseInt(String(req.query.since ?? ''), 10);
      res.json(readAgySwarmState(target.nativeSessionId, {
        isActive: !!coordReg,
        coordinatorTurnInProgress: coordReg?.turnInProgress === true,
        since: Number.isFinite(since) && since > 0 ? since : 0,
      }));
    } catch (error) {
      res.status(INVALID_SESSION_RE.test(errorMessage(error)) ? 400 : 500).json({ error: errorMessage(error) });
    }
  };

  const artifacts: RouteHandler = (req, res) => {
    try {
      const target = resolveAgyTarget(req.params.id);
      if (!target) { res.status(404).json({ error: 'Session not found' }); return; }
      if (target.harnessId !== 'agy') {
        res.json({ supported: false, artifacts: [] });
        return;
      }
      res.json({ supported: true, artifacts: readAgyBrainArtifacts(target.nativeSessionId) });
    } catch (error) {
      res.status(INVALID_SESSION_RE.test(errorMessage(error)) ? 400 : 500).json({ error: errorMessage(error) });
    }
  };

  return { tasks, taskLog, swarm, artifacts };
}
