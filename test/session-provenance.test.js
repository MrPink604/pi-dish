const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encodeSessionKey } = require('../lib/session-key');

const originalHome = process.env.HOME;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-provenance-'));
process.env.HOME = home;
const provenance = require('../lib/session-provenance');

test.after(() => {
  process.env.HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

test('records advisory launch provenance in the pi-dish sidecar', () => {
  provenance.recordLaunch('child-1', 'source-1', 'operation-1');
  assert.deepEqual(provenance.getLaunch('child-1'), {
    sourceSessionId: 'source-1', operationId: 'operation-1', createdAt: provenance.getLaunch('child-1').createdAt,
  });
  assert.deepEqual(provenance.getLaunchesFrom('source-1').map(x => x.sessionId), ['child-1']);
  const stored = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'session-provenance.json'), 'utf8'));
  assert.equal(stored.launches['child-1'].sourceSessionId, 'source-1');
});

test('re-recording a child updates rather than duplicates it', () => {
  provenance.recordLaunch('child-1', 'source-2', 'operation-2');
  assert.equal(provenance.getLaunch('child-1').sourceSessionId, 'source-2');
  assert.equal(provenance.getLaunchesFrom('source-1').length, 0);
  assert.equal(provenance.getLaunchesFrom('source-2').length, 1);
});

test('canonical alternative-harness routes persist as provenance identities', () => {
  const source = encodeSessionKey('omp', 'source-alt');
  const child = encodeSessionKey('prime', 'child-alt');
  provenance.recordLaunch(child, source, 'operation-alt');
  assert.equal(provenance.getLaunch(child).sourceSessionId, source);
  assert.deepEqual(provenance.getLaunchesFrom(source).map(entry => entry.sessionId), [child]);
});

test('encoded Pi aliases fold into the legacy raw Pi provenance identity', () => {
  const sourceAlias = encodeSessionKey('pi', 'source-pi');
  const childAlias = encodeSessionKey('pi', 'child-pi');
  provenance.recordLaunch(childAlias, sourceAlias, 'operation-pi');
  assert.equal(provenance.getLaunch('child-pi').sourceSessionId, 'source-pi');
  assert.equal(provenance.getLaunch(childAlias).sourceSessionId, 'source-pi');
  assert.deepEqual(provenance.getLaunchesFrom('source-pi').map(entry => entry.sessionId), ['child-pi']);
  assert.deepEqual(provenance.getLaunchesFrom(sourceAlias).map(entry => entry.sessionId), ['child-pi']);
});

test('broken sidecars and invalid ids degrade safely', () => {
  const file = path.join(home, '.pi', 'dish', 'session-provenance.json');
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(provenance.readLaunches(), {});
  assert.throws(() => provenance.recordLaunch('../bad', 'source', 'op'), /valid session ids/);
});
