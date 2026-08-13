const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encodeSessionKey, decodeSessionKey, resolveSessionRoute, VERSION } = require('../lib/session-key');
const { registry, resolveLaunchSpec } = require('../lib/harnesses');
const { discoverSessionCandidates, discoverHarnessSessions } = require('../lib/session-discovery');
const { getSessionInfo } = require('../lib/session-files');

test('harness descriptors keep alternate launches tmux-only and load thin wrappers explicitly', () => {
  assert.equal(registry.pi.rpcFallback, true);
  assert.equal(registry.pi.closeMode, 'logical');
  assert.deepEqual(registry.pi.argv.new({ model: 'provider/model', thinking: 'high' }), [
    '--model', 'provider/model', '--thinking', 'high',
  ]);
  assert.equal(registry.omp.closeMode, 'unsupported');
  assert.equal(registry.prime.closeMode, 'client-only');
  for (const id of ['omp', 'prime']) {
    const descriptor = registry[id];
    assert.equal(descriptor.rpcFallback, false);
    assert.equal(descriptor.spawnTokenMode, 'wrapper');
    assert.match(descriptor.wrapperEntrypoint, new RegExp(`pi-dish-bridge-${id}`));
    assert.deepEqual(descriptor.argv.new({ model: 'provider/model', thinking: 'high' }), [
      '--extension', descriptor.wrapperEntrypoint, '--model', 'provider/model', '--thinking', 'high',
    ]);
    assert.deepEqual(descriptor.argv.resume({ file: '/tmp/session.jsonl' }), [
      '--extension', descriptor.wrapperEntrypoint, '--resume', '/tmp/session.jsonl',
    ]);
  }
  assert.deepEqual(registry.omp.argv.resume({ file: '/tmp/session.jsonl', model: 'zai/glm-4.7-flash' }), [
    '--extension', registry.omp.wrapperEntrypoint, '--resume', '/tmp/session.jsonl',
    '--model', 'zai/glm-4.7-flash',
  ]);
});

test('OMP launches skip the first-run setup wizard unless the configured command overrides it', () => {
  // Default: the wizard would own TUI input a web pilot can never dismiss.
  assert.equal(resolveLaunchSpec(registry.omp, {}).env.OMP_SKIP_SETUP, '1');
  // An explicit assignment in PI_DISH_OMP_COMMAND wins over the default.
  const overridden = resolveLaunchSpec(registry.omp, { PI_DISH_OMP_COMMAND: 'env OMP_SKIP_SETUP=0 omp' });
  assert.equal(overridden.env.OMP_SKIP_SETUP, '0');
  assert.deepEqual(overridden.argv, ['omp']);
  // Other harnesses gain no stray env defaults.
  assert.deepEqual(resolveLaunchSpec(registry.pi, {}).env, {});
});

test('canonical identities round-trip strictly and legacy routes belong to Pi', () => {
  for (const harnessId of ['pi', 'omp', 'prime']) {
    const key = encodeSessionKey(harnessId, 'native:one');
    assert.deepEqual(decodeSessionKey(key), { harnessId, nativeSessionId: 'native:one' });
  }
  assert.deepEqual(resolveSessionRoute('old.pi-id'), { harnessId: 'pi', nativeSessionId: 'old.pi-id' });
  assert.deepEqual(resolveSessionRoute('sk1_existing-pi-id'),
    { harnessId: 'pi', nativeSessionId: 'sk1_existing-pi-id' });
  for (const bad of ['', VERSION, `${VERSION}!!!!`, encodeSessionKey('pi', 'x') + 'x']) assert.throws(() => decodeSessionKey(bad));
  assert.throws(() => resolveSessionRoute(`${VERSION}!!!!`),
    'a malformed encoded route never falls back to Pi');
  for (const id of ['', '../x', 'x'.repeat(201)]) assert.throws(() => encodeSessionKey('pi', id));
  assert.throws(() => encodeSessionKey('other', 'x'));
});

test('OMP profile reads title, second-line header, and combined model', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-omp-'));
  const file = path.join(root, 'workspace', 'run', 'session.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    { type: 'title', title: 'OMP title' },
    { type: 'session', id: 'same', cwd: '/omp' },
    { type: 'model_change', model: 'provider/model' },
  ].map(JSON.stringify).join('\n'));
  const candidate = discoverSessionCandidates(root, { descriptor: registry.omp }).candidates[0];
  assert.equal(candidate.nativeSessionId, 'same');
  const info = getSessionInfo(candidate);
  assert.deepEqual({ name: info.name, cwd: info.cwd, model: info.model, sessionId: info.sessionId },
    { name: 'OMP title', cwd: '/omp', model: 'provider/model', sessionId: 'same' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('Prime flat filename identity coexists with the same OMP native id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-multi-'));
  const primeRoot = path.join(root, 'prime');
  const ompRoot = path.join(root, 'omp');
  fs.mkdirSync(primeRoot, { recursive: true });
  fs.mkdirSync(path.join(ompRoot, 'ws'), { recursive: true });
  fs.writeFileSync(path.join(primeRoot, 'same.jsonl'), JSON.stringify({ type: 'session', id: 'different' }) + '\n');
  fs.writeFileSync(path.join(ompRoot, 'ws', 'same.jsonl'), JSON.stringify({ type: 'session', id: 'same' }) + '\n');
  const result = discoverHarnessSessions([registry.omp, registry.prime], { roots: { omp: ompRoot, prime: primeRoot } });
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(new Set(result.candidates.map(c => c.nativeSessionId)), new Set(['same']));
  assert.equal(new Set(result.candidates.map(c => c.sessionKey)).size, 2);
  assert.equal(result.candidates.find(c => c.harnessId === 'prime').nativeSessionId, 'same');
  fs.rmSync(root, { recursive: true, force: true });
});
