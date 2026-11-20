/**
 * `/api/bots`: the registry as the user sees it. Every edit made here writes a
 * revision with the user as its author; restoring an old revision writes a new
 * one. A host whose Node lacks `node:sqlite` answers 501.
 */
import type { RouteHandler } from './http-boundary';
import { errorMessage, requestBody } from './http-boundary';
import type { BotRegistry } from './bot-registry';

export interface BotHandlers {
  list: RouteHandler;
  update: RouteHandler;
  revisions: RouteHandler;
  restore: RouteHandler;
}

const UNAVAILABLE = 'Bots need node:sqlite, which this host\u2019s Node build lacks.';

export function createBotHandlers(registry: () => BotRegistry | null): BotHandlers {
  return {
    list(_req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      res.json({ bots: bots.list() });
    },
    update(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      if (!bots.get(req.params.id)) return res.status(404).json({ error: 'Bot not found' });
      try {
        res.json({ bot: bots.update(req.params.id, requestBody(req), { actor: 'user' }) });
      } catch (error) {
        res.status(400).json({ error: errorMessage(error) });
      }
    },
    revisions(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      if (!bots.get(req.params.id)) return res.status(404).json({ error: 'Bot not found' });
      res.json({ revisions: bots.revisions(req.params.id) });
    },
    restore(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      if (!bots.get(req.params.id)) return res.status(404).json({ error: 'Bot not found' });
      const { revision } = requestBody(req);
      if (typeof revision !== 'number' || !Number.isInteger(revision)) return res.status(400).json({ error: 'revision must be an integer' });
      try {
        res.json({ bot: bots.restore(req.params.id, revision, { actor: 'user' }) });
      } catch (error) {
        res.status(404).json({ error: errorMessage(error) });
      }
    },
  };
}
