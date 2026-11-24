import { test, expect, ROOT, CHILD } from './fixtures.js';

test.use({ liveSessions: true });

const AGY_SUB = 'agy-subagent-1';
const AGY_WORKER = 'agy-worker-1';
const AGY_NARRATOR = 'agy-narrator-1';

const tasksPayload = {
  supported: true,
  isActive: true,
  canControl: true,
  plan: [
    { content: 'Audit login handler', status: 'completed', priority: 'high' },
    { content: 'Ship auth patch', status: 'in_progress', priority: 'high' },
  ],
  tasks: [
    {
      id: 'task-42',
      fullTaskId: 'coord-native/task-42',
      kind: 'shell',
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
      fullTaskId: 'coord-native/task-43',
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
    {
      id: 'tool-call-1',
      fullTaskId: 'tool-call-1',
      kind: 'tool',
      title: 'npm test',
      command: 'npm test',
      status: 'running',
      startedAt: '2026-11-19T14:01:00Z',
      finishedAt: null,
      exitCode: null,
      cron: null,
      durationSeconds: null,
      isDaemon: false,
      hasLog: false,
      logBytes: null,
      preview: '',
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
    memberCount: 3,
    workingCount: 1,
    waitingCount: 2,
    killedCount: 0,
    postCount: 2,
    lastPostAt: '2026-11-19 14:01:10',
  },
};

const swarmPayload = {
  supported: true,
  hasSwarm: true,
  isActive: true,
  coordinatorTurnInProgress: false,
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
    {
      name: 'narrator',
      conversationId: 'narrator-native-1',
      routeId: AGY_NARRATOR,
      role: 'worker',
      model: 'gemini-3.8-flash',
      workspaceMode: 'inherit',
      state: 'waiting',
      lastReadSeq: 2,
      unreadCount: 0,
      lastPostSeq: null,
      lastActivity: '2026-11-19T14:01:08Z',
      currentAction: '',
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
  session: { id: ROOT, name: 'Coordinator', harnessId: 'agy', isActive: true, capabilities: { prompt: true, steer: true, followUp: false } },
  tree: {
    session: { id: ROOT, name: 'Coordinator', harnessId: 'agy', isActive: true, capabilities: { prompt: true, steer: true, followUp: false } },
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
      {
        session: { id: AGY_NARRATOR, name: '@narrator', harnessId: 'agy', subagentLive: true, turnInProgress: false, lastActivity: '2026-11-19T14:01:08Z' },
        edge: { kind: 'child', source: 'agy-brain-subagent' },
        children: [],
      },
    ],
  },
  members: 4,
};

test('Antigravity tasks, subagents, and swarm integrate into the existing Subagents view without leaking onto non-agy pages', async ({ page, fleet }) => {
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
  await page.route(`**/api/sessions/${ROOT}/tasks/task-42/log*`, route => route.fulfill({
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

  // Verify no separate #tasksView or #swarmView containers exist anywhere in the DOM.
  await fleet.select(fleet.self, CHILD);
  await expect(page.locator('#tasksView')).toHaveCount(0);
  await expect(page.locator('#swarmView')).toHaveCount(0);
  await expect(page.locator('#subagentsView')).toBeHidden();

  await fleet.select(fleet.self, ROOT);
  await page.evaluate((id) => {
    window.fixtureSessionListPatch(id, { harnessId: 'agy', isActive: true });
    return fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection());
  }, ROOT);

  // Header shows Subagents, Tasks, and Swarm chips.
  await expect(page.locator('#sessionRelations .session-relation-tree-link')).toContainText('Subagents · 3');
  await expect(page.locator('#sessionRelations .session-relation-tasks-link')).toContainText('Tasks · 2 running');
  await expect(page.locator('#sessionRelations .session-relation-swarm-link')).toContainText('Swarm · Fix auth');

  // Click Tasks chip -> opens existing #subagentsView focused on background task + plan in the tree.
  await page.locator('#sessionRelations .session-relation-tasks-link').click();
  await expect(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
  await expect(page.locator('#subagentsTree')).toContainText('Ship auth patch');
  await expect(page.locator('#subagentsTree')).toContainText('Watch build');
  await expect(page.locator('#tasksDetailLog')).toContainText('pass 1/2');

  // Clicking a subagent row in #subagentsTree shows its live trace in the same detail pane.
  await page.locator('#subagentsTree .lineage-row', { hasText: 'Codebase Researcher' }).click();
  await expect(page.locator('#subagentsDetailName')).toContainText('Codebase Researcher');
  await expect(page.locator('#subagentsTrace')).toContainText('Researcher audited login.ts.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.main')).not.toHaveClass(/\bsubagents-open\b/);

  // Typing /tasks opens #subagentsView focused on tasks.
  await page.locator('#promptInput').fill('/tasks');
  await page.locator('#promptInput').press('Enter');
  await expect(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
  await expect(page.locator('#tasksDetailLog')).toContainText('pass 1/2');
  await page.keyboard.press('Escape');

  // Typing /swarm board opens #subagentsView focused on Swarm Board.
  await page.locator('#promptInput').fill('/swarm board');
  await page.locator('#promptInput').press('Enter');
  await expect(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
  await expect(page.locator('#subagentsViewTitle')).toContainText('Subagents · Fix auth');
  await expect(page.locator('#swarmBoardFeed .swarm-post')).toHaveCount(2);

  // Channel filter isolates #tests post.
  await page.locator('#swarmBoardFilters .swarm-filter-chip', { hasText: '#tests' }).click();
  await expect(page.locator('#swarmBoardFeed .swarm-post')).toHaveCount(1);
  await expect(page.locator('#swarmBoardFeed')).toContainText('patched auth.ts');

  // Clicking @builder in the Subagents tree peeks its live trace.
  await page.locator('#subagentsTree .lineage-row', { hasText: '@builder' }).click();
  await expect(page.locator('#subagentsDetailName')).toContainText('@builder');
  await expect(page.locator('#subagentsTrace')).toContainText('Builder trace output verified.');

  // Clicking Overview in the Subagents tree renders attention ref #1, and clicking #1 jumps back to Board.
  await page.locator('#subagentsTree [data-subagents-aux="swarm-overview"]').click();
  await expect(page.locator('#swarmOverviewBody')).toContainText('Review auth patch');
  await page.locator('#swarmOverviewBody button.swarm-filter-chip', { hasText: '#1' }).click();
  await expect(page.locator('#swarmBoardFeed [data-post-seq="1"]')).toBeVisible();

  // Coordinator composer sends prompt to coordinator route.
  await page.locator('#swarmPromptInput').fill('Wrap up and merge');
  await page.locator('#swarmPromptSendBtn').click();
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0]).toEqual({ message: 'Wrap up and merge' });

  await page.keyboard.press('Escape');
  await expect(page.locator('.main')).not.toHaveClass(/\bsubagents-open\b/);

  // Inline `/swarm board` in assistant markdown opens #subagentsView on Swarm Board.
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
  await expect(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
  await expect(page.locator('#swarmBoardFeed')).toBeVisible();

  // Switching to a non-agy session closes #subagentsView cleanly.
  await fleet.select(fleet.self, CHILD);
  await expect(page.locator('.main')).not.toHaveClass(/\bsubagents-open\b/);
});

test('Interactive Swarm and Tasks controls inside Subagents view dispatch coordinator actions, direct aborts/model switches, and start-swarm', async ({ page, fleet }) => {
  let activeSwarm: Record<string, unknown> = {
    supported: true,
    hasSwarm: false,
    isActive: true,
    coordinatorTurnInProgress: false,
    coordinatorId: ROOT,
    coordinatorNativeId: 'coord-native',
    title: '',
    head: 0,
    members: [],
    channels: [],
    posts: [],
    plan: null,
    narratorView: null,
  };
  const prompts: { endpoint: string; message: string }[] = [];
  const aborts: string[] = [];
  const modelSwitches: unknown[] = [];
  const logUrls: string[] = [];

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
  await page.route(`**/api/sessions/${ROOT}/tasks/task-42/log*`, route => {
    logUrls.push(route.request().url());
    return route.fulfill({
      json: { taskId: 'task-42', content: 'watching build...\npass 1/2\n', totalBytes: 200_000, truncated: !route.request().url().includes('tail='), updatedAt: '2026-11-19T14:01:12Z' },
    });
  });
  await page.route(`**/api/sessions/${ROOT}/swarm*`, route => route.fulfill({ json: activeSwarm }));
  await page.route(`**/api/models?sessionId=${ROOT}*`, route => route.fulfill({
    json: [
      { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', provider: 'google-antigravity' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'google-antigravity' },
    ],
  }));
  await page.route(`**/api/sessions/${AGY_WORKER}/messages*`, route => route.fulfill({ json: { messages: [], lastIndex: null } }));
  await page.route(`**/api/sessions/${ROOT}/messages*`, route => route.fulfill({ json: { messages: [], lastIndex: null } }));
  await page.route(`**/api/sessions/${AGY_NARRATOR}/messages*`, route => route.fulfill({ json: { messages: [], lastIndex: null } }));
  await page.route(`**/api/sessions/${ROOT}/prompt`, route => {
    const body = route.request().postDataJSON() as { message?: string };
    prompts.push({ endpoint: 'prompt', message: String(body?.message ?? '') });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route(`**/api/sessions/${ROOT}/steer`, route => {
    const body = route.request().postDataJSON() as { message?: string };
    prompts.push({ endpoint: 'steer', message: String(body?.message ?? '') });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route(`**/api/sessions/${ROOT}/abort`, route => {
    aborts.push(route.request().url());
    return route.fulfill({ json: { ok: true } });
  });
  await page.route(`**/api/sessions/${ROOT}/model`, route => {
    const body = route.request().postDataJSON() as { modelId?: unknown } | null;
    modelSwitches.push(body);
    const modelId = typeof body?.modelId === 'string' ? body.modelId : '';
    if (!modelId.includes('/')) {
      return route.fulfill({ status: 400, json: { error: `Invalid model ID: ${modelId}` } });
    }
    return route.fulfill({ json: { success: true } });
  });

  const confirms: string[] = [];
  page.on('dialog', async (dialog) => {
    confirms.push(dialog.message());
    await dialog.accept();
  });

  await fleet.select(fleet.self, ROOT);
  await page.evaluate((id) => {
    window.fixtureSessionListPatch(id, { harnessId: 'agy', isActive: true });
    return fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection());
  }, ROOT);

  // 1. Tasks interactivity inside #subagentsView: Load more, stdin, kill, and direct abort on running tool.
  await page.locator('#sessionRelations .session-relation-tasks-link').click();
  await expect(page.locator('#tasksLogMoreBtn')).toBeVisible();
  await page.locator('#tasksLogMoreBtn').click();
  await expect.poll(() => logUrls.some(u => u.includes('tail=262144'))).toBe(true);

  await page.locator('#tasksStdinInput').fill('rs');
  await page.locator('#tasksStdinSendBtn').click();
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0].message).toContain('send_input');
  expect(prompts[0].message).toContain('coord-native/task-42');

  await page.locator('#tasksKillBtn').click();
  await expect.poll(() => prompts.length).toBe(2);
  expect(prompts[1].message).toContain('Action="kill"');
  expect(prompts[1].message).toContain('coord-native/task-42');

  await page.locator('#subagentsTree [data-task-id="tool-call-1"]').click();
  await expect(page.locator('#tasksAbortTurnBtn')).toBeVisible();
  await page.locator('#tasksAbortTurnBtn').click();
  await expect.poll(() => aborts.length).toBe(1);
  await page.keyboard.press('Escape');

  // 2. Empty Swarm -> Start Swarm form inside #subagentsView dispatches /swarm <task>.
  await page.locator('#promptInput').fill('/swarm board');
  await page.locator('#promptInput').press('Enter');
  await expect(page.locator('#swarmStartInput')).toBeVisible();
  await page.locator('#swarmStartInput').fill('Split API and UI cleanup');
  await page.locator('#swarmStartBtn').click();
  await expect.poll(() => prompts.length).toBe(3);
  expect(prompts[2].message).toBe('/swarm Split API and UI cleanup');

  // 3. Active Swarm with busy coordinator: Stop, Reply, quick-mention pill, @ autocomplete, + Add worker.
  activeSwarm = { ...swarmPayload, coordinatorTurnInProgress: true };
  await page.locator('[data-app-click="reloadSubagentsView"]').click();
  await expect(page.locator('#swarmCoordinatorStopBtn')).toBeVisible();
  await page.locator('#swarmCoordinatorStopBtn').click();
  await expect.poll(() => aborts.length).toBe(2);

  await page.locator('#swarmBoardFeed [data-post-seq="2"] .swarm-post-reply-btn').click();
  await expect(page.locator('#swarmPromptInput')).toHaveValue('@builder (re #2) ');

  await page.locator('#swarmMentionPills .swarm-mention-pill', { hasText: '@#tests' }).click();
  await expect(page.locator('#swarmPromptInput')).toHaveValue('@builder (re #2) @#tests ');

  await page.locator('#swarmPromptInput').fill('Check @nar');
  await expect(page.locator('#swarmMentionMenu')).toBeVisible();
  activeSwarm = { ...activeSwarm, posts: [swarmPayload.posts[0], { ...swarmPayload.posts[1], text: 'Builder posted during mention completion.' }] };
  await page.locator('[data-app-click="reloadSubagentsView"]').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('#swarmBoardFeed')).toContainText('Builder posted during mention completion.');
  await expect(page.locator('#swarmMentionMenu')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#swarmPromptInput')).toHaveValue('Check @narrator ');

  // + Add worker drawer validates duplicate name, Esc dismisses drawer before closing view.
  await page.locator('#subagentsAddWorkerBtn').click();
  await expect(page.locator('#subagentsAddDrawer')).toBeVisible();
  await page.locator('#subagentsAddName').fill('builder');
  await page.locator('#subagentsAddBrief').fill('Duplicate check');
  await page.locator('#subagentsAddSubmitBtn').click();
  await expect(page.locator('#subagentsAddError')).toContainText('already exists');

  await page.keyboard.press('Escape');
  await expect(page.locator('#subagentsAddDrawer')).toBeHidden();
  await expect(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);

  await page.locator('#subagentsAddWorkerBtn').click();
  await page.locator('#subagentsAddName').fill('tester');
  await page.locator('#subagentsAddWorkspace').selectOption('share');
  await page.locator('#subagentsAddBrief').fill('Run integration tests');
  await page.locator('#subagentsAddSubmitBtn').click();
  await expect.poll(() => prompts.length).toBe(4);
  expect(prompts[3].endpoint).toBe('steer');
  expect(prompts[3].message).toContain('name:"tester"');
  expect(prompts[3].message).toContain('workspace:"share"');

  // 4. Selecting @builder in the existing Subagents tree enables its existing signal box, model lock, and Kill warning!
  await page.locator('#subagentsTree .lineage-row', { hasText: '@builder' }).click();
  await expect(page.locator('#subagentsDetailName')).toContainText('@builder');
  await expect(page.locator('#subagentsMemberModelSelect')).toBeDisabled();

  await page.locator('#subagentsSignalInput').fill('Focus on refresh token');
  await page.locator('#subagentsSendBtn').click();
  await expect.poll(() => prompts.length).toBe(5);
  expect(prompts[4].message).toContain('@builder Focus on refresh token');

  await page.locator('#subagentsMemberKillBtn').click();
  await expect.poll(() => prompts.length).toBe(6);
  expect(confirms[confirms.length - 1]).toContain('DELETE');
  expect(prompts[5].message).toContain('action:"kill"');

  // Coordinator model switch hits /model directly with a provider/id selector.
  await page.locator('#subagentsTree .lineage-row', { hasText: 'Coordinator' }).click();
  await expect(page.locator('#subagentsMemberModelSelect')).toBeEnabled();
  await page.locator('#subagentsMemberModelSelect').selectOption('gemini-3.8-flash');
  await expect.poll(() => modelSwitches.length).toBe(1);
  expect(modelSwitches[0]).toEqual({ modelId: 'google-antigravity/gemini-3.8-flash' });

  // Waiting narrator worker: model switch routes via swarm(action:"model") and Ping button is visible.
  await page.locator('#subagentsTree .lineage-row', { hasText: '@narrator' }).click();
  await expect(page.locator('#subagentsMemberPingBtn')).toBeVisible();
  await page.locator('#subagentsMemberModelSelect').selectOption('gemini-4-carbon');
  await expect.poll(() => prompts.length).toBe(7);
  expect(prompts[6].message).toContain('action:"model"');

  // 5. Overview narrator feedback strips @ mentions so workers aren't woken.
  await page.locator('#subagentsTree [data-subagents-aux="swarm-overview"]').click();
  await page.locator('#swarmNarratorFeedbackInput').fill('Mark @builder work as high priority');
  activeSwarm = { ...activeSwarm, plan: { ...swarmPayload.plan, goal: { ...swarmPayload.plan.goal, line: 'Review the refreshed plan' } } };
  await page.locator('[data-app-click="reloadSubagentsView"]').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('#swarmOverviewBody')).toContainText('Review the refreshed plan');
  await expect(page.locator('#swarmNarratorFeedbackInput')).toBeFocused();
  await page.locator('#swarmNarratorFeedbackBtn').click();
  await expect.poll(() => prompts.length).toBe(8);
  expect(prompts[7]).toEqual({
    endpoint: 'steer',
    message: 'Post this verbatim to the swarm board: @narrator user feedback: Mark builder work as high priority',
  });
});

test('Antigravity brain artifacts open in #fileView with local image rewrite, file:// links, and Proceed approval', async ({ page, fleet }) => {
  const brainDir = '/home/tester/.gemini/antigravity-cli/brain/coord-native';
  const planPath = `${brainDir}/implementation_plan.md`;
  const prompts: unknown[] = [];

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
  await page.route(`**/api/sessions/${ROOT}/artifacts`, route => route.fulfill({
    json: {
      supported: true,
      artifacts: [
        {
          name: 'implementation_plan.md',
          path: planPath,
          kind: 'markdown',
          size: 420,
          updatedAt: '2026-11-19T15:00:00Z',
          summary: 'Refactor auth session flow',
          userFacing: true,
          requestFeedback: true,
          artifactType: 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN',
        },
      ],
    },
  }));
  await page.route(`**/api/sessions/${ROOT}/file?*`, route => route.fulfill({
    json: {
      path: planPath,
      relPath: null,
      line: null,
      content: '# Auth Plan\n\n![Arch](arch.png)\n\nSee [auth.ts](file:///repo/auth.ts#L12-L20).\n',
      truncated: false,
      size: 72,
      mtime: 1700000000000,
      artifact: { requestFeedback: true, summary: 'Refactor auth session flow', artifactType: 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN' },
    },
  }));
  await page.route(`**/api/sessions/${ROOT}/file/content*`, route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.route(`**/api/sessions/${ROOT}/prompt`, route => {
    prompts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });

  await fleet.select(fleet.self, ROOT);
  await page.evaluate((id) => {
    window.fixtureSessionListPatch(id, { harnessId: 'agy', isActive: true });
    return fixtureApp.features.sessionInfo.refreshArtifacts(fixtureApp.features.sessionState.captureSelection());
  }, ROOT);

  await expect(page.locator('#btnArtifacts')).toBeVisible();
  await expect(page.locator('#artifactCount')).toHaveText('1');
  await page.locator('#btnArtifacts').click();
  await expect(page.locator('#artifactsBody')).toContainText('implementation_plan.md');
  await expect(page.locator('#artifactsBody')).toContainText('Review');

  await page.locator('#artifactsBody .artifact-brain-open').click();
  await expect(page.locator('#sessionView')).toHaveClass(/\bfile-open\b/);
  await expect(page.locator('#fileViewTitle')).toHaveText('implementation_plan.md');
  await expect(page.locator('#fileViewProceed')).toBeVisible();

  const imgSrc = await page.locator('#fileViewBody img').getAttribute('src');
  expect(imgSrc).toContain(`/api/sessions/${ROOT}/file/content?path=${encodeURIComponent(`${brainDir}/arch.png`)}`);

  const fileLink = page.locator('#fileViewBody .file-link');
  await expect(fileLink).toHaveAttribute('data-file-path', '/repo/auth.ts:12');

  await page.locator('#fileViewProceed').click();
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0]).toEqual({ message: 'Proceed with the plan.' });
  await expect(page.locator('#sessionView')).not.toHaveClass(/\bfile-open\b/);
});

test('2.5s subagents polling preserves focus and draft text in #swarmStartInput and #tasksStdinInput', async ({ page, fleet }) => {
  let swarmPolls = 0;
  let tasksPolls = 0;
  await page.route(`**/api/sessions/${ROOT}/lineage`, route => route.fulfill({ json: lineagePayload }));
  await page.route(`**/api/sessions/${ROOT}/tasks`, route => {
    tasksPolls++;
    return route.fulfill({ json: tasksPayload });
  });
  await page.route(`**/api/sessions/${ROOT}/tasks/task-42/log*`, route => route.fulfill({
    json: { taskId: 'task-42', content: `poll tick ${tasksPolls}\n`, totalBytes: 14, truncated: false, updatedAt: '2026-11-19T14:01:12Z' },
  }));
  await page.route(`**/api/sessions/${ROOT}/swarm*`, route => {
    swarmPolls++;
    return route.fulfill({
      json: {
        supported: true,
        hasSwarm: false,
        isActive: true,
        title: null,
        goal: null,
        head: 0,
        channels: [],
        members: [],
        posts: [],
        groups: [],
        plan: null,
        timeline: [],
      },
    });
  });

  await fleet.select(fleet.self, ROOT);
  await page.evaluate((id) => {
    window.fixtureSessionListPatch(id, { harnessId: 'agy', isActive: true });
    return fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection());
  }, ROOT);
  await page.locator('#promptInput').fill('/swarm board');
  await page.locator('#promptInput').press('Enter');

  // 1. #swarmStartInput keeps its DOM node, focus, and draft across a live poll refresh.
  const startInput = page.locator('#swarmStartInput');
  await expect(startInput).toBeVisible();
  await startInput.click();
  await startInput.fill('Split this refactor across 3 workers');
  const swarmPollsBefore = swarmPolls;
  await page.evaluate(() => {
    Reflect.set(window, '__startInputRef', document.getElementById('swarmStartInput'));
  });
  await expect.poll(() => swarmPolls, { timeout: 6000 }).toBeGreaterThan(swarmPollsBefore);
  await expect(startInput).toHaveValue('Split this refactor across 3 workers');
  expect(await page.evaluate(() => ({
    sameNode: document.getElementById('swarmStartInput') === Reflect.get(window, '__startInputRef'),
    focused: document.activeElement === document.getElementById('swarmStartInput'),
  }))).toEqual({ sameNode: true, focused: true });

  // 2. #tasksStdinInput keeps its DOM node, focus, and draft across a live poll refresh.
  await page.locator('#subagentsTree .lineage-row', { hasText: 'Watch build' }).click();
  const stdinInput = page.locator('#tasksStdinInput');
  await expect(stdinInput).toBeVisible();
  await stdinInput.click();
  await stdinInput.fill('confirm-stdin-draft');
  const tasksPollsBefore = tasksPolls;
  await page.evaluate(() => {
    Reflect.set(window, '__stdinInputRef', document.getElementById('tasksStdinInput'));
  });
  await expect.poll(() => tasksPolls, { timeout: 6000 }).toBeGreaterThan(tasksPollsBefore);
  await expect(stdinInput).toHaveValue('confirm-stdin-draft');
  expect(await page.evaluate(() => ({
    sameNode: document.getElementById('tasksStdinInput') === Reflect.get(window, '__stdinInputRef'),
    focused: document.activeElement === document.getElementById('tasksStdinInput'),
  }))).toEqual({ sameNode: true, focused: true });
});

test('delayed submit ack in #swarmStartInput and #tasksStdinInput does not erase text typed while pending', async ({ page, fleet }) => {
  const promptResolvers: Array<() => void> = [];
  const prompts: string[] = [];
  await page.route(`**/api/sessions/${ROOT}/lineage`, route => route.fulfill({ json: lineagePayload }));
  await page.route(`**/api/sessions/${ROOT}/tasks`, route => route.fulfill({ json: tasksPayload }));
  await page.route(`**/api/sessions/${ROOT}/tasks/task-42/log*`, route => route.fulfill({
    json: { taskId: 'task-42', content: 'running\n', totalBytes: 8, truncated: false, updatedAt: '2026-11-19T14:01:12Z' },
  }));
  await page.route(`**/api/sessions/${ROOT}/swarm*`, route => route.fulfill({
    json: {
      supported: true, hasSwarm: false, isActive: true,
      coordinatorTurnInProgress: false, coordinatorId: ROOT, coordinatorNativeId: 'coord-native',
      title: null, goal: null, head: 0, channels: [], members: [], posts: [], groups: [], plan: null, timeline: [],
    },
  }));
  await page.route(`**/api/sessions/${ROOT}/{prompt,steer}`, async route => {
    const body = route.request().postDataJSON() as { message?: string };
    prompts.push(String(body.message || ''));
    await new Promise<void>(resolve => { promptResolvers.push(resolve); });
    await route.fulfill({ json: { ok: true } });
  });

  await fleet.select(fleet.self, ROOT);
  await page.evaluate((id) => {
    window.fixtureSessionListPatch(id, { harnessId: 'agy', isActive: true });
    return fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection());
  }, ROOT);
  await page.locator('#promptInput').fill('/swarm board');
  await page.locator('#promptInput').press('Enter');

  // 1. Start Swarm: edit while pending -> ack must preserve the new text; unmodified submit clears.
  const startInput = page.locator('#swarmStartInput');
  await expect(startInput).toBeVisible();
  await startInput.fill('First swarm goal');
  await page.locator('#swarmStartBtn').click();
  await expect.poll(() => promptResolvers.length).toBe(1);
  await startInput.fill('Edited while pending');
  promptResolvers.shift()!();
  await expect(page.locator('#swarmStartBtn')).toBeEnabled();
  await expect(startInput).toHaveValue('Edited while pending');

  // Submitting without editing while pending still clears on ack.
  await page.locator('#swarmStartBtn').click();
  await expect.poll(() => promptResolvers.length).toBe(1);
  promptResolvers.shift()!();
  await expect(startInput).toHaveValue('');

  // 2. Tasks stdin: edit while pending -> ack must preserve the new text; unmodified submit clears.
  await page.locator('#subagentsTree .lineage-row', { hasText: 'Watch build' }).click();
  const stdinInput = page.locator('#tasksStdinInput');
  await expect(stdinInput).toBeVisible();
  await stdinInput.fill('first-line');
  await page.locator('#tasksStdinSendBtn').click();
  await expect.poll(() => promptResolvers.length).toBe(1);
  await stdinInput.fill('typed-while-pending');
  promptResolvers.shift()!();
  await page.waitForTimeout(100);
  await expect(stdinInput).toHaveValue('typed-while-pending');

  await page.locator('#tasksStdinSendBtn').click();
  await expect.poll(() => promptResolvers.length).toBe(1);
  promptResolvers.shift()!();
  await expect(stdinInput).toHaveValue('');
  expect(prompts.length).toBe(4);
});

export {};
