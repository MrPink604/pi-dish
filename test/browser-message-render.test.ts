import { browserSandbox } from './browser-vm.js';
import { present, record } from './test-types.js';
import test = require('node:test');
import assert = require('node:assert/strict');
const vm: typeof import('node:vm') = require('node:vm');
const context = browserSandbox({ atob: globalThis.atob });
const {
  decodeRenderMessage, shortDisplayRef, parseUserSourceEntries, parseInjectedBotMessage,
  parseCodemodeResult, formatCodemodeOutput, formatJsonToolOutput, formatBotChangeLineHtml,
  decodeToolDetails, toolCallBodyHtml, codemodeResultChipsHtml,
} = context.PiDishBrowser;
test('message projection preserves text/image content but narrows identifiers and telemetry', () => {
  const raw = { role: 'assistant', index: '0" onclick="bad', timestamp: 'literal', content: ['plain', { type: 'text', text: 'text' }, { type: 'image', url: '/image', mimeType: 'image/png' }, null],
    usage: { input: '9', output: 4, cacheWrite1h: 3, cost: { total: null, output: 0.1 } }, cacheExpiry: { refreshedAt: 1000, expiresAt: 301000, retentionMs: 300000, retention: '5m', basis: 'fixed', identity: 'private-cache-key' }, durationMs: Infinity };
  const row = decodeRenderMessage(raw); assert.equal(row.index, undefined); assert.equal(row.timestamp, 'literal'); assert.equal(row.durationMs, undefined);
  const content = row.content; assert.ok(Array.isArray(content));
  assert.equal(content[0], 'plain'); assert.equal(record(content[2]).url, '/image'); assert.equal(content.length, 3);
  const usage = present(row.usage), cost = present(usage.cost);
  assert.equal(usage.input, undefined); assert.equal(cost.total, null); raw.usage.cost.output = 99; assert.equal(cost.output, 0.1);
  assert.equal(usage.cacheWrite1h, 3); assert.equal(present(row.cacheExpiry).retention, '5m');
  assert.equal('identity' in present(row.cacheExpiry), false, 'browser projection drops the internal cache identity');
});
test('custom-message projection separates hidden state, structured advisor notes and job metadata', () => {
  const row = decodeRenderMessage({ role: 'custom', display: false, details: { notes: ['plain', { note: '<literal>', severity: 'concern', advisor: 'a' }, { note: {} }], jobs: [{ jobId: 'job', durationMs: 2500 }, { label: {}, durationMs: '3' }], from: 'Main', message: 'body', extra: 'dropped' } });
  const details = present(row.details), notes = present(details.notes), jobs = present(details.jobs);
  assert.equal(row.display, false); assert.equal(notes.length, 2); assert.equal(present(notes[0]).note, 'plain'); assert.equal(present(notes[1]).note, '<literal>');
  assert.equal(present(jobs[0]).durationMs, 2500); assert.equal(present(jobs[1]).label, undefined);
  const empty = decodeRenderMessage({ role: 'assistant', content: [] }).content; assert.ok(Array.isArray(empty)); assert.equal(empty.length, 0);
  assert.equal(details.from, 'Main'); assert.equal(details.message, 'body'); assert.equal('extra' in details ? details.extra : undefined, undefined);
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
  const ev = present(present(custom.details).botEvent);
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

  const batch = parseUserSourceEntries(
    `[${encoded} · ORCH · 2026-11-21T02:18:00.958Z]\nFirst note.\n\n[desktop/01a1fbe8 · Audit · 2026-11-21T02:19:00.000Z]\nSecond note.`,
  );
  assert.ok(batch && batch.length === 2);
  assert.equal(batch[1].ref, 'desktop/01a1fbe8');
  assert.equal(batch[1].body, 'Second note.');

  assert.equal(parseUserSourceEntries('[not a source header]\nhello'), null);
});

test('parseInjectedBotMessage handles every injected bot kind (custom and user-role)', () => {
  const report = parseInjectedBotMessage(
    'bot-worker-report',
    '[worker report] "audit" (desktop/01a1fbe8) finished.\n\n# Findings\n\nAll good.\n\nThe session is closed; it is no longer watched.',
  );
  assert.ok(report && report.kind === 'worker-report');
  assert.equal(report.sender, 'audit');
  assert.equal(report.ref, 'desktop/01a1fbe8');
  assert.equal(report.status, 'finished');
  assert.equal(report.body, '# Findings\n\nAll good.');
  assert.equal(report.footer, 'The session is closed; it is no longer watched.');

  const room = parseInjectedBotMessage(
    'bot-room',
    '[room] Fleet to pi-dish: Both hosts are healthy.\n(Room message 2, hop 1 of at most 4. Reply with room_post only if Fleet needs an answer.)',
  );
  assert.ok(room && room.kind === 'room');
  assert.equal(room.sender, 'Fleet');
  assert.equal(room.recipients, 'pi-dish');
  assert.equal(room.meta, '#2 · hop 1/4');
  assert.equal(room.body, 'Both hosts are healthy.');

  const answer = parseInjectedBotMessage(
    'bot-answer',
    '[answer from Fleet] to your question "Which host has the GPU?": tycho has the GPU.',
  );
  assert.ok(answer && answer.kind === 'answer');
  assert.equal(answer.sender, 'Fleet');
  assert.equal(answer.question, 'Which host has the GPU?');
  assert.equal(answer.body, 'tycho has the GPU.');

  const routine = parseInjectedBotMessage(
    undefined,
    '[routine "nightly-check", 2026-11-21 03:00. Missed while pi-dish was down. This message comes from the routine, not from the user: do what it asks and answer here, in your chat.]\n\nCheck disk space.',
  );
  assert.ok(routine && routine.kind === 'routine');
  assert.equal(routine.sender, 'nightly-check');
  assert.equal(routine.status, 'missed run');
  assert.equal(routine.body, 'Check disk space.');

  const nudge = parseInjectedBotMessage(undefined, "The user hasn't heard from you in a while. Give a brief update.");
  assert.ok(nudge && nudge.kind === 'nudge');
  assert.equal(nudge.label, 'Nudge');

  const cw = parseInjectedBotMessage('bot-context-window', '[Context window 2. Your identity...]\n\nEarlier windows:\n1. Setup');
  assert.ok(cw && cw.kind === 'context-window' && cw.defaultOpen === false && cw.label === 'Context window 2');

  const restart = parseInjectedBotMessage('bot-restart', 'Restarted onto new pi-dish code.', { from: 'abc', botEvent: { to: 'def' } });
  assert.ok(restart && restart.kind === 'restart' && restart.quiet === true && restart.meta === 'build abc → def');
});

test('codemode result parsing, output formatting, bot tool bodies and places change summaries', () => {
  const parsed = parseCodemodeResult('Script completed\nWall time 1.4 seconds\nOutput:\n\n{"a":1,"b":"two"}');
  assert.ok(parsed && parsed.ok === true && parsed.wallLabel === '1.4s');
  const chips = codemodeResultChipsHtml({ kind: 'codemode', calls: [{ op: 'sessions', facts: [] }] }, parsed, (t, cls) => `[${cls || ''}:${t}]`);
  assert.equal(chips, '[job:1 call][duration:1.4s]');

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

export {};
