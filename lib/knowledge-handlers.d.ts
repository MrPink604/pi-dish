// Generated from src/core/knowledge-handlers.ts; edit that source and run npm run build:core.
/**
 * `/api/knowledge`: search, read and write the knowledge base's topic pages.
 * With no `knowledgeRemote` in this machine's settings the feature is off, and
 * every route answers 503 saying so.
 */
import type { RouteHandler } from './http-boundary';
import { type KnowledgeBase } from './knowledge';
export interface KnowledgeHandlers {
    search: RouteHandler;
    read: RouteHandler;
    write: RouteHandler;
}
export declare function createKnowledgeHandlers(knowledge: () => KnowledgeBase | null): KnowledgeHandlers;
