// Generated from src/core/recovery-runner.ts; edit that source and run npm run build:core.
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
exports.RECOVERY_PROMPT = void 0;
exports.recoveryMode = recoveryMode;
exports.continuationSafety = continuationSafety;
exports.createRecoveryRunner = createRecoveryRunner;
exports.createTmuxLossLimiter = createTmuxLossLimiter;
exports.watchTmuxServer = watchTmuxServer;
exports.createRecoveryRuntime = createRecoveryRuntime;
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");
const promises_1 = require("timers/promises");
const bridge_session_1 = require("./bridge-session");
const prime_daemon_1 = require("./prime-daemon");
const dish_store_1 = require("./dish-store");
const helper_models_1 = require("./helper-models");
const process_identity_1 = require("./process-identity");
const session_operations_1 = require("./session-operations");
const session_ownership_1 = require("./session-ownership");
const session_key_1 = require("./session-key");
const recoveryStore = __importStar(require("./session-recovery"));
const helper_values_1 = require("./helper-values");
const http_boundary_1 = require("./http-boundary");
const MAX_SESSIONS = 5000;
exports.RECOVERY_PROMPT = 'pi-dish recovery: this session was interrupted while work was in progress. Before continuing, inspect the transcript, working files, and any external state affected by prior tools. A tool or external action may have completed without its result being recorded. Do not blindly repeat commands, writes, deployments, purchases, or other side effects. Reconcile what actually happened, explain any uncertainty, and ask for confirmation where safe continuation cannot be established. Continue the existing task only after this inspection; this message is not an instruction to replay the last prompt or retry a tool.';
const HIBERNATED_REASON = 'Hibernated under memory pressure; a message resumes it.';
const RUNNING_STATUSES = { live: true, restored: true, continued: true };
/** Harnesses whose lifecycle observations and bridge prompt path are verified. */
const PROMPT_RECOVERY_HARNESSES = { pi: true, omp: true, agy: true };
const TMUX_LOSS_STATE_VERSION = 1;
const MAX_TMUX_LOSS_STATE_BYTES = 64 * 1024;
const DEFAULT_LOSS_BACKOFF_MS = 5 * 60_000;
const DEFAULT_LOSS_MAX_BACKOFF_MS = 30 * 60_000;
const DEFAULT_LOSS_WINDOW_MS = 60 * 60_000;
const DEFAULT_LOSS_MAX_ATTEMPTS = 3;
function recoveryMode(value) {
    return value === 'off' || value === 'restore' || value === 'continue' ? value : 'off';
}
// Stream with explicit bounds: a corrupt/huge transcript is reviewable, not a
// reason to allocate the whole corpus or guess whether a tool finished.
async function continuationSafety(file) {
    let stat;
    try {
        stat = fs.statSync(file);
    }
    catch {
        return 'The transcript cannot be read.';
    }
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
        return 'The transcript exceeds the safe continuation inspection limit.';
    const input = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 16 * 1024 });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const pending = new Set();
    let count = 0, lastMessage = null, lastType = null;
    try {
        for await (const line of lines) {
            if (!line.trim())
                continue;
            if (++count > 200000 || line.length > 4 * 1024 * 1024)
                return 'The transcript exceeds the safe continuation inspection limit.';
            let entry;
            try {
                entry = JSON.parse(line);
            }
            catch {
                return 'The transcript contains an incomplete or corrupt entry.';
            }
            if (!(0, helper_values_1.record)(entry))
                return 'The transcript contains an incomplete or corrupt entry.';
            lastType = entry.type;
            if (lastType !== 'message')
                continue;
            const message = entry.message;
            if (!(0, helper_values_1.record)(message) || typeof message.role !== 'string')
                return 'The transcript contains an unverifiable message.';
            lastMessage = message;
            if (message.role === 'assistant') {
                for (const block of Array.isArray(message.content) ? message.content : []) {
                    if (!(0, helper_values_1.record)(block))
                        return 'The transcript contains an unverifiable assistant content block.';
                    if (block.type !== 'toolCall' && block.type !== 'tool_use')
                        continue;
                    const id = block.id;
                    if (typeof id !== 'string')
                        return 'A tool call has no verifiable identity.';
                    pending.add(id);
                    if (pending.size > 10000)
                        return 'Too many unresolved tool calls to verify safely.';
                }
            }
            else if (message.role === 'toolResult') {
                const toolCallId = message.toolCallId;
                if (typeof toolCallId !== 'string')
                    return 'A tool result has no verifiable identity.';
                pending.delete(toolCallId);
            }
        }
    }
    catch {
        return 'The transcript cannot be inspected safely.';
    }
    finally {
        lines.close();
        input.destroy();
    }
    if (pending.size)
        return 'Tool calls have no recorded result; inspect their external effects before continuing.';
    if (lastType === 'compaction' || lastType === 'branch_summary')
        return 'The transcript ends during compaction or branch navigation.';
    if (!lastMessage)
        return 'There is no interrupted conversation to continue.';
    if (lastMessage.role === 'assistant') {
        const stopReason = lastMessage.stopReason;
        if (stopReason === 'aborted' || stopReason === 'error')
            return 'The last assistant response was aborted or failed.';
        if (stopReason !== 'toolUse')
            return 'The last assistant response may already have completed.';
    }
    return null;
}
function createRecoveryRunner(deps) {
    const { store, getMode, routeId, probeLive, validateRecord, restore, continueSession, now = () => Date.now(), log = console, hibernated = () => false, isPendingClose = () => false, isPrivate = () => false, suppressedAtStartup = () => null } = deps;
    const reports = new Map();
    const reportObservations = new Map();
    const flights = new Map();
    /** Sessions a tmux server loss took down, until one of them runs again. */
    const lost = new Set();
    /** Routes affected by confirmed tmux server loss: must never receive an automatic paid continuation prompt. */
    const restoreOnly = new Set();
    let startPromise = null;
    let stopped = false;
    function safeRouteId(record) {
        if (!(0, session_key_1.validSessionId)(record.nativeSessionId))
            return null;
        try {
            const id = routeId(record);
            return (0, session_ownership_1.routeIdentity)(id) ? id : null;
        }
        catch {
            return null;
        }
    }
    function markLostRestoreOnly(ids) {
        for (const id of ids) {
            restoreOnly.add(id);
            lost.add(id);
        }
    }
    function remember(record, status, reason) {
        const id = routeId(record);
        const row = { id, harnessId: record.harnessId, name: record.name || null,
            cwd: record.cwd || null, excluded: !!store.getControl(record.harnessId, record.nativeSessionId).excluded,
            status, reason: reason || null, updatedAt: now() };
        if (!reports.has(id) && reports.size >= MAX_SESSIONS) {
            const oldest = reports.keys().next();
            if (!oldest.done) {
                reports.delete(oldest.value);
                reportObservations.delete(oldest.value);
            }
        }
        reports.set(id, row);
        reportObservations.set(id, store.readRecord(record.harnessId, record.nativeSessionId)?.observationId || record.observationId);
        return row;
    }
    function save(record, status, reason, extra = {}) {
        const control = store.getControl(record.harnessId, record.nativeSessionId);
        const attempt = { ...control.attempt, ...extra, observationId: record.observationId,
            status, reason: reason || null, updatedAt: now() };
        store.patchControl(record.harnessId, record.nativeSessionId, { attempt });
        return remember(record, status, reason);
    }
    function newestRecords() {
        return store.listRecords().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    function report({ includePrivate = true } = {}) {
        const rows = new Map();
        const allRecords = newestRecords();
        const records = allRecords.filter(record => {
            if (!safeRouteId(record))
                return false;
            return includePrivate || !isPrivate(record);
        });
        for (const record of records.slice(0, MAX_SESSIONS)) {
            const id = safeRouteId(record);
            const control = store.getControl(record.harnessId, record.nativeSessionId);
            let row = reports.get(id);
            const previous = control.attempt;
            const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
            if (row && (row.status === 'pending' || row.status === 'failed' || row.status === 'needs-review')
                && reportObservations.get(id) !== record.observationId && !ambiguous)
                row = null;
            if (!row) {
                const attempt = ambiguous || previous?.observationId === record.observationId ? previous : null;
                row = { id, harnessId: record.harnessId, name: record.name || null, cwd: record.cwd || null,
                    status: ambiguous ? 'needs-review' : attempt?.status || (record.shutdown ? 'needs-review' : 'pending'),
                    reason: ambiguous ? 'An earlier recovery attempt has an uncertain outcome; no automatic replay is allowed.'
                        : attempt?.reason || (record.shutdown ? 'The harness shut down; quit, reload, and operating-system shutdown cannot be distinguished.' : null),
                    updatedAt: attempt?.updatedAt || record.updatedAt };
            }
            rows.set(id, { ...row, excluded: !!control.excluded,
                ...(control.closed ? { status: 'closed', reason: 'This session was explicitly closed.' }
                    : hibernated(id) ? { status: 'pending', reason: HIBERNATED_REASON }
                        : control.excluded ? { reason: 'Excluded from automatic recovery.' } : {}) });
        }
        return { mode: recoveryMode(getMode()), sessions: [...rows.values()],
            truncated: records.length > MAX_SESSIONS, totalRecords: records.length };
    }
    async function run(record, trigger) {
        const id = routeId(record);
        const explicit = trigger === 'explicit';
        const isRestoreOnly = () => restoreOnly.has(id);
        const previous = store.getControl(record.harnessId, record.nativeSessionId).attempt;
        const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
        // Settings, a newer observation, or a confirmed tmux loss can cancel continuation at any await.
        function continuationRefusal(advanced) {
            if (isRestoreOnly()) {
                return {
                    status: 'needs-review',
                    reason: 'Restored idle after tmux server loss without sending a prompt; inspect interrupted work before continuing.',
                };
            }
            const control = store.getControl(record.harnessId, record.nativeSessionId);
            if (stopped || control.closed || control.excluded || recoveryMode(getMode()) !== 'continue') {
                return { status: 'restored', reason: 'Restored; continuation was cancelled by current recovery settings.' };
            }
            const current = store.readRecord(record.harnessId, record.nativeSessionId);
            return !current || current.observationId !== record.observationId || current.activity !== 'running'
                || current.runId !== record.runId || !store.checkpointMatches(record) ? { status: 'needs-review', reason: advanced } : null;
        }
        try {
            // Always prefer a fresh socket/process identity to a historical record.
            const live = await probeLive(record);
            if (ambiguous && !explicit)
                return remember(record, 'needs-review', 'An earlier recovery launch or prompt has an uncertain outcome; inspect it before retrying.');
            if (live)
                return remember(record, ambiguous ? 'needs-review' : 'live', ambiguous
                    ? 'The session is live, but an earlier recovery prompt has uncertain delivery. It was not resent.' : 'Attached to the surviving session; no prompt was sent.');
            const control = store.getControl(record.harnessId, record.nativeSessionId);
            if (control.closed)
                return remember(record, 'closed', 'This session was explicitly closed.');
            if (isPendingClose(id) && !explicit)
                return remember(record, 'closed', 'Routine one-shot session was pending auto-close.');
            if (hibernated(id) && !explicit)
                return remember(record, 'pending', HIBERNATED_REASON);
            if (control.excluded)
                return remember(record, 'pending', 'Excluded from automatic recovery.');
            if (stopped || (!explicit && recoveryMode(getMode()) === 'off'))
                return remember(record, 'pending', 'Automatic recovery is off.');
            if (trigger === 'startup') {
                const suppressedReason = suppressedAtStartup(id);
                if (suppressedReason)
                    return remember(record, 'needs-review', suppressedReason);
            }
            if (!explicit && record.shutdown) {
                return remember(record, 'needs-review', 'The harness shut down; quit, reload, and operating-system shutdown cannot be distinguished.');
            }
            const repeatIdleRestore = record.activity === 'idle' && previous?.status === 'restored' && !previous.delivery;
            if (!explicit && previous?.observationId === record.observationId && !repeatIdleRestore) {
                return remember(record, 'needs-review', previous.reason || 'This observation was already recovered; automatic retries are disabled.');
            }
            await validateRecord(record);
            const matched = store.checkpointMatches(record);
            let safety = null;
            if (!isRestoreOnly() && trigger === 'startup' && recoveryMode(getMode()) === 'continue' && record.activity !== 'idle') {
                safety = record.activity !== 'running' || !record.runId
                    ? 'The interrupted activity cannot be classified safely.'
                    : !matched ? 'The transcript changed after the last durable observation; no prompt was sent.'
                        : !Object.hasOwn(PROMPT_RECOVERY_HARNESSES, record.harnessId) ? 'This harness has no verified recovery prompt path.'
                            : await continuationSafety(record.sessionFile);
            }
            else if (isRestoreOnly() && !explicit && recoveryMode(getMode()) === 'continue' && record.activity === 'running') {
                safety = !matched
                    ? 'The transcript changed after the last durable observation; restored idle without prompting.'
                    : await continuationSafety(record.sessionFile);
            }
            // Durable intent precedes even the launch. A crash after this point is
            // ambiguous until a live identity or an explicit restore-only retry.
            save(record, 'restoring', null, { id: crypto.randomUUID(), delivery: previous?.delivery === 'uncertain' ? 'uncertain' : null });
            const result = await restore(record);
            // A returned launch is not a running agent: restored means a live, registered session now.
            const session = await probeLive(record);
            if (!session) {
                throw new Error('The agent was launched but is not running with a registered bridge, so it was not restored.');
            }
            if (result.alreadyActive || result.sharedResume)
                return save(record, 'live', 'Another caller restored this session; no recovery prompt was sent.');
            if (isRestoreOnly()) {
                if (previous?.delivery === 'uncertain') {
                    return save(record, 'needs-review', 'Restored without resending the earlier uncertain recovery prompt.');
                }
                if (!explicit && recoveryMode(getMode()) === 'continue' && record.activity === 'running') {
                    const inspection = safety ?? (!store.checkpointMatches(record)
                        ? 'The transcript changed after the last durable observation; restored idle without prompting.'
                        : await continuationSafety(record.sessionFile));
                    return save(record, 'needs-review', inspection || 'Restored idle after tmux server loss without sending a prompt; inspect interrupted work before continuing.');
                }
                return save(record, 'restored', 'Restored without sending a prompt.');
            }
            if (explicit || recoveryMode(getMode()) !== 'continue' || record.activity === 'idle') {
                return save(record, previous?.delivery === 'uncertain' ? 'needs-review' : 'restored', previous?.delivery === 'uncertain'
                    ? 'Restored without resending the earlier uncertain recovery prompt.' : 'Restored without sending a prompt.');
            }
            if (safety)
                return save(record, 'needs-review', safety);
            const refusal = continuationRefusal('The session or transcript advanced during recovery; no prompt was sent.');
            if (refusal)
                return save(record, refusal.status, refusal.reason);
            if (session.turnInProgress || session.compacting)
                return save(record, 'needs-review', 'The restored session is unavailable, already working, or compacting; no prompt was sent.');
            // A second checkpoint immediately before durable delivery intent closes
            // the asynchronous live-handshake window. Delivery is never retried.
            const beforeDelivery = continuationRefusal('The session advanced before delivery; no prompt was sent.');
            if (beforeDelivery)
                return save(record, beforeDelivery.status, beforeDelivery.reason);
            if (isRestoreOnly()) {
                return save(record, 'needs-review', 'Restored idle after tmux server loss without sending a prompt; inspect interrupted work before continuing.');
            }
            save(record, 'restoring', 'Recovery prompt delivery is in progress.', { delivery: 'uncertain' });
            await continueSession(record, session, exports.RECOVERY_PROMPT);
            return save(record, 'continued', 'Sent one visible recovery prompt to inspect state before continuing.', { delivery: 'confirmed' });
        }
        catch (error) {
            const attempt = store.getControl(record.harnessId, record.nativeSessionId).attempt;
            const uncertain = attempt?.delivery === 'uncertain' || attempt?.status === 'restoring';
            try {
                return save(record, uncertain ? 'needs-review' : 'failed', (0, http_boundary_1.errorMessage)(error));
            }
            catch (persistError) {
                log.error?.(`Recovery ${id}: ${(0, http_boundary_1.errorMessage)(persistError)}`);
                return remember(record, 'failed', `Recovery state could not be persisted: ${(0, http_boundary_1.errorMessage)(persistError)}. ${(0, http_boundary_1.errorMessage)(error)}`);
            }
        }
    }
    function recover(record, trigger = 'startup') {
        const id = routeId(record);
        const existing = flights.get(id);
        if (existing)
            return existing;
        const flight = Promise.resolve().then(() => run(record, trigger)).then(outcome => {
            if (Object.hasOwn(RUNNING_STATUSES, outcome.status))
                lost.delete(id);
            return outcome;
        });
        flights.set(id, flight);
        flight.finally(() => { if (flights.get(id) === flight)
            flights.delete(id); }).catch(() => { });
        return flight;
    }
    function start() {
        if (startPromise)
            return startPromise;
        // Capture once, before any await or recovered harness can overwrite it.
        const records = [];
        if (recoveryMode(getMode()) !== 'off') {
            for (const record of newestRecords()) {
                if (!safeRouteId(record))
                    continue;
                const control = store.getControl(record.harnessId, record.nativeSessionId);
                if (control.closed || control.excluded)
                    continue;
                records.push(record);
                if (records.length === MAX_SESSIONS)
                    break;
            }
        }
        startPromise = (async () => {
            for (const record of records) {
                if (stopped)
                    break;
                await recover(record, 'startup');
            }
        })();
        return startPromise;
    }
    async function retry(id, { includePrivate = false } = {}) {
        const parsed = (0, session_ownership_1.routeIdentity)(id);
        if (!parsed)
            throw new session_operations_1.SessionOperationError(400, 'Invalid session ID');
        const canonical = (0, session_ownership_1.routeSessionId)(parsed.harnessId, parsed.nativeSessionId);
        const record = store.listRecords().find(candidate => {
            const candidateId = safeRouteId(candidate);
            if (!candidateId)
                return false;
            if (candidateId === id || candidateId === canonical)
                return true;
            const candidateIdentity = (0, session_ownership_1.routeIdentity)(candidateId);
            return !!candidateIdentity && (0, session_ownership_1.routeSessionId)(candidateIdentity.harnessId, candidateIdentity.nativeSessionId) === canonical;
        });
        if (!record)
            throw new session_operations_1.SessionOperationError(404, 'Recovery record not found');
        if (!includePrivate && isPrivate(record))
            throw new session_operations_1.SessionOperationError(404, 'Recovery record not found');
        return recover(record, 'explicit');
    }
    // Sequential: each launch waits for its registration, and a host that just
    // lost its tmux server may be short of memory. Needs-review, ambiguous and
    // locked private sessions stay out of bulk retry.
    async function retryAll({ includePrivate = false } = {}) {
        const statusById = new Map(report({ includePrivate }).sessions.map(row => [row.id, row.status]));
        const outcomes = [];
        for (const record of newestRecords()) {
            if (stopped)
                break;
            const id = safeRouteId(record);
            if (!id)
                continue;
            if (!includePrivate && isPrivate(record))
                continue;
            const control = store.getControl(record.harnessId, record.nativeSessionId);
            if (control.closed || control.excluded || hibernated(id) || isPendingClose(id))
                continue;
            const previous = control.attempt;
            if (previous?.delivery === 'uncertain' || previous?.status === 'restoring')
                continue;
            const status = statusById.get(id);
            if (status !== 'failed' && !(lost.has(id) && status === 'pending'))
                continue;
            outcomes.push(await recover(record, 'explicit'));
        }
        return outcomes;
    }
    /**
     * Marks sessions affected by a confirmed tmux server loss without launching
     * them automatically. Idle sessions stay `pending` for manual single/bulk
     * retry; interrupted running turns and ambiguous deliveries stay `needs-review`.
     */
    async function markLost(ids, reason) {
        markLostRestoreOnly(ids);
        const wanted = new Set(ids);
        const outcomes = [];
        for (const record of newestRecords()) {
            if (stopped)
                break;
            const id = safeRouteId(record);
            if (!id || !wanted.has(id))
                continue;
            const control = store.getControl(record.harnessId, record.nativeSessionId);
            if (control.closed) {
                lost.delete(id);
                outcomes.push(remember(record, 'closed', 'This session was explicitly closed.'));
                continue;
            }
            if (isPendingClose(id)) {
                lost.delete(id);
                outcomes.push(remember(record, 'closed', 'Routine one-shot session was pending auto-close.'));
                continue;
            }
            if (hibernated(id)) {
                lost.delete(id);
                outcomes.push(remember(record, 'pending', HIBERNATED_REASON));
                continue;
            }
            if (control.excluded) {
                lost.delete(id);
                outcomes.push(remember(record, 'pending', 'Excluded from automatic recovery.'));
                continue;
            }
            const running = await probeLive(record).catch(() => null);
            if (running) {
                lost.delete(id);
                outcomes.push(remember(record, 'live', 'Attached to the surviving session; no prompt was sent.'));
                continue;
            }
            const previous = control.attempt;
            const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
            if (ambiguous) {
                outcomes.push(remember(record, 'needs-review', 'An earlier recovery launch or prompt has an uncertain outcome; inspect it before retrying.'));
                continue;
            }
            let nextStatus = 'pending';
            let nextReason = reason || 'Lost when the pi-dish tmux server died; retry manually to restore idle without prompting.';
            if (record.activity === 'running') {
                nextStatus = 'needs-review';
                const safety = !store.checkpointMatches(record)
                    ? 'The transcript changed after the last durable observation; inspect work and retry manually to restore idle.'
                    : await continuationSafety(record.sessionFile);
                nextReason = safety || 'Interrupted when the pi-dish tmux server died; inspect work and retry manually to restore idle.';
            }
            lost.add(id);
            try {
                outcomes.push(save(record, nextStatus, nextReason));
            }
            catch (persistError) {
                log.error?.(`Recovery ${id}: ${(0, http_boundary_1.errorMessage)(persistError)}`);
                outcomes.push(remember(record, nextStatus, nextReason));
            }
        }
        return outcomes;
    }
    return {
        start, retry, retryAll, markLostRestoreOnly, markLost,
        isRecovering: id => flights.has(id),
        report, outcome: id => reports.get(id) ?? null,
        stop: () => { stopped = true; },
    };
}
function formatDuration(ms) {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes}m`;
}
function ensurePrivateDir(dir) {
    const firstCreated = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    if (firstCreated) {
        let current = dir;
        for (;;) {
            (0, dish_store_1.syncDirectory)(current);
            if (current === path.dirname(firstCreated))
                break;
            current = path.dirname(current);
        }
    }
}
/**
 * Durable exponential-backoff and rolling-window limiter for automatic tmux
 * server-loss recovery. Persisted on disk so crash loops across pi-dish
 * restarts cannot respawn forever; fails closed if the state file is corrupt.
 */
function createTmuxLossLimiter(options = {}) {
    const fileOf = options.file ?? (() => path.join((0, dish_store_1.dishDir)(), 'tmux-recovery-state.json'));
    const now = options.now ?? (() => Date.now());
    const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_LOSS_BACKOFF_MS;
    const maxBackoffMs = Math.max(baseBackoffMs, options.maxBackoffMs ?? DEFAULT_LOSS_MAX_BACKOFF_MS);
    const windowMs = options.windowMs ?? DEFAULT_LOSS_WINDOW_MS;
    const maxAttempts = options.maxAttempts ?? DEFAULT_LOSS_MAX_ATTEMPTS;
    function readState() {
        const file = fileOf();
        let fd;
        try {
            fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.size > MAX_TMUX_LOSS_STATE_BYTES) {
                throw new Error('Invalid tmux recovery rate-limit state file');
            }
            const parsed = JSON.parse(fs.readFileSync(fd, 'utf8'));
            if (!(0, helper_values_1.record)(parsed)
                || parsed.version !== TMUX_LOSS_STATE_VERSION
                || !Array.isArray(parsed.attempts)
                || !parsed.attempts.every(entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0)
                || typeof parsed.nextAllowedAt !== 'number'
                || !Number.isFinite(parsed.nextAllowedAt)
                || parsed.nextAllowedAt < 0) {
                throw new Error('Corrupt tmux recovery rate-limit state');
            }
            return {
                version: TMUX_LOSS_STATE_VERSION,
                attempts: [...parsed.attempts],
                nextAllowedAt: parsed.nextAllowedAt,
            };
        }
        catch (error) {
            if ((0, helper_values_1.record)(error) && error.code === 'ENOENT') {
                return { version: TMUX_LOSS_STATE_VERSION, attempts: [], nextAllowedAt: 0 };
            }
            throw error;
        }
        finally {
            if (fd !== undefined)
                fs.closeSync(fd);
        }
    }
    function writeState(next) {
        const file = fileOf();
        ensurePrivateDir(path.dirname(file));
        (0, dish_store_1.replaceFileDurably)(file, JSON.stringify(next));
    }
    function check(at = now()) {
        let state;
        try {
            state = readState();
        }
        catch {
            return {
                allowed: false,
                retryAt: null,
                reason: 'Tmux recovery rate-limit state is corrupt or unreadable; automatic recovery is paused until inspected.',
            };
        }
        const recent = state.attempts.filter(ts => at - ts < windowMs);
        if (recent.length >= maxAttempts) {
            const oldest = Math.min(...recent);
            const retryAt = oldest + windowMs;
            return {
                allowed: false,
                retryAt,
                reason: `Automatic tmux server-loss recovery reached its limit of ${maxAttempts} attempt(s) within ${formatDuration(windowMs)}; inspect why the tmux server is dying before retrying.`,
            };
        }
        if (state.nextAllowedAt > at) {
            return {
                allowed: false,
                retryAt: state.nextAllowedAt,
                reason: `Tmux server was lost again during automatic recovery backoff (${formatDuration(state.nextAllowedAt - at)} remaining); inspect why the tmux server is dying before retrying.`,
            };
        }
        return { allowed: true };
    }
    function record(at = now()) {
        const state = readState();
        const recent = [...state.attempts.filter(ts => at - ts < windowMs), at];
        const backoff = Math.min(maxBackoffMs, baseBackoffMs * (2 ** (recent.length - 1)));
        writeState({
            version: TMUX_LOSS_STATE_VERSION,
            attempts: recent,
            nextAllowedAt: Math.max(state.nextAllowedAt, at + backoff),
        });
    }
    return { check, record };
}
/**
 * Watches one tmux server (pi-dish's own socket). Remembers its exact process
 * identity and the live agents/bots verified inside its non-dead panes. Only
 * when that server process exits or is replaced by a different server are those
 * agents and bots handed to `onLost` — never when one session exits while the
 * server stays alive, and never when a running server is merely slow to answer.
 */
function watchTmuxServer({ socket, inspectServer, configureServer, snapshotSessions, onLossDetected, onLost, intervalMs = 10_000, settleMs = 500, exitWaitMs = 10_000, processAlive = process_identity_1.processIdentityAlive, log = console, }) {
    let known = null;
    let timer;
    let stopped = false;
    let inFlight = null;
    let pendingCheck = false;
    const stopController = new AbortController();
    async function sleep(ms) {
        if (ms <= 0 || stopped)
            return;
        try {
            await (0, promises_1.setTimeout)(ms, undefined, { ref: false, signal: stopController.signal });
        }
        catch { /* aborted on stop */ }
    }
    async function waitForProcessesExit(processes) {
        if (processes.length && exitWaitMs > 0) {
            const deadline = Date.now() + exitWaitMs;
            while (!stopped && Date.now() < deadline && processes.some(processAlive)) {
                await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
            }
        }
        await sleep(settleMs);
    }
    async function observeRunning(snapshot, alreadyConfigured) {
        // Only configure or watch a server after verifying at least one live
        // pi-dish placement inside it — never mutate an unverified server.
        const observed = snapshotSessions(socket, snapshot.panes);
        if (!observed.agentIds.length && !observed.botIds.length) {
            known = null;
            return;
        }
        let configured = alreadyConfigured;
        if (configureServer && !configured) {
            try {
                const result = await configureServer(socket);
                configured = result !== false;
            }
            catch {
                configured = false;
            }
        }
        known = { server: snapshot.server, ...observed, configured };
    }
    async function pollOnce() {
        if (stopped)
            return;
        const snapshot = await inspectServer(socket);
        if (stopped)
            return;
        if (known && (!snapshot || !(0, session_ownership_1.sameProcessIdentity)(snapshot.server, known.server))) {
            // A server process that is still alive but did not answer is slow, not lost.
            if (!snapshot && processAlive(known.server))
                return;
            const lostServer = known;
            known = null;
            const event = {
                server: lostServer.server,
                replacementPid: snapshot?.pid ?? null,
                agentIds: lostServer.agentIds,
                botIds: lostServer.botIds,
            };
            onLossDetected?.(event);
            await waitForProcessesExit(lostServer.processes);
            if (stopped)
                return;
            await onLost(event);
            if (stopped)
                return;
            // Immediately record the replacement server's identity and restored panes
            // so a second crash within the backoff window is caught immediately.
            const after = await inspectServer(socket);
            if (!stopped && after)
                await observeRunning(after, false);
            return;
        }
        if (snapshot) {
            const sameServer = !!known && (0, session_ownership_1.sameProcessIdentity)(snapshot.server, known.server);
            await observeRunning(snapshot, sameServer && known.configured);
        }
    }
    function runTick() {
        if (stopped)
            return Promise.resolve();
        if (inFlight) {
            pendingCheck = true;
            return inFlight;
        }
        const run = (async () => {
            try {
                await pollOnce();
            }
            finally {
                inFlight = null;
                if (pendingCheck && !stopped) {
                    pendingCheck = false;
                    void runTick().catch(error => log.error?.(`tmux server watch ${socket}: ${(0, http_boundary_1.errorMessage)(error)}`));
                }
            }
        })();
        inFlight = run;
        return run;
    }
    function schedule() {
        if (stopped)
            return;
        timer = setTimeout(() => {
            runTick().catch(error => log.error?.(`tmux server watch ${socket}: ${(0, http_boundary_1.errorMessage)(error)}`)).finally(schedule);
        }, intervalMs);
        timer.unref?.();
    }
    schedule();
    return {
        tick: runTick,
        checkNow: () => {
            if (stopped)
                return;
            void runTick().catch(error => log.error?.(`tmux server watch ${socket}: ${(0, http_boundary_1.errorMessage)(error)}`));
        },
        stop: () => {
            stopped = true;
            clearTimeout(timer);
            stopController.abort();
        },
    };
}
/** Checked production restore/delivery policy; callers provide owners and presentation, not authority callbacks. */
function createRecoveryRuntime({ operations, ownership, getMode, now, log, hibernated, isPendingClose, isPrivate, suppressedAtStartup, }) {
    return createRecoveryRunner({
        store: recoveryStore,
        getMode,
        now,
        log,
        hibernated,
        isPendingClose,
        isPrivate,
        suppressedAtStartup,
        routeId: session_ownership_1.recoveryRouteId,
        probeLive: operations.probeRecoveryLive,
        validateRecord: session_ownership_1.validateRecoveryRecord,
        restore: async (record) => {
            const model = ['pi', 'omp'].includes(record.harnessId) ? (0, helper_models_1.formatModelRef)(record.model) || undefined : undefined;
            const result = await operations.resumeSessionById((0, session_ownership_1.recoveryRouteId)(record), { model, recovery: record });
            const session = await operations.probeRecoveryLive(record);
            const pid = session instanceof bridge_session_1.BridgeSession ? ownership.getRegisteredSession(result.id)?.pid
                : session instanceof prime_daemon_1.PrimeDaemonSession ? session.summary.workerPid
                    : session?.proc?.pid;
            const identity = (0, process_identity_1.processIdentity)(typeof pid === 'number' || typeof pid === 'string' || pid === undefined ? pid : Number(pid));
            const control = recoveryStore.getControl(record.harnessId, record.nativeSessionId);
            recoveryStore.patchControl(record.harnessId, record.nativeSessionId, {
                attempt: { ...control.attempt, launch: { bootId: recoveryStore.bootId(), uncertain: !identity, ...identity } },
            });
            return result;
        },
        continueSession: async (record, session, message) => {
            if (!Object.hasOwn(PROMPT_RECOVERY_HARNESSES, record.harnessId) || !(0, session_ownership_1.liveSessionSupports)(session, 'prompt')) {
                throw new session_operations_1.SessionOperationError(409, 'The live harness does not support verified recovery prompts.');
            }
            if (session.turnInProgress || session.compacting)
                throw new session_operations_1.SessionOperationError(409, 'The session started working or compacting before recovery delivery; no prompt was sent.');
            await session.prompt(message);
        },
    });
}
