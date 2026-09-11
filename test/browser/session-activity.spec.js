const { test, expect } = require('./fixtures');
test('compaction retains the activity badge and stop control when a turn ends', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => { setTurnInProgress(true); setCompacting(true); setTurnInProgress(false); });
  await expect(page.locator('#sessionWorking')).toHaveClass(/active/);
  await expect(page.locator('#sessionWorking .spinner-text')).toContainText('Compacting');
  await expect(page.locator('#btnStop')).toHaveCSS('visibility', 'visible');
  await page.evaluate(() => setCompacting(false));
  await expect(page.locator('#sessionWorking')).not.toHaveClass(/active/);
  await expect(page.locator('#btnStop')).toHaveCSS('visibility', 'hidden');
});
test('activity ticker and setters retire on disposal', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => { setTurnInProgress(true); sessionActivity.toolStarted('a', 'Bash'); });
  await expect(page.locator('#sessionWorking .spinner-text')).toContainText('Bash');
  await page.evaluate(() => { sessionActivity.dispose(); document.querySelector('#sessionWorking .spinner-text').textContent = 'retained'; sessionActivity.toolStarted('b', 'Wrong'); setCompacting(true); });
  await page.waitForTimeout(1100);
  await expect(page.locator('#sessionWorking .spinner-text')).toHaveText('retained');
});
test('a failed old abort cannot release the gate of a subsequent turn', async ({ page, fleet }) => {
  const result = await page.evaluate(() => {
    const first = sessionActivity.beginAbort('self same'); sessionActivity.endAbort('self same');
    const second = sessionActivity.beginAbort('self same'); sessionActivity.endAbort('self same', first);
    const retained = sessionActivity.isAborting('self same'); sessionActivity.endAbort('self same', second);
    return { retained, released: !sessionActivity.isAborting('self same'), peer: !!sessionActivity.beginAbort('peer same') };
  });
  expect(result).toEqual({ retained: true, released: true, peer: true });
});
test('replacement btw question rejects late answers and failures from the previous request', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    window.oldBtw = showBtwPanel('first'); window.newBtw = showBtwPanel('second');
    resolveBtwPanel('old answer', window.oldBtw); failBtwPanel('old failure', window.oldBtw);
  });
  await expect(page.locator('#btwPanel')).toContainText('second');
  await expect(page.locator('.btw-panel-answer')).toHaveText('Asking…');
  await page.evaluate(() => resolveBtwPanel('current answer', window.newBtw));
  await expect(page.locator('.btw-panel-answer')).toHaveText('current answer');
  await fleet.select(fleet.peer);
  await page.evaluate(() => { showBtwPanel('peer'); failBtwPanel('foreign failure', window.newBtw); });
  await expect(page.locator('.btw-panel-answer')).toHaveText('Asking…');
});
test('btw clipboard completion and detached dismissal cannot modify the replacement panel', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    btwPanel.dispose(); window.sideQuestion = PiDishBrowser.createBtwPanel({ document, sessionState, markdown: text => text, copy: () => new Promise(resolve => { window.finishSideCopy = resolve; }) });
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
