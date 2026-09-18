// Generated test/tool from test/browser/session-navigation.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const fixtures_js_1 = require("./fixtures.js");
const lineageNode = (id, name, children = [], isActive = true) => ({
    session: { id, name, isActive, lastActivity: '2026-09-11T00:00:00Z' },
    edge: children.length ? null : { kind: 'child', source: 'fixture' }, children,
});
const lineagePayload = (childName = 'Related child') => ({
    session: { id: fixtures_js_1.CHILD, name: 'Current' },
    tree: lineageNode(fixtures_js_1.ROOT, 'Root', [lineageNode(fixtures_js_1.CHILD, childName)]),
    members: 2,
});
(0, fixtures_js_1.test)('retained lineage link and tree rows cannot retarget a same-id peer or a refreshed view', async ({ page, fleet }) => {
    await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: lineagePayload() }));
    await fleet.select(fleet.self);
    await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
    await (0, fixtures_js_1.expect)(page.locator('#sessionRelations .session-relation-chip')).toContainText('Subagents · 1');
    await page.evaluate(() => { window.oldRelationLink = document.querySelector('#sessionRelations .session-relation-chip'); });
    await fleet.select(fleet.peer);
    await page.evaluate(() => fixtureElement(window.oldRelationLink, 'old relation link').click());
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/\bsubagents-open\b/);
    await (0, fixtures_js_1.expect)(fleet.row(fleet.peer, fixtures_js_1.ROOT)).toHaveClass(/\bactive\b/);
    await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
    await page.locator('#sessionRelations .session-relation-chip').click();
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
    await (0, fixtures_js_1.expect)(page.locator('.lineage-row')).toHaveCount(2);
    await page.evaluate(() => { window.oldLineageRow = document.querySelectorAll('.lineage-row')[1] ?? null; });
    await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: { session: { id: fixtures_js_1.CHILD }, tree: null, members: 0 } }));
    await page.evaluate(() => fixtureApp.features.subagentsController.reload());
    await (0, fixtures_js_1.expect)(page.locator('#subagentsTree .subagents-state')).toContainText('No related sessions');
    await page.evaluate(() => fixtureElement(window.oldLineageRow, 'old lineage row').click());
    await (0, fixtures_js_1.expect)(fleet.row(fleet.peer, fixtures_js_1.ROOT)).toHaveClass(/\bactive\b/);
    await (0, fixtures_js_1.expect)(page.locator('#subagentsDetailEmpty')).toBeVisible();
});
(0, fixtures_js_1.test)('peeking at a relative reads its trace without switching the selected session', async ({ page, fleet }) => {
    const payload = lineagePayload();
    payload.session = { id: fixtures_js_1.ROOT, name: 'Current' };
    await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: payload }));
    await fleet.select(fleet.self);
    await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
    await page.locator('#sessionRelations .session-relation-chip').click();
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
    await (0, fixtures_js_1.expect)(page.locator('#sessionView')).toBeHidden();
    await page.locator(`.lineage-row[data-session-id="${fixtures_js_1.CHILD}"]`).click();
    // The trace comes from the fixture server's real transcript file.
    await (0, fixtures_js_1.expect)(page.locator('#subagentsTrace')).toContainText('self child transcript');
    await (0, fixtures_js_1.expect)(page.locator('#subagentsDetailName')).toContainText('Related child');
    await (0, fixtures_js_1.expect)(page.locator('#sessionName')).toBeHidden(); // session view stays parked underneath
    await page.locator('[data-app-click="closeSubagentsView"]').click();
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/\bsubagents-open\b/);
    await (0, fixtures_js_1.expect)(page.locator('#sessionView')).toBeVisible();
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self, fixtures_js_1.ROOT)).toHaveClass(/\bactive\b/);
});
(0, fixtures_js_1.test)('signaling a relative uses its capabilities and keeps the viewer in place', async ({ page, fleet }) => {
    const payload = lineagePayload();
    payload.session = { id: fixtures_js_1.ROOT, name: 'Current' };
    payload.tree.children[0].session.capabilities = { prompt: true, steer: true, followUp: true };
    await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: payload }));
    const steers = [];
    await page.route(`**/api/sessions/${fixtures_js_1.CHILD}/steer`, route => {
        steers.push(route.request().postDataJSON());
        return route.fulfill({ json: { success: true } });
    });
    await fleet.select(fleet.self);
    await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
    await page.locator('#sessionRelations .session-relation-chip').click();
    await page.locator(`.lineage-row[data-session-id="${fixtures_js_1.CHILD}"]`).click();
    await (0, fixtures_js_1.expect)(page.locator('#subagentsSendBtn')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#subagentsSteerBtn')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#subagentsFollowUpBtn')).toBeVisible();
    await page.fill('#subagentsSignalInput', 'focus on src/auth');
    await page.locator('#subagentsSteerBtn').click();
    await fixtures_js_1.expect.poll(() => steers.map(entry => (0, wire_protocol_js_1.isRecord)(entry) ? entry.message : undefined)).toEqual(['focus on src/auth']);
    await (0, fixtures_js_1.expect)(page.locator('#subagentsSignalStatus')).toContainText('Steered');
    await (0, fixtures_js_1.expect)(page.locator('#subagentsSignalInput')).toHaveValue('');
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self, fixtures_js_1.ROOT)).toHaveClass(/\bactive\b/);
});
(0, fixtures_js_1.test)('a finished relative shows why signaling is unavailable', async ({ page, fleet }) => {
    const payload = lineagePayload();
    payload.session = { id: fixtures_js_1.ROOT, name: 'Current' };
    payload.tree.children[0].session.isActive = false;
    await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: payload }));
    await fleet.select(fleet.self);
    await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
    await page.locator('#sessionRelations .session-relation-chip').click();
    await page.locator(`.lineage-row[data-session-id="${fixtures_js_1.CHILD}"]`).click();
    await (0, fixtures_js_1.expect)(page.locator('#subagentsSignalBox')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#subagentsSignalNote')).toContainText('has ended');
});
(0, fixtures_js_1.test)('lineage tree collapses subtrees and marks the current session', async ({ page, fleet }) => {
    const payload = lineagePayload();
    payload.tree.children[0].children.push(lineageNode('grandchild-1', 'Grandchild'));
    payload.tree.children[0].edge = { kind: 'child', source: 'fixture' };
    payload.members = 3;
    await page.route('**/api/sessions/*/lineage', route => route.fulfill({ json: payload }));
    await fleet.select(fleet.self);
    await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
    await (0, fixtures_js_1.expect)(page.locator('#sessionRelations')).toContainText('Subagents · 2');
    await page.locator('#sessionRelations .session-relation-chip').click();
    await (0, fixtures_js_1.expect)(page.locator('.lineage-row')).toHaveCount(3);
    await (0, fixtures_js_1.expect)(page.locator('.lineage-row.lineage-current')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('.lineage-row.lineage-current')).toHaveAttribute('data-session-id', fixtures_js_1.CHILD);
    await page.locator(`.lineage-row[data-session-id="${fixtures_js_1.CHILD}"] .lineage-twisty`).click();
    await (0, fixtures_js_1.expect)(page.locator('.lineage-row')).toHaveCount(2);
    await (0, fixtures_js_1.expect)(page.locator('.lineage-row[data-session-id="grandchild-1"]')).toHaveCount(0);
    await page.locator(`.lineage-row[data-session-id="${fixtures_js_1.CHILD}"] .lineage-twisty`).click();
    await (0, fixtures_js_1.expect)(page.locator('.lineage-row')).toHaveCount(3);
});
(0, fixtures_js_1.test)('relation disposal retires the indexing repoll as well as rendered controls', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.clock.install();
    let reads = 0;
    await page.route('**/api/sessions/*/lineage', route => { reads++; return route.fulfill({ json: { indexing: true, ...lineagePayload('Indexed child') } }); });
    await page.evaluate(() => fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection()));
    const before = reads;
    await (0, fixtures_js_1.expect)(page.locator('#sessionRelations')).toContainText('Subagents');
    await page.evaluate(() => fixtureApp.features.sessionRelationsController.dispose());
    await page.clock.runFor(1500);
    (0, fixtures_js_1.expect)(reads).toBe(before);
    await (0, fixtures_js_1.expect)(page.locator('#sessionRelations')).toBeHidden();
});
for (const close of [false, true])
    (0, fixtures_js_1.test)(`a late same-session search cannot overwrite ${close ? 'a closed bar' : 'a newer query'}`, async ({ page, fleet }) => {
        await fleet.select(fleet.self);
        let held;
        await page.route('**/api/sessions/*/search?q=old-query', route => { held = route; });
        await page.route('**/api/sessions/*/search?q=self', route => route.fulfill({ json: { matches: [{ index: 0, role: 'user' }] } }));
        await page.evaluate(() => { fixtureApp.features.sessionSearch.open(); window.oldNavigationSearch = fixtureApp.features.sessionSearch.run('old-query'); });
        await fixtures_js_1.expect.poll(() => !!held).toBe(true);
        if (close)
            await page.evaluate(() => fixtureApp.features.sessionSearch.close());
        else
            await page.evaluate(() => fixtureApp.features.sessionSearch.run('self'));
        await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { matches: [{ index: 0, role: 'user' }] } });
        await page.evaluate(() => window.oldNavigationSearch);
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionSearch.state.query)).toBe(close ? '' : 'self');
        if (close)
            await (0, fixtures_js_1.expect)(page.locator('#searchBar')).toBeHidden();
        else
            await (0, fixtures_js_1.expect)(page.locator('mark.search-mark')).toHaveText('self');
    });
