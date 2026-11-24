// Generated test/tool from test/browser/app-shell.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('startup restoration cannot replace a selection made while initial lists are loading', async ({ page, fleet }) => {
    await page.evaluate(({ host, id }) => localStorage.setItem('pi-dish-session', `${host} ${id}`), { host: fleet.self.hostId, id: fixtures_js_1.ROOT });
    const startup = (0, fixtures_js_1.heldRoute)();
    let held = false;
    await page.route(`${fleet.self.base}/api/sessions?*`, route => {
        if (held)
            return route.continue();
        held = true;
        startup.hold(route);
    });
    await page.goto(fleet.self.base, { waitUntil: 'domcontentloaded' });
    const route = await startup.received;
    await page.evaluate(async ({ root, child, host }) => {
        fixtureApp.features.sessionState.setSessionLists({ previous: [{ id: root, name: 'saved' }, { id: child, name: 'selected' }] }, host);
        await fixtureApp.features.sessionView.select(child, { host });
    }, { root: fixtures_js_1.ROOT, child: fixtures_js_1.CHILD, host: fleet.self.hostId });
    await route.fulfill({ json: { active: [{ id: fixtures_js_1.ROOT, name: 'released startup result' }], previous: [] } });
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toContainText('released startup result');
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self child transcript');
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
fixtures_js_1.test.describe('backgrounded-tab revival', () => {
    fixtures_js_1.test.use({ liveSessions: true });
    (0, fixtures_js_1.test)('a short app switch keeps a healthy stream; a stale OPEN stream is replaced', async ({ page, fleet }) => {
        // Exercise the hub's real streaming proxy, not just a peer-looking URL.
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(fleet.self.home, '.pi/dish/settings.json'), JSON.stringify({
            remotes: [{ name: 'peer', url: fleet.peer.base, token: fleet.peer.token }],
        }));
        await page.reload();
        await fixtures_js_1.expect.poll(() => page.evaluate(id => fixtureApp.features.hostDirectory.resolveHost(id).base, fleet.peer.hostId)).toBe('/hosts/peer');
        await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toBeVisible();
        await fleet.select(fleet.peer);
        await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureApp.features.messageStreamController.source?.readyState)).toBe(1);
        await page.evaluate(() => { window.firstStream = fixtureApp.features.messageStreamController.source; });
        // No socket error is necessary for an idle OPEN stream to go stale.
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.messageStreamController.source === window.firstStream)).toBe(true);
        await page.evaluate(() => {
            Reflect.deleteProperty(document, 'hidden');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.messageStreamController.source === window.firstStream)).toBe(true);
        // A heartbeat is traffic even when the transcript has been idle for minutes.
        const later = Date.now() + 120_000;
        await page.clock.setFixedTime(new Date(later));
        await page.evaluate(() => {
            window.firstStream.dispatchEvent(new MessageEvent('keepalive', { data: '{}' }));
            window.dispatchEvent(new Event('online'));
        });
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.messageStreamController.source === window.firstStream)).toBe(true);
        await page.clock.setFixedTime(new Date(later + 120_000));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await fixtures_js_1.expect.poll(() => page.evaluate(() => {
            const source = fixtureApp.features.messageStreamController.source;
            return source && source !== window.firstStream && source.readyState === source.OPEN ? source.url : '';
        })).toContain(`/hosts/peer/api/sessions/${fixtures_js_1.ROOT}/stream`);
        fleet.peer.emit('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'live through the hub' }] } });
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('live through the hub');
    });
});
fixtures_js_1.test.describe('startup failure recovery', () => {
    fixtures_js_1.test.use({ instrumentApp: false });
    (0, fixtures_js_1.test)('an uncaught startup error shows a reload control that boots the real app', async ({ page, fleet }) => {
        let failStartup = true;
        await page.route(url => url.pathname === '/app.js', route => failStartup
            ? route.fulfill({ contentType: 'application/javascript', body: "throw new Error('injected startup failure');" })
            : route.fallback());
        await page.reload();
        const failure = page.getByRole('alertdialog', { name: 'pi-dish failed to start' });
        await (0, fixtures_js_1.expect)(failure).toBeVisible();
        failStartup = false;
        const reloaded = page.waitForEvent('load');
        await page.getByRole('button', { name: 'Reload', exact: true }).click();
        await reloaded;
        await (0, fixtures_js_1.expect)(failure).toHaveCount(0);
        await page.locator('#tabAll').click();
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toHaveCount(1);
        await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toHaveCount(1);
    });
    (0, fixtures_js_1.test)('a bundle that never loads reports failure, and a late bundle still boots', async ({ page, fleet }) => {
        let serveBundle = false;
        await page.route(url => url.pathname === '/app.js', route => serveBundle ? route.fallback() : route.abort('failed'));
        await page.reload();
        const failure = page.getByRole('alertdialog', { name: 'pi-dish failed to start' });
        await (0, fixtures_js_1.expect)(failure).toBeVisible();
        serveBundle = true;
        await page.evaluate(() => {
            const source = document.querySelector('script[src*="app.js"]')?.getAttribute('src') || 'app.js';
            const script = document.createElement('script');
            script.src = `${source}${source.includes('?') ? '&' : '?'}late=1`;
            document.head.append(script);
        });
        await (0, fixtures_js_1.expect)(failure).toHaveCount(0);
        await page.locator('#tabAll').click();
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toBeVisible();
    });
    (0, fixtures_js_1.test)('ignores ResizeObserver warnings, extension errors, and post-start unhandled rejections during boot', async ({ page, fleet }) => {
        let releaseHost;
        const hostPending = new Promise(resolve => { releaseHost = resolve; });
        let blockedOnce = false;
        await page.route(`${fleet.self.base}/api/host`, async (route) => {
            if (!blockedOnce) {
                blockedOnce = true;
                await hostPending;
            }
            await route.fallback();
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        // Wait until app.js has started (dispatched pi-dish-boot-started) while /api/host is still pending.
        await page.waitForFunction(() => !!document.querySelector('script[src*="app.js"]'));
        await page.evaluate(() => {
            window.dispatchEvent(new ErrorEvent('error', {
                message: 'ResizeObserver loop completed with undelivered notifications.',
                filename: `${window.location.origin}/app.js`,
            }));
            window.dispatchEvent(new ErrorEvent('error', {
                message: 'Extension injected script error',
                filename: 'chrome-extension://abcdefghijklmnop/content.js',
            }));
            window.dispatchEvent(new ErrorEvent('error', {
                message: 'Cross-origin widget error',
                filename: 'https://third-party.example/widget.js',
            }));
            // An empty-src script error must not throw inside the guard or trigger boot failure.
            const orphan = document.createElement('script');
            orphan.dispatchEvent(new Event('error'));
            // Unrelated promise rejection after STARTED_EVENT must not brick boot.
            window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
                promise: Promise.resolve(),
                reason: new Error('background extension rejection'),
            }));
        });
        const failure = page.getByRole('alertdialog', { name: 'pi-dish failed to start' });
        await (0, fixtures_js_1.expect)(failure).toHaveCount(0);
        releaseHost();
        await page.locator('#tabAll').click();
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toBeVisible();
        await (0, fixtures_js_1.expect)(failure).toHaveCount(0);
    });
});
