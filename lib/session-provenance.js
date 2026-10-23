// Generated from src/core/session-provenance.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validId = validId;
exports.isHostQualified = isHostQualified;
exports.localizeCallerId = localizeCallerId;
exports.readLaunches = readLaunches;
exports.recordLaunch = recordLaunch;
exports.getLaunch = getLaunch;
exports.getLaunchesFrom = getLaunchesFrom;
exports.resetForTests = resetForTests;
const dish_store_1 = require("./dish-store");
const hostIdentity = require("./host-identity");
const session_key_1 = require("./session-key");
const STORE_FILE = 'session-provenance.json';
const MAX_LAUNCHES = 5000;
function validId(value) {
    try {
        (0, session_key_1.resolveSessionRoute)(value);
        return true;
    }
    catch {
        return false;
    }
}
// The fleet-global caller form (`<hostId>:<sessionId>`, the provenance ref
// form): valid whichever host receives it, so a client never has to know
// whether the server it is talking to is its own.
const HOST_QUALIFIED = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+)$/i;
function isHostQualified(value) {
    return typeof value === 'string' && HOST_QUALIFIED.test(value);
}
function localize(value, selfHostId) {
    const match = HOST_QUALIFIED.exec(value);
    return match && match[1].toLowerCase() === selfHostId.toLowerCase() ? match[2] : value;
}
/**
 * Strip this host's own qualifier from a caller id. Local sessions are keyed
 * by bare id in the catalog, lineage and related views; a foreign-qualified
 * id is returned unchanged.
 */
function localizeCallerId(value) {
    return localize(value, hostIdentity.getHostId());
}
function readLaunches() {
    const raw = (0, dish_store_1.readStore)(STORE_FILE);
    const source = raw.launches && typeof raw.launches === 'object' && !Array.isArray(raw.launches)
        ? raw.launches : {};
    const launches = {};
    const selfHostId = hostIdentity.getHostId();
    for (const [sessionId, value] of Object.entries(source)) {
        if (!validId(sessionId) || !value || typeof value !== 'object')
            continue;
        const launch = value;
        if (!validId(launch.sourceSessionId))
            continue;
        launches[(0, session_key_1.canonicalSessionId)(sessionId)] = {
            // A server that predates localization recorded its own sessions
            // self-qualified; reading them localized keeps their links resolvable.
            sourceSessionId: (0, session_key_1.canonicalSessionId)(localize(launch.sourceSessionId, selfHostId)),
            operationId: validId(launch.operationId) ? launch.operationId : null,
            createdAt: typeof launch.createdAt === 'number' && Number.isFinite(launch.createdAt) ? launch.createdAt : 0,
        };
    }
    return launches;
}
/** Record advisory launch provenance. It never grants authority. */
function recordLaunch(sessionId, sourceSessionId, operationId) {
    if (!validId(sessionId) || !validId(sourceSessionId))
        throw new Error('valid session ids required');
    const canonicalId = (0, session_key_1.canonicalSessionId)(sessionId);
    const canonicalSourceId = (0, session_key_1.canonicalSessionId)(localizeCallerId(sourceSessionId));
    const launches = readLaunches();
    launches[canonicalId] = {
        sourceSessionId: canonicalSourceId,
        operationId: validId(operationId) ? operationId : null,
        createdAt: Date.now(),
    };
    const ordered = Object.entries(launches)
        .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
        .slice(0, MAX_LAUNCHES);
    (0, dish_store_1.writeStore)(STORE_FILE, { version: 1, launches: Object.fromEntries(ordered) });
    return launches[canonicalId];
}
function getLaunch(sessionId) {
    if (!validId(sessionId))
        return null;
    const canonicalId = (0, session_key_1.canonicalSessionId)(sessionId);
    return readLaunches()[canonicalId] || null;
}
function getLaunchesFrom(sourceSessionId) {
    if (!validId(sourceSessionId))
        return [];
    const canonicalSourceId = (0, session_key_1.canonicalSessionId)(sourceSessionId);
    return Object.entries(readLaunches())
        .filter(([, value]) => value.sourceSessionId === canonicalSourceId)
        .map(([sessionId, value]) => ({ sessionId, ...value }))
        .sort((a, b) => b.createdAt - a.createdAt);
}
function resetForTests() {
    // Stateless module; HOME-scoped tests replace the store itself.
}
