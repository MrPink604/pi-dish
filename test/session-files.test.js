/**
 * Unit tests for lib/session-files.js — the JSONL parsers behind session
 * listing, message pagination, and list search, plus their mtime/size caches.
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SF = require('../lib/session-files.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-sf-'));
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

let fileSeq = 0;
function writeSession(entries) {
  const file = path.join(tmpDir, `session-${fileSeq++}.jsonl`);
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const userMsg = (text, timestamp) =>
  ({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }], timestamp } });
const assistantMsg = (text, usage) =>
  ({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }], usage } });

test('getSessionInfo derives metadata from the JSONL stream', () => {
  const file = writeSession([
    { type: 'session', cwd: '/home/user/proj', timestamp: '2026-07-01T10:00:00.000Z' },
    { type: 'model_change', modelId: 'old-model' },
    userMsg('first question that is quite long and definitely over forty characters'),
    assistantMsg('answer', { totalTokens: 500 }),
    { type: 'model_change', modelId: 'new-model' },
    userMsg('second question'),
    assistantMsg('answer 2', { totalTokens: 900 }),
    'not json at all',
  ]);
  const info = SF.getSessionInfo(file);
  assert.equal(info.cwd, '/home/user/proj');
  assert.equal(info.model, 'new-model', 'last model_change wins');
  assert.equal(info.messageCount, 2, 'counts user messages only');
  assert.equal(info.contextTokens, 900, 'latest assistant usage wins');
  assert.equal(info.name, 'first question that is quite long and de...', 'first user message, truncated');
  assert.ok(info.lastActivity instanceof Date);
});

test('getSessionInfo prefers explicit names and resets tokens on compaction', () => {
  const file = writeSession([
    userMsg('hello'),
    assistantMsg('hi', { totalTokens: 12000 }),
    { type: 'session_info', name: 'first name' },
    { type: 'session_info', name: 'renamed' },
    { type: 'compaction', tokensBefore: 12000 },
  ]);
  const info = SF.getSessionInfo(file);
  assert.equal(info.name, 'renamed', 'latest session_info wins over first message');
  assert.equal(info.contextTokens, 0, 'compaction resets the running token count');
});

test('getSessionInfo uses custom_message as a name fallback', () => {
  const file = writeSession([
    { type: 'custom_message', customType: 'session-message', content: 'kickoff note' },
    assistantMsg('ok', { totalTokens: 10 }),
  ]);
  assert.equal(SF.getSessionInfo(file).name, 'kickoff note');
});

test('getSessionInfo cache revalidates on append and returns safe copies', () => {
  const file = writeSession([userMsg('one')]);
  const first = SF.getSessionInfo(file);
  assert.equal(first.messageCount, 1);

  // Mutating a returned copy must not poison the cache.
  first.messageCount = 999;
  assert.equal(SF.getSessionInfo(file).messageCount, 1);

  fs.appendFileSync(file, JSON.stringify(userMsg('two')) + '\n');
  assert.equal(SF.getSessionInfo(file).messageCount, 2, 'size/mtime change invalidates');
});

test('readSessionMessages returns the displayable stream in order', () => {
  const file = writeSession([
    { type: 'session', cwd: '/x' },
    userMsg('q', '2026-07-01T10:00:00.000Z'),
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'Bash', arguments: { command: 'ls' } }] } },
    { type: 'message', message: { role: 'toolResult', toolName: 'Bash', toolCallId: 't1', isError: true, content: [{ type: 'text', text: 'out' }] } },
    { type: 'custom_message', customType: 'session-message', content: 'injected' },
    { type: 'custom_message', customType: 'other', content: 'not displayable' },
    assistantMsg('done'),
  ]);
  const all = SF.readSessionMessages(file);
  assert.deepEqual(all.map(m => m.role), ['user', 'assistant', 'toolResult', 'user', 'assistant']);
  assert.equal(all[3].content[0].text, 'injected', 'session-message custom entries render as user messages');

  // The client renders tool name + error state from these message-level
  // fields, so the display stream must carry them through.
  const toolResult = all[2];
  assert.equal(toolResult.toolName, 'Bash');
  assert.equal(toolResult.toolCallId, 't1');
  assert.equal(toolResult.isError, true);
  // Plain messages don't grow spurious tool fields.
  assert.equal(all[1].toolName, undefined, 'non-toolResult messages have no toolName');
});

test('readSessionMessages carries entry ids and assistant generation stats', () => {
  const file = writeSession([
    { type: 'session', cwd: '/x' },
    { type: 'message', id: 'u1', timestamp: '2026-07-01T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'q' }], timestamp: Date.parse('2026-07-01T10:00:00.000Z') } },
    // start = message.timestamp (ms epoch), end = entry timestamp → 5s.
    { type: 'message', id: 'a1', timestamp: '2026-07-01T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ans' }],
        timestamp: Date.parse('2026-07-01T10:00:00.000Z'), usage: { output: 100 } } },
    // No message-level start timestamp — no duration, no absurd tok/s.
    { type: 'message', id: 'a2', timestamp: '2026-07-01T10:00:06.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { output: 10 } } },
  ]);
  const all = SF.readSessionMessages(file);
  assert.equal(all[0].id, 'u1');
  assert.equal(all[0].durationMs, undefined, 'user messages carry no generation stats');
  assert.equal(all[1].id, 'a1');
  assert.equal(all[1].durationMs, 5000);
  assert.equal(all[1].outputTokens, 100);
  assert.equal(all[2].durationMs, undefined, 'missing start timestamp yields no duration');
});

test('readSessionMessages cache revalidates on append and survives LRU pressure', () => {
  const file = writeSession([userMsg('a')]);
  assert.equal(SF.readSessionMessages(file).length, 1);
  fs.appendFileSync(file, JSON.stringify(assistantMsg('b')) + '\n');
  assert.equal(SF.readSessionMessages(file).length, 2);

  // Push well past the LRU capacity, then re-read the first file.
  for (let i = 0; i < 8; i++) SF.readSessionMessages(writeSession([userMsg(`filler ${i}`)]));
  assert.equal(SF.readSessionMessages(file).length, 2, 'evicted entries re-parse correctly');
});

test('readSessionMessages follows the active tree path, not file order', () => {
  // A /tree branch: e3/e4 are abandoned, the last entry (pi's leaf on
  // reopen) anchors the new branch at e2 and carries the follow-up turn.
  const tmsg = (id, parentId, role, text) => ({
    type: 'message', id, parentId,
    message: { role, content: [{ type: 'text', text }] },
  });
  const file = writeSession([
    { type: 'session', version: 3, id: 'sess', cwd: '/p', timestamp: '2026-07-01T10:00:00.000Z' },
    tmsg('e1', null, 'user', 'first prompt'),
    tmsg('e2', 'e1', 'assistant', 'first answer'),
    tmsg('e3', 'e2', 'user', 'abandoned prompt'),
    tmsg('e4', 'e3', 'assistant', 'abandoned answer'),
    { type: 'branch_summary', id: 'bs1', parentId: 'e2', fromId: 'e2', summary: 'tried X' },
    tmsg('e5', 'bs1', 'user', 'retry prompt'),
  ]);
  const texts = SF.readSessionMessages(file).map(m => m.content[0].text);
  assert.deepEqual(texts, ['first prompt', 'first answer', 'tried X', 'retry prompt'],
    'abandoned branch entries do not render; active path keeps file order');
});

test('readSessionMessages keeps every entry when the leaf is the last message', () => {
  const tmsg = (id, parentId, role, text) => ({
    type: 'message', id, parentId,
    message: { role, content: [{ type: 'text', text }] },
  });
  const file = writeSession([
    tmsg('e1', null, 'user', 'one'),
    tmsg('e2', 'e1', 'assistant', 'two'),
  ]);
  assert.equal(SF.readSessionMessages(file).length, 2);
});

test('readSessionMessages treats pre-tree files (no parentId) as linear', () => {
  // Legacy shorthand entries have ids but no tree data — nothing may be
  // dropped just because a parent chain cannot be built.
  const file = writeSession([
    { type: 'message', id: 'a1', message: { role: 'user', content: [{ type: 'text', text: 'one' }] } },
    { type: 'message', id: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'two' }] } },
    userMsg('three'),
  ]);
  assert.equal(SF.readSessionMessages(file).length, 3);
});

test('buildSearchTextFromContent lowercases and caps message text', () => {
  const content = [
    userMsg('Find The NEEDLE here'),
    assistantMsg('HAYSTACK reply ' + 'x'.repeat(600)),
    { type: 'custom_message', content: 'Injected NOTE' },
    'not json',
  ].map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n') + '\n';
  const text = SF.buildSearchTextFromContent(content);
  assert.ok(text.includes('the needle'));
  assert.ok(text.includes('haystack'));
  assert.ok(text.includes('injected note'));
  assert.ok(!text.includes('x'.repeat(501)), 'per-message text capped at 500 chars');
});

test('getSessionStats aggregates usage and revalidates on append', () => {
  const file = writeSession([
    { type: 'session', cwd: '/x' },
    userMsg('q'),
    { type: 'message', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 't1', name: 'Bash', arguments: {} },
      { type: 'toolCall', id: 't2', name: 'Read', arguments: {} },
    ], usage: { input: 100, output: 50, cacheRead: 400, cacheWrite: 20, reasoning: 12,
      cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0.08, total: 0.5 } } } },
    { type: 'message', message: { role: 'toolResult', toolName: 'Bash', content: [] } },
    assistantMsg('done', { input: 10, output: 5 }),
  ]);
  const stats = SF.getSessionStats(file);
  assert.deepEqual(stats.tokens, { input: 110, output: 55, cacheRead: 400, cacheWrite: 20 });
  assert.equal(stats.cost, 0.5);
  assert.deepEqual(stats.costs, { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0.08, total: 0.5 });
  assert.equal(stats.reasoningTokens, 12);
  assert.equal(stats.userMessages, 1);
  assert.equal(stats.assistantMessages, 2);
  assert.equal(stats.toolCalls, 2);
  assert.equal(stats.toolResults, 1);

  fs.appendFileSync(file, JSON.stringify(userMsg('another')) + '\n');
  assert.equal(SF.getSessionStats(file).userMessages, 2, 'size/mtime change invalidates');
});

test('getSessionStats sums generation time over measurable assistant messages only', () => {
  const file = writeSession([
    { type: 'message', timestamp: '2026-07-01T10:00:10.000Z', message: { role: 'assistant',
      content: [], timestamp: Date.parse('2026-07-01T10:00:00.000Z'), usage: { output: 200 } } },
    { type: 'message', timestamp: '2026-07-01T10:00:15.000Z', message: { role: 'assistant',
      content: [], timestamp: Date.parse('2026-07-01T10:00:10.000Z'), usage: { output: 100 } } },
    assistantMsg('no timing', { output: 50 }), // timestampless — excluded from both sums
  ]);
  const stats = SF.getSessionStats(file);
  assert.equal(stats.genMs, 15000);
  assert.equal(stats.genOutput, 300, 'unmeasurable output does not dilute the average');
  assert.equal(stats.tokens.output, 350, 'token totals still count everything');
  assert.deepEqual(stats.responseTiming, { measured: 2, medianMs: 7500, slowestMs: 10000 });
});

test('indexed usage groups local days and model changes without retaining message content', () => {
  const content = [
    { type: 'session', cwd: '/workspace/alpha' },
    { type: 'model_change', provider: 'anthropic', modelId: 'fallback-model' },
    { type: 'message', timestamp: '2026-07-01T10:00:03.000Z', message: {
      role: 'assistant', content: [{ type: 'text', text: 'large text that is not indexed into usage' }],
      timestamp: Date.parse('2026-07-01T10:00:01.000Z'),
      usage: { input: 10, output: 4, reasoning: 2, cost: { output: 0.04, total: 0.04 } },
    } },
    { type: 'message', timestamp: '2026-07-02T11:00:05.000Z', message: {
      role: 'assistant', provider: 'openai', model: 'selected-router', responseModel: 'routed-model', content: [],
      timestamp: Date.parse('2026-07-02T11:00:01.000Z'),
      usage: { input: 20, output: 8, cacheRead: 30, cost: { input: 0.02, total: 0.08 } },
    } },
    { type: 'message', message: { role: 'assistant', content: [], usage: { output: 1, cost: { total: 0.01 } } } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n';

  const usage = SF.buildIndexedUsageFromContent(content);
  assert.equal(usage.cwd, '/workspace/alpha');
  assert.equal(usage.total.calls, 3);
  assert.equal(usage.total.tokens.output, 13);
  assert.equal(usage.total.tokens.reasoning, 2);
  assert.equal(usage.total.costs.total, 0.13);
  assert.equal(usage.total.measured, 2);
  assert.equal(usage.total.durationMs, 6000);
  assert.equal(usage.total.slowestMs, 4000);
  assert.equal(usage.days['2026-07-01'].calls, 1);
  assert.equal(usage.days['2026-07-02'].calls, 1);
  assert.equal(usage.days.unknown.calls, 1);
  assert.equal(usage.models['anthropic/fallback-model'].calls, 2, 'model_change is the fallback');
  assert.equal(usage.models['openai/routed-model'].calls, 1, 'concrete response model overrides the selected model and fallback');
  assert.equal(usage.models['openai/selected-router'], undefined);
  assert.equal('content' in usage.total, false);
});

test('readSessionCwd reads the header line without loading the file', () => {
  const file = writeSession([
    { type: 'session', cwd: '/home/user/proj' },
    userMsg('x'.repeat(50000)), // bulk that a full read would pay for
  ]);
  assert.equal(SF.readSessionCwd(file), '/home/user/proj');
  assert.equal(SF.readSessionCwd(path.join(tmpDir, 'missing.jsonl')), null);
  const noCwd = writeSession([userMsg('no header')]);
  assert.equal(SF.readSessionCwd(noCwd), null);
});

test('decodeDirToCwd reverses pi session-dir naming', () => {
  assert.equal(SF.decodeDirToCwd('--home-user-proj--'), '/home/user/proj');
  assert.equal(SF.decodeDirToCwd('--home-user--'), '/home/user');
});
