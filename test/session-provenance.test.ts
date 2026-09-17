import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { encodeSessionKey, validSessionId } from '../lib/session-key.js';

const originalHome = process.env.HOME;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-provenance-'));
process.env.HOME = home;
const provenance: typeof import('../lib/session-provenance.js') = require('../lib/session-provenance.js');

test.after(() => {
  process.env.HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

test('records advisory launch provenance in the pi-dish sidecar', () => {
  provenance.recordLaunch('child-1', 'source-1', 'operation-1');
  const launch = provenance.getLaunch('child-1');
  assert.equal(launch?.sourceSessionId, 'source-1');
  assert.equal(launch?.operationId, 'operation-1');
  assert.deepEqual(provenance.getLaunchesFrom('source-1').map(x => x.sessionId), ['child-1']);
  const stored: unknown = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'session-provenance.json'), 'utf8'));
  assert.ok(stored !== null && typeof stored === 'object' && 'launches' in stored);
  const launches = stored.launches;
  assert.ok(launches !== null && typeof launches === 'object' && 'child-1' in launches);
  const child = launches['child-1'];
  assert.ok(child !== null && typeof child === 'object' && 'sourceSessionId' in child);
  assert.equal(child.sourceSessionId, 'source-1');
});

test('re-recording a child updates rather than duplicates it', () => {
  provenance.recordLaunch('child-1', 'source-2', 'operation-2');
  assert.equal(provenance.getLaunch('child-1')?.sourceSessionId, 'source-2');
  assert.deepEqual(provenance.getLaunchesFrom('source-1').map(entry => entry.sessionId), []);
  assert.deepEqual(provenance.getLaunchesFrom('source-2').map(entry => entry.sessionId), ['child-1']);
});

test('canonical alternative-harness routes persist as provenance identities', () => {
  const sourceNativeId = 'source-alt';
  const childNativeId = 'child-alt';
  assert.ok(validSessionId(sourceNativeId));
  assert.ok(validSessionId(childNativeId));
  const source = encodeSessionKey('omp', sourceNativeId);
  const child = encodeSessionKey('prime', childNativeId);
  provenance.recordLaunch(child, source, 'operation-alt');
  assert.equal(provenance.getLaunch(child)?.sourceSessionId, source);
  assert.deepEqual(provenance.getLaunchesFrom(source).map(entry => entry.sessionId), [child]);
});

test('encoded Pi aliases fold into the legacy raw Pi provenance identity', () => {
  const sourceNativeId = 'source-pi';
  const childNativeId = 'child-pi';
  assert.ok(validSessionId(sourceNativeId));
  assert.ok(validSessionId(childNativeId));
  const sourceAlias = encodeSessionKey('pi', sourceNativeId);
  const childAlias = encodeSessionKey('pi', childNativeId);
  provenance.recordLaunch(childAlias, sourceAlias, 'operation-pi');
  assert.equal(provenance.getLaunch('child-pi')?.sourceSessionId, 'source-pi');
  assert.equal(provenance.getLaunch(childAlias)?.sourceSessionId, 'source-pi');
  assert.deepEqual(provenance.getLaunchesFrom('source-pi').map(entry => entry.sessionId), ['child-pi']);
  assert.deepEqual(provenance.getLaunchesFrom(sourceAlias).map(entry => entry.sessionId), ['child-pi']);
});

test('broken sidecars and invalid ids degrade safely', () => {
  const file = path.join(home, '.pi', 'dish', 'session-provenance.json');
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(provenance.readLaunches(), {});
  assert.throws(() => provenance.recordLaunch('../bad', 'source', 'op'), /valid session ids/);
});
