// Generated from src/core/cache-retention.ts; edit that source and run npm run build:core.
import type { CacheExpiryBasis } from './session-metadata-contracts';
export interface CacheRetentionPolicy {
    readonly retentionMs: number;
    readonly retention: string;
    readonly basis: CacheExpiryBasis;
}
interface CacheTtlRule extends CacheRetentionPolicy {
    readonly provider: string;
    readonly model: string;
}
export interface CacheRetentionConfig {
    readonly revision: string;
    readonly rules: readonly CacheTtlRule[];
}
/**
 * Read the private host-level cache policy. The settings file is revalidated
 * by (mtime,size), matching the other hand-edited pi-dish configuration.
 */
export declare function loadCacheRetentionConfig(): CacheRetentionConfig;
export declare function cacheRetentionRevision(): string;
/** First matching user rule wins; a rule may constrain provider, model, or both. */
export declare function configuredCacheRetention(config: CacheRetentionConfig, provider: string, model: string): CacheRetentionPolicy | null;
export {};
