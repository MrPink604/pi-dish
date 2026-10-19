/**
 * pi-dish-vault CLI: the aac argv it builds and the envelope the listener
 * decodes — item, fields, reason and the calling session as the approval card
 * shows it. `aac` is a stub that records its argv (AAC_BIN), so nothing here
 * talks to Bitwarden or a relay.
 *
 * Run with: npm test
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import http = require('node:http');
import os = require('node:os');
import path = require('node:path');
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { record } from './test-types.js';

const run = promisify(execFile);
const cli = path.join(__dirname, '..', 'skills', 'pi-dish-vault', 'scripts', 'pi-dish-vault.js');
const PREFIX = 'pidish-vault:v1:';

function setup(t: test.TestContext, withSession: boolean) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-vault-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  if (withSession) {
    const registry = path.join(home, '.pi', 'dish', 'sessions');
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, 'a.json'), JSON.stringify({
      sessionId: '01a0a845-cc06-772e-9e2c-51ae78b25cf6', pid: process.pid, cwd: '/nowhere', name: 'Htpc provision', updatedAt: new Date().toISOString(),
    }));
  }
  const argvLog = path.join(home, 'aac-argv.json');
  const aac = path.join(home, 'aac');
  fs.writeFileSync(aac, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n`, { mode: 0o755 });
  return { home, aac, argvLog };
}

async function hostServer(t: test.TestContext): Promise<string> {
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ hostId: 'h', label: 'desktop' })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function decode(domain: string): Record<string, unknown> {
  assert.ok(domain.startsWith(PREFIX));
  return record(JSON.parse(Buffer.from(domain.slice(PREFIX.length), 'base64url').toString('utf8')));
}

test('run hands aac an envelope naming the item, fields, reason and calling session, and passes its exit code through', async (t) => {
  const { home, aac, argvLog } = setup(t, true);
  const url = await hostServer(t);
  const env = { ...process.env, HOME: home, AAC_BIN: aac, PI_DISH_URL: url, PI_DISH_SESSION_ID: '', PI_DISH_VAULT_RELAY_URL: 'ws://relay.test' };
  const result = await run(process.execPath, [cli, 'run', '--item', 'fleet-sudo-desktop', '--env', 'PW=password', '--env', 'USER_NAME=username',
    '--reason', 'install rocprofiler', '--timeout', '120', '--', 'sh', '-c', 'echo hi'], { env }).then(() => 0, (error: { code?: number }) => error.code);
  assert.equal(result, 7);
  const argv: string[] = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
  assert.deepEqual(argv.slice(0, 6), ['--relay-url', 'ws://relay.test', '--output', 'json', 'run', '--domain']);
  assert.deepEqual(argv.slice(7), ['--timeout', '120', '--env', 'PW=password', '--env', 'USER_NAME=username', '--', 'sh', '-c', 'echo hi']);
  assert.deepEqual(decode(argv[6]), {
    item: 'fleet-sudo-desktop', fields: ['password', 'username'], timeoutSec: 120, reason: 'install rocprofiler',
    session: { ref: 'desktop/01a0a845', name: 'Htpc provision', host: 'desktop' },
  });
});

test('outside a pi-dish session the envelope carries no session claim', async (t) => {
  const { home, aac, argvLog } = setup(t, false);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, AAC_BIN: aac, PI_DISH_URL: 'http://127.0.0.1:9', PI_DISH_SESSION_ID: '' };
  delete env.PI_DISH_VAULT_RELAY_URL;
  await run(process.execPath, [cli, 'run', '--item', 'github.com', '--env', 'T=password', '--', 'true'], { env }).catch(() => {});
  const argv: string[] = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
  assert.deepEqual(argv.slice(0, 3), ['--output', 'json', 'run']);
  assert.deepEqual(decode(argv[4]), { item: 'github.com', fields: ['password'], timeoutSec: 300 });
});

test('run refuses unknown fields, missing commands and out-of-range timeouts before calling aac', async (t) => {
  const { home, aac, argvLog } = setup(t, false);
  const env = { ...process.env, HOME: home, AAC_BIN: aac };
  for (const args of [
    ['--item', 'x', '--env', 'T=ssn', '--', 'true'],
    ['--item', 'x', '--env', 'T=password'],
    ['--item', 'x', '--env', 'T=password', '--timeout', '5000', '--', 'true'],
    ['--env', 'T=password', '--', 'true'],
    ['--item', 'x', '--env', '1T=password', '--', 'true'],
  ]) {
    const failed = await run(process.execPath, [cli, 'run', ...args], { env }).then(() => false, () => true);
    assert.ok(failed, args.join(' '));
  }
  assert.equal(fs.existsSync(argvLog), false);
});
