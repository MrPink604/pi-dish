// Generated from src/core/vault-approvals.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VAULT_AUDIT_MAX_BYTES = exports.VAULT_AUDIT_FILE = exports.VAULT_POLICY_FILE = exports.RECENT_LIMIT = exports.MAX_REQUEST_LIFETIME_MS = exports.LISTENER_STALE_MS = exports.GRANT_WINDOW_MS = exports.BRIDGE_HEADER = exports.VAULT_FIELDS = void 0;
exports.decodeFields = decodeFields;
exports.parseOrigin = parseOrigin;
exports.httpsOriginOfUri = httpsOriginOfUri;
exports.evaluateOriginMatch = evaluateOriginMatch;
exports.loadVaultPolicies = loadVaultPolicies;
exports.readVaultAudit = readVaultAudit;
exports.vaultPushPayload = vaultPushPayload;
exports.createVaultApprovals = createVaultApprovals;
exports.createVaultHandlers = createVaultHandlers;
/**
 * Operator approval of each Bitwarden item an agent asks for. The unlocked
 * `bw` session lives in the Agent Access listener; pi-dish records decisions
 * and never sees a secret. Pending requests and grants stay in memory on
 * purpose (a restart forgets them); per-device policies are read from
 * `~/.pi/dish/vault/policies.json` and every request/decision is appended to
 * `~/.pi/dish/vault-audit.ndjson` (0600).
 * The bridge requires a loopback peer plus `~/.pi/dish/vault/bridge.token`;
 * the model is cooperative (any agent with this UID could read the token).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dishStore = require("./dish-store");
const wire_protocol_1 = require("./wire-protocol");
exports.VAULT_FIELDS = ['username', 'password', 'totp', 'uri', 'notes'];
const CUSTOM_FIELD_RE = /^field:[^\u0000-\u001f\u007f]{1,128}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
exports.BRIDGE_HEADER = 'x-pi-dish-vault-bridge';
exports.GRANT_WINDOW_MS = 15 * 60 * 1000;
exports.LISTENER_STALE_MS = 45 * 1000;
exports.MAX_REQUEST_LIFETIME_MS = 10 * 60 * 1000;
exports.RECENT_LIMIT = 20;
exports.VAULT_POLICY_FILE = 'policies.json';
exports.VAULT_AUDIT_FILE = 'vault-audit.ndjson';
exports.VAULT_AUDIT_MAX_BYTES = 1024 * 1024;
const AUDIT_DEFAULT_LIMIT = 100;
const AUDIT_MAX_LIMIT = 500;
const MAX_ITEM_URIS = 64;
const MAX_URI_CHARS = 2048;
const MAX_ORIGIN_CHARS = 512;
const PUSH_BODY_CHARS = 180;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const FINGERPRINT_RE = /^[0-9a-fA-F]{8,128}$/;
const POLICY_KEYS = new Set(['name', 'allowFolder', 'allowedFields', 'allowWindow', 'allowCreate', 'requireOriginMatch']);
function fail(status, error) { return { ok: false, status, error }; }
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function boundedString(value, max) {
    if (typeof value !== 'string')
        return null;
    const text = value.trim();
    return text && text.length <= max ? text : null;
}
function cleanString(value, max) {
    const text = boundedString(value, max);
    return text && !CONTROL_CHAR_RE.test(text) ? text : null;
}
function optionalString(value, max) {
    if (value === undefined || value === null || value === '')
        return null;
    return boundedString(value, max) ?? undefined;
}
function optionalCleanString(value, max) {
    if (value === undefined || value === null || value === '')
        return null;
    return cleanString(value, max) ?? undefined;
}
function defaultPolicyFile() {
    return path.join(dishStore.dishDir(), 'vault', exports.VAULT_POLICY_FILE);
}
function defaultAuditFile() {
    return path.join(dishStore.dishDir(), exports.VAULT_AUDIT_FILE);
}
function decodeDevice(value) {
    const device = (0, wire_protocol_1.asRecord)(value);
    const name = boundedString(device.name, 64);
    const fingerprint = typeof device.fingerprint === 'string' && FINGERPRINT_RE.test(device.fingerprint) ? device.fingerprint.toLowerCase() : null;
    return name && fingerprint ? { name, fingerprint } : null;
}
/** Unique field names: built-ins in canonical order, then custom fields as requested; null when empty or invalid. */
function decodeFields(value) {
    if (!Array.isArray(value) || !value.length)
        return null;
    return decodeFieldList(value);
}
function decodeFieldList(value) {
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
    const session = (0, wire_protocol_1.asRecord)(value);
    const ref = boundedString(session.ref, 200);
    const name = optionalString(session.name, 200);
    const host = optionalString(session.host, 100);
    if (!ref || name === undefined || host === undefined)
        return undefined;
    return { ref, name, host };
}
function decodeItemUris(value) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value) || value.length > MAX_ITEM_URIS)
        return null;
    const uris = [];
    for (const entry of value) {
        const uri = cleanString(entry, MAX_URI_CHARS);
        if (!uri)
            return null;
        uris.push(uri);
    }
    return uris;
}
/** Parses a bare `http(s)://host[:port]` origin (no path, query, hash, or userinfo). */
function parseOrigin(raw) {
    if (!raw || raw.length > MAX_ORIGIN_CHARS || /[\u0000-\u0020\u007f]/.test(raw))
        return null;
    if (!/^https?:\/\//i.test(raw) || raw.includes('?') || raw.includes('#') || raw.includes('@') || raw.includes('\\'))
        return null;
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
        return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
        return null;
    if (parsed.pathname !== '/' || !parsed.hostname || parsed.origin === 'null')
        return null;
    const afterScheme = raw.slice(parsed.protocol.length + 2);
    if (afterScheme.includes('/'))
        return null;
    return { origin: parsed.origin, https: parsed.protocol === 'https:' };
}
/** Extracts the exact `https:` origin of a stored Bitwarden URI; non-https, userinfo, or unparseable URIs yield null. */
function httpsOriginOfUri(raw) {
    if (!raw || raw.length > MAX_URI_CHARS || CONTROL_CHAR_RE.test(raw))
        return null;
    const trimmed = raw.trim();
    if (!/^https:\/\//i.test(trimmed))
        return null;
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        return null;
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.origin === 'null')
        return null;
    return parsed.origin;
}
/** Exact scheme+host+port (`https` only) match between a parsed request origin and an item's stored URIs. */
function evaluateOriginMatch(origin, itemUris) {
    if (!origin)
        return 'no-origin';
    if (!origin.https || !itemUris.length)
        return 'mismatch';
    for (const uri of itemUris) {
        if (httpsOriginOfUri(uri) === origin.origin)
            return 'match';
    }
    return 'mismatch';
}
/**
 * Loads per-device policies from `policies.json`. Missing file (`ENOENT`) means
 * no restrictions (backwards compatible); any parse or schema error fails closed.
 */
function loadVaultPolicies(file = defaultPolicyFile()) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    }
    catch (error) {
        if (isPlainObject(error) && error.code === 'ENOENT')
            return { ok: true, policies: new Map() };
        return { ok: false, error: `Could not read vault policies: ${error instanceof Error ? error.message : String(error)}` };
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { ok: false, error: 'Vault policy file is not valid JSON' };
    }
    if (!isPlainObject(parsed))
        return { ok: false, error: 'Vault policy file must be a JSON object' };
    const topKeys = Object.keys(parsed);
    if (topKeys.length !== 1 || topKeys[0] !== 'devices' || !isPlainObject(parsed.devices)) {
        return { ok: false, error: 'Vault policy file must contain only a "devices" object' };
    }
    const policies = new Map();
    for (const [rawKey, rawEntry] of Object.entries(parsed.devices)) {
        if (!FINGERPRINT_RE.test(rawKey))
            return { ok: false, error: `Invalid device fingerprint key in vault policies: ${rawKey}` };
        const fingerprint = rawKey.toLowerCase();
        if (policies.has(fingerprint))
            return { ok: false, error: `Duplicate device fingerprint in vault policies: ${fingerprint}` };
        if (!isPlainObject(rawEntry))
            return { ok: false, error: `Policy for ${fingerprint} must be an object` };
        for (const key of Object.keys(rawEntry)) {
            if (!POLICY_KEYS.has(key))
                return { ok: false, error: `Unknown policy key "${key}" for ${fingerprint}` };
        }
        let name;
        if (rawEntry.name !== undefined) {
            const value = cleanString(rawEntry.name, 64);
            if (!value)
                return { ok: false, error: `Invalid "name" in policy for ${fingerprint}` };
            name = value;
        }
        let allowFolder;
        if (rawEntry.allowFolder !== undefined) {
            const value = cleanString(rawEntry.allowFolder, 256);
            if (!value)
                return { ok: false, error: `Invalid "allowFolder" in policy for ${fingerprint}` };
            allowFolder = value;
        }
        let allowedFields;
        if (rawEntry.allowedFields !== undefined) {
            if (!Array.isArray(rawEntry.allowedFields))
                return { ok: false, error: `Invalid "allowedFields" in policy for ${fingerprint}` };
            const fields = decodeFieldList(rawEntry.allowedFields);
            if (!fields)
                return { ok: false, error: `Invalid field entry in "allowedFields" for ${fingerprint}` };
            allowedFields = fields;
        }
        let allowWindow;
        if (rawEntry.allowWindow !== undefined) {
            if (typeof rawEntry.allowWindow !== 'boolean')
                return { ok: false, error: `Invalid "allowWindow" in policy for ${fingerprint}` };
            allowWindow = rawEntry.allowWindow;
        }
        let allowCreate;
        if (rawEntry.allowCreate !== undefined) {
            if (typeof rawEntry.allowCreate !== 'boolean')
                return { ok: false, error: `Invalid "allowCreate" in policy for ${fingerprint}` };
            allowCreate = rawEntry.allowCreate;
        }
        let requireOriginMatch;
        if (rawEntry.requireOriginMatch !== undefined) {
            if (typeof rawEntry.requireOriginMatch !== 'boolean')
                return { ok: false, error: `Invalid "requireOriginMatch" in policy for ${fingerprint}` };
            requireOriginMatch = rawEntry.requireOriginMatch;
        }
        policies.set(fingerprint, {
            ...(name !== undefined ? { name } : {}),
            ...(allowFolder !== undefined ? { allowFolder } : {}),
            ...(allowedFields !== undefined ? { allowedFields } : {}),
            ...(allowWindow !== undefined ? { allowWindow } : {}),
            ...(allowCreate !== undefined ? { allowCreate } : {}),
            ...(requireOriginMatch !== undefined ? { requireOriginMatch } : {}),
        });
    }
    return { ok: true, policies };
}
function evaluateDevicePolicy(policy, input) {
    if (!policy) {
        return { ok: true, policyName: null, policyResult: 'default', allowWindow: input.action === 'release' };
    }
    const policyName = policy.name ?? 'restricted';
    if (input.action === 'create' && policy.allowCreate === false) {
        return { ok: false, policyName, policyResult: 'denied:create_not_allowed', error: 'Policy refuses item creation for this device' };
    }
    if (policy.allowFolder !== undefined && input.folder !== policy.allowFolder) {
        return {
            ok: false,
            policyName,
            policyResult: 'denied:folder_not_allowed',
            error: `Policy allows only items in folder "${policy.allowFolder}"`,
        };
    }
    if (policy.allowedFields !== undefined) {
        const allowed = new Set(policy.allowedFields);
        const disallowed = input.fields.filter(field => !allowed.has(field));
        if (disallowed.length) {
            return {
                ok: false,
                policyName,
                policyResult: 'denied:field_not_allowed',
                error: `Policy refuses requested field(s): ${disallowed.join(', ')}`,
            };
        }
    }
    if (policy.requireOriginMatch === true) {
        if (!input.parsedOrigin) {
            return { ok: false, policyName, policyResult: 'denied:origin_required', error: 'Policy requires a request origin' };
        }
        if (!input.parsedOrigin.https) {
            return { ok: false, policyName, policyResult: 'denied:origin_not_https', error: 'Policy requires an https origin' };
        }
        if (!input.itemUris.length) {
            return { ok: false, policyName, policyResult: 'denied:item_has_no_uri', error: 'Policy refuses items with no stored URI' };
        }
        if (input.originMatch !== 'match') {
            return { ok: false, policyName, policyResult: 'denied:origin_mismatch', error: 'Request origin does not match any stored https URI of the item' };
        }
    }
    return {
        ok: true,
        policyName,
        policyResult: 'allowed',
        allowWindow: input.action === 'release' && policy.allowWindow !== false,
    };
}
/** Appends one secret-free audit line (0600), rotating to `.1` once the active file reaches `maxBytes`. */
function appendVaultAudit(file, entry, maxBytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
        if (fs.statSync(file).size >= maxBytes) {
            fs.renameSync(file, `${file}.1`);
            fs.chmodSync(`${file}.1`, 0o600);
        }
    }
    catch (error) {
        if (!isPlainObject(error) || error.code !== 'ENOENT') {
            console.error(`[vault] audit rotate failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const fd = fs.openSync(file, 'a', 0o600);
    try {
        fs.fchmodSync(fd, 0o600);
        // Explicitly project only the allowlisted non-secret schema fields.
        const record = {
            ts: entry.ts,
            event: entry.event,
            requestId: entry.requestId,
            action: entry.action,
            deviceFingerprint: entry.deviceFingerprint,
            deviceName: entry.deviceName,
            itemId: entry.itemId,
            itemName: entry.itemName,
            fields: entry.fields,
            folder: entry.folder,
            origin: entry.origin,
            originMatch: entry.originMatch,
            decision: entry.decision,
            by: entry.by,
            policyResult: entry.policyResult,
            policyName: entry.policyName,
        };
        fs.writeSync(fd, `${JSON.stringify(record)}\n`);
    }
    finally {
        fs.closeSync(fd);
    }
}
function parseAuditLines(file) {
    let content;
    try {
        content = fs.readFileSync(file, 'utf8');
    }
    catch (error) {
        if (isPlainObject(error) && error.code === 'ENOENT')
            return [];
        throw error;
    }
    const entries = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (isPlainObject(parsed) && typeof parsed.ts === 'string' && typeof parsed.requestId === 'string' && typeof parsed.decision === 'string') {
                entries.push(parsed);
            }
        }
        catch {
            // Ignore a corrupt or truncated line rather than failing the whole audit read.
        }
    }
    return entries;
}
/** Reads newest-first audit entries across the rotated `.1` file and active log. */
function readVaultAudit(file = defaultAuditFile(), query = {}) {
    const limit = Math.min(AUDIT_MAX_LIMIT, Math.max(1, Number.isInteger(query.limit) ? query.limit : AUDIT_DEFAULT_LIMIT));
    const device = query.device?.toLowerCase();
    const decision = query.decision;
    const combined = [...parseAuditLines(`${file}.1`), ...parseAuditLines(file)];
    const filtered = combined.filter(entry => (!device || entry.deviceFingerprint === device)
        && (!decision || entry.decision === decision));
    return filtered.reverse().slice(0, limit);
}
/** Notification for a pending request; the reason is the agent's claim, so it follows the facts. */
function vaultPushPayload(request) {
    const who = request.session?.name || request.session?.ref;
    const lead = who ? `${who} on ${request.device.name}` : request.device.name;
    let body = request.action === 'create'
        ? `${lead} wants to create ${request.item} in ${request.folder} (${request.fields.join(', ')})`
        : `${lead} wants ${request.item} (${request.fields.join(', ')})`;
    if (request.origin) {
        const badge = request.originMatch === 'match' ? ' [origin matched]' : request.originMatch === 'mismatch' ? ' [origin mismatch]' : '';
        body += ` on ${request.origin}${badge}`;
    }
    if (request.reason)
        body += ` — ${request.reason}`;
    if (body.length > PUSH_BODY_CHARS)
        body = `${body.slice(0, PUSH_BODY_CHARS - 1)}…`;
    return { kind: 'vault', title: request.action === 'create' ? 'Vault create request' : 'Vault request', body, sessionId: null, tag: `vault:${request.id}`, vaultRequestId: request.id };
}
function createVaultApprovals(ports) {
    const now = ports.now || Date.now;
    const policyFile = ports.policyFile || defaultPolicyFile;
    const auditFile = ports.auditFile || defaultAuditFile;
    const auditMaxBytes = ports.auditMaxBytes ?? exports.VAULT_AUDIT_MAX_BYTES;
    const requests = new Map();
    const grants = new Map();
    let listener = null;
    function recordAudit(entry, at) {
        try {
            appendVaultAudit(auditFile(), { ts: new Date(at).toISOString(), ...entry }, auditMaxBytes);
        }
        catch (error) {
            console.error(`[vault] audit write failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    function requestAuditBase(request) {
        return {
            requestId: request.id,
            action: request.action,
            deviceFingerprint: request.device.fingerprint,
            deviceName: request.device.name,
            itemId: request.itemId,
            itemName: request.item,
            fields: request.fields,
            folder: request.folder,
            origin: request.origin,
            originMatch: request.originMatch,
            policyResult: request.policyResult,
            policyName: request.policyName,
        };
    }
    function settle(request, status, at) {
        request.status = status;
        request.decidedAt = at;
    }
    /** Expires overdue requests and grants, and trims decided history. */
    function sweep() {
        const at = now();
        for (const request of requests.values()) {
            if (request.status === 'pending' && request.expiresAt <= at) {
                settle(request, 'expired', at);
                recordAudit({ ...requestAuditBase(request), event: 'decision', decision: 'expired', by: 'timeout' }, at);
            }
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
            const loadedPolicies = loadVaultPolicies(policyFile());
            const all = [...requests.values()];
            const projectPending = (request) => {
                if (!request.allowWindow)
                    return request;
                // Re-check current policy so the UI never offers a window the server would reject.
                const currentAllows = loadedPolicies.ok && loadedPolicies.policies.get(request.device.fingerprint)?.allowWindow !== false;
                return currentAllows ? request : { ...request, allowWindow: false };
            };
            return {
                listener: listener ? { ...listener, stale: now() - listener.updatedAt > exports.LISTENER_STALE_MS } : null,
                pending: all.filter(request => request.status === 'pending').sort((a, b) => a.createdAt - b.createdAt).map(projectPending),
                recent: all.filter(request => request.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)),
                grants: [...grants.values()].sort((a, b) => a.expiresAt - b.expiresAt),
            };
        },
        reportStatus(body) {
            const status = (0, wire_protocol_1.asRecord)(body);
            const state = status.state;
            if (state !== 'locked' && state !== 'ready')
                return fail(400, "state must be 'locked' or 'ready'");
            const account = optionalString(status.account, 200);
            if (account === undefined)
                return fail(400, 'account must be a short string');
            const rawDevices = status.devices ?? [];
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
            const input = (0, wire_protocol_1.asRecord)(body);
            const id = typeof input.id === 'string' && ID_RE.test(input.id) ? input.id : null;
            if (!id)
                return fail(400, 'id must be 8-64 letters, digits or dashes');
            if (requests.has(id))
                return fail(409, 'Duplicate vault request id');
            const device = decodeDevice(input.device);
            if (!device)
                return fail(400, 'device needs a name and a hex fingerprint');
            const action = input.action ?? 'release';
            if (action !== 'release' && action !== 'create')
                return fail(400, "action must be 'release' or 'create'");
            const item = boundedString(input.item, 256);
            if (!item)
                return fail(400, 'item is required');
            const itemId = optionalCleanString(input.itemId, 128);
            if (itemId === undefined)
                return fail(400, 'itemId must be a short single-line string');
            const folder = action === 'create'
                ? cleanString(input.folder, 256)
                : optionalCleanString(input.folder, 256);
            if (action === 'create' && !folder)
                return fail(400, 'a create names its folder');
            if (folder === undefined)
                return fail(400, 'folder must be a short single-line string');
            const fields = decodeFields(input.fields);
            if (!fields)
                return fail(400, `fields must be distinct values from: ${exports.VAULT_FIELDS.join(', ')}, field:<name>`);
            const rawOrigin = optionalCleanString(input.origin, MAX_ORIGIN_CHARS);
            if (rawOrigin === undefined)
                return fail(400, 'origin must be a bare http(s) origin (scheme://host[:port])');
            const parsedOrigin = rawOrigin ? parseOrigin(rawOrigin) : null;
            if (rawOrigin && !parsedOrigin)
                return fail(400, 'origin must be a bare http(s) origin (scheme://host[:port])');
            const itemUris = decodeItemUris(input.itemUris);
            if (!itemUris)
                return fail(400, 'itemUris must be an array of up to 64 URI strings');
            const reason = optionalString(input.reason, 500);
            if (reason === undefined)
                return fail(400, 'reason must be at most 500 characters');
            const session = decodeSession(input.session);
            if (session === undefined)
                return fail(400, 'session needs a ref (name and host optional)');
            const at = now();
            const expiresAt = typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt) ? input.expiresAt : NaN;
            if (!(expiresAt > at))
                return fail(400, 'expiresAt must be a future epoch-millisecond time');
            const origin = parsedOrigin?.origin ?? null;
            const originMatch = evaluateOriginMatch(parsedOrigin, itemUris);
            const loadedPolicies = loadVaultPolicies(policyFile());
            if (!loadedPolicies.ok) {
                recordAudit({
                    event: 'request',
                    requestId: id,
                    action,
                    deviceFingerprint: device.fingerprint,
                    deviceName: device.name,
                    itemId,
                    itemName: item,
                    fields,
                    folder,
                    origin,
                    originMatch,
                    decision: 'refused',
                    by: 'policy',
                    policyResult: 'policy_config_error',
                    policyName: null,
                }, at);
                return fail(500, 'Vault policy configuration is invalid; refusing request');
            }
            const policy = loadedPolicies.policies.get(device.fingerprint);
            const verdict = evaluateDevicePolicy(policy, { action, folder, fields, parsedOrigin, itemUris, originMatch });
            if (!verdict.ok) {
                recordAudit({
                    event: 'request',
                    requestId: id,
                    action,
                    deviceFingerprint: device.fingerprint,
                    deviceName: device.name,
                    itemId,
                    itemName: item,
                    fields,
                    folder,
                    origin,
                    originMatch,
                    decision: 'refused',
                    by: 'policy',
                    policyResult: verdict.policyResult,
                    policyName: verdict.policyName,
                }, at);
                return fail(403, verdict.error);
            }
            const request = {
                id,
                device,
                action,
                itemId,
                item,
                fields,
                folder,
                origin,
                originMatch,
                allowWindow: verdict.allowWindow,
                policyName: verdict.policyName,
                policyResult: verdict.policyResult,
                reason,
                session,
                createdAt: at,
                expiresAt: Math.min(expiresAt, at + exports.MAX_REQUEST_LIFETIME_MS),
                status: 'pending',
                decidedAt: null,
                auto: false,
                grantId: null,
            };
            requests.set(id, request);
            // A grant covers the same device, item, field set, claimed session and origin;
            // creates and allowWindow:false devices bypass grants and always ask.
            const grant = request.allowWindow ? [...grants.values()].find(candidate => candidate.device.fingerprint === device.fingerprint
                && candidate.item === item && candidate.fields.join(',') === fields.join(',')
                && candidate.sessionRef === (session?.ref ?? null)
                && candidate.origin === origin) : undefined;
            if (grant) {
                settle(request, 'approved', at);
                request.auto = true;
                request.grantId = grant.id;
                recordAudit({ ...requestAuditBase(request), event: 'request', decision: 'approved', by: 'grant' }, at);
            }
            else {
                recordAudit({ ...requestAuditBase(request), event: 'request', decision: 'pending', by: 'listener' }, at);
                ports.notify(request);
            }
            return { ok: true, value: request };
        },
        requestStatus: find,
        abandon(id) {
            const found = find(id);
            if (found.ok && found.value.status === 'pending') {
                const at = now();
                settle(found.value, 'expired', at);
                recordAudit({ ...requestAuditBase(found.value), event: 'decision', decision: 'abandoned', by: 'listener' }, at);
            }
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
            if (decision === 'approve-window') {
                if (request.action === 'create')
                    return fail(400, 'A create is approved once; it opens no window');
                const loadedPolicies = loadVaultPolicies(policyFile());
                if (!loadedPolicies.ok) {
                    recordAudit({ ...requestAuditBase(request), event: 'decision', decision: 'window-refused', by: 'policy', policyResult: 'policy_config_error' }, now());
                    return fail(500, 'Vault policy configuration is invalid; refusing window approval');
                }
                const currentPolicy = loadedPolicies.policies.get(request.device.fingerprint);
                if (!request.allowWindow || currentPolicy?.allowWindow === false) {
                    recordAudit({
                        ...requestAuditBase(request),
                        event: 'decision',
                        decision: 'window-refused',
                        by: 'policy',
                        policyResult: 'denied:window_not_allowed',
                        policyName: request.policyName ?? currentPolicy?.name ?? 'restricted',
                    }, now());
                    return fail(400, 'Window approvals are disabled by policy for this device');
                }
            }
            const at = now();
            settle(request, decision === 'deny' ? 'denied' : 'approved', at);
            if (decision === 'approve-window') {
                const grant = {
                    id: crypto.randomUUID(), device: request.device, item: request.item, fields: request.fields,
                    sessionRef: request.session?.ref ?? null, origin: request.origin, createdAt: at, expiresAt: at + exports.GRANT_WINDOW_MS,
                };
                grants.set(grant.id, grant);
                request.grantId = grant.id;
            }
            recordAudit({
                ...requestAuditBase(request),
                event: 'decision',
                decision: decision === 'deny' ? 'denied' : decision === 'approve-window' ? 'approved-window' : 'approved',
                by: 'operator',
            }, at);
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
        audit(query) {
            return readVaultAudit(auditFile(), query);
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
        audit(req, res) {
            let limit;
            if (req.query.limit !== undefined) {
                if (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)) {
                    res.status(400).json({ error: 'limit must be a positive integer' });
                    return;
                }
                limit = Math.min(AUDIT_MAX_LIMIT, Math.max(1, Number(req.query.limit)));
            }
            let device;
            if (req.query.device !== undefined && req.query.device !== '') {
                if (typeof req.query.device !== 'string' || !FINGERPRINT_RE.test(req.query.device)) {
                    res.status(400).json({ error: 'device must be a hex fingerprint' });
                    return;
                }
                device = req.query.device.toLowerCase();
            }
            let decision;
            if (req.query.decision !== undefined && req.query.decision !== '') {
                const cleaned = cleanString(req.query.decision, 64);
                if (!cleaned) {
                    res.status(400).json({ error: 'decision must be a short string' });
                    return;
                }
                decision = cleaned;
            }
            res.json({ entries: vault.audit({ limit, device, decision }) });
        },
        decide: (req, res) => reply(res, vault.decide(req.params.id, (0, wire_protocol_1.asRecord)(req.body).decision), request => res.json({ request })),
        revokeGrant: (req, res) => reply(res, vault.revokeGrant(req.params.id), () => res.status(204).end()),
    };
}
