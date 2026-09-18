// Generated test/tool from test/browser/display.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('closed preferences retire retained device, theme, filter and budget controls', async ({ page, fleet }) => {
    let writes = 0;
    await page.route('**/api/settings', route => {
        if (route.request().method() === 'PUT')
            writes++;
        return route.fulfill({ json: { monthlyBudgetUsd: 12, savedFilters: [{ name: 'Keep', query: 'active:true' }] } });
    });
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await (0, fixtures_js_1.expect)(page.locator('#saveBudget')).toBeEnabled();
    await page.evaluate(() => {
        window.oldDisplayControls = ['responseMetadataMode', 'settingsTheme', 'sidebarContextMetric', 'saveBudget'].map(id => document.getElementById(id));
        window.oldFilterDelete = document.querySelector('.saved-filter-del');
        fixtureApp.ports.appBindings.actions.closeSettingsModal(new Event('click'), document.body);
        const [mode, theme, metric, save] = window.oldDisplayControls;
        const modeInput = fixtureInput(mode, 'response metadata mode');
        const themeInput = fixtureInput(theme, 'theme');
        const metricInput = fixtureInput(metric, 'context metric');
        modeInput.value = 'hidden';
        modeInput.dispatchEvent(new Event('change'));
        themeInput.value = 'graphite';
        themeInput.dispatchEvent(new Event('change'));
        metricInput.value = 'tokens';
        metricInput.dispatchEvent(new Event('change'));
        fixtureElement(save, 'save budget').click();
        fixtureElement(window.oldFilterDelete, 'saved filter delete').click();
    });
    (0, fixtures_js_1.expect)(writes).toBe(0);
    (0, fixtures_js_1.expect)(await page.evaluate(() => [fixtureApp.features.displayPreferences.responseMode, fixtureApp.features.displayPreferences.contextMetric, localStorage.getItem('pi-dish-theme')])).toEqual(['compact', 'percent', null]);
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await page.selectOption('#sidebarContextMetric', 'tokens');
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.displayPreferences.contextMetric)).toBe('tokens');
});
(0, fixtures_js_1.test)('old settings reads and budget saves cannot overwrite a reopened modal', async ({ page, fleet }) => {
    let oldRead, oldSave, reads = 0;
    await page.route('**/api/settings', route => {
        if (route.request().method() === 'PUT') {
            oldSave = route;
            return;
        }
        if (++reads === 1) {
            oldRead = route;
            return;
        }
        return route.fulfill({ json: { monthlyBudgetUsd: 27, savedFilters: [] } });
    });
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await fixtures_js_1.expect.poll(() => !!oldRead).toBe(true);
    await page.evaluate(() => { fixtureApp.ports.appBindings.actions.closeSettingsModal(new Event('click'), document.body); fixtureApp.features.displayPreferences.open(); });
    await (0, fixtures_js_1.expect)(page.locator('#monthlyBudget')).toHaveValue('27');
    await (0, fixtures_js_1.requiredRoute)(oldRead).fulfill({ json: { monthlyBudgetUsd: 5, savedFilters: [{ name: 'Old', query: 'old' }] } });
    await (0, fixtures_js_1.expect)(page.locator('#monthlyBudget')).toHaveValue('27');
    await (0, fixtures_js_1.expect)(page.locator('#savedFiltersList')).not.toContainText('Old');
    await page.locator('#saveBudget').click();
    await fixtures_js_1.expect.poll(() => !!oldSave).toBe(true);
    await page.evaluate(() => { fixtureApp.ports.appBindings.actions.closeSettingsModal(new Event('click'), document.body); fixtureApp.features.displayPreferences.open(); });
    await (0, fixtures_js_1.expect)(page.locator('#saveBudget')).toBeEnabled();
    await (0, fixtures_js_1.requiredRoute)(oldSave).fulfill({ status: 500, json: { error: 'old failure' } });
    await (0, fixtures_js_1.expect)(page.locator('#budgetStatus')).toHaveText('');
});
(0, fixtures_js_1.test)('theme refresh retains the latest catalog and disposal drops a held response', async ({ page, fleet }) => {
    let held, reads = 0;
    await page.route('**/api/themes', route => {
        if (++reads === 1) {
            held = route;
            return;
        }
        return route.fulfill({ json: { themes: [{ id: 'custom', tokens: { '--accent': '#123456' } }] } });
    });
    await page.evaluate(() => { localStorage.setItem('pi-dish-theme', 'custom'); void fixtureApp.features.themesController.load(); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => fixtureApp.features.themesController.load());
    await (0, fixtures_js_1.expect)(page.locator('html')).toHaveAttribute('data-theme', 'custom');
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { themes: [{ id: 'obsolete', tokens: { '--accent': '#abcdef' } }] } });
    (0, fixtures_js_1.expect)(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toBe('#123456');
    await page.unroute('**/api/themes');
    held = null;
    await page.route('**/api/themes', route => { held = route; });
    await page.evaluate(() => { void fixtureApp.features.themesController.load(); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => fixtureApp.features.themesController.dispose());
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { themes: [{ id: 'late', tokens: {} }] } });
    await (0, fixtures_js_1.expect)(page.locator('html')).toHaveAttribute('data-theme', 'custom');
});
(0, fixtures_js_1.test)('sidebar drag disposal releases capture and all retained pointer listeners', async ({ page, fleet }) => {
    const handle = page.locator('#sidebarResizeHandle');
    const box = await handle.boundingBox();
    if (box === null)
        throw new Error('Missing box');
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 65, box.y + 40);
    await (0, fixtures_js_1.expect)(handle).toHaveClass(/dragging/);
    const width = await page.locator('#sidebar').evaluate(element => element.style.width);
    await page.evaluate(() => fixtureApp.features.panelResize.dispose());
    await (0, fixtures_js_1.expect)(handle).not.toHaveClass(/dragging/);
    await page.mouse.move(box.x + 120, box.y + 40);
    await page.mouse.up();
    (0, fixtures_js_1.expect)(await page.locator('#sidebar').evaluate(element => element.style.width)).toBe(width);
    (0, fixtures_js_1.expect)(await page.evaluate(() => localStorage.getItem('pi-dish-sidebar-width'))).toBe(null);
});
