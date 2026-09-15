// Generated from src/core/session-recovery.ts; edit that source and run npm run build:core.
export type RecoveryActivity = 'idle' | 'running' | 'uncertain';
export interface RecoveryCheckpoint {
    size: number;
    mtimeMs: number;
}
/** Persisted identities are strings, not validated route/process authority. */
export type RecoveryRecord = {
    version: 1;
    harnessId: string;
    nativeSessionId: string;
    sessionFile: string;
    cwd: string;
    name: string | null;
    model: string | null;
    thinkingLevel: string | null;
    pid: number;
    startTime: string | null;
    instanceId: string;
    activity: RecoveryActivity;
    runId: string | null;
    shutdown: boolean;
    bootId: string | null;
    checkpoint: RecoveryCheckpoint | null;
    observationId: string;
    updatedAt: string;
};
/** Only the object envelope is checked. Keep legacy fields verbatim, including
 * malformed launch/delivery markers: unknown evidence is not absent evidence.
 * Consumers must narrow these fields before using them as process or replay proof.
 */
export interface RecoveryAttempt extends Record<string, unknown> {
    id?: unknown;
    observationId?: unknown;
    status?: unknown;
    reason?: unknown;
    updatedAt?: unknown;
    delivery?: unknown;
    launch?: unknown;
}
export interface RecoveryControl {
    excluded: boolean;
    closed: boolean;
    attempt: RecoveryAttempt | null;
}
export interface RecoveryControlPatch {
    excluded?: boolean;
    closed?: boolean;
    attempt?: RecoveryAttempt | null;
}
/** Observation input is not a decoded store record. Metadata is nullable and
 * untrusted; the writer retains its existing normalization and startTime coercion.
 */
export interface RecoverySnapshot {
    harnessId: string;
    nativeSessionId: string;
    sessionFile: string;
    cwd: string;
    name?: unknown;
    model?: unknown;
    thinkingLevel?: unknown;
    pid: unknown;
    startTime?: unknown;
    instanceId: string;
}
export interface RecoveryObservation extends RecoverySnapshot {
    activity: RecoveryActivity;
    runId?: unknown;
    shutdown?: unknown;
}
export interface RecoveryObserver {
    initialize(): void;
    event(type: string, data?: unknown): void;
    dispose(): void;
}
export interface RecoveryObserverOptions {
    snapshot: () => RecoverySnapshot | null;
    canWrite?: () => boolean;
    waitsForSettled?: boolean;
}
export declare function bootId(): string | null;
export declare function readRecord(harnessId: string, nativeSessionId: string): RecoveryRecord | null;
export declare function listRecords(): RecoveryRecord[];
export declare function checkpointMatches(record: unknown): boolean;
export declare function recordSession(snapshot: RecoveryObservation | null): RecoveryRecord | null;
export declare function getControl(harnessId: string, nativeSessionId: string): RecoveryControl;
export declare function patchControl(harnessId: string, nativeSessionId: string, patch: RecoveryControlPatch): RecoveryControl;
/** Lifecycle observer shared by bridge owners and bridge-less RPC fallback.
 * Never writes the server-owned controls. Reload/startup is not new activity;
 * delayed checkpoints are cancelled when this observer loses its identity.
 */
export declare function createSessionObserver({ snapshot: readSnapshot, canWrite: writeAllowed, waitsForSettled }: RecoveryObserverOptions): RecoveryObserver;
