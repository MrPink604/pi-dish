// Generated from src/core/session-browse-handlers.ts; edit that source and run npm run build:core.
import type { RouteHandler } from './http-boundary';
import type { HibernationState } from './session-api';
import type { CatalogRuntime } from './session-catalog-runtime';
export interface SessionBrowsePorts {
    catalog: CatalogRuntime;
    hibernated(): ReadonlyMap<string, HibernationState>;
}
export declare function createSessionBrowseHandlers(ports: SessionBrowsePorts): {
    list: RouteHandler;
    hostHealth: RouteHandler;
    resolve: RouteHandler;
    search: RouteHandler;
};
