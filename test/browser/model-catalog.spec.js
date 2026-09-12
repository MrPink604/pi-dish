const { test, expect, ROOT } = require('./fixtures');
const models = id => [{ id, provider: 'fixture', name: id, enabled: true }];
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
    Response.prototype.json = async function() {
      const data = await read.call(this);
      if (this.url === url) {
        window.modelBodyWaiting = true;
        await new Promise(resolve => { window.releaseModelBody = resolve; });
      }
      return data;
    };
  }, url);
}

test('new-session model responses stay with their selected host', async ({ page, fleet }) => {
  const held = [];
  await page.route('**/api/models', route => new URL(route.request().url()).origin === fleet.peer.base
    ? route.fulfill({ json: models('peer') }) : held.push(route));
  await trackLoads(page);
  await page.evaluate(() => fixtureApp.features.newSessionController.open());
  await expect.poll(() => held.length).toBe(1);
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await expect(page.locator('#nsModelSelect')).toContainText('peer');
  await held[0].fulfill({ json: models('self-old') });
  await page.evaluate(() => window.modelLoads[0]);
  await expect(page.locator('#nsModelSelect')).not.toContainText('self-old');
  expect(await page.evaluate(() => fixtureApp.features.modelCatalog.rows().map(row => row.id))).toEqual(['peer']);
});

test('a model body for a previous cwd cannot publish during the next refresh debounce', async ({ page, fleet }) => {
  const url = `${fleet.self.base}/api/models`;
  await page.route(url, route => route.fulfill({ json: models('ready') }));
  await page.evaluate(() => fixtureApp.features.newSessionController.open({ cwd: '/old' }));
  await expect(page.locator('#nsModelSelect')).toContainText('ready');
  await holdBody(page, url);
  await page.route(url, route => route.fulfill({ json: models('retired') }));
  await trackLoads(page);
  await page.evaluate(() => { void fixtureApp.features.appModels.load(undefined, 'pi', '/old', fixtureApp.features.newSessionController.hostId()); });
  await expect.poll(() => page.evaluate(() => window.modelBodyWaiting)).toBe(true);
  await page.evaluate(async () => {
    const input = document.getElementById('newSessionCwd');
    input.value = '/new';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.releaseModelBody();
    await window.modelLoads[0];
  });
  expect(await page.evaluate(() => fixtureApp.features.modelCatalog.rows().map(row => row.id))).toEqual(['ready']);
});

test('closing a model-owning takeover retires its body without replacing a session catalog', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const url = `${fleet.self.base}/api/models`;
  await holdBody(page, url);
  await page.route(url, route => route.fulfill({ json: models('retired-new-session') }));
  await page.route(`${fleet.self.base}/api/models?sessionId=${ROOT}`, route => route.fulfill({ json: models('session') }));
  await trackLoads(page);
  await page.evaluate(() => fixtureApp.features.newSessionController.open());
  await expect.poll(() => page.evaluate(() => window.modelBodyWaiting)).toBe(true);
  await page.evaluate(async () => {
    fixtureApp.features.newSessionController.close();
    await fixtureApp.features.appModels.load(fixtureApp.features.sessionState.currentSession.id, 'pi');
    window.releaseModelBody();
    await window.modelLoads[0];
  });
  expect(await page.evaluate(() => fixtureApp.features.modelCatalog.rows().map(row => row.id))).toEqual(['session']);
});

test('new-session cached catalogs use the selected peer key', async ({ page, fleet }) => {
  const held = [];
  await page.route('**/api/harnesses', route => held.push(route));
  await page.evaluate(peer => {
    fixtureApp.features.newSessionController.setHostId(peer);
    localStorage.setItem('pi-dish-new-harness', 'pi');
    localStorage.setItem('pi-dish-models-cache', JSON.stringify([{ id: 'self-cache', provider: 'fixture' }]));
    localStorage.setItem('pi-dish-models-cache@' + peer, JSON.stringify([{ id: 'peer-cache', provider: 'fixture' }]));
    fixtureApp.features.newSessionController.open();
  }, fleet.peer.hostId);
  await expect(page.locator('#nsModelSelect')).toContainText('peer-cache');
  await expect(page.locator('#nsModelSelect')).not.toContainText('self-cache');
  for (const route of held) await route.fulfill({ json: [{ id: 'pi', available: true }] });
});

test('a catalog retired by host renewal cannot clear the server-local enabled-model scope', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route(`${fleet.self.base}/api/models?sessionId=${ROOT}`, route => route.fulfill({ json: [
    { id: 'enabled', provider: 'fixture', enabled: true }, { id: 'hidden', provider: 'fixture', enabled: false },
  ] }));
  await page.evaluate(async () => { await fixtureApp.features.appModels.load(fixtureApp.features.sessionState.currentSession.id, 'pi'); });
  const payloads = [];
  await page.route('**/api/models/enabled', route => {
    payloads.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, enabledModels: null } });
  });
  const timersScheduled = await page.evaluate(() => {
    const original = window.setTimeout;
    let saves = 0;
    window.setTimeout = (callback, delay, ...args) => { if (delay === 400) saves++; return original(callback, delay, ...args); };
    try {
      const resolve = fixtureApp.features.hostDirectory.entryFor;
      fixtureApp.features.hostDirectory.entryFor = host => { const entry = resolve(host); return entry ? { ...entry, token: 'renewed-fixture' } : entry; };
      fixtureApp.features.sessionControls.setAll(true);
      return saves;
    } finally { window.setTimeout = original; }
  });
  expect(timersScheduled).toBe(0);
  expect(payloads).toEqual([]);
  expect(await page.evaluate(() => fixtureApp.features.modelCatalog.enabledIds())).toBeUndefined();
});
