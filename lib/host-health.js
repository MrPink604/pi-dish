// Generated from src/core/host-health.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultHostHealthDeps = void 0;
exports.parseProcMounts = parseProcMounts;
exports.parseMacOsDf = parseMacOsDf;
exports.parseNvidiaSmi = parseNvidiaSmi;
exports.parseMacOsGpus = parseMacOsGpus;
exports.readLinuxDrmGpus = readLinuxDrmGpus;
exports.parseMemAvailable = parseMemAvailable;
exports.createHostHealth = createHostHealth;
/**
 * Coarse host capacity for the fleet view: one snapshot read on demand and
 * shared briefly across callers. CPU utilization is the busy share since the
 * previous snapshot (a first read takes its own short window). Memory prefers
 * Linux `MemAvailable` because `os.freemem()` counts reclaimable page cache as
 * used. `disk` describes the home filesystem for backward compatibility, while
 * `disks` enumerates mounted local partitions and `gpus` reads GPU utilization
 * and VRAM when available.
 */
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const FIRST_WINDOW_MS = 250;
const MIN_WINDOW_MS = 1000;
const MAX_WINDOW_MS = 5 * 60_000;
const SHARE_MS = 2000;
const CMD_TIMEOUT_MS = 2000;
const MIB = 1024 * 1024;
const LOCAL_FS_TYPES = new Set([
    'ext2', 'ext3', 'ext4',
    'xfs', 'btrfs', 'zfs', 'bcachefs', 'f2fs',
    'vfat', 'fat32', 'msdos', 'exfat',
    'ntfs', 'ntfs3', 'fuseblk',
    'jfs', 'reiserfs', 'nilfs2', 'ufs',
    'virtiofs', 'drvfs', 'fuse.mergerfs',
]);
const DRM_VENDORS = {
    '0x1002': 'AMD GPU',
    '0x8086': 'Intel GPU',
    '0x10de': 'NVIDIA GPU',
};
const NVIDIA_SMI_ARGS = [
    '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
    '--format=csv,noheader,nounits',
];
function readTrimmed(filePath) {
    try {
        const text = fs.readFileSync(filePath, 'utf8').trim();
        return text || null;
    }
    catch {
        return null;
    }
}
function parseOptionalNumber(raw) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    if (!trimmed || /^\[.*\]$/.test(trimmed))
        return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
}
function bytesFromUsedTotal(usedBytes, totalBytes) {
    if (!(totalBytes > 0) || !Number.isFinite(totalBytes) || !Number.isFinite(usedBytes) || usedBytes < 0)
        return null;
    const clampedUsed = Math.min(totalBytes, usedBytes);
    return { totalBytes: Math.round(totalBytes), availableBytes: Math.round(totalBytes - clampedUsed) };
}
function unescapeMountPath(raw) {
    return raw.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}
function isExcludedLinuxMount(mount) {
    if (mount === '/proc' || mount.startsWith('/proc/'))
        return true;
    if (mount === '/sys' || mount.startsWith('/sys/'))
        return true;
    if (mount === '/dev' || mount.startsWith('/dev/'))
        return true;
    if (mount === '/snap' || mount.startsWith('/snap/'))
        return true;
    if (mount === '/var/snap' || mount.startsWith('/var/snap/'))
        return true;
    if (mount.startsWith('/var/lib/docker/') || mount.startsWith('/var/lib/containerd/') || mount.startsWith('/var/lib/kubelet/'))
        return true;
    if ((mount === '/run' || mount.startsWith('/run/')) && !mount.startsWith('/run/media/'))
        return true;
    return false;
}
function preferMount(a, b) {
    if (a === '/')
        return true;
    if (b === '/')
        return false;
    if (a.length !== b.length)
        return a.length < b.length;
    return a < b;
}
/** Parse Linux `/proc/mounts` into deduplicated local partition mounts. */
function parseProcMounts(text) {
    if (!text)
        return [];
    // Later entries on the same mountpoint supersede earlier ones in /proc/mounts.
    const byMount = new Map();
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 3)
            continue;
        const source = unescapeMountPath(parts[0]);
        const mount = unescapeMountPath(parts[1]);
        const fsType = parts[2];
        byMount.set(mount, { source, mount, fsType });
    }
    const bySource = new Map();
    for (const entry of byMount.values()) {
        if (/^\/dev\/loop\d+$/.test(entry.source))
            continue;
        if (isExcludedLinuxMount(entry.mount))
            continue;
        const allowed = LOCAL_FS_TYPES.has(entry.fsType) || (entry.fsType === 'overlay' && entry.mount === '/');
        if (!allowed)
            continue;
        const key = entry.source.startsWith('/') || entry.fsType === 'zfs' ? entry.source : `${entry.fsType}\0${entry.mount}`;
        const existing = bySource.get(key);
        if (!existing || preferMount(entry.mount, existing.mount))
            bySource.set(key, entry);
    }
    return [...bySource.values()];
}
/** Parse macOS `df -kPl` into deduplicated local disk mounts. */
function parseMacOsDf(text) {
    if (!text)
        return [];
    const byMount = new Map();
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i++) {
        const match = /^(\S+)\s+\d+\s+\d+\s+\d+\s+\d+%\s+(.+)$/.exec(lines[i].trim());
        if (!match)
            continue;
        const source = match[1];
        const mount = match[2].trim();
        if (!source.startsWith('/dev/disk'))
            continue;
        if (mount === '/dev' || mount.startsWith('/System/Volumes/') || mount.startsWith('/private/var/') || mount.startsWith('/Library/Developer/CoreSimulator/')) {
            continue;
        }
        byMount.set(mount, { source, mount, fsType: null });
    }
    return [...byMount.values()];
}
/** Parse `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` output. */
function parseNvidiaSmi(text) {
    if (!text)
        return [];
    const gpus = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        const parts = trimmed.split(',');
        if (parts.length < 6)
            continue;
        const temp = parseOptionalNumber(parts[parts.length - 1]);
        const memTotalMiB = parseOptionalNumber(parts[parts.length - 2]);
        const memUsedMiB = parseOptionalNumber(parts[parts.length - 3]);
        const utilPct = parseOptionalNumber(parts[parts.length - 4]);
        const name = parts.slice(1, parts.length - 4).join(',').trim() || null;
        const utilization = utilPct !== null ? Math.min(1, Math.max(0, utilPct / 100)) : null;
        const memory = memTotalMiB !== null && memUsedMiB !== null
            ? bytesFromUsedTotal(memUsedMiB * MIB, memTotalMiB * MIB)
            : null;
        if (utilization === null && memory === null)
            continue;
        gpus.push({ name, utilization, memory, temperatureC: temp !== null ? Math.round(temp) : null });
    }
    return gpus;
}
/** Parse `ioreg -r -d 1 -w 0 -c IOAccelerator` output on macOS. */
function parseMacOsGpus(text) {
    if (!text)
        return [];
    const gpus = [];
    const blocks = text.split(/(?=\+-o )/);
    for (const block of blocks) {
        if (!block.startsWith('+-o '))
            continue;
        const perfMatch = /"PerformanceStatistics"\s*=\s*\{([^}]*)\}/.exec(block);
        if (!perfMatch)
            continue;
        const perf = perfMatch[1];
        const utilMatch = /"Device Utilization %"\s*=\s*(\d+)/.exec(perf);
        const utilization = utilMatch ? Math.min(1, Math.max(0, Number(utilMatch[1]) / 100)) : null;
        const vramUsedMatch = /"vramUsedBytes"\s*=\s*(\d+)/.exec(perf);
        const vramTotalBytesMatch = /"vramTotalBytes"\s*=\s*(\d+)/.exec(perf);
        const vramTotalMbMatch = /"VRAM,totalMB"\s*=\s*(\d+)/.exec(block);
        const totalBytes = vramTotalBytesMatch ? Number(vramTotalBytesMatch[1])
            : vramTotalMbMatch ? Number(vramTotalMbMatch[1]) * MIB : null;
        const memory = totalBytes !== null && vramUsedMatch
            ? bytesFromUsedTotal(Number(vramUsedMatch[1]), totalBytes)
            : null;
        if (utilization === null && memory === null)
            continue;
        const modelMatch = /"model"\s*=\s*"([^"]+)"/.exec(block);
        const name = modelMatch?.[1]?.trim() || (/^\+-o AGXAccelerator\b/.test(block) ? 'Apple GPU' : null);
        gpus.push({ name, utilization, memory, temperatureC: null });
    }
    return gpus;
}
/** Read non-NVIDIA Linux GPUs exposing busy% or VRAM via `/sys/class/drm`. */
function readLinuxDrmGpus(drmDir = '/sys/class/drm') {
    let entries;
    try {
        entries = fs.readdirSync(drmDir);
    }
    catch {
        return [];
    }
    const cards = entries
        .map(name => ({ name, match: /^card(\d+)$/.exec(name) }))
        .filter((item) => item.match !== null)
        .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
    const gpus = [];
    for (const { name: card } of cards) {
        const devDir = path.join(drmDir, card, 'device');
        const uevent = readTrimmed(path.join(devDir, 'uevent')) || '';
        const driver = /^DRIVER=(.+)$/m.exec(uevent)?.[1]?.trim() || '';
        // NVIDIA GPUs are queried through nvidia-smi; skip them here to avoid duplicates.
        if (driver === 'nvidia' || driver === 'nvidia-drm')
            continue;
        const busy = parseOptionalNumber(readTrimmed(path.join(devDir, 'gpu_busy_percent')));
        const vramTotal = parseOptionalNumber(readTrimmed(path.join(devDir, 'mem_info_vram_total')));
        const vramUsed = parseOptionalNumber(readTrimmed(path.join(devDir, 'mem_info_vram_used')));
        const utilization = busy !== null ? Math.min(1, Math.max(0, busy / 100)) : null;
        const memory = vramTotal !== null && vramUsed !== null ? bytesFromUsedTotal(vramUsed, vramTotal) : null;
        if (utilization === null && memory === null)
            continue;
        const product = readTrimmed(path.join(devDir, 'product_name'));
        const vendor = readTrimmed(path.join(devDir, 'vendor'))?.toLowerCase() || '';
        const name = product || DRM_VENDORS[vendor] || (driver ? `${driver} GPU` : 'GPU');
        let temperatureC = null;
        try {
            const hwmonRoot = path.join(devDir, 'hwmon');
            for (const mon of fs.readdirSync(hwmonRoot)) {
                const milliC = parseOptionalNumber(readTrimmed(path.join(hwmonRoot, mon, 'temp1_input')));
                if (milliC !== null) {
                    temperatureC = Math.round(milliC / 1000);
                    break;
                }
            }
        }
        catch { /* no hwmon temperature sensor */ }
        gpus.push({ name, utilization, memory, temperatureC });
    }
    return gpus;
}
function displayMountPath(mount, home) {
    if (home && home !== '/') {
        if (mount === home)
            return '~';
        if (mount.startsWith(home + '/'))
            return '~' + mount.slice(home.length);
    }
    return mount;
}
function sortDisks(disks) {
    return disks.sort((a, b) => {
        if (a.path === b.path)
            return 0;
        if (a.path === '/')
            return -1;
        if (b.path === '/')
            return 1;
        if (a.path === '~')
            return -1;
        if (b.path === '~')
            return 1;
        return a.path.localeCompare(b.path);
    });
}
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
    readMounts: () => { try {
        return fs.readFileSync('/proc/mounts', 'utf8');
    }
    catch {
        return null;
    } },
    readDrmGpus: () => readLinuxDrmGpus(),
    execCommand: (file, args, timeoutMs) => new Promise(resolve => {
        childProcess.execFile(file, [...args], { timeout: timeoutMs, maxBuffer: MIB, windowsHide: true }, (error, stdout) => {
            resolve(error ? null : String(stdout));
        });
    }),
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
    async function readDisks(home, fallback) {
        let mounts = [];
        if (deps.platform === 'linux') {
            mounts = parseProcMounts(deps.readMounts ? deps.readMounts() : null);
        }
        else if (deps.platform === 'darwin' && deps.execCommand) {
            mounts = parseMacOsDf(await deps.execCommand('df', ['-kPl'], CMD_TIMEOUT_MS));
        }
        const disks = [];
        for (const entry of mounts) {
            const stats = deps.statfs(entry.mount);
            if (!stats || !(stats.blocks > 0))
                continue;
            disks.push({
                path: displayMountPath(entry.mount, home),
                fsType: entry.fsType,
                totalBytes: stats.bsize * stats.blocks,
                availableBytes: stats.bsize * stats.bavail,
            });
        }
        if (disks.length > 0)
            return sortDisks(disks);
        return fallback ? [{ path: fallback.path, fsType: null, totalBytes: fallback.totalBytes, availableBytes: fallback.availableBytes }] : [];
    }
    async function readGpus() {
        if (deps.platform === 'darwin') {
            const out = deps.execCommand ? await deps.execCommand('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], CMD_TIMEOUT_MS) : null;
            return parseMacOsGpus(out);
        }
        const nvidiaOut = deps.execCommand ? await deps.execCommand('nvidia-smi', NVIDIA_SMI_ARGS, CMD_TIMEOUT_MS) : null;
        const nvidia = parseNvidiaSmi(nvidiaOut);
        const drm = deps.platform === 'linux' && deps.readDrmGpus ? deps.readDrmGpus() : [];
        return [...nvidia, ...drm];
    }
    async function sample() {
        const cpus = deps.cpus();
        const home = deps.homedir();
        const fsStats = deps.statfs(home);
        const disk = fsStats && fsStats.blocks > 0 ? {
            path: '~',
            totalBytes: fsStats.bsize * fsStats.blocks,
            availableBytes: fsStats.bsize * fsStats.bavail,
        } : null;
        const [{ utilization, windowMs }, disks, gpus] = await Promise.all([
            measureCpu(),
            readDisks(home, disk),
            readGpus(),
        ]);
        const load = deps.loadavg();
        // Windows reports [0, 0, 0]: no load average rather than an idle one.
        const hasLoad = deps.platform !== 'win32' && load.length === 3 && load.every(Number.isFinite);
        const totalmem = deps.totalmem();
        const available = parseMemAvailable(deps.platform === 'linux' ? deps.readMeminfo() : null) ?? deps.freemem();
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
            disk,
            disks,
            gpus,
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
