'use strict';

const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');

const MODES = ['off', 'restore', 'continue'];
const MAX_SESSIONS = 5000;
const RECOVERY_PROMPT = 'pi-dish recovery: this session was interrupted while work was in progress. Before continuing, inspect the transcript, working files, and any external state affected by prior tools. A tool or external action may have completed without its result being recorded. Do not blindly repeat commands, writes, deployments, purchases, or other side effects. Reconcile what actually happened, explain any uncertainty, and ask for confirmation where safe continuation cannot be established. Continue the existing task only after this inspection; this message is not an instruction to replay the last prompt or retry a tool.';

function recoveryMode(value) {
  return MODES.includes(value) ? value : 'off';
}

// Stream with explicit bounds: a corrupt/huge transcript is reviewable, not a
// reason to allocate the whole corpus or guess whether a tool finished.
async function continuationSafety(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return 'The transcript cannot be read.'; }
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return 'The transcript exceeds the safe continuation inspection limit.';
  const input = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 16 * 1024 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  let count = 0, lastMessage = null, lastType = null;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (++count > 200000 || line.length > 4 * 1024 * 1024) return 'The transcript exceeds the safe continuation inspection limit.';
      let entry;
      try { entry = JSON.parse(line); } catch { return 'The transcript contains an incomplete or corrupt entry.'; }
      lastType = entry.type;
      if (entry.type !== 'message') continue;
      const message = entry.message;
      if (!message || typeof message.role !== 'string') return 'The transcript contains an unverifiable message.';
      lastMessage = message;
      if (message.role === 'assistant') {
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (block.type !== 'toolCall' && block.type !== 'tool_use') continue;
          if (typeof block.id !== 'string') return 'A tool call has no verifiable identity.';
          pending.add(block.id);
          if (pending.size > 10000) return 'Too many unresolved tool calls to verify safely.';
        }
      } else if (message.role === 'toolResult') {
        if (typeof message.toolCallId !== 'string') return 'A tool result has no verifiable identity.';
        pending.delete(message.toolCallId);
      }
    }
  } catch { return 'The transcript cannot be inspected safely.'; }
  finally { lines.close(); input.destroy(); }
  if (pending.size) return 'Tool calls have no recorded result; inspect their external effects before continuing.';
  if (lastType === 'compaction' || lastType === 'branch_summary') return 'The transcript ends during compaction or branch navigation.';
  if (!lastMessage) return 'There is no interrupted conversation to continue.';
  if (lastMessage.role === 'assistant') {
    if (['aborted', 'error'].includes(lastMessage.stopReason)) return 'The last assistant response was aborted or failed.';
    if (lastMessage.stopReason !== 'toolUse') return 'The last assistant response may already have completed.';
  }
  return null;
}

function createRecoveryRunner(deps) {
  const { store, getMode, routeId, probeLive, validateRecord, restore, continueSession,
    now = () => Date.now(), log = console } = deps;
  const reports = new Map();
  const flights = new Map();
  let startPromise = null;
  let stopped = false;

  function remember(record, status, reason) {
    const id = routeId(record);
    const row = { id, harnessId: record.harnessId, name: record.name || null,
      cwd: record.cwd || null, excluded: !!store.getControl(record.harnessId, record.nativeSessionId).excluded,
      status, reason: reason || null, updatedAt: now() };
    Object.defineProperty(row, 'observationId', {
      value: store.readRecord(record.harnessId, record.nativeSessionId)?.observationId || record.observationId,
    });
    if (!reports.has(id) && reports.size >= MAX_SESSIONS) reports.delete(reports.keys().next().value);
    reports.set(id, row);
    return row;
  }

  function save(record, status, reason, extra = {}) {
    const control = store.getControl(record.harnessId, record.nativeSessionId);
    const attempt = { ...control.attempt, ...extra, observationId: record.observationId,
      status, reason: reason || null, updatedAt: now() };
    store.patchControl(record.harnessId, record.nativeSessionId, { attempt });
    return remember(record, status, reason);
  }

  function newestRecords() {
    return store.listRecords().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  function report() {
    const rows = new Map();
    const records = newestRecords();
    for (const record of records.slice(0, MAX_SESSIONS)) {
      const id = routeId(record);
      const control = store.getControl(record.harnessId, record.nativeSessionId);
      let row = reports.get(id);
      const previous = control.attempt;
      const ambiguous = previous?.delivery === 'uncertain' || previous?.status === 'restoring';
      if (row && ['pending', 'failed', 'needs-review'].includes(row.status)
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

  async function run(record, explicit) {
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
      let safety = null;
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
      try { return save(record, uncertain ? 'needs-review' : 'failed', error.message); }
      catch (persistError) {
        log.error?.(`Recovery ${id}: ${persistError.message}`);
        return remember(record, 'failed', `Recovery state could not be persisted: ${persistError.message}. ${error.message}`);
      }
    }
  }

  function recover(record, explicit = false) {
    const id = routeId(record);
    if (flights.has(id)) return flights.get(id);
    const flight = Promise.resolve().then(() => run(record, explicit));
    flights.set(id, flight);
    flight.finally(() => { if (flights.get(id) === flight) flights.delete(id); }).catch(() => {});
    return flight;
  }

  function start() {
    if (startPromise) return startPromise;
    // Capture once, before any await or recovered harness can overwrite it.
    const records = [];
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

  async function retry(id) {
    const record = store.listRecords().find(candidate => routeId(candidate) === id);
    if (!record) { const error = new Error('Recovery record not found'); error.status = 404; throw error; }
    return recover(record, true);
  }

  return { start, retry, report, outcome: id => reports.get(id) || null, stop: () => { stopped = true; } };
}

module.exports = { createRecoveryRunner, recoveryMode, continuationSafety, RECOVERY_PROMPT };
