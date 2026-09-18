import assert = require('node:assert/strict');
import type { RecoveryObservation } from '../../lib/session-recovery.js';

const recovery: typeof import('../../lib/session-recovery.js') = require('../../lib/session-recovery.js');

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function assertObservation(value: unknown): asserts value is RecoveryObservation {
  assertRecord(value);
  assert.ok('pid' in value);
  for (const key of ['harnessId', 'nativeSessionId', 'sessionFile', 'cwd', 'instanceId'] as const) {
    assert.ok(typeof value[key] === 'string');
  }
  assert.ok(value.activity === 'idle' || value.activity === 'running' || value.activity === 'uncertain');
}

const serialized = process.env.SNAPSHOT;
assert.ok(typeof serialized === 'string');
const snapshot: unknown = JSON.parse(serialized);
assertObservation(snapshot);
recovery.recordSession(snapshot);
