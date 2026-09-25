/**
 * Learned provider cache lifetimes. Providers report cache *token activity*,
 * never expiry timestamps, so the built-in retention ladder in
 * session-metadata.js is a pile of documented defaults and guesses. This
 * module measures the real thing: every assistant message with cache
 * activity is a Bernoulli probe of "did the provider cache survive the idle
 * gap since the previous cache-active message in this session?" — a hit
 * (cacheRead > 0) lower-bounds the lifetime, a hard miss upper-bounds it.
 * Both sides are one-sided censored samples of the cache lifetime, so per
 * (api, provider, model, tier) we fit a 2-parameter logistic warmth curve
 * P(hit | gap) on log-gap: the p=0.5 crossing is the learned TTL and the
 * slope is the provider's cache *reliability* (a deterministic server-side
 * TTL produces a cliff; best-effort eviction produces a shallow slope).
 *
 * Fitting is a batch weighted ridge logistic regression (Newton) over a
 * bounded sliding window — 45 days per identity, stratified by idle gap so
 * rare long-idle probes survive tool-loop chatter (see WINDOW_MAX_OBS), with a
 * 14-day exponential half-life so provider behavior drift washes out — with
 * an L2 prior anchored on the built-in ladder. A learned policy activates
 * only with enough decayed support, both outcomes observed, and the crossing
 * bracketed by real hits and misses; until then (and for documented 'fixed'
 * retentions, and whenever a user cacheTtlOverrides rule matches) the
 * built-in projection stands.
 *
 * Ingestion rides the session indexer: full parses call
 * observeCacheLifetimeFromEntries, O(delta) extensions call
 * extendCacheLifetimeFromEntries. Observations dedup by (file, timestamp) so
 * a restart's full re-parse after unpersisted in-memory extensions is
 * idempotent. State persists to ~/.pi/dish/cache-lifetime.json (tmp+rename),
 * resolved per call like the other host stores so tests' temp HOMEs work.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MAX_TTL_MS, MIN_TTL_MS, configuredCacheRetention, loadCacheRetentionConfig } from './cache-retention';
import type { CacheRetentionConfig } from './cache-retention';
import { builtinCacheRetention, cacheIdentity, cacheTier1h, cacheTokens, hasCacheActivity, isRecord, resolveCacheTarget } from './session-metadata';
import type { CacheExpiry, CacheExpiryBasis, SessionEntries } from './session-metadata-contracts';

export interface CacheLifetimeStats {
  /** Decayed effective observation count behind the fit. */
  readonly observations: number;
  /** Decayed empirical P(hit | gap ≤ learned TTL): the cache's warm-window reliability. */
  readonly warmHitRate: number | null;
  /** EWMA Brier score of active-policy predictions at observation time; NaN before any. */
  readonly brier: number;
  /** Warmth-curve slope on log-gap; steeper magnitude = sharper expiry cliff. */
  readonly slope: number;
}

export interface LearnedCacheRetention {
  readonly retentionMs: number;
  readonly retention: string;
  readonly basis: 'learned';
  readonly stats: CacheLifetimeStats;
}

export interface CacheLifetimeSnapshotEntry {
  readonly key: string;
  readonly identity: string;
  readonly tier: '1h' | null;
  readonly active: boolean;
  readonly ttlMs: number | null;
  readonly retention: string | null;
  readonly stats: CacheLifetimeStats | null;
  readonly rawObservations: number;
}

export interface CacheLifetimeGate {
  readonly id: 'support' | 'warm' | 'cold' | 'slope' | 'range' | 'bracket';
  readonly pass: boolean;
  readonly value: number | null;
  readonly need: number;
}

/** Where an identity's served retention comes from, in precedence order. */
export type CacheLifetimeSource = 'override' | 'documented' | 'learned' | 'builtin' | 'none';

export interface CacheLifetimeReportEntry {
  readonly api: string;
  readonly provider: string;
  readonly model: string;
  readonly tier: '1h' | null;
  /** What sessions are served for this identity right now. */
  readonly effective: { readonly retentionMs: number; readonly retention: string; readonly basis: CacheExpiryBasis } | null;
  readonly source: CacheLifetimeSource;
  readonly builtin: { readonly retentionMs: number; readonly retention: string; readonly basis: CacheExpiryBasis } | null;
  readonly override: { readonly retentionMs: number; readonly retention: string; readonly basis: CacheExpiryBasis } | null;
  /** The fitted curve P(hit | gap) = σ(alpha + beta·ln gapMs); null below four usable probes. */
  readonly fit: { readonly active: boolean; readonly ttlMs: number; readonly alpha: number; readonly beta: number;
    readonly priorTtlMs: number; readonly stats: CacheLifetimeStats } | null;
  readonly gates: readonly CacheLifetimeGate[];
  readonly probes: { readonly total: number; readonly hits: number; readonly misses: number;
    readonly maxHitGapMs: number | null; readonly minMissGapMs: number | null; readonly lastAt: number };
  /** Window probes as [gapMs, hit], for plotting; raw counts, not decayed. */
  readonly points: readonly (readonly [number, 0 | 1])[];
}

interface Observation { readonly t: number; readonly gap: number; readonly hit: boolean; readonly fh: string }
interface Fit {
  readonly alpha: number;
  readonly beta: number;
  readonly ttlMs: number;
  readonly effN: number;
  readonly effHits: number;
  readonly effMisses: number;
  readonly warmHits: number;
  readonly warmTotal: number;
  readonly minMissGap: number;
  readonly maxHitGap: number;
}
interface IdentityState {
  obs: Observation[];
  keys: Set<string>;
  brier: number;
  brierN: number;
  fit: Fit | null;
  fitDirty: boolean;
  fitAt: number;
}
interface LifetimeStore {
  stamp: string;
  identities: Map<string, IdentityState>;
  dirty: boolean;
}

const STORE_VERSION = 1;
// The window is stratified by idle gap: at most WINDOW_BUCKET_OBS probes per
// doubling of the gap (<15s, 15-30s, 30s-1m, … ≥17h), then WINDOW_MAX_OBS in
// total, always evicting the oldest probe of the fullest bucket. A plain FIFO
// filled with seconds-apart tool-loop probes and evicted the rare long-idle
// returns — the only evidence of where a cache expires — so almost no
// identity ever observed a miss. Retention conditioned on the gap alone,
// never on the outcome, leaves the fitted P(hit | gap) unbiased.
const WINDOW_MAX_OBS = 240;
const WINDOW_BUCKET_OBS = 24;
const WINDOW_BUCKET_BASE_MS = 15_000;
const WINDOW_BUCKETS = 14;
const WINDOW_MAX_AGE_MS = 45 * 24 * 60 * 60_000;
const HALF_LIFE_MS = 14 * 24 * 60 * 60_000;
const RIDGE = 3;
const PRIOR_SLOPE = -6;
const FALLBACK_PRIOR_TTL_MS = 10 * 60_000;
const MIN_EFFECTIVE_OBS = 20;
const MIN_EFFECTIVE_OUTCOMES = 3;
const MIN_SLOPE = 0.5;
// The crossing must be covered by real data on both sides, loosely: a clean
// deterministic cliff is separable (max hit gap < min miss gap), so exact
// bracketing would never activate. A factor two still rejects crossings
// extrapolated past anything the user's usage pattern ever probed.
const BRACKET_TOLERANCE = 2;
const BRIER_ALPHA = 0.15;
const REFIT_MS = 60_000;
const MAX_CHAINS = 5000;
const TIER_1H_SUFFIX = '\u00001h';

const stores = new Map<string, LifetimeStore>();
/** Per-file last cache-active anchor: identity -> { ts, tier1h } of the entry being probed. */
const chains = new Map<string, Map<string, { ts: number; tier1h: boolean }>>();

function storeFile(): string {
  return path.join(os.homedir(), '.pi', 'dish', 'cache-lifetime.json');
}

function decodeObservations(value: unknown): Observation[] {
  if (!Array.isArray(value)) return [];
  const obs: Observation[] = [];
  for (const raw of value) {
    if (!Array.isArray(raw)) continue;
    const [t, gap, hit, fh] = raw as unknown[];
    if (typeof t !== 'number' || !Number.isFinite(t) || typeof gap !== 'number' ||
        !Number.isFinite(gap) || gap <= 0 || (hit !== 0 && hit !== 1) ||
        typeof fh !== 'string' || fh.length > 16) continue;
    obs.push({ t, gap, hit: hit === 1, fh });
    if (obs.length >= WINDOW_MAX_OBS * 4) break;
  }
  return obs;
}

function gapBucket(gap: number): number {
  if (gap < WINDOW_BUCKET_BASE_MS) return 0;
  return Math.min(WINDOW_BUCKETS - 1, 1 + Math.floor(Math.log2(gap / WINDOW_BUCKET_BASE_MS)));
}

function evictOldest(window: Observation[], bucket: number | null): Observation {
  let index = -1;
  for (let i = 0; i < window.length; i++) {
    if (bucket !== null && gapBucket(window[i].gap) !== bucket) continue;
    if (index < 0 || window[i].t < window[index].t) index = i;
  }
  return window.splice(index, 1)[0];
}

/** Admit one probe into a stratified window; returns every probe it evicted (possibly itself). */
function admitObservation(window: Observation[], obs: Observation, now: number): Observation[] {
  const cutoff = now - WINDOW_MAX_AGE_MS;
  const evicted: Observation[] = [];
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].t < cutoff) evicted.push(window.splice(i, 1)[0]);
  }
  if (obs.t < cutoff) return [...evicted, obs];
  window.push(obs);
  const counts = new Array<number>(WINDOW_BUCKETS).fill(0);
  for (const o of window) counts[gapBucket(o.gap)]++;
  const bucket = gapBucket(obs.gap);
  if (counts[bucket] > WINDOW_BUCKET_OBS) evicted.push(evictOldest(window, bucket));
  else if (window.length > WINDOW_MAX_OBS) evicted.push(evictOldest(window, counts.indexOf(Math.max(...counts))));
  return evicted;
}

function decodeStore(value: unknown): Map<string, IdentityState> {
  const identities = new Map<string, IdentityState>();
  const rawIdentities = isRecord(value) && isRecord(value.identities) ? value.identities : null;
  if (!rawIdentities) return identities;
  const now = Date.now();
  for (const [key, raw] of Object.entries(rawIdentities)) {
    if (key.length > 500 || !isRecord(raw)) continue;
    // Re-admitting in time order applies the current window policy to stores
    // written under an older one.
    const obs: Observation[] = [];
    for (const o of decodeObservations(raw.obs).sort((a, b) => a.t - b.t)) admitObservation(obs, o, now);
    if (!obs.length) continue;
    identities.set(key, {
      obs, keys: new Set(obs.map(o => `${o.fh}:${o.t}`)),
      brier: typeof raw.brier === 'number' && Number.isFinite(raw.brier) ? raw.brier : NaN,
      brierN: typeof raw.brierN === 'number' && Number.isFinite(raw.brierN) ? raw.brierN : 0,
      fit: null, fitDirty: true, fitAt: 0,
    });
  }
  return identities;
}

function getStore(): LifetimeStore {
  const file = storeFile();
  let stamp = 'missing';
  try {
    const stats = fs.statSync(file);
    stamp = `${stats.mtimeMs}:${stats.size}`;
  } catch {}
  const existing = stores.get(file);
  if (existing && existing.stamp === stamp) return existing;
  let parsed: unknown = null;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const store: LifetimeStore = { stamp, identities: decodeStore(parsed), dirty: false };
  stores.set(file, store);
  return store;
}

/** Persist observations when the indexer dirtied them; tmp+rename, last writer wins. */
export function flushCacheLifetime(): void {
  const file = storeFile();
  const store = stores.get(file);
  if (!store?.dirty) return;
  const identities: Record<string, unknown> = {};
  for (const [key, state] of store.identities) {
    if (!state.obs.length) continue;
    identities[key] = {
      obs: state.obs.map(o => [o.t, o.gap, o.hit ? 1 : 0, o.fh]),
      ...(Number.isFinite(state.brier) ? { brier: state.brier, brierN: state.brierN } : {}),
    };
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: STORE_VERSION, identities }) + '\n');
    fs.renameSync(tmp, file);
    const stats = fs.statSync(file);
    store.stamp = `${stats.mtimeMs}:${stats.size}`;
    store.dirty = false;
  } catch {}
}

/**
 * Weighted ridge logistic fit of P(hit | gap) = σ(α + β·ln gap). Newton
 * iterations on the 2-parameter model; the L2 prior pulls toward a steep
 * cliff at the built-in ladder's TTL so sparse data shrinks to the status
 * quo instead of extrapolating.
 */
function fitObservations(obs: readonly Observation[], now: number, priorTtlMs: number): Fit | null {
  if (obs.length < 4) return null;
  const points: { x: number; y: number; w: number }[] = [];
  for (const o of obs) {
    const w = 2 ** (-(now - o.t) / HALF_LIFE_MS);
    if (w > 1e-6) points.push({ x: Math.log(o.gap), y: o.hit ? 1 : 0, w });
  }
  if (points.length < 4) return null;
  const alpha0 = -PRIOR_SLOPE * Math.log(priorTtlMs);
  let alpha = alpha0, beta = PRIOR_SLOPE;
  for (let iter = 0; iter < 40; iter++) {
    let g0 = RIDGE * (alpha - alpha0), g1 = RIDGE * (beta - PRIOR_SLOPE);
    let h00 = RIDGE, h01 = 0, h11 = RIDGE;
    for (const p of points) {
      const pr = 1 / (1 + Math.exp(-(alpha + beta * p.x)));
      const r = p.w * (pr - p.y);
      const q = p.w * pr * (1 - pr);
      g0 += r; g1 += r * p.x;
      h00 += q; h01 += q * p.x; h11 += q * p.x * p.x;
    }
    const det = h00 * h11 - h01 * h01;
    if (!(Math.abs(det) > 1e-12)) break;
    const d0 = (h11 * g0 - h01 * g1) / det;
    const d1 = (h00 * g1 - h01 * g0) / det;
    alpha -= d0; beta -= d1;
    if (Math.abs(d0) + Math.abs(d1) < 1e-9) break;
  }
  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || beta >= -1e-6) return null;
  const ttlMs = Math.exp(-alpha / beta);
  let effN = 0, effHits = 0, warmHits = 0, warmTotal = 0;
  let minMissGap = Infinity, maxHitGap = 0;
  for (const p of points) {
    const gap = Math.exp(p.x);
    effN += p.w;
    if (p.y === 1) {
      effHits += p.w;
      if (gap > maxHitGap) maxHitGap = gap;
    } else if (gap < minMissGap) minMissGap = gap;
    if (gap <= ttlMs) { warmTotal += p.w; warmHits += p.w * p.y; }
  }
  return { alpha, beta, ttlMs, effN, effHits, effMisses: effN - effHits,
    warmHits, warmTotal, minMissGap, maxHitGap };
}

/**
 * Activation gates, in the order the UI explains them. `value`/`need` are the
 * decayed quantity and its threshold; the bracket gate is pass/fail only.
 * Without a fit (fewer than four usable probes) only support can be judged.
 */
function fitGates(fit: Fit | null, rawObservations: number): CacheLifetimeGate[] {
  if (!fit) {
    return [{ id: 'support', pass: false, value: rawObservations, need: MIN_EFFECTIVE_OBS }];
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return [
    { id: 'support', pass: fit.effN >= MIN_EFFECTIVE_OBS, value: round(fit.effN), need: MIN_EFFECTIVE_OBS },
    { id: 'warm', pass: fit.effHits >= MIN_EFFECTIVE_OUTCOMES, value: round(fit.effHits), need: MIN_EFFECTIVE_OUTCOMES },
    { id: 'cold', pass: fit.effMisses >= MIN_EFFECTIVE_OUTCOMES, value: round(fit.effMisses), need: MIN_EFFECTIVE_OUTCOMES },
    { id: 'slope', pass: fit.beta <= -MIN_SLOPE, value: round(-fit.beta), need: MIN_SLOPE },
    { id: 'range', pass: fit.ttlMs >= MIN_TTL_MS && fit.ttlMs <= MAX_TTL_MS, value: Math.round(fit.ttlMs), need: MIN_TTL_MS },
    { id: 'bracket', pass: fit.minMissGap <= fit.ttlMs * BRACKET_TOLERANCE && fit.maxHitGap * BRACKET_TOLERANCE >= fit.ttlMs,
      value: null, need: BRACKET_TOLERANCE },
  ];
}

function fitActive(fit: Fit): boolean {
  return fitGates(fit, 0).every(gate => gate.pass);
}

function fitStats(fit: Fit, brier: number): CacheLifetimeStats {
  return {
    observations: Math.round(fit.effN * 100) / 100,
    warmHitRate: fit.warmTotal >= MIN_EFFECTIVE_OUTCOMES ? fit.warmHits / fit.warmTotal : null,
    brier,
    slope: Math.round(fit.beta * 1000) / 1000,
  };
}

function tierOf(key: string): '1h' | null {
  return key.endsWith(TIER_1H_SUFFIX) ? '1h' : null;
}

function identityOf(key: string): string {
  return tierOf(key) ? key.slice(0, -TIER_1H_SUFFIX.length) : key;
}

function priorTtlFor(key: string): number {
  const [api = '', provider = '', model = ''] = identityOf(key).split('\u0000');
  return builtinCacheRetention(resolveCacheTarget({ api, provider, model }), tierOf(key) === '1h')?.retentionMs ??
    FALLBACK_PRIOR_TTL_MS;
}

function ensureFit(key: string, state: IdentityState, now: number): Fit | null {
  if (state.fitDirty || now - state.fitAt > REFIT_MS) {
    state.fit = fitObservations(state.obs, now, priorTtlFor(key));
    state.fitDirty = false;
    state.fitAt = now;
  }
  return state.fit;
}

function recordObservation(key: string, obs: Observation, now: number): void {
  const store = getStore();
  let state = store.identities.get(key);
  if (!state) {
    state = { obs: [], keys: new Set(), brier: NaN, brierN: 0, fit: null, fitDirty: true, fitAt: 0 };
    store.identities.set(key, state);
  }
  const dedupKey = `${obs.fh}:${obs.t}`;
  if (state.keys.has(dedupKey)) return;
  // Calibration of the active policy *before* ingesting this probe.
  const fit = ensureFit(key, state, now);
  if (fit && fitActive(fit)) {
    const p = 1 / (1 + Math.exp(-(fit.alpha + fit.beta * Math.log(obs.gap))));
    const err = (p - (obs.hit ? 1 : 0)) ** 2;
    state.brier = Number.isFinite(state.brier) ? state.brier + BRIER_ALPHA * (err - state.brier) : err;
    state.brierN++;
  }
  state.keys.add(dedupKey);
  for (const dropped of admitObservation(state.obs, obs, now)) state.keys.delete(`${dropped.fh}:${dropped.t}`);
  state.fitDirty = true;
  store.dirty = true;
}

function extractObservations(entries: SessionEntries, file: string,
  chain: Map<string, { ts: number; tier1h: boolean }>, profileId: string): void {
  const fh = createHash('sha256').update(file).digest('hex').slice(0, 8);
  let currentModel: string | null = null;
  for (const raw of entries) {
    if (!isRecord(raw)) continue;
    if (raw.type === 'compaction') { chain.clear(); continue; }
    if (raw.type === 'model_change') {
      const model = profileId === 'omp-v1' ? raw.model : raw.modelId;
      if (typeof model === 'string' && model) currentModel = model;
      continue;
    }
    if (raw.type !== 'message') continue;
    const message = isRecord(raw.message) ? raw.message : null;
    if (message?.role !== 'assistant' || !hasCacheActivity(message)) continue;
    const ts = new Date((message.timestamp ?? raw.timestamp) as string | number | Date).getTime();
    if (!Number.isFinite(ts)) continue;
    // Mirror accumulateSessionInfo: a message without a model inherits the
    // session's current one so both produce the same cache identity.
    const attributed = message.model === undefined && currentModel !== null
      ? { ...message, model: currentModel } : message;
    const target = resolveCacheTarget(attributed);
    if (!target.provider && !target.model) continue;
    const identity = cacheIdentity(attributed);
    const usage = message.usage as Record<string, unknown>;
    const anchor = chain.get(identity);
    if (anchor && ts > anchor.ts) {
      recordObservation(anchor.tier1h ? `${identity}${TIER_1H_SUFFIX}` : identity,
        { t: ts, gap: ts - anchor.ts, hit: cacheTokens(usage, 'cacheRead') > 0, fh }, Date.now());
    }
    // A write sets the probed entry's tier; a pure read leaves it unchanged.
    const wrote = cacheTokens(usage, 'cacheWrite') > 0;
    chain.set(identity, { ts, tier1h: wrote ? cacheTier1h(usage, target.provider === 'anthropic') : (anchor?.tier1h ?? false) });
  }
}

function trackChain(file: string): Map<string, { ts: number; tier1h: boolean }> {
  const chain = new Map<string, { ts: number; tier1h: boolean }>();
  chains.set(file, chain);
  if (chains.size > MAX_CHAINS) chains.delete(chains.keys().next().value!);
  return chain;
}

/** Full parse: re-anchors the file's chains; per-(file,t) dedup keeps re-parses idempotent. */
export function observeCacheLifetimeFromEntries(entries: SessionEntries, file: string, profileId = 'pi-v3'): void {
  try { extractObservations(entries, file, trackChain(file), profileId); } catch {}
}

/** O(delta) extension: continues the file's chains from the indexed prefix. */
export function extendCacheLifetimeFromEntries(entries: SessionEntries, file: string, profileId = 'pi-v3'): void {
  try { extractObservations(entries, file, chains.get(file) ?? trackChain(file), profileId); } catch {}
}

export function forgetCacheLifetimeFile(file: string): void {
  chains.delete(file);
}

function learnedPolicyFor(identity: string, tier: '1h' | undefined): LearnedCacheRetention | null {
  const key = tier === '1h' ? `${identity}${TIER_1H_SUFFIX}` : identity;
  const state = getStore().identities.get(key);
  if (!state) return null;
  const fit = ensureFit(key, state, Date.now());
  if (!fit || !fitActive(fit)) return null;
  return {
    retentionMs: fit.ttlMs,
    retention: formatLearnedRetention(fit.ttlMs),
    basis: 'learned',
    stats: fitStats(fit, state.brier),
  };
}

function formatLearnedRetention(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 90) return `~${Math.max(1, Math.round(minutes))}m`;
  const hours = ms / (60 * 60_000);
  if (hours < 48) return `~${Math.round(hours * 10) / 10}h`;
  return `~${Math.round(hours / 2.4) / 10}d`;
}

export type ServedCacheExpiry = Omit<CacheExpiry, 'basis'> & { readonly basis: CacheExpiryBasis };

function isServedCacheExpiry(expiry: CacheExpiry): expiry is ServedCacheExpiry {
  return expiry.basis !== 'unknown';
}

function splitIdentity(identity: string): { api: string; provider: string; model: string } {
  const [api = '', provider = '', model = ''] = identity.split('\u0000');
  return { api, provider, model };
}

/**
 * Serve-time overlay: substitute an active learned TTL for built-in
 * 'estimate'/'minimum' projections, and supply one where no built-in window
 * exists at all ('unknown' — never served itself). Documented 'fixed'
 * retentions and user cacheTtlOverrides rules always win; the learner only
 * replaces guesses.
 */
export function applyLearnedCacheExpiry(expiry: CacheExpiry | null,
  config: CacheRetentionConfig = loadCacheRetentionConfig()): ServedCacheExpiry | null {
  if (!expiry) return null;
  const known = isServedCacheExpiry(expiry) ? expiry : null;
  if (known?.basis === 'fixed') return known;
  const target = resolveCacheTarget(splitIdentity(expiry.identity));
  if (configuredCacheRetention(config, target.provider, target.model)) return known;
  const learned = learnedPolicyFor(expiry.identity, expiry.tier);
  if (!learned) return known;
  return { ...expiry, retentionMs: learned.retentionMs, retention: learned.retention,
    expiresAt: expiry.refreshedAt + learned.retentionMs, basis: 'learned' };
}

/** Per-identity fitted state for diagnostics and the provider-stats surface. */
export function cacheLifetimeSnapshot(): CacheLifetimeSnapshotEntry[] {
  const store = getStore();
  const now = Date.now();
  const out: CacheLifetimeSnapshotEntry[] = [];
  for (const [key, state] of store.identities) {
    if (!state.obs.length) continue;
    const fit = ensureFit(key, state, now);
    const active = !!fit && fitActive(fit);
    out.push({
      key, identity: identityOf(key), tier: tierOf(key),
      active, ttlMs: fit ? Math.round(fit.ttlMs) : null,
      retention: fit && active ? formatLearnedRetention(fit.ttlMs) : null,
      stats: fit ? fitStats(fit, state.brier) : null,
      rawObservations: state.obs.length,
    });
  }
  return out;
}

/**
 * Everything the cache-lifetimes view explains per identity: the policy
 * sessions are served (with the same precedence as applyLearnedCacheExpiry),
 * the fitted curve, each activation gate, and the window's probes.
 */
export function cacheLifetimeReport(config: CacheRetentionConfig = loadCacheRetentionConfig()): CacheLifetimeReportEntry[] {
  const store = getStore();
  const now = Date.now();
  const out: CacheLifetimeReportEntry[] = [];
  for (const [key, state] of store.identities) {
    if (!state.obs.length) continue;
    const identity = identityOf(key), tier = tierOf(key);
    const { api, provider, model } = splitIdentity(identity);
    const target = resolveCacheTarget({ api, provider, model });
    const fit = ensureFit(key, state, now);
    const active = !!fit && fitActive(fit);
    const override = configuredCacheRetention(config, target.provider, target.model);
    const builtin = builtinCacheRetention(target, tier === '1h');
    let source: CacheLifetimeSource = 'none';
    let effective: CacheLifetimeReportEntry['effective'] = null;
    if (override) { source = 'override'; effective = override; }
    else if (builtin?.basis === 'fixed') { source = 'documented'; effective = builtin; }
    else if (fit && active) {
      source = 'learned';
      effective = { retentionMs: Math.round(fit.ttlMs), retention: formatLearnedRetention(fit.ttlMs), basis: 'learned' };
    } else if (builtin) { source = 'builtin'; effective = builtin; }
    let hits = 0, maxHitGapMs: number | null = null, minMissGapMs: number | null = null, lastAt = 0;
    for (const o of state.obs) {
      if (o.hit) { hits++; if (maxHitGapMs === null || o.gap > maxHitGapMs) maxHitGapMs = o.gap; }
      else if (minMissGapMs === null || o.gap < minMissGapMs) minMissGapMs = o.gap;
      if (o.t > lastAt) lastAt = o.t;
    }
    out.push({
      api, provider: target.provider, model: target.model, tier, effective, source,
      builtin: builtin ? { retentionMs: builtin.retentionMs, retention: builtin.retention, basis: builtin.basis } : null,
      override,
      fit: fit ? { active, ttlMs: Math.round(fit.ttlMs), alpha: fit.alpha, beta: fit.beta,
        priorTtlMs: priorTtlFor(key), stats: fitStats(fit, state.brier) } : null,
      gates: fitGates(fit, state.obs.length),
      probes: { total: state.obs.length, hits, misses: state.obs.length - hits, maxHitGapMs, minMissGapMs, lastAt },
      points: [...state.obs].sort((a, b) => a.t - b.t).map(o => [Math.round(o.gap), o.hit ? 1 : 0] as const),
    });
  }
  return out.sort((a, b) => b.probes.lastAt - a.probes.lastAt);
}

export function resetCacheLifetimeForTests(): void {
  stores.clear();
  chains.clear();
}
