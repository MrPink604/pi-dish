// Generated test/tool from test/browser/app-shell.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('startup restoration cannot replace a selection made while initial lists are loading', async ({ page, fleet }) => {
    await page.evaluate(({ host, id }) => localStorage.setItem('pi-dish-session', `${host} ${id}`), { host: fleet.self.hostId, id: fixtures_js_1.ROOT });
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    let held = false;
    await page.route(`${fleet.self.base}/api/sessions?*`, route => {
        if (held)
            return route.continue();
        held = true;
        if (!receive)
            throw new Error('Startup route resolver not initialized');
        receive(route);
    });
    await page.goto(fleet.self.base, { waitUntil: 'domcontentloaded' });
    const route = await received;
    await page.evaluate(async ({ root, child, host }) => {
        const mount = fixtureApp.features.sidebarLists.mount;
        fixtureApp.features.sidebarLists.mount = () => { window.startupMounted = true; mount(); };
        fixtureApp.features.sessionState.setSessionLists({ previous: [{ id: root, name: 'saved' }, { id: child, name: 'selected' }] }, host);
        await fixtureApp.features.sessionView.select(child, { host });
    }, { root: fixtures_js_1.ROOT, child: fixtures_js_1.CHILD, host: fleet.self.hostId });
    await route.fulfill({ json: { active: [], previous: [{ id: fixtures_js_1.ROOT, name: 'saved' }, { id: fixtures_js_1.CHILD, name: 'selected' }] } });
    await page.waitForFunction(() => window.startupMounted);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureCurrentSession().id)).toBe(fixtures_js_1.CHILD);
});
(0, fixtures_js_1.test)('old mobile-panel outside-click handlers cannot close a reopened panel', async ({ page, fleet }) => {
    await page.evaluate(() => {
        fixtureApp.features.appChrome.dispose();
        window.chromeClicks = [];
        const add = document.addEventListener.bind(document);
        Object.defineProperty(document, 'addEventListener', { configurable: true, value(type, callback, options) {
                if (type === 'click')
                    window.chromeClicks.push(callback);
                return add(type, callback, options);
            } });
        window.ownedChrome = PiDishBrowser.createAppChrome({ document, storage: localStorage, older() { } });
        window.ownedChrome.openPanel();
    });
    await page.waitForFunction(() => window.chromeClicks.length === 1);
    await page.evaluate(() => { window.ownedChrome.closePanel(); window.ownedChrome.openPanel(); });
    await page.waitForFunction(() => window.chromeClicks.length === 2);
    await page.evaluate(() => {
        const event = new MouseEvent('click');
        Object.defineProperty(event, 'target', { value: document.body });
        const callback = fixtureElement(window.chromeClicks[0], 'old chrome click');
        if (typeof callback === 'function')
            callback(event);
        else
            callback.handleEvent(event);
    });
    await (0, fixtures_js_1.expect)(page.locator('#controlPanel')).toHaveClass(/open/);
    await page.locator('#sidebar h1').click();
    await (0, fixtures_js_1.expect)(page.locator('#controlPanel')).not.toHaveClass(/open/);
});
(0, fixtures_js_1.test)('chrome mounts once and disposal retires gesture and focus controls', async ({ page, fleet }) => {
    await page.evaluate(() => {
        fixtureApp.features.appChrome.dispose();
        window.chromeOlder = 0;
        window.ownedChrome = PiDishBrowser.createAppChrome({ document, storage: localStorage, older: () => window.chromeOlder++ });
        window.ownedChrome.mount();
        window.ownedChrome.mount();
        window.ownedChrome.follow();
        fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => ({ older: window.chromeOlder, follow: window.ownedChrome.following }))).toEqual({ older: 1, follow: false });
    await page.evaluate(() => { window.ownedChrome.setFocus(true); window.ownedChrome.dispose(); window.ownedChrome.setFocus(false); fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })); });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.chromeOlder)).toBe(1);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toHaveClass(/focus-mode/);
});
(0, fixtures_js_1.test)('static bindings retire detached controls and disposal removes listeners', async ({ page, fleet }) => {
    await page.evaluate(() => {
        fixtureApp.features.appBindings.dispose();
        window.appActionCalls = [];
        const actions = new Proxy(fixtureApp.ports.appBindings.actions, { get(target, property, receiver) {
                const name = typeof property === 'string' ? PiDishBrowser.APP_ACTION_NAMES.find(candidate => candidate === property) : undefined;
                if (name)
                    return () => { window.appActionCalls.push(name); };
                return Reflect.get(target, property, receiver);
            } });
        window.ownedBindings = PiDishBrowser.createAppBindings({ document, actions });
        const button = fixtureElement(document.querySelector('[data-app-click="openUsageView"]'), 'open usage button');
        button.remove();
        button.click();
        fixtureElement(document.querySelector('[data-app-click="openSkillsView"]'), 'open skills button').click();
        window.ownedBindings.dispose();
        fixtureElement(document.querySelector('[data-app-click="openSettingsModal"]'), 'open settings button').click();
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.appActionCalls)).toEqual(['openSkillsView']);
});
