import { isRecord } from './wire-protocol';

/** Errors carry their HTTP status as ad-hoc fields; both spellings are in use. */
export interface HttpError extends Error {
  statusCode?: number;
  status?: number;
}

export function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}

export function errorStatus(error: unknown, fallback: number): number {
  if (isRecord(error)) {
    if (typeof error.statusCode === 'number') return error.statusCode;
    if (typeof error.status === 'number') return error.status;
  }
  return fallback;
}

export function httpError(message: string, statusCode: number): HttpError {
  return Object.assign(new Error(message), { statusCode });
}
