const { randomUUID } = require('crypto');

const ACTIVE = new Set(['waiting', 'executing']);

// Process-local by design: stopping the server abandons waiting work, never
// serializes runtime authority for a future process to accidentally inherit.
function createSessionBounces({ catalog, capture, inspect, execute, intervalMs = 2000, maxOperations = 100, maxTargets = 200 }) {
  const operations = [];
  const reserved = new Set();
  let flight = null, timer = null, stopped = false;
  const view = operation => ({
    id: operation.id, mode: operation.mode, createdAt: operation.createdAt,
    targets: operation.targets.map(({ authority, ...target }) => ({ ...target })),
  });
  const prune = () => {
    for (let i = operations.length - 1; operations.length >= maxOperations && i >= 0; i--) {
      if (!operations[i].targets.some(t => ACTIVE.has(t.status))) operations.splice(i, 1);
    }
  };
  const settle = (target, status, reason = null) => {
    target.status = status;
    target.reason = reason;
    if (!ACTIVE.has(status)) reserved.delete(target.sessionId);
  };
  async function check(target, mode) {
    try { return await inspect(target.authority, mode); }
    catch (error) { return { eligible: true, blockers: [`Cannot establish safe live state: ${error.message}`] }; }
  }
  async function refreshWaiting() {
    for (const operation of operations) {
      for (const target of operation.targets) {
        if (target.status !== 'waiting') continue;
        const state = await check(target, operation.mode);
        if (target.status !== 'waiting' || stopped) continue;
        if (!state.eligible) settle(target, 'skipped', state.reason || 'Ownership or runtime identity no longer matches.');
        else target.reason = state.blockers?.join(' ') || null;
      }
    }
  }
  async function tick() {
    if (flight) return flight;
    if (stopped) return;
    flight = (async () => {
      for (const operation of [...operations].reverse()) {
        for (const target of operation.targets) {
          if (stopped || target.status !== 'waiting') continue;
          const state = await check(target, operation.mode);
          if (stopped || target.status !== 'waiting') continue;
          if (!state.eligible) { settle(target, 'skipped', state.reason); continue; }
          if (state.blockers?.length) { target.reason = state.blockers.join(' '); continue; }
          target.status = 'executing';
          target.reason = null;
          try {
            const result = await execute(target.authority, operation.mode, state);
            if (result?.waiting) settle(target, 'waiting', result.reason);
            else if (result?.skipped) settle(target, 'skipped', result.reason);
            else {
              if (result?.replacementId) target.replacementId = result.replacementId;
              settle(target, 'completed');
            }
          } catch (error) {
            // Never retry an action whose response may have been lost.
            settle(target, 'failed', error.message || 'The action failed; inspect the agent before trying again.');
          }
        }
      }
    })().finally(() => { flight = null; });
    return flight;
  }
  return {
    async preview(mode) {
      return Promise.all(catalog().map(async row => {
        const authority = capture(row);
        const state = authority ? await check({ authority }, mode) : { eligible: false, reason: 'No owned runtime identity can be captured.', blockers: [] };
        return { sessionId: row.id, name: row.name || row.id, harnessId: row.harnessId || 'pi', eligible: state.eligible, reason: state.reason || null, blockers: state.blockers || [] };
      }));
    },
    enqueue(mode, sessionIds) {
      if (!['reload', 'restart'].includes(mode) || !Array.isArray(sessionIds) || !sessionIds.length
          || sessionIds.length > maxTargets || sessionIds.some(id => typeof id !== 'string' || !id || id.length > 1024)) {
        throw Object.assign(new Error(`mode must be reload or restart, with 1–${maxTargets} session IDs.`), { status: 400 });
      }
      prune();
      if (operations.length >= maxOperations) throw Object.assign(new Error('Too many pending operations; cancel waiting work first.'), { status: 429 });
      const rows = new Map(catalog().map(row => [row.id, row]));
      const operation = { id: randomUUID(), mode, createdAt: new Date().toISOString(), targets: [] };
      for (const sessionId of new Set(sessionIds)) {
        const row = rows.get(sessionId);
        const target = { sessionId, name: row?.name || sessionId, harnessId: row?.harnessId || null, status: 'skipped', reason: null, authority: null };
        if (reserved.has(sessionId)) target.reason = 'Already waiting or executing in another operation.';
        else if (!row) target.reason = 'Session was not active in the target snapshot.';
        else {
          target.authority = capture(row);
          if (!target.authority) target.reason = 'No owned runtime identity can be captured.';
          else { target.status = 'waiting'; target.reason = 'Checking live safety and ownership.'; reserved.add(sessionId); }
        }
        operation.targets.push(target);
      }
      operations.unshift(operation);
      return view(operation);
    },
    async list() { await refreshWaiting(); return operations.map(view); },
    cancel(id) {
      const operation = operations.find(op => op.id === id);
      if (!operation) return null;
      for (const target of operation.targets) if (target.status === 'waiting') settle(target, 'cancelled', 'Cancelled before execution.');
      return view(operation);
    },
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
      timer.unref?.();
    },
    stop() { stopped = true; clearInterval(timer); timer = null; },
    tick,
  };
}

function lifecycleBlockers(state, live) {
  const blockers = [];
  if (!live?.alive) blockers.push('Live connection is not available.');
  const lifecycle = state?.lifecycle;
  if (!lifecycle || !['boolean'].includes(typeof lifecycle.idle)
      || typeof lifecycle.pendingMessages !== 'boolean'
      || typeof lifecycle.backgroundWork !== 'boolean'
      || !Number.isInteger(lifecycle.pendingDialogs) || lifecycle.pendingDialogs < 0
      || typeof state.turnInProgress !== 'boolean' || typeof state.compacting !== 'boolean') {
    blockers.push('Live safety state is unknown; upgrade the bridge manually and refresh.');
    return blockers;
  }
  if (!lifecycle.idle || state.turnInProgress || live.turnInProgress) blockers.push('Waiting for the current turn to finish.');
  if (state.compacting || live.compacting) blockers.push('Waiting for compaction to finish.');
  if (lifecycle.pendingMessages) blockers.push('Waiting for queued input to be delivered.');
  if (lifecycle.backgroundWork) blockers.push('Waiting for background work and pending deliveries to finish.');
  if (lifecycle.pendingDialogs || live.extUIState?.dialogs?.size) blockers.push('Waiting for input dialogs to close.');
  if (live.runningToolCalls?.size) blockers.push('Waiting for running tools to finish.');
  return blockers;
}

module.exports = { createSessionBounces, lifecycleBlockers };
