import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { getHarness } from './harnesses';
import { runHarnessModelCatalog } from './harness-feature-commands';
import * as YAML from 'yaml';
import { getPricingModels } from './pi-sdk';
import { finite, record } from './helper-values';

// Catalog refreshes are opportunistic. A snapshot older than six hours is
// refreshed on the next pricing-backed request, but remains the last-known
// source if the harness is offline or the command fails.
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
  // External catalogs historically accept truthy identities; matching stringifies
  // them rather than imposing the SDK registry's stricter identity contract.
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
const PRICED_HARNESSES: Readonly<Record<string, true>> = { pi: true, omp: true };
// Subscription-backed providers whose catalogs deliberately carry zero rates
// because there is no per-request price to calculate (ZAI Coding Plan, Kimi
// for Coding, Antigravity, ChatGPT-backed openai-codex). A zero-rate entry
// for one of these is unpriced, never evidence that the usage was free —
// unlike genuinely free tiers (opencode-zen community models), which keep
// their authoritative $0.
const ZAI_PLAN_PROVIDERS: Readonly<Record<string, true>> = { zai: true, 'zai-coding-cn': true };
const PLAN_PROVIDERS: Readonly<Record<string, Readonly<Record<string, true>> | undefined>> = {
  pi: ZAI_PLAN_PROVIDERS,
  omp: { ...ZAI_PLAN_PROVIDERS, 'kimi-code': true, 'google-antigravity': true, 'openai-codex': true },
};
const states = new Map<string, PricingState>();

// OMP's models.yml modelOverrides are the user's rate card for
// subscription-backed providers. OMP itself merges them into its catalog but
// drops override-only ids (renamed or dead models), so pi-dish reads the file
// directly: user entries win over catalog rows and revive ids the catalog no
// longer carries. Revalidated by mtime, size, ctime, device and inode.
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
  return path.join(os.homedir(), '.pi', 'dish', 'pricing', `${harnessId}.json`);
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
  const file = catalogFile(harnessId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ updatedAt: snapshot.updatedAt, models: snapshot.models }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
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

export async function refreshHarnessPricing(harnessId = 'omp', { force = false, now = Date.now() }: PricingRefreshOptions = {}): Promise<PricingSnapshot | null> {
  if (!Object.hasOwn(PRICED_HARNESSES, harnessId)) return null;
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
  // Unknown and candidate-less callers keep the legacy Pi semantics; only OMP
  // diverges (its catalog also zero-rates Kimi, Antigravity and Codex).
  const providers = (harnessId != null && Object.hasOwn(PLAN_PROVIDERS, harnessId) && PLAN_PROVIDERS[harnessId]) || ZAI_PLAN_PROVIDERS;
  return typeof provider === 'string' && Object.hasOwn(providers, provider);
}

export function resetForTests(): void { states.clear(); overridesCache.clear(); }
