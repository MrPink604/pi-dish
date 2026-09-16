// Generated from src/core/routines.ts; edit that source and run npm run build:core.
export type RoutineMode = 'oneShot' | 'continue';
export type RoutineDelivery = 'prompt' | 'steer' | 'followUp';
export type RoutineStatus = 'starting' | 'running' | 'completed' | 'errored' | 'interrupted' | 'skipped';
export type RoutineThinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RoutineOnBusy = 'skip' | 'steer' | 'followUp';
/** Persisted rows establish only id; other fields and extra keys remain untrusted. */
export interface Routine extends Record<string, unknown> {
    id: string;
    name?: unknown;
    description?: unknown;
    harness?: unknown;
    cwd?: unknown;
    model?: unknown;
    thinking?: unknown;
    prompt?: unknown;
    promptVersion?: unknown;
    versions?: unknown;
    schedule?: unknown;
    enabled?: unknown;
    mode?: unknown;
    onBusy?: unknown;
    minIntervalSec?: unknown;
    lastScheduledMinute?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
}
export interface RoutineInvocation extends Record<string, unknown> {
    id: string;
    routineId?: unknown;
    routineName?: unknown;
    version?: unknown;
    trigger?: unknown;
    source?: unknown;
    delivery?: unknown;
    status?: unknown;
    skipReason?: unknown;
    sessionId?: unknown;
    startedAt?: unknown;
    endedAt?: unknown;
    durationMs?: unknown;
    error?: unknown;
    input?: unknown;
    summary?: unknown;
    closed?: unknown;
    closeError?: unknown;
}
export declare const MAX_INVOCATIONS = 5000;
export declare const MAX_VERSIONS = 50;
export declare const MAX_PROMPT = 100000;
export declare const MAX_SOURCE = 100;
export declare const MAX_INPUT_BYTES: number;
export declare const NAME_RE: RegExp;
export declare const THINKING_LEVELS: RoutineThinking[];
export declare const MODES: RoutineMode[];
export declare const ON_BUSY: RoutineOnBusy[];
export declare const DELIVERIES: RoutineDelivery[];
export declare const STATUSES: RoutineStatus[];
export declare function readRoutines(): Record<string, Routine>;
export declare function listRoutines(): Routine[];
/** Routines are addressed by uuid or by their (case-insensitive) unique name. */
export declare function getRoutine(ref: unknown): Routine | null;
export declare function createRoutine(input?: unknown): Routine;
/** Only changed prompt text appends a version; ordinary edits do not. */
export declare function updateRoutine(ref: unknown, patch?: unknown): Routine | null;
export declare function deleteRoutine(ref: unknown): Routine | null;
/** Persist the fired minute to prevent double-firing after a same-minute restart. */
export declare function markScheduled(id: unknown, minuteMs: unknown): Routine | null;
export declare function readInvocations(): RoutineInvocation[];
export declare function serializedInputSize(input: unknown): number;
export declare function createInvocation(fields?: unknown): RoutineInvocation;
/** Read-modify-write of one entry. Every status change hits disk. */
export declare function updateInvocation(id: unknown, patch?: unknown): RoutineInvocation | null;
export declare function getInvocation(id: unknown): RoutineInvocation | null;
/** Newest first; before is an exclusive startedAt cursor. */
export declare function listInvocations(options?: unknown): RoutineInvocation[];
export declare function countInvocations(routineId: unknown): number;
export declare function lastInvocation(routineId: unknown, predicate?: ((entry: RoutineInvocation) => unknown) | null): RoutineInvocation | null;
/** The invocation currently occupying the routine, if any (busy := this). */
export declare function activeInvocation(routineId: unknown): RoutineInvocation | null;
export declare function activeInvocations(): RoutineInvocation[];
export declare function countActive(routineId: unknown): number;
/** Latest invocation per session id; presentation-only provenance, never authority. */
export declare function invocationsBySessionId(): Map<unknown, RoutineInvocation>;
/** Existing module surface, shared by consumers without a factory-derived port. */
export interface RoutineStore {
    readRoutines: typeof readRoutines;
    listRoutines: typeof listRoutines;
    getRoutine: typeof getRoutine;
    createRoutine: typeof createRoutine;
    updateRoutine: typeof updateRoutine;
    deleteRoutine: typeof deleteRoutine;
    markScheduled: typeof markScheduled;
    readInvocations: typeof readInvocations;
    createInvocation: typeof createInvocation;
    updateInvocation: typeof updateInvocation;
    getInvocation: typeof getInvocation;
    listInvocations: typeof listInvocations;
    countInvocations: typeof countInvocations;
    lastInvocation: typeof lastInvocation;
    activeInvocation: typeof activeInvocation;
    activeInvocations: typeof activeInvocations;
    countActive: typeof countActive;
    invocationsBySessionId: typeof invocationsBySessionId;
    serializedInputSize: typeof serializedInputSize;
    MAX_INVOCATIONS: typeof MAX_INVOCATIONS;
    MAX_VERSIONS: typeof MAX_VERSIONS;
    MAX_PROMPT: typeof MAX_PROMPT;
    MAX_INPUT_BYTES: typeof MAX_INPUT_BYTES;
    MAX_SOURCE: typeof MAX_SOURCE;
    THINKING_LEVELS: typeof THINKING_LEVELS;
    MODES: typeof MODES;
    ON_BUSY: typeof ON_BUSY;
    DELIVERIES: typeof DELIVERIES;
    STATUSES: typeof STATUSES;
    NAME_RE: typeof NAME_RE;
}
