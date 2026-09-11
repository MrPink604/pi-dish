const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const timers = new Map(); let nextTimer = 0;
const context = { URL, setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/helpers.js'), 'utf8'), context);
const { decodeUsageSummary, decodeUsageLimits } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));
test('usage decoding preserves unavailable prices and qualifies even a single answering host', () => {
  const data = decodeUsageSummary({ totals: { calls: 2, tokens: { input: 50, output: 'wrong' }, costs: { input: 0.2, total: null }, costUnavailable: { total: 1 } }, groups: { sessions: [null, { id: 7 }, { id: 'same', host: 'forged', name: 'Name' }], workspaces: [{ key: '/project' }] } }, { hostId: 'peer', label: 'Peer' });
  assert.equal(data.totals.costs.total, null); assert.equal(data.totals.costs.input, 0.2);
  assert.equal(data.totals.tokens.input, 50); assert.equal(data.totals.tokens.output, 0);
  assert.equal(data.totals.costUnavailable.total, 1);
  assert.equal(data.groups.sessions.length, 1); assert.equal(data.groups.sessions[0].host, 'peer');
  assert.equal(data.groups.workspaces[0].hostLabel, 'Peer');
  assert.throws(() => decodeUsageSummary(null, { hostId: null, label: 'Self' }), /Invalid usage summary/);
});
test('usage limits discard malformed reports and fractions', () => {
  const data = decodeUsageLimits({ harnesses: [null, { harness: 'omp', reports: [{ provider: 'service', limits: [{ label: 'bad', usedFraction: '0.5' }, { label: 'good', usedFraction: 0.5, resetsAt: null }] }] }] });
  assert.deepEqual(plain(data.harnesses[0].reports[0].limits), [{ label: 'good', windowLabel: '', usedFraction: 0.5, resetsAt: null }]);
});
test('disposing the fan-out queue retires both pending and subsequent renders', () => {
  let renders = 0;
  const states = ['ok', 'pending'];
  const queue = context.PiDishHelpers.createFanoutRenderQueue(states, () => renders++);
  queue(); assert.equal(timers.size, 1);
  queue.dispose(); assert.equal(timers.size, 0);
  states[1] = 'ok'; queue();
  assert.equal(renders, 0); assert.equal(timers.size, 0);
});
