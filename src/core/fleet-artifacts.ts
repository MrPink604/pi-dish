/**
 * Hub-side public artifact reachability, not ownership or authorization.
 * Stores are re-read through dish-store for each operation and written atomically.
 */
import { readStore, writeStore } from './dish-store';
import { isValidRemoteName } from './remote-hosts';

export type ArtifactKind = 'share' | 'page';

export interface FleetArtifactRecord {
  host: string;
  kind: ArtifactKind;
  createdAt: number | null;
}

export interface FleetArtifactListEntry {
  token: string;
  kind: ArtifactKind;
  createdAt: number | null;
}

/** M3-owned port consumed by M5 relay; untrusted inputs stay unknown. */
export interface FleetArtifactStore {
  get(token: unknown): FleetArtifactRecord | null;
  record(token: unknown, host: unknown, kind: unknown): FleetArtifactRecord | null;
  remove(token: unknown, host?: unknown): boolean;
  listByHost(): Record<string, FleetArtifactListEntry[]>;
  isValidToken(token: unknown): token is string;
  isValidKind(kind: unknown): kind is ArtifactKind;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/;

function readArtifacts(): Record<string, unknown> {
  return readStore('fleet-artifacts.json');
}

function writeArtifacts(artifacts: Record<string, unknown>): void {
  writeStore('fleet-artifacts.json', artifacts);
}

export function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function isValidKind(kind: unknown): kind is ArtifactKind {
  return kind === 'share' || kind === 'page';
}

function normalize(entry: unknown): FleetArtifactRecord | null {
  if (!entry || typeof entry !== 'object') return null;
  const raw = entry as Record<string, unknown>;
  if (!isValidRemoteName(raw.host) || !isValidKind(raw.kind)) return null;
  return {
    host: raw.host,
    kind: raw.kind,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : null,
  };
}

export function get(token: unknown): FleetArtifactRecord | null {
  if (!isValidToken(token)) return null;
  return normalize(readArtifacts()[token]);
}

export function record(token: unknown, host: unknown, kind: unknown): FleetArtifactRecord | null {
  if (!isValidToken(token) || !isValidRemoteName(host) || !isValidKind(kind)) return null;
  const artifacts = readArtifacts();
  const existing = normalize(artifacts[token]);
  const entry = { host, kind, createdAt: existing?.createdAt ?? Date.now() };
  artifacts[token] = entry;
  writeArtifacts(artifacts);
  return entry;
}

/** A host-scoped revoke cannot remove another valid host's mapping. */
export function remove(token: unknown, host: unknown = null): boolean {
  if (!isValidToken(token)) return false;
  const artifacts = readArtifacts();
  if (artifacts[token] === undefined) return false;
  const existing = normalize(artifacts[token]);
  if (host && existing && existing.host !== host) return false;
  delete artifacts[token];
  writeArtifacts(artifacts);
  return true;
}

export function listByHost(): Record<string, FleetArtifactListEntry[]> {
  const out: Record<string, FleetArtifactListEntry[]> = {};
  for (const [token, raw] of Object.entries(readArtifacts())) {
    const entry = normalize(raw);
    if (!entry || !isValidToken(token)) continue;
    (out[entry.host] ||= []).push({ token, kind: entry.kind, createdAt: entry.createdAt });
  }
  for (const list of Object.values(out)) list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}
