// Generated from src/core/helper-usage-math.ts; edit that source and run npm run build:core.
export declare const USAGE_COST_KEYS: readonly ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
export declare const USAGE_TOKEN_KEYS: readonly ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
type CostKey = typeof USAGE_COST_KEYS[number];
type TokenKey = typeof USAGE_TOKEN_KEYS[number];
type Tokens = Readonly<Partial<Record<TokenKey, number>>>;
type Costs = Readonly<Partial<Record<CostKey, number | null>>>;
type Unavailable = Readonly<Partial<Record<CostKey, number>>>;
interface UsageSource {
    readonly tokens?: Tokens | null;
    readonly costs?: Costs | null;
    readonly costUnavailable?: Unavailable | null;
    readonly calls?: number;
    readonly measured?: number;
    readonly durationMs?: number;
    readonly slowestMs?: number;
}
interface UsageTotal {
    tokens: Record<TokenKey, number>;
    costs: Record<CostKey, number>;
    costUnavailable: Record<CostKey, number>;
    calls: number;
    measured: number;
    durationMs: number;
    slowestMs: number;
}
/** Unknown amounts leave the known subtotal (including an absent subtotal) alone. */
export declare function addKnownUsageCost<T extends number | null | undefined>(to: T, from: number | null | undefined): T | number;
export declare function addUsageTokens(to: Record<TokenKey, number>, from?: Tokens | null): void;
export declare function addUsageCosts(to: Record<CostKey, number>, from?: Costs | null): void;
export declare function addUsageUnavailable(to: Record<CostKey, number>, from?: Unavailable | null): void;
/** Sparse model/headline counts start from zero rather than requiring a full record. */
export declare function addUsageCount(to: number | undefined, from: number | undefined): number;
/** Full response buckets only; weekly/model projections use the smaller primitives. */
export declare function addUsage<T extends UsageTotal>(to: T, from?: UsageSource | null): T;
/** Displayed totals deliberately exclude reasoning tokens. */
export declare function usageDisplayTokens(tokens?: Tokens | null): number;
export declare function compareUsageBuckets(a: Readonly<Pick<UsageTotal, 'calls'>> & UsageSource, b: Readonly<Pick<UsageTotal, 'calls'>> & UsageSource, sort: string): number;
export declare function compareUsageModels(a: {
    readonly cost?: number | null;
    readonly calls: number;
}, b: {
    readonly cost?: number | null;
    readonly calls: number;
}): number;
export {};
