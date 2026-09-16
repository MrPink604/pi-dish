import type { SessionId } from './contracts';
import { readStore, writeStore } from './dish-store';
import { canonicalSessionId, resolveSessionRoute } from './session-key';

const STORE_FILE = 'session-provenance.json';
const MAX_LAUNCHES = 5000;

export interface LaunchProvenance {
  sourceSessionId: SessionId;
  operationId: string | null;
  createdAt: number;
}

export function validId(value: unknown): value is string {
  try { resolveSessionRoute(value); return true; } catch { return false; }
}

export function readLaunches(): Record<string, LaunchProvenance> {
  const raw = readStore(STORE_FILE);
  const source = raw.launches && typeof raw.launches === 'object' && !Array.isArray(raw.launches)
    ? raw.launches as Record<string, unknown> : {};
  const launches: Record<string, LaunchProvenance> = {};
  for (const [sessionId, value] of Object.entries(source)) {
    if (!validId(sessionId) || !value || typeof value !== 'object') continue;
    const launch = value as Record<string, unknown>;
    if (!validId(launch.sourceSessionId)) continue;
    launches[canonicalSessionId(sessionId)] = {
      sourceSessionId: canonicalSessionId(launch.sourceSessionId),
      operationId: validId(launch.operationId) ? launch.operationId : null,
      createdAt: typeof launch.createdAt === 'number' && Number.isFinite(launch.createdAt) ? launch.createdAt : 0,
    };
  }
  return launches;
}

/** Record advisory launch provenance. It never grants authority. */
export function recordLaunch(sessionId: unknown, sourceSessionId: unknown, operationId?: unknown): LaunchProvenance {
  if (!validId(sessionId) || !validId(sourceSessionId)) throw new Error('valid session ids required');
  const canonicalId = canonicalSessionId(sessionId);
  const canonicalSourceId = canonicalSessionId(sourceSessionId);
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
  if (!validId(sourceSessionId)) return [];
  const canonicalSourceId = canonicalSessionId(sourceSessionId);
  return Object.entries(readLaunches())
    .filter(([, value]) => value.sourceSessionId === canonicalSourceId)
    .map(([sessionId, value]) => ({ sessionId, ...value }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function resetForTests(): void {
  // Stateless module; HOME-scoped tests replace the store itself.
}
