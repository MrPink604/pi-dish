import type { SessionId } from './contracts';
import { readStore, writeStore } from './dish-store';
import hostIdentity = require('./host-identity');
import { canonicalCallerId, canonicalSessionId, parseHostQualifiedCaller, resolveSessionRoute } from './session-key';

const STORE_FILE = 'session-provenance.json';
const MAX_LAUNCHES = 5000;

export interface LaunchProvenance {
  sourceSessionId: SessionId;
  operationId: string | null;
  createdAt: number;
}

function validId(value: unknown): value is string {
  try { resolveSessionRoute(value); return true; } catch { return false; }
}

function validCallerId(value: unknown): value is string {
  try { canonicalCallerId(value); return true; } catch { return false; }
}

// The fleet-global caller form (`<hostId>:<sessionId>`, the provenance ref
// form): valid whichever host receives it, so a client never has to know
// whether the server it is talking to is its own.
export function isHostQualified(value: unknown): value is string {
  return parseHostQualifiedCaller(value) !== null;
}

function localize(value: string, selfHostId: string): string {
  const qualified = parseHostQualifiedCaller(value);
  return qualified && qualified.hostId.toLowerCase() === selfHostId.toLowerCase() ? qualified.sessionId : value;
}

/**
 * Strip this host's own qualifier from a caller id. Local sessions are keyed
 * by bare id in the catalog, lineage and related views; a foreign-qualified
 * id is returned unchanged.
 */
export function localizeCallerId(value: string): string {
  return localize(value, hostIdentity.getHostId());
}

export function readLaunches(): Record<string, LaunchProvenance> {
  const raw = readStore(STORE_FILE);
  const source = raw.launches && typeof raw.launches === 'object' && !Array.isArray(raw.launches)
    ? raw.launches as Record<string, unknown> : {};
  const launches: Record<string, LaunchProvenance> = {};
  const selfHostId = hostIdentity.getHostId();
  for (const [sessionId, value] of Object.entries(source)) {
    if (!validId(sessionId) || !value || typeof value !== 'object') continue;
    const launch = value as Record<string, unknown>;
    if (!validCallerId(launch.sourceSessionId)) continue;
    launches[canonicalSessionId(sessionId)] = {
      // Older servers stored their own sessions self-qualified; localize to keep links resolvable.
      sourceSessionId: canonicalCallerId(localize(launch.sourceSessionId, selfHostId)),
      operationId: validId(launch.operationId) ? launch.operationId : null,
      createdAt: typeof launch.createdAt === 'number' && Number.isFinite(launch.createdAt) ? launch.createdAt : 0,
    };
  }
  return launches;
}

/** Record advisory launch provenance. It never grants authority. */
export function recordLaunch(sessionId: unknown, sourceSessionId: unknown, operationId?: unknown): LaunchProvenance {
  if (!validId(sessionId) || !validCallerId(sourceSessionId)) throw new Error('valid session ids required');
  const canonicalId = canonicalSessionId(sessionId);
  const canonicalSourceId = canonicalCallerId(localizeCallerId(sourceSessionId));
  const launches = readLaunches();
  launches[canonicalId] = {
    sourceSessionId: canonicalSourceId,
    operationId: validId(operationId) ? operationId : null,
    createdAt: Date.now(),
  };
  const ordered = Object.entries(launches)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    .slice(0, MAX_LAUNCHES);
  writeStore(STORE_FILE, { version: 1, launches: Object.fromEntries(ordered) });
  return launches[canonicalId];
}

export function getLaunch(sessionId: unknown): LaunchProvenance | null {
  if (!validId(sessionId)) return null;
  const canonicalId = canonicalSessionId(sessionId);
  return readLaunches()[canonicalId] || null;
}

export function getLaunchesFrom(sourceSessionId: unknown): Array<LaunchProvenance & { sessionId: string }> {
  if (!validCallerId(sourceSessionId)) return [];
  const canonicalSourceId = canonicalCallerId(localizeCallerId(sourceSessionId));
  return Object.entries(readLaunches())
    .filter(([, value]) => value.sourceSessionId === canonicalSourceId)
    .map(([sessionId, value]) => ({ sessionId, ...value }))
    .sort((a, b) => b.createdAt - a.createdAt);
}
