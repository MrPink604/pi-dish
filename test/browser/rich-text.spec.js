const { test, expect } = require('./fixtures');

test('Markdown keeps HTML and unsafe links inert, literal single tildes and explicit strike', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    const root = document.createElement('div'); root.id = 'rich-fixture';
    root.innerHTML = fixtureApp.features.richText.format('<img src=x onerror="window.richInjected=1">\n\n[unsafe](javascript:alert(1))\n\n~literal~ ~~strike~~ **bold**');
    document.body.append(root);
  });
  await expect(page.locator('#rich-fixture img')).toHaveCount(0);
  await expect(page.locator('#rich-fixture a')).toHaveAttribute('href', '#');
  await expect(page.locator('#rich-fixture')).toContainText('~literal~');
  await expect(page.locator('#rich-fixture del')).toHaveText('strike');
  await expect(page.locator('#rich-fixture strong')).toHaveText('bold');
  expect(await page.evaluate(() => window.richInjected)).toBeUndefined();
});

test('local assets share in-flight loads, retry errors and retire pending elements on disposal', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  let held, requests = 0;
  await page.route('**/vendor/fixture-owned.js', route => { requests++; held = route; });
  await page.evaluate(() => {
    window.testAssets = PiDishBrowser.createBrowserAssets(document);
    window.assetFirst = window.testAssets.load('script', { src: 'vendor/fixture-owned.js' });
    window.assetSecond = window.testAssets.load('script', { src: 'vendor/fixture-owned.js' });
    window.assetsSame = window.assetFirst === window.assetSecond;
    window.assetFirst.catch(() => {});
  });
  await expect.poll(() => !!held).toBe(true); expect(requests).toBe(1); expect(await page.evaluate(() => window.assetsSame)).toBe(true);
  await held.abort(); await page.evaluate(() => window.assetFirst.catch(() => {}));
  await expect(page.locator('script[src="vendor/fixture-owned.js"]')).toHaveCount(0);
  held = null;
  await page.evaluate(() => { window.assetRetry = window.testAssets.load('script', { src: 'vendor/fixture-owned.js' }); window.assetRetry.catch(() => {}); });
  await expect.poll(() => !!held).toBe(true); expect(requests).toBe(2);
  await page.evaluate(() => window.testAssets.dispose());
  expect(await page.evaluate(() => window.assetRetry.then(() => 'loaded', error => error.message))).toBe('Browser assets disposed');
  await expect(page.locator('script[src="vendor/fixture-owned.js"]')).toHaveCount(0);
  await held.fulfill({ contentType: 'text/javascript', body: '' });
});

async function diagrams(page) {
  await page.evaluate(() => {
    window.diagramCalls = []; window.diagramScrolls = 0;
    const runtime = { initialize: () => {}, render: () => new Promise((resolve, reject) => window.diagramCalls.push({ resolve, reject })) };
    window.diagramFragment = document.createDocumentFragment();
    window.testDiagrams = PiDishBrowser.createDiagrams({ document, assets: { load: async () => {}, dispose() {} }, runtime: () => runtime,
      retainedRoots: () => [window.diagramFragment], isPinned: () => !window.diagramRequireBeforeSvg || !window.fixtureDiagram.querySelector('.diagram-render'), scrollBottom: () => { window.diagramScrolls++; } });
    const block = document.createElement('div'); block.id = 'diagram-fixture'; block.className = 'code-block';
    const pre = document.createElement('pre'), code = document.createElement('code'); code.textContent = 'flowchart LR\nA-->B'; pre.append(code); block.append(pre);
    document.getElementById('messages').append(block);
    window.fixtureDiagram = block;
    window.testDiagrams.prepare(block, 'mermaid'); window.testDiagrams.render(document.getElementById('messages'));
  });
  await expect.poll(() => page.evaluate(() => window.diagramCalls.length)).toBe(1);
}

test('new theme renders own the SVG when older diagram renders settle later', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await diagrams(page);
  await page.evaluate(() => window.testDiagrams.refreshTheme());
  await expect.poll(() => page.evaluate(() => window.diagramCalls.length)).toBe(2);
  await page.evaluate(() => window.diagramCalls[1].resolve({ svg: '<svg><text>New theme</text></svg>' }));
  await expect(page.locator('#diagram-fixture .diagram-render')).toContainText('New theme');
  await page.evaluate(() => window.diagramCalls[0].resolve({ svg: '<svg><text>Old theme</text></svg>' }));
  await expect(page.locator('#diagram-fixture .diagram-render')).toContainText('New theme');
  await expect(page.locator('#diagram-fixture')).toHaveAttribute('data-diagram-state', 'rendered');
});

test('retained diagrams render without scrolling the currently selected feed', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await diagrams(page);
  await page.evaluate(() => { window.diagramFragment.append(window.fixtureDiagram); window.diagramCalls[0].resolve({ svg: '<svg><text>Retained diagram</text></svg>' }); });
  await expect.poll(() => page.evaluate(() => window.fixtureDiagram.dataset.diagramState)).toBe('rendered');
  expect(await page.evaluate(() => window.diagramScrolls)).toBe(0);
  expect(await page.evaluate(() => window.fixtureDiagram.textContent)).toContain('Retained diagram');
});

test('diagram disposal ignores in-flight errors and retires old lightbox controls', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await diagrams(page);
  await page.evaluate(() => window.diagramCalls[0].resolve({ svg: '<svg viewBox="0 0 100 100"><text>Diagram</text></svg>' }));
  await expect(page.locator('#diagram-fixture .diagram-render svg')).toHaveCount(1);
  await page.evaluate(() => {
    window.testDiagrams.openLightbox(window.fixtureDiagram);
    window.oldDiagramZoom = document.querySelector('.diagram-lightbox button[title="Zoom in"]');
    window.oldDiagramLabel = document.querySelector('.diagram-zoom-label'); window.oldDiagramText = window.oldDiagramLabel.textContent;
    window.testDiagrams.openLightbox(window.fixtureDiagram); window.oldDiagramZoom.click();
  });
  expect(await page.evaluate(() => window.oldDiagramLabel.textContent)).toBe(await page.evaluate(() => window.oldDiagramText));
  await expect(page.locator('.diagram-lightbox')).toHaveCount(1);
  await page.evaluate(() => window.testDiagrams.refreshTheme());
  await expect.poll(() => page.evaluate(() => window.diagramCalls.length)).toBe(2);
  await page.evaluate(() => { window.testDiagrams.dispose(); window.diagramCalls[1].reject(new Error('retired error')); });
  await expect(page.locator('.diagram-lightbox')).toHaveCount(0);
  await expect(page.locator('#diagram-fixture .diagram-error')).toHaveCount(0);
});

test('copy completion and feedback timers retire on selection change and rich-text disposal', async ({ page, fleet }) => {
  await page.clock.install(); await fleet.select(fleet.self);
  await page.evaluate(() => {
    const root = document.createElement('div'); root.id = 'rich-fixture'; root.innerHTML = '<div class="markdown-body"><pre><code>fixture</code></pre></div>';
    document.body.append(root); fixtureApp.features.richText.highlight(root);
    navigator.clipboard.writeText = () => new Promise(resolve => { window.finishRichCopy = resolve; });
  });
  await page.locator('#rich-fixture .code-copy-btn').click();
  await expect.poll(() => page.evaluate(() => !!window.finishRichCopy)).toBe(true);
  await fleet.select(fleet.peer);
  await page.evaluate(() => window.finishRichCopy());
  await expect(page.locator('#rich-fixture .code-copy-btn')).toHaveText('⧉');
  await page.evaluate(() => { navigator.clipboard.writeText = async () => {}; });
  await page.locator('#rich-fixture .code-copy-btn').click();
  await expect(page.locator('#rich-fixture .code-copy-btn')).toHaveText('✓');
  await page.evaluate(() => fixtureApp.features.richText.dispose());
  await page.clock.runFor(1500);
  await expect(page.locator('#rich-fixture .code-copy-btn')).toHaveText('✓');
});


test('diagram growth carries a still-pinned feed after measuring before SVG insertion', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await diagrams(page);
  await page.evaluate(() => { window.diagramRequireBeforeSvg = true; window.diagramCalls[0].resolve({ svg: '<svg><text>Taller diagram</text></svg>' }); });
  await expect.poll(() => page.evaluate(() => window.diagramScrolls)).toBe(1);
});
