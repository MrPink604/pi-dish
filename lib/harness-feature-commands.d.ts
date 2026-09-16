// Generated from src/core/harness-feature-commands.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor } from './contracts';
import { type CatalogModel } from './session-api';
export declare const MODELS_CACHE_TTL = 60000;
export declare function harnessCommandAvailable(descriptor: HarnessDescriptor): boolean;
/** Interactive feature adapter; deliberately separate from pricing's runner. */
export declare function runHarnessJsonCommand(descriptor: HarnessDescriptor, commandArgs: string[], { cwd, acceptCompleteJson }?: {
    cwd?: unknown;
    acceptCompleteJson?: boolean;
}): Promise<unknown>;
export declare function runHarnessModelCommand(descriptor: HarnessDescriptor, { cwd }?: {
    cwd?: unknown;
}): Promise<CatalogModel[]>;
/** Live OMP lists omit catalog thinking ladders; missing catalog stays partial. */
export declare function withCatalogThinkingLevels(models: CatalogModel[], descriptor: HarnessDescriptor | null): Promise<CatalogModel[]>;
