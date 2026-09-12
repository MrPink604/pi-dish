const { test, expect, ROOT } = require('./fixtures');

test.use({ instrumentApp: false });

for (const width of [1280, 390]) test(`production bundle starts and restores a peer selection at ${width}px without application globals`, async ({ page, fleet }) => {
  await page.setViewportSize({ width, height: 900 });
  if (width === 390) await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
  await fleet.row(fleet.peer).click();
  await expect(page.locator('#messages')).toContainText('peer root transcript');
  await expect(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);

  const globals = () => page.evaluate(() => ({
    namespace: typeof PiDishBrowser, helperNamespace: typeof PiDishHelpers,
    state: typeof globalThis.sessionState, select: typeof globalThis.selectSession,
    request: typeof globalThis.apiFetch, fixture: typeof fixtureApp,
  }));
  expect(await globals()).toEqual({ namespace: 'undefined', helperNamespace: 'undefined', state: 'undefined', select: 'undefined', request: 'undefined', fixture: 'undefined' });
  const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname));
  expect(scripts).not.toContain('/browser.js');
  expect(scripts).not.toContain('/helpers.js');
  expect(await page.evaluate(() => localStorage.getItem('pi-dish-session'))).toBe(`${fleet.peer.hostId} ${ROOT}`);

  await page.reload();
  await expect(page.locator('#messages')).toContainText('peer root transcript');
  if (width === 390) await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
  await page.locator('#tabAll').click();
  await expect(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);
  expect(await globals()).toEqual({ namespace: 'undefined', helperNamespace: 'undefined', state: 'undefined', select: 'undefined', request: 'undefined', fixture: 'undefined' });
  await page.getByRole('button', { name: '+ New session', exact: true }).click();
  await expect(page.locator('#nsHostSelect')).toBeVisible();
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await page.locator('[data-app-click="closeNewSessionView"]').click();
  await expect(page.locator('#messages')).toContainText('peer root transcript');
});
