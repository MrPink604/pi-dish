const { test, expect, ROOT } = require('./fixtures');

test('selector owns its DOM, passes captured actions and ignores events after disposal', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const root = document.createElement('div');
    document.body.append(root);
    const calls = [];
    const owner = fixtureApp.features.sessionState.captureSelection();
    const actions = {
      requestClose: target => calls.push(['close', target.host]),
      queryChanged: (target, query) => calls.push(['query', query]),
      editModeChanged: (target, editing) => calls.push(['edit', editing]),
      toggleModel: (target, id) => calls.push(['toggle', target.host, id]),
      toggleProvider: (target, provider) => calls.push(['provider', provider]),
      setAllEnabled: (target, enabled) => calls.push(['all', enabled]),
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
    const focused = document.activeElement === input;
    const rows = [...root.querySelectorAll('.model-option')].map(row => row.title);
    const oldRow = root.querySelector('.model-option');
    oldRow.click();
    input.value = 'typed query';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    root.querySelector('.model-footer-btn').click();
    component.update({ ...view, editMode: true });
    const preservedFocus = document.activeElement === input;
    for (const button of root.querySelectorAll('.model-footer-btn')) button.click();
    root.querySelector('.model-group-toggle').click();
    root.querySelector('.model-option').click();
    const inlineHandlers = root.querySelectorAll('[onclick]').length;
    component.dispose();
    oldRow.click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const emptied = root.childElementCount === 0;
    const again = PiDishBrowser.mountModelSelector(root, actions, formatTokens);
    again.update({ ...view, owner: { ...owner, host: 'different-host' } });
    root.querySelector('.model-option').click();
    again.dispose(); root.remove();
    return { focused, preservedFocus, rows, inlineHandlers, emptied, calls, host: owner.host };
  });
  expect(result.focused).toBe(true);
  expect(result.preservedFocus).toBe(true);
  expect(result.rows).toEqual(['__proto__/one', "quoted'provider/two"]);
  expect(result.inlineHandlers).toBe(0);
  expect(result.emptied).toBe(true);
  expect(result.calls).toEqual([
    ['select', result.host, '__proto__/one'], ['query', 'typed query'], ['close', result.host],
    ['edit', true], ['all', true], ['all', false], ['edit', false], ['provider', '__proto__'],
    ['toggle', result.host, '__proto__/one'],
    ['select', 'different-host', '__proto__/one'],
  ]);
});

test.describe('live selector', () => {
  test.use({ liveSessions: true });

  test('search and model actions use the extracted selector', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.route(`${fleet.self.base}/api/models?sessionId=${ROOT}`, route => route.fulfill({ json: [
      { id: 'quote-model', provider: "quoted'provider", contextWindow: 1000000 },
      { id: 'other-model', provider: 'other', contextWindow: 200000 },
    ] }));
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await page.route(`${fleet.self.base}/api/sessions/${ROOT}/model`, route => {
      receive(route.request().postDataJSON());
      return route.fulfill({ json: { success: true } });
    });
    await page.click('#sessionModel');
    const search = page.locator('#modelDropdown .model-search');
    await expect(search).toBeFocused();
    await search.fill('quote-model');
    await expect(page.locator('#modelDropdown .model-option')).toHaveCount(1);
    await page.locator('#modelDropdown .model-option').click();
    expect(await received).toEqual({ modelId: "quoted'provider/quote-model" });
    await expect(page.locator('#modelDropdown')).toBeHidden();
    await page.click('#sessionModel');
    await expect(search).toHaveValue('');
    await expect(page.locator('#modelDropdown .model-option')).toHaveCount(2);
    await search.press('Escape');
    await expect(page.locator('#modelDropdown')).toBeHidden();
    expect(await page.evaluate(() => fixtureApp.features.sessionControls.modelSelector)).toBeNull();
  });

  test('model selector baseline measurements', async ({ page, fleet, browser }) => {
    await fleet.select(fleet.self);
    const catalog = Array.from({ length: 250 }, (_, i) => ({ id: `model-${i}`, provider: `provider-${i % 5}`,
      contextWindow: 200000, reasoning: i % 2 === 0, enabled: i % 4 !== 0 }));
    await page.route(`${fleet.self.base}/api/models?sessionId=${ROOT}`, route => route.fulfill({ json: catalog }));
    const measurements = await page.evaluate(async () => {
      const open = [], filter = [];
      for (let i = 0; i < 21; i++) {
        let start = performance.now();
        await fixtureApp.features.sessionControls.toggleModels();
        open.push(performance.now() - start);
        const dropdown = document.getElementById('modelDropdown');
        if (!fixtureApp.features.sessionControls.modelOpen || dropdown.style.display !== 'flex'
            || dropdown.querySelectorAll('.model-option[data-action="select"]').length !== 187) {
          throw new Error('Baseline must measure an open selector with the fixed visible catalog');
        }
        start = performance.now();
        fixtureApp.features.sessionControls.renderModels('model-1');
        filter.push(performance.now() - start);
        fixtureApp.features.sessionControls.closeModels();
        if (dropdown.childElementCount !== 0) throw new Error('Selector must empty its root after every close');
      }
      const summarize = samples => {
        const sorted = [...samples].sort((a, b) => a - b);
        return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
      };
      return { firstOpenMs: open[0], repeatedOpen: summarize(open.slice(1)), filter: summarize(filter.slice(1)),
        childrenAfterClose: document.getElementById('modelDropdown').childElementCount,
        viewport: { width: innerWidth, height: innerHeight } };
    });
    expect(measurements.childrenAfterClose).toBe(0);
    console.log('MODEL_SELECTOR_BASELINE ' + JSON.stringify({ browser: browser.version(), catalogRows: catalog.length, ...measurements }));
  });
});
