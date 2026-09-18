// Generated test/tool from test/browser/session-activity.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('compaction retains the activity badge and stop control when a turn ends', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); fixtureApp.features.sessionActivity.setCompacting(true); fixtureApp.features.sessionActivity.setTurn(false); });
    await (0, fixtures_js_1.expect)(page.locator('#sessionWorking')).toHaveClass(/active/);
    await (0, fixtures_js_1.expect)(page.locator('#sessionWorking .spinner-text')).toContainText('Compacting');
    await (0, fixtures_js_1.expect)(page.locator('#btnStop')).toHaveCSS('visibility', 'visible');
    await page.evaluate(() => fixtureApp.features.sessionActivity.setCompacting(false));
    await (0, fixtures_js_1.expect)(page.locator('#sessionWorking')).not.toHaveClass(/active/);
    await (0, fixtures_js_1.expect)(page.locator('#btnStop')).toHaveCSS('visibility', 'hidden');
});
(0, fixtures_js_1.test)('activity ticker and setters retire on disposal', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); fixtureApp.features.sessionActivity.toolStarted('a', 'Bash'); });
    await (0, fixtures_js_1.expect)(page.locator('#sessionWorking .spinner-text')).toContainText('Bash');
    await page.evaluate(() => { fixtureApp.features.sessionActivity.dispose(); fixtureElement(document.querySelector('#sessionWorking .spinner-text'), "document.querySelector('#sessionWorking .spinner-text')").textContent = 'retained'; fixtureApp.features.sessionActivity.toolStarted('b', 'Wrong'); fixtureApp.features.sessionActivity.setCompacting(true); });
    await page.waitForTimeout(1100);
    await (0, fixtures_js_1.expect)(page.locator('#sessionWorking .spinner-text')).toHaveText('retained');
});
(0, fixtures_js_1.test)('a failed old abort cannot release the gate of a subsequent turn', async ({ page, fleet }) => {
    const result = await page.evaluate(() => {
        const first = fixtureApp.features.sessionActivity.beginAbort('self same');
        fixtureApp.features.sessionActivity.endAbort('self same');
        const second = fixtureApp.features.sessionActivity.beginAbort('self same');
        fixtureApp.features.sessionActivity.endAbort('self same', fixtureElement(first, 'first abort token'));
        const retained = fixtureApp.features.sessionActivity.isAborting('self same');
        fixtureApp.features.sessionActivity.endAbort('self same', fixtureElement(second, 'second abort token'));
        return { retained, released: !fixtureApp.features.sessionActivity.isAborting('self same'), peer: !!fixtureApp.features.sessionActivity.beginAbort('peer same') };
    });
    (0, fixtures_js_1.expect)(result).toEqual({ retained: true, released: true, peer: true });
});
(0, fixtures_js_1.test)('replacement btw question rejects late answers and failures from the previous request', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => {
        window.oldBtw = fixtureApp.features.btwPanel.show('first');
        window.newBtw = fixtureApp.features.btwPanel.show('second');
        fixtureApp.features.btwPanel.resolve('old answer', window.oldBtw);
        fixtureApp.features.btwPanel.fail('old failure', window.oldBtw);
    });
    await (0, fixtures_js_1.expect)(page.locator('#btwPanel')).toContainText('second');
    await (0, fixtures_js_1.expect)(page.locator('.btw-panel-answer')).toHaveText('Asking…');
    await page.evaluate(() => fixtureApp.features.btwPanel.resolve('current answer', window.newBtw));
    await (0, fixtures_js_1.expect)(page.locator('.btw-panel-answer')).toHaveText('current answer');
    await fleet.select(fleet.peer);
    await page.evaluate(() => { fixtureApp.features.btwPanel.show('peer'); fixtureApp.features.btwPanel.fail('foreign failure', window.newBtw); });
    await (0, fixtures_js_1.expect)(page.locator('.btw-panel-answer')).toHaveText('Asking…');
});
(0, fixtures_js_1.test)('btw clipboard completion and detached dismissal cannot modify the replacement panel', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => {
        fixtureApp.features.btwPanel.dispose();
        window.sideQuestion = PiDishBrowser.createBtwPanel({ document, sessionState: fixtureApp.features.sessionState, markdown: text => text, copy: () => new Promise(resolve => { window.finishSideCopy = resolve; }) });
        const owner = window.sideQuestion.show('first');
        window.sideQuestion.resolve('answer', owner);
        window.oldSideClose = document.querySelector('.btw-dismiss');
        fixtureElement(document.querySelector('.btw-copy'), '.btw-copy').click();
        const next = window.sideQuestion.show('next');
        window.sideQuestion.resolve('next answer', next);
        fixtureElement(window.oldSideClose, 'old BTW close').click();
        window.finishSideCopy();
    });
    await (0, fixtures_js_1.expect)(page.locator('.btw-panel-question')).toHaveText('next');
    await (0, fixtures_js_1.expect)(page.locator('.btw-copy')).toHaveText('Copy');
    await page.evaluate(() => { window.sideQuestion.dispose(); window.sideQuestion.show('disposed'); });
    await (0, fixtures_js_1.expect)(page.locator('#btwPanel')).toBeHidden();
});
