import type { ApiRequest } from './api-client';
import { createSessionApi } from './api-client';
import type { SessionState, HostSessionLists } from './session-state';
import { createHostSessionLoader } from './host-session-loader';
import type { SessionHost } from './host-session-loader';
import type { HostConnectionEvent } from './host-connections';
import type { HelperHost } from './shared-helper-types';
import { stripQueryField } from './helper-query';
import { queryHosts } from './search-data';
import type { createSidebarActivity } from './sidebar-activity';
export type SidebarListHost = SessionHost & HelperHost;
/** Fan-out, polling and indexing timers share the current sidebar query generation. */
export function createSidebarLists(options: {
  document: Document; request: ApiRequest; sessionState: SessionState; activity: ReturnType<typeof createSidebarActivity>;
  hosts: () => readonly SidebarListHost[]; pollable: () => readonly SidebarListHost[]; selfId: () => string | null;
  query: () => string; all: () => boolean; refreshFleet: () => void; connection: (host: SessionHost, event: HostConnectionEvent) => void;
}) {
  const { document, sessionState } = options, api = createSessionApi(options.request);
  let disposed = false, sequence = 0, indexing = false, queriedFor = '';
  let indexingTimer: ReturnType<typeof setTimeout> | null = null, pollTimer: ReturnType<typeof setInterval> | null = null;
  function busy(value: boolean) { if (!disposed) document.querySelector('.sidebar-filter')?.classList.toggle('searching', value); }
  const loader = createHostSessionLoader({
    requestList: (host, path, init) => api.list(host, path, init), currentSequence: () => sequence,
    stripHostQuery: query => stripQueryField(query, 'host'), onConnection: (host, event) => { if (!disposed) options.connection(host, event); },
    onIndexing: () => { if (disposed || indexingTimer) return; indexingTimer = setTimeout(() => { indexingTimer = null; void refresh(); }, 1000); },
    beforePublish: (host, next, wireQuery) => {
      if (disposed) return; const hostId = host.hostId || null, selected = sessionState.currentSession;
      if (selected && !document.hidden && (selected.host || null) === hostId) { const fresh = next.active.find(row => row.id === selected.id) || next.previous.find(row => row.id === selected.id); if (fresh) options.activity.mark(selected, fresh.lastActivity); }
      if (!wireQuery) options.activity.prune(hostId, next.active);
    },
    onPublish: query => { if (disposed) return; if (query !== undefined) queriedFor = query; publish(); },
    onError: (host, error) => { if (!disposed && host.self) console.error('Failed to load sessions:', error); },
  });
  function publish() {
    if (disposed) return; indexing = loader.isIndexing(); const parts: HostSessionLists[] = [];
    for (const host of options.hosts()) { const cache = loader.getCache(host); if (cache) parts.push({ hostId: host.hostId || null, ...cache }); }
    sessionState.setSessionLists(parts.length ? parts : [{ hostId: options.selfId(), active: [], previous: [] }]);
  }
  async function load(query?: string, { withPrevious = options.all() } = {}) {
    if (disposed) return; const current = ++sequence; busy(true);
    await Promise.allSettled(queryHosts(options.pollable(), query || '').map(host => loader.load(host, query, withPrevious, current)));
    if (!disposed && current === sequence) busy(false);
  }
  function invalidate() { sequence++; loader.retireRequests(); }
  function refresh() { if (disposed) return Promise.resolve(); options.refreshFleet(); return load(options.query() || undefined); }
  function mount() { if (!disposed && !pollTimer) pollTimer = setInterval(() => { void refresh(); }, 10000); }
  function dispose() { if (disposed) return; busy(false); disposed = true; sequence++; if (pollTimer) clearInterval(pollTimer); if (indexingTimer) clearTimeout(indexingTimer); pollTimer = indexingTimer = null; loader.prune(new Set()); }
  return { loader, load, refresh, publish, busy, invalidate, mount, dispose, get indexing() { return indexing; }, get queriedFor() { return queriedFor; } };
}
