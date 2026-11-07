// Generated from src/core/session-read-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { CatalogRuntime } from './session-catalog-runtime';
import type { SessionOwnership } from './session-ownership';
import type { SessionSource } from './session-source';
export interface SessionReadPorts {
    ownership: SessionOwnership;
    catalog: CatalogRuntime;
    findSessionSource(id: string, options?: {
        exact?: boolean;
    }): SessionSource | null;
}
export interface SessionExportOptions {
    /** External native snapshot; the OMP exporter narrows consumed members. */
    shareSnapshot?: unknown;
    snapshotResolved?: boolean;
}
type ReadHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export interface SessionReadHandlers {
    image: ReadHandler;
    messages: ReadHandler;
    search: ReadHandler;
    stats: ReadHandler;
    tree: ReadHandler;
    export: ReadHandler;
    exportSessionHtml(source: SessionSource, outputPath: string, options?: SessionExportOptions): Promise<string>;
    getOmpShareSnapshot(source: SessionSource): Promise<unknown>;
}
export declare function createSessionReadHandlers({ ownership, catalog, findSessionSource }: SessionReadPorts): SessionReadHandlers;
export {};
