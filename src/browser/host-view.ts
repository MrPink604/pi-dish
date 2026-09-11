import type { EffectiveHost } from './host-catalog';
export type BrowserHost = Omit<EffectiveHost, 'label' | 'capabilities'> & {
  readonly label?: string; readonly capabilities?: Readonly<Record<string, boolean | undefined>>;
};
/** Presentation receives strings and boolean capability flags; raw descriptors stay in discovery. */
export function createHostView() {
  const cache = new WeakMap<Readonly<EffectiveHost>, Readonly<BrowserHost>>();
  return (host: Readonly<EffectiveHost>): Readonly<BrowserHost> => {
    const prior = cache.get(host); if (prior) return prior;
    const raw = host.capabilities, capabilities: Record<string, boolean | undefined> | undefined = raw && typeof raw === 'object'
      ? Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')) : undefined;
    const value = Object.freeze({ ...host, label: host.label ? String(host.label) : undefined, capabilities }); cache.set(host, value); return value;
  };
}
