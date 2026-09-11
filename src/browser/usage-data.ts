import type { Costs, Tokens, UsageBucket, UsageDay, UsageGroup, UsageSummary, UsageLimitEntry } from './shared-helper-types';
import { record, finite } from './helper-values';
import { USAGE_MERGE_COST_KEYS, USAGE_MERGE_TOKEN_KEYS } from './helper-usage';
const object = (value: unknown): Record<string, unknown> => record(value) ? value : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => finite(value) ? value : 0;
function costs(value: unknown): Costs { const row = object(value); return Object.fromEntries(USAGE_MERGE_COST_KEYS.map(key => [key, finite(row[key]) ? row[key] : null])); }
function counts(value: unknown) { const row = object(value); return Object.fromEntries(USAGE_MERGE_COST_KEYS.map(key => [key, number(row[key])])); }
function tokens(value: unknown): Tokens { const row = object(value); return Object.fromEntries(USAGE_MERGE_TOKEN_KEYS.map(key => [key, number(row[key])])); }
function bucket(value: unknown): UsageBucket {
  const row = object(value);
  return { tokens: tokens(row.tokens), costs: costs(row.costs), costUnavailable: counts(row.costUnavailable), calls: number(row.calls),
    measured: number(row.measured), durationMs: number(row.durationMs), slowestMs: number(row.slowestMs), priced: row.priced === true, unpricedCalls: number(row.unpricedCalls) };
}
export function decodeUsageSummary(value: unknown, host: { hostId: string | null; label: string }): UsageSummary {
  if (!record(value)) throw new Error('Invalid usage summary');
  const groups = object(value.groups);
  const decodeGroups = (value: unknown, kind: 'models' | 'workspaces' | 'sessions'): UsageGroup[] => Array.isArray(value) ? value.flatMap((row: unknown) => {
    if (!record(row) || (kind === 'sessions' ? typeof row.id !== 'string' : typeof row.key !== 'string')) return [];
    return [{ ...bucket(row), key: text(row.key), id: text(row.id), name: text(row.name), workspace: text(row.workspace),
      provider: text(row.provider), model: text(row.model), ...(kind === 'models' ? {} : { host: host.hostId, hostLabel: host.label }) }];
  }) : [];
  const daily: UsageDay[] = Array.isArray(value.daily) ? value.daily.flatMap((row: unknown) => {
    if (!record(row) || typeof row.day !== 'string') return [];
    return [{ ...bucket(row), day: row.day, days: number(row.days) || 1, models: Array.isArray(row.models) ? row.models.flatMap((model: unknown) => {
      if (!record(model) || typeof model.ref !== 'string') return [];
      return [{ ref: model.ref, provider: text(model.provider), model: text(model.model), calls: number(model.calls), cost: finite(model.cost) ? model.cost : null,
        tokens: tokens(model.tokens), costUnavailable: counts(model.costUnavailable) }];
    }) : [] }];
  }) : [];
  return { range: text(value.range), sort: text(value.sort), models: Array.isArray(value.models) ? value.models.filter((value): value is string => typeof value === 'string') : null,
    totals: bucket(value.totals), groups: { models: decodeGroups(groups.models, 'models'), workspaces: decodeGroups(groups.workspaces, 'workspaces'), sessions: decodeGroups(groups.sessions, 'sessions') }, daily,
    headlineCosts: Object.fromEntries(Object.entries(object(value.headlineCosts)).map(([key, value]) => [key, finite(value) ? value : null])),
    headlineCostsByBucket: Object.fromEntries(Object.entries(object(value.headlineCostsByBucket)).map(([key, value]) => [key, costs(value)])),
    headlineCostUnavailable: Object.fromEntries(Object.entries(object(value.headlineCostUnavailable)).map(([key, value]) => [key, number(value)])),
    unpricedModelCalls: number(value.unpricedModelCalls), indexing: value.indexing === true, discoveryTruncated: value.discoveryTruncated === true, discoverySkipped: number(value.discoverySkipped),
    monthlyBudgetUsd: finite(value.monthlyBudgetUsd) ? value.monthlyBudgetUsd : null };
}
export function decodeUsageLimits(value: unknown): NonNullable<UsageLimitEntry['payload']> {
  if (!record(value) || !Array.isArray(value.harnesses)) return { harnesses: [] };
  return { harnesses: value.harnesses.flatMap((harness: unknown) => {
    if (!record(harness)) return [];
    return [{ harness: text(harness.harness), label: text(harness.label), error: text(harness.error), reports: Array.isArray(harness.reports) ? harness.reports.flatMap((report: unknown) => {
      if (!record(report) || typeof report.provider !== 'string') return [];
      return [{ provider: report.provider, planType: text(report.planType), fetchedAt: number(report.fetchedAt), limits: Array.isArray(report.limits) ? report.limits.flatMap((limit: unknown) => {
        if (!record(limit) || typeof limit.label !== 'string' || !finite(limit.usedFraction)) return [];
        return [{ label: limit.label, windowLabel: text(limit.windowLabel), usedFraction: limit.usedFraction, resetsAt: finite(limit.resetsAt) ? limit.resetsAt : null }];
      }) : [] }];
    }) : [] }];
  }) };
}
