import type { Page, Route } from '@playwright/test';
import type { BrowserHost, FleetFixture } from './fixtures.js';
import { test, expect, ROOT } from './fixtures.js';
test.use({ liveSessions: true });

async function select(fleet: FleetFixture, page: Page, host: BrowserHost) {
  await fleet.select(host);
  await page.waitForFunction(() => fixtureApp.features.messageStreamController.source?.readyState === 1);
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

test('a re-issued reset prompt supersedes the pending request instead of stacking', async ({ page, fleet }) => {
  await select(fleet, page, fleet.self);
  fleet.self.emit('turn_start', {});
  const options = ['Yes', 'No'];
  const title = (remaining: string) => `Spend a saved rate-limit reset?\nalice: a saved reset expires in ${remaining} (weekly window 42% used).`;
  fleet.self.emit('extension_ui_request', { method: 'select', id: 'reset-1', title: title('6d 23h'), options });
  await expect(page.locator('.ext-ui-dialog-title')).toContainText('6d 23h');
  // OMP's salvage sweep re-asks about the same credit while the first request
  // is still pending; only the expiry detail changed.
  fleet.self.emit('extension_ui_request', { method: 'select', id: 'reset-2', title: title('6d 22h'), options });
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(1);
  await expect(page.locator('.ext-ui-dialog-title')).toContainText('6d 22h');
  await expect.poll(() => responses(fleet.self)).toEqual([{ id: 'reset-1', value: undefined, cancelled: true }]);
  // The superseded id resolving must not dismiss the card that now owns reset-2.
  fleet.self.emit('extension_ui_resolved', { id: 'reset-1', source: 'web' });
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(1);
  // A delayed replay of the older id must not win the prompt back either.
  fleet.self.emit('extension_ui_request', { method: 'select', id: 'reset-1', title: title('6d 23h'), options });
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(1);
  await expect(page.locator('.ext-ui-dialog-title')).toContainText('6d 22h');
  await page.locator('.ext-ui-dialog-option', { hasText: 'No' }).click();
  await expect.poll(() => responses(fleet.self).filter(response => response.id === 'reset-2'))
    .toEqual([{ id: 'reset-2', value: 'No', cancelled: undefined }]);
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(0);
});

test('a re-emitted ask keeps its answered state and submits to the newest request', async ({ page, fleet }) => {
  await select(fleet, page, fleet.self);
  const questions = [{ id: 'q', question: 'Pick a channel', options: [{ label: 'Stable' }, { label: 'Beta' }] }];
  fleet.self.emit('turn_start', {});
  fleet.self.emit('extension_ui_request', { method: 'ask', id: 'ask-1', questions });
  await page.locator('.ext-ui-ask-option[data-option-index="0"]').click();
  fleet.self.emit('extension_ui_request', { method: 'ask', id: 'ask-2', questions });
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(1);
  await expect(page.locator('.ext-ui-ask-option.selected')).toHaveAttribute('data-option-index', '0');
  await page.locator('[data-action="submit-ask"]').click();
  await expect.poll(() => responses(fleet.self)).toEqual([
    { id: 'ask-1', value: undefined, cancelled: true },
    { id: 'ask-2', cancelled: undefined, value: { kind: 'submit', results: [{ id: 'q', question: 'Pick a channel', options: ['Stable', 'Beta'], multi: false, selectedOptions: ['Stable'] }] } },
  ]);
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(0);
});

test('dismissing a yes/no select answers No so the host stops re-asking', async ({ page, fleet }) => {
  await select(fleet, page, fleet.self);
  fleet.self.emit('turn_start', {});
  fleet.self.emit('extension_ui_request', { method: 'select', id: 'early-reset',
    title: 'Spend a saved rate-limit reset?\nalice: a saved reset expires in 6d 23h', options: ['Yes', 'No'] });
  await page.locator('.ext-ui-dialog-close').click();
  await expect.poll(() => responses(fleet.self)).toEqual([{ id: 'early-reset', value: 'No', cancelled: undefined }]);
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(0);
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

function responses(host: BrowserHost) {
  return (host.commands || []).filter(command => command.command === 'extension_ui_response')
    .map(command => ({ id: command.requestId ?? command.id, value: command.value, cancelled: command.cancelled }));
}

test('auth login steps render links, submit without dismissing, and replace in place by loginId', async ({ page, fleet }) => {
  await select(fleet, page, fleet.self);
  const url = 'https://auth.example.com/authorize?client_id=x&state=abc123';
  fleet.self.emit('extension_ui_request', { method: 'auth', id: 'step-1', loginId: 'login-1', title: 'Log in to Example', message: 'Open the page to continue',
    url, prompt: { kind: 'code', message: 'Paste the redirect URL', placeholder: 'http://localhost:1455/…' } });
  const card = page.locator('.ext-ui-auth-dialog');
  await expect(card.locator('.ext-ui-dialog-title')).toHaveText('Log in to Example');
  const link = card.locator('a.ext-ui-auth-open');
  await expect(link).toHaveText('Open sign-in page');
  await expect(link).toHaveAttribute('href', url);
  await expect(link).toHaveAttribute('target', '_blank');
  await card.locator('.ext-ui-dialog-min').click();
  await card.locator('.ext-ui-auth-input').evaluate((input: HTMLInputElement) => { input.value = 'http://localhost:1455/cb?code=c1&state=abc123'; });
  await card.click();
  await card.locator('.ext-ui-auth-input').press('Enter');
  await expect.poll(() => responses(fleet.self)).toEqual([{ id: 'step-1', value: 'http://localhost:1455/cb?code=c1&state=abc123', cancelled: undefined }]);
  await expect(card).toHaveClass(/submitting/);
  await expect(card.locator('.ext-ui-auth-submitting')).toBeVisible();
  await expect(card.locator('.ext-ui-auth-input')).toBeDisabled();

  fleet.self.emit('extension_ui_request', { method: 'auth', id: 'step-2', loginId: 'login-1', title: 'Log in to Example', message: 'Pick a plan',
    prompt: { kind: 'select', message: 'Which account?', options: [{ id: 'pro', label: 'Pro' }, { id: 'team', label: 'Team', description: 'Org' }] } });
  fleet.self.emit('extension_ui_resolved', { id: 'step-1', source: 'superseded' });
  await expect(card.locator('.ext-ui-dialog-option')).toHaveCount(2);
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(1);
  await expect(card).not.toHaveClass(/submitting/);
  await card.locator('.ext-ui-dialog-option', { hasText: 'Team' }).click();
  await expect.poll(() => responses(fleet.self).at(-1)).toEqual({ id: 'step-2', value: 'team', cancelled: undefined });
  await expect(card).toHaveClass(/submitting/);

  fleet.self.emit('extension_ui_resolved', { id: 'step-2', source: 'login' });
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(0);
});

test('auth cancel posts cancelled and non-http urls are not links', async ({ page, fleet }) => {
  await select(fleet, page, fleet.self);
  fleet.self.emit('extension_ui_request', { method: 'auth', id: 'step-x', loginId: 'login-x', title: 'Log in', url: 'javascript:alert(1)', userCode: 'ABCD-1234' });
  const card = page.locator('.ext-ui-auth-dialog');
  await expect(card.locator('.ext-ui-auth-user-code')).toHaveText('ABCD-1234');
  await expect(card.locator('.ext-ui-auth-waiting')).toBeVisible();
  await expect(card.locator('a')).toHaveCount(0);
  await card.locator('.ext-ui-dialog-close').click();
  await expect.poll(() => responses(fleet.self)).toEqual([{ id: 'step-x', value: undefined, cancelled: true }]);
  await expect(page.locator('.ext-ui-dialog-modal')).toHaveCount(0);
});

export {};
