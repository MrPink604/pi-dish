const { test, expect, ROOT } = require('./fixtures');
const pages = label => [{ token: 'shared-page', root: '/fixture/plan.html', path: '/p/shared-page', title: label + ' plan', createdAt: Date.now() }];
async function setup(page, fleet) {
  await page.route('**/api/sessions/*/stats', route => route.fulfill({ json: { model: new URL(route.request().url()).origin === fleet.self.base ? 'Self model' : 'Peer model', cwd: '/fixture/project', costs: { total: 0.5 } } }));
  await page.route('**/api/pages?*', route => route.fulfill({ json: pages(new URL(route.request().url()).origin === fleet.self.base ? 'Self' : 'Peer') }));
  await page.route('**/api/sessions/*/share', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 404, json: { error: 'No share' } }) : route.fulfill({ json: { url: 'https://fixture.invalid/shared' } }));
  await page.evaluate(() => { window.infoCopies = []; navigator.clipboard.writeText = async text => { window.infoCopies.push(text); }; });
}

test('stats controls from an earlier opening cannot copy publish revoke or close', async ({ page, fleet }) => {
  await setup(page, fleet); await fleet.select(fleet.self);
  await page.evaluate(() => window.fixtureSessionListPatch(fixtureApp.features.sessionState.currentSession.id, { isActive: true, capabilities: { close: true, export: true } }, fixtureApp.features.sessionState.currentSession.host));
  let writes = 0, dialogs = 0;
  page.on('dialog', async dialog => { dialogs++; await dialog.accept(); });
  await page.route('**/api/**', route => { if (route.request().method() !== 'GET') writes++; return route.fallback(); });
  await page.evaluate(() => fixtureApp.features.sessionInfo.openStats());
  await expect(page.locator('#statsPages .stats-page-row')).toHaveCount(1);
  await expect(page.locator('#sessionCloseBtn')).toBeVisible();
  await page.evaluate(() => {
    window.oldInfoControls = [document.getElementById('shareCreateBtn'), document.querySelector('.stats-page-revoke'), document.querySelector('.stats-copy'), document.getElementById('sessionCloseBtn')];
    fixtureApp.features.sessionInfo.closeStats(); fixtureApp.features.sessionInfo.openStats();
  });
  await expect(page.locator('#shareCreateBtn')).toBeVisible();
  await page.evaluate(() => window.oldInfoControls.forEach(button => button.click()));
  expect(writes).toBe(0); expect(dialogs).toBe(0); expect(await page.evaluate(() => window.infoCopies)).toEqual([]);
  await page.locator('#shareCreateBtn').click();
  await expect(page.locator('#statsShare .stats-share-link')).toBeVisible();
  expect(writes).toBe(1);
});

test('a late existing share response cannot overwrite the clipboard after changing hosts', async ({ page, fleet }) => {
  await setup(page, fleet); await fleet.select(fleet.peer);
  let held;
  await page.route(fleet.peer.base + `/api/sessions/${ROOT}/share`, route => { held = route; });
  await page.evaluate(() => { const button = document.createElement('button'); button.dataset.entryId = 'entry'; window.shareCopy = fixtureApp.features.sessionInfo.copyMessage(button); });
  await expect.poll(() => !!held).toBe(true);
  await fleet.select(fleet.self);
  await held.fulfill({ json: { url: 'https://fixture.invalid/old-peer' } });
  await page.evaluate(() => window.shareCopy);
  expect(await page.evaluate(() => window.infoCopies)).toEqual([]);
});

test('share and page mutation failures keep live controls and report the server error', async ({ page, fleet }) => {
  await setup(page, fleet); await fleet.select(fleet.self);
  await page.route(fleet.self.base + `/api/sessions/${ROOT}/share`, route => route.request().method() === 'POST'
    ? route.fulfill({ status: 500, json: { error: 'share rejected' } }) : route.fallback());
  await page.route('**/api/pages/shared-page', route => route.fulfill({ status: 500, json: { error: 'page rejected' } }));
  await page.evaluate(() => fixtureApp.features.sessionInfo.openStats());
  await page.locator('#shareCreateBtn').click();
  await expect(page.locator('#status')).toContainText('share rejected');
  await expect(page.locator('#shareCreateBtn')).toBeEnabled();
  await expect(page.locator('#statsShare .stats-share-link')).toHaveCount(0);
  await page.locator('.stats-page-revoke').click();
  await expect(page.locator('#status')).toContainText('page rejected');
  await expect(page.locator('.stats-page-revoke')).toBeEnabled();
  await expect(page.locator('.stats-page-row')).toHaveCount(1);
});

test('artifact controls retire on close and live same-token revokes use their answering host', async ({ page, fleet }) => {
  await setup(page, fleet); await fleet.select(fleet.self);
  const writes = [];
  await page.route('**/api/pages/shared-page', route => { writes.push(new URL(route.request().url()).origin); return route.fulfill({ json: { ok: true } }); });
  await page.evaluate(() => fixtureApp.features.sessionInfo.openArtifacts());
  await expect(page.locator('#artifactsBody')).toContainText('Self plan');
  await page.evaluate(() => {
    window.oldArtifacts = [...document.querySelectorAll('#artifactsBody button')]; fixtureApp.features.sessionInfo.closeArtifacts(); window.oldArtifacts.forEach(button => button.click());
  });
  expect(writes).toEqual([]); expect(await page.evaluate(() => window.infoCopies)).toEqual([]);
  await fleet.select(fleet.peer); await page.evaluate(() => fixtureApp.features.sessionInfo.openArtifacts());
  await expect(page.locator('#artifactsBody')).toContainText('Peer plan');
  await page.locator('.artifact-revoke').click();
  await expect.poll(() => writes.length).toBe(1); expect(writes).toEqual([fleet.peer.base]);
});

test('session-info disposal ignores held stats and artifact reads and retained copy timers', async ({ page, fleet }) => {
  await page.clock.install(); await setup(page, fleet); await fleet.select(fleet.self);
  await page.evaluate(() => fixtureApp.features.sessionInfo.openStats());
  await expect(page.locator('.stats-table')).toBeVisible();
  await page.locator('.stats-copy').first().click();
  await expect(page.locator('.stats-copy').first()).toHaveClass(/copied/);
  let stats;
  const artifacts = [];
  await page.route('**/api/sessions/*/stats', route => { stats = route; });
  await page.route('**/api/pages?*', route => { artifacts.push(route); });
  await page.evaluate(() => { fixtureApp.features.sessionInfo.openStats(); fixtureApp.features.sessionInfo.openArtifacts(); });
  await expect.poll(() => !!stats && artifacts.length > 0).toBe(true);
  await page.evaluate(() => { fixtureApp.features.sessionInfo.dispose(); window.disposedInfoBody = document.getElementById('statsBody').innerHTML; });
  await stats.fulfill({ json: { model: 'Late stats' } });
  for (const route of artifacts) await route.fulfill({ json: pages('Late') });
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => document.getElementById('statsBody').innerHTML)).toBe(await page.evaluate(() => window.disposedInfoBody));
  await expect(page.locator('#statsModal')).not.toBeVisible();
  await expect(page.locator('#artifactsModal')).not.toBeVisible();
});
