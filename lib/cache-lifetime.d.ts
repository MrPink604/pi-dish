// Generated from src/core/cache-lifetime.ts; edit that source and run npm run build:core.
import type { CacheRetentionConfig } from './cache-retention';
import type { CacheExpiry, SessionEntries } from './session-metadata-contracts';
export interface CacheLifetimeStats {
    /** Decayed effective observation count behind the fit. */
    readonly observations: number;
    /** Decayed empirical P(hit | gap ≤ learned TTL): the cache's warm-window reliability. */
    readonly warmHitRate: number | null;
    /** EWMA Brier score of active-policy predictions at observation time; NaN before any. */
    readonly brier: number;
    /** Warmth-curve slope on log-gap; steeper magnitude = sharper expiry cliff. */
    readonly slope: number;
}
export interface LearnedCacheRetention {
    readonly retentionMs: number;
    readonly retention: string;
    readonly basis: 'learned';
    readonly stats: CacheLifetimeStats;
}
export interface CacheLifetimeSnapshotEntry {
    readonly key: string;
    readonly identity: string;
    readonly tier: '1h' | null;
    readonly active: boolean;
    readonly ttlMs: number | null;
    readonly retention: string | null;
    readonly stats: CacheLifetimeStats | null;
    readonly rawObservations: number;
}
/** Persist observations when the indexer dirtied them; tmp+rename, last writer wins. */
export declare function flushCacheLifetime(): void;
/** Full parse: re-anchors the file's chains; per-(file,t) dedup keeps re-parses idempotent. */
export declare function observeCacheLifetimeFromEntries(entries: SessionEntries, file: string, profileId?: string): void;
/** O(delta) extension: continues the file's chains from the indexed prefix. */
export declare function extendCacheLifetimeFromEntries(entries: SessionEntries, file: string, profileId?: string): void;
export declare function forgetCacheLifetimeFile(file: string): void;
/**
 * Serve-time overlay: substitute an active learned TTL for built-in
 * 'estimate'/'minimum' projections. Documented 'fixed' retentions and user
 * cacheTtlOverrides rules always win; the learner only replaces guesses.
 */
export declare function applyLearnedCacheExpiry(expiry: CacheExpiry | null, config?: CacheRetentionConfig): CacheExpiry | null;
/** Per-identity fitted state for diagnostics and the provider-stats surface. */
export declare function cacheLifetimeSnapshot(): CacheLifetimeSnapshotEntry[];
export declare function resetCacheLifetimeForTests(): void;
