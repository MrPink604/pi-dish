// Generated from src/core/harness-feature-commands.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor } from './contracts';
import { type CatalogModel } from './session-api';
export declare const MODELS_CACHE_TTL = 60000;
export declare function harnessCommandAvailable(descriptor: HarnessDescriptor): boolean;
/** Run the configured harness, preserving its cwd, environment and extensions. */
export declare function runHarnessJsonCommand(descriptor: HarnessDescriptor, commandArgs: string[], { cwd, acceptCompleteJson }?: {
    cwd?: unknown;
    acceptCompleteJson?: boolean;
}): Promise<unknown>;
/** Shared raw catalog: pricing and interactive discovery must not start two CLIs. */
export declare function runHarnessModelCatalog(descriptor: HarnessDescriptor, { cwd, force }?: {
    cwd?: unknown;
    force?: boolean;
}): Promise<unknown>;
export declare function runHarnessModelCommand(descriptor: HarnessDescriptor, options?: {
    cwd?: unknown;
}): Promise<CatalogModel[]>;
/** Older live registries can omit thinking ladders; missing catalog stays partial. */
export declare function withCatalogThinkingLevels(models: CatalogModel[], descriptor: HarnessDescriptor | null, options?: {
    cwd?: unknown;
}): Promise<CatalogModel[]>;
