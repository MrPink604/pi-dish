// Generated from src/core/cache-lifetime.ts; edit that source and run npm run build:core.
import type { CacheRetentionConfig } from './cache-retention';
import type { CacheExpiry, CacheExpiryBasis, SessionEntries } from './session-metadata-contracts';
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
export interface CacheLifetimeGate {
    readonly id: 'support' | 'warm' | 'cold' | 'slope' | 'range' | 'bracket';
    readonly pass: boolean;
    readonly value: number | null;
    readonly need: number;
}
/** Where an identity's served retention comes from, in precedence order. */
export type CacheLifetimeSource = 'override' | 'documented' | 'learned' | 'builtin' | 'none';
export interface CacheLifetimeReportEntry {
    readonly api: string;
    readonly provider: string;
    readonly model: string;
    readonly tier: '1h' | null;
    /** What sessions are served for this identity right now. */
    readonly effective: {
        readonly retentionMs: number;
        readonly retention: string;
        readonly basis: CacheExpiryBasis;
    } | null;
    readonly source: CacheLifetimeSource;
    readonly builtin: {
        readonly retentionMs: number;
        readonly retention: string;
        readonly basis: CacheExpiryBasis;
    } | null;
    readonly override: {
        readonly retentionMs: number;
        readonly retention: string;
        readonly basis: CacheExpiryBasis;
    } | null;
    /** The fitted curve P(hit | gap) = σ(alpha + beta·ln gapMs); null below four usable probes. */
    readonly fit: {
        readonly active: boolean;
        readonly ttlMs: number;
        readonly alpha: number;
        readonly beta: number;
        readonly priorTtlMs: number;
        readonly stats: CacheLifetimeStats;
    } | null;
    readonly gates: readonly CacheLifetimeGate[];
    readonly probes: {
        readonly total: number;
        readonly hits: number;
        readonly misses: number;
        readonly maxHitGapMs: number | null;
        readonly minMissGapMs: number | null;
        readonly lastAt: number;
    };
    /** Window probes as [gapMs, hit], for plotting; raw counts, not decayed. */
    readonly points: readonly (readonly [number, 0 | 1])[];
}
/** Persist observations when the indexer dirtied them; tmp+rename, last writer wins. */
export declare function flushCacheLifetime(): void;
/** Full parse: re-anchors the file's chains; per-(file,t) dedup keeps re-parses idempotent. */
export declare function observeCacheLifetimeFromEntries(entries: SessionEntries, file: string, profileId?: string): void;
/** O(delta) extension: continues the file's chains from the indexed prefix. */
export declare function extendCacheLifetimeFromEntries(entries: SessionEntries, file: string, profileId?: string): void;
export declare function forgetCacheLifetimeFile(file: string): void;
export type ServedCacheExpiry = Omit<CacheExpiry, 'basis'> & {
    readonly basis: CacheExpiryBasis;
};
/**
 * Serve-time overlay: substitute an active learned TTL for built-in
 * 'estimate'/'minimum' projections, and supply one where no built-in window
 * exists at all ('unknown' — never served itself). Documented 'fixed'
 * retentions and user cacheTtlOverrides rules always win; the learner only
 * replaces guesses.
 */
export declare function applyLearnedCacheExpiry(expiry: CacheExpiry | null, config?: CacheRetentionConfig): ServedCacheExpiry | null;
/** Per-identity fitted state for diagnostics and the provider-stats surface. */
export declare function cacheLifetimeSnapshot(): CacheLifetimeSnapshotEntry[];
/**
 * Everything the cache-lifetimes view explains per identity: the policy
 * sessions are served (with the same precedence as applyLearnedCacheExpiry),
 * the fitted curve, each activation gate, and the window's probes.
 */
export declare function cacheLifetimeReport(config?: CacheRetentionConfig): CacheLifetimeReportEntry[];
export declare function resetCacheLifetimeForTests(): void;
