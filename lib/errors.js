// Generated from src/core/errors.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMessage = errorMessage;
exports.errorStatus = errorStatus;
exports.httpError = httpError;
const wire_protocol_1 = require("./wire-protocol");
function errorMessage(error) {
    return (0, wire_protocol_1.isRecord)(error) && typeof error.message === 'string' ? error.message : String(error);
}
function errorStatus(error, fallback) {
    if ((0, wire_protocol_1.isRecord)(error)) {
        if (typeof error.statusCode === 'number')
            return error.statusCode;
        if (typeof error.status === 'number')
            return error.status;
    }
    return fallback;
}
function httpError(message, statusCode) {
    return Object.assign(new Error(message), { statusCode });
}
