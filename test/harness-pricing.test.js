'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-pricing-'));
process.env.HOME = tmp;
const fixture = path.join(__dirname, 'fixtures', 'fake-omp-models.js');
process.env.PI_DISH_OMP_COMMAND = `env OMP_FIXTURE=1 ${process.execPath} ${fixture}`;

const piSDK = require('../lib/pi-sdk.js');
const pricing = require('../lib/harness-pricing.js');
const sessionFiles = require('../lib/session-files.js');

test.after(() => {
  delete process.env.PI_DISH_OMP_COMMAND;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('OMP catalog command is cached, persisted, and prices tokens including cache reads', async () => {
  const snapshot = await pricing.refreshHarnessPricing('omp', { force: true, now: 1_000_000 });
  assert.ok(snapshot);
  const cost = pricing.estimateUsageCost('omp', 'zai', 'glm-4.7-flash', {
    input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 250_000,
  });
  assert.deepEqual(cost, { input: 0.6, output: 1.1, cacheRead: 0.22, cacheWrite: 0.2, total: 2.12 });
  assert.equal(pricing.estimateUsageCost('omp', 'zai', 'unknown', { input: 10 }), undefined);
  assert.equal(pricing.estimateUsageCost('pi', 'zai', 'glm-4.7-flash', { input: 1_000_000 }), undefined,
    'Pi never reads the OMP catalog');
  assert.ok(fs.existsSync(path.join(tmp, '.pi', 'dish', 'pricing', 'omp.json')));
});

test('Pi registry rates are cached and backfill zero-cost JSONL usage', async t => {
  process.env.HOME = tmp;
  pricing.resetForTests();
  let loads = 0;
  t.mock.method(piSDK, 'getPricingModels', async () => {
    loads++;
    return [
      { provider: 'zai', id: 'glm-5.2', cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 } },
      { provider: 'zai', id: 'glm-5.3', cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    ];
  });

  const snapshot = await pricing.refreshHarnessPricing('pi', { force: true, now: 2_000_000 });
  assert.ok(snapshot);
  await pricing.refreshHarnessPricing('pi', { now: 2_000_001 });
  assert.equal(loads, 1, 'a fresh persisted rate card avoids another registry load');
  assert.ok(fs.existsSync(path.join(tmp, '.pi', 'dish', 'pricing', 'pi.json')));
  assert.deepEqual(pricing.estimateUsageCost('pi', 'zai', 'glm-5.2', {
    input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 250_000,
  }), { input: 1.4, output: 2.2, cacheRead: 0.52, cacheWrite: 0, total: 4.12 });
  assert.equal(pricing.estimateUsageCost('pi', 'zai', 'glm-5.3', { input: 1_000_000 }), undefined,
    'zero-rate ZAI subscription entries remain unpriced rather than free');

  const candidate = { harnessId: 'pi', profileId: 'pi-v1', profileVersion: 1 };
  const content = [
    { type: 'message', message: { role: 'assistant', provider: 'zai', model: 'glm-5.2', content: [], usage: {
      input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 250_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    } } },
    { type: 'message', message: { role: 'assistant', provider: 'zai', model: 'glm-5.3', content: [], usage: {
      input: 100, output: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    } } },
  ].map(JSON.stringify).join('\n') + '\n';
  const usage = sessionFiles.buildIndexedUsageFromContent(content, candidate);
  assert.equal(usage.total.costs.total, 4.12);
  assert.equal(usage.total.costUnavailable.total, 1);
  assert.equal(usage.models['zai/glm-5.3'].costs.total, 0);
  assert.equal(usage.models['zai/glm-5.3'].costUnavailable.total, 1);

  const file = path.join(tmp, 'pi-usage.jsonl');
  fs.writeFileSync(file, content);
  const messages = sessionFiles.readSessionMessages({ ...candidate, file }).filter(message => message.role === 'assistant');
  assert.equal(messages[0].usage.cost.total, 4.12);
  assert.equal(messages[1].usage.cost, undefined);
});

test('OMP catalog uses valid JSON already printed when the command times out', async t => {
  const timeoutHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-pricing-timeout-'));
  t.after(() => {
    process.env.HOME = tmp;
    pricing.resetForTests();
    fs.rmSync(timeoutHome, { recursive: true, force: true });
  });
  process.env.HOME = timeoutHome;
  pricing.resetForTests();
  t.mock.method(childProcess, 'execFile', (_file, _args, options, callback) => {
    assert.equal(options.timeout, 15_000);
    const error = new Error('Command timed out');
    error.killed = true;
    error.signal = 'SIGTERM';
    process.nextTick(() => callback(error, JSON.stringify({ models: [{
      provider: 'anthropic', id: 'claude-test', cost: { input: 1, output: 2 },
    }] }), ''));
    return {};
  });

  const snapshot = await pricing.refreshHarnessPricing('omp', { force: true });
  assert.equal(snapshot.models[0].id, 'claude-test');
  assert.equal(pricing.estimateUsageCost('omp', 'anthropic', 'claude-test', {
    input: 1_000_000, output: 1_000_000,
  }).total, 3);
});

test('stale last-known OMP catalog survives refresh failure; missing catalog stays unpriced', async () => {
  pricing.resetForTests();
  process.env.PI_DISH_OMP_COMMAND = path.join(tmp, 'missing-omp');
  const stale = await pricing.refreshHarnessPricing('omp', {
    now: 1_000_000 + pricing.CATALOG_MAX_AGE_MS + 1,
  });
  assert.ok(stale, 'a failed stale refresh retains the persisted snapshot');
  assert.ok(Number.isFinite(pricing.estimateUsageCost('omp', null, 'zai/glm-4.7-flash', { input: 10 }).total),
    'combined OMP selectors match provider/id catalog keys');

  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-pricing-missing-'));
  pricing.resetForTests();
  assert.equal(await pricing.refreshHarnessPricing('omp', { force: true }), null);
  assert.equal(pricing.estimateUsageCost('omp', 'zai', 'glm-4.7-flash', { input: 10 }), undefined);
});

test('OMP session usage is catalog-priced while unknown models remain unavailable', async () => {
  process.env.HOME = tmp;
  pricing.resetForTests();
  const candidate = { harnessId: 'omp', profileId: 'omp-v1', profileVersion: 1 };
  const content = [
    { type: 'model_change', model: 'zai/glm-4.7-flash' },
    { type: 'message', message: { role: 'assistant', content: [], usage: {
      input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 250_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    } } },
    { type: 'model_change', model: 'zai/not-in-catalog' },
    { type: 'message', message: { role: 'assistant', content: [], usage: { input: 10, output: 2 } } },
  ].map(JSON.stringify).join('\n') + '\n';
  const usage = sessionFiles.buildIndexedUsageFromContent(content, candidate);
  assert.equal(usage.models['zai/glm-4.7-flash'].costs.total, 2.12);
  assert.equal(usage.models['zai/glm-4.7-flash'].costUnavailable.total, 0);
  assert.equal(usage.models['zai/not-in-catalog'].costs.total, 0);
  assert.equal(usage.models['zai/not-in-catalog'].costUnavailable.total, 1);

  const file = path.join(tmp, 'omp-usage.jsonl');
  fs.writeFileSync(file, content);
  const source = { ...candidate, file };
  const messages = sessionFiles.readSessionMessages(source).filter(message => message.role === 'assistant');
  assert.equal(messages[0].usage.cost.total, 2.12, 'per-response details use the OMP estimate');
  assert.equal(messages[1].usage.cost, undefined, 'unknown per-response models do not become free');
  const stats = sessionFiles.getSessionStats(source);
  assert.equal(stats.cost, 2.12, 'known subtotal survives an unknown call');
  assert.equal(stats.costUnavailable.total, 1);
});

test('OMP session usage keeps recorded costs when catalog pricing is unavailable', () => {
  const missingHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-pricing-recorded-'));
  process.env.HOME = missingHome;
  pricing.resetForTests();
  try {
    const candidate = { harnessId: 'omp', profileId: 'omp-v1', profileVersion: 1 };
    const recorded = { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.04, total: 0.37 };
    const content = JSON.stringify({ type: 'message', message: {
      role: 'assistant', provider: 'anthropic', model: 'claude-recorded', content: [],
      usage: { input: 10, output: 5, cost: recorded },
    } }) + '\n';

    const usage = sessionFiles.buildIndexedUsageFromContent(content, candidate);
    assert.deepEqual(usage.total.costs, recorded);
    const file = path.join(missingHome, 'omp-recorded.jsonl');
    fs.writeFileSync(file, content);
    const messages = sessionFiles.readSessionMessages({ ...candidate, file });
    assert.deepEqual(messages[0].usage.cost, recorded);
    assert.equal(sessionFiles.getSessionStats({ ...candidate, file }).cost, recorded.total);
  } finally {
    process.env.HOME = tmp;
    pricing.resetForTests();
    fs.rmSync(missingHome, { recursive: true, force: true });
  }
});
