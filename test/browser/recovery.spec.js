// Generated test/tool from test/browser/recovery.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const report = (name, mode = 'restore') => ({ mode, sessions: [{ id: 'same-id', name, status: 'needs-review', excluded: false }] });
async function settings(page, host) {
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await page.selectOption('#recoverySettingsHost', host.hostId);
    await (0, fixtures_js_1.expect)(page.locator('#saveRecoveryMode')).toBeEnabled();
}
(0, fixtures_js_1.test)('a settings body from an old host cannot replace a new host mode or an unsaved mode during fleet refresh', async ({ page, fleet }) => {
    await settings(page, fleet.peer);
    await page.evaluate(host => {
        const nativeFetch = window.fetch;
        window.fetch = async (...args) => {
            const res = await nativeFetch(...args);
            if (new URL(String(args[0]), location.href).href === host + '/api/settings') {
                const json = res.json.bind(res);
                res.json = async () => { const body = await json(); window.recoveryBodyWaiting = true; await new Promise(resolve => { window.releaseRecoveryBody = resolve; }); return { ...body, recoveryMode: 'continue' }; };
            }
            return res;
        };
    }, fleet.self.base);
    await page.selectOption('#recoverySettingsHost', fleet.self.hostId);
    await page.waitForFunction(() => window.recoveryBodyWaiting);
    await page.selectOption('#recoverySettingsHost', fleet.peer.hostId);
    await (0, fixtures_js_1.expect)(page.locator('#saveRecoveryMode')).toBeEnabled();
    await page.selectOption('#recoveryMode', 'restore');
    await page.evaluate(() => { window.releaseRecoveryBody(); fixtureApp.features.recoveryController.refreshHosts(); });
    await (0, fixtures_js_1.expect)(page.locator('#recoveryMode')).toHaveValue('restore');
});
(0, fixtures_js_1.test)('old preference save failures and retained buttons cannot act on a replacement settings view', async ({ page, fleet }) => {
    await settings(page, fleet.self);
    const writes = [];
    await page.route('**/api/settings', route => route.request().method() === 'PUT' ? writes.push(route) : route.continue());
    await page.selectOption('#recoveryMode', 'restore');
    await page.evaluate(() => { window.oldRecoverySave = document.querySelector('#saveRecoveryMode'); fixtureElement(window.oldRecoverySave, 'old recovery save').click(); });
    await fixtures_js_1.expect.poll(() => writes.length).toBe(1);
    await page.evaluate(() => fixtureApp.ports.appBindings.actions.closeSettingsModal(new Event('click'), document.body));
    await settings(page, fleet.peer);
    const write = (0, fixtures_js_1.requiredRoute)(writes[0]);
    await write.fulfill({ status: 500, json: { error: 'previous-save-error' } });
    await page.evaluate(() => { const button = fixtureElement(window.oldRecoverySave, 'old recovery save'); button.disabled = false; button.click(); });
    await (0, fixtures_js_1.expect)(page.locator('#recoverySettingsStatus')).not.toContainText('previous-save-error');
    (0, fixtures_js_1.expect)(writes).toHaveLength(1);
    (0, fixtures_js_1.expect)(new URL(write.request().url()).origin).toBe(fleet.self.base);
    (0, fixtures_js_1.expect)(write.request().postDataJSON()).toEqual({ recoveryMode: 'restore' });
});
(0, fixtures_js_1.test)('report requests and retained restore actions retire with the selected host and view', async ({ page, fleet }) => {
    let held;
    const writes = [];
    await page.route(`${fleet.self.base}/api/recovery`, route => { held = route; });
    await page.route(`${fleet.peer.base}/api/recovery`, route => route.fulfill({ json: report('Peer record', 'constructor') }));
    await page.route('**/api/recovery/retry', route => { writes.push(route); return route.fulfill({ json: { ok: true } }); });
    await page.evaluate(host => fixtureApp.features.recoveryController.open(host), fleet.self.hostId);
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.selectOption('#recoveryReportHost', fleet.peer.hostId);
    await (0, fixtures_js_1.expect)(page.locator('.recovery-list')).toContainText('Peer record');
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: report('Old record') });
    await (0, fixtures_js_1.expect)(page.locator('.recovery-list')).toContainText('Peer record');
    await (0, fixtures_js_1.expect)(page.locator('#recoveryViewBody')).toContainText('constructor');
    await page.evaluate(async () => {
        window.retiredRestore = document.querySelector('.recovery-restore');
        await fixtureApp.features.recoveryController.load();
        fixtureElement(window.retiredRestore, 'retired restore').click();
        window.closedRestore = document.querySelector('.recovery-restore');
        fixtureApp.features.recoveryController.close();
        fixtureElement(window.closedRestore, 'closed restore').click();
    });
    (0, fixtures_js_1.expect)(writes).toHaveLength(0);
});
(0, fixtures_js_1.test)('a queued exclusion keeps its host and late completion cannot reload another report', async ({ page, fleet }) => {
    let held;
    let peerReads = 0;
    await page.route(`${fleet.self.base}/api/recovery`, route => route.fulfill({ json: report('Self record') }));
    await page.route(`${fleet.peer.base}/api/recovery`, route => { peerReads++; return route.fulfill({ json: report('Peer record') }); });
    await page.route('**/api/sessions/same-id/recovery', route => { held = route; });
    await page.evaluate(host => fixtureApp.features.recoveryController.open(host), fleet.self.hostId);
    await page.locator('.recovery-excluded').check();
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.selectOption('#recoveryReportHost', fleet.peer.hostId);
    await (0, fixtures_js_1.expect)(page.locator('.recovery-list')).toContainText('Peer record');
    const exclusionRoute = (0, fixtures_js_1.requiredRoute)(held);
    await exclusionRoute.fulfill({ json: { ok: true } });
    await (0, fixtures_js_1.expect)(page.locator('.recovery-excluded')).not.toBeChecked();
    (0, fixtures_js_1.expect)(peerReads).toBe(1);
    (0, fixtures_js_1.expect)(new URL(exclusionRoute.request().url()).origin).toBe(fleet.self.base);
    (0, fixtures_js_1.expect)(exclusionRoute.request().postDataJSON()).toEqual({ excluded: true });
});
(0, fixtures_js_1.test)('changed endpoint credentials retire displayed report actions and trigger an owned refresh', async ({ page, fleet }) => {
    const reads = [], writes = [];
    await page.route(`${fleet.peer.base}/api/recovery`, route => { reads.push(route.request().headers().authorization); return route.fulfill({ json: report(reads.length === 1 ? 'Before token edit' : 'After token edit') }); });
    await page.route('**/api/recovery/retry', route => { writes.push(route); return route.fulfill({ json: { ok: true } }); });
    await page.evaluate(host => fixtureApp.features.recoveryController.open(host), fleet.peer.hostId);
    await (0, fixtures_js_1.expect)(page.locator('.recovery-list')).toContainText('Before token edit');
    await page.evaluate(host => {
        window.oldTokenRestore = document.querySelector('.recovery-restore');
        fixtureApp.features.hostDirectory.setToken(host, 'new-fixture-token');
        fixtureElement(window.oldTokenRestore, 'old token restore').click();
        fixtureApp.features.recoveryController.refreshHosts();
    }, fleet.peer.hostId);
    await (0, fixtures_js_1.expect)(page.locator('.recovery-list')).toContainText('After token edit');
    await page.evaluate(() => fixtureElement(window.oldTokenRestore, 'old token restore').click());
    (0, fixtures_js_1.expect)(writes).toHaveLength(0);
    (0, fixtures_js_1.expect)(reads).toEqual([`Bearer ${fleet.peer.token}`, 'Bearer new-fixture-token']);
});
