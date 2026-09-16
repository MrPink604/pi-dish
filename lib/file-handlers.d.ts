// Generated from src/core/file-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { SessionSource } from './session-source-contracts';
type FileHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export interface FileHandlerPorts {
    resolveSessionCwd(sessionId: string): unknown;
    findSessionSource(sessionId: string): SessionSource | null;
}
export interface FileHandlers {
    searchDirectories: FileHandler;
    directoryChildren: FileHandler;
    searchSessionFiles: FileHandler;
    fileContent: FileHandler;
    filePreview: FileHandler;
    diffPatch: FileHandler;
    diffSummary: FileHandler;
    retireSession(sessionId: string): void;
}
export declare function createFileHandlers(ports: FileHandlerPorts): FileHandlers;
export {};
