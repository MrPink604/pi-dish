// Generated from src/core/http-boundary.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestBody = requestBody;
/** Express leaves parsed JSON untyped; every route body is a boundary object. */
function requestBody(req) {
    return (req.body ?? {});
}
