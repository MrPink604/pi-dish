// Generated test/tool from test/browser/production-composition.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
fixtures_js_1.test.use({ instrumentApp: false });
for (const width of [1280, 390])
    (0, fixtures_js_1.test)(`production bundle starts and restores a peer selection at ${width}px without application globals`, async ({ page, fleet }) => {
        await page.setViewportSize({ width, height: 900 });
        if (width === 390)
            await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
        await fleet.row(fleet.peer).click();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('peer root transcript');
        await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);
        const globals = () => page.evaluate(() => ({
            namespace: typeof PiDishBrowser, helperNamespace: typeof PiDishHelpers,
            state: typeof Reflect.get(globalThis, 'sessionState'), select: typeof Reflect.get(globalThis, 'selectSession'),
            request: typeof Reflect.get(globalThis, 'apiFetch'), fixture: typeof fixtureApp,
            fixtureElement: typeof globalThis.fixtureElement, fixtureInput: typeof globalThis.fixtureInput,
            fixtureDetails: typeof globalThis.fixtureDetails, fixtureLink: typeof globalThis.fixtureLink,
            fixtureCurrentSession: typeof globalThis.fixtureCurrentSession,
            fixtureTerminalProbe: typeof globalThis.fixtureTerminalProbe,
        }));
        (0, fixtures_js_1.expect)(await globals()).toEqual({ namespace: 'undefined', helperNamespace: 'undefined', state: 'undefined', select: 'undefined', request: 'undefined', fixture: 'undefined', fixtureElement: 'undefined', fixtureInput: 'undefined', fixtureDetails: 'undefined', fixtureLink: 'undefined', fixtureCurrentSession: 'undefined', fixtureTerminalProbe: 'undefined' });
        const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname));
        (0, fixtures_js_1.expect)(scripts).not.toContain('/browser.js');
        (0, fixtures_js_1.expect)(scripts).not.toContain('/helpers.js');
        (0, fixtures_js_1.expect)(await page.evaluate(() => localStorage.getItem('pi-dish-session'))).toBe(`${fleet.peer.hostId} ${fixtures_js_1.ROOT}`);
        await page.reload();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('peer root transcript');
        if (width === 390)
            await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
        await page.locator('#tabAll').click();
        await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);
        (0, fixtures_js_1.expect)(await globals()).toEqual({ namespace: 'undefined', helperNamespace: 'undefined', state: 'undefined', select: 'undefined', request: 'undefined', fixture: 'undefined', fixtureElement: 'undefined', fixtureInput: 'undefined', fixtureDetails: 'undefined', fixtureLink: 'undefined', fixtureCurrentSession: 'undefined', fixtureTerminalProbe: 'undefined' });
        await page.getByRole('button', { name: '+ New session', exact: true }).click();
        await (0, fixtures_js_1.expect)(page.locator('#nsHostSelect')).toBeVisible();
        await page.selectOption('#nsHostSelect', fleet.peer.hostId);
        await page.locator('[data-app-click="closeNewSessionView"]').click();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('peer root transcript');
    });
fixtures_js_1.test.describe('startup interactivity', () => {
    fixtures_js_1.test.use({ liveSessions: true });
    (0, fixtures_js_1.test)('local session selection and keyboard submission do not wait for a peer list', async ({ page, fleet }) => {
        let release;
        let arrived;
        const gate = new Promise(resolve => { release = resolve; });
        const pending = new Promise(resolve => { arrived = resolve; });
        await page.route(`${fleet.peer.base}/api/sessions?*`, async (route) => {
            arrived();
            await gate;
            await route.continue();
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await pending;
        try {
            await fleet.row(fleet.self).click();
            await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
            await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toBeEnabled();
            await page.locator('#promptInput').fill('Ready before the peer');
            const submitted = page.waitForRequest(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/prompt`);
            await page.locator('#promptInput').press('Enter');
            await submitted;
            await fixtures_js_1.expect.poll(() => fleet.self.commands.some(command => command.command === 'prompt')).toBe(true);
        }
        finally {
            release();
        }
    });
});
