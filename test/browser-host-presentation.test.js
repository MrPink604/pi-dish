const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { createHostDirectory, createHostPresentation, assignHostColor, sanitizeHostColors } = context.PiDishBrowser;
const H = require('../public/helpers');
function fixture(extra = {}) {
  const directory = createHostDirectory({ initialCatalog: [{ base: '/hosts/peer', hostId: 'peer' }],
    descriptor: () => undefined, persistCatalog() {} });
  const writes = [], rows = [];
  const presentation = createHostPresentation({ directory, initialColors: {}, initialOrder: [],
    persistColors: colors => writes.push({ colors: { ...colors } }),
    persistOrder: order => writes.push({ order: [...order] }),
    onColorChanged: value => rows.push(value), escapeHtml: H.escapeHtml,
    displayLabel: H.hostDisplayLabel, isDown: () => false, ...extra });
  return { directory, presentation, writes, rows };
}

test('host presentation owns stable first-seen colors and sanitized overrides', () => {
  const { presentation: p, writes, rows } = fixture();
  assert.equal(p.colorFor(null), 'var(--chart-1)');
  assert.equal(p.colorFor('peer'), 'var(--chart-2)');
  assert.equal(p.colorFor('peer'), 'var(--chart-2)');
  assert.deepEqual(writes, [{ order: ['self'] }, { order: ['self', 'peer'] }]);
  p.setColor('peer', '#ABCDEF', { rows: false });
  assert.equal(p.isCustom('peer'), true);
  assert.equal(p.colorFor('peer'), '#abcdef');
  assert.deepEqual(rows, [false]);
  p.setColor('peer', 'invalid');
  assert.equal(p.isCustom('peer'), false);
  assert.equal(p.colorFor('peer'), 'var(--chart-2)');
  p.setColor('peer', '#123456');
  p.setColor('peer', null);
  assert.equal(p.colorFor('peer'), 'var(--chart-2)');
  assert.deepEqual(writes.at(-1), { colors: {} });
});

test('color state retains runtime updates when preference persistence fails', () => {
  const { presentation: p, rows } = fixture({
    persistColors() { throw new Error('unavailable'); }, persistOrder() { throw new Error('unavailable'); },
  });
  assert.equal(p.colorFor('first'), 'var(--chart-1)');
  assert.equal(p.colorFor('second'), 'var(--chart-2)');
  p.setColor('second', '#123456');
  assert.equal(p.colorFor('second'), '#123456');
  assert.deepEqual(rows, [true]);
});

test('self color fallback follows the learned host id without moving other slots', () => {
  const { presentation: p, directory } = fixture();
  p.colorFor(null);
  assert.equal(p.colorFor('peer'), 'var(--chart-2)');
  directory.setSelf({ hostId: 'local', label: 'Local', version: null, capabilities: null });
  assert.equal(p.colorFor(null), 'var(--chart-3)');
  assert.equal(p.colorFor('local'), p.colorFor(null));
  assert.equal(p.colorFor('peer'), 'var(--chart-2)');
});

test('color lookup never mistakes inherited property names for an override', () => {
  for (const key of ['constructor', 'toString', '__proto__']) {
    assert.equal(assignHostColor([], key, {}).color, 'var(--chart-1)');
    assert.equal(assignHostColor([], key, {}).custom, false);
    const raw = JSON.parse(`{"${key}":"#ABCDEF"}`);
    assert.equal(sanitizeHostColors(raw)[key], '#abcdef');
    const { presentation: p } = fixture();
    p.setColor(key, '#ABCDEF');
    assert.equal(p.isCustom(key), true);
    assert.equal(p.colorFor(key), '#abcdef');
    p.setColor(key, null);
    assert.equal(p.isCustom(key), false);
    assert.equal(p.colorFor(key), 'var(--chart-1)');
  }
});

test('host chips retain escaped labels, offline notes and single-host visibility', () => {
  const { presentation: p, directory } = fixture({ isDown: () => true });
  directory.replaceCatalog([{ base: '/hosts/peer', hostId: 'peer', label: '<Peer>' }]);
  const html = p.chipHtml('peer', { note: true });
  assert.match(html, /host-chip offline/);
  assert.match(html, /&lt;Peer&gt;/);
  assert.match(html, / · unreachable/);
  assert.match(p.dotHtml('peer'), /host-chip-dot/);
  assert.equal(p.chipHtml('absent'), '');
  directory.replaceCatalog([]);
  assert.equal(p.chipHtml(null), '');
});
