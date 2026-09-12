const { test, expect, ROOT, CHILD } = require('./fixtures');

test('row close still reports completion when no session is selected', async ({ page, fleet }) => {
  expect(await page.evaluate(() => fixtureApp.features.sessionState.captureSelection())).toBeNull();
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/close`, route => route.fulfill({ json: { success: true } }));
  await page.evaluate(({ id, host }) => fixtureApp.features.sidebarControls.performClose(id, host), { id: ROOT, host: fleet.self.hostId });
  expect(await page.locator('#status').textContent()).toBe('Session closed');
});

test('a delayed resume does not reselect the same-id session on another host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/resume`, route => receive(route));
  await page.evaluate(() => { window.pendingResume = fixtureApp.features.sessionResume.resume(); });
  const route = await received;
  await fleet.select(fleet.self);
  const before = await page.evaluate(() => fixtureApp.features.sessionState.captureSelection());
  await route.fulfill({ json: { id: ROOT } });
  await page.evaluate(() => window.pendingResume);
  expect(await page.evaluate(() => fixtureApp.features.sessionState.captureSelection())).toEqual(before);
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
    window.pendingShareCopy = fixtureApp.features.sessionInfo.copyMessage(button);
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
    fixtureApp.features.sessionSearch.open();
    window.pendingSessionSearch = fixtureApp.features.sessionSearch.run('peer-query');
  });
  const route = await received;
  await fleet.select(fleet.self);
  await page.evaluate(async () => { fixtureApp.features.sessionSearch.open(); await fixtureApp.features.sessionSearch.run('self-query'); });
  await route.fulfill({ json: { matches: [] } });
  await page.evaluate(() => window.pendingSessionSearch);
  expect(await page.evaluate(() => fixtureApp.features.sessionSearch.state.query)).toBe('self-query');
});

test('closing and reopening search preserves its single paging jump within a selection', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(async () => {
    const fetch = fixtureApp.features.apiTransport.request; let started, release, calls = 0;
    const loading = new Promise(resolve => { started = resolve; });
    fixtureApp.features.apiTransport.request = (host, path, init) => {
      if (path.includes('/search?')) return Promise.resolve(new Response(JSON.stringify({ matches: [{ index: 0, role: 'user' }] })));
      if (path.includes('/messages?limit=50&before=')) {
        calls++; started(); return new Promise(resolve => { release = () => resolve(new Response(JSON.stringify({ messages: [], hasMore: false }))); });
      }
      if (path.includes('/messages?limit=50')) return Promise.resolve(new Response(JSON.stringify({ messages: [{ role: 'user', index: 10, content: 'baseline' }], firstIndex: 10, lastIndex: 10, hasMore: true, totalMessages: 11 })));
      return fetch(host, path, init);
    };
    try {
      fixtureApp.features.transcriptController.deleteCached(fixtureApp.ports.composerDrafts.keyForSession(fixtureApp.features.sessionState.currentSession.id)); await fixtureApp.features.transcriptController.load();
      fixtureApp.features.sessionSearch.open(); const first = fixtureApp.features.sessionSearch.run('first'); await loading;
      fixtureApp.features.sessionSearch.close(); fixtureApp.features.sessionSearch.open(); const second = fixtureApp.features.sessionSearch.run('second'); await new Promise(resolve => setTimeout(resolve, 0));
      const beforeRelease = { calls, navigating: fixtureApp.features.sessionSearch.state.navigating }; release(); await Promise.all([first, second]);
      return { ...beforeRelease, settled: !fixtureApp.features.sessionSearch.state.navigating };
    } finally { fixtureApp.features.apiTransport.request = fetch; fixtureApp.features.sessionSearch.close(); }
  });
  expect(result).toEqual({ calls: 1, navigating: true, settled: true });
});

test('a search-result list reload cannot hijack a newer selection', async ({ page, fleet }) => {
  await fleet.select(fleet.peer, CHILD);
  await page.evaluate(({ id, host }) => {
    fixtureApp.features.searchViewController.open('');
    const keep = row => row.id !== id || row.host !== host;
    const { active, previous } = fixtureApp.features.sessionState.sessions;
    const hosts = [...new Set([...active, ...previous].map(row => row.host))];
    fixtureApp.features.sessionState.setSessionLists(hosts.map(hostId => ({ hostId,
      active: active.filter(row => row.host === hostId && keep(row)),
      previous: previous.filter(row => row.host === hostId && keep(row)),
    })));
    const load = fixtureApp.features.sidebarLists.load;
    fixtureApp.features.sidebarLists.load = (...args) => {
      fixtureApp.features.sidebarLists.load = load;
      return new Promise(resolve => { window.releaseSearchLoad = () => resolve(load(...args)); });
    };
    window.pendingSearchNavigation = fixtureApp.features.searchViewController.openResult(id, false, host);
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
    await fixtureApp.features.fileViews.openDiff();
    document.getElementById('diffViewBody').innerHTML = '<details class="diff-file"><div class="diff-patch" data-repo="repo" data-path="file.txt"></div></details>';
    fixtureApp.features.anchoredCommentController.set([{ id: 'fixture-comment', sessionId: id, body: 'peer comment',
      target: { kind: 'diff', repo: 'repo', path: 'file.txt', anchor: { quote: 'text' } } }]);
    const load = fixtureApp.features.fileViews.loadPatch;
    fixtureApp.features.fileViews.loadPatch = () => new Promise(resolve => {
      window.releaseCommentPatch = () => { fixtureApp.features.fileViews.loadPatch = load; resolve(); };
    });
    window.pendingCommentFocus = fixtureApp.features.anchoredCommentController.focus('fixture-comment');
  }, ROOT);
  await page.waitForFunction(() => typeof window.releaseCommentPatch === 'function');
  await fleet.select(fleet.self);
  await page.evaluate(async () => { window.releaseCommentPatch(); await window.pendingCommentFocus; });
  await expect(page.locator('#commentBubble')).toBeHidden();
  expect(await page.evaluate(() => fixtureApp.features.anchoredCommentController.editing)).toBeNull();
});
