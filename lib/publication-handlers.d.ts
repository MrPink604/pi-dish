// Generated from src/core/publication-handlers.ts; edit that source and run npm run build:core.
import type { Request, RequestHandler } from 'express';
import type { ParsedQs } from 'qs';
import type { SessionSource } from './session-source';
import type { SessionOwnership } from './session-ownership';
import type { CatalogRuntime } from './session-catalog-runtime';
import type { SessionReadHandlers } from './session-read-handlers';
import type { PublicArtifactRelay } from './relay-handlers';
type PublicationRequest = Request<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
type PublicationHandler = RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
export interface PublicationPorts {
    ownership: SessionOwnership;
    catalog: CatalogRuntime;
    findSessionSource(id: string): SessionSource | null;
    reads: SessionReadHandlers;
    relay: PublicArtifactRelay;
    resourceRoot: string;
    /**
     * Text input for a live (or wakeable) session; rejects with an HTTP status
     * when it cannot be taken. Null once taken, else why that is unconfirmed.
     */
    deliverMessage(sessionId: string, text: string): Promise<string | null>;
    /** Whether the session is a private one (held outside every backed-up path). */
    sessionIsPrivate(sessionId: string): boolean;
    /** The private-session PIN gate: true when the request may not see that session. */
    privateRefused(req: PublicationRequest, sessionId: string): boolean;
}
export interface PublicationHandlers {
    importShare: PublicationHandler;
    createShare: PublicationHandler;
    revokeShare: PublicationHandler;
    getShare: PublicationHandler;
    serveSharedSession: PublicationHandler;
    createComment: PublicationHandler;
    commentIndex: PublicationHandler;
    commentCount: PublicationHandler;
    getComments: PublicationHandler;
    updateComment: PublicationHandler;
    deleteComment: PublicationHandler;
    acknowledgeComment: PublicationHandler;
    createPage: PublicationHandler;
    listPages: PublicationHandler;
    revokePage: PublicationHandler;
    page: PublicationHandler;
    pageAsset: PublicationHandler;
    listPageComments: PublicationHandler;
    createPageComment: PublicationHandler;
    updatePageComment: PublicationHandler;
    deletePageComment: PublicationHandler;
    publicPage: PublicationHandler;
    pageForm: PublicationHandler;
    pageFormReceipt: PublicationHandler;
    submitPageForm: PublicationHandler;
    formView: PublicationHandler;
    formStyles: PublicationHandler;
    publicPageAsset: PublicationHandler;
    fileStyles: PublicationHandler;
    highlightStyles: PublicationHandler;
}
export declare function createPublicationHandlers(ports: PublicationPorts): PublicationHandlers;
export {};
