#!/usr/bin/env node
/**
 * UI smoke test — boots server.js against a temp HOME containing a fake
 * *live* bridge session (Unix socket + registry entry, per the pattern in
 * CLAUDE.md), then drives real Chrome over CDP with the globally installed
 * playwright and asserts the core flows:
 *
 *   1. desktop: live session listed under Active, selecting renders messages
 *   2. prompt round-trip: send → streamed message_update renders live →
 *      turn_end swaps in the authoritative JSONL render
 *   3. mobile: hamburger opens the drawer from both the empty state and the
 *      session header; drawer closes on session pick
 *   4. zero pageerrors / console errors throughout
 *
 * Not part of `npm test` (needs Chrome). Run with: npm run test:ui
 */
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

// --- temp HOME with one live fixture session ---------------------------------
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-ui-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';

const SESSION_ID = '2026-07-05T00-00-00-uismoke1';
// Real on-disk cwd so @-mentions and the cwd picker have something to find.
const CWD = path.join(tmpHome, 'workspace', 'proj-alpha');
fs.mkdirSync(path.join(CWD, 'src'), { recursive: true });
fs.writeFileSync(path.join(CWD, 'src', 'main.js'), 'console.log(1);\n');
fs.writeFileSync(path.join(CWD, 'README.md'), '# alpha\n');
const sessionDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-proj--');
const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
fs.mkdirSync(sessionDir, { recursive: true });
fs.mkdirSync(registryDir, { recursive: true });

const sessionFile = path.join(sessionDir, `${SESSION_ID}.jsonl`);
const appendEntry = (e) => fs.appendFileSync(sessionFile, JSON.stringify(e) + '\n');
appendEntry({ type: 'session', cwd: CWD, timestamp: '2026-07-05T00:00:00.000Z' });
appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'existing question' }], timestamp: '2026-07-05T00:00:01.000Z' } });
appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'existing **answer**' }], timestamp: '2026-07-05T00:00:02.000Z' } });
// Pad the history so the feed is taller than the viewport — the forced-follow
// scroll check needs a genuinely scrollable container to mean anything.
for (let i = 0; i < 8; i++) {
  appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: `filler question ${i}` }], timestamp: `2026-07-05T00:01:0${i}.000Z` } });
  appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: `filler answer ${i}\n\nwith a second paragraph of text to take up vertical space in the feed.` }], timestamp: `2026-07-05T00:01:0${i}.500Z` } });
}

// --- fake bridge socket -------------------------------------------------------
// Speaks the newline-delimited JSON protocol from lib/bridge-session.js:
// requests {id, command, ...} -> {type:'response', id, success, data};
// events pushed as {type:'event', event, data}. On `prompt` it streams a
// whole turn and appends the resulting messages to the JSONL, so the real
// SSE -> streaming-renderer -> catch-up path is exercised end to end.
const socketPath = path.join(tmpHome, 'bridge.sock');
const clients = new Set();
const emit = (event, data) => {
  const line = JSON.stringify({ type: 'event', event, data }) + '\n';
  for (const c of clients) c.write(line);
};

const bridge = net.createServer((sock) => {
  clients.add(sock);
  sock.on('close', () => clients.delete(sock));
  sock.on('error', () => clients.delete(sock));
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf-8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      handleCommand(sock, msg);
    }
  });
});

function respond(sock, id, data) {
  sock.write(JSON.stringify({ type: 'response', id, success: true, data }) + '\n');
}

function handleCommand(sock, msg) {
  switch (msg.command) {
    case 'get_available_models':
      return respond(sock, msg.id, { models: [
        { id: 'smoke-model', provider: 'test', name: 'Smoke Model' },
        { id: 'other-model', provider: 'test', name: 'Other Model' },
      ] });
    case 'get_commands':
      return respond(sock, msg.id, [{ name: 'help', description: 'show help', source: 'builtin' }]);
    case 'prompt':
      respond(sock, msg.id, {});
      return streamTurn(msg.message);
    case 'set_session_name':
      // Mirror the real bridge: keep the registry entry fresh so polls
      // don't revert the rename.
      writeRegistry({ name: msg.name });
      return respond(sock, msg.id, {});
    default:
      return respond(sock, msg.id, {});
  }
}

function streamTurn(userText) {
  const now = () => new Date().toISOString();
  appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: userText }], timestamp: now() } });
  emit('turn_start', {});
  const full = 'Streamed reply with **bold** and `code`.';
  let i = 0;
  const tick = setInterval(() => {
    i = Math.min(full.length, i + 12);
    const message = { role: 'assistant', content: [{ type: 'text', text: full.slice(0, i) }] };
    emit('message_update', { message });
    if (i >= full.length) {
      clearInterval(tick);
      const done = { role: 'assistant', content: [{ type: 'text', text: full }], timestamp: now() };
      appendEntry({ type: 'message', message: done });
      emit('message_end', { message: done });
      emit('turn_end', {});
    }
  }, 60);
}

// --- assertions ---------------------------------------------------------------
let failures = 0;
function check(cond, label) {
  if (cond) { console.log(`  ✔ ${label}`); }
  else { failures++; console.error(`  ✘ ${label}`); }
}

let registryState = {
  sessionId: SESSION_ID,
  socketPath,
  sessionFile,
  pid: process.pid,
  cwd: CWD,
  name: 'smoke session',
  model: 'smoke-model',
  contextUsage: { tokens: 1200, contextWindow: 100000, percent: 1.2 },
};

function writeRegistry(patch = {}) {
  registryState = { ...registryState, ...patch };
  fs.writeFileSync(path.join(registryDir, `${SESSION_ID}.json`), JSON.stringify(registryState));
}

(async () => {
  await new Promise((r) => bridge.listen(socketPath, r));
  writeRegistry();

  const server = require('../server.js');
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { chromium } = require('playwright');
  const executablePath = process.env.CHROME_BIN || '/opt/google/chrome/chrome';
  const browser = await chromium.launch({ executablePath, headless: true });
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => {
      // Resource-load noise (e.g. a flaky favicon 404) isn't a JS failure.
      if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
        errors.push(`${tag} console: ${m.text()}`);
      }
    });
  };

  try {
    // 1. Desktop: list + select + history render
    console.log('desktop:');
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    watch(desktop, 'desktop');
    await desktop.goto(base, { waitUntil: 'networkidle' });
    await desktop.waitForSelector('.session-item');
    check(await desktop.locator('.session-item').count() === 1, 'live session listed under Active');
    await desktop.click('.session-item');
    await desktop.waitForSelector('.message.assistant');
    check(await desktop.locator('.message .markdown-body strong').first().textContent() === 'answer',
      'historical markdown rendered');

    // 2. Prompt round-trip through the fake bridge
    console.log('prompt round-trip:');
    await desktop.fill('#promptInput', 'ping from smoke test');
    await desktop.click('#btnSend');
    await desktop.waitForSelector('.session-item-status.working', { timeout: 2000 });
    check(true, 'sidebar working dot appears during the turn');
    await desktop.waitForSelector('.message.assistant[data-streaming="true"]', { timeout: 5000 });
    check(true, 'streaming element appeared');
    // Forced follow: a programmatic scroll displacement (stand-in for the
    // mobile keyboard resizing the container off the pin threshold) must not
    // break auto-follow mid-stream — only a deliberate gesture unpins.
    await desktop.evaluate(() => { document.getElementById('messages').scrollTop = 0; });
    await desktop.waitForTimeout(200); // let a streaming render land
    check(await desktop.evaluate(() => {
      const el = document.getElementById('messages');
      // guard: the feed must actually be scrollable or this check is vacuous
      return el.scrollHeight > el.clientHeight + 100 &&
        el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }), 'viewport re-follows the stream after a non-gesture scroll displacement');
    // after turn_end the streamed element is replaced by the JSONL render
    await desktop.waitForSelector('.message.assistant:not([data-streaming]) code', { timeout: 5000 });
    const finals = await desktop.locator('.message.assistant').allTextContents();
    check(finals.some(t => t.includes('Streamed reply with')), 'final assistant message rendered');
    check(await desktop.locator('.message.assistant[data-streaming="true"]').count() === 0,
      'streaming placeholder cleaned up');
    await desktop.waitForTimeout(200);
    check(await desktop.locator('.session-item-status.working').count() === 0,
      'working dot cleared after the turn');

    // 3. @-mention: fuzzy file search under the session cwd (fff-backed)
    console.log('@-mentions:');
    await desktop.fill('#promptInput', '');
    await desktop.type('#promptInput', 'look at @ma');
    await desktop.waitForSelector('.autocomplete-item[data-file]', { timeout: 5000 });
    check(true, '@ dropdown appeared');
    const first = await desktop.locator('.autocomplete-item[data-file]').first().getAttribute('data-file');
    check(first === 'src/main.js', `top match is src/main.js (got ${first})`);
    await desktop.keyboard.press('Tab');
    const promptVal = await desktop.inputValue('#promptInput');
    check(promptVal === 'look at @src/main.js ', `mention inserted (got ${JSON.stringify(promptVal)})`);
    await desktop.fill('#promptInput', '');

    // 4. cwd picker: fuzzy directory search under $HOME
    console.log('cwd picker:');
    await desktop.fill('#newSessionCwd', '');
    await desktop.type('#newSessionCwd', 'alpha');
    await desktop.waitForSelector('.cwd-option', { timeout: 5000 });
    const opts = await desktop.locator('.cwd-option').allTextContents();
    check(opts.some(t => t.includes('workspace/proj-alpha')), 'proj-alpha found by fuzzy dir search');
    await desktop.keyboard.press('Escape');

    // 5. Rename propagates to the sidebar without a reload
    console.log('rename:');
    await desktop.click('#sessionName');
    await desktop.fill('#sessionNameInput', 'renamed live');
    await desktop.keyboard.press('Enter');
    await desktop.waitForTimeout(400);
    check(await desktop.locator('#sessionName').textContent() === 'renamed live', 'header shows new name');
    const itemName = await desktop.locator('.session-item-name').first().textContent();
    check(itemName === 'renamed live', `sidebar shows new name without reload (got ${JSON.stringify(itemName)})`);

    // 3. Mobile: hamburger + drawer from empty state and session header
    console.log('mobile:');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    watch(mobile, 'mobile');
    await mobile.goto(base, { waitUntil: 'networkidle' });
    await mobile.evaluate(() => localStorage.removeItem('pi-dish-session'));
    await mobile.reload({ waitUntil: 'networkidle' });
    check(await mobile.locator('.empty-menu-btn').isVisible(), 'empty-state hamburger visible');
    await mobile.click('.empty-menu-btn');
    await mobile.waitForSelector('.sidebar.open');
    check(true, 'drawer opens from empty state');
    await mobile.click('.session-item');
    await mobile.waitForSelector('.message.assistant');
    check(!(await mobile.locator('.sidebar').evaluate(el => el.classList.contains('open'))),
      'drawer closes after picking a session');
    const box = await mobile.locator('.header-menu-btn').boundingBox();
    check(box && box.x >= 0 && box.y >= 0 && box.width >= 36, 'header hamburger visible in layout');

    // Layout contract: model selector top-right, context badge bottom-left
    const vp = mobile.viewportSize();
    const model = await mobile.locator('#sessionModel').boundingBox();
    check(model && model.x > vp.width / 2 && model.y < 60, 'model selector sits top-right');
    const ctx = await mobile.locator('#sessionContextBar').boundingBox();
    check(ctx && ctx.x < vp.width / 4 && ctx.y > vp.height / 2, 'context badge sits bottom-left');
    check(!(await mobile.locator('#sessionContext').isVisible()), 'header context badge hidden on mobile');
    await mobile.click('#sessionModel');
    await mobile.waitForSelector('.model-option', { timeout: 5000 });
    check(await mobile.locator('.model-option').count() >= 2, 'model dropdown opens from header');
    const sheet = await mobile.locator('.model-dropdown').boundingBox();
    check(sheet && sheet.y < 120, 'model dropdown drops from the top on mobile');
    await mobile.click('.messages'); // dismiss dropdown
    await mobile.waitForTimeout(200);
    await mobile.click('.header-menu-btn');
    await mobile.waitForSelector('.sidebar.open');
    check(true, 'drawer opens from session header');

    check(errors.length === 0, errors.length ? `no page errors — got: ${errors.join(' | ')}` : 'no page errors');
  } catch (e) {
    failures++;
    console.error('  ✘ smoke test crashed:', e.message);
  } finally {
    await browser.close();
    server.close();
    bridge.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
})();
