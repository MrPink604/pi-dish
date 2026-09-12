const { test, expect } = require('./fixtures');
test('compaction retains the activity badge and stop control when a turn ends', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); fixtureApp.features.sessionActivity.setCompacting(true); fixtureApp.features.sessionActivity.setTurn(false); });
  await expect(page.locator('#sessionWorking')).toHaveClass(/active/);
  await expect(page.locator('#sessionWorking .spinner-text')).toContainText('Compacting');
  await expect(page.locator('#btnStop')).toHaveCSS('visibility', 'visible');
  await page.evaluate(() => fixtureApp.features.sessionActivity.setCompacting(false));
  await expect(page.locator('#sessionWorking')).not.toHaveClass(/active/);
  await expect(page.locator('#btnStop')).toHaveCSS('visibility', 'hidden');
});
test('activity ticker and setters retire on disposal', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); fixtureApp.features.sessionActivity.toolStarted('a', 'Bash'); });
  await expect(page.locator('#sessionWorking .spinner-text')).toContainText('Bash');
  await page.evaluate(() => { fixtureApp.features.sessionActivity.dispose(); document.querySelector('#sessionWorking .spinner-text').textContent = 'retained'; fixtureApp.features.sessionActivity.toolStarted('b', 'Wrong'); fixtureApp.features.sessionActivity.setCompacting(true); });
  await page.waitForTimeout(1100);
  await expect(page.locator('#sessionWorking .spinner-text')).toHaveText('retained');
});
test('a failed old abort cannot release the gate of a subsequent turn', async ({ page, fleet }) => {
  const result = await page.evaluate(() => {
    const first = fixtureApp.features.sessionActivity.beginAbort('self same'); fixtureApp.features.sessionActivity.endAbort('self same');
    const second = fixtureApp.features.sessionActivity.beginAbort('self same'); fixtureApp.features.sessionActivity.endAbort('self same', first);
    const retained = fixtureApp.features.sessionActivity.isAborting('self same'); fixtureApp.features.sessionActivity.endAbort('self same', second);
    return { retained, released: !fixtureApp.features.sessionActivity.isAborting('self same'), peer: !!fixtureApp.features.sessionActivity.beginAbort('peer same') };
  });
  expect(result).toEqual({ retained: true, released: true, peer: true });
});
test('replacement btw question rejects late answers and failures from the previous request', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    window.oldBtw = fixtureApp.features.btwPanel.show('first'); window.newBtw = fixtureApp.features.btwPanel.show('second');
    fixtureApp.features.btwPanel.resolve('old answer', window.oldBtw); fixtureApp.features.btwPanel.fail('old failure', window.oldBtw);
  });
  await expect(page.locator('#btwPanel')).toContainText('second');
  await expect(page.locator('.btw-panel-answer')).toHaveText('Asking…');
  await page.evaluate(() => fixtureApp.features.btwPanel.resolve('current answer', window.newBtw));
  await expect(page.locator('.btw-panel-answer')).toHaveText('current answer');
  await fleet.select(fleet.peer);
  await page.evaluate(() => { fixtureApp.features.btwPanel.show('peer'); fixtureApp.features.btwPanel.fail('foreign failure', window.newBtw); });
  await expect(page.locator('.btw-panel-answer')).toHaveText('Asking…');
});
test('btw clipboard completion and detached dismissal cannot modify the replacement panel', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    fixtureApp.features.btwPanel.dispose(); window.sideQuestion = PiDishBrowser.createBtwPanel({ document, sessionState: fixtureApp.features.sessionState, markdown: text => text, copy: () => new Promise(resolve => { window.finishSideCopy = resolve; }) });
    const owner = window.sideQuestion.show('first'); window.sideQuestion.resolve('answer', owner);
    window.oldSideClose = document.querySelector('.btw-dismiss'); document.querySelector('.btw-copy').click();
    const next = window.sideQuestion.show('next'); window.sideQuestion.resolve('next answer', next);
    window.oldSideClose.click(); window.finishSideCopy();
  });
  await expect(page.locator('.btw-panel-question')).toHaveText('next');
  await expect(page.locator('.btw-copy')).toHaveText('Copy');
  await page.evaluate(() => { window.sideQuestion.dispose(); window.sideQuestion.show('disposed'); });
  await expect(page.locator('#btwPanel')).toBeHidden();
});
