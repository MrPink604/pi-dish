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
}
export interface AccessHandlers {
    compression: TransportHandler;
    jsonBody: TransportHandler;
    cors: TransportHandler;
    pageCommentTransport: TransportHandler;
    sameOriginOnly: TransportHandler;
    apiGate: TransportHandler;
    hostsGate: TransportHandler;
    host: TransportHandler;
    ticket: TransportHandler;
    hostDescriptor(): HostDescriptor;
    upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
}
/**
 * PI_DISH_PUBLIC_ORIGINS: comma-separated bare http(s) origins. Anything
 * else (a path, query, credentials, another scheme, an unparsable value) is
 * skipped with a warning rather than widened into something it does not name.
 */
export declare function parsePublicOrigins(value: string, warn: (message: string) => void): Set<string>;
/** One startup-scoped auth owner; public listeners deliberately do not mount it. */
export declare function createAccessHandlers(ports: AccessPorts): AccessHandlers;
