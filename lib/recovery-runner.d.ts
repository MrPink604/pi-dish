// Generated from src/core/recovery-runner.ts; edit that source and run npm run build:core.
import type { ResumeSessionResult, SessionOperations } from './session-operations';
import { recoveryRouteId, validateRecoveryRecord } from './session-ownership';
import type { LiveSession, SessionOwnership } from './session-ownership';
import * as recoveryStore from './session-recovery';
import type { RecoveryRecord } from './session-recovery';
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
export interface RecoveryRunner {
    start(): Promise<void>;
    retry(id: string): Promise<RecoveryOutcome>;
    report(): RecoveryReport;
    outcome(id: unknown): RecoveryOutcome | null;
    stop(): void;
}
export type RecoveryRunnerStore = Pick<typeof recoveryStore, 'listRecords' | 'readRecord' | 'getControl' | 'patchControl' | 'checkpointMatches'>;
export interface RecoveryPresentationOptions {
    getMode(): unknown;
    now?: () => number;
    log?: {
        error?: (message: string) => void;
    };
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
/** Checked production restore/delivery policy; callers provide owners and presentation, not authority callbacks. */
export declare function createRecoveryRuntime({ operations, ownership, getMode, now, log }: RecoveryRuntimeOptions): RecoveryRunner;
