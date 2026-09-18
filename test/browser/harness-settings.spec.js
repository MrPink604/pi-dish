// Generated test/tool from test/browser/harness-settings.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const fixtures_js_1 = require("./fixtures.js");
const model = { id: 'model', provider: 'fixture', name: 'Model', reasoning: true, thinking: ['high'] };
const agents = { agents: [{ name: 'scout', model: '@smol' }, { name: 'constructor', model: '@smol' }],
    globalSettings: { disabled: [], modelOverrides: {}, prewalk: {}, advisor: {} }, settings: { disabled: [] } };
async function routes(page) {
    await page.route('**/api/harnesses/omp/config?*', (route) => route.fulfill({ json: {
            defaultModel: new URL(route.request().url()).searchParams.get('cwd'),
            globalModelRoles: { smol: 'fixture/model', constructor: 'fixture/model' }, modelRoles: {},
        } }));
    await page.route('**/api/harnesses/omp/agents?*', (route) => route.fulfill({ json: agents }));
    await page.route('**/api/models?*', (route) => route.fulfill({ json: [model] }));
}
async function open(page, host, cwd) {
    await page.evaluate(({ hostId, cwd }) => fixtureApp.features.harnessSettingsController.open({ hostId, harnessId: 'omp', label: cwd, cwd }), { hostId: host.hostId, cwd });
    await (0, fixtures_js_1.expect)(page.locator('#harnessSettingsDefaults')).toContainText(cwd);
}
(0, fixtures_js_1.test)('late settings reads cannot overwrite a newly opened host and custom prototype names stay literal', async ({ page, fleet }) => {
    await routes(page);
    let held;
    await page.route(`${fleet.self.base}/api/harnesses/omp/config?*`, route => { held = route; });
    await page.evaluate(hostId => { window.oldSettings = fixtureApp.features.harnessSettingsController.open({ hostId, harnessId: 'omp', cwd: '/old', label: 'Old' }); }, fleet.self.hostId);
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await open(page, fleet.peer, '/peer');
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { defaultModel: 'old-response', globalModelRoles: {} } });
    await page.evaluate(() => window.oldSettings);
    await (0, fixtures_js_1.expect)(page.locator('#harnessSettingsDefaults')).toContainText('/peer');
    await (0, fixtures_js_1.expect)(page.locator('.hs-agent-model[data-agent="constructor"]')).toHaveValue('');
    await page.locator('#hsTabModels').click();
    await (0, fixtures_js_1.expect)(page.locator('.model-role-select[data-role="constructor"]')).toHaveValue('fixture/model');
    await (0, fixtures_js_1.expect)(page.locator('.model-role-row[data-role="constructor"] .model-role-override')).toHaveCount(0);
});
for (const resultStatus of [200, 500])
    (0, fixtures_js_1.test)(`submitted settings keep their endpoint and ${resultStatus} completion leaves a replacement modal open`, async ({ page, fleet }) => {
        await routes(page);
        await open(page, fleet.self, '/self');
        await page.locator('.hs-agent-enabled[data-agent="scout"]').uncheck();
        await page.locator('#hsTabModels').click();
        await page.selectOption('.model-role-select[data-role="smol"]', '');
        const writes = [];
        await page.route(/\/api\/harnesses\/omp\/(agents|model-roles)$/, route => { writes.push(route); });
        await page.evaluate(() => { window.oldSave = fixtureApp.features.harnessSettingsController.save(); });
        await fixtures_js_1.expect.poll(() => writes.length).toBe(1);
        await page.evaluate(() => fixtureApp.features.harnessSettingsController.close());
        await open(page, fleet.peer, '/peer');
        await writes[0].fulfill({ json: { ok: true } });
        await fixtures_js_1.expect.poll(() => writes.length).toBe(2);
        const payloads = writes.map(write => {
            (0, fixtures_js_1.expect)(new URL(write.request().url()).origin).toBe(fleet.self.base);
            const payload = write.request().postDataJSON();
            if (!(0, wire_protocol_js_1.isRecord)(payload))
                throw new Error('Invalid harness settings request');
            (0, fixtures_js_1.expect)(payload.cwd).toBe('/self');
            return payload;
        });
        (0, fixtures_js_1.expect)(payloads[0]?.agents).toEqual({ scout: { disabled: true } });
        (0, fixtures_js_1.expect)(payloads[1]?.roles).toEqual({ smol: null });
        await writes[1].fulfill({ status: resultStatus, json: { ok: resultStatus === 200, error: 'old-view failure' } });
        await page.evaluate(() => window.oldSave);
        await (0, fixtures_js_1.expect)(page.locator('#harnessSettingsModal')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#harnessSettingsTitle')).toHaveText('/peer settings');
        await (0, fixtures_js_1.expect)(page.locator('#modelRolesSave')).toBeEnabled();
        await (0, fixtures_js_1.expect)(page.locator('#modelRolesError')).toHaveText('');
    });
(0, fixtures_js_1.test)('settings stop at the first failed patch and keep current changes editable', async ({ page, fleet }) => {
    await routes(page);
    await open(page, fleet.self, '/self');
    await page.locator('.hs-agent-enabled[data-agent="constructor"]').uncheck();
    await page.locator('#hsTabModels').click();
    await page.selectOption('.model-role-select[data-role="smol"]', '');
    const writes = [];
    await page.route(/\/api\/harnesses\/omp\/(agents|model-roles)$/, route => {
        writes.push(route.request().postDataJSON());
        return route.fulfill({ status: 500, json: { error: 'fixture failure' } });
    });
    await page.evaluate(() => fixtureApp.features.harnessSettingsController.save());
    (0, fixtures_js_1.expect)(writes).toEqual([{ agents: { constructor: { disabled: true } }, cwd: '/self' }]);
    await (0, fixtures_js_1.expect)(page.locator('#modelRolesError')).toHaveText('fixture failure');
    await (0, fixtures_js_1.expect)(page.locator('#harnessSettingsModal')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#modelRolesSave')).toBeEnabled();
});
(0, fixtures_js_1.test)('a save completed after the editor closes refreshes its matching takeover defaults', async ({ page, fleet }) => {
    await routes(page);
    await page.route('**/api/harnesses', route => route.fulfill({ json: { harnesses: [
                { id: 'omp', label: 'Oh My Pi', available: true },
            ] } }));
    let modelName = 'before-save', held;
    await page.route('**/api/harnesses/omp/config?*', route => route.fulfill({ json: {
            defaultModel: modelName, globalModelRoles: {}, modelRoles: {},
        } }));
    await page.evaluate(() => { localStorage.setItem('pi-dish-new-harness', 'omp'); fixtureApp.features.newSessionController.open({ cwd: '/save' }); });
    await (0, fixtures_js_1.expect)(page.locator('#nsHarnessConfigValues')).toContainText('before-save');
    await page.locator('#nsEditAgents').click();
    await (0, fixtures_js_1.expect)(page.locator('.hs-agent-enabled[data-agent="scout"]')).toBeChecked();
    await page.locator('.hs-agent-enabled[data-agent="scout"]').uncheck();
    await page.route('**/api/harnesses/omp/agents', route => { held = route; });
    await page.evaluate(() => { window.closedSave = fixtureApp.features.harnessSettingsController.save(); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => fixtureApp.features.harnessSettingsController.close());
    await (0, fixtures_js_1.expect)(page.locator('#harnessSettingsModal')).toBeHidden();
    modelName = 'after-save';
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { ok: true } });
    await page.evaluate(() => window.closedSave);
    await (0, fixtures_js_1.expect)(page.locator('#nsHarnessConfigValues')).toContainText('after-save');
    await (0, fixtures_js_1.expect)(page.locator('#harnessSettingsModal')).toBeHidden();
});
