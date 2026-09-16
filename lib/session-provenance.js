// Generated from src/core/session-provenance.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validId = validId;
exports.readLaunches = readLaunches;
exports.recordLaunch = recordLaunch;
exports.getLaunch = getLaunch;
exports.getLaunchesFrom = getLaunchesFrom;
exports.resetForTests = resetForTests;
const dish_store_1 = require("./dish-store");
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
function readLaunches() {
    const raw = (0, dish_store_1.readStore)(STORE_FILE);
    const source = raw.launches && typeof raw.launches === 'object' && !Array.isArray(raw.launches)
        ? raw.launches : {};
    const launches = {};
    for (const [sessionId, value] of Object.entries(source)) {
        if (!validId(sessionId) || !value || typeof value !== 'object')
            continue;
        const launch = value;
        if (!validId(launch.sourceSessionId))
            continue;
        launches[(0, session_key_1.canonicalSessionId)(sessionId)] = {
            sourceSessionId: (0, session_key_1.canonicalSessionId)(launch.sourceSessionId),
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
    const canonicalSourceId = (0, session_key_1.canonicalSessionId)(sourceSessionId);
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
