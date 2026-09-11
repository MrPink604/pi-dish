const { test, expect } = require('./fixtures');

async function openForm(page, base, label = '') {
  await page.evaluate(() => openSettingsModal());
  await page.locator('#addHostBase').fill(base);
  await page.locator('#addHostLabel').fill(label);
}

for (const outcome of ['success', '401']) {
  test(`closing settings retires a pending add-host ${outcome}`, async ({ page, fleet }) => {
    let held;
    await page.route(`${fleet.self.base}/hosts/retired/api/host`, route => { held = route; });
    await openForm(page, '/hosts/retired');
    await page.evaluate(() => { window.pendingAdd = hostSettings.addFromForm(); });
    await expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => { closeSettingsModal(); openSettingsModal(); });
    await page.locator('#addHostBase').fill('/hosts/new-form');
    await held.fulfill(outcome === '401' ? { status: 401, json: {} }
      : { json: { hostId: 'retired-host', label: 'Retired' } });
    await page.evaluate(() => window.pendingAdd);
    await expect(page.locator('#addHostBase')).toHaveValue('/hosts/new-form');
    await expect(page.locator('#addHostStatus')).toHaveText('');
    expect(await page.evaluate(() => hostDirectory.catalog.some(host => host.hostId === 'retired-host'))).toBe(false);
  });
}

test('only the newest add-host attempt can publish its descriptor and catalog row', async ({ page, fleet }) => {
  const held = [];
  await page.route(`${fleet.peer.base}/api/host`, route => {
    if (route.request().headers().authorization === 'Bearer add-check-fixture') held.push(route);
    else return route.continue();
  });
  await openForm(page, fleet.peer.base, 'Older label');
  await page.locator('#addHostToken').fill('add-check-fixture');
  await page.evaluate(() => { window.oldAdd = hostSettings.addFromForm(); });
  await expect.poll(() => held.length).toBe(1);
  await page.locator('#addHostLabel').fill('Current label');
  await page.evaluate(() => { window.newAdd = hostSettings.addFromForm(); });
  await expect.poll(() => held.length).toBe(2);
  await held[1].fulfill({ json: { hostId: fleet.peer.hostId, label: 'Current descriptor' } });
  await page.evaluate(() => window.newAdd);
  await held[0].fulfill({ json: { hostId: fleet.peer.hostId, label: 'Retired descriptor' } });
  await page.evaluate(() => window.oldAdd);
  await expect(page.locator('#addHostStatus')).toHaveText('Added Current label.');
  expect(await page.evaluate(id => hostDirectory.catalog.find(host => host.hostId === id)?.label, fleet.peer.hostId)).toBe('Current label');
  expect(await page.evaluate(id => hostDiscovery.descriptor(id)?.label, fleet.peer.hostId)).toBe('Current descriptor');
});

test('editing the form retires an already received descriptor body', async ({ page, fleet }) => {
  await page.route(`${fleet.self.base}/hosts/edit/api/host`, route => route.fulfill({ json: { hostId: 'retired-body' } }));
  await openForm(page, '/hosts/edit');
  await page.evaluate(() => {
    const original = Response.prototype.json;
    Response.prototype.json = async function() {
      const data = await original.call(this);
      if (this.url.endsWith('/hosts/edit/api/host')) {
        window.hostBodyWaiting = true;
        await new Promise(resolve => { window.releaseHostBody = resolve; });
      }
      return data;
    };
    window.pendingAdd = hostSettings.addFromForm();
  });
  await expect.poll(() => page.evaluate(() => window.hostBodyWaiting)).toBe(true);
  await page.locator('#addHostLabel').fill('Edited while checking');
  await page.evaluate(() => window.releaseHostBody());
  await page.evaluate(() => window.pendingAdd);
  await expect(page.locator('#addHostLabel')).toHaveValue('Edited while checking');
  await expect(page.locator('#addHostStatus')).toHaveText('');
  expect(await page.evaluate(() => hostDirectory.catalog.some(host => host.hostId === 'retired-body'))).toBe(false);
});

test('add-host controls validate a URL and persist the captured label and token', async ({ page, fleet }) => {
  await openForm(page, 'not-a-url');
  await page.locator('#addHostBtn').click();
  await expect(page.locator('#addHostStatus')).toHaveText('That is not a usable host URL.');
  const requests = [];
  await page.route(`${fleet.peer.base}/api/host`, route => {
    if (route.request().headers().authorization !== 'Bearer fixture-token') return route.continue();
    requests.push(route.request().headers().authorization);
    return route.fulfill({ json: { hostId: fleet.peer.hostId, label: 'Server label' } });
  });
  await page.locator('#addHostBase').fill(fleet.peer.base + '/');
  await page.locator('#addHostLabel').fill(' Custom label ');
  await page.locator('#addHostToken').fill(' fixture-token ');
  await page.locator('#addHostBase').press('Enter');
  await expect(page.locator('#addHostStatus')).toHaveText('Added Custom label.');
  expect(requests[0]).toBe('Bearer fixture-token');
  const catalog = await page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-hosts')));
  expect(catalog.find(host => host.hostId === fleet.peer.hostId)).toEqual({ base: fleet.peer.base,
    hostId: fleet.peer.hostId, label: 'Custom label', token: 'fixture-token' });
  await expect(page.locator('#addHostToken')).toHaveValue('');
});
