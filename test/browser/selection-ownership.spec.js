const { test, expect, ROOT, CHILD } = require('./fixtures');

test('related-session navigation stays on its host when both target ids collide', async ({ page, fleet }) => {
  await fleet.select(fleet.peer, CHILD);
  const parent = page.locator('#sessionRelations .session-relation-chip').filter({ hasText: 'Parent' });
  await expect(parent).toBeVisible();
  await parent.click();
  await expect(fleet.row(fleet.peer, ROOT)).toHaveClass(/\bactive\b/);
  await expect(page.locator('#messages')).toContainText('peer root transcript');
  await expect(fleet.row(fleet.self, ROOT)).not.toHaveClass(/\bactive\b/);
});

test.describe('live selection ownership', () => {
  test.use({ liveSessions: true });

  test('stale transcript and stream entrypoints leave the current host and connection untouched', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    await page.evaluate(() => { window.staleSelection = sessionState.captureSelection(); });
    await fleet.select(fleet.self);
    await expect.poll(() => page.evaluate(() => messageStream?.readyState)).toBe(1);
    const result = await page.evaluate(async () => {
      const stream = messageStream;
      const before = document.getElementById('messages').innerHTML;
      const fetch = apiFetch;
      let requests = 0;
      apiFetch = (...args) => { requests += 1; return fetch(...args); };
      try {
        await loadMessages(window.staleSelection);
        await fetchNewMessagesSince(window.staleSelection);
        await loadSessionRelations(window.staleSelection);
        startMessageStream(window.staleSelection);
        return { unchanged: before === document.getElementById('messages').innerHTML,
          sameStream: stream === messageStream, host: sessionState.currentSession.host, requests };
      } finally { apiFetch = fetch; }
    });
    expect(result).toEqual({ unchanged: true, sameStream: true, host: fleet.self.hostId, requests: 0 });
  });

  test('a delayed stream ticket cannot replace a newer host connection', async ({ page, fleet }) => {
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await page.evaluate(() => {
      const mint = mintHostTicket;
      mintHostTicket = (host, purpose) => {
        const pending = mint(host, purpose);
        if (purpose === 'stream') window.pendingStreamTicket = pending;
        return pending;
      };
    });
    await page.route(`${fleet.peer.base}/api/auth/ticket`, route => receive(route));
    await fleet.select(fleet.peer);
    const ticket = await received;
    await fleet.select(fleet.self);
    await expect.poll(() => page.evaluate(() => messageStream?.readyState)).toBe(1);
    const before = await page.evaluate(() => messageStream.url);
    await ticket.fulfill({ json: { ticket: 'superseded-fixture-ticket' } });
    await page.evaluate(() => window.pendingStreamTicket);
    expect(await page.evaluate(() => messageStream.url)).toBe(before);
    expect(before).toContain(fleet.self.base);
    await expect(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
  });
});
