import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, ROOT, CHILD, heldRoute } from './fixtures.js';
test('startup restoration cannot replace a selection made while initial lists are loading', async ({ page, fleet }) => {
  await page.evaluate(({ host, id }) => localStorage.setItem('pi-dish-session', `${host} ${id}`), { host: fleet.self.hostId, id: ROOT });
  const startup = heldRoute(); let held = false;
  await page.route(`${fleet.self.base}/api/sessions?*`, route => {
    if (held) return route.continue(); held = true;
    startup.hold(route);
  });
  await page.goto(fleet.self.base, { waitUntil: 'domcontentloaded' });
  const route = await startup.received;
  await page.evaluate(async ({ root, child, host }) => {
    fixtureApp.features.sessionState.setSessionLists({ previous: [{ id: root, name: 'saved' }, { id: child, name: 'selected' }] }, host);
    await fixtureApp.features.sessionView.select(child, { host });
  }, { root: ROOT, child: CHILD, host: fleet.self.hostId });
  await route.fulfill({ json: { active: [{ id: ROOT, name: 'released startup result' }], previous: [] } });
  await expect(fleet.row(fleet.self)).toContainText('released startup result');
  await expect(page.locator('#messages')).toContainText('self child transcript');
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

test.describe('backgrounded-tab revival', () => {
  test.use({ liveSessions: true });

  test('a short app switch keeps a healthy stream; a stale OPEN stream is replaced', async ({ page, fleet }) => {
    // Exercise the hub's real streaming proxy, not just a peer-looking URL.
    writeFileSync(join(fleet.self.home, '.pi/dish/settings.json'), JSON.stringify({
      remotes: [{ name: 'peer', url: fleet.peer.base, token: fleet.peer.token }],
    }));
    await page.reload();
    await expect.poll(() => page.evaluate(id => fixtureApp.features.hostDirectory.resolveHost(id).base, fleet.peer.hostId)).toBe('/hosts/peer');
    await expect(fleet.row(fleet.peer)).toBeVisible();
    await fleet.select(fleet.peer);
    await expect.poll(() => page.evaluate(() => fixtureApp.features.messageStreamController.source?.readyState)).toBe(1);
    await page.evaluate(() => { window.firstStream = fixtureApp.features.messageStreamController.source; });
    // No socket error is necessary for an idle OPEN stream to go stale.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await page.evaluate(() => fixtureApp.features.messageStreamController.source === window.firstStream)).toBe(true);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await page.evaluate(() => fixtureApp.features.messageStreamController.source === window.firstStream)).toBe(true);
    // A heartbeat is traffic even when the transcript has been idle for minutes.
    const later = Date.now() + 120_000;
    await page.clock.setFixedTime(new Date(later));
    await page.evaluate(() => {
      window.firstStream!.dispatchEvent(new MessageEvent('keepalive', { data: '{}' }));
      window.dispatchEvent(new Event('online'));
    });
    expect(await page.evaluate(() => fixtureApp.features.messageStreamController.source === window.firstStream)).toBe(true);
    await page.clock.setFixedTime(new Date(later + 120_000));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => page.evaluate(() => {
      const source = fixtureApp.features.messageStreamController.source;
      return source && source !== window.firstStream && source.readyState === source.OPEN ? source.url : '';
    })).toContain(`/hosts/peer/api/sessions/${ROOT}/stream`);
    fleet.peer.emit('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'live through the hub' }] } });
    await expect(page.locator('#messages')).toContainText('live through the hub');
  });
});

test.describe('startup failure recovery', () => {
  test.use({ instrumentApp: false });

  test('an uncaught startup error shows a reload control that boots the real app', async ({ page, fleet }) => {
    let failStartup = true;
    await page.route(url => url.pathname === '/app.js', route => failStartup
      ? route.fulfill({ contentType: 'application/javascript', body: "throw new Error('injected startup failure');" })
      : route.fallback());
    await page.reload();

    const failure = page.getByRole('alertdialog', { name: 'pi-dish failed to start' });
    await expect(failure).toBeVisible();

    failStartup = false;
    const reloaded = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await reloaded;
    await expect(failure).toHaveCount(0);
    await page.locator('#tabAll').click();
    await expect(fleet.row(fleet.self)).toHaveCount(1);
    await expect(fleet.row(fleet.peer)).toHaveCount(1);
  });

  test('a bundle that never loads reports failure, and a late bundle still boots', async ({ page, fleet }) => {
    let serveBundle = false;
    await page.route(url => url.pathname === '/app.js', route => serveBundle ? route.fallback() : route.abort('failed'));
    await page.reload();

    const failure = page.getByRole('alertdialog', { name: 'pi-dish failed to start' });
    await expect(failure).toBeVisible();

    serveBundle = true;
    await page.evaluate(() => {
      const source = document.querySelector<HTMLScriptElement>('script[src*="app.js"]')?.getAttribute('src') || 'app.js';
      const script = document.createElement('script');
      script.src = `${source}${source.includes('?') ? '&' : '?'}late=1`;
      document.head.append(script);
    });
    await expect(failure).toHaveCount(0);
    await page.locator('#tabAll').click();
    await expect(fleet.row(fleet.self)).toBeVisible();
  });
});

export {};
