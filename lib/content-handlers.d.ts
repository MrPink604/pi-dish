// Generated from src/core/content-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
type ContentHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
/**
 * The server ships the agent-facing docs for the API this build serves, so an
 * agent in a mixed-version fleet reads the running host's docs.
 */
export declare function createAgentDocHandlers(docsDirectory: string): {
    list: ContentHandler;
    topic: ContentHandler;
};
/**
 * The two built-in themes (defined in style.css) plus user token files under
 * ~/.pi/dish/themes/*.json. Unreadable or malformed files are skipped: a broken
 * theme file must not take down the picker. Re-read per call so edits show.
 */
export declare const themesHandler: ContentHandler;
export {};
