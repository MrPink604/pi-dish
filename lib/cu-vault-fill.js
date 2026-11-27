// Generated from src/core/cu-vault-fill.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CU_VAULT_FILL_RETRYABLE_CODES = exports.CU_VAULT_FILL_ENVELOPE_ALG = exports.CU_VAULT_FILL_ENVELOPE_LABEL = exports.MAX_CU_VAULT_FILL_RETRY_AFTER_MS = exports.MAX_CU_VAULT_FILL_EXECUTE_ATTEMPTS = exports.CU_VAULT_FILL_STOP_CANCEL_TIMEOUT_MS = exports.CU_VAULT_FILL_CANCEL_TIMEOUT_MS = exports.CU_VAULT_FILL_EXECUTE_TIMEOUT_MS = exports.MAX_CU_VAULT_FILL_POLL_WAIT_MS = exports.DEFAULT_CU_VAULT_FILL_POLL_WAIT_MS = exports.DEFAULT_CU_VAULT_FILL_IDENTITY = exports.CU_VAULT_FILL_AUDIT_MAX_BYTES = exports.CU_VAULT_FILL_AUDIT_FILE = exports.CU_VAULT_FILL_SETTING = void 0;
exports.readCuVaultFillConfig = readCuVaultFillConfig;
exports.extractSealedFromStdout = extractSealedFromStdout;
exports.buildFillApprovalReason = buildFillApprovalReason;
exports.createCuVaultFillCoordinator = createCuVaultFillCoordinator;
/**
 * Hub-side coordinator for computer-use Bitwarden vault fill (Slice 3).
 *
 * Opt-in via `~/.pi/dish/settings.json` (`cuVaultFill: { enabled: true, remote: "cu-sandbox", ... }`).
 * Long-polls the guest remote's `/api/cu/fill/pending` through the hub→peer relay
 * client (`remote-hosts.ts`), spawns `pi-dish-vault run` with an isolated
 * `XDG_CONFIG_HOME` identity wrapping the one-shot `cu-fill-seal` helper, and
 * delivers only the sealed ciphertext back to `/api/cu/fill/execute` (or cancels
 * on deny/refusal/timeout/error).
 *
 * Secrecy invariants:
 * - This Node process never sees plaintext credentials; `aac` injects them only
 *   into the ephemeral `cu-fill-seal` child's environment.
 * - Helper stdout is treated solely as the sealed base64url envelope and never logged.
 * - Helper stderr is sanitized and length-capped before logging.
 * - Audit lines (`~/.pi/dish/cu-vault-fill-audit.ndjson`, 0600) follow a strict
 *   non-secret allowlist (never values, nonces, keys, envelopes, or stderr).
 */
const node_child_process_1 = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dish_store_1 = require("./dish-store");
const helper_values_1 = require("./helper-values");
const http_boundary_1 = require("./http-boundary");
const remoteHosts = require("./remote-hosts");
const vault_approvals_1 = require("./vault-approvals");
exports.CU_VAULT_FILL_SETTING = 'cuVaultFill';
exports.CU_VAULT_FILL_AUDIT_FILE = 'cu-vault-fill-audit.ndjson';
exports.CU_VAULT_FILL_AUDIT_MAX_BYTES = 1024 * 1024;
exports.DEFAULT_CU_VAULT_FILL_IDENTITY = 'cu-sandbox-proxy';
exports.DEFAULT_CU_VAULT_FILL_POLL_WAIT_MS = 20_000;
exports.MAX_CU_VAULT_FILL_POLL_WAIT_MS = 25_000;
exports.CU_VAULT_FILL_EXECUTE_TIMEOUT_MS = 50_000;
exports.CU_VAULT_FILL_CANCEL_TIMEOUT_MS = 15_000;
exports.CU_VAULT_FILL_STOP_CANCEL_TIMEOUT_MS = 2_000;
exports.MAX_CU_VAULT_FILL_EXECUTE_ATTEMPTS = 20;
exports.MAX_CU_VAULT_FILL_RETRY_AFTER_MS = 5_000;
exports.CU_VAULT_FILL_ENVELOPE_LABEL = 'cu-broker vault-fill v1';
exports.CU_VAULT_FILL_ENVELOPE_ALG = 'X25519-HKDF-SHA256-ChaCha20Poly1305';
exports.CU_VAULT_FILL_RETRYABLE_CODES = new Set([
    'transition_pending',
    'agent_busy',
    'fill_in_progress',
    'broker_busy',
]);
const ALLOWED_FIELDS = ['username', 'password', 'totp'];
const FIELD_ENV_MAP = {
    username: 'CU_FILL_USERNAME=username',
    password: 'CU_FILL_PASSWORD=password',
    totp: 'CU_FILL_TOTP=totp',
};
const FILL_REQUEST_ID_RE = /^fill-[0-9a-f]{32}$/;
const IDENTITY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PRINTABLE_ASCII_RE = /^[\x21-\x7e]+$/;
const PUBLIC_KEY_B64U_RE = /^[A-Za-z0-9_-]{43}$/;
const SEALED_B64U_RE = /^[A-Za-z0-9_-]{68,21846}$/;
const AAC_STDOUT_LOG_LINE_RE = /^\d{4}-\d{2}-\d{2}T\S+\s+(?:WARN|INFO)\b/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const MAX_ORIGIN_CHARS = 256;
const MAX_REMOTE_BODY_BYTES = 256 * 1024;
const MAX_HELPER_BUFFER_BYTES = 64 * 1024;
const MAX_LOG_STDERR_CHARS = 256;
const MAX_REASON_CHARS = 200;
const MAX_PROCESSED_IDS = 512;
const PROCESSED_TTL_MS = 60 * 60_000;
const DEFAULT_POLL_ERROR_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const DEFAULT_EXECUTE_RETRY_BACKOFF_MS = [250, 500, 1_000, 2_000];
function expandHomePath(raw) {
    const trimmed = raw.trim();
    if (trimmed === '~')
        return os.homedir();
    if (trimmed.startsWith('~/'))
        return path.join(os.homedir(), trimmed.slice(2));
    return path.resolve(trimmed);
}
/**
 * Parses `settings.json`'s opt-in `cuVaultFill` block. Returns `null` when
 * absent or disabled (`enabled !== true`). Throws on malformed enabled config.
 */
function readCuVaultFillConfig(settings, baseDishDir = (0, dish_store_1.dishDir)()) {
    const raw = settings[exports.CU_VAULT_FILL_SETTING];
    if (raw === undefined || raw === null || raw === false)
        return null;
    if (!(0, helper_values_1.record)(raw))
        throw new Error('cuVaultFill must be an object');
    if (raw.enabled !== true)
        return null;
    const remote = typeof raw.remote === 'string' ? raw.remote.trim() : '';
    if (!remoteHosts.isValidRemoteName(remote)) {
        throw new Error('cuVaultFill.remote must be a valid configured remote name');
    }
    let identity = exports.DEFAULT_CU_VAULT_FILL_IDENTITY;
    if (raw.identity !== undefined) {
        if (typeof raw.identity !== 'string' || !IDENTITY_NAME_RE.test(raw.identity.trim()) || raw.identity.includes('..')) {
            throw new Error('cuVaultFill.identity must be 1-64 letters, digits, dots, dashes or underscores');
        }
        identity = raw.identity.trim();
    }
    let identitiesDir = path.join(baseDishDir, 'vault', 'identities');
    if (raw.identitiesDir !== undefined) {
        if (typeof raw.identitiesDir !== 'string' || !raw.identitiesDir.trim() || CONTROL_CHAR_RE.test(raw.identitiesDir)) {
            throw new Error('cuVaultFill.identitiesDir must be a non-empty path');
        }
        identitiesDir = expandHomePath(raw.identitiesDir);
    }
    let explicitXdgConfigHome = false;
    let xdgConfigHome = path.join(identitiesDir, identity);
    if (raw.xdgConfigHome !== undefined) {
        if (typeof raw.xdgConfigHome !== 'string' || !raw.xdgConfigHome.trim() || CONTROL_CHAR_RE.test(raw.xdgConfigHome)) {
            throw new Error('cuVaultFill.xdgConfigHome must be a non-empty path');
        }
        explicitXdgConfigHome = true;
        xdgConfigHome = expandHomePath(raw.xdgConfigHome);
    }
    let pollWaitMs = exports.DEFAULT_CU_VAULT_FILL_POLL_WAIT_MS;
    if (raw.pollWaitMs !== undefined) {
        if (typeof raw.pollWaitMs !== 'number' || !Number.isInteger(raw.pollWaitMs)
            || raw.pollWaitMs < 1_000 || raw.pollWaitMs > exports.MAX_CU_VAULT_FILL_POLL_WAIT_MS) {
            throw new Error(`cuVaultFill.pollWaitMs must be an integer between 1000 and ${exports.MAX_CU_VAULT_FILL_POLL_WAIT_MS}`);
        }
        pollWaitMs = raw.pollWaitMs;
    }
    return { remote, identity, identitiesDir, xdgConfigHome, explicitXdgConfigHome, pollWaitMs };
}
function truncateString(value, max) {
    return value.length > max ? value.slice(0, max) : value;
}
function sanitizeSingleLine(value, max) {
    const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return truncateString(cleaned, max);
}
/** Extracts a bounded single-line tail from stderr for logging (last non-empty line, capped from the tail). */
function stderrLogTail(rawStderr, max = MAX_LOG_STDERR_CHARS) {
    const lines = rawStderr.split(/\r?\n/).map(line => line.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!lines.length)
        return '';
    const last = lines[lines.length - 1];
    return last.length > max ? last.slice(-max) : last;
}
/**
 * Extracts the sealed base64url envelope from helper stdout.
 * `aac 0.11.0 --output json run` logs WARN lines via tracing_subscriber to stdout;
 * allow timestamped WARN/INFO prefix lines only when the final non-empty line is a
 * valid sealed envelope. Never logs stdout.
 */
function extractSealedFromStdout(stdout) {
    const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length)
        return null;
    const candidate = lines[lines.length - 1];
    if (!SEALED_B64U_RE.test(candidate))
        return null;
    if (lines.length > 1 && !lines.slice(0, -1).every(line => AAC_STDOUT_LOG_LINE_RE.test(line))) {
        return null;
    }
    return candidate;
}
/** Projects a CU vault fill audit record through a strict secret-free allowlist. */
function projectAuditEntry(entry) {
    return {
        ts: truncateString(entry.ts, 64),
        requestId: truncateString(entry.requestId, 64),
        remote: truncateString(entry.remote, 64),
        origin: truncateString(entry.origin, MAX_ORIGIN_CHARS),
        topOrigin: entry.topOrigin === null ? null : truncateString(entry.topOrigin, MAX_ORIGIN_CHARS),
        item: truncateString(entry.item, 256),
        fields: ALLOWED_FIELDS.filter(field => entry.fields.includes(field)),
        outcome: entry.outcome,
        code: entry.code === null ? null : truncateString(entry.code, 64),
    };
}
function appendAudit(file, entry, maxBytes) {
    const line = `${JSON.stringify(projectAuditEntry(entry))}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let currentSize = 0;
    try {
        currentSize = fs.statSync(file).size;
    }
    catch (error) {
        if (!(0, helper_values_1.record)(error) || error.code !== 'ENOENT')
            throw error;
    }
    if (currentSize > 0 && currentSize + lineBytes > maxBytes) {
        fs.renameSync(file, `${file}.1`);
        fs.chmodSync(`${file}.1`, 0o600);
    }
    const fd = fs.openSync(file, 'a', 0o600);
    try {
        fs.fchmodSync(fd, 0o600);
        fs.writeSync(fd, line);
    }
    finally {
        fs.closeSync(fd);
    }
}
function defaultAuditFile() {
    return path.join((0, dish_store_1.dishDir)(), exports.CU_VAULT_FILL_AUDIT_FILE);
}
function defaultRequestRemote(remoteName, reqOpts) {
    const remote = remoteHosts.getRemote(remoteName);
    if (!remote) {
        return Promise.reject(new Error(`CU vault fill remote "${remoteName}" is not configured`));
    }
    const payload = reqOpts.body !== undefined ? JSON.stringify(reqOpts.body) : null;
    const headers = {
        accept: 'application/json',
        'accept-encoding': 'identity',
    };
    if (payload !== null) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(Buffer.byteLength(payload, 'utf8'));
    }
    return new Promise((resolve, reject) => {
        if (reqOpts.signal?.aborted) {
            reject(new Error('CU vault fill remote request aborted'));
            return;
        }
        let settled = false;
        let clientReq = null;
        const onAbort = () => {
            try {
                clientReq?.destroy();
            }
            catch { }
            finish({ ok: false, error: new Error('CU vault fill remote request aborted') });
        };
        const finish = (outcome) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            reqOpts.signal?.removeEventListener('abort', onAbort);
            if (outcome.ok)
                resolve(outcome.value);
            else
                reject(outcome.error);
        };
        const timer = setTimeout(() => {
            try {
                clientReq?.destroy();
            }
            catch { }
            finish({ ok: false, error: new Error('CU vault fill remote request timed out') });
        }, reqOpts.timeoutMs);
        timer.unref();
        reqOpts.signal?.addEventListener('abort', onAbort, { once: true });
        void remoteHosts.request(remote, { method: reqOpts.method, path: reqOpts.path, headers }).then((req) => {
            clientReq = req;
            if (settled) {
                req.on('error', () => { });
                try {
                    req.destroy();
                }
                catch { }
                return;
            }
            req.on('error', (error) => {
                finish({ ok: false, error: new Error(`CU vault fill remote error: ${String(remoteHosts.errorCode(error))}`) });
            });
            req.on('response', (res) => {
                const chunks = [];
                let total = 0;
                res.on('data', (chunk) => {
                    total += chunk.length;
                    if (total > MAX_REMOTE_BODY_BYTES) {
                        res.destroy();
                        finish({ ok: false, error: new Error('CU vault fill remote response exceeded size limit') });
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('error', () => finish({ ok: false, error: new Error('CU vault fill remote stream failed') }));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let parsed = null;
                    if (text.length > 0) {
                        try {
                            parsed = JSON.parse(text);
                        }
                        catch {
                            parsed = { error: text.slice(0, 200) };
                        }
                    }
                    finish({ ok: true, value: { status: res.statusCode ?? 502, body: parsed } });
                });
            });
            if (payload !== null)
                req.end(payload);
            else
                req.end();
        }).catch((error) => {
            finish({ ok: false, error: new Error(`CU vault fill remote connect failed: ${String(remoteHosts.errorCode(error))}`) });
        });
    });
}
function parsePendingRequest(raw) {
    if (!(0, helper_values_1.record)(raw))
        return null;
    const requestId = typeof raw.requestId === 'string' ? raw.requestId : '';
    if (!FILL_REQUEST_ID_RE.test(requestId))
        return null;
    const rawOrigin = typeof raw.origin === 'string' ? raw.origin : '';
    const parsedOrigin = rawOrigin && rawOrigin.length <= MAX_ORIGIN_CHARS ? (0, vault_approvals_1.parseOrigin)(rawOrigin) : null;
    const rawTopOrigin = typeof raw.topOrigin === 'string' ? raw.topOrigin.trim() : '';
    const parsedTopOrigin = rawTopOrigin && rawTopOrigin.length <= MAX_ORIGIN_CHARS ? (0, vault_approvals_1.parseOrigin)(rawTopOrigin) : null;
    const topOrigin = parsedTopOrigin?.origin ?? null;
    const item = typeof raw.item === 'string' ? sanitizeSingleLine(raw.item, 200) : '';
    const reason = typeof raw.reason === 'string' ? sanitizeSingleLine(raw.reason, 160) || null : null;
    const expiresAtMs = typeof raw.expiresAt === 'string' ? Date.parse(raw.expiresAt) : Number.NaN;
    const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
    const fields = [];
    let hasUnsupportedField = false;
    for (const candidate of rawFields) {
        if (typeof candidate === 'string' && ALLOWED_FIELDS.includes(candidate)) {
            if (!fields.includes(candidate))
                fields.push(candidate);
        }
        else {
            hasUnsupportedField = true;
        }
    }
    const canonicalFields = ALLOWED_FIELDS.filter(field => fields.includes(field));
    const nonce = typeof raw.nonce === 'string' ? raw.nonce : '';
    const publicKey = typeof raw.publicKey === 'string' ? raw.publicKey : '';
    const envelope = (0, helper_values_1.record)(raw.envelope) ? raw.envelope : null;
    let invalidCode;
    if (!parsedOrigin || !parsedOrigin.https || rawOrigin.length > MAX_ORIGIN_CHARS || parsedOrigin.origin !== rawOrigin) {
        invalidCode = 'invalid_origin';
    }
    else if (!item)
        invalidCode = 'invalid_item';
    else if (!canonicalFields.length || hasUnsupportedField)
        invalidCode = 'invalid_fields';
    else if (!nonce || nonce.length > 128 || !PRINTABLE_ASCII_RE.test(nonce) || !PUBLIC_KEY_B64U_RE.test(publicKey)) {
        invalidCode = 'invalid_key_material';
    }
    else if (envelope && (envelope.version !== 1 || envelope.alg !== exports.CU_VAULT_FILL_ENVELOPE_ALG)) {
        invalidCode = 'unsupported_envelope';
    }
    return {
        requestId,
        nonce,
        publicKey,
        origin: parsedOrigin && parsedOrigin.origin === rawOrigin ? parsedOrigin.origin : sanitizeSingleLine(rawOrigin, MAX_ORIGIN_CHARS),
        topOrigin,
        item: item || '(unknown)',
        fields: canonicalFields,
        reason,
        expiresAtMs,
        invalidCode,
    };
}
/** Builds a concise approval reason, surfacing `topOrigin` whenever the form is in a cross-origin frame. */
function buildFillApprovalReason(origin, topOrigin, reason) {
    const frameTag = topOrigin && topOrigin !== origin ? ` (page ${topOrigin})` : '';
    const text = reason ? `CU fill${frameTag}: ${reason}` : `CU vault fill${frameTag}`;
    return truncateString(text, MAX_REASON_CHARS);
}
function buildMinimalHelperEnv(config) {
    fs.mkdirSync(config.xdgConfigHome, { recursive: true, mode: 0o700 });
    try {
        fs.chmodSync(config.xdgConfigHome, 0o700);
    }
    catch { }
    const env = {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        HOME: os.homedir(),
        XDG_CONFIG_HOME: config.xdgConfigHome,
        NO_COLOR: '1',
    };
    if (config.explicitXdgConfigHome) {
        env.PI_DISH_VAULT_IDENTITY_HOME = config.xdgConfigHome;
    }
    else {
        env.PI_DISH_VAULT_IDENTITIES_DIR = config.identitiesDir;
    }
    if (process.env.AAC_BIN)
        env.AAC_BIN = process.env.AAC_BIN;
    if (process.env.PI_DISH_VAULT_RELAY_URL)
        env.PI_DISH_VAULT_RELAY_URL = process.env.PI_DISH_VAULT_RELAY_URL;
    return env;
}
function isRetryableExecuteReply(reply) {
    const body = (0, helper_values_1.record)(reply.body) ? reply.body : {};
    const code = typeof body.code === 'string' && body.code ? body.code : null;
    const retryAfterMs = typeof body.retryAfterMs === 'number' && Number.isFinite(body.retryAfterMs) && body.retryAfterMs > 0
        ? Math.trunc(body.retryAfterMs)
        : null;
    if (!code || !exports.CU_VAULT_FILL_RETRYABLE_CODES.has(code))
        return { retryable: false, code, retryAfterMs };
    if (reply.status === 409
        && (code === 'transition_pending' || code === 'agent_busy' || code === 'fill_in_progress')
        && body.applied !== true
        && body.applied !== 'unknown') {
        return { retryable: true, code, retryAfterMs };
    }
    if (reply.status === 503 && code === 'broker_busy' && body.applied === false) {
        return { retryable: true, code, retryAfterMs };
    }
    return { retryable: false, code, retryAfterMs };
}
function classifyHelperFailure(exitCode, stderr, timedOut, expiredNow) {
    if (timedOut || expiredNow || /no decision in pi-dish within/i.test(stderr)) {
        return { cancelReason: 'timeout', outcome: 'timeout', code: 'approval_timeout' };
    }
    if (/refused before approval:/i.test(stderr)) {
        return { cancelReason: 'denied', outcome: 'refused', code: 'policy_refused' };
    }
    if (exitCode === 4) {
        return { cancelReason: 'denied', outcome: 'denied', code: 'operator_denied' };
    }
    return { cancelReason: 'error', outcome: 'error', code: 'helper_failed' };
}
function createCuVaultFillCoordinator(ports) {
    const { config } = ports;
    const rootDir = ports.rootDirectory ?? path.resolve(__dirname, '..');
    const requestRemote = ports.requestRemote ?? defaultRequestRemote;
    const vaultCli = ports.vaultCli ?? {
        file: process.execPath,
        prefixArgs: [path.join(rootDir, 'skills', 'pi-dish-vault', 'scripts', 'pi-dish-vault.js')],
    };
    const sealerScript = ports.sealerScript ?? path.join(rootDir, 'skills', 'pi-dish-vault', 'scripts', 'cu-fill-seal.js');
    const auditFile = ports.auditFile ?? defaultAuditFile;
    const auditMaxBytes = ports.auditMaxBytes ?? exports.CU_VAULT_FILL_AUDIT_MAX_BYTES;
    const now = ports.now ?? Date.now;
    const pollErrorBackoff = ports.pollErrorBackoffMs ?? DEFAULT_POLL_ERROR_BACKOFF_MS;
    const executeRetryBackoff = ports.executeRetryBackoffMs ?? DEFAULT_EXECUTE_RETRY_BACKOFF_MS;
    const maxExecuteAttempts = Math.max(1, ports.maxExecuteAttempts ?? exports.MAX_CU_VAULT_FILL_EXECUTE_ATTEMPTS);
    const stopCancelTimeoutMs = Math.max(50, ports.stopCancelTimeoutMs ?? exports.CU_VAULT_FILL_STOP_CANCEL_TIMEOUT_MS);
    const log = ports.log ?? ((message) => console.error(`[cu-vault-fill] ${message}`));
    const active = new Map();
    const processed = new Map();
    let started = false;
    let stopped = false;
    let since = 0;
    let pollFailures = 0;
    let pollController = null;
    let pollTimer = null;
    let pollInFlight = false;
    let lastLoggedPollError = null;
    function pruneProcessed() {
        const cutoff = now() - PROCESSED_TTL_MS;
        for (const [id, at] of processed) {
            if (at < cutoff)
                processed.delete(id);
        }
        while (processed.size > MAX_PROCESSED_IDS) {
            const oldest = processed.keys().next().value;
            if (oldest === undefined)
                break;
            processed.delete(oldest);
        }
    }
    function recordAudit(req, outcome, code) {
        try {
            appendAudit(auditFile(), {
                ts: new Date(now()).toISOString(),
                requestId: req.requestId,
                remote: config.remote,
                origin: req.origin,
                topOrigin: req.topOrigin,
                item: req.item,
                fields: req.fields,
                outcome,
                code,
            }, auditMaxBytes);
        }
        catch (error) {
            log(`audit write failed for ${req.requestId}: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
    function sleepCancellable(ms, state) {
        if (stopped || ms <= 0)
            return Promise.resolve(!stopped);
        return new Promise((resolve) => {
            let done = false;
            const finish = (ok) => {
                if (done)
                    return;
                done = true;
                clearTimeout(timer);
                state.cancelWait = () => { };
                resolve(ok);
            };
            const timer = setTimeout(() => finish(!stopped), ms);
            timer.unref();
            state.cancelWait = () => finish(false);
        });
    }
    async function cancelRemote(requestId, reason, options = {}) {
        if (stopped && !options.allowWhenStopped)
            return;
        const timeoutMs = options.timeoutMs ?? exports.CU_VAULT_FILL_CANCEL_TIMEOUT_MS;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref();
        try {
            await requestRemote(config.remote, {
                method: 'POST',
                path: '/api/cu/fill/cancel',
                body: { requestId, reason },
                timeoutMs,
                signal: controller.signal,
            });
        }
        catch (error) {
            if (!stopped)
                log(`cancel ${requestId} (${reason}) failed: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
        finally {
            clearTimeout(timer);
        }
    }
    function runVaultSealer(req, state) {
        const remainingMs = Math.max(1, req.expiresAtMs - now());
        const timeoutSec = Math.min(600, Math.max(10, Math.floor(remainingMs / 1000)));
        const reason = buildFillApprovalReason(req.origin, req.topOrigin, req.reason);
        const argv = [
            ...(vaultCli.prefixArgs ?? []),
            'run',
            '--identity', config.identity,
            '--item', req.item,
            '--origin', req.origin,
            '--reason', reason,
            '--timeout', String(timeoutSec),
            ...req.fields.flatMap(field => ['--env', FIELD_ENV_MAP[field]]),
            '--',
            process.execPath,
            sealerScript,
        ];
        const env = buildMinimalHelperEnv(config);
        const headerJson = JSON.stringify({
            requestId: req.requestId,
            nonce: req.nonce,
            publicKey: req.publicKey,
            label: exports.CU_VAULT_FILL_ENVELOPE_LABEL,
            origin: req.origin,
        });
        return new Promise((resolve) => {
            let settled = false;
            let timedOut = false;
            const finish = (result) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(expiryTimer);
                state.child = null;
                resolve(result);
            };
            const child = (0, node_child_process_1.execFile)(vaultCli.file, argv, { env, maxBuffer: MAX_HELPER_BUFFER_BYTES, windowsHide: true }, (error, stdout, stderr) => {
                const fullStderr = String(stderr || '');
                const stderrTail = stderrLogTail(fullStderr, MAX_LOG_STDERR_CHARS);
                if (error) {
                    const code = typeof error.code === 'number'
                        ? error.code
                        : null;
                    finish({ ok: false, exitCode: code, fullStderr, stderrTail, timedOut });
                    return;
                }
                // Stdout is read strictly as the sealed base64url envelope and never logged.
                const sealed = extractSealedFromStdout(String(stdout || ''));
                if (!sealed) {
                    finish({ ok: false, exitCode: 0, fullStderr, stderrTail, timedOut: false, invalidOutput: true });
                    return;
                }
                finish({ ok: true, sealed });
            });
            state.child = child;
            child.stdin?.on('error', () => { });
            child.stdin?.end(headerJson);
            const expiryTimer = setTimeout(() => {
                timedOut = true;
                try {
                    child.kill('SIGTERM');
                }
                catch { }
            }, remainingMs);
            expiryTimer.unref();
        });
    }
    async function executeSealed(req, sealed, state) {
        let attempt = 0;
        let lastCode = null;
        while (!stopped && now() < req.expiresAtMs && attempt < maxExecuteAttempts) {
            const remainingMs = req.expiresAtMs - now();
            const timeoutMs = Math.min(exports.CU_VAULT_FILL_EXECUTE_TIMEOUT_MS, Math.max(5_000, remainingMs + 5_000));
            let reply;
            try {
                reply = await requestRemote(config.remote, {
                    method: 'POST',
                    path: '/api/cu/fill/execute',
                    body: { requestId: req.requestId, sealed },
                    timeoutMs,
                });
            }
            catch (error) {
                log(`execute ${req.requestId} transport error: ${(0, http_boundary_1.errorMessage)(error)}`);
                await cancelRemote(req.requestId, 'error');
                recordAudit(req, 'failed', 'transport_error');
                return;
            }
            const body = (0, helper_values_1.record)(reply.body) ? reply.body : {};
            if (reply.status === 200 && body.ok === true) {
                recordAudit(req, 'filled', null);
                return;
            }
            const retryInfo = isRetryableExecuteReply(reply);
            lastCode = retryInfo.code ?? `http_${reply.status}`;
            if (retryInfo.retryable) {
                const baseDelay = executeRetryBackoff[Math.min(attempt, executeRetryBackoff.length - 1)] ?? 1_000;
                const delayMs = retryInfo.retryAfterMs !== null
                    ? Math.max(baseDelay, Math.min(retryInfo.retryAfterMs, exports.MAX_CU_VAULT_FILL_RETRY_AFTER_MS))
                    : baseDelay;
                attempt += 1;
                if (attempt >= maxExecuteAttempts)
                    break;
                const waitMs = Math.min(delayMs, Math.max(0, req.expiresAtMs - now()));
                if (waitMs <= 0)
                    break;
                const keepGoing = await sleepCancellable(waitMs, state);
                if (!keepGoing) {
                    recordAudit(req, 'cancelled', 'stopped');
                    return;
                }
                continue;
            }
            const outcome = reply.status === 410 || lastCode === 'expired'
                ? 'timeout'
                : lastCode === 'cancelled'
                    ? 'cancelled'
                    : 'failed';
            log(`execute ${req.requestId} failed (${reply.status} ${lastCode})`);
            recordAudit(req, outcome, lastCode);
            return;
        }
        if (stopped) {
            recordAudit(req, 'cancelled', 'stopped');
            return;
        }
        if (now() >= req.expiresAtMs) {
            await cancelRemote(req.requestId, 'timeout');
            recordAudit(req, 'timeout', lastCode ?? 'expired');
            return;
        }
        await cancelRemote(req.requestId, 'error');
        recordAudit(req, 'failed', lastCode ?? 'retry_exhausted');
    }
    async function handleRequest(req, state) {
        try {
            if (req.invalidCode) {
                log(`rejecting malformed fill request ${req.requestId}: ${req.invalidCode}`);
                await cancelRemote(req.requestId, 'error');
                recordAudit(req, 'error', req.invalidCode);
                return;
            }
            if (!Number.isFinite(req.expiresAtMs) || req.expiresAtMs <= now()) {
                await cancelRemote(req.requestId, 'timeout');
                recordAudit(req, 'timeout', 'expired');
                return;
            }
            const helper = await runVaultSealer(req, state);
            if (state.withdrawn) {
                recordAudit(req, 'cancelled', 'withdrawn');
                return;
            }
            if (stopped) {
                recordAudit(req, 'cancelled', 'stopped');
                return;
            }
            if (!helper.ok) {
                if (helper.invalidOutput) {
                    log(`helper returned invalid sealed output for ${req.requestId}`);
                    await cancelRemote(req.requestId, 'error');
                    recordAudit(req, 'error', 'invalid_sealed_output');
                    return;
                }
                const classified = classifyHelperFailure(helper.exitCode, helper.fullStderr, helper.timedOut, now() >= req.expiresAtMs);
                if (helper.stderrTail) {
                    log(`${req.requestId} ${classified.code}: ${helper.stderrTail}`);
                }
                await cancelRemote(req.requestId, classified.cancelReason);
                recordAudit(req, classified.outcome, classified.code);
                return;
            }
            state.phase = 'executing';
            if (now() >= req.expiresAtMs) {
                await cancelRemote(req.requestId, 'timeout');
                recordAudit(req, 'timeout', 'expired');
                return;
            }
            await executeSealed(req, helper.sealed, state);
        }
        finally {
            active.delete(req.requestId);
            pruneProcessed();
            processed.set(req.requestId, now());
        }
    }
    async function pollOnce() {
        if (stopped || pollInFlight)
            return;
        pollInFlight = true;
        const controller = new AbortController();
        pollController = controller;
        try {
            const qs = `since=${since}&waitMs=${config.pollWaitMs}`;
            const reply = await requestRemote(config.remote, {
                method: 'GET',
                path: `/api/cu/fill/pending?${qs}`,
                timeoutMs: config.pollWaitMs + 15_000,
                signal: controller.signal,
            });
            if (stopped)
                return;
            if (reply.status !== 200 || !(0, helper_values_1.record)(reply.body) || !Array.isArray(reply.body.requests)) {
                const msg = `pending poll returned HTTP ${reply.status}`;
                if (msg !== lastLoggedPollError) {
                    lastLoggedPollError = msg;
                    log(msg);
                }
                pollFailures = Math.min(pollFailures + 1, pollErrorBackoff.length);
                return;
            }
            pollFailures = 0;
            lastLoggedPollError = null;
            if (typeof reply.body.seq === 'number' && Number.isSafeInteger(reply.body.seq) && reply.body.seq >= 0) {
                // Broker restart resets seq back to 0: accept lower seq cleanly.
                since = reply.body.seq;
            }
            const seenInBroker = new Set();
            for (const rawReq of reply.body.requests) {
                const parsed = parsePendingRequest(rawReq);
                if (!parsed)
                    continue;
                seenInBroker.add(parsed.requestId);
                if (active.has(parsed.requestId) || processed.has(parsed.requestId))
                    continue;
                const state = { phase: 'approving', withdrawn: false, child: null, cancelWait: () => { } };
                active.set(parsed.requestId, state);
                void handleRequest(parsed, state);
            }
            // If a pending approval disappeared from the broker (superseded, expired,
            // or cancelled by the agent), stop the waiting helper so the card clears.
            for (const [requestId, state] of active) {
                if (state.phase === 'approving' && !seenInBroker.has(requestId)) {
                    state.withdrawn = true;
                    try {
                        state.child?.kill('SIGTERM');
                    }
                    catch { }
                }
            }
        }
        catch (error) {
            if (stopped || controller.signal.aborted)
                return;
            const msg = (0, http_boundary_1.errorMessage)(error);
            if (msg !== lastLoggedPollError) {
                lastLoggedPollError = msg;
                log(`pending poll failed: ${msg}`);
            }
            pollFailures = Math.min(pollFailures + 1, pollErrorBackoff.length);
        }
        finally {
            if (pollController === controller)
                pollController = null;
            pollInFlight = false;
        }
    }
    function scheduleNextPoll() {
        if (stopped || !started)
            return;
        const delayMs = pollFailures > 0
            ? (pollErrorBackoff[Math.min(pollFailures - 1, pollErrorBackoff.length - 1)] ?? 15_000)
            : 0;
        pollTimer = setTimeout(() => {
            pollTimer = null;
            void pollOnce().finally(() => {
                if (!stopped && started)
                    scheduleNextPoll();
            });
        }, delayMs);
        pollTimer.unref();
    }
    return {
        start() {
            if (started || stopped)
                return;
            started = true;
            scheduleNextPoll();
        },
        stop() {
            if (stopped)
                return;
            stopped = true;
            if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }
            if (pollController) {
                pollController.abort();
                pollController = null;
            }
            for (const [requestId, state] of active) {
                state.cancelWait();
                try {
                    state.child?.kill('SIGTERM');
                }
                catch { }
                // Best-effort, strictly bounded cancel with unref'd timer so shutdown never hangs.
                void cancelRemote(requestId, 'cancelled', { allowWhenStopped: true, timeoutMs: stopCancelTimeoutMs });
            }
        },
        pollOnce,
        activeCount: () => active.size,
    };
}
