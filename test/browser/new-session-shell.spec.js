const { test, expect } = require('./fixtures');

test('workspace buttons retain their owning host and are retired on host change or close', async ({ page, fleet }) => {
  await page.evaluate(() => openNewSessionView({ cwd: '/initial' }));
  await expect(page.locator('#nsWorkspaces button')).not.toHaveCount(0);
  await page.evaluate(() => { window.oldWorkspaceButton = document.querySelector('#nsWorkspaces button'); });
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await page.fill('#newSessionCwd', '/peer-manual');
  await page.evaluate(() => window.oldWorkspaceButton.click());
  await expect(page.locator('#newSessionCwd')).toHaveValue('/peer-manual');
  await page.evaluate(() => { window.peerWorkspaceButton = document.querySelector('#nsWorkspaces button'); closeNewSessionView(); });
  await page.evaluate(() => window.peerWorkspaceButton.click());
  await expect(page.locator('#newSessionCwd')).toHaveValue('/peer-manual');
});

test('disposing the form retires late harness results, debounce callbacks and input listeners', async ({ page, fleet }) => {
  const reads = [];
  let modelReads = 0;
  await page.clock.install();
  await page.route('**/api/harnesses', route => { reads.push(route); });
  await page.route('**/api/models*', route => { modelReads++; return route.continue(); });
  await page.evaluate(() => openNewSessionView({ cwd: '/dispose' }));
  await expect.poll(() => reads.length).toBe(1);
  await page.evaluate(() => {
    window.disposedHarnessRead = loadHarnesses();
  });
  // Only the latest explicit load may settle, matching discovery sequence ownership.
  await expect.poll(() => reads.length).toBe(2);
  const beforeModels = modelReads;
  const before = await page.locator('#nsHarnessSelect').innerHTML();
  await page.evaluate(() => {
    newSessionController.scheduleRefresh();
    newSessionController.dispose();
    newSessionController.open({ cwd: '/must-not-open' });
  });
  for (const read of reads) await read.fulfill({ json: { harnesses: [{ id: 'new-harness', available: true }] } });
  await page.evaluate(() => window.disposedHarnessRead);
  await expect(page.locator('.main')).not.toHaveClass(/new-session-open/);
  expect(await page.locator('#nsHarnessSelect').innerHTML()).toBe(before);
  await page.evaluate(() => {
    const cwd = document.getElementById('newSessionCwd');
    cwd.dispatchEvent(new Event('focus')); cwd.dispatchEvent(new Event('input'));
  });
  await page.clock.runFor(1000);
  expect(modelReads).toBe(beforeModels);
  await expect(page.locator('#cwdDropdown')).toBeHidden();
  await expect(page.locator('#newSessionCwd')).toHaveValue('/dispose');
});


test('a closed-form view token stops owning asynchronous work after disposal', async ({ page, fleet }) => {
  const owns = await page.evaluate(() => {
    closeNewSessionView();
    const owns = newSessionController.captureView();
    const before = owns();
    const message = document.getElementById('nsError').textContent;
    newSessionController.dispose();
    newSessionController.error('must-not-write');
    return { before, after: owns(), message, current: document.getElementById('nsError').textContent };
  });
  expect(owns.before).toBe(true);
  expect(owns.after).toBe(false);
  expect(owns.current).toBe(owns.message);
});
