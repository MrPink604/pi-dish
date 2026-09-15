import fs = require('fs');
import os = require('os');
import path = require('path');
import crypto = require('crypto');
import { isRecord } from './wire-protocol';

export type RecoveryActivity = 'idle' | 'running' | 'uncertain';
export interface RecoveryCheckpoint {
  size: number;
  mtimeMs: number;
}

/** Persisted identities are strings, not validated route/process authority. */
export type RecoveryRecord = {
  version: 1;
  harnessId: string;
  nativeSessionId: string;
  sessionFile: string;
  cwd: string;
  name: string | null;
  model: string | null;
  thinkingLevel: string | null;
  pid: number;
  startTime: string | null;
  instanceId: string;
  activity: RecoveryActivity;
  runId: string | null;
  shutdown: boolean;
  bootId: string | null;
  checkpoint: RecoveryCheckpoint | null;
  observationId: string;
  updatedAt: string;
};

/** Only the object envelope is checked. Keep legacy fields verbatim, including
 * malformed launch/delivery markers: unknown evidence is not absent evidence.
 * Consumers must narrow these fields before using them as process or replay proof.
 */
export interface RecoveryAttempt extends Record<string, unknown> {
  id?: unknown;
  observationId?: unknown;
  status?: unknown;
  reason?: unknown;
  updatedAt?: unknown;
  delivery?: unknown;
  launch?: unknown;
}
export interface RecoveryControl {
  excluded: boolean;
  closed: boolean;
  attempt: RecoveryAttempt | null;
}
export interface RecoveryControlPatch {
  excluded?: boolean;
  closed?: boolean;
  attempt?: RecoveryAttempt | null;
}

/** Observation input is not a decoded store record. Metadata is nullable and
 * untrusted; the writer retains its existing normalization and startTime coercion.
 */
export interface RecoverySnapshot {
  harnessId: string;
  nativeSessionId: string;
  sessionFile: string;
  cwd: string;
  name?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
  pid: unknown;
  startTime?: unknown;
  instanceId: string;
}
export interface RecoveryObservation extends RecoverySnapshot {
  activity: RecoveryActivity;
  runId?: unknown;
  shutdown?: unknown;
}
export interface RecoveryObserver {
  initialize(): void;
  event(type: string, data?: unknown): void;
  dispose(): void;
}
export interface RecoveryObserverOptions {
  snapshot: () => RecoverySnapshot | null;
  canWrite?: () => boolean;
  waitsForSettled?: boolean;
}

const VERSION = 1;
const ACTIVITIES: Record<RecoveryActivity, true> = { idle: true, running: true, uncertain: true };
const OBSERVATION_EVENTS: Record<string, true> = {
  agent_start: true, turn_start: true, message_end: true, turn_end: true, agent_end: true, agent_settled: true,
  compaction_start: true, compaction_end: true, metadata: true, model_select: true, thinking_level_select: true, shutdown: true, retire: true,
};
const MAX_RECORD_BYTES = 1024 * 1024;

// Event payloads historically accept arrays as objects too. Unlike JSON store
// decoding, this is only a property-access boundary, not a feature-schema check.
function eventObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function diagnostic(error: unknown): void {
  try { process.stderr.write(`[pi-dish-recovery] ${(eventObject(error) && error.message) || error}\n`); } catch {}
}

function missingFile(error: unknown): boolean {
  return eventObject(error) && error.code === 'ENOENT';
}

export function bootId(): string | null {
  try {
    const id = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return /^[a-f0-9-]{36}$/i.test(id) ? id : null;
  } catch { return null; }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function validActivity(value: unknown): value is RecoveryActivity {
  return typeof value === 'string' && Object.hasOwn(ACTIVITIES, value);
}

function fileFor(kind: 'observations' | 'controls', harnessId: string, nativeSessionId: string): string {
  if (!validId(harnessId) || !validId(nativeSessionId)) throw new Error('Invalid recovery session identity');
  const key = crypto.createHash('sha256').update(JSON.stringify([harnessId, nativeSessionId])).digest('hex');
  return path.join(os.homedir(), '.pi', 'dish', 'recovery', kind, `${key}.json`);
}

function syncDirectory(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function privateDirectory(dir: string): void {
  const firstCreated = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  if (firstCreated) {
    // Durability includes the directory entries created on the very first
    // observation, not just the final rename into an already-existing dir.
    let current = dir;
    for (;;) {
      syncDirectory(current);
      if (current === path.dirname(firstCreated)) break;
      current = path.dirname(current);
    }
  }
}

function atomicWrite(file: string, value: object): void {
  const dir = path.dirname(file);
  privateDirectory(dir);
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
    syncDirectory(dir);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function readJson(file: string): unknown {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) throw new Error('Invalid recovery record file');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function validCheckpoint(value: unknown): value is RecoveryCheckpoint {
  return isRecord(value) && typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0
    && typeof value.mtimeMs === 'number' && Number.isFinite(value.mtimeMs) && value.mtimeMs >= 0;
}

function validRecord(record: unknown): record is RecoveryRecord {
  return isRecord(record) && record.version === VERSION && validId(record.harnessId) && validId(record.nativeSessionId)
    && typeof record.sessionFile === 'string' && path.isAbsolute(record.sessionFile)
    && typeof record.cwd === 'string' && path.isAbsolute(record.cwd)
    && ['name', 'model', 'thinkingLevel'].every(key => record[key] === null || typeof record[key] === 'string')
    && validActivity(record.activity) && typeof record.shutdown === 'boolean'
    && (record.runId === null || validId(record.runId))
    && typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0
    && (record.startTime === null || typeof record.startTime === 'string')
    && validId(record.instanceId) && validId(record.observationId)
    && (record.bootId === null || typeof record.bootId === 'string')
    && typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt))
    && (record.checkpoint === null || validCheckpoint(record.checkpoint));
}

export function readRecord(harnessId: string, nativeSessionId: string): RecoveryRecord | null {
  try {
    const record = readJson(fileFor('observations', harnessId, nativeSessionId));
    if (!validRecord(record) || record.harnessId !== harnessId || record.nativeSessionId !== nativeSessionId) {
      throw new Error('Corrupt recovery observation');
    }
    return record;
  } catch (error) {
    if (!missingFile(error)) diagnostic(error);
    return null;
  }
}

export function listRecords(): RecoveryRecord[] {
  const dir = path.join(os.homedir(), '.pi', 'dish', 'recovery', 'observations');
  const records: RecoveryRecord[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      try {
        const record = readJson(path.join(dir, entry.name));
        if (!validRecord(record) || path.basename(fileFor('observations', record.harnessId, record.nativeSessionId)) !== entry.name) {
          throw new Error('Corrupt recovery observation');
        }
        records.push(record);
      } catch (error) { diagnostic(error); }
    }
  } catch (error) { if (!missingFile(error)) diagnostic(error); }
  return records;
}

function transcriptCheckpoint(sessionFile: string, sync = false): RecoveryCheckpoint | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(sessionFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd);
    if (!before.isFile()) return null;
    if (sync) fs.fsyncSync(fd);
    const after = fs.fstatSync(fd);
    const current = fs.statSync(sessionFile);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || after.ino !== current.ino || after.dev !== current.dev
      || after.size !== current.size || after.mtimeMs !== current.mtimeMs) return null;
    if (sync) syncDirectory(path.dirname(sessionFile));
    return { size: after.size, mtimeMs: after.mtimeMs };
  } catch (error) {
    if (!missingFile(error)) diagnostic(error);
    return null;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function sameCheckpoint(a: RecoveryCheckpoint | null, b: RecoveryCheckpoint | null): boolean {
  return !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

export function checkpointMatches(record: unknown): boolean {
  return isRecord(record) && validCheckpoint(record.checkpoint)
    && typeof record.sessionFile === 'string' && path.isAbsolute(record.sessionFile)
    && sameCheckpoint(record.checkpoint, transcriptCheckpoint(record.sessionFile));
}

export function recordSession(snapshot: RecoveryObservation | null): RecoveryRecord | null {
  try {
    if (!snapshot || !validId(snapshot.harnessId) || !validId(snapshot.nativeSessionId)
      || typeof snapshot.sessionFile !== 'string' || !path.isAbsolute(snapshot.sessionFile)
      || typeof snapshot.cwd !== 'string' || !path.isAbsolute(snapshot.cwd)
      || !validActivity(snapshot.activity) || !validId(snapshot.instanceId)
      || typeof snapshot.pid !== 'number' || !Number.isInteger(snapshot.pid) || snapshot.pid <= 0) return null;
    const previous = readRecord(snapshot.harnessId, snapshot.nativeSessionId);
    const record = {
      version: VERSION, harnessId: snapshot.harnessId, nativeSessionId: snapshot.nativeSessionId,
      sessionFile: snapshot.sessionFile, cwd: snapshot.cwd,
      name: typeof snapshot.name === 'string' ? snapshot.name : null,
      model: typeof snapshot.model === 'string' ? snapshot.model : null,
      thinkingLevel: typeof snapshot.thinkingLevel === 'string' ? snapshot.thinkingLevel : null,
      pid: snapshot.pid, startTime: snapshot.startTime == null ? null : String(snapshot.startTime),
      instanceId: snapshot.instanceId, activity: snapshot.activity,
      runId: validId(snapshot.runId) ? snapshot.runId : null, shutdown: snapshot.shutdown === true,
      bootId: bootId(), checkpoint: transcriptCheckpoint(snapshot.sessionFile),
    } satisfies Omit<RecoveryRecord, 'observationId' | 'updatedAt'>;
    // No fsync or timestamp churn for a repeated lifecycle observation.
    const fields: Record<string, unknown> = record;
    const previousFields: Record<string, unknown> | null = previous;
    if (previous && Object.keys(record).every(key => key === 'checkpoint'
      ? (record.checkpoint === null && previous.checkpoint === null) || sameCheckpoint(record.checkpoint, previous.checkpoint)
      : fields[key] === previousFields?.[key])) return previous;
    record.checkpoint = transcriptCheckpoint(snapshot.sessionFile, true);
    const result: RecoveryRecord = { ...record, observationId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    atomicWrite(fileFor('observations', result.harnessId, result.nativeSessionId), result);
    return result;
  } catch (error) { diagnostic(error); return null; }
}

function readControl(harnessId: string, nativeSessionId: string): RecoveryControl {
  try {
    const value = readJson(fileFor('controls', harnessId, nativeSessionId));
    if (!isRecord(value) || value.version !== VERSION || value.harnessId !== harnessId || value.nativeSessionId !== nativeSessionId
      || typeof value.excluded !== 'boolean' || typeof value.closed !== 'boolean'
      || !(value.attempt === null || isRecord(value.attempt))) {
      throw new Error('Corrupt recovery control; inspect the host recovery store before changing it');
    }
    return { excluded: value.excluded, closed: value.closed, attempt: value.attempt };
  } catch (error) {
    if (missingFile(error)) return { excluded: false, closed: false, attempt: null };
    throw error;
  }
}

export function getControl(harnessId: string, nativeSessionId: string): RecoveryControl {
  try { return readControl(harnessId, nativeSessionId); } catch (error) {
    diagnostic(error);
    // Losing an exclusion/ambiguous-delivery marker must never grant recovery.
    return { excluded: true, closed: false, attempt: { status: 'needs-review', reason: 'Recovery control is corrupt or unreadable' } };
  }
}

export function patchControl(harnessId: string, nativeSessionId: string, patch: RecoveryControlPatch): RecoveryControl {
  const current = readControl(harnessId, nativeSessionId);
  const next = { ...current };
  for (const key of ['excluded', 'closed'] as const) {
    if (Object.hasOwn(patch, key)) {
      if (typeof patch[key] !== 'boolean') throw new Error(`Recovery ${key} must be boolean`);
      next[key] = patch[key];
    }
  }
  if (Object.hasOwn(patch, 'attempt')) {
    if (!(patch.attempt === null || isRecord(patch.attempt))) {
      throw new Error('Recovery attempt must be an object or null');
    }
    next.attempt = patch.attempt;
  }
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    atomicWrite(fileFor('controls', harnessId, nativeSessionId), { version: VERSION, harnessId, nativeSessionId, ...next });
  }
  return next;
}

/** Lifecycle observer shared by bridge owners and bridge-less RPC fallback.
 * Never writes the server-owned controls. Reload/startup is not new activity;
 * delayed checkpoints are cancelled when this observer loses its identity.
 */
export function createSessionObserver({ snapshot: readSnapshot, canWrite: writeAllowed = () => true, waitsForSettled = false }: RecoveryObserverOptions): RecoveryObserver {
  let initialized = false;
  let preserved = false;
  let activity: RecoveryActivity = 'idle';
  let runId: string | null = null;
  let shutdown = false;
  let timer: NodeJS.Timeout | null = null;
  let runActive = false;
  let compacting = false;
  let successfulEnd = false;
  let inputCheckpoint: RecoveryCheckpoint | null = null;
  let awaitingInput = false;
  function snapshot(): RecoverySnapshot | null {
    try { return readSnapshot(); } catch (error) { diagnostic(error); return null; }
  }
  function canWrite(): boolean {
    try { return writeAllowed(); } catch (error) { diagnostic(error); return false; }
  }

  function persist(): RecoveryRecord | null {
    if (preserved || !canWrite()) return null;
    const value = snapshot();
    return value && recordSession({ ...value, activity, runId, shutdown });
  }
  function later(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (awaitingInput) {
        const value = snapshot();
        const checkpoint = value && transcriptCheckpoint(value.sessionFile);
        if (checkpoint && !sameCheckpoint(checkpoint, inputCheckpoint)) {
          awaitingInput = false;
          if (runActive && !compacting) activity = 'running';
        }
      }
      persist();
    }, 0);
    timer.unref?.();
  }
  function initialize(): void {
    if (initialized) return;
    const value = snapshot();
    if (!value || !canWrite()) return;
    initialized = true;
    const previous = readRecord(value.harnessId, value.nativeSessionId);
    preserved = !!previous;
    // Reload within one exact process keeps the unfinished run identity.
    if (previous && previous.startTime && previous.bootId && previous.pid === value.pid
      && previous.startTime === value.startTime && previous.bootId === bootId()) {
      runId = previous.runId;
      runActive = !!runId && previous.activity !== 'idle';
      activity = previous.activity;
    }
    if (!previous) persist();
  }
  function event(type: string, input: unknown = {}): void {
    if (typeof type !== 'string' || !Object.hasOwn(OBSERVATION_EVENTS, type)) return;
    initialize();
    const data = eventObject(input) ? input : {};
    if (type === 'agent_start') {
      preserved = false;
      shutdown = false;
      if (!runActive) runId = crypto.randomUUID();
      runActive = true;
      successfulEnd = false;
      activity = 'uncertain';
      awaitingInput = true;
      const value = snapshot();
      inputCheckpoint = value && transcriptCheckpoint(value.sessionFile);
      persist();
    } else if (type === 'turn_start') {
      if (!runActive) {
        // A host missing agent_start cannot prove a whole-run boundary.
        preserved = false;
        shutdown = false;
        runActive = true;
        runId = crypto.randomUUID();
        activity = 'uncertain';
        persist();
      }
    } else if (type === 'message_end' || type === 'turn_end') {
      // Pi emits message_end before appending to JSONL. Never snapshot in the
      // extension callback or confuse a model/tool turn end with run end.
      if (!preserved) later();
    } else if (type === 'agent_end') {
      if (preserved) return;
      const messages: unknown[] | null = Array.isArray(data.messages) ? data.messages : null;
      let assistant: Record<string, unknown> | undefined;
      if (messages) {
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index];
          if (eventObject(message) && message.role === 'assistant') {
            assistant = message;
            break;
          }
        }
      }
      successfulEnd = assistant?.stopReason === 'stop' && !data.aborted && !data.error && !data.errorMessage;
      if (data.willRetry) {
        activity = awaitingInput ? 'uncertain' : 'running';
      } else if (waitsForSettled) {
        // Modern Pi's agent_settled follows retries, auto-compaction and the
        // continuation queue. agent_end alone is too early to claim idle.
        awaitingInput = false;
        activity = 'uncertain';
      } else {
        // Public-only hosts cannot distinguish an automatic retry from a
        // later continuation of an errored run. Keep its identity conservative.
        runActive = !successfulEnd;
        awaitingInput = false;
        activity = successfulEnd && !compacting ? 'idle' : 'uncertain';
        if (activity === 'idle') runId = null;
      }
      later();
    } else if (type === 'agent_settled') {
      if (preserved) return;
      runActive = false;
      awaitingInput = false;
      activity = successfulEnd && !compacting ? 'idle' : 'uncertain';
      if (activity === 'idle') runId = null;
      later();
    } else if (type === 'compaction_start') {
      preserved = false;
      shutdown = false;
      compacting = true;
      activity = 'uncertain';
      persist();
    } else if (type === 'compaction_end') {
      if (preserved) return;
      compacting = false;
      activity = 'uncertain';
      if (data.aborted || data.errorMessage || data.unknown) awaitingInput = false;
      if (!data.aborted && !data.errorMessage && !data.unknown) {
        activity = runActive ? (awaitingInput ? 'uncertain' : 'running') : (data.willRetry ? 'uncertain' : 'idle');
      }
      if (activity === 'idle') runId = null;
      later();
    } else if (type === 'metadata' || type === 'model_select' || type === 'thinking_level_select') {
      if (!preserved) later();
    } else if (type === 'shutdown' || type === 'retire') {
      if (timer) { clearTimeout(timer); timer = null; }
      preserved = false;
      shutdown = true;
      activity = 'uncertain'; // no native evidence that shutdown was an explicit user close
      persist();
    }
  }
  function dispose(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }
  return { initialize, event, dispose };
}
