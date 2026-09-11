const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { renderSidebar, sidebarSession } = context.PiDishBrowser;
function render(overrides = {}) {
  return renderSidebar({ active: [], previous: [], selected: null, tab: 'all', view: 'workspace', query: '', queriedFor: '', scope: '', indexing: false,
    contextMetric: 'percent', pending: [], selectedSpawn: null, expanded: new Set(), collapsed: new Set(), pinned: [], roots: new Map(),
    closeConfirm: null, closeBusy: null, multiHost: false, hosts: [], unread: () => false, hostChip: () => '', ...overrides });
}
test('sidebar projection narrows malformed metadata and retains explicit null family boundaries', () => {
  const raw = { id: 'a', name: {}, contextPercent: Infinity, contextTokens: '10', searchScore: [], capabilities: { close: false, rename: 'yes' }, parentId: 'parent', familyParentId: null };
  const row = sidebarSession(raw);
  assert.equal(row.name, ''); assert.equal(row.contextPercent, 0); assert.equal(row.contextTokens, undefined);
  assert.equal(row.capabilities.close, false); assert.equal(row.capabilities.rename, undefined); assert.equal(row.familyParentId, null);
  assert.equal(raw.capabilities.rename, 'yes'); assert.equal(Object.hasOwn(sidebarSession({ id: 'b', parentId: 'parent' }), 'familyParentId'), false);
});
test('host-qualified workspace collapse and family status stay independent for identical ids and paths', () => {
  const hosts = ['self', 'peer'].map(hostId => ({ hostId, label: hostId, state: 'reachable', key: hostId, color: '#abc', dot: '', hasCache: true }));
  const active = ['self', 'peer'].flatMap(host => [{ id: 'parent', host, cwd: '/repo', name: host + ' parent', isActive: true },
    { id: 'child', host, cwd: '/repo', name: host + ' child', parentId: 'parent', isActive: true, turnInProgress: host === 'peer' }]);
  const { html, count } = render({ active, hosts, multiHost: true, collapsed: new Set(['self /repo']), selected: active[2] });
  assert.equal(count, 4); assert.match(html, /data-cwd="self \/repo"/); assert.doesNotMatch(html, /self parent/);
  assert.match(html, /peer parent/); assert.match(html, /Session family working/); assert.match(html, /session-item active/);
  assert.doesNotMatch(html, /peer child/);
});
test('server content search stays authoritative while scopes and automation remain visible in audit notes', () => {
  const previous = [{ id: 'match', name: '<b>content match</b>', cwd: '/repo', searchScore: 12, searchSnippet: 'needle <img>', routine: '' },
    { id: 'auto', name: 'robot', routine: 'daily' }];
  const result = render({ previous, query: 'needle', queriedFor: 'needle' });
  assert.match(result.html, /&lt;b&gt;content match&lt;\/b&gt;/); assert.match(result.html, /&lt;img&gt;/);
  assert.match(result.html, /1 automation run hidden/); assert.doesNotMatch(result.html, /robot/);
  const scoped = render({ previous, query: 'needle', queriedFor: 'needle', scope: 'name:absent' });
  assert.match(scoped.html, /1 hidden by scopes/);
});
