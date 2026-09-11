const { test, expect } = require('./fixtures');
test('message attributes and custom metadata stay literal while hidden messages stay hidden', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const template = document.createElement('template');
    template.innerHTML = messageRenderer.message({ role: 'custom', customType: 'async-result', timestamp: '\"><img src=x onerror=alert(1)>', index: 'bad" onclick="alert(1)', details: { jobs: [{ label: '<script>', durationMs: 2000 }] } });
    return { images: template.content.querySelectorAll('img').length, scripts: template.content.querySelectorAll('script').length, label: template.content.textContent,
      hidden: messageRenderer.message({ role: 'custom', customType: 'hidden', display: false, content: 'secret' }),
      interrupted: messageRenderer.message({ role: 'custom', customType: 'interrupted-thinking', content: 'hidden thinking' }),
      empty: messageRenderer.message({ role: 'assistant', content: [] }) };
  });
  expect(result.images).toBe(0); expect(result.scripts).toBe(0); expect(result.label).toContain('<script>');
  expect(result.hidden).toBe(''); expect(result.empty).toBe(''); expect(result.interrupted).toContain('Interrupted'); expect(result.interrupted).not.toContain('hidden thinking');
});
test('transcript image resources and share controls use the selected owning host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  const html = await page.evaluate(() => messageRenderer.message({ role: 'user', id: 'entry', content: [{ type: 'image', url: '/api/image', mimeType: 'image/png' }] }));
  expect(html).toContain(fleet.peer.base + '/api/image'); expect(html).toContain('loading="lazy"'); expect(html).toContain('data-entry-id="entry"');
  const noExport = await page.evaluate(() => { sessionState.patchSession(sessionState.currentSession.id, { capabilities: { export: false } }, sessionState.currentSession.host); return messageRenderer.message({ role: 'user', id: 'entry', content: 'hello' }); });
  expect(noExport).not.toContain('msg-link-btn');
});
test('retained telemetry keeps its original host and remains usable after restoring that transcript', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  await page.evaluate(() => {
    const template = document.createElement('template'); template.innerHTML = messageRenderer.message({ role: 'assistant', model: 'chosen-model', responseModel: 'actual-model', provider: 'provider', content: 'body', usage: { input: 4, output: 8, cost: { total: 0.1 } }, durationMs: 500 });
    window.retainedTelemetry = template.content.firstElementChild; document.getElementById('messages').append(window.retainedTelemetry);
  });
  await fleet.select(fleet.self);
  await page.evaluate(() => { document.getElementById('messages').append(window.retainedTelemetry); window.retainedTelemetry.querySelector('.message-metadata-btn').click(); });
  await expect(page.locator('#responseDetailsModal')).toBeHidden();
  await fleet.select(fleet.peer);
  await page.evaluate(() => { document.getElementById('messages').append(window.retainedTelemetry); window.retainedTelemetry.querySelector('.message-metadata-btn').click(); });
  await expect(page.locator('#responseDetailsBody')).toContainText('actual-model'); await expect(page.locator('#responseDetailsBody')).toContainText('chosen-model');
});
test('tool grouping preserves the later page anchor and open state when adjacent groups merge', async ({ page, fleet }) => {
  void fleet;
  const result = await page.evaluate(() => {
    const root = document.createElement('div');
    root.innerHTML = '<details class="tool-group" open><summary><span class="tool-group-label"></span><span class="tool-group-preview"></span></summary><div class="tool-group-body"><div class="message tool-result" data-msg-index="1"></div></div></details><details class="tool-group"><summary><span class="tool-group-label"></span><span class="tool-group-preview"></span></summary><div class="tool-group-body"><div class="message assistant no-text" data-msg-index="2"><details class="tool-call"><span class="tool-call-name">Bash</span></details></div></div></details>';
    const anchor = root.lastElementChild; PiDishBrowser.groupToolActivity(root); PiDishBrowser.groupToolActivity(root);
    return { count: root.children.length, anchor: root.firstElementChild === anchor, open: anchor.open, messages: anchor.querySelectorAll('[data-msg-index]').length, summary: anchor.querySelector('.tool-group-label').textContent };
  });
  expect(result).toEqual({ count: 1, anchor: true, open: true, messages: 2, summary: '⚡ 1 tool use' });
});
test('metadata disposal retires delegated buttons and live custom renderer disposal retires DOM updates', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const root = document.getElementById('messages'); root.innerHTML = messageRenderer.message({ role: 'assistant', usage: { output: 1 }, content: 'body' });
    const button = root.querySelector('.message-metadata-btn'); responseDetailsController.dispose(); button.click();
    const before = root.innerHTML; messageRenderer.dispose(); upsertLiveCustomMessage({ role: 'custom', customType: 'future', content: 'late' });
    return { modal: document.getElementById('responseDetailsModal').style.display, count: responseDetailsController.size, unchanged: before === root.innerHTML };
  });
  expect(result).toEqual({ modal: 'none', count: 0, unchanged: true });
});
