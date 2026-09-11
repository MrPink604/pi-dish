const { test, expect, ROOT } = require('./fixtures');
const tree = { nodes: [
  { id: 'first', type: 'message', role: 'user', text: 'First prompt' },
  { id: 'second', type: 'message', role: 'assistant', text: 'Second answer' },
  { id: 'call', type: 'message', role: 'assistant', toolCalls: [{ id: 'tool', name: 'bash', args: 'pwd' }] },
  { id: 'result', type: 'message', role: 'toolResult', toolCallId: 'tool' },
  { id: 'leaf', type: 'message', role: 'assistant', text: 'Leaf', isLeaf: true },
], activePathIds: ['first', 'leaf'], leafId: 'leaf' };
async function setup(page, fleet) {
  await fleet.select(fleet.peer);
  await page.route('**/api/sessions/*/tree', route => route.fulfill({ json: tree }));
  await page.evaluate(() => openTreeModal());
}

test('tree filters retire retained row and branch controls and preserve tool labels', async ({ page, fleet }) => {
  await setup(page, fleet);
  await expect(page.locator('.tree-node')).toHaveCount(4);
  await page.locator('#treeFilter').selectOption('all');
  await expect(page.locator('.tree-node')).toHaveCount(5);
  await expect(page.locator('.tree-node[data-id="result"]')).toContainText('[bash: pwd]');
  await page.locator('.tree-node[data-id="first"]').click();
  await page.evaluate(() => { window.oldBranch = document.getElementById('branchGoBtn'); window.oldRow = document.querySelector('.tree-node[data-id="first"]'); });
  await page.locator('#treeFilter').selectOption('no-tools');
  await expect(page.locator('.tree-node')).toHaveCount(3);
  let writes = 0;
  await page.route('**/api/sessions/*/branch', route => { writes++; return route.fulfill({ json: {} }); });
  await page.evaluate(() => { window.oldBranch.click(); window.oldRow.click(); });
  await expect(page.locator('#branchGoBtn')).toHaveCount(0); expect(writes).toBe(0);
  await page.locator('#treeFilter').selectOption('user-only');
  await expect(page.locator('.tree-node')).toHaveCount(1);
  await page.locator('#treeSearch').fill('First prompt');
  await expect(page.locator('.tree-node')).toHaveCount(1);
  await page.locator('#treeSearch').fill('First absent');
  await expect(page.locator('.tree-node')).toHaveCount(0);
});

for (const success of [true, false]) test(`a late branch ${success ? 'success' : 'error'} cannot close or alter a reopened tree`, async ({ page, fleet }) => {
  await setup(page, fleet);
  let held;
  await page.route(fleet.peer.base + `/api/sessions/${ROOT}/branch`, route => { held = route; });
  await page.evaluate(() => { selectTreeNode('first'); window.treeBranch = confirmBranch(); });
  await expect.poll(() => !!held).toBe(true);
  await page.evaluate(async () => { closeTreeModal(); await openTreeModal(); selectTreeNode('second'); });
  const before = await page.evaluate(() => sessionState.captureSelection());
  await held.fulfill(success ? { json: { editorText: 'Original editor text' } } : { status: 500, json: { error: 'Old branch error' } });
  await page.evaluate(() => window.treeBranch);
  await expect(page.locator('#treeModal')).toBeVisible();
  await expect(page.locator('.tree-node.selected')).toHaveAttribute('data-id', 'second');
  await expect(page.locator('#branchGoBtn')).toBeEnabled();
  expect(await page.evaluate(() => sessionState.captureSelection())).toEqual(before);
  await expect(page.locator('#status')).not.toContainText('Old branch error');
});

test('tree ids and unknown roles render as text without inline handlers', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const id = 'entry" onclick="window.treeInjected=1';
  await page.route('**/api/sessions/*/tree', route => route.fulfill({ json: { nodes: [{ id, type: 'message', role: '<img src=x onerror="window.treeInjected=1">', depth: 1e200 }], activePathIds: [], leafId: null } }));
  await page.evaluate(() => openTreeModal());
  await expect(page.locator('.tree-node')).toHaveAttribute('data-id', id);
  await expect(page.locator('.tree-node img')).toHaveCount(0);
  expect(await page.locator('.tree-node').getAttribute('onclick')).toBeNull();
  await page.locator('.tree-node').click();
  await expect(page.locator('#branchGoBtn')).toBeVisible();
  expect(await page.evaluate(() => window.treeInjected)).toBeUndefined();
});

test('tree disposal retires pending loads and retained controls', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.locator('.tree-node[data-id="first"]').click();
  await page.evaluate(() => { window.oldBranch = document.getElementById('branchGoBtn'); });
  let held, writes = 0;
  await page.route('**/api/sessions/*/tree', route => { held = route; });
  await page.route('**/api/sessions/*/branch', route => { writes++; return route.fulfill({ json: {} }); });
  await page.evaluate(() => { window.treeLoad = openTreeModal(); });
  await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => { transcriptTree.dispose(); window.oldBranch.click(); });
  await held.fulfill({ json: tree }); await page.evaluate(() => window.treeLoad);
  await expect(page.locator('#treeModal')).toBeHidden();
  expect(await page.evaluate(() => transcriptTree.data)).toBeNull(); expect(writes).toBe(0);
});
