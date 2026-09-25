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
const { decodeUsageSummary, decodeUsageLimits, decodeCacheLifetimes, cacheLifetimeStatus, cacheLifetimesHtml, formatGap } = context.PiDishBrowser;
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
test('cache lifetimes decode defensively and explain the first failing gate', () => {
  const probes = { total: 30, hits: 30, misses: 0, maxHitGapMs: 900_000, minMissGapMs: null, lastAt: 5 };
  const rows = decodeCacheLifetimes({ identities: [
    null, { model: 7, probes },
    { api: 'x', provider: 'zai', model: 'glm<b>', tier: null, source: 'none', effective: null, probes,
      gates: [{ id: 'support', pass: true, value: 30, need: 20 }, { id: 'cold', pass: false, value: 0, need: 3 }, { id: 'bogus', pass: false }],
      points: [[30_000, 1], [-1, 1], ['x', 0], [900_000, 1]] },
    { api: 'y', provider: 'openai', model: 'gpt', source: 'learned', effective: { retentionMs: 1_260_000, retention: '~21m', basis: 'learned' },
      fit: { active: true, ttlMs: 1_260_000, alpha: 80, beta: -5.6, priorTtlMs: 600_000, stats: { observations: 43.2, warmHitRate: 1 } },
      gates: [], probes: { ...probes, misses: 11 }, points: [] },
  ] });
  assert.equal(rows.length, 2, 'malformed identities dropped');
  const unknown = present(rows[0]), learned = present(rows[1]);
  assert.equal(unknown.gates.length, 2, 'unknown gate ids dropped');
  assert.deepEqual(plain(unknown.points), [[30_000, 1], [900_000, 1]]);
  const status = cacheLifetimeStatus(unknown);
  assert.equal(status.label, 'Learning');
  assert.equal(status.detail, 'Never seen cold · warm after 15m · no countdown yet');
  assert.equal(cacheLifetimeStatus(learned).detail, '43 probes · 100% warm inside');
  assert.equal(formatGap(45_000), '45s'); assert.equal(formatGap(7_200_000), '2h');
  const html = cacheLifetimesHtml([{ hostKey: 'h1', hostLabel: 'one', rows }], { hostKey: null, open: new Set([learned.key]) });
  assert.ok(html.includes('glm&lt;b&gt;') && !html.includes('glm<b>'), 'model names are escaped');
  assert.ok(html.includes('cl-detail'), 'the open row expands');
  assert.ok(!html.includes('data-cl-host'), 'a single host shows no picker');
  assert.equal(cacheLifetimesHtml([{ hostKey: 'h1', hostLabel: 'one', rows: [] }], { hostKey: null, open: new Set() }), '');
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
