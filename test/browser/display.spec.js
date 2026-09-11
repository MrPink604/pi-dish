const { test, expect } = require('./fixtures');

test('closed preferences retire retained device, theme, filter and budget controls', async ({ page, fleet }) => {
  let writes = 0;
  await page.route('**/api/settings', route => {
    if (route.request().method() === 'PUT') writes++;
    return route.fulfill({ json: { monthlyBudgetUsd: 12, savedFilters: [{ name: 'Keep', query: 'active:true' }] } });
  });
  await page.evaluate(() => openSettingsModal());
  await expect(page.locator('#saveBudget')).toBeEnabled();
  await page.evaluate(() => {
    window.oldDisplayControls = ['responseMetadataMode', 'settingsTheme', 'sidebarContextMetric', 'saveBudget'].map(id => document.getElementById(id));
    window.oldFilterDelete = document.querySelector('.saved-filter-del');
    closeSettingsModal();
    const [mode, theme, metric, save] = window.oldDisplayControls;
    mode.value = 'hidden'; mode.dispatchEvent(new Event('change'));
    theme.value = 'graphite'; theme.dispatchEvent(new Event('change'));
    metric.value = 'tokens'; metric.dispatchEvent(new Event('change'));
    save.click(); window.oldFilterDelete.click();
  });
  expect(writes).toBe(0);
  expect(await page.evaluate(() => [displayPreferences.responseMode, displayPreferences.contextMetric, localStorage.getItem('pi-dish-theme')])).toEqual(['compact', 'percent', null]);
  await page.evaluate(() => openSettingsModal());
  await page.selectOption('#sidebarContextMetric', 'tokens');
  expect(await page.evaluate(() => displayPreferences.contextMetric)).toBe('tokens');
});

test('old settings reads and budget saves cannot overwrite a reopened modal', async ({ page, fleet }) => {
  let oldRead, oldSave, reads = 0;
  await page.route('**/api/settings', route => {
    if (route.request().method() === 'PUT') { oldSave = route; return; }
    if (++reads === 1) { oldRead = route; return; }
    return route.fulfill({ json: { monthlyBudgetUsd: 27, savedFilters: [] } });
  });
  await page.evaluate(() => openSettingsModal());
  await expect.poll(() => !!oldRead).toBe(true);
  await page.evaluate(() => { closeSettingsModal(); openSettingsModal(); });
  await expect(page.locator('#monthlyBudget')).toHaveValue('27');
  await oldRead.fulfill({ json: { monthlyBudgetUsd: 5, savedFilters: [{ name: 'Old', query: 'old' }] } });
  await expect(page.locator('#monthlyBudget')).toHaveValue('27');
  await expect(page.locator('#savedFiltersList')).not.toContainText('Old');
  await page.locator('#saveBudget').click();
  await expect.poll(() => !!oldSave).toBe(true);
  await page.evaluate(() => { closeSettingsModal(); openSettingsModal(); });
  await expect(page.locator('#saveBudget')).toBeEnabled();
  await oldSave.fulfill({ status: 500, json: { error: 'old failure' } });
  await expect(page.locator('#budgetStatus')).toHaveText('');
});

test('theme refresh retains the latest catalog and disposal drops a held response', async ({ page, fleet }) => {
  let held, reads = 0;
  await page.route('**/api/themes', route => {
    if (++reads === 1) { held = route; return; }
    return route.fulfill({ json: { themes: [{ id: 'custom', tokens: { '--accent': '#123456' } }] } });
  });
  await page.evaluate(() => { localStorage.setItem('pi-dish-theme', 'custom'); void loadThemes(); });
  await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => loadThemes());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom');
  await held.fulfill({ json: { themes: [{ id: 'obsolete', tokens: { '--accent': '#abcdef' } }] } });
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toBe('#123456');
  await page.unroute('**/api/themes');
  held = null;
  await page.route('**/api/themes', route => { held = route; });
  await page.evaluate(() => { void loadThemes(); });
  await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => themesController.dispose());
  await held.fulfill({ json: { themes: [{ id: 'late', tokens: {} }] } });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom');
});

test('sidebar drag disposal releases capture and all retained pointer listeners', async ({ page, fleet }) => {
  const handle = page.locator('#sidebarResizeHandle');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 40); await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 40);
  await expect(handle).toHaveClass(/dragging/);
  const width = await page.locator('#sidebar').evaluate(element => element.style.width);
  await page.evaluate(() => panelResize.dispose());
  await expect(handle).not.toHaveClass(/dragging/);
  await page.mouse.move(box.x + 120, box.y + 40); await page.mouse.up();
  expect(await page.locator('#sidebar').evaluate(element => element.style.width)).toBe(width);
  expect(await page.evaluate(() => localStorage.getItem('pi-dish-sidebar-width'))).toBe(null);
});
