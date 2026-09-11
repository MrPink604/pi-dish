const { test, expect, ROOT } = require('./fixtures');
async function setup(page, fleet) {
  await fleet.select(fleet.self);
  await page.evaluate(({ self, peer }) => {
    window.transcriptReplies = []; window.transcriptHosts = { [self.hostId]: { base: self.base }, [peer.hostId]: { base: peer.base } };
    window.ownedTranscript = PiDishBrowser.createTranscript({ document, sessionState,
      request: (host, path, init) => new Promise(resolve => window.transcriptReplies.push({ host, path, init, resolve })), host: id => window.transcriptHosts[id],
      renderMessage: value => messageRenderer.message(value), finalize: (root, options) => finalizeRender(root, options), closeSearch() {}, cancelStreaming() {},
      mood: (description, face) => setMoodIndicator(description, face), updateMood: messages => updateMoodFromMessages(messages), pinned: () => false, scroll() {}, jump() {}, consumeEcho() {},
    });
  }, { self: { hostId: fleet.self.hostId, base: fleet.self.base }, peer: { hostId: fleet.peer.hostId, base: fleet.peer.base } });
}
const baseline = { messages: [{ role: 'user', index: 10, content: 'baseline' }], firstIndex: 10, lastIndex: 10, totalMessages: 11, hasMore: true };
async function reply(page, index, data, status = 200) { await page.evaluate(({ index, data, status }) => window.transcriptReplies[index].resolve(new Response(JSON.stringify(data), { status })), { index, data, status }); }
async function initial(page) { await page.evaluate(() => { window.transcriptLoad = window.ownedTranscript.load(); }); await reply(page, 0, baseline); await page.evaluate(() => window.transcriptLoad); }
test('overlapping tail loads on one selection keep only the newest response', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.oldTail = window.ownedTranscript.load(); window.newTail = window.ownedTranscript.load(); });
  await reply(page, 1, { ...baseline, messages: [{ role: 'user', index: 10, content: 'new tail' }] }); await page.evaluate(() => window.newTail);
  await reply(page, 0, { ...baseline, messages: [{ role: 'user', index: 10, content: 'old tail' }] }); await page.evaluate(() => window.oldTail);
  await expect(page.locator('#messages')).toContainText('new tail'); await expect(page.locator('#messages')).not.toContainText('old tail');
});
test('an old older-page finalizer cannot release the replacement transcript paging request', async ({ page, fleet }) => {
  await setup(page, fleet); await initial(page);
  await page.evaluate(() => { window.oldPage = window.ownedTranscript.loadOlder(); window.newTail = window.ownedTranscript.load(); });
  await reply(page, 2, baseline); await page.evaluate(() => window.newTail);
  await page.evaluate(() => { window.newPage = window.ownedTranscript.loadOlder(); });
  await reply(page, 1, { messages: [], hasMore: false }); await page.evaluate(() => window.oldPage);
  expect(await page.evaluate(() => window.ownedTranscript.loadingOlder)).toBe(true);
  await reply(page, 3, { messages: [{ role: 'user', index: 5, content: 'older page' }], firstIndex: 5, hasMore: false }); await page.evaluate(() => window.newPage);
  expect(await page.evaluate(() => ({ loading: window.ownedTranscript.loadingOlder, oldest: window.ownedTranscript.oldestIndex }))).toEqual({ loading: false, oldest: 5 });
});
test('out-of-order catchup cannot regress the cursor or blank the retained final answer', async ({ page, fleet }) => {
  await setup(page, fleet); await initial(page);
  await page.evaluate(() => { document.getElementById('messages').insertAdjacentHTML('beforeend', renderAssistantMessage({ role: 'assistant', content: 'retained answer' }, '')); window.oldCatchup = window.ownedTranscript.catchup(); window.newCatchup = window.ownedTranscript.catchup(); });
  await reply(page, 2, { messages: [{ role: 'toolResult', index: 11, content: 'tool done' }], lastIndex: 11, totalMessages: 12 }); await page.evaluate(() => window.newCatchup);
  await reply(page, 1, { messages: [{ role: 'assistant', index: 9, content: 'old answer' }], lastIndex: 9, totalMessages: 10 }); await page.evaluate(() => window.oldCatchup);
  expect(await page.evaluate(() => window.ownedTranscript.lastIndex)).toBe(11); await expect(page.locator('#messages')).toContainText('retained answer'); await expect(page.locator('#messages')).not.toContainText('old answer');
  await page.evaluate(() => { window.finalCatchup = window.ownedTranscript.catchup(); });
  await reply(page, 3, { messages: [{ role: 'assistant', index: 12, content: 'authoritative answer' }], lastIndex: 12, totalMessages: 13 }); await page.evaluate(() => window.finalCatchup);
  await expect(page.locator('#messages')).not.toContainText('retained answer'); await expect(page.locator('#messages')).toContainText('authoritative answer');
});
test('cached DOM keeps host identity, node state and endpoint ownership', async ({ page, fleet }) => {
  await setup(page, fleet); await initial(page);
  const result = await page.evaluate(({ id, self, peer }) => {
    const root = document.getElementById('messages'), node = root.querySelector('[data-msg-index]'); node.dataset.retained = 'yes'; window.ownedTranscript.stash();
    sessionState.advanceSelection(); sessionState.setCurrentSession(id, peer); const wrongHost = window.ownedTranscript.restore(id);
    sessionState.advanceSelection(); sessionState.setCurrentSession(id, self); const restored = window.ownedTranscript.restore(id), same = root.querySelector('[data-msg-index]') === node;
    window.ownedTranscript.stash(); window.transcriptHosts[self].base += '/changed'; const wrongEndpoint = window.ownedTranscript.restore(id);
    return { wrongHost, restored, same, wrongEndpoint };
  }, { id: ROOT, self: fleet.self.hostId, peer: fleet.peer.hostId });
  expect(result).toEqual({ wrongHost: false, restored: true, same: true, wrongEndpoint: false });
});
test('retained cache trims old messages and enforces session and age limits', async ({ page, fleet }) => {
  void fleet;
  const result = await page.evaluate(() => {
    const cache = PiDishBrowser.createTranscriptCache(document), root = document.createElement('div');
    root.innerHTML = Array.from({ length: 350 }, (_, index) => `<div data-msg-index="${index}">${index}</div>`).join('');
    cache.stash('self many', '', { oldestIndex: 0, lastIndex: 349, hasOlder: false, total: 350 }, root);
    const restored = cache.restore('self many', '', root), trimmed = { count: root.children.length, first: restored.oldestIndex, more: restored.hasOlder };
    for (let i = 0; i < 6; i++) { root.innerHTML = '<div data-msg-index="0">x</div>'; cache.stash('self ' + i, '', { oldestIndex: 0, lastIndex: 0, hasOlder: false, total: 1 }, root); }
    const evicted = !cache.restore('self 0', '', root), count = cache.size, now = Date.now;
    let expired; try { Date.now = () => now() + 16 * 60 * 1000; expired = !cache.restore('self 5', '', root); } finally { Date.now = now; }
    return { trimmed, evicted, count, expired };
  });
  expect(result).toEqual({ trimmed: { count: 300, first: 50, more: true }, evicted: true, count: 5, expired: true });
});
test('replaced paging buttons and disposed requests cannot mutate the current transcript', async ({ page, fleet }) => {
  await setup(page, fleet); await initial(page);
  await page.evaluate(() => { window.oldPagingButton = document.querySelector('.load-older-btn'); window.newTail = window.ownedTranscript.load(); });
  await reply(page, 1, baseline); await page.evaluate(() => window.newTail);
  await page.evaluate(() => window.oldPagingButton.click()); expect(await page.evaluate(() => window.transcriptReplies.length)).toBe(2);
  await page.evaluate(() => { window.retiredTail = window.ownedTranscript.load(); window.ownedTranscript.dispose(); document.getElementById('messages').textContent = 'after disposal'; });
  await reply(page, 2, baseline); await page.evaluate(() => window.retiredTail); await expect(page.locator('#messages')).toHaveText('after disposal');
});
test('transcript HTTP failures render literal text and leave paging unavailable', async ({ page, fleet }) => {
  await setup(page, fleet); await page.evaluate(() => { window.failedTail = window.ownedTranscript.load(); });
  await reply(page, 0, { error: '<img src=x onerror=alert(1)>' }, 500); await page.evaluate(() => window.failedTail);
  await expect(page.locator('#messages .error')).toContainText('<img'); await expect(page.locator('#messages img')).toHaveCount(0);
  expect(await page.evaluate(() => window.ownedTranscript.hasOlder)).toBe(false);
});
