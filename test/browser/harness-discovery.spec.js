// Generated test/tool from test/browser/harness-discovery.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const catalog = (id) => ({ harnesses: [
        { id: 'pi', label: 'Pi', available: true },
        { id, label: id, available: true },
    ] });
for (const failure of [false, true]) {
    (0, fixtures_js_1.test)(`an older harness discovery ${failure ? 'failure' : 'response'} cannot replace a newer selection`, async ({ page, fleet }) => {
        const routes = [];
        await page.route(`${fleet.self.base}/api/harnesses`, route => { routes.push(route); });
        await page.evaluate(() => { window.oldDiscovery = fixtureApp.features.newSessionController.harnesses.load(); });
        await fixtures_js_1.expect.poll(() => routes.length).toBe(1);
        await page.evaluate(() => {
            localStorage.setItem(PiDishBrowser.NEW_SESSION_HARNESS_KEY, 'omp');
            window.newDiscovery = fixtureApp.features.newSessionController.harnesses.load();
        });
        await fixtures_js_1.expect.poll(() => routes.length).toBe(2);
        await routes[1].fulfill({ json: catalog('omp') });
        await page.evaluate(() => window.newDiscovery);
        await (0, fixtures_js_1.expect)(page.locator('#nsHarnessSelect')).toHaveValue('omp');
        await routes[0].fulfill(failure
            ? { status: 503, json: { error: 'old discovery failed' } }
            : { json: { harnesses: [{ id: 'pi', available: true }] } });
        await page.evaluate(() => window.oldDiscovery);
        await (0, fixtures_js_1.expect)(page.locator('#nsHarnessSelect')).toHaveValue('omp');
    });
}
(0, fixtures_js_1.test)('harness discovery finishing after a host switch cannot overwrite that host catalog', async ({ page, fleet }) => {
    let oldRoute, peerRoute;
    await page.route(`${fleet.self.base}/api/harnesses`, route => { oldRoute = route; });
    await page.route(`${fleet.peer.base}/api/harnesses`, route => { peerRoute = route; });
    await page.evaluate(() => { window.oldDiscovery = fixtureApp.features.newSessionController.harnesses.load(); });
    await fixtures_js_1.expect.poll(() => !!oldRoute).toBe(true);
    await page.evaluate(host => {
        fixtureApp.features.newSessionController.changeHost(host);
        localStorage.setItem(PiDishBrowser.NEW_SESSION_HARNESS_KEY, 'prime');
    }, fleet.peer.hostId);
    await fixtures_js_1.expect.poll(() => !!peerRoute).toBe(true);
    await (0, fixtures_js_1.requiredRoute)(peerRoute).fulfill({ json: catalog('prime') });
    await (0, fixtures_js_1.expect)(page.locator('#nsHarnessSelect')).toHaveValue('prime');
    await (0, fixtures_js_1.requiredRoute)(oldRoute).fulfill({ json: catalog('omp') });
    await page.evaluate(() => window.oldDiscovery);
    await (0, fixtures_js_1.expect)(page.locator('#nsHarnessSelect')).toHaveValue('prime');
    (0, fixtures_js_1.expect)(await page.evaluate(host => (fixtureApp.features.newSessionController.harnesses.cachedRows(host) ?? []).map(row => row.id), fleet.peer.hostId))
        .toEqual(['pi', 'prime']);
});
(0, fixtures_js_1.test)('malformed harness rows do not break discovery or erase valid alternatives', async ({ page, fleet }) => {
    await page.route(`${fleet.self.base}/api/harnesses`, route => route.fulfill({ json: {
            harnesses: [null, 7, {}, { id: 5 }, { id: '' },
                { id: 'pi', label: 'Pi' }, { id: 'omp', label: 'OMP', available: true }],
        } }));
    await page.evaluate(async () => {
        localStorage.setItem(PiDishBrowser.NEW_SESSION_HARNESS_KEY, 'omp');
        await fixtureApp.features.newSessionController.harnesses.load();
    });
    await (0, fixtures_js_1.expect)(page.locator('#nsHarnessSelect')).toHaveValue('omp');
    await (0, fixtures_js_1.expect)(page.locator('#nsHarnessSelect option')).toHaveText(['Pi', 'OMP']);
});
(0, fixtures_js_1.test)('a picker catalog refreshes the settings badge while an older background read is pending', async ({ page, fleet }) => {
    const routes = [];
    await page.route(`${fleet.peer.base}/api/harnesses`, route => { routes.push(route); });
    await fleet.select(fleet.peer);
    await page.evaluate(host => {
        window.fixtureSessionListPatch(fixtureCurrentSession().id, { harnessId: 'omp' });
        fixtureApp.features.sessionHeader.update();
        window.backgroundDiscovery = fixtureApp.features.newSessionController.harnesses.ensure(host);
        fixtureApp.features.newSessionController.setHostId(host);
        window.pickerDiscovery = fixtureApp.features.newSessionController.harnesses.load();
    }, fleet.peer.hostId);
    await fixtures_js_1.expect.poll(() => routes.length).toBe(2);
    await (0, fixtures_js_1.expect)(page.locator('#sessionHarness')).not.toHaveClass(/clickable/);
    await routes[1].fulfill({ json: { harnesses: [{ id: 'omp', label: 'OMP', pilotConfig: true }] } });
    await page.evaluate(() => window.pickerDiscovery);
    await (0, fixtures_js_1.expect)(page.locator('#sessionHarness')).toHaveClass(/clickable/);
    await routes[0].fulfill({ json: { harnesses: [{ id: 'omp', pilotConfig: false }] } });
    await page.evaluate(() => window.backgroundDiscovery);
    (0, fixtures_js_1.expect)(await page.evaluate(host => fixtureElement(fixtureApp.features.newSessionController.harnesses.row(host, 'omp'), 'OMP harness row').pilotConfig, fleet.peer.hostId)).toBe(true);
    await (0, fixtures_js_1.expect)(page.locator('#sessionHarness')).toHaveClass(/clickable/);
});
