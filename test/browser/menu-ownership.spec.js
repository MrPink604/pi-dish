// Generated test/tool from test/browser/menu-ownership.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const fixtures_js_1 = require("./fixtures.js");
const tree = { nodes: [{ id: 'fixture-entry', type: 'message', role: 'user', text: 'branch prompt' }], activePathIds: [], leafId: 'other-entry' };
const menus = ['Model', 'Thinking'];
(0, fixtures_js_1.test)('a delayed tree cannot open after changing to the same id on another host', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/tree`, route => {
        if (!receive)
            throw new Error('Tree route resolver not initialized');
        receive(route);
    });
    await page.evaluate(() => { window.pendingTree = fixtureApp.features.transcriptTree.open(); });
    const route = await received;
    await fleet.select(fleet.self);
    await route.fulfill({ json: tree });
    await page.evaluate(() => window.pendingTree);
    await (0, fixtures_js_1.expect)(page.locator('#treeModal')).toBeHidden();
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.transcriptTree.data)).toBeNull();
});
(0, fixtures_js_1.test)('a delayed branch preserves the originating draft without reselecting another host', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    const origin = await page.evaluate(() => sessionRefKey(fixtureApp.features.sessionState.captureSelection()));
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/tree`, route => route.fulfill({ json: tree }));
    await page.evaluate(() => fixtureApp.features.transcriptTree.open());
    await (0, fixtures_js_1.expect)(page.locator('#treeModal')).toBeVisible();
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/branch`, route => {
        if (!receive)
            throw new Error('Branch route resolver not initialized');
        receive(route);
    });
    await page.evaluate(() => { fixtureApp.features.transcriptTree.select('fixture-entry'); window.pendingBranch = fixtureApp.features.transcriptTree.confirm(); });
    const route = await received;
    const branchPayload = route.request().postDataJSON();
    if (!(0, wire_protocol_js_1.isRecord)(branchPayload))
        throw new Error('Invalid branch payload');
    (0, fixtures_js_1.expect)(branchPayload.entryId).toBe('fixture-entry');
    await fleet.select(fleet.self);
    const before = await page.evaluate(() => {
        fixtureApp.features.composerDrafts.write(sessionRefKey(fixtureApp.features.sessionState.captureSelection()), 'self draft');
        return fixtureApp.features.sessionState.captureSelection();
    });
    await route.fulfill({ json: { editorText: 'origin branch edit' } });
    await page.evaluate(() => window.pendingBranch);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionState.captureSelection())).toEqual(before);
    (0, fixtures_js_1.expect)(await page.evaluate(key => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(key)), origin)).toBe('origin branch edit');
    (0, fixtures_js_1.expect)(await page.evaluate(() => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(sessionRefKey(fixtureApp.features.sessionState.captureSelection()))))).toBe('self draft');
    await (0, fixtures_js_1.expect)(page.locator('#treeModal')).toBeHidden();
});
for (const menu of menus) {
    (0, fixtures_js_1.test)(`a delayed ${menu.toLowerCase()} catalog cannot open a menu after changing hosts`, async ({ page, fleet }) => {
        await fleet.select(fleet.peer);
        await page.evaluate(menu => {
            const owner = fixtureApp.features.sessionState.captureSelection();
            if (owner === null)
                throw new Error('Missing owner');
            fixtureApp.features.modelCatalog.retire();
            window.fixtureSessionListPatch(owner.id, { isActive: true, harnessId: menu === 'Thinking' ? 'omp' : 'pi',
                capabilities: { ...fixtureCurrentSession().capabilities, ['set' + menu]: true } });
            const load = fixtureApp.features.appModels.load;
            fixtureApp.features.appModels.load = () => {
                fixtureApp.features.appModels.load = load;
                return new Promise(resolve => { window.releaseMenuCatalog = resolve; });
            };
            window.pendingMenu = menu === 'Model' ? fixtureApp.features.sessionControls.toggleModels() : fixtureApp.features.sessionControls.toggleThinking();
        }, menu);
        await page.waitForFunction(() => typeof window.releaseMenuCatalog === 'function');
        await fleet.select(fleet.self);
        await page.evaluate(async () => { window.releaseMenuCatalog(); await window.pendingMenu; });
        await (0, fixtures_js_1.expect)(page.locator(`#${menu.toLowerCase()}Dropdown`)).toBeHidden();
    });
}
(0, fixtures_js_1.test)('changing sessions dismisses already open session menus and overlays', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    await page.evaluate(async () => {
        const owner = fixtureApp.features.sessionState.captureSelection();
        if (owner === null)
            throw new Error('Missing owner');
        window.fixtureSessionListPatch(owner.id, { isActive: true, capabilities: { ...fixtureCurrentSession().capabilities, setModel: true, setThinking: true } });
        await fixtureApp.features.sessionControls.toggleModels();
        await fixtureApp.features.sessionControls.toggleThinking();
        for (const id of ['modelDropdown', 'thinkingDropdown', 'treeModal', 'artifactsModal']) {
            fixtureElement(document.getElementById(id), 'document.getElementById(id)').style.display = 'flex';
        }
    });
    await fleet.select(fleet.self);
    for (const id of ['modelDropdown', 'thinkingDropdown', 'treeModal', 'artifactsModal']) {
        await (0, fixtures_js_1.expect)(page.locator(`#${id}`)).toBeHidden();
    }
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionControls.modelOpen || fixtureApp.features.sessionControls.thinkingOpen)).toBe(false);
});
fixtures_js_1.test.describe('live branch completion', () => {
    fixtures_js_1.test.use({ liveSessions: true });
    for (const success of [true, false]) {
        (0, fixtures_js_1.test)(`a branch ${success ? 'success reloads' : 'failure reports an error'} after dismissing its tree on the same session`, async ({ page, fleet }) => {
            await fleet.select(fleet.peer);
            const before = await page.evaluate(() => fixtureApp.features.sessionState.captureSelection());
            if (before === null)
                throw new Error('Missing before');
            await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/tree`, route => route.fulfill({ json: tree }));
            await page.evaluate(() => fixtureApp.features.transcriptTree.open());
            let receive;
            const received = new Promise(resolve => { receive = resolve; });
            await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/branch`, route => {
                if (!receive)
                    throw new Error('Live branch route resolver not initialized');
                receive(route);
            });
            await page.evaluate(() => { fixtureApp.features.transcriptTree.select('fixture-entry'); window.pendingBranch = fixtureApp.features.transcriptTree.confirm(); });
            const route = await received;
            await page.keyboard.press('Escape');
            await (0, fixtures_js_1.expect)(page.locator('#treeModal')).toBeHidden();
            let reloads = 0;
            await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/messages?**`, route => { reloads += 1; return route.continue(); });
            await route.fulfill(success ? { json: { editorText: 'returned prompt' } } : { status: 500, json: { error: 'fixture branch failure' } });
            await page.evaluate(() => window.pendingBranch);
            if (success) {
                await fixtures_js_1.expect.poll(() => reloads).toBeGreaterThan(0);
                await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('returned prompt');
                const after = await page.evaluate(() => fixtureApp.features.sessionState.captureSelection());
                if (after === null)
                    throw new Error('Missing after');
                (0, fixtures_js_1.expect)(after.host).toBe(before.host);
                (0, fixtures_js_1.expect)(after.generation).toBeGreaterThan(before.generation);
            }
            else {
                await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Branch failed:');
                (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionState.captureSelection())).toEqual(before);
                (0, fixtures_js_1.expect)(reloads).toBe(0);
            }
        });
    }
});
(0, fixtures_js_1.test)('a failed tree refetch closes its obsolete nodes', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    let calls = 0;
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/tree`, route => {
        calls += 1;
        return route.fulfill(calls === 1 ? { json: tree } : { status: 500, json: { error: 'fixture tree failure' } });
    });
    await page.evaluate(() => fixtureApp.features.transcriptTree.open());
    await (0, fixtures_js_1.expect)(page.locator('#treeModal')).toBeVisible();
    await page.evaluate(() => fixtureApp.features.transcriptTree.open());
    await (0, fixtures_js_1.expect)(page.locator('#treeModal')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Failed to load tree:');
});
