const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeRenderMessage } = context.PiDishBrowser;
test('message projection preserves text/image content but narrows identifiers and telemetry', () => {
  const raw = { role: 'assistant', index: '0" onclick="bad', timestamp: 'literal', content: ['plain', { type: 'text', text: 'text' }, { type: 'image', url: '/image', mimeType: 'image/png' }, null],
    usage: { input: '9', output: 4, cost: { total: null, output: 0.1 } }, durationMs: Infinity };
  const row = decodeRenderMessage(raw); assert.equal(row.index, undefined); assert.equal(row.timestamp, 'literal'); assert.equal(row.durationMs, undefined);
  assert.equal(row.content[0], 'plain'); assert.equal(row.content[2].url, '/image'); assert.equal(row.content.length, 3);
  assert.equal(row.usage.input, undefined); assert.equal(row.usage.cost.total, null); raw.usage.cost.output = 99; assert.equal(row.usage.cost.output, 0.1);
});
test('custom-message projection separates hidden state, structured advisor notes and job metadata', () => {
  const row = decodeRenderMessage({ role: 'custom', display: false, details: { notes: ['plain', { note: '<literal>', severity: 'concern', advisor: 'a' }, { note: {} }], jobs: [{ jobId: 'job', durationMs: 2500 }, { label: {}, durationMs: '3' }] } });
  assert.equal(row.display, false); assert.equal(row.details.notes.length, 2); assert.equal(row.details.notes[0].note, 'plain'); assert.equal(row.details.notes[1].note, '<literal>');
  assert.equal(row.details.jobs[0].durationMs, 2500); assert.equal(row.details.jobs[1].label, undefined);
  assert.equal(decodeRenderMessage({ role: 'assistant', content: [] }).content.length, 0);
  assert.equal(decodeRenderMessage({ role: 'assistant' }).content, undefined);
});
