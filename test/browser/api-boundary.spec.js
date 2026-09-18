// Generated test/tool from test/browser/api-boundary.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('a malformed peer list preserves cached rows and the selected self-host transcript', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.route(`${fleet.peer.base}/api/sessions?**`, route => route.fulfill({ json: { active: [{ id: 42 }], previous: [] } }));
    await page.evaluate(() => fixtureApp.features.sidebarLists.refresh());
    await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toBeVisible();
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
});
(0, fixtures_js_1.test)('malformed model catalogs cannot populate the selector', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.route(`${fleet.self.base}/api/models?sessionId=${fixtures_js_1.ROOT}`, route => route.fulfill({ json: [{ id: {}, provider: 'fixture' }] }));
    await page.evaluate(() => {
        const owner = fixtureApp.features.sessionState.captureSelection();
        if (owner === null)
            throw new Error('Missing owner');
        window.fixtureSessionListPatch(owner.id, { isActive: true, capabilities: { setModel: true } });
        return fixtureApp.features.sessionControls.toggleModels();
    });
    await (0, fixtures_js_1.expect)(page.locator('#modelDropdown')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#modelDropdown')).toContainText('No models found');
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.modelCatalog.rows().length)).toBe(0);
});
(0, fixtures_js_1.test)('an unauthorized peer becomes blocked while retaining its cached rows', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.route(`${fleet.peer.base}/api/sessions?**`, route => route.fulfill({ status: 401, json: { error: 'fixture unauthorized' } }));
    await page.evaluate(() => fixtureApp.features.sidebarLists.refresh());
    (0, fixtures_js_1.expect)(await page.evaluate(id => fixtureApp.features.hostConnections.stateOf(fixtureApp.ports.appModels.host(id)), fleet.peer.hostId)).toBe('blocked');
    await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toBeVisible();
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
});
(0, fixtures_js_1.test)('peer list metadata keeps endpoint identity and isolates unknown extras', async ({ page, fleet }) => {
    await page.route(`${fleet.peer.base}/api/sessions?**`, route => route.fulfill({ json: {
            active: [], previous: [{ id: fixtures_js_1.ROOT, host: fleet.self.hostId, hostLabel: 'forged', name: 'peer wire name',
                    contextTokens: 0, lastActivity: 0, compacting: false, parentId: null,
                    custom: { name: 'opaque' }, fields: { name: 'forged' }, extras: { host: fleet.self.hostId } }],
        } }));
    await page.evaluate(() => fixtureApp.features.sidebarLists.load(undefined, { withPrevious: true }));
    (0, fixtures_js_1.expect)(await page.evaluate(({ id, peer, self }) => {
        const row = fixtureElement(fixtureApp.features.sessionState.findSession(id, peer), 'peer session');
        const selfRow = fixtureElement(fixtureApp.features.sessionState.findSession(id, self), 'self session');
        return { host: row.host, label: row.hostLabel, name: row.name, contextTokens: row.contextTokens,
            lastActivity: row.lastActivity, compacting: row.compacting, parentId: row.parentId,
            custom: row.extras?.custom, unknownTopLevel: 'custom' in row ? row.custom : undefined, selfName: selfRow.name };
    }, { id: fixtures_js_1.ROOT, peer: fleet.peer.hostId, self: fleet.self.hostId })).toEqual({
        host: fleet.peer.hostId, label: 'peer', name: 'peer wire name', contextTokens: 0,
        lastActivity: 0, compacting: false, parentId: null, custom: { name: 'opaque' },
        unknownTopLevel: undefined, selfName: 'self root transcript',
    });
});
(0, fixtures_js_1.test)('transcript metadata refreshes selected display fields without claiming list authority', async ({ page, fleet }) => {
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/messages?**`, route => route.fulfill({ json: {
            messages: [], session: { id: 'forged', host: fleet.self.hostId, name: 'transcript name', model: '',
                contextTokens: 0, lastActivity: 0, isActive: false, harnessId: 'forged', thinkingLevel: 'forged',
                capabilities: { resume: false }, parentId: 'forged', routine: 'forged', custom: { name: 'forged' } },
        } }));
    const before = await page.evaluate(({ id, host }) => {
        const row = fixtureElement(fixtureApp.features.sessionState.findSession(id, host), 'peer session');
        return { name: row.name, harnessId: row.harnessId, thinkingLevel: row.thinkingLevel, capabilities: row.capabilities, parentId: row.parentId, routine: row.routine };
    }, { id: fixtures_js_1.ROOT, host: fleet.peer.hostId });
    await fleet.select(fleet.peer);
    const after = await page.evaluate(({ id, host }) => {
        const row = fixtureApp.features.sessionState.currentSession;
        if (row === null)
            throw new Error('Missing row');
        return { id: row.id, host: row.host, name: row.name, model: row.model, contextTokens: row.contextTokens,
            lastActivity: row.lastActivity, isActive: row.isActive, harnessId: row.harnessId,
            thinkingLevel: row.thinkingLevel, capabilities: row.capabilities, parentId: row.parentId, routine: row.routine,
            custom: 'custom' in row ? row.custom : undefined, listName: fixtureElement(fixtureApp.features.sessionState.findSession(id, host), 'list session').name };
    }, { id: fixtures_js_1.ROOT, host: fleet.peer.hostId });
    (0, fixtures_js_1.expect)(after).toEqual({ ...before, id: fixtures_js_1.ROOT, host: fleet.peer.hostId, name: 'transcript name', model: '',
        contextTokens: 0, lastActivity: 0, isActive: false, custom: undefined, listName: before.name });
});
