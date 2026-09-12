// Generated from src/core/session-index-data.ts; edit that source and run npm run build:core.
/** Narrow boundaries for the projections still implemented in JavaScript.
 * Usage bucket contents remain opaque: their consumer is the unmigrated usage
 * summary, not the metadata index. Only continuity state is used here. */
import type { SessionEntries } from './session-metadata-contracts';
export interface UsageState {
    provider: string | null;
    model: string;
}
export interface IndexedUsage {
    state?: UsageState;
    readonly [field: string]: unknown;
}
export interface SkillState extends UsageState {
    cwd: string | null;
}
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
export interface SearchProjection {
    text: string;
    tree: boolean;
    leafId: string | null;
}
export interface SkillProjection {
    records: SkillActivation[];
    state: SkillState | null;
}
export declare function finite(value: unknown): value is number;
export declare function decodeUsage(value: unknown): IndexedUsage | null;
export declare function decodeSkillState(value: unknown): SkillState | null;
export declare function decodeSkillRecords(value: unknown): SkillActivation[] | null;
export declare function checkedSkills(value: unknown): SkillProjection;
export declare function checkedSearch(value: unknown): SearchProjection;
export declare function checkedEntries(value: unknown): SessionEntries;
export declare function checkedUsage(value: unknown): IndexedUsage;
