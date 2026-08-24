/**
 * Unit tests for the pure frontend helpers (public/helpers.js). These run in
 * node — the file exports CommonJS when `module` exists and defines globals
 * in the browser.
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const H = require('../public/helpers.js');

test('escapeHtml escapes markup and attribute-breaking quotes', () => {
  assert.equal(H.escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(H.escapeHtml(''), '');
  assert.equal(H.escapeHtml(null), '');
  assert.equal(H.escapeHtml(42), '42');
});

test('stripAnsi removes CSI colors, OSC sequences, and stray escapes', () => {
  // Real pi-processes status-widget line (truecolor theme.fg output).
  assert.equal(
    H.stripAnsi('\x1b[38;2;102;102;102mprocesses: \x1b[39m\x1b[38;2;138;190;183mticker2\x1b[39m \x1b[38;2;102;102;102mrunning\x1b[39m'),
    'processes: ticker2 running'
  );
  assert.equal(H.stripAnsi('\x1b]0;window title\x07plain'), 'plain');
  assert.equal(H.stripAnsi('a\x1b(Bb'), 'ab'); // charset-select escape pair
  assert.equal(H.stripAnsi('no escapes'), 'no escapes');
  assert.equal(H.stripAnsi(''), '');
  assert.equal(H.stripAnsi(null), '');
});

test('formatTokens abbreviates thousands', () => {
  assert.equal(H.formatTokens(0), '0');
  assert.equal(H.formatTokens(null), '0');
  assert.equal(H.formatTokens(999), '999');
  assert.equal(H.formatTokens(1500), '1.5k');
  assert.equal(H.formatTokens(29889), '29.9k');
  assert.equal(H.formatTokens(65029568), '65.0M'); // cache reads get huge
});

test('formatTokSpeed formats rates and rejects meaningless samples', () => {
  assert.equal(H.formatTokSpeed(100, 4000), '25 tok/s');
  assert.equal(H.formatTokSpeed(42, 5000), '8.4 tok/s'); // one decimal under 10
  assert.equal(H.formatTokSpeed(100, 999), null, 'sub-second bursts read as absurd rates');
  assert.equal(H.formatTokSpeed(0, 5000), null);
  assert.equal(H.formatTokSpeed(undefined, undefined), null);
});

test('formatCacheStat shows hit rate and flags unreported writes', () => {
  // reads but zero writes ⇒ the provider API has no write metric (you can't
  // read what was never written) — hit rate carries the signal instead
  assert.equal(H.formatCacheStat(9088, 0, 5151), '9.1k read (64% hit) · writes not reported');
  assert.equal(H.formatCacheStat(9088, null, 5151), '9.1k read (64% hit) · writes not reported');
  // writes reported (anthropic-messages) — hit rate counts them as misses
  assert.equal(H.formatCacheStat(38900, 5100, 10000), '38.9k read (72% hit) · 5.1k written');
  assert.equal(H.formatCacheStat(4160, 512, 788), '4.2k read (76% hit) · 512 written');
  // no caching at all: plain zeros, no bogus "not reported" claim
  assert.equal(H.formatCacheStat(0, 0, 500), '0 read (0% hit)');
  assert.equal(H.formatCacheStat(0, 0, 0), '—');
  assert.equal(H.formatCacheStat(null, undefined, undefined), '—');
});

test('formatRuntime names each backend and degrades to partial tmux info', () => {
  assert.equal(H.formatRuntime({ kind: 'rpc', pid: 4321 }), 'pi-dish server (headless) · pid 4321');
  assert.equal(
    H.formatRuntime({ kind: 'tmux', pid: 99, server: 'default', tmuxSession: 'work', windowIndex: 3, windowName: 'pi' }),
    'tmux default · work:3 pi · pid 99');
  // Pane query failed (dead server, no tmux): the socket name still locates it.
  assert.equal(H.formatRuntime({ kind: 'tmux', pid: 99, server: 'default', tmuxSession: null }),
    'tmux default · pid 99');
  // The hidden headless placement reads as headless, not as tmux plumbing.
  assert.equal(
    H.formatRuntime({ kind: 'tmux', pid: 7, server: 'pi-dish', tmuxSession: 'headless', windowIndex: 1, windowName: 'pi' }),
    'headless (hidden tmux — survives restarts) · pid 7');
  assert.equal(H.formatRuntime({ kind: 'terminal', pid: 7 }), 'terminal · pid 7');
  assert.equal(H.formatRuntime({ kind: 'terminal', pid: null }), 'terminal');
  assert.equal(H.formatRuntime(null), '—');
});

test('formatRelativeTime buckets by age', () => {
  const now = Date.now();
  assert.equal(H.formatRelativeTime(null), '');
  assert.equal(H.formatRelativeTime(new Date(now - 5 * 1000)), 'just now');
  assert.equal(H.formatRelativeTime(new Date(now - 5 * 60 * 1000)), '5m ago');
  assert.equal(H.formatRelativeTime(new Date(now - 3 * 3600 * 1000)), '3h ago');
  assert.equal(H.formatRelativeTime(new Date(now - 26 * 3600 * 1000)), 'yesterday');
  assert.equal(H.formatRelativeTime(new Date(now - 3 * 24 * 3600 * 1000)), '3d ago');
  // future timestamps clamp to "just now" rather than going negative
  assert.equal(H.formatRelativeTime(new Date(now + 60 * 1000)), 'just now');
});

test('formatDuration renders m:ss below an hour, h:mm:ss above', () => {
  assert.equal(H.formatDuration(0), '0:00');
  assert.equal(H.formatDuration(-500), '0:00');
  assert.equal(H.formatDuration(5000), '0:05');
  assert.equal(H.formatDuration(65 * 1000), '1:05');
  assert.equal(H.formatDuration(59 * 60 * 1000 + 59 * 1000), '59:59');
  assert.equal(H.formatDuration(3600 * 1000), '1:00:00');
  assert.equal(H.formatDuration(3600 * 1000 + 4 * 60 * 1000 + 9 * 1000), '1:04:09');
});

test('shortCwd collapses the home directory', () => {
  assert.equal(H.shortCwd('/home/user/proj/sub'), '~/proj/sub');
  assert.equal(H.shortCwd('/home/user'), '~');
  assert.equal(H.shortCwd('/opt/thing'), '/opt/thing');
  assert.equal(H.shortCwd(''), '');
});

test('truncate stays on one line and passes short text through', () => {
  assert.equal(H.truncate('short', 10), 'short');
  const cut = H.truncate('x'.repeat(20), 10);
  assert.equal(cut, 'x'.repeat(10) + ' … (truncated)');
  assert.ok(!cut.includes('\n'), 'must not inject newlines — used in one-line summaries');
  assert.equal(H.truncate('', 5), '');
  // Session names use a compact suffix
  assert.equal(H.truncate('x'.repeat(20), 10, '...'), 'x'.repeat(10) + '...');
});

test('contextClass buckets context pressure', () => {
  assert.equal(H.contextClass(0), '');
  assert.equal(H.contextClass(50), '');
  assert.equal(H.contextClass(51), 'high');
  assert.equal(H.contextClass(80), 'high');
  assert.equal(H.contextClass(81), 'critical');
});

test('sessionMetaText joins the searchable fields lowercased', () => {
  assert.equal(
    H.sessionMetaText({ name: 'Fix Login', cwd: '/home/U/App', model: 'GPT-5', id: 'S1' }),
    'fix login /home/u/app gpt-5 s1');
  // Missing fields must not stringify as "null"
  assert.equal(H.sessionMetaText({ id: 's2' }).includes('null'), false);
});

test('parseModelId splits provider/id refs; formatModelRef joins them back', () => {
  assert.deepEqual(H.parseModelId('anthropic/claude-sonnet-4-5'), { provider: 'anthropic', id: 'claude-sonnet-4-5' });
  assert.deepEqual(H.parseModelId('openai/gpt-5/preview'), { provider: 'openai', id: 'gpt-5/preview' });
  assert.deepEqual(H.parseModelId('bare-model'), { provider: '', id: 'bare-model' });
  assert.equal(H.formatModelRef({ provider: 'zai', id: 'glm-5.2' }), 'zai/glm-5.2');
  assert.equal(H.formatModelRef({ provider: 'zai', modelId: 'glm-5.2' }), 'zai/glm-5.2');
  assert.equal(H.formatModelRef('already/a-ref'), 'already/a-ref');
  assert.equal(H.formatModelRef({ id: 'no-provider' }), null);
  assert.equal(H.formatModelRef(null), null);
});

test('extractTextContent handles string, block-array, and junk', () => {
  assert.equal(H.extractTextContent('plain'), 'plain');
  assert.equal(H.extractTextContent([
    { type: 'text', text: 'a' },
    { type: 'toolCall', name: 'Bash' },
    { type: 'text', text: 'b' },
  ]), 'a\n\nb');
  assert.equal(H.extractTextContent(null), '');
  assert.equal(H.extractTextContent({ nope: true }), '');
});

test('getToolSummary picks the right field per tool', () => {
  assert.equal(H.getToolSummary('Bash', { command: 'ls -la\nrm x' }), 'ls -la');
  assert.equal(H.getToolSummary('Read', { path: '/tmp/f' }), '/tmp/f');
  assert.equal(H.getToolSummary('Custom', { query: 'find me' }), 'find me');
  assert.equal(H.getToolSummary('Custom', {}), '');
  assert.equal(H.getToolSummary('Bash', null), '');
});

test('getToolOutputText concatenates text blocks only', () => {
  assert.equal(H.getToolOutputText({ content: [
    { type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' },
  ] }), 'ab');
  assert.equal(H.getToolOutputText(null), '');
});

test('extractImageBlocks accepts inline and resource-backed images', () => {
  assert.deepEqual(H.extractImageBlocks([
    { type: 'text', text: 'Read image file [image/png]' },
    { type: 'image', data: 'AAA', mimeType: 'image/png' },
    { type: 'image', data: 'BBB' }, // mimeType absent → default
    { type: 'image', url: '/api/sessions/s/messages/2/images/1', mimeType: 'image/webp' },
    { type: 'image' },              // no data/url → skipped
  ]), [
    { data: 'AAA', mimeType: 'image/png' },
    { data: 'BBB', mimeType: 'image/png' },
    { url: '/api/sessions/s/messages/2/images/1', mimeType: 'image/webp' },
  ]);
  // Non-array content (plain string, null) yields nothing.
  assert.deepEqual(H.extractImageBlocks('Read image file'), []);
  assert.deepEqual(H.extractImageBlocks(null), []);
});

test('groupByWorkspace groups by cwd and sorts by recency', () => {
  const mk = (cwd, ts) => ({ cwd, lastActivity: ts });
  const groups = H.groupByWorkspace([
    mk('/a', '2026-01-01T00:00:00Z'),
    mk('/b', '2026-01-03T00:00:00Z'),
    mk('/a', '2026-01-02T00:00:00Z'),
    mk(null, '2026-01-04T00:00:00Z'),
  ]);
  assert.deepEqual(groups.map(g => g[0]), ['~', '/b', '/a']);
  // within /a, newest first
  assert.deepEqual(groups[2][1].map(s => s.lastActivity),
    ['2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z']);
});

test('groupByWorkspace sinks collapsed groups below expanded ones', () => {
  const mk = (cwd, ts) => ({ cwd, lastActivity: ts });
  const groups = H.groupByWorkspace([
    mk('/a', '2026-01-01T00:00:00Z'),
    mk('/b', '2026-01-03T00:00:00Z'),
    mk('/c', '2026-01-02T00:00:00Z'),
  ], new Set(['/b']));
  // /b is newest but collapsed, so it sorts last; the rest stay recency-ordered
  assert.deepEqual(groups.map(g => g[0]), ['/c', '/a', '/b']);
});

test('buildWorkspaceTree shows a shared prefix once with distinguishing tails as children', () => {
  const mk = (cwd, ts) => ({ cwd, lastActivity: ts });
  const groups = H.groupByWorkspace([
    mk('/home/u/workspace/beta', '2026-01-03T00:00:00Z'),
    mk('/home/u/workspace/alpha', '2026-01-02T00:00:00Z'),
  ]);
  const tree = H.buildWorkspaceTree(groups);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].label, '~/workspace'); // top-level label is shortCwd'd
  assert.equal(tree[0].path, '/home/u/workspace');
  assert.equal(tree[0].sessions, null);
  assert.equal(tree[0].count, 2);
  // children keep recency order and carry only their distinguishing tail
  assert.deepEqual(tree[0].children.map(c => [c.label, c.path, c.count]), [
    ['beta', '/home/u/workspace/beta', 1],
    ['alpha', '/home/u/workspace/alpha', 1],
  ]);
});

test('buildWorkspaceTree flattens multi-segment chains below a divergence point', () => {
  const mk = (cwd, ts) => ({ cwd, lastActivity: ts });
  const tree = H.buildWorkspaceTree(H.groupByWorkspace([
    mk('/srv/deep/nested/proj', '2026-01-02T00:00:00Z'),
    mk('/srv/other', '2026-01-01T00:00:00Z'),
  ]));
  assert.equal(tree[0].label, '/srv');
  assert.deepEqual(tree[0].children.map(c => c.label), ['deep/nested/proj', 'other']);
});

test('buildWorkspaceTree keeps unrelated workspaces as flat single nodes', () => {
  const mk = (cwd, ts) => ({ cwd, lastActivity: ts });
  const tree = H.buildWorkspaceTree(H.groupByWorkspace([
    mk('/etc/x', '2026-01-01T00:00:00Z'),
    mk('/home/u/app', '2026-01-02T00:00:00Z'),
    mk(null, '2026-01-03T00:00:00Z'),
  ]));
  assert.deepEqual(tree.map(n => [n.label, n.path, n.children.length]), [
    ['~', '~', 0],
    ['~/app', '/home/u/app', 0],
    ['/etc/x', '/etc/x', 0],
  ]);
  assert.equal(tree[1].sessions.length, 1);
});

test('buildWorkspaceTree keeps sessions living at a prefix that also has children', () => {
  const mk = (cwd, ts) => ({ cwd, lastActivity: ts });
  const tree = H.buildWorkspaceTree(H.groupByWorkspace([
    mk('/w/app', '2026-01-02T00:00:00Z'),
    mk('/w/app/sub', '2026-01-01T00:00:00Z'),
  ]));
  assert.equal(tree.length, 1);
  assert.equal(tree[0].path, '/w/app');
  assert.equal(tree[0].sessions.length, 1);
  assert.equal(tree[0].count, 2);
  assert.deepEqual(tree[0].children.map(c => c.label), ['sub']);
});

test('buildWorkspaceTree sinks collapsed nodes below expanded siblings per level', () => {
  const mk = (cwd, ts) => ({ cwd, lastActivity: ts });
  const collapsed = new Set(['/w/newest']);
  const tree = H.buildWorkspaceTree(H.groupByWorkspace([
    mk('/w/newest', '2026-01-03T00:00:00Z'),
    mk('/w/older', '2026-01-02T00:00:00Z'),
  ], collapsed), collapsed);
  assert.deepEqual(tree[0].children.map(c => c.label), ['older', 'newest']);
});

test('buildWorkspaceTree hoists a bare home root — ~/x groups stay top-level', () => {
  const mk = (cwd, ts) => ({ cwd, lastActivity: ts });
  const tree = H.buildWorkspaceTree(H.groupByWorkspace([
    mk('/home/u/workspace/a', '2026-01-03T00:00:00Z'),
    mk('/home/u/workspace/b', '2026-01-02T00:00:00Z'),
    mk('/home/u/src/dotfiles', '2026-01-01T00:00:00Z'),
  ]));
  assert.deepEqual(tree.map(n => n.label), ['~/workspace', '~/src/dotfiles']);
  assert.deepEqual(tree[0].children.map(c => c.label), ['a', 'b']);
});

test('collectTreeSessions gathers all descendant sessions', () => {
  const mk = (cwd, ts) => ({ cwd, lastActivity: ts });
  const tree = H.buildWorkspaceTree(H.groupByWorkspace([
    mk('/w/a', '2026-01-02T00:00:00Z'),
    mk('/w/b', '2026-01-01T00:00:00Z'),
    mk('/w/a', '2026-01-03T00:00:00Z'),
  ]));
  assert.equal(H.collectTreeSessions(tree[0]).length, 3);
});

test('buildSessionFamilies keeps parents first and sorts whole blocks by newest descendant', () => {
  const sessions = [
    { id: 'parent', cwd: '/w', lastActivity: '2026-01-01T00:00:00Z' },
    { id: 'child', parentId: 'parent', cwd: '/w', lastActivity: '2026-01-05T00:00:00Z' },
    { id: 'grandchild', parentId: 'child', cwd: '/w', lastActivity: '2026-01-04T00:00:00Z' },
    { id: 'standalone', cwd: '/w', lastActivity: '2026-01-03T00:00:00Z' },
    { id: 'other-cwd', parentId: 'parent', cwd: '/elsewhere', lastActivity: '2026-01-06T00:00:00Z' },
  ];
  const roots = H.buildSessionFamilies(sessions);
  assert.deepEqual(roots.map(root => root.session.id), ['other-cwd', 'parent', 'standalone']);
  assert.equal(roots[1].activity, Date.parse('2026-01-05T00:00:00Z'));
  assert.equal(roots[1].size, 3);
  assert.deepEqual(roots[1].children.map(child => child.session.id), ['child']);
  assert.deepEqual(H.flattenSessionFamilies([roots[1]]).map(s => s.id), ['parent', 'child', 'grandchild']);
});

test('session family cycles degrade to standalone roots', () => {
  const roots = H.buildSessionFamilies([
    { id: 'a', parentId: 'b', cwd: '/w', lastActivity: 1 },
    { id: 'b', parentId: 'a', cwd: '/w', lastActivity: 2 },
  ]);
  assert.deepEqual(roots.map(root => root.session.id), ['b', 'a']);
  assert.ok(roots.every(root => root.children.length === 0));
});

test('partitionPinnedFamilies pins and orders the whole family from any member id', () => {
  const families = H.buildSessionFamilies([
    { id: 'p', cwd: '/w', lastActivity: 1 },
    { id: 'c', parentId: 'p', cwd: '/w', lastActivity: 2 },
    { id: 'other', cwd: '/w', lastActivity: 3 },
  ]);
  const [pinned, rest] = H.partitionPinnedFamilies(families, ['c']);
  assert.deepEqual(pinned.map(root => root.session.id), ['p']);
  assert.deepEqual(rest.map(root => root.session.id), ['other']);

  const activeFragment = H.buildSessionFamilies([
    { id: 'c', parentId: 'p', familyParentId: 'p', cwd: '/w', lastActivity: 2 },
  ]);
  assert.deepEqual(H.partitionPinnedFamilies(activeFragment, ['p'])[0]
    .map(root => root.session.id), ['c'], 'missing inactive parent aliases its visible child fragment');
  const crossCwdFragment = H.buildSessionFamilies([
    { id: 'x', parentId: 'p', familyParentId: null, cwd: '/other', lastActivity: 3 },
  ]);
  assert.equal(H.partitionPinnedFamilies(crossCwdFragment, ['p'])[0].length, 0,
    'confirmed cross-workspace lineage never aliases the parent pin');
});

test('partitionPinnedFamilies matches pins by host + session key', () => {
  const families = H.buildSessionFamilies([
    { id: 'p', host: 'hostA', cwd: '/w', lastActivity: 1 },
    { id: 'c', host: 'hostA', parentId: 'p', cwd: '/w', lastActivity: 2 },
    { id: 'p', host: 'hostB', cwd: '/w2', lastActivity: 3 },
  ]);
  assert.deepEqual(H.partitionPinnedFamilies(families, ['hostA c'])[0]
    .map(root => `${root.session.host} ${root.session.cwd}`), ['hostA /w']);
  // a bare (unmigrated) pin does not reach into a host-stamped list
  assert.equal(H.partitionPinnedFamilies(families, ['c'])[0].length, 0);

  const fragment = H.buildSessionFamilies([
    { id: 'c', host: 'hostA', parentId: 'p', familyParentId: 'p', cwd: '/w', lastActivity: 2 },
  ]);
  assert.deepEqual(H.partitionPinnedFamilies(fragment, ['hostA p'])[0]
    .map(root => root.session.id), ['c'], 'missing parent aliases within its own host');
  assert.equal(H.partitionPinnedFamilies(fragment, ['hostB p'])[0].length, 0);
});

test('sortRelations ranks singular lineage links ahead of child lists, stable within a kind', () => {
  const rel = (kind, id) => ({ kind, session: { id } });
  const input = [
    rel('child', 'c1'), rel('child', 'c2'), rel('startedHere', 'sh1'),
    rel('parent', 'p'), rel('startedFrom', 'sf'), rel('child', 'c3'), rel('mystery', 'm'),
  ];
  const sorted = H.sortRelations(input);
  assert.deepEqual(sorted.map(r => r.session.id), ['p', 'sf', 'c1', 'c2', 'c3', 'sh1', 'm']);
  assert.deepEqual(input.map(r => r.session.id), ['c1', 'c2', 'sh1', 'p', 'sf', 'c3', 'm'],
    'input array is not mutated');
  assert.deepEqual(H.sortRelations(undefined), []);
  assert.deepEqual(H.sortRelations(null), []);
});

test('isChildRelation treats native and pi-dish child lineage as child fan-outs', () => {
  assert.equal(H.isChildRelation({ kind: 'child' }), true);
  assert.equal(H.isChildRelation({ kind: 'startedHere' }), true);
  assert.equal(H.isChildRelation({ kind: 'parent' }), false);
  assert.equal(H.isChildRelation({ kind: 'startedFrom' }), false);
  assert.equal(H.isChildRelation(null), false);
});

test('groupRelations groups by kind in rank order and skips nothing', () => {
  const rel = (kind, id) => ({ kind, session: { id } });
  const groups = H.groupRelations([
    rel('child', 'c1'), rel('parent', 'p'), rel('child', 'c2'), rel('startedHere', 'sh'),
  ]);
  assert.deepEqual(groups.map(g => g.kind), ['parent', 'child', 'startedHere']);
  assert.deepEqual(groups[1].relations.map(r => r.session.id), ['c1', 'c2']);
  assert.deepEqual(H.groupRelations(undefined), []);
  assert.equal(H.groupRelations([{ session: { id: 'x' } }])[0].kind, 'related',
    'kind-less relations fall into a generic group');
});

test('partitionPinned splits in pinned order and skips unknown ids', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const [pinned, rest] = H.partitionPinned(list, ['c', 'gone', 'a']);
  assert.deepEqual(pinned.map(s => s.id), ['c', 'a']);
  assert.deepEqual(rest.map(s => s.id), ['b']);
  assert.deepEqual(H.partitionPinned(list, []), [[], list]);
  assert.deepEqual(H.partitionPinned(list, undefined), [[], list]);
});

test('applyLocalFilter requires every token across name/cwd/model/id', () => {
  const list = [
    { name: 'fix login', cwd: '/home/u/webapp', model: 'gpt-5.5', id: 's1' },
    { name: 'refactor', cwd: '/home/u/api', model: 'glm-5.2', id: 's2' },
  ];
  assert.deepEqual(H.applyLocalFilter(list, 'webapp gpt').map(s => s.id), ['s1']);
  assert.deepEqual(H.applyLocalFilter(list, 'refactor gpt'), []);
  assert.equal(H.applyLocalFilter(list, ''), list);
});

test('parseSessionQuery splits terms, negation, fields, quotes, and dates', () => {
  const now = new Date('2026-07-21T12:00:00').getTime();
  const p = H.parseSessionQuery('foo -bar name:sub -cwd:api "two words" since:7d before:2026-07-01', now);
  assert.deepEqual(p.terms, [
    { neg: false, field: null, value: 'foo' },
    { neg: true, field: null, value: 'bar' },
    { neg: false, field: 'name', value: 'sub' },
    { neg: true, field: 'cwd', value: 'api' },
    { neg: false, field: null, value: 'two words' },
  ]);
  assert.equal(p.since, now - 7 * 86400e3);
  assert.equal(p.before, new Date('2026-07-01T00:00:00').getTime());
});

test('parseSessionQuery keeps unknown prefixes and bad dates literal', () => {
  const p = H.parseSessionQuery('subagent: fix since:banana -name:"two words"');
  assert.deepEqual(p.terms, [
    { neg: false, field: null, value: 'subagent:' },
    { neg: false, field: null, value: 'fix' },
    { neg: false, field: null, value: 'since:banana' },
    { neg: true, field: 'name', value: 'two words' },
  ]);
  assert.equal(p.since, null);
  const empty = H.parseSessionQuery('');
  assert.deepEqual(empty, { terms: [], since: null, before: null });
});

test('parseSessionQuery accepts only real ISO calendar dates', () => {
  const p = H.parseSessionQuery(
    'since:2024-02-29 before:2026-02-31 since:2026-02-29 before:2026-13-01 since:2026-04-31 before:2026-01-00',
  );
  assert.equal(p.since, new Date('2024-02-29T00:00:00').getTime(),
    'a valid leap day keeps local-midnight semantics');
  assert.equal(p.before, null);
  assert.deepEqual(p.terms, [
    { neg: false, field: null, value: 'before:2026-02-31' },
    { neg: false, field: null, value: 'since:2026-02-29' },
    { neg: false, field: null, value: 'before:2026-13-01' },
    { neg: false, field: null, value: 'since:2026-04-31' },
    { neg: false, field: null, value: 'before:2026-01-00' },
  ], 'impossible ISO values fall back to documented literal terms');
});

test('parseSessionQuery ANDs repeated date bounds (max since, min before)', () => {
  const now = new Date('2026-07-21T12:00:00').getTime();
  const p = H.parseSessionQuery('since:7d since:1d before:2026-07-01 before:2026-06-01', now);
  assert.equal(p.since, now - 86400e3);
  assert.equal(p.before, new Date('2026-06-01T00:00:00').getTime());
});

test('evaluateSessionQuery: fields scope, negation is metadata-only, content widens plain terms', () => {
  const s = { name: 'subagent: fix tests', cwd: '/home/u/webapp', model: 'gpt-5.5', id: 's1', lastActivity: '2026-07-20T10:00:00' };
  const q = (str, content) => H.evaluateSessionQuery(H.parseSessionQuery(str, new Date('2026-07-21T12:00:00').getTime()), s, content);
  assert.equal(q('name:subagent'), true);
  assert.equal(q('-name:subagent'), false);
  assert.equal(q('cwd:webapp fix'), true);
  assert.equal(q('model:webapp'), false); // field-scoped: webapp is the cwd, not the model
  // Positive plain terms reach content; negations never do.
  assert.equal(q('deploy'), false);
  assert.equal(q('deploy', 'we discussed the deploy here'), true);
  assert.equal(q('-deploy', 'we discussed the deploy here'), true);
  // Date bounds against lastActivity.
  assert.equal(q('since:7d'), true);
  assert.equal(q('since:1d'), false);
  assert.equal(q('before:2026-07-01'), false);
  assert.equal(q('since:7d before:2026-07-21'), true);
});

test('evaluateSessionQuery: is:active tests liveness, not substrings', () => {
  const live = { name: 'x', cwd: '/a', model: 'm', id: 's1', isActive: true, lastActivity: '2026-07-20' };
  const dead = { ...live, id: 's2', isActive: false };
  const q = (str, s) => H.evaluateSessionQuery(H.parseSessionQuery(str), s);
  assert.equal(q('is:active', live), true);
  assert.equal(q('is:active', dead), false);
  assert.equal(q('-is:active', dead), true);
  assert.equal(q('-is:active', live), false);
  assert.equal(q('is:banana', live), false); // typo can't mean "everything"
});

test('parseSessionQuery treats host: as a field term, negated and quoted alike', () => {
  const p = H.parseSessionQuery('host:beelink -host:framework host:"work laptop" hostname:x');
  assert.deepEqual(p.terms, [
    { neg: false, field: 'host', value: 'beelink' },
    { neg: true, field: 'host', value: 'framework' },
    { neg: false, field: 'host', value: 'work laptop' },
    { neg: false, field: null, value: 'hostname:x' }, // unknown prefix stays literal
  ]);
});

test('evaluateSessionQuery: host: matches the label, falls back to the host id', () => {
  const q = (str, s) => H.evaluateSessionQuery(H.parseSessionQuery(str), s);
  const labelled = { name: 'x', cwd: '/a', model: 'm', id: 's1', host: 'uuid-1', hostLabel: 'beelink' };
  const idOnly = { name: 'x', cwd: '/a', model: 'm', id: 's2', host: 'uuid-2' };
  const hostless = { name: 'x', cwd: '/a', model: 'm', id: 's3' }; // a server's own view
  assert.equal(q('host:beel', labelled), true); // case-insensitive substring, like every field
  assert.equal(q('host:BEEL', labelled), true);
  assert.equal(q('host:uuid-1', labelled), false); // the label wins where there is one
  assert.equal(q('host:uuid-2', idOnly), true);
  assert.equal(q('-host:beelink', labelled), false);
  assert.equal(q('-host:beelink', idOnly), true);
  // Server-side sessions carry neither field: a positive host term matches
  // nothing there and a negated one everything — which is why clients strip
  // host terms before querying a server at all.
  assert.equal(q('host:beelink', hostless), false);
  assert.equal(q('-host:beelink', hostless), true);
});

test('host: composes with is:active, since: and plain terms', () => {
  const now = new Date('2026-07-21T12:00:00').getTime();
  const s = { name: 'fix login', cwd: '/a', model: 'm', id: 's1', hostLabel: 'beelink', isActive: true, lastActivity: '2026-07-20T10:00:00' };
  const q = (str) => H.evaluateSessionQuery(H.parseSessionQuery(str, now), s);
  assert.equal(q('host:beelink is:active'), true);
  assert.equal(q('host:other is:active'), false);
  assert.equal(q('host:beelink -is:active'), false);
  assert.equal(q('host:beelink since:7d login'), true);
  assert.equal(q('host:beelink since:1d'), false);
  // Field terms never score: a host-only query stays recency-ordered.
  assert.equal(H.scoreSessionMatch(H.parseSessionQuery('host:beelink'), s), 0);
  assert.deepEqual(H.positiveQueryTokens(H.parseSessionQuery('host:beelink login')), ['login'],
    'host: never reaches content search');
});

test('stripQueryField removes a field\'s tokens and leaves the rest tokenized as parsed', () => {
  const strip = (q) => H.stripQueryField(q, 'host');
  assert.equal(strip('host:beelink login'), 'login');
  assert.equal(strip('login -host:framework bug'), 'login bug');
  assert.equal(strip('host:"work laptop" login'), 'login');
  assert.equal(strip('-host:"work laptop"'), '');
  assert.equal(strip('login bug'), 'login bug', 'field absent: untouched');
  assert.equal(strip('name:sub cwd:api is:active since:7d'), 'name:sub cwd:api is:active since:7d');
  assert.equal(strip('  host:a   login   '), 'login', 'whitespace normalizes');
  assert.equal(strip(''), '');
  assert.equal(strip('hostname:x host:a'), 'hostname:x', 'only the exact field is stripped');
  assert.equal(H.stripQueryField('name:sub host:a login', 'name'), 'host:a login');
  // The stripped query still parses to exactly the non-host terms.
  const full = H.parseSessionQuery('login -host:framework "two words" is:active');
  const rest = H.parseSessionQuery(strip('login -host:framework "two words" is:active'));
  assert.deepEqual(rest.terms, full.terms.filter(t => t.field !== 'host'));
});

test('applyHostTerms filters on host terms alone, ignoring the rest of the query', () => {
  const list = [
    { id: 's1', name: 'alpha', hostLabel: 'beelink' },
    { id: 's2', name: 'beta', hostLabel: 'framework' },
    { id: 's3', name: 'gamma', host: 'uuid-3' },
  ];
  assert.deepEqual(H.applyHostTerms(list, 'host:beelink').map(s => s.id), ['s1']);
  assert.deepEqual(H.applyHostTerms(list, '-host:beelink').map(s => s.id), ['s2', 's3']);
  assert.deepEqual(H.applyHostTerms(list, 'host:uuid-3').map(s => s.id), ['s3']);
  // Non-host terms are the server's job on this path — they must not narrow.
  assert.deepEqual(H.applyHostTerms(list, 'host:beelink zzz name:nope').map(s => s.id), ['s1']);
  assert.equal(H.applyHostTerms(list, 'zzz'), list);
  assert.equal(H.applyHostTerms(list, ''), list);
});

test('buildSnippets returns multiple windows and a total occurrence count', () => {
  const text = 'alpha starts here. ' + 'padding words go between the occurrences to separate windows. '.repeat(3)
    + 'alpha again in the middle. ' + 'more padding words follow before the last one appears far away. '.repeat(3)
    + 'final alpha here. and one trailing alpha beyond the window cap.';
  const { snippets, count } = H.buildSnippets(text, ['alpha'], { radius: 20, max: 3 });
  assert.equal(count, 4);
  assert.equal(snippets.length, 3);
  assert.ok(snippets[0].includes('alpha starts'));
  assert.ok(snippets[1].includes('alpha again'));
  assert.ok(snippets[2].includes('final alpha'));
  assert.ok(snippets[1].startsWith('…') && snippets[1].endsWith('…'), 'middle window marks both elided ends');
  assert.deepEqual(H.buildSnippets(text, []), { snippets: [], count: 0 });
  assert.deepEqual(H.buildSnippets(text, ['zzz']), { snippets: [], count: 0 });
  // The single-snippet wrapper still behaves as before.
  assert.ok(H.buildSnippet(text, ['alpha']).includes('alpha starts'));
  assert.equal(H.buildSnippet(text, ['zzz']), '');
});

test('positiveQueryTokens extracts only plain positive terms', () => {
  const p = H.parseSessionQuery('foo -bar name:sub "two words" since:7d');
  assert.deepEqual(H.positiveQueryTokens(p), ['foo', 'two words']);
});

test('applyLocalFilter understands the query grammar', () => {
  const list = [
    { name: 'subagent: fix login', cwd: '/home/u/webapp', model: 'gpt-5.5', id: 's1', lastActivity: '2026-07-20' },
    { name: 'refactor', cwd: '/home/u/api', model: 'glm-5.2', id: 's2', lastActivity: '2026-05-01' },
  ];
  assert.deepEqual(H.applyLocalFilter(list, '-name:subagent').map(s => s.id), ['s2']);
  assert.deepEqual(H.applyLocalFilter(list, 'cwd:webapp').map(s => s.id), ['s1']);
  assert.equal(H.applyLocalFilter(list, ''), list);
});

test('scoreSessionMatch: distinct-keyword coverage beats repeating one keyword', () => {
  const s = (over) => ({ name: 'n', cwd: '/c', model: 'm', id: 'i', ...over });
  const p = H.parseSessionQuery('alpha bravo');
  // Every token contributes independently, and each token's content share is
  // capped — so hitting two keywords (one of them where it counts, the name)
  // outranks a transcript that shouts a single keyword hundreds of times.
  const covered = H.scoreSessionMatch(p, s({ name: 'alpha plan' }), 'and bravo once');
  const shouted = H.scoreSessionMatch(p, s(), 'alpha '.repeat(200) + 'bravo');
  assert.ok(covered > shouted, `coverage (${covered}) outranks repetition (${shouted})`);
  // Repetition still helps, just with diminishing returns.
  assert.ok(H.scoreSessionMatch(p, s(), 'alpha alpha alpha bravo')
    > H.scoreSessionMatch(p, s(), 'alpha bravo'));
});

test('scoreSessionMatch: metadata outranks content, name outranks the rest', () => {
  const p = H.parseSessionQuery('alpha');
  const named = H.scoreSessionMatch(p, { name: 'alpha rewrite', cwd: '/c', model: 'm', id: 'i' });
  const inCwd = H.scoreSessionMatch(p, { name: 'n', cwd: '/home/u/alpha', model: 'm', id: 'i' });
  const contentOnly = H.scoreSessionMatch(p, { name: 'n', cwd: '/c', model: 'm', id: 'i' },
    'alpha '.repeat(200));
  assert.equal(named, 100);
  assert.equal(inCwd, 30);
  assert.ok(named > contentOnly, `name hit (${named}) beats a content-only match (${contentOnly})`);
  // Content contribution is capped per token: 20 base + 30 max log bonus.
  assert.equal(contentOnly, 50);
  assert.equal(H.scoreSessionMatch(p, { name: 'n', cwd: '/c', model: 'm', id: 'i' }, 'alpha'), 20);
});

test('scoreSessionMatch: only positive plain terms score', () => {
  const s = { name: 'alpha', cwd: '/home/u/webapp', model: 'gpt-5.5', id: 's1', isActive: true };
  const zero = (q) => assert.equal(H.scoreSessionMatch(H.parseSessionQuery(q), s, 'alpha alpha'), 0, q);
  zero('name:alpha');
  zero('-bravo');
  zero('since:7d');
  zero('is:active');
  zero('');
  // Field terms filter but don't rank — the plain term alone carries the score.
  assert.equal(H.scoreSessionMatch(H.parseSessionQuery('alpha name:alpha'), s), 100);
});

test('applyLocalFilter orders matches by relevance, then recency', () => {
  const list = [
    { name: 'unrelated', cwd: '/home/u/alpha', model: 'm', id: 's1', lastActivity: '2026-07-20' },
    { name: 'alpha rewrite', cwd: '/home/u/api', model: 'm', id: 's2', lastActivity: '2026-05-01' },
    { name: 'alpha notes', cwd: '/home/u/api', model: 'm', id: 's3', lastActivity: '2026-06-01' },
  ];
  // Name hits rank above the cwd hit despite being older; s3 breaks the
  // s2/s3 tie on recency.
  assert.deepEqual(H.applyLocalFilter(list, 'alpha').map(s => s.id), ['s3', 's2', 's1']);
  // No positive plain term → the incoming order stands.
  assert.deepEqual(H.applyLocalFilter(list, 'cwd:api').map(s => s.id), ['s2', 's3']);
});

test('groupSessionsByDate buckets by recency with undated sunk last', () => {
  const now = new Date('2026-07-21T12:00:00').getTime(); // a Tuesday
  const list = [
    { id: 'old', lastActivity: '2026-05-05T09:00:00' },
    { id: 'today', lastActivity: '2026-07-21T08:00:00' },
    { id: 'undated', lastActivity: new Date(0).toISOString() },
    { id: 'yesterday', lastActivity: '2026-07-20T23:00:00' },
    { id: 'lastweek', lastActivity: '2026-07-17T10:00:00' }, // Friday of the prior week
    { id: 'today2', lastActivity: '2026-07-21T01:00:00' },
  ];
  const buckets = H.groupSessionsByDate(list, now);
  assert.deepEqual(buckets.map(b => b.key), ['today', 'yesterday', 'lastweek', 'm:2026-05', 'undated']);
  assert.deepEqual(buckets[0].sessions.map(s => s.id), ['today', 'today2']);
  assert.equal(buckets[3].label, new Date('2026-05-05').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
});

test('groupSessionsByDate: Monday belongs to This week, Sunday before to Last week', () => {
  const now = new Date('2026-07-21T12:00:00').getTime(); // Tue; week starts Mon 2026-07-20
  const list = [
    { id: 'mon', lastActivity: '2026-07-20T00:30:00' },
    { id: 'sun', lastActivity: '2026-07-19T23:30:00' },
  ];
  const buckets = H.groupSessionsByDate(list, now);
  // Monday 00:30 is "Yesterday" (more specific than This week); Sunday falls to Last week.
  assert.deepEqual(buckets.map(b => b.key), ['yesterday', 'lastweek']);
});

test('fuzzyMatch finds in-order chars; fuzzyScore prefers tight early matches', () => {
  assert.deepEqual(H.fuzzyMatch('abc', 'a-b-c'), [0, 2, 4]);
  assert.equal(H.fuzzyMatch('abc', 'acb'), null);
  const tight = H.fuzzyScore(H.fuzzyMatch('app', 'apple'), 'apple');
  const loose = H.fuzzyScore(H.fuzzyMatch('app', 'a-p-p-le'), 'a-p-p-le');
  assert.ok(tight > loose);
  assert.equal(H.fuzzyScore(null, 'x'), -Infinity);
});

test('highlightFuzzy wraps matched chars and escapes the rest', () => {
  assert.equal(H.highlightFuzzy('a<b', [0]),
    '<span class="cwd-match">a</span>&lt;b');
  assert.equal(H.highlightFuzzy('x<y', []), 'x&lt;y');
});

test('isUnreadSession flags idle live sessions with activity newer than last seen', () => {
  const sess = (over = {}) => ({
    id: 's1', isActive: true, turnInProgress: false,
    lastActivity: '2026-07-05T10:00:00Z', ...over,
  });
  const seenOld = { s1: '2026-07-05T09:00:00Z' };
  const seenFresh = { s1: '2026-07-05T10:00:00Z' };

  assert.equal(H.isUnreadSession(sess(), seenOld, null, true), true);
  assert.equal(H.isUnreadSession(sess(), seenFresh, null, true), false);
  assert.equal(H.isUnreadSession(sess(), {}, null, true), true, 'never-seen live session is unread');
  // working sessions show the working dot instead
  assert.equal(H.isUnreadSession(sess({ turnInProgress: true }), seenOld, null, true), false);
  // historical sessions never
  assert.equal(H.isUnreadSession(sess({ isActive: false }), seenOld, null, true), false);
  // the session on screen is not unread — unless the tab is hidden
  assert.equal(H.isUnreadSession(sess(), seenOld, 's1', true), false);
  assert.equal(H.isUnreadSession(sess(), seenOld, 's1', false), true);
});

test('isUnreadSession keys on host + session, so ids may collide across hosts', () => {
  const sess = (host) => ({
    id: 's1', host, isActive: true, turnInProgress: false,
    lastActivity: '2026-07-05T10:00:00Z',
  });
  const seen = { 'hostA s1': '2026-07-05T10:00:00Z' };
  assert.equal(H.isUnreadSession(sess('hostA'), seen, null, true), false);
  assert.equal(H.isUnreadSession(sess('hostB'), seen, null, true), true,
    "another host's same-id session has its own seen state");
  // the current-session key is composite too
  assert.equal(H.isUnreadSession(sess('hostA'), {}, 'hostA s1', true), false);
  assert.equal(H.isUnreadSession(sess('hostA'), {}, 'hostB s1', true), true);
});

test('sessionKey/parseSessionKey round-trip and tolerate bare (pre-multi-host) ids', () => {
  assert.equal(H.sessionKey('hostA', 's1'), 'hostA s1');
  assert.deepEqual(H.parseSessionKey('hostA s1'), { hostId: 'hostA', sessionId: 's1' });
  // a session id may itself contain spaces; only the first one separates
  assert.deepEqual(H.parseSessionKey('hostA s 1'), { hostId: 'hostA', sessionId: 's 1' });
  // no host id yet (GET /api/host unanswered, or an older server): bare form
  assert.equal(H.sessionKey(null, 's1'), 's1');
  assert.equal(H.sessionKey('', 's1'), 's1');
  assert.deepEqual(H.parseSessionKey('s1'), { hostId: null, sessionId: 's1' });
  assert.deepEqual(H.parseSessionKey(null), { hostId: null, sessionId: '' });
  assert.equal(H.sessionRefKey({ id: 's1', host: 'hostA' }), 'hostA s1');
  assert.equal(H.sessionRefKey({ id: 's1' }), 's1');
  assert.equal(H.sessionRefKey(null), '');
});

test('normalizeHostBase yields a prefixable base and rejects garbage', () => {
  assert.equal(H.normalizeHostBase('http://tycho:3333/'), 'http://tycho:3333');
  assert.equal(H.normalizeHostBase('https://box.tail.ts.net'), 'https://box.tail.ts.net');
  assert.equal(H.normalizeHostBase('  http://a.b:1/x/y/  '), 'http://a.b:1/x/y');
  // hub-proxied peers are path bases on the serving origin
  assert.equal(H.normalizeHostBase('/hosts/tycho/'), '/hosts/tycho');
  // '' is the self host and stays ''
  assert.equal(H.normalizeHostBase(''), '');
  assert.equal(H.normalizeHostBase(null), '');
  // no guessing: a scheme-less or malformed base is an error, not localhost
  assert.equal(H.normalizeHostBase('tycho:3333'), null);
  assert.equal(H.normalizeHostBase('garbage'), null);
  assert.equal(H.normalizeHostBase('ftp://tycho'), null);
  assert.equal(H.normalizeHostBase('http://a b'), null);
  assert.equal(H.normalizeHostBase('/hosts/../etc'), null);
});

test('sanitizeHostCatalog drops broken entries instead of throwing', () => {
  assert.deepEqual(H.sanitizeHostCatalog([
    { hostId: 'a', label: 'Tycho', base: 'http://tycho:3333/', token: ' t ' },
    { base: '/hosts/b' },
    { hostId: 'c', base: 'nonsense' },      // unusable base
    { hostId: 'a', base: 'http://dup:1' },  // duplicate host id
    { base: '' },                           // self is implicit, never listed
    null, 'x', 42,
  ]), [
    { base: 'http://tycho:3333', hostId: 'a', label: 'Tycho', token: 't' },
    { base: '/hosts/b' },
  ]);
  assert.deepEqual(H.sanitizeHostCatalog(null), []);
  assert.deepEqual(H.sanitizeHostCatalog('nope'), []);
  assert.deepEqual(H.sanitizeHostCatalog([{ base: 'http://a:1', label: 7, token: 7 }]),
    [{ base: 'http://a:1' }]);
});

test('normalizeMood keeps whichever part is present and flattens whitespace', () => {
  assert.deepEqual(H.normalizeMood('Happy days', '(^_^)'), { description: 'happy', face: '(^_^)' });
  assert.deepEqual(H.normalizeMood('calm', ' ( \n- _ - ) '), { description: 'calm', face: '( - _ - )' });
  // {mood, label}-shaped set_mood tools may send only one half
  assert.deepEqual(H.normalizeMood('', 'focused'), { description: '', face: 'focused' });
  assert.deepEqual(H.normalizeMood('deep work', ''), { description: 'deep', face: '' });
  assert.equal(H.normalizeMood('', ''), null);
  assert.equal(H.normalizeMood(undefined, null), null);
});

test('modelMatchesPattern handles exact ids, aliases, globs, and thinking suffixes', () => {
  const sonnet = { provider: 'anthropic', id: 'claude-sonnet-4-5' };
  const dated = { provider: 'anthropic', id: 'claude-sonnet-4-5-20250929' };
  const glm = { provider: 'zai', id: 'glm-5.2' };

  // Exact full id / bare id (what the TUI's /scoped-models persists)
  assert.equal(H.modelMatchesPattern('anthropic/claude-sonnet-4-5', sonnet), true);
  assert.equal(H.modelMatchesPattern('claude-sonnet-4-5', sonnet), true);
  assert.equal(H.modelMatchesPattern('anthropic/claude-sonnet-4-5', glm), false);
  // Alias covers dated versions, not vice versa
  assert.equal(H.modelMatchesPattern('claude-sonnet-4-5', dated), true);
  assert.equal(H.modelMatchesPattern('claude-sonnet-4-5-20250929', sonnet), false);
  // Case-insensitive
  assert.equal(H.modelMatchesPattern('Anthropic/Claude-Sonnet-4-5', sonnet), true);
  // Globs match full id or bare id; * doesn't cross "/"
  assert.equal(H.modelMatchesPattern('*sonnet*', sonnet), true);
  assert.equal(H.modelMatchesPattern('anthropic/*', glm), false);
  assert.equal(H.modelMatchesPattern('zai/*', glm), true);
  assert.equal(H.modelMatchesPattern('*', glm), true, 'bare id has no slash for * to cross');
  // ":level" suffix stripped only when it is a real thinking level
  assert.equal(H.modelMatchesPattern('anthropic/claude-sonnet-4-5:high', sonnet), true);
  assert.equal(H.modelMatchesPattern('zai/glm-5.2:banana', glm), false);
  // Dots in glob patterns are literal, not regex wildcards
  assert.equal(H.modelMatchesPattern('glm-5.2*', glm), true);
  assert.equal(H.modelMatchesPattern('glm-5.2*', { provider: 'zai', id: 'glm-5x2' }), false);

  // A malformed glob (unbalanced '[') must not throw — it just doesn't match.
  assert.doesNotThrow(() => H.modelMatchesPattern('claude-[', glm));
  assert.equal(H.modelMatchesPattern('claude-[', glm), false);
});

test('isModelEnabled treats no patterns as everything enabled', () => {
  const m = { provider: 'anthropic', id: 'claude-sonnet-4-5' };
  assert.equal(H.isModelEnabled(null, m), true);
  assert.equal(H.isModelEnabled([], m), true);
  assert.equal(H.isModelEnabled(['anthropic/claude-sonnet-4-5'], m), true);
  assert.equal(H.isModelEnabled(['zai/glm-5.2'], m), false);
  assert.equal(H.isModelEnabled(['zai/glm-5.2', '*sonnet*'], m), true);
});

test('sanitizeMarkdownUrl neutralizes script-executing URL schemes', () => {
  // Blocked — collapse to a harmless anchor
  assert.equal(H.sanitizeMarkdownUrl('javascript:alert(1)'), '#');
  assert.equal(H.sanitizeMarkdownUrl('JAVASCRIPT:alert(1)'), '#', 'case-insensitive');
  assert.equal(H.sanitizeMarkdownUrl('  javascript:alert(1)'), '#', 'leading whitespace');
  assert.equal(H.sanitizeMarkdownUrl('java\tscript:alert(1)'), '#', 'control-char obfuscation');
  assert.equal(H.sanitizeMarkdownUrl('vbscript:msgbox(1)'), '#');
  assert.equal(H.sanitizeMarkdownUrl('data:text/html,<h1>x</h1>'), '#');

  // Allowed — passed through (trimmed)
  assert.equal(H.sanitizeMarkdownUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(H.sanitizeMarkdownUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(H.sanitizeMarkdownUrl('/relative/path'), '/relative/path');
  assert.equal(H.sanitizeMarkdownUrl('#anchor'), '#anchor');
  assert.equal(H.sanitizeMarkdownUrl(null), '');
});

test('pushPromptHistory trims, dedupes repeats, and caps', () => {
  assert.deepEqual(H.pushPromptHistory([], '  hello  '), ['hello']);
  assert.deepEqual(H.pushPromptHistory(['a'], ''), ['a']);
  assert.deepEqual(H.pushPromptHistory(['a'], '   '), ['a']);
  assert.deepEqual(H.pushPromptHistory(null, 'x'), ['x']);
  // Immediate repeat is dropped; non-adjacent repeat is kept
  assert.deepEqual(H.pushPromptHistory(['a', 'b'], 'b'), ['a', 'b']);
  assert.deepEqual(H.pushPromptHistory(['b', 'a'], 'b'), ['b', 'a', 'b']);
  // Cap drops oldest
  assert.deepEqual(H.pushPromptHistory(['1', '2', '3'], '4', 3), ['2', '3', '4']);
  // Input list is not mutated
  const list = ['a'];
  H.pushPromptHistory(list, 'b');
  assert.deepEqual(list, ['a']);
});

test('messageHasVisibleText spots prose and errors, not tool-only content', () => {
  assert.equal(H.messageHasVisibleText({ content: [{ type: 'text', text: 'hi' }] }), true);
  assert.equal(H.messageHasVisibleText({ content: 'plain string' }), true);
  assert.equal(H.messageHasVisibleText({ content: [], errorMessage: 'boom' }), true);
  assert.equal(H.messageHasVisibleText({ content: [{ type: 'toolCall', name: 'Bash' }] }), false);
  assert.equal(H.messageHasVisibleText({ content: [{ type: 'text', text: '' }] }), false);
  assert.equal(H.messageHasVisibleText({ content: [{ type: 'thinking', thinking: 'hm' }] }), false);
  assert.equal(H.messageHasVisibleText(null), false);
});

test('buildSnippet excerpts around the earliest token match', () => {
  const text = 'the quick brown fox jumps over the lazy dog and keeps on running through the field';
  const snip = H.buildSnippet(text, ['lazy'], 15);
  assert.ok(snip.includes('lazy'));
  assert.ok(snip.startsWith('…'), 'elided start marked');
  assert.ok(snip.endsWith('…'), 'elided end marked');
  assert.ok(!/…\S*?\s…/.test(snip));

  // Earliest token wins when several match; no ellipsis at true string edges.
  const both = H.buildSnippet('alpha then bravo', ['bravo', 'alpha']);
  assert.ok(both.startsWith('alpha'));
  assert.equal(H.buildSnippet('no match here', ['zzz']), '');
});

test('buildSnippet trims to word boundaries', () => {
  const text = 'aaaaaaaaaa needle bbbbbbbbbb cccccccccc';
  const snip = H.buildSnippet(text, ['needle'], 5);
  // Window edges shrink to whitespace: no partially-cut words around the hit.
  assert.ok(snip.includes('needle'));
  for (const word of snip.replace(/…/g, '').trim().split(/\s+/)) {
    assert.ok(text.split(/\s+/).includes(word), `"${word}" is a whole word from the source`);
  }
});

test('highlightTokens escapes HTML and merges overlapping marks', () => {
  assert.equal(H.highlightTokens('a <b> c', ['zzz']), 'a &lt;b&gt; c', 'no match: plain escape');
  assert.equal(H.highlightTokens('the Needle here', ['needle']),
    'the <mark>Needle</mark> here', 'case-insensitive, original casing kept');
  // Overlapping tokens produce one merged mark, never nested tags.
  const merged = H.highlightTokens('abcde', ['abc', 'cde']);
  assert.equal(merged, '<mark>abcde</mark>');
  // Token text that looks like HTML is escaped inside the mark too.
  assert.equal(H.highlightTokens('x <s> y', ['<s>']), 'x <mark>&lt;s&gt;</mark> y');
});

test('looksLikeFilePath accepts path-shaped mentions and rejects prose', () => {
  // Accepted: bare names with a real extension, qualified/rooted paths, :line suffixes.
  for (const s of ['findings.md', 'lib/tmux.js', 'lib/tmux.js:42', 'lib/tmux.js:42:7',
                   '/etc/hosts', '~/notes/plan.md', './run.sh', '../up/one.txt',
                   'package.json', '.zshrc.local', 'src/components']) {
    assert.ok(H.looksLikeFilePath(s), `${s} should look like a path`);
  }
  // Rejected: prose, versions, URLs, flags, whitespace.
  for (const s of ['hello', 'v1.2.3', '1.2.3', 'https://example.com/a.md', '--mode',
                   'two words.md', '', null, 'a'.repeat(300) + '.md', 'Makefile']) {
    assert.ok(!H.looksLikeFilePath(s), `${JSON.stringify(s)} should not look like a path`);
  }
});

test('findPathTokens picks file mentions out of prose, skipping URLs and word pairs', () => {
  const text = 'Wrote findings.md and /tmp/out/report.txt (see also lib/tmux.js:42). ' +
    'Not these: and/or input/output example.com https://x.io/a.md v1.2.3.';
  const tokens = H.findPathTokens(text).map(t => t.token);
  assert.deepEqual(tokens, ['findings.md', '/tmp/out/report.txt', 'lib/tmux.js:42']);
  // Offsets point at the token itself (sentence punctuation trimmed).
  const t0 = H.findPathTokens(text)[0];
  assert.equal(text.slice(t0.start, t0.end), 'findings.md');
  assert.deepEqual(H.findPathTokens('no paths here at all'), []);
});

test('renderDiffHtml renders hunk content only, with add/del classes', () => {
  const patch = [
    'diff --git a/x.txt b/x.txt',
    'index 000..111 100644',
    '--- a/x.txt',
    '+++ b/x.txt',
    '@@ -1,2 +1,2 @@',
    ' context <tag>',
    '-removed',
    '+added',
    '',
  ].join('\n');
  const html = H.renderDiffHtml(patch);
  assert.ok(!html.includes('diff --git'), 'file headers are dropped');
  assert.ok(!html.includes('index 000'), 'index lines are dropped');
  assert.ok(html.includes('<div class="diff-line diff-hunk" data-diff-line="1">@@ -1,2 +1,2 @@</div>'));
  assert.ok(html.includes('<div class="diff-line diff-add" data-diff-line="1" data-old-line="" data-new-line="2">+added</div>'));
  assert.ok(html.includes('<div class="diff-line diff-del" data-diff-line="1" data-old-line="2" data-new-line="">-removed</div>'));
  assert.ok(!html.includes('data-old-line="3" data-new-line="3"'), 'trailing patch newline is not a phantom source line');
  assert.ok(html.includes('&lt;tag&gt;'), 'content is HTML-escaped');
  assert.equal(H.renderDiffHtml(null), '');
  assert.equal(H.renderDiffHtml(''), '');
});

test('renderDiffHtml does not assign or advance line numbers for no-newline markers', () => {
  const patch = [
    '@@ -4,2 +4,3 @@',
    '-old last',
    '\\ No newline at end of file',
    '+new last',
    '+extra',
  ].join('\n');
  const html = H.renderDiffHtml(patch);
  assert.ok(html.includes('<div class="diff-line diff-note">\\ No newline at end of file</div>'));
  assert.ok(html.includes('data-old-line="" data-new-line="4">+new last</div>'));
  assert.ok(html.includes('data-old-line="" data-new-line="5">+extra</div>'));
  assert.ok(!html.includes('diff-note" data-diff-line'), 'the marker is not selectable as a diff line');
});

test('diffStatusClass maps git status letters to CSS-safe suffixes', () => {
  assert.equal(H.diffStatusClass('A'), 'add');
  assert.equal(H.diffStatusClass('?'), 'add');
  assert.equal(H.diffStatusClass('D'), 'del');
  assert.equal(H.diffStatusClass('R'), 'ren');
  assert.equal(H.diffStatusClass('U'), 'conflict');
  assert.equal(H.diffStatusClass('M'), 'mod');
  assert.equal(H.diffStatusClass('T'), 'mod');
});

test('telemetry formatters label compact response metadata and catalog estimates', () => {
  const msg = { durationMs: 2000, outputTokens: 60, usage: { output: 60, cost: { total: 0.0012 } } };
  assert.equal(H.formatResponseMetadata(msg, 'hidden'), null);
  assert.equal(H.formatResponseMetadata(msg, 'compact'), '30 tok/s');
  assert.equal(H.formatResponseMetadata(msg, 'performance'), '2.0s · 30 tok/s');
  assert.equal(H.formatResponseMetadata(msg, 'performance-cost'), '2.0s · 30 tok/s · ~$0.0012');
  assert.equal(H.formatResponseMetadata({ ...msg, pricingKnown: false }, 'performance-cost'), '2.0s · 30 tok/s');
  assert.equal(H.formatResponseMetadata({ ...msg, usage: { ...msg.usage, cost: { total: 0 } } }, 'performance-cost'), '2.0s · 30 tok/s · ~$0');
  assert.equal(H.formatResponseMetadata({ usage: { output: 1200 } }, 'compact'), '1.2k out');
  assert.equal(H.formatEstimatedCost(undefined), 'Unavailable');
  assert.equal(H.formatEstimatedCost(0.00001), '~$0.000010', 'tiny response costs do not round to apparent zero');
});

test('shortModelName strips providers, vendor prefixes, versions, and date stamps', () => {
  assert.equal(H.shortModelName('anthropic/claude-opus-4-8'), 'claude-opus-4-8');
  assert.equal(H.shortModelName('us.anthropic.claude-sonnet-4-5-20250929-v1:0'), 'claude-sonnet-4-5');
  assert.equal(H.shortModelName('claude-3-5-sonnet-20241022'), 'claude-3-5-sonnet');
  assert.equal(H.shortModelName('gpt-4o-2024-11-20'), 'gpt-4o');
  assert.equal(H.shortModelName('gpt-4.1'), 'gpt-4.1'); // dots in ids are not vendor prefixes
  assert.equal(H.shortModelName('amazon.nova-pro-v1:0'), 'nova-pro');
  assert.equal(H.shortModelName('deepseek-v4'), 'deepseek-v4'); // "-vN" without ":N" is a real model name
  assert.equal(H.shortModelName('gemini-2.5-pro'), 'gemini-2.5-pro');
  assert.equal(H.shortModelName(''), 'unknown');
});

test('niceTicks produces clean ascending steps that cover the maximum', () => {
  assert.deepEqual(H.niceTicks(3.42), { step: 1, top: 4, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(H.niceTicks(0.037).ticks, [0, 0.01, 0.02, 0.03, 0.04]);
  assert.deepEqual(H.niceTicks(100).ticks, [0, 25, 50, 75, 100]);
  const t = H.niceTicks(875);
  assert.ok(t.top >= 875 && t.ticks.length >= 4 && t.ticks.length <= 6);
  assert.equal(t.ticks[0], 0);
  assert.deepEqual(H.niceTicks(0).ticks, [0, 1]); // empty ranges still draw an axis
});

test('formatUsageDay renders locale-free short and long labels', () => {
  assert.equal(H.formatUsageDay('2026-07-12'), 'Jul 12');
  assert.equal(H.formatUsageDay('2026-07-12', 'long'), 'Sun, Jul 12, 2026');
  assert.equal(H.formatUsageDay('unknown'), 'unknown');
});

test('aggregateUsageWeekly chunks from the end and merges model rows by ref', () => {
  const mkDay = (day, cost, ref) => ({
    day, calls: 1,
    tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
    costUnavailable: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    models: [{ ref, provider: ref.split('/')[0], model: ref.split('/')[1], calls: 1, cost, costUnavailable: { total: 0 }, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }],
  });
  const daily = [];
  for (let i = 0; i < 10; i++) daily.push(mkDay(`2026-07-${String(i + 1).padStart(2, '0')}`, 1, i % 2 ? 'a/m1' : 'b/m2'));
  const weeks = H.aggregateUsageWeekly(daily);
  assert.equal(weeks.length, 2);
  // Anchored at the end: the oldest bucket is the partial one.
  assert.deepEqual(weeks.map(w => w.days), [3, 7]);
  assert.equal(weeks[0].day, '2026-07-01');
  assert.equal(weeks[1].day, '2026-07-04');
  assert.equal(weeks[1].calls, 7);
  assert.equal(weeks[1].costs.total, 7);
  assert.equal(weeks[1].tokens.input, 70);
  const refs = weeks[1].models.map(m => m.ref).sort();
  assert.deepEqual(refs, ['a/m1', 'b/m2']);
  assert.equal(weeks[1].models.reduce((s, m) => s + m.calls, 0), 7);
});

test('aggregateUsageWeekly preserves component availability across mixed days', () => {
  const tokens = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  const known = {
    day: '2026-07-01', calls: 1, tokens,
    costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    costUnavailable: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    models: [{ ref: 'free/model', calls: 1, cost: 0, costUnavailable: { total: 0 }, tokens }],
  };
  const partial = {
    day: '2026-07-02', calls: 1, tokens,
    costs: { input: null, output: 0.2, cacheRead: null, cacheWrite: null, total: 0.2 },
    costUnavailable: { input: 1, output: 0, cacheRead: 1, cacheWrite: 1, total: 0 },
    models: [{ ref: 'free/model', calls: 1, cost: 0.2, costUnavailable: { total: 0 }, tokens }],
  };
  let week = H.aggregateUsageWeekly([known, partial])[0];
  assert.equal(week.costs.total, 0.2, 'known totals survive unknown components');
  assert.equal(week.costs.input, null);
  assert.equal(week.costUnavailable.input, 1);
  assert.equal(week.models[0].cost, 0.2, 'explicit-zero model cost remains part of a known sum');

  const missingTotal = {
    ...partial, day: '2026-07-03', costs: { ...partial.costs, total: null },
    costUnavailable: { ...partial.costUnavailable, total: 1 },
    models: [{ ref: 'free/model', calls: 1, cost: null, costUnavailable: { total: 1 }, tokens }],
  };
  week = H.aggregateUsageWeekly([known, partial, missingTotal])[0];
  assert.equal(week.costs.total, null, 'a mixed week never exposes a partial total');
  assert.equal(week.costUnavailable.total, 1);
  assert.equal(week.models[0].cost, null, 'the same all-known rule applies per model');
});

test('tmuxPrefixSeq maps tmux prefix notation to raw bytes', () => {
  assert.equal(H.tmuxPrefixSeq('C-b'), '\x02');
  assert.equal(H.tmuxPrefixSeq('C-a'), '\x01');
  assert.equal(H.tmuxPrefixSeq('C-Space'), '\x00');
  assert.equal(H.tmuxPrefixSeq('M-x'), '\x1bx');
  assert.equal(H.tmuxPrefixSeq('F12'), null, 'unmappable prefixes return null (button hides)');
  assert.equal(H.tmuxPrefixSeq(null), null);
  assert.equal(H.tmuxPrefixSeq(undefined), null);
});

test('sessionSupports preserves legacy defaults and honors explicit denial', () => {
  assert.equal(H.sessionSupports({}, 'tree'), true);
  assert.equal(H.sessionSupports({ capabilities: {} }, 'close'), true);
  assert.equal(H.sessionSupports({ capabilities: { close: false } }, 'close'), false);
  assert.equal(H.sessionSupports({ capabilities: { export: true } }, 'export'), true);
});

test('harnessBadgeInfo gives every agent harness a compact unique icon', () => {
  assert.deepEqual(H.harnessBadgeInfo('pi'), { label: 'Pi', icon: 'vendor/harness-pi.svg' });
  assert.deepEqual(H.harnessBadgeInfo('omp'), { label: 'OMP', icon: 'vendor/harness-omp.svg' });
  assert.deepEqual(H.harnessBadgeInfo('prime'), { label: 'Prime', icon: 'vendor/harness-prime.svg' });
  assert.deepEqual(H.harnessBadgeInfo('custom', 'Custom Agent'), { label: 'Custom Agent', icon: null });
});

test('OMP_MODEL_ROLES lists the canonical roles in harness order', () => {
  assert.deepEqual(H.OMP_MODEL_ROLES.map(r => r.key),
    ['default', 'smol', 'slow', 'vision', 'plan', 'designer', 'commit', 'tiny', 'task', 'advisor']);
  assert.ok(H.OMP_MODEL_ROLES.every(r => r.name && r.description));
});

test('buildModelRoleRows keeps global values editable and flags project overrides', () => {
  const rows = H.buildModelRoleRows(
    { default: 'zai/glm-4.7', 'my-role': 'zai/glm-5.2' },
    { default: 'zai/glm-4.7', vision: 'anthropic/claude-opus-4', 'my-role': 'zai/glm-5.2' },
  );
  assert.equal(rows.length, H.OMP_MODEL_ROLES.length + 1);

  const def = rows.find(r => r.key === 'default');
  assert.equal(def.value, 'zai/glm-4.7');
  assert.equal(def.override, null, 'matching effective value is not an override');

  // Effective-only values come from a project .omp/config.yml — the row still
  // edits the (empty) global assignment.
  const vision = rows.find(r => r.key === 'vision');
  assert.equal(vision.value, '');
  assert.equal(vision.override, 'anthropic/claude-opus-4');

  const custom = rows.at(-1);
  assert.deepEqual(
    { key: custom.key, custom: custom.custom, value: custom.value, override: custom.override },
    { key: 'my-role', custom: true, value: 'zai/glm-5.2', override: null });
  assert.ok(rows.slice(0, H.OMP_MODEL_ROLES.length).every(r => r.custom === false));
});

test('buildModelRoleRows tolerates missing or malformed records', () => {
  const rows = H.buildModelRoleRows(null, undefined);
  assert.equal(rows.length, H.OMP_MODEL_ROLES.length);
  assert.ok(rows.every(r => r.value === '' && r.override === null));
  assert.equal(H.buildModelRoleRows({ default: 42, ok: 'zai/glm-5.2' }, ['x']).length,
    H.OMP_MODEL_ROLES.length + 1, 'non-string values are dropped, arrays are not records');
});

test('formatModelRoleSummary orders canonically and truncates gracefully', () => {
  assert.equal(H.formatModelRoleSummary({ smol: 'a/b', default: 'c/d' }), 'default c/d · smol a/b');
  assert.equal(H.formatModelRoleSummary({}), 'No roles assigned');
  assert.equal(H.formatModelRoleSummary(null), 'No roles assigned');
  assert.equal(
    H.formatModelRoleSummary({ default: 'a/b', smol: 'a/b', slow: 'a/b', vision: 'a/b', plan: 'a/b' }),
    'default a/b · smol a/b · slow a/b · vision a/b · +1 more');
  assert.equal(H.formatModelRoleSummary({ zeta: 'a/b', default: 'c/d' }, 2), 'default c/d · zeta a/b',
    'custom keys sort after the canonical ones');
});

// =========================================================================
// Multi-host (TASKS/multi-host.md phase 2) — the client is the aggregator,
// so the merges it performs are pure functions with tests, not view code.
// =========================================================================

test('hostDisplayLabel prefers label, then fleet name, then the bare base', () => {
  assert.equal(H.hostDisplayLabel({ label: 'tycho', name: 'x', base: 'http://a:1' }), 'tycho');
  assert.equal(H.hostDisplayLabel({ name: 'tycho', base: '/hosts/tycho' }), 'tycho');
  assert.equal(H.hostDisplayLabel({ base: 'http://10.0.0.4:3333' }), '10.0.0.4:3333');
  assert.equal(H.hostDisplayLabel({ base: '' }), 'this host');
  assert.equal(H.hostDisplayLabel(null), '');
});

test('mergeHostEntries puts self first and keys on hostId, then base', () => {
  const hosts = H.mergeHostEntries(
    { hostId: 'self-id', label: 'laptop', capabilities: { tmux: true } },
    [{ name: 'tycho', base: '/hosts/tycho', kind: 'ssh', hostId: 'tycho-id', reachable: true },
     { self: true, base: '', hostId: 'self-id' }],
    [{ base: 'http://ganymede:3333/', label: 'ganymede', token: 'tok' }],
  );
  assert.deepEqual(hosts.map(h => h.key), ['self-id', 'tycho-id', 'http://ganymede:3333']);
  assert.equal(hosts[0].self, true);
  assert.equal(hosts[0].base, '', 'self is always the serving origin');
  assert.equal(hosts[1].source, 'fleet');
  assert.equal(hosts[2].token, 'tok', 'directly-added hosts carry their own token');
  assert.equal(hosts.filter(h => h.hostId === 'self-id').length, 1,
    'the fleet listing of ourselves folds into the self entry');
});

test('mergeHostEntries folds duplicates but keeps the fields only the loser had', () => {
  const hosts = H.mergeHostEntries(
    { hostId: 'self-id' },
    [{ name: 'tycho', base: '/hosts/tycho', hostId: 'tycho-id' }],
    [{ base: 'http://tycho:3333', hostId: 'tycho-id', token: 'tok', label: 'Tycho (direct)' }],
  );
  assert.equal(hosts.length, 2);
  assert.equal(hosts[1].base, '/hosts/tycho', 'the same-origin proxy path wins the base');
  assert.equal(hosts[1].token, 'tok', 'but the user-entered token is not lost');
  assert.equal(hosts[1].label, 'Tycho (direct)');
});

test('mergeHostEntries drops garbage bases instead of guessing', () => {
  const hosts = H.mergeHostEntries({ hostId: 'self-id' },
    [{ name: 'bad', base: 'tycho:3333' }, null, { name: 'ok', base: 'http://ok:1' }],
    [{ base: 'not a url' }, { nope: true }]);
  assert.deepEqual(hosts.map(h => h.base), ['', 'http://ok:1']);
});

// --- per-host capability gating -------------------------------------------

test('hostSupportsTerminal reads the owning host\'s advertised capabilities', () => {
  const remote = (caps) => ({ hostId: 'tycho-id', base: 'http://tycho:3333', capabilities: caps });
  assert.equal(H.hostSupportsTerminal(remote({ terminal: true, tmux: true }), { terminal: false }), true,
    'a peer that advertises the terminal is usable from a terminal-less entry host');
  assert.equal(H.hostSupportsTerminal(remote({ terminal: false }), { terminal: true }), false);
  assert.equal(H.hostSupportsTerminal(remote({ sessions: true }), { terminal: true }), false,
    'absent capability in an advertised set means unsupported');
});

test('hostSupportsTerminal falls back to /api/config for self only', () => {
  const self = { hostId: 'self-id', base: '', self: true, capabilities: null };
  assert.equal(H.hostSupportsTerminal(self, { terminal: true }), true,
    'self before /api/host answers keeps single-host behavior');
  assert.equal(H.hostSupportsTerminal(self, { terminal: false }), false);
  assert.equal(H.hostSupportsTerminal({ base: '', capabilities: null }, { terminal: true }), true,
    'the serving origin is self even without the flag');
  assert.equal(H.hostSupportsTerminal({ ...self, capabilities: { sessions: true } }, { terminal: true }), false,
    'self capabilities win over the config fallback once advertised');
  assert.equal(H.hostSupportsTerminal({ hostId: 'old-id', base: 'http://old:3333' }, { terminal: true }), false,
    'a remote of unknown build hides the button rather than serving a dead one');
  assert.equal(H.hostSupportsTerminal(null, { terminal: true }), false,
    'no entry at all (a host that left the list) is not this host');
});

test('hostSupportsCapability is the generic form behind it', () => {
  assert.equal(H.hostSupportsCapability({ base: '', self: true, capabilities: { tmux: true } }, 'tmux', {}), true);
  assert.equal(H.hostSupportsCapability({ base: '', self: true }, 'tmux', { tmux: true }), true);
  assert.equal(H.hostSupportsCapability({ hostId: 'x', base: 'http://x:1' }, 'tmux', { tmux: true }), false);
});

// --- host connection state (fan-out backoff) -------------------------------

const T0 = 1_000_000; // any fixed "now": the reducer takes it as an argument

test('hostConnReduce climbs the backoff ladder one rung per failure', () => {
  const fail = (prev, at) => H.hostConnReduce(prev, { type: 'failure', error: new Error('EHOSTUNREACH') }, at);
  let s = fail(null, T0);
  assert.equal(s.state, 'backoff');
  assert.equal(s.failures, 1);
  assert.equal(s.retryAt, T0 + 3000);
  assert.equal(s.error, 'EHOSTUNREACH');
  s = fail(s, T0);
  assert.deepEqual([s.failures, s.retryAt], [2, T0 + 4000]);
  s = fail(s, T0);
  assert.deepEqual([s.failures, s.retryAt], [3, T0 + 8000]);
  s = fail(s, T0);
  assert.deepEqual([s.failures, s.retryAt], [4, T0 + 16000]);
  // The last rung is the ceiling — a host down for an hour is still retried
  // every 16s, not once a day.
  s = fail(s, T0);
  assert.deepEqual([s.failures, s.retryAt], [5, T0 + 16000]);
});

test('hostConnReduce takes the failure error as text, from Error or string', () => {
  assert.equal(H.hostConnReduce(null, { type: 'failure', error: 'boom' }, T0).error, 'boom');
  assert.equal(H.hostConnReduce(null, { type: 'failure', error: new Error('nope') }, T0).error, 'nope');
  assert.equal(H.hostConnReduce(null, { type: 'failure' }, T0).error, null);
});

test('hostConnReduce success clears the error but keeps the rung until it settles', () => {
  const down = H.hostConnReduce(H.hostConnReduce(null, { type: 'failure', error: 'x' }, T0),
    { type: 'failure', error: 'x' }, T0);
  assert.equal(down.failures, 2);
  const up = H.hostConnReduce(down, 'success', T0 + 100);
  assert.equal(up.state, 'reachable');
  assert.equal(up.error, null);
  assert.equal(up.retryAt, 0);
  // Hysteresis: a host that answers one poll has not proven anything yet, so
  // the ladder position survives - a flapping host keeps climbing.
  assert.equal(up.failures, 2);
  assert.equal(up.reachableSince, T0 + 100);
});

test('hostConnReduce forgives the ladder only after 30s of unbroken reachability', () => {
  const down = H.hostConnReduce(null, { type: 'failure', error: 'x' }, T0);
  const up = H.hostConnReduce(down, 'success', T0);
  // One millisecond short of the window: still carrying the rung.
  const almost = H.hostConnReduce(up, 'success', T0 + 29_999);
  assert.equal(almost.failures, 1);
  assert.equal(almost.reachableSince, T0, 'the clock starts at the transition, not at every poll');
  // On the boundary it resets.
  const settled = H.hostConnReduce(up, 'success', T0 + 30_000);
  assert.equal(settled.failures, 0);
  assert.equal(settled.reachableSince, T0);
});

test('hostConnReduce restarts the hysteresis clock after a flap', () => {
  let s = H.hostConnReduce(null, 'success', T0);
  s = H.hostConnReduce(s, { type: 'failure', error: 'flap' }, T0 + 10_000);
  assert.equal(s.failures, 1);
  s = H.hostConnReduce(s, 'success', T0 + 20_000);
  // 20s after the first success, but only just back up: not forgiven.
  assert.equal(s.failures, 1);
  assert.equal(s.reachableSince, T0 + 20_000);
  s = H.hostConnReduce(s, { type: 'failure', error: 'flap' }, T0 + 25_000);
  assert.deepEqual([s.state, s.failures, s.retryAt], ['backoff', 2, T0 + 25_000 + 4000]);
});

test('hostConnReduce blocked is sticky: neither failure nor success demotes it', () => {
  const blocked = H.hostConnReduce(null, 'blocked', T0);
  assert.deepEqual(
    { state: blocked.state, failures: blocked.failures, retryAt: blocked.retryAt, error: blocked.error },
    { state: 'blocked', failures: 0, retryAt: 0, error: 'Unauthorized' });
  // A failure while blocked is a no-op, identity included (callers skip the
  // re-render on it).
  assert.equal(H.hostConnReduce(blocked, { type: 'failure', error: 'timeout' }, T0 + 5), blocked);
  assert.equal(H.hostConnReduce(blocked, 'blocked', T0 + 5), blocked);
  // Only a real success (the token was entered) can leave it.
  assert.equal(H.hostConnReduce(blocked, 'success', T0 + 5).state, 'reachable');
});

test('hostConnReduce blocked replaces a backoff state outright', () => {
  const down = H.hostConnReduce(null, { type: 'failure', error: 'x' }, T0);
  const blocked = H.hostConnReduce(down, 'blocked', T0 + 1);
  assert.deepEqual([blocked.state, blocked.failures, blocked.retryAt], ['blocked', 0, 0]);
});

test('hostConnReduce seed-down only applies to a host with no state at all', () => {
  const seeded = H.hostConnReduce(null, { type: 'seed-down', error: 'ssh: connect timed out' }, T0);
  assert.deepEqual(
    [seeded.state, seeded.failures, seeded.retryAt, seeded.error],
    ['backoff', 1, T0 + 3000, 'ssh: connect timed out']);
  // Everything this client observed itself outranks the server's probe.
  for (const prev of [
    H.hostConnReduce(null, 'success', T0),
    H.hostConnReduce(null, 'blocked', T0),
    H.hostConnReduce(null, { type: 'failure', error: 'mine' }, T0),
  ]) {
    assert.equal(H.hostConnReduce(prev, { type: 'seed-down', error: 'theirs' }, T0 + 1), prev);
  }
});

test('hostConnReduce ignores an unknown event instead of inventing a state', () => {
  const up = H.hostConnReduce(null, 'success', T0);
  assert.equal(H.hostConnReduce(up, 'nonsense', T0), up);
  assert.equal(H.hostConnReduce(null, 'nonsense', T0), null);
});

// --- usage merging ---------------------------------------------------------

function usageBucket(over = {}) {
  return {
    tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, reasoning: 0 },
    costs: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    costUnavailable: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    calls: 2, measured: 2, durationMs: 1000, slowestMs: 600,
    ...over,
  };
}

function usagePayload(over = {}) {
  return {
    range: '30', sort: 'cost', models: null,
    totals: { ...usageBucket(), unpricedCalls: 0 },
    groups: {
      models: [{ key: 'anthropic/opus', provider: 'anthropic', model: 'opus', ...usageBucket(), priced: true, unpricedCalls: 0 }],
      workspaces: [{ key: '/home/u/proj', ...usageBucket(), priced: true, unpricedCalls: 0 }],
      sessions: [{ id: 's1', name: 'one', workspace: '/home/u/proj', ...usageBucket(), priced: true, unpricedCalls: 0 }],
    },
    headlineCosts: { today: 0.3, days7: 0.3, days30: 0.3, all: 0.3, month: 0.3 },
    headlineCostUnavailable: { today: 0, days7: 0, days30: 0, all: 0, month: 0 },
    daily: [{ day: '2026-08-21', ...usageBucket(), models: [{ ref: 'anthropic/opus', provider: 'anthropic', model: 'opus', calls: 2, cost: 0.3, costUnavailable: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, reasoning: 0 } }] }],
    unpricedModelCalls: 0, indexing: false, discoveryTruncated: false, discoverySkipped: 0,
    monthlyBudgetUsd: 50,
    ...over,
  };
}

test('createFanoutRenderQueue coalesces fast hosts but publishes a slow partial', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const fast = ['ok', 'pending'];
  const fastRenders = [];
  const queueFast = H.createFanoutRenderQueue(fast, () => fastRenders.push([...fast]));
  queueFast();
  t.mock.timers.tick(50);
  fast[1] = 'ok';
  queueFast();
  assert.deepEqual(fastRenders, [['ok', 'ok']], 'the complete fleet is the first paint');
  t.mock.timers.tick(100);
  assert.equal(fastRenders.length, 1, 'the canceled partial timer cannot repaint');

  const slow = ['ok', 'pending'];
  const slowRenders = [];
  const queueSlow = H.createFanoutRenderQueue(slow, () => slowRenders.push([...slow]));
  queueSlow();
  t.mock.timers.tick(100);
  assert.deepEqual(slowRenders, [['ok', 'pending']], 'a genuinely slow peer does not block partial data');
  slow[1] = 'ok';
  queueSlow();
  assert.deepEqual(slowRenders, [['ok', 'pending'], ['ok', 'ok']], 'final settlement renders synchronously');
});

test('mergeUsageSummaries of one host is exactly what that host sent', () => {
  const payload = usagePayload();
  assert.equal(H.mergeUsageSummaries([payload]), payload);
  assert.equal(H.mergeUsageSummaries([{ hostId: 'a', summary: payload }]), payload);
  assert.equal(H.mergeUsageSummaries([]), null);
});

test('mergeUsageSummaries sums totals, days, and per-model day buckets', () => {
  const a = usagePayload();
  const b = usagePayload({
    daily: [
      { day: '2026-08-20', ...usageBucket({ calls: 1 }), models: [{ ref: 'zai/glm', provider: 'zai', model: 'glm', calls: 1, cost: 0.5, costUnavailable: { total: 0 }, tokens: { input: 4, output: 4, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }] },
      { day: '2026-08-21', ...usageBucket(), models: [{ ref: 'anthropic/opus', provider: 'anthropic', model: 'opus', calls: 2, cost: 0.3, costUnavailable: { total: 0 }, tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, reasoning: 0 } }] },
    ],
  });
  const merged = H.mergeUsageSummaries([
    { hostId: 'host-a', hostLabel: 'laptop', summary: a },
    { hostId: 'host-b', hostLabel: 'tycho', summary: b },
  ]);

  assert.equal(merged.totals.calls, 4);
  assert.equal(merged.totals.tokens.input, 20);
  assert.ok(Math.abs(merged.totals.costs.total - 0.6) < 1e-9);
  assert.equal(merged.headlineCosts.month.toFixed(2), '0.60', 'KPI headlines sum');
  assert.deepEqual(merged.daily.map(d => d.day), ['2026-08-20', '2026-08-21'], 'days merge chronologically');
  const shared = merged.daily.find(d => d.day === '2026-08-21');
  assert.equal(shared.calls, 4);
  assert.equal(shared.models.length, 1, 'the same model ref on two hosts is one series');
  assert.ok(Math.abs(shared.models[0].cost - 0.6) < 1e-9);
  assert.equal(merged.range, '30');
  assert.equal(merged.monthlyBudgetUsd, 50);
});

test('mergeUsageSummaries keeps per-host workspaces and sessions apart, merges models', () => {
  const merged = H.mergeUsageSummaries([
    { hostId: 'host-a', hostLabel: 'laptop', summary: usagePayload() },
    { hostId: 'host-b', hostLabel: 'tycho', summary: usagePayload() },
  ]);
  assert.equal(merged.groups.workspaces.length, 2, 'the same path on two machines is two workspaces');
  assert.deepEqual(merged.groups.workspaces.map(w => w.hostLabel), ['laptop', 'tycho']);
  assert.equal(merged.groups.sessions.length, 2, 'session ids are only unique within a host');
  assert.deepEqual(merged.groups.sessions.map(s => s.host), ['host-a', 'host-b']);
  assert.equal(merged.groups.models.length, 1, 'a model ref means the same thing everywhere');
  assert.equal(merged.groups.models[0].calls, 4);
});

test('mergeUsageSummaries propagates unavailable pricing as null, never as zero', () => {
  const unpriced = usagePayload({
    totals: { ...usageBucket({ costs: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null }, costUnavailable: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 3 } }), unpricedCalls: 3 },
    headlineCosts: { today: null, days7: null, days30: null, all: null, month: null },
    headlineCostUnavailable: { today: 3, days7: 3, days30: 3, all: 3, month: 3 },
    unpricedModelCalls: 3,
  });
  const merged = H.mergeUsageSummaries([
    { hostId: 'host-a', summary: usagePayload() },
    { hostId: 'host-b', summary: unpriced },
  ]);
  assert.equal(merged.totals.costs.total, null);
  assert.equal(merged.totals.priced, false);
  assert.equal(merged.totals.unpricedCalls, 3);
  assert.equal(merged.headlineCosts.month, null);
  assert.equal(merged.headlineCostUnavailable.month, 3);
  assert.equal(merged.unpricedModelCalls, 3);
});

test('mergeUsageSummaries ranks merged groups by the requested metric', () => {
  const small = usagePayload({
    groups: {
      models: [{ key: 'zai/glm', ...usageBucket({ costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 }, tokens: { input: 900, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }) }],
      workspaces: [], sessions: [],
    },
  });
  const byCost = H.mergeUsageSummaries([
    { hostId: 'a', summary: usagePayload() }, { hostId: 'b', summary: small },
  ]);
  assert.deepEqual(byCost.groups.models.map(m => m.key), ['anthropic/opus', 'zai/glm']);

  const byTokens = H.mergeUsageSummaries([
    { hostId: 'a', summary: usagePayload({ sort: 'tokens' }) },
    { hostId: 'b', summary: { ...small, sort: 'tokens' } },
  ]);
  assert.deepEqual(byTokens.groups.models.map(m => m.key), ['zai/glm', 'anthropic/opus']);
});

test('mergeUsageSummaries reports indexing and discovery flags from any host', () => {
  const merged = H.mergeUsageSummaries([
    { hostId: 'a', summary: usagePayload() },
    { hostId: 'b', summary: usagePayload({ indexing: true, discoveryTruncated: true, discoverySkipped: 4 }) },
  ]);
  assert.equal(merged.indexing, true);
  assert.equal(merged.discoveryTruncated, true);
  assert.equal(merged.discoverySkipped, 4);
});

// --- host colors + section ordering (sidebar facelift) ---------------------

test('assignHostColor rotates the chart slots by first-seen order', () => {
  let order = [];
  const colors = [];
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    const res = H.assignHostColor(order, key, {});
    order = res.order;
    colors.push(res.color);
  }
  assert.deepEqual(colors, [
    'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
    'var(--chart-5)', 'var(--chart-1)', 'var(--chart-2)',
  ]);
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('assignHostColor keeps a host on its slot once assigned', () => {
  const order = ['a', 'b', 'c'];
  // Re-asking never reshuffles, and never grows the persisted order.
  const again = H.assignHostColor(order, 'b', {});
  assert.equal(again.color, 'var(--chart-2)');
  assert.equal(again.appended, false, 'a known host is not re-appended');
  assert.deepEqual(again.order, order);
  assert.equal(H.assignHostColor(order, 'c', {}).color, 'var(--chart-3)');
});

test('assignHostColor lets a user override win, and reports it as custom', () => {
  const order = ['a', 'b'];
  const res = H.assignHostColor(order, 'b', { b: '#D33682' });
  assert.equal(res.color, '#d33682');
  assert.equal(res.custom, true);
  // The slot is still held, so dropping the override returns the same auto color.
  assert.equal(H.assignHostColor(order, 'b', {}).color, 'var(--chart-2)');
});

test('sanitizeHostColors keeps only #rrggbb values', () => {
  assert.deepEqual(H.sanitizeHostColors({
    a: '#268bd2', b: 'red', c: '#abc', d: 'javascript:alert(1)', e: 5, f: '#AABBCC',
  }), { a: '#268bd2', f: '#aabbcc' });
  assert.deepEqual(H.sanitizeHostColors(null), {});
  assert.deepEqual(H.sanitizeHostColors(['#268bd2']), {});
});

test('sanitizeHostColorOrder dedupes and drops non-strings', () => {
  assert.deepEqual(H.sanitizeHostColorOrder(['a', 'b', 'a', '', 3, null, 'c']), ['a', 'b', 'c']);
  assert.deepEqual(H.sanitizeHostColorOrder('a'), []);
});

test('a corrupt color store degrades to auto rather than throwing', () => {
  const res = H.assignHostColor('nonsense', 'a', 'nonsense');
  assert.equal(res.color, 'var(--chart-1)');
  assert.deepEqual(res.order, ['a']);
});

test('sortHostSections puts self first, then labels alphabetically', () => {
  const hosts = [
    { hostId: 'z', label: 'tycho' },
    { hostId: 's', label: 'framework', self: true },
    { hostId: 'a', name: 'Eros' },
    { hostId: 'b', base: 'http://10.0.0.4:3333' },
  ];
  assert.deepEqual(H.sortHostSections(hosts).map(h => h.hostId), ['s', 'b', 'a', 'z']);
  // Stable and non-mutating: the input order is untouched.
  assert.equal(hosts[0].hostId, 'z');
});

test('sortHostSections breaks label ties on id so the order never jitters', () => {
  const hosts = [{ hostId: 'b', label: 'pi' }, { hostId: 'a', label: 'pi' }];
  assert.deepEqual(H.sortHostSections(hosts).map(h => h.hostId), ['a', 'b']);
  assert.deepEqual(H.sortHostSections([]), []);
});

test('hostSectionKey namespaces the shared collapse store', () => {
  assert.equal(H.hostSectionKey('abc'), 'host:abc');
  assert.equal(H.hostSectionKey(null), 'host:self');
});

test('rgbStringToHex resolves computed colors for the color input', () => {
  assert.equal(H.rgbStringToHex('rgb(38, 139, 210)'), '#268bd2');
  assert.equal(H.rgbStringToHex('rgba(0, 0, 0, 0.5)'), '#000000');
  assert.equal(H.rgbStringToHex('#268BD2'), '#268bd2');
  assert.equal(H.rgbStringToHex('color(display-p3 1 0 0)'), null);
  assert.equal(H.rgbStringToHex(null), null);
});
