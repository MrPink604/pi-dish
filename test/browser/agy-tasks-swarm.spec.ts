import { test, expect, ROOT, CHILD } from './fixtures.js';

test.use({ liveSessions: true });

const AGY_SUB = 'agy-subagent-1';
const AGY_WORKER = 'agy-worker-1';

const tasksPayload = {
  supported: true,
  isActive: true,
  plan: [
    { content: 'Audit login handler', status: 'completed', priority: 'high' },
    { content: 'Ship auth patch', status: 'in_progress', priority: 'high' },
  ],
  tasks: [
    {
      id: 'task-42',
      kind: 'command',
      title: 'Watch build',
      command: 'npm run watch',
      status: 'running',
      startedAt: '2026-11-19T14:00:00Z',
      finishedAt: null,
      exitCode: null,
      cron: null,
      durationSeconds: null,
      isDaemon: false,
      hasLog: true,
      logBytes: 128,
      preview: 'watching...',
    },
    {
      id: 'task-43',
      kind: 'schedule',
      title: 'Health check',
      command: 'Check CI every 5m',
      status: 'scheduled',
      startedAt: '2026-11-19T14:00:02Z',
      finishedAt: null,
      exitCode: null,
      cron: '*/5 * * * *',
      durationSeconds: null,
      isDaemon: true,
      hasLog: false,
      logBytes: null,
      preview: 'Check CI every 5m',
    },
  ],
  subagents: [
    {
      id: AGY_SUB,
      nativeSessionId: 'sub-native-1',
      name: 'Codebase Researcher',
      typeName: 'research',
      role: 'Codebase Researcher',
      state: 'working',
      isSwarmWorker: false,
      swarmMemberName: '',
      model: 'gemini-3.8-flash',
      lastActivity: '2026-11-19T14:01:00Z',
      stepCount: 4,
      currentAction: 'read_file: auth.ts',
    },
    {
      id: AGY_WORKER,
      nativeSessionId: 'worker-native-1',
      name: '@builder',
      typeName: 'worker',
      role: 'Swarm Worker (builder)',
      state: 'working',
      isSwarmWorker: true,
      swarmMemberName: 'builder',
      model: 'gemini-4-carbon',
      lastActivity: '2026-11-19T14:01:05Z',
      stepCount: 6,
      currentAction: 'run_command: npm test',
    },
  ],
  swarm: {
    active: true,
    coordinatorId: ROOT,
    coordinatorNativeId: 'coord-native',
    title: 'Fix auth',
    memberCount: 2,
    workingCount: 1,
    waitingCount: 1,
    killedCount: 0,
    postCount: 2,
    lastPostAt: '2026-11-19 14:01:10',
  },
};

const swarmPayload = {
  supported: true,
  hasSwarm: true,
  isActive: true,
  coordinatorId: ROOT,
  coordinatorNativeId: 'coord-native',
  title: 'Fix auth',
  head: 2,
  members: [
    {
      name: 'coordinator',
      conversationId: 'coord-native',
      routeId: ROOT,
      role: 'coordinator',
      model: 'gemini-4-carbon',
      workspaceMode: 'inherit',
      state: 'waiting',
      lastReadSeq: 2,
      unreadCount: 0,
      lastPostSeq: 1,
      lastActivity: '2026-11-19T14:00:10Z',
      currentAction: '',
    },
    {
      name: 'builder',
      conversationId: 'worker-native-1',
      routeId: AGY_WORKER,
      role: 'worker',
      model: 'gemini-4-carbon',
      workspaceMode: 'share',
      state: 'working',
      lastReadSeq: 1,
      unreadCount: 1,
      lastPostSeq: 2,
      lastActivity: '2026-11-19T14:01:10Z',
      currentAction: 'run_command: npm test',
    },
  ],
  channels: [
    { name: 'main', topic: 'Main coordination', postCount: 1 },
    { name: 'tests', topic: 'Test results', postCount: 1 },
  ],
  posts: [
    {
      seq: 1,
      agent: 'coordinator',
      text: '@builder fix the token race in auth.ts',
      time: '2026-11-19 14:00:10',
      kind: 'brief',
      channel: 'main',
      mentions: ['builder'],
      tags: [],
    },
    {
      seq: 2,
      agent: 'builder',
      text: '[done] @coordinator patched auth.ts and all unit tests pass',
      time: '2026-11-19 14:01:10',
      kind: '',
      channel: 'tests',
      mentions: ['coordinator'],
      tags: ['done'],
    },
  ],
  plan: {
    goal: { title: 'Fix auth', line: 'Eliminate token race condition' },
    threads: [{ title: 'Auth patch', tasks: ['builder'] }],
    tasks: { builder: 'Patch token refresh' },
  },
  narratorView: {
    headline: 'Builder completed the auth patch',
    attention: [{ kind: 'fyi', severity: 'med', title: 'Review auth patch', why: 'Ready to verify', refs: [{ seq: 1 }] }],
  },
};

const lineagePayload = {
  session: { id: ROOT, name: 'Coordinator', harnessId: 'agy', isActive: true },
  tree: {
    session: { id: ROOT, name: 'Coordinator', harnessId: 'agy', isActive: true },
    edge: null,
    children: [
      {
        session: { id: AGY_SUB, name: 'Codebase Researcher', harnessId: 'agy', subagentLive: true, turnInProgress: true, lastActivity: '2026-11-19T14:01:00Z' },
        edge: { kind: 'child', source: 'agy-brain-subagent' },
        children: [],
      },
      {
        session: { id: AGY_WORKER, name: '@builder', harnessId: 'agy', subagentLive: true, turnInProgress: true, lastActivity: '2026-11-19T14:01:05Z' },
        edge: { kind: 'child', source: 'agy-brain-subagent' },
        children: [],
      },
    ],
  },
  members: 3,
};

test('Antigravity tasks and swarm header chips, takeovers, slash commands, and inline /swarm board links work end-to-end', async ({ page, fleet }) => {
  await page.route('**/api/sessions', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const list of [body.active, body.previous]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item && item.id === ROOT) item.harnessId = 'agy';
      }
    }
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/sessions?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const list of [body.active, body.previous]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item && item.id === ROOT) item.harnessId = 'agy';
      }
    }
    await route.fulfill({ response, json: body });
  });
  await page.route(`**/api/sessions/${ROOT}/lineage`, route => route.fulfill({ json: lineagePayload }));
  await page.route(`**/api/sessions/${ROOT}/tasks`, route => route.fulfill({ json: tasksPayload }));
  await page.route(`**/api/sessions/${ROOT}/tasks/task-42/log`, route => route.fulfill({
    json: { taskId: 'task-42', content: 'watching build...\npass 1/2\n', totalBytes: 27, truncated: false, updatedAt: '2026-11-19T14:01:12Z' },
  }));
  await page.route(`**/api/sessions/${ROOT}/swarm*`, route => route.fulfill({ json: swarmPayload }));
  await page.route(`**/api/sessions/${AGY_WORKER}/messages*`, route => route.fulfill({
    json: {
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Builder trace output verified.' }], timestamp: Date.now(), index: 0 }],
      lastIndex: 0,
    },
  }));
  await page.route(`**/api/sessions/${AGY_SUB}/messages*`, route => route.fulfill({
    json: {
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Researcher audited login.ts.' }], timestamp: Date.now(), index: 0 }],
      lastIndex: 0,
    },
  }));

  const prompts: unknown[] = [];
  await page.route(`**/api/sessions/${ROOT}/prompt`, route => {
    prompts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });

  await fleet.select(fleet.self, ROOT);
  // Mark the selected session as an active agy session and reload relations.
  await page.evaluate((id) => {
    window.fixtureSessionListPatch(id, { harnessId: 'agy', isActive: true });
    return fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection());
  }, ROOT);

  // Header shows Subagents, Tasks, and Swarm chips.
  await expect(page.locator('#sessionRelations .session-relation-tree-link')).toContainText('Subagents · 2');
  await expect(page.locator('#sessionRelations .session-relation-tasks-link')).toContainText('Tasks · 1 running');
  await expect(page.locator('#sessionRelations .session-relation-swarm-link')).toContainText('Swarm · Fix auth');

  // Click Tasks chip -> renders Plan, Background tasks, live log tail, and subagent jump.
  await page.locator('#sessionRelations .session-relation-tasks-link').click();
  await expect(page.locator('.main')).toHaveClass(/\btasks-open\b/);
  await expect(page.locator('#tasksList')).toContainText('Ship auth patch');
  await expect(page.locator('#tasksList')).toContainText('Watch build');
  await expect(page.locator('#tasksDetailLog')).toContainText('pass 1/2');

  // Clicking a non-swarm subagent row jumps into Subagents takeover focused on that child.
  await page.locator('#tasksList .tasks-subagent-row', { hasText: 'Codebase Researcher' }).click();
  await expect(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
  await expect(page.locator('#subagentsDetailName')).toContainText('Codebase Researcher');
  await expect(page.locator('#subagentsTrace')).toContainText('Researcher audited login.ts.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.main')).not.toHaveClass(/\bsubagents-open\b/);

  // Typing /tasks opens Tasks view locally without hitting /command.
  await page.locator('#promptInput').fill('/tasks');
  await page.locator('#promptInput').press('Enter');
  await expect(page.locator('.main')).toHaveClass(/\btasks-open\b/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.main')).not.toHaveClass(/\btasks-open\b/);

  // Typing /swarm board opens Swarm view locally.
  await page.locator('#promptInput').fill('/swarm board');
  await page.locator('#promptInput').press('Enter');
  await expect(page.locator('.main')).toHaveClass(/\bswarm-open\b/);
  await expect(page.locator('#swarmViewTitle')).toContainText('Swarm · Fix auth');
  await expect(page.locator('#swarmBoardFeed .swarm-post')).toHaveCount(2);

  // Channel filter isolates #tests post.
  await page.locator('#swarmBoardFilters .swarm-filter-chip', { hasText: '#tests' }).click();
  await expect(page.locator('#swarmBoardFeed .swarm-post')).toHaveCount(1);
  await expect(page.locator('#swarmBoardFeed')).toContainText('patched auth.ts');

  // Members tab shows live worker trace peek.
  await page.locator('#swarmTabMembers').click();
  await expect(page.locator('#swarmMemberDetailName')).toContainText('@builder');
  await expect(page.locator('#swarmMemberTrace')).toContainText('Builder trace output verified.');

  // Overview tab renders goal + attention ref #1, and clicking #1 jumps back to Board.
  await page.locator('#swarmTabOverview').click();
  await expect(page.locator('#swarmOverviewBody')).toContainText('Review auth patch');
  await page.locator('#swarmOverviewBody button.swarm-filter-chip', { hasText: '#1' }).click();
  await expect(page.locator('#swarmPaneBoard')).toBeVisible();
  await expect(page.locator('#swarmBoardFeed [data-post-seq="1"]')).toBeVisible();

  // Coordinator composer sends prompt to coordinator route.
  await page.locator('#swarmPromptInput').fill('Wrap up and merge');
  await page.locator('#swarmPromptSendBtn').click();
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0]).toEqual({ message: 'Wrap up and merge' });

  await page.keyboard.press('Escape');
  await expect(page.locator('.main')).not.toHaveClass(/\bswarm-open\b/);

  // Inline `/swarm board` in assistant markdown renders as a clickable button that opens Swarm.
  await page.evaluate(() => {
    const root = fixtureElement(document.getElementById('messages'), '#messages');
    root.replaceChildren();
    root.insertAdjacentHTML('beforeend', fixtureApp.features.messageRenderer.message(PiDishBrowser.decodeRenderMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Swarm launched. Run `/swarm board` to follow progress.' }],
      timestamp: Date.now(),
    })));
  });
  const inlineBtn = page.locator('#messages button.swarm-board-link');
  await expect(inlineBtn).toHaveText('/swarm board');
  await inlineBtn.click();
  await expect(page.locator('.main')).toHaveClass(/\bswarm-open\b/);

  // Switching to another session closes the Swarm takeover cleanly.
  await fleet.select(fleet.self, CHILD);
  await expect(page.locator('.main')).not.toHaveClass(/\bswarm-open\b/);
});

export {};
