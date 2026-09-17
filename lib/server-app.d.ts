// Generated from src/core/server-app.ts; edit that source and run npm run build:core.
import type { Server } from 'node:http';
export interface ServerStartupObserver {
    /** The first bound full-app listener, not the advertised agent or share URL. */
    ready(url: string): void;
    /** Errors observed after subscription, before the native host failure policy. */
    failed(error: Error): void;
}
export declare function observeServerStartup(initialServer: Server, observer: ServerStartupObserver): void;
export declare function startServer(rootDirectory: string): Server;
