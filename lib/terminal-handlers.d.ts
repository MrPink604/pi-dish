// Generated from src/core/terminal-handlers.ts; edit that source and run npm run build:core.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { PaneTarget } from './tmux';
export interface TerminalPorts {
    upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
    getRegisteredSession(id: string): object | null | undefined;
    getRPCSession(id: string): object | null | undefined;
    findSessionFile(id: string): string | null | undefined;
    resolveSessionCwd(id: string): unknown;
    locatePiPane(id: string): Promise<PaneTarget | null>;
}
export interface TerminalHandlers {
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean;
    shutdown(): void;
}
/** Local terminal only; peer upgrades remain ahead of it in the dispatcher. */
export declare function createTerminalHandlers(ports: TerminalPorts): TerminalHandlers;
