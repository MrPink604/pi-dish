import type { Page } from '@playwright/test';
import fs = require('node:fs');
import path = require('node:path');
import { isRecord } from '../../lib/wire-protocol.js';
import { test, expect, ROOT } from './fixtures.js';

// A published page is served by the app's own listener. Its scripts, relative
// assets and comment overlay must work, while the app origin's storage (fleet
// tokens, prompt history) and same-origin API stay out of reach.
const INDEX = `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>
<p id="prose">Isolated page prose for review</p>
<output id="storage">pending</output><output id="api">pending</output>
<output id="asset">pending</output><output id="data">pending</output>
<script>
  const show = (id, value) => { document.getElementById(id).textContent = value; };
  try { show('storage', 'read:' + localStorage.getItem('pi-dish-history-probe')); }
  catch (error) { show('storage', error.name); }
  fetch('/api/sessions').then(() => show('api', 'read'), () => show('api', 'blocked'));
  fetch('data.json').then(response => response.json()).then(data => show('data', data.value), () => show('data', 'failed'));
</script>
<script src="asset.js"></script>
</body></html>`;

async function selectProse(tab: Page) {
  await tab.evaluate(() => {
    const node = document.getElementById('prose')?.firstChild;
    const selection = window.getSelection();
    if (!node || !selection) throw new Error('Missing prose selection');
    const range = document.createRange();
    range.setStart(node, 'Isolated '.length);
    range.setEnd(node, 'Isolated page prose'.length);
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
}

test('a published page runs its scripts, assets and comments without the app origin', async ({ page, fleet }) => {
  const { self } = fleet;
  const site = path.join(self.home, 'published-site');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'index.html'), INDEX);
  fs.writeFileSync(path.join(site, 'asset.js'), "document.getElementById('asset').textContent = 'loaded';");
  fs.writeFileSync(path.join(site, 'style.css'), '#prose { color: rgb(1, 2, 3); }');
  fs.writeFileSync(path.join(site, 'data.json'), '{"value":"relative"}');
  const response = await fetch(`${self.base}/api/pages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: site, sessionId: ROOT, title: 'Isolated' }),
  });
  const published: unknown = await response.json();
  if (!isRecord(published) || typeof published.path !== 'string' || typeof published.token !== 'string') {
    throw new Error(`Page publish failed: ${JSON.stringify(published)}`);
  }

  const tab = await page.context().newPage();
  // Browse as `localhost`, a secure context, so the app origin can hold a
  // stand-in for an auth proxy's session: Cloudflare Access sets
  // CF_Authorization SameSite=None; Secure by default. The app origin also
  // holds a prompt history the page must not read.
  const app = self.base.replace('127.0.0.1', 'localhost');
  await tab.goto(`${app}/api/host`);
  await tab.evaluate(() => {
    document.cookie = 'CF_Authorization=proxy-session; Path=/; SameSite=None; Secure';
    localStorage.setItem('pi-dish-history-probe', JSON.stringify(['a lost prompt']));
  });
  const errors: string[] = [];
  tab.on('pageerror', error => errors.push(error.message));
  const overlayCalls: Promise<string>[] = [];
  tab.on('request', request => {
    if (!new URL(request.url()).pathname.startsWith('/api/page-comments/')) return;
    overlayCalls.push(request.allHeaders().then(headers =>
      `${request.method()} ${headers['content-type'] ?? '-'} ${headers.cookie ?? 'no cookie'}`));
  });
  // The overlay's shadow root is closed; open it so locators can reach it.
  await tab.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) { return original.call(this, { ...init, mode: 'open' }); };
  });
  await tab.goto(`${app}${published.path}/`);
  await expect(tab.locator('#storage')).toHaveText('SecurityError');
  await expect(tab.locator('#api')).toHaveText('blocked');
  await expect(tab.locator('#asset')).toHaveText('loaded');
  await expect(tab.locator('#data')).toHaveText('relative');
  await expect(tab.locator('#prose')).toHaveCSS('color', 'rgb(1, 2, 3)');
  expect(await tab.evaluate(() => origin)).toBe('null');

  const layer = tab.locator('#pi-dish-comment-layer');
  await selectProse(tab);
  await expect(layer.locator('#card')).toBeVisible();
  await layer.locator('#body').fill('Name the sandbox flags.');
  await layer.locator('#send').click();
  // An auth proxy answers a preflight with its login redirect: every call must
  // be a safelisted GET or text/plain POST.
  await expect(layer.locator('#toast')).toHaveText('Comment saved');
  await expect(tab.locator('mark[data-pi-dish-comment]')).toHaveText('page prose');
  const calls = await Promise.all(overlayCalls);
  expect(calls.length).toBeGreaterThanOrEqual(3);
  for (const call of calls) {
    expect(call).toMatch(/^(GET -|POST text\/plain;charset=UTF-8) /);
    expect(call).toContain('CF_Authorization=proxy-session');
  }

  const index: unknown = await (await fetch(`${self.base}/api/comments/index?sessionId=${ROOT}`)).json();
  const entries = isRecord(index) && Array.isArray(index.comments) ? index.comments : [];
  expect(entries.map(entry => isRecord(entry) && isRecord(entry.target) ? entry.target.pageToken : null))
    .toEqual([published.token]);
  // The app origin still reads its own storage.
  await tab.goto(`${app}/api/host`);
  expect(await tab.evaluate(() => localStorage.getItem('pi-dish-history-probe'))).toBe('["a lost prompt"]');
  expect(errors).toEqual([]);
  await tab.close();
});
