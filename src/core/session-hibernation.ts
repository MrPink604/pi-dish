/**
 * Memory-pressure hibernation. When the host runs short of memory, pi-dish
 * gracefully stops the longest-idle live agent that is provably doing nothing,
 * keeps its transcript resumable, and resumes it when a message arrives.
 *
 * Hibernation is not an explicit close: recovery intent is untouched and the
 * record lives in its own store (`~/.pi/dish/hibernation.json`). Eligibility
 * is deliberately conservative; anything that cannot be proven idle is kept:
 *   - a turn, compaction, ask dialog, queued input, background job, live
 *     subagent or running tool (the shared bounce safety inspection);
 *   - a browser event stream or tmux client watching the session;
 *   - a warm prompt cache, or activity within HIBERNATION_MIN_IDLE_MS;
 *   - a supervised service under the session's launch broker;
 *   - a live eval kernel whose transcript used `eval` within
 *     HIBERNATION_EVAL_WINDOW_MS (older kernel state is discarded and recorded).
 * One session is stopped per sample, so the next sample sees the freed memory.
 */
import fs = require('fs');
import path = require('path');
import dishStore = require('./dish-store');
import { canonicalSessionId } from './session-key';
import { isRecord } from './wire-protocol';
import type { HibernationState } from './session-api';

export type HibernationMode = 'pressure' | 'off';

/** Defaults on: the setting exists to switch a host off, not to opt in. */
export function hibernationMode(value: unknown): HibernationMode {
  return value === 'off' ? 'off' : 'pressure';
}

export const HIBERNATION_MIN_IDLE_MS = 2 * 60 * 60 * 1000;
export const HIBERNATION_EVAL_WINDOW_MS = 8 * 60 * 60 * 1000;
/** Pressure: less than this share of RAM available... */
export const PRESSURE_AVAILABLE_FRACTION = 0.10;
/** ...or more than this share of configured swap in use. */
export const PRESSURE_SWAP_USED_FRACTION = 0.75;
const SAMPLE_INTERVAL_MS = 60_000;
const HIBERNATION_HARNESSES: Record<string, true> = { omp: true, pi: true };
const STORE = 'hibernation.json';
const EVAL_SCAN_CHUNK_BYTES = 256 * 1024;
const EVAL_SCAN_MAX_BYTES = 64 * 1024 * 1024;
const GIB = 1024 ** 3;

export interface MemorySample {
  readonly totalBytes: number;
  readonly availableBytes: number;
  readonly swapTotalBytes: number;
  readonly swapFreeBytes: number;
}

/** A `Key:  N kB` field from /proc/meminfo or /proc/<pid>/status, in bytes. */
function kilobytes(text: string, key: string): number | null {
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm'));
  return match ? Number(match[1]) * 1024 : null;
}

export function parseMeminfo(text: string | null): MemorySample | null {
  if (!text) return null;
  const totalBytes = kilobytes(text, 'MemTotal');
  const availableBytes = kilobytes(text, 'MemAvailable');
  if (!totalBytes || availableBytes === null) return null;
  return { totalBytes, availableBytes, swapTotalBytes: kilobytes(text, 'SwapTotal') ?? 0, swapFreeBytes: kilobytes(text, 'SwapFree') ?? 0 };
}

/** Human-readable pressure description, or null when the host is not under pressure. */
export function memoryPressure(sample: MemorySample): string | null {
  const { totalBytes, availableBytes, swapTotalBytes, swapFreeBytes } = sample;
  if (availableBytes < totalBytes * PRESSURE_AVAILABLE_FRACTION) {
    return `${Math.round(availableBytes / totalBytes * 100)}% of RAM available (${(availableBytes / GIB).toFixed(1)} of ${(totalBytes / GIB).toFixed(1)} GiB)`;
  }
  const swapUsed = swapTotalBytes - swapFreeBytes;
  if (swapTotalBytes > 0 && swapUsed > swapTotalBytes * PRESSURE_SWAP_USED_FRACTION) {
    return `swap ${Math.round(swapUsed / swapTotalBytes * 100)}% used (${(swapUsed / GIB).toFixed(1)} of ${(swapTotalBytes / GIB).toFixed(1)} GiB)`;
  }
  return null;
}

export interface ProcReader {
  pids(): number[];
  read(pid: number, file: 'status' | 'cmdline'): string | null;
}

export const procfs: ProcReader = {
  pids: () => {
    try { return fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(Number); }
    catch { return []; }
  },
  read: (pid, file) => {
    try { return fs.readFileSync(`/proc/${pid}/${file}`, 'utf8'); }
    catch { return null; }
  },
};

export interface ProcessTreeSummary {
  readonly processes: number;
  readonly rssBytes: number;
  readonly swapBytes: number;
  /** One label per live eval kernel process. */
  readonly kernels: readonly string[];
  /** Processes supervised by an OMP launch broker inside this tree. */
  readonly serviceProcesses: number;
  readonly browserProcesses: number;
}

/** Memory and stateful children of one agent process tree; null when the root is gone. */
export function inspectProcessTree(rootPid: number, proc: ProcReader = procfs): ProcessTreeSummary | null {
  const statuses = new Map<number, string>();
  const children = new Map<number, number[]>();
  for (const pid of proc.pids()) {
    const status = proc.read(pid, 'status');
    if (!status) continue;
    statuses.set(pid, status);
    const parent = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
    if (!parent) continue;
    const siblings = children.get(parent);
    if (siblings) siblings.push(pid); else children.set(parent, [pid]);
  }
  if (!statuses.has(rootPid)) return null;
  let processes = 0, rssBytes = 0, swapBytes = 0, serviceProcesses = 0, browserProcesses = 0;
  const kernels: string[] = [];
  const stack: [number, boolean][] = [[rootPid, false]];
  const visited = new Set<number>();
  while (stack.length) {
    const [pid, underBroker] = stack.pop()!;
    const status = statuses.get(pid);
    if (!status || visited.has(pid)) continue;
    visited.add(pid);
    processes++;
    rssBytes += kilobytes(status, 'VmRSS') ?? 0;
    swapBytes += kilobytes(status, 'VmSwap') ?? 0;
    const argv = (proc.read(pid, 'cmdline') || '').split('\0').filter(Boolean);
    let broker = underBroker;
    if (pid !== rootPid) {
      if (underBroker) serviceProcesses++;
      else if (argv.some(arg => arg.includes('omp-python-runner'))) kernels.push('python eval kernel');
      else if (argv.includes('__omp_worker_js_eval_process')) kernels.push('JavaScript eval kernel');
      else if (/^(chrome|chromium|chromium-browser|headless_shell)$/.test(path.basename(argv[0] || ''))) browserProcesses++;
      if (argv.includes('__omp_worker_daemon_broker')) broker = true;
    }
    for (const child of children.get(pid) || []) stack.push([child, broker]);
  }
  return { processes, rssBytes, swapBytes, kernels, serviceProcesses, browserProcesses };
}

/** true: `eval` ran in the window; false: an older entry ends the search; null: keep reading. */
function evalLineVerdict(line: Buffer, sinceMs: number): boolean | null {
  if (!line.length) return null;
  let entry: unknown;
  try { entry = JSON.parse(line.toString('utf8')); } catch { return null; }
  if (!isRecord(entry)) return null;
  const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
  if (Number.isFinite(at) && at < sinceMs) return false;
  const message = entry.message;
  if (isRecord(message) && message.role === 'assistant' && Array.isArray(message.content)
      && message.content.some(block => isRecord(block) && block.type === 'toolCall' && block.name === 'eval')) return true;
  return null;
}

/**
 * Whether the transcript called `eval` at or after `sinceMs`, reading backwards
 * only as far as the window. An unreadable file or a window larger than the
 * scan bound answers true: unknown kernel use keeps the session alive.
 */
export function evalUsedSince(file: string | null, sinceMs: number, maxBytes = EVAL_SCAN_MAX_BYTES): boolean {
  if (!file) return true;
  let fd: number;
  try { fd = fs.openSync(file, 'r'); } catch { return true; }
  try {
    const size = fs.fstatSync(fd).size;
    let position = size;
    let carry = Buffer.alloc(0);
    while (position > 0) {
      if (size - position >= maxBytes) return true;
      const length = Math.min(EVAL_SCAN_CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      fs.readSync(fd, chunk, 0, length, position);
      // Split on raw newline bytes: 0x0a never occurs inside a UTF-8 sequence.
      const data = Buffer.concat([chunk, carry]);
      let end = data.length;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i] !== 0x0a) continue;
        const verdict = evalLineVerdict(data.subarray(i + 1, end), sinceMs);
        if (verdict !== null) return verdict;
        end = i;
      }
      carry = data.subarray(0, end);
    }
    return evalLineVerdict(carry, sinceMs) ?? false;
  } catch {
    return true;
  } finally {
    fs.closeSync(fd);
  }
}

function readRecords(): Map<string, HibernationState> {
  const records = new Map<string, HibernationState>();
  for (const [id, value] of Object.entries(dishStore.readStore(STORE))) {
    if (!isRecord(value) || typeof value.hibernatedAt !== 'string' || typeof value.reason !== 'string'
        || typeof value.freedBytes !== 'number' || !Number.isFinite(value.freedBytes)
        || !Array.isArray(value.discarded) || !value.discarded.every(item => typeof item === 'string')) continue;
    records.set(id, { hibernatedAt: value.hibernatedAt, reason: value.reason, freedBytes: value.freedBytes, discarded: value.discarded });
  }
  return records;
}

function canonical(sessionId: unknown): string | null {
  try { return canonicalSessionId(sessionId); } catch { return null; }
}

export interface HibernationCandidate {
  readonly id: string;
  readonly harnessId: string;
  readonly name?: string | null;
  readonly pid?: number | null;
  readonly sessionFile: string | null;
  readonly lastActivity?: Date | string | number | null;
  readonly turnInProgress?: boolean;
  readonly askPending?: boolean;
  readonly compacting?: boolean;
  readonly conflicted?: boolean;
  readonly cacheExpiry?: { readonly expiresAt: number } | null;
}

export interface HibernationInspection {
  readonly eligible: boolean;
  readonly reason?: string;
  readonly blockers?: readonly string[];
}

export interface SessionHibernationPorts<Authority, Inspection extends HibernationInspection> {
  readSettings(): Record<string, unknown>;
  readMeminfo(): string | null;
  /** Current live sessions only. */
  candidates(): readonly HibernationCandidate[];
  /** Open browser event streams for a canonical session id. */
  viewers(sessionId: string): number;
  capture(row: HibernationCandidate): Authority | null;
  /** true unless the agent's tmux pane is provably unwatched. */
  paneAttached(authority: Authority): Promise<boolean>;
  inspect(authority: Authority): Promise<Inspection>;
  /** Stops the agent with the final safety guard, or throws. */
  execute(authority: Authority, inspection: Inspection): Promise<void>;
  resume(sessionId: string): Promise<void>;
  processTree?(pid: number): ProcessTreeSummary | null;
  evalUsedSince?(file: string | null, sinceMs: number): boolean;
  now?(): number;
  log?: { info?(message: string): void; error?(message: string): void };
}

export type HibernationTick = { readonly hibernated: string } | { readonly skipped: string };

export interface SessionHibernation {
  tick(): Promise<HibernationTick>;
  start(): void;
  stop(): void;
  records(): ReadonlyMap<string, HibernationState>;
  isHibernated(sessionId: string): boolean;
  forget(sessionId: string): void;
  /** Resumes a hibernated session; false when the session was not hibernated. */
  wake(sessionId: string): Promise<boolean>;
}

export function createSessionHibernation<Authority, Inspection extends HibernationInspection>(
  ports: SessionHibernationPorts<Authority, Inspection>,
): SessionHibernation {
  const now = ports.now || Date.now;
  const processTree = ports.processTree || (pid => inspectProcessTree(pid));
  const evalUsed = ports.evalUsedSince || evalUsedSince;
  const log = {
    info: ports.log?.info || ((message: string) => console.log(message)),
    error: ports.log?.error || ((message: string) => console.error(message)),
  };
  const wakes = new Map<string, Promise<void>>();
  let flight: Promise<HibernationTick> | null = null;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  function forget(sessionId: string): void {
    const id = canonical(sessionId);
    if (!id) return;
    const store = dishStore.readStore(STORE);
    if (!Object.hasOwn(store, id)) return;
    delete store[id];
    dishStore.writeStore(STORE, store);
  }

  /** NaN for unknown activity, which never compares as idle. */
  function activityMs(row: HibernationCandidate): number {
    return row.lastActivity instanceof Date ? row.lastActivity.getTime() : new Date(row.lastActivity ?? NaN).getTime();
  }

  /** Deep checks for one cheap-filtered candidate; returns the stored record on success. */
  async function attempt(row: HibernationCandidate, pressure: string, at: number): Promise<HibernationState | null> {
    const authority = ports.capture(row);
    if (!authority || !row.pid) return null;
    const tree = processTree(row.pid);
    if (!tree || tree.serviceProcesses) return null;
    if (tree.kernels.length && evalUsed(row.sessionFile, at - HIBERNATION_EVAL_WINDOW_MS)) return null;
    if (await ports.paneAttached(authority)) return null;
    const inspection = await ports.inspect(authority);
    if (!inspection.eligible || inspection.blockers?.length) return null;
    // Inspection awaited the live bridge; a viewer may have opened meanwhile.
    if (ports.viewers(row.id) > 0 || stopped) return null;
    await ports.execute(authority, inspection);
    const idleHours = Math.floor((at - activityMs(row)) / 3_600_000);
    const state: HibernationState = {
      hibernatedAt: new Date(now()).toISOString(),
      reason: `Memory pressure: ${pressure}; idle ${idleHours} h`,
      freedBytes: tree.rssBytes + tree.swapBytes,
      discarded: [...tree.kernels, ...(tree.browserProcesses ? ['browser tabs'] : [])],
    };
    const id = canonical(row.id);
    if (id) dishStore.writeStore(STORE, { ...dishStore.readStore(STORE), [id]: state });
    return state;
  }

  async function sample(): Promise<HibernationTick> {
    const live = ports.candidates();
    // A record describes an inactive session; anything live again has woken.
    const records = readRecords();
    for (const row of live) if (records.has(canonical(row.id) ?? '')) forget(row.id);
    if (hibernationMode(ports.readSettings().hibernation) === 'off') return { skipped: 'Hibernation is off.' };
    const measured = parseMeminfo(ports.readMeminfo());
    if (!measured) return { skipped: 'Memory pressure cannot be measured on this host.' };
    const pressure = memoryPressure(measured);
    if (!pressure) return { skipped: 'No memory pressure.' };
    const at = now();
    const candidates = live
      .filter(row => HIBERNATION_HARNESSES[row.harnessId] && !row.conflicted
        && !row.turnInProgress && !row.askPending && !row.compacting
        && activityMs(row) <= at - HIBERNATION_MIN_IDLE_MS
        && !(row.cacheExpiry && row.cacheExpiry.expiresAt > at)
        && ports.viewers(row.id) === 0)
      .sort((a, b) => activityMs(a) - activityMs(b));
    for (const row of candidates) {
      if (stopped) break;
      let state: HibernationState | null;
      try { state = await attempt(row, pressure, at); }
      catch (error) {
        // A failed stop may have changed the host; never cascade within one sample.
        log.error(`[hibernation] ${row.name || row.id}: ${error instanceof Error ? error.message : String(error)}`);
        return { skipped: 'Hibernation failed; retrying at the next sample.' };
      }
      if (!state) continue;
      log.info(`[hibernation] Hibernated ${row.name || row.id} (${row.id}): ${state.reason}; freed ~${(state.freedBytes / GIB).toFixed(2)} GiB`
        + (state.discarded.length ? `; discarded ${state.discarded.join(', ')}` : ''));
      return { hibernated: row.id };
    }
    return { skipped: 'No idle session is safe to hibernate.' };
  }

  function tick(): Promise<HibernationTick> {
    if (flight) return flight;
    flight = sample().finally(() => { flight = null; });
    return flight;
  }

  return {
    tick,
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { tick().catch(error => log.error(`[hibernation] ${error instanceof Error ? error.message : String(error)}`)); }, SAMPLE_INTERVAL_MS);
      timer.unref?.();
    },
    stop() { stopped = true; clearInterval(timer); timer = undefined; },
    records: readRecords,
    isHibernated: sessionId => readRecords().has(canonical(sessionId) ?? ''),
    forget,
    async wake(sessionId) {
      const id = canonical(sessionId);
      if (!id) return false;
      let pending = wakes.get(id);
      if (!pending) {
        if (!readRecords().has(id)) return false;
        // A failed resume leaves an ordinary inactive session, not a retry loop.
        pending = ports.resume(id).finally(() => { forget(id); wakes.delete(id); });
        wakes.set(id, pending);
      }
      await pending;
      return true;
    },
  };
}
