const { test, expect, ROOT, CHILD } = require('./fixtures');
const skill = (name = 'one') => ({ skill: `/fixture/${name}/SKILL.md`, filePath: `/fixture/${name}/SKILL.md`, baseDir: `/fixture/${name}`, name, description: 'Skill fixture', source: 'fixture', advertised: true, bodyTokensEst: 12, bodyBytes: 48, usage: { weeks12: [0, 1] } });
const coverage = (name = 'one', latest = null) => ({ skill: `/fixture/${name}/SKILL.md`, numMapped: 2, unreadTokensEst: 3, sections: [{ heading: 'Cold section', neverRead: true, fraction: 0, reads: 0, startLine: 1, endLine: 2, lines: [{ text: 'Body', hits: 0 }] }], weeks26: [0, 1], latest });
async function routes(page) {
  await page.route('**/api/skills', route => route.fulfill({ json: { skills: [skill(), skill('two')], summary: { discovered: 2 }, refine: { mode: 'path', mdPath: '/refine.md' } } }));
  await page.route('**/api/skills/coverage?*', route => route.fulfill({ json: coverage(new URL(route.request().url()).searchParams.get('skill').includes('/two/') ? 'two' : 'one') }));
}
async function open(page) {
  await page.evaluate(() => fixtureApp.features.skillsController.open());
  await expect(page.locator('.sk-row')).toHaveCount(2);
}

test('late coverage cannot replace a newer skill or refine it with old evidence', async ({ page, fleet }) => {
  await routes(page);
  await open(page);
  await page.evaluate(() => fixtureApp.features.skillsController.detail('/fixture/one/SKILL.md'));
  await expect(page.locator('.refine-btn')).toBeEnabled();
  let held;
  await page.route('**/api/skills/coverage?*', route => { held = route; });
  await page.evaluate(() => { window.pendingSkillDetail = fixtureApp.features.skillsController.detail('/fixture/two/SKILL.md'); });
  await expect.poll(() => !!held).toBe(true);
  await expect(page.locator('.refine-btn')).toBeDisabled();
  await page.evaluate(() => fixtureApp.features.skillsController.refine());
  await expect(page.locator('.main')).not.toHaveClass(/new-session-open/);
  await page.evaluate(() => fixtureApp.features.skillsController.back());
  await held.fulfill({ json: coverage('two') });
  await page.evaluate(() => window.pendingSkillDetail);
  await expect(page.locator('.sk-row')).toHaveCount(2);
  await expect(page.locator('.skills-detail-wrap')).toHaveCount(0);
});

test('retained skill controls retire on navigation and refine chooses the skill host', async ({ page, fleet }) => {
  await routes(page);
  await open(page);
  await page.evaluate(() => { window.retiredSkillRow = document.querySelector('.sk-row'); });
  await page.evaluate(() => fixtureApp.features.skillsController.detail('/fixture/one/SKILL.md'));
  await page.evaluate(() => window.retiredSkillRow.click());
  await expect(page.locator('.skills-detail-wrap')).toBeVisible();
  await page.evaluate(host => fixtureApp.features.newSessionController.setHostId(host), fleet.peer.hostId);
  await page.locator('.refine-btn').click();
  await expect(page.locator('.main')).toHaveClass(/new-session-open/);
  expect(await page.evaluate(() => fixtureApp.features.newSessionController.hostId())).toBe(fleet.self.hostId);
  expect(await page.evaluate(() => fixtureApp.features.newSessionController.pendingDraft)).toContain('/fixture/one/SKILL.md');
  await page.evaluate(() => window.retiredSkillRow.click());
  await expect(page.locator('.main')).toHaveClass(/new-session-open/);
});

test('activation links use the skill host even when a same-id peer session is selected', async ({ page, fleet }) => {
  await routes(page);
  await page.route('**/api/skills/coverage?*', route => route.fulfill({ json: coverage('one', { sessionId: CHILD, entryId: "entry'quoted", name: "Name ' quoted" }) }));
  await fleet.select(fleet.peer, ROOT);
  await open(page);
  await page.evaluate(() => fixtureApp.features.skillsController.detail('/fixture/one/SKILL.md'));
  await expect(page.locator('.skill-activation')).toHaveText("latest activation: Name ' quoted →");
  expect(await page.locator('.skill-activation').getAttribute('onclick')).toBeNull();
  await page.locator('.skill-activation').click();
  await expect(fleet.row(fleet.self, CHILD)).toHaveClass(/\bactive\b/);
  await expect(page.locator(`.session-item.active[data-host="${fleet.peer.hostId}"]`)).toHaveCount(0);
});

test('disposal cancels directory indexing and ignores retained refresh controls', async ({ page, fleet }) => {
  await routes(page);
  await page.clock.install();
  let reads = 0;
  await page.route('**/api/skills', route => { reads++; return route.fulfill({ json: { indexing: true, skills: [skill(), skill('two')] } }); });
  await open(page);
  await page.evaluate(() => { window.retiredSkillsRefresh = document.querySelector('[data-skills-action="refresh"]'); fixtureApp.features.skillsController.dispose(); window.retiredSkillsRefresh.click(); });
  const before = reads;
  await page.clock.runFor(2000);
  expect(reads).toBe(before);
  await expect(page.locator('.main')).not.toHaveClass(/skills-open/);
});


test('a late activation list lookup cannot hijack a newer selection', async ({ page, fleet }) => {
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
      release(); await pending;
      return fixtureApp.features.sessionState.currentSession.host;
    } finally { fixtureApp.features.sidebarLists.load = original; }
  }, { peer: fleet.peer.hostId, id: ROOT });
  expect(selected).toBe(fleet.peer.hostId);
});
