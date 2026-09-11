const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeSearchPayload, mergeSearchPayloads, queryHosts } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));
test('search payloads narrow rows and merge with the actual host identity', () => {
  const value = decodeSearchPayload({ results: [null, { id: 3 }, { id: 's', host: 'forged', name: 'Name', snippets: ['hit', 3], searchScore: 'bad' }] });
  const result = mergeSearchPayloads([{ host: { hostId: 'real', base: '/real', label: 'Real' }, payload: value }], 'Name');
  assert.equal(result.results.length, 1); assert.equal(result.results[0].host, 'real'); assert.equal(result.results[0].hostLabel, 'Real');
  assert.deepEqual(plain(result.results[0].snippets), ['hit']);
  assert.equal(result.total, 1); assert.throws(() => decodeSearchPayload({}), /Invalid search response/);
});
test('host pruning uses only positive host terms and keeps supplied row identity', () => {
  const first = { hostId: 'one', label: 'One' }, second = { hostId: 'two', label: 'Two' };
  assert.equal(queryHosts([first, second], 'host:two')[0], second);
  assert.equal(queryHosts([first, second], '-host:two').length, 2);
  assert.equal(queryHosts([first, second], 'host:missing').length, 0);
});
