import fs = require('fs');
import path = require('path');
import type { BridgeCapability, BridgeRegistryEntry, HarnessDescriptor, HarnessId, NativeSessionId, ProcessIdentity, ProcessIdentityInput, SessionIdentity } from './contracts';
import { BridgeSession, getBridgeSession as getBridgeSessionForClaim, getRegisteredSessionByNativeId, invalidateRegistryCache, listRegisteredSessions, pruneRegisteredSession, pruneUnreachableRegisteredSession, sameRegistryClaim } from './bridge-session';
import { getRPCSession as getRawRPCSession, RPCSession } from './rpc-session';
import { getPrimeDaemon, PrimeDaemonSession } from './prime-daemon';
import type { PrimeAgentSummary, PrimeDaemon } from './prime-daemon';
import { bridgeSupports, PRIME_DAEMON_CAPABILITIES } from './session-capabilities';
import { getHarness } from './harnesses';
import { inspectProcessAncestry, processIdentity, processIdentityAlive } from './process-identity';
import { encodeSessionKey, resolveSessionRoute, validSessionId, VERSION } from './session-key';
import { createSessionSourceResolver } from './session-source';
import { sessionRootsFor } from './private-sessions';
import { discoverSubsessionCandidates, findSessionCandidate, readSessionHeader } from './session-discovery';
import type { DiscoveryCandidate, LiveSourceObservation, SessionSource, SessionSourceResolver } from './session-source-contracts';
import { record } from './helper-values';
import * as tmux from './tmux';
import * as recoveryStore from './session-recovery';
import type { RecoveryRecord } from './session-recovery';

/** The three live transports: bridge extension, Pi RPC child, Prime daemon root. */
export type LiveSession = InstanceType<typeof BridgeSession> | InstanceType<typeof RPCSession> | PrimeDaemonSession;

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
  readonly descriptor: HarnessDescriptor;
  readonly placement: tmux.SpawnPlacement;
  readonly agent: tmux.PrimeAgentPlacement;
  readonly daemon: PrimeDaemon;
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
/** Prime restart authority comes from the spawn record plus the live roster, not a bridge claim. */
export interface PrimeRestartCapture {
  readonly kind: 'prime-restart';
  readonly sessionId: string;
  readonly descriptor: HarnessDescriptor;
  readonly placement: tmux.SpawnPlacement;
  readonly agent: tmux.PrimeAgentPlacement;
  readonly daemon: PrimeDaemon;
  readonly summary: PrimeAgentSummary;
  readonly sessionFile: string;
}
export type RestartCapture = PaneRestartCapture | PrimeRestartCapture;
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
  capturePrimeClose(sessionId: string, descriptor: HarnessDescriptor): Promise<PrimeCloseCapture>;
  checkPrimeClosePane(capture: PrimeCloseCapture, keepPane: boolean): Promise<boolean>;
  preparePrimeClose(capture: PrimeCloseCapture, keepPane: boolean, beforeAction: BeforeLifecycleAction | null): Promise<void>;
  captureLogicalClose(sessionId: string, registry: BridgeRegistryEntry): Promise<LogicalCloseCapture>;
  revalidateLogicalClose(capture: LogicalCloseCapture): LogicalCloseProof;
  capturePaneRestart(sessionId: string, descriptor: HarnessDescriptor): Promise<RestartCapture>;
  preparePaneRestart(capture: PaneRestartCapture): Promise<BridgeRegistryEntry>;
  revalidatePaneRestart(capture: PaneRestartCapture, proved: BridgeRegistryEntry): BridgeRegistryEntry;
  preparePrimeRestartStop(capture: PrimeRestartCapture, beforeAction: BeforeLifecycleAction | null): Promise<() => undefined>;
  preparePrimeReplacement(capture: PrimeRestartCapture, sessionFile: string): Promise<() => undefined>;
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

function spawnMatchesRegistryClaim(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined): boolean {
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
function spawnAllowsOwnedPaneClose(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined): boolean {
  if (!spawnMatchesRegistryClaim(spawn, registryEntry) || !registryEntry || !spawn) return false;
  const agentIdentity = processEvidence(registryEntry);
  const ancestry = inspectProcessAncestry(agentIdentity);
  return ancestry.complete
    && sameProcessIdentity(ancestry.processes[0], agentIdentity)
    && processIdentityAlive(processEvidence(spawn.paneProcess))
    && ancestry.processes.some(ancestor => sameProcessIdentity(ancestor, spawn.paneProcess));
}

function primeAgentMatchesSummary(agent: tmux.PrimeAgentPlacement, summary: PrimeAgentSummary): boolean {
  return agent.activeSessionId === summary.activeSessionId
    && agent.workerInstanceId === (summary.workerInstanceId || null)
    && agent.sessionFile === summary.sessionFile;
}

/**
 * The same resident worker. A Prime `/new` moves the agent to a new transcript
 * while `activeSessionId` and `workerInstanceId` survive, so transcript equality
 * is not part of worker identity.
 */
function primeAgentSameWorker(agent: tmux.PrimeAgentPlacement, summary: PrimeAgentSummary): boolean {
  return agent.activeSessionId === summary.activeSessionId
    && agent.workerInstanceId === (summary.workerInstanceId || null);
}

interface PrimeSpawnRecord {
  readonly spawnKey: string;
  readonly placement: tmux.SpawnPlacement;
  readonly agent: tmux.PrimeAgentPlacement;
}

/**
 * The recorded Prime launch for this route, falling back to the spawn record
 * whose worker matches the roster when the route key moved while pi-dish was
 * down (a TUI `/new` pi-dish never observed).
 */
function findPrimeSpawn(sessionId: string, summary: PrimeAgentSummary | null): PrimeSpawnRecord | null {
  if (!summary) return null;
  const direct = tmux.getSpawn(sessionId);
  const directAgent = tmux.spawnPrimeAgent(direct);
  if (direct?.socket && direct.paneId && directAgent && primeAgentSameWorker(directAgent, summary)) {
    return { spawnKey: sessionId, placement: direct, agent: directAgent };
  }
  let fallback: PrimeSpawnRecord | null = null;
  for (const [spawnKey, placement] of Object.entries(tmux.listSpawns())) {
    if (spawnKey === sessionId || !placement.socket || !placement.paneId) continue;
    const agent = tmux.spawnPrimeAgent(placement);
    if (!agent || !primeAgentSameWorker(agent, summary)) continue;
    if (processIdentityAlive(processEvidence(placement.paneProcess))) return { spawnKey, placement, agent };
    fallback ??= { spawnKey, placement, agent };
  }
  return fallback;
}

/** Roster evidence refreshed onto the launch record a route keeps. */
function primeAgentOf(found: PrimeSpawnRecord, summary: PrimeAgentSummary): tmux.PrimeAgentPlacement {
  return {
    daemonSocket: found.agent.daemonSocket,
    activeSessionId: summary.activeSessionId,
    workerInstanceId: summary.workerInstanceId || null,
    sessionFile: summary.sessionFile,
  };
}

/**
 * Adopt a route key whose launch record still names the same worker: re-key
 * the record and refresh its agent evidence to the live roster row.
 */
function adoptPrimeSpawn(sessionId: string, found: PrimeSpawnRecord, summary: PrimeAgentSummary): tmux.SpawnPlacement {
  const agent = primeAgentOf(found, summary);
  if (found.spawnKey === sessionId && primeAgentMatchesSummary(found.agent, summary)) return found.placement;
  if (found.spawnKey !== sessionId && !tmux.rekeySpawn(found.spawnKey, sessionId, found.placement)) {
    throw new OwnershipRefusal('The Prime launch record changed while adopting this session; retry.');
  }
  tmux.recordSpawn(sessionId, {
    socket: found.placement.socket,
    paneId: found.placement.paneId,
    paneProcess: processEvidence(found.placement.paneProcess),
    primeAgent: agent,
  });
  return tmux.getSpawn(sessionId) ?? { ...found.placement, primeAgent: agent };
}

/** The launch record and roster root that authorize acting on one Prime route. */
async function locatePrimeLaunch(
  sessionId: string, descriptor: HarnessDescriptor, action: 'close' | 'restart',
): Promise<{ daemon: PrimeDaemon; found: PrimeSpawnRecord; summary: PrimeAgentSummary }> {
  const identity = routeIdentity(sessionId);
  if (action === 'restart' && identity?.harnessId !== 'prime') {
    throw new OwnershipRefusal(`Restart is available only for ${descriptor.label} sessions pi-dish launched into a tmux pane.`);
  }
  const daemon = getPrimeDaemon();
  const root = identity?.harnessId === 'prime'
    ? (await daemon.refresh()).find(session => session.nativeSessionId === identity.nativeSessionId)
    : null;
  const found = findPrimeSpawn(sessionId, root?.summary ?? null);
  if (!found) {
    const direct = tmux.getSpawn(sessionId);
    const recorded = !!direct?.socket && !!direct.paneId && !!tmux.spawnPrimeAgent(direct);
    const refusal = action === 'close'
      ? recorded ? 'The recorded Prime launch no longer matches this live agent.'
        : `This ${descriptor.label} session was not launched by pi-dish, so it cannot be closed remotely.`
      : recorded ? 'The recorded Prime launch no longer matches this live agent, so pi-dish will not restart it.'
        : `Restart is available only for ${descriptor.label} sessions pi-dish launched into a tmux pane.`;
    throw new OwnershipRefusal(refusal);
  }
  if (path.resolve(daemon.socketPath) !== path.resolve(found.agent.daemonSocket)) {
    throw new OwnershipRefusal(`The Prime daemon socket changed since this session was launched, so pi-dish will not ${action} it.`);
  }
  if (!root) throw new OwnershipRefusal(`The recorded Prime launch no longer matches this live agent${action === 'restart' ? ', so pi-dish will not restart it' : ''}.`);
  return { daemon, found, summary: root.summary };
}

/** Compare transcripts through their real paths without inventing a match on failure. */
export function sameTranscriptFile(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  try { return fs.realpathSync(left) === fs.realpathSync(right); } catch { return false; }
}

export interface PrimeLaunchAuthority {
  readonly closeAllowed: boolean;
  readonly restartAllowed: boolean;
}

/**
 * Prime launch authority for one route id: a recorded launch must name the
 * same resident worker as the roster summary, even when the route key moved.
 * Synchronous by design; callers refresh the roster before projecting a row.
 */
function primeLaunchAuthority(sessionId: string, summary: PrimeAgentSummary | null): PrimeLaunchAuthority {
  const found = findPrimeSpawn(sessionId, summary);
  const currentDaemon = getPrimeDaemon().socketPath;
  const closeAllowed = !!found && path.resolve(found.agent.daemonSocket) === path.resolve(currentDaemon);
  const paneProcess = found && record(found.placement.paneProcess) ? found.placement.paneProcess : null;
  return {
    closeAllowed,
    restartAllowed: closeAllowed && !!paneProcess && processIdentityAlive(paneProcess),
  };
}

/** Resolve the cached roster root for a Prime route, then apply primeLaunchAuthority. */
export function primeLaunchAuthorityForRoute(sessionId: string): PrimeLaunchAuthority {
  const identity = routeIdentity(sessionId);
  const summary = identity?.harnessId === 'prime'
    ? getPrimeDaemon().byNativeId(identity.nativeSessionId)?.summary ?? null
    : null;
  return primeLaunchAuthority(sessionId, summary);
}

export function spawnAllowsManagedClose(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined, closeMode: HarnessDescriptor['closeMode']): boolean {
  if (closeMode === 'owned-pane') return spawnAllowsOwnedPaneClose(spawn, registryEntry);
  if (closeMode !== 'owned-agent') return false;
  const agent = tmux.spawnPrimeAgent(spawn);
  if (!agent || !spawn?.socket || !spawn.paneId) return false;
  const root = getPrimeDaemon().byActiveSessionId(agent.activeSessionId);
  return !!root && primeAgentSameWorker(agent, root.summary);
}

export function spawnAllowsRestart(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined, closeMode: HarnessDescriptor['closeMode']): boolean {
  if (closeMode !== 'owned-agent') return spawnAllowsOwnedPaneClose(spawn, registryEntry);
  return spawnAllowsManagedClose(spawn, registryEntry, closeMode) && processIdentityAlive(processEvidence(spawn?.paneProcess));
}

export function liveSessionSupports(session: LiveSession, capability: BridgeCapability): boolean {
  // A Prime daemon root has no bridge advertisement: the transport itself fixes
  // which commands exist (no extension UI, side chat, fast mode or share snapshot).
  if (session instanceof PrimeDaemonSession) return PRIME_DAEMON_CAPABILITIES[capability] === true;
  if (!(session instanceof BridgeSession)) return true;
  return bridgeSupports(session.harnessId, session.capabilities, capability);
}

/** A Prime route's live root. Prime 0.10+ never registers with the bridge. */
function primeDaemonSessionFor(identity: SessionIdentity): PrimeDaemonSession | null {
  return getHarness(identity.harnessId)?.liveTransport === 'prime-daemon'
    ? getPrimeDaemon().byNativeId(identity.nativeSessionId) : null;
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
  const descriptor = session instanceof PrimeDaemonSession ? getHarness('prime')
    : session instanceof BridgeSession ? getHarness(session.harnessId || 'pi') : getHarness('pi');
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
  try {
    file = fs.realpathSync(saved.sessionFile);
    if (!fs.statSync(saved.cwd).isDirectory()) throw new Error('not a directory');
    if (!fs.statSync(file).isFile()) throw new Error('not a file');
  } catch {
    throw new OwnershipRefusal('The saved transcript or original working directory is missing or unreadable; recovery does not fall back to HOME.');
  }
  const roots = sessionRootsFor(descriptor);
  const contained = roots.some(({ root }) => {
    try { return file.startsWith(fs.realpathSync(root) + path.sep); } catch { return false; }
  });
  if (!contained) throw new OwnershipRefusal('The saved transcript is outside this harness session store.');
  let source: DiscoveryCandidate | null = null;
  for (const { root, singleWorkspace, private: privateRoot } of roots) {
    const discovery = findSessionCandidate(root, saved.nativeSessionId, {
      descriptor, allowPartial: false, singleWorkspace, private: privateRoot,
    });
    // A truncated scan cannot prove the exact identity either way.
    if (discovery.truncated) throw new OwnershipRefusal('The exact saved transcript identity cannot be verified unambiguously.');
    if (discovery.candidate) { source = discovery.candidate; break; }
  }
  if (!source || fs.realpathSync(source.file) !== file || !readSessionHeader(file, descriptor.profileId)) {
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

  async function capturePaneRestart(sessionId: string, descriptor: HarnessDescriptor): Promise<RestartCapture> {
    if (descriptor.closeMode === 'owned-agent') return capturePrimeRestart(sessionId, descriptor);
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

  async function capturePrimeRestart(sessionId: string, descriptor: HarnessDescriptor): Promise<PrimeRestartCapture> {
    const { daemon, found, summary } = await locatePrimeLaunch(sessionId, descriptor, 'restart');
    const paneProcess = await tmux.paneProcessIdentity(found.placement.socket, found.placement.paneId);
    if (!sameProcessIdentity(paneProcess, found.placement.paneProcess)
        || !processIdentityAlive(processEvidence(found.placement.paneProcess))) {
      throw new OwnershipRefusal('The recorded tmux pane no longer proves ownership of this agent, so pi-dish will not restart it.');
    }
    const placement = adoptPrimeSpawn(sessionId, found, summary);
    let sessionFile: string;
    try { sessionFile = fs.realpathSync(summary.sessionFile); }
    catch { throw new OwnershipRefusal('The active agent has no resumable session file.'); }
    return { kind: 'prime-restart', sessionId, descriptor, placement, daemon, summary, sessionFile, agent: primeAgentOf(found, summary) };
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

  function checkPrimeRestartLaunch(capture: PrimeRestartCapture): void {
    const current = tmux.getSpawn(capture.sessionId);
    const agent = tmux.spawnPrimeAgent(current);
    if (!current || current.socket !== capture.placement.socket || current.paneId !== capture.placement.paneId
        || !sameProcessIdentity(current.paneProcess, capture.placement.paneProcess)
        || !agent || !primeAgentMatchesSummary(agent, capture.summary)) {
      throw new Error('Prime launch ownership changed during restart');
    }
  }

  async function preparePrimeRestartStop(capture: PrimeRestartCapture, beforeAction: BeforeLifecycleAction | null): Promise<() => undefined> {
    const finalCheck = beforeAction ? await beforeAction() : null;
    return () => {
      checkPrimeRestartLaunch(capture);
      // The daemon re-reads the roster immediately before this check runs;
      // the cached root must still be the exact worker we captured.
      const root = capture.daemon.byActiveSessionId(capture.agent.activeSessionId);
      if (!root || !primeAgentMatchesSummary(capture.agent, root.summary)) throw new Error('Prime worker changed during restart');
      if (finalCheck) finalCheck();
    };
  }

  async function preparePrimeReplacement(capture: PrimeRestartCapture, sessionFile: string): Promise<() => undefined> {
    // Never launch a second writer while the roster still lists the transcript.
    await capture.daemon.refresh();
    if (capture.daemon.list().some(session => sameTranscriptFile(session.summary.sessionFile, sessionFile))) {
      throw new Error('A live Prime agent still claims this transcript; refusing another writer');
    }
    return () => {
      checkPrimeRestartLaunch(capture);
      if (capture.daemon.list().some(session => sameTranscriptFile(session.summary.sessionFile, sessionFile))) {
        throw new Error('A live Prime agent still claims this transcript; refusing another writer');
      }
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

  async function capturePrimeClose(sessionId: string, descriptor: HarnessDescriptor): Promise<PrimeCloseCapture> {
    const { daemon, found, summary } = await locatePrimeLaunch(sessionId, descriptor, 'close');
    return {
      kind: 'owned-agent', sessionId, descriptor, daemon,
      placement: adoptPrimeSpawn(sessionId, found, summary),
      agent: primeAgentOf(found, summary),
    };
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
    await checkPrimeClosePane(capture, keepPane);
    const finalCheck = beforeAction ? await beforeAction() : null;
    const placement = tmux.getSpawn(capture.sessionId);
    const agent = tmux.spawnPrimeAgent(placement);
    const root = capture.daemon.byActiveSessionId(capture.agent.activeSessionId);
    if (!placement || placement.socket !== capture.placement.socket || placement.paneId !== capture.placement.paneId
        || !sameProcessIdentity(placement.paneProcess, capture.placement.paneProcess)
        || !agent
        || agent.daemonSocket !== capture.agent.daemonSocket || agent.activeSessionId !== capture.agent.activeSessionId
        || agent.workerInstanceId !== capture.agent.workerInstanceId || agent.sessionFile !== capture.agent.sessionFile
        || !root || !primeAgentMatchesSummary(capture.agent, root.summary)) {
      throw new Error('Prime launch ownership changed before close');
    }
    if (finalCheck) finalCheck();
  }

  async function captureLogicalClose(sessionId: string, registry: BridgeRegistryEntry): Promise<LogicalCloseCapture> {
    const hasBirthMarker = Object.hasOwn(registry, 'startTime');
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
    // Prime's roster is the only live source for its routes: an old-style
    // registry claim for a 0.10+ agent cannot prove a daemon worker.
    if (getHarness(identity.harnessId)?.liveTransport === 'prime-daemon') {
      const live = primeDaemonSessionFor(identity);
      return live ? [{ kind: 'prime-daemon', ...identity, file: typeof live.sessionFile === 'string' ? live.sessionFile || null : null }] : [];
    }
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
    const identity = routeIdentity(sessionId);
    if (identity && getHarness(identity.harnessId)?.liveTransport === 'prime-daemon') {
      const prime = primeDaemonSessionFor(identity);
      return !!prime && (!prime.sessionFile || !fs.existsSync(prime.sessionFile));
    }
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
    const identity = routeIdentity(sessionId);
    if (identity && getHarness(identity.harnessId)?.liveTransport === 'prime-daemon') {
      const daemon = getPrimeDaemon();
      const cached = daemon.byNativeId(identity.nativeSessionId);
      if (cached) return track(cached);
      // The roster may be cold (first request after start, or an agent that has
      // not been polled yet): read it once more before declaring the route dead.
      await daemon.refresh();
      const fresh = daemon.byNativeId(identity.nativeSessionId);
      return fresh ? track(fresh) : null;
    }
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

  function cachedRuntime(sessionId: string, pid: unknown): RuntimeDescription | null {
    const cached = runtimeCache.get(sessionId);
    return cached && cached.pid === pid && Date.now() - cached.at < RUNTIME_CACHE_TTL_MS ? cached.value : null;
  }

  function rememberRuntime(sessionId: string, pid: unknown, value: RuntimeDescription): RuntimeDescription {
    if (runtimeCache.size >= 200) runtimeCache.clear();
    runtimeCache.set(sessionId, { pid, at: Date.now(), value });
    return value;
  }

  async function describeRuntime(sessionId: string): Promise<RuntimeDescription | null> {
    const rpc = getRPCSession(sessionId);
    if (rpc?.alive) return { kind: 'rpc', pid: rpc.proc?.pid ?? null };
    if (routeIdentity(sessionId)?.harnessId === 'prime') return describePrimeRuntime(sessionId);
    const reg = getRegisteredSession(sessionId);
    if (!reg) return null;
    const pid = reg.pid ?? null;
    return cachedRuntime(sessionId, pid) ?? rememberRuntime(sessionId, pid, await resolveRuntime(sessionId, reg));
  }

  /** A recorded placement first, then the pane that currently holds the process. */
  async function locatedPane(pid: string | number | null | undefined, socket: string | null, paneId: string | null): Promise<{ loc: tmux.PaneLocation | null; server: string | null }> {
    const loc = socket && paneId ? await tmux.paneLocation(socket, paneId) : null;
    const server = socket ? path.basename(socket) : null;
    if (loc) return { loc, server };
    const pane = await tmux.findPaneByPid(pid);
    return { loc: pane, server: pane ? path.basename(pane.socket) : server };
  }

  /** Prime has no bridge entry: the pane comes from the spawn record, the pid from the roster. */
  async function describePrimeRuntime(sessionId: string): Promise<RuntimeDescription | null> {
    const placement = tmux.getSpawn(sessionId);
    const agent = tmux.spawnPrimeAgent(placement);
    const root = agent ? getPrimeDaemon().byActiveSessionId(agent.activeSessionId) : null;
    const pid = root?.summary.workerPid ?? (placement && record(placement.paneProcess) ? observedPid(placement.paneProcess.pid) : null) ?? null;
    const cached = cachedRuntime(sessionId, pid);
    if (cached) return cached;
    const { loc, server } = await locatedPane(pid, placement?.socket ?? null, placement?.paneId ?? null);
    return rememberRuntime(sessionId, pid, loc && server
      ? { kind: 'tmux', pid, server, tmuxSession: loc.tmuxSession ?? null, windowIndex: loc.windowIndex ?? null, windowName: loc.windowName ?? null }
      : { kind: 'terminal', pid });
  }

  async function resolveRuntime(sessionId: string, reg: BridgeRegistryEntry): Promise<RuntimeDescription> {
    const spawn = tmux.getSpawn(sessionId);
    const stamp = record(reg.tmux) ? reg.tmux : null;
    const rawSocket = stamp?.socket || spawn?.socket || null;
    const rawPane = (stamp?.socket ? stamp.pane : spawn?.paneId) || null;
    const socket = typeof rawSocket === 'string' && rawSocket ? rawSocket : null;
    const paneId = typeof rawPane === 'string' && rawPane ? rawPane : null;
    const { loc, server } = await locatedPane(observedPid(reg.pid), socket, paneId);
    return server
      ? { kind: 'tmux', pid: reg.pid ?? null, server,
        tmuxSession: loc?.tmuxSession ?? null, windowIndex: loc?.windowIndex ?? null, windowName: loc?.windowName ?? null }
      : { kind: 'terminal', pid: reg.pid ?? null };
  }

  /** Weak location advice for terminal/send-keys; never a destructive ownership capture. */
  async function locatePiPane(sessionId: string): Promise<tmux.PaneTarget | null> {
    if (routeIdentity(sessionId)?.harnessId === 'prime') {
      const placement = tmux.getSpawn(sessionId);
      if (placement?.socket && placement.paneId && await tmux.paneExists(placement.socket, placement.paneId)) {
        return { socket: placement.socket, paneId: placement.paneId };
      }
      const agent = tmux.spawnPrimeAgent(placement);
      const root = agent ? getPrimeDaemon().byActiveSessionId(agent.activeSessionId) : null;
      return root?.summary.workerPid ? tmux.findPaneByPid(root.summary.workerPid) : null;
    }
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
