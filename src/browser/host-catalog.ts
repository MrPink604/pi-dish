import type { HostEndpoint } from './api-client';

/** Only these normalized fields belong in the browser's persisted catalog. */
export interface CatalogHost extends HostEndpoint {
  hostId?: string;
  label?: string;
  token?: string;
}

export interface SelfHostMetadata {
  hostId?: unknown;
  label?: unknown;
  version?: unknown;
  capabilities?: unknown;
}

interface HostMetadata {
  label?: unknown;
  name?: string | null;
  token?: string | null;
  version?: unknown;
  capabilities?: unknown;
  kind?: string | null;
  error?: string | null;
}

export interface EffectiveHost extends HostEndpoint, HostMetadata {
  hostId: string | null;
  key: string;
  source: 'self' | 'fleet' | 'user';
  self?: boolean;
  reachable?: boolean;
}
type HostCandidate = Omit<EffectiveHost, 'key'>;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Existing prefixable URL/path policy. Null means invalid; empty means self.
 * A mistyped base must fail at add time, never resolve against the serving origin.
 */
export function normalizeHostBase(input: unknown): string | null {
  if (input == null) return '';
  const raw = String(input).trim();
  if (!raw) return '';
  if (/\s/.test(raw)) return null;
  const segmentsOk = (path: string) => path.split('/').filter(Boolean)
    .every(seg => seg !== '.' && seg !== '..' && /^[\w.~%\-]+$/.test(seg));
  if (raw.startsWith('/')) {
    if (!segmentsOk(raw)) return null;
    return raw.replace(/\/+$/, '');
  }
  if (!/^https?:\/\//i.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!url.hostname) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (!segmentsOk(path)) return null;
  return url.origin + path;
}

/**
 * Corrupt localStorage rows are dropped; self remains implicit. A broken catalog
 * must degrade to fewer hosts rather than prevent the client from booting.
 */
export function sanitizeHostCatalog(raw: unknown): CatalogHost[] {
  const out: CatalogHost[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(raw)) return out;
  const rows: unknown[] = raw;
  for (const item of rows) {
    if (!object(item)) continue;
    let base: string | null;
    try { base = normalizeHostBase(item.base); } catch { continue; }
    if (!base) continue;
    const hostId = text(item.hostId);
    const dedupe = hostId || base;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const entry: CatalogHost = { base };
    if (hostId) entry.hostId = hostId;
    const label = text(item.label);
    if (label) entry.label = label;
    const token = text(item.token);
    if (token) entry.token = token;
    out.push(entry);
  }
  return out;
}

/**
 * Self, then runtime fleet, then persisted catalog. First route wins by id or
 * base; duplicates only fill missing metadata. No input row is mutated.
 */
export function mergeHostEntries(self: SelfHostMetadata | null | undefined, fleet: unknown, catalog: unknown): EffectiveHost[] {
  const out: EffectiveHost[] = [];
  const byId = new Map<string, EffectiveHost>();
  const byBase = new Map<string, EffectiveHost>();

  function absorb(into: EffectiveHost, extra: HostCandidate): void {
    // Keep each key correlated with its value type, including opaque metadata.
    function field<K extends keyof HostMetadata>(key: K): void {
      if (into[key] == null && extra[key] != null) into[key] = extra[key];
    }
    for (const key of ['label', 'name', 'token', 'version', 'capabilities', 'kind', 'error'] as const) field(key);
  }

  function push(entry: HostCandidate): void {
    const hostId = text(entry.hostId);
    const base = entry.base;
    const existing = (hostId && byId.get(hostId)) || byBase.get(base);
    if (existing) { absorb(existing, entry); return; }
    const merged: EffectiveHost = { ...entry, base, hostId: hostId || null, key: hostId || base || 'self' };
    if (hostId) byId.set(hostId, merged);
    byBase.set(base, merged);
    out.push(merged);
  }

  push({
    hostId: text(self && self.hostId),
    base: '',
    label: (self && self.label) || null,
    version: (self && self.version) || null,
    capabilities: (self && self.capabilities) || null,
    source: 'self',
    self: true,
    reachable: true,
  });
  const rows: unknown[] = Array.isArray(fleet) ? fleet : [];
  for (const entry of rows) {
    if (!object(entry) || entry.self) continue;
    let base: string | null;
    try { base = normalizeHostBase(entry.base); } catch { continue; }
    if (base == null) continue;
    push({
      hostId: text(entry.hostId), base, label: text(entry.label), name: text(entry.name),
      kind: text(entry.kind), version: entry.version || null,
      capabilities: entry.capabilities || null,
      reachable: entry.reachable !== false, error: text(entry.error),
      source: 'fleet',
    });
  }
  for (const entry of sanitizeHostCatalog(catalog)) push({ ...entry, hostId: entry.hostId || null, source: 'user' });
  return out;
}
