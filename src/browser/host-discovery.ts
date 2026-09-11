import type { ApiRequest } from './api-client';
import type { EffectiveHost } from './host-catalog';
import type { HostConnectionEvent } from './host-connections';

export interface HostDescriptor {
  readonly hostId: string;
  readonly label: unknown;
  readonly version: unknown;
  readonly capabilities: unknown;
}
/** Source rows remain opaque until the catalog/feature boundary consumes them. */
export interface HostDiscoverySource {
  base?: unknown;
  hostId?: unknown;
  token?: unknown;
  label?: unknown;
}
export interface HostFleet {
  readonly hosts: Record<string, unknown>[];
  readonly selfLabel: unknown;
}
export interface HostDiscoveryOptions {
  request: ApiRequest;
  requestSelf: () => Promise<Response>;
  hosts: () => readonly EffectiveHost[];
  pollableHosts: () => readonly EffectiveHost[];
  sourceFor: (host: Readonly<EffectiveHost>) => HostDiscoverySource | null;
  onSelf: (descriptor: HostDescriptor) => void;
  onFleet: (fleet: HostFleet) => void;
  onIdentified: (host: EffectiveHost, source: HostDiscoverySource, descriptor: HostDescriptor) => void;
  onConnection: (host: Readonly<EffectiveHost>, event: HostConnectionEvent) => void;
  afterFleet: () => void;
  now?: () => number;
}
const REFRESH_MS = 60000;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function decodeHostDescriptor(value: unknown): HostDescriptor | null {
  if (!record(value) || typeof value.hostId !== 'string' || !value.hostId) return null;
  return { hostId: value.hostId, label: value.label || null,
    version: value.version || null, capabilities: value.capabilities || null };
}

/** Descriptor requests capture both a routing endpoint and its catalog source. */
export function createHostDiscovery(options: HostDiscoveryOptions) {
  const descriptors = new Map<string, HostDescriptor>();
  const requests = new Map<HostDiscoverySource, object>();
  const now = options.now || Date.now;
  let selfSequence = 0;
  let fleetSequence = 0;
  let fleetRequestedAt = 0;

  function rememberDescriptor(value: unknown): HostDescriptor | null {
    const descriptor = decodeHostDescriptor(value);
    if (descriptor) descriptors.set(descriptor.hostId, descriptor);
    return descriptor;
  }

  async function loadIdentity(): Promise<void> {
    const sequence = ++selfSequence;
    try {
      // Deliberately separate from routed API requests: this defines self.
      const response = await options.requestSelf();
      if (!response.ok) return;
      const descriptor = decodeHostDescriptor(await response.json());
      if (sequence === selfSequence && descriptor) options.onSelf(descriptor);
    } catch {} // An older server keeps the host-less client key convention.
  }

  async function identify(refresh = false): Promise<void> {
    const pending = options.pollableHosts().filter(host => !host.self &&
      (!host.hostId || (host.source === 'user' && (refresh || !descriptors.has(host.hostId)))));
    await Promise.allSettled(pending.map(async host => {
      const captured = Object.freeze({ ...host });
      const source = options.sourceFor(captured);
      if (!source) return;
      const sourceFields = { base: source.base, hostId: source.hostId, token: source.token };
      const owner = {};
      requests.set(source, owner);
      const ownsSource = () => requests.get(source) === owner && options.sourceFor(captured) === source &&
        source.base === sourceFields.base && source.token === sourceFields.token;
      const owns = () => ownsSource() && source.hostId === sourceFields.hostId && options.hosts().some(current => current.base === captured.base && current.hostId === captured.hostId &&
          current.source === captured.source && current.token === captured.token);
      let applying = false;
      try {
        const response = await options.request(captured, '/api/host', { timeoutMs: 8000 });
        if (!owns()) return;
        if (response.status === 401) { options.onConnection(captured, 'blocked'); return; }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const descriptor = decodeHostDescriptor(await response.json());
        if (!owns() || !descriptor) return;
        descriptors.set(descriptor.hostId, descriptor);
        applying = true;
        options.onIdentified(host, source, descriptor);
        options.onConnection(host, 'success');
      } catch (error) {
        // Publication may have learned a new id before persistence fails. Its own
        // identity update must not hide that failure, while replacement still retires it.
        if (applying ? ownsSource() : owns()) options.onConnection(captured, { type: 'failure', error });
      } finally {
        if (requests.get(source) === owner) requests.delete(source);
      }
    }));
  }

  async function loadFleet(): Promise<void> {
    fleetRequestedAt = now();
    const sequence = ++fleetSequence;
    try {
      const response = await options.request(null, '/api/hosts', { timeoutMs: 10000 });
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (sequence !== fleetSequence || !record(data) || !Array.isArray(data.hosts)) return;
      const rows: unknown[] = data.hosts;
      const hosts = rows.filter(record);
      options.onFleet({ hosts: hosts.filter(host => !host.self), selfLabel: hosts.find(host => host.self)?.label });
      await identify(true);
      if (sequence === fleetSequence) options.afterFleet();
    } catch {} // Missing fleet support and failed refreshes retain the old list.
  }

  function refreshSoon(): void {
    if (now() - fleetRequestedAt < REFRESH_MS) return;
    void loadFleet();
  }

  return { loadIdentity, loadFleet, identify, refreshSoon, rememberDescriptor,
    descriptor: (hostId: string): HostDescriptor | undefined => descriptors.get(hostId) };
}
