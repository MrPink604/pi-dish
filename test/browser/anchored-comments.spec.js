const { test, expect, ROOT } = require('./fixtures');
const comment = (id, body = id) => ({ id, sessionId: ROOT, body, target: { kind: 'file', path: '/fixture/a.txt', relPath: 'a.txt', anchor: { type: 'text', quote: 'beta', prefix: 'alpha ', suffix: ' gamma' } } });
async function setup(page, fleet, entries = []) {
  await fleet.select(fleet.self);
  await page.route('**/api/sessions/*/file?*', route => route.fulfill({ json: { path: '/fixture/a.txt', relPath: 'a.txt', content: 'alpha beta gamma', size: 16, mtime: 1 } }));
  await page.route('**/api/comments/index?*', route => route.fulfill({ json: { comments: entries } }));
  await page.route('**/api/comments/get', route => route.fulfill({ json: { comments: entries } }));
  await page.evaluate(() => openFileViewer('a.txt'));
  if (entries.length) await expect(page.locator('#fileViewComments')).toContainText(String(entries.length));
}
async function selectText(page) {
  await page.evaluate(() => {
    const text = document.querySelector('#fileViewBody code').firstChild, range = document.createRange(); range.setStart(text, 6); range.setEnd(text, 10);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); captureFileCommentSelection();
  });
  await expect(page.locator('#commentBubble')).toBeVisible();
}

test('overlapping comment refreshes cannot replace newer marks with an older body response', async ({ page, fleet }) => {
  await setup(page, fleet); let held; let index = 0;
  await page.route('**/api/comments/index?*', route => route.fulfill({ json: { comments: [comment(++index === 1 ? 'old' : 'new')] } }));
  await page.route('**/api/comments/get', route => {
    if (route.request().postDataJSON().ids[0] === 'old') { held = route; return; }
    return route.fulfill({ json: { comments: [comment('new', 'New body')] } });
  });
  await page.evaluate(() => { window.oldComments = refreshAnchoredComments(); }); await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => refreshAnchoredComments()); await held.fulfill({ json: { comments: [comment('old', 'Old body')] } }); await page.evaluate(() => window.oldComments);
  await page.locator('#fileViewComments').click(); await expect(page.locator('#commentListPopover')).toContainText('New body'); await expect(page.locator('#commentListPopover')).not.toContainText('Old body');
});

test('late save failure cannot mark a new same-id host editor and duplicate submit is suppressed', async ({ page, fleet }) => {
  await setup(page, fleet); await selectText(page); await page.locator('#commentBody').fill('Old draft'); let held, writes = 0;
  await page.route('**/api/comments', route => { held = route; writes++; });
  await page.evaluate(() => { window.oldSave = submitAnchoredComment(); void submitAnchoredComment(); }); await expect.poll(() => !!held).toBe(true); expect(writes).toBe(1);
  await fleet.select(fleet.peer); await page.evaluate(() => openFileViewer('a.txt')); await selectText(page); await page.locator('#commentBody').fill('Peer draft');
  await held.fulfill({ status: 500, json: { error: 'old save failed' } }); await page.evaluate(() => window.oldSave);
  await expect(page.locator('#commentBody')).toHaveValue('Peer draft'); await expect(page.locator('#commentStatus')).toHaveText(''); await expect(page.locator('#commentSendBtn')).toBeEnabled();
});

test('a pending delete cannot disable or close another comment editor', async ({ page, fleet }) => {
  await setup(page, fleet, [comment('first'), comment('second')]); await page.evaluate(() => focusAnchoredComment('first'));
  let held; await page.route('**/api/comments/first', route => { held = route; });
  await page.evaluate(() => { void handleCommentDelete(); window.oldDelete = handleCommentDelete(); }); await expect.poll(() => !!held).toBe(true);
  await page.evaluate(async () => { closeCommentBubble(); await focusAnchoredComment('second'); });
  await expect(page.locator('#commentDeleteBtn')).toBeEnabled(); await expect(page.locator('#commentDeleteBtn')).toHaveText('Delete');
  await held.fulfill({ status: 500, json: { error: 'old delete failed' } }); await page.evaluate(() => window.oldDelete);
  await expect(page.locator('#commentBody')).toHaveValue('second'); await expect(page.locator('#commentStatus')).toHaveText(''); await expect(page.locator('#commentDeleteBtn')).toBeEnabled();
});

test('replaced and closed comment list rows cannot reopen obsolete editors', async ({ page, fleet }) => {
  await setup(page, fleet, [comment('old')]); await page.locator('#fileViewComments').click();
  await page.evaluate(() => { window.oldCommentRow = document.querySelector('.comment-list-row'); });
  await page.evaluate(entry => setAnchoredComments([entry]), comment('new'));
  await page.evaluate(() => window.oldCommentRow.click()); await expect(page.locator('#commentBubble')).toBeHidden();
  await page.evaluate(() => { window.closedCommentRow = document.querySelector('.comment-list-row'); closeCommentListPopover(); window.closedCommentRow.click(); });
  await expect(page.locator('#commentBubble')).toBeHidden();
});

test('queued pointer selection is retired when a file view closes and reopens', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    const native = window.setTimeout; window.delayedSelections = [];
    window.setTimeout = (fn, ms, ...args) => { if (ms === 0) { window.delayedSelections.push(() => fn(...args)); return 1234567; } return native(fn, ms, ...args); };
    document.getElementById('fileViewBody').dispatchEvent(new PointerEvent('pointerup'));
    window.setTimeout = native; closeFileView();
  });
  await page.evaluate(() => openFileViewer('a.txt'));
  await page.evaluate(() => {
    const text = document.querySelector('#fileViewBody code').firstChild, range = document.createRange(); range.setStart(text, 6); range.setEnd(text, 10); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    window.delayedSelections.forEach(fn => fn());
  });
  await expect(page.locator('#commentBubble')).toBeHidden();
});

test('quote anchors span formatting and malformed or other-session comments cannot become marks', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(entries => {
    document.getElementById('fileViewBody').innerHTML = '<div>alpha <code>be</code>ta gamma</div>';
    setAnchoredComments(entries);
  }, [comment('good'), null, { ...comment('foreign'), sessionId: 'foreign-session' }]);
  await expect(page.locator('mark.comment-mark')).toHaveCount(2); await expect(page.locator('#fileViewComments')).toContainText('1');
  await page.locator('mark.comment-mark').first().click(); await expect(page.locator('#commentBody')).toHaveValue('good');
});

test('comment disposal removes pointer, chip, bubble and delayed-delete actions', async ({ page, fleet }) => {
  await setup(page, fleet, [comment('old')]); await page.evaluate(() => focusAnchoredComment('old'));
  await page.evaluate(() => { void handleCommentDelete(); anchoredCommentController.dispose(); });
  await page.evaluate(async () => { await handleCommentDelete(); await submitAnchoredComment(); await focusAnchoredComment('old'); document.getElementById('fileViewComments').click(); });
  await expect(page.locator('#commentBubble')).toBeHidden(); await expect(page.locator('#commentListPopover')).toBeHidden();
  await expect(page.locator('#commentDeleteBtn')).toHaveText('Delete'); await expect(page.locator('mark.comment-mark')).toHaveCount(0);
});
