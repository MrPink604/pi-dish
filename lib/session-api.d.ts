// Generated from src/core/session-api.ts; edit that source and run npm run build:core.
import type { CatalogSession } from './session-catalog-contracts';
/** Closed first-party metadata. Identity and opaque extras are separate owners. */
export interface SessionFields<Timestamp = string | number> {
    name?: string | null;
    model?: string | null;
    harnessId?: string;
    harnessLabel?: string;
    thinkingLevel?: string | null;
    isActive?: boolean;
    capabilities?: Partial<Record<string, boolean>>;
    closeMode?: string;
    conflicted?: boolean;
    liveInstanceCount?: number;
    contextPercent?: number;
    contextTokens?: number;
    contextWindow?: number;
    messageCount?: number;
    lastActivity?: Timestamp | null;
    turnInProgress?: boolean;
    compacting?: boolean;
    cwd?: string | null;
    subagentLive?: boolean;
    parentId?: string | null;
    parentSource?: string | null;
    familyParentId?: string | null;
    routine?: string;
    routineId?: string;
    routineInvocationId?: string;
    searchSnippet?: string;
    searchScore?: number;
}
/** Existing wire compatibility boundary, until Tasks 4/6 cut over all readers. */
export interface SessionMetadata extends Record<string, unknown>, Pick<SessionFields, 'name' | 'model' | 'harnessId' | 'thinkingLevel' | 'isActive' | 'capabilities'> {
    id: string;
}
/** A decoded row, before the answering endpoint stamps browser host identity. */
export interface SessionRow {
    readonly id: string;
    readonly fields: Readonly<SessionFields>;
    readonly extras: Readonly<Record<string, unknown>>;
}
export type SessionMutationPatch = Pick<SessionFields, 'name' | 'model' | 'thinkingLevel'>;
export type SessionActivityPatch = Pick<SessionFields, 'turnInProgress' | 'compacting'>;
export type SessionTranscriptPatch = Pick<SessionFields, 'name' | 'model' | 'cwd' | 'messageCount' | 'contextTokens' | 'contextWindow' | 'contextPercent' | 'lastActivity' | 'isActive'>;
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
/**
 * Future browser ingress. Keep the established fatal control checks; malformed
 * newly named presentation fields are omitted, never smuggled into extras.
 * This accepts serialized wire timestamps. Server Date projection stays separate.
 */
export declare function decodeSessionRow(value: unknown): SessionRow;
export declare function decodeSessionMutationPatch(value: unknown): SessionMutationPatch;
export declare function decodeSessionActivityPatch(value: unknown): SessionActivityPatch;
export declare function decodeSessionTranscriptPatch(value: unknown): SessionTranscriptPatch;
export declare function decodeSessionMetadata(value: unknown): SessionMetadata;
export declare function decodeSessionList(value: unknown): SessionList;
/** Preserve the existing client projection; full API rows retain provenance. */
type ClientPrivateField = 'sessionKey' | 'nativeSessionId' | 'profileId' | 'profileVersion' | 'sessionFile' | 'parentSession' | 'parentSessionSource' | 'pid';
export declare function sessionForClient(session: CatalogSession): Omit<CatalogSession, ClientPrivateField>;
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
export {};
