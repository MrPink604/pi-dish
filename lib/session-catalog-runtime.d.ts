// Generated from src/core/session-catalog-runtime.ts; edit that source and run npm run build:core.
import { type PrimeDaemonSession } from './prime-daemon';
import type { LiveSession, SessionOwnership } from './session-ownership';
import type { BridgeRegistryEntry } from './contracts';
import type { SessionInfo } from './session-metadata';
import type { DiscoveryCandidate, SessionSource } from './session-source';
import type { CatalogAdvice, CatalogSession, SessionCatalog, SessionCatalogOptions } from './session-catalog';
import type { AvailableModel } from './pi-sdk';
import type { CatalogModel } from './session-api';
import type { ServedCacheExpiry } from './cache-lifetime';
export interface CatalogRuntimePorts {
    ownership: SessionOwnership;
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    /** Roster-discovered Prime roots attach their lifecycle listeners here. */
    onPrimeSession?(session: PrimeDaemonSession): void;
}
export type SessionFileInfo = SessionInfo & {
    contextWindow: number;
    contextPercent: number;
    cacheExpiry: ServedCacheExpiry | null;
};
export interface CatalogRuntime {
    readonly options: SessionCatalogOptions;
    buildSessionCatalog(options?: {
        activeOnly?: boolean;
    }): SessionCatalog;
    getActiveSessions(registered?: readonly BridgeRegistryEntry[]): readonly CatalogSession[];
    enumerateSessionCandidates(excludeIds?: ReadonlySet<string>): DiscoveryCandidate[];
    filterSessionsByQuery(list: readonly CatalogSession[], query: string): readonly CatalogSession[];
    resolveRefInCatalog(catalog: SessionCatalog, ref: unknown, exactOnly?: boolean): {
        session: CatalogSession | null;
        matches: CatalogSession[];
    };
    parseSessionFile(source: SessionSource): SessionFileInfo;
    getSessionModels(sessionId: string): Promise<CatalogModel[] | null>;
    refreshPrimeRoster(): Promise<void>;
}
export declare function canonicalSessionPath(file: string | null): string | null;
export declare function historicalAdvice(source: SessionSource, liveChild?: boolean): CatalogAdvice;
export declare function getContextWindow(modelId: string | null | undefined): number;
export declare function setModelsCache(models: AvailableModel[]): void;
export declare function getModelsCache(): {
    models: AvailableModel[] | null;
    time: number;
};
export declare function createCatalogRuntime(ports: CatalogRuntimePorts): CatalogRuntime;
