import type { Timestamp } from './helper-types';


export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }


export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

/** Wire string or `''`. */
export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

/** Finite wire number or `0`. */
export function count(value: unknown): number { return finite(value) ? value : 0; }

export function timestampMillis(value: Timestamp | null | undefined): number {
  return new Date(value === undefined ? NaN : value === null ? 0 : value).getTime();
}
