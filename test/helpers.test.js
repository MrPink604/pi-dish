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

test('formatTokens abbreviates thousands', () => {
  assert.equal(H.formatTokens(0), '0');
  assert.equal(H.formatTokens(null), '0');
  assert.equal(H.formatTokens(999), '999');
  assert.equal(H.formatTokens(1500), '1.5k');
  assert.equal(H.formatTokens(29889), '29.9k');
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

test('normalizeMood needs both parts and flattens whitespace', () => {
  assert.deepEqual(H.normalizeMood('Happy days', '(^_^)'), { description: 'happy', face: '(^_^)' });
  assert.deepEqual(H.normalizeMood('calm', ' ( \n- _ - ) '), { description: 'calm', face: '( - _ - )' });
  assert.equal(H.normalizeMood('', 'face'), null);
  assert.equal(H.normalizeMood('word', ''), null);
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
});

test('isModelEnabled treats no patterns as everything enabled', () => {
  const m = { provider: 'anthropic', id: 'claude-sonnet-4-5' };
  assert.equal(H.isModelEnabled(null, m), true);
  assert.equal(H.isModelEnabled([], m), true);
  assert.equal(H.isModelEnabled(['anthropic/claude-sonnet-4-5'], m), true);
  assert.equal(H.isModelEnabled(['zai/glm-5.2'], m), false);
  assert.equal(H.isModelEnabled(['zai/glm-5.2', '*sonnet*'], m), true);
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
