/**
 * Routine lifecycle: trigger → spawn/deliver → observe → close. Every side
 * effect is an injected dep (testable without a spawn backend), and capability
 * checks go through `supports`, never a harness id.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { parseCron, cronMatches, nextCronMatch, type ParsedCron } from './cron';
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
  /** A scheduled run: the minute it stands for, and the earlier runs that were missed. */
  slot?: ScheduledSlot;
}

/** `late`: runs of the schedule since `since` that did not happen (pi-dish was down), which this one run stands for. */
export interface ScheduledSlot {
  at: number;
  late: number;
  since: number | null;
}

/** A message for a bot: delivered once per request id. */
export interface RoutineBotMessage {
  requestId: string;
  text: string;
  data: Record<string, string | number>;
}

/** What a routine whose destination is a bot reaches. */
export interface RoutineBots {
  /** The bot: its name, whether it is retired, and its session route; null when there is no such bot. */
  find(id: string): { name: string; retired: boolean; route: string } | null;
  /**
   * Hands the message to the bot's relay, starting the bot when it is not running; resolves whether the bot was
   * busy, so the message waits as a follow-up. Throws when it could not be delivered.
   */
  deliver(id: string, message: RoutineBotMessage): Promise<{ queued: boolean }>;
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
  /** Where routines whose destination is a bot are delivered; absent where bots do not run. */
  bots?: RoutineBots | null;
  now?(): number;
  log?: { error?(message: string): void; warn?(message: string): void };
}

export const DEFAULT_CLOSE_GRACE_MS = 10000;
export const STARTING_WATCHDOG_MS = 2 * 60 * 1000;
export const TICK_MS = 30000;
/** Missed runs of one schedule are counted up to here: the catch-up is one run however many there were. */
const LATE_COUNT_CAP = 1000;
// An aborted turn is `agent_end` with no paired `turn_end`, but a completed
// turn can deliver both back to back: give turn_end this long to claim it.
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

/**
 * The run a scheduler tick at `minute` owes a routine, or null. It is the current minute when the schedule matches it;
 * otherwise the newest slot since the routine last fired or was last edited that never ran, because pi-dish was down
 * or asleep. Either way it is one run, which counts the slots missed before it.
 */
export function routineDueSlot(parsed: ParsedCron, routine: Routine, minute: number): ScheduledSlot | null {
  const edited = routine.updatedAt ? Math.floor(routine.updatedAt / 60000) * 60000 : -Infinity;
  const from = Math.max(routine.lastScheduledMinute ?? -Infinity, edited);
  let late = 0;
  let since: number | null = null;
  let last: number | null = null;
  if (Number.isFinite(from)) {
    for (let next = nextCronMatch(parsed, new Date(from)); next && next.getTime() < minute && late < LATE_COUNT_CAP;
      next = nextCronMatch(parsed, next)) {
      late += 1;
      since ??= next.getTime();
      last = next.getTime();
    }
  }
  if (cronMatches(parsed, new Date(minute))) return { at: minute, late, since };
  return last === null ? null : { at: last, late, since };
}

/**
 * When the scheduler next runs `routine` from `at` on: at once when a tick in this minute owes it a run (its minute
 * matches, or it catches up a missed one), else at its next match. Null for a disabled, unscheduled or unparseable one.
 */
export function nextScheduledRun(routine: Routine, at: number): number | null {
  const cron = routine.schedule?.cron;
  if (!routine.enabled || !cron) return null;
  let parsed: ParsedCron;
  try { parsed = parseCron(cron); } catch { return null; }
  const minute = Math.floor(at / 60000) * 60000;
  if (routine.lastScheduledMinute !== minute && routineDueSlot(parsed, routine, minute)) return at;
  return nextCronMatch(parsed, new Date(at))?.getTime() ?? null;
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
    bots = null,
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
   * oneShot auto-close after a grace period (turn end ≠ pi done writing). A
   * refused/unprovable close records `closeError` and leaves the session live:
   * never escalate, a routine is not a process manager.
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
   * Returns the persisted invocation (`starting` or `skipped`) or throws a coded
   * 409/413/429 error. The body runs detached; callers poll the ledger.
   */
  function invoke(routine: Routine, { trigger = 'invoke', source = null, input = null, slot }: RoutineInvokeOptions = {}): RoutineInvocation {
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

    if (routine.bot) return invokeBot(routine, routine.bot, { trigger, source, input, slot }, at);

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

  /**
   * A bot routine's run is a message in its bot's conversation, headed with the routine's name, and starts no
   * session. It completes once the bot has taken it; the bot answers in its own chat, and a busy bot gets it as a
   * follow-up. A routine whose bot is retired stops: the run is skipped saying why, and its schedule is switched
   * off.
   */
  function invokeBot(routine: Routine, botId: string, { trigger = 'invoke', source = null, input = null, slot }: RoutineInvokeOptions, at: number): RoutineInvocation {
    const bot = bots?.find(botId) ?? null;
    const gone = !bots ? 'bots do not run on this host'
      : !bot ? `its bot (${botId}) is not in the registry` : bot.retired ? `its bot ${bot.name} is retired` : null;
    if (gone || !bot || bot.retired) {
      // Bots are retired, never deleted: one that is not found means the registry is unreadable, which may pass.
      const stops = !!bot?.retired && routine.enabled && !!routine.schedule;
      if (stops) store.updateRoutine(routine.id, { enabled: false });
      return store.createInvocation({
        routine, trigger, source, input: null, status: 'skipped', startedAt: at,
        skipReason: stops ? `${gone}; its schedule is switched off` : gone,
      });
    }
    // A scheduled run never piles up behind a delivery still in flight, such as one waiting for its bot to start.
    if (trigger === 'schedule' && store.activeInvocation(routine.id)) {
      return store.createInvocation({
        routine, trigger, source, input: null, status: 'skipped', skipReason: 'busy', startedAt: at,
      });
    }
    const invocation = store.createInvocation({ routine, trigger, source, input, status: 'starting', startedAt: at });
    deliverRun(routine, botId, bot, invocation, slot ?? null).catch((error) => {
      log.error?.(`Routine ${routine.name} could not reach ${bot.name}: ${errorMessage(error)}`);
      store.updateInvocation(invocation.id, { status: 'errored', endedAt: now(), sessionId: bot.route, error: errorMessage(error) });
    });
    return invocation;
  }

  async function deliverRun(routine: Routine, botId: string, bot: { name: string; route: string }, invocation: RoutineInvocation, slot: ScheduledSlot | null) {
    const prompt = await composePrompt(routine, invocation);
    const { queued } = await bots!.deliver(botId, {
      requestId: `routine:${invocation.id}`,
      text: `${botRunHeading(routine, invocation, slot)}\n\n${prompt}`,
      data: {
        routineId: routine.id, routineName: routine.name, invocationId: invocation.id, trigger: invocation.trigger,
        ...(slot ? { scheduledFor: slot.at, late: slot.late } : {}),
      },
    });
    store.updateInvocation(invocation.id, {
      status: 'completed', endedAt: now(), sessionId: bot.route, delivery: queued ? 'followUp' : 'prompt',
      summary: queued ? `Queued for ${bot.name} behind its current run; it answers in its chat.` : `Delivered to ${bot.name}; it answers in its chat.`,
    });
  }

  /** What tells the bot a schedule from the user: the routine's name, when the run was due, and any it stands for. */
  function botRunHeading(routine: Routine, invocation: RoutineInvocation, slot: ScheduledSlot | null): string {
    const when = !slot
      ? `run on demand${invocation.source ? ` by ${invocation.source}` : ''}`
      : `scheduled for ${stamp(new Date(slot.at))}`;
    const missed = slot?.late
      ? ` pi-dish was down and missed ${slot.late}${slot.late >= LATE_COUNT_CAP ? ' or more' : ''} run${slot.late === 1 ? '' : 's'} of it`
        + `${slot.since ? ` from ${stamp(new Date(slot.since))}` : ''}; this one run stands for ${slot.late === 1 ? 'it' : 'them all'}.`
      : '';
    return `[routine "${routine.name}", ${when}.${missed} This message comes from the routine, not from the user: do what it asks and answer here, in your chat.]`;
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
   * Fires each routine its schedule owes a run, once: a run missed while pi-dish was down fires once when it is
   * back, however many slots it missed. `lastScheduledMinute` persists before the fire so a restart can't double-run.
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
      const slot = routineDueSlot(parsed, routine, minute);
      if (!slot) continue;
      store.markScheduled(routine.id, minute);
      const source = slot.late
        ? `after ${slot.late}${slot.late >= LATE_COUNT_CAP ? '+' : ''} missed run${slot.late === 1 ? '' : 's'}` : null;
      try {
        invoke(routine, { trigger: 'schedule', source, slot });
      } catch (error) {
        log.error?.(`Scheduled routine ${routine.name} failed to start: ${errorMessage(error)}`);
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
