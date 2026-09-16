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
}
export interface AccessHandlers {
    compression: TransportHandler;
    jsonBody: TransportHandler;
    cors: TransportHandler;
    apiGate: TransportHandler;
    hostsGate: TransportHandler;
    host: TransportHandler;
    ticket: TransportHandler;
    hostDescriptor(): HostDescriptor;
    upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
}
/** One startup-scoped auth owner; public listeners deliberately do not mount it. */
export declare function createAccessHandlers(ports: AccessPorts): AccessHandlers;
