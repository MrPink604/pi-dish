const { test, expect, ROOT } = require('./fixtures');

test('same-id transcripts, selection and polling stay on the owning host', async ({ page, fleet }) => {
  const { self, peer, select, row } = fleet;
  await select(self);
  await expect(page.locator('#messages')).toContainText('self root transcript');
  await select(peer);
  await expect(page.locator('#messages')).toContainText('peer root transcript');
  await expect(page.locator('#messages')).not.toContainText('self root transcript');
  await page.evaluate(() => fixtureApp.features.sidebarLists.load(undefined, { withPrevious: true }));
  await expect(row(peer)).toHaveClass(/\bactive\b/);
  await expect(row(self)).not.toHaveClass(/\bactive\b/);
  await page.evaluate(id => fixtureApp.features.sessionView.select(id, { host: 'missing-host' }), ROOT);
  await expect(row(peer)).toHaveClass(/\bactive\b/);
  await select(self);
  await expect(page.locator('#messages')).toContainText('self root transcript');
  await expect(page.locator('#messages')).not.toContainText('peer root transcript');
});

for (const [action, field, value] of [
  ['model', 'model', 'test/collision-model'],
  ['thinking', 'thinkingLevel', 'high'],
  ['rename', 'name', 'renamed peer'],
]) {
  test(`delayed ${action} response updates its host after selection changes`, async ({ page, fleet }) => {
    const { self, peer, select } = fleet;
    await select(peer);
    await page.evaluate(({ id, host }) => window.fixtureSessionListPatch(id, {
      isActive: true, capabilities: { setModel: true, setThinking: true, rename: true },
    }, host), { id: ROOT, host: peer.hostId });
    const endpoint = `${peer.base}/api/sessions/${ROOT}/${action}`;
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await page.route(endpoint, route => receive(route));
    const before = await page.evaluate(({ id, host, field }) => fixtureApp.features.sessionState.findSession(id, host)[field],
      { id: ROOT, host: self.hostId, field });
    await page.evaluate(({ action, value }) => {
      if (action === 'rename') { fixtureApp.features.sessionControls.startRename(); document.getElementById('sessionNameInput').value = value; }
      window.pendingMutation = action === 'model' ? fixtureApp.features.sessionControls.selectModel(value)
        : action === 'thinking' ? fixtureApp.features.sessionControls.selectThinking(value) : fixtureApp.features.sessionControls.commitRename();
    }, { action, value });
    const route = await received;
    await select(self);
    await route.fulfill({ json: { success: true, level: value } });
    await page.evaluate(() => window.pendingMutation);
    const outcome = await page.evaluate(({ id, self, peer, field }) => ({
      selectedHost: fixtureApp.features.sessionState.currentSession.host, selected: fixtureApp.features.sessionState.currentSession[field],
      self: fixtureApp.features.sessionState.findSession(id, self)[field], peer: fixtureApp.features.sessionState.findSession(id, peer)[field],
    }), { id: ROOT, self: self.hostId, peer: peer.hostId, field });
    expect(outcome).toEqual({ selectedHost: self.hostId, selected: before, self: before, peer: value });
  });
}
