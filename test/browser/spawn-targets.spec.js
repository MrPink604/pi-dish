const { test, expect } = require('./fixtures');
const targets = name => ({ available: true, servers: [{ name, socket: '/' + name, sessions: [{ name: 'work' }] }] });
async function holdBody(page, url) {
  await page.evaluate(url => {
    const read = Response.prototype.json;
    Response.prototype.json = async function() {
      const data = await read.call(this);
      if (this.url === url) {
        window.targetBodyWaiting = true;
        await new Promise(resolve => { window.releaseTargetBody = resolve; });
      }
      return data;
    };
  }, url);
}
async function trackLoads(page) {
  await page.evaluate(() => {
    const load = fixtureApp.features.newSessionController.targets.load;
    window.targetLoads = [];
    fixtureApp.features.newSessionController.targets.load = () => { const pending = load(); window.targetLoads.push(pending); return pending; };
  });
}
test('an older tmux host response cannot replace the current picker', async ({ page, fleet }) => {
  const held = [];
  await page.route('**/api/tmux/targets', route => held.push(route));
  await trackLoads(page);
  await page.evaluate(() => fixtureApp.features.newSessionController.open());
  await expect.poll(() => held.length).toBe(1);
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await expect.poll(() => held.length).toBe(2);
  await held[1].fulfill({ json: targets('peer') });
  await page.evaluate(() => window.targetLoads[1]);
  await held[0].fulfill({ json: targets('self-old') });
  await page.evaluate(() => window.targetLoads[0]);
  await page.locator('#newSessionTarget').focus();
  await expect(page.locator('#spawnTargetDropdown')).toContainText('tmux:peer — work');
  await expect(page.locator('#spawnTargetDropdown')).not.toContainText('self-old');
});

test('closing the takeover retires a tmux response held in its body reader', async ({ page, fleet }) => {
  await holdBody(page, `${fleet.self.base}/api/tmux/targets`);
  await page.route('**/api/tmux/targets', route => route.fulfill({ json: targets('old') }));
  await trackLoads(page);
  await page.evaluate(() => fixtureApp.features.newSessionController.open());
  await expect.poll(() => page.evaluate(() => window.targetBodyWaiting)).toBe(true);
  await page.evaluate(async () => { fixtureApp.features.newSessionController.close(); window.releaseTargetBody(); await window.targetLoads[0]; });
  expect(await page.evaluate(() => fixtureApp.features.newSessionController.selectedTarget())).toBeNull();
  await expect(page.locator('#newSessionTargetWrap')).toBeHidden();
});

test('run-in keyboard actions validate new names and keep saved resumes on their host', async ({ page, fleet }) => {
  await page.route('**/api/tmux/targets', route => route.fulfill({ json: targets('self') }));
  await page.evaluate(() => fixtureApp.features.newSessionController.open());
  await expect(page.locator('#newSessionTargetWrap')).toBeVisible();
  const input = page.locator('#newSessionTarget');
  await input.focus();
  await input.press('ArrowDown'); await input.press('ArrowDown'); await input.press('Enter');
  await expect(page.locator('#newSessionTmuxName')).toBeFocused();
  expect(await page.evaluate(() => { try { fixtureApp.features.newSessionController.selectedTarget(); } catch (e) { return e.message; } })).toContain('Enter a name');
  await page.locator('#newSessionTmuxName').fill(' fresh ');
  expect(await page.evaluate(() => fixtureApp.features.newSessionController.selectedTarget())).toEqual({ type: 'tmux', socket: '/self', newTmuxSession: 'fresh' });
  await input.focus();
  await input.fill('work');
  await input.press('ArrowDown'); await input.press('ArrowDown'); await input.press('ArrowDown'); await input.press('Enter');
  expect(await page.evaluate(() => fixtureApp.features.newSessionController.selectedTarget())).toEqual({ type: 'tmux', socket: '/self', tmuxSession: 'work' });
  expect(await page.evaluate(id => (host => fixtureApp.features.newSessionController.targets.resume(fixtureApp.ports.appModels.host(host)))(id), fleet.peer.hostId)).toBeNull();
  expect(await page.evaluate(id => (host => fixtureApp.features.newSessionController.targets.resume(fixtureApp.ports.appModels.host(host)))(id), fleet.self.hostId)).toEqual({ type: 'tmux', socket: '/self', tmuxSession: 'work' });
});

test('refresh disposes old picker rows and clears targets when tmux becomes unavailable', async ({ page, fleet }) => {
  expect(fleet.self.hostId).toBeTruthy();
  let available = true;
  await page.route('**/api/tmux/targets', route => route.fulfill({ json: available ? targets('self') : { available: false, servers: [] } }));
  await page.evaluate(() => fixtureApp.features.newSessionController.open());
  await expect(page.locator('#newSessionTargetWrap')).toBeVisible();
  await page.locator('#newSessionTarget').focus();
  await page.evaluate(() => { window.retiredTargetRow = document.querySelector('#spawnTargetDropdown .cwd-option:last-child'); });
  available = false;
  await page.evaluate(async () => {
    await fixtureApp.features.newSessionController.targets.load();
    window.retiredTargetRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await expect(page.locator('#newSessionTargetWrap')).toBeHidden();
  expect(await page.evaluate(() => fixtureApp.features.newSessionController.selectedTarget())).toBeNull();
});
