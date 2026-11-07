// Generated from src/core/session-browse-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionBrowseHandlers = createSessionBrowseHandlers;
const http_boundary_1 = require("./http-boundary");
const host_health_1 = require("./host-health");
const helper_query_js_1 = require("./helper-query.js");
const helper_refs_js_1 = require("./helper-refs.js");
const session_source_1 = require("./session-source");
const session_index_1 = require("./session-index");
const session_api_1 = require("./session-api");
const SEARCH_RESULT_CAP = 100;
function createSessionBrowseHandlers(ports) {
    const { catalog: runtime } = ports;
    const hostHealth = (0, host_health_1.createHostHealth)();
    const list = async (req, res) => {
        const query = (req.query.q || '').trim().toLowerCase();
        await runtime.refreshPrimeRoster();
        const catalog = runtime.buildSessionCatalog({ activeOnly: req.query.active === '1' });
        const hibernated = ports.hibernated();
        const previous = hibernated.size
            ? catalog.previous.map(session => {
                const state = hibernated.get(session.id);
                return state ? { ...session, hibernation: state } : session;
            })
            : catalog.previous;
        const projection = (rows) => {
            const filtered = query ? runtime.filterSessionsByQuery(rows, query) : rows;
            return req.query.view === 'client' ? filtered.map(session => (0, session_api_1.sessionForClient)(session)) : filtered;
        };
        res.json({
            active: projection(catalog.active),
            previous: projection(previous),
            children: projection(catalog.children),
            indexing: catalog.indexing,
            discoveryTruncated: catalog.discoveryTruncated,
            discoverySkipped: catalog.discoverySkipped,
        });
    };
    const health = async (_req, res) => {
        try {
            const healthSnapshot = await hostHealth.read();
            const { active, children } = runtime.buildSessionCatalog({ activeOnly: true });
            const byHarness = {};
            for (const session of active)
                byHarness[session.harnessId] = (byHarness[session.harnessId] || 0) + 1;
            res.json({
                ...healthSnapshot,
                sessions: {
                    live: active.length,
                    working: active.filter(session => session.turnInProgress).length,
                    waiting: active.filter(session => session.askPending).length,
                    subagents: children.length,
                    byHarness,
                },
            });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    };
    const resolve = (req, res) => {
        const ref = String(req.query.id ?? '').trim();
        if (!ref)
            return res.status(400).json({ error: 'id is required' });
        if (ref.length < 4)
            return res.status(400).json({ error: 'id prefix must be at least 4 characters' });
        const catalog = runtime.buildSessionCatalog();
        const { session, matches } = runtime.resolveRefInCatalog(catalog, ref);
        if (session)
            return res.json({ session, ref: (0, helper_refs_js_1.stableSessionRef)(session.id, catalog.list.map((entry) => entry.id)) });
        if (matches.length > 1) {
            return res.status(409).json({
                error: 'ambiguous session id prefix',
                matches: matches.slice(0, 10).map((match) => ({
                    id: match.id,
                    name: match.name,
                    cwd: match.cwd || null,
                    lastActivity: match.lastActivity,
                    isActive: !!match.isActive,
                })),
            });
        }
        res.status(404).json({ error: 'Session not found' });
    };
    // One flat ranked, capped list with snippets and a per-match occurrence count.
    const search = (req, res) => {
        const query = (req.query.q || '').trim().toLowerCase();
        const scopeQuery = String(req.query.scope || '').trim().toLowerCase();
        const { active, previous, indexing, discoveryTruncated, discoverySkipped } = runtime.buildSessionCatalog();
        const parsed = (0, helper_query_js_1.parseSessionQuery)(query);
        const scopeParsed = (0, helper_query_js_1.parseSessionQuery)(scopeQuery);
        const hasScope = scopeParsed.terms.length || scopeParsed.since !== null || scopeParsed.before !== null;
        // Routine runs are noise in human results unless the query/scope asks for
        // them; filtered before scoring so they never consume the cap.
        const hideAutomation = req.query.hideAutomation === '1'
            && !(0, helper_query_js_1.queryAsksForAutomation)(parsed) && !(hasScope && (0, helper_query_js_1.queryAsksForAutomation)(scopeParsed));
        const contentTokens = (0, helper_query_js_1.positiveQueryTokens)(parsed);
        const ranked = [];
        let hiddenByScopes = 0;
        let hiddenByAutomation = 0;
        for (const session of [...active, ...previous]) {
            if (hideAutomation && !session.isActive && (0, helper_query_js_1.isAutomationSession)(session)) {
                hiddenByAutomation++;
                continue;
            }
            let text = null;
            if (!(0, helper_query_js_1.evaluateSessionQuery)(parsed, session)) {
                if (!contentTokens.length || !session.sessionFile)
                    continue;
                text = (0, session_index_1.getSearchText)((0, session_source_1.sourceForIdentity)(session.harnessId, session.nativeSessionId, session.sessionFile));
                if (!(0, helper_query_js_1.evaluateSessionQuery)(parsed, session, text))
                    continue;
            }
            if (hasScope && !(0, helper_query_js_1.evaluateSessionQuery)(scopeParsed, session)) {
                hiddenByScopes++;
                continue;
            }
            if (contentTokens.length && session.sessionFile) {
                text ??= (0, session_index_1.getSearchText)((0, session_source_1.sourceForIdentity)(session.harnessId, session.nativeSessionId, session.sessionFile));
            }
            ranked.push({ session, text, searchScore: (0, helper_query_js_1.scoreSessionMatch)(parsed, session, text) });
        }
        ranked.sort((a, b) => b.searchScore - a.searchScore
            || new Date(b.session.lastActivity || 0).getTime() - new Date(a.session.lastActivity || 0).getTime());
        const results = ranked.slice(0, SEARCH_RESULT_CAP).map(({ session, text, searchScore }) => {
            let snippets = [], matchCount = 0;
            if (text)
                ({ snippets, count: matchCount } = (0, helper_query_js_1.buildSnippets)(text, contentTokens));
            return { ...session, snippets, matchCount, searchScore };
        });
        res.json({
            results,
            total: ranked.length,
            hiddenByScopes,
            hiddenByAutomation,
            indexing,
            discoveryTruncated,
            discoverySkipped,
        });
    };
    return { list, hostHealth: health, resolve, search };
}
