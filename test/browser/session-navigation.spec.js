const { test, expect, ROOT, CHILD } = require('./fixtures');
const lineageNode = (id, name, children = [], isActive = true) => ({
  session: { id, name, isActive, lastActivity: '2026-09-11T00:00:00Z' },
  edge: children.length ? null : { kind: 'child', source: 'fixture' }, children,
});
const lineagePayload = (childName = 'Related child') => ({
  session: { id: CHILD, name: 'Current' },
  tree: lineageNode(ROOT, 'Root', [lineageNode(CHILD, childName)]),
  members: 2,
});

test('retained lineage link and tree rows cannot retarget a same-id peer or a refreshed view', async ({ page, fleet }) => {
  await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: lineagePayload() }));
  await fleet.select(fleet.self);
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  await expect(page.locator('#sessionRelations .session-relation-chip')).toContainText('Subagents · 1');
  await page.evaluate(() => { window.oldRelationLink = document.querySelector('#sessionRelations .session-relation-chip'); });
  await fleet.select(fleet.peer);
  await page.evaluate(() => window.oldRelationLink.click());
  await expect(page.locator('#relationsModal')).toBeHidden();
  await expect(fleet.row(fleet.peer, ROOT)).toHaveClass(/\bactive\b/);
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.openModal());
  await expect(page.locator('.lineage-row')).toHaveCount(2);
  await page.evaluate(() => { window.oldLineageRow = document.querySelectorAll('.lineage-row')[1]; });
  await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: { session: { id: CHILD }, tree: null, members: 0 } }));
  await page.evaluate(async () => { await fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()); window.oldLineageRow.click(); });
  await expect(page.locator('#relationsModal')).toBeHidden();
  await expect(fleet.row(fleet.peer, ROOT)).toHaveClass(/\bactive\b/);
});

test('lineage tree collapses subtrees and marks the current session', async ({ page, fleet }) => {
  const payload = lineagePayload();
  payload.tree.children[0].children.push(lineageNode('grandchild-1', 'Grandchild'));
  payload.tree.children[0].edge = { kind: 'child', source: 'fixture' };
  payload.members = 3;
  await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: payload }));
  await fleet.select(fleet.self);
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  await expect(page.locator('#sessionRelations')).toContainText('Subagents · 2');
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.openModal());
  await expect(page.locator('.lineage-row')).toHaveCount(3);
  await expect(page.locator('.lineage-row.lineage-current')).toHaveCount(1);
  await expect(page.locator('.lineage-row.lineage-current')).toHaveAttribute('data-session-id', CHILD);
  await page.locator(`.lineage-row[data-session-id="${CHILD}"] .lineage-twisty`).click();
  await expect(page.locator('.lineage-row')).toHaveCount(2, 'collapsing hides the grandchild row');
  await expect(page.locator('.lineage-row[data-session-id="grandchild-1"]')).toHaveCount(0);
  await page.locator(`.lineage-row[data-session-id="${CHILD}"] .lineage-twisty`).click();
  await expect(page.locator('.lineage-row')).toHaveCount(3, 'expanding restores the subtree');
});

test('relation disposal retires the indexing repoll as well as rendered controls', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.clock.install();
  let reads = 0;
  await page.route('**/api/sessions/*/lineage', route => { reads++; return route.fulfill({ json: { indexing: true, ...lineagePayload('Indexed child') } }); });
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  const before = reads;
  await expect(page.locator('#sessionRelations')).toContainText('Subagents');
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.dispose());
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
