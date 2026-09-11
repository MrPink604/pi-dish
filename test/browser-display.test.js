const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeThemes, decodeSavedFilters, responseMode, clampSidebarWidth, clampTerminalHeight } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));
test('display payloads narrow theme tokens, filters and supported metadata modes', () => {
  assert.deepEqual(plain(decodeThemes({ themes: [null, { id: 9 }, { id: 'custom', tokens: { '--accent': '#123456', color: 'red', '--wrong': 3 } }] })), [{ id: 'custom', builtin: false, tokens: { '--accent': '#123456' } }]);
  assert.deepEqual(plain(decodeSavedFilters([{ name: 'One', query: 'active:true' }, { name: 'Two', query: 2 }])), [{ name: 'One', query: 'active:true' }]);
  assert.equal(responseMode('unknown'), 'compact'); assert.equal(responseMode('performance-cost'), 'performance-cost');
});
test('pre-paint output tolerates unavailable storage and uses only custom-property strings', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/theme-prepaint.js'), 'utf8');
  const document = { documentElement: { dataset: {}, style: { setProperty(key, value) { this[key] = value; } } } };
  assert.doesNotThrow(() => vm.runInNewContext(source, { document, get localStorage() { throw new Error('Storage disabled'); } }));
  vm.runInNewContext(source, { document, localStorage: { getItem: key => key.endsWith('-tokens') ? '{"--accent":"#123456","color":"red","--bad":null}' : 'custom' } });
  assert.equal(document.documentElement.dataset.theme, 'custom'); assert.equal(document.documentElement.style['--accent'], '#123456');
  assert.equal(document.documentElement.style.color, undefined); assert.equal(document.documentElement.style['--bad'], undefined);
  assert.equal(clampSidebarWidth(1000, 1200), 600); assert.equal(clampSidebarWidth(20, 300), 220);
  assert.equal(clampTerminalHeight(1000, 500), 400); assert.equal(clampTerminalHeight(20, 500), 140);
});
