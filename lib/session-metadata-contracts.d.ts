// Generated from src/core/session-metadata-contracts.ts; edit that source and run npm run build:core.
export type CacheExpiryBasis = 'fixed' | 'minimum' | 'estimate' | 'learned';
export interface CacheExpiry {
    readonly refreshedAt: number;
    readonly expiresAt: number;
    readonly retentionMs: number;
    readonly retention: string;
    readonly basis: CacheExpiryBasis;
    /** Retained for incremental parsing; browser decoders deliberately omit it. */
    readonly identity: string;
    /** Anthropic's extended cache tier; selects the matching learned model. */
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
/** The existing parser retains physical framing without a second JSON pass. */
export interface SessionEntries extends ReadonlyArray<unknown> {
    readonly firstEntryOnFirstLine?: boolean;
}
