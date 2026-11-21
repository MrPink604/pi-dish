// Generated tool from test/session-provenance.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const session_key_js_1 = require("../lib/session-key.js");
const originalHome = process.env.HOME;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-provenance-'));
process.env.HOME = home;
const provenance = require('../lib/session-provenance.js');
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
    const stored = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'session-provenance.json'), 'utf8'));
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
    assert.ok((0, session_key_js_1.validSessionId)(sourceNativeId));
    assert.ok((0, session_key_js_1.validSessionId)(childNativeId));
    const source = (0, session_key_js_1.encodeSessionKey)('omp', sourceNativeId);
    const child = (0, session_key_js_1.encodeSessionKey)('prime', childNativeId);
    provenance.recordLaunch(child, source, 'operation-alt');
    assert.equal(provenance.getLaunch(child)?.sourceSessionId, source);
    assert.deepEqual(provenance.getLaunchesFrom(source).map(entry => entry.sessionId), [child]);
});
test('encoded Pi aliases fold into the legacy raw Pi provenance identity', () => {
    const sourceNativeId = 'source-pi';
    const childNativeId = 'child-pi';
    assert.ok((0, session_key_js_1.validSessionId)(sourceNativeId));
    assert.ok((0, session_key_js_1.validSessionId)(childNativeId));
    const sourceAlias = (0, session_key_js_1.encodeSessionKey)('pi', sourceNativeId);
    const childAlias = (0, session_key_js_1.encodeSessionKey)('pi', childNativeId);
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
test('host-qualified encoded routes (such as cross-host bots) persist and localize cleanly', () => {
    const remoteHost = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const botNativeId = '0b0c5a1e-0000-4000-8000-000000000001';
    assert.ok((0, session_key_js_1.validSessionId)(botNativeId));
    const botRoute = (0, session_key_js_1.encodeSessionKey)('bot', botNativeId);
    const qualifiedBot = `${remoteHost}:${botRoute}`;
    assert.equal(provenance.isHostQualified(qualifiedBot), true);
    assert.equal(provenance.isHostQualified(`${remoteHost}:../escape`), false);
    provenance.recordLaunch('remote-worker-1', qualifiedBot, 'op-remote-bot');
    assert.equal(provenance.getLaunch('remote-worker-1')?.sourceSessionId, qualifiedBot);
    assert.deepEqual(provenance.getLaunchesFrom(qualifiedBot).map(entry => entry.sessionId), ['remote-worker-1']);
    // An encoded Pi alias qualified with a remote host folds its route part to raw Pi id.
    const piNativeId = 'source-remote-pi';
    assert.ok((0, session_key_js_1.validSessionId)(piNativeId));
    const qualifiedPiAlias = `${remoteHost}:${(0, session_key_js_1.encodeSessionKey)('pi', piNativeId)}`;
    provenance.recordLaunch('remote-worker-2', qualifiedPiAlias, 'op-remote-pi');
    assert.equal(provenance.getLaunch('remote-worker-2')?.sourceSessionId, `${remoteHost}:${piNativeId}`);
    // Self-qualified bot route strips the local host id on write and read.
    const hostIdentity = require('../lib/host-identity.js');
    const selfHost = hostIdentity.getHostId();
    provenance.recordLaunch('local-worker-1', `${selfHost}:${botRoute}`, 'op-local-bot');
    assert.equal(provenance.getLaunch('local-worker-1')?.sourceSessionId, botRoute);
    assert.deepEqual(provenance.getLaunchesFrom(botRoute).map(entry => entry.sessionId), ['local-worker-1']);
    assert.throws(() => provenance.recordLaunch('bad-child', `${remoteHost}:../escape`, 'op-bad'), /valid session ids/);
});
