const { test, expect } = require('./fixtures');
const operation = (id, status = 'waiting', mode = 'reload') => ({ id, mode, createdAt: '2026-09-11T00:00:00Z', targets: [{ sessionId: 'same-id', name: id, harnessId: 'pi', status }] });
const preview = name => ({ targets: [{ sessionId: 'same-id', name, harnessId: 'pi', eligible: true, blockers: [] }] });
async function routes(page) {
  await page.route('**/api/session-bounces/preview?*', route => route.fulfill({ json: preview('Target') }));
  await page.route('**/api/session-bounces', route => route.fulfill({ json: { operations: [] } }));
}
async function open(page) {
  await page.evaluate(() => fixtureApp.features.displayPreferences.open());
  await page.locator('#openBounceAgents').click();
  await expect(page.locator('.bounce-host')).toHaveCount(2);
}

test('late preview replies and retained target/cancel controls retire with their view', async ({ page, fleet }) => {
  await routes(page);
  let held;
  const deletes = [];
  await page.route(`${fleet.self.base}/api/session-bounces/preview?mode=reload`, route => { held = route; });
  await page.route('**/api/session-bounces', route => route.fulfill({ json: { operations: [operation('waiting-op')] } }));
  await page.route('**/api/session-bounces/waiting-op', route => { deletes.push(route); return route.fulfill({ json: { operation: operation('waiting-op', 'cancelled') } }); });
  await open(page);
  await expect.poll(() => !!held).toBe(true);
  await page.selectOption('#bounceMode', 'restart');
  await expect(page.locator('.bounce-target')).toHaveCount(2);
  await held.fulfill({ json: preview('Old reload preview') });
  await expect(page.locator('#bounceHosts')).not.toContainText('Old reload preview');
  await expect(page.locator('[data-bounce-cancel]')).toHaveCount(2);
  await page.evaluate(async () => {
    window.retiredBounceInput = document.querySelector('[data-bounce-target]');
    window.retiredBounceCancel = document.querySelector('[data-bounce-cancel]');
    await fixtureApp.features.bounceController.refresh();
    window.retiredBounceInput.checked = true;
    window.retiredBounceInput.dispatchEvent(new Event('change'));
    window.retiredBounceCancel.click();
  });
  await expect(page.locator('#bounceSubmit')).toHaveText('Queue Restart (0)');
  await expect(page.locator('[data-bounce-cancel]')).toHaveCount(2);
  await page.evaluate(() => { const button = document.querySelector('[data-bounce-cancel]'); fixtureApp.features.bounceController.close(); button.click(); });
  expect(deletes).toHaveLength(0);
});

test('a submitted host snapshot survives close and its lost response cannot alter a new settings view', async ({ page, fleet }) => {
  await routes(page);
  let held;
  await page.route(`${fleet.peer.base}/api/session-bounces`, route => route.request().method() === 'POST' ? held = route : route.fulfill({ json: { operations: [] } }));
  await open(page);
  await page.selectOption('#bounceMode', 'restart');
  await expect(page.locator('.bounce-target')).toHaveCount(2);
  await page.locator('.bounce-host').filter({ hasText: 'peer' }).locator('[data-bounce-target]').check();
  await page.evaluate(() => { window.bounceSubmission = fixtureApp.features.bounceController.submit(); });
  await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => { fixtureApp.ports.appBindings.actions.closeSettingsModal(); fixtureApp.features.recoveryController.open(); });
  await held.fulfill({ status: 500, json: { error: 'old-queue-error' } });
  await page.evaluate(() => window.bounceSubmission);
  await expect(page.locator('.main')).toHaveClass(/recovery-open/);
  await expect(page.locator('#settingsModal')).toBeHidden();
  expect(held.request().postDataJSON()).toEqual({ mode: 'restart', sessionIds: ['same-id'] });
  expect(held.request().headers().authorization).toBe(`Bearer ${fleet.peer.token}`);
});

test('an older status read cannot erase a newly accepted operation', async ({ page, fleet }) => {
  await routes(page);
  let oldRead;
  await page.route(`${fleet.self.base}/api/session-bounces`, route => {
    if (route.request().method() === 'GET') oldRead = route;
    else return route.fulfill({ json: { operation: operation('accepted-operation') } });
  });
  await open(page);
  await expect.poll(() => !!oldRead).toBe(true);
  await page.locator('.bounce-host').first().locator('[data-bounce-target]').check();
  await page.evaluate(() => fixtureApp.features.bounceController.submit());
  await expect(page.locator('.bounce-host').first()).toContainText('accepted-operation');
  await oldRead.fulfill({ json: { operations: [] } });
  await expect(page.locator('.bounce-host').first()).toContainText('accepted-operation');
});

test('disposal stops polling and rejects retained controls after held status responses', async ({ page, fleet }) => {
  await routes(page);
  await page.clock.install();
  const reads = [];
  await page.route('**/api/session-bounces', route => { reads.push(route); });
  await open(page);
  await expect.poll(() => reads.length).toBe(2);
  await page.evaluate(() => fixtureApp.features.bounceController.dispose());
  for (const route of reads) await route.fulfill({ json: { operations: [operation('late-operation')] } });
  await page.clock.runFor(6000);
  expect(reads).toHaveLength(2);
  await expect(page.locator('#bounceHosts')).not.toContainText('late-operation');
  await expect(page.locator('#bounceMode')).toBeHidden();
});
