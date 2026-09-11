const { test, expect, ROOT } = require('./fixtures');
test.use({ liveSessions: true });

for (const kind of ['Model', 'Thinking']) {
  test(`closing a pending ${kind.toLowerCase()} menu retires its catalog completion on the same session`, async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(kind => {
      const load = loadModels; loadModels = () => { loadModels = load; return new Promise(resolve => { window.finishHeaderCatalog = resolve; }); };
      window.headerMenu = kind === 'Model' ? toggleModelDropdown() : toggleThinkingDropdown();
      if (kind === 'Model') closeModelDropdown(); else closeThinkingDropdown();
    }, kind);
    await page.evaluate(async () => { window.finishHeaderCatalog(); await window.headerMenu; });
    await expect(page.locator('#' + kind.toLowerCase() + 'Dropdown')).toBeHidden();
    await page.evaluate(kind => kind === 'Model' ? toggleModelDropdown() : toggleThinkingDropdown(), kind);
    await expect(page.locator('#' + kind.toLowerCase() + 'Dropdown')).toBeVisible();
  });
}

test('a rename editor cannot commit its old text after selecting the same session id on another host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); let writes = 0;
  await page.route('**/api/sessions/*/rename', route => { writes++; return route.fulfill({ json: { success: true } }); });
  await page.evaluate(() => { startRename(); document.getElementById('sessionNameInput').value = 'Old peer edit'; });
  await fleet.select(fleet.self);
  await page.evaluate(() => { document.getElementById('sessionNameInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return commitRename(); });
  expect(writes).toBe(0);
});

test('out-of-order model mutations preserve the latest selection on their originating host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); const held = [];
  await page.route('**/api/sessions/*/model', route => { held.push(route); });
  await page.evaluate(() => {
    window.modelMutationWrites = []; const patch = sessionState.patchSession;
    sessionState.patchSession = (id, update, host) => { if (typeof update.model === 'string' && update.model.startsWith('test/')) window.modelMutationWrites.push(update.model); return patch(id, update, host); };
    window.firstModel = selectModel('test/first'); window.secondModel = selectModel('test/second');
  });
  await expect.poll(() => held.length).toBe(2);
  await held[1].fulfill({ json: { success: true } }); await page.evaluate(() => window.secondModel);
  await held[0].fulfill({ json: { success: true } }); await page.evaluate(() => window.firstModel);
  expect(await page.evaluate(() => window.modelMutationWrites)).toEqual(['test/second']);
});

test('enabled-model debounce retains the serving host preference after menu close and selection change', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let write;
  await page.route(`${fleet.self.base}/api/models?sessionId=${ROOT}`, route => route.fulfill({ json: [{ id: 'a', provider: 'p', enabled: true }, { id: 'b', provider: 'p', enabled: false }] }));
  await page.route('**/api/models/enabled', route => { write = { origin: new URL(route.request().url()).origin, body: route.request().postDataJSON() }; return route.fulfill({ json: { success: true } }); });
  await page.evaluate(async () => { await toggleModelDropdown(); enterModelEditMode(); toggleModelEnabled('p/a'); closeModelDropdown(); });
  await fleet.select(fleet.peer); await expect.poll(() => !!write).toBe(true);
  expect(write).toEqual({ origin: fleet.self.base, body: { enabledIds: [] } });
});

test('token export downloads the captured peer bytes after navigation and owns URL cleanup', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); let held;
  await page.route('**/api/sessions/*/export', route => { held = route; });
  await page.evaluate(() => {
    window.exports = []; window.revokedExports = []; window.downloadNames = [];
    URL.createObjectURL = blob => { window.exports.push(blob); return 'blob:fixture-export-' + window.exports.length; };
    URL.revokeObjectURL = url => window.revokedExports.push(url);
    HTMLAnchorElement.prototype.click = function () { window.downloadNames.push(this.download); };
    window.exportPromise = exportSession();
  });
  await expect.poll(() => !!held).toBe(true); expect(new URL(held.request().url()).origin).toBe(fleet.peer.base);
  await fleet.select(fleet.self);
  await held.fulfill({ body: '<h1>Peer export</h1>', headers: { 'content-type': 'text/html', 'content-disposition': "attachment; filename*=UTF-8''peer%20transcript.html" } });
  await page.evaluate(() => window.exportPromise);
  const value = await page.evaluate(async () => ({ name: window.downloadNames[0], text: await window.exports[0].text(), revoked: window.revokedExports.length }));
  expect(value).toEqual({ name: 'peer-root-transcript.html', text: '<h1>Peer export</h1>', revoked: 0 });
  await page.evaluate(() => sessionControls.dispose()); expect(await page.evaluate(() => window.revokedExports)).toEqual(['blob:fixture-export-1']);
});

test('tokenless export uses navigation and disposal retires pending exports and header controls', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const navigation = await page.evaluate(async () => {
    const calls = []; window.open = (...args) => { calls.push(args); return null; }; await exportSession(); return calls;
  });
  expect(navigation).toEqual([[`/api/sessions/${ROOT}/export`, '_blank']]);
  await fleet.select(fleet.peer); let held;
  await page.route('**/api/sessions/*/export', route => { held = route; });
  await page.evaluate(() => { window.exportBlobs = 0; URL.createObjectURL = () => { window.exportBlobs++; return 'blob:late'; }; window.lateExport = exportSession(); });
  await expect.poll(() => !!held).toBe(true); await page.evaluate(() => sessionControls.dispose());
  await held.fulfill({ body: 'late', contentType: 'text/html' }); await page.evaluate(() => window.lateExport);
  await page.locator('#sessionModel').click(); await page.locator('#sessionThinking').click(); await page.locator('#sessionName').click();
  expect(await page.evaluate(() => window.exportBlobs)).toBe(0); await expect(page.locator('#modelDropdown')).toBeHidden(); await expect(page.locator('#thinkingDropdown')).toBeHidden(); await expect(page.locator('#sessionNameInput')).toBeHidden();
});


test('overlapping peer exports both download after a later tokenless export', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); const held = [];
  await page.route('**/api/sessions/*/export', route => { held.push(route); });
  await page.evaluate(() => {
    window.exportedBlobs = []; URL.createObjectURL = blob => { window.exportedBlobs.push(blob); return 'blob:export-' + window.exportedBlobs.length; };
    HTMLAnchorElement.prototype.click = function () {}; window.open = () => null;
    window.exportOne = exportSession(); window.exportTwo = exportSession();
  });
  await expect.poll(() => held.length).toBe(2); await fleet.select(fleet.self); await page.evaluate(() => exportSession());
  await held[1].fulfill({ body: 'second peer export', contentType: 'text/html' }); await page.evaluate(() => window.exportTwo);
  await held[0].fulfill({ body: 'first peer export', contentType: 'text/html' }); await page.evaluate(() => window.exportOne);
  expect(await page.evaluate(() => Promise.all(window.exportedBlobs.map(blob => blob.text())))).toEqual(['second peer export', 'first peer export']);
});
