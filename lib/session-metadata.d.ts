// Generated from src/core/session-metadata.ts; edit that source and run npm run build:core.
import type { CacheRetentionConfig } from './cache-retention';
export type CacheExpiryBasis = 'fixed' | 'minimum' | 'estimate' | 'learned';
/** 'unknown': cache activity with no known window; only the serve-time learner fills it in. */
export type StoredCacheExpiryBasis = CacheExpiryBasis | 'unknown';
export interface CacheExpiry {
    readonly refreshedAt: number;
    readonly expiresAt: number;
    readonly retentionMs: number;
    readonly retention: string;
    readonly basis: StoredCacheExpiryBasis;
    /** Retained for incremental parsing. */
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
export declare function resolveCacheTarget(message: Record<string, unknown>): CacheTarget;
/**
 * Pi reports the 1h tier as cacheWrite1h dominating cacheWrite. OMP omits the
 * split, so for Anthropic the priced write/input ratio decides (1h bills 2×
 * input vs 1.25× for 5m). Other providers' write premiums mean nothing here.
 */
export declare function cacheTier1h(usage: Record<string, unknown>, anthropic?: boolean): boolean;
/** Documented windows and conservative estimates: the learner's prior and the fallback before it activates. */
export declare function builtinCacheRetention(target: CacheTarget, long1h: boolean): {
    retentionMs: number;
    retention: string;
    basis: CacheExpiryBasis;
} | null;
/** Providers report cache activity, not expiry timestamps. */
export declare function cacheExpiryForMessage(message: Record<string, unknown>, previous?: CacheExpiry | null, fallbackTimestamp?: unknown, config?: CacheRetentionConfig): CacheExpiry | null;
export declare function entryModel(entry: Record<string, unknown>, profileId: string | undefined): string | null;
/** Validate persisted accumulator output, reviving its serialized activity Date. */
export declare function decodeSessionInfo(value: unknown): SessionInfo | null;
export declare function sessionInfoFromEntries(entries: SessionEntries, mtime?: Date, candidate?: MetadataProfile, config?: CacheRetentionConfig): SessionInfo;
/** O(delta) extension with appended entries; mutates `info`. A full parse floors lastActivity at `mtime`. */
export declare function extendSessionInfoFromEntries(info: SessionInfo, entries: SessionEntries, mtime?: Date, candidate?: MetadataProfile, config?: CacheRetentionConfig): SessionInfo;
export {};
