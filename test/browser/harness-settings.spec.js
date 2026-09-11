const { test, expect } = require('./fixtures');
const model = { id: 'model', provider: 'fixture', name: 'Model', reasoning: true, thinking: ['high'] };
const agents = { agents: [{ name: 'scout', model: '@smol' }, { name: 'constructor', model: '@smol' }],
  globalSettings: { disabled: [], modelOverrides: {}, prewalk: {}, advisor: {} }, settings: { disabled: [] } };
async function routes(page) {
  await page.route('**/api/harnesses/omp/config?*', route => route.fulfill({ json: {
    defaultModel: new URL(route.request().url()).searchParams.get('cwd'),
    globalModelRoles: { smol: 'fixture/model', constructor: 'fixture/model' }, modelRoles: {},
  } }));
  await page.route('**/api/harnesses/omp/agents?*', route => route.fulfill({ json: agents }));
  await page.route('**/api/models?*', route => route.fulfill({ json: [model] }));
}
async function open(page, host, cwd) {
  await page.evaluate(({ hostId, cwd }) => openHarnessSettings({ hostId, harnessId: 'omp', label: cwd, cwd }), { hostId: host.hostId, cwd });
  await expect(page.locator('#harnessSettingsDefaults')).toContainText(cwd);
}

test('late settings reads cannot overwrite a newly opened host and custom prototype names stay literal', async ({ page, fleet }) => {
  await routes(page);
  let held;
  await page.route(`${fleet.self.base}/api/harnesses/omp/config?*`, route => { held = route; });
  await page.evaluate(hostId => { window.oldSettings = openHarnessSettings({ hostId, cwd: '/old', label: 'Old' }); }, fleet.self.hostId);
  await expect.poll(() => !!held).toBe(true);
  await open(page, fleet.peer, '/peer');
  await held.fulfill({ json: { defaultModel: 'old-response', globalModelRoles: {} } });
  await page.evaluate(() => window.oldSettings);
  await expect(page.locator('#harnessSettingsDefaults')).toContainText('/peer');
  await expect(page.locator('.hs-agent-model[data-agent="constructor"]')).toHaveValue('');
  await page.locator('#hsTabModels').click();
  await expect(page.locator('.model-role-select[data-role="constructor"]')).toHaveValue('fixture/model');
  await expect(page.locator('.model-role-row[data-role="constructor"] .model-role-override')).toHaveCount(0);
});

for (const resultStatus of [200, 500]) test(`submitted settings keep their endpoint and ${resultStatus} completion leaves a replacement modal open`, async ({ page, fleet }) => {
  await routes(page);
  await open(page, fleet.self, '/self');
  await page.locator('.hs-agent-enabled[data-agent="scout"]').uncheck();
  await page.locator('#hsTabModels').click();
  await page.selectOption('.model-role-select[data-role="smol"]', '');
  const writes = [];
  await page.route(/\/api\/harnesses\/omp\/(agents|model-roles)$/, route => { writes.push(route); });
  await page.evaluate(() => { window.oldSave = saveHarnessSettings(); });
  await expect.poll(() => writes.length).toBe(1);
  await page.evaluate(() => closeHarnessSettings());
  await open(page, fleet.peer, '/peer');
  await writes[0].fulfill({ json: { ok: true } });
  await expect.poll(() => writes.length).toBe(2);
  for (const write of writes) {
    expect(new URL(write.request().url()).origin).toBe(fleet.self.base);
    expect(write.request().postDataJSON().cwd).toBe('/self');
  }
  expect(writes[0].request().postDataJSON().agents).toEqual({ scout: { disabled: true } });
  expect(writes[1].request().postDataJSON().roles).toEqual({ smol: null });
  await writes[1].fulfill({ status: resultStatus, json: { ok: resultStatus === 200, error: 'old-view failure' } });
  await page.evaluate(() => window.oldSave);
  await expect(page.locator('#harnessSettingsModal')).toBeVisible();
  await expect(page.locator('#harnessSettingsTitle')).toHaveText('/peer settings');
  await expect(page.locator('#modelRolesSave')).toBeEnabled();
  await expect(page.locator('#modelRolesError')).toHaveText('');
});

test('settings stop at the first failed patch and keep current changes editable', async ({ page, fleet }) => {
  await routes(page);
  await open(page, fleet.self, '/self');
  await page.locator('.hs-agent-enabled[data-agent="constructor"]').uncheck();
  await page.locator('#hsTabModels').click();
  await page.selectOption('.model-role-select[data-role="smol"]', '');
  const writes = [];
  await page.route(/\/api\/harnesses\/omp\/(agents|model-roles)$/, route => {
    writes.push(route.request().postDataJSON()); return route.fulfill({ status: 500, json: { error: 'fixture failure' } });
  });
  await page.evaluate(() => saveHarnessSettings());
  expect(writes).toEqual([{ agents: { constructor: { disabled: true } }, cwd: '/self' }]);
  await expect(page.locator('#modelRolesError')).toHaveText('fixture failure');
  await expect(page.locator('#harnessSettingsModal')).toBeVisible();
  await expect(page.locator('#modelRolesSave')).toBeEnabled();
});

test('a save completed after the editor closes refreshes its matching takeover defaults', async ({ page, fleet }) => {
  await routes(page);
  await page.route('**/api/harnesses', route => route.fulfill({ json: { harnesses: [
    { id: 'omp', label: 'Oh My Pi', available: true },
  ] } }));
  let modelName = 'before-save', held;
  await page.route('**/api/harnesses/omp/config?*', route => route.fulfill({ json: {
    defaultModel: modelName, globalModelRoles: {}, modelRoles: {},
  } }));
  await page.evaluate(() => { localStorage.setItem('pi-dish-new-harness', 'omp'); openNewSessionView({ cwd: '/save' }); });
  await expect(page.locator('#nsHarnessConfigValues')).toContainText('before-save');
  await page.locator('#nsEditAgents').click();
  await expect(page.locator('.hs-agent-enabled[data-agent="scout"]')).toBeChecked();
  await page.locator('.hs-agent-enabled[data-agent="scout"]').uncheck();
  await page.route('**/api/harnesses/omp/agents', route => { held = route; });
  await page.evaluate(() => { window.closedSave = saveHarnessSettings(); });
  await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => closeHarnessSettings());
  await expect(page.locator('#harnessSettingsModal')).toBeHidden();
  modelName = 'after-save';
  await held.fulfill({ json: { ok: true } });
  await page.evaluate(() => window.closedSave);
  await expect(page.locator('#nsHarnessConfigValues')).toContainText('after-save');
  await expect(page.locator('#harnessSettingsModal')).toBeHidden();
});
