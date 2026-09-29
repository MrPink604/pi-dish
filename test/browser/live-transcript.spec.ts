import { test, expect, ROOT } from './fixtures.js';
test('a coalesced frame keeps its selection owner even when callers do not explicitly cancel it', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(({ id, host }) => {
    fixtureApp.features.streamingRenderer.queue({ role: 'assistant', content: 'first frame' }); fixtureApp.features.streamingRenderer.queue({ role: 'assistant', content: 'old pending frame' });
    fixtureApp.features.sessionState.advanceSelection(); fixtureApp.features.sessionState.setCurrentSession(id, host); fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").textContent = 'new host transcript';
  }, { id: ROOT, host: fleet.peer.hostId });
  await page.waitForTimeout(120); await expect(page.locator('#messages')).toHaveText('new host transcript');
});
test('streamed block updates preserve open details and update renamed tools with identical arguments', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const root = fixtureElement(document.getElementById('messages'), '#messages'); root.replaceChildren();
    fixtureApp.features.streamingRenderer.render({ role: 'assistant', content: [{ type: 'thinking', thinking: 'first' }, { type: 'toolCall', name: 'first-tool', arguments: { path: 'a' } }] });
    const thinking = fixtureDetails(root.querySelector('.thinking-block'), '.thinking-block');
    const tool = fixtureDetails(root.querySelector('.tool-call'), '.tool-call'); thinking.open = true; tool.open = true;
    fixtureApp.features.streamingRenderer.render({ role: 'assistant', content: [{ type: 'thinking', thinking: 'second' }, { type: 'toolCall', name: 'renamed-tool', arguments: { path: 'a' } }] });
    return { sameThinking: thinking === root.querySelector('.thinking-block'), sameTool: tool === root.querySelector('.tool-call'), openThinking: thinking.open, openTool: tool.open,
      thinking: fixtureElement(thinking.querySelector('.thinking-text'), '.thinking-text').textContent, name: fixtureElement(tool.querySelector('.tool-call-name'), '.tool-call-name').textContent };
  });
  expect(result).toEqual({ sameThinking: true, sameTool: true, openThinking: true, openTool: true, thinking: 'second', name: 'renamed-tool' });
});
test('cumulative tool starts and updates reuse the panel and replace its image row', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").replaceChildren();
    const first = fixtureApp.features.liveToolsController.append({ toolCallId: 'same-tool', toolName: 'read', args: { path: 'file' } });
    const repeated = fixtureApp.features.liveToolsController.append({ toolCallId: 'same-tool', toolName: 'read', args: { path: 'file' } });
    for (let n = 0; n < 2; n++) fixtureApp.features.liveToolsController.update({ toolCallId: 'same-tool', partialResult: { content: [{ type: 'text', text: '<literal>' }, { type: 'image', data: 'a', mimeType: 'image/png' }] } });
    return { same: first === repeated, count: document.querySelectorAll('.live-tool-panel').length, images: document.querySelectorAll('.live-tool-panel .msg-images').length, text: fixtureElement(document.querySelector('.live-tool-output'), "document.querySelector('.live-tool-output')").textContent };
  });
  expect(result).toEqual({ same: true, count: 1, images: 1, text: '<literal>' });
});
test('completion-only tools render results without inventing a duration and set mood safely', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").replaceChildren();
    fixtureApp.features.liveToolsController.finish({ toolCallId: 'background', toolName: 'set_mood', args: { description: 'FOCUSED extra', kaomoji: '<literal>\nface' }, result: { content: [{ type: 'text', text: 'done' }] } });
  });
  await expect(page.locator('.live-tool-panel.complete')).toContainText('done'); await expect(page.locator('.live-tool-status.duration')).toHaveCount(0);
  await expect(page.locator('#moodIndicator')).toHaveText('focused <literal> face'); await expect(page.locator('#moodIndicator literal')).toHaveCount(0);
});
test('same-id tool completion on a newer host cannot replace the older retained panel', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(({ id, host }) => {
    const root = fixtureElement(document.getElementById('messages'), '#messages'); root.replaceChildren();
    const old = fixtureElement(fixtureApp.features.liveToolsController.append({ toolCallId: 'collision', toolName: 'old' }), 'old live tool'); root.replaceChildren();
    fixtureApp.features.sessionState.advanceSelection(); fixtureApp.features.sessionState.setCurrentSession(id, host);
    fixtureApp.features.liveToolsController.finish({ toolCallId: 'collision', toolName: 'new', result: { content: [{ type: 'text', text: 'new result' }] } });
    return { oldName: fixtureElement(old.el.querySelector('.live-tool-name'), '.live-tool-name').textContent, oldRunning: old.el.classList.contains('running'), connected: old.el.isConnected, newName: fixtureElement(root.querySelector('.live-tool-name'), '.live-tool-name').textContent };
  }, { id: ROOT, host: fleet.peer.hostId });
  expect(result).toEqual({ oldName: 'old', oldRunning: true, connected: false, newName: 'new' });
});
test('stream coalescing renders only the latest pending frame and disposal retires its timer', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.evaluate(() => {
    fixtureApp.features.streamingRenderer.cancel(); fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").replaceChildren(); window.frameTexts = [];
    window.frameRenderer = PiDishBrowser.createStreamingRenderer({ document, sessionState: fixtureApp.features.sessionState, markdown: text => { window.frameTexts.push(text); return text; }, pinned: () => false, scroll() {}, jump() {} });
    window.frameRenderer.queue({ role: 'assistant', content: 'first' }); window.frameRenderer.queue({ role: 'assistant', content: 'middle' }); window.frameRenderer.queue({ role: 'assistant', content: 'last' });
  });
  expect(await page.evaluate(() => window.frameTexts)).toEqual(['first']);
  await page.clock.runFor(80);
  expect(await page.evaluate(() => window.frameTexts)).toEqual(['first', 'last']);
  await page.evaluate(() => { window.frameRenderer.queue({ role: 'assistant', content: 'retired' }); window.frameRenderer.dispose(); });
  await page.clock.runFor(120);
  expect(await page.evaluate(() => window.frameTexts)).toEqual(['first', 'last']);
});
test('live-tool disposal rejects subsequent mutations and malformed ids', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const root = fixtureElement(document.getElementById('messages'), '#messages'); root.replaceChildren();
    fixtureApp.features.liveToolsController.append({ toolCallId: {} }); const malformedCount = fixtureApp.features.liveToolsController.count;
    fixtureApp.features.liveToolsController.append({ toolCallId: 'old', toolName: 'read' }); const before = root.innerHTML;
    fixtureApp.features.liveToolsController.dispose(); fixtureApp.features.liveToolsController.update({ toolCallId: 'old', partialResult: { content: [{ type: 'text', text: 'late' }] } });
    fixtureApp.features.liveToolsController.finish({ toolCallId: 'new', result: { content: [] } });
    return { malformedCount, unchanged: before === root.innerHTML, count: fixtureApp.features.liveToolsController.count };
  });
  expect(result).toEqual({ malformedCount: 0, unchanged: true, count: 0 });
});

test('streamed frames retain finished block nodes and rebuild only the unfinished tail', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const { richText } = fixtureApp.features;
    const root = fixtureElement(document.getElementById('messages'), '#messages'); root.replaceChildren();
    const renderer = PiDishBrowser.createStreamingRenderer({
      document, sessionState: fixtureApp.features.sessionState,
      markdown: text => richText.format(text), stream: (previous, text) => richText.stream(previous, text),
      pinned: () => true, scroll() {}, jump() {},
    });
    renderer.render({ role: 'assistant', content: '# Title\n\nalpha\n\nbeta' });
    const heading = root.querySelector('.markdown-body h1'), alpha = root.querySelector('.markdown-body p');
    renderer.render({ role: 'assistant', content: '# Title\n\nalpha\n\nbeta' });
    const untouched = root.querySelector('.markdown-body p') === alpha;
    renderer.render({ role: 'assistant', content: '# Title\n\nalpha\n\nbeta\n\ngamma' });
    return {
      sameHeading: !!heading && root.querySelector('.markdown-body h1') === heading,
      sameAlpha: !!alpha && root.querySelector('.markdown-body p') === alpha,
      untouched,
    };
  });
  expect(result).toEqual({ sameHeading: true, sameAlpha: true, untouched: true });
});

test('incremental markdown matches a full re-render for every streamed prefix of tricky documents', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const mismatches = await page.evaluate(() => {
    const { richText } = fixtureApp.features;
    const root = fixtureElement(document.getElementById('messages'), '#messages'); root.replaceChildren();
    const renderer = PiDishBrowser.createStreamingRenderer({
      document, sessionState: fixtureApp.features.sessionState,
      markdown: text => richText.format(text), stream: (previous, text) => richText.stream(previous, text),
      pinned: () => true, scroll() {}, jump() {},
    });
    const structure = (node: Element) => Array.from(node.children).map(child => child.outerHTML).join('');
    const reference = (text: string) => {
      const body = document.createElement('div'); body.className = 'markdown-body'; body.innerHTML = richText.format(text); return structure(body);
    };
    // Prefix-by-prefix streaming: lists merging across blank lines (an unfinished
    // marker only needs a `.`), setext underlines, lazy paragraph continuation,
    // fence/table/indented-code absorption, late reference definitions and
    // mid-line whitespace that decides indented code versus paragraph.
    const documents = [
      'para text\n===\n\nbody\n\n- one\n- two\n\n- three\n\nnext',
      'para\n\n- one\n- two\n\n1.\n\n1. merged\n\ntail',
      'text\n\n    code\n\nmore\n\n---\n\n> quoted\n\n> continued',
      'see [ref][id]\n\nand [other]\n\n[id]: https://example.com\n[other]: /x\n\ntail',
      'a\n\n- x\n\n- y\n\n```\nunclosed\n\nmore\n```\n\nafter',
      '   \n \n    indented\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nz',
      'plain **bold** `code` [link](https://example.com/x)\n\n![image](https://example.com/i.png)\n\ntail  \n\nx',
    ];
    const failures: string[] = [];
    for (const document_ of documents) {
      for (let end = 1; end <= document_.length; end++) {
        const text = document_.slice(0, end);
        renderer.render({ role: 'assistant', content: text });
        const live = structure(fixtureElement(root.querySelector('.markdown-body'), '.markdown-body'));
        if (live !== reference(text)) { failures.push(text); break; }
      }
    }
    return failures;
  });
  expect(mismatches).toEqual([]);
});

test('a rewritten or shortened frame replaces the block instead of appending to it', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const { richText } = fixtureApp.features;
    const root = fixtureElement(document.getElementById('messages'), '#messages'); root.replaceChildren();
    const renderer = PiDishBrowser.createStreamingRenderer({
      document, sessionState: fixtureApp.features.sessionState,
      markdown: text => richText.format(text), stream: (previous, text) => richText.stream(previous, text),
      pinned: () => true, scroll() {}, jump() {},
    });
    const body = () => fixtureElement(root.querySelector('.markdown-body'), '.markdown-body');
    const structure = (node: Element) => Array.from(node.children).map(child => child.outerHTML).join('');
    const reference = (text: string) => {
      const node = document.createElement('div'); node.className = 'markdown-body'; node.innerHTML = richText.format(text); return structure(node);
    };
    renderer.render({ role: 'assistant', content: 'first version of the text' });
    const stale = root.querySelector('.markdown-body p');
    renderer.render({ role: 'assistant', content: 'completely different' });
    const rewritten = structure(body()) === reference('completely different');
    const replaced = root.querySelector('.markdown-body p') !== stale;
    renderer.render({ role: 'assistant', content: 'completely' });
    return { rewritten, replaced, shortened: structure(body()) === reference('completely') };
  });
  expect(result).toEqual({ rewritten: true, replaced: true, shortened: true });
});

test('streamed frames collapse scroll work into one animation-frame pass and retire it with the stream', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(async () => {
    fixtureElement(document.getElementById('messages'), '#messages').replaceChildren();
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const calls: string[] = [];
    const renderer = PiDishBrowser.createStreamingRenderer({
      document, sessionState: fixtureApp.features.sessionState, markdown: text => text,
      pinned: () => false, scroll: () => calls.push('scroll'), jump: () => calls.push('jump'),
    });
    renderer.render({ role: 'assistant', content: 'a' });
    renderer.render({ role: 'assistant', content: 'b' });
    const beforeFrame = calls.slice();
    await frame();
    const coalesced = calls.slice();
    renderer.render({ role: 'assistant', content: 'c' });
    renderer.cancel();
    await frame();
    const retired = calls.slice();
    const focused = PiDishBrowser.createStreamingRenderer({
      document, sessionState: fixtureApp.features.sessionState, markdown: text => text,
      pinned: () => true, scroll: () => calls.push('scroll'), jump: () => calls.push('jump'),
    });
    focused.render({ role: 'assistant', content: 'd' });
    await frame();
    return { beforeFrame, coalesced, retired, pinned: calls.slice() };
  });
  expect(result).toEqual({ beforeFrame: [], coalesced: ['jump'], retired: ['jump'], pinned: ['jump', 'scroll'] });
});

test('a completed list stabilizes once the next block starts, so later frames keep its nodes', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const { richText } = fixtureApp.features;
    const root = fixtureElement(document.getElementById('messages'), '#messages'); root.replaceChildren();
    const renderer = PiDishBrowser.createStreamingRenderer({
      document, sessionState: fixtureApp.features.sessionState,
      markdown: text => richText.format(text), stream: (previous, text) => richText.stream(previous, text),
      pinned: () => true, scroll() {}, jump() {},
    });
    const structure = (node: Element) => Array.from(node.children).map(child => child.outerHTML).join('');
    const reference = (text: string) => {
      const node = document.createElement('div'); node.innerHTML = richText.format(text); return structure(node);
    };
    const body = () => fixtureElement(root.querySelector('.markdown-body'), '.markdown-body');
    renderer.render({ role: 'assistant', content: '# A\n\npara A\n\n- one\n- two\n\n' });
    // The list is the last block so far: it may still gain an item, so it stays in the tail.
    const draft = root.querySelector('.markdown-body ul');
    renderer.render({ role: 'assistant', content: '# A\n\npara A\n\n- one\n- two\n\n# B\n\npara B' });
    const list = root.querySelector('.markdown-body ul');
    const heading = root.querySelector('.markdown-body h1');
    renderer.render({ role: 'assistant', content: '# A\n\npara A\n\n- one\n- two\n\n# B\n\npara B\n\nmore' });
    return {
      stabilized: !!list && root.querySelector('.markdown-body ul') === list,
      headingKept: root.querySelector('.markdown-body h1') === heading,
      replacedDraft: list !== draft,
      equivalent: structure(body()) === reference('# A\n\npara A\n\n- one\n- two\n\n# B\n\npara B\n\nmore'),
    };
  });
  expect(result).toEqual({ stabilized: true, headingKept: true, replacedDraft: true, equivalent: true });
});

export {};
