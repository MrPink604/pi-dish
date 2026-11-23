import { loadBrowser } from './browser-vm.js';
import { present, record } from './test-types.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import http = require('node:http');
const { createHostTransport, createSessionApi, setSessionModel, setSessionThinking, renameSession, sendJson, withFetchTimeout,
  classifyOriginResponse, classifyOriginError, createOriginRequest, probeOriginFailure, ApiHttpError,
} = loadBrowser({ Headers, Response, AbortSignal, URLSearchParams, TypeError, DOMException });

test('browser transport snapshots host routing and preserves supported header/signal forms', async () => {
  const endpoint = { base: 'https://peer.invalid', token: 'fixture-token' };
  const seen: Array<{ url: string; options: RequestInit }> = [];
  const transport = createHostTransport({ resolveHost: () => endpoint, fetch: async (url, options = {}) => {
    seen.push({ url: String(url), options }); return new Response('{}');
  } });
  const controller = new AbortController();
  const pending = transport.request('peer', '/api/config', {
    headers: new Headers({ 'Content-Type': 'application/json', Authorization: 'wrong' }), signal: controller.signal, timeoutMs: 200,
  });
  endpoint.base = 'https://other.invalid'; endpoint.token = 'other';
  await pending;
  const request = present(seen[0]), headers = new Headers(request.options.headers);
  assert.equal(request.url, 'https://peer.invalid/api/config');
  assert.equal(headers.get('authorization'), 'Bearer fixture-token');
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(request.options.signal, controller.signal);
  assert.ok(!('timeoutMs' in request.options));
  assert.ok(withFetchTimeout({ timeoutMs: 100 }).signal);
  assert.equal(withFetchTimeout({}).signal, undefined);
});

test('endpoint-explicit mutations reach the captured route and decode server results', async t => {
  const state = { model: '', thinking: '', name: '' };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = record(JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer fixture-token' || req.method !== 'POST') {
      res.writeHead(401); res.end('{"error":"denied"}'); return;
    }
    if (req.url === '/peer/api/sessions/session%2Fone/model' && typeof body.modelId === 'string') state.model = body.modelId;
    else if (req.url === '/peer/api/sessions/session%2Fone/thinking' && typeof body.level === 'string') state.thinking = body.level === 'max' ? 'high' : body.level;
    else if (req.url === '/peer/api/sessions/session%2Fone/rename' && typeof body.name === 'string') state.name = body.name;
    else { res.writeHead(404); res.end('{"error":"wrong endpoint"}'); return; }
    res.end(JSON.stringify({ success: true, level: state.thinking }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server lacks TCP address');
  const endpoint = { base: `http://127.0.0.1:${address.port}/peer`, token: 'fixture-token' };
  const original = { ...endpoint };
  const transport = createHostTransport({ resolveHost: target => {
    if (typeof target !== 'object' || target === null) throw new Error('Expected explicit fixture endpoint');
    return target;
  }, fetch });
  const pending = setSessionModel(transport.request, endpoint, 'session/one', 'provider/model');
  endpoint.base = 'http://127.0.0.1:1'; endpoint.token = 'replaced';
  assert.equal((await pending).success, true);
  assert.equal((await setSessionThinking(transport.request, original, 'session/one', 'max')).level, 'high');
  assert.equal((await renameSession(transport.request, original, 'session/one', 'Peer name')).success, true);
  assert.deepEqual(state, { model: 'provider/model', thinking: 'high', name: 'Peer name' });
  await assert.rejects(renameSession(transport.request, { ...original, token: 'bad' }, 'session/one', 'Denied'),
    error => record(error).status === 401 && record(error).message === 'denied');
  assert.equal(state.name, 'Peer name');
});

test('typed reads reject malformed successes and retain HTTP error status', async () => {
  const api = createSessionApi(async () => new Response('{"error":"denied"}', { status: 401 }));
  await assert.rejects(api.list(null, '/api/sessions'), error => record(error).status === 401 && record(error).message === 'denied');
  const malformedRequest = async () => new Response('{"active":[],"previous":[{"id":42}]}');
  const malformed = createSessionApi(malformedRequest);
  await assert.rejects(malformed.list(null, '/api/sessions'), /Invalid session/);
  await assert.rejects(malformed.models(null), /Invalid model catalog/);
  await assert.rejects(setSessionModel(malformedRequest, { base: '' }, 's', 'p/m'), /Invalid mutation/);
  await assert.rejects(renameSession(malformedRequest, { base: '' }, 's', 'name'), /Invalid mutation/);
  await assert.rejects(setSessionThinking(async () => new Response('{"success":true,"level":null}'), { base: '' }, 's', 'high'), /Invalid thinking/);
  // Generic operations outside this typed slice retain their empty-success behavior.
  const generic = await sendJson(async () => new Response('', { status: 200 }), null, '/api/legacy', null);
  assert.equal(Object.keys(record(generic)).length, 0);
});

test('session list ingress separates opaque extras and omits malformed presentation values', async () => {
  const api = createSessionApi(async () => new Response(JSON.stringify({
    active: [{ id: 'one', host: 'forged', hostLabel: 'forged label', name: null, model: '',
      lastActivity: 0, contextTokens: 0, contextPercent: '45', turnInProgress: 1, compacting: false,
      parentId: null, familyParentId: '', capabilities: { resume: false, future: true },
      custom: { model: 42 }, fields: { model: 'forged' }, extras: { isActive: true } }], previous: [],
  })));
  const list = await api.list('peer', '/api/sessions');
  const row = present(list.active[0]);
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
  assert.equal(row.fields.capabilities?.future, true);
  assert.equal(record(row.extras.custom).model, 42);
  assert.equal(record(row.extras.fields).model, 'forged');
  assert.equal(row.extras.host, undefined);
  assert.equal(row.extras.hostLabel, undefined);
  assert.equal(row.extras.contextPercent, undefined);
});

test('classifies auth signals separately from ordinary server outages', () => {
  const origin = 'https://dish.example';
  const html = { 'Content-Type': 'text/html; charset=utf-8' };
  const cases = [
    [Object.defineProperty(new Response(), 'type', { value: 'opaqueredirect' }), 'auth'],
    [Object.defineProperty(new Response(), 'type', { value: 'opaque' }), 'auth'],
    [Object.defineProperties(Response.json({}), {
      redirected: { value: true }, url: { value: 'https://login.example/sign-in' },
    }), 'auth'],
    [Object.defineProperties(Response.json({}), {
      redirected: { value: true }, url: { value: `${origin}/api/sessions` },
    }), 'auth'],
    [Object.defineProperty(Response.json({}), 'url', { value: 'https://login.example/sign-in' }), 'auth'],
    [new Response('<html>', { headers: html }), 'auth'],
    [new Response(null, { status: 401 }), 'auth'],
    [new Response(null, { status: 403 }), 'auth'],
    [new Response('<html>', { status: 502, headers: html }), 'server'],
    [Response.json({ error: 'Bad gateway' }, { status: 502 }), 'server'],
    [Response.error(), 'network'],
    [new Response(null, { status: 404 }), null],
    [Response.json({ active: [], previous: [] }), null],
  ] as const;
  for (const [response, expected] of cases) assert.equal(classifyOriginResponse(response, origin), expected);
});

test('classifies fetch rejections and HTTP errors, not intentional cancellation', () => {
  assert.equal(classifyOriginError(new TypeError('Failed to fetch')), 'network');
  assert.equal(classifyOriginError(new DOMException('Request timed out', 'TimeoutError')), 'network');
  assert.equal(classifyOriginError(new DOMException('Request canceled', 'AbortError')), null);
  assert.equal(classifyOriginError(new ApiHttpError('Denied', 403)), 'auth');
  assert.equal(classifyOriginError(new ApiHttpError('Unavailable', 503)), 'server');
});

test('probeOriginFailure distinguishes healthy origin, server HTML 502, network errors, and auth redirects', async () => {
  const origin = 'https://dish.example';
  const probe = (responder: () => Promise<Response>) => probeOriginFailure(createOriginRequest(async (_host, path, init) => {
    assert.equal(path, '/api/host');
    assert.equal(init?.redirect, 'manual');
    return responder();
  }, origin));
  assert.equal(await probe(async () => Response.json({ hostId: 'self' })), null);
  assert.equal(await probe(async () => Object.defineProperty(new Response(), 'type', { value: 'opaqueredirect' })), 'auth');
  assert.equal(await probe(async () => new Response('<html>502</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })), 'server');
  assert.equal(await probe(async () => { throw new TypeError('Failed to fetch'); }), 'network');
});

test('origin requests surface a manual redirect before parsing but preserve ordinary HTTP responses', async () => {
  const opaque = Object.defineProperty(new Response(), 'type', { value: 'opaqueredirect' });
  const unsupported = new Response(null, { status: 501 });
  const request = createOriginRequest(async (_host, path, init) => {
    assert.equal(init?.redirect, 'manual');
    return path === '/api/sessions' ? opaque : unsupported;
  }, 'https://dish.example');
  await assert.rejects(createSessionApi(request).list(null, '/api/sessions'), error => classifyOriginError(error) === 'auth');
  assert.equal((await request(null, '/api/bots')).status, 501);
});

export {};
