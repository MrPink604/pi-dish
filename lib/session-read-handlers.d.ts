// Generated from src/core/session-read-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { CatalogRuntime } from './session-catalog-runtime';
import type { SessionMessage } from './session-files';
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
    media: ReadHandler;
    messages: ReadHandler;
    search: ReadHandler;
    stats: ReadHandler;
    tree: ReadHandler;
    export: ReadHandler;
    exportSessionHtml(source: SessionSource, outputPath: string, options?: SessionExportOptions): Promise<string>;
    getOmpShareSnapshot(source: SessionSource): Promise<unknown>;
}
/**
 * Pair task toolCall occurrences to their matching toolResult message index in
 * chronological order, purely in memory (zero filesystem reads).
 * - Matches exact IDs first and provider-normalized IDs (`call_X` <-> `call_X|fc_Y`).
 * - A reused ID in a later turn pairs only with its own occurrence and never relinks
 *   an earlier card.
 * - Fails closed on ambiguity (duplicate open calls sharing a raw/normalized ID, or
 *   multiple toolResults claiming the same call occurrence).
 */
export declare function pairTaskCallsInMemory(messages: readonly SessionMessage[]): Map<string, number>;
export declare function createSessionReadHandlers({ ownership, catalog, findSessionSource }: SessionReadPorts): SessionReadHandlers;
export {};
