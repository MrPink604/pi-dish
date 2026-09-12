const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModels, sessionForClient, decodeSessionMetadata, decodeSessionList,
  thinkingResult, decodeModelCatalog, decodeMutationResult, decodeThinkingResult, decodeEnabledModelsResult,
  decodeSessionRow, decodeSessionMutationPatch, decodeSessionActivityPatch, decodeSessionTranscriptPatch } = require('../lib/session-api');

test('closed session ingress separates authority, endpoint identity and opaque peer extras', () => {
  const wire = JSON.parse('{"id":"peer","host":"forged","hostLabel":"forged","name":"","model":null,"contextTokens":0,"compacting":false,"familyParentId":null,"capabilities":{"close":false,"future":true,"__proto__":false},"extra":{"model":99},"__proto__":{"model":99}}');
  const row = decodeSessionRow(wire);
  assert.equal(row.id, 'peer');
  assert.equal(row.fields.name, '');
  assert.equal(row.fields.model, null);
  assert.equal(row.fields.contextTokens, 0);
  assert.equal(row.fields.compacting, false);
  assert.equal(row.fields.familyParentId, null);
  assert.equal(row.fields.capabilities.resume, undefined, 'partial capabilities retain legacy fallback');
  assert.equal(row.fields.capabilities.close, false);
  assert.equal(row.fields.capabilities.__proto__, false);
  assert.ok(!Object.hasOwn(row.fields, 'host') && !Object.hasOwn(row.extras, 'host'));
  assert.ok(!Object.hasOwn(row.extras, 'hostLabel') && !Object.hasOwn(row.extras, 'model'));
  assert.deepEqual(row.extras.extra, { model: 99 });
  assert.deepEqual(row.extras.__proto__, { model: 99 });
  assert.equal(Object.getPrototypeOf(row.extras), Object.prototype);
  assert.equal(wire.host, 'forged', 'decoding does not mutate the caller');
  assert.deepEqual(decodeSessionRow({ id: 'legacy' }).fields, {});
  const malformed = decodeSessionRow({ id: 'legacy', contextTokens: '123', searchScore: Infinity, parentId: {}, lastActivity: new Date(0) });
  assert.deepEqual(malformed.fields, {});
  assert.deepEqual(malformed.extras, {}, 'invalid known fields do not re-enter through extras');
  assert.throws(() => decodeSessionRow({ id: 'bad', model: 42 }), /Invalid session/);
  assert.throws(() => decodeSessionRow(Object.create({ id: 'inherited' })), /Invalid session/);
});

test('wire and server timestamp boundaries preserve existing Date projection', () => {
  const date = new Date('2026-09-12T00:00:00Z');
  const projected = sessionForClient({ id: 'a', lastActivity: date, sessionFile: '/private' });
  assert.equal(projected.lastActivity, date, 'server projection runs before JSON serialization');
  assert.equal(decodeSessionRow(JSON.parse(JSON.stringify(projected))).fields.lastActivity, date.toISOString());
  for (const value of [0, '', null, date.toISOString()]) {
    assert.equal(decodeSessionRow({ id: 'a', lastActivity: value }).fields.lastActivity, value);
  }
});

test('metadata patches preserve presence and permit only their assigned writers', () => {
  assert.deepEqual(decodeSessionMutationPatch({ id: 'new', host: 'new', name: '', model: null, thinkingLevel: undefined,
    capabilities: { close: true }, extras: { model: 99 }, modle: 'typo' }), { name: '', model: null });
  assert.deepEqual(decodeSessionActivityPatch({ turnInProgress: false, compacting: true, isActive: false }), { turnInProgress: false, compacting: true });
  assert.deepEqual(decodeSessionTranscriptPatch({ id: 'new', harnessId: 'other', name: null, cwd: null,
    contextTokens: 0, lastActivity: 0, isActive: false, parentId: 'new', routine: 'new', capabilities: { close: true } }),
  { name: null, cwd: null, contextTokens: 0, lastActivity: 0, isActive: false });
  for (const decoder of [decodeSessionMutationPatch, decodeSessionActivityPatch, decodeSessionTranscriptPatch]) {
    assert.deepEqual(decoder({}), {});
    assert.throws(() => decoder(null), /Invalid session patch/);
  }
  assert.throws(() => decodeSessionMutationPatch({ model: 42 }), /Invalid session patch/);
  assert.throws(() => decodeSessionActivityPatch({ compacting: null }), /Invalid session patch/);
  assert.throws(() => decodeSessionTranscriptPatch({ contextPercent: NaN }), /Invalid session patch/);
});

test('client projection preserves feature hints and wire ingress validates control fields', () => {
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
  assert.deepEqual(decodeSessionList({ active: [], previous: [], children: [{ id: 'child' }], indexing: true }).children,
    [{ id: 'child', fields: {}, extras: {} }]);
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
