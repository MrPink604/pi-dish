import fs = require('fs');
import os = require('os');
import path = require('path');
import crypto = require('crypto');
import { setTimeout as delay } from 'timers/promises';
import type { BridgeRegistryEntry, HarnessDescriptor, HarnessEnvironment, HarnessId, ProcessIdentity, ProcessIdentityInput, SessionIdentity } from './contracts';
import { harnessLaunchSpec } from './harness-launch-spec';
import { createRPCSession, resumeRPCSession } from './rpc-session';
import { REGISTRY_DIR, getRegisteredSessionByNativeId, invalidateRegistryCache, pruneRegisteredSession, sameRegistryClaim, validRegistryClaimShape } from './bridge-session';
import { getPrimeDaemon } from './prime-daemon';
import type { PrimeAgentSummary, PrimeDaemon } from './prime-daemon';
import { ensurePrivateRoot, privateRootFor } from './private-sessions';
import { LifecycleInterruption, proveBridgeRegistryClaim, registryIdentity, routeSessionId, sameProcessIdentity } from './session-ownership';
import type { BeforeLifecycleAction } from './session-ownership';
import { formatModelRef, parseModelId } from './helper-models';
import type { ModelRef } from './helper-types';
import { dishDir } from './dish-store';
import { record } from './helper-values';
import { errorMessage, errorStatus } from './http-boundary';
import * as tmux from './tmux';

export interface HarnessLaunchTarget {
  type?: string;
  socket?: unknown;
  tmuxSession?: string | null;
  newTmuxSession?: string | null;
  windowName?: string | null;
}

export interface PilotSelectionOptions {
  model?: string | null;
  thinking?: string | null;
  cwd?: string | null;
}

/** HTTP pilot selection precedes routine-store validation; no field is trusted yet. */
export interface PilotValidationInput {
  model?: unknown;
  thinking?: unknown;
  cwd?: unknown;
}

export interface NewSessionLaunchOptions {
  model?: unknown;
  thinking?: unknown;
  cwd?: unknown;
  descriptor: HarnessDescriptor;
  name?: string | null;
  target?: HarnessLaunchTarget | null;
  /** Harness private root, outside fleet backups. */
  private?: boolean;
}

export interface ResumeSessionLaunchOptions extends PilotSelectionOptions {
  descriptor: HarnessDescriptor;
  name?: string | null;
  target?: HarnessLaunchTarget | null;
  sessionFile: string;
}

export interface RpcResumeOptions extends PilotSelectionOptions {
  sessionFile: string;
}

export interface RestartPaneOptions {
  sessionId: string;
  paneId: string;
  paneProcess: ProcessIdentityInput | null;
  spawn: tmux.SpawnPlacement;
  registry: BridgeRegistryEntry | null;
  beforeAction?: BeforeLifecycleAction | null;
}

export interface SpawnHarnessOptions {
  descriptor: HarnessDescriptor;
  target: HarnessLaunchTarget;
  args: readonly unknown[];
  cwd?: unknown;
  name?: string | null;
  hidden?: boolean;
  restartPane?: RestartPaneOptions | null;
}

export interface CleanupEvidence extends tmux.PaneTarget {
  knownProcesses: ProcessIdentity[];
  timeout: number;
}

export interface ResumeUncertainty extends tmux.PaneTarget {
  knownProcesses: ProcessIdentity[];
  detachedWorker?: true;
}

interface LaunchFailureDetails {
  error: unknown;
  status: number;
}

export type LaunchOutcome =
  | { kind: 'ready'; id: string }
  | (LaunchFailureDetails & { kind: 'fallback-permitted' })
  | (LaunchFailureDetails & { kind: 'fallback-forbidden' })
  | (LaunchFailureDetails & { kind: 'cleanup-incomplete'; cleanup: CleanupEvidence })
  | (LaunchFailureDetails & { kind: 'explicit-uncertain'; placement: ResumeUncertainty })
  | (LaunchFailureDetails & { kind: 'detached-replacement-uncertain'; placement: ResumeUncertainty })
  | { kind: 'interrupted'; error: LifecycleInterruption; status: number };

export interface SessionLaunchObservations {
  runHarnessModelCommand(descriptor: HarnessDescriptor, options: { cwd?: unknown }): Promise<unknown>;
}

export interface SessionLaunch {
  validateHarnessPilotSelection(descriptor: HarnessDescriptor, options: PilotValidationInput): Promise<void>;
  launchNewSession(options: NewSessionLaunchOptions): Promise<LaunchOutcome>;
  launchResumedSession(options: ResumeSessionLaunchOptions): Promise<LaunchOutcome>;
  resumeRpcSession(options: RpcResumeOptions): Promise<LaunchOutcome>;
  spawnHarnessInTmux(options: SpawnHarnessOptions): Promise<LaunchOutcome>;
}

export class LaunchError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

class BridgeSocketConfigError extends LaunchError {
  constructor(message: string) {
    super(`Invalid pi-dish bridge socket configuration: ${message}`, 500);
  }
}

export const HEADLESS_TMUX_SERVER = 'pi-dish';
/** Spawn-registration poll bounds; see the interval rule in performTmuxLaunch. */
const REGISTRY_POLL_MIN_MS = 20;
const REGISTRY_POLL_MAX_MS = 300;
const MAX_BRIDGE_SOCKET_PATH_BYTES = 103;
const BRIDGE_SOCKET_BASENAME = `${'0'.repeat(24)}.sock`;

function forbidden(error: unknown): LaunchOutcome {
  if (error instanceof LifecycleInterruption) return { kind: 'interrupted', error, status: errorStatus(error, 500) };
  return { kind: 'fallback-forbidden', error, status: errorStatus(error, 500) };
}

function unclassifiedTmuxFailure(descriptor: HarnessDescriptor, error: unknown): LaunchOutcome {
  if (error instanceof BridgeSocketConfigError || error instanceof LifecycleInterruption) return forbidden(error);
  // Only an unclassified launch exception permits the headless RPC fallback.
  return { kind: descriptor.rpcFallback ? 'fallback-permitted' : 'fallback-forbidden', error, status: errorStatus(error, 500) };
}

interface SpawnRegistration {
  entry: Record<string, unknown>;
  identity: SessionIdentity;
}

type SpawnTokenObservation = { kind: 'single'; registration: SpawnRegistration } | { kind: 'conflict' } | null;

function findSessionBySpawnToken(token: string, harnessId: HarnessId): SpawnTokenObservation {
  let files: string[];
  try { files = fs.readdirSync(REGISTRY_DIR); } catch { return null; }
  let found: SpawnRegistration | null = null;
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    try {
      const entry: unknown = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, name), 'utf8'));
      const identity = registryIdentity(entry);
      if (!record(entry) || entry.spawnToken !== token || !identity || identity.harnessId !== harnessId) continue;
      if (!validRegistryClaimShape(entry)) continue;
      if (found) return { kind: 'conflict' };
      found = { entry, identity };
    } catch {}
  }
  return found ? { kind: 'single', registration: found } : null;
}

function validateBridgeSocketConfig(env: HarnessEnvironment): void {
  const override = env.PI_DISH_SOCKET_DIR || null;
  if (override && !path.isAbsolute(override)) {
    throw new BridgeSocketConfigError('PI_DISH_SOCKET_DIR must be an absolute path');
  }
  const socketDir = override ? path.resolve(override) : path.join(env.HOME || os.homedir(), '.pi', 'dish', 'sockets');
  const socketPath = path.join(socketDir, BRIDGE_SOCKET_BASENAME);
  const bytes = Buffer.byteLength(socketPath);
  if (bytes > MAX_BRIDGE_SOCKET_PATH_BYTES) {
    const action = override
      ? 'Set PI_DISH_SOCKET_DIR to a shorter absolute directory.'
      : 'Set PI_DISH_SOCKET_DIR to a short absolute directory.';
    throw new BridgeSocketConfigError(`Unix socket path is ${bytes} bytes (maximum ${MAX_BRIDGE_SOCKET_PATH_BYTES}): ${socketPath}. ${action}`);
  }
  if (!fs.existsSync(socketDir)) return;
  let stat: fs.Stats;
  try { stat = fs.statSync(socketDir); } catch (error) {
    throw new BridgeSocketConfigError(`cannot inspect ${socketDir}: ${errorMessage(error)}`);
  }
  if (!stat.isDirectory()) {
    throw new BridgeSocketConfigError(`${override ? 'PI_DISH_SOCKET_DIR' : 'default socket path'} is not a directory: ${socketDir}`);
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new BridgeSocketConfigError(`${socketDir} is owned by uid ${stat.uid}, expected uid ${process.getuid()}`);
  }
  const mode = stat.mode & 0o777;
  if (mode === 0o700) return;
  if (override) {
    throw new BridgeSocketConfigError(`${socketDir} has mode ${mode.toString(8).padStart(4, '0')}, expected 0700. Choose or create a private PI_DISH_SOCKET_DIR; pi-dish will not change an existing override directory's permissions.`);
  }
  if (typeof process.getuid !== 'function') {
    throw new BridgeSocketConfigError(`cannot verify ownership before repairing the default socket directory ${socketDir} from mode ${mode.toString(8).padStart(4, '0')} to 0700`);
  }
  try { fs.chmodSync(socketDir, 0o700); } catch (error) {
    throw new BridgeSocketConfigError(`cannot repair the owned default socket directory ${socketDir} to mode 0700: ${errorMessage(error)}`);
  }
}

function materializeLaunchWrapper(descriptor: HarnessDescriptor, token: string): string | null {
  if (descriptor.spawnTokenMode !== 'wrapper') return null;
  if (!descriptor.wrapperEntrypoint) {
    throw new BridgeSocketConfigError(`${descriptor.label} uses wrapper token injection without a wrapper entrypoint`);
  }
  const dir = path.join(dishDir(), 'launch-wrappers');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.statSync(dir);
  if (!stat.isDirectory() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new BridgeSocketConfigError(`launch wrapper directory is not owned by this user: ${dir}`);
  }
  if ((stat.mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
  const wrapperPath = path.join(dir, `${descriptor.id}-${token}.ts`);
  // OMP rewrites bare host imports only in this wrapper's tree, so the imports must live here.
  // Each binding is a positional createHarnessBridge argument after the token; undefined when absent.
  const load = (specifier: string | undefined, member = '') =>
    specifier ? `(await import(${JSON.stringify(specifier)}))${member}` : '';
  const hostModules = descriptor.wrapperHostPackage ? [
    ['hostAgentSession', load(descriptor.wrapperHostPackage, '.AgentSession')],
    ['hostAuthModule', load(descriptor.wrapperAuthPackage)],
    ['hostUiControllerModule', load(descriptor.wrapperUiControllerModule)],
  ] : [];
  const hostImport = hostModules.flatMap(([name, expression]) =>
    expression ? [`let ${name};`, `try { ${name} = ${expression}; } catch {}`] : [`let ${name};`]);
  if (hostImport.length) hostImport.push('');
  const hostArgs = hostModules.map(([name]) => `, ${name}`).join('');
  const source = [
    '// Generated by pi-dish; retained for resident harness reload/recovery.',
    `import { createHarnessBridge } from ${JSON.stringify(descriptor.wrapperEntrypoint)};`,
    ...hostImport,
    `export default createHarnessBridge(${JSON.stringify(token)}${hostArgs});`,
    '',
  ].join('\n');
  fs.writeFileSync(wrapperPath, source, { mode: 0o600, flag: 'wx' });
  return wrapperPath;
}

function injectLaunchWrapper(descriptor: HarnessDescriptor, args: readonly unknown[], wrapperPath: string | null): readonly unknown[] {
  if (!wrapperPath) return args;
  const index = descriptor.wrapperEntrypoint === null ? -1 : args.indexOf(descriptor.wrapperEntrypoint);
  if (index < 0) throw new BridgeSocketConfigError(`${descriptor.label} launch args do not contain its wrapper entrypoint`);
  const injected = [...args];
  injected[index] = wrapperPath;
  return injected;
}

function discoveryBridgeInstalled(descriptor: HarnessDescriptor, env: HarnessEnvironment): boolean {
  if (!descriptor.wrapperEntrypoint || typeof descriptor.discoveryExtensionsDir !== 'function') return false;
  const bridgeDir = path.dirname(descriptor.wrapperEntrypoint);
  try {
    const installed = fs.realpathSync(path.join(descriptor.discoveryExtensionsDir(env), path.basename(bridgeDir)));
    return installed === fs.realpathSync(bridgeDir);
  } catch { return false; }
}

function stripLaunchWrapperArgs(descriptor: HarnessDescriptor, args: readonly unknown[]): unknown[] {
  const index = descriptor.wrapperEntrypoint === null ? -1 : args.indexOf(descriptor.wrapperEntrypoint);
  const flag = args[index - 1];
  if (index < 1 || typeof flag !== 'string' || !flag.startsWith('-')) {
    throw new BridgeSocketConfigError(`${descriptor.label} launch args do not contain its wrapper entrypoint flag`);
  }
  return [...args.slice(0, index - 1), ...args.slice(index + 1)];
}

export function cleanupProcesses(error: unknown): ProcessIdentity[] | null {
  if (!record(error) || !Array.isArray(error.remainingProcesses)) return null;
  return error.remainingProcesses.filter((value: unknown): value is ProcessIdentity =>
    record(value) && typeof value.pid === 'number' && typeof value.startTime === 'string');
}

/** realpath equality; never a bare prefix match. */
function samePath(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || !left || typeof right !== 'string' || !right) return false;
  try { return fs.realpathSync(left) === fs.realpathSync(right); }
  catch { return path.resolve(left) === path.resolve(right); }
}

function launchResumeFile(args: readonly unknown[]): string | null {
  for (let index = 0; index < args.length; index++) {
    const word = args[index];
    if (typeof word !== 'string') continue;
    if (word === '--resume') return typeof args[index + 1] === 'string' && args[index + 1] ? String(args[index + 1]) : null;
    if (word.startsWith('--resume=')) return word.slice('--resume='.length) || null;
  }
  return null;
}

function hasDaemonSocketArg(argv: readonly unknown[]): boolean {
  return argv.some(word => typeof word === 'string' && (word === '--daemon-socket' || word.startsWith('--daemon-socket=')));
}

interface PrimeLaunchContext {
  daemon: PrimeDaemon;
  /** Root ids that predate this launch; only new roots can belong to it. */
  snapshot: Set<string>;
}

type PrimeRootObservation = { kind: 'single'; summary: PrimeAgentSummary } | { kind: 'ambiguous'; count: number } | null;

/** Resume matches the transcript; a new session is the single new root in the launch cwd. */
async function waitForPrimeRoot(daemon: PrimeDaemon, { cwd, resumeFile, snapshot, timeout }: {
  cwd: string; resumeFile: string | null; snapshot: ReadonlySet<string>; timeout: number;
}): Promise<PrimeRootObservation> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const roots = await daemon.refresh();
    const matches = roots.filter(session => resumeFile
      ? samePath(session.summary.sessionFile, resumeFile)
      : !snapshot.has(session.activeSessionId) && samePath(session.summary.cwd, cwd));
    if (matches.length === 1) return { kind: 'single', summary: matches[0].summary };
    if (matches.length > 1) return { kind: 'ambiguous', count: matches.length };
    if (Date.now() >= deadline) return null;
    await delay(Math.min(200, Math.max(1, deadline - Date.now())));
  }
}

function sanitizeTmuxSessionName(rawName: string | null | undefined): string | null {
  if (!rawName) return null;
  const sanitized = String(rawName).replace(/[.:\s]+/g, '-').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 48);
  return sanitized || null;
}

async function generateHeadlessSessionName(socket: string, descriptor: HarnessDescriptor, preferredName: string | null | undefined): Promise<string> {
  const base = sanitizeTmuxSessionName(preferredName) || `${descriptor.id}-${crypto.randomBytes(4).toString('hex')}`;
  let candidate = base;
  let counter = 1;
  while (await tmux.hasSession(socket, candidate)) candidate = `${base}-${counter++}`;
  return candidate;
}

interface PilotModel extends ModelRef {
  id: string;
  provider: string;
  selector?: string | null;
}

function pilotModel(value: unknown): value is PilotModel {
  return record(value) && typeof value.id === 'string' && typeof value.provider === 'string'
    && (value.selector == null || typeof value.selector === 'string')
    && (value.thinking == null || (Array.isArray(value.thinking) && value.thinking.every(level => typeof level === 'string')));
}

function rpcModelRef(value: unknown): string | null {
  if (typeof value === 'string') return formatModelRef(value);
  if (!record(value)) return null;
  return formatModelRef({
    provider: value.provider ? String(value.provider) : undefined,
    id: value.id ? String(value.id) : undefined,
    modelId: value.modelId ? String(value.modelId) : undefined,
  });
}

export function createSessionLaunch(observations: SessionLaunchObservations): SessionLaunch {
  let headlessTmuxBroken = false;
  let headlessSpawnChain: Promise<void> = Promise.resolve();

  function headlessTmuxEnabled(descriptor: HarnessDescriptor): boolean {
    const mode = process.env.PI_DISH_HEADLESS || '';
    if (mode === 'rpc' && descriptor.rpcFallback) return false;
    if (!tmux.isTmuxAvailable()) return false;
    if (!descriptor.rpcFallback) return true;
    if (mode === 'tmux') return true;
    if (headlessTmuxBroken) return false;
    const home = os.homedir();
    return fs.existsSync(path.join(home, '.pi', 'agent', 'extensions', 'pi-dish-bridge'));
  }

  // Serialized so new-session identification never races another root pi-dish is starting.
  let primeLaunchChain: Promise<unknown> = Promise.resolve();

  function withPrimeLaunch<T>(action: () => Promise<T>): Promise<T> {
    const run = primeLaunchChain.then(action, action);
    primeLaunchChain = run.then(() => {}, () => {});
    return run;
  }

  async function performTmuxLaunch(options: SpawnHarnessOptions): Promise<LaunchOutcome> {
    if (options.descriptor.liveTransport !== 'prime-daemon') return runTmuxLaunch(options, null);
    const daemon = getPrimeDaemon();
    return withPrimeLaunch(() => runTmuxLaunch(options, { daemon, snapshot: new Set() }));
  }

  async function runTmuxLaunch({ descriptor, target, args, cwd, name, hidden, restartPane = null }: SpawnHarnessOptions, prime: PrimeLaunchContext | null): Promise<LaunchOutcome> {
    if (!tmux.isTmuxAvailable()) throw new LaunchError('tmux is not available on this host', 400);
    const socket = target.socket;
    if (!tmux.isSocketAllowed(socket)) throw new LaunchError('Invalid tmux socket', 400);
    if (!restartPane && !target.tmuxSession && !target.newTmuxSession) {
      throw new LaunchError('target needs tmuxSession or newTmuxSession', 400);
    }
    const spec = harnessLaunchSpec(descriptor);
    const env = { ...spec.env };
    // A persistent tmux server may carry stale HOME/socket settings; command
    // assignments win, including an explicitly empty socket override.
    if (!Object.hasOwn(env, 'HOME')) env.HOME = os.homedir();
    if (process.env.PI_DISH_URL) env.PI_DISH_URL = process.env.PI_DISH_URL;
    const launchCwd = cwd ? String(cwd) : env.HOME!;
    let spawnToken = '';
    let wrapperPath: string | null = null;
    let command: readonly unknown[];
    if (prime) {
      // Prime's TUI is a daemon client (no wrapper or spawn token); the explicit
      // socket keeps pi-dish on the same daemon as its client.
      command = [...spec.argv, ...(hasDaemonSocketArg(spec.argv) ? args : ['--daemon-socket', prime.daemon.socketPath, ...args])];
      for (const session of await prime.daemon.refresh()) prime.snapshot.add(session.activeSessionId);
    } else {
      if (!Object.hasOwn(env, 'PI_DISH_SOCKET_DIR')) env.PI_DISH_SOCKET_DIR = process.env.PI_DISH_SOCKET_DIR || '';
      validateBridgeSocketConfig(env);
      spawnToken = crypto.randomBytes(16).toString('hex');
      env.PI_DISH_SPAWN_TOKEN = spawnToken;
      const discoveryInstalled = discoveryBridgeInstalled(descriptor, { ...process.env, ...env });
      wrapperPath = discoveryInstalled ? null : materializeLaunchWrapper(descriptor, spawnToken);
      command = [...spec.argv, ...(discoveryInstalled
        ? stripLaunchWrapperArgs(descriptor, args)
        : injectLaunchWrapper(descriptor, args, wrapperPath))];
    }
    let paneId: string;
    let restartedPaneProcess: ProcessIdentity | null = null;
    try {
      if (restartPane) {
        paneId = restartPane.paneId;
        await tmux.respawnPane({
          socket, paneId, cwd: launchCwd, command, env,
          expectedProcess: restartPane.paneProcess,
          beforeAction: restartPane.beforeAction,
        });
        if (descriptor.closeMode === 'owned-agent') restartedPaneProcess = await tmux.paneProcessIdentity(socket, paneId);
        if (restartPane.registry) pruneRegisteredSession(restartPane.registry);
        tmux.removeSpawn(restartPane.sessionId, restartPane.spawn);
      } else {
        ({ paneId } = await tmux.spawnInTmux({
          socket,
          tmuxSession: target.tmuxSession,
          newTmuxSessionName: target.newTmuxSession,
          windowName: name || target.windowName || null,
          cwd: launchCwd,
          command,
          env,
        }));
      }
    } catch (error) {
      if (error instanceof LifecycleInterruption) throw error;
      const action = restartPane ? 'restart tmux pane' : 'open tmux window';
      throw new LaunchError(`Failed to ${action}: ${errorMessage(error)}`, 500);
    }

    const timeoutMs = Number(process.env.PI_DISH_SPAWN_TIMEOUT_MS) || 30000;
    const timeoutLabel = timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`;
    const deadline = Date.now() + timeoutMs;
    const timeoutReason = prime
      ? `${descriptor.label} did not appear in its daemon roster within ${timeoutLabel}`
      : `${descriptor.label} did not register within ${timeoutLabel}`;
    const resumeFile = prime ? launchResumeFile(args) : null;
    let registrationError: LaunchError | null = null;
    const acceptPrimeRoot = async (summary: PrimeAgentSummary): Promise<LaunchOutcome> => {
      const paneProcess = await tmux.paneProcessIdentity(socket, paneId);
      if (restartPane && (!restartedPaneProcess || !sameProcessIdentity(paneProcess, restartedPaneProcess))) {
        throw new Error('Prime client pane changed before replacement registration');
      }
      if (restartPane && (!resumeFile || !samePath(summary.sessionFile, resumeFile))) {
        throw new Error('Prime replacement did not resume the original transcript');
      }
      const routeId = routeSessionId('prime', summary.nativeSessionId);
      tmux.recordSpawn(routeId, {
        socket, paneId, paneProcess,
        primeAgent: {
          daemonSocket: prime!.daemon.socketPath,
          activeSessionId: summary.activeSessionId,
          workerInstanceId: summary.workerInstanceId,
          sessionFile: summary.sessionFile,
        },
      });
      return { kind: 'ready', id: routeId };
    };
    const acceptRegistration = async ({ entry, identity }: SpawnRegistration): Promise<LaunchOutcome> => {
      let accepted = entry;
      if (descriptor.id !== 'pi') {
        invalidateRegistryCache();
        const current = getRegisteredSessionByNativeId(identity.harnessId, identity.nativeSessionId);
        if (!current || !sameRegistryClaim(current, entry)) {
          throw new Error(`${descriptor.label} registry claim changed before socket identity could be proved`);
        }
        await proveBridgeRegistryClaim(current);
        accepted = current;
      }
      const acceptedIdentity = registryIdentity(accepted);
      if (!acceptedIdentity) throw new Error(`${descriptor.label} registry identity is unavailable`);
      const routeId = routeSessionId(acceptedIdentity.harnessId, acceptedIdentity.nativeSessionId);
      const paneProcess = await tmux.paneProcessIdentity(socket, paneId);
      tmux.recordSpawn(routeId, {
        socket, paneId, spawnToken,
        bridgeInstanceId: accepted.bridgeInstanceId || accepted.instanceId || null,
        paneProcess, wrapperPath,
      });
      invalidateRegistryCache();
      if (descriptor.id === 'pi') tmux.sendKeys(socket, paneId, '/dish-prime').catch(() => {});
      return { kind: 'ready', id: routeId };
    };
    if (prime) {
      const observation = await waitForPrimeRoot(prime.daemon, {
        cwd: launchCwd, resumeFile, snapshot: prime.snapshot, timeout: timeoutMs,
      });
      if (observation?.kind === 'ambiguous') {
        registrationError = new LaunchError(`${descriptor.label} produced ${observation.count} daemon roots for one launch; refusing to select one.`, 409);
      } else if (observation?.kind === 'single') {
        try { return await acceptPrimeRoot(observation.summary); } catch (error) {
          registrationError = new LaunchError(`${descriptor.label} daemon identity proof failed: ${errorMessage(error)}`, 500);
        }
      }
    } else {
      while (Date.now() < deadline) {
        const scanStartedAt = Date.now();
        const observation = findSessionBySpawnToken(spawnToken, descriptor.id);
        if (observation?.kind === 'conflict') {
          registrationError = new LaunchError(`${descriptor.label} produced multiple bridge registrations for one launch token; refusing to select one.`, 409);
          break;
        }
        if (observation?.kind === 'single') {
          try { return await acceptRegistration(observation.registration); } catch (error) {
            registrationError = new LaunchError(`${descriptor.label} bridge identity proof failed: ${errorMessage(error)}`, 500);
            break;
          }
        }
        // Poll cheap registrations promptly; pace expensive scans toward 300 ms.
        const interval = Math.min(REGISTRY_POLL_MAX_MS, Math.max(REGISTRY_POLL_MIN_MS, (Date.now() - scanStartedAt) * 20));
        await delay(Math.min(interval, Math.max(1, deadline - Date.now())));
      }
      // A registration arriving in the final sleep must win over timeout cleanup.
      const deadlineEntry = registrationError ? null : findSessionBySpawnToken(spawnToken, descriptor.id);
      if (deadlineEntry?.kind === 'conflict') {
        registrationError = new LaunchError(`${descriptor.label} produced multiple bridge registrations for one launch token; refusing to select one.`, 409);
      }
      if (!registrationError && deadlineEntry?.kind === 'single') {
        try { return await acceptRegistration(deadlineEntry.registration); } catch (error) {
          registrationError = new LaunchError(`${descriptor.label} bridge identity proof failed: ${errorMessage(error)}`, 500);
        }
      }
    }
    if (restartPane && descriptor.closeMode === 'owned-agent') {
      // A resident replacement can outlive its client; pane exit doesn't prove a second writer is safe.
      const error = new LaunchError(`${registrationError?.message || `${timeoutReason} — the tmux pane was left open for inspection; no second replacement was launched.`}`, registrationError?.status || 500);
      return { kind: 'detached-replacement-uncertain', error, status: error.status,
        placement: { socket, paneId, detachedWorker: true, knownProcesses: [] } };
    }
    // Hidden writers must be fully gone before an RPC fallback can be allowed.
    const shouldCleanup = hidden || !descriptor.rpcFallback || !!registrationError;
    if (shouldCleanup) {
      const cleanupTimeoutMs = Math.min(5000, Math.max(1000, timeoutMs));
      try { await tmux.killPaneAndWait(socket, paneId, { timeout: cleanupTimeoutMs }); } catch (cleanupError) {
        const message = registrationError
          ? `${registrationError.message}, and tmux cleanup failed: ${errorMessage(cleanupError)}`
          : descriptor.rpcFallback
            ? `${timeoutReason}, and hidden tmux cleanup failed; refusing to start an RPC fallback that could write the same session file: ${errorMessage(cleanupError)}`
            : `${timeoutReason}, and tmux cleanup failed: ${errorMessage(cleanupError)}`;
        const error = new LaunchError(message, 500);
        return { kind: 'cleanup-incomplete', error, status: error.status,
          cleanup: { socket, paneId, knownProcesses: cleanupProcesses(cleanupError) ?? [], timeout: cleanupTimeoutMs } };
      }
    }
    if (registrationError) return forbidden(registrationError);
    const wrapperHint = prime
      ? `Ensure the Prime daemon socket ${prime.daemon.socketPath} is reachable.`
      : descriptor.wrapperEntrypoint
        ? `Ensure ${descriptor.label} can load ${descriptor.wrapperEntrypoint}.`
        : 'Ensure the pi-dish-bridge extension is installed in Pi’s global extensions.';
    const error = new LaunchError(`${timeoutReason} — ${shouldCleanup ? 'the tmux window was closed' : 'the tmux window was left open for inspection'}. ${wrapperHint}`, 500);
    if (!shouldCleanup) {
      const state = await tmux.paneProcessState(socket, paneId);
      if (state.paneExists || state.knownProcesses.length) {
        return { kind: 'explicit-uncertain', error, status: error.status,
          placement: { socket, paneId, knownProcesses: state.knownProcesses } };
      }
    }
    return unclassifiedTmuxFailure(descriptor, error);
  }

  async function spawnHarnessInTmux(options: SpawnHarnessOptions): Promise<LaunchOutcome> {
    try { return await performTmuxLaunch(options); } catch (error) {
      return unclassifiedTmuxFailure(options.descriptor, error);
    }
  }

  function spawnHarnessHeadlessTmux(options: Omit<SpawnHarnessOptions, 'target' | 'hidden' | 'restartPane'>): Promise<LaunchOutcome> {
    // Name selection and session creation share one chain to avoid races.
    const run = headlessSpawnChain.then(async (): Promise<LaunchOutcome> => {
      try {
        fs.mkdirSync(tmux.tmuxTmpdir(), { recursive: true, mode: 0o700 });
        const socket = path.join(tmux.tmuxTmpdir(), HEADLESS_TMUX_SERVER);
        const sessionName = await generateHeadlessSessionName(socket, options.descriptor, options.name);
        return await spawnHarnessInTmux({ ...options, target: { socket, newTmuxSession: sessionName }, hidden: true });
      } catch (error) { return unclassifiedTmuxFailure(options.descriptor, error); }
    });
    headlessSpawnChain = run.then(() => {}, () => {});
    return run;
  }

  /** A fallback-permitted tmux failure retires headless tmux for this process and continues via RPC. */
  async function launchInTmuxOrRpc(
    options: Omit<SpawnHarnessOptions, 'hidden' | 'restartPane' | 'target'> & { target?: HarnessLaunchTarget | null },
    action: 'spawn' | 'resume',
    rpcFallback: () => Promise<LaunchOutcome>,
  ): Promise<LaunchOutcome> {
    const { target } = options;
    if (target?.type === 'tmux') return spawnHarnessInTmux({ ...options, target });
    if (headlessTmuxEnabled(options.descriptor)) {
      const outcome = await spawnHarnessHeadlessTmux(options);
      if (outcome.kind !== 'fallback-permitted') return outcome;
      headlessTmuxBroken = true;
      console.error(`Headless tmux ${action} failed — falling back to an RPC child:`, errorMessage(outcome.error));
    }
    if (!options.descriptor.rpcFallback) {
      return forbidden(new LaunchError(`${options.descriptor.label} requires tmux and does not support RPC fallback.`, 400));
    }
    return rpcFallback();
  }

  async function validateHarnessPilotSelection(descriptor: HarnessDescriptor, { model, thinking, cwd }: PilotValidationInput): Promise<void> {
    if (descriptor.id !== 'omp' || (!model && !thinking)) return;
    if (thinking && !model) throw new LaunchError('Choose an Oh My Pi model before overriding its thinking level.', 400);
    const models = await observations.runHarnessModelCommand(descriptor, { cwd });
    const selected: unknown = Array.isArray(models)
      ? models.find((entry: unknown) => pilotModel(entry) && (entry.selector === model || `${entry.provider}/${entry.id}` === model))
      : undefined;
    if (!pilotModel(selected)) throw new LaunchError(`Model ${model} is not available from Oh My Pi in this working directory.`, 400);
    if (thinking && !selected.thinking?.some(level => level === thinking)) {
      const valid = selected.thinking?.length ? selected.thinking.join(', ') : 'none';
      throw new LaunchError(`Thinking level ${thinking} is not valid for ${model}; valid levels: ${valid}.`, 400);
    }
  }

  async function launchNewSession({ descriptor, name, model, thinking, cwd, target, private: privateSession = false }: NewSessionLaunchOptions): Promise<LaunchOutcome> {
    try {
      // Downstream calls own malformed-cwd failures; these assertions don't validate cwd.
      if (cwd && (cwd as string).startsWith('~')) cwd = path.join(process.env.HOME!, (cwd as string).slice(1).replace(/^\//, ''));
      const sessionDir = privateSession ? privateRootFor(descriptor) : null;
      if (privateSession && !sessionDir) throw new LaunchError(`${descriptor.label} does not support private sessions.`, 400);
      if (sessionDir) ensurePrivateRoot(sessionDir);
      const args = descriptor.argv.new({
        model: model ?? undefined, thinking: thinking ?? undefined, ...(sessionDir ? { sessionDir } : {}),
      });
      return await launchInTmuxOrRpc({ descriptor, target, args, cwd, name }, 'spawn', async () => {
        const rpc = await createRPCSession({
          model: model ?? undefined, thinking: thinking ?? undefined, cwd: cwd ?? undefined,
          ...(sessionDir ? { sessionDir } : {}),
        });
        return { kind: 'ready', id: rpc.id };
      });
    } catch (error) { return forbidden(error); }
  }

  async function resumeRpcSession({ sessionFile, cwd, model, thinking }: RpcResumeOptions): Promise<LaunchOutcome> {
    try {
      const rpc = await resumeRPCSession(sessionFile, cwd || process.env.HOME);
      if (model && rpcModelRef(rpc.state?.model) !== model) {
        const parsed = parseModelId(model);
        if (!parsed.provider || !parsed.id) throw new Error('Saved model must include its provider');
        await rpc.setModel(parsed.provider, parsed.id);
      }
      if (thinking && rpc.state?.thinkingLevel !== thinking) await rpc.setThinkingLevel(thinking);
      return { kind: 'ready', id: rpc.id };
    } catch (error) { return forbidden(error); }
  }

  async function launchResumedSession({ descriptor, sessionFile, cwd, name, target, model, thinking }: ResumeSessionLaunchOptions): Promise<LaunchOutcome> {
    try {
      const args = descriptor.argv.resume({ file: sessionFile, model: model ?? undefined });
      if (thinking && (descriptor.id === 'pi' || descriptor.id === 'omp')) args.push('--thinking', thinking);
      return await launchInTmuxOrRpc({ descriptor, target, args, cwd, name }, 'resume',
        () => resumeRpcSession({ sessionFile, cwd, model, thinking }));
    } catch (error) { return forbidden(error); }
  }

  return { validateHarnessPilotSelection, launchNewSession, launchResumedSession, resumeRpcSession, spawnHarnessInTmux };
}
