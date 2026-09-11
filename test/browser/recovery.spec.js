const { test, expect } = require('./fixtures');
const report = (name, mode = 'restore') => ({ mode, sessions: [{ id: 'same-id', name, status: 'needs-review', excluded: false }] });
async function settings(page, host) {
  await page.evaluate(() => openSettingsModal());
  await page.selectOption('#recoverySettingsHost', host.hostId);
  await expect(page.locator('#saveRecoveryMode')).toBeEnabled();
}

test('a settings body from an old host cannot replace a new host mode or an unsaved mode during fleet refresh', async ({ page, fleet }) => {
  await settings(page, fleet.peer);
  await page.evaluate(host => {
    const nativeFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await nativeFetch(...args);
      if (new URL(String(args[0]), location.href).href === host + '/api/settings') {
        const json = res.json.bind(res);
        res.json = async () => { const body = await json(); window.recoveryBodyWaiting = true; await new Promise(resolve => { window.releaseRecoveryBody = resolve; }); return { ...body, recoveryMode: 'continue' }; };
      }
      return res;
    };
  }, fleet.self.base);
  await page.selectOption('#recoverySettingsHost', fleet.self.hostId);
  await page.waitForFunction(() => window.recoveryBodyWaiting);
  await page.selectOption('#recoverySettingsHost', fleet.peer.hostId);
  await expect(page.locator('#saveRecoveryMode')).toBeEnabled();
  await page.selectOption('#recoveryMode', 'restore');
  await page.evaluate(() => { window.releaseRecoveryBody(); refreshRecoveryHosts(); });
  await expect(page.locator('#recoveryMode')).toHaveValue('restore');
});

test('old preference save failures and retained buttons cannot act on a replacement settings view', async ({ page, fleet }) => {
  await settings(page, fleet.self);
  const writes = [];
  await page.route('**/api/settings', route => route.request().method() === 'PUT' ? writes.push(route) : route.continue());
  await page.selectOption('#recoveryMode', 'restore');
  await page.evaluate(() => { window.oldRecoverySave = document.getElementById('saveRecoveryMode'); window.oldRecoverySave.click(); });
  await expect.poll(() => writes.length).toBe(1);
  await page.evaluate(() => closeSettingsModal());
  await settings(page, fleet.peer);
  await writes[0].fulfill({ status: 500, json: { error: 'previous-save-error' } });
  await page.evaluate(() => { window.oldRecoverySave.disabled = false; window.oldRecoverySave.click(); });
  await expect(page.locator('#recoverySettingsStatus')).not.toContainText('previous-save-error');
  expect(writes).toHaveLength(1);
  expect(new URL(writes[0].request().url()).origin).toBe(fleet.self.base);
  expect(writes[0].request().postDataJSON()).toEqual({ recoveryMode: 'restore' });
});

test('report requests and retained restore actions retire with the selected host and view', async ({ page, fleet }) => {
  let held;
  const writes = [];
  await page.route(`${fleet.self.base}/api/recovery`, route => { held = route; });
  await page.route(`${fleet.peer.base}/api/recovery`, route => route.fulfill({ json: report('Peer record', 'constructor') }));
  await page.route('**/api/recovery/retry', route => { writes.push(route); return route.fulfill({ json: { ok: true } }); });
  await page.evaluate(host => openRecoveryView(host), fleet.self.hostId);
  await expect.poll(() => !!held).toBe(true);
  await page.selectOption('#recoveryReportHost', fleet.peer.hostId);
  await expect(page.locator('.recovery-list')).toContainText('Peer record');
  await held.fulfill({ json: report('Old record') });
  await expect(page.locator('.recovery-list')).toContainText('Peer record');
  await expect(page.locator('#recoveryViewBody')).toContainText('constructor');
  await page.evaluate(async () => {
    window.retiredRestore = document.querySelector('.recovery-restore');
    await loadRecoveryView();
    window.retiredRestore.click();
    window.closedRestore = document.querySelector('.recovery-restore');
    closeRecoveryView();
    window.closedRestore.click();
  });
  expect(writes).toHaveLength(0);
});

test('a queued exclusion keeps its host and late completion cannot reload another report', async ({ page, fleet }) => {
  let held;
  let peerReads = 0;
  await page.route(`${fleet.self.base}/api/recovery`, route => route.fulfill({ json: report('Self record') }));
  await page.route(`${fleet.peer.base}/api/recovery`, route => { peerReads++; return route.fulfill({ json: report('Peer record') }); });
  await page.route('**/api/sessions/same-id/recovery', route => { held = route; });
  await page.evaluate(host => openRecoveryView(host), fleet.self.hostId);
  await page.locator('.recovery-excluded').check();
  await expect.poll(() => !!held).toBe(true);
  await page.selectOption('#recoveryReportHost', fleet.peer.hostId);
  await expect(page.locator('.recovery-list')).toContainText('Peer record');
  await held.fulfill({ json: { ok: true } });
  await expect(page.locator('.recovery-excluded')).not.toBeChecked();
  expect(peerReads).toBe(1);
  expect(new URL(held.request().url()).origin).toBe(fleet.self.base);
  expect(held.request().postDataJSON()).toEqual({ excluded: true });
});

test('changed endpoint credentials retire displayed report actions and trigger an owned refresh', async ({ page, fleet }) => {
  const reads = [], writes = [];
  await page.route(`${fleet.peer.base}/api/recovery`, route => { reads.push(route.request().headers().authorization); return route.fulfill({ json: report(reads.length === 1 ? 'Before token edit' : 'After token edit') }); });
  await page.route('**/api/recovery/retry', route => { writes.push(route); return route.fulfill({ json: { ok: true } }); });
  await page.evaluate(host => openRecoveryView(host), fleet.peer.hostId);
  await expect(page.locator('.recovery-list')).toContainText('Before token edit');
  await page.evaluate(host => {
    window.oldTokenRestore = document.querySelector('.recovery-restore');
    hostDirectory.setToken(host, 'new-fixture-token');
    window.oldTokenRestore.click();
    refreshRecoveryHosts();
  }, fleet.peer.hostId);
  await expect(page.locator('.recovery-list')).toContainText('After token edit');
  await page.evaluate(() => window.oldTokenRestore.click());
  expect(writes).toHaveLength(0);
  expect(reads).toEqual([`Bearer ${fleet.peer.token}`, 'Bearer new-fixture-token']);
});
