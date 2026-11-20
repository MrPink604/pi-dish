/**
 * `/api/knowledge`: search, read and write the knowledge base's topic pages.
 * With no `knowledgeRemote` in this machine's settings the feature is off, and
 * every route answers 503 saying so.
 */
import type { RouteHandler } from './http-boundary';
import { errorMessage, requestBody } from './http-boundary';
import { KNOWLEDGE_SETTING, KnowledgeError, type KnowledgeBase, type KnowledgeWrite } from './knowledge';

export interface KnowledgeHandlers {
  search: RouteHandler;
  read: RouteHandler;
  write: RouteHandler;
}

const OFF = `The knowledge base is off on this host: it needs "${KNOWLEDGE_SETTING}" (the Git remote of the knowledge repository) in ~/.pi/dish/settings.json.`;

export function createKnowledgeHandlers(knowledge: () => KnowledgeBase | null): KnowledgeHandlers {
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
  return {
    search(req, res) {
      answer(res, base => base.search(String(req.query.q ?? '')));
    },
    read(req, res) {
      answer(res, base => base.read(typeof req.query.page === 'string' ? req.query.page : undefined));
    },
    write(req, res) {
      const body = requestBody(req);
      const field = (key: string) => typeof body[key] === 'string' ? body[key] : undefined;
      // The knowledge base validates what it is given.
      answer(res, base => base.write({
        page: field('page') ?? '', mode: (field('mode') ?? 'append') as KnowledgeWrite['mode'], text: field('text') ?? '',
        source: field('source'), title: field('title'), author: field('author') ?? '',
      }));
    },
  };
}
