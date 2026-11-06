// Generated from src/core/server-startup.ts; edit that source and run npm run build:core.
import { type Server, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import express = require('express');
export interface ServerStartupObserver {
    /** The first bound full-app listener, not the advertised agent or share URL. */
    ready(url: string): void;
    /** Errors observed after subscription, before the native host failure policy. */
    failed(error: Error): void;
}
export declare function observeServerStartup(initialServer: Server, observer: ServerStartupObserver): void;
export interface ListenerOptions {
    app: express.Express;
    host: string;
    port: number;
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
    /** Start server-owned services once the main listener binds. */
    onListening(): void;
    /** Stop server-owned services; `shareServer` is the optional restricted listener. */
    closeResources(shareServer: Server | null): void;
    /** Restrictive public listener routes; mounted only when PI_DISH_SHARE_PORT is set. */
    mountShareApp?(app: express.Express): void;
    terminalShutdown?(): void;
    /** Warm caches without delaying listener readiness. */
    warm?(): void;
}
export declare function startListeners(options: ListenerOptions): Server;
