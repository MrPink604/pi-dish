const { test, expect } = require('./fixtures');
test('queue decoder ignores malformed rows and displays valid text literally', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => window.fixtureSessionListPatch(sessionState.currentSession.id, { capabilities: { queueCancel: true } }));
  await page.evaluate(() => renderQueueStatus({ steering: [null, {}, '<img src=x onerror=alert(1)>'], followUp: 'bad' }));
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await expect(page.locator('.queue-item-text')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#queuePanel img')).toHaveCount(0);
});
test('replaced queue controls are inert and a double click sends one cancellation', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => window.fixtureSessionListPatch(sessionState.currentSession.id, { capabilities: { queueCancel: true } }));
  await page.evaluate(() => {
    window.queueCancels = [];
    apiFetch = (...args) => new Promise(resolve => window.queueCancels.push({ args, resolve }));
    renderQueueStatus({ followUp: ['first'] }); window.oldQueueEdit = document.querySelector('.queue-item-edit');
    renderQueueStatus({ followUp: ['replacement'] }); window.oldQueueEdit.click();
  });
  expect(await page.evaluate(() => window.queueCancels.length)).toBe(0);
  await page.evaluate(() => { const button = document.querySelector('.queue-item-edit'); window.firstQueueEdit = editQueuedMessage(button); void editQueuedMessage(button); });
  expect(await page.evaluate(() => window.queueCancels.length)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(window.queueCancels[0].args[2].body))).toEqual({ kind: 'followUp', index: 0, text: 'replacement' });
  await page.evaluate(() => { window.queueCancels[0].resolve(new Response('{}')); return window.firstQueueEdit; });
  expect(await page.evaluate(() => localStorage.getItem(draftKey(sessionState.currentSession.id)))).toBe('replacement');
});
test('queue rows retain endpoint ownership and disposal retires response effects', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => window.fixtureSessionListPatch(sessionState.currentSession.id, { capabilities: { queueCancel: true } }));
  await page.evaluate(() => {
    promptDelivery.dispose(); window.deliveryEndpoint = { base: 'http://original' }; window.deliveryCalls = []; window.deliveryRestores = [];
    window.ownedDelivery = PiDishBrowser.createPromptDelivery({ document, sessionState, endpoint: () => window.deliveryEndpoint,
      request: (...args) => new Promise(resolve => window.deliveryCalls.push({ args, resolve })), restore: (...args) => window.deliveryRestores.push(args), status() {} });
    window.ownedDelivery.render({ followUp: ['first'] }); window.deliveryEndpoint = { base: 'http://replacement' };
    document.querySelector('.queue-item-edit').click();
  });
  expect(await page.evaluate(() => window.deliveryCalls.length)).toBe(0);
  await page.evaluate(() => { window.ownedDelivery.render({ followUp: ['second'] }); window.deliveryEdit = window.ownedDelivery.edit(document.querySelector('.queue-item-edit')); window.ownedDelivery.dispose(); window.deliveryCalls[0].resolve(new Response('{}')); return window.deliveryEdit; });
  expect(await page.evaluate(() => window.deliveryRestores)).toEqual([]);
});
test('late side-command success cannot replace a newer answer or status', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => window.fixtureSessionListPatch(sessionState.currentSession.id, { capabilities: { queueCancel: true } }));
  await page.evaluate(() => {
    window.commandReplies = []; apiFetch = (...args) => new Promise(resolve => window.commandReplies.push({ args, resolve }));
    document.getElementById('promptInput').value = '/btw first'; window.firstCommand = sendPrompt();
    document.getElementById('promptInput').value = '/btw second'; window.secondCommand = sendPrompt();
    window.commandReplies[1].resolve(new Response(JSON.stringify({ answer: 'second answer', info: 'second finished' })));
  });
  await page.evaluate(() => window.secondCommand);
  await page.evaluate(() => { window.commandReplies[0].resolve(new Response(JSON.stringify({ answer: 'old answer', info: 'old finished' }))); return window.firstCommand; });
  await expect(page.locator('.btw-panel-answer')).toHaveText('second answer');
  expect(await page.evaluate(() => document.getElementById('status').textContent)).toBe('second finished');
});
test('disposing submit retires late command effects while preserving the next composer', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => window.fixtureSessionListPatch(sessionState.currentSession.id, { capabilities: { queueCancel: true } }));
  await page.evaluate(() => {
    apiFetch = () => new Promise(resolve => { window.finishDisposedCommand = resolve; });
    document.getElementById('promptInput').value = '/btw question'; window.disposedCommand = sendPrompt();
    composerSubmit.dispose(); document.getElementById('promptInput').value = 'later draft';
    window.finishDisposedCommand(new Response(JSON.stringify({ answer: 'disposed answer', info: 'disposed status' })));
  });
  await page.evaluate(() => window.disposedCommand);
  await expect(page.locator('#promptInput')).toHaveValue('later draft');
  await expect(page.locator('.btw-panel-answer')).toHaveText('Asking…');
});
