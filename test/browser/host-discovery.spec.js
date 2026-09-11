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
