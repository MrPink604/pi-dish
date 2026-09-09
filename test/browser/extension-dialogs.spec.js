const { test, expect, ROOT } = require('./fixtures');
test.use({ liveSessions: true });

async function select(fleet, page, host) {
  await fleet.select(host);
  await page.waitForFunction(() => messageStream?.readyState === 1);
}

test('same-id dialog replay preserves separate inputs and routes answers to their hosts', async ({ page, fleet }) => {
  for (const host of [fleet.self, fleet.peer]) {
    await select(fleet, page, host);
    host.emit('turn_start', {});
    host.emit('extension_ui_request', { method: 'input', id: 'shared-dialog', title: `${host.label} question` });
    await expect(page.locator('.ext-ui-dialog-title')).toHaveText(`${host.label} question`);
    await page.locator('.ext-ui-dialog-input').fill(`${host.label} answer`);
  }
  await select(fleet, page, fleet.self);
  await expect(page.locator('.ext-ui-dialog-input')).toHaveValue('self answer');
  await page.locator('.ext-ui-dialog-btn[data-action=submit]').click();
  await expect.poll(() => fleet.self.commands.filter(command => command.command === 'extension_ui_response').map(command => command.value))
    .toEqual(['self answer']);
  await select(fleet, page, fleet.peer);
  await expect(page.locator('.ext-ui-dialog-input')).toHaveValue('peer answer');
  await page.locator('.ext-ui-dialog-btn[data-action=submit]').click();
  await expect.poll(() => fleet.peer.commands.filter(command => command.command === 'extension_ui_response').map(command => command.value))
    .toEqual(['peer answer']);
});

test('a resolved dialog and authoritative replay prune only their owning host', async ({ page, fleet }) => {
  for (const host of [fleet.self, fleet.peer]) {
    await select(fleet, page, host);
    host.emit('turn_start', {});
    host.emit('extension_ui_request', { method: 'confirm', id: 'same-request', title: 'Same content' });
    await expect(page.locator('.ext-ui-dialog-title')).toHaveText('Same content');
  }
  fleet.peer.emit('extension_ui_resolved', { id: 'same-request' });
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(0);
  await select(fleet, page, fleet.self);
  await expect(page.locator('.ext-ui-dialog-title')).toHaveText('Same content');
  fleet.self.emit('extension_ui_resolved', { id: 'same-request' });
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(0);
});

test('identical ask payloads dedupe within a host and keep independent selections across hosts', async ({ page, fleet }) => {
  const request = { method: 'ask', id: 'same-ask', questions: [{ id: 'q', question: 'Pick a channel', options: [{ label: 'Stable' }, { label: 'Beta' }] }] };
  for (const host of [fleet.self, fleet.peer]) {
    await select(fleet, page, host);
    host.emit('turn_start', {});
    host.emit('extension_ui_request', request);
    await expect(page.locator('.ext-ui-ask-option')).toHaveCount(2);
    await page.locator(`.ext-ui-ask-option[data-option-index="${host === fleet.self ? 0 : 1}"]`).click();
    host.emit('extension_ui_request', { ...request, id: 'repeated-ask' });
    // A subsequent event is a barrier proving the re-emission was delivered.
    host.emit('turn_start', {});
    host.emit('extension_ui_request', { method: 'setStatus', statusKey: 'barrier', statusText: 'replayed' });
    await expect(page.locator('.ext-ui-status-badge')).toHaveText('replayed');
    await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(1);
    await page.locator('.ext-ui-dialog-min').click();
  }
  await select(fleet, page, fleet.self);
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveClass(/minimized/);
  await expect(page.locator('.ext-ui-ask-option.selected')).toHaveAttribute('data-option-index', '0');
  await select(fleet, page, fleet.peer);
  await expect(page.locator('.ext-ui-ask-option.selected')).toHaveAttribute('data-option-index', '1');
});

test('widget collapsed state is scoped to the host as well as the session', async ({ page, fleet }) => {
  await select(fleet, page, fleet.self);
  fleet.self.emit('extension_ui_request', { method: 'setWidget', widgetKey: 'same-widget', widgetLines: ['self widget'] });
  await page.locator('.ext-ui-widget-header').click();
  await expect(page.locator('.ext-ui-widget')).toHaveClass(/collapsed/);
  await select(fleet, page, fleet.peer);
  fleet.peer.emit('extension_ui_request', { method: 'setWidget', widgetKey: 'same-widget', widgetLines: ['peer widget'] });
  await expect(page.locator('.ext-ui-widget-body')).toHaveText('peer widget');
  await expect(page.locator('.ext-ui-widget')).not.toHaveClass(/collapsed/);
});
