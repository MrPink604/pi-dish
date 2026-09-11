import { mergeHostEntries, normalizeHostBase, reconcileHostCatalog, sanitizeHostCatalog } from './host-catalog';
import type { CatalogHost, EffectiveHost } from './host-catalog';
import type { HostEndpoint, HostTarget } from './api-client';
import type { HostDescriptor, HostDiscoverySource, HostFleet } from './host-discovery';

export interface SelfHostEntry {
  readonly base: '';
  readonly hostId: string | null;
  readonly label: unknown;
  readonly version: unknown;
  readonly capabilities: unknown;
}
export interface HostDirectoryOptions {
  initialCatalog: unknown;
  descriptor: (hostId: string) => HostDescriptor | undefined;
  persistCatalog: (catalog: readonly Readonly<CatalogHost>[]) => void;
}

/** Owns catalog/fleet sources and the single effective list used by every view. */
export function createHostDirectory(options: HostDirectoryOptions) {
  let self: SelfHostEntry = { base: '', hostId: null, label: null, version: null, capabilities: null };
  let catalog = sanitizeHostCatalog(options.initialCatalog);
  let fleet: Record<string, unknown>[] = [];
  let cache: EffectiveHost[] | null = null;

  function invalidate(): void { cache = null; }
  function effectiveHosts(): readonly Readonly<EffectiveHost>[] {
    if (!cache) {
      cache = mergeHostEntries(self, fleet, catalog);
      for (const host of cache) {
        const descriptor = host.hostId && options.descriptor(host.hostId);
        if (!descriptor) continue;
        for (const field of ['label', 'version', 'capabilities'] as const) {
          if (host[field] == null && descriptor[field] != null) host[field] = descriptor[field];
        }
      }
    }
    return cache;
  }

  function entryFor(hostId?: string | null): Readonly<EffectiveHost> | null {
    const hosts = effectiveHosts();
    return hostId ? hosts.find(host => host.hostId === hostId) || null : hosts[0];
  }

  function hostById(hostId?: string | null): SelfHostEntry | Readonly<EffectiveHost> {
    if (!hostId || hostId === self.hostId) return self;
    return entryFor(hostId) || self;
  }

  function resolveHost(target?: HostTarget): HostEndpoint {
    if (!target) return self;
    return typeof target === 'string' ? hostById(target) : target;
  }

  function sourceFor(host: Readonly<EffectiveHost>): Readonly<HostDiscoverySource> | null {
    if (host.source === 'user') return catalog.find(row => row.base === host.base) || null;
    if (host.source !== 'fleet') return null;
    return fleet.find(row => {
      try { return normalizeHostBase(row.base) === host.base; } catch { return false; }
    }) || null;
  }

  function setSelf(descriptor: HostDescriptor): void {
    self = { ...descriptor, base: '', label: typeof descriptor.label === 'string' ? descriptor.label : null };
    invalidate();
  }

  function setFleet(data: HostFleet): void {
    fleet = data.hosts.map(row => ({ ...row }));
    if (data.selfLabel && !self.label) self = { ...self, label: data.selfLabel };
    invalidate();
  }

  /** Replacing sources is deliberate retirement; unchanged saves use saveCatalog. */
  function replaceCatalog(value: unknown): void {
    catalog = sanitizeHostCatalog(value);
    invalidate();
  }

  function saveCatalog(): void {
    catalog = reconcileHostCatalog(catalog);
    options.persistCatalog(catalog);
    invalidate();
  }

  function remove(key: string): boolean {
    const next = catalog.filter(row => (row.hostId || row.base) !== key);
    if (next.length === catalog.length) return false;
    catalog = next;
    invalidate();
    return true;
  }

  function setToken(key: string, token: string | undefined): boolean {
    const row = catalog.find(entry => (entry.hostId || entry.base) === key);
    if (!row) return false;
    row.token = token;
    invalidate();
    return true;
  }

  function add(value: unknown): boolean {
    const row = sanitizeHostCatalog([value])[0];
    if (!row) return false;
    catalog = catalog.filter(entry => (!row.hostId || entry.hostId !== row.hostId) && entry.base !== row.base);
    catalog.push(row);
    invalidate();
    return true;
  }

  /** Only the owned source row may be changed; descriptor payloads stay opaque. */
  function applyDescriptor(host: EffectiveHost, source: Readonly<HostDiscoverySource>, data: HostDescriptor): boolean {
    if (sourceFor(host) !== source) return false;
    const user = catalog.find(row => row === source);
    const remote = fleet.find(row => row === source);
    if (!user && !remote) return false;
    host.hostId = data.hostId;
    for (const field of ['label', 'version', 'capabilities'] as const) {
      if (!host[field] && data[field]) host[field] = data[field];
    }
    if (user) {
      user.hostId = data.hostId;
      // The persisted catalog has always projected labels to strings. Keep that
      // contract true immediately, including after an untrusted descriptor read.
      if (!user.label && typeof data.label === 'string' && data.label) user.label = data.label;
    }
    if (remote) {
      remote.hostId = data.hostId;
      if (!remote.label && data.label) remote.label = data.label;
    }
    invalidate();
    if (user) options.persistCatalog(catalog);
    return true;
  }

  return { get self(): SelfHostEntry { return self; },
    get catalog(): readonly Readonly<CatalogHost>[] { return catalog; },
    effectiveHosts, entryFor, hostById, resolveHost, sourceFor, invalidate, setSelf, setFleet,
    replaceCatalog, saveCatalog, remove, setToken, add, applyDescriptor };
}
export type HostDirectory = ReturnType<typeof createHostDirectory>;
