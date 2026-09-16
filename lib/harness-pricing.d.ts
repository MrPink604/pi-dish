// Generated from src/core/harness-pricing.ts; edit that source and run npm run build:core.
export declare const CATALOG_MAX_AGE_MS: number;
declare const COST_KEYS: readonly ['input', 'output', 'cacheRead', 'cacheWrite'];
type CostKey = typeof COST_KEYS[number];
export interface UsageCost {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
}
interface CatalogModel {
    provider: unknown;
    id: unknown;
    cost: Partial<Record<CostKey, number>>;
}
export interface PricingSnapshot {
    updatedAt: number;
    models: CatalogModel[];
    revision: string;
}
export interface PricingRefreshOptions {
    force?: boolean;
    now?: number;
}
type HarnessInput = string | null | undefined;
export declare function refreshHarnessPricing(harnessId?: string, { force, now }?: PricingRefreshOptions): Promise<PricingSnapshot | null>;
export declare function pricingRevision(harnessId?: HarnessInput): string;
export declare function estimateUsageCost(harnessId: HarnessInput, provider: unknown, model: unknown, usage: unknown): UsageCost | undefined;
export declare function isPlanProvider(harnessId: HarnessInput, provider: unknown): boolean;
export declare function resetForTests(): void;
export {};
