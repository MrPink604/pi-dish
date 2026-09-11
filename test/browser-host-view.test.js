const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../public/browser.js'), 'utf8'), context);
test('host presentation narrows labels and capabilities without mutating discovery metadata', () => {
  const project = context.PiDishBrowser.createHostView();
  const host = { hostId: 'peer', key: 'peer', source: 'fleet', base: 'http://peer', label: 12, capabilities: { terminal: true, recovery: false, malformed: 'yes' } };
  const view = project(host);
  assert.equal(view.label, '12'); assert.deepEqual(JSON.parse(JSON.stringify(view.capabilities)), { terminal: true, recovery: false });
  assert.equal(project(host), view); assert.equal(host.label, 12); assert.equal(host.capabilities.malformed, 'yes');
  const changed = project({ ...host, label: 'new' }); assert.notEqual(changed, view); assert.equal(changed.label, 'new');
  assert.deepEqual(JSON.parse(JSON.stringify(project({ ...host, capabilities: {} }).capabilities)), {});
});
test('static shell markup uses registered typed actions and contains no executable event attributes', () => {
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  assert.doesNotMatch(html, /\son(?:click|change|keydown|toggle)\s*=/i);
  const registered = new Set(context.PiDishBrowser.APP_ACTION_NAMES);
  const used = [...html.matchAll(/data-app-(?:click|change|keydown|toggle)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(used.length > 50, 'the shell action inventory is populated');
  for (const name of used) assert.ok(registered.has(name), `Unregistered shell action ${name}`);
  for (const name of registered) assert.ok(used.includes(name), `Unused shell action ${name}`);
});
