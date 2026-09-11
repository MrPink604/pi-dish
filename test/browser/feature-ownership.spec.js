const { test, expect, ROOT, CHILD } = require('./fixtures');

test('row close still reports completion when no session is selected', async ({ page, fleet }) => {
  expect(await page.evaluate(() => sessionState.captureSelection())).toBeNull();
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/close`, route => route.fulfill({ json: { success: true } }));
  await page.evaluate(({ id, host }) => performRowClose(id, host), { id: ROOT, host: fleet.self.hostId });
  expect(await page.locator('#status').textContent()).toBe('Session closed');
});

test('a delayed resume does not reselect the same-id session on another host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/resume`, route => receive(route));
  await page.evaluate(() => { window.pendingResume = resumeSession(); });
  const route = await received;
  await fleet.select(fleet.self);
  const before = await page.evaluate(() => sessionState.captureSelection());
  await route.fulfill({ json: { id: ROOT } });
  await page.evaluate(() => window.pendingResume);
  expect(await page.evaluate(() => sessionState.captureSelection())).toEqual(before);
  await expect(page.locator('#messages')).toContainText('self root transcript');
});

test('a late missing-share response cannot prompt or publish after changing hosts', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  const posts = [];
  let dialogs = 0;
  page.on('dialog', async dialog => { dialogs += 1; await dialog.accept(); });
  for (const host of [fleet.self, fleet.peer]) {
    await page.route(`${host.base}/api/sessions/${ROOT}/share`, route => {
      if (route.request().method() === 'POST') {
        posts.push(host.hostId);
        return route.fulfill({ json: { url: `${host.base}/fixture-share` } });
      }
      if (host === fleet.peer) return receive(route);
      return route.continue();
    });
  }
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.dataset.entryId = 'fixture-message';
    window.pendingShareCopy = copyMessageShareLink(button);
  });
  const route = await received;
  await fleet.select(fleet.self);
  await route.fulfill({ status: 404, json: { error: 'No share' } });
  await page.evaluate(() => window.pendingShareCopy);
  expect(dialogs).toBe(0);
  expect(posts).toEqual([]);
  await expect(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
});

test('a delayed search cannot replace the query on a same-id peer', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/search?q=peer-query`, route => receive(route));
  await page.evaluate(() => {
    openSearch();
    window.pendingSessionSearch = runSessionSearch('peer-query');
  });
  const route = await received;
  await fleet.select(fleet.self);
  await page.evaluate(async () => { openSearch(); await runSessionSearch('self-query'); });
  await route.fulfill({ json: { matches: [] } });
  await page.evaluate(() => window.pendingSessionSearch);
  expect(await page.evaluate(() => search.query)).toBe('self-query');
});

test('closing and reopening search preserves its single paging jump within a selection', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(async () => {
    const fetch = apiFetch; let started, release, calls = 0;
    const loading = new Promise(resolve => { started = resolve; });
    apiFetch = (host, path, init) => {
      if (path.includes('/search?')) return Promise.resolve(new Response(JSON.stringify({ matches: [{ index: 0, role: 'user' }] })));
      if (path.includes('/messages?limit=50&before=')) {
        calls++; started(); return new Promise(resolve => { release = () => resolve(new Response(JSON.stringify({ messages: [], hasMore: false }))); });
      }
      if (path.includes('/messages?limit=50')) return Promise.resolve(new Response(JSON.stringify({ messages: [{ role: 'user', index: 10, content: 'baseline' }], firstIndex: 10, lastIndex: 10, hasMore: true, totalMessages: 11 })));
      return fetch(host, path, init);
    };
    try {
      transcriptController.deleteCached(keyForSessionId(sessionState.currentSession.id)); await loadMessages();
      openSearch(); const first = runSessionSearch('first'); await loading;
      closeSearch(); openSearch(); const second = runSessionSearch('second'); await new Promise(resolve => setTimeout(resolve, 0));
      const beforeRelease = { calls, navigating: search.navigating }; release(); await Promise.all([first, second]);
      return { ...beforeRelease, settled: !search.navigating };
    } finally { apiFetch = fetch; closeSearch(); }
  });
  expect(result).toEqual({ calls: 1, navigating: true, settled: true });
});

test('a search-result list reload cannot hijack a newer selection', async ({ page, fleet }) => {
  await fleet.select(fleet.peer, CHILD);
  await page.evaluate(({ id, host }) => {
    openSearchView('');
    const keep = row => row.id !== id || row.host !== host;
    sessionState.setSessionLists({ active: sessionState.sessions.active.filter(keep), previous: sessionState.sessions.previous.filter(keep) });
    const load = loadSessions;
    loadSessions = (...args) => {
      loadSessions = load;
      return new Promise(resolve => { window.releaseSearchLoad = () => resolve(load(...args)); });
    };
    window.pendingSearchNavigation = openSearchResult(id, false, host);
  }, { id: ROOT, host: fleet.peer.hostId });
  await page.waitForFunction(() => typeof window.releaseSearchLoad === 'function');
  await fleet.select(fleet.self);
  await page.evaluate(async () => { window.releaseSearchLoad(); await window.pendingSearchNavigation; });
  await expect(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
  await expect(page.locator('#messages')).toContainText('self root transcript');
});

test('a delayed diff comment focus cannot reopen its editor on another host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  await page.route('**/api/sessions/*/diff', route => route.fulfill({ json: { root: '/fixture', gitAvailable: true, repos: [] } }));
  await page.evaluate(async id => {
    await openDiffView();
    document.getElementById('diffViewBody').innerHTML = '<details class="diff-file"><div class="diff-patch" data-repo="repo" data-path="file.txt"></div></details>';
    setAnchoredComments([{ id: 'fixture-comment', sessionId: id, body: 'peer comment',
      target: { kind: 'diff', repo: 'repo', path: 'file.txt', anchor: { quote: 'text' } } }]);
    const load = loadDeferredDiffPatch;
    loadDeferredDiffPatch = () => new Promise(resolve => {
      window.releaseCommentPatch = () => { loadDeferredDiffPatch = load; resolve(); };
    });
    window.pendingCommentFocus = focusAnchoredComment('fixture-comment');
  }, ROOT);
  await page.waitForFunction(() => typeof window.releaseCommentPatch === 'function');
  await fleet.select(fleet.self);
  await page.evaluate(async () => { window.releaseCommentPatch(); await window.pendingCommentFocus; });
  await expect(page.locator('#commentBubble')).toBeHidden();
  expect(await page.evaluate(() => anchoredCommentController.editing)).toBeNull();
});
