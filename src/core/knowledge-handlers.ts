/**
 * `/api/knowledge`: search, read and write the knowledge base's topic pages
 * (both shared pages and per-bot KBs). With no `knowledgeRemote` in this
 * machine's settings the feature is off, and every route answers 503 saying so.
 */
import type { BotRegistry } from './bot-registry';
import type { RouteHandler } from './http-boundary';
import { errorMessage, requestBody } from './http-boundary';
import {
  KNOWLEDGE_SETTING,
  KnowledgeError,
  type KnowledgeBase,
  type KnowledgeScope,
  type KnowledgeWrite,
} from './knowledge';

export interface KnowledgeHandlers {
  search: RouteHandler;
  read: RouteHandler;
  write: RouteHandler;
}

const OFF = `The knowledge base is off on this host: it needs "${KNOWLEDGE_SETTING}" (the Git remote of the knowledge repository) in ~/.pi/dish/settings.json.`;

export function createKnowledgeHandlers(
  knowledge: () => KnowledgeBase | null,
  bots?: () => BotRegistry | null,
): KnowledgeHandlers {
  function answer(res: Parameters<RouteHandler>[1], work: (base: KnowledgeBase) => Promise<unknown>): void {
    const base = knowledge();
    if (!base) {
      res.status(503).json({ error: OFF, off: true });
      return;
    }
    work(base).then(
      result => res.json(result),
      error => res.status(error instanceof KnowledgeError ? error.status : 500).json({ error: errorMessage(error) }),
    );
  }

  function queryString(req: Parameters<RouteHandler>[0], key: string): string | undefined {
    const value = req.query[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  /** Resolves readable bot ids (self, plus ancestors when requested) and their current names. */
  function resolveReadableBots(callerBotId: string | undefined, includeAncestors: boolean): {
    botIds: string[];
    botNames: Record<string, string>;
  } {
    if (!callerBotId) return { botIds: [], botNames: {} };
    const registry = bots ? bots() : null;
    if (!registry) return { botIds: [callerBotId], botNames: {} };
    const botIds = includeAncestors
      ? registry.lineage(callerBotId)
      : (registry.get(callerBotId) ? [callerBotId] : []);
    const botNames: Record<string, string> = {};
    for (const id of botIds) {
      const row = registry.get(id);
      if (row) botNames[id] = row.name;
    }
    return { botIds, botNames };
  }

  return {
    search(req, res) {
      const q = String(req.query.q ?? '');
      const rawScope = queryString(req, 'scope');
      const botId = queryString(req, 'botId');
      const includeAncestors = queryString(req, 'ancestors') === '1' || queryString(req, 'ancestors') === 'true';
      answer(res, async base => {
        if (rawScope !== undefined && rawScope !== 'all' && rawScope !== 'shared' && rawScope !== 'bot') {
          throw new KnowledgeError('scope must be "shared", "bot", or "all"', 400);
        }
        const { botIds, botNames } = resolveReadableBots(botId, includeAncestors);
        return base.search(q, {
          scope: rawScope,
          botIds,
          botNames,
        });
      });
    },

    read(req, res) {
      const page = typeof req.query.page === 'string' ? req.query.page : undefined;
      const rawScope = queryString(req, 'scope');
      const botId = queryString(req, 'botId');
      const targetBotId = queryString(req, 'targetBotId');
      const includeAncestors = queryString(req, 'ancestors') === '1' || queryString(req, 'ancestors') === 'true';
      const fallbackParam = queryString(req, 'fallback');
      answer(res, async base => {
        if (rawScope !== undefined && rawScope !== 'shared' && rawScope !== 'bot') {
          throw new KnowledgeError('scope must be "shared" or "bot"', 400);
        }
        const { botIds, botNames } = resolveReadableBots(botId, includeAncestors);
        const fallbackToBot = !rawScope && !!botId && fallbackParam !== '0' && fallbackParam !== 'false';
        return base.read(page, {
          scope: rawScope as KnowledgeScope | undefined,
          botId,
          targetBotId,
          readableBotIds: botIds,
          botNames,
          fallbackToBot,
        });
      });
    },

    write(req, res) {
      const body = requestBody(req);
      const field = (key: string) => typeof body[key] === 'string' ? body[key] : undefined;
      const droppedSources = Array.isArray(body.droppedSources)
        ? body.droppedSources.filter((item): item is string => typeof item === 'string')
        : undefined;
      const scope = field('scope') as KnowledgeWrite['scope'];
      const callerBotId = field('botId')?.trim() || undefined;
      const targetBotId = field('targetBotId')?.trim() || callerBotId;
      answer(res, async base => {
        const registry = bots ? bots() : null;
        let botName = field('botName');
        if (scope === 'bot') {
          if (callerBotId && registry && !registry.get(callerBotId)) {
            throw new KnowledgeError(`Refused: unknown bot "${callerBotId}".`, 403);
          }
          if (!botName && callerBotId && registry) botName = registry.get(callerBotId)?.name;
        }
        // The knowledge base validates what it is given.
        return base.write({
          page: field('page') ?? '',
          scope,
          botId: targetBotId,
          callerBotId,
          botName,
          mode: (field('mode') ?? 'append') as KnowledgeWrite['mode'],
          text: field('text') ?? '',
          source: field('source'),
          title: field('title'),
          summary: field('summary'),
          revision: field('revision'),
          droppedSources,
          author: field('author') ?? '',
        });
      });
    },
  };
}
