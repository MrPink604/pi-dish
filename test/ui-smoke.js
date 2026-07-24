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
// Empty tmux tmpdir: describeRuntime's pid-ancestry fallback scans it, and a
// tmux session enclosing this test would otherwise claim the dummy pi child
// (the close-session section expects a plain "terminal" runtime).
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-ui-tmux-'));
// A configless HOME makes zsh launch its newuser wizard inside the PTY,
// which swallows the first line of input — give it an empty rc file.
fs.writeFileSync(path.join(tmpHome, '.zshrc'), '');

const SESSION_ID = '2026-07-05T00-00-00-uismoke1';
// Real on-disk cwd so @-mentions and the cwd picker have something to find.
const CWD = path.join(tmpHome, 'workspace', 'proj-alpha');
fs.mkdirSync(path.join(CWD, 'src'), { recursive: true });
fs.writeFileSync(path.join(CWD, 'src', 'main.js'), 'console.log(1);\n');
fs.writeFileSync(path.join(CWD, 'README.md'), '# alpha\n');

// A dirty git repo under the cwd for the diff view (one committed+modified
// file, one untracked). Filenames chosen not to collide with the @-mention
// fuzzy-search assertions ('ma', 'REA').
const { execFileSync } = require('node:child_process');
const REPO = path.join(CWD, 'repo-x');
fs.mkdirSync(REPO, { recursive: true });
const git = (...args) => execFileSync('git', args, {
  cwd: REPO,
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  },
});
git('init', '-q', '-b', 'main');
fs.writeFileSync(path.join(REPO, 'zeta.txt'), 'one\n');
git('add', '-A');
git('commit', '-q', '-m', 'init');
fs.writeFileSync(path.join(REPO, 'zeta.txt'), 'one\ntwo\n');
fs.writeFileSync(path.join(REPO, 'zulu.txt'), 'brand new\n');
const sessionDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-proj--');
const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
fs.mkdirSync(sessionDir, { recursive: true });
fs.mkdirSync(registryDir, { recursive: true });

// A valid 1x1 transparent PNG — a `read` on an image yields a text block plus
// this {type:'image'} block; the transcript must render it as an img.msg-image.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const sessionFile = path.join(sessionDir, `${SESSION_ID}.jsonl`);
const appendEntry = (e) => fs.appendFileSync(sessionFile, JSON.stringify(e) + '\n');
appendEntry({ type: 'session', cwd: CWD, timestamp: '2026-07-05T00:00:00.000Z' });
appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'existing question' }], timestamp: '2026-07-05T00:00:01.000Z' } });
// Entry id + response timing (start = message.timestamp ms epoch, end =
// entry timestamp): 45 output tokens in 1.5s → the header shows "30 tok/s"
// and the 🔗 button deep-links ?targetId=ui-a1.
appendEntry({ type: 'message', id: 'ui-a1', timestamp: '2026-07-05T00:00:02.000Z', message: { role: 'assistant', provider: 'test', model: 'smoke-model', stopReason: 'stop', content: [{ type: 'text', text: 'existing **answer**' }], timestamp: Date.parse('2026-07-05T00:00:00.500Z'), usage: { input: 100, output: 45, reasoning: 5, cacheRead: 20, cacheWrite: 10, cost: { input: 0.0003, output: 0.000675, cacheRead: 0.00001, cacheWrite: 0.00002, total: 0.001005 } } } });
// A historical turn with tool activity — must fold into a closed .tool-group.
appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'check the readme' }], timestamp: '2026-07-05T00:00:03.000Z' } });
appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'hist1', name: 'Read', arguments: { path: 'README.md' } }], timestamp: '2026-07-05T00:00:04.000Z' } });
appendEntry({ type: 'message', message: { role: 'toolResult', toolName: 'Read', content: [{ type: 'text', text: 'Read image file [image/png]' }, { type: 'image', data: TINY_PNG, mimeType: 'image/png' }], timestamp: '2026-07-05T00:00:05.000Z' } });
appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'the readme says alpha' }], timestamp: '2026-07-05T00:00:06.000Z' } });
// Pad the history so the feed is taller than the viewport — the forced-follow
// scroll check needs a genuinely scrollable container to mean anything.
for (let i = 0; i < 8; i++) {
  appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: `filler question ${i}` }], timestamp: `2026-07-05T00:01:0${i}.000Z` } });
  appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: `filler answer ${i}\n\nwith a second paragraph of text to take up vertical space in the feed.` }], timestamp: `2026-07-05T00:01:0${i}.500Z` } });
}

// A file-mention turn for the file viewer: the write toolCall gives the
// resolver the deep path; the prose mentions it by bare basename (backticked)
// and README.md in plain text. The message carries text, so it doesn't fold
// into a tool-group (the accordion counts above stay stable).
fs.mkdirSync(path.join(CWD, 'deep', 'nest'), { recursive: true });
fs.writeFileSync(path.join(CWD, 'deep', 'nest', 'findings.md'), '# deep findings\n\nhello from deep\n');
appendEntry({ type: 'message', message: { role: 'assistant', content: [
  { type: 'text', text: 'Wrote my notes to `findings.md` — compare with README.md at the root.' },
  { type: 'toolCall', id: 'fm1', name: 'write', arguments: { path: path.join(CWD, 'deep', 'nest', 'findings.md'), content: '# deep findings\n' } },
], timestamp: '2026-07-05T00:02:00.000Z' } });

// A second workspace with one (older) historical session — the sidebar
// collapse/pin section needs two groups on the All tab.
const BETA_ID = '2026-07-04T00-00-00-uismoke2';
const CWD_B = path.join(tmpHome, 'workspace', 'proj-beta');
fs.mkdirSync(CWD_B, { recursive: true });
const sessionDirB = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-proj-beta--');
fs.mkdirSync(sessionDirB, { recursive: true });
const betaEntries = [
  { type: 'session', cwd: CWD_B, timestamp: '2026-07-04T00:00:00.000Z' },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'beta question' }], timestamp: '2026-07-04T00:00:01.000Z' } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'beta answer' }], timestamp: '2026-07-04T00:00:02.000Z' } },
];
// Long enough to require three transcript pages. This protects intentional
// history loading: scrolling to the top pages backward, and switching away
// briefly must not discard the pages the reader chose to load.
for (let i = 0; i < 128; i++) {
  betaEntries.push({
    type: 'message',
    message: {
      role: i % 2 ? 'assistant' : 'user',
      content: [{ type: 'text', text: `${i === 0 ? 'archival needle · ' : ''}beta history ${i}` }],
      timestamp: new Date(Date.parse('2026-07-04T00:01:00.000Z') + i * 1000).toISOString(),
    },
  });
}
fs.writeFileSync(path.join(sessionDirB, `${BETA_ID}.jsonl`),
  betaEntries.map((e) => JSON.stringify(e)).join('\n') + '\n');

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
  // Mirror the real bridge hello: carries the current queue so the server can
  // replay it into a client that just (re)connected.
  sock.write(JSON.stringify({ type: 'hello', turnInProgress: false, queue: liveQueue }) + '\n');
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

// The bridge's steering/follow-up queue, mirrored to clients via queue_update.
let liveQueue = { steering: [], followUp: [] };
let runCommandCount = 0;
function setQueue(q) { liveQueue = q; emit('queue_update', liveQueue); }

function handleCommand(sock, msg) {
  switch (msg.command) {
    case 'get_available_models':
      return respond(sock, msg.id, { models: [
        { id: 'smoke-model', provider: 'test', name: 'Smoke Model', contextWindow: 200000, pricing: { input: 3, output: 15 } },
        { id: 'other-model', provider: 'test', name: 'Other Model', contextWindow: 128000, pricing: null },
        { id: 'third-model', provider: 'test', name: 'Third Model', contextWindow: 32000, pricing: { input: 0, output: 0 } },
      ] });
    case 'get_commands':
      return respond(sock, msg.id, [{ name: 'help', description: 'show help', source: 'builtin' }]);
    case 'run_command':
      runCommandCount++;
      return respond(sock, msg.id, {});
    case 'prompt':
      lastPrompt = msg;
      // Mirror the real bridge: a prompt sent mid-compaction is buffered and
      // acked as queued, then flushed as a turn once compaction ends.
      if (fakeCompacting) { bufferedPrompt = msg; return respond(sock, msg.id, { queued: true }); }
      respond(sock, msg.id, {});
      return streamTurn(msg.message, msg.images);
    case 'steer':
      // Mirror the real bridge: ack, then surface the message in the queue.
      respond(sock, msg.id, { queued: false });
      setQueue({ steering: [...liveQueue.steering, msg.message], followUp: liveQueue.followUp });
      return;
    case 'cancel_queued':
      // Remove the matching entry and re-broadcast the (now empty) queue.
      respond(sock, msg.id, { text: msg.text });
      setQueue({
        steering: liveQueue.steering.filter((t) => t !== msg.text),
        followUp: liveQueue.followUp.filter((t) => t !== msg.text),
      });
      return;
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
let fakeCompacting = false;
let bufferedPrompt = null;
function flushBufferedPrompt() {
  if (!bufferedPrompt) return;
  const p = bufferedPrompt; bufferedPrompt = null;
  streamTurn(p.message, p.images);
}

function streamTurn(userText, images) {
  const now = () => new Date().toISOString();
  const userContent = [{ type: 'text', text: userText }, ...(images || [])];
  appendEntry({ type: 'message', message: { role: 'user', content: userContent, timestamp: now() } });
  emit('turn_start', {});
  // Real pi echoes the prompt as a user message_start/message_end right after
  // turn_start (agent-core runAgentLoop). The client must suppress this echo —
  // it already rendered the prompt optimistically on send.
  emit('message_start', { message: { role: 'user', content: userContent, timestamp: now() } });
  emit('message_end', { message: { role: 'user', content: userContent, timestamp: now() } });
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

    // Image tool result: the Read of an image renders its {type:'image'} block
    // as an img.msg-image inside the (image-open) tool-result details, and the
    // header meta flags it. Open the group so the image is actually visible.
    const imgResult = histGroup.locator('.message.tool-result');
    check((await imgResult.locator('.tool-result-meta').allTextContents()).some(t => t.trim() === 'image'),
      'tool-result header meta flags the image');
    check(await imgResult.locator('details.tool-result-details').evaluate(el => el.open),
      'image tool result is open by default');
    await histGroup.evaluate(el => { el.open = true; });
    await desktop.waitForSelector('.message.tool-result .tool-result-details img.msg-image', { timeout: 3000 });
    check(await imgResult.locator('.tool-result-details img.msg-image').count() === 1,
      'image tool result renders one img.msg-image inside the details');
    const historicalImage = imgResult.locator('img.msg-image');
    const imgSrc = await historicalImage.getAttribute('src');
    check(imgSrc.startsWith(`/api/sessions/${SESSION_ID}/messages/`),
      `historical image uses a session resource URL (got ${imgSrc})`);
    check(await historicalImage.getAttribute('loading') === 'lazy', 'historical image opts into native lazy loading');
    await desktop.waitForFunction(() => {
      const img = document.querySelector('.message.tool-result img.msg-image');
      return img?.complete && img.naturalWidth === 1;
    }, { timeout: 3000 });
    check(true, 'resource-backed historical image renders successfully');
    await histGroup.evaluate(el => { el.open = false; });

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
    // The bridge echoed the prompt back as a user message_end (like real pi);
    // the optimistic render from send must suppress it — exactly one copy.
    check(await desktop.evaluate(() =>
      [...document.querySelectorAll('.message.user')]
        .filter(el => el.textContent.includes('ping from smoke test')).length === 1),
      'prompt echo suppressed (single user bubble mid-turn)');
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

    // Per-message tok/s: the fixture's timed assistant message shows its
    // generation speed in the header.
    console.log('per-message speed + share link:');
    const speedBadge = desktop.locator('.message.assistant .message-speed', { hasText: '30 tok/s' });
    check(await speedBadge.count() === 1, 'timed assistant message shows 30 tok/s');
    await speedBadge.click();
    check((await desktop.locator('#responseDetailsBody').textContent()).includes('Estimated total'), 'response details shows estimated costs');
    await desktop.keyboard.press('Escape');
    await desktop.click('.global-settings-btn');
    await desktop.waitForSelector('#responseMetadataMode');
    await desktop.selectOption('#responseMetadataMode', 'performance-cost');
    check((await speedBadge.textContent()).includes('~$'), 'response mode updates rendered metadata');
    check(await desktop.evaluate(() => localStorage.getItem('pi-dish-response-metadata')) === 'performance-cost', 'response mode persists');
    await desktop.keyboard.press('Escape'); // usage moved out of the modal — its takeover has a dedicated section below

    // Per-message share link: no share exists yet, so the button asks before
    // creating one; accepting copies the deep link (?targetId=<entry id>).
    const linkBtn = desktop.locator('.message [data-entry-id="ui-a1"].msg-link-btn');
    check(await linkBtn.count() === 1, 'entry-backed message has a share-link button');
    desktop.once('dialog', (d) => d.accept());
    await linkBtn.click({ force: true }); // hover-revealed; force skips the hover dance
    await desktop.waitForFunction(() =>
      /Message share link copied/.test(document.getElementById('status')?.textContent || ''), { timeout: 5000 });
    const msgLink = await desktop.evaluate(() => navigator.clipboard.readText());
    check(/\/share\/[A-Za-z0-9_-]+\?targetId=ui-a1$/.test(msgLink),
      `clipboard holds the share deep link (got ${JSON.stringify(msgLink)})`);
    // (The export itself rejects this id-less shorthand fixture —
    // server.test.js proves the targetId anchor contract on a valid session.)

    // Stats modal: the session-file / cwd rows are click-to-copy buttons.
    await desktop.click('#sessionContext');
    await desktop.waitForSelector('#statsModal .stats-copy', { timeout: 2000 });
    // Session-wide speed row from the one timed assistant message.
    check(/30 tok\/s avg/.test(await desktop.locator('#statsBody').textContent()),
      'stats modal shows the session average speed');
    // Scope to the table — the share section (created by the message-link
    // step above) renders its own .stats-copy after it.
    const fileBtn = desktop.locator('.stats-table .stats-copy').last();
    const filePath = await fileBtn.getAttribute('data-copy');
    check(filePath.endsWith('.jsonl'), `session-file row exposes the path (got ${filePath})`);
    await fileBtn.click();
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.stats-copy')].some(b => b.classList.contains('copied')),
      { timeout: 2000 });
    const copiedPath = await desktop.evaluate(() => navigator.clipboard.readText());
    check(copiedPath === filePath, `session-file path landed on the clipboard (got ${JSON.stringify(copiedPath)})`);
    await desktop.keyboard.press('Escape');
    await desktop.waitForSelector('#statsModal', { state: 'hidden', timeout: 2000 });

    // File viewer: the assistant's `findings.md` mention is linkified;
    // clicking resolves through the session's write toolCall to the deep
    // file and renders its markdown. Plain-prose README.md linkifies too.
    console.log('file viewer:');
    const findingsLink = desktop.locator('.message.assistant .markdown-body code.file-link',
      { hasText: 'findings.md' });
    check(await findingsLink.count() === 1, 'backticked mention linkified');
    check(await desktop.locator('.message.assistant .markdown-body span.file-link',
      { hasText: 'README.md' }).count() === 1, 'plain-prose mention linkified');
    await findingsLink.click();
    await desktop.waitForSelector('#fileView .markdown-body h1', { timeout: 5000 });
    check(await desktop.evaluate(() => document.getElementById('messages').offsetParent === null),
      'transcript hidden while the file view is open');
    check(await desktop.locator('#fileViewTitle').textContent() === 'findings.md',
      'viewer titled by filename');
    const shownPath = await desktop.locator('#fileViewPath').textContent();
    check(shownPath.includes('deep/nest/findings.md'),
      `bare mention resolved to the deep tool-written path (got ${JSON.stringify(shownPath)})`);
    check(await desktop.locator('#fileView .markdown-body h1').textContent() === 'deep findings',
      'markdown file renders rendered');

    // Select rendered prose and save an anchored comment. This must not send
    // a prompt or initiate an agent turn.
    await desktop.evaluate(() => {
      const node = [...document.querySelectorAll('#fileViewBody p')]
        .find((el) => el.textContent.includes('hello from deep')).firstChild;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      captureFileCommentSelection();
    });
    await desktop.waitForSelector('#commentBubble', { state: 'visible', timeout: 2000 });
    check(true, 'file text selection opens the anchored comment bubble');
    const bubbleBox = await desktop.locator('#commentBubble').boundingBox();
    check(bubbleBox.x >= 0 && bubbleBox.y >= 0
      && bubbleBox.x + bubbleBox.width <= 1280 && bubbleBox.y + bubbleBox.height <= 800,
      `comment bubble is clamped within the viewport (got ${JSON.stringify(bubbleBox)})`);
    check(await desktop.evaluate(() => document.activeElement !== document.getElementById('commentBody')),
      'pointer selection opens without stealing focus from selection-to-copy');
    await desktop.setViewportSize({ width: 420, height: 500 });
    await desktop.waitForFunction(() => {
      const box = document.getElementById('commentBubble').getBoundingClientRect();
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    }, { timeout: 2000 });
    const narrowBubbleBox = await desktop.locator('#commentBubble').boundingBox();
    check(narrowBubbleBox.x >= 0 && narrowBubbleBox.y >= 0
      && narrowBubbleBox.x + narrowBubbleBox.width <= 420
      && narrowBubbleBox.y + narrowBubbleBox.height <= 500,
      `comment bubble remains clamped after resize (got ${JSON.stringify(narrowBubbleBox)})`);
    await desktop.setViewportSize({ width: 1280, height: 800 });
    await desktop.keyboard.press('Escape');
    await desktop.evaluate(() => {
      const node = [...document.querySelectorAll('#fileViewBody p')]
        .find((el) => el.textContent.includes('hello from deep')).firstChild;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'ArrowRight', shiftKey: true, bubbles: true,
      }));
    });
    await desktop.waitForSelector('#commentBubble', { state: 'visible', timeout: 2000 });
    check(await desktop.evaluate(() => document.activeElement === document.getElementById('commentBody')),
      'keyboard selection opens and focuses the comment composer');
    check(await desktop.evaluate(() => {
      const root = document.createElement('div');
      root.textContent = 'before  selected  after';
      document.body.append(root);
      const range = document.createRange();
      range.setStart(root.firstChild, 6);
      range.setEnd(root.firstChild, 18);
      const anchor = selectionTextAnchor(root, range);
      const exact = anchor.prefix + anchor.quote + anchor.suffix === root.textContent
        && anchor.quote === '  selected  ';
      root.remove();
      return exact;
    }), 'text anchors preserve selected boundary whitespace exactly');
    await desktop.fill('#commentBody', 'Make this finding more specific.');
    await desktop.evaluate(() => captureFileCommentSelection());
    check(await desktop.locator('#commentBody').inputValue() === 'Make this finding more specific.',
      'another capture attempt does not discard an open comment draft');
    await desktop.click('#commentSendBtn');
    await desktop.waitForSelector('#commentBubble', { state: 'hidden', timeout: 5000 });
    const fileComments = await (await fetch(`${base}/api/comments/index?sessionId=${SESSION_ID}`)).json();
    check(fileComments.total === 1 && fileComments.comments[0].target.kind === 'file',
      'file selection persisted as one anchored comment');
    check(runCommandCount === 0, 'saving a comment did not initiate or queue an agent command');

    // Publish the viewed file as a page: 🌐 → link row → the public URL
    // serves the file content → unpublish clears it.
    await desktop.click('#fileViewPublish');
    await desktop.waitForSelector('#fileViewPage .stats-share-link', { timeout: 5000 });
    const pageLink = await desktop.locator('#fileViewPage .stats-share-link').textContent();
    check(/\/page\/[A-Za-z0-9_-]+$/.test(pageLink), `publish shows a token link (got ${pageLink})`);
    const pageRes = await fetch(pageLink);
    check(pageRes.status === 200 && (await pageRes.text()).includes('hello from deep'),
      'published page serves the file content');

    // Shared-artifacts badge: the page plus the share link created earlier.
    console.log('artifacts:');
    await desktop.waitForFunction(() =>
      document.getElementById('artifactCount')?.textContent === '2', { timeout: 5000 });
    check(true, 'artifacts badge counts the page + the share link');
    await desktop.click('#btnArtifacts');
    await desktop.waitForSelector('#artifactsModal .artifact-row', { timeout: 2000 });
    const artifactLabels = await desktop.locator('#artifactsModal .artifact-link').allTextContents();
    check(artifactLabels.includes('findings.md') && artifactLabels.includes('Read-only transcript'),
      `artifacts modal lists the page and the share link (got ${JSON.stringify(artifactLabels)})`);
    const pageHref = await desktop.locator('#artifactsModal .artifact-link').first().getAttribute('href');
    check(/\/page\/[A-Za-z0-9_-]+$/.test(pageHref), `page artifact links its public URL (got ${pageHref})`);
    await desktop.keyboard.press('Escape');
    await desktop.waitForSelector('#artifactsModal', { state: 'hidden', timeout: 2000 });
    // Re-opening the viewer on the same file shows the existing page link.
    await desktop.keyboard.press('Escape');
    await desktop.waitForSelector('#fileView', { state: 'hidden', timeout: 2000 });
    await findingsLink.click();
    await desktop.waitForSelector('#fileViewPage .stats-share-link', { timeout: 5000 });
    check(true, 'existing page link resurfaces when the file is viewed again');
    await desktop.click('#filePageRevoke');
    await desktop.waitForFunction(() =>
      document.getElementById('fileViewPage').style.display === 'none', { timeout: 5000 });
    check((await fetch(pageLink)).status === 404, 'unpublish revokes the public URL');
    await desktop.waitForFunction(() =>
      document.getElementById('artifactCount')?.textContent === '1', { timeout: 5000 });
    check(true, 'artifacts badge drops the revoked page (share link remains)');

    await desktop.keyboard.press('Escape');
    await desktop.waitForSelector('#fileView', { state: 'hidden', timeout: 2000 });
    await desktop.waitForFunction(() => document.getElementById('messages').offsetParent !== null,
      { timeout: 2000 });
    check(true, 'Escape closes the viewer and restores the transcript');

    // Diff view: the ± header button swaps the transcript for the aggregate
    // uncommitted changes of every repo under the cwd; Escape restores it.
    console.log('diff view:');
    await desktop.click('#btnDiff');
    await desktop.waitForSelector('.diff-repo', { timeout: 5000 });
    check(await desktop.evaluate(() => document.getElementById('messages').offsetParent === null),
      'transcript hidden while the diff view is open');
    check(await desktop.locator('.diff-repo-path').first().textContent() === 'repo-x',
      'repo under the cwd discovered and titled by relative path');
    const diffFiles = await desktop.evaluate(() =>
      [...document.querySelectorAll('.diff-file')].map((el) => ({
        status: el.querySelector('.diff-status').textContent,
        path: el.querySelector('.diff-file-path').textContent,
        open: el.open,
      })));
    check(diffFiles.some((f) => f.path === 'zeta.txt' && f.status === 'M'),
      `modified file listed with status M (got ${JSON.stringify(diffFiles)})`);
    check(diffFiles.some((f) => f.path === 'zulu.txt' && f.status === '?'),
      'untracked file listed with status ?');
    check(diffFiles.every((f) => f.open), 'small changeset opens patches by default');
    check(await desktop.evaluate(() =>
      [...document.querySelectorAll('.diff-line.diff-add')].some((el) => el.textContent === '+two')),
      'modified patch renders its added line');
    check(await desktop.evaluate(() =>
      [...document.querySelectorAll('.diff-line.diff-add')].some((el) => el.textContent === '+brand new')),
      'untracked patch is synthesized and rendered');
    await desktop.evaluate(() => {
      const line = [...document.querySelectorAll('.diff-line.diff-add')]
        .find((el) => el.textContent === '+two');
      const range = document.createRange();
      range.selectNodeContents(line);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      captureDiffCommentSelection();
    });
    await desktop.waitForSelector('#commentBubble', { state: 'visible', timeout: 2000 });
    check(true, 'diff line selection opens the anchored comment bubble');
    await desktop.fill('#commentBody', 'Use a more descriptive value here.');
    await desktop.click('#commentSendBtn');
    await desktop.waitForSelector('#commentBubble', { state: 'hidden', timeout: 5000 });
    const diffComments = await (await fetch(`${base}/api/comments/index?sessionId=${SESSION_ID}`)).json();
    const diffComment = diffComments.comments.find((comment) => comment.target.kind === 'diff');
    check(diffComments.total === 2 && diffComment?.target.anchor.newStart === 2,
      'diff selection persisted with its new-side line anchor');
    await desktop.keyboard.press('Escape');
    await desktop.waitForFunction(() => document.getElementById('messages').offsetParent !== null,
      { timeout: 2000 });
    check(await desktop.locator('#btnDiff.active').count() === 0,
      'Escape closes the diff view and restores the transcript');

    // Grow the same changeset past the inline threshold. The summary must
    // remain useful immediately without constructing hidden patch DOM; opening
    // one file loads just that patch and preserves line-comment behavior.
    console.log('large diff lazy patches:');
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(REPO, `lazy-${i}.txt`), `lazy line ${i}\n`);
    await desktop.click('#btnDiff');
    await desktop.waitForFunction(() => document.querySelectorAll('.diff-file').length === 7,
      { timeout: 5000 });
    check(await desktop.locator('.diff-file[open]').count() === 0, 'large changeset starts collapsed');
    check(await desktop.locator('.diff-line').count() === 0, 'collapsed large diff builds no patch-line DOM');
    const lazyFile = desktop.locator('.diff-file').filter({ hasText: 'lazy-3.txt' });
    await lazyFile.locator('summary').click();
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.diff-line.diff-add')].some(el => el.textContent === '+lazy line 3'),
      { timeout: 5000 });
    check(await desktop.locator('.diff-line').count() === 2,
      'expanding one file renders only its hunk and added line');
    await desktop.evaluate(() => {
      const line = [...document.querySelectorAll('.diff-line.diff-add')]
        .find((el) => el.textContent === '+lazy line 3');
      const range = document.createRange();
      range.selectNodeContents(line);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      captureDiffCommentSelection();
    });
    await desktop.waitForSelector('#commentBubble', { state: 'visible', timeout: 2000 });
    check(true, 'lazy patch line selection opens the comment bubble');
    await desktop.keyboard.press('Escape');
    await desktop.waitForSelector('#commentBubble', { state: 'hidden', timeout: 2000 });
    check(await desktop.locator('#diffView').isVisible(), 'first Escape closes the comment bubble only');
    await desktop.keyboard.press('Escape');
    await desktop.waitForFunction(() => document.getElementById('messages').offsetParent !== null,
      { timeout: 2000 });

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

    // @~/... path completion: directories drill deeper, files close the mention
    await desktop.type('#promptInput', '@~/works');
    await desktop.waitForSelector('.autocomplete-item[data-file="~/workspace"][data-dir]', { timeout: 5000 });
    check(true, '@~/ token completes home dirs');
    await desktop.keyboard.press('Tab');
    check(await desktop.inputValue('#promptInput') === '@~/workspace/',
      'accepting a dir appends a slash and keeps completing');
    await desktop.waitForSelector('.autocomplete-item[data-file="~/workspace/proj-alpha"][data-dir]', { timeout: 5000 });
    await desktop.keyboard.press('Tab');
    await desktop.type('#promptInput', 'REA');
    await desktop.waitForSelector('.autocomplete-item[data-file="~/workspace/proj-alpha/README.md"]:not([data-dir])', { timeout: 5000 });
    await desktop.keyboard.press('Tab');
    const deepVal = await desktop.inputValue('#promptInput');
    check(deepVal === '@~/workspace/proj-alpha/README.md ',
      `drilled mention inserted (got ${JSON.stringify(deepVal)})`);
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
    // Event-driven: the rename lands after a round-trip through the bridge —
    // a fixed sleep races it on a loaded machine. The renamed text persists
    // once set, so the rAF-polled wait can't miss it.
    await desktop.waitForFunction(() => document.getElementById('sessionName').textContent === 'renamed live',
      null, { timeout: 5000 });
    check(true, 'header shows new name');
    await desktop.waitForFunction(() => document.querySelector('.session-item-name')?.textContent === 'renamed live',
      null, { timeout: 5000 });
    check(true, 'sidebar shows new name without reload');

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
    check(await desktop.locator('.model-option .model-check').count() === 3, 'edit mode shows a checkbox per model');
    check(await desktop.locator('.model-group-toggle').count() === 1, 'provider header becomes a section toggle');
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
    // Provider header toggles its whole section: all on → all off → all on.
    await desktop.click('.model-group-toggle');
    check(await desktop.locator('.model-option.disabled').count() === 3,
      'provider toggle disables every model in the section');
    await desktop.click('.model-group-toggle');
    check(await desktop.locator('.model-option.disabled').count() === 0,
      'provider toggle re-enables the section');
    await desktop.waitForTimeout(700); // debounced save settles (round-trip = no filter)
    check(!('enabledModels' in readSettings()), 'provider round-trip leaves no filter persisted');
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

    // 8. Queue strip: steering a message during a turn surfaces it in the
    // always-visible strip; Edit pulls it back out of pi's queue and into the
    // composer, emptying the strip.
    console.log('queue strip (steer + edit):');
    emit('turn_start', {}); // reveal #btnSteer (only shown mid-turn)
    await desktop.waitForSelector('#btnSteer', { state: 'visible', timeout: 3000 });
    await desktop.fill('#promptInput', 'steer me now');
    await desktop.click('#btnSteer');
    await desktop.waitForSelector('.queue-item', { timeout: 5000 });
    check(await desktop.locator('.queue-item-text').first().textContent() === 'steer me now',
      'steered message appears as a strip row');
    check(await desktop.locator('.queue-item[data-kind="steering"]').count() === 1, 'row tagged as steering');
    await desktop.click('.queue-item-edit');
    await desktop.waitForFunction(() =>
      document.getElementById('promptInput').value.includes('steer me now'), { timeout: 5000 });
    check(true, 'Edit returns the queued text to the composer');
    await desktop.waitForFunction(() => document.getElementById('queuePanel').style.display === 'none', { timeout: 5000 });
    check(true, 'strip empties after the message is edited out of the queue');
    await desktop.fill('#promptInput', ''); // don't leave it in the draft

    // 8a. Mid-turn steer delivery: pi delivers a queued user message during the
    // turn (message_start/message_end, role user). It must render in the
    // transcript immediately, before turn_end's JSONL catch-up.
    console.log('mid-turn steer delivery:');
    const deliveredText = 'delivered steer mid-turn';
    emit('message_start', { message: { role: 'user', content: [{ type: 'text', text: deliveredText }] } });
    emit('message_end', { message: { role: 'user', content: [{ type: 'text', text: deliveredText }], timestamp: new Date().toISOString() } });
    await desktop.waitForFunction((t) =>
      [...document.querySelectorAll('.message.user')].some((el) => el.textContent.includes(t)),
      deliveredText, { timeout: 5000 });
    check(true, 'delivered user message renders mid-turn (before turn_end)');
    emit('turn_end', {});

    // 8b. SSE queue replay: a queue with content must repopulate the strip on a
    // fresh stream connection (switch away and back), from the hello/replay
    // path — not just from the live event the current client already saw.
    console.log('queue SSE replay:');
    setQueue({ steering: [], followUp: ['replay me later'] });
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.queue-item-text')].some((el) => el.textContent === 'replay me later'),
      { timeout: 5000 });
    await desktop.click('.session-item'); // re-select → fresh SSE connection
    // selectSession clears the strip; only the server-side replay can refill it.
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.queue-item-text')].some((el) => el.textContent === 'replay me later'),
      { timeout: 5000 });
    check(true, 'queue strip repopulates from the SSE replay after reconnect');
    setQueue({ steering: [], followUp: [] });
    await desktop.waitForFunction(() => document.getElementById('queuePanel').style.display === 'none', { timeout: 5000 });
    check(true, 'strip hides when the queue drains');

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

    // 8c. Compaction status: compaction_start/compaction_end drive the status
    // line. The bridge reports tokensBefore only (post-compaction size is
    // unknown until the next LLM response), and a failed manual compaction
    // must not leave "Compacting..." stuck.
    console.log('compaction status:');
    emit('compaction_start', { reason: 'manual' });
    await desktop.waitForFunction(() =>
      document.getElementById('status')?.textContent === 'Compacting context...', { timeout: 3000 });
    check(true, 'compaction_start shows working status');
    emit('compaction_end', { reason: 'manual', errorMessage: 'model refused' });
    await desktop.waitForFunction(() =>
      (document.getElementById('status')?.textContent || '').startsWith('Compaction failed: model refused'),
      { timeout: 3000 });
    check(true, 'failed compaction reports the error');
    emit('compaction_start', { reason: 'manual' });
    emit('compaction_end', { reason: 'manual', result: { tokensBefore: 152300 } });
    await desktop.waitForFunction(() =>
      document.getElementById('status')?.textContent === 'Compacted (was 152.3k tokens)', { timeout: 3000 });
    check(true, 'completed compaction reports tokensBefore');

    // 8c-2. Compaction gates sends: while compacting there's no turn, but a
    // prompt sent now must be held (bridge buffers, acks queued) and delivered
    // as a turn once compaction ends — not raced against pi's message rewrite.
    // The working badge (not just the transient status line) shows compaction.
    console.log('compaction queuing:');
    fakeCompacting = true;
    emit('compaction_start', { reason: 'manual' });
    await desktop.waitForFunction(() =>
      /^Compacting context…/.test(document.querySelector('#sessionWorking .spinner-text')?.textContent || ''), { timeout: 3000 });
    check(true, 'compaction drives the working badge (with elapsed timer)');

    // A /compact typed while one runs must be refused client-side before it
    // ever reaches the server, and the composer text must survive.
    await desktop.fill('#promptInput', '');
    await desktop.type('#promptInput', '/compact');
    await desktop.click('#btnSend');
    await desktop.waitForFunction(() =>
      document.getElementById('status')?.textContent === 'Compaction already in progress', { timeout: 3000 });
    check(true, 'second /compact is refused while compacting');
    check(await desktop.evaluate(() => document.getElementById('promptInput').value) === '/compact',
      'refused /compact keeps the composer text');
    await desktop.fill('#promptInput', '');

    const repliesBefore = await desktop.evaluate(() =>
      [...document.querySelectorAll('.message.assistant')].filter((m) => /Streamed reply/.test(m.textContent)).length);
    await desktop.fill('#promptInput', '');
    await desktop.type('#promptInput', 'send after compaction');
    await desktop.click('#btnSend');
    await desktop.waitForFunction(() =>
      /Queued — will send when compaction finishes/.test(document.getElementById('status')?.textContent || ''), { timeout: 3000 });
    check(true, 'prompt sent mid-compaction is reported as queued');

    fakeCompacting = false;
    emit('compaction_end', { reason: 'manual', result: { tokensBefore: 90000 } });
    flushBufferedPrompt();
    await desktop.waitForFunction((n) =>
      [...document.querySelectorAll('.message.assistant')].filter((m) => /Streamed reply/.test(m.textContent)).length > n,
      repliesBefore, { timeout: 6000 });
    check(true, 'queued prompt is delivered as a turn after compaction ends');
    await desktop.waitForFunction(() =>
      document.querySelector('#sessionWorking .spinner-text')?.textContent === 'Working', { timeout: 6000 });
    check(true, 'working badge resets after the flushed turn');

    // Auto-compaction runs *inside* a turn (turn + compaction flags both on):
    // the badge must switch to Compacting while it runs and hand back to the
    // turn's Working timer when it ends. Previously the turn badge masked it
    // and the user couldn't tell why the stream had stalled — or that a
    // /compact sent now would corrupt the session.
    console.log('auto-compaction mid-turn:');
    emit('turn_start', {});
    await desktop.waitForFunction(() =>
      /^Working/.test(document.querySelector('#sessionWorking .spinner-text')?.textContent || ''), { timeout: 3000 });
    emit('compaction_start', { reason: 'auto' });
    await desktop.waitForFunction(() =>
      /^Compacting context…/.test(document.querySelector('#sessionWorking .spinner-text')?.textContent || ''), { timeout: 3000 });
    check(true, 'auto-compaction takes over the badge mid-turn');
    emit('compaction_end', { reason: 'auto', result: { tokensBefore: 152300, estimatedTokensAfter: 30500 } });
    await desktop.waitForFunction(() =>
      /^Working/.test(document.querySelector('#sessionWorking .spinner-text')?.textContent || ''), { timeout: 3000 });
    check(true, 'badge hands back to the turn timer when auto-compaction ends');
    await desktop.waitForFunction(() =>
      document.getElementById('status')?.textContent === 'Compacted: 152.3k → ~30.5k tokens', { timeout: 3000 });
    check(true, 'estimatedTokensAfter is reported when present');
    emit('turn_end', {});
    await desktop.waitForFunction(() =>
      document.querySelector('#sessionWorking .spinner-text')?.textContent === 'Working', { timeout: 3000 });
    check(true, 'badge fully resets after the compacted turn');

    // 8c-3. Tree navigation: a session_tree event means the authoritative
    // history changed (a /tree branch — from this UI, the TUI, or another
    // client), and the client must re-render the transcript from the JSONL.
    // The shrink direction is the structural proof: an append-only catch-up
    // can never remove a message, only a forced full reload can.
    console.log('tree navigation reload:');
    const preBranchJsonl = fs.readFileSync(sessionFile, 'utf-8');
    appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'pre-branch marker' }], timestamp: new Date().toISOString() } });
    emit('session_tree', { newLeafId: 'anywhere' });
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.message.user')].some((el) => el.textContent.includes('pre-branch marker')),
      { timeout: 5000 });
    check(true, 'session_tree triggers a transcript re-fetch (new entry renders)');
    // That reload tore down and reopened the SSE stream; an event emitted
    // into the gap before the new connection's subs register is silently
    // lost. Real clients recover appended messages via the init catch-up,
    // but a tree rewrite *shrinks* history — not append-recoverable — so
    // prove the new stream is live before the next emit. Extension statuses
    // are remembered server-side and replayed into every new connection, so
    // this badge arrives whichever side of the reconnect the event lands on.
    emit('extension_ui_request', { method: 'setStatus', statusKey: 'tree-sync', statusText: 'stream reconnected' });
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.ext-ui-status-badge')].some((el) => el.textContent === 'stream reconnected'),
      { timeout: 5000 });
    emit('extension_ui_request', { method: 'setStatus', statusKey: 'tree-sync', statusText: '' });
    fs.writeFileSync(sessionFile, preBranchJsonl); // the "branch": history shrinks
    emit('session_tree', { newLeafId: 'anywhere' });
    await desktop.waitForFunction(() =>
      ![...document.querySelectorAll('.message.user')].some((el) => el.textContent.includes('pre-branch marker')),
      { timeout: 5000 });
    check(true, 'branched-away message disappears (forced reload, not a catch-up)');

    // 8d. Terminal: header button opens a shell at the session cwd over the
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
    // Drag-resize: pull the top-edge handle up — the panel grows, and the
    // height persists (as a % of the session view) for the next open.
    const heightBefore = await desktop.evaluate(() => document.getElementById('terminalPanel').offsetHeight);
    const termHandleBox = await desktop.locator('#terminalResizeHandle').boundingBox();
    await desktop.mouse.move(termHandleBox.x + termHandleBox.width / 2, termHandleBox.y + 2);
    await desktop.mouse.down();
    await desktop.mouse.move(termHandleBox.x + termHandleBox.width / 2, termHandleBox.y - 118, { steps: 5 });
    await desktop.mouse.up();
    const heightAfter = await desktop.evaluate(() => document.getElementById('terminalPanel').offsetHeight);
    check(heightAfter > heightBefore + 80,
      `drag handle grows the panel (${heightBefore}px -> ${heightAfter}px)`);
    check(await desktop.evaluate(() => localStorage.getItem('pi-dish-terminal-size') !== null),
      'resized height persists to localStorage');
    // Mode switch: tmux is available on this machine but the fixture session
    // has no pane, so the tmux view must fail with the clear no-pane error —
    // and switching back must land in a working shell again.
    if (await desktop.evaluate(() => appConfig.tmux)) {
      check((await desktop.locator('#termModeBtn').textContent()).includes('pi tmux'),
        'mode button offers the tmux pane view');
      await desktop.click('#termModeBtn');
      await desktop.waitForFunction(() =>
        /tmux pane/i.test(document.getElementById('terminalStatus').textContent), { timeout: 5000 });
      check(true, 'pane-less session surfaces the no-tmux-pane error');
      await desktop.click('#termModeBtn'); // back to shell
      await desktop.waitForFunction(() => document.getElementById('terminalStatus').textContent === '',
        { timeout: 5000 });
      await desktop.keyboard.type('echo back-to-shell-$((6+3))\r');
      await desktop.waitForFunction(() => {
        const rows = document.querySelector('#terminalPanel .xterm');
        return rows && rows.textContent.includes('back-to-shell-9');
      }, { timeout: 5000 });
      check(true, 'switching back re-enters a working shell');
    }
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
    check(await desktop.inputValue('#promptInput') === 'send after compaction',
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
    // The server caches the registry scan for 500ms (REGISTRY_CACHE_MS) — a
    // loadSessions() right after registering can read a warm cache that predates
    // session 2 and file it under "previous", so it never shows on the Active
    // tab. Let the cache lapse before forcing the fetch.
    await desktop.waitForTimeout(600);
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

    // 12. All-tab server search: busy indicator while in flight, content
    // matches carry a highlighted snippet, clearing restores the full list.
    console.log('sidebar search:');
    await desktop.fill('#filterInput', 'beta answer');
    // The busy class is set synchronously on input and can't clear before
    // the 300ms debounce fires — safe to assert without racing the response.
    check(await desktop.evaluate(() =>
      document.querySelector('.sidebar-filter').classList.contains('searching')),
      'search shows busy indicator from the first keystroke');
    await desktop.waitForSelector('.session-item-snippet', { timeout: 5000 });
    const snippet = await desktop.locator(`.session-item[data-id="${BETA_ID}"] .session-item-snippet`);
    check((await snippet.locator('mark').count()) >= 2,
      'content match shows a snippet with the tokens highlighted');
    await desktop.waitForFunction(() =>
      !document.querySelector('.sidebar-filter').classList.contains('searching'), null, { timeout: 5000 });
    check(true, 'busy indicator clears once results land');
    check(await desktop.evaluate(() =>
      document.querySelectorAll('#sessionList .session-item').length) === 1,
      'non-matching sessions filtered out');
    await desktop.fill('#filterInput', '');
    await desktop.waitForFunction(() =>
      document.querySelectorAll('#sessionList .session-item').length >= 3, null, { timeout: 5000 });
    check(await desktop.locator('.session-item-snippet').count() === 0,
      'clearing the query drops snippets and restores the list');

    // 12b. Filter grammar + saved scopes + Recent view.
    console.log('filter grammar, scopes, recent view:');
    // Negation is metadata-only and works server-side on the All tab.
    await desktop.fill('#filterInput', '-beta');
    await desktop.waitForFunction((betaId) =>
      document.querySelectorAll('#sessionList .session-item').length >= 2 &&
      !document.querySelector(`.session-item[data-id="${betaId}"]`), BETA_ID, { timeout: 5000 });
    check(true, 'negative filter -beta hides the beta session, keeps the rest');
    // Typing surfaced the "+ save filter" chip — save the query as a scope.
    await desktop.evaluate(() => { window.prompt = () => 'No beta'; });
    await desktop.click('.scope-chip.scope-add');
    await desktop.waitForSelector('.scope-chip.active', { timeout: 5000 });
    check(await desktop.evaluate(() => document.querySelector('.scope-chip.active')?.textContent) === 'No beta',
      'saved scope renders as an active chip');
    check(await desktop.evaluate(() => document.getElementById('filterInput').value) === '',
      'saving a scope clears the typed query it absorbed');
    await desktop.waitForFunction((betaId) =>
      !document.querySelector(`.session-item[data-id="${betaId}"]`) &&
      document.querySelector('.scope-hidden-note')?.textContent === '1 hidden by scopes',
      BETA_ID, { timeout: 5000 });
    check(true, 'active scope keeps filtering with an audit note for the hidden row');
    // Scope state is device-local; definitions are server-global settings.
    check(await desktop.evaluate(() => localStorage.getItem('pi-dish-active-scopes')) === JSON.stringify(['No beta']),
      'active scope persisted to localStorage');
    const serverFilters = await fetch(`${base}/api/settings`).then(r => r.json());
    check(JSON.stringify(serverFilters.savedFilters) === JSON.stringify([{ name: 'No beta', query: '-beta' }]),
      'scope definition persisted server-side');
    // Toggling the chip off restores the hidden session.
    await desktop.click('.scope-chip');
    await desktop.waitForSelector(`.session-item[data-id="${BETA_ID}"]`, { timeout: 5000 });
    check(await desktop.locator('.scope-hidden-note').count() === 0, 'inactive scope stops filtering');
    // Recent view: date buckets instead of the workspace tree, rows carry cwd.
    await desktop.click('#viewToggle');
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.workspace-group-label')].some(el => el.textContent === 'Today'),
      null, { timeout: 5000 });
    check(await desktop.evaluate(() => localStorage.getItem('pi-dish-sidebar-view')) === 'recent',
      'view choice persisted');
    check(await desktop.evaluate(() =>
      document.querySelectorAll('#sessionList .session-item').length ===
      document.querySelectorAll('#sessionList .session-item .session-item-cwd').length),
      'recent-view rows all show their workspace');
    check(await desktop.locator('.workspace-new-btn').count() === 0,
      'date headers carry no per-workspace + button');
    // Collapsing a date bucket hides rows but keeps its chronological slot.
    await desktop.click('.workspace-group-header[data-cwd="date:today"]');
    await desktop.waitForSelector('.session-segment.collapsed', { timeout: 2000 });
    check(await desktop.locator('.session-segment.collapsed .session-item').count() === 0,
      'collapsed date bucket hides its sessions');
    await desktop.click('.workspace-group-header[data-cwd="date:today"]');
    await desktop.waitForFunction(() => !document.querySelector('.session-segment.collapsed'), null, { timeout: 2000 });
    // Delete the scope from the settings modal; chips row empties.
    await desktop.evaluate(() => openSettingsModal());
    await desktop.waitForSelector('.saved-filter-del', { timeout: 5000 });
    await desktop.click('.saved-filter-del');
    await desktop.waitForSelector('.saved-filters-empty', { timeout: 5000 });
    await desktop.evaluate(() => closeSettingsModal());
    await desktop.waitForFunction(() => !document.querySelector('.scope-chip'), null, { timeout: 5000 });
    check(true, 'deleting the saved filter in settings clears the chips');
    // Back to the workspace view for the sections below.
    await desktop.click('#viewToggle');
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.workspace-group-label')].some(el => el.textContent === 'proj-alpha'),
      null, { timeout: 5000 });

    // 13. Long transcript history: reaching the top should implicitly page
    // older messages. Pages loaded deliberately stay warm across a brief
    // session switch, including the earliest page a filtered search may need.
    console.log('transcript history retention:');
    await desktop.click(`.session-item[data-id="${BETA_ID}"]`);
    await desktop.waitForFunction(() =>
      document.querySelectorAll('#messages [data-msg-index]').length === 50,
      null, { timeout: 5000 });
    await desktop.evaluate(() => { document.getElementById('messages').scrollTop = 0; });
    await desktop.waitForFunction(() =>
      document.querySelectorAll('#messages [data-msg-index]').length >= 100,
      null, { timeout: 5000 });
    check(true, 'scrolling to the top implicitly loads the previous transcript page');
    await desktop.evaluate(() => { document.getElementById('messages').scrollTop = 0; });
    await desktop.waitForFunction(() =>
      document.querySelector('#messages [data-msg-index="0"]'),
      null, { timeout: 5000 });
    const loadedBetaCount = await desktop.locator('#messages [data-msg-index]').count();
    check(loadedBetaCount === 130, `repeated upward scrolling reaches the full history (got ${loadedBetaCount})`);
    await desktop.evaluate(() => {
      const el = document.getElementById('messages');
      el.scrollTop = el.scrollHeight;
    });
    check(await desktop.locator('#messages [data-msg-index]').count() === loadedBetaCount,
      'returning to the latest message keeps intentionally loaded history');
    await desktop.click(`.session-item[data-id="${registryState.sessionId}"]`);
    await desktop.waitForSelector('#messages .message.assistant');
    await desktop.click(`.session-item[data-id="${BETA_ID}"]`);
    await desktop.waitForFunction((count) =>
      document.querySelectorAll('#messages [data-msg-index]').length === count,
      loadedBetaCount, { timeout: 5000 });
    check(await desktop.locator('#messages [data-msg-index="0"]').count() === 1,
      'briefly switching sessions preserves the earliest loaded history');
    await desktop.click(`.session-item[data-id="${registryState.sessionId}"]`);
    await desktop.waitForSelector('#messages .message.assistant');

    await desktop.click('#tabActive');
    await desktop.waitForTimeout(200);

    // 13b. Advanced search takeover: opened via the "full search" chip
    // (carrying the sidebar query), same grammar, multi-snippet results,
    // facet buttons that rewrite the query text, and click-through that
    // lands on the in-session match. Runs *after* the retention section on
    // purpose — click-through warms the beta transcript cache, which would
    // break that section's cold-load page-count assertions.
    console.log('advanced search takeover:');
    await desktop.fill('#filterInput', 'beta');
    await desktop.waitForSelector('.search-open-chip', { timeout: 2000 });
    await desktop.click('.search-open-chip');
    await desktop.waitForFunction(() =>
      document.querySelector('.main').classList.contains('search-open'), null, { timeout: 5000 });
    check(await desktop.evaluate(() => document.getElementById('searchViewInput').value) === 'beta',
      'full-search chip carries the sidebar query into the takeover');
    check(await desktop.evaluate(() => document.getElementById('sessionView').offsetParent === null),
      'session view hidden while search is open');
    await desktop.fill('#searchViewInput', 'beta answer');
    await desktop.waitForSelector(`.search-result[data-id="${BETA_ID}"] .search-result-snippet mark`, { timeout: 5000 });
    check(true, 'content match renders highlighted snippets');
    const countText = await desktop.evaluate((id) =>
      document.querySelector(`.search-result[data-id="${id}"] .search-result-count`)?.textContent, BETA_ID);
    check(/^\d+ matches$/.test(countText || '') && parseInt(countText) > 1,
      `occurrence count rendered (got "${countText}")`);
    // The Active-only facet rewrites the query text (is:active) and filters.
    await desktop.click('#searchFacetActive');
    await desktop.waitForFunction((id) =>
      document.getElementById('searchViewInput').value.includes('is:active') &&
      !document.querySelector(`.search-result[data-id="${id}"]`), BETA_ID, { timeout: 5000 });
    check(true, 'Active-only facet injects is:active and drops historical sessions');
    await desktop.click('#searchFacetActive');
    await desktop.waitForSelector(`.search-result[data-id="${BETA_ID}"]`, { timeout: 5000 });
    check(!(await desktop.evaluate(() => document.getElementById('searchViewInput').value)).includes('is:active'),
      'toggling the facet off removes its token, keeping the text terms');
    // Click-through: takeover closes, the session opens, and the positive
    // tokens land in the in-session search with the match marked.
    await desktop.click(`.search-result[data-id="${BETA_ID}"]`);
    await desktop.waitForFunction(() =>
      !document.querySelector('.main').classList.contains('search-open'), null, { timeout: 5000 });
    await desktop.waitForSelector('mark.search-mark', { timeout: 10000 });
    check(await desktop.evaluate(() => document.getElementById('searchInput').value) === 'beta answer',
      'click-through hands the tokens to the in-session search');
    check(await desktop.evaluate(() => document.getElementById('sessionName').textContent) === 'beta question',
      'click-through opened the matched session');
    // Escape closes the takeover.
    await desktop.evaluate(() => { closeSearch(); openSearchView('alpha'); });
    await desktop.waitForFunction(() =>
      document.querySelector('.main').classList.contains('search-open'), null, { timeout: 5000 });
    await desktop.keyboard.press('Escape');
    await desktop.waitForFunction(() =>
      !document.querySelector('.main').classList.contains('search-open'), null, { timeout: 5000 });
    check(true, 'Escape closes the search takeover');
    await desktop.fill('#filterInput', '');
    await desktop.waitForSelector(`.session-item[data-id="${registryState.sessionId}"]`, { timeout: 5000 });
    await desktop.click(`.session-item[data-id="${registryState.sessionId}"]`);
    await desktop.waitForSelector('#messages .message.assistant', { timeout: 5000 });

    // Usage view: the global usage overview as a main-pane takeover (sidebar
    // header bar-chart button). Range presets re-scope the sections, a bar
    // click opens that day's per-model detail, a session row jumps into the
    // session, and Escape closes the pane. Asserted on the all-time range so
    // the fixed fixture dates stay in-window whenever the smoke runs.
    console.log('usage view:');
    await desktop.click('[title="Usage and spend"]');
    await desktop.waitForSelector('.usage-kpis', { timeout: 5000 });
    check(await desktop.evaluate(() => document.querySelector('.main').classList.contains('usage-open')),
      'usage button opens the takeover pane');
    check(await desktop.evaluate(() => document.getElementById('sessionView').offsetParent === null),
      'session view hidden while usage is open');
    await desktop.click('[data-range="all"]');
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('smoke-model')),
      null, { timeout: 5000 });
    check(true, 'all-time range lists the fixture model with its share');
    // Token breakdowns: the totals line splits in/out with a cache rate
    // (fixture: 100 in, 45 out, 20 cacheRead over a 130-token prompt side =
    // 15% hit), and the model rows carry the compact per-row form.
    check(await desktop.evaluate(() => {
      const line = document.querySelector('.usage-token-line');
      return !!line && line.textContent.includes('100 in') && line.textContent.includes('45 out') &&
        line.textContent.includes('(15% hit)');
    }), 'range totals break down in/out tokens and the cache rate');
    check(await desktop.evaluate(() =>
      [...document.querySelectorAll('#usageViewBody .usage-row.model-toggle')]
        .some((r) => r.textContent.includes('100 in / 45 out') && r.textContent.includes('15% cached'))),
      'model rows carry in/out and cached-share breakdowns');
    await desktop.waitForSelector('#usageChart svg', { timeout: 5000 });
    check(await desktop.locator('#usageChart .usage-col').count() >= 2,
      'stacked daily chart renders one column per bucket');
    check(await desktop.locator('#usageChart text.tick').count() >= 4,
      'chart draws axis tick labels');
    await desktop.locator('#usageChart .usage-col[aria-label*="$0."]').first().click();
    await desktop.waitForSelector('.usage-day-detail', { timeout: 2000 });
    check(await desktop.evaluate(() => document.querySelector('.usage-day-detail').textContent.includes('smoke-model')),
      "clicking a bar opens that day's per-model detail");
    check(await desktop.evaluate(() => document.querySelector('.usage-day-detail').textContent.includes('% hit')),
      'day detail includes the cache hit rate');
    // Sort toggle refetches with sort=tokens and re-renders the breakdowns.
    await desktop.click('.usage-sort [data-sort="tokens"]');
    await desktop.waitForFunction(() =>
      document.querySelector('.usage-sort [data-sort="tokens"]')?.classList.contains('active') &&
      [...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('smoke-model')),
      null, { timeout: 5000 });
    check(await desktop.evaluate(() => localStorage.getItem('pi-dish-usage-sort') === 'tokens'),
      'tokens sort activates and persists device-locally');
    await desktop.waitForFunction(() =>
      document.querySelector('#usageChart svg')?.getAttribute('aria-label')?.startsWith('Tokens'),
      null, { timeout: 5000 });
    check(true, 'tokens metric drives the daily chart, not just the tables');
    await desktop.click('.usage-sort [data-sort="cost"]');
    await desktop.waitForFunction(() =>
      document.querySelector('.usage-sort [data-sort="cost"]')?.classList.contains('active'),
      null, { timeout: 5000 });
    // Model filter: model rows are multi-select toggles; the filter is
    // applied server-side, so the workspace/session groups reflect it. The
    // beta session's calls index under unknown/unknown, so filtering to the
    // fixture's smoke-model must drop the beta workspace.
    check(await desktop.evaluate(() =>
      [...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('proj-beta'))),
      'unfiltered usage lists the beta workspace');
    await desktop.click('.usage-row.model-toggle[data-model-ref="test/smoke-model"]');
    await desktop.waitForFunction(() =>
      document.querySelector('.usage-filter-note')?.textContent.includes('smoke-model'),
      null, { timeout: 5000 });
    check(await desktop.evaluate(() =>
      ![...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('proj-beta'))),
      'model filter drops workspaces/sessions without that model');
    check(await desktop.evaluate(() => {
      const rows = [...document.querySelectorAll('#usageViewBody .usage-row.model-toggle')];
      return rows.some((r) => r.classList.contains('on') && r.textContent.includes('smoke-model')) &&
        rows.some((r) => r.classList.contains('off'));
    }), 'facet list keeps deselected models, dimmed');
    await desktop.click('#usageViewBody .usage-row.model-toggle.off');
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('proj-beta')),
      null, { timeout: 5000 });
    check(true, 'multi-select re-adds a second model and the beta workspace returns');
    await desktop.click('[data-clear-models]');
    await desktop.waitForFunction(() => !document.querySelector('.usage-filter-note'),
      null, { timeout: 5000 });
    check(true, 'clear removes the model filter');
    await desktop.click(`[data-session-id="${SESSION_ID}"]`);
    await desktop.waitForFunction(() => !document.querySelector('.main').classList.contains('usage-open'),
      null, { timeout: 2000 });
    check(await desktop.evaluate(() => document.getElementById('sessionView').offsetParent !== null),
      'session row closes the takeover and shows that session');
    await desktop.click('[title="Usage and spend"]');
    await desktop.waitForSelector('.usage-kpis', { timeout: 5000 });
    await desktop.keyboard.press('Escape');
    await desktop.waitForFunction(() => !document.querySelector('.main').classList.contains('usage-open'),
      null, { timeout: 2000 });
    check(true, 'Escape closes the usage view');

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

    // 13. Close session: the stats modal shows where the session runs, and
    // its danger button SIGTERMs the pi process, flipping the view to the
    // inactive/resume state. A dummy child stands in for pi — the registry
    // normally carries this process's own pid, which close must never get.
    console.log('close session:');
    const { spawn } = require('child_process');
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    let dummySignal = null;
    const dummyGone = new Promise((r) => dummy.on('exit', (code, sig) => { dummySignal = sig; r(); }));
    writeRegistry({ pid: dummy.pid });
    await desktop.waitForTimeout(700); // registry scan memo TTL
    await desktop.click(`.session-item[data-id="${registryState.sessionId}"]`);
    await desktop.waitForSelector('.message.assistant');
    await desktop.click('#sessionContext');
    await desktop.waitForSelector('#sessionCloseBtn', { timeout: 2000 });
    const runtimeRow = await desktop.evaluate(() => {
      const row = [...document.querySelectorAll('#statsBody tr')]
        .find((tr) => tr.querySelector('.stats-key')?.textContent === 'Running in');
      return row ? row.querySelector('.stats-val').textContent : null;
    });
    check(runtimeRow === `terminal · pid ${dummy.pid}`,
      `stats modal shows where the session runs (got ${JSON.stringify(runtimeRow)})`);
    desktop.once('dialog', (d) => d.accept());
    await desktop.click('#sessionCloseBtn');
    await desktop.waitForSelector('#resumeBar', { state: 'visible', timeout: 10000 });
    check(true, 'view flipped to the inactive/resume state after close');
    await dummyGone;
    check(dummySignal === 'SIGTERM', `pi process got a graceful SIGTERM (got ${dummySignal})`);

    // Stats remain useful after a session stops (and on devices where the
    // desktop context badge is hidden), so the read-only bar keeps them
    // available without requiring a successful resume.
    await desktop.click('#inactiveStatsBtn');
    await desktop.waitForSelector('#statsModal', { state: 'visible' });
    await desktop.locator('#statsBody').getByText('Performance', { exact: true }).waitFor();
    check(true, 'inactive session stats are accessible without resuming');
    await desktop.click('#statsModal .modal-header .btn-icon');

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
