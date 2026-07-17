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
