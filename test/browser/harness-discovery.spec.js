const { test, expect } = require('./fixtures');

const catalog = id => ({ harnesses: [
  { id: 'pi', label: 'Pi', available: true },
  { id, label: id, available: true },
] });

for (const failure of [false, true]) {
  test(`an older harness discovery ${failure ? 'failure' : 'response'} cannot replace a newer selection`, async ({ page, fleet }) => {
    const routes = [];
    await page.route(`${fleet.self.base}/api/harnesses`, route => routes.push(route));
    await page.evaluate(() => { window.oldDiscovery = loadHarnesses(); });
    await expect.poll(() => routes.length).toBe(1);
    await page.evaluate(() => {
      localStorage.setItem(HARNESS_KEY, 'omp');
      window.newDiscovery = loadHarnesses();
    });
    await expect.poll(() => routes.length).toBe(2);
    await routes[1].fulfill({ json: catalog('omp') });
    await page.evaluate(() => window.newDiscovery);
    await expect(page.locator('#nsHarnessSelect')).toHaveValue('omp');
    await routes[0].fulfill(failure
      ? { status: 503, json: { error: 'old discovery failed' } }
      : { json: { harnesses: [{ id: 'pi', available: true }] } });
    await page.evaluate(() => window.oldDiscovery);
    await expect(page.locator('#nsHarnessSelect')).toHaveValue('omp');
  });
}

test('harness discovery finishing after a host switch cannot overwrite that host catalog', async ({ page, fleet }) => {
  let oldRoute, peerRoute;
  await page.route(`${fleet.self.base}/api/harnesses`, route => { oldRoute = route; });
  await page.route(`${fleet.peer.base}/api/harnesses`, route => { peerRoute = route; });
  await page.evaluate(() => { window.oldDiscovery = loadHarnesses(); });
  await expect.poll(() => !!oldRoute).toBe(true);
  await page.evaluate(host => {
    onNsHostChange(host);
    localStorage.setItem(HARNESS_KEY, 'prime');
  }, fleet.peer.hostId);
  await expect.poll(() => !!peerRoute).toBe(true);
  await peerRoute.fulfill({ json: catalog('prime') });
  await expect(page.locator('#nsHarnessSelect')).toHaveValue('prime');
  await oldRoute.fulfill({ json: catalog('omp') });
  await page.evaluate(() => window.oldDiscovery);
  await expect(page.locator('#nsHarnessSelect')).toHaveValue('prime');
  expect(await page.evaluate(host => harnessRowsByHost.get(host).map(row => row.id), fleet.peer.hostId))
    .toEqual(['pi', 'prime']);
});
