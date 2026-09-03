'use strict';

/**
 * The routine runner: trigger → spawn/deliver → observe → close.
 *
 * Every side effect it can have arrives as an injected dep, so the whole
 * lifecycle (including the restart-recovery and watchdog paths, which are hard
 * to provoke against a real pi) is testable without booting a spawn backend.
 * Nothing here branches on a harness id — capability questions go through the
 * `supports` dep, exactly as the spawn/prompt routes go through
 * `liveSessionSupports`.
 */

const { parseCron, cronMatches, nextCronMatch } = require('./cron');

const DEFAULT_CLOSE_GRACE_MS = 10000;
const STARTING_WATCHDOG_MS = 2 * 60 * 1000;
const TICK_MS = 30000;
// An aborted turn is `agent_end` with no paired `turn_end`, but the two can
// legitimately arrive back to back on a turn that *did* complete. Give a
// turn_end this long to claim the invocation before agent_end calls it
// interrupted.
const AGENT_END_GRACE_MS = 250;

function coded(message, status, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function assistantText(message) {
  if (!message || message.role !== 'assistant') return '';
  const content = Array.isArray(message.content) ? message.content : [];
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function closeGraceMs() {
  const configured = Number(process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_CLOSE_GRACE_MS;
}

function createRoutineRunner(deps) {
  const {
    store,
    createSession,
    resumeSession,
    getLiveSession,
    closeSession,
    composePrompt,
    isTurnInProgress = (sess) => !!sess?.turnInProgress,
    // Not in the original dep sketch, but unavoidable: onBusy delivery and the
    // post-spawn rename both have to ask whether the live session advertises
    // the capability, which only the server knows how to answer.
    supports = () => true,
    now = () => Date.now(),
    log = console,
  } = deps;

  // Observer bookkeeping per in-flight invocation, so restart recovery and the
  // watchdog can tell a run this process is watching from one it is not.
  const watched = new Map(); // invocation id -> { detach }
  let timer = null;

  function sleep(ms) {
    return new Promise((resolve) => {
      const handle = setTimeout(resolve, ms);
      handle.unref?.();
    });
  }

  function nextRunAt(routine, from = now()) {
    if (!routine?.schedule?.cron) return null;
    let parsed;
    try {
      parsed = parseCron(routine.schedule.cron);
    } catch {
      return null;  // an unparseable schedule simply never runs
    }
    const next = nextCronMatch(parsed, new Date(from));
    return next ? next.getTime() : null;
  }

  // -------------------------------------------------------------------------
  // Observation
  // -------------------------------------------------------------------------

  function observe(sess, invocationId, { mode }) {
    let finished = false;
    let summary = null;
    let agentEndTimer = null;

    const detach = () => {
      if (agentEndTimer) clearTimeout(agentEndTimer);
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
      if (finished) return;
      finished = true;
      detach();
      const endedAt = now();
      const invocation = store.updateInvocation(invocationId, {
        status,
        endedAt,
        summary,
        error: error || null,
      });
      if (invocation && mode === 'oneShot') scheduleClose(invocation);
    }

    function onTurnEnd() { finish('completed'); }

    function onAgentEnd() {
      if (finished || agentEndTimer) return;
      agentEndTimer = setTimeout(() => {
        agentEndTimer = null;
        finish('interrupted', 'the agent turn ended without completing');
      }, AGENT_END_GRACE_MS);
      agentEndTimer.unref?.();
    }

    function onMessageEnd(data) {
      const text = assistantText(data?.message);
      if (text) summary = text.slice(0, 500);
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
   * oneShot's auto-close. The grace period exists because a turn ending is not
   * the same as pi being done writing; a harness that refuses or cannot prove
   * the close records `closeError` and leaves the session live — never
   * escalate, a routine is not a process manager.
   */
  async function scheduleClose(invocation) {
    if (!invocation.sessionId) return;
    await sleep(closeGraceMs());
    try {
      const { status, body } = await closeSession(invocation.sessionId);
      if (status >= 200 && status < 300) {
        store.updateInvocation(invocation.id, { closed: true, closeError: null });
      } else {
        store.updateInvocation(invocation.id, {
          closed: false,
          closeError: body?.error || `close failed with status ${status}`,
        });
      }
    } catch (error) {
      store.updateInvocation(invocation.id, { closed: false, closeError: error.message });
    }
  }

  // -------------------------------------------------------------------------
  // Invoke
  // -------------------------------------------------------------------------

  /**
   * Record the run and start it. Returns the persisted invocation (status
   * `starting`, or `skipped`) or throws a coded error for the 409/413/429
   * cases. The body runs detached — callers that want the outcome poll the
   * ledger (`waitForInvocation`).
   */
  function invoke(routine, { trigger = 'invoke', source = null, input = null } = {}) {
    const at = now();
    if (store.serializedInputSize(input) > store.MAX_INPUT_BYTES) {
      throw coded(`input must serialize to at most ${store.MAX_INPUT_BYTES} bytes`, 413);
    }

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
        throw coded(
          `Routine "${routine.name}" runs at most once every ${routine.minIntervalSec}s`,
          429,
          { retryAfterSec: Math.ceil((routine.minIntervalSec * 1000 - elapsed) / 1000), lastInvocation: last },
        );
      }
    }

    let delivery = 'prompt';
    const busy = store.activeInvocation(routine.id);
    if (busy) {
      // A scheduled tick never queues into a running turn: the cadence is a
      // cadence, not a backlog.
      if (trigger === 'schedule' || routine.onBusy === 'skip') {
        if (trigger === 'schedule') {
          return store.createInvocation({
            routine, trigger, source, input, status: 'skipped', skipReason: 'busy', startedAt: at,
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
      log.error?.(`Routine ${routine.name} invocation failed: ${error.message}`);
      store.updateInvocation(invocation.id, { status: 'errored', endedAt: now(), error: error.message });
    });
    return invocation;
  }

  async function run(routine, invocation, busy) {
    let sess = null;
    let sessionId = null;

    if (busy && invocation.delivery !== 'prompt') {
      sessionId = busy.sessionId;
      sess = sessionId ? await getLiveSession(sessionId).catch(() => null) : null;
      if (!sess) throw new Error('the running invocation has no live session to deliver into');
      if (!supports(sess, invocation.delivery)) {
        throw coded(`This session does not support ${invocation.delivery}.`, 409);
      }
    } else if (routine.mode === 'continue') {
      const previous = store.lastInvocation(routine.id, (entry) =>
        entry.id !== invocation.id && !!entry.sessionId);
      if (previous?.sessionId) {
        sess = await getLiveSession(previous.sessionId).catch(() => null);
        if (sess) {
          sessionId = previous.sessionId;
        } else {
          try {
            const resumed = await resumeSession(previous.sessionId);
            sessionId = resumed?.id || previous.sessionId;
            sess = await getLiveSession(sessionId).catch(() => null);
          } catch (error) {
            // A session that can no longer be resumed is not this run's
            // failure: fall through and spawn a fresh one, keeping the record
            // clean rather than annotating a recovered run with an error.
            log.warn?.(`Routine ${routine.name} could not resume ${previous.sessionId}: ${error.message}`);
            sess = null;
          }
        }
      }
    }

    let spawned = false;
    if (!sess) {
      sessionId = await createSession({
        harness: routine.harness,
        model: routine.model,
        thinking: routine.thinking,
        cwd: routine.cwd,
      });
      spawned = true;
      sess = await getLiveSession(sessionId).catch(() => null);
      if (!sess) throw new Error('the spawned session did not become live');
      await nameSession(sess, routine);
    }

    // Observers go up before delivery: a fast turn can end before `prompt()`
    // resolves, and the whole record would otherwise hang in `running`.
    const observer = observe(sess, invocation.id, { mode: routine.mode });
    store.updateInvocation(invocation.id, { status: 'running', sessionId });

    try {
      const text = await composePrompt(routine, store.getInvocation(invocation.id) || invocation);
      if (invocation.delivery === 'steer') await sess.steer(text);
      else if (invocation.delivery === 'followUp') await sess.prompt(text, { deliverAs: 'followUp' });
      else await sess.prompt(text);
    } catch (error) {
      observer.detach();
      const failed = store.updateInvocation(invocation.id,
        { status: 'errored', endedAt: now(), error: error.message });
      // A oneShot spawn whose delivery never landed would otherwise leave an
      // idle session nobody asked for. Only ever close what this run spawned.
      if (failed && spawned && routine.mode === 'oneShot') scheduleClose(failed);
    }
  }

  async function nameSession(sess, routine) {
    if (!supports(sess, 'rename')) return;
    try {
      await sess.setName(`${routine.name} ${stamp(new Date(now()))}`);
    } catch (error) {
      // Naming is cosmetic; a harness that refuses it must not fail the run.
      log.warn?.(`Routine ${routine.name} could not name its session: ${error.message}`);
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
      await sleep(100);
      current = store.getInvocation(id);
    }
    return current;
  }

  // -------------------------------------------------------------------------
  // Scheduling, watchdog, restart recovery
  // -------------------------------------------------------------------------

  function sweepStarting(at) {
    for (const invocation of store.activeInvocations()) {
      if (invocation.status !== 'starting') continue;  // a long turn is a long turn
      if (at - invocation.startedAt < STARTING_WATCHDOG_MS) continue;
      const held = watched.get(invocation.id);
      if (held) held.detach();
      store.updateInvocation(invocation.id, {
        status: 'errored',
        endedAt: at,
        error: `the session did not start within ${Math.round(STARTING_WATCHDOG_MS / 1000)}s`,
      });
    }
  }

  /**
   * One scheduler pass. Only the *current* minute is evaluated — minutes the
   * server slept through are not caught up, and `lastScheduledMinute` is
   * persisted before the fire so a restart inside the same minute cannot
   * double-run.
   */
  function tick(at = now()) {
    sweepStarting(at);
    const minute = Math.floor(at / 60000) * 60000;
    for (const routine of store.listRoutines()) {
      if (!routine.enabled || !routine.schedule?.cron) continue;
      if (routine.lastScheduledMinute === minute) continue;
      let parsed;
      try {
        parsed = parseCron(routine.schedule.cron);
      } catch {
        continue;
      }
      if (!cronMatches(parsed, new Date(at))) continue;
      store.markScheduled(routine.id, minute);
      try {
        invoke(routine, { trigger: 'schedule' });
      } catch (error) {
        log.error?.(`Scheduled routine ${routine.name} failed to start: ${error.message}`);
      }
    }
  }

  /**
   * Nothing in the ledger survives a restart as a live observation, so every
   * unfinished record is reconciled against the session that is (or isn't)
   * still there.
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
      const sess = invocation.sessionId
        ? await getLiveSession(invocation.sessionId).catch(() => null) : null;
      if (!sess) {
        store.updateInvocation(invocation.id, {
          status: 'interrupted', endedAt: at, error: 'pi-dish restarted',
        });
        continue;
      }
      if (isTurnInProgress(sess)) {
        observe(sess, invocation.id, { mode });
        continue;
      }
      const completed = store.updateInvocation(invocation.id, { status: 'completed', endedAt: at });
      if (completed && mode === 'oneShot') scheduleClose(completed);
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      try {
        tick();
      } catch (error) {
        log.error?.(`Routine scheduler tick failed: ${error.message}`);
      }
    }, TICK_MS);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    for (const held of [...watched.values()]) held.detach();
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

module.exports = { createRoutineRunner, DEFAULT_CLOSE_GRACE_MS, STARTING_WATCHDOG_MS, TICK_MS };
