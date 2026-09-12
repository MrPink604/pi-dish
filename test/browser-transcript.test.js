const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeTranscriptPage } = context.PiDishBrowser;
test('transcript pages require message arrays and narrow cursors without accepting wire identity', () => {
  assert.throws(() => decodeTranscriptPage({ error: 'no messages' }), /Invalid transcript page/);
  const data = decodeTranscriptPage({ messages: [{ role: 'user', index: 1, content: 'ok' }], firstIndex: 'bad', lastIndex: 1, totalMessages: Infinity, hasMore: 'true', session: { id: 'wrong', host: 'wrong', name: 'kept' } });
  assert.equal(data.firstIndex, null); assert.equal(data.lastIndex, 1); assert.equal(data.totalMessages, null); assert.equal(data.hasMore, false);
  assert.equal(data.session.id, undefined); assert.equal(data.session.host, undefined); assert.equal(data.session.name, 'kept');
});
test('transcript decoding preserves authoritative indexed empty assistant entries', () => {
  const data = decodeTranscriptPage({ messages: [{ role: 'assistant', index: 3, content: [] }], firstIndex: 3, lastIndex: 3, totalMessages: 4 });
  assert.equal(data.messages.length, 1); assert.equal(data.messages[0].index, 3); assert.equal(data.messages[0].content.length, 0);
});

test('transcript patches preserve present display values and exclude list authority and extras', () => {
  const data = decodeTranscriptPage({ messages: [], session: {
    name: null, model: '', cwd: null, contextPercent: 0, contextTokens: 0, lastActivity: 0, isActive: false,
    harnessId: 'peer', capabilities: { resume: true }, parentId: 'forged', routine: 'forged',
    thinkingLevel: 'high', turnInProgress: true, extra: { name: 'forged' },
  } });
  assert.deepEqual({ ...data.session }, { name: null, model: '', cwd: null, contextTokens: 0, contextPercent: 0, lastActivity: 0, isActive: false });
  assert.equal(Object.hasOwn(data.session, 'messageCount'), false);
  assert.throws(() => decodeTranscriptPage({ messages: [], session: { contextTokens: '0' } }), /Invalid session patch/);
});
