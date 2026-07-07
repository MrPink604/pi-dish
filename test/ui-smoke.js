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
process.env.PI_DISH_TERMINAL = '1'; // exercise the terminal panel
// A configless HOME makes zsh launch its newuser wizard inside the PTY,
// which swallows the first line of input — give it an empty rc file.
fs.writeFileSync(path.join(tmpHome, '.zshrc'), '');

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
// A historical turn with tool activity — must fold into a closed .tool-group.
appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'check the readme' }], timestamp: '2026-07-05T00:00:03.000Z' } });
appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'hist1', name: 'Read', arguments: { path: 'README.md' } }], timestamp: '2026-07-05T00:00:04.000Z' } });
appendEntry({ type: 'message', message: { role: 'toolResult', toolName: 'Read', content: [{ type: 'text', text: '# alpha' }], timestamp: '2026-07-05T00:00:05.000Z' } });
appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'the readme says alpha' }], timestamp: '2026-07-05T00:00:06.000Z' } });
// Pad the history so the feed is taller than the viewport — the forced-follow
// scroll check needs a genuinely scrollable container to mean anything.
for (let i = 0; i < 8; i++) {
  appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: `filler question ${i}` }], timestamp: `2026-07-05T00:01:0${i}.000Z` } });
  appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: `filler answer ${i}\n\nwith a second paragraph of text to take up vertical space in the feed.` }], timestamp: `2026-07-05T00:01:0${i}.500Z` } });
}

// A second workspace with one (older) historical session — the sidebar
// collapse/pin section needs two groups on the All tab.
const BETA_ID = '2026-07-04T00-00-00-uismoke2';
const CWD_B = path.join(tmpHome, 'workspace', 'proj-beta');
fs.mkdirSync(CWD_B, { recursive: true });
const sessionDirB = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-proj-beta--');
fs.mkdirSync(sessionDirB, { recursive: true });
fs.writeFileSync(path.join(sessionDirB, `${BETA_ID}.jsonl`), [
  { type: 'session', cwd: CWD_B, timestamp: '2026-07-04T00:00:00.000Z' },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'beta question' }], timestamp: '2026-07-04T00:00:01.000Z' } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'beta answer' }], timestamp: '2026-07-04T00:00:02.000Z' } },
].map((e) => JSON.stringify(e)).join('\n') + '\n');

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
        { id: 'third-model', provider: 'test', name: 'Third Model' },
      ] });
    case 'get_commands':
      return respond(sock, msg.id, [{ name: 'help', description: 'show help', source: 'builtin' }]);
    case 'prompt':
      lastPrompt = msg;
      respond(sock, msg.id, {});
      return streamTurn(msg.message, msg.images);
    case 'set_session_name':
      // Mirror the real bridge: keep the registry entry fresh so polls
      // don't revert the rename.
      writeRegistry({ name: msg.name });
      return respond(sock, msg.id, {});
    default:
      return respond(sock, msg.id, {});
  }
}

let lastPrompt = null;

function streamTurn(userText, images) {
  const now = () => new Date().toISOString();
  const userContent = [{ type: 'text', text: userText }, ...(images || [])];
  appendEntry({ type: 'message', message: { role: 'user', content: userContent, timestamp: now() } });
  emit('turn_start', {});
  // Tool phase first: live panel appears mid-turn, then the JSONL catch-up
  // after turn_end must replace it with a collapsed .tool-group.
  const toolArgs = { command: 'echo hi' };
  emit('tool_execution_start', { toolCallId: 'tc1', toolName: 'Bash', args: toolArgs });
  setTimeout(() => {
    emit('tool_execution_end', { toolCallId: 'tc1', toolName: 'Bash', args: toolArgs, result: { content: [{ type: 'text', text: 'hi' }] }, isError: false });
    appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tc1', name: 'Bash', arguments: toolArgs }], timestamp: now() } });
    appendEntry({ type: 'message', message: { role: 'toolResult', toolName: 'Bash', content: [{ type: 'text', text: 'hi' }], timestamp: now() } });
    const full = 'Streamed reply with **bold** and `code`.\n\n```js\nconst answer = 42;\n```';
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
  }, 150);
}

// --- second fake bridge (extension-UI scoping section) -------------------------
// Mirrors the real bridge's replayExtensionUI: pushes its widget on every
// socket connect. Registered lazily inside section 10 so earlier sections
// still see exactly one Active session.
const SESSION2_ID = '2026-07-05T01-00-00-widget22';
const session2File = path.join(sessionDir, `${SESSION2_ID}.jsonl`);
fs.writeFileSync(session2File, [
  { type: 'session', cwd: CWD, timestamp: '2026-07-05T01:00:00.000Z' },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'second session' }], timestamp: '2026-07-05T01:00:01.000Z' } },
].map((e) => JSON.stringify(e)).join('\n') + '\n');
const socket2Path = path.join(tmpHome, 'bridge2.sock');
const bridge2 = net.createServer((sock) => {
  sock.on('error', () => {});
  sock.write(JSON.stringify({ type: 'hello', turnInProgress: false }) + '\n');
  sock.write(JSON.stringify({ type: 'event', event: 'extension_ui_request', data: { method: 'setWidget', widgetKey: 'deploys', widgetLines: ['deploy #7 running'] } }) + '\n');
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf-8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const data = msg.command === 'get_available_models'
        ? { models: [{ id: 'smoke-model', provider: 'test', name: 'Smoke Model' }] }
        : msg.command === 'get_commands' ? [] : {};
      sock.write(JSON.stringify({ type: 'response', id: msg.id, success: true, data }) + '\n');
    }
  });
});
const registerSession2 = () => fs.writeFileSync(path.join(registryDir, `${SESSION2_ID}.json`), JSON.stringify({
  sessionId: SESSION2_ID, socketPath: socket2Path, sessionFile: session2File,
  pid: process.pid, cwd: CWD, name: 'widget session', model: 'smoke-model',
  contextUsage: { tokens: 100, contextWindow: 100000, percent: 0.1 },
}));

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
    const desktop = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      // for the code-copy round-trip (127.0.0.1 is a secure context, so the
      // native clipboard path — not the execCommand fallback — is exercised)
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    watch(desktop, 'desktop');
    await desktop.goto(base, { waitUntil: 'networkidle' });
    await desktop.waitForSelector('.session-item');
    check(await desktop.locator('.session-item').count() === 1, 'live session listed under Active');
    await desktop.click('.session-item');
    await desktop.waitForSelector('.message.assistant');
    check(await desktop.locator('.message .markdown-body strong').first().textContent() === 'answer',
      'historical markdown rendered');

    // Tool-activity accordion: the historical tool turn folds into one
    // closed group holding the tool-only assistant message + tool result.
    const histGroup = desktop.locator('details.tool-group');
    check(await histGroup.count() === 1, 'historical tool turn folded into one .tool-group');
    check(!(await histGroup.evaluate(el => el.open)), 'tool-group is collapsed by default');
    check(await histGroup.locator('.message.tool-result').count() === 1, 'tool result lives inside the group');
    const histLabel = await histGroup.locator('.tool-group-label').textContent();
    check(histLabel.includes('1 tool use'), `group label counts tool uses (got ${JSON.stringify(histLabel)})`);

    // 2. Prompt round-trip through the fake bridge
    console.log('prompt round-trip:');
    await desktop.fill('#promptInput', 'ping from smoke test');
    await desktop.click('#btnSend');
    await desktop.waitForSelector('.session-item-status.working', { timeout: 2000 });
    check(true, 'sidebar working dot appears during the turn');
    await desktop.waitForSelector('details.live-tool-panel', { timeout: 5000 });
    check(true, 'live tool panel appeared mid-turn');
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
    // (match on the reply text — historical tool-call blocks also contain
    // <code>, so a bare `code` selector would fire early)
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.message.assistant[data-msg-index]')]
        .some(el => el.textContent.includes('Streamed reply with')), { timeout: 5000 });
    const finals = await desktop.locator('.message.assistant').allTextContents();
    check(finals.some(t => t.includes('Streamed reply with')), 'final assistant message rendered');
    check(await desktop.locator('.message.assistant[data-streaming="true"]').count() === 0,
      'streaming placeholder cleaned up');
    // The JSONL catch-up supersedes the live panel and folds this turn's
    // tool activity into a second collapsed group.
    check(await desktop.locator('details.live-tool-panel').count() === 0,
      'live tool panel removed once authoritative messages land');
    check(await desktop.locator('details.tool-group').count() === 2,
      'streamed turn tool activity folded into its own group');
    // The fenced block in the reply gets wrapped + given a copy button by the
    // highlight post-pass; clicking must land the code text on the clipboard.
    const codeBlock = desktop.locator('.message.assistant[data-msg-index] .code-block');
    check(await codeBlock.count() === 1, 'fenced code block got a copy button wrapper');
    await codeBlock.locator('.code-copy-btn').click();
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.code-copy-btn')].some(b => b.textContent === '✓'), { timeout: 2000 });
    check(true, 'copy button acked with ✓');
    const copied = await desktop.evaluate(() => navigator.clipboard.readText());
    check(copied.trim() === 'const answer = 42;', `clipboard holds the code text (got ${JSON.stringify(copied)})`);
    await desktop.waitForTimeout(200);
    check(await desktop.locator('.session-item-status.working').count() === 0,
      'working dot cleared after the turn');

    // Wide desktop: the message feed centers a reading column instead of
    // hugging the left edge.
    const wide = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    watch(wide, 'wide');
    await wide.goto(base, { waitUntil: 'networkidle' });
    await wide.click('.session-item');
    await wide.waitForSelector('.message.assistant');
    const userBox = await wide.locator('.message.user').first().boundingBox();
    const feedBox = await wide.locator('.messages').boundingBox();
    const leftGap = userBox.x - feedBox.x;
    const rightGap = (feedBox.x + feedBox.width) - (userBox.x + userBox.width);
    check(leftGap > 100 && Math.abs(leftGap - rightGap) < 40,
      `wide viewport centers the column (gaps ${Math.round(leftGap)}/${Math.round(rightGap)})`);
    await wide.close();

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

    // 6. Scoped models: dropdown edit mode toggles models and persists to
    // pi's settings.json (enabledModels), normal view hides disabled ones
    console.log('scoped models:');
    const settingsFile = path.join(tmpHome, '.pi', 'agent', 'settings.json');
    const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch { return {}; } };
    await desktop.click('#sessionModel');
    await desktop.waitForSelector('.model-option', { timeout: 5000 });
    check(await desktop.locator('.model-option').count() === 3, 'all models listed when nothing is scoped');
    await desktop.click('.model-dropdown-footer >> text=Edit models');
    await desktop.waitForSelector('.model-check');
    check(await desktop.locator('.model-check').count() === 3, 'edit mode shows a checkbox per model');
    await desktop.click('.model-option[title="test/other-model"]');
    check(await desktop.locator('.model-option[title="test/other-model"].disabled').count() === 1,
      'toggled model renders as disabled');
    await desktop.waitForTimeout(700); // debounced save
    check(JSON.stringify(readSettings().enabledModels) === JSON.stringify(['test/smoke-model', 'test/third-model']),
      'enabledModels persisted to pi settings.json');
    await desktop.click('.model-dropdown-footer >> text=Done');
    await desktop.waitForTimeout(100);
    check(await desktop.locator('.model-option').count() === 2, 'scoped view hides disabled models');
    const footerInfo = await desktop.locator('.model-footer-info').textContent();
    check(footerInfo === '1 hidden', `footer reports hidden count (got ${JSON.stringify(footerInfo)})`);
    // Reopen: the scope survives a fresh /api/models fetch (server-side resolve)
    await desktop.click('.messages');
    await desktop.waitForTimeout(200);
    await desktop.click('#sessionModel');
    await desktop.waitForSelector('.model-option', { timeout: 5000 });
    check(await desktop.locator('.model-option').count() === 2, 'scope survives reopening the dropdown');
    // Enable all clears the filter from settings
    await desktop.click('.model-dropdown-footer >> text=Edit models');
    await desktop.click('.model-dropdown-footer >> text=All');
    await desktop.waitForTimeout(700);
    check(!('enabledModels' in readSettings()), 'enabling everything clears enabledModels');
    await desktop.click('.model-dropdown-footer >> text=Done');
    await desktop.click('.messages');
    await desktop.waitForTimeout(200);

    // 7. Image attachment: attach a PNG, send, optimistic + JSONL renders
    // both carry the image, and the bridge receives the base64 payload.
    console.log('image attachments:');
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await desktop.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await addImageFiles([new File([bytes], 'shot.png', { type: 'image/png' })]);
    }, PNG_B64);
    await desktop.waitForSelector('.attachment-thumb', { timeout: 5000 });
    check(true, 'attachment thumbnail appears in the strip');
    await desktop.fill('#promptInput', 'describe the screenshot');
    await desktop.click('#btnSend');
    await desktop.waitForSelector('.message.user img.msg-image', { timeout: 5000 });
    check(true, 'optimistic user message renders the image');
    check(await desktop.locator('.attachment-thumb').count() === 0, 'attachment strip cleared after send');
    check(lastPrompt && Array.isArray(lastPrompt.images) && lastPrompt.images.length === 1 &&
      lastPrompt.images[0].data === PNG_B64 && lastPrompt.images[0].mimeType === 'image/png',
      'bridge received the image payload intact');
    // Wait for the turn to finish and the JSONL catch-up to land: the
    // authoritative user message must still show the image.
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.message.user[data-msg-index]')]
        .some((el) => el.textContent.includes('describe the screenshot') && el.querySelector('img.msg-image')),
      { timeout: 8000 });
    check(true, 'JSONL user message renders the image after catch-up');
    // Lightbox: tap the image, overlay appears, tap dismisses
    await desktop.click('.message.user img.msg-image');
    await desktop.waitForSelector('.lightbox-overlay img');
    check(true, 'lightbox opens on image tap');
    await desktop.click('.lightbox-overlay');
    check(await desktop.locator('.lightbox-overlay').count() === 0, 'lightbox dismissed on tap');

    // 8. Queue panel: queue_update shows chips; clicking expands the texts
    console.log('queue panel:');
    emit('queue_update', { steering: ['do the thing next'], followUp: ['then summarize'] });
    await desktop.waitForSelector('.queue-chip', { timeout: 5000 });
    check(await desktop.locator('.queue-chip').count() === 2, 'steering + follow-up chips shown');
    await desktop.click('.queue-chip');
    await desktop.waitForSelector('.queue-item');
    const queueTexts = await desktop.locator('.queue-item-text').allTextContents();
    check(queueTexts.includes('do the thing next') && queueTexts.includes('then summarize'),
      `queue panel lists queued texts (got ${JSON.stringify(queueTexts)})`);
    emit('queue_update', { steering: [], followUp: [] });
    await desktop.waitForFunction(() => document.getElementById('queueStatus').style.display === 'none');
    check(await desktop.evaluate(() => document.getElementById('queuePanel').style.display === 'none'),
      'panel hides when the queue drains');

    // 8b. Working indicator: a synthetic turn (fully event-driven, so there
    // is no timing window) shows the elapsed timer + running tool in the
    // header badge, ticks, and resets when the turn ends.
    console.log('working indicator:');
    emit('turn_start', {});
    emit('tool_execution_start', { toolCallId: 'wt1', toolName: 'Bash', args: { command: 'sleep 2' } });
    await desktop.waitForFunction(() =>
      /Working \d+:\d\d · Bash/.test(document.querySelector('#sessionWorking .spinner-text')?.textContent || ''),
      { timeout: 3000 });
    check(true, 'working badge shows elapsed timer and running tool');
    await desktop.waitForFunction(() =>
      /Working \d+:0[1-9]/.test(document.querySelector('#sessionWorking .spinner-text')?.textContent || ''),
      { timeout: 4000 });
    check(true, 'elapsed timer ticks past 0:00');
    emit('tool_execution_end', { toolCallId: 'wt1', toolName: 'Bash', args: { command: 'sleep 2' }, result: { content: [{ type: 'text', text: '' }] }, isError: false });
    emit('turn_end', {});
    await desktop.waitForFunction(() =>
      document.querySelector('#sessionWorking .spinner-text')?.textContent === 'Working', { timeout: 3000 });
    check(true, 'working badge resets after the turn');

    // 8c. Terminal: header button opens a shell at the session cwd over the
    // WS endpoint; output round-trips; close + reopen reattaches the same
    // PTY and replays scrollback (arithmetic markers so the echo of the
    // *typed* line can't satisfy the assertions).
    console.log('terminal:');
    check(await desktop.locator('#btnTerminal').isVisible(), 'terminal button visible when flag is on');
    await desktop.click('#btnTerminal');
    await desktop.waitForSelector('#terminalPanel .xterm', { timeout: 5000 });
    check(true, 'terminal panel opens with an xterm instance');
    check(await desktop.evaluate(() => document.fonts.check('12px "Symbols Nerd Font Mono"')),
      'Nerd Font symbols fallback loaded (p10k prompt glyphs)');
    const termText = () => desktop.evaluate(() => {
      const b = termState.term.buffer.active;
      let out = '';
      for (let i = 0; i < b.length; i++) out += b.getLine(i)?.translateToString(true) + '\n';
      return out;
    });
    await desktop.waitForFunction(() => document.getElementById('terminalStatus').textContent === '',
      { timeout: 5000 }); // attach frame landed
    await desktop.keyboard.type('pwd; echo term-smoke-$((40+2))\r');
    await desktop.waitForFunction(() => {
      const rows = document.querySelector('#terminalPanel .xterm');
      return rows && rows.textContent.includes('term-smoke-42');
    }, { timeout: 5000 });
    check((await termText()).includes(CWD), 'shell starts at the session cwd');
    const cwdLabel = await desktop.locator('#terminalCwd').textContent();
    check(cwdLabel.includes('workspace/proj-alpha'), `panel header shows the cwd (got ${JSON.stringify(cwdLabel)})`);
    // Close (shell keeps running server-side), reopen: scrollback replays.
    await desktop.click('#termCloseBtn');
    check(await desktop.evaluate(() => document.getElementById('terminalPanel').style.display === 'none'),
      'panel hidden on close');
    await desktop.click('#btnTerminal');
    await desktop.waitForFunction(() => {
      const rows = document.querySelector('#terminalPanel .xterm');
      return rows && rows.textContent.includes('term-smoke-42');
    }, { timeout: 5000 });
    check(true, 'reopen reattaches the PTY and replays scrollback');
    // Restart: confirm dialog, then a fresh shell — old scrollback gone,
    // new shell answers.
    desktop.once('dialog', (d) => d.accept());
    await desktop.click('#termRestartBtn');
    await desktop.waitForFunction(() => {
      const rows = document.querySelector('#terminalPanel .xterm');
      return rows && !rows.textContent.includes('term-smoke-42');
    }, { timeout: 5000 });
    check(true, 'restart clears the old scrollback');
    await desktop.keyboard.type('echo restarted-$((5+5))\r');
    await desktop.waitForFunction(() => {
      const rows = document.querySelector('#terminalPanel .xterm');
      return rows && rows.textContent.includes('restarted-10');
    }, { timeout: 5000 });
    check(true, 'fresh shell after restart answers');
    await desktop.click('#termCloseBtn');

    // 9. Drafts persist per session; ArrowUp recalls sent prompts
    console.log('drafts & history:');
    await desktop.fill('#promptInput', 'unsent draft');
    await desktop.waitForTimeout(500); // debounced draft save
    check(await desktop.evaluate((id) => localStorage.getItem('pi-dish-draft-' + id),
      registryState.sessionId) === 'unsent draft', 'draft saved to localStorage');
    // Wipe the input without an input event, re-select the session: the
    // draft must come back.
    await desktop.evaluate(() => { document.getElementById('promptInput').value = ''; });
    await desktop.click('.session-item');
    await desktop.waitForTimeout(300);
    check(await desktop.inputValue('#promptInput') === 'unsent draft', 'draft restored on session select');
    // ArrowUp from the start of the box steps into history; ArrowDown
    // returns to the stashed draft.
    await desktop.evaluate(() => document.getElementById('promptInput').setSelectionRange(0, 0));
    await desktop.focus('#promptInput');
    await desktop.keyboard.press('ArrowUp');
    check(await desktop.inputValue('#promptInput') === 'describe the screenshot',
      `ArrowUp recalls the last sent prompt (got ${JSON.stringify(await desktop.inputValue('#promptInput'))})`);
    await desktop.keyboard.press('ArrowDown');
    check(await desktop.inputValue('#promptInput') === 'unsent draft', 'ArrowDown restores the draft');
    // Clean up so later sections start with an empty composer + no draft.
    await desktop.fill('#promptInput', '');
    await desktop.waitForTimeout(500);
    check(await desktop.evaluate((id) => localStorage.getItem('pi-dish-draft-' + id),
      registryState.sessionId) === null, 'clearing the box clears the draft');

    // 10. Extension UI scoping: widgets/statuses are per-session — cleared
    // on switch, replayed from the server's remembered state on switch-back.
    console.log('extension UI scoping:');
    emit('extension_ui_request', { method: 'setWidget', widgetKey: 'procs', widgetLines: ['proc one', 'proc two'] });
    emit('extension_ui_request', { method: 'setStatus', statusKey: 'procs', statusText: '2 running' });
    await desktop.waitForSelector('.ext-ui-widget', { timeout: 5000 });
    check(await desktop.locator('.ext-ui-widget-body').textContent() === 'proc one\nproc two',
      'live widget rendered for session 1');
    check(await desktop.locator('.ext-ui-status-badge').textContent() === '2 running', 'status badge rendered');
    await new Promise((r) => bridge2.listen(socket2Path, r));
    registerSession2();
    await desktop.evaluate(() => loadSessions());
    await desktop.waitForSelector(`.session-item[data-id="${SESSION2_ID}"]`, { timeout: 5000 });
    await desktop.click(`.session-item[data-id="${SESSION2_ID}"]`);
    // Session 2's bridge replays its own widget when the server connects;
    // session 1's widget and badge must not bleed over.
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.ext-ui-widget-body')].some((el) => el.textContent === 'deploy #7 running'),
      { timeout: 5000 });
    check(await desktop.locator('.ext-ui-widget').count() === 1, 'exactly one widget after switching (no bleed)');
    check(await desktop.locator('.ext-ui-status-badge').count() === 0, 'session 1 status badge cleared on switch');
    // Back to session 1: its widget + status come back from the server's
    // per-session state with the bridge silent.
    await desktop.click(`.session-item[data-id="${registryState.sessionId}"]`);
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.ext-ui-widget-body')].some((el) => el.textContent === 'proc one\nproc two'),
      { timeout: 5000 });
    check(await desktop.locator('.ext-ui-widget').count() === 1, 'switch-back replays only session 1 widget');
    check(await desktop.locator('.ext-ui-status-badge').textContent() === '2 running',
      'status badge replayed on switch-back');
    // Clean up: clear the extension UI and deregister session 2 so the
    // mobile section still sees a single Active session.
    emit('extension_ui_request', { method: 'setWidget', widgetKey: 'procs', widgetLines: [] });
    emit('extension_ui_request', { method: 'setStatus', statusKey: 'procs', statusText: '' });
    await desktop.waitForFunction(() => !document.querySelector('.ext-ui-widget'), { timeout: 5000 });
    fs.rmSync(path.join(registryDir, `${SESSION2_ID}.json`), { force: true });

    // 11. Sidebar: both workspaces share the tmp-HOME prefix, so the tree
    // shows one flattened prefix node with proj-alpha/proj-beta as children.
    // Collapsing a child hides its sessions and sinks it below its expanded
    // sibling; collapsing the prefix node hides the whole subtree. Pinning
    // sessions floats them into a drag-reorderable section at the top.
    console.log('sidebar tree collapse & pin:');
    await desktop.click('#tabAll');
    const groupLabels = () => desktop.evaluate(() =>
      [...document.querySelectorAll('.session-segment:not(.pinned-segment) .workspace-group-label')]
        .map((el) => el.textContent));
    await desktop.waitForFunction(() =>
      document.querySelectorAll('.session-segment').length >= 3, null, { timeout: 5000 });
    const labelsBefore = await groupLabels();
    check(labelsBefore.length === 3, `prefix node + two children on All (got ${JSON.stringify(labelsBefore)})`);
    check(labelsBefore[0].endsWith('/workspace'), 'prefix node shows the shared path once');
    check(labelsBefore[1] === 'proj-alpha' && labelsBefore[2] === 'proj-beta',
      'children show distinguishing tails, newest first');
    await desktop.click('.workspace-children .workspace-group-header'); // first (newest) child
    await desktop.waitForSelector('.session-segment.collapsed', { timeout: 2000 });
    const labelsAfter = await groupLabels();
    check(labelsAfter[labelsAfter.length - 1] === 'proj-alpha', 'collapsed child sinks below its expanded sibling');
    check(await desktop.locator('.session-segment.collapsed .session-item').count() === 0,
      'collapsed group hides its sessions');
    check(await desktop.evaluate(() =>
      JSON.parse(localStorage.getItem('pi-dish-collapsed-groups') || '[]').length) === 1,
      'collapse persisted to localStorage');
    await desktop.click('.session-segment.collapsed .workspace-group-header');
    await desktop.waitForFunction(() => !document.querySelector('.session-segment.collapsed'), null, { timeout: 2000 });
    check(JSON.stringify(await groupLabels()) === JSON.stringify(labelsBefore),
      'expanding restores the original order');
    // Collapsing the prefix node takes the whole subtree with it.
    await desktop.click('.session-segment .workspace-group-header'); // first = prefix node
    await desktop.waitForSelector('.session-segment.collapsed', { timeout: 2000 });
    check(await desktop.evaluate(() =>
      document.querySelectorAll('#sessionList .session-item').length) === 0,
      'collapsed prefix node hides all descendant sessions');
    await desktop.click('.session-segment.collapsed .workspace-group-header');
    await desktop.waitForFunction(() => !document.querySelector('.session-segment.collapsed'), null, { timeout: 2000 });
    // The header + spawns a session at the node's path (stubbed — a real
    // createSession would launch `pi --mode rpc`), and must not toggle collapse.
    await desktop.evaluate(() => {
      window.__newSessionCwd = null;
      window.createSession = (cwd) => { window.__newSessionCwd = cwd; };
    });
    await desktop.hover('.workspace-children .workspace-group-header');
    await desktop.click('.workspace-children .workspace-group-header .workspace-new-btn');
    check(await desktop.evaluate(() => window.__newSessionCwd) === CWD,
      'header + button targets the node cwd');
    check(await desktop.locator('.session-segment.collapsed').count() === 0,
      'header + button does not toggle collapse');

    const pinToggle = async (id) => {
      await desktop.hover(`.session-item[data-id="${id}"]`);
      await desktop.click(`.session-item[data-id="${id}"] .session-pin-btn`);
    };
    await pinToggle(registryState.sessionId);
    await desktop.waitForSelector('.pinned-segment', { timeout: 2000 });
    check(await desktop.evaluate(() =>
      document.querySelector('#sessionList .session-segment')?.classList.contains('pinned-segment')),
      'pinned section renders at the top');
    await pinToggle(BETA_ID);
    await desktop.waitForFunction(() =>
      document.querySelectorAll('.pinned-segment .session-item').length === 2, null, { timeout: 2000 });
    check(await desktop.locator('.pinned-segment .session-drag-handle').count() === 2,
      'pinned rows carry drag handles');
    check(await desktop.locator('.pinned-segment .session-item-cwd').count() === 2,
      'pinned rows show their workspace');
    // Drag beta's handle above the first pinned row: order flips and persists.
    const handleBox = await desktop.locator(`.pinned-segment .session-item[data-id="${BETA_ID}"] .session-drag-handle`).boundingBox();
    const firstBox = await desktop.locator(`.pinned-segment .session-item[data-id="${registryState.sessionId}"]`).boundingBox();
    await desktop.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await desktop.mouse.down();
    await desktop.mouse.move(firstBox.x + 20, firstBox.y + 2, { steps: 5 });
    await desktop.mouse.up();
    await desktop.waitForFunction((want) =>
      JSON.stringify([...document.querySelectorAll('.pinned-segment .session-item')].map((el) => el.dataset.id)) === want,
      JSON.stringify([BETA_ID, registryState.sessionId]), { timeout: 2000 });
    check(true, 'drag handle reorders pinned sessions');
    check(await desktop.evaluate(() => localStorage.getItem('pi-dish-pinned-sessions')) ===
      JSON.stringify([BETA_ID, registryState.sessionId]), 'manual order persisted to localStorage');
    // Unpin both; the section disappears and the sessions rejoin their groups.
    await pinToggle(BETA_ID);
    await pinToggle(registryState.sessionId);
    await desktop.waitForFunction(() => !document.querySelector('.pinned-segment'), null, { timeout: 2000 });
    check(true, 'unpinning removes the pinned section');
    await desktop.click('#tabActive');
    await desktop.waitForTimeout(200);

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
    await mobile.click('.sidebar-overlay'); // close the drawer again

    // Terminal on mobile: opened from the ⚙ control panel; the extra-keys
    // bar (esc/tab/ctrl/arrows) is part of the touch layout. ^C must reach
    // the shell as SIGINT (kills a running sleep), and the ctrl latch turns
    // the next typed key into a control character.
    console.log('mobile terminal:');
    await mobile.click('#btnPanel');
    await mobile.waitForSelector('#cpTerminalRow', { state: 'visible' });
    await mobile.click('#cpTerminalRow');
    await mobile.waitForSelector('#terminalPanel .xterm', { timeout: 5000 });
    check(await mobile.locator('#terminalKeybar').isVisible(), 'extra-keys bar visible on mobile');
    await mobile.waitForFunction(() => document.getElementById('terminalStatus').textContent === '',
      { timeout: 5000 });
    await mobile.keyboard.type('sleep 100\r');
    await mobile.waitForTimeout(300);
    await mobile.tap('#terminalKeybar button[data-termkey="ctrl-c"]');
    await mobile.keyboard.type('echo after-$((1+1))\r');
    await mobile.waitForFunction(() => {
      const rows = document.querySelector('#terminalPanel .xterm');
      return rows && rows.textContent.includes('after-2');
    }, { timeout: 5000 });
    check(true, '^C key interrupts a running command (prompt came back)');
    // Ctrl latch: tap ctrl, type c → ^C again (nothing running; just assert
    // the latch visually arms and clears).
    await mobile.tap('#terminalKeybar button[data-termkey="ctrl"]');
    check(await mobile.evaluate(() => document.getElementById('termKeyCtrl').classList.contains('latched')),
      'ctrl key latches');
    await mobile.keyboard.type('c');
    check(await mobile.evaluate(() => !document.getElementById('termKeyCtrl').classList.contains('latched')),
      'latch clears after the next key');
    await mobile.click('#termCloseBtn');

    check(errors.length === 0, errors.length ? `no page errors — got: ${errors.join(' | ')}` : 'no page errors');
  } catch (e) {
    failures++;
    console.error('  ✘ smoke test crashed:', e.message);
    if (errors.length) console.error('  collected page errors:', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
    bridge.close();
    bridge2.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
})();
