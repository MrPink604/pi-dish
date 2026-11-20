// Generated from src/core/knowledge-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKnowledgeHandlers = createKnowledgeHandlers;
const http_boundary_1 = require("./http-boundary");
const knowledge_1 = require("./knowledge");
const OFF = `The knowledge base is off on this host: it needs "${knowledge_1.KNOWLEDGE_SETTING}" (the Git remote of the knowledge repository) in ~/.pi/dish/settings.json.`;
function createKnowledgeHandlers(knowledge) {
    function answer(res, work) {
        const base = knowledge();
        if (!base) {
            res.status(503).json({ error: OFF, off: true });
            return;
        }
        work(base).then(result => res.json(result), error => res.status(error instanceof knowledge_1.KnowledgeError ? error.status : 500).json({ error: (0, http_boundary_1.errorMessage)(error) }));
    }
    return {
        search(req, res) {
            answer(res, base => base.search(String(req.query.q ?? '')));
        },
        read(req, res) {
            answer(res, base => base.read(typeof req.query.page === 'string' ? req.query.page : undefined));
        },
        write(req, res) {
            const body = (0, http_boundary_1.requestBody)(req);
            const field = (key) => typeof body[key] === 'string' ? body[key] : undefined;
            // The knowledge base validates what it is given.
            answer(res, base => base.write({
                page: field('page') ?? '', mode: (field('mode') ?? 'append'), text: field('text') ?? '',
                source: field('source'), title: field('title'), author: field('author') ?? '',
            }));
        },
    };
}
