// Generated from src/core/knowledge-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKnowledgeHandlers = createKnowledgeHandlers;
const http_boundary_1 = require("./http-boundary");
const knowledge_1 = require("./knowledge");
const OFF = `The knowledge base is off on this host: it needs "${knowledge_1.KNOWLEDGE_SETTING}" (the Git remote of the knowledge repository) in ~/.pi/dish/settings.json.`;
function createKnowledgeHandlers(knowledge, bots) {
    function answer(res, work) {
        const base = knowledge();
        if (!base) {
            res.status(503).json({ error: OFF, off: true });
            return;
        }
        work(base).then(result => res.json(result), error => res.status(error instanceof knowledge_1.KnowledgeError ? error.status : 500).json({ error: (0, http_boundary_1.errorMessage)(error) }));
    }
    function queryString(req, key) {
        const value = req.query[key];
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }
    /** Resolves readable bot ids (self, plus ancestors when requested) and their current names. */
    function resolveReadableBots(callerBotId, includeAncestors) {
        if (!callerBotId)
            return { botIds: [], botNames: {} };
        const registry = bots ? bots() : null;
        if (!registry)
            return { botIds: [callerBotId], botNames: {} };
        const botIds = includeAncestors
            ? registry.lineage(callerBotId)
            : (registry.get(callerBotId) ? [callerBotId] : []);
        const botNames = {};
        for (const id of botIds) {
            const row = registry.get(id);
            if (row)
                botNames[id] = row.name;
        }
        return { botIds, botNames };
    }
    return {
        search(req, res) {
            const q = String(req.query.q ?? '');
            const rawScope = queryString(req, 'scope');
            const botId = queryString(req, 'botId');
            const includeAncestors = queryString(req, 'ancestors') === '1' || queryString(req, 'ancestors') === 'true';
            answer(res, async (base) => {
                if (rawScope !== undefined && rawScope !== 'all' && rawScope !== 'shared' && rawScope !== 'bot') {
                    throw new knowledge_1.KnowledgeError('scope must be "shared", "bot", or "all"', 400);
                }
                const { botIds, botNames } = resolveReadableBots(botId, includeAncestors);
                return base.search(q, {
                    scope: rawScope,
                    botIds,
                    botNames,
                });
            });
        },
        read(req, res) {
            const page = typeof req.query.page === 'string' ? req.query.page : undefined;
            const rawScope = queryString(req, 'scope');
            const botId = queryString(req, 'botId');
            const targetBotId = queryString(req, 'targetBotId');
            const includeAncestors = queryString(req, 'ancestors') === '1' || queryString(req, 'ancestors') === 'true';
            const fallbackParam = queryString(req, 'fallback');
            answer(res, async (base) => {
                if (rawScope !== undefined && rawScope !== 'shared' && rawScope !== 'bot') {
                    throw new knowledge_1.KnowledgeError('scope must be "shared" or "bot"', 400);
                }
                const { botIds, botNames } = resolveReadableBots(botId, includeAncestors);
                const fallbackToBot = !rawScope && !!botId && fallbackParam !== '0' && fallbackParam !== 'false';
                return base.read(page, {
                    scope: rawScope,
                    botId,
                    targetBotId,
                    readableBotIds: botIds,
                    botNames,
                    fallbackToBot,
                });
            });
        },
        write(req, res) {
            const body = (0, http_boundary_1.requestBody)(req);
            const field = (key) => typeof body[key] === 'string' ? body[key] : undefined;
            const droppedSources = Array.isArray(body.droppedSources)
                ? body.droppedSources.filter((item) => typeof item === 'string')
                : undefined;
            const scope = field('scope');
            const callerBotId = field('botId')?.trim() || undefined;
            const targetBotId = field('targetBotId')?.trim() || callerBotId;
            answer(res, async (base) => {
                const registry = bots ? bots() : null;
                let botName = field('botName');
                if (scope === 'bot') {
                    if (callerBotId && registry && !registry.get(callerBotId)) {
                        throw new knowledge_1.KnowledgeError(`Refused: unknown bot "${callerBotId}".`, 403);
                    }
                    if (!botName && callerBotId && registry)
                        botName = registry.get(callerBotId)?.name;
                }
                // The knowledge base validates what it is given.
                return base.write({
                    page: field('page') ?? '',
                    scope,
                    botId: targetBotId,
                    callerBotId,
                    botName,
                    mode: (field('mode') ?? 'append'),
                    text: field('text') ?? '',
                    source: field('source'),
                    title: field('title'),
                    summary: field('summary'),
                    revision: field('revision'),
                    droppedSources,
                    author: field('author') ?? '',
                });
            });
        },
    };
}
