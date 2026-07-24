#!/usr/bin/env node
/**
 * Fixture standing in for `pi --mode rpc` in rpc-session.test.js. Speaks pi's
 * RPC stdio protocol: commands arrive as {"id","type",...} JSONL on stdin,
 * responses go back as {"type":"response","id",...}, and agent events are
 * emitted as bare JSONL objects on stdout — the same framing lib/rpc-session.js
 * parses. Every received command is appended to PI_FIXTURE_LOG (JSONL) so
 * tests can assert on what pi was actually asked.
 *
 * Behaviors:
 *  - `--session <path>` resumes that file (id = basename), else a fresh
 *    session JSONL is created under $HOME/.pi/agent/sessions/rpcproj/.
 *  - `prompt` runs a full turn: turn_start → message_update deltas →
 *    JSONL append → message_end → turn_end. A message starting with "slow:"
 *    keeps the turn open ~1200ms so tests can steer/abort mid-turn.
 *  - `abort` mid-turn ends with agent_end and no paired turn_end (the
 *    aborted-turn shape both backends must treat as turn-terminating).
 *  - PI_FIXTURE_EXIT_ON_START=1 exits immediately (startup-failure path).
 */
const fs = require('fs');
const path = require('path');

if (process.env.PI_FIXTURE_EXIT_ON_START) process.exit(3);

const home = process.env.HOME;
const args = process.argv.slice(2);

// lib/pi-sdk.js resolves the model list through the same launch spec as
// sessions, so `--list-models` reaches this fixture too: print a table shaped
// like the real CLI's and exit (without this the fixture would sit waiting on
// RPC stdin until the caller's exec timeout).
if (args.includes('--list-models')) {
  process.stdout.write([
    'Provider  Model  Context  Max Output  Thinking',
    'test  fake-model  200K  64K  yes',
    'test  fresh-model  200K  64K  no',
  ].join('\n') + '\n');
  process.exit(0);
}

const sessionIdx = args.indexOf('--session');
let sessionFile, sessionId;
if (sessionIdx >= 0 && args[sessionIdx + 1]) {
  sessionFile = args[sessionIdx + 1];
  sessionId = path.basename(sessionFile, '.jsonl');
} else {
  sessionId = '2026-07-10T00-00-00-' + Math.random().toString(16).slice(2, 10);
  sessionFile = path.join(home, '.pi', 'agent', 'sessions', 'rpcproj', sessionId + '.jsonl');
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify({ type: 'session', cwd: process.cwd() }) + '\n');
}

const modelIdx = args.indexOf('--model');
let model = { provider: 'test', id: 'fake-model' };
if (modelIdx >= 0 && args[modelIdx + 1]) {
  const ref = args[modelIdx + 1];
  const slash = ref.indexOf('/');
  model = slash > 0 ? { provider: ref.slice(0, slash), id: ref.slice(slash + 1) } : { provider: 'test', id: ref };
}

let sessionName = 'rpc fixture';
let turnOpen = false;
let abortTurn = null; // set while a turn is open

const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const respond = (id, data) => out({ type: 'response', id, success: true, data });
const fail = (id, error) => out({ type: 'response', id, success: false, error });
const logCmd = (cmd) => {
  if (process.env.PI_FIXTURE_LOG) fs.appendFileSync(process.env.PI_FIXTURE_LOG, JSON.stringify(cmd) + '\n');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTurn(message) {
  turnOpen = true;
  let aborted = false;
  abortTurn = () => { aborted = true; };
  out({ type: 'turn_start' });

  const finalText = `reply to: ${message}`;
  const slow = /^slow:/.test(message);
  const stepMs = slow ? 300 : 20;
  const steps = slow ? 4 : 2;
  for (let i = 1; i <= steps && !aborted; i++) {
    out({ type: 'message_update', message: {
      role: 'assistant',
      content: [{ type: 'text', text: finalText.slice(0, Math.ceil((finalText.length * i) / steps)) }],
      timestamp: new Date().toISOString(),
    } });
    await sleep(stepMs);
  }

  if (aborted) {
    // An aborted turn ends with agent_end and no paired turn_end.
    out({ type: 'agent_end' });
  } else {
    const final = {
      role: 'assistant',
      content: [{ type: 'text', text: finalText }],
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(sessionFile, JSON.stringify({ type: 'message', message: final }) + '\n');
    out({ type: 'message_end', message: final });
    out({ type: 'turn_end' });
  }
  turnOpen = false;
  abortTurn = null;
}

function handle(cmd) {
  logCmd(cmd);
  const { id, type } = cmd;
  switch (type) {
    case 'get_state':
      return respond(id, { sessionFile, sessionId, sessionName, model, thinkingLevel: 'medium', messageCount: 1 });
    case 'prompt': {
      respond(id, {});
      // A steer delivered mid-turn is queued by real pi; here it's just logged.
      if (!turnOpen) runTurn(cmd.message || '');
      return;
    }
    case 'steer':
      return respond(id, {});
    case 'abort':
      if (abortTurn) abortTurn();
      return respond(id, {});
    case 'set_session_name':
      sessionName = cmd.name;
      return respond(id, {});
    case 'set_thinking_level':
      return respond(id, { level: cmd.level });
    case 'set_model':
      model = { provider: cmd.provider, id: cmd.modelId };
      return respond(id, model);
    case 'get_available_models':
      return respond(id, { models: [
        { provider: 'test', id: 'fake-model', name: 'Fake Model' },
        { provider: 'test', id: 'other-model', name: 'Other Model' },
      ] });
    case 'get_commands':
      return respond(id, { commands: [{ name: 'dish-ext', description: 'a fixture extension command' }] });
    case 'get_session_stats':
      return respond(id, { contextUsage: { tokens: 1234, contextWindow: 200000, percent: 1 } });
    case 'compact':
      // Mirror real pi: RPC mode forwards the AgentSession's
      // compaction_start/compaction_end events ahead of the response. The
      // delay holds the compaction open long enough for tests to prove a
      // concurrent /compact is refused instead of reaching pi.
      out({ type: 'compaction_start', reason: 'manual' });
      return (async () => {
        await sleep(150);
        out({ type: 'compaction_end', reason: 'manual', aborted: false, willRetry: false,
              result: { tokensBefore: 1000, estimatedTokensAfter: 200 } });
        respond(id, { tokensBefore: 1000, estimatedTokensAfter: 200 });
      })();
    case 'export_html':
      return respond(id, { path: cmd.outputPath || '/tmp/fake-export.html' });
    case 'new_session':
      return respond(id, {});
    default:
      return fail(id, `fixture: unknown command ${type}`);
  }
}

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch {}
  }
});
process.stdin.on('end', () => process.exit(0));
