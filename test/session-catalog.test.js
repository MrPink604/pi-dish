// Generated test/tool from test/session-catalog.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const test_types_js_1 = require("./test-types.js");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registry } = require('../lib/harnesses');
const { sessionCapabilities } = require('../lib/session-capabilities');
const { encodeSessionKey } = require('../lib/session-key');
const { sourceForIdentity } = require('../lib/session-source');
const { sessionForClient } = require('../lib/session-api');
const { registeredSessionObservation, rpcSessionObservation, decodeLaunchParents, decodeRoutineAnnotations, withSessionContext, buildActiveSession, buildSourceSession, buildHistoricalSession, composeSessionCatalog, } = require('../lib/session-catalog');
const options = {
    harnesses: new Map([registry.pi, registry.omp, registry.prime].map(harness => [harness.id, harness])),
    contextWindowForModel: () => 1000,
    canonicalPath: (file) => file ? path.resolve(file) : null,
    directoryExists: () => false,
};
function source(harnessId = 'pi', nativeSessionId = (0, test_types_js_1.nativeId)('native'), extras = {}) {
    return { ...sourceForIdentity(harnessId, nativeSessionId, `/catalog-fixture/${nativeSessionId}.jsonl`), ...extras };
}
function info(extras = {}) {
    return { model: 'historical/model', name: 'History name', messageCount: 5, contextTokens: 200,
        lastActivity: new Date('2026-01-01T01:00:00Z'), cwd: '/workspace', sessionId: 'header', parentSession: null, ...extras };
}
function advice(harnessId = 'pi', active = false, extras = {}) {
    const descriptor = registry[harnessId];
    return { capabilities: sessionCapabilities(harnessId, {}, { active }), closeMode: descriptor.closeMode,
        conflicted: false, liveInstanceCount: 1, ...extras };
}
function context(src, metadata = info(), overrides = {}) {
    return { harnessId: src.harnessId, nativeSessionId: src.nativeSessionId,
        source: src, info: metadata, advice: advice(src.harnessId, true), ...overrides };
}
function history(src, metadata = info(), overrides = {}) {
    const candidate = { ...src, dirName: '--workspace--', depth: 0, identitySource: 'basename' };
    return { source: candidate, info: metadata, liveChild: false, advice: advice(src.harnessId), ...overrides };
}
function compose(input = {}, customOptions = {}) {
    return composeSessionCatalog({ active: [], history: [], launchParents: new Map(), routines: new Map(),
        indexing: false, discoveryTruncated: false, discoverySkipped: 0, activeOnly: false, ...input }, { ...options, ...customOptions });
}
test('registered catalog projection retains live usage, metadata fallback and lifecycle advice', () => {
    const src = source('omp', (0, test_types_js_1.nativeId)('child'), { parentSession: '/catalog-fixture/parent.jsonl' });
    const metadata = Object.freeze(info());
    const policy = advice('omp', true, { conflicted: true, liveInstanceCount: 2,
        capabilities: sessionCapabilities('omp', {}, { active: true, conflicted: true }) });
    const captured = registeredSessionObservation({
        name: '', model: '', sessionFile: src.file, contextUsage: { tokens: 0, percent: 0, contextWindow: 2000 },
        thinkingLevel: '', cwd: '', updatedAt: '2026-02-02', turnInProgress: false, compacting: false, pid: 42,
        capabilities: { resume: true }, parentId: 'forged', routine: 'forged',
    }, context(src, metadata, { advice: policy }));
    const row = buildActiveSession(captured, options);
    assert.equal(row.id, encodeSessionKey('omp', (0, test_types_js_1.nativeId)('child')));
    assert.equal(row.name, 'History name');
    assert.equal(row.model, 'historical/model');
    assert.equal(row.contextTokens, 0);
    assert.equal(row.contextPercent, 0);
    assert.equal(row.contextWindow, 2000);
    assert.equal(row.cwd, '/workspace');
    assert.equal(row.thinkingLevel, null);
    assert.equal(row.messageCount, 5);
    assert.equal(row.lastActivity, metadata.lastActivity);
    assert.equal(row.parentSession, src.parentSession);
    assert.equal(row.parentSessionSource, 'omp-subsession-layout');
    assert.equal(row.conflicted, true);
    assert.equal(row.liveInstanceCount, 2);
    assert.deepEqual(row.capabilities, policy.capabilities);
    assert.equal(row.parentId, undefined);
    assert.equal(row.routine, undefined);
    assert.equal(metadata.contextTokens, 200, 'projection does not mutate borrowed index metadata');
    const nativeParent = buildActiveSession(registeredSessionObservation({ sessionFile: src.file }, context(src, info({ parentSession: '/native/parent.jsonl' }))), options);
    assert.equal(nativeParent.parentSession, '/native/parent.jsonl');
    assert.equal(nativeParent.parentSessionSource, null);
});
test('pending-history claims and stable timestamps survive; mismatched source observations are rejected', () => {
    const src = source('omp');
    const captured = registeredSessionObservation({ sessionFile: src.file, updatedAt: '2026-02-02T01:00:00Z' }, context(src, null, { source: null }));
    const row = buildActiveSession(captured, options);
    assert.equal(row.sessionFile, src.file);
    assert.equal(row.name, 'New Session');
    assert.equal(row.model, 'unknown');
    assert.equal(row.lastActivity, '2026-02-02T01:00:00Z');
    const empty = buildActiveSession(registeredSessionObservation({}, context(src, null, { source: null })), options);
    assert.deepEqual(empty.lastActivity, new Date(0));
    assert.equal(empty.sessionFile, null);
    assert.throws(() => registeredSessionObservation({ sessionFile: '/different.jsonl' }, context(src)), /does not match/);
    assert.throws(() => registeredSessionObservation({ sessionFile: src.file }, context(src, info(), { nativeSessionId: (0, test_types_js_1.nativeId)('different') })), /does not match/);
});
test('RPC projection keeps state/model authority instead of inheriting historical name, usage or cwd', () => {
    const src = source();
    const captured = rpcSessionObservation({ state: { sessionFile: src.file, name: '', messageCount: 0,
            model: { provider: 'live', id: 'model', contextWindow: 4096 }, thinkingLevel: 'high' },
        lastStats: { contextUsage: { percent: 12.345, tokens: 0 } }, lastActivityAt: 0,
        cwd: '', turnInProgress: true, compacting: false, proc: { pid: 123 } }, context(src, info({ parentSession: '/native/parent.jsonl' })));
    const row = buildActiveSession(captured, options);
    assert.equal(row.name, 'New Session');
    assert.equal(row.model, 'live/model');
    assert.equal(row.messageCount, 0);
    assert.equal(row.contextTokens, 0);
    assert.equal(row.contextPercent, 12.3);
    assert.equal(row.contextWindow, 4096);
    assert.equal(row.lastActivity, 0);
    assert.equal(row.cwd, null);
    assert.equal(row.turnInProgress, true);
    assert.equal(row.parentSession, '/native/parent.jsonl');
    const fallback = buildActiveSession(rpcSessionObservation({ state: { sessionFile: src.file },
        model: { provider: 'fallback', modelId: 'model' } }, context(src)), options);
    assert.equal(fallback.model, 'fallback/model');
    assert.equal(fallback.contextTokens, 0);
    assert.equal(fallback.contextWindow, 0);
});
test('unknown live fields are narrowed once and cannot inject row identity or advice', () => {
    const src = source();
    const captured = registeredSessionObservation({ sessionFile: src.file, name: 12, model: {}, cwd: [], pid: Infinity,
        contextUsage: { tokens: '200', percent: NaN, contextWindow: false },
        updatedAt: {}, turnInProgress: 'true', compacting: 1, id: 'forged', harnessId: 'omp' }, context(src, null));
    const row = buildActiveSession(captured, options);
    assert.equal(row.id, 'native');
    assert.equal(row.harnessId, 'pi');
    assert.equal(row.name, 'New Session');
    assert.equal(row.model, 'unknown');
    assert.equal(row.pid, null);
    assert.equal(row.contextPercent, 0);
    assert.equal(row.contextTokens, 0);
    assert.equal(row.turnInProgress, false);
    assert.equal(row.compacting, false);
    assert.deepEqual(row.lastActivity, new Date(0));
});
test('history and live children share projection while preserving naming, cwd fallback and resume gates', () => {
    const src = source('omp', (0, test_types_js_1.nativeId)('header-child'), { file: '/catalog-fixture/parent/Explore.jsonl', parentSession: '/catalog-fixture/parent.jsonl' });
    const row = buildHistoricalSession(history(src, info({ cwd: null }), { liveChild: true }), options);
    assert.equal(row.name, 'Explore');
    assert.equal(row.subagentLive, true);
    assert.equal(row.isActive, false);
    assert.equal((0, test_types_js_1.present)(row.capabilities).resume, false);
    assert.equal(row.turnInProgress, undefined);
    assert.equal(row.contextWindow, undefined, 'historical API retains its existing window omission');
    assert.equal(row.parentSessionSource, 'omp-subsession-layout');
    const generic = { ...src, file: '/catalog-fixture/parent/session.jsonl' };
    assert.equal(buildSourceSession(generic, info(), advice('omp'), options).name, 'History name');
    const piHistory = history(source(), info({ name: '', cwd: null }));
    const existing = { ...options, directoryExists: (cwd) => cwd === '/workspace' };
    assert.equal(buildHistoricalSession(piHistory, existing).cwd, '/workspace');
    assert.equal(buildHistoricalSession(piHistory, existing).name, 'native');
    assert.equal(buildSourceSession(piHistory.source, piHistory.info, piHistory.advice, existing).cwd, null);
    assert.equal(buildHistoricalSession(piHistory, existing, { cwdFallback: false }).cwd, null);
});
test('catalog deduplicates live/history, preserves active-only child ordering and discovery flags', () => {
    const src = source();
    const registered = registeredSessionObservation({ sessionFile: src.file, name: 'Bridge' }, context(src));
    const rpc = rpcSessionObservation({ sessionFile: src.file, state: { name: 'RPC' } }, context(src));
    const child = history(source('omp', (0, test_types_js_1.nativeId)('child')), info({ lastActivity: new Date('2026-02-01') }), { liveChild: true });
    const older = history(source('prime', (0, test_types_js_1.nativeId)('older')), info({ lastActivity: new Date('2025-01-01') }));
    const input = { active: [rpc, registered], history: [older, history(src), child],
        indexing: true, discoveryTruncated: true, discoverySkipped: 3 };
    const full = compose(input);
    assert.deepEqual(full.list.map((row) => row.nativeSessionId), ['native', 'child', 'older']);
    assert.equal((0, test_types_js_1.present)(full.active[0]).name, 'Bridge');
    assert.equal((0, test_types_js_1.present)((0, test_types_js_1.present)(full.previous[0]).capabilities).resume, false);
    assert.equal(full.children.length, 0);
    assert.equal(full.byId.get(src.routeId), full.active[0]);
    assert.equal(full.byPath.get(src.file), full.active[0]);
    assert.equal(full.indexing, true);
    assert.equal(full.discoveryTruncated, true);
    assert.equal(full.discoverySkipped, 3);
    const activeOnly = compose({ ...input, activeOnly: true });
    assert.equal(activeOnly.previous.length, 0);
    assert.deepEqual(activeOnly.children.map((row) => row.nativeSessionId), ['child']);
});
test('native canonical lineage precedes launch hints, self parents are suppressed and routines remain annotations', () => {
    const parent = source('pi', (0, test_types_js_1.nativeId)('parent'));
    const child = source('omp', (0, test_types_js_1.nativeId)('child'));
    const other = source('prime', (0, test_types_js_1.nativeId)('other'));
    const detached = source('pi', (0, test_types_js_1.nativeId)('detached'));
    const self = source('pi', (0, test_types_js_1.nativeId)('self'));
    const launchParents = decodeLaunchParents({
        [child.routeId]: { sourceSessionId: other.routeId },
        [detached.routeId]: { sourceSessionId: parent.routeId },
        [self.routeId]: { sourceSessionId: self.routeId },
    });
    const routines = decodeRoutineAnnotations(new Map([[child.routeId, { routineName: 'Nightly', routineId: 'routine', id: 'invocation' }]]));
    const result = compose({ history: [history(parent),
            history(child, info({ parentSession: './parent.jsonl' })),
            history(other, info({ cwd: '/elsewhere' })), history(detached, info({ cwd: '/elsewhere' })), history(self)],
        launchParents, routines });
    const row = (0, test_types_js_1.present)(result.byId.get(child.routeId));
    assert.equal(row.parentId, parent.routeId);
    assert.equal(row.parentSource, 'pi-session-header');
    assert.equal(row.familyParentId, parent.routeId);
    assert.equal(row.routine, 'Nightly');
    assert.equal(row.routineId, 'routine');
    assert.equal(row.routineInvocationId, 'invocation');
    assert.equal((0, test_types_js_1.present)(result.byId.get(detached.routeId)).parentSource, 'pi-dish-launch');
    assert.equal((0, test_types_js_1.present)(result.byId.get(detached.routeId)).familyParentId, null);
    assert.equal((0, test_types_js_1.present)(result.byId.get(self.routeId)).parentId, null);
    assert.equal((0, test_types_js_1.present)(result.byId.get(parent.routeId)).routine, undefined);
    assert.equal((0, test_types_js_1.present)(result.byId.get(other.routeId)).parentId, null);
    assert.equal('sessionFile' in sessionForClient(row), false);
    assert.equal(sessionForClient(row).routine, 'Nightly');
});
test('store annotation ingress rejects malformed consumed values and folds encoded Pi aliases', () => {
    const parents = decodeLaunchParents({ [encodeSessionKey('pi', (0, test_types_js_1.nativeId)('child'))]: { sourceSessionId: encodeSessionKey('pi', (0, test_types_js_1.nativeId)('parent')) },
        malformed: { sourceSessionId: '../escape' }, ignored: null });
    assert.deepEqual([...parents], [['child', 'parent']]);
    const routines = decodeRoutineAnnotations(new Map([
        [encodeSessionKey('pi', (0, test_types_js_1.nativeId)('child')), { routineName: '', routineId: '', id: '' }],
        ['bad', { routineName: 123, routineId: 'routine', id: 'invocation' }],
        ['../escape', { routineName: 'Name', routineId: 'routine', id: 'invocation' }],
    ]));
    assert.deepEqual([...routines], [['child', { routine: '', routineId: '', routineInvocationId: '' }]]);
    assert.equal(decodeRoutineAnnotations({}).size, 0);
});
test('context overlays follow the current model window without mutating cached metadata', () => {
    const raw = Object.freeze(info({ contextTokens: 1500 }));
    const first = withSessionContext(raw, () => 1000);
    const warmed = withSessionContext(raw, () => 10000);
    assert.equal(first.contextPercent, 100);
    assert.equal(warmed.contextPercent, 15);
    assert.equal('contextWindow' in raw ? raw.contextWindow : undefined, undefined);
    assert.equal('contextPercent' in raw ? raw.contextPercent : undefined, undefined);
});
