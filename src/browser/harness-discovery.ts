/** Wire extras stay opaque; only identity and display labels are narrowed here. */
export interface HarnessRow {
  readonly id: string;
  readonly label?: string;
  readonly available?: unknown;
  readonly pilotConfig?: unknown;
  readonly [field: string]: unknown;
}
type HostId = string | null;
export interface HarnessDiscoveryOptions {
  selectedHostId: () => HostId;
  selfHostId: () => HostId;
  requestPicker: (host: HostId) => Promise<unknown>;
  requestBackground: (host: HostId) => Promise<unknown>;
  preferredHarness: () => string | null;
  onPreferredHarness: (id: string) => void;
  onPickerChange: () => void;
  onCacheChange: () => void;
}

/** Bad rows cannot turn a successful catalog into an unusable select element. */
function decodeRows(data: unknown): HarnessRow[] {
  if (!data || typeof data !== 'object' || !('harnesses' in data) || !Array.isArray(data.harnesses)) return [];
  const rows: unknown[] = data.harnesses;
  return rows.flatMap(value => {
    if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !value.id) return [];
    const row: HarnessRow = { ...value, id: value.id,
      label: 'label' in value && typeof value.label === 'string' ? value.label : undefined };
    return [row];
  });
}
const fallback = (): HarnessRow[] => [{ id: 'pi', label: 'Pi', available: true }];

/** Picker ownership and the settings-badge cache share one discovery boundary. */
export function createHarnessDiscovery(options: HarnessDiscoveryOptions) {
  let rows = fallback();
  let sequence = 0;
  const cache = new Map<HostId, readonly HarnessRow[]>();
  const pending = new Map<HostId, Promise<void>>();
  // A foreground catalog supersedes an earlier background request for its host.
  const cacheOwners = new Map<HostId, object>();
  const keyOf = (host: HostId): HostId => host || options.selfHostId();

  async function load(): Promise<void> {
    const host = options.selectedHostId();
    const key = keyOf(host);
    const seq = ++sequence;
    const ownsDiscovery = () => seq === sequence && host === options.selectedHostId();
    try {
      const data = await options.requestPicker(host);
      if (!ownsDiscovery()) return;
      if (data == null) throw new Error('Missing harness catalog');
      const discovered = decodeRows(data);
      if (discovered.length) {
        rows = discovered;
        cache.set(key, discovered);
        cacheOwners.set(key, {});
        options.onCacheChange();
        // Read after discovery: the user may have changed this while awaiting.
        const preferred = options.preferredHarness();
        if (preferred && rows.some(row => row.id === preferred && row.available !== false)) {
          options.onPreferredHarness(preferred);
        }
      }
    } catch {
      if (!ownsDiscovery()) return;
      rows = fallback();
    }
    options.onPickerChange();
  }

  function ensure(host: HostId): Promise<void> {
    const key = keyOf(host);
    if (cache.has(key)) return Promise.resolve();
    const existing = pending.get(key);
    if (existing) return existing;
    const owner = {};
    cacheOwners.set(key, owner);
    const request = (async () => {
      try {
        const data = await options.requestBackground(key);
        if (cacheOwners.get(key) !== owner) return;
        cache.set(key, decodeRows(data));
        options.onCacheChange();
      } catch {} // A failure leaves the cache absent so the next header can retry.
    })().finally(() => { pending.delete(key); });
    pending.set(key, request);
    return request;
  }

  return {
    load,
    ensure,
    rows: (): readonly HarnessRow[] => rows,
    cachedRows: (host: HostId): readonly HarnessRow[] | undefined => cache.get(keyOf(host)),
    row: (host: HostId, harness: string): HarnessRow | null =>
      cache.get(keyOf(host))?.find(row => row.id === harness) || null,
  };
}
