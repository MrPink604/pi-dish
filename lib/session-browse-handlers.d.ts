// Generated from src/core/session-browse-handlers.ts; edit that source and run npm run build:core.
import type { RouteHandler } from './http-boundary';
import type { HibernationState } from './session-api';
import { type CatalogRuntime } from './session-catalog-runtime';
import type { IncomingMessage } from 'http';
export interface SessionBrowsePorts {
    catalog: CatalogRuntime;
    hibernated(): ReadonlyMap<string, HibernationState>;
    /** The request carries a private-session unlock token. */
    privateUnlocked(req: IncomingMessage): boolean;
    /** Opaque CU agent lease owner ID for an active managed session (null on non-CU hosts or non-holders). */
    cuOwnerId?(sessionId: string): string | null;
    /** True when an active CU-host session lost desktop access and needs restart to regain it. */
    cuDesktopAccessLost?(sessionId: string): boolean;
}
/** Opt-in `/api/sessions` bounds for agent callers; the browser sends neither, so its payload is unchanged. */
export interface CatalogBounds {
    limit: number | null;
    fields: readonly string[] | null;
}
export declare function parseCatalogBounds(limit: unknown, fields: unknown): CatalogBounds | {
    error: string;
};
/**
 * Apply `limit` across active, children, then previous — the order a caller
 * reads them — and keep only `fields` (plus `id`) of each row. A limited
 * response reports the unlimited row count as `total`.
 */
export declare function boundCatalog<T extends object>(groups: {
    active: readonly T[];
    previous: readonly T[];
    children: readonly T[];
}, bounds: CatalogBounds): {
    active: readonly T[];
    previous: readonly T[];
    children: readonly T[];
} | {
    active: object[];
    previous: object[];
    children: object[];
    total?: undefined;
} | {
    active: object[];
    previous: object[];
    children: object[];
    total: number;
};
export declare function createSessionBrowseHandlers(ports: SessionBrowsePorts): {
    list: RouteHandler;
    hostHealth: RouteHandler;
    resolve: RouteHandler;
    resolveBatch: RouteHandler;
    search: RouteHandler;
};
