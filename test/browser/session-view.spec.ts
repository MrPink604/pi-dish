import type { Route } from '@playwright/test';
import { test, expect, ROOT, requiredRoute } from './fixtures.js';
test('late resume-model options cannot replace the picker for a newly selected host', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    window.fixtureSessionListPatch(fixtureCurrentSession().id, { harnessId: 'omp' });
    const original = fixtureApp.features.apiTransport.request; fixtureApp.features.apiTransport.request = (host, path, init) => path.startsWith('/api/models') ? new Promise(resolve => { window.finishResumeModels = resolve; }) : original(host, path, init);
    window.oldResumeModels = fixtureApp.features.sessionResume.load(fixtureCurrentSession());
  });
  await fleet.select(fleet.peer);
  await page.evaluate(() => { window.finishResumeModels(new Response(JSON.stringify([{ provider: 'fixture', id: 'old' }]))); return window.oldResumeModels; });
  await expect(page.locator('#resumeModelWrap')).toBeHidden();
  await expect(page.locator('#resumeModelSelect')).not.toContainText('fixture/old');
});
test('resume serializes a captured target and cannot navigate the replacement selection', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    window.resumeCalls = []; window.resumeNavigations = []; window.resumeStatuses = [];
    window.ownedResume = PiDishBrowser.createSessionResume({ document, sessionState: fixtureApp.features.sessionState, endpoint: () => ({ base: 'http://captured' }), target: () => ({ type: 'tmux', socket: 'fixture', tmuxSession: 'captured' }),
      request: (...args) => new Promise(resolve => window.resumeCalls.push({ args, resolve })), refresh: async () => {}, select: (...args) => window.resumeNavigations.push(args), status: (...args) => window.resumeStatuses.push(args) });
    window.resumeFirst = window.ownedResume.resume(); void window.ownedResume.resume();
  });
  expect(await page.evaluate(() => window.resumeCalls.length)).toBe(1);
  expect(await page.evaluate(() => {
    const call = fixtureElement(window.resumeCalls[0], 'resume call');
    const body = call.args[2]?.body;
    if (typeof body !== 'string') throw new Error('Resume call lacks JSON body');
    return JSON.parse(body);
  })).toEqual({ target: { type: 'tmux', socket: 'fixture', tmuxSession: 'captured' } });
  await fleet.select(fleet.peer);
  await page.evaluate(id => { fixtureElement(window.resumeCalls[0], 'resume call').resolve(new Response(JSON.stringify({ id }))); return window.resumeFirst; }, ROOT);
  expect(await page.evaluate(() => window.resumeNavigations)).toEqual([]);
  expect(await page.evaluate(() => window.resumeStatuses.length)).toBe(1);
});
test('resume disposal retires late response effects and changed endpoints retire picker data', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    window.fixtureSessionListPatch(fixtureCurrentSession().id, { harnessId: 'omp' });
    window.resumeEndpoint = { base: 'http://original' }; window.resumeResponses = []; window.resumeEffects = [];
    window.ownedResume = PiDishBrowser.createSessionResume({ document, sessionState: fixtureApp.features.sessionState, endpoint: () => window.resumeEndpoint, target: () => null,
      request: (...args) => new Promise(resolve => window.resumeResponses.push({ args, resolve })), refresh: async () => window.resumeEffects.push('refresh'), select: () => window.resumeEffects.push('select'), status() {} });
    window.oldPicker = window.ownedResume.load(fixtureCurrentSession()); window.resumeEndpoint = { base: 'http://new' }; fixtureElement(window.resumeResponses[0], 'resume response').resolve(new Response(JSON.stringify([{ provider: 'fixture', id: 'old' }])));
  });
  await page.evaluate(() => window.oldPicker);
  await expect(page.locator('#resumeModelSelect')).not.toContainText('fixture/old');
  await page.evaluate(id => { window.disposedResume = window.ownedResume.resume(); window.ownedResume.dispose(); fixtureElement(window.resumeResponses[1], 'disposed resume response').resolve(new Response(JSON.stringify({ id }))); return window.disposedResume; }, ROOT);
  expect(await page.evaluate(() => window.resumeEffects)).toEqual([]);
});
test('list ingress omits malformed presentation fields before header rendering and escapes names', async ({ page, fleet }) => {
  await page.route(`${fleet.self.base}/api/sessions?**`, route => route.fulfill({ json: {
    active: [], previous: [{ id: ROOT, name: '<img src=x>', model: null, cwd: {}, contextPercent: {}, contextTokens: 'not numeric', turnInProgress: 1 }],
  } }));
  await page.evaluate(() => fixtureApp.features.sidebarLists.load(undefined, { withPrevious: true }));
  // Inspect the list before transcript metadata legitimately refreshes the header.
  expect(await page.evaluate(({ id, host }) => {
    const row = fixtureElement(fixtureApp.features.sessionState.findSession(id, host), 'session row');
    return { cwd: row.cwd, contextPercent: row.contextPercent, contextTokens: row.contextTokens, turnInProgress: row.turnInProgress };
  }, { id: ROOT, host: fleet.self.hostId })).toEqual({ cwd: undefined, contextPercent: undefined, contextTokens: undefined, turnInProgress: undefined });
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/messages?**`, route => route.fulfill({ json: { messages: [], session: {} } }));
  await fleet.select(fleet.self);
  await expect(page.locator('#sessionName')).toHaveText('<img src=x>');
  await expect(page.locator('#sessionName img')).toHaveCount(0);
  await expect(page.locator('#sessionContext')).toHaveText('0%');
});
test('composer cache countdown aligns with context and becomes a cold-cache glyph after expiry', async ({ page, fleet }) => {
  await page.evaluate(({ id, host }) => window.fixtureSessionListPatch(id, { isActive: true }, host),
    { id: ROOT, host: fleet.self.hostId });
  await fleet.select(fleet.self);
  await page.evaluate(() => window.fixtureSessionListPatch(fixtureCurrentSession().id, { cacheExpiry: {
    refreshedAt: Date.now(), expiresAt: Date.now() + 4 * 60_000, retentionMs: 5 * 60_000,
    retention: '5m', basis: 'fixed', identity: 'fixture',
  } }));
  await expect(page.locator('#sessionCache')).toBeVisible();
  await expect(page.locator('#sessionCache')).toHaveText(/^~4m$/);
  await expect(page.locator('#sessionCache')).toHaveClass(/\bwarning\b/);
  const centers = await page.locator('#sessionCache, #sessionContext').evaluateAll(elements =>
    elements.map(element => { const box = element.getBoundingClientRect(); return box.top + box.height / 2; }));
  expect(Math.abs(centers[0] - centers[1])).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.fixtureSessionListPatch(fixtureCurrentSession().id, { cacheExpiry: {
    refreshedAt: Date.now() - 6 * 60_000, expiresAt: Date.now() - 60_000, retentionMs: 5 * 60_000,
    retention: '5m', basis: 'fixed', identity: 'fixture',
  } }));
  await expect(page.locator('#sessionCache')).toHaveText('❄');
  await expect(page.locator('#sessionCache')).toHaveClass(/\bcold\b/);
  await expect(page.locator('#sessionCache')).toHaveAttribute('aria-label', /Cache likely cold/);
});
test('restored same-host tool panels retain their node and duration after a new selection generation', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    fixtureApp.features.liveToolsController.append({ toolCallId: 'cached-tool', toolName: 'Bash', startedAt: Date.now() - 1000 });
    window.cachedTool = document.querySelector<HTMLDetailsElement>('[data-tool-call-id="cached-tool"]'); const tool = fixtureElement(window.cachedTool, 'cached tool'); tool.open = true;
    tool.remove(); fixtureApp.features.liveToolsController.clear(fixtureElement(document.getElementById('messages'), '#messages'));
    fixtureApp.features.sessionState.advanceSelection(); fixtureElement(document.getElementById('messages'), '#messages').append(tool);
    fixtureApp.features.liveToolsController.update({ toolCallId: 'cached-tool', partialResult: { content: [{ type: 'text', text: 'restored output' }] } });
  });
  await expect(page.locator('[data-tool-call-id="cached-tool"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector('[data-tool-call-id="cached-tool"]') === window.cachedTool)).toBe(true);
  await page.evaluate(() => fixtureApp.features.liveToolsController.finish({ toolCallId: 'cached-tool', result: { content: [{ type: 'text', text: 'done' }] } }));
  await expect(page.locator('[data-tool-call-id="cached-tool"]')).toHaveCount(1);
  await expect(page.locator('[data-tool-call-id="cached-tool"] .duration')).toContainText(/./);
});

test.describe('selection retirement', () => {
  test.use({ liveSessions: true });

  test('unknown real and provisional targets preserve the selected view and its live ownership', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await expect.poll(() => page.evaluate(() => fixtureApp.features.messageStreamController.source?.readyState)).toBe(1);
    await page.locator('#promptInput').fill('Keep this composer');
    await page.evaluate(async () => {
      fixtureApp.features.sessionSearch.open();
      await fixtureApp.features.sessionSearch.run('self');
    });
    await expect(page.locator('mark.search-mark')).toHaveText('self');
    const result = await page.evaluate(async ({ id, host }) => {
      const { sessionState, sessionView, messageStreamController } = fixtureApp.features;
      const owner = fixtureElement(sessionState.captureSelection(), 'selection owner'), source = messageStreamController.source;
      const node = document.querySelector('#messages [data-msg-index]');
      await sessionView.select('missing-session', { host });
      await sessionView.select(id, { host: 'missing-host' });
      sessionView.pending('missing-spawn');
      return {
        owned: sessionState.ownsSelection(owner),
        sameStream: messageStreamController.source === source,
        sameNode: document.querySelector('#messages [data-msg-index]') === node,
        host: fixtureElement(sessionState.currentSession, 'current session').host,
      };
    }, { id: ROOT, host: fleet.self.hostId });
    expect(result).toEqual({ owned: true, sameStream: true, sameNode: true, host: fleet.self.hostId });
    await expect(page.locator('#promptInput')).toHaveValue('Keep this composer');
    await expect(page.locator('#searchBar')).toBeVisible();
    await expect(page.locator('mark.search-mark')).toHaveText('self');
  });

  test('provisional retirement stashes clean transcript nodes and drafts without clearing the old session activity', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await expect.poll(() => page.evaluate(() => fixtureApp.features.messageStreamController.source?.readyState)).toBe(1);
    await page.locator('#promptInput').fill('Original real draft');
    await page.evaluate(async () => {
      fixtureApp.features.sessionSearch.open();
      await fixtureApp.features.sessionSearch.run('self');
      window.retainedSelectionMessage = document.querySelector<HTMLElement>('#messages [data-msg-index]');
    });
    await expect(page.locator('mark.search-mark')).toHaveText('self');
    let status: Route | null | undefined;
    await page.route(`${fleet.self.base}/api/sessions/new`, route => route.fulfill({ json: { spawnId: 'retirement-operation' } }));
    await page.route(`${fleet.self.base}/api/session-spawns/retirement-operation`, route => { status = route; });
    // Register a real provisional operation without navigating yet. The
    // retirement snapshot below is synchronous: a later catalog refresh may
    // legitimately replace the old session's observed activity.
    const spawnId = await page.evaluate(host => fixtureApp.features.newSessionController.submit({
      cwd: '/fixture/project', host, ownsView: () => false,
    }), fleet.self.hostId);
    await expect.poll(() => !!status).toBe(true);
    expect(await page.evaluate(({ id, host, spawnId }) => {
      const { sessionState, sessionView, sessionActivity, messageStreamController } = fixtureApp.features;
      sessionActivity.setCompacting(true);
      sessionActivity.setTurn(true);
      sessionView.pending(spawnId);
      const old = fixtureElement(sessionState.findSession(id, host), 'retired session');
      const retained = fixtureElement(window.retainedSelectionMessage, 'retained selection message');
      return {
        selected: sessionState.currentSession,
        stream: messageStreamController.source,
        turn: sessionActivity.turn,
        compacting: sessionActivity.compacting,
        oldTurn: old.turnInProgress,
        oldCompacting: old.compacting,
        retainedMarks: retained.querySelectorAll('mark.search-mark').length,
        retainedCurrent: retained.classList.contains('search-current'),
      };
    }, { id: ROOT, host: fleet.self.hostId, spawnId })).toEqual({
      selected: null, stream: null, turn: false, compacting: false,
      oldTurn: true, oldCompacting: true, retainedMarks: 0, retainedCurrent: false,
    });
    await page.locator('#promptInput').fill('Separate provisional draft');
    await fleet.select(fleet.self);
    await expect(page.locator('#promptInput')).toHaveValue('Original real draft');
    expect(await page.evaluate(() => document.querySelector('#messages [data-msg-index]') === window.retainedSelectionMessage)).toBe(true);
    await expect(page.locator('mark.search-mark')).toHaveCount(0);
    await page.evaluate(id => fixtureApp.features.sessionView.pending(id), spawnId);
    await expect(page.locator('#promptInput')).toHaveValue('Separate provisional draft');
    await expect(page.locator('#btnSend')).toBeDisabled();
    await requiredRoute(status).fulfill({ json: { status: 'error', error: 'Fixture ends pending operation' } });
    await expect(page.locator('#sessionName')).toHaveText('Session failed to start');
  });
});

export {};
