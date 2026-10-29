import type { Page, Route } from '@playwright/test';
import type { FleetFixture } from './fixtures.js';
import { test, expect, ROOT, requiredRoute } from './fixtures.js';
import { isRecord } from '../../lib/wire-protocol.js';
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
async function setup(page: Page, fleet: FleetFixture, json: object = tree) {
  await fleet.select(fleet.peer);
  await page.route('**/api/sessions/*/tree', (route: Route) => route.fulfill({ json }));
  await page.evaluate(() => fixtureApp.features.transcriptTree.open());
}

test('tree filters default to the conversation, persist, and retire retained row and branch controls', async ({ page, fleet }) => {
  await setup(page, fleet);
  await expect(page.locator('.tree-node')).toHaveCount(3);
  await page.locator('#treeFilter [data-filter="all"]').click();
  await expect(page.locator('.tree-node')).toHaveCount(5);
  await expect(page.locator('.tree-node[data-id="result"]')).toContainText('[bash: pwd]');
  await page.locator('.tree-node[data-id="first"]').click();
  await page.evaluate(() => { window.oldBranch = document.getElementById('branchGoBtn'); window.oldRow = document.querySelector<HTMLElement>('.tree-node[data-id="first"]'); });
  await page.locator('#treeFilter [data-filter="tools"]').click();
  await expect(page.locator('.tree-node')).toHaveCount(4);
  let writes = 0;
  await page.route('**/api/sessions/*/branch', route => { writes++; return route.fulfill({ json: {} }); });
  await page.evaluate(() => { fixtureElement(window.oldBranch, 'old branch button').click(); fixtureElement(window.oldRow, 'old tree row').click(); });
  await expect(page.locator('#branchGoBtn')).toHaveCount(0); expect(writes).toBe(0);
  await page.locator('#treeSearch').fill('First prompt');
  await expect(page.locator('.tree-node')).toHaveCount(1);
  await page.locator('#treeSearch').fill('First absent');
  await expect(page.locator('.tree-node')).toHaveCount(0);
  await page.evaluate(async () => { fixtureApp.features.transcriptTree.close(); await fixtureApp.features.transcriptTree.open(); });
  await expect(page.locator('#treeFilter [data-filter="tools"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.tree-node')).toHaveCount(4);
});

test('a fork at a hidden entry stays navigable: map, sibling switcher and switching branches', async ({ page, fleet }) => {
  await setup(page, fleet, forked);
  await expect(page.locator('.tree-branch')).toHaveCount(3);
  await expect(page.locator('.tree-fork')).toHaveCount(1);
  await expect(page.locator('.tree-node')).toHaveCount(3);
  await expect(page.locator('.tree-node[data-id="x2"] .tree-switch-pos')).toHaveText('2/2');
  await page.locator('.tree-node[data-id="x2"] [data-switch="-1"]').click();
  await expect(page.locator('.tree-node[data-id="x1"]')).toHaveCount(1);
  await expect(page.locator('.tree-node[data-id="leaf"]')).toHaveCount(0);
  await expect(page.locator('.tree-branch.current')).toHaveAttribute('data-branch', 'x1');
  let payload: unknown;
  await page.route(fleet.peer.base + `/api/sessions/${ROOT}/branch`, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: {} }); });
  await page.locator('#treeSwitchBtn').click();
  await page.locator('#branchGoBtn').click();
  await expect.poll(() => isRecord(payload) ? payload.entryId : null).toBe('x1');
  await expect(page.locator('#treeModal')).toBeHidden();
});

for (const success of [true, false]) test(`a late branch ${success ? 'success' : 'error'} cannot close or alter a reopened tree`, async ({ page, fleet }) => {
  await setup(page, fleet);
  let held: Route | null | undefined;
  await page.route(fleet.peer.base + `/api/sessions/${ROOT}/branch`, route => { held = route; });
  await page.evaluate(() => { fixtureApp.features.transcriptTree.select('first'); window.treeBranch = fixtureApp.features.transcriptTree.confirm(); });
  await expect.poll(() => !!held).toBe(true);
  await page.evaluate(async () => { fixtureApp.features.transcriptTree.close(); await fixtureApp.features.transcriptTree.open(); fixtureApp.features.transcriptTree.select('second'); });
  const before = await page.evaluate(() => fixtureApp.features.sessionState.captureSelection());
  await requiredRoute(held).fulfill(success ? { json: { editorText: 'Original editor text' } } : { status: 500, json: { error: 'Old branch error' } });
  await page.evaluate(() => window.treeBranch);
  await expect(page.locator('#treeModal')).toBeVisible();
  await expect(page.locator('.tree-node.selected')).toHaveAttribute('data-id', 'second');
  await expect(page.locator('#branchGoBtn')).toBeEnabled();
  expect(await page.evaluate(() => fixtureApp.features.sessionState.captureSelection())).toEqual(before);
  await expect(page.locator('#status')).not.toContainText('Old branch error');
});

test('tree ids and unknown roles render as text without inline handlers', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const id = 'entry" onclick="window.treeInjected=1';
  await page.route('**/api/sessions/*/tree', route => route.fulfill({ json: { nodes: [{ id, type: 'message', role: '<img src=x onerror="window.treeInjected=1">', depth: 1e200 }], activePathIds: [], leafId: null } }));
  await page.evaluate(() => fixtureApp.features.transcriptTree.open());
  await page.locator('#treeFilter [data-filter="all"]').click();
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
  let held: Route | undefined, writes = 0;
  await page.route('**/api/sessions/*/tree', route => { held = route; });
  await page.route('**/api/sessions/*/branch', route => { writes++; return route.fulfill({ json: {} }); });
  await page.evaluate(() => { window.treeLoad = fixtureApp.features.transcriptTree.open(); });
  await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => { fixtureApp.features.transcriptTree.dispose(); fixtureElement(window.oldBranch, 'old branch button').click(); });
  await requiredRoute(held).fulfill({ json: tree }); await page.evaluate(() => window.treeLoad);
  await expect(page.locator('#treeModal')).toBeHidden();
  expect(await page.evaluate(() => fixtureApp.features.transcriptTree.data)).toBeNull(); expect(writes).toBe(0);
});

test('branching from a chat message header posts that entry from the confirm popover', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'chatBranchFixture';
    host.innerHTML = fixtureApp.features.messageRenderer.message({ role: 'assistant', id: 'chat-entry', content: [{ type: 'text', text: 'reply' }] });
    fixtureElement(document.getElementById('messages'), 'messages').prepend(host);
  });
  let payload: unknown;
  await page.route(fleet.peer.base + `/api/sessions/${ROOT}/branch`, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: {} }); });
  await page.locator('#chatBranchFixture .message').hover();
  await page.locator('#chatBranchFixture .msg-branch-btn').click();
  await expect(page.locator('#messageActionMenu .message-branch-title')).toHaveText('Continue from here');
  await page.locator('#messageActionMenu [data-branch-go]').click();
  await expect.poll(() => isRecord(payload) ? payload.entryId : null).toBe('chat-entry');
  await expect(page.locator('#messageActionMenu')).toBeHidden();
});

export {};
