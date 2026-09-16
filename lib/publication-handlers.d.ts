// Generated from src/core/publication-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { ParsedQs } from 'qs';
import type { SessionSource, DiscoveryCandidate } from './session-source-contracts';
import type { BridgeRegistryEntry } from './contracts';
import type { SessionReadHandlers } from './session-read-handlers';
import type { PublicArtifactRelay } from './relay-handlers';
type PublicationHandler = RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
export interface PublicationPorts {
    findSessionSource(id: string): SessionSource | null;
    liveSessionHistoryPending(id: string): boolean;
    listRegisteredSessions(): readonly BridgeRegistryEntry[];
    enumerateSessionCandidates(): readonly DiscoveryCandidate[];
    getRPCSession(id: string): {
        readonly id: unknown;
    } | null | undefined;
    exportSessionHtml: SessionReadHandlers['exportSessionHtml'];
    getOmpShareSnapshot: SessionReadHandlers['getOmpShareSnapshot'];
    relay: PublicArtifactRelay;
    publicBaseUrl(): string | undefined;
    resourceRoot: string;
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
    publicPage: PublicationHandler;
    publicPageAsset: PublicationHandler;
    fileStyles: PublicationHandler;
    highlightStyles: PublicationHandler;
}
export declare function createPublicationHandlers(ports: PublicationPorts): PublicationHandlers;
export {};
