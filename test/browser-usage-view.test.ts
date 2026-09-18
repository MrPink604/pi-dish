import { assertBrowserApiContext, assertSharedHelpersContext } from './browser-vm.js';
import { present } from './test-types.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const timers = new Map(); let nextTimer = 0;
const context = { URL, setTimeout: (fn: unknown) => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: (id: string) => timers.delete(id) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
assertBrowserApiContext(context);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/helpers.js'), 'utf8'), context);
assertSharedHelpersContext(context);
const { decodeUsageSummary, decodeUsageLimits } = context.PiDishBrowser;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
test('usage decoding preserves unavailable prices and qualifies even a single answering host', () => {
  const data = decodeUsageSummary({ totals: { calls: 2, tokens: { input: 50, output: 'wrong' }, costs: { input: 0.2, total: null }, costUnavailable: { total: 1 } }, groups: { sessions: [null, { id: 7 }, { id: 'same', host: 'forged', name: 'Name' }], workspaces: [{ key: '/project' }] } }, { hostId: 'peer', label: 'Peer' });
  const totals = present(data.totals), costs = present(totals.costs), tokens = present(totals.tokens);
  assert.equal(costs.total, null); assert.equal(costs.input, 0.2);
  assert.equal(tokens.input, 50); assert.equal(tokens.output, 0);
  assert.equal(present(totals.costUnavailable).total, 1);
  const groups = present(data.groups), sessions = present(groups.sessions), workspaces = present(groups.workspaces);
  assert.equal(sessions.length, 1); assert.equal(present(sessions[0]).host, 'peer');
  assert.equal(present(workspaces[0]).hostLabel, 'Peer');
  assert.throws(() => decodeUsageSummary(null, { hostId: null, label: 'Self' }), /Invalid usage summary/);
});
test('usage limits discard malformed reports and fractions', () => {
  const data = decodeUsageLimits({ harnesses: [null, { harness: 'omp', reports: [{ provider: 'service', limits: [{ label: 'bad', usedFraction: '0.5' }, { label: 'good', usedFraction: 0.5, resetsAt: null }] }] }] });
  const harness = present(present(data.harnesses)[0]), report = present(present(harness.reports)[0]);
  assert.deepEqual(plain(report.limits), [{ label: 'good', windowLabel: '', usedFraction: 0.5, resetsAt: null }]);
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

export {};
