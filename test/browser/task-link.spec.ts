import { mkdirSync, writeFileSync } from 'node:fs';
import net = require('node:net');
import { dirname, join } from 'node:path';
import { test, expect } from './fixtures.js';
import { encodeSessionKey } from '../../lib/session-key.js';
import { processIdentity } from '../../lib/process-identity.js';
import type { NativeSessionId } from '../../lib/contracts.js';

const OMP_PARENT_NATIVE = '2026-11-25T01-00-00-000Z_01a21000-0000-7000-8000-000000000000';
const SUB_A_NATIVE = '2026-11-25T01-00-05-000Z_01a21001-0000-7000-8000-000000000001';
const SUB_B_NATIVE = '2026-11-25T01-00-06-000Z_01a21002-0000-7000-8000-000000000002';
const SUB_C_NATIVE = '2026-11-25T01-00-07-000Z_01a21003-0000-7000-8000-000000000003';
const UNRELATED_NATIVE = '2026-11-25T00-30-00-000Z_01a21099-0000-7000-8000-000000000099';

const OMP_PARENT_ROUTE = encodeSessionKey('omp', OMP_PARENT_NATIVE as NativeSessionId);
const PEER_SUB_A = encodeSessionKey('omp', SUB_A_NATIVE as NativeSessionId);
const PEER_SUB_B = encodeSessionKey('omp', SUB_B_NATIVE as NativeSessionId);
const PEER_SUB_C = encodeSessionKey('omp', SUB_C_NATIVE as NativeSessionId);
const UNRELATED_ROUTE = encodeSessionKey('omp', UNRELATED_NATIVE as NativeSessionId);

function writeJsonl(file: string, rows: unknown[]) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

test('task tool blocks link to real running and finished OMP subagents across /hosts/desktop/ at 390x844, strip forged routes, and preserve toggle', async ({ page, fleet }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // Create real OMP parent + subagents + unrelated session on the remote peer (`desktop`).
  const peerOmpDir = join(fleet.peer.home, '.omp/agent/sessions/project');
  const parentFile = join(peerOmpDir, `${OMP_PARENT_NATIVE}.jsonl`);
  const subDir = join(peerOmpDir, OMP_PARENT_NATIVE);

  writeJsonl(join(peerOmpDir, `${UNRELATED_NATIVE}.jsonl`), [
    { type: 'session', version: 3, id: UNRELATED_NATIVE, cwd: '/fixture/other', timestamp: '2026-11-25T00:30:00.000Z' },
    { type: 'message', id: 'u1', parentId: null, timestamp: '2026-11-25T00:30:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Unrelated secret session' }] } },
  ]);
  writeJsonl(join(subDir, 'AshaPass.jsonl'), [
    { type: 'title', title: 'AshaPass' },
    { type: 'session', version: 3, id: SUB_A_NATIVE, cwd: '/fixture/project', timestamp: '2026-11-25T01:00:05.000Z' },
    { type: 'message', id: 'sa1', parentId: null, timestamp: '2026-11-25T01:00:06.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'AshaPass subagent transcript on desktop!' }] } },
  ]);
  writeJsonl(join(subDir, 'BoraCheck.jsonl'), [
    { type: 'session', version: 3, id: SUB_B_NATIVE, cwd: '/fixture/project', timestamp: '2026-11-25T01:00:06.000Z' },
    { type: 'message', id: 'sb1', parentId: null, timestamp: '2026-11-25T01:00:07.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'BoraCheck subagent transcript on desktop!' }] } },
  ]);
  writeJsonl(parentFile, [
    { type: 'session', version: 3, id: OMP_PARENT_NATIVE, cwd: '/fixture/project', timestamp: '2026-11-25T01:00:00.000Z' },
    { type: 'message', id: 'p0', parentId: null, timestamp: '2026-11-25T01:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Run finished and live tasks on desktop.' }] } },
    {
      type: 'message', id: 'p1', parentId: 'p0', timestamp: '2026-11-25T01:00:01.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Completed the earlier tasks.' },
          { type: 'toolCall', id: 'fin-single', name: 'task', arguments: { agent: 'task', tasks: [{ id: 'BoraCheck' }] } },
          { type: 'toolCall', id: 'fin-batch', name: 'task', arguments: { agent: 'task', tasks: [{ id: 'AshaPass' }, { id: 'BoraCheck' }] } },
          // Forged persisted taskSubagents pointing at unrelated session -> server MUST strip!
          { type: 'toolCall', id: 'fin-forged', name: 'task', arguments: { agent: 'task' }, taskSubagents: [{ id: 'ForgedCall', sessionId: UNRELATED_ROUTE }] },
        ],
      },
    },
    {
      type: 'message', id: 'p2', parentId: 'p1', timestamp: '2026-11-25T01:00:02.000Z',
      message: {
        role: 'toolResult', toolCallId: 'fin-single', toolName: 'task', isError: false,
        content: [{ type: 'text', text: 'BoraCheck completed' }],
        details: { results: [{ index: 0, id: 'BoraCheck', agent: 'task', exitCode: 0 }] },
      },
    },
    {
      type: 'message', id: 'p3', parentId: 'p2', timestamp: '2026-11-25T01:00:03.000Z',
      message: {
        role: 'toolResult', toolCallId: 'fin-batch', toolName: 'task', isError: false,
        content: [{ type: 'text', text: 'Batch completed' }],
        details: {
          results: [
            { index: 0, id: 'AshaPass', agent: 'task', exitCode: 0 },
            { index: 1, id: 'BoraCheck', agent: 'task', exitCode: 0 },
          ],
        },
      },
    },
    {
      type: 'message', id: 'p4', parentId: 'p3', timestamp: '2026-11-25T01:00:04.000Z',
      message: {
        role: 'toolResult', toolCallId: 'fin-forged', toolName: 'task', isError: false,
        content: [{ type: 'text', text: 'Forged completed' }],
        details: { subagents: [{ id: 'ForgedResult', sessionId: UNRELATED_ROUTE }] },
      },
    },
  ]);

  // Attach a real v2 OMP bridge socket on fleet.peer so SSE events flow through the real peer server.
  const socketPath = join(fleet.peer.home, 'omp-task-bridge.sock');
  const procId = processIdentity(process.pid);
  if (!procId) throw new Error('expected process identity');
  const bridgeClaim = {
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp',
    nativeSessionId: OMP_PARENT_NATIVE,
    sessionId: OMP_PARENT_NATIVE,
    bridgeInstanceId: OMP_PARENT_NATIVE,
    instanceId: OMP_PARENT_NATIVE,
    sessionFile: parentFile,
    socketPath,
    cwd: '/fixture/project',
    name: 'desktop omp parent',
    pid: procId.pid,
    startTime: procId.startTime,
    spawnToken: null,
    capabilities: {},
  };
  const bridgeClients = new Set<net.Socket>();
  const bridge = net.createServer(sock => {
    bridgeClients.add(sock);
    sock.on('close', () => bridgeClients.delete(sock));
    sock.on('error', () => bridgeClients.delete(sock));
    sock.write(JSON.stringify({ type: 'hello', ...bridgeClaim, turnInProgress: true, queue: { steering: [], followUp: [] } }) + '\n');
    let buf = '';
    sock.on('data', chunk => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl)) as { id?: string };
        buf = buf.slice(nl + 1);
        sock.write(JSON.stringify({ type: 'response', id: msg.id, success: true, data: {} }) + '\n');
      }
    });
  });
  await new Promise<void>(resolve => bridge.listen(socketPath, resolve));
  const emitOmp = (event: string, data: unknown) => {
    const line = JSON.stringify({ type: 'event', event, data }) + '\n';
    for (const sock of bridgeClients) sock.write(line);
  };

  try {
    const peerRegDir = join(fleet.peer.home, '.pi/dish/sessions');
    mkdirSync(peerRegDir, { recursive: true });
    writeFileSync(join(peerRegDir, `${OMP_PARENT_NATIVE}.json`), JSON.stringify(bridgeClaim));

    // Mount peer through the hub's real /hosts/desktop/ proxy.
    writeFileSync(join(fleet.self.home, '.pi/dish/settings.json'), JSON.stringify({
      remotes: [{ name: 'desktop', url: fleet.peer.base, token: fleet.peer.token }],
    }));
    await page.reload();
    await expect.poll(() => page.evaluate(id => fixtureApp.features.hostDirectory.resolveHost(id).base, fleet.peer.hostId)).toBe('/hosts/desktop');
    await expect(page.locator('#tabActive')).toHaveClass(/\bactive\b/);

    let proxySubMessagesHits = 0;
    page.on('request', req => {
      if (req.url().includes(`/hosts/desktop/api/sessions/${encodeURIComponent(PEER_SUB_A)}/messages`)) proxySubMessagesHits += 1;
    });

    // Wait for Active sidebar poll to discover our live OMP parent on desktop, then select it.
    await expect.poll(() => page.evaluate(({ id, host }) => !!fixtureApp.features.sessionState.findSession(id, host), {
      id: OMP_PARENT_ROUTE, host: fleet.peer.hostId,
    })).toBe(true);
    await fleet.select(fleet.peer, OMP_PARENT_ROUTE);
    await expect.poll(() => page.evaluate(() => fixtureApp.features.messageStreamController.source?.readyState)).toBe(1);

    // 1. Finished blocks (real server messages): single -> BoraCheck, batch -> chip bar, forged -> ZERO links!
    const toolCalls = page.locator('#messages details.tool-call');
    await expect(toolCalls).toHaveCount(3);
    const finSingle = toolCalls.nth(0);
    const finBatch = toolCalls.nth(1);
    const finForged = toolCalls.nth(2);

    await expect(finSingle.locator('summary .task-subagent-link')).toHaveAttribute('data-session-id', PEER_SUB_B);
    await expect(finBatch.locator('summary .task-subagent-link')).toHaveCount(0);
    await expect(finBatch.locator('.task-subagent-bar .task-subagent-link')).toHaveCount(2);
    await expect(finForged.locator('.task-subagent-link')).toHaveCount(0);

    // 2. Live SSE tasks through real peer server:
    //    - live-asha (verified locally -> PEER_SUB_A)
    //    - live-bora (parallel verified -> PEER_SUB_B)
    //    - live-forged (forged sessionId pointing at UNRELATED_ROUTE -> stripped -> ZERO chips!)
    //    - live-healed (file doesn't exist yet -> ZERO chips; then file created -> lineage refresh heals to PEER_SUB_C!)
    const ashaArgs = { context: 'Host: desktop, working directory /fixture/project', agent: 'task', tasks: [{ id: 'AshaPass' }] };
    emitOmp('turn_start', {});
    emitOmp('tool_execution_start', { toolCallId: 'live-asha', toolName: 'task', args: ashaArgs });
    const liveAsha = page.locator('details.live-tool-panel[data-tool-call-id="live-asha"]');
    await expect(liveAsha).toBeVisible();
    await expect(liveAsha.locator('.task-subagent-link')).toHaveCount(0);

    emitOmp('tool_execution_update', {
      toolCallId: 'live-asha', toolName: 'task', args: ashaArgs,
      partialResult: {
        content: [{ type: 'text', text: 'Running agent AshaPass...' }],
        details: { progress: [{ index: 0, id: 'AshaPass', agent: 'task', status: 'running' }] },
      },
    });
    emitOmp('tool_execution_update', {
      toolCallId: 'live-bora', toolName: 'task', args: { agent: 'task', tasks: [{ id: 'BoraCheck' }] },
      partialResult: {
        content: [{ type: 'text', text: 'Running agent BoraCheck...' }],
        details: { progress: [{ index: 0, id: 'BoraCheck', agent: 'task', status: 'running' }] },
      },
    });
    emitOmp('tool_execution_update', {
      toolCallId: 'live-forged', toolName: 'task', args: { agent: 'task' },
      partialResult: {
        content: [{ type: 'text', text: 'Forged live' }],
        details: { subagents: [{ id: 'ForgedLive', index: 0, status: 'running', sessionId: UNRELATED_ROUTE }] },
      },
    });
    emitOmp('tool_execution_update', {
      toolCallId: 'live-healed', toolName: 'task', args: { agent: 'task', tasks: [{ id: 'HealedAgent' }] },
      partialResult: {
        content: [{ type: 'text', text: 'Running agent HealedAgent...' }],
        details: { progress: [{ index: 0, id: 'HealedAgent', agent: 'task', status: 'running' }] },
      },
    });

    const liveBora = page.locator('details.live-tool-panel[data-tool-call-id="live-bora"]');
    const liveForged = page.locator('details.live-tool-panel[data-tool-call-id="live-forged"]');
    const liveHealed = page.locator('details.live-tool-panel[data-tool-call-id="live-healed"]');

    const ashaLink = liveAsha.locator('summary .task-subagent-link');
    await expect(ashaLink).toBeVisible();
    await expect(ashaLink).toHaveAttribute('data-session-id', PEER_SUB_A);
    await expect(ashaLink).toHaveAttribute('data-session-host', fleet.peer.hostId);
    await expect(ashaLink).toHaveAttribute('data-agent-state', 'working');
    await expect(liveBora.locator('summary .task-subagent-link')).toHaveAttribute('data-session-id', PEER_SUB_B);
    await expect(liveForged.locator('.task-subagent-link')).toHaveCount(0);
    await expect(liveHealed.locator('.task-subagent-link')).toHaveCount(0);

    // Create HealedAgent.jsonl on disk and reload real lineage -> heals live-healed to PEER_SUB_C!
    writeJsonl(join(subDir, 'HealedAgent.jsonl'), [
      { type: 'session', version: 3, id: SUB_C_NATIVE, cwd: '/fixture/project', timestamp: '2026-11-25T01:00:07.000Z' },
      { type: 'message', id: 'sc1', parentId: null, timestamp: '2026-11-25T01:00:08.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'HealedAgent transcript' }] } },
    ]);
    await page.evaluate(() => {
      const owner = fixtureApp.features.sessionState.captureSelection();
      if (owner) void fixtureApp.features.sessionRelationsController.load(owner);
    });
    await expect(liveHealed.locator('summary .task-subagent-link')).toHaveAttribute('data-session-id', PEER_SUB_C);

    // 3. Phone width 390x844: zero horizontal overflow.
    const overflow = await page.evaluate(() => {
      const m = document.getElementById('messages');
      return m ? { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth } : null;
    });
    expect(overflow!.scrollWidth).toBeLessThanOrEqual(overflow!.clientWidth);

    // 4. Expanding/collapsing liveAsha still works without navigating.
    await expect(liveAsha).not.toHaveAttribute('open', '');
    await liveAsha.locator('.live-tool-name').click();
    await expect(liveAsha).toHaveAttribute('open', '');
    await expect(liveAsha.locator('.live-tool-output')).toContainText('Running agent AshaPass...');

    // 5. Clicking AshaPass link opens the real subagent transcript via /hosts/desktop/ without toggling <details>.
    await page.evaluate(() => {
      const el = fixtureDetails(document.querySelector('details.live-tool-panel[data-tool-call-id="live-asha"]'), 'live-asha');
      (window as unknown as { __ashaToggles?: number }).__ashaToggles = 0;
      el.addEventListener('toggle', () => {
        const w = window as unknown as { __ashaToggles?: number };
        w.__ashaToggles = (w.__ashaToggles || 0) + 1;
      });
    });
    await ashaLink.click();
    await expect(page.locator('#messages')).toContainText('AshaPass subagent transcript on desktop!');
    expect(proxySubMessagesHits).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => (window as unknown as { __ashaToggles?: number }).__ashaToggles)).toBe(0);

    // 6. Navigate back to parent: retained transcript restores liveAsha STILL open, and header click collapses it.
    await fleet.select(fleet.peer, OMP_PARENT_ROUTE);
    await expect(liveAsha).toHaveAttribute('open', '');
    await liveAsha.locator('.live-tool-name').click();
    await expect(liveAsha).not.toHaveAttribute('open', '');

    // 7. Toggle on linkless block works; clicking finished BoraCheck header link opens BoraCheck transcript.
    await finForged.locator('.tool-call-name').click();
    await expect(finForged).toHaveAttribute('open', '');
    await finForged.locator('.tool-call-name').click();
    await expect(finForged).not.toHaveAttribute('open', '');

    await finSingle.locator('summary .task-subagent-link').click();
    await expect(page.locator('#messages')).toContainText('BoraCheck subagent transcript on desktop!');

    // 8. Return to parent and click AshaPass chip inside the multi-subagent batch bar.
    await fleet.select(fleet.peer, OMP_PARENT_ROUTE);
    await finBatch.locator('.tool-call-name').click();
    await expect(finBatch).toHaveAttribute('open', '');
    await finBatch.locator(`.task-subagent-bar .task-subagent-link[data-session-id="${PEER_SUB_A}"]`).click();
    await expect(page.locator('#messages')).toContainText('AshaPass subagent transcript on desktop!');
  } finally {
    for (const sock of bridgeClients) sock.destroy();
    bridge.close();
  }
});

export {};
