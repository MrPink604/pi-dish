// Generated from src/core/session-read-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import { BridgeSession } from './bridge-session';
import type { BridgeRegistryEntry } from './contracts';
import type { LiveSession, RuntimeDescription } from './session-ownership';
import type { SessionSource } from './session-source-contracts';
/** Ports retain captured read identity, never lifecycle permission. */
export interface SessionReadPorts {
    findSessionSource(id: string, options?: {
        exact?: boolean;
    }): SessionSource | null;
    liveSessionHistoryPending(id: string): boolean;
    getRegisteredSession(id: string): BridgeRegistryEntry | null;
    getRPCSession(id: string): unknown;
    getLiveSession(id: string): Promise<LiveSession | null>;
    liveTreeLeafId(session: InstanceType<typeof BridgeSession>): Promise<unknown>;
    getLiveContextUsage(id: string): unknown;
    getContextWindow(model: string | null | undefined): number;
    describeRuntime(id: string): Promise<RuntimeDescription | null>;
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
export declare function createSessionReadHandlers(ports: SessionReadPorts): SessionReadHandlers;
export {};
