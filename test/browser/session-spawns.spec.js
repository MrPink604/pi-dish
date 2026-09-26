// Generated test/tool from test/browser/session-spawns.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('a delayed spawn acceptance retains its submitted refine draft and leaves a newer takeover visible', async ({ page, fleet }) => {
    let post, status;
    await page.route(`${fleet.self.base}/api/sessions/new`, route => { post = route; });
    await page.route(`${fleet.self.base}/api/session-spawns/old-operation`, route => { status = route; });
    await page.evaluate(() => { fixtureApp.features.newSessionController.open({ cwd: '/old', draft: 'original refine draft' }); window.oldSpawn = fixtureApp.features.newSessionController.spawn(); });
    await fixtures_js_1.expect.poll(() => !!post).toBe(true);
    await page.evaluate(() => fixtureApp.features.newSessionController.open({ cwd: '/new', draft: 'replacement refine draft' }));
    await (0, fixtures_js_1.requiredRoute)(post).fulfill({ json: { spawnId: 'old-operation' } });
    await page.evaluate(() => window.oldSpawn);
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/new-session-open/);
    await (0, fixtures_js_1.expect)(page.locator('#newSessionCwd')).toHaveValue('/new');
    await (0, fixtures_js_1.expect)(page.locator('#nsSpawnBtn')).toBeEnabled();
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.newSessionController.pendingDraft)).toBe('replacement refine draft');
    const key = await page.evaluate(() => fixtureElement(fixtureApp.features.pendingSessionSpawns.entries()[0], 'pending spawn')[0]);
    (0, fixtures_js_1.expect)(await page.evaluate(key => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey((id => 'spawn:' + id)(key))), key)).toBe('original refine draft');
    await fixtures_js_1.expect.poll(() => !!status).toBe(true);
    await (0, fixtures_js_1.requiredRoute)(status).fulfill({ json: { status: 'ready', sessionId: fixtures_js_1.ROOT } });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureApp.features.pendingSessionSpawns.entries().length)).toBe(0);
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/new-session-open/);
    (0, fixtures_js_1.expect)(await page.evaluate(({ host, id }) => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(sessionKey(host, id))), { host: fleet.self.hostId, id: fixtures_js_1.ROOT })).toBe('original refine draft');
});
(0, fixtures_js_1.test)('an old failed kickoff cannot report an error or enable a newer pending spawn button', async ({ page, fleet }) => {
    const posts = [];
    await page.route(`${fleet.self.base}/api/sessions/new`, route => { posts.push(route); });
    await page.evaluate(() => { fixtureApp.features.newSessionController.open({ cwd: '/old' }); window.oldSpawn = fixtureApp.features.newSessionController.spawn(); });
    await fixtures_js_1.expect.poll(() => posts.length).toBe(1);
    await page.evaluate(() => { fixtureApp.features.newSessionController.open({ cwd: '/new' }); window.newSpawn = fixtureApp.features.newSessionController.spawn(); });
    await fixtures_js_1.expect.poll(() => posts.length).toBe(2);
    await posts[0].fulfill({ status: 500, json: { error: 'old request failed' } });
    await page.evaluate(() => window.oldSpawn);
    await (0, fixtures_js_1.expect)(page.locator('#nsSpawnBtn')).toBeDisabled();
    await (0, fixtures_js_1.expect)(page.locator('#nsError')).toHaveText('');
    await posts[1].fulfill({ status: 500, json: { error: 'current request failed' } });
    await page.evaluate(() => window.newSpawn);
    await (0, fixtures_js_1.expect)(page.locator('#nsSpawnBtn')).toBeEnabled();
    await (0, fixtures_js_1.expect)(page.locator('#nsError')).toHaveText('current request failed');
});
(0, fixtures_js_1.test)('same operation ids on two hosts keep separate provisional composers and select only the viewed host', async ({ page, fleet }) => {
    const statuses = new Map();
    await page.route('**/api/sessions/new', route => route.fulfill({ json: { spawnId: 'same-operation' } }));
    await page.route('**/api/session-spawns/same-operation', route => { statuses.set(new URL(route.request().url()).origin, route); });
    await page.evaluate(host => fixtureApp.features.newSessionController.submit({ cwd: '/self', host, draft: 'self draft' }), fleet.self.hostId);
    const selfKey = await page.evaluate(() => fixtureApp.features.sessionView.spawnId);
    await page.evaluate(host => fixtureApp.features.newSessionController.submit({ cwd: '/peer', host, draft: 'peer draft' }), fleet.peer.hostId);
    const peerKey = await page.evaluate(() => fixtureApp.features.sessionView.spawnId);
    (0, fixtures_js_1.expect)(selfKey).not.toBe(peerKey);
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('peer draft');
    await (0, fixtures_js_1.expect)(page.locator('.session-item.starting')).toHaveCount(2);
    await fixtures_js_1.expect.poll(() => statuses.size).toBe(2);
    await (0, fixtures_js_1.requiredRoute)(statuses.get(fleet.self.base)).fulfill({ json: { status: 'ready', sessionId: fixtures_js_1.ROOT } });
    await (0, fixtures_js_1.expect)(page.locator('.session-item.starting')).toHaveCount(1);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionView.spawnId)).toBe(peerKey);
    await (0, fixtures_js_1.requiredRoute)(statuses.get(fleet.peer.base)).fulfill({ json: { status: 'ready', sessionId: fixtures_js_1.ROOT } });
    await (0, fixtures_js_1.expect)(page.locator('.session-item.starting')).toHaveCount(0);
    await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureApp.features.sessionState.currentSession?.host)).toBe(fleet.peer.hostId);
    // Fixture rows are historical; their composer stays hidden after readiness.
    (0, fixtures_js_1.expect)(await page.evaluate(({ host, id }) => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(sessionKey(host, id))), { host: fleet.peer.hostId, id: fixtures_js_1.ROOT })).toBe('peer draft');
    (0, fixtures_js_1.expect)(await page.evaluate(({ host, id }) => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(sessionKey(host, id))), { host: fleet.self.hostId, id: fixtures_js_1.ROOT })).toBe('self draft');
});
(0, fixtures_js_1.test)('workspace spawning keeps its original host when lazy harness discovery outlives a host change', async ({ page, fleet }) => {
    let harness, post;
    await page.evaluate(() => localStorage.setItem('pi-dish-new-harness', 'pi'));
    await page.route(`${fleet.self.base}/api/harnesses`, route => { harness = route; });
    await page.route('**/api/sessions/new', route => { post = route; return route.fulfill({ status: 500, json: { error: 'fixture stops spawn' } }); });
    await page.evaluate(({ host }) => { window.workspaceSpawn = fixtureApp.features.newSessionController.create('/old-workspace', host); }, { host: fleet.self.hostId });
    await fixtures_js_1.expect.poll(() => !!harness).toBe(true);
    await page.evaluate(host => fixtureApp.features.newSessionController.changeHost(host), fleet.peer.hostId);
    await (0, fixtures_js_1.requiredRoute)(harness).fulfill({ json: { harnesses: [{ id: 'pi', available: true }, { id: 'omp', available: true }] } });
    await page.evaluate(() => window.workspaceSpawn);
    await fixtures_js_1.expect.poll(() => !!post).toBe(true);
    const spawnRoute = (0, fixtures_js_1.requiredRoute)(post);
    (0, fixtures_js_1.expect)(new URL(spawnRoute.request().url()).origin).toBe(fleet.self.base);
    const payload = spawnRoute.request().postDataJSON();
    if (!(0, wire_protocol_js_1.isRecord)(payload))
        throw new Error('Invalid workspace spawn payload');
    (0, fixtures_js_1.expect)(payload).toMatchObject({ cwd: '/old-workspace', harness: 'pi', async: true });
    (0, fixtures_js_1.expect)(payload.target).toBeUndefined();
});
(0, fixtures_js_1.test)('a ready spawn settles on its own host while another host list request never answers', async ({ page, fleet }) => {
    let status;
    await page.route('**/api/sessions/new', route => route.fulfill({ json: { spawnId: 'slow-peer-operation' } }));
    await page.route('**/api/session-spawns/slow-peer-operation', route => { status = route; });
    await page.evaluate(host => fixtureApp.features.newSessionController.submit({ cwd: '/self', host, draft: 'slow peer draft' }), fleet.self.hostId);
    await fixtures_js_1.expect.poll(() => !!status).toBe(true);
    // A fleet whose peer never answers must not hold the pane: the spawning
    // host's row is already known, so readiness may only need that host.
    // Held open, never fulfilled: the peer host is unreachable for this window.
    await page.route(`${fleet.peer.base}/api/sessions*`, () => { });
    await (0, fixtures_js_1.requiredRoute)(status).fulfill({ json: { status: 'ready', sessionId: fixtures_js_1.ROOT } });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureApp.features.sessionView.spawnId)).toBeNull();
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.pendingSessionSpawns.entries().length)).toBe(0);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionState.currentSession?.id)).toBe(fixtures_js_1.ROOT);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionState.currentSession?.host)).toBe(fleet.self.hostId);
    await (0, fixtures_js_1.expect)(page.locator('.session-item.starting')).toHaveCount(0);
});
