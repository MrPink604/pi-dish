import fs = require('fs');
import readline = require('readline');
import crypto = require('crypto');
import { BridgeSession } from './bridge-session';
import { formatModelRef } from './helper-models';
import { processIdentity } from './process-identity';
import { SessionOperationError } from './session-operations';
import type { ResumeSessionResult, SessionOperations } from './session-operations';
import { liveSessionSupports, recoveryRouteId, validateRecoveryRecord } from './session-ownership';
import type { LiveSession, SessionOwnership } from './session-ownership';
import * as recoveryStore from './session-recovery';
import type { RecoveryAttempt, RecoveryRecord } from './session-recovery';

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

export interface RecoveryRunner {
  start(): Promise<void>;
  retry(id: string): Promise<RecoveryOutcome>;
  report(): RecoveryReport;
  outcome(id: unknown): RecoveryOutcome | null;
  stop(): void;
}

export type RecoveryRunnerStore = Pick<typeof recoveryStore,
  'listRecords' | 'readRecord' | 'getControl' | 'patchControl' | 'checkpointMatches'>;

export interface RecoveryPresentationOptions {
  getMode(): unknown;
  now?: () => number;
  log?: { error?: (message: string) => void };
}

/** Isolated runner seams; production policy is composed by createRecoveryRuntime below. */
export interface RecoveryRunnerOptions extends RecoveryPresentationOptions {
  store: RecoveryRunnerStore;
  routeId: typeof recoveryRouteId;
  probeLive: SessionOperations['probeRecoveryLive'];
  validateRecord: typeof validateRecoveryRecord;
  restore(record: RecoveryRecord): Promise<ResumeSessionResult>;
  continueSession(record: RecoveryRecord, session: LiveSession, message: string): Promise<void>;
}

export interface RecoveryRuntimeOptions extends RecoveryPresentationOptions {
  operations: SessionOperations;
  ownership: SessionOwnership;
}

type RememberedOutcome = RecoveryOutcome & { readonly observationId?: string };

const MAX_SESSIONS = 5000;
export const RECOVERY_PROMPT = 'pi-dish recovery: this session was interrupted while work was in progress. Before continuing, inspect the transcript, working files, and any external state affected by prior tools. A tool or external action may have completed without its result being recorded. Do not blindly repeat commands, writes, deployments, purchases, or other side effects. Reconcile what actually happened, explain any uncertainty, and ask for confirmation where safe continuation cannot be established. Continue the existing task only after this inspection; this message is not an instruction to replay the last prompt or retry a tool.';

export function recoveryMode(value: unknown): RecoveryMode {
  return value === 'off' || value === 'restore' || value === 'continue' ? value : 'off';
}

/** Property access only, not a JSON schema: arrays and primitive boxing retain their old behavior. */
function property(value: unknown, key: string): unknown {
  if (value === null || value === undefined) throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`);
  return Reflect.get(Object(value), key);
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
  let count = 0, lastMessage: unknown = null, lastType: unknown = null;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (++count > 200000 || line.length > 4 * 1024 * 1024) return 'The transcript exceeds the safe continuation inspection limit.';
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { return 'The transcript contains an incomplete or corrupt entry.'; }
      lastType = property(entry, 'type');
      if (lastType !== 'message') continue;
      const message = property(entry, 'message');
      if (!message || typeof property(message, 'role') !== 'string') return 'The transcript contains an unverifiable message.';
      lastMessage = message;
      if (property(message, 'role') === 'assistant') {
        const content = property(message, 'content');
        const blocks: readonly unknown[] = Array.isArray(content) ? content : [];
        for (const block of blocks) {
          if (property(block, 'type') !== 'toolCall' && property(block, 'type') !== 'tool_use') continue;
          const id = property(block, 'id');
          if (typeof id !== 'string') return 'A tool call has no verifiable identity.';
          pending.add(id);
          if (pending.size > 10000) return 'Too many unresolved tool calls to verify safely.';
        }
      } else if (property(message, 'role') === 'toolResult') {
        const toolCallId = property(message, 'toolCallId');
        if (typeof toolCallId !== 'string') return 'A tool result has no verifiable identity.';
        pending.delete(toolCallId);
      }
    }
  } catch { return 'The transcript cannot be inspected safely.'; }
  finally { lines.close(); input.destroy(); }
  if (pending.size) return 'Tool calls have no recorded result; inspect their external effects before continuing.';
  if (lastType === 'compaction' || lastType === 'branch_summary') return 'The transcript ends during compaction or branch navigation.';
  if (!lastMessage) return 'There is no interrupted conversation to continue.';
  if (property(lastMessage, 'role') === 'assistant') {
    const stopReason = property(lastMessage, 'stopReason');
    if (stopReason === 'aborted' || stopReason === 'error') return 'The last assistant response was aborted or failed.';
    if (stopReason !== 'toolUse') return 'The last assistant response may already have completed.';
  }
  return null;
}

export function createRecoveryRunner(deps: RecoveryRunnerOptions): RecoveryRunner {
  const { store, getMode, routeId, probeLive, validateRecord, restore, continueSession,
    now = () => Date.now(), log = console } = deps;
  const reports = new Map<string, RememberedOutcome>();
  const reportLookup: ReadonlyMap<unknown, RememberedOutcome> = reports;
  const flights = new Map<string, Promise<RecoveryOutcome>>();
  let startPromise: Promise<void> | null = null;
  let stopped = false;

  function remember(record: RecoveryRecord, status: RecoveryStatus, reason: unknown): RecoveryOutcome {
    const id = routeId(record);
    const row: RememberedOutcome = { id, harnessId: record.harnessId, name: record.name || null,
      cwd: record.cwd || null, excluded: !!store.getControl(record.harnessId, record.nativeSessionId).excluded,
      status, reason: reason || null, updatedAt: now() };
    Object.defineProperty(row, 'observationId', {
      value: store.readRecord(record.harnessId, record.nativeSessionId)?.observationId || record.observationId,
    });
    if (!reports.has(id) && reports.size >= MAX_SESSIONS) {
      const oldest = reports.keys().next();
      if (!oldest.done) reports.delete(oldest.value);
    }
    reports.set(id, row);
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

  function report(): RecoveryReport {
    const rows = new Map<string, RecoveryReportSession>();
    const records = newestRecords();
    for (const record of records.slice(0, MAX_SESSIONS)) {
      const id = routeId(record);
      const control = store.getControl(record.harnessId, record.nativeSessionId);
      let row: (Omit<RecoveryReportSession, 'excluded'> & { readonly observationId?: string }) | null | undefined = reports.get(id);
      const previous = control.attempt;
      const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
      if (row && (row.status === 'pending' || row.status === 'failed' || row.status === 'needs-review')
          && row.observationId !== record.observationId && !ambiguous) row = null;
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

  async function run(record: RecoveryRecord, explicit: boolean): Promise<RecoveryOutcome> {
    const id = routeId(record);
    let control = store.getControl(record.harnessId, record.nativeSessionId);
    const previous = control.attempt;
    const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
    try {
      // Always prefer a fresh socket/process identity to a historical record.
      const live = await probeLive(record);
      if (ambiguous && !explicit) return remember(record, 'needs-review', 'An earlier recovery launch or prompt has an uncertain outcome; inspect it before retrying.');
      if (live) return remember(record, ambiguous ? 'needs-review' : 'live', ambiguous
        ? 'The session is live, but an earlier recovery prompt has uncertain delivery. It was not resent.' : 'Attached to the surviving session; no prompt was sent.');
      control = store.getControl(record.harnessId, record.nativeSessionId);
      if (control.closed) return remember(record, 'closed', 'This session was explicitly closed.');
      if (control.excluded) return remember(record, 'pending', 'Excluded from automatic recovery.');
      if (stopped || (!explicit && recoveryMode(getMode()) === 'off')) return remember(record, 'pending', 'Automatic recovery is off.');
      if (!explicit && record.shutdown) return remember(record, 'needs-review', 'The harness shut down; quit, reload, and operating-system shutdown cannot be distinguished.');
      const repeatIdleRestore = record.activity === 'idle' && previous?.status === 'restored'
        && !previous.delivery;
      if (!explicit && previous?.observationId === record.observationId && !repeatIdleRestore) {
        return remember(record, 'needs-review', previous.reason || 'This observation was already recovered; automatic retries are disabled.');
      }
      await validateRecord(record);
      const matched = store.checkpointMatches(record);
      let safety: string | null = null;
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
      if (result.alreadyActive || result.sharedResume) return save(record, 'live', 'Another caller restored this session; no recovery prompt was sent.');
      if (explicit || recoveryMode(getMode()) !== 'continue' || record.activity === 'idle') {
        return save(record, previous?.delivery === 'uncertain' ? 'needs-review' : 'restored', previous?.delivery === 'uncertain'
          ? 'Restored without resending the earlier uncertain recovery prompt.' : 'Restored without sending a prompt.');
      }
      if (safety) return save(record, 'needs-review', safety);
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
      if (!session || session.turnInProgress || session.compacting) return save(record, 'needs-review', 'The restored session is unavailable, already working, or compacting; no prompt was sent.');
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
      await continueSession(record, session, RECOVERY_PROMPT);
      return save(record, 'continued', 'Sent one visible recovery prompt to inspect state before continuing.', { delivery: 'confirmed' });
    } catch (error) {
      const attempt = store.getControl(record.harnessId, record.nativeSessionId).attempt;
      const uncertain = attempt?.delivery === 'uncertain' || attempt?.status === 'restoring';
      try { return save(record, uncertain ? 'needs-review' : 'failed', property(error, 'message')); }
      catch (persistError) {
        log.error?.(`Recovery ${id}: ${property(persistError, 'message')}`);
        return remember(record, 'failed', `Recovery state could not be persisted: ${property(persistError, 'message')}. ${property(error, 'message')}`);
      }
    }
  }

  function recover(record: RecoveryRecord, explicit = false): Promise<RecoveryOutcome> {
    const id = routeId(record);
    const existing = flights.get(id);
    if (existing) return existing;
    const flight = Promise.resolve().then(() => run(record, explicit));
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
        const control = store.getControl(record.harnessId, record.nativeSessionId);
        if (control.closed || control.excluded) continue;
        records.push(record);
        if (records.length === MAX_SESSIONS) break;
      }
    }
    startPromise = (async () => {
      for (const record of records) {
        if (stopped) break;
        await recover(record);
      }
    })();
    return startPromise;
  }

  async function retry(id: string): Promise<RecoveryOutcome> {
    const record = store.listRecords().find(candidate => routeId(candidate) === id);
    if (!record) throw new SessionOperationError(404, 'Recovery record not found');
    return recover(record, true);
  }

  return { start, retry, report, outcome: id => reportLookup.get(id) || null, stop: () => { stopped = true; } };
}

/** Checked production restore/delivery policy; callers provide owners and presentation, not authority callbacks. */
export function createRecoveryRuntime({ operations, ownership, getMode, now, log }: RecoveryRuntimeOptions): RecoveryRunner {
  return createRecoveryRunner({
    store: recoveryStore,
    getMode,
    now,
    log,
    routeId: recoveryRouteId,
    probeLive: operations.probeRecoveryLive,
    validateRecord: validateRecoveryRecord,
    restore: async record => {
      const model = ['pi', 'omp'].includes(record.harnessId) ? formatModelRef(record.model) || undefined : undefined;
      const result = await operations.resumeSessionById(recoveryRouteId(record), { model, recovery: record });
      const session = await operations.probeRecoveryLive(record);
      const pid = session instanceof BridgeSession ? ownership.getRegisteredSession(result.id)?.pid : session?.proc?.pid;
      const identity = processIdentity(typeof pid === 'number' || typeof pid === 'string' || pid === undefined ? pid : Number(pid));
      const control = recoveryStore.getControl(record.harnessId, record.nativeSessionId);
      recoveryStore.patchControl(record.harnessId, record.nativeSessionId, {
        attempt: { ...control.attempt, launch: { bootId: recoveryStore.bootId(), uncertain: !identity, ...identity } },
      });
      return result;
    },
    continueSession: async (record, session, message) => {
      if (!['pi', 'omp'].includes(record.harnessId) || !liveSessionSupports(session, 'prompt')) {
        throw new SessionOperationError(409, 'The live harness does not support verified recovery prompts.');
      }
      if (session.turnInProgress || session.compacting) throw new SessionOperationError(409, 'The session started working or compacting before recovery delivery; no prompt was sent.');
      await session.prompt(message);
    },
  });
}
