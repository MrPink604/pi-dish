// Generated from src/core/helper-values.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.record = record;
exports.finite = finite;
exports.timestampMillis = timestampMillis;
function record(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function timestampMillis(value) {
    return new Date(value === undefined ? NaN : value === null ? 0 : value).getTime();
}
