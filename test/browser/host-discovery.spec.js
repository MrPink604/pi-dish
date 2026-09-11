const { test, expect } = require('./fixtures');

for (const blocked of [false, true]) {
  test(`retired host discovery ${blocked ? '401' : 'identity'} cannot overwrite a re-added host`, async ({ page, fleet }) => {
    const routes = [];
    await page.route(`${fleet.peer.base}/api/host`, route => routes.push(route));
    await page.evaluate(() => { window.oldIdentity = identifyHosts(true); });
    await expect.poll(() => routes.length).toBe(1);
    await page.evaluate(() => {
      hostCatalog = hostCatalog.map(entry => ({ ...entry }));
      invalidateHosts();
      window.newIdentity = identifyHosts(true);
    });
    await expect.poll(() => routes.length).toBe(2);
    await routes[1].fulfill({ json: { hostId: fleet.peer.hostId, label: 'Fresh descriptor', capabilities: { terminal: true } } });
    await page.evaluate(() => window.newIdentity);
    await routes[0].fulfill(blocked
      ? { status: 401, json: { error: 'retired token' } }
      : { json: { hostId: 'retired-identity', label: 'Old descriptor' } });
    await page.evaluate(() => window.oldIdentity);
    expect(await page.evaluate(host => hostState(hostEntryFor(host)), fleet.peer.hostId)).toBe('reachable');
    expect(await page.evaluate(host => hostDiscovery.descriptor(host).label, fleet.peer.hostId)).toBe('Fresh descriptor');
    expect(await page.evaluate(() => hostCatalog[0].hostId)).toBe(fleet.peer.hostId);
  });
}

test('saving an unchanged catalog retains pending discovery for its hosts', async ({ page, fleet }) => {
  let pendingRoute;
  await page.route(`${fleet.peer.base}/api/host`, route => { pendingRoute = route; });
  await page.evaluate(() => { window.pendingIdentity = identifyHosts(true); });
  await expect.poll(() => !!pendingRoute).toBe(true);
  await page.evaluate(() => saveHostCatalog());
  await pendingRoute.fulfill({ json: { hostId: fleet.peer.hostId, label: 'Discovered after save' } });
  await page.evaluate(() => window.pendingIdentity);
  expect(await page.evaluate(host => hostDiscovery.descriptor(host).label, fleet.peer.hostId)).toBe('Discovered after save');
});

test('a replacement fleet request cannot release startup readiness before it finishes', async ({ page, fleet }) => {
  const routes = [];
  await page.route(`${fleet.self.base}/api/hosts`, route => routes.push(route));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => routes.length).toBe(1);
  await page.evaluate(() => {
    // This peer will be learned only through the fleet, not the device catalog.
    hostCatalog = [];
    invalidateHosts();
    window.fleetReadyObserved = false;
    window.fleetBodiesDecoded = 0;
    hostFleetReady.then(() => { window.fleetReadyObserved = true; });
    const originalJson = Response.prototype.json;
    Response.prototype.json = async function() {
      const data = await originalJson.call(this);
      if (this.url.endsWith('/api/hosts')) window.fleetBodiesDecoded++;
      return data;
    };
    window.replacementFleetLoad = loadHostFleet();
  });
  await expect.poll(() => routes.length).toBe(2);
  await routes[0].fulfill({ json: { hosts: [] } });
  await expect.poll(() => page.evaluate(() => window.fleetBodiesDecoded)).toBe(1);
  expect(await page.evaluate(() => window.fleetReadyObserved)).toBe(false);
  await routes[1].fulfill({ json: { hosts: [
    { self: true, hostId: fleet.self.hostId },
    { hostId: fleet.peer.hostId, base: fleet.peer.base, label: 'Fleet peer', capabilities: { terminal: true } },
  ] } });
  await expect.poll(() => page.evaluate(() => window.fleetReadyObserved)).toBe(true);
  expect(await page.evaluate(host => hostEntryFor(host)?.label, fleet.peer.hostId)).toBe('Fleet peer');
});
