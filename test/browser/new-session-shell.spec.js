// Generated test/tool from test/browser/new-session-shell.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('workspace buttons retain their owning host and are retired on host change or close', async ({ page, fleet }) => {
    await page.evaluate(() => fixtureApp.features.newSessionController.open({ cwd: '/initial' }));
    await (0, fixtures_js_1.expect)(page.locator('#nsWorkspaces button')).not.toHaveCount(0);
    await page.evaluate(() => { window.oldWorkspaceButton = document.querySelector('#nsWorkspaces button'); });
    await page.selectOption('#nsHostSelect', fleet.peer.hostId);
    await page.fill('#newSessionCwd', '/peer-manual');
    await page.evaluate(() => fixtureElement(window.oldWorkspaceButton, 'old workspace button').click());
    await (0, fixtures_js_1.expect)(page.locator('#newSessionCwd')).toHaveValue('/peer-manual');
    await page.evaluate(() => { window.peerWorkspaceButton = document.querySelector('#nsWorkspaces button'); fixtureApp.features.newSessionController.close(); });
    await page.evaluate(() => fixtureElement(window.peerWorkspaceButton, 'peer workspace button').click());
    await (0, fixtures_js_1.expect)(page.locator('#newSessionCwd')).toHaveValue('/peer-manual');
});
(0, fixtures_js_1.test)('disposing the form retires late harness results, debounce callbacks and input listeners', async ({ page, fleet }) => {
    const reads = [];
    let modelReads = 0;
    await page.clock.install();
    await page.route('**/api/harnesses', route => { reads.push(route); });
    await page.route('**/api/models*', route => { modelReads++; return route.continue(); });
    await page.evaluate(() => fixtureApp.features.newSessionController.open({ cwd: '/dispose' }));
    await fixtures_js_1.expect.poll(() => reads.length).toBe(1);
    await page.evaluate(() => {
        window.disposedHarnessRead = fixtureApp.features.newSessionController.harnesses.load();
    });
    // Only the latest explicit load may settle, matching discovery sequence ownership.
    await fixtures_js_1.expect.poll(() => reads.length).toBe(2);
    const beforeModels = modelReads;
    const before = await page.locator('#nsHarnessSelect').innerHTML();
    await page.evaluate(() => {
        fixtureApp.features.newSessionController.scheduleRefresh();
        fixtureApp.features.newSessionController.dispose();
        fixtureApp.features.newSessionController.open({ cwd: '/must-not-open' });
    });
    for (const read of reads)
        await read.fulfill({ json: { harnesses: [{ id: 'new-harness', available: true }] } });
    await page.evaluate(() => window.disposedHarnessRead);
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/new-session-open/);
    (0, fixtures_js_1.expect)(await page.locator('#nsHarnessSelect').innerHTML()).toBe(before);
    await page.evaluate(() => {
        const cwd = fixtureInput(document.getElementById('newSessionCwd'), '#newSessionCwd');
        cwd.dispatchEvent(new Event('focus'));
        cwd.dispatchEvent(new Event('input'));
    });
    await page.clock.runFor(1000);
    (0, fixtures_js_1.expect)(modelReads).toBe(beforeModels);
    await (0, fixtures_js_1.expect)(page.locator('#cwdDropdown')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#newSessionCwd')).toHaveValue('/dispose');
});
(0, fixtures_js_1.test)('a closed-form view token stops owning asynchronous work after disposal', async ({ page, fleet }) => {
    const owns = await page.evaluate(() => {
        fixtureApp.features.newSessionController.close();
        const owns = fixtureApp.features.newSessionController.captureView();
        const before = owns();
        const message = fixtureElement(document.getElementById('nsError'), "document.getElementById('nsError')").textContent;
        fixtureApp.features.newSessionController.dispose();
        fixtureApp.features.newSessionController.error('must-not-write');
        return { before, after: owns(), message, current: fixtureElement(document.getElementById('nsError'), "document.getElementById('nsError')").textContent };
    });
    (0, fixtures_js_1.expect)(owns.before).toBe(true);
    (0, fixtures_js_1.expect)(owns.after).toBe(false);
    (0, fixtures_js_1.expect)(owns.current).toBe(owns.message);
});
