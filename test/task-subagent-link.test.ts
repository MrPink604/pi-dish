/**
 * End-to-end API tests for OMP `task` tool → subagent transcript mapping:
 * - persisted messages (single, parallel calls in one turn, multi-subagent batch,
 *   async background spawns, paginated slices, and missing/deleted subagent files)
 * - live SSE tool events (normal bridge, parallel tasks, unreloaded old bridge fallback,
 *   and unverified text refusal)
 * - immediate `/api/sessions/resolve` + `/api/sessions/resolve-batch` for live OMP
 *   subagents even when `PI_DISH_INDEX_SYNC_BUDGET=0`.
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

const ompWorkspace = path.join(tmpHome, '.omp', 'agent', 'sessions', '--home-user-proj--');
const PARENT_NATIVE = '2026-11-25T01-00-00-000Z_01a20000-0000-7000-8000-000000000000';
const SUB_A_NATIVE = '2026-11-25T01-00-05-000Z_01a20001-0000-7000-8000-000000000001';
const SUB_B_NATIVE = '2026-11-25T01-00-06-000Z_01a20002-0000-7000-8000-000000000002';
const SUB_BG_NATIVE = '2026-11-25T01-00-07-000Z_01a20003-0000-7000-8000-000000000003';
const SUB_LIVE_NATIVE = '2026-11-25T01-00-08-000Z_01a20004-0000-7000-8000-000000000004';

const PARENT_ROUTE = encodeSessionKey('omp', checkedNativeId(PARENT_NATIVE));
const SUB_A_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_A_NATIVE));
const SUB_B_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_B_NATIVE));
const SUB_BG_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_BG_NATIVE));
const SUB_LIVE_ROUTE = encodeSessionKey('omp', checkedNativeId(SUB_LIVE_NATIVE));

const parentFile = path.join(ompWorkspace, `${PARENT_NATIVE}.jsonl`);
const subDir = path.join(ompWorkspace, PARENT_NATIVE);
fs.mkdirSync(subDir, { recursive: true });

function writeJsonl(file: string, rows: unknown[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

// Create subagent JSONLs (AshaPass, BoraCheck, BgWorker; intentionally omit DeletedAgent).
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

// Parent OMP session with:
// - Turn 1: two parallel task calls (tc-1 → AshaPass, tc-2 → BoraCheck) where tc-2 finishes first
// - Turn 2: a multi-subagent batch task (tc-3 → AshaPass + BoraCheck + DeletedAgent)
// - Turn 3: an async background task (tc-4 → BgWorker)
writeJsonl(parentFile, [
  { type: 'session', version: 3, id: PARENT_NATIVE, cwd: '/home/user/proj', timestamp: '2026-11-25T01:00:00.000Z' },
  { type: 'message', id: 'm1', parentId: null, timestamp: '2026-11-25T01:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Run parallel tasks' }] } },
  {
    type: 'message', id: 'm2', parentId: 'm1', timestamp: '2026-11-25T01:00:02.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc-1', name: 'task', arguments: { agent: 'task', tasks: [{ id: 'AshaPass', description: 'check A' }] } },
        { type: 'toolCall', id: 'tc-2', name: 'task', arguments: { agent: 'task', tasks: [{ id: 'BoraCheck', description: 'check B' }] } },
      ],
    },
  },
  {
    type: 'message', id: 'm3', parentId: 'm2', timestamp: '2026-11-25T01:00:10.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-2', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'BoraCheck done' }],
      details: { results: [{ index: 0, id: 'BoraCheck', agent: 'task', exitCode: 0, durationMs: 1200 }] },
    },
  },
  {
    type: 'message', id: 'm4', parentId: 'm3', timestamp: '2026-11-25T01:00:12.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-1', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'AshaPass done' }],
      details: { results: [{ index: 0, id: 'AshaPass', agent: 'task', exitCode: 0, durationMs: 2400 }] },
    },
  },
  {
    type: 'message', id: 'm5', parentId: 'm4', timestamp: '2026-11-25T01:00:20.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc-3', name: 'task', arguments: { agent: 'task', tasks: [{ id: 'AshaPass' }, { id: 'BoraCheck' }, { id: 'DeletedAgent' }] } },
      ],
    },
  },
  {
    type: 'message', id: 'm6', parentId: 'm5', timestamp: '2026-11-25T01:00:25.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-3', toolName: 'task', isError: false,
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
    type: 'message', id: 'm7', parentId: 'm6', timestamp: '2026-11-25T01:00:30.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'tc-4', name: 'task', arguments: { agent: 'task', tasks: [{ id: 'BgWorker' }] } }],
    },
  },
  {
    type: 'message', id: 'm8', parentId: 'm7', timestamp: '2026-11-25T01:00:31.000Z',
    message: {
      role: 'toolResult', toolCallId: 'tc-4', toolName: 'task', isError: false,
      content: [{ type: 'text', text: 'Spawned 1 background agent (async mode).\n- `BgWorker` (job `BgWorker`)' }],
      details: {
        async: { state: 'running', jobId: 'BgWorker', type: 'task' },
        results: [],
        progress: [{ index: 0, id: 'BgWorker', agent: 'task', status: 'running' }],
      },
    },
  },
]);

// Set up a mock live v2 OMP bridge socket for the OMP parent session so we can also test SSE + live subagent resolve.
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

test('GET /api/sessions/:id/messages maps parallel, batch, async, and paginated task blocks to exact subagent route ids', async () => {
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(PARENT_ROUTE)}/messages?limit=50`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { messages: Array<Record<string, unknown>> };

  // Turn 1 assistant message has two parallel task toolCalls (tc-1 → AshaPass, tc-2 → BoraCheck).
  const turn1 = body.messages.find(m => m.id === 'm2')!;
  const blocks1 = turn1.content as Array<Record<string, unknown>>;
  const tc1 = blocks1.find(b => b.id === 'tc-1')!;
  const tc2 = blocks1.find(b => b.id === 'tc-2')!;
  assert.deepEqual((tc1.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['AshaPass', SUB_A_ROUTE]]);
  assert.deepEqual((tc2.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BoraCheck', SUB_B_ROUTE]]);

  // Tool results carry details.subagents with their respective resolved route ids.
  const tr2 = body.messages.find(m => m.id === 'm3')!;
  const tr1 = body.messages.find(m => m.id === 'm4')!;
  assert.deepEqual((record(tr2.details).subagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BoraCheck', SUB_B_ROUTE]]);
  assert.deepEqual((record(tr1.details).subagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['AshaPass', SUB_A_ROUTE]]);

  // Batch turn 2 resolves AshaPass + BoraCheck and leaves DeletedAgent without a sessionId.
  const trBatch = body.messages.find(m => m.id === 'm6')!;
  const batchSubs = record(trBatch.details).subagents as Array<Record<string, unknown>>;
  assert.deepEqual(batchSubs.map(s => [s.id, s.sessionId ?? null]), [
    ['AshaPass', SUB_A_ROUTE],
    ['BoraCheck', SUB_B_ROUTE],
    ['DeletedAgent', null],
  ]);

  // Async background spawn turn 3 resolves BgWorker on both toolCall and toolResult.
  const turn3 = body.messages.find(m => m.id === 'm7')!;
  const tc4 = (turn3.content as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual((tc4.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['BgWorker', SUB_BG_ROUTE]]);

  // Paginated slice containing m2 (index 1) without m3/m4 still resolves tc-1 & tc-2 from the full message list.
  const pagedRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(PARENT_ROUTE)}/messages?before=2&limit=2`);
  assert.equal(pagedRes.status, 200);
  const pagedBody = (await pagedRes.json()) as { messages: Array<Record<string, unknown>> };
  const pagedTurn1 = pagedBody.messages.find(m => m.id === 'm2')!;
  const pagedTc1 = (pagedTurn1.content as Array<Record<string, unknown>>).find(b => b.id === 'tc-1')!;
  assert.deepEqual((pagedTc1.taskSubagents as Array<Record<string, unknown>>).map(s => [s.id, s.sessionId]), [['AshaPass', SUB_A_ROUTE]]);
});

test('live SSE stream resolves running parallel tasks, old-bridge text fallback, and freshly spawned subagent resolve under budget=0', async () => {
  // Create a brand-new running subagent file after server boot (not in initial scan, and PI_DISH_INDEX_SYNC_BUDGET=0).
  const liveFile = path.join(subDir, 'LiveFresh.jsonl');
  writeJsonl(liveFile, [
    { type: 'session', version: 3, id: SUB_LIVE_NATIVE, cwd: '/home/user/proj', timestamp: new Date().toISOString() },
    { type: 'message', id: 'sl1', parentId: null, timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'LiveFresh running' }] } },
  ]);

  // Verify /api/sessions/resolve and /api/sessions/resolve-batch resolve the brand-new subagent immediately.
  const singleRes = await fetch(`${baseUrl}/api/sessions/resolve?id=${encodeURIComponent(SUB_LIVE_ROUTE)}`);
  assert.equal(singleRes.status, 200);
  const singleData = (await singleRes.json()) as { session: { id: string; subagentLive?: boolean } };
  assert.equal(singleData.session.id, SUB_LIVE_ROUTE);

  const batchRes = await fetch(`${baseUrl}/api/sessions/resolve-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [SUB_LIVE_ROUTE, SUB_A_ROUTE] }),
  });
  assert.equal(batchRes.status, 200);
  const batchData = (await batchRes.json()) as { results: Record<string, { status: string; session?: { id: string } }> };
  assert.equal(batchData.results[SUB_LIVE_ROUTE]?.status, 'ok');
  assert.equal(batchData.results[SUB_LIVE_ROUTE]?.session?.id, SUB_LIVE_ROUTE);
  assert.equal(batchData.results[SUB_A_ROUTE]?.status, 'ok');
  assert.equal(batchData.results[SUB_A_ROUTE]?.session?.id, SUB_A_ROUTE);

  // Open SSE stream for the live OMP parent and emit parallel + old-bridge tool_execution_update events.
  const stream = sseReader(`${baseUrl}/api/sessions/${encodeURIComponent(PARENT_ROUTE)}/stream`);
  try {
    await stream.waitFor(ev => ev.event === 'init');

    // 1. Parallel live updates with structured subagents/progress
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
        details: { subagents: [{ id: 'BoraCheck', index: 0, status: 'running' }] },
      },
    });
    // 2. Unreloaded old bridge: details stripped by old bridge, only exact text present.
    emitBridge('tool_execution_update', {
      toolCallId: 'live-old-bridge', toolName: 'task',
      partialResult: { content: [{ type: 'text', text: 'Running agent AshaPass...' }] },
    });
    // 3. Unverified agent text: file does not exist → must stay linkless.
    emitBridge('tool_execution_update', {
      toolCallId: 'live-ghost', toolName: 'task',
      partialResult: { content: [{ type: 'text', text: 'Running agent GhostAgent...' }] },
    });

    const received = new Map<string, Record<string, unknown>>();
    for (const id of ['live-1', 'live-2', 'live-old-bridge', 'live-ghost']) {
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
    assert.deepEqual(subsOf('live-old-bridge')?.map(s => [s.id, s.sessionId]), [['AshaPass', SUB_A_ROUTE]]);
    assert.equal(subsOf('live-ghost'), null);
  } finally {
    stream.close();
  }
});

export {};
