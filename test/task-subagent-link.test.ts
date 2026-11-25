/**
 * End-to-end API tests for OMP `task` tool → subagent transcript mapping:
 * - persisted messages: parallel calls, multi-subagent batch, async spawns,
 *   provider-normalized IDs (`call_X` <-> `call_X|fc_Y`), reused IDs across turns,
 *   ambiguous duplicate call/result fail-closed, untrusted persisted route stripping,
 *   and page-scoped filesystem work (off-page invocations untouched)
 * - live SSE tool events: parallel tasks, forged route stripping, text-only old-bridge
 *   degrading to no link
 * - single-snapshot `/api/sessions/resolve` + `/api/sessions/resolve-batch` under
 *   `PI_DISH_INDEX_SYNC_BUDGET=0`: lightweight rows with zero synchronous getSessionInfo,
 *   single root walk per batch, and full route returned while indexing is queued.
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import type { Server } from 'node:http';
import net = require('node:net');
import os = require('node:os');
import path = require('node:path');
import { nativeId as checkedNativeId, record } from './test-types.js';
import { sseReader } from './sse-reader.js';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-task-link-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.PI_DISH_INDEX_SYNC_BUDGET = '0';
for (const key of ['PI_DISH_URL', 'PI_DISH_SHARE_PORT', 'PI_DISH_SHARE_HOST',
  'PI_DISH_SHARE_BASE_URL', 'PI_DISH_TERMINAL']) delete process.env[key];
process.env.PRIME_AGENT_DAEMON_SOCKET = path.join(tmpHome, 'no-prime-daemon.sock');
process.env.PI_DISH_AGY_COMMAND = path.join(tmpHome, 'no-agy');
process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${path.join(__dirname, 'fixtures', 'fake-omp-export.js')}`;
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-task-link-tmux-'));

const { encodeSessionKey }: typeof import('../lib/session-key') = require('../lib/session-key');
const { processIdentity }: typeof import('../lib/process-identity') = require('../lib/process-identity');
const { pairTaskCallsInMemory }: typeof import('../lib/session-read-handlers') = require('../lib/session-read-handlers');

const ompWorkspace = path.join(tmpHome, '.omp', 'agent', 'sessions', '--home-user-proj--');
const piWorkspace = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-proj--');

const PARENT_NATIVE = '2026-11-25T01-00-00-000Z_01a20000-0000-7000-8000-000000000000';
const CLOSED_PARENT_NATIVE = '2026-11-25T00-50-00-000Z_01a20000-0000-7000-8000-000000000099';
const UNRELATED_NATIVE = '2026-11-25T00-40-00-000Z_01a20000-0000-7000-8000-000000000088';
const SUB_A_NATIVE = '2026-11-25T01-00-05-000Z_01a20001-0000-7000-8000-000000000001';
const SUB_B_NATIVE = '2026-11-25T01-00-06-000Z_01a20002-0000-7000-8000-000000000002';
const SUB_BG_NATIVE = '2026-11-25T01-00-07-000Z_01a20003-0000-7000-8000-000000000003';
const SUB_LIVE_NATIVE = '2026-11-25T01-00-08-000Z_01a20004-0000-7000-8000-000000000004';
const SUB_OFFPAGE_NATIVE = '2026-11-25T01-00-09-000Z_01a20005-0000-7000-8000-000000000005';
const SUB_DEFERRED_NATIVE = '2026-11-25T00-51-00-000Z_01a20006-0000-7000-8000-000000000006';
const SUB_DEFERRED_SIBLING_NATIVE = '2026-11-25T00-52-00-000Z_01a20006-1111-7000-8000-000000000009';
const PI_FORGED_ID = '2026-11-25T01-00-00-pi-forged';

const PARENT_ROUTE = encodeSessionKey('omp', checkedNativeId(PARENT_NATIVE));
const UNRELATED_ROUTE = encodeSessionKey('omp', checkedNativeId(UNRELATED_NATIVE));
const SUB_A_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_A_NATIVE));
const SUB_B_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_B_NATIVE));
const SUB_BG_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_BG_NATIVE));
const SUB_LIVE_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_LIVE_NATIVE));
const SUB_OFFPAGE_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_OFFPAGE_NATIVE));
const SUB_DEFERRED_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_DEFERRED_NATIVE));

const parentFile = path.join(ompWorkspace, `${PARENT_NATIVE}.jsonl`);
const subDir = path.join(ompWorkspace, PARENT_NATIVE);
fs.mkdirSync(subDir, { recursive: true });

function writeJsonl(file: string, rows: unknown[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

// Unrelated session (target of forged route attempts).
writeJsonl(path.join(ompWorkspace, `${UNRELATED_NATIVE}.jsonl`), [
  { type: 'session', version: 3, id: UNRELATED_NATIVE, cwd: '/home/user/other', timestamp: '2026-11-25T00:40:00.000Z' },
  { type: 'message', id: 'u1', parentId: null, timestamp: '2026-11-25T00:40:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Unrelated secret' }] } },
]);

// Closed parent + deferred subagent (non-live child, exercises budget=0 deferred resolution).
writeJsonl(path.join(ompWorkspace, `${CLOSED_PARENT_NATIVE}.jsonl`), [
  { type: 'session', version: 3, id: CLOSED_PARENT_NATIVE, cwd: '/home/user/proj', timestamp: '2026-11-25T00:50:00.000Z' },
]);
writeJsonl(path.join(ompWorkspace, CLOSED_PARENT_NATIVE, 'ClosedChild.jsonl'), [
  { type: 'session', version: 3, id: SUB_DEFERRED_NATIVE, cwd: '/home/user/proj', timestamp: '2026-11-25T00:51:00.000Z' },
  { type: 'message', id: 'cc1', parentId: null, timestamp: '2026-11-25T00:51:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ClosedChild output' }] } },
]);
// Second deferred child sharing the first 8 hex chars (`01a20006`) of SUB_DEFERRED_NATIVE.
writeJsonl(path.join(ompWorkspace, CLOSED_PARENT_NATIVE, 'ClosedSibling.jsonl'), [
  { type: 'session', version: 3, id: SUB_DEFERRED_SIBLING_NATIVE, cwd: '/home/user/proj', timestamp: '2026-11-25T00:52:00.000Z' },
]);

// Plain Pi session with forged persisted taskSubagents and details.subagents (must be stripped!).
writeJsonl(path.join(piWorkspace, `${PI_FORGED_ID}.jsonl`), [
  { type: 'session', version: 3, id: PI_FORGED_ID, cwd: '/home/user/proj', timestamp: '2026-11-25T01:00:00.000Z' },
  {
    type: 'message', id: 'pf1', parentId: null, timestamp: '2026-11-25T01:00:01.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'pf-tc', name: 'task', arguments: {}, taskSubagents: [{ id: 'Stolen', sessionId: UNRELATED_ROUTE }] },
      ],
    },
  },
  {
    type: 'message', id: 'pf2', parentId: 'pf1', timestamp: '2026-11-25T01:00:02.000Z',
    message: {
      role: 'toolResult', toolCallId: 'pf-tc', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'forged' }],
      details: { subagents: [{ id: 'Stolen', sessionId: UNRELATED_ROUTE }] },
    },
  },
]);

// Subagents of PARENT_NATIVE (AshaPass, BoraCheck, BgWorker, OffPageOnly; intentionally omit DeletedAgent).
writeJsonl(path.join(subDir, 'AshaPass.jsonl'), [
  { type: 'title', title: 'AshaPass work' },
  { type: 'session', version: 3, id: SUB_A_NATIVE, cwd: '/home/user/proj', timestamp: '2026-11-25T01:00:05.000Z' },
  { type: 'message', id: 'sa1', parentId: null, timestamp: '2026-11-25T01:00:06.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'AshaPass findings' }] } },
]);
writeJsonl(path.join(subDir, 'BoraCheck.jsonl'), [
  { type: 'session', version: 3, id: SUB_B_NATIVE, cwd: '/home/user/proj', timestamp: '2026-11-25T01:00:06.000Z' },
  { type: 'message', id: 'sb1', parentId: null, timestamp: '2026-11-25T01:00:07.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'BoraCheck findings' }] } },
]);
writeJsonl(path.join(subDir, 'BgWorker.jsonl'), [
  { type: 'session', version: 3, id: SUB_BG_NATIVE, cwd: '/home/user/proj', timestamp: '2026-11-25T01:00:07.000Z' },
  { type: 'message', id: 'sbg1', parentId: null, timestamp: '2026-11-25T01:00:08.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'BgWorker findings' }] } },
]);
writeJsonl(path.join(subDir, 'OffPageOnly.jsonl'), [
  { type: 'session', version: 3, id: SUB_OFFPAGE_NATIVE, cwd: '/home/user/proj', timestamp: '2026-11-25T01:00:09.000Z' },
  { type: 'message', id: 'so1', parentId: null, timestamp: '2026-11-25T01:00:10.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'OffPageOnly findings' }] } },
]);

// Parent OMP session with:
// - Turn 0 (idx 0-2): off-page task referencing OffPageOnly (to verify page-scoped fs resolution)
// - Turn 1 (idx 3-5): two parallel task calls (tc-1 -> AshaPass, tc-2 -> BoraCheck), tc-2 finishes first
// - Turn 2 (idx 6-7): provider-normalized ID (`call_norm` on call, `call_norm|fc_999` on result -> AshaPass)
// - Turn 3 (idx 8-9): REUSED ID (`tc-1` reused in a later turn -> BoraCheck; must NOT relink Turn 1's tc-1!)
// - Turn 4 (idx 10-12): AMBIGUOUS duplicate open call IDs (`tc-dup` twice -> neither call links; results keep own details)
// - Turn 5 (idx 13-14): forged raw `taskSubagents` + forged `details.subagents` pointing at UNRELATED_ROUTE (must be stripped!)
// - Turn 6 (idx 15-16): multi-subagent batch (AshaPass + BoraCheck + DeletedAgent)
// - Turn 7 (idx 17-18): async background spawn (BgWorker)
writeJsonl(parentFile, [
  { type: 'session', version: 3, id: PARENT_NATIVE, cwd: '/home/user/proj', timestamp: '2026-11-25T01:00:00.000Z' },
  { type: 'message', id: 'm0', parentId: null, timestamp: '2026-11-25T01:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Off-page task first' }] } },
  {
    type: 'message', id: 'm1', parentId: 'm0', timestamp: '2026-11-25T01:00:02.000Z',
    message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tc-off', name: 'task', arguments: { tasks: [{ id: 'OffPageOnly' }] } }] },
  },
  {
    type: 'message', id: 'm2', parentId: 'm1', timestamp: '2026-11-25T01:00:03.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-off', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'OffPageOnly done' }],
      details: { results: [{ index: 0, id: 'OffPageOnly', agent: 'task', exitCode: 0 }] },
    },
  },
  {
    type: 'message', id: 'm3', parentId: 'm2', timestamp: '2026-11-25T01:00:04.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc-1', name: 'task', arguments: { agent: 'task', tasks: [{ id: 'AshaPass' }] } },
        { type: 'toolCall', id: 'tc-2', name: 'task', arguments: { agent: 'task', tasks: [{ id: 'BoraCheck' }] } },
      ],
    },
  },
  {
    type: 'message', id: 'm4', parentId: 'm3', timestamp: '2026-11-25T01:00:10.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-2', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'BoraCheck done' }],
      details: { results: [{ index: 0, id: 'BoraCheck', agent: 'task', exitCode: 0, durationMs: 1200 }] },
    },
  },
  {
    type: 'message', id: 'm5', parentId: 'm4', timestamp: '2026-11-25T01:00:12.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-1', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'AshaPass done' }],
      details: { results: [{ index: 0, id: 'AshaPass', agent: 'task', exitCode: 0, durationMs: 2400 }] },
    },
  },
  {
    type: 'message', id: 'm6', parentId: 'm5', timestamp: '2026-11-25T01:00:15.000Z',
    message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call_norm', name: 'task', arguments: { tasks: [{ id: 'AshaPass' }] } }] },
  },
  {
    type: 'message', id: 'm7', parentId: 'm6', timestamp: '2026-11-25T01:00:16.000Z',
    message: {
      role: 'toolResult', toolCallId: 'call_norm|fc_999', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'Normalized done' }],
      details: { results: [{ index: 0, id: 'AshaPass', agent: 'task', exitCode: 0 }] },
    },
  },
  {
    type: 'message', id: 'm8', parentId: 'm7', timestamp: '2026-11-25T01:00:17.000Z',
    message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tc-1', name: 'task', arguments: { tasks: [{ id: 'BoraCheck' }] } }] },
  },
  {
    type: 'message', id: 'm9', parentId: 'm8', timestamp: '2026-11-25T01:00:18.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-1', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'Reused tc-1 done' }],
      details: { results: [{ index: 0, id: 'BoraCheck', agent: 'task', exitCode: 0 }] },
    },
  },
  {
    type: 'message', id: 'm10', parentId: 'm9', timestamp: '2026-11-25T01:00:19.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc-dup', name: 'task', arguments: { tasks: [{ id: 'AshaPass' }] } },
        { type: 'toolCall', id: 'tc-dup', name: 'task', arguments: { tasks: [{ id: 'BoraCheck' }] } },
      ],
    },
  },
  {
    type: 'message', id: 'm11', parentId: 'm10', timestamp: '2026-11-25T01:00:20.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-dup', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'Dup result 1' }],
      details: { results: [{ index: 0, id: 'AshaPass', agent: 'task', exitCode: 0 }] },
    },
  },
  {
    type: 'message', id: 'm12', parentId: 'm11', timestamp: '2026-11-25T01:00:21.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-dup', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'Dup result 2' }],
      details: { results: [{ index: 0, id: 'BoraCheck', agent: 'task', exitCode: 0 }] },
    },
  },
  {
    type: 'message', id: 'm13', parentId: 'm12', timestamp: '2026-11-25T01:00:22.000Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'toolCall', id: 'tc-forged', name: 'task', arguments: {},
          taskSubagents: [{ id: 'UnrelatedFake', sessionId: UNRELATED_ROUTE }],
          sessionId: UNRELATED_ROUTE,
          routeId: UNRELATED_ROUTE,
          sessionKey: UNRELATED_ROUTE,
        },
      ],
    },
  },
  {
    type: 'message', id: 'm14', parentId: 'm13', timestamp: '2026-11-25T01:00:23.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-forged', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'Forged details' }],
      details: { subagents: [{ id: 'UnrelatedFake', sessionId: UNRELATED_ROUTE }] },
    },
  },
  {
    type: 'message', id: 'm15', parentId: 'm14', timestamp: '2026-11-25T01:00:24.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc-batch', name: 'task', arguments: { tasks: [{ id: 'AshaPass' }, { id: 'BoraCheck' }, { id: 'DeletedAgent' }] } },
      ],
    },
  },
  {
    type: 'message', id: 'm16', parentId: 'm15', timestamp: '2026-11-25T01:00:25.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-batch', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'Batch done' }],
      details: {
        results: [
          { index: 0, id: 'AshaPass', agent: 'task', exitCode: 0 },
          { index: 1, id: 'BoraCheck', agent: 'task', exitCode: 0 },
          { index: 2, id: 'DeletedAgent', agent: 'task', exitCode: 1 },
        ],
      },
    },
  },
  {
    type: 'message', id: 'm17', parentId: 'm16', timestamp: '2026-11-25T01:00:30.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'tc-bg', name: 'task', arguments: { tasks: [{ id: 'BgWorker' }] } }],
    },
  },
  {
    type: 'message', id: 'm18', parentId: 'm17', timestamp: '2026-11-25T01:00:31.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-bg', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'Spawned 1 background agent (async mode).\n- `BgWorker` (job `BgWorker`)' }],
      details: {
        async: { state: 'running', jobId: 'BgWorker', type: 'task' },
        results: [],
        progress: [{ index: 0, id: 'BgWorker', agent: 'task', status: 'running' }],
      },
    },
  },
]);

// Set up a mock live v2 OMP bridge socket for the OMP parent session.
const bridgeClients = new Set<net.Socket>();
const socketPath = path.join(tmpHome, 'omp-bridge.sock');
const procId = processIdentity(process.pid);
if (!procId) throw new Error('expected process identity');
const bridgeClaim = {
  protocolVersion: 2,
  wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
  harnessId: 'omp',
  nativeSessionId: PARENT_NATIVE,
  sessionId: PARENT_NATIVE,
  bridgeInstanceId: PARENT_NATIVE,
  instanceId: PARENT_NATIVE,
  sessionFile: parentFile,
  socketPath,
  cwd: '/home/user/proj',
  name: 'OMP Parent',
  pid: procId.pid,
  startTime: procId.startTime,
  spawnToken: null,
  capabilities: {},
};
const bridgeServer = net.createServer(socket => {
  bridgeClients.add(socket);
  socket.on('close', () => bridgeClients.delete(socket));
  socket.on('error', () => bridgeClients.delete(socket));
  socket.write(JSON.stringify({ type: 'hello', ...bridgeClaim, turnInProgress: true, queue: { steering: [], followUp: [] } }) + '\n');
  let buf = '';
  socket.on('data', chunk => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, nl)) as { id?: string };
      buf = buf.slice(nl + 1);
      socket.write(JSON.stringify({ type: 'response', id: msg.id, success: true, data: {} }) + '\n');
    }
  });
});

let server: Server | undefined;
let baseUrl = '';

test.before(async () => {
  await new Promise<void>(resolve => bridgeServer.listen(socketPath, resolve));
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(registryDir, `${PARENT_NATIVE}.json`), JSON.stringify(bridgeClaim));
  server = require('../server');
  if (!server!.listening) await new Promise<void>(resolve => server!.once('listening', resolve));
  const addr = server!.address();
  if (!addr || typeof addr === 'string') throw new Error('expected TCP address');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  for (const sock of bridgeClients) sock.destroy();
  bridgeServer.close();
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server!.close(() => resolve()));
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (process.env.TMUX_TMPDIR) fs.rmSync(process.env.TMUX_TMPDIR, { recursive: true, force: true });
});

function emitBridge(event: string, data: unknown) {
  const line = JSON.stringify({ type: 'event', event, data }) + '\n';
  for (const sock of bridgeClients) sock.write(line);
}

test('pairTaskCallsInMemory pairs normalized IDs, isolates reused IDs, and fails closed on ambiguity', () => {
  const pairs = pairTaskCallsInMemory([
    // Call with suffixed ID paired to bare result
    { role: 'assistant', content: [{ type: 'toolCall', id: 'call_rev|fc_1', name: 'task', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'call_rev', toolName: 'task', content: [] },
    // Ambiguous normalized prefix (two open suffixed calls, bare result) -> fail closed
    { role: 'assistant', content: [
      { type: 'toolCall', id: 'call_amb|fc_a', name: 'task', arguments: {} },
      { type: 'toolCall', id: 'call_amb|fc_b', name: 'task', arguments: {} },
    ] },
    { role: 'toolResult', toolCallId: 'call_amb', toolName: 'task', content: [] },
    // Duplicate second toolResult for one call -> invalidates pair (fail closed)
    { role: 'assistant', content: [{ type: 'toolCall', id: 'call_two_res', name: 'task', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'call_two_res', toolName: 'task', content: [] },
    { role: 'toolResult', toolCallId: 'call_two_res', toolName: 'task', content: [] },
    // Two distinct suffixes pending + duplicate B result -> A's card gets NO B child
    { role: 'assistant', content: [
      { type: 'toolCall', id: 'call_X|fc_A', name: 'task', arguments: {} },
      { type: 'toolCall', id: 'call_X|fc_B', name: 'task', arguments: {} },
    ] },
    { role: 'toolResult', toolCallId: 'call_X|fc_B', toolName: 'task', content: [] },
    { role: 'toolResult', toolCallId: 'call_X|fc_B', toolName: 'task', content: [] },
    // Distinct suffixes never match each other even with a single pending call
    { role: 'assistant', content: [{ type: 'toolCall', id: 'call_Z|fc_1', name: 'task', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'call_Z|fc_2', toolName: 'task', content: [] },
  ]);
  assert.equal(pairs.get('0:0'), 1, 'suffixed call pairs with bare result');
  assert.equal(pairs.has('2:0'), false, 'ambiguous normalized calls fail closed');
  assert.equal(pairs.has('2:1'), false, 'ambiguous normalized calls fail closed');
  assert.equal(pairs.has('4:0'), false, 'duplicate toolResults invalidate pair');
  assert.equal(pairs.has('7:0'), false, 'call_X|fc_A never receives duplicate call_X|fc_B result');
  assert.equal(pairs.has('7:1'), false, 'duplicate call_X|fc_B invalidates B pair');
  assert.equal(pairs.has('10:0'), false, 'different suffixes never match');
});

test('GET /api/sessions/:id/messages handles pairing, normalization, reuse, ambiguity, forged route stripping, and page-scoped FS work', async t => {
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(PARENT_ROUTE)}/messages?limit=50`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { messages: Array<Record<string, unknown>> };

  // Turn 1: parallel calls (tc-1 -> AshaPass, tc-2 -> BoraCheck), NOT overwritten by Turn 3's reused tc-1!
  const m3 = body.messages.find(m => m.id === 'm3')!;
  const m3Blocks = m3.content as Array<Record<string, unknown>>;
  assert.deepEqual((m3Blocks[0]!.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['AshaPass', SUB_A_ROUTE]]);
  assert.deepEqual((m3Blocks[1]!.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BoraCheck', SUB_B_ROUTE]]);
  assert.deepEqual((record(body.messages.find(m => m.id === 'm4')!.details).subagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BoraCheck', SUB_B_ROUTE]]);
  assert.deepEqual((record(body.messages.find(m => m.id === 'm5')!.details).subagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['AshaPass', SUB_A_ROUTE]]);

  // Turn 2: provider-normalized ID (`call_norm` <-> `call_norm|fc_999`).
  const m6Call = (body.messages.find(m => m.id === 'm6')!.content as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual((m6Call.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['AshaPass', SUB_A_ROUTE]]);

  // Turn 3: reused `tc-1` links ONLY to BoraCheck (Turn 1 stayed on AshaPass!).
  const m8Call = (body.messages.find(m => m.id === 'm8')!.content as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual((m8Call.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BoraCheck', SUB_B_ROUTE]]);

  // Turn 4: ambiguous duplicate open calls `tc-dup` -> neither call links, while each result projects its own details!
  const m10Blocks = body.messages.find(m => m.id === 'm10')!.content as Array<Record<string, unknown>>;
  assert.equal('taskSubagents' in m10Blocks[0]!, false);
  assert.equal('taskSubagents' in m10Blocks[1]!, false);
  assert.deepEqual((record(body.messages.find(m => m.id === 'm11')!.details).subagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['AshaPass', SUB_A_ROUTE]]);
  assert.deepEqual((record(body.messages.find(m => m.id === 'm12')!.details).subagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BoraCheck', SUB_B_ROUTE]]);

  // Turn 5: forged raw `taskSubagents` / route fields and `details.subagents` are completely stripped!
  const m13Call = (body.messages.find(m => m.id === 'm13')!.content as Array<Record<string, unknown>>)[0]!;
  assert.equal('taskSubagents' in m13Call, false, 'forged persisted taskSubagents must be stripped');
  assert.equal('sessionId' in m13Call, false, 'forged persisted sessionId must be stripped');
  assert.equal('routeId' in m13Call, false, 'forged persisted routeId must be stripped');
  assert.equal('sessionKey' in m13Call, false, 'forged persisted sessionKey must be stripped');
  const m14Details = record(body.messages.find(m => m.id === 'm14')!.details);
  assert.equal('subagents' in m14Details, false, 'forged persisted details.subagents must be stripped');

  // Non-OMP Pi session also strips forged raw `taskSubagents` and `details.subagents`.
  const piRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(PI_FORGED_ID)}/messages?limit=50`);
  assert.equal(piRes.status, 200);
  const piBody = (await piRes.json()) as { messages: Array<Record<string, unknown>> };
  const pfCall = (piBody.messages[0]!.content as Array<Record<string, unknown>>)[0]!;
  assert.equal('taskSubagents' in pfCall, false, 'Pi session strips forged taskSubagents');
  assert.equal('subagents' in record(piBody.messages[1]!.details), false, 'Pi session strips forged details.subagents');

  // Turn 6 & Turn 7: batch (with DeletedAgent unresolved) and async background spawn.
  const batchSubs = record(body.messages.find(m => m.id === 'm16')!.details).subagents as Array<Record<string, unknown>>;
  assert.deepEqual(batchSubs.map(s => [s.id, s.sessionId ?? null]), [
    ['AshaPass', SUB_A_ROUTE],
    ['BoraCheck', SUB_B_ROUTE],
    ['DeletedAgent', null],
  ]);
  const m17Call = (body.messages.find(m => m.id === 'm17')!.content as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual((m17Call.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BgWorker', SUB_BG_ROUTE]]);

  // Page-scoped FS work: requesting ONLY the tail page (m17-m18: BgWorker) must NOT lstat off-page OffPageOnly.jsonl!
  const lstatPaths: string[] = [];
  const origLstat = fs.lstatSync;
  const lstatMock = t.mock.method(fs, 'lstatSync', (p: fs.PathLike, ...rest: unknown[]) => {
    lstatPaths.push(String(p));
    return (origLstat as (...args: unknown[]) => fs.Stats)(p, ...rest);
  });
  try {
    const tailRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(PARENT_ROUTE)}/messages?limit=2`);
    assert.equal(tailRes.status, 200);
    const tailBody = (await tailRes.json()) as { messages: Array<Record<string, unknown>> };
    const tailCall = (tailBody.messages.find(m => m.id === 'm17')!.content as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual((tailCall.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BgWorker', SUB_BG_ROUTE]]);
  } finally {
    lstatMock.mock.restore();
  }
  assert.equal(lstatPaths.some(p => p.endsWith('OffPageOnly.jsonl')), false, 'off-page invocations do no filesystem work');
  assert.equal(lstatPaths.some(p => p.endsWith('AshaPass.jsonl')), false, 'off-page invocations do no filesystem work');

  // Paginated slice containing m1 (OffPageOnly call) WITHOUT m2 (its off-page result) finds partner in memory!
  const offRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(PARENT_ROUTE)}/messages?before=2&limit=2`);
  assert.equal(offRes.status, 200);
  const offBody = (await offRes.json()) as { messages: Array<Record<string, unknown>> };
  const m1Call = (offBody.messages.find(m => m.id === 'm1')!.content as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual((m1Call.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['OffPageOnly', SUB_OFFPAGE_ROUTE]]);

  // Negative after (`after=-2`): clamps startIdx to 0 so projected indices match the selected page (no all[-1] mismatch).
  const negAfterRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(PARENT_ROUTE)}/messages?after=-2`);
  assert.equal(negAfterRes.status, 200);
  const negAfterBody = (await negAfterRes.json()) as { firstIndex: number; messages: Array<Record<string, unknown>> };
  assert.equal(negAfterBody.firstIndex, 0);
  assert.equal(negAfterBody.messages[0]!.id, 'm0');
  const negM1Call = (negAfterBody.messages.find(m => m.id === 'm1')!.content as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual((negM1Call.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['OffPageOnly', SUB_OFFPAGE_ROUTE]]);
  const negM3Blocks = negAfterBody.messages.find(m => m.id === 'm3')!.content as Array<Record<string, unknown>>;
  assert.deepEqual((negM3Blocks[0]!.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['AshaPass', SUB_A_ROUTE]]);
  assert.deepEqual((negM3Blocks[1]!.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BoraCheck', SUB_B_ROUTE]]);
});

test('single-snapshot resolve & resolve-batch respect budget=0 without getSessionInfo, and SSE strips forged routes & text-only updates', async () => {
  // Create a brand-new running subagent file after server boot (PI_DISH_INDEX_SYNC_BUDGET=0).
  const liveFile = path.join(subDir, 'LiveFresh.jsonl');
  writeJsonl(liveFile, [
    { type: 'session', version: 3, id: SUB_LIVE_NATIVE, cwd: '/home/user/proj', timestamp: new Date().toISOString() },
    { type: 'message', id: 'sl1', parentId: null, timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'LiveFresh running' }] } },
  ]);

  // Spy on opendirSync on ompWorkspace AND readFileSync on LiveFresh.jsonl / ClosedChild.jsonl
  // during a batch with 15 unknown refs + LiveFresh + ClosedChild:
  // - At most ONE discovery walk per batch (never per unresolved ref!)
  // - ZERO full-file readFileSync / getSessionInfo parses under budget=0 (lightweight header+stat rows only!)
  const origOpendir = fs.opendirSync;
  const origReadFile = fs.readFileSync;
  let ompRootWalks = 0;
  const fullReads: string[] = [];
  fs.opendirSync = ((p: fs.PathLike, ...rest: unknown[]) => {
    if (String(p) === path.join(tmpHome, '.omp', 'agent', 'sessions')) ompRootWalks += 1;
    return (origOpendir as (...args: unknown[]) => fs.Dir)(p, ...rest);
  }) as typeof fs.opendirSync;
  fs.readFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (typeof p === 'string' && (p.endsWith('LiveFresh.jsonl') || p.endsWith('ClosedChild.jsonl'))) fullReads.push(p);
    return (origReadFile as (...args: unknown[]) => unknown)(p, ...rest);
  }) as typeof fs.readFileSync;

  let batchData: { results: Record<string, { status: string; ref?: string; session?: { id: string; name?: string; subagentLive?: boolean } }> };
  try {
    const unknownIds = Array.from({ length: 15 }, (_, i) => `missing-ref-${String(i).padStart(4, '0')}`);
    const batchRes = await fetch(`${baseUrl}/api/sessions/resolve-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [SUB_LIVE_ROUTE, SUB_DEFERRED_ROUTE, ...unknownIds] }),
    });
    assert.equal(batchRes.status, 200);
    batchData = (await batchRes.json()) as typeof batchData;
  } finally {
    fs.opendirSync = origOpendir;
    fs.readFileSync = origReadFile;
  }

  assert.equal(ompRootWalks, 1, 'resolve-batch runs exactly ONE discovery snapshot even with 15 unresolved refs');
  assert.deepEqual(fullReads, [], 'budget=0 serves lightweight rows without synchronous full-file getSessionInfo');
  assert.equal(batchData.results[SUB_LIVE_ROUTE]?.status, 'ok');
  assert.equal(batchData.results[SUB_LIVE_ROUTE]?.session?.id, SUB_LIVE_ROUTE);
  assert.equal(batchData.results[SUB_LIVE_ROUTE]?.session?.name, 'LiveFresh');
  assert.equal(batchData.results[SUB_LIVE_ROUTE]?.session?.subagentLive, true);
  // Complete discovery shortens refs against ALL indexed + deferred IDs even while indexing is pending!
  assert.equal(batchData.results[SUB_LIVE_ROUTE]?.ref, '01a20004', 'shortens unique live child against complete discovery');
  assert.equal(batchData.results[SUB_DEFERRED_ROUTE]?.status, 'ok');
  assert.equal(batchData.results[SUB_DEFERRED_ROUTE]?.session?.id, SUB_DEFERRED_ROUTE);
  assert.equal(batchData.results[SUB_DEFERRED_ROUTE]?.session?.name, 'ClosedChild');
  const deferredRef = batchData.results[SUB_DEFERRED_ROUTE]?.ref || '';
  assert.equal(deferredRef.startsWith('01a20006-0'), true, 'avoids collision with deferred sibling ClosedSibling');
  assert.equal(deferredRef.length < SUB_DEFERRED_ROUTE.length, true, 'shortens deferred row when discovery is complete');

  // Single GET /api/sessions/resolve on a brand-new file under budget=0 shortens when discovery is complete.
  const SUB_SINGLE_NATIVE = '2026-11-25T01-00-10-000Z_01a20007-0000-7000-8000-000000000007';
  const SUB_SINGLE_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_SINGLE_NATIVE));
  writeJsonl(path.join(subDir, 'SingleFresh.jsonl'), [
    { type: 'session', version: 3, id: SUB_SINGLE_NATIVE, cwd: '/home/user/proj', timestamp: new Date().toISOString() },
    { type: 'message', id: 'ss1', parentId: null, timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'SingleFresh running' }] } },
  ]);
  const singleRes = await fetch(`${baseUrl}/api/sessions/resolve?id=${encodeURIComponent(SUB_SINGLE_ROUTE)}`);
  assert.equal(singleRes.status, 200);
  const singleData = (await singleRes.json()) as { session: { id: string; subagentLive?: boolean }; ref: string };
  assert.equal(singleData.session.id, SUB_SINGLE_ROUTE);
  assert.equal(singleData.session.subagentLive, true);
  assert.equal(singleData.ref, '01a20007', 'single resolve shortens against indexed + deferred IDs when discovery is complete');

  // Truncated discovery cannot prove short-ref uniqueness -> keeps the full-route fallback.
  const prevMaxFiles = process.env.PI_DISH_SESSION_DISCOVERY_MAX_FILES;
  process.env.PI_DISH_SESSION_DISCOVERY_MAX_FILES = '1';
  try {
    const truncRes = await fetch(`${baseUrl}/api/sessions/resolve?id=${encodeURIComponent(PARENT_ROUTE)}`);
    assert.equal(truncRes.status, 200);
    const truncData = (await truncRes.json()) as { session: { id: string }; ref: string };
    assert.equal(truncData.ref, PARENT_ROUTE, 'truncated discovery returns full route');
  } finally {
    if (prevMaxFiles === undefined) delete process.env.PI_DISH_SESSION_DISCOVERY_MAX_FILES;
    else process.env.PI_DISH_SESSION_DISCOVERY_MAX_FILES = prevMaxFiles;
  }

  // Open SSE stream for the live OMP parent and verify structured updates, forged route stripping, and text-only refusal.
  const stream = sseReader(`${baseUrl}/api/sessions/${encodeURIComponent(PARENT_ROUTE)}/stream`);
  try {
    await stream.waitFor(ev => ev.event === 'init');

    // 1. Parallel live updates with structured subagents (forged sessionId on live-2 must be overwritten by verified route!)
    emitBridge('tool_execution_update', {
      toolCallId: 'live-1', toolName: 'task',
      partialResult: {
        content: [{ type: 'text', text: 'Running agent LiveFresh...' }],
        details: { subagents: [{ id: 'LiveFresh', index: 0, status: 'running' }] },
      },
    });
    emitBridge('tool_execution_update', {
      toolCallId: 'live-2', toolName: 'task',
      partialResult: {
        content: [{ type: 'text', text: 'Running agent BoraCheck...' }],
        details: { subagents: [{ id: 'BoraCheck', index: 0, status: 'running', sessionId: UNRELATED_ROUTE }] },
      },
    });
    // 2. Forged sessionId pointing at unrelated session for a non-existent subagent -> sessionId stripped!
    emitBridge('tool_execution_update', {
      toolCallId: 'live-forged', toolName: 'task',
      partialResult: {
        content: [{ type: 'text', text: 'Forged' }],
        details: { subagents: [{ id: 'NotRealSub', index: 0, status: 'running', sessionId: UNRELATED_ROUTE }] },
      },
    });
    // 3. Old bridge with text only and no structured details -> no details / no link!
    emitBridge('tool_execution_update', {
      toolCallId: 'live-old-bridge', toolName: 'task',
      partialResult: { content: [{ type: 'text', text: 'Running agent AshaPass...' }] },
    });

    const received = new Map<string, Record<string, unknown>>();
    for (const id of ['live-1', 'live-2', 'live-forged', 'live-old-bridge']) {
      const ev = await stream.waitFor(item => item.event === 'tool_execution_update' && record(item.data).toolCallId === id);
      received.set(id, record(ev.data));
    }

    const subsOf = (id: string) => {
      const partial = record(received.get(id)?.partialResult);
      const details = partial.details && typeof partial.details === 'object' ? record(partial.details) : null;
      return details && Array.isArray(details.subagents) ? details.subagents as Array<Record<string, unknown>> : null;
    };
    assert.deepEqual(subsOf('live-1')?.map(s => [s.id, s.sessionId]), [['LiveFresh', SUB_LIVE_ROUTE]]);
    assert.deepEqual(subsOf('live-2')?.map(s => [s.id, s.sessionId]), [['BoraCheck', SUB_B_ROUTE]]);
    assert.deepEqual(subsOf('live-forged')?.map(s => [s.id, s.sessionId ?? null]), [['NotRealSub', null]]);
    assert.equal(subsOf('live-old-bridge'), null, 'old bridge text-only update emits no subagent details');

    // 4. Live assistant message_end carrying forged taskSubagents / route fields MUST be stripped before forwarding!
    emitBridge('message_end', {
      message: {
        role: 'assistant',
        id: 'forged-stream-end',
        content: [
          {
            type: 'toolCall', id: 'tc-stream-forged', name: 'task', arguments: { agent: 'task' },
            taskSubagents: [{ id: 'ForgedEnd', sessionId: UNRELATED_ROUTE }],
            sessionId: UNRELATED_ROUTE,
            routeId: UNRELATED_ROUTE,
            sessionKey: UNRELATED_ROUTE,
          },
        ],
      },
    });
    const endEv = await stream.waitFor(item => item.event === 'message_end' && record(record(item.data).message).id === 'forged-stream-end');
    const endBlocks = record(record(endEv.data).message).content as Array<Record<string, unknown>>;
    assert.equal('taskSubagents' in endBlocks[0]!, false, 'live message_end strips taskSubagents');
    assert.equal('sessionId' in endBlocks[0]!, false, 'live message_end strips sessionId');
    assert.equal('routeId' in endBlocks[0]!, false, 'live message_end strips routeId');
    assert.equal('sessionKey' in endBlocks[0]!, false, 'live message_end strips sessionKey');
  } finally {
    stream.close();
  }
});

export {};
