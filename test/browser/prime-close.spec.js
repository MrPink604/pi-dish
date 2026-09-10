const fs = require('node:fs');
const path = require('node:path');
const { test, expect, ROOT } = require('./fixtures');

async function configureSession(page, fleet, mode, close = true) {
  await fleet.select(fleet.peer);
  await page.evaluate(({ id, host, mode, close }) => patchSession(id, {
    isActive: true,
    // The same harness has different close semantics on old and new hosts.
    harnessId: 'prime',
    closeMode: mode,
    capabilities: { close, restart: false, export: false },
  }, host), { id: ROOT, host: fleet.peer.hostId, mode, close });
}

async function openStats(page) {
  await page.locator('#sessionContext').click();
  await expect(page.locator('#statsModal')).toBeVisible();
  await expect(page.locator('#statsClose')).toBeVisible();
}

test('Prime owned-agent close warns about the agent family and stays on its owning peer', async ({ page, fleet }) => {
  await configureSession(page, fleet, 'owned-agent');
  const close = fleet.row(fleet.peer).locator('.session-close-btn');
  await expect(close).toHaveAttribute('title', 'Stop this agent and its children (transcript stays resumable)');
  await close.click();
  await expect(close).toHaveText('close?');
  await expect(close).toHaveAttribute('title', 'Tap again: Stop this agent and its children (transcript stays resumable)');

  await openStats(page);
  await expect(page.locator('#statsClose')).toContainText('Close session');
  await expect(page.locator('#statsClose')).toContainText('Stops this agent and its children, then closes its pi-dish-owned client pane. The transcript stays resumable.');
  await expect(page.locator('#sessionRestartBtn')).toHaveCount(0);

  const artifact = path.resolve(__dirname, '../../.amp/in/artifacts/prime-close.png');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  await page.locator('#statsClose').scrollIntoViewIfNeeded();
  await page.screenshot({ path: artifact });

  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/close`, route => receive(route));
  const warning = new Promise(resolve => page.once('dialog', async dialog => {
    resolve(dialog.message());
    await dialog.accept();
  }));
  await page.locator('#sessionCloseBtn').click();
  expect(await warning).toBe('Stop this agent and its children? Any work in progress will be aborted; the transcript stays resumable.');
  const route = await received;
  expect(route.request().method()).toBe('POST');

  await fleet.select(fleet.self);
  await route.fulfill({ json: { success: true } });
  await expect(page.locator('#statsModal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => currentSession.host)).toBe(fleet.self.hostId);
  await expect(page.locator('#messages')).toContainText('self root transcript');
});

test('older client-only Prime session retains detach wording', async ({ page, fleet }) => {
  await configureSession(page, fleet, 'client-only');
  const close = fleet.row(fleet.peer).locator('.session-close-btn');
  await expect(close).toHaveAttribute('title', 'Detach client');
  await close.click();
  await expect(close).toHaveText('detach?');
  await expect(close).toHaveAttribute('title', 'Tap again: Detach client');

  await openStats(page);
  await expect(page.locator('#sessionCloseBtn')).toHaveText('Detach client');
  await expect(page.locator('#statsClose')).toContainText('Disconnects this client. The logical agent continues independently.');
  await expect(page.locator('#sessionRestartBtn')).toHaveCount(0);
});

test('unowned session with close capability disabled exposes no close control', async ({ page, fleet }) => {
  await configureSession(page, fleet, 'owned-agent', false);
  await expect(fleet.row(fleet.peer).locator('.session-close-btn')).toHaveCount(0);
  await page.locator('#sessionContext').click();
  await expect(page.locator('#statsModal')).toBeVisible();
  await expect(page.locator('#statsClose')).toHaveCount(0);
  await expect(page.locator('#sessionCloseBtn')).toHaveCount(0);
  await expect(page.locator('#sessionRestartBtn')).toHaveCount(0);
});
