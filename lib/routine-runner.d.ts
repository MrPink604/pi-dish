// Generated from src/core/routine-runner.ts; edit that source and run npm run build:core.
import type { Routine, RoutineInvocation, RoutineTrigger } from './routines';
import type { SessionOperations } from './session-operations';
import type { LiveSession, SessionOwnership } from './session-ownership';
import type { RecoveryOutcome } from './recovery-runner';
import type { BridgeCapability } from './contracts';
export interface RoutineInvokeOptions {
    trigger?: RoutineTrigger;
    source?: string | null;
    input?: unknown;
}
export interface RoutineRunner {
    invoke(routine: Routine, options?: RoutineInvokeOptions): RoutineInvocation;
    tick(at?: number): void;
    nextRunAt(routine: Routine | null | undefined, from?: number): number | null;
    recoverAfterRestart(at?: number): Promise<void>;
    waitForInvocation(id: string, timeoutMs?: number): Promise<RoutineInvocation | null>;
    start(): void;
    stop(): void;
    readonly watching: number;
}
export interface RoutineRunnerPorts {
    createSession: SessionOperations['createSession'];
    resumeSession: SessionOperations['resumeSessionById'];
    getLiveSession: SessionOwnership['getLiveSession'];
    closeSession: SessionOperations['closeSessionById'];
    composePrompt(routine: Routine, invocation: RoutineInvocation): string | Promise<string>;
    isTurnInProgress?(session: LiveSession): boolean;
    supports?(session: LiveSession, capability: BridgeCapability): boolean;
    recoveryOutcome?(sessionId: string): Pick<RecoveryOutcome, 'status' | 'reason'> | null;
    now?(): number;
    log?: {
        error?(message: string): void;
        warn?(message: string): void;
    };
}
export declare const DEFAULT_CLOSE_GRACE_MS = 10000;
export declare const STARTING_WATCHDOG_MS: number;
export declare const TICK_MS = 30000;
export declare function createRoutineRunner(deps: RoutineRunnerPorts): RoutineRunner;
