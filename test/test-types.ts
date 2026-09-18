import assert = require('node:assert/strict');
import { isRecord } from '../lib/wire-protocol.js';
import sessionKey = require('../lib/session-key.js');
import type { BridgeRegistryEntry, HarnessId, NativeSessionId, SessionId } from '../lib/contracts.js';

export type TestRecord = Record<string, unknown>;


export function record(value: unknown, message = 'expected an object'): TestRecord {
  assert.ok(isRecord(value), message);
  return value;
}

export function records(value: unknown, message = 'expected an object array'): TestRecord[] {
  assert.ok(Array.isArray(value), message);
  for (const entry of value) record(entry, message);
  return value;
}

export function strings(value: unknown, message = 'expected a string array'): string[] {
  assert.ok(Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string'), message);
  return value;
}

export function present<T>(value: T | null | undefined, message = 'expected a value'): T {
  assert.ok(value !== null && value !== undefined, message);
  return value;
}
export function nativeId(value: unknown, message = 'expected a native session id'): NativeSessionId {
  assert.ok(sessionKey.validSessionId(value), message);
  return value;
}

export function routeId(value: unknown): SessionId {
  return sessionKey.canonicalSessionId(value);
}

export function harnessId(value: unknown, message = 'expected a harness id'): HarnessId {
  assert.ok(value === 'pi' || value === 'omp' || value === 'prime', message);
  return value;
}

export function bridgeEntry<T extends TestRecord>(value: T, message = 'expected a bridge registry entry'): T & BridgeRegistryEntry {
  assert.ok(isBridgeEntry(value), message);
  return value;
}

function isBridgeEntry(value: unknown): value is BridgeRegistryEntry {
  return isRecord(value) && sessionKey.validSessionId(value.sessionId) && typeof value.socketPath === 'string';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
