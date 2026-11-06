// Generated from src/core/session-relation-handlers.ts; edit that source and run npm run build:core.
import type { RouteHandler } from './http-boundary';
import type { CatalogRuntime } from './session-catalog-runtime';
import type { CatalogSession } from './session-catalog-contracts';
import type { SessionSource } from './session-source-contracts';
export interface CatalogRelationSummary extends Pick<CatalogSession, 'id' | 'sessionKey' | 'name' | 'lastActivity'> {
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
export interface CatalogRelation {
    kind: 'parent' | 'child' | 'startedFrom' | 'startedHere';
    source: string;
    session: CatalogRelationSummary;
}
export interface CatalogLineageEdge {
    kind: 'startedHere' | 'child';
    source: string;
}
export interface CatalogLineageNode {
    session: CatalogRelationSummary;
    edge: CatalogLineageEdge | null;
    children: CatalogLineageNode[];
}
export interface SessionRelationPorts {
    catalog: CatalogRuntime;
    resolveSessionCandidate(id: string): SessionSource | null;
}
export declare function createSessionRelationHandlers(ports: SessionRelationPorts): {
    related: RouteHandler;
    lineage: RouteHandler;
};
