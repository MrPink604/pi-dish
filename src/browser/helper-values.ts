import type { Timestamp } from './shared-helper-types';


export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }


export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

export function timestampMillis(value: Timestamp | null | undefined): number {
  return new Date(value === undefined ? NaN : value === null ? 0 : value).getTime();
}
