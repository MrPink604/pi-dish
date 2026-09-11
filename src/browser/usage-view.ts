import type { ApiRequest, HostEndpoint } from './api-client';
import type { HelperHost, Costs, Tokens, UsageBucket, UsageModel, UsageDay, UsageGroup, UsageSummary, HostUsageSummary, UsageLimitEntry } from './shared-helper-types';
import { escapeHtml, formatEstimatedCost, formatUsageCost, formatTokens, formatCacheStat, shortCwd } from './helper-format';
import { hostDisplayLabel } from './helper-identity';
import { mergeUsageSummaries, createFanoutRenderQueue, aggregateUsageWeekly, niceTicks, formatUsageDay, usageUnattributedCost, usageLimitsHtml, shortModelName } from './helper-usage';
import { finite, record } from './helper-values';
import { decodeUsageSummary, decodeUsageLimits } from './usage-data';
export type UsageHost = Readonly<HostEndpoint & HelperHost & { hostId: string | null }>;
export type UsageMetric = 'cost' | 'tokens' | 'calls';
export type UsageRange = '1' | '7' | '30' | 'all';
interface UsageChart { readonly buckets: readonly UsageDay[]; readonly seriesRefs: readonly string[]; readonly metric: UsageMetric; readonly activeModelCount: number; readonly stack: 'models' | 'buckets' }
export function createUsageView(options: {
  root: HTMLElement; request: ApiRequest; storage: Pick<Storage, 'getItem' | 'setItem'>;
  fleetReady: () => Promise<unknown>; hosts: () => readonly UsageHost[]; host: (id: string | null) => UsageHost | null;
  multiHost: () => boolean; closeOtherViews: () => void;
  connection: (host: UsageHost, event: 'blocked' | 'success' | 'failure', error?: unknown) => void;
  selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
}) {
  const document = options.root.ownerDocument, window = document.defaultView!;
  const localStorage = options.storage, isMultiHost = options.multiHost;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const value = document.getElementById(id); if (!value) throw new Error('Missing usage element: ' + id); return value as T;
  };
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  let disposed = false, dataSequence = 0;
  let bodyEvents = new AbortController(), chartEvents = new AbortController(), detailEvents = new AbortController();
  const events = new AbortController();
  let renderGeneration = 0;
  let renderQueue: ReturnType<typeof createFanoutRenderQueue> | null = null;
  let usageRange: UsageRange = '30', usageTimer: ReturnType<typeof setTimeout> | undefined;
  let usageData: UsageSummary | null = null, usageChart: UsageChart | null = null, usageSelectedDay: string | null = null;
  let usageHostErrors: string[] = [], usageHostPending: string[] = [];
  let usageLimitsEntries: UsageLimitEntry[] = [], usageFetchSeq = 0;
  let usageSort: 'cost' | 'tokens' = localStorage.getItem('pi-dish-usage-sort') === 'tokens' ? 'tokens' : 'cost';
  let usageStack: 'buckets' | 'models' = localStorage.getItem('pi-dish-usage-stack') === 'buckets' ? 'buckets' : 'models';
  const usageModelFilter = new Set<string>();
  function sameHost(host: UsageHost): boolean {
    const current = options.host(host.hostId);
    return !!current && current.hostId === host.hostId && current.base === host.base && (current.token || '') === (host.token || '');
  }
  function retireRender(): void { renderGeneration++; bodyEvents.abort(); chartEvents.abort(); detailEvents.abort(); hideUsageTooltip(); }
  // --- Usage view (main-pane takeover) ---
  // Global usage/spend overview: KPI headlines, a stacked-by-model daily chart,
  // model share, and workspace/session breakdowns. Opened from the sidebar
  // header; `.main.usage-open` hides the empty state and session view (the
  // diff/file-view takeover pattern, one level up because usage isn't
  // session-scoped). Data is /api/usage-summary — the range presets scope
  // everything below them; the KPI row above is fixed headline windows.
  // Chart series colors are the validated --chart-N theme tokens; the top five
  // models in the range take slots 1–5 and the rest fold into "other".
  const USAGE_RANGES = [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All time']];
  const USAGE_RANGE_LABELS: Readonly<Record<string, string>> = { 1: 'today', 7: 'the last 7 days', 30: 'the last 30 days', all: 'all time' };

  function isUsageViewOpen() {
    return !disposed && options.root.classList.contains('usage-open');
  }

  function openUsageView() {
    if (disposed) return;
    options.closeOtherViews();
    if (isUsageViewOpen()) return;
    options.root.classList.add('usage-open');
    loadUsageView();
  }

  function closeUsageView() {
    if (disposed) return;
    usageFetchSeq++; retireRender(); renderQueue?.dispose(); renderQueue = null;
    clearTimeout(usageResizeTimer);
    options.root.classList.remove('usage-open');
    clearTimeout(usageTimer); usageTimer = undefined;
    hideUsageTooltip();
  }

  function setUsageRange(range: UsageRange) {
    if (!isUsageViewOpen()) return;
    usageRange = range;
    usageSelectedDay = null;
    loadUsageView();
  }

  // The cost/tokens toggle is the view's metric: it re-ranks the breakdowns
  // server-side (the groups are truncated to the top 20 there, so the client
  // re-sorting its slice would show the wrong twenty) *and* switches what the
  // chart, tooltip, and day detail plot. Device-local preference, like the
  // response-metadata density.
  function setUsageSort(sort: 'cost' | 'tokens') {
    if (!isUsageViewOpen()) return;
    if (usageSort === sort) return;
    usageSort = sort;
    localStorage.setItem('pi-dish-usage-sort', sort);
    loadUsageView();
  }
  function setUsageStack(stack: 'models' | 'buckets') {
    if (!isUsageViewOpen()) return;
    if (usageStack === stack) return;
    usageStack = stack;
    localStorage.setItem('pi-dish-usage-stack', stack);
    if (usageData) renderUsageView(usageData);
  }

  // Model filter (multi-select): clicking rows in the Models section toggles
  // refs in/out. Applied server-side — the workspace/session groups only exist
  // pre-truncated, so a filtered view needs a refetch, not a client re-slice.
  function usageModelsKey() { return [...usageModelFilter].join(','); }
  function toggleUsageModelFilter(ref: string) {
    if (!isUsageViewOpen()) return;
    if (usageModelFilter.has(ref)) usageModelFilter.delete(ref);
    else usageModelFilter.add(ref);
    loadUsageView();
  }
  function clearUsageModelFilter() {
    if (!isUsageViewOpen()) return;
    if (!usageModelFilter.size) return;
    usageModelFilter.clear();
    loadUsageView();
  }

  // Subscription limits ride their own fan-out: hosts without the capability
  // (older builds, no supporting harness) are skipped, a failed host just
  // contributes nothing (quota is supplementary to the spend view), and each
  // settle re-renders the view — renderUsageView is idempotent, so the section
  // simply appears once data exists.
  async function loadUsageLimits(fetchSeq: number): Promise<void> {
    const stale = () => fetchSeq !== usageFetchSeq || !isUsageViewOpen();
    usageLimitsEntries = [];
    await options.fleetReady();
    if (stale()) return;
    const hosts = options.hosts().filter(host => host.capabilities?.usageLimits).map(host => Object.freeze({ ...host }));
    const entries: UsageLimitEntry[] = [];
    await Promise.all(hosts.map(async host => {
      try {
        const response = await options.request(host, '/api/usage-limits', { timeoutMs: 20000 });
        if (response.status === 401) { if (sameHost(host)) options.connection(host, 'blocked'); throw new Error('needs a token'); }
        const data: unknown = await response.json();
        if (!response.ok || stale() || !sameHost(host)) return;
        const payload = decodeUsageLimits(data);
        if (payload.harnesses?.length) entries.push({ hostLabel: hostDisplayLabel(host), payload });
      } catch { /* Limits are supplementary; unavailable hosts add no rows. */ }
      if (stale()) return;
      usageLimitsEntries = [...entries].sort((a, b) => a.hostLabel.localeCompare(b.hostLabel));
      if (usageData && dataSequence === fetchSeq) renderUsageView(usageData);
    }));
  }
  async function loadUsageView(): Promise<void> {
    if (!isUsageViewOpen()) return;
    const fetchSeq = ++usageFetchSeq;
    clearTimeout(usageTimer); renderQueue?.dispose(); renderQueue = null;
    void loadUsageLimits(fetchSeq);
    const range = usageRange, sort = usageSort, models = usageModelsKey();
    const stale = () => fetchSeq !== usageFetchSeq || range !== usageRange || sort !== usageSort || models !== usageModelsKey() || !isUsageViewOpen();
    const body = element('usageViewBody');
    if (body.childElementCount) body.classList.add('usage-refreshing');
    else body.innerHTML = '<div class="usage-state">Loading estimated usage…</div>';
    try {
      await options.fleetReady(); if (stale()) return;
      const url = '/api/usage-summary?days=' + range + '&sort=' + sort + (models ? '&models=' + encodeURIComponent(models) : '');
      const hosts = options.hosts().map(host => Object.freeze({ ...host }));
      const status: ('pending' | 'ok' | 'error')[] = hosts.map(() => 'pending');
      const entries: (HostUsageSummary | undefined)[] = new Array(hosts.length), reasons: unknown[] = new Array(hosts.length);
      let indexing = false, rendered = false;
      const render = () => {
        if (stale()) return;
        const ok = entries.filter((entry, i): entry is HostUsageSummary => status[i] === 'ok' && !!entry);
        const data = mergeUsageSummaries(ok); if (!data) return;
        usageHostErrors = hosts.filter((_, i) => status[i] === 'error').map(hostDisplayLabel);
        usageHostPending = hosts.filter((_, i) => status[i] === 'pending').map(hostDisplayLabel);
        usageData = data; dataSequence = fetchSeq; rendered = true; indexing = data.indexing === true;
        renderUsageView(data);
      };
      const queueRender = renderQueue = createFanoutRenderQueue(status, render);
      await Promise.all(hosts.map(async (host, i) => {
        try {
          const response = await options.request(host, url, { timeoutMs: 20000 });
          if (response.status === 401) { if (sameHost(host)) options.connection(host, 'blocked'); throw new Error('needs a token'); }
          const data: unknown = await response.json();
          if (!sameHost(host)) throw new Error('host connection changed');
          if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
          entries[i] = { hostId: host.hostId, hostLabel: hostDisplayLabel(host), summary: decodeUsageSummary(data, { hostId: host.hostId, label: hostDisplayLabel(host) }) };
          status[i] = 'ok'; options.connection(host, 'success');
        } catch (error) { status[i] = 'error'; reasons[i] = error; if (!host.self && sameHost(host)) options.connection(host, 'failure', error); }
        queueRender();
      }));
      if (!status.some(state => state === 'ok')) throw reasons.find(Boolean) || new Error('no hosts answered');
      if (stale() || !rendered) return;
      if (indexing) usageTimer = setTimeout(() => { if (!stale()) void loadUsageView(); }, 1000);
    } catch (error) {
      if (stale()) return;
      retireRender(); body.classList.remove('usage-refreshing');
      body.innerHTML = `<div class="usage-state">Could not load usage: ${escapeHtml(message(error))}</div>`;
    }
  }

  function usageMetricValue(bucket: UsageBucket, metric: UsageMetric) {
    if (metric === 'cost') return finite(bucket.costs?.total) ? bucket.costs.total : 0;
    if (metric === 'tokens') return usageTokensTotal(bucket.tokens);
    return bucket.calls || 0;
  }
  const USAGE_METRIC_LABELS: Readonly<Record<UsageMetric, string>> = { cost: 'Estimated spend', tokens: 'Tokens', calls: 'Calls' };
  // Cost attribution buckets, in legend/stack order: prompt-side reads split
  // into uncached input and cached reads, then generation and cache writes.
  const USAGE_COST_BUCKETS = [
    ['input', 'Read', 'c1'],
    ['cacheRead', 'Cached read', 'c2'],
    ['output', 'Output', 'c3'],
    ['cacheWrite', 'Cache write', 'c4'],
  ] as const;
  // Compact per-bucket cost list for titles and detail rows; null when nothing
  // is priced so callers can fall back to the total-only display.
  function usageCostBreakdown(costs?: Costs | null) {
    if (!costs || !finite(costs.total)) return null;
    const parts = USAGE_COST_BUCKETS.map(([key, label]) => `${label} ${formatEstimatedCost(costs[key])}`);
    const unattributed = usageUnattributedCost(costs);
    if (unattributed > 1e-12) parts.push(`Unattributed ${formatEstimatedCost(unattributed)}`);
    return parts.join(' · ');
  }
  function usageModelValue(m: Pick<UsageModel, 'cost' | 'tokens' | 'calls'> | undefined, metric: UsageMetric) {
    if (metric === 'cost') return finite(m?.cost) ? m.cost : 0;
    if (metric === 'tokens') return usageTokensTotal(m?.tokens);
    return m?.calls || 0;
  }
  function usageTokensTotal(tokens?: Tokens) {
    return (['input', 'output', 'cacheRead', 'cacheWrite'] as const).reduce((s, k) => s + (tokens?.[k] || 0), 0);
  }
  // Compact per-row breakdown: "1.2M in / 800k out · 92% cached". The cached
  // share is cacheRead over the whole prompt side (input + cache read + cache
  // write) — the same denominator formatCacheStat uses in the stats modal.
  function usageTokensDetail(tokens?: Tokens) {
    const t = tokens || {};
    const parts = [`${formatTokens(t.input)} in / ${formatTokens(t.output)} out`];
    const prompt = (t.input || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
    if (prompt > 0 && (t.cacheRead || 0) > 0) parts.push(`${Math.round((t.cacheRead || 0) / prompt * 100)}% cached`);
    return parts.join(' · ');
  }


  function renderUsageView(d: UsageSummary) {
    if (!isUsageViewOpen()) return;
    retireRender(); bodyEvents = new AbortController();
    const generation = renderGeneration;
    const owns = () => generation === renderGeneration && isUsageViewOpen();
    const listener = { signal: bodyEvents.signal };
    const body = element('usageViewBody');
    body.classList.remove('usage-refreshing');
    const t = d.totals || {}, h = d.headlineCosts || {};
    const hu = d.headlineCostUnavailable || {};
    const budget = d.monthlyBudgetUsd;

    const hbb = d.headlineCostsByBucket || {};
    const kpis = [['Today', 'today'], ['Last 7 days', 'days7'], ['Last 30 days', 'days30'], ['This month', 'month']]
      .map(([label, key]) => {
        // Hover pivots the window's spend into its four cost buckets.
        const title = [usageCostBreakdown(hbb[key]),
          hu[key] ? `${hu[key]} unpriced calls are omitted from this estimate` : null].filter(Boolean).join('\n');
        return `<div class="usage-kpi"${title ? ` title="${escapeHtml(title)}"` : ''}><small>${label}</small><strong>${formatUsageCost(h[key], hu[key])}</strong></div>`;
      }).join('');

    let budgetHtml = '';
    if (budget) {
      if (finite(h.month)) {
        const pct = Math.min(100, h.month / budget * 100);
        const cls = pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '';
        const partial = hu.month ? ` · ${hu.month} unpriced calls omitted` : '';
        budgetHtml = `<div class="usage-budget${cls}"><div class="usage-budget-track"><div class="usage-budget-fill" style="width:${pct.toFixed(1)}%"></div></div><small>${formatUsageCost(h.month, hu.month)} of ~$${Number(budget).toFixed(2)} monthly budget${partial}${pct >= 100 ? ' — over budget' : ''}</small></div>`;
      }
      else {
        budgetHtml = `<div class="usage-budget"><small>Budget tracking unavailable${hu.month ? ` — ${hu.month} calls have unavailable pricing` : ''}.</small></div>`;
      }
    }

    const summary = `<div class="usage-total-line"><strong>${formatUsageCost(t.costs?.total, t.costUnavailable?.total)}</strong> · ${t.calls || 0} calls · ${formatTokens(usageTokensTotal(t.tokens))} tokens in ${USAGE_RANGE_LABELS[d.range || ''] || 'the selected range'}</div>` +
      `<div class="usage-token-line">${formatTokens(t.tokens?.input)} in · ${formatTokens(t.tokens?.output)} out · cache ${formatCacheStat(t.tokens?.cacheRead, t.tokens?.cacheWrite, t.tokens?.input)}</div>`;
    const filterNote = usageModelFilter.size
      ? `<div class="usage-filter-note">Filtered to ${[...usageModelFilter].map(r => `<b title="${escapeHtml(r)}">${escapeHtml(shortModelName(r))}</b>`).join(', ')}<button class="usage-range-btn" data-clear-models>✕ clear</button></div>`
      : '';

    // One metric drives the whole view — chart, tooltip, day detail, and the
    // breakdown bars all plot it: tokens when that toggle is chosen, else
    // spend, else calls when nothing in range carries a cost.
    const metric = usageSort === 'tokens' ? 'tokens' : finite(t.costs?.total) && t.costs.total > 0 ? 'cost' : 'calls';
    const ranges = USAGE_RANGES
      .map(([v, l]) => `<button class="usage-range-btn${usageRange === v ? ' active' : ''}" data-range="${v}">${l}</button>`).join('');
    const sortCtl = `<span class="usage-sort"><small>Show</small>${[['cost', 'Cost'], ['tokens', 'Tokens']]
      .map(([v, l]) => `<button class="usage-range-btn${usageSort === v ? ' active' : ''}" data-sort="${v}">${l}</button>`).join('')}</span>`;
    // Chart model: series slots follow the range's top *active* models (server
    // sort order; the model filter narrows the palette to the selected refs) so
    // the chart, its legend, and the model-share section all agree on colors.
    const activeModels = (d.groups?.models || []).filter(m => !usageModelFilter.size || usageModelFilter.has(m.key || ''));
    const daily = d.daily || [];
    const buckets = daily.length > 90 ? aggregateUsageWeekly(daily) : daily;
    const seriesRefs = activeModels.slice(0, 5).map(m => m.key || '');
    usageChart = { buckets, seriesRefs, metric, activeModelCount: activeModels.length, stack: metric === 'cost' ? usageStack : 'models' };
    const showChart = d.range !== '1' && buckets.length > 1 && (t.calls || 0) > 0;
    // The stack pivot only exists when the chart plots spend: bucket stacking
    // of a token/call chart would be a second, different metric.
    const stackCtl = showChart && metric === 'cost'
      ? `<span class="usage-sort"><small>Stack</small>${[['models', 'Models'], ['buckets', 'Cost buckets']]
        .map(([v, l]) => `<button class="usage-range-btn${usageChart?.stack === v ? ' active' : ''}" data-stack="${v}">${l}</button>`).join('')}</span>`
      : '';
    const chartSection = showChart
      ? `<section class="usage-section"><h4>${USAGE_METRIC_LABELS[metric]} per ${buckets === daily ? 'day' : 'week'}</h4><div class="usage-chart" id="usageChart"></div></section>`
      : '';
    if (d.range === '1' && daily.length) usageSelectedDay = daily[daily.length - 1].day;

    body.innerHTML = `
      <div class="usage-kpis">${kpis}</div>
      ${budgetHtml}
      ${d.indexing ? '<div class="usage-notice">History is indexing; totals will refresh…</div>' : ''}
      ${usageHostErrors.length ? `<div class="usage-notice">Not counted: ${escapeHtml(usageHostErrors.join(', '))} did not answer.</div>` : ''}
      ${usageHostPending.length ? `<div class="usage-notice">Still counting ${escapeHtml(usageHostPending.join(', '))}…</div>` : ''}
      <div class="usage-ranges">${ranges}${sortCtl}${stackCtl}</div>
      ${(t.calls || 0) === 0 ? '<div class="usage-state">No usage in this range.</div>' : summary}
      ${filterNote}
      ${usageBucketShareHtml(t)}
      ${chartSection}
      <div id="usageDayDetail"></div>
      ${usageModelShareHtml(d, metric, seriesRefs)}
      <div class="usage-columns">
        ${usageGroupListHtml('Workspaces', d.groups?.workspaces, 'workspace', metric)}
        ${usageGroupListHtml('Sessions', d.groups?.sessions, 'session', metric)}
      </div>
      ${d.unpricedModelCalls ? `<div class="usage-notice">* Known priced usage only; ${d.unpricedModelCalls} call${d.unpricedModelCalls === 1 ? '' : 's'} ${d.unpricedModelCalls === 1 ? 'has' : 'have'} unavailable pricing and ${d.unpricedModelCalls === 1 ? 'is' : 'are'} omitted.</div>` : ''}
      ${usageLimitsHtml(usageLimitsEntries)}
    `;
    body.querySelectorAll<HTMLElement>('[data-range]').forEach(button => button.addEventListener('click', () => {
      const range = button.dataset.range;
      if (owns() && (range === '1' || range === '7' || range === '30' || range === 'all')) setUsageRange(range);
    }, listener));
    body.querySelectorAll<HTMLElement>('[data-sort]').forEach(button => button.addEventListener('click', () => {
      const sort = button.dataset.sort; if (owns() && (sort === 'cost' || sort === 'tokens')) setUsageSort(sort);
    }, listener));
    body.querySelectorAll<HTMLElement>('[data-stack]').forEach(button => button.addEventListener('click', () => {
      const stack = button.dataset.stack; if (owns() && (stack === 'models' || stack === 'buckets')) setUsageStack(stack);
    }, listener));
    body.querySelector('[data-clear-models]')?.addEventListener('click', () => { if (owns()) clearUsageModelFilter(); }, listener);
    body.querySelectorAll<HTMLElement>('[data-model-ref]').forEach(row => {
      const ref = row.dataset.modelRef;
      const activate = () => { if (owns() && ref) toggleUsageModelFilter(ref); };
      row.addEventListener('click', activate, listener);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }, listener);
    });
    body.querySelectorAll<HTMLElement>('[data-session-id]').forEach(row => {
      const id = row.dataset.sessionId, host = row.dataset.sessionHost || null;
      const endpoint = options.host(host); const captured = endpoint ? Object.freeze({ ...endpoint }) : null;
      row.addEventListener('click', () => {
        if (!owns() || !id || !captured || !sameHost(captured)) return;
        closeUsageView(); void options.selectSession(id, { host });
      }, listener);
    });
    if (showChart) drawUsageChart();
    renderUsageDayDetail();
  }

  // Chart geometry is computed against the holder's live width; redraw on
  // resize instead of scaling a stale viewBox (bars keep their mark specs).
  function drawUsageChart() {
    if (!isUsageViewOpen()) return;
    chartEvents.abort(); chartEvents = new AbortController();
    const generation = renderGeneration;
    const owns = () => generation === renderGeneration && isUsageViewOpen();
    const holder = document.getElementById('usageChart');
    if (!holder || !usageChart) return;
    const { buckets, seriesRefs, metric } = usageChart;
    const stackBuckets = usageChart.stack === 'buckets';
    const width = Math.max(280, holder.clientWidth || 0);
    const max = Math.max(...buckets.map(b => usageMetricValue(b, metric)));
    const { step, top, ticks } = niceTicks(max);
    const dec = (String(step).split('.')[1] || '').length;
    const fmtTick = (v: number) => metric === 'cost' ? (v === 0 ? '$0' : '$' + v.toFixed(dec)) : formatTokens(v);

    const yLabelW = Math.max(...ticks.map(v => fmtTick(v).length)) * 6.5 + 12;
    const margin = { top: 8, right: 4, bottom: 22, left: Math.ceil(yLabelW) };
    const plotH = 170;
    const height = margin.top + plotH + margin.bottom;
    const plotW = Math.max(60, width - margin.left - margin.right);
    const n = buckets.length;
    const band = plotW / n;
    const barW = Math.max(2, Math.min(24, band - 2));
    const yFor = (v: number) => margin.top + plotH - (top > 0 ? v / top * plotH : 0);

    const parts = [];
    for (const v of ticks) {
      const y = yFor(v);
      if (v > 0) parts.push(`<line class="grid" x1="${margin.left}" x2="${margin.left + plotW}" y1="${y}" y2="${y}"/>`);
      parts.push(`<text class="tick" x="${margin.left - 6}" y="${y + 3}" text-anchor="end">${fmtTick(v)}</text>`);
    }
    parts.push(`<line class="axis" x1="${margin.left}" x2="${margin.left + plotW}" y1="${yFor(0)}" y2="${yFor(0)}"/>`);
    // Sparse x labels, anchored so the newest bucket is always labeled.
    const stride = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 80))));
    for (let i = 0; i < n; i++) {
      if ((n - 1 - i) % stride !== 0) continue;
      const x = margin.left + band * (i + 0.5);
      parts.push(`<text class="tick" x="${x}" y="${margin.top + plotH + 15}" text-anchor="middle">${formatUsageDay(buckets[i].day)}</text>`);
    }

    let anyOther = false;
    for (let i = 0; i < n; i++) {
      const b = buckets[i];
      const total = usageMetricValue(b, metric);
      const segs = [];
      if (stackBuckets) {
        USAGE_COST_BUCKETS.forEach(([key, , cls]) => {
          const v = finite(b.costs?.[key]) ? b.costs[key] : 0;
          if (v > 0) segs.push({ cls, v });
        });
        // Older recordings can carry a known total with no component split.
        // Keep that spend visible instead of drawing a mysteriously short bar.
        const unattributed = usageUnattributedCost(b.costs);
        if (unattributed > 1e-12) {
          segs.push({ cls: 'sother', v: unattributed });
          anyOther = true;
        }
      } else {
        const byRef = new Map((b.models || []).map(m => [m.ref, m]));
        let known = 0;
        seriesRefs.forEach((ref, s) => {
          const v = byRef.has(ref) ? usageModelValue(byRef.get(ref), metric) : 0;
          known += v;
          if (v > 0) segs.push({ cls: 's' + (s + 1), v });
        });
        const other = Math.max(0, total - known);
        if (other > 0) { segs.push({ cls: 'sother', v: other }); anyOther = true; }
      }

      const x = margin.left + band * i + (band - barW) / 2;
      const label = ((b.days || 1) > 1 ? `Week of ${formatUsageDay(b.day)}` : formatUsageDay(b.day, 'long')) + ': ' +
        (metric === 'cost' ? formatUsageCost(b.costs?.total, b.costUnavailable?.total)
          : metric === 'tokens' ? `${formatTokens(usageTokensTotal(b.tokens))} tokens`
          : `${b.calls} calls`);
      const seg = [];
      let cursor = yFor(0);
      for (let sI = 0; sI < segs.length; sI++) {
        const hPx = top > 0 ? segs[sI].v / top * plotH : 0;
        if (hPx <= 0) continue;
        const isTop = sI === segs.length - 1;
        // 2px surface gap between stacked fills (shaved off each lower segment).
        const drawH = Math.max(0.75, hPx - (isTop ? 0 : 2));
        const yTop = cursor - hPx;
        if (isTop) {
          const r = Math.min(3, barW / 2, drawH);
          seg.push(`<path class="seg ${segs[sI].cls}" d="M${x},${(yTop + drawH).toFixed(1)} V${(yTop + r).toFixed(1)} Q${x},${yTop.toFixed(1)} ${x + r},${yTop.toFixed(1)} H${(x + barW - r).toFixed(1)} Q${x + barW},${yTop.toFixed(1)} ${x + barW},${(yTop + r).toFixed(1)} V${(yTop + drawH).toFixed(1)} Z"/>`);
        } else {
          seg.push(`<rect class="seg ${segs[sI].cls}" x="${x}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${drawH.toFixed(1)}"/>`);
        }
        cursor = yTop;
      }
      parts.push(`<g class="usage-col${b.day === usageSelectedDay ? ' selected' : ''}" data-i="${i}" tabindex="0" role="button" aria-label="${escapeHtml(label)}"><rect class="hit" x="${margin.left + band * i}" y="${margin.top}" width="${band.toFixed(2)}" height="${plotH}"/>${seg.join('')}</g>`);
    }

    const legendItems = stackBuckets
      ? USAGE_COST_BUCKETS.map(([, label, cls]) => `<span class="usage-legend-item"><i class="swatch ${cls}"></i>${escapeHtml(label)}</span>`)
      : seriesRefs.map((ref, i) =>
        `<span class="usage-legend-item" title="${escapeHtml(ref)}"><i class="swatch s${i + 1}"></i>${escapeHtml(shortModelName(ref))}</span>`);
    if (stackBuckets && anyOther)
      legendItems.push('<span class="usage-legend-item"><i class="swatch sother"></i>Unattributed</span>');
    else if (!stackBuckets && (anyOther || (usageChart.activeModelCount || 0) > seriesRefs.length))
      legendItems.push('<span class="usage-legend-item"><i class="swatch sother"></i>other</span>');

    holder.innerHTML = `<svg width="${width}" height="${height}" role="img" aria-label="${USAGE_METRIC_LABELS[metric]} per ${(buckets[0]?.days || 1) > 1 ? 'week' : 'day'}">${parts.join('')}</svg>` +
      (legendItems.length > 1 ? `<div class="usage-legend">${legendItems.join('')}</div>` : '');

    const listener = { signal: chartEvents.signal };
    const column = (event: Event) => event.target instanceof Element ? event.target.closest<SVGElement>('.usage-col') : null;
    holder.addEventListener('pointermove', event => {
      if (!owns()) return; const g = column(event), bucket = g ? buckets[Number(g.dataset.i)] : null;
      if (!bucket) { hideUsageTooltip(); return; } showUsageTooltip(bucket, event);
    }, listener);
    holder.addEventListener('pointerleave', () => { if (owns()) hideUsageTooltip(); }, listener);
    const activate = (event: Event) => { const g = column(event), bucket = g ? buckets[Number(g.dataset.i)] : null; if (owns() && bucket) toggleUsageDay(bucket.day); };
    holder.addEventListener('click', activate, listener);
    holder.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event); } }, listener);

  }

  function toggleUsageDay(day: string | null) {
    if (!isUsageViewOpen()) return;
    usageSelectedDay = usageSelectedDay === day ? null : day;
    document.querySelectorAll<SVGElement>('#usageChart .usage-col').forEach(g => {
      g.classList.toggle('selected', usageChart?.buckets[Number(g.dataset.i)]?.day === usageSelectedDay);
    });
    renderUsageDayDetail();
  }

  function renderUsageDayDetail() {
    if (!isUsageViewOpen()) return;
    detailEvents.abort(); detailEvents = new AbortController();
    const generation = renderGeneration, day = usageSelectedDay;
    const holder = document.getElementById('usageDayDetail');
    if (!holder) return;
    const bucket = usageChart?.buckets?.find(b => b.day === usageSelectedDay)
      || (usageData?.range === '1' ? usageData.daily?.[usageData.daily.length - 1] : null);
    if (!bucket || !usageSelectedDay) { holder.innerHTML = ''; return; }
    const metric = usageChart?.metric || 'cost';
    const title = (bucket.days || 1) > 1
      ? `Week of ${formatUsageDay(bucket.day)} <small>· ${bucket.days} days</small>`
      : formatUsageDay(bucket.day, 'long');
    const tok = bucket.tokens || {};
    const stats = [
      ['Estimated spend', formatUsageCost(bucket.costs?.total, bucket.costUnavailable?.total)],
      ['Calls', String(bucket.calls || 0)],
      ['Tokens in / out', `${formatTokens(tok.input)} / ${formatTokens(tok.output)}`],
      ['Cache', formatCacheStat(tok.cacheRead, tok.cacheWrite, tok.input)],
      // Per-bucket spend keeps the day detail pivoted like the range totals.
      ...(finite(bucket.costs?.total)
        ? [
            ...USAGE_COST_BUCKETS.map(([key, label]) => [label, formatEstimatedCost(bucket.costs?.[key])]),
            ...(usageUnattributedCost(bucket.costs) > 1e-12
              ? [['Unattributed', formatEstimatedCost(usageUnattributedCost(bucket.costs))]] : []),
          ]
        : []),
    ].map(([k, v]) => `<div><small>${k}</small><strong>${v}</strong></div>`).join('');
    const slotFor = (ref: string | undefined) => {
      const i = (usageChart?.seriesRefs || []).indexOf(ref || '');
      return i >= 0 ? 's' + (i + 1) : 'sother';
    };
    const rows = (bucket.models || []).map(m => {
      const meta = [`${m.calls} calls`, `${formatTokens(usageTokensTotal(m.tokens))} tok`];
      if (usageTokensTotal(m.tokens) > 0) meta.push(usageTokensDetail(m.tokens));
      if (metric === 'cost') meta.push(formatUsageCost(m.cost, m.costUnavailable?.total));
      return `
      <div class="usage-row" title="${escapeHtml(m.ref)}">
        <i class="swatch ${slotFor(m.ref)}"></i>
        <span class="usage-row-name">${escapeHtml(shortModelName(m.model || m.ref))}<small>${escapeHtml(m.provider || '')}</small></span>
        <span class="usage-row-meta">${meta.join(' · ')}</span>
      </div>`;
    }).join('');
    holder.innerHTML = `<section class="usage-day-detail">
      <div class="usage-day-detail-header"><h4>${title}</h4><button class="btn-icon" title="Close details" data-close-day>✕</button></div>
      <div class="usage-day-stats">${stats}</div>
      ${rows || '<small class="usage-empty">No usage this day.</small>'}
    </section>`;
    holder.querySelector('[data-close-day]')?.addEventListener('click', () => { if (generation === renderGeneration && day === usageSelectedDay) toggleUsageDay(day); }, { signal: detailEvents.signal });
  }

  // Part-to-whole share of the range total across the four cost buckets: one
  // stacked bar plus per-bucket amounts, so every cost view answers "where did
  // the spend go" (read vs cached read vs output vs cache write) without a
  // hover. Follows the model filter through `totals`; unpriced calls stay out
  // of the bar and are named in the heading, like the total line's `*`.
  function usageBucketShareHtml(t: UsageBucket) {
    if (!finite(t.costs?.total) || t.costs.total <= 0) return '';
    const total = t.costs.total, unpriced = t.costUnavailable?.total || 0;
    const segs = [], legend = [];
    for (const [key, label, cls] of USAGE_COST_BUCKETS) {
      const v = finite(t.costs[key]) ? t.costs[key] : 0;
      const share = v / total;
      if (share > 0.004) segs.push(`<span class="${cls}" style="flex-grow:${(share * 1000).toFixed(1)}" title="${escapeHtml(label)}"></span>`);
      legend.push(`<span class="usage-legend-item"><i class="swatch ${cls}"></i>${escapeHtml(label)} <b>${formatEstimatedCost(v)}</b> <small>${Math.round(share * 100)}%</small></span>`);
    }
    const unattributed = usageUnattributedCost(t.costs);
    if (unattributed > 1e-12) {
      const share = unattributed / total;
      if (share > 0.004) segs.push(`<span class="sother" style="flex-grow:${(share * 1000).toFixed(1)}" title="Unattributed"></span>`);
      legend.push(`<span class="usage-legend-item"><i class="swatch sother"></i>Unattributed <b>${formatEstimatedCost(unattributed)}</b> <small>${Math.round(share * 100)}%</small></span>`);
    }
    return `<section class="usage-section"><h4>Spend by bucket${unpriced ? ` <small class="usage-hint">${unpriced} unpriced call${unpriced === 1 ? '' : 's'} omitted</small>` : ''}</h4>
      <div class="usage-share-bar">${segs.join('')}</div>
      <div class="usage-legend">${legend.join('')}</div></section>`;
  }

  // Part-to-whole share of the range by model: one horizontal stacked bar
  // (top five slots + other) over the per-model table that doubles as the
  // chart's WCAG-clean twin. The rows are also the model filter's toggles —
  // the list itself is never filtered (it's the facet control): with a filter
  // active, selected rows keep their chart slot colors and share of the
  // *selected* total while deselected rows dim with a hollow swatch.
  function usageModelShareHtml(d: UsageSummary, metric: UsageMetric, seriesRefs: readonly string[]) {
    const models = d.groups?.models || [];
    const filtered = usageModelFilter.size > 0;
    if (!models.length && !filtered) return '';
    const isOn = (ref: string | undefined) => !filtered || usageModelFilter.has(ref || '');
    const val = (m: UsageGroup) => usageModelValue({ cost: m.costs?.total, calls: m.calls, tokens: m.tokens }, metric);
    const slotFor = (ref: string | undefined) => {
      const i = seriesRefs.indexOf(ref || '');
      return i >= 0 ? 's' + (i + 1) : 'sother';
    };
    const active = models.filter(m => isOn(m.key));
    const total = active.reduce((s, m) => s + val(m), 0);
    const segs = [];
    active.slice(0, 5).forEach(m => {
      const share = total > 0 ? val(m) / total : 0;
      if (share > 0.004) segs.push(`<span class="${slotFor(m.key)}" style="flex-grow:${(share * 1000).toFixed(1)}" title="${escapeHtml(shortModelName(m.key))}"></span>`);
    });
    const restShare = total > 0 ? active.slice(5).reduce((s, m) => s + val(m), 0) / total : 0;
    if (restShare > 0.004) segs.push(`<span class="sother" style="flex-grow:${(restShare * 1000).toFixed(1)}" title="other models"></span>`);
    const rowHtml = (m: UsageGroup, on: boolean) => {
      const share = on && total > 0 ? val(m) / total : 0;
      const pct = share > 0 ? (share * 100 < 1 ? (share * 100).toFixed(1) : Math.round(share * 100)) + '%' : '—';
      const spend = `${formatUsageCost(m.costs?.total, m.unpricedCalls)}${m.unpricedCalls ? ` · ${m.unpricedCalls} unpriced` : ''}`;
      const detail = usageTokensTotal(m.tokens) > 0 ? ` · ${usageTokensDetail(m.tokens)}` : '';
      const breakdown = usageCostBreakdown(m.costs);
      return `<div class="usage-row model-toggle${filtered ? (on ? ' on' : ' off') : ''}" data-model-ref="${escapeHtml(m.key)}" role="button" tabindex="0" aria-pressed="${on}" title="${escapeHtml([m.key, breakdown].filter(Boolean).join('\n'))} — click to toggle model filter">
        <i class="swatch ${on ? slotFor(m.key) : 'soff'}"></i>
        <span class="usage-row-name">${escapeHtml(shortModelName(m.model || m.key))}<small>${escapeHtml(m.provider || '')}</small></span>
        <span class="usage-row-meta">${pct} · ${m.calls} calls · ${formatTokens(usageTokensTotal(m.tokens))} tok${detail} · ${escapeHtml(spend)}</span>
      </div>`;
    };
    const rows = models.map(m => rowHtml(m, isOn(m.key))).join('');
    // Selected refs with no usage in this range still get a row, or a range
    // switch could strand a filter with nothing visible to untoggle.
    const missing = [...usageModelFilter].filter(ref => !models.some(m => m.key === ref))
      .map(ref => rowHtml({ key: ref, calls: 0, tokens: {}, costs: { total: 0 } }, true)).join('');
    return `<section class="usage-section"><h4>Models <small class="usage-hint">click to filter</small></h4>
      ${segs.length ? `<div class="usage-share-bar">${segs.join('')}</div>` : ''}
      ${rows}${missing}</section>`;
  }

  // Workspace/session magnitude lists: single-hue micro-bars (share of the
  // largest entry) under each row — magnitude, not identity, so no palette.
  function usageGroupListHtml(title: string, rows: readonly UsageGroup[] | undefined, kind: 'workspace' | 'session', metric: UsageMetric) {
    const list = (rows || []).slice(0, 12);
    const val = (x: UsageGroup) => usageModelValue({ cost: x.costs?.total, calls: x.calls, tokens: x.tokens }, metric);
    const maxV = Math.max(1e-9, ...list.map(val));
    const items = list.map(x => {
      const name = kind === 'workspace' ? shortCwd(x.key) : (x.name || x.id);
      const sub = kind === 'session' && x.workspace ? shortCwd(x.workspace) : '';
      const spend = `${formatUsageCost(x.costs?.total, x.unpricedCalls)}${x.unpricedCalls ? ` · ${x.unpricedCalls} unpriced` : ''}`;
      const attrs = kind === 'session'
        ? ` data-session-id="${escapeHtml(x.id)}"${x.host ? ` data-session-host="${escapeHtml(x.host)}"` : ''} role="button" tabindex="0"`
        : '';
      // Merged rows keep their host: the same path (or session id) on two
      // machines is two different rows.
      const hostTag = isMultiHost() && x.hostLabel ? `<small class="usage-row-host">${escapeHtml(x.hostLabel)}</small>` : '';
      const detail = usageTokensTotal(x.tokens) > 0 ? ` · ${usageTokensDetail(x.tokens)}` : '';
      const breakdown = usageCostBreakdown(x.costs);
      return `<div class="usage-row usage-bar-row${kind === 'session' ? ' clickable' : ''}"${attrs} title="${escapeHtml([x.key || x.name || x.id, breakdown].filter(Boolean).join('\n'))}">
        <span class="usage-row-name">${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}${hostTag}</span>
        <span class="usage-row-meta">${x.calls} calls · ${formatTokens(usageTokensTotal(x.tokens))} tok${detail} · ${escapeHtml(spend)}</span>
        <span class="usage-row-bar" style="width:${(val(x) / maxV * 100).toFixed(1)}%"></span>
      </div>`;
    }).join('');
    return `<section class="usage-section"><h4>${title}</h4>${items || '<small class="usage-empty">No usage in this range.</small>'}</section>`;
  }

  function ensureUsageTooltip() {
    let el = document.getElementById('usageTooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'usageTooltip';
      el.className = 'usage-tooltip';
      document.body.appendChild(el);
    }
    return el;
  }

  // One tooltip, every series at that X; values lead, labels follow. Built
  // with textContent — model names are untrusted strings.
  function showUsageTooltip(bucket: UsageDay, e: PointerEvent) {
    if (!bucket) return;
    const el = ensureUsageTooltip();
    el.replaceChildren();
    const metric = usageChart?.metric || 'cost';
    const head = document.createElement('div');
    head.className = 'tt-day';
    head.textContent = (bucket.days || 1) > 1 ? `Week of ${formatUsageDay(bucket.day)} · ${bucket.days} days` : formatUsageDay(bucket.day, 'long');
    const total = document.createElement('div');
    total.className = 'tt-total';
    total.textContent = metric === 'cost' ? `${formatUsageCost(bucket.costs?.total, bucket.costUnavailable?.total)} · ${bucket.calls || 0} calls`
      : metric === 'tokens' ? `${formatTokens(usageTokensTotal(bucket.tokens))} tokens · ${bucket.calls || 0} calls`
      : `${bucket.calls} calls`;
    el.append(head, total);
    const rows: [string, string, number][] = [];
    if (usageChart?.stack === 'buckets' && metric === 'cost') {
      USAGE_COST_BUCKETS.forEach(([key, label, cls]) => {
        rows.push([cls, label, finite(bucket.costs?.[key]) ? bucket.costs[key] : 0]);
      });
      const unattributed = usageUnattributedCost(bucket.costs);
      if (unattributed > 1e-12) rows.push(['sother', 'Unattributed', unattributed]);
    } else {
      const seriesRefs = usageChart?.seriesRefs || [];
      const byRef = new Map((bucket.models || []).map(m => [m.ref, m]));
      seriesRefs.forEach((ref, i) => {
        const m = byRef.get(ref);
        if (m) rows.push(['s' + (i + 1), shortModelName(ref), usageModelValue(m, metric)]);
      });
      let otherV = 0, extra = 0;
      for (const m of bucket.models || []) {
        if (!seriesRefs.includes(m.ref)) { otherV += usageModelValue(m, metric); extra++; }
      }
      if (extra) rows.push(['sother', `other (${extra} model${extra > 1 ? 's' : ''})`, otherV]);
    }
    for (const [cls, name, v] of rows) {
      const row = document.createElement('div');
      row.className = 'tt-row';
      const key = document.createElement('i');
      key.className = 'tt-key ' + cls;
      const value = document.createElement('strong');
      value.textContent = metric === 'cost' ? formatEstimatedCost(v) : metric === 'tokens' ? formatTokens(v) : String(v);
      const label = document.createElement('span');
      label.textContent = name;
      row.append(key, value, label);
      el.appendChild(row);
    }
    el.style.display = 'block';
    const pad = 12, r = el.getBoundingClientRect();
    let x = e.clientX + pad;
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, e.clientX - r.width - pad);
    let y = e.clientY - r.height - pad;
    if (y < 8) y = e.clientY + pad;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  function hideUsageTooltip() {
    const el = document.getElementById('usageTooltip');
    if (el) el.style.display = 'none';
  }

  let usageResizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    if (!isUsageViewOpen()) return;
    clearTimeout(usageResizeTimer);
    usageResizeTimer = setTimeout(drawUsageChart, 150);
  }, { signal: events.signal });



  return { open: openUsageView, close: closeUsageView, isOpen: isUsageViewOpen, load: loadUsageView,
    setRange: setUsageRange, setSort: setUsageSort, setStack: setUsageStack,
    get data() { return usageData as Readonly<UsageSummary> | null; }, get chart() { return usageChart; },
    dispose() { closeUsageView(); events.abort(); document.getElementById('usageTooltip')?.remove(); disposed = true; },
  };
}
