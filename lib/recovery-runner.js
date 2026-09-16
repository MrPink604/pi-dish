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
exports.createRecoveryRuntime = createRecoveryRuntime;
const fs = require("fs");
const readline = require("readline");
const crypto = require("crypto");
const bridge_session_1 = require("./bridge-session");
const helper_models_1 = require("./helper-models");
const process_identity_1 = require("./process-identity");
const session_operations_1 = require("./session-operations");
const session_ownership_1 = require("./session-ownership");
const recoveryStore = __importStar(require("./session-recovery"));
const MAX_SESSIONS = 5000;
exports.RECOVERY_PROMPT = 'pi-dish recovery: this session was interrupted while work was in progress. Before continuing, inspect the transcript, working files, and any external state affected by prior tools. A tool or external action may have completed without its result being recorded. Do not blindly repeat commands, writes, deployments, purchases, or other side effects. Reconcile what actually happened, explain any uncertainty, and ask for confirmation where safe continuation cannot be established. Continue the existing task only after this inspection; this message is not an instruction to replay the last prompt or retry a tool.';
function recoveryMode(value) {
    return value === 'off' || value === 'restore' || value === 'continue' ? value : 'off';
}
/** Property access only, not a JSON schema: arrays and primitive boxing retain their old behavior. */
function property(value, key) {
    if (value === null || value === undefined)
        throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`);
    return Reflect.get(Object(value), key);
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
            lastType = property(entry, 'type');
            if (lastType !== 'message')
                continue;
            const message = property(entry, 'message');
            if (!message || typeof property(message, 'role') !== 'string')
                return 'The transcript contains an unverifiable message.';
            lastMessage = message;
            if (property(message, 'role') === 'assistant') {
                const content = property(message, 'content');
                const blocks = Array.isArray(content) ? content : [];
                for (const block of blocks) {
                    if (property(block, 'type') !== 'toolCall' && property(block, 'type') !== 'tool_use')
                        continue;
                    const id = property(block, 'id');
                    if (typeof id !== 'string')
                        return 'A tool call has no verifiable identity.';
                    pending.add(id);
                    if (pending.size > 10000)
                        return 'Too many unresolved tool calls to verify safely.';
                }
            }
            else if (property(message, 'role') === 'toolResult') {
                const toolCallId = property(message, 'toolCallId');
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
    if (property(lastMessage, 'role') === 'assistant') {
        const stopReason = property(lastMessage, 'stopReason');
        if (stopReason === 'aborted' || stopReason === 'error')
            return 'The last assistant response was aborted or failed.';
        if (stopReason !== 'toolUse')
            return 'The last assistant response may already have completed.';
    }
    return null;
}
function createRecoveryRunner(deps) {
    const { store, getMode, routeId, probeLive, validateRecord, restore, continueSession, now = () => Date.now(), log = console } = deps;
    const reports = new Map();
    const reportLookup = reports;
    const flights = new Map();
    let startPromise = null;
    let stopped = false;
    function remember(record, status, reason) {
        const id = routeId(record);
        const row = { id, harnessId: record.harnessId, name: record.name || null,
            cwd: record.cwd || null, excluded: !!store.getControl(record.harnessId, record.nativeSessionId).excluded,
            status, reason: reason || null, updatedAt: now() };
        Object.defineProperty(row, 'observationId', {
            value: store.readRecord(record.harnessId, record.nativeSessionId)?.observationId || record.observationId,
        });
        if (!reports.has(id) && reports.size >= MAX_SESSIONS) {
            const oldest = reports.keys().next();
            if (!oldest.done)
                reports.delete(oldest.value);
        }
        reports.set(id, row);
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
    function report() {
        const rows = new Map();
        const records = newestRecords();
        for (const record of records.slice(0, MAX_SESSIONS)) {
            const id = routeId(record);
            const control = store.getControl(record.harnessId, record.nativeSessionId);
            let row = reports.get(id);
            const previous = control.attempt;
            const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
            if (row && (row.status === 'pending' || row.status === 'failed' || row.status === 'needs-review')
                && row.observationId !== record.observationId && !ambiguous)
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
                    : control.excluded ? { reason: 'Excluded from automatic recovery.' } : {}) });
        }
        return { mode: recoveryMode(getMode()), sessions: [...rows.values()],
            truncated: records.length > MAX_SESSIONS, totalRecords: records.length };
    }
    async function run(record, explicit) {
        const id = routeId(record);
        let control = store.getControl(record.harnessId, record.nativeSessionId);
        const previous = control.attempt;
        const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
        try {
            // Always prefer a fresh socket/process identity to a historical record.
            const live = await probeLive(record);
            if (ambiguous && !explicit)
                return remember(record, 'needs-review', 'An earlier recovery launch or prompt has an uncertain outcome; inspect it before retrying.');
            if (live)
                return remember(record, ambiguous ? 'needs-review' : 'live', ambiguous
                    ? 'The session is live, but an earlier recovery prompt has uncertain delivery. It was not resent.' : 'Attached to the surviving session; no prompt was sent.');
            control = store.getControl(record.harnessId, record.nativeSessionId);
            if (control.closed)
                return remember(record, 'closed', 'This session was explicitly closed.');
            if (control.excluded)
                return remember(record, 'pending', 'Excluded from automatic recovery.');
            if (stopped || (!explicit && recoveryMode(getMode()) === 'off'))
                return remember(record, 'pending', 'Automatic recovery is off.');
            if (!explicit && record.shutdown)
                return remember(record, 'needs-review', 'The harness shut down; quit, reload, and operating-system shutdown cannot be distinguished.');
            const repeatIdleRestore = record.activity === 'idle' && previous?.status === 'restored'
                && !previous.delivery;
            if (!explicit && previous?.observationId === record.observationId && !repeatIdleRestore) {
                return remember(record, 'needs-review', previous.reason || 'This observation was already recovered; automatic retries are disabled.');
            }
            await validateRecord(record);
            const matched = store.checkpointMatches(record);
            let safety = null;
            if (!explicit && recoveryMode(getMode()) === 'continue' && record.activity !== 'idle') {
                safety = record.activity !== 'running' || !record.runId
                    ? 'The interrupted activity cannot be classified safely.'
                    : !matched ? 'The transcript changed after the last durable observation; no prompt was sent.'
                        : !['pi', 'omp'].includes(record.harnessId) ? 'This harness has no verified recovery prompt path.'
                            : await continuationSafety(record.sessionFile);
            }
            // Durable intent precedes even the launch. A crash after this point is
            // ambiguous until a live identity or an explicit restore-only retry.
            save(record, 'restoring', null, { id: crypto.randomUUID(), delivery: previous?.delivery === 'uncertain' ? 'uncertain' : null });
            const result = await restore(record);
            if (result.alreadyActive || result.sharedResume)
                return save(record, 'live', 'Another caller restored this session; no recovery prompt was sent.');
            if (explicit || recoveryMode(getMode()) !== 'continue' || record.activity === 'idle') {
                return save(record, previous?.delivery === 'uncertain' ? 'needs-review' : 'restored', previous?.delivery === 'uncertain'
                    ? 'Restored without resending the earlier uncertain recovery prompt.' : 'Restored without sending a prompt.');
            }
            if (safety)
                return save(record, 'needs-review', safety);
            control = store.getControl(record.harnessId, record.nativeSessionId);
            const current = store.readRecord(record.harnessId, record.nativeSessionId);
            if (stopped || control.closed || control.excluded || recoveryMode(getMode()) !== 'continue') {
                return save(record, 'restored', 'Restored; continuation was cancelled by current recovery settings.');
            }
            if (!current || current.observationId !== record.observationId || current.activity !== 'running'
                || current.runId !== record.runId || !store.checkpointMatches(record)) {
                return save(record, 'needs-review', 'The session or transcript advanced during recovery; no prompt was sent.');
            }
            const session = await probeLive(record);
            if (!session || session.turnInProgress || session.compacting)
                return save(record, 'needs-review', 'The restored session is unavailable, already working, or compacting; no prompt was sent.');
            // A second checkpoint immediately before durable delivery intent closes
            // the asynchronous live-handshake window. Delivery is never retried.
            control = store.getControl(record.harnessId, record.nativeSessionId);
            const latest = store.readRecord(record.harnessId, record.nativeSessionId);
            if (stopped || control.closed || control.excluded || recoveryMode(getMode()) !== 'continue') {
                return save(record, 'restored', 'Restored; continuation was cancelled by current recovery settings.');
            }
            if (!latest || latest.observationId !== record.observationId || latest.activity !== 'running'
                || latest.runId !== record.runId || !store.checkpointMatches(record)) {
                return save(record, 'needs-review', 'The session advanced before delivery; no prompt was sent.');
            }
            save(record, 'restoring', 'Recovery prompt delivery is in progress.', { delivery: 'uncertain' });
            await continueSession(record, session, exports.RECOVERY_PROMPT);
            return save(record, 'continued', 'Sent one visible recovery prompt to inspect state before continuing.', { delivery: 'confirmed' });
        }
        catch (error) {
            const attempt = store.getControl(record.harnessId, record.nativeSessionId).attempt;
            const uncertain = attempt?.delivery === 'uncertain' || attempt?.status === 'restoring';
            try {
                return save(record, uncertain ? 'needs-review' : 'failed', property(error, 'message'));
            }
            catch (persistError) {
                log.error?.(`Recovery ${id}: ${property(persistError, 'message')}`);
                return remember(record, 'failed', `Recovery state could not be persisted: ${property(persistError, 'message')}. ${property(error, 'message')}`);
            }
        }
    }
    function recover(record, explicit = false) {
        const id = routeId(record);
        const existing = flights.get(id);
        if (existing)
            return existing;
        const flight = Promise.resolve().then(() => run(record, explicit));
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
                await recover(record);
            }
        })();
        return startPromise;
    }
    async function retry(id) {
        const record = store.listRecords().find(candidate => routeId(candidate) === id);
        if (!record)
            throw new session_operations_1.SessionOperationError(404, 'Recovery record not found');
        return recover(record, true);
    }
    return { start, retry, report, outcome: id => reportLookup.get(id) || null, stop: () => { stopped = true; } };
}
/** Checked production restore/delivery policy; callers provide owners and presentation, not authority callbacks. */
function createRecoveryRuntime({ operations, ownership, getMode, now, log }) {
    return createRecoveryRunner({
        store: recoveryStore,
        getMode,
        now,
        log,
        routeId: session_ownership_1.recoveryRouteId,
        probeLive: operations.probeRecoveryLive,
        validateRecord: session_ownership_1.validateRecoveryRecord,
        restore: async (record) => {
            const model = ['pi', 'omp'].includes(record.harnessId) ? (0, helper_models_1.formatModelRef)(record.model) || undefined : undefined;
            const result = await operations.resumeSessionById((0, session_ownership_1.recoveryRouteId)(record), { model, recovery: record });
            const session = await operations.probeRecoveryLive(record);
            const pid = session instanceof bridge_session_1.BridgeSession ? ownership.getRegisteredSession(result.id)?.pid : session?.proc?.pid;
            const identity = (0, process_identity_1.processIdentity)(typeof pid === 'number' || typeof pid === 'string' || pid === undefined ? pid : Number(pid));
            const control = recoveryStore.getControl(record.harnessId, record.nativeSessionId);
            recoveryStore.patchControl(record.harnessId, record.nativeSessionId, {
                attempt: { ...control.attempt, launch: { bootId: recoveryStore.bootId(), uncertain: !identity, ...identity } },
            });
            return result;
        },
        continueSession: async (record, session, message) => {
            if (!['pi', 'omp'].includes(record.harnessId) || !(0, session_ownership_1.liveSessionSupports)(session, 'prompt')) {
                throw new session_operations_1.SessionOperationError(409, 'The live harness does not support verified recovery prompts.');
            }
            if (session.turnInProgress || session.compacting)
                throw new session_operations_1.SessionOperationError(409, 'The session started working or compacting before recovery delivery; no prompt was sent.');
            await session.prompt(message);
        },
    });
}
