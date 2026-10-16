// Generated tool from test/runtime-resources.test.ts; edit that source and run npm run build:tools.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const runtime_resources_1 = require("../lib/runtime-resources");
const root = path.resolve('application root');
test('resources resolve from the application root, not lib or cwd', () => {
    for (const resource of ['extensions/pi-dish-bridge-omp/index.ts', 'skills/pi-dish-sessions/scripts/pi-dish-sessions.js', 'lib/session-recovery.js', 'docs/agent/sessions.md']) {
        assert.equal((0, runtime_resources_1.runtimeResourcePath)(root, resource), path.join(root, resource));
    }
});
test('relative resources are normalized against the application root', () => {
    assert.equal((0, runtime_resources_1.runtimeResourcePath)(root, './skills/pi-dish-skill-refine/SKILL.md'), path.join(root, 'skills/pi-dish-skill-refine/SKILL.md'));
    assert.equal((0, runtime_resources_1.runtimeResourcePath)(root, 'skills/../docs/agent/sessions.md'), path.join(root, 'docs/agent/sessions.md'));
});
