// Generated from src/core/session-operations.ts; edit that source and run npm run build:core.
import type { SessionSource } from './session-source-contracts';
import type { BeforeLifecycleAction, LiveSession, SessionOwnership } from './session-ownership';
import type { HarnessLaunchTarget, SessionLaunch } from './session-launch';
import type { RecoveryRecord } from './session-recovery';
export interface ActiveSessionObservation {
    id: string;
    harnessId: unknown;
    sessionFile?: unknown;
}
export interface SessionOperationObservations {
    ownership: SessionOwnership;
    launch: SessionLaunch;
    /** Catalog and transcript observations only; admission belongs to this owner. */
    getActiveSessions(): unknown;
    readSessionCwd(source: SessionSource): unknown;
    recordLaunchProvenance(sessionId: string, sourceSessionId: string, operationId: string): void;
}
export interface CreateSessionOptions {
    harness?: unknown;
    name?: string | null;
    model?: string;
    thinking?: string;
    cwd?: string;
    target?: HarnessLaunchTarget | null;
    sourceSessionId?: string | null;
}
export interface ResumeSessionOptions {
    model?: unknown;
    target?: HarnessLaunchTarget | null;
    recovery?: RecoveryRecord | null;
}
export interface ResumeSessionResult {
    success: true;
    id: string;
    alreadyActive?: true;
    sharedResume?: true;
}
export type SessionSpawnOperation = {
    status: 'starting';
    createdAt: number;
} | {
    status: 'ready';
    createdAt: number;
    sessionId: string;
} | {
    status: 'error';
    createdAt: number;
    error: string;
};
interface CloseIntentState {
    preserve: boolean;
    stopped: boolean;
}
interface OperationFailure {
    status: number;
    error: string;
    cause?: unknown;
    /** Prime close exposes this separately from its HTTP body. */
    closeIntent?: CloseIntentState;
    /** Prime restart exposes uncertain stop in its body, not close-only metadata. */
    reportStopUncertain?: true;
}
export interface NoActionOutcome extends OperationFailure {
    kind: 'no-action';
}
export interface StoppedOutcome {
    kind: 'stopped';
    replacement?: {
        id: string;
        placement: 'rpc' | 'tmux';
        paneId?: string;
    };
}
export interface StopUncertainOutcome extends OperationFailure {
    kind: 'stop-uncertain';
}
export interface CleanupFailedOutcome extends OperationFailure {
    kind: 'cleanup-failed';
    stopped: boolean;
}
export interface ReplacementNotReadyOutcome extends OperationFailure {
    kind: 'replacement-not-ready';
    stopped: true;
}
export type SessionOperationOutcome = NoActionOutcome | StoppedOutcome | StopUncertainOutcome | CleanupFailedOutcome | ReplacementNotReadyOutcome;
export interface SessionOperationBody {
    success?: true;
    error?: string;
    id?: string;
    placement?: 'rpc' | 'tmux';
    paneId?: string;
    stopped?: true;
    stopUncertain?: true;
}
export interface SessionOperationResponse {
    status: number;
    body: SessionOperationBody;
    preserveCloseIntent?: boolean;
    stopped?: boolean;
}
/** Wire compatibility is separate from whether a destructive action actually completed. */
export declare function sessionOperationResponse(outcome: SessionOperationOutcome): SessionOperationResponse;
export declare class SessionOperationError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export interface SessionOperations {
    createSession(options: CreateSessionOptions): Promise<string>;
    startSessionSpawn(options: CreateSessionOptions): string;
    getSessionSpawn(spawnId: string): SessionSpawnOperation | undefined;
    recordSessionLaunch(sessionId: string, sourceSessionId: string, operationId?: string): string | null;
    resumeSessionById(requestedId: string, options?: ResumeSessionOptions): Promise<ResumeSessionResult>;
    probeRecoveryLive(record: RecoveryRecord): Promise<LiveSession | null>;
    assertNoConflictingWriter(sessionId: string, canonicalFile: string): void;
    closeSession(sessionId: string): Promise<SessionOperationOutcome>;
    closeSessionById(sessionId: string): Promise<SessionOperationResponse>;
    restartSession(sessionId: string, options?: {
        beforeAction?: BeforeLifecycleAction | null;
    }): Promise<SessionOperationOutcome>;
    restartSessionById(sessionId: string, options?: {
        beforeAction?: BeforeLifecycleAction | null;
    }): Promise<SessionOperationResponse>;
    hasCloseFlight(canonicalRoute: string): boolean;
    hasRestartFlight(canonicalRoute: string): boolean;
    hasResumeFlight(canonicalFile: string): boolean;
    /** Execution exclusion is intentionally not resume/close/restart admission. */
    beginBounceAction(canonicalRoute: string, live: LiveSession): void;
    endBounceAction(canonicalRoute: string, live: LiveSession): void;
    hasBounceAction(canonicalRoute: string): boolean;
    admitHttpAction(requestedId: string, method: string): SessionOperationResponse | null;
}
export declare function createSessionOperations(observations: SessionOperationObservations): SessionOperations;
export {};
