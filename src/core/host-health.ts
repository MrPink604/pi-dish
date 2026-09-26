/**
 * Coarse host capacity for the fleet view and for agents deciding whether a
 * host is busy. Deliberately not a monitoring system: no history, no
 * background sampler, no per-process accounting and no native collector. One
 * small snapshot is read on demand and shared briefly across callers.
 *
 * CPU utilization is the busy share of aggregate `os.cpus()` time since the
 * previous snapshot, so a viewer polling every few seconds sees a smoothed
 * window instead of one noisy instant. A first read (or one after a long
 * quiet period) takes its own short window. Memory prefers Linux
 * `MemAvailable`; `os.freemem()` counts reclaimable page cache as used and
 * would report every long-running Linux host as nearly full. Disk describes
 * the filesystem holding the home directory, which is where sessions,
 * workspaces and harness stores live.
 */
import fs = require('fs');
import os = require('os');

export interface HostHealthCpu {
  readonly cores: number;
  readonly model: string | null;
  /** Busy share 0..1 over `windowMs`; null when no window could be measured. */
  readonly utilization: number | null;
  readonly windowMs: number | null;
  /** 1/5/15-minute load averages; null where the platform reports none. */
  readonly load: readonly [number, number, number] | null;
}
export interface HostHealthBytes { readonly totalBytes: number; readonly availableBytes: number }
export interface HostHealth {
  readonly sampledAt: string;
  readonly uptimeSec: number;
  readonly platform: string;
  readonly arch: string;
  readonly cpu: HostHealthCpu;
  readonly memory: HostHealthBytes;
  readonly disk: (HostHealthBytes & { readonly path: string }) | null;
}

interface CpuTimes { readonly at: number; readonly busy: number; readonly total: number }
export interface HostHealthDeps {
  cpus(): os.CpuInfo[];
  loadavg(): number[];
  totalmem(): number;
  freemem(): number;
  uptime(): number;
  readMeminfo(): string | null;
  statfs(path: string): { bsize: number; blocks: number; bavail: number } | null;
  homedir(): string;
  platform: string;
  arch: string;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const FIRST_WINDOW_MS = 250;
const MIN_WINDOW_MS = 1000;
const MAX_WINDOW_MS = 5 * 60_000;
const SHARE_MS = 2000;

export const defaultHostHealthDeps: HostHealthDeps = {
  cpus: () => os.cpus(),
  loadavg: () => os.loadavg(),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  uptime: () => os.uptime(),
  readMeminfo: () => { try { return fs.readFileSync('/proc/meminfo', 'utf8'); } catch { return null; } },
  statfs: target => {
    try { const s = fs.statfsSync(target); return { bsize: s.bsize, blocks: s.blocks, bavail: s.bavail }; }
    catch { return null; }
  },
  homedir: () => os.homedir(),
  platform: process.platform,
  arch: process.arch,
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

function cpuTimes(deps: HostHealthDeps): CpuTimes {
  let busy = 0, total = 0;
  for (const cpu of deps.cpus()) {
    const t = cpu.times;
    const sum = t.user + t.nice + t.sys + t.idle + t.irq;
    total += sum; busy += sum - t.idle;
  }
  return { at: deps.now(), busy, total };
}

function utilizationBetween(a: CpuTimes, b: CpuTimes): number | null {
  const total = b.total - a.total;
  if (!(total > 0)) return null;
  return Math.min(1, Math.max(0, (b.busy - a.busy) / total));
}

/** `MemAvailable` in bytes from /proc/meminfo text, or null when absent. */
export function parseMemAvailable(text: string | null): number | null {
  const match = text ? /^MemAvailable:\s+(\d+)\s*kB/m.exec(text) : null;
  return match ? Number(match[1]) * 1024 : null;
}

export function createHostHealth(deps: HostHealthDeps = defaultHostHealthDeps) {
  let previous: CpuTimes | null = null;
  let shared: { at: number; value: Promise<HostHealth> } | null = null;

  async function measureCpu(): Promise<{ utilization: number | null; windowMs: number | null }> {
    const current = cpuTimes(deps);
    const age = previous ? current.at - previous.at : Infinity;
    if (previous && age >= MIN_WINDOW_MS && age <= MAX_WINDOW_MS) {
      const utilization = utilizationBetween(previous, current);
      previous = current;
      return { utilization, windowMs: age };
    }
    await deps.sleep(FIRST_WINDOW_MS);
    const next = cpuTimes(deps);
    previous = next;
    return { utilization: utilizationBetween(current, next), windowMs: next.at - current.at };
  }

  async function sample(): Promise<HostHealth> {
    const cpus = deps.cpus();
    const { utilization, windowMs } = await measureCpu();
    const load = deps.loadavg();
    // Windows reports [0, 0, 0]: no load average rather than an idle one.
    const hasLoad = deps.platform !== 'win32' && load.length === 3 && load.every(Number.isFinite);
    const totalmem = deps.totalmem();
    const available = parseMemAvailable(deps.platform === 'linux' ? deps.readMeminfo() : null) ?? deps.freemem();
    const home = deps.homedir();
    const fsStats = deps.statfs(home);
    return {
      sampledAt: new Date(deps.now()).toISOString(),
      uptimeSec: Math.round(deps.uptime()),
      platform: deps.platform,
      arch: deps.arch,
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model?.trim() || null,
        utilization, windowMs,
        load: hasLoad ? [load[0], load[1], load[2]] : null,
      },
      memory: { totalBytes: totalmem, availableBytes: Math.min(totalmem, Math.max(0, available)) },
      disk: fsStats && fsStats.blocks > 0 ? {
        path: '~',
        totalBytes: fsStats.bsize * fsStats.blocks,
        availableBytes: fsStats.bsize * fsStats.bavail,
      } : null,
    };
  }

  /** Concurrent and closely spaced callers share one snapshot. */
  function read(): Promise<HostHealth> {
    const now = deps.now();
    if (shared && now - shared.at < SHARE_MS) return shared.value;
    const value = sample();
    shared = { at: now, value };
    value.catch(() => { if (shared?.value === value) shared = null; });
    return value;
  }

  return { read };
}
