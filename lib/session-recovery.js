const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VERSION = 1;
const ACTIVITIES = new Set(['idle', 'running', 'uncertain']);
const OBSERVATION_EVENTS = new Set([
  'agent_start', 'turn_start', 'message_end', 'turn_end', 'agent_end', 'agent_settled',
  'compaction_start', 'compaction_end', 'metadata', 'model_select', 'thinking_level_select', 'shutdown', 'retire',
]);
const MAX_RECORD_BYTES = 1024 * 1024;

function diagnostic(error) {
  try { process.stderr.write(`[pi-dish-recovery] ${error?.message || error}\n`); } catch {}
}

function bootId() {
  try {
    const id = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return /^[a-f0-9-]{36}$/i.test(id) ? id : null;
  } catch { return null; }
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function fileFor(kind, harnessId, nativeSessionId) {
  if (!validId(harnessId) || !validId(nativeSessionId)) throw new Error('Invalid recovery session identity');
  const key = crypto.createHash('sha256').update(JSON.stringify([harnessId, nativeSessionId])).digest('hex');
  return path.join(os.homedir(), '.pi', 'dish', 'recovery', kind, `${key}.json`);
}

function syncDirectory(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function privateDirectory(dir) {
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

function atomicWrite(file, value) {
  const dir = path.dirname(file);
  privateDirectory(dir);
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd;
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

function readJson(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) throw new Error('Invalid recovery record file');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function validCheckpoint(value) {
  return value && Number.isSafeInteger(value.size) && value.size >= 0
    && Number.isFinite(value.mtimeMs) && value.mtimeMs >= 0;
}

function validRecord(record) {
  return record && record.version === VERSION && validId(record.harnessId) && validId(record.nativeSessionId)
    && typeof record.sessionFile === 'string' && path.isAbsolute(record.sessionFile)
    && typeof record.cwd === 'string' && path.isAbsolute(record.cwd)
    && ['name', 'model', 'thinkingLevel'].every(key => record[key] === null || typeof record[key] === 'string')
    && ACTIVITIES.has(record.activity) && typeof record.shutdown === 'boolean'
    && (record.runId === null || validId(record.runId))
    && Number.isInteger(record.pid) && record.pid > 0
    && (record.startTime === null || typeof record.startTime === 'string')
    && validId(record.instanceId) && validId(record.observationId)
    && (record.bootId === null || typeof record.bootId === 'string')
    && typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt))
    && (record.checkpoint === null || validCheckpoint(record.checkpoint));
}

function readRecord(harnessId, nativeSessionId) {
  try {
    const record = readJson(fileFor('observations', harnessId, nativeSessionId));
    if (!validRecord(record) || record.harnessId !== harnessId || record.nativeSessionId !== nativeSessionId) {
      throw new Error('Corrupt recovery observation');
    }
    return record;
  } catch (error) {
    if (error.code !== 'ENOENT') diagnostic(error);
    return null;
  }
}

function listRecords() {
  const dir = path.join(os.homedir(), '.pi', 'dish', 'recovery', 'observations');
  const records = [];
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
  } catch (error) { if (error.code !== 'ENOENT') diagnostic(error); }
  return records;
}

function transcriptCheckpoint(sessionFile, sync = false) {
  let fd;
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
    if (error.code !== 'ENOENT') diagnostic(error);
    return null;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function sameCheckpoint(a, b) {
  return !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

function checkpointMatches(record) {
  return !!record && !!validCheckpoint(record.checkpoint)
    && typeof record.sessionFile === 'string' && path.isAbsolute(record.sessionFile)
    && sameCheckpoint(record.checkpoint, transcriptCheckpoint(record.sessionFile));
}

function recordSession(snapshot) {
  try {
    if (!snapshot || !validId(snapshot.harnessId) || !validId(snapshot.nativeSessionId)
      || typeof snapshot.sessionFile !== 'string' || !path.isAbsolute(snapshot.sessionFile)
      || typeof snapshot.cwd !== 'string' || !path.isAbsolute(snapshot.cwd)
      || !ACTIVITIES.has(snapshot.activity) || !validId(snapshot.instanceId)
      || !Number.isInteger(snapshot.pid) || snapshot.pid <= 0) return null;
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
    };
    // No fsync or timestamp churn for a repeated lifecycle observation.
    if (previous && Object.keys(record).every(key => key === 'checkpoint'
      ? (record.checkpoint === null && previous.checkpoint === null) || sameCheckpoint(record.checkpoint, previous.checkpoint)
      : record[key] === previous[key])) return previous;
    record.checkpoint = transcriptCheckpoint(snapshot.sessionFile, true);
    const result = { ...record, observationId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    atomicWrite(fileFor('observations', result.harnessId, result.nativeSessionId), result);
    return result;
  } catch (error) { diagnostic(error); return null; }
}

function readControl(harnessId, nativeSessionId) {
  try {
    const value = readJson(fileFor('controls', harnessId, nativeSessionId));
    if (!value || value.version !== VERSION || value.harnessId !== harnessId || value.nativeSessionId !== nativeSessionId
      || typeof value.excluded !== 'boolean' || typeof value.closed !== 'boolean'
      || !(value.attempt === null || (typeof value.attempt === 'object' && !Array.isArray(value.attempt)))) {
      throw new Error('Corrupt recovery control; inspect the host recovery store before changing it');
    }
    return { excluded: value.excluded, closed: value.closed, attempt: value.attempt };
  } catch (error) {
    if (error.code === 'ENOENT') return { excluded: false, closed: false, attempt: null };
    throw error;
  }
}

function getControl(harnessId, nativeSessionId) {
  try { return readControl(harnessId, nativeSessionId); } catch (error) {
    diagnostic(error);
    // Losing an exclusion/ambiguous-delivery marker must never grant recovery.
    return { excluded: true, closed: false, attempt: { status: 'needs-review', reason: 'Recovery control is corrupt or unreadable' } };
  }
}

function patchControl(harnessId, nativeSessionId, patch) {
  const current = readControl(harnessId, nativeSessionId);
  const next = { ...current };
  for (const key of ['excluded', 'closed']) {
    if (Object.hasOwn(patch, key)) {
      if (typeof patch[key] !== 'boolean') throw new Error(`Recovery ${key} must be boolean`);
      next[key] = patch[key];
    }
  }
  if (Object.hasOwn(patch, 'attempt')) {
    if (!(patch.attempt === null || (patch.attempt && typeof patch.attempt === 'object' && !Array.isArray(patch.attempt)))) {
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
function createSessionObserver({ snapshot: readSnapshot, canWrite: writeAllowed = () => true, waitsForSettled = false }) {
  let initialized = false;
  let preserved = false;
  let activity = 'idle';
  let runId = null;
  let shutdown = false;
  let timer = null;
  let runActive = false;
  let compacting = false;
  let successfulEnd = false;
  let inputCheckpoint = null;
  let awaitingInput = false;
  function snapshot() {
    try { return readSnapshot(); } catch (error) { diagnostic(error); return null; }
  }
  function canWrite() {
    try { return writeAllowed(); } catch (error) { diagnostic(error); return false; }
  }

  function persist() {
    if (preserved || !canWrite()) return null;
    const value = snapshot();
    return value && recordSession({ ...value, activity, runId, shutdown });
  }
  function later() {
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
  function initialize() {
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
  function event(type, data = {}) {
    if (!OBSERVATION_EVENTS.has(type)) return;
    initialize();
    data = data && typeof data === 'object' ? data : {};
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
      const assistant = Array.isArray(data.messages)
        ? data.messages.findLast(message => message?.role === 'assistant') : null;
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
  function dispose() {
    clearTimeout(timer);
    timer = null;
  }
  return { initialize, event, dispose };
}

module.exports = { bootId, recordSession, listRecords, readRecord, getControl, patchControl, checkpointMatches, createSessionObserver };
