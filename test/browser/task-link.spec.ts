import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, ROOT } from './fixtures.js';

const PEER_SUB_A = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-11-25T01-00-05-000Z_01a2aaaa-0000-7000-8000-000000000001'])).toString('base64url');
const PEER_SUB_B = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-11-25T01-00-06-000Z_01a2bbbb-0000-7000-8000-000000000002'])).toString('base64url');
const PEER_SUB_C = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-11-25T01-00-07-000Z_01a2cccc-0000-7000-8000-000000000003'])).toString('base64url');

test.use({ liveSessions: true });

test('task tool blocks link to running and finished subagents across /hosts/<host>/ at 390x844 while keeping details toggle', async ({ page, fleet }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // Mount peer through the hub's real /hosts/desktop/ proxy (matching the cross-host production path).
  writeFileSync(join(fleet.self.home, '.pi/dish/settings.json'), JSON.stringify({
    remotes: [{ name: 'desktop', url: fleet.peer.base, token: fleet.peer.token }],
  }));
  await page.reload();
  await expect.poll(() => page.evaluate(id => fixtureApp.features.hostDirectory.resolveHost(id).base, fleet.peer.hostId)).toBe('/hosts/desktop');

  // Stay on Active tab (default after reload on phone width): subagent sessions are NOT preloaded in sessionState.sessions.
  await expect(page.locator('#tabActive')).toHaveClass(/\bactive\b/);

  const subSessions: Record<string, { id: string; name: string; harnessId: string; model: string; isActive: boolean; subagentLive: boolean }> = {
    [PEER_SUB_A]: { id: PEER_SUB_A, name: 'AshaPass', harnessId: 'omp', model: 'anthropic/claude-opus-5-5', isActive: false, subagentLive: true },
    [PEER_SUB_B]: { id: PEER_SUB_B, name: 'BoraCheck', harnessId: 'omp', model: 'anthropic/claude-opus-5-5', isActive: false, subagentLive: false },
    [PEER_SUB_C]: { id: PEER_SUB_C, name: 'HealedAgent', harnessId: 'omp', model: 'anthropic/claude-opus-5-5', isActive: false, subagentLive: true },
  };
  let lineageIncludesHealed = false;
  let resolveViaProxyCount = 0;

  await page.route('**/hosts/desktop/api/sessions/resolve-batch', async route => {
    resolveViaProxyCount++;
    const body = route.request().postDataJSON() as { ids?: string[] };
    const results: Record<string, unknown> = {};
    for (const id of body?.ids || []) {
      const found = subSessions[id];
      results[id] = found ? { status: 'ok', session: found } : { status: 'not_found' };
    }
    await route.fulfill({ json: { results } });
  });

  await page.route('**/hosts/desktop/api/sessions/resolve?*', async route => {
    resolveViaProxyCount++;
    const id = new URL(route.request().url()).searchParams.get('id') || '';
    const found = subSessions[id];
    if (found) return route.fulfill({ json: { session: found } });
    return route.fulfill({ status: 404, json: { error: 'Session not found' } });
  });

  await page.route(`**/hosts/desktop/api/sessions/${encodeURIComponent(PEER_SUB_A)}/messages?*`, route => route.fulfill({
    json: { messages: [{ index: 0, role: 'assistant', content: 'AshaPass subagent transcript on desktop!' }], session: { name: 'AshaPass' } },
  }));
  await page.route(`**/hosts/desktop/api/sessions/${encodeURIComponent(PEER_SUB_B)}/messages?*`, route => route.fulfill({
    json: { messages: [{ index: 0, role: 'assistant', content: 'BoraCheck subagent transcript on desktop!' }], session: { name: 'BoraCheck' } },
  }));
  await page.route(`**/hosts/desktop/api/sessions/${encodeURIComponent(PEER_SUB_C)}/messages?*`, route => route.fulfill({
    json: { messages: [{ index: 0, role: 'assistant', content: 'HealedAgent subagent transcript on desktop!' }], session: { name: 'HealedAgent' } },
  }));

  // Parent lineage endpoint: starts without HealedAgent, then includes it as a direct child to exercise race healing.
  await page.route(`**/hosts/desktop/api/sessions/${ROOT}/lineage`, route => route.fulfill({
    json: {
      session: { id: ROOT, name: 'desktop root', harnessId: 'omp', isActive: true, subagentLive: false, turnInProgress: true, agentId: '' },
      tree: {
        session: { id: ROOT, name: 'desktop root', harnessId: 'omp', isActive: true, subagentLive: false, turnInProgress: true, agentId: '' },
        edge: null,
        children: lineageIncludesHealed ? [{
          session: { id: PEER_SUB_C, name: 'HealedAgent', harnessId: 'omp', isActive: false, subagentLive: true, turnInProgress: true, agentId: 'HealedAgent' },
          edge: { kind: 'subagent', source: 'directory' },
          children: [],
        }] : [],
      },
      members: lineageIncludesHealed ? 2 : 1,
      truncated: false,
    },
  }));

  // Parent persisted messages include:
  // - finished single task (with resolved link)
  // - finished multi-subagent batch task (with chip bar)
  // - version-skew old-peer task (raw OMP details, no projected subagents → degrades to no link)
  const parentMessages = [
    { index: 0, role: 'user', timestamp: '2026-11-25T01:00:00.000Z', content: 'Run finished and live tasks on desktop.' },
    {
      index: 1, role: 'assistant', timestamp: '2026-11-25T01:00:01.000Z',
      content: [
        { type: 'text', text: 'Completed the earlier tasks.' },
        {
          type: 'toolCall', id: 'fin-single', name: 'task',
          arguments: { agent: 'task', tasks: [{ id: 'BoraCheck', description: 'Host: desktop, working directory check' }] },
          taskSubagents: [{ id: 'BoraCheck', index: 0, status: 'completed', sessionId: PEER_SUB_B }],
        },
        {
          type: 'toolCall', id: 'fin-batch', name: 'task',
          arguments: { agent: 'task', tasks: [{ id: 'AshaPass' }, { id: 'BoraCheck' }] },
          taskSubagents: [
            { id: 'AshaPass', index: 0, status: 'completed', sessionId: PEER_SUB_A },
            { id: 'BoraCheck', index: 1, status: 'completed', sessionId: PEER_SUB_B },
          ],
        },
        {
          type: 'toolCall', id: 'old-peer', name: 'task',
          arguments: { agent: 'task', tasks: [{ id: 'LegacyAgent', description: 'Old peer without subagents field' }] },
        },
      ],
    },
    {
      index: 2, role: 'toolResult', toolCallId: 'old-peer', toolName: 'task', timestamp: '2026-11-25T01:00:05.000Z',
      content: [{ type: 'text', text: 'LegacyAgent completed' }],
      details: { results: [{ index: 0, id: 'LegacyAgent', exitCode: 0 }] },
    },
  ];
  await page.route(`**/hosts/desktop/api/sessions/${ROOT}/messages?*`, route => route.fulfill({
    json: {
      messages: parentMessages,
      firstIndex: 0,
      lastIndex: parentMessages.length - 1,
      totalMessages: parentMessages.length,
      hasMore: false,
      session: { name: 'desktop omp parent' },
    },
  }));

  // Select the remote parent session on desktop and wait for its live SSE stream to connect.
  await fleet.select(fleet.peer, ROOT);
  await expect.poll(() => page.evaluate(() => fixtureApp.features.messageStreamController.source?.readyState)).toBe(1);

  // 1. Finished single task block renders header link, multi-subagent renders chip bar, old-peer renders NO link.
  const toolCalls = page.locator('#messages details.tool-call');
  await expect(toolCalls).toHaveCount(3);
  const finSingle = toolCalls.nth(0);
  const finBatch = toolCalls.nth(1);
  const oldPeer = toolCalls.nth(2);

  await expect(finSingle.locator('summary .task-subagent-link')).toHaveCount(1);
  await expect(finSingle.locator('summary .task-subagent-link')).toHaveAttribute('data-session-id', PEER_SUB_B);
  await expect(finBatch.locator('summary .task-subagent-link')).toHaveCount(0);
  await expect(finBatch.locator('.task-subagent-bar .task-subagent-link')).toHaveCount(2);
  await expect(oldPeer.locator('.task-subagent-link')).toHaveCount(0);

  // 2. Emit running parallel live tasks over the real /hosts/desktop/ SSE stream.
  fleet.peer.emit('turn_start', {});
  const ashaArgs = { context: 'Host: desktop, working directory /home/jyarwood/workspace/project', agent: 'task', tasks: [{ id: 'AshaPass', description: 'Host: desktop, working directory audit' }] };
  fleet.peer.emit('tool_execution_start', {
    toolCallId: 'live-asha', toolName: 'task',
    args: ashaArgs,
  });
  const liveAsha = page.locator('details.live-tool-panel[data-tool-call-id="live-asha"]');
  await expect(liveAsha).toBeVisible();
  // Before subagent id is known: zero links!
  await expect(liveAsha.locator('.task-subagent-link')).toHaveCount(0);

  // Update arrives with resolved AshaPass + parallel BoraCheck + unresolved HealedAgent.
  fleet.peer.emit('tool_execution_update', {
    toolCallId: 'live-asha', toolName: 'task',
    args: ashaArgs,
    partialResult: {
      content: [{ type: 'text', text: 'Running agent AshaPass...' }],
      details: { subagents: [{ id: 'AshaPass', index: 0, status: 'running', sessionId: PEER_SUB_A }] },
    },
  });
  fleet.peer.emit('tool_execution_update', {
    toolCallId: 'live-bora', toolName: 'task',
    args: { agent: 'task', tasks: [{ id: 'BoraCheck', description: 'Host: desktop, secondary check' }] },
    partialResult: {
      content: [{ type: 'text', text: 'Running agent BoraCheck...' }],
      details: { subagents: [{ id: 'BoraCheck', index: 0, status: 'running', sessionId: PEER_SUB_B }] },
    },
  });
  fleet.peer.emit('tool_execution_update', {
    toolCallId: 'live-healed', toolName: 'task',
    args: { agent: 'task', tasks: [{ id: 'HealedAgent', description: 'Startup race test' }] },
    partialResult: {
      content: [{ type: 'text', text: 'Running agent HealedAgent...' }],
      details: { subagents: [{ id: 'HealedAgent', index: 0, status: 'running' }] },
    },
  });

  const liveBora = page.locator('details.live-tool-panel[data-tool-call-id="live-bora"]');
  const liveHealed = page.locator('details.live-tool-panel[data-tool-call-id="live-healed"]');

  const ashaLink = liveAsha.locator('summary .task-subagent-link');
  const boraLink = liveBora.locator('summary .task-subagent-link');
  await expect(ashaLink).toBeVisible();
  await expect(ashaLink).toHaveAttribute('data-session-id', PEER_SUB_A);
  await expect(ashaLink).toHaveAttribute('data-session-host', fleet.peer.hostId);
  await expect(ashaLink).toHaveAttribute('data-agent-state', 'working');
  await expect(boraLink).toHaveAttribute('data-session-id', PEER_SUB_B);
  await expect(liveHealed.locator('.task-subagent-link')).toHaveCount(0);

  // Trigger a lineage refresh now that HealedAgent's file exists → heals live-healed link cleanly.
  lineageIncludesHealed = true;
  await page.evaluate(() => {
    const owner = fixtureApp.features.sessionState.captureSelection();
    if (owner) void fixtureApp.features.sessionRelationsController.load(owner);
  });
  await expect(liveHealed.locator('summary .task-subagent-link')).toHaveAttribute('data-session-id', PEER_SUB_C);

  // 3. Phone width 390x844: zero horizontal overflow with live + finished task headers visible.
  const overflow = await page.evaluate(() => {
    const m = document.getElementById('messages');
    return m ? { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth } : null;
  });
  expect(overflow!.scrollWidth).toBeLessThanOrEqual(overflow!.clientWidth);

  // 4. Expanding/collapsing the live task block still works without navigating.
  await expect(liveAsha).not.toHaveAttribute('open', '');
  await liveAsha.locator('.live-tool-name').click();
  await expect(liveAsha).toHaveAttribute('open', '');
  await expect(liveAsha.locator('.live-tool-output')).toContainText('Running agent AshaPass...');

  // 5. Clicking the running task link opens AshaPass's transcript via /hosts/desktop/ without toggling <details>.
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
  expect(resolveViaProxyCount).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => (window as unknown as { __ashaToggles?: number }).__ashaToggles)).toBe(0);

  // 6. Navigate back to parent session: retained transcript restores with liveAsha STILL open (link click didn't toggle it),
  //    and tapping the header again collapses it cleanly.
  await fleet.select(fleet.peer, ROOT);
  await expect(liveAsha).toHaveAttribute('open', '');
  await liveAsha.locator('.live-tool-name').click();
  await expect(liveAsha).not.toHaveAttribute('open', '');

  // 7. Click the finished single-task header link (BoraCheck) → lands on BoraCheck's transcript; toggle on old-peer still works.
  await oldPeer.locator('.tool-call-name').click();
  await expect(oldPeer).toHaveAttribute('open', '');
  await oldPeer.locator('.tool-call-name').click();
  await expect(oldPeer).not.toHaveAttribute('open', '');

  await finSingle.locator('summary .task-subagent-link').click();
  await expect(page.locator('#messages')).toContainText('BoraCheck subagent transcript on desktop!');

  // 8. Return to parent and click one chip in the multi-subagent batch bar → lands on AshaPass's transcript.
  await fleet.select(fleet.peer, ROOT);
  await finBatch.locator('.tool-call-name').click();
  await expect(finBatch).toHaveAttribute('open', '');
  await finBatch.locator(`.task-subagent-bar .task-subagent-link[data-session-id="${PEER_SUB_A}"]`).click();
  await expect(page.locator('#messages')).toContainText('AshaPass subagent transcript on desktop!');
});

export {};
