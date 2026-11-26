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
async function mockIdleApplyStatus(page, selfBase) {
    await page.route(`${selfBase}/api/omp-models/apply-status`, (route) => route.fulfill({
        json: { state: 'idle' },
    }));
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
        await mockIdleApplyStatus(page, fleet.self.base);
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
        await page.evaluate(() => fixtureApp.features.displayPreferences.open());
        await (0, fixtures_js_1.expect)(page.locator('#settingsOpenOmpModels')).toBeVisible();
        await page.locator('#settingsOpenOmpModels').click();
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsModal')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsStartupPattern')).toHaveText('anthropic/claude-opus-5-5');
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row.pinned .omp-model-pinned-badge')).toContainText('Startup model');
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row.pinned .omp-row-remove')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsDisabledProviders')).toContainText('openrouter');
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsMatchCount')).toHaveText('Matches 3 models');
        await page.locator('#ompModelsAddInput').fill('deepseek/*');
        await page.locator('#ompModelsAddBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsList .omp-model-row')).toHaveCount(3);
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsMatchCount')).toHaveText('Matches 4 models');
        await page.locator('.omp-model-row[data-index="2"] [data-omp-action="test-row"]').click();
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="2"] .omp-row-match')).toHaveText('1 match');
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="1"] [data-omp-action="move-up"]')).toBeDisabled();
        await page.locator('.omp-model-row[data-index="2"] [data-omp-action="move-up"]').click();
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="1"] .omp-model-input')).toHaveValue('deepseek/*');
        await page.locator('.omp-model-row[data-index="1"] [data-omp-action="move-down"]').click();
        await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="2"] .omp-model-input')).toHaveValue('deepseek/*');
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsApply')).toBeDisabled();
        await page.locator('#ompModelsReview').click();
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsDiff')).toContainText('+  - deepseek/*');
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsApply')).toBeEnabled();
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
        await page.locator('#ompModelsApply').click();
        await (0, fixtures_js_1.expect)(page.locator('#ompModelsRestartNote')).toContainText('Running OMP sessions need a restart');
        await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="beelink"]')).toHaveAttribute('data-status-kind', 'ok');
        await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="desktop"]')).toHaveAttribute('data-status-kind', 'ok');
        await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="jacobs-macbook-air"]')).toHaveAttribute('data-status-kind', 'warn');
        (0, fixtures_js_1.expect)(dryRunBodies).toEqual([{ base: SHA_1, enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*', 'deepseek/*'] }]);
        (0, fixtures_js_1.expect)(applyBodies).toEqual([{ base: SHA_1, enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*', 'deepseek/*'] }]);
    });
}
(0, fixtures_js_1.test)('policy (exit 2), conflict (exit 3 + failed reload Retry keeps draft), locked (exit 1), Mac non-connectivity failure, unknown outcome, and 501', async ({ page, fleet }) => {
    await enableLocalCapability(page, fleet.self.base, true);
    await mockIdleApplyStatus(page, fleet.self.base);
    await mockPreview(page, fleet.self.base);
    let serverSha = SHA_1;
    let serverList = ['anthropic/claude-opus-5-5', 'openai-codex/*'];
    let getCount = 0;
    let failNextConflictGet = false;
    let heldGet = null;
    let holdNextGet = false;
    let dryRunMode = 'policy';
    let applyMode = 'conflict';
    let applyAttempts = 0;
    await page.route(`${fleet.self.base}/api/omp-models`, (route) => {
        getCount++;
        if (holdNextGet) {
            holdNextGet = false;
            heldGet = route;
            return;
        }
        if (failNextConflictGet) {
            failNextConflictGet = false;
            return route.fulfill({ status: 502, json: { error: 'fetch', message: 'temporary git fetch failure' } });
        }
        return route.fulfill({
            json: { available: true, sha: serverSha, enabledModels: serverList, disabledProviders: ['openrouter'] },
        });
    });
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
            failNextConflictGet = true;
            applyMode = 'locked';
            return route.fulfill({ status: 409, json: { error: 'conflict', sha: SHA_2, exitCode: 3 } });
        }
        if (applyMode === 'locked') {
            applyMode = 'mac-auth-fail';
            return route.fulfill({ status: 423, json: { error: 'locked', retryable: true, exitCode: 1, message: 'another omp-models set holds lock' } });
        }
        if (applyMode === 'mac-auth-fail') {
            serverSha = SHA_3;
            applyMode = 'unknown';
            // Non-connectivity error on jacobs-macbook-air must classify as error, NOT offline warning
            return route.fulfill({
                json: {
                    sha: SHA_3,
                    unchanged: false,
                    allHostsFailed: false,
                    restartRequired: true,
                    hosts: { beelink: 'ok', 'jacobs-macbook-air': 'Permission denied (publickey)' },
                },
            });
        }
        return route.fulfill({
            status: 502,
            json: {
                error: 'unknown_outcome',
                unknownOutcome: true,
                retryable: false,
                message: 'Unknown outcome: reload the list and check the fleet-config log.',
            },
        });
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
    // Exit 3 conflict whose reload fails first -> Retry must keep draft AND disable controls while GET is in flight!
    await page.locator('#ompModelsApply').click();
    await (0, fixtures_js_1.expect)(page.locator('.omp-models-banner')).toContainText('temporary git fetch failure');
    await (0, fixtures_js_1.expect)(page.locator('.omp-banner-retry')).toHaveAttribute('data-omp-retry', 'reload-keep-draft');
    await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="2"] .omp-model-input')).toHaveValue('deepseek/*');
    holdNextGet = true;
    await page.locator('.omp-banner-retry').click();
    await fixtures_js_1.expect.poll(() => !!heldGet).toBe(true);
    await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="2"] .omp-model-input')).toBeDisabled();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsReload')).toBeDisabled();
    await (0, fixtures_js_1.requiredRoute)(heldGet).fulfill({
        json: { available: true, sha: serverSha, enabledModels: serverList, disabledProviders: ['openrouter'] },
    });
    await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="2"] .omp-model-input')).toBeEnabled();
    await (0, fixtures_js_1.expect)(page.locator('.omp-model-row[data-index="2"] .omp-model-input')).toHaveValue('deepseek/*');
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsSha')).toContainText(SHA_2.slice(0, 7));
    await (0, fixtures_js_1.expect)(page.locator('.omp-models-banner')).not.toContainText('temporary git fetch failure');
    await (0, fixtures_js_1.expect)(page.locator('.omp-models-banner')).toContainText('kept your edits');
    await (0, fixtures_js_1.expect)(page.locator('.omp-banner-retry')).toHaveCount(0);
    // Review again against SHA_2, Apply hits locked -> Retry hits Mac non-connectivity failure -> classified as 'error' (not 'warn')
    await page.locator('#ompModelsReview').click();
    await page.locator('#ompModelsApply').click();
    await (0, fixtures_js_1.expect)(page.locator('.omp-models-banner')).toContainText('holds lock');
    const attemptsBeforeRetry = applyAttempts;
    await page.locator('.omp-banner-retry').click();
    (0, fixtures_js_1.expect)(applyAttempts).toBe(attemptsBeforeRetry + 1);
    await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="jacobs-macbook-air"]')).toHaveAttribute('data-status-kind', 'error');
    // Unknown outcome on apply shows guidance with NO retry button
    await page.locator('#ompModelsAddInput').fill('zai/*');
    await page.locator('#ompModelsAddBtn').click();
    await page.locator('#ompModelsReview').click();
    await page.locator('#ompModelsApply').click();
    await (0, fixtures_js_1.expect)(page.locator('.omp-models-banner')).toContainText('Unknown outcome: reload the list and check the fleet-config log.');
    await (0, fixtures_js_1.expect)(page.locator('.omp-banner-retry')).toHaveCount(0);
    // Missing helper (501) reports unavailable cleanly
    await page.unroute(`${fleet.self.base}/api/omp-models`);
    await page.route(`${fleet.self.base}/api/omp-models`, (route) => route.fulfill({
        status: 501,
        json: { available: false, error: 'unavailable', message: 'OMP model allow-list management is unavailable on this host.' },
    }));
    await page.locator('#ompModelsReload').click();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsUnavailable')).toContainText('unavailable on this host');
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsFooter')).toBeHidden();
    (0, fixtures_js_1.expect)(getCount).toBeGreaterThanOrEqual(3);
});
(0, fixtures_js_1.test)('closing modal during an in-flight 202 Apply preserves the result on reopen via apply-status, and stale previews never publish after edits', async ({ page, fleet }) => {
    await enableLocalCapability(page, fleet.self.base, true);
    let heldPreview = null;
    let previewCount = 0;
    await page.route(`${fleet.self.base}/api/omp-models/preview`, (route) => {
        previewCount++;
        if (previewCount === 1) {
            heldPreview = route;
            return;
        }
        return route.fulfill({
            json: { total: 4, truncated: false, startupModel: null, models: [] },
        });
    });
    let applyStatusPayload = { state: 'idle' };
    let currentSha = SHA_1;
    let currentList = ['anthropic/claude-opus-5-5', 'openai-codex/*'];
    await page.route(`${fleet.self.base}/api/omp-models`, (route) => route.fulfill({
        json: { available: true, sha: currentSha, enabledModels: currentList, disabledProviders: ['openrouter'] },
    }));
    await page.route(`${fleet.self.base}/api/omp-models/apply-status`, (route) => route.fulfill({
        json: applyStatusPayload,
    }));
    await page.route(`${fleet.self.base}/api/omp-models/dry-run`, (route) => route.fulfill({
        json: { dryRun: true, sha: currentSha, changed: true, diff: '+  - deepseek/*\n' },
    }));
    await page.route(`${fleet.self.base}/api/omp-models/apply`, (route) => {
        applyStatusPayload = { state: 'running', startedAt: Date.now(), base: currentSha };
        return route.fulfill({ status: 202, json: applyStatusPayload });
    });
    await page.evaluate(() => fixtureApp.features.ompModelsController.open());
    await fixtures_js_1.expect.poll(() => !!heldPreview).toBe(true);
    // Edit the draft BEFORE the first preview finishes (within the debounce window)
    await page.locator('#ompModelsAddInput').fill('deepseek/*');
    await page.locator('#ompModelsAddBtn').click();
    // First preview finishes late with a stale count (999) -> MUST be ignored, never published!
    await (0, fixtures_js_1.requiredRoute)(heldPreview).fulfill({
        json: { total: 999, truncated: false, startupModel: null, models: [] },
    });
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsMatchCount')).not.toContainText('999');
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsMatchCount')).toHaveText('Matches 4 models');
    // Review -> Apply returns 202 running -> close modal with Escape
    await page.locator('#ompModelsReview').click();
    await page.locator('#ompModelsApply').click();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsApply')).toHaveText('Applying…');
    await page.keyboard.press('Escape');
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsModal')).toBeHidden();
    // Server finishes apply while modal is closed
    currentSha = SHA_2;
    currentList = ['anthropic/claude-opus-5-5', 'openai-codex/*', 'deepseek/*'];
    applyStatusPayload = {
        state: 'done',
        startedAt: Date.now() - 500,
        finishedAt: Date.now(),
        base: SHA_1,
        result: {
            status: 200,
            body: {
                sha: SHA_2,
                unchanged: false,
                allHostsFailed: false,
                restartRequired: true,
                hosts: { beelink: 'ok', 'jacobs-macbook-air': 'Connection timed out' },
            },
        },
    };
    // Reopen modal -> immediately displays the completed result from apply-status!
    await page.evaluate(() => fixtureApp.features.ompModelsController.open());
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsRestartNote')).toContainText('Running OMP sessions need a restart');
    await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="beelink"]')).toHaveAttribute('data-status-kind', 'ok');
    await (0, fixtures_js_1.expect)(page.locator('.omp-host-row[data-host="jacobs-macbook-air"]')).toHaveAttribute('data-status-kind', 'warn');
});
(0, fixtures_js_1.test)('HTML/JS and old CSS version skew at 390x844 keeps Review reachable with 46 rows and zero page errors', async ({ page, fleet }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    await enableLocalCapability(page, fleet.self.base, false);
    await mockIdleApplyStatus(page, fleet.self.base);
    // Settings modal shows "Unavailable on this host" when capability is absent
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await (0, fixtures_js_1.expect)(page.locator('#settingsOmpModels')).toContainText('Unavailable on this host');
    await page.evaluate(() => fixtureApp.features.displayPreferences.close());
    // Simulate old cached HTML (no pre-existing #ompModelsModal) + old cached CSS (strip ALL new OMP rules) with 46 rows!
    await enableLocalCapability(page, fleet.self.base, true);
    await mockPreview(page, fleet.self.base);
    const fortySix = [
        'anthropic/claude-opus-5-5',
        ...Array.from({ length: 45 }, (_, i) => `provider-${i}/model-*`),
    ];
    await page.route(`${fleet.self.base}/api/omp-models`, (route) => route.fulfill({
        json: { available: true, sha: SHA_1, enabledModels: fortySix, disabledProviders: ['openrouter'] },
    }));
    await page.route(`${fleet.self.base}/api/omp-models/dry-run`, (route) => route.fulfill({
        json: { dryRun: true, sha: SHA_1, changed: true, diff: '+  - deepseek/*\n' },
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
                if (/omp-models|omp-model|hs-omp-allowlist|omp-row|omp-diff|omp-host|omp-banner|omp-disabled|omp-preview|omp-match|omp-policy|omp-restart/.test(rules[i].cssText)) {
                    sheet.deleteRule(i);
                }
            }
        }
    });
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    await (0, fixtures_js_1.expect)(page.locator('#settingsOpenOmpModels')).toBeVisible();
    await page.locator('#settingsOpenOmpModels').click();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsModal')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsList .omp-model-row')).toHaveCount(46);
    // Review button MUST be inside the 390x844 viewport and clickable even without any new CSS rules!
    const reviewBox = await page.locator('#ompModelsReview').boundingBox();
    (0, fixtures_js_1.expect)(reviewBox).not.toBeNull();
    (0, fixtures_js_1.expect)(reviewBox.y + reviewBox.height).toBeLessThanOrEqual(844);
    (0, fixtures_js_1.expect)(reviewBox.x + reviewBox.width).toBeLessThanOrEqual(390);
    await page.locator('#ompModelsReview').click();
    await (0, fixtures_js_1.expect)(page.locator('#ompModelsDiff')).toContainText('+  - deepseek/*');
    (0, fixtures_js_1.expect)(pageErrors).toEqual([]);
});
