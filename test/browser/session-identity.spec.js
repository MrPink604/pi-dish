// Generated test/tool from test/browser/session-identity.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('same-id transcripts, selection and polling stay on the owning host', async ({ page, fleet }) => {
    const { self, peer, select, row } = fleet;
    await select(self);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    await select(peer);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('peer root transcript');
    await (0, fixtures_js_1.expect)(page.locator('#messages')).not.toContainText('self root transcript');
    await page.evaluate(() => fixtureApp.features.sidebarLists.load(undefined, { withPrevious: true }));
    await (0, fixtures_js_1.expect)(row(peer)).toHaveClass(/\bactive\b/);
    await (0, fixtures_js_1.expect)(row(self)).not.toHaveClass(/\bactive\b/);
    await page.evaluate(id => fixtureApp.features.sessionView.select(id, { host: 'missing-host' }), fixtures_js_1.ROOT);
    await (0, fixtures_js_1.expect)(row(peer)).toHaveClass(/\bactive\b/);
    await select(self);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    await (0, fixtures_js_1.expect)(page.locator('#messages')).not.toContainText('peer root transcript');
});
const mutationCases = [
    { action: 'model', field: 'model', value: 'test/collision-model' },
    { action: 'thinking', field: 'thinkingLevel', value: 'high' },
    { action: 'rename', field: 'name', value: 'renamed peer' },
];
for (const { action, field, value } of mutationCases) {
    (0, fixtures_js_1.test)(`delayed ${action} response updates its host after selection changes`, async ({ page, fleet }) => {
        const { self, peer, select } = fleet;
        await select(peer);
        await page.evaluate(({ id, host }) => window.fixtureSessionListPatch(id, {
            isActive: true, capabilities: { setModel: true, setThinking: true, rename: true },
        }, host), { id: fixtures_js_1.ROOT, host: peer.hostId });
        const endpoint = `${peer.base}/api/sessions/${fixtures_js_1.ROOT}/${action}`;
        let receive;
        const received = new Promise(resolve => { receive = resolve; });
        await page.route(endpoint, route => {
            if (!receive)
                throw new Error('Mutation route resolver not initialized');
            receive(route);
        });
        const before = await page.evaluate(({ id, host, field }) => fixtureElement(fixtureApp.features.sessionState.findSession(id, host), 'self session')[field], { id: fixtures_js_1.ROOT, host: self.hostId, field });
        await page.evaluate(({ action, value }) => {
            if (action === 'rename') {
                fixtureApp.features.sessionControls.startRename();
                fixtureInput(document.getElementById('sessionNameInput'), "document.getElementById('sessionNameInput')").value = value;
            }
            window.pendingMutation = action === 'model' ? fixtureApp.features.sessionControls.selectModel(value)
                : action === 'thinking' ? fixtureApp.features.sessionControls.selectThinking(value) : fixtureApp.features.sessionControls.commitRename();
        }, { action, value });
        const route = await received;
        await select(self);
        await route.fulfill({ json: { success: true, level: value } });
        await page.evaluate(() => window.pendingMutation);
        const outcome = await page.evaluate(({ id, self, peer, field }) => ({
            selectedHost: fixtureCurrentSession().host, selected: fixtureCurrentSession()[field],
            self: fixtureElement(fixtureApp.features.sessionState.findSession(id, self), 'self session')[field],
            peer: fixtureElement(fixtureApp.features.sessionState.findSession(id, peer), 'peer session')[field],
        }), { id: fixtures_js_1.ROOT, self: self.hostId, peer: peer.hostId, field });
        (0, fixtures_js_1.expect)(outcome).toEqual({ selectedHost: self.hostId, selected: before, self: before, peer: value });
    });
}
