// Generated test/tool from test/omp-models.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Backend tests for OMP model allow-list management (/api/omp-models*):
 * - fake fleet helper covering exit codes 0, 1 (operational + locked), 2 (policy),
 *   3 (conflict), 4 (all hosts failed), 64 (usage), invalid JSON, and timeout;
 * - empty env, argv-only invocation, mode-0600 temp files in pi-dish tmp dir,
 *   and temp file cleanup;
 * - fake omp --mode rpc preview covering matches, 0-match exit, empty list,
 *   query/limit, timeout + reliable child kill;
 * - HTTP auth (bearer token), CSRF (Origin / Sec-Fetch-Site / Content-Type),
 *   missing-helper 501 unavailable, local-only relay refusal, and harness settings rejection.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const node_child_process_1 = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const test_env_js_1 = require("./test-env.js");
const test_types_js_1 = require("./test-types.js");
const omp_models_js_1 = require("../lib/omp-models.js");
const relay_handlers_js_1 = require("../lib/relay-handlers.js");
const SERVER = path.join(__dirname, '..', 'server.js');
const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SHA_C = 'cccccccccccccccccccccccccccccccccccccccc';
const children = new Map();
test.after(async () => {
    for (const child of children.keys()) {
        if (child.pid !== undefined && child.exitCode === null && child.signalCode === null && !child.killed) {
            child.kill('SIGKILL');
        }
    }
    await Promise.all(children.values());
});
function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            if (address === null || typeof address === 'string') {
                probe.close(() => reject(new Error('Expected a loopback TCP address')));
                return;
            }
            const { port } = address;
            probe.close(err => err ? reject(err) : resolve(port));
        });
    });
}
function writeFakeFleet(binPath, controlFile, logFile) {
    const script = `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const control = JSON.parse(fs.readFileSync(${JSON.stringify(controlFile)}, 'utf8'));
const args = process.argv.slice(2);
const entry = {
  args,
  envKeys: Object.keys(process.env),
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
  // Ignore SIGTERM once to verify SIGKILL escalation also reaps stuck children.
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 60_000);
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
function writeFakeOmpRpc(scriptPath, logFile) {
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

if (patterns.includes('hang/*')) {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 60_000);
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
function readLogEntries(file) {
    if (!fs.existsSync(file))
        return [];
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => (0, test_types_js_1.record)(JSON.parse(line)));
}
function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
async function waitPidDead(pid, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!pidAlive(pid))
            return true;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    return !pidAlive(pid);
}
async function bootServer(home, extraEnv = {}) {
    const port = await freePort();
    const env = { ...(0, test_env_js_1.sanitizeTestEnv)(process.env), HOME: home, PORT: String(port) };
    delete env.PI_DISH_TOKEN;
    delete env.PI_DISH_TERMINAL;
    delete env.PI_DISH_SHARE_PORT;
    Object.assign(env, extraEnv);
    env.PI_OFFLINE = '1';
    const child = (0, node_child_process_1.spawn)(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.set(child, new Promise(resolve => child.once('close', () => resolve())));
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.resume();
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null)
            throw new Error(`server exited (${child.exitCode}): ${stderr}`);
        try {
            const res = await fetch(`${base}/api/host`);
            if (res.ok)
                return { base, child, stop: () => stopChild(child) };
        }
        catch { }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    child.kill('SIGKILL');
    throw new Error(`server startup timed out: ${stderr}`);
}
async function stopChild(child) {
    if (child.exitCode !== null || child.signalCode !== null)
        return;
    await new Promise(resolve => {
        const timer = setTimeout(() => { try {
            child.kill('SIGKILL');
        }
        catch { } }, 3000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
    });
}
test('createOmpModelsService covers helper exit codes 0/1/2/3/4/64, JSON errors, empty env, 0600 tmp cleanup, and timeouts', async () => {
    const root = (0, test_env_js_1.createTestTempDir)('pi-dish-test-');
    const tmpDir = path.join(root, 'dish-tmp');
    const fleetBin = path.join(root, 'bin', 'fleet');
    const controlFile = path.join(root, 'control.json');
    const logFile = path.join(root, 'fleet.log');
    const setControl = (value) => fs.writeFileSync(controlFile, JSON.stringify(value));
    writeFakeFleet(fleetBin, controlFile, logFile);
    const service = (0, omp_models_js_1.createOmpModelsService)({
        fleetBin,
        tmpDir,
        getTimeoutMs: 5000,
        dryRunTimeoutMs: 5000,
        applyTimeoutMs: 5000,
    });
    try {
        assert.equal(service.available(), true);
        // Exit 0: get
        setControl({ mode: 'ok', sha: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*'], disabledProviders: ['openrouter'] });
        const got = await service.get();
        assert.equal(got.status, 200);
        assert.deepEqual(got.body, {
            available: true,
            sha: SHA_A,
            enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*'],
            disabledProviders: ['openrouter'],
        });
        const getLog = readLogEntries(logFile).at(-1);
        assert.deepEqual(getLog.args, ['omp-models', 'get', '--json']);
        assert.deepEqual(getLog.envKeys, [], 'helper must run with an empty env');
        // Exit 0: dry-run (checks 0600 file inside tmpDir and removal afterwards)
        const dry = await service.dryRun({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'deepseek/*'] });
        assert.equal(dry.status, 200);
        assert.equal(dry.body.dryRun, true);
        assert.equal(dry.body.changed, true);
        assert.match(String(dry.body.diff), /\+  - deepseek\/\*/);
        const dryLog = readLogEntries(logFile).at(-1);
        const fileInfo = (0, test_types_js_1.record)(dryLog.fileInfo);
        assert.equal(fileInfo.mode, 0o600, 'list file must have mode 0600');
        assert.equal(path.dirname(String(fileInfo.path)), tmpDir, 'list file must live under pi-dish tmp dir');
        assert.equal(fs.existsSync(String(fileInfo.path)), false, 'list file must be removed after dry-run');
        assert.deepEqual(dryLog.envKeys, []);
        // Exit 0: apply with Mac offline
        const applied = await service.apply({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'deepseek/*'] });
        assert.equal(applied.status, 200);
        assert.equal(applied.body.sha, SHA_B);
        assert.equal(applied.body.unchanged, false);
        assert.equal(applied.body.restartRequired, true);
        assert.equal((0, test_types_js_1.record)(applied.body.hosts).beelink, 'ok');
        assert.match(String((0, test_types_js_1.record)(applied.body.hosts)['jacobs-macbook-air']), /Could not resolve/);
        // Exit 0: apply unchanged
        setControl({ mode: 'ok', sha: SHA_B, unchanged: true });
        const unchanged = await service.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
        assert.equal(unchanged.status, 200);
        assert.equal(unchanged.body.unchanged, true);
        assert.equal(unchanged.body.restartRequired, false);
        // Exit 1: locked
        setControl({ exitCode: 1, payload: { error: 'locked', message: 'another omp-models set holds lock' } });
        const locked = await service.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
        assert.equal(locked.status, 423);
        assert.equal(locked.body.error, 'locked');
        assert.equal(locked.body.retryable, true);
        assert.equal(locked.body.exitCode, 1);
        // Exit 1: generic operational failure
        setControl({ exitCode: 1, payload: { error: 'fetch', message: 'git fetch origin main failed' } });
        const opFail = await service.get();
        assert.equal(opFail.status, 502);
        assert.equal(opFail.body.error, 'fetch');
        assert.equal(opFail.body.exitCode, 1);
        assert.match(String(opFail.body.message), /git fetch/);
        // Exit 2: policy rejection with verbatim reasons[]
        const reasons = [
            "entry 2 'openai/*': can match provider 'openai'",
            "entry 3 'devin/*': matches Devin fusion models",
        ];
        setControl({ exitCode: 2, payload: { error: 'policy', reasons } });
        const policy = await service.dryRun({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5', 'openai/*', 'devin/*'] });
        assert.equal(policy.status, 422);
        assert.equal(policy.body.error, 'policy');
        assert.equal(policy.body.exitCode, 2);
        assert.deepEqual(policy.body.reasons, reasons);
        // Exit 3: conflict with current sha
        setControl({ exitCode: 3, payload: { error: 'conflict', sha: SHA_C } });
        const conflict = await service.apply({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] });
        assert.equal(conflict.status, 409);
        assert.equal(conflict.body.error, 'conflict');
        assert.equal(conflict.body.sha, SHA_C);
        assert.equal(conflict.body.exitCode, 3);
        // Exit 4: committed, but all hosts failed deploy
        setControl({ exitCode: 4, payload: { sha: SHA_C, hosts: { beelink: 'disk full', desktop: 'unreachable' } } });
        const allFailed = await service.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
        assert.equal(allFailed.status, 502);
        assert.equal(allFailed.body.error, 'all_hosts_failed');
        assert.equal(allFailed.body.committed, true);
        assert.equal(allFailed.body.allHostsFailed, true);
        assert.equal(allFailed.body.exitCode, 4);
        assert.equal(allFailed.body.sha, SHA_C);
        assert.deepEqual(allFailed.body.hosts, { beelink: 'disk full', desktop: 'unreachable' });
        // Exit 64: usage
        setControl({ exitCode: 64, payload: { error: 'usage', message: 'bad flag' } });
        const usage = await service.get();
        assert.equal(usage.status, 400);
        assert.equal(usage.body.error, 'usage');
        assert.equal(usage.body.exitCode, 64);
        // Invalid JSON and non-object JSON
        setControl({ mode: 'invalid-json' });
        const badJson = await service.get();
        assert.equal(badJson.status, 502);
        assert.equal(badJson.body.error, 'invalid_output');
        setControl({ mode: 'non-object-json' });
        const nonObj = await service.get();
        assert.equal(nonObj.status, 502);
        assert.equal(nonObj.body.error, 'invalid_output');
        // Timeout kills stuck child (even one ignoring SIGTERM) and removes temp file
        const shortTimeout = (0, omp_models_js_1.createOmpModelsService)({ fleetBin, tmpDir, applyTimeoutMs: 120 });
        setControl({ mode: 'timeout' });
        const timedOut = await shortTimeout.apply({ base: SHA_B, enabledModels: ['anthropic/claude-opus-5-5'] });
        assert.equal(timedOut.status, 504);
        assert.equal(timedOut.body.error, 'timeout');
        assert.equal(timedOut.body.retryable, true);
        const timeoutLog = readLogEntries(logFile).at(-1);
        assert.equal(await waitPidDead(Number(timeoutLog.pid)), true, 'timed-out helper child must be killed');
        assert.equal(fs.existsSync(String((0, test_types_js_1.record)(timeoutLog.fileInfo).path)), false, 'temp file must be removed after timeout');
        shortTimeout.dispose();
    }
    finally {
        service.dispose();
    }
});
test('preview runs omp --mode rpc with mode-0600 overlay, cleans up child/file, handles 0-match and timeout', async () => {
    const root = (0, test_env_js_1.createTestTempDir)('pi-dish-test-');
    const tmpDir = path.join(root, 'dish-tmp');
    const fleetBin = path.join(root, 'bin', 'fleet');
    const ompScript = path.join(root, 'bin', 'fake-omp.js');
    const ompLog = path.join(root, 'omp.log');
    writeFakeFleet(fleetBin, path.join(root, 'control.json'), path.join(root, 'fleet.log'));
    writeFakeOmpRpc(ompScript, ompLog);
    const savedOmp = process.env.PI_DISH_OMP_COMMAND;
    process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${ompScript}`;
    const service = (0, omp_models_js_1.createOmpModelsService)({ fleetBin, tmpDir, previewTimeoutMs: 2000 });
    try {
        // Empty candidate list returns 0 without spawning omp
        const empty = await service.preview({ enabledModels: [] });
        assert.equal(empty.status, 200);
        assert.deepEqual(empty.body, { total: 0, truncated: false, startupModel: null, models: [] });
        assert.equal(readLogEntries(ompLog).length, 0);
        // Normal list with limit truncation
        const ok = await service.preview({
            enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*', 'deepseek/*'],
            query: '',
            limit: 2,
        });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.total, 4);
        assert.equal(ok.body.truncated, true);
        assert.equal((0, test_types_js_1.records)(ok.body.models).length, 2);
        assert.equal((0, test_types_js_1.record)(ok.body.startupModel).selector, 'anthropic/claude-opus-5-5');
        const rpcLog = readLogEntries(ompLog).at(-1);
        assert.equal(rpcLog.cfgMode, 0o600, 'overlay YAML must be mode 0600');
        assert.equal(fs.existsSync(String(rpcLog.cfgPath)), false, 'overlay YAML must be deleted');
        assert.equal(await waitPidDead(Number(rpcLog.pid)), true, 'omp rpc child must be killed after preview');
        // Zero matches (omp exits 1 with "No model available matching enabledModels") -> 200 with total: 0
        const nomatch = await service.preview({ enabledModels: ['nomatch/*'] });
        assert.equal(nomatch.status, 200);
        assert.deepEqual(nomatch.body, { total: 0, truncated: false, startupModel: null, models: [] });
        // Timeout kills stuck omp child (even ignoring SIGTERM) and deletes overlay
        const shortPreview = (0, omp_models_js_1.createOmpModelsService)({ fleetBin, tmpDir, previewTimeoutMs: 120 });
        const hung = await shortPreview.preview({ enabledModels: ['hang/*'] });
        assert.equal(hung.status, 504);
        assert.equal(hung.body.error, 'timeout');
        const hungLog = readLogEntries(ompLog).at(-1);
        assert.equal(await waitPidDead(Number(hungLog.pid)), true, 'timed-out omp rpc child must be killed');
        assert.equal(fs.existsSync(String(hungLog.cfgPath)), false, 'overlay YAML must be deleted on timeout');
        shortPreview.dispose();
    }
    finally {
        service.dispose();
        if (savedOmp === undefined)
            delete process.env.PI_DISH_OMP_COMMAND;
        else
            process.env.PI_DISH_OMP_COMMAND = savedOmp;
    }
});
test('HTTP routes enforce local-host availability, bearer auth, CSRF, harness settings rejection, and relay blocking', async () => {
    assert.equal((0, relay_handlers_js_1.namesOmpModelsRoute)('/omp-models'), true);
    assert.equal((0, relay_handlers_js_1.namesOmpModelsRoute)('/omp-models/apply'), true);
    assert.equal((0, relay_handlers_js_1.namesOmpModelsRoute)('/%6fmp-models/dry-run'), true);
    assert.equal((0, relay_handlers_js_1.namesOmpModelsRoute)('/models'), false);
    // 1. Host WITHOUT fleet helper reports unavailable (501) and omits capability
    const homeNoFleet = (0, test_env_js_1.createTestTempDir)('pi-dish-test-');
    fs.mkdirSync(path.join(homeNoFleet, '.pi', 'dish'), { recursive: true });
    const srvNoFleet = await bootServer(homeNoFleet);
    try {
        const desc = (0, test_types_js_1.record)(await (await fetch(`${srvNoFleet.base}/api/host`)).json());
        assert.equal((0, test_types_js_1.record)(desc.capabilities).ompModels, undefined);
        const getRes = await fetch(`${srvNoFleet.base}/api/omp-models`);
        assert.equal(getRes.status, 501);
        const getBody = (0, test_types_js_1.record)(await getRes.json());
        assert.equal(getBody.available, false);
        assert.equal(getBody.error, 'unavailable');
        const applyRes = await fetch(`${srvNoFleet.base}/api/omp-models/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5'] }),
        });
        assert.equal(applyRes.status, 501);
    }
    finally {
        await srvNoFleet.stop();
    }
    // 2. Host WITH fake fleet helper + fake omp + bearer token
    const homeWithFleet = (0, test_env_js_1.createTestTempDir)('pi-dish-test-');
    fs.mkdirSync(path.join(homeWithFleet, '.pi', 'dish'), { recursive: true });
    const token = 'omp-models-secret-token';
    fs.writeFileSync(path.join(homeWithFleet, '.pi', 'dish', 'token'), token, { mode: 0o600 });
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
        const desc = (0, test_types_js_1.record)(await (await fetch(`${srv.base}/api/host`)).json());
        assert.equal((0, test_types_js_1.record)(desc.capabilities).ompModels, true);
        // Bearer auth required
        assert.equal((await fetch(`${srv.base}/api/omp-models`)).status, 401);
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
        // Same-origin authorized GET, preview, dry-run, apply
        const getRes = await fetch(`${srv.base}/api/omp-models`, { headers: authHeaders });
        assert.equal(getRes.status, 200);
        assert.equal((0, test_types_js_1.record)(await getRes.json()).sha, SHA_A);
        const previewRes = await fetch(`${srv.base}/api/omp-models/preview`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json', Origin: srv.base, 'Sec-Fetch-Site': 'same-origin' },
            body: JSON.stringify({ enabledModels: ['anthropic/claude-opus-5-5', 'openai-codex/*'] }),
        });
        assert.equal(previewRes.status, 200);
        assert.equal((0, test_types_js_1.record)(await previewRes.json()).total, 3);
        const dryRes = await fetch(`${srv.base}/api/omp-models/dry-run`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json', Origin: srv.base, 'Sec-Fetch-Site': 'same-origin' },
            body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'deepseek/*'] }),
        });
        assert.equal(dryRes.status, 200);
        assert.equal((0, test_types_js_1.record)(await dryRes.json()).changed, true);
        const applyRes = await fetch(`${srv.base}/api/omp-models/apply`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json', Origin: srv.base, 'Sec-Fetch-Site': 'same-origin' },
            body: JSON.stringify({ base: SHA_A, enabledModels: ['anthropic/claude-opus-5-5', 'deepseek/*'] }),
        });
        assert.equal(applyRes.status, 200);
        assert.equal((0, test_types_js_1.record)(await applyRes.json()).sha, SHA_B);
        // PUT /api/harnesses/omp/settings refuses enabledModels cleanly
        const blockedSetting = await fetch(`${srv.base}/api/harnesses/omp/settings`, {
            method: 'PUT',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { enabledModels: ['anthropic/claude-opus-5-5'] } }),
        });
        assert.equal(blockedSetting.status, 400);
        assert.match(String((0, test_types_js_1.record)(await blockedSetting.json()).error), /fleet\.yml/i);
    }
    finally {
        await srv.stop();
    }
});
