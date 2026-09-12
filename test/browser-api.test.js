const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { Headers, Response, AbortSignal, URLSearchParams };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { createHostTransport, createSessionApi, sendJson, withFetchTimeout } = context.PiDishBrowser;

test('browser transport snapshots host routing and preserves supported header/signal forms', async () => {
  const endpoint = { base: 'https://peer.invalid', token: 'fixture-token' };
  const seen = [];
  const transport = createHostTransport({ resolveHost: () => endpoint, fetch: async (url, options) => {
    seen.push({ url, options }); return new Response('{}');
  } });
  const controller = new AbortController();
  const pending = transport.request('peer', '/api/config', {
    headers: new Headers({ 'Content-Type': 'application/json', Authorization: 'wrong' }), signal: controller.signal, timeoutMs: 200,
  });
  endpoint.base = 'https://other.invalid'; endpoint.token = 'other';
  await pending;
  assert.equal(seen[0].url, 'https://peer.invalid/api/config');
  assert.equal(seen[0].options.headers.get('authorization'), 'Bearer fixture-token');
  assert.equal(seen[0].options.headers.get('content-type'), 'application/json');
  assert.equal(seen[0].options.signal, controller.signal);
  assert.ok(!('timeoutMs' in seen[0].options));
  assert.ok(withFetchTimeout({ timeoutMs: 100 }).signal);
  assert.equal(withFetchTimeout({}).signal, undefined);
});

test('typed session requests preserve the originating owner and server-local preference scope', async () => {
  const calls = [];
  const api = createSessionApi(async (host, url, options) => {
    calls.push({ host, url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ success: true, enabledModels: null }));
  });
  const owner = { id: 'session/one', host: 'peer', generation: 3 };
  const pending = api.setModel(owner, 'provider/model');
  owner.host = 'other'; owner.id = 'different';
  await pending;
  assert.equal(calls[0].host, 'peer');
  assert.equal(calls[0].url, '/api/sessions/session%2Fone/model');
  assert.equal(calls[0].body.modelId, 'provider/model');
  const ids = ['p/m'];
  const save = api.setEnabledModels(ids);
  ids.push('p/other');
  await save;
  assert.equal(calls[1].host, null);
  assert.deepEqual(calls[1].body.enabledIds, ['p/m']);
});

test('typed reads reject malformed successes and retain HTTP error status', async () => {
  const api = createSessionApi(async () => new Response('{"error":"denied"}', { status: 401 }));
  await assert.rejects(api.list(null, '/api/sessions'), error => error.status === 401 && error.message === 'denied');
  const malformed = createSessionApi(async () => new Response('{"active":[],"previous":[{"id":42}]}'));
  await assert.rejects(malformed.list(null, '/api/sessions'), /Invalid session/);
  await assert.rejects(malformed.models(null), /Invalid model catalog/);
  await assert.rejects(malformed.setModel({ id: 's', host: null, generation: 1 }, 'p/m'), /Invalid mutation/);
  // Generic operations outside this typed slice retain their empty-success behavior.
  const generic = await sendJson(async () => new Response('', { status: 200 }), null, '/api/legacy', null);
  assert.equal(Object.keys(generic).length, 0);
});

test('session list ingress separates opaque extras and omits malformed presentation values', async () => {
  const api = createSessionApi(async () => new Response(JSON.stringify({
    active: [{ id: 'one', host: 'forged', hostLabel: 'forged label', name: null, model: '',
      lastActivity: 0, contextTokens: 0, contextPercent: '45', turnInProgress: 1, compacting: false,
      parentId: null, familyParentId: '', capabilities: { resume: false, future: true },
      custom: { model: 42 }, fields: { model: 'forged' }, extras: { isActive: true } }], previous: [],
  })));
  const list = await api.list('peer', '/api/sessions');
  const row = list.active[0];
  assert.equal(row.id, 'one');
  assert.equal(row.fields.name, null);
  assert.equal(row.fields.model, '');
  assert.equal(row.fields.lastActivity, 0);
  assert.equal(row.fields.contextTokens, 0);
  assert.equal(row.fields.contextPercent, undefined);
  assert.equal(row.fields.turnInProgress, undefined);
  assert.equal(row.fields.compacting, false);
  assert.equal(row.fields.parentId, null);
  assert.equal(row.fields.familyParentId, '');
  assert.equal(row.fields.capabilities.future, true);
  assert.equal(row.extras.custom.model, 42);
  assert.equal(row.extras.fields.model, 'forged');
  assert.equal(row.extras.host, undefined);
  assert.equal(row.extras.hostLabel, undefined);
  assert.equal(row.extras.contextPercent, undefined);
});
