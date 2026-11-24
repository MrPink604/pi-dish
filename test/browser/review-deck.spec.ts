import fs = require('node:fs');
import path = require('node:path');
import zlib = require('node:zlib');
import { record as isRecord } from '../../lib/helper-values.js';
import { test, expect, ROOT, heldRoute, requiredRoute } from './fixtures.js';
import type { BrowserHost } from './fixtures.js';

test.use({ instrumentApp: false, liveSessions: true });

// Minimal pure-Node RGB PNG generator so screenshots show realistic UI cards.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tag = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])), 0);
  return Buffer.concat([len, tag, data, crc]);
}

function makeMockShotPng(bg: [number, number, number], bar: [number, number, number], accent: [number, number, number]): Buffer {
  const width = 280;
  const height = 160;
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = bg;
      if (y < 24) rgb = bar;
      else if (x >= 18 && x < 262 && y >= 40 && y < 96) rgb = accent;
      else if (x >= 18 && x < 176 && y >= 110 && y < 126) rgb = bar;
      else if (x >= 18 && x < 236 && y >= 134 && y < 144) rgb = bar;
      const off = row + 1 + x * 3;
      raw[off] = rgb[0];
      raw[off + 1] = rgb[1];
      raw[off + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function seedWorkAndTranscript(host: BrowserHost, options: { extraTurns?: number; withReviewResponse?: boolean } = {}): { workDir: string; shotsDir: string } {
  const workDir = path.join(host.home, 'work');
  const shotsDir = path.join(host.home, '.pi/dish/uploads', `pi-${ROOT}`);
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.writeFileSync(path.join(shotsDir, 'hero-a.png'), makeMockShotPng([10, 44, 56], [19, 71, 90], [38, 139, 210]));
  fs.writeFileSync(path.join(shotsDir, 'hero-b.png'), makeMockShotPng([22, 34, 46], [42, 62, 82], [42, 161, 152]));
  fs.writeFileSync(path.join(shotsDir, 'hero-c.png'), makeMockShotPng([36, 30, 26], [68, 52, 42], [203, 75, 22]));
  fs.writeFileSync(path.join(shotsDir, 'detail.png'), makeMockShotPng([18, 42, 38], [34, 72, 64], [133, 153, 0]));

  const sessionPath = path.join(host.home, '.pi/agent/sessions/project', `${ROOT}.jsonl`);
  const entries: Record<string, unknown>[] = [
    { type: 'session', cwd: workDir, timestamp: '2026-09-09T00:00:00.000Z' },
  ];
  const extra = options.extraTurns ?? 0;
  for (let i = 0; i < extra; i++) {
    entries.push(
      { type: 'message', message: { role: 'user', content: `Earlier check #${i + 1}: verify spacing, contrast, and token mapping across viewports.` } },
      { type: 'message', message: { role: 'assistant', content: `Completed pass #${i + 1}. Audited transcript spacing, header alignment, and card borders at 390px and desktop widths.` } },
    );
  }
  entries.push(
    { type: 'message', message: { role: 'user', content: 'Review the hero crops and sign off before we merge.' } },
    {
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I rendered three candidate hero crops and checked the dark-mode contrast. Ready for your review below.' },
          { type: 'toolCall', id: 'tc-shot-1', name: 'bash', arguments: { command: 'ls -la shots/' } },
        ],
      },
    },
    {
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'tc-shot-1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'hero-a.png\nhero-b.png\nhero-c.png\ndetail.png\n' }],
      },
    },
    {
      type: 'message',
      message: {
        role: 'assistant',
        content: 'Everything is staged in the inline review deck below. Defaults are preselected so you can tap straight through.',
      },
    },
  );
  if (options.withReviewResponse) {
    entries.push({
      type: 'message',
      message: {
        role: 'user',
        content: '[review response: Earlier pass (rv_0000000000000001), submitted 2026-09-09T00:02:00Z]\nhero: A (default)\n',
      },
    });
  }
  fs.writeFileSync(sessionPath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  return { workDir, shotsDir };
}

async function createDeck(
  base: string,
  sessionId: string,
  spec: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ id: string; review: Record<string, unknown> }> {
  const response = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pi-Dish-Client': '1', ...headers },
    body: JSON.stringify(spec),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || !isRecord(body.review) || typeof body.review.id !== 'string') {
    throw new Error(`Review creation failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return { id: body.review.id, review: body.review };
}

test('inline review deck at 390x844 in Solarized Dark and Graphite: stepping, lightbox, drafts, Focus mode, jump bar, and submit delivery', async ({ page, fleet }) => {
  const { self } = fleet;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  const { workDir, shotsDir } = seedWorkAndTranscript(self, { extraTurns: 6, withReviewResponse: true });

  // Publish a companion page so the header's "Full ↗" link renders and resolves.
  const pageDir = path.join(workDir, 'companion');
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'index.html'), '<!doctype html><html><body><h1>Full details</h1></body></html>');
  const pageRes = await fetch(`${self.base}/api/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: pageDir, sessionId: ROOT, title: 'Hero crops full sheet' }),
  });
  const pageBody: unknown = await pageRes.json();
  const companionPath = isRecord(pageBody) && typeof pageBody.path === 'string' ? pageBody.path : null;
  expect(companionPath).toMatch(/^\/page\//);

  const created = await createDeck(self.base, ROOT, {
    title: 'Hero crops & release sign-off',
    companionPage: companionPath,
    cards: [
      {
        id: 'hero',
        title: 'Hero crop & lighting',
        context: 'Compare the three hero crops captured at **390px**. Option A keeps the silhouette crisp against the card surface.',
        media: [
          { src: path.join(shotsDir, 'hero-a.png'), label: 'Option A — blue accent', alt: 'Option A mockup' },
          { src: path.join(shotsDir, 'hero-b.png'), label: 'Option B — cyan balance', alt: 'Option B mockup' },
          { src: path.join(shotsDir, 'hero-c.png'), label: 'Option C — warm contrast', alt: 'Option C mockup' },
        ],
        questions: [
          {
            id: 'hero_pick',
            type: 'choice',
            prompt: 'Which hero crop should ship?',
            default: 'A',
            why: 'Best foreground readability on phone displays.',
            allowOther: true,
            options: [
              { value: 'A', label: 'Option A — blue accent', description: 'Matches primary focus cues' },
              { value: 'B', label: 'Option B — cyan balance', description: 'Softer contrast on OLED' },
              { value: 'C', label: 'Option C — warm contrast', description: 'Higher visual emphasis' },
            ],
          },
        ],
      },
      {
        id: 'signoff',
        title: 'Release sign-off',
        context: 'Dark-mode contrast and token checks passed across both built-in themes.',
        media: [
          { src: path.join(shotsDir, 'detail.png'), label: 'Detail check — green token', alt: 'Detail view mockup' },
        ],
        questions: [
          {
            id: 'polish',
            type: 'multi',
            prompt: 'Include finishing passes?',
            default: ['crop'],
            options: [
              { value: 'crop', label: 'Tight mobile crop' },
              { value: 'caption', label: 'Keep figure captions' },
            ],
          },
          {
            id: 'ship',
            type: 'approve',
            prompt: 'Ready to commit this pass?',
            default: 'approve',
            why: 'All checks and browser smoke tests pass.',
            approveLabel: 'Approve',
            reviseLabel: 'Request changes',
          },
          {
            id: 'followup',
            type: 'text',
            prompt: 'Optional follow-up note',
            placeholder: 'Anything to adjust next…',
          },
        ],
      },
    ],
  });

  // Select session, then switch to phone viewport (390x844).
  await fleet.row(self, ROOT).click();
  await page.setViewportSize({ width: 390, height: 844 });

  const deck = page.locator(`.review-deck[data-review-id="${created.id}"]`);
  await expect(deck).toBeVisible();
  await expect(deck).toHaveClass(/\bis-open\b/);

  // Wait for visible shots on card 1 to finish decoding.
  await expect.poll(async () => deck.locator('.review-card[data-card-index="0"] img.review-shot-img').evaluateAll(
    imgs => imgs.length === 3 && imgs.every(img => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0),
  )).toBe(true);

  // Only one card visible at a time; defaults preselected; no auto-focused input.
  await expect(deck.locator('.review-card[data-card-index="0"]')).toBeVisible();
  await expect(deck.locator('.review-card[data-card-index="1"]')).toBeHidden();
  await expect(deck.locator('.review-step-label')).toHaveText('Card 1 of 2: Hero crop & lighting');
  await expect(deck.locator('.review-option[data-question-id="hero_pick"][data-value="A"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(deck.locator('.review-option[data-question-id="hero_pick"][data-value="A"] .ext-ui-ask-recommended')).toHaveText('Recommended');
  await expect(deck.locator('.review-page-link')).toHaveAttribute('href', companionPath!);
  expect(await page.evaluate(() => {
    const tag = document.activeElement?.tagName ?? '';
    return tag === 'INPUT' || tag === 'TEXTAREA';
  })).toBe(false);

  // Direct child of #messages (never swept into details.tool-group); collapsed response notice rendered.
  expect(await deck.evaluate(el => el.parentElement?.id === 'messages')).toBe(true);
  await expect(page.locator('.message.custom-message.review-response-notice')).toHaveCount(1);

  // Tap targets >= 44px on options; zero horizontal overflow at 390px.
  for (const val of ['A', 'B', 'C']) {
    const box = await deck.locator(`.review-option[data-question-id="hero_pick"][data-value="${val}"]`).boundingBox();
    expect(box && box.height >= 44, `option ${val} tap height >= 44px`).toBe(true);
  }
  const checkLayoutAndTheme = async (expectedBgCard: string) => page.evaluate((bg) => {
    const docOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    const msgEl = document.getElementById('messages');
    const msgOverflow = !msgEl || msgEl.scrollWidth <= msgEl.clientWidth + 1;
    const deckEl = document.querySelector<HTMLElement>('.review-deck');
    const cardBg = deckEl ? getComputedStyle(deckEl).backgroundColor : '';
    return { docOverflow, msgOverflow, cardBg, matches: cardBg === bg };
  }, expectedBgCard);

  // Solarized Dark theme check + optional screenshot.
  await deck.scrollIntoViewIfNeeded();
  expect(await checkLayoutAndTheme('rgb(7, 54, 66)')).toEqual({
    docOverflow: true, msgOverflow: true, cardBg: 'rgb(7, 54, 66)', matches: true,
  });
  const shotDir = process.env.REVIEW_DECK_SCREENSHOT_DIR;
  if (shotDir) {
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, 'review-deck-solarized-390x844.png') });
  }

  // Graphite theme check + optional screenshot.
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'graphite';
    localStorage.setItem('pi-dish-theme', 'graphite');
  });
  expect(await checkLayoutAndTheme('rgb(30, 35, 41)')).toEqual({
    docOverflow: true, msgOverflow: true, cardBg: 'rgb(30, 35, 41)', matches: true,
  });
  if (shotDir) {
    await page.screenshot({ path: path.join(shotDir, 'review-deck-graphite-390x844.png') });
  }

  // Lightbox navigation: tap shot 0, step to shot 1, Escape closes cleanly.
  await deck.locator('.review-shot-btn[data-card-index="0"][data-shot-index="0"]').click();
  const lightbox = page.locator('.lightbox-overlay.review-lightbox');
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator('.review-lightbox-counter')).toHaveText('1 / 3');
  await expect(lightbox.locator('.review-lightbox-caption')).toHaveText('Option A — blue accent');
  await lightbox.getByRole('button', { name: 'Next image' }).click();
  await expect(lightbox.locator('.review-lightbox-counter')).toHaveText('2 / 3');
  await expect(lightbox.locator('.review-lightbox-caption')).toHaveText('Option B — cyan balance');
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);

  // Change choice, open "+ Other / add note" (focuses on explicit tap), advance to Card 2, reload -> draft & step survive.
  await deck.locator('.review-option[data-question-id="hero_pick"][data-value="B"]').click();
  await deck.locator('.review-disclosure-toggle[data-question-id="hero_pick"]').click();
  const otherInput = deck.locator('input[data-review-input="other"][data-question-id="hero_pick"]');
  await expect(otherInput).toBeVisible();
  await expect(otherInput).toBeFocused();
  await deck.locator('input[data-review-input="note"][data-question-id="hero_pick"]').fill('Prefer cooler cyan tint');
  await deck.locator('[data-review-action="next-card"]').click();
  await expect(deck.locator('.review-card[data-card-index="1"]')).toBeVisible();
  await expect(deck.locator('.review-option[data-question-id="polish"][data-value="crop"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(deck.locator('.review-card[data-card-index="0"]')).toBeHidden();
  expect(await page.evaluate(() => {
    const tag = document.activeElement?.tagName ?? '';
    return tag === 'INPUT' || tag === 'TEXTAREA';
  })).toBe(false);

  // Reload preserves Graphite theme, active card index (Card 2), and Card 1 edits.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');
  await expect(deck).toBeVisible();
  await expect(deck.locator('.review-step-label')).toHaveText('Card 2 of 2: Release sign-off');
  await deck.locator('[data-review-action="prev-card"]').click();
  await expect(deck.locator('.review-option[data-question-id="hero_pick"][data-value="B"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(deck.locator('input[data-review-input="note"][data-question-id="hero_pick"]')).toHaveValue('Prefer cooler cyan tint');

  // Focus mode hides tool calls/results while keeping the review deck visible.
  await page.locator('#btnPanel').click();
  await page.locator('#btnFocusMobile').click();
  await expect(page.locator('#messages')).toHaveClass(/\bfocus-mode\b/);
  await expect(deck).toBeVisible();
  await expect(page.locator('#messages details.tool-call, #messages details.tool-group, #messages .message.tool-result').first()).toBeHidden();

  // Scrolling far above the deck reveals the jump bar in .input-area; clicking jumps back.
  await page.evaluate(() => { const el = document.getElementById('messages'); if (el) el.scrollTop = 0; });
  const jumpBar = page.locator('.input-area .review-jump-bar');
  await expect(jumpBar).toBeVisible();
  await expect(jumpBar).toContainText('Hero crops & release sign-off');
  await jumpBar.click();
  await expect(deck).toBeInViewport();

  // Start a real live waiter (same path as `pi-dish-review wait`) and submit from the phone UI.
  const waiterPromise = fetch(`${self.base}/api/sessions/${encodeURIComponent(ROOT)}/reviews/${encodeURIComponent(created.id)}/wait?timeout=15`, {
    headers: { 'X-Pi-Dish-Client': '1' },
  }).then(async res => ({ status: res.status, body: await res.json() as unknown }));

  let sentClientHeader: string | null = null;
  page.on('request', req => {
    if (req.method() === 'POST' && req.url().endsWith(`/reviews/${created.id}/submit`)) {
      sentClientHeader = req.headers()['x-pi-dish-client'] ?? null;
    }
  });

  await deck.locator('[data-review-action="next-card"]').click();
  await deck.locator('textarea[data-review-input="text"][data-question-id="followup"]').fill('Ship after dark check');
  await deck.locator('[data-review-action="submit"]').click();

  // Deck collapses in place to a 1-line receipt; [Show] expands detailed answers.
  await expect(deck).toHaveClass(/\bis-submitted\b/);
  await expect(deck.locator('.review-receipt-title')).toHaveText('Reviewed Hero crops & release sign-off');
  await expect(deck.locator('.review-receipt-meta')).toContainText('changed');
  expect(sentClientHeader).toBe('1');
  await expect(page.locator('.input-area .review-jump-bar')).toHaveCount(0);

  await deck.locator('[data-review-action="toggle-receipt"]').click();
  await expect(deck.locator('.review-receipt-body')).toContainText('Prefer cooler cyan tint');
  await expect(deck.locator('.review-receipt-body')).toContainText('Ship after dark check');
  await deck.locator('[data-review-action="toggle-receipt"]').click();
  await expect(deck.locator('.review-receipt-body')).toHaveCount(0);

  // Live waiter received the exact answers end-to-end, and SSE clears the `sending…` badge.
  const waited = await waiterPromise;
  expect(waited.status).toBe(200);
  const result = isRecord(waited.body) && isRecord(waited.body.result) ? waited.body.result : null;
  expect(result?.status).toBe('submitted');
  expect(isRecord(result?.answers) && isRecord(result.answers.hero_pick) ? result.answers.hero_pick : null).toEqual({
    value: 'B',
    default: false,
    note: 'Prefer cooler cyan tint',
  });
  expect(isRecord(result?.answers) && isRecord(result.answers.followup) ? result.answers.followup.value : null).toBe('Ship after dark check');
  await expect(deck.locator('.review-delivery-badge')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('peer /hosts/<name> proxying, submit error recovery, and HTML/JS version skew degrade safely', async ({ page, fleet }) => {
  const { self, peer } = fleet;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Register `peer` as a hub-proxied remote on `self` and clear device-local peer catalog
  // so every browser call goes through `/hosts/remote/api/...`.
  fs.writeFileSync(path.join(self.home, '.pi/dish/settings.json'), JSON.stringify({
    remotes: [{ name: 'remote', url: peer.base, token: peer.token }],
  }));
  const { shotsDir: peerShots } = seedWorkAndTranscript(peer);

  const peerDeck = await createDeck(peer.base, ROOT, {
    title: 'Remote peer review',
    cards: [{
      id: 'c1',
      title: 'Check remote shot',
      context: 'Served through `/hosts/remote`.',
      media: [{ src: path.join(peerShots, 'detail.png'), label: 'Remote shot' }],
      questions: [{
        id: 'ok',
        type: 'approve',
        prompt: 'Looks good from remote host?',
        default: 'approve',
      }],
    }],
  }, { Authorization: `Bearer ${peer.token}` });

  // Open a clean tab without the fixture's localStorage direct-peer init script
  // so `self` advertises `peer` exclusively via hub-proxied `/hosts/remote`.
  await page.evaluate(() => localStorage.removeItem('pi-dish-hosts'));
  const tab = await page.context().newPage();
  tab.on('pageerror', error => errors.push(error.message));
  try {
    await tab.setViewportSize({ width: 390, height: 844 });
    await tab.goto(self.base);
    await tab.getByRole('button', { name: 'Open session list' }).click();
    await tab.locator('#tabAll').click();

    const peerRow = tab.locator(`.session-item[data-id="${ROOT}"][data-host="${peer.hostId}"]`);
    await expect(peerRow).toBeVisible();
    await peerRow.click();

    const deck = tab.locator(`.review-deck[data-review-id="${peerDeck.id}"]`);
    await expect(deck).toBeVisible();

    // Media loads through `/hosts/remote/api/sessions/.../media/0`.
    const img = deck.locator('img.review-shot-img');
    await expect(img).toHaveAttribute('src', new RegExp(`^/hosts/remote/api/sessions/${ROOT}/reviews/${peerDeck.id}/media/0$`));
    await expect.poll(async () => img.evaluate(el => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0)).toBe(true);

    // Transient 500 on submit clears busy state, preserves draft, shows inline error, and allows retry.
    await tab.route(`**/hosts/remote/api/sessions/${ROOT}/reviews/${peerDeck.id}/submit`, route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary failure' }) }), { times: 1 });
    await deck.locator('[data-review-action="submit"]').click();
    await expect(deck.locator('.review-error')).toContainText('Temporary failure');
    await expect(deck.locator('[data-review-action="submit"]')).toBeEnabled();

    // Retry succeeds through `/hosts/remote` with `X-Pi-Dish-Client: 1`.
    let proxyHeader: string | null = null;
    tab.on('request', req => {
      if (req.method() === 'POST' && req.url().includes(`/hosts/remote/api/sessions/${ROOT}/reviews/${peerDeck.id}/submit`)) {
        proxyHeader = req.headers()['x-pi-dish-client'] ?? null;
      }
    });
    await deck.locator('[data-review-action="submit"]').click();
    await expect(deck).toHaveClass(/\bis-submitted\b/);
    expect(proxyHeader).toBe('1');

    // Version skew: older server answering 404 on /reviews degrades silently.
    await tab.route(`**/api/sessions/${ROOT}/reviews`, route =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) }));
    await tab.getByRole('button', { name: 'Open session list' }).click();
    const selfRow = tab.locator(`.session-item[data-id="${ROOT}"][data-host="${self.hostId}"]`);
    await expect(selfRow).toBeVisible();
    await selfRow.click();
    await expect(tab.locator('#messages')).toContainText('self root transcript');
    await expect(tab.locator('.review-deck')).toHaveCount(0);
    // Missing optional `.input-area` shell markup never throws on scroll/jump-bar sync.
    await tab.evaluate(() => {
      document.querySelector('.input-area')?.remove();
      document.getElementById('messages')?.dispatchEvent(new Event('scroll'));
    });
    expect(errors).toEqual([]);
  } finally {
    await tab.close();
  }
});

test('reconnect reconciles missed decks, delayed lists never regress receipts, unchanged decks keep focus/caret, and quick-submit persists submissionId', async ({ page, fleet }) => {
  const { self } = fleet;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  seedWorkAndTranscript(self);
  const deck1 = await createDeck(self.base, ROOT, {
    title: 'Initial deck',
    wait: false,
    cards: [{
      id: 'c1',
      title: 'Step 1',
      context: 'Created before opening.',
      questions: [{ id: 'ok', type: 'approve', prompt: 'Approve initial?', default: 'approve' }],
    }],
  });

  // Hold the first list GET so we can replay its stale `open` snapshot after a receipt arrives.
  const staleList = heldRoute();
  let listRequests = 0;
  await page.route(`**/api/sessions/${ROOT}/reviews`, route => {
    if (route.request().method() === 'GET' && ++listRequests === 1) {
      staleList.hold(route);
      return;
    }
    return route.continue();
  });

  // First stream connect returns `init` then ends so EventSource triggers a real reconnect;
  // hold the reconnect stream to create a deterministic stream gap.
  const reconnectStream = heldRoute();
  let streamRequests = 0;
  await page.route(`**/api/sessions/${ROOT}/stream*`, route => {
    streamRequests++;
    if (streamRequests === 1) {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: 'event: init\ndata: {"turnInProgress":false,"compacting":false}\n\n',
      });
    }
    if (streamRequests === 2) {
      reconnectStream.hold(route);
      return;
    }
    return route.continue();
  });

  await fleet.row(self, ROOT).click();
  const heldListRoute = requiredRoute(await staleList.received);
  const heldReconnectRoute = requiredRoute(await reconnectStream.received);

  // While the stream is disconnected: submit deck1 and create deck2 on the server.
  const submitRes = await fetch(`${self.base}/api/sessions/${ROOT}/reviews/${deck1.id}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pi-Dish-Client': '1' },
    body: JSON.stringify({ submissionId: 'server-sub-0001', answers: { ok: { value: 'approve' } } }),
  });
  expect(submitRes.status).toBe(202);

  const deck2 = await createDeck(self.base, ROOT, {
    title: 'Created during gap',
    wait: false,
    cards: [
      {
        id: 'c1',
        title: 'Typing card',
        context: 'Created while the stream was down.',
        questions: [
          { id: 'note_q', type: 'text', prompt: 'Feedback' },
          { id: 'pick', type: 'choice', prompt: 'Choice', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
        ],
      },
      {
        id: 'c2',
        title: 'Final card',
        context: 'Second card so Accept defaults is available on card 1.',
        questions: [{ id: 'ship', type: 'approve', prompt: 'Ship?', default: 'approve' }],
      },
    ],
  });

  // Still in the stream gap: deck2 has not appeared yet.
  await expect(page.locator(`.review-deck[data-review-id="${deck2.id}"]`)).toHaveCount(0);

  // Reconnect the real SSE stream: `init` fetches /reviews once and reconciles both decks.
  await heldReconnectRoute.continue();
  const deck1El = page.locator(`.review-deck[data-review-id="${deck1.id}"]`);
  const deck2El = page.locator(`.review-deck[data-review-id="${deck2.id}"]`);
  await expect(deck1El).toHaveClass(/\bis-submitted\b/);
  await expect(deck2El).toBeVisible();

  // Releasing the earlier delayed `open` list snapshot must NEVER regress deck1's submitted receipt.
  await heldListRoute.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reviews: [deck1.review] }),
  });
  await page.waitForTimeout(150);
  await expect(deck1El).toHaveClass(/\bis-submitted\b/);
  await expect(deck2El).toBeVisible();

  // Promoted nit (a): transcript re-render must keep the existing deck DOM node, focus, caret, and typed text.
  const textarea = deck2El.locator('textarea[data-question-id="note_q"]');
  await textarea.click();
  await textarea.fill('hello world');
  await textarea.evaluate(el => {
    if (el instanceof HTMLTextAreaElement) {
      el.setSelectionRange(5, 5);
      Reflect.set(window, '__deckTextareaBefore', el);
    }
  });
  self.emit('turn_start', {});
  self.emit('message_end', {
    message: { role: 'assistant', content: 'A live update arrived while you were typing.', timestamp: Date.now() },
  }, {
    type: 'message',
    message: { role: 'assistant', content: 'A live update arrived while you were typing.', timestamp: Date.now() },
  });
  self.emit('turn_end', {});
  await expect(page.locator('#messages')).toContainText('A live update arrived while you were typing.');
  const preserved = await textarea.evaluate(el => ({
    sameNode: el === Reflect.get(window, '__deckTextareaBefore'),
    focused: document.activeElement === el,
    value: el instanceof HTMLTextAreaElement ? el.value : '',
    start: el instanceof HTMLTextAreaElement ? el.selectionStart : -1,
    end: el instanceof HTMLTextAreaElement ? el.selectionEnd : -1,
  }));
  expect(preserved).toEqual({ sameNode: true, focused: true, value: 'hello world', start: 5, end: 5 });

  // Promoted nit (b): untouched "Accept defaults" persists submissionId before sending so reload retries reuse it.
  const deck3 = await createDeck(self.base, ROOT, {
    title: 'Quick submit idempotency',
    wait: false,
    cards: [
      { id: 'c1', title: 'One', context: 'Card one.', questions: [{ id: 'q1', type: 'approve', prompt: 'Q1?', default: 'approve' }] },
      { id: 'c2', title: 'Two', context: 'Card two.', questions: [{ id: 'q2', type: 'approve', prompt: 'Q2?', default: 'approve' }] },
    ],
  });
  const deck3El = page.locator(`.review-deck[data-review-id="${deck3.id}"]`);
  await expect(deck3El).toBeVisible();
  const sentIds: string[] = [];
  await page.route(`**/api/sessions/${ROOT}/reviews/${deck3.id}/submit`, route => {
    const payload: unknown = route.request().postDataJSON();
    if (isRecord(payload) && typeof payload.submissionId === 'string') sentIds.push(payload.submissionId);
    if (sentIds.length === 1) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Retry me' }) });
    }
    return route.continue();
  });
  await deck3El.getByRole('button', { name: 'Accept defaults' }).click();
  await expect(deck3El.locator('.review-error')).toContainText('Retry me');
  expect(sentIds).toHaveLength(1);
  const storedSubId = await page.evaluate(reviewId => {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.endsWith(`:${reviewId}`)) {
        const parsed: unknown = JSON.parse(sessionStorage.getItem(k) || 'null');
        return parsed && typeof parsed === 'object' && 'submissionId' in parsed ? parsed.submissionId : null;
      }
    }
    return null;
  }, deck3.id);
  expect(storedSubId).toBe(sentIds[0]);

  await page.unroute(`**/api/sessions/${ROOT}/stream*`);
  await page.unroute(`**/api/sessions/${ROOT}/reviews`);
  await page.reload();
  await expect(deck3El).toBeVisible();
  await deck3El.getByRole('button', { name: 'Accept defaults' }).click();
  await expect(deck3El).toHaveClass(/\bis-submitted\b/);
  expect(sentIds).toEqual([sentIds[0], sentIds[0]]);
  expect(errors).toEqual([]);
});

test('direct bearer-protected peer loads shots via revocable blob URLs and private sessions keep drafts in memory only', async ({ page, fleet }) => {
  const { self, peer } = fleet;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Part A: directly configured bearer-protected peer (from localStorage pi-dish-hosts, not /hosts/).
  const { shotsDir: peerShots } = seedWorkAndTranscript(peer);
  const peerDeck = await createDeck(peer.base, ROOT, {
    title: 'Direct bearer peer deck',
    wait: false,
    cards: [{
      id: 'c1',
      title: 'Bearer shots',
      context: 'Images load via authenticated fetch + revocable blob URL.',
      media: [
        { src: path.join(peerShots, 'hero-a.png'), label: 'Bearer shot A' },
        { src: path.join(peerShots, 'hero-b.png'), label: 'Bearer shot B' },
      ],
      questions: [{ id: 'ok', type: 'approve', prompt: 'Approve bearer shot?', default: 'approve' }],
    }],
  }, { Authorization: `Bearer ${peer.token}` });

  // Track revoked blob URLs without interfering with normal behavior.
  await page.evaluate(() => {
    const revoked: string[] = [];
    Reflect.set(window, '__revokedBlobUrls', revoked);
    const orig = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url: string) => { revoked.push(url); return orig(url); };
  });

  await fleet.row(peer, ROOT).click();
  const peerDeckEl = page.locator(`.review-deck[data-review-id="${peerDeck.id}"]`);
  await expect(peerDeckEl).toBeVisible();

  const imgs = peerDeckEl.locator('img.review-shot-img');
  await expect.poll(async () => imgs.evaluateAll(list =>
    list.length === 2 && list.every(img => img instanceof HTMLImageElement && img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0),
  )).toBe(true);

  const firstBlobSrcs = await imgs.evaluateAll(list => list.map(img => img instanceof HTMLImageElement ? img.src : ''));
  for (const src of firstBlobSrcs) expect(src).not.toContain(peer.token);

  // Lightbox also displays the authenticated blob URL and loads cleanly.
  await peerDeckEl.locator('.review-shot-btn[data-card-index="0"][data-shot-index="0"]').click();
  const lightboxImg = page.locator('.lightbox-overlay.review-lightbox img.review-lightbox-img');
  await expect(lightboxImg).toBeVisible();
  await expect.poll(async () => lightboxImg.evaluate(el =>
    el instanceof HTMLImageElement && el.src.startsWith('blob:') && el.complete && el.naturalWidth > 0,
  )).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.lightbox-overlay')).toHaveCount(0);

  // Switching to another session revokes the bearer peer's blob URLs.
  await fleet.row(self, ROOT).click();
  const revokedOnSwitch = await page.evaluate(() => Reflect.get(window, '__revokedBlobUrls') as string[]);
  for (const src of firstBlobSrcs) expect(revokedOnSwitch).toContain(src);

  // Returning re-fetches fresh blob URLs, and submitting revokes them as well.
  await fleet.row(peer, ROOT).click();
  await expect.poll(async () => imgs.evaluateAll(list =>
    list.length === 2 && list.every(img => img instanceof HTMLImageElement && img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0),
  )).toBe(true);
  const secondBlobSrcs = await imgs.evaluateAll(list => list.map(img => img instanceof HTMLImageElement ? img.src : ''));
  await peerDeckEl.locator('[data-review-action="submit"]').click();
  await expect(peerDeckEl).toHaveClass(/\bis-submitted\b/);
  const revokedOnSubmit = await page.evaluate(() => Reflect.get(window, '__revokedBlobUrls') as string[]);
  for (const src of secondBlobSrcs) expect(revokedOnSubmit).toContain(src);

  // Part B: private session keeps review drafts in memory only — zero sessionStorage persistence across PIN lock.
  const pinRes = await fetch(`${self.base}/api/private-sessions/pin`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '4321' }),
  });
  expect(pinRes.status).toBe(200);
  const unlockBody: unknown = await (await fetch(`${self.base}/api/private-sessions/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '4321' }),
  })).json();
  const unlockToken = isRecord(unlockBody) && typeof unlockBody.token === 'string' ? unlockBody.token : '';
  expect(unlockToken).not.toBe('');

  const privId = '2026-09-09T00-05-00-private01';
  const privDir = path.join(self.home, '.local', 'state', 'pi-dish', 'private-sessions', 'pi');
  fs.mkdirSync(privDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(privDir, `${privId}.jsonl`), [
    { type: 'session', cwd: path.join(self.home, 'work'), timestamp: '2026-09-09T00:05:00.000Z' },
    { type: 'message', message: { role: 'user', content: 'Private review prompt' } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');

  const privDeck = await createDeck(self.base, privId, {
    title: 'Private session review',
    wait: false,
    cards: [
      {
        id: 'c1',
        title: 'Secret choices',
        context: 'Must never land in sessionStorage.',
        questions: [{
          id: 'secret_pick',
          type: 'choice',
          prompt: 'Pick one',
          default: 'a',
          allowOther: true,
          options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
        }],
      },
      {
        id: 'c2',
        title: 'Confirm',
        context: 'Step two.',
        questions: [{ id: 'secret_note', type: 'text', prompt: 'Private note' }],
      },
    ],
  }, { 'x-pi-dish-private-unlock': unlockToken });

  // Unlock in the browser via the real PIN modal and select the private session.
  await page.locator('#btnPrivateSessions').click();
  await page.locator('#privateUnlockPin').fill('4321');
  await page.locator('#privateUnlockForm button[type="submit"]').click();
  await page.locator('#tabAll').click();
  const privRow = page.locator(`.session-item[data-id="${privId}"]`);
  await expect(privRow).toBeVisible();
  await privRow.click();

  const privDeckEl = page.locator(`.review-deck[data-review-id="${privDeck.id}"]`);
  await expect(privDeckEl).toBeVisible();
  await privDeckEl.locator('.review-option[data-question-id="secret_pick"][data-value="b"]').click();
  await privDeckEl.locator('.review-disclosure-toggle[data-question-id="secret_pick"]').click();
  await privDeckEl.locator('input[data-review-input="note"][data-question-id="secret_pick"]').fill('top secret answer');

  // Draft works in memory across card navigation...
  await privDeckEl.locator('[data-review-action="next-card"]').click();
  await privDeckEl.locator('[data-review-action="prev-card"]').click();
  await expect(privDeckEl.locator('.review-option[data-question-id="secret_pick"][data-value="b"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(privDeckEl.locator('input[data-review-input="note"][data-question-id="secret_pick"]')).toHaveValue('top secret answer');

  // ...and NEVER writes to sessionStorage.
  const leakedBeforeLock = await page.evaluate(id => {
    const out: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) || '';
      const v = sessionStorage.getItem(k) || '';
      if (k.includes(id) || v.includes('top secret answer')) out.push(`${k}=${v}`);
    }
    return out;
  }, privId);
  expect(leakedBeforeLock).toEqual([]);

  // Locking private sessions reloads and leaves zero trace in sessionStorage.
  await Promise.all([
    page.waitForNavigation(),
    page.locator('#btnPrivateSessions').click(),
  ]);
  const leakedAfterLock = await page.evaluate(id => {
    const out: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) || '';
      const v = sessionStorage.getItem(k) || '';
      if (k.includes(id) || v.includes('top secret answer')) out.push(`${k}=${v}`);
    }
    return out;
  }, privId);
  expect(leakedAfterLock).toEqual([]);
  expect(errors).toEqual([]);
});

export {};
