const { test, expect, ROOT } = require('./fixtures');

test('a malformed peer list preserves cached rows and the selected self-host transcript', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route(`${fleet.peer.base}/api/sessions?**`, route => route.fulfill({ json: { active: [{ id: 42 }], previous: [] } }));
  await page.evaluate(() => refreshSessions());
  await expect(fleet.row(fleet.peer)).toBeVisible();
  await expect(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
  await expect(page.locator('#messages')).toContainText('self root transcript');
});

test('malformed model catalogs cannot populate the selector', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route(`${fleet.self.base}/api/models?sessionId=${ROOT}`, route => route.fulfill({ json: [{ id: {}, provider: 'fixture' }] }));
  await page.evaluate(() => {
    const owner = sessionState.captureSelection();
    sessionState.mergeCurrentSession(owner, { isActive: true, capabilities: { setModel: true } });
    return toggleModelDropdown();
  });
  await expect(page.locator('#modelDropdown')).toBeVisible();
  await expect(page.locator('#modelDropdown')).toContainText('No models found');
  expect(await page.evaluate(() => modelCatalog.rows().length)).toBe(0);
});

test('an unauthorized peer becomes blocked while retaining its cached rows', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route(`${fleet.peer.base}/api/sessions?**`, route => route.fulfill({ status: 401, json: { error: 'fixture unauthorized' } }));
  await page.evaluate(() => refreshSessions());
  expect(await page.evaluate(id => hostState(hostEntryFor(id)), fleet.peer.hostId)).toBe('blocked');
  await expect(fleet.row(fleet.peer)).toBeVisible();
  await expect(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
});
