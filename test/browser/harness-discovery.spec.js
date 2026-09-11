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
  expect(await page.evaluate(host => harnessDiscovery.cachedRows(host).map(row => row.id), fleet.peer.hostId))
    .toEqual(['pi', 'prime']);
});

test('malformed harness rows do not break discovery or erase valid alternatives', async ({ page, fleet }) => {
  await page.route(`${fleet.self.base}/api/harnesses`, route => route.fulfill({ json: {
    harnesses: [null, 7, {}, { id: 5 }, { id: '' },
      { id: 'pi', label: 'Pi' }, { id: 'omp', label: 'OMP', available: true }],
  } }));
  await page.evaluate(async () => {
    localStorage.setItem(HARNESS_KEY, 'omp');
    await loadHarnesses();
  });
  await expect(page.locator('#nsHarnessSelect')).toHaveValue('omp');
  await expect(page.locator('#nsHarnessSelect option')).toHaveText(['Pi', 'OMP']);
});

test('a picker catalog refreshes the settings badge while an older background read is pending', async ({ page, fleet }) => {
  const routes = [];
  await page.route(`${fleet.peer.base}/api/harnesses`, route => routes.push(route));
  await fleet.select(fleet.peer);
  await page.evaluate(host => {
    sessionState.mergeCurrentSession(sessionState.captureSelection(), { harnessId: 'omp' });
    updateSessionHeader();
    window.backgroundDiscovery = harnessDiscovery.ensure(host);
    newSessionHostId = host;
    window.pickerDiscovery = loadHarnesses();
  }, fleet.peer.hostId);
  await expect.poll(() => routes.length).toBe(2);
  await expect(page.locator('#sessionHarness')).not.toHaveClass(/clickable/);
  await routes[1].fulfill({ json: { harnesses: [{ id: 'omp', label: 'OMP', pilotConfig: true }] } });
  await page.evaluate(() => window.pickerDiscovery);
  await expect(page.locator('#sessionHarness')).toHaveClass(/clickable/);
  await routes[0].fulfill({ json: { harnesses: [{ id: 'omp', pilotConfig: false }] } });
  await page.evaluate(() => window.backgroundDiscovery);
  expect(await page.evaluate(host => harnessRow(host, 'omp').pilotConfig, fleet.peer.hostId)).toBe(true);
  await expect(page.locator('#sessionHarness')).toHaveClass(/clickable/);
});
