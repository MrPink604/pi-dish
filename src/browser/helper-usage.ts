import type { CostKey, TokenKey, Costs, Tokens, UsageBucket, MergedUsage, MergedUsageModel, UsageDay, UsageGroup, UsageSummary, HostUsageSummary, UsageLimitEntry, HostUsageLimit } from './shared-helper-types';
import { finite } from './helper-values';
import { escapeHtml } from './helper-format';

// --- Usage summary merging (multi-host) ----------------------------------
// The usage view fans /api/usage-summary out to every reachable host and
// merges the payloads here. Costs retain the known subtotal while
// costUnavailable counts the calls omitted from it; the renderer marks those
// partial estimates instead of presenting them as complete or free.
export const USAGE_MERGE_COST_KEYS: readonly CostKey[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];


export const USAGE_MERGE_TOKEN_KEYS: readonly TokenKey[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];

/**
 * Coalesce a burst of healthy fan-out responses into one complete render.
 * If a peer is genuinely slow, the delayed call still publishes the useful
 * partial result; the final settlement always renders synchronously.
 */
export function createFanoutRenderQueue(states: readonly string[], render: () => void, delayMs = 100) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    if (states.every(state => state !== 'pending')) render();
    else timer = setTimeout(render, delayMs);
  };
}


export function emptyTokens(): Record<TokenKey, number> { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }; }


export function emptyCosts(): Record<CostKey, number> { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }; }


export function emptyMergedUsage(): MergedUsage {
  return {
    tokens: emptyTokens(),
    costs: emptyCosts(),
    costUnavailable: emptyCosts(),
    calls: 0, measured: 0, durationMs: 0, slowestMs: 0,
  };
}


export function addMergedUsage(to: MergedUsage, from?: UsageBucket | null) {
  if (!from) return to;
  for (const k of USAGE_MERGE_TOKEN_KEYS) to.tokens[k] += from.tokens?.[k] || 0;
  for (const k of USAGE_MERGE_COST_KEYS) {
    to.costUnavailable[k] += from.costUnavailable?.[k] || 0;
    const value = from.costs?.[k];
    if (finite(value)) {
      to.costs[k] = (finite(to.costs[k]) ? to.costs[k] : 0) + value;
    }
  }
  for (const k of ['calls', 'measured', 'durationMs'] as const) to[k] += from[k] || 0;
  to.slowestMs = Math.max(to.slowestMs, from.slowestMs || 0);
  return to;
}


export function pricedUsageFields<T extends UsageBucket>(bucket: T) {
  bucket.unpricedCalls = bucket.costUnavailable?.total || 0;
  bucket.priced = !bucket.unpricedCalls;
  return bucket;
}


export function usageDisplayTokens(tokens?: Tokens | null) {
  return (tokens?.input || 0) + (tokens?.output || 0) + (tokens?.cacheRead || 0) + (tokens?.cacheWrite || 0);
}

/** Known spend that cannot be assigned to a component. Older session entries
 * may record only cost.total; mixed-version fleet payloads can do the same.
 * Returning the remainder keeps bucket charts and shares equal to the total. */
export function usageUnattributedCost(costs?: Costs | null) {
  if (!finite(costs?.total)) return 0;
  const attributed = (['input', 'output', 'cacheRead', 'cacheWrite'] as const)
    .reduce((sum, key) => sum + (finite(costs[key]) ? costs[key] : 0), 0);
  return Math.max(0, costs.total - attributed);
}

/** The server's group comparator, so a merged list ranks like a local one. */
export function compareUsageBuckets(a: MergedUsage, b: MergedUsage, sort: string) {
  if (sort === 'tokens') return usageDisplayTokens(b.tokens) - usageDisplayTokens(a.tokens) || b.calls - a.calls;
  const aKnown = finite(a.costs?.total), bKnown = finite(b.costs?.total);
  if (aKnown !== bKnown) return Number(bKnown) - Number(aKnown);
  return (bKnown ? b.costs.total - a.costs.total : 0) || b.calls - a.calls;
}

/**
 * Merge per-host /api/usage-summary payloads into one view.
 *
 * `list` items are either a bare payload or `{ hostId, hostLabel, summary }`
 * - the host is needed because a workspace path and a session id are only
 * unique *within* a host, while a model ref means the same thing everywhere
 * and so merges across hosts.
 *
 * A single payload passes through untouched, which is what keeps the
 * single-host view exactly what the server sent.
 *
 * Approximation, deliberately accepted: each host truncates its group lists
 * to its own top 20 before answering, so a workspace/model/session sitting
 * just below the cut on several hosts can be under-counted (or missing) in
 * the merged tail. Totals, headline KPIs, and the daily series are exact -
 * they are whole-corpus aggregates on each host. Don't "fix" this with a
 * hub-side merged endpoint; see TASKS/multi-host.md.
 */
export function mergeUsageSummaries(list?: readonly (UsageSummary | HostUsageSummary)[] | null) {
  const items: readonly (UsageSummary | HostUsageSummary)[] = Array.isArray(list) ? list : [];
  const entries: HostUsageSummary[] = items
    .map(item => (item && typeof item === 'object' && 'summary' in item && item.summary ? item : { summary: item }))
    .filter((item): item is HostUsageSummary => !!item.summary && typeof item.summary === 'object');
  if (!entries.length) return null;
  if (entries.length === 1) return entries[0].summary;

  const first = entries[0].summary;
  const sort = first.sort === 'tokens' ? 'tokens' : 'cost';
  const totals = emptyMergedUsage();
  let unpricedModelCalls = 0;
  const headlineKeys = new Set<string>();
  const headlineCosts: Record<string, number> = Object.create(null), headlineCostUnavailable: Record<string, number> = Object.create(null);
  const headlineCostsByBucket: Record<string, Record<CostKey, number>> = Object.create(null);
  const days = new Map<string, { bucket: MergedUsage; models: Map<string, MergedUsageModel> }>();          // day -> { bucket, models: Map(ref -> row) }
  const models = new Map<string, UsageGroup & MergedUsage>();        // ref -> bucket
  const workspaces = new Map<string, UsageGroup & MergedUsage>();    // host + cwd -> bucket
  const sessionRows = new Map<string, UsageGroup & MergedUsage>();   // host + id -> row
  let indexing = false, discoveryTruncated = false, discoverySkipped = 0;
  let monthlyBudgetUsd: number | null = null;

  for (const { summary, hostId = null, hostLabel = null } of entries) {
    addMergedUsage(totals, summary.totals);
    unpricedModelCalls += summary.unpricedModelCalls || 0;
    for (const [key, value] of Object.entries(summary.headlineCosts || {})) {
      headlineKeys.add(key);
      headlineCostUnavailable[key] = (headlineCostUnavailable[key] || 0) +
        (summary.headlineCostUnavailable?.[key] || 0);
      if (finite(value)) {
        headlineCosts[key] = (finite(headlineCosts[key]) ? headlineCosts[key] : 0) + value;
      }
    }
    for (const [key, costs] of Object.entries(summary.headlineCostsByBucket || {})) {
      headlineKeys.add(key);
      const row = headlineCostsByBucket[key] ||
        (headlineCostsByBucket[key] = emptyCosts());
      for (const k of USAGE_MERGE_COST_KEYS) if (finite(costs?.[k])) row[k] += costs[k];
    }
    for (const day of summary.daily || []) {
      if (!day || !day.day) continue;
      let slot = days.get(day.day);
      if (!slot) { slot = { bucket: emptyMergedUsage(), models: new Map() }; days.set(day.day, slot); }
      addMergedUsage(slot.bucket, day);
      for (const model of day.models || []) {
        if (!model || !model.ref) continue;
        let row = slot.models.get(model.ref);
        if (!row) {
          row = {
            ref: model.ref, provider: model.provider, model: model.model, calls: 0, cost: 0,
            costUnavailable: emptyCosts(),
            tokens: emptyTokens(),
          };
          slot.models.set(model.ref, row);
        }
        row.calls += model.calls || 0;
        for (const k of USAGE_MERGE_TOKEN_KEYS) row.tokens[k] += model.tokens?.[k] || 0;
        for (const k of USAGE_MERGE_COST_KEYS) row.costUnavailable[k] = (row.costUnavailable[k] || 0) + (model.costUnavailable?.[k] || 0);
        if (finite(model.cost)) {
          row.cost = (finite(row.cost) ? row.cost : 0) + model.cost;
        }
      }
    }
    for (const bucket of summary.groups?.models || []) {
      if (!bucket || !bucket.key) continue;
      let row = models.get(bucket.key);
      if (!row) {
        row = { key: bucket.key, provider: bucket.provider, model: bucket.model, ...emptyMergedUsage() };
        models.set(bucket.key, row);
      }
      addMergedUsage(row, bucket);
    }
    for (const bucket of summary.groups?.workspaces || []) {
      if (!bucket || bucket.key == null) continue;
      // The same path on two machines is two workspaces - never fold them.
      const key = hostId + ' ' + bucket.key;
      let row = workspaces.get(key);
      if (!row) {
        row = { key: bucket.key, host: hostId, hostLabel, ...emptyMergedUsage() };
        workspaces.set(key, row);
      }
      addMergedUsage(row, bucket);
    }
    for (const bucket of summary.groups?.sessions || []) {
      if (!bucket || bucket.id == null) continue;
      const key = hostId + ' ' + bucket.id;
      let row = sessionRows.get(key);
      if (!row) {
        row = { ...bucket, host: hostId, hostLabel, ...emptyMergedUsage() };
        sessionRows.set(key, row);
      }
      addMergedUsage(row, bucket);
    }
    if (summary.indexing) indexing = true;
    if (summary.discoveryTruncated) discoveryTruncated = true;
    discoverySkipped += Number(summary.discoverySkipped) || 0;
    if (monthlyBudgetUsd == null && summary.monthlyBudgetUsd != null) monthlyBudgetUsd = summary.monthlyBudgetUsd;
  }

  pricedUsageFields(totals);
  totals.unpricedCalls = unpricedModelCalls;
  const daily = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([day, slot]) => ({
      day,
      ...slot.bucket,
      models: [...slot.models.values()].sort((a, b) =>
        Number(finite(b.cost)) - Number(finite(a.cost))
        || (finite(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls),
    }));
  const rank = <T extends MergedUsage>(rows: T[]) => rows.map(pricedUsageFields)
    .sort((a, b) => compareUsageBuckets(a, b, sort)).slice(0, 20);

  return {
    range: first.range,
    sort: first.sort,
    models: first.models || null,
    totals,
    groups: {
      models: rank([...models.values()]),
      workspaces: rank([...workspaces.values()]),
      sessions: rank([...sessionRows.values()]),
    },
    headlineCosts: Object.fromEntries([...headlineKeys].map(k => [k, headlineCosts[k] ?? null])),
    headlineCostsByBucket: Object.fromEntries([...headlineKeys].map(k => [k, headlineCostsByBucket[k] || null])),
    headlineCostUnavailable: Object.fromEntries([...headlineKeys].map(k => [k, headlineCostUnavailable[k] || 0])),
    daily,
    unpricedModelCalls,
    indexing,
    discoveryTruncated,
    discoverySkipped,
    monthlyBudgetUsd,
  };
}

// --- Usage view (chart math and labels) ---
/**
 * Readable model name from a model id (provider stripped): drops
 * bedrock-style vendor prefixes ("us.anthropic."), trailing wire-format
 * versions ("-v1:0"), and trailing release-date stamps ("-20250929",
 * "-2024-11-20", "@20250219"). Display form only — keep the full ref in a
 * title attribute so nothing is hidden.
 */
export function shortModelName(model: unknown) {
  if (!model) return 'unknown';
  let name = String(model);
  const slash = name.lastIndexOf('/');
  if (slash >= 0) name = name.slice(slash + 1);
  name = name.replace(/^(?:[a-z]{2,3}\.)?(?:anthropic|amazon|meta|mistral|cohere|ai21|google|deepseek|qwen)\./, '');
  name = name.replace(/-v\d+:\d+$/, ''); // bedrock wire format only — "-v4" is a real model name
  name = name.replace(/[-@](?:20\d{6}|20\d{2}-\d{2}-\d{2})$/, '');
  return name || String(model);
}

/**
 * Clean axis ticks for a positive maximum: ~`target` steps on a
 * 1/2/2.5/5×10^k grid, ascending from 0; `top` is the last tick (≥ max).
 */
export function niceTicks(max: number, target = 4) {
  if (!finite(max) || max <= 0) return { step: 1, top: 1, ticks: [0, 1] };
  const rawStep = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let step = 10 * mag;
  for (const m of [1, 2, 2.5, 5]) { if (rawStep <= m * mag) { step = m * mag; break; } }
  const ticks = [];
  const top = Math.ceil(max / step - 1e-9) * step;
  for (let i = 0; i * step <= top + step / 2; i++) ticks.push(Math.round(i * step * 1e9) / 1e9);
  return { step, top: ticks[ticks.length - 1], ticks };
}


export const USAGE_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


export const USAGE_WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-07-12" → "Jul 12" ('short') or "Sat, Jul 12, 2026" ('long'). Locale-free. */
export function formatUsageDay(day: unknown, style = 'short') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return String(day || '');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const label = `${USAGE_MONTH_NAMES[mo - 1] || m[2]} ${d}`;
  if (style !== 'long') return label;
  return `${USAGE_WEEKDAY_NAMES[new Date(y, mo - 1, d, 12).getDay()]}, ${label}, ${y}`;
}

/**
 * Fold a long daily usage series into week buckets (chart bars and their
 * 2px gaps stop reading past ~90 marks). Chunks of 7 anchored at the END so
 * the newest bucket always ends today; the oldest may be partial. Model rows
 * merge by ref. Entries keep the daily shape plus `days` (bucket span);
 * `day` is the bucket's first day.
 */
export function aggregateUsageWeekly(daily: readonly UsageDay[]) {
  const out = [];
  const tokenKeys = USAGE_MERGE_TOKEN_KEYS;
  const costKeys = USAGE_MERGE_COST_KEYS;
  for (let end = daily.length; end > 0; end -= 7) {
    const chunk = daily.slice(Math.max(0, end - 7), end);
    const models = new Map<string, MergedUsageModel>();
    const agg: UsageDay & { calls: number; tokens: Record<TokenKey, number>; costs: Record<CostKey, number>; costUnavailable: Record<CostKey, number>; models: MergedUsageModel[] } = {
      day: chunk[0].day, days: chunk.length, calls: 0,
      tokens: emptyTokens(),
      costs: emptyCosts(),
      costUnavailable: emptyCosts(),
      models: [],
    };
    for (const d of chunk) {
      agg.calls += d.calls || 0;
      for (const k of tokenKeys) agg.tokens[k] += d.tokens?.[k] || 0;
      for (const k of costKeys) {
        agg.costUnavailable[k] += d.costUnavailable?.[k] || 0;
        const value = d.costs?.[k];
        if (finite(value)) {
          agg.costs[k] = (finite(agg.costs[k]) ? agg.costs[k] : 0) + value;
        }
      }
      for (const dm of d.models || []) {
        const t = models.get(dm.ref) || { ref: dm.ref, provider: dm.provider, model: dm.model, calls: 0, cost: 0, costUnavailable: { total: 0 }, tokens: emptyTokens() };
        t.calls += dm.calls || 0;
        t.costUnavailable.total = (t.costUnavailable.total || 0) + (dm.costUnavailable?.total || 0);
        if (finite(dm.cost)) {
          t.cost = (finite(t.cost) ? t.cost : 0) + dm.cost;
        }
        for (const k of tokenKeys) t.tokens[k] += dm.tokens?.[k] || 0;
        models.set(dm.ref, t);
      }
    }
    agg.models = [...models.values()].sort((a, b) => Number(finite(b.cost)) - Number(finite(a.cost)) || (finite(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls);
    out.unshift(agg);
  }
  return out;
}

/**
 * Compact future-reset text for a usage-limit window: "in 5d 3h", "in 42m",
 * "now" once the reset time has passed. `now` is injectable for tests.
 */
export function formatLimitReset(resetsAt: unknown, now = Date.now()) {
  const ms = Number(resetsAt) - now;
  if (!finite(ms) || ms <= 0) return 'now';
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return m ? `in ${h}h ${m}m` : `in ${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `in ${d}d ${rh}h` : `in ${d}d`;
}

/**
 * Merge /api/usage-limits payloads across hosts into one provider view.
 * Hosts in a fleet often hold the *same* provider accounts, so per-host
 * rendering duplicates every window. Entries: [{ hostLabel, payload }].
 * Reports are grouped by provider, limits by label+window; rows that agree
 * collapse to one, rows that genuinely differ stay separate and carry their
 * host label(s). "Agree" is tolerant on purpose — fetch times and rolling
 * windows shift values slightly between hosts, and exact-equality would
 * split every row: usedFraction within `fractionTolerance`, resetsAt within
 * `resetToleranceMs` (null only equals null), and the same planType (a plan
 * mismatch almost certainly means different accounts). Errors pass through
 * per host. Harness labels ride along so a future second reporting harness
 * still attributes correctly.
 */
export function mergeUsageLimits(entries: readonly UsageLimitEntry[] | null | undefined, { fractionTolerance = 0.02, resetToleranceMs = 15 * 60000 } = {}) {
  const providers = new Map<string, { provider: string; planTypes: Set<string>; groups: Map<string, { rows: HostUsageLimit[] }> }>();
  const errors: { hostLabel: string; harnessLabel: string | undefined; error: string }[] = [];
  for (const entry of entries || []) {
    for (const h of entry?.payload?.harnesses || []) {
      if (h.error) { errors.push({ hostLabel: entry.hostLabel, harnessLabel: h.label || h.harness, error: h.error }); continue; }
      for (const report of h.reports || []) {
        let prov = providers.get(report.provider);
        if (!prov) providers.set(report.provider, prov = { provider: report.provider, planTypes: new Set(), groups: new Map() });
        if (report.planType) prov.planTypes.add(report.planType);
        for (const limit of report.limits || []) {
          const key = `${limit.label}${limit.windowLabel || ''}`;
          let group = prov.groups.get(key);
          if (!group) prov.groups.set(key, group = { rows: [] });
          group.rows.push({
            ...limit, planType: report.planType || null,
            fetchedAt: report.fetchedAt || 0, hostLabel: entry.hostLabel,
          });
        }
      }
    }
  }
  const equivalent = (a: HostUsageLimit, b: HostUsageLimit) =>
    a.planType === b.planType
    && Math.abs(a.usedFraction - b.usedFraction) <= fractionTolerance
    && (a.resetsAt == null && b.resetsAt == null
      || (a.resetsAt != null && b.resetsAt != null && Math.abs(a.resetsAt - b.resetsAt) <= resetToleranceMs));
  const reports = [...providers.values()].map(prov => {
    const hostCount = new Set([...prov.groups.values()].flatMap(g => g.rows.map(r => r.hostLabel))).size;
    const limits = [...prov.groups.values()].flatMap(group => {
      // Freshest first; each row joins the first cluster whose representative
      // it agrees with, else founds its own.
      const clusters: { rep: HostUsageLimit; hosts: string[] }[] = [];
      for (const row of [...group.rows].sort((a, b) => b.fetchedAt - a.fetchedAt)) {
        const cluster = clusters.find(c => equivalent(c.rep, row));
        if (cluster) cluster.hosts.push(row.hostLabel);
        else clusters.push({ rep: row, hosts: [row.hostLabel] });
      }
      return clusters.map(c => ({
        ...c.rep,
        hosts: c.hosts.length >= hostCount ? null : [...new Set(c.hosts)].sort(),
      }));
    });
    return {
      provider: prov.provider,
      planType: prov.planTypes.size === 1 ? [...prov.planTypes][0] : null,
      limits,
    };
  }).filter(p => p.limits.length);
  return { reports, errors };
}

/**
 * "Subscription limits" section of the usage view: provider quota windows
 * (5h/7d utilization + reset) as reported by the harness CLIs, merged across
 * hosts by mergeUsageLimits — a row shows its host label only when hosts
 * disagree about it. Returns '' when there is nothing to show, so the
 * section vanishes on hosts/fleets with no supporting harness.
 */
export function usageLimitsHtml(entries: readonly UsageLimitEntry[] | null | undefined, { now = Date.now() } = {}) {
  const { reports, errors } = mergeUsageLimits(entries);
  if (!reports.length && !errors.length) return '';
  const body = reports.map(report => {
    const rows = report.limits.map(limit => {
      const pct = Math.min(100, Math.max(0, limit.usedFraction * 100));
      const cls = pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '';
      const reset = limit.resetsAt ? ` · resets ${formatLimitReset(limit.resetsAt, now)}` : '';
      const host = limit.hosts ? ` · ${escapeHtml(limit.hosts.join(', '))}` : '';
      return `<div class="usage-limit-row"><div class="usage-limit-head"><span>${escapeHtml(limit.label)}</span><small>${Math.round(limit.usedFraction * 100)}% used${escapeHtml(reset)}${host}</small></div><div class="usage-limit-track"><div class="usage-limit-fill${cls}" style="width:${pct.toFixed(1)}%"></div></div></div>`;
    }).join('');
    const plan = report.planType ? ` <small>${escapeHtml(report.planType)}</small>` : '';
    return `<div class="usage-limits-provider"><div class="usage-limits-provider-name">${escapeHtml(report.provider)}${plan}</div>${rows}</div>`;
  }).join('');
  const errHtml = errors.map(e =>
    `<div class="usage-limits-error">${escapeHtml(e.harnessLabel)} on ${escapeHtml(e.hostLabel)}: ${escapeHtml(e.error)}</div>`).join('');
  return `<section class="usage-section usage-limits"><h4>Subscription limits <span class="usage-hint">reported by the harness CLI — quota, not spend</span></h4>${body}${errHtml}</section>`;
}
