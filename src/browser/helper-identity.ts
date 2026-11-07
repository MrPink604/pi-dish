import type { HelperSession, HelperHost } from '../core/helper-types';

// One client may aggregate several pi-dish hosts. Wire ids stay host-local;
// namespacing happens only in client keys.
/**
 * Session ids are unique only per host, so client keys name the host too. A falsy
 * host yields the bare id, used before GET /api/host answers.
 */
export function sessionKey(hostId: unknown, sessionId: unknown) {
  const id = sessionId == null ? '' : String(sessionId);
  return hostId ? `${hostId} ${id}` : id;
}

export function parseSessionKey(key: unknown) {
  const raw = key == null ? '' : String(key);
  const sep = raw.indexOf(' ');
  if (sep < 0) return { hostId: null, sessionId: raw };
  return { hostId: raw.slice(0, sep), sessionId: raw.slice(sep + 1) };
}

export function sessionRefKey(session?: Pick<HelperSession, 'id' | 'host'> | null) {
  return sessionKey(session && session.host, session && session.id);
}

/** The self host has no base, so it gets an explicit label instead of an empty chip. */
export function hostDisplayLabel(host?: HelperHost | null) {
  if (!host) return '';
  if (host.label) return String(host.label);
  if (host.name) return String(host.name);
  if (!host.base) return 'this host';
  return String(host.base).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Absent from an advertised set means unsupported. A host that advertised nothing falls
 * back to /api/config only if it is this host; a dead button is worse than a missing one.
 */
export function hostSupportsCapability(hostEntry: HelperHost | null | undefined, capability: string, config?: Readonly<Record<string, unknown>> | null) {
  const caps = hostEntry && hostEntry.capabilities;
  if (caps && typeof caps === 'object') return caps[capability] === true;
  const isSelf = !!hostEntry && (hostEntry.self === true || hostEntry.base === '');
  return isSelf ? !!(config && config[capability]) : false;
}

export function hostSupportsTerminal(hostEntry?: HelperHost | null, config?: Readonly<Record<string, unknown>> | null) {
  return hostSupportsCapability(hostEntry, 'terminal', config);
}

// Color policy lives in src/core/host-colors.ts.
/** Self first, then by label; not recency, so headings don't jump around. */
export function sortHostSections<T extends HelperHost>(hosts?: readonly T[] | null) {
  const rows: T[] = Array.isArray(hosts) ? [...hosts] : [];
  return rows.sort((a, b) => {
    if (!!a.self !== !!b.self) return a.self ? -1 : 1;
    const byLabel = hostDisplayLabel(a).localeCompare(hostDisplayLabel(b), undefined, { sensitivity: 'base' });
    if (byLabel) return byLabel;
    return String(a.hostId || a.base || '').localeCompare(String(b.hostId || b.base || ''));
  });
}

/** Namespaced like `date:` buckets. */
export function hostSectionKey(hostKey?: string | null) { return 'host:' + (hostKey || 'self'); }


/** Missing capability metadata is legacy Pi behavior: supported by default. */
export function sessionSupports(session: Pick<HelperSession, 'capabilities'> | null | undefined, capability: string) {
  return session?.capabilities?.[capability] !== false;
}

/** Compact sidebar identity for each supported agent harness. */
export function harnessBadgeInfo(harnessId?: string | null, harnessLabel?: string | null) {
  const known: Record<string, { label: string; icon: string }> = {
    pi: { label: 'Pi', icon: 'vendor/harness-pi.svg' },
    omp: { label: 'OMP', icon: 'vendor/harness-omp.svg' },
    prime: { label: 'Prime', icon: 'vendor/harness-prime.svg' },
  };
  return (harnessId && Object.hasOwn(known, harnessId) ? known[harnessId] : null) || {
    label: harnessLabel || harnessId || 'Agent',
    icon: null,
  };
}
