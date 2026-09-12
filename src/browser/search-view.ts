import type { ApiRequest } from './api-client';
import type { SessionState } from './session-state';
import type { createSessionSearch } from './session-search';
import { escapeHtml, formatRelativeTime, shortCwd } from './helper-format';
import { hostDisplayLabel } from './helper-identity';
import { parseSessionQuery, stripQueryField, applyHostTerms, positiveQueryTokens, highlightTokens } from './helper-query';
import { record } from './helper-values';
import { queryHosts, mergeSearchPayloads, decodeSearchPayload } from './search-data';
import type { SearchHost, SearchPayload, SearchViewData } from './search-data';
export function createSearchView(options: {
  root: HTMLElement; request: ApiRequest; sessionState: SessionState;
  hosts: () => readonly SearchHost[]; fanout: () => readonly SearchHost[];
  host: (id: string | null) => SearchHost | null; scope: () => string;
  connection: (host: SearchHost, event: 'blocked' | 'success' | 'failure', error?: unknown) => void;
  hostChip: (hostId: string | null) => string; closeOtherViews: () => void;
  loadPrevious: () => Promise<unknown>; selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
  sessionSearch: ReturnType<typeof createSessionSearch>;
}) {
  const document = options.root.ownerDocument, sessionState = options.sessionState;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const value = document.getElementById(id); if (!value) throw new Error('Missing search view element: ' + id); return value as T;
  };
  const effectiveHosts = options.hosts, fanoutHosts = options.fanout, scopeQuery = options.scope;
  const hostChipHtml = (host: string | null | undefined) => options.hostChip(host || null);
  const isMultiHost = () => effectiveHosts().length > 1;
  let disposed = false;
  let rowEvents = new AbortController();
  const events = new AbortController();
  let view = 0;
  function sameHost(host: SearchHost): boolean {
    const current = options.host(host.hostId);
    return !!current && current.hostId === host.hostId && current.base === host.base && (current.token || '') === (host.token || '');
  }
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  // --- Advanced search (main-pane takeover) ---
  // Full-width search over every session: the sidebar grammar verbatim (one
  // dialect — never fork it), multiple highlighted snippets per session with
  // an occurrence count, facet controls that are pure UI over the grammar
  // (they rewrite the query text, which stays the single source of truth),
  // and click-through that opens the session and hands the positive tokens to
  // the in-session search so the reader lands on the match. `<main>`-level
  // like the usage view because search isn't session-scoped; active scopes are
  // sent separately so the server applies them before its result cap.
  let searchViewSeq = 0;
  let searchViewQuery = '';
  let searchViewRenderedQuery = '';
  let searchViewTimer: ReturnType<typeof setTimeout> | undefined;
  let searchViewRepollTimer: ReturnType<typeof setTimeout> | undefined;

  function isSearchViewOpen() {
    return !disposed && options.root.classList.contains('search-open');
  }

  function openSearchView(initialQuery?: string) {
    if (disposed) return;
    closeSearchView(); options.closeOtherViews(); view++;
    if (typeof initialQuery === 'string') searchViewQuery = initialQuery;
    const input = element<HTMLInputElement>('searchViewInput');
    input.value = searchViewQuery;
    options.root.classList.add('search-open');
    input.focus();
    input.select();
    runSearchView();
  }

  function closeSearchView() {
    if (disposed) return;
    view++; rowEvents.abort();
    searchViewSeq += 1;
    options.root.classList.remove('search-open');
    clearTimeout(searchViewTimer);
    clearTimeout(searchViewRepollTimer);
  }

  function onSearchViewInput({ immediate = false } = {}) {
    if (!isSearchViewOpen()) return;
    ++searchViewSeq; clearTimeout(searchViewRepollTimer);
    searchViewQuery = element<HTMLInputElement>('searchViewInput').value;
    clearTimeout(searchViewTimer);
    if (immediate) runSearchView();
    else searchViewTimer = setTimeout(runSearchView, 300);
  }

  async function runSearchView() {
    if (!isSearchViewOpen()) return;
    clearTimeout(searchViewRepollTimer);
    const seq = ++searchViewSeq;
    const query = searchViewQuery.trim();
    const scope = scopeQuery().trim();
    const body = element('searchViewBody');
    if (body.childElementCount) body.classList.add('usage-refreshing');
    else body.innerHTML = '<div class="usage-state">Searching…</div>';
    // `host:` stays on this side of the wire — in the query and in any
    // active scope — or every server would answer with nothing. Positive
    // host terms prune the fan-out instead; the rest is applied to the
    // merged results below.
    const params = new URLSearchParams({ q: stripQueryField(query, 'host') });
    // The browser's default: inactive routine runs are cron noise — the server
    // drops them (before its result cap) unless the query or an active scope
    // affirmatively asks. Sent as a param so API/CLI consumers of /api/search
    // keep the inclusive corpus.
    params.set('hideAutomation', '1');
    const wireScope = stripQueryField(scope, 'host');
    if (wireScope) params.set('scope', wireScope);
    // Every host searches its own index and ranks with the same shared
    // scoreSessionMatch, so the merge is a plain re-sort on searchScore.
    const hosts = queryHosts(queryHosts(fanoutHosts(), query), scope).map(host => Object.freeze({ ...host }));
    const stale = () => seq !== searchViewSeq || !isSearchViewOpen() ||
      query !== searchViewQuery.trim() || scope !== scopeQuery().trim();
    // Render as each host lands: a fleet's slowest peer must not decide when
    // the fastest one's results become readable. renderSearchView is a full
    // idempotent render, and on one host the first settle *is* the final one —
    // single-host behavior is unchanged, hint and all.
    const status: ('pending' | 'ok' | 'error')[] = hosts.map(() => 'pending');
    const payloads: (SearchPayload | undefined)[] = new Array(hosts.length);
    const reasons: unknown[] = new Array(hosts.length);
    let renderedIndexing = false;
    let didRender = false;
    const render = () => {
      if (stale()) return;
      const ok = hosts.flatMap((host, i) => { const payload = payloads[i]; return status[i] === 'ok' && payload ? [{ host, payload }] : []; });
      const d: SearchViewData = ok.length
        ? mergeSearchPayloads(ok, query)
        : { results: [], total: 0, hiddenByScopes: 0, hiddenByAutomation: 0, indexing: false };
      // The client-only half of the grammar, applied to what came back: the
      // query's remaining host terms (negations, and positives on a host that
      // serves several labels), then any host term in an active scope. Every
      // partial render goes through it — partial results must not bypass the
      // grammar for even one frame.
      d.results = applyHostTerms(d.results, query);
      const inScope = applyHostTerms(d.results, scope);
      d.hiddenByScopes += d.results.length - inScope.length;
      d.results = inScope;
      d.hostErrors = hosts.filter((_, i) => status[i] === 'error').map(hostDisplayLabel);
      d.hostPending = hosts.filter((_, i) => status[i] === 'pending').map(hostDisplayLabel);
      searchViewRenderedQuery = query;
      didRender = true; renderedIndexing = d.indexing;
      renderSearchView(d, query, hosts);
    };
    try {
      await Promise.all(hosts.map(async (host, i) => {
        try {
          const r = await options.request(host, '/api/search?' + params, { timeoutMs: 20000 });
          if (r.status === 401) { if (sameHost(host)) options.connection(host, 'blocked'); throw new Error('needs a token'); }
          const data: unknown = await r.json();
          if (!sameHost(host)) throw new Error('host connection changed');
          if (!r.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : `HTTP ${r.status}`);
          payloads[i] = decodeSearchPayload(data);
          status[i] = 'ok';
          options.connection(host, 'success');
        } catch (e) {
          status[i] = 'error';
          reasons[i] = e;
          if (!host.self && sameHost(host)) options.connection(host, 'failure', e);
        }
        // Until one host has answered there is nothing to show: keep the
        // previous render (or "Searching…") instead of flashing an empty list.
        if (status.some(s => s === 'ok')) render();
      }));
      if (!status.some(s => s === 'ok')) {
        // Every host pruned away is an answer, not a failure: the query named a
        // host none of them is, so the result set is empty.
        if (hosts.length) throw reasons.find(Boolean) || new Error('no hosts answered');
        render();
      }
      if (stale() || !didRender) return;
      if (renderedIndexing) searchViewRepollTimer = setTimeout(() => { if (!stale()) void runSearchView(); }, 1000);
    } catch (e) {
      if (stale()) return;
      body.classList.remove('usage-refreshing');
      body.innerHTML = `<div class="usage-state">Search failed: ${escapeHtml(message(e))}</div>`;
    }
  }

  // Facet plumbing: replace any `prefix:` term in the query text with the
  // picked value (or drop it). Rewriting the visible query — instead of
  // keeping hidden facet state — means what you see is exactly what runs,
  // and a facet choice can be hand-edited afterwards.
  function setSearchToken(prefix: 'cwd' | 'model' | 'host' | 'is' | 'since', value: string | null) {
    if (!isSearchViewOpen()) return;
    const input = element<HTMLInputElement>('searchViewInput');
    let q = input.value
      .replace(new RegExp(`(^|\\s)-?${prefix}:("[^"]*"|\\S+)`, 'gi'), ' ')
      .replace(/\s{2,}/g, ' ').trim();
    if (value) q = (q ? q + ' ' : '') + prefix + ':' + (/\s/.test(value) ? `"${value}"` : value);
    input.value = q;
    onSearchViewInput({ immediate: true });
  }

  const SEARCH_DATE_PRESETS = [['', 'Any time'], ['1d', '24h'], ['7d', '7 days'], ['30d', '30 days']];

  function searchFacetState() {
    const parsed = parseSessionQuery(searchViewQuery);
    const val = (f: string) => parsed.terms.find(t => t.field === f && !t.neg)?.value || '';
    return {
      cwd: val('cwd'),
      model: val('model'),
      host: val('host'),
      activeOnly: parsed.terms.some(t => t.field === 'is' && !t.neg && t.value === 'active'),
      automationOnly: parsed.terms.some(t => t.field === 'is' && !t.neg && t.value === 'automation'),
      since: (searchViewQuery.match(/(?:^|\s)since:(\S+)/i) || [])[1] || '',
    };
  }

  // Facet options come from the sidebar's session lists (the full corpus the
  // client already knows), not from the current results — otherwise picking a
  // workspace would immediately empty every other option.
  function searchFacetOptions() {
    const all = [...sessionState.sessions.active, ...sessionState.sessions.previous];
    const cwds = new Map<string, string>(), models = new Set<string>();
    for (const s of all) {
      if (s.cwd) cwds.set(s.cwd, shortCwd(s.cwd));
      if (s.model && s.model !== 'unknown') models.add(s.model);
    }
    return {
      cwds: [...cwds.entries()].sort((a, b) => a[1].localeCompare(b[1])),
      models: [...models].sort(),
    };
  }

  function renderSearchFacetsHtml() {
    const st = searchFacetState();
    const opts = searchFacetOptions();
    const presets = SEARCH_DATE_PRESETS.map(([v, l]) =>
      `<button class="usage-range-btn${st.since === v ? ' active' : ''}" data-since="${v}">${l}</button>`).join('');
    const cwdOptions = ['<option value="">All workspaces</option>',
      ...opts.cwds.map(([cwd, label]) =>
        `<option value="${escapeHtml(cwd)}"${cwd.toLowerCase() === st.cwd ? ' selected' : ''}>${escapeHtml(label)}</option>`)].join('');
    const modelOptions = ['<option value="">All models</option>',
      ...opts.models.map(m =>
        `<option value="${escapeHtml(m)}"${m.toLowerCase() === st.model ? ' selected' : ''}>${escapeHtml(m)}</option>`)].join('');
    // The host facet exists only where there is a fleet to choose from, and
    // its options come from the client's own host list — hosts are a client
    // concept, so no result payload could source them.
    const hostSelect = !isMultiHost() ? '' : `<select class="search-facet-select" id="searchFacetHost">${
      ['<option value="">All hosts</option>', ...effectiveHosts().map(h => hostDisplayLabel(h)).filter(Boolean).map(label =>
        `<option value="${escapeHtml(label)}"${label.toLowerCase() === st.host ? ' selected' : ''}>${escapeHtml(label)}</option>`)].join('')
    }</select>`;
    return `<div class="search-facets">
      <div class="usage-ranges">${presets}</div>
      <select class="search-facet-select" id="searchFacetCwd">${cwdOptions}</select>
      <select class="search-facet-select" id="searchFacetModel">${modelOptions}</select>
      ${hostSelect}
      <button class="scope-chip${st.activeOnly ? ' active' : ''}" id="searchFacetActive" title="is:active">Active only</button>
      <button class="scope-chip${st.automationOnly ? ' active' : ''}" id="searchFacetAutomation" title="is:automation">Automation</button>
    </div>`;
  }

  function renderSearchView(d: SearchViewData, query: string, hosts: readonly SearchHost[]) {
    if (!isSearchViewOpen()) return;
    rowEvents.abort(); rowEvents = new AbortController();
    const renderedView = view;
    const owns = () => renderedView === view && isSearchViewOpen();
    const listener = { signal: rowEvents.signal };
    const body = element('searchViewBody');
    body.classList.remove('usage-refreshing');
    const tokens = positiveQueryTokens(parseSessionQuery(query));
    const shown = d.results || [];
    const scopesHidden = Number(d.hiddenByScopes) || 0;
    const automationHidden = Number(d.hiddenByAutomation) || 0;

    const cards = shown.map(s => {
      let dot = '';
      if (s.turnInProgress || s.compacting) dot = '<span class="session-item-status working"></span>';
      else if (s.isActive) dot = '<span class="live-dot"></span>';
      const count = s.matchCount
        ? `<span class="search-result-count">${s.matchCount} ${s.matchCount === 1 ? 'match' : 'matches'}</span>` : '';
      const snippets = (s.snippets || []).map(sn =>
        `<div class="search-result-snippet">${highlightTokens(sn, tokens)}</div>`).join('');
      return `<div class="search-result" data-id="${escapeHtml(s.id)}"${s.host ? ` data-host="${escapeHtml(s.host)}"` : ''} data-content-matches="${s.matchCount > 0 ? '1' : '0'}">
        <div class="search-result-header">
          ${dot}<span class="search-result-name">${highlightTokens(s.name || 'Unnamed', tokens)}</span>
          ${count}<span class="search-result-time">${formatRelativeTime(s.lastActivity)}</span>
        </div>
        <div class="search-result-meta">${hostChipHtml(s.host)}${escapeHtml(shortCwd(s.cwd || '~'))} · ${escapeHtml(s.model)}</div>
        ${snippets}
      </div>`;
    }).join('');

    body.innerHTML = `
      ${renderSearchFacetsHtml()}
      ${d.indexing ? '<div class="usage-notice">History is indexing; results will refresh…</div>' : ''}
      ${d.hostErrors?.length ? `<div class="usage-notice">Not searched: ${escapeHtml(d.hostErrors.join(', '))} did not answer.</div>` : ''}
      ${d.hostPending?.length ? `<div class="usage-notice">Still searching ${escapeHtml(d.hostPending.join(', '))}…</div>` : ''}
      <div class="search-count-line">${shown.length === 1 ? '1 session' : `${shown.length} sessions`}${d.total > d.results.length ? ` — showing the ${d.results.length} ${tokens.length ? 'best matches' : 'most recent'}, narrow the query for the rest` : ''}</div>
      ${cards || '<div class="usage-state">No matching sessions.</div>'}
      ${scopesHidden > 0 ? `<div class="scope-hidden-note">${scopesHidden} hidden by scopes</div>` : ''}
      ${automationHidden > 0 ? `<div class="scope-hidden-note">${automationHidden} automation run${automationHidden === 1 ? '' : 's'} hidden (is:automation shows them)</div>` : ''}
    `;
    body.querySelectorAll<HTMLElement>('[data-since]').forEach(button => button.addEventListener('click', () => {
      if (owns()) setSearchToken('since', button.dataset.since || null);
    }, listener));
    for (const [id, prefix] of [['searchFacetCwd', 'cwd'], ['searchFacetModel', 'model'], ['searchFacetHost', 'host']] as const) {
      const select = body.querySelector<HTMLSelectElement>('#' + id);
      select?.addEventListener('change', () => { if (owns()) setSearchToken(prefix, select.value || null); }, listener);
    }
    body.querySelector('#searchFacetActive')?.addEventListener('click', () => { if (owns()) setSearchToken('is', searchFacetState().activeOnly ? null : 'active'); }, listener);
    body.querySelector('#searchFacetAutomation')?.addEventListener('click', () => { if (owns()) setSearchToken('is', searchFacetState().automationOnly ? null : 'automation'); }, listener);
    body.querySelectorAll<HTMLElement>('.search-result').forEach(card => {
      const id = card.dataset.id, host = card.dataset.host || null, endpoint = hosts.find(value => value.hostId === host);
      card.addEventListener('click', () => {
        if (owns() && id && endpoint && sameHost(endpoint)) void openSearchResult(id, card.dataset.contentMatches === '1', host, query, endpoint);
      }, listener);
    });

  }

  /**
   * Click-through: close the takeover, show the session, and — when the query
   * had text terms — hand them to the in-session search so the reader lands on
   * the actual match instead of at the transcript's tail.
   */
  async function openSearchResult(id: string, hasContentMatches: boolean, host: string | null = null, renderedQuery = searchViewRenderedQuery, endpoint = options.host(host)): Promise<void> {
    if (!isSearchViewOpen() || !endpoint || !sameHost(endpoint)) return;
    const captured = Object.freeze({ ...endpoint });
    const tokens = positiveQueryTokens(parseSessionQuery(renderedQuery));
    closeSearchView(); const navigation = searchViewSeq;
    if (!sessionState.findSession(id, host)) await options.loadPrevious();
    if (disposed || navigation !== searchViewSeq || !sameHost(captured)) return;
    const entry = sessionState.findSession(id, host); if (!entry) return;
    const selecting = options.selectSession(id, { host: entry.host || null });
    const owner = sessionState.captureSelection(), selectedView = view;
    await selecting;
    if (tokens.length && hasContentMatches && owner && selectedView === view && sessionState.ownsSelection(owner) && owner.id === id && owner.host === (entry.host || null)) {
      options.sessionSearch.open();
      const input = element<HTMLInputElement>('searchInput'); input.value = tokens.join(' ');
      await options.sessionSearch.run(input.value.trim().toLowerCase(), { mode: 'any', closeIfEmpty: true });
    }
  }

  const input = element<HTMLInputElement>('searchViewInput');
  input.addEventListener('input', () => onSearchViewInput(), { signal: events.signal });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') onSearchViewInput({ immediate: true }); }, { signal: events.signal });
  return { open: openSearchView, close: closeSearchView, isOpen: isSearchViewOpen, run: runSearchView,
    input: onSearchViewInput, setToken: setSearchToken, openResult: openSearchResult,
    dispose() { closeSearchView(); events.abort(); disposed = true; },
  };
}
