/** Persisted index projections and their consumed disk-ingress validation. */
import { isRecord } from './session-metadata';

export interface UsageState { provider: string | null; model: string }
export interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}
export interface UsageCosts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}
/** Day/model buckets omit zero-valued counters until their first observation. */
export interface UsageBucket {
  tokens?: Partial<UsageTokens>;
  costs?: Partial<UsageCosts>;
  costUnavailable?: Partial<UsageCosts>;
  calls?: number;
  measured?: number;
  durationMs?: number;
  slowestMs?: number;
}
export interface UsageTotal extends UsageBucket {
  tokens: UsageTokens;
  costs: UsageCosts;
  costUnavailable: UsageCosts;
  calls: number;
  measured: number;
  durationMs: number;
  slowestMs: number;
}
export interface UsageModel extends UsageBucket {
  provider: string;
  model: string;
  days: Record<string, UsageBucket>;
}
export interface IndexedUsage {
  total: UsageTotal;
  days: Record<string, UsageBucket>;
  models: Record<string, UsageModel>;
  cwd: string | null;
  state?: UsageState;
}
export interface SkillState extends UsageState { cwd: string | null }
export interface SkillActivation {
  skill: string;
  file: string;
  kind: 'read' | 'targeted' | 'explicit';
  ranges: 'all' | [number, number][] | null;
  truncatedTo?: number;
  ts: number | null;
  sessionId: string | null;
  entryId: string | null;
  cwd: string | null;
  model: string;
}
export interface SearchProjection { text: string; tree: boolean; leafId: string | null }
/** Only tree identity remains untrusted after the typed parser's search projection. */
export function checkSearchLeaf(value: { leafId: unknown }): asserts value is { leafId: string | null } {
  if (value.leafId !== null && typeof value.leafId !== 'string') throw new TypeError('Invalid search projection');
}
export interface SkillProjection { records: SkillActivation[]; state: SkillState | null }
export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function usageState(value: unknown): value is UsageState {
  return isRecord(value) && nullableString(value.provider) && typeof value.model === 'string';
}
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const;
const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const;
const COUNTER_KEYS = ['calls', 'measured', 'durationMs', 'slowestMs'] as const;
function numericFields(value: unknown, keys: readonly string[], required: boolean): boolean {
  return isRecord(value) && keys.every(key => (!required && value[key] === undefined) || finite(value[key]));
}
function usageBucket(value: unknown): value is UsageBucket {
  return isRecord(value) &&
    COUNTER_KEYS.every(key => value[key] === undefined || finite(value[key])) &&
    (value.tokens === undefined || numericFields(value.tokens, TOKEN_KEYS, false)) &&
    (value.costs === undefined || numericFields(value.costs, COST_KEYS, false)) &&
    (value.costUnavailable === undefined || numericFields(value.costUnavailable, COST_KEYS, false));
}
function usageTotal(value: unknown): value is UsageTotal {
  return isRecord(value) && numericFields(value, COUNTER_KEYS, true) &&
    numericFields(value.tokens, TOKEN_KEYS, true) &&
    numericFields(value.costs, COST_KEYS, true) &&
    numericFields(value.costUnavailable, COST_KEYS, true);
}
function usageDays(value: unknown): value is Record<string, UsageBucket> {
  return isRecord(value) && Object.values(value).every(usageBucket);
}
function usageModel(value: unknown): value is UsageModel {
  return isRecord(value) && usageBucket(value) &&
    typeof value.provider === 'string' && typeof value.model === 'string' && usageDays(value.days);
}
function indexedUsage(value: unknown): value is IndexedUsage {
  return isRecord(value) && usageTotal(value.total) && usageDays(value.days) && isRecord(value.models) &&
    Object.values(value.models).every(usageModel) && nullableString(value.cwd) &&
    (value.state === undefined || usageState(value.state));
}
export function decodeUsage(value: unknown): IndexedUsage | null {
  // Retain absent legacy continuity and sparse day/model counters without
  // filling zeroes or copying the persisted buckets. Only state permits delta reads.
  return indexedUsage(value) ? value : null;
}
export function decodeSkillState(value: unknown): SkillState | null {
  if (!isRecord(value) || !nullableString(value.cwd) || !usageState(value)) return null;
  return { cwd: value.cwd, provider: value.provider, model: value.model };
}
function skillActivation(value: unknown): value is SkillActivation {
  if (!isRecord(value) || typeof value.skill !== 'string' || typeof value.file !== 'string' ||
      !(value.kind === 'read' || value.kind === 'targeted' || value.kind === 'explicit') ||
      !nullableString(value.sessionId) || !nullableString(value.entryId) || !nullableString(value.cwd) ||
      typeof value.model !== 'string' || !(value.ts === null || finite(value.ts)) ||
      !(value.truncatedTo === undefined || finite(value.truncatedTo))) return false;
  return value.ranges === null || value.ranges === 'all' ||
    (Array.isArray(value.ranges) && value.ranges.every(range =>
      Array.isArray(range) && range.length === 2 && finite(range[0]) && finite(range[1])));
}
export function decodeSkillRecords(value: unknown): SkillActivation[] | null {
  return Array.isArray(value) && value.every(skillActivation) ? value : null;
}
