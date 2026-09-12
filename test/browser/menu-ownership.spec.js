const { test, expect, ROOT } = require('./fixtures');

const tree = { nodes: [{ id: 'fixture-entry', type: 'message', role: 'user', text: 'branch prompt' }], activePathIds: [], leafId: 'other-entry' };

test('a delayed tree cannot open after changing to the same id on another host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/tree`, route => receive(route));
  await page.evaluate(() => { window.pendingTree = fixtureApp.features.transcriptTree.open(); });
  const route = await received;
  await fleet.select(fleet.self);
  await route.fulfill({ json: tree });
  await page.evaluate(() => window.pendingTree);
  await expect(page.locator('#treeModal')).toBeHidden();
  expect(await page.evaluate(() => fixtureApp.features.transcriptTree.data)).toBeNull();
});

test('a delayed branch preserves the originating draft without reselecting another host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  const origin = await page.evaluate(() => sessionRefKey(fixtureApp.features.sessionState.captureSelection()));
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/tree`, route => route.fulfill({ json: tree }));
  await page.evaluate(() => fixtureApp.features.transcriptTree.open());
  await expect(page.locator('#treeModal')).toBeVisible();
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/branch`, route => receive(route));
  await page.evaluate(() => { fixtureApp.features.transcriptTree.select('fixture-entry'); window.pendingBranch = fixtureApp.features.transcriptTree.confirm(); });
  const route = await received;
  expect(route.request().postDataJSON().entryId).toBe('fixture-entry');
  await fleet.select(fleet.self);
  const before = await page.evaluate(() => {
    fixtureApp.features.composerDrafts.write(sessionRefKey(fixtureApp.features.sessionState.captureSelection()), 'self draft');
    return fixtureApp.features.sessionState.captureSelection();
  });
  await route.fulfill({ json: { editorText: 'origin branch edit' } });
  await page.evaluate(() => window.pendingBranch);
  expect(await page.evaluate(() => fixtureApp.features.sessionState.captureSelection())).toEqual(before);
  expect(await page.evaluate(key => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(key)), origin)).toBe('origin branch edit');
  expect(await page.evaluate(() => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(sessionRefKey(fixtureApp.features.sessionState.captureSelection()))))).toBe('self draft');
  await expect(page.locator('#treeModal')).toBeHidden();
});

for (const menu of ['Model', 'Thinking']) {
  test(`a delayed ${menu.toLowerCase()} catalog cannot open a menu after changing hosts`, async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    await page.evaluate(menu => {
      const owner = fixtureApp.features.sessionState.captureSelection();
      window.fixtureSessionListPatch(owner.id, { isActive: true,
        capabilities: { ...fixtureApp.features.sessionState.currentSession.capabilities, ['set' + menu]: true } });
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
    await expect(page.locator(`#${menu.toLowerCase()}Dropdown`)).toBeHidden();
  });
}

test('changing sessions dismisses already open session menus and overlays', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  await page.evaluate(async () => {
    const owner = fixtureApp.features.sessionState.captureSelection();
    window.fixtureSessionListPatch(owner.id, { isActive: true, capabilities: { ...fixtureApp.features.sessionState.currentSession.capabilities, setModel: true, setThinking: true } });
    await fixtureApp.features.sessionControls.toggleModels(); await fixtureApp.features.sessionControls.toggleThinking();
    for (const id of ['modelDropdown', 'thinkingDropdown', 'treeModal', 'artifactsModal']) {
      document.getElementById(id).style.display = 'flex';
    }
  });
  await fleet.select(fleet.self);
  for (const id of ['modelDropdown', 'thinkingDropdown', 'treeModal', 'artifactsModal']) {
    await expect(page.locator(`#${id}`)).toBeHidden();
  }
  expect(await page.evaluate(() => fixtureApp.features.sessionControls.modelOpen || fixtureApp.features.sessionControls.thinkingOpen)).toBe(false);
});

test.describe('live branch completion', () => {
  test.use({ liveSessions: true });
  for (const success of [true, false]) {
    test(`a branch ${success ? 'success reloads' : 'failure reports an error'} after dismissing its tree on the same session`, async ({ page, fleet }) => {
      await fleet.select(fleet.peer);
      const before = await page.evaluate(() => fixtureApp.features.sessionState.captureSelection());
      await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/tree`, route => route.fulfill({ json: tree }));
      await page.evaluate(() => fixtureApp.features.transcriptTree.open());
      let receive;
      const received = new Promise(resolve => { receive = resolve; });
      await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/branch`, route => receive(route));
      await page.evaluate(() => { fixtureApp.features.transcriptTree.select('fixture-entry'); window.pendingBranch = fixtureApp.features.transcriptTree.confirm(); });
      const route = await received;
      await page.keyboard.press('Escape');
      await expect(page.locator('#treeModal')).toBeHidden();
      let reloads = 0;
      await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/messages?**`, route => { reloads += 1; return route.continue(); });
      await route.fulfill(success ? { json: { editorText: 'returned prompt' } } : { status: 500, json: { error: 'fixture branch failure' } });
      await page.evaluate(() => window.pendingBranch);
      if (success) {
        await expect.poll(() => reloads).toBeGreaterThan(0);
        await expect(page.locator('#promptInput')).toHaveValue('returned prompt');
        const after = await page.evaluate(() => fixtureApp.features.sessionState.captureSelection());
        expect(after.host).toBe(before.host);
        expect(after.generation).toBeGreaterThan(before.generation);
      } else {
        await expect(page.locator('#status')).toContainText('Branch failed:');
        expect(await page.evaluate(() => fixtureApp.features.sessionState.captureSelection())).toEqual(before);
        expect(reloads).toBe(0);
      }
    });
  }

});

test('a failed tree refetch closes its obsolete nodes', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  let calls = 0;
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/tree`, route => {
    calls += 1;
    return route.fulfill(calls === 1 ? { json: tree } : { status: 500, json: { error: 'fixture tree failure' } });
  });
  await page.evaluate(() => fixtureApp.features.transcriptTree.open());
  await expect(page.locator('#treeModal')).toBeVisible();
  await page.evaluate(() => fixtureApp.features.transcriptTree.open());
  await expect(page.locator('#treeModal')).toBeHidden();
  await expect(page.locator('#status')).toContainText('Failed to load tree:');
});
