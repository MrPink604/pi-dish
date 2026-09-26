import type { Route } from '@playwright/test';
import { isRecord } from '../../lib/wire-protocol.js';
import { test, expect, ROOT, requiredRoute } from './fixtures.js';

test('a delayed spawn acceptance retains its submitted refine draft and leaves a newer takeover visible', async ({ page, fleet }) => {
  let post: Route | undefined, status: Route | undefined;
  await page.route(`${fleet.self.base}/api/sessions/new`, route => { post = route; });
  await page.route(`${fleet.self.base}/api/session-spawns/old-operation`, route => { status = route; });
  await page.evaluate(() => { fixtureApp.features.newSessionController.open({ cwd: '/old', draft: 'original refine draft' }); window.oldSpawn = fixtureApp.features.newSessionController.spawn(); });
  await expect.poll(() => !!post).toBe(true);
  await page.evaluate(() => fixtureApp.features.newSessionController.open({ cwd: '/new', draft: 'replacement refine draft' }));
  await requiredRoute(post).fulfill({ json: { spawnId: 'old-operation' } });
  await page.evaluate(() => window.oldSpawn);
  await expect(page.locator('.main')).toHaveClass(/new-session-open/);
  await expect(page.locator('#newSessionCwd')).toHaveValue('/new');
  await expect(page.locator('#nsSpawnBtn')).toBeEnabled();
  expect(await page.evaluate(() => fixtureApp.features.newSessionController.pendingDraft)).toBe('replacement refine draft');
  const key = await page.evaluate(() => fixtureElement(fixtureApp.features.pendingSessionSpawns.entries()[0], 'pending spawn')[0]);
  expect(await page.evaluate(key => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey((id => 'spawn:' + id)(key))), key)).toBe('original refine draft');
  await expect.poll(() => !!status).toBe(true);
  await requiredRoute(status).fulfill({ json: { status: 'ready', sessionId: ROOT } });
  await expect.poll(() => page.evaluate(() => fixtureApp.features.pendingSessionSpawns.entries().length)).toBe(0);
  await expect(page.locator('.main')).toHaveClass(/new-session-open/);
  expect(await page.evaluate(({ host, id }) => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(sessionKey(host, id))), { host: fleet.self.hostId, id: ROOT })).toBe('original refine draft');
});

test('an old failed kickoff cannot report an error or enable a newer pending spawn button', async ({ page, fleet }) => {
  const posts: Route[] = [];
  await page.route(`${fleet.self.base}/api/sessions/new`, route => { posts.push(route); });
  await page.evaluate(() => { fixtureApp.features.newSessionController.open({ cwd: '/old' }); window.oldSpawn = fixtureApp.features.newSessionController.spawn(); });
  await expect.poll(() => posts.length).toBe(1);
  await page.evaluate(() => { fixtureApp.features.newSessionController.open({ cwd: '/new' }); window.newSpawn = fixtureApp.features.newSessionController.spawn(); });
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
  const statuses = new Map<string, Route>();
  await page.route('**/api/sessions/new', route => route.fulfill({ json: { spawnId: 'same-operation' } }));
  await page.route('**/api/session-spawns/same-operation', route => { statuses.set(new URL(route.request().url()).origin, route); });
  await page.evaluate(host => fixtureApp.features.newSessionController.submit({ cwd: '/self', host, draft: 'self draft' }), fleet.self.hostId);
  const selfKey = await page.evaluate(() => fixtureApp.features.sessionView.spawnId);
  await page.evaluate(host => fixtureApp.features.newSessionController.submit({ cwd: '/peer', host, draft: 'peer draft' }), fleet.peer.hostId);
  const peerKey = await page.evaluate(() => fixtureApp.features.sessionView.spawnId);
  expect(selfKey).not.toBe(peerKey);
  await expect(page.locator('#promptInput')).toHaveValue('peer draft');
  await expect(page.locator('.session-item.starting')).toHaveCount(2);
  await expect.poll(() => statuses.size).toBe(2);
  await requiredRoute(statuses.get(fleet.self.base)).fulfill({ json: { status: 'ready', sessionId: ROOT } });
  await expect(page.locator('.session-item.starting')).toHaveCount(1);
  expect(await page.evaluate(() => fixtureApp.features.sessionView.spawnId)).toBe(peerKey);
  await requiredRoute(statuses.get(fleet.peer.base)).fulfill({ json: { status: 'ready', sessionId: ROOT } });
  await expect(page.locator('.session-item.starting')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => fixtureApp.features.sessionState.currentSession?.host)).toBe(fleet.peer.hostId);
  // Fixture rows are historical; their composer stays hidden after readiness.
  expect(await page.evaluate(({ host, id }) => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(sessionKey(host, id))), { host: fleet.peer.hostId, id: ROOT })).toBe('peer draft');
  expect(await page.evaluate(({ host, id }) => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(sessionKey(host, id))), { host: fleet.self.hostId, id: ROOT })).toBe('self draft');
});

test('workspace spawning keeps its original host when lazy harness discovery outlives a host change', async ({ page, fleet }) => {
  let harness: Route | undefined, post: Route | undefined;
  await page.evaluate(() => localStorage.setItem('pi-dish-new-harness', 'pi'));
  await page.route(`${fleet.self.base}/api/harnesses`, route => { harness = route; });
  await page.route('**/api/sessions/new', route => { post = route; return route.fulfill({ status: 500, json: { error: 'fixture stops spawn' } }); });
  await page.evaluate(({ host }) => { window.workspaceSpawn = fixtureApp.features.newSessionController.create('/old-workspace', host); }, { host: fleet.self.hostId });
  await expect.poll(() => !!harness).toBe(true);
  await page.evaluate(host => fixtureApp.features.newSessionController.changeHost(host), fleet.peer.hostId);
  await requiredRoute(harness).fulfill({ json: { harnesses: [{ id: 'pi', available: true }, { id: 'omp', available: true }] } });
  await page.evaluate(() => window.workspaceSpawn);
  await expect.poll(() => !!post).toBe(true);
  const spawnRoute = requiredRoute(post);
  expect(new URL(spawnRoute.request().url()).origin).toBe(fleet.self.base);
  const payload: unknown = spawnRoute.request().postDataJSON();
  if (!isRecord(payload)) throw new Error('Invalid workspace spawn payload');
  expect(payload).toMatchObject({ cwd: '/old-workspace', harness: 'pi', async: true });
  expect(payload.target).toBeUndefined();
});

test('a ready spawn settles on its own host while another host list request never answers', async ({ page, fleet }) => {
  let status: Route | undefined;
  await page.route('**/api/sessions/new', route => route.fulfill({ json: { spawnId: 'slow-peer-operation' } }));
  await page.route('**/api/session-spawns/slow-peer-operation', route => { status = route; });
  await page.evaluate(host => fixtureApp.features.newSessionController.submit({ cwd: '/self', host, draft: 'slow peer draft' }), fleet.self.hostId);
  await expect.poll(() => !!status).toBe(true);
  // A fleet whose peer never answers must not hold the pane: the spawning
  // host's row is already known, so readiness may only need that host.
  // Held open, never fulfilled: the peer host is unreachable for this window.
  await page.route(`${fleet.peer.base}/api/sessions*`, () => {});
  await requiredRoute(status).fulfill({ json: { status: 'ready', sessionId: ROOT } });
  await expect.poll(() => page.evaluate(() => fixtureApp.features.sessionView.spawnId)).toBeNull();
  expect(await page.evaluate(() => fixtureApp.features.pendingSessionSpawns.entries().length)).toBe(0);
  expect(await page.evaluate(() => fixtureApp.features.sessionState.currentSession?.id)).toBe(ROOT);
  expect(await page.evaluate(() => fixtureApp.features.sessionState.currentSession?.host)).toBe(fleet.self.hostId);
  await expect(page.locator('.session-item.starting')).toHaveCount(0);
});

export {};
