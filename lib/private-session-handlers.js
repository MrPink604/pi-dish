// Generated from src/core/private-session-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrivateSessionHandlers = createPrivateSessionHandlers;
const http_boundary_1 = require("./http-boundary");
const private_access_1 = require("./private-access");
const NOT_FOUND = { error: 'Session not found' };
/**
 * PIN routes plus the per-session gates. A locked request sees a private
 * session exactly as an unknown id: 404, never "locked".
 */
function createPrivateSessionHandlers(ports) {
    const { access } = ports;
    /** Also used by the terminal upgrade, which bypasses Express. */
    function refused(req, sessionId) {
        return !access.unlocked(req) && ports.sessionIsPrivate(sessionId);
    }
    function guarded(res, action) {
        try {
            res.json(action());
        }
        catch (error) {
            res.status((0, http_boundary_1.errorStatus)(error, 500)).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    }
    const status = (req, res) => {
        res.json({ pinSet: access.pinConfigured(), unlocked: access.unlocked(req) });
    };
    const setPin = (req, res) => {
        const { pin, currentPin } = (0, http_boundary_1.requestBody)(req);
        guarded(res, () => { access.setPin(pin, currentPin); return { pinSet: true }; });
    };
    const unlock = (req, res) => {
        guarded(res, () => ({ token: access.unlock((0, http_boundary_1.requestBody)(req).pin) }));
    };
    const lock = (req, res) => {
        access.lock((0, private_access_1.requestUnlockToken)(req));
        res.json({ unlocked: false });
    };
    /** Mounted on `/api/sessions/:id`, which also sees `/new` and `/resolve`; neither resolves to a session. */
    function sessionGate(req, res, next) {
        if (refused(req, req.params.id)) {
            res.status(404).json(NOT_FOUND);
            return;
        }
        next();
    }
    return { status, setPin, unlock, lock, sessionGate, refused };
}
