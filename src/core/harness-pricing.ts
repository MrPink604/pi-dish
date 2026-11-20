import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { dishDir, replaceFile } from './dish-store';
import { getHarness } from './harnesses';
import { runHarnessModelCatalog } from './harness-feature-commands';
import * as YAML from 'yaml';
import { getPricingModels } from './pi-sdk';
import { finite, record } from './helper-values';

// A snapshot older than six hours is refreshed on the next pricing-backed
// request, but stays the last-known source if the refresh fails.
export const CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FAILED_REFRESH_RETRY_MS = 5 * 60 * 1000;
const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
type CostKey = typeof COST_KEYS[number];
export interface UsageCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}
interface CatalogModel {
  // External catalogs accept truthy identities; matching stringifies them.
  provider: unknown;
  id: unknown;
  cost: Partial<Record<CostKey, number>>;
}
export interface PricingSnapshot {
  updatedAt: number;
  models: CatalogModel[];
  revision: string;
}
export interface PricingRefreshOptions { force?: boolean; now?: number }
interface PricingState {
  snapshot: PricingSnapshot | null;
  inFlight: Promise<PricingSnapshot | null> | null;
  lastAttemptAt: number;
}
interface OverridesCacheEntry { stats: fs.Stats; entries: CatalogModel[] }
type HarnessInput = string | null | undefined;
const PRICED_HARNESSES: Readonly<Record<string, true>> = { pi: true, omp: true, agy: true };
// Subscription providers whose catalogs carry zero rates because there is no
// per-request price: a zero rate there is unpriced, not free (unlike genuinely
// free tiers, which keep their authoritative $0).
const ZAI_PLAN_PROVIDERS: Readonly<Record<string, true>> = { zai: true, 'zai-coding-cn': true };
const PLAN_PROVIDERS: Readonly<Record<string, Readonly<Record<string, true>> | undefined>> = {
  pi: ZAI_PLAN_PROVIDERS,
  omp: { ...ZAI_PLAN_PROVIDERS, 'kimi-code': true, 'google-antigravity': true, 'openai-codex': true },
  // An Antigravity subscription bills nothing per request: known models use the
  // API-equivalent rate card below, while unknown zero-rated rows remain unpriced.
  agy: { 'google-antigravity': true },
};
// API-equivalent list prices (USD per million tokens) for Antigravity models.
// `agy models` publishes no dollar rates because Antigravity is a subscription;
// these match public Google Gemini (and account) API rate cards so usage
// dashboards and session stats reflect API-equivalent value. Optional user
// overrides in `~/.pi/dish/pricing/agy.json` win over this built-in card.
const AGY_API_RATE_CARD: readonly CatalogModel[] = [
  // Gemini 4 family
  { provider: 'google-antigravity', id: 'gemini-4-neon', cost: { input: 3, output: 15, cacheRead: 0.15, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-4-carbon', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-4-argon', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-4-hydrogen', cost: { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0 } },
  // Gemini Pro Orchestrator variants
  { provider: 'google-antigravity', id: 'gemini-pro-orchestrator-neon', cost: { input: 3, output: 15, cacheRead: 0.15, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-pro-orchestrator', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-pro-orchestrator-argon', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } },
  // Gemini 3.x family
  { provider: 'google-antigravity', id: 'gemini-3.8-flash', cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3.7-flash', cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3.7-flash-tiered', cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3.6-flash', cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3.5-flash', cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3.5-flash-lite', cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3.1-pro-preview', cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3.1-flash-lite', cost: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3.1-flash-lite-preview', cost: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3.1-flash-image', cost: { input: 0.5, output: 60, cacheRead: 0.05, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3-flash', cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-3-flash-preview', cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 } },
  // Gemini 2.5 family
  { provider: 'google-antigravity', id: 'gemini-2.5-pro', cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-2.5-flash', cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 } },
  { provider: 'google-antigravity', id: 'gemini-2.5-flash-lite', cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 } },
  // Non-Gemini account models listed by `agy models`
  { provider: 'google-antigravity', id: 'claude-opus-5-5', cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
  { provider: 'google-antigravity', id: 'claude-sonnet-5-5', cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } },
  { provider: 'google-antigravity', id: 'gpt-oss-120b', cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 } },
];
const AGY_API_RATE_CARD_LIST: CatalogModel[] = [...AGY_API_RATE_CARD];
const AGY_API_RATE_CARD_REVISION = crypto.createHash('sha256').update(JSON.stringify(AGY_API_RATE_CARD_LIST)).digest('hex').slice(0, 16);
// Antigravity brain transcripts append `-<level>` to the base model id
// (e.g. `gemini-4-neon-xhigh`, `gemini-3.8-flash-low`).
const AGY_LEVEL_SUFFIX_RE = /-(?:minimal|low|medium|high|xhigh|max)$/;
const states = new Map<string, PricingState>();

// OMP's models.yml modelOverrides are the user's rate card. OMP drops
// override-only ids from its catalog, so pi-dish reads the file directly:
// user entries win and revive missing ids. Revalidated by full file stats.
const MODEL_OVERRIDES_FILE: Readonly<Record<string, string | undefined>> = { omp: path.join('.omp', 'agent', 'models.yml') };
const overridesCache = new Map<string, OverridesCacheEntry>();

type Rates = CatalogModel['cost'];
export type UsageCostEstimator = (provider: unknown, model: unknown, usage: unknown) => UsageCost | undefined;
// Catalog/override arrays are replaced, not mutated, on refresh. Index each
// snapshot once; repeated models in a catalog retain Array.find's first win.
const rateIndexes = new WeakMap<CatalogModel[], ReadonlyMap<string, Rates>>();
function indexRates(models: CatalogModel[] | undefined): ReadonlyMap<string, Rates> | undefined {
  if (!models?.length) return undefined;
  let index = rateIndexes.get(models);
  if (!index) {
    const rates = new Map<string, Rates>();
    for (const model of models) {
      const selector = `${model.provider}/${model.id}`;
      if (!rates.has(selector)) rates.set(selector, model.cost);
    }
    index = rates;
    rateIndexes.set(models, index);
  }
  return index;
}

function loadModelOverrides(harnessId: string): CatalogModel[] {
  const rel = MODEL_OVERRIDES_FILE[harnessId];
  if (!rel) return [];
  const file = path.join(os.homedir(), rel);
  let stats: fs.Stats;
  try { stats = fs.statSync(file); } catch { return []; }
  const cached = overridesCache.get(file);
  if (cached && cached.stats.mtimeMs === stats.mtimeMs && cached.stats.size === stats.size &&
      cached.stats.ctimeMs === stats.ctimeMs && cached.stats.dev === stats.dev && cached.stats.ino === stats.ino) return cached.entries;
  let entries: CatalogModel[] = [];
  try {
    const doc: unknown = YAML.parse(fs.readFileSync(file, 'utf8'));
    const providers = record(doc) ? doc.providers : undefined;
    for (const [provider, section] of Object.entries(record(providers) || Array.isArray(providers) ? providers : {})) {
      const overrides: unknown = record(section) ? section.modelOverrides : undefined;
      for (const [id, override] of Object.entries(record(overrides) || Array.isArray(overrides) ? overrides : {})) {
        const source: unknown = record(override) ? override.cost : undefined;
        if (!record(source) || !finite(source.input) || !finite(source.output)) continue;
        const cost: Partial<Record<CostKey, number>> = {};
        for (const key of COST_KEYS) if (finite(source[key])) cost[key] = source[key];
        entries.push({ provider, id, cost });
      }
    }
  } catch { entries = []; } // a broken config must not break pricing
  overridesCache.set(file, { stats, entries });
  return entries;
}

function catalogFile(harnessId: string): string {
  return path.join(dishDir(), 'pricing', `${harnessId}.json`);
}

function normalizeCatalog(raw: unknown): CatalogModel[] | null {
  const rows: unknown = Array.isArray(raw) ? raw : record(raw) ? raw.models : undefined;
  if (!Array.isArray(rows)) return null;
  const models: CatalogModel[] = [];
  for (const model of rows as unknown[]) {
    if (!record(model)) continue;
    const provider = model.provider;
    const id = model.id || model.modelId;
    const source = model.cost || model.pricing;
    if (!provider || !id || !record(source) || !finite(source.input) || !finite(source.output)) continue;
    const cost: Partial<Record<CostKey, number>> = {};
    for (const key of COST_KEYS) if (finite(source[key])) cost[key] = source[key];
    models.push({ provider, id, cost });
  }
  return models.length ? models : null;
}

function revisionFor(models: CatalogModel[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(models)).digest('hex').slice(0, 16);
}

function loadState(harnessId: string): PricingState {
  const file = catalogFile(harnessId);
  const cached = states.get(file);
  if (cached) return cached;
  let snapshot: PricingSnapshot | null = null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record(raw)) {
      const models = normalizeCatalog(raw.models);
      if (models) snapshot = { updatedAt: Number(raw.updatedAt) || 0, models, revision: revisionFor(models) };
    }
  } catch {}
  const state: PricingState = { snapshot, inFlight: null, lastAttemptAt: 0 };
  states.set(file, state);
  return state;
}

function persist(harnessId: string, snapshot: PricingSnapshot): void {
  replaceFile(catalogFile(harnessId), JSON.stringify({ updatedAt: snapshot.updatedAt, models: snapshot.models }, null, 2) + '\n', 0o600);
}

async function runCatalogCommand(harnessId: string, force: boolean): Promise<CatalogModel[]> {
  const descriptor = getHarness(harnessId);
  if (!descriptor?.argv?.models?.length) throw new Error(`Harness ${harnessId} has no model catalog command`);
  const models = normalizeCatalog(await runHarnessModelCatalog(descriptor, { force }));
  if (!models) throw new Error(`${descriptor.label} model catalog contained no priced models`);
  return models;
}

function loadCatalogModels(harnessId: string, force: boolean): Promise<CatalogModel[]> {
  if (harnessId === 'pi') {
    return getPricingModels().then((raw: unknown) => {
      const models = normalizeCatalog(raw);
      if (!models) throw new Error('Pi model registry contained no priced models');
      return models;
    });
  }
  return runCatalogCommand(harnessId, force);
}

function loadAgyOverrides(): CatalogModel[] {
  const file = catalogFile('agy');
  let stats: fs.Stats;
  try { stats = fs.statSync(file); } catch { return []; }
  const cached = overridesCache.get(file);
  if (cached && cached.stats.mtimeMs === stats.mtimeMs && cached.stats.size === stats.size &&
      cached.stats.ctimeMs === stats.ctimeMs && cached.stats.dev === stats.dev && cached.stats.ino === stats.ino) return cached.entries;
  let entries: CatalogModel[] = [];
  try {
    entries = normalizeCatalog(JSON.parse(fs.readFileSync(file, 'utf8'))) || [];
  } catch { entries = []; } // a broken override file falls back to the built-in rate card
  overridesCache.set(file, { stats, entries });
  return entries;
}

export async function refreshHarnessPricing(harnessId = 'omp', { force = false, now = Date.now() }: PricingRefreshOptions = {}): Promise<PricingSnapshot | null> {
  if (!Object.hasOwn(PRICED_HARNESSES, harnessId)) return null;
  if (harnessId === 'agy') {
    const overrides = loadAgyOverrides();
    const models = overrides.length ? [...overrides, ...AGY_API_RATE_CARD_LIST] : AGY_API_RATE_CARD_LIST;
    return { updatedAt: now, models, revision: pricingRevision('agy') };
  }
  const state = loadState(harnessId);
  if (!force && state.snapshot && now - state.snapshot.updatedAt < CATALOG_MAX_AGE_MS) return state.snapshot;
  if (!force && now - state.lastAttemptAt < FAILED_REFRESH_RETRY_MS) return state.snapshot;
  if (!state.inFlight) {
    state.lastAttemptAt = now;
    state.inFlight = loadCatalogModels(harnessId, force).then(models => {
      const snapshot = { updatedAt: now, models, revision: revisionFor(models) };
      persist(harnessId, snapshot);
      state.snapshot = snapshot;
      return snapshot;
    }).catch(() => state.snapshot).finally(() => { state.inFlight = null; });
  }
  return state.inFlight;
}

export function pricingRevision(harnessId?: HarnessInput): string {
  if (typeof harnessId !== 'string' || !Object.hasOwn(PRICED_HARNESSES, harnessId)) return 'native';
  if (harnessId === 'agy') {
    const overrides = loadAgyOverrides();
    return overrides.length ? `${AGY_API_RATE_CARD_REVISION}+${revisionFor(overrides)}` : AGY_API_RATE_CARD_REVISION;
  }
  const base = loadState(harnessId).snapshot?.revision || 'missing';
  // Override edits must re-price the index through the normal revision
  // mismatch, even while the harness snapshot itself is unchanged.
  const overrides = loadModelOverrides(harnessId);
  return overrides.length ? `${base}+${revisionFor(overrides)}` : base;
}

/**
 * Capture rates once for a synchronous parse/scan. Never retain the estimator
 * across operations: each new operation must revalidate models.yml and use
 * the latest catalog snapshot. Message loops then do no filesystem work.
 */
export function createUsageCostEstimator(harnessId: HarnessInput): UsageCostEstimator {
  if (typeof harnessId !== 'string' || !Object.hasOwn(PRICED_HARNESSES, harnessId)) return () => undefined;
  if (harnessId === 'agy') {
    const overrides = indexRates(loadAgyOverrides());
    const catalog = indexRates(AGY_API_RATE_CARD_LIST);
    return (provider, model, usage) => {
      const selector = typeof model === 'string' && model.includes('/') ? model : `${provider}/${model}`;
      const baseSelector = AGY_LEVEL_SUFFIX_RE.test(selector) ? selector.replace(AGY_LEVEL_SUFFIX_RE, '') : null;
      const rates = overrides?.get(selector) || catalog?.get(selector)
        || (baseSelector ? (overrides?.get(baseSelector) || catalog?.get(baseSelector)) : undefined);
      return rates ? costAtRates(harnessId, provider, model, usage, rates) : undefined;
    };
  }
  const overrides = indexRates(loadModelOverrides(harnessId));
  const catalog = indexRates(loadState(harnessId).snapshot?.models);
  return (provider, model, usage) => {
    const selector = typeof model === 'string' && model.includes('/') ? model : `${provider}/${model}`;
    const rates = overrides?.get(selector) || catalog?.get(selector);
    return rates ? costAtRates(harnessId, provider, model, usage, rates) : undefined;
  };
}

export function estimateUsageCost(harnessId: HarnessInput, provider: unknown, model: unknown, usage: unknown): UsageCost | undefined {
  return createUsageCostEstimator(harnessId)(provider, model, usage);
}

function costAtRates(harnessId: HarnessInput, provider: unknown, model: unknown, usage: unknown, rates: Rates): UsageCost | undefined {
  // Plan-provider entries deliberately use zero rates for subscription
  // access. They are not evidence that a request was free.
  const rateProvider = typeof model === 'string' && model.includes('/') ? model.split('/', 1)[0] : provider;
  if (isPlanProvider(harnessId, rateProvider) &&
      COST_KEYS.every(key => rates[key] === 0)) return undefined;
  const cost: UsageCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const key of COST_KEYS) {
    const value = record(usage) ? usage[key] : undefined;
    const tokens = finite(value) ? value : 0;
    const rate = rates[key];
    if (!finite(rate)) {
      if (tokens) return undefined;
      cost[key] = 0;
    } else cost[key] = tokens * rate / 1_000_000;
  }
  cost.total = COST_KEYS.reduce((sum, key) => sum + cost[key], 0);
  return cost;
}

export function isPlanProvider(harnessId: HarnessInput, provider: unknown): boolean {
  // Unknown callers get Pi semantics; OMP also zero-rates Kimi, Antigravity and Codex.
  const providers = (harnessId != null && Object.hasOwn(PLAN_PROVIDERS, harnessId) && PLAN_PROVIDERS[harnessId]) || ZAI_PLAN_PROVIDERS;
  return typeof provider === 'string' && Object.hasOwn(providers, provider);
}

export function resetForTests(): void { states.clear(); overridesCache.clear(); }
