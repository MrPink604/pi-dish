import type { Route } from '@playwright/test';
import { test, expect, ROOT } from './fixtures.js';
test.use({ liveSessions: true });

test('identical queued prompts retain their own bubbles and cancellation owner', async ({ page, fleet }) => {
  const ids: Record<string, string> = {};
  for (const host of [fleet.self, fleet.peer]) {
    await fleet.select(host);
    await page.route(`${host.base}/api/sessions/${ROOT}/prompt`, route => route.fulfill({ json: { result: { queued: true } } }));
    await page.locator('#promptInput').fill('identical queued message');
    await page.evaluate(() => fixtureApp.features.composerSubmit.sendPrompt());
    const id = await page.locator('#messages [data-client-prompt-id]').last().getAttribute('data-client-prompt-id');
    if (id === null) throw new Error(`Missing queued prompt id for ${host.label}`);
    ids[host.label] = id;
    await page.waitForFunction(() => fixtureApp.features.messageStreamController.source?.readyState === 1);
    host.emit('queue_update', { followUp: ['identical queued message'] });
    await expect(page.locator('.queue-item')).toHaveAttribute('data-client-prompt-id', id);
  }
  let receive: ((route: Route) => void) | undefined;
  const received = new Promise<Route>(resolve => { receive = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/queue/cancel`, route => {
    if (!receive) throw new Error('Queue-cancel route resolver not initialized');
    receive(route);
  });
  await page.evaluate(() => { window.editRequest = fixtureApp.features.promptDelivery.edit(fixtureElement(document.querySelector<HTMLElement>('.queue-item-edit'), '.queue-item-edit')); });
  const route = await received;
  await fleet.select(fleet.self);
  await page.locator('#promptInput').fill('self work');
  await route.fulfill({ json: { success: true } });
  await page.evaluate(() => window.editRequest);
  await expect(page.locator('#promptInput')).toHaveValue('self work');
  expect(await page.evaluate(ids => [fixtureApp.features.promptDelivery.has(fixtureElement(ids.self, 'self prompt id')), fixtureApp.features.promptDelivery.has(fixtureElement(ids.peer, 'peer prompt id'))], ids)).toEqual([true, false]);
  await fleet.select(fleet.peer);
  await expect(page.locator('#promptInput')).toHaveValue('identical queued message');
});

test('a peer echo cannot consume the selected host-independent pending prompt', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/prompt`, route => route.fulfill({ json: { result: { queued: true } } }));
  await page.locator('#promptInput').fill('shared echo text');
  await page.evaluate(() => fixtureApp.features.composerSubmit.sendPrompt());
  const id = await page.locator('#messages [data-client-prompt-id]').last().getAttribute('data-client-prompt-id');
  if (id === null) throw new Error('Missing pending prompt id');
  await fleet.select(fleet.peer);
  await page.waitForFunction(() => fixtureApp.features.messageStreamController.source?.readyState === 1);
  fleet.peer.emit('message_end', { message: { role: 'user', content: 'shared echo text' } });
  await expect(page.locator('#messages')).toContainText('shared echo text');
  expect(await page.evaluate(id => fixtureApp.features.promptDelivery.has(id), id)).toBe(true);
});

test('stopping one host does not block stopping its same-id peer', async ({ page, fleet }) => {
  let receive: ((route: Route) => void) | undefined;
  const received = new Promise<Route>(resolve => { receive = resolve; });
  await fleet.select(fleet.self);
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/abort`, route => {
    if (!receive) throw new Error('Abort route resolver not initialized');
    receive(route);
  });
  await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); window.selfAbort = fixtureApp.features.composerSubmit.abortTurn(); });
  const pending = await received;
  await fleet.select(fleet.peer);
  const endpoint = `${fleet.peer.base}/api/sessions/${ROOT}/abort`;
  await page.route(endpoint, route => route.fulfill({ json: { success: true } }));
  const sent = page.waitForRequest(endpoint);
  await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); return fixtureApp.features.composerSubmit.abortTurn(); });
  await sent;
  await pending.fulfill({ json: { success: true } });
  await page.evaluate(() => window.selfAbort);
});

export {};
