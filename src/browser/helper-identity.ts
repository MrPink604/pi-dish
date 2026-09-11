import type { HelperSession, HelperHost } from './shared-helper-types';

// =========================================================================
// Hosts (TASKS/multi-host.md) — one client may aggregate several pi-dish
// hosts. Wire ids stay host-local; namespacing happens only in client keys.
// =========================================================================
/**
 * Composite client key for a session. A session id is unique only within its
 * host (generic session.jsonl header ids collide across machines), so every
 * client-side map/list/localStorage key that names a session uses this form.
 * A falsy host id yields the bare session id — the pre-multi-host shape,
 * which is what the client still speaks before GET /api/host has answered
 * and on servers too old to serve it.
 */
export function sessionKey(hostId: unknown, sessionId: unknown) {
  const id = sessionId == null ? '' : String(sessionId);
  return hostId ? `${hostId} ${id}` : id;
}

/** Inverse of sessionKey; a key with no separator is a bare (host-less) id. */
export function parseSessionKey(key: unknown) {
  const raw = key == null ? '' : String(key);
  const sep = raw.indexOf(' ');
  if (sep < 0) return { hostId: null, sessionId: raw };
  return { hostId: raw.slice(0, sep), sessionId: raw.slice(sep + 1) };
}

/** Composite key of a session object in client state (writers stamp `host`). */
export function sessionRefKey(session?: Pick<HelperSession, 'id' | 'host'> | null) {
  return sessionKey(session && session.host, session && session.id);
}

/**
 * Human label for a host entry: the server's own label if it gave one, else
 * the fleet name, else the bare authority of its base. The self host has no
 * base, so it says so rather than rendering an empty chip.
 */
export function hostDisplayLabel(host?: HelperHost | null) {
  if (!host) return '';
  if (host.label) return String(host.label);
  if (host.name) return String(host.name);
  if (!host.base) return 'this host';
  return String(host.base).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Per-host feature gating. `capabilities` is the host's own advertisement
 * (GET /api/host) and absent means unsupported: an advertised set that omits
 * a feature hides the affordance rather than letting it die on connect.
 * A host that advertised nothing at all (older build, or /api/host hasn't
 * answered yet) is only trusted to the local /api/config when it is *this*
 * host — a remote of unknown build stays hidden, because a dead button is
 * worse than a missing one.
 */
export function hostSupportsCapability(hostEntry: HelperHost | null | undefined, capability: string, config?: Readonly<Record<string, unknown>> | null) {
  const caps = hostEntry && hostEntry.capabilities;
  if (caps && typeof caps === 'object') return caps[capability] === true;
  const isSelf = !!hostEntry && (hostEntry.self === true || hostEntry.base === '');
  return isSelf ? !!(config && config[capability]) : false;
}

/**
 * Terminal gating for the host that owns the session on screen — the entry
 * host's own PI_DISH_TERMINAL says nothing about a peer's.
 */
export function hostSupportsTerminal(hostEntry?: HelperHost | null, config?: Readonly<Record<string, unknown>> | null) {
  return hostSupportsCapability(hostEntry, 'terminal', config);
}

// --- Host sections -------------------------------------------------------
// Color policy lives in src/core/host-colors.ts; its CommonJS exports are
// preserved below while the browser presentation imports it directly.
/**
 * Order for the sidebar's host sections: this host first, then by display
 * label. Deliberately not by recency - a heading that jumps around whenever
 * another machine speaks is worse than a stale-looking one.
 */
export function sortHostSections<T extends HelperHost>(hosts?: readonly T[] | null) {
  const rows: T[] = Array.isArray(hosts) ? [...hosts] : [];
  return rows.sort((a, b) => {
    if (!!a.self !== !!b.self) return a.self ? -1 : 1;
    const byLabel = hostDisplayLabel(a).localeCompare(hostDisplayLabel(b), undefined, { sensitivity: 'base' });
    if (byLabel) return byLabel;
    return String(a.hostId || a.base || '').localeCompare(String(b.hostId || b.base || ''));
  });
}

/** Collapse-store key for a host section (namespaced like `date:` buckets). */
export function hostSectionKey(hostKey?: string | null) { return 'host:' + (hostKey || 'self'); }

/** The searchable metadata text of a session — one definition for local
 * filtering and the server-side session search. */
export function sessionMetaText(session: HelperSession) {
  return [session.name, session.cwd, session.model, session.id].join(' ').toLowerCase();
}

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
