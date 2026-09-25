import compression = require('compression');
import express = require('express');
import crypto = require('crypto');
import fs = require('fs');
import os = require('os');
import path = require('path');
import type { IncomingMessage } from 'http';
import type { ParsedQs } from 'qs';
import hostIdentity = require('./host-identity');
import * as terminal from './terminal';
import * as tmux from './tmux';

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
}

export interface AccessHandlers {
  compression: TransportHandler;
  jsonBody: TransportHandler;
  cors: TransportHandler;
  apiGate: TransportHandler;
  hostsGate: TransportHandler;
  host: TransportHandler;
  ticket: TransportHandler;
  hostDescriptor(): HostDescriptor;
  upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
}

const STREAM_PATH_RE = /^\/sessions\/[^/]+\/stream\/?$/;
const HOST_PATH_RE = /^\/host\/?$/;
const PROXY_STREAM_PATH_RE = /^\/[^/]+\/api\/sessions\/[^/]+\/stream\/?$/;
const TICKET_TTL_MS = 60_000;
type TicketPurpose = 'stream' | 'terminal';

function readAuthToken(): string | null {
  const fromEnv = (process.env.PI_DISH_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = fs.readFileSync(path.join(os.homedir(), '.pi', 'dish', 'token'), 'utf8').trim();
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
      refAliases: true, cacheLifetimes: true,
    };
    if (terminal.isTerminalEnabled()) capabilities.terminal = true;
    if (tmux.isTmuxAvailable()) capabilities.tmux = true;
    if (ports.sttAvailable()) capabilities.stt = true;
    if (ports.usageLimitsAvailable()) capabilities.usageLimits = true;
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
      const type = String(res.getHeader('Content-Type') || '');
      if (type.startsWith('text/event-stream')) return false;
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
    const origin = req.headers.origin;
    if (origin && allowedOrigins().includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    }
    next();
  };
  const apiGate: TransportHandler = (req, res, next) => {
    if (!authToken) return next();
    if (req.method === 'OPTIONS') return next();
    if (HOST_PATH_RE.test(req.path)) return next();
    if (tokenMatches(bearerToken(req))) return next();
    if (STREAM_PATH_RE.test(req.path) && ticketValid(req.query.ticket, 'stream')) return next();
    res.status(401).json({ error: 'Unauthorized: bearer token required' });
  };
  const hostsGate: TransportHandler = (req, res, next) => {
    if (!authToken) return next();
    if (req.method === 'OPTIONS') return next();
    if (tokenMatches(bearerToken(req))) return next();
    if (PROXY_STREAM_PATH_RE.test(req.path) && ticketValid(req.query.ticket, 'stream')) return next();
    res.status(401).json({ error: 'Unauthorized: bearer token required' });
  };
  const host: TransportHandler = (_req, res) => { res.json(hostDescriptor()); };
  const ticket: TransportHandler = (req, res) => {
    const purpose = req.body && typeof req.body === 'object' && 'purpose' in req.body ? req.body.purpose : undefined;
    if (purpose !== 'stream' && purpose !== 'terminal') {
      res.status(400).json({ error: "purpose must be 'stream' or 'terminal'" }); return;
    }
    if (!authToken) { res.json({ ticket: null }); return; }
    res.json(mintTicket(purpose));
  };
  return { compression: compressed, jsonBody, cors, apiGate, hostsGate, host, ticket, hostDescriptor, upgradeAuthorized };
}
