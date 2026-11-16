import type { IncomingMessage } from 'http';
import type { NextFunction } from 'express';
import { errorMessage, errorStatus, requestBody, type RouteHandler, type ApplicationRequest, type ApplicationResponse } from './http-boundary';
import { requestUnlockToken, type PrivateAccess } from './private-access';

export interface PrivateSessionPorts {
  readonly access: PrivateAccess;
  /** Whether the route id resolves (live claim or transcript) inside a private root. */
  sessionIsPrivate(sessionId: string): boolean;
}

const NOT_FOUND = { error: 'Session not found' };

/**
 * PIN routes plus the per-session gates. A locked request sees a private
 * session exactly as an unknown id: 404, never "locked".
 */
export function createPrivateSessionHandlers(ports: PrivateSessionPorts) {
  const { access } = ports;
  /** Also used by the terminal upgrade, which bypasses Express. */
  function refused(req: IncomingMessage, sessionId: string): boolean {
    return !access.unlocked(req) && ports.sessionIsPrivate(sessionId);
  }
  function guarded(res: ApplicationResponse, action: () => unknown): void {
    try { res.json(action()); }
    catch (error) { res.status(errorStatus(error, 500)).json({ error: errorMessage(error) }); }
  }

  const status: RouteHandler = (req, res) => {
    res.json({ pinSet: access.pinConfigured(), unlocked: access.unlocked(req) });
  };
  const setPin: RouteHandler = (req, res) => {
    const { pin, currentPin } = requestBody(req);
    guarded(res, () => { access.setPin(pin, currentPin); return { pinSet: true }; });
  };
  const unlock: RouteHandler = (req, res) => {
    guarded(res, () => ({ token: access.unlock(requestBody(req).pin) }));
  };
  const lock: RouteHandler = (req, res) => {
    access.lock(requestUnlockToken(req));
    res.json({ unlocked: false });
  };
  /** Mounted on `/api/sessions/:id`, which also sees `/new` and `/resolve`; neither resolves to a session. */
  function sessionGate(req: ApplicationRequest, res: ApplicationResponse, next: NextFunction): void {
    if (refused(req, req.params.id)) { res.status(404).json(NOT_FOUND); return; }
    next();
  }
  return { status, setPin, unlock, lock, sessionGate, refused };
}
