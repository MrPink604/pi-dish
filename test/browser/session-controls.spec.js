// Generated test/tool from test/browser/session-controls.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
fixtures_js_1.test.use({ liveSessions: true });
const menuKinds = ['Model', 'Thinking'];
for (const kind of menuKinds) {
    (0, fixtures_js_1.test)(`closing a pending ${kind.toLowerCase()} menu retires its catalog completion on the same session`, async ({ page, fleet }) => {
        await fleet.select(fleet.self);
        await page.evaluate(kind => {
            const load = fixtureApp.features.appModels.load;
            fixtureApp.features.appModels.load = () => { fixtureApp.features.appModels.load = load; return new Promise(resolve => { window.finishHeaderCatalog = resolve; }); };
            window.headerMenu = kind === 'Model' ? fixtureApp.features.sessionControls.toggleModels() : fixtureApp.features.sessionControls.toggleThinking();
            if (kind === 'Model')
                fixtureApp.features.sessionControls.closeModels();
            else
                fixtureApp.features.sessionControls.closeThinking();
        }, kind);
        await page.evaluate(async () => { window.finishHeaderCatalog(); await window.headerMenu; });
        await (0, fixtures_js_1.expect)(page.locator('#' + kind.toLowerCase() + 'Dropdown')).toBeHidden();
        await page.evaluate(kind => kind === 'Model' ? fixtureApp.features.sessionControls.toggleModels() : fixtureApp.features.sessionControls.toggleThinking(), kind);
        await (0, fixtures_js_1.expect)(page.locator('#' + kind.toLowerCase() + 'Dropdown')).toBeVisible();
    });
}
(0, fixtures_js_1.test)('a rename editor cannot commit its old text after selecting the same session id on another host', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    let writes = 0;
    await page.route('**/api/sessions/*/rename', route => { writes++; return route.fulfill({ json: { success: true } }); });
    await page.evaluate(() => { fixtureApp.features.sessionControls.startRename(); fixtureInput(document.getElementById('sessionNameInput'), "document.getElementById('sessionNameInput')").value = 'Old peer edit'; });
    await fleet.select(fleet.self);
    await page.evaluate(() => { fixtureElement(document.getElementById('sessionNameInput'), "document.getElementById('sessionNameInput')").dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return fixtureApp.features.sessionControls.commitRename(); });
    (0, fixtures_js_1.expect)(writes).toBe(0);
});
(0, fixtures_js_1.test)('out-of-order model mutations preserve the latest selection on their originating host', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    const held = [];
    await page.route('**/api/sessions/*/model', route => { held.push(route); });
    await page.evaluate(() => {
        window.firstModel = fixtureApp.features.sessionControls.selectModel('test/first');
        window.secondModel = fixtureApp.features.sessionControls.selectModel('test/second');
    });
    await fixtures_js_1.expect.poll(() => held.length).toBe(2);
    await held[1].fulfill({ json: { success: true } });
    await page.evaluate(() => window.secondModel);
    await held[0].fulfill({ json: { success: true } });
    await page.evaluate(() => window.firstModel);
    (0, fixtures_js_1.expect)(await page.evaluate(({ id, host }) => fixtureElement(fixtureApp.features.sessionState.findSession(id, host), 'peer session').model, { id: fixtures_js_1.ROOT, host: fleet.peer.hostId })).toBe('test/second');
});
(0, fixtures_js_1.test)('rename refreshes credentials without retargeting its captured endpoint', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    await page.evaluate(() => {
        const ports = fixtureApp.ports.sessionControls, host = ports.host;
        window.controlEndpoint = { ...fixtureElement(host(fixtureCurrentSession().host ?? null), 'control endpoint') };
        ports.host = id => id === fixtureCurrentSession().host ? window.controlEndpoint : host(id);
        fixtureApp.features.sessionControls.startRename();
        fixtureInput(document.getElementById('sessionNameInput'), "document.getElementById('sessionNameInput')").value = 'Rotated peer';
        window.controlEndpoint.token = 'fresh-fixture-token';
    });
    let request;
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/rename`, route => {
        request = route.request();
        return route.fulfill({ json: { success: true } });
    });
    const result = await page.evaluate(async ({ id, self, peer }) => {
        await fixtureApp.features.sessionControls.commitRename();
        return {
            header: fixtureElement(document.getElementById('sessionName'), "document.getElementById('sessionName')").textContent,
            peer: fixtureElement(fixtureApp.features.sessionState.findSession(id, peer), 'peer session').name,
            self: fixtureElement(fixtureApp.features.sessionState.findSession(id, self), 'self session').name,
        };
    }, { id: fixtures_js_1.ROOT, self: fleet.self.hostId, peer: fleet.peer.hostId });
    if (!request)
        throw new Error('Missing rename request');
    (0, fixtures_js_1.expect)(request.headers().authorization).toBe('Bearer fresh-fixture-token');
    (0, fixtures_js_1.expect)(result.header).toBe('Rotated peer');
    (0, fixtures_js_1.expect)(result.peer).toBe('Rotated peer');
    (0, fixtures_js_1.expect)(result.self).not.toBe('Rotated peer');
});
(0, fixtures_js_1.test)('changed endpoint base retires rename editors and pending mutation completions', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    await page.evaluate(() => {
        const ports = fixtureApp.ports.sessionControls, host = ports.host;
        window.controlEndpoint = { ...fixtureElement(host(fixtureCurrentSession().host ?? null), 'control endpoint') };
        ports.host = () => window.controlEndpoint;
        fixtureApp.features.sessionControls.startRename();
        fixtureInput(document.getElementById('sessionNameInput'), "document.getElementById('sessionNameInput')").value = 'Retired rename';
        window.controlEndpoint.base += '/replacement';
    });
    let renameWrites = 0;
    await page.route('**/api/sessions/*/rename', route => { renameWrites++; return route.fulfill({ json: { success: true } }); });
    await page.evaluate(() => fixtureApp.features.sessionControls.commitRename());
    (0, fixtures_js_1.expect)(renameWrites).toBe(0);
    await (0, fixtures_js_1.expect)(page.locator('#sessionName')).not.toHaveText('Retired rename');
    await page.evaluate(base => { window.controlEndpoint.base = base; }, fleet.peer.base);
    let held;
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/thinking`, route => { held = route; });
    const before = await page.locator('#sessionThinking').textContent();
    await page.evaluate(() => { window.pendingThinking = fixtureApp.features.sessionControls.selectThinking('high'); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => { window.controlEndpoint.base += '/replacement'; });
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { success: true, level: 'high' } });
    await page.evaluate(() => window.pendingThinking);
    await (0, fixtures_js_1.expect)(page.locator('#sessionThinking')).toHaveText(before ?? '');
});
(0, fixtures_js_1.test)('enabled-model debounce retains the serving host preference after menu close and selection change', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    let write;
    await page.route(`${fleet.self.base}/api/models?sessionId=${fixtures_js_1.ROOT}`, route => route.fulfill({ json: [{ id: 'a', provider: 'p', enabled: true }, { id: 'b', provider: 'p', enabled: false }] }));
    await page.route('**/api/models/enabled', route => { write = { origin: new URL(route.request().url()).origin, body: route.request().postDataJSON() }; return route.fulfill({ json: { success: true } }); });
    await page.evaluate(async () => { await fixtureApp.features.sessionControls.toggleModels(); (() => fixtureApp.features.sessionControls.setEditMode(true))(); fixtureApp.features.sessionControls.toggleModel('p/a'); fixtureApp.features.sessionControls.closeModels(); });
    await fleet.select(fleet.peer);
    await fixtures_js_1.expect.poll(() => !!write).toBe(true);
    (0, fixtures_js_1.expect)(write).toEqual({ origin: fleet.self.base, body: { enabledIds: [] } });
});
(0, fixtures_js_1.test)('token export downloads the captured peer bytes after navigation and owns URL cleanup', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    let held;
    await page.route('**/api/sessions/*/export', route => { held = route; });
    await page.evaluate(() => {
        window.exports = [];
        window.revokedExports = [];
        window.downloadNames = [];
        URL.createObjectURL = blob => { window.exports.push(blob); return 'blob:fixture-export-' + window.exports.length; };
        URL.revokeObjectURL = url => window.revokedExports.push(url);
        HTMLAnchorElement.prototype.click = function () { window.downloadNames.push(this.download); };
        window.exportPromise = fixtureApp.features.sessionControls.export();
    });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    (0, fixtures_js_1.expect)(new URL((0, fixtures_js_1.requiredRoute)(held).request().url()).origin).toBe(fleet.peer.base);
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ body: '<h1>Peer export</h1>', headers: { 'content-type': 'text/html', 'content-disposition': "attachment; filename*=UTF-8''peer%20transcript.html" } });
    await page.evaluate(() => window.exportPromise);
    const value = await page.evaluate(async () => ({ name: window.downloadNames[0], text: await fixtureElement(window.exports[0], 'export blob').text(), revoked: window.revokedExports.length }));
    (0, fixtures_js_1.expect)(value).toEqual({ name: 'peer-root-transcript.html', text: '<h1>Peer export</h1>', revoked: 0 });
    await page.evaluate(() => fixtureApp.features.sessionControls.dispose());
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.revokedExports)).toEqual(['blob:fixture-export-1']);
});
(0, fixtures_js_1.test)('tokenless export uses navigation and disposal retires pending exports and header controls', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const navigation = await page.evaluate(async () => {
        const calls = [];
        window.open = (...args) => { calls.push(args); return null; };
        await fixtureApp.features.sessionControls.export();
        return calls;
    });
    (0, fixtures_js_1.expect)(navigation).toEqual([[`/api/sessions/${fixtures_js_1.ROOT}/export`, '_blank']]);
    await fleet.select(fleet.peer);
    let held;
    await page.route('**/api/sessions/*/export', route => { held = route; });
    await page.evaluate(() => { window.exportBlobs = 0; URL.createObjectURL = () => { window.exportBlobs++; return 'blob:late'; }; window.lateExport = fixtureApp.features.sessionControls.export(); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => fixtureApp.features.sessionControls.dispose());
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ body: 'late', contentType: 'text/html' });
    await page.evaluate(() => window.lateExport);
    await page.locator('#sessionModel').click();
    await page.locator('#sessionThinking').click();
    await page.locator('#sessionName').click();
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.exportBlobs)).toBe(0);
    await (0, fixtures_js_1.expect)(page.locator('#modelDropdown')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#thinkingDropdown')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#sessionNameInput')).toBeHidden();
});
(0, fixtures_js_1.test)('overlapping peer exports both download after a later tokenless export', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    const held = [];
    await page.route('**/api/sessions/*/export', route => { held.push(route); });
    await page.evaluate(() => {
        window.exportedBlobs = [];
        URL.createObjectURL = value => {
            if (!(value instanceof Blob))
                throw new Error('Expected export Blob');
            window.exportedBlobs.push(value);
            return 'blob:export-' + window.exportedBlobs.length;
        };
        HTMLAnchorElement.prototype.click = function () { };
        window.open = () => null;
        window.exportOne = fixtureApp.features.sessionControls.export();
        window.exportTwo = fixtureApp.features.sessionControls.export();
    });
    await fixtures_js_1.expect.poll(() => held.length).toBe(2);
    await fleet.select(fleet.self);
    await page.evaluate(() => fixtureApp.features.sessionControls.export());
    await held[1].fulfill({ body: 'second peer export', contentType: 'text/html' });
    await page.evaluate(() => window.exportTwo);
    await held[0].fulfill({ body: 'first peer export', contentType: 'text/html' });
    await page.evaluate(() => window.exportOne);
    (0, fixtures_js_1.expect)(await page.evaluate(() => Promise.all(window.exportedBlobs.map(blob => blob.text())))).toEqual(['second peer export', 'first peer export']);
});
