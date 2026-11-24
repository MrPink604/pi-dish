import compression = require('compression');
import express = require('express');
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import type { IncomingMessage } from 'http';
import type { ParsedQs } from 'qs';
import { dishDir } from './dish-store';
import hostIdentity = require('./host-identity');
import * as terminal from './terminal';
import * as tmux from './tmux';
import { PRIVATE_UNLOCK_HEADER } from './private-access';
import { FORM_CLIENT_HEADER, PAGE_FORMS_CAPABILITY } from './page-forms';
import { REVIEWS_CAPABILITY } from './reviews';

export type TransportRequest = express.Request<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
export type TransportResponse = express.Response<unknown, Record<string, unknown>>;
export type TransportHandler = express.RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;

export interface HostDescriptor {
  hostId: string;
  label: string;
  version: string;
  capabilities: Record<string, true>;
}

export interface AccessPorts {
  readonly version: string;
  readDishSettings(): Record<string, unknown>;
  sttAvailable(): boolean;
  usageLimitsAvailable(): boolean;
  /** True where the bot registry opens (this Node has node:sqlite). */
  botsAvailable(): boolean;
  /** True where `knowledgeRemote` is set: this host serves the knowledge base. */
  knowledgeAvailable(): boolean;
}

export interface AccessHandlers {
  compression: TransportHandler;
  jsonBody: TransportHandler;
  cors: TransportHandler;
  pageCommentTransport: TransportHandler;
  sameOriginOnly: TransportHandler;
  apiGate: TransportHandler;
  hostsGate: TransportHandler;
  host: TransportHandler;
  ticket: TransportHandler;
  hostDescriptor(): HostDescriptor;
  upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
}

const STREAM_PATH_RE = /^\/sessions\/[^/]+\/stream\/?$/;
const PROBE_PATH_RE = /^\/(?:host|ready)\/?$/;
const PROXY_STREAM_PATH_RE = /^\/[^/]+\/api\/sessions\/[^/]+\/stream\/?$/;
const TICKET_TTL_MS = 60_000;
type TicketPurpose = 'stream' | 'terminal';

/**
 * PI_DISH_PUBLIC_ORIGINS: comma-separated bare http(s) origins. Anything
 * else (a path, query, credentials, another scheme, an unparsable value) is
 * skipped with a warning rather than widened into something it does not name.
 */
export function parsePublicOrigins(value: string, warn: (message: string) => void): Set<string> {
  const origins = new Set<string>();
  for (const raw of value.split(',').map(entry => entry.trim()).filter(Boolean)) {
    let url: URL;
    try { url = new URL(raw); } catch { warn(`PI_DISH_PUBLIC_ORIGINS: ignoring "${raw}", not a URL`); continue; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      warn(`PI_DISH_PUBLIC_ORIGINS: ignoring "${raw}", only http and https origins are allowed`);
    } else if (url.username || url.password) {
      warn(`PI_DISH_PUBLIC_ORIGINS: ignoring "${raw}", an origin carries no credentials`);
    } else if (url.pathname !== '/' || url.search || url.hash) {
      warn(`PI_DISH_PUBLIC_ORIGINS: ignoring "${raw}", an origin has no path, query or fragment`);
    } else {
      origins.add(url.origin);
    }
  }
  return origins;
}

function readAuthToken(): string | null {
  const fromEnv = (process.env.PI_DISH_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = fs.readFileSync(path.join(dishDir(), 'token'), 'utf8').trim();
    if (fromFile) return fromFile;
  } catch {}
  return null;
}

/** One startup-scoped auth owner; public listeners deliberately do not mount it. */
export function createAccessHandlers(ports: AccessPorts): AccessHandlers {
  const authToken = readAuthToken();
  // Compare fixed-size digests: differing token lengths must not leak.
  const digest = authToken ? crypto.createHash('sha256').update(authToken).digest() : null;
  const tickets = new Map<string, { purpose: TicketPurpose; expiresAt: number }>();

  function tokenMatches(candidate: unknown): boolean {
    if (!digest || typeof candidate !== 'string' || !candidate) return false;
    return crypto.timingSafeEqual(crypto.createHash('sha256').update(candidate).digest(), digest);
  }

  function bearerToken(req: IncomingMessage): string | null {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    return match ? match[1].trim() : null;
  }

  function mintTicket(purpose: TicketPurpose): { ticket: string; expiresAt: number } {
    const ticket = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + TICKET_TTL_MS;
    tickets.set(ticket, { purpose, expiresAt });
    return { ticket, expiresAt };
  }

  function ticketValid(ticket: unknown, purpose: TicketPurpose): boolean {
    if (typeof ticket !== 'string' || !ticket) return false;
    const entry = tickets.get(ticket);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) { tickets.delete(ticket); return false; }
    return entry.purpose === purpose;
  }

  // Tickets are deliberately multi-use for EventSource reconnects within the TTL.
  const ticketSweeper = setInterval(() => {
    const now = Date.now();
    for (const [ticket, entry] of tickets) if (entry.expiresAt <= now) tickets.delete(ticket);
  }, TICKET_TTL_MS);
  ticketSweeper.unref();

  function allowedOrigins(): string[] {
    const value = ports.readDishSettings().allowedOrigins;
    return Array.isArray(value) ? value.filter((origin): origin is string => typeof origin === 'string' && !!origin) : [];
  }

  function upgradeAuthorized(req: IncomingMessage, url: URL): boolean {
    if (!authToken) return true;
    if (!tokenMatches(bearerToken(req)) && !ticketValid(url.searchParams.get('ticket'), 'terminal')) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = req.headers.host || '';
    if (origin === `http://${host}` || origin === `https://${host}`) return true;
    return allowedOrigins().includes(origin);
  }

  function hostDescriptor(): HostDescriptor {
    const hostId = hostIdentity.getHostId();
    const label = hostIdentity.getHostLabel(ports.readDishSettings());
    // Absent means unsupported; these are observations, never process authority.
    const capabilities: Record<string, true> = {
      sessions: true, search: true, usage: true, spawns: true,
      shares: true, pages: true, comments: true, skills: true, harnesses: true,
      resolve: true, docs: true, routines: true, recovery: true, sessionBounces: true,
      refAliases: true, cacheLifetimes: true, hostHealth: true, push: true, privateUnlock: true,
      // The page-form protocol (owner view, receipts, fingerprints); bump the name on a breaking change.
      [PAGE_FORMS_CAPABILITY]: true,
      // Review decks under /api/sessions/:id/reviews (src/core/reviews.ts).
      [REVIEWS_CAPABILITY]: true,
    };
    if (terminal.isTerminalEnabled()) capabilities.terminal = true;
    if (tmux.isTmuxAvailable()) capabilities.tmux = true;
    if (ports.sttAvailable()) capabilities.stt = true;
    if (ports.usageLimitsAvailable()) capabilities.usageLimits = true;
    if (ports.botsAvailable()) capabilities.bots = true;
    if (ports.knowledgeAvailable()) capabilities.knowledge = true;
    return {
      hostId,
      label,
      version: ports.version,
      capabilities,
    };
  }

  const compressed: TransportHandler = compression({
    threshold: 1024,
    filter(req, res) {
      if (req.path.endsWith('/stream')) return false;
      if (req.path.startsWith('/hosts/')) return false;
      if (req.headers.range || res.statusCode === 206) return false;
      const type = String(res.getHeader('Content-Type') || '');
      if (type.startsWith('text/event-stream') || type.startsWith('video/')) return false;
      return compression.filter(req, res);
    },
  });
  const parseJsonBody = express.json({ limit: '30mb' });
  const jsonBody: TransportHandler = (req, res, next) => {
    if (req.path.startsWith('/hosts/')) return next();
    parseJsonBody(req, res, next);
  };
  const cors: TransportHandler = (req, res, next) => {
    // Never expose unauthenticated agent controls to another browser origin.
    if (!authToken) return next();
    // Page forms answer pi-dish's own pages only, never an allowed other origin.
    if (/^\/api\/page-forms(?:\/|$)/i.test(req.path)) return next();
    const origin = req.headers.origin;
    if (origin && allowedOrigins().includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Headers', `Authorization, Content-Type, Range, If-Range, ${PRIVATE_UNLOCK_HEADER}`);
      res.header('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length');
      res.header('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    }
    next();
  };
  // Sandboxed published pages have an opaque origin (`Origin: null`). Behind an
  // auth proxy their calls need its cookie and must never be preflighted (the
  // proxy answers cookieless OPTIONS with a login redirect), so the overlay sends
  // only safelisted GETs and text/plain POSTs, parsed here as JSON. Only the
  // page-token-scoped comment routes answer `null`; no other API is readable.
  const parsePlainJson = express.json({ type: 'text/plain', limit: '1mb' });
  const pageCommentTransport: TransportHandler = (req, res, next) => {
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
  const sameOriginOnly: TransportHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    const client = req.headers[FORM_CLIENT_HEADER];
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
      res.status(415).json({ error: 'expected application/json' }); return;
    }
    next();
  };
  function ownOrigin(origin: string, req: IncomingMessage): boolean {
    if (publicOrigins.has(origin)) return true;
    const scheme = 'encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http';
    try { return new URL(`${scheme}://${req.headers.host}`).origin === origin; } catch { return false; }
  }

  function tokenGate(exempt: (req: TransportRequest) => boolean): TransportHandler {
    return (req, res, next) => {
      if (!authToken || req.method === 'OPTIONS' || exempt(req) || tokenMatches(bearerToken(req))) return next();
      res.status(401).json({ error: 'Unauthorized: bearer token required' });
    };
  }
  const apiGate = tokenGate(req => PROBE_PATH_RE.test(req.path)
    || (STREAM_PATH_RE.test(req.path) && ticketValid(req.query.ticket, 'stream')));
  const hostsGate = tokenGate(req => PROXY_STREAM_PATH_RE.test(req.path) && ticketValid(req.query.ticket, 'stream'));
  const host: TransportHandler = (_req, res) => { res.json(hostDescriptor()); };
  const ticket: TransportHandler = (req, res) => {
    const purpose = req.body && typeof req.body === 'object' && 'purpose' in req.body ? req.body.purpose : undefined;
    if (purpose !== 'stream' && purpose !== 'terminal') {
      res.status(400).json({ error: "purpose must be 'stream' or 'terminal'" }); return;
    }
    if (!authToken) { res.json({ ticket: null }); return; }
    res.json(mintTicket(purpose));
  };
  return { compression: compressed, jsonBody, cors, pageCommentTransport, sameOriginOnly, apiGate, hostsGate, host, ticket, hostDescriptor, upgradeAuthorized };
}
