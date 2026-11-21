// Generated from src/core/session-key.ts; edit that source and run npm run build:core.
"use strict";
const harnesses_1 = require("./harnesses");
// `~` is deliberately outside the legacy Pi session-id alphabet below, so an
// encoded cross-harness route can never steal a pre-existing raw Pi route.
const VERSION = '~sk1_';
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
const MAX_ID_LENGTH = 200;
// Fleet-global caller ref (`<hostUuid>:<sessionRoute>`), valid for both legacy
// Pi ids and `~sk1_` encoded cross-harness routes (such as bots, omp, agy).
const HOST_QUALIFIED_CALLER = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+)$/i;
function validId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && SAFE_ID.test(id);
}
function encodeSessionKey(harnessId, nativeSessionId) {
    if (!(0, harnesses_1.getHarness)(harnessId) || !validId(nativeSessionId))
        throw new TypeError('Invalid session identity');
    return (VERSION + Buffer.from(JSON.stringify([harnessId, nativeSessionId]), 'utf8').toString('base64url'));
}
function decodeSessionKey(key) {
    if (typeof key !== 'string' || !key.startsWith(VERSION))
        throw new TypeError('Malformed session key');
    const encoded = key.slice(VERSION.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded))
        throw new TypeError('Malformed session key');
    let tuple;
    try {
        tuple = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    }
    catch {
        throw new TypeError('Malformed session key');
    }
    if (!Array.isArray(tuple) || tuple.length !== 2 || !(0, harnesses_1.getHarness)(tuple[0]) || !validId(tuple[1]) ||
        encodeSessionKey(tuple[0], tuple[1]) !== key)
        throw new TypeError('Malformed session key');
    return { harnessId: tuple[0], nativeSessionId: tuple[1] };
}
// Unversioned routes are the historical Pi API. Encoded routes are always
// decoded strictly; a malformed value that looks versioned never falls back.
function resolveSessionRoute(value) {
    if (typeof value === 'string' && value.startsWith(VERSION))
        return decodeSessionKey(value);
    if (!validId(value))
        throw new TypeError('Invalid legacy Pi session id');
    return { harnessId: 'pi', nativeSessionId: value };
}
// One durable/public identity per logical session: preserve legacy raw Pi IDs
// while alternate harnesses use the encoded tuple. This also folds an encoded
// Pi alias back to the raw ID before anything persists it.
function canonicalSessionId(value) {
    const { harnessId, nativeSessionId } = resolveSessionRoute(value);
    return harnessId === 'pi' ? nativeSessionId : encodeSessionKey(harnessId, nativeSessionId);
}
// Callers that mirror an unvalidated stored id keep the raw value on failure.
function tryCanonicalSessionId(value) {
    try {
        return canonicalSessionId(value);
    }
    catch {
        return value;
    }
}
/** Parse `<hostUuid>:<sessionRoute>` when the route part is a valid session route. */
function parseHostQualifiedCaller(value) {
    if (typeof value !== 'string')
        return null;
    const match = HOST_QUALIFIED_CALLER.exec(value);
    if (!match)
        return null;
    try {
        return { hostId: match[1], sessionId: canonicalSessionId(match[2]) };
    }
    catch {
        return null;
    }
}
/** Canonical form of a local or fleet-qualified caller id (`<hostUuid>:<route>`). */
function canonicalCallerId(value) {
    const qualified = parseHostQualifiedCaller(value);
    if (qualified)
        return `${qualified.hostId}:${qualified.sessionId}`;
    return canonicalSessionId(value);
}
module.exports = {
    encodeSessionKey, decodeSessionKey, resolveSessionRoute, canonicalSessionId, tryCanonicalSessionId,
    parseHostQualifiedCaller, canonicalCallerId, validSessionId: validId, VERSION,
};
