// Generated from src/core/feature-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
export type FeatureHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export interface FeaturePorts {
    readDishSettings(): Record<string, unknown>;
    writeDishSettings(settings: Record<string, unknown>): void;
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
}
export declare function createFeatureHandlers(ports: FeaturePorts): FeatureHandlers;
