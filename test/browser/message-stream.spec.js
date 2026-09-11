const { test, expect, ROOT, CHILD } = require('./fixtures');
async function setup(page, fleet) {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    messageStreamController.stop();
    window.streamSources = []; window.streamTickets = []; window.streamLoads = []; window.streamSelections = []; window.streamStatus = [];
    window.streamEndpoint = { base: 'http://original', token: 'fixture-token' };
    window.ownedStream = PiDishBrowser.createMessageStream({ document, sessionState, endpoint: () => window.streamEndpoint,
      ticket: () => new Promise((resolve, reject) => window.streamTickets.push({ resolve, reject })),
      source: url => { const source = new EventTarget(); Object.assign(source, { url, readyState: 0, close() { this.readyState = 2; } }); window.streamSources.push(source); return source; },
      activity: sessionActivity, renderer: messageRenderer, streaming: streamingRenderer, tools: liveToolsController, delivery: promptDelivery, extensionUI,
      status: (...args) => window.streamStatus.push(args), catchup() {}, refresh() {}, artifacts() {}, pinned: () => false, follow: () => false, scroll() {}, jump() {}, highlight() {},
      select: (...args) => window.streamSelections.push(args), deleteCached() {}, loadSessions: () => new Promise(resolve => window.streamLoads.push(resolve)),
    });
    window.emitOwnedStream = (index, type, value) => window.streamSources[index].dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) }));
  });
}
test('only the newest ticket request may open a stream for the same selection', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.firstStreamStart = window.ownedStream.start(); window.secondStreamStart = window.ownedStream.start(); window.streamTickets[1].resolve('second'); });
  await page.evaluate(() => window.secondStreamStart);
  await page.evaluate(() => { window.streamTickets[0].resolve('first'); return window.firstStreamStart; });
  expect(await page.evaluate(() => window.streamSources.map(source => source.url))).toEqual([`http://original/api/sessions/${ROOT}/stream?ticket=second`]);
});
test('endpoint changes and disposal retire pending stream tickets', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.oldEndpointStart = window.ownedStream.start(); window.streamEndpoint = { base: 'http://new', token: 'fixture-new' }; window.streamTickets[0].resolve('old'); });
  await page.evaluate(() => window.oldEndpointStart);
  expect(await page.evaluate(() => window.streamSources.length)).toBe(0);
  await page.evaluate(() => { window.disposedStreamStart = window.ownedStream.start(); window.ownedStream.dispose(); window.streamTickets[1].reject(new Error('late')); return window.disposedStreamStart; });
  expect(await page.evaluate(() => ({ sources: window.streamSources.length, status: window.streamStatus }))).toEqual({ sources: 0, status: [] });
});
test('retired stream events cannot change turn state or schedule a reconnect', async ({ page, fleet }) => {
  await setup(page, fleet); await page.clock.install();
  await page.evaluate(() => { window.streamEndpoint.token = null; window.ownedStream.start(); window.ownedStream.stop(); window.emitOwnedStream(0, 'turn_start', {}); window.streamSources[0].onerror(); });
  expect(await page.evaluate(() => sessionActivity.turn)).toBe(false);
  await page.clock.runFor(3100);
  expect(await page.evaluate(() => window.streamSources.length)).toBe(1);
});
test('duplicate closed-stream errors own only one reconnect timer', async ({ page, fleet }) => {
  await setup(page, fleet); await page.clock.install();
  await page.evaluate(() => { window.streamEndpoint.token = null; window.ownedStream.start(); const source = window.streamSources[0]; source.close(); source.onerror(); source.onerror(); });
  await page.clock.runFor(3100);
  expect(await page.evaluate(() => window.streamSources.length)).toBe(2);
  await page.evaluate(() => window.ownedStream.dispose());
});
test('duplicate completed messages and late updates cannot resurrect a streaming bubble', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    window.streamEndpoint.token = null; window.ownedStream.start();
    const message = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'completed stream answer' }] };
    window.emitOwnedStream(0, 'message_end', { message }); window.emitOwnedStream(0, 'message_end', { message: { ...message, usage: { input: 10 } } }); window.emitOwnedStream(0, 'message_update', { message });
  });
  await expect(page.locator('#messages .message.assistant')).toHaveCount(1);
  await expect(page.locator('#messages [data-streaming="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => sessionActivity.turn)).toBe(false);
});
test('the newest session-switch event owns delayed list navigation', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(child => {
    const host = sessionState.currentSession.host;
    sessionState.setSessionLists({ previous: [...sessionState.sessions.previous, { id: 'newer-transcript', host }] });
    window.streamEndpoint.token = null; window.ownedStream.start();
    window.emitOwnedStream(0, 'session_switch', { sessionId: child }); window.emitOwnedStream(0, 'session_switch', { sessionId: 'newer-transcript' });
    window.streamLoads[1]();
  }, CHILD);
  await page.evaluate(() => window.streamLoads[0]());
  expect(await page.evaluate(() => window.streamSelections.map(([id]) => id))).toEqual(['newer-transcript']);
});
