// Generated from src/core/routine-runner.ts; edit that source and run npm run build:core.
import { type ParsedCron } from './cron';
import type { Routine, RoutineInvocation, RoutineTrigger } from './routines';
import type { SessionOperations } from './session-operations';
import type { LiveSession, SessionOwnership } from './session-ownership';
import type { RecoveryOutcome } from './recovery-runner';
import type { BridgeCapability } from './contracts';
export interface RoutineInvokeOptions {
    trigger?: RoutineTrigger;
    source?: string | null;
    input?: unknown;
    /** A scheduled run: the minute it stands for, and the earlier runs that were missed. */
    slot?: ScheduledSlot;
}
/** `late`: runs of the schedule since `since` that did not happen (pi-dish was down), which this one run stands for. */
export interface ScheduledSlot {
    at: number;
    late: number;
    since: number | null;
}
/** A message for a bot: delivered once per request id. */
export interface RoutineBotMessage {
    requestId: string;
    text: string;
    data: Record<string, string | number>;
}
/** What a routine whose destination is a bot reaches. */
export interface RoutineBots {
    /** The bot: its name, whether it is retired, and its session route; null when there is no such bot. */
    find(id: string): {
        name: string;
        retired: boolean;
        route: string;
    } | null;
    /**
     * Hands the message to the bot's relay, starting the bot when it is not running; resolves whether the bot was
     * busy, so the message waits as a follow-up. Throws when it could not be delivered.
     */
    deliver(id: string, message: RoutineBotMessage): Promise<{
        queued: boolean;
    }>;
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
    /** Where routines whose destination is a bot are delivered; absent where bots do not run. */
    bots?: RoutineBots | null;
    now?(): number;
    log?: {
        error?(message: string): void;
        warn?(message: string): void;
    };
}
export declare const DEFAULT_CLOSE_GRACE_MS = 10000;
export declare const STARTING_WATCHDOG_MS: number;
export declare const TICK_MS = 30000;
/**
 * The run a scheduler tick at `minute` owes a routine, or null. It is the current minute when the schedule matches it;
 * otherwise the newest slot since the routine last fired or was last edited that never ran, because pi-dish was down
 * or asleep. Either way it is one run, which counts the slots missed before it.
 */
export declare function routineDueSlot(parsed: ParsedCron, routine: Routine, minute: number): ScheduledSlot | null;
/**
 * When the scheduler next runs `routine` from `at` on: at once when a tick in this minute owes it a run (its minute
 * matches, or it catches up a missed one), else at its next match. Null for a disabled, unscheduled or unparseable one.
 */
export declare function nextScheduledRun(routine: Routine, at: number): number | null;
export declare function createRoutineRunner(deps: RoutineRunnerPorts): RoutineRunner;
