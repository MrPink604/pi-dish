// Generated test/tool from test/browser/session-info.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const pages = (label) => [{ token: 'shared-page', root: '/fixture/plan.html', path: '/p/shared-page', title: label + ' plan', createdAt: Date.now() }];
async function setup(page, fleet) {
    await page.route('**/api/sessions/*/stats', (route) => route.fulfill({ json: { model: new URL(route.request().url()).origin === fleet.self.base ? 'Self model' : 'Peer model', cwd: '/fixture/project', hardCacheMisses: 3, costs: { total: 0.5 } } }));
    await page.route('**/api/pages?*', (route) => route.fulfill({ json: pages(new URL(route.request().url()).origin === fleet.self.base ? 'Self' : 'Peer') }));
    await page.route('**/api/sessions/*/share', (route) => route.request().method() === 'GET'
        ? route.fulfill({ status: 404, json: { error: 'No share' } }) : route.fulfill({ json: { url: 'https://fixture.invalid/shared' } }));
    await page.evaluate(() => { window.infoCopies = []; navigator.clipboard.writeText = async (text) => { window.infoCopies.push(text); }; });
}
(0, fixtures_js_1.test)('stats controls from an earlier opening cannot copy publish revoke or close', async ({ page, fleet }) => {
    await setup(page, fleet);
    await fleet.select(fleet.self);
    await page.evaluate(() => window.fixtureSessionListPatch(fixtureCurrentSession().id, { isActive: true, capabilities: { close: true, export: true } }, fixtureCurrentSession().host));
    let writes = 0, dialogs = 0;
    page.on('dialog', async (dialog) => { dialogs++; await dialog.accept(); });
    await page.route('**/api/**', route => { if (route.request().method() !== 'GET')
        writes++; return route.fallback(); });
    await page.evaluate(() => fixtureApp.features.sessionInfo.openStats());
    await (0, fixtures_js_1.expect)(page.locator('#statsPages .stats-page-row')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('#statsBody')).toContainText('3 hard misses');
    await (0, fixtures_js_1.expect)(page.locator('#sessionCloseBtn')).toBeVisible();
    await page.evaluate(() => {
        window.oldInfoControls = [
            fixtureElement(document.getElementById('shareCreateBtn'), '#shareCreateBtn'),
            fixtureElement(document.querySelector('.stats-page-revoke'), '.stats-page-revoke'),
            fixtureElement(document.querySelector('.stats-copy'), '.stats-copy'),
            fixtureElement(document.getElementById('sessionCloseBtn'), '#sessionCloseBtn'),
        ];
        fixtureApp.features.sessionInfo.closeStats();
        fixtureApp.features.sessionInfo.openStats();
    });
    await (0, fixtures_js_1.expect)(page.locator('#shareCreateBtn')).toBeVisible();
    await page.evaluate(() => window.oldInfoControls.forEach(button => button.click()));
    (0, fixtures_js_1.expect)(writes).toBe(0);
    (0, fixtures_js_1.expect)(dialogs).toBe(0);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.infoCopies)).toEqual([]);
    await page.locator('#shareCreateBtn').click();
    await (0, fixtures_js_1.expect)(page.locator('#statsShare .stats-share-link')).toBeVisible();
    (0, fixtures_js_1.expect)(writes).toBe(1);
});
(0, fixtures_js_1.test)('a late existing share response cannot overwrite the clipboard after changing hosts', async ({ page, fleet }) => {
    await setup(page, fleet);
    await fleet.select(fleet.peer);
    let held;
    await page.route(fleet.peer.base + `/api/sessions/${fixtures_js_1.ROOT}/share`, route => { held = route; });
    await page.evaluate(() => { const button = document.createElement('button'); button.dataset.entryId = 'entry'; window.shareCopy = fixtureApp.features.sessionInfo.copyMessage(button); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { url: 'https://fixture.invalid/old-peer' } });
    await page.evaluate(() => window.shareCopy);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.infoCopies)).toEqual([]);
});
(0, fixtures_js_1.test)('share and page mutation failures keep live controls and report the server error', async ({ page, fleet }) => {
    await setup(page, fleet);
    await fleet.select(fleet.self);
    await page.route(fleet.self.base + `/api/sessions/${fixtures_js_1.ROOT}/share`, route => route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: { error: 'share rejected' } }) : route.fallback());
    await page.route('**/api/pages/shared-page', route => route.fulfill({ status: 500, json: { error: 'page rejected' } }));
    await page.evaluate(() => fixtureApp.features.sessionInfo.openStats());
    await page.locator('#shareCreateBtn').click();
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('share rejected');
    await (0, fixtures_js_1.expect)(page.locator('#shareCreateBtn')).toBeEnabled();
    await (0, fixtures_js_1.expect)(page.locator('#statsShare .stats-share-link')).toHaveCount(0);
    await page.locator('.stats-page-revoke').click();
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('page rejected');
    await (0, fixtures_js_1.expect)(page.locator('.stats-page-revoke')).toBeEnabled();
    await (0, fixtures_js_1.expect)(page.locator('.stats-page-row')).toHaveCount(1);
});
(0, fixtures_js_1.test)('artifact controls retire on close and live same-token revokes use their answering host', async ({ page, fleet }) => {
    await setup(page, fleet);
    await fleet.select(fleet.self);
    const writes = [];
    await page.route('**/api/pages/shared-page', route => { writes.push(new URL(route.request().url()).origin); return route.fulfill({ json: { ok: true } }); });
    await page.evaluate(() => fixtureApp.features.sessionInfo.openArtifacts());
    await (0, fixtures_js_1.expect)(page.locator('#artifactsBody')).toContainText('Self plan');
    await page.evaluate(() => {
        window.oldArtifacts = [...document.querySelectorAll('#artifactsBody button')];
        fixtureApp.features.sessionInfo.closeArtifacts();
        window.oldArtifacts.forEach(button => button.click());
    });
    (0, fixtures_js_1.expect)(writes).toEqual([]);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.infoCopies)).toEqual([]);
    await fleet.select(fleet.peer);
    await page.evaluate(() => fixtureApp.features.sessionInfo.openArtifacts());
    await (0, fixtures_js_1.expect)(page.locator('#artifactsBody')).toContainText('Peer plan');
    await page.locator('.artifact-revoke').click();
    await fixtures_js_1.expect.poll(() => writes.length).toBe(1);
    (0, fixtures_js_1.expect)(writes).toEqual([fleet.peer.base]);
});
(0, fixtures_js_1.test)('session-info disposal ignores held stats and artifact reads and retained copy timers', async ({ page, fleet }) => {
    await page.clock.install();
    await setup(page, fleet);
    await fleet.select(fleet.self);
    await page.evaluate(() => fixtureApp.features.sessionInfo.openStats());
    await (0, fixtures_js_1.expect)(page.locator('.stats-table')).toBeVisible();
    await page.locator('.stats-copy').first().click();
    await (0, fixtures_js_1.expect)(page.locator('.stats-copy').first()).toHaveClass(/copied/);
    let stats;
    const artifacts = [];
    await page.route('**/api/sessions/*/stats', route => { stats = route; });
    await page.route('**/api/pages?*', route => { artifacts.push(route); });
    await page.evaluate(() => { fixtureApp.features.sessionInfo.openStats(); fixtureApp.features.sessionInfo.openArtifacts(); });
    await fixtures_js_1.expect.poll(() => !!stats && artifacts.length > 0).toBe(true);
    await page.evaluate(() => { fixtureApp.features.sessionInfo.dispose(); window.disposedInfoBody = fixtureElement(document.getElementById('statsBody'), "document.getElementById('statsBody')").innerHTML; });
    await (0, fixtures_js_1.requiredRoute)(stats).fulfill({ json: { model: 'Late stats' } });
    for (const route of artifacts)
        await route.fulfill({ json: pages('Late') });
    await page.clock.runFor(2000);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureElement(document.getElementById('statsBody'), "document.getElementById('statsBody')").innerHTML)).toBe(await page.evaluate(() => window.disposedInfoBody));
    await (0, fixtures_js_1.expect)(page.locator('#statsModal')).not.toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#artifactsModal')).not.toBeVisible();
});
