// Generated test/tool from test/browser/fleet-view.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const health = (platform, live = 0) => ({
    sampledAt: '2026-09-26T00:00:00.000Z', uptimeSec: 3 * 3600, platform, arch: 'x64',
    cpu: { cores: 8, model: 'fixture', utilization: 0.42, windowMs: 10_000, load: [1.5, 1.25, 1] },
    memory: { totalBytes: 16 * 1024 ** 3, availableBytes: 4 * 1024 ** 3 },
    disk: { path: '~', totalBytes: 100 * 1024 ** 3, availableBytes: 5 * 1024 ** 3 },
    sessions: { live, working: 0, waiting: 0, subagents: 0, byHarness: {} },
});
const openFleet = (page) => page.evaluate(() => fixtureApp.features.fleetController.open());
const peerCard = (page) => page.locator('.fleet-host').filter({ hasText: 'peer' });
(0, fixtures_js_1.test)('opening Fleet renders one card per host with its own capacity meters', async ({ page, fleet }) => {
    const reads = [];
    page.on('request', request => { if (request.url().endsWith('/api/host/health'))
        reads.push(new URL(request.url()).origin); });
    await openFleet(page);
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/fleet-open/);
    await (0, fixtures_js_1.expect)(page.locator('#fleetHosts .fleet-host')).toHaveCount(2);
    for (const card of await page.locator('#fleetHosts .fleet-host').all()) {
        await (0, fixtures_js_1.expect)(card.locator('.fleet-meter')).toHaveCount(3);
        await (0, fixtures_js_1.expect)(card.locator('.fleet-meter[role="meter"]').first()).toHaveAttribute('aria-label', 'CPU');
        await (0, fixtures_js_1.expect)(card.locator('.fleet-sessions')).toContainText('live');
    }
    await (0, fixtures_js_1.expect)(page.locator('.fleet-host').filter({ hasText: 'this server' })).toHaveCount(1);
    // Each host answers for itself: one read per capable host per open.
    (0, fixtures_js_1.expect)(reads.sort()).toEqual([fleet.self.base, fleet.peer.base].sort());
    // Fleet-wide controls moved out of Settings and live below the cards.
    await (0, fixtures_js_1.expect)(page.locator('#fleetConnections #addHostBase')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#fleetView #openBounceAgents')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#fleetView #recoveryPreferences #recoveryMode')).toBeAttached();
});
(0, fixtures_js_1.test)('a held health response retires with its view and cannot overwrite the reopened view', async ({ page, fleet }) => {
    const held = [];
    await page.route(`${fleet.peer.base}/api/host/health`, route => { held.push(route); });
    await openFleet(page);
    await fixtures_js_1.expect.poll(() => held.length).toBe(1);
    await (0, fixtures_js_1.expect)(peerCard(page)).toContainText('Loading');
    await page.evaluate(() => fixtureApp.ports.appBindings.actions.closeFleetView(new Event('click'), document.body));
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/fleet-open/);
    await openFleet(page);
    await fixtures_js_1.expect.poll(() => held.length).toBe(2);
    await held[1].fulfill({ json: health('current-os', 7) });
    await (0, fixtures_js_1.expect)(peerCard(page)).toContainText('current-os');
    await (0, fixtures_js_1.expect)(peerCard(page).locator('.fleet-sessions')).toContainText('7 live');
    const retired = page.waitForEvent('requestfinished', request => request === held[0].request());
    await (0, fixtures_js_1.requiredRoute)(held[0]).fulfill({ json: health('retired-os', 99) });
    await retired;
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
    await (0, fixtures_js_1.expect)(peerCard(page)).toContainText('current-os');
    await (0, fixtures_js_1.expect)(peerCard(page)).not.toContainText('retired-os');
    await (0, fixtures_js_1.expect)(peerCard(page).locator('.fleet-sessions')).not.toContainText('99');
});
(0, fixtures_js_1.test)('a response arriving after close does not render and polling stops with the view', async ({ page, fleet }) => {
    await page.clock.install();
    const held = [];
    let selfReads = 0;
    await page.route(`${fleet.peer.base}/api/host/health`, route => { held.push(route); });
    await page.route(`${fleet.self.base}/api/host/health`, route => { selfReads++; return route.fulfill({ json: health('self-os') }); });
    await openFleet(page);
    await fixtures_js_1.expect.poll(() => held.length).toBe(1);
    await (0, fixtures_js_1.expect)(page.locator('.fleet-host').filter({ hasText: 'this server' })).toContainText('self-os');
    await page.keyboard.press('Escape');
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/fleet-open/);
    const retired = page.waitForEvent('requestfinished', request => request === held[0].request());
    await (0, fixtures_js_1.requiredRoute)(held[0]).fulfill({ json: health('late-os') });
    await retired;
    await (0, fixtures_js_1.expect)(page.locator('#fleetHosts')).not.toContainText('late-os');
    const readsAtClose = selfReads;
    await page.clock.runFor(35_000);
    (0, fixtures_js_1.expect)(selfReads).toBe(readsAtClose);
    (0, fixtures_js_1.expect)(held).toHaveLength(1);
});
(0, fixtures_js_1.test)('an open Fleet view polls each host while visible', async ({ page, fleet }) => {
    await page.clock.install();
    let peerReads = 0, selfReads = 0;
    await page.route(`${fleet.peer.base}/api/host/health`, route => { peerReads++; return route.fulfill({ json: health(`peer-os-${peerReads}`) }); });
    await page.route(`${fleet.self.base}/api/host/health`, route => { selfReads++; return route.fulfill({ json: health(`self-os-${selfReads}`) }); });
    await openFleet(page);
    // The next poll is scheduled once every host of this load has settled.
    await (0, fixtures_js_1.expect)(peerCard(page)).toContainText('peer-os-1');
    await (0, fixtures_js_1.expect)(page.locator('.fleet-host').filter({ hasText: 'this server' })).toContainText('self-os-1');
    await page.clock.runFor(10_500);
    await (0, fixtures_js_1.expect)(peerCard(page)).toContainText('peer-os-2');
    await (0, fixtures_js_1.expect)(page.locator('.fleet-host').filter({ hasText: 'this server' })).toContainText('self-os-2');
    (0, fixtures_js_1.expect)([peerReads, selfReads]).toEqual([2, 2]);
    await page.evaluate(() => fixtureApp.features.fleetController.close());
    await page.clock.runFor(35_000);
    (0, fixtures_js_1.expect)([peerReads, selfReads]).toEqual([2, 2]);
});
(0, fixtures_js_1.test)('Settings links to Fleet, which replaces the modal, and Escape closes Fleet', async ({ page, fleet }) => {
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await (0, fixtures_js_1.expect)(page.locator('#settingsModal')).toBeVisible();
    // Fleet-wide controls no longer render inside the Settings modal.
    await (0, fixtures_js_1.expect)(page.locator('#settingsModal #addHostBase')).toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('#settingsModal #bounceView')).toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('#settingsModal #recoveryPreferences')).toHaveCount(0);
    await page.locator('#settingsOpenFleet').click();
    await (0, fixtures_js_1.expect)(page.locator('#settingsModal')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/fleet-open/);
    await (0, fixtures_js_1.expect)(page.locator('#fleetHosts .fleet-host')).toHaveCount(2);
    await page.locator('body').press('Escape');
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/fleet-open/);
    await page.locator('#btnFleet').click();
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/fleet-open/);
});
