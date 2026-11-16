// Generated from src/core/private-session-handlers.ts; edit that source and run npm run build:core.
import type { IncomingMessage } from 'http';
import type { NextFunction } from 'express';
import { type RouteHandler, type ApplicationRequest, type ApplicationResponse } from './http-boundary';
import { type PrivateAccess } from './private-access';
export interface PrivateSessionPorts {
    readonly access: PrivateAccess;
    /** Whether the route id resolves (live claim or transcript) inside a private root. */
    sessionIsPrivate(sessionId: string): boolean;
}
/**
 * PIN routes plus the per-session gates. A locked request sees a private
 * session exactly as an unknown id: 404, never "locked".
 */
export declare function createPrivateSessionHandlers(ports: PrivateSessionPorts): {
    status: RouteHandler;
    setPin: RouteHandler;
    unlock: RouteHandler;
    lock: RouteHandler;
    sessionGate: (req: ApplicationRequest, res: ApplicationResponse, next: NextFunction) => void;
    refused: (req: IncomingMessage, sessionId: string) => boolean;
};
