const { test, expect } = require('./fixtures');
async function setup(page) {
  await page.evaluate(() => {
    sidebarQuery.dispose(); sidebarLists.dispose();
    window.queryLog = { loads: [], invalidations: 0, busy: [], render: 0, search: 0, alerts: [] };
    window.queryStore = new Map(); window.queryReplies = []; window.queryEndpoint = { base: 'http://self', token: 'current' };
    window.customQuery = PiDishBrowser.createSidebarQuery({ document,
      storage: { getItem: key => window.queryStore.get(key) || null, setItem: (key, value) => window.queryStore.set(key, value) },
      request: (host, path, init) => new Promise(resolve => window.queryReplies.push({ host, path, init, resolve })), host: () => window.queryEndpoint,
      render: () => window.queryLog.render++, reload: async query => { window.queryLog.loads.push(query || ''); }, queriedFor: () => '',
      invalidateLists: () => window.queryLog.invalidations++, busy: value => window.queryLog.busy.push(value),
      searchChanged: () => window.queryLog.search++, openSearch() {}, prompt: () => 'Saved', alert: text => window.queryLog.alerts.push(text),
    }); window.customQuery.mount();
  });
}
test('query typing invalidates old polls before debounce and switching tabs retires the pending timer', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.locator('#filterInput').fill('first');
  expect(await page.evaluate(() => window.queryLog.invalidations)).toBe(1);
  await page.locator('#filterInput').fill('second'); await page.locator('#tabAll').click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.queryLog.loads)).toEqual(['second']);
  expect(await page.evaluate(() => window.customQuery.tab)).toBe('all');
});
test('a late scope read cannot replace a newer saved definition', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.oldFilterRead = window.customQuery.loadFilters(); window.newFilterWrite = window.customQuery.persistFilters([{ name: 'New', query: '-old' }]); });
  await page.evaluate(() => window.queryReplies[1].resolve(new Response(JSON.stringify({ savedFilters: [{ name: 'New', query: '-old' }] }))));
  await page.evaluate(() => window.newFilterWrite);
  await page.evaluate(() => window.queryReplies[0].resolve(new Response(JSON.stringify({ savedFilters: [{ name: 'Old', query: 'old' }] }))));
  await page.evaluate(() => window.oldFilterRead);
  await expect(page.locator('#scopeChips')).toContainText('New'); await expect(page.locator('#scopeChips')).not.toContainText('Old');
});
test('saving a scope cancels its absorbed query and retired chips cannot toggle a replacement', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.locator('#filterInput').fill('needle');
  await page.evaluate(() => { window.saveScope = window.customQuery.saveCurrent(); });
  await page.evaluate(() => window.queryReplies[0].resolve(new Response(JSON.stringify({ savedFilters: [{ name: 'Saved', query: 'needle' }] }))));
  await page.evaluate(() => window.saveScope);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.queryLog.loads)).toEqual([]);
  await page.evaluate(() => { window.oldScopeButton = document.querySelector('#scopeChips .scope-chip'); window.customQuery.setFilters([{ name: 'Saved', query: 'replacement' }]); window.customQuery.renderChips(); window.oldScopeButton.click(); });
  expect(await page.evaluate(() => window.customQuery.scope())).toBe('replacement');
});
test('changed settings endpoint and disposal retire late results and input controls', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.oldScopeRead = window.customQuery.loadFilters(); window.queryEndpoint = { base: 'http://new' }; window.queryReplies[0].resolve(new Response(JSON.stringify({ savedFilters: [{ name: 'Wrong host', query: 'x' }] }))); });
  await page.evaluate(() => window.oldScopeRead);
  expect(await page.evaluate(() => window.customQuery.filters)).toEqual([]);
  await page.locator('#filterInput').fill('pending');
  await page.evaluate(() => { window.customQuery.dispose(); window.queryLog.loads = []; });
  await page.locator('#filterInput').fill('after-dispose'); await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.queryLog.loads)).toEqual([]);
});
test('retired query polls cannot mark a host blocked during the next debounce window', async ({ page, fleet }) => {
  await setup(page, fleet);
  const result = await page.evaluate(async () => {
    const state = PiDishBrowser.createSessionState({ getSelfHostId: () => 'self', getHostLabel: id => id, onListsChanged() {}, onCurrentChanged() {} });
    const store = { getItem: () => null, setItem() {} }, activity = PiDishBrowser.createSidebarActivity({ document, storage: store, sessionState: state });
    const events = [], hosts = [{ hostId: 'self', base: '', self: true }]; let finish;
    const lists = PiDishBrowser.createSidebarLists({ document, sessionState: state, activity, hosts: () => hosts, pollable: () => hosts, selfId: () => 'self', query: () => 'new', all: () => true,
      refreshFleet() {}, connection: (_host, event) => events.push(event), request: () => new Promise(resolve => { finish = resolve; }) });
    const pending = lists.load('old'); lists.invalidate(); finish(new Response('{}', { status: 401 })); await pending;
    const result = { events, queried: lists.queriedFor, active: state.sessions.active }; lists.dispose(); return result;
  });
  expect(result).toEqual({ events: [], queried: '', active: [] });
});
test('list disposal retires indexing refreshes and late host data without clearing another owner', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(async () => {
    const state = PiDishBrowser.createSessionState({ getSelfHostId: () => 'self', getHostLabel: id => id, onListsChanged() {}, onCurrentChanged() {} });
    const activity = PiDishBrowser.createSidebarActivity({ document, storage: { getItem: () => null, setItem() {} }, sessionState: state });
    const hosts = [{ hostId: 'self', base: '', self: true }]; window.listCalls = 0; window.listRefreshes = 0;
    window.customLists = PiDishBrowser.createSidebarLists({ document, sessionState: state, activity, hosts: () => hosts, pollable: () => hosts, selfId: () => 'self', query: () => '', all: () => true,
      refreshFleet: () => window.listRefreshes++, connection() {}, request: async () => { window.listCalls++; return new Response(JSON.stringify({ active: [], previous: [], indexing: true })); } });
    await window.customLists.load(); window.customLists.mount(); window.customLists.dispose();
  });
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => ({ calls: window.listCalls, refreshes: window.listRefreshes }))).toEqual({ calls: 1, refreshes: 0 });
});
test('seen markers migrate and prune only within the owning host', async ({ page, fleet }) => {
  await setup(page, fleet);
  const result = await page.evaluate(() => {
    const storage = new Map([['pi-dish-seen', JSON.stringify({ bare: 'old', 'peer same': 'peer-at', bad: {} })]]);
    const state = PiDishBrowser.createSessionState({ getSelfHostId: () => 'self', getHostLabel: id => id, onListsChanged() {}, onCurrentChanged() {} });
    const activity = PiDishBrowser.createSidebarActivity({ document, storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, sessionState: state });
    activity.migrate('self'); activity.prune('self', []); activity.mark({ id: 'new', host: 'self' }, 'new-at');
    return JSON.parse(storage.get('pi-dish-seen'));
  });
  expect(result).toEqual({ 'peer same': 'peer-at', 'self new': 'new-at' });
});

test('sidebar magnifier opens the current filter through its owned click binding', async ({ page, fleet }) => {
  await page.locator('#filterInput').fill('button query');
  await page.locator('.filter-search-btn').click();
  expect(await page.evaluate(() => isSearchViewOpen())).toBe(true);
  expect(await page.locator('#searchViewInput').inputValue()).toBe('button query');
  await page.evaluate(() => closeSearchView());
  await page.locator('#filterInput').fill(''); await page.locator('.filter-search-btn').click();
  expect(await page.locator('#searchViewInput').inputValue()).toBe('button query');
});
