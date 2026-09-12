const { test, expect, ROOT, CHILD } = require('./fixtures');
test('startup restoration cannot replace a selection made while initial lists are loading', async ({ page, fleet }) => {
  await page.evaluate(({ host, id }) => localStorage.setItem('pi-dish-session', `${host} ${id}`), { host: fleet.self.hostId, id: ROOT });
  let receive;
  const received = new Promise(resolve => { receive = resolve; }); let held = false;
  await page.route(`${fleet.self.base}/api/sessions?*`, route => {
    if (held) return route.continue(); held = true; receive(route);
  });
  await page.goto(fleet.self.base, { waitUntil: 'domcontentloaded' });
  const route = await received;
  await page.evaluate(async ({ root, child, host }) => {
    const mount = sidebarLists.mount; sidebarLists.mount = () => { window.startupMounted = true; mount(); };
    sessionState.setSessionLists({ previous: [{ id: root, name: 'saved' }, { id: child, name: 'selected' }] }, host);
    await selectSession(child, { host });
  }, { root: ROOT, child: CHILD, host: fleet.self.hostId });
  await route.fulfill({ json: { active: [], previous: [{ id: ROOT, name: 'saved' }, { id: CHILD, name: 'selected' }] } });
  await page.waitForFunction(() => window.startupMounted);
  expect(await page.evaluate(() => sessionState.currentSession.id)).toBe(CHILD);
});
test('old mobile-panel outside-click handlers cannot close a reopened panel', async ({ page, fleet }) => {
  await page.evaluate(() => {
    appChrome.dispose(); window.chromeClicks = [];
    const add = document.addEventListener.bind(document);
    document.addEventListener = (type, callback, options) => { if (type === 'click') window.chromeClicks.push(callback); return add(type, callback, options); };
    window.ownedChrome = PiDishBrowser.createAppChrome({ document, storage: localStorage, older() {} }); window.ownedChrome.openPanel();
  });
  await page.waitForFunction(() => window.chromeClicks.length === 1);
  await page.evaluate(() => { window.ownedChrome.closePanel(); window.ownedChrome.openPanel(); });
  await page.waitForFunction(() => window.chromeClicks.length === 2);
  await page.evaluate(() => { const event = new MouseEvent('click'); Object.defineProperty(event, 'target', { value: document.body }); window.chromeClicks[0](event); });
  await expect(page.locator('#controlPanel')).toHaveClass(/open/);
  await page.locator('#sidebar h1').click();
  await expect(page.locator('#controlPanel')).not.toHaveClass(/open/);
});
test('chrome mounts once and disposal retires gesture and focus controls', async ({ page, fleet }) => {
  await page.evaluate(() => {
    appChrome.dispose(); window.chromeOlder = 0; window.ownedChrome = PiDishBrowser.createAppChrome({ document, storage: localStorage, older: () => window.chromeOlder++ });
    window.ownedChrome.mount(); window.ownedChrome.mount(); window.ownedChrome.follow();
    document.getElementById('messages').dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
  });
  expect(await page.evaluate(() => ({ older: window.chromeOlder, follow: window.ownedChrome.following }))).toEqual({ older: 1, follow: false });
  await page.evaluate(() => { window.ownedChrome.setFocus(true); window.ownedChrome.dispose(); window.ownedChrome.setFocus(false); document.getElementById('messages').dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })); });
  expect(await page.evaluate(() => window.chromeOlder)).toBe(1);
  await expect(page.locator('#messages')).toHaveClass(/focus-mode/);
});

test('static bindings retire detached controls and disposal removes listeners', async ({ page, fleet }) => {
  await page.evaluate(() => {
    appBindings.dispose(); window.appActionCalls = [];
    const actions = Object.fromEntries(PiDishBrowser.APP_ACTION_NAMES.map(name => [name, () => window.appActionCalls.push(name)]));
    window.ownedBindings = PiDishBrowser.createAppBindings({ document, actions });
    const button = document.querySelector('[data-app-click="openUsageView"]'); button.remove(); button.click();
    document.querySelector('[data-app-click="openSkillsView"]').click(); window.ownedBindings.dispose();
    document.querySelector('[data-app-click="openSettingsModal"]').click();
  });
  expect(await page.evaluate(() => window.appActionCalls)).toEqual(['openSkillsView']);
});
