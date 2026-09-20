import { assertBrowserApiContext } from './browser-vm.js';
import { present, record } from './test-types.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
assertBrowserApiContext(context);
const { decodeRenderMessage } = context.PiDishBrowser;
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

export {};
