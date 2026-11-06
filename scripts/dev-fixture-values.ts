// Shape guards shared by the real-lineage dev harnesses, which assert on
// decoded HTTP payloads that carry no static types.
const sessionKeys: typeof import('../lib/session-key') = require('../lib/session-key');

export type FixtureRecord = Record<string, unknown>;

export function record(value: unknown): FixtureRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
  return value as FixtureRecord;
}

export function records(value: unknown): FixtureRecord[] {
  if (!Array.isArray(value)) throw new TypeError('Expected array');
  return value.map(record);
}

export function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new TypeError('Expected value');
  return value;
}

export function checkedNativeId(value: unknown) {
  if (!sessionKeys.validSessionId(value)) throw new TypeError('Invalid fixture session id');
  return value;
}
