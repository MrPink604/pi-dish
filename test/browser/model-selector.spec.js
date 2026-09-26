// Generated test/tool from test/browser/model-selector.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('selector owns its DOM, passes captured actions and ignores events after disposal', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const result = await page.evaluate(() => {
        const root = document.createElement('div');
        document.body.append(root);
        const calls = [];
        const owner = fixtureApp.features.sessionState.captureSelection();
        if (owner === null)
            throw new Error('Missing owner');
        const actions = {
            requestClose: (target) => calls.push(['close', target.host]),
            queryChanged: (_target, query) => calls.push(['query', query]),
            editModeChanged: (_target, editing) => calls.push(['edit', editing]),
            toggleModel: (target, id) => calls.push(['toggle', target.host, id]),
            toggleProvider: (_target, provider) => calls.push(['provider', provider]),
            setAllEnabled: (_target, enabled) => calls.push(['all', enabled]),
            selectModel: (target, id) => calls.push(['select', target.host, id]),
        };
        const view = { owner, models: PiDishBrowser.decodeModelCatalog([
                { id: 'one', provider: '__proto__', contextWindow: 1000000 },
                { id: 'two', provider: "quoted'provider", enabled: false },
            ]), currentModel: "quoted'provider/two", harnessId: 'pi', query: '', editMode: false };
        const component = PiDishBrowser.mountModelSelector(root, actions, formatTokens);
        component.update(view);
        component.focusSearch();
        const input = root.querySelector('input');
        if (input === null)
            throw new Error('Missing input');
        const focused = document.activeElement === input;
        const rows = [...root.querySelectorAll('.model-option')].map(row => row.title);
        const oldRow = fixtureElement(root.querySelector('.model-option'), 'old model row');
        oldRow.click();
        input.value = 'typed query';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixtureElement(root.querySelector('.model-footer-btn'), 'model footer button').click();
        component.update({ ...view, editMode: true });
        const preservedFocus = document.activeElement === input;
        for (const button of root.querySelectorAll('.model-footer-btn'))
            button.click();
        fixtureElement(root.querySelector('.model-group-toggle'), 'model group toggle').click();
        fixtureElement(root.querySelector('.model-option'), 'model option').click();
        const inlineHandlers = root.querySelectorAll('[onclick]').length;
        component.dispose();
        oldRow.click();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const emptied = root.childElementCount === 0;
        const again = PiDishBrowser.mountModelSelector(root, actions, formatTokens);
        again.update({ ...view, owner: { ...owner, host: 'different-host' } });
        fixtureElement(root.querySelector('.model-option'), 'model option').click();
        again.dispose();
        root.remove();
        return { focused, preservedFocus, rows, inlineHandlers, emptied, calls, host: owner.host };
    });
    (0, fixtures_js_1.expect)(result.focused).toBe(true);
    (0, fixtures_js_1.expect)(result.preservedFocus).toBe(true);
    (0, fixtures_js_1.expect)(result.rows).toEqual(['__proto__/one', "quoted'provider/two"]);
    (0, fixtures_js_1.expect)(result.inlineHandlers).toBe(0);
    (0, fixtures_js_1.expect)(result.emptied).toBe(true);
    (0, fixtures_js_1.expect)(result.calls).toEqual([
        ['select', result.host, '__proto__/one'], ['query', 'typed query'], ['close', result.host],
        ['edit', true], ['all', true], ['all', false], ['edit', false], ['provider', '__proto__'],
        ['toggle', result.host, '__proto__/one'],
        ['select', 'different-host', '__proto__/one'],
    ]);
});
fixtures_js_1.test.describe('live selector', () => {
    fixtures_js_1.test.use({ liveSessions: true });
    (0, fixtures_js_1.test)('search and model actions use the extracted selector', async ({ page, fleet }) => {
        await page.route(`${fleet.self.base}/api/models?sessionId=${fixtures_js_1.ROOT}`, route => route.fulfill({ json: [
                { id: 'quote-model', provider: "quoted'provider", contextWindow: 1000000 },
                { id: 'other-model', provider: 'other', contextWindow: 200000 },
            ] }));
        await fleet.select(fleet.self);
        let receive;
        const received = new Promise(resolve => { receive = resolve; });
        await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/model`, (route) => {
            if (!receive)
                throw new Error('Model request resolver not initialized');
            receive(route.request().postDataJSON());
            return route.fulfill({ json: { success: true } });
        });
        await page.click('#sessionModel');
        const search = page.locator('#modelDropdown .model-search');
        await (0, fixtures_js_1.expect)(search).toBeFocused();
        await search.fill('quote-model');
        await (0, fixtures_js_1.expect)(page.locator('#modelDropdown .model-option')).toHaveCount(1);
        await page.locator('#modelDropdown .model-option').click();
        (0, fixtures_js_1.expect)(await received).toEqual({ modelId: "quoted'provider/quote-model" });
        await (0, fixtures_js_1.expect)(page.locator('#modelDropdown')).toBeHidden();
        await page.click('#sessionModel');
        await (0, fixtures_js_1.expect)(search).toHaveValue('');
        await (0, fixtures_js_1.expect)(page.locator('#modelDropdown .model-option')).toHaveCount(2);
        await search.press('Escape');
        await (0, fixtures_js_1.expect)(page.locator('#modelDropdown')).toBeHidden();
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionControls.modelSelector)).toBeNull();
    });
    (0, fixtures_js_1.test)('model selector baseline measurements', async ({ page, fleet, browser }) => {
        const catalog = Array.from({ length: 250 }, (_, i) => ({ id: `model-${i}`, provider: `provider-${i % 5}`,
            contextWindow: 200000, reasoning: i % 2 === 0, enabled: i % 4 !== 0 }));
        await page.route(`${fleet.self.base}/api/models?sessionId=${fixtures_js_1.ROOT}`, route => route.fulfill({ json: catalog }));
        await fleet.select(fleet.self);
        const measurements = await page.evaluate(async () => {
            const open = [], filter = [];
            for (let i = 0; i < 21; i++) {
                let start = performance.now();
                await fixtureApp.features.sessionControls.toggleModels();
                open.push(performance.now() - start);
                const dropdown = document.getElementById('modelDropdown');
                if (dropdown === null)
                    throw new Error('Missing dropdown');
                if (!fixtureApp.features.sessionControls.modelOpen || dropdown.style.display !== 'flex'
                    || dropdown.querySelectorAll('.model-option[data-action="select"]').length !== 187) {
                    throw new Error('Baseline must measure an open selector with the fixed visible catalog');
                }
                start = performance.now();
                fixtureApp.features.sessionControls.renderModels('model-1');
                filter.push(performance.now() - start);
                fixtureApp.features.sessionControls.closeModels();
                if (dropdown.childElementCount !== 0)
                    throw new Error('Selector must empty its root after every close');
            }
            const summarize = (samples) => {
                const sorted = [...samples].sort((a, b) => a - b);
                return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
            };
            return { firstOpenMs: open[0], repeatedOpen: summarize(open.slice(1)), filter: summarize(filter.slice(1)),
                childrenAfterClose: fixtureElement(document.getElementById('modelDropdown'), "document.getElementById('modelDropdown')").childElementCount,
                viewport: { width: innerWidth, height: innerHeight } };
        });
        (0, fixtures_js_1.expect)(measurements.childrenAfterClose).toBe(0);
        console.log('MODEL_SELECTOR_BASELINE ' + JSON.stringify({ browser: browser.version(), catalogRows: catalog.length, ...measurements }));
    });
});
