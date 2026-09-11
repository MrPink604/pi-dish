const { test, expect, ROOT } = require('./fixtures');

test('a delayed spawn acceptance retains its submitted refine draft and leaves a newer takeover visible', async ({ page, fleet }) => {
  let post, status;
  await page.route(`${fleet.self.base}/api/sessions/new`, route => { post = route; });
  await page.route(`${fleet.self.base}/api/session-spawns/old-operation`, route => { status = route; });
  await page.evaluate(() => { openNewSessionView({ cwd: '/old', draft: 'original refine draft' }); window.oldSpawn = spawnNewSession(); });
  await expect.poll(() => !!post).toBe(true);
  await page.evaluate(() => openNewSessionView({ cwd: '/new', draft: 'replacement refine draft' }));
  await post.fulfill({ json: { spawnId: 'old-operation' } });
  await page.evaluate(() => window.oldSpawn);
  await expect(page.locator('.main')).toHaveClass(/new-session-open/);
  await expect(page.locator('#newSessionCwd')).toHaveValue('/new');
  await expect(page.locator('#nsSpawnBtn')).toBeEnabled();
  expect(await page.evaluate(() => newSessionController.pendingDraft)).toBe('replacement refine draft');
  const key = await page.evaluate(() => pendingSessionSpawns.entries()[0][0]);
  expect(await page.evaluate(key => localStorage.getItem(draftKey(pendingComposerKey(key))), key)).toBe('original refine draft');
  await expect.poll(() => !!status).toBe(true);
  await status.fulfill({ json: { status: 'ready', sessionId: ROOT } });
  await expect.poll(() => page.evaluate(() => pendingSessionSpawns.entries().length)).toBe(0);
  await expect(page.locator('.main')).toHaveClass(/new-session-open/);
  expect(await page.evaluate(({ host, id }) => localStorage.getItem(draftKey(sessionKey(host, id))), { host: fleet.self.hostId, id: ROOT })).toBe('original refine draft');
});

test('an old failed kickoff cannot report an error or enable a newer pending spawn button', async ({ page, fleet }) => {
  const posts = [];
  await page.route(`${fleet.self.base}/api/sessions/new`, route => { posts.push(route); });
  await page.evaluate(() => { openNewSessionView({ cwd: '/old' }); window.oldSpawn = spawnNewSession(); });
  await expect.poll(() => posts.length).toBe(1);
  await page.evaluate(() => { openNewSessionView({ cwd: '/new' }); window.newSpawn = spawnNewSession(); });
  await expect.poll(() => posts.length).toBe(2);
  await posts[0].fulfill({ status: 500, json: { error: 'old request failed' } });
  await page.evaluate(() => window.oldSpawn);
  await expect(page.locator('#nsSpawnBtn')).toBeDisabled();
  await expect(page.locator('#nsError')).toHaveText('');
  await posts[1].fulfill({ status: 500, json: { error: 'current request failed' } });
  await page.evaluate(() => window.newSpawn);
  await expect(page.locator('#nsSpawnBtn')).toBeEnabled();
  await expect(page.locator('#nsError')).toHaveText('current request failed');
});

test('same operation ids on two hosts keep separate provisional composers and select only the viewed host', async ({ page, fleet }) => {
  const statuses = new Map();
  await page.route('**/api/sessions/new', route => route.fulfill({ json: { spawnId: 'same-operation' } }));
  await page.route('**/api/session-spawns/same-operation', route => { statuses.set(new URL(route.request().url()).origin, route); });
  await page.evaluate(host => submitNewSession({ cwd: '/self', host, draft: 'self draft' }), fleet.self.hostId);
  const selfKey = await page.evaluate(() => sessionView.spawnId);
  await page.evaluate(host => submitNewSession({ cwd: '/peer', host, draft: 'peer draft' }), fleet.peer.hostId);
  const peerKey = await page.evaluate(() => sessionView.spawnId);
  expect(selfKey).not.toBe(peerKey);
  await expect(page.locator('#promptInput')).toHaveValue('peer draft');
  await expect(page.locator('.session-item.starting')).toHaveCount(2);
  await expect.poll(() => statuses.size).toBe(2);
  await statuses.get(fleet.self.base).fulfill({ json: { status: 'ready', sessionId: ROOT } });
  await expect(page.locator('.session-item.starting')).toHaveCount(1);
  expect(await page.evaluate(() => sessionView.spawnId)).toBe(peerKey);
  await statuses.get(fleet.peer.base).fulfill({ json: { status: 'ready', sessionId: ROOT } });
  await expect(page.locator('.session-item.starting')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionState.currentSession?.host)).toBe(fleet.peer.hostId);
  // Fixture rows are historical; their composer stays hidden after readiness.
  expect(await page.evaluate(({ host, id }) => localStorage.getItem(draftKey(sessionKey(host, id))), { host: fleet.peer.hostId, id: ROOT })).toBe('peer draft');
  expect(await page.evaluate(({ host, id }) => localStorage.getItem(draftKey(sessionKey(host, id))), { host: fleet.self.hostId, id: ROOT })).toBe('self draft');
});

test('workspace spawning keeps its original host when lazy harness discovery outlives a host change', async ({ page, fleet }) => {
  let harness, post;
  await page.evaluate(() => localStorage.setItem('pi-dish-new-harness', 'pi'));
  await page.route(`${fleet.self.base}/api/harnesses`, route => { harness = route; });
  await page.route('**/api/sessions/new', route => { post = route; return route.fulfill({ status: 500, json: { error: 'fixture stops spawn' } }); });
  await page.evaluate(({ host }) => { window.workspaceSpawn = createSession('/old-workspace', host); }, { host: fleet.self.hostId });
  await expect.poll(() => !!harness).toBe(true);
  await page.evaluate(host => onNsHostChange(host), fleet.peer.hostId);
  await harness.fulfill({ json: { harnesses: [{ id: 'pi', available: true }, { id: 'omp', available: true }] } });
  await page.evaluate(() => window.workspaceSpawn);
  await expect.poll(() => !!post).toBe(true);
  expect(new URL(post.request().url()).origin).toBe(fleet.self.base);
  expect(post.request().postDataJSON()).toMatchObject({ cwd: '/old-workspace', harness: 'pi', async: true });
  expect(post.request().postDataJSON().target).toBeUndefined();
});
