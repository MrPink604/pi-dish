// Generated from src/core/access-handlers.ts; edit that source and run npm run build:core.
import express = require('express');
import type { IncomingMessage } from 'http';
import type { ParsedQs } from 'qs';
export type TransportRequest = express.Request<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
export type TransportResponse = express.Response<unknown, Record<string, unknown>>;
export type TransportHandler = express.RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
export interface HostDescriptor {
    hostId: string;
    label: string;
    version: string;
    capabilities: Record<string, true>;
}
export interface AccessPorts {
    readonly version: string;
    readDishSettings(): Record<string, unknown>;
    sttAvailable(): boolean;
    usageLimitsAvailable(): boolean;
    /** True where the bot registry opens (this Node has node:sqlite). */
    botsAvailable(): boolean;
    /** True where `knowledgeRemote` is set: this host serves the knowledge base. */
    knowledgeAvailable(): boolean;
    /** True where the guest cu-broker Unix socket exists (PI_DISH_CU_BROKER_SOCKET). */
    computerUseAvailable?(): boolean;
    /** True where the local `fleet omp-models` helper exists on this host. */
    ompModelsAvailable?(): boolean;
}
export interface AccessHandlers {
    compression: TransportHandler;
    jsonBody: TransportHandler;
    cors: TransportHandler;
    pageCommentTransport: TransportHandler;
    sameOriginOnly: TransportHandler;
    checkCuMutationIngress(req: TransportRequest, res: TransportResponse): boolean;
    cuMutationGuard: TransportHandler;
    ompModelsMutationGuard: TransportHandler;
    requireBearer: TransportHandler;
    apiGate: TransportHandler;
    hostsGate: TransportHandler;
    host: TransportHandler;
    ticket: TransportHandler;
    hostDescriptor(): HostDescriptor;
    hasAuthToken(): boolean;
    upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
    bearerUpgradeAuthorized(req: IncomingMessage): boolean;
}
/**
 * PI_DISH_PUBLIC_ORIGINS: comma-separated bare http(s) origins. Anything
 * else (a path, query, credentials, another scheme, an unparsable value) is
 * skipped with a warning rather than widened into something it does not name.
 */
export declare function parsePublicOrigins(value: string, warn: (message: string) => void): Set<string>;
/**
 * Validates browser Origin + Fetch Metadata headers on computer-use mutations
 * at ingress (before any hub relay strips Origin) and on direct routes.
 * Permits same-origin http/https matching Host, PI_DISH_PUBLIC_ORIGINS, and
 * non-browser callers (absent Origin + Sec-Fetch-Site); rejects cross-origin,
 * opaque (`Origin: null`), and browser writes stripped of Origin.
 */
export declare function checkCuMutationOrigin(req: IncomingMessage, publicOrigins?: ReadonlySet<string>): string | null;
export declare function checkCuMutationIngressRequest(req: TransportRequest, res: TransportResponse, publicOrigins?: ReadonlySet<string>): boolean;
/** One startup-scoped auth owner; public listeners deliberately do not mount it. */
export declare function createAccessHandlers(ports: AccessPorts): AccessHandlers;
