import { test, expect, ROOT } from './fixtures.js';

test.use({ instrumentApp: false });

for (const width of [1280, 390]) test(`production bundle starts and restores a peer selection at ${width}px without application globals`, async ({ page, fleet }) => {
  await page.setViewportSize({ width, height: 900 });
  if (width === 390) await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
  await fleet.row(fleet.peer).click();
  await expect(page.locator('#messages')).toContainText('peer root transcript');
  await expect(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);

  const globals = () => page.evaluate(() => ({
    namespace: typeof PiDishBrowser, helperNamespace: typeof PiDishHelpers,
    state: typeof Reflect.get(globalThis, 'sessionState'), select: typeof Reflect.get(globalThis, 'selectSession'),
    request: typeof Reflect.get(globalThis, 'apiFetch'), fixture: typeof fixtureApp,
    fixtureElement: typeof globalThis.fixtureElement, fixtureInput: typeof globalThis.fixtureInput,
    fixtureDetails: typeof globalThis.fixtureDetails, fixtureLink: typeof globalThis.fixtureLink,
    fixtureCurrentSession: typeof globalThis.fixtureCurrentSession,
    fixtureTerminalProbe: typeof globalThis.fixtureTerminalProbe,
  }));
  expect(await globals()).toEqual({ namespace: 'undefined', helperNamespace: 'undefined', state: 'undefined', select: 'undefined', request: 'undefined', fixture: 'undefined', fixtureElement: 'undefined', fixtureInput: 'undefined', fixtureDetails: 'undefined', fixtureLink: 'undefined', fixtureCurrentSession: 'undefined', fixtureTerminalProbe: 'undefined' });
  const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname));
  expect(scripts).not.toContain('/browser.js');
  expect(scripts).not.toContain('/helpers.js');
  expect(await page.evaluate(() => localStorage.getItem('pi-dish-session'))).toBe(`${fleet.peer.hostId} ${ROOT}`);

  await page.reload();
  await expect(page.locator('#messages')).toContainText('peer root transcript');
  if (width === 390) await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
  await page.locator('#tabAll').click();
  await expect(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);
  expect(await globals()).toEqual({ namespace: 'undefined', helperNamespace: 'undefined', state: 'undefined', select: 'undefined', request: 'undefined', fixture: 'undefined', fixtureElement: 'undefined', fixtureInput: 'undefined', fixtureDetails: 'undefined', fixtureLink: 'undefined', fixtureCurrentSession: 'undefined', fixtureTerminalProbe: 'undefined' });
  await page.getByRole('button', { name: '+ New session', exact: true }).click();
  await expect(page.locator('#nsHostSelect')).toBeVisible();
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await page.locator('[data-app-click="closeNewSessionView"]').click();
  await expect(page.locator('#messages')).toContainText('peer root transcript');
});

test.describe('startup interactivity', () => {
  test.use({ liveSessions: true });

  test('local session selection and keyboard submission do not wait for a peer list', async ({ page, fleet }) => {
    let release!: () => void;
    let arrived!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = new Promise<void>(resolve => { arrived = resolve; });
    await page.route(`${fleet.peer.base}/api/sessions?*`, async route => {
      arrived();
      await gate;
      await route.continue();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await pending;
    try {
      await fleet.row(fleet.self).click();
      await expect(page.locator('#messages')).toContainText('self root transcript');
      await expect(page.locator('#promptInput')).toBeEnabled();
      await page.locator('#promptInput').fill('Ready before the peer');
      const submitted = page.waitForRequest(`${fleet.self.base}/api/sessions/${ROOT}/prompt`);
      await page.locator('#promptInput').press('Enter');
      await submitted;
      await expect.poll(() => fleet.self.commands.some(command => command.command === 'prompt')).toBe(true);
    } finally {
      release();
    }
  });
});

export {};
