// Generated test/tool from test/browser/anchored-comments.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const comment = (id, body = id) => ({ id, sessionId: fixtures_js_1.ROOT, body, target: { kind: 'file', path: '/fixture/a.txt', relPath: 'a.txt', anchor: { type: 'text', quote: 'beta', prefix: 'alpha ', suffix: ' gamma' } } });
async function setup(page, fleet, entries = []) {
    await fleet.select(fleet.self);
    await page.route('**/api/sessions/*/file?*', (route) => route.fulfill({ json: { path: '/fixture/a.txt', relPath: 'a.txt', content: 'alpha beta gamma', size: 16, mtime: 1 } }));
    await page.route('**/api/comments/index?*', (route) => route.fulfill({ json: { comments: entries } }));
    await page.route('**/api/comments/get', (route) => route.fulfill({ json: { comments: entries } }));
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt'));
    if (entries.length)
        await (0, fixtures_js_1.expect)(page.locator('#fileViewComments')).toContainText(String(entries.length));
}
async function selectText(page) {
    await page.evaluate(() => {
        const code = fixtureElement(document.querySelector('#fileViewBody code'), '#fileViewBody code');
        const text = fixtureElement(code.firstChild, 'file view text'), range = document.createRange();
        range.setStart(text, 6);
        range.setEnd(text, 10);
        const selection = fixtureElement(window.getSelection(), 'window selection');
        selection.removeAllRanges();
        selection.addRange(range);
        fixtureApp.features.anchoredCommentController.captureFile();
    });
    await (0, fixtures_js_1.expect)(page.locator('#commentBubble')).toBeVisible();
}
(0, fixtures_js_1.test)('overlapping comment refreshes cannot replace newer marks with an older body response', async ({ page, fleet }) => {
    await setup(page, fleet);
    let held;
    let index = 0;
    await page.route('**/api/comments/index?*', route => route.fulfill({ json: { comments: [comment(++index === 1 ? 'old' : 'new')] } }));
    await page.route('**/api/comments/get', route => {
        if (route.request().postDataJSON().ids[0] === 'old') {
            held = route;
            return;
        }
        return route.fulfill({ json: { comments: [comment('new', 'New body')] } });
    });
    await page.evaluate(() => { window.oldComments = fixtureApp.features.anchoredCommentController.refresh(); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => fixtureApp.features.anchoredCommentController.refresh());
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { comments: [comment('old', 'Old body')] } });
    await page.evaluate(() => window.oldComments);
    await page.locator('#fileViewComments').click();
    await (0, fixtures_js_1.expect)(page.locator('#commentListPopover')).toContainText('New body');
    await (0, fixtures_js_1.expect)(page.locator('#commentListPopover')).not.toContainText('Old body');
});
(0, fixtures_js_1.test)('late save failure cannot mark a new same-id host editor and duplicate submit is suppressed', async ({ page, fleet }) => {
    await setup(page, fleet);
    await selectText(page);
    await page.locator('#commentBody').fill('Old draft');
    let held, writes = 0;
    await page.route('**/api/comments', route => { held = route; writes++; });
    await page.evaluate(() => { window.oldSave = fixtureApp.features.anchoredCommentController.submit(); void fixtureApp.features.anchoredCommentController.submit(); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    (0, fixtures_js_1.expect)(writes).toBe(1);
    await fleet.select(fleet.peer);
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt'));
    await selectText(page);
    await page.locator('#commentBody').fill('Peer draft');
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ status: 500, json: { error: 'old save failed' } });
    await page.evaluate(() => window.oldSave);
    await (0, fixtures_js_1.expect)(page.locator('#commentBody')).toHaveValue('Peer draft');
    await (0, fixtures_js_1.expect)(page.locator('#commentStatus')).toHaveText('');
    await (0, fixtures_js_1.expect)(page.locator('#commentSendBtn')).toBeEnabled();
});
(0, fixtures_js_1.test)('a pending delete cannot disable or close another comment editor', async ({ page, fleet }) => {
    await setup(page, fleet, [comment('first'), comment('second')]);
    await page.evaluate(() => fixtureApp.features.anchoredCommentController.focus('first'));
    let held;
    await page.route('**/api/comments/first', route => { held = route; });
    await page.evaluate(() => { void fixtureApp.features.anchoredCommentController.remove(); window.oldDelete = fixtureApp.features.anchoredCommentController.remove(); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(async () => { fixtureApp.features.anchoredCommentController.close(); await fixtureApp.features.anchoredCommentController.focus('second'); });
    await (0, fixtures_js_1.expect)(page.locator('#commentDeleteBtn')).toBeEnabled();
    await (0, fixtures_js_1.expect)(page.locator('#commentDeleteBtn')).toHaveText('Delete');
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ status: 500, json: { error: 'old delete failed' } });
    await page.evaluate(() => window.oldDelete);
    await (0, fixtures_js_1.expect)(page.locator('#commentBody')).toHaveValue('second');
    await (0, fixtures_js_1.expect)(page.locator('#commentStatus')).toHaveText('');
    await (0, fixtures_js_1.expect)(page.locator('#commentDeleteBtn')).toBeEnabled();
});
(0, fixtures_js_1.test)('replaced and closed comment list rows cannot reopen obsolete editors', async ({ page, fleet }) => {
    await setup(page, fleet, [comment('old')]);
    await page.locator('#fileViewComments').click();
    await page.evaluate(() => { window.oldCommentRow = document.querySelector('.comment-list-row'); });
    await page.evaluate(entry => fixtureApp.features.anchoredCommentController.set([entry]), comment('new'));
    await page.evaluate(() => fixtureElement(window.oldCommentRow, 'old comment row').click());
    await (0, fixtures_js_1.expect)(page.locator('#commentBubble')).toBeHidden();
    await page.evaluate(() => { window.closedCommentRow = document.querySelector('.comment-list-row'); fixtureApp.features.anchoredCommentController.closeList(); fixtureElement(window.closedCommentRow, 'closed comment row').click(); });
    await (0, fixtures_js_1.expect)(page.locator('#commentBubble')).toBeHidden();
});
(0, fixtures_js_1.test)('queued pointer selection is retired when a file view closes and reopens', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.evaluate(() => {
        const native = window.setTimeout;
        window.delayedSelections = [];
        Object.defineProperty(window, 'setTimeout', { configurable: true, value(handler, timeout = 0, ...args) {
                if (timeout === 0 && typeof handler === 'function') {
                    window.delayedSelections.push(() => Reflect.apply(handler, window, args));
                    return 1234567;
                }
                const timer = Reflect.apply(native, window, [handler, timeout, ...args]);
                if (typeof timer !== 'number')
                    throw new Error('Fixture timer did not return an id');
                return timer;
            } });
        fixtureElement(document.getElementById('fileViewBody'), "document.getElementById('fileViewBody')").dispatchEvent(new PointerEvent('pointerup'));
        Object.defineProperty(window, 'setTimeout', { configurable: true, value: native });
        fixtureApp.features.fileViews.closeFile();
    });
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt'));
    await page.evaluate(() => {
        const code = fixtureElement(document.querySelector('#fileViewBody code'), '#fileViewBody code');
        const text = fixtureElement(code.firstChild, 'file view text'), range = document.createRange();
        range.setStart(text, 6);
        range.setEnd(text, 10);
        const selection = fixtureElement(window.getSelection(), 'window.getSelection()');
        selection.removeAllRanges();
        selection.addRange(range);
        window.delayedSelections.forEach(fn => fn());
    });
    await (0, fixtures_js_1.expect)(page.locator('#commentBubble')).toBeHidden();
});
(0, fixtures_js_1.test)('quote anchors span formatting and malformed or other-session comments cannot become marks', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.evaluate(entries => {
        fixtureElement(document.getElementById('fileViewBody'), "document.getElementById('fileViewBody')").innerHTML = '<div>alpha <code>be</code>ta gamma</div>';
        fixtureApp.features.anchoredCommentController.set(entries);
    }, [comment('good'), null, { ...comment('foreign'), sessionId: 'foreign-session' }]);
    await (0, fixtures_js_1.expect)(page.locator('mark.comment-mark')).toHaveCount(2);
    await (0, fixtures_js_1.expect)(page.locator('#fileViewComments')).toContainText('1');
    await page.locator('mark.comment-mark').first().click();
    await (0, fixtures_js_1.expect)(page.locator('#commentBody')).toHaveValue('good');
});
(0, fixtures_js_1.test)('comment disposal removes pointer, chip, bubble and delayed-delete actions', async ({ page, fleet }) => {
    await setup(page, fleet, [comment('old')]);
    await page.evaluate(() => fixtureApp.features.anchoredCommentController.focus('old'));
    await page.evaluate(() => { void fixtureApp.features.anchoredCommentController.remove(); fixtureApp.features.anchoredCommentController.dispose(); });
    await page.evaluate(async () => { await fixtureApp.features.anchoredCommentController.remove(); await fixtureApp.features.anchoredCommentController.submit(); await fixtureApp.features.anchoredCommentController.focus('old'); fixtureElement(document.getElementById('fileViewComments'), "document.getElementById('fileViewComments')").click(); });
    await (0, fixtures_js_1.expect)(page.locator('#commentBubble')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#commentListPopover')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#commentDeleteBtn')).toHaveText('Delete');
    await (0, fixtures_js_1.expect)(page.locator('mark.comment-mark')).toHaveCount(0);
});
