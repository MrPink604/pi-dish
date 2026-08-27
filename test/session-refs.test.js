/**
 * `#ref` prompt expansion (lib/session-refs.js). The grammar and the block
 * format are covered in test/helpers.test.js; what matters here is the
 * resolution policy — which refs earn a block entry and which are left as the
 * prose they probably were.
 */
const test = require('node:test');
const assert = require('node:assert');

const { expandSessionRefs } = require('../lib/session-refs');
const { splitSessionRefContext } = require('../public/helpers');

const SELF_HOST = '0f9c1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b';
const PEER_HOST = '11112222-3333-4444-5555-666677778888';

const LOCAL = {
  'local-session-aaaa1111': { id: 'local-session-aaaa1111', name: 'torn tail recovery', cwd: '/w/pi-dish', isActive: true },
  'local-session-bbbb2222': { id: 'local-session-bbbb2222', name: 'index compaction', cwd: '/w/other', isActive: false },
};

function deps(overrides = {}) {
  const calls = { resolveLocal: 0, fleetNames: 0 };
  const base = {
    calls,
    selfHostId: SELF_HOST,
    resolveLocal: (id, exactOnly) => {
      calls.resolveLocal++;
      if (LOCAL[id]) return LOCAL[id];
      if (exactOnly) return null;
      const matches = Object.values(LOCAL).filter(s => s.id.startsWith(id));
      return matches.length === 1 ? matches[0] : null;
    },
    fleetNames: () => { calls.fleetNames++; return ['tycho']; },
  };
  return Object.assign(base, overrides);
}

const refsIn = (text) => splitSessionRefContext(text).refs;

test('a bare ref resolves against the local catalog and gets a block entry', () => {
  const d = deps();
  const out = expandSessionRefs('pick up where #local-session-a left off.', null, d);
  assert.equal(splitSessionRefContext(out).text, 'pick up where #local-session-a left off.');
  assert.deepEqual(refsIn(out), [{
    ref: 'local-session-a', name: 'torn tail recovery', host: '', cwd: '/w/pi-dish', isActive: true,
  }]);
});

test('self/ and this host\'s own uuid are the same local ref', () => {
  const d = deps();
  const bySelf = refsIn(expandSessionRefs('#self/local-session-bbbb2222', null, d));
  const byUuid = refsIn(expandSessionRefs(`#${SELF_HOST}:local-session-bbbb2222`, null, d));
  assert.deepEqual(bySelf.map(r => r.name), ['index compaction']);
  assert.deepEqual(byUuid.map(r => r.name), ['index compaction']);
  assert.equal(bySelf[0].isActive, false);
});

test('an ambiguous or unknown local prefix contributes nothing', () => {
  const d = deps();
  // "local-session-" prefixes both fixtures.
  assert.equal(expandSessionRefs('see #local-session-', null, d), 'see #local-session-');
  assert.equal(expandSessionRefs('see #nosuchref', null, d), 'see #nosuchref');
  // The prose case this guard exists for.
  assert.equal(expandSessionRefs('#include <stdio.h>', null, d), '#include <stdio.h>');
});

test('a token-free prompt never reads the catalog', () => {
  const d = deps();
  assert.equal(expandSessionRefs('no refs at all', null, d), 'no refs at all');
  assert.equal(d.calls.resolveLocal, 0);
  assert.equal(d.calls.fleetNames, 0);
});

test('a host-qualified ref is named by the fleet even without a hint', () => {
  const d = deps();
  const out = expandSessionRefs('compare with #tycho/8f3ab2c1', null, d);
  assert.deepEqual(refsIn(out), [{
    ref: 'tycho/8f3ab2c1', name: '', host: 'tycho', cwd: '', isActive: false,
  }]);
  // Peer sessions are never looked up locally — ids are host-local.
  assert.equal(d.calls.resolveLocal, 0);
});

test('a client hint supplies the peer session metadata this host cannot know', () => {
  const d = deps();
  const hints = [{
    ref: `${PEER_HOST}:remote-session-1`,
    name: 'jsonl torn tail', host: 'tycho', cwd: '/w/pi-dish', isActive: true,
  }];
  const out = expandSessionRefs(`look at #${PEER_HOST}:remote-session-1`, hints, d);
  assert.deepEqual(refsIn(out), [{
    ref: `${PEER_HOST}:remote-session-1`,
    name: 'jsonl torn tail', host: 'tycho', cwd: '/w/pi-dish', isActive: true,
  }]);
});

test('an unfleeted, unhinted host part is dropped', () => {
  const d = deps();
  // A path-looking token must not become a session reference.
  assert.equal(expandSessionRefs('the #docs/agent tree', null, d), 'the #docs/agent tree');
  assert.equal(expandSessionRefs(`#${PEER_HOST}:remote-session-1`, null, d),
    `#${PEER_HOST}:remote-session-1`);
});

test('hints never override the local catalog and cannot inject fields', () => {
  const d = deps();
  const hints = [{
    ref: 'local-session-aaaa1111',
    name: 'ATTACKER NAME', host: 'evil', cwd: '/tmp', isActive: false,
    extra: 'ignored', ref2: 'ignored',
  }];
  const [entry] = refsIn(expandSessionRefs('#local-session-aaaa1111', hints, d));
  assert.equal(entry.name, 'torn tail recovery');
  assert.equal(entry.host, '');
  assert.equal(entry.cwd, '/w/pi-dish');
  assert.equal(entry.isActive, true);
});

test('malformed hints and non-string messages degrade quietly', () => {
  const d = deps();
  assert.equal(expandSessionRefs('#nosuchref', ['nonsense', null, 42, {}], d), '#nosuchref');
  assert.equal(expandSessionRefs(null, null, d), '');
  assert.equal(expandSessionRefs(undefined, undefined, d), '');
});

test('every resolvable ref in one prompt lands in a single block', () => {
  const d = deps();
  const out = expandSessionRefs(
    'diff #local-session-aaaa1111 against #tycho/8f3ab2c1, ignore #nosuchref',
    null, d);
  assert.equal(out.match(/<session-refs>/g).length, 1);
  assert.deepEqual(refsIn(out).map(r => r.ref), ['local-session-aaaa1111', 'tycho/8f3ab2c1']);
  assert.equal(splitSessionRefContext(out).text,
    'diff #local-session-aaaa1111 against #tycho/8f3ab2c1, ignore #nosuchref');
});
