// Generated from src/core/session-operations.ts; edit that source and run npm run build:core.
import type { ProcessIdentity } from './contracts';
import type { SessionSource } from './session-source';
import type { BeforeLifecycleAction, LiveSession, SessionOwnership } from './session-ownership';
import type { HarnessLaunchTarget, SessionLaunch } from './session-launch';
import { type CuBrokerCapabilities } from './cu-agent-leases';
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
    getActiveSessions(): readonly ActiveSessionObservation[];
    readSessionCwd(source: SessionSource): unknown;
    recordLaunchProvenance(sessionId: string, sourceSessionId: string, operationId: string, sourceBasis?: string | null): void;
    /** Invoked after a session is explicitly closed or hibernated so external leases release/cancel cleanly. */
    onSessionStopped?(sessionId: string): Promise<void> | void;
    /** Checks whether a Slice-2 capable CU broker manages omp sessions on this host (throws 503 if configured broker is unreachable). */
    cuCheckSlice2?(): Promise<boolean>;
    /** Probes Slice-2 and Slice-2b capabilities before restart (preferred over `cuCheckSlice2` when provided). */
    cuCheckCapabilities?(): Promise<CuBrokerCapabilities>;
    /** True when the session currently holds a transferable authenticated CU lease. */
    cuCanTransferSession?(sessionId: string): boolean;
    /** True while startup reconciliation is still verifying this session's CU lease (`checking` state). */
    cuIsChecking?(sessionId: string): boolean;
}
export interface CreateSessionOptions {
    harness?: unknown;
    name?: string | null;
    model?: unknown;
    thinking?: unknown;
    cwd?: unknown;
    target?: HarnessLaunchTarget | null;
    sourceSessionId?: string | null;
    sourceBasis?: string | null;
    /** HTTP `private` flag; only harnesses with a private root support it. */
    private?: boolean;
}
export interface ResumeSessionOptions {
    model?: unknown;
    target?: HarnessLaunchTarget | null;
    recovery?: RecoveryRecord | null;
    /** Bind headless tmux launch to one exact already-running server (-N, no server creation, no RPC fallback). */
    expectedTmuxServer?: ProcessIdentity | null;
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
    code?: string;
    httpStatus?: number;
    state?: string | null;
    epoch?: number | null;
    holder?: Record<string, unknown> | null;
    retryable?: boolean;
    brokerCode?: string;
    applied?: boolean | 'unknown';
    uncertain?: true;
    retryAfterMs?: number;
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
    code?: string;
    retryable?: boolean;
    brokerCode?: string;
    applied?: boolean | 'unknown';
    uncertain?: true;
    retryAfterMs?: number;
    state?: string | null;
    epoch?: number | null;
    holder?: Record<string, unknown> | null;
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
export declare class SessionOperationError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
/** Bulk actions capture a tmux pane or daemon worker. */
export type BounceLiveSession = LiveSession;
export interface SessionOperations {
    createSession(options: CreateSessionOptions): Promise<string>;
    startSessionSpawn(options: CreateSessionOptions): string;
    getSessionSpawn(spawnId: string): SessionSpawnOperation | undefined;
    recordSessionLaunch(sessionId: string, sourceSessionId: string, operationId?: string, sourceBasis?: string | null): string | null;
    resumeSessionById(requestedId: unknown, options?: ResumeSessionOptions): Promise<ResumeSessionResult>;
    probeRecoveryLive(record: RecoveryRecord): Promise<LiveSession | null>;
    closeSession(sessionId: unknown, options?: {
        beforeAction?: BeforeLifecycleAction | null;
    }): Promise<SessionOperationOutcome>;
    closeSessionById(sessionId: unknown, options?: {
        beforeAction?: BeforeLifecycleAction | null;
    }): Promise<SessionOperationResponse>;
    restartSession(sessionId: string, options?: {
        beforeAction?: BeforeLifecycleAction | null;
    }): Promise<SessionOperationOutcome>;
    restartSessionById(sessionId: string, options?: {
        beforeAction?: BeforeLifecycleAction | null;
    }): Promise<SessionOperationResponse>;
    /** Graceful stop that keeps recovery intent and resumability; never an explicit close. */
    hibernateSession(sessionId: string, options: {
        beforeAction: BeforeLifecycleAction;
    }): Promise<SessionOperationOutcome>;
    /** Execution exclusion is intentionally not resume/close/restart admission. */
    beginBounceAction(canonicalRoute: string, live: BounceLiveSession): void;
    endBounceAction(canonicalRoute: string, live: BounceLiveSession): void;
    waitBounceActionUnlock(requestedId: string): Promise<void>;
    admitHttpAction(requestedId: string, method: string): SessionOperationResponse | null;
}
export declare function createSessionOperations(observations: SessionOperationObservations): SessionOperations;
export {};
