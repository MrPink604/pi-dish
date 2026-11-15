import { record } from './helper-values.js';

/**
 * A terminal assistant error the harness keeps out of its session file. OMP
 * never persists a classifier refusal (`stopDetails.type` refusal/sensitive,
 * e.g. "Refusal (cyber)"), so the transcript otherwise just stops. The bridge
 * records it with the extension API's appendEntry: a `custom` entry, which
 * harnesses never replay to the model.
 */
export const TURN_ERROR_ENTRY_TYPE = 'pi-dish-turn-error';

export interface TurnErrorEntryData {
  readonly errorMessage: string;
  readonly model?: string;
  readonly provider?: string;
  readonly timestamp?: number | string;
}

/** The persisted fields of an assistant error message or a stored entry's data; null without an error. */
export function turnErrorData(value: unknown): TurnErrorEntryData | null {
  if (!record(value) || typeof value.errorMessage !== 'string' || !value.errorMessage) return null;
  const { errorMessage, model, provider, timestamp } = value;
  return {
    errorMessage,
    ...(typeof model === 'string' && model ? { model } : {}),
    ...(typeof provider === 'string' && provider ? { provider } : {}),
    ...(typeof timestamp === 'number' && Number.isFinite(timestamp) || typeof timestamp === 'string' ? { timestamp } : {}),
  };
}

/** OMP's classifier-refusal test (turn-recovery isClassifierRefusal, verified 18.18). */
export function isUnpersistedOmpRefusal(message: unknown): boolean {
  if (!record(message) || message.role !== 'assistant' || message.stopReason !== 'error') return false;
  const type = record(message.stopDetails) ? message.stopDetails.type : undefined;
  return type === 'refusal' || type === 'sensitive';
}
