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
import { sanitizeTestEnv } from '../test/test-env.js';

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
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
