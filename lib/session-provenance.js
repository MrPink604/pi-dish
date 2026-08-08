const { readStore, writeStore } = require('./dish-store.js');
const { resolveSessionRoute } = require('./session-key.js');

const STORE_FILE = 'session-provenance.json';
const MAX_LAUNCHES = 5000;

function validId(value) {
  try { resolveSessionRoute(value); return true; } catch { return false; }
}

function readLaunches() {
  const raw = readStore(STORE_FILE);
  const source = raw.launches && typeof raw.launches === 'object' && !Array.isArray(raw.launches)
    ? raw.launches : {};
  const launches = {};
  for (const [sessionId, value] of Object.entries(source)) {
    if (!validId(sessionId) || !value || typeof value !== 'object' || !validId(value.sourceSessionId)) continue;
    launches[sessionId] = {
      sourceSessionId: value.sourceSessionId,
      operationId: validId(value.operationId) ? value.operationId : null,
      createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0,
    };
  }
  return launches;
}

/** Record advisory launch provenance. It never grants authority. */
function recordLaunch(sessionId, sourceSessionId, operationId) {
  if (!validId(sessionId) || !validId(sourceSessionId)) throw new Error('valid session ids required');
  const launches = readLaunches();
  launches[sessionId] = {
    sourceSessionId,
    operationId: validId(operationId) ? operationId : null,
    createdAt: Date.now(),
  };
  const ordered = Object.entries(launches)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    .slice(0, MAX_LAUNCHES);
  writeStore(STORE_FILE, { version: 1, launches: Object.fromEntries(ordered) });
  return launches[sessionId];
}

function getLaunch(sessionId) {
  return readLaunches()[sessionId] || null;
}

function getLaunchesFrom(sourceSessionId) {
  return Object.entries(readLaunches())
    .filter(([, value]) => value.sourceSessionId === sourceSessionId)
    .map(([sessionId, value]) => ({ sessionId, ...value }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function resetForTests() {
  // Stateless module; HOME-scoped tests replace the store itself.
}

module.exports = {
  recordLaunch,
  getLaunch,
  getLaunchesFrom,
  readLaunches,
  validId,
  resetForTests,
};
