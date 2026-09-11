import type { ApiRequest, HostEndpoint } from './api-client';
import { record } from './helper-values';
import { escapeHtml } from './helper-format';
import { decodeSavedFilters } from './display-preferences';
import type { SavedFilter } from './display-preferences';
/** Query text, scope definitions and device preferences own their controls and pending settings requests. */
export function createSidebarQuery(options: {
  document: Document; storage: Pick<Storage, 'getItem' | 'setItem'>; request: ApiRequest; host: () => HostEndpoint;
  render: () => void; reload: (query?: string) => Promise<unknown>; queriedFor: () => string; invalidateLists: () => void; busy: (value: boolean) => void;
  searchChanged: () => void; openSearch: (query?: string) => void; prompt: (label: string, initial: string) => string | null; alert: (message: string) => void;
}) {
  const { document, storage } = options;
  const input = document.getElementById('filterInput') as HTMLInputElement, chips = document.getElementById('scopeChips')!;
  const lifetime = new AbortController(); let chipEvents = new AbortController();
  let disposed = false, mounted = false, tab = 'active', view = storage.getItem('pi-dish-sidebar-view') === 'recent' ? 'recent' : 'workspace', query = '';
  function read(key: string, fallback: unknown): unknown { try { return JSON.parse(storage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
  function store(key: string, value: unknown) { try { storage.setItem(key, JSON.stringify(value)); } catch {} }
  let filters = decodeSavedFilters(read('pi-dish-saved-filters-cache', []));
  const rawScopes = read('pi-dish-active-scopes', []), scopes = new Set<string>(Array.isArray(rawScopes) ? rawScopes.filter((v): v is string => typeof v === 'string') : []);
  let debounce: ReturnType<typeof setTimeout> | null = null, queryGeneration = 0, settingsGeneration = 0;
  function cancelDebounce() { queryGeneration++; if (debounce) clearTimeout(debounce); debounce = null; }
  function scope() { return filters.filter(filter => scopes.has(filter.name)).map(filter => filter.query).join(' '); }
  function toggleView() { if (disposed) return; view = view === 'recent' ? 'workspace' : 'recent'; try { storage.setItem('pi-dish-sidebar-view', view); } catch {} updateView(); options.render(); }
  function updateView() {
    if (disposed) return; const button = document.getElementById('viewToggle'); if (!button) return;
    button.innerHTML = view === 'recent'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
    button.title = view === 'recent' ? 'Grouped by date — switch to workspaces' : 'Grouped by workspace — switch to recent';
  }
  function refreshViews(reload = true) {
    if (disposed) return; renderChips(); options.render(); if (reload && options.queriedFor() !== query) void options.reload(query || undefined); options.searchChanged();
  }
  function setFilters(value: unknown) { if (disposed) return; settingsGeneration++; filters = decodeSavedFilters(value); }
  function commitFilters(next: readonly SavedFilter[]) { filters = [...next]; store('pi-dish-saved-filters-cache', filters); }
  async function loadFilters() {
    if (disposed) return; const generation = ++settingsGeneration, target = Object.freeze({ ...options.host() });
    try {
      const response = await options.request(target, '/api/settings'), data: unknown = await response.json();
      if (disposed || generation !== settingsGeneration || options.host().base !== target.base) return;
      if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : 'Failed to load filters');
      commitFilters(decodeSavedFilters(record(data) ? data.savedFilters : undefined)); refreshViews(false);
    } catch (error) { if (!disposed && generation === settingsGeneration && options.host().base === target.base) console.error('Failed to load saved filters:', error); }
  }
  async function persistFilters(next: readonly SavedFilter[], host: Readonly<HostEndpoint> = options.host()) {
    if (disposed) return; const generation = ++settingsGeneration, target = Object.freeze({ ...host });
    const response = await options.request(target, '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ savedFilters: decodeSavedFilters(next) }) });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : 'save failed');
    if (disposed || generation !== settingsGeneration || options.host().base !== target.base) return;
    commitFilters(decodeSavedFilters(record(data) ? data.savedFilters : undefined)); refreshViews();
  }
  function toggleScope(name: string) { if (disposed) return; if (scopes.has(name)) scopes.delete(name); else scopes.add(name); store('pi-dish-active-scopes', [...scopes]); refreshViews(); }
  async function saveCurrent() {
    if (disposed) return; const captured = query.trim(); if (!captured) return;
    const name = options.prompt('Name this filter:', ''); if (!name?.trim()) return; const trimmed = name.trim().slice(0, 60), next = filters.filter(filter => filter.name !== trimmed).concat([{ name: trimmed, query: captured }]);
    scopes.add(trimmed); store('pi-dish-active-scopes', [...scopes]); cancelDebounce(); options.invalidateLists(); options.busy(false); input.value = ''; query = ''; const generation = queryGeneration;
    try { await persistFilters(next); } catch (error) { if (!disposed && generation === queryGeneration) options.alert('Could not save filter: ' + (error instanceof Error ? error.message : String(error))); }
  }
  function renderChips() {
    if (disposed) return; chipEvents.abort(); chipEvents = new AbortController(); const { signal } = chipEvents;
    const html = filters.map(filter => `<button class="scope-chip${scopes.has(filter.name) ? ' active' : ''}" data-name="${escapeHtml(filter.name)}" title="${escapeHtml(filter.query)}">${escapeHtml(filter.name)}</button>`);
    if (query.trim()) html.push('<button class="scope-chip scope-add" title="Save the current query as a reusable filter">+ save filter</button>', '<button class="scope-chip search-open-chip" title="Open this query in the full search view">⤢ full search</button>');
    chips.innerHTML = html.join(''); chips.style.display = html.length ? '' : 'none';
    for (const button of Array.from(chips.querySelectorAll<HTMLElement>('button'))) {
      const name = button.dataset.name, captured = query;
      button.addEventListener('click', () => {
        if (disposed || signal.aborted || !chips.contains(button)) return;
        if (button.classList.contains('scope-add')) void saveCurrent(); else if (button.classList.contains('search-open-chip')) options.openSearch(captured); else if (name !== undefined) toggleScope(name);
      }, { signal });
    }
  }
  function switchTab(next: string) {
    if (disposed) return; tab = next === 'all' ? 'all' : 'active'; cancelDebounce();
    document.getElementById('tabActive')?.classList.toggle('active', tab === 'active'); document.getElementById('tabAll')?.classList.toggle('active', tab === 'all');
    input.placeholder = tab === 'active' ? 'Filter active sessions...' : 'Search all sessions...'; options.render(); void options.reload(query || undefined);
  }
  function onInput() {
    if (disposed) return; cancelDebounce(); query = input.value.trim(); options.invalidateLists(); renderChips(); options.render();
    if (query) { options.busy(true); const generation = queryGeneration, captured = query; debounce = setTimeout(() => { debounce = null; if (!disposed && generation === queryGeneration) void options.reload(captured); }, 300); }
    else void options.reload();
  }
  function toggle() { if (disposed) return; const sidebar = document.getElementById('sidebar')!, open = !sidebar.classList.contains('open'); sidebar.classList.toggle('open', open); document.getElementById('sidebarOverlay')?.classList.toggle('active', open); document.body.classList.toggle('sidebar-open', open); }
  function close() { document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('sidebarOverlay')?.classList.remove('active'); document.body.classList.remove('sidebar-open'); }
  function mount() {
    if (disposed || mounted) return; mounted = true; const { signal } = lifetime;
    input.addEventListener('input', onInput, { signal }); document.getElementById('tabActive')?.addEventListener('click', () => switchTab('active'), { signal }); document.getElementById('tabAll')?.addEventListener('click', () => switchTab('all'), { signal });
    document.getElementById('viewToggle')?.addEventListener('click', toggleView, { signal });
    document.querySelector('.filter-search-btn')?.addEventListener('click', () => options.openSearch(query || undefined), { signal });
    for (const button of Array.from(document.querySelectorAll('[data-toggle-sidebar]'))) button.addEventListener('click', toggle, { signal });
  }
  function dispose() { if (disposed) return; cancelDebounce(); settingsGeneration++; options.invalidateLists(); options.busy(false); close(); disposed = true; lifetime.abort(); chipEvents.abort(); }
  return { mount, dispose, toggleView, updateView, scope, setFilters, loadFilters, persistFilters, toggleScope, saveCurrent, renderChips, switchTab, onInput, toggle, close,
    get filters(): readonly SavedFilter[] { return filters; }, get tab() { return tab; }, get view() { return view; }, get query() { return query; } };
}
