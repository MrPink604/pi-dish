// Generated from src/core/http-boundary.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestBody = requestBody;
exports.errorMessage = errorMessage;
exports.errorStatus = errorStatus;
exports.httpError = httpError;
const helper_values_1 = require("./helper-values");
/** Express leaves parsed JSON untyped; every route body is a boundary object. */
function requestBody(req) {
    return (req.body ?? {});
}
function errorMessage(error) {
    return (0, helper_values_1.record)(error) && typeof error.message === 'string' ? error.message : String(error);
}
function errorStatus(error, fallback) {
    if ((0, helper_values_1.record)(error)) {
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
