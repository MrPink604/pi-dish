import type { HostEndpoint } from './api-client';
import type { HelperHost, HelperSession } from './shared-helper-types';
import { hostDisplayLabel } from './helper-identity';
import { parseSessionQuery, scoreSessionMatch, evaluateSessionQuery } from './helper-query';
import { record, finite } from './helper-values';
export type SearchHost = HostEndpoint & HelperHost & { readonly hostId: string | null };
export interface SearchResult extends HelperSession {
  id: string; name: string; cwd: string; model: string; lastActivity: string | number | null;
  isActive: boolean; turnInProgress: boolean; compacting: boolean; searchScore?: number;
  matchCount: number; snippets: readonly string[];
}
export interface SearchPayload {
  readonly results: readonly SearchResult[]; readonly total: number; readonly hiddenByScopes: number;
  readonly hiddenByAutomation: number; readonly indexing: boolean;
}
export interface SearchViewData {
  results: readonly SearchResult[]; total: number; hiddenByScopes: number; hiddenByAutomation: number; indexing: boolean;
  hostErrors?: readonly string[]; hostPending?: readonly string[];
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => finite(value) ? value : 0;
export function decodeSearchPayload(value: unknown): SearchPayload {
  if (!record(value) || !Array.isArray(value.results)) throw new Error('Invalid search response');
  const results = value.results.flatMap((row: unknown): SearchResult[] => record(row) && typeof row.id === 'string' && row.id ? [{
    id: row.id, name: text(row.name), cwd: text(row.cwd), model: text(row.model),
    lastActivity: typeof row.lastActivity === 'string' || finite(row.lastActivity) ? row.lastActivity : null,
    isActive: row.isActive === true, turnInProgress: row.turnInProgress === true, compacting: row.compacting === true,
    searchScore: finite(row.searchScore) ? row.searchScore : undefined, matchCount: number(row.matchCount),
    snippets: Array.isArray(row.snippets) ? row.snippets.filter((value): value is string => typeof value === 'string') : [],
  }] : []);
  return { results, total: number(value.total) || results.length, hiddenByScopes: number(value.hiddenByScopes), hiddenByAutomation: number(value.hiddenByAutomation), indexing: value.indexing === true };
}
export function queryHosts<T extends HelperHost>(hosts: readonly T[], query: string): readonly T[] {
  if (!query) return hosts;
  const terms = parseSessionQuery(query).terms.filter(term => term.field === 'host' && !term.neg);
  if (!terms.length) return hosts;
  const parsed = { terms, since: null, before: null };
  return hosts.filter(host => evaluateSessionQuery(parsed, { id: '', hostLabel: hostDisplayLabel(host), host: host.hostId || null }));
}
export function mergeSearchPayloads(entries: readonly { host: SearchHost; payload: SearchPayload }[], query: string): SearchViewData {
  const parsed = parseSessionQuery(query), results: SearchResult[] = [];
  let total = 0, hiddenByScopes = 0, hiddenByAutomation = 0, indexing = false;
  for (const { host, payload } of entries) {
    for (const session of payload.results) results.push({ ...session, host: host.hostId, hostLabel: hostDisplayLabel(host) });
    total += payload.total; hiddenByScopes += payload.hiddenByScopes; hiddenByAutomation += payload.hiddenByAutomation;
    if (payload.indexing) indexing = true;
  }
  if (!(entries.length === 1 && !entries[0].host.hostId)) results.sort((a, b) =>
    (b.searchScore ?? scoreSessionMatch(parsed, b)) - (a.searchScore ?? scoreSessionMatch(parsed, a))
    || new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime());
  return { results, total, hiddenByScopes, hiddenByAutomation, indexing };
}
