// Generated from src/core/routine-runner.ts; edit that source and run npm run build:core.
/**
 * The routine runner: trigger → spawn/deliver → observe → close.
 *
 * Every side effect it can have arrives as an injected dep, so the whole
 * lifecycle (including the restart-recovery and watchdog paths, which are hard
 * to provoke against a real pi) is testable without booting a spawn backend.
 * Nothing here branches on a harness id — capability questions go through the
 * `supports` dep, exactly as the spawn/prompt routes go through
 * `liveSessionSupports`.
 */
import type { Routine, RoutineInvocation, RoutineStore } from './routines';
import type { SessionOperations } from './session-operations';
import type { LiveSession, SessionOwnership } from './session-ownership';
import type { RecoveryOutcome } from './recovery-runner';
import type { BridgeCapability } from './contracts';
export interface RoutineInvokeOptions {
    trigger?: 'invoke' | 'schedule';
    source?: unknown;
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
    store: RoutineStore;
    createSession: SessionOperations['createSession'];
    resumeSession: SessionOperations['resumeSessionById'];
    getLiveSession: SessionOwnership['getLiveSession'];
    closeSession: SessionOperations['closeSessionById'];
    composePrompt(routine: Routine, invocation: RoutineInvocation): string | Promise<string>;
    isTurnInProgress?(session: LiveSession): boolean;
    supports?(session: LiveSession, capability: BridgeCapability): boolean;
    recoveryOutcome?(sessionId: unknown): Pick<RecoveryOutcome, 'status' | 'reason'> | null;
    now?(): number;
    log?: {
        error?(message: string): void;
        warn?(message: string): void;
    };
}
export declare const DEFAULT_CLOSE_GRACE_MS = 10000;
export declare const STARTING_WATCHDOG_MS: number;
export declare const TICK_MS = 30000;
/** Scheduling and ledger policy consume the sole lifecycle coordinator directly. */
export declare function createRoutineRunner(deps: RoutineRunnerPorts): RoutineRunner;
