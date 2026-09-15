import { randomUUID } from 'crypto';
import { setTimeout as delay } from 'timers/promises';
import { BridgeSession, sameRegistryClaim } from './bridge-session';
import { getHarness } from './harnesses';
import { isRecord } from './wire-protocol';
import { inspectSubsessionExits } from './session-discovery';
import { LifecycleInterruption, sameProcessIdentity } from './session-ownership';
import type { BeforeLifecycleAction, BounceAuthority, LiveSession, SessionOwnership } from './session-ownership';
import type { SessionOperations } from './session-operations';
import * as tmux from './tmux';

export type SessionBounceMode = 'reload' | 'restart';
export type SessionBounceStatus = 'waiting' | 'executing' | 'completed' | 'skipped' | 'failed' | 'cancelled';

/** Catalog observations carry presentation and conflict data, never permission to act. */
export interface SessionBounceCatalogRow {
  id: string;
  name?: unknown;
  harnessId?: unknown;
  conflicted?: unknown;
}

export interface SessionBouncePreviewTarget {
  sessionId: string;
  name: unknown;
  harnessId: unknown;
  eligible: boolean;
  reason: string | null;
  blockers: string[];
}

export interface SessionBounceTarget {
  sessionId: string;
  name: unknown;
  harnessId: unknown;
  status: SessionBounceStatus;
  reason: string | null;
  replacementId?: string;
}

export interface SessionBounceReport {
  id: string;
  mode: SessionBounceMode;
  createdAt: string;
  targets: SessionBounceTarget[];
}

/** Transient inspection context goes only to execute, never to preview or report DTOs. */
export interface SessionBounceInspection<Runtime = unknown> {
  eligible: boolean;
  reason?: string;
  blockers?: string[];
  live?: Runtime;
}

export type SessionBounceExecutionResult =
  | { waiting: true; reason?: string }
  | { skipped: true; reason?: string }
  | { replacementId?: string }
  | void;

export interface SessionBounceBounds {
  intervalMs?: number;
  maxOperations?: number;
  maxTargets?: number;
}

/** Isolated queue seam; production policy is implemented by createSessionBounceRuntime. */
export interface SessionBounceQueueOptions<Authority extends object, Runtime = unknown> extends SessionBounceBounds {
  catalog(): readonly SessionBounceCatalogRow[];
  capture(row: SessionBounceCatalogRow): Authority | null;
  inspect(authority: Authority, mode: SessionBounceMode): SessionBounceInspection<Runtime> | Promise<SessionBounceInspection<Runtime>>;
  execute(authority: Authority, mode: SessionBounceMode, inspected: SessionBounceInspection<Runtime>): SessionBounceExecutionResult | Promise<SessionBounceExecutionResult>;
}

export interface SessionBounces {
  preview(mode: SessionBounceMode): Promise<SessionBouncePreviewTarget[]>;
  enqueue(mode: unknown, sessionIds: unknown): SessionBounceReport;
  list(): Promise<SessionBounceReport[]>;
  cancel(id: string): SessionBounceReport | null;
  start(): void;
  stop(): void;
  tick(): Promise<void>;
}

export interface SessionBounceRuntimeOptions extends SessionBounceBounds {
  operations: SessionOperations;
  ownership: SessionOwnership;
  /** Raw catalog data only; capture, inspection, and execution belong to this module. */
  catalog(): unknown;
}

type CapturedBounceTarget<Authority extends object> = SessionBounceTarget & { authority: Authority };
type BounceTargetSnapshot<Authority extends object> = CapturedBounceTarget<Authority>
  | (SessionBounceTarget & { status: 'skipped'; authority: null });
interface BounceOperationSnapshot<Authority extends object> {
  id: string;
  mode: SessionBounceMode;
  createdAt: string;
  targets: BounceTargetSnapshot<Authority>[];
}

const ACTIVE: Partial<Record<SessionBounceStatus, true>> = { waiting: true, executing: true };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}

// Process-local by design: stopping the server abandons waiting work, never
// serializes runtime authority for a future process to accidentally inherit.
export function createSessionBounces<Authority extends object, Runtime = unknown>({
  catalog, capture, inspect, execute, intervalMs = 2000, maxOperations = 100, maxTargets = 200,
}: SessionBounceQueueOptions<Authority, Runtime>): SessionBounces {
  const operations: BounceOperationSnapshot<Authority>[] = [];
  const reserved = new Set<string>();
  let flight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const view = (operation: BounceOperationSnapshot<Authority>): SessionBounceReport => ({
    id: operation.id, mode: operation.mode, createdAt: operation.createdAt,
    targets: operation.targets.map(({ authority, ...target }) => target),
  });
  const prune = () => {
    for (let i = operations.length - 1; operations.length >= maxOperations && i >= 0; i--) {
      if (!operations[i].targets.some(t => ACTIVE[t.status])) operations.splice(i, 1);
    }
  };
  const settle = (target: SessionBounceTarget, status: SessionBounceStatus, reason: string | null = null) => {
    target.status = status;
    target.reason = reason;
    if (!ACTIVE[status]) reserved.delete(target.sessionId);
  };
  async function check(target: { authority: Authority }, mode: SessionBounceMode): Promise<SessionBounceInspection<Runtime>> {
    try { return await inspect(target.authority, mode); }
    catch (error) { return { eligible: true, blockers: [`Cannot establish safe live state: ${errorMessage(error)}`] }; }
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
  async function tick(): Promise<void> {
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
            if (result && 'waiting' in result && result.waiting) settle(target, 'waiting', result.reason);
            else if (result && 'skipped' in result && result.skipped) settle(target, 'skipped', result.reason);
            else {
              if (result && 'replacementId' in result && result.replacementId) target.replacementId = result.replacementId;
              settle(target, 'completed');
            }
          } catch (error) {
            if (error instanceof LifecycleInterruption) settle(target, error.disposition, error.message);
            // Never retry an action whose response may have been lost.
            else settle(target, 'failed', errorMessage(error) || 'The action failed; inspect the agent before trying again.');
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
      if ((mode !== 'reload' && mode !== 'restart') || !Array.isArray(sessionIds) || !sessionIds.length
          || sessionIds.length > maxTargets || !sessionIds.every((id: unknown): id is string => typeof id === 'string' && !!id && id.length <= 1024)) {
        throw Object.assign(new Error(`mode must be reload or restart, with 1–${maxTargets} session IDs.`), { status: 400 });
      }
      prune();
      if (operations.length >= maxOperations) throw Object.assign(new Error('Too many pending operations; cancel waiting work first.'), { status: 429 });
      const rows = new Map(catalog().map(row => [row.id, row]));
      const operation: BounceOperationSnapshot<Authority> = { id: randomUUID(), mode, createdAt: new Date().toISOString(), targets: [] };
      for (const sessionId of new Set(sessionIds)) {
        const row = rows.get(sessionId);
        const name = row?.name || sessionId;
        const harnessId = row?.harnessId || null;
        let reason: string | null = null;
        let authority: Authority | null = null;
        if (reserved.has(sessionId)) reason = 'Already waiting or executing in another operation.';
        else if (!row) reason = 'Session was not active in the target snapshot.';
        else {
          authority = capture(row);
          if (!authority) reason = 'No owned runtime identity can be captured.';
        }
        if (authority) {
          operation.targets.push({ sessionId, name, harnessId, status: 'waiting', reason: 'Checking live safety and ownership.', authority });
          reserved.add(sessionId);
        } else operation.targets.push({ sessionId, name, harnessId, status: 'skipped', reason, authority: null });
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
    stop() { stopped = true; clearInterval(timer); timer = undefined; },
    tick,
  };
}

export function lifecycleBlockers(state: unknown, live: LiveSession | null | undefined): string[] {
  const blockers: string[] = [];
  if (!live?.alive) blockers.push('Live connection is not available.');
  const fields = isRecord(state) ? state : null;
  const lifecycle = isRecord(fields?.lifecycle) ? fields.lifecycle : null;
  if (!lifecycle || typeof lifecycle.idle !== 'boolean'
      || typeof lifecycle.pendingMessages !== 'boolean'
      || typeof lifecycle.backgroundWork !== 'boolean'
      || typeof lifecycle.pendingDialogs !== 'number' || !Number.isInteger(lifecycle.pendingDialogs) || lifecycle.pendingDialogs < 0
      || typeof fields?.turnInProgress !== 'boolean' || typeof fields.compacting !== 'boolean') {
    blockers.push('Live safety state is unknown; upgrade the bridge manually and refresh.');
    return blockers;
  }
  if (!lifecycle.idle || fields.turnInProgress || live?.turnInProgress) blockers.push('Waiting for the current turn to finish.');
  if (fields.compacting || live?.compacting) blockers.push('Waiting for compaction to finish.');
  if (lifecycle.pendingMessages) blockers.push('Waiting for queued input to be delivered.');
  if (lifecycle.backgroundWork) blockers.push('Waiting for background work and pending deliveries to finish.');
  if (lifecycle.pendingDialogs || live?.extUIState?.dialogs?.size) blockers.push('Waiting for input dialogs to close.');
  if (live?.runningToolCalls?.size) blockers.push('Waiting for running tools to finish.');
  return blockers;
}

function trackBounceActivity(live: LiveSession): void {
  if (live.bounceActivityRevision !== undefined) return;
  live.bounceActivityRevision = 0;
  const events = ['turn_start', 'compaction_start', 'queue_update', 'extension_ui_request', 'session_switch', 'message_start'];
  const changed = () => { live.bounceActivityRevision = Number(live.bounceActivityRevision) + 1; };
  // Bridge's generic EventEmitter overload and RPC's listener API require narrowing.
  if (live instanceof BridgeSession) {
    for (const event of events) live.on(event, changed);
  } else {
    for (const event of events) live.on(event, changed);
  }
}

async function readBounceState(live: LiveSession): Promise<unknown> {
  const state = await live.send('get_state', {}, { timeout: 5000 });
  if (live instanceof BridgeSession) return state;
  // RPC's public state contract uses different names. It is a server-owned
  // child observed from birth, so dialogs and tools cannot predate connection.
  const fields = isRecord(state) ? state : null;
  const pendingMessageCount = fields?.pendingMessageCount;
  return {
    turnInProgress: fields?.isStreaming,
    compacting: fields?.isCompacting,
    lifecycle: {
      idle: typeof fields?.isStreaming === 'boolean' ? !fields.isStreaming : null,
      pendingMessages: typeof pendingMessageCount === 'number' && Number.isInteger(pendingMessageCount) && pendingMessageCount >= 0 ? pendingMessageCount > 0 : null,
      pendingDialogs: live.extUIState?.dialogs?.size ?? 0,
      backgroundWork: false,
    },
  };
}

function bounceDescendantBlockers(authority: BounceAuthority): string[] {
  if (!getHarness(authority.harnessId)?.nestedSubsessions) return [];
  return inspectSubsessionExits(authority.sessionFile, { harnessId: authority.harnessId }).blockers;
}

/** Checked production policy composes the same process-local queue used in isolation. */
export function createSessionBounceRuntime({ operations, ownership, catalog, ...bounds }: SessionBounceRuntimeOptions): SessionBounces {
  async function inspectBounce(authority: BounceAuthority, mode: SessionBounceMode): Promise<SessionBounceInspection<LiveSession>> {
    const failure = ownership.bounceIdentityFailure(authority);
    if (failure) return { eligible: false, reason: failure, blockers: [] };
    if (mode === 'reload' && authority.harnessId !== 'pi') {
      return { eligible: false, reason: 'Safe bulk reload is unavailable for this harness. Use Restart for OMP bridge/runtime upgrades; bulk reload never types into a draft.', blockers: [] };
    }
    let live: LiveSession | null;
    try { live = await ownership.getLiveSession(authority.sessionId); } catch (error) {
      return { eligible: true, blockers: [`Cannot connect to the original live agent: ${errorMessage(error)}`] };
    }
    if (!live?.alive) return { eligible: true, blockers: ['Waiting for a connected live agent.'] };
    if (mode === 'reload' && (!(live instanceof BridgeSession) || live.capabilities?.guardedReload !== true)) {
      return { eligible: false, reason: 'This runtime lacks safe guarded reload. Upgrade the bridge manually or choose Restart.', blockers: [] };
    }
    if (!authority.rpc) {
      const pane = await tmux.paneProcessIdentity(authority.spawn.socket, authority.spawn.paneId);
      if (!sameProcessIdentity(pane, authority.spawn.paneProcess)) {
        return { eligible: false, reason: 'The owned pane exited or was replaced.', blockers: [] };
      }
    }
    trackBounceActivity(live);
    const revision = live.bounceActivityRevision;
    let state: unknown;
    try { state = await readBounceState(live); } catch (error) {
      return { eligible: true, blockers: [`Cannot read live safety state; upgrade an older bridge manually: ${errorMessage(error)}`] };
    }
    const changed = ownership.bounceIdentityFailure(authority);
    if (changed) return { eligible: false, reason: changed, blockers: [] };
    if (live instanceof BridgeSession && !(isRecord(state) && state.lifecycle)) {
      return { eligible: false, reason: 'This bridge predates live safety reporting. Upgrade or restart it manually before using bulk operations.', blockers: [] };
    }
    const blockers = lifecycleBlockers(state, live);
    if (revision !== live.bounceActivityRevision) blockers.push('New activity arrived during the safety check.');
    blockers.push(...bounceDescendantBlockers(authority));
    return { eligible: true, blockers, live };
  }

  async function executeBounce(authority: BounceAuthority, mode: SessionBounceMode, inspected: SessionBounceInspection<LiveSession>): Promise<SessionBounceExecutionResult> {
    const live = inspected.live;
    // Only a successful, unblocked inspection reaches execute; absence is an internal failure, not retry admission.
    if (!live) throw new Error('The inspected live agent is unavailable.');
    operations.beginBounceAction(authority.sessionId, live);
    const beforeAction: BeforeLifecycleAction = async () => {
      const revision = live.bounceActivityRevision;
      let state: unknown;
      try { state = await readBounceState(live); } catch (error) {
        throw new LifecycleInterruption('waiting', `Cannot recheck live safety before execution: ${errorMessage(error)}`);
      }
      // Returned guard runs synchronously at the signal/respawn boundary,
      // after the caller's last async ownership check, with no further await.
      return () => {
        const failure = ownership.bounceIdentityFailure(authority);
        if (failure) throw new LifecycleInterruption('skipped', failure);
        const blockers = lifecycleBlockers(state, live);
        if (revision !== live.bounceActivityRevision) blockers.push('New activity arrived before execution.');
        blockers.push(...bounceDescendantBlockers(authority));
        if (blockers.length) throw new LifecycleInterruption('waiting', blockers.join(' '));
      };
    };
    try {
      if (mode === 'restart') {
        const result = await operations.restartSession(authority.sessionId, { beforeAction });
        if (result.kind === 'stopped') return { replacementId: result.replacement?.id };
        // Only replacement-not-ready carried body.stopped in the former wire response.
        // Preserve terminal skip/fail semantics without mistaking either for a retry.
        if (result.kind !== 'replacement-not-ready' && [404, 409].includes(result.status)) {
          throw new LifecycleInterruption('skipped', result.error);
        }
        throw new Error(result.error);
      }
      const finalCheck = await beforeAction();
      finalCheck();
      try { await live.send('guarded_reload', {}, { timeout: 10000 }); } catch (error) {
        if (error instanceof LifecycleInterruption) throw error;
        if (/no longer safely idle/i.test(errorMessage(error))) throw new LifecycleInterruption('waiting', errorMessage(error));
        if (!/socket closed/i.test(errorMessage(error))) throw error;
      }
      // Dispatch is not completion. A fresh connected bridge instance proves
      // reload really finished; never retry an ambiguous timeout.
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const reg = ownership.refreshRegisteredSession(authority.sessionId);
        if (reg && !sameRegistryClaim(reg, authority.reg)
            && sameProcessIdentity(reg, authority.reg)
            && reg.sessionFile === authority.sessionFile) {
          const replacement = await ownership.getLiveSession(authority.sessionId);
          if (replacement?.alive && replacement instanceof BridgeSession
              && sameRegistryClaim(replacement.registryClaim, reg)) return {};
        }
        await delay(100);
      }
      throw new Error('Reload was dispatched, but a replacement bridge was not confirmed. Inspect the session before retrying.');
    } finally {
      operations.endBounceAction(authority.sessionId, live);
    }
  }

  return createSessionBounces<BounceAuthority, LiveSession>({
    ...bounds,
    catalog: () => {
      const rows = catalog();
      if (!Array.isArray(rows) || !rows.every((row: unknown): row is SessionBounceCatalogRow => isRecord(row) && typeof row.id === 'string')) {
        throw new TypeError('Active session observations must contain session identities');
      }
      return rows;
    },
    capture: row => ownership.captureBounceAuthority(row),
    inspect: inspectBounce,
    execute: executeBounce,
  });
}
