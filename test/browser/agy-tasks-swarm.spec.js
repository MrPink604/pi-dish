// Generated test/tool from test/browser/agy-tasks-swarm.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
fixtures_js_1.test.use({ liveSessions: true });
const AGY_SUB = 'agy-subagent-1';
const AGY_WORKER = 'agy-worker-1';
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
        coordinatorId: fixtures_js_1.ROOT,
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
    coordinatorTurnInProgress: false,
    coordinatorId: fixtures_js_1.ROOT,
    coordinatorNativeId: 'coord-native',
    title: 'Fix auth',
    head: 2,
    members: [
        {
            name: 'coordinator',
            conversationId: 'coord-native',
            routeId: fixtures_js_1.ROOT,
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
            routeId: 'agy-narrator-1',
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
    session: { id: fixtures_js_1.ROOT, name: 'Coordinator', harnessId: 'agy', isActive: true },
    tree: {
        session: { id: fixtures_js_1.ROOT, name: 'Coordinator', harnessId: 'agy', isActive: true },
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
(0, fixtures_js_1.test)('Antigravity tasks and swarm header chips, takeovers, slash commands, and inline /swarm board links work end-to-end', async ({ page, fleet }) => {
    await page.route('**/api/sessions', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const list of [body.active, body.previous]) {
            if (!Array.isArray(list))
                continue;
            for (const item of list) {
                if (item && item.id === fixtures_js_1.ROOT)
                    item.harnessId = 'agy';
            }
        }
        await route.fulfill({ response, json: body });
    });
    await page.route('**/api/sessions?*', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const list of [body.active, body.previous]) {
            if (!Array.isArray(list))
                continue;
            for (const item of list) {
                if (item && item.id === fixtures_js_1.ROOT)
                    item.harnessId = 'agy';
            }
        }
        await route.fulfill({ response, json: body });
    });
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/lineage`, route => route.fulfill({ json: lineagePayload }));
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/tasks`, route => route.fulfill({ json: tasksPayload }));
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/tasks/task-42/log`, route => route.fulfill({
        json: { taskId: 'task-42', content: 'watching build...\npass 1/2\n', totalBytes: 27, truncated: false, updatedAt: '2026-11-19T14:01:12Z' },
    }));
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/swarm*`, route => route.fulfill({ json: swarmPayload }));
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
    const prompts = [];
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/prompt`, route => {
        prompts.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
    });
    await fleet.select(fleet.self, fixtures_js_1.ROOT);
    // Mark the selected session as an active agy session and reload relations.
    await page.evaluate((id) => {
        window.fixtureSessionListPatch(id, { harnessId: 'agy', isActive: true });
        return fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection());
    }, fixtures_js_1.ROOT);
    // Header shows Subagents, Tasks, and Swarm chips.
    await (0, fixtures_js_1.expect)(page.locator('#sessionRelations .session-relation-tree-link')).toContainText('Subagents · 2');
    await (0, fixtures_js_1.expect)(page.locator('#sessionRelations .session-relation-tasks-link')).toContainText('Tasks · 2 running');
    await (0, fixtures_js_1.expect)(page.locator('#sessionRelations .session-relation-swarm-link')).toContainText('Swarm · Fix auth');
    // Click Tasks chip -> renders Plan, Background tasks, live log tail, and subagent jump.
    await page.locator('#sessionRelations .session-relation-tasks-link').click();
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/\btasks-open\b/);
    await (0, fixtures_js_1.expect)(page.locator('#tasksList')).toContainText('Ship auth patch');
    await (0, fixtures_js_1.expect)(page.locator('#tasksList')).toContainText('Watch build');
    await (0, fixtures_js_1.expect)(page.locator('#tasksDetailLog')).toContainText('pass 1/2');
    // Clicking a non-swarm subagent row jumps into Subagents takeover focused on that child.
    await page.locator('#tasksList .tasks-subagent-row', { hasText: 'Codebase Researcher' }).click();
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/\bsubagents-open\b/);
    await (0, fixtures_js_1.expect)(page.locator('#subagentsDetailName')).toContainText('Codebase Researcher');
    await (0, fixtures_js_1.expect)(page.locator('#subagentsTrace')).toContainText('Researcher audited login.ts.');
    await page.keyboard.press('Escape');
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/\bsubagents-open\b/);
    // Typing /tasks opens Tasks view locally without hitting /command.
    await page.locator('#promptInput').fill('/tasks');
    await page.locator('#promptInput').press('Enter');
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/\btasks-open\b/);
    await page.keyboard.press('Escape');
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/\btasks-open\b/);
    // Typing /swarm board opens Swarm view locally.
    await page.locator('#promptInput').fill('/swarm board');
    await page.locator('#promptInput').press('Enter');
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/\bswarm-open\b/);
    await (0, fixtures_js_1.expect)(page.locator('#swarmViewTitle')).toContainText('Swarm · Fix auth');
    await (0, fixtures_js_1.expect)(page.locator('#swarmBoardFeed .swarm-post')).toHaveCount(2);
    // Channel filter isolates #tests post.
    await page.locator('#swarmBoardFilters .swarm-filter-chip', { hasText: '#tests' }).click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmBoardFeed .swarm-post')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('#swarmBoardFeed')).toContainText('patched auth.ts');
    // Members tab shows live worker trace peek.
    await page.locator('#swarmTabMembers').click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmMemberDetailName')).toContainText('@builder');
    await (0, fixtures_js_1.expect)(page.locator('#swarmMemberTrace')).toContainText('Builder trace output verified.');
    // Overview tab renders goal + attention ref #1, and clicking #1 jumps back to Board.
    await page.locator('#swarmTabOverview').click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmOverviewBody')).toContainText('Review auth patch');
    await page.locator('#swarmOverviewBody button.swarm-filter-chip', { hasText: '#1' }).click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmPaneBoard')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#swarmBoardFeed [data-post-seq="1"]')).toBeVisible();
    // Coordinator composer sends prompt to coordinator route.
    await page.locator('#swarmPromptInput').fill('Wrap up and merge');
    await page.locator('#swarmPromptSendBtn').click();
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(1);
    (0, fixtures_js_1.expect)(prompts[0]).toEqual({ message: 'Wrap up and merge' });
    await page.keyboard.press('Escape');
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/\bswarm-open\b/);
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
    await (0, fixtures_js_1.expect)(inlineBtn).toHaveText('/swarm board');
    await inlineBtn.click();
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/\bswarm-open\b/);
    // Switching to another session closes the Swarm takeover cleanly.
    await fleet.select(fleet.self, fixtures_js_1.CHILD);
    await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/\bswarm-open\b/);
});
(0, fixtures_js_1.test)('Interactive Swarm and Tasks controls dispatch coordinator actions, direct aborts/model switches, and start-swarm', async ({ page, fleet }) => {
    let activeSwarm = {
        supported: true,
        hasSwarm: false,
        isActive: true,
        coordinatorTurnInProgress: false,
        coordinatorId: fixtures_js_1.ROOT,
        coordinatorNativeId: 'coord-native',
        title: '',
        head: 0,
        members: [],
        channels: [],
        posts: [],
        plan: null,
        narratorView: null,
    };
    const prompts = [];
    const aborts = [];
    const modelSwitches = [];
    const logUrls = [];
    await page.route('**/api/sessions', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const list of [body.active, body.previous]) {
            if (!Array.isArray(list))
                continue;
            for (const item of list) {
                if (item && item.id === fixtures_js_1.ROOT)
                    item.harnessId = 'agy';
            }
        }
        await route.fulfill({ response, json: body });
    });
    await page.route('**/api/sessions?*', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const list of [body.active, body.previous]) {
            if (!Array.isArray(list))
                continue;
            for (const item of list) {
                if (item && item.id === fixtures_js_1.ROOT)
                    item.harnessId = 'agy';
            }
        }
        await route.fulfill({ response, json: body });
    });
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/lineage`, route => route.fulfill({ json: lineagePayload }));
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/tasks`, route => route.fulfill({ json: tasksPayload }));
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/tasks/task-42/log*`, route => {
        logUrls.push(route.request().url());
        return route.fulfill({
            json: { taskId: 'task-42', content: 'watching build...\npass 1/2\n', totalBytes: 200_000, truncated: !route.request().url().includes('tail='), updatedAt: '2026-11-19T14:01:12Z' },
        });
    });
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/swarm*`, route => route.fulfill({ json: activeSwarm }));
    await page.route(`**/api/models?sessionId=${fixtures_js_1.ROOT}*`, route => route.fulfill({
        json: [
            { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', provider: 'google-antigravity' },
            { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'google-antigravity' },
        ],
    }));
    await page.route(`**/api/sessions/${AGY_WORKER}/messages*`, route => route.fulfill({ json: { messages: [], lastIndex: null } }));
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/messages*`, route => route.fulfill({ json: { messages: [], lastIndex: null } }));
    await page.route(`**/api/sessions/agy-narrator-1/messages*`, route => route.fulfill({ json: { messages: [], lastIndex: null } }));
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/prompt`, route => {
        const body = route.request().postDataJSON();
        prompts.push({ endpoint: 'prompt', message: String(body?.message ?? '') });
        return route.fulfill({ json: { ok: true } });
    });
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/steer`, route => {
        const body = route.request().postDataJSON();
        prompts.push({ endpoint: 'steer', message: String(body?.message ?? '') });
        return route.fulfill({ json: { ok: true } });
    });
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/abort`, route => {
        aborts.push(route.request().url());
        return route.fulfill({ json: { ok: true } });
    });
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/model`, route => {
        modelSwitches.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
    });
    // Accept confirm dialogs and record prompt text so we verify workspace warning.
    const confirms = [];
    page.on('dialog', async (dialog) => {
        confirms.push(dialog.message());
        await dialog.accept();
    });
    await fleet.select(fleet.self, fixtures_js_1.ROOT);
    await page.evaluate((id) => {
        window.fixtureSessionListPatch(id, { harnessId: 'agy', isActive: true });
        return fixtureApp.features.sessionRelationsController.load(fixtureApp.features.sessionState.captureSelection());
    }, fixtures_js_1.ROOT);
    // 1. Tasks interactivity: Load more, stdin, kill, and direct abort on running tool.
    await page.locator('#sessionRelations .session-relation-tasks-link').click();
    await (0, fixtures_js_1.expect)(page.locator('#tasksLogMoreBtn')).toBeVisible();
    await page.locator('#tasksLogMoreBtn').click();
    await fixtures_js_1.expect.poll(() => logUrls.some(u => u.includes('tail=262144'))).toBe(true);
    await page.locator('#tasksStdinInput').fill('rs');
    await page.locator('#tasksStdinSendBtn').click();
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(1);
    (0, fixtures_js_1.expect)(prompts[0].message).toContain('send_input');
    (0, fixtures_js_1.expect)(prompts[0].message).toContain('coord-native/task-42');
    await page.locator('#tasksKillBtn').click();
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(2);
    (0, fixtures_js_1.expect)(prompts[1].message).toContain('Action="kill"');
    (0, fixtures_js_1.expect)(prompts[1].message).toContain('coord-native/task-42');
    await page.locator('#tasksList .tasks-row[data-task-id="tool-call-1"]').click();
    await (0, fixtures_js_1.expect)(page.locator('#tasksAbortTurnBtn')).toBeVisible();
    await page.locator('#tasksAbortTurnBtn').click();
    await fixtures_js_1.expect.poll(() => aborts.length).toBe(1);
    await page.keyboard.press('Escape');
    // 2. Empty Swarm -> Start Swarm form dispatches /swarm <task>.
    await page.locator('#promptInput').fill('/swarm board');
    await page.locator('#promptInput').press('Enter');
    await (0, fixtures_js_1.expect)(page.locator('#swarmStartInput')).toBeVisible();
    await page.locator('#swarmStartInput').fill('Split API and UI cleanup');
    await page.locator('#swarmStartBtn').click();
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(3);
    (0, fixtures_js_1.expect)(prompts[2].message).toBe('/swarm Split API and UI cleanup');
    // 3. Active Swarm with busy coordinator: Stop, Reply, quick-mention pill, @ autocomplete, + Add worker.
    activeSwarm = { ...swarmPayload, coordinatorTurnInProgress: true };
    await page.locator('[data-app-click="reloadSwarmView"]').click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmCoordinatorStopBtn')).toBeVisible();
    await page.locator('#swarmCoordinatorStopBtn').click();
    await fixtures_js_1.expect.poll(() => aborts.length).toBe(2);
    // Reply button prefills @builder (re #2).
    await page.locator('#swarmBoardFeed [data-post-seq="2"] .swarm-post-reply-btn').click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmPromptInput')).toHaveValue('@builder (re #2) ');
    // Quick-mention pill appends @#tests.
    await page.locator('#swarmMentionPills .swarm-mention-pill', { hasText: '@#tests' }).click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmPromptInput')).toHaveValue('@builder (re #2) @#tests ');
    // @ autocomplete menu pops up and Enter inserts token.
    await page.locator('#swarmPromptInput').fill('Check @nar');
    await (0, fixtures_js_1.expect)(page.locator('#swarmMentionMenu')).toBeVisible();
    await page.locator('#swarmPromptInput').press('Enter');
    await (0, fixtures_js_1.expect)(page.locator('#swarmPromptInput')).toHaveValue('Check @narrator ');
    // + Add worker drawer validates reserved/duplicate name, then spawns new worker via steer.
    await page.locator('#swarmAddWorkerBtn').click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmAddDrawer')).toBeVisible();
    await page.locator('#swarmAddName').fill('builder');
    await page.locator('#swarmAddBrief').fill('Duplicate check');
    await page.locator('#swarmAddSubmitBtn').click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmAddError')).toContainText('already exists');
    // Escape dismisses Add worker drawer without closing Swarm view.
    await page.keyboard.press('Escape');
    await (0, fixtures_js_1.expect)(page.locator('#swarmAddDrawer')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/\bswarm-open\b/);
    await page.locator('#swarmAddWorkerBtn').click();
    await page.locator('#swarmAddName').fill('tester');
    await page.locator('#swarmAddWorkspace').selectOption('share');
    await page.locator('#swarmAddBrief').fill('Run integration tests');
    await page.locator('#swarmAddSubmitBtn').click();
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(4);
    (0, fixtures_js_1.expect)(prompts[3].endpoint).toBe('steer');
    (0, fixtures_js_1.expect)(prompts[3].message).toContain('name:"tester"');
    (0, fixtures_js_1.expect)(prompts[3].message).toContain('workspace:"share"');
    // 4. Members tab: working worker's model select is disabled; inline message, kill with workspace warning, coordinator direct model switch.
    await page.locator('#swarmTabMembers').click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmMemberDetailName')).toContainText('@builder');
    await (0, fixtures_js_1.expect)(page.locator('#swarmMemberModelSelect')).toBeDisabled();
    await page.locator('#swarmMemberInput').fill('Focus on refresh token');
    await page.locator('#swarmMemberSendBtn').click();
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(5);
    (0, fixtures_js_1.expect)(prompts[4].message).toContain('@builder Focus on refresh token');
    await page.locator('#swarmMemberKillBtn').click();
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(6);
    (0, fixtures_js_1.expect)(confirms[confirms.length - 1]).toContain('DELETE');
    (0, fixtures_js_1.expect)(prompts[5].message).toContain('action:"kill"');
    // Coordinator model switch hits /model directly.
    await page.locator('#swarmMembersList .swarm-member-row', { hasText: 'coordinator' }).click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmMemberModelSelect')).toBeEnabled();
    await page.locator('#swarmMemberModelSelect').selectOption('gemini-3.8-flash');
    await fixtures_js_1.expect.poll(() => modelSwitches.length).toBe(1);
    (0, fixtures_js_1.expect)(modelSwitches[0]).toEqual({ provider: 'google-antigravity', modelId: 'gemini-3.8-flash' });
    // Waiting narrator worker: model switch routes via swarm(action:"model") and Ping button is visible.
    await page.locator('#swarmMembersList .swarm-member-row', { hasText: '@narrator' }).click();
    await (0, fixtures_js_1.expect)(page.locator('#swarmMemberPingBtn')).toBeVisible();
    await page.locator('#swarmMemberModelSelect').selectOption('gemini-4-carbon');
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(7);
    (0, fixtures_js_1.expect)(prompts[6].message).toContain('action:"model"');
    // 5. Overview tab narrator feedback strips @ mentions so workers aren't woken.
    await page.locator('#swarmTabOverview').click();
    await page.locator('#swarmNarratorFeedbackInput').fill('Mark @builder work as high priority');
    await page.locator('#swarmNarratorFeedbackBtn').click();
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(8);
    (0, fixtures_js_1.expect)(prompts[7].message).toContain('@narrator user feedback: Mark builder work as high priority');
});
(0, fixtures_js_1.test)('Antigravity brain artifacts open in #fileView with local image rewrite, file:// links, and Proceed approval', async ({ page, fleet }) => {
    const brainDir = '/home/tester/.gemini/antigravity-cli/brain/coord-native';
    const planPath = `${brainDir}/implementation_plan.md`;
    const prompts = [];
    await page.route('**/api/sessions', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const list of [body.active, body.previous]) {
            if (!Array.isArray(list))
                continue;
            for (const item of list) {
                if (item && item.id === fixtures_js_1.ROOT)
                    item.harnessId = 'agy';
            }
        }
        await route.fulfill({ response, json: body });
    });
    await page.route('**/api/sessions?*', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const list of [body.active, body.previous]) {
            if (!Array.isArray(list))
                continue;
            for (const item of list) {
                if (item && item.id === fixtures_js_1.ROOT)
                    item.harnessId = 'agy';
            }
        }
        await route.fulfill({ response, json: body });
    });
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/artifacts`, route => route.fulfill({
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
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/file?*`, route => route.fulfill({
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
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/file/content*`, route => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    }));
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/prompt`, route => {
        prompts.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
    });
    await fleet.select(fleet.self, fixtures_js_1.ROOT);
    await page.evaluate((id) => {
        window.fixtureSessionListPatch(id, { harnessId: 'agy', isActive: true });
        return fixtureApp.features.sessionInfo.refreshArtifacts(fixtureApp.features.sessionState.captureSelection());
    }, fixtures_js_1.ROOT);
    // Artifacts badge lights up with count 1 and modal lists the brain artifact.
    await (0, fixtures_js_1.expect)(page.locator('#btnArtifacts')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#artifactCount')).toHaveText('1');
    await page.locator('#btnArtifacts').click();
    await (0, fixtures_js_1.expect)(page.locator('#artifactsBody')).toContainText('implementation_plan.md');
    await (0, fixtures_js_1.expect)(page.locator('#artifactsBody')).toContainText('Review');
    // Clicking brain artifact opens #fileView, rewrites relative local img src, linkifies file:// URI, and shows Proceed.
    await page.locator('#artifactsBody .artifact-brain-open').click();
    await (0, fixtures_js_1.expect)(page.locator('#sessionView')).toHaveClass(/\bfile-open\b/);
    await (0, fixtures_js_1.expect)(page.locator('#fileViewTitle')).toHaveText('implementation_plan.md');
    await (0, fixtures_js_1.expect)(page.locator('#fileViewProceed')).toBeVisible();
    const imgSrc = await page.locator('#fileViewBody img').getAttribute('src');
    (0, fixtures_js_1.expect)(imgSrc).toContain(`/api/sessions/${fixtures_js_1.ROOT}/file/content?path=${encodeURIComponent(`${brainDir}/arch.png`)}`);
    const fileLink = page.locator('#fileViewBody .file-link');
    await (0, fixtures_js_1.expect)(fileLink).toHaveAttribute('data-file-path', '/repo/auth.ts:12');
    // Clicking Proceed sends prompt and closes #fileView.
    await page.locator('#fileViewProceed').click();
    await fixtures_js_1.expect.poll(() => prompts.length).toBe(1);
    (0, fixtures_js_1.expect)(prompts[0]).toEqual({ message: 'Proceed with the plan.' });
    await (0, fixtures_js_1.expect)(page.locator('#sessionView')).not.toHaveClass(/\bfile-open\b/);
});
