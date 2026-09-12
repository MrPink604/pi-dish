/** Narrow boundaries for the projections still implemented in JavaScript.
 * Usage bucket contents remain opaque: their consumer is the unmigrated usage
 * summary, not the metadata index. Only continuity state is used here. */
import type { SessionEntries } from './session-metadata-contracts';
import { isRecord } from './session-metadata';

export interface UsageState { provider: string | null; model: string }
export interface IndexedUsage {
  state?: UsageState;
  readonly [field: string]: unknown;
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
export interface SkillProjection { records: SkillActivation[]; state: SkillState | null }
export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function usageState(value: unknown): value is UsageState {
  return isRecord(value) && nullableString(value.provider) && typeof value.model === 'string';
}
export function decodeUsage(value: unknown): IndexedUsage | null {
  if (!isRecord(value) || !isRecord(value.total) || !isRecord(value.days) || !isRecord(value.models) ||
      !nullableString(value.cwd) || (value.state !== undefined && !usageState(value.state))) return null;
  // Keep bucket values and cost availability exactly as the JS projection wrote
  // them. Missing continuity is a valid old snapshot, but cannot be extended.
  return value as IndexedUsage;
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
export function checkedSkills(value: unknown): SkillProjection {
  if (!isRecord(value)) throw new TypeError('Invalid skill projection');
  const records = decodeSkillRecords(value.records);
  const state = decodeSkillState(value.state);
  if (!records || !state) throw new TypeError('Invalid skill projection');
  return { records, state };
}
export function checkedSearch(value: unknown): SearchProjection {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.tree !== 'boolean' ||
      !nullableString(value.leafId)) throw new TypeError('Invalid search projection');
  return { text: value.text, tree: value.tree, leafId: value.leafId };
}
export function checkedEntries(value: unknown): SessionEntries {
  if (!Array.isArray(value)) throw new TypeError('Invalid parsed entries');
  const framing: unknown = Reflect.get(value, 'firstEntryOnFirstLine');
  if (framing !== undefined && typeof framing !== 'boolean') throw new TypeError('Invalid parsed framing');
  // Preserve the parser's array and physical-first-line marker without copying
  // entries or asserting a universal harness-event schema.
  return value;
}
export function checkedUsage(value: unknown): IndexedUsage {
  const result = decodeUsage(value);
  if (!result) throw new TypeError('Invalid usage projection');
  return result;
}
