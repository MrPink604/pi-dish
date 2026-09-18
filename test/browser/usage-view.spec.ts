import type { Page, Route } from '@playwright/test';
import type { UsageHost } from '../../src/browser/usage-view.js';
import { test, expect, ROOT, requiredRoute } from './fixtures.js';
const bucket = { calls: 2, tokens: { input: 20, output: 10 }, costs: { total: 0.5, input: 0.3, output: 0.2 } };
const summary = (range = '30', indexing = false) => ({ range, indexing, totals: bucket, groups: {
  models: [{ ...bucket, key: 'fixture/model', provider: 'fixture', model: 'model' }],
  sessions: [{ ...bucket, id: ROOT, name: 'Shared usage session', workspace: '/fixture/project' }], workspaces: [],
}, daily: ['2026-09-08', '2026-09-09'].map(day => ({ ...bucket, day, models: [{ ref: 'fixture/model', model: 'model', cost: 0.5, calls: 2 }] })) });
const limits = (label: string) => ({ harnesses: [{ harness: 'omp', reports: [{ provider: label, limits: [{ label: 'Weekly', usedFraction: 0.25 }] }] }] });

async function mockSummary(page: Page, indexing = false) {
  await page.route('**/api/usage-summary?*', (route: Route) => route.fulfill({ json: summary(new URL(route.request().url()).searchParams.get('days') ?? undefined, indexing) }));
}

test('usage late limits cannot enter the new range after their response body settles', async ({ page, fleet }) => {
  await mockSummary(page);
  await page.evaluate(() => {
    window.limitReads = 0;
    const original = fixtureApp.features.usageController;
    original.dispose();
    const source = fixtureElement(fixtureApp.ports.hostDiscovery.hosts()[0], 'usage host');
    const host: UsageHost = Object.freeze({
      base: source.base, token: source.token, hostId: source.hostId,
      label: typeof source.label === 'string' ? source.label : null,
      name: typeof source.name === 'string' ? source.name : null,
      self: source.self === true, capabilities: { usageLimits: true },
    });
    window.testUsage = PiDishBrowser.createUsageView({ root: fixtureElement(document.querySelector<HTMLElement>('.main'), '.main'), storage: localStorage,
      hosts: () => [host], host: () => host, fleetReady: async () => {}, multiHost: () => false,
      connection: () => {}, closeOtherViews: () => {}, selectSession: async () => {},
      request: async (endpoint, url, options) => {
        if (!url.startsWith('/api/usage-limits')) return fixtureApp.features.apiTransport.request(endpoint, url, options);
        window.limitReads++;
        if (window.limitReads === 1) {
          const response = new Response('{}', { status: 200 });
          Object.defineProperty(response, 'json', { value: () => new Promise<unknown>(resolve => { window.finishOldLimits = resolve; }) });
          return response;
        }
        return new Response(JSON.stringify({ harnesses: [{ reports: [{ provider: 'new-provider', limits: [{ label: 'Weekly', usedFraction: 0.25 }] }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    window.testUsage.open();
  });
  await expect(page.locator('.usage-kpis')).toBeVisible();
  await page.locator('[data-range="7"]').click();
  await expect(page.locator('#usageViewBody')).toContainText('new-provider');
  await page.evaluate(payload => window.finishOldLimits(payload), limits('old-provider'));
  await expect(page.locator('#usageViewBody')).not.toContainText('old-provider');
  await expect(page.locator('[data-range="7"]')).toHaveClass(/active/);
});

test('usage partial rows navigate to the peer that answered despite a same-id self session', async ({ page, fleet }) => {
  let pending: Route | undefined;
  await page.route('**/api/usage-summary?*', route => {
    if (new URL(route.request().url()).origin === fleet.self.base) { pending = route; return; }
    return route.fulfill({ json: summary() });
  });
  await fleet.select(fleet.self);
  await page.evaluate(() => fixtureApp.features.usageController.open());
  await expect(page.locator('.usage-row[data-session-id]')).toHaveCount(1);
  await expect(page.locator('.usage-row[data-session-id]')).toHaveAttribute('data-session-host', fleet.peer.hostId);
  await page.locator('.usage-row[data-session-id]').click();
  await expect(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);
  await requiredRoute(pending).fulfill({ json: summary() });
  await expect(page.locator('.main')).not.toHaveClass(/usage-open/);
});

test('usage replaced chart and model actions retire along with closed session rows', async ({ page, fleet }) => {
  await mockSummary(page);
  await page.evaluate(() => fixtureApp.features.usageController.open());
  await expect(page.locator('#usageChart .usage-col')).toHaveCount(2);
  await page.evaluate(() => {
    window.oldUsageBar = document.querySelector<HTMLElement>('#usageChart .usage-col');
    window.oldUsageModel = document.querySelector<HTMLElement>('[data-model-ref]');
  });
  await page.locator('[data-stack="buckets"]').click();
  await page.evaluate(() => {
    fixtureElement(window.oldUsageBar, 'old usage bar').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixtureElement(window.oldUsageModel, 'old usage model').click();
  });
  await expect(page.locator('.usage-day-detail')).toHaveCount(0);
  await expect(page.locator('.usage-filter-note')).toHaveCount(0);
  await page.locator('#usageChart .usage-col').first().click();
  await expect(page.locator('.usage-day-detail')).toBeVisible();
  await page.evaluate(() => {
    window.oldDayClose = document.querySelector<HTMLElement>('[data-close-day]');
    window.oldUsageSession = document.querySelector<HTMLElement>('.usage-row[data-session-id]');
    fixtureApp.features.usageController.close();
    fixtureElement(window.oldDayClose, 'old day close').click(); fixtureElement(window.oldUsageSession, 'old usage session').click();
  });
  await expect(page.locator('.main')).not.toHaveClass(/usage-open/);
  await expect(page.locator('.session-item.active')).toHaveCount(0);
});

test('usage disposal stops indexing, resize and retained controls', async ({ page, fleet }) => {
  await page.clock.install();
  let reads = 0;
  await page.route('**/api/usage-summary?*', route => { reads++; return route.fulfill({ json: summary('30', true) }); });
  await page.evaluate(() => fixtureApp.features.usageController.open());
  await expect(page.locator('.usage-kpis')).toBeVisible();
  await page.evaluate(() => {
    window.oldRange = document.querySelector<HTMLElement>('[data-range="all"]');
    window.dispatchEvent(new Event('resize'));
    fixtureApp.features.usageController.dispose(); fixtureElement(window.oldRange, 'old usage range').click();
    window.dispatchEvent(new Event('resize'));
  });
  const before = reads;
  await page.clock.runFor(2000);
  expect(reads).toBe(before);
  await expect(page.locator('.main')).not.toHaveClass(/usage-open/);
  await expect(page.locator('#usageTooltip')).toHaveCount(0);
});

export {};
