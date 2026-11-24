// Generated from src/core/file-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { SessionSource } from './session-source';
type FileHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export interface FileHandlerPorts {
    resolveSessionCwd(sessionId: string): unknown;
    findSessionSource(sessionId: string): SessionSource | null;
    uploadRoot(): string;
}
export interface FileHandlers {
    searchDirectories: FileHandler;
    directoryChildren: FileHandler;
    searchSessionFiles: FileHandler;
    fileContent: FileHandler;
    filePreview: FileHandler;
    diffPatch: FileHandler;
    diffSummary: FileHandler;
    /**
     * A path as the session's file viewer reaches it (cwd, files its tools
     * touched, agy brain, uploads); null when the session is unknown or the
     * path is outside its reach.
     */
    resolveSessionFile(sessionId: string, mention: string): Promise<string | null>;
    retireSession(sessionId: string): void;
}
export declare function createFileHandlers(ports: FileHandlerPorts): FileHandlers;
export {};
