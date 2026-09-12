const { test, expect, ROOT } = require('./fixtures');
test.use({ liveSessions: true });

test('file debounce captures the original host before selection changes', async ({ page, fleet }) => {
  await fleet.select(fleet.self); const calls = [];
  await page.route('**/api/sessions/*/files?*', route => { calls.push(route.request().url()); return route.fulfill({ json: { files: [] } }); });
  await page.evaluate(async ({ id, host }) => { const input = document.getElementById('promptInput'); input.value = '@old'; input.setSelectionRange(4, 4); input.dispatchEvent(new Event('input')); await fixtureApp.features.sessionView.select(id, { host }); }, { id: ROOT, host: fleet.peer.hostId });
  await page.waitForTimeout(180); expect(calls).toEqual([]); await expect(page.locator('#autocomplete')).toBeHidden();
});

test('a late file lookup cannot overwrite a new same-id peer completion', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let held;
  await page.route('**/api/sessions/*/files?*', route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'old') { held = route; return; }
    return route.fulfill({ json: { files: [{ path: 'new.txt' }] } });
  });
  await page.locator('#promptInput').fill('@old'); await expect.poll(() => !!held).toBe(true);
  await fleet.select(fleet.peer); await page.locator('#promptInput').fill('@new'); await expect(page.locator('.autocomplete-item')).toContainText('new.txt');
  await held.fulfill({ json: { files: [{ path: 'old.txt' }] } }); await expect(page.locator('.autocomplete-item')).toContainText('new.txt');
});

test('caret movement retires a pending completion and retained rows cannot fill a new query', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let held;
  await page.route('**/api/sessions/*/files?*', route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'hold') { held = route; return; }
    return route.fulfill({ json: { files: [{ path: 'first.txt' }] } });
  });
  await page.locator('#promptInput').fill('@first'); await expect(page.locator('.autocomplete-item')).toBeVisible();
  await page.evaluate(() => { window.oldCompletion = document.querySelector('.autocomplete-item'); });
  await page.locator('#promptInput').fill('@hold'); await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => { document.getElementById('promptInput').setSelectionRange(0, 0); window.oldCompletion.click(); });
  await held.fulfill({ json: { files: [{ path: 'held.txt' }] } });
  await expect(page.locator('#promptInput')).toHaveValue('@hold'); await expect(page.locator('#autocomplete')).toBeHidden();
});

test('file selection persists the draft and directory selection drills into its next query', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route('**/api/sessions/*/files?*', route => route.fulfill({ json: { files: [new URL(route.request().url()).searchParams.get('q') === 'dir/' ? { path: 'dir/file.txt' } : { path: 'dir', isDir: true }] } }));
  await page.locator('#promptInput').fill('@dir'); await page.locator('.autocomplete-item[data-dir]').click();
  await expect(page.locator('#promptInput')).toHaveValue('@dir/'); await page.locator('.autocomplete-item[data-file="dir/file.txt"]').click();
  await expect(page.locator('#promptInput')).toHaveValue('@dir/file.txt ');
  await expect.poll(() => page.evaluate(() => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(fixtureApp.features.composerDrafts.key)))).toBe('@dir/file.txt ');
});

test('late command catalogs cannot replace the current host and command labels remain literal', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let held;
  await page.route('**/api/commands?*', route => {
    if (new URL(route.request().url()).origin === fleet.self.base) { held = route; return; }
    return route.fulfill({ json: [null, { name: 1 }, { name: 'new<literal>', description: '<img>', args: '<arg>', source: 'extension' }] });
  });
  await page.evaluate(() => { window.oldCommands = fixtureApp.features.composerAutocomplete.loadCommands(fixtureApp.features.sessionState.currentSession.id); }); await expect.poll(() => !!held).toBe(true);
  await fleet.select(fleet.peer); await page.evaluate(() => fixtureApp.features.composerAutocomplete.loadCommands(fixtureApp.features.sessionState.currentSession.id));
  await held.fulfill({ json: [{ name: 'old-command' }] }); await page.evaluate(() => window.oldCommands);
  await page.locator('#promptInput').fill('/ne'); await expect(page.locator('.autocomplete-item')).toContainText('/new<literal>'); await expect(page.locator('#autocomplete img')).toHaveCount(0);
  await page.locator('.autocomplete-item').click(); await expect(page.locator('#promptInput')).toHaveValue('/new<literal> ');
});

test('reference completions retain the target-host reference and persist it', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await page.locator('#promptInput').fill('#peer');
  await expect(page.locator('.autocomplete-item[data-session-ref]').first()).toBeVisible(); const ref = await page.locator('.autocomplete-item[data-session-ref]').first().getAttribute('data-session-ref');
  await page.locator('.autocomplete-item[data-session-ref]').first().click(); await expect(page.locator('#promptInput')).toHaveValue('#' + ref + ' ');
  await expect.poll(() => page.evaluate(() => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(fixtureApp.features.composerDrafts.key)))).toBe('#' + ref + ' ');
});

test('autocomplete disposal retires pending lookups and removed row controls', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let held;
  await page.route('**/api/sessions/*/files?*', route => { held = route; });
  await page.locator('#promptInput').fill('@pending'); await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => fixtureApp.features.composerAutocomplete.dispose()); await held.fulfill({ json: { files: [{ path: 'late.txt' }] } });
  await expect(page.locator('#autocomplete')).toBeHidden(); await page.evaluate(() => fixtureApp.features.composerAutocomplete.handle('@other')); await expect(page.locator('#autocomplete')).toBeHidden();
});

test('moving the caret hides an already displayed completion immediately', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route('**/api/sessions/*/files?*', route => route.fulfill({ json: { files: [{ path: 'first.txt' }] } }));
  await page.locator('#promptInput').fill('@first'); await expect(page.locator('.autocomplete-item')).toBeVisible();
  await page.locator('#promptInput').press('ArrowLeft');
  await expect(page.locator('#autocomplete')).toBeHidden();
  expect(await page.evaluate(() => fixtureApp.features.composerAutocomplete.visible)).toBe(false);
  await expect(page.locator('#promptInput')).toHaveValue('@first');
});
