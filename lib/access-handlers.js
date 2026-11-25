// Generated from src/core/access-handlers.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePublicOrigins = parsePublicOrigins;
exports.createAccessHandlers = createAccessHandlers;
const compression = require("compression");
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dish_store_1 = require("./dish-store");
const hostIdentity = require("./host-identity");
const terminal = __importStar(require("./terminal"));
const tmux = __importStar(require("./tmux"));
const private_access_1 = require("./private-access");
const page_forms_1 = require("./page-forms");
const reviews_1 = require("./reviews");
const STREAM_PATH_RE = /^\/(?:sessions\/[^/]+|cu)\/stream\/?$/;
const PROBE_PATH_RE = /^\/(?:host|ready)\/?$/;
const PROXY_STREAM_PATH_RE = /^\/[^/]+\/api\/(?:sessions\/[^/]+|cu)\/stream\/?$/;
const TICKET_TTL_MS = 60_000;
/**
 * PI_DISH_PUBLIC_ORIGINS: comma-separated bare http(s) origins. Anything
 * else (a path, query, credentials, another scheme, an unparsable value) is
 * skipped with a warning rather than widened into something it does not name.
 */
function parsePublicOrigins(value, warn) {
    const origins = new Set();
    for (const raw of value.split(',').map(entry => entry.trim()).filter(Boolean)) {
        let url;
        try {
            url = new URL(raw);
        }
        catch {
            warn(`PI_DISH_PUBLIC_ORIGINS: ignoring "${raw}", not a URL`);
            continue;
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            warn(`PI_DISH_PUBLIC_ORIGINS: ignoring "${raw}", only http and https origins are allowed`);
        }
        else if (url.username || url.password) {
            warn(`PI_DISH_PUBLIC_ORIGINS: ignoring "${raw}", an origin carries no credentials`);
        }
        else if (url.pathname !== '/' || url.search || url.hash) {
            warn(`PI_DISH_PUBLIC_ORIGINS: ignoring "${raw}", an origin has no path, query or fragment`);
        }
        else {
            origins.add(url.origin);
        }
    }
    return origins;
}
function readAuthToken() {
    const fromEnv = (process.env.PI_DISH_TOKEN || '').trim();
    if (fromEnv)
        return fromEnv;
    try {
        const fromFile = fs.readFileSync(path.join((0, dish_store_1.dishDir)(), 'token'), 'utf8').trim();
        if (fromFile)
            return fromFile;
    }
    catch { }
    return null;
}
/** One startup-scoped auth owner; public listeners deliberately do not mount it. */
function createAccessHandlers(ports) {
    const authToken = readAuthToken();
    // Compare fixed-size digests: differing token lengths must not leak.
    const digest = authToken ? crypto.createHash('sha256').update(authToken).digest() : null;
    const tickets = new Map();
    function tokenMatches(candidate) {
        if (!digest || typeof candidate !== 'string' || !candidate)
            return false;
        return crypto.timingSafeEqual(crypto.createHash('sha256').update(candidate).digest(), digest);
    }
    function bearerToken(req) {
        const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
        return match ? match[1].trim() : null;
    }
    function mintTicket(purpose) {
        const ticket = crypto.randomBytes(24).toString('base64url');
        const expiresAt = Date.now() + TICKET_TTL_MS;
        tickets.set(ticket, { purpose, expiresAt });
        return { ticket, expiresAt };
    }
    function ticketValid(ticket, purpose) {
        if (typeof ticket !== 'string' || !ticket)
            return false;
        const entry = tickets.get(ticket);
        if (!entry)
            return false;
        if (entry.expiresAt <= Date.now()) {
            tickets.delete(ticket);
            return false;
        }
        return entry.purpose === purpose;
    }
    // Tickets are deliberately multi-use for EventSource reconnects within the TTL.
    const ticketSweeper = setInterval(() => {
        const now = Date.now();
        for (const [ticket, entry] of tickets)
            if (entry.expiresAt <= now)
                tickets.delete(ticket);
    }, TICKET_TTL_MS);
    ticketSweeper.unref();
    function allowedOrigins() {
        const value = ports.readDishSettings().allowedOrigins;
        return Array.isArray(value) ? value.filter((origin) => typeof origin === 'string' && !!origin) : [];
    }
    function upgradeOriginAllowed(req) {
        const origin = req.headers.origin;
        if (!origin)
            return true;
        const host = req.headers.host || '';
        if (origin === `http://${host}` || origin === `https://${host}`)
            return true;
        return allowedOrigins().includes(origin);
    }
    function upgradeAuthorized(req, url) {
        if (!authToken)
            return true;
        if (!tokenMatches(bearerToken(req)) && !ticketValid(url.searchParams.get('ticket'), 'terminal'))
            return false;
        return upgradeOriginAllowed(req);
    }
    function bearerUpgradeAuthorized(req) {
        if (!authToken)
            return true;
        if (!tokenMatches(bearerToken(req)))
            return false;
        return upgradeOriginAllowed(req);
    }
    function hostDescriptor() {
        const hostId = hostIdentity.getHostId();
        const label = hostIdentity.getHostLabel(ports.readDishSettings());
        // Absent means unsupported; these are observations, never process authority.
        const capabilities = {
            sessions: true, search: true, usage: true, spawns: true,
            shares: true, pages: true, comments: true, skills: true, harnesses: true,
            resolve: true, docs: true, routines: true, recovery: true, sessionBounces: true,
            refAliases: true, cacheLifetimes: true, hostHealth: true, push: true, privateUnlock: true, ifIdleClose: true,
            // The page-form protocol (owner view, receipts, fingerprints); bump the name on a breaking change.
            [page_forms_1.PAGE_FORMS_CAPABILITY]: true,
            // Review decks under /api/sessions/:id/reviews (src/core/reviews.ts).
            [reviews_1.REVIEWS_CAPABILITY]: true,
        };
        if (terminal.isTerminalEnabled())
            capabilities.terminal = true;
        if (tmux.isTmuxAvailable())
            capabilities.tmux = true;
        if (ports.sttAvailable())
            capabilities.stt = true;
        if (ports.usageLimitsAvailable())
            capabilities.usageLimits = true;
        if (ports.botsAvailable())
            capabilities.bots = true;
        if (ports.knowledgeAvailable())
            capabilities.knowledge = true;
        if (ports.computerUseAvailable?.())
            capabilities.computerUse = true;
        return {
            hostId,
            label,
            version: ports.version,
            capabilities,
        };
    }
    const compressed = compression({
        threshold: 1024,
        filter(req, res) {
            if (req.path.endsWith('/stream'))
                return false;
            if (req.path.startsWith('/hosts/'))
                return false;
            if (req.headers.range || res.statusCode === 206)
                return false;
            const type = String(res.getHeader('Content-Type') || '');
            if (type.startsWith('text/event-stream') || type.startsWith('video/')
                || type.startsWith('model/gltf-binary') || type.startsWith('image/ktx2'))
                return false;
            return compression.filter(req, res);
        },
    });
    const parseJsonBody = express.json({ limit: '30mb' });
    const jsonBody = (req, res, next) => {
        if (req.path.startsWith('/hosts/'))
            return next();
        parseJsonBody(req, res, next);
    };
    const cors = (req, res, next) => {
        // Never expose unauthenticated agent controls to another browser origin.
        if (!authToken)
            return next();
        // Page forms answer pi-dish's own pages only, never an allowed other origin.
        if (/^\/api\/page-forms(?:\/|$)/i.test(req.path))
            return next();
        const origin = req.headers.origin;
        if (origin && allowedOrigins().includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Vary', 'Origin');
            res.header('Access-Control-Allow-Headers', `Authorization, Content-Type, Range, If-Range, ${private_access_1.PRIVATE_UNLOCK_HEADER}, ${reviews_1.REVIEW_CLIENT_HEADER}`);
            res.header('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length');
            res.header('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
            if (req.method === 'OPTIONS') {
                res.status(204).end();
                return;
            }
        }
        next();
    };
    // Sandboxed published pages have an opaque origin (`Origin: null`). Behind an
    // auth proxy their calls need its cookie and must never be preflighted (the
    // proxy answers cookieless OPTIONS with a login redirect), so the overlay sends
    // only safelisted GETs and text/plain POSTs, parsed here as JSON. Only the
    // page-token-scoped comment routes answer `null`; no other API is readable.
    const parsePlainJson = express.json({ type: 'text/plain', limit: '1mb' });
    const pageCommentTransport = (req, res, next) => {
        if (req.headers.origin === 'null') {
            res.header('Access-Control-Allow-Origin', 'null');
            res.header('Access-Control-Allow-Credentials', 'true');
            res.header('Vary', 'Origin');
        }
        parsePlainJson(req, res, next);
    };
    // Owner-only API (page forms): never cached, and no browser request from
    // another origin, or from an opaque one (a sandboxed artifact, a data: or
    // file: page: `Origin: null`), ever passes. Fetch Metadata, when sent, must
    // say same-origin; an Origin, when sent, must equal this request's own
    // origin or one of PI_DISH_PUBLIC_ORIGINS (the addresses an auth proxy
    // serves this host at). A browser always sends Origin with a write, so a
    // write that carries Fetch Metadata without one came through a proxy that
    // strips Origin (an older hub's generic /hosts relay) and is refused. Every
    // caller also names itself in FORM_CLIENT_HEADER (the view, the CLI, a hub's
    // form relay), which a cross-site page cannot add unpreflighted; that covers
    // the same relay on plain HTTP, where browsers send no Fetch Metadata. A
    // write must be JSON.
    const publicOrigins = parsePublicOrigins(process.env.PI_DISH_PUBLIC_ORIGINS || '', message => console.warn(`[pi-dish] ${message}`));
    const sameOriginOnly = (req, res, next) => {
        res.setHeader('Cache-Control', 'private, no-store');
        const site = req.headers['sec-fetch-site'];
        const origin = req.headers.origin;
        const write = req.method !== 'GET' && req.method !== 'HEAD';
        const client = req.headers[page_forms_1.FORM_CLIENT_HEADER];
        const refused = origin === 'null'
            || (client !== 'view' && client !== 'cli' && client !== 'relay')
            || (site !== undefined && site !== 'same-origin')
            || (origin !== undefined && !ownOrigin(origin, req))
            || (write && site !== undefined && origin === undefined);
        if (refused) {
            // A same-origin page whose Origin is not recognized is pi-dish behind a proxy that rewrites the scheme or host.
            const hint = site === 'same-origin' && origin && origin !== 'null'
                ? ` (if pi-dish is served at ${origin}, add that origin to PI_DISH_PUBLIC_ORIGINS)` : '';
            res.status(403).json({ error: `this API answers only pi-dish's own pages${hint}` });
            return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
            res.status(415).json({ error: 'expected application/json' });
            return;
        }
        next();
    };
    function ownOrigin(origin, req) {
        if (publicOrigins.has(origin))
            return true;
        const scheme = 'encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http';
        try {
            return new URL(`${scheme}://${req.headers.host}`).origin === origin;
        }
        catch {
            return false;
        }
    }
    function tokenGate(exempt) {
        return (req, res, next) => {
            if (!authToken || req.method === 'OPTIONS' || exempt(req) || tokenMatches(bearerToken(req)))
                return next();
            res.status(401).json({ error: 'Unauthorized: bearer token required' });
        };
    }
    // Strict bearer check with no probe or OPTIONS exemption, for pre-middleware
    // proxies (such as /api/cu/spaces) that run before app.use('/api', apiGate).
    const requireBearer = (req, res, next) => {
        if (!authToken || tokenMatches(bearerToken(req)))
            return next();
        res.status(401).json({ error: 'Unauthorized: bearer token required' });
    };
    const apiGate = tokenGate(req => PROBE_PATH_RE.test(req.path)
        || (STREAM_PATH_RE.test(req.path) && ticketValid(req.query.ticket, 'stream')));
    const hostsGate = tokenGate(req => PROXY_STREAM_PATH_RE.test(req.path) && ticketValid(req.query.ticket, 'stream'));
    const host = (_req, res) => { res.json(hostDescriptor()); };
    const ticket = (req, res) => {
        const purpose = req.body && typeof req.body === 'object' && 'purpose' in req.body ? req.body.purpose : undefined;
        if (purpose !== 'stream' && purpose !== 'terminal') {
            res.status(400).json({ error: "purpose must be 'stream' or 'terminal'" });
            return;
        }
        if (!authToken) {
            res.json({ ticket: null });
            return;
        }
        res.json(mintTicket(purpose));
    };
    return { compression: compressed, jsonBody, cors, pageCommentTransport, sameOriginOnly, requireBearer, apiGate, hostsGate, host, ticket, hostDescriptor, upgradeAuthorized, bearerUpgradeAuthorized };
}
