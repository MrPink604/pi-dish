// Generated test/tool from test/browser/thinking-selector.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('thinking selector copies levels, carries owners and disposes without leaving active handlers', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const result = await page.evaluate(() => {
        const root = document.createElement('div');
        document.body.append(root);
        const owner = fixtureApp.features.sessionState.captureSelection();
        if (owner === null)
            throw new Error('Missing owner');
        const levels = ['off', 'high'];
        const unusual = "future'<b>level</b>";
        const calls = [];
        const actions = {
            selectLevel: (target, level) => calls.push(['select', target.host, level]),
            requestClose: (target) => calls.push(['close', target.host]),
        };
        const selector = PiDishBrowser.mountThinkingSelector(root, actions);
        const view = { owner, levels, currentLevel: unusual };
        selector.update(view);
        const labels = [...root.children].map(node => node.textContent);
        const active = fixtureElement(root.querySelector('.active'), 'active thinking option');
        const pressed = active.getAttribute('aria-pressed');
        const hasMarkup = !!root.querySelector('b, [onclick]');
        active.click();
        const oldButton = fixtureElement(root.querySelector(':scope > *'), 'old thinking button');
        selector.update({ ...view, owner: { ...owner, host: 'other-host' }, currentLevel: 'high' });
        oldButton.click(); // a detached option from the prior update is inert
        fixtureElement(root.querySelector('.active'), 'active thinking option').click();
        const nextLabels = [...root.children].map(node => node.textContent);
        selector.dispose();
        selector.dispose();
        selector.update(view);
        active.click();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const empty = root.childElementCount === 0;
        const again = PiDishBrowser.mountThinkingSelector(root, actions);
        again.update(view);
        fixtureElement(root.querySelector(':scope > *'), 'thinking option').click();
        again.dispose();
        root.remove();
        return { labels, nextLabels, levels, pressed, hasMarkup, empty, calls, host: owner.host, unusual };
    });
    (0, fixtures_js_1.expect)(result.labels).toEqual(['off', 'high', result.unusual]);
    (0, fixtures_js_1.expect)(result.nextLabels).toEqual(['off', 'high']);
    (0, fixtures_js_1.expect)(result.levels).toEqual(['off', 'high']);
    (0, fixtures_js_1.expect)(result.pressed).toBe('true');
    (0, fixtures_js_1.expect)(result.hasMarkup).toBe(false);
    (0, fixtures_js_1.expect)(result.empty).toBe(true);
    (0, fixtures_js_1.expect)(result.calls).toEqual([
        ['select', result.host, result.unusual], ['select', 'other-host', 'high'], ['select', result.host, 'off'],
    ]);
});
(0, fixtures_js_1.test)('thinking options support native Enter and Space activation and owned Escape', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => {
        const root = document.createElement('div');
        root.id = 'thinkingFixture';
        root.className = 'thinking-dropdown';
        root.style.top = '20px';
        root.style.left = '20px';
        document.body.append(root);
        window.thinkingFixtureCalls = [];
        window.thinkingFixture = PiDishBrowser.mountThinkingSelector(root, {
            selectLevel: (owner, level) => window.thinkingFixtureCalls.push(['select', owner.host, level]),
            requestClose: owner => window.thinkingFixtureCalls.push(['close', owner.host]),
        });
        window.thinkingFixture.update({ owner: fixtureElement(fixtureApp.features.sessionState.captureSelection(), 'thinking fixture owner'), levels: ['off', 'high'], currentLevel: 'high' });
    });
    const root = page.locator('#thinkingFixture');
    await root.getByRole('button', { name: 'high', exact: true }).press('Enter');
    await root.getByRole('button', { name: 'off', exact: true }).press('Space');
    await root.getByRole('button', { name: 'off', exact: true }).press('Escape');
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.thinkingFixtureCalls)).toEqual([
        ['select', fleet.self.hostId, 'high'], ['select', fleet.self.hostId, 'off'], ['close', fleet.self.hostId],
    ]);
    await page.evaluate(() => { window.thinkingFixture.dispose(); fixtureElement(document.getElementById('thinkingFixture'), "document.getElementById('thinkingFixture')").remove(); });
});
fixtures_js_1.test.describe('live thinking selector', () => {
    fixtures_js_1.test.use({ liveSessions: true });
    (0, fixtures_js_1.test)('an unusual current level is literal, uses the owning API and cannot leak into another session menu', async ({ page, fleet }) => {
        await fleet.select(fleet.self);
        const unusual = "future'<b>level</b>";
        await page.evaluate(level => window.fixtureSessionListPatch(fixtureCurrentSession().id, { thinkingLevel: level }), unusual);
        const requests = [];
        await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/thinking`, route => {
            const body = route.request().postDataJSON();
            if (!(0, wire_protocol_js_1.isRecord)(body))
                throw new Error('Invalid thinking request');
            requests.push(body);
            return route.fulfill({ json: { success: true, level: body.level } });
        });
        await page.click('#sessionThinking');
        const root = page.locator('#thinkingDropdown');
        await (0, fixtures_js_1.expect)(root.getByRole('button', { name: unusual, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await (0, fixtures_js_1.expect)(root.locator('b, [onclick]')).toHaveCount(0);
        await root.getByRole('button', { name: unusual, exact: true }).click();
        await fixtures_js_1.expect.poll(() => requests.length).toBe(1);
        (0, fixtures_js_1.expect)(requests).toEqual([{ level: unusual }]);
        await (0, fixtures_js_1.expect)(root).toBeHidden();
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionControls.thinkingSelector)).toBeNull();
        (0, fixtures_js_1.expect)(await page.evaluate(() => [...THINKING_LEVEL_NAMES])).not.toContain(unusual);
        await fleet.select(fleet.peer);
        await page.click('#sessionThinking');
        await (0, fixtures_js_1.expect)(root.getByRole('button', { name: unusual, exact: true })).toHaveCount(0);
        await root.getByRole('button').first().press('Escape');
        await (0, fixtures_js_1.expect)(root).toBeHidden();
        await (0, fixtures_js_1.expect)(root.locator('.thinking-option')).toHaveCount(0);
    });
    (0, fixtures_js_1.test)('the app drops a thinking action whose captured owner no longer owns selection', async ({ page, fleet }) => {
        await fleet.select(fleet.self);
        await page.click('#sessionThinking');
        await (0, fixtures_js_1.expect)(page.locator('#thinkingDropdown .thinking-option')).not.toHaveCount(0);
        const after = await page.evaluate(({ id, host }) => {
            const request = fixtureApp.features.apiTransport.request;
            let sends = 0;
            fixtureApp.features.apiTransport.request = (target, path, options) => {
                if (path.endsWith('/thinking')) {
                    sends++;
                    return Promise.resolve(new Response(JSON.stringify({ success: true, level: 'high' })));
                }
                return request(target, path, options);
            };
            // Leave the old DOM in place to exercise the action adapter's owner check
            // independently of normal selection-change disposal.
            fixtureApp.features.sessionState.advanceSelection();
            fixtureApp.features.sessionState.setCurrentSession(id, host);
            fixtureElement(document.querySelector('#thinkingDropdown .thinking-option'), 'thinking option').click();
            fixtureApp.features.sessionControls.closeThinking();
            fixtureApp.features.apiTransport.request = request;
            return { owner: fixtureApp.features.sessionState.captureSelection(), sends };
        }, { id: fixtures_js_1.ROOT, host: fleet.peer.hostId });
        if (after.owner === null)
            throw new Error('Missing replacement thinking owner');
        (0, fixtures_js_1.expect)(after.owner.host).toBe(fleet.peer.hostId);
        (0, fixtures_js_1.expect)(after.sends).toBe(0);
        await (0, fixtures_js_1.expect)(page.locator('#thinkingDropdown .thinking-option')).toHaveCount(0);
    });
});
