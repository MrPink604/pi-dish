import { ApiHttpError } from './api-client';
import type { HostEndpoint, RequestOptions } from './api-client';
import type { SessionList } from '../core/session-api';
import { hostKeyOf } from './host-connections';
import type { ConnectionHost, HostConnectionEvent } from './host-connections';
import type { SessionEntry, SessionLists } from './session-state';
import { sessionEntryFromRow } from './session-state';

export type SessionHost = Readonly<HostEndpoint & Pick<ConnectionHost, 'key' | 'hostId' | 'self'>>;
export interface HostSessionLoaderOptions {
  requestList: (host: SessionHost, path: string, options: RequestOptions) => Promise<SessionList>;
  currentSequence: () => number;
  stripHostQuery: (query: string | undefined) => string;
  onConnection: (host: SessionHost, event: HostConnectionEvent) => void;
  onIndexing: () => void;
  beforePublish: (host: SessionHost, lists: SessionLists, wireQuery: string) => void;
  onPublish: (query?: string) => void;
  onError: (host: SessionHost, error: unknown) => void;
}

interface RequestOwner { sequence: number; query: string }
interface Inflight {
  host: SessionHost;
  owner: RequestOwner;
  promise: Promise<void>;
  wireQuery: string;
  withPrevious: boolean;
}

/** An active-only poll refreshes live children without losing historical rows. */
export function mergeLiveSubagents(previous: SessionEntry[], children?: SessionEntry[]): SessionEntry[] {
  const fresh = new Map((children || []).map(session => [session.id, session]));
  const merged = (previous || []).map(session => {
    const live = fresh.get(session.id);
    if (live) { fresh.delete(session.id); return { ...session, ...live }; }
    return session.subagentLive ? { ...session, subagentLive: false } : session;
  });
  for (const session of fresh.values()) merged.push(session);
  return merged;
}

/** Preserve advisory family hints until a full historical scan can resolve them. */
function mergeActiveHints(active: SessionEntry[], previousActive: SessionEntry[]): SessionEntry[] {
  const prior = new Map(previousActive.map(session => [session.id, session]));
  return active.map(session => {
    const old = prior.get(session.id);
    if (!old) return session;
    const preserveParent = !session.parentId && old.parentId;
    const preserveFamily = !session.familyParentId && old.familyParentId;
    return preserveParent || preserveFamily
      ? {
          ...session,
          ...(preserveParent ? { parentId: old.parentId, parentSource: old.parentSource } : {}),
          ...(preserveFamily ? { familyParentId: old.familyParentId } : {}),
        }
      : session;
  });
}

/** Per-host requests and cached rows; the app owns fan-out and view effects. */
export function createHostSessionLoader(options: HostSessionLoaderOptions) {
  const caches = new Map<string, SessionLists>();
  const owners = new Map<string, RequestOwner>();
  const inflight = new Map<string, Inflight>();
  const indexing = new Map<string, boolean>();

  function load(host: SessionHost, query: string | undefined, withPrevious: boolean, sequence: number): Promise<void> {
    // Capture identity and routing before the first await, including callers
    // whose catalog entry is later relabelled, identified or edited.
    const target = Object.freeze({ ...host });
    const key = hostKeyOf(target);
    const wireQuery = options.stripHostQuery(query);
    const pending = inflight.get(key);
    if (pending && pending.wireQuery === wireQuery && pending.withPrevious === withPrevious
        && pending.host.base === target.base && pending.host.token === target.token
        && pending.host.hostId === target.hostId) {
      // The newest fan-out adopts this request. Replacing its owner would
      // invalidate the very response the joiner is waiting to publish.
      pending.owner.sequence = sequence;
      pending.owner.query = query || '';
      return pending.promise;
    }
    const owner = { sequence, query: query || '' };
    owners.set(key, owner);
    const promise = run(target, key, wireQuery, withPrevious, owner).finally(() => {
      if (inflight.get(key)?.promise === promise) inflight.delete(key);
    });
    inflight.set(key, { host: target, owner, promise, wireQuery, withPrevious });
    return promise;
  }

  async function run(host: SessionHost, key: string, wireQuery: string, withPrevious: boolean, owner: RequestOwner): Promise<void> {
    try {
      const params = new URLSearchParams();
      if (wireQuery) params.set('q', wireQuery);
      if (!withPrevious) params.set('active', '1');
      params.set('view', 'client');
      const data = await options.requestList(host, '/api/sessions?' + params.toString(), { timeoutMs: 20000 });
      // Object identity survives counter reuse after a host is removed and
      // re-added. Retired requests cannot overwrite a newer observation.
      if (owners.get(key) !== owner) return;
      options.onConnection(host, 'success');
      if (owner.sequence !== options.currentSequence()) return;
      const cached = caches.get(key) || { active: [], previous: [] };
      if (withPrevious) {
        indexing.set(key, !!data.indexing);
        if (data.indexing) options.onIndexing();
      }
      const active = data.active.map(sessionEntryFromRow);
      const next: SessionLists = {
        active: withPrevious ? active : mergeActiveHints(active, cached.active),
        previous: withPrevious ? data.previous.map(sessionEntryFromRow)
          : mergeLiveSubagents(cached.previous, data.children?.map(sessionEntryFromRow)),
      };
      // Unread bookkeeping must finish before the state writer renders rows.
      options.beforePublish(host, next, wireQuery);
      caches.set(key, next);
      options.onPublish(owner.query);
    } catch (error) {
      if (owners.get(key) !== owner) return;
      if (error instanceof ApiHttpError && error.status === 401) {
        options.onConnection(host, 'blocked');
        options.onPublish();
        return;
      }
      options.onConnection(host, { type: 'failure', error });
      options.onError(host, error);
      // Existing cached rows remain available, including peers that failed.
      if (owner.sequence === options.currentSequence()) options.onPublish();
    }
  }

  function getCache(host: SessionHost): SessionLists | undefined { return caches.get(hostKeyOf(host)); }
  function isIndexing(): boolean { return [...indexing.values()].some(Boolean); }
  function prune(liveKeys: ReadonlySet<string>): void {
    for (const map of [caches, owners, inflight, indexing]) {
      for (const key of map.keys()) if (!liveKeys.has(key)) map.delete(key);
    }
  }

  return { load, getCache, isIndexing, prune, retireRequests() { owners.clear(); inflight.clear(); } };
}
