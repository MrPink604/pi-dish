// Generated from src/core/session-hibernation.ts; edit that source and run npm run build:core.
import type { HibernationState } from './session-api';
export type HibernationMode = 'pressure' | 'off';
/** Defaults on: the setting exists to switch a host off, not to opt in. */
export declare function hibernationMode(value: unknown): HibernationMode;
export declare const HIBERNATION_MIN_IDLE_MS: number;
export declare const HIBERNATION_EVAL_WINDOW_MS: number;
/** Pressure: less than this share of RAM available... */
export declare const PRESSURE_AVAILABLE_FRACTION = 0.1;
/** ...or more than this share of configured swap in use. */
export declare const PRESSURE_SWAP_USED_FRACTION = 0.75;
export interface MemorySample {
    readonly totalBytes: number;
    readonly availableBytes: number;
    readonly swapTotalBytes: number;
    readonly swapFreeBytes: number;
}
export declare function parseMeminfo(text: string | null): MemorySample | null;
/** Human-readable pressure description, or null when the host is not under pressure. */
export declare function memoryPressure(sample: MemorySample): string | null;
export interface ProcReader {
    pids(): number[];
    read(pid: number, file: 'status' | 'cmdline'): string | null;
}
export declare const procfs: ProcReader;
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
export declare function inspectProcessTree(rootPid: number, proc?: ProcReader): ProcessTreeSummary | null;
/**
 * Whether the transcript called `eval` at or after `sinceMs`, reading backwards
 * only as far as the window. An unreadable file or a window larger than the
 * scan bound answers true: unknown kernel use keeps the session alive.
 */
export declare function evalUsedSince(file: string | null, sinceMs: number, maxBytes?: number): boolean;
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
    readonly cacheExpiry?: {
        readonly expiresAt: number;
    } | null;
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
    log?: {
        info?(message: string): void;
        error?(message: string): void;
    };
}
export type HibernationTick = {
    readonly hibernated: string;
} | {
    readonly skipped: string;
};
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
export declare function createSessionHibernation<Authority, Inspection extends HibernationInspection>(ports: SessionHibernationPorts<Authority, Inspection>): SessionHibernation;
