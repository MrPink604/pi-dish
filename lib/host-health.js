// Generated from src/core/host-health.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultHostHealthDeps = void 0;
exports.parseMemAvailable = parseMemAvailable;
exports.createHostHealth = createHostHealth;
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
const fs = require("fs");
const os = require("os");
const FIRST_WINDOW_MS = 250;
const MIN_WINDOW_MS = 1000;
const MAX_WINDOW_MS = 5 * 60_000;
const SHARE_MS = 2000;
exports.defaultHostHealthDeps = {
    cpus: () => os.cpus(),
    loadavg: () => os.loadavg(),
    totalmem: () => os.totalmem(),
    freemem: () => os.freemem(),
    uptime: () => os.uptime(),
    readMeminfo: () => { try {
        return fs.readFileSync('/proc/meminfo', 'utf8');
    }
    catch {
        return null;
    } },
    statfs: target => {
        try {
            const s = fs.statfsSync(target);
            return { bsize: s.bsize, blocks: s.blocks, bavail: s.bavail };
        }
        catch {
            return null;
        }
    },
    homedir: () => os.homedir(),
    platform: process.platform,
    arch: process.arch,
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};
function cpuTimes(deps) {
    let busy = 0, total = 0;
    for (const cpu of deps.cpus()) {
        const t = cpu.times;
        const sum = t.user + t.nice + t.sys + t.idle + t.irq;
        total += sum;
        busy += sum - t.idle;
    }
    return { at: deps.now(), busy, total };
}
function utilizationBetween(a, b) {
    const total = b.total - a.total;
    if (!(total > 0))
        return null;
    return Math.min(1, Math.max(0, (b.busy - a.busy) / total));
}
/** `MemAvailable` in bytes from /proc/meminfo text, or null when absent. */
function parseMemAvailable(text) {
    const match = text ? /^MemAvailable:\s+(\d+)\s*kB/m.exec(text) : null;
    return match ? Number(match[1]) * 1024 : null;
}
function createHostHealth(deps = exports.defaultHostHealthDeps) {
    let previous = null;
    let shared = null;
    async function measureCpu() {
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
    async function sample() {
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
    function read() {
        const now = deps.now();
        if (shared && now - shared.at < SHARE_MS)
            return shared.value;
        const value = sample();
        shared = { at: now, value };
        value.catch(() => { if (shared?.value === value)
            shared = null; });
        return value;
    }
    return { read };
}
