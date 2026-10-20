// Generated from src/core/vault-approvals.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECENT_LIMIT = exports.MAX_REQUEST_LIFETIME_MS = exports.LISTENER_STALE_MS = exports.GRANT_WINDOW_MS = exports.BRIDGE_HEADER = exports.VAULT_FIELDS = void 0;
exports.decodeFields = decodeFields;
exports.vaultPushPayload = vaultPushPayload;
exports.createVaultApprovals = createVaultApprovals;
exports.readBridgeToken = readBridgeToken;
exports.createVaultHandlers = createVaultHandlers;
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
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dishStore = require("./dish-store");
exports.VAULT_FIELDS = ['username', 'password', 'totp', 'uri', 'notes'];
const CUSTOM_FIELD_RE = /^field:[^\u0000-\u001f\u007f]{1,128}$/;
exports.BRIDGE_HEADER = 'x-pi-dish-vault-bridge';
exports.GRANT_WINDOW_MS = 15 * 60 * 1000;
exports.LISTENER_STALE_MS = 45 * 1000;
exports.MAX_REQUEST_LIFETIME_MS = 10 * 60 * 1000;
exports.RECENT_LIMIT = 20;
const PUSH_BODY_CHARS = 180;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const FINGERPRINT_RE = /^[0-9a-fA-F]{8,128}$/;
function fail(status, error) { return { ok: false, status, error }; }
function boundedString(value, max) {
    if (typeof value !== 'string')
        return null;
    const text = value.trim();
    return text && text.length <= max ? text : null;
}
function optionalString(value, max) {
    if (value === undefined || value === null || value === '')
        return null;
    return boundedString(value, max) ?? undefined;
}
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function decodeDevice(value) {
    const device = record(value);
    const name = boundedString(device?.name, 64);
    const fingerprint = typeof device?.fingerprint === 'string' && FINGERPRINT_RE.test(device.fingerprint) ? device.fingerprint.toLowerCase() : null;
    return name && fingerprint ? { name, fingerprint } : null;
}
/** Unique field names: built-ins in canonical order, then custom fields as requested; null when empty or invalid. */
function decodeFields(value) {
    if (!Array.isArray(value) || !value.length)
        return null;
    const wanted = new Set(value);
    if (wanted.size !== value.length)
        return null;
    const custom = [];
    for (const field of wanted) {
        if (exports.VAULT_FIELDS.includes(field))
            continue;
        if (typeof field !== 'string' || !CUSTOM_FIELD_RE.test(field))
            return null;
        custom.push(field);
    }
    return [...exports.VAULT_FIELDS.filter(field => wanted.has(field)), ...custom];
}
function decodeSession(value) {
    if (value === undefined || value === null)
        return null;
    const session = record(value);
    const ref = boundedString(session?.ref, 200);
    const name = optionalString(session?.name, 200);
    const host = optionalString(session?.host, 100);
    if (!ref || name === undefined || host === undefined)
        return undefined;
    return { ref, name, host };
}
/** Notification for a pending request; the reason is the agent's claim, so it follows the facts. */
function vaultPushPayload(request) {
    const who = request.session?.name || request.session?.ref;
    const lead = who ? `${who} on ${request.device.name}` : request.device.name;
    let body = `${lead} wants ${request.item} (${request.fields.join(', ')})`;
    if (request.reason)
        body += ` — ${request.reason}`;
    if (body.length > PUSH_BODY_CHARS)
        body = `${body.slice(0, PUSH_BODY_CHARS - 1)}…`;
    return { kind: 'vault', title: 'Vault request', body, sessionId: null, tag: `vault:${request.id}`, vaultRequestId: request.id };
}
function createVaultApprovals(ports) {
    const now = ports.now || Date.now;
    const requests = new Map();
    const grants = new Map();
    let listener = null;
    function settle(request, status, at) {
        request.status = status;
        request.decidedAt = at;
    }
    /** Expires overdue requests and grants, and trims decided history. */
    function sweep() {
        const at = now();
        for (const request of requests.values()) {
            if (request.status === 'pending' && request.expiresAt <= at)
                settle(request, 'expired', at);
        }
        for (const grant of grants.values())
            if (grant.expiresAt <= at)
                grants.delete(grant.id);
        const decided = [...requests.values()].filter(request => request.status !== 'pending')
            .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
        for (const stale of decided.slice(exports.RECENT_LIMIT))
            requests.delete(stale.id);
    }
    function find(id) {
        sweep();
        const request = requests.get(id);
        return request ? { ok: true, value: request } : fail(404, 'Unknown vault request');
    }
    return {
        overview() {
            sweep();
            const all = [...requests.values()];
            return {
                listener: listener ? { ...listener, stale: now() - listener.updatedAt > exports.LISTENER_STALE_MS } : null,
                pending: all.filter(request => request.status === 'pending').sort((a, b) => a.createdAt - b.createdAt),
                recent: all.filter(request => request.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)),
                grants: [...grants.values()].sort((a, b) => a.expiresAt - b.expiresAt),
            };
        },
        reportStatus(body) {
            const status = record(body);
            const state = status?.state;
            if (state !== 'locked' && state !== 'ready')
                return fail(400, "state must be 'locked' or 'ready'");
            const account = optionalString(status?.account, 200);
            if (account === undefined)
                return fail(400, 'account must be a short string');
            const rawDevices = status?.devices ?? [];
            if (!Array.isArray(rawDevices) || rawDevices.length > 64)
                return fail(400, 'devices must be a list');
            const devices = rawDevices.map(decodeDevice);
            if (devices.some(device => !device))
                return fail(400, 'each device needs a name and a hex fingerprint');
            listener = { state, account, devices: devices, updatedAt: now() };
            return { ok: true, value: listener };
        },
        createRequest(body) {
            sweep();
            const input = record(body);
            const id = typeof input?.id === 'string' && ID_RE.test(input.id) ? input.id : null;
            if (!id)
                return fail(400, 'id must be 8-64 letters, digits or dashes');
            if (requests.has(id))
                return fail(409, 'Duplicate vault request id');
            const device = decodeDevice(input?.device);
            if (!device)
                return fail(400, 'device needs a name and a hex fingerprint');
            const item = boundedString(input?.item, 256);
            if (!item)
                return fail(400, 'item is required');
            const fields = decodeFields(input?.fields);
            if (!fields)
                return fail(400, `fields must be distinct values from: ${exports.VAULT_FIELDS.join(', ')}, field:<name>`);
            const reason = optionalString(input?.reason, 500);
            if (reason === undefined)
                return fail(400, 'reason must be at most 500 characters');
            const session = decodeSession(input?.session);
            if (session === undefined)
                return fail(400, 'session needs a ref (name and host optional)');
            const at = now();
            const expiresAt = typeof input?.expiresAt === 'number' && Number.isFinite(input.expiresAt) ? input.expiresAt : NaN;
            if (!(expiresAt > at))
                return fail(400, 'expiresAt must be a future epoch-millisecond time');
            const request = {
                id, device, item, fields, reason, session,
                createdAt: at, expiresAt: Math.min(expiresAt, at + exports.MAX_REQUEST_LIFETIME_MS),
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
            }
            else {
                ports.notify(request);
            }
            return { ok: true, value: request };
        },
        requestStatus: find,
        abandon(id) {
            const found = find(id);
            if (found.ok && found.value.status === 'pending')
                settle(found.value, 'expired', now());
            return found;
        },
        decide(id, decision) {
            if (decision !== 'approve' && decision !== 'approve-window' && decision !== 'deny') {
                return fail(400, "decision must be 'approve', 'approve-window' or 'deny'");
            }
            const found = find(id);
            if (!found.ok)
                return found;
            const request = found.value;
            if (request.status !== 'pending')
                return fail(409, `This request is already ${request.status}`);
            const at = now();
            settle(request, decision === 'deny' ? 'denied' : 'approved', at);
            if (decision === 'approve-window') {
                const grant = {
                    id: crypto.randomUUID(), device: request.device, item: request.item, fields: request.fields,
                    sessionRef: request.session?.ref ?? null, createdAt: at, expiresAt: at + exports.GRANT_WINDOW_MS,
                };
                grants.set(grant.id, grant);
                request.grantId = grant.id;
            }
            return { ok: true, value: request };
        },
        revokeGrant(id) {
            sweep();
            const grant = grants.get(id);
            if (!grant)
                return fail(404, 'Unknown vault grant');
            grants.delete(id);
            return { ok: true, value: grant };
        },
    };
}
/** The listener's bridge credential, created 0600 on first use (exclusive, so racing first uses agree). */
function readBridgeToken() {
    const file = path.join(dishStore.dishDir(), 'vault', 'bridge.token');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
        fs.writeFileSync(file, `${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
    }
    return fs.readFileSync(file, 'utf8').trim();
}
const LOOPBACK = { '127.0.0.1': true, '::1': true, '::ffff:127.0.0.1': true };
function createVaultHandlers(vault, token = readBridgeToken) {
    function reply(res, result, send) {
        if (result.ok)
            send(result.value);
        else
            res.status(result.status).json({ error: result.error });
    }
    return {
        bridgeGate(req, res, next) {
            const given = Buffer.from(req.get(exports.BRIDGE_HEADER) || '');
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
