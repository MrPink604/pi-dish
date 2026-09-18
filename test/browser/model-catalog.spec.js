// Generated test/tool from test/browser/model-catalog.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const models = (id) => [{ id, provider: 'fixture', name: id, enabled: true }];
async function trackLoads(page) {
    await page.evaluate(() => {
        const load = fixtureApp.features.modelCatalog.load;
        window.modelLoads = [];
        fixtureApp.features.modelCatalog.load = (...args) => { const pending = load(...args); window.modelLoads.push(pending); return pending; };
    });
}
async function holdBody(page, url) {
    await page.evaluate(url => {
        const read = Response.prototype.json;
        Response.prototype.json = async function () {
            const data = await read.call(this);
            if (this.url === url) {
                Response.prototype.json = read;
                window.modelBodyWaiting = true;
                await new Promise(resolve => { window.releaseModelBody = resolve; });
            }
            return data;
        };
    }, url);
}
(0, fixtures_js_1.test)('new-session model responses stay with their selected host', async ({ page, fleet }) => {
    const held = [];
    await page.route('**/api/models', route => new URL(route.request().url()).origin === fleet.peer.base
        ? route.fulfill({ json: models('peer') }) : held.push(route));
    await trackLoads(page);
    await page.evaluate(() => fixtureApp.features.newSessionController.open());
    await fixtures_js_1.expect.poll(() => held.length).toBe(1);
    await page.selectOption('#nsHostSelect', fleet.peer.hostId);
    await (0, fixtures_js_1.expect)(page.locator('#nsModelSelect')).toContainText('peer');
    await held[0].fulfill({ json: models('self-old') });
    await page.evaluate(() => window.modelLoads[0]);
    await (0, fixtures_js_1.expect)(page.locator('#nsModelSelect')).not.toContainText('self-old');
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.modelCatalog.rows().map(row => row.id))).toEqual(['peer']);
});
(0, fixtures_js_1.test)('a previous cwd model body cannot publish before the next debounced controller refresh', async ({ page, fleet }) => {
    const url = `${fleet.self.base}/api/models`;
    await page.route(url, route => route.fulfill({ json: models('ready') }));
    await page.evaluate(() => fixtureApp.features.newSessionController.open({ cwd: '/old' }));
    await (0, fixtures_js_1.expect)(page.locator('#nsModelSelect')).toContainText('ready');
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await holdBody(page, url);
    await page.route(url, route => route.fulfill({ json: models('retired') }));
    await trackLoads(page);
    await page.evaluate(() => fixtureApp.features.newSessionController.refresh());
    await fixtures_js_1.expect.poll(() => page.evaluate(() => window.modelBodyWaiting)).toBe(true);
    await page.fill('#newSessionCwd', '/new');
    await page.evaluate(async () => {
        window.releaseModelBody();
        await window.modelLoads[0];
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.modelCatalog.rows().map(row => row.id))).toEqual(['ready']);
    await (0, fixtures_js_1.expect)(page.locator('#nsModelSelect')).toContainText('ready');
    await (0, fixtures_js_1.expect)(page.locator('#nsModelSelect')).not.toContainText('retired');
    (0, fixtures_js_1.expect)(await page.evaluate(() => {
        const rows = JSON.parse(localStorage.getItem('pi-dish-models-cache') ?? '[]');
        if (!Array.isArray(rows))
            throw new Error('Invalid model cache');
        return rows.map(row => {
            if (typeof row !== 'object' || row === null || !('id' in row) || typeof row.id !== 'string')
                throw new Error('Invalid cached model');
            return row.id;
        });
    })).toEqual(['ready']);
    await page.route(url, route => route.fulfill({ json: models('refreshed') }));
    await page.locator('#newSessionName').focus();
    await (0, fixtures_js_1.expect)(page.locator('#nsModelSelect')).toContainText('ready');
    await page.clock.runFor(300);
    await (0, fixtures_js_1.expect)(page.locator('#nsModelSelect')).toContainText('refreshed');
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.modelCatalog.rows().map(row => row.id))).toEqual(['refreshed']);
});
(0, fixtures_js_1.test)('closing a model-owning takeover retires its body without replacing a session catalog', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const url = `${fleet.self.base}/api/models`;
    await holdBody(page, url);
    await page.route(url, route => route.fulfill({ json: models('retired-new-session') }));
    await page.route(`${fleet.self.base}/api/models?sessionId=${fixtures_js_1.ROOT}`, route => route.fulfill({ json: models('session') }));
    await trackLoads(page);
    await page.evaluate(() => fixtureApp.features.newSessionController.open());
    await fixtures_js_1.expect.poll(() => page.evaluate(() => window.modelBodyWaiting)).toBe(true);
    await page.evaluate(async () => {
        fixtureApp.features.newSessionController.close();
        await fixtureApp.features.appModels.load(fixtureCurrentSession().id, 'pi');
        window.releaseModelBody();
        await window.modelLoads[0];
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.modelCatalog.rows().map(row => row.id))).toEqual(['session']);
});
(0, fixtures_js_1.test)('new-session cached catalogs use the selected peer key', async ({ page, fleet }) => {
    const held = [];
    await page.route('**/api/harnesses', route => held.push(route));
    await page.evaluate(peer => {
        fixtureApp.features.newSessionController.setHostId(peer);
        localStorage.setItem('pi-dish-new-harness', 'pi');
        localStorage.setItem('pi-dish-models-cache', JSON.stringify([{ id: 'self-cache', provider: 'fixture' }]));
        localStorage.setItem('pi-dish-models-cache@' + peer, JSON.stringify([{ id: 'peer-cache', provider: 'fixture' }]));
        fixtureApp.features.newSessionController.open();
    }, fleet.peer.hostId);
    await (0, fixtures_js_1.expect)(page.locator('#nsModelSelect')).toContainText('peer-cache');
    await (0, fixtures_js_1.expect)(page.locator('#nsModelSelect')).not.toContainText('self-cache');
    for (const route of held)
        await route.fulfill({ json: [{ id: 'pi', available: true }] });
});
(0, fixtures_js_1.test)('a catalog retired by host renewal cannot clear the server-local enabled-model scope', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.route(`${fleet.self.base}/api/models?sessionId=${fixtures_js_1.ROOT}`, route => route.fulfill({ json: [
            { id: 'enabled', provider: 'fixture', enabled: true }, { id: 'hidden', provider: 'fixture', enabled: false },
        ] }));
    await page.evaluate(async (id) => {
        window.fixtureSessionListPatch(id, { isActive: true, harnessId: 'pi' });
        await fixtureApp.features.sessionControls.toggleModels();
        fixtureApp.features.sessionControls.setEditMode(true);
    }, fixtures_js_1.ROOT);
    await (0, fixtures_js_1.expect)(page.locator('#modelDropdown')).toBeVisible();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const payloads = [];
    await page.route('**/api/models/enabled', route => {
        payloads.push(route.request().postDataJSON());
        return route.fulfill({ json: { success: true, enabledModels: null } });
    });
    await page.evaluate(() => fixtureApp.features.sessionControls.setAll(false));
    await page.clock.runFor(400);
    await fixtures_js_1.expect.poll(() => payloads).toEqual([{ enabledIds: [] }]);
    await page.evaluate(() => {
        const resolve = fixtureApp.features.hostDirectory.entryFor;
        fixtureApp.features.hostDirectory.entryFor = host => { const entry = resolve(host); return entry ? { ...entry, token: 'renewed-fixture' } : entry; };
        fixtureApp.features.sessionControls.setAll(true);
    });
    await page.clock.runFor(400);
    (0, fixtures_js_1.expect)(payloads).toEqual([{ enabledIds: [] }]);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.modelCatalog.enabledIds())).toBeUndefined();
});
