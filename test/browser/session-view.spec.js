const { test, expect, ROOT } = require('./fixtures');
test('late resume-model options cannot replace the picker for a newly selected host', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    window.fixtureSessionListPatch(sessionState.currentSession.id, { harnessId: 'omp' });
    const original = apiFetch; apiFetch = (host, path, init) => path.startsWith('/api/models') ? new Promise(resolve => { window.finishResumeModels = resolve; }) : original(host, path, init);
    window.oldResumeModels = loadResumeModelOptions(sessionState.currentSession);
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
    window.ownedResume = PiDishBrowser.createSessionResume({ document, sessionState, endpoint: () => ({ base: 'http://captured' }), target: () => ({ type: 'tmux', socket: 'fixture', tmuxSession: 'captured' }),
      request: (...args) => new Promise(resolve => window.resumeCalls.push({ args, resolve })), refresh: async () => {}, select: (...args) => window.resumeNavigations.push(args), status: (...args) => window.resumeStatuses.push(args) });
    window.resumeFirst = window.ownedResume.resume(); void window.ownedResume.resume();
  });
  expect(await page.evaluate(() => window.resumeCalls.length)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(window.resumeCalls[0].args[2].body))).toEqual({ target: { type: 'tmux', socket: 'fixture', tmuxSession: 'captured' } });
  await fleet.select(fleet.peer);
  await page.evaluate(id => { window.resumeCalls[0].resolve(new Response(JSON.stringify({ id }))); return window.resumeFirst; }, ROOT);
  expect(await page.evaluate(() => window.resumeNavigations)).toEqual([]);
  expect(await page.evaluate(() => window.resumeStatuses.length)).toBe(1);
});
test('resume disposal retires late response effects and changed endpoints retire picker data', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    window.fixtureSessionListPatch(sessionState.currentSession.id, { harnessId: 'omp' });
    window.resumeEndpoint = { base: 'http://original' }; window.resumeResponses = []; window.resumeEffects = [];
    window.ownedResume = PiDishBrowser.createSessionResume({ document, sessionState, endpoint: () => window.resumeEndpoint, target: () => null,
      request: (...args) => new Promise(resolve => window.resumeResponses.push({ args, resolve })), refresh: async () => window.resumeEffects.push('refresh'), select: () => window.resumeEffects.push('select'), status() {} });
    window.oldPicker = window.ownedResume.load(sessionState.currentSession); window.resumeEndpoint = { base: 'http://new' }; window.resumeResponses[0].resolve(new Response(JSON.stringify([{ provider: 'fixture', id: 'old' }])));
  });
  await page.evaluate(() => window.oldPicker);
  await expect(page.locator('#resumeModelSelect')).not.toContainText('fixture/old');
  await page.evaluate(id => { window.disposedResume = window.ownedResume.resume(); window.ownedResume.dispose(); window.resumeResponses[1].resolve(new Response(JSON.stringify({ id }))); return window.disposedResume; }, ROOT);
  expect(await page.evaluate(() => window.resumeEffects)).toEqual([]);
});
test('list ingress omits malformed presentation fields before header rendering and escapes names', async ({ page, fleet }) => {
  await page.route(`${fleet.self.base}/api/sessions?**`, route => route.fulfill({ json: {
    active: [], previous: [{ id: ROOT, name: '<img src=x>', model: null, cwd: {}, contextPercent: {}, contextTokens: 'not numeric', turnInProgress: 1 }],
  } }));
  await page.evaluate(() => loadSessions(undefined, { withPrevious: true }));
  // Inspect the list before transcript metadata legitimately refreshes the header.
  expect(await page.evaluate(({ id, host }) => {
    const row = sessionState.findSession(id, host);
    return { cwd: row.cwd, contextPercent: row.contextPercent, contextTokens: row.contextTokens, turnInProgress: row.turnInProgress };
  }, { id: ROOT, host: fleet.self.hostId })).toEqual({ cwd: undefined, contextPercent: undefined, contextTokens: undefined, turnInProgress: undefined });
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/messages?**`, route => route.fulfill({ json: { messages: [], session: {} } }));
  await fleet.select(fleet.self);
  await expect(page.locator('#sessionName')).toHaveText('<img src=x>');
  await expect(page.locator('#sessionName img')).toHaveCount(0);
  await expect(page.locator('#sessionContext')).toHaveText('0%');
});
test('restored same-host tool panels retain their node and duration after a new selection generation', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    appendLiveToolPanel({ toolCallId: 'cached-tool', toolName: 'Bash', startedAt: Date.now() - 1000 });
    window.cachedTool = document.querySelector('[data-tool-call-id="cached-tool"]'); window.cachedTool.open = true;
    window.cachedTool.remove(); liveToolsController.clear(document.getElementById('messages'));
    sessionState.advanceSelection(); document.getElementById('messages').append(window.cachedTool);
    updateLiveToolPanel({ toolCallId: 'cached-tool', partialResult: { content: [{ type: 'text', text: 'restored output' }] } });
  });
  await expect(page.locator('[data-tool-call-id="cached-tool"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector('[data-tool-call-id="cached-tool"]') === window.cachedTool)).toBe(true);
  await page.evaluate(() => finalizeLiveToolPanel({ toolCallId: 'cached-tool', result: { content: [{ type: 'text', text: 'done' }] } }));
  await expect(page.locator('[data-tool-call-id="cached-tool"]')).toHaveCount(1);
  await expect(page.locator('[data-tool-call-id="cached-tool"] .duration')).toContainText(/./);
});
