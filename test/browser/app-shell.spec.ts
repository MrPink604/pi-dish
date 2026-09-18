import type { Route } from '@playwright/test';
import { test, expect, ROOT, CHILD } from './fixtures.js';
test('startup restoration cannot replace a selection made while initial lists are loading', async ({ page, fleet }) => {
  await page.evaluate(({ host, id }) => localStorage.setItem('pi-dish-session', `${host} ${id}`), { host: fleet.self.hostId, id: ROOT });
  let receive: ((route: Route) => void) | undefined;
  const received = new Promise<Route>(resolve => { receive = resolve; }); let held = false;
  await page.route(`${fleet.self.base}/api/sessions?*`, route => {
    if (held) return route.continue(); held = true;
    if (!receive) throw new Error('Startup route resolver not initialized');
    receive(route);
  });
  await page.goto(fleet.self.base, { waitUntil: 'domcontentloaded' });
  const route = await received;
  await page.evaluate(async ({ root, child, host }) => {
    const mount = fixtureApp.features.sidebarLists.mount; fixtureApp.features.sidebarLists.mount = () => { window.startupMounted = true; mount(); };
    fixtureApp.features.sessionState.setSessionLists({ previous: [{ id: root, name: 'saved' }, { id: child, name: 'selected' }] }, host);
    await fixtureApp.features.sessionView.select(child, { host });
  }, { root: ROOT, child: CHILD, host: fleet.self.hostId });
  await route.fulfill({ json: { active: [], previous: [{ id: ROOT, name: 'saved' }, { id: CHILD, name: 'selected' }] } });
  await page.waitForFunction(() => window.startupMounted);
  expect(await page.evaluate(() => fixtureCurrentSession().id)).toBe(CHILD);
});
test('old mobile-panel outside-click handlers cannot close a reopened panel', async ({ page, fleet }) => {
  await page.evaluate(() => {
    fixtureApp.features.appChrome.dispose(); window.chromeClicks = [];
    const add = document.addEventListener.bind(document);
    Object.defineProperty(document, 'addEventListener', { configurable: true, value(type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      if (type === 'click') window.chromeClicks.push(callback);
      return add(type, callback, options);
    } });
    window.ownedChrome = PiDishBrowser.createAppChrome({ document, storage: localStorage, older() {} }); window.ownedChrome.openPanel();
  });
  await page.waitForFunction(() => window.chromeClicks.length === 1);
  await page.evaluate(() => { window.ownedChrome.closePanel(); window.ownedChrome.openPanel(); });
  await page.waitForFunction(() => window.chromeClicks.length === 2);
  await page.evaluate(() => {
    const event = new MouseEvent('click'); Object.defineProperty(event, 'target', { value: document.body });
    const callback = fixtureElement(window.chromeClicks[0], 'old chrome click');
    if (typeof callback === 'function') callback(event); else callback.handleEvent(event);
  });
  await expect(page.locator('#controlPanel')).toHaveClass(/open/);
  await page.locator('#sidebar h1').click();
  await expect(page.locator('#controlPanel')).not.toHaveClass(/open/);
});
test('chrome mounts once and disposal retires gesture and focus controls', async ({ page, fleet }) => {
  await page.evaluate(() => {
    fixtureApp.features.appChrome.dispose(); window.chromeOlder = 0; window.ownedChrome = PiDishBrowser.createAppChrome({ document, storage: localStorage, older: () => window.chromeOlder++ });
    window.ownedChrome.mount(); window.ownedChrome.mount(); window.ownedChrome.follow();
    fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
  });
  expect(await page.evaluate(() => ({ older: window.chromeOlder, follow: window.ownedChrome.following }))).toEqual({ older: 1, follow: false });
  await page.evaluate(() => { window.ownedChrome.setFocus(true); window.ownedChrome.dispose(); window.ownedChrome.setFocus(false); fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })); });
  expect(await page.evaluate(() => window.chromeOlder)).toBe(1);
  await expect(page.locator('#messages')).toHaveClass(/focus-mode/);
});

test('static bindings retire detached controls and disposal removes listeners', async ({ page, fleet }) => {
  await page.evaluate(() => {
    fixtureApp.features.appBindings.dispose(); window.appActionCalls = [];
    const actions = new Proxy(fixtureApp.ports.appBindings.actions, { get(target, property, receiver) {
      const name = typeof property === 'string' ? PiDishBrowser.APP_ACTION_NAMES.find(candidate => candidate === property) : undefined;
      if (name) return () => { window.appActionCalls.push(name); };
      return Reflect.get(target, property, receiver);
    } });
    window.ownedBindings = PiDishBrowser.createAppBindings({ document, actions });
    const button = fixtureElement(document.querySelector<HTMLElement>('[data-app-click="openUsageView"]'), 'open usage button'); button.remove(); button.click();
    fixtureElement(document.querySelector<HTMLElement>('[data-app-click="openSkillsView"]'), 'open skills button').click(); window.ownedBindings.dispose();
    fixtureElement(document.querySelector<HTMLElement>('[data-app-click="openSettingsModal"]'), 'open settings button').click();
  });
  expect(await page.evaluate(() => window.appActionCalls)).toEqual(['openSkillsView']);
});

export {};
