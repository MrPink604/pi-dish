const { test, expect, ROOT, CHILD } = require('./fixtures');
const relation = (id, name, kind = 'child', isActive = true) => ({ kind, source: 'fixture', session: { id, name, isActive, lastActivity: '2026-09-11T00:00:00Z' } });

test('retained relation chips and modal rows cannot retarget a same-id peer or a refreshed view', async ({ page, fleet }) => {
  await page.route('**/api/sessions/*/related', route => route.fulfill({ json: { relations: [relation(CHILD, 'Related child')] } }));
  await fleet.select(fleet.self);
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  await expect(page.locator('#sessionRelations .session-relation-chip')).toContainText('Related child');
  await page.evaluate(() => { window.oldRelationChip = document.querySelector('#sessionRelations .session-relation-chip'); });
  await fleet.select(fleet.peer);
  await page.evaluate(() => window.oldRelationChip.click());
  await expect(fleet.row(fleet.peer, ROOT)).toHaveClass(/\bactive\b/);
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.openModal());
  await expect(page.locator('.relation-row')).toHaveCount(1);
  await page.evaluate(() => { window.oldRelationRow = document.querySelector('.relation-row'); });
  await page.route('**/api/sessions/*/related', route => route.fulfill({ json: { relations: [] } }));
  await page.evaluate(async () => { await fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()); window.oldRelationRow.click(); });
  await expect(page.locator('#relationsModal')).toBeHidden();
  await expect(fleet.row(fleet.peer, ROOT)).toHaveClass(/\bactive\b/);
});

test('relation disposal retires indexing and resize timers as well as rendered controls', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.clock.install();
  let reads = 0;
  await page.route('**/api/sessions/*/related', route => { reads++; return route.fulfill({ json: { indexing: true, relations: [relation(CHILD, 'Indexed child', 'constructor')] } }); });
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  const before = reads;
  await expect(page.locator('#sessionRelations')).toContainText('Related');
  await page.evaluate(() => { window.dispatchEvent(new Event('resize')); fixtureApp.features.sessionRelationsController.dispose(); });
  await page.clock.runFor(1500);
  expect(reads).toBe(before);
  await expect(page.locator('#sessionRelations')).toBeHidden();
});

for (const close of [false, true]) test(`a late same-session search cannot overwrite ${close ? 'a closed bar' : 'a newer query'}`, async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  let held;
  await page.route('**/api/sessions/*/search?q=old-query', route => { held = route; });
  await page.route('**/api/sessions/*/search?q=self', route => route.fulfill({ json: { matches: [{ index: 0, role: 'user' }] } }));
  await page.evaluate(() => { fixtureApp.features.sessionSearch.open(); window.oldNavigationSearch = fixtureApp.features.sessionSearch.run('old-query'); });
  await expect.poll(() => !!held).toBe(true);
  if (close) await page.evaluate(() => fixtureApp.features.sessionSearch.close());
  else await page.evaluate(() => fixtureApp.features.sessionSearch.run('self'));
  await held.fulfill({ json: { matches: [{ index: 0, role: 'user' }] } });
  await page.evaluate(() => window.oldNavigationSearch);
  expect(await page.evaluate(() => fixtureApp.features.sessionSearch.state.query)).toBe(close ? '' : 'self');
  if (close) await expect(page.locator('#searchBar')).toBeHidden();
  else await expect(page.locator('mark.search-mark')).toHaveText('self');
});
