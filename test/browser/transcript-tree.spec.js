// Generated test/tool from test/browser/transcript-tree.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const tree = { nodes: [
        { id: 'first', type: 'message', role: 'user', text: 'First prompt' },
        { id: 'second', type: 'message', role: 'assistant', text: 'Second answer' },
        { id: 'call', type: 'message', role: 'assistant', toolCalls: [{ id: 'tool', name: 'bash', args: 'pwd' }] },
        { id: 'result', type: 'message', role: 'toolResult', toolCallId: 'tool' },
        { id: 'leaf', type: 'message', role: 'assistant', text: 'Leaf', isLeaf: true },
    ], activePathIds: ['first', 'leaf'], leafId: 'leaf' };
async function setup(page, fleet) {
    await fleet.select(fleet.peer);
    await page.route('**/api/sessions/*/tree', (route) => route.fulfill({ json: tree }));
    await page.evaluate(() => fixtureApp.features.transcriptTree.open());
}
(0, fixtures_js_1.test)('tree filters retire retained row and branch controls and preserve tool labels', async ({ page, fleet }) => {
    await setup(page, fleet);
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(4);
    await page.locator('#treeFilter').selectOption('all');
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(5);
    await (0, fixtures_js_1.expect)(page.locator('.tree-node[data-id="result"]')).toContainText('[bash: pwd]');
    await page.locator('.tree-node[data-id="first"]').click();
    await page.evaluate(() => { window.oldBranch = document.getElementById('branchGoBtn'); window.oldRow = document.querySelector('.tree-node[data-id="first"]'); });
    await page.locator('#treeFilter').selectOption('no-tools');
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(3);
    let writes = 0;
    await page.route('**/api/sessions/*/branch', route => { writes++; return route.fulfill({ json: {} }); });
    await page.evaluate(() => { fixtureElement(window.oldBranch, 'old branch button').click(); fixtureElement(window.oldRow, 'old tree row').click(); });
    await (0, fixtures_js_1.expect)(page.locator('#branchGoBtn')).toHaveCount(0);
    (0, fixtures_js_1.expect)(writes).toBe(0);
    await page.locator('#treeFilter').selectOption('user-only');
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(1);
    await page.locator('#treeSearch').fill('First prompt');
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(1);
    await page.locator('#treeSearch').fill('First absent');
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(0);
});
for (const success of [true, false])
    (0, fixtures_js_1.test)(`a late branch ${success ? 'success' : 'error'} cannot close or alter a reopened tree`, async ({ page, fleet }) => {
        await setup(page, fleet);
        let held;
        await page.route(fleet.peer.base + `/api/sessions/${fixtures_js_1.ROOT}/branch`, route => { held = route; });
        await page.evaluate(() => { fixtureApp.features.transcriptTree.select('first'); window.treeBranch = fixtureApp.features.transcriptTree.confirm(); });
        await fixtures_js_1.expect.poll(() => !!held).toBe(true);
        await page.evaluate(async () => { fixtureApp.features.transcriptTree.close(); await fixtureApp.features.transcriptTree.open(); fixtureApp.features.transcriptTree.select('second'); });
        const before = await page.evaluate(() => fixtureApp.features.sessionState.captureSelection());
        await (0, fixtures_js_1.requiredRoute)(held).fulfill(success ? { json: { editorText: 'Original editor text' } } : { status: 500, json: { error: 'Old branch error' } });
        await page.evaluate(() => window.treeBranch);
        await (0, fixtures_js_1.expect)(page.locator('#treeModal')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('.tree-node.selected')).toHaveAttribute('data-id', 'second');
        await (0, fixtures_js_1.expect)(page.locator('#branchGoBtn')).toBeEnabled();
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionState.captureSelection())).toEqual(before);
        await (0, fixtures_js_1.expect)(page.locator('#status')).not.toContainText('Old branch error');
    });
(0, fixtures_js_1.test)('tree ids and unknown roles render as text without inline handlers', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const id = 'entry" onclick="window.treeInjected=1';
    await page.route('**/api/sessions/*/tree', route => route.fulfill({ json: { nodes: [{ id, type: 'message', role: '<img src=x onerror="window.treeInjected=1">', depth: 1e200 }], activePathIds: [], leafId: null } }));
    await page.evaluate(() => fixtureApp.features.transcriptTree.open());
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveAttribute('data-id', id);
    await (0, fixtures_js_1.expect)(page.locator('.tree-node img')).toHaveCount(0);
    (0, fixtures_js_1.expect)(await page.locator('.tree-node').getAttribute('onclick')).toBeNull();
    await page.locator('.tree-node').click();
    await (0, fixtures_js_1.expect)(page.locator('#branchGoBtn')).toBeVisible();
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.treeInjected)).toBeUndefined();
});
(0, fixtures_js_1.test)('tree disposal retires pending loads and retained controls', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.locator('.tree-node[data-id="first"]').click();
    await page.evaluate(() => { window.oldBranch = document.getElementById('branchGoBtn'); });
    let held, writes = 0;
    await page.route('**/api/sessions/*/tree', route => { held = route; });
    await page.route('**/api/sessions/*/branch', route => { writes++; return route.fulfill({ json: {} }); });
    await page.evaluate(() => { window.treeLoad = fixtureApp.features.transcriptTree.open(); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => { fixtureApp.features.transcriptTree.dispose(); fixtureElement(window.oldBranch, 'old branch button').click(); });
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: tree });
    await page.evaluate(() => window.treeLoad);
    await (0, fixtures_js_1.expect)(page.locator('#treeModal')).toBeHidden();
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.transcriptTree.data)).toBeNull();
    (0, fixtures_js_1.expect)(writes).toBe(0);
});
