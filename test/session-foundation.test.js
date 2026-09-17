// Generated tool from test/session-foundation.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const session_key_1 = require("../lib/session-key");
const harnesses_1 = require("../lib/harnesses");
const session_discovery_1 = require("../lib/session-discovery");
const session_files_1 = require("../lib/session-files");
test('harness descriptors keep alternate launches tmux-only and load thin wrappers explicitly', () => {
    assert.equal(harnesses_1.registry.pi.rpcFallback, true);
    assert.equal(harnesses_1.registry.pi.closeMode, 'logical');
    assert.deepEqual(harnesses_1.registry.pi.argv.new({ model: 'provider/model', thinking: 'high' }), [
        '--model', 'provider/model', '--thinking', 'high',
    ]);
    assert.equal(harnesses_1.registry.omp.closeMode, 'owned-pane');
    assert.equal(harnesses_1.registry.prime.closeMode, 'owned-agent');
    for (const id of ['omp', 'prime']) {
        assert.ok(id === 'omp' || id === 'prime');
        const descriptor = harnesses_1.registry[id];
        assert.ok(typeof descriptor.wrapperEntrypoint === 'string');
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
    assert.deepEqual(harnesses_1.registry.omp.argv.resume({ file: '/tmp/session.jsonl', model: 'zai/glm-4.7-flash' }), [
        '--extension', harnesses_1.registry.omp.wrapperEntrypoint, '--resume', '/tmp/session.jsonl',
        '--model', 'zai/glm-4.7-flash',
    ]);
});
test('OMP launches skip the first-run setup wizard unless the configured command overrides it', () => {
    // Default: the wizard would own TUI input a web pilot can never dismiss.
    assert.equal((0, harnesses_1.resolveLaunchSpec)(harnesses_1.registry.omp, {}).env.OMP_SKIP_SETUP, '1');
    // An explicit assignment in PI_DISH_OMP_COMMAND wins over the default.
    const overridden = (0, harnesses_1.resolveLaunchSpec)(harnesses_1.registry.omp, { PI_DISH_OMP_COMMAND: 'env OMP_SKIP_SETUP=0 omp' });
    assert.equal(overridden.env.OMP_SKIP_SETUP, '0');
    assert.deepEqual(overridden.argv, ['omp']);
    // Other harnesses gain no stray env defaults.
    assert.deepEqual((0, harnesses_1.resolveLaunchSpec)(harnesses_1.registry.pi, {}).env, {});
});
test('canonical identities round-trip strictly and legacy routes belong to Pi', () => {
    const nativeId = 'native:one';
    const shortId = 'x';
    assert.ok((0, session_key_1.validSessionId)(nativeId));
    assert.ok((0, session_key_1.validSessionId)(shortId));
    for (const harnessId of ['pi', 'omp', 'prime']) {
        assert.ok(harnessId === 'pi' || harnessId === 'omp' || harnessId === 'prime');
        const key = (0, session_key_1.encodeSessionKey)(harnessId, nativeId);
        assert.deepEqual((0, session_key_1.decodeSessionKey)(key), { harnessId, nativeSessionId: 'native:one' });
    }
    assert.deepEqual((0, session_key_1.resolveSessionRoute)('old.pi-id'), { harnessId: 'pi', nativeSessionId: 'old.pi-id' });
    assert.deepEqual((0, session_key_1.resolveSessionRoute)('sk1_existing-pi-id'), { harnessId: 'pi', nativeSessionId: 'sk1_existing-pi-id' });
    for (const bad of ['', session_key_1.VERSION, `${session_key_1.VERSION}!!!!`, (0, session_key_1.encodeSessionKey)('pi', shortId) + 'x'])
        assert.throws(() => (0, session_key_1.decodeSessionKey)(bad));
    assert.throws(() => (0, session_key_1.resolveSessionRoute)(`${session_key_1.VERSION}!!!!`), 'a malformed encoded route never falls back to Pi');
    for (const id of ['', '../x', 'x'.repeat(201)])
        assert.throws(() => { Reflect.apply(session_key_1.encodeSessionKey, undefined, ['pi', id]); });
    assert.throws(() => { Reflect.apply(session_key_1.encodeSessionKey, undefined, ['other', 'x']); });
});
test('harness lookup accepts only registered string names', () => {
    for (const id of ['pi', 'omp', 'prime']) {
        assert.ok(id === 'pi' || id === 'omp' || id === 'prime');
        assert.equal((0, harnesses_1.getHarness)(id), harnesses_1.registry[id]);
    }
    for (const id of ['constructor', '__proto__', 'toString', ['pi'], null, 42, { toString: () => 'pi' }]) {
        assert.equal((0, harnesses_1.getHarness)(id), null);
        assert.throws(() => { Reflect.apply(session_key_1.encodeSessionKey, undefined, [id, 'native']); });
    }
});
test('encoded session routes reject inherited and coerced harness names', () => {
    for (const id of ['constructor', '__proto__', 'toString', ['pi'], null, 42]) {
        const key = session_key_1.VERSION + Buffer.from(JSON.stringify([id, 'native']), 'utf8').toString('base64url');
        assert.throws(() => (0, session_key_1.resolveSessionRoute)(key));
    }
});
test('OMP profile reads title, second-line header, and combined model', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-omp-'));
    const file = path.join(root, 'workspace', 'run', 'session.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
        { type: 'title', title: 'OMP title' },
        { type: 'session', id: 'same', cwd: '/omp' },
        { type: 'model_change', model: 'provider/model' },
    ].map(value => JSON.stringify(value)).join('\n'));
    const candidate = (0, session_discovery_1.discoverSessionCandidates)(root, { descriptor: harnesses_1.registry.omp }).candidates[0];
    assert.ok(candidate);
    assert.equal(candidate.nativeSessionId, 'same');
    const info = (0, session_files_1.getSessionInfo)(candidate);
    assert.ok(info);
    assert.deepEqual({ name: info.name, cwd: info.cwd, model: info.model, sessionId: info.sessionId }, { name: 'OMP title', cwd: '/omp', model: 'provider/model', sessionId: 'same' });
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
    const result = (0, session_discovery_1.discoverHarnessSessions)([harnesses_1.registry.omp, harnesses_1.registry.prime], { roots: { omp: ompRoot, prime: primeRoot } });
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(new Set(result.candidates.map(c => c.nativeSessionId)), new Set(['same']));
    assert.equal(new Set(result.candidates.map(c => c.sessionKey)).size, 2);
    const prime = result.candidates.find(c => c.harnessId === 'prime');
    assert.ok(prime);
    assert.equal(prime.nativeSessionId, 'same');
    fs.rmSync(root, { recursive: true, force: true });
});
