// Generated from src/core/feature-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { SessionCatalog } from './session-catalog-contracts';
import type { SessionSource } from './session-source-contracts';
import type { SessionOwnership } from './session-ownership';
import type { CatalogModel } from './session-api';
import type { AvailableModel } from './pi-sdk';
export type FeatureHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export interface FeaturePorts {
    readDishSettings(): Record<string, unknown>;
    writeDishSettings(settings: Record<string, unknown>): void;
    buildSessionCatalog(): Pick<SessionCatalog, 'list'>;
    enumerateSessionCandidates(): readonly SessionSource[];
    findSessionSource(id: string, options?: {
        exact?: boolean;
    }): SessionSource | null;
    getSessionModels(id: string): Promise<CatalogModel[] | null>;
    getLiveSession: SessionOwnership['getLiveSession'];
    /** Weak listing advice only; never a command-execution authorization. */
    locatePiPane: SessionOwnership['locatePiPane'];
    getModelsCache(): {
        models: AvailableModel[] | null;
        time: number;
    };
    /** The root setter also invalidates its context-window memo. */
    setModelsCache(models: AvailableModel[]): void;
    applicationRoot: string;
    piSettingsFile: string;
}
export interface FeatureHandlers {
    harnesses: FeatureHandler;
    harnessConfig: FeatureHandler;
    updateModelRoles: FeatureHandler;
    harnessAgents: FeatureHandler;
    updateHarnessAgents: FeatureHandler;
    transcribe: FeatureHandler;
    settings: FeatureHandler;
    updateSettings: FeatureHandler;
    usageLimits: FeatureHandler;
    cacheLifetimes: FeatureHandler;
    usageSummary: FeatureHandler;
    skills: FeatureHandler;
    skillActivations: FeatureHandler;
    skillCoverage: FeatureHandler;
    models: FeatureHandler;
    updateEnabledModels: FeatureHandler;
    commands: FeatureHandler;
}
export declare function createFeatureHandlers(ports: FeaturePorts): FeatureHandlers;
