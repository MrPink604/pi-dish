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
    { type: 'message', message: { role: 'toolResult', toolName: 'Bash', content: [{ type: 'text', text: 'out' }] } },
    { type: 'custom_message', customType: 'session-message', content: 'injected' },
    { type: 'custom_message', customType: 'other', content: 'not displayable' },
    assistantMsg('done'),
  ]);
  const all = SF.readSessionMessages(file);
  assert.deepEqual(all.map(m => m.role), ['user', 'assistant', 'toolResult', 'user', 'assistant']);
  assert.equal(all[3].content[0].text, 'injected', 'session-message custom entries render as user messages');
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

test('getSessionSearchText lowercases message text and tracks appends', () => {
  const file = writeSession([userMsg('Find The NEEDLE here')]);
  assert.ok(SF.getSessionSearchText(file).includes('the needle'));
  fs.appendFileSync(file, JSON.stringify(assistantMsg('HAYSTACK reply')) + '\n');
  assert.ok(SF.getSessionSearchText(file).includes('haystack'));
  assert.equal(SF.getSessionSearchText(path.join(tmpDir, 'missing.jsonl')), '', 'missing file degrades to empty');
});

test('decodeDirToCwd reverses pi session-dir naming', () => {
  assert.equal(SF.decodeDirToCwd('--home-user-proj--'), '/home/user/proj');
  assert.equal(SF.decodeDirToCwd('--home-user--'), '/home/user');
});
