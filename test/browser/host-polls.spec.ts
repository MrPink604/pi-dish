import type { Route } from '@playwright/test';
import { test, expect, ROOT } from './fixtures.js';

test('a retired peer poll cannot mark the host blocked after a newer poll succeeds', async ({ page, fleet }) => {
  let releaseOld: ((route: Route) => void) | undefined;
  const oldRequested = new Promise<Route>(resolve => { releaseOld = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions?**`, route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'old-poll') {
      if (!releaseOld) throw new Error('Old poll resolver not initialized');
      releaseOld(route); return;
    }
    if (query === 'new-poll') return route.fulfill({ json: {
      active: [], previous: [{ id: ROOT, name: 'new peer result', harnessId: 'pi' }],
    } });
    return route.continue();
  });
  await page.evaluate(() => { window.__oldHostPoll = fixtureApp.features.sidebarLists.load('old-poll', { withPrevious: true }); });
  const oldRoute = await oldRequested;
  await page.evaluate(() => fixtureApp.features.sidebarLists.load('new-poll', { withPrevious: true }));
  await expect(fleet.row(fleet.peer)).toContainText('new peer result');
  await oldRoute.fulfill({ status: 401, json: { error: 'retired request' } });
  await page.evaluate(() => window.__oldHostPoll);
  expect(await page.evaluate(id => fixtureApp.features.hostConnections.stateOf(fixtureApp.ports.appModels.host(id)), fleet.peer.hostId)).toBe('reachable');
  expect(await page.evaluate(() => fixtureApp.features.sidebarLists.queriedFor)).toBe('new-poll');
  await expect(fleet.row(fleet.peer)).toContainText('new peer result');
});

export {};
