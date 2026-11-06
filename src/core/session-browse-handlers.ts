import type { RouteHandler } from './http-boundary';
import { errorMessage } from './http-boundary';
import { createHostHealth } from './host-health';
import {
  buildSnippets, evaluateSessionQuery, isAutomationSession, parseSessionQuery,
  positiveQueryTokens, queryAsksForAutomation, scoreSessionMatch,
} from './helper-query.js';
import { stableSessionRef } from './helper-refs.js';
import { sourceForIdentity } from './session-source';
import { getSearchText } from './session-index';
import { sessionForClient } from './session-api';
import type { HibernationState } from './session-api';
import type { CatalogRuntime } from './session-catalog-runtime';
import type { CatalogSession } from './session-catalog';

export interface SessionBrowsePorts {
  catalog: CatalogRuntime;
  hibernated(): ReadonlyMap<string, HibernationState>;
}

const SEARCH_RESULT_CAP = 100;

export function createSessionBrowseHandlers(ports: SessionBrowsePorts) {
  const { catalog: runtime } = ports;
  const hostHealth = createHostHealth();

  const list: RouteHandler = async (req, res) => {
    const query = ((req.query.q || '') as string).trim().toLowerCase();
    await runtime.refreshPrimeRoster();
    const catalog = runtime.buildSessionCatalog({ activeOnly: req.query.active === '1' });
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
    res.json({
      active: projection(catalog.active),
      previous: projection(previous),
      children: projection(catalog.children),
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

  const resolve: RouteHandler = (req, res) => {
    const ref = String(req.query.id ?? '').trim();
    if (!ref) return res.status(400).json({ error: 'id is required' });
    if (ref.length < 4) return res.status(400).json({ error: 'id prefix must be at least 4 characters' });

    const catalog = runtime.buildSessionCatalog();
    const { session, matches } = runtime.resolveRefInCatalog(catalog, ref);
    if (session) return res.json({ session, ref: stableSessionRef(session.id, catalog.list.map((entry) => entry.id)) });
    if (matches.length > 1) {
      return res.status(409).json({
        error: 'ambiguous session id prefix',
        matches: matches.slice(0, 10).map((match) => ({
          id: match.id,
          name: match.name,
          cwd: match.cwd || null,
          lastActivity: match.lastActivity,
          isActive: !!match.isActive,
        })),
      });
    }
    res.status(404).json({ error: 'Session not found' });
  };

  // Main-pane search: one flat result list with multiple snippets and an
  // occurrence count per content match, ranked then capped.
  const search: RouteHandler = (req, res) => {
    const query = ((req.query.q || '') as string).trim().toLowerCase();
    const scopeQuery = String(req.query.scope || '').trim().toLowerCase();
    const { active, previous, indexing, discoveryTruncated, discoverySkipped } = runtime.buildSessionCatalog();
    const parsed = parseSessionQuery(query);
    const scopeParsed = parseSessionQuery(scopeQuery);
    const hasScope = scopeParsed.terms.length || scopeParsed.since !== null || scopeParsed.before !== null;
    // Routine runs are cron noise in a human's results; the browser asks for
    // inactive ones to be dropped unless the query (or active scope) asks for
    // them. Applied before scoring and the cap so the cap is never wasted.
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

  return { list, hostHealth: health, resolve, search };
}
