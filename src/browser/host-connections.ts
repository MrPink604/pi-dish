/** The host fields used by connection policy, independent of catalog metadata. */
export interface ConnectionHost {
  key?: string | null;
  hostId?: string | null;
  base?: string | null;
  self?: boolean;
  reachable?: boolean;
  error?: unknown;
}

export type HostConnectionState = 'reachable' | 'connecting' | 'backoff' | 'blocked';
export interface HostConnectionRecord {
  readonly state: Exclude<HostConnectionState, 'connecting'>;
  readonly failures: number;
  readonly retryAt: number;
  readonly error: string | null;
  readonly reachableSince: number;
}
export type HostConnectionEvent = 'success' | 'blocked'
  | { type: 'failure' | 'seed-down'; error?: unknown };

export const HOST_BACKOFF_LADDER = [3000, 4000, 8000, 16000] as const;
export const HOST_BACKOFF_RESET_MS = 30000;

export function hostKeyOf(host: ConnectionHost | null | undefined): string {
  return (host && (host.key || host.hostId || host.base)) || 'self';
}

/**
 * Failure climbs the ladder without demoting blocked. A success retains the
 * rung until 30s of continuous reachability; seeding never replaces a client
 * observation. Unknown events preserve the existing record by identity.
 */
export function hostConnReduce(prev: HostConnectionRecord | null, event: unknown, now?: number): HostConnectionRecord | null {
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const kind = typeof event === 'string' ? event : (event && typeof event === 'object' && 'type' in event && event.type) || '';
  const state = prev && typeof prev === 'object' ? prev : null;
  const errText = (value: unknown) => {
    if (value == null) return null;
    const text = String((typeof value === 'object' && 'message' in value && value.message) || value);
    return text || null;
  };
  const eventError = event && typeof event === 'object' && 'error' in event ? errText(event.error) : null;

  if (kind === 'blocked') {
    if (state && state.state === 'blocked') return state;
    return { state: 'blocked', failures: 0, retryAt: 0, error: 'Unauthorized', reachableSince: 0 };
  }
  if (kind === 'success') {
    const since = state && state.state === 'reachable' && state.reachableSince ? state.reachableSince : at;
    const forgiven = at - since >= HOST_BACKOFF_RESET_MS;
    return {
      state: 'reachable',
      failures: forgiven ? 0 : (state && state.failures) || 0,
      retryAt: 0,
      error: null,
      reachableSince: since,
    };
  }
  if (kind === 'failure') {
    if (state && state.state === 'blocked') return state;
    const failures = ((state && state.failures) || 0) + 1;
    const wait = HOST_BACKOFF_LADDER[Math.min(failures - 1, HOST_BACKOFF_LADDER.length - 1)];
    return { state: 'backoff', failures, retryAt: at + wait, error: eventError, reachableSince: 0 };
  }
  if (kind === 'seed-down') {
    if (state) return state;
    return { state: 'backoff', failures: 1, retryAt: at + HOST_BACKOFF_LADDER[0], error: eventError, reachableSince: 0 };
  }
  return state;
}

/** Runtime observations stay separate from the persisted host catalog. */
export function createHostConnections(options: { onChange: () => void; now?: () => number }) {
  const records = new Map<string, HostConnectionRecord>();
  const now = options.now || Date.now;

  function stateOf(host: ConnectionHost | null | undefined): HostConnectionState {
    const entry = records.get(hostKeyOf(host));
    if (entry) return entry.state;
    if (host && host.self) return 'reachable';
    if (host && host.reachable === false) return 'backoff';
    return 'connecting';
  }

  function isDown(host: ConnectionHost | null | undefined): boolean {
    const state = stateOf(host);
    return state === 'backoff' || state === 'blocked';
  }

  function note(host: ConnectionHost | null | undefined, event: HostConnectionEvent): void {
    const key = hostKeyOf(host);
    const prev = records.get(key) || null;
    const next = hostConnReduce(prev, event, now());
    if (!next || next === prev) return;
    records.set(key, next);
    // Ladder changes alone must not rebuild the settings UI every poll.
    if (!prev || prev.state !== next.state || prev.error !== next.error) options.onChange();
  }

  function seed(hosts: readonly ConnectionHost[]): void {
    const at = now();
    for (const host of hosts) {
      if (host.self || host.reachable !== false) continue;
      const key = hostKeyOf(host);
      if (records.has(key)) continue;
      const next = hostConnReduce(null, { type: 'seed-down', error: host.error || 'unreachable' }, at);
      if (next) records.set(key, next);
    }
  }

  function pollable<T extends ConnectionHost>(hosts: readonly T[]): T[] {
    const at = now();
    return hosts.filter(host => {
      if (host.self) return true;
      const entry = records.get(hostKeyOf(host));
      if (!entry) return true;
      if (entry.state === 'blocked') return false;
      return !entry.retryAt || entry.retryAt <= at;
    });
  }

  function reset(key: string): void { records.delete(key); }
  function prune(liveKeys: ReadonlySet<string>): void {
    for (const key of records.keys()) if (!liveKeys.has(key)) records.delete(key);
  }

  return { stateOf, isDown, note, seed, pollable, reset, prune };
}
