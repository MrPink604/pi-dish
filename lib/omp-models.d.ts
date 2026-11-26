// Generated from src/core/omp-models.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
type Handler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export declare const DEFAULT_GET_TIMEOUT_MS = 60000;
export declare const DEFAULT_DRY_RUN_TIMEOUT_MS = 360000;
export declare const DEFAULT_PREVIEW_TIMEOUT_MS = 15000;
export declare const DEFAULT_APPLY_WAIT_MS = 1500;
export interface OmpPreviewModel {
    provider: string;
    id: string;
    name: string;
    selector: string;
    current?: boolean;
}
export interface OmpModelsPreviewResult {
    total: number;
    truncated: boolean;
    startupModel: OmpPreviewModel | null;
    models: OmpPreviewModel[];
}
export interface OmpModelsHttpReply {
    status: number;
    body: Record<string, unknown>;
}
export type OmpModelsApplyStatus = {
    readonly state: 'idle';
} | {
    readonly state: 'running';
    readonly startedAt: number;
    readonly base: string;
} | {
    readonly state: 'done';
    readonly startedAt: number;
    readonly finishedAt: number;
    readonly base: string;
    readonly result: OmpModelsHttpReply;
};
export interface OmpModelsServiceOptions {
    /** Override the `fleet` helper path (defaults to `~/.local/bin/fleet`). */
    fleetBin?: string;
    /** Override the state/tmp root for mode-0600 temp files (defaults to `~/.pi/dish/tmp`). */
    tmpDir?: string;
    /** Override helper timeouts (ms) for read/dry-run only; running applies are never killed on deadline. */
    getTimeoutMs?: number;
    dryRunTimeoutMs?: number;
    /** How long POST /apply waits for completion before returning 202 {state:"running"} (ms). */
    applyWaitMs?: number;
    /** Override `omp --mode rpc` preview timeout (ms). */
    previewTimeoutMs?: number;
    /** Override process bounds (defaults: 2 preview running, 4 preview queued, 2 get/dryRun running). */
    maxPreviewConcurrency?: number;
    maxPreviewQueue?: number;
    maxHelperConcurrency?: number;
}
export interface OmpModelsService {
    available(): boolean;
    get(signal?: AbortSignal): Promise<OmpModelsHttpReply>;
    preview(input: {
        enabledModels: string[];
        query?: string;
        limit?: number;
    }, signal?: AbortSignal): Promise<OmpModelsHttpReply>;
    dryRun(input: {
        base: string;
        enabledModels: string[];
    }, signal?: AbortSignal): Promise<OmpModelsHttpReply>;
    apply(input: {
        base: string;
        enabledModels: string[];
    }): Promise<OmpModelsHttpReply>;
    applyStatus(): OmpModelsHttpReply;
    dispose(): void;
}
export interface OmpModelsHandlers {
    available(): boolean;
    get: Handler;
    preview: Handler;
    dryRun: Handler;
    apply: Handler;
    applyStatus: Handler;
    dispose(): void;
}
/** Minimal trusted environment for `fleet omp-models` so git resolves user identity and tools while excluding all ambient/override vars. */
export declare function minimalFleetHelperEnv(): NodeJS.ProcessEnv;
export declare function createOmpModelsService(options?: OmpModelsServiceOptions): OmpModelsService;
export declare function createOmpModelsHandlers(service?: OmpModelsService): OmpModelsHandlers;
export {};
