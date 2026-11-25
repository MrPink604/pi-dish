// Generated test/tool from test/browser-message-render.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test_types_js_1 = require("./test-types.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require('node:vm');
const context = (0, browser_vm_js_1.browserSandbox)({ atob: globalThis.atob });
const { decodeRenderMessage, shortDisplayRef, parseUserSourceEntries, parseInjectedBotMessage, parseCodemodeResult, formatCodemodeOutput, formatJsonToolOutput, formatBotChangeLineHtml, decodeToolDetails, decodeTaskSubagents, toolCallBodyHtml, codemodeResultChipsHtml, renderTaskSubagentLinkHtml, taskHeaderLinkHtml, taskSubagentBarHtml, taskSubagentCountLabel, } = context.PiDishBrowser;
test('message projection preserves text/image content but narrows identifiers and telemetry', () => {
    const raw = { role: 'assistant', index: '0" onclick="bad', timestamp: 'literal', content: ['plain', { type: 'text', text: 'text' }, { type: 'image', url: '/image', mimeType: 'image/png' }, null],
        usage: { input: '9', output: 4, cacheWrite1h: 3, cost: { total: null, output: 0.1 } }, cacheExpiry: { refreshedAt: 1000, expiresAt: 301000, retentionMs: 300000, retention: '5m', basis: 'fixed', identity: 'private-cache-key' }, durationMs: Infinity };
    const row = decodeRenderMessage(raw);
    assert.equal(row.index, undefined);
    assert.equal(row.timestamp, 'literal');
    assert.equal(row.durationMs, undefined);
    const content = row.content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0], 'plain');
    assert.equal((0, test_types_js_1.record)(content[2]).url, '/image');
    assert.equal(content.length, 3);
    const usage = (0, test_types_js_1.present)(row.usage), cost = (0, test_types_js_1.present)(usage.cost);
    assert.equal(usage.input, undefined);
    assert.equal(cost.total, null);
    raw.usage.cost.output = 99;
    assert.equal(cost.output, 0.1);
    assert.equal(usage.cacheWrite1h, 3);
    assert.equal((0, test_types_js_1.present)(row.cacheExpiry).retention, '5m');
    assert.equal('identity' in (0, test_types_js_1.present)(row.cacheExpiry), false, 'browser projection drops the internal cache identity');
});
test('custom-message projection separates hidden state, structured advisor notes and job metadata', () => {
    const row = decodeRenderMessage({ role: 'custom', display: false, details: { notes: ['plain', { note: '<literal>', severity: 'concern', advisor: 'a' }, { note: {} }], jobs: [{ jobId: 'job', durationMs: 2500 }, { label: {}, durationMs: '3' }], from: 'Main', message: 'body', extra: 'dropped' } });
    const details = (0, test_types_js_1.present)(row.details), notes = (0, test_types_js_1.present)(details.notes), jobs = (0, test_types_js_1.present)(details.jobs);
    assert.equal(row.display, false);
    assert.equal(notes.length, 2);
    assert.equal((0, test_types_js_1.present)(notes[0]).note, 'plain');
    assert.equal((0, test_types_js_1.present)(notes[1]).note, '<literal>');
    assert.equal((0, test_types_js_1.present)(jobs[0]).durationMs, 2500);
    assert.equal((0, test_types_js_1.present)(jobs[1]).label, undefined);
    const empty = decodeRenderMessage({ role: 'assistant', content: [] }).content;
    assert.ok(Array.isArray(empty));
    assert.equal(empty.length, 0);
    assert.equal(details.from, 'Main');
    assert.equal(details.message, 'body');
    assert.equal('extra' in details ? details.extra : undefined, undefined);
    assert.equal(decodeRenderMessage({ role: 'assistant' }).content, undefined);
});
test('message timestamps retain accepted formats without borrowing an external Date', () => {
    const timestamp = vm.runInNewContext('new Date("2026-09-15T12:00:00Z")', context);
    const expected = timestamp.getTime(), row = decodeRenderMessage({ role: 'assistant', timestamp });
    timestamp.setTime(0);
    assert.ok(row.timestamp && typeof row.timestamp === 'object');
    assert.equal(row.timestamp.getTime(), expected);
    assert.equal(decodeRenderMessage({ role: 'assistant', timestamp: expected }).timestamp, expected);
    assert.equal(decodeRenderMessage({ role: 'assistant', timestamp: '2026-09-15T12:00:00Z' }).timestamp, '2026-09-15T12:00:00Z');
});
test('decodeRenderMessage preserves botEvent metadata and codemode sub-call summaries', () => {
    const custom = decodeRenderMessage({
        role: 'custom', customType: 'bot-worker-report',
        details: { ref: 'desktop/01a1fbe8', name: 'audit', state: 'finished', report: 1, ignored: 'nope' },
    });
    const ev = (0, test_types_js_1.present)((0, test_types_js_1.present)(custom.details).botEvent);
    assert.equal(ev.ref, 'desktop/01a1fbe8');
    assert.equal(ev.name, 'audit');
    assert.equal(ev.state, 'finished');
    assert.equal(ev.report, 1);
    const cm = decodeToolDetails('codemode', {
        calls: [
            { id: 1, name: 'sessions', args: JSON.stringify({ action: 'read', ref: '2026-11-21T02-49-16-118Z_01a1fc02-1055-722e-84fc-ff1a34d00ade', limit: 2 }), status: 'ok', durationMs: 250 },
            { id: 2, name: 'sessions', args: JSON.stringify({ action: 'close', ref: 'desktop/01a1fc02' }), status: 'error', durationMs: 400, error: 'ambiguous\nsecond line' },
        ],
    });
    assert.ok(cm && cm.kind === 'codemode');
    assert.equal(cm.calls[0].op, 'sessions');
    assert.equal(cm.calls[0].text, 'read 01a1fc02');
    assert.deepEqual([...cm.calls[0].facts], ['250ms']);
    assert.equal(cm.calls[1].text, 'close desktop/01a1fc02');
    assert.equal(cm.calls[1].error, 'ambiguous');
});
test('shortDisplayRef and parseUserSourceEntries strip noisy ~sk1_ route keys', () => {
    const encoded = '~sk1_WyJvbXAiLCIyMDI2LTExLTE5VDAzLTIzLTQ5LTY5MFpfMDFhMWYxZDQtZmMzYS03Njk0LTkwOWQtZTZjMDkzYTA5NGMzIl0';
    assert.equal(shortDisplayRef(encoded), '01a1f1d4');
    assert.equal(shortDisplayRef('desktop/2026-11-21T02-49-15-846Z_01a1fc02-0f45-76a5-a102-3240a8883b41'), 'desktop/01a1fc02');
    assert.equal(shortDisplayRef('desktop/01a1fbe8'), 'desktop/01a1fbe8');
    const single = parseUserSourceEntries(`[${encoded} · 🧵 ORCH: Build memory · 2026-11-21T02:18:00.958Z]\nFirst check, no workers needed.`);
    assert.ok(single && single.length === 1);
    assert.equal(single[0].ref, encoded);
    assert.equal(single[0].title, '🧵 ORCH: Build memory');
    assert.equal(single[0].body, 'First check, no workers needed.');
    const batch = parseUserSourceEntries(`[${encoded} · ORCH · 2026-11-21T02:18:00.958Z]\nFirst note.\n\n[desktop/01a1fbe8 · Audit · 2026-11-21T02:19:00.000Z]\nSecond note.`);
    assert.ok(batch && batch.length === 2);
    assert.equal(batch[1].ref, 'desktop/01a1fbe8');
    assert.equal(batch[1].body, 'Second note.');
    assert.equal(parseUserSourceEntries('[not a source header]\nhello'), null);
});
test('parseInjectedBotMessage handles every injected bot kind (custom and user-role)', () => {
    const report = parseInjectedBotMessage('bot-worker-report', '[worker report] "audit" (desktop/01a1fbe8) finished.\n\n# Findings\n\nAll good.\n\nThe session is closed; it is no longer watched.');
    assert.ok(report && report.kind === 'worker-report');
    assert.equal(report.sender, 'audit');
    assert.equal(report.ref, 'desktop/01a1fbe8');
    assert.equal(report.status, 'finished');
    assert.equal(report.body, '# Findings\n\nAll good.');
    assert.equal(report.footer, 'The session is closed; it is no longer watched.');
    const failed = parseInjectedBotMessage('bot-worker-report', '[worker report] "audit" (desktop/01a1fbe8) ended with an error.\n\n429 rate limited');
    assert.equal(failed?.status, 'error');
    assert.equal(failed?.statusTone, 'warn');
    const room = parseInjectedBotMessage('bot-room', '[room] Fleet to pi-dish: Both hosts are healthy.\n(Room message 2, hop 1 of at most 4. Reply with room_post only if Fleet needs an answer.)');
    assert.ok(room && room.kind === 'room');
    assert.equal(room.sender, 'Fleet');
    assert.equal(room.recipients, 'pi-dish');
    assert.equal(room.meta, '#2 · hop 1/4');
    assert.equal(room.body, 'Both hosts are healthy.');
    const answer = parseInjectedBotMessage('bot-answer', '[answer from Fleet] to your question "Which host has the GPU?": tycho has the GPU.');
    assert.ok(answer && answer.kind === 'answer');
    assert.equal(answer.sender, 'Fleet');
    assert.equal(answer.question, 'Which host has the GPU?');
    assert.equal(answer.body, 'tycho has the GPU.');
    const routine = parseInjectedBotMessage(undefined, '[routine "nightly-check", 2026-11-21 03:00. Missed while pi-dish was down. This message comes from the routine, not from the user: do what it asks and answer here, in your chat.]\n\nCheck disk space.');
    assert.ok(routine && routine.kind === 'routine');
    assert.equal(routine.sender, 'nightly-check');
    assert.equal(routine.status, 'missed run');
    assert.equal(routine.body, 'Check disk space.');
    const nudge = parseInjectedBotMessage(undefined, "The user hasn't heard from you in a while. Give a brief update.");
    assert.ok(nudge && nudge.kind === 'nudge');
    assert.equal(nudge.label, 'Nudge');
    const cw = parseInjectedBotMessage('bot-context-window', '[Context window 2. Your identity...]\n\nEarlier windows:\n1. Setup');
    assert.ok(cw && cw.kind === 'context-window' && cw.defaultOpen === false && cw.label === 'Context window 2');
    assert.equal(cw.meta, undefined, 'an ordinary rollover has no idle line');
    const expiresAt = Date.UTC(2026, 10, 22, 12, 0);
    const idleWindow = parseInjectedBotMessage('bot-context-window', '[Context window 3. Your identity...]', { botEvent: { idleRollover: true, expiresAt } });
    assert.match(idleWindow?.meta ?? '', /^rolled over before cache expiry at \S/);
    const restart = parseInjectedBotMessage('bot-restart', 'Restarted onto new pi-dish code.', { from: 'abc', botEvent: { to: 'def' } });
    assert.ok(restart && restart.kind === 'restart' && restart.quiet === true && restart.meta === 'build abc → def');
    const limitMsg = decodeRenderMessage({
        role: 'custom',
        customType: 'bot-context-limit',
        content: [{ type: 'text', text: '[pi-dish: this context window is 92% full and your notebook has not been saved in this window.]' }],
        details: { window: 2, percent: 92 },
    });
    assert.equal(limitMsg.details?.botEvent?.window, 2);
    assert.equal(limitMsg.details?.botEvent?.percent, 92);
    const limit = parseInjectedBotMessage('bot-context-limit', '[pi-dish: this context window is 92% full and your notebook has not been saved in this window.]', limitMsg.details);
    assert.ok(limit && limit.kind === 'context-limit');
    assert.equal(limit.label, 'Context limit');
    assert.equal(limit.status, '92% full');
    assert.equal(limit.statusTone, 'warn');
    assert.equal(limit.meta, 'window 2');
    assert.equal(limit.defaultOpen, false);
});
test('codemode result parsing, output formatting, bot tool bodies and places change summaries', () => {
    const parsed = parseCodemodeResult('Script completed\nWall time 1.4 seconds\nOutput:\n\n{"a":1,"b":"two"}');
    assert.ok(parsed && parsed.ok === true && parsed.wallLabel === '1.4s');
    const chips = codemodeResultChipsHtml({ kind: 'codemode', calls: [{ op: 'sessions', facts: [] }] }, parsed, (t, cls) => `[${cls || ''}:${t}]`);
    assert.equal(chips, '[job:1 call][duration:1.4s]');
    const exactDetails = decodeToolDetails('codemode', {
        calls: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: 'read', status: 'ok' })),
    });
    assert.ok(exactDetails && exactDetails.kind === 'codemode');
    assert.equal(codemodeResultChipsHtml(exactDetails, parsed, (t, cls) => `[${cls || ''}:${t}]`), '[job:100 calls][duration:1.4s]');
    const cappedProjected = decodeToolDetails('codemode', {
        calls: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: 'read', status: 'ok' })),
        callsTruncated: true,
    });
    assert.ok(cappedProjected && cappedProjected.kind === 'codemode');
    assert.equal(codemodeResultChipsHtml(cappedProjected, parsed, (t, cls) => `[${cls || ''}:${t}]`), '[job:100+ calls][duration:1.4s]');
    const cappedRaw = decodeToolDetails('codemode', {
        calls: Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: 'read', status: 'ok' })),
    });
    assert.ok(cappedRaw && cappedRaw.kind === 'codemode' && cappedRaw.calls.length === 100);
    assert.equal(codemodeResultChipsHtml(cappedRaw, parsed, (t, cls) => `[${cls || ''}:${t}]`), '[job:100+ calls][duration:1.4s]');
    const jsonOut = formatCodemodeOutput(parsed.output, text => `<p>${text}</p>`);
    assert.equal(jsonOut.kind, 'json');
    assert.match(jsonOut.html, /language-json/);
    assert.equal(jsonOut.lines, 4);
    const mdOut = formatCodemodeOutput('### Host status\n\n- **beelink**: healthy\n- **desktop**: healthy', text => `<md>${text}</md>`);
    assert.equal(mdOut.kind, 'markdown');
    assert.match(mdOut.html, /tool-result-markdown/);
    const rawJson = formatJsonToolOutput('[{"id":1},{"id":2}]');
    assert.ok(rawJson && rawJson.kind === 'json' && rawJson.preview === '[2 items]');
    const spawnBody = toolCallBodyHtml('spawn_worker', { name: 'fix-ui', host: 'desktop', brief: 'Fix it' });
    assert.match(spawnBody, /tool-kv/);
    assert.match(spawnBody, /Fix it/);
    const cmBody = toolCallBodyHtml('codemode', { code: 'return 42;' });
    assert.match(cmBody, /language-javascript/);
    assert.equal(formatBotChangeLineHtml('name: "Fleet" → "Armada"'), 'name: &quot;Fleet&quot; → &quot;Armada&quot;');
    const beforePlaces = JSON.stringify([{ host: null, cwd: '/a', label: 'main' }, { host: 'desktop', cwd: '/b', label: 'desk' }, { host: 'framework', cwd: '/c', label: 'fw' }]);
    const afterPlaces = JSON.stringify([{ host: null, cwd: '/a', label: 'main' }, { host: 'desktop', cwd: '/b', label: 'desk' }, { host: 'framework', cwd: '/c', label: 'fw' }, { host: null, cwd: '/d', label: 'bot-display' }]);
    const placesDiff = formatBotChangeLineHtml(`places: ${beforePlaces} → ${afterPlaces}`);
    assert.match(placesDiff, /\+ bot-display \(\/d\)/);
});
test('task subagent decoding and link rendering handle single, batch, unresolved, XSS, and old-peer skew', () => {
    const subA = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-11-25T01-00-00-000Z_01a2aaaa-0000-7000-8000-000000000001'])).toString('base64url');
    const subB = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-11-25T01-01-00-000Z_01a2bbbb-0000-7000-8000-000000000002'])).toString('base64url');
    // Version skew: raw OMP details without projected `subagents` decode to undefined (no link).
    assert.equal(decodeToolDetails('task', {
        results: [{ index: 0, id: 'AshaPass', exitCode: 0 }],
        progress: [{ index: 0, id: 'AshaPass', status: 'running' }],
    }), undefined);
    // Projected task toolDetails decode cleanly and deduplicate by id.
    const decoded = decodeToolDetails('task', {
        subagents: [
            { id: 'AshaPass', index: 0, agent: 'task', status: 'running', sessionId: subA, extra: 'ignored' },
            { id: 'AshaPass', index: 1, sessionId: subB },
            { id: '', sessionId: subB },
        ],
    });
    assert.ok(decoded && decoded.kind === 'task');
    assert.equal(decoded.subagents.length, 1);
    assert.equal(decoded.subagents[0].id, 'AshaPass');
    assert.equal(decoded.subagents[0].sessionId, subA);
    // decodeRenderMessage keeps taskSubagents on task toolCall blocks only.
    const assistant = decodeRenderMessage({
        role: 'assistant',
        content: [
            { type: 'toolCall', id: 'tc-1', name: 'task', arguments: { tasks: [] }, taskSubagents: [{ id: 'AshaPass', sessionId: subA }] },
            { type: 'toolCall', id: 'tc-2', name: 'bash', arguments: { command: 'ls' }, taskSubagents: [{ id: 'Ignored', sessionId: subB }] },
        ],
    });
    assert.ok(Array.isArray(assistant.content));
    const taskBlock = (0, test_types_js_1.record)(assistant.content[0]);
    const bashBlock = (0, test_types_js_1.record)(assistant.content[1]);
    assert.equal(Array.isArray(taskBlock.taskSubagents) && taskBlock.taskSubagents.length, 1);
    assert.equal(bashBlock.taskSubagents, undefined);
    // Unresolved subagent (missing sessionId) produces NO link.
    assert.equal(renderTaskSubagentLinkHtml({ id: 'AshaPass', status: 'running' }), '');
    assert.equal(taskHeaderLinkHtml([{ id: 'AshaPass', status: 'running' }]), '');
    // Single resolved subagent produces header chip with host context, working hint, preserve-label, and arrow.
    const singleHtml = taskHeaderLinkHtml([{ id: 'AshaPass', agent: 'explore', status: 'running', sessionId: subA }], {
        hostId: 'desktop-host-id', running: true,
    });
    assert.match(singleHtml, /class="agent-ref agent-ref-chip task-subagent-link"/);
    assert.match(singleHtml, new RegExp(`data-agent-ref="${subA}"`));
    assert.match(singleHtml, /data-session-host="desktop-host-id"/);
    assert.match(singleHtml, /data-agent-context-host="desktop-host-id"/);
    assert.match(singleHtml, /data-agent-state="working"/);
    assert.match(singleHtml, /data-agent-spawn="1"/);
    assert.match(singleHtml, /data-agent-preserve-label="1"/);
    assert.match(singleHtml, /AshaPass/);
    assert.match(singleHtml, /↗/);
    // Multi-subagent batch renders count + chip bar, not a single header chip.
    const batch = decodeTaskSubagents([
        { id: 'AshaPass', status: 'completed', sessionId: subA },
        { id: 'Bora<img src=x>', status: 'completed', sessionId: subB },
        { id: 'Unready', status: 'running' },
    ]);
    assert.equal(taskHeaderLinkHtml(batch), '');
    assert.equal(taskSubagentCountLabel(batch), '2 subagents');
    const barHtml = taskSubagentBarHtml(batch, { hostId: 'desktop-host-id' });
    assert.match(barHtml, /class="task-subagent-bar"/);
    assert.match(barHtml, /AshaPass/);
    assert.match(barHtml, /Bora&lt;img src=x&gt;/);
    assert.doesNotMatch(barHtml, /<img/);
    assert.doesNotMatch(barHtml, /Unready/);
});
