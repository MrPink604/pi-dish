import type { Page, Route } from '@playwright/test';
import { test, expect, ROOT, requiredRoute } from './fixtures.js';

type TakeoverName = 'usage' | 'search' | 'subagents' | 'newSession' | 'skills' | 'routines' | 'recovery';
const takeoverNames: readonly TakeoverName[] = ['usage', 'search', 'subagents', 'newSession', 'skills', 'routines', 'recovery'];
const clearingTakeovers: readonly TakeoverName[] = ['recovery', 'subagents'];

async function openTakeover(page: Page, name: TakeoverName) {
  await page.evaluate(async name => {
    const features = fixtureApp.features;
    if (name === 'subagents') {
      await features.sessionRelationsController.load(features.sessionState.captureSelection());
      fixtureElement(document.querySelector<HTMLElement>('.session-relation-tree-link'), '.session-relation-tree-link').click();
    } else {
      const controllers = { usage: features.usageController, search: features.searchViewController,
        newSession: features.newSessionController, skills: features.skillsController,
        routines: features.routinesController, recovery: features.recoveryController };
      controllers[name].open();
    }
  }, name);
}

const takeovers = { usage: 'usage-open', search: 'search-open', subagents: 'subagents-open',
  newSession: 'new-session-open', skills: 'skills-open', routines: 'routines-open', recovery: 'recovery-open' };

test('every takeover excludes each other takeover without retiring its own opened surface', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  for (const from of takeoverNames) {
    for (const to of takeoverNames) {
      const className = takeovers[to];
      await openTakeover(page, from);
      await openTakeover(page, to);
      expect(await page.locator('.main').evaluate((main, classes) => classes.filter(name => main.classList.contains(name)), Object.values(takeovers))).toEqual([className]);
    }
  }
});

test('ordinary takeovers retain file and settings while recovery and subagents retire them and late file bodies', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  let held: Route | null | undefined;
  await page.route('**/api/sessions/*/file?*', route => { held = route; });
  for (const clearing of clearingTakeovers) {
    held = null;
    await page.evaluate(() => { window.openingFile = fixtureApp.features.fileViews.openFile('held.txt'); });
    await expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await openTakeover(page, 'usage');
    await expect(page.locator('#settingsModal')).toBeVisible();
    await expect(page.locator('#sessionView')).toHaveClass(/file-open/);
    await openTakeover(page, clearing);
    await expect(page.locator('#settingsModal')).toBeHidden();
    await expect(page.locator('#sessionView')).not.toHaveClass(/file-open|diff-open/);
    await requiredRoute(held).fulfill({ json: { path: '/fixture/held.txt', relPath: 'held.txt', content: 'retired file body', size: 17, mtime: 1 } });
    await page.evaluate(() => window.openingFile);
    await expect(page.locator('#fileViewBody')).not.toContainText('retired file body');
  }
});

test('Bounce can retain settings across owned selection while ordinary selection collapses only Bounce', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route('**/api/session-bounces/preview?*', route => route.fulfill({ json: { targets: [] } }));
  await page.route('**/api/session-bounces', route => route.fulfill({ json: { operations: [] } }));
  await page.evaluate(() => fixtureApp.features.displayPreferences.open());
  await page.locator('#openBounceAgents').click();
  await expect(page.locator('#bounceMode')).toBeVisible();
  await page.evaluate(({ id, host }) => fixtureApp.features.sessionView.select(id, { host, keepBounceView: true }), { id: ROOT, host: fleet.peer.hostId });
  await expect(page.locator('#messages')).toContainText('peer root transcript');
  await expect(page.locator('#bounceMode')).toBeVisible();
  await fleet.select(fleet.self);
  await expect(page.locator('#messages')).toContainText('self root transcript');
  await expect(page.locator('#settingsModal')).toBeVisible();
  await expect(page.locator('#bounceMode')).toBeHidden();
});

export {};
