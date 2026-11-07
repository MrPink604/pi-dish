// Generated from src/core/session-relation-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionRelationHandlers = createSessionRelationHandlers;
const path = require("path");
const session_catalog_1 = require("./session-catalog");
const session_catalog_runtime_1 = require("./session-catalog-runtime");
const session_index_1 = require("./session-index");
const http_boundary_1 = require("./http-boundary");
const sessionProvenance = require("./session-provenance");
const LINEAGE_NODE_CAP_DEFAULT = 500;
const LINEAGE_DEPTH_CAP = 24;
const INVALID_SESSION_RE = /Invalid session ID|Unknown harness/;
// OMP files a task subagent beside its parent as `<parent-stem>/<AgentId>.jsonl`;
// that stem is the id job and wait rows name it by.
function parentPathOf(session) {
    if (!session?.parentSession || !session.sessionFile)
        return null;
    return path.isAbsolute(session.parentSession)
        ? session.parentSession : path.resolve(path.dirname(session.sessionFile), session.parentSession);
}
function nativeAgentId(session) {
    const parentFile = parentPathOf(session);
    return parentFile && path.resolve(path.dirname(session.sessionFile)) === path.resolve(parentFile).replace(/\.jsonl$/, '')
        ? path.basename(session.sessionFile, '.jsonl') : null;
}
function relationSessionSummary(session) {
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
function createSessionRelationHandlers(ports) {
    const { catalog: runtime } = ports;
    // Advisory relationships only: native parentSession headers, OMP's nested
    // subsession layout, and pi-dish launch provenance. None implies control.
    function related(req, res) {
        try {
            const base = runtime.buildSessionCatalog();
            const list = [...base.list];
            const byId = new Map(base.byId);
            const byPath = new Map(base.byPath);
            let resolved = byId.get(req.params.id);
            if (!resolved) {
                const candidate = ports.resolveSessionCandidate(req.params.id);
                if (!candidate) {
                    res.status(404).json({ error: 'Session not found' });
                    return;
                }
                resolved = (0, session_catalog_1.buildSourceSession)(candidate, (0, session_index_1.getSessionInfo)(candidate), (0, session_catalog_runtime_1.historicalAdvice)(candidate), runtime.options);
                byId.set(resolved.id, resolved);
                byPath.set((0, session_catalog_runtime_1.canonicalSessionPath)(candidate.file), resolved);
                list.push(resolved);
            }
            const current = resolved;
            const relations = [];
            const seen = new Set();
            const add = (kind, source, target) => {
                if (!target || target.id === current.id)
                    return;
                const key = `${kind}:${source}:${target.id}`;
                if (seen.has(key))
                    return;
                seen.add(key);
                relations.push({ kind, source, session: relationSessionSummary(target) });
            };
            const resolveParent = (session) => {
                const parentPath = parentPathOf(session);
                return parentPath ? byPath.get((0, session_catalog_runtime_1.canonicalSessionPath)(parentPath)) || null : null;
            };
            add('parent', current.parentSessionSource || 'pi-session-header', resolveParent(current));
            for (const candidate of list) {
                if (resolveParent(candidate)?.id === current.id) {
                    add('child', candidate.parentSessionSource || 'pi-session-header', candidate);
                }
            }
            const launch = sessionProvenance.getLaunch(current.id);
            if (launch)
                add('startedFrom', 'pi-dish-launch', byId.get(launch.sourceSessionId));
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
        }
        catch (error) {
            res.status(INVALID_SESSION_RE.test((0, http_boundary_1.errorMessage)(error)) ? 400 : 500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    }
    // Recursive family view: the whole native/launch family around a session
    // rather than /related's direct neighbors.
    function lineage(req, res) {
        try {
            const configuredCap = Number.parseInt(process.env.PI_DISH_LINEAGE_NODE_CAP || '', 10);
            const nodeCap = Number.isFinite(configuredCap) && configuredCap > 0 ? configuredCap : LINEAGE_NODE_CAP_DEFAULT;
            const catalog = runtime.buildSessionCatalog();
            let list = catalog.list;
            let byId = catalog.byId;
            const byPath = catalog.byPath;
            let current = byId.get(req.params.id);
            if (!current) {
                const candidate = ports.resolveSessionCandidate(req.params.id);
                if (!candidate) {
                    res.status(404).json({ error: 'Session not found' });
                    return;
                }
                current = (0, session_catalog_1.buildSourceSession)(candidate, (0, session_index_1.getSessionInfo)(candidate), (0, session_catalog_runtime_1.historicalAdvice)(candidate), runtime.options);
                // Mirror composeSessionCatalog's parent resolution for a row the scan
                // has not folded in yet (indexing race).
                const parentPath = parentPathOf(current);
                const nativeParent = parentPath ? byPath.get((0, session_catalog_runtime_1.canonicalSessionPath)(parentPath))?.id || null : null;
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
            const childrenOf = new Map();
            for (const session of list) {
                if (!session.parentId || session.parentId === session.id)
                    continue;
                const siblings = childrenOf.get(session.parentId);
                if (siblings)
                    siblings.push(session);
                else
                    childrenOf.set(session.parentId, [session]);
            }
            const activityMs = (session) => {
                const value = new Date(session.lastActivity || 0).getTime();
                return Number.isFinite(value) ? value : 0;
            };
            // The top ancestor owns the root slot; cycle-guarded for hand-edited headers.
            let root = current;
            const ancestors = new Set([current.id]);
            while (root.parentId) {
                const parent = byId.get(root.parentId);
                if (!parent || ancestors.has(parent.id))
                    break;
                ancestors.add(parent.id);
                root = parent;
            }
            const placed = new Set();
            let members = 0, truncated = false;
            const buildNode = (session, edge, depth) => {
                if (placed.has(session.id))
                    return null;
                if (depth > LINEAGE_DEPTH_CAP || members >= nodeCap) {
                    truncated = true;
                    return null;
                }
                placed.add(session.id);
                members += 1;
                const children = [];
                for (const child of (childrenOf.get(session.id) || []).sort((a, b) => activityMs(b) - activityMs(a))) {
                    const node = buildNode(child, {
                        kind: child.parentSource === 'pi-dish-launch' ? 'startedHere' : 'child',
                        source: child.parentSource || 'pi-session-header',
                    }, depth + 1);
                    if (node)
                        children.push(node);
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
        }
        catch (error) {
            res.status(INVALID_SESSION_RE.test((0, http_boundary_1.errorMessage)(error)) ? 400 : 500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    }
    return { related, lineage };
}
