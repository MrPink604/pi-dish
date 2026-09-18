// Generated test/tool from test/test-types.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.record = record;
exports.records = records;
exports.strings = strings;
exports.present = present;
exports.nativeId = nativeId;
exports.routeId = routeId;
exports.harnessId = harnessId;
exports.bridgeEntry = bridgeEntry;
exports.errorMessage = errorMessage;
const assert = require("node:assert/strict");
const wire_protocol_js_1 = require("../lib/wire-protocol.js");
const sessionKey = require("../lib/session-key.js");
function record(value, message = 'expected an object') {
    assert.ok((0, wire_protocol_js_1.isRecord)(value), message);
    return value;
}
function records(value, message = 'expected an object array') {
    assert.ok(Array.isArray(value), message);
    for (const entry of value)
        record(entry, message);
    return value;
}
function strings(value, message = 'expected a string array') {
    assert.ok(Array.isArray(value) && value.every((entry) => typeof entry === 'string'), message);
    return value;
}
function present(value, message = 'expected a value') {
    assert.ok(value !== null && value !== undefined, message);
    return value;
}
function nativeId(value, message = 'expected a native session id') {
    assert.ok(sessionKey.validSessionId(value), message);
    return value;
}
function routeId(value) {
    return sessionKey.canonicalSessionId(value);
}
function harnessId(value, message = 'expected a harness id') {
    assert.ok(value === 'pi' || value === 'omp' || value === 'prime', message);
    return value;
}
function bridgeEntry(value, message = 'expected a bridge registry entry') {
    assert.ok(isBridgeEntry(value), message);
    return value;
}
function isBridgeEntry(value) {
    return (0, wire_protocol_js_1.isRecord)(value) && sessionKey.validSessionId(value.sessionId) && typeof value.socketPath === 'string';
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
