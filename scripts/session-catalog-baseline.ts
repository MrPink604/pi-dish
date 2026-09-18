#!/usr/bin/env node
// Isolated, observational baseline of the real server/read paths. No timing gates.
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import type { Server } from 'node:http';
const sessionKeys: typeof import('../lib/session-key') = require('../lib/session-key');
const checkedNativeId = (value: unknown) => {
  if (!sessionKeys.validSessionId(value)) throw new TypeError('Invalid fixture session id');
  return value;
};
type TestRecord = Record<string, unknown>;
const record = (value: unknown): TestRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
  const out: TestRecord = {};
  for (const [key, item] of Object.entries(value)) out[key] = item;
  return out;
};
const { sanitizeTestEnv }: typeof import('../test/test-env') = require('../test/test-env')

const scenario = process.argv[2] ?? '';
if (!scenario) {
  const { spawnSync }: typeof import('node:child_process') = require('node:child_process')
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
  process.exit(0);
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
fs.mkdirSync(String(process.env.TMUX_TMPDIR));
const roots = ['pi', 'omp', 'prime'].map(h => path.join(home, `.${h}`, 'agent', 'sessions'));
const files: string[] = [];
const live = path.join(roots[1], 'workspace-0', 'fixture-0.jsonl');
const large = path.join(roots[0], 'workspace-0', 'streaming.jsonl');
let corpusBytes = 0;
function write(file: string, id: string, omp = false, count = 24) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entries: unknown[] = [ ...(omp ? [{ type: 'title', title: id }] : []),
    { type: 'session', id, cwd: '/fixture/project', version: 3 } ];
  for (let n = 0; n < count; n++) entries.push({ type: 'message', id: `m${n}`, parentId: n ? `m${n - 1}` : null,
    message: { role: n % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: 'fixture text '.repeat(80) }] } });
  fs.writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
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
const { processIdentity }: typeof import('../lib/process-identity') = require('../lib/process-identity');
const identity = processIdentity(process.pid);
if (!identity) throw new Error('Baseline process identity is unavailable');
fs.writeFileSync(path.join(registry, 'live.json'), JSON.stringify({
  protocolVersion: 2, wrapper: { harnessId: 'omp', name: 'OMP', wrapperVersion: 'fixture' },
  harnessId: 'omp', nativeSessionId: 'fixture-0', sessionId: 'fixture-0',
  bridgeInstanceId: 'baseline', instanceId: 'baseline', sessionFile: live, socketPath: socket,
  pid: identity.pid, startTime: identity.startTime, capabilities: {}, spawnToken: null,
}));
}

// Instrument only this temporary corpus, and the real parser export before the
// index captures it. Exclude index-log bytes and module-loading reads.
interface Counts {
  directoryOpens: number; directoryReads: number; stats: number; fullReads: number;
  rangeReads: number; bytes: number; parseCalls: number; parseBytes: number;
}
let counts: Counts | null = null;
type FsMethodName = 'opendirSync' | 'readdirSync' | 'statSync' | 'readFileSync' | 'openSync' | 'readSync' | 'closeSync';
type DynamicFunction = (...args: never[]) => unknown;
const originals = new Map<FsMethodName, DynamicFunction>();
const fds = new Map<number, string>();
const corpusPath = (value: unknown): value is string =>
  typeof value === 'string' && roots.some(root => value === root || value.startsWith(root + path.sep));
let fullReadDepth = 0;
function wrap(name: FsMethodName, fn: (original: DynamicFunction, receiver: unknown, args: unknown[]) => unknown) {
  const original = Reflect.get(fs, name);
  if (typeof original !== 'function') throw new TypeError(`Missing fs.${name}`);
  originals.set(name, original);
  Object.defineProperty(fs, name, {
    configurable: true,
    value: function (this: unknown, ...args: unknown[]) { return fn(original, this, args); },
  });
}
wrap('opendirSync', (original, receiver, args) => {
  if (counts && corpusPath(args[0])) counts.directoryOpens++;
  return Reflect.apply(original, receiver, args);
});
wrap('readdirSync', (original, receiver, args) => {
  if (counts && corpusPath(args[0])) counts.directoryReads++;
  return Reflect.apply(original, receiver, args);
});
wrap('statSync', (original, receiver, args) => {
  if (counts && corpusPath(args[0])) counts.stats++;
  return Reflect.apply(original, receiver, args);
});
wrap('readFileSync', (original, receiver, args) => {
  fullReadDepth++;
  try {
    const result = Reflect.apply(original, receiver, args);
    if (counts && corpusPath(args[0])) { counts.fullReads++; counts.bytes += Buffer.byteLength(String(result)); }
    return result;
  } finally { fullReadDepth--; }
});
wrap('openSync', (original, receiver, args) => {
  const fd = Reflect.apply(original, receiver, args);
  if (typeof fd === 'number' && corpusPath(args[0])) fds.set(fd, args[0]);
  return fd;
});
wrap('readSync', (original, receiver, args) => {
  const read = Reflect.apply(original, receiver, args);
  const fd = args[0];
  if (counts && !fullReadDepth && typeof fd === 'number' && fds.has(fd) && typeof read === 'number') {
    counts.rangeReads++; counts.bytes += read;
  }
  return read;
});
wrap('closeSync', (original, receiver, args) => {
  if (typeof args[0] === 'number') fds.delete(args[0]);
  return Reflect.apply(original, receiver, args);
});
const readers: typeof import('../lib/session-files') = require('../lib/session-files')
const parse = readers.parseSessionEntries;
readers.parseSessionEntries = function (content: string) {
  if (counts) { counts.parseCalls++; counts.parseBytes += Buffer.byteLength(content); }
  return parse(content);
};
// Model enumeration is unrelated to catalog source/index work. Keep it offline
// and stable; the real catalog's fallback context-window policy still executes.
const piSdk: typeof import('../lib/pi-sdk') = require('../lib/pi-sdk');
piSdk.getAvailableModels = async () => [];
const index: typeof import('../lib/session-index') = require('../lib/session-index')
const { encodeSessionKey }: typeof import('../lib/session-key') = require('../lib/session-key')
let server: Server | null = null;
const results: TestRecord[] = [];
async function measure(name: string, action: () => TestRecord | Promise<TestRecord>): Promise<void> {
  counts = { directoryOpens: 0, directoryReads: 0, stats: 0, fullReads: 0, rangeReads: 0, bytes: 0, parseCalls: 0, parseBytes: 0 };
  const observed = counts;
  const start = performance.now();
  const detail = await action();
  results.push({ name, ms: Number((performance.now() - start).toFixed(3)), ...observed, ...detail });
  counts = null;
}
async function main() {
  const activeServer: Server = require('../server');
  server = activeServer;
  if (!activeServer.listening) await once(activeServer, 'listening');
  // Stop request counters at response finish: background indexing that runs
  // while the client drains JSON must not look like synchronous budget work.
  activeServer.prependListener('request', (_request, response) => response.once('finish', () => { counts = null; }));
  // Startup's knownWorkspaceCwds also scans history to seed skill mining. Boot
  // against an empty fixture home so that work cannot prewarm or overlap the
  // request measurements. No pending index build exists when files appear.
  await new Promise(resolve => setImmediate(resolve));
  createCorpus();
  const bridgeSession: typeof import('../lib/bridge-session') = require('../lib/bridge-session');
  bridgeSession.invalidateRegistryCache();
  const address = activeServer.address();
  if (!address || typeof address === 'string') throw new Error('Baseline server lacks TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const get = async (route: string): Promise<TestRecord> => {
    const response = await fetch(base + route);
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    const body = record(await response.json());
    return { active: Array.isArray(body.active) ? body.active.length : undefined,
      previous: Array.isArray(body.previous) ? body.previous.length : undefined,
      children: Array.isArray(body.children) ? body.children.length : undefined,
      indexing: body.indexing, totalMessages: body.totalMessages };
  };
  if (scenario === 'routes') {
  const route = `/api/sessions/${encodeSessionKey('prime', checkedNativeId('fixture-0'))}/messages?limit=1`;
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
  const sourceApi: typeof import('../lib/session-source') = require('../lib/session-source');
  const candidate = sourceApi.sourceForIdentity('pi', checkedNativeId('streaming'), large);
  index.getSessionInfo(candidate);
  const delta = JSON.stringify({ type: 'message', id: 'm6000', parentId: 'm5999', message: { role: 'user', content: [{ type: 'text', text: 'ordinary append' }] } }) + '\n';
  fs.appendFileSync(large, delta);
  await measure('ordinary-append-index-read', () => ({ messageCount: index.getSessionInfo(candidate).messageCount, appendedBytes: Buffer.byteLength(delta) }));
  }
  console.log(JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`,
    files: files.length, corpusBytes, syncBudget: 20, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
  }
  index.resetForTests();
  readers.parseSessionEntries = parse;
  for (const [name, original] of originals) Object.defineProperty(fs, name, { configurable: true, value: original });
  fs.rmSync(home, { recursive: true, force: true });
});

export {};
