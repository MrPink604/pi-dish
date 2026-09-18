// Generated test/tool from test/browser/search-view.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const payload = (name) => ({ results: [{ id: fixtures_js_1.ROOT, name, model: 'fixture/model', cwd: '/fixture/project', snippets: [name], matchCount: 0, searchScore: 5 }], total: 1 });
(0, fixtures_js_1.test)('search facets and result cards retire on replacement while live cards retain their host', async ({ page, fleet }) => {
    await page.route('**/api/search?*', route => route.fulfill({ json: payload(new URL(route.request().url()).searchParams.get('q') ?? '') }));
    await fleet.select(fleet.peer);
    await page.evaluate(() => fixtureApp.features.searchViewController.open('first'));
    await (0, fixtures_js_1.expect)(page.locator('.search-result')).toHaveCount(2);
    await page.evaluate(host => {
        window.retiredSearchCard = document.querySelector(`.search-result[data-host="${host}"]`);
        window.retiredSearchFacet = document.getElementById('searchFacetActive');
    }, fleet.self.hostId);
    await page.fill('#searchViewInput', 'second');
    await page.press('#searchViewInput', 'Enter');
    await (0, fixtures_js_1.expect)(page.locator('.search-result-name').first()).toHaveText('second');
    await (0, fixtures_js_1.expect)(page.locator('.search-result')).toHaveCount(2);
    await page.evaluate(() => { fixtureElement(window.retiredSearchCard, 'retired search card').click(); fixtureElement(window.retiredSearchFacet, 'retired search facet').click(); });
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/search-open/);
    await (0, fixtures_js_1.expect)(page.locator('#searchViewInput')).toHaveValue('second');
    await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);
    await page.locator(`.search-result[data-host="${fleet.self.hostId}"]`).click();
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
});
(0, fixtures_js_1.test)('query typing retires old failures before the next debounce runs', async ({ page, fleet }) => {
    await page.clock.install();
    const held = [];
    await page.route('**/api/search?*', route => {
        if (new URL(route.request().url()).searchParams.get('q') === 'old')
            held.push(route);
        else
            return route.fulfill({ json: payload('new result') });
    });
    await page.evaluate(() => fixtureApp.features.searchViewController.open('old'));
    await fixtures_js_1.expect.poll(() => held.length).toBe(2);
    await page.fill('#searchViewInput', 'new');
    for (const route of held)
        await route.fulfill({ status: 500, json: { error: 'old request failed' } });
    await (0, fixtures_js_1.expect)(page.locator('#searchViewBody')).not.toContainText('old request failed');
    await page.clock.runFor(350);
    // The injected failure puts the peer in backoff; the self host still answers.
    await (0, fixtures_js_1.expect)(page.locator('.search-result')).not.toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('.search-result-name').first()).toHaveText('new result');
});
(0, fixtures_js_1.test)('search disposal retires indexing, input listeners and retained facets', async ({ page, fleet }) => {
    await page.clock.install();
    let reads = 0;
    await page.route('**/api/search?*', route => { reads++; return route.fulfill({ json: { ...payload('indexed'), indexing: true } }); });
    await page.evaluate(() => fixtureApp.features.searchViewController.open('indexed'));
    await (0, fixtures_js_1.expect)(page.locator('.search-result')).toHaveCount(2);
    await page.evaluate(() => {
        window.retiredFacet = document.getElementById('searchFacetActive');
        fixtureApp.features.searchViewController.dispose();
        fixtureElement(window.retiredFacet, 'retired search facet').click();
        const input = fixtureInput(document.getElementById('searchViewInput'), '#searchViewInput');
        input.value = 'later';
        input.dispatchEvent(new Event('input'));
    });
    const before = reads;
    await page.clock.runFor(2000);
    (0, fixtures_js_1.expect)(reads).toBe(before);
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/search-open/);
});
