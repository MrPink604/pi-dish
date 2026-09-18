// Generated test/tool from test/browser/main-pane.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const takeoverNames = ['usage', 'search', 'subagents', 'newSession', 'skills', 'routines', 'recovery'];
const clearingTakeovers = ['recovery', 'subagents'];
async function openTakeover(page, name) {
    await page.evaluate(async (name) => {
        const features = fixtureApp.features;
        if (name === 'subagents') {
            await features.sessionRelationsController.load(features.sessionState.captureSelection());
            fixtureElement(document.querySelector('.session-relation-tree-link'), '.session-relation-tree-link').click();
        }
        else {
            const controllers = { usage: features.usageController, search: features.searchViewController,
                newSession: features.newSessionController, skills: features.skillsController,
                routines: features.routinesController, recovery: features.recoveryController };
            controllers[name].open();
        }
    }, name);
}
const takeovers = { usage: 'usage-open', search: 'search-open', subagents: 'subagents-open',
    newSession: 'new-session-open', skills: 'skills-open', routines: 'routines-open', recovery: 'recovery-open' };
(0, fixtures_js_1.test)('every takeover excludes each other takeover without retiring its own opened surface', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    for (const from of takeoverNames) {
        for (const to of takeoverNames) {
            const className = takeovers[to];
            await openTakeover(page, from);
            await openTakeover(page, to);
            (0, fixtures_js_1.expect)(await page.locator('.main').evaluate((main, classes) => classes.filter(name => main.classList.contains(name)), Object.values(takeovers))).toEqual([className]);
        }
    }
});
(0, fixtures_js_1.test)('ordinary takeovers retain file and settings while recovery and subagents retire them and late file bodies', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    let held;
    await page.route('**/api/sessions/*/file?*', route => { held = route; });
    for (const clearing of clearingTakeovers) {
        held = null;
        await page.evaluate(() => { window.openingFile = fixtureApp.features.fileViews.openFile('held.txt'); });
        await fixtures_js_1.expect.poll(() => !!held).toBe(true);
        await page.evaluate(() => fixtureApp.features.displayPreferences.open());
        await openTakeover(page, 'usage');
        await (0, fixtures_js_1.expect)(page.locator('#settingsModal')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#sessionView')).toHaveClass(/file-open/);
        await openTakeover(page, clearing);
        await (0, fixtures_js_1.expect)(page.locator('#settingsModal')).toBeHidden();
        await (0, fixtures_js_1.expect)(page.locator('#sessionView')).not.toHaveClass(/file-open|diff-open/);
        await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { path: '/fixture/held.txt', relPath: 'held.txt', content: 'retired file body', size: 17, mtime: 1 } });
        await page.evaluate(() => window.openingFile);
        await (0, fixtures_js_1.expect)(page.locator('#fileViewBody')).not.toContainText('retired file body');
    }
});
(0, fixtures_js_1.test)('Bounce can retain settings across owned selection while ordinary selection collapses only Bounce', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.route('**/api/session-bounces/preview?*', route => route.fulfill({ json: { targets: [] } }));
    await page.route('**/api/session-bounces', route => route.fulfill({ json: { operations: [] } }));
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await page.locator('#openBounceAgents').click();
    await (0, fixtures_js_1.expect)(page.locator('#bounceMode')).toBeVisible();
    await page.evaluate(({ id, host }) => fixtureApp.features.sessionView.select(id, { host, keepBounceView: true }), { id: fixtures_js_1.ROOT, host: fleet.peer.hostId });
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('peer root transcript');
    await (0, fixtures_js_1.expect)(page.locator('#bounceMode')).toBeVisible();
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    await (0, fixtures_js_1.expect)(page.locator('#settingsModal')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#bounceMode')).toBeHidden();
});
