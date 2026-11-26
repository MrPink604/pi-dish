// Generated test/tool from test/browser/omp-models.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helper_values_js_1 = require("../../lib/helper-values.js");
const fixtures_js_1 = require("./fixtures.js");
const SHA_1 = '1111111111111111111111111111111111111111';
const SHA_2 = '2222222222222222222222222222222222222222';
const SHA_3 = '3333333333333333333333333333333333333333';
async function enableLocalCapability(page, selfBase, enabled) {
    await page.evaluate(({ enabled }) => {
        const self = fixtureApp.features.hostDirectory.self;
        const caps = { ...(self.capabilities || {}) };
        if (enabled)
            caps.ompModels = true;
        else
            delete caps.ompModels;
        fixtureApp.features.hostDirectory.setSelf({
            hostId: self.hostId || 'self-fixture',
            label: typeof self.label === 'string' ? self.label : 'self',
            version: typeof self.version === 'string' ? self.version : '1.0.0',
            capabilities: caps,
        });
    }, { enabled });
    await page.route(`${selfBase}/api/host`, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        if ((0, helper_values_js_1.record)(json) && (0, helper_values_js_1.record)(json.capabilities)) {
            const caps = { ...json.capabilities };
            if (enabled)
                caps.ompModels = true;
            else
                delete caps.ompModels;
            await route.fulfill({ response, json: { ...json, capabilities: caps } });
            return;
        }
        await route.fulfill({ response });
    });
}
async function mockPreview(page, selfBase) {
    await page.route(`${selfBase}/api/omp-models/preview`, (route) => {
        const body = route.request().postDataJSON();
        const patterns = (0, helper_values_js_1.record)(body) && Array.isArray(body.enabledModels) ? body.enabledModels.map(String) : [];
        const models = patterns.flatMap(pattern => {
            if (pattern === 'anthropic/claude-opus-5-5') {
                return [{ provider: 'anthropic', id: 'claude-opus-5-5', name: 'Claude Opus 5.5', selector: 'anthropic/claude-opus-5-5', current: true }];
            }
            if (pattern === 'openai-codex/*') {
                return [
                    { provider: 'openai-codex', id: 'gpt-6-luna', name: 'GPT-6 Luna', selector: 'openai-codex/gpt-6-luna' },
                    { provider: 'openai-codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', selector: 'openai-codex/gpt-5.6-sol' },
                ];
            }
            if (pattern === 'deepseek/*') {
                return [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat', selector: 'deepseek/deepseek-chat' }];
            }
            return [];
        });
        return route.fulfill({
            json: {
                total: models.length,
                truncated: false,
                startupModel: models[0] || null,
                models,
            },
        });
    });
}
for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'phone', width: 390, height: 844 },
]) {
    (0, fixtures_js_1.test)(`OMP model allow-list edit, live preview, review diff, and apply with Mac offline warning (${viewport.name})`, async ({ page, fleet }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await enableLocalCapability(page, fleet.self.base, true);
        await mockPreview(page, fleet.self.base);
        let currentSha = SHA_1;
        let currentList = ['anthropic/claude-opus-5-5', 'openai-codex/*'];
        const dryRunBodies = [];
        const applyBodies = [];
        await page.route(`${fleet.self.base}/api/omp-models`, (route) => route.fulfill({
            json: { available: true, sha: currentSha, enabledModels: currentList, disabledProviders: ['openrouter'] },
        }));
        await page.route(`${fleet.self.base}/api/omp-models/dry-run`, (route) => {
            dryRunBodies.push(route.request().postDataJSON());
            return route.fulfill({
                json: {
                    dryRun: true,
                    sha: currentSha,
                    changed: true,
                    diff: '--- a/home/dot_config/omp/fleet.yml\n+++ b/home/dot_config/omp/fleet.yml\n@@ -1,2 +1,3 @@\n   - anthropic/claude-opus-5-5\n   - openai-codex/*\n+  - deepseek/*\n',
                },
            });
        });
        await page.route(`${fleet.self.base}/api/omp-models/apply`, (route) => {
            const payload = route.request().postDataJSON();
            applyBodies.push(payload);
            currentSha = SHA_2;
            if ((0, helper_values_js_1.record)(payload) && Array.isArray(payload.enabledModels))
                currentList = payload.enabledModels.map(String);
            return route.fulfill({
                json: {
                    sha: SHA_2,
                    unchanged: false,
                    allHostsFailed: false,
                    restartRequired: true,
                    hosts: {
                        beelink: 'ok',
                        desktop: 'ok',
                        'jacobs-macbook-air': 'ssh: Could not resolve hostname jacobs-macbook-air',
                    },
                },
            });
        });
        // Open via global Settings modal
        await page.evaluate(() => fixtureApp.features.displayPreferences.open());
        await (0, fixtures_js_1.expect)(page.locator('#settingsOpenOmpModels')).toBeVisible();
        await page.locator('#settingsOpenOmpModels').click();
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsModal')).toBeVisible();
        // Pinned startup model + read-only disabledProviders + live count
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsStartupPattern')).toHaveText('anthropic/claude-opus-5-5');
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row.pinned .omp-model-pinned-badge')).toContainText('Startup model');
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row.pinned .omp-row-remove')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsDisabledProviders')).toContainText('openrouter');
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsMatchCount')).toHaveText('Matches 3 models');
        // Add pattern -> live preview updates
        await page.locator('#ompModelsAddInput').fill('deepseek/*');
        await page.locator('#ompModelsAddBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsList .omp-model-row')).toHaveCount(3);
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsMatchCount')).toHaveText('Matches 4 models');
        // Test single row match count
        await page.locator('.omp-model-row[data-index="2"] [data-omp-action="test-row"]').click();
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="2"] .omp-row-match')).toHaveText('1 match');
        // Edit & reorder non-pinned rows; entry 1 cannot move above pinned entry 0
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="1"] [data-omp-action="move-up"]')).toBeDisabled();
        await page.locator('.omp-model-row[data-index="2"] [data-omp-action="move-up"]').click();
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="1"] .omp-model-input')).toHaveValue('deepseek/*');
        await page.locator('.omp-model-row[data-index="1"] [data-omp-action="move-down"]').click();
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="2"] .omp-model-input')).toHaveValue('deepseek/*');
        // Review shows diff and enables Apply
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsApply')).toBeDisabled();
        await page.locator('#ompModelsReview').click();
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsDiff')).toContainText('+  - deepseek/*');
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsApply')).toBeEnabled();
        // Phone layout check: zero horizontal page overflow and modal fits within viewport
        if (viewport.name === 'phone') {
            const layout = await page.evaluate(() => {
                const modal = document.querySelector('#ompModelsModal .omp-models-modal');
                const rect = modal ? modal.getBoundingClientRect() : null;
                return {
                    docOverflow: document.documentElement.scrollWidth > window.innerWidth,
                    modalWidth: rect ? Math.round(rect.width) : 0,
                    viewportWidth: window.innerWidth,
                };
            });
            (0, fixtures_js_1.expect)(layout.docOverflow).toBe(false);
            (0, fixtures_js_1.expect)(layout.modalWidth).toBeLessThanOrEqual(layout.viewportWidth);
        }
        // Apply shows per-host results (Mac offline as warning, not error) + restart note
        await page.locator('#ompModelsApply').click();
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsRestartNote')).toContainText('Running OMP sessions need a restart');
        await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="beelink"]')).toHaveAttribute('data-status-kind', 'ok');
        await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="desktop"]')).toHaveAttribute('data-status-kind', 'ok');
        await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="jacobs-macbook-air"]')).toHaveAttribute('data-status-kind', 'warn');
        (0, fixtures_js_1.expect)(dryRunBodies).toEqual([{ base: SHA_1, enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*', 'deepseek/*'] }]);
        (0, fixtures_js_1.expect)(applyBodies).toEqual([{ base: SHA_1, enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*', 'deepseek/*'] }]);
    });
}
(0, fixtures_js_1.test)('policy (exit 2), conflict (exit 3 keeping edits), locked (exit 1 retry), all-hosts-failed (exit 4), and unavailable (501)', async ({ page, fleet }) => {
    await enableLocalCapability(page, fleet.self.base, true);
    await mockPreview(page, fleet.self.base);
    let serverSha = SHA_1;
    let serverList = ['anthropic/claude-opus-5-5', 'openai-codex/*'];
    let dryRunMode = 'policy';
    let applyMode = 'conflict';
    let applyAttempts = 0;
    await page.route(`${fleet.self.base}/api/omp-models`, (route) => route.fulfill({
        json: { available: true, sha: serverSha, enabledModels: serverList, disabledProviders: ['openrouter'] },
    }));
    await page.route(`${fleet.self.base}/api/omp-models/dry-run`, (route) => {
        if (dryRunMode === 'policy') {
            return route.fulfill({
                status: 422,
                json: {
                    error: 'policy',
                    exitCode: 2,
                    reasons: ["entry 3 'openai/*': can match provider 'openai'"],
                },
            });
        }
        return route.fulfill({
            json: { dryRun: true, sha: serverSha, changed: true, diff: '+  - deepseek/*\n' },
        });
    });
    await page.route(`${fleet.self.base}/api/omp-models/apply`, (route) => {
        applyAttempts++;
        if (applyMode === 'conflict') {
            serverSha = SHA_2;
            serverList = ['anthropic/claude-opus-5-5', 'zai/*'];
            applyMode = 'locked';
            return route.fulfill({ status: 409, json: { error: 'conflict', sha: SHA_2, exitCode: 3 } });
        }
        if (applyMode === 'locked') {
            applyMode = 'all-failed';
            return route.fulfill({ status: 423, json: { error: 'locked', retryable: true, exitCode: 1, message: 'another omp-models set holds lock' } });
        }
        if (applyMode === 'all-failed') {
            serverSha = SHA_3;
            applyMode = 'ok';
            return route.fulfill({
                status: 502,
                json: {
                    error: 'all_hosts_failed',
                    committed: true,
                    allHostsFailed: true,
                    exitCode: 4,
                    sha: SHA_3,
                    hosts: { beelink: 'disk full', 'jacobs-macbook-air': 'offline' },
                },
            });
        }
        return route.fulfill({ json: { sha: SHA_3, unchanged: true, hosts: {}, allHostsFailed: false, restartRequired: false } });
    });
    // Open from Harness Settings -> Models tab callout for OMP
    await page.route('**/api/harnesses/omp/config?*', route => route.fulfill({ json: { defaultModel: 'anthropic/claude-opus-5-5', globalModelRoles: {}, modelRoles: {} } }));
    await page.route('**/api/harnesses/omp/agents?*', route => route.fulfill({ json: { agents: [], globalSettings: { disabled: [], modelOverrides: {}, prewalk: {}, advisor: {} }, settings: null } }));
    await page.route('**/api/models?*', route => route.fulfill({ json: [] }));
    await page.route('**/api/harnesses/omp/settings?*', route => route.fulfill({ status: 501, json: { error: 'none' } }));
    await page.evaluate(hostId => fixtureApp.features.harnessSettingsController.open({ hostId, harnessId: 'omp', cwd: '/work', label: 'Oh My Pi', tab: 'models' }), fleet.self.hostId);
    await (0, fixtures_js_1.expect)(page.locator('#hsOpenOmpModels')).toBeVisible();
    await page.locator('#hsOpenOmpModels').click();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsModal')).toBeVisible();
    // Exit 2 policy: shows verbatim reasons[]
    await page.locator('#ompModelsAddInput').fill('openai/*');
    await page.locator('#ompModelsAddBtn').click();
    await page.locator('#ompModelsReview').click();
    await (0, fixtures_js_1.expect)(page.locator('.omp-policy-reasons')).toContainText("entry 3 'openai/*': can match provider 'openai'");
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsApply')).toBeDisabled();
    // Fix entry to deepseek/*, Review succeeds
    dryRunMode = 'ok';
    await page.locator('.omp-model-row[data-index="2"] .omp-model-input').fill('deepseek/*');
    await page.locator('#ompModelsReview').click();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsApply')).toBeEnabled();
    // Exit 3 conflict: shows changed elsewhere, reloads SHA_2, keeps user's draft edits!
    await page.locator('#ompModelsApply').click();
    await (0, fixtures_js_1.expect)(page.locator('.omp-models-banner')).toContainText('changed elsewhere');
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsSha')).toContainText(SHA_2.slice(0, 7));
    await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="2"] .omp-model-input')).toHaveValue('deepseek/*');
    // Review again against SHA_2, then Apply hits exit 1 locked -> Retry button retries apply -> hits exit 4 all-hosts-failed
    await page.locator('#ompModelsReview').click();
    await page.locator('#ompModelsApply').click();
    await (0, fixtures_js_1.expect)(page.locator('.omp-models-banner')).toContainText('holds lock');
    await (0, fixtures_js_1.expect)(page.locator('.omp-banner-retry')).toBeVisible();
    const attemptsBeforeRetry = applyAttempts;
    await page.locator('.omp-banner-retry').click();
    (0, fixtures_js_1.expect)(applyAttempts).toBe(attemptsBeforeRetry + 1);
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsApplyResult')).toContainText('deployment failed on every host');
    await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="jacobs-macbook-air"]')).toHaveAttribute('data-status-kind', 'error');
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsSha')).toContainText(SHA_3.slice(0, 7));
    // Missing helper (501) reports unavailable cleanly
    await page.unroute(`${fleet.self.base}/api/omp-models`);
    await page.route(`${fleet.self.base}/api/omp-models`, (route) => route.fulfill({
        status: 501,
        json: { available: false, error: 'unavailable', message: 'OMP model allow-list management is unavailable on this host.' },
    }));
    await page.locator('#ompModelsReload').click();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsUnavailable')).toContainText('unavailable on this host');
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsFooter')).toBeHidden();
});
(0, fixtures_js_1.test)('HTML/JS and CSS version skew never break Settings or OMP allow-list editor', async ({ page, fleet }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    await enableLocalCapability(page, fleet.self.base, false);
    // Settings modal shows "Unavailable on this host" when capability is absent
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await (0, fixtures_js_1.expect)(page.locator('#settingsOmpModels')).toContainText('Unavailable on this host');
    await page.evaluate(() => fixtureApp.features.displayPreferences.close());
    // Simulate old cached HTML (no pre-existing #ompModelsModal) + old cached CSS (strip .omp-models-* rules)
    await enableLocalCapability(page, fleet.self.base, true);
    await mockPreview(page, fleet.self.base);
    await page.route(`${fleet.self.base}/api/omp-models`, (route) => route.fulfill({
        json: { available: true, sha: SHA_1, enabledModels: ['anthropic/claude-opus-5-5'], disabledProviders: [] },
    }));
    await page.evaluate(() => {
        document.getElementById('ompModelsModal')?.remove();
        for (const sheet of Array.from(document.styleSheets)) {
            let rules;
            try {
                rules = sheet.cssRules;
            }
            catch {
                continue;
            }
            for (let i = rules.length - 1; i >= 0; i--) {
                if (/omp-models|omp-model|hs-omp-allowlist/.test(rules[i].cssText))
                    sheet.deleteRule(i);
            }
        }
    });
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await (0, fixtures_js_1.expect)(page.locator('#settingsOpenOmpModels')).toBeVisible();
    await page.locator('#settingsOpenOmpModels').click();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsModal')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsStartupPattern')).toHaveText('anthropic/claude-opus-5-5');
    (0, fixtures_js_1.expect)(pageErrors).toEqual([]);
});
