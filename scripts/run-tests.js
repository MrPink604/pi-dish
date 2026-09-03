#!/usr/bin/env node
/**
 * `npm test` — the node:test runner, launched from a sanitized environment.
 *
 * The sanitizing (test/test-env.js) is the point: the operator's shell exports
 * the running deployment's HOST/PORT/share port, and suites that boot
 * server.js inherit them. Doing it here, once, means every test child *and*
 * every process a suite spawns starts clean, without NODE_OPTIONS (which
 * would also re-enter this file inside spawned pi/omp children and strip the
 * bridge's own PI_DISH_SOCKET_DIR/PI_DISH_SPAWN_TOKEN).
 *
 * Usage: `npm test`, `npm test -- test/server.test.js`,
 * `npm test -- --test-name-pattern=subagent`.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { sanitizeTestEnv } = require('../test/test-env');

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

const child = spawn(process.execPath, ['--test', ...flags, ...files], {
  cwd: repo,
  env: sanitizeTestEnv(process.env),
  stdio: 'inherit',
});
// Relay interrupts so Ctrl-C stops the run rather than orphaning it.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
