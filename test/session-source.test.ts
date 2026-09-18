import test = require('node:test');
import { nativeId, present } from './test-types.js';
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
const { registry }: typeof import('../lib/harnesses') = require('../lib/harnesses')
const { encodeSessionKey }: typeof import('../lib/session-key') = require('../lib/session-key')
const { discoverHarnessSessions, readSessionHeader }: typeof import('../lib/session-discovery') = require('../lib/session-discovery')
const { createSessionSourceResolver, sourceForIdentity }: typeof import('../lib/session-source') = require('../lib/session-source')

function fixture(t: test.TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const roots = Object.fromEntries(['pi', 'omp', 'prime'].map(id => [id, path.join(dir, id)]));
  const resolver = createSessionSourceResolver({ roots });
  t.after(() => resolver.clear());
  const write = (file: string, id: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ type: 'session', id, cwd: '/workspace' }) + '\n');
    return file;
  };
  const resolve = (route: string, options = {}) => resolver.resolve({ route, live: [], ...options });
  const resolved = (route: string, options = {}) => present(resolve(route, options));
  return { dir, roots, resolver, write, resolve, resolved,
    discover: () => discoverHarnessSessions(Object.values(registry), { roots }),
  };
}

test('source identity preserves profile and pending claimed paths without path inference', t => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'not-yet-created.jsonl');
  const source = sourceForIdentity('omp', nativeId('native'), file);
  assert.equal(source.file, file);
  assert.equal(source.profileId, 'omp-v1');
  assert.equal(source.nativeSessionId, 'native');
  assert.equal(source.routeId, encodeSessionKey('omp', nativeId('native')));
  assert.equal(source.parentSession, null);
  assert.equal(sourceForIdentity('pi', nativeId('native'), file).routeId, 'native');
  assert.equal(sourceForIdentity('pi', nativeId('native'), file).sessionKey, encodeSessionKey('pi', nativeId('native')));
});

test('registered sources precede Pi RPC, then history, and live-only lookup never scans history', t => {
  const { dir, roots, write, resolve, resolved } = fixture(t);
  const history = write(path.join(roots.pi, 'ws', 'native.jsonl'), 'native');
  const registered = write(path.join(dir, 'registered.jsonl'), 'native');
  const rpc = write(path.join(dir, 'rpc.jsonl'), 'native');
  const live = [
    { kind: 'rpc', harnessId: 'pi', nativeSessionId: nativeId('native'), file: rpc },
    { kind: 'registered', harnessId: 'pi', nativeSessionId: nativeId('native'), file: registered },
  ];
  assert.equal(resolved('native', { live }).file, registered);
  fs.rmSync(registered);
  assert.equal(resolved('native', { live }).file, rpc);
  fs.rmSync(rpc);
  assert.equal(resolved('native', { live }).file, history);
  const originalOpen = fs.opendirSync;
  let opens = 0;
  fs.opendirSync = (...args) => { opens += 1; return originalOpen(...args); };
  try {
    assert.equal(resolve('native', { live, discover: false }), null);
    assert.equal(resolve('missing', { discover: false }), null);
  } finally { fs.opendirSync = originalOpen; }
  assert.equal(opens, 0, 'live-only reads must not discover history');

  const ompFile = write(path.join(dir, 'omp-rpc.jsonl'), 'native');
  assert.equal(resolve(encodeSessionKey('omp', nativeId('native')), {
    discover: false, live: [{ kind: 'rpc', harnessId: 'omp', nativeSessionId: nativeId('native'), file: ompFile }],
  }), null, 'RPC fallback belongs only to Pi');
});

test('same-native harness collisions and encoded Pi aliases retain exact lookup after a partial cache hit', t => {
  const { roots, write, resolve, resolved, resolver, discover } = fixture(t);
  const pi = write(path.join(roots.pi, 'ws', 'prefix-native-suffix.jsonl'), 'ignored');
  const omp = write(path.join(roots.omp, 'ws', 'native.jsonl'), 'native');
  const prime = write(path.join(roots.prime, 'native.jsonl'), 'native');
  assert.equal(resolved('native').file, pi);
  assert.equal(resolve('native', { exact: true }), null);
  assert.equal(resolve(encodeSessionKey('pi', nativeId('native'))), null);
  assert.equal(resolved(encodeSessionKey('omp', nativeId('native'))).file, omp);
  assert.equal(resolved(encodeSessionKey('prime', nativeId('native'))).file, prime);
  assert.equal(resolve(encodeSessionKey('omp', nativeId('ativ'))), null);
  resolver.refresh(discover());
  assert.equal(resolve(encodeSessionKey('pi', nativeId('native'))), null);
  assert.equal(resolve('~sk1_invalid'), null);
});

test('cached named OMP children revalidate changed and ambiguous header identity on route access', t => {
  const { roots, write, resolve, resolved, resolver, discover } = fixture(t);
  const parent = write(path.join(roots.omp, 'ws', 'parent.jsonl'), 'parent');
  const child = write(path.join(roots.omp, 'ws', 'parent', 'Explore.jsonl'), 'child');
  const route = encodeSessionKey('omp', nativeId('child'));
  assert.equal(resolved(route).file, child);
  resolver.refresh(discover());
  write(path.join(roots.omp, 'ws', 'parent', 'Copy.jsonl'), 'child');
  assert.equal(resolve(route), null, 'a route warmed by the list must refuse a newly copied named child');
  assert.equal(resolve(route, { exact: true }), null, 'every cached alias is retired');
  fs.rmSync(path.join(roots.omp, 'ws', 'parent', 'Copy.jsonl'));
  assert.equal(resolved(route).file, child);
  write(child, 'different-child');
  assert.equal(resolve(route), null, 'an existing file cannot retain a changed header identity');
  assert.equal(resolved(encodeSessionKey('omp', nativeId('different-child'))).file, child);
  fs.rmSync(parent);
  assert.equal(resolve(encodeSessionKey('omp', nativeId('different-child'))), null,
    'losing the structural parent also retires the nested source');
});

test('generic sources revalidate ambiguity and prefer a traditional basename collision', t => {
  const { roots, write, resolve, resolved } = fixture(t);
  const first = write(path.join(roots.pi, 'ws', 'one', 'session.jsonl'), 'child');
  assert.equal(resolved('child').file, first);
  const duplicate = write(path.join(roots.pi, 'ws', 'two', 'session.jsonl'), 'child');
  assert.equal(resolve('child'), null);
  fs.rmSync(duplicate);
  assert.equal(resolved('child').file, first);
  const traditional = write(path.join(roots.pi, 'ws', 'child.jsonl'), 'unrelated-header');
  assert.equal(resolved('child').file, traditional);
});

test('refresh replaces lookup aliases even for truncated discovery and deleted files are rediscovered', t => {
  const { roots, write, resolve, resolved, resolver, discover } = fixture(t);
  const old = write(path.join(roots.pi, 'z-workspace', 'native.jsonl'), 'native');
  assert.equal(resolved('ative').file, old);
  const preferred = write(path.join(roots.pi, 'a-workspace', 'native.jsonl'), 'native');
  const discovery = discover();
  resolver.refresh({ ...discovery, truncated: true });
  assert.equal(resolved('ative').file, preferred, 'refresh also retires substring lookup aliases');
  assert.equal(resolved('native', { exact: true }).file, preferred);
  fs.rmSync(preferred);
  assert.equal(resolved('native').file, old, 'vanished cached files permit rediscovery');
  fs.rmSync(old);
  assert.equal(resolve('native'), null);
  write(old, 'native');
  assert.equal(resolved('native').file, old, 'missing files are never negatively cached');
});

test('invalidation retires all route and profile observations of a replaced file', t => {
  const { roots, write, resolve, resolved, resolver } = fixture(t);
  const file = write(path.join(roots.pi, 'ws', 'one', 'session.jsonl'), 'first');
  assert.equal(resolved('first').file, file);
  assert.equal(resolved(encodeSessionKey('pi', nativeId('first'))).file, file);
  assert.equal(present(readSessionHeader(file, 'omp-v1')).id, 'first');
  const stat = fs.statSync(file);
  write(file, 'other'); // Same size and restored mtime deliberately exercise explicit invalidation.
  fs.utimesSync(file, stat.atime, stat.mtime);
  resolver.invalidate(file);
  assert.equal(resolve('first'), null);
  assert.equal(resolve(encodeSessionKey('pi', nativeId('first'))), null);
  assert.equal(present(readSessionHeader(file, 'omp-v1')).id, 'other');
  assert.equal(resolved('other').file, file);
});

test('route invalidation retires canonical and partial aliases while retaining unrelated routes and headers', t => {
  const { roots, write, resolved, resolver } = fixture(t);
  const old = write(path.join(roots.pi, 'z-workspace', 'native.jsonl'), 'native');
  const unrelated = write(path.join(roots.prime, 'native.jsonl'), 'native');
  const header = write(path.join(roots.pi, 'ws', 'run', 'session.jsonl'), 'cached-header');
  const piRoute = encodeSessionKey('pi', nativeId('native'));
  const primeRoute = encodeSessionKey('prime', nativeId('native'));
  assert.equal(resolved('native').file, old);
  assert.equal(resolved('native', { exact: true }).file, old);
  assert.equal(resolved(piRoute).file, old);
  assert.equal(resolved('ativ').file, old);
  assert.equal(resolved(primeRoute).file, unrelated);
  assert.equal(present(readSessionHeader(header)).id, 'cached-header');
  assert.equal(present(readSessionHeader(header, 'omp-v1')).id, 'cached-header');

  const preferred = write(path.join(roots.pi, 'a-workspace', 'native.jsonl'), 'native');
  const originalOpen = fs.openSync;
  const originalOpenDir = fs.opendirSync;
  let fileOpens = 0, directoryOpens = 0;
  fs.openSync = (...args) => { fileOpens += 1; return originalOpen(...args); };
  fs.opendirSync = (...args) => { directoryOpens += 1; return originalOpenDir(...args); };
  try {
    resolver.invalidateRoute(piRoute);
    assert.equal(resolved(primeRoute).file, unrelated, 'same-native sessions on another harness stay cached');
    assert.equal(present(readSessionHeader(header)).id, 'cached-header');
    assert.equal(present(readSessionHeader(header, 'omp-v1')).id, 'cached-header');
    assert.equal(fileOpens, 0, 'route changes retain stat-validated headers across profiles');
    assert.equal(directoryOpens, 0, 'invalidation and unrelated cached routes require no discovery');

    assert.equal(resolved('native').file, preferred);
    assert.equal(resolved('native', { exact: true }).file, preferred);
    assert.equal(resolved(piRoute).file, preferred);
    assert.equal(resolved('ativ').file, preferred, 'substring aliases are retired by their resolved canonical identity');
    assert.equal(fileOpens, 0, 'rediscovery also reuses the unrelated cached header');
  } finally {
    fs.openSync = originalOpen;
    fs.opendirSync = originalOpenDir;
  }
});

export {};
