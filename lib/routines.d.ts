// Generated from src/core/routines.ts; edit that source and run npm run build:core.
export type RoutineMode = 'oneShot' | 'continue';
export type RoutineDelivery = 'prompt' | 'steer' | 'followUp';
export type RoutineStatus = 'starting' | 'running' | 'completed' | 'errored' | 'interrupted' | 'skipped';
export type RoutineThinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RoutineOnBusy = 'skip' | 'steer' | 'followUp';
export type RoutineTrigger = 'invoke' | 'schedule';
export interface RoutineVersion {
    version: number;
    prompt: string;
    savedAt: number;
}
export interface Routine {
    id: string;
    name: string;
    description: string;
    harness: string;
    cwd: string;
    model?: string;
    thinking?: RoutineThinking;
    prompt: string;
    promptVersion: number;
    versions: RoutineVersion[];
    schedule: {
        cron: string;
    } | null;
    enabled: boolean;
    mode: RoutineMode;
    onBusy: RoutineOnBusy;
    minIntervalSec: number;
    lastScheduledMinute: number | null;
    createdAt: number;
    updatedAt: number;
}
export interface RoutineInvocation {
    id: string;
    routineId: string;
    routineName: string;
    version: number;
    trigger: RoutineTrigger;
    source: string | null;
    delivery: RoutineDelivery;
    status: RoutineStatus;
    skipReason: string | null;
    sessionId: string | null;
    startedAt: number;
    endedAt: number | null;
    durationMs: number | null;
    error: string | null;
    input: unknown;
    summary: string | null;
    closed: boolean;
    closeError: string | null;
}
export interface NewInvocation {
    routine: Routine;
    status: RoutineStatus;
    trigger?: RoutineTrigger;
    source?: string | null;
    input?: unknown;
    delivery?: RoutineDelivery;
    skipReason?: string | null;
    sessionId?: string | null;
    startedAt?: number;
    error?: string | null;
}
export type InvocationPatch = Partial<Pick<RoutineInvocation, 'status' | 'sessionId' | 'endedAt' | 'durationMs' | 'error' | 'summary' | 'closed' | 'closeError' | 'delivery' | 'skipReason'>>;
export interface ListInvocationOptions {
    routineId?: string | null;
    limit?: number;
    before?: number | null;
}
export declare const MAX_INVOCATIONS = 5000;
export declare const MAX_VERSIONS = 50;
export declare const MAX_PROMPT = 100000;
export declare const MAX_INPUT_BYTES: number;
export declare const MAX_SOURCE = 100;
export declare function readRoutines(): Record<string, Routine>;
export declare function listRoutines(): Routine[];
/** Routines are addressed by uuid or by their (case-insensitive) unique name. */
export declare function getRoutine(ref: string): Routine | null;
export declare function createRoutine(input?: unknown): Routine;
/** Only changed prompt text appends a version; ordinary edits do not. */
export declare function updateRoutine(ref: string, patch?: unknown): Routine | null;
export declare function deleteRoutine(ref: string): Routine | null;
/** Persist the fired minute to prevent double-firing after a same-minute restart. */
export declare function markScheduled(id: string, minuteMs: number): Routine | null;
export declare function readInvocations(): RoutineInvocation[];
/** UTF-8 size of the JSON form callers persist; null and undefined are empty. */
export declare function inputBytes(input: unknown): number;
export declare function createInvocation({ routine, status, trigger, source, input, delivery, skipReason, sessionId, startedAt, error, }: NewInvocation): RoutineInvocation;
/** Read-modify-write of one entry. Every status change hits disk. */
export declare function updateInvocation(id: string, patch: InvocationPatch): RoutineInvocation | null;
export declare function getInvocation(id: string): RoutineInvocation | null;
/** Newest first; before is an exclusive startedAt cursor. */
export declare function listInvocations({ routineId, limit, before }?: ListInvocationOptions): RoutineInvocation[];
export declare function countInvocations(routineId: string): number;
export declare function lastInvocation(routineId: string, predicate?: ((entry: RoutineInvocation) => boolean) | null): RoutineInvocation | null;
/** The invocation currently occupying the routine, if any (busy := this). */
export declare function activeInvocation(routineId: string): RoutineInvocation | null;
export declare function activeInvocations(): RoutineInvocation[];
export declare function countActive(routineId: string): number;
/** Latest invocation per session id; presentation-only provenance, never authority. */
export declare function invocationsBySessionId(): Map<string, RoutineInvocation>;
