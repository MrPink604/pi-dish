import { finite } from './helper-values';

export const USAGE_COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const;
export const USAGE_TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const;
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
export function addKnownUsageCost<T extends number | null | undefined>(to: T, from: number | null | undefined): T | number {
  return finite(from) ? (finite(to) ? to : 0) + from : to;
}

export function addUsageTokens(to: Record<TokenKey, number>, from?: Tokens | null): void {
  for (const key of USAGE_TOKEN_KEYS) to[key] += from?.[key] || 0;
}

export function addUsageCosts(to: Record<CostKey, number>, from?: Costs | null): void {
  for (const key of USAGE_COST_KEYS) to[key] = addKnownUsageCost(to[key], from?.[key]);
}

export function addUsageUnavailable(to: Record<CostKey, number>, from?: Unavailable | null): void {
  for (const key of USAGE_COST_KEYS) to[key] += from?.[key] || 0;
}

/** Sparse model/headline counts start from zero rather than requiring a full record. */
export function addUsageCount(to: number | undefined, from: number | undefined): number {
  return (to || 0) + (from || 0);
}

/** Full response buckets only; weekly/model projections use the smaller primitives. */
export function addUsage<T extends UsageTotal>(to: T, from?: UsageSource | null): T {
  if (!from) return to;
  addUsageTokens(to.tokens, from.tokens);
  addUsageCosts(to.costs, from.costs);
  addUsageUnavailable(to.costUnavailable, from.costUnavailable);
  to.calls += from.calls || 0;
  to.measured += from.measured || 0;
  to.durationMs += from.durationMs || 0;
  to.slowestMs = Math.max(to.slowestMs, from.slowestMs || 0);
  return to;
}

/** Displayed totals deliberately exclude reasoning tokens. */
export function usageDisplayTokens(tokens?: Tokens | null): number {
  return (tokens?.input || 0) + (tokens?.output || 0) + (tokens?.cacheRead || 0) + (tokens?.cacheWrite || 0);
}

function compareKnownCosts(a: number | null | undefined, b: number | null | undefined): number {
  const aKnown = finite(a), bKnown = finite(b);
  if (aKnown !== bKnown) return Number(bKnown) - Number(aKnown);
  return aKnown && bKnown ? b - a : 0;
}

export function compareUsageBuckets(a: Readonly<Pick<UsageTotal, 'calls'>> & UsageSource, b: Readonly<Pick<UsageTotal, 'calls'>> & UsageSource, sort: string): number {
  return (sort === 'tokens'
    ? usageDisplayTokens(b.tokens) - usageDisplayTokens(a.tokens)
    : compareKnownCosts(a.costs?.total, b.costs?.total)) || b.calls - a.calls;
}

export function compareUsageModels(a: { readonly cost?: number | null; readonly calls: number }, b: { readonly cost?: number | null; readonly calls: number }): number {
  return compareKnownCosts(a.cost, b.cost) || b.calls - a.calls;
}
