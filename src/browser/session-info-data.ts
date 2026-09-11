import type { Costs, Tokens, RuntimeInfo, CostKey } from './shared-helper-types';
import { record, finite } from './helper-values';
import { USAGE_MERGE_COST_KEYS, USAGE_MERGE_TOKEN_KEYS } from './helper-usage';
export interface SessionStats {
  readonly model: string; readonly thinkingLevel: string; readonly cwd: string; readonly sessionFile: string;
  readonly userMessages: number; readonly assistantMessages: number; readonly toolCalls: number; readonly compactions: number;
  readonly genOutput: number; readonly genMs: number; readonly reasoningTokens: number; readonly cost: number | null;
  readonly contextUsage: { readonly tokens: number | null; readonly contextWindow: number | null; readonly percent: number | null };
  readonly responseTiming: { readonly medianMs: number; readonly slowestMs: number };
  readonly costs: Costs; readonly costUnavailable: Readonly<Record<CostKey, number>>; readonly tokens: Tokens; readonly runtime: RuntimeInfo | null;
}
export interface PublishedPage { readonly token: string; readonly path: string; readonly url: string; readonly title: string; readonly root: string; readonly missing: boolean; readonly createdAt: number }
export interface SessionShare { readonly path: string; readonly url: string }
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => finite(value) ? value : 0;
const nullable = (value: unknown) => finite(value) ? value : null;
const object = (value: unknown) => record(value) ? value : {};
export function decodeSessionStats(value: unknown): SessionStats {
  if (!record(value)) throw new Error('Invalid session stats');
  if (typeof value.error === 'string' && value.error) throw new Error(value.error);
  const context = object(value.contextUsage), timing = object(value.responseTiming), costs = object(value.costs), unavailable = object(value.costUnavailable), tokens = object(value.tokens), runtime = object(value.runtime);
  return { model: text(value.model), thinkingLevel: text(value.thinkingLevel), cwd: text(value.cwd), sessionFile: text(value.sessionFile),
    userMessages: number(value.userMessages), assistantMessages: number(value.assistantMessages), toolCalls: number(value.toolCalls), compactions: number(value.compactions),
    genOutput: number(value.genOutput), genMs: number(value.genMs), reasoningTokens: number(value.reasoningTokens), cost: nullable(value.cost),
    contextUsage: { tokens: nullable(context.tokens), contextWindow: nullable(context.contextWindow), percent: nullable(context.percent) }, responseTiming: { medianMs: number(timing.medianMs), slowestMs: number(timing.slowestMs) },
    costs: Object.fromEntries(USAGE_MERGE_COST_KEYS.map(key => [key, nullable(costs[key])])), costUnavailable: Object.fromEntries(USAGE_MERGE_COST_KEYS.map(key => [key, number(unavailable[key])])) as Record<CostKey, number>, tokens: Object.fromEntries(USAGE_MERGE_TOKEN_KEYS.map(key => [key, number(tokens[key])])),
    runtime: typeof runtime.kind === 'string' ? { kind: runtime.kind, pid: nullable(runtime.pid), server: text(runtime.server), tmuxSession: text(runtime.tmuxSession), windowIndex: nullable(runtime.windowIndex), windowName: text(runtime.windowName) } : null };
}
export function decodeSessionShare(value: unknown): SessionShare | null {
  if (!record(value) || value.error) return null;
  const path = text(value.path), url = text(value.url); return path || url ? { path, url } : null;
}
export function decodePublishedPages(value: unknown): PublishedPage[] {
  return Array.isArray(value) ? value.flatMap((page: unknown) => record(page) && typeof page.token === 'string' && typeof page.root === 'string' && (typeof page.path === 'string' || typeof page.url === 'string')
    ? [{ token: page.token, root: page.root, path: text(page.path), url: text(page.url), title: text(page.title), missing: page.missing === true, createdAt: number(page.createdAt) }] : []) : [];
}
