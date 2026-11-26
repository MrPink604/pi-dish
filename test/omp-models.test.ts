/**
 * Backend tests for OMP model allow-list management (/api/omp-models*):
 * - minimal trusted helper env (HOME, PATH, LANG=C.UTF-8; excludes ambient/fleet override vars);
 * - helper exit codes 0, 1 (operational + locked), 2 (policy), 3 (conflict), 4 (all hosts failed),
 *   64 (usage), strict per-mode success payload validation, invalid JSON, unknown apply outcome,
 *   mode-0600 temp file cleanup (including write failures);
 * - single-flight Apply (409 apply_in_progress), 202 + GET /api/omp-models/apply-status polling,
 *   never killing running set on HTTP deadline, unknown outcome with retryable:false on helper death;
 * - hard process bounds: preview (2 running + 4 queued -> 429, slot held until child 'close'),
 *   get/dry-run (2 running -> 429);
 * - fake omp --mode rpc preview with --no-tools, EPIPE stdin error handling, 0-match exit,
 *   empty list, query/limit, timeout + reliable child kill;
 * - HTTP auth (bearer token), CSRF, missing-helper 501, harness settings rejection, and
 *   relay path decoding/normalisation (400 for dot segments / %2e/%2f/%5c matching omp-models, 501 for direct).
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import { spawn, type ChildProcess } from 'node:child_process';
import fs = require('node:fs');
import http = require('node:http');
import net = require('node:net');
import os = require('node:os');
import path = require('node:path');
import type { AddressInfo } from 'node:net';
import { createTestTempDir, sanitizeTestEnv } from './test-env.js';
import { record, records } from './test-types.js';
import { createOmpModelsService, minimalFleetHelperEnv } from '../lib/omp-models.js';
import { inspectOmpModelsRelayPath, namesOmpModelsRoute } from '../lib/relay-handlers.js';

const SERVER = path.join(__dirname, '..', 'server.js');
const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SHA_C = 'cccccccccccccccccccccccccccccccccccccccc';

const children = new Map<ChildProcess, Promise<void>>();
test.after(async () => {
  for (const child of children.keys()) {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  }
  await Promise.all(children.values());
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Expected a loopback TCP address')));
        return;
      }
      const { port }: AddressInfo = address;
      probe.close(err => err ? reject(err) : resolve(port));
    });
  });
}

function rawHttpGet(baseUrl: string, rawPath: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: Number(url.port),
      method: 'GET',
      path: rawPath,
      headers,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function writeFakeFleet(binPath: string, controlFile: string, logFile: string): void {
  const script = `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const control = JSON.parse(fs.readFileSync(${JSON.stringify(controlFile)}, 'utf8'));
const args = process.argv.slice(2);
const entry = {
  args,
  env: { ...process.env },
  envKeys: Object.keys(process.env).sort(),
  pid: process.pid,
  fileInfo: null,
};
const fileIdx = args.indexOf('--file');
if (fileIdx >= 0 && args[fileIdx + 1]) {
  const filePath = args[fileIdx + 1];
  const stat = fs.statSync(filePath);
  entry.fileInfo = {
    path: filePath,
    mode: stat.mode & 0o777,
    content: JSON.parse(fs.readFileSync(filePath, 'utf8')),
  };
}
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(entry) + '\\n');
const sub = args[1] || '';
const mode = control.mode || 'ok';
if (mode === 'timeout') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 60_000);
  return;
}
if (mode === 'wait-file') {
  const gate = control.gateFile;
  const poll = setInterval(() => {
    if (fs.existsSync(gate)) {
      clearInterval(poll);
      if (control.afterGate === 'die-no-json') {
        process.stderr.write('unexpected crash mid-deploy\\n');
        process.exit(1);
      }
      if (control.afterGate === 'sigkill') {
        process.kill(process.pid, 'SIGKILL');
        return;
      }
      process.stdout.write(JSON.stringify(control.gatePayload || {
        sha: ${JSON.stringify(SHA_B)},
        hosts: { beelink: 'ok' },
      }) + '\\n');
      process.exit(0);
    }
  }, 20);
  return;
}
if (mode === 'invalid-json') {
  process.stdout.write('not valid json {{{');
  process.exit(0);
}
if (mode === 'non-object-json') {
  process.stdout.write('["array"]');
  process.exit(0);
}
if (mode === 'raw-payload') {
  process.stdout.write(JSON.stringify(control.payload) + '\\n');
  process.exit(typeof control.exitCode === 'number' ? control.exitCode : 0);
}
if (typeof control.exitCode === 'number') {
  if (control.stderr) process.stderr.write(control.stderr);
  if (control.payload !== undefined) process.stdout.write(JSON.stringify(control.payload) + '\\n');
  process.exit(control.exitCode);
}
if (sub === 'get') {
  process.stdout.write(JSON.stringify({
    sha: control.sha || ${JSON.stringify(SHA_A)},
    enabledModels: control.enabledModels || ['anthropic/claude-opus-5-5', 'openai-codex/*'],
    disabledProviders: control.disabledProviders || ['openrouter'],
  }) + '\\n');
  process.exit(0);
}
if (sub === 'set' && args.includes('--dry-run')) {
  process.stdout.write(JSON.stringify({
    dryRun: true,
    sha: control.sha || ${JSON.stringify(SHA_A)},
    changed: control.changed !== false,
    diff: control.diff ?? '--- a/home/dot_config/omp/fleet.yml\\n+++ b/home/dot_config/omp/fleet.yml\\n@@ -1 +1,2 @@\\n   - anthropic/claude-opus-5-5\\n+  - deepseek/*\\n',
  }) + '\\n');
  process.exit(0);
}
if (sub === 'set') {
  if (control.unchanged) {
    process.stdout.write(JSON.stringify({ sha: control.sha || ${JSON.stringify(SHA_A)}, unchanged: true, hosts: {} }) + '\\n');
  } else {
    process.stdout.write(JSON.stringify({
      sha: control.nextSha || ${JSON.stringify(SHA_B)},
      hosts: control.hosts || {
        beelink: 'ok',
        desktop: 'ok',
        'jacobs-macbook-air': 'ssh: Could not resolve hostname jacobs-macbook-air',
      },
    }) + '\\n');
  }
  process.exit(0);
}
process.stdout.write(JSON.stringify({ error: 'usage', message: 'unexpected subcommand' }) + '\\n');
process.exit(64);
`;
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(binPath, script, { mode: 0o755 });
}

function writeFakeOmpRpc(scriptPath: string, logFile: string): void {
  const yamlPath = require.resolve('yaml');
  const script = `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const yaml = require(${JSON.stringify(yamlPath)});
const args = process.argv.slice(2);
const cfgIdx = args.indexOf('--config');
const cfgPath = cfgIdx >= 0 ? args[cfgIdx + 1] : null;
const cfgStat = cfgPath ? fs.statSync(cfgPath) : null;
const parsed = cfgPath ? yaml.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const patterns = Array.isArray(parsed?.enabledModels) ? parsed.enabledModels : [];
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({
  args,
  pid: process.pid,
  cfgPath,
  cfgMode: cfgStat ? (cfgStat.mode & 0o777) : null,
  patterns,
}) + '\\n');

if (patterns.includes('epipe/*')) {
  // Emit ready and immediately exit so parent's stdin write hits EPIPE.
  process.stdout.write(JSON.stringify({ type: 'ready', protocolVersion: 1 }) + '\\n');
  process.exit(0);
}
if (patterns.includes('hang/*')) {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 60_000);
  return;
}
if (patterns.includes('slow-close/*')) {
  // Hold open after SIGTERM briefly to verify concurrency slot waits for 'close', not signal.
  process.on('SIGTERM', () => {
    setTimeout(() => process.exit(0), 180);
  });
  process.stdout.write(JSON.stringify({ type: 'ready', protocolVersion: 1 }) + '\\n');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'get_state') {
        process.stdout.write(JSON.stringify({ id: msg.id, type: 'response', command: 'get_state', success: true, data: { model: { provider: 'anthropic', id: 'claude-opus-5-5', name: 'Claude Opus 5.5' } } }) + '\\n');
      } else if (msg.type === 'get_model_picker') {
        process.stdout.write(JSON.stringify({ id: msg.id, type: 'response', command: 'get_model_picker', success: true, data: { rows: [], recent: 0, total: 0 } }) + '\\n');
      }
    }
  });
  return;
}
if (patterns.some(p => p.startsWith('gate:'))) {
  const gateFile = patterns.find(p => p.startsWith('gate:')).slice('gate:'.length);
  const poll = setInterval(() => {
    if (fs.existsSync(gateFile)) {
      clearInterval(poll);
      process.stdout.write(JSON.stringify({ type: 'ready', protocolVersion: 1 }) + '\\n');
    }
  }, 20);
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'get_state') {
        process.stdout.write(JSON.stringify({ id: msg.id, type: 'response', command: 'get_state', success: true, data: { model: null } }) + '\\n');
      } else if (msg.type === 'get_model_picker') {
        process.stdout.write(JSON.stringify({ id: msg.id, type: 'response', command: 'get_model_picker', success: true, data: { rows: [], recent: 0, total: 0 } }) + '\\n');
      }
    }
  });
  return;
}
if (patterns.every(p => p === 'nomatch/*' || p === 'openrouter/*')) {
  process.stderr.write('No model available matching enabledModels (' + patterns.join(', ') + ') with usable credentials.\\n');
  process.exit(1);
}

const catalog = [
  { provider: 'anthropic', id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { provider: 'anthropic', id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { provider: 'openai-codex', id: 'gpt-6-luna', name: 'GPT-6 Luna' },
  { provider: 'openai-codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat' },
];

function matchPattern(pattern, model) {
  const full = (model.provider + '/' + model.id).toLowerCase();
  const bare = model.id.toLowerCase();
  const p = String(pattern).toLowerCase();
  if (p.endsWith('/*')) return full.startsWith(p.slice(0, -1));
  return full === p || bare === p;
}

const matched = catalog.filter(m => patterns.some(p => matchPattern(p, m)));
process.stdout.write(JSON.stringify({ type: 'ready', protocolVersion: 1 }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'available_commands_update', commands: [] }) + '\\n');

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'get_state') {
      const startup = matched[0] || catalog[0];
      process.stdout.write(JSON.stringify({
        id: msg.id, type: 'response', command: 'get_state', success: true,
        data: { model: startup },
      }) + '\\n');
    } else if (msg.type === 'get_model_picker') {
      const q = String(msg.query || '').toLowerCase();
      const filtered = matched.filter(m => !q || (m.provider + '/' + m.id + ' ' + m.name).toLowerCase().includes(q));
      const limit = Number(msg.limit) || 50;
      const rows = filtered.slice(0, limit).map((m, idx) => ({ ...m, current: idx === 0 }));
      process.stdout.write(JSON.stringify({
        id: msg.id, type: 'response', command: 'get_model_picker', success: true,
        data: { rows, recent: 0, total: filtered.length },
      }) + '\\n');
    }
  }
});
`;
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
}

function readLogEntries(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => record(JSON.parse(line)));
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitPidDead(pid: number, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return !pidAlive(pid);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Condition timed out');
}

async function bootServer(home: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...sanitizeTestEnv(process.env), HOME: home, PORT: String(port) };
  delete env.PI_DISH_TOKEN;
  delete env.PI_DISH_TERMINAL;
  delete env.PI_DISH_SHARE_PORT;
  Object.assign(env, extraEnv);
  env.PI_OFFLINE = '1';

  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.set(child, new Promise<void>(resolve => child.once('close', () => resolve())));
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
  child.stdout.resume();

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode}): ${stderr}`);
    try {
      const res = await fetch(`${base}/api/host`);
      if (res.ok) return { base, child, stop: () => stopChild(child) };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill('SIGKILL');
  throw new Error(`server startup timed out: ${stderr}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

test('createOmpModelsService passes minimal trusted env, validates payloads per mode, handles exit codes 0/1/2/3/4/64, and cleans 0600 tmp files', async () => {
  const root = createTestTempDir('pi-dish-test-');
  const tmpDir = path.join(root, 'dish-tmp');
  const fleetBin = path.join(root, 'bin', 'fleet');
  const controlFile = path.join(root, 'control.json');
  const logFile = path.join(root, 'fleet.log');
  const setControl = (value: Record<string, unknown>) => fs.writeFileSync(controlFile, JSON.stringify(value));

  writeFakeFleet(fleetBin, controlFile, logFile);
  const savedOverride = process.env.FLEET_OMP_MODELS_REPO;
  const savedNoDeploy = process.env.FLEET_OMP_MODELS_NO_DEPLOY;
  process.env.FLEET_OMP_MODELS_REPO = '/tmp/must-not-leak';
  process.env.FLEET_OMP_MODELS_NO_DEPLOY = '1';

  const service = createOmpModelsService({
    fleetBin,
    tmpDir,
    getTimeoutMs: 5000,
    dryRunTimeoutMs: 5000,
    applyWaitMs: 5000,
  });

  try {
    assert.equal(service.available(), true);
    const expectedEnv = minimalFleetHelperEnv();
    assert.deepEqual(Object.keys(expectedEnv).sort(), ['HOME', 'LANG', 'PATH']);
    assert.equal(expectedEnv.HOME, os.homedir());
    assert.equal(expectedEnv.LANG, 'C.UTF-8');
    assert.equal(expectedEnv.PATH, `${path.join(os.homedir(), '.local', 'bin')}:/usr/local/bin:/usr/bin:/bin`);

    // Exit 0: get + verify minimal trusted env excludes FLEET_OMP_MODELS_*
    setControl({ mode: 'ok', sha: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*'], disabledProviders: ['openrouter'] });
    const got = await service.get();
    assert.equal(got.status, 200);
    assert.deepEqual(got.body, {
      available: true,
      sha: SHA_A,
      enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*'],
      disabledProviders: ['openrouter'],
    });
    const getLog = readLogEntries(logFile).at(-1)!;
    assert.deepEqual(getLog.args, ['omp-models', 'get', '--json']);
    assert.deepEqual(getLog.envKeys, ['HOME', 'LANG', 'PATH']);
    assert.equal(record(getLog.env).HOME, expectedEnv.HOME);
    assert.equal(record(getLog.env).LANG, 'C.UTF-8');
    assert.equal(record(getLog.env).PATH, expectedEnv.PATH);
    assert.equal(record(getLog.env).FLEET_OMP_MODELS_REPO, undefined);
    assert.equal(record(getLog.env).FLEET_OMP_MODELS_NO_DEPLOY, undefined);

    // Exit 0: dry-run (checks 0600 file inside tmpDir and removal afterwards)
    const dry = await service.dryRun({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'deepseek/*'] });
    assert.equal(dry.status, 200);
    assert.equal(dry.body.dryRun, true);
    assert.equal(dry.body.changed, true);
    assert.match(String(dry.body.diff), /\+  - deepseek\/\*/);
    const dryLog = readLogEntries(logFile).at(-1)!;
    const fileInfo = record(dryLog.fileInfo);
    assert.equal(fileInfo.mode, 0o600);
    assert.equal(path.dirname(String(fileInfo.path)), tmpDir);
    assert.equal(fs.existsSync(String(fileInfo.path)), false);

    // Strict payload validation for dry-run: missing sha, missing changed, or changed:true without diff -> invalid_output
    for (const badPayload of [
      { changed: false },
      { sha: SHA_A },
      { sha: SHA_A, changed: true, diff: '' },
      { sha: SHA_A, changed: true },
      { sha: 'short', changed: false },
    ]) {
      setControl({ mode: 'raw-payload', payload: badPayload });
      const res = await service.dryRun({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] });
      assert.equal(res.status, 502);
      assert.equal(res.body.error, 'invalid_output');
    }

    // Exit 0: apply with Mac offline
    setControl({ mode: 'ok' });
    const applied = await service.apply({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'deepseek/*'] });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.sha, SHA_B);
    assert.equal(applied.body.unchanged, false);
    assert.equal(applied.body.restartRequired, true);
    assert.equal(record(applied.body.hosts).beelink, 'ok');

    // Exit 0: apply unchanged (even if hosts key is omitted)
    setControl({ mode: 'raw-payload', payload: { sha: SHA_B, unchanged: true } });
    const unchanged = await service.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.unchanged, true);
    assert.equal(unchanged.body.restartRequired, false);

    // Strict payload validation for apply: missing sha or missing hosts (when not unchanged) -> invalid_output + unknownOutcome + retryable:false
    for (const badPayload of [
      { hosts: { beelink: 'ok' } },
      { sha: SHA_B },
      { sha: SHA_B, hosts: { beelink: 42 } },
      { sha: 'not-a-sha', hosts: { beelink: 'ok' } },
    ]) {
      setControl({ mode: 'raw-payload', payload: badPayload });
      const res = await service.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
      assert.equal(res.status, 502);
      assert.equal(res.body.error, 'invalid_output');
      assert.equal(res.body.unknownOutcome, true);
      assert.equal(res.body.retryable, false);
      assert.match(String(res.body.message), /unknown outcome/i);
    }

    // Exit 1: locked
    setControl({ exitCode: 1, payload: { error: 'locked', message: 'another omp-models set holds lock' } });
    const locked = await service.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(locked.status, 423);
    assert.equal(locked.body.error, 'locked');
    assert.equal(locked.body.retryable, true);

    // Exit 1: operational failure (not retryable on apply)
    setControl({ exitCode: 1, payload: { error: 'fetch', message: 'git fetch origin main failed' } });
    const opFail = await service.get();
    assert.equal(opFail.status, 502);
    assert.equal(opFail.body.error, 'fetch');

    // Exit 2: policy rejection with verbatim reasons[]
    const reasons = [
      "entry 2 'openai/*': can match provider 'openai'",
      "entry 3 'devin/*': matches Devin fusion models",
    ];
    setControl({ exitCode: 2, payload: { error: 'policy', reasons } });
    const policy = await service.dryRun({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5', 'openai/*', 'devin/*'] });
    assert.equal(policy.status, 422);
    assert.deepEqual(policy.body.reasons, reasons);

    // Exit 3: conflict
    setControl({ exitCode: 3, payload: { error: 'conflict', sha: SHA_C } });
    const conflict = await service.apply({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.sha, SHA_C);

    // Exit 4: committed, all hosts failed
    setControl({ exitCode: 4, payload: { sha: SHA_C, hosts: { beelink: 'disk full', desktop: 'unreachable' } } });
    const allFailed = await service.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(allFailed.status, 502);
    assert.equal(allFailed.body.committed, true);
    assert.equal(allFailed.body.allHostsFailed, true);
    assert.equal(allFailed.body.retryable, false);
    assert.equal(allFailed.body.sha, SHA_C);

    // Exit 64: usage
    setControl({ exitCode: 64, payload: { error: 'usage', message: 'bad flag' } });
    assert.equal((await service.get()).status, 400);

    // Invalid JSON on get -> invalid_output; on apply -> unknown_outcome with retryable:false
    setControl({ mode: 'invalid-json' });
    assert.equal((await service.get()).body.error, 'invalid_output');
    const badApply = await service.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(badApply.status, 502);
    assert.equal(badApply.body.error, 'unknown_outcome');
    assert.equal(badApply.body.unknownOutcome, true);
    assert.equal(badApply.body.retryable, false);
    assert.match(String(badApply.body.message), /unknown outcome.*fleet-config log/i);

    setControl({ mode: 'non-object-json' });
    assert.equal((await service.get()).body.error, 'invalid_output');

    // Dry-run timeout kills stuck child and removes temp file (apply is NEVER killed on HTTP deadline)
    const shortDryRun = createOmpModelsService({ fleetBin, tmpDir, dryRunTimeoutMs: 120 });
    setControl({ mode: 'timeout' });
    const timedOut = await shortDryRun.dryRun({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(timedOut.status, 504);
    assert.equal(timedOut.body.error, 'timeout');
    const timeoutLog = readLogEntries(logFile).at(-1)!;
    assert.equal(await waitPidDead(Number(timeoutLog.pid)), true, 'timed-out dry-run child must be killed');
    assert.equal(fs.existsSync(String(record(timeoutLog.fileInfo).path)), false, 'temp file must be removed after timeout');
    shortDryRun.dispose();
  } finally {
    service.dispose();
    if (savedOverride === undefined) delete process.env.FLEET_OMP_MODELS_REPO;
    else process.env.FLEET_OMP_MODELS_REPO = savedOverride;
    if (savedNoDeploy === undefined) delete process.env.FLEET_OMP_MODELS_NO_DEPLOY;
    else process.env.FLEET_OMP_MODELS_NO_DEPLOY = savedNoDeploy;
  }
});

test('single-flight Apply returns 202 + 409 apply_in_progress, never kills running set, and reports done / unknown outcome via apply-status', async () => {
  const root = createTestTempDir('pi-dish-test-');
  const tmpDir = path.join(root, 'dish-tmp');
  const fleetBin = path.join(root, 'bin', 'fleet');
  const controlFile = path.join(root, 'control.json');
  const logFile = path.join(root, 'fleet.log');
  const gate1 = path.join(root, 'gate-1');
  const gate2 = path.join(root, 'gate-2');
  const setControl = (value: Record<string, unknown>) => fs.writeFileSync(controlFile, JSON.stringify(value));

  writeFakeFleet(fleetBin, controlFile, logFile);
  const service = createOmpModelsService({ fleetBin, tmpDir, applyWaitMs: 60 });
  try {
    assert.deepEqual(service.applyStatus(), { status: 200, body: { state: 'idle' } });

    // Start slow apply -> POST returns 202 {state:"running", opId} after applyWaitMs without killing the child
    setControl({ mode: 'wait-file', gateFile: gate1, gatePayload: { sha: SHA_B, hosts: { beelink: 'ok' } } });
    const first = await service.apply({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(first.status, 202);
    assert.equal(first.body.state, 'running');
    assert.equal(typeof first.body.opId, 'string');
    assert.ok(String(first.body.opId).length > 0);
    const opId1 = String(first.body.opId);

    // Second apply while running gets 409 {error:"apply_in_progress"} referencing the running opId
    const second = await service.apply({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'apply_in_progress');
    assert.equal(second.body.opId, opId1);
    const runningStatus = service.applyStatus();
    assert.equal(runningStatus.body.state, 'running');
    assert.equal(runningStatus.body.opId, opId1);

    // Child is still alive (was NOT killed when 202 returned)
    const runLog = readLogEntries(logFile).at(-1)!;
    assert.equal(pidAlive(Number(runLog.pid)), true);

    // Release gate -> helper finishes cleanly -> applyStatus reports done with matching opId and 200 result
    fs.writeFileSync(gate1, 'go');
    await waitUntil(() => service.applyStatus().body.state === 'done');
    const done1 = service.applyStatus();
    assert.equal(done1.status, 200);
    assert.equal(done1.body.state, 'done');
    assert.equal(done1.body.opId, opId1);
    const result1 = record(done1.body.result);
    assert.equal(result1.status, 200);
    assert.equal(record(result1.body).opId, opId1);
    assert.equal(record(result1.body).sha, SHA_B);
    assert.equal(fs.existsSync(String(record(runLog.fileInfo).path)), false, 'apply temp file removed after completion');

    // Next apply gets a distinct opId and dies without parseable JSON -> apply-status records unknown_outcome with retryable:false
    setControl({ mode: 'wait-file', gateFile: gate2, afterGate: 'die-no-json' });
    const third = await service.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(third.status, 202);
    const opId2 = String(third.body.opId);
    assert.notEqual(opId2, opId1);
    fs.writeFileSync(gate2, 'go');
    await waitUntil(() => {
      const st = service.applyStatus();
      return st.body.state === 'done' && st.body.opId === opId2;
    });
    const done2 = service.applyStatus();
    assert.equal(done2.body.opId, opId2);
    const res2 = record(done2.body.result);
    assert.equal(res2.status, 502);
    assert.equal(record(res2.body).opId, opId2);
    assert.equal(record(res2.body).unknownOutcome, true);
    assert.equal(record(res2.body).retryable, false);
    assert.match(String(record(res2.body).message), /unknown outcome.*fleet-config log/i);
  } finally {
    try { fs.writeFileSync(gate1, 'go'); } catch {}
    try { fs.writeFileSync(gate2, 'go'); } catch {}
    service.dispose();
  }
});

test('hard process bounds enforce 429 for get/dry-run (>2) and preview (>2 running + 4 queued) and hold preview slot until close', async () => {
  const root = createTestTempDir('pi-dish-test-');
  const tmpDir = path.join(root, 'dish-tmp');
  const fleetBin = path.join(root, 'bin', 'fleet');
  const controlFile = path.join(root, 'control.json');
  const fleetLog = path.join(root, 'fleet.log');
  const ompScript = path.join(root, 'bin', 'fake-omp.js');
  const ompLog = path.join(root, 'omp.log');
  const helperGate = path.join(root, 'helper-gate');
  const previewGate = path.join(root, 'preview-gate');

  writeFakeFleet(fleetBin, controlFile, fleetLog);
  writeFakeOmpRpc(ompScript, ompLog);
  fs.writeFileSync(controlFile, JSON.stringify({ mode: 'wait-file', gateFile: helperGate, gatePayload: { sha: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'], disabledProviders: [] } }));

  const savedOmp = process.env.PI_DISH_OMP_COMMAND;
  process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${ompScript}`;
  const service = createOmpModelsService({ fleetBin, tmpDir, getTimeoutMs: 5000, dryRunTimeoutMs: 5000, previewTimeoutMs: 5000 });
  try {
    // 1. Helper bound: 2 in flight allowed, 3rd gets 429
    const g1 = service.get();
    const g2 = service.dryRun({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] });
    const g3 = await service.get();
    assert.equal(g3.status, 429);
    assert.equal(g3.body.error, 'too_many_requests');
    fs.writeFileSync(helperGate, 'go');
    await Promise.all([g1, g2]);

    // 2. Preview bound: 2 running + 4 queued = 6 accepted, 7th gets 429
    const p = Array.from({ length: 6 }, () => service.preview({ enabledModels: [`gate:${previewGate}`] }));
    await waitUntil(() => readLogEntries(ompLog).length === 2);
    const overflow = await service.preview({ enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(overflow.status, 429);
    assert.equal(overflow.body.error, 'too_many_requests');
    fs.writeFileSync(previewGate, 'go');
    const results = await Promise.all(p);
    assert.equal(results.every(r => r.status === 200), true);

    // 3. Preview slot is held until child 'close' (not just until SIGTERM is sent)
    const oneSlot = createOmpModelsService({ fleetBin, tmpDir, maxPreviewConcurrency: 1, maxPreviewQueue: 0, previewTimeoutMs: 5000 });
    try {
      const slowRes = await oneSlot.preview({ enabledModels: ['slow-close/*'] });
      assert.equal(slowRes.status, 200);
      // Child traps SIGTERM for 180ms before exiting; an immediate second preview must see 429 while child is still closing!
      const immediate = await oneSlot.preview({ enabledModels: ['anthropic/claude-opus-5-5'] });
      assert.equal(immediate.status, 429);
      const slowPid = Number(readLogEntries(ompLog).at(-1)!.pid);
      assert.equal(await waitPidDead(slowPid), true);
      // Once closed, the slot is free again
      const afterClose = await oneSlot.preview({ enabledModels: ['anthropic/claude-opus-5-5'] });
      assert.equal(afterClose.status, 200);
    } finally {
      oneSlot.dispose();
    }
  } finally {
    try { fs.writeFileSync(helperGate, 'go'); } catch {}
    try { fs.writeFileSync(previewGate, 'go'); } catch {}
    service.dispose();
    if (savedOmp === undefined) delete process.env.PI_DISH_OMP_COMMAND;
    else process.env.PI_DISH_OMP_COMMAND = savedOmp;
  }
});

test('preview passes --no-tools, survives child stdin EPIPE without crashing, handles 0-match and timeout', async () => {
  const root = createTestTempDir('pi-dish-test-');
  const tmpDir = path.join(root, 'dish-tmp');
  const fleetBin = path.join(root, 'bin', 'fleet');
  const ompScript = path.join(root, 'bin', 'fake-omp.js');
  const ompLog = path.join(root, 'omp.log');
  writeFakeFleet(fleetBin, path.join(root, 'control.json'), path.join(root, 'fleet.log'));
  writeFakeOmpRpc(ompScript, ompLog);

  const savedOmp = process.env.PI_DISH_OMP_COMMAND;
  process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${ompScript}`;
  const service = createOmpModelsService({ fleetBin, tmpDir, previewTimeoutMs: 2000 });
  try {
    // Empty list returns 0 without spawning omp
    const empty = await service.preview({ enabledModels: [] });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { total: 0, truncated: false, startupModel: null, models: [] });
    assert.equal(readLogEntries(ompLog).length, 0);

    // Normal preview includes --no-tools and cleans up
    const ok = await service.preview({
      enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*', 'deepseek/*'],
      query: '',
      limit: 2,
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.total, 4);
    assert.equal(ok.body.truncated, true);
    assert.equal(records(ok.body.models).length, 2);
    assert.equal(record(ok.body.startupModel).selector, 'anthropic/claude-opus-5-5');
    const rpcLog = readLogEntries(ompLog).at(-1)!;
    const argv = rpcLog.args as string[];
    assert.equal(argv.includes('--no-tools'), true, 'preview omp argv must include --no-tools');
    assert.equal(rpcLog.cfgMode, 0o600);
    assert.equal(fs.existsSync(String(rpcLog.cfgPath)), false);
    assert.equal(await waitPidDead(Number(rpcLog.pid)), true);

    // EPIPE: child exits right after emitting ready; settles only this preview (502) and service keeps working
    const epipe = await service.preview({ enabledModels: ['epipe/*'] });
    assert.equal(epipe.status, 502);
    assert.equal(epipe.body.error, 'preview_failed');
    const afterEpipe = await service.preview({ enabledModels: ['anthropic/claude-opus-5-5'] });
    assert.equal(afterEpipe.status, 200);

    // Zero matches -> 200 total: 0
    const nomatch = await service.preview({ enabledModels: ['nomatch/*'] });
    assert.equal(nomatch.status, 200);
    assert.deepEqual(nomatch.body, { total: 0, truncated: false, startupModel: null, models: [] });

    // Timeout kills stuck child and deletes overlay
    const shortPreview = createOmpModelsService({ fleetBin, tmpDir, previewTimeoutMs: 120 });
    const hung = await shortPreview.preview({ enabledModels: ['hang/*'] });
    assert.equal(hung.status, 504);
    const hungLog = readLogEntries(ompLog).at(-1)!;
    assert.equal(await waitPidDead(Number(hungLog.pid)), true);
    assert.equal(fs.existsSync(String(hungLog.cfgPath)), false);
    shortPreview.dispose();
  } finally {
    service.dispose();
    if (savedOmp === undefined) delete process.env.PI_DISH_OMP_COMMAND;
    else process.env.PI_DISH_OMP_COMMAND = savedOmp;
  }
});

test('HTTP routes enforce availability, bearer auth, CSRF, apply-status, harness settings rejection, and relay 400/501 traversal blocking', async () => {
  // Relay path inspection unit checks
  assert.equal(inspectOmpModelsRelayPath('/omp-models'), 'block_501');
  assert.equal(inspectOmpModelsRelayPath('/omp-models/apply'), 'block_501');
  assert.equal(inspectOmpModelsRelayPath('/omp-models/apply-status'), 'block_501');
  assert.equal(inspectOmpModelsRelayPath('/%6fmp-models/dry-run'), 'block_501');
  assert.equal(inspectOmpModelsRelayPath('/foo/../omp-models'), 'reject_400');
  assert.equal(inspectOmpModelsRelayPath('/./omp-models/apply'), 'reject_400');
  assert.equal(inspectOmpModelsRelayPath('/%2e%2e/omp-models'), 'reject_400');
  assert.equal(inspectOmpModelsRelayPath('/%2E/omp-models'), 'reject_400');
  assert.equal(inspectOmpModelsRelayPath('/omp-models%2fapply'), 'reject_400');
  assert.equal(inspectOmpModelsRelayPath('/omp-models%5Capply'), 'reject_400');
  assert.equal(inspectOmpModelsRelayPath('/sessions/abc/../../api/omp-models'), 'reject_400');
  assert.equal(inspectOmpModelsRelayPath('/models'), 'ok');
  assert.equal(namesOmpModelsRoute('/foo/../omp-models'), true);
  assert.equal(namesOmpModelsRoute('/models'), false);

  // 1. Host WITHOUT fleet helper reports unavailable (501) and omits capability
  const homeNoFleet = createTestTempDir('pi-dish-test-');
  fs.mkdirSync(path.join(homeNoFleet, '.pi', 'dish'), { recursive: true });
  const srvNoFleet = await bootServer(homeNoFleet);
  try {
    const desc = record(await (await fetch(`${srvNoFleet.base}/api/host`)).json());
    assert.equal(record(desc.capabilities).ompModels, undefined);
    assert.equal((await fetch(`${srvNoFleet.base}/api/omp-models`)).status, 501);
    assert.equal((await fetch(`${srvNoFleet.base}/api/omp-models/apply-status`)).status, 501);
    assert.equal((await fetch(`${srvNoFleet.base}/api/omp-models/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: srvNoFleet.base, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] }),
    })).status, 501);
  } finally {
    await srvNoFleet.stop();
  }

  // 2. Host WITH fake fleet helper + fake omp + bearer token + dummy peer remote for relay tests
  const homeWithFleet = createTestTempDir('pi-dish-test-');
  fs.mkdirSync(path.join(homeWithFleet, '.pi', 'dish'), { recursive: true });
  const token = 'omp-models-secret-token';
  fs.writeFileSync(path.join(homeWithFleet, '.pi', 'dish', 'token'), token, { mode: 0o600 });
  fs.writeFileSync(path.join(homeWithFleet, '.pi', 'dish', 'settings.json'), JSON.stringify({
    remotes: [{ name: 'peer', url: 'http://127.0.0.1:1', token: 'peer-tok' }],
  }));
  const fleetBin = path.join(homeWithFleet, '.local', 'bin', 'fleet');
  const controlFile = path.join(homeWithFleet, 'control.json');
  const fleetLog = path.join(homeWithFleet, 'fleet.log');
  const ompScript = path.join(homeWithFleet, 'fake-omp.js');
  const ompLog = path.join(homeWithFleet, 'omp.log');
  fs.writeFileSync(controlFile, JSON.stringify({ mode: 'ok', sha: SHA_A }));
  writeFakeFleet(fleetBin, controlFile, fleetLog);
  writeFakeOmpRpc(ompScript, ompLog);

  const srv = await bootServer(homeWithFleet, {
    PI_DISH_OMP_COMMAND: `${process.execPath} ${ompScript}`,
  });
  try {
    const authHeaders = { Authorization: `Bearer ${token}` };
    const desc = record(await (await fetch(`${srv.base}/api/host`)).json());
    assert.equal(record(desc.capabilities).ompModels, true);

    // Bearer auth required
    assert.equal((await fetch(`${srv.base}/api/omp-models`)).status, 401);
    assert.equal((await fetch(`${srv.base}/api/omp-models/apply-status`)).status, 401);
    assert.equal((await fetch(`${srv.base}/api/omp-models/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] }),
    })).status, 401);

    // CSRF checks on mutating endpoints
    assert.equal((await fetch(`${srv.base}/api/omp-models/apply`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] }),
    })).status, 403);
    assert.equal((await fetch(`${srv.base}/api/omp-models/apply`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Origin: 'null' },
      body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] }),
    })).status, 403);
    assert.equal((await fetch(`${srv.base}/api/omp-models/apply`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] }),
    })).status, 415);

    // Wire-level relay traversal checks: dot segments and %2e/%2f/%5c matching omp-models -> 400; direct -> 501
    for (const rawPath of [
      '/hosts/peer/api/foo/../omp-models',
      '/hosts/peer/api/%2e%2e/omp-models',
      '/hosts/peer/api/%2E/omp-models',
      '/hosts/peer/api/omp-models%2fapply',
      '/hosts/peer/api/omp-models%5Capply',
      '/hosts/peer/api/sessions/x/../../api/omp-models',
    ]) {
      const res = await rawHttpGet(srv.base, rawPath, authHeaders);
      assert.equal(res.status, 400, `expected 400 for ${rawPath}, got ${res.status}`);
    }
    const directRelay = await rawHttpGet(srv.base, '/hosts/peer/api/omp-models', authHeaders);
    assert.equal(directRelay.status, 501);

    // Same-origin authorized GET, apply-status, preview, dry-run, apply
    assert.equal(record(await (await fetch(`${srv.base}/api/omp-models/apply-status`, { headers: authHeaders })).json()).state, 'idle');
    assert.equal(record(await (await fetch(`${srv.base}/api/omp-models`, { headers: authHeaders })).json()).sha, SHA_A);

    const previewRes = await fetch(`${srv.base}/api/omp-models/preview`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Origin: srv.base, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*'] }),
    });
    assert.equal(previewRes.status, 200);
    assert.equal(record(await previewRes.json()).total, 3);

    const dryRes = await fetch(`${srv.base}/api/omp-models/dry-run`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Origin: srv.base, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'deepseek/*'] }),
    });
    assert.equal(dryRes.status, 200);
    assert.equal(record(await dryRes.json()).changed, true);

    const applyRes = await fetch(`${srv.base}/api/omp-models/apply`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Origin: srv.base, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'deepseek/*'] }),
    });
    assert.equal(applyRes.status, 200);
    const applyBody = record(await applyRes.json());
    assert.equal(applyBody.sha, SHA_B);
    assert.equal(typeof applyBody.opId, 'string');
    assert.ok(String(applyBody.opId).length > 0);
    const statusAfter = record(await (await fetch(`${srv.base}/api/omp-models/apply-status`, { headers: authHeaders })).json());
    assert.equal(statusAfter.state, 'done');
    assert.equal(statusAfter.opId, applyBody.opId);
    assert.equal(record(record(statusAfter.result).body).opId, applyBody.opId);

    // PUT /api/harnesses/omp/settings refuses enabledModels cleanly
    const blockedSetting = await fetch(`${srv.base}/api/harnesses/omp/settings`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { enabledModels: ['anthropic/claude-opus-5-5'] } }),
    });
    assert.equal(blockedSetting.status, 400);
    assert.match(String(record(await blockedSetting.json()).error), /fleet\.yml/i);
  } finally {
    await srv.stop();
  }
});

export {};
