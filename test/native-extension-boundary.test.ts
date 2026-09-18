import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { sanitizeTestEnv }: typeof import('./test-env') = require('./test-env')

const execute = promisify(execFile);
const nativeBoundaryHost = path.join(__dirname, 'fixtures', 'native-boundary-host.ts');
const nativeQueueHost = path.join(__dirname, 'fixtures', 'native-queue-boundary-host.ts');

test('native unknown-host guards retain Prime duplicate token adoption', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-native-boundary-'));
  const env = sanitizeTestEnv({ PATH: process.env.PATH, HOME: root, TMUX: '', TMUX_PANE: '' });
  env.PI_DISH_SOCKET_DIR = path.join(root, 'sockets');
  try {
    const result = await execute('bun', [nativeBoundaryHost], { env, cwd: root, timeout: 10000 });
    assert.match(result.stdout, /native boundary passed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Pi malformed queue alignment refuses cancellation without losing display or delivered messages', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-pi-private-'));
  const env = sanitizeTestEnv({ PATH: process.env.PATH, HOME: root, TMUX: '', TMUX_PANE: '' });
  try {
    const result = await execute('bun', [nativeQueueHost], { env, cwd: root, timeout: 10000 });
    assert.match(result.stdout, /Pi malformed queue alignment passed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

export {};
