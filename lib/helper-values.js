// Generated from src/core/helper-values.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.record = record;
exports.finite = finite;
exports.text = text;
exports.count = count;
exports.timestampMillis = timestampMillis;
function record(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
/** Wire string or `''`. */
function text(value) { return typeof value === 'string' ? value : ''; }
/** Finite wire number or `0`. */
function count(value) { return finite(value) ? value : 0; }
function timestampMillis(value) {
    return new Date(value === undefined ? NaN : value === null ? 0 : value).getTime();
}
