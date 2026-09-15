/**
 * Spawn pi sessions inside tmux windows instead of as web-server children.
 *
 * A pi-dish-managed RPC session (lib/rpc-session.js) dies when the pi-dish
 * server restarts — it's a child process. A pi TUI running in tmux with the
 * pi-dish-bridge extension survives independently (registry + Unix socket).
 * This module lets pi-dish open a new pi TUI as a tmux window on a chosen tmux
 * server; the bridge registers it and pi-dish drives it over the normal
 * BridgeSession path.
 *
 * The user may run several tmux servers, each a distinct socket under
 * $TMUX_TMPDIR (default /tmp/tmux-<uid>/). Every invocation uses execFile with
 * a short timeout and argv, never a shell string. Spawn placements persist
 * in ~/.pi/dish/tmux-spawns.json; HOME is resolved per call.
 */
import { execFile, execFileSync } from 'child_process';
import fs = require('fs');
import os = require('os');
import path = require('path');
import { setTimeout as delay } from 'timers/promises';
import type { ProcessIdentity, ProcessIdentityInput } from './contracts';
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

/** Retain legacy environment interpolation, including undefined values. */
export type SpawnEnvironment = Readonly<Record<string, unknown>>;

interface PaneCommand {
  cwd?: string | null;
  command: readonly string[];
  env?: SpawnEnvironment | null;
}

export interface SpawnOptions extends PaneCommand {
  socket: string;
  tmuxSession?: string | null;
  newTmuxSessionName?: string | null;
  windowName?: string | null;
}

/** Async preparation returns the synchronous checker run adjacent to execFile. */
export interface RespawnOptions extends PaneTarget, PaneCommand {
  expectedProcess: ProcessIdentityInput | null;
  beforeAction?: (() => (() => undefined) | Promise<() => undefined>) | null;
}

/**
 * A decoded placement is still only persisted evidence, never live authority.
 * Optional observations are retained verbatim; consumers must narrow tokens or
 * wrapper paths before using them. Legacy process numbers/strings are not coerced.
 */
export interface SpawnPlacement extends PaneTarget, Record<string, unknown> {
  createdAt?: unknown;
  spawnToken?: unknown;
  bridgeInstanceId?: unknown;
  paneProcess?: unknown;
  wrapperPath?: unknown;
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
}

export interface PaneCleanupError extends Error {
  remainingProcesses: ProcessIdentity[];
}

function cleanupError(error: unknown, remainingProcesses: ProcessIdentity[]): PaneCleanupError {
  return Object.assign(error instanceof Error ? error : new Error(String(error)), { remainingProcesses });
}

function runTmux(args: readonly string[], { timeout = 3000 } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, { timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve(stdout);
    });
  });
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

/** Enumerate live socket servers under the tmux tmpdir, skipping stale sockets. */
export async function listServers(): Promise<TmuxServer[]> {
  if (!isTmuxAvailable()) return [];
  const dir = tmuxTmpdir();
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const servers: TmuxServer[] = [];
  for (const name of names) {
    const socket = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(socket); } catch { continue; }
    if (!stat.isSocket()) continue;
    let out;
    try {
      // ':' is the target-spec separator; unlike a tab, tmux does not sanitize it.
      out = await runTmux(
        ['-S', socket, 'list-sessions', '-F', '#{session_name}:#{session_windows}:#{session_attached}'],
        { timeout: 2000 },
      );
    } catch {
      continue; // stale socket / dead server
    }
    const sessions = out.split('\n').filter(Boolean).map((line) => {
      const [sname, windows, attached] = line.split(':');
      return { name: sname, windows: Number(windows) || 0, attached: attached === '1' };
    });
    servers.push({ socket, name: path.basename(socket), sessions });
  }
  return servers;
}

// A LAN client must not pass an arbitrary -S path: allow only the directory
// listServers enumerates. The caller checks this before launching.
export function isSocketAllowed(socket: unknown): socket is string {
  if (typeof socket !== 'string' || !socket) return false;
  return path.dirname(path.resolve(socket)) === path.resolve(tmuxTmpdir());
}

/** Open a detached window or session with child argv and tmux -e KEY=VALUE flags. */
export async function spawnInTmux({ socket, tmuxSession, newTmuxSessionName, windowName, cwd, command, env }: SpawnOptions): Promise<{ paneId: string }> {
  if (!Array.isArray(command) || !command.length) throw new Error('command argv required');
  const envFlags: string[] = [];
  for (const [k, v] of Object.entries(env || {})) envFlags.push('-e', `${k}=${v}`);

  let args: string[];
  if (newTmuxSessionName) {
    args = ['-S', socket, 'new-session', '-d', '-s', newTmuxSessionName];
    if (windowName) args.push('-n', windowName);
  } else if (tmuxSession) {
    // Do not steal the current window from an attached user.
    args = ['-S', socket, 'new-window', '-d', '-t', tmuxSession];
    if (windowName) args.push('-n', windowName);
  } else {
    throw new Error('tmuxSession or newTmuxSessionName required');
  }
  if (cwd) args.push('-c', cwd);
  args.push(...envFlags, '-P', '-F', '#{pane_id}', '--', ...command);

  const out = await runTmux(args, { timeout: 5000 });
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
  const args = ['-S', socket, 'respawn-pane', '-k', '-t', paneId];
  if (cwd) args.push('-c', cwd);
  for (const [key, value] of Object.entries(env || {})) args.push('-e', `${key}=${value}`);
  args.push('--', ...command);
  if (beforeAction) {
    const finalCheck = await beforeAction();
    finalCheck();
  }
  await runTmux(args, { timeout: 5000 });
  return { paneId };
}

export async function sendKeys(socket: string, paneId: string, text: string): Promise<void> {
  await runTmux(['-S', socket, 'send-keys', '-t', paneId, text, 'Enter'], { timeout: 2000 });
}

// One chord, no Enter/literal flag: cannot land in a TUI's unsent composer draft.
export async function sendKey(socket: string, paneId: string, key: string): Promise<void> {
  await runTmux(['-S', socket, 'send-keys', '-t', paneId, key], { timeout: 2000 });
}

export async function renameWindow(socket: string | null | undefined, target: string | null | undefined, name: unknown): Promise<void> {
  if (!socket || !target || !name) return;
  const sanitized = String(name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  if (!sanitized) return;
  const sessionSafe = sanitized.replace(/[.:\s]+/g, '-').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 48);
  try {
    await runTmux(['-S', socket, 'rename-window', '-t', target, sanitized], { timeout: 2000 });
    await runTmux(['-S', socket, 'select-pane', '-t', target, '-T', sanitized], { timeout: 2000 });
    if (sessionSafe) {
      await runTmux(['-S', socket, 'rename-session', '-t', target, sessionSafe], { timeout: 2000 }).catch(() => {});
    }
  } catch {}
}

// '=' means exact session-name match, not tmux's ordinary prefix match.
export async function hasSession(socket: string, name: string): Promise<boolean> {
  try {
    await runTmux(['-S', socket, 'has-session', '-t', `=${name}`], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export async function killPane(socket: string, paneId: string): Promise<void> {
  await runTmux(['-S', socket, 'kill-pane', '-t', paneId], { timeout: 2000 });
}

async function paneProcessId(socket: string, paneId: string): Promise<number | null> {
  if (!socket || !paneId) return null;
  try {
    const out = await runTmux(
      ['-S', socket, 'display-message', '-p', '-t', paneId, '#{pane_pid}'],
      { timeout: 2000 },
    );
    const pid = Number(out.trim());
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
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
  const pid = await paneProcessId(socket, paneId);
  const paneStillExists = pid ? true : await paneExists(socket, paneId);
  const tracked = new Map<string, ProcessIdentity>();
  for (const process of [...knownProcesses, ...(pid ? processTree(pid) : [])]) {
    if (process?.pid && process?.startTime) tracked.set(`${process.pid}:${process.startTime}`, process);
  }
  return {
    paneExists: paneStillExists,
    knownProcesses: [...tracked.values()].filter(processIdentityAlive),
  };
}

/** Exact birth identity of the process currently anchoring a tmux pane. */
export async function paneProcessIdentity(socket: string, paneId: string): Promise<ProcessIdentity | null> {
  const pid = await paneProcessId(socket, paneId);
  return pid ? processIdentity(pid) : null;
}

/**
 * Kill the pane, then wait for both tmux and its captured process tree to exit.
 * Hidden-session fallback cannot leave two processes writing the same JSONL.
 */
export async function killPaneAndWait(socket: string, paneId: string, { timeout = 5000, knownProcesses = [] }: PaneCleanupOptions = {}): Promise<void> {
  const pid = await paneProcessId(socket, paneId);
  const paneStillExists = pid ? true : await paneExists(socket, paneId);
  if (!pid && paneStillExists) {
    throw cleanupError(new Error(`could not identify process for tmux pane ${paneId}`), knownProcesses.filter(processIdentityAlive));
  }
  // Capture descendants before tmux closes the pane and reparents them. A
  // wrapper may be the root while its child is the actual JSONL writer.
  const tracked = new Map<string, ProcessIdentity>();
  for (const process of [...knownProcesses, ...(pid ? processTree(pid) : [])]) {
    if (process?.pid && process?.startTime) tracked.set(`${process.pid}:${process.startTime}`, process);
  }
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
  if (!socket || !paneId) return null;
  try {
    const out = await runTmux(
      ['-S', socket, 'display-message', '-p', '-t', paneId, '#{session_name}:#{window_index}:#{window_name}'],
      { timeout: 2000 },
    );
    const parts = out.trim().split(':');
    // Missing panes sometimes succeed with empty formatted fields.
    if (parts.length < 3 || !parts[0]) return null;
    return {
      tmuxSession: parts[0],
      windowIndex: Number(parts[1]),
      windowName: parts.slice(2).join(':'),
    };
  } catch {
    return null;
  }
}

/**
 * Weak location backstop for old/stale registry stamps, not ownership proof.
 * Scan allowed sockets and walk at most 20 parents to find the containing pane.
 */
export async function findPaneByPid(pid: number | string | null | undefined): Promise<(PaneTarget & PaneLocation) | null> {
  if (!pid || !isTmuxAvailable()) return null;
  const dir = tmuxTmpdir();
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const byPanePid = new Map<number, PaneTarget & PaneLocation>();
  for (const name of names) {
    const socket = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(socket); } catch { continue; }
    if (!stat.isSocket()) continue;
    let out;
    try {
      out = await runTmux(
        ['-S', socket, 'list-panes', '-a', '-F', '#{pane_pid}:#{pane_id}:#{session_name}:#{window_index}:#{window_name}'],
        { timeout: 2000 },
      );
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
  if (!socket || !paneId) return false;
  try {
    const out = await runTmux(
      ['-S', socket, 'display-message', '-p', '-t', paneId, '#{pane_id}'],
      { timeout: 2000 },
    );
    // Some tmux versions return success but empty fields for missing panes.
    return !!out.trim();
  } catch {
    return false;
  }
}

/**
 * A viewer gets a throwaway grouped session: independent current window, same
 * windows, destroyed on detach, without stealing the desktop client's focus.
 */
export async function attachPaneArgv(socket: string, paneId: string): Promise<string[] | null> {
  const loc = await paneLocation(socket, paneId);
  if (!loc) return null;
  const view = `dish-view-${Math.random().toString(36).slice(2, 8)}`;
  return [
    'tmux', '-S', socket, 'new-session', '-t', `=${loc.tmuxSession}`, '-s', view, ';',
    'set-option', 'destroy-unattached', 'on', ';',
    'select-window', '-t', paneId, ';',
    'select-pane', '-t', paneId,
  ];
}

/** Server prefix key, or null when unavailable. */
export async function getPrefixKey(socket: string): Promise<string | null> {
  try {
    const out = await runTmux(['-S', socket, 'show-options', '-g', 'prefix'], { timeout: 2000 });
    const m = out.trim().match(/^prefix\s+(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// --- Persisted spawn placements (~/.pi/dish/tmux-spawns.json) --------------

function spawnsFile(): string {
  return path.join(os.homedir(), '.pi', 'dish', 'tmux-spawns.json');
}

function readSpawns(): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(spawnsFile(), 'utf8'));
    return record(data) ? data : {};
  } catch {
    return {};
  }
}

function writeSpawns(spawns: Record<string, unknown>): void {
  const file = spawnsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(spawns, null, 2));
  fs.renameSync(tmp, file);
}

function isPlacement(value: unknown): value is SpawnPlacement {
  return record(value) && typeof value.socket === 'string' && typeof value.paneId === 'string';
}

export function recordSpawn(sessionId: string, { socket, paneId, spawnToken, bridgeInstanceId, paneProcess, wrapperPath }: PaneTarget & {
  spawnToken?: unknown;
  bridgeInstanceId?: unknown;
  paneProcess?: ProcessIdentityInput | null;
  wrapperPath?: unknown;
}): void {
  const spawns = readSpawns();
  spawns[sessionId] = {
    socket,
    paneId,
    createdAt: Date.now(),
    ...(spawnToken ? { spawnToken } : {}),
    ...(bridgeInstanceId ? { bridgeInstanceId } : {}),
    ...(paneProcess?.pid && paneProcess?.startTime ? { paneProcess } : {}),
    ...(wrapperPath ? { wrapperPath } : {}),
  };
  writeSpawns(spawns);
}

export function getSpawn(sessionId: string): SpawnPlacement | null {
  const value = readSpawns()[sessionId];
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
    && (leftProcess?.startTime || null) === (rightProcess?.startTime || null);
}

export function removeSpawn(sessionId: string, expected: SpawnPlacement | null = null): boolean {
  const spawns = readSpawns();
  if (!Object.prototype.hasOwnProperty.call(spawns, sessionId)) return false;
  if (expected && !sameSpawnRecord(spawns[sessionId], expected)) return false;
  delete spawns[sessionId];
  writeSpawns(spawns);
  return true;
}

/** Move one exact placement when its live bridge adopts a new session. */
export function rekeySpawn(previousSessionId: string, sessionId: string, expected: SpawnPlacement | null = null): boolean {
  if (!previousSessionId || !sessionId) return false;
  if (previousSessionId === sessionId) return !!getSpawn(sessionId);
  const spawns = readSpawns();
  const current = spawns[previousSessionId];
  if (!current || (expected && !sameSpawnRecord(current, expected))) return false;
  spawns[sessionId] = current;
  delete spawns[previousSessionId];
  writeSpawns(spawns);
  return true;
}

/** Drop unregistered placements whose panes are gone, preserving concurrent writes. */
export async function pruneSpawns(registeredIds: ReadonlySet<string> = new Set()): Promise<Record<string, unknown>> {
  const dead: [string, SpawnPlacement][] = [];
  for (const [id, entry] of Object.entries(readSpawns())) {
    if (registeredIds.has(id)) continue;
    if (!isPlacement(entry) || await paneExists(entry.socket, entry.paneId)) continue;
    dead.push([id, entry]);
  }
  // Probes yield: re-read, then remove only the same inspected record.
  const spawns = readSpawns();
  if (dead.length) {
    for (const [id, inspected] of dead) {
      if (sameSpawnRecord(spawns[id], inspected)) delete spawns[id];
    }
    writeSpawns(spawns);
  }
  return spawns;
}
