// Generated from src/core/agy-import.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGY_IMPORT_INTERVAL_SETTING = exports.AGY_IMPORT_INTERVAL_ENV = exports.AGY_IMPORT_DEFAULT_MS = void 0;
exports.agyImportIntervalMs = agyImportIntervalMs;
exports.createAgyImportRuntime = createAgyImportRuntime;
/**
 * Imports Antigravity conversations that started outside pi-dish (the `agy`
 * TUI or another ACP client) into Pi-format mirrors.
 *
 * One short-lived `agy acp` child answers `session/list`, replays each missing
 * or stale conversation with `session/load`, then closes. The import runs once
 * shortly after server start, on an interval and on demand. It never touches
 * agy's token files or store, skips conversations live in a relay, and logs
 * errors instead of failing the server.
 */
const path = require("path");
const dish_store_1 = require("./dish-store");
const harnesses_1 = require("./harnesses");
const harness_feature_commands_1 = require("./harness-feature-commands");
const bridge_session_1 = require("./bridge-session");
const helper_values_1 = require("./helper-values");
const http_boundary_1 = require("./http-boundary");
const acp_transcript_1 = require("./acp-transcript");
const acp_session_1 = require("./acp-session");
/** Default automatic import cadence: every 15 minutes, shortly after start. */
exports.AGY_IMPORT_DEFAULT_MS = 15 * 60_000;
exports.AGY_IMPORT_INTERVAL_ENV = 'PI_DISH_AGY_IMPORT_INTERVAL_MS';
exports.AGY_IMPORT_INTERVAL_SETTING = 'agyImportIntervalMinutes';
const FIRST_RUN_DELAY_MS = 15_000;
const RUN_BUDGET_MS = 5 * 60_000;
/** Interval in ms; `0` disables the automatic runs. Env wins over the setting. */
function agyImportIntervalMs(settings = (0, dish_store_1.readDishSettings)()) {
    const fromEnv = Number(process.env[exports.AGY_IMPORT_INTERVAL_ENV]);
    if (Number.isFinite(fromEnv) && fromEnv >= 0)
        return fromEnv;
    const minutes = Number(settings[exports.AGY_IMPORT_INTERVAL_SETTING]);
    if (Number.isFinite(minutes) && minutes >= 0)
        return minutes * 60_000;
    return exports.AGY_IMPORT_DEFAULT_MS;
}
function agyInstalled() {
    const descriptor = (0, harnesses_1.getHarness)('agy');
    return !!descriptor && (0, harness_feature_commands_1.harnessCommandAvailable)(descriptor);
}
/** Native ids of conversations a relay currently owns (bridge claim or in-process child). */
function liveAgySessionIds() {
    const ids = new Set((0, acp_session_1.getAllAcpSessions)().map(session => String(session.id)));
    for (const entry of (0, bridge_session_1.listRegisteredSessions)()) {
        const wrapper = (0, helper_values_1.record)(entry.wrapper) ? entry.wrapper : {};
        const harnessId = typeof wrapper.harnessId === 'string' ? wrapper.harnessId : entry.harnessId;
        if (harnessId !== 'agy')
            continue;
        const nativeId = typeof entry.nativeSessionId === 'string' && entry.nativeSessionId
            ? entry.nativeSessionId
            : entry.sessionId;
        if (nativeId)
            ids.add(nativeId);
    }
    return ids;
}
function skippedOutcome(reason, skipped) {
    return {
        reason,
        status: 'skipped',
        skipped,
        imported: [],
        live: [],
        upToDate: 0,
        errors: [],
        startedAt: Date.now(),
        finishedAt: Date.now(),
    };
}
function needsImport(file, conversation) {
    const last = (0, acp_transcript_1.readAcpMirrorLastTimestamp)(file);
    if (last === null)
        return true;
    if (conversation.updatedAt === null)
        return false;
    return conversation.updatedAt > last + acp_session_1.AGY_STALE_TOLERANCE_MS;
}
function createAgyImportRuntime(ports = {}) {
    // HOME is resolved per call so tests can point dishDir() at a temp directory.
    const readSettings = ports.readSettings ?? dish_store_1.readDishSettings;
    const isLive = ports.isLive ?? (sessionId => liveAgySessionIds().has(sessionId));
    const isInstalled = ports.isInstalled ?? agyInstalled;
    const log = ports.log ?? ((line) => console.log(`[agy-import] ${line}`));
    let interval = null;
    let firstRun = null;
    let current = null;
    let stopped = false;
    async function execute(reason) {
        const startedAt = Date.now();
        const outcome = {
            reason,
            status: 'completed',
            imported: [],
            live: [],
            upToDate: 0,
            errors: [],
            startedAt,
            finishedAt: null,
        };
        let agent = null;
        try {
            agent = await (0, acp_session_1.createAcpImportAgent)({ cwd: process.cwd() });
            const conversations = await agent.listConversations();
            const sideChatIds = (0, acp_session_1.readAgySideChatIds)();
            const deadline = startedAt + RUN_BUDGET_MS;
            for (const conversation of conversations) {
                if (Date.now() >= deadline) {
                    outcome.errors.push({ sessionId: null, error: 'Import run exceeded its time budget.' });
                    break;
                }
                if (sideChatIds.has(conversation.sessionId)) {
                    continue;
                }
                if (isLive(conversation.sessionId)) {
                    outcome.live.push(conversation.sessionId);
                    continue;
                }
                const file = path.join((0, acp_session_1.agyMirrorRoot)(), `${conversation.sessionId}.jsonl`);
                if (!needsImport(file, conversation)) {
                    outcome.upToDate += 1;
                    continue;
                }
                try {
                    const imported = await agent.importConversation(conversation, file);
                    outcome.imported.push({
                        sessionId: conversation.sessionId,
                        cwd: conversation.cwd,
                        title: conversation.title,
                        file: imported.file,
                        backup: imported.backup,
                    });
                }
                catch (error) {
                    outcome.errors.push({ sessionId: conversation.sessionId, error: (0, http_boundary_1.errorMessage)(error) });
                    log(`could not import ${conversation.sessionId}: ${(0, http_boundary_1.errorMessage)(error)}`);
                }
            }
        }
        catch (error) {
            outcome.status = 'failed';
            outcome.errors.push({ sessionId: null, error: (0, http_boundary_1.errorMessage)(error) });
            log(`run failed: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
        finally {
            if (agent) {
                try {
                    await agent.close();
                }
                catch {
                    agent.kill();
                }
            }
        }
        outcome.finishedAt = Date.now();
        if (outcome.imported.length)
            log(`imported ${outcome.imported.length} conversation(s)`);
        return outcome;
    }
    function run(reason = 'manual') {
        if (current)
            return Promise.resolve(skippedOutcome(reason, 'already-running'));
        if (!isInstalled())
            return Promise.resolve(skippedOutcome(reason, 'not-installed'));
        const task = execute(reason);
        current = task;
        void task.finally(() => { if (current === task)
            current = null; });
        return task;
    }
    return {
        start() {
            if (stopped || interval || firstRun)
                return;
            const cadence = agyImportIntervalMs(readSettings());
            if (cadence <= 0) {
                log('automatic import is disabled');
                return;
            }
            firstRun = setTimeout(() => {
                firstRun = null;
                if (!stopped)
                    void run('startup');
            }, FIRST_RUN_DELAY_MS);
            firstRun.unref();
            interval = setInterval(() => { if (!stopped)
                void run('interval'); }, cadence);
            interval.unref();
        },
        stop() {
            stopped = true;
            clearTimeout(firstRun ?? undefined);
            clearInterval(interval ?? undefined);
            firstRun = null;
            interval = null;
        },
        run,
    };
}
