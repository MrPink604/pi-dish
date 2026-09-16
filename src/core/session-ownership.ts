import fs = require('fs');
import path = require('path');
import type { BridgeCapability, BridgeRegistryEntry, HarnessDescriptor, HarnessId, NativeSessionId, ProcessIdentity, ProcessIdentityInput, SessionIdentity } from './contracts';
import { BridgeSession, getBridgeSession as getBridgeSessionForClaim, getRegisteredSessionByNativeId, invalidateRegistryCache, listRegisteredSessions, pruneRegisteredSession, pruneUnreachableRegisteredSession, sameRegistryClaim } from './bridge-session';
import { getRPCSession as getRawRPCSession, RPCSession } from './rpc-session';
import { bridgeSupports } from './session-capabilities';
import { getHarness } from './harnesses';
import { inspectProcessAncestry, processIdentity, processIdentityAlive } from './process-identity';
import { primeWorkerTarget } from './prime-lifecycle';
import { encodeSessionKey, resolveSessionRoute, validSessionId, VERSION } from './session-key';
import { createSessionSourceResolver } from './session-source';
import { discoverSubsessionCandidates, findSessionCandidate, readSessionHeader } from './session-discovery';
import type { DiscoveryCandidate, LiveSourceObservation, SessionSource, SessionSourceResolver } from './session-source-contracts';
import { record } from './helper-values';
import * as tmux from './tmux';
import * as recoveryStore from './session-recovery';
import type { RecoveryRecord } from './session-recovery';

export type LiveSession = InstanceType<typeof BridgeSession> | InstanceType<typeof RPCSession>;

export interface OwnershipObservations {
  /** Presentation listeners only; the selected transport cannot be replaced. */
  onLive(session: LiveSession): void;
  onRetired(route: string): void;
  readSessionTailEntry(source: SessionSource): unknown;
}

export interface RuntimeDescription {
  kind: 'rpc' | 'tmux' | 'terminal';
  pid: unknown;
  server?: string;
  tmuxSession?: string | null;
  windowIndex?: number | null;
  windowName?: string | null;
}

/** Captures retain observations, not permission to act after an arbitrary await. */
export interface RpcCloseCapture {
  readonly kind: 'rpc';
  readonly rpc: InstanceType<typeof RPCSession>;
  readonly registry: BridgeRegistryEntry | null;
}
export interface OwnedPaneCloseCapture {
  readonly kind: 'owned-pane';
  readonly sessionId: string;
  readonly descriptor: HarnessDescriptor;
  readonly registry: BridgeRegistryEntry;
  readonly placement: tmux.SpawnPlacement;
  readonly agentProcess: ProcessIdentity;
}
export interface PrimeCloseCapture {
  readonly kind: 'owned-agent';
  readonly sessionId: string;
  readonly registry: BridgeRegistryEntry;
  readonly placement: tmux.SpawnPlacement;
}
export interface LogicalCloseCapture {
  readonly kind: 'logical';
  readonly sessionId: string;
  readonly registry: BridgeRegistryEntry;
  readonly hasBirthMarker: boolean;
  readonly legacyProcess: ProcessIdentity | null;
  readonly legacyBridge: InstanceType<typeof BridgeSession> | null;
}
export interface LogicalCloseProof {
  readonly registry: BridgeRegistryEntry;
  readonly process: ProcessIdentity;
}
export interface PaneRestartCapture {
  readonly kind: 'pane-restart';
  readonly sessionId: string;
  readonly descriptor: HarnessDescriptor;
  readonly registry: BridgeRegistryEntry;
  readonly placement: tmux.SpawnPlacement;
}
interface BounceIdentity {
  readonly sessionId: string;
  readonly harnessId: HarnessId;
  readonly sessionFile: unknown;
}
export interface RpcBounceAuthority extends BounceIdentity {
  readonly rpc: InstanceType<typeof RPCSession>;
  readonly reg: BridgeRegistryEntry | null;
  readonly spawn: tmux.SpawnPlacement | null;
}
export interface PaneBounceAuthority extends BounceIdentity {
  readonly rpc: null;
  readonly reg: BridgeRegistryEntry;
  readonly spawn: tmux.SpawnPlacement;
}
export type BounceAuthority = RpcBounceAuthority | PaneBounceAuthority;
export type BeforeLifecycleAction = () => (() => undefined) | Promise<() => undefined>;

export class OwnershipRefusal extends Error {
  constructor(message: string, readonly status: 404 | 409 = 409) { super(message); }
}

/** Waiting/skipped actions preserve the exact interruption through launch/stop layers. */
export class LifecycleInterruption extends Error {
  constructor(readonly disposition: 'waiting' | 'skipped', message: string) { super(message); }
}

export interface SessionOwnership {
  readonly sessionSources: SessionSourceResolver;
  getRegisteredSession(sessionId: unknown): BridgeRegistryEntry | null;
  refreshRegisteredSession(sessionId: unknown): BridgeRegistryEntry | null;
  getRPCSession(sessionId: unknown): InstanceType<typeof RPCSession> | null | undefined;
  getBridgeSession(sessionId: string): Promise<InstanceType<typeof BridgeSession>>;
  liveSourceObservations(sessionId: unknown): LiveSourceObservation[];
  resolveSessionCandidate(sessionId: string, options?: { discover?: boolean }): SessionSource | null;
  liveSessionHistoryPending(sessionId: string): boolean;
  getLiveSession(sessionId: unknown): Promise<LiveSession | null>;
  adoptBridgeSessionSwitch(session: LiveSession, data: unknown): void;
  describeRuntime(sessionId: string): Promise<RuntimeDescription | null>;
  locatePiPane(sessionId: string): Promise<tmux.PaneTarget | null>;
  liveSubsessionCandidates(active: readonly { id: string; harnessId: unknown; sessionFile?: unknown }[]): DiscoveryCandidate[];
  captureRpcClose(sessionId: string): RpcCloseCapture | null;
  captureOwnedPaneClose(sessionId: string, descriptor: HarnessDescriptor): Promise<OwnedPaneCloseCapture>;
  revalidateOwnedPaneClose(capture: OwnedPaneCloseCapture): void;
  capturePrimeClose(sessionId: string, descriptor: HarnessDescriptor): PrimeCloseCapture;
  checkPrimeClosePane(capture: PrimeCloseCapture, keepPane: boolean): Promise<boolean>;
  preparePrimeClose(capture: PrimeCloseCapture, keepPane: boolean, beforeAction: BeforeLifecycleAction | null): Promise<void>;
  captureLogicalClose(sessionId: string, registry: BridgeRegistryEntry): Promise<LogicalCloseCapture>;
  revalidateLogicalClose(capture: LogicalCloseCapture): LogicalCloseProof;
  capturePaneRestart(sessionId: string, descriptor: HarnessDescriptor): Promise<PaneRestartCapture>;
  preparePaneRestart(capture: PaneRestartCapture): Promise<BridgeRegistryEntry>;
  revalidatePaneRestart(capture: PaneRestartCapture, proved: BridgeRegistryEntry): BridgeRegistryEntry;
  preparePrimeRestartStop(capture: PaneRestartCapture, beforeAction: BeforeLifecycleAction | null): Promise<() => undefined>;
  preparePrimeReplacement(capture: PaneRestartCapture, sessionFile: string): Promise<() => undefined>;
  captureBounceAuthority(row: { id: string; harnessId?: unknown; conflicted?: unknown }): BounceAuthority | null;
  bounceIdentityFailure(authority: BounceAuthority): string | null;
}

export function routeIdentity(value: unknown): (SessionIdentity & { encoded: boolean }) | null {
  try {
    return { ...resolveSessionRoute(value), encoded: typeof value === 'string' && value.startsWith(VERSION) };
  } catch { return null; }
}

export function routeSessionId(harnessId: HarnessId, nativeSessionId: NativeSessionId): string {
  return harnessId === 'pi' ? nativeSessionId : encodeSessionKey(harnessId, nativeSessionId);
}

export function registryIdentity(input: unknown): SessionIdentity | null {
  if (!record(input)) return null;
  const wrapper = record(input.wrapper) ? input.wrapper : null;
  const descriptor = getHarness(wrapper?.harnessId || input.harnessId || 'pi');
  const nativeSessionId = input.nativeSessionId || input.sessionId;
  return descriptor && validSessionId(nativeSessionId) ? { harnessId: descriptor.id, nativeSessionId } : null;
}

function observedPid(pid: unknown): number | string | null | undefined {
  return pid == null || typeof pid === 'number' || typeof pid === 'string' ? pid : Number(pid);
}

/** Preserve the process module's Number/String coercions without copying normal observations. */
function processEvidence(value: unknown): ProcessIdentityInput | null {
  if (!record(value)) return null;
  if ((value.pid === undefined || typeof value.pid === 'number' || typeof value.pid === 'string')
      && (value.startTime === undefined || typeof value.startTime === 'number' || typeof value.startTime === 'string')) return value;
  return { pid: Number(value.pid), startTime: String(value.startTime) };
}

export function sameProcessIdentity(left: unknown, right: unknown): boolean {
  return record(left) && record(right)
    && Number(left.pid) === Number(right.pid)
    && String(left.startTime) === String(right.startTime);
}

export function spawnMatchesRegistryClaim(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined): boolean {
  const pane = spawn && record(spawn.paneProcess) ? spawn.paneProcess : null;
  return !!spawn?.spawnToken && !!pane?.pid && !!pane.startTime && spawn.spawnToken === registryEntry?.spawnToken;
}

export async function proveBridgeRegistryClaim(entry: BridgeRegistryEntry): Promise<void> {
  const probe = new BridgeSession(entry);
  try {
    await probe.connect();
    await probe.waitForHello({ timeout: 2000 });
  } finally { probe.close(); }
}

/** Synchronous observations, not an authorization that survives an await. */
export function spawnAllowsOwnedPaneClose(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined): boolean {
  if (!spawnMatchesRegistryClaim(spawn, registryEntry) || !registryEntry || !spawn) return false;
  const agentIdentity = processEvidence(registryEntry);
  const ancestry = inspectProcessAncestry(agentIdentity);
  return ancestry.complete
    && sameProcessIdentity(ancestry.processes[0], agentIdentity)
    && processIdentityAlive(processEvidence(spawn.paneProcess))
    && ancestry.processes.some(ancestor => sameProcessIdentity(ancestor, spawn.paneProcess));
}

export function spawnAllowsManagedClose(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined, closeMode: HarnessDescriptor['closeMode']): boolean {
  if (closeMode === 'owned-pane') return spawnAllowsOwnedPaneClose(spawn, registryEntry);
  if (closeMode === 'owned-agent') return spawnMatchesRegistryClaim(spawn, registryEntry) && !!primeWorkerTarget(registryEntry);
  return false;
}

export function spawnAllowsRestart(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined, closeMode: HarnessDescriptor['closeMode']): boolean {
  return closeMode === 'owned-agent'
    ? spawnAllowsManagedClose(spawn, registryEntry, closeMode) && processIdentityAlive(processEvidence(spawn?.paneProcess))
    : spawnAllowsOwnedPaneClose(spawn, registryEntry);
}

export function liveSessionSupports(session: LiveSession, capability: BridgeCapability): boolean {
  if (!(session instanceof BridgeSession)) return true;
  return bridgeSupports(session.harnessId, session.capabilities, capability);
}

export function sessionIdentityFields(harnessId: HarnessId, nativeSessionId: NativeSessionId) {
  const descriptor = getHarness(harnessId);
  return {
    id: routeSessionId(harnessId, nativeSessionId), sessionKey: encodeSessionKey(harnessId, nativeSessionId),
    harnessId, harnessLabel: descriptor?.label || harnessId, nativeSessionId,
  };
}

export function sessionSwitchRouteData(session: LiveSession, input: unknown) {
  if (!record(input) || !input.sessionId || !input.previousSessionId) return null;
  const harnessId = session instanceof BridgeSession ? session.harnessId || 'pi' : 'pi';
  const descriptor = getHarness(harnessId);
  if (!descriptor || !validSessionId(input.sessionId) || !validSessionId(input.previousSessionId)) return null;
  return {
    ...input,
    sessionId: routeSessionId(descriptor.id, input.sessionId),
    previousSessionId: routeSessionId(descriptor.id, input.previousSessionId),
    nativeSessionId: input.sessionId, previousNativeSessionId: input.previousSessionId,
  };
}

/** Persisted Pi ids keep their legacy raw route; alternate routes require an encoded tuple. */
export function recoveryRouteId(saved: Pick<RecoveryRecord, 'harnessId' | 'nativeSessionId'>): string {
  if (saved.harnessId === 'pi') return saved.nativeSessionId;
  const descriptor = getHarness(saved.harnessId);
  if (!descriptor || !validSessionId(saved.nativeSessionId)) throw new TypeError('Invalid session identity');
  return encodeSessionKey(descriptor.id, saved.nativeSessionId);
}

/** Validate historical evidence without granting ownership of any live runtime. */
export function validateRecoveryRecord(saved: RecoveryRecord): SessionSource {
  const descriptor = getHarness(saved.harnessId);
  const id = recoveryRouteId(saved);
  if (!descriptor || !descriptor.argv?.resume || !routeIdentity(id)) {
    throw new OwnershipRefusal('The saved harness or session identity is unsupported.');
  }
  if (!path.isAbsolute(saved.sessionFile || '') || !path.isAbsolute(saved.cwd || '')) {
    throw new OwnershipRefusal('Recovery requires an absolute saved transcript and original working directory.');
  }
  let file: string;
  let root: string;
  try {
    file = fs.realpathSync(saved.sessionFile);
    root = fs.realpathSync(descriptor.rootPath());
    if (!fs.statSync(saved.cwd).isDirectory()) throw new Error('not a directory');
    if (!fs.statSync(file).isFile()) throw new Error('not a file');
  } catch {
    throw new OwnershipRefusal('The saved transcript or original working directory is missing or unreadable; recovery does not fall back to HOME.');
  }
  if (!file.startsWith(root + path.sep)) throw new OwnershipRefusal('The saved transcript is outside this harness session store.');
  const discovery = findSessionCandidate(descriptor.rootPath(), saved.nativeSessionId, { descriptor, allowPartial: false });
  const source = discovery.candidate;
  if (discovery.truncated || !source || fs.realpathSync(source.file) !== file || !readSessionHeader(file, descriptor.profileId)) {
    throw new OwnershipRefusal('The exact saved transcript identity cannot be verified unambiguously.');
  }
  if (descriptor.nestedSubsessions && (source.parentSession || fs.existsSync(`${path.dirname(file)}.jsonl`))) {
    throw new OwnershipRefusal('This is a parent-owned subagent transcript; automatic recovery never resurrects subagents.');
  }
  const boot = recoveryStore.bootId();
  if (!boot || !saved.bootId || !saved.startTime || !saved.pid || !saved.instanceId || !saved.checkpoint) {
    throw new OwnershipRefusal('The saved process identity or transcript checkpoint is incomplete; inspect this session manually.');
  }
  if (boot === saved.bootId && processIdentityAlive({ pid: saved.pid, startTime: saved.startTime })) {
    throw new OwnershipRefusal('The saved process is still alive without a verified bridge; refusing another transcript writer.');
  }
  const launch = recoveryStore.getControl(saved.harnessId, saved.nativeSessionId).attempt?.launch;
  if (record(launch) && launch.bootId === boot && (launch.uncertain || processIdentityAlive(processEvidence(launch)))) {
    throw new OwnershipRefusal('A previous recovery launch may still own this transcript; inspect its process before retrying.');
  }
  return source;
}

export function createSessionOwnership(observations: OwnershipObservations): SessionOwnership {
  const sessionSources: SessionSourceResolver = createSessionSourceResolver();
  const runtimeCache = new Map<string, { pid: unknown; at: number; value: RuntimeDescription }>();
  const RUNTIME_CACHE_TTL_MS = 60_000;

  async function capturePaneRestart(sessionId: string, descriptor: HarnessDescriptor): Promise<PaneRestartCapture> {
    const registry = getRegisteredSession(sessionId);
    if (!registry) throw new OwnershipRefusal('Session not active', 404);
    const placement = tmux.getSpawn(sessionId);
    if (!placement?.socket || !placement.paneId || !spawnMatchesRegistryClaim(placement, registry)) {
      throw new OwnershipRefusal('Restart is available only for RPC sessions and tmux panes launched by pi-dish.');
    }
    const paneProcess = await tmux.paneProcessIdentity(placement.socket, placement.paneId);
    if (!sameProcessIdentity(paneProcess, placement.paneProcess) || !spawnAllowsRestart(placement, registry, descriptor.closeMode)) {
      throw new OwnershipRefusal('The recorded tmux pane no longer proves ownership of this agent, so pi-dish will not restart it.');
    }
    return { kind: 'pane-restart', sessionId, descriptor, registry, placement };
  }

  async function preparePaneRestart(capture: PaneRestartCapture): Promise<BridgeRegistryEntry> {
    const fresh = refreshRegisteredSession(capture.sessionId);
    if (!fresh || !sameRegistryClaim(fresh, capture.registry)) {
      throw new OwnershipRefusal('The live bridge changed while restart was being authorized; no pane was replaced.');
    }
    try { await proveBridgeRegistryClaim(fresh); }
    catch (error) {
      throw new OwnershipRefusal(`The live bridge could not re-prove its identity before restart: ${error instanceof Error ? error.message : String(error)}`);
    }
    const paneProcess = await tmux.paneProcessIdentity(capture.placement.socket, capture.placement.paneId);
    if (!sameProcessIdentity(paneProcess, capture.placement.paneProcess)
        || !spawnAllowsRestart(capture.placement, fresh, capture.descriptor.closeMode)) {
      throw new OwnershipRefusal('The tmux pane ownership proof changed before restart; no pane was replaced.');
    }
    return fresh;
  }

  function revalidatePaneRestart(capture: PaneRestartCapture, proved: BridgeRegistryEntry): BridgeRegistryEntry {
    const registry = refreshRegisteredSession(capture.sessionId);
    if (!registry || !sameRegistryClaim(registry, proved)) {
      throw new OwnershipRefusal('The live bridge changed immediately before restart; no pane was replaced.');
    }
    return registry;
  }

  function checkPrimeRestartLaunch(capture: PaneRestartCapture): void {
    const current = tmux.getSpawn(capture.sessionId);
    if (!current || current.spawnToken !== capture.placement.spawnToken
        || current.socket !== capture.placement.socket || current.paneId !== capture.placement.paneId
        || !sameProcessIdentity(current.paneProcess, capture.placement.paneProcess)) {
      throw new Error('Prime launch ownership changed during restart');
    }
  }

  async function preparePrimeRestartStop(capture: PaneRestartCapture, beforeAction: BeforeLifecycleAction | null): Promise<() => undefined> {
    const finalCheck = beforeAction ? await beforeAction() : null;
    return () => {
      checkPrimeRestartLaunch(capture);
      const current = refreshRegisteredSession(capture.sessionId);
      if (!current || !sameRegistryClaim(current, capture.registry)) throw new Error('Prime worker changed during restart');
      if (finalCheck) finalCheck();
    };
  }

  async function preparePrimeReplacement(capture: PaneRestartCapture, sessionFile: string): Promise<() => undefined> {
    return () => {
      checkPrimeRestartLaunch(capture);
      invalidateRegistryCache();
      if (processIdentityAlive(processEvidence(capture.registry)) || listRegisteredSessions().some(entry => {
        try { return typeof entry.sessionFile === 'string' && fs.realpathSync(entry.sessionFile) === sessionFile; }
        catch { return false; }
      })) throw new Error('A live worker still claims this transcript; refusing another writer');
    };
  }

  function captureBounceAuthority(row: { id: string; harnessId?: unknown; conflicted?: unknown }): BounceAuthority | null {
    const sessionId = row.id;
    const rpc = getRPCSession(sessionId);
    const reg = getRegisteredSession(sessionId);
    const spawn = tmux.getSpawn(sessionId);
    const descriptor = getHarness(row.harnessId || 'pi');
    if (!descriptor || descriptor.closeMode === 'owned-agent' || descriptor.closeMode === 'unsupported' || row.conflicted) return null;
    if (rpc?.alive) {
      return {
        sessionId, harnessId: descriptor.id, rpc,
        reg: reg ? structuredClone(reg) : null, spawn: spawn ? structuredClone(spawn) : null,
        sessionFile: rpc.sessionFile || reg?.sessionFile || null,
      };
    }
    if (!reg || !spawn || !spawnAllowsOwnedPaneClose(spawn, reg)) return null;
    return {
      sessionId, harnessId: descriptor.id, rpc: null,
      reg: structuredClone(reg), spawn: structuredClone(spawn),
      sessionFile: rpc?.sessionFile || reg.sessionFile || null,
    };
  }

  function bounceIdentityFailure(authority: BounceAuthority): string | null {
    invalidateRegistryCache();
    const rpc = getRPCSession(authority.sessionId);
    if (authority.rpc) {
      if (rpc !== authority.rpc || !rpc.alive || rpc.sessionFile !== authority.sessionFile) return 'The original RPC runtime exited or was replaced.';
      const reg = getRegisteredSession(authority.sessionId);
      if (authority.reg ? !reg || !sameRegistryClaim(reg, authority.reg) : !!reg) return 'The RPC bridge identity changed after the target snapshot.';
    } else {
      const reg = getRegisteredSession(authority.sessionId);
      if (!reg || !sameRegistryClaim(reg, authority.reg) || reg.sessionFile !== authority.sessionFile) return 'The original bridge runtime exited, switched sessions, or was replaced.';
      const spawn = tmux.getSpawn(authority.sessionId);
      if (!spawn || spawn.socket !== authority.spawn?.socket || spawn.paneId !== authority.spawn?.paneId
          || spawn.spawnToken !== authority.spawn?.spawnToken
          || !sameProcessIdentity(spawn.paneProcess, authority.spawn?.paneProcess)
          || !spawnAllowsOwnedPaneClose(spawn, reg)) return 'The original pi-dish pane ownership proof no longer matches.';
    }
    return null;
  }

  function captureRpcClose(sessionId: string): RpcCloseCapture | null {
    const rpc = getRPCSession(sessionId);
    return rpc?.alive ? { kind: 'rpc', rpc, registry: getRegisteredSession(sessionId) } : null;
  }

  async function captureOwnedPaneClose(sessionId: string, descriptor: HarnessDescriptor): Promise<OwnedPaneCloseCapture> {
    const registry = getRegisteredSession(sessionId);
    if (!registry) throw new OwnershipRefusal(`${descriptor.label} has no single unambiguous live bridge instance to close.`);
    const placement = tmux.getSpawn(sessionId);
    if (!placement?.socket || !placement.paneId) {
      throw new OwnershipRefusal(`This ${descriptor.label} session was not launched by pi-dish, so its tmux pane cannot be closed remotely.`);
    }
    if (!spawnMatchesRegistryClaim(placement, registry)) {
      tmux.removeSpawn(sessionId, placement);
      throw new OwnershipRefusal(`The recorded ${descriptor.label} pane no longer matches this live agent, so pi-dish will not close it.`);
    }
    const paneProcess = await tmux.paneProcessIdentity(placement.socket, placement.paneId);
    if (!sameProcessIdentity(paneProcess, placement.paneProcess)) {
      tmux.removeSpawn(sessionId, placement);
      throw new OwnershipRefusal(`The recorded ${descriptor.label} pane has exited or been replaced, so pi-dish will not close it.`);
    }
    if (!spawnAllowsOwnedPaneClose(placement, registry)) {
      throw new OwnershipRefusal(`Could not prove that the live ${descriptor.label} agent belongs to the recorded tmux pane, so pi-dish will not close it.`);
    }
    const fresh = refreshRegisteredSession(sessionId);
    if (!fresh || !sameRegistryClaim(fresh, registry)) {
      throw new OwnershipRefusal(`The live ${descriptor.label} bridge changed while close was being authorized, so pi-dish will not kill the pane.`);
    }
    try { await proveBridgeRegistryClaim(fresh); }
    catch (error) {
      throw new OwnershipRefusal(`The live ${descriptor.label} bridge could not re-prove its identity before close: ${error instanceof Error ? error.message : String(error)}`);
    }
    const finalPaneProcess = await tmux.paneProcessIdentity(placement.socket, placement.paneId);
    if (!sameProcessIdentity(finalPaneProcess, placement.paneProcess) || !spawnAllowsOwnedPaneClose(placement, fresh)) {
      throw new OwnershipRefusal(`The ${descriptor.label} pane ownership proof changed before close, so pi-dish will not kill the pane.`);
    }
    return { kind: 'owned-pane', sessionId, descriptor, registry: fresh, placement,
      agentProcess: { pid: Number(fresh.pid), startTime: String(fresh.startTime) } };
  }

  function revalidateOwnedPaneClose(capture: OwnedPaneCloseCapture): void {
    const fresh = refreshRegisteredSession(capture.sessionId);
    if (!fresh || !sameRegistryClaim(fresh, capture.registry)) {
      throw new OwnershipRefusal(`The live ${capture.descriptor.label} bridge changed immediately before close, so pi-dish will not kill the pane.`);
    }
  }

  function capturePrimeClose(sessionId: string, descriptor: HarnessDescriptor): PrimeCloseCapture {
    const registry = getRegisteredSession(sessionId);
    if (!registry) throw new OwnershipRefusal(`${descriptor.label} has no single unambiguous live bridge instance to close.`);
    const placement = tmux.getSpawn(sessionId);
    if (!placement?.socket || !placement.paneId) {
      throw new OwnershipRefusal(`This ${descriptor.label} session was not launched by pi-dish, so it cannot be closed remotely.`);
    }
    if (!spawnMatchesRegistryClaim(placement, registry)) {
      throw new OwnershipRefusal('The recorded Prime launch no longer matches this live agent.');
    }
    return { kind: 'owned-agent', sessionId, registry, placement };
  }

  async function checkPrimeClosePane(capture: PrimeCloseCapture, keepPane: boolean): Promise<boolean> {
    const placement = capture.placement;
    const current = await tmux.paneProcessIdentity(placement.socket, placement.paneId);
    if (sameProcessIdentity(current, placement.paneProcess)) return true;
    if (keepPane || current || processIdentityAlive(processEvidence(placement.paneProcess))
        || await tmux.paneExists(placement.socket, placement.paneId)) {
      throw new Error('The recorded Prime client pane has been replaced; pi-dish will not close it');
    }
    return false;
  }

  async function preparePrimeClose(capture: PrimeCloseCapture, keepPane: boolean, beforeAction: BeforeLifecycleAction | null): Promise<void> {
    await proveBridgeRegistryClaim(capture.registry);
    await checkPrimeClosePane(capture, keepPane);
    const finalCheck = beforeAction ? await beforeAction() : null;
    const fresh = refreshRegisteredSession(capture.sessionId);
    const placement = tmux.getSpawn(capture.sessionId);
    if (!fresh || !sameRegistryClaim(fresh, capture.registry)
        || !placement || placement.spawnToken !== capture.placement.spawnToken
        || placement.socket !== capture.placement.socket || placement.paneId !== capture.placement.paneId
        || !sameProcessIdentity(placement.paneProcess, capture.placement.paneProcess)) {
      throw new Error('Prime bridge or launch ownership changed before close');
    }
    if (finalCheck) finalCheck();
  }

  async function captureLogicalClose(sessionId: string, registry: BridgeRegistryEntry): Promise<LogicalCloseCapture> {
    const hasBirthMarker = Object.prototype.hasOwnProperty.call(registry, 'startTime');
    let legacyProcess: ProcessIdentity | null = null;
    let legacyBridge: InstanceType<typeof BridgeSession> | null = null;
    if (!hasBirthMarker) {
      try {
        legacyBridge = await getBridgeSession(sessionId);
        const hello = await legacyBridge.waitForHello({ timeout: 2000 });
        if (legacyBridge.socketPath !== registry.socketPath
            || hello?.sessionId !== sessionId || Number(hello?.pid) !== Number(registry.pid)) {
          legacyBridge.close();
          invalidateRegistryCache();
          throw new OwnershipRefusal('Refusing to close this legacy bridge entry because its live handshake did not prove the registered session and PID. Refresh or reload the bridge, then retry.');
        }
        legacyProcess = processIdentity(Number(registry.pid));
      } catch (error) {
        if (error instanceof OwnershipRefusal) throw error;
        pruneUnreachableRegisteredSession(registry, error);
        throw new OwnershipRefusal(`Refusing to signal legacy registry pid ${registry.pid} without a successful bridge identity handshake: ${error instanceof Error ? error.message : String(error)}. Reload or upgrade that pi bridge, then retry.`);
      }
      if (!legacyProcess) {
        pruneRegisteredSession(registry);
        throw new OwnershipRefusal(`Refusing to signal legacy registry pid ${registry.pid} because its exact process identity could not be verified. Reload or upgrade that pi bridge, then retry.`);
      }
    }
    return { kind: 'logical', sessionId, registry, hasBirthMarker, legacyProcess, legacyBridge };
  }

  /** Call synchronously next to SIGTERM, after any legacy hello preparation. */
  function revalidateLogicalClose(capture: LogicalCloseCapture): LogicalCloseProof {
    const registry = refreshRegisteredSession(capture.sessionId);
    if (!registry || !sameRegistryClaim(capture.registry, registry)) {
      throw new OwnershipRefusal('The bridge registry identity changed while closing; no process was signaled. Refresh the session and retry.');
    }
    let identity = capture.legacyProcess;
    if (capture.hasBirthMarker) identity = { pid: Number(registry.pid), startTime: String(registry.startTime) };
    else if (!capture.legacyBridge?.alive) {
      throw new OwnershipRefusal('The legacy bridge disconnected before its process could be signaled; no process was signaled. Reload or upgrade the bridge, then retry.');
    }
    if (!identity || !processIdentityAlive(identity)) {
      pruneRegisteredSession(registry);
      throw new OwnershipRefusal(`The registered pi identity for pid ${registry.pid} is stale; no process was signaled. The stale registry claim was discarded.`);
    }
    return { registry, process: identity };
  }

  function getRegisteredSession(sessionId: unknown): BridgeRegistryEntry | null {
    const identity = routeIdentity(sessionId);
    return identity ? getRegisteredSessionByNativeId(identity.harnessId, identity.nativeSessionId) : null;
  }

  function refreshRegisteredSession(sessionId: unknown): BridgeRegistryEntry | null {
    invalidateRegistryCache();
    return getRegisteredSession(sessionId);
  }

  function getRPCSession(sessionId: unknown): InstanceType<typeof RPCSession> | null | undefined {
    const identity = routeIdentity(sessionId);
    return identity?.harnessId === 'pi' ? getRawRPCSession(identity.nativeSessionId) : null;
  }

  async function getBridgeSession(sessionId: string): Promise<InstanceType<typeof BridgeSession>> {
    const entry = getRegisteredSession(sessionId);
    if (!entry) throw new Error(`session ${sessionId} not registered or has conflicting bridge instances`);
    return getBridgeSessionForClaim(entry);
  }

  function liveSourceObservations(sessionId: unknown): LiveSourceObservation[] {
    const identity = routeIdentity(sessionId);
    if (!identity) return [];
    const registered = getRegisteredSession(sessionId);
    const rpc = identity.harnessId === 'pi' ? getRPCSession(sessionId) : null;
    const out: LiveSourceObservation[] = [];
    if (registered) out.push({ kind: 'registered', ...identity, file: typeof registered.sessionFile === 'string' ? registered.sessionFile || null : null });
    if (rpc) {
      const file = rpc.sessionFile || rpc.state?.sessionFile || null;
      out.push({ kind: 'rpc', ...identity, file: typeof file === 'string' ? file : null });
    }
    return out;
  }

  function resolveSessionCandidate(sessionId: string, { discover = true } = {}): SessionSource | null {
    return sessionSources.resolve({ route: sessionId, exact: true, discover, live: liveSourceObservations(sessionId) });
  }

  function liveSessionHistoryPending(sessionId: string): boolean {
    const registered = getRegisteredSession(sessionId);
    if (registered) return typeof registered.sessionFile !== 'string' || !registered.sessionFile || !fs.existsSync(registered.sessionFile);
    const rpc = getRPCSession(sessionId);
    const file = rpc?.sessionFile || rpc?.state?.sessionFile;
    return !!rpc?.alive && (typeof file !== 'string' || !file || !fs.existsSync(file));
  }

  function track<T extends LiveSession>(session: T): T {
    observations.onLive(session);
    return session;
  }

  async function getLiveSession(sessionId: unknown): Promise<LiveSession | null> {
    const registered = getRegisteredSession(sessionId);
    if (registered) {
      let bridgeError: unknown;
      try {
        return track(await getBridgeSessionForClaim(registered));
      } catch (error) {
        bridgeError = error;
        pruneUnreachableRegisteredSession(registered, error);
        // Refresh exactly once after a retired socket; never prune its replacement.
        const replacement = refreshRegisteredSession(sessionId);
        if (replacement && !sameRegistryClaim(replacement, registered)) {
          try { return track(await getBridgeSessionForClaim(replacement)); }
          catch (replacementError) {
            bridgeError = replacementError;
            pruneUnreachableRegisteredSession(replacement, replacementError);
          }
        }
        const rpc = getRPCSession(sessionId);
        if (rpc?.alive) return track(rpc);
        throw bridgeError;
      }
    }
    const rpc = getRPCSession(sessionId);
    return rpc?.alive ? track(rpc) : null;
  }

  function adoptBridgeSessionSwitch(session: LiveSession, data: unknown): void {
    const routed = sessionSwitchRouteData(session, data);
    if (!routed || routed.sessionId === routed.previousSessionId) return;
    const spawn = tmux.getSpawn(routed.previousSessionId);
    const instance = session instanceof BridgeSession ? session.bridgeInstanceId : undefined;
    if (spawn && (!spawn.bridgeInstanceId || !instance || spawn.bridgeInstanceId === instance)) {
      tmux.rekeySpawn(routed.previousSessionId, routed.sessionId, spawn);
    }
    invalidateRegistryCache();
    for (const route of [routed.previousSessionId, routed.sessionId]) {
      runtimeCache.delete(route);
      observations.onRetired(route);
      sessionSources.invalidateRoute(route);
    }
  }

  async function describeRuntime(sessionId: string): Promise<RuntimeDescription | null> {
    const rpc = getRPCSession(sessionId);
    if (rpc?.alive) return { kind: 'rpc', pid: rpc.proc?.pid ?? null };
    const reg = getRegisteredSession(sessionId);
    if (!reg) return null;
    const cached = runtimeCache.get(sessionId);
    if (cached && cached.pid === (reg.pid ?? null) && Date.now() - cached.at < RUNTIME_CACHE_TTL_MS) return cached.value;
    const value = await resolveRuntime(sessionId, reg);
    if (runtimeCache.size >= 200) runtimeCache.clear();
    runtimeCache.set(sessionId, { pid: reg.pid ?? null, at: Date.now(), value });
    return value;
  }

  async function resolveRuntime(sessionId: string, reg: BridgeRegistryEntry): Promise<RuntimeDescription> {
    const spawn = tmux.getSpawn(sessionId);
    const stamp = record(reg.tmux) ? reg.tmux : null;
    const socket = stamp?.socket || spawn?.socket || null;
    const pid = observedPid(reg.pid);
    if (typeof socket === 'string' && socket) {
      const paneId = (stamp?.socket ? stamp.pane : spawn?.paneId) || null;
      let loc = typeof paneId === 'string' && paneId ? await tmux.paneLocation(socket, paneId) : null;
      let server = path.basename(socket);
      if (!loc) {
        const pane = await tmux.findPaneByPid(pid);
        if (pane) { loc = pane; server = path.basename(pane.socket); }
      }
      return { kind: 'tmux', pid: reg.pid ?? null, server,
        tmuxSession: loc?.tmuxSession ?? null, windowIndex: loc?.windowIndex ?? null, windowName: loc?.windowName ?? null };
    }
    const pane = await tmux.findPaneByPid(pid);
    if (pane) return { kind: 'tmux', pid: reg.pid ?? null, server: path.basename(pane.socket),
      tmuxSession: pane.tmuxSession, windowIndex: pane.windowIndex, windowName: pane.windowName };
    return { kind: 'terminal', pid: reg.pid ?? null };
  }

  /** Weak location advice for terminal/send-keys; never a destructive ownership capture. */
  async function locatePiPane(sessionId: string): Promise<tmux.PaneTarget | null> {
    const reg = getRegisteredSession(sessionId);
    if (!reg) return null;
    const candidates: tmux.PaneTarget[] = [];
    const stamp = record(reg.tmux) ? reg.tmux : null;
    if (typeof stamp?.socket === 'string' && stamp.socket && typeof stamp.pane === 'string' && stamp.pane) candidates.push({ socket: stamp.socket, paneId: stamp.pane });
    const spawn = tmux.getSpawn(sessionId);
    if (spawn?.socket && spawn.paneId) candidates.push({ socket: spawn.socket, paneId: spawn.paneId });
    for (const candidate of candidates) if (await tmux.paneExists(candidate.socket, candidate.paneId)) return candidate;
    return tmux.findPaneByPid(observedPid(reg.pid));
  }

  function liveSubagentProof(descriptor: HarnessDescriptor, candidate: DiscoveryCandidate): boolean {
    if (descriptor.sessionExitCustomType) {
      let tail: unknown;
      try { tail = observations.readSessionTailEntry(candidate); } catch { return false; }
      return !(record(tail) && tail.type === 'custom' && tail.customType === descriptor.sessionExitCustomType);
    }
    if (descriptor.subagentArtifacts) {
      try {
        const entry: unknown = JSON.parse(fs.readFileSync(path.join(path.dirname(candidate.file), 'rlm-subagent.json'), 'utf8'));
        return record(entry) && entry.type === 'rlm_subagent' && entry.status === 'running';
      } catch { return false; }
    }
    return false;
  }

  function liveSubsessionCandidates(active: readonly { id: string; harnessId: unknown; sessionFile?: unknown }[]): DiscoveryCandidate[] {
    const claimed = new Set(active.map(session => session.id));
    const out: DiscoveryCandidate[] = [];
    for (const session of active) {
      const descriptor = getHarness(session.harnessId);
      if (!descriptor || (!descriptor.nestedSubsessions && !descriptor.subagentArtifacts) || typeof session.sessionFile !== 'string' || !session.sessionFile) continue;
      let candidates: DiscoveryCandidate[];
      try { candidates = discoverSubsessionCandidates(session.sessionFile, { descriptor }); } catch { continue; }
      for (const candidate of candidates) {
        if (claimed.has(candidate.routeId) || !liveSubagentProof(descriptor, candidate)) continue;
        claimed.add(candidate.routeId);
        out.push(candidate);
      }
    }
    return out;
  }

  return { sessionSources, getRegisteredSession, refreshRegisteredSession, getRPCSession, getBridgeSession,
    liveSourceObservations, resolveSessionCandidate, liveSessionHistoryPending, getLiveSession,
    adoptBridgeSessionSwitch, describeRuntime, locatePiPane, liveSubsessionCandidates,
    captureRpcClose, captureOwnedPaneClose, revalidateOwnedPaneClose, capturePrimeClose,
    checkPrimeClosePane, preparePrimeClose, captureLogicalClose, revalidateLogicalClose,
    capturePaneRestart, preparePaneRestart, revalidatePaneRestart, preparePrimeRestartStop,
    preparePrimeReplacement, captureBounceAuthority, bounceIdentityFailure };
}
