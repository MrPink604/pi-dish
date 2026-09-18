// Generated tool from test/fixtures/session-recovery-writer.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const recovery = require('../../lib/session-recovery.js');
function assertRecord(value) {
    assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
}
function assertObservation(value) {
    assertRecord(value);
    assert.ok('pid' in value);
    for (const key of ['harnessId', 'nativeSessionId', 'sessionFile', 'cwd', 'instanceId']) {
        assert.ok(typeof value[key] === 'string');
    }
    assert.ok(value.activity === 'idle' || value.activity === 'running' || value.activity === 'uncertain');
}
const serialized = process.env.SNAPSHOT;
assert.ok(typeof serialized === 'string');
const snapshot = JSON.parse(serialized);
assertObservation(snapshot);
recovery.recordSession(snapshot);
