import { escapeHtml } from '../core/helper-format';
import { finite, record } from '../core/helper-values';

// Cache lifetimes section of the usage view: per model, the cache retention
// sessions are served, where it comes from, and the probes the learner has
// seen (/api/cache-lifetimes). A probe is one return to a model after an idle
// gap: warm when the provider still had the prompt cached, cold when it
// rewrote it. The page's job is explaining *why* a model has no learned TTL
// yet, so each row leads with its first failing activation gate.

export type CacheLifetimeSource = 'override' | 'documented' | 'learned' | 'builtin' | 'none';
export type CacheLifetimeGateId = 'support' | 'warm' | 'cold' | 'slope' | 'range' | 'bracket';
interface Policy { readonly retentionMs: number; readonly retention: string; readonly basis: string }
export interface CacheLifetimeRow {
  readonly key: string;
  readonly api: string;
  readonly provider: string;
  readonly model: string;
  readonly tier: '1h' | null;
  readonly source: CacheLifetimeSource;
  readonly effective: Policy | null;
  readonly builtin: Policy | null;
  readonly override: Policy | null;
  readonly fit: { readonly active: boolean; readonly ttlMs: number; readonly alpha: number; readonly beta: number;
    readonly priorTtlMs: number; readonly observations: number; readonly warmHitRate: number | null } | null;
  readonly gates: readonly { readonly id: CacheLifetimeGateId; readonly pass: boolean; readonly value: number | null; readonly need: number }[];
  readonly probes: { readonly total: number; readonly hits: number; readonly misses: number;
    readonly maxHitGapMs: number | null; readonly minMissGapMs: number | null; readonly lastAt: number };
  readonly points: readonly (readonly [number, 0 | 1])[];
}
export interface CacheLifetimeHost { readonly hostKey: string; readonly hostLabel: string; readonly rows: readonly CacheLifetimeRow[] }
export interface CacheLifetimeStatus { readonly label: string; readonly detail: string; readonly tone: 'learned' | 'learning' | 'fixed' }

const SOURCES: readonly CacheLifetimeSource[] = ['override', 'documented', 'learned', 'builtin', 'none'];
const GATES: readonly CacheLifetimeGateId[] = ['support', 'warm', 'cold', 'slope', 'range', 'bracket'];
const MAX_POINTS = 400;
// Plot domain: 10 seconds to 24 hours of idle, log scale. Gaps outside clamp
// to the edges; no provider window of interest lives beyond either end.
const DOMAIN_LO_MS = 10_000, DOMAIN_HI_MS = 24 * 60 * 60_000;
const AXIS_TICKS: readonly (readonly [string, number])[] = [['10s', 10_000], ['1m', 60_000], ['5m', 300_000], ['30m', 1_800_000], ['2h', 7_200_000], ['24h', 86_400_000]];

const text = (value: unknown) => typeof value === 'string' ? value : '';
const num = (value: unknown) => finite(value) ? value : null;
function policy(value: unknown): Policy | null {
  if (!record(value) || !finite(value.retentionMs) || typeof value.retention !== 'string') return null;
  return { retentionMs: value.retentionMs, retention: value.retention, basis: text(value.basis) };
}

export function decodeCacheLifetimes(value: unknown): CacheLifetimeRow[] {
  if (!record(value) || !Array.isArray(value.identities)) return [];
  return value.identities.flatMap((raw: unknown): CacheLifetimeRow[] => {
    if (!record(raw) || typeof raw.model !== 'string' || !record(raw.probes)) return [];
    const source = SOURCES.includes(raw.source as CacheLifetimeSource) ? raw.source as CacheLifetimeSource : 'none';
    const tier = raw.tier === '1h' ? '1h' : null;
    const fitRaw = record(raw.fit) ? raw.fit : null, stats = fitRaw && record(fitRaw.stats) ? fitRaw.stats : {};
    const fit = fitRaw && finite(fitRaw.ttlMs) && finite(fitRaw.alpha) && finite(fitRaw.beta) ? {
      active: fitRaw.active === true, ttlMs: fitRaw.ttlMs, alpha: fitRaw.alpha, beta: fitRaw.beta,
      priorTtlMs: num(fitRaw.priorTtlMs) ?? fitRaw.ttlMs, observations: num(stats.observations) ?? 0, warmHitRate: num(stats.warmHitRate),
    } : null;
    const gates = Array.isArray(raw.gates) ? raw.gates.flatMap((gate: unknown) => {
      if (!record(gate) || !GATES.includes(gate.id as CacheLifetimeGateId)) return [];
      return [{ id: gate.id as CacheLifetimeGateId, pass: gate.pass === true, value: num(gate.value), need: num(gate.need) ?? 0 }];
    }) : [];
    const points = Array.isArray(raw.points) ? raw.points.slice(-MAX_POINTS).flatMap((point: unknown) => {
      if (!Array.isArray(point) || !finite(point[0]) || point[0] <= 0) return [];
      return [[point[0], point[1] === 1 ? 1 : 0] as const];
    }) : [];
    const p = raw.probes;
    const api = text(raw.api), provider = text(raw.provider);
    return [{
      key: [api, provider, raw.model, tier ?? ''].join('\u0000'), api, provider, model: raw.model, tier, source,
      effective: policy(raw.effective), builtin: policy(raw.builtin), override: policy(raw.override), fit, gates,
      probes: { total: num(p.total) ?? 0, hits: num(p.hits) ?? 0, misses: num(p.misses) ?? 0,
        maxHitGapMs: num(p.maxHitGapMs), minMissGapMs: num(p.minMissGapMs), lastAt: num(p.lastAt) ?? 0 },
      points,
    }];
  });
}

export function formatGap(ms: number): string {
  const s = ms / 1000;
  if (s < 90) return `${Math.max(1, Math.round(s))}s`;
  const m = s / 60;
  if (m < 90) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round(h / 2.4) / 10}d`;
}

function ttlLabel(policy: Policy | null): string {
  if (!policy) return '—';
  if (policy.basis === 'minimum') return '≥' + policy.retention;
  return policy.retention;
}

function sourceWord(row: CacheLifetimeRow): string {
  if (row.source === 'builtin') return row.effective?.basis === 'minimum' ? 'minimum' : 'estimate';
  if (row.source === 'none') return 'unknown';
  return row.source;
}

/** Disagreement worth surfacing: a measured crossing off by more than half. */
function disagrees(fit: CacheLifetimeRow['fit'], policy: Policy | null): boolean {
  if (!fit?.active || !policy) return false;
  const ratio = fit.ttlMs / policy.retentionMs;
  return ratio > 1.5 || ratio < 1 / 1.5;
}

export function cacheLifetimeStatus(row: CacheLifetimeRow): CacheLifetimeStatus {
  const measured = row.fit?.active ? ` · measured ~${formatGap(row.fit.ttlMs)}` : '';
  if (row.source === 'override') {
    return { label: 'Your override', detail: `cacheTtlOverrides${disagrees(row.fit, row.override) ? measured : ''}`, tone: 'fixed' };
  }
  if (row.source === 'documented') {
    return disagrees(row.fit, row.builtin)
      ? { label: 'Documented', detail: `Provider publishes ${row.builtin?.retention}${measured}`, tone: 'fixed' }
      : { label: 'Documented', detail: `Provider publishes ${row.builtin?.retention}`, tone: 'fixed' };
  }
  if (row.source === 'learned' && row.fit) {
    const warm = row.fit.warmHitRate === null ? '' : ` · ${Math.round(row.fit.warmHitRate * 100)}% warm inside`;
    return { label: 'Learned', detail: `${Math.round(row.fit.observations)} probes${warm}`, tone: 'learned' };
  }
  const failing = row.gates.find(gate => !gate.pass);
  const tail = row.source === 'none' ? ' · no countdown yet' : '';
  const warmAfter = row.probes.maxHitGapMs ? ` · warm after ${formatGap(row.probes.maxHitGapMs)}` : '';
  let detail = 'Gathering probes';
  switch (failing?.id) {
    case 'support': detail = `${Math.floor(failing.value ?? 0)} of ${failing.need} probes`; break;
    case 'warm': detail = 'Too few warm returns'; break;
    case 'cold': detail = row.probes.misses === 0 ? `Never seen cold${warmAfter}` : `${row.probes.misses} cold return${row.probes.misses === 1 ? '' : 's'}, need ${failing.need}${warmAfter}`; break;
    case 'slope': detail = 'No clear expiry cliff yet'; break;
    case 'range': detail = 'Fitted window out of range'; break;
    case 'bracket': detail = 'Crossing lies beyond observed gaps'; break;
  }
  return { label: 'Learning', detail: detail + tail, tone: 'learning' };
}

const x = (ms: number) => Math.max(0, Math.min(1, (Math.log(ms) - Math.log(DOMAIN_LO_MS)) / (Math.log(DOMAIN_HI_MS) - Math.log(DOMAIN_LO_MS))));
const pct = (value: number) => (value * 100).toFixed(2);

/** One-line probe strip: warm ticks above the rule, cold below, the served window as a marker. */
export function cacheLifetimeStripSvg(row: CacheLifetimeRow): string {
  const ticks = row.points.map(([gap, hit]) =>
    `<line class="${hit ? 'cl-warm' : 'cl-cold'}" x1="${pct(x(gap))}%" x2="${pct(x(gap))}%" y1="${hit ? 2 : 13}" y2="${hit ? 11 : 22}"/>`).join('');
  const ttl = row.effective
    ? `<line class="cl-ttl${row.source === 'builtin' || row.source === 'none' ? ' guess' : ''}" x1="${pct(x(row.effective.retentionMs))}%" x2="${pct(x(row.effective.retentionMs))}%" y1="0" y2="24"/>` : '';
  return `<svg class="cl-strip" width="100%" height="24" aria-hidden="true"><line class="cl-rule" x1="0" x2="100%" y1="12" y2="12"/>${ticks}${ttl}</svg>`;
}

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

/**
 * Expanded view: probes as dots, the fitted warmth curve, and the built-in
 * prior it would replace. The SVG stretches horizontally to its column, so it
 * holds only non-scaling strokes (dots are zero-length round-capped lines);
 * every label is HTML positioned by percentage and never distorts.
 */
export function cacheLifetimeCurveSvg(row: CacheLifetimeRow): string {
  const W = 600, H = 108, top = 8, plot = 92;
  const yFor = (p: number) => top + (1 - p) * plot;
  const path = (alpha: number, beta: number) => {
    let d = '';
    for (let i = 0; i <= 96; i++) {
      const t = i / 96, gap = Math.exp(Math.log(DOMAIN_LO_MS) + t * (Math.log(DOMAIN_HI_MS) - Math.log(DOMAIN_LO_MS)));
      d += `${i ? 'L' : 'M'}${(t * W).toFixed(1)} ${yFor(sigmoid(alpha + beta * Math.log(gap))).toFixed(1)}`;
    }
    return d;
  };
  const parts: string[] = [`<line class="cl-grid" x1="0" x2="${W}" y1="${yFor(0.5)}" y2="${yFor(0.5)}"/>`];
  // Deterministic jitter keeps repeated gaps from stacking into one dot.
  row.points.forEach(([gap, hit], i) => {
    const cx = (x(gap) * W).toFixed(1), cy = ((hit ? top + 5 : top + plot - 5) + (((i * 37) % 11) - 5) * 0.5).toFixed(1);
    parts.push(`<line class="cl-dot ${hit ? 'cl-warm' : 'cl-cold'}" x1="${cx}" x2="${cx}" y1="${cy}" y2="${cy}"/>`);
  });
  if (row.fit) {
    // The prior is a steep cliff at the built-in window; slope matches the learner's anchor.
    // Without a built-in window the learner anchors on a generic fallback;
    // drawing that as "built-in" would claim a policy that does not exist.
    const priorBeta = -6, priorAlpha = -priorBeta * Math.log(row.fit.priorTtlMs);
    if (row.builtin) parts.push(`<path class="cl-prior" d="${path(priorAlpha, priorBeta)}"/>`);
    parts.push(`<path class="cl-fit${row.fit.active ? '' : ' provisional'}" d="${path(row.fit.alpha, row.fit.beta)}"/>`);
  }
  let label = '';
  if (row.effective) {
    const ex = x(row.effective.retentionMs);
    parts.push(`<line class="cl-ttl" x1="${(ex * W).toFixed(1)}" x2="${(ex * W).toFixed(1)}" y1="0" y2="${H}"/>`);
    label = `<span class="cl-ttl-label${ex > 0.8 ? ' left' : ''}" style="left:${pct(ex)}%">${escapeHtml(ttlLabel(row.effective))}</span>`;
  }
  const axis = AXIS_TICKS.map(([text, ms]) => `<span style="left:${pct(x(ms))}%">${text}</span>`).join('');
  return `<div class="cl-curve"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}" aria-hidden="true">${parts.join('')}</svg>${label}<div class="cl-axis">${axis}</div></div>`;
}

const GATE_LABELS: Readonly<Record<CacheLifetimeGateId, string>> = {
  support: 'Enough recent probes', warm: 'Warm returns', cold: 'Cold returns',
  slope: 'Clear expiry cliff', range: 'Window between 1m and 365d', bracket: 'Crossing inside observed gaps',
};

function gateValue(gate: CacheLifetimeRow['gates'][number]): string {
  if (gate.value === null) return '';
  if (gate.id === 'range') return formatGap(gate.value);
  if (gate.id === 'slope') return `${gate.value.toFixed(1)} / ${gate.need}`;
  return `${Math.round(gate.value * 10) / 10} / ${gate.need}`;
}

function detailHtml(row: CacheLifetimeRow): string {
  const facts: [string, string][] = [
    ['Probes in window', `${row.probes.total} · ${row.probes.hits} warm, ${row.probes.misses} cold`],
    ['Longest warm gap', row.probes.maxHitGapMs ? formatGap(row.probes.maxHitGapMs) : '—'],
    ['Shortest cold gap', row.probes.minMissGapMs ? formatGap(row.probes.minMissGapMs) : '—'],
    ['Built-in', row.builtin ? `${row.builtin.retention} ${row.builtin.basis === 'fixed' ? 'documented' : row.builtin.basis}` : 'none'],
  ];
  if (row.fit) facts.push([row.fit.active ? 'Learned crossing' : 'Provisional crossing', '~' + formatGap(row.fit.ttlMs)]);
  if (row.override) facts.push(['Override', row.override.retention]);
  const gates = row.gates.map(gate => `<li class="${gate.pass ? 'pass' : 'fail'}"><span aria-hidden="true">${gate.pass ? '✓' : '✗'}</span><span>${GATE_LABELS[gate.id]}</span><small>${escapeHtml(gateValue(gate))}</small></li>`).join('');
  const note = row.source === 'documented' || row.source === 'override'
    ? `<p class="cl-note">${row.source === 'override' ? 'Your cacheTtlOverrides rule' : 'The provider’s published window'} always wins; the learner only replaces estimates.</p>` : '';
  return `<div class="cl-detail">
    <div class="cl-detail-plot">${cacheLifetimeCurveSvg(row)}<div class="cl-legend"><span class="cl-key warm"></span>warm <span class="cl-key cold"></span>cold <span class="cl-key fit"></span>fitted P(warm)${row.builtin ? ' <span class="cl-key prior"></span>built-in prior' : ''}</div></div>
    <div class="cl-detail-side"><ul class="cl-gates">${gates}</ul><dl class="cl-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>${note}</div>
  </div>`;
}

export function cacheLifetimesHtml(hosts: readonly CacheLifetimeHost[], view: { readonly hostKey: string | null; readonly open: ReadonlySet<string> }): string {
  const withRows = hosts.filter(host => host.rows.length);
  if (!withRows.length) return '';
  const selected = withRows.find(host => host.hostKey === view.hostKey) ?? withRows[0];
  const picker = withRows.length > 1
    ? `<div class="cl-hosts">${withRows.map(host => `<button class="usage-range-btn${host === selected ? ' active' : ''}" data-cl-host="${escapeHtml(host.hostKey)}">${escapeHtml(host.hostLabel)}</button>`).join('')}</div>` : '';
  const rows = selected.rows.map(row => {
    const status = cacheLifetimeStatus(row), open = view.open.has(row.key);
    const model = escapeHtml(row.model) + (row.tier ? ' <small>1h tier</small>' : '');
    return `<div class="cl-row${open ? ' open' : ''}" data-cl-key="${escapeHtml(encodeURIComponent(row.key))}" role="button" tabindex="0" aria-expanded="${open}">
      <div class="cl-model"><span>${model}</span><small>${escapeHtml(row.provider)}</small></div>
      <div class="cl-ttl-cell"><strong>${escapeHtml(ttlLabel(row.effective))}</strong><small class="cl-source ${row.source}">${sourceWord(row)}</small></div>
      <div class="cl-strip-cell">${cacheLifetimeStripSvg(row)}</div>
      <div class="cl-status ${status.tone}"><span>${status.label}</span><small>${escapeHtml(status.detail)}</small></div>
    </div>${open ? detailHtml(row) : ''}`;
  }).join('');
  return `<section class="usage-section cache-lifetimes"><h4>Cache lifetimes <span class="usage-hint">learned from idle gaps between turns · 10s → 24h, log scale</span></h4>${picker}${rows}</section>`;
}
