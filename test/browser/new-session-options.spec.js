const { test, expect } = require('./fixtures');
async function setup(page) {
  await page.route('**/api/harnesses', route => route.fulfill({ json: { harnesses: [
    { id: 'pi', label: 'Pi', available: true }, { id: 'omp', label: 'Oh My Pi', available: true },
  ] } }));
  await page.route('**/api/models?*', route => route.fulfill({ json: [
    { id: 'model', provider: 'fixture', name: 'Model', reasoning: true, thinking: ['high', '<custom>'] },
  ] }));
  await page.route('**/api/harnesses/omp/config?*', route => route.fulfill({ json: { defaultModel: 'ready', modelRoles: { smol: 'fixture/model' } } }));
  await page.evaluate(() => { localStorage.setItem('pi-dish-new-harness', 'omp'); fixtureApp.features.newSessionController.open({ cwd: '/old' }); });
  await expect(page.locator('#nsHarnessConfigValues')).toContainText('ready');
}

test('new-session preference controls use the model ladder and separate harness keys', async ({ page, fleet }) => {
  await setup(page);
  await expect(page.locator('#nsModelSelect')).toContainText('Model');
  await page.selectOption('#nsModelSelect', 'fixture/model');
  await page.selectOption('#nsThinkingSelect', 'high');
  expect(await page.locator('#nsThinkingSelect').inputValue()).toBe('high');
  expect(await page.locator('#nsThinkingSelect custom').count()).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('pi-dish-new-thinking:omp'))).toBe('high');
  await page.route('**/api/models', route => route.fulfill({ json: [{ id: 'simple', provider: 'fixture', name: 'Simple', reasoning: false }] }));
  await page.selectOption('#nsHarnessSelect', 'pi');
  await expect(page.locator('#nsModelSelect')).toContainText('Simple');
  await page.selectOption('#nsModelSelect', 'fixture/simple');
  await expect(page.locator('#nsThinkingSelect')).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('pi-dish-new-model:pi'))).toBe('fixture/simple');
  expect(await page.evaluate(() => localStorage.getItem('pi-dish-new-model:omp'))).toBe('fixture/model');
});

test('a previous cwd config body cannot restore defaults or edit actions during debounce', async ({ page, fleet }) => {
  await setup(page);
  await page.evaluate(() => {
    const read = Response.prototype.json;
    Response.prototype.json = async function () {
      const value = await read.call(this);
      if (this.url.includes('/harnesses/omp/config?cwd=%2Fold')) {
        window.configBodyWaiting = true;
        await new Promise(resolve => { window.releaseConfigBody = resolve; });
      }
      return value;
    };
    window.heldConfig = ((cwd = fixtureApp.features.newSessionController.cwd()) => fixtureApp.features.newSessionController.config.load(cwd))('/old');
  });
  await expect.poll(() => page.evaluate(() => window.configBodyWaiting)).toBe(true);
  await page.evaluate(async () => {
    const input = document.getElementById('newSessionCwd');
    input.value = '/new'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
    window.releaseConfigBody(); await window.heldConfig;
    window.configAfterRetired = { value: fixtureApp.features.newSessionController.config.config,
      display: document.getElementById('nsEditAgents').style.display,
      text: document.getElementById('nsHarnessConfigValues').textContent };
  });
  expect(await page.evaluate(() => window.configAfterRetired)).toEqual({ value: null, display: 'none', text: 'Loading…' });
  await expect(page.locator('#nsEditAgents')).toBeVisible();
  expect(await page.evaluate(() => fixtureApp.features.newSessionController.config.config.cwd)).toBe('/new');
});

test('old-host defaults cannot replace the selected peer readout', async ({ page, fleet }) => {
  await setup(page);
  let held;
  await page.route(`${fleet.self.base}/api/harnesses/omp/config?*`, route => { held = route; });
  await page.route(`${fleet.peer.base}/api/harnesses/omp/config?*`, route => route.fulfill({ json: { defaultModel: 'peer' } }));
  await page.evaluate(() => { window.heldConfig = ((cwd = fixtureApp.features.newSessionController.cwd()) => fixtureApp.features.newSessionController.config.load(cwd))(); });
  await expect.poll(() => !!held).toBe(true);
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await expect(page.locator('#nsHarnessConfigValues')).toContainText('peer');
  await held.fulfill({ json: { defaultModel: 'old-self' } });
  await page.evaluate(() => window.heldConfig);
  await expect(page.locator('#nsHarnessConfigValues')).toContainText('peer');
  expect(await page.evaluate(() => fixtureApp.features.newSessionController.config.config.defaultModel)).toBe('peer');
});

test('cwd blur keeps the spawn button under the pointer until mouse-up', async ({ page, fleet }) => {
  await setup(page);
  await expect(page.locator('#nsEditAgents')).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.locator('#newSessionCwd').focus();
  const button = page.locator('#nsSpawnBtn');
  await button.scrollIntoViewIfNeeded();
  const before = await button.boundingBox();
  let sent = false;
  await page.route('**/api/sessions/new', route => { sent = true; return route.fulfill({ status: 400, json: { error: 'fixture stop' } }); });
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.clock.runFor(200); // The 150 ms blur callback runs; the later refresh has not.
  const after = await button.boundingBox();
  expect(after).toEqual(before);
  await page.mouse.up();
  await expect.poll(() => sent).toBe(true);
});
