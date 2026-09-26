import fs = require('fs');
import path = require('path');
import crypto = require('crypto');
import { setTimeout as delay } from 'timers/promises';
import type { ProcessIdentity } from './contracts';
import { BridgeSession, invalidateRegistryCache, listRegisteredSessions, pruneRegisteredSession } from './bridge-session';
import { getHarness } from './harnesses';
import { processIdentityAlive } from './process-identity';
import { stopPrimeWorker } from './prime-lifecycle';
import { canonicalSessionId } from './session-key';
import { sourceForIdentity } from './session-source';
import type { SessionSource } from './session-source-contracts';
import { LifecycleInterruption, OwnershipRefusal, liveSessionSupports, recoveryRouteId, registryIdentity, routeIdentity, routeSessionId, sameProcessIdentity, validateRecoveryRecord } from './session-ownership';
import type { BeforeLifecycleAction, LiveSession, SessionOwnership } from './session-ownership';
import { HEADLESS_TMUX_SERVER } from './session-launch';
import type { CleanupEvidence, HarnessLaunchTarget, ResumeUncertainty, SessionLaunch } from './session-launch';
import * as recoveryStore from './session-recovery';
import type { RecoveryControl, RecoveryRecord } from './session-recovery';
import * as tmux from './tmux';

export interface ActiveSessionObservation {
  id: string;
  harnessId: unknown;
  sessionFile?: unknown;
}

export interface SessionOperationObservations {
  ownership: SessionOwnership;
  launch: SessionLaunch;
  /** Catalog and transcript observations only; admission belongs to this owner. */
  getActiveSessions(): unknown;
  readSessionCwd(source: SessionSource): unknown;
  recordLaunchProvenance(sessionId: string, sourceSessionId: string, operationId: string): void;
}

export interface CreateSessionOptions {
  harness?: unknown;
  name?: string | null;
  model?: unknown;
  thinking?: unknown;
  cwd?: unknown;
  target?: HarnessLaunchTarget | null;
  sourceSessionId?: string | null;
}

export interface ResumeSessionOptions {
  model?: unknown;
  target?: HarnessLaunchTarget | null;
  recovery?: RecoveryRecord | null;
}

export interface ResumeSessionResult {
  success: true;
  id: string;
  alreadyActive?: true;
  sharedResume?: true;
}

export type SessionSpawnOperation =
  | { status: 'starting'; createdAt: number }
  | { status: 'ready'; createdAt: number; sessionId: string }
  | { status: 'error'; createdAt: number; error: string };

interface CloseIntentState {
  preserve: boolean;
  stopped: boolean;
}

interface OperationFailure {
  status: number;
  error: string;
  cause?: unknown;
  /** Prime close exposes this separately from its HTTP body. */
  closeIntent?: CloseIntentState;
  /** Prime restart exposes uncertain stop in its body, not close-only metadata. */
  reportStopUncertain?: true;
}

export interface NoActionOutcome extends OperationFailure { kind: 'no-action'; }
export interface StoppedOutcome {
  kind: 'stopped';
  replacement?: { id: string; placement: 'rpc' | 'tmux'; paneId?: string };
}
export interface StopUncertainOutcome extends OperationFailure { kind: 'stop-uncertain'; }
export interface CleanupFailedOutcome extends OperationFailure { kind: 'cleanup-failed'; stopped: boolean; }
export interface ReplacementNotReadyOutcome extends OperationFailure { kind: 'replacement-not-ready'; stopped: true; }
export type SessionOperationOutcome = NoActionOutcome | StoppedOutcome | StopUncertainOutcome | CleanupFailedOutcome | ReplacementNotReadyOutcome;

export interface SessionOperationBody {
  success?: true;
  error?: string;
  id?: string;
  placement?: 'rpc' | 'tmux';
  paneId?: string;
  stopped?: true;
  stopUncertain?: true;
}
export interface SessionOperationResponse {
  status: number;
  body: SessionOperationBody;
  preserveCloseIntent?: boolean;
  stopped?: boolean;
}

/** Wire compatibility is separate from whether a destructive action actually completed. */
export function sessionOperationResponse(outcome: SessionOperationOutcome): SessionOperationResponse {
  if (outcome.kind === 'stopped') {
    return { status: 200, body: { success: true, ...outcome.replacement } };
  }
  const response: SessionOperationResponse = { status: outcome.status, body: { error: outcome.error } };
  if (outcome.kind === 'replacement-not-ready') response.body.stopped = true;
  if (outcome.reportStopUncertain) {
    if (outcome.closeIntent?.preserve) response.body.stopUncertain = true;
  } else if (outcome.closeIntent) {
    response.preserveCloseIntent = outcome.closeIntent.preserve;
    response.stopped = outcome.closeIntent.stopped;
  }
  return response;
}

export class SessionOperationError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface SessionOperations {
  createSession(options: CreateSessionOptions): Promise<string>;
  startSessionSpawn(options: CreateSessionOptions): string;
  getSessionSpawn(spawnId: string): SessionSpawnOperation | undefined;
  recordSessionLaunch(sessionId: string, sourceSessionId: string, operationId?: string): string | null;
  resumeSessionById(requestedId: unknown, options?: ResumeSessionOptions): Promise<ResumeSessionResult>;
  probeRecoveryLive(record: RecoveryRecord): Promise<LiveSession | null>;
  assertNoConflictingWriter(sessionId: string, canonicalFile: string): void;
  closeSession(sessionId: unknown): Promise<SessionOperationOutcome>;
  closeSessionById(sessionId: unknown): Promise<SessionOperationResponse>;
  restartSession(sessionId: string, options?: { beforeAction?: BeforeLifecycleAction | null }): Promise<SessionOperationOutcome>;
  restartSessionById(sessionId: string, options?: { beforeAction?: BeforeLifecycleAction | null }): Promise<SessionOperationResponse>;
  hasCloseFlight(canonicalRoute: string): boolean;
  hasRestartFlight(canonicalRoute: string): boolean;
  hasResumeFlight(canonicalFile: string): boolean;
  /** Execution exclusion is intentionally not resume/close/restart admission. */
  beginBounceAction(canonicalRoute: string, live: LiveSession): void;
  endBounceAction(canonicalRoute: string, live: LiveSession): void;
  hasBounceAction(canonicalRoute: string): boolean;
  admitHttpAction(requestedId: string, method: string): SessionOperationResponse | null;
}

function objectFields(value: unknown): Record<string, unknown> | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function') ? value as Record<string, unknown> : null;
}
function errorMessage(error: unknown): string {
  const message = objectFields(error)?.message;
  return typeof message === 'string' ? message : String(error);
}
function errorStatus(error: unknown): number {
  const status = objectFields(error)?.status;
  return typeof status === 'number' && status ? status : 500;
}
function filePath(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Session file must be a string');
  return value;
}
function observedCwd(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value !== 'string') throw new TypeError('Session cwd must be a string');
  return value;
}
function observedText(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value !== 'string') throw new TypeError('Session metadata must be a string');
  return value;
}
function remainingProcesses(error: unknown): ProcessIdentity[] | null {
  const remaining = objectFields(error)?.remainingProcesses;
  if (!Array.isArray(remaining) || !remaining.every((item: unknown) => {
    const fields = objectFields(item);
    return fields && typeof fields.pid === 'number' && typeof fields.startTime === 'string';
  })) return null;
  return remaining as ProcessIdentity[];
}
function savedProcessAlive(value: unknown): boolean {
  const fields = objectFields(value);
  return !!fields && processIdentityAlive({ pid: Number(fields.pid), startTime: String(fields.startTime) });
}
function noAction(status: number, error: string, cause?: unknown): NoActionOutcome {
  return { kind: 'no-action', status, error, cause };
}

export function createSessionOperations(observations: SessionOperationObservations): SessionOperations {
  const { ownership, launch } = observations;
  const closeFlights = new Map<string, Promise<SessionOperationOutcome>>();
  const restartFlights = new Set<string>();
  // Canonical-file single-flight and quarantine outlive route aliases, but not a server process.
  const resumeFlights = new Map<string, Promise<ResumeSessionResult>>();
  const failedResumeCleanups = new Map<string, CleanupEvidence>();
  const uncertainExplicitResumes = new Map<string, ResumeUncertainty>();
  const sessionSpawnOperations = new Map<string, SessionSpawnOperation>();
  const bounceActionLocks = new Set<string>();
  const SESSION_SPAWN_RESULT_TTL_MS = 5 * 60 * 1000;

  function findSessionSource(sessionId: unknown): SessionSource | null {
    return ownership.sessionSources.resolve({ route: sessionId, exact: false, live: ownership.liveSourceObservations(sessionId) });
  }

  async function createSession({ harness = 'pi', name, model, thinking, cwd, target }: CreateSessionOptions): Promise<string> {
    const descriptor = getHarness(harness);
    if (!descriptor) throw new SessionOperationError(400, `Unknown harness: ${harness}`);
    const outcome = await launch.launchNewSession({ descriptor, name, model, thinking, cwd, target });
    if (outcome.kind !== 'ready') throw outcome.error;
    const id = outcome.id;
    // Naming happens after registration. A naming error must not imply launch never happened.
    if (name) {
      const session = await ownership.getLiveSession(id);
      if (!session || !liveSessionSupports(session, 'rename')) {
        throw new SessionOperationError(409, `${descriptor.label} does not support naming new sessions.`);
      }
      await session.setName(name);
    }
    return id;
  }

  function recordSessionLaunch(sessionId: string, sourceSessionId: string, operationId = crypto.randomUUID()): string | null {
    try {
      observations.recordLaunchProvenance(sessionId, sourceSessionId, operationId);
      return operationId;
    } catch (error) {
      console.warn(`Failed to record session launch provenance: ${errorMessage(error)}`);
      return null;
    }
  }

  function startSessionSpawn(options: CreateSessionOptions): string {
    const spawnId = crypto.randomUUID();
    const createdAt = Date.now();
    let operation: SessionSpawnOperation = { status: 'starting', createdAt };
    sessionSpawnOperations.set(spawnId, operation);
    Promise.resolve()
      .then(async () => {
        // Model/thinking discovery shells out to the harness CLI (OMP:
        // `omp models --json`, seconds cold). The HTTP handler answers 202
        // before this runs, so the browser can show the pending pane at once
        // and a bad pilot selection arrives as a spawn error it already renders.
        const descriptor = getHarness(options.harness || 'pi');
        if (!descriptor) throw new SessionOperationError(400, `Unknown harness: ${options.harness}`);
        try { await launch.validateHarnessPilotSelection(descriptor, { model: options.model, thinking: options.thinking, cwd: options.cwd }); }
        catch (error) { throw new SessionOperationError(errorStatus(error), errorMessage(error)); }
        return createSession(options);
      })
      .then(sessionId => {
        operation = { status: 'ready', createdAt, sessionId };
        sessionSpawnOperations.set(spawnId, operation);
        if (options.sourceSessionId) recordSessionLaunch(sessionId, options.sourceSessionId, spawnId);
      })
      .catch(error => {
        console.error('Failed to create session:', error);
        operation = { status: 'error', createdAt, error: errorMessage(error) };
        sessionSpawnOperations.set(spawnId, operation);
      })
      .finally(() => {
        const timer = setTimeout(() => {
          if (sessionSpawnOperations.get(spawnId) === operation) sessionSpawnOperations.delete(spawnId);
        }, SESSION_SPAWN_RESULT_TTL_MS);
        timer.unref();
      });
    return spawnId;
  }

  async function performSessionClose(sessionId: string, { beforeAction = null, keepPrimePane = false }: { beforeAction?: BeforeLifecycleAction | null; keepPrimePane?: boolean } = {}): Promise<SessionOperationOutcome> {
    const route = routeIdentity(sessionId);
    if (!route) return noAction(400, 'Invalid session ID');
    const descriptor = getHarness(route.harnessId);
    if (!descriptor || descriptor.closeMode === 'unsupported') {
      return noAction(409, `Closing ${descriptor?.label || route.harnessId} sessions is not supported; close the owning tmux client directly.`);
    }
    if (descriptor.closeMode === 'owned-pane') {
      let capture;
      try {
        capture = await ownership.captureOwnedPaneClose(routeSessionId(route.harnessId, route.nativeSessionId), descriptor);
        ownership.revalidateOwnedPaneClose(capture);
      } catch (error) {
        if (error instanceof OwnershipRefusal) return noAction(error.status, error.message, error);
        throw error;
      }
      const { sessionId: routeId, placement: spawn, registry, agentProcess } = capture;
      let stopped = false;
      try {
        await tmux.killPaneAndWait(spawn.socket, spawn.paneId, {
          timeout: Number(process.env.PI_DISH_CLOSE_TIMEOUT_MS) || 10000, knownProcesses: [agentProcess],
        });
        stopped = true;
        tmux.removeSpawn(routeId, spawn);
        pruneRegisteredSession(registry);
        return { kind: 'stopped' };
      } catch (error) {
        return { kind: 'cleanup-failed', stopped, status: 500, error: `Failed to close the owned ${descriptor.label} pane: ${errorMessage(error)}`, cause: error };
      }
    }
    if (descriptor.closeMode === 'owned-agent') {
      let capture;
      try {
        capture = ownership.capturePrimeClose(routeSessionId(route.harnessId, route.nativeSessionId), descriptor);
      } catch (error) {
        if (error instanceof OwnershipRefusal) return noAction(error.status, error.message, error);
        throw error;
      }
      const { sessionId: routeId, placement: spawn, registry } = capture;
      let stopped = false;
      try {
        await stopPrimeWorker(registry, () => ownership.preparePrimeClose(capture, keepPrimePane, beforeAction),
          { timeout: Number(process.env.PI_DISH_CLOSE_TIMEOUT_MS) || 10000 });
        stopped = true;
        if (keepPrimePane) {
          pruneRegisteredSession(registry);
          return { kind: 'stopped' };
        }
        if (await ownership.checkPrimeClosePane(capture, keepPrimePane)) {
          await tmux.killPane(spawn.socket, spawn.paneId);
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline && await tmux.paneExists(spawn.socket, spawn.paneId)) await delay(100);
          if (await tmux.paneExists(spawn.socket, spawn.paneId)) throw new Error('Prime stopped, but its client pane did not exit');
        }
        tmux.removeSpawn(routeId, spawn);
        pruneRegisteredSession(registry);
        return { kind: 'stopped' };
      } catch (error) {
        if (error instanceof LifecycleInterruption) throw error;
        const preserve = stopped || objectFields(error)?.stopRequested === true;
        const failure: OperationFailure = {
          status: preserve ? 500 : 409, error: `Failed to stop Prime: ${errorMessage(error)}`, cause: error,
          closeIntent: { preserve, stopped },
        };
        if (stopped) return { ...failure, kind: 'cleanup-failed', stopped: true };
        return preserve ? { ...failure, kind: 'stop-uncertain' } : { ...failure, kind: 'no-action' };
      }
    }
    const rpcCapture = ownership.captureRpcClose(sessionId);
    let registry = rpcCapture?.registry || ownership.getRegisteredSession(sessionId);
    let exited: () => boolean;
    if (rpcCapture) {
      const { rpc } = rpcCapture;
      if (beforeAction) {
        const finalCheck = await beforeAction();
        finalCheck();
      }
      rpc.kill();
      // An owned child can remain a zombie: the exit-driven flag, not kill(pid, 0), proves exit.
      exited = () => !rpc.alive;
    } else if (registry?.pid) {
      let proof;
      try {
        const capture = await ownership.captureLogicalClose(sessionId, registry);
        proof = ownership.revalidateLogicalClose(capture);
      } catch (error) {
        if (error instanceof OwnershipRefusal) return noAction(error.status, error.message, error);
        throw error;
      }
      registry = proof.registry;
      const identity = proof.process;
      try { process.kill(Number(registry.pid), 'SIGTERM'); }
      catch (error) {
        if (objectFields(error)?.code !== 'ESRCH') return noAction(500, `Failed to signal pi (pid ${registry.pid}): ${errorMessage(error)}`, error);
      }
      exited = () => !processIdentityAlive(identity);
    } else return noAction(404, 'Session not active');

    const timeoutMs = Number(process.env.PI_DISH_CLOSE_TIMEOUT_MS) || 10000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (exited()) {
        if (registry) pruneRegisteredSession(registry);
        else invalidateRegistryCache();
        return { kind: 'stopped' };
      }
      await delay(150);
    }
    return { kind: 'stop-uncertain', status: 500, error: `pi did not exit within ${Math.round(timeoutMs / 1000)}s — it may be stuck; check the process directly` };
  }

  async function closeSession(sessionId: unknown): Promise<SessionOperationOutcome> {
    const identity = routeIdentity(sessionId);
    if (!identity) return noAction(400, 'Invalid session ID');
    const id = routeSessionId(identity.harnessId, identity.nativeSessionId);
    if (restartFlights.has(id)) return noAction(409, 'The session is being restarted.');
    const existing = closeFlights.get(id);
    if (existing) return existing;
    const flight = Promise.resolve().then(async (): Promise<SessionOperationOutcome> => {
      let previous: RecoveryControl | undefined;
      let result: SessionOperationOutcome | undefined;
      try {
        previous = recoveryStore.getControl(identity.harnessId, identity.nativeSessionId);
        // Only explicit close retires recovery intent, durably before effects.
        recoveryStore.patchControl(identity.harnessId, identity.nativeSessionId, { closed: true });
        result = await performSessionClose(id);
        if (result.kind !== 'stopped' && !result.closeIntent?.preserve) {
          recoveryStore.patchControl(identity.harnessId, identity.nativeSessionId, { closed: previous.closed });
        }
        return result;
      } catch (error) {
        if (previous) {
          try { recoveryStore.patchControl(identity.harnessId, identity.nativeSessionId, { closed: previous.closed }); }
          catch (rollbackError) { console.error(`Recovery close-intent rollback failed: ${errorMessage(rollbackError)}`); }
        }
        if (result?.kind === 'cleanup-failed') {
          return { kind: 'cleanup-failed', stopped: result.stopped, status: 500, error: errorMessage(error), cause: error };
        }
        if (result?.kind === 'stop-uncertain') {
          return { kind: 'stop-uncertain', status: 500, error: errorMessage(error), cause: error };
        }
        return noAction(500, errorMessage(error), error);
      }
    });
    closeFlights.set(id, flight);
    try { return await flight; }
    finally { if (closeFlights.get(id) === flight) closeFlights.delete(id); }
  }

  function sessionIsActive(sessionId: string): boolean {
    return !!ownership.getRegisteredSession(sessionId) || !!ownership.getRPCSession(sessionId)?.alive;
  }
  function clearResumeQuarantines(sessionFile: string): void {
    failedResumeCleanups.delete(sessionFile);
    uncertainExplicitResumes.delete(sessionFile);
  }
  function activeSessionClearsQuarantine(sessionId: unknown): boolean {
    const registered = ownership.getRegisteredSession(sessionId);
    const rpc = ownership.getRPCSession(sessionId);
    if (!registered && !rpc?.alive) return false;
    const activeFile = registered?.sessionFile || rpc?.sessionFile || rpc?.state?.sessionFile;
    if (activeFile) {
      try { clearResumeQuarantines(fs.realpathSync(filePath(activeFile))); } catch {}
    }
    return true;
  }

  function assertNoConflictingWriter(sessionId: string, sessionFile: string): void {
    if (restartFlights.has(sessionId)) throw new SessionOperationError(409, 'The session is being restarted; refusing another writer.');
    for (const entry of listRegisteredSessions()) {
      const identity = registryIdentity(entry);
      const sameId = identity && routeSessionId(identity.harnessId, identity.nativeSessionId) === sessionId;
      let sameFile = false;
      try { sameFile = !!entry.sessionFile && fs.realpathSync(filePath(entry.sessionFile)) === sessionFile; } catch {}
      if (sameId || sameFile) throw new SessionOperationError(409, 'A live or conflicting bridge claims this transcript; refusing to start another writer.');
    }
    const identity = routeIdentity(sessionId);
    if (!identity) return;
    const boot = recoveryStore.bootId();
    const control = recoveryStore.getControl(identity.harnessId, identity.nativeSessionId);
    const savedLaunch = objectFields(control.attempt?.launch);
    if (savedLaunch && (!boot || !savedLaunch.bootId || savedLaunch.bootId === boot)
        && (savedLaunch.uncertain || savedProcessAlive(savedLaunch))) {
      throw new SessionOperationError(409, 'A previous recovery launch may still own this transcript; refusing another writer.');
    }
    const observation = recoveryStore.readRecord(identity.harnessId, identity.nativeSessionId);
    if (observation && (!boot || !observation.bootId || observation.bootId === boot)
        && processIdentityAlive({ pid: observation.pid, startTime: observation.startTime ?? undefined })) {
      throw new SessionOperationError(409, 'The observed process is still alive without a reachable bridge; refusing another writer.');
    }
  }

  async function resumeSessionById(requestedId: unknown, { model, target, recovery = null }: ResumeSessionOptions = {}): Promise<ResumeSessionResult> {
    const requestedRoute = routeIdentity(requestedId);
    if (requestedRoute && restartFlights.has(routeSessionId(requestedRoute.harnessId, requestedRoute.nativeSessionId))) {
      throw new SessionOperationError(409, 'The session is being restarted; no second writer was launched.');
    }
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
      throw new SessionOperationError(400, 'Model must be a non-empty string');
    }
    invalidateRegistryCache();
    // A successful owner lookup already requires a string route; preserve its original alias bytes.
    if (activeSessionClearsQuarantine(requestedId) && typeof requestedId === 'string') return { success: true, id: requestedId, alreadyActive: true };
    const sessionSource = recovery ? validateRecoveryRecord(recovery) : findSessionSource(requestedId);
    if (!sessionSource) throw new SessionOperationError(404, 'Session file not found');
    const descriptor = getHarness(sessionSource.harnessId);
    if (!descriptor) throw new TypeError('Unknown harness descriptor');
    if (model && descriptor.id !== 'omp' && !recovery) {
      throw new SessionOperationError(400, 'Resume model overrides are currently supported only for Oh My Pi sessions.');
    }
    let sessionFile: string;
    try { sessionFile = fs.realpathSync(sessionSource.file); }
    catch { throw new SessionOperationError(404, 'Session file not found'); }
    const sessionId = routeSessionId(sessionSource.harnessId, sessionSource.nativeSessionId);
    if (restartFlights.has(sessionId)) throw new SessionOperationError(409, 'The session is being restarted.');
    const existingFlight = resumeFlights.get(sessionFile);
    if (existingFlight) {
      const result = await existingFlight;
      invalidateRegistryCache();
      if (!sessionIsActive(result.id)) throw new SessionOperationError(500, 'The concurrent resume completed, but the session is no longer active');
      return { success: true, id: result.id, alreadyActive: true, sharedResume: true };
    }

    const flight = Promise.resolve().then(async (): Promise<ResumeSessionResult> => {
      invalidateRegistryCache();
      if (activeSessionClearsQuarantine(sessionId)) return { success: true, id: sessionId, alreadyActive: true };
      assertNoConflictingWriter(sessionId, sessionFile);
      const active = observations.getActiveSessions();
      if (!Array.isArray(active) || !active.every((row: unknown): row is ActiveSessionObservation => typeof objectFields(row)?.id === 'string')) {
        throw new TypeError('Active session observations must contain session identities');
      }
      if (ownership.liveSubsessionCandidates(active).some(candidate => candidate.routeId === sessionId)) {
        throw new SessionOperationError(409, 'This session is a subagent still loaded in its parent session; its parent owns the transcript. Close or finish the parent session before resuming it.');
      }
      const uncertainExplicit = uncertainExplicitResumes.get(sessionFile);
      if (uncertainExplicit) {
        const state = await tmux.paneProcessState(uncertainExplicit.socket, uncertainExplicit.paneId,
          { knownProcesses: uncertainExplicit.knownProcesses });
        if (!uncertainExplicit.detachedWorker && !state.paneExists && !state.knownProcesses.length) {
          if (uncertainExplicitResumes.get(sessionFile) === uncertainExplicit) uncertainExplicitResumes.delete(sessionFile);
        } else {
          uncertainExplicitResumes.set(sessionFile, { ...uncertainExplicit, knownProcesses: state.knownProcesses });
          invalidateRegistryCache();
          if (activeSessionClearsQuarantine(sessionId)) return { success: true, id: sessionId, alreadyActive: true };
          if (uncertainExplicit.detachedWorker) {
            throw new SessionOperationError(409, 'A previous Prime restart did not prove its replacement worker; inspect the Prime daemon and client pane before retrying. No second writer was launched.');
          }
          throw new SessionOperationError(409, `A previous explicit tmux resume timed out and its pane/process is still present (${uncertainExplicit.paneId}); refusing to launch another process against this session file. Inspect or close that tmux pane before retrying.`);
        }
      }
      const failedCleanup = failedResumeCleanups.get(sessionFile);
      if (failedCleanup) {
        try {
          await tmux.killPaneAndWait(failedCleanup.socket, failedCleanup.paneId, {
            knownProcesses: failedCleanup.knownProcesses, timeout: failedCleanup.timeout,
          });
          if (failedResumeCleanups.get(sessionFile) === failedCleanup) failedResumeCleanups.delete(sessionFile);
          invalidateRegistryCache();
        } catch (cleanupError) {
          const remaining = remainingProcesses(cleanupError);
          if (remaining) failedResumeCleanups.set(sessionFile, { ...failedCleanup, knownProcesses: remaining });
          throw new SessionOperationError(500, `Previous hidden tmux cleanup is still incomplete; refusing to resume another process against this session file: ${errorMessage(cleanupError)}`);
        }
      }
      let cwd = recovery ? recovery.cwd : observedCwd(observations.readSessionCwd({ ...sessionSource, file: sessionFile }));
      if (!recovery && cwd && !fs.existsSync(cwd)) {
        console.warn(`Session cwd ${cwd} doesn't exist, using HOME`);
        cwd = process.env.HOME;
      }
      const thinking = recovery && ['pi', 'omp'].includes(descriptor.id) ? recovery.thinkingLevel ?? undefined : undefined;
      await launch.validateHarnessPilotSelection(descriptor, { model, thinking, cwd });
      // Validation and quarantine cleanup may await for seconds; repeat the existing final guards.
      invalidateRegistryCache();
      if (activeSessionClearsQuarantine(sessionId)) return { success: true, id: sessionId, alreadyActive: true };
      assertNoConflictingWriter(sessionId, sessionFile);
      if (recovery) {
        validateRecoveryRecord(recovery);
        const control = recoveryStore.getControl(recovery.harnessId, recovery.nativeSessionId);
        if (control.closed || control.excluded) throw new SessionOperationError(409, 'Recovery was closed or excluded before launch.');
        recoveryStore.patchControl(recovery.harnessId, recovery.nativeSessionId, {
          attempt: { ...control.attempt, launch: { bootId: recoveryStore.bootId(), uncertain: true } },
        });
      }
      // R/L is asymmetric: close never checks this file flight, and an already-active R may return above.
      if (closeFlights.has(sessionId)) throw new SessionOperationError(409, 'The session is being closed; retry after close completes.');
      const outcome = await launch.launchResumedSession({
        descriptor, sessionFile, cwd, name: recovery?.name || observedText(objectFields(sessionSource)?.name) || null, target, model, thinking,
      });
      if (outcome.kind !== 'ready') {
        if (target?.type === 'tmux') {
          if (outcome.kind === 'explicit-uncertain' || outcome.kind === 'detached-replacement-uncertain') {
            uncertainExplicitResumes.set(sessionFile, outcome.placement);
          }
        } else if (outcome.kind === 'cleanup-incomplete') {
          failedResumeCleanups.set(sessionFile, outcome.cleanup);
        }
        throw outcome.error;
      }
      if (outcome.id !== sessionId) throw new SessionOperationError(409, 'The resumed harness registered a different session identity; inspect the running process.');
      if (!recovery) recoveryStore.patchControl(descriptor.id, sessionSource.nativeSessionId, { closed: false });
      return { success: true, id: outcome.id };
    });
    resumeFlights.set(sessionFile, flight);
    try { return await flight; }
    finally { if (resumeFlights.get(sessionFile) === flight) resumeFlights.delete(sessionFile); }
  }

  async function probeRecoveryLive(record: RecoveryRecord): Promise<LiveSession | null> {
    const id = recoveryRouteId(record);
    invalidateRegistryCache();
    const session = await ownership.getLiveSession(id);
    if (!session) {
      assertNoConflictingWriter(id, record.sessionFile);
      return null;
    }
    const file = session.sessionFile || (session instanceof BridgeSession ? undefined : session.state?.sessionFile)
      || ownership.getRegisteredSession(id)?.sessionFile;
    if (!file || fs.realpathSync(filePath(file)) !== fs.realpathSync(record.sessionFile)) {
      throw new SessionOperationError(409, 'The live session claims a different transcript; historical recovery is refused.');
    }
    if (session instanceof BridgeSession) await session.waitForHello({ timeout: 2000 });
    return session;
  }

  async function restartSession(requestedId: string, { beforeAction = null }: { beforeAction?: BeforeLifecycleAction | null } = {}): Promise<SessionOperationOutcome> {
    const route = routeIdentity(requestedId);
    if (!route) return noAction(400, 'Invalid session ID');
    const sessionId = routeSessionId(route.harnessId, route.nativeSessionId);
    const descriptor = getHarness(route.harnessId);
    if (!descriptor || descriptor.closeMode === 'unsupported') return noAction(409, `${descriptor?.label || route.harnessId} does not support agent restart.`);
    if (restartFlights.has(sessionId) || closeFlights.has(sessionId)) return noAction(409, 'The session is already being restarted or closed.');
    const activeFile = ownership.getRPCSession(sessionId)?.sessionFile || ownership.getRegisteredSession(sessionId)?.sessionFile;
    if (activeFile) {
      try {
        if (resumeFlights.has(fs.realpathSync(filePath(activeFile)))) return noAction(409, 'The session is still being resumed.');
      } catch {}
    }
    restartFlights.add(sessionId);
    try {
      const rpc = ownership.getRPCSession(sessionId);
      if (rpc?.alive) {
        const sourceFile = rpc.sessionFile || rpc.state?.sessionFile;
        let sessionFile: string;
        try { sessionFile = fs.realpathSync(filePath(sourceFile)); }
        catch { return noAction(409, 'The active RPC session has no resumable session file.'); }
        const cwd = rpc.cwd && fs.existsSync(rpc.cwd) ? rpc.cwd : process.env.HOME;
        // A restart never retires recovery intent and must retain its original backend.
        const closed = await performSessionClose(sessionId, { beforeAction });
        if (closed.kind !== 'stopped') return closed;
        try {
          const replacement = await launch.resumeRpcSession({ sessionFile, cwd });
          if (replacement.kind !== 'ready') throw replacement.error;
          return { kind: 'stopped', replacement: { id: replacement.id, placement: 'rpc' } };
        } catch (error) {
          console.error('Failed to restart RPC session:', error);
          return { kind: 'replacement-not-ready', stopped: true, status: 500, error: `The agent stopped, but its RPC replacement failed to start: ${errorMessage(error)}`, cause: error };
        }
      }

      let restartCapture;
      try { restartCapture = await ownership.capturePaneRestart(sessionId, descriptor); }
      catch (error) {
        if (error instanceof OwnershipRefusal) return noAction(error.status, error.message, error);
        throw error;
      }
      let registry = restartCapture.registry;
      const spawn = restartCapture.placement;
      let sessionSource: SessionSource | null | undefined;
      try {
        sessionSource = registry.sessionFile
          ? sourceForIdentity(route.harnessId, route.nativeSessionId, filePath(registry.sessionFile))
          : findSessionSource(sessionId);
      } catch {}
      let sessionFile: string;
      try { sessionFile = fs.realpathSync(filePath(sessionSource?.file || registry.sessionFile)); }
      catch { return noAction(409, 'The active agent has no resumable session file.'); }
      let cwd = observedCwd(observations.readSessionCwd(sourceForIdentity(route.harnessId, route.nativeSessionId, sessionFile)));
      if (!cwd || !fs.existsSync(cwd)) cwd = process.env.HOME;
      try {
        const proved = await ownership.preparePaneRestart(restartCapture);
        registry = ownership.revalidatePaneRestart(restartCapture, proved);
      } catch (error) {
        if (error instanceof OwnershipRefusal) return noAction(error.status, error.message, error);
        throw error;
      }
      let workerStopped = false;
      try {
        let beforeRespawn = beforeAction;
        if (descriptor.closeMode === 'owned-agent') {
          const stopped = await performSessionClose(sessionId, {
            keepPrimePane: true,
            beforeAction: () => ownership.preparePrimeRestartStop(restartCapture, beforeAction),
          });
          if (stopped.kind !== 'stopped') return { ...stopped, reportStopUncertain: true };
          workerStopped = true;
          beforeRespawn = () => ownership.preparePrimeReplacement(restartCapture, sessionFile);
        }
        const paneProcess = objectFields(spawn.paneProcess);
        const outcome = await launch.spawnHarnessInTmux({
          descriptor,
          target: { socket: spawn.socket },
          args: descriptor.argv.resume({ file: sessionFile, model: observedText(registry.model) || undefined }),
          cwd,
          name: observedText(registry.name) || null,
          hidden: path.resolve(spawn.socket) === path.resolve(path.join(tmux.tmuxTmpdir(), HEADLESS_TMUX_SERVER)),
          restartPane: {
            sessionId, paneId: spawn.paneId,
            paneProcess: paneProcess ? { pid: Number(paneProcess.pid), startTime: String(paneProcess.startTime) } : null,
            spawn, registry,
            beforeAction: beforeRespawn,
          },
        });
        if (outcome.kind !== 'ready') {
          if (outcome.kind === 'explicit-uncertain' || outcome.kind === 'detached-replacement-uncertain') {
            uncertainExplicitResumes.set(sessionFile, outcome.placement);
          }
          throw outcome.error;
        }
        return { kind: 'stopped', replacement: { id: outcome.id, placement: 'tmux', paneId: spawn.paneId } };
      } catch (error) {
        if (error instanceof LifecycleInterruption) throw error;
        console.error('Failed to restart tmux session:', error);
        const currentPaneProcess = await tmux.paneProcessIdentity(spawn.socket, spawn.paneId);
        const replaced = workerStopped || !sameProcessIdentity(currentPaneProcess, spawn.paneProcess);
        if (replaced) return {
          kind: 'replacement-not-ready', stopped: true, status: errorStatus(error),
          error: `The agent stopped, but its replacement failed to become ready: ${errorMessage(error)}`, cause: error,
        };
        return noAction(errorStatus(error), `The agent was not restarted: ${errorMessage(error)}`, error);
      }
    } finally { restartFlights.delete(sessionId); }
  }

  function beginBounceAction(canonicalRoute: string, live: LiveSession): void {
    bounceActionLocks.add(canonicalRoute);
    live.bounceExecuting = true;
  }
  function endBounceAction(canonicalRoute: string, live: LiveSession): void {
    bounceActionLocks.delete(canonicalRoute);
    live.bounceExecuting = false;
  }
  function admitHttpAction(requestedId: string, method: string): SessionOperationResponse | null {
    let id: string;
    try { id = canonicalSessionId(requestedId); } catch { return null; }
    if (method !== 'GET' && bounceActionLocks.has(id)) {
      return sessionOperationResponse(noAction(409, 'A safe bulk operation is executing for this session; wait for its result.'));
    }
    return null;
  }

  return {
    createSession, startSessionSpawn, getSessionSpawn: spawnId => sessionSpawnOperations.get(spawnId), recordSessionLaunch,
    resumeSessionById, probeRecoveryLive, assertNoConflictingWriter, closeSession, restartSession,
    closeSessionById: async sessionId => sessionOperationResponse(await closeSession(sessionId)),
    restartSessionById: async (sessionId, options) => sessionOperationResponse(await restartSession(sessionId, options)),
    hasCloseFlight: id => closeFlights.has(id), hasRestartFlight: id => restartFlights.has(id),
    hasResumeFlight: file => resumeFlights.has(file), beginBounceAction, endBounceAction,
    hasBounceAction: id => bounceActionLocks.has(id), admitHttpAction,
  };
}
