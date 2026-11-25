import { loadBrowser } from './browser-vm.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const {
  decodeThemes, decodeSavedFilters, responseMode, clampSidebarWidth, clampTerminalHeight,
  decodeEdgeHandleSettings, readEdgeHandleSettings, writeEdgeHandleSettings, computeEdgeHandleZone,
  DEFAULT_EDGE_HANDLE_SETTINGS, EDGE_HANDLE_STORAGE_KEY,
} = loadBrowser();
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
test('display payloads narrow theme tokens, filters and supported metadata modes', () => {
  assert.deepEqual(plain(decodeThemes({ themes: [null, { id: 9 }, { id: 'custom', tokens: { '--accent': '#123456', color: 'red', '--wrong': 3 } }] })), [{ id: 'custom', builtin: false, tokens: { '--accent': '#123456' } }]);
  assert.deepEqual(plain(decodeSavedFilters([{ name: 'One', query: 'active:true' }, { name: 'Two', query: 2 }])), [{ name: 'One', query: 'active:true' }]);
  assert.equal(responseMode('unknown'), 'compact'); assert.equal(responseMode('performance-cost'), 'performance-cost');
});
test('pre-paint output tolerates unavailable storage and uses only custom-property strings', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/theme-prepaint.js'), 'utf8');
  const properties: Record<string, string | undefined> = {};
  const dataset: Record<string, string | undefined> = {};
  const document = { documentElement: { dataset, style: { setProperty(key: string, value: string) { properties[key] = value; } } } };
  assert.doesNotThrow(() => vm.runInNewContext(source, { document, get localStorage() { throw new Error('Storage disabled'); } }));
  vm.runInNewContext(source, { document, localStorage: { getItem: (key: string) => key.endsWith('-tokens') ? '{"--accent":"#123456","color":"red","--bad":null}' : 'custom' } });
  assert.equal(document.documentElement.dataset.theme, 'custom'); assert.equal(properties['--accent'], '#123456');
  assert.equal(properties.color, undefined); assert.equal(properties['--bad'], undefined);
  assert.equal(clampSidebarWidth(1000, 1200), 600); assert.equal(clampSidebarWidth(20, 300), 220);
  assert.equal(clampTerminalHeight(1000, 500), 400); assert.equal(clampTerminalHeight(20, 500), 140);
});

test('edge handle settings validate, clamp, fall back on corrupt storage, and compute zones', () => {
  assert.deepEqual(plain(DEFAULT_EDGE_HANDLE_SETTINGS), {
    position: 50,
    length: 100,
    touchWidth: 24,
    visible: false,
    opacity: 0.5,
  });
  for (const invalid of [null, undefined, 'bad', 42, true, []]) {
    assert.deepEqual(plain(decodeEdgeHandleSettings(invalid)), plain(DEFAULT_EDGE_HANDLE_SETTINGS));
  }
  assert.deepEqual(plain(decodeEdgeHandleSettings({
    position: -25,
    length: 200,
    touchWidth: 999,
    visible: true,
    opacity: 0.01,
  })), {
    position: 0,
    length: 100,
    touchWidth: 64,
    visible: true,
    opacity: 0.1,
  });
  assert.deepEqual(plain(decodeEdgeHandleSettings({
    position: 140,
    length: 3,
    touchWidth: 4,
    visible: 'true',
    opacity: 3.5,
  })), {
    position: 100,
    length: 10,
    touchWidth: 12,
    visible: false,
    opacity: 1,
  });
  assert.deepEqual(plain(decodeEdgeHandleSettings({
    position: Number.NaN,
    length: Number.POSITIVE_INFINITY,
    touchWidth: '30',
    visible: 1,
    opacity: null,
  })), plain(DEFAULT_EDGE_HANDLE_SETTINGS));

  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
  map.set(EDGE_HANDLE_STORAGE_KEY, '{corrupt json');
  assert.deepEqual(plain(readEdgeHandleSettings(storage)), plain(DEFAULT_EDGE_HANDLE_SETTINGS));
  assert.deepEqual(plain(readEdgeHandleSettings({
    getItem() { throw new Error('blocked'); },
  })), plain(DEFAULT_EDGE_HANDLE_SETTINGS));

  const saved = writeEdgeHandleSettings(storage, {
    position: 25.4,
    length: 30,
    touchWidth: 40,
    visible: true,
    opacity: 0.30000000000000004,
  });
  assert.deepEqual(plain(saved), { position: 25, length: 30, touchWidth: 40, visible: true, opacity: 0.3 });
  assert.deepEqual(plain(readEdgeHandleSettings(storage)), plain(saved));

  assert.deepEqual(plain(computeEdgeHandleZone(DEFAULT_EDGE_HANDLE_SETTINGS, { left: 0, top: 0, height: 800 })), {
    left: 0, right: 24, top: 0, bottom: 800,
  });
  assert.deepEqual(plain(computeEdgeHandleZone({ position: 0, length: 25, touchWidth: 40, visible: true, opacity: 0.5 }, { left: 10, top: 20, height: 800 })), {
    left: 10, right: 50, top: 20, bottom: 220,
  });
  assert.deepEqual(plain(computeEdgeHandleZone({ position: 100, length: 25, touchWidth: 40, visible: true, opacity: 0.5 }, { left: 0, top: 0, height: 800 })), {
    left: 0, right: 40, top: 600, bottom: 800,
  });
});

export {};
