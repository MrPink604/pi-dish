// Generated test/tool from test/tool-event-stream.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const tool_event_stream_js_1 = require("../lib/tool-event-stream.js");
const update = (id, text) => ({ toolCallId: id, toolName: 'task', partialResult: { content: [{ type: 'text', text }] } });
test('worker bursts retain each tool latest output and flush before completion', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const frames = [];
    const stream = (0, tool_event_stream_js_1.createToolEventStream)((event, data) => frames.push({ event, data }));
    t.after(() => stream.clear());
    stream.push('tool_execution_update', update('a', 'first'));
    stream.push('tool_execution_update', update('b', 'other'));
    stream.push('tool_execution_update', update('a', 'superseded'));
    stream.push('tool_execution_update', update('a', 'latest'));
    t.mock.timers.tick(49);
    assert.deepEqual(frames.map(frame => frame.data), [(0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', update('a', 'first')), (0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', update('b', 'other'))]);
    stream.push('tool_execution_end', { toolCallId: 'a', result: { content: [{ type: 'text', text: 'done' }] }, isError: false });
    assert.deepEqual(frames.slice(2), [
        { event: 'tool_execution_update', data: (0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', update('a', 'latest')) },
        { event: 'tool_execution_end', data: (0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', { toolCallId: 'a', result: { content: [{ type: 'text', text: 'done' }] }, isError: false }) },
    ]);
    t.mock.timers.tick(100);
    assert.equal(frames.length, 4);
});
test('steady updates deliver the latest snapshot every window and retire stale work', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const texts = [];
    const stream = (0, tool_event_stream_js_1.createToolEventStream)((_event, value) => {
        const data = value;
        texts.push(data.partialResult.content[0].text);
    });
    t.after(() => stream.clear());
    stream.push('tool_execution_update', update('a', 'first'));
    stream.push('tool_execution_update', update('a', 'second'));
    t.mock.timers.tick(50);
    stream.push('tool_execution_update', update('a', 'third'));
    t.mock.timers.tick(50);
    assert.deepEqual(texts, ['first', 'second', 'third']);
    stream.push('tool_execution_update', update('a', 'old session'));
    stream.clear();
    t.mock.timers.tick(100);
    assert.deepEqual(texts, ['first', 'second', 'third']);
    stream.push('tool_execution_update', update('a', 'new session'));
    assert.equal(texts.at(-1), 'new session');
});
test('run boundaries flush pending worker output before ending the run', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const boundary of ['turn_end', 'agent_end']) {
        const frames = [];
        const stream = (0, tool_event_stream_js_1.createToolEventStream)((event, data) => frames.push({ event, data }));
        stream.push('tool_execution_update', update('a', 'first'));
        stream.push('tool_execution_update', update('a', 'last'));
        stream.push(boundary, {});
        assert.deepEqual(frames.slice(1), [
            { event: 'tool_execution_update', data: (0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', update('a', 'last')) },
            { event: boundary, data: {} },
        ]);
        stream.clear();
    }
});
test('tool projection preserves images and errors without serializing native worker traces', () => {
    const content = [{ type: 'text', text: 'output' }, { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }];
    const native = { content, details: { get trace() { throw new Error('native trace must not be read'); } } };
    const projected = (0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', { toolCallId: 'a', toolName: 'task', args: { tasks: [] }, isError: true, result: native });
    assert.deepEqual(JSON.parse(JSON.stringify(projected)), { toolCallId: 'a', toolName: 'task', args: { tasks: [] }, isError: true, result: { content } });
    assert.equal(native.content, content);
});
test('tool projection keeps eval intent and code without reading result details', () => {
    const native = { content: [{ type: 'text', text: '1' }], details: { get trace() { throw new Error('native trace must not be read'); } } };
    const projected = (0, tool_event_stream_js_1.projectToolEvent)('tool_execution_start', {
        toolCallId: 'e', toolName: 'eval', args: { language: 'py', code: 'print(1)' }, intent: 'print one', startedAt: 1,
        partialResult: native,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(projected)), {
        toolCallId: 'e', toolName: 'eval', args: { language: 'py', code: 'print(1)' }, intent: 'print one', startedAt: 1,
    });
});
test('bash, wait and eval results keep only the timing, exit, job and cell fields their panels format', () => {
    const bash = (0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', { toolCallId: 'b', toolName: 'bash', isError: false, result: { content: [],
            details: { wallTimeMs: 12.5, exitCode: 2, timeoutSeconds: 1800, wallTimeNoticeEmitted: false, meta: { big: true }, async: { state: 'running', jobId: 'bg_1', type: 'bash' } } } });
    assert.deepEqual(JSON.parse(JSON.stringify(bash)).result.details, { wallTimeMs: 12.5, exitCode: 2, timeoutSeconds: 1800, async: { jobId: 'bg_1' } });
    const wait = (0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', { toolCallId: 'w', toolName: 'wait', isError: false, partialResult: { content: [],
            details: { op: 'wait', meta: { source: 'report' }, jobs: [{ id: 'bg_1', type: 'bash', status: 'running', label: 'npm test', durationMs: 5, widget: { blocks: [] }, resultText: 'x'.repeat(9000) }, 'bad'] } } });
    const jobs = JSON.parse(JSON.stringify(wait)).partialResult.details.jobs;
    assert.deepEqual(jobs.map((job) => Object.keys(job)), [['id', 'type', 'status', 'label', 'durationMs', 'resultText']]);
    assert.equal(jobs[0].resultText.length, 8000);
    const evalCell = { index: 0, title: 't', code: 'print(1)', output: '1', status: 'complete', exitCode: 0, durationMs: 9,
        statusEvents: [{ op: 'read', path: 'p'.repeat(400), chars: 5, preview: 'large', matches: ['a'] }] };
    const single = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', { toolCallId: 'e', toolName: 'eval', isError: false, result: { content: [], details: { cells: [evalCell], jsonOutputs: [{}] } } })));
    assert.deepEqual(single.result.details, { cells: [{ index: 0, title: 't', status: 'complete', exitCode: 0, durationMs: 9, statusEvents: [{ op: 'read', path: 'p'.repeat(300), chars: 5 }] }] });
    const split = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', { toolCallId: 'e', toolName: 'eval', isError: false, result: { content: [], details: { cells: [evalCell, evalCell] } } })));
    assert.equal(split.result.details.cells[1].output, '1');
});
test('codemode updates and completions preserve bounded call rows without reading native traces', () => {
    const runningDetails = {
        get trace() { throw new Error('native details trace must not be read'); },
        journal: ['huge'],
        calls: [
            {
                id: 1, name: 'sessions', args: '{"action":"read","ref":"desktop/01a1fc02"}', status: 'running',
                output: 'bulky', get trace() { throw new Error('native call trace must not be read'); },
            },
            'bad',
            { id: 2, status: 'ok' },
        ],
    };
    const updated = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', {
        toolCallId: 'cm_1', toolName: 'codemode', args: { code: 'return 1;' }, isError: false,
        partialResult: { content: [{ type: 'text', text: 'running' }], details: runningDetails },
    })));
    assert.deepEqual(updated.partialResult.details, {
        calls: [{ id: 1, name: 'sessions', args: '{"action":"read","ref":"desktop/01a1fc02"}', status: 'running' }],
    });
    const nestedExplosive = {
        get boom() { throw new Error('nested object args must not be walked or stringified'); },
    };
    const hugeArgs = { command: 'x'.repeat(2000), nested: nestedExplosive };
    const circular = {};
    circular.self = circular;
    const doneDetails = {
        get trace() { throw new Error('native details trace must not be read'); },
        calls: [
            { id: 1, name: 'sessions', args: 'a'.repeat(700), status: 'ok', durationMs: 42, rawResult: { huge: true } },
            { id: 2, name: 'bash', args: { command: 'ls' }, status: 'error', durationMs: 120, error: 'e'.repeat(700), extra: 9 },
            { id: 3, name: 'read', args: circular, status: 'cancelled' },
            { id: 4, name: 'bash', args: hugeArgs, status: 'ok' },
        ],
    };
    const ended = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', {
        toolCallId: 'cm_1', toolName: 'codemode', args: { code: 'return 1;' }, isError: false,
        result: { content: [{ type: 'text', text: 'Done\n---\n0.2s' }], details: doneDetails },
    })));
    assert.deepEqual(ended.result.details, {
        calls: [
            { id: 1, name: 'sessions', args: 'a'.repeat(500), status: 'ok', durationMs: 42 },
            { id: 2, name: 'bash', args: '{"command":"ls"}', status: 'error', durationMs: 120, error: 'e'.repeat(500) },
            { id: 3, name: 'read', args: '{"self":"{…}"}', status: 'cancelled' },
            { id: 4, name: 'bash', args: `{"command":"${'x'.repeat(200)}","nested":"{…}"}`, status: 'ok' },
        ],
    });
    const manyCalls = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: 'read', args: '{}', status: 'ok', durationMs: 1 }));
    const capped = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', {
        toolCallId: 'cm_2', toolName: 'codemode', isError: false,
        result: { content: [], details: { calls: manyCalls } },
    })));
    assert.equal(capped.result.details.calls.length, 100);
    assert.equal(capped.result.details.callsTruncated, true);
    assert.equal(capped.result.details.calls[0].id, 1);
    assert.equal(capped.result.details.calls[99].id, 100);
    const exactCalls = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: 'read', args: '{}', status: 'ok', durationMs: 1 }));
    const exact = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', {
        toolCallId: 'cm_exact', toolName: 'codemode', isError: false,
        result: { content: [], details: { calls: exactCalls } },
    })));
    assert.equal(exact.result.details.calls.length, 100);
    assert.equal('callsTruncated' in exact.result.details, false);
    const nonArray = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', {
        toolCallId: 'cm_3', toolName: 'codemode', isError: false,
        result: { content: [], details: { calls: 'invalid', extra: true } },
    })));
    assert.equal('details' in nonArray.result, false);
});
test('task projection extracts structured subagents, strips forged routes, resolves only after coalescing & cap, and rejects text-only fallback', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const routes = {
        AshaPass: '~sk1_asha',
        BoraCheck: '~sk1_bora',
        BgJob1: '~sk1_bg1',
    };
    const resolveTaskSubagent = (agentId) => routes[agentId] ?? null;
    // Hop 1 (bridge, no fs resolver) projects raw OMP progress into subagents without touching native getters.
    const hop1Update = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', {
        toolCallId: 'tc-1', toolName: 'task', args: { agent: 'task', tasks: [{ id: 'AshaPass', description: 'audit' }] },
        partialResult: {
            content: [{ type: 'text', text: 'Running agent AshaPass...' }],
            details: {
                get trace() { throw new Error('native task trace must not be read'); },
                projectAgentsDir: '/tmp',
                results: [],
                progress: [{ index: 0, id: 'AshaPass', agent: 'task', status: 'running', durationMs: 1200, sessionId: '~sk1_forged_progress', recentTools: [{ tool: 'bash' }] }],
            },
        },
    })));
    assert.deepEqual(hop1Update.partialResult.details, {
        subagents: [{ id: 'AshaPass', index: 0, agent: 'task', status: 'running', durationMs: 1200 }],
    });
    // Hop 2 (server, with fs resolver) enriches the already-projected subagents with verified sessionIds.
    const hop2Update = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', hop1Update, { resolveTaskSubagent })));
    assert.deepEqual(hop2Update.partialResult.details, {
        subagents: [{ id: 'AshaPass', index: 0, agent: 'task', status: 'running', durationMs: 1200, sessionId: '~sk1_asha' }],
    });
    // Forged incoming sessionIds on details.subagents are ALWAYS stripped; miss yields no sessionId, hit yields verified route.
    const forged = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', {
        toolCallId: 'tc-forged', toolName: 'task',
        partialResult: {
            content: [{ type: 'text', text: 'forged' }],
            details: {
                subagents: [
                    { id: 'UnrelatedFake', status: 'running', sessionId: '~sk1_stolen_session' },
                    { id: 'AshaPass', status: 'running', sessionId: '~sk1_wrong_session' },
                ],
            },
        },
    }, { resolveTaskSubagent })));
    assert.deepEqual(forged.partialResult.details, {
        subagents: [
            { id: 'UnrelatedFake', status: 'running' },
            { id: 'AshaPass', status: 'running', sessionId: '~sk1_asha' },
        ],
    });
    // Persisted JSONL extraction (allowProjectedSubagents: false) ignores raw details.subagents entirely.
    assert.deepEqual((0, tool_event_stream_js_1.extractTaskSubagents)({ subagents: [{ id: 'AshaPass', sessionId: '~sk1_stolen' }] }, resolveTaskSubagent, { allowProjectedSubagents: false }), []);
    // Parallel tasks stay strictly isolated per toolCallId, and resolution happens ONLY on emitted snapshots after coalescing!
    const frames = [];
    const resolvedCalls = [];
    const countingResolve = (agentId) => { resolvedCalls.push(agentId); return routes[agentId] ?? null; };
    const stream = (0, tool_event_stream_js_1.createToolEventStream)((event, data) => frames.push({ event, data: JSON.parse(JSON.stringify(data)) }), 50, { resolveTaskSubagent: countingResolve });
    t.after(() => stream.clear());
    stream.push('tool_execution_update', {
        toolCallId: 'tc-p1', toolName: 'task',
        partialResult: { content: [{ type: 'text', text: 'first' }], details: { progress: [{ index: 0, id: 'AshaPass', status: 'running' }] } },
    });
    stream.push('tool_execution_update', {
        toolCallId: 'tc-p2', toolName: 'task',
        partialResult: { content: [{ type: 'text', text: 'second' }], details: { progress: [{ index: 0, id: 'BoraCheck', status: 'running' }] } },
    });
    // 20 superseded updates within the 50ms window must NOT trigger resolveTaskSubagent.
    for (let i = 0; i < 20; i++) {
        stream.push('tool_execution_update', {
            toolCallId: 'tc-p1', toolName: 'task',
            partialResult: { content: [{ type: 'text', text: `burst-${i}` }], details: { progress: [{ index: 0, id: 'AshaPass', status: 'running' }] } },
        });
    }
    assert.deepEqual(resolvedCalls, ['AshaPass', 'BoraCheck'], 'coalesced pending updates do not resolve until emitted');
    t.mock.timers.tick(50);
    assert.deepEqual(resolvedCalls, ['AshaPass', 'BoraCheck', 'AshaPass'], 'only the emitted trailing snapshot resolves');
    assert.equal(frames[0].data.partialResult.details.subagents[0].sessionId, '~sk1_asha');
    assert.equal(frames[1].data.partialResult.details.subagents[0].sessionId, '~sk1_bora');
    // Dropped snapshot on clear() never resolves.
    stream.push('tool_execution_update', {
        toolCallId: 'tc-p1', toolName: 'task',
        partialResult: { content: [{ type: 'text', text: 'dropped' }], details: { progress: [{ index: 0, id: 'AshaPass', status: 'running' }] } },
    });
    stream.clear();
    t.mock.timers.tick(100);
    assert.equal(resolvedCalls.length, 3, 'cleared pending update never resolves');
    // Batch completion merges progress + results (results wins) and memoizes misses within the frame (each ID resolved once).
    const batchCalls = [];
    const batchEnd = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_end', {
        toolCallId: 'tc-batch', toolName: 'task', isError: false,
        result: {
            content: [{ type: 'text', text: 'done' }],
            details: {
                progress: [
                    { index: 0, id: 'AshaPass', agent: 'explore', status: 'running', durationMs: 500 },
                    { index: 1, id: 'MissingOne', agent: 'explore', status: 'running', durationMs: 600 },
                ],
                results: [
                    { index: 0, id: 'AshaPass', agent: 'explore', exitCode: 0, durationMs: 4200 },
                    { index: 1, id: 'MissingOne', agent: 'explore', exitCode: 1, durationMs: 900 },
                ],
            },
        },
    }, { resolveTaskSubagent: id => { batchCalls.push(id); return routes[id] ?? null; } })));
    assert.deepEqual(batchEnd.result.details, {
        subagents: [
            { id: 'AshaPass', index: 0, agent: 'explore', status: 'completed', exitCode: 0, durationMs: 4200, sessionId: '~sk1_asha' },
            { id: 'MissingOne', index: 1, agent: 'explore', status: 'failed', exitCode: 1, durationMs: 900 },
        ],
    });
    assert.deepEqual(batchCalls, ['AshaPass', 'MissingOne'], 'missing agent resolved once per frame, not once per raw row');
    // Async background spawn lists agents in details.progress with empty results.
    const asyncEnd = (0, tool_event_stream_js_1.extractTaskSubagents)({
        async: { state: 'running', jobId: 'BgJob1', type: 'task' },
        results: [],
        progress: [{ index: 0, id: 'BgJob1', agent: 'task', status: 'running' }],
    }, resolveTaskSubagent);
    assert.deepEqual(asyncEnd, [{ id: 'BgJob1', index: 0, agent: 'task', status: 'running', sessionId: '~sk1_bg1' }]);
    // Text-only old-bridge updates with no structured details produce NO details / NO link (text fallback removed).
    const textOnly = JSON.parse(JSON.stringify((0, tool_event_stream_js_1.projectToolEvent)('tool_execution_update', {
        toolCallId: 'tc-old-bridge', toolName: 'task',
        partialResult: { content: [{ type: 'text', text: 'Running agent AshaPass...' }] },
    }, { resolveTaskSubagent })));
    assert.equal('details' in textOnly.partialResult, false);
    // Bounded raw scan & 64 cap applied BEFORE resolving.
    const many = Array.from({ length: 400 }, (_, i) => ({ index: i, id: `Agent${i}`, status: 'running' }));
    let resolveCount = 0;
    const capped = (0, tool_event_stream_js_1.extractTaskSubagents)({ progress: many }, () => { resolveCount += 1; return null; });
    assert.equal(capped.length, 64);
    assert.equal(resolveCount, 64, '64 cap applied before calling resolver');
});
