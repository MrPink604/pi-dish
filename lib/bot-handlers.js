// Generated from src/core/bot-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBotHandlers = createBotHandlers;
const http_boundary_1 = require("./http-boundary");
const bot_registry_1 = require("./bot-registry");
const helper_values_1 = require("./helper-values");
const UNAVAILABLE = 'Bots need node:sqlite, which this host\u2019s Node build lacks.';
/** The fields a bot may change on itself or a descendant; its own model is the user's. */
const BOT_EDITABLE = ['name', 'identity', 'places', 'thinking', 'model'];
function optionalText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function createBotHandlers(registry, control) {
    /** A model change takes a new relay: the model is fixed when the runtime opens. */
    async function applied(before, after) {
        if (after.status !== 'active' || before.model === after.model)
            return;
        await control.stop(before);
        await control.start(after);
    }
    return {
        list(_req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            res.json({ bots: bots.list() });
        },
        async create(req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            const body = (0, http_boundary_1.requestBody)(req);
            const by = optionalText(body.by);
            if (by && !bots.get(by))
                return res.status(404).json({ error: `No bot ${by}` });
            let bot;
            try {
                bot = bots.create({
                    id: optionalText(body.id), parentId: optionalText(body.parentId) ?? null,
                    name: String(body.name ?? ''), identity: String(body.identity ?? ''),
                    model: optionalText(body.model), thinking: optionalText(body.thinking) ?? null,
                    places: body.places === undefined ? [] : (0, bot_registry_1.validateBotPatch)({ places: body.places }).places,
                }, by ? { actor: by, turn: optionalText(body.turn) ?? null } : { actor: 'user' });
            }
            catch (error) {
                return res.status(400).json({ error: (0, http_boundary_1.errorMessage)(error) });
            }
            try {
                await control.start(bot);
            }
            catch (error) {
                return res.status(502).json({ bot, error: `Created ${bot.name}, but it did not start: ${(0, http_boundary_1.errorMessage)(error)}` });
            }
            res.status(201).json({ bot });
        },
        async update(req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            const before = bots.get(req.params.id);
            if (!before)
                return res.status(404).json({ error: 'Bot not found' });
            let bot;
            try {
                bot = bots.update(req.params.id, (0, http_boundary_1.requestBody)(req), { actor: 'user' });
            }
            catch (error) {
                return res.status(400).json({ error: (0, http_boundary_1.errorMessage)(error) });
            }
            await applied(before, bot);
            res.json({ bot });
        },
        /** A bot's own change: `by` is the bot making it, which must be the bot itself or an ancestor. */
        async edit(req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            const before = bots.get(req.params.id);
            if (!before)
                return res.status(404).json({ error: 'Bot not found' });
            const body = (0, http_boundary_1.requestBody)(req);
            const by = optionalText(body.by);
            if (!by || !bots.get(by))
                return res.status(400).json({ error: 'by must name the bot making the change' });
            if (!bots.lineage(before.id).includes(by)) {
                return res.status(403).json({ error: `Refused: ${before.name} is not you or one of your descendants.` });
            }
            const changes = (0, helper_values_1.record)(body.changes) ? body.changes : {};
            const refused = Object.keys(changes).filter(field => !BOT_EDITABLE.includes(field));
            if (refused.length)
                return res.status(400).json({ error: `A bot cannot change ${refused.join(', ')}; it may change ${BOT_EDITABLE.join(', ')}.` });
            if (by === before.id && changes.model !== undefined) {
                return res.status(403).json({ error: 'Refused: you cannot change your own model. Tell the user: they can change it on your entry.' });
            }
            let bot;
            try {
                bot = bots.update(before.id, changes, { actor: by, turn: optionalText(body.turn) ?? null });
            }
            catch (error) {
                return res.status(400).json({ error: (0, http_boundary_1.errorMessage)(error) });
            }
            const fields = bot.revision === before.revision ? [] : bots.revisions(bot.id).at(-1).fields;
            await applied(before, bot);
            res.json({ bot, revision: bot.revision, fields, before });
        },
        async retire(req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            const current = bots.get(req.params.id);
            if (!current)
                return res.status(404).json({ error: 'Bot not found' });
            if (current.status === 'retired')
                return res.status(409).json({ error: `${current.name} is already retired` });
            const result = bots.retire(current.id, { actor: 'user' });
            try {
                await control.stop(current);
            }
            catch (error) {
                return res.status(502).json({ ...result, error: `Retired ${current.name}, but its relay did not stop: ${(0, http_boundary_1.errorMessage)(error)}` });
            }
            res.json(result);
        },
        revisions(req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            if (!bots.get(req.params.id))
                return res.status(404).json({ error: 'Bot not found' });
            res.json({ revisions: bots.revisions(req.params.id) });
        },
        /** `fields` limits the restore to what one change touched: the chat's undo. */
        async restore(req, res) {
            const bots = registry();
            if (!bots)
                return res.status(501).json({ error: UNAVAILABLE });
            const before = bots.get(req.params.id);
            if (!before)
                return res.status(404).json({ error: 'Bot not found' });
            const { revision, fields } = (0, http_boundary_1.requestBody)(req);
            if (typeof revision !== 'number' || !Number.isInteger(revision))
                return res.status(400).json({ error: 'revision must be an integer' });
            if (fields !== undefined && !(Array.isArray(fields) && fields.every(field => typeof field === 'string'))) {
                return res.status(400).json({ error: 'fields must be a list of field names' });
            }
            let bot;
            try {
                bot = bots.restore(before.id, revision, { actor: 'user' }, fields);
            }
            catch (error) {
                return res.status(404).json({ error: (0, http_boundary_1.errorMessage)(error) });
            }
            await applied(before, bot);
            res.json({ bot });
        },
    };
}
