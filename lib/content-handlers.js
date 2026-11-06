// Generated from src/core/content-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.themesHandler = void 0;
exports.createAgentDocHandlers = createAgentDocHandlers;
const fs = require("fs");
const path = require("path");
const dish_store_1 = require("./dish-store");
const wire_protocol_1 = require("./wire-protocol");
const AGENT_DOC_TOPIC_RE = /^[a-z0-9-]{1,64}$/;
const AGENT_DOC_DESCRIPTION_MAX = 160;
function agentDocSummary(markdown) {
    const lines = markdown.split('\n');
    let title = '';
    let index = 0;
    for (; index < lines.length; index++) {
        const heading = /^#\s+(.*\S)\s*$/.exec(lines[index]);
        if (heading) {
            title = heading[1];
            index++;
            break;
        }
    }
    let description = '';
    for (; index < lines.length; index++) {
        const line = lines[index].trim();
        if (!line || line.startsWith('#'))
            continue;
        description = line;
        break;
    }
    if (description.length > AGENT_DOC_DESCRIPTION_MAX) {
        description = description.slice(0, AGENT_DOC_DESCRIPTION_MAX - 1).trimEnd() + '\u2026';
    }
    return { title, description };
}
/**
 * The server ships the agent-facing docs for the API this build serves, so an
 * agent in a mixed-version fleet reads the running host's docs.
 */
function createAgentDocHandlers(docsDirectory) {
    const list = (_req, res) => {
        let files;
        try {
            files = fs.readdirSync(docsDirectory).filter((file) => file.endsWith('.md')).sort();
        }
        catch {
            return res.json({ topics: [] });
        }
        const topics = [];
        for (const file of files) {
            const name = file.slice(0, -'.md'.length);
            if (!AGENT_DOC_TOPIC_RE.test(name))
                continue;
            try {
                topics.push({ name, ...agentDocSummary(fs.readFileSync(path.join(docsDirectory, file), 'utf-8')) });
            }
            catch { }
        }
        res.json({ topics });
    };
    const topic = (req, res) => {
        const name = req.params.topic;
        // The shape gate is also the path-traversal gate.
        if (!AGENT_DOC_TOPIC_RE.test(name))
            return res.status(404).json({ error: 'Unknown docs topic' });
        let markdown;
        try {
            markdown = fs.readFileSync(path.join(docsDirectory, `${name}.md`), 'utf-8');
        }
        catch {
            return res.status(404).json({ error: 'Unknown docs topic' });
        }
        res.type('text/markdown; charset=utf-8').send(markdown);
    };
    return { list, topic };
}
/**
 * The two built-in themes (defined in style.css) plus user token files under
 * ~/.pi/dish/themes/*.json. Unreadable or malformed files are skipped: a broken
 * theme file must not take down the picker. Re-read per call so edits show.
 */
const themesHandler = (_req, res) => {
    const themes = [
        { id: 'solarized', builtin: true }, { id: 'graphite', builtin: true },
    ];
    try {
        const directory = path.join((0, dish_store_1.dishDir)(), 'themes');
        for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort()) {
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf-8'));
                const tokens = {};
                for (const [key, value] of Object.entries((0, wire_protocol_1.isRecord)(raw) ? raw : {})) {
                    if (/^--[a-z][a-z0-9-]*$/.test(key) && typeof value === 'string' && /^[#a-zA-Z0-9(),.%\s-]+$/.test(value)) {
                        tokens[key] = value;
                    }
                }
                const id = file.replace(/\.json$/, '');
                if (Object.keys(tokens).length && !themes.some((theme) => theme.id === id))
                    themes.push({ id, tokens });
            }
            catch { }
        }
    }
    catch { }
    res.json({ themes });
};
exports.themesHandler = themesHandler;
