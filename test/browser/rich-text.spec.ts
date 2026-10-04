import type { Page, Route } from '@playwright/test';
import type { MermaidRuntime } from '../../src/browser/rich-text-vendors.js';
import fs = require('node:fs');
import path = require('node:path');
import { test, expect, ROOT, CHILD, requiredRoute } from './fixtures.js';

const katexScript = fs.readFileSync(path.resolve(__dirname, '../../public/vendor/katex.min.js'), 'utf8');
const katexStyles = fs.readFileSync(path.resolve(__dirname, '../../public/vendor/katex.min.css'), 'utf8');

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

test('session refs navigate by owning host without linking examples or ambiguous prefixes', async ({ page, fleet }) => {
  const remote = `${fleet.peer.hostId}:${CHILD}`;
  const markdown = `Open #${CHILD}. Again #${CHILD}, or \`${CHILD}\`.\n\nRemote #${remote}.\n\nUnknown #include; ambiguous #2026-09-; glued word#${CHILD}.\n\n[Existing #${CHILD}](https://example.com)\n\n\`command #${CHILD}\`\n\n\`\`\`text\n#${CHILD}\n\`\`\``;
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/messages?**`, route => route.fulfill({
    json: { messages: [{ role: 'assistant', index: 0, content: markdown }], session: {} },
  }));
  await fleet.select(fleet.self);
  const links = page.locator('#messages .session-ref-link');
  await expect(links).toHaveText([`#${CHILD}`, `#${CHILD}`, CHILD, `#${remote}`]);
  await expect(page.locator('#messages pre .session-ref-link, #messages a .session-ref-link')).toHaveCount(0);
  await expect(page.locator('#messages')).toContainText('Unknown #include; ambiguous #2026-09-; glued word#');
  await links.first().click();
  await expect(page.locator('#messages')).toContainText('self child transcript');
  await expect(fleet.row(fleet.self, CHILD)).toHaveClass(/\bactive\b/);
  await fleet.select(fleet.self);
  await links.last().focus(); await links.last().press('Enter');
  await expect(page.locator('#messages')).toContainText('peer child transcript');
  await expect(fleet.row(fleet.peer, CHILD)).toHaveClass(/\bactive\b/);
  // A ref rendered on self must not resolve against peer after a selection
  // switch, even if its node is retained and displayed outside the old feed.
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    const button = fixtureElement(document.querySelector('#messages .session-ref-link'), 'local session ref');
    document.body.append(button); button.id = 'retained-session-ref';
  });
  await fleet.select(fleet.peer);
  await page.locator('#retained-session-ref').click();
  await expect(page.locator('#messages')).toContainText('self child transcript');
  await expect(fleet.row(fleet.self, CHILD)).toHaveClass(/\bactive\b/);
});

test('streamed session mentions become clickable before the turn finishes', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(id => {
    fixtureElement(document.getElementById('messages'), '#messages').replaceChildren();
    fixtureApp.features.streamingRenderer.render({ role: 'assistant', content: `See #${id} for context.` });
  }, CHILD);
  await page.locator('#messages .session-ref-link').click();
  await expect(page.locator('#messages')).toContainText('self child transcript');
});

test('local assets share in-flight loads, retry errors and retire pending elements on disposal', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  let held: Route | undefined, requests = 0;
  await page.route('**/vendor/fixture-owned.js', route => { requests++; held = route; });
  await page.evaluate(() => {
    window.testAssets = PiDishBrowser.createBrowserAssets(document);
    window.assetFirst = window.testAssets.load('script', { src: 'vendor/fixture-owned.js' });
    window.assetSecond = window.testAssets.load('script', { src: 'vendor/fixture-owned.js' });
    window.assetsSame = window.assetFirst === window.assetSecond;
    window.assetFirst.catch(() => {});
  });
  await expect.poll(() => !!held).toBe(true); expect(requests).toBe(1); expect(await page.evaluate(() => window.assetsSame)).toBe(true);
  await requiredRoute(held).abort(); await page.evaluate(() => window.assetFirst.catch(() => {}));
  await expect(page.locator('script[src="vendor/fixture-owned.js"]')).toHaveCount(0);
  held = undefined;
  await page.evaluate(() => { window.assetRetry = window.testAssets.load('script', { src: 'vendor/fixture-owned.js' }); window.assetRetry.catch(() => {}); });
  await expect.poll(() => !!held).toBe(true); expect(requests).toBe(2);
  await page.evaluate(() => window.testAssets.dispose());
  expect(await page.evaluate(() => window.assetRetry.then(() => 'loaded', error => error instanceof Error ? error.message : String(error)))).toBe('Browser assets disposed');
  await expect(page.locator('script[src="vendor/fixture-owned.js"]')).toHaveCount(0);
  await requiredRoute(held).fulfill({ contentType: 'text/javascript', body: '' });
});

async function diagrams(page: Page) {
  await page.evaluate(() => {
    window.diagramCalls = []; window.diagramScrolls = 0;
    const runtime: MermaidRuntime = { initialize() {}, render: () => new Promise<{ svg: string }>((resolve, reject) => window.diagramCalls.push({ resolve, reject })) };
    window.diagramFragment = document.createDocumentFragment();
    window.testDiagrams = PiDishBrowser.createDiagrams({ document, assets: { load: async () => {}, dispose() {} }, runtime: () => runtime,
      retainedRoots: () => [window.diagramFragment], isPinned: () => !window.diagramRequireBeforeSvg || !window.fixtureDiagram.querySelector('.diagram-render'), scrollBottom: () => { window.diagramScrolls++; } });
    const block = document.createElement('div'); block.id = 'diagram-fixture'; block.className = 'code-block';
    const pre = document.createElement('pre'), code = document.createElement('code'); code.textContent = 'flowchart LR\nA-->B'; pre.append(code); block.append(pre);
    fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").append(block);
    window.fixtureDiagram = block;
    window.testDiagrams.prepare(block, 'mermaid'); window.testDiagrams.render(fixtureElement(document.getElementById('messages'), '#messages'));
  });
  await expect.poll(() => page.evaluate(() => window.diagramCalls.length)).toBe(1);
}

test('new theme renders own the SVG when older diagram renders settle later', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await diagrams(page);
  await page.evaluate(() => window.testDiagrams.refreshTheme());
  await expect.poll(() => page.evaluate(() => window.diagramCalls.length)).toBe(2);
  await page.evaluate(() => fixtureElement(window.diagramCalls[1], 'new diagram render').resolve({ svg: '<svg><text>New theme</text></svg>' }));
  await expect(page.locator('#diagram-fixture .diagram-render')).toContainText('New theme');
  await page.evaluate(() => fixtureElement(window.diagramCalls[0], 'old diagram render').resolve({ svg: '<svg><text>Old theme</text></svg>' }));
  await expect(page.locator('#diagram-fixture .diagram-render')).toContainText('New theme');
  await expect(page.locator('#diagram-fixture')).toHaveAttribute('data-diagram-state', 'rendered');
});

test('retained diagrams render without scrolling the currently selected feed', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await diagrams(page);
  await page.evaluate(() => { window.diagramFragment.append(window.fixtureDiagram); fixtureElement(window.diagramCalls[0], 'diagram render').resolve({ svg: '<svg><text>Retained diagram</text></svg>' }); });
  await expect.poll(() => page.evaluate(() => window.fixtureDiagram.dataset.diagramState)).toBe('rendered');
  expect(await page.evaluate(() => window.diagramScrolls)).toBe(0);
  expect(await page.evaluate(() => window.fixtureDiagram.textContent)).toContain('Retained diagram');
});

test('diagram disposal ignores in-flight errors and retires old lightbox controls', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await diagrams(page);
  await page.evaluate(() => fixtureElement(window.diagramCalls[0], 'diagram render').resolve({ svg: '<svg viewBox="0 0 100 100"><text>Diagram</text></svg>' }));
  await expect(page.locator('#diagram-fixture .diagram-render svg')).toHaveCount(1);
  await page.evaluate(() => {
    window.testDiagrams.openLightbox(window.fixtureDiagram);
    window.oldDiagramZoom = document.querySelector<HTMLElement>('.diagram-lightbox button[title="Zoom in"]');
    window.oldDiagramLabel = document.querySelector<HTMLElement>('.diagram-zoom-label'); window.oldDiagramText = fixtureElement(window.oldDiagramLabel, 'diagram zoom label').textContent;
    window.testDiagrams.openLightbox(window.fixtureDiagram); fixtureElement(window.oldDiagramZoom, 'old diagram zoom').click();
  });
  expect(await page.evaluate(() => fixtureElement(window.oldDiagramLabel, 'old diagram label').textContent)).toBe(await page.evaluate(() => window.oldDiagramText));
  await expect(page.locator('.diagram-lightbox')).toHaveCount(1);
  await page.evaluate(() => window.testDiagrams.refreshTheme());
  await expect.poll(() => page.evaluate(() => window.diagramCalls.length)).toBe(2);
  await page.evaluate(() => { window.testDiagrams.dispose(); fixtureElement(window.diagramCalls[1], 'retired diagram render').reject(new Error('retired error')); });
  await expect(page.locator('.diagram-lightbox')).toHaveCount(0);
  await expect(page.locator('#diagram-fixture .diagram-error')).toHaveCount(0);
});

test('copy completion and feedback timers retire on selection change and rich-text disposal', async ({ page, fleet }) => {
  await page.clock.install(); await fleet.select(fleet.self);
  await page.evaluate(() => {
    const root = document.createElement('div'); root.id = 'rich-fixture'; root.innerHTML = '<div class="markdown-body"><pre><code>fixture</code></pre></div>';
    document.body.append(root); fixtureApp.features.richText.highlight(root);
    navigator.clipboard.writeText = () => new Promise<void>(resolve => { window.finishRichCopy = resolve; });
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
  await page.evaluate(() => { window.diagramRequireBeforeSvg = true; fixtureElement(window.diagramCalls[0], 'diagram render').resolve({ svg: '<svg><text>Taller diagram</text></svg>' }); });
  await expect.poll(() => page.evaluate(() => window.diagramScrolls)).toBe(1);
});

test('a math-free transcript never requests the KaTeX bundle', async ({ page, fleet }) => {
  const vendor: string[] = [];
  page.on('request', request => { if (/vendor\/katex\./.test(request.url())) vendor.push(request.url()); });
  // Prose, inline code and a code fence that merely *mention* the placeholder
  // markup must stay literal text and never pull the math bundle in.
  const prose = 'Report: `data-math-source` and `<span class="math-pending" data-math-source="x">` are literal text.\n\n```html\n<span class="math-pending" data-math-source="y">z</span>\n```';
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/messages?**`, route => route.fulfill({ json: { messages: [{ role: 'assistant', index: 0, content: prose }], session: {} } }));
  await page.evaluate(({ id, host }) => fixtureApp.features.sessionView.select(id, { host, forceTranscriptReload: true }), { id: ROOT, host: fleet.self.hostId });
  await expect(page.locator('#messages')).toContainText('are literal text');
  await expect(page.locator('#messages .math-pending')).toHaveCount(0);
  expect(vendor).toEqual([]);
});

test('math loads on first render and hydrates a retired fragment once KaTeX arrives', async ({ page, fleet }) => {
  let script: Route | null = null, styles: Route | null = null;
  await page.route('**/vendor/katex.min.js', route => { script = route; });
  await page.route('**/vendor/katex.min.css', route => { styles = route; });
  const markdown = 'Energy $E=mc^2$ here.\n\n$$\\int_0^1 x\\,dx$$\n\nUnsafe $\\text{<img src=x onerror=window.richInjected=1>}$';
  const page1 = { messages: [{ role: 'assistant', index: 0, content: markdown }], session: {}, firstIndex: 0, lastIndex: 0, hasMore: false, totalMessages: 1 };
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/messages?**`, route => route.fulfill({ json: page1 }));
  await page.evaluate(({ id, host }) => fixtureApp.features.sessionView.select(id, { host, forceTranscriptReload: true }), { id: ROOT, host: fleet.self.hostId });
  // KaTeX is absent, so math holds inert placeholders; nothing unsafe rendered.
  await expect(page.locator('#messages .math-pending')).toHaveCount(3);
  await expect(page.locator('#messages img')).toHaveCount(0);
  await expect.poll(() => !!script && !!styles).toBe(true);
  // Retire the session with the bundle still in flight: the stashed fragment
  // keeps placeholders, and the completion pass must reach into the cache.
  await page.evaluate(() => { const node = document.querySelector('#messages [data-msg-index]'); if (node instanceof HTMLElement) node.dataset.fixtureMark = 'kept'; });
  await fleet.select(fleet.peer);
  await requiredRoute(styles).fulfill({ contentType: 'text/css', body: katexStyles });
  await requiredRoute(script).fulfill({ contentType: 'text/javascript', body: katexScript });
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(globalThis, 'katex'))).not.toBe('undefined');
  await fleet.select(fleet.self);
  // The marked node proves this is the retained fragment, not a fresh render.
  await expect(page.locator('#messages [data-msg-index][data-fixture-mark="kept"]')).toHaveCount(1);
  await expect(page.locator('#messages .math-pending')).toHaveCount(0);
  await expect(page.locator('#messages .math-block .katex')).toHaveCount(1);
  await expect(page.locator('#messages .katex')).toHaveCount(3);
  await expect(page.locator('#messages img')).toHaveCount(0);
  // Late hydration must land on exactly the markup a first-pass render produces.
  expect(await page.evaluate(source => {
    const live = document.querySelector('#messages .markdown-body');
    const reference = document.createElement('div'); reference.innerHTML = fixtureApp.features.richText.format(source);
    return !!live && live.innerHTML === reference.innerHTML;
  }, markdown)).toBe(true);
});

test('streamed math keeps an inert placeholder until the bundle lands, then hydrates in place', async ({ page, fleet }) => {
  let script: Route | null = null, styles: Route | null = null;
  await page.route('**/vendor/katex.min.js', route => { script = route; });
  await page.route('**/vendor/katex.min.css', route => { styles = route; });
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    fixtureElement(document.getElementById('messages'), '#messages').replaceChildren();
    fixtureApp.features.streamingRenderer.render({ role: 'assistant', content: 'answer $x^2$' });
  });
  await expect(page.locator('#messages .math-pending')).toHaveCount(1);
  await expect.poll(() => !!script && !!styles).toBe(true);
  await requiredRoute(styles).fulfill({ contentType: 'text/css', body: katexStyles });
  await requiredRoute(script).fulfill({ contentType: 'text/javascript', body: katexScript });
  await expect(page.locator('#messages .math-pending')).toHaveCount(0);
  await expect(page.locator('#messages .katex')).toHaveCount(1);
  // Continuing the stream after hydration must not reintroduce placeholders.
  await page.evaluate(() => fixtureApp.features.streamingRenderer.render({ role: 'assistant', content: 'answer $x^2$ plus more text' }));
  await expect(page.locator('#messages .math-pending')).toHaveCount(0);
  await expect(page.locator('#messages .katex')).toHaveCount(1);
});

export {};
