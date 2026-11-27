// Generated from src/core/relay-handlers.ts; edit that source and run npm run build:core.
import type { ClientRequest, IncomingMessage, OutgoingHttpHeaders } from 'http';
import type { Duplex } from 'stream';
import type { ArtifactKind, FleetArtifactStore } from './fleet-artifacts';
import { type HostDescriptor, type TransportRequest, type TransportResponse, type TransportHandler } from './access-handlers';
/**
 * Matches any `/hosts/:name/api` suffix that a downstream hop could interpret
 * as a `/api/vault/bridge` route (case-insensitively, after repeated percent
 * decoding, backslash conversion, duplicate-slash collapse, and dot-segment
 * normalization). Undecodable paths fail closed as a match.
 */
export declare function namesVaultBridgeRoute(rawPath: string): boolean;
/**
 * Whether a generic-proxy path reaches the owner's page-form routes as any
 * hop could read it: Express matches routes case-insensitively, and a
 * normalizing proxy may decode (repeatedly), turn backslashes into slashes and
 * collapse repeated slashes. An undecodable path is treated as a match.
 */
export declare function namesPageForms(path: string): boolean;
/**
 * Matches any `/hosts/:name/api` suffix that a downstream hop could interpret
 * as a `/api/cu` route (case-insensitively, after repeated percent decoding,
 * backslash conversion, duplicate-slash collapse, and dot-segment normalization)
 * so CU requests never bypass the hub's header allowlist, CSRF guard, Spaces
 * route allowlist, or `/api/cu/fill/*` block. Undecodable paths fail closed.
 */
export declare function namesCuRoute(reqPath: string): boolean;
/**
 * Classifies a `/hosts/:name/` or `/hosts/:name/api` path against local-only `/omp-models` routes:
 * - `'reject_400'` when the path contains dot segments or encoded `%2e`/`%2f`/`%5c`
 *   (any case) and matches `omp-models` after decoding and normalisation (or fails decoding);
 * - `'block_501'` when the decoded, normalised path targets `/omp-models`;
 * - `'ok'` otherwise.
 */
export declare function inspectOmpModelsRelayPath(rawPath: string): 'ok' | 'reject_400' | 'block_501';
/** Matches `/omp-models` routes, which are strictly local-host only (never proxied to peers). */
export declare function namesOmpModelsRoute(reqPath: string): boolean;
/** Strict hub->guest header allowlist for CU control-plane GET/SSE requests. */
export declare function buildHubCuReadHeaders(incoming: IncomingMessage['headers']): OutgoingHttpHeaders;
/** Strict hub->guest header allowlist for CU Spaces gRPC-Web POST requests. */
export declare function buildHubCuSpacesHttpHeaders(incoming: IncomingMessage['headers']): OutgoingHttpHeaders;
/** Strict hub->guest header allowlist for CU `/media` WebSocket upgrades. */
export declare function buildHubCuWsHeaders(incoming: IncomingMessage['headers']): OutgoingHttpHeaders;
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
    checkCuMutationIngress?(req: TransportRequest, res: TransportResponse): boolean;
    proxyResponseTimeoutMs?: number;
    cuProxyResponseTimeoutMs?: number;
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
export declare const CU_PROXY_RESPONSE_TIMEOUT_MS = 15000;
export declare function relayFirstResponse(opening: Promise<ClientRequest>, timeoutMs: number, send: (upstream: ClientRequest) => void, respond: (peerRes: IncomingMessage) => void, onFailure: (reason: unknown) => void, classifyError: ((error: unknown) => unknown) | null): void;
export declare function createRelayHandlers(ports: RelayPorts): RelayHandlers;
