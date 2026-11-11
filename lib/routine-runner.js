// Generated from src/core/routine-runner.ts; edit that source and run npm run build:core.
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
exports.TICK_MS = exports.STARTING_WATCHDOG_MS = exports.DEFAULT_CLOSE_GRACE_MS = void 0;
exports.createRoutineRunner = createRoutineRunner;
/**
 * Routine lifecycle: trigger → spawn/deliver → observe → close. Every side
 * effect is an injected dep (testable without a spawn backend), and capability
 * checks go through `supports`, never a harness id.
 */
const promises_1 = require("node:timers/promises");
const cron_1 = require("./cron");
const store = __importStar(require("./routines"));
const http_boundary_1 = require("./http-boundary");
exports.DEFAULT_CLOSE_GRACE_MS = 10000;
exports.STARTING_WATCHDOG_MS = 2 * 60 * 1000;
exports.TICK_MS = 30000;
// An aborted turn is `agent_end` with no paired `turn_end`, but a completed
// turn can deliver both back to back: give turn_end this long to claim it.
const AGENT_END_GRACE_MS = 250;
function coded(message, status, extra = {}) {
    return Object.assign(new Error(message), { status }, extra);
}
function assistantText(wire) {
    if (wire?.role !== 'assistant' || !Array.isArray(wire.content))
        return '';
    return wire.content
        .flatMap((block) => {
        if (!block || typeof block !== 'object' || !('type' in block) || block.type !== 'text'
            || !('text' in block) || typeof block.text !== 'string')
            return [];
        return [block.text];
    })
        .join('\n')
        .trim();
}
function closeGraceMs() {
    const configured = Number(process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS);
    return Number.isFinite(configured) && configured >= 0 ? configured : exports.DEFAULT_CLOSE_GRACE_MS;
}
function createRoutineRunner(deps) {
    const { createSession, resumeSession, getLiveSession, closeSession, composePrompt, isTurnInProgress = (sess) => !!sess?.turnInProgress, supports = () => true, recoveryOutcome = () => null, now = () => Date.now(), log = console, } = deps;
    // In-flight invocation observers, so restart recovery and the watchdog can
    // tell a run this process is watching from one it is not.
    const watched = new Map();
    let timer = null;
    function nextRunAt(routine, from = now()) {
        const cron = routine?.schedule?.cron;
        if (!cron)
            return null;
        let parsed;
        try {
            parsed = (0, cron_1.parseCron)(cron);
        }
        catch {
            return null; // an unparseable schedule simply never runs
        }
        const next = (0, cron_1.nextCronMatch)(parsed, new Date(from));
        return next ? next.getTime() : null;
    }
    function observe(sess, invocationId, mode) {
        let finished = false;
        let summary = null;
        let agentEndTimer = null;
        const detach = () => {
            clearTimeout(agentEndTimer ?? undefined);
            sess.off('turn_end', onTurnEnd);
            sess.off('agent_end', onAgentEnd);
            sess.off('message_end', onMessageEnd);
            // BridgeSession signals a dead session with 'close', RPCSession with
            // 'exit'. Both classes accept (and ignore) the other's name.
            sess.off('close', onGone);
            sess.off('exit', onGone);
            watched.delete(invocationId);
        };
        function finish(status, error) {
            if (finished)
                return;
            finished = true;
            detach();
            const invocation = store.updateInvocation(invocationId, {
                status,
                endedAt: now(),
                summary,
                error: error ? (0, http_boundary_1.errorMessage)(error) : null,
            });
            if (invocation && mode === 'oneShot')
                void scheduleClose(invocation);
        }
        function onTurnEnd() { finish('completed'); }
        function onAgentEnd() {
            if (finished || agentEndTimer)
                return;
            agentEndTimer = setTimeout(() => {
                agentEndTimer = null;
                finish('interrupted', 'the agent turn ended without completing');
            }, AGENT_END_GRACE_MS);
            agentEndTimer.unref?.();
        }
        function onMessageEnd(data) {
            const text = assistantText(data?.message);
            if (text)
                summary = text.slice(0, 500);
        }
        function onGone() { finish('interrupted', 'the session ended'); }
        sess.on('turn_end', onTurnEnd);
        sess.on('agent_end', onAgentEnd);
        sess.on('message_end', onMessageEnd);
        sess.on('close', onGone);
        sess.on('exit', onGone);
        watched.set(invocationId, { detach });
        return { finish, detach };
    }
    /**
     * oneShot auto-close after a grace period (turn end ≠ pi done writing). A
     * refused/unprovable close records `closeError` and leaves the session live:
     * never escalate, a routine is not a process manager.
     */
    async function scheduleClose(invocation) {
        if (!invocation.sessionId)
            return;
        await (0, promises_1.setTimeout)(closeGraceMs(), undefined, { ref: false });
        try {
            const { status, body } = await closeSession(invocation.sessionId);
            if (status >= 200 && status < 300) {
                store.updateInvocation(invocation.id, { closed: true, closeError: null });
            }
            else {
                store.updateInvocation(invocation.id, {
                    closed: false,
                    closeError: body?.error || `close failed with status ${status}`,
                });
            }
        }
        catch (error) {
            store.updateInvocation(invocation.id, { closed: false, closeError: (0, http_boundary_1.errorMessage)(error) });
        }
    }
    /**
     * Returns the persisted invocation (`starting` or `skipped`) or throws a coded
     * 409/413/429 error. The body runs detached; callers poll the ledger.
     */
    function invoke(routine, { trigger = 'invoke', source = null, input = null } = {}) {
        const at = now();
        if (trigger === 'schedule' && !routine.enabled) {
            return store.createInvocation({
                routine, trigger, source, input: null, status: 'skipped', skipReason: 'disabled', startedAt: at,
            });
        }
        // Rate guard: deliberately not recorded, or an invoke storm would fill the
        // ledger with nothing but its own rejections.
        if (trigger === 'invoke' && routine.minIntervalSec > 0) {
            const last = store.lastInvocation(routine.id, (entry) => entry.status !== 'skipped');
            const elapsed = last ? at - last.startedAt : Infinity;
            if (elapsed < routine.minIntervalSec * 1000) {
                throw coded(`Routine "${routine.name}" runs at most once every ${routine.minIntervalSec}s`, 429, {
                    retryAfterSec: Math.ceil((routine.minIntervalSec * 1000 - elapsed) / 1000),
                    lastInvocation: last,
                });
            }
        }
        const busy = store.activeInvocation(routine.id);
        let delivery = 'prompt';
        if (busy) {
            // A scheduled tick never queues into a running turn: the cadence is a
            // cadence, not a backlog.
            if (trigger === 'schedule' || routine.onBusy === 'skip') {
                if (trigger === 'schedule') {
                    return store.createInvocation({
                        routine, trigger, source, input: null, status: 'skipped', skipReason: 'busy', startedAt: at,
                    });
                }
                throw coded(`Routine "${routine.name}" is already running`, 409, { invocation: busy });
            }
            delivery = routine.onBusy;
        }
        const invocation = store.createInvocation({
            routine, trigger, source, input, delivery, status: 'starting', startedAt: at,
        });
        run(routine, invocation, busy).catch((error) => {
            log.error?.(`Routine ${routine.name} invocation failed: ${(0, http_boundary_1.errorMessage)(error)}`);
            store.updateInvocation(invocation.id, { status: 'errored', endedAt: now(), error: (0, http_boundary_1.errorMessage)(error) });
        });
        return invocation;
    }
    async function findContinuationSession(routine, invocation) {
        const previous = store.lastInvocation(routine.id, (entry) => entry.id !== invocation.id && !!entry.sessionId);
        if (!previous?.sessionId)
            return null;
        const live = await getLiveSession(previous.sessionId).catch(() => null);
        if (live)
            return { sess: live, sessionId: previous.sessionId };
        try {
            const resumed = await resumeSession(previous.sessionId);
            const sessionId = resumed?.id || previous.sessionId;
            const sess = await getLiveSession(sessionId).catch(() => null);
            return sess ? { sess, sessionId } : null;
        }
        catch (error) {
            // A session that can no longer be resumed is not this run's failure:
            // spawn a fresh one rather than annotating a recovered run with an error.
            log.warn?.(`Routine ${routine.name} could not resume ${previous.sessionId}: ${(0, http_boundary_1.errorMessage)(error)}`);
            return null;
        }
    }
    async function run(routine, invocation, busy) {
        let sessionId = null;
        let sess = null;
        if (busy && invocation.delivery !== 'prompt') {
            sessionId = busy.sessionId;
            sess = sessionId ? await getLiveSession(sessionId).catch(() => null) : null;
            if (!sess)
                throw new Error('the running invocation has no live session to deliver into');
            if (!supports(sess, invocation.delivery)) {
                throw coded(`This session does not support ${invocation.delivery}.`, 409);
            }
        }
        else if (routine.mode === 'continue') {
            const continuation = await findContinuationSession(routine, invocation);
            if (continuation)
                ({ sess, sessionId } = continuation);
        }
        let spawned = false;
        if (!sess) {
            // The store keeps raw cwd values so stale rows survive a write; only a
            // string cwd is launchable. A falsy non-string would otherwise fall
            // through to the launch default (the server's HOME).
            if (typeof routine.cwd !== 'string' || !routine.cwd.trim()) {
                throw new Error(`Routine "${routine.name}" has no usable working directory; edit the routine and set cwd.`);
            }
            sessionId = await createSession({
                harness: routine.harness,
                model: routine.model,
                thinking: routine.thinking,
                cwd: routine.cwd,
            });
            spawned = true;
            sess = await getLiveSession(sessionId).catch(() => null);
            if (!sess)
                throw new Error('the spawned session did not become live');
            await nameSession(sess, routine);
        }
        // Observers go up before delivery: a fast turn can end before `prompt()`
        // resolves, and the whole record would otherwise hang in `running`.
        const observer = observe(sess, invocation.id, routine.mode);
        store.updateInvocation(invocation.id, { status: 'running', sessionId });
        try {
            const text = await composePrompt(routine, store.getInvocation(invocation.id) || invocation);
            if (invocation.delivery === 'steer')
                await sess.steer(text);
            else if (invocation.delivery === 'followUp')
                await sess.prompt(text, { deliverAs: 'followUp' });
            else
                await sess.prompt(text);
        }
        catch (error) {
            observer.detach();
            const failed = store.updateInvocation(invocation.id, {
                status: 'errored', endedAt: now(), error: (0, http_boundary_1.errorMessage)(error),
            });
            // A oneShot spawn whose delivery never landed would otherwise leave an
            // idle session nobody asked for. Only ever close what this run spawned.
            if (failed && spawned && routine.mode === 'oneShot')
                void scheduleClose(failed);
        }
    }
    async function nameSession(sess, routine) {
        if (!supports(sess, 'rename'))
            return;
        try {
            await sess.setName(`${routine.name} ${stamp(new Date(now()))}`);
        }
        catch (error) {
            // Naming is cosmetic; a harness that refuses it must not fail the run.
            log.warn?.(`Routine ${routine.name} could not name its session: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
    function stamp(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
            + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    /** Poll the ledger until the invocation leaves `starting` (route `?wait=1`). */
    async function waitForInvocation(id, timeoutMs = 60000) {
        // Wall clock, not the injected `now`: tests pin that to a fixed instant.
        const deadline = Date.now() + timeoutMs;
        let current = store.getInvocation(id);
        while (current && current.status === 'starting' && Date.now() < deadline) {
            await (0, promises_1.setTimeout)(100, undefined, { ref: false });
            current = store.getInvocation(id);
        }
        return current;
    }
    function sweepStarting(at) {
        for (const invocation of store.activeInvocations()) {
            if (invocation.status !== 'starting')
                continue; // a long turn is a long turn
            if (at - invocation.startedAt < exports.STARTING_WATCHDOG_MS)
                continue;
            watched.get(invocation.id)?.detach();
            store.updateInvocation(invocation.id, {
                status: 'errored',
                endedAt: at,
                error: `the session did not start within ${Math.round(exports.STARTING_WATCHDOG_MS / 1000)}s`,
            });
        }
    }
    /**
     * Only the *current* minute is evaluated (slept-through minutes are not caught
     * up); `lastScheduledMinute` persists before the fire so a restart can't double-run.
     */
    function tick(at = now()) {
        sweepStarting(at);
        const minute = Math.floor(at / 60000) * 60000;
        for (const routine of store.listRoutines()) {
            if (!routine.enabled)
                continue;
            const cron = routine.schedule?.cron;
            if (!cron || routine.lastScheduledMinute === minute)
                continue;
            let parsed;
            try {
                parsed = (0, cron_1.parseCron)(cron);
            }
            catch {
                continue;
            }
            if (!(0, cron_1.cronMatches)(parsed, new Date(at)))
                continue;
            store.markScheduled(routine.id, minute);
            try {
                invoke(routine, { trigger: 'schedule' });
            }
            catch (error) {
                log.error?.(`Scheduled routine ${routine.name} failed to start: ${(0, http_boundary_1.errorMessage)(error)}`);
            }
        }
    }
    /**
     * No live observation survives a restart, so every unfinished record is
     * reconciled against the session that is (or isn't) still there.
     */
    async function recoverAfterRestart(at = now()) {
        for (const invocation of store.activeInvocations()) {
            if (invocation.status === 'starting') {
                store.updateInvocation(invocation.id, {
                    status: 'errored', endedAt: at, error: 'pi-dish restarted',
                });
                continue;
            }
            const routine = store.getRoutine(invocation.routineId);
            // A deleted routine leaves the ledger entry behind; treat its mode as
            // `continue` so recovery can never close a session it cannot attribute.
            const mode = routine?.mode === 'oneShot' ? 'oneShot' : 'continue';
            const sessionId = invocation.sessionId;
            const sess = sessionId ? await getLiveSession(sessionId).catch(() => null) : null;
            const recovery = sessionId ? recoveryOutcome(sessionId) : null;
            if (recovery && !['live', 'continued'].includes(recovery.status)) {
                store.updateInvocation(invocation.id, {
                    status: 'interrupted', endedAt: at,
                    error: typeof recovery.reason === 'string' && recovery.reason
                        ? recovery.reason : 'Session recovery requires review before this invocation can continue.',
                });
                continue;
            }
            if (!sess) {
                store.updateInvocation(invocation.id, {
                    status: 'interrupted', endedAt: at, error: 'pi-dish restarted',
                });
                continue;
            }
            if (isTurnInProgress(sess)) {
                observe(sess, invocation.id, mode);
                continue;
            }
            const completed = store.updateInvocation(invocation.id, { status: 'completed', endedAt: at });
            if (completed && mode === 'oneShot')
                void scheduleClose(completed);
        }
    }
    function start() {
        if (timer)
            return;
        timer = setInterval(() => {
            try {
                tick();
            }
            catch (error) {
                log.error?.(`Routine scheduler tick failed: ${(0, http_boundary_1.errorMessage)(error)}`);
            }
        }, exports.TICK_MS);
        timer.unref?.();
    }
    function stop() {
        clearInterval(timer ?? undefined);
        timer = null;
        for (const held of [...watched.values()])
            held.detach();
    }
    return {
        invoke,
        tick,
        nextRunAt,
        recoverAfterRestart,
        waitForInvocation,
        start,
        stop,
        // Test visibility only: how many invocations this process is observing.
        get watching() { return watched.size; },
    };
}
