// Generated test/tool from test/browser/host-polls.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('a retired peer poll cannot mark the host blocked after a newer poll succeeds', async ({ page, fleet }) => {
    let releaseOld;
    const oldRequested = new Promise(resolve => { releaseOld = resolve; });
    await page.route(`${fleet.peer.base}/api/sessions?**`, route => {
        const query = new URL(route.request().url()).searchParams.get('q');
        if (query === 'old-poll') {
            if (!releaseOld)
                throw new Error('Old poll resolver not initialized');
            releaseOld(route);
            return;
        }
        if (query === 'new-poll')
            return route.fulfill({ json: {
                    active: [], previous: [{ id: fixtures_js_1.ROOT, name: 'new peer result', harnessId: 'pi' }],
                } });
        return route.continue();
    });
    await page.evaluate(() => { window.__oldHostPoll = fixtureApp.features.sidebarLists.load('old-poll', { withPrevious: true }); });
    const oldRoute = await oldRequested;
    await page.evaluate(() => fixtureApp.features.sidebarLists.load('new-poll', { withPrevious: true }));
    await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toContainText('new peer result');
    await oldRoute.fulfill({ status: 401, json: { error: 'retired request' } });
    await page.evaluate(() => window.__oldHostPoll);
    (0, fixtures_js_1.expect)(await page.evaluate(id => fixtureApp.features.hostConnections.stateOf(fixtureApp.ports.appModels.host(id)), fleet.peer.hostId)).toBe('reachable');
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sidebarLists.queriedFor)).toBe('new-poll');
    await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toContainText('new peer result');
});
