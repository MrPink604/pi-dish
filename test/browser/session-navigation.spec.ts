import type { Route } from '@playwright/test';
import { isRecord } from '../../lib/wire-protocol.js';
import { test, expect, ROOT, CHILD, requiredRoute } from './fixtures.js';
interface FixtureLineageSession {
  id: string; name: string; isActive?: boolean; lastActivity?: string;
  capabilities?: { prompt: boolean; steer: boolean; followUp: boolean };
}
interface FixtureLineageNode {
  session: FixtureLineageSession;
  edge: { kind: string; source: string } | null;
  children: FixtureLineageNode[];
}

const lineageNode = (id: string, name: string, children: FixtureLineageNode[] = [], isActive = true): FixtureLineageNode => ({
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
  await page.evaluate(() => { window.oldRelationLink = document.querySelector<HTMLElement>('#sessionRelations .session-relation-chip'); });
  await fleet.select(fleet.peer);
  await page.evaluate(() => fixtureElement(window.oldRelationLink, 'old relation link').click());
  await expect(page.locator('.main')).not.toHaveClass(/\bsubagents-open\b/);
  await expect(fleet.row(fleet.peer, ROOT)).toHaveClass(/\bactive\b/);
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  await page.locator('#sessionRelations .session-relation-chip').click();
  await expect(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
  await expect(page.locator('.lineage-row')).toHaveCount(2);
  await page.evaluate(() => { window.oldLineageRow = document.querySelectorAll<HTMLElement>('.lineage-row')[1] ?? null; });
  await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: { session: { id: CHILD }, tree: null, members: 0 } }));
  await page.evaluate(() => fixtureApp.features.subagentsController.reload());
  await expect(page.locator('#subagentsTree .subagents-state')).toContainText('No related sessions');
  await page.evaluate(() => fixtureElement(window.oldLineageRow, 'old lineage row').click());
  await expect(fleet.row(fleet.peer, ROOT)).toHaveClass(/\bactive\b/);
  await expect(page.locator('#subagentsDetailEmpty')).toBeVisible();
});


test('peeking at a relative reads its trace without switching the selected session', async ({ page, fleet }) => {
  const payload = lineagePayload();
  payload.session = { id: ROOT, name: 'Current' };
  await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: payload }));
  await fleet.select(fleet.self);
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  await page.locator('#sessionRelations .session-relation-chip').click();
  await expect(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
  await expect(page.locator('#sessionView')).toBeHidden();
  await page.locator(`.lineage-row[data-session-id="${CHILD}"]`).click();
  // The trace comes from the fixture server's real transcript file.
  await expect(page.locator('#subagentsTrace')).toContainText('self child transcript');
  await expect(page.locator('#subagentsDetailName')).toContainText('Related child');
  await expect(page.locator('#sessionName')).toBeHidden(); // session view stays parked underneath
  await page.locator('[data-app-click="closeSubagentsView"]').click();
  await expect(page.locator('.main')).not.toHaveClass(/\bsubagents-open\b/);
  await expect(page.locator('#sessionView')).toBeVisible();
  await expect(fleet.row(fleet.self, ROOT)).toHaveClass(/\bactive\b/);
});

test('signaling a relative uses its capabilities and keeps the viewer in place', async ({ page, fleet }) => {
  const payload = lineagePayload();
  payload.session = { id: ROOT, name: 'Current' };
  payload.tree.children[0].session.capabilities = { prompt: true, steer: true, followUp: true };
  await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: payload }));
  const steers: unknown[] = [];
  await page.route(`**/api/sessions/${CHILD}/steer`, route => {
    steers.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true } });
  });
  await fleet.select(fleet.self);
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  await page.locator('#sessionRelations .session-relation-chip').click();
  await page.locator(`.lineage-row[data-session-id="${CHILD}"]`).click();
  await expect(page.locator('#subagentsSendBtn')).toBeVisible();
  await expect(page.locator('#subagentsSteerBtn')).toBeVisible();
  await expect(page.locator('#subagentsFollowUpBtn')).toBeVisible();
  await page.fill('#subagentsSignalInput', 'focus on src/auth');
  await page.locator('#subagentsSteerBtn').click();
  await expect.poll(() => steers.map(entry => isRecord(entry) ? entry.message : undefined)).toEqual(['focus on src/auth']);
  await expect(page.locator('#subagentsSignalStatus')).toContainText('Steered');
  await expect(page.locator('#subagentsSignalInput')).toHaveValue('');
  await expect(fleet.row(fleet.self, ROOT)).toHaveClass(/\bactive\b/);
});

test('a finished relative shows why signaling is unavailable', async ({ page, fleet }) => {
  const payload = lineagePayload();
  payload.session = { id: ROOT, name: 'Current' };
  payload.tree.children[0].session.isActive = false;
  await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: payload }));
  await fleet.select(fleet.self);
  await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
  await page.locator('#sessionRelations .session-relation-chip').click();
  await page.locator(`.lineage-row[data-session-id="${CHILD}"]`).click();
  await expect(page.locator('#subagentsSignalBox')).toBeHidden();
  await expect(page.locator('#subagentsSignalNote')).toContainText('has ended');
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
  await page.locator('#sessionRelations .session-relation-chip').click();
  await expect(page.locator('.lineage-row')).toHaveCount(3);
  await expect(page.locator('.lineage-row.lineage-current')).toHaveCount(1);
  await expect(page.locator('.lineage-row.lineage-current')).toHaveAttribute('data-session-id', CHILD);
  await page.locator(`.lineage-row[data-session-id="${CHILD}"] .lineage-twisty`).click();
  await expect(page.locator('.lineage-row')).toHaveCount(2);
  await expect(page.locator('.lineage-row[data-session-id="grandchild-1"]')).toHaveCount(0);
  await page.locator(`.lineage-row[data-session-id="${CHILD}"] .lineage-twisty`).click();
  await expect(page.locator('.lineage-row')).toHaveCount(3);
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

test.describe('live family chip', () => {
  test.use({ liveSessions: true });

  test('the header chip picks up spawned subagents without a reselect', async ({ page, fleet }) => {
    let reads = 0;
    await page.route('**/api/sessions/*/lineage', route => {
      reads++;
      return route.fulfill({ json: reads === 1
        ? { session: { id: ROOT }, tree: null, members: 0 }
        : lineagePayload('Spawned child') });
    });
    await fleet.select(fleet.self);
    // The selection's own load reports no relatives yet: no chip to show.
    await expect.poll(() => reads, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#sessionRelations .session-relation-chip')).toHaveCount(0);
    // Only the repoll can fetch again — the family grew while the session ran.
    await expect.poll(async () => {
      const chip = page.locator('#sessionRelations .session-relation-chip');
      return await chip.count() ? await chip.first().textContent() : '';
    }, { timeout: 10000 }).toContain('Subagents · 1');
    expect(reads).toBeGreaterThanOrEqual(2);
  });
});

for (const close of [false, true]) test(`a late same-session search cannot overwrite ${close ? 'a closed bar' : 'a newer query'}`, async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  let held: Route | null | undefined;
  await page.route('**/api/sessions/*/search?q=old-query', route => { held = route; });
  await page.route('**/api/sessions/*/search?q=self', route => route.fulfill({ json: { matches: [{ index: 0, role: 'user' }] } }));
  await page.evaluate(() => { fixtureApp.features.sessionSearch.open(); window.oldNavigationSearch = fixtureApp.features.sessionSearch.run('old-query'); });
  await expect.poll(() => !!held).toBe(true);
  if (close) await page.evaluate(() => fixtureApp.features.sessionSearch.close());
  else await page.evaluate(() => fixtureApp.features.sessionSearch.run('self'));
  await requiredRoute(held).fulfill({ json: { matches: [{ index: 0, role: 'user' }] } });
  await page.evaluate(() => window.oldNavigationSearch);
  expect(await page.evaluate(() => fixtureApp.features.sessionSearch.state.query)).toBe(close ? '' : 'self');
  if (close) await expect(page.locator('#searchBar')).toBeHidden();
  else await expect(page.locator('mark.search-mark')).toHaveText('self');
});

export {};
