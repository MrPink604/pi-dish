// Generated from src/core/session-metadata.ts; edit that source and run npm run build:core.
import type { CacheRetentionConfig } from './cache-retention';
import { record as isRecord } from './helper-values';
export { isRecord };
export type CacheExpiryBasis = 'fixed' | 'minimum' | 'estimate' | 'learned';
/** 'unknown' anchors cache activity with no documented, estimated or configured window; only the serve-time learner fills it in. */
export type StoredCacheExpiryBasis = CacheExpiryBasis | 'unknown';
export interface CacheExpiry {
    readonly refreshedAt: number;
    readonly expiresAt: number;
    readonly retentionMs: number;
    readonly retention: string;
    readonly basis: StoredCacheExpiryBasis;
    /** Cache identity of the message that set the window; retained for incremental parsing. */
    readonly identity: string;
    readonly tier?: '1h';
}
/** Accumulator output before read-time model-window overlays. No route authority. */
export interface SessionInfo {
    model: string;
    name: string | null;
    messageCount: number;
    contextTokens: number;
    lastActivity: Date;
    cwd: string | null;
    sessionId: string | null;
    parentSession: string | null;
    cacheExpiry: CacheExpiry | null;
}
/** The parser retains physical framing without a second JSON pass. */
export interface SessionEntries extends ReadonlyArray<unknown> {
    readonly firstEntryOnFirstLine?: boolean;
}
interface MetadataProfile {
    readonly profileId?: string;
}
export declare function cacheIdentity(message: Record<string, unknown>): string;
export declare function cacheTokens(usage: Record<string, unknown>, key: 'cacheRead' | 'cacheWrite' | 'cacheWrite1h'): number;
export declare function hasCacheActivity(message: Record<string, unknown>): boolean;
export declare function isHardCacheMiss(usage: unknown): boolean;
export interface CacheTarget {
    readonly api: string;
    readonly provider: string;
    readonly model: string;
}
/** Normalize a message's cache ownership: explicit fields, model slug, then API. */
export declare function resolveCacheTarget(message: Record<string, unknown>): CacheTarget;
/**
 * Anthropic's extended retention tier. Pi reports it as cacheWrite1h
 * dominating cacheWrite. OMP omits that split but still prices the write, and
 * Anthropic bills 1h-tier writes at 2× base input against 1.25× for the 5m
 * tier, so for Anthropic targets the priced write/input rate ratio decides
 * when the split is absent. Other providers' write premiums mean nothing here.
 */
export declare function cacheTier1h(usage: Record<string, unknown>, anthropic?: boolean): boolean;
/**
 * Documented fixed/minimum windows and conservative provider estimates. This
 * ladder is the learner's Bayesian prior and the fallback when no learned
 * model has activated.
 */
export declare function builtinCacheRetention(target: CacheTarget, long1h: boolean): {
    retentionMs: number;
    retention: string;
    basis: CacheExpiryBasis;
} | null;
/**
 * Providers report cache token activity, not expiry timestamps. Derive only
 * documented fixed/minimum windows and conservative provider estimates.
 */
export declare function cacheExpiryForMessage(message: Record<string, unknown>, previous?: CacheExpiry | null, fallbackTimestamp?: unknown, config?: CacheRetentionConfig): CacheExpiry | null;
/** The model id a model_change entry records, in the profile's field. */
export declare function entryModel(entry: Record<string, unknown>, profileId: string | undefined): string | null;
/** Validate persisted accumulator output, reviving its serialized activity Date. */
export declare function decodeSessionInfo(value: unknown): SessionInfo | null;
export declare function sessionInfoFromEntries(entries: SessionEntries, mtime?: Date, candidate?: MetadataProfile, config?: CacheRetentionConfig): SessionInfo;
/**
 * Extend an info object with entries appended after the range it was built
 * from (session-index's O(delta) path). Mutates and returns `info`; `mtime` is
 * the file's new mtime, which a full parse floors lastActivity at.
 */
export declare function extendSessionInfoFromEntries(info: SessionInfo, entries: SessionEntries, mtime?: Date, candidate?: MetadataProfile, config?: CacheRetentionConfig): SessionInfo;
