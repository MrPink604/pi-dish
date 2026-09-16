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

import { parseCron, cronMatches, nextCronMatch } from './cron';
import type { CreatedRoutineInvocation, Routine, RoutineInvocation, RoutineStore } from './routines';
import type { SessionOperations } from './session-operations';
import type { LiveSession, SessionOwnership } from './session-ownership';
import type { RecoveryOutcome } from './recovery-runner';
import type { BridgeCapability } from './contracts';

export interface RoutineInvokeOptions {
  trigger?: 'invoke' | 'schedule';
  source?: unknown;
  input?: unknown;
}

export interface RoutineRunner {
  invoke(routine: Routine, options?: RoutineInvokeOptions): RoutineInvocation;
  tick(at?: number): void;
  nextRunAt(routine: Routine | null | undefined, from?: number): number | null;
  recoverAfterRestart(at?: number): Promise<void>;
  waitForInvocation(id: string, timeoutMs?: number): Promise<RoutineInvocation | null>;
  start(): void;
  stop(): void;
  readonly watching: number;
}

export interface RoutineRunnerPorts {
  store: RoutineStore;
  createSession: SessionOperations['createSession'];
  resumeSession: SessionOperations['resumeSessionById'];
  getLiveSession: SessionOwnership['getLiveSession'];
  closeSession: SessionOperations['closeSessionById'];
  composePrompt(routine: Routine, invocation: RoutineInvocation): string | Promise<string>;
  isTurnInProgress?(session: LiveSession): boolean;
  supports?(session: LiveSession, capability: BridgeCapability): boolean;
  recoveryOutcome?(sessionId: unknown): Pick<RecoveryOutcome, 'status' | 'reason'> | null;
  now?(): number;
  log?: { error?(message: string): void; warn?(message: string): void };
}

/** Property access retains legacy primitive boxing and null failures, not a schema assertion. */
function property(value: unknown, key: string): unknown {
  if (value === null || value === undefined) throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`);
  return Reflect.get(Object(value), key);
}


export const DEFAULT_CLOSE_GRACE_MS = 10000;
export const STARTING_WATCHDOG_MS = 2 * 60 * 1000;
export const TICK_MS = 30000;
// An aborted turn is `agent_end` with no paired `turn_end`, but the two can
// legitimately arrive back to back on a turn that *did* complete. Give a
// turn_end this long to claim the invocation before agent_end calls it
// interrupted.
const AGENT_END_GRACE_MS = 250;

function coded(message: string, status: number, extra: Record<string, unknown> = {}): Error & { status: number } {
  return Object.assign(new Error(message), { status }, extra);
}

function assistantText(message: unknown): string {
  if (!message || property(message, 'role') !== 'assistant') return '';
  const raw = property(message, 'content');
  const content: unknown[] = Array.isArray(raw) ? raw : [];
  return content
    .filter((block) => block && property(block, 'type') === 'text' && typeof property(block, 'text') === 'string')
    .map((block) => property(block, 'text'))
    .join('\n')
    .trim();
}

function closeGraceMs() {
  const configured = Number(process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_CLOSE_GRACE_MS;
}

/** Scheduling and ledger policy consume the sole lifecycle coordinator directly. */
export function createRoutineRunner(deps: RoutineRunnerPorts): RoutineRunner {
  const {
    store,
    createSession,
    resumeSession,
    getLiveSession,
    closeSession,
    composePrompt,
    isTurnInProgress = (sess) => !!sess?.turnInProgress,
    // Delivery and post-spawn rename use the checked live capability predicate.
    supports = () => true,
    recoveryOutcome = () => null,
    now = () => Date.now(),
    log = console,
  } = deps;

  // Observer bookkeeping per in-flight invocation, so restart recovery and the
  // watchdog can tell a run this process is watching from one it is not.
  const watched = new Map<string, { detach(): void }>(); // invocation id -> { detach }
  let timer: NodeJS.Timeout | null = null;

  function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const handle = setTimeout(resolve, ms);
      handle.unref?.();
    });
  }

  function nextRunAt(routine: Routine | null | undefined, from = now()): number | null {
    const cron = routine?.schedule == null ? undefined : property(routine.schedule, 'cron');
    if (!cron) return null;
    let parsed;
    try {
      parsed = parseCron(cron);
    } catch {
      return null;  // an unparseable schedule simply never runs
    }
    const next = nextCronMatch(parsed, new Date(from));
    return next ? next.getTime() : null;
  }

  // -------------------------------------------------------------------------
  // Observation
  // -------------------------------------------------------------------------

  function observe(sess: LiveSession, invocationId: string, { mode }: { mode: unknown }) {
    let finished = false;
    let summary: string | null = null;
    let agentEndTimer: NodeJS.Timeout | null = null;

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

    function finish(status: 'completed' | 'interrupted', error?: unknown) {
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

    function onMessageEnd(data: unknown) {
      const text = assistantText(data == null ? undefined : property(data, 'message'));
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
  async function scheduleClose(invocation: RoutineInvocation) {
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
      store.updateInvocation(invocation.id, { closed: false, closeError: property(error, 'message') });
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
  function invoke(routine: Routine, { trigger = 'invoke', source = null, input = null }: RoutineInvokeOptions = {}): RoutineInvocation {
    const at = now();
    const admission = store.RoutineInputAdmission.prepare(input);
    if (!admission) {
      throw coded(`input must serialize to at most ${store.MAX_INPUT_BYTES} bytes`, 413);
    }

    if (trigger === 'schedule' && !routine.enabled) {
      return store.createInvocation({
        routine, trigger, source, input: null, status: 'skipped', skipReason: 'disabled', startedAt: at,
      });
    }

    // Rate guard: deliberately not recorded, or an invoke storm would fill the
    // ledger with nothing but its own rejections.
    if (trigger === 'invoke' && (routine.minIntervalSec as number) > 0) {
      const last = store.lastInvocation(routine.id, (entry) => entry.status !== 'skipped');
      const elapsed = last ? at - (last.startedAt as number) : Infinity;
      if (elapsed < (routine.minIntervalSec as number) * 1000) {
        throw coded(
          `Routine "${routine.name}" runs at most once every ${routine.minIntervalSec}s`,
          429,
          { retryAfterSec: Math.ceil(((routine.minIntervalSec as number) * 1000 - elapsed) / 1000), lastInvocation: last },
        );
      }
    }

    let delivery: unknown = 'prompt';
    const busy = store.activeInvocation(routine.id);
    if (busy) {
      // A scheduled tick never queues into a running turn: the cadence is a
      // cadence, not a backlog.
      if (trigger === 'schedule' || routine.onBusy === 'skip') {
        if (trigger === 'schedule') {
          return store.createInvocation({
            routine, trigger, source, input: admission, status: 'skipped', skipReason: 'busy', startedAt: at,
          });
        }
        throw coded(`Routine "${routine.name}" is already running`, 409, { invocation: busy });
      }
      delivery = routine.onBusy;
    }

    const invocation = store.createInvocation({
      routine, trigger, source, input: admission, delivery, status: 'starting', startedAt: at,
    });
    run(routine, invocation, busy).catch((error) => {
      log.error?.(`Routine ${routine.name} invocation failed: ${property(error, 'message')}`);
      store.updateInvocation(invocation.id, { status: 'errored', endedAt: now(), error: property(error, 'message') });
    });
    return invocation;
  }

  async function run(routine: Routine, invocation: CreatedRoutineInvocation, busy: RoutineInvocation | null) {
    let sess: LiveSession | null = null;
    let sessionId: unknown = null;

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
            log.warn?.(`Routine ${routine.name} could not resume ${previous.sessionId}: ${property(error, 'message')}`);
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
        { status: 'errored', endedAt: now(), error: property(error, 'message') });
      // A oneShot spawn whose delivery never landed would otherwise leave an
      // idle session nobody asked for. Only ever close what this run spawned.
      if (failed && spawned && routine.mode === 'oneShot') scheduleClose(failed);
    }
  }

  async function nameSession(sess: LiveSession, routine: Routine) {
    if (!supports(sess, 'rename')) return;
    try {
      await sess.setName(`${routine.name} ${stamp(new Date(now()))}`);
    } catch (error) {
      // Naming is cosmetic; a harness that refuses it must not fail the run.
      log.warn?.(`Routine ${routine.name} could not name its session: ${property(error, 'message')}`);
    }
  }

  function stamp(date: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
      + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /** Poll the ledger until the invocation leaves `starting` (route `?wait=1`). */
  async function waitForInvocation(id: string, timeoutMs = 60000) {
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

  function sweepStarting(at: number) {
    for (const invocation of store.activeInvocations()) {
      if (invocation.status !== 'starting') continue;  // a long turn is a long turn
      if (at - (invocation.startedAt as number) < STARTING_WATCHDOG_MS) continue;
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
      if (!routine.enabled) continue;
      const cron = routine.schedule == null ? undefined : property(routine.schedule, 'cron');
      if (!cron) continue;
      if (routine.lastScheduledMinute === minute) continue;
      let parsed;
      try {
        parsed = parseCron(cron);
      } catch {
        continue;
      }
      if (!cronMatches(parsed, new Date(at))) continue;
      store.markScheduled(routine.id, minute);
      try {
        invoke(routine, { trigger: 'schedule' });
      } catch (error) {
        log.error?.(`Scheduled routine ${routine.name} failed to start: ${property(error, 'message')}`);
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
      const recovery = invocation.sessionId ? recoveryOutcome(invocation.sessionId) : null;
      if (recovery && !['live', 'continued'].includes(recovery.status)) {
        store.updateInvocation(invocation.id, {
          status: 'interrupted', endedAt: at,
          error: recovery.reason || 'Session recovery requires review before this invocation can continue.',
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
        log.error?.(`Routine scheduler tick failed: ${property(error, 'message')}`);
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

