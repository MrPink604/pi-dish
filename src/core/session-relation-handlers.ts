import path = require('path');
import type { RouteHandler } from './http-boundary';
import { buildSourceSession } from './session-catalog';
import { canonicalSessionPath, historicalAdvice } from './session-catalog-runtime';
import { getSessionInfo } from './session-index';
import { errorMessage } from './http-boundary';
import sessionProvenance = require('./session-provenance');
import type { CatalogRuntime } from './session-catalog-runtime';
import type { CatalogSession } from './session-catalog';
import type { SessionSource } from './session-source';

interface CatalogRelationSummary extends Pick<CatalogSession, 'id' | 'sessionKey' | 'name' | 'lastActivity'> {
  harnessId: CatalogSession['harnessId'];
  nativeSessionId: CatalogSession['nativeSessionId'] | CatalogSession['id'];
  cwd: string | null;
  model: string;
  isActive: boolean;
  subagentLive: boolean;
  turnInProgress: boolean;
  capabilities: NonNullable<CatalogSession['capabilities']> | null;
  /** OMP task subagent id (its `<parent>/<AgentId>.jsonl` stem). */
  agentId?: string;
}

interface CatalogRelation {
  kind: 'parent' | 'child' | 'startedFrom' | 'startedHere';
  source: string;
  session: CatalogRelationSummary;
}

interface CatalogLineageEdge {
  kind: 'startedHere' | 'child';
  source: string;
}

interface CatalogLineageNode {
  session: CatalogRelationSummary;
  edge: CatalogLineageEdge | null;
  children: CatalogLineageNode[];
}

export interface SessionRelationPorts {
  catalog: CatalogRuntime;
  resolveSessionCandidate(id: string): SessionSource | null;
}

const LINEAGE_NODE_CAP_DEFAULT = 500;
const LINEAGE_DEPTH_CAP = 24;
const INVALID_SESSION_RE = /Invalid session ID|Unknown harness/;

// OMP files a task subagent beside its parent as `<parent-stem>/<AgentId>.jsonl`;
// that stem is the id job and wait rows name it by.
function parentPathOf(session: CatalogSession | null | undefined): string | null {
  if (!session?.parentSession || !session.sessionFile) return null;
  return path.isAbsolute(session.parentSession)
    ? session.parentSession : path.resolve(path.dirname(session.sessionFile), session.parentSession);
}

function nativeAgentId(session: CatalogSession): string | null {
  const parentFile = parentPathOf(session);
  return parentFile && path.resolve(path.dirname(session.sessionFile!)) === path.resolve(parentFile).replace(/\.jsonl$/, '')
    ? path.basename(session.sessionFile!, '.jsonl') : null;
}

function relationSessionSummary(session: CatalogSession): CatalogRelationSummary {
  const agentId = nativeAgentId(session);
  return {
    id: session.id,
    sessionKey: session.sessionKey,
    harnessId: session.harnessId || 'pi',
    nativeSessionId: session.nativeSessionId || session.id,
    name: session.name,
    cwd: session.cwd || null,
    model: session.model || 'unknown',
    isActive: !!session.isActive,
    subagentLive: !!session.subagentLive,
    turnInProgress: !!session.turnInProgress,
    capabilities: session.capabilities || null,
    lastActivity: session.lastActivity,
    ...(agentId ? { agentId } : {}),
  };
}

export function createSessionRelationHandlers(ports: SessionRelationPorts) {
  const { catalog: runtime } = ports;

  // Advisory relationships only: native parentSession headers, OMP's nested
  // subsession layout, and pi-dish launch provenance. None implies control.
  function related(req: Parameters<RouteHandler>[0], res: Parameters<RouteHandler>[1]): void {
    try {
      const base = runtime.buildSessionCatalog();
      const list = [...base.list];
      const byId = new Map<string, CatalogSession>(base.byId);
      const byPath = new Map<string | null, CatalogSession>(base.byPath);
      let resolved = byId.get(req.params.id);
      if (!resolved) {
        const candidate = ports.resolveSessionCandidate(req.params.id);
        if (!candidate) { res.status(404).json({ error: 'Session not found' }); return; }
        resolved = buildSourceSession(candidate, getSessionInfo(candidate), historicalAdvice(candidate), runtime.options);
        byId.set(resolved.id, resolved);
        byPath.set(canonicalSessionPath(candidate.file), resolved);
        list.push(resolved);
      }
      const current = resolved;

      const relations: CatalogRelation[] = [];
      const seen = new Set<string>();
      const add = (kind: CatalogRelation['kind'], source: string, target: CatalogSession | null | undefined): void => {
        if (!target || target.id === current.id) return;
        const key = `${kind}:${source}:${target.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        relations.push({ kind, source, session: relationSessionSummary(target) });
      };
      const resolveParent = (session: CatalogSession | null | undefined): CatalogSession | null => {
        const parentPath = parentPathOf(session);
        return parentPath ? byPath.get(canonicalSessionPath(parentPath)) || null : null;
      };

      add('parent', current.parentSessionSource || 'pi-session-header', resolveParent(current));
      for (const candidate of list) {
        if (resolveParent(candidate)?.id === current.id) {
          add('child', candidate.parentSessionSource || 'pi-session-header', candidate);
        }
      }

      const launch = sessionProvenance.getLaunch(current.id);
      if (launch) add('startedFrom', 'pi-dish-launch', byId.get(launch.sourceSessionId));
      for (const child of sessionProvenance.getLaunchesFrom(current.id)) {
        add('startedHere', 'pi-dish-launch', byId.get(child.sessionId));
      }

      res.json({
        session: relationSessionSummary(current),
        relations,
        indexing: base.indexing,
        discoveryTruncated: base.discoveryTruncated,
        discoverySkipped: base.discoverySkipped,
      });
    } catch (error) {
      res.status(INVALID_SESSION_RE.test(errorMessage(error)) ? 400 : 500).json({ error: errorMessage(error) });
    }
  }

  // Recursive family view: the whole native/launch family around a session
  // rather than /related's direct neighbors.
  function lineage(req: Parameters<RouteHandler>[0], res: Parameters<RouteHandler>[1]): void {
    try {
      const configuredCap = Number.parseInt(process.env.PI_DISH_LINEAGE_NODE_CAP || '', 10);
      const nodeCap = Number.isFinite(configuredCap) && configuredCap > 0 ? configuredCap : LINEAGE_NODE_CAP_DEFAULT;
      const catalog = runtime.buildSessionCatalog();
      let list = catalog.list;
      let byId: ReadonlyMap<string, CatalogSession> = catalog.byId;
      const byPath: ReadonlyMap<string | null, CatalogSession> = catalog.byPath;
      let current = byId.get(req.params.id);
      if (!current) {
        const candidate = ports.resolveSessionCandidate(req.params.id);
        if (!candidate) { res.status(404).json({ error: 'Session not found' }); return; }
        current = buildSourceSession(candidate, getSessionInfo(candidate), historicalAdvice(candidate), runtime.options);
        // Mirror composeSessionCatalog's parent resolution for a row the scan
        // has not folded in yet (indexing race).
        const parentPath = parentPathOf(current);
        const nativeParent = parentPath ? byPath.get(canonicalSessionPath(parentPath))?.id || null : null;
        const launch = sessionProvenance.getLaunch(current.id);
        current.parentId = nativeParent
          || (launch && byId.has(launch.sourceSessionId) ? launch.sourceSessionId : null);
        current.parentSource = nativeParent ? current.parentSessionSource || 'pi-session-header'
          : current.parentId ? 'pi-dish-launch' : null;
        list = [...list, current];
        const extendedById = new Map(byId);
        extendedById.set(current.id, current);
        byId = extendedById;
      }

      const childrenOf = new Map<string, CatalogSession[]>();
      for (const session of list) {
        if (!session.parentId || session.parentId === session.id) continue;
        const siblings = childrenOf.get(session.parentId);
        if (siblings) siblings.push(session); else childrenOf.set(session.parentId, [session]);
      }
      const activityMs = (session: CatalogSession): number => {
        const value = new Date(session.lastActivity || 0).getTime();
        return Number.isFinite(value) ? value : 0;
      };

      // The top ancestor owns the root slot; cycle-guarded for hand-edited headers.
      let root: CatalogSession = current;
      const ancestors = new Set<string>([current.id]);
      while (root.parentId) {
        const parent = byId.get(root.parentId);
        if (!parent || ancestors.has(parent.id)) break;
        ancestors.add(parent.id);
        root = parent;
      }

      const placed = new Set<string>();
      let members = 0, truncated = false;
      const buildNode = (session: CatalogSession, edge: CatalogLineageEdge | null, depth: number): CatalogLineageNode | null => {
        if (placed.has(session.id)) return null;
        if (depth > LINEAGE_DEPTH_CAP || members >= nodeCap) { truncated = true; return null; }
        placed.add(session.id);
        members += 1;
        const children: CatalogLineageNode[] = [];
        for (const child of (childrenOf.get(session.id) || []).sort((a, b) => activityMs(b) - activityMs(a))) {
          const node = buildNode(child, {
            kind: child.parentSource === 'pi-dish-launch' ? 'startedHere' : 'child',
            source: child.parentSource || 'pi-session-header',
          }, depth + 1);
          if (node) children.push(node);
        }
        return { session: relationSessionSummary(session), edge, children };
      };
      const tree = buildNode(root, null, 0);

      res.json({
        session: relationSessionSummary(current),
        tree,
        members,
        truncated,
        indexing: catalog.indexing,
        discoveryTruncated: catalog.discoveryTruncated,
        discoverySkipped: catalog.discoverySkipped,
      });
    } catch (error) {
      res.status(INVALID_SESSION_RE.test(errorMessage(error)) ? 400 : 500).json({ error: errorMessage(error) });
    }
  }

  return { related, lineage };
}
