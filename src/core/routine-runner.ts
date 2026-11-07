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
import { setTimeout as delay } from 'node:timers/promises';
import { parseCron, cronMatches, nextCronMatch } from './cron';
import * as store from './routines';
import type { Routine, RoutineDelivery, RoutineInvocation, RoutineMode, RoutineTrigger } from './routines';
import type { SessionOperations } from './session-operations';
import type { LiveSession, SessionOwnership } from './session-ownership';
import type { RecoveryOutcome } from './recovery-runner';
import type { BridgeCapability } from './contracts';
import { errorMessage } from './http-boundary';

export interface RoutineInvokeOptions {
  trigger?: RoutineTrigger;
  source?: string | null;
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
  createSession: SessionOperations['createSession'];
  resumeSession: SessionOperations['resumeSessionById'];
  getLiveSession: SessionOwnership['getLiveSession'];
  closeSession: SessionOperations['closeSessionById'];
  composePrompt(routine: Routine, invocation: RoutineInvocation): string | Promise<string>;
  isTurnInProgress?(session: LiveSession): boolean;
  supports?(session: LiveSession, capability: BridgeCapability): boolean;
  recoveryOutcome?(sessionId: string): Pick<RecoveryOutcome, 'status' | 'reason'> | null;
  now?(): number;
  log?: { error?(message: string): void; warn?(message: string): void };
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

interface WireMessage {
  role?: unknown;
  content?: unknown;
}

function assistantText(wire: WireMessage | null | undefined): string {
  if (wire?.role !== 'assistant' || !Array.isArray(wire.content)) return '';
  return wire.content
    .flatMap((block: unknown) => {
      if (!block || typeof block !== 'object' || !('type' in block) || block.type !== 'text'
          || !('text' in block) || typeof block.text !== 'string') return [];
      return [block.text];
    })
    .join('\n')
    .trim();
}

function closeGraceMs() {
  const configured = Number(process.env.PI_DISH_ROUTINE_CLOSE_GRACE_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_CLOSE_GRACE_MS;
}

export function createRoutineRunner(deps: RoutineRunnerPorts): RoutineRunner {
  const {
    createSession,
    resumeSession,
    getLiveSession,
    closeSession,
    composePrompt,
    isTurnInProgress = (sess) => !!sess?.turnInProgress,
    supports = () => true,
    recoveryOutcome = () => null,
    now = () => Date.now(),
    log = console,
  } = deps;

  // In-flight invocation observers, so restart recovery and the watchdog can
  // tell a run this process is watching from one it is not.
  const watched = new Map<string, { detach(): void }>();
  let timer: NodeJS.Timeout | null = null;

  function nextRunAt(routine: Routine | null | undefined, from = now()): number | null {
    const cron = routine?.schedule?.cron;
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

  function observe(sess: LiveSession, invocationId: string, mode: RoutineMode) {
    let finished = false;
    let summary: string | null = null;
    let agentEndTimer: NodeJS.Timeout | null = null;

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

    function finish(status: 'completed' | 'interrupted', error?: unknown) {
      if (finished) return;
      finished = true;
      detach();
      const invocation = store.updateInvocation(invocationId, {
        status,
        endedAt: now(),
        summary,
        error: error ? errorMessage(error) : null,
      });
      if (invocation && mode === 'oneShot') void scheduleClose(invocation);
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
      const text = assistantText((data as { message?: WireMessage } | null)?.message);
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
    await delay(closeGraceMs(), undefined, { ref: false });
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
      store.updateInvocation(invocation.id, { closed: false, closeError: errorMessage(error) });
    }
  }

  /**
   * Record the run and start it. Returns the persisted invocation (status
   * `starting`, or `skipped`) or throws a coded error for the 409/413/429
   * cases. The body runs detached — callers that want the outcome poll the
   * ledger (`waitForInvocation`).
   */
  function invoke(routine: Routine, { trigger = 'invoke', source = null, input = null }: RoutineInvokeOptions = {}): RoutineInvocation {
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
        throw coded(
          `Routine "${routine.name}" runs at most once every ${routine.minIntervalSec}s`,
          429,
          {
            retryAfterSec: Math.ceil((routine.minIntervalSec * 1000 - elapsed) / 1000),
            lastInvocation: last,
          },
        );
      }
    }

    const busy = store.activeInvocation(routine.id);
    let delivery: RoutineDelivery = 'prompt';
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
      log.error?.(`Routine ${routine.name} invocation failed: ${errorMessage(error)}`);
      store.updateInvocation(invocation.id, { status: 'errored', endedAt: now(), error: errorMessage(error) });
    });
    return invocation;
  }

  async function findContinuationSession(routine: Routine, invocation: RoutineInvocation) {
    const previous = store.lastInvocation(routine.id, (entry) =>
      entry.id !== invocation.id && !!entry.sessionId);
    if (!previous?.sessionId) return null;
    const live = await getLiveSession(previous.sessionId).catch(() => null);
    if (live) return { sess: live, sessionId: previous.sessionId };
    try {
      const resumed = await resumeSession(previous.sessionId);
      const sessionId = resumed?.id || previous.sessionId;
      const sess = await getLiveSession(sessionId).catch(() => null);
      return sess ? { sess, sessionId } : null;
    } catch (error) {
      // A session that can no longer be resumed is not this run's failure:
      // spawn a fresh one rather than annotating a recovered run with an error.
      log.warn?.(`Routine ${routine.name} could not resume ${previous.sessionId}: ${errorMessage(error)}`);
      return null;
    }
  }

  async function run(routine: Routine, invocation: RoutineInvocation, busy: RoutineInvocation | null) {
    let sessionId: string | null = null;
    let sess: LiveSession | null = null;

    if (busy && invocation.delivery !== 'prompt') {
      sessionId = busy.sessionId;
      sess = sessionId ? await getLiveSession(sessionId).catch(() => null) : null;
      if (!sess) throw new Error('the running invocation has no live session to deliver into');
      if (!supports(sess, invocation.delivery)) {
        throw coded(`This session does not support ${invocation.delivery}.`, 409);
      }
    } else if (routine.mode === 'continue') {
      const continuation = await findContinuationSession(routine, invocation);
      if (continuation) ({ sess, sessionId } = continuation);
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
    const observer = observe(sess, invocation.id, routine.mode);
    store.updateInvocation(invocation.id, { status: 'running', sessionId });

    try {
      const text = await composePrompt(routine, store.getInvocation(invocation.id) || invocation);
      if (invocation.delivery === 'steer') await sess.steer(text);
      else if (invocation.delivery === 'followUp') await sess.prompt(text, { deliverAs: 'followUp' });
      else await sess.prompt(text);
    } catch (error) {
      observer.detach();
      const failed = store.updateInvocation(invocation.id, {
        status: 'errored', endedAt: now(), error: errorMessage(error),
      });
      // A oneShot spawn whose delivery never landed would otherwise leave an
      // idle session nobody asked for. Only ever close what this run spawned.
      if (failed && spawned && routine.mode === 'oneShot') void scheduleClose(failed);
    }
  }

  async function nameSession(sess: LiveSession, routine: Routine) {
    if (!supports(sess, 'rename')) return;
    try {
      await sess.setName(`${routine.name} ${stamp(new Date(now()))}`);
    } catch (error) {
      // Naming is cosmetic; a harness that refuses it must not fail the run.
      log.warn?.(`Routine ${routine.name} could not name its session: ${errorMessage(error)}`);
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
      await delay(100, undefined, { ref: false });
      current = store.getInvocation(id);
    }
    return current;
  }

  function sweepStarting(at: number) {
    for (const invocation of store.activeInvocations()) {
      if (invocation.status !== 'starting') continue;  // a long turn is a long turn
      if (at - invocation.startedAt < STARTING_WATCHDOG_MS) continue;
      watched.get(invocation.id)?.detach();
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
      const cron = routine.schedule?.cron;
      if (!cron || routine.lastScheduledMinute === minute) continue;
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
        log.error?.(`Scheduled routine ${routine.name} failed to start: ${errorMessage(error)}`);
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
      if (completed && mode === 'oneShot') void scheduleClose(completed);
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      try {
        tick();
      } catch (error) {
        log.error?.(`Routine scheduler tick failed: ${errorMessage(error)}`);
      }
    }, TICK_MS);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer ?? undefined);
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
