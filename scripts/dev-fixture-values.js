// Generated test/tool from scripts/dev-fixture-values.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.record = record;
exports.records = records;
exports.present = present;
exports.checkedNativeId = checkedNativeId;
// Shape guards shared by the real-lineage dev harnesses, which assert on
// decoded HTTP payloads that carry no static types.
const sessionKeys = require('../lib/session-key');
function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError('Expected object');
    return value;
}
function records(value) {
    if (!Array.isArray(value))
        throw new TypeError('Expected array');
    return value.map(record);
}
function present(value) {
    if (value === null || value === undefined)
        throw new TypeError('Expected value');
    return value;
}
function checkedNativeId(value) {
    if (!sessionKeys.validSessionId(value))
        throw new TypeError('Invalid fixture session id');
    return value;
}
