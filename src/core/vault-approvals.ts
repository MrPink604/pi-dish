/**
 * Vault approvals: the operator approves each Bitwarden item an agent asks
 * for, from pi-dish. The vault itself lives in `pi-dish-vault-listener`, an
 * Agent Access listener on this host that holds the unlocked `bw` session.
 * For every credential request it registers a pending request here over a
 * loopback-only bridge and polls for the operator's decision; pi-dish only
 * records decisions and never sees a secret value.
 *
 * State is in memory on purpose: a restart forgets pending requests (the
 * listener then sees 404 and denies) and every time-boxed grant.
 *
 * The bridge is authenticated by a token file the listener reads
 * (`~/.pi/dish/vault/bridge.token`) and refuses any non-loopback peer, so
 * neither the tunnel, the tailnet nor the fleet proxy can reach it. The model
 * is cooperative: an agent running as this UID could read the token, as it
 * could any other local credential. See TASKS/vault-approvals.md.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import dishStore = require('./dish-store');
import type { NextFunction, Request, Response } from 'express';
import type { PushPayload } from './push-notifications';

export const VAULT_FIELDS = ['username', 'password', 'totp', 'uri', 'notes'] as const;
/** A built-in field, or `field:<name>` for a custom (text or hidden) field of the item. */
export type VaultField = typeof VAULT_FIELDS[number] | `field:${string}`;
const CUSTOM_FIELD_RE = /^field:[^\u0000-\u001f\u007f]{1,128}$/;
export const BRIDGE_HEADER = 'x-pi-dish-vault-bridge';
export const GRANT_WINDOW_MS = 15 * 60 * 1000;
export const LISTENER_STALE_MS = 45 * 1000;
export const MAX_REQUEST_LIFETIME_MS = 10 * 60 * 1000;
export const RECENT_LIMIT = 20;
const PUSH_BODY_CHARS = 180;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const FINGERPRINT_RE = /^[0-9a-fA-F]{8,128}$/;

export interface VaultDevice { readonly name: string; readonly fingerprint: string }
export interface VaultSessionClaim { readonly ref: string; readonly name: string | null; readonly host: string | null }
export type VaultRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type VaultDecision = 'approve' | 'approve-window' | 'deny';

export interface VaultRequest {
  readonly id: string;
  readonly device: VaultDevice;
  readonly item: string;
  readonly fields: readonly VaultField[];
  /** Requester-claimed; shown as such. */
  readonly reason: string | null;
  /** Requester-claimed; shown as such. */
  readonly session: VaultSessionClaim | null;
  readonly createdAt: number;
  readonly expiresAt: number;
  status: VaultRequestStatus;
  decidedAt: number | null;
  /** Approved by a grant rather than a decision. */
  auto: boolean;
  grantId: string | null;
}

export interface VaultGrant {
  readonly id: string;
  readonly device: VaultDevice;
  readonly item: string;
  readonly fields: readonly VaultField[];
  readonly sessionRef: string | null;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface VaultListenerStatus {
  readonly state: 'locked' | 'ready';
  readonly account: string | null;
  readonly devices: readonly VaultDevice[];
  readonly updatedAt: number;
}

export interface VaultOverview {
  readonly listener: (VaultListenerStatus & { readonly stale: boolean }) | null;
  readonly pending: readonly VaultRequest[];
  readonly recent: readonly VaultRequest[];
  readonly grants: readonly VaultGrant[];
}

type Failure = { readonly ok: false; readonly status: 400 | 404 | 409; readonly error: string };
type Result<T> = { readonly ok: true; readonly value: T } | Failure;

export interface VaultApprovalPorts {
  /** Called once when a request becomes pending (never for grant auto-approvals). */
  notify(request: VaultRequest): void;
  now?(): number;
}

export interface VaultApprovals {
  overview(): VaultOverview;
  reportStatus(body: unknown): Result<VaultListenerStatus>;
  createRequest(body: unknown): Result<VaultRequest>;
  requestStatus(id: string): Result<VaultRequest>;
  abandon(id: string): Result<VaultRequest>;
  decide(id: string, decision: unknown): Result<VaultRequest>;
  revokeGrant(id: string): Result<VaultGrant>;
}

function fail(status: Failure['status'], error: string): Failure { return { ok: false, status, error }; }

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return boundedString(value, max) ?? undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function decodeDevice(value: unknown): VaultDevice | null {
  const device = record(value);
  const name = boundedString(device?.name, 64);
  const fingerprint = typeof device?.fingerprint === 'string' && FINGERPRINT_RE.test(device.fingerprint) ? device.fingerprint.toLowerCase() : null;
  return name && fingerprint ? { name, fingerprint } : null;
}

/** Unique field names: built-ins in canonical order, then custom fields as requested; null when empty or invalid. */
export function decodeFields(value: unknown): VaultField[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const wanted = new Set<unknown>(value);
  if (wanted.size !== value.length) return null;
  const custom: VaultField[] = [];
  for (const field of wanted) {
    if (VAULT_FIELDS.includes(field as typeof VAULT_FIELDS[number])) continue;
    if (typeof field !== 'string' || !CUSTOM_FIELD_RE.test(field)) return null;
    custom.push(field as `field:${string}`);
  }
  return [...VAULT_FIELDS.filter(field => wanted.has(field)), ...custom];
}

function decodeSession(value: unknown): VaultSessionClaim | null | undefined {
  if (value === undefined || value === null) return null;
  const session = record(value);
  const ref = boundedString(session?.ref, 200);
  const name = optionalString(session?.name, 200);
  const host = optionalString(session?.host, 100);
  if (!ref || name === undefined || host === undefined) return undefined;
  return { ref, name, host };
}

/** Notification for a pending request; the reason is the agent's claim, so it follows the facts. */
export function vaultPushPayload(request: VaultRequest): Omit<PushPayload, 'hostId'> {
  const who = request.session?.name || request.session?.ref;
  const lead = who ? `${who} on ${request.device.name}` : request.device.name;
  let body = `${lead} wants ${request.item} (${request.fields.join(', ')})`;
  if (request.reason) body += ` — ${request.reason}`;
  if (body.length > PUSH_BODY_CHARS) body = `${body.slice(0, PUSH_BODY_CHARS - 1)}…`;
  return { kind: 'vault', title: 'Vault request', body, sessionId: null, tag: `vault:${request.id}`, vaultRequestId: request.id };
}

export function createVaultApprovals(ports: VaultApprovalPorts): VaultApprovals {
  const now = ports.now || Date.now;
  const requests = new Map<string, VaultRequest>();
  const grants = new Map<string, VaultGrant>();
  let listener: VaultListenerStatus | null = null;

  function settle(request: VaultRequest, status: Exclude<VaultRequestStatus, 'pending'>, at: number): void {
    request.status = status;
    request.decidedAt = at;
  }

  /** Expires overdue requests and grants, and trims decided history. */
  function sweep(): void {
    const at = now();
    for (const request of requests.values()) {
      if (request.status === 'pending' && request.expiresAt <= at) settle(request, 'expired', at);
    }
    for (const grant of grants.values()) if (grant.expiresAt <= at) grants.delete(grant.id);
    const decided = [...requests.values()].filter(request => request.status !== 'pending')
      .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
    for (const stale of decided.slice(RECENT_LIMIT)) requests.delete(stale.id);
  }

  function find(id: string): Result<VaultRequest> {
    sweep();
    const request = requests.get(id);
    return request ? { ok: true, value: request } : fail(404, 'Unknown vault request');
  }

  return {
    overview() {
      sweep();
      const all = [...requests.values()];
      return {
        listener: listener ? { ...listener, stale: now() - listener.updatedAt > LISTENER_STALE_MS } : null,
        pending: all.filter(request => request.status === 'pending').sort((a, b) => a.createdAt - b.createdAt),
        recent: all.filter(request => request.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)),
        grants: [...grants.values()].sort((a, b) => a.expiresAt - b.expiresAt),
      };
    },

    reportStatus(body) {
      const status = record(body);
      const state = status?.state;
      if (state !== 'locked' && state !== 'ready') return fail(400, "state must be 'locked' or 'ready'");
      const account = optionalString(status?.account, 200);
      if (account === undefined) return fail(400, 'account must be a short string');
      const rawDevices = status?.devices ?? [];
      if (!Array.isArray(rawDevices) || rawDevices.length > 64) return fail(400, 'devices must be a list');
      const devices = rawDevices.map(decodeDevice);
      if (devices.some(device => !device)) return fail(400, 'each device needs a name and a hex fingerprint');
      listener = { state, account, devices: devices as VaultDevice[], updatedAt: now() };
      return { ok: true, value: listener };
    },

    createRequest(body) {
      sweep();
      const input = record(body);
      const id = typeof input?.id === 'string' && ID_RE.test(input.id) ? input.id : null;
      if (!id) return fail(400, 'id must be 8-64 letters, digits or dashes');
      if (requests.has(id)) return fail(409, 'Duplicate vault request id');
      const device = decodeDevice(input?.device);
      if (!device) return fail(400, 'device needs a name and a hex fingerprint');
      const item = boundedString(input?.item, 256);
      if (!item) return fail(400, 'item is required');
      const fields = decodeFields(input?.fields);
      if (!fields) return fail(400, `fields must be distinct values from: ${VAULT_FIELDS.join(', ')}, field:<name>`);
      const reason = optionalString(input?.reason, 500);
      if (reason === undefined) return fail(400, 'reason must be at most 500 characters');
      const session = decodeSession(input?.session);
      if (session === undefined) return fail(400, 'session needs a ref (name and host optional)');
      const at = now();
      const expiresAt = typeof input?.expiresAt === 'number' && Number.isFinite(input.expiresAt) ? input.expiresAt : NaN;
      if (!(expiresAt > at)) return fail(400, 'expiresAt must be a future epoch-millisecond time');
      const request: VaultRequest = {
        id, device, item, fields, reason, session,
        createdAt: at, expiresAt: Math.min(expiresAt, at + MAX_REQUEST_LIFETIME_MS),
        status: 'pending', decidedAt: null, auto: false, grantId: null,
      };
      requests.set(id, request);
      // A grant covers the same device, item, field set and claimed session.
      const grant = [...grants.values()].find(candidate => candidate.device.fingerprint === device.fingerprint
        && candidate.item === item && candidate.fields.join(',') === fields.join(',')
        && candidate.sessionRef === (session?.ref ?? null));
      if (grant) {
        settle(request, 'approved', at);
        request.auto = true;
        request.grantId = grant.id;
      } else {
        ports.notify(request);
      }
      return { ok: true, value: request };
    },

    requestStatus: find,

    abandon(id) {
      const found = find(id);
      if (found.ok && found.value.status === 'pending') settle(found.value, 'expired', now());
      return found;
    },

    decide(id, decision) {
      if (decision !== 'approve' && decision !== 'approve-window' && decision !== 'deny') {
        return fail(400, "decision must be 'approve', 'approve-window' or 'deny'");
      }
      const found = find(id);
      if (!found.ok) return found;
      const request = found.value;
      if (request.status !== 'pending') return fail(409, `This request is already ${request.status}`);
      const at = now();
      settle(request, decision === 'deny' ? 'denied' : 'approved', at);
      if (decision === 'approve-window') {
        const grant: VaultGrant = {
          id: crypto.randomUUID(), device: request.device, item: request.item, fields: request.fields,
          sessionRef: request.session?.ref ?? null, createdAt: at, expiresAt: at + GRANT_WINDOW_MS,
        };
        grants.set(grant.id, grant);
        request.grantId = grant.id;
      }
      return { ok: true, value: request };
    },

    revokeGrant(id) {
      sweep();
      const grant = grants.get(id);
      if (!grant) return fail(404, 'Unknown vault grant');
      grants.delete(id);
      return { ok: true, value: grant };
    },
  };
}

/** The listener's bridge credential, created 0600 on first use (exclusive, so racing first uses agree). */
export function readBridgeToken(): string {
  const file = path.join(dishStore.dishDir(), 'vault', 'bridge.token');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, `${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

const LOOPBACK: Record<string, true> = { '127.0.0.1': true, '::1': true, '::ffff:127.0.0.1': true };

type VaultHandler = (req: Request<{ id: string }>, res: Response) => void;

export interface VaultHandlers {
  /** Loopback peer and bridge token, ahead of every bridge route. */
  bridgeGate(req: Request, res: Response, next: NextFunction): void;
  bridgeStatus: VaultHandler;
  bridgeCreate: VaultHandler;
  bridgeGet: VaultHandler;
  bridgeAbandon: VaultHandler;
  overview: VaultHandler;
  decide: VaultHandler;
  revokeGrant: VaultHandler;
}

export function createVaultHandlers(vault: VaultApprovals, token: () => string = readBridgeToken): VaultHandlers {
  function reply<T>(res: Response, result: Result<T>, send: (value: T) => void): void {
    if (result.ok) send(result.value);
    else res.status(result.status).json({ error: result.error });
  }
  return {
    bridgeGate(req, res, next) {
      const given = Buffer.from(req.get(BRIDGE_HEADER) || '');
      const expected = Buffer.from(token());
      const tokenOk = given.length === expected.length && crypto.timingSafeEqual(given, expected);
      if (LOOPBACK[req.socket.remoteAddress || ''] !== true || !tokenOk) {
        res.status(403).json({ error: 'The vault bridge accepts only the local listener' });
        return;
      }
      next();
    },
    bridgeStatus: (req, res) => reply(res, vault.reportStatus(req.body), () => res.status(204).end()),
    bridgeCreate: (req, res) => reply(res, vault.createRequest(req.body), request => res.status(201).json({ status: request.status })),
    bridgeGet: (req, res) => reply(res, vault.requestStatus(req.params.id), request => res.json({ status: request.status })),
    bridgeAbandon: (req, res) => reply(res, vault.abandon(req.params.id), () => res.status(204).end()),
    overview: (_req, res) => { res.json(vault.overview()); },
    decide: (req, res) => reply(res, vault.decide(req.params.id, record(req.body)?.decision), request => res.json({ request })),
    revokeGrant: (req, res) => reply(res, vault.revokeGrant(req.params.id), () => res.status(204).end()),
  };
}
