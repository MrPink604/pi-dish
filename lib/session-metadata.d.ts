// Generated from src/core/session-metadata.ts; edit that source and run npm run build:core.
import type { CacheRetentionConfig } from './cache-retention';
import type { CacheExpiry, CacheExpiryBasis, SessionEntries, SessionInfo } from './session-metadata-contracts';
interface MetadataProfile {
    readonly profileId?: string;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
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
/** Validate persisted accumulator output, reviving its serialized activity Date. */
export declare function decodeSessionInfo(value: unknown): SessionInfo | null;
export declare function sessionInfoFromEntries(entries: SessionEntries, mtime?: Date, candidate?: MetadataProfile, config?: CacheRetentionConfig): SessionInfo;
/**
 * Extend an info object with entries appended after the range it was built
 * from — the O(delta) path lib/session-index.js uses for a streaming active
 * session, so a sidebar poll never re-parses a whole multi-MB JSONL because
 * one turn was appended. Mutates and returns `info`; `mtime` is the file's
 * new mtime (a full parse floors lastActivity at the mtime, so the extension
 * must too).
 */
export declare function extendSessionInfoFromEntries(info: SessionInfo, entries: SessionEntries, mtime?: Date, candidate?: MetadataProfile, config?: CacheRetentionConfig): SessionInfo;
export {};
