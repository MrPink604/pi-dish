// Generated from src/core/session-index-data.ts; edit that source and run npm run build:core.
export interface UsageState {
    provider: string | null;
    model: string;
}
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
/** Only tree identity remains untrusted after the typed parser's search projection. */
export declare function checkSearchLeaf(value: {
    leafId: unknown;
}): asserts value is {
    leafId: string | null;
};
export interface SkillProjection {
    records: SkillActivation[];
    state: SkillState | null;
}
export declare function finite(value: unknown): value is number;
export declare function decodeUsage(value: unknown): IndexedUsage | null;
export declare function decodeSkillState(value: unknown): SkillState | null;
export declare function decodeSkillRecords(value: unknown): SkillActivation[] | null;
