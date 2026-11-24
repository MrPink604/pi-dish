import fs = require('fs');
import path = require('path');
import readline = require('readline');
import crypto = require('crypto');
import { setTimeout as delay } from 'timers/promises';
import { BridgeSession } from './bridge-session';
import { PrimeDaemonSession } from './prime-daemon';
import { dishDir, replaceFileDurably, syncDirectory } from './dish-store';
import { formatModelRef } from './helper-models';
import type { ProcessIdentity } from './contracts';
import { processIdentity, processIdentityAlive } from './process-identity';
import { SessionOperationError } from './session-operations';
import type { ResumeSessionResult, SessionOperations } from './session-operations';
import { liveSessionSupports, recoveryRouteId, routeIdentity, routeSessionId, sameProcessIdentity, validateRecoveryRecord } from './session-ownership';
import type { LiveSession, SessionOwnership } from './session-ownership';
import { validSessionId } from './session-key';
import * as recoveryStore from './session-recovery';
import type { RecoveryAttempt, RecoveryRecord } from './session-recovery';
import { TmuxServerLostError } from './tmux';
import type { LiveTmuxPane, TmuxServerSnapshot } from './tmux';
import { record as isRecord } from './helper-values';
import { errorMessage } from './http-boundary';

export type RecoveryMode = 'off' | 'restore' | 'continue';
export type RecoveryStatus = 'pending' | 'failed' | 'needs-review' | 'closed' | 'live' | 'restoring' | 'restored' | 'continued';

/** Reports retain untrusted legacy attempt values rather than laundering them into defaults. */
export interface RecoveryReportSession {
  id: string;
  harnessId: string;
  name: string | null;
  cwd: string | null;
  excluded: boolean;
  status: unknown;
  reason: unknown;
  updatedAt: unknown;
}

export interface RecoveryOutcome extends RecoveryReportSession {
  status: RecoveryStatus;
  updatedAt: number;
}

export interface RecoveryReport {
  mode: RecoveryMode;
  sessions: RecoveryReportSession[];
  truncated: boolean;
  totalRecords: number;
}

export interface RecoveryReportOptions {
  /** Include PIN-protected private sessions; callers must gate this on private unlock. */
  includePrivate?: boolean;
}

export interface RecoveryRetryOptions {
  /** Include PIN-protected private sessions; defaults false (fail closed). */
  includePrivate?: boolean;
}

export interface RecoveryRetryAllOptions {
  /** Include PIN-protected private sessions; defaults false (fail closed). */
  includePrivate?: boolean;
}

export interface RecoverLostOptions {
  /** Bind headless tmux launches to one exact replacement server (-N, no server creation). */
  expectedTmuxServer?: ProcessIdentity | null;
  /** Checked around each launch; returning false aborts the batch and reconciles its rows. */
  checkServer?: () => Promise<boolean>;
}

export interface ReconcileLostResult {
  live: RecoveryOutcome[];
  deadIds: string[];
  outcomes: RecoveryOutcome[];
}

export interface RecoveryRunner {
  start(): Promise<void>;
  retry(id: string, options?: RecoveryRetryOptions): Promise<RecoveryOutcome>;
  /** Explicitly retries failed rows and pending tmux-lost sessions, one at a time. */
  retryAll(options?: RecoveryRetryAllOptions): Promise<RecoveryOutcome[]>;
  /** Marks routes affected by confirmed tmux server loss as restore-only immediately on detection. */
  markLostRestoreOnly(ids: readonly string[]): void;
  /** Automatic restore-only recovery of sessions that were live in a lost tmux server. */
  recoverLost(ids: readonly string[], options?: RecoverLostOptions): Promise<RecoveryOutcome[]>;
  /** Reconciles rows in a lost/aborted batch against live sessions so reports stay accurate. */
  reconcileLost(ids: readonly string[], reason: string, options?: { status?: 'failed' | 'needs-review' }): Promise<ReconcileLostResult>;
  /** Records a persisted needs-review outcome when automatic server-loss recovery is rate-limited. */
  markLostRateLimited(ids: readonly string[], reason: string): RecoveryOutcome[];
  /** True while a recovery launch/check flight is currently active for `id`. */
  isRecovering(id: string): boolean;
  report(options?: RecoveryReportOptions): RecoveryReport;
  outcome(id: string): RecoveryOutcome | null;
  stop(): void;
}

export type RecoveryRunnerStore = Pick<typeof recoveryStore,
  'listRecords' | 'readRecord' | 'getControl' | 'patchControl' | 'checkpointMatches'>;

export interface RecoveryPresentationOptions {
  getMode(): unknown;
  now?: () => number;
  log?: { error?: (message: string) => void };
  /** Memory-pressure hibernation keeps a session for wake-on-message, not startup restore. */
  hibernated?(routeId: string): boolean;
  /** Completed one-shot routines awaiting auto-close must not be resurrected by loss recovery. */
  isPendingClose?(routeId: string): boolean;
  /** Identifies private PIN-gated sessions so locked reports and retries omit/refuse them. */
  isPrivate?(record: RecoveryRecord): boolean;
  /** Returns a refusal reason if startup recovery for `routeId` is suppressed by persisted tmux-loss backoff. */
  suppressedAtStartup?(routeId: string): string | null;
}

/** Isolated runner seams; production policy is composed by createRecoveryRuntime below. */
export interface RecoveryRunnerOptions extends RecoveryPresentationOptions {
  store: RecoveryRunnerStore;
  routeId: typeof recoveryRouteId;
  probeLive: SessionOperations['probeRecoveryLive'];
  validateRecord: typeof validateRecoveryRecord;
  restore(record: RecoveryRecord, options?: { expectedTmuxServer?: ProcessIdentity | null }): Promise<ResumeSessionResult>;
  continueSession(record: RecoveryRecord, session: LiveSession, message: string): Promise<void>;
}

export interface RecoveryRuntimeOptions extends RecoveryPresentationOptions {
  operations: SessionOperations;
  ownership: SessionOwnership;
}

const MAX_SESSIONS = 5000;
export const RECOVERY_PROMPT = 'pi-dish recovery: this session was interrupted while work was in progress. Before continuing, inspect the transcript, working files, and any external state affected by prior tools. A tool or external action may have completed without its result being recorded. Do not blindly repeat commands, writes, deployments, purchases, or other side effects. Reconcile what actually happened, explain any uncertainty, and ask for confirmation where safe continuation cannot be established. Continue the existing task only after this inspection; this message is not an instruction to replay the last prompt or retry a tool.';
const HIBERNATED_REASON = 'Hibernated under memory pressure; a message resumes it.';
const RUNNING_STATUSES: Record<string, true> = { live: true, restored: true, continued: true };
/** startup: pi-dish started; explicit: an API retry; tmux-lost: the tmux server holding the live agent died or was replaced. */
type RecoveryTrigger = 'startup' | 'explicit' | 'tmux-lost';
/** Harnesses whose lifecycle observations and bridge prompt path are verified. */
const PROMPT_RECOVERY_HARNESSES: Record<string, true> = { pi: true, omp: true, agy: true };
const TMUX_LOSS_STATE_VERSION = 1;
const MAX_TMUX_LOSS_STATE_BYTES = 64 * 1024;
const DEFAULT_LOSS_BACKOFF_MS = 5 * 60_000;
const DEFAULT_LOSS_MAX_BACKOFF_MS = 30 * 60_000;
const DEFAULT_LOSS_WINDOW_MS = 60 * 60_000;
const DEFAULT_LOSS_MAX_ATTEMPTS = 3;

export function recoveryMode(value: unknown): RecoveryMode {
  return value === 'off' || value === 'restore' || value === 'continue' ? value : 'off';
}

// Stream with explicit bounds: a corrupt/huge transcript is reviewable, not a
// reason to allocate the whole corpus or guess whether a tool finished.
export async function continuationSafety(file: string): Promise<string | null> {
  let stat;
  try { stat = fs.statSync(file); } catch { return 'The transcript cannot be read.'; }
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return 'The transcript exceeds the safe continuation inspection limit.';
  const input = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 16 * 1024 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<string>();
  let count = 0, lastMessage: Record<string, unknown> | null = null, lastType: unknown = null;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (++count > 200000 || line.length > 4 * 1024 * 1024) return 'The transcript exceeds the safe continuation inspection limit.';
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { return 'The transcript contains an incomplete or corrupt entry.'; }
      if (!isRecord(entry)) return 'The transcript contains an incomplete or corrupt entry.';
      lastType = entry.type;
      if (lastType !== 'message') continue;
      const message = entry.message;
      if (!isRecord(message) || typeof message.role !== 'string') return 'The transcript contains an unverifiable message.';
      lastMessage = message;
      if (message.role === 'assistant') {
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (!isRecord(block)) return 'The transcript contains an unverifiable assistant content block.';
          if (block.type !== 'toolCall' && block.type !== 'tool_use') continue;
          const id = block.id;
          if (typeof id !== 'string') return 'A tool call has no verifiable identity.';
          pending.add(id);
          if (pending.size > 10000) return 'Too many unresolved tool calls to verify safely.';
        }
      } else if (message.role === 'toolResult') {
        const toolCallId = message.toolCallId;
        if (typeof toolCallId !== 'string') return 'A tool result has no verifiable identity.';
        pending.delete(toolCallId);
      }
    }
  } catch { return 'The transcript cannot be inspected safely.'; }
  finally { lines.close(); input.destroy(); }
  if (pending.size) return 'Tool calls have no recorded result; inspect their external effects before continuing.';
  if (lastType === 'compaction' || lastType === 'branch_summary') return 'The transcript ends during compaction or branch navigation.';
  if (!lastMessage) return 'There is no interrupted conversation to continue.';
  if (lastMessage.role === 'assistant') {
    const stopReason = lastMessage.stopReason;
    if (stopReason === 'aborted' || stopReason === 'error') return 'The last assistant response was aborted or failed.';
    if (stopReason !== 'toolUse') return 'The last assistant response may already have completed.';
  }
  return null;
}

export function createRecoveryRunner(deps: RecoveryRunnerOptions): RecoveryRunner {
  const { store, getMode, routeId, probeLive, validateRecord, restore, continueSession,
    now = () => Date.now(), log = console, hibernated = () => false,
    isPendingClose = () => false, isPrivate = () => false,
    suppressedAtStartup = () => null } = deps;
  const reports = new Map<string, RecoveryOutcome>();
  const reportObservations = new Map<string, string>();
  const flights = new Map<string, Promise<RecoveryOutcome>>();
  /** Sessions a tmux server loss took down, until one of them runs again. */
  const lost = new Set<string>();
  /** Routes affected by confirmed tmux server loss: must never receive an automatic paid continuation prompt. */
  const restoreOnly = new Set<string>();
  let startPromise: Promise<void> | null = null;
  let stopped = false;

  function safeRouteId(record: RecoveryRecord): string | null {
    if (!validSessionId(record.nativeSessionId)) return null;
    try {
      const id = routeId(record);
      return routeIdentity(id) ? id : null;
    } catch {
      return null;
    }
  }

  function markLostRestoreOnly(ids: readonly string[]): void {
    for (const id of ids) {
      restoreOnly.add(id);
      lost.add(id);
    }
  }

  function remember(record: RecoveryRecord, status: RecoveryStatus, reason: unknown): RecoveryOutcome {
    const id = routeId(record);
    const row: RecoveryOutcome = { id, harnessId: record.harnessId, name: record.name || null,
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

  function save(record: RecoveryRecord, status: RecoveryStatus, reason: unknown, extra: RecoveryAttempt = {}): RecoveryOutcome {
    const control = store.getControl(record.harnessId, record.nativeSessionId);
    const attempt: RecoveryAttempt = { ...control.attempt, ...extra, observationId: record.observationId,
      status, reason: reason || null, updatedAt: now() };
    store.patchControl(record.harnessId, record.nativeSessionId, { attempt });
    return remember(record, status, reason);
  }

  function newestRecords(): RecoveryRecord[] {
    return store.listRecords().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  function report({ includePrivate = true }: RecoveryReportOptions = {}): RecoveryReport {
    const rows = new Map<string, RecoveryReportSession>();
    const allRecords = newestRecords();
    const records = allRecords.filter(record => {
      if (!safeRouteId(record)) return false;
      return includePrivate || !isPrivate(record);
    });
    for (const record of records.slice(0, MAX_SESSIONS)) {
      const id = safeRouteId(record)!;
      const control = store.getControl(record.harnessId, record.nativeSessionId);
      let row: Omit<RecoveryReportSession, 'excluded'> | null | undefined = reports.get(id);
      const previous = control.attempt;
      const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
      if (row && (row.status === 'pending' || row.status === 'failed' || row.status === 'needs-review')
          && reportObservations.get(id) !== record.observationId && !ambiguous) row = null;
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

  async function run(
    record: RecoveryRecord,
    trigger: RecoveryTrigger,
    options?: { expectedTmuxServer?: ProcessIdentity | null },
  ): Promise<RecoveryOutcome> {
    const id = routeId(record);
    const explicit = trigger === 'explicit';
    const isRestoreOnly = () => trigger === 'tmux-lost' || restoreOnly.has(id);
    const previous = store.getControl(record.harnessId, record.nativeSessionId).attempt;
    const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
    // Settings, a newer observation, or a confirmed tmux loss can cancel continuation at any await.
    function continuationRefusal(advanced: string): { status: 'restored' | 'needs-review'; reason: string } | null {
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
      if (ambiguous && !explicit) return remember(record, 'needs-review', 'An earlier recovery launch or prompt has an uncertain outcome; inspect it before retrying.');
      if (live) return remember(record, ambiguous ? 'needs-review' : 'live', ambiguous
        ? 'The session is live, but an earlier recovery prompt has uncertain delivery. It was not resent.' : 'Attached to the surviving session; no prompt was sent.');
      const control = store.getControl(record.harnessId, record.nativeSessionId);
      if (control.closed) return remember(record, 'closed', 'This session was explicitly closed.');
      if (isPendingClose(id) && !explicit) return remember(record, 'closed', 'Routine one-shot session was pending auto-close.');
      if (hibernated(id) && !explicit) return remember(record, 'pending', HIBERNATED_REASON);
      if (control.excluded) return remember(record, 'pending', 'Excluded from automatic recovery.');
      if (stopped || (!explicit && recoveryMode(getMode()) === 'off')) return remember(record, 'pending', 'Automatic recovery is off.');
      if (trigger === 'startup') {
        const suppressedReason = suppressedAtStartup(id);
        if (suppressedReason) return remember(record, 'needs-review', suppressedReason);
      }
      // A confirmed tmux server loss hangs up every agent inside it: that SIGHUP shutdown is the loss, not a quit.
      if (!explicit && record.shutdown && trigger !== 'tmux-lost') {
        return remember(record, 'needs-review', 'The harness shut down; quit, reload, and operating-system shutdown cannot be distinguished.');
      }
      const repeatIdleRestore = record.activity === 'idle'
        && (previous?.status === 'restored' || (trigger === 'tmux-lost' && previous?.status === 'failed'))
        && !previous.delivery;
      if (!explicit && previous?.observationId === record.observationId && !repeatIdleRestore) {
        return remember(record, 'needs-review', previous.reason || 'This observation was already recovered; automatic retries are disabled.');
      }
      await validateRecord(record);
      const matched = store.checkpointMatches(record);
      let safety: string | null = null;
      if (!isRestoreOnly() && trigger === 'startup' && recoveryMode(getMode()) === 'continue' && record.activity !== 'idle') {
        safety = record.activity !== 'running' || !record.runId
          ? 'The interrupted activity cannot be classified safely.'
            : !matched ? 'The transcript changed after the last durable observation; no prompt was sent.'
            : !Object.hasOwn(PROMPT_RECOVERY_HARNESSES, record.harnessId) ? 'This harness has no verified recovery prompt path.'
              : await continuationSafety(record.sessionFile);
      } else if (isRestoreOnly() && !explicit && recoveryMode(getMode()) === 'continue' && record.activity === 'running') {
        // Server-loss recovery never starts a new paid turn on its own; still inspect
        // the transcript with continuationSafety so interrupted work is flagged clearly.
        safety = !matched
          ? 'The transcript changed after the last durable observation; restored idle without prompting.'
          : await continuationSafety(record.sessionFile);
      }
      // Durable intent precedes even the launch. A crash after this point is
      // ambiguous until a live identity or an explicit restore-only retry.
      save(record, 'restoring', null, { id: crypto.randomUUID(), delivery: previous?.delivery === 'uncertain' ? 'uncertain' : null });
      const result = await restore(record, options);
      // A returned launch is not a running agent: restored means a live, registered session now.
      const session = await probeLive(record);
      if (!session) {
        throw new Error('The agent was launched but is not running with a registered bridge, so it was not restored.');
      }
      if (result.alreadyActive || result.sharedResume) return save(record, 'live', 'Another caller restored this session; no recovery prompt was sent.');
      if (isRestoreOnly()) {
        if (previous?.delivery === 'uncertain') {
          return save(record, 'needs-review', 'Restored without resending the earlier uncertain recovery prompt.');
        }
        if (recoveryMode(getMode()) === 'continue' && record.activity === 'running') {
          const inspection = safety ?? (!store.checkpointMatches(record)
            ? 'The transcript changed after the last durable observation; restored idle without prompting.'
            : await continuationSafety(record.sessionFile));
          return save(record, 'needs-review', inspection || 'Restored idle after tmux server loss without sending a prompt; inspect interrupted work before continuing.');
        }
        return save(record, 'restored', 'Restored after tmux server loss without sending a prompt.');
      }
      if (explicit || recoveryMode(getMode()) !== 'continue' || record.activity === 'idle') {
        return save(record, previous?.delivery === 'uncertain' ? 'needs-review' : 'restored', previous?.delivery === 'uncertain'
          ? 'Restored without resending the earlier uncertain recovery prompt.' : 'Restored without sending a prompt.');
      }
      if (safety) return save(record, 'needs-review', safety);
      const refusal = continuationRefusal('The session or transcript advanced during recovery; no prompt was sent.');
      if (refusal) return save(record, refusal.status, refusal.reason);
      if (session.turnInProgress || session.compacting) return save(record, 'needs-review', 'The restored session is unavailable, already working, or compacting; no prompt was sent.');
      // A second checkpoint immediately before durable delivery intent closes
      // the asynchronous live-handshake window. Delivery is never retried.
      const beforeDelivery = continuationRefusal('The session advanced before delivery; no prompt was sent.');
      if (beforeDelivery) return save(record, beforeDelivery.status, beforeDelivery.reason);
      if (isRestoreOnly()) {
        return save(record, 'needs-review', 'Restored idle after tmux server loss without sending a prompt; inspect interrupted work before continuing.');
      }
      save(record, 'restoring', 'Recovery prompt delivery is in progress.', { delivery: 'uncertain' });
      await continueSession(record, session, RECOVERY_PROMPT);
      return save(record, 'continued', 'Sent one visible recovery prompt to inspect state before continuing.', { delivery: 'confirmed' });
    } catch (error) {
      const attempt = store.getControl(record.harnessId, record.nativeSessionId).attempt;
      const uncertain = attempt?.delivery === 'uncertain'
        || (attempt?.status === 'restoring' && !(error instanceof TmuxServerLostError && error.beforeSpawn));
      try { return save(record, uncertain ? 'needs-review' : 'failed', errorMessage(error)); }
      catch (persistError) {
        log.error?.(`Recovery ${id}: ${errorMessage(persistError)}`);
        return remember(record, 'failed', `Recovery state could not be persisted: ${errorMessage(persistError)}. ${errorMessage(error)}`);
      }
    }
  }

  function recover(
    record: RecoveryRecord,
    trigger: RecoveryTrigger = 'startup',
    options?: { expectedTmuxServer?: ProcessIdentity | null },
  ): Promise<RecoveryOutcome> {
    const id = routeId(record);
    const existing = flights.get(id);
    if (existing) return existing;
    const flight = Promise.resolve().then(() => run(record, trigger, options)).then(outcome => {
      if (Object.hasOwn(RUNNING_STATUSES, outcome.status)) lost.delete(id);
      return outcome;
    });
    flights.set(id, flight);
    flight.finally(() => { if (flights.get(id) === flight) flights.delete(id); }).catch(() => {});
    return flight;
  }

  function start(): Promise<void> {
    if (startPromise) return startPromise;
    // Capture once, before any await or recovered harness can overwrite it.
    const records: RecoveryRecord[] = [];
    if (recoveryMode(getMode()) !== 'off') {
      for (const record of newestRecords()) {
        if (!safeRouteId(record)) continue;
        const control = store.getControl(record.harnessId, record.nativeSessionId);
        if (control.closed || control.excluded) continue;
        records.push(record);
        if (records.length === MAX_SESSIONS) break;
      }
    }
    startPromise = (async () => {
      for (const record of records) {
        if (stopped) break;
        await recover(record, 'startup');
      }
    })();
    return startPromise;
  }

  async function retry(id: string, { includePrivate = false }: RecoveryRetryOptions = {}): Promise<RecoveryOutcome> {
    const parsed = routeIdentity(id);
    if (!parsed) throw new SessionOperationError(400, 'Invalid session ID');
    const canonical = routeSessionId(parsed.harnessId, parsed.nativeSessionId);
    const record = store.listRecords().find(candidate => {
      const candidateId = safeRouteId(candidate);
      if (!candidateId) return false;
      if (candidateId === id || candidateId === canonical) return true;
      const candidateIdentity = routeIdentity(candidateId);
      return !!candidateIdentity && routeSessionId(candidateIdentity.harnessId, candidateIdentity.nativeSessionId) === canonical;
    });
    if (!record) throw new SessionOperationError(404, 'Recovery record not found');
    if (!includePrivate && isPrivate(record)) throw new SessionOperationError(404, 'Recovery record not found');
    return recover(record, 'explicit');
  }

  // Sequential: each launch waits for its registration, and a host that just
  // lost its tmux server may be short of memory. Needs-review, ambiguous and
  // locked private sessions stay out of bulk retry.
  async function retryAll({ includePrivate = false }: RecoveryRetryAllOptions = {}): Promise<RecoveryOutcome[]> {
    const statusById = new Map(report({ includePrivate }).sessions.map(row => [row.id, row.status]));
    const outcomes: RecoveryOutcome[] = [];
    for (const record of newestRecords()) {
      if (stopped) break;
      const id = safeRouteId(record);
      if (!id) continue;
      if (!includePrivate && isPrivate(record)) continue;
      const control = store.getControl(record.harnessId, record.nativeSessionId);
      if (control.closed || control.excluded || hibernated(id) || isPendingClose(id)) continue;
      const previous = control.attempt;
      if (previous?.delivery === 'uncertain' || previous?.status === 'restoring') continue;
      const status = statusById.get(id);
      if (status !== 'failed' && !(lost.has(id) && status === 'pending')) continue;
      outcomes.push(await recover(record, 'explicit'));
    }
    return outcomes;
  }

  async function reconcileLost(
    ids: readonly string[],
    reason: string,
    { status = 'needs-review' }: { status?: 'failed' | 'needs-review' } = {},
  ): Promise<ReconcileLostResult> {
    markLostRestoreOnly(ids);
    const wanted = new Set(ids);
    const live: RecoveryOutcome[] = [];
    const deadIds: string[] = [];
    const outcomes: RecoveryOutcome[] = [];
    for (const record of newestRecords()) {
      const id = safeRouteId(record);
      if (!id || !wanted.has(id)) continue;
      const control = store.getControl(record.harnessId, record.nativeSessionId);
      if (control.closed || control.excluded || hibernated(id) || isPendingClose(id)) continue;
      const running = await probeLive(record).catch(() => null);
      if (running) {
        const row = remember(record, 'live', 'Attached to the surviving session; no prompt was sent.');
        lost.delete(id);
        live.push(row);
        outcomes.push(row);
        continue;
      }
      deadIds.push(id);
      lost.add(id);
      try {
        outcomes.push(save(record, status, reason));
      } catch (persistError) {
        log.error?.(`Recovery ${id}: ${errorMessage(persistError)}`);
        outcomes.push(remember(record, status, reason));
      }
    }
    return { live, deadIds, outcomes };
  }

  async function recoverLost(ids: readonly string[], { expectedTmuxServer = null, checkServer }: RecoverLostOptions = {}): Promise<RecoveryOutcome[]> {
    markLostRestoreOnly(ids);
    const wanted = new Set(ids);
    const outcomes: RecoveryOutcome[] = [];
    let serverLost = false;
    for (const record of newestRecords()) {
      if (stopped) break;
      const id = safeRouteId(record);
      if (!id || !wanted.has(id)) continue;
      if (checkServer && !(await checkServer())) {
        serverLost = true;
        break;
      }
      outcomes.push(await recover(record, 'tmux-lost', { expectedTmuxServer }));
      if (checkServer && !(await checkServer())) {
        serverLost = true;
        break;
      }
    }
    if (serverLost && !stopped) {
      const reconciled = await reconcileLost(ids, 'Replacement tmux server died during recovery batch.', { status: 'failed' });
      return reconciled.outcomes;
    }
    return outcomes;
  }

  function markLostRateLimited(ids: readonly string[], reason: string): RecoveryOutcome[] {
    markLostRestoreOnly(ids);
    const wanted = new Set(ids);
    const outcomes: RecoveryOutcome[] = [];
    for (const record of newestRecords()) {
      const id = safeRouteId(record);
      if (!id || !wanted.has(id)) continue;
      const control = store.getControl(record.harnessId, record.nativeSessionId);
      if (control.closed || control.excluded || hibernated(id) || isPendingClose(id)) continue;
      lost.add(id);
      try {
        outcomes.push(save(record, 'needs-review', reason));
      } catch (persistError) {
        log.error?.(`Recovery ${id}: ${errorMessage(persistError)}`);
        outcomes.push(remember(record, 'needs-review', reason));
      }
    }
    return outcomes;
  }

  return {
    start, retry, retryAll, markLostRestoreOnly, recoverLost, reconcileLost, markLostRateLimited,
    isRecovering: id => flights.has(id),
    report, outcome: id => reports.get(id) ?? null,
    stop: () => { stopped = true; },
  };
}

export interface TmuxLossLimiterOptions {
  /** Override state file path; defaults to ~/.pi/dish/tmux-recovery-state.json. */
  file?: () => string;
  now?: () => number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  windowMs?: number;
  maxAttempts?: number;
}

export type TmuxLossVerdict =
  | { allowed: true }
  | { allowed: false; retryAt: number | null; reason: string };

export interface TmuxLossSuppression {
  agentIds?: readonly string[];
  botIds?: readonly string[];
}

export interface TmuxLossLimiter {
  check(at?: number): TmuxLossVerdict;
  record(at?: number): void;
  /** Persists agents/bots suppressed by a rate-limited or failed server-loss recovery across restarts. */
  suppress(targets: TmuxLossSuppression): void;
  /** Clears agents/bots from persisted suppression once running or explicitly resumed. */
  clearSuppressed(targets: TmuxLossSuppression): void;
  /** Returns a refusal reason if startup launch for `botId` is currently suppressed by backoff/cap or corrupt state. */
  suppressedBotReason(botId: string, at?: number): string | null;
  /** Returns a refusal reason if startup recovery for `agentId` is currently suppressed by backoff/cap or corrupt state. */
  suppressedAgentReason(agentId: string, at?: number): string | null;
}

interface TmuxLossState {
  version: 1;
  attempts: number[];
  nextAllowedAt: number;
  suppressedBots: string[];
  suppressedAgents: string[];
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}

function ensurePrivateDir(dir: string): void {
  const firstCreated = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  if (firstCreated) {
    let current = dir;
    for (;;) {
      syncDirectory(current);
      if (current === path.dirname(firstCreated)) break;
      current = path.dirname(current);
    }
  }
}

function validStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string' && entry.length > 0 && entry.length <= 512);
}

/**
 * Durable exponential-backoff and rolling-window limiter for automatic tmux
 * server-loss recovery. Persisted on disk so crash loops across pi-dish
 * restarts cannot respawn forever; fails closed if the state file is corrupt.
 */
export function createTmuxLossLimiter(options: TmuxLossLimiterOptions = {}): TmuxLossLimiter {
  const fileOf = options.file ?? (() => path.join(dishDir(), 'tmux-recovery-state.json'));
  const now = options.now ?? (() => Date.now());
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_LOSS_BACKOFF_MS;
  const maxBackoffMs = Math.max(baseBackoffMs, options.maxBackoffMs ?? DEFAULT_LOSS_MAX_BACKOFF_MS);
  const windowMs = options.windowMs ?? DEFAULT_LOSS_WINDOW_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_LOSS_MAX_ATTEMPTS;

  function readState(): TmuxLossState {
    const file = fileOf();
    let fd: number | undefined;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_TMUX_LOSS_STATE_BYTES) {
        throw new Error('Invalid tmux recovery rate-limit state file');
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (!isRecord(parsed)
          || parsed.version !== TMUX_LOSS_STATE_VERSION
          || !Array.isArray(parsed.attempts)
          || !parsed.attempts.every(entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0)
          || typeof parsed.nextAllowedAt !== 'number'
          || !Number.isFinite(parsed.nextAllowedAt)
          || parsed.nextAllowedAt < 0
          || (parsed.suppressedBots !== undefined && !validStringList(parsed.suppressedBots))
          || (parsed.suppressedAgents !== undefined && !validStringList(parsed.suppressedAgents))) {
        throw new Error('Corrupt tmux recovery rate-limit state');
      }
      return {
        version: TMUX_LOSS_STATE_VERSION,
        attempts: [...parsed.attempts],
        nextAllowedAt: parsed.nextAllowedAt,
        suppressedBots: parsed.suppressedBots ? [...parsed.suppressedBots] : [],
        suppressedAgents: parsed.suppressedAgents ? [...parsed.suppressedAgents] : [],
      };
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') {
        return { version: TMUX_LOSS_STATE_VERSION, attempts: [], nextAllowedAt: 0, suppressedBots: [], suppressedAgents: [] };
      }
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  function writeState(next: TmuxLossState): void {
    const file = fileOf();
    ensurePrivateDir(path.dirname(file));
    replaceFileDurably(file, JSON.stringify(next));
  }

  function check(at = now()): TmuxLossVerdict {
    let state: TmuxLossState;
    try {
      state = readState();
    } catch {
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

  function record(at = now()): void {
    const state = readState();
    const recent = [...state.attempts.filter(ts => at - ts < windowMs), at];
    const backoff = Math.min(maxBackoffMs, baseBackoffMs * (2 ** (recent.length - 1)));
    writeState({
      version: TMUX_LOSS_STATE_VERSION,
      attempts: recent,
      nextAllowedAt: Math.max(state.nextAllowedAt, at + backoff),
      suppressedBots: state.suppressedBots,
      suppressedAgents: state.suppressedAgents,
    });
  }

  function suppress({ agentIds = [], botIds = [] }: TmuxLossSuppression): void {
    if (!agentIds.length && !botIds.length) return;
    const state = readState();
    const bots = new Set(state.suppressedBots);
    const agents = new Set(state.suppressedAgents);
    for (const id of botIds) if (id) bots.add(id);
    for (const id of agentIds) if (id) agents.add(id);
    writeState({
      ...state,
      suppressedBots: [...bots],
      suppressedAgents: [...agents],
    });
  }

  function clearSuppressed({ agentIds = [], botIds = [] }: TmuxLossSuppression): void {
    if (!agentIds.length && !botIds.length) return;
    let state: TmuxLossState;
    try { state = readState(); } catch { return; }
    const clearBots = new Set(botIds);
    const clearAgents = new Set(agentIds);
    const nextBots = state.suppressedBots.filter(id => !clearBots.has(id));
    const nextAgents = state.suppressedAgents.filter(id => !clearAgents.has(id));
    if (nextBots.length === state.suppressedBots.length && nextAgents.length === state.suppressedAgents.length) return;
    writeState({ ...state, suppressedBots: nextBots, suppressedAgents: nextAgents });
  }

  function suppressedReason(kind: 'bot' | 'agent', id: string, at = now()): string | null {
    const verdict = check(at);
    if (verdict.allowed) return null;
    let state: TmuxLossState;
    try { state = readState(); } catch { return verdict.reason; }
    const list = kind === 'bot' ? state.suppressedBots : state.suppressedAgents;
    return list.includes(id) ? verdict.reason : null;
  }

  return {
    check,
    record,
    suppress,
    clearSuppressed,
    suppressedBotReason: (botId, at) => suppressedReason('bot', botId, at),
    suppressedAgentReason: (agentId, at) => suppressedReason('agent', agentId, at),
  };
}

export interface WatchedTmuxServerSessions {
  agentIds: string[];
  botIds: string[];
  /** Live processes inside the server's panes (pane roots + agents/bots) to wait out on loss. */
  processes: ProcessIdentity[];
}

export interface TmuxServerLossEvent {
  server: ProcessIdentity;
  replacementPid: number | null;
  agentIds: string[];
  botIds: string[];
}

export interface TmuxServerWatchOptions {
  socket: string;
  inspectServer(socket: string): Promise<TmuxServerSnapshot | null>;
  /** Called only after verifying at least one live pi-dish placement inside the server. */
  configureServer?(socket: string): Promise<boolean | void>;
  snapshotSessions(socket: string, panes: ReadonlyMap<string, LiveTmuxPane>): WatchedTmuxServerSessions;
  /** Fired synchronously as soon as server loss is confirmed, before waiting for process exit. */
  onLossDetected?(event: TmuxServerLossEvent): void;
  onLost(event: TmuxServerLossEvent): Promise<unknown>;
  intervalMs?: number;
  /** Post-exit settle delay after dead-pane processes exit (default 500 ms). */
  settleMs?: number;
  /** Maximum time to wait for hung-up pane processes to exit before relaunching (default 10 s). */
  exitWaitMs?: number;
  processAlive?: (identity: ProcessIdentity) => boolean;
  log?: { error?: (message: string) => void };
}

export interface TmuxServerWatch {
  /** One poll; coalesced single-flight with concurrent checks. */
  tick(): Promise<void>;
  /** Trigger an immediate coalesced check (e.g., on tmux no-server error or after spawn). */
  checkNow(): void;
  stop(): void;
}

/**
 * Watches one tmux server (pi-dish's own socket). Remembers its exact process
 * identity and the live agents/bots verified inside its non-dead panes. Only
 * when that server process exits or is replaced by a different server are those
 * agents and bots handed to `onLost` — never when one session exits while the
 * server stays alive, and never when a running server is merely slow to answer.
 */
export function watchTmuxServer({
  socket,
  inspectServer,
  configureServer,
  snapshotSessions,
  onLossDetected,
  onLost,
  intervalMs = 10_000,
  settleMs = 500,
  exitWaitMs = 10_000,
  processAlive = processIdentityAlive,
  log = console,
}: TmuxServerWatchOptions): TmuxServerWatch {
  interface KnownServer {
    server: ProcessIdentity;
    agentIds: string[];
    botIds: string[];
    processes: ProcessIdentity[];
    configured: boolean;
  }
  let known: KnownServer | null = null;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let pendingCheck = false;
  const stopController = new AbortController();

  async function sleep(ms: number): Promise<void> {
    if (ms <= 0 || stopped) return;
    try {
      await delay(ms, undefined, { ref: false, signal: stopController.signal });
    } catch { /* aborted on stop */ }
  }

  async function waitForProcessesExit(processes: readonly ProcessIdentity[]): Promise<void> {
    if (processes.length && exitWaitMs > 0) {
      const deadline = Date.now() + exitWaitMs;
      while (!stopped && Date.now() < deadline && processes.some(processAlive)) {
        await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
      }
    }
    await sleep(settleMs);
  }

  async function observeRunning(snapshot: TmuxServerSnapshot, alreadyConfigured: boolean): Promise<void> {
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
      } catch {
        configured = false;
      }
    }
    known = { server: snapshot.server, ...observed, configured };
  }

  async function pollOnce(): Promise<void> {
    if (stopped) return;
    const snapshot = await inspectServer(socket);
    if (stopped) return;
    if (known && (!snapshot || !sameProcessIdentity(snapshot.server, known.server))) {
      // A server process that is still alive but did not answer is slow, not lost.
      if (!snapshot && processAlive(known.server)) return;
      const lostServer = known;
      known = null;
      const event: TmuxServerLossEvent = {
        server: lostServer.server,
        replacementPid: snapshot?.pid ?? null,
        agentIds: lostServer.agentIds,
        botIds: lostServer.botIds,
      };
      onLossDetected?.(event);
      await waitForProcessesExit(lostServer.processes);
      if (stopped) return;
      await onLost(event);
      if (stopped) return;
      // Immediately record the replacement server's identity and restored panes
      // so a second crash within the backoff window is caught immediately.
      const after = await inspectServer(socket);
      if (!stopped && after) await observeRunning(after, false);
      return;
    }
    if (snapshot) {
      const sameServer = !!known && sameProcessIdentity(snapshot.server, known.server);
      await observeRunning(snapshot, sameServer && known!.configured);
    }
  }

  function runTick(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (inFlight) {
      pendingCheck = true;
      return inFlight;
    }
    const run = (async () => {
      try {
        await pollOnce();
      } finally {
        inFlight = null;
        if (pendingCheck && !stopped) {
          pendingCheck = false;
          void runTick().catch(error => log.error?.(`tmux server watch ${socket}: ${errorMessage(error)}`));
        }
      }
    })();
    inFlight = run;
    return run;
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      runTick().catch(error => log.error?.(`tmux server watch ${socket}: ${errorMessage(error)}`)).finally(schedule);
    }, intervalMs);
    timer.unref?.();
  }
  schedule();

  return {
    tick: runTick,
    checkNow: () => {
      if (stopped) return;
      void runTick().catch(error => log.error?.(`tmux server watch ${socket}: ${errorMessage(error)}`));
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      stopController.abort();
    },
  };
}

/** Checked production restore/delivery policy; callers provide owners and presentation, not authority callbacks. */
export function createRecoveryRuntime({
  operations, ownership, getMode, now, log, hibernated, isPendingClose, isPrivate, suppressedAtStartup,
}: RecoveryRuntimeOptions): RecoveryRunner {
  return createRecoveryRunner({
    store: recoveryStore,
    getMode,
    now,
    log,
    hibernated,
    isPendingClose,
    isPrivate,
    suppressedAtStartup,
    routeId: recoveryRouteId,
    probeLive: operations.probeRecoveryLive,
    validateRecord: validateRecoveryRecord,
    restore: async (record, options) => {
      const model = ['pi', 'omp'].includes(record.harnessId) ? formatModelRef(record.model) || undefined : undefined;
      const result = await operations.resumeSessionById(recoveryRouteId(record), {
        model, recovery: record, expectedTmuxServer: options?.expectedTmuxServer ?? null,
      });
      const session = await operations.probeRecoveryLive(record);
      const pid = session instanceof BridgeSession ? ownership.getRegisteredSession(result.id)?.pid
        : session instanceof PrimeDaemonSession ? session.summary.workerPid
          : session?.proc?.pid;
      const identity = processIdentity(typeof pid === 'number' || typeof pid === 'string' || pid === undefined ? pid : Number(pid));
      const control = recoveryStore.getControl(record.harnessId, record.nativeSessionId);
      recoveryStore.patchControl(record.harnessId, record.nativeSessionId, {
        attempt: { ...control.attempt, launch: { bootId: recoveryStore.bootId(), uncertain: !identity, ...identity } },
      });
      return result;
    },
    continueSession: async (record, session, message) => {
      if (!Object.hasOwn(PROMPT_RECOVERY_HARNESSES, record.harnessId) || !liveSessionSupports(session, 'prompt')) {
        throw new SessionOperationError(409, 'The live harness does not support verified recovery prompts.');
      }
      if (session.turnInProgress || session.compacting) throw new SessionOperationError(409, 'The session started working or compacting before recovery delivery; no prompt was sent.');
      await session.prompt(message);
    },
  });
}
