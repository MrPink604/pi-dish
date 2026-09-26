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
exports.createAccessHandlers = createAccessHandlers;
const compression = require("compression");
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const hostIdentity = require("./host-identity");
const terminal = __importStar(require("./terminal"));
const tmux = __importStar(require("./tmux"));
const STREAM_PATH_RE = /^\/sessions\/[^/]+\/stream\/?$/;
const HOST_PATH_RE = /^\/host\/?$/;
const PROXY_STREAM_PATH_RE = /^\/[^/]+\/api\/sessions\/[^/]+\/stream\/?$/;
const TICKET_TTL_MS = 60_000;
function readAuthToken() {
    const fromEnv = (process.env.PI_DISH_TOKEN || '').trim();
    if (fromEnv)
        return fromEnv;
    try {
        const fromFile = fs.readFileSync(path.join(os.homedir(), '.pi', 'dish', 'token'), 'utf8').trim();
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
    function upgradeAuthorized(req, url) {
        if (!authToken)
            return true;
        if (!tokenMatches(bearerToken(req)) && !ticketValid(url.searchParams.get('ticket'), 'terminal'))
            return false;
        const origin = req.headers.origin;
        if (!origin)
            return true;
        const host = req.headers.host || '';
        if (origin === `http://${host}` || origin === `https://${host}`)
            return true;
        return allowedOrigins().includes(origin);
    }
    function hostDescriptor() {
        const hostId = hostIdentity.getHostId();
        const label = hostIdentity.getHostLabel(ports.readDishSettings());
        // Absent means unsupported; these are observations, never process authority.
        const capabilities = {
            sessions: true, search: true, usage: true, spawns: true,
            shares: true, pages: true, comments: true, skills: true, harnesses: true,
            resolve: true, docs: true, routines: true, recovery: true, sessionBounces: true,
            refAliases: true, cacheLifetimes: true, hostHealth: true,
        };
        if (terminal.isTerminalEnabled())
            capabilities.terminal = true;
        if (tmux.isTmuxAvailable())
            capabilities.tmux = true;
        if (ports.sttAvailable())
            capabilities.stt = true;
        if (ports.usageLimitsAvailable())
            capabilities.usageLimits = true;
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
            const type = String(res.getHeader('Content-Type') || '');
            if (type.startsWith('text/event-stream'))
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
        const origin = req.headers.origin;
        if (origin && allowedOrigins().includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Vary', 'Origin');
            res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
            res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
            if (req.method === 'OPTIONS') {
                res.status(204).end();
                return;
            }
        }
        next();
    };
    const apiGate = (req, res, next) => {
        if (!authToken)
            return next();
        if (req.method === 'OPTIONS')
            return next();
        if (HOST_PATH_RE.test(req.path))
            return next();
        if (tokenMatches(bearerToken(req)))
            return next();
        if (STREAM_PATH_RE.test(req.path) && ticketValid(req.query.ticket, 'stream'))
            return next();
        res.status(401).json({ error: 'Unauthorized: bearer token required' });
    };
    const hostsGate = (req, res, next) => {
        if (!authToken)
            return next();
        if (req.method === 'OPTIONS')
            return next();
        if (tokenMatches(bearerToken(req)))
            return next();
        if (PROXY_STREAM_PATH_RE.test(req.path) && ticketValid(req.query.ticket, 'stream'))
            return next();
        res.status(401).json({ error: 'Unauthorized: bearer token required' });
    };
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
    return { compression: compressed, jsonBody, cors, apiGate, hostsGate, host, ticket, hostDescriptor, upgradeAuthorized };
}
