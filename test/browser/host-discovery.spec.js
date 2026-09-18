// Generated test/tool from test/browser/host-discovery.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
for (const blocked of [false, true]) {
    (0, fixtures_js_1.test)(`retired host discovery ${blocked ? '401' : 'identity'} cannot overwrite a re-added host`, async ({ page, fleet }) => {
        const routes = [];
        await page.route(`${fleet.peer.base}/api/host`, route => { routes.push(route); });
        await page.evaluate(() => { window.oldIdentity = fixtureApp.features.hostDiscovery.identify(true); });
        await fixtures_js_1.expect.poll(() => routes.length).toBe(1);
        await page.evaluate(() => {
            fixtureApp.features.hostDirectory.replaceCatalog(fixtureApp.features.hostDirectory.catalog);
            window.newIdentity = fixtureApp.features.hostDiscovery.identify(true);
        });
        await fixtures_js_1.expect.poll(() => routes.length).toBe(2);
        await routes[1].fulfill({ json: { hostId: fleet.peer.hostId, label: 'Fresh descriptor', capabilities: { terminal: true } } });
        await page.evaluate(() => window.newIdentity);
        await routes[0].fulfill(blocked
            ? { status: 401, json: { error: 'retired token' } }
            : { json: { hostId: 'retired-identity', label: 'Old descriptor' } });
        await page.evaluate(() => window.oldIdentity);
        (0, fixtures_js_1.expect)(await page.evaluate(host => fixtureApp.features.hostConnections.stateOf(fixtureApp.ports.appModels.host(host)), fleet.peer.hostId)).toBe('reachable');
        (0, fixtures_js_1.expect)(await page.evaluate(host => fixtureElement(fixtureApp.features.hostDiscovery.descriptor(host), 'peer descriptor').label, fleet.peer.hostId)).toBe('Fresh descriptor');
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureElement(fixtureApp.features.hostDirectory.catalog[0], 'peer catalog entry').hostId)).toBe(fleet.peer.hostId);
    });
}
(0, fixtures_js_1.test)('saving an unchanged catalog retains pending discovery for its hosts', async ({ page, fleet }) => {
    let pendingRoute;
    await page.route(`${fleet.peer.base}/api/host`, route => { pendingRoute = route; });
    await page.evaluate(() => { window.pendingIdentity = fixtureApp.features.hostDiscovery.identify(true); });
    await fixtures_js_1.expect.poll(() => !!pendingRoute).toBe(true);
    await page.evaluate(() => fixtureApp.features.hostSettings.save());
    await (0, fixtures_js_1.requiredRoute)(pendingRoute).fulfill({ json: { hostId: fleet.peer.hostId, label: 'Discovered after save' } });
    await page.evaluate(() => window.pendingIdentity);
    (0, fixtures_js_1.expect)(await page.evaluate(host => fixtureElement(fixtureApp.features.hostDiscovery.descriptor(host), 'peer descriptor').label, fleet.peer.hostId)).toBe('Discovered after save');
});
(0, fixtures_js_1.test)('a replacement fleet request cannot release startup readiness before it finishes', async ({ page, fleet }) => {
    const routes = [];
    await page.route(`${fleet.self.base}/api/hosts`, route => { routes.push(route); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await fixtures_js_1.expect.poll(() => routes.length).toBe(1);
    await page.evaluate(() => {
        // This peer will be learned only through the fleet, not the device catalog.
        fixtureApp.features.hostDirectory.replaceCatalog([]);
        window.fleetReadyObserved = false;
        window.fleetBodiesDecoded = 0;
        fixtureApp.ports.usageController.fleetReady().then(() => { window.fleetReadyObserved = true; });
        const originalJson = Response.prototype.json;
        Response.prototype.json = async function () {
            const data = await originalJson.call(this);
            if (this.url.endsWith('/api/hosts'))
                window.fleetBodiesDecoded++;
            return data;
        };
        window.replacementFleetLoad = fixtureApp.features.hostDiscovery.loadFleet();
    });
    await fixtures_js_1.expect.poll(() => routes.length).toBe(2);
    await routes[0].fulfill({ json: { hosts: [] } });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => window.fleetBodiesDecoded)).toBe(1);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.fleetReadyObserved)).toBe(false);
    await routes[1].fulfill({ json: { hosts: [
                { self: true, hostId: fleet.self.hostId },
                { hostId: fleet.peer.hostId, base: fleet.peer.base, label: 'Fleet peer', capabilities: { terminal: true } },
            ] } });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => window.fleetReadyObserved)).toBe(true);
    (0, fixtures_js_1.expect)(await page.evaluate(host => {
        const entry = fixtureApp.ports.appModels.host(host);
        return entry && 'label' in entry ? entry.label : null;
    }, fleet.peer.hostId)).toBe('Fleet peer');
});
