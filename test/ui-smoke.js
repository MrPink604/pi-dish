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
const { processIdentity } = require('../lib/process-identity');

// --- temp HOME with one live fixture session ---------------------------------
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-ui-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
process.env.PI_DISH_TERMINAL = '1'; // exercise the terminal panel
process.env.PI_DISH_INDEX_SYNC_BUDGET = '1000'; // deterministic >100-session search fixtures
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
appendEntry({ type: 'message', id: 'ui-a1', timestamp: '2026-07-05T00:00:02.000Z', message: { role: 'assistant', provider: 'test', model: 'smoke-model', stopReason: 'stop', content: [{ type: 'text', text: 'existing **answer** with ~literal tildes~ and ~~intentional strike~~' }], timestamp: Date.parse('2026-07-05T00:00:00.500Z'), usage: { input: 100, output: 45, reasoning: 5, cacheRead: 20, cacheWrite: 10, cost: { total: 0.001005 } } } });
// A historical turn with tool activity — must fold into a closed .tool-group.
appendEntry({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'check the readme' }], timestamp: '2026-07-05T00:00:03.000Z' } });
appendEntry({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'hist1', name: 'Read', arguments: { path: 'README.md' } }], timestamp: '2026-07-05T00:00:04.000Z' } });
appendEntry({ type: 'message', id: 'ui-img1', message: { role: 'toolResult', toolName: 'Read', content: [{ type: 'text', text: 'Read image file [image/png]' }, { type: 'image', data: TINY_PNG, mimeType: 'image/png' }], timestamp: '2026-07-05T00:00:05.000Z' } });
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
// OMP interruption/custom-message shapes: the empty assistant shell should
// not render a ghost header, while the hidden interrupted reasoning becomes a
// marker. Async and unknown visible custom types each get a subdued row.
appendEntry({ type: 'message', message: { role: 'assistant', content: [], timestamp: '2026-07-05T00:02:01.000Z' } });
appendEntry({ type: 'custom_message', customType: 'interrupted-thinking',
  content: '<system-notice>private interrupted reasoning</system-notice>', display: false,
  timestamp: '2026-07-05T00:02:02.000Z' });
appendEntry({ type: 'message', message: { role: 'custom', customType: 'async-result',
  content: 'Background job bg_hist completed', display: true,
  details: { jobs: [{ jobId: 'bg_hist', type: 'bash', label: 'historical build', durationMs: 12000 }] },
  timestamp: Date.parse('2026-07-05T00:02:03.000Z') } });
appendEntry({ type: 'custom_message', customType: 'future-notice',
  content: 'future custom content', display: true, timestamp: '2026-07-05T00:02:04.000Z' });

// Same-pane session-switch target. The fake bridge rewrites its stable
// registry claim to this identity and emits session_switch so the browser's
// follow logic is exercised against a distinct authoritative transcript.
const SWITCH_ID = '2026-07-05T00-03-00-uiswitch';
const switchFile = path.join(sessionDir, `${SWITCH_ID}.jsonl`);
fs.writeFileSync(switchFile, [
  { type: 'session', cwd: CWD, timestamp: '2026-07-05T00:03:00.000Z' },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'switched transcript question' }], timestamp: '2026-07-05T00:03:01.000Z' } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'switched transcript answer' }], timestamp: '2026-07-05T00:03:02.000Z' } },
].map((entry) => JSON.stringify(entry)).join('\n') + '\n');

// A second workspace with one (older) historical session — the sidebar
// collapse/pin section needs two groups on the All tab.
const BETA_ID = '2026-07-04T00-00-00-uismoke2';
const CWD_B = path.join(tmpHome, 'workspace', 'proj-beta');
fs.mkdirSync(CWD_B, { recursive: true });
const sessionDirB = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-proj-beta--');
fs.mkdirSync(sessionDirB, { recursive: true });
const betaEntries = [
  { type: 'session', cwd: CWD_B, parentSession: sessionFile, timestamp: '2026-07-04T00:00:00.000Z' },
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
      content: [{ type: 'text', text: `${i === 0 ? 'archival needle cedar · ' : i === 1 ? 'maple · ' : i === 2 ? 'boundary-contract · ' : ''}beta history ${i}` }],
      timestamp: new Date(Date.parse('2026-07-04T00:01:00.000Z') + i * 1000).toISOString(),
    },
  });
}
const betaFile = path.join(sessionDirB, `${BETA_ID}.jsonl`);
fs.writeFileSync(betaFile, betaEntries.map((e) => JSON.stringify(e)).join('\n') + '\n');
const betaAt = new Date('2026-07-04T00:05:00.000Z');
fs.utimesSync(betaFile, betaAt, betaAt);

// Relevance-ranking fixture: same workspace as beta (so the tree assertions
// still see two groups), older, and matching "cedar" in its *name* — beta
// only mentions cedar once in its transcript. Recency would list beta first;
// the ranked search list must not.
const RANK_ID = '2026-07-03T00-00-00-uismoke4';
const rankFile = path.join(sessionDirB, `${RANK_ID}.jsonl`);
fs.writeFileSync(rankFile, [
  { type: 'session', cwd: CWD_B, timestamp: '2026-07-03T00:00:00.000Z' },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'cedar rollout plan' }], timestamp: '2026-07-03T00:00:01.000Z' } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'rollout notes only' }], timestamp: '2026-07-03T00:00:02.000Z' } },
].map((e) => JSON.stringify(e)).join('\n') + '\n');
const rankAt = new Date('2026-07-03T00:05:00.000Z');
fs.utimesSync(rankFile, rankAt, rankAt);

// --- skills fixture: a global skill + a session that partially reads it ------
const skillDir = path.join(tmpHome, '.pi', 'agent', 'skills', 'smoke-skill');
fs.mkdirSync(skillDir, { recursive: true });
const skillMd = path.join(skillDir, 'SKILL.md');
fs.writeFileSync(skillMd, [
  '---', 'name: smoke-skill', 'description: A skill for the ui-smoke skills view.', '---',
  '', '# Smoke skill', 'Intro line.', '',
  '## Read section', ...Array.from({ length: 8 }, (_, i) => `read line ${i} with words`),
  '', '## Cold section', ...Array.from({ length: 12 }, (_, i) => `cold appendix line ${i} nobody loads here`),
  '',
].join('\n'));
const skillEdited = new Date('2026-07-01T00:00:00.000Z');
fs.utimesSync(skillMd, skillEdited, skillEdited);
// Lives under proj-alpha (no new workspace group) and carries no usage, so it
// can't perturb the sidebar-tree or usage-view assertions — it exists only to
// give the skill one mined ranged read for the coverage map.
const SKILL_SESSION_ID = '2026-07-05T00-05-00-skillui1';
const skillSessionFile = path.join(sessionDir, `${SKILL_SESSION_ID}.jsonl`);
fs.writeFileSync(skillSessionFile, [
  { type: 'session', cwd: CWD, parentSession: sessionFile, timestamp: '2026-07-05T00:05:00.000Z' },
  { type: 'message', id: 'skrui1', timestamp: '2026-07-05T00:05:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'use the smoke skill' }] } },
  { type: 'message', id: 'skrui2', timestamp: '2026-07-05T00:05:02.000Z', message: { role: 'assistant', content: [
    { type: 'toolCall', id: 'skuitc1', name: 'read', arguments: { path: skillMd, offset: 1, limit: 10 } },
  ] } },
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
  // Dialog answer from the web UI (bridge-session command form).
  if (msg.command === 'extension_ui_response') { lastUIResponse = msg; return respond(sock, msg.id, {}); }
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
let lastUIResponse = null;
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
    emit('tool_execution_update', {
      toolCallId: 'tc1',
      partialResult: { content: [{ type: 'text', text: 'h' }] },
    });
  }, 50);
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
// --- a second pi-dish, on its own HOME (multi-host phase 2) ------------------
// HOME is process-global, so the peer has to be a child process. It runs with
// a token + an allowedOrigins entry for the main server's origin: that is the
// only way a browser on origin A may call origin B's API at all, and it
// exercises the token/CORS/ticket paths the fleet proxy doesn't need.
const REMOTE_TOKEN = 'ui-smoke-remote-token';
const REMOTE_SESSION_ID = '2026-07-06T00-00-00-uiremote1';
const remoteHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-ui-remote-'));

function writeRemoteFixture(mainOrigin) {
  const dishDir = path.join(remoteHome, '.pi', 'dish');
  fs.mkdirSync(dishDir, { recursive: true });
  fs.writeFileSync(path.join(dishDir, 'token'), REMOTE_TOKEN);
  fs.writeFileSync(path.join(dishDir, 'settings.json'),
    JSON.stringify({ allowedOrigins: [mainOrigin], label: 'tycho' }));
  const dir = path.join(remoteHome, '.pi', 'agent', 'sessions', '--remote--');
  fs.mkdirSync(dir, { recursive: true });
  // Deliberately the *same* cwd string as the main host's session: two
  // machines sharing a path is two workspaces, and the sidebar must not
  // merge them into one group.
  fs.writeFileSync(path.join(dir, `${REMOTE_SESSION_ID}.jsonl`), [
    { type: 'session', cwd: CWD, timestamp: '2026-07-06T00:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'remote question' }], timestamp: '2026-07-06T00:00:01.000Z' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'remote host answer' }], timestamp: '2026-07-06T00:00:02.000Z' } },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function startRemoteHost() {
  const { spawn } = require('child_process');
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, ['-e',
    `const s = require(${JSON.stringify(serverPath)});` +
    "const say = () => console.log('PI_DISH_PORT=' + s.address().port);" +
    's.listening ? say() : s.once(\'listening\', say);'], {
    env: {
      ...process.env,
      HOME: remoteHome,
      PORT: '0',
      PI_DISH_TERMINAL: '',
      PI_DISH_INDEX_SYNC_BUDGET: '1000',
      TMUX_TMPDIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-ui-remote-tmux-')),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('remote host did not start')), 30000);
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString();
      const match = /PI_DISH_PORT=(\d+)/.exec(buffered);
      if (!match) return;
      clearTimeout(timer);
      resolve({ child, base: `http://127.0.0.1:${match[1]}` });
    });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('remote host exited: ' + buffered)); });
  });
}

function check(cond, label) {
  if (cond) { console.log(`  ✔ ${label}`); }
  else { failures++; console.error(`  ✘ ${label}`); }
}

let registryState = {
  sessionId: SESSION_ID,
  socketPath,
  sessionFile,
  pid: process.pid,
  startTime: processIdentity(process.pid)?.startTime,
  instanceId: 'ui-smoke-main',
  cwd: CWD,
  name: 'smoke session',
  model: 'smoke-model',
  contextUsage: { tokens: 1200, contextWindow: 100000, percent: 1.2 },
};

function writeRegistry(patch = {}) {
  registryState = { ...registryState, ...patch };
  fs.writeFileSync(path.join(registryDir, `${SESSION_ID}.json`), JSON.stringify(registryState));
}

let remoteHost = null; // second pi-dish (multi-host section)

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
    const initialAnswer = desktop.locator('.message.assistant', {
      has: desktop.locator('[data-entry-id="ui-a1"]'),
    });
    check((await initialAnswer.locator('.markdown-body').textContent()).includes('~literal tildes~'),
      'single tildes remain literal text');
    check(await initialAnswer.locator('del').count() === 1 &&
      await initialAnswer.locator('del').textContent() === 'intentional strike',
      'double tildes still render intentional strikethrough');
    check(await desktop.locator('.message.custom-message.interrupted').count() === 1 &&
      await desktop.locator('.message.custom-message.interrupted').textContent().then(t => t.includes('Interrupted')),
      'interrupted-thinking renders a divider without its hidden reasoning');
    check(!(await desktop.locator('#messages').textContent()).includes('private interrupted reasoning'),
      'interrupted-thinking reasoning stays hidden');
    check(await desktop.locator('.message.custom-message.async-result').count() === 1 &&
      (await desktop.locator('.message.custom-message.async-result').textContent()).includes('Background job finished'),
      'historical async-result renders a background-job-finished row');
    check((await desktop.locator('.message.custom-message.generic').textContent()).includes('future notice'),
      'unknown visible custom_message renders a generic row');

    console.log('same-pane session switch:');
    writeRegistry({
      sessionId: SWITCH_ID,
      sessionFile: switchFile,
      name: 'switched smoke session',
    });
    emit('session_switch', {
      sessionId: SWITCH_ID,
      sessionFile: switchFile,
      previousSessionId: SESSION_ID,
      previousSessionFile: sessionFile,
      cwd: CWD,
      reason: 'new',
    });
    await desktop.waitForFunction((id) => currentSession?.id === id, SWITCH_ID, { timeout: 5000 });
    await desktop.waitForFunction(() => document.getElementById('messages')?.textContent.includes('switched transcript answer'),
      { timeout: 5000 });
    check(!(await desktop.locator('#messages').textContent()).includes('existing answer'),
      'new route renders only its own history, not the old transcript cache');
    check(await desktop.evaluate(() => parseSessionKey(localStorage.getItem('pi-dish-session')).sessionId) === SWITCH_ID,
      'client follows session_switch to the new route');

    writeRegistry({
      sessionId: SESSION_ID,
      sessionFile,
      name: 'smoke session',
    });
    emit('session_switch', {
      sessionId: SESSION_ID,
      sessionFile,
      previousSessionId: SWITCH_ID,
      previousSessionFile: switchFile,
      cwd: CWD,
      reason: 'resume',
    });
    await desktop.waitForFunction((id) => currentSession?.id === id, SESSION_ID, { timeout: 5000 });
    await desktop.waitForFunction(() => document.getElementById('messages')?.textContent.includes('existing answer'),
      { timeout: 5000 });
    check(true, 'client follows a resume switch back to the original route');

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
    check(imgSrc === `/api/sessions/${SESSION_ID}/messages/ui-img1/images/1`,
      `historical image URL uses its stable JSONL entry id (got ${imgSrc})`);
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
    await desktop.waitForFunction(() =>
      document.querySelector('.live-tool-output')?.textContent.includes('h'), { timeout: 5000 });
    check(await desktop.locator('.live-tool-summary').isVisible() &&
      await desktop.locator('.live-tool-summary').textContent() === 'echo hi',
      'Bash command remains visible once output starts flowing');
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

    // Completion-only and post-turn background frames must upsert by id. A
    // repeated start remains deduped, matching cumulative event snapshots.
    console.log('tool panel completion/update upsert:');
    emit('tool_execution_end', { toolCallId: 'completion-only', toolName: 'Bash',
      args: { command: 'echo complete' }, result: { content: [{ type: 'text', text: 'complete output' }] }, isError: false });
    await desktop.waitForSelector('details.live-tool-panel.complete[data-tool-call-id="completion-only"]', { timeout: 3000 });
    check((await desktop.locator('[data-tool-call-id="completion-only"]').textContent()).includes('complete output'),
      'completion-only end creates a finished panel');
    await desktop.evaluate(() => removeDuplicatedLiveContent(document.getElementById('messages')));
    emit('tool_execution_update', { toolCallId: 'completion-only', toolName: 'Bash',
      args: { command: 'echo complete' }, partialResult: { content: [{ type: 'text', text: 'late background update' }] } });
    await desktop.waitForSelector('details.live-tool-panel.running[data-tool-call-id="completion-only"]', { timeout: 3000 });
    check((await desktop.locator('[data-tool-call-id="completion-only"]').textContent()).includes('late background update'),
      'post-cleanup update recreates and reopens the panel');
    emit('tool_execution_end', { toolCallId: 'completion-only', toolName: 'Bash',
      args: { command: 'echo complete' }, result: { content: [{ type: 'text', text: 'late final output' }] }, isError: false });
    await desktop.waitForSelector('details.live-tool-panel.complete[data-tool-call-id="completion-only"]', { timeout: 3000 });
    check((await desktop.locator('[data-tool-call-id="completion-only"]').textContent()).includes('late final output'),
      'late background end finalizes the recreated panel');
    emit('tool_execution_start', { toolCallId: 'dedupe-start', toolName: 'Read', args: { path: 'README.md' } });
    emit('tool_execution_start', { toolCallId: 'dedupe-start', toolName: 'Read', args: { path: 'README.md' } });
    await desktop.waitForSelector('[data-tool-call-id="dedupe-start"]', { timeout: 3000 });
    check(await desktop.locator('[data-tool-call-id="dedupe-start"]').count() === 1,
      'repeated start for a known toolCallId stays deduped');
    await desktop.evaluate(() => removeDuplicatedLiveContent(document.getElementById('messages')));

    console.log('live async-result upsert:');
    const liveAsync = { role: 'custom', customType: 'async-result', content: 'background result', display: true,
      details: { jobs: [{ jobId: 'bg_live', type: 'bash', label: 'live build', durationMs: 2500 }] }, timestamp: Date.now() };
    emit('message_update', { message: liveAsync });
    emit('message_update', { message: liveAsync });
    await desktop.waitForSelector('.message.custom-message.async-result[data-streaming="true"]', { timeout: 3000 });
    check(await desktop.locator('.message.custom-message.async-result:not([data-msg-index])').count() === 1,
      'cumulative live custom updates upsert one row');
    emit('message_end', { message: liveAsync });
    await desktop.waitForFunction(() => {
      const rows = document.querySelectorAll('.message.custom-message.async-result:not([data-msg-index])');
      return rows.length === 1 && !rows[0].hasAttribute('data-streaming');
    }, { timeout: 3000 });
    check(true, 'custom message_end finalizes the live async-result row');
    emit('message_end', { message: { role: 'custom', customType: 'private-host-state',
      content: 'hidden live custom content', display: false, timestamp: Date.now() } });
    await desktop.waitForTimeout(100);
    check(!(await desktop.locator('#messages').textContent()).includes('hidden live custom content'),
      'unknown hidden live custom messages follow the documented skip');
    await desktop.evaluate(() => {
      document.querySelectorAll('.message.custom-message:not([data-msg-index])').forEach(el => el.remove());
    });

    // Per-message tok/s: the fixture's timed assistant message shows its
    // generation speed in the header.
    console.log('per-message speed + share link:');
    const speedBadge = desktop.locator('.message.assistant .message-speed', { hasText: '30 tok/s' });
    check(await speedBadge.count() === 1, 'timed assistant message shows 30 tok/s');
    await speedBadge.click();
    const detailRows = await desktop.locator('#responseDetailsBody tr').allTextContents();
    check(detailRows.some(t => t.includes('Estimated input') && t.includes('Unavailable')),
      'response details label an omitted component unavailable');
    check(detailRows.some(t => t.includes('Estimated total') && t.includes('~$0.0010')),
      'response details keep a known total beside unavailable components');
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
    const statsText = await desktop.locator('#statsBody').textContent();
    check(/30 tok\/s avg/.test(statsText),
      'stats modal shows the session average speed');
    check(statsText.includes('Estimated totalUnavailable') && statsText.includes('input Unavailable'),
      'mixed session stats do not format incomplete costs as zero');
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
    const rawHref = await desktop.locator('#fileViewRaw').getAttribute('href');
    check(rawHref.includes(`/api/sessions/${SESSION_ID}/file/content?path=`),
      `viewer exposes a raw file link (got ${JSON.stringify(rawHref)})`);
    const rawResponse = await desktop.evaluate(async () => {
      const response = await fetch(document.getElementById('fileViewRaw').href);
      return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
    });
    check(rawResponse.status === 200 && /^text\/plain/.test(rawResponse.type)
      && rawResponse.text.includes('# deep findings'),
      `raw link serves markdown source as plain text (got ${JSON.stringify(rawResponse)})`);

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

    // The saved comment must be visible straight away: an anchored mark over
    // the quoted prose plus a count chip, and it stays editable until acked.
    await desktop.waitForSelector('#fileViewBody mark.comment-mark', { timeout: 5000 });
    check(await desktop.evaluate(() => document.querySelector('#fileViewBody mark.comment-mark')
      .textContent.includes('hello from deep')), 'the saved comment re-anchors as a mark on its quote');
    await desktop.waitForFunction(() => {
      const chip = document.getElementById('fileViewComments');
      return chip.style.display !== 'none' && chip.textContent === '💬 1';
    }, { timeout: 5000 });
    check(true, 'file view header chips the open comment count');

    await desktop.click('#fileViewBody mark.comment-mark');
    await desktop.waitForSelector('#commentBubble', { state: 'visible', timeout: 2000 });
    check(await desktop.locator('#commentBubbleTitle').textContent() === 'Edit comment',
      'clicking a mark opens the bubble in edit mode');
    check(await desktop.locator('#commentBody').inputValue() === 'Make this finding more specific.',
      'the editor prefills the saved body');
    await desktop.fill('#commentBody', 'Name the exact function.');
    await desktop.click('#commentSendBtn');
    await desktop.waitForSelector('#commentBubble', { state: 'hidden', timeout: 5000 });
    const editedComments = await desktop.evaluate(async (id) => {
      const res = await fetch(`/api/comments/index?sessionId=${encodeURIComponent(id)}`);
      return (await res.json()).comments.map((c) => c.bodyPreview);
    }, SESSION_ID);
    check(editedComments.length === 1 && editedComments[0] === 'Name the exact function.',
      `editing rewrote the stored comment (got ${JSON.stringify(editedComments)})`);
    await desktop.waitForSelector('#fileViewBody mark.comment-mark', { timeout: 5000 });

    await desktop.click('#fileViewBody mark.comment-mark');
    await desktop.waitForSelector('#commentBubble', { state: 'visible', timeout: 2000 });
    await desktop.click('#commentDeleteBtn');
    check(await desktop.locator('#commentDeleteBtn').textContent() === 'Delete?',
      'the first Delete tap only arms the confirm');
    await desktop.click('#commentDeleteBtn');
    await desktop.waitForFunction(() =>
      document.querySelectorAll('#fileViewBody mark.comment-mark').length === 0
        && document.getElementById('fileViewComments').style.display === 'none',
      { timeout: 5000 });
    check(true, 'the second tap deletes the comment and clears its mark and chip');
    check((await (await fetch(`${base}/api/comments/index?sessionId=${SESSION_ID}`)).json()).total === 0,
      'the deleted comment left the agent-facing index');

    // Publish the viewed file as a page: 🌐 → link row → a standalone copy of
    // the file renderer (without app/comment UI) → unpublish clears it.
    await desktop.click('#fileViewPublish');
    await desktop.waitForSelector('#fileViewPage .stats-share-link', { timeout: 5000 });
    const pageLink = await desktop.locator('#fileViewPage .stats-share-link').textContent();
    check(/\/page\/[A-Za-z0-9_-]+$/.test(pageLink), `publish shows a token link (got ${pageLink})`);
    const pageRes = await fetch(pageLink);
    const publishedHtml = await pageRes.text();
    check(pageRes.status === 200 && publishedHtml.includes('<h1>deep findings</h1>')
      && publishedHtml.includes('standalone-file-page')
      && !publishedHtml.includes('artifact-comments.js'),
      'published page uses the standalone file renderer without comments');

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
    check(diffComments.total === 1 && diffComment?.target.anchor.newStart === 2,
      'diff selection persisted with its new-side line anchor');
    await desktop.waitForSelector('#diffViewBody .diff-line.comment-line', { timeout: 5000 });
    check(await desktop.evaluate(() =>
      [...document.querySelectorAll('#diffViewBody .diff-line.comment-line')]
        .every((el) => el.textContent === '+two')),
      'the diff comment tints exactly its anchored row');
    check(await desktop.locator('#diffViewComments').textContent() === '💬 1',
      'diff view header chips the open comment count');
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

    // 4. New-session takeover: fuzzy cwd search, lazy directory tree,
    //    model select, and a routed spawn round-trip.
    console.log('new-session takeover:');
    await desktop.waitForSelector('#sessionRelations .session-relation-chip', { timeout: 5000 });
    check(await desktop.locator('#sessionRelations .session-relation-more').count() === 1,
      'selected session puts closed child relations behind the overflow chip');
    await desktop.click('.sidebar-footer .btn');
    await desktop.waitForFunction(
      () => document.querySelector('.main').classList.contains('new-session-open'),
      null, { timeout: 5000 });
    check(true, 'takeover opens from the sidebar footer button');
    check(await desktop.locator('#nsModelSelect option').filter({ hasText: '(default)' }).count() > 0,
      'model select offers (default)');
    check(await desktop.locator('#nsThinkingSelect option').filter({ hasText: 'High' }).count() > 0,
      'reasoning level selector sits alongside the model selector');

    // Harness discovery is installation-dependent on the real host. Stub an
    // installed alternative here and prove that selecting it survives model
    // refresh and reaches the shared async launch request below.
    await desktop.route('**/api/harnesses', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ harnesses: [
          { id: 'pi', label: 'Pi', available: true },
          { id: 'omp', label: 'Oh My Pi', available: true },
          { id: 'prime', label: 'Prime Agent', available: false },
        ] }),
      });
    });
    const ompModels = [
      {
        provider: 'zai', id: 'glm-4.7-flash', selector: 'zai/glm-4.7-flash', name: 'GLM-4.7-Flash',
        contextWindow: 200000, reasoning: true,
        thinking: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      },
      {
        provider: 'zai', id: 'glm-5.2', selector: 'zai/glm-5.2', name: 'GLM-5.2',
        contextWindow: 1000000, reasoning: true, thinking: ['high', 'max'],
      },
      {
        // Older pi-dish hosts and cached catalogs may retain this obsolete
        // annotation. OMP's command catalog is authoritative regardless.
        provider: 'fixture-missing', id: 'offline-model', selector: 'fixture-missing/offline-model',
        name: 'Offline Model', contextWindow: 100000, reasoning: true,
        thinking: ['minimal', 'high'], providerReady: false,
      },
    ];
    await desktop.route(/\/api\/models\?harness=omp(?:&|$)/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ompModels) });
    });
    // Global roles are what the editor writes; the effective record carries a
    // project override (vision) that must stay out of the global record.
    let ompGlobalRoles = { default: 'zai/glm-4.7-flash', smol: 'zai/glm-5.2' };
    await desktop.route(/\/api\/harnesses\/omp\/config(?:\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          defaultModel: 'zai/glm-4.7-flash', defaultThinkingLevel: 'high',
          modelRoles: { ...ompGlobalRoles, vision: 'fixture-missing/offline-model' },
          globalModelRoles: ompGlobalRoles,
        }),
      });
    });
    let modelRolesPatch = null;
    await desktop.route('**/api/harnesses/omp/model-roles', async (route) => {
      modelRolesPatch = route.request().postDataJSON();
      for (const [role, value] of Object.entries(modelRolesPatch.roles || {})) {
        if (value === null) delete ompGlobalRoles[role]; else ompGlobalRoles[role] = value;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          globalModelRoles: ompGlobalRoles,
          modelRoles: { ...ompGlobalRoles, vision: 'fixture-missing/offline-model' },
        }),
      });
    });
    await desktop.evaluate(() => localStorage.setItem('pi-dish-new-harness', 'omp'));
    await desktop.evaluate(() => loadHarnesses());
    await desktop.waitForFunction(() => document.querySelector('#nsHarnessSelect option[value="omp"]'));
    check(await desktop.locator('#nsHarnessSelect option[value="prime"]').count() === 0,
      'unavailable harnesses are omitted from the Agent selector');
    check(await desktop.inputValue('#nsHarnessSelect') === 'omp',
      'a saved installed alternative survives asynchronous harness discovery');
    await desktop.waitForFunction(() =>
      document.querySelector('#nsModelSelect option[value="fixture-missing/offline-model"]'));
    check(await desktop.locator('#nsModelSelect option[value="fixture-missing/offline-model"]:disabled').count() === 0,
      'every OMP command-catalog model is selectable before spawn');
    await desktop.selectOption('#nsModelSelect', 'fixture-missing/offline-model');
    check(await desktop.inputValue('#nsModelSelect') === 'fixture-missing/offline-model',
      'obsolete credential metadata cannot block pre-spawn model selection');
    check((await desktop.locator('#nsHarnessConfigValues').textContent()).includes('zai/glm-4.7-flash') &&
      (await desktop.locator('#nsHarnessConfigValues').textContent()).includes('high'),
      'curated OMP default model and thinking are shown in the readout');
    check((await desktop.locator('#nsHarnessRoles').textContent()).includes('default zai/glm-4.7-flash'),
      'the readout summarizes the effective role assignments');

    // Model-role editor: a modal over the takeover, initialized from the
    // *global* record with the project override called out per row.
    await desktop.click('#nsEditRoles');
    await desktop.waitForSelector('#modelRolesModal .model-role-row');
    check(await desktop.locator('.model-role-row').count() >= 10,
      'every canonical OMP role gets a row');
    check(await desktop.inputValue('.model-role-select[data-role="smol"]') === 'zai/glm-5.2',
      'role selects initialize from the global record');
    check(await desktop.inputValue('.model-role-select[data-role="vision"]') === '',
      'a project-only assignment leaves the global select unset');
    check((await desktop.locator('.model-role-row[data-role="vision"]').textContent()).includes('project override'),
      'a differing effective value is flagged as a project override');
    check((await desktop.locator('.model-role-row[data-role="plan"] option[value="fixture-missing/offline-model"]').textContent())
      === 'fixture-missing/offline-model', 'role models use the authoritative OMP catalog without credential guesses');
    await desktop.keyboard.press('Escape');
    check(await desktop.evaluate(() => document.getElementById('modelRolesModal').style.display === 'none') &&
      await desktop.evaluate(() => document.querySelector('.main').classList.contains('new-session-open')),
      'Escape closes the roles modal only, not the takeover underneath');

    await desktop.click('#nsEditRoles');
    await desktop.waitForSelector('#modelRolesModal .model-role-row');
    await desktop.selectOption('.model-role-select[data-role="plan"]', 'zai/glm-5.2');
    await desktop.selectOption('.model-role-select[data-role="smol"]', '');
    await desktop.click('#modelRolesSave');
    await desktop.waitForFunction(() =>
      document.getElementById('modelRolesModal').style.display === 'none');
    check(JSON.stringify(modelRolesPatch?.roles) === JSON.stringify({ smol: null, plan: 'zai/glm-5.2' }),
      `saving PUTs only the changed roles (got ${JSON.stringify(modelRolesPatch?.roles)})`);
    await desktop.waitForFunction(() =>
      document.getElementById('nsHarnessRoles').textContent.includes('plan zai/glm-5.2'));
    check(!(await desktop.locator('#nsHarnessRoles').textContent()).includes('smol'),
      'the readout refreshes after a save');

    await desktop.selectOption('#nsModelSelect', 'zai/glm-5.2');
    const restrictedLevels = await desktop.locator('#nsThinkingSelect option').evaluateAll(options =>
      options.map(option => option.value));
    check(JSON.stringify(restrictedLevels) === JSON.stringify(['', 'high', 'max']),
      `restricted model offers only high/max thinking (got ${JSON.stringify(restrictedLevels)})`);
    await desktop.selectOption('#nsModelSelect', 'zai/glm-4.7-flash');
    await desktop.fill('#newSessionName', 'UI named session');
    await desktop.selectOption('#nsThinkingSelect', 'minimal');

    // Fuzzy cwd search from the text input (single source of truth).
    await desktop.fill('#newSessionCwd', '');
    await desktop.type('#newSessionCwd', 'alpha');
    await desktop.waitForSelector('.cwd-option', { timeout: 5000 });
    const opts = await desktop.locator('.cwd-option').allTextContents();
    check(opts.some(t => t.includes('workspace/proj-alpha')), 'proj-alpha found by fuzzy dir search');
    await desktop.keyboard.press('Escape'); // dismiss the cwd dropdown (not the takeover)
    await desktop.fill('#newSessionCwd', '');

    // Directory tree: expand ~ → workspace, then click-select proj-alpha.
    await desktop.locator('#nsTree .ns-tree-chevron').first().click();
    await desktop.waitForFunction(
      () => [...document.querySelectorAll('#nsTree .ns-tree-name')].some(el => el.textContent === 'workspace'),
      null, { timeout: 5000 });
    check(true, 'tree lazily lists the home subdirs');
    await desktop.locator('.ns-tree-row').filter({ hasText: 'workspace' }).first()
      .locator('.ns-tree-chevron').click();
    await desktop.waitForFunction(
      () => [...document.querySelectorAll('#nsTree .ns-tree-name')].some(el => el.textContent === 'proj-alpha'),
      null, { timeout: 5000 });
    await desktop.locator('.ns-tree-row').filter({ hasText: 'proj-alpha' }).first().click();
    check(await desktop.inputValue('#newSessionCwd') === CWD, 'selecting a tree dir sets the cwd input');
    await desktop.waitForFunction((cwd) => knownModelsCwd === cwd, CWD, { timeout: 5000 });

    // Spawn: routed async round-trip (deterministic — no real pi child).
    // The POST opts into asynchronous spawning; the takeover closes
    // immediately in favor of the provisional composer pane, and the monitor
    // reconciles the "Starting" row to the fake session once the routed
    // status flips ready.
    let spawnResult = 'starting';
    let readySpawnPolled = false;
    let asyncSpawnBody = null;
    await desktop.route('**/api/sessions/new', async (route) => {
      asyncSpawnBody = route.request().postDataJSON();
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ success: true, pending: true, spawnId: 'ui-spawn-1' }) });
    });
    await desktop.route('**/api/session-spawns/ui-spawn-1', async (route) => {
      if (spawnResult === 'ready') readySpawnPolled = true;
      const result = spawnResult === 'ready'
        ? { status: 'ready', sessionId: SESSION_ID }
        : spawnResult === 'error'
          ? { status: 'error', error: 'fixture launch failed' }
          : { status: 'starting', createdAt: Date.now() };
      await route.fulfill({ status: spawnResult === 'starting' ? 202 : 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
    // A cached catalog is enough to submit immediately. The server still
    // validates explicit model/thinking values, while its in-flight catalog
    // request also serves that validation.
    await desktop.evaluate(() => { knownModelsCwd = null; });
    await desktop.click('#nsSpawnBtn');
    await desktop.waitForSelector('.session-item.starting');
    check(asyncSpawnBody?.async === true, 'takeover spawn opts into asynchronous spawning');
    check(asyncSpawnBody?.name === 'UI named session', 'POST body carries the chosen session name');
    check(asyncSpawnBody?.cwd === CWD, `POST body carries the chosen cwd (got ${JSON.stringify(asyncSpawnBody?.cwd)})`);
    check(asyncSpawnBody?.harness === 'omp', 'POST body routes the spawn through the selected alternative harness');
    check(asyncSpawnBody?.model === 'zai/glm-4.7-flash', 'POST body carries the chosen OMP model');
    check(asyncSpawnBody?.thinking === 'minimal', 'POST body carries a thinking level valid for that model');
    check(!(await desktop.evaluate(() => document.querySelector('.main').classList.contains('new-session-open'))),
      'takeover closes in favor of the provisional pane');
    check(await desktop.locator('.session-item.starting').textContent().then(t => t.includes('Starting Oh My Pi')),
      'the provisional row identifies the selected harness before registration');
    check(await desktop.locator('.session-item.starting').evaluate((el) => el.classList.contains('active')) &&
      await desktop.locator('#sessionName').textContent() === 'Starting session…',
      'provisional session pane opens immediately');
    check(await desktop.locator('#sessionRelations .session-relation-chip').count() === 0 &&
      !(await desktop.locator('#sessionRelations').isVisible()),
      'provisional pane clears the previous session relation chips');
    check(await desktop.locator('#btnSend').isDisabled(), 'send waits for the real bridge session');
    const startupDraft = 'draft typed while Pi starts';
    await desktop.fill('#promptInput', startupDraft);
    await desktop.keyboard.press('Enter');
    check(await desktop.inputValue('#promptInput') === startupDraft &&
      (await desktop.locator('#status').textContent()).includes('still starting'),
      'typing and Enter preserve the prompt while Pi starts');
    await desktop.waitForTimeout(400); // debounced provisional draft save
    check(await desktop.evaluate((id) => localStorage.getItem('pi-dish-draft-spawn:' + id), 'ui-spawn-1') === startupDraft,
      'provisional composer owns its draft before registration');
    spawnResult = 'ready';
    await desktop.waitForFunction(() => !document.querySelector('.session-item.starting'), null, { timeout: 3000 });
    check(readySpawnPolled, 'ready spawn reconciles the provisional row to the registered session');
    await desktop.waitForFunction(({ id, draft }) => currentSession?.id === id &&
      document.getElementById('promptInput').value === draft,
    { id: SESSION_ID, draft: startupDraft }, { timeout: 3000 });
    const migratedDraft = await desktop.evaluate(({ spawnId, sessionId }) => ({
      provisional: localStorage.getItem('pi-dish-draft-spawn:' + spawnId),
      session: localStorage.getItem(draftKey(sessionId)),
    }), { spawnId: 'ui-spawn-1', sessionId: SESSION_ID });
    check(migratedDraft.provisional === null && migratedDraft.session === startupDraft &&
      !(await desktop.locator('#btnSend').isDisabled()),
      'draft transfers to the registered session and Send becomes ready');
    await desktop.fill('#promptInput', '');
    await desktop.waitForTimeout(400);

    spawnResult = 'starting';
    // Second spawn goes back through the takeover (footer button → spawn).
    await desktop.click('.sidebar-footer .btn');
    await desktop.waitForFunction(
      () => document.querySelector('.main').classList.contains('new-session-open'),
      null, { timeout: 5000 });
    await desktop.fill('#newSessionCwd', CWD);
    await desktop.waitForFunction((cwd) => knownModelsCwd === cwd, CWD, { timeout: 5000 });
    await desktop.click('#nsSpawnBtn');
    await desktop.waitForSelector('.session-item.starting');
    const failedDraft = 'keep this after a startup failure';
    await desktop.fill('#promptInput', failedDraft);
    spawnResult = 'error';
    await desktop.waitForFunction(() => document.getElementById('sessionName').textContent === 'Session failed to start',
      null, { timeout: 3000 });
    check(await desktop.inputValue('#promptInput') === failedDraft &&
      await desktop.locator('#btnSend').isDisabled(),
      'failed spawn keeps its provisional draft accessible');
    await desktop.evaluate(async (id) => {
      await selectSession(id);
      localStorage.removeItem('pi-dish-draft-spawn:ui-spawn-1');
    }, SESSION_ID);
    await desktop.unroute('**/api/sessions/new');
    await desktop.unroute('**/api/session-spawns/ui-spawn-1');
    await desktop.unroute(/\/api\/models\?harness=omp(?:&|$)/);
    await desktop.unroute(/\/api\/harnesses\/omp\/config(?:\?|$)/);
    await desktop.unroute('**/api/harnesses');

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

    // Abort acknowledgement is not the turn boundary. The UI must stay in a
    // stopping turn until agent_end, reject a new prompt rather than letting
    // the backend auto-steer it into that turn, then run live-tool cleanup and
    // authoritative JSONL catch-up from agent_end.
    console.log('abort ownership + cleanup:');
    emit('turn_start', {});
    emit('tool_execution_start', { toolCallId: 'abort-tool', toolName: 'Bash', args: { command: 'sleep 30' } });
    await desktop.waitForSelector('details.live-tool-panel[data-tool-call-id="abort-tool"]', { timeout: 3000 });
    const promptBeforeAbort = lastPrompt;
    await desktop.click('#btnStop');
    await desktop.waitForFunction(() => document.getElementById('status')?.textContent === 'Stopping...',
      { timeout: 3000 });
    await desktop.waitForTimeout(100); // HTTP acknowledgement has landed
    check(await desktop.evaluate(() => turnInProgress),
      'abort HTTP acknowledgement does not clear turn state');
    await desktop.fill('#promptInput', 'must wait for abort boundary');
    await desktop.press('#promptInput', 'Enter');
    check(await desktop.inputValue('#promptInput') === 'must wait for abort boundary',
      'send during abort remains in the composer');
    check(lastPrompt === promptBeforeAbort, 'send during abort did not reach the backend as a steer');
    appendEntry({ type: 'message', message: {
      role: 'user', content: [{ type: 'text', text: 'abort catch-up marker' }], timestamp: new Date().toISOString(),
    } });
    emit('agent_end', {}); // aborted RPC turns have no paired turn_end
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.message.user[data-msg-index]')]
        .some((el) => el.textContent.includes('abort catch-up marker')), { timeout: 5000 });
    check(!(await desktop.evaluate(() => turnInProgress)), 'agent_end clears the aborted turn');
    check(await desktop.locator('details.live-tool-panel').count() === 0,
      'agent_end catch-up removes the aborted turn live tool panel');
    await desktop.fill('#promptInput', '');

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
    emit('compaction_start', { reason: 'manual' });
    await desktop.waitForSelector('#btnStop', { state: 'visible', timeout: 3000 });
    await desktop.click('#btnStop');
    emit('compaction_end', { reason: 'manual', errorMessage: 'lost abort race' });
    await desktop.waitForFunction(() => !compactingNow, { timeout: 3000 });
    check(!(await desktop.evaluate((id) => abortingSessions.has(id), SESSION_ID)),
      'compaction_end clears a compaction-only abort gate even on failure');

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
    check(await desktop.evaluate((id) => localStorage.getItem(draftKey(id)),
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
    check(await desktop.evaluate((id) => localStorage.getItem(draftKey(id)),
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
    // 10b. Extension dialogs dock into the chat box (no page-wide overlay),
    // background to a slim bar, and survive session switches with their
    // in-progress selection intact. Session 1 is selected here.
    console.log('extension dialog dock:');
    emit('turn_start', {});
    emit('extension_ui_request', {
      method: 'ask', id: 'dlg-ask-1',
      questions: [{ id: 'release', question: 'Which release channel?', options: [{ label: 'Stable' }, { label: 'Beta' }] }],
    });
    await desktop.waitForSelector('#extUiDialogs .ext-ui-dialog-modal', { timeout: 5000 });
    check(await desktop.locator('.ext-ui-dialog-overlay').count() === 0, 'no page-wide overlay rendered');
    check(await desktop.evaluate(() =>
      document.querySelector('.input-area').classList.contains('ext-dialog-takeover') &&
      getComputedStyle(document.getElementById('promptInput')).display === 'none'),
      'expanded dialog takes over the chat box');
    await desktop.click('.ext-ui-ask-option[data-option-index="1"]');
    check(await desktop.locator('.ext-ui-ask-option.selected').count() === 1, 'option click selects in place');
    // Background it: composer comes back, bar stays.
    await desktop.click('.ext-ui-dialog-min');
    check(await desktop.evaluate(() =>
      document.querySelector('#extUiDialogs .ext-ui-dialog-modal').classList.contains('minimized') &&
      !document.querySelector('.input-area').classList.contains('ext-dialog-takeover')),
      'minimizing backgrounds the dialog and restores the composer');
    // Switch away: the stashed dialog leaves the DOM with its session.
    await desktop.click(`.session-item[data-id="${SESSION2_ID}"]`);
    await desktop.waitForFunction(() => !document.getElementById('extUiDialogs'), { timeout: 5000 });
    check(true, 'dialog stashed on session switch');
    // Switch back: replay re-docks the live element, selection preserved.
    await desktop.click(`.session-item[data-id="${registryState.sessionId}"]`);
    await desktop.waitForSelector('#extUiDialogs .ext-ui-dialog-modal', { timeout: 5000 });
    check(await desktop.evaluate(() =>
      document.querySelector('#extUiDialogs .ext-ui-dialog-modal').classList.contains('minimized')),
      'dialog re-docked still backgrounded after switch-back');
    check(await desktop.locator('.ext-ui-ask-option.selected').count() === 1,
      'selection survives the session switch');
    // Expand via the bar and submit: the answer posts to the session.
    await desktop.click('#extUiDialogs .ext-ui-dialog-modal');
    await desktop.waitForFunction(() =>
      !document.querySelector('#extUiDialogs .ext-ui-dialog-modal').classList.contains('minimized'), { timeout: 5000 });
    await desktop.click('[data-action="submit-ask"]');
    await desktop.waitForFunction(() => !document.getElementById('extUiDialogs'), { timeout: 5000 });
    check(lastUIResponse?.requestId === 'dlg-ask-1' &&
      lastUIResponse?.value?.kind === 'submit' &&
      lastUIResponse?.value?.results?.[0]?.selectedOptions?.[0] === 'Beta',
      `submit posts the picked option to the bridge (got ${JSON.stringify(lastUIResponse)})`);
    check(await desktop.evaluate(() =>
      !document.querySelector('.input-area').classList.contains('ext-dialog-takeover')),
      'composer restored after submit');
    // Resolved-elsewhere dismisses the docked card (TUI won the race).
    emit('extension_ui_request', { method: 'confirm', id: 'dlg-cf-1', title: 'Deploy now?' });
    await desktop.waitForSelector('#extUiDialogs .ext-ui-dialog-modal', { timeout: 5000 });
    emit('extension_ui_resolved', { id: 'dlg-cf-1' });
    await desktop.waitForFunction(() => !document.getElementById('extUiDialogs'), { timeout: 5000 });
    check(true, 'extension_ui_resolved dismisses the docked dialog');
    emit('turn_end', {});
    await desktop.waitForTimeout(300);

    // 10a. Selection/transcript ownership. Hold A's tail response, fully
    // select B, then release A: A must not reopen its stream or touch B's pane.
    console.log('session/transcript async ownership:');
    await desktop.evaluate(({ a }) => {
      const realFetch = window.fetch.bind(window);
      window.__auditRealFetch = realFetch;
      let held = false;
      window.fetch = (input, init) => {
        const url = String(input);
        if (!held && url.includes(`/api/sessions/${a}/messages?limit=`)) {
          held = true;
          return new Promise((resolve) => {
            window.__releaseAuditSelection = () => realFetch(input, init).then(resolve);
          });
        }
        return realFetch(input, init);
      };
      transcriptCache.delete(a);
      window.__auditSelectionA = selectSession(a, { forceTranscriptReload: true });
    }, { a: SESSION_ID });
    await desktop.waitForFunction(() => typeof window.__releaseAuditSelection === 'function');
    await desktop.evaluate((b) => selectSession(b, { forceTranscriptReload: true }), SESSION2_ID);
    await desktop.waitForFunction((b) => currentSession?.id === b &&
      [...document.querySelectorAll('#messages .message')].some((el) => el.textContent.includes('second session')),
      SESSION2_ID, { timeout: 5000 });
    await desktop.evaluate(async () => {
      window.__releaseAuditSelection();
      await window.__auditSelectionA;
    });
    const rapidSelection = await desktop.evaluate((b) => ({
      currentId: currentSession?.id,
      streamUrl: messageStream?.url || '',
      text: document.getElementById('messages').textContent,
      generation: sessionSelectionGeneration,
      expected: b,
    }), SESSION2_ID);
    check(rapidSelection.currentId === SESSION2_ID && rapidSelection.streamUrl.includes(`/${SESSION2_ID}/stream`) &&
      rapidSelection.text.includes('second session') && !rapidSelection.text.includes('existing answer'),
      'stale A selection cannot replace B stream or transcript');
    await desktop.evaluate(() => { window.fetch = window.__auditRealFetch; });

    // A same-session force reload gets a new generation too. An older catch-up
    // response carrying a unique marker must be ignored after the reload.
    await desktop.evaluate((a) => selectSession(a, { forceTranscriptReload: true }), SESSION_ID);
    await desktop.waitForSelector('#messages .message.assistant', { timeout: 5000 });
    await desktop.evaluate((a) => {
      const realFetch = window.fetch.bind(window);
      window.__auditRealFetch = realFetch;
      let held = false;
      window.fetch = (input, init) => {
        const url = String(input);
        if (!held && url.includes(`/api/sessions/${a}/messages?after=`)) {
          held = true;
          return new Promise((resolve) => {
            window.__releaseAuditCatchup = () => resolve(new Response(JSON.stringify({
              messages: [{ index: 99999, role: 'user', content: [{ type: 'text', text: 'STALE CATCH-UP MARKER' }] }],
              lastIndex: 99999, totalMessages: 100000,
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          });
        }
        return realFetch(input, init);
      };
      window.__auditOldCatchup = fetchNewMessagesSince(a, sessionSelectionGeneration);
    }, SESSION_ID);
    await desktop.waitForFunction(() => typeof window.__releaseAuditCatchup === 'function');
    await desktop.evaluate((a) => selectSession(a, { forceTranscriptReload: true }), SESSION_ID);
    await desktop.evaluate(async () => {
      window.__releaseAuditCatchup();
      await window.__auditOldCatchup;
      window.fetch = window.__auditRealFetch;
    });
    check(!(await desktop.locator('#messages').textContent()).includes('STALE CATCH-UP MARKER'),
      'same-session force reload invalidates the older catch-up generation');

    // Stats stays bound to the session/modal generation that opened it. The
    // delayed A response must not overwrite B or build A actions under B.
    await desktop.evaluate(({ a }) => {
      const realFetch = window.fetch.bind(window);
      window.__auditRealFetch = realFetch;
      let held = false;
      window.fetch = (input, init) => {
        const url = String(input);
        if (!held && url.endsWith(`/api/sessions/${a}/stats`)) {
          held = true;
          return new Promise((resolve) => {
            window.__releaseAuditStats = () => resolve(new Response(JSON.stringify({ model: 'STALE-A-STATS' }), {
              status: 200, headers: { 'Content-Type': 'application/json' },
            }));
          });
        }
        return realFetch(input, init);
      };
      openStatsModal();
    }, { a: SESSION_ID });
    await desktop.waitForFunction(() => typeof window.__releaseAuditStats === 'function');
    await desktop.evaluate((b) => selectSession(b, { forceTranscriptReload: true }), SESSION2_ID);
    await desktop.evaluate(() => openStatsModal());
    await desktop.waitForSelector('#statsBody .stats-table', { timeout: 5000 });
    await desktop.evaluate(() => window.__releaseAuditStats());
    await desktop.waitForTimeout(50);
    const statsOwner = await desktop.evaluate(() => ({
      sessionId: statsModalSessionId,
      text: document.getElementById('statsBody').textContent,
      visible: document.getElementById('statsModal').style.display !== 'none',
    }));
    check(statsOwner.visible && statsOwner.sessionId === SESSION2_ID && !statsOwner.text.includes('STALE-A-STATS'),
      'stale stats response cannot combine session A data with session B actions');
    await desktop.evaluate(() => { closeStatsModal(); window.fetch = window.__auditRealFetch; });
    await desktop.evaluate((a) => selectSession(a, { forceTranscriptReload: true }), SESSION_ID);

    // Latest request owns the file and diff takeover panes. Resolve an older
    // request only after a newer one has painted and verify it cannot overwrite.
    await desktop.evaluate(() => {
      const realFetch = window.fetch.bind(window);
      window.__auditRealFetch = realFetch;
      window.fetch = (input, init) => {
        const url = String(input);
        if (url.includes('/file?path=stale-audit.md')) {
          return new Promise((resolve) => {
            window.__releaseAuditFile = () => resolve(new Response(JSON.stringify({
              path: '/stale/stale-audit.md', relPath: 'stale-audit.md', size: 5, content: 'STALE FILE',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          });
        }
        return realFetch(input, init);
      };
      window.__auditOldFile = openFileViewer('stale-audit.md');
    });
    await desktop.waitForFunction(() => typeof window.__releaseAuditFile === 'function');
    await desktop.evaluate(() => openFileViewer('findings.md'));
    await desktop.waitForSelector('#fileView .markdown-body h1', { timeout: 5000 });
    await desktop.evaluate(async () => { window.__releaseAuditFile(); await window.__auditOldFile; });
    check(await desktop.locator('#fileViewTitle').textContent() === 'findings.md' &&
      !(await desktop.locator('#fileViewBody').textContent()).includes('STALE FILE'),
      'stale file response cannot overwrite the latest open file');
    await desktop.evaluate(() => { closeFileView(); window.fetch = window.__auditRealFetch; });

    await desktop.evaluate(({ a }) => {
      const realFetch = window.fetch.bind(window);
      window.__auditRealFetch = realFetch;
      let held = false;
      window.fetch = (input, init) => {
        const url = String(input);
        if (!held && url.endsWith(`/api/sessions/${a}/diff`)) {
          held = true;
          return new Promise((resolve) => {
            window.__releaseAuditDiff = () => resolve(new Response(JSON.stringify({
              root: '/STALE-DIFF-ROOT', gitAvailable: true, repos: [],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          });
        }
        return realFetch(input, init);
      };
      window.__auditOldDiff = openDiffView();
    }, { a: SESSION_ID });
    await desktop.waitForFunction(() => typeof window.__releaseAuditDiff === 'function');
    await desktop.evaluate(() => loadDiffView());
    await desktop.waitForSelector('.diff-repo', { timeout: 5000 });
    await desktop.evaluate(async () => { window.__releaseAuditDiff(); await window.__auditOldDiff; });
    check(!(await desktop.locator('#diffViewRoot').textContent()).includes('STALE-DIFF-ROOT') &&
      await desktop.locator('.diff-repo').count() > 0,
      'stale diff response cannot overwrite the latest diff view');
    await desktop.evaluate(() => { closeDiffView(); window.fetch = window.__auditRealFetch; });

    // Deferred patches carry the same view generation. Let an old patch land
    // after closing/reopening the diff and loading the replacement patch.
    await desktop.evaluate(() => openDiffView());
    await desktop.waitForFunction(() => document.querySelectorAll('.diff-file').length === 7,
      { timeout: 5000 });
    await desktop.evaluate(() => {
      const realFetch = window.fetch.bind(window);
      window.__auditRealFetch = realFetch;
      let held = false;
      window.fetch = (input, init) => {
        const url = String(input);
        if (!held && url.includes('/diff/patch?') && url.includes('lazy-4.txt')) {
          held = true;
          return new Promise((resolve) => {
            window.__releaseAuditPatch = () => resolve(new Response(JSON.stringify({
              patch: '@@ -0,0 +1 @@\n+STALE PATCH', truncated: false,
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          });
        }
        return realFetch(input, init);
      };
    });
    await desktop.locator('.diff-file').filter({ hasText: 'lazy-4.txt' }).locator('summary').click();
    await desktop.waitForFunction(() => typeof window.__releaseAuditPatch === 'function');
    await desktop.evaluate(() => { closeDiffView(); openDiffView(); });
    await desktop.waitForFunction(() => document.querySelectorAll('.diff-file').length === 7,
      { timeout: 5000 });
    await desktop.locator('.diff-file').filter({ hasText: 'lazy-4.txt' }).locator('summary').click();
    await desktop.waitForFunction(() =>
      [...document.querySelectorAll('.diff-line.diff-add')].some((el) => el.textContent === '+lazy line 4'),
      { timeout: 5000 });
    await desktop.evaluate(() => window.__releaseAuditPatch());
    await desktop.waitForTimeout(50);
    check(!(await desktop.locator('#diffViewBody').textContent()).includes('STALE PATCH'),
      'stale deferred patch cannot mutate a reopened diff view');
    await desktop.evaluate(() => { closeDiffView(); window.fetch = window.__auditRealFetch; });

    // Failed sends restore the payload to A even when B owns the composer by
    // the time the request fails, and remove the exact optimistic bubble.
    console.log('send/queue async ownership:');
    await desktop.fill('#promptInput', 'failed prompt from A');
    await desktop.evaluate(({ a, image }) => {
      pendingImages = [{ data: image, mimeType: 'image/png' }];
      renderAttachmentStrip();
      const realApiSend = apiSend;
      window.__auditRealApiSend = realApiSend;
      apiSend = (host, url, ...args) => {
        if (url === `/api/sessions/${a}/prompt`) {
          return new Promise((resolve, reject) => {
            window.__rejectAuditPrompt = () => reject(new Error('audit send failure'));
          });
        }
        return realApiSend(host, url, ...args);
      };
      window.__auditFailedPrompt = sendPrompt();
    }, { a: SESSION_ID, image: TINY_PNG });
    await desktop.waitForFunction(() => typeof window.__rejectAuditPrompt === 'function' &&
      document.querySelector('[data-client-prompt-id]'));
    await desktop.evaluate((b) => selectSession(b, { forceTranscriptReload: true }), SESSION2_ID);
    await desktop.evaluate(async () => {
      window.__rejectAuditPrompt();
      await window.__auditFailedPrompt;
      apiSend = window.__auditRealApiSend;
    });
    const failedOwnership = await desktop.evaluate((a) => ({
      currentText: document.getElementById('promptInput').value,
      originDraft: localStorage.getItem(draftKey(a)),
      originImages: pendingImagesBySession.get(a)?.length || 0,
      pendingMatch: [...pendingOptimisticPrompts.values()].some((p) => p.message === 'failed prompt from A'),
    }), SESSION_ID);
    check(!failedOwnership.currentText.includes('failed prompt from A') &&
      failedOwnership.originDraft === 'failed prompt from A' && failedOwnership.originImages === 1 &&
      !failedOwnership.pendingMatch,
      'failed prompt restores text/images only to A and removes its optimistic association');
    await desktop.evaluate((a) => selectSession(a, { forceTranscriptReload: true }), SESSION_ID);
    check(await desktop.inputValue('#promptInput') === 'failed prompt from A' &&
      await desktop.locator('#attachmentStrip .attachment-thumb').count() === 1,
      'originating session restores the failed payload when revisited');
    await desktop.evaluate((a) => {
      document.getElementById('promptInput').value = '';
      pendingImages = [];
      pendingImagesBySession.delete(a);
      clearDraft(a);
      renderAttachmentStrip();
    }, SESSION_ID);

    // A compaction-buffered optimistic prompt is associated to its queue row
    // by a client id. Cancelling one of two identical prompts removes only its
    // bubble/echo suppression, and an A->B switch cannot receive its text.
    await desktop.evaluate((a) => {
      const container = document.getElementById('messages');
      const makePending = (id) => {
        const el = document.createElement('div');
        el.className = 'message user';
        el.dataset.clientPromptId = id;
        el.textContent = 'duplicate buffered prompt';
        container.appendChild(el);
        pendingOptimisticPrompts.set(id, {
          clientPromptId: id, sessionId: a, message: 'duplicate buffered prompt', element: el, status: 'queued',
        });
        return el;
      };
      window.__auditQueuedFirst = makePending('audit-buffered-first');
      window.__auditQueuedSecond = makePending('audit-buffered-second');
      renderQueueStatus({ followUp: ['duplicate buffered prompt'] });
      const realApiSend = apiSend;
      window.__auditRealApiSend = realApiSend;
      apiSend = (host, url, ...args) => {
        if (url.endsWith('/queue/cancel')) {
          return new Promise((resolve) => { window.__resolveAuditQueueEdit = () => resolve({ success: true }); });
        }
        return realApiSend(host, url, ...args);
      };
      const row = document.querySelector('.queue-item');
      window.__auditQueueAssociation = row.dataset.clientPromptId;
      window.__auditQueueEdit = editQueuedMessage(row.querySelector('.queue-item-edit'));
      // Real bridge queue_update may beat the HTTP response. The remaining
      // duplicate must associate to the second prompt, not reuse the one being edited.
      renderQueueStatus({ followUp: ['duplicate buffered prompt'] });
      window.__auditRemainingQueueAssociation = document.querySelector('.queue-item')?.dataset.clientPromptId;
    }, SESSION_ID);
    check(await desktop.evaluate(() => window.__auditQueueAssociation) === 'audit-buffered-first',
      'buffered queue row carries its stable optimistic prompt id');
    check(await desktop.evaluate(() => window.__auditRemainingQueueAssociation) === 'audit-buffered-second',
      'queue update before cancel acknowledgement preserves duplicate prompt association');
    await desktop.evaluate((b) => selectSession(b, { forceTranscriptReload: true }), SESSION2_ID);
    await desktop.evaluate(async () => {
      window.__resolveAuditQueueEdit();
      await window.__auditQueueEdit;
      apiSend = window.__auditRealApiSend;
    });
    const queueOwnership = await desktop.evaluate((a) => ({
      currentText: document.getElementById('promptInput').value,
      originDraft: localStorage.getItem(draftKey(a)),
      firstPending: pendingOptimisticPrompts.has('audit-buffered-first'),
      secondPending: pendingOptimisticPrompts.has('audit-buffered-second'),
      firstRemoved: window.__auditQueuedFirst.parentNode === null,
      secondRetained: window.__auditQueuedSecond.parentNode !== null,
    }), SESSION_ID);
    check(!queueOwnership.currentText.includes('duplicate buffered prompt') &&
      queueOwnership.originDraft === 'duplicate buffered prompt',
      'queue edit completion restores A without touching B composer/draft');
    check(!queueOwnership.firstPending && queueOwnership.secondPending &&
      queueOwnership.firstRemoved && queueOwnership.secondRetained,
      'queue edit removes only the associated bubble and echo suppression');
    await desktop.evaluate((a) => {
      discardOptimisticPrompt('audit-buffered-second');
      localStorage.removeItem(draftKey(a));
    }, SESSION_ID);

    // Enabled-model persistence uses the IDs at edit time, not whichever
    // model list a session switch/reload installs before the debounce fires.
    await desktop.evaluate(async () => {
      const realApiSend = apiSend;
      window.__auditRealApiSend = realApiSend;
      apiSend = async (host, url, body, ...args) => {
        if (url === '/api/models/enabled') { window.__auditEnabledBody = body; return { success: true }; }
        return realApiSend(host, url, body, ...args);
      };
      knownModels = [
        { provider: 'audit', id: 'kept', enabled: true },
        { provider: 'audit', id: 'removed', enabled: false },
      ];
      saveEnabledModels();
      knownModels = [{ provider: 'other-session', id: 'replacement', enabled: true }];
      await new Promise((resolve) => setTimeout(resolve, 500));
      apiSend = window.__auditRealApiSend;
    });
    check(JSON.stringify(await desktop.evaluate(() => window.__auditEnabledBody?.enabledIds)) ===
      JSON.stringify(['audit/kept']),
      'enabled-model debounce persists the edit-time ID snapshot');
    await desktop.evaluate((a) => { loadModels(a); return selectSession(a, { forceTranscriptReload: true }); }, SESSION_ID);

    // Terminal startup waits for fonts before constructing xterm or its
    // WebSocket. Hold that wait for A, select B, and start B's open before
    // releasing both continuations: only B's exact selected view may create
    // terminal state or connect.
    console.log('terminal async ownership:');
    await desktop.evaluate(() => {
      window.__auditFontLoadDescriptor = Object.getOwnPropertyDescriptor(document.fonts, 'load');
      window.__auditNativeWebSocket = window.WebSocket;
      window.__auditTerminalUrls = [];
      let releaseFonts;
      const heldFonts = new Promise((resolve) => { releaseFonts = resolve; });
      Object.defineProperty(document.fonts, 'load', {
        configurable: true,
        value: () => heldFonts,
      });
      window.WebSocket = new Proxy(window.WebSocket, {
        construct(Target, args) {
          window.__auditTerminalUrls.push(String(args[0]));
          return Reflect.construct(Target, args);
        },
      });
      window.__releaseAuditFonts = releaseFonts;
      window.__auditTerminalA = openTerminal();
    });
    await desktop.waitForTimeout(50);
    check(await desktop.evaluate(() => !termState && window.__auditTerminalUrls.length === 0 &&
      document.getElementById('terminalPanel').style.display === 'none'),
      'terminal does not open or connect while A font readiness is held');
    await desktop.evaluate((b) => selectSession(b, { forceTranscriptReload: true }), SESSION2_ID);
    await desktop.evaluate(() => {
      window.__auditTerminalB = openTerminal();
      window.__releaseAuditFonts();
    });
    await desktop.evaluate(() => Promise.all([window.__auditTerminalA, window.__auditTerminalB]));
    await desktop.waitForFunction(() => document.getElementById('terminalStatus').textContent === '',
      { timeout: 5000 });
    const terminalOwnership = await desktop.evaluate(({ a, b }) => ({
      owner: termState?.sessionId,
      urls: window.__auditTerminalUrls.slice(),
      currentId: currentSession?.id,
      hasAUrl: window.__auditTerminalUrls.some((url) => url.includes(encodeURIComponent(a))),
      hasBUrl: window.__auditTerminalUrls.some((url) => url.includes(encodeURIComponent(b))),
    }), { a: SESSION_ID, b: SESSION2_ID });
    check(terminalOwnership.currentId === SESSION2_ID && terminalOwnership.owner === SESSION2_ID &&
      terminalOwnership.urls.length === 1 && !terminalOwnership.hasAUrl && terminalOwnership.hasBUrl,
      `stale A terminal open cannot connect for or interfere with B (got ${JSON.stringify(terminalOwnership)})`);
    await desktop.evaluate(() => {
      closeTerminal();
      window.WebSocket = window.__auditNativeWebSocket;
      if (window.__auditFontLoadDescriptor) {
        Object.defineProperty(document.fonts, 'load', window.__auditFontLoadDescriptor);
      } else {
        delete document.fonts.load;
      }
    });
    await desktop.evaluate((a) => selectSession(a, { forceTranscriptReload: true }), SESSION_ID);

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
    console.log('session card layout & sidebar chrome:');
    await desktop.click('#tabAll');
    await desktop.waitForSelector(`.session-item[data-id="${registryState.sessionId}"] .session-item-tags`, { timeout: 5000 });
    {
      const rowSel = `.session-item[data-id="${registryState.sessionId}"]`;
      // Three rows, in order: title+activity, model+context, host/harness.
      const rows = await desktop.locator(rowSel).evaluate((el) =>
        [...el.children].map((c) => c.className));
      check(rows[0] === 'session-item-header' && rows[1] === 'session-item-meta' &&
        rows[2].startsWith('session-item-tags'), `card is three rows in order (got ${JSON.stringify(rows)})`);
      // The model reads as the bare slug; the full ref stays in the title.
      const model = desktop.locator(`${rowSel} .session-item-model`);
      check(await model.textContent() === 'smoke-model' &&
        !(await model.textContent()).includes('/'), 'row 2 shows the model without its provider');
      check(await desktop.locator(`${rowSel} .session-item-meta`).textContent()
        .then((t) => !/msgs/.test(t)), 'the message count is gone from the card');
      check(await desktop.locator(`${rowSel} .session-item-tags .harness-badge`).count() === 1,
        'row 3 carries the harness badge');
      check(await desktop.locator(`${rowSel} .session-item-header .harness-badge`).count() === 0,
        'the title row is left to the title');
      // Context readout is a device preference: percent by default, absolute
      // tokens on request, and the percent-derived warning color survives.
      const pct = await desktop.locator(`${rowSel} .session-item-context`).textContent();
      check(/%$/.test(pct), `row 2 defaults to percent of context (got ${pct})`);
      await desktop.evaluate(() => {
        localStorage.setItem('pi-dish-sidebar-context-metric', 'tokens');
        sidebarContextMetric = 'tokens';
        renderSessions();
      });
      const tok = await desktop.locator(`${rowSel} .session-item-context`).textContent();
      check(/tok$/.test(tok), `the token metric replaces the percent (got ${tok})`);
      await desktop.evaluate(() => {
        localStorage.setItem('pi-dish-sidebar-context-metric', 'percent');
        sidebarContextMetric = 'percent';
        renderSessions();
      });
    }
    // The header icon row lost the theme picker and the all-sessions search;
    // the search sits with the filter box it extends.
    check(await desktop.locator('.sidebar-header select').count() === 0,
      'the theme picker has left the sidebar header');
    check(await desktop.locator('.sidebar-filter .filter-search-btn').count() === 1,
      'the all-sessions search lives in the filter row');
    // The session header no longer spends an icon on /tree.
    check(await desktop.locator('#btnTree').count() === 0, 'the tree button is gone from the session header');
    {
      // Drag-to-resize: wider than the default, clamped, and persisted in px.
      const before = await desktop.locator('#sidebar').evaluate((el) => el.offsetWidth);
      const box = await desktop.locator('#sidebarResizeHandle').boundingBox();
      await desktop.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await desktop.mouse.down();
      await desktop.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
      await desktop.mouse.up();
      const after = await desktop.locator('#sidebar').evaluate((el) => el.offsetWidth);
      const stored = await desktop.evaluate(() => localStorage.getItem('pi-dish-sidebar-width'));
      check(after === before + 120 && String(after) === stored,
        `dragging the edge widens the sidebar and persists it (got ${before}→${after}, stored ${stored})`);
      // Double-click resets to the stylesheet default.
      await desktop.dblclick('#sidebarResizeHandle');
      check(await desktop.locator('#sidebar').evaluate((el) => el.offsetWidth) === before &&
        await desktop.evaluate(() => localStorage.getItem('pi-dish-sidebar-width')) === null,
        'double-clicking the handle restores the default width');
    }

    console.log('sidebar tree collapse & pin:');
    await desktop.waitForSelector(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`, { timeout: 5000 });
    check(await desktop.locator(`.session-item[data-id="${SKILL_SESSION_ID}"]`).count() === 0,
      'same-workspace child session is grouped under its parent and collapsed by default');
    const familyRootId = await desktop.locator(`.session-item[data-id="${registryState.sessionId}"]`)
      .evaluate(el => el.closest('.session-family-root')?.dataset.familyId);
    check(familyRootId === registryState.sessionId, 'parent anchors the session family block');
    await desktop.click(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
    await desktop.waitForSelector(`.session-item[data-id="${SKILL_SESSION_ID}"]`, { timeout: 2000 });
    const familyIds = await desktop.locator(`.session-family-root[data-family-id="${registryState.sessionId}"] .session-item`)
      .evaluateAll(rows => rows.map(row => row.dataset.id));
    check(JSON.stringify(familyIds) === JSON.stringify([registryState.sessionId, SKILL_SESSION_ID]),
      'expanded family keeps the parent first with its child directly beneath');
    check(await desktop.evaluate((id) =>
      JSON.parse(localStorage.getItem('pi-dish-expanded-session-families') || '[]')
        .some((key) => parseSessionKey(key).sessionId === id), registryState.sessionId),
      'family expansion persists device-locally');
    await desktop.click(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
    await desktop.waitForFunction((id) => !document.querySelector(`.session-item[data-id="${id}"]`), SKILL_SESSION_ID);
    await desktop.evaluate((id) => patchSession(id, { turnInProgress: true }), SKILL_SESSION_ID);
    check(await desktop.locator(`.session-item[data-id="${registryState.sessionId}"] .session-item-status.working`).count() === 1,
      'collapsed parent surfaces a working child status');
    await desktop.evaluate((id) => patchSession(id, { turnInProgress: false }), SKILL_SESSION_ID);
    await desktop.evaluate((id) => selectSession(id), SKILL_SESSION_ID);
    await desktop.waitForFunction((id) => currentSession?.id === id &&
      document.querySelector(`.session-item[data-id="${id}"]`)?.classList.contains('active'), SKILL_SESSION_ID);
    check(await desktop.locator(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`)
      .getAttribute('aria-expanded') === 'true',
      'selecting a collapsed child reveals its ancestor and active row');
    await desktop.evaluate((id) => selectSession(id), registryState.sessionId);
    await desktop.waitForFunction((id) => currentSession?.id === id, registryState.sessionId);
    await desktop.click(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
    await desktop.waitForFunction((id) => !document.querySelector(`.session-item[data-id="${id}"]`), SKILL_SESSION_ID);

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
    check(await desktop.locator(`.pinned-segment .session-item[data-id="${SKILL_SESSION_ID}"]`).count() === 0,
      'pinned family remains collapsed by default');
    await pinToggle(BETA_ID);
    await desktop.waitForFunction(() =>
      document.querySelectorAll('.pinned-segment > .session-family-root').length === 2, null, { timeout: 2000 });
    check(await desktop.locator('.pinned-segment .session-drag-handle').count() === 2,
      'pinned families carry one drag handle each');
    check(await desktop.locator('.pinned-segment .session-item-cwd').count() === 2,
      'pinned rows show their workspace');
    // Expand the pinned parent, then drag beta above it: the child must move
    // with the parent wrapper rather than becoming an independently sorted row.
    await desktop.click(`.pinned-segment .session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
    await desktop.waitForSelector(`.pinned-segment .session-item[data-id="${SKILL_SESSION_ID}"]`);
    const handleBox = await desktop.locator(`.pinned-segment .session-item[data-id="${BETA_ID}"] .session-drag-handle`).boundingBox();
    const firstBox = await desktop.locator(`.pinned-segment .session-item[data-id="${registryState.sessionId}"]`).boundingBox();
    await desktop.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await desktop.mouse.down();
    await desktop.mouse.move(firstBox.x + 20, firstBox.y + 2, { steps: 5 });
    await desktop.mouse.up();
    await desktop.waitForFunction((want) =>
      JSON.stringify([...document.querySelectorAll('.pinned-segment > .session-family-root')].map((el) => el.dataset.familyId)) === want,
      JSON.stringify([BETA_ID, registryState.sessionId]), { timeout: 2000 });
    const draggedFamilyIds = await desktop.locator(`.pinned-segment .session-family-root[data-family-id="${registryState.sessionId}"] .session-item`)
      .evaluateAll(rows => rows.map(row => row.dataset.id));
    check(JSON.stringify(draggedFamilyIds) === JSON.stringify([registryState.sessionId, SKILL_SESSION_ID]),
      'drag handle moves the expanded family as one block');
    check(JSON.stringify(await desktop.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') || '[]')
      .map((key) => parseSessionKey(key).sessionId))) ===
      JSON.stringify([BETA_ID, registryState.sessionId]), 'manual family order persisted to localStorage');
    // Collapse, then unpin both; the section disappears and families rejoin.
    await desktop.click(`.pinned-segment .session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
    await pinToggle(BETA_ID);
    await pinToggle(registryState.sessionId);
    await desktop.waitForFunction(() => !document.querySelector('.pinned-segment'), null, { timeout: 2000 });
    check(true, 'unpinning removes the pinned section');

    // A filtered result can contain only the child. Pinning that fragment must
    // still persist and later render the canonical parent family.
    await desktop.fill('#filterInput', 'use smoke skill');
    await desktop.waitForSelector(`.ranked-segment .session-item[data-id="${SKILL_SESSION_ID}"]`, { timeout: 5000 });
    await pinToggle(SKILL_SESSION_ID);
    check(JSON.stringify(await desktop.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') || '[]')
      .map((key) => parseSessionKey(key).sessionId))) ===
      JSON.stringify([SESSION_ID]), 'pinning a filtered child stores the stable parent family id');
    await desktop.fill('#filterInput', '');
    await desktop.waitForFunction((id) => document.querySelector('.pinned-segment .session-item')?.dataset.id === id,
      SESSION_ID, { timeout: 5000 });
    check(await desktop.locator(`.pinned-segment .session-item[data-id="${SKILL_SESSION_ID}"]`).count() === 0,
      'filtered child pin restores the whole family in its collapsed state');
    await pinToggle(SESSION_ID);
    await desktop.waitForFunction(() => !document.querySelector('.pinned-segment'), null, { timeout: 2000 });

    // Cross-workspace lineage is navigation-only: pinning its filtered child
    // must not toggle or absorb the independently pinned parent.
    await pinToggle(SESSION_ID);
    await desktop.fill('#filterInput', 'beta answer');
    await desktop.waitForSelector(`.ranked-segment .session-item[data-id="${BETA_ID}"]`, { timeout: 5000 });
    await pinToggle(BETA_ID);
    check(JSON.stringify(await desktop.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') || '[]')
      .map((key) => parseSessionKey(key).sessionId))) ===
      JSON.stringify([SESSION_ID, BETA_ID]), 'cross-workspace filtered child pins independently');
    await desktop.fill('#filterInput', '');
    await desktop.waitForFunction(() => document.querySelectorAll('.pinned-segment > .session-family-root').length === 2,
      null, { timeout: 5000 });
    await pinToggle(BETA_ID);
    await pinToggle(SESSION_ID);
    await desktop.waitForFunction(() => !document.querySelector('.pinned-segment'), null, { timeout: 2000 });

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
    // A typed query swaps the workspace tree for one flat relevance-ranked
    // list: the older session naming "cedar" leads the newer one that only
    // mentions it in its transcript.
    await desktop.fill('#filterInput', 'cedar');
    await desktop.waitForFunction((ids) =>
      JSON.stringify([...document.querySelectorAll('#sessionList .session-item')].map((el) => el.dataset.id)) === ids,
      JSON.stringify([RANK_ID, BETA_ID]), { timeout: 5000 });
    check(true, 'search results rank the name match above the newer content match');
    check(await desktop.locator('#sessionList .workspace-group-header').count() === 0,
      'ranked search list drops the grouping headers');
    check(await desktop.locator('#sessionList .session-item .session-item-cwd').count() === 2,
      'ranked rows keep their workspace hint');

    await desktop.fill('#filterInput', '');
    await desktop.waitForFunction(() =>
      document.querySelectorAll('#sessionList .session-item').length >= 3, null, { timeout: 5000 });
    check(await desktop.locator('.session-item-snippet').count() === 0,
      'clearing the query drops snippets and restores the list');
    check(await desktop.locator('#sessionList .workspace-group-header').count() > 0,
      'clearing the query restores the grouped view');

    // 12a. Active-tab content search: queries go through the server on both
    // tabs — a session matched by transcript content must not vanish when
    // the tab switches (the old Active filter was local metadata-only and
    // cleared the results).
    await desktop.click('#tabActive');
    await desktop.fill('#filterInput', 'existing');
    await desktop.waitForSelector(`.session-item[data-id="${registryState.sessionId}"] .session-item-snippet`, { timeout: 5000 });
    check(true, 'Active-tab query content-matches the live session with a snippet');
    await desktop.click('#tabAll');
    await desktop.waitForSelector(`.session-item[data-id="${registryState.sessionId}"] .session-item-snippet`, { timeout: 5000 });
    await desktop.click('#tabActive');
    await desktop.waitForSelector(`.session-item[data-id="${registryState.sessionId}"] .session-item-snippet`, { timeout: 5000 });
    check(await desktop.evaluate(() => document.getElementById('filterInput').value) === 'existing',
      'query survives tab switches and keeps matching on both tabs');
    await desktop.fill('#filterInput', '');
    await desktop.click('#tabAll');
    await desktop.waitForFunction(() =>
      document.querySelectorAll('#sessionList .session-item').length >= 3, null, { timeout: 5000 });

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
    // The absorbed query must not leave a debounced search pending: firing
    // after the clear, it would narrow the lists to an untyped query and only
    // the next 10s poll would undo it.
    await desktop.waitForFunction(() => listsQueriedFor === '', null, { timeout: 5000 });
    check(true, 'the absorbed query leaves no server-filtered lists behind');
    // Both proj-beta sessions (the beta transcript and the ranking fixture
    // sharing its cwd) are hidden by the scope, and the note says so.
    await desktop.waitForFunction((betaId) =>
      !document.querySelector(`.session-item[data-id="${betaId}"]`) &&
      document.querySelector('.scope-hidden-note')?.textContent === '2 hidden by scopes',
      BETA_ID, { timeout: 5000 });
    check(true, 'active scope keeps filtering with an audit note for the hidden rows');
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

    console.log('related-session navigation:');
    await desktop.evaluate((id) => selectSession(id), BETA_ID);
    await desktop.waitForSelector('#sessionRelations .session-relation-chip', { timeout: 5000 });
    check((await desktop.locator('#sessionRelations').textContent()).includes('Parent'),
      'native Pi parentSession renders a neutral relation chip');
    await desktop.click('#sessionRelations .session-relation-chip');
    await desktop.waitForFunction((id) => currentSession?.id === id, registryState.sessionId, { timeout: 5000 });
    check(true, 'related-session chip navigates to the available peer session');
    const relationRaceOwner = await desktop.evaluate(async (nextId) => {
      const originalLoad = loadSessions;
      let release;
      loadSessions = () => new Promise(resolve => { release = resolve; });
      try {
        const sourceId = currentSession.id;
        const generation = sessionSelectionGeneration;
        const pending = openRelatedSession('not-yet-loaded-peer', sourceId, generation);
        await selectSession(nextId);
        release();
        await pending;
        return currentSession.id;
      } finally {
        loadSessions = originalLoad;
      }
    }, BETA_ID);
    check(relationRaceOwner === BETA_ID, 'stale related-session reload cannot hijack a newer selection');
    await desktop.evaluate((id) => selectSession(id), registryState.sessionId);
    await desktop.waitForFunction((id) => currentSession?.id === id, registryState.sessionId);

    // Relation chip overflow: only live child fan-outs appear in the header.
    // Closed children and live children beyond one physical row go behind
    // the "+N more" chip, while the modal still lists every relation.
    let relationFixtureMode = 'closed';
    await desktop.route('**/api/sessions/*/related', async (route) => {
      const relations = [{
        kind: 'parent', source: 'pi-session-header',
        session: { id: registryState.sessionId, name: 'overflow-parent', isActive: true, lastActivity: Date.now() },
      }];
      if (relationFixtureMode === 'closed') {
        for (let i = 0; i < 3; i++) {
          relations.push({
            kind: 'child', source: 'pi-session-header',
            session: { id: `live-child-${i}`, name: `live-child-${i}`, isActive: true, lastActivity: Date.now() },
          });
        }
        for (let i = 0; i < 6; i++) {
          relations.push({
            kind: 'child', source: 'pi-session-header',
            session: { id: `closed-child-${i}`, name: `closed-child-${i}`, isActive: false, lastActivity: Date.now() - 60000 },
          });
        }
      } else {
        for (let i = 0; i < 25; i++) {
          relations.push({
            kind: 'child', source: 'pi-session-header',
            session: { id: `active-child-${i}`, name: `active-child-${i}`, isActive: true, lastActivity: Date.now() },
          });
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ relations }) });
    });
    await desktop.evaluate((id) => selectSession(id), BETA_ID);
    await desktop.waitForSelector('.session-relation-more', { timeout: 5000 });
    const closedHeader = await desktop.locator('#sessionRelations').textContent();
    const closedOverflowCount = Number((await desktop.locator('.session-relation-more').textContent()).match(/\+(\d+)/)?.[1] || 0);
    const visibleClosedChildren = await desktop.locator('#sessionRelations .session-relation-chip:not(.session-relation-more)').evaluateAll(
      chips => chips.filter(chip => chip.textContent.includes('Child')).length);
    check(closedHeader.includes('live-child-0') && !closedHeader.includes('closed-child-'),
      'header shows live children but hides closed child bubbles');
    check(visibleClosedChildren > 0,
      'live children occupy the available single row');
    check(closedOverflowCount >= 6,
      'closed children count toward the overflow bubble');
    await desktop.click('.session-relation-more');
    await desktop.waitForSelector('#relationsModal .relation-row', { timeout: 5000 });
    check(await desktop.locator('#relationsModal .relation-row').count() === 10,
      'overflow modal lists every relation, including closed children');
    check((await desktop.locator('#relationsModal').textContent()).includes('Children (9)'),
      'overflow modal groups the children with a count');
    check(await desktop.locator('#relationsModal .relation-row .live-dot').count() === 4,
      'overflow modal marks each live relation');
    await desktop.keyboard.press('Escape');
    await desktop.waitForFunction(
      () => document.getElementById('relationsModal').style.display === 'none',
      null, { timeout: 3000 });
    check(true, 'Escape closes the relations modal');

    relationFixtureMode = 'active';
    await desktop.evaluate((id) => selectSession(id), BETA_ID);
    await desktop.waitForSelector('.session-relation-more', { timeout: 5000 });
    const activeHeader = await desktop.locator('#sessionRelations').textContent();
    const visibleActiveChildren = await desktop.locator('#sessionRelations .session-relation-chip:not(.session-relation-more)').evaluateAll(
      chips => chips.filter(chip => chip.textContent.includes('Child')).length);
    check(visibleActiveChildren > 0 && visibleActiveChildren < 25 && !activeHeader.includes('closed-child-'),
      'active children overflow after one row instead of wrapping');
    await desktop.click('.session-relation-more');
    await desktop.waitForSelector('#relationsModal .relation-row', { timeout: 5000 });
    check(await desktop.locator('#relationsModal .relation-row').count() === 26,
      'active-child overflow modal lists the complete fan-out');
    await desktop.keyboard.press('Escape');

    relationFixtureMode = 'closed';
    await desktop.evaluate((id) => selectSession(id), BETA_ID);
    await desktop.waitForSelector('.session-relation-more', { timeout: 5000 });
    await desktop.click('.session-relation-more');
    await desktop.waitForSelector('#relationsModal .relation-row', { timeout: 5000 });
    await desktop.locator('#relationsModal .relation-row').first().click();
    await desktop.waitForFunction((id) => currentSession?.id === id, registryState.sessionId, { timeout: 5000 });
    check(true, 'overflow modal row navigates to the relation');
    check(await desktop.locator('#relationsModal').evaluate((el) => el.style.display === 'none'),
      'navigation closes the relations modal');
    await desktop.unroute('**/api/sessions/*/related');
    await desktop.evaluate((id) => selectSession(id), registryState.sessionId);
    await desktop.waitForFunction((id) => currentSession?.id === id &&
      !document.getElementById('sessionRelations').textContent.includes('overflow-'),
      registryState.sessionId, { timeout: 5000 });

    await desktop.click('#tabActive');
    await desktop.waitForTimeout(200);

    // 13b. Advanced search takeover: opened via the "full search" chip
    // (carrying the sidebar query), same grammar, multi-snippet results,
    // facet buttons that rewrite the query text, and click-through that
    // lands on the in-session match. Runs *after* the retention section on
    // purpose — click-through warms the beta transcript cache, which would
    // break that section's cold-load page-count assertions.
    console.log('advanced search takeover:');
    // Add the cap-boundary corpus only now: earlier sidebar tree/drag checks
    // intentionally retain their small deterministic fixture set.
    for (let i = 0; i < 100; i++) {
      const id = `2026-07-06T00-00-${String(i).padStart(2, '0')}-boundary`;
      const timestamp = new Date(Date.parse('2026-07-06T00:00:00.000Z') + i * 1000).toISOString();
      const file = path.join(sessionDir, `${id}.jsonl`);
      fs.writeFileSync(file, [
        { type: 'session', cwd: CWD, timestamp },
        { type: 'message', message: { role: 'user', content: [{ type: 'text', text: `boundary-contract filler ${i}` }], timestamp } },
      ].map(e => JSON.stringify(e)).join('\n') + '\n');
      const at = new Date(timestamp);
      fs.utimesSync(file, at, at);
    }
    // Save a device-local active scope, then prove the beta session is absent
    // at rank 101 without it but survives when the server applies the scope
    // before truncating (the 100 fillers name the term, beta only mentions it
    // once in its transcript, so it ranks last either way). The
    // server-reported hidden count covers all 100 excluded sessions, not
    // merely rows from an already-capped response.
    await desktop.fill('#filterInput', 'cwd:proj-beta');
    await desktop.evaluate(() => { window.prompt = () => 'Beta only'; });
    await desktop.click('.scope-chip.scope-add');
    await desktop.waitForSelector('.scope-chip[data-name="Beta only"].active', { timeout: 5000 });
    await desktop.click('.scope-chip[data-name="Beta only"]');
    await desktop.waitForFunction(() =>
      !document.querySelector('.scope-chip[data-name="Beta only"]').classList.contains('active'));
    await desktop.evaluate(() => openSearchView('boundary-contract'));
    await desktop.waitForFunction((id) =>
      document.querySelectorAll('.search-result').length === 100 &&
      !document.querySelector(`.search-result[data-id="${id}"]`) &&
      document.querySelector('.search-count-line')?.textContent.includes('showing the 100 best matches'),
      BETA_ID, { timeout: 10000 });
    check(true, 'unscoped rank-101 session is omitted with truthful cap messaging');
    await desktop.evaluate(() => closeSearchView());
    await desktop.click('.scope-chip[data-name="Beta only"]');
    await desktop.waitForSelector('.scope-chip[data-name="Beta only"].active', { timeout: 5000 });
    check(await desktop.evaluate(() => localStorage.getItem('pi-dish-active-scopes')) === JSON.stringify(['Beta only']),
      'advanced-search active scope state remains device-local');
    await desktop.evaluate(() => openSearchView('boundary-contract'));
    // Scope the note lookup to the takeover: the sidebar behind it renders
    // its own `.scope-hidden-note` for the same active scope.
    await desktop.waitForFunction((id) =>
      document.querySelectorAll('.search-result').length === 1 &&
      document.querySelector(`.search-result[data-id="${id}"]`) &&
      document.querySelector('#searchViewBody .scope-hidden-note')?.textContent === '100 hidden by scopes',
      BETA_ID, { timeout: 10000 });
    check(!await desktop.evaluate(() =>
      document.querySelector('.search-count-line').textContent.includes('showing the 100 best matches')),
      'scoped total and cap messaging describe the post-scope result set');
    await desktop.evaluate(() => closeSearchView());

    await desktop.fill('#filterInput', 'beta');
    await desktop.waitForSelector('.search-open-chip', { timeout: 2000 });
    await desktop.click('.search-open-chip');
    await desktop.waitForFunction(() =>
      document.querySelector('.main').classList.contains('search-open'), null, { timeout: 5000 });
    check(await desktop.evaluate(() => document.getElementById('searchViewInput').value) === 'beta',
      'full-search chip carries the sidebar query into the takeover');
    check(await desktop.evaluate(() => document.getElementById('sessionView').offsetParent === null),
      'session view hidden while search is open');
    await desktop.fill('#searchViewInput', 'cedar maple');
    await desktop.waitForFunction((id) => {
      const card = document.querySelector(`.search-result[data-id="${id}"]`);
      const marks = [...(card?.querySelectorAll('.search-result-snippet mark') || [])]
        .map(el => el.textContent.toLowerCase());
      return marks.includes('cedar') && marks.includes('maple') &&
        card.querySelector('.search-result-count')?.textContent === '2 matches';
    }, BETA_ID, { timeout: 5000 });
    check(true, 'distributed content terms render highlighted snippets');
    const countText = await desktop.evaluate((id) =>
      document.querySelector(`.search-result[data-id="${id}"] .search-result-count`)?.textContent, BETA_ID);
    check(countText === '2 matches',
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
    check(await desktop.evaluate(() => document.getElementById('searchInput').value) === 'cedar maple',
      'click-through hands distributed terms to the explicit in-session mode');
    check(await desktop.evaluate(() =>
      document.querySelector('mark.search-mark')?.textContent.toLowerCase() === 'maple' &&
      document.getElementById('searchCount').textContent !== 'no matches'),
      'distributed-term click-through lands on a relevant transcript message');
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
    await desktop.click('.scope-chip[data-name="Beta only"].active');
    check(await desktop.evaluate(() => localStorage.getItem('pi-dish-active-scopes')) === JSON.stringify([]),
      'toggling the saved scope inactive remains device-local');
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
    check(await desktop.evaluate(() => {
      const value = document.querySelector('.usage-total-line strong')?.textContent || '';
      return value.startsWith('~$') && value.endsWith('*');
    }), 'mixed usage total shows its marked known subtotal');
    check(await desktop.evaluate(() =>
      [...document.querySelectorAll('#usageViewBody .usage-row.model-toggle')]
        .some((r) => r.textContent.includes('unpriced') && r.textContent.includes('*'))),
      'partially priced model rows show their subtotal and unpriced count');
    check(await desktop.evaluate(() =>
      document.querySelector('#usageViewBody .usage-notice')?.textContent
        .includes('Known priced usage only')),
      'usage notice explains the partial-estimate marker');
    await desktop.waitForSelector('#usageChart svg', { timeout: 5000 });
    check(await desktop.locator('#usageChart .usage-col').count() >= 2,
      'stacked daily chart renders one column per bucket');
    check(await desktop.locator('#usageChart text.tick').count() >= 4,
      'chart draws axis tick labels');
    check((await desktop.locator('#usageChart svg').getAttribute('aria-label')).startsWith('Estimated spend'),
      'a positive known subtotal keeps cost chart geometry');
    // Event-driven: while the session index is still settling, the view
    // repolls at 1s and each re-render can shift the chart's day axis (the
    // 'all' range starts at the earliest *indexed* day), so a bucket index
    // captured mid-indexing goes stale by click time. Wait for indexing to
    // settle with the smoke model present, then resolve the index once.
    await desktop.waitForFunction(() =>
      usageData && !usageData.indexing &&
      usageChart.buckets.some(b => b.models?.some(m => m.ref === 'test/smoke-model')),
      null, { timeout: 10000 });
    const smokeBucket = await desktop.evaluate(() => usageChart.buckets.findIndex(b =>
      b.models?.some(m => m.ref === 'test/smoke-model')));
    await desktop.locator('#usageChart .usage-col').nth(smokeBucket).click();
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

    // Skills view: the observational directory + in-takeover detail + refine
    // launcher. Opened from the sidebar-header shield button.
    console.log('skills view:');
    await desktop.click('[title="Skills"]');
    await desktop.waitForFunction(() =>
      document.querySelector('.main').classList.contains('skills-open') &&
      [...document.querySelectorAll('.sk-row .sk-name')].some((n) => n.textContent.includes('smoke-skill')),
      null, { timeout: 8000 });
    check(await desktop.evaluate(() => document.getElementById('sessionView').offsetParent === null),
      'session view hidden while the skills takeover is open');
    check(await desktop.evaluate(() =>
      /inferred from tool calls/.test(document.querySelector('.sk-summary')?.textContent || '') &&
      /catalog ~\d/.test(document.querySelector('.sk-summary')?.textContent || '')),
      'directory summary badges inferred usage and the estimated catalog footprint');
    // Open the detail page for the fixture skill.
    await desktop.evaluate(() => {
      [...document.querySelectorAll('.sk-row')].find((r) => r.querySelector('.sk-name').textContent.includes('smoke-skill')).click();
    });
    await desktop.waitForSelector('.skills-detail-wrap', { timeout: 8000 });
    check(await desktop.evaluate(() => !!document.querySelector('.skills-detail-title')?.textContent.includes('smoke-skill')),
      'detail header names the skill in-takeover (not a modal)');
    check(await desktop.evaluate(() =>
      [...document.querySelectorAll('.sec-row.cold .never')].some((n) => /never read/.test(n.textContent))),
      'coverage map flags a never-read section');
    check(await desktop.evaluate(() => !!document.querySelector('.spark-lg') && document.querySelectorAll('.spark-lg i').length === 26),
      'side column renders the 26-week sparkline');
    // Refine launcher: prefills the new-session takeover with a draft (never sends).
    await desktop.click('.refine-btn');
    await desktop.waitForFunction(() =>
      document.querySelector('.main').classList.contains('new-session-open'), null, { timeout: 5000 });
    check(await desktop.evaluate(() => (document.getElementById('newSessionCwd').value || '').includes('smoke-skill')),
      'refine sets the new-session cwd to the skill directory');
    check(await desktop.evaluate(() => typeof nsPendingDraft === 'string' &&
      nsPendingDraft.includes('SKILL.md') && /coverage\?skill=/.test(nsPendingDraft)),
      'refine stashes an evidence-bundle draft (path + coverage URL), never auto-sent');
    await desktop.keyboard.press('Escape');
    await desktop.waitForFunction(() => !document.querySelector('.main').classList.contains('new-session-open'),
      null, { timeout: 2000 });
    check(true, 'Escape closes the new-session takeover opened by refine');

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
    await mobile.waitForSelector('#sessionRelations .session-relation-chip', { timeout: 5000 });
    const relationLayout = await mobile.evaluate(() => {
      const strip = document.getElementById('sessionRelations');
      const chips = [...strip.querySelectorAll('.session-relation-chip')];
      const rect = strip.getBoundingClientRect();
      const tops = chips.map(chip => Math.round(chip.getBoundingClientRect().top));
      return {
        height: rect.height,
        rows: new Set(tops).size,
        flexWrap: getComputedStyle(strip).flexWrap,
        maxChipWidth: Math.max(...chips.map(chip => chip.getBoundingClientRect().width)),
      };
    });
    check(relationLayout.rows === 1 && relationLayout.flexWrap === 'nowrap' &&
      relationLayout.height <= 32 && relationLayout.maxChipWidth <= 171,
      `related-session chips stay in one compact mobile strip (got ${JSON.stringify(relationLayout)})`);

    // Layout contract: title gets its own row above the top-right model
    // selector, while the context badge stays bottom-left.
    const vp = mobile.viewportSize();
    const title = await mobile.locator('#sessionName').boundingBox();
    const model = await mobile.locator('#sessionModel').boundingBox();
    check(title && model && title.y + title.height <= model.y,
      'session title sits above the model selector');
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

    // 12b. Row-level close: live rows carry a quiet hover-reveal ✕ with a
    // two-tap inline confirm. The POST is intercepted (deterministic — the
    // real SIGTERM round-trip is covered by the stats-modal section below,
    // which needs the session still live here).
    console.log('row-level close:');
    const closeRowSel = `.session-item[data-id="${SESSION_ID}"]`;
    await desktop.waitForSelector(`${closeRowSel} .session-close-btn`, { state: 'attached', timeout: 5000 });
    check(true, 'live row carries the close button');
    // Hover-reveal: transparent until the row is hovered.
    await desktop.mouse.move(900, 400); // park the pointer off the sidebar
    const preOpacity = await desktop.$eval(`${closeRowSel} .session-close-btn`, (el) => getComputedStyle(el).opacity);
    check(preOpacity === '0', `close button hidden until hover (opacity ${preOpacity})`);
    await desktop.hover(closeRowSel);
    await desktop.waitForFunction((sel) =>
      parseFloat(getComputedStyle(document.querySelector(sel)).opacity) > 0,
      `${closeRowSel} .session-close-btn`, { timeout: 5000 });
    check(true, 'close button revealed on row hover');
    // First tap arms the confirm state; the tap must not select the row.
    const selectedBefore = await desktop.evaluate(() => document.querySelector('.session-item.active')?.dataset.id || null);
    await desktop.click(`${closeRowSel} .session-close-btn`);
    check(await desktop.locator(`${closeRowSel} .session-close-btn.confirm`).count() === 1,
      'first tap arms the danger confirm state');
    check(await desktop.evaluate(() => document.querySelector('.session-item.active')?.dataset.id || null) === selectedBefore,
      'confirm tap does not select the row');
    // A poll re-render must restore (not clear) the armed state.
    await desktop.evaluate(() => renderSessions());
    check(await desktop.locator(`${closeRowSel} .session-close-btn.confirm`).count() === 1,
      'list re-render preserves the armed confirm');
    // The armed state auto-reverts after ~3s.
    await desktop.waitForFunction((sel) => !document.querySelector(sel),
      `${closeRowSel} .session-close-btn.confirm`, { timeout: 6000 });
    check(true, 'confirm state reverts after ~3s');
    // Tap-tap through with the POST routed: assert it fired with the row id.
    let closePostUrl = null;
    let resolveClosePost;
    const closePostFired = new Promise((r) => { resolveClosePost = r; });
    await desktop.route('**/api/sessions/*/close', async (route) => {
      closePostUrl = route.request().url();
      resolveClosePost();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await desktop.hover(closeRowSel);
    await desktop.click(`${closeRowSel} .session-close-btn`);
    await desktop.click(`${closeRowSel} .session-close-btn.confirm`);
    await Promise.race([closePostFired, new Promise((r) => setTimeout(r, 5000))]);
    check(closePostUrl !== null && closePostUrl.includes(`/api/sessions/${SESSION_ID}/close`),
      `second tap fires POST /close for the row (got ${JSON.stringify(closePostUrl)})`);
    await desktop.unroute('**/api/sessions/*/close');
    // The interception left the session live server-side; wait for the
    // post-close list reload to settle before the real close section below.
    await desktop.waitForSelector(`${closeRowSel} .session-close-btn`, { state: 'attached', timeout: 5000 });

    // 13. Close session: the stats modal shows where the session runs, and
    // its danger button SIGTERMs the pi process, flipping the view to the
    // inactive/resume state. A dummy child stands in for pi — the registry
    // normally carries this process's own pid, which close must never get.
    console.log('close session:');
    const { spawn } = require('child_process');
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    let dummySignal = null;
    const dummyGone = new Promise((r) => dummy.on('exit', (code, sig) => { dummySignal = sig; r(); }));
    writeRegistry({ pid: dummy.pid, startTime: processIdentity(dummy.pid)?.startTime });
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

    // 14. Host-aware client keys (TASKS/multi-host.md phase 1). The server
    // answers /api/host, so live session state is already stamped with the
    // real self hostId — seed bare legacy keys and re-drive the migration
    // under that same id to prove it is lossless and that the live key
    // helpers agree with what it wrote.
    console.log('host-aware client keys:');
    const keys = await desktop.evaluate((id) => {
      const hostId = selfHost.hostId || 'ui-host';
      if (!selfHost.hostId) selfHost = { hostId, base: '', label: null };
      localStorage.setItem('pi-dish-draft-' + id, 'bare draft');
      localStorage.setItem('pi-dish-history-' + id, JSON.stringify(['bare prompt']));
      localStorage.setItem('pi-dish-terminal-mode-' + id, 'tmux');
      localStorage.setItem('pi-dish-draft-spawn:keep-me', 'spawn draft');
      localStorage.setItem('pi-dish-seen', JSON.stringify({ [id]: 'seen-at' }));
      localStorage.setItem('pi-dish-pinned-sessions', JSON.stringify([id]));
      localStorage.setItem('pi-dish-expanded-session-families', JSON.stringify([id]));
      localStorage.setItem('pi-dish-session', id);
      localStorage.removeItem('pi-dish-keys-migrated');
      seenActivity = readJSONPref('pi-dish-seen', {});
      pinnedSessions = readJSONPref('pi-dish-pinned-sessions', []);
      expandedSessionFamilies.clear();
      expandedSessionFamilies.add(id);
      migrateClientKeys();
      const key = sessionKey(hostId, id);
      const bareLeft = Object.keys(localStorage).filter((k) =>
        /^pi-dish-(draft|history|terminal-mode)-/.test(k) && !k.includes(' ') && !k.includes('spawn:'));
      return {
        key,
        hostId,
        draft: localStorage.getItem('pi-dish-draft-' + key),
        history: localStorage.getItem('pi-dish-history-' + key),
        mode: localStorage.getItem('pi-dish-terminal-mode-' + key),
        spawnDraft: localStorage.getItem('pi-dish-draft-spawn:keep-me'),
        seen: localStorage.getItem('pi-dish-seen'),
        pinned: localStorage.getItem('pi-dish-pinned-sessions'),
        expanded: localStorage.getItem('pi-dish-expanded-session-families'),
        selected: localStorage.getItem('pi-dish-session'),
        bareLeft,
        derivedDraftKey: draftKey(id),
        derivedTerminalKey: terminalModeKey(id),
        stampedHost: stampSessionHost({ id: 'fresh' }).host,
        migratedFlag: localStorage.getItem('pi-dish-keys-migrated'),
      };
    }, registryState.sessionId);
    check(keys.draft === 'bare draft' && keys.history === '["bare prompt"]' && keys.mode === 'tmux',
      'per-session drafts/history/terminal mode migrate to composite keys with their values');
    check(keys.bareLeft.length === 0, `no bare per-session keys left behind (got ${keys.bareLeft.join(', ')})`);
    check(keys.spawnDraft === 'spawn draft', 'spawn composer keys are left alone (never session ids)');
    check(keys.seen === JSON.stringify({ [keys.key]: 'seen-at' }), 'seen map re-keys to host + session');
    check(keys.pinned === JSON.stringify([keys.key]) && keys.expanded === JSON.stringify([keys.key]),
      'pins and expanded families re-key to host + session');
    check(keys.selected === keys.key, 'the restored-session key carries its host');
    check(keys.derivedDraftKey === 'pi-dish-draft-' + keys.key &&
      keys.derivedTerminalKey === 'pi-dish-terminal-mode-' + keys.key,
      'the live key helpers resolve to exactly what the migration wrote');
    check(keys.stampedHost === keys.hostId, 'session state writers stamp the host onto new entries');
    check(keys.migratedFlag === keys.hostId, 'migration is flagged so it runs once');

    // 15. Multi-host aggregation (TASKS/multi-host.md phase 2). A second
    // pi-dish on its own HOME, added to this browser as a directly-added
    // host: sessions merge with host chips, session-scoped traffic goes to
    // the owning host, the new-session takeover re-points, and a host that
    // stops answering degrades to its own dimmed rows.
    console.log('multi-host:');
    writeRemoteFixture(base);
    remoteHost = await startRemoteHost();
    const multi = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watch(multi, 'multi-host');
    await multi.addInitScript((entry) => {
      localStorage.setItem('pi-dish-hosts', JSON.stringify([entry]));
    }, { base: remoteHost.base, label: 'tycho', token: REMOTE_TOKEN });
    const remoteBase = remoteHost.base;
    const remoteRequests = [];
    multi.on('request', (r) => { if (r.url().startsWith(remoteBase)) remoteRequests.push(r.url()); });
    await multi.goto(base, { waitUntil: 'networkidle' });
    await multi.click('#tabAll');
    // Event-driven: drive the poll from the test rather than waiting out the
    // 10s interval (and never widen a wait to catch a transient element).
    await multi.evaluate(() => loadSessions(undefined, { withPrevious: true }));
    await multi.waitForSelector(`.session-item[data-id="${REMOTE_SESSION_ID}"]`, { timeout: 15000 });
    check(await multi.locator(`.session-item[data-id="${SESSION_ID}"]`).count() === 1,
      'both hosts\' sessions are in one merged list');
    const remoteRow = multi.locator(`.session-item[data-id="${REMOTE_SESSION_ID}"]`);
    check((await remoteRow.getAttribute('data-host')) !== null,
      'merged rows carry the host that served them');
    const groupKeys = await multi.evaluate((cwd) => [...document.querySelectorAll('.workspace-group-header')]
      .map((h) => h.dataset.cwd || '').filter((key) => key.endsWith(cwd)), CWD);
    check(groupKeys.length === 2 && new Set(groupKeys).size === 2 && groupKeys.every((k) => k.includes(' ')),
      `the same cwd on two hosts stays two host-qualified workspace groups (got ${JSON.stringify(groupKeys)})`);
    // The workspace view is sectioned by host: one heading per machine, self
    // first, each carrying its own color. The trees below name workspaces
    // only — the heading above them already named the host.
    const sections = await multi.evaluate(() => [...document.querySelectorAll('#sessionList > .host-section')]
      .map((section) => ({
        name: section.querySelector('.host-section-name')?.textContent || null,
        key: section.querySelector('.host-section-header')?.dataset.hostSection || null,
        color: section.style.getPropertyValue('--host-color'),
        dot: getComputedStyle(section.querySelector('.host-section-dot')).backgroundColor,
        count: section.querySelector('.host-section-count')?.textContent || null,
      })));
    const selfLabel = await multi.evaluate(() => hostDisplayLabel(effectiveHosts()[0]));
    check(sections.length === 2 && sections[0].name === selfLabel && sections[1].name === 'tycho',
      `the workspace view is sectioned by host, self first (got ${JSON.stringify(sections.map((s) => s.name))})`);
    check(sections.every((s) => /^var\(--chart-\d\)$/.test(s.color)) &&
      new Set(sections.map((s) => s.color)).size === 2 &&
      new Set(sections.map((s) => s.dot)).size === 2,
      `each host section wears its own chart-slot color (got ${JSON.stringify(sections.map((s) => [s.color, s.dot]))})`);
    check(sections.every((s) => Number(s.count) > 0), `host headings count their sessions (got ${JSON.stringify(sections.map((s) => s.count))})`);
    const chipsInTrees = await multi.evaluate(() =>
      document.querySelectorAll('#sessionList .workspace-group-header .host-chip').length);
    check(chipsInTrees === 0, `the heading names the host, so tree headers drop the chip (got ${chipsInTrees})`);

    // Collapsing a section hides that host's whole tree and persists in the
    // shared collapse store under its own `host:` namespace.
    const remoteKey = sections[1].key;
    await multi.evaluate(() => document.querySelectorAll('.host-section-header')[1].click());
    const collapsed = await multi.evaluate(() => {
      const section = document.querySelectorAll('#sessionList > .host-section')[1];
      return {
        klass: section.classList.contains('collapsed'),
        body: section.querySelectorAll('.session-item').length,
        stored: JSON.parse(localStorage.getItem('pi-dish-collapsed-groups') || '[]'),
      };
    });
    check(collapsed.klass && collapsed.body === 0 && collapsed.stored.includes(remoteKey),
      `collapsing a host section hides its tree and persists as ${remoteKey} (got ${JSON.stringify(collapsed)})`);
    await multi.evaluate(() => document.querySelectorAll('.host-section-header')[1].click());
    check(await multi.evaluate(() =>
      document.querySelectorAll('#sessionList > .host-section')[1].querySelectorAll('.session-item').length > 0),
      'expanding the host section brings its tree back');

    // Recent view is a timeline, so it stays interleaved — the host is the
    // row's colored chip there.
    await multi.evaluate(() => toggleSidebarView());
    const recentChips = await multi.evaluate(() => [...document.querySelectorAll('.session-item .host-chip')]
      .map((chip) => ({
        text: chip.textContent.trim(),
        color: chip.style.getPropertyValue('--host-color'),
        dot: !!chip.querySelector('.host-chip-dot'),
      })));
    const chipColors = [...new Set(recentChips.map((c) => `${c.text}=${c.color}`))];
    check(recentChips.length > 0 && recentChips.every((c) => c.dot && c.color) && chipColors.length === 2,
      `Recent rows carry a color-dotted host chip per host (got ${JSON.stringify(chipColors)})`);
    check(await multi.evaluate(() => document.querySelectorAll('.host-section').length) === 0,
      'the Recent view stays interleaved — no host sections');
    await multi.evaluate(() => toggleSidebarView());

    // The color picker in the settings Hosts section overrides the automatic
    // color and repaints the sidebar without a reload.
    await multi.evaluate(() => openSettingsModal());
    await multi.waitForSelector('#hostsList .host-color-input', { timeout: 5000 });
    const picked = await multi.evaluate(() => {
      const inputs = [...document.querySelectorAll('#hostsList .host-color-input')];
      const before = inputs.map((i) => i.value);
      const remote = inputs[1];
      remote.value = '#d33682';
      remote.dispatchEvent(new Event('change', { bubbles: true }));
      const section = [...document.querySelectorAll('#sessionList > .host-section')]
        .find((s) => s.querySelector('.host-section-name').textContent === 'tycho');
      return {
        before,
        stored: JSON.parse(localStorage.getItem('pi-dish-host-colors') || '{}'),
        sectionColor: section.style.getPropertyValue('--host-color'),
        reset: !document.querySelectorAll('#hostsList .host-color-reset')[1].classList.contains('hidden'),
      };
    });
    check(picked.before.every((v) => /^#[0-9a-f]{6}$/.test(v)),
      `auto colors resolve to concrete hex for the picker (got ${JSON.stringify(picked.before)})`);
    check(picked.sectionColor === '#d33682' && Object.values(picked.stored).includes('#d33682') && picked.reset,
      `a picked color overrides that host everywhere and offers a reset (got ${JSON.stringify(picked)})`);
    const afterReset = await multi.evaluate(() => {
      document.querySelectorAll('#hostsList .host-color-reset')[1].click();
      const section = [...document.querySelectorAll('#sessionList > .host-section')]
        .find((s) => s.querySelector('.host-section-name').textContent === 'tycho');
      return { color: section.style.getPropertyValue('--host-color'),
        stored: JSON.parse(localStorage.getItem('pi-dish-host-colors') || '{}') };
    });
    check(/^var\(--chart-\d\)$/.test(afterReset.color) && Object.keys(afterReset.stored).length === 0,
      `reset returns the host to its automatic color (got ${JSON.stringify(afterReset)})`);
    await multi.keyboard.press('Escape');

    await multi.click(`.session-item[data-id="${REMOTE_SESSION_ID}"]`);
    await multi.waitForFunction(() => document.getElementById('messages')?.textContent.includes('remote host answer'),
      { timeout: 10000 });
    check(remoteRequests.some((u) => u.includes(`/api/sessions/${REMOTE_SESSION_ID}/messages`)),
      'the remote session\'s transcript is fetched from its own host');
    check(await multi.locator('#sessionHost').isVisible() &&
      (await multi.locator('#sessionHost').textContent()) === 'tycho',
      'the session header names the host');

    // The terminal is the *owning* host's feature: this entry host runs with
    // PI_DISH_TERMINAL=1 and the peer with it off, so the capabilities the
    // peer advertises — not ours — decide whether the button can exist.
    const termGating = await multi.evaluate(() => {
      const [self, remote] = [effectiveHosts()[0], effectiveHosts().find((h) => !h.self)];
      return {
        self: hostSupportsTerminal(self, appConfig),
        remote: hostSupportsTerminal(remote, appConfig),
        remoteCaps: !!(remote && remote.capabilities),
        button: document.getElementById('btnTerminal').style.display,
      };
    });
    check(termGating.self === true && termGating.remoteCaps && termGating.remote === false
      && termGating.button === 'none',
      `terminal gating follows the session's host, not the entry host (got ${JSON.stringify(termGating)})`);

    // `host:` is client-evaluated: it narrows the merged list *and* prunes
    // the fan-out, and it must never reach a server (which would match it
    // against nothing and answer empty).
    const listReqs = [];
    const noteList = (r) => { if (/\/api\/sessions(\?|$)/.test(r.url())) listReqs.push(r.url()); };
    multi.on('request', noteList);
    await multi.evaluate(() => {
      const input = document.getElementById('filterInput');
      input.value = 'host:tycho';
      onFilterInput();
    });
    await multi.waitForSelector(`.session-item[data-id="${SESSION_ID}"]`, { state: 'detached', timeout: 10000 });
    check(await multi.locator(`.session-item[data-id="${REMOTE_SESSION_ID}"]`).count() === 1,
      'host: keeps the named host\'s rows and drops the others');
    await multi.waitForFunction(() => listsQueriedFor === 'host:tycho', { timeout: 10000 });
    multi.off('request', noteList);
    check(listReqs.length > 0 && listReqs.every((u) => u.startsWith(remoteBase)),
      `host: prunes the fan-out to the named host (got ${JSON.stringify(listReqs)})`);
    check(listReqs.every((u) => !/host(%3A|:)/i.test(u)),
      `the host: term is stripped before the wire (got ${JSON.stringify(listReqs)})`);
    await multi.evaluate(() => {
      document.getElementById('filterInput').value = '';
      onFilterInput();
    });
    await multi.waitForSelector(`.session-item[data-id="${SESSION_ID}"]`, { timeout: 10000 });

    // The advanced-search host facet is pure UI over the same grammar: it
    // writes the term into the visible query, which stays authoritative.
    await multi.evaluate(() => openSearchView(''));
    await multi.waitForSelector('#searchFacetHost', { timeout: 10000 });
    const facetHosts = await multi.locator('#searchFacetHost option').allTextContents();
    check(facetHosts.length === 3 && facetHosts.includes('tycho'),
      `the host facet offers every known host (got ${JSON.stringify(facetHosts)})`);
    await multi.selectOption('#searchFacetHost', 'tycho');
    await multi.waitForFunction(() => document.getElementById('searchViewInput').value === 'host:tycho',
      { timeout: 10000 });
    await multi.waitForFunction((id) => [...document.querySelectorAll('.search-result')]
      .every((r) => r.dataset.id !== id), SESSION_ID, { timeout: 10000 });
    check(await multi.locator(`.search-result[data-id="${REMOTE_SESSION_ID}"]`).count() === 1,
      'the host facet narrows the results to that host');
    await multi.keyboard.press('Escape');

    // Unread bookkeeping is keyed host + session, so viewing a remote session
    // marks *that* host's entry and can never mask a local id that matches.
    await multi.evaluate(() => loadSessions(undefined, { withPrevious: true }));
    const seenKeys = await multi.evaluate((id) => {
      const host = effectiveHosts().find((h) => !h.self);
      return { keys: Object.keys(JSON.parse(localStorage.getItem('pi-dish-seen') || '{}')), want: host.hostId + ' ' + id };
    }, REMOTE_SESSION_ID);
    check(seenKeys.keys.includes(seenKeys.want),
      `the seen map records the remote session under its own host (got ${JSON.stringify(seenKeys.keys)})`);

    await multi.evaluate(() => openNewSessionView());
    await multi.waitForSelector('#nsHostRow', { state: 'visible', timeout: 5000 });
    const hostOptions = await multi.locator('#nsHostSelect option').allTextContents();
    check(hostOptions.length === 2 && hostOptions.includes('tycho'),
      `the new-session takeover offers both hosts (got ${JSON.stringify(hostOptions)})`);
    await multi.keyboard.press('Escape');

    // A host that stops answering keeps its last-known rows, dimmed — and
    // degrades nothing else.
    const remoteGone = new Promise((r) => remoteHost.child.once('exit', r));
    remoteHost.child.kill('SIGKILL');
    await remoteGone;
    remoteHost = null;
    await multi.evaluate(() => loadSessions(undefined, { withPrevious: true }));
    await multi.waitForSelector(`.session-item[data-id="${REMOTE_SESSION_ID}"].stale-host`, { timeout: 15000 });
    check(await multi.locator(`.session-item[data-id="${SESSION_ID}"]`).count() === 1 &&
      await multi.locator(`.session-item[data-id="${SESSION_ID}"].stale-host`).count() === 0,
      'the reachable host\'s rows are untouched by the dead one');
    const offlineSection = await multi.evaluate(() => {
      const host = effectiveHosts().find((h) => !h.self);
      const header = [...document.querySelectorAll('.host-section-header')]
        .find((h) => h.dataset.hostSection === 'host:' + host.hostId);
      const section = header?.closest('.host-section');
      return {
        state: hostState(host),
        note: header?.querySelector('.host-section-state')?.textContent || null,
        offline: !!section?.classList.contains('offline'),
        rows: section ? section.querySelectorAll('.session-item.stale-host').length : 0,
      };
    });
    check(offlineSection.state === 'backoff' && offlineSection.offline &&
      offlineSection.note === 'unreachable' && offlineSection.rows > 0,
      `the dead host's section heading says why its rows are stale (got ${JSON.stringify(offlineSection)})`);
    await multi.close();

    check(errors.length === 0, errors.length ? `no page errors — got: ${errors.join(' | ')}` : 'no page errors');
  } catch (e) {
    failures++;
    console.error('  ✘ smoke test crashed:', e.message);
    console.error(e.stack);
    if (errors.length) console.error('  collected page errors:', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
    bridge.close();
    bridge2.close();
    if (remoteHost) remoteHost.child.kill('SIGKILL');
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(remoteHome, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
})();
