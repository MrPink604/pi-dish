const { test, expect } = require('./fixtures');
test('message attributes and custom metadata stay literal while hidden messages stay hidden', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const template = document.createElement('template');
    template.innerHTML = fixtureApp.features.messageRenderer.message({ role: 'custom', customType: 'async-result', timestamp: '\"><img src=x onerror=alert(1)>', index: 'bad" onclick="alert(1)', details: { jobs: [{ label: '<script>', durationMs: 2000 }] } });
    return { images: template.content.querySelectorAll('img').length, scripts: template.content.querySelectorAll('script').length, label: template.content.textContent,
      hidden: fixtureApp.features.messageRenderer.message({ role: 'custom', customType: 'hidden', display: false, content: 'secret' }),
      interrupted: fixtureApp.features.messageRenderer.message({ role: 'custom', customType: 'interrupted-thinking', content: 'hidden thinking' }),
      empty: fixtureApp.features.messageRenderer.message({ role: 'assistant', content: [] }) };
  });
  expect(result.images).toBe(0); expect(result.scripts).toBe(0); expect(result.label).toContain('<script>');
  expect(result.hidden).toBe(''); expect(result.empty).toBe(''); expect(result.interrupted).toContain('Interrupted'); expect(result.interrupted).not.toContain('hidden thinking');
});
test('IRC peer messages render as cards from both OMP wire shapes', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const structured = document.createElement('template');
    structured.innerHTML = fixtureApp.features.messageRenderer.message({ role: 'custom', customType: 'irc:incoming', id: 'irc-entry', timestamp: 1789160848919, display: true,
      content: '<irc>\nIncoming IRC message from agent `SnapChromeOptions`:\n\nStale envelope copy.\n\nSent while waiting/working. Active interruptible wait stopped early for immediate reading.\n</irc>',
      details: { id: 'x', from: 'SnapChromeOptions', message: 'Body with `code` spans.' } });
    const card = structured.content.firstElementChild;
    const interrupt = document.createElement('template');
    interrupt.innerHTML = fixtureApp.features.messageRenderer.message({ role: 'user', timestamp: 1789160848919, content: 'Current interruptible wait interrupted: IRC message from parent agent `Main`.\n\nParent IRC message:\n\nCorrection on the table.' });
    const fallback = document.createElement('template');
    fallback.innerHTML = fixtureApp.features.messageRenderer.message({ role: 'custom', customType: 'irc:incoming', timestamp: 1789160848919,
      content: '<irc>\nIncoming IRC message from agent `Evil<img src=x onerror=alert(1)>`:\n\nFallback body.\n\nSent while waiting/working. Active interruptible wait stopped early for immediate reading.\n\nIf response expected, reply via `hub` (`op: "send"`, `to: "Evil"`); may finish current step first. No one replies on your behalf.\n</irc>' });
    return {
      cls: card.className, from: card.querySelector('.irc-from')?.textContent, body: card.querySelector('.irc-body')?.textContent,
      envelope: card.textContent.includes('<irc>') || card.textContent.includes('Sent while') || card.textContent.includes('Stale envelope'),
      code: !!card.querySelector('.irc-body code'), link: !!card.querySelector('.msg-link-btn'),
      interruptCls: interrupt.content.firstElementChild.className, interruptFrom: interrupt.content.querySelector('.irc-from')?.textContent,
      interruptBody: interrupt.content.querySelector('.irc-body')?.textContent, interruptRole: !!interrupt.content.querySelector('.message-role'),
      fallbackFrom: fallback.content.querySelector('.irc-from')?.textContent, fallbackImgs: fallback.content.querySelectorAll('img').length,
      fallbackBody: fallback.content.querySelector('.irc-body')?.textContent,
    };
  });
  expect(result.cls).toContain('custom-message irc'); expect(result.from).toBe('SnapChromeOptions');
  expect(result.body).toContain('Body with'); expect(result.code).toBe(true); expect(result.envelope).toBe(false); expect(result.link).toBe(true);
  expect(result.interruptCls).toContain('custom-message irc'); expect(result.interruptFrom).toBe('Main');
  expect(result.interruptBody).toContain('Correction on the table.'); expect(result.interruptRole).toBe(false);
  expect(result.fallbackFrom).toBe('Evil<img src=x onerror=alert(1)>'); expect(result.fallbackImgs).toBe(0);
  expect(result.fallbackBody.trim()).toBe('Fallback body.');
});

test('transcript image resources and share controls use the selected owning host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  const html = await page.evaluate(() => fixtureApp.features.messageRenderer.message({ role: 'user', id: 'entry', content: [{ type: 'image', url: '/api/image', mimeType: 'image/png' }] }));
  expect(html).toContain(fleet.peer.base + '/api/image'); expect(html).toContain('loading="lazy"'); expect(html).toContain('data-entry-id="entry"');
  const noExport = await page.evaluate(() => { window.fixtureSessionListPatch(fixtureApp.features.sessionState.currentSession.id, { capabilities: { export: false } }, fixtureApp.features.sessionState.currentSession.host); return fixtureApp.features.messageRenderer.message({ role: 'user', id: 'entry', content: 'hello' }); });
  expect(noExport).not.toContain('msg-link-btn');
});
test('retained telemetry keeps its original host and remains usable after restoring that transcript', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  await page.evaluate(() => {
    const template = document.createElement('template'); template.innerHTML = fixtureApp.features.messageRenderer.message({ role: 'assistant', model: 'chosen-model', responseModel: 'actual-model', provider: 'provider', content: 'body', usage: { input: 4, output: 8, cost: { total: 0.1 } }, durationMs: 500 });
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
    const root = document.getElementById('messages'); root.innerHTML = fixtureApp.features.messageRenderer.message({ role: 'assistant', usage: { output: 1 }, content: 'body' });
    const button = root.querySelector('.message-metadata-btn'); fixtureApp.features.responseDetailsController.dispose(); button.click();
    const before = root.innerHTML; fixtureApp.features.messageRenderer.dispose(); fixtureApp.features.messageRenderer.upsertCustom({ role: 'custom', customType: 'future', content: 'late' });
    return { modal: document.getElementById('responseDetailsModal').style.display, count: fixtureApp.features.responseDetailsController.size, unchanged: before === root.innerHTML };
  });
  expect(result).toEqual({ modal: 'none', count: 0, unchanged: true });
});
