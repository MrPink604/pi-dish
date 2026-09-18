import { assertBrowserApiContext } from './browser-vm.js';
import { present } from './test-types.js';
import type { NewSessionConfigScope } from '../src/browser/new-session-options.js';
import type { HostTarget } from '../src/browser/api-client.js';
import { DOMParser } from '@xmldom/xmldom';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const context = { URL, encodeURIComponent };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
assertBrowserApiContext(context);
const { createNewSessionConfigPreview, decodeHarnessConfigPreview } = context.PiDishBrowser;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve: value => present(resolve)(value) };
}
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const fixtureDocument = new DOMParser().parseFromString('<html><body/></html>', 'text/html');
function element(): HTMLElement {
  const value = fixtureDocument.createElement('div');
  Object.defineProperty(value, 'style', { value: { display: '' } });
  return value;
}
function fixture() {
  const initial = { host: { hostId: 'a', base: '/a', token: 'fixture-a' }, harnessId: 'omp', cwd: '/old', view: 1 };
  let scope: NewSessionConfigScope | null = initial;
  const wrap = element(), values = element(), roles = element(), buttons = [element(), element()];
  const reads: Array<Deferred<Response> & { host: HostTarget; url: string }> = [];
  const controller = createNewSessionConfigPreview({ wrap, values, roles, buttons, scope: () => scope,
    request: (host, url) => { const wait = deferred<Response>(); reads.push({ ...wait, host, url }); return wait.promise; },
    roleSummary: roles => Object.values(roles).join(', ') });
  return { controller, reads, wrap, values, roles, buttons, initial, scope: () => scope, setScope: (next: NewSessionConfigScope | null) => { scope = next; } };
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
  present(f.reads[0]).resolve(response({ defaultModel: 'ready' })); await load;
  assert.equal(present(f.controller.config).defaultModel, 'ready');
  assert.equal(present(f.buttons[0]).style.display, '');
  const body = deferred<unknown>();
  load = f.controller.load();
  const delayed = new Response('{}', { status: 200 });
  Object.defineProperty(delayed, 'json', { value: () => body.promise });
  present(f.reads[1]).resolve(delayed);
  await Promise.resolve();
  f.setScope({ ...present(f.scope()), cwd: '/new' });
  f.controller.retire();
  assert.equal(f.controller.config, null);
  assert.equal(present(f.buttons[0]).style.display, 'none');
  body.resolve({ defaultModel: 'old' }); await load;
  assert.equal(f.controller.config, null);
  assert.equal(f.values.textContent, 'Loading…');
});

test('preview request captures endpoint credentials and ignores token rotation, close and old failures', async () => {
  const f = fixture(), first = f.controller.load();
  f.initial.host.token = 'rotated';
  const capturedHost = present(f.reads[0]).host;
  assert.equal(capturedHost && typeof capturedHost === 'object' ? capturedHost.token : undefined, 'fixture-a');
  present(f.reads[0]).resolve(response({ defaultModel: 'obsolete' })); await first;
  assert.equal(f.controller.config, null);
  const second = f.controller.load();
  f.setScope(null);
  present(f.reads[1]).resolve(new Response(JSON.stringify({ error: 'closed' }), { status: 500 })); await second;
  assert.equal(f.values.textContent, 'Loading…');
  assert.equal(f.controller.config, null);
});

test('successful preview exposes copied scope and current errors without showing unsupported harness actions', async () => {
  const f = fixture(), load = f.controller.load('/old');
  assert.equal(present(f.reads[0]).url, '/api/harnesses/omp/config?cwd=%2Fold');
  present(f.reads[0]).resolve(response({ defaultModel: 'p/model', modelRoles: { smol: 'p/smol' } })); await load;
  assert.equal(f.values.textContent, 'Model: p/model · Thinking: host default');
  assert.equal(f.roles.textContent, 'Roles: p/smol');
  const fail = f.controller.load();
  present(f.reads[1]).resolve(new Response(JSON.stringify({ error: 4 }), { status: 503 })); await fail;
  assert.equal(f.values.textContent, 'Defaults unavailable: HTTP 503');
  assert.equal(f.controller.config, null);
  f.setScope({ ...present(f.scope()), harnessId: 'pi' });
  await f.controller.load();
  assert.equal(f.reads.length, 2);
  assert.equal(f.wrap.style.display, 'none');
});

export {};
