'use strict';

import test = require('node:test');
import assert = require('node:assert/strict');
import path = require('node:path');
import { runtimeResourcePath } from '../lib/runtime-resources';

const root = path.resolve('application root');

test('resources resolve from the application root, not lib or cwd', () => {
  for (const resource of ['extensions/pi-dish-bridge-omp/index.ts', 'skills/pi-dish-sessions/scripts/pi-dish-sessions.js', 'lib/session-recovery.js', 'docs/agent/sessions.md']) {
    assert.equal(runtimeResourcePath(root, resource), path.join(root, resource));
  }
});

test('relative resources are normalized against the application root', () => {
  assert.equal(runtimeResourcePath(root, './skills/pi-dish-skill-refine/SKILL.md'),
    path.join(root, 'skills/pi-dish-skill-refine/SKILL.md'));
  assert.equal(runtimeResourcePath(root, 'skills/../docs/agent/sessions.md'), path.join(root, 'docs/agent/sessions.md'));
});
