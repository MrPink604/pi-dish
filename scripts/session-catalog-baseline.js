#!/usr/bin/env node
// Isolated, observational baseline of the real server/read paths. No timing gates.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { sanitizeTestEnv } = require('../test/test-env');

const scenario = process.argv[2];
if (!scenario) {
  const { spawnSync } = require('node:child_process');
  const runs = ['routes', 'active', 'lists'].map(name => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-baseline-process-'));
    try {
      const run = spawnSync(process.execPath, [__filename, name], { encoding: 'utf8', timeout: 60000,
        env: { PATH: process.env.PATH, TMPDIR: scratch }, maxBuffer: 1024 * 1024 });
      if (run.error || run.status !== 0) throw run.error || new Error(run.stderr || run.stdout);
      return JSON.parse(run.stdout.slice(run.stdout.indexOf('{\n')));
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  });
  console.log(JSON.stringify({ ...runs[0], results: runs.flatMap(run => run.results) }, null, 2));
  return;
}
if (!['routes', 'active', 'lists'].includes(scenario)) throw new Error('Usage: node scripts/session-catalog-baseline.js [routes|active|lists]');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-catalog-baseline-'));
process.once('exit', () => fs.rmSync(home, { recursive: true, force: true }));
// Allowlist the environment: no inherited provider credentials, config paths,
// tmux identity, SSH agent, or live harness home can reach this experiment.
const env = sanitizeTestEnv({ PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: home });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env, { TMUX_TMPDIR: path.join(home, 'tmux'),
  XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'),
  PI_DISH_PI_COMMAND: '/usr/bin/true', PI_DISH_OMP_COMMAND: '/usr/bin/true', PI_DISH_PRIME_COMMAND: '/usr/bin/true' });
fs.mkdirSync(process.env.TMUX_TMPDIR);
const roots = ['pi', 'omp', 'prime'].map(h => path.join(home, `.${h}`, 'agent', 'sessions'));
const files = [];
const live = path.join(roots[1], 'workspace-0', 'fixture-0.jsonl');
const large = path.join(roots[0], 'workspace-0', 'streaming.jsonl');
let corpusBytes = 0;
function write(file, id, omp = false, count = 24) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entries = [ ...(omp ? [{ type: 'title', title: id }] : []),
    { type: 'session', id, cwd: '/fixture/project', version: 3 } ];
  for (let n = 0; n < count; n++) entries.push({ type: 'message', id: `m${n}`, parentId: n ? `m${n - 1}` : null,
    message: { role: n % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: 'fixture text '.repeat(80) }] } });
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  files.push(file);
}
function createCorpus() {
for (let h = 0; h < roots.length; h++) {
  for (let n = 0; n < 80; n++) write(path.join(roots[h], h === 2 ? '' : `workspace-${n % 4}`, `fixture-${n}.jsonl`), `fixture-${n}`, h === 1);
}
for (let n = 0; n < 8; n++) write(path.join(roots[0], 'workspace-0', `launcher-${n}`, 'session.jsonl'), `generic-${n}`);
for (let n = 0; n < 8; n++) write(path.join(live.slice(0, -6), `child-${n}.jsonl`), `child-${n}`, true);
write(large, 'streaming', false, 6000);
corpusBytes = files.reduce((n, file) => n + fs.statSync(file).size, 0);
const registry = path.join(home, '.pi', 'dish', 'sessions');
fs.mkdirSync(registry, { recursive: true });
const socket = path.join(home, 'socket-stub');
fs.writeFileSync(socket, 'isolated registry reachability fixture');
const { processIdentity } = require('../lib/process-identity');
const identity = processIdentity(process.pid);
fs.writeFileSync(path.join(registry, 'live.json'), JSON.stringify({
  protocolVersion: 2, wrapper: { harnessId: 'omp', name: 'OMP', wrapperVersion: 'fixture' },
  harnessId: 'omp', nativeSessionId: 'fixture-0', sessionId: 'fixture-0',
  bridgeInstanceId: 'baseline', instanceId: 'baseline', sessionFile: live, socketPath: socket,
  pid: identity.pid, startTime: identity.startTime, capabilities: {}, spawnToken: null,
}));
}

// Instrument only this temporary corpus, and the real parser export before the
// index captures it. Exclude index-log bytes and module-loading reads.
let counts;
const originals = {};
const fds = new Map();
const corpusPath = value => typeof value === 'string' && roots.some(root => value === root || value.startsWith(root + path.sep));
let fullReadDepth = 0;
function wrap(name, fn) { originals[name] = fs[name]; fs[name] = fn(originals[name]); }
wrap('opendirSync', original => function (file, ...args) {
  if (counts && corpusPath(file)) counts.directoryOpens++;
  return original.call(this, file, ...args);
});
wrap('readdirSync', original => function (file, ...args) {
  if (counts && corpusPath(file)) counts.directoryReads++;
  return original.call(this, file, ...args);
});
wrap('statSync', original => function (file, ...args) {
  if (counts && corpusPath(file)) counts.stats++;
  return original.call(this, file, ...args);
});
wrap('readFileSync', original => function (file, ...args) {
  fullReadDepth++;
  try {
    const result = original.call(this, file, ...args);
    if (counts && corpusPath(file)) { counts.fullReads++; counts.bytes += Buffer.byteLength(result); }
    return result;
  } finally { fullReadDepth--; }
});
wrap('openSync', original => function (file, ...args) {
  const fd = original.call(this, file, ...args);
  if (corpusPath(file)) fds.set(fd, file);
  return fd;
});
wrap('readSync', original => function (fd, ...args) {
  const read = original.call(this, fd, ...args);
  if (counts && !fullReadDepth && fds.has(fd)) { counts.rangeReads++; counts.bytes += read; }
  return read;
});
wrap('closeSync', original => function (fd) { fds.delete(fd); return original.call(this, fd); });
const readers = require('../lib/session-files');
const parse = readers.parseSessionEntries;
readers.parseSessionEntries = function (content) {
  if (counts) { counts.parseCalls++; counts.parseBytes += Buffer.byteLength(content); }
  return parse(content);
};
// Model enumeration is unrelated to catalog source/index work. Keep it offline
// and stable; the real catalog's fallback context-window policy still executes.
require('../lib/pi-sdk').getAvailableModels = async () => [];
const index = require('../lib/session-index');
const { encodeSessionKey } = require('../lib/session-key');
let server;
const results = [];
async function measure(name, action) {
  counts = { directoryOpens: 0, directoryReads: 0, stats: 0, fullReads: 0, rangeReads: 0, bytes: 0, parseCalls: 0, parseBytes: 0 };
  const observed = counts;
  const start = performance.now();
  const detail = await action();
  results.push({ name, ms: Number((performance.now() - start).toFixed(3)), ...observed, ...detail });
  counts = null;
}
async function main() {
  server = require('../server');
  if (!server.listening) await once(server, 'listening');
  // Stop request counters at response finish: background indexing that runs
  // while the client drains JSON must not look like synchronous budget work.
  server.prependListener('request', (_request, response) => response.once('finish', () => { counts = null; }));
  // Startup's knownWorkspaceCwds also scans history to seed skill mining. Boot
  // against an empty fixture home so that work cannot prewarm or overlap the
  // request measurements. No pending index build exists when files appear.
  await new Promise(resolve => setImmediate(resolve));
  createCorpus();
  require('../lib/bridge-session').invalidateRegistryCache();
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async route => {
    const response = await fetch(base + route);
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    const body = await response.json();
    return { active: body.active?.length, previous: body.previous?.length,
      children: body.children?.length, indexing: body.indexing, totalMessages: body.totalMessages };
  };
  if (scenario === 'routes') {
  const route = `/api/sessions/${encodeSessionKey('prime', 'fixture-0')}/messages?limit=1`;
  await measure('cold-route-and-transcript', () => get(route));
  await measure('warm-route-and-transcript', () => get(route));
  }
  if (scenario === 'active') {
  await measure('cold-active-only', () => get('/api/sessions?active=1&view=client'));
  await measure('warm-active-only', () => get('/api/sessions?active=1&view=client'));
  }
  if (scenario === 'lists') {
  await measure('initial-bounded-list', () => get('/api/sessions?view=client'));
  let ready = false;
  const deadline = Date.now() + 30000;
  while (!ready && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
    ready = !(await get('/api/sessions?view=client')).indexing;
  }
  if (!ready) throw new Error('Index did not settle');
  await measure('fully-indexed-warm-list', () => get('/api/sessions?view=client'));
  index.resetForTests();
  await measure('persisted-index-list', () => get('/api/sessions?view=client'));
  const candidate = { file: large, harnessId: 'pi', nativeSessionId: 'streaming',
    sessionKey: encodeSessionKey('pi', 'streaming'), profileId: 'pi-v3', profileVersion: 1 };
  index.getSessionInfo(candidate);
  const delta = JSON.stringify({ type: 'message', id: 'm6000', parentId: 'm5999', message: { role: 'user', content: [{ type: 'text', text: 'ordinary append' }] } }) + '\n';
  fs.appendFileSync(large, delta);
  await measure('ordinary-append-index-read', () => ({ messageCount: index.getSessionInfo(candidate).messageCount, appendedBytes: Buffer.byteLength(delta) }));
  }
  console.log(JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`,
    files: files.length, corpusBytes, syncBudget: 20, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  index.resetForTests();
  readers.parseSessionEntries = parse;
  for (const [name, original] of Object.entries(originals)) fs[name] = original;
  fs.rmSync(home, { recursive: true, force: true });
});
