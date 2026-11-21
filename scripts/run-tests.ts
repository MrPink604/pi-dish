#!/usr/bin/env node
/**
 * `npm test` — node:test launched from a sanitized environment. The operator's
 * shell exports the running deployment's HOST/PORT/share port, which suites that
 * boot server.js would inherit. Done here once, rather than through NODE_OPTIONS,
 * which would also re-enter this file inside spawned pi/omp children and strip
 * the bridge's own PI_DISH_SOCKET_DIR/PI_DISH_SPAWN_TOKEN.
 */
import fs = require('fs');
import path = require('path');
import { spawn } from 'child_process';
import { createTestTempDir, fakeOmpModelsCommand, sanitizeTestEnv } from '../test/test-env.js';

const repo = path.dirname(__dirname);
const argv = process.argv.slice(2);
const flags = argv.filter((arg) => arg.startsWith('-'));
const files = argv.filter((arg) => !arg.startsWith('-'));

if (!files.length) {
  files.push(...fs.readdirSync(path.join(repo, 'test'))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join('test', name)));
}

// All test files and their children allocate inside this owned run directory,
// including fixtures that don't otherwise import test-env.
process.env.TMPDIR = createTestTempDir('pd-test-');
const env = sanitizeTestEnv();
env.PI_DISH_OMP_COMMAND ??= fakeOmpModelsCommand;
const ownGroup = process.platform !== 'win32';
const child = spawn(process.execPath, ['--test', ...flags, ...files], {
  cwd: repo,
  env,
  detached: ownGroup,
  stdio: 'inherit',
});
// Node's test coordinator and its workers must stop together. Wait for the
// coordinator's exit before removing their shared TMPDIR.
let interrupted: number | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  interrupted = signal === 'SIGINT' ? 130 : 143;
  if (!ownGroup || !child.pid) { child.kill(signal); return; }
  try { process.kill(-child.pid, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
});
child.on('exit', (code, signal) => process.exit(interrupted ?? (signal ? 1 : code ?? 1)));
