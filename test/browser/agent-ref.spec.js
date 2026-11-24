// Generated test/tool from test/browser/agent-ref.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const AGY_LOCAL = '~sk1_' + Buffer.from(JSON.stringify(['agy', 'd46c28bc-43d2-45e2-b941-b9f3c6099ad2'])).toString('base64url');
const OMP_PEER = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-11-23T19-59-55-396Z_01a209fe-6004-728d-a054-3eb58c976ccb'])).toString('base64url');
const GONE_REF = '~sk1_' + Buffer.from(JSON.stringify(['agy', '99999999-aaaa-4bbb-8ccc-111111111111'])).toString('base64url');
(0, fixtures_js_1.test)('bot chat renders spawn_worker and worker-report cards, batches metadata, and opens ~sk1_ and short refs across hosts at phone width', async ({ page, fleet }) => {
    // Start on the Active tab (default real-world state: closed/inactive workers are NOT in sessionState.sessions!).
    await page.locator('#tabActive').click();
    let selfBatchCalls = 0;
    let peerBatchCalls = 0;
    let peerSingleResolveCalls = 0;
    // Serve closed worker sessions via resolve-batch (self) and single-resolve fallback (peer simulates older server skew!).
    await page.route(`${fleet.self.base}/api/sessions/resolve-batch`, async (route) => {
        selfBatchCalls++;
        const body = route.request().postDataJSON();
        const results = {};
        for (const id of body?.ids || []) {
            if (id === AGY_LOCAL) {
                results[id] = {
                    status: 'ok',
                    session: {
                        id: AGY_LOCAL,
                        name: 'Pi-Dish Inline Review UX',
                        harnessId: 'agy',
                        model: 'google-antigravity/gemini-4-carbon',
                        isActive: true,
                        turnInProgress: true,
                    },
                };
            }
            else if (id === fixtures_js_1.CHILD) {
                results[id] = {
                    status: 'ok',
                    session: { id: fixtures_js_1.CHILD, name: 'self child session', harnessId: 'pi', model: 'claude-sonnet-4-6', isActive: false },
                };
            }
            else if (id === '01a2aaaa') {
                results[id] = { status: 'ambiguous', count: 2 };
            }
            else {
                results[id] = { status: 'not_found' };
            }
        }
        await route.fulfill({ json: { results } });
    });
    await page.route(`${fleet.self.base}/api/sessions/resolve?*`, async (route) => {
        const id = new URL(route.request().url()).searchParams.get('id') || '';
        if (id === AGY_LOCAL) {
            return route.fulfill({
                json: {
                    session: {
                        id: AGY_LOCAL,
                        name: 'Pi-Dish Inline Review UX',
                        harnessId: 'agy',
                        model: 'google-antigravity/gemini-4-carbon',
                        isActive: true,
                        turnInProgress: true,
                    },
                },
            });
        }
        if (id === '01a2aaaa') {
            return route.fulfill({ status: 409, json: { error: 'ambiguous session id prefix', matches: [] } });
        }
        return route.fulfill({ status: 404, json: { error: 'Session not found' } });
    });
    await page.route(`${fleet.self.base}/api/sessions/${encodeURIComponent(AGY_LOCAL)}/messages?*`, route => route.fulfill({
        json: { messages: [{ index: 0, role: 'assistant', content: 'Local AGY worker transcript opened!' }], session: { name: 'Pi-Dish Inline Review UX' } },
    }));
    // Peer simulates version skew: POST /api/sessions/resolve-batch returns 404, GET /api/sessions/resolve works!
    await page.route(`${fleet.peer.base}/api/sessions/resolve-batch`, async (route) => {
        peerBatchCalls++;
        await route.fulfill({ status: 404, json: { error: 'Not found' } });
    });
    await page.route(`${fleet.peer.base}/api/sessions/resolve?*`, async (route) => {
        peerSingleResolveCalls++;
        const id = new URL(route.request().url()).searchParams.get('id') || '';
        if (id === OMP_PEER || id === '01a209fe' || id === '01a1fc7c') {
            return route.fulfill({
                json: {
                    session: {
                        id: OMP_PEER,
                        name: 'kit wave1: scout_rifle',
                        harnessId: 'omp',
                        model: 'anthropic/claude-opus-5-5',
                        isActive: false,
                    },
                },
            });
        }
        if (id === '01a2aaaa') {
            return route.fulfill({ status: 409, json: { error: 'ambiguous session id prefix', matches: [] } });
        }
        return route.fulfill({ status: 404, json: { error: 'Session not found' } });
    });
    await page.route(`${fleet.peer.base}/api/sessions/${encodeURIComponent(OMP_PEER)}/messages?*`, route => route.fulfill({
        json: { messages: [{ index: 0, role: 'assistant', content: 'Peer OMP worker transcript opened!' }], session: { name: 'kit wave1: scout_rifle' } },
    }));
    const botMessages = [
        {
            index: 0, role: 'user', timestamp: '2026-11-24T04:40:00.000Z',
            content: 'Spin up the review UX worker and check the peer build.',
        },
        {
            index: 1, role: 'assistant', timestamp: '2026-11-24T04:40:05.000Z',
            content: [
                { type: 'toolCall', id: 'tc-1', name: 'spawn_worker', arguments: { name: 'carbon-review-ux', harness: 'agy', brief: 'Design review UX.' } },
            ],
        },
        {
            index: 2, role: 'toolResult', toolCallId: 'tc-1', toolName: 'spawn_worker', timestamp: '2026-11-24T04:40:06.000Z',
            content: [{ type: 'text', text: `Started worker "carbon-review-ux" (agy). Ref: ${AGY_LOCAL}. Each answer it gives arrives as a "[worker report]" message.` }],
        },
        {
            index: 3, role: 'assistant', timestamp: '2026-11-24T04:40:10.000Z',
            content: [{
                    type: 'text',
                    text: [
                        `Started \`${AGY_LOCAL}\` locally and checking peer/${OMP_PEER} (short ref \`peer/01a1fc7c\`, and #${fixtures_js_1.CHILD}).`,
                        '',
                        `Also checked missing ref \`${GONE_REF}\` and ambiguous \`self/01a2aaaa\`. Commit \`0eea720\` and hash deadbeef stay plain text.`,
                    ].join('\n'),
                }],
        },
        {
            index: 4, role: 'custom', customType: 'bot-worker-report', display: true, timestamp: '2026-11-24T04:45:00.000Z',
            content: [{
                    type: 'text',
                    text: `[worker report] "kit wave1" (peer/${OMP_PEER}) finished.\n\n### Findings\n\nAll **42 tests** passed.\n\nThe session is closed; it is no longer watched.`,
                }],
            details: { ref: `peer/${OMP_PEER}`, name: 'kit wave1', state: 'finished', report: 1 },
        },
        {
            index: 5, role: 'custom', customType: 'bot-worker-report', display: true, timestamp: '2026-11-24T04:45:05.000Z',
            content: [{
                    type: 'text',
                    text: `[worker report] "deep audit" (peer/${OMP_PEER}) finished.\n\n### Long Report\n\n${Array.from({ length: 10 }, (_, i) => `- check ${i + 1}: ok`).join('\n')}\n\nThe session is closed; it is no longer watched.`,
                }],
            details: { ref: `peer/${OMP_PEER}`, name: 'deep audit', state: 'finished', report: 2 },
        },
        {
            index: 6, role: 'assistant', timestamp: '2026-11-24T04:45:10.000Z',
            content: [{ type: 'text', text: 'Done — both workers reported back cleanly.' }],
        },
    ];
    await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/messages?**`, route => route.fulfill({
        json: { messages: botMessages, session: { name: 'pi-dish' } },
    }));
    // Select the bot session directly on the Active tab (without clicking All!).
    await fleet.select(fleet.self, fixtures_js_1.ROOT);
    // 1. spawn_worker renders as an explicit card between turns (NOT buried in details.tool-group).
    const spawnCard = page.locator('#messages > .message.agent-ref-spawn .agent-ref-card');
    await (0, fixtures_js_1.expect)(spawnCard).toHaveCount(1);
    await (0, fixtures_js_1.expect)(spawnCard.locator('.agent-ref-name')).toHaveText('Pi-Dish Inline Review UX');
    await (0, fixtures_js_1.expect)(spawnCard.locator('.agent-ref-state')).toHaveText('working');
    await (0, fixtures_js_1.expect)(spawnCard.locator('.agent-ref-harness')).toHaveText('AGY');
    await (0, fixtures_js_1.expect)(spawnCard.locator('.agent-ref-model')).toHaveText('gemini-4-carbon');
    await (0, fixtures_js_1.expect)(spawnCard.locator('.agent-ref-open')).toBeVisible();
    // 2. [worker report] cards: short report opens by default; long report (>8 lines) starts collapsed and expands on click!
    const reportCards = page.locator('#messages > .message.bot-worker-report .agent-ref-card');
    await (0, fixtures_js_1.expect)(reportCards).toHaveCount(2);
    const reportCard = reportCards.first();
    await (0, fixtures_js_1.expect)(reportCard.locator('.agent-ref-name')).toHaveText('kit wave1: scout_rifle');
    await (0, fixtures_js_1.expect)(reportCard.locator('.agent-ref-state')).toHaveText('finished');
    await (0, fixtures_js_1.expect)(reportCard.locator('.agent-ref-harness')).toHaveText('OMP');
    await (0, fixtures_js_1.expect)(reportCard.locator('.agent-ref-model')).toHaveText('claude-opus-5-5');
    await (0, fixtures_js_1.expect)(reportCard.locator('.agent-ref-host')).toHaveText('peer');
    await (0, fixtures_js_1.expect)(reportCard.locator('details.agent-ref-details')).toHaveAttribute('open', '');
    await (0, fixtures_js_1.expect)(reportCard.locator('.agent-ref-body h3')).toHaveText('Findings');
    await (0, fixtures_js_1.expect)(reportCard.locator('.agent-ref-footer')).toContainText('no longer watched');
    const longReportCard = reportCards.nth(1);
    await (0, fixtures_js_1.expect)(longReportCard.locator('details.agent-ref-details')).not.toHaveAttribute('open', '');
    await longReportCard.locator('.agent-ref-toggle').click();
    await (0, fixtures_js_1.expect)(longReportCard.locator('details.agent-ref-details')).toHaveAttribute('open', '');
    await (0, fixtures_js_1.expect)(longReportCard.locator('.agent-ref-body h3')).toHaveText('Long Report');
    // 3. Inline refs in prose: ~sk1_, peer/~sk1_, peer/01a1fc7c, #CHILD, GONE_REF, and ambiguous self/01a2aaaa are chips; random hex is NOT linkified; peer/01a1fc7c is NOT a file-link!
    const proseMsg = page.locator('#messages .message.assistant').filter({ hasText: 'Started' });
    await (0, fixtures_js_1.expect)(proseMsg.locator('.agent-ref-chip')).toHaveCount(6);
    await (0, fixtures_js_1.expect)(proseMsg.locator('.file-link')).toHaveCount(0);
    const deadbeefButtons = proseMsg.locator('button', { hasText: /0eea720|deadbeef/ });
    await (0, fixtures_js_1.expect)(deadbeefButtons).toHaveCount(0);
    // Degraded chip for gone ref still renders decoded harness + short id + stays clickable without breaking the view.
    const goneChip = proseMsg.locator(`.agent-ref-chip[data-agent-ref="${GONE_REF}"]`);
    await (0, fixtures_js_1.expect)(goneChip).toHaveAttribute('data-agent-state', 'unavailable');
    await (0, fixtures_js_1.expect)(goneChip).toContainText('99999999');
    // Ambiguous chip caches ambiguous status, labels itself "ambiguous ref", and reports "Ambiguous ref" on click.
    const ambiguousChip = proseMsg.locator('.agent-ref-chip[data-agent-ref="self/01a2aaaa"]');
    await (0, fixtures_js_1.expect)(ambiguousChip).toHaveAttribute('data-agent-state', 'ambiguous');
    await (0, fixtures_js_1.expect)(ambiguousChip).toContainText('ambiguous ref');
    // 4. Batching & version-skew verification: self resolved multiple refs in ONE batch; peer fell back after one 404.
    (0, fixtures_js_1.expect)(selfBatchCalls).toBe(1);
    (0, fixtures_js_1.expect)(peerBatchCalls).toBe(1);
    (0, fixtures_js_1.expect)(peerSingleResolveCalls).toBeGreaterThanOrEqual(1);
    // 5. Phone width (390px and 330px): zero horizontal overflow, cards remain visible in focus mode!
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const overflow390 = await page.evaluate(() => {
        const m = document.getElementById('messages');
        return m ? { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth } : null;
    });
    (0, fixtures_js_1.expect)(overflow390.scrollWidth).toBeLessThanOrEqual(overflow390.clientWidth);
    await page.setViewportSize({ width: 330, height: 740 });
    await page.waitForTimeout(100);
    const overflow330 = await page.evaluate(() => {
        const m = document.getElementById('messages');
        return m ? { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth } : null;
    });
    (0, fixtures_js_1.expect)(overflow330.scrollWidth).toBeLessThanOrEqual(overflow330.clientWidth);
    // 6. Clicking the gone ref shows "Session not found", and clicking the ambiguous ref shows "Ambiguous ref", without losing the bot chat.
    await goneChip.click();
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Session not found');
    await ambiguousChip.click();
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Ambiguous ref');
    await (0, fixtures_js_1.expect)(reportCard).toBeVisible();
    // 7. Clicking the worker report's Open button opens the CLOSED peer ~sk1_ session (routed through peer)!
    await reportCard.locator('.agent-ref-open').click();
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('Peer OMP worker transcript opened!');
    // 8. Return to bot chat and open the local ~sk1_ worker via the spawn_worker card's Open button!
    await fleet.select(fleet.self, fixtures_js_1.ROOT);
    await page.locator('#messages > .message.agent-ref-spawn .agent-ref-open').click();
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('Local AGY worker transcript opened!');
    // 9. Return to bot chat and verify short ref regression (`peer/01a1fc7c`) opens the peer session cleanly!
    await fleet.select(fleet.self, fixtures_js_1.ROOT);
    await page.locator('#messages .agent-ref-chip[data-agent-ref="peer/01a1fc7c"]').click();
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('Peer OMP worker transcript opened!');
});
