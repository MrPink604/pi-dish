import type { Page, Route } from '@playwright/test';
import type { FleetFixture } from './fixtures.js';
import { test, expect, ROOT } from './fixtures.js';
async function setup(page: Page, fleet: FleetFixture) {
  await fleet.select(fleet.self);
  await page.evaluate(({ self, peer }) => {
    window.transcriptReplies = []; window.transcriptHosts = { [self.hostId]: { base: self.base }, [peer.hostId]: { base: peer.base } };
    window.ownedTranscript = PiDishBrowser.createTranscript({ document, sessionState: fixtureApp.features.sessionState,
      request: (host, path, init) => new Promise(resolve => window.transcriptReplies.push({ host, path, init, resolve })), host: id => id ? window.transcriptHosts[id] ?? null : null,
      renderMessage: value => fixtureApp.features.messageRenderer.message(value), finalize: (root, options) => fixtureApp.ports.transcriptController.finalize(root, options), closeSearch() {}, cancelStreaming() {},
      mood: (description, face) => fixtureApp.features.moodController.set(description, face), updateMood: messages => fixtureApp.features.moodController.fromMessages(messages), pinned: () => false, scroll() {}, jump() {}, consumeEcho() {},
    });
  }, { self: { hostId: fleet.self.hostId, base: fleet.self.base }, peer: { hostId: fleet.peer.hostId, base: fleet.peer.base } });
}
const baseline = { messages: [{ role: 'user', index: 10, content: 'baseline' }], firstIndex: 10, lastIndex: 10, totalMessages: 11, hasMore: true };
async function reply(page: Page, index: number, data: unknown, status = 200) { await page.evaluate(({ index, data, status }) => fixtureElement(window.transcriptReplies[index], `transcript reply ${index}`).resolve(new Response(JSON.stringify(data), { status })), { index, data, status }); }
async function initial(page: Page) { await page.evaluate(() => { window.transcriptLoad = window.ownedTranscript.load(); }); await reply(page, 0, baseline); await page.evaluate(() => window.transcriptLoad); }
test('overlapping tail loads on one selection keep only the newest response', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.oldTail = window.ownedTranscript.load(); window.newTail = window.ownedTranscript.load(); });
  await reply(page, 1, { ...baseline, messages: [{ role: 'user', index: 10, content: 'new tail' }] }); await page.evaluate(() => window.newTail);
  await reply(page, 0, { ...baseline, messages: [{ role: 'user', index: 10, content: 'old tail' }] }); await page.evaluate(() => window.oldTail);
  await expect(page.locator('#messages')).toContainText('new tail'); await expect(page.locator('#messages')).not.toContainText('old tail');
});
test('a second older-page request joins the page already loading', async ({ page, fleet }) => {
  await setup(page, fleet); await initial(page);
  await page.evaluate(() => {
    window.firstPage = window.ownedTranscript.loadOlder();
    window.joinedPage = window.ownedTranscript.loadOlder();
    window.joinedSettled = false;
    void window.joinedPage.then(() => { window.joinedSettled = true; });
  });
  // The join must not issue a second page request, and must not report a
  // completed page while that request is still open.
  expect(await page.evaluate(() => window.transcriptReplies.length)).toBe(2);
  expect(await page.evaluate(() => window.joinedSettled)).toBe(false);
  await reply(page, 1, { messages: [{ role: 'user', index: 5, content: 'joined older page' }], firstIndex: 5, hasMore: false });
  await page.evaluate(() => Promise.all([window.firstPage, window.joinedPage]));
  expect(await page.evaluate(() => ({ settled: window.joinedSettled, oldest: window.ownedTranscript.oldestIndex, loading: window.ownedTranscript.loadingOlder }))).toEqual({ settled: true, oldest: 5, loading: false });
  await expect(page.locator('#messages')).toContainText('joined older page');
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
  await page.evaluate(() => { fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").insertAdjacentHTML('beforeend', fixtureApp.features.messageRenderer.assistant({ role: 'assistant', content: 'retained answer' }, '')); window.oldCatchup = window.ownedTranscript.catchup(); window.newCatchup = window.ownedTranscript.catchup(); });
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
    const root = fixtureElement(document.getElementById('messages'), '#messages');
    const node = fixtureElement(root.querySelector<HTMLElement>('[data-msg-index]'), 'message node'); node.dataset.retained = 'yes'; window.ownedTranscript.stash();
    fixtureApp.features.sessionState.advanceSelection(); fixtureApp.features.sessionState.setCurrentSession(id, peer); const wrongHost = window.ownedTranscript.restore(id);
    fixtureApp.features.sessionState.advanceSelection(); fixtureApp.features.sessionState.setCurrentSession(id, self); const restored = window.ownedTranscript.restore(id), same = root.querySelector('[data-msg-index]') === node;
    window.ownedTranscript.stash(); fixtureElement(window.transcriptHosts[self], 'self transcript host').base += '/changed'; const wrongEndpoint = window.ownedTranscript.restore(id);
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
    const restored = cache.restore('self many', '', root);
    if (restored === null) throw new Error('Missing restored');
    const trimmed = { count: root.children.length, first: restored.oldestIndex, more: restored.hasOlder };
    for (let i = 0; i < 6; i++) { root.innerHTML = '<div data-msg-index="0">x</div>'; cache.stash('self ' + i, '', { oldestIndex: 0, lastIndex: 0, hasOlder: false, total: 1 }, root); }
    const evicted = !cache.restore('self 0', '', root), count = cache.size, now = Date.now;
    let expired; try { Date.now = () => now() + 16 * 60 * 1000; expired = !cache.restore('self 5', '', root); } finally { Date.now = now; }
    return { trimmed, evicted, count, expired };
  });
  expect(result).toEqual({ trimmed: { count: 300, first: 50, more: true }, evicted: true, count: 5, expired: true });
});
test('replaced paging buttons and disposed requests cannot mutate the current transcript', async ({ page, fleet }) => {
  await setup(page, fleet); await initial(page);
  await page.evaluate(() => { window.oldPagingButton = document.querySelector<HTMLElement>('.load-older-btn'); window.newTail = window.ownedTranscript.load(); });
  await reply(page, 1, baseline); await page.evaluate(() => window.newTail);
  await page.evaluate(() => fixtureElement(window.oldPagingButton, 'old paging button').click()); expect(await page.evaluate(() => window.transcriptReplies.length)).toBe(2);
  await page.evaluate(() => { window.retiredTail = window.ownedTranscript.load(); window.ownedTranscript.dispose(); fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").textContent = 'after disposal'; });
  await reply(page, 2, baseline); await page.evaluate(() => window.retiredTail); await expect(page.locator('#messages')).toHaveText('after disposal');
});
test('transcript HTTP failures render literal text and leave paging unavailable', async ({ page, fleet }) => {
  await setup(page, fleet); await page.evaluate(() => { window.failedTail = window.ownedTranscript.load(); });
  await reply(page, 0, { error: '<img src=x onerror=alert(1)>' }, 500); await page.evaluate(() => window.failedTail);
  await expect(page.locator('#messages .error')).toContainText('<img'); await expect(page.locator('#messages img')).toHaveCount(0);
  expect(await page.evaluate(() => window.ownedTranscript.hasOlder)).toBe(false);
});

test('deep windows preserve gaps, grouped nodes and the live cursor across host-qualified restoration', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(async ({ id, self, peer }) => {
    const requests: string[] = [], root = fixtureElement(document.getElementById('messages'), 'messages');
    const waitForMessage = (index: number) => new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        if (root.querySelector(`[data-msg-index="${index}"]`)) { observer.disconnect(); resolve(); }
      });
      observer.observe(root, { childList: true, subtree: true });
    });
    let live = false;
    const transcript = PiDishBrowser.createTranscript({ ...fixtureApp.ports.transcriptController, scroll() {}, jump() {},
      request: async (_host, path) => {
        requests.push(path);
        const query = new URL(path, location.origin).searchParams, after = query.get('after');
        const end = after == null ? Number(query.get('before') || 20000) : 20001;
        const start = after == null ? Math.max(0, end - 50) : Number(after) + 1;
        return new Response(JSON.stringify({
          messages: Array.from({ length: Math.max(0, end - start) }, (_, offset) => ({ index: start + offset,
            role: start + offset === 10 || start + offset === 19950 ? 'toolResult' : 'user', content: `message ${start + offset}` })),
          firstIndex: start, lastIndex: end - 1, totalMessages: live ? 20001 : 20000, hasMore: start > 0,
        }));
      },
    });
    try {
      await transcript.load();
      const tail = fixtureElement(root.querySelector('[data-msg-index="19999"]'), 'retained tail');
      await transcript.ensureMessage(10, () => true);
      const hit = fixtureElement(root.querySelector('[data-msg-index="10"]'), 'deep hit');
      const group = fixtureDetails(hit.closest('details.tool-group'), 'hit group'); group.open = true;
      const deep = { requests: requests.length - 1, mounted: root.querySelectorAll('[data-msg-index]').length,
        oldest: transcript.oldestIndex, last: transcript.lastIndex, gap: root.querySelector('.transcript-gap span')?.textContent };
      transcript.retire(); transcript.stash();
      fixtureApp.features.sessionState.advanceSelection(); fixtureApp.features.sessionState.setCurrentSession(id, peer);
      const wrongHost = transcript.restore(id);
      fixtureApp.features.sessionState.advanceSelection(); fixtureApp.features.sessionState.setCurrentSession(id, self);
      const restored = transcript.restore(id);
      live = true; await transcript.catchup();
      const retained = { wrongHost, restored, hit: root.querySelector('[data-msg-index="10"]') === hit,
        group: root.querySelector('[data-msg-index="10"]')?.closest('details.tool-group') === group, open: group.open,
        tail: root.querySelector('[data-msg-index="19999"]') === tail, last: transcript.lastIndex, catchup: requests.at(-1) };
      const newerLoaded = waitForMessage(99);
      fixtureElement(root.querySelector<HTMLButtonElement>('.transcript-gap [data-direction="newer"]'), 'newer gap control').click();
      await newerLoaded;
      const newer = { first: !!root.querySelector('[data-msg-index="50"]'), last: !!root.querySelector('[data-msg-index="99"]') };
      const olderLoaded = waitForMessage(19900);
      fixtureElement(root.querySelector<HTMLButtonElement>('.transcript-gap [data-direction="older"]'), 'older gap control').click();
      await olderLoaded;
      const indices = Array.from(root.querySelectorAll<HTMLElement>('[data-msg-index]'), node => Number(node.dataset.msgIndex));
      return { deep, retained, newer, older: !!root.querySelector('[data-msg-index="19900"]'),
        sortedUnique: indices.every((index, i) => i === 0 || index > indices[i - 1]!), last: transcript.lastIndex };
    } finally { transcript.dispose(); }
  }, { id: ROOT, self: fleet.self.hostId, peer: fleet.peer.hostId });
  expect(result.deep).toEqual({ requests: 1, mounted: 100, oldest: 0, last: 19999, gap: '19900 messages not loaded' });
  expect(result.retained).toEqual({ wrongHost: false, restored: true, hit: true, group: true, open: true, tail: true, last: 20000,
    catchup: `/api/sessions/${ROOT}/messages?after=19999` });
  expect(result.newer).toEqual({ first: true, last: true });
  expect(result.older).toBe(true); expect(result.sortedUnique).toBe(true); expect(result.last).toBe(20000);
});

test('an older page racing a targeted window remains chronological and deduplicates overlap', async ({ page, fleet }) => {
  await setup(page, fleet); await page.evaluate(() => { window.transcriptLoad = window.ownedTranscript.load(); });
  await reply(page, 0, { messages: [{ index: 100, role: 'user', content: 'tail' }], firstIndex: 100, lastIndex: 100, totalMessages: 101, hasMore: true });
  await page.evaluate(() => window.transcriptLoad);
  await page.evaluate(() => { window.oldPage = window.ownedTranscript.loadOlder(); window.newPage = window.ownedTranscript.ensureMessage(10, () => true); });
  await reply(page, 2, { messages: Array.from({ length: 50 }, (_, index) => ({ index, role: 'user', content: `hit context ${index}` })), firstIndex: 0, lastIndex: 49 });
  await page.evaluate(() => window.newPage);
  await page.evaluate(() => { window.newPage = window.ownedTranscript.ensureMessage(75, () => true); });
  await reply(page, 3, { messages: Array.from({ length: 50 }, (_, offset) => ({ index: offset + 51, role: 'user', content: `overlap ${offset + 51}` })), firstIndex: 51, lastIndex: 100 });
  await page.evaluate(() => window.newPage);
  await reply(page, 1, { messages: Array.from({ length: 50 }, (_, offset) => ({ index: offset + 50, role: 'user', content: `older ${offset + 50}` })), firstIndex: 50, lastIndex: 99, hasMore: true });
  await page.evaluate(() => window.oldPage);
  expect(await page.evaluate(() => ({
    indices: Array.from(document.querySelectorAll<HTMLElement>('#messages [data-msg-index]'), node => Number(node.dataset.msgIndex)),
    oldest: window.ownedTranscript.oldestIndex, last: window.ownedTranscript.lastIndex,
  }))).toEqual({ indices: Array.from({ length: 101 }, (_, index) => index), oldest: 0, last: 100 });
});

test('live catchup fills a search window ahead of the live cursor without reordering or duplicating messages', async ({ page, fleet }) => {
  await setup(page, fleet); await page.evaluate(() => { window.transcriptLoad = window.ownedTranscript.load(); });
  await reply(page, 0, { messages: [{ index: 100, role: 'user', content: 'tail' }], firstIndex: 100, lastIndex: 100, totalMessages: 101, hasMore: true });
  await page.evaluate(() => window.transcriptLoad);
  await page.evaluate(() => { window.newPage = window.ownedTranscript.ensureMessage(200, () => true); });
  await reply(page, 1, { messages: Array.from({ length: 50 }, (_, offset) => ({ index: offset + 151, role: 'user', content: `new hit context ${offset + 151}` })), firstIndex: 151, lastIndex: 200, totalMessages: 211 });
  await page.evaluate(() => window.newPage);
  expect(await page.evaluate(() => window.ownedTranscript.lastIndex)).toBe(100);
  await page.evaluate(() => { window.newCatchup = window.ownedTranscript.catchup(); });
  expect(await page.evaluate(() => fixtureElement(window.transcriptReplies[2], 'live catchup').path)).toBe(`/api/sessions/${ROOT}/messages?after=100`);
  await reply(page, 2, { messages: Array.from({ length: 110 }, (_, offset) => ({ index: offset + 101, role: 'user', content: `live output ${offset + 101}` })), firstIndex: 101, lastIndex: 210, totalMessages: 211 });
  await page.evaluate(() => window.newCatchup);
  expect(await page.evaluate(() => ({
    indices: Array.from(document.querySelectorAll<HTMLElement>('#messages [data-msg-index]'), node => Number(node.dataset.msgIndex)),
    last: window.ownedTranscript.lastIndex, gaps: document.querySelectorAll('#messages .transcript-gap').length,
  }))).toEqual({ indices: Array.from({ length: 111 }, (_, index) => index + 100), last: 210, gaps: 0 });
});

test('filling a sparse tool gap merges groups without replacing retained details or their open state', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(async () => {
    const root = fixtureElement(document.getElementById('messages'), 'messages');
    const transcript = PiDishBrowser.createTranscript({ ...fixtureApp.ports.transcriptController, scroll() {}, jump() {},
      request: async (_host, path) => {
        const end = Number(new URL(path, location.origin).searchParams.get('before') || 120), start = Math.max(0, end - 50);
        return new Response(JSON.stringify({ messages: Array.from({ length: end - start }, (_, offset) => ({
          index: start + offset, role: 'toolResult', toolName: 'read', content: `tool result ${start + offset}`,
        })), firstIndex: start, lastIndex: end - 1, totalMessages: 120, hasMore: start > 0 }));
      },
    });
    try {
      await transcript.load();
      const tail = fixtureDetails(root.querySelector('details.tool-group'), 'tail group');
      await transcript.ensureMessage(10, () => true);
      const hit = fixtureElement(root.querySelector('[data-msg-index="10"]'), 'tool hit');
      fixtureDetails(hit.closest('details.tool-group'), 'hit group').open = true;
      const before = root.querySelectorAll(':scope > details.tool-group').length;
      const filled = new Promise<void>(resolve => {
        const observer = new MutationObserver(() => {
          if (!root.querySelector('.transcript-gap')) { observer.disconnect(); resolve(); }
        });
        observer.observe(root, { childList: true, subtree: true });
      });
      fixtureElement(root.querySelector<HTMLButtonElement>('.transcript-gap [data-direction="newer"]'), 'gap control').click();
      await filled;
      return { before, groups: root.querySelectorAll(':scope > details.tool-group').length, gaps: root.querySelectorAll('.transcript-gap').length,
        sameTail: root.querySelector('details.tool-group') === tail, sameHit: root.querySelector('[data-msg-index="10"]') === hit,
        open: tail.open, indices: Array.from(root.querySelectorAll<HTMLElement>('[data-msg-index]'), node => Number(node.dataset.msgIndex)) };
    } finally { transcript.dispose(); }
  });
  expect(result).toEqual({ before: 2, groups: 1, gaps: 0, sameTail: true, sameHit: true, open: true,
    indices: Array.from({ length: 120 }, (_, index) => index) });
});

for (const change of ['query', 'host', 'selection', 'endpoint', 'token'] as const) {
  test(`a deep window cannot commit after its ${change} owner changes`, async ({ page, fleet }) => {
    await setup(page, fleet); await initial(page);
    const result = await page.evaluate(async ({ change, id, peer }) => {
      let current = true;
      const flight = window.ownedTranscript.ensureMessage(0, () => current);
      if (change === 'query') current = false;
      else if (change === 'host') {
        fixtureApp.features.sessionState.advanceSelection(); fixtureApp.features.sessionState.setCurrentSession(id, peer);
      } else if (change === 'selection') fixtureApp.features.sessionState.advanceSelection();
      else {
        const host = fixtureElement(window.transcriptHosts[fixtureCurrentSession().host || ''], 'endpoint');
        if (change === 'endpoint') host.base += '/changed';
        else Object.assign(host, { token: 'changed-token' });
      }
      fixtureElement(window.transcriptReplies[1], 'deep request').resolve(new Response(JSON.stringify({
        messages: [{ index: 0, role: 'user', content: 'stale deep result' }], firstIndex: 0, lastIndex: 0, totalMessages: 11,
      })));
      await flight;
      return { stale: !!document.querySelector('#messages [data-msg-index="0"]'), oldest: window.ownedTranscript.oldestIndex, last: window.ownedTranscript.lastIndex };
    }, { change, id: ROOT, peer: fleet.peer.hostId });
    expect(result).toEqual({ stale: false, oldest: 10, last: 10 });
  });
}

export {};
