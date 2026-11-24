// Generated from src/core/relay-handlers.ts; edit that source and run npm run build:core.
import type { ClientRequest, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { ArtifactKind, FleetArtifactStore } from './fleet-artifacts';
import type { HostDescriptor, TransportRequest, TransportResponse, TransportHandler } from './access-handlers';
/**
 * Whether a generic-proxy path reaches the owner's page-form routes as any
 * hop could read it: Express matches routes case-insensitively, and a
 * normalizing proxy may decode (repeatedly), turn backslashes into slashes and
 * collapse repeated slashes. An undecodable path is treated as a match.
 */
export declare function namesPageForms(path: string): boolean;
/**
 * A page asset path (already decoded by Express) re-encoded segment by segment
 * for the owner, or null when a hop could read it as different path
 * structure. Redundant separators collapse, as they do when the owner serves
 * the file itself. A segment is refused when it, or any further decode of it,
 * is a dot segment, holds a control character, decodes to a separator, or has
 * a dot part between backslashes (some hops treat `\` as `/`). Literal `%` and
 * `\` names otherwise pass, encoded.
 */
export declare function encodedAssetPath(rest: string): string | null;
/** Public fallback only; callers retain local-first artifact ownership. */
export interface PublicArtifactRelay {
    serve(req: TransportRequest, res: TransportResponse, kind: ArtifactKind, options?: {
        annotate?: boolean;
    }): void;
}
export interface RelayPorts {
    fleetArtifacts: FleetArtifactStore;
    localPageExists(token: string): boolean;
    publicBaseUrl(): string | undefined;
    hostDescriptor(): HostDescriptor;
    upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
    proxyResponseTimeoutMs?: number;
}
export interface RelayHandlers {
    rawApi: TransportHandler;
    registerArtifact: TransportHandler;
    listArtifacts: TransportHandler;
    removeArtifact: TransportHandler;
    hosts: TransportHandler;
    /** Page-comment relays, each building its owner URL from route params only. */
    pageComments(route: 'list' | 'item' | 'delete'): TransportHandler;
    /** Page-form relays: the state (optionally one `?submission=`) or one receipt. */
    pageForms(route: 'state' | 'receipt'): TransportHandler;
    publicArtifacts: PublicArtifactRelay;
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean;
}
export declare function relayFirstResponse(opening: Promise<ClientRequest>, timeoutMs: number, send: (upstream: ClientRequest, progress: () => void) => void, respond: (peerRes: IncomingMessage) => void, onFailure: (reason: unknown) => void, classifyError: ((error: unknown) => unknown) | null): void;
export declare function createRelayHandlers(ports: RelayPorts): RelayHandlers;
