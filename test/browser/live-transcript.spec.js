const { test, expect, ROOT } = require('./fixtures');
test('a coalesced frame keeps its selection owner even when callers do not explicitly cancel it', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(({ id, host }) => {
    fixtureApp.features.streamingRenderer.queue({ role: 'assistant', content: 'first frame' }); fixtureApp.features.streamingRenderer.queue({ role: 'assistant', content: 'old pending frame' });
    fixtureApp.features.sessionState.advanceSelection(); fixtureApp.features.sessionState.setCurrentSession(id, host); document.getElementById('messages').textContent = 'new host transcript';
  }, { id: ROOT, host: fleet.peer.hostId });
  await page.waitForTimeout(120); await expect(page.locator('#messages')).toHaveText('new host transcript');
});
test('streamed block updates preserve open details and update renamed tools with identical arguments', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const root = document.getElementById('messages'); root.replaceChildren();
    fixtureApp.features.streamingRenderer.render({ role: 'assistant', content: [{ type: 'thinking', thinking: 'first' }, { type: 'toolCall', name: 'first-tool', arguments: { path: 'a' } }] });
    const thinking = root.querySelector('.thinking-block'), tool = root.querySelector('.tool-call'); thinking.open = true; tool.open = true;
    fixtureApp.features.streamingRenderer.render({ role: 'assistant', content: [{ type: 'thinking', thinking: 'second' }, { type: 'toolCall', name: 'renamed-tool', arguments: { path: 'a' } }] });
    return { sameThinking: thinking === root.querySelector('.thinking-block'), sameTool: tool === root.querySelector('.tool-call'), openThinking: thinking.open, openTool: tool.open,
      thinking: thinking.querySelector('.thinking-text').textContent, name: tool.querySelector('.tool-call-name').textContent };
  });
  expect(result).toEqual({ sameThinking: true, sameTool: true, openThinking: true, openTool: true, thinking: 'second', name: 'renamed-tool' });
});
test('cumulative tool starts and updates reuse the panel and replace its image row', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    document.getElementById('messages').replaceChildren();
    const first = fixtureApp.features.liveToolsController.append({ toolCallId: 'same-tool', toolName: 'read', args: { path: 'file' } });
    const repeated = fixtureApp.features.liveToolsController.append({ toolCallId: 'same-tool', toolName: 'read', args: { path: 'file' } });
    for (let n = 0; n < 2; n++) fixtureApp.features.liveToolsController.update({ toolCallId: 'same-tool', partialResult: { content: [{ type: 'text', text: '<literal>' }, { type: 'image', data: 'a', mimeType: 'image/png' }] } });
    return { same: first === repeated, count: document.querySelectorAll('.live-tool-panel').length, images: document.querySelectorAll('.live-tool-panel .msg-images').length, text: document.querySelector('.live-tool-output').textContent };
  });
  expect(result).toEqual({ same: true, count: 1, images: 1, text: '<literal>' });
});
test('completion-only tools render results without inventing a duration and set mood safely', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    document.getElementById('messages').replaceChildren();
    fixtureApp.features.liveToolsController.finish({ toolCallId: 'background', toolName: 'set_mood', args: { description: 'FOCUSED extra', kaomoji: '<literal>\nface' }, result: { content: [{ type: 'text', text: 'done' }] } });
  });
  await expect(page.locator('.live-tool-panel.complete')).toContainText('done'); await expect(page.locator('.live-tool-status.duration')).toHaveCount(0);
  await expect(page.locator('#moodIndicator')).toHaveText('focused <literal> face'); await expect(page.locator('#moodIndicator literal')).toHaveCount(0);
});
test('same-id tool completion on a newer host cannot replace the older retained panel', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(({ id, host }) => {
    const root = document.getElementById('messages'); root.replaceChildren();
    const old = fixtureApp.features.liveToolsController.append({ toolCallId: 'collision', toolName: 'old' }); root.replaceChildren();
    fixtureApp.features.sessionState.advanceSelection(); fixtureApp.features.sessionState.setCurrentSession(id, host);
    fixtureApp.features.liveToolsController.finish({ toolCallId: 'collision', toolName: 'new', result: { content: [{ type: 'text', text: 'new result' }] } });
    return { oldName: old.el.querySelector('.live-tool-name').textContent, oldRunning: old.el.classList.contains('running'), connected: old.el.isConnected, newName: root.querySelector('.live-tool-name').textContent };
  }, { id: ROOT, host: fleet.peer.hostId });
  expect(result).toEqual({ oldName: 'old', oldRunning: true, connected: false, newName: 'new' });
});
test('stream coalescing renders only the latest pending frame and disposal retires its timer', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    fixtureApp.features.streamingRenderer.cancel(); document.getElementById('messages').replaceChildren(); window.frameTexts = [];
    window.frameRenderer = PiDishBrowser.createStreamingRenderer({ document, sessionState: fixtureApp.features.sessionState, markdown: text => { window.frameTexts.push(text); return text; }, pinned: () => false, scroll() {}, jump() {} });
    window.frameRenderer.queue({ role: 'assistant', content: 'first' }); window.frameRenderer.queue({ role: 'assistant', content: 'middle' }); window.frameRenderer.queue({ role: 'assistant', content: 'last' });
  });
  await expect.poll(() => page.evaluate(() => window.frameTexts)).toEqual(['first', 'last']);
  await page.evaluate(() => { window.frameRenderer.queue({ role: 'assistant', content: 'retired' }); window.frameRenderer.dispose(); });
  await page.waitForTimeout(120); expect(await page.evaluate(() => window.frameTexts)).toEqual(['first', 'last']);
});
test('live-tool disposal rejects subsequent mutations and malformed ids', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const root = document.getElementById('messages'); root.replaceChildren();
    fixtureApp.features.liveToolsController.append({ toolCallId: {} }); const malformedCount = fixtureApp.features.liveToolsController.count;
    fixtureApp.features.liveToolsController.append({ toolCallId: 'old', toolName: 'read' }); const before = root.innerHTML;
    fixtureApp.features.liveToolsController.dispose(); fixtureApp.features.liveToolsController.update({ toolCallId: 'old', partialResult: { content: [{ type: 'text', text: 'late' }] } });
    fixtureApp.features.liveToolsController.finish({ toolCallId: 'new', result: { content: [] } });
    return { malformedCount, unchanged: before === root.innerHTML, count: fixtureApp.features.liveToolsController.count };
  });
  expect(result).toEqual({ malformedCount: 0, unchanged: true, count: 0 });
});
