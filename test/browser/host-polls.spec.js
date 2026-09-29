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
(0, fixtures_js_1.test)('saved peer restoration does not wait for a slow local list', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    const held = [];
    await page.route(`${fleet.self.base}/api/sessions?**`, route => { held.push(route); });
    try {
        await page.reload();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('peer root transcript');
    }
    finally {
        await page.unroute(`${fleet.self.base}/api/sessions?**`);
        await Promise.all(held.map(route => route.continue().catch(() => { })));
    }
});
(0, fixtures_js_1.test)('startup restores the local saved transcript while peer identity and lists are held', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const held = [];
    await page.route(`${fleet.peer.base}/api/host`, route => { held.push(route); });
    await page.route(`${fleet.peer.base}/api/sessions?**`, route => { held.push(route); });
    try {
        await page.reload();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
        (0, fixtures_js_1.expect)(held.length).toBeGreaterThan(0);
    }
    finally {
        await page.unroute(`${fleet.peer.base}/api/host`);
        await page.unroute(`${fleet.peer.base}/api/sessions?**`);
        await Promise.all(held.map(route => route.continue().catch(() => { })));
    }
});
(0, fixtures_js_1.test)('healthy search results finish locally while the pending peer stays identified', async ({ page, fleet }) => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route(`${fleet.peer.base}/api/sessions?**`, route => {
        if (new URL(route.request().url()).searchParams.get('q') === 'root') {
            release?.(route);
            return;
        }
        return route.continue();
    });
    await page.locator('#filterInput').fill('root');
    const peerRequest = await held;
    try {
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('.sidebar-filter')).not.toHaveClass(/\bsearching\b/);
        await (0, fixtures_js_1.expect)(page.locator('.sidebar-host-progress')).toContainText('peer');
        const listTop = await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top);
        // A periodic refresh joins the pending search without retiring its progress.
        await page.evaluate(() => { void fixtureApp.features.sidebarLists.refresh(); });
        await (0, fixtures_js_1.expect)(page.locator('.sidebar-host-progress')).toContainText('peer');
        await peerRequest.fulfill({ json: { active: [], previous: [{ id: fixtures_js_1.ROOT, name: 'late peer root', harnessId: 'pi' }] } });
        await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toContainText('late peer root');
        await (0, fixtures_js_1.expect)(page.locator('.sidebar-host-progress')).toBeHidden();
        (0, fixtures_js_1.expect)(await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top)).toBe(listTop);
    }
    finally {
        await page.unroute(`${fleet.peer.base}/api/sessions?**`);
        await peerRequest.abort().catch(() => { });
    }
});
(0, fixtures_js_1.test)('background polling leaves cached rows and sidebar geometry undisturbed', async ({ page, fleet }) => {
    await (0, fixtures_js_1.expect)(page.locator('.sidebar-host-progress')).toBeHidden();
    const listTop = await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top);
    const selfRow = await fleet.row(fleet.self).elementHandle();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route(`${fleet.peer.base}/api/sessions?**`, route => { release?.(route); });
    await page.evaluate(() => { void fixtureApp.features.sidebarLists.refresh(); });
    const peerRequest = await held;
    try {
        await (0, fixtures_js_1.expect)(page.locator('.sidebar-host-progress')).toBeHidden();
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toBeVisible();
        await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toBeVisible();
        (0, fixtures_js_1.expect)(await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top)).toBe(listTop);
        await peerRequest.fulfill({ json: { active: [], previous: [{ id: fixtures_js_1.ROOT, name: 'refreshed peer root', harnessId: 'pi' }] } });
        await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toContainText('refreshed peer root');
        await (0, fixtures_js_1.expect)(page.locator('.sidebar-host-progress')).toBeHidden();
        (0, fixtures_js_1.expect)(await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top)).toBe(listTop);
        (0, fixtures_js_1.expect)(await selfRow?.evaluate(node => node.isConnected)).toBe(true);
    }
    finally {
        await page.unroute(`${fleet.peer.base}/api/sessions?**`);
        await peerRequest.abort().catch(() => { });
        await selfRow?.dispose();
    }
});
(0, fixtures_js_1.test)('an unchanged poll repaints nothing in the session list', async ({ page, fleet }) => {
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toBeVisible();
    const mutations = await page.evaluate(async () => {
        const list = document.getElementById('sessionList');
        if (!list)
            throw new Error('Missing session list');
        const refresh = async () => {
            await fixtureApp.features.sidebarLists.refresh();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        };
        await refresh(); // settle indexing and host health so the observed poll is a true repeat
        let count = 0;
        const observer = new MutationObserver(records => { count += records.length; });
        observer.observe(list, { childList: true, subtree: true, characterData: true, attributes: true });
        await refresh();
        observer.disconnect();
        return count;
    });
    (0, fixtures_js_1.expect)(mutations).toBe(0);
});
(0, fixtures_js_1.test)('background polling stops while the document is hidden and resumes on return', async ({ page, fleet }) => {
    // Speed the 10s sidebar poll up so the pause/resume is observable without a
    // real wait; no other timer in the app runs on that period.
    await page.addInitScript(() => {
        const realSetInterval = window.setInterval.bind(window);
        window.setInterval = ((handler, timeout, ...args) => realSetInterval(handler, timeout === 10000 ? 200 : timeout, ...args));
    });
    await page.reload();
    const polls = [];
    await page.route(`${fleet.self.base}/api/sessions?**`, route => { polls.push(route.request().url()); return route.continue(); });
    await fixtures_js_1.expect.poll(() => polls.length).toBeGreaterThan(1);
    // The page-reported visibility is a DOM-backed flag so the app's own getter
    // and listener stay the only code path exercised.
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true,
            get: () => document.documentElement.hasAttribute('data-fixture-hidden') });
    });
    const setHidden = (value) => page.evaluate(visible => {
        document.documentElement.toggleAttribute('data-fixture-hidden', visible);
        document.dispatchEvent(new Event('visibilitychange'));
    }, value);
    await setHidden(true);
    await page.waitForTimeout(200);
    const paused = polls.length;
    await page.waitForTimeout(800);
    (0, fixtures_js_1.expect)(polls.length).toBe(paused);
    await setHidden(false);
    await fixtures_js_1.expect.poll(() => polls.length).toBeGreaterThan(paused);
});
