// Generated test/tool from test/session-discovery.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const test_types_js_1 = require("./test-types.js");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { discoverSessionCandidates, discoverSubsessionCandidates, findSessionCandidate, readSessionHeader, } = require('../lib/session-discovery');
const { registry } = require('../lib/harnesses');
const { encodeSessionKey } = require('../lib/session-key');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-discovery-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function write(file, header) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(header) + '\n');
}
test('discovers traditional and nested generic Pi sessions with compatible identities', () => {
    const sessions = path.join(root, 'sessions-a');
    const workspace = path.join(sessions, '--workspace--');
    write(path.join(workspace, '2026-01-01_parent.jsonl'), { type: 'session', id: 'core-parent', cwd: '/workspace' });
    write(path.join(workspace, '2026-01-01_parent', 'scope', 'run-0', 'session.jsonl'), {
        type: 'session', id: 'core-child', cwd: '/workspace', parentSession: path.join(workspace, '2026-01-01_parent.jsonl'),
    });
    write(path.join(workspace, 'bad', 'session.jsonl'), { type: 'message', id: 'not-a-header' });
    write(path.join(workspace, 'scope', 'events.jsonl'), { type: 'session', id: 'not-a-session-artifact' });
    const result = discoverSessionCandidates(sessions);
    assert.deepEqual(result.candidates.map((c) => c.nativeSessionId), ['2026-01-01_parent', 'core-child']);
    assert.equal(result.truncated, false);
    const child = (0, test_types_js_1.present)(result.candidates.find((c) => c.nativeSessionId === 'core-child'));
    assert.equal(child.depth, 3);
    assert.equal(child.routeId, 'core-child');
    assert.equal(child.sessionKey, encodeSessionKey('pi', (0, test_types_js_1.nativeId)('core-child')));
    assert.equal((0, test_types_js_1.present)(readSessionHeader(child.file)).parentSession, path.join(workspace, '2026-01-01_parent.jsonl'));
    assert.equal((0, test_types_js_1.present)(findSessionCandidate(sessions, 'core-child', { allowPartial: false }).candidate).file, child.file);
});
test('discovers OMP sibling-directory subsessions without loosening Pi discovery', () => {
    const sessions = path.join(root, 'sessions-omp-subagents');
    const workspace = path.join(sessions, 'workspace');
    const parent = path.join(workspace, 'root-session.jsonl');
    const child = path.join(workspace, 'root-session', 'Explore.jsonl');
    const grandchild = path.join(workspace, 'root-session', 'Explore', 'Helper.jsonl');
    write(parent, { type: 'session', id: 'root-session', cwd: '/workspace' });
    write(child, { type: 'session', id: 'omp-child-id', cwd: '/workspace' });
    write(grandchild, { type: 'session', id: 'omp-grandchild-id', cwd: '/workspace' });
    write(path.join(workspace, 'artifacts', 'events.jsonl'), {
        type: 'session', id: 'not-under-a-session', cwd: '/workspace',
    });
    const omp = discoverSessionCandidates(sessions, { descriptor: registry.omp });
    assert.deepEqual(omp.candidates.map((candidate) => candidate.nativeSessionId), [
        'root-session', 'omp-child-id', 'omp-grandchild-id',
    ]);
    assert.equal((0, test_types_js_1.present)(omp.candidates.find((candidate) => candidate.nativeSessionId === 'omp-child-id')).parentSession, parent);
    assert.equal((0, test_types_js_1.present)(omp.candidates.find((candidate) => candidate.nativeSessionId === 'omp-grandchild-id')).parentSession, child);
    assert.equal(omp.candidates.some((candidate) => candidate.nativeSessionId === 'not-under-a-session'), false);
    const pi = discoverSessionCandidates(sessions, { descriptor: registry.pi });
    assert.deepEqual(pi.candidates.map((candidate) => candidate.nativeSessionId), ['root-session'], 'arbitrarily named nested JSONLs remain excluded from Pi');
});
test('discovery revalidates shared parent headers and same-size replaced child identities', () => {
    const sessions = path.join(root, 'sessions-parent-revalidation');
    const parent = path.join(sessions, 'workspace', 'parent.jsonl');
    const child = path.join(sessions, 'workspace', 'parent', 'agent.jsonl');
    write(parent, { type: 'session', id: 'parent' });
    write(child, { type: 'session', id: 'child-a' });
    const stamp = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(child, stamp, stamp);
    const scan = () => discoverSessionCandidates(sessions, { descriptor: registry.omp }).candidates.map(candidate => candidate.nativeSessionId);
    assert.ok(scan().includes((0, test_types_js_1.nativeId)('child-a')));
    write(child + '.new', { type: 'session', id: 'child-b' });
    fs.utimesSync(child + '.new', stamp, stamp);
    fs.renameSync(child + '.new', child);
    assert.ok(scan().includes((0, test_types_js_1.nativeId)('child-b')));
    assert.ok(!scan().includes((0, test_types_js_1.nativeId)('child-a')));
    write(parent, { type: 'message', id: 'parent' });
    assert.deepEqual(scan(), ['parent'], 'a no-longer-valid parent cannot keep children discoverable');
});
test('discovers Prime RLM subagents under session-artifacts, recursively', () => {
    const agentDir = path.join(root, 'prime-agent');
    const sessions = path.join(agentDir, 'sessions');
    const artifacts = path.join(agentDir, 'session-artifacts');
    const rootFile = path.join(sessions, 'prime-root-id.jsonl');
    const childFile = path.join(artifacts, 'prime-root-id', 'sub-a1b2c3d4', 'prime-child-id.jsonl');
    const grandchildFile = path.join(artifacts, 'prime-root-id', 'session-artifacts', 'prime-child-id', 'sub-e5f6a7b8', 'prime-grandchild-id.jsonl');
    const orphanFile = path.join(artifacts, 'prime-root-id', 'sub-ff00ff00', 'prime-orphan-id.jsonl');
    write(rootFile, { type: 'session', id: 'prime-root-id', cwd: '/workspace' });
    write(childFile, { type: 'session', id: 'prime-child-id', cwd: '/workspace', parentSession: rootFile, rlmDepth: 1 });
    write(grandchildFile, { type: 'session', id: 'prime-grandchild-id', cwd: '/workspace', parentSession: childFile, rlmDepth: 2 });
    // Pre-ledger children had no header edge; the first-generation path names
    // the root parent instead.
    write(orphanFile, { type: 'session', id: 'prime-orphan-id', cwd: '/workspace', rlmDepth: 1 });
    // Bookkeeping artifacts share the tree but are not sessions.
    write(path.join(artifacts, 'prime-root-id', 'semantic-edges.jsonl'), { type: 'edge', from: 'a', to: 'b' });
    write(path.join(artifacts, 'prime-root-id', 'rlm-subagents.jsonl'), { type: 'rlm_subagent', sessionFile: childFile });
    const prime = discoverSessionCandidates(sessions, { descriptor: registry.prime });
    assert.deepEqual(prime.candidates.map((candidate) => candidate.nativeSessionId).sort(), [
        'prime-child-id', 'prime-grandchild-id', 'prime-orphan-id', 'prime-root-id',
    ]);
    const byId = new Map(prime.candidates.map((candidate) => [candidate.nativeSessionId, candidate]));
    assert.equal((0, test_types_js_1.present)(byId.get('prime-child-id')).parentSession, rootFile);
    assert.equal((0, test_types_js_1.present)(byId.get('prime-grandchild-id')).parentSession, childFile);
    assert.equal((0, test_types_js_1.present)(byId.get('prime-orphan-id')).parentSession, rootFile, 'first-generation path fallback names the root parent');
    assert.equal((0, test_types_js_1.present)(byId.get('prime-child-id')).sessionKey, encodeSessionKey('prime', (0, test_types_js_1.nativeId)('prime-child-id')));
    // The live-parent probe reaches the same subtree from the parent file alone.
    const probe = discoverSubsessionCandidates(rootFile, { descriptor: registry.prime });
    assert.deepEqual(probe.map((candidate) => candidate.nativeSessionId).sort(), ['prime-child-id', 'prime-grandchild-id', 'prime-orphan-id']);
    // Other harnesses never treat the artifacts tree as sessions.
    const pi = discoverSessionCandidates(sessions, { descriptor: registry.pi });
    assert.deepEqual(pi.candidates, [], 'pi discovery ignores a prime artifacts tree');
    assert.deepEqual(discoverSubsessionCandidates(rootFile, { descriptor: registry.omp }), [], 'OMP subsession probing does not apply to the prime artifacts shape');
});
test('bounded discovery skips over-depth directories, symlinks, and reports caps', () => {
    const sessions = path.join(root, 'sessions-b');
    const workspace = path.join(sessions, '--workspace--');
    write(path.join(workspace, 'one.jsonl'), { type: 'session', id: 'one' });
    write(path.join(workspace, 'a', 'b', 'session.jsonl'), { type: 'session', id: 'deep' });
    const outside = path.join(root, 'outside');
    write(path.join(outside, 'session.jsonl'), { type: 'session', id: 'linked' });
    fs.mkdirSync(workspace, { recursive: true });
    try {
        fs.symlinkSync(outside, path.join(workspace, 'linked'), 'dir');
    }
    catch { }
    const shallow = discoverSessionCandidates(sessions, { maxDepth: 1 });
    assert.deepEqual(shallow.candidates.map((c) => c.nativeSessionId), ['one']);
    const capped = discoverSessionCandidates(sessions, { maxFiles: 1 });
    assert.equal(capped.candidates.length, 1);
    assert.equal(capped.truncated, true);
    const entryCapped = discoverSessionCandidates(sessions, { maxEntries: 1 });
    assert.equal(entryCapped.truncated, true);
    assert.equal(capped.candidates.some((c) => c.nativeSessionId === 'linked'), false);
});
test('generic header cache reuses positive and negative results', () => {
    const sessions = path.join(root, 'sessions-cache');
    const workspace = path.join(sessions, '--workspace--');
    write(path.join(workspace, 'a', 'session.jsonl'), { type: 'session', id: 'cached-good' });
    write(path.join(workspace, 'b', 'session.jsonl'), { type: 'message', id: 'cached-negative' });
    const oversized = path.join(workspace, 'c', 'session.jsonl');
    fs.mkdirSync(path.dirname(oversized), { recursive: true });
    fs.writeFileSync(oversized, JSON.stringify({ type: 'session', id: 'x'.repeat(20 * 1024) }) + '\n');
    discoverSessionCandidates(sessions);
    const originalOpen = fs.openSync;
    let opens = 0;
    fs.openSync = (...args) => { opens += 1; return originalOpen(...args); };
    try {
        discoverSessionCandidates(sessions);
    }
    finally {
        fs.openSync = originalOpen;
    }
    assert.equal(opens, 0, 'unchanged generic headers are not reopened on the next scan');
});
test('generic session header ids are path-safe and duplicate ids are not routable', () => {
    const sessions = path.join(root, 'sessions-c');
    const workspace = path.join(sessions, '--workspace--');
    write(path.join(workspace, 'z', 'session.jsonl'), { type: 'session', id: '../escape' });
    write(path.join(workspace, 'b', 'session.jsonl'), { type: 'session', id: 'same' });
    write(path.join(workspace, 'a', 'session.jsonl'), { type: 'session', id: 'same' });
    const result = discoverSessionCandidates(sessions);
    assert.equal(result.candidates.length, 0, 'unsafe and ambiguous native identities are omitted');
    assert.equal(findSessionCandidate(sessions, 'same', { allowPartial: false }).candidate, null);
});
test('invalid basename identities are skipped and warned once without aborting discovery', () => {
    const sessions = path.join(root, 'sessions-invalid-basename');
    const workspace = path.join(sessions, '--workspace--');
    write(path.join(workspace, 'valid-session.jsonl'), { type: 'session', cwd: '/workspace' });
    write(path.join(workspace, '2026-01-01T00-00-00+00-00_deadbeef.jsonl'), { type: 'session', cwd: '/workspace' });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
        const first = discoverSessionCandidates(sessions);
        assert.deepEqual(first.candidates.map((c) => c.nativeSessionId), ['valid-session']);
        assert.equal(first.skipped, 1);
        assert.equal(first.truncated, false);
        assert.equal(discoverSessionCandidates(sessions).skipped, 1, 'each scan reports its skipped count');
    }
    finally {
        console.warn = originalWarn;
    }
    assert.equal(warnings.length, 1, 'a repeatedly scanned alien file does not spam logs');
    assert.match(String((0, test_types_js_1.present)(warnings[0])), /skipping invalid pi identity/);
});
test('subsession discovery mirrors the corpus walk within one session subtree', () => {
    // The Active tab's live-subagent rows come from this walk, so it has to
    // agree with the corpus walk on identity, symlinks and ambiguity — a row it
    // emits that route lookup then refuses would 404 on click.
    const sessions = path.join(root, 'sessions-subsessions');
    const workspace = path.join(sessions, 'workspace');
    const parent = path.join(workspace, 'root-session.jsonl');
    write(parent, { type: 'session', id: 'root-session', cwd: '/workspace' });
    write(path.join(workspace, 'root-session', 'Explore.jsonl'), { type: 'session', id: 'sub-explore', cwd: '/workspace' });
    write(path.join(workspace, 'root-session', 'Explore', 'Helper.jsonl'), { type: 'session', id: 'sub-helper', cwd: '/workspace' });
    write(path.join(workspace, 'root-session', 'notes.txt.jsonl'), { type: 'message', id: 'not-a-header' });
    write(path.join(workspace, 'other-session.jsonl'), { type: 'session', id: 'other-session', cwd: '/workspace' });
    const found = discoverSubsessionCandidates(parent, { descriptor: registry.omp });
    assert.deepEqual(found.map((candidate) => candidate.nativeSessionId).sort(), ['sub-explore', 'sub-helper'], 'only the parent’s own subtree, and only real session headers');
    assert.equal(found.every((candidate) => candidate.harnessId === 'omp'
        && candidate.routeId === encodeSessionKey('omp', (0, test_types_js_1.nativeId)(candidate.nativeSessionId))), true);
    assert.equal((0, test_types_js_1.present)(found.find((candidate) => candidate.nativeSessionId === 'sub-explore')).parentSession, parent);
    assert.deepEqual(discoverSubsessionCandidates(parent, { descriptor: registry.pi }), [], 'a harness without nested subsessions has none');
    // A copied/restored tree: two files claim one header id, so neither routes.
    write(path.join(workspace, 'root-session', 'Copy.jsonl'), { type: 'session', id: 'sub-explore', cwd: '/workspace' });
    assert.deepEqual(discoverSubsessionCandidates(parent, { descriptor: registry.omp }).map((c) => c.nativeSessionId), ['sub-helper'], 'ambiguous header ids are omitted rather than routed arbitrarily');
    fs.rmSync(path.join(workspace, 'root-session', 'Copy.jsonl'));
    // A symlinked agent directory would enumerate files outside the root.
    const outside = path.join(root, 'subsession-outside');
    write(path.join(outside, 'Sneaky.jsonl'), { type: 'session', id: 'sub-outside', cwd: '/workspace' });
    write(path.join(workspace, 'root-session', 'Linked.jsonl'), { type: 'session', id: 'sub-linked', cwd: '/workspace' });
    let linked = false;
    try {
        fs.symlinkSync(outside, path.join(workspace, 'root-session', 'Linked'), 'dir');
        linked = true;
    }
    catch { }
    const afterLink = discoverSubsessionCandidates(parent, { descriptor: registry.omp }).map((c) => c.nativeSessionId);
    assert.equal(afterLink.includes((0, test_types_js_1.nativeId)('sub-linked')), true, 'the file itself is still a session');
    if (linked)
        assert.equal(afterLink.includes((0, test_types_js_1.nativeId)('sub-outside')), false, 'symlinked agent directories are not followed');
    assert.equal(discoverSubsessionCandidates(parent, { descriptor: registry.omp, maxFiles: 1 }).length, 1);
    assert.deepEqual(discoverSubsessionCandidates(parent, { descriptor: registry.omp, maxDepth: 1 }).map((c) => c.nativeSessionId).sort(), ['sub-explore', 'sub-linked'], 'depth bounds the subtree walk');
});
test('profile overrides and native-id exclusions retain descriptor-owned identity validation', () => {
    const sessions = path.join(root, 'sessions-profile-options');
    const file = path.join(sessions, 'workspace', 'run', 'session.jsonl');
    write(file, { type: 'session', id: 'native' });
    const options = { descriptor: registry.omp, profileId: 'custom-profile', profileVersion: 0 };
    const candidate = (0, test_types_js_1.present)(discoverSessionCandidates(sessions, options).candidates[0]);
    assert.equal(candidate.nativeSessionId, 'native');
    assert.equal(candidate.profileId, 'custom-profile');
    assert.equal(candidate.profileVersion, 0);
    assert.equal(candidate.routeId, encodeSessionKey('omp', (0, test_types_js_1.nativeId)('native')));
    const exclusionSets = [[(0, test_types_js_1.nativeId)('native')], new Set([(0, test_types_js_1.nativeId)('native')])];
    for (const excludeIds of exclusionSets) {
        assert.deepEqual(discoverSessionCandidates(sessions, { ...options, excludeIds }).candidates, []);
    }
    fs.writeFileSync(file, [
        { type: 'title', title: 'OMP-only header framing' },
        { type: 'session', id: 'later-native' },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    assert.equal((0, test_types_js_1.present)(discoverSessionCandidates(sessions, options).candidates[0]).nativeSessionId, 'later-native');
    assert.deepEqual(discoverSessionCandidates(sessions, {
        descriptor: registry.pi, profileId: 'omp-v1',
    }).candidates, [], 'a parser output profile override cannot loosen the descriptor header identity policy');
});
