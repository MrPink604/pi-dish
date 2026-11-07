// Generated from src/core/feature-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { CatalogRuntime } from './session-catalog-runtime';
import type { SessionSource } from './session-source';
import type { SessionOwnership } from './session-ownership';
export type FeatureHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export interface FeaturePorts {
    catalog: CatalogRuntime;
    ownership: SessionOwnership;
    findSessionSource(id: string, options?: {
        exact?: boolean;
    }): SessionSource | null;
    applicationRoot: string;
    piSettingsFile: string;
}
export interface FeatureHandlers {
    harnesses: FeatureHandler;
    harnessConfig: FeatureHandler;
    updateModelRoles: FeatureHandler;
    harnessAgents: FeatureHandler;
    updateHarnessAgents: FeatureHandler;
    listHarnessSettings: FeatureHandler;
    updateHarnessSettings: FeatureHandler;
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
