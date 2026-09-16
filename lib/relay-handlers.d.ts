// Generated from src/core/relay-handlers.ts; edit that source and run npm run build:core.
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { ArtifactKind, FleetArtifactStore } from './fleet-artifacts';
import type { HostDescriptor, TransportRequest, TransportResponse, TransportHandler } from './access-handlers';
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
}
export interface RelayHandlers {
    rawApi: TransportHandler;
    registerArtifact: TransportHandler;
    listArtifacts: TransportHandler;
    removeArtifact: TransportHandler;
    hosts: TransportHandler;
    comments: TransportHandler;
    publicArtifacts: PublicArtifactRelay;
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean;
}
export declare function createRelayHandlers(ports: RelayPorts): RelayHandlers;
