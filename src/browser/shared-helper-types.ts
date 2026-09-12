import type { SessionFields } from '../core/session-api';
/** Structural inputs for pure helpers. Feature controllers decode wire data before use. */
export type Timestamp = string | number | Date;
/** Lightweight helper input, shared with server projections that still carry Dates. */
export interface HelperSession extends Pick<SessionFields<Timestamp>,
  'name' | 'cwd' | 'model' | 'lastActivity' | 'isActive' | 'turnInProgress' |
  'parentId' | 'familyParentId' | 'routine' | 'routineId' | 'capabilities'> {
  id: string;
  host?: string | null;
  hostLabel?: string | null;
  activity?: number;
}
export interface HelperHost {
  hostId?: string | null;
  name?: string | null;
  label?: string | null;
  base?: string;
  self?: boolean;
  capabilities?: Readonly<Record<string, boolean | undefined>>;
}
export interface ModelRef { readonly id?: string; readonly modelId?: string; readonly provider?: string; readonly thinking?: readonly string[] | null }
export interface WorkspaceNode<T> { label: string; path: string; sessions: readonly T[] | null; children: WorkspaceNode<T>[]; count: number; order: number }
export interface WorkspaceBranch<T> { label: string; path: string; sessions: readonly T[] | null; children: Map<string, WorkspaceBranch<T>>; order: number }
export interface SessionFamily<T> { session: T; children: SessionFamily<T>[]; activity: number; size: number; order: number }
export interface Relation { readonly kind?: string | null }
export interface SessionQueryTerm { readonly neg: boolean; readonly field: string | null; readonly value: string }
export interface SessionQuery { terms: SessionQueryTerm[]; since: number | null; before: number | null }
export interface RefContextEntry { readonly ref: string; readonly name?: string; readonly host?: string; readonly cwd?: string; readonly isActive?: boolean }
export interface RuntimeInfo { readonly kind?: string; readonly pid?: number | null; readonly server?: string | null; readonly tmuxSession?: string | null; readonly windowIndex?: number | null; readonly windowName?: string | null }
export interface ResponseMetadata {
  readonly usage?: { readonly output?: number; readonly cost?: { readonly total?: number | null } };
  readonly outputTokens?: number;
  readonly durationMs?: number;
  readonly pricingKnown?: boolean;
}
export interface ImageBlock { readonly url?: string; readonly data?: string; readonly mimeType: string }
export interface KatexRenderer { renderToString(source: string, options: { displayMode: boolean; throwOnError: false }): string }
export interface MathToken { type: string; raw: string; text: string; display?: boolean }
export interface MathExtension { name: string; level: 'block' | 'inline'; start(source: string): number | undefined; tokenizer(source: string): MathToken | undefined; renderer(token: MathToken): string }
export type CostKey = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'total';
export type TokenKey = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning';
export type Costs = Partial<Record<CostKey, number | null>>;
export type Tokens = Partial<Record<TokenKey, number>>;
export interface UsageBucket {
  tokens?: Tokens;
  costs?: Costs;
  costUnavailable?: Partial<Record<CostKey, number>>;
  calls?: number;
  measured?: number;
  durationMs?: number;
  slowestMs?: number;
  priced?: boolean;
  unpricedCalls?: number;
}
export interface MergedUsage extends UsageBucket {
  tokens: Record<TokenKey, number>;
  costs: Record<CostKey, number>;
  costUnavailable: Record<CostKey, number>;
  calls: number;
  measured: number;
  durationMs: number;
  slowestMs: number;
}
export interface UsageModel { ref: string; provider?: string; model?: string; calls?: number; cost?: number | null; costUnavailable?: Partial<Record<CostKey, number>>; tokens?: Tokens }
export interface MergedUsageModel extends UsageModel { calls: number; cost: number; costUnavailable: Partial<Record<CostKey, number>>; tokens: Record<TokenKey, number> }
export interface UsageDay extends UsageBucket { day: string; days?: number; models?: readonly UsageModel[] }
export interface UsageGroup extends UsageBucket { name?: string; workspace?: string; key?: string; id?: string; provider?: string; model?: string; host?: string | null; hostLabel?: string | null }
export interface UsageSummary {
  range?: string;
  sort?: string;
  models?: readonly string[] | null;
  totals?: UsageBucket;
  groups?: { models?: readonly UsageGroup[]; workspaces?: readonly UsageGroup[]; sessions?: readonly UsageGroup[] };
  daily?: readonly UsageDay[];
  headlineCosts?: Readonly<Record<string, number | null>>;
  headlineCostsByBucket?: Readonly<Record<string, Costs | null>>;
  headlineCostUnavailable?: Readonly<Record<string, number>>;
  unpricedModelCalls?: number;
  indexing?: boolean;
  discoveryTruncated?: boolean;
  discoverySkipped?: number;
  monthlyBudgetUsd?: number | null;
}
export interface HostUsageSummary { readonly hostId?: string | null; readonly hostLabel?: string | null; readonly summary: UsageSummary }
export interface UsageLimit { readonly label: string; readonly windowLabel?: string; readonly usedFraction: number; readonly resetsAt?: number | null }
export interface UsageLimitReport { readonly provider: string; readonly planType?: string | null; readonly fetchedAt?: number; readonly limits?: readonly UsageLimit[] }
export interface UsageLimitEntry { readonly hostLabel: string; readonly payload?: { readonly harnesses?: readonly { readonly harness?: string; readonly label?: string; readonly error?: string; readonly reports?: readonly UsageLimitReport[] }[] } }
export interface HostUsageLimit extends UsageLimit { planType: string | null; fetchedAt: number; hostLabel: string }
