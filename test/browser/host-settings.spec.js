// Generated test/tool from test/browser/host-settings.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const fixtures_js_1 = require("./fixtures.js");
async function openForm(page, base, label = '') {
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await page.locator('#addHostBase').fill(base);
    await page.locator('#addHostLabel').fill(label);
}
for (const outcome of ['success', '401']) {
    (0, fixtures_js_1.test)(`closing settings retires a pending add-host ${outcome}`, async ({ page, fleet }) => {
        let held;
        await page.route(`${fleet.self.base}/hosts/retired/api/host`, route => { held = route; });
        await openForm(page, '/hosts/retired');
        await page.evaluate(() => { window.pendingAdd = fixtureApp.features.hostSettings.addFromForm(); });
        await fixtures_js_1.expect.poll(() => !!held).toBe(true);
        await page.evaluate(() => { fixtureApp.ports.appBindings.actions.closeSettingsModal(new Event('click'), document.body); fixtureApp.features.displayPreferences.open(); });
        await page.locator('#addHostBase').fill('/hosts/new-form');
        await (0, fixtures_js_1.requiredRoute)(held).fulfill(outcome === '401' ? { status: 401, json: {} }
            : { json: { hostId: 'retired-host', label: 'Retired' } });
        await page.evaluate(() => window.pendingAdd);
        await (0, fixtures_js_1.expect)(page.locator('#addHostBase')).toHaveValue('/hosts/new-form');
        await (0, fixtures_js_1.expect)(page.locator('#addHostStatus')).toHaveText('');
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.hostDirectory.catalog.some(host => host.hostId === 'retired-host'))).toBe(false);
    });
}
(0, fixtures_js_1.test)('only the newest add-host attempt can publish its descriptor and catalog row', async ({ page, fleet }) => {
    const held = [];
    await page.route(`${fleet.peer.base}/api/host`, route => {
        if (route.request().headers().authorization === 'Bearer add-check-fixture')
            held.push(route);
        else
            return route.continue();
    });
    await openForm(page, fleet.peer.base, 'Older label');
    await page.locator('#addHostToken').fill('add-check-fixture');
    await page.evaluate(() => { window.oldAdd = fixtureApp.features.hostSettings.addFromForm(); });
    await fixtures_js_1.expect.poll(() => held.length).toBe(1);
    await page.locator('#addHostLabel').fill('Current label');
    await page.evaluate(() => { window.newAdd = fixtureApp.features.hostSettings.addFromForm(); });
    await fixtures_js_1.expect.poll(() => held.length).toBe(2);
    await held[1].fulfill({ json: { hostId: fleet.peer.hostId, label: 'Current descriptor' } });
    await page.evaluate(() => window.newAdd);
    await held[0].fulfill({ json: { hostId: fleet.peer.hostId, label: 'Retired descriptor' } });
    await page.evaluate(() => window.oldAdd);
    await (0, fixtures_js_1.expect)(page.locator('#addHostStatus')).toHaveText('Added Current label.');
    (0, fixtures_js_1.expect)(await page.evaluate(id => fixtureApp.features.hostDirectory.catalog.find(host => host.hostId === id)?.label, fleet.peer.hostId)).toBe('Current label');
    (0, fixtures_js_1.expect)(await page.evaluate(id => fixtureApp.features.hostDiscovery.descriptor(id)?.label, fleet.peer.hostId)).toBe('Current descriptor');
});
(0, fixtures_js_1.test)('editing the form retires an already received descriptor body', async ({ page, fleet }) => {
    await page.route(`${fleet.self.base}/hosts/edit/api/host`, route => route.fulfill({ json: { hostId: 'retired-body' } }));
    await openForm(page, '/hosts/edit');
    await page.evaluate(() => {
        const original = Response.prototype.json;
        Response.prototype.json = async function () {
            const data = await original.call(this);
            if (this.url.endsWith('/hosts/edit/api/host')) {
                window.hostBodyWaiting = true;
                await new Promise(resolve => { window.releaseHostBody = resolve; });
            }
            return data;
        };
        window.pendingAdd = fixtureApp.features.hostSettings.addFromForm();
    });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => window.hostBodyWaiting)).toBe(true);
    await page.locator('#addHostLabel').fill('Edited while checking');
    await page.evaluate(() => window.releaseHostBody());
    await page.evaluate(() => window.pendingAdd);
    await (0, fixtures_js_1.expect)(page.locator('#addHostLabel')).toHaveValue('Edited while checking');
    await (0, fixtures_js_1.expect)(page.locator('#addHostStatus')).toHaveText('');
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.hostDirectory.catalog.some(host => host.hostId === 'retired-body'))).toBe(false);
});
(0, fixtures_js_1.test)('add-host controls validate a URL and persist the captured label and token', async ({ page, fleet }) => {
    await openForm(page, 'not-a-url');
    await page.locator('#addHostBtn').click();
    await (0, fixtures_js_1.expect)(page.locator('#addHostStatus')).toHaveText('That is not a usable host URL.');
    const requests = [];
    await page.route(`${fleet.peer.base}/api/host`, route => {
        if (route.request().headers().authorization !== 'Bearer fixture-token')
            return route.continue();
        requests.push(route.request().headers().authorization);
        return route.fulfill({ json: { hostId: fleet.peer.hostId, label: 'Server label' } });
    });
    await page.locator('#addHostBase').fill(fleet.peer.base + '/');
    await page.locator('#addHostLabel').fill(' Custom label ');
    await page.locator('#addHostToken').fill(' fixture-token ');
    await page.locator('#addHostBase').press('Enter');
    await (0, fixtures_js_1.expect)(page.locator('#addHostStatus')).toHaveText('Added Custom label.');
    (0, fixtures_js_1.expect)(requests[0]).toBe('Bearer fixture-token');
    const catalog = await page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-hosts') ?? '[]'));
    if (!Array.isArray(catalog))
        throw new Error('Invalid stored host catalog');
    (0, fixtures_js_1.expect)(catalog.find(host => (0, wire_protocol_js_1.isRecord)(host) && host.hostId === fleet.peer.hostId)).toEqual({ base: fleet.peer.base,
        hostId: fleet.peer.hostId, label: 'Custom label', token: 'fixture-token' });
    await (0, fixtures_js_1.expect)(page.locator('#addHostToken')).toHaveValue('');
});
