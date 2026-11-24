// Generated from src/core/recovery-runner.ts; edit that source and run npm run build:core.
import type { ProcessIdentity } from './contracts';
import type { ResumeSessionResult, SessionOperations } from './session-operations';
import { recoveryRouteId, validateRecoveryRecord } from './session-ownership';
import type { LiveSession, SessionOwnership } from './session-ownership';
import * as recoveryStore from './session-recovery';
import type { RecoveryRecord } from './session-recovery';
import type { LiveTmuxPane, TmuxServerSnapshot } from './tmux';
export type RecoveryMode = 'off' | 'restore' | 'continue';
export type RecoveryStatus = 'pending' | 'failed' | 'needs-review' | 'closed' | 'live' | 'restoring' | 'restored' | 'continued';
/** Reports retain untrusted legacy attempt values rather than laundering them into defaults. */
export interface RecoveryReportSession {
    id: string;
    harnessId: string;
    name: string | null;
    cwd: string | null;
    excluded: boolean;
    status: unknown;
    reason: unknown;
    updatedAt: unknown;
}
export interface RecoveryOutcome extends RecoveryReportSession {
    status: RecoveryStatus;
    updatedAt: number;
}
export interface RecoveryReport {
    mode: RecoveryMode;
    sessions: RecoveryReportSession[];
    truncated: boolean;
    totalRecords: number;
}
export interface RecoveryReportOptions {
    /** Include PIN-protected private sessions; callers must gate this on private unlock. */
    includePrivate?: boolean;
}
export interface RecoveryRetryOptions {
    /** Include PIN-protected private sessions; defaults false (fail closed). */
    includePrivate?: boolean;
}
export interface RecoveryRetryAllOptions {
    /** Include PIN-protected private sessions; defaults false (fail closed). */
    includePrivate?: boolean;
}
export interface RecoveryRunner {
    start(): Promise<void>;
    retry(id: string, options?: RecoveryRetryOptions): Promise<RecoveryOutcome>;
    /** Explicitly retries failed rows and pending tmux-lost sessions, one at a time. */
    retryAll(options?: RecoveryRetryAllOptions): Promise<RecoveryOutcome[]>;
    /** Marks routes affected by confirmed tmux server loss as restore-only immediately on detection. */
    markLostRestoreOnly(ids: readonly string[]): void;
    /** Marks sessions lost when pi-dish's tmux server died without auto-relaunching them. */
    markLost(ids: readonly string[], reason?: string): Promise<RecoveryOutcome[]>;
    /** True while a recovery launch/check flight is currently active for `id`. */
    isRecovering(id: string): boolean;
    report(options?: RecoveryReportOptions): RecoveryReport;
    outcome(id: string): RecoveryOutcome | null;
    stop(): void;
}
export type RecoveryRunnerStore = Pick<typeof recoveryStore, 'listRecords' | 'readRecord' | 'getControl' | 'patchControl' | 'checkpointMatches'>;
export interface RecoveryPresentationOptions {
    getMode(): unknown;
    now?: () => number;
    log?: {
        error?: (message: string) => void;
    };
    /** Memory-pressure hibernation keeps a session for wake-on-message, not startup restore. */
    hibernated?(routeId: string): boolean;
    /** Completed one-shot routines awaiting auto-close must not be resurrected by loss recovery. */
    isPendingClose?(routeId: string): boolean;
    /** Identifies private PIN-gated sessions so locked reports and retries omit/refuse them. */
    isPrivate?(record: RecoveryRecord): boolean;
    /** Returns a refusal reason if startup recovery for `routeId` is suppressed by persisted tmux-loss backoff. */
    suppressedAtStartup?(routeId: string): string | null;
}
/** Isolated runner seams; production policy is composed by createRecoveryRuntime below. */
export interface RecoveryRunnerOptions extends RecoveryPresentationOptions {
    store: RecoveryRunnerStore;
    routeId: typeof recoveryRouteId;
    probeLive: SessionOperations['probeRecoveryLive'];
    validateRecord: typeof validateRecoveryRecord;
    restore(record: RecoveryRecord): Promise<ResumeSessionResult>;
    continueSession(record: RecoveryRecord, session: LiveSession, message: string): Promise<void>;
}
export interface RecoveryRuntimeOptions extends RecoveryPresentationOptions {
    operations: SessionOperations;
    ownership: SessionOwnership;
}
export declare const RECOVERY_PROMPT = "pi-dish recovery: this session was interrupted while work was in progress. Before continuing, inspect the transcript, working files, and any external state affected by prior tools. A tool or external action may have completed without its result being recorded. Do not blindly repeat commands, writes, deployments, purchases, or other side effects. Reconcile what actually happened, explain any uncertainty, and ask for confirmation where safe continuation cannot be established. Continue the existing task only after this inspection; this message is not an instruction to replay the last prompt or retry a tool.";
export declare function recoveryMode(value: unknown): RecoveryMode;
export declare function continuationSafety(file: string): Promise<string | null>;
export declare function createRecoveryRunner(deps: RecoveryRunnerOptions): RecoveryRunner;
export interface TmuxLossLimiterOptions {
    /** Override state file path; defaults to ~/.pi/dish/tmux-recovery-state.json. */
    file?: () => string;
    now?: () => number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    windowMs?: number;
    maxAttempts?: number;
}
export type TmuxLossVerdict = {
    allowed: true;
} | {
    allowed: false;
    retryAt: number | null;
    reason: string;
};
export interface TmuxLossLimiter {
    check(at?: number): TmuxLossVerdict;
    record(at?: number): void;
}
/**
 * Durable exponential-backoff and rolling-window limiter for automatic tmux
 * server-loss recovery. Persisted on disk so crash loops across pi-dish
 * restarts cannot respawn forever; fails closed if the state file is corrupt.
 */
export declare function createTmuxLossLimiter(options?: TmuxLossLimiterOptions): TmuxLossLimiter;
export interface WatchedTmuxServerSessions {
    agentIds: string[];
    botIds: string[];
    /** Live processes inside the server's panes (pane roots + agents/bots) to wait out on loss. */
    processes: ProcessIdentity[];
}
export interface TmuxServerLossEvent {
    server: ProcessIdentity;
    replacementPid: number | null;
    agentIds: string[];
    botIds: string[];
}
export interface TmuxServerWatchOptions {
    socket: string;
    inspectServer(socket: string): Promise<TmuxServerSnapshot | null>;
    /** Called only after verifying at least one live pi-dish placement inside the server. */
    configureServer?(socket: string): Promise<boolean | void>;
    snapshotSessions(socket: string, panes: ReadonlyMap<string, LiveTmuxPane>): WatchedTmuxServerSessions;
    /** Fired synchronously as soon as server loss is confirmed, before waiting for process exit. */
    onLossDetected?(event: TmuxServerLossEvent): void;
    onLost(event: TmuxServerLossEvent): Promise<unknown>;
    intervalMs?: number;
    /** Post-exit settle delay after dead-pane processes exit (default 500 ms). */
    settleMs?: number;
    /** Maximum time to wait for hung-up pane processes to exit before relaunching (default 10 s). */
    exitWaitMs?: number;
    processAlive?: (identity: ProcessIdentity) => boolean;
    log?: {
        error?: (message: string) => void;
    };
}
export interface TmuxServerWatch {
    /** One poll; coalesced single-flight with concurrent checks. */
    tick(): Promise<void>;
    /** Trigger an immediate coalesced check (e.g., on tmux no-server error or after spawn). */
    checkNow(): void;
    stop(): void;
}
/**
 * Watches one tmux server (pi-dish's own socket). Remembers its exact process
 * identity and the live agents/bots verified inside its non-dead panes. Only
 * when that server process exits or is replaced by a different server are those
 * agents and bots handed to `onLost` — never when one session exits while the
 * server stays alive, and never when a running server is merely slow to answer.
 */
export declare function watchTmuxServer({ socket, inspectServer, configureServer, snapshotSessions, onLossDetected, onLost, intervalMs, settleMs, exitWaitMs, processAlive, log, }: TmuxServerWatchOptions): TmuxServerWatch;
/** Checked production restore/delivery policy; callers provide owners and presentation, not authority callbacks. */
export declare function createRecoveryRuntime({ operations, ownership, getMode, now, log, hibernated, isPendingClose, isPrivate, suppressedAtStartup, }: RecoveryRuntimeOptions): RecoveryRunner;
