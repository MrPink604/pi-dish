// Generated test/tool from test/browser/skills.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const skill = (name = 'one') => ({ skill: `/fixture/${name}/SKILL.md`, filePath: `/fixture/${name}/SKILL.md`, baseDir: `/fixture/${name}`, name, description: 'Skill fixture', source: 'fixture', advertised: true, bodyTokensEst: 12, bodyBytes: 48, usage: { weeks12: [0, 1] } });
const coverage = (name = 'one', latest = null) => ({ skill: `/fixture/${name}/SKILL.md`, numMapped: 2, unreadTokensEst: 3, sections: [{ heading: 'Cold section', neverRead: true, fraction: 0, reads: 0, startLine: 1, endLine: 2, lines: [{ text: 'Body', hits: 0 }] }], weeks26: [0, 1], latest });
async function routes(page) {
    await page.route('**/api/skills', (route) => route.fulfill({ json: { skills: [skill(), skill('two')], summary: { discovered: 2 }, refine: { mode: 'path', mdPath: '/refine.md' } } }));
    await page.route('**/api/skills/coverage?*', (route) => route.fulfill({ json: coverage(new URL(route.request().url()).searchParams.get('skill')?.includes('/two/') ? 'two' : 'one') }));
}
async function open(page) {
    await page.evaluate(() => fixtureApp.features.skillsController.open());
    await (0, fixtures_js_1.expect)(page.locator('.sk-row')).toHaveCount(2);
}
(0, fixtures_js_1.test)('late coverage cannot replace a newer skill or refine it with old evidence', async ({ page, fleet }) => {
    await routes(page);
    await open(page);
    await page.evaluate(() => fixtureApp.features.skillsController.detail('/fixture/one/SKILL.md'));
    await (0, fixtures_js_1.expect)(page.locator('.refine-btn')).toBeEnabled();
    let held;
    await page.route('**/api/skills/coverage?*', route => { held = route; });
    await page.evaluate(() => { window.pendingSkillDetail = fixtureApp.features.skillsController.detail('/fixture/two/SKILL.md'); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await (0, fixtures_js_1.expect)(page.locator('.refine-btn')).toBeDisabled();
    await page.evaluate(() => fixtureApp.features.skillsController.refine());
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/new-session-open/);
    await page.evaluate(() => fixtureApp.features.skillsController.back());
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: coverage('two') });
    await page.evaluate(() => window.pendingSkillDetail);
    await (0, fixtures_js_1.expect)(page.locator('.sk-row')).toHaveCount(2);
    await (0, fixtures_js_1.expect)(page.locator('.skills-detail-wrap')).toHaveCount(0);
});
(0, fixtures_js_1.test)('retained skill controls retire on navigation and refine chooses the skill host', async ({ page, fleet }) => {
    await routes(page);
    await open(page);
    await page.evaluate(() => { window.retiredSkillRow = document.querySelector('.sk-row'); });
    await page.evaluate(() => fixtureApp.features.skillsController.detail('/fixture/one/SKILL.md'));
    await page.evaluate(() => fixtureElement(window.retiredSkillRow, 'retired skill row').click());
    await (0, fixtures_js_1.expect)(page.locator('.skills-detail-wrap')).toBeVisible();
    await page.evaluate(host => fixtureApp.features.newSessionController.setHostId(host), fleet.peer.hostId);
    await page.locator('.refine-btn').click();
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/new-session-open/);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.newSessionController.hostId())).toBe(fleet.self.hostId);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.newSessionController.pendingDraft)).toContain('/fixture/one/SKILL.md');
    await page.evaluate(() => fixtureElement(window.retiredSkillRow, 'retired skill row').click());
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/new-session-open/);
});
(0, fixtures_js_1.test)('activation links use the skill host even when a same-id peer session is selected', async ({ page, fleet }) => {
    await routes(page);
    await page.route('**/api/skills/coverage?*', route => route.fulfill({ json: coverage('one', { sessionId: fixtures_js_1.CHILD, entryId: "entry'quoted", name: "Name ' quoted" }) }));
    await fleet.select(fleet.peer, fixtures_js_1.ROOT);
    await open(page);
    await page.evaluate(() => fixtureApp.features.skillsController.detail('/fixture/one/SKILL.md'));
    await (0, fixtures_js_1.expect)(page.locator('.skill-activation')).toHaveText("latest activation: Name ' quoted →");
    (0, fixtures_js_1.expect)(await page.locator('.skill-activation').getAttribute('onclick')).toBeNull();
    await page.locator('.skill-activation').click();
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self, fixtures_js_1.CHILD)).toHaveClass(/\bactive\b/);
    await (0, fixtures_js_1.expect)(page.locator(`.session-item.active[data-host="${fleet.peer.hostId}"]`)).toHaveCount(0);
});
(0, fixtures_js_1.test)('disposal cancels directory indexing and ignores retained refresh controls', async ({ page, fleet }) => {
    await routes(page);
    await page.clock.install();
    let reads = 0;
    await page.route('**/api/skills', route => { reads++; return route.fulfill({ json: { indexing: true, skills: [skill(), skill('two')] } }); });
    await open(page);
    await page.evaluate(() => { window.retiredSkillsRefresh = document.querySelector('[data-skills-action="refresh"]'); fixtureApp.features.skillsController.dispose(); fixtureElement(window.retiredSkillsRefresh, 'retired skills refresh').click(); });
    const before = reads;
    await page.clock.runFor(2000);
    (0, fixtures_js_1.expect)(reads).toBe(before);
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/skills-open/);
});
(0, fixtures_js_1.test)('a late activation list lookup cannot hijack a newer selection', async ({ page, fleet }) => {
    await routes(page);
    await open(page);
    await page.evaluate(() => fixtureApp.features.skillsController.detail('/fixture/one/SKILL.md'));
    const selected = await page.evaluate(async ({ peer, id }) => {
        const original = fixtureApp.features.sidebarLists.load;
        let release;
        fixtureApp.features.sidebarLists.load = () => new Promise(resolve => { release = resolve; });
        try {
            const pending = fixtureApp.features.skillsController.activation('not-yet-listed', 'entry');
            await fixtureApp.features.sessionView.select(id, { host: peer });
            if (!release)
                throw new Error('Sidebar load resolver not initialized');
            release();
            await pending;
            return fixtureCurrentSession().host;
        }
        finally {
            fixtureApp.features.sidebarLists.load = original;
        }
    }, { peer: fleet.peer.hostId, id: fixtures_js_1.ROOT });
    (0, fixtures_js_1.expect)(selected).toBe(fleet.peer.hostId);
});
