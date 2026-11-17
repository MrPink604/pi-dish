/**
 * Integration test for the Antigravity (`agy`) harness: the real server routes
 * drive a fake `agy acp` ACP agent over stdio, selected by PI_DISH_AGY_COMMAND.
 *
 * Covers the wiring contract, not the transport's own units (test/acp-session
 * covers handshake, segmentation and the mirror): harness listing gated on the
 * binary, POST /api/sessions/new, the SSE stream, a prompt turn, the Pi-format
 * mirror read through /api/sessions/:id/messages, close and resume.
 *
 * Run with: npm test
 */
import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import type { Server } from 'node:http';
import { present, record, records } from './test-types.js';
import { sseReader } from './sse-reader.js';

// HOME must be set before any server/lib module resolves dishDir() or a harness root.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-agy-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.TMUX_TMPDIR = path.join(tmpHome, 'tmux');
// Never attach to a resident Prime daemon; agy never looks at this socket.
process.env.PRIME_AGENT_DAEMON_SOCKET = path.join(tmpHome, 'no-prime-daemon.sock');
const fixture = path.join(__dirname, 'fixtures', 'fake-agy-acp.js');
const agyCommand = `${process.execPath} ${fixture}`;
process.env.PI_DISH_AGY_COMMAND = agyCommand;
const projDir = path.join(tmpHome, 'proj');
fs.mkdirSync(projDir, { recursive: true });

const server: Server = require('../server.js');

let base = '';

const get = async (requestPath: string) => {
  const response = await fetch(base + requestPath);
  return { status: response.status, body: record(await response.json()) };
};
const post = async (requestPath: string, body: unknown) => {
  const response = await fetch(base + requestPath, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return { status: response.status, body: record(await response.json().catch(() => ({}))) };
};
const sessionPath = (id: string, suffix: string) => `/api/sessions/${encodeURIComponent(id)}${suffix}`;
const messageText = (message: unknown): string => records(record(message).content)
  .filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('');

test.before(async () => {
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server lacks a TCP address');
  base = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  // Session-index flushes are timer-backed and can finish just after the listener closes.
  fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test('/api/harnesses lists Antigravity only when agy resolves', async () => {
  const saved = process.env.PI_DISH_AGY_COMMAND;
  process.env.PI_DISH_AGY_COMMAND = path.join(tmpHome, 'missing', 'agy');
  try {
    const { body } = await get('/api/harnesses');
    const ids = records(body.harnesses).map(row => record(row).id);
    assert.ok(ids.includes('pi'), 'the Pi lineage stays listed');
    assert.ok(!ids.includes('agy'), 'an unresolved agy must not be offered');
  } finally {
    process.env.PI_DISH_AGY_COMMAND = saved;
  }
  const { body } = await get('/api/harnesses');
  const agy = records(body.harnesses).map(row => record(row)).find(row => row.id === 'agy');
  const row = record(present(agy, 'agy appears once its command resolves'));
  assert.equal(row.available, true);
  assert.equal(row.closeMode, 'owned-agent');
});

test('agy session: new, streamed turn, mirror read, close, resume', { timeout: 60000 }, async () => {
  const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const sessionId = String(present(created.body.id));

  const listed = await get('/api/sessions?active=1');
  const active = records(listed.body.active).map(row => record(row)).find(row => row.id === sessionId);
  const row = record(present(active, 'the agy route is an active catalog row'));
  assert.equal(row.harnessId, 'agy');
  assert.equal(row.harnessLabel, 'Antigravity');
  assert.equal(row.closeMode, 'owned-agent');
  assert.equal(row.isActive, true);
  assert.equal(record(row.capabilities).prompt, true);
  assert.equal(record(row.capabilities).close, true);
  assert.equal(record(row.capabilities).rename, false, 'ACP has no rename method');
  assert.equal(record(row.capabilities).compact, false, 'compaction is not a pi-dish capability');

  const stream = sseReader(`${base}${sessionPath(sessionId, '/stream')}`);
  try {
    await stream.waitFor(event => event.event === 'init', 10000);
    const prompted = await post(sessionPath(sessionId, '/prompt'), { message: 'hello antigravity' });
    assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
    const end = await stream.waitFor(
      event => event.event === 'message_end' && record(record(event.data).message).role === 'assistant', 20000);
    const text = messageText(record(end.data).message);
    assert.ok(text.length > 0, 'the assistant turn streams text');
    await stream.waitFor(event => event.event === 'turn_end', 20000);
  } finally {
    stream.close();
  }

  const messages = await get(sessionPath(sessionId, '/messages'));
  assert.equal(messages.status, 200, JSON.stringify(messages.body));
  const history = records(messages.body.messages).map(message => record(message));
  const user = history.find(message => message.role === 'user');
  assert.equal(messageText(present(user)), 'hello antigravity');
  const assistant = history.filter(message => message.role === 'assistant').pop();
  assert.ok(messageText(present(assistant)).length > 0);

  // The mirror is a Pi-format JSONL beside its raw ACP sidecar, not agy's store.
  const mirrorRoot = path.join(tmpHome, '.pi', 'dish', 'agy', 'sessions');
  const mirrors = fs.readdirSync(mirrorRoot).filter(name => name.endsWith('.jsonl') && !name.endsWith('.acp.jsonl'));
  assert.equal(mirrors.length, 1, 'one owned session writes one mirror');
  const header = record(JSON.parse(fs.readFileSync(path.join(mirrorRoot, mirrors[0]), 'utf8').split('\n')[0]));
  assert.equal(header.type, 'session');
  assert.equal(path.resolve(String(header.cwd)), path.resolve(projDir));

  // The raw `<id>.acp.jsonl` sidecar beside the mirror must never surface as a
  // second, headerless agy session.
  const everything = await get('/api/sessions');
  const agyRows = [...records(everything.body.active), ...records(everything.body.previous)]
    .map(row => record(row)).filter(row => row.harnessId === 'agy');
  assert.equal(agyRows.length, 1);

  const closed = await post(sessionPath(sessionId, '/close'), {});
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.success, true);

  const resumed = await post(sessionPath(sessionId, '/resume'), {});
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.id, sessionId);
  assert.equal(resumed.body.alreadyActive, undefined, 'a resumed mirror spawns a live child');

  const reopened = await get(sessionPath(sessionId, '/stats'));
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  const runtime = record(reopened.body.runtime);
  assert.equal(runtime.kind, 'rpc');
  assert.equal(typeof runtime.pid, 'number');

  const reclosed = await post(sessionPath(sessionId, '/close'), {});
  assert.equal(reclosed.status, 200, JSON.stringify(reclosed.body));

  // Deleting the transcript also removes its raw sidecar, which is not a
  // session of its own and would otherwise be orphaned.
  const sidecar = path.join(mirrorRoot, mirrors[0].replace(/\.jsonl$/, '.acp.jsonl'));
  assert.ok(fs.existsSync(sidecar), 'the live session wrote its raw sidecar');
  const deleted = await fetch(base + sessionPath(sessionId, ''), { method: 'DELETE' });
  assert.equal(deleted.status, 200, await deleted.text());
  assert.deepEqual(fs.readdirSync(mirrorRoot).filter(name => name.startsWith(mirrors[0].replace(/\.jsonl$/, ''))), []);
});

test('agy sessions refuse capabilities the ACP transport does not carry', async () => {
  const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const sessionId = String(present(created.body.id));
  try {
    const renamed = await post(sessionPath(sessionId, '/rename'), { name: 'nope' });
    assert.equal(renamed.status, 409);
    assert.match(String(renamed.body.error), /does not support renaming/);

    const tree = await get(sessionPath(sessionId, '/tree'));
    assert.equal(tree.status, 409);
    assert.match(String(tree.body.error), /Antigravity/);

    const branch = await post(sessionPath(sessionId, '/branch'), { entryId: 'entry' });
    assert.equal(branch.status, 409);
    assert.match(String(branch.body.error), /Antigravity/);

    const followUp = await post(sessionPath(sessionId, '/follow-up'), { message: 'later' });
    assert.equal(followUp.status, 409);
    assert.match(String(followUp.body.error), /follow-ups/);

    const exported = await get(sessionPath(sessionId, '/export'));
    assert.equal(exported.status, 409);

    const named = await post('/api/sessions/new', { harness: 'agy', cwd: projDir, name: 'named' });
    assert.equal(named.status, 400);
    assert.match(String(named.body.error), /does not support naming/);

    const slash = await post(sessionPath(sessionId, '/command'), { message: '/definitely-not-a-command' });
    assert.equal(slash.status, 400);
    assert.match(String(slash.body.error), /unknown or unsupported command/);
  } finally {
    const closed = await post(sessionPath(sessionId, '/close'), {});
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
  }
});
