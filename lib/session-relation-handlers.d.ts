// Generated from src/core/session-relation-handlers.ts; edit that source and run npm run build:core.
import type { RouteHandler } from './http-boundary';
import type { CatalogRuntime } from './session-catalog-runtime';
import type { SessionSource } from './session-source-contracts';
export interface SessionRelationPorts {
    catalog: CatalogRuntime;
    resolveSessionCandidate(id: string): SessionSource | null;
}
export declare function createSessionRelationHandlers(ports: SessionRelationPorts): {
    related: (req: Parameters<RouteHandler>[0], res: Parameters<RouteHandler>[1]) => void;
    lineage: (req: Parameters<RouteHandler>[0], res: Parameters<RouteHandler>[1]) => void;
};
