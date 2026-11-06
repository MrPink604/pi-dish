// Generated from src/core/session-stream-handler.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { LiveSession } from './session-ownership';
export interface SessionStreamPorts {
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    /** Open browser event streams per canonical session; hibernation reads it. */
    viewers: Map<string, number>;
}
type StreamHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export declare function createSessionStreamHandler(ports: SessionStreamPorts): StreamHandler;
export {};
