// Generated from src/core/bot-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBotHandlers = createBotHandlers;
const http_boundary_1 = require("./http-boundary");
const UNAVAILABLE = 'Bots need node:sqlite, which this host\u2019s Node build lacks.';
function createBotHandlers(registry) {
    return {
        list(_req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            res.json({ bots: bots.list() });
        },
        update(req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            if (!bots.get(req.params.id))
                return res.status(404).json({ error: 'Bot not found' });
            try {
                res.json({ bot: bots.update(req.params.id, (0, http_boundary_1.requestBody)(req), { actor: 'user' }) });
            }
            catch (error) {
                res.status(400).json({ error: (0, http_boundary_1.errorMessage)(error) });
            }
        },
        revisions(req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            if (!bots.get(req.params.id))
                return res.status(404).json({ error: 'Bot not found' });
            res.json({ revisions: bots.revisions(req.params.id) });
        },
        restore(req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            if (!bots.get(req.params.id))
                return res.status(404).json({ error: 'Bot not found' });
            const { revision } = (0, http_boundary_1.requestBody)(req);
            if (typeof revision !== 'number' || !Number.isInteger(revision))
                return res.status(400).json({ error: 'revision must be an integer' });
            try {
                res.json({ bot: bots.restore(req.params.id, revision, { actor: 'user' }) });
            }
            catch (error) {
                res.status(404).json({ error: (0, http_boundary_1.errorMessage)(error) });
            }
        },
    };
}
