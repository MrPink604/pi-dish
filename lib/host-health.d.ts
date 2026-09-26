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
}
export interface HostHealthDeps {
    cpus(): os.CpuInfo[];
    loadavg(): number[];
    totalmem(): number;
    freemem(): number;
    uptime(): number;
    readMeminfo(): string | null;
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
export declare const defaultHostHealthDeps: HostHealthDeps;
/** `MemAvailable` in bytes from /proc/meminfo text, or null when absent. */
export declare function parseMemAvailable(text: string | null): number | null;
export declare function createHostHealth(deps?: HostHealthDeps): {
    read: () => Promise<HostHealth>;
};
