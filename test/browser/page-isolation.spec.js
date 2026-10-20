// Generated test/tool from test/browser/page-isolation.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const fixtures_js_1 = require("./fixtures.js");
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
async function selectProse(tab) {
    await tab.evaluate(() => {
        const node = document.getElementById('prose')?.firstChild;
        const selection = window.getSelection();
        if (!node || !selection)
            throw new Error('Missing prose selection');
        const range = document.createRange();
        range.setStart(node, 'Isolated '.length);
        range.setEnd(node, 'Isolated page prose'.length);
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
}
(0, fixtures_js_1.test)('a published page runs its scripts, assets and comments without the app origin', async ({ page, fleet }) => {
    const { self } = fleet;
    const site = path.join(self.home, 'published-site');
    fs.mkdirSync(site);
    fs.writeFileSync(path.join(site, 'index.html'), INDEX);
    fs.writeFileSync(path.join(site, 'asset.js'), "document.getElementById('asset').textContent = 'loaded';");
    fs.writeFileSync(path.join(site, 'style.css'), '#prose { color: rgb(1, 2, 3); }');
    fs.writeFileSync(path.join(site, 'data.json'), '{"value":"relative"}');
    const response = await fetch(`${self.base}/api/pages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: site, sessionId: fixtures_js_1.ROOT, title: 'Isolated' }),
    });
    const published = await response.json();
    if (!(0, wire_protocol_js_1.isRecord)(published) || typeof published.path !== 'string' || typeof published.token !== 'string') {
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
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    const overlayCalls = [];
    tab.on('request', request => {
        if (!new URL(request.url()).pathname.startsWith('/api/page-comments/'))
            return;
        overlayCalls.push(request.allHeaders().then(headers => `${request.method()} ${headers['content-type'] ?? '-'} ${headers.cookie ?? 'no cookie'}`));
    });
    // The overlay's shadow root is closed; open it so locators can reach it.
    await tab.addInitScript(() => {
        const original = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init) { return original.call(this, { ...init, mode: 'open' }); };
    });
    await tab.goto(`${app}${published.path}/`);
    await (0, fixtures_js_1.expect)(tab.locator('#storage')).toHaveText('SecurityError');
    await (0, fixtures_js_1.expect)(tab.locator('#api')).toHaveText('blocked');
    await (0, fixtures_js_1.expect)(tab.locator('#asset')).toHaveText('loaded');
    await (0, fixtures_js_1.expect)(tab.locator('#data')).toHaveText('relative');
    await (0, fixtures_js_1.expect)(tab.locator('#prose')).toHaveCSS('color', 'rgb(1, 2, 3)');
    (0, fixtures_js_1.expect)(await tab.evaluate(() => origin)).toBe('null');
    const layer = tab.locator('#pi-dish-comment-layer');
    await selectProse(tab);
    await (0, fixtures_js_1.expect)(layer.locator('#card')).toBeVisible();
    await layer.locator('#body').fill('Name the sandbox flags.');
    await layer.locator('#send').click();
    // An auth proxy answers a preflight with its login redirect: every call must
    // be a safelisted GET or text/plain POST.
    await (0, fixtures_js_1.expect)(layer.locator('#toast')).toHaveText('Comment saved');
    await (0, fixtures_js_1.expect)(tab.locator('mark[data-pi-dish-comment]')).toHaveText('page prose');
    const calls = await Promise.all(overlayCalls);
    (0, fixtures_js_1.expect)(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
        (0, fixtures_js_1.expect)(call).toMatch(/^(GET -|POST text\/plain;charset=UTF-8) /);
        (0, fixtures_js_1.expect)(call).toContain('CF_Authorization=proxy-session');
    }
    const index = await (await fetch(`${self.base}/api/comments/index?sessionId=${fixtures_js_1.ROOT}`)).json();
    const entries = (0, wire_protocol_js_1.isRecord)(index) && Array.isArray(index.comments) ? index.comments : [];
    (0, fixtures_js_1.expect)(entries.map(entry => (0, wire_protocol_js_1.isRecord)(entry) && (0, wire_protocol_js_1.isRecord)(entry.target) ? entry.target.pageToken : null))
        .toEqual([published.token]);
    // The app origin still reads its own storage.
    await tab.goto(`${app}/api/host`);
    (0, fixtures_js_1.expect)(await tab.evaluate(() => localStorage.getItem('pi-dish-history-probe'))).toBe('["a lost prompt"]');
    (0, fixtures_js_1.expect)(errors).toEqual([]);
    await tab.close();
});
