#!/usr/bin/env node

// Opt-in native-loader/TUI smoke, not part of the ordinary unit suite.
// node test/native-extensions.smoke.js mood
// PI_DISH_REAL_OMP_BIN=/absolute/omp PI_DISH_REAL_BUN_BIN_DIR=/absolute/bin \
//   node test/native-extensions.smoke.js share
// Run share only after the owner has emitted extensions/pi-dish-share-omp.mjs.
// PI_DISH_REAL_OMP_BIN=/absolute/omp node test/native-extensions.smoke.js dialogs
import assert = require('node:assert/strict');
import fs = require('node:fs');
import http = require('node:http');
import net = require('node:net');
import os = require('node:os');
import path = require('node:path');
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import pty = require('node-pty');
import type { AddressInfo } from 'node:net';
// Resolve only the generated .d.mts, not the edge-owned .mts implementation.
import type * as ShareHook from '../extensions/pi-dish-share-omp.d.mjs' with { 'resolution-mode': 'import' };
import { sanitizeTestEnv } from './test-env.js';

// JSON and host-only values stay opaque until the existing assertion consumes them.
function record(value: unknown): Record<string, unknown> {
  if (value == null) throw new TypeError(`Cannot read properties of ${value}`);
  return Object(value);
}

function array(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

const selection = process.argv[2];
if (process.argv.length !== 3 || !['mood', 'share', 'dialogs'].includes(selection!)) {
  throw new Error('Usage: node test/native-extensions.smoke.js mood|share|dialogs');
}
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-native-'));
const home = path.join(root, 'home');
const work = path.join(root, 'work');
for (const directory of [home, work]) fs.mkdirSync(directory, { recursive: true });
// Start from an allowlist, then apply the project's sanitization. No provider
// credentials, user config overlays, live sockets, tmux pane or session survive.
const env = sanitizeTestEnv({
  PATH: [process.env.PI_DISH_REAL_BUN_BIN_DIR, process.env.PATH].filter(Boolean).join(path.delimiter),
  HOME: home, TMPDIR: root, XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_CACHE_HOME: path.join(home, '.cache'), XDG_DATA_HOME: path.join(home, '.local', 'share'),
  TERM: 'xterm-256color', LANG: 'C.UTF-8', TMUX: '', TMUX_PANE: '',
});
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
let terminal: pty.IPty | undefined;
let exited = false;
let output = '';
let failure: unknown;
let providerCalls = 0;
let moodToolObserved = false;
let importedHtml: Buffer | undefined;
let importReply: { status: number; body: { path?: string; url?: string; error?: string } } = { status: 200, body: { path: '/s/native-smoke' } };

const server = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    try {
      const bytes = Buffer.concat(chunks);
      if (request.url === '/api/shares/import') {
        assert.equal(request.method, 'POST');
        assert.match(request.headers['content-type']!, /^text\/html/);
        importedHtml = bytes;
        response.writeHead(importReply.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(importReply.body));
        return;
      }
      const endpoint = new URL(request.url!, 'http://localhost').pathname;
      if (request.method !== 'POST' || (selection === 'mood'
          ? !endpoint.endsWith('/messages') : endpoint !== '/v1/responses')) {
        response.writeHead(404).end();
        return;
      }
      const body = record(JSON.parse(bytes.toString('utf8')) as unknown);
      providerCalls++;
      assert.equal(request.method, 'POST');
      assert.equal(body.stream, true);
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      if (selection === 'mood') {
        assert.match(new URL(request.url!, 'http://localhost').pathname, /\/messages$/);
        const tool = array(body.tools).find(candidate => record(candidate).name === 'set_mood');
        const properties = record(record(record(tool).input_schema).properties);
        assert.equal(record(properties.description).type, 'string');
        assert.equal(record(properties.kaomoji).type, 'string');
        const hasResult = array(body.messages).some(message => Array.isArray(record(message).content) &&
          array(record(message).content).some(part => record(part).type === 'tool_result'));
        const send = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send('message_start', { type: 'message_start', message: {
          id: `mood-${providerCalls}`, type: 'message', role: 'assistant', model: 'native-mood',
          content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 },
        } });
        if (!hasResult) {
          send('content_block_start', { type: 'content_block_start', index: 0,
            content_block: { type: 'tool_use', id: 'mood-call', name: 'set_mood', input: {} } });
          send('content_block_delta', { type: 'content_block_delta', index: 0,
            delta: { type: 'input_json_delta', partial_json: JSON.stringify({ description: 'PLAYFUL extra', kaomoji: '(^_^)' }) } });
        } else {
          const results = array(body.messages).flatMap(message => Array.isArray(record(message).content) ? array(record(message).content) : [])
            .filter(part => record(part).type === 'tool_result');
          assert.match(JSON.stringify(results), /Mood set to playful/);
          moodToolObserved = true;
          send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
          send('content_block_delta', { type: 'content_block_delta', index: 0,
            delta: { type: 'text_delta', text: 'native mood tool complete' } });
        }
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
        send('message_delta', { type: 'message_delta', delta: { stop_reason: hasResult ? 'end_turn' : 'tool_use', stop_sequence: null },
          usage: { output_tokens: 5 } });
        send('message_stop', { type: 'message_stop' });
      } else {
        assert.equal(request.url, '/v1/responses');
        const id = `share-${providerCalls}`;
        const messageId = `message-${providerCalls}`;
        const text = 'native share export smoke complete';
        const base = { id, object: 'response', created_at: 1, model: body.model, output: [], usage: null, incomplete_details: null };
        const item = { type: 'message', id: messageId, role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text, annotations: [] }] };
        const events = [
          { type: 'response.created', response: { ...base, status: 'in_progress' } },
          { type: 'response.in_progress', response: { ...base, status: 'in_progress' } },
          { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
          { type: 'response.content_part.added', output_index: 0, item_id: messageId, content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] } },
          { type: 'response.output_text.delta', output_index: 0, item_id: messageId, content_index: 0, delta: text },
          { type: 'response.output_text.done', output_index: 0, item_id: messageId, content_index: 0, text, logprobs: [] },
          { type: 'response.content_part.done', output_index: 0, item_id: messageId, content_index: 0, part: item.content[0] },
          { type: 'response.output_item.done', output_index: 0, item: item },
          { type: 'response.completed', response: { ...base, status: 'completed', output: [item],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15,
              input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
        ];
        for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      response.end();
    } catch (error) {
      failure = error;
      response.end();
    }
  });
});

async function waitFor(predicate: () => unknown, label: string, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (failure) throw failure;
    if (exited) throw new Error(`Harness exited before ${label}\n${output}`);
    if (Date.now() > deadline) throw new Error(`Timeout waiting for ${label}\n${output}`);
    await sleep(25);
  }
  if (failure) throw failure;
}

function start(executable: string, args: string[]) {
  terminal = pty.spawn(executable, args, { cwd: work, env, name: 'xterm-256color', cols: 120, rows: 40 });
  terminal.onData(data => { output += stripVTControlCharacters(data); });
  terminal.onExit(() => { exited = true; });
}

function submit(text: string) {
  terminal!.write(`\x1b[200~${text}\x1b[201~\r`);
}

async function moodSmoke(base: string) {
  const agent = path.join(home, '.pi', 'agent');
  fs.mkdirSync(agent, { recursive: true });
  fs.writeFileSync(path.join(agent, 'models.json'), JSON.stringify({ providers: { native: {
    name: 'Native mood smoke', baseUrl: base, apiKey: 'local-smoke-key', api: 'anthropic-messages',
    models: [{ id: 'native-mood', name: 'Native mood smoke', contextWindow: 200000, maxTokens: 8192 }],
  } } }));
  const session = path.join(root, 'mood.jsonl');
  const timestamp = new Date().toISOString();
  fs.writeFileSync(session, [
    { type: 'session', version: 3, id: 'native-mood-smoke', timestamp, cwd: work },
    { type: 'custom', id: 'mood-seed', parentId: null, timestamp, customType: 'mood-state',
      data: { description: 'CURIOUS extra', face: '(o_o)' } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  start(process.execPath, [path.join(repo, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'),
    '--no-extensions', '--no-skills', '--session', session, '--model', 'native/native-mood',
    '--extension', path.join(repo, 'extensions', 'mood.ts')]);
  await waitFor(() => output.includes('curious (o_o)'), 'restored mood rendered by real CustomEditor');
  output = '';
  submit('/mood FOCUSED (^-^)');
  await waitFor(() => output.includes('focused (^-^)'), 'slash command mood rendering');
  output = '';
  submit('Exercise set_mood once.');
  await waitFor(() => moodToolObserved && output.includes('native mood tool complete'), 'real TypeBox tool execution');
  assert.match(output, /playful \(\^_\^\)/);
  const entries = fs.readFileSync(session, 'utf8').trim().split('\n').map((line): unknown => JSON.parse(line));
  const commandState = entries.find(entry => record(entry).type === 'custom' && record(record(entry).data ?? {}).description === 'focused');
  assert.equal(commandState == null ? undefined : record(record(commandState).data).face, '(^-^)');
  const toolState = entries.find(entry => record(entry).type === 'message' && record(record(entry).message ?? {}).role === 'toolResult' && record(record(entry).message).toolName === 'set_mood');
  assert.deepEqual(toolState == null ? undefined : record(record(toolState).message).details, { description: 'playful', face: '(^_^)' });
  console.log('PASS mood: native Pi loader, restored CustomEditor, /mood persistence, TypeBox set_mood execution and TUI rendering');
}

async function shareSmoke(base: string) {
  const omp = process.env.PI_DISH_REAL_OMP_BIN;
  if (!omp || !path.isAbsolute(omp)) throw new Error('PI_DISH_REAL_OMP_BIN must name an absolute real OMP executable');
  fs.accessSync(omp, fs.constants.X_OK);
  const agent = path.join(home, '.omp', 'agent');
  fs.mkdirSync(agent, { recursive: true });
  execFileSync(omp, ['config', 'set', 'startup.setupWizard', 'false'], { env, cwd: work, stdio: 'pipe' });
  execFileSync(omp, ['config', 'set', 'startup.checkUpdate', 'false'], { env, cwd: work, stdio: 'pipe' });
  fs.writeFileSync(path.join(agent, 'models.yml'), [
    'providers:', '  openai:', `    baseUrl: ${JSON.stringify(`${base}/v1`)}`, '    apiKey: local-smoke-key', '',
  ].join('\n'));
  const hook = path.join(repo, 'extensions', 'pi-dish-share-omp.mjs');
  fs.symlinkSync(hook, path.join(agent, 'share.mjs'));
  env.OPENAI_API_KEY = 'local-smoke-key';
  env.OPENAI_BASE_URL = `${base}/v1`;
  env.PI_DISH_URL = base;
  start(omp, ['--no-extensions', '--no-skills', '--no-rules', '--model', 'openai/gpt-4o-mini']);
  await waitFor(() => /gpt.?4o.?mini/i.test(output), 'OMP native TUI startup');
  submit('Produce the native share smoke transcript.');
  await waitFor(() => output.includes('native share export smoke complete'), 'real OMP local-provider turn');
  submit('/share');
  await waitFor(() => importedHtml, 'native /share hook upload');
  const html = importedHtml!.toString('utf8');
  const match = /<script\b(?=[^>]*\bid=["']session-data["'])[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  assert.ok(match, 'OMP sends its native HTML with embedded session data');
  const data = record(JSON.parse(Buffer.from(match[1].trim(), 'base64').toString('utf8')) as unknown);
  assert.match(JSON.stringify(data), /native share export smoke complete/);
  assert.equal(typeof data.systemPrompt, 'string');
  assert.ok(Array.isArray(data.tools) && array(data.tools).some(tool => record(tool).name === 'read'), 'live active tool descriptions survive native sharing');
  await waitFor(() => output.includes('/s/native-smoke'), 'share result displayed in OMP');

  // The same emitted hook also preserves bytes and HTTP failure semantics.
  const savedUrl = process.env.PI_DISH_URL;
  process.env.PI_DISH_URL = base;
  try {
    const { default: share }: typeof ShareHook = await import(pathToFileURL(hook).href);
    const snapshot = Buffer.from('\ufeff<!doctype html><title>Native bytes: λ</title>\r\n');
    const file = path.join(root, 'snapshot.html');
    fs.writeFileSync(file, snapshot);
    assert.deepEqual(await share(file), { url: `${base}/s/native-smoke`, message: 'Shared through pi-dish' });
    assert.deepEqual(importedHtml, snapshot);
    importReply = { status: 200, body: { url: `${base}/s/absolute` } };
    assert.equal((await share(file)).url, `${base}/s/absolute`);
    importReply = { status: 403, body: { error: 'native smoke rejected' } };
    await assert.rejects(share(file), /native smoke rejected/);
    importReply = { status: 502, body: {} };
    await assert.rejects(share(file), /502/);
    delete process.env.PI_DISH_URL;
    await assert.rejects(share(file), /PI_DISH_URL is not set/);
  } finally {
    if (savedUrl === undefined) delete process.env.PI_DISH_URL;
    else process.env.PI_DISH_URL = savedUrl;
  }
  console.log('PASS share: real OMP /share, installed ESM hook, native snapshot, byte preservation, URL fallback and HTTP errors');
}

// Regression for the bridged-dialog dismissal defect: answering an OMP
// ask/select through the pi-dish bridge used to leave the TUI dialog on
// screen, blocking the composer for anyone attached to the terminal. The
// bridge now injects an AbortSignal into the local dialog call and aborts it
// when the remote answer wins, so OMP tears the component down itself.
async function dialogsSmoke() {
  const omp = process.env.PI_DISH_REAL_OMP_BIN;
  if (!omp || !path.isAbsolute(omp)) throw new Error('PI_DISH_REAL_OMP_BIN must name an absolute real OMP executable');
  fs.accessSync(omp, fs.constants.X_OK);
  const agent = path.join(home, '.omp', 'agent');
  fs.mkdirSync(agent, { recursive: true });
  execFileSync(omp, ['config', 'set', 'startup.setupWizard', 'false'], { env, cwd: work, stdio: 'pipe' });
  execFileSync(omp, ['config', 'set', 'startup.checkUpdate', 'false'], { env, cwd: work, stdio: 'pipe' });
  fs.writeFileSync(path.join(agent, 'models.yml'), [
    'providers:', '  openai:', '    apiKey: local-smoke-key', '',
  ].join('\n'));
  const socks = path.join(root, 'socks');
  fs.mkdirSync(socks, { recursive: true, mode: 0o700 });
  env.PI_DISH_SOCKET_DIR = socks;
  const trigger = path.join(root, 'dialog-trigger.ts');
  fs.writeFileSync(trigger, `export default function (pi) {
  pi.registerCommand("asktest", {
    description: "trigger the native ask dialog",
    handler: async (_args, ctx) => {
      const res = await ctx.ui.askDialog([
        { id: "q1", question: "NATIVE_ASK_DISMISS pick one", options: [{ label: "Alpha" }, { label: "Beta" }] },
      ]);
      ctx.ui.notify("NATIVE_ASK_RESOLVED " + JSON.stringify(res), "info");
    },
  });
  pi.registerCommand("selecttest", {
    description: "trigger a select dialog",
    handler: async (_args, ctx) => {
      const res = await ctx.ui.select("NATIVE_SELECT_DISMISS pick one", ["Gamma", "Delta"]);
      ctx.ui.notify("NATIVE_SELECT_RESOLVED " + JSON.stringify(res), "info");
    },
  });
}
`);
  start(omp, ['--no-extensions', '--no-skills', '--no-rules', '--model', 'openai/gpt-4o-mini',
    '--extension', path.join(repo, 'extensions', 'pi-dish-bridge-omp', 'index.ts'),
    '--extension', trigger]);
  await waitFor(() => /gpt.?4o.?mini/i.test(output), 'OMP native TUI startup');
  let registryFile: string | undefined;
  await waitFor(() => {
    const dir = path.join(home, '.pi', 'dish', 'sessions');
    if (!fs.existsSync(dir)) return false;
    const entry = fs.readdirSync(dir).find(name => name.startsWith('omp-') && name.endsWith('.json'));
    registryFile = entry ? path.join(dir, entry) : undefined;
    return !!registryFile;
  }, 'bridge registry entry');
  const socketPath = String(record(JSON.parse(fs.readFileSync(registryFile!, 'utf8')) as unknown).socketPath);
  const sock = net.connect(socketPath);
  await new Promise<void>(resolve => sock.once('connect', resolve));
  let buffer = '';
  const messages: unknown[] = [];
  sock.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim()) messages.push(JSON.parse(line));
    }
  });
  const waitMessage = async (predicate: (message: Record<string, unknown>) => unknown, label: string) => {
    let found: unknown;
    await waitFor(() => {
      found = messages.find(candidate => predicate(record(candidate)));
      return !!found;
    }, label);
    return record(found);
  };
  const isDialogRequest = (message: Record<string, unknown>, method: string) =>
    message.type === 'event' && message.event === 'extension_ui_request' && record(message.data).method === method;
  await waitMessage(message => message.type === 'hello', 'bridge hello');

  // A remote answer to the native ask dialog dismisses the TUI component.
  submit('/asktest');
  const askRequest = await waitMessage(message => isDialogRequest(message, 'ask'), 'bridged ask request');
  const askId = String(record(askRequest.data).id);
  await waitFor(() => output.includes('NATIVE_ASK_DISMISS'), 'ask dialog rendered by the TUI');
  output = '';
  sock.write(JSON.stringify({ id: 1, command: 'extension_ui_response', requestId: askId,
    value: { kind: 'submit', results: [{ id: 'q1', selectedOptions: ['Alpha'] }] } }) + '\n');
  await waitFor(() => output.includes('NATIVE_ASK_RESOLVED'), 'remote ask answer delivered');
  assert.ok(!output.includes('NATIVE_ASK_DISMISS'), 'remote ask answer dismisses the TUI dialog');

  // Same for an extension select dialog.
  submit('/selecttest');
  const selectRequest = await waitMessage(message => isDialogRequest(message, 'select'), 'bridged select request');
  const selectId = String(record(selectRequest.data).id);
  await waitFor(() => output.includes('NATIVE_SELECT_DISMISS'), 'select dialog rendered by the TUI');
  output = '';
  sock.write(JSON.stringify({ id: 2, command: 'extension_ui_response', requestId: selectId, value: 'Gamma' }) + '\n');
  await waitFor(() => output.includes('NATIVE_SELECT_RESOLVED'), 'remote select answer delivered');
  assert.ok(!output.includes('NATIVE_SELECT_DISMISS'), 'remote select answer dismisses the TUI dialog');

  // The local TUI still wins the race when the terminal user answers first.
  submit('/selecttest');
  const localRequest = await waitMessage(message =>
    isDialogRequest(message, 'select') && record(message.data).id !== selectId, 'second bridged select request');
  const localId = String(record(localRequest.data).id);
  await waitFor(() => output.includes('NATIVE_SELECT_DISMISS'), 'second select dialog rendered by the TUI');
  terminal!.write('\r');
  await waitMessage(message => message.type === 'event' && message.event === 'extension_ui_resolved'
    && record(message.data).id === localId && record(message.data).source === 'tui', 'local answer wins the race');
  await waitFor(() => output.includes('NATIVE_SELECT_RESOLVED'), 'local select answer delivered');
  sock.end();
  console.log('PASS dialogs: remote bridge answers dismiss the OMP TUI ask/select dialog; local TUI answers still win');
}

(async () => {
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (selection === 'mood') await moodSmoke(base);
    else if (selection === 'dialogs') await dialogsSmoke();
  } finally {
    if (terminal && !exited) {
      terminal.kill('SIGTERM');
      const deadline = Date.now() + 5000;
      while (!exited && Date.now() < deadline) await sleep(25);
      if (!exited) terminal.kill('SIGKILL');
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error: unknown) => {
  console.error(record(error).stack || error);
  process.exitCode = 1;
});
