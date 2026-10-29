// Generated test/tool from test/browser/transcript-tree.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const tree = { nodes: [
        { id: 'first', type: 'message', role: 'user', text: 'First prompt' },
        { id: 'second', parentId: 'first', type: 'message', role: 'assistant', text: 'Second answer' },
        { id: 'call', parentId: 'second', type: 'message', role: 'assistant', toolCalls: [{ id: 'tool', name: 'bash', args: 'pwd' }] },
        { id: 'result', parentId: 'call', type: 'message', role: 'toolResult', toolCallId: 'tool' },
        { id: 'leaf', parentId: 'result', type: 'message', role: 'assistant', text: 'Leaf', isLeaf: true },
    ], activePathIds: ['leaf', 'result', 'call', 'second', 'first'], leafId: 'leaf' };
// Two alternatives after a tool result the conversation view hides.
const forked = { nodes: [
        { id: 'u1', type: 'message', role: 'user', text: 'Implement the mixer' },
        { id: 'call', parentId: 'u1', type: 'message', role: 'assistant', toolCalls: [{ id: 'tool', name: 'bash', args: 'make' }] },
        { id: 'res', parentId: 'call', type: 'message', role: 'toolResult', toolCallId: 'tool' },
        { id: 'x1', parentId: 'res', type: 'message', role: 'assistant', text: 'Tried FMOD' },
        { id: 'x2', parentId: 'res', type: 'message', role: 'assistant', text: 'Native mixer done' },
        { id: 'leaf', parentId: 'x2', type: 'message', role: 'user', text: 'Now layer the stems', isLeaf: true },
    ], activePathIds: ['leaf', 'x2', 'res', 'call', 'u1'], leafId: 'leaf' };
async function setup(page, fleet, json = tree) {
    await fleet.select(fleet.peer);
    await page.route('**/api/sessions/*/tree', (route) => route.fulfill({ json }));
    await page.evaluate(() => fixtureApp.features.transcriptTree.open());
}
(0, fixtures_js_1.test)('tree filters default to the conversation, persist, and retire retained row and branch controls', async ({ page, fleet }) => {
    await setup(page, fleet);
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(3);
    await page.locator('#treeFilter [data-filter="all"]').click();
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(5);
    await (0, fixtures_js_1.expect)(page.locator('.tree-node[data-id="result"]')).toContainText('[bash: pwd]');
    await page.locator('.tree-node[data-id="first"]').click();
    await page.evaluate(() => { window.oldBranch = document.getElementById('branchGoBtn'); window.oldRow = document.querySelector('.tree-node[data-id="first"]'); });
    await page.locator('#treeFilter [data-filter="tools"]').click();
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(4);
    let writes = 0;
    await page.route('**/api/sessions/*/branch', route => { writes++; return route.fulfill({ json: {} }); });
    await page.evaluate(() => { fixtureElement(window.oldBranch, 'old branch button').click(); fixtureElement(window.oldRow, 'old tree row').click(); });
    await (0, fixtures_js_1.expect)(page.locator('#branchGoBtn')).toHaveCount(0);
    (0, fixtures_js_1.expect)(writes).toBe(0);
    await page.locator('#treeSearch').fill('First prompt');
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(1);
    await page.locator('#treeSearch').fill('First absent');
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(0);
    await page.evaluate(async () => { fixtureApp.features.transcriptTree.close(); await fixtureApp.features.transcriptTree.open(); });
    await (0, fixtures_js_1.expect)(page.locator('#treeFilter [data-filter="tools"]')).toHaveAttribute('aria-checked', 'true');
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(4);
});
(0, fixtures_js_1.test)('a fork at a hidden entry stays navigable: map, sibling switcher and switching branches', async ({ page, fleet }) => {
    await setup(page, fleet, forked);
    await (0, fixtures_js_1.expect)(page.locator('.tree-branch')).toHaveCount(3);
    await (0, fixtures_js_1.expect)(page.locator('.tree-fork')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('.tree-node')).toHaveCount(3);
    await (0, fixtures_js_1.expect)(page.locator('.tree-node[data-id="x2"] .tree-switch-pos')).toHaveText('2/2');
    await page.locator('.tree-node[data-id="x2"] [data-switch="-1"]').click();
    await (0, fixtures_js_1.expect)(page.locator('.tree-node[data-id="x1"]')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('.tree-node[data-id="leaf"]')).toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('.tree-branch.current')).toHaveAttribute('data-branch', 'x1');
    let payload;
    await page.route(fleet.peer.base + `/api/sessions/${fixtures_js_1.ROOT}/branch`, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: {} }); });
    await page.locator('#treeSwitchBtn').click();
    await page.locator('#branchGoBtn').click();
    await fixtures_js_1.expect.poll(() => (0, wire_protocol_js_1.isRecord)(payload) ? payload.entryId : null).toBe('x1');
    await (0, fixtures_js_1.expect)(page.locator('#treeModal')).toBeHidden();
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
    await page.locator('#treeFilter [data-filter="all"]').click();
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
(0, fixtures_js_1.test)('branching from a chat message header posts that entry from the confirm popover', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'chatBranchFixture';
        host.innerHTML = fixtureApp.features.messageRenderer.message({ role: 'assistant', id: 'chat-entry', content: [{ type: 'text', text: 'reply' }] });
        fixtureElement(document.getElementById('messages'), 'messages').prepend(host);
    });
    let payload;
    await page.route(fleet.peer.base + `/api/sessions/${fixtures_js_1.ROOT}/branch`, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: {} }); });
    await page.locator('#chatBranchFixture .message').hover();
    await page.locator('#chatBranchFixture .msg-branch-btn').click();
    await (0, fixtures_js_1.expect)(page.locator('#messageActionMenu .message-branch-title')).toHaveText('Continue from here');
    await page.locator('#messageActionMenu [data-branch-go]').click();
    await fixtures_js_1.expect.poll(() => (0, wire_protocol_js_1.isRecord)(payload) ? payload.entryId : null).toBe('chat-entry');
    await (0, fixtures_js_1.expect)(page.locator('#messageActionMenu')).toBeHidden();
});
