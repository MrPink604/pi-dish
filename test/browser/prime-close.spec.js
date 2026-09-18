// Generated test/tool from test/browser/prime-close.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const fixtures_js_1 = require("./fixtures.js");
async function configureSession(page, fleet, mode, close = true, restart = false) {
    await fleet.select(fleet.peer);
    await page.evaluate(({ id, host, mode, close, restart }) => window.fixtureSessionListPatch(id, {
        isActive: true,
        // The same harness has different close semantics on old and new hosts.
        harnessId: 'prime',
        closeMode: mode,
        capabilities: { close, restart, export: false },
    }, host), { id: fixtures_js_1.ROOT, host: fleet.peer.hostId, mode, close, restart });
}
// The context readout lives in the composer, which an inactive session
// hides behind the resume bar; that bar carries its own stats button.
const statsButton = (page) => page.locator('#inactiveStatsBtn:visible, #sessionContext:visible').first();
async function openStats(page) {
    await statsButton(page).click();
    await (0, fixtures_js_1.expect)(page.locator('#statsModal')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#statsClose')).toBeVisible();
}
(0, fixtures_js_1.test)('Prime owned-agent close warns about the agent family and stays on its owning peer', async ({ page, fleet }) => {
    await configureSession(page, fleet, 'owned-agent');
    const close = fleet.row(fleet.peer).locator('.session-close-btn');
    await (0, fixtures_js_1.expect)(close).toHaveAttribute('title', 'Stop this agent and its children (transcript stays resumable)');
    await close.click();
    await (0, fixtures_js_1.expect)(close).toHaveText('close?');
    await (0, fixtures_js_1.expect)(close).toHaveAttribute('title', 'Tap again: Stop this agent and its children (transcript stays resumable)');
    await openStats(page);
    await (0, fixtures_js_1.expect)(page.locator('#statsClose')).toContainText('Close session');
    await (0, fixtures_js_1.expect)(page.locator('#statsClose')).toContainText('Stops this agent and its children, then closes its pi-dish-owned client pane. The transcript stays resumable.');
    await (0, fixtures_js_1.expect)(page.locator('#sessionRestartBtn')).toHaveCount(0);
    const artifact = path.resolve(__dirname, '../../.amp/in/artifacts/prime-close.png');
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    await page.locator('#statsClose').scrollIntoViewIfNeeded();
    await page.screenshot({ path: artifact });
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/close`, (route) => {
        if (!receive)
            throw new Error('Prime close route resolver not initialized');
        receive(route);
    });
    const warning = new Promise(resolve => page.once('dialog', async (dialog) => {
        resolve(dialog.message());
        await dialog.accept();
    }));
    await page.locator('#sessionCloseBtn').click();
    (0, fixtures_js_1.expect)(await warning).toBe('Stop this agent and its children? Any work in progress will be aborted; the transcript stays resumable.');
    const route = await received;
    (0, fixtures_js_1.expect)(route.request().method()).toBe('POST');
    await fleet.select(fleet.self);
    await route.fulfill({ json: { success: true } });
    await (0, fixtures_js_1.expect)(page.locator('#statsModal')).toBeHidden();
    await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureCurrentSession().host)).toBe(fleet.self.hostId);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
});
(0, fixtures_js_1.test)('Prime restart warns about children and keeps the response bound to the owning host', async ({ page, fleet }) => {
    await configureSession(page, fleet, 'owned-agent', true, true);
    await openStats(page);
    await (0, fixtures_js_1.expect)(page.locator('#sessionRestartBtn')).toHaveText('Restart agent');
    await (0, fixtures_js_1.expect)(page.locator('#statsClose')).toContainText('resumes the root in the same pane');
    await (0, fixtures_js_1.expect)(page.locator('#statsClose')).toContainText('other root agents keep running');
    const artifact = path.resolve(__dirname, '../../.amp/in/artifacts/prime-restart.png');
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    await page.locator('#statsClose').scrollIntoViewIfNeeded();
    await page.screenshot({ path: artifact });
    await page.setViewportSize({ width: 390, height: 844 });
    await fixtures_js_1.expect.poll(() => page.locator('#sidebar').evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await page.locator('#statsClose').scrollIntoViewIfNeeded();
    await (0, fixtures_js_1.expect)(page.locator('#sessionRestartBtn')).toBeInViewport();
    await (0, fixtures_js_1.expect)(page.locator('#sessionCloseBtn')).toBeInViewport();
    await page.screenshot({ path: path.join(path.dirname(artifact), 'prime-restart-mobile.png') });
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/restart`, (route) => {
        if (!receive)
            throw new Error('Prime restart route resolver not initialized');
        receive(route);
    });
    const warning = new Promise(resolve => page.once('dialog', async (dialog) => {
        resolve(dialog.message());
        await dialog.accept();
    }));
    await page.locator('#sessionRestartBtn').click();
    (0, fixtures_js_1.expect)(await warning).toBe('Restart this agent? This stops the root and its children, aborting any work in progress, then resumes the root in the same pane. The transcript is kept; other root agents keep running.');
    const route = await received;
    (0, fixtures_js_1.expect)(route.request().method()).toBe('POST');
    await (0, fixtures_js_1.expect)(page.locator('#sessionRestartBtn')).toBeDisabled();
    await (0, fixtures_js_1.expect)(page.locator('#sessionCloseBtn')).toBeDisabled();
    await fleet.select(fleet.self);
    await route.fulfill({ json: { success: true, id: fixtures_js_1.ROOT } });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureCurrentSession().host)).toBe(fleet.self.hostId);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
});
(0, fixtures_js_1.test)('older client-only Prime session retains detach wording', async ({ page, fleet }) => {
    await configureSession(page, fleet, 'client-only');
    const close = fleet.row(fleet.peer).locator('.session-close-btn');
    await (0, fixtures_js_1.expect)(close).toHaveAttribute('title', 'Detach client');
    await close.click();
    await (0, fixtures_js_1.expect)(close).toHaveText('detach?');
    await (0, fixtures_js_1.expect)(close).toHaveAttribute('title', 'Tap again: Detach client');
    await openStats(page);
    await (0, fixtures_js_1.expect)(page.locator('#sessionCloseBtn')).toHaveText('Detach client');
    await (0, fixtures_js_1.expect)(page.locator('#statsClose')).toContainText('Disconnects this client. The logical agent continues independently.');
    await (0, fixtures_js_1.expect)(page.locator('#sessionRestartBtn')).toHaveCount(0);
});
(0, fixtures_js_1.test)('unowned session with close capability disabled exposes no close control', async ({ page, fleet }) => {
    await configureSession(page, fleet, 'owned-agent', false);
    await (0, fixtures_js_1.expect)(fleet.row(fleet.peer).locator('.session-close-btn')).toHaveCount(0);
    await statsButton(page).click();
    await (0, fixtures_js_1.expect)(page.locator('#statsModal')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#statsClose')).toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('#sessionCloseBtn')).toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('#sessionRestartBtn')).toHaveCount(0);
});
