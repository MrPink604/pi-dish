/**
 * pi sessions in tmux windows survive a server restart (an RPC child would
 * not). Servers are addressed by their $TMUX_TMPDIR socket; every tmux call is
 * execFile with argv and a timeout, never a shell string.
 */
import { execFile, execFileSync } from 'child_process';
import fs = require('fs');
import path = require('path');
import { setTimeout as delay } from 'timers/promises';
import type { ProcessIdentity, ProcessIdentityInput } from './contracts';
import { readStore, writeStore } from './dish-store';
import { processIdentity, processIdentityAlive } from './process-identity';
import { record } from './helper-values';

export interface PaneTarget {
  socket: string;
  paneId: string;
}

/** Location only: none of these fields establish process or pane ownership. */
export interface PaneLocation {
  tmuxSession: string;
  windowIndex: number;
  windowName: string;
}

export interface TmuxServer {
  socket: string;
  name: string;
  sessions: { name: string; windows: number; attached: boolean }[];
}

/** Values are interpolated as-is, including undefined. */
export type SpawnEnvironment = Readonly<Record<string, unknown>>;

interface PaneCommand {
  cwd?: unknown;
  command: readonly unknown[];
  env?: SpawnEnvironment | null;
}

export interface SpawnOptions extends PaneCommand {
  socket: string;
  tmuxSession?: string | null;
  newTmuxSessionName?: string | null;
  windowName?: string | null;
  /** Bind launch to one exact already-running server and never start a new one (-N). */
  expectedServer?: ProcessIdentity | null;
}

/** Raised when a launch bound to a specific tmux server finds that server dead or replaced. */
export class TmuxServerLostError extends Error {
  constructor(message: string, readonly beforeSpawn = false) {
    super(message);
    this.name = 'TmuxServerLostError';
  }
}

/** Async preparation returns the synchronous checker run adjacent to execFile. */
export interface RespawnOptions extends PaneTarget, PaneCommand {
  expectedProcess: ProcessIdentityInput | null;
  beforeAction?: (() => (() => undefined) | Promise<() => undefined>) | null;
}

/**
 * Persisted evidence, never live authority. Optional observations are kept
 * verbatim and uncoerced; consumers must narrow them before use.
 */
export interface SpawnPlacement extends PaneTarget, Record<string, unknown> {
  createdAt?: unknown;
  spawnToken?: unknown;
  bridgeInstanceId?: unknown;
  paneProcess?: unknown;
  wrapperPath?: unknown;
  /** Prime daemon transport: the root agent this pane's launch created or resumed. */
  primeAgent?: unknown;
}

/** Daemon owning a pi-dish-launched Prime root agent, plus the root/worker identity seen at registration. */
export interface PrimeAgentPlacement {
  daemonSocket: string;
  activeSessionId: string;
  workerInstanceId: string | null;
  sessionFile: string;
}

/** Persisted evidence only: callers re-read the live roster before acting on it. */
export function primeAgentPlacement(value: unknown): PrimeAgentPlacement | null {
  if (!record(value)) return null;
  const { daemonSocket, activeSessionId, sessionFile, workerInstanceId } = value;
  if (typeof daemonSocket !== 'string' || !daemonSocket) return null;
  if (typeof activeSessionId !== 'string' || !activeSessionId) return null;
  if (typeof sessionFile !== 'string' || !path.isAbsolute(sessionFile)) return null;
  if (workerInstanceId != null && typeof workerInstanceId !== 'string') return null;
  return { daemonSocket, activeSessionId, workerInstanceId: workerInstanceId || null, sessionFile };
}

export function spawnPrimeAgent(spawn: SpawnPlacement | null | undefined): PrimeAgentPlacement | null {
  return spawn ? primeAgentPlacement(spawn.primeAgent) : null;
}

export interface PaneProcessState {
  paneExists: boolean;
  knownProcesses: ProcessIdentity[];
}

export interface PaneProcessOptions {
  knownProcesses?: readonly ProcessIdentity[];
}

export interface PaneCleanupOptions extends PaneProcessOptions {
  timeout?: number;
  /** When set, refuse to kill the pane unless the socket's live tmux server birth matches. */
  expectedServer?: ProcessIdentity | null;
  /** When set, refuse to kill the pane unless the pane's live root process birth matches. */
  expectedPaneProcess?: ProcessIdentity | null;
}

export interface PaneCleanupError extends Error {
  remainingProcesses: ProcessIdentity[];
}

function cleanupError(error: unknown, remainingProcesses: ProcessIdentity[]): PaneCleanupError {
  return Object.assign(error instanceof Error ? error : new Error(String(error)), { remainingProcesses });
}

function runFile(file: string, args: readonly unknown[], timeout: number, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // No shell quoting: execFile owns argv coercion/rejection.
    execFile(file, args as readonly string[], { cwd, timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve(stdout);
    });
  });
}

const NO_SERVER_RE = /no server running|no such file or directory|connection refused|error connecting to/i;
const noServerListeners = new Set<(socket: string) => void>();
const headlessSpawnListeners = new Set<(sessionId: string, socket: string) => void>();

/** True when tmux rejected a command because no server listens on the target socket. */
export function isNoServerError(error: unknown): boolean {
  if (!record(error)) return false;
  const stderr = typeof error.stderr === 'string' ? error.stderr : '';
  const message = typeof error.message === 'string' ? error.message : '';
  return NO_SERVER_RE.test(stderr) || NO_SERVER_RE.test(message);
}

function isHeadlessSocket(socket: string): boolean {
  return path.resolve(socket) === path.resolve(headlessTmuxSocket());
}

function notifyHeadlessNoServer(socket: string): void {
  if (!noServerListeners.size || !isHeadlessSocket(socket)) return;
  queueMicrotask(() => {
    for (const listener of [...noServerListeners]) {
      try { listener(socket); } catch {}
    }
  });
}

function notifyHeadlessSpawn(sessionId: string, socket: string): void {
  if (!headlessSpawnListeners.size || !isHeadlessSocket(socket)) return;
  queueMicrotask(() => {
    for (const listener of [...headlessSpawnListeners]) {
      try { listener(sessionId, socket); } catch {}
    }
  });
}

/** Fires when a tmux command against pi-dish's headless socket fails with no server running. */
export function onHeadlessNoServer(listener: (socket: string) => void): () => void {
  noServerListeners.add(listener);
  return () => { noServerListeners.delete(listener); };
}

/** Fires after a spawn placement is recorded on pi-dish's headless socket. */
export function onHeadlessSpawn(listener: (sessionId: string, socket: string) => void): () => void {
  headlessSpawnListeners.add(listener);
  return () => { headlessSpawnListeners.delete(listener); };
}

function runTmux(args: readonly unknown[], { timeout = 3000 } = {}): Promise<string> {
  return runFile('tmux', args, timeout);
}

/** Every command names one server socket; the format/query calls share one timeout. */
async function runTmuxOn(socket: string, args: readonly unknown[], { notifyNoServer = true } = {}): Promise<string> {
  try {
    return await runTmux(['-S', socket, ...args], { timeout: 2000 });
  } catch (error) {
    if (notifyNoServer && isNoServerError(error)) notifyHeadlessNoServer(socket);
    throw error;
  }
}

async function tmuxServerRunning(socket: string): Promise<boolean> {
  return (await serverPid(socket)) !== null;
}

function executableOnPath(name: string, searchPath: string | undefined): string | null {
  for (const dir of (searchPath || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  return null;
}

/**
 * Argv prefix that starts the tmux server for `socket` in its own transient
 * user scope. A tmux server stays in the cgroup of whatever started it, and
 * tmux puts each pane in a scope PartOf= that unit; started from a pi-dish
 * pane, agent panes would stop whenever pi-dish.service stops. Null - start
 * tmux directly - without a reachable user systemd manager, without
 * systemd-run, or with PI_DISH_TMUX_SCOPE=0.
 */
export function tmuxServerScopeArgv(socket: string, env: NodeJS.ProcessEnv = process.env): string[] | null {
  if (env.PI_DISH_TMUX_SCOPE === '0' || !env.XDG_RUNTIME_DIR) return null;
  try {
    if (!fs.statSync(path.join(env.XDG_RUNTIME_DIR, 'systemd', 'private')).isSocket()) return null;
  } catch { return null; }
  const systemdRun = executableOnPath('systemd-run', env.PATH);
  if (!systemdRun) return null;
  const label = path.basename(socket).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'server';
  const unit = `pi-dish-tmux-${label}-${process.pid}-${Date.now().toString(36)}.scope`;
  return [systemdRun, '--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', 'tmux'];
}

/**
 * pi-dish's own agent server reads no tmux.conf: plugins such as
 * tmux-resurrect/continuum would restore the user's layout into it and can
 * overwrite the first agent pane. Instead it sets what agent panes and the
 * terminal viewer rely on; -q skips options an older tmux lacks.
 */
const HEADLESS_SERVER_OPTIONS: readonly (readonly string[])[] = [
  // Viewer scrollback; a pane takes the limit in force when it is created.
  ['set-option', '-gq', 'history-limit', '50000'],
  // The wheel scrolls tmux instead of reaching the TUI as arrow keys.
  ['set-option', '-gq', 'mouse', 'on'],
  ['set-option', '-gq', 'status', 'on'],
  // Esc reaches the TUI promptly; tmux before 3.5 waits 500 ms.
  ['set-option', '-sq', 'escape-time', '10'],
  ['set-option', '-gq', 'default-terminal', 'tmux-256color'],
  // Truecolor and modified keys (Shift+Enter) through xterm-like viewers.
  ['set-option', '-saq', 'terminal-features', 'xterm*:RGB:extkeys'],
  ['set-option', '-sq', 'extended-keys', 'on'],
  ['set-option', '-sq', 'extended-keys-format', 'csi-u'],
  ['set-option', '-gq', 'focus-events', 'on'],
  // Keep pi-dish's server alive when its last session exits on its own so a
  // single exited session is never confused with the whole server dying.
  ['set-option', '-sq', 'exit-empty', 'off'],
];

/**
 * Run tmux `command` on `socket`, which may start its server. Only the cold
 * path below creates a server: in its own scope, and for pi-dish's server
 * without the user's tmux.conf.
 */
async function runTmuxStartingServer(socket: string, command: readonly unknown[], timeout: number): Promise<string> {
  const own = path.resolve(socket) === path.resolve(headlessTmuxSocket());
  const target = ['-S', socket, ...(own ? ['-f', '/dev/null'] : [])];
  if (await tmuxServerRunning(socket)) {
    // -N: a server that died since the check must not be replaced here.
    try {
      return await runFile('tmux', ['-N', ...target, ...command], timeout, '/');
    } catch (error) {
      if (isNoServerError(error)) notifyHeadlessNoServer(socket);
      if (await tmuxServerRunning(socket)) throw error;
    }
  }
  const args = [...target, ...(own ? HEADLESS_SERVER_OPTIONS.flatMap(option => [...option, ';']) : []), ...command];
  const scope = tmuxServerScopeArgv(socket);
  // tmux keeps its launching client's cwd for the lifetime of the server.
  // A staged update can unlink pi-dish's cwd; -c sets the pane cwd, not the server's.
  if (scope) {
    try {
      return await runFile(scope[0], [...scope.slice(1), ...args], timeout, '/');
    } catch (error) {
      // A running server means tmux itself ran and failed. Otherwise the scope
      // could not be created (bus refused, policy): start tmux unscoped.
      if (await tmuxServerRunning(socket)) throw error;
      console.error(`tmux: no systemd scope for ${socket}, starting the server unscoped:`, error instanceof Error ? error.message : error);
    }
  }
  return runFile('tmux', args, timeout, '/');
}

let tmuxAvailable: boolean | null = null;
export function isTmuxAvailable(): boolean {
  if (tmuxAvailable !== null) return tmuxAvailable;
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore', timeout: 2000 });
    tmuxAvailable = true;
  } catch {
    tmuxAvailable = false;
  }
  return tmuxAvailable;
}

export function tmuxTmpdir(): string {
  if (process.env.TMUX_TMPDIR) return process.env.TMUX_TMPDIR;
  const uid = typeof process.getuid === 'function' ? process.getuid() : '';
  return `/tmp/tmux-${uid}`;
}

/** pi-dish's own server for agents launched without a target. */
export function headlessTmuxSocket(): string {
  return path.join(tmuxTmpdir(), 'pi-dish');
}

/** Candidate tmux server sockets under the tmpdir; stale socket files are left for tmux to reject. */
function socketPaths(): { socket: string; name: string }[] {
  const dir = tmuxTmpdir();
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.flatMap((name) => {
    const socket = path.join(dir, name);
    try {
      return fs.statSync(socket).isSocket() ? [{ socket, name }] : [];
    } catch {
      return [];
    }
  });
}

export async function listServers(): Promise<TmuxServer[]> {
  if (!isTmuxAvailable()) return [];
  const servers: TmuxServer[] = [];
  for (const { socket, name } of socketPaths()) {
    let out;
    try {
      // ':' is the target-spec separator; unlike a tab, tmux does not sanitize it.
      out = await runTmuxOn(socket, ['list-sessions', '-F', '#{session_name}:#{session_windows}:#{session_attached}']);
    } catch {
      continue; // stale socket / dead server
    }
    const sessions = out.split('\n').filter(Boolean).map((line) => {
      const [sname, windows, attached] = line.split(':');
      return { name: sname, windows: Number(windows) || 0, attached: attached === '1' };
    });
    servers.push({ socket, name, sessions });
  }
  return servers;
}

// A LAN client must not pass an arbitrary -S path: allow only the directory
// listServers enumerates. The caller checks this before launching.
export function isSocketAllowed(socket: unknown): socket is string {
  if (typeof socket !== 'string' || !socket) return false;
  return path.dirname(path.resolve(socket)) === path.resolve(tmuxTmpdir());
}

function sameServerIdentity(left: ProcessIdentity | null, right: ProcessIdentity): boolean {
  return !!left && left.pid === right.pid && String(left.startTime) === String(right.startTime);
}

/** Open a detached window or session with child argv and tmux -e KEY=VALUE flags. */
export async function spawnInTmux({ socket, tmuxSession, newTmuxSessionName, windowName, cwd, command, env, expectedServer = null }: SpawnOptions): Promise<{ paneId: string }> {
  if (!Array.isArray(command) || !command.length) throw new Error('command argv required');
  const envFlags: string[] = [];
  for (const [k, v] of Object.entries(env || {})) envFlags.push('-e', `${k}=${v}`);

  let args: unknown[];
  if (newTmuxSessionName) {
    args = ['new-session', '-d', '-s', newTmuxSessionName];
    if (windowName) args.push('-n', windowName);
  } else if (tmuxSession) {
    // Do not steal the current window from an attached user.
    args = ['new-window', '-d', '-t', tmuxSession];
    if (windowName) args.push('-n', windowName);
  } else {
    throw new Error('tmuxSession or newTmuxSessionName required');
  }
  if (newTmuxSessionName) args.push('-c', path.resolve(String(cwd || '.')));
  else if (cwd) args.push('-c', cwd);
  args.push(...envFlags, '-P', '-F', '#{pane_id}', '--', ...command);

  if (expectedServer) {
    const current = await serverIdentity(socket);
    if (!sameServerIdentity(current, expectedServer)) {
      if (!current) notifyHeadlessNoServer(socket);
      throw new TmuxServerLostError(`expected tmux server pid ${expectedServer.pid} is no longer running`, true);
    }
    let out: string;
    try {
      // -N: a launch bound to one replacement server must never start a third server.
      out = await runFile('tmux', ['-N', '-S', socket, ...args], 5000, '/');
    } catch (error) {
      if (isNoServerError(error)) {
        notifyHeadlessNoServer(socket);
        throw new TmuxServerLostError(`expected tmux server pid ${expectedServer.pid} died before launch`, true);
      }
      if (!sameServerIdentity(await serverIdentity(socket), expectedServer)) {
        throw new TmuxServerLostError(`expected tmux server pid ${expectedServer.pid} died during launch`, true);
      }
      throw error;
    }
    const paneId = out.trim();
    const after = await serverIdentity(socket);
    if (!sameServerIdentity(after, expectedServer)) {
      if (!after) notifyHeadlessNoServer(socket);
      throw new TmuxServerLostError(`expected tmux server pid ${expectedServer.pid} was lost during launch`, false);
    }
    return { paneId };
  }

  const out = newTmuxSessionName
    ? await runTmuxStartingServer(socket, args, 5000)
    : await runTmux(['-S', socket, ...args], { timeout: 5000 }).catch(error => {
      if (isNoServerError(error)) notifyHeadlessNoServer(socket);
      throw error;
    });
  return { paneId: out.trim() };
}

/** Replace only the exact pane-root birth authorized by the caller. */
export async function respawnPane({ socket, paneId, cwd, command, env, expectedProcess, beforeAction = null }: RespawnOptions): Promise<{ paneId: string }> {
  if (!Array.isArray(command) || !command.length) throw new Error('command argv required');
  const current = await paneProcessIdentity(socket, paneId);
  if (!current || !expectedProcess
      || current.pid !== expectedProcess.pid
      || String(current.startTime) !== String(expectedProcess.startTime)) {
    throw new Error(`tmux pane ${paneId} process changed before restart`);
  }
  const args: unknown[] = ['-S', socket, 'respawn-pane', '-k', '-t', paneId];
  if (cwd) args.push('-c', cwd);
  for (const [key, value] of Object.entries(env || {})) args.push('-e', `${key}=${value}`);
  args.push('--', ...command);
  if (beforeAction) {
    const finalCheck = await beforeAction();
    finalCheck();
  }
  try {
    await runTmux(args, { timeout: 5000 });
  } catch (error) {
    if (isNoServerError(error)) notifyHeadlessNoServer(socket);
    throw error;
  }
  return { paneId };
}

export async function sendKeys(socket: string, paneId: string, text: string): Promise<void> {
  await runTmuxOn(socket, ['send-keys', '-t', paneId, text, 'Enter']);
}

// One chord, no Enter/literal flag: cannot land in a TUI's unsent composer draft.
export async function sendKey(socket: string, paneId: string, key: string): Promise<void> {
  await runTmuxOn(socket, ['send-keys', '-t', paneId, key]);
}

export async function renameWindow(socket: string | null | undefined, target: string | null | undefined, name: unknown): Promise<void> {
  if (!socket || !target || !name) return;
  const sanitized = String(name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  if (!sanitized) return;
  const sessionSafe = sanitized.replace(/[.:\s]+/g, '-').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 48);
  try {
    await runTmuxOn(socket, ['rename-window', '-t', target, sanitized]);
    await runTmuxOn(socket, ['select-pane', '-t', target, '-T', sanitized]);
    if (sessionSafe) {
      await runTmuxOn(socket, ['rename-session', '-t', target, sessionSafe]).catch(() => {});
    }
  } catch {}
}

// '=' means exact session-name match, not tmux's ordinary prefix match.
export async function hasSession(socket: string, name: string): Promise<boolean> {
  try {
    await runTmuxOn(socket, ['has-session', '-t', `=${name}`]);
    return true;
  } catch {
    return false;
  }
}

export async function killPane(socket: string, paneId: string): Promise<void> {
  await runTmuxOn(socket, ['kill-pane', '-t', paneId]);
}

/** One formatted field of a pane; null when tmux cannot answer (missing pane, dead socket). */
async function paneField(socket: string, paneId: string, format: string): Promise<string | null> {
  if (!socket || !paneId) return null;
  try {
    const out = await runTmuxOn(socket, ['display-message', '-p', '-t', paneId, format]);
    return out.trim();
  } catch {
    return null;
  }
}

async function paneProcessId(socket: string, paneId: string): Promise<number | null> {
  const pid = Number(await paneField(socket, paneId, '#{pane_pid}'));
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

/** Pane anchor process (null when unreadable) and whether any pane answers at all. */
async function paneAnchor(socket: string, paneId: string): Promise<{ pid: number | null; exists: boolean }> {
  const pid = await paneProcessId(socket, paneId);
  return { pid, exists: pid !== null || await paneExists(socket, paneId) };
}

/** The pane's process tree plus caller-known descendants, keyed by exact birth identity. */
function captureProcesses(pid: number | null, knownProcesses: readonly ProcessIdentity[]): Map<string, ProcessIdentity> {
  const tracked = new Map<string, ProcessIdentity>();
  for (const process of [...knownProcesses, ...(pid ? processTree(pid) : [])]) {
    if (process?.pid && process?.startTime) tracked.set(`${process.pid}:${process.startTime}`, process);
  }
  return tracked;
}

function processTree(rootPid: number): ProcessIdentity[] {
  const children = new Map<number, number[]>();
  try {
    for (const name of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
        const match = status.match(/^PPid:\s*(\d+)/m);
        if (!match) continue;
        const ppid = Number(match[1]);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid)!.push(Number(name));
      } catch {}
    }
  } catch {
    const root = processIdentity(rootPid);
    return root ? [root] : [];
  }
  const pids = [rootPid];
  for (let i = 0; i < pids.length; i++) {
    pids.push(...(children.get(pids[i]) || []));
  }
  return pids.map(processIdentity).filter((identity): identity is ProcessIdentity => identity !== null);
}

/**
 * Read-only snapshot. Keep known exact descendants observable after the root
 * exits and they are reparented; never mistake PID reuse for the old writer.
 */
export async function paneProcessState(socket: string, paneId: string, { knownProcesses = [] }: PaneProcessOptions = {}): Promise<PaneProcessState> {
  const { pid, exists } = await paneAnchor(socket, paneId);
  return {
    paneExists: exists,
    knownProcesses: [...captureProcesses(pid, knownProcesses).values()].filter(processIdentityAlive),
  };
}

export async function paneProcessIdentity(socket: string, paneId: string): Promise<ProcessIdentity | null> {
  const pid = await paneProcessId(socket, paneId);
  return pid ? processIdentity(pid) : null;
}

/**
 * Kill the pane, then wait for both tmux and its captured process tree to exit.
 * Hidden-session fallback cannot leave two processes writing the same JSONL.
 */
export async function killPaneAndWait(
  socket: string,
  paneId: string,
  { timeout = 5000, knownProcesses = [], expectedServer = null, expectedPaneProcess = null }: PaneCleanupOptions = {},
): Promise<void> {
  const { pid, exists } = await paneAnchor(socket, paneId);
  if (!pid && exists) {
    throw cleanupError(new Error(`could not identify process for tmux pane ${paneId}`), knownProcesses.filter(processIdentityAlive));
  }
  if (pid) {
    if (expectedServer && !sameServerIdentity(await serverIdentity(socket), expectedServer)) {
      throw cleanupError(
        new Error(`refusing to kill tmux pane ${paneId}: tmux server identity changed`),
        knownProcesses.filter(processIdentityAlive),
      );
    }
    if (expectedPaneProcess) {
      const livePaneProc = processIdentity(pid);
      if (!livePaneProc || livePaneProc.pid !== expectedPaneProcess.pid || livePaneProc.startTime !== expectedPaneProcess.startTime) {
        throw cleanupError(
          new Error(`refusing to kill tmux pane ${paneId}: pane process identity changed`),
          knownProcesses.filter(processIdentityAlive),
        );
      }
    }
  }
  // Capture descendants before tmux closes the pane and reparents them. A
  // wrapper may be the root while its child is the actual JSONL writer.
  const tracked = captureProcesses(pid, knownProcesses);
  const processesStillAlive = () => [...tracked.values()].filter(processIdentityAlive);

  if (pid) {
    try {
      await killPane(socket, paneId);
    } catch (error) {
      // A pane can exit between the query and kill; only the same liveness
      // checks below can establish successful cleanup after that error.
      const remainingProcesses = processesStillAlive();
      if (await paneExists(socket, paneId) || remainingProcesses.length) {
        throw cleanupError(error, remainingProcesses);
      }
      return;
    }
  }

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!await paneExists(socket, paneId) && !processesStillAlive().length) return;
    await delay(100);
  }
  const paneRemains = await paneExists(socket, paneId);
  const liveProcesses = processesStillAlive();
  const ids = liveProcesses.map((process) => `${process.pid}@${process.startTime}`);
  const err = new Error(`tmux pane ${paneId} cleanup did not complete (${paneRemains ? 'pane still exists' : 'pane gone'}, ${ids.length ? `processes still alive: ${ids.join(', ')}` : 'processes gone'})`);
  throw cleanupError(err, liveProcesses);
}

/** Human-facing location, not process ownership. Window names can contain ':'. */
export async function paneLocation(socket: string, paneId: string): Promise<PaneLocation | null> {
  // Missing panes sometimes succeed with empty formatted fields.
  const out = await paneField(socket, paneId, '#{session_name}:#{window_index}:#{window_name}');
  if (out === null) return null;
  const parts = out.split(':');
  if (parts.length < 3 || !parts[0]) return null;
  return {
    tmuxSession: parts[0],
    windowIndex: Number(parts[1]),
    windowName: parts.slice(2).join(':'),
  };
}

/**
 * Weak location backstop for old/stale registry stamps, not ownership proof.
 * Scan allowed sockets and walk at most 20 parents to find the containing pane.
 */
export async function findPaneByPid(pid: number | string | null | undefined): Promise<(PaneTarget & PaneLocation) | null> {
  if (!pid || !isTmuxAvailable()) return null;
  const byPanePid = new Map<number, PaneTarget & PaneLocation>();
  for (const { socket } of socketPaths()) {
    let out;
    try {
      out = await runTmuxOn(socket, ['list-panes', '-a', '-F', '#{pane_pid}:#{pane_id}:#{session_name}:#{window_index}:#{window_name}']);
    } catch {
      continue; // stale socket / dead server
    }
    for (const line of out.split('\n')) {
      if (!line) continue;
      const parts = line.split(':');
      if (parts.length < 5) continue;
      byPanePid.set(Number(parts[0]), {
        socket,
        paneId: parts[1],
        tmuxSession: parts[2],
        windowIndex: Number(parts[3]),
        windowName: parts.slice(4).join(':'),
      });
    }
  }
  if (!byPanePid.size) return null;
  let p = Number(pid);
  for (let hops = 0; hops < 20 && Number.isFinite(p) && p > 1; hops++) {
    const pane = byPanePid.get(p);
    if (pane) return pane;
    p = parentPid(p);
  }
  return null;
}

// Linux /proc first, ps fallback. 0 ends the ancestry walk.
function parentPid(pid: number): number {
  try {
    const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s*(\d+)/m);
    if (m) return Number(m[1]);
  } catch {}
  try {
    return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim()) || 0;
  } catch {
    return 0;
  }
}

export async function paneExists(socket: string, paneId: string): Promise<boolean> {
  // Some tmux versions return success but empty fields for missing panes.
  return !!(await paneField(socket, paneId, '#{pane_id}'));
}

export interface LiveTmuxPane {
  paneId: string;
  panePid: number | null;
  dead: boolean;
  paneProcess: ProcessIdentity | null;
}

export interface TmuxServerSnapshot {
  pid: number;
  server: ProcessIdentity;
  panes: Map<string, LiveTmuxPane>;
}

/** PID of the server answering on `socket`; null when none answers. Never starts a server. */
export async function serverPid(socket: string): Promise<number | null> {
  try {
    const pid = Number((await runTmux(['-N', '-S', socket, 'display-message', '-p', '#{pid}'], { timeout: 2000 })).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Process identity of the server answering on `socket`; null when none answers. Never starts a server. */
export async function serverIdentity(socket: string): Promise<ProcessIdentity | null> {
  const pid = await serverPid(socket);
  return pid !== null ? processIdentity(pid) : null;
}

/**
 * Single-command snapshot of a running tmux server and its panes. Uses -N so
 * it never starts a server; handles an empty server (exit-empty off) by
 * falling back to serverPid when list-panes reports "no current target".
 */
export async function inspectServer(socket: string): Promise<TmuxServerSnapshot | null> {
  try {
    const out = await runTmux(
      ['-N', '-S', socket, 'list-panes', '-a', '-F', '#{pid}\t#{pane_id}\t#{pane_pid}\t#{pane_dead}'],
      { timeout: 2000 },
    );
    let pid: number | null = null;
    const panes = new Map<string, LiveTmuxPane>();
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [rawServerPid, paneId, rawPanePid, rawDead] = line.split('\t');
      const parsedServerPid = Number(rawServerPid);
      if (pid === null && Number.isInteger(parsedServerPid) && parsedServerPid > 0) pid = parsedServerPid;
      if (!paneId) continue;
      const parsedPanePid = Number(rawPanePid);
      const validPanePid = Number.isInteger(parsedPanePid) && parsedPanePid > 1 ? parsedPanePid : null;
      const dead = rawDead === '1';
      panes.set(paneId, {
        paneId,
        panePid: validPanePid,
        dead,
        paneProcess: !dead && validPanePid ? processIdentity(validPanePid) : null,
      });
    }
    if (pid === null) pid = await serverPid(socket);
    const server = pid !== null ? processIdentity(pid) : null;
    return server ? { pid: server.pid, server, panes } : null;
  } catch (error) {
    const stderr = record(error) && typeof error.stderr === 'string' ? error.stderr : '';
    if (/no current target|no sessions/i.test(stderr)) {
      const pid = await serverPid(socket);
      const server = pid !== null ? processIdentity(pid) : null;
      return server ? { pid: server.pid, server, panes: new Map() } : null;
    }
    return null;
  }
}

/** Applies exit-empty off to an already-running headless server without ever starting one. */
export async function configureHeadlessServer(socket = headlessTmuxSocket()): Promise<boolean> {
  if (!isHeadlessSocket(socket)) return false;
  try {
    await runTmux(['-N', '-S', socket, 'set-option', '-sq', 'exit-empty', 'off'], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures pi-dish's headless tmux server is running using the same flags
 * (-f /dev/null, HEADLESS_SERVER_OPTIONS, transient systemd scope) as
 * spawnInTmux, and -N when a server is already running.
 */
export async function ensureHeadlessServer(socket = headlessTmuxSocket()): Promise<ProcessIdentity | null> {
  fs.mkdirSync(path.dirname(socket), { recursive: true, mode: 0o700 });
  await runTmuxStartingServer(socket, ['start-server'], 5000);
  return serverIdentity(socket);
}

/**
 * Clients attached to the pane's session, including grouped viewer sessions.
 * Null (unreadable) means "possibly watched", never "nobody is looking".
 */
export async function paneAttachedClients(socket: string, paneId: string): Promise<number | null> {
  const out = await paneField(socket, paneId, '#{session_attached} #{session_group_attached}');
  if (out === null) return null;
  const counts = out.split(/\s+/).filter(Boolean).map(Number);
  if (!counts.length || counts.some(count => !Number.isInteger(count) || count < 0)) return null;
  return Math.max(...counts);
}

/**
 * Viewers get a throwaway grouped session (own current window, destroyed on
 * detach) so the desktop client's focus is not stolen. -N: a viewer arriving
 * after the server died must not start a replacement that reads tmux.conf.
 */
export async function attachPaneArgv(socket: string, paneId: string): Promise<string[] | null> {
  const loc = await paneLocation(socket, paneId);
  if (!loc) return null;
  const view = `dish-view-${Math.random().toString(36).slice(2, 8)}`;
  return [
    'tmux', '-N', '-S', socket, 'new-session', '-t', `=${loc.tmuxSession}`, '-s', view, ';',
    'set-option', 'destroy-unattached', 'on', ';',
    'select-window', '-t', paneId, ';',
    'select-pane', '-t', paneId,
  ];
}

export async function getPrefixKey(socket: string): Promise<string | null> {
  try {
    const out = await runTmuxOn(socket, ['show-options', '-g', 'prefix']);
    const m = out.trim().match(/^prefix\s+(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Lists environment variable names starting with `prefix` in the tmux server
 * global environment (and optional target session environment). Uses `-N` so it
 * never starts a server.
 */
export async function environmentNamesWithPrefix(
  socket: string,
  prefix: string,
  tmuxSession?: string | null,
): Promise<string[]> {
  const names = new Set<string>();
  const queries: string[][] = [['show-environment', '-g']];
  if (tmuxSession) queries.push(['show-environment', '-t', `=${tmuxSession}`]);
  for (const args of queries) {
    try {
      const out = await runTmux(['-N', '-S', socket, ...args], { timeout: 2000 });
      for (const rawLine of out.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('-')) continue;
        const eq = line.indexOf('=');
        const key = eq >= 0 ? line.slice(0, eq) : line;
        if (key.startsWith(prefix) && ENV_VAR_NAME_RE.test(key)) {
          names.add(key);
        }
      }
    } catch {
      // Server or session does not exist yet.
    }
  }
  return [...names];
}

const SPAWNS_STORE = 'tmux-spawns.json';

function isPlacement(value: unknown): value is SpawnPlacement {
  return record(value) && typeof value.socket === 'string' && typeof value.paneId === 'string';
}

/** Persisted placements by route id. Evidence only: callers re-read live state before acting. */
export function listSpawns(): Record<string, SpawnPlacement> {
  const out: Record<string, SpawnPlacement> = {};
  for (const [sessionId, value] of Object.entries(readStore(SPAWNS_STORE))) {
    if (isPlacement(value)) out[sessionId] = value;
  }
  return out;
}

function samePrimeAgentEvidence(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true;
  const a = primeAgentPlacement(left), b = primeAgentPlacement(right);
  return !!a && !!b
    && a.daemonSocket === b.daemonSocket
    && a.activeSessionId === b.activeSessionId
    && a.workerInstanceId === b.workerInstanceId
    && a.sessionFile === b.sessionFile;
}

export function recordSpawn(sessionId: string, { socket, paneId, spawnToken, bridgeInstanceId, paneProcess, wrapperPath, primeAgent }: PaneTarget & {
  spawnToken?: unknown;
  bridgeInstanceId?: unknown;
  paneProcess?: ProcessIdentityInput | null;
  wrapperPath?: unknown;
  primeAgent?: unknown;
}): void {
  const spawns = readStore(SPAWNS_STORE);
  spawns[sessionId] = {
    socket,
    paneId,
    createdAt: Date.now(),
    ...(spawnToken ? { spawnToken } : {}),
    ...(bridgeInstanceId ? { bridgeInstanceId } : {}),
    ...(paneProcess?.pid && paneProcess?.startTime ? { paneProcess } : {}),
    ...(wrapperPath ? { wrapperPath } : {}),
    ...(primeAgent ? { primeAgent } : {}),
  };
  writeStore(SPAWNS_STORE, spawns);
  notifyHeadlessSpawn(sessionId, socket);
}

export function getSpawn(sessionId: string): SpawnPlacement | null {
  const value = readStore(SPAWNS_STORE)[sessionId];
  return isPlacement(value) ? value : null;
}

function sameSpawnRecord(left: unknown, right: unknown): boolean {
  if (!record(left) || !record(right)) return false;
  const leftProcess = record(left.paneProcess) ? left.paneProcess : null;
  const rightProcess = record(right.paneProcess) ? right.paneProcess : null;
  return left.socket === right.socket
    && left.paneId === right.paneId
    && left.createdAt === right.createdAt
    && (left.spawnToken || null) === (right.spawnToken || null)
    && (left.bridgeInstanceId || null) === (right.bridgeInstanceId || null)
    && (leftProcess?.pid || null) === (rightProcess?.pid || null)
    && (leftProcess?.startTime || null) === (rightProcess?.startTime || null)
    && samePrimeAgentEvidence(left.primeAgent, right.primeAgent);
}

export function removeSpawn(sessionId: string, expected: SpawnPlacement | null = null): boolean {
  const spawns = readStore(SPAWNS_STORE);
  if (!Object.prototype.hasOwnProperty.call(spawns, sessionId)) return false;
  if (expected && !sameSpawnRecord(spawns[sessionId], expected)) return false;
  delete spawns[sessionId];
  writeStore(SPAWNS_STORE, spawns);
  return true;
}

/** Move one exact placement when its live bridge adopts a new session. */
export function rekeySpawn(previousSessionId: string, sessionId: string, expected: SpawnPlacement | null = null): boolean {
  if (!previousSessionId || !sessionId) return false;
  if (previousSessionId === sessionId) return !!getSpawn(sessionId);
  const spawns = readStore(SPAWNS_STORE);
  const current = spawns[previousSessionId];
  if (!current || (expected && !sameSpawnRecord(current, expected))) return false;
  spawns[sessionId] = current;
  delete spawns[previousSessionId];
  writeStore(SPAWNS_STORE, spawns);
  return true;
}

/** Drop unregistered placements whose panes are gone, preserving concurrent writes. */
export async function pruneSpawns(registeredIds: ReadonlySet<string> = new Set()): Promise<Record<string, unknown>> {
  const dead: [string, Record<string, unknown>][] = [];
  for (const [id, entry] of Object.entries(readStore(SPAWNS_STORE))) {
    if (registeredIds.has(id) || !record(entry)) continue;
    // Malformed placement fields cannot name a live pane; the record still
    // participates in the same compare-before-prune check after other probes.
    if (isPlacement(entry) && await paneExists(entry.socket, entry.paneId)) continue;
    dead.push([id, entry]);
  }
  // Probes yield: re-read, then remove only the same inspected record.
  const spawns = readStore(SPAWNS_STORE);
  if (dead.length) {
    for (const [id, inspected] of dead) {
      if (sameSpawnRecord(spawns[id], inspected)) delete spawns[id];
    }
    writeStore(SPAWNS_STORE, spawns);
  }
  return spawns;
}
