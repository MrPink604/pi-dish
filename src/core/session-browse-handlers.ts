import path = require('path');
import type { RouteHandler } from './http-boundary';
import { errorMessage } from './http-boundary';
import { createHostHealth } from './host-health';
import {
  buildSnippets, evaluateSessionQuery, isAutomationSession, parseSessionQuery,
  positiveQueryTokens, queryAsksForAutomation, scoreSessionMatch,
} from './helper-query.js';
import { stableSessionRef, resolveSessionRefAmong } from './helper-refs.js';
import { sourceForIdentity, type DiscoveryCandidate } from './session-source';
import { getSearchText } from './session-index';
import { sessionForClient } from './session-api';
import type { HibernationState } from './session-api';
import { canonicalSessionPath, historicalAdvice, lightweightSessionInfo, type CatalogRuntime } from './session-catalog-runtime';
import { buildSourceSession, type CatalogSession, type SessionCatalog } from './session-catalog';
import type { IncomingMessage } from 'http';

export interface SessionBrowsePorts {
  catalog: CatalogRuntime;
  hibernated(): ReadonlyMap<string, HibernationState>;
  /** The request carries a private-session unlock token. */
  privateUnlocked(req: IncomingMessage): boolean;
}

const SEARCH_RESULT_CAP = 100;
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/** Opt-in `/api/sessions` bounds for agent callers; the browser sends neither, so its payload is unchanged. */
export interface CatalogBounds { limit: number | null; fields: readonly string[] | null }

export function parseCatalogBounds(limit: unknown, fields: unknown): CatalogBounds | { error: string } {
  let rowLimit: number | null = null;
  if (limit !== undefined) {
    if (typeof limit !== 'string' || !/^[1-9]\d{0,5}$/.test(limit)) return { error: 'limit must be a positive integer' };
    rowLimit = Number(limit);
  }
  let names: string[] | null = null;
  if (fields !== undefined) {
    names = typeof fields === 'string' ? fields.split(',').map(name => name.trim()).filter(Boolean) : [];
    if (!names.length || names.length > 64 || !names.every(name => FIELD_NAME_RE.test(name))) {
      return { error: 'fields must be a comma-separated list of field names' };
    }
  }
  return { limit: rowLimit, fields: names };
}

/**
 * Apply `limit` across active, children, then previous — the order a caller
 * reads them — and keep only `fields` (plus `id`) of each row. A limited
 * response reports the unlimited row count as `total`.
 */
export function boundCatalog<T extends object>(groups: { active: readonly T[]; previous: readonly T[]; children: readonly T[] }, bounds: CatalogBounds) {
  const project = (row: T): object => {
    if (!bounds.fields) return row;
    const source = row as Record<string, unknown>;
    const picked: Record<string, unknown> = { id: source.id };
    for (const name of bounds.fields) if (Object.hasOwn(source, name)) picked[name] = source[name];
    return picked;
  };
  if (bounds.limit === null) {
    if (!bounds.fields) return groups;
    return { active: groups.active.map(project), previous: groups.previous.map(project), children: groups.children.map(project) };
  }
  let left = bounds.limit;
  const take = (rows: readonly T[]) => {
    const kept = rows.slice(0, left);
    left -= kept.length;
    return kept.map(project);
  };
  const active = take(groups.active), children = take(groups.children), previous = take(groups.previous);
  return { active, previous, children, total: groups.active.length + groups.children.length + groups.previous.length };
}

export function createSessionBrowseHandlers(ports: SessionBrowsePorts) {
  const { catalog: runtime } = ports;
  const hostHealth = createHostHealth();

  const list: RouteHandler = async (req, res) => {
    const bounds = parseCatalogBounds(req.query.limit, req.query.fields);
    if ('error' in bounds) return void res.status(400).json({ error: bounds.error });
    const query = ((req.query.q || '') as string).trim().toLowerCase();
    await runtime.refreshPrimeRoster();
    const catalog = runtime.buildSessionCatalog({ activeOnly: req.query.active === '1', includePrivate: ports.privateUnlocked(req) });
    const hibernated = ports.hibernated();
    const previous = hibernated.size
      ? catalog.previous.map(session => {
        const state = hibernated.get(session.id);
        return state ? { ...session, hibernation: state } : session;
      })
      : catalog.previous;
    const projection = (rows: readonly CatalogSession[]) => {
      const filtered = query ? runtime.filterSessionsByQuery(rows, query) : rows;
      return req.query.view === 'client' ? filtered.map(session => sessionForClient(session)) : filtered;
    };
    const groups = { active: projection(catalog.active), previous: projection(previous), children: projection(catalog.children) };
    res.json({
      ...boundCatalog(groups, bounds),
      indexing: catalog.indexing,
      discoveryTruncated: catalog.discoveryTruncated,
      discoverySkipped: catalog.discoverySkipped,
    });
  };

  const health: RouteHandler = async (_req, res) => {
    try {
      const healthSnapshot = await hostHealth.read();
      const { active, children } = runtime.buildSessionCatalog({ activeOnly: true });
      const byHarness: Record<string, number> = {};
      for (const session of active) byHarness[session.harnessId] = (byHarness[session.harnessId] || 0) + 1;
      res.json({
        ...healthSnapshot,
        sessions: {
          live: active.length,
          working: active.filter(session => session.turnInProgress).length,
          waiting: active.filter(session => session.askPending).length,
          subagents: children.length,
          byHarness,
        },
      });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };

  interface ResolveEntry {
    readonly id: CatalogSession['id'];
    readonly session?: CatalogSession;
    readonly candidate?: DiscoveryCandidate;
  }

  /**
   * Resolve against ONE catalog + discovery snapshot (zero per-ref root walks,
   * zero synchronous getSessionInfo for budget-deferred sessions).
   */
  function createCatalogResolver(catalog: SessionCatalog) {
    const pool: ResolveEntry[] = [
      ...catalog.list.map(session => ({ id: session.id, session })),
      ...catalog.deferred.map(candidate => ({ id: candidate.routeId, candidate })),
    ];
    let deferredByPath: Map<string, DiscoveryCandidate> | null = null;
    const materialized = new Map<string, CatalogSession>();
    // Shorten against ALL discovered IDs (indexed + deferred) whenever discovery
    // is complete; fall back to full routes only when discovery was truncated.
    const peerIds = pool.map(entry => entry.id);
    const canShorten = !catalog.discoveryTruncated;

    const materialize = (entry: ResolveEntry): CatalogSession => {
      if (entry.session) return entry.session;
      const existing = materialized.get(entry.id);
      if (existing) return existing;
      const candidate = entry.candidate!;
      const row = buildSourceSession(candidate, lightweightSessionInfo(candidate), historicalAdvice(candidate), runtime.options);
      if (row.parentSession && row.sessionFile) {
        const parentFile = path.isAbsolute(row.parentSession)
          ? row.parentSession : path.resolve(path.dirname(row.sessionFile), row.parentSession);
        const canonical = canonicalSessionPath(parentFile) || '';
        const parent = catalog.byPath.get(canonical);
        let parentId: CatalogSession['id'] | null = parent ? parent.id : null;
        if (!parentId && canonical && catalog.deferred.length) {
          if (!deferredByPath) {
            deferredByPath = new Map();
            for (const item of catalog.deferred) {
              const p = canonicalSessionPath(item.file);
              if (p) deferredByPath.set(p, item);
            }
          }
          parentId = deferredByPath.get(canonical)?.routeId || null;
        }
        if (parentId && parentId !== row.id) {
          row.parentId = parentId;
          row.parentSource = row.parentSessionSource || 'pi-session-header';
          row.familyParentId = parentId;
        }
      }
      materialized.set(entry.id, row);
      return row;
    };

    const resolveOne = (ref: string) => {
      const { session, matches } = resolveSessionRefAmong(pool, ref);
      return {
        session: session ? materialize(session) : null,
        matches,
        materialize,
      };
    };

    const refFor = (sessionId: string) => (canShorten ? stableSessionRef(sessionId, peerIds) : sessionId);
    return { resolveOne, refFor };
  }

  const resolve: RouteHandler = (req, res) => {
    const ref = String(req.query.id ?? '').trim();
    if (!ref) return res.status(400).json({ error: 'id is required' });
    if (ref.length < 4) return res.status(400).json({ error: 'id prefix must be at least 4 characters' });

    const includePrivate = ports.privateUnlocked(req);
    const catalog = runtime.buildSessionCatalog({ includePrivate });
    const resolver = createCatalogResolver(catalog);
    const { session, matches, materialize } = resolver.resolveOne(ref);
    if (session) {
      const hibernation = ports.hibernated().get(session.id);
      const resolved = hibernation ? { ...session, hibernation } : session;
      return res.json({ session: resolved, ref: resolver.refFor(session.id) });
    }
    if (matches.length > 1) {
      return res.status(409).json({
        error: 'ambiguous session id prefix',
        matches: matches.slice(0, 10).map((match) => {
          const item = materialize(match);
          return {
            id: item.id,
            name: item.name,
            cwd: item.cwd || null,
            lastActivity: item.lastActivity,
            isActive: !!item.isActive,
          };
        }),
      });
    }
    res.status(404).json({ error: 'Session not found' });
  };

  /**
   * Resolve up to 50 refs against one catalog + discovery snapshot, for agent-ref
   * hydration without N catalog scans, N root walks, or N HTTP round-trips.
   */
  const resolveBatch: RouteHandler = (req, res) => {
    const raw = req.body && typeof req.body === 'object' && Array.isArray((req.body as { ids?: unknown }).ids)
      ? (req.body as { ids: unknown[] }).ids : null;
    if (!raw) return res.status(400).json({ error: 'ids array is required' });
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (trimmed.length < 4 || trimmed.length > 260 || seen.has(trimmed)) continue;
      seen.add(trimmed);
      ids.push(trimmed);
      if (ids.length >= 50) break;
    }
    if (!ids.length) return res.json({ results: {} });
    const includePrivate = ports.privateUnlocked(req);
    const catalog = runtime.buildSessionCatalog({ includePrivate });
    const resolver = createCatalogResolver(catalog);
    const hibernated = ports.hibernated();
    const results: Record<string, unknown> = Object.create(null);
    for (const id of ids) {
      const { session, matches } = resolver.resolveOne(id);
      if (session) {
        const hibernation = hibernated.get(session.id);
        const projected = sessionForClient(hibernation ? { ...session, hibernation } : session);
        results[id] = { status: 'ok', session: projected, ref: resolver.refFor(session.id) };
      } else if (matches.length > 1) {
        results[id] = { status: 'ambiguous', count: matches.length };
      } else {
        results[id] = { status: 'not_found' };
      }
    }
    res.json({ results });
  };

  // One flat ranked, capped list with snippets and a per-match occurrence count.
  const search: RouteHandler = (req, res) => {
    const query = ((req.query.q || '') as string).trim().toLowerCase();
    const scopeQuery = String(req.query.scope || '').trim().toLowerCase();
    const { active, previous, indexing, discoveryTruncated, discoverySkipped } = runtime.buildSessionCatalog({ includePrivate: ports.privateUnlocked(req) });
    const parsed = parseSessionQuery(query);
    const scopeParsed = parseSessionQuery(scopeQuery);
    const hasScope = scopeParsed.terms.length || scopeParsed.since !== null || scopeParsed.before !== null;
    // Routine runs are noise in human results unless the query/scope asks for
    // them; filtered before scoring so they never consume the cap.
    const hideAutomation = req.query.hideAutomation === '1'
      && !queryAsksForAutomation(parsed) && !(hasScope && queryAsksForAutomation(scopeParsed));
    const contentTokens = positiveQueryTokens(parsed);
    const ranked: Array<{ session: CatalogSession; text: string | null; searchScore: number }> = [];
    let hiddenByScopes = 0;
    let hiddenByAutomation = 0;
    for (const session of [...active, ...previous]) {
      if (hideAutomation && !session.isActive && isAutomationSession(session)) {
        hiddenByAutomation++;
        continue;
      }
      let text: string | null = null;
      if (!evaluateSessionQuery(parsed, session)) {
        if (!contentTokens.length || !session.sessionFile) continue;
        text = getSearchText(sourceForIdentity(session.harnessId, session.nativeSessionId, session.sessionFile));
        if (!evaluateSessionQuery(parsed, session, text)) continue;
      }
      if (hasScope && !evaluateSessionQuery(scopeParsed, session)) {
        hiddenByScopes++;
        continue;
      }
      if (contentTokens.length && session.sessionFile) {
        text ??= getSearchText(sourceForIdentity(session.harnessId, session.nativeSessionId, session.sessionFile));
      }
      ranked.push({ session, text, searchScore: scoreSessionMatch(parsed, session, text) });
    }
    ranked.sort((a, b) => b.searchScore - a.searchScore
      || new Date(b.session.lastActivity || 0).getTime() - new Date(a.session.lastActivity || 0).getTime());
    const results = ranked.slice(0, SEARCH_RESULT_CAP).map(({ session, text, searchScore }) => {
      let snippets: string[] = [], matchCount = 0;
      if (text) ({ snippets, count: matchCount } = buildSnippets(text, contentTokens));
      return { ...session, snippets, matchCount, searchScore };
    });
    res.json({
      results,
      total: ranked.length,
      hiddenByScopes,
      hiddenByAutomation,
      indexing,
      discoveryTruncated,
      discoverySkipped,
    });
  };

  return { list, hostHealth: health, resolve, resolveBatch, search };
}
