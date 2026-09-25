import type { Route } from '@playwright/test';
import { test, expect, ROOT, requiredRoute } from './fixtures.js';
test.use({ liveSessions: true });

test('file debounce captures the original host before selection changes', async ({ page, fleet }) => {
  await fleet.select(fleet.self); const calls: string[] = [];
  await page.route('**/api/sessions/*/files?*', route => { calls.push(route.request().url()); return route.fulfill({ json: { files: [] } }); });
  await page.evaluate(async ({ id, host }) => { const input = fixtureElement(document.querySelector<HTMLInputElement>('#promptInput'), '#promptInput'); input.value = '@old'; input.setSelectionRange(4, 4); input.dispatchEvent(new Event('input')); await fixtureApp.features.sessionView.select(id, { host }); }, { id: ROOT, host: fleet.peer.hostId });
  await page.waitForTimeout(180); expect(calls).toEqual([]); await expect(page.locator('#autocomplete')).toBeHidden();
});

test('a late file lookup cannot overwrite a new same-id peer completion', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let held: Route | null | undefined;
  await page.route('**/api/sessions/*/files?*', route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'old') { held = route; return; }
    return route.fulfill({ json: { files: [{ path: 'new.txt' }] } });
  });
  await page.locator('#promptInput').fill('@old'); await expect.poll(() => !!held).toBe(true);
  await fleet.select(fleet.peer); await page.locator('#promptInput').fill('@new'); await expect(page.locator('.autocomplete-item')).toContainText('new.txt');
  await requiredRoute(held).fulfill({ json: { files: [{ path: 'old.txt' }] } }); await expect(page.locator('.autocomplete-item')).toContainText('new.txt');
});

test('caret movement retires a pending completion and retained rows cannot fill a new query', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let held: Route | null | undefined;
  await page.route('**/api/sessions/*/files?*', route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'hold') { held = route; return; }
    return route.fulfill({ json: { files: [{ path: 'first.txt' }] } });
  });
  await page.locator('#promptInput').fill('@first'); await expect(page.locator('.autocomplete-item')).toBeVisible();
  await page.evaluate(() => { window.oldCompletion = document.querySelector<HTMLElement>('.autocomplete-item'); });
  await page.locator('#promptInput').fill('@hold'); await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => { fixtureElement(document.querySelector<HTMLInputElement>('#promptInput'), '#promptInput').setSelectionRange(0, 0); fixtureElement(window.oldCompletion, 'old completion').click(); });
  await requiredRoute(held).fulfill({ json: { files: [{ path: 'held.txt' }] } });
  await expect(page.locator('#promptInput')).toHaveValue('@hold'); await expect(page.locator('#autocomplete')).toBeHidden();
});

test('file selection persists the draft and directory selection drills into its next query', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route('**/api/sessions/*/files?*', route => route.fulfill({ json: { files: [new URL(route.request().url()).searchParams.get('q') === 'dir/' ? { path: 'dir/file.txt' } : { path: 'dir', isDir: true }] } }));
  await page.locator('#promptInput').fill('@dir'); await page.locator('.autocomplete-item[data-dir]').click();
  await expect(page.locator('#promptInput')).toHaveValue('@dir/'); await page.locator('.autocomplete-item[data-file="dir/file.txt"]').click();
  await expect(page.locator('#promptInput')).toHaveValue('@dir/file.txt ');
  await expect.poll(() => page.evaluate(() => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(fixtureElement(fixtureApp.features.composerDrafts.key, 'composer draft key'))))).toBe('@dir/file.txt ');
});

test('late command catalogs cannot replace the current host and command labels remain literal', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let held: Route | null | undefined;
  await page.route('**/api/commands?*', route => {
    if (new URL(route.request().url()).origin === fleet.self.base) { held = route; return; }
    return route.fulfill({ json: [null, { name: 1 }, { name: 'new<literal>', description: '<img>', args: '<arg>', source: 'extension' }] });
  });
  await page.evaluate(() => { window.oldCommands = fixtureApp.features.composerAutocomplete.loadCommands(fixtureCurrentSession().id); }); await expect.poll(() => !!held).toBe(true);
  await fleet.select(fleet.peer); await page.evaluate(() => fixtureApp.features.composerAutocomplete.loadCommands(fixtureCurrentSession().id));
  await requiredRoute(held).fulfill({ json: [{ name: 'old-command' }] }); await page.evaluate(() => window.oldCommands);
  await page.locator('#promptInput').fill('/ne'); await expect(page.locator('.autocomplete-item')).toContainText('/new<literal>'); await expect(page.locator('#autocomplete img')).toHaveCount(0);
  await page.locator('.autocomplete-item').click(); await expect(page.locator('#promptInput')).toHaveValue('/new<literal> ');
});

test('reference completions retain the target-host reference and persist it', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await page.locator('#promptInput').fill('#peer');
  await expect(page.locator('.autocomplete-item[data-session-ref]').first()).toBeVisible(); const ref = await page.locator('.autocomplete-item[data-session-ref]').first().getAttribute('data-session-ref');
  if (ref === null) throw new Error('Completion lacks session reference');
  await page.locator('.autocomplete-item[data-session-ref]').first().click(); await expect(page.locator('#promptInput')).toHaveValue('#' + ref + ' ');
  await expect.poll(() => page.evaluate(() => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(fixtureElement(fixtureApp.features.composerDrafts.key, 'composer draft key'))))).toBe('#' + ref + ' ');
});

test('autocomplete disposal retires pending lookups and removed row controls', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let held: Route | null | undefined;
  await page.route('**/api/sessions/*/files?*', route => { held = route; });
  await page.locator('#promptInput').fill('@pending'); await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => fixtureApp.features.composerAutocomplete.dispose()); await requiredRoute(held).fulfill({ json: { files: [{ path: 'late.txt' }] } });
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

test('OMP model mention selects a child agent without changing the parent model', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route('**/api/models?sessionId=*', route => route.fulfill({ json: [
    { provider: 'opencode', id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 128000, reasoning: true, free: false, pricing: null },
    { provider: 'other', id: 'unrelated', name: 'Unrelated', contextWindow: 128000, reasoning: false, free: false, pricing: null },
  ] }));
  await page.evaluate(() => { window.fixtureSessionListPatch(fixtureCurrentSession().id, { harnessId: 'omp', model: 'openai-codex/gpt-6-sol' }); });
  await page.locator('#promptInput').fill('Ask ^deepseek');
  await expect(page.locator('.autocomplete-item[data-model-selector="opencode/deepseek-v4.1-flash"]')).toBeVisible();
  await page.locator('.autocomplete-item[data-model-selector="opencode/deepseek-v4.1-flash"]').click();
  await expect(page.locator('#promptInput')).toHaveValue('Ask ^opencode/deepseek-v4.1-flash ');
  const parentModel = await page.evaluate(() => fixtureCurrentSession().model);
  const sent: string[] = [];
  const modelChanges: string[] = [];
  await page.route('**/api/sessions/*/model', route => { modelChanges.push(route.request().url()); return route.abort(); });
  await page.route('**/api/sessions/*/prompt', route => {
    const body: unknown = route.request().postDataJSON();
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') sent.push(body.message);
    return route.fulfill({ json: { success: true, result: {} } });
  });
  await page.locator('#promptInput').fill('Ask ^opencode/deepseek-v4.1-flash to review this change');
  await page.locator('#promptInput').press('Enter');
  await expect.poll(() => sent).toEqual(['Ask ^opencode/deepseek-v4.1-flash to review this change']);
  expect(await page.evaluate(() => fixtureCurrentSession().model)).toBe(parentModel);
  expect(modelChanges).toEqual([]);
  await page.evaluate(() => fixtureApp.features.sessionActivity.setTurn(true));
  await page.locator('#promptInput').fill('Ask ^opencode/deepseek-v4.1-flash again');
  await page.locator('#promptInput').press('Enter');
  await expect(page.locator('#promptInput')).toHaveValue('Ask ^opencode/deepseek-v4.1-flash again');
  expect(sent).toHaveLength(1);
});
export {};
