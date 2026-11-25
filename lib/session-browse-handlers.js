// Generated from src/core/session-browse-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCatalogBounds = parseCatalogBounds;
exports.boundCatalog = boundCatalog;
exports.createSessionBrowseHandlers = createSessionBrowseHandlers;
const path = require("path");
const http_boundary_1 = require("./http-boundary");
const host_health_1 = require("./host-health");
const helper_query_js_1 = require("./helper-query.js");
const helper_refs_js_1 = require("./helper-refs.js");
const session_source_1 = require("./session-source");
const session_index_1 = require("./session-index");
const session_api_1 = require("./session-api");
const session_catalog_runtime_1 = require("./session-catalog-runtime");
const session_catalog_1 = require("./session-catalog");
const SEARCH_RESULT_CAP = 100;
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
function parseCatalogBounds(limit, fields) {
    let rowLimit = null;
    if (limit !== undefined) {
        if (typeof limit !== 'string' || !/^[1-9]\d{0,5}$/.test(limit))
            return { error: 'limit must be a positive integer' };
        rowLimit = Number(limit);
    }
    let names = null;
    if (fields !== undefined) {
        names = typeof fields === 'string' ? fields.split(',').map(name => name.trim()).filter(Boolean) : [];
        if (!names.length || names.length > 64 || !names.every(name => FIELD_NAME_RE.test(name))) {
            return { error: 'fields must be a comma-separated list of field names' };
        }
    }
    return { limit: rowLimit, fields: names };
}
/**
 * Apply `limit` across active, children, then previous — the order a caller
 * reads them — and keep only `fields` (plus `id`) of each row. A limited
 * response reports the unlimited row count as `total`.
 */
function boundCatalog(groups, bounds) {
    const project = (row) => {
        if (!bounds.fields)
            return row;
        const source = row;
        const picked = { id: source.id };
        for (const name of bounds.fields)
            if (Object.hasOwn(source, name))
                picked[name] = source[name];
        return picked;
    };
    if (bounds.limit === null) {
        if (!bounds.fields)
            return groups;
        return { active: groups.active.map(project), previous: groups.previous.map(project), children: groups.children.map(project) };
    }
    let left = bounds.limit;
    const take = (rows) => {
        const kept = rows.slice(0, left);
        left -= kept.length;
        return kept.map(project);
    };
    const active = take(groups.active), children = take(groups.children), previous = take(groups.previous);
    return { active, previous, children, total: groups.active.length + groups.children.length + groups.previous.length };
}
function createSessionBrowseHandlers(ports) {
    const { catalog: runtime } = ports;
    const hostHealth = (0, host_health_1.createHostHealth)();
    const list = async (req, res) => {
        const bounds = parseCatalogBounds(req.query.limit, req.query.fields);
        if ('error' in bounds)
            return void res.status(400).json({ error: bounds.error });
        const query = (req.query.q || '').trim().toLowerCase();
        await runtime.refreshPrimeRoster();
        const catalog = runtime.buildSessionCatalog({ activeOnly: req.query.active === '1', includePrivate: ports.privateUnlocked(req) });
        const active = ports.cuOwnerId || ports.cuWaitingForDesktop
            ? catalog.active.map(session => {
                const cuOwnerId = ports.cuOwnerId?.(session.id) ?? null;
                const cuWaitingForDesktop = ports.cuWaitingForDesktop?.(session.id) === true;
                if (!cuOwnerId && !cuWaitingForDesktop)
                    return session;
                return {
                    ...session,
                    ...(cuOwnerId ? { cuOwnerId } : {}),
                    ...(cuWaitingForDesktop ? { cuWaitingForDesktop: true } : {}),
                };
            })
            : catalog.active;
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
        const groups = { active: projection(active), previous: projection(previous), children: projection(catalog.children) };
        res.json({
            ...boundCatalog(groups, bounds),
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
    /**
     * Resolve against ONE catalog + discovery snapshot (zero per-ref root walks,
     * zero synchronous getSessionInfo for budget-deferred sessions).
     */
    function createCatalogResolver(catalog) {
        const pool = [
            ...catalog.list.map(session => ({ id: session.id, session })),
            ...catalog.deferred.map(candidate => ({ id: candidate.routeId, candidate })),
        ];
        let deferredByPath = null;
        const materialized = new Map();
        // Shorten against ALL discovered IDs (indexed + deferred) whenever discovery
        // is complete; fall back to full routes only when discovery was truncated.
        const peerIds = pool.map(entry => entry.id);
        const canShorten = !catalog.discoveryTruncated;
        const materialize = (entry) => {
            if (entry.session)
                return entry.session;
            const existing = materialized.get(entry.id);
            if (existing)
                return existing;
            const candidate = entry.candidate;
            const row = (0, session_catalog_1.buildSourceSession)(candidate, (0, session_catalog_runtime_1.lightweightSessionInfo)(candidate), (0, session_catalog_runtime_1.historicalAdvice)(candidate), runtime.options);
            if (row.parentSession && row.sessionFile) {
                const parentFile = path.isAbsolute(row.parentSession)
                    ? row.parentSession : path.resolve(path.dirname(row.sessionFile), row.parentSession);
                const canonical = (0, session_catalog_runtime_1.canonicalSessionPath)(parentFile) || '';
                const parent = catalog.byPath.get(canonical);
                let parentId = parent ? parent.id : null;
                if (!parentId && canonical && catalog.deferred.length) {
                    if (!deferredByPath) {
                        deferredByPath = new Map();
                        for (const item of catalog.deferred) {
                            const p = (0, session_catalog_runtime_1.canonicalSessionPath)(item.file);
                            if (p)
                                deferredByPath.set(p, item);
                        }
                    }
                    parentId = deferredByPath.get(canonical)?.routeId || null;
                }
                if (parentId && parentId !== row.id) {
                    row.parentId = parentId;
                    row.parentSource = row.parentSessionSource || 'pi-session-header';
                    row.familyParentId = parentId;
                }
            }
            materialized.set(entry.id, row);
            return row;
        };
        const resolveOne = (ref) => {
            const { session, matches } = (0, helper_refs_js_1.resolveSessionRefAmong)(pool, ref);
            return {
                session: session ? materialize(session) : null,
                matches,
                materialize,
            };
        };
        const refFor = (sessionId) => (canShorten ? (0, helper_refs_js_1.stableSessionRef)(sessionId, peerIds) : sessionId);
        return { resolveOne, refFor };
    }
    const resolve = (req, res) => {
        const ref = String(req.query.id ?? '').trim();
        if (!ref)
            return res.status(400).json({ error: 'id is required' });
        if (ref.length < 4)
            return res.status(400).json({ error: 'id prefix must be at least 4 characters' });
        const includePrivate = ports.privateUnlocked(req);
        const catalog = runtime.buildSessionCatalog({ includePrivate });
        const resolver = createCatalogResolver(catalog);
        const { session, matches, materialize } = resolver.resolveOne(ref);
        if (session) {
            const hibernation = ports.hibernated().get(session.id);
            const resolved = hibernation ? { ...session, hibernation } : session;
            return res.json({ session: resolved, ref: resolver.refFor(session.id) });
        }
        if (matches.length > 1) {
            return res.status(409).json({
                error: 'ambiguous session id prefix',
                matches: matches.slice(0, 10).map((match) => {
                    const item = materialize(match);
                    return {
                        id: item.id,
                        name: item.name,
                        cwd: item.cwd || null,
                        lastActivity: item.lastActivity,
                        isActive: !!item.isActive,
                    };
                }),
            });
        }
        res.status(404).json({ error: 'Session not found' });
    };
    /**
     * Resolve up to 50 refs against one catalog + discovery snapshot, for agent-ref
     * hydration without N catalog scans, N root walks, or N HTTP round-trips.
     */
    const resolveBatch = (req, res) => {
        const raw = req.body && typeof req.body === 'object' && Array.isArray(req.body.ids)
            ? req.body.ids : null;
        if (!raw)
            return res.status(400).json({ error: 'ids array is required' });
        const ids = [];
        const seen = new Set();
        for (const item of raw) {
            if (typeof item !== 'string')
                continue;
            const trimmed = item.trim();
            if (trimmed.length < 4 || trimmed.length > 260 || seen.has(trimmed))
                continue;
            seen.add(trimmed);
            ids.push(trimmed);
            if (ids.length >= 50)
                break;
        }
        if (!ids.length)
            return res.json({ results: {} });
        const includePrivate = ports.privateUnlocked(req);
        const catalog = runtime.buildSessionCatalog({ includePrivate });
        const resolver = createCatalogResolver(catalog);
        const hibernated = ports.hibernated();
        const results = Object.create(null);
        for (const id of ids) {
            const { session, matches } = resolver.resolveOne(id);
            if (session) {
                const hibernation = hibernated.get(session.id);
                const projected = (0, session_api_1.sessionForClient)(hibernation ? { ...session, hibernation } : session);
                results[id] = { status: 'ok', session: projected, ref: resolver.refFor(session.id) };
            }
            else if (matches.length > 1) {
                results[id] = { status: 'ambiguous', count: matches.length };
            }
            else {
                results[id] = { status: 'not_found' };
            }
        }
        res.json({ results });
    };
    // One flat ranked, capped list with snippets and a per-match occurrence count.
    const search = (req, res) => {
        const query = (req.query.q || '').trim().toLowerCase();
        const scopeQuery = String(req.query.scope || '').trim().toLowerCase();
        const { active, previous, indexing, discoveryTruncated, discoverySkipped } = runtime.buildSessionCatalog({ includePrivate: ports.privateUnlocked(req) });
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
    return { list, hostHealth: health, resolve, resolveBatch, search };
}
