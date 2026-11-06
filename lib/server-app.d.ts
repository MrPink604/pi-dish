// Generated from src/core/server-app.ts; edit that source and run npm run build:core.
import { observeServerStartup } from './server-startup';
import type { Server } from 'node:http';
export { observeServerStartup };
export type { ServerStartupObserver } from './server-startup';
export declare function startServer(rootDirectory: string): Server;
