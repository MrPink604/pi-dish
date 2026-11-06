// Generated from src/core/session-browse-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { HibernationState } from './session-api';
import type { CatalogRuntime } from './session-catalog-runtime';
export interface SessionBrowsePorts {
    catalog: CatalogRuntime;
    hibernated(): ReadonlyMap<string, HibernationState>;
}
type BrowseHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export declare function createSessionBrowseHandlers(ports: SessionBrowsePorts): {
    list: BrowseHandler;
    hostHealth: BrowseHandler;
    resolve: BrowseHandler;
    search: BrowseHandler;
};
export {};
