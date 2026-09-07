'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const { getHarness, resolveLaunchSpec } = require('./harnesses');
const YAML = require('yaml');
const piSDK = require('./pi-sdk');

// Catalog refreshes are opportunistic. A snapshot older than six hours is
// refreshed on the next pricing-backed request, but remains the last-known
// source if the harness is offline or the command fails.
const CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FAILED_REFRESH_RETRY_MS = 5 * 60 * 1000;
const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const PRICED_HARNESSES = new Set(['pi', 'omp']);
// Subscription-backed providers whose catalogs deliberately carry zero rates
// because there is no per-request price to calculate (ZAI Coding Plan, Kimi
// for Coding, Antigravity, ChatGPT-backed openai-codex). A zero-rate entry
// for one of these is unpriced, never evidence that the usage was free —
// unlike genuinely free tiers (opencode-zen community models), which keep
// their authoritative $0.
const ZAI_PLAN_PROVIDERS = new Set(['zai', 'zai-coding-cn']);
const PLAN_PROVIDERS = {
  pi: ZAI_PLAN_PROVIDERS,
  omp: new Set([...ZAI_PLAN_PROVIDERS, 'kimi-code', 'google-antigravity', 'openai-codex']),
};
const states = new Map();

// OMP's models.yml modelOverrides are the user's rate card for
// subscription-backed providers. OMP itself merges them into its catalog but
// drops override-only ids (renamed or dead models), so pi-dish reads the file
// directly: user entries win over catalog rows and revive ids the catalog no
// longer carries. Cached on (mtimeMs, size) like the other session readers.
const MODEL_OVERRIDES_FILE = { omp: path.join('.omp', 'agent', 'models.yml') };
const overridesCache = new Map();

function loadModelOverrides(harnessId) {
  const rel = MODEL_OVERRIDES_FILE[harnessId];
  if (!rel) return [];
  const file = path.join(os.homedir(), rel);
  let stats;
  try { stats = fs.statSync(file); } catch { return []; }
  const cached = overridesCache.get(file);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.entries;
  let entries = [];
  try {
    const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
    for (const [provider, section] of Object.entries(doc?.providers || {})) {
      for (const [id, override] of Object.entries(section?.modelOverrides || {})) {
        const source = override?.cost;
        if (!source || !Number.isFinite(source.input) || !Number.isFinite(source.output)) continue;
        const cost = {};
        for (const key of COST_KEYS) if (Number.isFinite(source[key])) cost[key] = source[key];
        entries.push({ provider, id, cost });
      }
    }
  } catch { entries = []; } // a broken config must not break pricing
  overridesCache.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, entries });
  return entries;
}

function catalogFile(harnessId) {
  return path.join(os.homedir(), '.pi', 'dish', 'pricing', `${harnessId}.json`);
}

function normalizeCatalog(raw) {
  const rows = Array.isArray(raw) ? raw : raw?.models;
  if (!Array.isArray(rows)) return null;
  const models = [];
  for (const model of rows) {
    const provider = model?.provider;
    const id = model?.id || model?.modelId;
    const source = model?.cost || model?.pricing;
    if (!provider || !id || !source || !Number.isFinite(source.input) || !Number.isFinite(source.output)) continue;
    const cost = {};
    for (const key of COST_KEYS) if (Number.isFinite(source[key])) cost[key] = source[key];
    models.push({ provider, id, cost });
  }
  return models.length ? models : null;
}

function revisionFor(models) {
  return crypto.createHash('sha256').update(JSON.stringify(models)).digest('hex').slice(0, 16);
}

function loadState(harnessId) {
  const file = catalogFile(harnessId);
  const cached = states.get(file);
  if (cached) return cached;
  let snapshot = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const models = normalizeCatalog(raw.models);
    if (models) snapshot = { updatedAt: Number(raw.updatedAt) || 0, models, revision: revisionFor(models) };
  } catch {}
  const state = { snapshot, inFlight: null, lastAttemptAt: 0 };
  states.set(file, state);
  return state;
}

function persist(harnessId, snapshot) {
  const file = catalogFile(harnessId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ updatedAt: snapshot.updatedAt, models: snapshot.models }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function runCatalogCommand(harnessId) {
  const descriptor = getHarness(harnessId);
  if (!descriptor?.argv?.models?.length) return Promise.reject(new Error(`Harness ${harnessId} has no model catalog command`));
  const spec = resolveLaunchSpec(descriptor);
  return new Promise((resolve, reject) => {
    childProcess.execFile(spec.argv[0], [...spec.argv.slice(1), ...descriptor.argv.models], {
      env: { ...process.env, ...spec.env }, timeout: 15_000, maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      // Some OMP versions print the complete catalog but keep an event-loop
      // handle open. execFile then kills the process at the timeout; that is
      // still a successful catalog response when stdout is complete.
      if (error && !error.killed) return reject(new Error(String(stderr || error.message).trim()));
      let raw;
      try { raw = JSON.parse(stdout.trim() || 'null'); }
      catch (e) { return reject(new Error(`Could not parse ${descriptor.label} model catalog: ${e.message}`)); }
      const models = normalizeCatalog(raw);
      if (!models) return reject(new Error(`${descriptor.label} model catalog contained no priced models`));
      resolve(models);
    });
  });
}

function loadCatalogModels(harnessId) {
  if (harnessId === 'pi') {
    return piSDK.getPricingModels().then(raw => {
      const models = normalizeCatalog(raw);
      if (!models) throw new Error('Pi model registry contained no priced models');
      return models;
    });
  }
  return runCatalogCommand(harnessId);
}

async function refreshHarnessPricing(harnessId = 'omp', { force = false, now = Date.now() } = {}) {
  if (!PRICED_HARNESSES.has(harnessId)) return null;
  const state = loadState(harnessId);
  if (!force && state.snapshot && now - state.snapshot.updatedAt < CATALOG_MAX_AGE_MS) return state.snapshot;
  if (!force && now - state.lastAttemptAt < FAILED_REFRESH_RETRY_MS) return state.snapshot;
  if (!state.inFlight) {
    state.lastAttemptAt = now;
    state.inFlight = loadCatalogModels(harnessId).then(models => {
      const snapshot = { updatedAt: now, models, revision: revisionFor(models) };
      persist(harnessId, snapshot);
      state.snapshot = snapshot;
      return snapshot;
    }).catch(() => state.snapshot).finally(() => { state.inFlight = null; });
  }
  return state.inFlight;
}

function pricingRevision(harnessId) {
  if (!PRICED_HARNESSES.has(harnessId)) return 'native';
  const base = loadState(harnessId).snapshot?.revision || 'missing';
  // Override edits must re-price the index through the normal revision
  // mismatch, even while the harness snapshot itself is unchanged.
  const overrides = loadModelOverrides(harnessId);
  return overrides.length ? `${base}+${revisionFor(overrides)}` : base;
}

function catalogCost(harnessId, provider, model) {
  if (!PRICED_HARNESSES.has(harnessId)) return null;
  const selector = typeof model === 'string' && model.includes('/') ? model : `${provider}/${model}`;
  const match = item => `${item.provider}/${item.id}` === selector;
  const override = loadModelOverrides(harnessId).find(match);
  if (override) return override.cost;
  const row = loadState(harnessId).snapshot?.models.find(match);
  return row?.cost || null;
}

function estimateUsageCost(harnessId, provider, model, usage) {
  const rates = catalogCost(harnessId, provider, model);
  if (!rates) return undefined;
  // Plan-provider entries deliberately use zero rates for subscription
  // access. They are not evidence that a request was free.
  const rateProvider = typeof model === 'string' && model.includes('/') ? model.split('/', 1)[0] : provider;
  if (isPlanProvider(harnessId, rateProvider) &&
      COST_KEYS.every(key => rates[key] === 0)) return undefined;
  const cost = {};
  for (const key of COST_KEYS) {
    const tokens = Number.isFinite(usage?.[key]) ? usage[key] : 0;
    if (!Number.isFinite(rates[key])) {
      if (tokens) return undefined;
      cost[key] = 0;
    } else cost[key] = tokens * rates[key] / 1_000_000;
  }
  cost.total = COST_KEYS.reduce((sum, key) => sum + cost[key], 0);
  return cost;
}

function isPlanProvider(harnessId, provider) {
  // Unknown and candidate-less callers keep the legacy Pi semantics; only OMP
  // diverges (its catalog also zero-rates Kimi, Antigravity and Codex).
  return (PLAN_PROVIDERS[harnessId] || PLAN_PROVIDERS.pi).has(provider);
}

function resetForTests() { states.clear(); overridesCache.clear(); }

module.exports = {
  CATALOG_MAX_AGE_MS,
  refreshHarnessPricing,
  pricingRevision,
  estimateUsageCost,
  isPlanProvider,
  resetForTests,
};
