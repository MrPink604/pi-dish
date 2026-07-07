#!/usr/bin/env node
/**
 * README screenshot generator — same fake-bridge pattern as test/ui-smoke.js,
 * but with realistic (entirely fabricated) session content. Everything on
 * screen comes from fixtures under a temp HOME with cwds like
 * /home/demo/projects/webapp, so no real username/path/host can leak.
 *
 * Run: npm run shots — then strip metadata before committing, e.g.
 *   magick shot.png -strip -define png:exclude-chunks=tIME,tEXt,zTXt,iTXt,date shot.png
 */
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(REPO, 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// --- temp HOME ----------------------------------------------------------------
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-shots-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';

const sessionsRoot = path.join(tmpHome, '.pi', 'agent', 'sessions');
const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
fs.mkdirSync(registryDir, { recursive: true });

const ts = (minAgo, secOffset = 0) =>
  new Date(Date.now() - minAgo * 60_000 + secOffset * 1000).toISOString();

function writeSession(dirName, id, entries) {
  const dir = path.join(sessionsRoot, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}
const user = (text, t) => ({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }], timestamp: t } });
const asst = (content, t) => ({ type: 'message', message: { role: 'assistant', content, timestamp: t } });
const toolCall = (id, name, args, t) => asst([{ type: 'toolCall', id, name, arguments: args }], t);
const toolResult = (name, text, t) => ({ type: 'message', message: { role: 'toolResult', toolName: name, content: [{ type: 'text', text }], timestamp: t } });

// --- main live session: webapp / rate limiting ---------------------------------
const MAIN_ID = '2026-07-07T08-41-00-demo0001';
const MAIN_CWD = '/home/demo/projects/webapp';

const finalAnswer = `Added a sliding-window limiter — no new dependencies, just a \`Map\` keyed by IP:

\`\`\`js
// lib/rate-limit.js
function rateLimit({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map(); // ip -> recent timestamps
  return (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(req.ip, recent);
    if (recent.length > max) return res.status(429).json({ error: 'rate limited' });
    next();
  };
}
\`\`\`

- \`POST /api/upload\` now runs through \`rateLimit({ max: 30 })\`
- requests over the limit get a \`429\` with a JSON body
- old entries are filtered out on each hit, so the map can't grow unbounded per IP
- all 42 tests pass

Want me to add a \`Retry-After\` header while I'm in here?`;

const mainFile = writeSession('--home-demo-projects-webapp--', MAIN_ID, [
  { type: 'session', cwd: MAIN_CWD, timestamp: ts(38) },
  { type: 'model_change', modelId: 'claude-sonnet-5', timestamp: ts(38) },
  { type: 'session_info', name: 'rate limiting', timestamp: ts(38) },
  user('The /api/upload endpoint is getting hammered by retry loops on flaky mobile connections. Add per-IP rate limiting — keep it dependency-free if you can.', ts(37)),
  asst([{ type: 'text', text: 'Checking how uploads are wired up before touching anything.' }], ts(36, 40)),
  toolCall('t1', 'set_mood', { description: 'focused', kaomoji: "(ง'̀-'́)ง" }, ts(36, 42)),
  toolResult('set_mood', "mood set: focused (ง'̀-'́)ง", ts(36, 43)),
  toolCall('t2', 'read', { path: 'server.js' }, ts(36, 45)),
  toolResult('read', "  1  const express = require('express');\n  2  const app = express();\n ...\n142  app.post('/api/upload', upload.single('file'), (req, res) => {\n143    // no throttling here — every retry lands\n", ts(36, 47)),
  toolCall('t3', 'grep', { pattern: 'middleware', path: 'lib/' }, ts(36, 50)),
  toolResult('grep', 'lib/auth.js:12: // middleware chain runs before routes\nlib/logging.js:3: module.exports = function logging(req, res, next) {', ts(36, 52)),
  toolCall('t4', 'write', { path: 'lib/rate-limit.js' }, ts(35, 10)),
  toolResult('write', 'Wrote lib/rate-limit.js (19 lines)', ts(35, 12)),
  toolCall('t5', 'edit', { path: 'server.js' }, ts(35, 20)),
  toolResult('edit', 'server.js updated: /api/upload now uses rateLimit({ max: 30 })', ts(35, 22)),
  toolCall('t6', 'bash', { command: 'npm test' }, ts(35, 30)),
  toolResult('bash', '> webapp@1.4.2 test\n> node --test test/\n\n✔ upload accepts a small file (48ms)\n✔ upload rejects the 31st request in a minute (102ms)\n\n42 passing (1.8s)', ts(34, 45)),
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: finalAnswer }], usage: { totalTokens: 61400 }, timestamp: ts(34) } },
]);

// --- second live session: api-server -------------------------------------------
const API_ID = '2026-07-07T07-55-00-demo0002';
const API_CWD = '/home/demo/projects/api-server';
const apiFile = writeSession('--home-demo-projects-api-server--', API_ID, [
  { type: 'session', cwd: API_CWD, timestamp: ts(85) },
  { type: 'model_change', modelId: 'claude-opus-4-8', timestamp: ts(85) },
  { type: 'session_info', name: 'schema migration', timestamp: ts(85) },
  user('Walk the schema migration in migrations/007 and check it against staging.', ts(84)),
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'The migration adds the `accounts.plan` column with a backfill — staging schema matches after a dry run.' }], usage: { totalTokens: 112300 }, timestamp: ts(80) } },
]);

// --- historical sessions (dimmed on the All tab) --------------------------------
writeSession('--home-demo-projects-webapp--', '2026-07-06T21-12-00-demo0003', [
  { type: 'session', cwd: MAIN_CWD, timestamp: ts(11 * 60) },
  { type: 'model_change', modelId: 'claude-sonnet-5', timestamp: ts(11 * 60) },
  user('Fix the flaky websocket reconnect test', ts(11 * 60)),
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'The test raced the reconnect timer — pinned it with a fake clock.' }], usage: { totalTokens: 24800 }, timestamp: ts(11 * 60 - 4) } },
]);
writeSession('--home-demo-dotfiles--', '2026-07-05T18-03-00-demo0004', [
  { type: 'session', cwd: '/home/demo/dotfiles', timestamp: ts(38 * 60) },
  { type: 'model_change', modelId: 'claude-haiku-4-5', timestamp: ts(38 * 60) },
  user('Port my tmux config to the new machine', ts(38 * 60)),
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Copied and updated the prefix binding.' }], usage: { totalTokens: 9100 }, timestamp: ts(38 * 60 - 2) } },
]);

// --- fake bridges ----------------------------------------------------------------
function makeBridge(socketPath, { models, onPrompt } = {}) {
  const clients = new Set();
  const server = net.createServer((sock) => {
    clients.add(sock);
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => clients.delete(sock));
    sock.write(JSON.stringify({ type: 'hello', turnInProgress: false }) + '\n');
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        let data = {};
        if (msg.command === 'get_available_models') data = { models };
        else if (msg.command === 'get_commands') data = [
          { name: 'compact', description: 'compact the session', source: 'builtin' },
          { name: 'mood', description: 'set the mood', source: 'extension' },
        ];
        sock.write(JSON.stringify({ type: 'response', id: msg.id, success: true, data }) + '\n');
        if (msg.command === 'prompt' && onPrompt) onPrompt(msg);
      }
    });
  });
  const emit = (event, data) => {
    const line = JSON.stringify({ type: 'event', event, data }) + '\n';
    for (const c of clients) c.write(line);
  };
  return { server, emit };
}

const MODELS = [
  { id: 'claude-sonnet-5', provider: 'anthropic', name: 'Claude Sonnet 5', contextWindow: 200000 },
  { id: 'claude-opus-4-8', provider: 'anthropic', name: 'Claude Opus 4.8', contextWindow: 200000 },
  { id: 'claude-haiku-4-5', provider: 'anthropic', name: 'Claude Haiku 4.5', contextWindow: 200000 },
];

const mainSock = path.join(tmpHome, 'main.sock');
const apiSock = path.join(tmpHome, 'api.sock');
const main = makeBridge(mainSock, { models: MODELS });
const api = makeBridge(apiSock, { models: MODELS });

fs.writeFileSync(path.join(registryDir, `${MAIN_ID}.json`), JSON.stringify({
  sessionId: MAIN_ID, socketPath: mainSock, sessionFile: mainFile,
  pid: process.pid, cwd: MAIN_CWD, name: 'rate limiting', model: 'claude-sonnet-5',
  thinkingLevel: 'medium',
  contextUsage: { tokens: 61400, contextWindow: 200000, percent: 30.7 },
}));
fs.writeFileSync(path.join(registryDir, `${API_ID}.json`), JSON.stringify({
  sessionId: API_ID, socketPath: apiSock, sessionFile: apiFile,
  pid: process.pid, cwd: API_CWD, name: 'schema migration', model: 'claude-opus-4-8',
  thinkingLevel: 'high',
  contextUsage: { tokens: 112300, contextWindow: 200000, percent: 56.2 },
}));

const appendMain = (e) => fs.appendFileSync(mainFile, JSON.stringify(e) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => main.server.listen(mainSock, r));
  await new Promise((r) => api.server.listen(apiSock, r));

  const server = require(path.join(REPO, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });

  try {
    // ---- desktop: main overview -------------------------------------------------
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await desktop.goto(base, { waitUntil: 'networkidle' });
    await desktop.waitForSelector('.session-item');
    await desktop.click('#tabAll');
    await desktop.waitForSelector('.workspace-group-header');
    await desktop.click(`.session-item[data-id="${MAIN_ID}"]`);
    await desktop.waitForSelector('.message.assistant');
    await desktop.waitForSelector('details.tool-group');
    await desktop.waitForSelector('.code-block');
    await desktop.waitForTimeout(800); // let highlight + mood settle
    // scroll the feed to the bottom (latest answer visible)
    await desktop.evaluate(() => { const m = document.getElementById('messages'); m.scrollTop = m.scrollHeight; });
    await desktop.waitForTimeout(300);
    await desktop.screenshot({ path: path.join(OUT, 'desktop-main.png') });
    console.log('shot: desktop-main.png');

    // ---- desktop: live streaming turn -------------------------------------------
    appendMain(user('Yes — and add a test for the burst case.', new Date().toISOString()));
    main.emit('turn_start', {});
    const streamText = "Adding the header and a burst test.\n\nThe `429` response now carries `Retry-After` with the seconds left in the window, so well-behaved clients can back off instead of hammering:";
    let shown = 0;
    const tick = setInterval(() => {
      shown = Math.min(streamText.length, shown + 9);
      main.emit('message_update', { message: { role: 'assistant', content: [{ type: 'text', text: streamText.slice(0, shown) }] } });
      if (shown >= streamText.length) clearInterval(tick);
    }, 120);
    await sleep(2500);
    main.emit('tool_execution_start', { toolCallId: 'live1', toolName: 'bash', args: { command: 'npm test -- --grep burst' } });
    await sleep(3200); // timer past 0:05
    await desktop.screenshot({ path: path.join(OUT, 'desktop-streaming.png') });
    console.log('shot: desktop-streaming.png');

    // finish the turn cleanly
    main.emit('tool_execution_end', { toolCallId: 'live1', toolName: 'bash', args: { command: 'npm test -- --grep burst' }, result: { content: [{ type: 'text', text: '✔ burst of 40 gets 429 + Retry-After (61ms)\n\n43 passing (1.9s)' }] }, isError: false });
    appendMain(toolCall('live1', 'bash', { command: 'npm test -- --grep burst' }, new Date().toISOString()));
    appendMain(toolResult('bash', '✔ burst of 40 gets 429 + Retry-After (61ms)\n\n43 passing (1.9s)', new Date().toISOString()));
    const doneMsg = { role: 'assistant', content: [{ type: 'text', text: streamText + '\n\nDone — `Retry-After` is set from the oldest hit in the window, and the burst test covers 40 rapid requests. 43 passing.' }], timestamp: new Date().toISOString() };
    appendMain({ type: 'message', message: doneMsg });
    main.emit('message_end', { message: doneMsg });
    main.emit('turn_end', {});
    await sleep(1200);

    // ---- desktop: extension widget card -------------------------------------------
    main.emit('extension_ui_request', {
      method: 'setWidget', widgetKey: 'pi-procs',
      widgetLines: [
        'dev-server   running   http://localhost:5173',
        'test:watch   running   43 passing',
        'lint         exited 0  12s ago',
      ],
    });
    main.emit('extension_ui_request', { method: 'setStatus', statusKey: 'pi-procs', statusText: '2 running' });
    await desktop.waitForSelector('.ext-ui-widget');
    await desktop.mouse.move(900, 300);
    await desktop.waitForTimeout(400);
    await desktop.evaluate(() => { const m = document.getElementById('messages'); m.scrollTop = m.scrollHeight; });
    await desktop.waitForTimeout(300);
    await desktop.screenshot({ path: path.join(OUT, 'desktop-widget.png') });
    console.log('shot: desktop-widget.png');

    // ---- mobile ------------------------------------------------------------------
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await mobile.goto(base, { waitUntil: 'networkidle' });
    await mobile.waitForSelector('.session-item, .empty-menu-btn');
    // drawer shot: open sidebar on the All tab
    const emptyBtn = await mobile.locator('.empty-menu-btn').isVisible().catch(() => false);
    if (emptyBtn) await mobile.click('.empty-menu-btn');
    else await mobile.click('.header-menu-btn');
    await mobile.waitForSelector('.sidebar.open');
    await mobile.click('#tabAll');
    await mobile.waitForSelector('.workspace-group-header');
    await mobile.waitForTimeout(300);
    await mobile.screenshot({ path: path.join(OUT, 'mobile-drawer.png') });
    console.log('shot: mobile-drawer.png');
    // session view shot
    await mobile.click(`.session-item[data-id="${MAIN_ID}"]`);
    await mobile.waitForSelector('.message.assistant');
    await mobile.waitForTimeout(800);
    await mobile.evaluate(() => { const m = document.getElementById('messages'); m.scrollTop = m.scrollHeight; });
    await mobile.waitForTimeout(300);
    await mobile.screenshot({ path: path.join(OUT, 'mobile-session.png') });
    console.log('shot: mobile-session.png');
  } finally {
    await browser.close();
    server.close();
    main.server.close();
    api.server.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
