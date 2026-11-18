/**
 * Antigravity (`agy`) session lifecycle: memory-pressure hibernation, wake on
 * message, and crash recovery. Each case boots server.js as a child process
 * against a temp HOME and an isolated tmux server; the relay in the pane drives
 * the scripted `agy acp` fixture (`FAKE_AGY_SCRIPT`).
 *
 * Why child servers: hibernation reads a meminfo file seam, samples on a short
 * interval, and automatic recovery only runs at startup — all configuration a
 * single in-process server would have to fake.
 *
 * Run with: npm test
 */
import test = require('node:test');
import type { TestContext } from 'node:test';
import assert = require('node:assert');
import fs = require('node:fs');
import net = require('node:net');
import os = require('node:os');
import path = require('node:path');
import crypto = require('node:crypto');
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { present, record, records } from './test-types.js';
import { sanitizeTestEnv } from './test-env.js';
import { RECOVERY_PROMPT } from '../lib/recovery-runner.js';

const SERVER = path.join(__dirname, '..', 'server.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-agy-acp.js');
const agyCommand = (script: string) => `env FAKE_AGY_SCRIPT=${script} ${process.execPath} ${FIXTURE}`;
const HOUR = 3_600_000;
const MEMINFO_PRESSURE = [
  'MemTotal:       16777216 kB',
  'MemFree:          102400 kB',
  'MemAvailable:     524288 kB',
  'SwapTotal:       16777216 kB',
  'SwapFree:        16777216 kB',
].join('\n') + '\n';
const MEMINFO_CALM = [
  'MemTotal:       16777216 kB',
  'MemFree:         8388608 kB',
  'MemAvailable:   8388608 kB',
  'SwapTotal:       16777216 kB',
  'SwapFree:        16777216 kB',
].join('\n') + '\n';

interface Booted { base: string; child: ChildProcess; stop(): Promise<void> }
const children = new Set<Booted>();
const ownedRoots = new Set<string>();
const tmuxDirs = new Set<string>();

test.after(async () => {
  for (const booted of children) await booted.stop().catch(() => {});
  // Relay panes outlive the server; the isolated tmux servers must not.
  for (const dir of tmuxDirs) {
    try { execFileSync('tmux', ['-S', path.join(dir, 'pi-dish'), 'kill-server'], { stdio: 'ignore' }); } catch {}
  }
  for (const root of ownedRoots) fs.rmSync(root, { recursive: true, force: true });
});

function ownedRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  ownedRoots.add(root);
  return root;
}

function makeHome(settings: Record<string, unknown>): string {
  const home = ownedRoot('pi-dish-agy-life-');
  fs.mkdirSync(path.join(home, '.pi', 'dish'), { recursive: true });
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true });
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'), JSON.stringify(settings));
  return home;
}

function makeTmuxDir(home: string): string {
  const dir = path.join(home, 'tmux');
  fs.mkdirSync(dir, { recursive: true });
  tmuxDirs.add(dir);
  return dir;
}

function meminfoFile(home: string, text: string): string {
  const file = path.join(home, 'meminfo.txt');
  fs.writeFileSync(file, text);
  return file;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close(() => reject(new Error('loopback probe lacked a TCP address')));
        return;
      }
      const port: number = (address as AddressInfo).port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function boot(home: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<Booted> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...sanitizeTestEnv(process.env), HOME: home, PORT: String(port),
    TMUX_TMPDIR: makeTmuxDir(home), PI_OFFLINE: '1', ...extraEnv,
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  child.stdout?.resume();
  const exited = new Promise<void>(resolve => { child.once('close', () => resolve()); });
  const booted: Booted = {
    base: `http://127.0.0.1:${port}`,
    child,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await exited;
    },
  };
  children.add(booted);
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`server exited during startup (${child.exitCode ?? child.signalCode}): ${stderr}`);
    }
    try {
      const response = await fetch(`${booted.base}/api/host`);
      if (response.ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`server did not come up: ${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return booted;
}

async function until(predicate: () => boolean, message: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function untilAsync(predicate: () => Promise<boolean>, message: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/**
 * Hibernation idleness comes from the transcript (entry timestamps floor at the
 * file mtime), not the relay claim: move both back so an idle relay looks idle.
 */
function backdateSession(home: string, agoMs: number): void {
  const file = present(mirrorFile(home), 'the relay wrote one mirror');
  const at = new Date(Date.now() - agoMs);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
    const entry = record(JSON.parse(line));
    if (typeof entry.timestamp === 'number') entry.timestamp = at.getTime();
    else if (typeof entry.timestamp === 'string') entry.timestamp = at.toISOString();
    return JSON.stringify(entry);
  });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  fs.utimesSync(file, at, at);
  const claim = readJsonFile(claimPath(home));
  if (claim) fs.writeFileSync(claimPath(home), JSON.stringify({ ...claim, updatedAt: at.toISOString() }, null, 2));
}

async function get(base: string, requestPath: string) {
  const response = await fetch(base + requestPath);
  return { status: response.status, body: record(await response.json()) };
}

async function post(base: string, requestPath: string, body: unknown) {
  const response = await fetch(base + requestPath, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return { status: response.status, body: record(await response.json().catch(() => ({}))) };
}

const sessionPath = (id: string, suffix: string) => `/api/sessions/${encodeURIComponent(id)}${suffix}`;
const messageText = (message: unknown): string => records(record(message).content)
  .filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('');

function storeFile(home: string, name: string, ...parts: string[]): string {
  return path.join(home, '.pi', 'dish', ...parts, name);
}

function readJsonFile(file: string): Record<string, unknown> | null {
  try { return record(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}

function mirrorFile(home: string): string | null {
  const root = path.join(home, '.pi', 'dish', 'agy', 'sessions');
  try {
    const mirrors = fs.readdirSync(root).filter(name => name.endsWith('.jsonl') && !name.endsWith('.acp.jsonl'));
    return mirrors.length === 1 ? path.join(root, mirrors[0]) : null;
  } catch { return null; }
}

function mirrorText(home: string): string {
  const file = mirrorFile(home);
  try { return file ? fs.readFileSync(file, 'utf8') : ''; } catch { return ''; }
}

function mirrorEntries(home: string): Record<string, unknown>[] {
  return mirrorText(home).split('\n').filter(Boolean).flatMap(line => {
    try { return [record(JSON.parse(line))]; } catch { return []; }
  });
}

function nativeId(home: string): string {
  const file = present(mirrorFile(home), 'the relay wrote one mirror');
  return path.basename(file, '.jsonl');
}

function claimPath(home: string): string {
  return path.join(home, '.pi', 'dish', 'sessions', `${nativeId(home)}.json`);
}

function readClaim(home: string): Record<string, unknown> {
  return record(present(readJsonFile(claimPath(home)), 'the relay published a claim'));
}

function spawnOf(home: string, routeId: string): Record<string, unknown> | null {
  const store = readJsonFile(path.join(home, '.pi', 'dish', 'tmux-spawns.json'));
  const placement = store ? store[routeId] : null;
  return placement ? record(placement) : null;
}

function paneExists(socket: string, paneId: string): boolean {
  try {
    return execFileSync('tmux', ['-S', socket, 'list-panes', '-t', paneId, '-F', '#{pane_id}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').includes(paneId);
  } catch { return false; }
}

function hibernationRecords(home: string): Record<string, unknown> {
  return readJsonFile(path.join(home, '.pi', 'dish', 'hibernation.json')) || {};
}

function recoveryObservation(home: string, routeId: string): Record<string, unknown> | null {
  const identity = /^(.+):(.+):(.+)$/.exec(routeId);
  const harnessId = identity ? identity[2] : 'agy';
  const native = nativeId(home);
  const key = crypto.createHash('sha256').update(JSON.stringify([harnessId, native])).digest('hex');
  return readJsonFile(path.join(home, '.pi', 'dish', 'recovery', 'observations', `${key}.json`));
}

function agyChildOf(relayPid: number): number | null {
  try {
    const children = fs.readFileSync(`/proc/${relayPid}/task/${relayPid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    for (const pid of children) {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (cmdline.includes('fake-agy-acp')) return Number(pid);
    }
  } catch { /* the relay is gone */ }
  return null;
}

function sessionRow(body: Record<string, unknown>, id: string): Record<string, unknown> | null {
  const rows = [...records(body.active), ...records(body.previous)].map(row => record(row));
  return rows.find(row => row.id === id) || null;
}

test('an idle agy relay hibernates under pressure and a message wakes it with a completed turn',
  { timeout: 120000 }, async t => {
    const home = makeHome({ hibernation: 'pressure' });
    const projDir = path.join(home, 'proj');
    const server = await boot(home, {
      PI_DISH_AGY_COMMAND: agyCommand('default'),
      PI_DISH_MEMINFO_FILE: meminfoFile(home, MEMINFO_PRESSURE),
      PI_DISH_HIBERNATION_SAMPLE_MS: '100',
    });
    t.after(() => server.stop());

    const created = await post(server.base, '/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String(present(created.body.id, 'the created agy route'));
    const prompted = await post(server.base, sessionPath(sessionId, '/prompt'), { message: 'hello antigravity' });
    assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
    await until(() => mirrorText(home).includes('Fake Antigravity reply.'), 'the first turn reached the mirror');
    await until(() => readClaim(home).turnInProgress === false, 'the first turn ended');
    const spawn = present(spawnOf(home, sessionId), 'the relay pane was recorded');
    // Let the finished turn's final appends settle before moving the clock.
    await new Promise(resolve => setTimeout(resolve, 300));

    // Idle means the transcript has not advanced for the hibernation window.
    backdateSession(home, 3 * HOUR);

    // The browser catalogue poll and the hibernation sampler share the session
    // index; read it here as a viewer would while the sampler decides.
    await untilAsync(async () => {
      await get(server.base, '/api/sessions');
      return Object.keys(hibernationRecords(home)).length === 1;
    }, 'the idle agy relay was hibernated', 30000);
    const recordId = Object.keys(hibernationRecords(home))[0];
    assert.equal(recordId, sessionId, 'the record names the agy route');
    await until(() => !paneExists(String(spawn.socket), String(spawn.paneId)), 'the relay pane closed');
    assert.equal(fs.existsSync(claimPath(home)), false, 'the retired relay removed its claim');
    assert.equal(spawnOf(home, sessionId), null, 'the spawn record was retired');
    assert.match(mirrorText(home), /Fake Antigravity reply\./, 'the transcript survives hibernation');

    const listed = await get(server.base, '/api/sessions');
    const row = record(present(sessionRow(listed.body, sessionId), 'the hibernated route is still listed'));
    assert.equal(row.isActive, false, 'a hibernated session is inactive');
    assert.equal(record(row.capabilities).resume, true, 'and resumable');
    assert.match(String(record(present(row.hibernation, 'the row carries the hibernation state')).reason),
      /Memory pressure/);

    const woken = await post(server.base, sessionPath(sessionId, '/prompt'), { message: 'wake up' });
    assert.equal(woken.status, 200, JSON.stringify(woken.body));
    await until(() => mirrorText(home).includes('wake up'), 'the waking message reached the mirror');
    await until(() => (mirrorText(home).match(/Fake Antigravity reply\./g) || []).length >= 2,
      'the wake turn completed');
    await until(() => Object.keys(hibernationRecords(home)).length === 0, 'the wake cleared the record');
    assert.ok(fs.existsSync(claimPath(home)), 'a fresh relay published a claim');
    const resumedSpawn = present(spawnOf(home, sessionId), 'resume recorded a new pane');
    assert.equal(paneExists(String(resumedSpawn.socket), String(resumedSpawn.paneId)), true, 'the relay runs again');
  });

test('a busy agy relay is never hibernated', { timeout: 120000 }, async t => {
  const home = makeHome({ hibernation: 'pressure' });
  const projDir = path.join(home, 'proj');
  const server = await boot(home, {
    PI_DISH_AGY_COMMAND: agyCommand('slow'),
    PI_DISH_MEMINFO_FILE: meminfoFile(home, MEMINFO_PRESSURE),
    PI_DISH_HIBERNATION_SAMPLE_MS: '100',
  });
  t.after(() => server.stop());

  const created = await post(server.base, '/api/sessions/new', { harness: 'agy', cwd: projDir });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const sessionId = String(present(created.body.id, 'the created agy route'));
  const prompted = await post(server.base, sessionPath(sessionId, '/prompt'), { message: 'start a long turn' });
  assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
  await until(() => readClaim(home).turnInProgress === true, 'the claim reports the live turn');

  backdateSession(home, 3 * HOUR);
  // Several 100 ms sample intervals with pressure, yet the turn keeps it alive.
  // The sampling loop runs in the child server, so its ticks have no in-process
  // signal to await; the elapsed time is the condition being exercised.
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.deepEqual(hibernationRecords(home), {}, 'no hibernation record for a working relay');
  assert.ok(fs.existsSync(claimPath(home)), 'the working relay kept its claim');
  const spawn = present(spawnOf(home, sessionId), 'the working relay kept its pane record');
  assert.equal(paneExists(String(spawn.socket), String(spawn.paneId)), true, 'the pane was not closed');

  const closed = await post(server.base, sessionPath(sessionId, '/close'), {});
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
});

test('a relay whose agent dies mid-turn leaves a resumable session with the partial text',
  { timeout: 120000 }, async t => {
    const home = makeHome({ hibernation: 'off' });
    const projDir = path.join(home, 'proj');
    const server = await boot(home, {
      PI_DISH_AGY_COMMAND: agyCommand('slow'),
      PI_DISH_MEMINFO_FILE: meminfoFile(home, MEMINFO_CALM),
    });
    t.after(() => server.stop());

    const created = await post(server.base, '/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String(present(created.body.id, 'the created agy route'));
    const prompted = await post(server.base, sessionPath(sessionId, '/prompt'), { message: 'work, then die' });
    assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
    await until(() => readClaim(home).turnInProgress === true, 'the streaming reply started');

    // The agent dies under a running turn; the relay owns the flush of the open
    // assistant segment before it exits.
    const relayPid = Number(readClaim(home).pid);
    const agentPid = present(agyChildOf(relayPid), 'the panes agy child');
    process.kill(agentPid, 'SIGKILL');
    await until(() => !fs.existsSync(claimPath(home)), 'the relay retired its claim');
    const crashed = present(spawnOf(home, sessionId), 'the crashed relay pane was recorded');
    await until(() => !paneExists(String(crashed.socket), String(crashed.paneId)), 'the relay pane exited');

    const assistant = mirrorEntries(home).filter(entry => entry.type === 'message')
      .map(entry => record(entry.message)).filter(message => message.role === 'assistant').pop();
    assert.equal(messageText(assistant), 'Working on it.', 'the interrupted partial answer is in the mirror');
    assert.equal(record(assistant).stopReason, 'error');

    await untilAsync(async () => {
      const listed = await get(server.base, '/api/sessions');
      return sessionRow(listed.body, sessionId)?.isActive === false;
    }, 'the crashed relay stopped counting as active');
    const listed = await get(server.base, '/api/sessions');
    const row = record(present(sessionRow(listed.body, sessionId), 'the crashed route is still listed'));
    assert.equal(record(row.capabilities).resume, true, 'and stays resumable');
    const resumed = await post(server.base, sessionPath(sessionId, '/resume'), {});
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.id, sessionId);
    const second = await post(server.base, sessionPath(sessionId, '/prompt'), { message: 'after the crash' });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    await until(() => mirrorText(home).includes('after the crash'), 'the resumed relay serves a new turn');

    const closed = await post(server.base, sessionPath(sessionId, '/close'), {});
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
  });

test('automatic recovery resumes an interrupted agy relay and delivers one recovery prompt',
  { timeout: 180000 }, async t => {
    const home = makeHome({ hibernation: 'off', recoveryMode: 'continue' });
    const projDir = path.join(home, 'proj');
    const first = await boot(home, {
      PI_DISH_AGY_COMMAND: agyCommand('crash'),
      PI_DISH_MEMINFO_FILE: meminfoFile(home, MEMINFO_CALM),
    });

    const created = await post(first.base, '/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String(present(created.body.id, 'the created agy route'));
    const prompted = await post(first.base, sessionPath(sessionId, '/prompt'), { message: 'interrupt me' });
    assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
    await until(() => mirrorText(home).includes('Partial before crash.'), 'the partial reply was written');
    await until(() => !fs.existsSync(claimPath(home)), 'the crashed relay retired its claim');
    await until(() => {
      const observation = recoveryObservation(home, sessionId);
      return !!observation && observation.activity === 'running';
    }, 'the relay recorded the interrupted run', 30000);
    const observation = record(present(recoveryObservation(home, sessionId), 'the interruption observation'));
    assert.equal(observation.shutdown, false, 'an agent crash is not a harness shutdown');

    await untilAsync(async () => {
      const listed = await get(first.base, '/api/sessions');
      return sessionRow(listed.body, sessionId)?.isActive === false;
    }, 'the crashed session stopped counting as active');
    const listed = await get(first.base, '/api/sessions');
    const row = record(present(sessionRow(listed.body, sessionId), 'the crashed route is still listed'));
    assert.equal(record(row.capabilities).resume, true, 'and resumable');
    await first.stop();
    const second = await boot(home, {
      PI_DISH_AGY_COMMAND: agyCommand('crash'),
      PI_DISH_MEMINFO_FILE: meminfoFile(home, MEMINFO_CALM),
    });
    t.after(() => second.stop());

    await until(() => mirrorText(home).includes(RECOVERY_PROMPT), 'the recovery prompt reached the mirror', 120000);
    await until(() => (mirrorText(home).match(/Fake Antigravity reply\./g) || []).length >= 1,
      'the resumed relay answered the recovery prompt', 120000);
    const recovered = await get(second.base, '/api/recovery');
    const outcome = records(recovered.body.sessions).map(session => record(session))
      .find(session => session.id === sessionId);
    assert.equal(record(present(outcome, 'the recovered route is reported')).status, 'continued');
    assert.ok(fs.existsSync(claimPath(home)), 'recovery left the relay running');

    const closed = await post(second.base, sessionPath(sessionId, '/close'), {});
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
  });
