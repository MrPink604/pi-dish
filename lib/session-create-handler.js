// Generated from src/core/session-create-handler.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionCreateHandlers = createSessionCreateHandlers;
const http_boundary_1 = require("./http-boundary");
const http_boundary_2 = require("./http-boundary");
const harnesses_1 = require("./harnesses");
const sessionProvenance = require("./session-provenance");
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
function createSessionCreateHandlers(ports) {
    const create = async (req, res) => {
        const body = (0, http_boundary_1.requestBody)(req);
        const harness = body.harness === undefined ? 'pi' : body.harness;
        const descriptor = (0, harnesses_1.getHarness)(harness);
        if (!descriptor)
            return res.status(400).json({ error: `Unknown harness: ${harness}` });
        const name = typeof body.name === 'string' ? body.name.trim() : body.name;
        const { model, thinking, cwd, target, private: isPrivate } = body;
        if (isPrivate !== undefined && typeof isPrivate !== 'boolean') {
            return res.status(400).json({ error: 'private must be a boolean' });
        }
        if (isPrivate === true && !descriptor.privateRootPath) {
            return res.status(400).json({ error: `${descriptor.label} does not support private sessions.` });
        }
        if (name !== undefined && (typeof name !== 'string' || !name)) {
            return res.status(400).json({ error: 'Name must be a non-empty string' });
        }
        if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
            return res.status(400).json({ error: 'Model must be a non-empty string' });
        }
        if (cwd !== undefined && typeof cwd !== 'string') {
            return res.status(400).json({ error: 'cwd must be a string' });
        }
        if (thinking !== undefined && !THINKING_LEVELS.includes(thinking)) {
            return res.status(400).json({ error: 'Invalid reasoning level' });
        }
        // requestedBySessionId is the public provenance field; sourceSessionId stays
        // a compatibility alias. The header lets the bundled CLI identify itself.
        const claimedSource = req.get('X-Pi-Dish-Session-Id')
            || body.requestedBySessionId || body.sourceSessionId || null;
        // Callers may name themselves fleet-globally (`<hostId>:<sessionId>`); this
        // host's qualifier is stripped and validated locally. Provenance is
        // advisory and grants nothing, so a foreign id is recorded as-is.
        const sourceSessionId = typeof claimedSource === 'string'
            ? sessionProvenance.localizeCallerId(claimedSource) : null;
        const unknownSource = sourceSessionId && !sessionProvenance.isHostQualified(sourceSessionId)
            && !ports.getRegisteredSession(sourceSessionId) && !ports.getRPCSession(sourceSessionId)?.alive
            && !ports.findSessionFile(sourceSessionId, { exact: true });
        if (unknownSource || (claimedSource !== null && typeof claimedSource !== 'string')) {
            return res.status(400).json({
                error: 'requestedBySessionId must identify an existing session on this host; name a session on another fleet host as <hostId>:<sessionId>',
            });
        }
        const selected = {
            harness,
            name: name,
            model,
            thinking,
            cwd,
            target: target,
            private: isPrivate === true,
        };
        if (body.async === true) {
            const spawnId = ports.sessionOperations.startSessionSpawn({
                ...selected, sourceSessionId,
            });
            return res.status(202).json({ success: true, pending: true, spawnId });
        }
        try {
            await ports.sessionLaunch.validateHarnessPilotSelection(descriptor, selected);
        }
        catch (error) {
            return res.status((0, http_boundary_2.errorStatus)(error, 500)).json({ error: (0, http_boundary_2.errorMessage)(error) });
        }
        try {
            const id = await ports.sessionOperations.createSession(selected);
            const operationId = sourceSessionId
                ? ports.sessionOperations.recordSessionLaunch(id, sourceSessionId) : null;
            res.json({ success: true, id, ...(operationId ? { operationId } : {}) });
        }
        catch (error) {
            console.error('Failed to create session:', error);
            res.status((0, http_boundary_2.errorStatus)(error, 500)).json({ success: false, error: (0, http_boundary_2.errorMessage)(error) });
        }
    };
    const spawnStatus = (req, res) => {
        const operation = ports.sessionOperations.getSessionSpawn(req.params.id);
        if (!operation)
            return res.status(404).json({ error: 'Session spawn not found' });
        res.status(operation.status === 'starting' ? 202 : 200).json(operation);
    };
    return { create, spawnStatus };
}
