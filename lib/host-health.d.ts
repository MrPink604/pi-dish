// Generated from src/core/host-health.ts; edit that source and run npm run build:core.
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
export interface HostHealthBytes {
    readonly totalBytes: number;
    readonly availableBytes: number;
}
export interface HostHealthDisk extends HostHealthBytes {
    readonly path: string;
    readonly fsType: string | null;
}
export interface HostHealthGpu {
    readonly name: string | null;
    /** Busy share 0..1; null when utilization could not be read. */
    readonly utilization: number | null;
    readonly memory: HostHealthBytes | null;
    readonly temperatureC: number | null;
}
export interface HostHealth {
    readonly sampledAt: string;
    readonly uptimeSec: number;
    readonly platform: string;
    readonly arch: string;
    readonly cpu: HostHealthCpu;
    readonly memory: HostHealthBytes;
    readonly disk: (HostHealthBytes & {
        readonly path: string;
    }) | null;
    readonly disks: readonly HostHealthDisk[];
    readonly gpus: readonly HostHealthGpu[];
}
export interface MountEntry {
    readonly source: string;
    readonly mount: string;
    readonly fsType: string | null;
}
export interface HostHealthDeps {
    cpus(): os.CpuInfo[];
    loadavg(): number[];
    totalmem(): number;
    freemem(): number;
    uptime(): number;
    readMeminfo(): string | null;
    readMounts?(): string | null;
    readDrmGpus?(): readonly HostHealthGpu[];
    execCommand?(file: string, args: readonly string[], timeoutMs: number): Promise<string | null>;
    statfs(path: string): {
        bsize: number;
        blocks: number;
        bavail: number;
    } | null;
    homedir(): string;
    platform: string;
    arch: string;
    now(): number;
    sleep(ms: number): Promise<void>;
}
/** Parse Linux `/proc/mounts` into deduplicated local partition mounts. */
export declare function parseProcMounts(text: string | null): MountEntry[];
/** Parse macOS `df -kPl` into deduplicated local disk mounts. */
export declare function parseMacOsDf(text: string | null): MountEntry[];
/** Parse `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` output. */
export declare function parseNvidiaSmi(text: string | null): HostHealthGpu[];
/** Parse `ioreg -r -d 1 -w 0 -c IOAccelerator` output on macOS. */
export declare function parseMacOsGpus(text: string | null): HostHealthGpu[];
/** Read non-NVIDIA Linux GPUs exposing busy% or VRAM via `/sys/class/drm`. */
export declare function readLinuxDrmGpus(drmDir?: string): HostHealthGpu[];
export declare const defaultHostHealthDeps: HostHealthDeps;
/** `MemAvailable` in bytes from /proc/meminfo text, or null when absent. */
export declare function parseMemAvailable(text: string | null): number | null;
export declare function createHostHealth(deps?: HostHealthDeps): {
    read: () => Promise<HostHealth>;
};
