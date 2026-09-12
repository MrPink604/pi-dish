const { test, expect, ROOT } = require('./fixtures');

test('a retired peer poll cannot mark the host blocked after a newer poll succeeds', async ({ page, fleet }) => {
  let releaseOld;
  const oldRequested = new Promise(resolve => { releaseOld = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions?**`, route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'old-poll') { releaseOld(route); return; }
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
