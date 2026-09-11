const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL, encodeURIComponent };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { createNewSessionConfigPreview, decodeHarnessConfigPreview } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const response = data => ({ ok: true, json: async () => data });
const element = () => ({ style: {}, textContent: '' });
function fixture() {
  let scope = { host: { hostId: 'a', base: '/a', token: 'fixture-a' }, harnessId: 'omp', cwd: '/old', view: 1 };
  const wrap = element(), values = element(), roles = element(), buttons = [element(), element()], reads = [];
  const controller = createNewSessionConfigPreview({ wrap, values, roles, buttons, scope: () => scope,
    request: (host, url) => { const wait = deferred(); reads.push({ ...wait, host, url }); return wait.promise; },
    roleSummary: roles => Object.values(roles).join(', ') });
  return { controller, reads, wrap, values, roles, buttons, scope: () => scope, setScope: next => { scope = next; } };
}

test('harness defaults narrow wire fields and copy valid custom role names', () => {
  const wire = { defaultModel: 7, defaultThinkingLevel: 'high', modelRoles: { smol: 'p/small', wrong: [], constructor: 'p/custom' } };
  const value = decodeHarnessConfigPreview(wire, '/cwd');
  wire.modelRoles.smol = 'changed';
  assert.deepEqual(plain(value), { cwd: '/cwd', defaultModel: '', defaultThinkingLevel: 'high', modelRoles: { smol: 'p/small', constructor: 'p/custom' } });
  assert.throws(() => decodeHarnessConfigPreview(null, ''), /Invalid harness defaults/);
});

test('config preview binds delayed bodies to the original cwd and retires editor actions immediately', async () => {
  const f = fixture();
  let load = f.controller.load();
  f.reads[0].resolve(response({ defaultModel: 'ready' })); await load;
  assert.equal(f.controller.config.defaultModel, 'ready');
  assert.equal(f.buttons[0].style.display, '');
  const body = deferred();
  load = f.controller.load();
  f.reads[1].resolve({ ok: true, json: () => body.promise });
  await Promise.resolve();
  f.setScope({ ...f.scope(), cwd: '/new' });
  f.controller.retire();
  assert.equal(f.controller.config, null);
  assert.equal(f.buttons[0].style.display, 'none');
  body.resolve({ defaultModel: 'old' }); await load;
  assert.equal(f.controller.config, null);
  assert.equal(f.values.textContent, 'Loading…');
});

test('preview request captures endpoint credentials and ignores token rotation, close and old failures', async () => {
  const f = fixture(), first = f.controller.load();
  f.scope().host.token = 'rotated';
  assert.equal(f.reads[0].host.token, 'fixture-a');
  f.reads[0].resolve(response({ defaultModel: 'obsolete' })); await first;
  assert.equal(f.controller.config, null);
  const second = f.controller.load();
  f.setScope(null);
  f.reads[1].resolve({ ok: false, status: 500, json: async () => ({ error: 'closed' }) }); await second;
  assert.equal(f.values.textContent, 'Loading…');
  assert.equal(f.controller.config, null);
});

test('successful preview exposes copied scope and current errors without showing unsupported harness actions', async () => {
  const f = fixture(), load = f.controller.load('/old');
  assert.equal(f.reads[0].url, '/api/harnesses/omp/config?cwd=%2Fold');
  f.reads[0].resolve(response({ defaultModel: 'p/model', modelRoles: { smol: 'p/smol' } })); await load;
  assert.equal(f.values.textContent, 'Model: p/model · Thinking: host default');
  assert.equal(f.roles.textContent, 'Roles: p/smol');
  const fail = f.controller.load();
  f.reads[1].resolve({ ok: false, status: 503, json: async () => ({ error: 4 }) }); await fail;
  assert.equal(f.values.textContent, 'Defaults unavailable: HTTP 503');
  assert.equal(f.controller.config, null);
  f.setScope({ ...f.scope(), harnessId: 'pi' });
  await f.controller.load();
  assert.equal(f.reads.length, 2);
  assert.equal(f.wrap.style.display, 'none');
});
