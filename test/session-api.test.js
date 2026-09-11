const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModels, sessionForClient, decodeSessionMetadata, decodeSessionList,
  thinkingResult, decodeModelCatalog, decodeMutationResult, decodeThinkingResult, decodeEnabledModelsResult } = require('../lib/session-api');

test('client session projection preserves feature hints and validates control fields', () => {
  const row = { id: 'omp:session', name: null, model: 'provider/model', isActive: true,
    capabilities: { prompt: true, btw: true, futureCapability: false },
    parentId: 'parent', routine: 'routine', sessionFile: '/private', pid: 42, nativeSessionId: 'native' };
  const projected = sessionForClient(row);
  assert.equal(projected.parentId, 'parent');
  assert.equal(projected.routine, 'routine');
  assert.equal(projected.capabilities.btw, true);
  assert.ok(!('sessionFile' in projected) && !('pid' in projected) && !('nativeSessionId' in projected));
  assert.equal(row.sessionFile, '/private');
  for (const value of [null, [], {}, { id: 2 }, { id: 'x', isActive: 'false' }, { id: 'x', capabilities: { close: 'true' } }]) {
    assert.throws(() => decodeSessionMetadata(value), /Invalid session/);
  }
  assert.deepEqual(decodeSessionMetadata({ id: 'legacy' }), { id: 'legacy' });
  assert.throws(() => decodeSessionList({ active: [{ id: 'a' }], previous: [null] }), /Invalid session/);
  assert.deepEqual(decodeSessionList({ active: [], previous: [], children: [{ id: 'child' }], indexing: true }).children, [{ id: 'child' }]);
});

test('harness models normalize native refs, thinking subsets and finite pricing', () => {
  const models = normalizeModels(['provider/nested/model', 'bare', null, { id: 123, provider: 'p' },
    { modelId: 'paid', provider: 'p', name: 'Paid', contextWindow: 1000000, reasoning: true,
      thinking: ['low', 'max', 'off', 123], cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: Infinity } },
    { id: 'free', provider: 'p', pricing: { input: 0, output: 0 } }]);
  assert.equal(models.length, 3);
  assert.equal(models[0].id, 'nested/model');
  assert.equal(models[0].selector, 'provider/nested/model');
  assert.deepEqual(models[1].thinking, ['low', 'max']);
  assert.deepEqual(models[1].pricing, { input: 1, output: 2, cacheRead: 0 });
  assert.equal(models[1].contextWindow, 1000000);
  assert.equal(models[2].free, true);
  assert.equal(normalizeModels([{ id: 'bad', provider: 'p', contextWindow: {}, pricing: { input: '0', output: 0 } }])[0].pricing, null);
});

test('catalog decoder preserves disabled models and rejects invalid row identities', () => {
  const input = [{ id: 'm', provider: 'p', enabled: false, extra: { opaque: true } }];
  const [model] = decodeModelCatalog(input);
  assert.equal(model.enabled, false);
  assert.equal(model.name, 'm');
  assert.equal(model.contextWindow, 0);
  assert.deepEqual(model.extra, { opaque: true });
  assert.ok(!('name' in input[0]), 'decoding must not mutate a cache snapshot');
  for (const value of [{ error: 'failed' }, [null], [{ id: 'm' }], [{ id: 'm', provider: 'p', enabled: 'false' }]]) {
    assert.throws(() => decodeModelCatalog(value), /Invalid model catalog/);
  }
});

test('mutation decoders require success and validate operation-specific results', () => {
  assert.deepEqual(decodeThinkingResult({ success: true, level: 'max' }), { success: true, level: 'max' });
  assert.deepEqual(decodeEnabledModelsResult({ success: true, enabledModels: null }).enabledModels, null);
  assert.deepEqual(decodeEnabledModelsResult({ success: true, enabledModels: ['p/m'] }).enabledModels, ['p/m']);
  for (const value of [{}, { success: false }, { success: 'true' }, null]) assert.throws(() => decodeMutationResult(value));
  assert.throws(() => decodeThinkingResult({ success: true, level: {} }));
  assert.throws(() => decodeEnabledModelsResult({ success: true, enabledModels: [42] }));
});

test('thinking acknowledgement falls back only for missing or malformed reported levels', () => {
  for (const reply of [undefined, null, [], 42]) {
    assert.equal(thinkingResult(reply, 'high').level, 'high');
  }
  for (const level of [undefined, null, '', 0, {}, false]) {
    assert.equal(decodeThinkingResult(thinkingResult({ level }, 'high')).level, 'high');
  }
  assert.equal(thinkingResult({ level: 'low' }, 'high').level, 'low');
  const [legacy] = decodeModelCatalog([{ id: 'm', provider: 'p', selector: null, cost: { input: 1, output: 2 } }]);
  assert.equal(legacy.selector, 'p/m');
  assert.deepEqual(legacy.pricing, { input: 1, output: 2 });
});
