// Generated tool from test/session-capabilities.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const session_capabilities_js_1 = require("../lib/session-capabilities.js");
const keys = ['prompt', 'steer', 'followUp', 'abort', 'compact', 'models', 'setModel',
    'setThinking', 'rename', 'commands', 'queueCancel', 'tree', 'export', 'close', 'restart', 'resume'];
function expectEnabled(actual, enabled) {
    assert.deepEqual(Object.keys(actual).sort(), [...keys].sort());
    assert.deepEqual(Object.entries(actual).filter(([, value]) => value === true).map(([key]) => key).sort(), enabled.sort());
    for (const value of Object.values(actual))
        assert.equal(typeof value, 'boolean');
}
test('Pi retains legacy defaults while alternative bridges require exact true', () => {
    for (const value of [undefined, null, 0, 1, '', 'true', 'false', {}, []]) {
        assert.equal((0, session_capabilities_js_1.bridgeSupports)('pi', { prompt: value }, 'prompt'), true);
        for (const harness of ['omp', 'prime'])
            assert.equal((0, session_capabilities_js_1.bridgeSupports)(harness, { prompt: value }, 'prompt'), false);
    }
    for (const harness of ['pi', 'omp', 'prime']) {
        assert.equal((0, session_capabilities_js_1.bridgeSupports)(harness, { prompt: false }, 'prompt'), false);
        assert.equal((0, session_capabilities_js_1.bridgeSupports)(harness, { prompt: true }, 'prompt'), true);
        assert.equal((0, session_capabilities_js_1.bridgeSupports)(harness, undefined, 'prompt'), harness === 'pi');
        assert.equal((0, session_capabilities_js_1.bridgeSupports)(harness, null, 'prompt'), harness === 'pi');
    }
});
test('inactive projections preserve harness-specific history operations', () => {
    const flags = { prompt: true, rename: false, treeRead: true, treeNavigation: false };
    expectEnabled((0, session_capabilities_js_1.sessionCapabilities)('pi', flags), ['models', 'setModel', 'rename', 'commands', 'tree', 'export', 'resume']);
    expectEnabled((0, session_capabilities_js_1.sessionCapabilities)('omp', flags), ['export', 'resume']);
    expectEnabled((0, session_capabilities_js_1.sessionCapabilities)('prime', flags), ['resume']);
});
test('active projections distinguish absent flags from explicit denials', () => {
    expectEnabled((0, session_capabilities_js_1.sessionCapabilities)('pi', {}, { active: true }), keys.filter(key => !['restart', 'resume'].includes(key)));
    expectEnabled((0, session_capabilities_js_1.sessionCapabilities)('omp', {}, { active: true }), ['export']);
    expectEnabled((0, session_capabilities_js_1.sessionCapabilities)('prime', {}, { active: true }), []);
    expectEnabled((0, session_capabilities_js_1.sessionCapabilities)('prime', { prompt: true, steer: true, models: true, queueCancel: false }, { active: true }), ['prompt', 'steer', 'models']);
    const deniedPi = (0, session_capabilities_js_1.sessionCapabilities)('pi', { prompt: false, treeNavigation: false, rename: false }, { active: true });
    for (const key of ['prompt', 'tree', 'rename'])
        assert.equal(deniedPi[key], false);
});
test('OMP tree requires both live read and navigation; Prime never advertises a tree', () => {
    for (const treeRead of [false, true])
        for (const treeNavigation of [false, true]) {
            const flags = { treeRead, treeNavigation };
            assert.equal((0, session_capabilities_js_1.sessionCapabilities)('omp', flags, { active: true }).tree, treeRead && treeNavigation);
            assert.equal((0, session_capabilities_js_1.sessionCapabilities)('prime', flags, { active: true }).tree, false);
        }
});
test('close and restart advice requires active state and separate ownership inputs', () => {
    for (const harness of ['pi', 'omp', 'prime']) {
        const allowed = (0, session_capabilities_js_1.sessionCapabilities)(harness, {}, { active: true, closeAllowed: true, restartAllowed: true });
        assert.equal(allowed.close, true);
        assert.equal(allowed.restart, true);
        const inactive = (0, session_capabilities_js_1.sessionCapabilities)(harness, {}, { closeAllowed: true, restartAllowed: true });
        assert.equal(inactive.close, false);
        assert.equal(inactive.restart, false);
        // Deliberately extra wire flags cannot grant lifecycle ownership.
        const unownedFlags = { close: true, restart: true };
        const unowned = (0, session_capabilities_js_1.sessionCapabilities)(harness, unownedFlags, { active: true });
        assert.equal(unowned.close, harness === 'pi', 'bridge flags cannot grant managed lifecycle authority');
        assert.equal(unowned.restart, false);
    }
});
test('a registry conflict denies every projected operation, including history and lifecycle', () => {
    const flags = Object.fromEntries(keys.map(key => [key, true]));
    for (const harness of ['pi', 'omp', 'prime'])
        for (const active of [true, false]) {
            expectEnabled((0, session_capabilities_js_1.sessionCapabilities)(harness, flags, { active, conflicted: true, closeAllowed: true, restartAllowed: true }), []);
        }
});
