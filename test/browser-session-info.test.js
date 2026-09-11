const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeSessionStats, decodeSessionShare, decodePublishedPages } = context.PiDishBrowser;
test('session stats retain unavailable prices and narrow context and runtime metadata', () => {
  const stats = decodeSessionStats({ costs: { total: null, input: 0.25 }, costUnavailable: { total: 1 }, contextUsage: { tokens: 100, percent: 'bad' }, runtime: { kind: 'tmux', pid: 'bad', windowIndex: 0 } });
  assert.equal(stats.costs.total, null); assert.equal(stats.costs.input, 0.25); assert.equal(stats.costUnavailable.total, 1);
  assert.equal(stats.contextUsage.tokens, 100); assert.equal(stats.contextUsage.percent, null);
  assert.equal(stats.runtime.pid, null); assert.equal(stats.runtime.windowIndex, 0);
  assert.throws(() => decodeSessionStats({ error: 'unavailable' }), /unavailable/);
});
test('published artifact payloads reject error envelopes and malformed identities', () => {
  assert.equal(decodeSessionShare({ error: 'bad', path: '/share' }), null); assert.equal(decodeSessionShare({}), null);
  assert.equal(decodeSessionShare({ url: 'https://fixture.invalid/shared' }).url, 'https://fixture.invalid/shared');
  const pages = decodePublishedPages([null, { token: 2 }, { token: 'page', root: '/plan.html', path: '/p/page', title: 'Plan', createdAt: 1 }]);
  assert.equal(pages.length, 1); assert.equal(pages[0].title, 'Plan'); assert.equal(pages[0].missing, false);
});
