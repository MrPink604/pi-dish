// Generated from src/core/turn-error-entry.ts; edit that source and run npm run build:core.
/**
 * A terminal assistant error the harness keeps out of its session file. OMP
 * never persists a classifier refusal (`stopDetails.type` refusal/sensitive,
 * e.g. "Refusal (cyber)"), so the transcript otherwise just stops. The bridge
 * records it with the extension API's appendEntry: a `custom` entry, which
 * harnesses never replay to the model.
 */
export declare const TURN_ERROR_ENTRY_TYPE = "pi-dish-turn-error";
export interface TurnErrorEntryData {
    readonly errorMessage: string;
    readonly model?: string;
    readonly provider?: string;
    readonly timestamp?: number | string;
}
/** The persisted fields of an assistant error message or a stored entry's data; null without an error. */
export declare function turnErrorData(value: unknown): TurnErrorEntryData | null;
/** OMP's classifier-refusal test (turn-recovery isClassifierRefusal, verified 18.18). */
export declare function isUnpersistedOmpRefusal(message: unknown): boolean;
