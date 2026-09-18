// Generated test/tool from test/ui-scenarios/bounce.ts; edit that source and run npm run build:tests.
"use strict";
const test_types_js_1 = require("../test-types.js");
const bounce = async ({ base, CWD, desktop, check }) => {
    // Bulk restart stays inside Settings rather than replacing the session.
    console.log('bounce agents:');
    const bounceSpawn = await fetch(base + '/api/sessions/new', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harness: 'pi', cwd: CWD, name: 'Bounce smoke' }),
    }).then(async (response) => {
        const body = await response.json();
        if (!response.ok)
            throw new Error(JSON.stringify(body));
        return body;
    });
    let bouncedId = bounceSpawn.id;
    try {
        await desktop.evaluate(() => fixtureApp.features.displayPreferences.open());
        await desktop.click('#openBounceAgents');
        check(await desktop.locator('#settingsModal').isVisible() &&
            await desktop.locator('#settingsModal #bounceMode').isVisible(), 'bounce controls expand inside Settings');
        const bouncePosition = await desktop.locator('#openBounceAgents').boundingBox();
        if (bouncePosition === null)
            throw new Error('Missing bouncePosition');
        const themePosition = await desktop.locator('#settingsTheme').boundingBox();
        if (themePosition === null)
            throw new Error('Missing themePosition');
        check(bouncePosition.y < themePosition.y, 'Bounce agents is at the top of Settings');
        await desktop.click('#openBounceAgents');
        check(!(await desktop.locator('#bounceMode').isVisible()), 'second click collapses bounce controls');
        await desktop.click('#openBounceAgents');
        await desktop.waitForSelector('#bounceMode', { state: 'visible' });
        await desktop.selectOption('#bounceMode', 'restart');
        const bounceTarget = desktop.locator('.bounce-target').filter({ hasText: 'Bounce smoke' });
        await bounceTarget.locator('input').check();
        await desktop.click('#bounceSubmit');
        await desktop.waitForSelector('.bounce-result[data-status="completed"]', { timeout: 15000 });
        const bounceBody = (0, test_types_js_1.record)(await fetch(base + '/api/session-bounces').then(response => response.json()));
        const bounced = (0, test_types_js_1.records)(bounceBody.operations).flatMap(operation => (0, test_types_js_1.records)(operation.targets))
            .find(target => target.sessionId === bounceSpawn.id);
        check(bounced?.status === 'completed', 'Bounce agents completes the selected owned RPC restart');
        if (!bounced)
            throw new Error('Bounce operation did not include the requested session');
        bouncedId = bounced.replacementId || bouncedId;
        await desktop.evaluate(() => fixtureApp.features.displayPreferences.open());
        await desktop.click('#openRecoveryReport');
        check(!(await desktop.locator('#settingsModal').isVisible()) &&
            !(await desktop.locator('#bounceMode').isVisible()), 'opening recovery closes Settings and its bounce controls');
        await desktop.evaluate(() => fixtureApp.features.displayPreferences.open());
        await desktop.click('#openBounceAgents');
        check(await desktop.locator('#settingsModal #bounceMode').isVisible(), 'bounce controls reopen in Settings over the current view');
        await desktop.keyboard.press('Escape');
        check(!(await desktop.locator('#settingsModal').isVisible()), 'Escape closes Settings and its bounce controls');
    }
    finally {
        await fetch(`${base}/api/sessions/${encodeURIComponent(bouncedId)}/close`, { method: 'POST' });
    }
};
module.exports = bounce;
