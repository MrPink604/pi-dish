// Generated from src/core/session-api.ts; edit that source and run npm run build:core.
/** Browser-facing API values. Unknown extension fields stay opaque. */
export interface SessionMetadata extends Record<string, unknown> {
    id: string;
    name?: string | null;
    model?: string | null;
    harnessId?: string;
    thinkingLevel?: string | null;
    isActive?: boolean;
    capabilities?: Partial<Record<string, boolean>>;
}
export interface SessionList extends Record<string, unknown> {
    active: SessionMetadata[];
    previous: SessionMetadata[];
    children?: SessionMetadata[];
}
export interface ModelPricing {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
}
export interface CatalogModel extends Record<string, unknown> {
    id: string;
    provider: string;
    name: string;
    selector?: string | null;
    contextWindow: number;
    reasoning: boolean;
    thinking?: string[] | null;
    pricing: ModelPricing | null;
    free: boolean;
    enabled?: boolean;
}
export interface ModelChangeRequest {
    modelId: string;
}
export interface ThinkingChangeRequest {
    level: string;
}
export interface EnabledModelsRequest {
    enabledIds: string[] | null;
}
export interface MutationResult extends Record<string, unknown> {
    success: true;
}
export interface ThinkingResult extends MutationResult {
    level: string;
}
export interface EnabledModelsResult extends MutationResult {
    enabledModels: string[] | null;
}
export declare function decodeSessionMetadata(value: unknown): SessionMetadata;
export declare function decodeSessionList(value: unknown): SessionList;
/** Preserve the existing client projection; full API rows retain provenance. */
export declare function sessionForClient(session: Record<string, unknown>): SessionMetadata;
/** Harness model discovery accepts native refs/records, then projects API rows. */
export declare function normalizeModels(value: unknown): CatalogModel[];
/** Decode API/catalog-cache rows, preserving extra metadata and optional legacy fields. */
export declare function decodeModelCatalog(value: unknown): CatalogModel[];
export declare function decodeMutationResult(value: unknown): MutationResult;
export declare function decodeThinkingResult(value: unknown): ThinkingResult;
export declare function decodeEnabledModelsResult(value: unknown): EnabledModelsResult;
/** A harness can acknowledge the mutation without reporting a usable level. */
export declare function thinkingResult(value: unknown, requested: string): ThinkingResult;
