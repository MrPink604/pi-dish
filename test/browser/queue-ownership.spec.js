const { test, expect, ROOT } = require('./fixtures');
test.use({ liveSessions: true });

test('identical queued prompts retain their own bubbles and cancellation owner', async ({ page, fleet }) => {
  const ids = {};
  for (const host of [fleet.self, fleet.peer]) {
    await fleet.select(host);
    await page.route(`${host.base}/api/sessions/${ROOT}/prompt`, route => route.fulfill({ json: { result: { queued: true } } }));
    await page.locator('#promptInput').fill('identical queued message');
    await page.evaluate(() => sendPrompt());
    ids[host.label] = await page.locator('#messages [data-client-prompt-id]').last().getAttribute('data-client-prompt-id');
    await page.evaluate(() => renderQueueStatus({ followUp: ['identical queued message'] }));
    await expect(page.locator('.queue-item')).toHaveAttribute('data-client-prompt-id', ids[host.label]);
  }
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/queue/cancel`, route => receive(route));
  await page.evaluate(() => { window.editRequest = editQueuedMessage(document.querySelector('.queue-item-edit')); });
  const route = await received;
  await fleet.select(fleet.self);
  await page.locator('#promptInput').fill('self work');
  await route.fulfill({ json: { success: true } });
  await page.evaluate(() => window.editRequest);
  await expect(page.locator('#promptInput')).toHaveValue('self work');
  expect(await page.evaluate(ids => [promptDelivery.has(ids.self), promptDelivery.has(ids.peer)], ids)).toEqual([true, false]);
  await fleet.select(fleet.peer);
  await expect(page.locator('#promptInput')).toHaveValue('identical queued message');
});

test('a peer echo cannot consume the selected host-independent pending prompt', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/prompt`, route => route.fulfill({ json: { result: { queued: true } } }));
  await page.locator('#promptInput').fill('shared echo text');
  await page.evaluate(() => sendPrompt());
  const id = await page.locator('#messages [data-client-prompt-id]').last().getAttribute('data-client-prompt-id');
  await fleet.select(fleet.peer);
  await page.waitForFunction(() => messageStreamController.source?.readyState === 1);
  fleet.peer.emit('message_end', { message: { role: 'user', content: 'shared echo text' } });
  await expect(page.locator('#messages')).toContainText('shared echo text');
  expect(await page.evaluate(id => promptDelivery.has(id), id)).toBe(true);
});

test('stopping one host does not block stopping its same-id peer', async ({ page, fleet }) => {
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  await fleet.select(fleet.self);
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/abort`, route => receive(route));
  await page.evaluate(() => { setTurnInProgress(true); window.selfAbort = abortTurn(); });
  const pending = await received;
  await fleet.select(fleet.peer);
  const endpoint = `${fleet.peer.base}/api/sessions/${ROOT}/abort`;
  await page.route(endpoint, route => route.fulfill({ json: { success: true } }));
  const sent = page.waitForRequest(endpoint);
  await page.evaluate(() => { setTurnInProgress(true); return abortTurn(); });
  await sent;
  await pending.fulfill({ json: { success: true } });
  await page.evaluate(() => window.selfAbort);
});
