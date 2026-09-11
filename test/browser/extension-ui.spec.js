const { test, expect, ROOT } = require('./fixtures');
test.use({ liveSessions: true });
let delivery = 0;
async function show(page, request, fleet) {
  const nonce = ++delivery;
  const host = await page.evaluate(() => {
    if (!window.extensionDeliveryHook) {
      window.extensionDeliveryHook = true;
      const original = extensionUI.handle;
      extensionUI.handle = (request, session) => { original(request, session); window.extensionDelivery = request.__fixtureNonce; };
    }
    return sessionState.captureSelection().host;
  });
  const fixtureHost = host === fleet.peer.hostId ? fleet.peer : fleet.self;
  if (['select', 'confirm', 'input', 'editor', 'ask'].includes(request.method)) fixtureHost.emit('turn_start', {});
  fixtureHost.emit('extension_ui_request', { ...request, __fixtureNonce: nonce });
  await expect.poll(() => page.evaluate(() => window.extensionDelivery)).toBe(nonce);
}
const editor = { id: 'shared-dialog', method: 'editor', title: 'Edit answer', prefill: 'Initial answer' };

test('stashed dialogs preserve edits while same-id peer cards cannot answer the current host', async ({ page, fleet }) => {
  const answers = [];
  await page.route('**/api/sessions/*/ui-response', route => { answers.push({ origin: new URL(route.request().url()).origin, body: route.request().postDataJSON() }); return route.fulfill({ json: { ok: true } }); });
  await fleet.select(fleet.peer); await show(page, editor, fleet);
  await page.locator('.ext-ui-dialog-editor').fill('Unfinished peer answer');
  await page.evaluate(() => { window.peerDialog = document.querySelector('.ext-ui-docked-dialog'); window.peerSubmit = window.peerDialog.querySelector('[data-action="submit"]'); });
  await fleet.select(fleet.self); await show(page, editor, fleet);
  await expect(page.locator('.ext-ui-dialog-editor')).toBeVisible();
  await page.evaluate(() => window.peerSubmit.click());
  expect(answers).toEqual([]); await expect(page.locator('.ext-ui-dialog-editor')).toHaveValue('Initial answer');
  await fleet.select(fleet.peer); await show(page, editor, fleet);
  await expect(page.locator('.ext-ui-dialog-editor')).toHaveValue('Unfinished peer answer');
  expect(await page.evaluate(() => document.querySelector('.ext-ui-docked-dialog') === window.peerDialog)).toBe(true);
  await page.locator('[data-action="submit"]').click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]).toEqual({ origin: fleet.peer.base, body: { requestId: editor.id, value: 'Unfinished peer answer' } });
});

test('resolved dialog controls cannot answer a replacement using the same request id', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await show(page, { id: editor.id, method: 'confirm', title: 'Old confirmation' }, fleet);
  await page.evaluate(() => { window.oldConfirm = [...document.querySelectorAll('.ext-ui-docked-dialog button')]; extensionUI.resolve('shared-dialog', sessionState.captureSelection()); });
  await show(page, { id: editor.id, method: 'confirm', title: 'New confirmation' }, fleet);
  let writes = 0;
  await page.route('**/api/sessions/*/ui-response', route => { writes++; return route.fulfill({ json: { ok: true } }); });
  await page.evaluate(() => window.oldConfirm.forEach(button => button.click()));
  expect(writes).toBe(0); await expect(page.locator('.ext-ui-dialog-title')).toHaveText('New confirmation');
  await page.locator('[data-action="yes"]').click(); await expect.poll(() => writes).toBe(1);
});

test('ask answers retain typed labels, custom notes and selections through redocking', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const ask = { id: 'ask', method: 'ask', questions: [
    { id: 'single', question: '\x1b[31mChoose one\x1b[0m', options: ['First', { label: 'Second', description: 'Description', preview: 'Preview' }] },
    { id: 'multi', question: 'Choose several', multi: true, options: ['A', 'B'] },
  ] };
  await show(page, ask, fleet);
  await page.locator('[data-action="submit-ask"]').click();
  await expect(page.locator('.ext-ui-ask-error:not([hidden])')).toHaveCount(1);
  await page.locator('.ext-ui-ask-option[data-question-index="0"][data-option-index="1"]').click();
  await page.locator('.ext-ui-ask-option[data-question-index="1"][data-option-index="0"]').click();
  await page.locator('.ext-ui-ask-custom[data-question-index="1"]').fill('Custom extra');
  await page.locator('.ext-ui-ask-note[data-question-index="0"]').fill('Keep the note');
  await fleet.select(fleet.peer); await fleet.select(fleet.self); await show(page, ask, fleet);
  await expect(page.locator('.ext-ui-ask-option[aria-pressed="true"]')).toHaveCount(2);
  let answer;
  await page.route('**/api/sessions/*/ui-response', route => { answer = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
  await page.locator('[data-action="submit-ask"]').click();
  await expect.poll(() => !!answer).toBe(true);
  expect(answer.value).toEqual({ kind: 'submit', results: [
    { id: 'single', question: 'Choose one', options: ['First', 'Second'], multi: false, selectedOptions: ['Second'], note: 'Keep the note' },
    { id: 'multi', question: 'Choose several', options: ['A', 'B'], multi: true, selectedOptions: ['A'], customInput: 'Custom extra' },
  ] });
});

test('authoritative dialog reconciliation prunes only its owning host and ignores malformed state', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); await show(page, editor, fleet);
  await fleet.select(fleet.self); await show(page, editor, fleet);
  await page.evaluate(({ id, host }) => { extensionUI.reconcile({ dialogs: [] }, { id, host }); extensionUI.reconcile({ dialogs: false }, sessionState.captureSelection()); }, { id: ROOT, host: fleet.peer.hostId });
  await expect(page.locator('.ext-ui-docked-dialog')).toHaveCount(1);
  await page.evaluate(() => extensionUI.reconcile({ dialogs: [] }, sessionState.captureSelection()));
  await expect(page.locator('.ext-ui-docked-dialog')).toHaveCount(0);
  await fleet.select(fleet.peer); await show(page, editor, fleet);
  await expect(page.locator('.ext-ui-dialog-editor')).toHaveValue('Initial answer');
});

test('widget reprojection cancels both removal phases and old headers cannot replace peer state', async ({ page, fleet }) => {
  await page.clock.install(); await fleet.select(fleet.self);
  const widget = { method: 'setWidget', widgetKey: 'quoted"key', widgetLines: ['Original'] };
  await show(page, widget, fleet);
  await page.evaluate(() => { window.oldWidget = document.querySelector('.ext-ui-widget'); window.oldWidgetHeader = window.oldWidget.querySelector('.ext-ui-widget-header'); });
  await show(page, { ...widget, widgetLines: [] }, fleet); await page.clock.runFor(550);
  await expect(page.locator('.ext-ui-widget')).toHaveClass(/hidden/);
  await show(page, { ...widget, widgetLines: ['Restored'] }, fleet); await page.clock.runFor(250);
  await expect(page.locator('.ext-ui-widget')).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('.ext-ui-widget') === window.oldWidget)).toBe(true);
  await fleet.select(fleet.peer); await show(page, { ...widget, widgetLines: ['Peer state'] }, fleet);
  await page.evaluate(() => window.oldWidgetHeader.click());
  await expect(page.locator('.ext-ui-widget')).not.toHaveClass(/collapsed/); await expect(page.locator('.ext-ui-widget')).toContainText('Peer state');
});

test('extension UI disposal retires toast, widget, status and dialog listeners and timers', async ({ page, fleet }) => {
  await page.clock.install(); await fleet.select(fleet.self);
  await show(page, { method: 'notify', message: 'Toast' }, fleet);
  await show(page, { method: 'setWidget', widgetKey: 'widget', widgetLines: ['Widget'] }, fleet);
  await show(page, { method: 'setStatus', statusKey: 'status', statusText: 'Status' }, fleet);
  await show(page, editor, fleet);
  let writes = 0;
  await page.route('**/api/sessions/*/ui-response', route => { writes++; return route.fulfill({ json: { ok: true } }); });
  await page.evaluate(() => {
    window.retiredExtensionButtons = [...document.querySelectorAll('.ext-ui-docked-dialog button, .ext-ui-toast button')];
    extensionUI.dispose(); window.retiredExtensionButtons.forEach(button => button.click());
  });
  await page.clock.runFor(7000);
  await expect(page.locator('.ext-ui-widget, .ext-ui-status-badge, .ext-ui-toast, .ext-ui-docked-dialog')).toHaveCount(0); expect(writes).toBe(0);
});
